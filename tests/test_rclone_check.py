import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

from local_client import bridge, rclone_check
from local_client.runtime import bounded_process


class RcloneAdmissionTests(unittest.TestCase):
    def test_unpatched_unknown_and_similarly_named_versions_never_serve(self):
        for version in ('v1.75.2', 'v1.75.3', 'v1.60.1', 'v1.75.2-codebridge.10',
                        'v1.75.2-codebridge.1-beta'):
            with self.subTest(version=version):
                result = subprocess.CompletedProcess([], 0, stdout=('rclone ' + version + '\n').encode())
                with mock.patch.object(rclone_check.subprocess, 'run', return_value=result), \
                        mock.patch.object(rclone_check.subprocess, 'Popen') as launch:
                    with self.assertRaisesRegex(rclone_check.CheckError, '版本准入'):
                        rclone_check.check('/unused/rclone')
                    launch.assert_not_called()

    def test_failed_check_does_not_create_shared_service_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'shared'
            cache = Path(directory) / 'cache'
            root.mkdir()
            cache.mkdir()
            sentinel = root / 'user-file'
            sentinel.write_bytes(b'never modify user data')
            with mock.patch.object(bridge.shutil, 'which', return_value='/rclone'), \
                    mock.patch.object(bridge, 'certify_rclone', side_effect=bridge.BridgeError('self-check failed')):
                with self.assertRaisesRegex(bridge.BridgeError, 'self-check failed'):
                    bridge.rclone_command(root, cache)
            self.assertEqual(sentinel.read_bytes(), b'never modify user data')
            self.assertEqual(list(cache.iterdir()), [])

    def test_check_worker_receives_only_binary_and_uses_current_venv(self):
        completed = subprocess.CompletedProcess([], 0, stdout=json.dumps(
            {'ok': True, 'version': rclone_check.CERTIFIED_VERSION}).encode())
        with mock.patch.object(bridge, 'bounded_process', return_value=completed) as invoke:
            bridge.certify_rclone('/tools/rclone')
        command = invoke.call_args.args[0]
        self.assertEqual(command, [sys.executable, '-m', 'local_client.rclone_check', '--rclone', '/tools/rclone'])
        self.assertEqual(invoke.call_args.kwargs['cwd'], str(bridge.PROGRAM_DIR))

    def test_invalid_worker_results_never_admit_backend(self):
        for status, output in ((0, b'garbage'), (0, b'[]'), (0, b'{"ok":true}'),
                               (1, b'{"ok":true,"version":"v1.75.2-codebridge.1"}')):
            with self.subTest(status=status, output=output):
                completed = subprocess.CompletedProcess([], status, stdout=output)
                with mock.patch.object(bridge, 'bounded_process', return_value=completed):
                    with self.assertRaises(bridge.BridgeError):
                        bridge.certify_rclone('/tools/rclone')

    def test_worker_watchdog_exit_has_explicit_timeout_error(self):
        for status in (-9, 124):
            with mock.patch.object(bridge, 'bounded_process', return_value=
                                   subprocess.CompletedProcess([], status, stdout=b'')):
                with self.assertRaisesRegex(bridge.BridgeError, '自检超时'):
                    bridge.certify_rclone('/tools/rclone')

    def test_environment_cannot_redirect_isolated_backend_to_user_config(self):
        with mock.patch.dict(os.environ, {'RCLONE_CONFIG': '/private/config',
                                         'rclone_cache_dir': '/private/cache'}):
            environment = rclone_check.isolated_environment(Path('/isolated/home'))
        self.assertFalse(any(key.upper().startswith('RCLONE_') for key in environment))
        self.assertEqual(environment['HOME'], '/isolated/home')
        self.assertEqual(environment['USERPROFILE'], '/isolated/home')

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux process-group failure injection')
    def test_stalled_protocol_worker_and_owned_descendant_are_killed_within_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            executable = base / 'fake-rclone'
            child_pid_file = base / 'child.pid'
            backend_pid_file = base / 'backend.pid'
            executable.write_text('#!' + sys.executable + '\n' +
                'import os, subprocess, sys, time\nfrom pathlib import Path\n' +
                'if sys.argv[1] == "version":\n' +
                ' print("rclone ' + rclone_check.CERTIFIED_VERSION + '")\n' +
                ' sys.exit(0)\n' +
                'Path(' + repr(str(backend_pid_file)) + ').write_text(str(os.getpid()))\n' +
                'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])\n' +
                'Path(' + repr(str(child_pid_file)) + ').write_text(str(child.pid))\n' +
                'time.sleep(30)\n')
            executable.chmod(0o700)
            command = [sys.executable, '-c',
                       'from local_client import rclone_check as c; c.CHECK_TIMEOUT=.7; raise SystemExit(c.main())',
                       '--rclone', str(executable)]
            started = time.monotonic()
            result = bounded_process(command, 3, 'test worker', cwd=str(bridge.PROGRAM_DIR))
            self.assertLess(time.monotonic() - started, 2.5)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(child_pid_file.exists(), 'fault injection never reached SFTP startup')
            for file in (backend_pid_file, child_pid_file):
                pid = int(file.read_text())
                expires = time.monotonic() + 1
                while time.monotonic() < expires:
                    try:
                        state = Path('/proc', str(pid), 'stat').read_text().rsplit(')', 1)[1].split()[0]
                    except FileNotFoundError:
                        break
                    if state == 'Z':
                        break
                    time.sleep(.02)
                else:
                    self.fail('owned check process is still running: ' + str(pid))


@unittest.skipUnless(os.environ.get('CODEBRIDGE_TEST_RCLONE'), 'set CODEBRIDGE_TEST_RCLONE for real backend admission')
class RealRcloneAdmissionTests(unittest.TestCase):
    def test_certified_binary_passes_full_isolated_check(self):
        bridge.certify_rclone(os.environ['CODEBRIDGE_TEST_RCLONE'])


if __name__ == '__main__':
    unittest.main()
