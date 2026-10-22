import contextlib
import csv
from datetime import datetime, timedelta
import io
import logging
import multiprocessing
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock
import uuid
import weakref

import codebridge_logging


def _write_process_logs(directory, process_number):
    logger = codebridge_logging.configure_logging(directory, f"process-{process_number}")
    for number in range(100):
        logger.info("进程 %s,记录 %s", process_number, number)


class LoggingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.name = "logging-test-" + uuid.uuid4().hex
        self.addCleanup(self.close_logger)

    def close_logger(self):
        logger = logging.getLogger(self.name)
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()

    def rows(self, day=None):
        day = day or datetime.now().date()
        path = self.directory / "logs" / f"{day.isoformat()}.log"
        with path.open(encoding="utf-8", newline="") as stream:
            return list(csv.reader(stream))

    def test_levels_csv_and_single_physical_line(self):
        logger = codebridge_logging.configure_logging(self.directory, self.name)
        logger.debug("调试")
        logger.info('内容,包含"引号"\n和换行\r回车')
        logger.warning("警告")
        logger.error("错误")
        rows = self.rows()
        self.assertEqual([row[1] for row in rows], ["DEBUG", "INFO", "WARN", "ERROR"])
        self.assertEqual(rows[1][2], '内容,包含"引号"\\n和换行\\r回车')
        self.assertTrue(all(len(row) == 3 for row in rows))
        self.assertRegex(rows[0][0], r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$")
        path = next((self.directory / "logs").glob("*.log"))
        self.assertEqual(len(path.read_text().splitlines()), 4)

    def test_traceback_is_part_of_one_record(self):
        logger = codebridge_logging.configure_logging(self.directory, self.name)
        try:
            raise ValueError("失败\n详情")
        except ValueError:
            logger.exception("操作失败")
        self.assertEqual(len(self.rows()), 1)
        self.assertIn("ValueError: 失败\\n详情", self.rows()[0][2])

    def test_date_change_writes_new_file_without_renaming_previous(self):
        logger = codebridge_logging.configure_logging(self.directory, self.name)
        today = datetime.now().replace(hour=23, minute=59, second=59, microsecond=0)
        tomorrow = today + timedelta(seconds=2)
        for instant, message in ((today, "午夜前"), (tomorrow, "午夜后")):
            record = logger.makeRecord(self.name, logging.INFO, __file__, 0, message, (), None)
            record.created = instant.timestamp()
            logger.handle(record)
        self.assertEqual(self.rows(today.date())[0][2], "午夜前")
        self.assertEqual(self.rows(tomorrow.date())[0][2], "午夜后")

    def test_retention_keeps_90_dates_and_unrelated_files(self):
        directory = self.directory / "logs"
        directory.mkdir()
        today = datetime.now().date()
        for age in range(92):
            (directory / f"{today - timedelta(days=age)}.log").write_text("old\n")
        preserved = ["2020-1-01.log", "2020-99-99.log", "notes.log", "2000-01-01.log.bak"]
        for name in preserved:
            (directory / name).write_text("preserve")
        (directory / "2000-01-02.log").mkdir()
        target = self.directory / "target"
        target.write_text("preserve target")
        if os.name != "nt":
            (directory / "2000-01-03.log").symlink_to(target)
        codebridge_logging.configure_logging(self.directory, self.name)
        self.assertTrue((directory / f"{today - timedelta(days=89)}.log").exists())
        self.assertFalse((directory / f"{today - timedelta(days=90)}.log").exists())
        self.assertFalse((directory / f"{today - timedelta(days=91)}.log").exists())
        self.assertTrue(all((directory / name).exists() for name in preserved))
        self.assertTrue((directory / "2000-01-02.log").is_dir())
        if os.name != "nt":
            self.assertTrue((directory / "2000-01-03.log").is_symlink())
        self.assertEqual(target.read_text(), "preserve target")

    def test_retention_runs_again_after_midnight(self):
        today = datetime.now().date()
        logger = codebridge_logging.configure_logging(self.directory, self.name)
        expires = self.directory / "logs" / f"{today - timedelta(days=89)}.log"
        expires.write_text("old")
        next_day = datetime.now() + timedelta(days=1)
        with mock.patch.object(codebridge_logging, "datetime", wraps=datetime) as clock:
            clock.now.return_value = next_day
            logger.info("新一天")
        self.assertFalse(expires.exists())

    def test_repeated_configuration_does_not_duplicate_rows(self):
        first = codebridge_logging.configure_logging(self.directory, self.name)
        second = codebridge_logging.configure_logging(self.directory, self.name)
        self.assertIs(first, second)
        first.info("仅一行")
        self.assertEqual(len(self.rows()), 1)

    def test_reconfiguration_moves_output_to_new_program_directory(self):
        logger = codebridge_logging.configure_logging(self.directory, self.name)
        logger.info("原目录")
        other = self.directory / "new-program"
        self.assertIs(logger, codebridge_logging.configure_logging(other, self.name))
        logger.info("新目录")
        self.assertEqual(len(self.rows()), 1)
        path = other / "logs" / f"{datetime.now().date()}.log"
        self.assertIn("新目录", path.read_text())

    def test_no_console_output_before_configuration_or_on_write_failure(self):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            logger = codebridge_logging.get_logger(self.name)
            logger.error("尚未配置")
            logger = codebridge_logging.configure_logging(self.directory, self.name)
            with mock.patch.object(codebridge_logging.os, "write", side_effect=OSError("disk full")):
                logger.error("写入失败")
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(errors.getvalue(), "")
        self.assertIsInstance(logger.handlers[0].last_error, OSError)

    def test_setup_failure_is_reported(self):
        (self.directory / "logs").write_text("occupied")
        with self.assertRaises(OSError):
            codebridge_logging.configure_logging(self.directory, self.name)

    @unittest.skipIf(os.name == "nt", "symlinks require Windows privileges")
    def test_existing_log_symlink_is_never_followed(self):
        directory = self.directory / "logs"
        directory.mkdir()
        target = self.directory / "target"
        target.write_text("unchanged")
        (directory / f"{datetime.now().date()}.log").symlink_to(target)
        with self.assertRaises(OSError):
            codebridge_logging.configure_logging(self.directory, self.name)
        self.assertEqual(target.read_text(), "unchanged")

    def test_multiple_processes_append_complete_records(self):
        context = multiprocessing.get_context("spawn")
        processes = [context.Process(target=_write_process_logs, args=(str(self.directory), number))
                     for number in range(4)]
        try:
            for process in processes:
                process.start()
            for process in processes:
                process.join(15)
                self.assertEqual(process.exitcode, 0)
        finally:
            for process in processes:
                if process.is_alive():
                    process.terminate()
                    process.join(3)
        rows = self.rows()
        self.assertEqual(len(rows), 400)
        self.assertTrue(all(len(row) == 3 and row[1] == "INFO" for row in rows))
        self.assertEqual({row[2] for row in rows},
                         {f"进程 {process},记录 {number}" for process in range(4) for number in range(100)})

    def test_async_records_are_drained_in_order_and_configuration_is_reused(self):
        logger = codebridge_logging.configure_logging(self.directory, self.name, asynchronous=True)
        handler = logger.handlers[0]
        repeated = codebridge_logging.configure_logging(self.directory, self.name, asynchronous=True)
        self.assertIs(repeated.handlers[0], handler)
        for number in range(20):
            logger.info('消息 %s', number)
        self.assertTrue(codebridge_logging.flush_logging(logger, timeout=1))
        self.assertEqual([row[2] for row in self.rows()], [f'消息 {number}' for number in range(20)])

    def test_blocked_async_disk_does_not_block_logging_flush_or_close(self):
        logger = codebridge_logging.configure_logging(self.directory, self.name, asynchronous=True)
        handler = logger.handlers[0]
        entered, release = threading.Event(), threading.Event()
        original = os.write

        def blocked_write(descriptor, content):
            entered.set()
            release.wait(5)
            return original(descriptor, content)

        try:
            with mock.patch.object(codebridge_logging.os, 'write', side_effect=blocked_write):
                logger.info('首次写入')
                self.assertTrue(entered.wait(1))
                started = time.monotonic()
                logger.error('后台磁盘阻塞时的控制端错误')
                self.assertLess(time.monotonic() - started, .2)
                started = time.monotonic()
                self.assertFalse(codebridge_logging.flush_logging(logger, timeout=.03))
                self.assertLess(time.monotonic() - started, .3)
                self.assertIsInstance(handler.last_error, TimeoutError)
                started = time.monotonic()
                handler.close()
                self.assertLess(time.monotonic() - started, .4)
                release.set()
                handler._writer.join(1)
                self.assertFalse(handler._writer.is_alive())
        finally:
            release.set()
        self.assertEqual(len(self.rows()), 2)

    def test_logging_shutdown_never_waits_for_a_blocked_sink_lock(self):
        logger = codebridge_logging.configure_logging(self.directory, self.name, asynchronous=True)
        handler = logger.handlers[0]
        entered, release, shutdown_done = (threading.Event() for _ in range(3))
        original = handler.sink.emit

        def blocked_emit(record):
            entered.set()
            release.wait(5)
            original(record)

        def shutdown():
            logging.shutdown([weakref.ref(handler.sink), weakref.ref(handler)])
            shutdown_done.set()

        try:
            with mock.patch.object(handler.sink, 'emit', side_effect=blocked_emit):
                logger.info('关闭时仍在等待磁盘')
                self.assertTrue(entered.wait(1))
                thread = threading.Thread(target=shutdown, daemon=True)
                thread.start()
                self.assertTrue(shutdown_done.wait(1.8), 'logging.shutdown waited for the stalled sink')
                thread.join(.1)
        finally:
            release.set()
            handler._writer.join(1)

    def test_async_queue_is_bounded_and_overflow_is_visible(self):
        entered, release = threading.Event(), threading.Event()
        with mock.patch.object(codebridge_logging, '_ASYNC_QUEUE_SIZE', 2):
            logger = codebridge_logging.configure_logging(self.directory, self.name, asynchronous=True)
        handler = logger.handlers[0]
        original = handler.sink.emit

        def blocked_emit(record):
            entered.set()
            release.wait(5)
            original(record)

        try:
            with mock.patch.object(handler.sink, 'emit', side_effect=blocked_emit):
                logger.info('正在写入')
                self.assertTrue(entered.wait(1))
                started = time.monotonic()
                for number in range(10):
                    logger.info('排队 %s', number)
                self.assertLess(time.monotonic() - started, .2)
                self.assertEqual(handler._queue.qsize(), 2)
                self.assertIsInstance(handler.last_error, BufferError)
                release.set()
                self.assertFalse(codebridge_logging.flush_logging(logger, timeout=1))
        finally:
            release.set()
        self.assertEqual(len(self.rows()), 3)

    def test_async_write_error_is_reported_without_console_output(self):
        logger = codebridge_logging.configure_logging(self.directory, self.name, asynchronous=True)
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            with mock.patch.object(codebridge_logging.os, 'write', side_effect=OSError('disk full')):
                logger.error('写入失败')
                self.assertFalse(codebridge_logging.flush_logging(logger, timeout=1))
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(errors.getvalue(), '')
        self.assertIsInstance(logger.handlers[0].last_error, OSError)


if __name__ == "__main__":
    unittest.main()
