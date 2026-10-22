"""A timed-out persistence operation must not overwrite a later successful one."""
import base64
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from local_client import app, runtime, state_worker
from local_client.trust import target_id


class StatePersistenceTests(unittest.TestCase):
    def test_committed_forget_timeout_cannot_restore_selected_legacy_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'settings.json'
            pin = 'SHA256:' + base64.b64encode(b'a' * 32).decode().rstrip('=')
            other_pin = 'SHA256:' + base64.b64encode(b'b' * 32).decode().rstrip('=')
            config.write_text(json.dumps({'host': 'selected.example', 'port': '22', 'fingerprint': pin}))
            with mock.patch.object(app, 'CONFIG', config):
                application = app.Application()
                application.trust.remember('other.example', 2222, other_pin)

                def commit_then_timeout(*args, **kwargs):
                    state_worker.operate(json.loads(kwargs['input']))
                    raise runtime.OperationTimeout('fixture timeout after atomic deletion')

                with mock.patch.object(app, 'bounded_process', side_effect=commit_then_timeout):
                    with self.assertRaises(runtime.OperationTimeout):
                        application.forget_host({'host': 'SELECTED.EXAMPLE.', 'port': 22})
                self.assertIsNone(application.trust.expected('selected.example', 22))
                self.assertNotIn('fingerprint', application.settings)
                application.persist('prepare')
                self.assertEqual(application.trust.read(), {target_id('other.example', 2222): other_pin})
                restarted = app.Application()
                self.assertIsNone(restarted.trust.expected('selected.example', 22))

    def test_uncertain_forget_preserves_another_hosts_legacy_source(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'settings.json'
            pin = 'SHA256:' + base64.b64encode(b'a' * 32).decode().rstrip('=')
            config.write_text(json.dumps({'host': 'original.example', 'port': '2222', 'fingerprint': pin}))
            with mock.patch.object(app, 'CONFIG', config):
                application = app.Application()
                with mock.patch.object(app, 'bounded_process', side_effect=runtime.OperationTimeout('fixture timeout')):
                    with self.assertRaises(runtime.OperationTimeout):
                        application.forget_host({'host': 'selected.example', 'port': 22})
                self.assertEqual(application.trust.legacy, {target_id('original.example', 2222): pin})
                self.assertEqual(application.settings['fingerprint'], pin)
                application.persist('prepare')
                self.assertEqual(application.trust.expected('original.example', 2222), pin)

    def test_timed_out_save_cannot_resume_and_overwrite_new_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'settings.json'
            marker = Path(directory) / 'replace.started'
            script = ('import os,pathlib,sys,time; from local_client import state_worker; '
                      'replace=os.replace; '
                      'os.replace=lambda source,target: '
                      '(pathlib.Path(sys.argv[1]).write_text("started"),time.sleep(1.5),replace(source,target)); '
                      'sys.exit(state_worker.main())')
            with mock.patch.object(app, 'CONFIG', config):
                application = app.Application()
                original = runtime.bounded_process
                def stalled(args, timeout, label, **kwargs):
                    return original([sys.executable, '-c', script, str(marker)], .7, label, **kwargs)
                with mock.patch.object(app, 'bounded_process', side_effect=stalled):
                    with self.assertRaises(runtime.OperationTimeout):
                        application.persist('prepare', settings={'host': 'old-host'})
                self.assertTrue(marker.exists())
                application.persist('prepare', settings={'host': 'new-host', 'password': 'never-persist'})
                time.sleep(1.5)
                self.assertEqual(json.loads(config.read_text()), {'host': 'new-host'})


class BlockingCommunicateTests(unittest.TestCase):
    def fixture_process(self):
        process = mock.Mock(returncode=None)
        entered, released, finished = threading.Event(), threading.Event(), threading.Event()
        self.addCleanup(released.set)

        def communicate(input=None, **kwargs):
            # Model Windows _stdin_write: the pipe write can block before
            # communicate(timeout=...) reaches any of its timed waits.
            entered.set()
            try:
                released.wait(3)
                return b'', b''
            finally:
                finished.set()

        def kill():
            process.returncode = -9
            released.set()

        process.communicate.side_effect = communicate
        process.kill.side_effect = kill
        return process, entered, finished

    def test_stalled_stdin_write_is_killed_without_concurrent_communicate(self):
        process, entered, finished = self.fixture_process()
        with mock.patch.object(runtime.subprocess, 'Popen', return_value=process):
            started = time.monotonic()
            with self.assertRaisesRegex(runtime.OperationTimeout, '超时'):
                runtime.bounded_process(['fixture'], .05, '持久化', input=b'x' * 65536,
                                        start_new_session=False)
            self.assertLess(time.monotonic() - started, .7)
        self.assertTrue(entered.is_set())
        self.assertTrue(finished.wait(1))
        process.kill.assert_called_once()
        process.communicate.assert_called_once_with(input=b'x' * 65536)

    def test_cancel_during_stalled_stdin_write_kills_single_communicator(self):
        process, entered, finished = self.fixture_process()
        cancel = threading.Event()

        def cancel_after_start():
            if entered.wait(1):
                cancel.set()

        canceller = threading.Thread(target=cancel_after_start, daemon=True)
        canceller.start()
        try:
            with mock.patch.object(runtime.subprocess, 'Popen', return_value=process):
                started = time.monotonic()
                with self.assertRaisesRegex(runtime.OperationTimeout, '取消'):
                    runtime.bounded_process(['fixture'], 3, '持久化', input=b'x' * 65536,
                                            cancel=cancel, start_new_session=False)
                self.assertLess(time.monotonic() - started, .7)
        finally:
            canceller.join(1)
        self.assertTrue(finished.wait(1))
        process.kill.assert_called_once()
        process.communicate.assert_called_once()

    def test_pre_cancelled_or_expired_process_never_launches(self):
        cancel = threading.Event()
        cancel.set()
        for timeout, cancellation in ((3, cancel), (0, None)):
            with self.subTest(timeout=timeout), mock.patch.object(runtime.subprocess, 'Popen') as launch:
                with self.assertRaises(runtime.OperationTimeout):
                    runtime.bounded_process(['fixture'], timeout, '持久化', cancel=cancellation)
                launch.assert_not_called()

    def test_late_popen_is_killed_and_reaped_once(self):
        process, _, finished = self.fixture_process()
        release = threading.Event()
        self.addCleanup(release.set)

        def launch(*args, **kwargs):
            release.wait(3)
            return process

        with mock.patch.object(runtime.subprocess, 'Popen', side_effect=launch):
            with self.assertRaises(runtime.OperationTimeout):
                runtime.bounded_process(['fixture'], .05, '创建进程', start_new_session=False)
            release.set()
            self.assertTrue(finished.wait(1))
        process.kill.assert_called_once()
        process.communicate.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
