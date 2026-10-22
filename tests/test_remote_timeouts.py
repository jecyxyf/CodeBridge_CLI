"""Regression checks for FUSE stalls, process teardown and final acknowledgements."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from remote_server import mount


class RemoteTimeoutTests(unittest.TestCase):
    def test_delayed_supervisor_spawn_returns_on_time_and_kills_late_child(self):
        real_popen = subprocess.Popen
        release = threading.Event()
        created = threading.Event()
        children = []
        def delayed(*args, **kwargs):
            release.wait(2)
            process = real_popen(*args, **kwargs)
            children.append(process)
            created.set()
            return process
        started = time.monotonic()
        with mock.patch.object(mount.subprocess, 'Popen', side_effect=delayed), mock.patch.object(mount, 'emit') as emit:
            try:
                self.assertEqual(mount.supervise([], .05, 'prepare', worker_command=
                                                [sys.executable, '-c', 'import time; time.sleep(60)']), 1)
                self.assertLess(time.monotonic() - started, .5)
                self.assertIn('启动超时', emit.call_args.args[1]['message'])
            finally:
                release.set()
            self.assertTrue(created.wait(2))
            self.assertTrue(mount.wait_process(children[0], 2))

    def test_late_real_helper_does_not_initialize_server_after_timeout(self):
        real_popen = subprocess.Popen
        release = threading.Event()
        created = threading.Event()
        children = []
        def delayed(*args, **kwargs):
            release.wait(2)
            process = real_popen(*args, **kwargs)
            children.append(process)
            created.set()
            return process
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'HOME': directory}), \
                mock.patch.object(mount.subprocess, 'Popen', side_effect=delayed), mock.patch.object(mount, 'emit'):
            try:
                self.assertEqual(mount.supervise(['--initialize'], .05, '服务端初始化'), 1)
            finally:
                release.set()
            self.assertTrue(created.wait(2))
            self.assertTrue(mount.wait_process(children[0], 2))
            self.assertFalse((Path(directory) / '.codebridge').exists())

    @unittest.skipIf(os.name == 'nt', 'flock is used on Unix')
    def test_busy_mount_access_lock_has_a_deadline(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(mount.Path, 'home', return_value=Path(directory)):
            with mount.mount_lock('mount-access.lock'):
                started = time.monotonic()
                with self.assertRaisesRegex(TimeoutError, '访问锁超时'):
                    mount.mount_lock('mount-access.lock', wait=True, timeout=.05)
                self.assertLess(time.monotonic() - started, .5)

    def test_inherited_pipe_cannot_extend_subprocess_deadline(self):
        # The immediate child exits, but its descendant keeps stdout/stderr
        # open. subprocess.run(timeout=...) would wait again after killing the
        # already exited child; the separate controller must still return.
        command = [sys.executable, '-c',
                   'import subprocess,sys; subprocess.Popen([sys.executable,"-c","import time; time.sleep(.8)"])']
        started = time.monotonic()
        with self.assertRaisesRegex(TimeoutError, '目录读取超时'):
            mount.bounded_process(command, .08, '目录读取')
        self.assertLess(time.monotonic() - started, .6)

    def test_supervisor_bounds_a_blocked_filesystem_probe(self):
        command = [sys.executable, '-c',
                   'import time; from remote_server import mount; '
                   'mount.os.path.ismount=lambda path: time.sleep(60); '
                   'mount.existing_mount("a"*32)']
        started = time.monotonic()
        with mock.patch.object(mount, 'emit') as emit:
            result = mount.supervise([], .1, '真实挂载检查', worker_command=command)
        self.assertEqual(result, 1)
        self.assertLess(time.monotonic() - started, 1)
        self.assertIn('真实挂载检查', emit.call_args.args[1]['message'])

    def test_active_session_stays_open_but_cleanup_is_bounded(self):
        command = [sys.executable, '-c',
                   'import sys,time; '
                   'print("CODEBRIDGE_INTERNAL_STAGE active",file=sys.stderr,flush=True); '
                   'time.sleep(.15); '
                   'print("CODEBRIDGE_INTERNAL_STAGE cleanup",file=sys.stderr,flush=True); '
                   'time.sleep(60)']
        started = time.monotonic()
        with mock.patch.dict(mount.STAGE_TIMEOUTS, {'cleanup': .05}), mock.patch.object(mount, 'emit') as emit:
            result = mount.supervise([], .1, 'prepare', mount_session=True, worker_command=command)
        self.assertEqual(result, 1)
        self.assertGreater(time.monotonic() - started, .15)
        self.assertLess(time.monotonic() - started, 1)
        self.assertIn('cleanup', emit.call_args.args[1]['message'])

    def test_unmount_uses_bounded_process_and_reports_failure(self):
        if os.name == 'nt':
            self.skipTest('Unix unmount command')
        with mock.patch.object(mount, 'is_mounted', return_value=True), mock.patch.object(mount, 'bounded_process') as run:
            run.return_value.returncode = 1
            with self.assertRaisesRegex(RuntimeError, '正常卸载失败'):
                mount.unmount('/test/mount')
            self.assertEqual(run.call_args.args[1], 10)

    def test_self_test_timeout_does_not_initialize_logging(self):
        command = [sys.executable, '-c', 'import time; time.sleep(60)']
        with mock.patch.object(mount, 'configure_logging') as configure, mock.patch.object(mount, 'emit'):
            self.assertEqual(mount.supervise(['--self-test'], .05, '依赖检查', worker_command=command), 1)
        configure.assert_not_called()

    @unittest.skipUnless(sys.platform.startswith('linux'), 'checks owned descendant state through /proc')
    def test_successful_worker_exit_still_terminates_owned_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            pid_file = Path(directory) / 'pid'
            command = [sys.executable, '-c',
                       'import pathlib,subprocess,sys; '
                       'child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"]); '
                       'pathlib.Path(sys.argv[1]).write_text(str(child.pid))', str(pid_file)]
            self.assertEqual(mount.supervise([], 2, 'worker', worker_command=command), 0)
            pid = int(pid_file.read_text())
            try:
                status = Path(f'/proc/{pid}/stat')
                deadline = time.monotonic() + .5
                while status.exists() and status.read_text().split()[2] != 'Z' and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertTrue(not status.exists() or status.read_text().split()[2] == 'Z')
            finally:
                try:
                    os.kill(pid, 9)
                except ProcessLookupError:
                    pass


@unittest.skipIf(os.name == 'nt', 'Unix active-session fixture')
class ConnectionResultTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        patcher = mock.patch.object(mount.Path, 'home', return_value=self.home)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.session = 'a' * 32
        self.probe = 'b' * 32
        self.path = mount.initialize_server()
        self.record = self.home / '.codebridge' / 'mount-session.json'
        self.record.write_text(json.dumps({'session': self.session, 'mount': str(self.path),
                                          'verification_probe': self.probe}))

    def test_success_requires_the_same_active_mount_and_is_persisted(self):
        with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda path: str(path) == str(self.path)), mock.patch.object(mount, 'LOGGER') as logger:
            self.assertEqual(mount.connection_result(self.session, 'success', probe=self.probe),
                             {'ok': True, 'session': self.session, 'result': 'success'})
        self.assertEqual(json.loads(self.record.read_text())['connection_result'], 'success')
        self.assertTrue(any('连接流程运行结束' in call.args[0] and 'steps=6/6' in call.args[0]
                            for call in logger.info.call_args_list))

    def test_stale_session_cannot_log_completion(self):
        with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda path: str(path) == str(self.path)), mock.patch.object(mount, 'LOGGER') as logger:
            with self.assertRaisesRegex(RuntimeError, '会话已改变'):
                mount.connection_result('c' * 32, 'success', probe=self.probe)
        logger.info.assert_not_called()
        self.assertNotIn('connection_result', json.loads(self.record.read_text()))

    def test_failure_confirmation_records_only_the_allowed_reason(self):
        with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda path: str(path) == str(self.path)), mock.patch.object(mount, 'LOGGER') as logger:
            self.assertEqual(mount.connection_result(self.session, 'error', 'probe_cleanup', probe=self.probe)['result'], 'error')
        self.assertEqual(json.loads(self.record.read_text())['connection_result'], 'error')
        self.assertEqual(logger.error.call_args.args[-1], 'probe_cleanup')

    def test_old_error_ack_cannot_overwrite_new_probe_success(self):
        new_probe = 'c' * 32
        with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda path: str(path) == str(self.path)), mock.patch.object(mount, 'LOGGER') as logger:
            mount.connection_result(self.session, 'error', 'timeout', probe=self.probe)
            mount.begin_verification(self.session, new_probe)
            self.assertNotIn('connection_result', json.loads(self.record.read_text()))
            mount.connection_result(self.session, 'success', probe=new_probe)
            successful_record = self.record.read_bytes()
            logger.reset_mock()
            with self.assertRaisesRegex(RuntimeError, '过期验证结果'):
                mount.connection_result(self.session, 'error', 'timeout', probe=self.probe)
        self.assertEqual(self.record.read_bytes(), successful_record)
        self.assertEqual(json.loads(successful_record)['connection_result'], 'success')
        logger.info.assert_not_called()
        logger.error.assert_called_once()
        self.assertIn('读写验证运行结束 result=error', logger.error.call_args.args[0])
        self.assertNotIn('连接流程运行结束', logger.error.call_args.args[0])

    def test_failure_before_remote_registration_logs_attempt_without_changing_record(self):
        record = json.loads(self.record.read_text())
        record.pop('verification_probe')
        self.record.write_text(json.dumps(record))
        before = self.record.read_bytes()
        with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda path: str(path) == str(self.path)), mock.patch.object(mount, 'LOGGER') as logger:
            with self.assertRaisesRegex(RuntimeError, '过期验证结果'):
                mount.connection_result(self.session, 'error', 'internal', probe=self.probe)
        self.assertEqual(self.record.read_bytes(), before)
        logger.info.assert_not_called()
        logger.error.assert_called_once()
        message, session, probe, reason = logger.error.call_args.args
        self.assertIn('读写验证运行结束 result=error', message)
        self.assertIn('本轮未登记或已过期，未更新当前会话结果', message)
        self.assertNotIn('连接流程运行结束', message)
        self.assertEqual((session, probe, reason), (self.session, self.probe, 'internal'))

    def test_repeated_begin_for_same_probe_preserves_its_result(self):
        with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda path: str(path) == str(self.path)):
            mount.connection_result(self.session, 'success', probe=self.probe)
            completed = self.record.read_bytes()
            mount.begin_verification(self.session, self.probe)
        self.assertEqual(self.record.read_bytes(), completed)

    def test_invalid_or_missing_probe_never_changes_session_result(self):
        before = self.record.read_bytes()
        with self.assertRaisesRegex(RuntimeError, '验证标识无效'):
            mount.begin_verification(self.session, '../invalid')
        with self.assertRaisesRegex(RuntimeError, '验证标识无效'):
            mount.connection_result(self.session, 'success')
        self.assertEqual(self.record.read_bytes(), before)


class ReadOnlySelfTestTests(unittest.TestCase):
    def test_source_self_test_does_not_create_logs_state_or_bytecode(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            program = base / 'program'
            program.mkdir()
            shutil.copyfile(Path(mount.__file__), program / 'mount.py')
            shutil.copyfile(Path(mount.__file__).resolve().parent.parent / 'codebridge_logging.py', program / 'codebridge_logging.py')
            environment = dict(os.environ, HOME=str(base / 'home'))
            result = subprocess.run([sys.executable, '-B', str(program / 'mount.py'), '--self-test'],
                                    env=environment, capture_output=True, timeout=15)
            # Missing SSHFS/FUSE is a valid read-only check result too.
            self.assertIn(result.returncode, (0, 1))
            self.assertFalse((program / 'logs').exists())
            self.assertFalse((program / '__pycache__').exists())
            self.assertFalse((base / 'home').exists())


if __name__ == '__main__':
    unittest.main()
