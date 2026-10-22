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
        import subprocess
        with mock.patch.object(subprocess,'run') as run:
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


class RemoteOperationTests(unittest.TestCase):
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
        with mock.patch.object(mount.subprocess,'run') as run:
            run.return_value.returncode=0;run.return_value.stdout=b'{"ok":true}'
            self.assertEqual(mount.bounded_operation('a'*32,'list'),{'ok':True})
            self.assertEqual(run.call_args.kwargs['timeout'],12)
            self.assertNotIn('shell',run.call_args.kwargs)
    def test_unmounted_directory_rejected(self):
        with mock.patch.object(mount.os.path,'ismount',return_value=False):
            with self.assertRaises(RuntimeError):mount.existing_mount('a'*32)


class VerificationTests(unittest.TestCase):
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
                def settimeout(self,value):pass
                def exec_command(self,command):
                    self.command=command;probe=command.split()[-1]
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
            self.assertRegex(channel.command,r'^\.local/bin/codebridge-mount --verify-readwrite --session [a-f0-9]{32} --probe [a-f0-9]{32}$')
    def test_no_parallel_verification(self):
        b=bridge.Bridge(lambda message:None);b.verify_lock.acquire()
        try:self.assertFalse(b.verify_readwrite()['ok'])
        finally:b.verify_lock.release()
    def test_stale_success_cannot_overwrite_new_connection(self):
        application=app.Application();old=mock.Mock();new=mock.Mock();application.bridge=old;application.state='connected';application.phase='readable'
        def change():application.bridge=new;return {'ok':True,'message':'old success'}
        old.verify_readwrite.side_effect=change
        self.assertFalse(application.verify_readwrite()['ok'])
        self.assertEqual(application.phase,'readable')

if __name__=='__main__':unittest.main()
