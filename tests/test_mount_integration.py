"""Opt-in Linux FUSE checks, isolated from the real user's home and mounts."""
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
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
        repository = Path(__file__).resolve().parents[1]
        program = self.base / 'program'
        program.mkdir()
        self.helper = program / 'mount.py'
        shutil.copyfile(repository / 'remote_server' / 'mount.py', self.helper)
        shutil.copyfile(repository / 'codebridge_logging.py', program / 'codebridge_logging.py')
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
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
        for path in self.mounts:
            if self.mount_present(path):
                subprocess.run(['fusermount3', '-u', str(path)], capture_output=True, timeout=10)
        if any(self.mount_present(path) for path in self.mounts):
            self.fail('Test mount remains active; retained temporary directory: ' + str(self.base))
        shutil.rmtree(self.base)

    def mount_present(self, path):
        # ismount() may return False for an ENOTCONN FUSE mount. Never recurse
        # into a test directory until the kernel's mount table says it is gone.
        expected = os.path.abspath(path)
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            fields = line.split()
            mounted = re.sub(r'\\([0-7]{3})', lambda match: chr(int(match[1], 8)), fields[4])
            if mounted == expected:
                return True
        return False

    def connect(self, custom='', expected_error=None, after_launch=None):
        session = uuid.uuid4().hex
        cache = self.base / session
        cache.mkdir()
        with mock.patch.object(bridge.shutil, 'which', return_value=os.environ['CODEBRIDGE_TEST_RCLONE']):
            command = bridge.rclone_command(self.root, cache)
        request_read, request_write = os.pipe()
        response_read, response_write = os.pipe()
        log = self.base / (session + '.log')
        target = None
        if custom:
            target = self.home / custom[2:] if custom.startswith('~/') else Path(custom)
            self.mounts.add(target)
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
        if after_launch:
            after_launch()
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            content = log.read_text(encoding='utf-8', errors='replace')
            for line in content.splitlines(keepends=True):
                if line.startswith('CODEBRIDGE_MOUNTED ') and line.endswith('\n'):
                    self.mounts.add(Path(json.loads(line.split(' ', 1)[1])['mount']))
                if line.startswith('CODEBRIDGE_READY ') and line.endswith('\n'):
                    self.assertIsNone(expected_error, 'Rejected mount unexpectedly emitted READY: ' + content)
                    path = Path(json.loads(line.split(' ', 1)[1])['mount'])
                    self.mounts.add(path)
                    self.assertTrue(os.path.ismount(path))
                    self.assertTrue(self.mount_present(path))
                    return session, path, helper, service, log
            if helper.poll() is not None:
                if expected_error is not None:
                    self.assertNotEqual(helper.returncode, 0, content)
                    self.assertNotIn('CODEBRIDGE_READY ', content)
                    messages = [json.loads(line.split(' ', 1)[1])['message']
                                for line in content.splitlines() if line.startswith('CODEBRIDGE_ERROR ')]
                    self.assertTrue(messages, content)
                    self.assertIn(expected_error, '\n'.join(messages), content)
                    self.assertFalse(self.mount_present(target), content)
                    return session, target, helper, service, log
                self.fail('Mount helper failed: ' + content)
            time.sleep(.05)
        self.fail('Mount readiness timed out: ' + content)

    def hold_reference(self, path, kind):
        script = '''import os,sys
target, kind, outside = sys.argv[1:]
descriptor = None
if kind == 'cwd':
    os.chdir(target)
else:
    descriptor = os.open(target, os.O_RDONLY | os.O_DIRECTORY)
print('held', flush=True)
for command in sys.stdin:
    if command.strip() == 'write-and-release':
        file = os.open('server-only.txt', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=descriptor)
        os.write(file, b'preserve hidden server file')
        os.close(file)
    if kind == 'cwd':
        os.chdir(outside)
    elif descriptor is not None:
        os.close(descriptor)
        descriptor = None
    print('released', flush=True)
'''
        process = subprocess.Popen([sys.executable, '-u', '-c', script, str(path), kind, str(self.base)],
                                   cwd=self.base, env=self.environment, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(process)
        self.actor_response(process, 'held')
        return process

    def actor_response(self, process, expected):
        ready, _, _ = select.select([process.stdout], [], [], 5)
        self.assertTrue(ready, 'Reference holder did not respond')
        self.assertEqual(process.stdout.readline().strip(), expected)

    def release_reference(self, process, command='release'):
        process.stdin.write(command + '\n')
        process.stdin.flush()
        self.actor_response(process, 'released')
        self.assertIsNone(process.poll(), 'The holder must leave/close the directory without being killed')

    def wait_for_file(self, path):
        deadline = time.monotonic() + 8
        while not path.exists() and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(path.exists(), 'Mount synchronization point was not reached: ' + str(path))

    def pause_before_real_mount(self):
        binary = shutil.which('sshfs', path=self.environment['PATH'])
        self.assertIsNotNone(binary, 'Real SSHFS is required')
        directory = self.base / 'test-bin'
        directory.mkdir()
        started, release = self.base / 'sshfs.started', self.base / 'sshfs.release'
        wrapper = directory / 'sshfs'
        wrapper.write_text('#!' + sys.executable + '\n' +
                           'import os,pathlib,sys,time\n' +
                           'if "-h" not in sys.argv:\n' +
                           f'    pathlib.Path({str(started)!r}).write_text("started")\n' +
                           '    deadline = time.monotonic() + 10\n' +
                           f'    while not pathlib.Path({str(release)!r}).exists():\n' +
                           '        if time.monotonic() >= deadline: sys.exit(91)\n' +
                           '        time.sleep(.01)\n' +
                           f'os.execv({binary!r}, [{binary!r}] + sys.argv[1:])\n')
        wrapper.chmod(0o700)
        self.environment['PATH'] = str(directory) + os.pathsep + self.environment['PATH']
        return started, release

    def pause_after_real_mount(self):
        started, release = self.base / 'mounted.started', self.base / 'mounted.release'
        # Instrument only an isolated helper copy. The real is_mounted call,
        # guard scans, SSHFS and SFTP transport remain unchanged.
        hook = '''
if __name__ == '__main__' and '--internal-worker' in sys.argv:
    _test_is_mounted = is_mounted
    def is_mounted(path):
        result = _test_is_mounted(path)
        started, release = Path(%r), Path(%r)
        if result and not started.exists():
            started.write_text('mounted')
            deadline = time.monotonic() + 10
            while not release.exists():
                if time.monotonic() >= deadline:
                    raise RuntimeError('test post-mount barrier expired')
                time.sleep(.01)
        return result

''' % (str(started), str(release))
        source = self.helper.read_text()
        entrypoint = "if __name__ == '__main__':"
        self.assertIn(entrypoint, source)
        self.helper.write_text(source.replace(entrypoint, hook + entrypoint, 1))
        return started, release

    def record_unmount_commands(self):
        binary = shutil.which('fusermount3', path=self.environment['PATH'])
        self.assertIsNotNone(binary, 'fusermount3 is required for real cleanup verification')
        directory = self.base / 'unmount-bin'
        directory.mkdir()
        record = self.base / 'unmount-commands.jsonl'
        started, release = self.base / 'unmount.started', self.base / 'unmount.release'
        wrapper = directory / 'fusermount3'
        wrapper.write_text('#!' + sys.executable + '\n' +
                           'import json,os,pathlib,sys,time\n' +
                           f'with open({str(record)!r}, "a") as file:\n' +
                           '    file.write(json.dumps(sys.argv[1:]) + "\\n")\n' +
                           f'pathlib.Path({str(started)!r}).write_text("unmount")\n' +
                           'deadline = time.monotonic() + 5\n' +
                           f'while not pathlib.Path({str(release)!r}).exists():\n' +
                           '    if time.monotonic() >= deadline: sys.exit(92)\n' +
                           '    time.sleep(.01)\n' +
                           f'os.execv({binary!r}, [{binary!r}] + sys.argv[1:])\n')
        wrapper.chmod(0o700)
        self.environment['PATH'] = str(directory) + os.pathsep + self.environment['PATH']
        return record, started, release

    def owned_sshfs_handle(self, helper, session, path):
        candidates = []
        pending = [helper.pid]
        visited = set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid)
            try:
                for task in Path(f'/proc/{pid}/task').iterdir():
                    try:
                        pending.extend(map(int, (task / 'children').read_text().split()))
                    except FileNotFoundError:
                        pass
                args = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
            except FileNotFoundError:
                continue
            if (args and Path(os.fsdecode(args[0])).name == 'sshfs' and
                    ('fsname=codebridge:' + session).encode() in args and os.fsencode(path) in args):
                candidates.append(pid)
        self.assertEqual(len(candidates), 1, f'Expected one owned SSHFS below helper PID {helper.pid}: {candidates}')
        pid = candidates[0]
        descriptor = os.pidfd_open(pid)
        try:
            # Recheck the unique session/path after opening a stable process
            # handle, then signal only that handle, never an arbitrary PID.
            args = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
            self.assertIn(('fsname=codebridge:' + session).encode(), args)
            self.assertIn(os.fsencode(path), args)
            self.assertEqual(Path(os.fsdecode(args[0])).name, 'sshfs')
        except Exception:
            os.close(descriptor)
            raise
        return pid, descriptor

    def disconnect(self, connection):
        _, path, helper, service, _ = connection
        helper.terminate()
        helper.wait(15)
        service.wait(10)
        self.assertFalse(self.mount_present(path))
        self.assertTrue(path.is_dir())
        self.assertEqual(list(path.iterdir()), [])

    def file_operation(self, script, *paths):
        process = subprocess.Popen([sys.executable, '-c', script, *map(str, paths)],
                                   env=self.environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        self.children.append(process)
        try:
            output, errors = process.communicate(timeout=12)
        except subprocess.TimeoutExpired:
            process.kill()
            try:
                output, errors = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                self.fail('File operation is still blocked after kill; test directory retained for cleanup')
            self.fail('File operation exceeded 12 seconds: ' + output + errors)
        self.assertEqual(process.returncode, 0, output + errors)

    def assert_local_writeback(self, path, expected):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if path.read_bytes() == expected:
                return
            time.sleep(.05)
        self.assertEqual(path.read_bytes(), expected)

    def test_readwrite_handle_only_reading_preserves_entire_file(self):
        original = (bytes(range(1, 256)) * 17)[:4096]
        local = self.root / 'read-only-through-rdwr.bin'
        local.write_bytes(original)
        expected = self.base / 'original.bin'
        expected.write_bytes(original)
        connection = self.connect()
        remote = connection[1] / local.name
        self.file_operation('''import hashlib, pathlib, sys, time
target, expected = map(pathlib.Path, sys.argv[1:])
before = expected.read_bytes()
with target.open('r+b') as file:
    file.seek(128)
    actual = file.read(32)
    assert actual == before[128:160], ('O_RDWR read returned', actual)
    file.seek(0)
    assert hashlib.sha256(file.read()).digest() == hashlib.sha256(before).digest()
time.sleep(.2)
assert hashlib.sha256(target.read_bytes()).digest() == hashlib.sha256(before).digest()
''', remote, expected)
        self.assertEqual(hashlib.sha256(local.read_bytes()).digest(), hashlib.sha256(original).digest())
        self.disconnect(connection)
        self.assertEqual(local.read_bytes(), original)

    def test_same_readwrite_handle_random_write_and_readback_preserves_other_bytes(self):
        original = (bytes(range(1, 256)) * 33)[:8192]
        local = self.root / 'random-access.bin'
        local.write_bytes(original)
        expected = self.base / 'original.bin'
        expected.write_bytes(original)
        connection = self.connect()
        remote = connection[1] / local.name
        offset, patch = 3333, b'\x00\xffCodeBridge\x00random\xff'
        updated = original[:offset] + patch + original[offset + len(patch):]
        self.file_operation('''import os, pathlib, sys
target, expected = map(pathlib.Path, sys.argv[1:])
before = expected.read_bytes()
offset, patch = 3333, b'\\x00\\xffCodeBridge\\x00random\\xff'
after = before[:offset] + patch + before[offset + len(patch):]
with target.open('r+b') as file:
    assert file.read() == before
    file.seek(offset)
    assert file.write(patch) == len(patch)
    file.flush()
    os.fsync(file.fileno())
    file.seek(0)
    assert file.read() == after, 'Same-handle readback changed bytes outside the write range'
    file.seek(offset)
    assert file.read(len(patch)) == patch
''', remote, expected)
        self.assert_local_writeback(local, updated)
        self.assertEqual(remote.read_bytes(), updated)
        self.disconnect(connection)
        self.assertEqual(local.read_bytes(), updated)

    def test_atomic_save_preserves_new_content_and_unrelated_files(self):
        local = self.root / 'atomic-save.bin'
        local.write_bytes(b'old file content')
        untouched = self.root / 'untouched.bin'
        untouched.write_bytes(b'other file stays unchanged')
        expected = self.base / 'replacement.bin'
        updated = bytes(range(256)) * 32
        expected.write_bytes(updated)
        connection = self.connect()
        remote = connection[1] / local.name
        self.file_operation('''import os, pathlib, sys
target, expected = map(pathlib.Path, sys.argv[1:])
temporary = target.with_name(target.name + '.save')
with temporary.open('xb') as file:
    file.write(expected.read_bytes())
    file.flush()
    os.fsync(file.fileno())
os.replace(temporary, target)
assert not temporary.exists()
assert target.read_bytes() == expected.read_bytes()
''', remote, expected)
        self.assert_local_writeback(local, updated)
        self.assertFalse((self.root / (local.name + '.save')).exists())
        self.assertEqual(untouched.read_bytes(), b'other file stays unchanged')
        self.disconnect(connection)
        self.assertEqual(local.read_bytes(), updated)

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

    def assert_old_reference_rejected_then_released(self, kind):
        target = self.home / ('occupied-' + kind)
        target.mkdir()
        local = self.root / 'client-only.txt'
        local.write_bytes(b'preserve client file')
        holder = self.hold_reference(target, kind)
        rejected = self.connect(str(target), expected_error='远端挂载目录仍被进程占用')
        messages = rejected[4].read_text()
        self.assertIn(str(holder.pid), messages)
        self.assertEqual(list(target.iterdir()), [])
        self.assertEqual(local.read_bytes(), b'preserve client file')
        self.assertIsNone(holder.poll())
        self.release_reference(holder)
        connection = self.connect(str(target))
        self.assertEqual(connection[1], target)
        self.assertEqual((target / local.name).read_bytes(), local.read_bytes())
        self.disconnect(connection)

    def test_old_working_directory_blocks_mount_until_same_process_leaves(self):
        self.assert_old_reference_rejected_then_released('cwd')

    def test_old_directory_descriptor_blocks_mount_until_same_process_closes_it(self):
        self.assert_old_reference_rejected_then_released('fd')

    def assert_reference_created_during_mount_is_rejected(self, kind):
        target = self.home / ('raced-' + kind)
        target.mkdir()
        local = self.root / 'client-only.txt'
        local.write_bytes(b'preserve client file')
        started, release = self.pause_before_real_mount()
        holders = []

        def race():
            self.wait_for_file(started)
            holders.append(self.hold_reference(target, kind))
            release.write_text('continue')

        rejected = self.connect(str(target), expected_error='远端挂载目录仍被进程占用', after_launch=race)
        self.assertIn(str(holders[0].pid), rejected[4].read_text())
        self.assertIsNone(holders[0].poll())
        self.assertEqual(list(target.iterdir()), [])
        self.assertEqual(local.read_bytes(), b'preserve client file')
        self.release_reference(holders[0])

    def test_working_directory_acquired_after_precheck_never_becomes_ready(self):
        self.assert_reference_created_during_mount_is_rejected('cwd')

    def test_directory_descriptor_acquired_after_precheck_never_becomes_ready(self):
        self.assert_reference_created_during_mount_is_rejected('fd')

    def test_hidden_file_written_through_old_descriptor_is_preserved_and_never_ready(self):
        target = self.home / 'hidden-race'
        target.mkdir()
        local = self.root / 'client-only.txt'
        local.write_bytes(b'preserve client file')
        before_started, before_release = self.pause_before_real_mount()
        mounted_started, mounted_release = self.pause_after_real_mount()

        def race():
            self.wait_for_file(before_started)
            holder = self.hold_reference(target, 'fd')
            before_release.write_text('continue')
            self.wait_for_file(mounted_started)
            self.assertTrue(os.path.ismount(target))
            self.assertEqual((target / local.name).read_bytes(), local.read_bytes())
            self.release_reference(holder, 'write-and-release')
            self.assertFalse((target / 'server-only.txt').exists(), 'The server file must be hidden below the real mount')
            mounted_release.write_text('continue')

        self.connect(str(target), expected_error='底层', after_launch=race)
        self.assertEqual((target / 'server-only.txt').read_bytes(), b'preserve hidden server file')
        self.assertEqual(local.read_bytes(), b'preserve client file')
        self.assertFalse((self.root / 'server-only.txt').exists())

    def test_preexisting_server_files_are_never_covered_or_changed(self):
        target = self.home / 'nonempty'
        target.mkdir()
        server = target / 'keep.txt'
        server.write_bytes(b'preserve existing server file')
        local = self.root / 'keep.txt'
        local.write_bytes(b'preserve distinct client file')
        self.connect(str(target), expected_error='不是空目录')
        self.assertEqual(server.read_bytes(), b'preserve existing server file')
        self.assertEqual(local.read_bytes(), b'preserve distinct client file')

    @unittest.skipUnless(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'),
                         'requires Linux process handles for safe owned-process fault injection')
    def test_dead_sshfs_mount_is_normally_unmounted_and_directory_preserved(self):
        unmount_commands, unmount_started, unmount_release = self.record_unmount_commands()
        session, path, helper, service, log = self.connect()
        self.assertTrue(self.mount_present(path))
        owned_pid, descriptor = self.owned_sshfs_handle(helper, session, path)
        try:
            signal.pidfd_send_signal(descriptor, signal.SIGKILL)
        finally:
            os.close(descriptor)
        try:
            self.wait_for_file(unmount_started)
            self.assertTrue(self.mount_present(path))
            with self.assertRaises(OSError) as disconnected:
                path.stat()
            self.assertEqual(disconnected.exception.errno, errno.ENOTCONN)
            self.assertFalse(os.path.ismount(path), 'The fixture must reproduce ismount false on a disconnected FUSE mount')
        finally:
            unmount_release.write_text('continue')
        helper.wait(timeout=15)
        service.wait(timeout=10)
        self.assertNotEqual(helper.returncode, 0, 'An unexpectedly killed SSHFS must not report success')
        self.assertFalse(self.mount_present(path),
                         f'Owned SSHFS PID {owned_pid} exited but its FUSE mount remains: ' + log.read_text())
        self.assertTrue(path.is_dir())
        self.assertEqual(list(path.iterdir()), [])
        self.assertTrue(unmount_commands.exists(), 'The helper must explicitly unmount the dead FUSE entry')
        commands = [json.loads(line) for line in unmount_commands.read_text().splitlines()]
        self.assertIn(['-u', str(path)], commands)
        self.assertTrue(all(command == ['-u', str(path)] for command in commands),
                        'Cleanup must use ordinary unmount only: ' + repr(commands))


if __name__ == '__main__':
    unittest.main()
