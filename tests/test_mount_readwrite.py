"""The temporary probe must validate reads and writes on the same handle."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from remote_server import mount


class MountReadwriteTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='codebridge-probe-test-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.probe = 'b' * 32
        self.before = ('CodeBridge:' + self.probe + ':before').encode()
        self.after = ('CodeBridge:' + self.probe + ':after').encode()
        self.target = self.root / ('.codebridge-probe-' + self.probe)
        self.target.write_bytes(self.before)
        patcher = mock.patch.object(mount, 'existing_mount', return_value=str(self.root))
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_probe(self, transform_read=None, corrupt_patch=False):
        original_fdopen = os.fdopen
        reads, writes = [], []

        class ReadwriteFile:
            def __init__(self, file):
                self.file = file
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return self.file.__exit__(*args)
            def __getattr__(self, name):
                return getattr(self.file, name)
            def read(self, size):
                value = self.file.read(size)
                reads.append(value)
                return transform_read(len(reads), value) if transform_read else value
            def write(self, value):
                writes.append((self.file.tell(), value))
                result = self.file.write(value)
                if corrupt_patch and len(writes) == 1:
                    self.file.flush()
                    position = self.file.tell()
                    self.file.seek(0)
                    self.file.write(b'!')
                    self.file.flush()
                    self.file.seek(position)
                return result

        def fdopen(descriptor, mode, **kwargs):
            file = original_fdopen(descriptor, mode, **kwargs)
            return ReadwriteFile(file) if mode == 'r+b' else file

        self.reads, self.writes = reads, writes
        with mock.patch.object(mount.os, 'fdopen', side_effect=fdopen):
            return mount.checked_operation('a' * 32, 'rw', self.probe)

    def test_same_handle_read_modify_read_keeps_existing_final_protocol(self):
        with mock.patch.object(mount.os, 'open', wraps=os.open) as opened:
            self.assertEqual(self.run_probe(), {'ok': True, 'probe': self.probe})
        self.assertEqual(self.target.read_bytes(), self.after)
        self.assertEqual(len(self.before), len(self.after) + 1)
        flags = [call.args[1] for call in opened.call_args_list]
        self.assertTrue(any(flag & os.O_RDWR for flag in flags))
        self.assertTrue(all(not flag & os.O_TRUNC for flag in flags))
        offset, patch = self.writes[0]
        self.assertGreater(offset, 0)
        self.assertLess(offset + len(patch), len(self.before))
        expected = self.before[:offset] + patch + self.before[offset + len(patch):]
        self.assertEqual(self.reads, [self.before, self.before, expected, self.after])

    def test_empty_read_on_readwrite_handle_fails_before_any_explicit_write(self):
        with self.assertRaisesRegex(RuntimeError, '同一读写句柄读取验证失败'):
            self.run_probe(transform_read=lambda count, value: b'' if count == 1 else value)
        self.assertEqual(self.writes, [])
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_changed_content_on_repeated_read_fails_before_explicit_write(self):
        with self.assertRaisesRegex(RuntimeError, '重复读取内容改变'):
            self.run_probe(transform_read=lambda count, value: b'changed' if count == 2 else value)
        self.assertEqual(self.writes, [])
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_random_write_must_preserve_bytes_outside_the_requested_range(self):
        with self.assertRaisesRegex(RuntimeError, '随机写入或同句柄读回验证失败'):
            self.run_probe(corrupt_patch=True)
        self.assertEqual(len(self.writes), 1)
        self.assertTrue(self.target.read_bytes().startswith(b'!'))
        self.assertNotEqual(self.target.read_bytes(), self.after)

    def test_wrong_final_readback_cannot_report_success(self):
        with self.assertRaisesRegex(RuntimeError, '最终读回验证失败'):
            self.run_probe(transform_read=lambda count, value: b'wrong' if count == 4 else value)

    def test_foreign_probe_content_is_never_modified(self):
        self.target.write_bytes(b'not this connection probe')
        with self.assertRaisesRegex(RuntimeError, '不是本次专用验证文件'):
            self.run_probe()
        self.assertEqual(self.writes, [])
        self.assertEqual(self.target.read_bytes(), b'not this connection probe')


if __name__ == '__main__':
    unittest.main()
