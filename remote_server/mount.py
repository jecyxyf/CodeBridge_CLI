#!/usr/bin/env python3
"""One SSH exec session, one foreground passive mount. stdout is SFTP ONLY."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time


def emit(kind, data):
    print('CODEBRIDGE_' + kind + ' ' + json.dumps(data, ensure_ascii=True), file=sys.stderr, flush=True)


def executable():
    candidates = [shutil.which('sshfs'), '/opt/homebrew/bin/sshfs', '/usr/local/bin/sshfs',
                  r'C:\Program Files\SSHFS-Win\bin\sshfs.exe']
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError('未找到 SSHFS，请运行远端部署脚本')


def passive_option(binary):
    result = subprocess.run([binary, '-h'], capture_output=True, timeout=10)
    help_text = (result.stdout + result.stderr).decode('utf-8', 'replace')
    if 'passive' in help_text:
        return 'passive'
    if 'slave' in help_text:
        return 'slave'
    raise RuntimeError('此 SSHFS 构建未声明 passive/slave 支持；不会使用假挂载或不安全回退')


def mountpoint(session):
    if os.name == 'nt':
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for index in range(25, 3, -1):
            if not mask & (1 << index):
                return chr(65 + index) + ':'
        raise RuntimeError('没有可用盘符')
    base = Path.home() / '.codebridge' / 'mounts'
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    if base.is_symlink() or base.stat().st_uid != os.getuid() or base.stat().st_mode & 0o077:
        raise RuntimeError('挂载父目录必须归当前用户所有且权限为 0700')
    path = base / session
    path.mkdir(mode=0o700)  # Never reuse an existing path/mount.
    return str(path)


def is_mounted(path):
    return os.path.ismount(path + '\\' if os.name == 'nt' else path)


def unmount(path):
    if os.name == 'nt':
        # Foreground sshfs termination releases the WinFsp filesystem.
        return
    command = (['/sbin/umount', path] if sys.platform == 'darwin' else
               [shutil.which('fusermount3') or shutil.which('fusermount') or 'fusermount', '-u', path])
    try:
        subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        pass


def existing_mount(session, drive=None):
    if os.name == 'nt':
        if not drive or not re.fullmatch('[D-Z]', drive):
            raise RuntimeError('需要有效的远端盘符')
        path = drive + ':\\'
    else:
        path = str(Path.home() / '.codebridge' / 'mounts' / session)
    if not os.path.ismount(path):
        raise RuntimeError('操作系统未报告该目录为挂载点')
    return path


def operation_worker(session, operation, probe=None, drive=None):
    path = existing_mount(session, drive)
    if operation == 'list':
        with os.scandir(path) as entries:
            next(entries, None)  # Empty directories count as readable, too.
        return {'ok': True}
    if not probe or not re.fullmatch('[a-f0-9]{32}', probe):
        raise RuntimeError('验证标识无效')
    target = Path(path) / ('.codebridge-probe-' + probe)
    before = ('CodeBridge:' + probe + ':before').encode()
    after = ('CodeBridge:' + probe + ':after').encode()
    if target.is_symlink():
        raise RuntimeError('验证文件不能是符号链接')
    deadline = time.monotonic() + 3
    while True:
        try:
            fd = os.open(target, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
            break
        except FileNotFoundError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(.15)
    with os.fdopen(fd, 'rb') as file:
        original = os.fstat(file.fileno())
        if not stat.S_ISREG(original.st_mode) or file.read(256) != before:
            raise RuntimeError('不是本次专用验证文件；拒绝修改')
    fd = os.open(target, os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'wb') as file:
        current = os.fstat(file.fileno())
        if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):
            raise RuntimeError('验证文件已替换；拒绝修改')
        file.write(after)
        file.truncate()
        file.flush()
        os.fsync(file.fileno())
    return {'ok': True, 'probe': probe}


def bounded_operation(session, operation, probe=None, drive=None):
    args = [sys.executable, str(Path(__file__).resolve()), '--session', session,
            '--operation-worker', operation]
    if probe:
        args += ['--probe', probe]
    if drive:
        args += ['--drive', drive]
    completed = subprocess.run(args, capture_output=True, timeout=12)
    if completed.returncode:
        raise RuntimeError('远端目录操作失败或权限不足')
    return json.loads(completed.stdout)


def run(session):
    process = None
    path = None
    try:
        binary = executable()
        option = passive_option(binary)
        if sys.platform.startswith('linux') and not os.path.exists('/dev/fuse'):
            raise RuntimeError('远端缺少 /dev/fuse，不能挂载；请在允许 FUSE 的真实主机部署')
        path = mountpoint(session)
        command = [binary, ':/', path, '-f', '-o', option,
                   '-o', 'cache=no', '-o', 'attr_timeout=0', '-o', 'entry_timeout=0',
                   '-o', 'negative_timeout=0']
        # Windows OpenSSH pipes must never undergo CRT newline translation.
        if os.name == 'nt':
            import msvcrt
            msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
            msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
        process = subprocess.Popen(command, stdin=sys.stdin.buffer, stdout=sys.stdout.buffer,
                                   stderr=subprocess.PIPE)
        def errors():
            for line in process.stderr:
                # Keep SSH stderr separate from binary SFTP stdout.
                sys.stderr.buffer.write(line[:4096])
                sys.stderr.buffer.flush()
        threading.Thread(target=errors, daemon=True).start()
        deadline = time.monotonic() + 30
        while not is_mounted(path):
            if process.poll() is not None:
                raise RuntimeError('SSHFS 启动失败，退出码 ' + str(process.returncode))
            if time.monotonic() > deadline:
                raise RuntimeError('SSHFS 未在 30 秒内形成真实挂载')
            time.sleep(0.1)
        emit('MOUNTED', {'session': session, 'mount': path})
        bounded_operation(session, 'list', drive=path[0] if os.name == 'nt' else None)
        emit('READY', {'session': session, 'mount': path, 'readable': True})
        return process.wait()
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        emit('ERROR', {'message': str(exc)})
        return 1
    finally:
        if path:
            unmount(path)
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if path and os.name != 'nt' and not is_mounted(path):
            try:
                Path(path).rmdir()
            except OSError:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--session')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--verify-readwrite', action='store_true')
    parser.add_argument('--operation-worker', choices=('list', 'rw'))
    parser.add_argument('--probe')
    parser.add_argument('--drive')
    args = parser.parse_args()
    if args.self_test:
        try:
            binary = executable()
            option = passive_option(binary)
            if sys.platform.startswith('linux') and not os.path.exists('/dev/fuse'):
                raise RuntimeError('/dev/fuse 不存在')
            print(json.dumps({'sshfs': binary, 'mode': option,
                              'note': '仅验证依赖；真实挂载需要客户端连接测试'}, ensure_ascii=False))
            return 0
        except Exception as exc:
            print(str(exc), file=sys.stderr)
            return 1
    if not args.session or not re.fullmatch('[a-f0-9]{32}', args.session):
        parser.error('session must be a 32-character lowercase hexadecimal identifier')
    if args.verify_readwrite or args.operation_worker:
        try:
            if args.operation_worker:
                result = operation_worker(args.session, args.operation_worker, args.probe, args.drive)
            else:
                result = bounded_operation(args.session, 'rw', args.probe, args.drive)
            print(json.dumps(result), flush=True)
            return 0
        except Exception as exc:
            print(json.dumps({'ok': False, 'error': str(exc)}), file=sys.stderr, flush=True)
            return 1
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    for name in ('SIGTERM', 'SIGHUP'):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), interrupted)
    return run(args.session)

if __name__ == '__main__':
    sys.exit(main())
