"""Deadlines for operations that must never hold the control plane indefinitely."""
import os
import signal
import subprocess
import threading
import time


class OperationTimeout(TimeoutError):
    pass


def background(function):
    def run():
        try:
            function()
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()


def bounded_call(function, timeout, label, cancel=None, late_cleanup=None):
    """Bound a network call; reclaim a socket/channel that arrives after timeout.

    Filesystem mutations use killable subprocesses instead of this helper.
    """
    if cancel is not None and cancel.is_set():
        raise OperationTimeout(label + '已取消')
    if timeout <= 0:
        raise OperationTimeout(label + '超时，已停止等待')
    done = threading.Event()
    abandoned = threading.Event()
    lock = threading.Lock()
    result = []

    def run():
        try:
            value = function()
        except Exception as exc:
            with lock:
                result.append((False, exc))
                done.set()
        else:
            with lock:
                if abandoned.is_set():
                    if late_cleanup:
                        background(lambda: late_cleanup(value))
                else:
                    result.append((True, value))
                done.set()

    threading.Thread(target=run, daemon=True).start()
    expires = time.monotonic() + max(0, timeout)
    while True:
        remaining = expires - time.monotonic()
        if (cancel is not None and cancel.is_set()) or remaining <= 0:
            with lock:
                abandoned.set()
                if result and result[0][0] and late_cleanup:
                    background(lambda: late_cleanup(result[0][1]))
            if cancel is not None and cancel.is_set():
                raise OperationTimeout(label + '已取消')
            raise OperationTimeout(label + '超时，已停止等待')
        if done.wait(min(remaining, .05)):
            success, value = result[0]
            if success:
                return value
            raise value


def bounded_process(args, timeout, label, input=None, cancel=None, **kwargs):
    """Bound creation and all pipe I/O, including Windows' blocking stdin write."""
    expires = time.monotonic() + timeout
    kwargs.setdefault('start_new_session', os.name != 'nt')
    def kill(child):
        try:
            if os.name != 'nt' and kwargs['start_new_session']:
                os.killpg(child.pid, signal.SIGKILL)
            else:
                child.kill()
        except OSError:
            pass
    def reap(child):
        # Only used when no other communicator has started on this child.
        try:
            child.communicate()
        except (OSError, ValueError):
            pass
    def kill_and_reap(child):
        kill(child)
        reap(child)
    process = bounded_call(
        lambda: subprocess.Popen(args, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs),
        timeout, label, cancel, late_cleanup=kill_and_reap)
    completed = False
    communicating = False
    done = threading.Event()
    result = []

    def communicate():
        try:
            result.append((True, process.communicate(input=input)))
        except Exception as exc:
            result.append((False, exc))
        finally:
            done.set()

    try:
        # Windows communicate(timeout=...) can block in _stdin_write before
        # reaching its timed waits. A separate watchdog owns the full deadline.
        # This single communicator also drains and reaps after timeout kills;
        # never start a second communicate call concurrently on the same pipes.
        while True:
            if cancel is not None and cancel.is_set():
                raise OperationTimeout(label + '已取消')
            remaining = expires - time.monotonic()
            if remaining <= 0:
                raise OperationTimeout(label + '超时，已停止等待')
            if not communicating:
                threading.Thread(target=communicate, daemon=True).start()
                communicating = True
            if done.wait(min(remaining, .05)):
                success, value = result[0]
                if not success:
                    raise value
                stdout, stderr = value
                completed = True
                return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
    finally:
        if not completed:
            kill(process)
            if not communicating:
                background(lambda: reap(process))


class Deadline:
    def __init__(self, seconds):
        self.expires = time.monotonic() + seconds

    def remaining(self, maximum=None):
        value = self.expires - time.monotonic()
        if value <= 0:
            raise OperationTimeout('读写验证总时限已到，已停止等待')
        return min(value, maximum) if maximum is not None else value
