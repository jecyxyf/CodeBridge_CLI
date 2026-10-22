"""Opt-in Linux FUSE checks, isolated from the real user's home and mounts."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
import uuid

from local_client import bridge


@unittest.skipUnless(sys.platform.startswith('linux') and os.environ.get('CODEBRIDGE_TEST_RCLONE')
                     and Path('/dev/fuse').exists(), 'requires Linux FUSE and CODEBRIDGE_TEST_RCLONE')
class LinuxMountIntegration(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='codebridge-mount-test-'))
        self.home = self.base / 'home'
        self.home.mkdir(mode=0o700)
        self.root = self.base / 'shared'
        self.root.mkdir()
        self.helper = Path(__file__).resolve().parents[1] / 'remote_server' / 'mount.py'
        self.environment = {key: value for key, value in os.environ.items() if not key.startswith('RCLONE_')}
        self.environment['HOME'] = str(self.home)
        self.children = []
        self.mounts = set()
        self.addCleanup(self.cleanup)

    def cleanup(self):
        for process in reversed(self.children):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(5)
        for path in self.mounts:
            if os.path.ismount(path):
                subprocess.run(['fusermount3', '-u', str(path)], capture_output=True, timeout=10)
        if any(os.path.ismount(path) for path in self.mounts):
            self.fail('Test mount remains active; retained temporary directory: ' + str(self.base))
        shutil.rmtree(self.base)

    def connect(self, custom=''):
        session = uuid.uuid4().hex
        cache = self.base / session
        cache.mkdir()
        with mock.patch.object(bridge.shutil, 'which', return_value=os.environ['CODEBRIDGE_TEST_RCLONE']):
            command = bridge.rclone_command(self.root, cache)
        request_read, request_write = os.pipe()
        response_read, response_write = os.pipe()
        log = self.base / (session + '.log')
        try:
            with (cache / 'rclone.log').open('wb') as errors:
                service = subprocess.Popen(command, stdin=request_read, stdout=response_write,
                                           stderr=errors, env=self.environment)
            self.children.append(service)
            args = [sys.executable, str(self.helper), '--session', session]
            if custom:
                args += ['--mount-path', custom]
            with log.open('wb') as errors:
                helper = subprocess.Popen(args, stdin=response_read, stdout=request_write,
                                          stderr=errors, env=self.environment)
            self.children.append(helper)
        finally:
            for descriptor in (request_read, request_write, response_read, response_write):
                os.close(descriptor)
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            content = log.read_text(encoding='utf-8', errors='replace')
            for line in content.splitlines(keepends=True):
                if line.startswith('CODEBRIDGE_MOUNTED ') and line.endswith('\n'):
                    self.mounts.add(Path(json.loads(line.split(' ', 1)[1])['mount']))
                if line.startswith('CODEBRIDGE_READY ') and line.endswith('\n'):
                    path = Path(json.loads(line.split(' ', 1)[1])['mount'])
                    self.mounts.add(path)
                    self.assertTrue(os.path.ismount(path))
                    return session, path, helper, service, log
            if helper.poll() is not None:
                self.fail('Mount helper failed: ' + content)
            time.sleep(.05)
        self.fail('Mount readiness timed out: ' + content)

    def disconnect(self, connection):
        _, path, helper, service, _ = connection
        helper.terminate()
        helper.wait(15)
        service.wait(10)
        self.assertFalse(os.path.ismount(path))
        self.assertTrue(path.is_dir())
        self.assertEqual(list(path.iterdir()), [])

    def test_default_name_persists_across_reconnect(self):
        first = self.connect()
        path = first[1]
        self.assertEqual(path.parent, self.home)
        self.assertRegex(path.name, '^[a-z]{5}$')
        config = json.loads((self.home / '.codebridge' / 'server.json').read_text())
        self.assertEqual(config, {'mount_directory': path.name})
        self.disconnect(first)
        second = self.connect()
        self.assertEqual(second[1], path)

    def test_custom_path_probe_and_single_session_ownership(self):
        session, path, _, _, _ = self.connect('~/custom project')
        self.assertEqual(path, self.home / 'custom project')
        probe = uuid.uuid4().hex
        local = self.root / ('.codebridge-probe-' + probe)
        local.write_bytes(('CodeBridge:' + probe + ':before').encode())
        completed = subprocess.run([sys.executable, str(self.helper), '--verify-readwrite',
                                    '--session', session, '--probe', probe], env=self.environment,
                                   capture_output=True, text=True, timeout=25)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout), {'ok': True, 'probe': probe})
        expected = ('CodeBridge:' + probe + ':after').encode()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and local.read_bytes() != expected:
            time.sleep(.05)
        self.assertEqual(local.read_bytes(), expected)
        local.unlink()
        other = subprocess.run([sys.executable, str(self.helper), '--session', uuid.uuid4().hex],
                               stdin=subprocess.DEVNULL, capture_output=True, text=True,
                               env=self.environment, timeout=10)
        self.assertNotEqual(other.returncode, 0)
        error = json.loads(other.stderr.split('CODEBRIDGE_ERROR ', 1)[1])
        self.assertIn('已有连接', error['message'])
        self.assertTrue(os.path.ismount(path))

    def test_corrupt_configuration_recovers_without_deleting_old_directory(self):
        first = self.connect()
        old = first[1]
        self.disconnect(first)
        config = self.home / '.codebridge' / 'server.json'
        config.write_text('{broken', encoding='utf-8')
        second = self.connect()
        self.assertNotEqual(second[1], old)
        self.assertTrue(old.is_dir())
        self.assertIn('CODEBRIDGE_WARNING ', second[4].read_text())
        backups = list(config.parent.glob('server.corrupt-*.json'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), '{broken')


if __name__ == '__main__':
    unittest.main()
