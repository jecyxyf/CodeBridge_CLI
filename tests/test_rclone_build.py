"""Pinned artifact checks must reject drift without rebuilding or downloading."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from local_client import build_rclone


class RcloneBuildChecks(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='codebridge-build-check-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.output = self.root / 'rclone'
        self.output.write_bytes(b'original executable')
        self.lock = {'version': 'v1.75.2-codebridge.1', 'go_version': 'go1.26.9'}
        self.manifest = {'schema': 1, 'version': self.lock['version'],
                         'platform': 'linux-amd64', 'inputs_sha256': 'fixed-inputs',
                         'go_version': self.lock['go_version'],
                         'sha256': build_rclone.digest(self.output)}
        self.manifest_path = Path(str(self.output) + '.build.json')
        self.manifest_path.write_text(json.dumps(self.manifest))
        for name, value in [('host_platform', 'linux-amd64'), ('inputs_digest', 'fixed-inputs')]:
            patcher = mock.patch.object(build_rclone, name, return_value=value)
            patcher.start(); self.addCleanup(patcher.stop)

    def test_check_is_read_only_and_does_not_build(self):
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()}
        with mock.patch.object(build_rclone.subprocess, 'run', return_value=mock.Mock(
                stdout='rclone v1.75.2-codebridge.1\n')), \
                mock.patch.object(build_rclone, 'download') as download, \
                mock.patch.object(build_rclone, 'build') as build:
            self.assertTrue(build_rclone.check(self.output, self.lock)['ok'])
        download.assert_not_called(); build.assert_not_called()
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()})

    def test_modified_executable_rejected_before_execution(self):
        self.output.write_bytes(b'replaced executable')
        with mock.patch.object(build_rclone.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'SHA-256 mismatch'):
                build_rclone.check(self.output, self.lock)
        run.assert_not_called()

    def test_changed_patch_inputs_require_new_build(self):
        with mock.patch.object(build_rclone, 'inputs_digest', return_value='changed-inputs'), \
                mock.patch.object(build_rclone.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'manifest does not match'):
                build_rclone.check(self.output, self.lock)
        run.assert_not_called()

    def test_patch_context_mismatch_leaves_source_untouched(self):
        source = self.root / 'source'; source.mkdir()
        target = source / 'handler.go'; target.write_text('unexpected upstream content\n')
        patch = self.root / 'fix.patch'
        patch.write_text('--- a/handler.go\n+++ b/handler.go\n@@ -1 +1 @@\n-old content\n+fixed content\n')
        with self.assertRaisesRegex(RuntimeError, 'context mismatch'):
            build_rclone.apply_patch(source, patch)
        self.assertEqual(target.read_text(), 'unexpected upstream content\n')


if __name__ == '__main__':
    unittest.main()
