"""Isolated, deadline-limited admission check for the bundled SFTP backend."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time

import paramiko
from paramiko.sftp import CMD_CLOSE, CMD_HANDLE, CMD_OPEN, CMD_READ, SFTP_FLAG_WRITE, int64


CERTIFIED_VERSION = 'v1.75.2-codebridge.1'
CHECK_TIMEOUT = 8
INITIAL = bytes(index % 255 + 1 for index in range(4096))
REPLACEMENT = b'CodeBridge-safe-read-write-check!'
WRITTEN = INITIAL[:128] + REPLACEMENT + INITIAL[128 + len(REPLACEMENT):]


class CheckError(Exception):
    pass


def serve_command(executable, root, cache, config):
    return [str(executable), 'serve', 'sftp', str(root), '--stdio', '--config', str(config),
            '--cache-dir', str(cache), '--vfs-cache-mode', 'writes', '--vfs-write-back', '0s',
            '--dir-cache-time', '1s', '--poll-interval', '0', '--buffer-size', '0',
            '--copy-links=false', '--links=false', '--vfs-links=false', '--log-level', 'ERROR', '--stats', '0']


def isolated_environment(home):
    environment = {key: value for key, value in os.environ.items() if not key.upper().startswith('RCLONE_')}
    environment.update(HOME=str(home), USERPROFILE=str(home), XDG_CONFIG_HOME=str(home / '.config'),
                       XDG_CACHE_HOME=str(home / '.cache'), APPDATA=str(home / 'AppData' / 'Roaming'),
                       LOCALAPPDATA=str(home / 'AppData' / 'Local'))
    return environment


class PipeSocket:
    """Blocking pipe I/O is contained by the worker's process deadline."""
    def __init__(self, process):
        self.process = process

    def get_name(self):
        return 'codebridge-isolated-check'

    def send(self, data):
        return os.write(self.process.stdin.fileno(), data)

    def recv(self, size):
        return os.read(self.process.stdout.fileno(), size)

    def gettimeout(self):
        return None

    def settimeout(self, value):
        pass

    def close(self):
        self.process.stdin.close()


def _windows_job():
    """Assign this worker before spawning children, so timeout kills its tree."""
    from ctypes import wintypes
    class BasicLimits(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
                    ('flags', wintypes.DWORD), ('min_working_set', ctypes.c_size_t),
                    ('max_working_set', ctypes.c_size_t), ('process_limit', wintypes.DWORD),
                    ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD),
                    ('scheduling', wintypes.DWORD)]
    class IOCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in
                   ('reads', 'writes', 'other', 'read_bytes', 'write_bytes', 'other_bytes')]
    class ExtendedLimits(ctypes.Structure):
        _fields_ = [('basic', BasicLimits), ('io', IOCounters),
                    ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t),
                    ('peak_process_memory', ctypes.c_size_t), ('peak_job_memory', ctypes.c_size_t)]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    handle = kernel.CreateJobObjectW(None, None)
    if not handle:
        raise CheckError('无法建立自检子进程保护')
    limits = ExtendedLimits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or
            not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess())):
        raise CheckError('无法建立自检子进程保护')
    # Intentionally kept open until process exit. Children inherit membership,
    # but not this handle. Killing this worker closes the job and kills them.
    return handle


def _start_watchdog():
    if os.name == 'nt':
        job = _windows_job()
    else:
        job = None
        if os.getpgrp() != os.getpid():
            os.setsid()

    def expire():
        if os.name == 'nt':
            os._exit(124)
        os.killpg(os.getpid(), signal.SIGKILL)

    timer = threading.Timer(CHECK_TIMEOUT, expire)
    timer.daemon = True
    timer.start()
    return timer, job


def _assert_local(path, expected):
    expires = time.monotonic() + 2
    while path.read_bytes() != expected:
        if time.monotonic() >= expires:
            raise CheckError('SFTP 自检失败：关闭后文件内容或写回异常')
        time.sleep(.02)


def exercise_sftp(sftp, root):
    """Only disposable files under this worker's private temporary root."""
    with sftp.open('/read.bin', 'r+') as file:
        file.seek(128)
        if file.read(32) != INITIAL[128:160]:
            raise CheckError('SFTP 自检失败：读写句柄读取内容异常')
    with sftp.open('/read.bin', 'r') as file:
        if file.read(4096) != INITIAL:
            raise CheckError('SFTP 自检失败：读取修改了文件')
    _assert_local(root / 'read.bin', INITIAL)

    with sftp.open('/readwrite.bin', 'r+') as file:
        file.seek(128)
        if file.read(32) != INITIAL[128:160]:
            raise CheckError('SFTP 自检失败：读写句柄首次读取异常')
        file.seek(128)
        file.write(REPLACEMENT)
        file.seek(0)
        if file.read(4096) != WRITTEN:
            raise CheckError('SFTP 自检失败：同一句柄读写或剩余内容异常')
    _assert_local(root / 'readwrite.bin', WRITTEN)

    kind, message = sftp._request(CMD_OPEN, '/writeonly.bin', SFTP_FLAG_WRITE, paramiko.SFTPAttributes())
    if kind != CMD_HANDLE:
        raise CheckError('SFTP 自检失败：只写句柄打开异常')
    handle = message.get_binary()
    try:
        try:
            sftp._request(CMD_READ, handle, int64(128), 32)
        except OSError:
            pass  # The server must reject READ on a write-only handle.
        else:
            raise CheckError('SFTP 自检失败：只写句柄错误接受读取请求')
    finally:
        sftp._request(CMD_CLOSE, handle)
    with sftp.open('/writeonly.bin', 'r') as file:
        if file.read(4096) != INITIAL:
            raise CheckError('SFTP 自检失败：被拒绝的读取修改了文件')
    _assert_local(root / 'writeonly.bin', INITIAL)


def check(executable):
    with tempfile.TemporaryDirectory(prefix='codebridge-rclone-check-') as directory:
        base = Path(directory)
        root, cache, home = base / 'root', base / 'cache', base / 'home'
        for path in (root, cache, home):
            path.mkdir()
        config = base / 'empty.conf'
        config.write_bytes(b'')
        environment = isolated_environment(home)
        version = subprocess.run([executable, 'version'], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 timeout=2, env=environment)
        if (version.returncode or version.stdout.splitlines()[:1] !=
                [('rclone ' + CERTIFIED_VERSION).encode()]):
            raise CheckError('rclone 未通过版本准入：需要 ' + CERTIFIED_VERSION + '；请重新运行客户端部署脚本')
        for name in ('read.bin', 'readwrite.bin', 'writeonly.bin'):
            (root / name).write_bytes(INITIAL)
        process = subprocess.Popen(serve_command(executable, root, cache, config),
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, bufsize=0, env=environment)
        sftp = None
        try:
            sftp = paramiko.SFTPClient(PipeSocket(process))
            exercise_sftp(sftp, root)
            sftp.close()
            sftp = None
            process.wait(timeout=1)
            if process.returncode:
                raise CheckError('SFTP 自检失败：文件服务异常退出')
            for name, expected in (('read.bin', INITIAL), ('readwrite.bin', WRITTEN), ('writeonly.bin', INITIAL)):
                if (root / name).read_bytes() != expected:
                    raise CheckError('SFTP 自检失败：服务退出后文件内容异常')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=1)
            # Closing pipes after killing the owned child cannot wait for SFTP.
            process.stdin.close()
            process.stdout.close()
    return {'ok': True, 'version': CERTIFIED_VERSION}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rclone', required=True)
    args = parser.parse_args()
    timer = None
    try:
        timer, job = _start_watchdog()
        result = check(str(Path(args.rclone).resolve()))
        status = 0
    except Exception as error:
        if isinstance(error, CheckError):
            message = str(error)
        elif isinstance(error, subprocess.TimeoutExpired):
            message = 'rclone 隔离安全自检超时，未启动共享目录文件服务'
        elif isinstance(error, paramiko.SFTPError):
            message = 'SFTP 自检失败：读写协议响应异常，未启动共享目录文件服务'
        else:
            message = 'SFTP 隔离自检失败（' + type(error).__name__ + '），未启动共享目录文件服务'
        result = {'ok': False, 'message': message}
        status = 1
    finally:
        if timer is not None:
            timer.cancel()
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return status


if __name__ == '__main__':
    sys.exit(main())
