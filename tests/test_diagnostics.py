import json
import os
import socket
import time
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

from local_client import app, bridge, diagnostics
from remote_server import mount


class DiagnosticTests(unittest.TestCase):
    def test_http_connect_preserves_coalesced_banner(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1)
        port=listener.getsockname()[1];requests=[]
        def proxy():
            connection,_=listener.accept()
            with connection:
                data=b''
                while b'\r\n\r\n' not in data:data+=connection.recv(1024)
                requests.append(data)
                connection.sendall(b'HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-test\r\n')
            listener.close()
        worker=threading.Thread(target=proxy);worker.start()
        result=diagnostics.test_ssh({'host':'target.invalid','port':2222,'proxy':f'http://127.0.0.1:{port}'},True)
        worker.join(2)
        self.assertTrue(result['ok'],result)
        self.assertIn(b'CONNECT target.invalid:2222 HTTP/1.1',requests[0])
    def test_http_proxy_rejection_no_direct_fallback(self):
        fake=mock.Mock();fake.recv.side_effect=[bytes([byte]) for byte in b'HTTP/1.1 403 Forbidden\r\n\r\n']
        with mock.patch.object(bridge.socket,'create_connection',return_value=fake) as connect:
            with self.assertRaises(bridge.BridgeError):bridge.connect_socket('target.invalid',22,'http://proxy.invalid:8080')
        connect.assert_called_once_with(('proxy.invalid',8080),timeout=15)
        fake.close.assert_called_once()
    def test_connect_injection_rejected(self):
        with self.assertRaises(bridge.BridgeError):bridge.connect_socket('a\r\nInjected: true',22,'http://localhost:8080')
    def test_diagnostic_subprocess_bounds_dns_and_omits_password(self):
        with mock.patch.object(diagnostics,'bounded_process') as run:
            run.return_value.returncode=0;run.return_value.stdout='{"ok":true}'
            self.assertTrue(diagnostics.bounded_test({'host':'server','port':22,'password':'never-send'})['ok'])
            self.assertEqual(run.call_args.kwargs['timeout'],30)
            self.assertNotIn('never-send',run.call_args.kwargs['input'])
            self.assertNotIn('never-send',str(run.call_args.args))
    def test_ssh_banner_through_proxy(self):
        sock=mock.Mock()
        sock.recv.return_value=b'SSH-2.0-test\r\n'
        with mock.patch.object(diagnostics,'connect_socket',return_value=sock) as connect:
            result=diagnostics.test_ssh({'host':'server.example','port':2222,'proxy':'socks5://localhost:1080'},True)
        self.assertTrue(result['ok'])
        self.assertEqual(result['route'],'代理')
        connect.assert_called_once_with('server.example',2222,'socks5://localhost:1080')
        sock.close.assert_called_once()
    def test_open_port_is_not_ssh_success(self):
        sock=mock.Mock();sock.recv.side_effect=[b'HTTP/1.1 200 OK\r\n',b'']
        with mock.patch.object(diagnostics,'connect_socket',return_value=sock):
            self.assertFalse(diagnostics.test_ssh({'host':'server','port':22})['ok'])
    def test_proxy_required(self):
        with mock.patch.object(diagnostics,'connect_socket') as connect:
            result=diagnostics.test_ssh({'host':'server','port':22},True)
        self.assertFalse(result['ok']);connect.assert_not_called()
    def test_invalid_target(self):
        for data in ({'host':'a\nb','port':22},{'host':'server','port':0},{'host':'server','port':'bad'}):
            with self.assertRaises(bridge.BridgeError):diagnostics.target(data)
    def test_untrusted_exception_not_reflected(self):
        with mock.patch.object(diagnostics,'connect_socket',side_effect=OSError('secret-password')):
            result=diagnostics.test_ssh({'host':'server','port':22})
        self.assertFalse(result['ok']);self.assertNotIn('secret-password',result['message'])
    def test_diagnostics_do_not_change_connection_state(self):
        application=app.Application();application.state='connected';application.phase='readable'
        with mock.patch.object(diagnostics,'connect_socket',side_effect=OSError()):
            diagnostics.test_ssh({'host':'server','port':22})
        self.assertEqual(application.state,'connected');self.assertEqual(application.phase,'readable')


class RemoteHomeFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        environment_patch = mock.patch.dict(os.environ, {'HOME': str(self.home)})
        environment_patch.start()
        self.addCleanup(environment_patch.stop)
        home_patch = mock.patch.object(mount.Path, 'home', return_value=self.home)
        home_patch.start()
        self.addCleanup(home_patch.stop)
        config_patch = mock.patch.object(app, 'CONFIG', self.home / 'settings.json')
        config_patch.start()
        self.addCleanup(config_patch.stop)


@unittest.skipIf(os.name == 'nt', 'fixed directory mounts are for Linux/macOS')
class FixedMountTests(RemoteHomeFixture):
    def test_mount_directory_is_fixed_and_reused_when_empty(self):
        first = mount.mountpoint('a' * 32)
        second = mount.mountpoint('b' * 32)
        self.assertEqual(Path(first).parent, self.home)
        self.assertRegex(Path(first).name, '^[a-z]{5}$')
        self.assertEqual(first, second)
        self.assertEqual(Path(first).stat().st_mode & 0o777, 0o700)
        config = self.home / '.codebridge' / 'server.json'
        self.assertEqual(json.loads(config.read_text()), {'mount_directory': Path(first).name})
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)

    def test_existing_contents_are_never_hidden_or_removed(self):
        target = mount.initialize_server()
        file = target / 'keep'
        file.write_bytes(b'important')
        with self.assertRaisesRegex(RuntimeError, '不是空目录'):
            mount.mountpoint('a' * 32)
        self.assertEqual(file.read_bytes(), b'important')

    def test_symbolic_link_is_rejected(self):
        target = mount.initialize_server()
        target.rmdir()
        destination = self.home / 'existing'
        destination.mkdir()
        target.symlink_to(destination, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, '符号链接'):
            mount.mountpoint('a' * 32)

    def test_existing_mount_is_not_reused(self):
        mount.initialize_server()
        with mock.patch.object(mount.os.path, 'ismount', return_value=True):
            with self.assertRaisesRegex(RuntimeError, '已被挂载'):
                mount.mountpoint('a' * 32)

    def test_second_connection_cannot_take_mount_ownership(self):
        with mount.mount_lock('mount-session.json'):
            with self.assertRaisesRegex(RuntimeError, '已有连接'):
                mount.mount_lock('mount-session.json')
        with mount.mount_lock('mount-session.json'):
            pass

    def test_probe_locks_prevent_unmount_and_allow_parallel_reads(self):
        with mount.mount_access():
            with mount.mount_access():
                with self.assertRaises(RuntimeError):
                    mount.mount_lock('mount-access.lock')
        with mount.mount_lock('mount-access.lock'):
            pass

    def test_current_session_is_required_for_fixed_mount(self):
        session = 'a' * 32
        path = str(mount.initialize_server())
        with mount.mount_lock('mount-session.json') as file:
            json.dump({'session': session, 'mount': path}, file)
            file.flush()
            with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda candidate: str(candidate) == path):
                self.assertEqual(mount.existing_mount(session), path)
                with self.assertRaisesRegex(RuntimeError, '会话已改变'):
                    mount.existing_mount('b' * 32)

    def test_in_flight_legacy_mount_can_still_be_verified(self):
        session = 'a' * 32
        path = self.home / '.codebridge' / 'mounts' / session
        with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda candidate: candidate == path):
            self.assertEqual(mount.existing_mount(session), str(path))

    def test_session_record_does_not_replace_mount_check(self):
        path = str(mount.initialize_server())
        with mount.mount_lock('mount-session.json') as file:
            json.dump({'session': 'a' * 32, 'mount': path}, file)
            file.flush()
        with self.assertRaisesRegex(RuntimeError, '不是挂载点|未报告'):
            mount.existing_mount('a' * 32)

    def test_name_collision_does_not_reuse_user_directory(self):
        occupied = self.home / 'taken'
        occupied.mkdir()
        (occupied / 'keep').write_bytes(b'important')
        with mock.patch.object(mount.secrets, 'choice', side_effect=list('takenfresh')):
            path = mount.initialize_server()
        self.assertEqual(path.name, 'fresh')
        self.assertEqual((occupied / 'keep').read_bytes(), b'important')

    def test_corrupt_config_is_backed_up_with_warning_and_new_directory(self):
        with mock.patch.object(mount.secrets, 'choice', side_effect=list('oldernewer')):
            old = mount.initialize_server()
            (old / 'keep').write_bytes(b'important')
            config = self.home / '.codebridge' / 'server.json'
            config.write_text('{broken', encoding='utf-8')
            with mock.patch.object(mount, 'emit') as warning:
                new = mount.initialize_server()
        self.assertEqual(old.name, 'older')
        self.assertEqual(new.name, 'newer')
        self.assertEqual((old / 'keep').read_bytes(), b'important')
        backups = list(config.parent.glob('server.corrupt-*.json'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), '{broken')
        self.assertEqual(json.loads(config.read_text()), {'mount_directory': 'newer'})
        self.assertEqual(warning.call_args.args[0], 'WARNING')
        self.assertIn(str(backups[0]), warning.call_args.args[1]['message'])

    def test_invalid_config_name_is_regenerated_inside_home(self):
        mount.initialize_server()
        config = self.home / '.codebridge' / 'server.json'
        config.write_text('{"mount_directory":"../outside"}', encoding='utf-8')
        with mock.patch.object(mount, 'emit') as warning:
            path = mount.initialize_server()
        self.assertEqual(path.parent, self.home)
        self.assertRegex(path.name, '^[a-z]{5}$')
        warning.assert_called_once()

    def test_custom_mount_does_not_change_saved_default(self):
        default = mount.initialize_server()
        config = self.home / '.codebridge' / 'server.json'
        saved = config.read_bytes()
        path = mount.mountpoint('a' * 32, '~/custom project')
        self.assertEqual(path, str(self.home / 'custom project'))
        self.assertTrue(Path(path).is_dir())
        self.assertEqual(config.read_bytes(), saved)
        self.assertEqual(mount.mountpoint('b' * 32), str(default))

    def test_custom_nonempty_path_is_rejected_without_changing_files(self):
        custom = self.home / 'custom'
        custom.mkdir()
        (custom / 'keep').write_bytes(b'important')
        with self.assertRaisesRegex(RuntimeError, '不是空目录'):
            mount.mountpoint('a' * 32, str(custom))
        self.assertEqual((custom / 'keep').read_bytes(), b'important')

    def test_relative_custom_path_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, '绝对路径'):
            mount.mountpoint('a' * 32, 'relative-path')

    def test_custom_mount_is_verified_against_active_session(self):
        path = mount.mountpoint('a' * 32, '~/custom')
        with mount.mount_lock('mount-session.json') as file:
            json.dump({'session': 'a' * 32, 'mount': path}, file)
            file.flush()
            with mock.patch.object(mount.os.path, 'ismount', side_effect=lambda candidate: str(candidate) == path):
                self.assertEqual(mount.existing_mount('a' * 32), path)
                with self.assertRaisesRegex(RuntimeError, '会话已改变'):
                    mount.existing_mount('b' * 32)


class RemoteOperationTests(RemoteHomeFixture):
    def test_list_empty_directory(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(mount,'existing_mount',return_value=directory):
            self.assertEqual(mount.operation_worker('a'*32,'list'),{'ok':True})
    def test_refuse_existing_non_probe_content(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(mount,'existing_mount',return_value=directory):
            probe='b'*32;file=Path(directory)/('.codebridge-probe-'+probe);file.write_bytes(b'important')
            with self.assertRaises(RuntimeError):mount.operation_worker('a'*32,'rw',probe)
            self.assertEqual(file.read_bytes(),b'important')
    def test_read_write_exact_probe_only(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(mount,'existing_mount',return_value=directory):
            probe='b'*32;file=Path(directory)/('.codebridge-probe-'+probe)
            file.write_bytes(('CodeBridge:'+probe+':before').encode())
            other=Path(directory)/'untouched';other.write_bytes(b'keep')
            self.assertEqual(mount.operation_worker('a'*32,'rw',probe),{'ok':True,'probe':probe})
            self.assertEqual(file.read_bytes(),('CodeBridge:'+probe+':after').encode())
            self.assertEqual(other.read_bytes(),b'keep')
    def test_probe_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(mount,'existing_mount',return_value=directory):
            probe='b'*32;outside=Path(directory)/'outside';outside.write_bytes(b'keep')
            (Path(directory)/('.codebridge-probe-'+probe)).symlink_to(outside)
            with self.assertRaises(RuntimeError):mount.operation_worker('a'*32,'rw',probe)
            self.assertEqual(outside.read_bytes(),b'keep')
    def test_operation_subprocess_is_bounded(self):
        with mock.patch.object(mount,'bounded_process') as run:
            run.return_value.returncode=0;run.return_value.stdout=b'{"ok":true}'
            self.assertEqual(mount.bounded_operation('a'*32,'list'),{'ok':True})
            self.assertEqual(run.call_args.args[1],12)
            self.assertIn('--internal-worker',run.call_args.args[0])
    def test_unmounted_directory_rejected(self):
        with mock.patch.object(mount.os.path,'ismount',return_value=False):
            with self.assertRaises(RuntimeError):mount.existing_mount('a'*32)


class VerificationTests(RemoteHomeFixture):
    def test_exec_ack_timeout_closes_channel(self):
        finished=threading.Event()
        class Channel:
            def exec_command(self,command):finished.wait(2)
            def close(self):finished.set()
        started=time.monotonic()
        with self.assertRaises(bridge.BridgeError):bridge.execute_bounded(Channel(),'fixed-safe-command',timeout=.05)
        self.assertTrue(finished.is_set());self.assertLess(time.monotonic()-started,1)
    def test_replaced_inode_with_exact_nonce_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'probe';path.write_bytes(b'before')
            replacement=Path(directory)/'replacement';replacement.write_bytes(b'after');replacement.replace(path)
            self.assertEqual(bridge.probe_bytes(path,(b'before',b'after'))[0],b'after')
    def test_cleanup_never_deletes_changed_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'probe';path.write_bytes(b'other-content')
            with self.assertRaises(bridge.BridgeError):bridge.probe_bytes(path,(b'before',b'after'))
            self.assertEqual(path.read_bytes(),b'other-content')
    def test_roundtrip_and_exact_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);other=root/'untouched';other.write_bytes(b'keep')
            b=bridge.Bridge(lambda message:None);b.root=root;b.session='a'*32;b.mount='/test';b.remote_os='Linux';b.mounted=True;b.client=mock.Mock()
            class Channel:
                commands = []
                def settimeout(self,value):pass
                def exec_command(self,command):
                    self.command=command;self.commands.append(command)
                    if '--connection-result success' in command:
                        self.response=json.dumps({'ok':True,'session':'a'*32,'result':'success'}).encode()
                        return
                    probe=command.split()[-1]
                    with mock.patch.object(mount,'existing_mount',return_value=directory):self.response=json.dumps(mount.operation_worker('a'*32,'rw',probe)).encode()
                def recv_ready(self):return bool(self.response)
                def recv_stderr_ready(self):return False
                def recv(self,size):data=self.response;self.response=b'';return data
                def exit_status_ready(self):return True
                def recv_exit_status(self):return 0
                def close(self):pass
            channel=Channel();b.client.open_session.return_value=channel
            result=b.verify_readwrite()
            self.assertTrue(result['ok'],result)
            self.assertEqual(list(root.iterdir()),[other]);self.assertEqual(other.read_bytes(),b'keep')
            self.assertRegex(channel.commands[0],r'^\.local/bin/codebridge-mount --verify-readwrite --session [a-f0-9]{32} --probe [a-f0-9]{32}$')
            self.assertIn('--connection-result success',channel.commands[1])
    def test_no_parallel_verification(self):
        b=bridge.Bridge(lambda message:None);b.verify_lock.acquire()
        try:self.assertFalse(b.verify_readwrite()['ok'])
        finally:b.verify_lock.release()
    def test_stale_success_cannot_overwrite_new_connection(self):
        application=app.Application();old=mock.Mock();new=mock.Mock();application.bridge=old;application.state='connected';application.phase='readable'
        old.stop = threading.Event()
        def change():
            application.bridge=new;application.phase='mounting';application.message='new connection'
            return {'ok':True,'message':'old success'}
        old.verify_readwrite.side_effect=change
        self.assertTrue(application.verify_readwrite()['pending'])
        application.readwrite_worker.join(2)
        self.assertFalse(application.readwrite_worker.is_alive())
        self.assertEqual(application.phase,'mounting')
        self.assertEqual(application.message,'new connection')
        self.assertIsNone(application.readwrite_result)


class AutomaticVerificationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        config_patch = mock.patch.object(app, 'CONFIG', Path(temporary.name) / 'settings.json')
        config_patch.start()
        self.addCleanup(config_patch.stop)
        self.application = app.Application()
        self.connection = self.new_connection()
        self.application.bridge = self.connection
        self.application.state = 'connecting'
        self.application.phase = 'mounting'
        self.started = threading.Event()
        self.release = threading.Event()
        self.workers = []
        self.addCleanup(self.finish_workers)

    def new_connection(self):
        connection = bridge.Bridge(self.application.notify)
        connection.verify_readwrite = mock.Mock(return_value={'ok': True, 'message': 'verified'})
        return connection

    def ready(self, mount_path='/test-mount'):
        self.application.notify('已连接，远端挂载路径：' + mount_path)
        worker = self.application.readwrite_worker
        self.workers.append(worker)
        return worker

    def finish_workers(self):
        self.release.set()
        for worker in self.workers:
            worker.join(2)
            self.assertFalse(worker.is_alive(), 'verification worker did not finish')

    def wait_for(self, worker):
        worker.join(2)
        self.assertFalse(worker.is_alive(), 'verification worker did not finish')

    def blocked_verification(self):
        self.started.set()
        self.release.wait(2)
        return {'ok': True, 'message': 'verified'}

    def test_only_readable_mount_starts_automatic_verification(self):
        self.application.notify('挂载已建立，正在检查目录：/test-mount')
        self.connection.verify_readwrite.assert_not_called()
        self.assertIsNone(self.application.readwrite_worker)
        self.wait_for(self.ready())
        self.connection.verify_readwrite.assert_called_once_with()
        snapshot = self.application.snapshot()
        self.assertEqual(snapshot['state'], 'connected')
        self.assertEqual(snapshot['phase'], 'write_verified')
        self.assertEqual(snapshot['readwrite_result'], {'ok': True, 'message': 'verified'})
        snapshot['readwrite_result']['ok'] = False
        self.assertTrue(self.application.snapshot()['readwrite_result']['ok'])

    def test_duplicate_ready_and_status_polling_do_not_repeat_verification(self):
        self.wait_for(self.ready())
        first_worker = self.application.readwrite_worker
        self.application.notify('已连接，远端挂载路径：/test-mount')
        self.application.snapshot()
        self.application.snapshot()
        self.assertIs(self.application.readwrite_worker, first_worker)
        self.assertEqual(self.application.phase, 'write_verified')
        self.connection.verify_readwrite.assert_called_once_with()

    def test_manual_request_cannot_overlap_automatic_verification(self):
        self.connection.verify_readwrite.side_effect = self.blocked_verification
        worker = self.ready()
        self.assertTrue(self.started.wait(2))
        self.assertEqual(self.application.snapshot()['phase'], 'write_verifying')
        self.assertIsNone(self.application.snapshot()['readwrite_result'])
        self.assertFalse(self.application.verify_readwrite()['ok'])
        self.assertEqual(self.application.phase, 'write_verifying')
        self.application.notify('已连接，远端挂载路径：/test-mount')
        self.connection.verify_readwrite.assert_called_once_with()
        self.release.set()
        self.wait_for(worker)
        self.assertEqual(self.application.phase, 'write_verified')

    def test_failure_preserves_connection_and_manual_retry(self):
        self.connection.verify_readwrite.return_value = {'ok': False, 'message': 'write-back timed out'}
        self.wait_for(self.ready())
        self.assertEqual(self.application.state, 'connected')
        self.assertEqual(self.application.phase, 'readable')
        self.assertFalse(self.application.snapshot()['readwrite_result']['ok'])
        self.application.notify('已连接，远端挂载路径：/test-mount')
        self.connection.verify_readwrite.assert_called_once_with()
        self.connection.verify_readwrite.return_value = {'ok': True, 'message': 'retry verified'}
        self.assertTrue(self.application.verify_readwrite()['pending'])
        self.wait_for(self.application.readwrite_worker)
        self.assertEqual(self.connection.verify_readwrite.call_count, 2)
        self.assertEqual(self.application.phase, 'write_verified')
        self.assertEqual(self.application.snapshot()['readwrite_result']['message'], 'retry verified')

    def test_each_new_connection_verifies_once_and_discards_old_result(self):
        self.connection.verify_readwrite.side_effect = self.blocked_verification
        old_worker = self.ready()
        self.assertTrue(self.started.wait(2))
        new = self.new_connection()
        new.verify_readwrite.return_value = {'ok': True, 'message': 'new connection verified'}
        self.application.bridge = new
        self.application.state = 'connecting'
        self.wait_for(self.ready('/new-mount'))
        self.release.set()
        self.wait_for(old_worker)
        self.connection.verify_readwrite.assert_called_once_with()
        new.verify_readwrite.assert_called_once_with()
        snapshot = self.application.snapshot()
        self.assertEqual(snapshot['mount_path'], '/new-mount')
        self.assertEqual(snapshot['phase'], 'write_verified')
        self.assertEqual(snapshot['message'], 'new connection verified')
        self.assertEqual(snapshot['readwrite_result']['message'], 'new connection verified')

    def test_disconnect_before_worker_starts_prevents_probe(self):
        with self.application.lock:
            worker = self.ready()
            self.connection.stop.set()
            self.application.state = 'disconnected'
            self.application.phase = 'idle'
        self.wait_for(worker)
        self.connection.verify_readwrite.assert_not_called()
        self.assertEqual(self.application.phase, 'idle')
        self.assertIsNone(self.application.snapshot()['readwrite_result'])

    def test_disconnect_during_verification_discards_late_result(self):
        self.connection.verify_readwrite.side_effect = self.blocked_verification
        worker = self.ready()
        self.assertTrue(self.started.wait(2))
        self.connection.stop.set()
        self.application.notify('已断开')
        self.release.set()
        self.wait_for(worker)
        self.assertEqual(self.application.state, 'disconnected')
        self.assertEqual(self.application.phase, 'idle')
        self.assertEqual(self.application.message, '已断开')
        self.assertIsNone(self.application.snapshot()['readwrite_result'])

    def test_unexpected_error_does_not_leave_verification_running(self):
        self.connection.verify_readwrite.side_effect = RuntimeError('private exception detail')
        self.wait_for(self.ready())
        self.assertEqual(self.application.state, 'connected')
        self.assertEqual(self.application.phase, 'readable')
        self.assertFalse(self.application.snapshot()['readwrite_result']['ok'])
        self.assertNotIn('private exception detail', self.application.message)

    def test_server_warning_survives_verification_and_does_not_change_phase(self):
        self.application.notify('警告：配置损坏，已备份并重新生成')
        self.assertEqual(self.application.phase, 'mounting')
        self.wait_for(self.ready())
        snapshot = self.application.snapshot()
        self.assertEqual(snapshot['phase'], 'write_verified')
        self.assertEqual(snapshot['warnings'], ['配置损坏，已备份并重新生成'])
        snapshot['warnings'].clear()
        self.assertEqual(len(self.application.snapshot()['warnings']), 1)

if __name__=='__main__':unittest.main()
