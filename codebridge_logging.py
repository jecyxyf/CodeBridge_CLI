"""File-only, daily logs shared by the client and remote helper.

Callers provide their program directory explicitly; the current working directory
and the Python interpreter location do not determine where logs are stored.
"""

import csv
import copy
from datetime import date, datetime, timedelta
import io
import logging
import os
from pathlib import Path
import queue
import re
import stat
import threading
import time


_DATE_FILE = re.compile(r"\d{4}-\d{2}-\d{2}\.log\Z", re.ASCII)
_CONFIG_LOCK = threading.RLock()
_ASYNC_QUEUE_SIZE = 1024


class _CSVFormatter(logging.Formatter):
    def format(self, record):
        message = record.getMessage()
        if record.exc_info:
            message += "\n" + self.formatException(record.exc_info)
        if record.stack_info:
            message += "\n" + self.formatStack(record.stack_info)
        # A record always occupies one physical line, even with a traceback.
        message = message.replace("\r", "\\r").replace("\n", "\\n")
        timestamp = datetime.fromtimestamp(record.created).isoformat(
            sep=" ", timespec="milliseconds"
        )
        level = "WARN" if record.levelno == logging.WARNING else record.levelname
        output = io.StringIO(newline="")
        csv.writer(output, lineterminator="\n").writerow((timestamp, level, message))
        return output.getvalue()


class _DailyFileHandler(logging.Handler):
    def __init__(self, program_dir):
        super().__init__(logging.DEBUG)
        self.directory = Path(program_dir).resolve() / "logs"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.setFormatter(_CSVFormatter())
        self.last_error = None
        self._cleaned_date = None
        today = datetime.now().date()
        self._prune(today)
        # Fail explicitly during setup if today's log cannot be opened.
        descriptor = self._open(today)
        os.close(descriptor)

    def _open(self, day):
        path = self.directory / f"{day.isoformat()}.log"
        try:
            if not stat.S_ISREG(path.lstat().st_mode):
                raise OSError("日志路径必须是普通文件")
        except FileNotFoundError:
            pass
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
        return os.open(path, flags, 0o600)

    def _prune(self, today):
        if self._cleaned_date == today:
            return
        oldest = today - timedelta(days=89)
        for path in self.directory.iterdir():
            if not _DATE_FILE.fullmatch(path.name):
                continue
            try:
                day = date.fromisoformat(path.stem)
            except ValueError:
                continue
            if day >= oldest:
                continue
            try:
                # lstat also excludes links to ordinary files or directories.
                if stat.S_ISREG(path.lstat().st_mode):
                    path.unlink()
            except FileNotFoundError:
                # Another helper may have already removed the same old file.
                pass
        self._cleaned_date = today

    def emit(self, record):
        try:
            day = datetime.fromtimestamp(record.created).date()
            self._prune(datetime.now().date())
            row = self.format(record).encode("utf-8", errors="backslashreplace")
            descriptor = self._open(day)
            try:
                # One append syscall per complete row. Processes never rename
                # or rotate a shared open file when the local date changes.
                if os.write(descriptor, row) != len(row):
                    raise OSError("日志写入不完整")
            finally:
                os.close(descriptor)
            self.last_error = None
        except Exception as exc:
            # logging.Handler.handleError writes to stderr by default, which
            # would corrupt the remote helper's status protocol.
            self.last_error = exc


class _AsyncFileHandler(logging.Handler):
    """A bounded queue keeps client log disk I/O away from control threads."""
    def __init__(self, sink):
        super().__init__(logging.DEBUG)
        self.sink = sink
        self.directory = sink.directory
        self._queue = queue.Queue(maxsize=_ASYNC_QUEUE_SIZE)
        self._condition = threading.Condition()
        self._submitted = 0
        self._completed = 0
        self._error = None
        self._stopping = threading.Event()
        self._writer = threading.Thread(target=self._write, daemon=True,
                                        name="codebridge-log-writer")
        self._writer.start()

    @property
    def last_error(self):
        return self._error or self.sink.last_error

    def emit(self, record):
        try:
            prepared = copy.copy(record)
            prepared.msg = record.getMessage()
            prepared.args = ()
            with self._condition:
                if self._stopping.is_set():
                    self._error = RuntimeError("日志写入器已关闭")
                    return
                self._queue.put_nowait(prepared)
                self._submitted += 1
        except queue.Full:
            self._error = BufferError("日志队列已满，部分日志未能写入")
        except Exception as exc:
            self._error = exc

    def _write(self):
        try:
            while not self._stopping.is_set() or not self._queue.empty():
                try:
                    record = self._queue.get(timeout=.1)
                except queue.Empty:
                    continue
                try:
                    # Do not acquire the sink's Handler lock: logging.shutdown
                    # must remain able to close it even if a disk write stalls.
                    self.sink.emit(record)
                except Exception as exc:
                    self._error = exc
                finally:
                    with self._condition:
                        self._completed += 1
                        self._condition.notify_all()
                    self._queue.task_done()
        finally:
            self.sink.close()

    def flush(self, timeout=1.0):
        deadline = time.monotonic() + max(0, timeout)
        with self._condition:
            target = self._submitted
            while self._completed < target:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    if self._error is None:
                        self._error = TimeoutError("日志写入超时，已停止等待")
                    return False
                self._condition.wait(remaining)
            if isinstance(self._error, TimeoutError):
                self._error = None
            return self.last_error is None

    def close(self):
        # close() is also called by logging.shutdown; never join a disk worker.
        with self._condition:
            self._stopping.set()
        self.flush(timeout=.1)
        super().close()


def get_logger(name):
    """Return a DEBUG logger that never propagates to console/root handlers."""
    with _CONFIG_LOCK:
        logger = logging.getLogger(name)
        logger.setLevel(logging.DEBUG)
        logger.propagate = False
        if not logger.handlers:
            # Prevent logging.lastResort from writing unconfigured errors.
            logger.addHandler(logging.NullHandler())
        return logger


def configure_logging(program_dir, name, asynchronous=False):
    """Configure ``program_dir/logs/YYYY-MM-DD.log`` and return the logger.

    Use ``asynchronous=True`` for the client's control threads. The default is
    synchronous for server helpers whose outer supervisor bounds file I/O.
    Repeated calls for the same directory and mode reuse the handler. Setup
    errors are raised; later errors stay on ``handler.last_error`` and never
    write to stdout/stderr. Asynchronous queues are bounded and never block.
    """
    with _CONFIG_LOCK:
        logger = get_logger(name)
        directory = Path(program_dir).resolve() / "logs"
        handler_type = _AsyncFileHandler if asynchronous else _DailyFileHandler
        for handler in logger.handlers:
            if (isinstance(handler, handler_type) and handler.directory == directory and
                    not handler._closed):
                return logger
        handler = _DailyFileHandler(program_dir)
        if asynchronous:
            handler = _AsyncFileHandler(handler)
        for previous in list(logger.handlers):
            logger.removeHandler(previous)
            previous.close()
        logger.addHandler(handler)
        return logger


def flush_logging(logger, timeout=1.0):
    """Drain queued records within a total timeout; report I/O/queue errors.

    A False result means at least one record has not finished writing or an
    error was observed. It never waits indefinitely for a stalled log disk.
    """
    deadline = time.monotonic() + max(0, timeout)
    complete = True
    for handler in list(logger.handlers):
        if isinstance(handler, _AsyncFileHandler):
            complete = handler.flush(max(0, deadline - time.monotonic())) and complete
        elif isinstance(handler, _DailyFileHandler):
            complete = handler.last_error is None and complete
    return complete
