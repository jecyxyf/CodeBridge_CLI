"""Fault injection for slow SSH calls, filesystem workers and UI verification."""
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from codebridge_logging import configure_logging, flush_logging
from local_client import app, bridge, runtime


class RuntimeTimeoutTests(unittest.TestCase):
    def test_exec_ack_and_channel_close_can_both_block_without_delaying_error(self):
        release = threading.Event()
        close_started = threading.Event()
        self.addCleanup(release.set)

        class Channel:
            def exec_command(self, command):
                release.wait(5)

            def close(self):
                close_started.set()
                release.wait(5)

        started = time.monotonic()
        with self.assertRaisesRegex(bridge.BridgeError, '超时'):
            bridge.execute_bounded(Channel(), 'fixed-command', timeout=.05)
        self.assertLess(time.monotonic() - started, .7)
        self.assertTrue(close_started.wait(.5))

    def test_socket_created_after_network_timeout_is_closed(self):
        release = threading.Event()
        closed = threading.Event()
        local, peer = socket.socketpair()
        self.addCleanup(local.close)
        self.addCleanup(peer.close)
        self.addCleanup(release.set)

        def connect():
            release.wait(5)
            return local

        def close(connection):
            connection.close()
            closed.set()

        started = time.monotonic()
        with self.assertRaises(runtime.OperationTimeout):
            runtime.bounded_call(connect, .05, 'DNS/代理连接', late_cleanup=close)
        self.assertLess(time.monotonic() - started, .7)
        release.set()
        self.assertTrue(closed.wait(1))
        self.assertEqual(local.fileno(), -1)

    def test_cancelled_network_call_reclaims_late_socket(self):
        cancel, release, closed, entered = (threading.Event() for _ in range(4))
        self.addCleanup(release.set)

        def connect():
            entered.set()
            release.wait(5)
            return object()

        def cancel_after_start():
            if entered.wait(1):
                cancel.set()

        canceller = threading.Thread(target=cancel_after_start, daemon=True)
        canceller.start()
        try:
            with self.assertRaisesRegex(runtime.OperationTimeout, '取消'):
                runtime.bounded_call(connect, 3, '连接', cancel,
                                     late_cleanup=lambda value: closed.set())
        finally:
            canceller.join(2)
        self.assertTrue(entered.is_set())
        release.set()
        self.assertTrue(closed.wait(1))

    def test_already_cancelled_network_call_never_starts(self):
        cancel = threading.Event()
        cancel.set()
        connect = mock.Mock()
        with self.assertRaisesRegex(runtime.OperationTimeout, '取消'):
            runtime.bounded_call(connect, 3, '连接', cancel)
        connect.assert_not_called()

    def test_expired_network_call_never_starts(self):
        connect = mock.Mock()
        with self.assertRaisesRegex(runtime.OperationTimeout, '超时'):
            runtime.bounded_call(connect, 0, '连接')
        connect.assert_not_called()

    def test_child_timeout_returns_and_stops_owned_process(self):
        processes = []
        original = subprocess.Popen

        def launch(*args, **kwargs):
            process = original(*args, **kwargs)
            processes.append(process)
            return process

        try:
            with mock.patch.object(runtime.subprocess, 'Popen', side_effect=launch):
                started = time.monotonic()
                with self.assertRaisesRegex(runtime.OperationTimeout, '超时'):
                    runtime.bounded_process([sys.executable, '-c', 'import time; time.sleep(30)'],
                                            .15, '文件操作')
                self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(len(processes), 1)
            self.assertNotEqual(processes[0].wait(timeout=2), 0)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=2)

    @unittest.skipIf(os.name == 'nt', 'POSIX inherited pipe fault injection')
    def test_inherited_pipe_does_not_extend_deadline_after_parent_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'descendant.pid'
            program = ('import pathlib,subprocess,sys; '
                       'child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]); '
                       'pathlib.Path(sys.argv[1]).write_text(str(child.pid))')
            started = time.monotonic()
            try:
                with self.assertRaisesRegex(runtime.OperationTimeout, '超时'):
                    runtime.bounded_process([sys.executable, '-c', program, str(marker)],
                                            .3, '持有标准流的后代进程')
                self.assertLess(time.monotonic() - started, 1)
                self.assertTrue(marker.exists(), 'the child must start before exercising the timeout')
                if sys.platform.startswith('linux'):
                    # A killed orphan can remain a zombie until init reaps it;
                    # either a missing PID or Z state proves it stopped running.
                    status = Path('/proc') / marker.read_text() / 'stat'
                    expires = time.monotonic() + .7
                    while status.exists() and time.monotonic() < expires:
                        try:
                            state = status.read_text().rsplit(')', 1)[1].split()[0]
                        except FileNotFoundError:
                            break
                        if state == 'Z':
                            break
                        time.sleep(.01)
                    else:
                        if status.exists():
                            self.fail('the descendant still runs after its owned process group timed out')
            finally:
                if marker.exists():
                    try:
                        os.kill(int(marker.read_text()), signal.SIGTERM)
                    except ProcessLookupError:
                        pass

    def test_blocked_probe_fsync_is_stopped_by_worker_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = bridge.Bridge(lambda message: None)
            connection.root = Path(directory)
            nonce = 'd' * 32
            marker = Path(directory) / 'fsync.started'
            original = runtime.bounded_process
            script = ('import pathlib,sys,time; from local_client import probe; '
                      'probe.os.fsync=lambda fd: '
                      '(pathlib.Path(sys.argv[1]).write_text("started"),time.sleep(30)); '
                      'sys.exit(probe.main())')

            def inject_fsync(args, timeout, label, **kwargs):
                return original([sys.executable, '-c', script, str(marker)], timeout, label, **kwargs)

            started = time.monotonic()
            with mock.patch.object(bridge, 'bounded_process', side_effect=inject_fsync):
                with self.assertRaisesRegex(runtime.OperationTimeout, '超时'):
                    connection.local_operation('create', .5, nonce)
            self.assertLess(time.monotonic() - started, 1.3)
            self.assertTrue(marker.exists(), 'fsync must have been entered before timeout')
            probe = Path(directory) / ('.codebridge-probe-' + nonce)
            # An uncertain timed-out write is preserved for recovery.
            self.assertEqual(probe.read_bytes(), ('CodeBridge:' + nonce + ':before').encode())


class ClientVerificationTimeoutTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        patch = mock.patch.object(app, 'CONFIG', self.directory / 'settings.json')
        patch.start()
        self.addCleanup(patch.stop)
        self.application = app.Application()
        self.connection = bridge.Bridge(self.application.notify)
        self.connection.root = self.directory
        self.connection.mount = '/test-mount'
        self.connection.remote_os = 'Linux'
        self.connection.mounted = True
        self.connection.client = mock.Mock()
        self.connection.client.is_active.return_value = True
        self.connection._report_failure = mock.Mock()
        self.application.bridge = self.connection
        self.application.state = 'connected'
        self.application.phase = 'readable'
        self.release = threading.Event()
        self.addCleanup(self.finish_worker)

    def finish_worker(self):
        self.release.set()
        worker = self.application.readwrite_worker
        if worker:
            worker.join(2)
            self.assertFalse(worker.is_alive(), 'verification control worker did not finish')

    def wait_for_result(self):
        worker = self.application.readwrite_worker
        self.assertIsNotNone(worker)
        worker.join(2)
        self.assertFalse(worker.is_alive())
        return self.application.snapshot()

    def test_remote_silence_hits_total_deadline_and_releases_verification_lock(self):
        channel = mock.Mock()
        channel.recv_ready.return_value = False
        channel.recv_stderr_ready.return_value = False
        channel.exit_status_ready.return_value = False
        self.connection.client.open_session.return_value = channel
        self.connection.local_operation = mock.Mock(return_value={'ok': True})
        with mock.patch.object(bridge, 'VERIFY_TIMEOUT', .08):
            started = time.monotonic()
            result = self.connection.verify_readwrite()
        self.assertLess(time.monotonic() - started, .7)
        self.assertFalse(result['ok'])
        self.assertIn('时限', result['message'])
        self.assertTrue(self.connection.verify_lock.acquire(blocking=False))
        self.connection.verify_lock.release()

    def test_manual_start_returns_pending_and_watchdog_finishes_stalled_verification(self):
        entered = threading.Event()

        def stalled():
            entered.set()
            self.release.wait(5)
            return {'ok': True, 'message': 'late success'}

        self.connection.verify_readwrite = stalled
        with mock.patch.object(app, 'VERIFY_TIMEOUT', .05):
            started = time.monotonic()
            result = self.application.verify_readwrite()
            self.assertTrue(result['pending'])
            self.assertLess(time.monotonic() - started, .3)
            self.assertTrue(entered.wait(.5))
            state = self.wait_for_result()
        self.assertEqual(state['phase'], 'readable')
        self.assertFalse(state['readwrite_result']['ok'])
        self.assertIn('超时', state['readwrite_result']['message'])
        self.assertTrue(self.connection.verify_cancel.is_set())
        self.release.set()
        time.sleep(.03)
        self.assertFalse(self.application.snapshot()['readwrite_result']['ok'])

    def test_http_request_returns_202_while_verification_is_running(self):
        entered = threading.Event()

        def stalled():
            entered.set()
            self.release.wait(5)
            return {'ok': True, 'message': 'late result'}

        self.connection.verify_readwrite = stalled
        token = 'private-ui-token-do-not-log'
        server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.make_handler(self.application, token))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        request = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=2)
        try:
            with mock.patch.object(app, 'VERIFY_TIMEOUT', .05), self.assertLogs(bridge.LOG, level='DEBUG') as logs:
                started = time.monotonic()
                request.request('POST', '/api/verify-readwrite', body='{}', headers={
                    'X-CodeBridge-Token': token, 'Origin': f'http://127.0.0.1:{server.server_port}'})
                response = request.getresponse()
                body = json.loads(response.read())
                self.assertEqual(response.status, 202)
                self.assertTrue(body['pending'])
                self.assertLess(time.monotonic() - started, .4)
                self.assertTrue(entered.wait(.5))
                state = self.wait_for_result()
            self.assertFalse(state['readwrite_result']['ok'])
            self.assertNotIn(token, '\n'.join(logs.output))
        finally:
            request.close()
            self.release.set()
            server.shutdown()
            server.server_close()
            worker.join(2)

    def prepare_success_until_ack(self, acknowledgement):
        self.connection.local_operation = mock.Mock(return_value={'ok': True})

        def remote(command, deadline, **kwargs):
            if '--verify-readwrite' in command:
                return {'ok': True, 'probe': command.split('--probe ', 1)[1].split()[0]}
            return acknowledgement()

        self.connection._remote_json = remote

    def test_success_waits_for_remote_completion_acknowledgement(self):
        waiting = threading.Event()

        def acknowledge():
            waiting.set()
            self.release.wait(5)
            return {'ok': True, 'session': self.connection.session, 'result': 'success'}

        self.prepare_success_until_ack(acknowledge)
        with self.assertLogs(bridge.LOG, level='DEBUG') as logs:
            self.assertTrue(self.application.verify_readwrite()['pending'])
            self.assertTrue(waiting.wait(1))
            state = self.application.snapshot()
            self.assertEqual(state['phase'], 'write_verifying')
            self.assertIsNone(state['readwrite_result'])
            self.assertNotIn('连接流程运行结束：成功', '\n'.join(logs.output))
            self.release.set()
            state = self.wait_for_result()
        self.assertEqual(state['phase'], 'write_verified')
        self.assertTrue(state['readwrite_result']['ok'])
        self.assertIn('连接流程运行结束：成功', '\n'.join(logs.output))

    def test_failed_completion_ack_does_not_report_success(self):
        def acknowledge():
            raise runtime.OperationTimeout('服务端结束确认超时')

        self.prepare_success_until_ack(acknowledge)
        with self.assertLogs(bridge.LOG, level='DEBUG') as logs:
            self.application.verify_readwrite()
            state = self.wait_for_result()
        self.assertEqual(state['state'], 'connected')
        self.assertEqual(state['phase'], 'readable')
        self.assertFalse(state['readwrite_result']['ok'])
        self.assertIn('两端结束确认', state['readwrite_result']['message'])
        self.assertNotIn('连接流程运行结束：成功', '\n'.join(logs.output))

    def test_wrong_session_ack_does_not_report_success(self):
        self.prepare_success_until_ack(lambda: {'ok': True, 'session': 'wrong-session', 'result': 'success'})
        self.application.verify_readwrite()
        self.assertFalse(self.wait_for_result()['readwrite_result']['ok'])

    def test_untrusted_exception_details_and_credentials_never_enter_logs(self):
        password = 'private-password-do-not-log'
        token = 'private-token-do-not-log'
        settings = {'folder': str(self.directory), 'remote_os': 'Linux', 'host': 'server.invalid',
                    'username': 'test-user', 'port': 22, 'proxy': ''}
        with self.assertLogs(bridge.LOG, level='DEBUG') as logs:
            with mock.patch.object(bridge, 'connect_socket', side_effect=OSError(password + token)):
                self.connection.run(settings, password)
        output = '\n'.join(logs.output)
        self.assertNotIn(password, output)
        self.assertNotIn(token, output)
        self.assertIn('运行结束', output)

    def test_stalled_log_disk_cannot_hold_watchdog_in_verifying_state(self):
        logger = configure_logging(self.directory, 'test-client-watchdog-' + str(id(self)), asynchronous=True)
        handler = logger.handlers[0]
        disk_entered, disk_release = threading.Event(), threading.Event()
        original_emit = handler.sink.emit

        def blocked_disk(record):
            disk_entered.set()
            disk_release.wait(5)
            original_emit(record)

        def stalled_verification():
            logger.info('开始验证')
            self.release.wait(5)
            return {'ok': True, 'message': 'late result'}

        self.connection.verify_readwrite = stalled_verification
        try:
            with mock.patch.object(handler.sink, 'emit', side_effect=blocked_disk), \
                    mock.patch.object(app, 'LOG', logger), mock.patch.object(app, 'VERIFY_TIMEOUT', .05):
                self.assertTrue(self.application.verify_readwrite()['pending'])
                self.assertTrue(disk_entered.wait(1))
                state = self.wait_for_result()
                self.assertEqual(state['phase'], 'readable')
                self.assertFalse(state['readwrite_result']['ok'])
                self.assertIn('超时', state['message'])
                self.assertFalse(flush_logging(logger, timeout=.03))
                disk_release.set()
                self.assertTrue(flush_logging(logger, timeout=1))
        finally:
            disk_release.set()
            self.release.set()
            handler.close()
            logger.removeHandler(handler)

    def test_disconnect_remains_prompt_while_resource_close_is_blocked(self):
        closing = threading.Event()

        def blocked_close():
            closing.set()
            self.release.wait(5)

        self.connection.channel = mock.Mock(close=blocked_close)
        self.application.worker = mock.Mock()
        self.application.worker.is_alive.return_value = True
        started = time.monotonic()
        self.application.disconnect()
        self.assertLess(time.monotonic() - started, .3)
        self.assertTrue(closing.wait(.5))
        self.assertTrue(self.connection.stop.is_set())
        self.assertEqual(self.application.state, 'disconnecting')
        self.assertFalse(self.connection.cleanup_done.is_set())

    def test_program_shutdown_waits_for_actual_child_cleanup(self):
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(.5)'],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL)
        self.connection.process = process
        settings = {'folder': str(self.directory), 'remote_os': 'Linux', 'host': 'server.invalid',
                    'username': 'test-user', 'port': 22, 'proxy': ''}
        server = mock.Mock()
        server.server_port = 12345
        try:
            with mock.patch.object(bridge, 'connect_socket', side_effect=OSError()):
                self.application.worker = threading.Thread(target=self.connection.run,
                                                           args=(settings, 'test-password'), daemon=True)
                self.application.worker.start()
                self.application.worker.join(1)
            self.assertFalse(self.application.worker.is_alive())
            self.assertFalse(self.connection.cleanup_done.is_set())
            with mock.patch.object(app, 'Application', return_value=self.application), \
                    mock.patch.object(app, 'configure_logging'), \
                    mock.patch.object(app, 'ThreadingHTTPServer', return_value=server), \
                    mock.patch.object(sys, 'argv', ['codebridge', '--no-browser']), \
                    mock.patch('builtins.print'):
                started = time.monotonic()
                app.main()
                elapsed = time.monotonic() - started
            self.assertGreater(elapsed, .15)
            self.assertLess(elapsed, 2)
            self.assertTrue(self.connection.cleanup_done.is_set())
            self.assertIsNotNone(process.poll())
            server.server_close.assert_called_once()
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=2)

    def test_unstoppable_child_cleanup_reports_failure_and_releases_shutdown_waiter(self):
        process = mock.Mock()
        process.wait.side_effect = subprocess.TimeoutExpired('test-child', 1)
        process.poll.return_value = None
        self.connection.process = process
        settings = {'folder': str(self.directory), 'remote_os': 'Linux', 'host': 'server.invalid',
                    'username': 'test-user', 'port': 22, 'proxy': ''}
        with self.assertLogs(bridge.LOG, level='DEBUG') as logs, \
                mock.patch.object(bridge, 'connect_socket', side_effect=OSError()):
            self.connection.run(settings, 'test-password')
            self.assertTrue(self.connection.cleanup_done.wait(1))
        output = '\n'.join(logs.output)
        self.assertIn('本地文件服务尚未退出', output)
        self.assertNotIn('本地文件服务已退出', output)
        process.terminate.assert_called_once()
        process.kill.assert_called_once()


if __name__ == '__main__':
    unittest.main()
