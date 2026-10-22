#!/usr/bin/env python3
"""One SSH exec session, one foreground passive mount. stdout is SFTP ONLY."""
import argparse
from contextlib import nullcontext
import ctypes
import json
import os
from pathlib import Path
import queue
import re
import secrets
import shutil
import signal
import stat
import string
import subprocess
import sys
import threading
import time


# The deployed helper has this module beside it; source execution finds the
# repository copy without depending on the SSH shell's working directory.
if '--self-test' in sys.argv:
    sys.dont_write_bytecode = True
try:
    from codebridge_logging import configure_logging, get_logger
except ModuleNotFoundError as exc:
    if exc.name != 'codebridge_logging':
        raise
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from codebridge_logging import configure_logging, get_logger


LOGGER = get_logger('codebridge.server')
LOCK_TIMEOUT = 3.0
OPERATION_TIMEOUT = 12.0
RESULT_TIMEOUT = 5.0
PROCESS_START_TIMEOUT = 5.0
STAGE_TIMEOUTS = {'prepare': 15.0, 'mount': 30.0, 'readable': OPERATION_TIMEOUT,
                  'active': None, 'cleanup': 15.0}
RESULT_REASONS = ('remote_verify', 'local_writeback', 'probe_cleanup', 'timeout',
                  'disconnected', 'internal')


def stage(name, session):
    if name == 'active':
        # Finish log I/O before removing the preparation deadline.
        LOGGER.info('session=%s 服务端阶段=%s', session, name)
    if '--internal-worker' in sys.argv:
        print('CODEBRIDGE_INTERNAL_STAGE ' + name, file=sys.stderr, flush=True)
    if name != 'active':
        LOGGER.info('session=%s 服务端阶段=%s', session, name)


def log_supervisor_failure(session, phase):
    # Even a stalled log filesystem must not stall the timeout controller.
    finished = threading.Event()
    def write():
        try:
            configure_logging(Path(__file__).resolve().parent, 'codebridge.server')
            LOGGER.error('session=%s 连接流程运行结束 result=error phase=%s reason=timeout', session, phase)
        except Exception:
            # The protocol error still reports the failure when logs cannot
            # be opened; never emit a second traceback on the SSH stream.
            pass
        finally:
            finished.set()
    threading.Thread(target=write, daemon=True).start()
    finished.wait(.25)


def wait_process(process, timeout):
    deadline = time.monotonic() + timeout
    while process.poll() is None:
        if time.monotonic() >= deadline:
            return False
        time.sleep(min(.05, max(0, deadline - time.monotonic())))
    return True


def stop_process(process, grace=.2, kill_grace=.2, group=False):
    """Never wait indefinitely for an uninterruptible process or inherited pipe."""
    def send(force=False):
        try:
            if group and os.name != 'nt':
                os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
            elif force:
                process.kill()
            else:
                process.terminate()
        except (OSError, ProcessLookupError):
            pass
    send()
    exited = wait_process(process, grace)
    if not exited or (group and os.name != 'nt'):
        send(force=True)
        return wait_process(process, kill_grace)
    return True


def windows_process_job(process):
    """Tie Windows SSHFS descendants to the supervisor's lifetime, too."""
    if os.name != 'nt':
        return None
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
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.CreateJobObjectW(None, None)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = ExtendedLimits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or
            not kernel.AssignProcessToJobObject(handle, wintypes.HANDLE(int(process._handle)))):
        error = ctypes.get_last_error()
        kernel.CloseHandle(handle)
        raise ctypes.WinError(error)
    return lambda: kernel.CloseHandle(handle)


def bounded_process(command, timeout, phase):
    # communicate() may still wait forever after kill when a descendant or an
    # uninterruptible filesystem operation holds a pipe. Only a daemon reader
    # waits on pipes; the controlling thread always has its own deadline.
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    complete = threading.Event()
    result = {}
    def communicate():
        try:
            result['streams'] = process.communicate()
        except Exception as exc:
            result['error'] = exc
        finally:
            complete.set()
    threading.Thread(target=communicate, daemon=True).start()
    if not complete.wait(timeout):
        stop_process(process)
        raise TimeoutError(f'{phase}超时（{timeout:g} 秒），操作已终止；请检查挂载状态')
    if 'error' in result:
        raise result['error']
    stdout, stderr = result['streams']
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def start_supervised_process(command, timeout, gate=True):
    """Bound Popen itself and dispose of a child returned after cancellation.

    The inherited pipe gates actual helper work until ownership has reached
    the supervisor (and, on Windows, the process is assigned to its Job).
    Closing that pipe on timeout prevents a late child from starting work.
    """
    read_fd, write_fd = os.pipe() if gate else (None, None)
    kwargs = {'stdin': sys.stdin.buffer, 'stdout': sys.stdout.buffer,
              'stderr': subprocess.PIPE, 'start_new_session': os.name != 'nt'}
    command = list(command)
    if gate:
        if os.name == 'nt':
            import msvcrt
            handle = msvcrt.get_osfhandle(read_fd)
            os.set_handle_inheritable(handle, True)
            startup = subprocess.STARTUPINFO()
            startup.lpAttributeList = {'handle_list': [handle]}
            kwargs['startupinfo'] = startup
            command += ['--start-gate', str(handle)]
        else:
            kwargs['pass_fds'] = (read_fd,)
            command += ['--start-gate', str(read_fd)]
    finished = threading.Event()
    lock = threading.Lock()
    outcome = {'cancelled': False}
    def launch():
        process = None
        close_job = None
        handed_off = False
        try:
            process = subprocess.Popen(command, **kwargs)
            close_job = windows_process_job(process)
            with lock:
                if not outcome['cancelled']:
                    outcome['process'] = process
                    outcome['close_job'] = close_job
                    handed_off = True
        except Exception as exc:
            with lock:
                outcome['error'] = exc
        finally:
            if read_fd is not None:
                os.close(read_fd)
            if process is not None and not handed_off:
                stop_process(process, group=True)
                if close_job:
                    close_job()
                if process.stderr:
                    process.stderr.close()
            finished.set()
    try:
        threading.Thread(target=launch, daemon=True).start()
    except Exception:
        if read_fd is not None:
            os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)
        raise
    try:
        completed = finished.wait(max(0, timeout))
        with lock:
            process = outcome.get('process')
            if not completed:
                outcome['cancelled'] = True
                close_job = outcome.get('close_job')
                failure = TimeoutError('服务端监督进程启动超时，迟到进程将被终止')
            else:
                failure = None
            if process is None:
                outcome['cancelled'] = True
                if 'error' in outcome:
                    raise outcome['error']
                raise TimeoutError('服务端监督进程启动超时，迟到进程将被终止')
            close_job = outcome['close_job']
        if failure:
            stop_process(process, group=True)
            if close_job:
                close_job()
            if process.stderr:
                process.stderr.close()
            raise failure
        try:
            if write_fd is not None:
                os.write(write_fd, b'1')
        except Exception:
            stop_process(process, group=True)
            if close_job:
                close_job()
            if process.stderr:
                process.stderr.close()
            raise
        return process, close_job
    finally:
        if write_fd is not None:
            os.close(write_fd)


def supervise(arguments, timeout, phase, mount_session=False, worker_command=None):
    """Keep every filesystem operation in a killable, deadline-bound worker.

    A mounted session may stay active indefinitely. Preparation, ismount,
    scandir, probe open/fsync and teardown all run inside timed phases. The
    supervisor itself never probes the mounted filesystem.
    """
    deadline = time.monotonic() + timeout
    command = worker_command or [sys.executable, str(Path(__file__).resolve()), *arguments, '--internal-worker']
    session = arguments[arguments.index('--session') + 1] if '--session' in arguments else '-'
    try:
        process, close_job = start_supervised_process(
            command, min(PROCESS_START_TIMEOUT, max(0, deadline - time.monotonic())),
            gate=worker_command is None)
    except Exception as exc:
        if '--self-test' not in arguments:
            log_supervisor_failure(session, 'process_start')
        emit('ERROR', {'message': '服务端启动失败：' + str(exc)})
        return 1
    events = queue.Queue()
    def read_errors():
        try:
            for line in iter(process.stderr.readline, b''):
                events.put(line)
        finally:
            process.stderr.close()
            events.put(None)
    threading.Thread(target=read_errors, daemon=True).start()
    current = phase
    stopping = False
    seen_stages = {phase}
    exited_at = None
    stderr_finished = False
    interrupted = threading.Event()
    previous = {}
    def signal_stop(signum, frame):
        interrupted.set()
    for name in ('SIGTERM', 'SIGHUP', 'SIGINT'):
        signum = getattr(signal, name, None)
        if signum is not None:
            previous[signum] = signal.signal(signum, signal_stop)
    try:
        while True:
            if interrupted.is_set() and not stopping:
                stopping = True
                current = 'cleanup'
                deadline = time.monotonic() + STAGE_TIMEOUTS['cleanup']
                try:
                    process.terminate()
                except OSError:
                    pass
            try:
                line = events.get(timeout=.05)
            except queue.Empty:
                line = b''
            if line is None:
                stderr_finished = True
            if line and line.startswith(b'CODEBRIDGE_INTERNAL_STAGE '):
                name = line.decode('ascii', 'replace').strip().split(' ', 1)[1]
                if mount_session and name in STAGE_TIMEOUTS and name not in seen_stages and not stopping:
                    seen_stages.add(name)
                    current = name
                    limit = STAGE_TIMEOUTS[name]
                    deadline = None if limit is None else time.monotonic() + limit
            elif line:
                sys.stderr.buffer.write(line)
                sys.stderr.buffer.flush()
            if process.poll() is not None:
                if exited_at is None:
                    exited_at = time.monotonic()
                if events.empty() and (stderr_finished or time.monotonic() - exited_at >= .2):
                    return process.returncode
            if deadline is not None and time.monotonic() >= deadline:
                stopped = stop_process(process, group=True)
                message = f'服务端阶段 {current} 超时，已停止本次操作'
                if not stopped:
                    message += '；进程尚未退出，请检查不可中断的文件系统或挂载'
                if '--self-test' not in arguments:
                    log_supervisor_failure(session, current)
                emit('ERROR', {'message': message})
                return 1
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
        if os.name != 'nt' or process.poll() is None:
            stop_process(process, group=True)
        if close_job:
            close_job()


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
    result = bounded_process([binary, '-h'], 10, 'SSHFS 被动模式检查')
    help_text = (result.stdout + result.stderr).decode('utf-8', 'replace')
    if 'passive' in help_text:
        return 'passive'
    if 'slave' in help_text:
        return 'slave'
    raise RuntimeError('此 SSHFS 构建未声明 passive/slave 支持；不会使用假挂载或不安全回退')


def mount_lock(name, exclusive=True, wait=False, timeout=None):
    import fcntl
    base = Path.home() / '.codebridge'
    base.mkdir(mode=0o700, exist_ok=True)
    if base.is_symlink() or base.stat().st_uid != os.getuid() or base.stat().st_mode & 0o077:
        raise RuntimeError('挂载状态目录必须归当前用户所有且权限为 0700')
    fd = os.open(base / name, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    file = os.fdopen(fd, 'r+', encoding='utf-8')
    try:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise RuntimeError('挂载状态文件无效')
        flags = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
        deadline = time.monotonic() + (LOCK_TIMEOUT if timeout is None else timeout)
        while True:
            try:
                fcntl.flock(file.fileno(), flags | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not wait:
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError('远端挂载访问锁超时，请检查未完成的目录操作') from None
                time.sleep(min(.05, max(0, deadline - time.monotonic())))
    except BlockingIOError:
        file.close()
        raise RuntimeError('已有连接正在使用远端挂载目录，请先断开原连接') from None
    except Exception:
        file.close()
        raise
    return file


def mount_access(exclusive=False):
    # A probe holds shared access; mount/unmount holds exclusive access.
    return nullcontext() if os.name == 'nt' else mount_lock('mount-access.lock', exclusive, wait=True)


def server_directory():
    config = Path.home() / '.codebridge' / 'server.json'
    try:
        fd = os.open(config, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        with os.fdopen(fd, 'r', encoding='utf-8') as file:
            info = os.fstat(file.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                raise ValueError('invalid configuration file')
            data = json.loads(file.read(4097))
        if (not isinstance(data, dict) or set(data) != {'mount_directory'} or
                not isinstance(data['mount_directory'], str) or
                not re.fullmatch('[a-z]{5}', data['mount_directory'])):
            raise ValueError('invalid mount directory name')
    except (OSError, ValueError, UnicodeError):
        raise RuntimeError('服务端配置无法读取或无效') from None
    return Path.home() / data['mount_directory']


def checked_directory(path, require_empty=True, allow_mounted=False):
    for part in (path, *path.parents):
        if part.is_symlink():
            raise RuntimeError('远端挂载目录及其父目录不能是符号链接')
    path = path.resolve()
    if os.path.ismount(path):
        if allow_mounted:
            return path
        raise RuntimeError('远端目录已被挂载，请先断开原连接或处理遗留挂载')
    path.mkdir(mode=0o700, exist_ok=True)
    if path.stat().st_uid != os.getuid():
        raise RuntimeError('远端挂载目录必须归当前用户所有')
    if require_empty:
        with os.scandir(path) as entries:
            if next(entries, None) is not None:
                raise RuntimeError('远端挂载目录不是空目录，已拒绝遮盖已有文件')
    return path


def initialize_server():
    with mount_lock('server-config.lock', wait=True):
        config = Path.home() / '.codebridge' / 'server.json'
        if config.exists() or config.is_symlink():
            try:
                server_directory()
            except RuntimeError:
                backup = config.with_name('server.corrupt-' + secrets.token_hex(8) + '.json')
                config.rename(backup)
                emit('WARNING', {'message': '服务端配置损坏，已保留副本：' + str(backup) +
                                 '；正在重新生成五字母挂载目录和配置，旧目录不会删除。'})
        if not config.exists() and not config.is_symlink():
            for _ in range(100):
                name = ''.join(secrets.choice(string.ascii_lowercase) for _ in range(5))
                path = Path.home() / name
                try:
                    path.mkdir(mode=0o700)
                except FileExistsError:
                    continue
                break
            else:
                raise RuntimeError('无法分配空闲的五字母目录，请检查用户目录')
            # Exclusive creation never overwrites an existing configuration.
            fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as file:
                json.dump({'mount_directory': name}, file, indent=2)
                file.write('\n')
                file.flush()
                os.fsync(file.fileno())
        return checked_directory(server_directory(), require_empty=False, allow_mounted=True)


def mountpoint(session, mount_path=''):
    if os.name == 'nt':
        if mount_path:
            raise RuntimeError('Windows 远端暂只支持自动盘符，请留空远端挂载目录')
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for index in range(25, 3, -1):
            if not mask & (1 << index):
                return chr(65 + index) + ':'
        raise RuntimeError('没有可用盘符')
    path = initialize_server()
    if mount_path:
        if any(ord(char) < 32 for char in mount_path):
            raise RuntimeError('远端挂载目录不能包含控制字符')
        path = Path(mount_path).expanduser()
        if not path.is_absolute():
            raise RuntimeError('远端挂载目录须为绝对路径或 ~/目录')
    return str(checked_directory(path))


def is_mounted(path):
    return os.path.ismount(path + '\\' if os.name == 'nt' else path)


def unmount(path):
    if os.name == 'nt':
        # Foreground sshfs termination releases the WinFsp filesystem.
        return
    if not is_mounted(path):
        return
    command = (['/sbin/umount', path] if sys.platform == 'darwin' else
               [shutil.which('fusermount3') or shutil.which('fusermount') or 'fusermount', '-u', path])
    result = bounded_process(command, 10, '远端卸载')
    if result.returncode:
        raise RuntimeError('远端正常卸载失败，请检查繁忙挂载；未执行强制卸载')


def windows_session_file(session):
    return Path.home() / '.codebridge' / 'sessions' / (session + '.json')


def existing_mount(session, drive=None):
    if os.name == 'nt':
        try:
            record = json.loads(windows_session_file(session).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise RuntimeError('挂载会话记录不存在或无效') from None
        if (not isinstance(record, dict) or record.get('session') != session or
                not re.fullmatch('[D-Z]:', record.get('mount', ''))):
            raise RuntimeError('挂载会话已改变，已拒绝访问其他连接')
        if drive and drive != record['mount'][0]:
            raise RuntimeError('挂载会话盘符不匹配')
        path = record['mount'] + '\\'
    else:
        # Keep in-flight mounts from older clients usable during an adapter update.
        legacy = Path.home() / '.codebridge' / 'mounts' / session
        if os.path.ismount(legacy):
            return str(legacy)
        try:
            active = json.loads((Path.home() / '.codebridge' / 'mount-session.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise RuntimeError('挂载会话记录不存在或无效') from None
        if (not isinstance(active, dict) or active.get('session') != session or
                not isinstance(active.get('mount'), str) or not Path(active['mount']).is_absolute()):
            raise RuntimeError('挂载会话已改变，已拒绝访问其他连接')
        path = active['mount']
    if not os.path.ismount(path):
        raise RuntimeError('操作系统未报告该目录为挂载点')
    return path


def operation_worker(session, operation, probe=None, drive=None):
    with mount_access():
        return checked_operation(session, operation, probe, drive)


def checked_operation(session, operation, probe=None, drive=None):
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
    if operation == 'rw':
        begin_verification(session, probe, drive)
    args = [sys.executable, str(Path(__file__).resolve()), '--session', session,
            '--operation-worker', operation, '--internal-worker']
    if probe:
        args += ['--probe', probe]
    if drive:
        args += ['--drive', drive]
    completed = bounded_process(args, OPERATION_TIMEOUT, '远端目录读取' if operation == 'list' else '第6步远端读写验证')
    if completed.returncode:
        try:
            detail = json.loads(completed.stderr.decode('utf-8', 'replace').splitlines()[-1]).get('error')
        except (ValueError, IndexError, AttributeError):
            detail = None
        raise RuntimeError(detail or '远端目录操作失败或权限不足')
    return json.loads(completed.stdout)


def update_session_record(session, update):
    # Callers hold mount_access exclusively. Keep the existing inode because
    # the long-lived mount owner holds its session lock on that same file.
    record_path = (windows_session_file(session) if os.name == 'nt' else
                   Path.home() / '.codebridge' / 'mount-session.json')
    fd = os.open(record_path, os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'r+', encoding='utf-8') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or (os.name != 'nt' and info.st_uid != os.getuid()):
            raise RuntimeError('挂载会话记录无效')
        record = json.loads(file.read(4097))
        if not isinstance(record, dict) or record.get('session') != session:
            raise RuntimeError('挂载会话已改变，已拒绝确认其他连接')
        if not update(record):
            return
        file.seek(0)
        json.dump(record, file)
        file.truncate()
        file.flush()
        os.fsync(file.fileno())


def begin_verification(session, probe, drive=None):
    if not probe or not re.fullmatch('[a-f0-9]{32}', probe):
        raise RuntimeError('验证标识无效')
    def begin(record):
        if record.get('verification_probe') == probe:
            return False
        record['verification_probe'] = probe
        record.pop('connection_result', None)
        return True
    with mount_access(exclusive=True):
        existing_mount(session, drive)
        update_session_record(session, begin)


def connection_result(session, result, reason=None, drive=None, probe=None):
    # Only the client can observe local writeback and local probe deletion.
    # This acknowledgement must therefore be a separate authenticated request.
    if result not in ('success', 'error') or (reason is not None and reason not in RESULT_REASONS):
        raise RuntimeError('连接结果或失败原因无效')
    if not probe or not re.fullmatch('[a-f0-9]{32}', probe):
        raise RuntimeError('验证标识无效')
    def confirm(record):
        if record.get('verification_probe') != probe:
            if result == 'error':
                LOGGER.error('session=%s probe=%s 读写验证运行结束 result=error reason=%s；本轮未登记或已过期，未更新当前会话结果',
                             session, probe, reason or 'internal')
            raise RuntimeError('读写验证已改变，已拒绝过期验证结果')
        record['connection_result'] = result
        return True
    with mount_access(exclusive=True):
        existing_mount(session, drive)
        update_session_record(session, confirm)
        if result == 'success':
            LOGGER.info('session=%s 第6步 客户端确认本地写回和临时文件清理成功', session)
            LOGGER.info('session=%s 连接流程运行结束 result=success steps=6/6', session)
        else:
            LOGGER.error('session=%s 连接流程运行结束 result=error reason=%s', session, reason or 'internal')
        if any(getattr(handler, 'last_error', None) for handler in LOGGER.handlers):
            raise RuntimeError('连接结果日志写入失败，请检查服务端日志目录')
    return {'ok': True, 'session': session, 'result': result}


def run(session, mount_path=''):
    process = None
    path = None
    owner = None
    reserved = False
    windows_record = None
    ready = False
    try:
        stage('prepare', session)
        LOGGER.info('session=%s 步骤1-3由客户端建立SSH并完成身份认证；服务端helper现在开始工作', session)
        LOGGER.info('session=%s 第4步 开始检查依赖和挂载目录', session)
        binary = executable()
        option = passive_option(binary)
        if sys.platform.startswith('linux') and not os.path.exists('/dev/fuse'):
            raise RuntimeError('远端缺少 /dev/fuse，不能挂载；请在允许 FUSE 的真实主机部署')
        if os.name != 'nt':
            owner = mount_lock('mount-session.json')
        with mount_access(exclusive=True) if owner else nullcontext():
            path = mountpoint(session, mount_path)
            if owner:
                owner.seek(0)
                json.dump({'session': session, 'mount': path}, owner)
                owner.truncate()
                owner.flush()
                os.fsync(owner.fileno())
                reserved = True
            else:
                windows_record = windows_session_file(session)
                for directory in (windows_record.parent.parent, windows_record.parent):
                    if directory.is_symlink():
                        raise RuntimeError('挂载会话目录不能是符号链接')
                    directory.mkdir(mode=0o700, exist_ok=True)
                with windows_record.open('x', encoding='utf-8') as file:
                    json.dump({'session': session, 'mount': path}, file)
                    file.flush()
                    os.fsync(file.fileno())
        command = [binary, ':/', path, '-f', '-o', option,
                   '-o', 'cache=no', '-o', 'attr_timeout=0', '-o', 'entry_timeout=0',
                   '-o', 'negative_timeout=0']
        # Windows OpenSSH pipes must never undergo CRT newline translation.
        if os.name == 'nt':
            import msvcrt
            msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
            msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
        stage('mount', session)
        LOGGER.info('session=%s 第4步 SSHFS标准流通道启动；第5步等待真实挂载', session)
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
        stage('readable', session)
        LOGGER.info('session=%s 第5步 操作系统已确认挂载，开始目录读取', session)
        bounded_operation(session, 'list', drive=path[0] if os.name == 'nt' else None)
        emit('READY', {'session': session, 'mount': path, 'readable': True})
        ready = True
        LOGGER.info('session=%s 第5步完成：挂载目录可读；等待第6步读写验证', session)
        stage('active', session)
        return process.wait()
    except KeyboardInterrupt:
        if not ready:
            LOGGER.error('session=%s 连接流程运行结束 result=error reason=disconnected', session)
        return 130
    except Exception as exc:
        LOGGER.error('session=%s 连接流程运行结束 result=error reason=%s', session, str(exc))
        emit('ERROR', {'message': str(exc)})
        return 1
    finally:
        stage('cleanup', session)
        try:
            with mount_access(exclusive=True) if owner else nullcontext():
                if path:
                    try:
                        unmount(path)
                    except Exception as exc:
                        LOGGER.error('session=%s 远端卸载失败或超时：%s', session, str(exc))
                        emit('WARNING', {'message': str(exc)})
                if process and process.poll() is None:
                    if not stop_process(process, grace=2, kill_grace=1):
                        LOGGER.error('session=%s SSHFS终止超时，需检查挂载状态', session)
                if owner and reserved:
                    if ready:
                        owner.seek(0)
                        record = json.load(owner)
                        if not record.get('connection_result'):
                            LOGGER.error('session=%s 连接流程运行结束 result=error reason=disconnected；未收到客户端第6步完成确认', session)
                    owner.seek(0)
                    owner.truncate()
                    owner.flush()
                    os.fsync(owner.fileno())
                if windows_record is not None:
                    if ready:
                        record = json.loads(windows_record.read_text(encoding='utf-8'))
                        if not record.get('connection_result'):
                            LOGGER.error('session=%s 连接流程运行结束 result=error reason=disconnected；未收到客户端第6步完成确认', session)
                    windows_record.unlink(missing_ok=True)
                # Keep the configured, empty directory for the next connection.
        except Exception as exc:
            LOGGER.error('session=%s 清理失败或超时：%s', session, str(exc))
            LOGGER.error('session=%s 连接流程运行结束 result=error reason=cleanup', session)
            emit('WARNING', {'message': '远端清理失败或超时：' + str(exc)})
            if process and process.poll() is None:
                stop_process(process, grace=2, kill_grace=1)
        finally:
            if owner:
                owner.close()
            LOGGER.info('session=%s 挂载会话运行结束 ready=%s', session, ready)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--session')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--initialize', action='store_true')
    parser.add_argument('--mount-path', default='')
    parser.add_argument('--verify-readwrite', action='store_true')
    parser.add_argument('--operation-worker', choices=('list', 'rw'))
    parser.add_argument('--probe')
    parser.add_argument('--drive')
    parser.add_argument('--connection-result', choices=('success', 'error'))
    parser.add_argument('--reason', choices=RESULT_REASONS)
    parser.add_argument('--internal-worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--start-gate', type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.start_gate is not None:
        descriptor = args.start_gate
        if os.name == 'nt':
            import msvcrt
            descriptor = msvcrt.open_osfhandle(descriptor, os.O_RDONLY)
        try:
            if os.read(descriptor, 1) != b'1':
                return 1
        finally:
            os.close(descriptor)
    if args.internal_worker and not args.self_test:
        try:
            configure_logging(Path(__file__).resolve().parent, 'codebridge.server')
        except Exception as exc:
            emit('ERROR', {'message': '服务端日志初始化失败：' + str(exc)})
            return 1
    if not args.internal_worker:
        if args.self_test:
            return supervise(sys.argv[1:], 12, '依赖检查')
        if args.initialize:
            return supervise(sys.argv[1:], 12, '服务端初始化')
        if args.connection_result:
            return supervise(sys.argv[1:], RESULT_TIMEOUT, '第6步客户端结果确认')
        if args.verify_readwrite or args.operation_worker:
            return supervise(sys.argv[1:], OPERATION_TIMEOUT, '第6步远端读写验证' if args.verify_readwrite else '远端目录操作')
        return supervise(sys.argv[1:], STAGE_TIMEOUTS['prepare'], 'prepare', mount_session=True)
    if args.initialize:
        try:
            if os.name == 'nt':
                raise RuntimeError('目录挂载初始化适用于 Linux/macOS；Windows 仍使用空闲盘符')
            path = initialize_server()
            print(json.dumps({'mount': str(path), 'config': str(Path.home() / '.codebridge' / 'server.json')}))
            return 0
        except Exception as exc:
            print(str(exc), file=sys.stderr)
            return 1
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
    if args.connection_result:
        try:
            result = connection_result(args.session, args.connection_result, args.reason, args.drive, args.probe)
            print(json.dumps(result), flush=True)
            return 0
        except Exception as exc:
            LOGGER.error('session=%s 客户端结果确认失败：%s', args.session, str(exc))
            print(json.dumps({'ok': False, 'error': str(exc)}), file=sys.stderr, flush=True)
            return 1
    if args.verify_readwrite or args.operation_worker:
        try:
            if args.verify_readwrite:
                LOGGER.info('session=%s 第6步开始：通过挂载读取并写入本次临时验证文件', args.session)
            if args.operation_worker:
                result = operation_worker(args.session, args.operation_worker, args.probe, args.drive)
            else:
                result = bounded_operation(args.session, 'rw', args.probe, args.drive)
                LOGGER.info('session=%s 第6步远端读写子阶段结束 result=success；等待客户端本地写回与清理确认', args.session)
            print(json.dumps(result), flush=True)
            return 0
        except Exception as exc:
            LOGGER.error('session=%s 第6步远端读写子阶段结束 result=error reason=%s', args.session, str(exc))
            print(json.dumps({'ok': False, 'error': str(exc)}), file=sys.stderr, flush=True)
            return 1
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    for name in ('SIGTERM', 'SIGHUP'):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), interrupted)
    return run(args.session, args.mount_path)

if __name__ == '__main__':
    sys.exit(main())
