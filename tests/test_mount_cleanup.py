"""A replaced mount must never be unmounted by our SSHFS exit handler."""
from contextlib import ExitStack, nullcontext
import io
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from remote_server import mount


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux mount ownership checks')
class MountCleanupTests(unittest.TestCase):
    session = 'a' * 32
    path = '/test/codebridge-mount'
    source = 'codebridge:' + session

    def entry(self, **changes):
        return {'id': 41, 'mount': self.path, 'type': 'fuse.sshfs',
                'source': self.source, **changes}

    def run_session(self, mount_entries):
        # Exercise run()'s real cleanup, unmount(), stop_mount_process() and
        # stop_process(). Only external process/filesystem boundaries are fake.
        process = mock.Mock(returncode=None, stderr=io.BytesIO())
        process.poll.side_effect = lambda: process.returncode
        process.terminate.side_effect = lambda: setattr(process, 'returncode', -15)
        process.kill.side_effect = lambda: setattr(process, 'returncode', -9)
        process.wait.side_effect = KeyboardInterrupt
        self.addCleanup(process.stderr.close)
        owner = tempfile.TemporaryFile(mode='w+', encoding='utf-8')
        self.addCleanup(owner.close)
        with ExitStack() as stack:
            for name, value in (
                ('stage', None), ('LOGGER', mock.Mock()),
                ('executable', '/test/sshfs'), ('passive_option', 'passive'),
                ('mount_lock', owner), ('mountpoint', self.path),
                ('open_mount_guard', mock.Mock()), ('check_mount_occupancy', {}),
                ('is_mounted', True), ('bounded_operation', {'ok': True}),
            ):
                if name == 'LOGGER':
                    stack.enter_context(mock.patch.object(mount, name, value))
                else:
                    stack.enter_context(mock.patch.object(mount, name, return_value=value))
            stack.enter_context(mock.patch.object(mount, 'mount_access', side_effect=lambda **_: nullcontext()))
            stack.enter_context(mock.patch.object(mount.os.path, 'exists', return_value=True))
            stack.enter_context(mock.patch.object(mount.subprocess, 'Popen', return_value=process))
            stack.enter_context(mock.patch.object(mount.shutil, 'which', return_value='/test/fusermount3'))
            entries = stack.enter_context(mock.patch.object(mount, 'linux_mount_entry', side_effect=mount_entries))
            commands = stack.enter_context(mock.patch.object(
                mount, 'bounded_process', return_value=subprocess.CompletedProcess([], 0, b'', b'')))
            events = stack.enter_context(mock.patch.object(mount, 'emit'))
            result = mount.run(self.session)
        return result, process, entries, commands, events

    def assert_only_owned_process_killed(self, process, commands, events):
        commands.assert_not_called()
        process.terminate.assert_not_called()
        process.kill.assert_called_once_with()
        self.assertEqual(process.returncode, -9)
        warnings = [call.args[1]['message'] for call in events.call_args_list
                    if call.args[0] == 'WARNING']
        self.assertTrue(any('仅终止本次 SSHFS' in message for message in warnings), warnings)

    def test_changed_source_never_unmounts_or_gracefully_stops_sshfs(self):
        foreign = self.entry(source='another-filesystem')
        result, process, entries, commands, events = self.run_session([self.entry(), foreign, foreign])
        self.assertEqual(result, 130)
        self.assertEqual(entries.call_count, 3)
        self.assert_only_owned_process_killed(process, commands, events)

    def test_replaced_mount_id_is_rejected_even_with_the_same_source(self):
        replacement = self.entry(id=42)
        result, process, entries, commands, events = self.run_session([self.entry(), replacement, replacement])
        self.assertEqual(result, 130)
        self.assertEqual(entries.call_count, 3)
        self.assert_only_owned_process_killed(process, commands, events)

    def test_unreadable_mount_identity_never_runs_path_based_cleanup(self):
        result, process, entries, commands, events = self.run_session([
            self.entry(), RuntimeError('mountinfo unavailable'), RuntimeError('mountinfo unavailable'),
        ])
        self.assertEqual(result, 130)
        self.assertEqual(entries.call_count, 3)
        self.assert_only_owned_process_killed(process, commands, events)

    def test_foreign_mount_before_ready_is_preserved_and_never_reported_ready(self):
        foreign = self.entry(source='another-filesystem')
        result, process, entries, commands, events = self.run_session([foreign, foreign, foreign])
        self.assertEqual(result, 1)
        self.assertEqual(entries.call_count, 3)
        self.assertNotIn('READY', [call.args[0] for call in events.call_args_list])
        self.assert_only_owned_process_killed(process, commands, events)

    def test_owned_mount_uses_normal_unmount_then_graceful_process_stop(self):
        result, process, entries, commands, events = self.run_session([self.entry(), self.entry(), None])
        self.assertEqual(result, 130)
        self.assertEqual(entries.call_count, 3)
        commands.assert_called_once_with(['/test/fusermount3', '-u', self.path], 10, '远端卸载')
        process.terminate.assert_called_once_with()
        process.kill.assert_not_called()
        self.assertEqual(process.returncode, -15)
        self.assertIn('READY', [call.args[0] for call in events.call_args_list])


if __name__ == '__main__':
    unittest.main()
