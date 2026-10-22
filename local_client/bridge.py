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
import sys
import threading
import tempfile
import time
from urllib.parse import urlsplit
import uuid

import paramiko
import socks

from codebridge_logging import flush_logging, get_logger
from .runtime import Deadline, OperationTimeout, background, bounded_call, bounded_process


LOG = get_logger('codebridge.client')
PROGRAM_DIR = Path(__file__).resolve().parents[1]
VERIFY_TIMEOUT = 20
CONNECT_TIMEOUT = 15
AUTH_TIMEOUT = 15


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
    try:
        bounded_call(lambda: channel.exec_command(command), timeout, '远端命令确认')
    except OperationTimeout:
        background(channel.close)
        raise BridgeError('远端命令确认超时；操作结果不确定，未重试') from None


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
        self.session = uuid.uuid4().hex
        self.mount = None
        self.remote_os = None
        self.verify_lock = threading.Lock()
        self.stage = 1
        self.verify_cancel = threading.Event()
        self.verify_channel = None
        self.closed = threading.Event()
        self.cleanup_done = threading.Event()

    def step(self, number, message):
        self.stage = number
        LOG.info('session=%s 步骤%d运行结束：%s', self.session, number, message)

    def local_operation(self, operation, timeout, probe=None):
        data = {'operation': operation, 'root': str(self.root), 'probe': probe, 'timeout': max(.01, timeout - .3)}
        completed = bounded_process([sys.executable, '-m', 'local_client.probe'], timeout,
                                    '本地' + {'root': '目录检查', 'create': '探针创建', 'wait': '写回确认',
                                            'cleanup': '探针清理'}[operation],
                                    input=json.dumps(data).encode(), cancel=self.verify_cancel if operation != 'root' else self.stop,
                                    cwd=str(PROGRAM_DIR))
        try:
            result = json.loads(completed.stdout)
        except (ValueError, UnicodeError):
            raise BridgeError('本地文件检查未返回有效结果') from None
        if completed.returncode:
            raise BridgeError(result.get('message', '本地文件操作失败'))
        return result

    def disconnect(self):
        self.stop.set()
        self.verify_cancel.set()
        # Paramiko close can itself wait on a transport lock. The API must return.
        if not self.closed.is_set():
            self.closed.set()
            for resource in (self.verify_channel, self.channel, self.client):
                if resource is not None:
                    background(resource.close)

    def cancel_verification(self):
        self.verify_cancel.set()
        if self.verify_channel is not None:
            background(self.verify_channel.close)

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
            root = bounded_call(lambda: checked_root(settings['folder']), 5, '本地共享目录检查', self.stop)
            self.root = root
            self.remote_os = settings['remote_os']
            host = settings['host'].strip()
            username = settings['username'].strip()
            port = int(settings['port'])
            if not host or not username or not 0 < port < 65536 or not password:
                raise BridgeError('请填写服务器、端口、用户名和密码')
            self.step(1, '连接设置和本地目录检查通过')
            self.stage = 2
            self.notify('正在连接服务器…')
            sock = bounded_call(lambda: connect_socket(host, port, settings['proxy'].strip()),
                                CONNECT_TIMEOUT, '网络连接（含 DNS/代理）', self.stop,
                                late_cleanup=lambda resource: resource.close())
            self.client = paramiko.Transport(sock)
            self.client.auth_timeout = AUTH_TIMEOUT
            self.client.banner_timeout = CONNECT_TIMEOUT
            self.client.channel_timeout = 15
            bounded_call(lambda: self.client.start_client(timeout=15), CONNECT_TIMEOUT,
                         'SSH 握手', self.stop)
            self.step(2, '网络连接及 SSH 握手完成')
            self.stage = 3
            actual = fingerprint(self.client.get_remote_server_key())
            if self.verify_host is not None:
                self.verify_host(self, host, port, actual)
            elif actual != settings.get('fingerprint', '').strip():
                raise BridgeError('服务器指纹不匹配，已拒绝发送密码。实际指纹：' + actual)
            if self.stop.is_set():
                LOG.warning('session=%s 连接流程运行结束：已取消 step=3', self.session)
                return
            bounded_call(lambda: self.client.auth_password(username, password, fallback=False),
                         AUTH_TIMEOUT, 'SSH 密码认证', self.stop)
            password = None
            self.step(3, '服务器身份确认和 SSH 认证通过')
            session = self.session
            self.stage = 4
            self.notify('身份已验证，正在启动文件服务…')
            self.cache = Path.home() / '.codebridge' / 'cache' / session
            bounded_call(lambda: self.cache.mkdir(parents=True, mode=0o700), 5, '本地缓存准备', self.stop)
            self.process = bounded_call(
                lambda: subprocess.Popen(rclone_command(root, self.cache), stdin=subprocess.PIPE,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         bufsize=65536, env={k: v for k, v in os.environ.items()
                                                            if not k.startswith('RCLONE_')}),
                12, '本地文件服务启动', self.stop, late_cleanup=lambda process: process.kill())
            self.channel = bounded_call(lambda: self.client.open_session(timeout=15), 15,
                                        'SSH 挂载通道建立', self.stop,
                                        late_cleanup=lambda resource: resource.close())
            self.channel.settimeout(None)
            execute_bounded(self.channel, mount_command(settings['remote_os'], session,
                                                       settings.get('remote_mount_path', '').strip()))
            self.step(4, '本地文件服务已启动，远端挂载命令已接收')
            self.stage = 5
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
                            self.step(5, '远端真实挂载成立，目录读取通过')
                            self.stage = 6
                            self.notify('已连接，远端挂载路径：' + data['mount'])
                        elif message.startswith('CODEBRIDGE_ERROR '):
                            data = json.loads(message[len('CODEBRIDGE_ERROR '):])
                            raise BridgeError('远端挂载失败：' + str(data.get('message', '未知错误'))[:1000])
                        elif message:
                            self.errors.put(message[:1000])
                if self.channel.exit_status_ready() or self.process.poll() is not None or not self.client.is_active():
                    raise BridgeError(self._error_text('连接已中断，远端挂载不可用'))
                if not self.mounted and time.monotonic() > deadline:
                    raise BridgeError(self._error_text('等待远端实际挂载超时'))
        except Exception as exc:
            if not self.stop.is_set():
                # Do not include configuration/password or proxy exception objects.
                failure = str(exc) if isinstance(exc, (BridgeError, OperationTimeout)) else f'连接失败（{type(exc).__name__}）'
                LOG.error('session=%s 步骤%d运行结束：失败 type=%s', self.session, self.stage, type(exc).__name__)
                LOG.error('session=%s 连接流程运行结束：失败 step=%s', self.session, self.stage)
        finally:
            password = None
            self.disconnect()
            suffix = '\n若断线时正在写入，请检查本地缓存：' + str(self.cache) if self.cache else ''
            self.notify((failure or '已断开') + suffix)
            if self.process:
                process = self.process
                def cleanup():
                    try:
                        try:
                            process.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            process.terminate()
                            try:
                                process.wait(timeout=2)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                try:
                                    process.wait(timeout=2)
                                except subprocess.TimeoutExpired:
                                    pass
                        status = process.poll()
                        if status is None:
                            LOG.error('session=%s 连接清理运行结束：本地文件服务尚未退出，已发送终止信号；缓存保留', self.session)
                        else:
                            LOG.info('session=%s 连接清理运行结束：本地文件服务已退出 code=%s，缓存保留', self.session, status)
                    except Exception as exc:
                        LOG.error('session=%s 连接清理运行结束：失败 type=%s，缓存保留', self.session, type(exc).__name__)
                    finally:
                        self.cleanup_done.set()
                background(cleanup)
            else:
                try:
                    LOG.info('session=%s 连接清理运行结束', self.session)
                finally:
                    self.cleanup_done.set()

    def _remote_json(self, command, deadline, cancel=None, track=True):
        cancel = self.verify_cancel if cancel is None else cancel
        channel = bounded_call(lambda: self.client.open_session(timeout=deadline.remaining(5)),
                               deadline.remaining(5), '读写验证通道建立', cancel,
                               late_cleanup=lambda resource: resource.close())
        if track:
            self.verify_channel = channel
        try:
            channel.settimeout(.5)
            execute_bounded(channel, command, timeout=deadline.remaining(5))
            response = b''
            errors = b''
            expires = time.monotonic() + deadline.remaining(12)
            while True:
                if self.stop.is_set() or cancel.is_set():
                    raise BridgeError('连接已取消，读写验证未完成')
                deadline.remaining()
                if time.monotonic() >= expires:
                    raise OperationTimeout('远端读写操作超时，已停止等待')
                if channel.recv_ready():
                    response += channel.recv(4096)
                if channel.recv_stderr_ready():
                    errors += channel.recv_stderr(4096)
                if len(response) + len(errors) > 16384:
                    raise BridgeError('读写验证返回异常数据')
                if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                    status = bounded_call(channel.recv_exit_status, deadline.remaining(1),
                                          '远端退出状态确认', cancel)
                    if status != 0:
                        try:
                            error = json.loads(errors.decode('utf-8')).get('error', '')
                        except (ValueError, UnicodeError, AttributeError):
                            error = ''
                        raise BridgeError('远端读写检查失败：' + (error[:500] or '请检查服务端日志及部署版本'))
                    try:
                        return json.loads(response.decode('utf-8'))
                    except (ValueError, UnicodeError):
                        raise BridgeError('远端读写确认格式无效') from None
                cancel.wait(.02)
        finally:
            if self.verify_channel is channel:
                self.verify_channel = None
            background(channel.close)

    def _result_command(self, result, probe, reason=None):
        launcher = '.\\.codebridge\\codebridge-mount.cmd' if self.remote_os == 'Windows' else '.local/bin/codebridge-mount'
        command = f'{launcher} --session {self.session} --connection-result {result} --probe {probe}'
        if reason:
            command += ' --reason ' + reason
        if self.remote_os == 'Windows':
            if not re.fullmatch('[D-Z]:', self.mount or ''):
                raise BridgeError('远端盘符格式无效')
            command += ' --drive ' + self.mount[0]
        return command

    def _report_failure(self, reason, probe):
        if self.stop.is_set() or not self.client or not self.client.is_active():
            return
        try:
            self._remote_json(self._result_command('error', probe, reason), Deadline(3),
                              cancel=self.stop, track=False)
        except Exception:
            LOG.warning('session=%s 服务端失败结果确认未完成', self.session)

    def verify_readwrite(self):
        if not self.verify_lock.acquire(blocking=False):
            return {'ok': False, 'message': '读写验证正在进行，请稍候'}
        self.verify_cancel.clear()
        deadline = Deadline(VERIFY_TIMEOUT)
        probe = uuid.uuid4().hex
        path = None
        created = issued = cleaned = False
        reason = 'internal'
        phase = '开始验证'
        result = {'ok': False, 'message': '读写验证未完成'}
        try:
            LOG.info('session=%s 步骤6开始：读写验证，总时限%s秒', self.session, VERIFY_TIMEOUT)
            if not self.mounted or self.stop.is_set() or not self.client or not self.client.is_active():
                raise BridgeError('请先建立并确认目录挂载')
            path = self.root / ('.codebridge-probe-' + probe)
            phase = '本地探针创建'
            self.notify('正在验证读写：创建临时文件…')
            # Creation can time out after creating the file; preserve it on uncertainty.
            created = True
            self.local_operation('create', deadline.remaining(3), probe)
            LOG.debug('session=%s 步骤6：本地探针创建完成', self.session)
            launcher = '.\\.codebridge\\codebridge-mount.cmd' if self.remote_os == 'Windows' else '.local/bin/codebridge-mount'
            command = f'{launcher} --verify-readwrite --session {self.session} --probe {probe}'
            if self.remote_os == 'Windows':
                if not re.fullmatch('[D-Z]:', self.mount or ''):
                    raise BridgeError('远端盘符格式无效')
                command += ' --drive ' + self.mount[0]
            phase, reason = '远端读取和修改', 'remote_verify'
            self.notify('正在验证读写：等待远端读取并修改…')
            issued = True
            remote_result = self._remote_json(command, deadline)
            if remote_result != {'ok': True, 'probe': probe}:
                raise BridgeError('远端读写确认不匹配')
            LOG.debug('session=%s 步骤6：远端读写完成', self.session)
            phase, reason = '本地写回确认', 'local_writeback'
            self.notify('正在验证读写：确认本地写回…')
            self.local_operation('wait', deadline.remaining(4), probe)
            phase, reason = '临时文件清理', 'probe_cleanup'
            self.notify('正在验证读写：清理临时文件…')
            self.local_operation('cleanup', deadline.remaining(2), probe)
            cleaned = True
            phase, reason = '两端结束确认', 'internal'
            self.notify('正在验证读写：确认两端完成…')
            if not flush_logging(LOG, timeout=deadline.remaining(1)):
                raise BridgeError('客户端日志写入失败或超时，请检查 logs 目录')
            remote_result = self._remote_json(self._result_command('success', probe), deadline)
            if remote_result != {'ok': True, 'session': self.session, 'result': 'success'}:
                raise BridgeError('服务端结束确认不匹配，请更新服务端部署')
            deadline.remaining()
            if self.stop.is_set() or self.verify_cancel.is_set():
                raise BridgeError('连接已取消，读写验证结果已作废')
            result = {'ok': True, 'message': '读写验证通过：远端读写、本地写回、临时文件清理及两端结束确认均完成'}
        except Exception as exc:
            if isinstance(exc, OperationTimeout) or '超时' in str(exc):
                reason = 'timeout'
            message = str(exc) if isinstance(exc, (BridgeError, OperationTimeout)) else '操作失败（' + type(exc).__name__ + '）'
            result = {'ok': False, 'message': '读写验证失败：' + phase + '；' + message}
            LOG.error('session=%s 步骤6子阶段=%s 失败 type=%s', self.session, phase, type(exc).__name__)
        finally:
            if created and not cleaned:
                # Do not race uncertain remote writes or a timed-out local worker.
                if not issued and reason != 'timeout':
                    try:
                        self.local_operation('cleanup', deadline.remaining(1), probe)
                        cleaned = True
                    except Exception:
                        pass
                if not cleaned:
                    result['ok'] = False
                    result['message'] += '；临时验证文件可能保留，请连接停止后检查：' + str(path)
            self.verify_lock.release()
        if result['ok']:
            self.step(6, '远端读写、本地写回、清理及服务端结束确认完成')
            LOG.info('session=%s 连接流程运行结束：成功，六个步骤完成', self.session)
        else:
            LOG.error('session=%s 步骤6运行结束：失败 phase=%s reason=%s', self.session, phase, reason)
            LOG.error('session=%s 连接流程运行结束：失败 step=6', self.session)
            background(lambda: self._report_failure(reason, probe))
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
