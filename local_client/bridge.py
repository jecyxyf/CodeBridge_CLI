"""Outbound SSH transport. No shell/PTY or local TCP SFTP listener."""
import base64
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shlex
import shutil
import socket
import stat
import subprocess
import threading
import tempfile
import time
from urllib.parse import urlsplit
import uuid

import paramiko
import socks


class BridgeError(Exception):
    pass


def fingerprint(key):
    return 'SHA256:' + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')


def connect_socket(host, port, proxy):
    if not isinstance(host, str) or not host or len(host) > 253 or any(c.isspace() or ord(c) < 32 for c in host) or '/' in host or '\\' in host:
        raise BridgeError('服务器地址格式无效')
    if not isinstance(port, int) or not 0 < port < 65536:
        raise BridgeError('SSH 端口必须在 1–65535 之间')
    if not proxy:
        return socket.create_connection((host, port), timeout=15)
    parsed = urlsplit(proxy)
    if parsed.scheme not in ('socks5', 'http') or not parsed.hostname or not parsed.port:
        raise BridgeError('代理格式须为 socks5://主机:端口 或 http://主机:端口')
    if parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise BridgeError('暂不支持代理账号、路径或查询参数')
    sock = None
    try:
        if parsed.scheme == 'http':
            # PySocks' buffered HTTP header parser can discard a coalesced SSH banner.
            # Read exactly the header bytes so every tunneled byte remains untouched.
            sock = socket.create_connection((parsed.hostname, parsed.port), timeout=15)
            hostname = host.encode('idna').decode('ascii')
            authority = ('[' + hostname + ']' if ':' in hostname and not hostname.startswith('[') else hostname) + ':' + str(port)
            sock.sendall(('CONNECT ' + authority + ' HTTP/1.1\r\nHost: ' + authority + '\r\n\r\n').encode('ascii'))
            header = bytearray()
            deadline = time.monotonic() + 5
            while not header.endswith(b'\r\n\r\n'):
                remaining = deadline - time.monotonic()
                if remaining <= 0 or len(header) >= 16384:
                    raise BridgeError('代理响应超时或过长')
                sock.settimeout(remaining)
                byte = sock.recv(1)
                if not byte:
                    raise BridgeError('代理提前关闭连接')
                header.extend(byte)
            if not re.match(rb'^HTTP/1\.[01] 200(?: |\r)', bytes(header)):
                raise BridgeError('代理未允许 CONNECT 隧道')
            sock.settimeout(15)
        else:
            sock = socks.socksocket()
            sock.settimeout(15)
            sock.set_proxy(socks.SOCKS5, parsed.hostname, parsed.port, rdns=True)
            sock.connect((host, port))
        return sock
    except Exception:
        if sock:
            sock.close()
        raise BridgeError('代理连接失败；未尝试直连') from None


def checked_root(folder):
    path = Path(folder).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise BridgeError('请选择现有的绝对路径文件夹')
    # Reject a symlink/reparse export root (rclone also ignores child links).
    for part in (path, *path.parents):
        if part.is_symlink() or (os.name == 'nt' and getattr(part.lstat(), 'st_file_attributes', 0) & 0x400):
            raise BridgeError('共享路径及其父目录不能是符号链接或 Windows 重解析点')
    return path.resolve()


def rclone_command(root, cache):
    executable = shutil.which('rclone')
    if not executable:
        raise BridgeError('未安装 rclone，请先运行客户端部署脚本')
    version = subprocess.run([executable, 'version'], capture_output=True, timeout=10)
    match = re.search(rb'rclone v(\d+)\.(\d+)\.(\d+)', version.stdout)
    if not match or tuple(map(int, match.groups())) < (1, 75, 0):
        raise BridgeError('rclone 版本过旧；安全要求至少 1.75.0，请重新运行部署脚本')
    # rclone rejects Windows NUL as --config. Use an exclusive-created regular
    # file in this session's cache, never the user's default config or an old file.
    fd, config = tempfile.mkstemp(prefix='rclone-empty-', suffix='.conf', dir=Path(cache).resolve())
    os.close(fd)
    return [executable, 'serve', 'sftp', str(root), '--stdio', '--config', config,
            '--cache-dir', str(cache), '--vfs-cache-mode', 'writes', '--vfs-write-back', '0s',
            '--dir-cache-time', '1s', '--poll-interval', '0', '--buffer-size', '0',
            '--copy-links=false', '--links=false', '--vfs-links=false', '--log-level', 'ERROR', '--stats', '0']


def execute_bounded(channel, command, timeout=10):
    expired = threading.Event()
    def cancel():
        expired.set()
        channel.close()  # Paramiko exec acknowledgment wait ignores settimeout.
    timer = threading.Timer(timeout, cancel)
    timer.daemon = True
    timer.start()
    try:
        channel.exec_command(command)
        if expired.is_set():
            raise BridgeError('远端命令确认超时；未重试此操作')
    except Exception:
        if expired.is_set():
            raise BridgeError('远端命令确认超时；操作结果不确定，未重试') from None
        raise
    finally:
        timer.cancel()


def mount_command(remote_os, session, mount_path=''):
    launcher = '.\\.codebridge\\codebridge-mount.cmd' if remote_os == 'Windows' else '.local/bin/codebridge-mount'
    command = f'{launcher} --session {session}'
    if mount_path:
        if remote_os == 'Windows':
            raise BridgeError('Windows 远端暂只支持自动盘符，请留空远端挂载目录')
        command += ' --mount-path ' + shlex.quote(mount_path)
    return command


def probe_bytes(path, allowed):
    if path.is_symlink():
        raise BridgeError('验证文件被替换为链接，已停止')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise BridgeError('验证文件类型发生变化')
        content = file.read(256)
        if content not in allowed:
            raise BridgeError('验证文件内容发生意外变化；不会删除它')
    return content, (info.st_dev, info.st_ino)


class Bridge:
    def __init__(self, notify, verify_host=None):
        self.notify = notify
        self.verify_host = verify_host
        self.stop = threading.Event()
        self.client = None
        self.process = None
        self.channel = None
        self.errors = queue.Queue()
        self.mounted = False
        self.cache = None
        self.root = None
        self.session = None
        self.mount = None
        self.remote_os = None
        self.verify_lock = threading.Lock()

    def disconnect(self):
        self.stop.set()
        # Closing SSH delivers EOF to remote foreground helper/SSHFS.
        if self.channel:
            self.channel.close()
        if self.client:
            self.client.close()

    def _pipe_to_remote(self):
        try:
            while not self.stop.is_set():
                block = os.read(self.process.stdout.fileno(), 65536)
                if not block:
                    break
                self.channel.sendall(block)
        except (OSError, EOFError):
            pass
        finally:
            try:
                self.channel.shutdown_write()
            except Exception:
                pass

    def _pipe_from_remote(self):
        try:
            while not self.stop.is_set():
                block = self.channel.recv(65536)
                if not block:
                    break
                self.process.stdin.write(block)
                self.process.stdin.flush()
        except (OSError, EOFError):
            pass
        finally:
            try:
                self.process.stdin.close()
            except OSError:
                pass

    def run(self, settings, password):
        failure = None
        try:
            root = checked_root(settings['folder'])
            self.root = root
            self.remote_os = settings['remote_os']
            host = settings['host'].strip()
            username = settings['username'].strip()
            port = int(settings['port'])
            if not host or not username or not 0 < port < 65536 or not password:
                raise BridgeError('请填写服务器、端口、用户名和密码')
            self.notify('正在连接服务器…')
            sock = connect_socket(host, port, settings['proxy'].strip())
            self.client = paramiko.Transport(sock)
            self.client.start_client(timeout=15)
            actual = fingerprint(self.client.get_remote_server_key())
            if self.verify_host is not None:
                self.verify_host(self, host, port, actual)
            elif actual != settings.get('fingerprint', '').strip():
                raise BridgeError('服务器指纹不匹配，已拒绝发送密码。实际指纹：' + actual)
            if self.stop.is_set():
                return
            self.client.auth_password(username, password, fallback=False)
            password = None
            session = uuid.uuid4().hex
            self.session = session
            self.notify('身份已验证，正在启动文件服务…')
            self.cache = Path.home() / '.codebridge' / 'cache' / session
            self.cache.mkdir(parents=True, mode=0o700)
            self.process = subprocess.Popen(rclone_command(root, self.cache), stdin=subprocess.PIPE,
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                            bufsize=65536, env={k: v for k, v in os.environ.items()
                                                           if not k.startswith('RCLONE_')})
            self.channel = self.client.open_session(timeout=15)
            self.channel.settimeout(None)
            execute_bounded(self.channel, mount_command(settings['remote_os'], session,
                                                       settings.get('remote_mount_path', '').strip()))
            for target in (self._pipe_to_remote, self._pipe_from_remote):
                threading.Thread(target=target, daemon=True).start()
            threading.Thread(target=self._collect_local_errors, daemon=True).start()
            deadline = time.monotonic() + 45
            pending = b''
            next_probe = time.monotonic() + 15
            probe = None
            probe_started = 0
            self.notify('身份已验证，正在挂载文件夹…')
            while not self.stop.wait(0.1):
                now = time.monotonic()
                if probe is not None and probe.is_set():
                    probe = None
                    next_probe = now + 15
                if probe is not None and now - probe_started > 10:
                    raise BridgeError('服务器连续 10 秒未回应健康检查，连接已中断')
                if probe is None and now >= next_probe:
                    probe = threading.Event()
                    probe_started = now
                    threading.Thread(target=self._probe, args=(probe,), daemon=True).start()
                while self.channel.recv_stderr_ready():
                    pending += self.channel.recv_stderr(4096)
                    if len(pending) > 65536:
                        raise BridgeError('服务器返回过多诊断信息')
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        message = line.decode('utf-8', 'replace')
                        if message.startswith('CODEBRIDGE_WARNING '):
                            data = json.loads(message[len('CODEBRIDGE_WARNING '):])
                            warning = data.get('message')
                            if isinstance(warning, str):
                                self.notify('警告：' + warning[:2000])
                        elif message.startswith('CODEBRIDGE_MOUNTED '):
                            data = json.loads(message[len('CODEBRIDGE_MOUNTED '):])
                            if data.get('session') != session:
                                raise BridgeError('挂载状态会话不匹配')
                            self.notify('挂载已建立，正在检查目录：' + data['mount'])
                        elif message.startswith('CODEBRIDGE_READY '):
                            data = json.loads(message[len('CODEBRIDGE_READY '):])
                            if data.get('session') != session:
                                raise BridgeError('服务器挂载确认无效')
                            if data.get('readable') is not True:
                                raise BridgeError('远端未确认目录可读，请更新远端部署')
                            self.mounted = True
                            self.mount = data['mount']
                            self.notify('已连接，远端挂载路径：' + data['mount'])
                        elif message:
                            self.errors.put(message[:1000])
                if self.channel.exit_status_ready() or self.process.poll() is not None or not self.client.is_active():
                    raise BridgeError(self._error_text('连接已中断，远端挂载不可用'))
                if not self.mounted and time.monotonic() > deadline:
                    raise BridgeError(self._error_text('等待远端实际挂载超时'))
        except Exception as exc:
            if not self.stop.is_set():
                # Do not include configuration/password or proxy exception objects.
                failure = str(exc) if isinstance(exc, BridgeError) else f'连接失败（{type(exc).__name__}）'
        finally:
            password = None
            self.disconnect()
            if self.process:
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        self.process.wait()
                # Cache intentionally retained: interrupted writes can need recovery.
            suffix = '\n若断线时正在写入，请检查本地缓存：' + str(self.cache) if self.cache else ''
            self.notify((failure or '已断开') + suffix)

    def verify_readwrite(self):
        if not self.verify_lock.acquire(blocking=False):
            return {'ok': False, 'message': '读写验证正在进行，请稍候'}
        path = None
        created = False
        issued = False
        verified = False
        channel = None
        result = {'ok': False, 'message': '读写验证未完成'}
        try:
            if not self.mounted or self.stop.is_set() or not self.client or not self.client.is_active():
                raise BridgeError('请先建立并确认目录挂载')
            probe = uuid.uuid4().hex
            path = self.root / ('.codebridge-probe-' + probe)
            before = ('CodeBridge:' + probe + ':before').encode()
            after = ('CodeBridge:' + probe + ':after').encode()
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created = True
            with os.fdopen(fd, 'wb') as file:
                file.write(before)
                file.flush()
                os.fsync(file.fileno())
            launcher = '.\\.codebridge\\codebridge-mount.cmd' if self.remote_os == 'Windows' else '.local/bin/codebridge-mount'
            command = f'{launcher} --verify-readwrite --session {self.session} --probe {probe}'
            if self.remote_os == 'Windows':
                if not re.fullmatch('[D-Z]:', self.mount or ''):
                    raise BridgeError('远端盘符格式无效')
                command += ' --drive ' + self.mount[0]
            channel = self.client.open_session(timeout=10)
            channel.settimeout(10)
            issued = True
            execute_bounded(channel, command)
            deadline = time.monotonic() + 20
            response = b''
            errors = b''
            while time.monotonic() < deadline and not self.stop.is_set():
                if channel.recv_ready():
                    response += channel.recv(4096)
                if channel.recv_stderr_ready():
                    errors += channel.recv_stderr(4096)
                if len(response) + len(errors) > 16384:
                    raise BridgeError('读写验证返回异常数据')
                if channel.exit_status_ready():
                    while channel.recv_ready():
                        response += channel.recv(4096)
                        if len(response) > 16384:
                            raise BridgeError('读写验证响应过长')
                    break
                time.sleep(.05)
            if self.stop.is_set():
                raise BridgeError('连接已断开，读写验证未完成')
            if not channel.exit_status_ready():
                raise BridgeError('远端读写验证超时；不能认定成功')
            if channel.recv_exit_status() != 0:
                raise BridgeError('远端读写检查失败；请检查挂载与目录权限')
            remote_result = json.loads(response.decode('utf-8'))
            if remote_result != {'ok': True, 'probe': probe}:
                raise BridgeError('远端读写确认不匹配')
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not self.stop.is_set():
                # rclone may atomically replace the local inode during write-back.
                content, identity = probe_bytes(path, (before, after))
                if content == after:
                    verified = True
                    result = {'ok': True, 'message': '读写验证通过：远端已读取并修改专用临时文件，本地已确认写回'}
                    break
                time.sleep(.1)
            if not verified:
                raise BridgeError('等待本地写回超时，写入尚未验证；不能认定成功')
        except Exception as exc:
            result = {'ok': False, 'message': str(exc) if isinstance(exc, BridgeError) else '读写验证失败（' + type(exc).__name__ + '）'}
        finally:
            if channel:
                channel.close()
            if created:
                try:
                    # On uncertain remote outcome keep the probe: deleting now could race pending VFS write-back.
                    if issued and not verified:
                        raise BridgeError('结果未确定')
                    content, identity = probe_bytes(path, (before, after))
                    current = path.lstat()
                    if path.is_symlink() or (current.st_dev, current.st_ino) != identity:
                        raise BridgeError('验证文件再次被替换')
                    path.unlink()
                except (OSError, BridgeError):
                    result['ok'] = False
                    result['message'] += '；临时验证文件尚未安全清理，请确认连接停止后检查：' + str(path)
            self.verify_lock.release()
        return result

    def _probe(self, done):
        try:
            # SSH requires an explicit success/failure response; either proves liveness.
            self.client.global_request('keepalive@openssh.com', wait=True)
        except Exception:
            pass
        finally:
            done.set()

    def _collect_local_errors(self):
        for line in self.process.stderr:
            self.errors.put('本地文件服务：' + line.decode('utf-8', 'replace').strip()[:1000])

    def _error_text(self, default):
        lines = []
        while not self.errors.empty() and len(lines) < 3:
            lines.append(self.errors.get_nowait())
        return default + ('\n' + '\n'.join(lines) if lines else '')
