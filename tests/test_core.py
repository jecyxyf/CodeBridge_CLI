import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest import mock
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import paramiko
from local_client import bridge, app
from remote_server import mount

class SecurityTests(unittest.TestCase):
    def test_root_link_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'real').mkdir()
            (root/'link').symlink_to(root/'real', target_is_directory=True)
            with self.assertRaises(bridge.BridgeError):
                bridge.checked_root(str(root/'link'))
    def test_proxy_no_direct_fallback(self):
        with mock.patch('socket.create_connection') as direct, mock.patch('socks.socksocket') as factory:
            factory.return_value.connect.side_effect = OSError('failure')
            with self.assertRaises(bridge.BridgeError):
                bridge.connect_socket('example.invalid',22,'socks5://127.0.0.1:9999')
            direct.assert_not_called()
    def test_proxy_credentials_rejected(self):
        with self.assertRaises(bridge.BridgeError):
            bridge.connect_socket('x',22,'http://user:secret@localhost:8080')
    def test_old_rclone_rejected(self):
        with mock.patch('shutil.which', return_value='rclone'), mock.patch('subprocess.run') as run:
            run.return_value.stdout=b'rclone v1.60.1'
            with self.assertRaises(bridge.BridgeError):
                bridge.rclone_command(Path('/tmp'),Path('/tmp/cache'))
    def test_readiness_requires_mount(self):
        self.assertFalse(mount.is_mounted('/tmp/not-a-codebridge-mount'))
    def test_host_fingerprint_checked_before_password(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(bridge,'connect_socket'), mock.patch.object(bridge.paramiko,'Transport') as transport:
            transport.return_value.get_remote_server_key.return_value.asbytes.return_value=b'test key'
            b=bridge.Bridge(lambda _:None)
            b.run(dict(folder=temp,host='host',port='22',username='user',fingerprint='SHA256:wrong',proxy='',remote_os='Linux'), 'secret')
            transport.return_value.auth_password.assert_not_called()
    def test_idle_channel_has_no_timeout_and_password_only(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(bridge,'connect_socket'), mock.patch.object(bridge.paramiko,'Transport') as transport, mock.patch.object(bridge,'rclone_command',return_value=['rclone']), mock.patch.object(bridge.subprocess,'Popen'), mock.patch.object(bridge.threading,'Thread'), mock.patch.object(bridge.Path,'home',return_value=Path(temp)):
            key=transport.return_value.get_remote_server_key.return_value
            key.asbytes.return_value=b'test key'
            b=bridge.Bridge(lambda message: b.stop.set() if message.startswith('身份已验证') else None)
            b.run(dict(folder=temp,host='host',port='22',username='user',fingerprint=bridge.fingerprint(key),proxy='',remote_os='Linux'),'secret')
            transport.return_value.open_session.return_value.settimeout.assert_called_once_with(None)
            transport.return_value.auth_password.assert_called_once_with('user','secret',fallback=False)
    def test_binary_pipe(self):
        data=bytes(range(256))*4096
        class Channel:
            def __init__(self): self.received=bytearray()
            def sendall(self,data): self.received.extend(data)
            def shutdown_write(self): pass
        b=bridge.Bridge(lambda _:None)
        with tempfile.TemporaryFile() as file:
            file.write(data);file.seek(0)
            b.process=mock.Mock(stdout=file)
            b.channel=Channel()
            b._pipe_to_remote()
            self.assertEqual(bytes(b.channel.received),data)

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config=Path(self.temp.name)/'settings.json'
        config_patch=mock.patch.object(app,'CONFIG',self.config)
        config_patch.start()
        self.addCleanup(config_patch.stop)
        self.app=app.Application()
        self.server=app.ThreadingHTTPServer(('127.0.0.1',0),app.make_handler(self.app,'test-token'))
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown();self.server.server_close()
    def test_missing_token_denied(self):
        with self.assertRaises(HTTPError) as error:
            urlopen(self.url+'/api/status')
        self.assertEqual(error.exception.code,403)
    def test_cross_origin_denied(self):
        req=Request(self.url+'/api/status',headers={'X-CodeBridge-Token':'test-token','Origin':'https://evil.example'})
        with self.assertRaises(HTTPError) as error:urlopen(req)
        self.assertEqual(error.exception.code,403)
    def test_valid_status(self):
        req=Request(self.url+'/api/status',headers={'X-CodeBridge-Token':'test-token'})
        self.assertEqual(json.load(urlopen(req))['state'],'disconnected')
    def test_proxy_password_not_persisted(self):
        with self.assertRaises(ValueError):
            self.app.connect(dict(remote_os='Linux',proxy='http://user:secret@host:8000'))
        self.assertFalse(self.config.exists())
    def test_password_not_persisted(self):
        with mock.patch.object(app.Bridge,'run'):
            self.app.connect(dict(remote_os='Linux',password='DO-NOT-SAVE'))
            self.app.worker.join()
            saved=self.config.read_text()
            self.assertNotIn('DO-NOT-SAVE',saved)
            self.assertNotIn('password',saved)

class PipeSocket:
    def get_name(self):return "stdio-test"
    def __init__(self, process):self.process=process
    def send(self, data):return os.write(self.process.stdin.fileno(),data)
    def recv(self, size):return os.read(self.process.stdout.fileno(),size)
    def gettimeout(self):return None
    def settimeout(self,value):pass
    def close(self):self.process.stdin.close()

@unittest.skipUnless(os.environ.get('CODEBRIDGE_TEST_RCLONE'), 'set CODEBRIDGE_TEST_RCLONE to run actual rclone tests')
class RcloneIntegration(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)
        self.root=self.base/'root';self.root.mkdir()
        self.cache=self.base/'cache';self.cache.mkdir()
        self.outside=self.base/'outside-secret';self.outside.write_bytes(b'not shared')
        (self.root/'escape').symlink_to(self.outside)
        with mock.patch('shutil.which',return_value=os.environ['CODEBRIDGE_TEST_RCLONE']):
            cmd=bridge.rclone_command(self.root,self.cache)
        self.process=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0)
        self.sftp=paramiko.SFTPClient(PipeSocket(self.process))
    def tearDown(self):
        self.sftp.close()
        self.process.wait(timeout=10)
        error=self.process.stderr.read().decode()
        self.assertEqual(self.process.returncode,0,error)
        self.process.stdout.close();self.process.stderr.close()
        self.temp.cleanup()
    def test_random_write_binary_and_rename(self):
        data=bytes(range(256))*1024
        with self.sftp.open('/binary','w') as f:f.write(data)
        with self.sftp.open('/binary','r+') as f:
            f.seek(32000);f.write(b'\x00\xffEDIT')
        expected=data[:32000]+b'\x00\xffEDIT'+data[32006:]
        with self.sftp.open('/binary','r') as f:self.assertEqual(f.read(),expected)
        self.sftp.rename('/binary','/renamed')
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            if (self.root/'renamed').exists() and (self.root/'renamed').read_bytes()==expected:break
            time.sleep(.05)
        self.assertEqual((self.root/'renamed').read_bytes(),expected)
    def test_locally_created_probe_writeback(self):
        path=self.root/'.codebridge-probe-test'
        path.write_bytes(b'before')
        with self.sftp.open('/.codebridge-probe-test','r') as f:self.assertEqual(f.read(),b'before')
        with self.sftp.open('/.codebridge-probe-test','w') as f:f.write(b'after!')
        deadline=time.monotonic()+5
        while time.monotonic()<deadline and path.read_bytes()!=b'after!':time.sleep(.05)
        self.assertEqual(path.read_bytes(),b'after!')
        self.assertEqual(bridge.probe_bytes(path,(b'before',b'after!'))[0],b'after!')
    def test_traversal_and_symlink_not_exposed(self):
        self.assertNotIn('escape',self.sftp.listdir('/'))
        for path in ('/escape','/../outside-secret','/../../outside-secret'):
            with self.assertRaises(OSError):self.sftp.open(path,'r')
    def test_create_delete_and_local_visibility(self):
        self.sftp.mkdir('/folder')
        with self.sftp.open('/folder/a','w') as f:f.write(b'hello')
        self.sftp.remove('/folder/a');self.sftp.rmdir('/folder')
        (self.root/'local').write_bytes(b'local edit')
        time.sleep(1.1)
        with self.sftp.open('/local','r') as f:self.assertEqual(f.read(),b'local edit')

if __name__=='__main__':unittest.main()
