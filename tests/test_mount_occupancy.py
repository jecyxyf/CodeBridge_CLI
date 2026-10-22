"""Linux mount-point reference checks and ownership-safe cleanup."""
from contextlib import ExitStack
import errno
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from remote_server import mount


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux /proc mount guard')
class DirectoryReferenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.directory = self.base / 'target'
        self.directory.mkdir()
        self.proc = self.base / 'proc'
        self.proc.mkdir()
        self.guard = mount.open_mount_guard(self.directory)
        self.addCleanup(self.guard.close)

    def process(self, pid, cwd=None, descriptors=(), uid=None):
        process = self.proc / str(pid)
        process.mkdir()
        user = os.getuid() if uid is None else uid
        (process / 'status').write_text(f'Name:\ttest\nUid:\t{user}\t{user}\t{user}\t{user}\n')
        if cwd is not None:
            (process / 'cwd').symlink_to(cwd)
        (process / 'fd').mkdir()
        for number, target in descriptors:
            (process / 'fd' / str(number)).symlink_to(target)
        return process

    def scan(self, phase='before', owner=123456, timeout=3):
        return mount.scan_directory_references(self.guard.fd, owner, self.guard.fd,
                                               phase, str(self.proc), timeout)

    def test_old_cwd_is_refused_with_pid_and_recovery_instruction(self):
        self.process(101, cwd=self.directory)
        with self.assertRaisesRegex(RuntimeError, 'PID 101: cwd.*cd ~'):
            self.scan()

    def test_old_directory_fd_is_refused_even_if_process_cwd_moved(self):
        self.process(102, cwd=self.base, descriptors=[(8, self.directory)])
        with self.assertRaisesRegex(RuntimeError, 'PID 102: 目录FD'):
            self.scan()

    def test_only_own_guard_descriptors_are_excluded(self):
        self.process(123456, cwd=self.base, descriptors=[(self.guard.fd, self.directory)])
        self.process(os.getpid(), cwd=self.base, descriptors=[(self.guard.fd, self.directory)])
        self.assertTrue(self.scan()['ok'])
        (self.proc / str(os.getpid()) / 'cwd').unlink()
        (self.proc / str(os.getpid()) / 'cwd').symlink_to(self.directory)
        with self.assertRaisesRegex(RuntimeError, 'cwd'):
            self.scan()

    def test_other_users_and_regular_files_are_outside_directory_scope(self):
        regular = self.base / 'file'
        regular.write_bytes(b'do not inspect file contents')
        self.process(103, cwd=self.directory, uid=os.getuid() + 1)
        self.process(104, cwd=self.base, descriptors=[(9, regular)])
        result = self.scan()
        self.assertEqual(result['checked'], 1)
        self.assertEqual(result['unreadable_count'], 0)

    def test_exited_process_or_closed_descriptor_does_not_fail_scan(self):
        process = self.process(105, cwd=self.base)
        (process / 'status').unlink()
        self.process(106, cwd=self.base, descriptors=[(8, self.base / 'gone')])
        self.assertTrue(self.scan()['ok'])

    def test_permission_denial_is_reported_as_unknown_coverage(self):
        process = self.process(107, cwd=self.base)
        real_stat = os.stat
        def denied(path, *args, **kwargs):
            if str(path) == str(process / 'cwd'):
                raise PermissionError(errno.EACCES, 'denied')
            return real_stat(path, *args, **kwargs)
        with mock.patch.object(mount.os, 'stat', side_effect=denied):
            result = self.scan()
        self.assertEqual(result['unreadable_pids'], [107])
        self.assertEqual(result['unreadable_count'], 1)

    def test_missing_uid_is_an_error_not_a_clean_scan(self):
        process = self.process(108, cwd=self.base)
        (process / 'status').write_text('Name:\ttest\n')
        with self.assertRaisesRegex(RuntimeError, '身份记录无效'):
            self.scan()

    def test_hidden_new_files_are_detected_through_saved_directory_fd(self):
        self.assertTrue(self.scan()['ok'])
        target = self.directory / 'keep'
        target.write_bytes(b'important')
        with self.assertRaisesRegex(RuntimeError, '底层目录出现新文件'):
            self.scan('after')
        self.assertEqual(target.read_bytes(), b'important')

    def test_scan_has_an_elapsed_time_limit(self):
        with self.assertRaisesRegex(TimeoutError, '占用检查超时'):
            self.scan(timeout=-1)

    def test_parent_surfaces_incomplete_coverage_as_warning(self):
        response = {'ok': True, 'checked': 2, 'unreadable_pids': [109], 'unreadable_count': 1}
        def completed(command, timeout, phase, pass_fds, close_pass_fds):
            self.assertEqual(timeout, 3)
            self.assertTrue(close_pass_fds)
            for descriptor in pass_fds:
                os.close(descriptor)
            return subprocess.CompletedProcess(command, 0, json.dumps(response).encode(), b'')
        with mock.patch.object(mount, 'bounded_readonly_process', side_effect=completed), mock.patch.object(mount, 'emit') as emit:
            mount.check_mount_occupancy(self.guard, 'a' * 32, 'before')
        self.assertEqual(emit.call_args.args[0], 'WARNING')
        self.assertIn('不能保证', emit.call_args.args[1]['message'])
        self.assertIn('109', emit.call_args.args[1]['message'])

    def test_scanner_process_cannot_block_the_parent(self):
        started = time.monotonic()
        with self.assertRaisesRegex(TimeoutError, '已停止等待'):
            mount.bounded_readonly_process([sys.executable, '-c', 'import time;time.sleep(60)'], .05, '扫描')
        self.assertLess(time.monotonic() - started, .6)

    def test_late_scanner_start_is_stopped_and_retains_its_owned_fd(self):
        inherited = os.dup(self.guard.fd)
        identity = os.fstat(inherited)
        launched = threading.Event()
        release = threading.Event()
        stopped = threading.Event()
        children = []
        real_popen = subprocess.Popen
        real_stop = mount.stop_process
        inherited_identity = []

        def delayed_popen(*args, **kwargs):
            launched.set()
            release.wait(2)
            inherited_identity.append(os.fstat(inherited))
            child = real_popen(*args, **kwargs)
            children.append(child)
            return child

        def stop_child(child, *args, **kwargs):
            try:
                return real_stop(child, *args, **kwargs)
            finally:
                stopped.set()

        with mock.patch.object(mount.subprocess, 'Popen', side_effect=delayed_popen), \
                mock.patch.object(mount, 'stop_process', side_effect=stop_child):
            try:
                started = time.monotonic()
                with self.assertRaisesRegex(TimeoutError, '已停止等待'):
                    mount.bounded_readonly_process(
                        [sys.executable, '-c', 'import time;time.sleep(60)'], .05,
                        '扫描', pass_fds=(inherited,), close_pass_fds=True)
                self.assertLess(time.monotonic() - started, .5)
                self.assertTrue(launched.is_set())
                self.guard.close()
                replacement = os.open(self.base, os.O_RDONLY | os.O_DIRECTORY)
                self.addCleanup(os.close, replacement)
                self.assertNotEqual(replacement, inherited)
                self.assertEqual(os.fstat(inherited).st_ino, identity.st_ino)
            finally:
                release.set()
                finished = stopped.wait(2)
                if not finished:
                    for child in children:
                        real_stop(child)
            self.assertTrue(finished, 'late scanner was not stopped')
            self.assertEqual(len(children), 1)
            self.assertIsNotNone(children[0].poll())
            self.assertEqual(inherited_identity[0].st_ino, identity.st_ino)
            self.assertEqual(inherited_identity[0].st_dev, identity.st_dev)
            with self.assertRaises(OSError):
                os.fstat(inherited)


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux mountinfo')
class LinuxMountInfoTests(unittest.TestCase):
    def test_mountinfo_decodes_escaped_path_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = directory + '/space tab\tline\nslash\\'
            source = 'codebridge:test\\source'
            def escaped(value):
                return value.replace('\\', r'\134').replace(' ', r'\040').replace('\t', r'\011').replace('\n', r'\012')
            file = Path(directory) / 'mountinfo'
            file.write_text(f'42 1 0:33 / {escaped(path)} rw - fuse.sshfs {escaped(source)} rw\n')
            entry = mount.linux_mount_entry(path, str(file))
            self.assertEqual(entry, {'id': 42, 'mount': path, 'type': 'fuse.sshfs', 'source': source})

    def test_dead_fuse_mount_is_found_without_stat(self):
        entry = {'id': 42, 'source': 'codebridge:' + 'a' * 32}
        with mock.patch.object(mount, 'linux_mount_entry', return_value=entry), \
                mock.patch.object(mount.os.path, 'ismount', side_effect=OSError(errno.ENOTCONN, 'dead')) as stat_mount:
            self.assertTrue(mount.is_mounted('/dead'))
        stat_mount.assert_not_called()

    def test_dead_fuse_is_rejected_before_any_path_probe(self):
        with mock.patch.object(mount, 'linux_mount_entry', return_value={'id': 42}), \
                mock.patch.object(mount.Path, 'is_symlink', side_effect=OSError(errno.ENOTCONN, 'dead')) as lstat:
            with self.assertRaisesRegex(RuntimeError, '已被挂载'):
                mount.checked_directory(Path('/dead'))
        lstat.assert_not_called()

@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux guard lifecycle')
class MountGuardLifecycleTests(unittest.TestCase):
    def test_precheck_failure_closes_guard_and_never_unmounts(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            base = Path(directory)
            target = base / 'target'
            target.mkdir()
            guard = mount.open_mount_guard(target)
            stack.callback(guard.close)
            stack.enter_context(mock.patch.object(mount.Path, 'home', return_value=base))
            stack.enter_context(mock.patch.object(mount, 'executable', return_value='sshfs'))
            stack.enter_context(mock.patch.object(mount, 'passive_option', return_value='passive'))
            stack.enter_context(mock.patch.object(mount, 'mountpoint', return_value=str(target)))
            stack.enter_context(mock.patch.object(mount, 'open_mount_guard', return_value=guard))
            stack.enter_context(mock.patch.object(mount, 'check_mount_occupancy', side_effect=RuntimeError('occupied')))
            unmount = stack.enter_context(mock.patch.object(mount, 'unmount'))
            spawn = stack.enter_context(mock.patch.object(mount.subprocess, 'Popen'))
            emit = stack.enter_context(mock.patch.object(mount, 'emit'))
            self.assertEqual(mount.run('a' * 32), 1)
            self.assertIsNone(guard.fd)
            unmount.assert_not_called()
            spawn.assert_not_called()
            self.assertNotIn('READY', [call.args[0] for call in emit.call_args_list])

    def test_postcheck_failure_closes_guard_before_normal_unmount(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            base = Path(directory)
            target = base / 'target'
            target.mkdir()
            guard = mount.open_mount_guard(target)
            stack.callback(guard.close)
            process = mock.Mock(stderr=io.BytesIO())
            process.poll.return_value = None
            stack.enter_context(mock.patch.object(mount.Path, 'home', return_value=base))
            stack.enter_context(mock.patch.object(mount, 'executable', return_value='sshfs'))
            stack.enter_context(mock.patch.object(mount, 'passive_option', return_value='passive'))
            stack.enter_context(mock.patch.object(mount, 'mountpoint', return_value=str(target)))
            stack.enter_context(mock.patch.object(mount, 'open_mount_guard', return_value=guard))
            stack.enter_context(mock.patch.object(mount, 'check_mount_occupancy', side_effect=[{'ok': True}, RuntimeError('底层目录出现新文件')]))
            stack.enter_context(mock.patch.object(mount.subprocess, 'Popen', return_value=process))
            stack.enter_context(mock.patch.object(mount, 'is_mounted', return_value=True))
            stack.enter_context(mock.patch.object(mount, 'linux_mount_entry', return_value={'id': 42, 'source': 'codebridge:' + 'a' * 32, 'type': 'fuse.sshfs'}))
            stack.enter_context(mock.patch.object(mount, 'bounded_operation', return_value={'ok': True}))
            stack.enter_context(mock.patch.object(mount, 'stop_mount_process', return_value=True))
            def normal_unmount(*args, **kwargs):
                self.assertIsNone(guard.fd)
                self.assertEqual(kwargs['expected_id'], 42)
            unmount = stack.enter_context(mock.patch.object(mount, 'unmount', side_effect=normal_unmount))
            emit = stack.enter_context(mock.patch.object(mount, 'emit'))
            self.assertEqual(mount.run('a' * 32), 1)
            unmount.assert_called_once()
            self.assertNotIn('READY', [call.args[0] for call in emit.call_args_list])


if __name__ == '__main__':
    unittest.main()
