"""Opt-in real HTTP -> SSH -> SFTP -> SSHFS -> writeback integration.

Only loopback fixture listeners, isolated program directories and temporary homes
are used. Run with CODEBRIDGE_TEST_RCLONE and sshfs on PATH on a Linux FUSE host.
"""
import csv
from datetime import date, datetime
import http.client
import json
import logging
import os
from pathlib import Path
import queue
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import unittest
from urllib.parse import parse_qs, urlsplit

import paramiko


REPOSITORY = Path(__file__).resolve().parents[1]
AVAILABLE = (sys.platform.startswith('linux') and os.environ.get('CODEBRIDGE_TEST_RCLONE')
             and Path('/dev/fuse').exists() and shutil.which('sshfs'))


def mounted_paths(base):
    """Read kernel mount records without touching potentially stalled FUSE paths."""
    paths = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        raw = line.split()[4]
        for escaped, literal in ((r'\040', ' '), (r'\011', '\t'), (r'\012', '\n'), (r'\134', '\\')):
            raw = raw.replace(escaped, literal)
        path = Path(raw)
        if path.is_relative_to(base):
            paths.append(path)
    return paths


def process_identity(pid):
    try:
        # starttime prevents teardown from signalling a reused process ID.
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def stop_tree(process, grace=5):
    """Bound cleanup of fixture-owned descendants, including new process groups."""
    if process.poll() is not None:
        return
    owned = {}

    def collect(pid):
        identity = process_identity(pid)
        if identity is None or pid in owned:
            return
        owned[pid] = identity
        try:
            children = Path(f'/proc/{pid}/task/{pid}/children').read_text().split()
        except OSError:
            children = []
        for child in children:
            collect(int(child))

    collect(process.pid)
    if process.poll() is None:
        try:
            process.terminate()
            process.wait(grace)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            pass
    for pid, identity in reversed(list(owned.items())):
        if process_identity(pid) == identity:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        process.wait(1)
    except subprocess.TimeoutExpired:
        pass


class FixtureSSH(paramiko.ServerInterface):
    """Accept fixture credentials and relay authenticated exec channels to helper."""

    def __init__(self, helper, environment, cwd, password):
        self.helper, self.environment, self.cwd = helper, environment, cwd
        self.password = password
        self.authenticated = threading.Event()
        self.stopping = threading.Event()
        self.children, self.channels, self.errors, self.commands = [], [], [], []
        self.transport = None
        self.listener = socket.socket()
        self.listener.bind(('127.0.0.1', 0))
        self.listener.listen(1)
        self.listener.settimeout(.2)
        self.port = self.listener.getsockname()[1]
        self.key = paramiko.RSAKey.generate(2048)
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def get_allowed_auths(self, username):
        return 'password'

    def check_auth_password(self, username, password):
        if username == 'fixture' and secrets.compare_digest(password, self.password):
            self.authenticated.set()
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def check_channel_request(self, kind, channel_id):
        return paramiko.OPEN_SUCCEEDED if kind == 'session' else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_exec_request(self, channel, command):
        arguments = shlex.split(command.decode('utf-8'))
        if not arguments or arguments[0] != '.local/bin/codebridge-mount':
            return False
        self.commands.append(arguments)
        self.channels.append(channel)
        threading.Thread(target=self.relay, args=(channel, arguments[1:]), daemon=True).start()
        return True

    def serve(self):
        try:
            while not self.stopping.is_set():
                try:
                    connection, _ = self.listener.accept()
                    break
                except socket.timeout:
                    continue
            else:
                return
            self.transport = paramiko.Transport(connection)
            fixture_log = logging.getLogger('codebridge.test.ssh_fixture')
            if not fixture_log.handlers:
                fixture_log.addHandler(logging.NullHandler())
            fixture_log.propagate = False
            self.transport.set_log_channel(fixture_log.name)
            self.transport.add_server_key(self.key)
            self.transport.start_server(server=self)
            while not self.stopping.is_set() and self.transport.is_active():
                channel = self.transport.accept(.2)
                if channel is not None:
                    self.channels.append(channel)
        except (OSError, EOFError, paramiko.SSHException) as exc:
            if not self.stopping.is_set():
                self.errors.append(type(exc).__name__)

    def relay(self, channel, arguments):
        process = subprocess.Popen([sys.executable, str(self.helper), *arguments],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   cwd=self.cwd, env=self.environment, start_new_session=True, bufsize=0)
        self.children.append(process)

        def input_stream():
            try:
                while not self.stopping.is_set():
                    block = channel.recv(65536)
                    if not block:
                        break
                    pending = memoryview(block)
                    while pending:
                        pending = pending[process.stdin.write(pending):]
            except (OSError, EOFError, ValueError):
                pass
            finally:
                try:
                    process.stdin.close()
                except OSError:
                    pass

        def output_stream(stream, sender, is_error=False):
            try:
                while True:
                    block = os.read(stream.fileno(), 65536)
                    if not block:
                        break
                    if is_error:
                        self.errors.append(block.decode('utf-8', 'replace'))
                    sender(block)
            except (OSError, EOFError, ValueError):
                pass

        threads = [threading.Thread(target=input_stream, daemon=True),
                   threading.Thread(target=output_stream, args=(process.stdout, channel.sendall), daemon=True),
                   threading.Thread(target=output_stream,
                                    args=(process.stderr, channel.sendall_stderr, True), daemon=True)]
        for thread in threads:
            thread.start()
        try:
            while process.poll() is None:
                if self.stopping.wait(.05) or channel.closed:
                    stop_tree(process)
                    break
            for thread in threads[1:]:
                thread.join(.5)
            if not channel.closed:
                channel.send_exit_status(process.returncode or 0)
                channel.shutdown_write()
        except (OSError, EOFError):
            pass
        finally:
            channel.close()
            for thread in threads:
                thread.join(.2)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()

    def close(self):
        self.stopping.set()
        self.listener.close()
        if self.transport:
            self.transport.close()
        for child in self.children:
            stop_tree(child, grace=2)
        self.thread.join(1)


@unittest.skipUnless(AVAILABLE, 'requires Linux /dev/fuse, sshfs and CODEBRIDGE_TEST_RCLONE')
class ConnectionIntegration(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.base = Path(tempfile.mkdtemp(prefix='codebridge-connection-test-'))
        self.client = None
        self.ssh = None
        self.client_lines, self.client_errors = queue.Queue(), []
        self.addCleanup(self.cleanup)
        self.client_program = self.base / 'client-program'
        self.server_program = self.base / 'server-program'
        self.client_home = self.base / 'client-home'
        self.server_home = self.base / 'server-home'
        self.unrelated_cwd = self.base / 'unrelated-working-directory'
        self.shared = self.base / 'shared'
        self.bin = self.base / 'bin'
        for directory in (self.client_program, self.server_program, self.client_home,
                          self.server_home, self.unrelated_cwd, self.shared, self.bin):
            directory.mkdir(mode=0o700)
        shutil.copytree(REPOSITORY / 'local_client', self.client_program / 'local_client',
                        ignore=shutil.ignore_patterns('__pycache__'))
        for directory in (self.client_program, self.server_program):
            shutil.copy2(REPOSITORY / 'codebridge_logging.py', directory)
        helper = self.server_program / 'mount.py'
        shutil.copy2(REPOSITORY / 'remote_server' / 'mount.py', helper)
        (self.bin / 'rclone').symlink_to(Path(os.environ['CODEBRIDGE_TEST_RCLONE']).resolve())
        self.environment = {key: value for key, value in os.environ.items()
                            if not key.startswith('RCLONE_')}
        self.environment['PATH'] = str(self.bin) + os.pathsep + self.environment.get('PATH', '')
        self.password = 'fixture-password-' + secrets.token_hex(16)
        server_environment = dict(self.environment, HOME=str(self.server_home))
        self.ssh = FixtureSSH(helper, server_environment, self.unrelated_cwd, self.password)
        (self.shared / 'sample.txt').write_text('原始文件保持不变\n', encoding='utf-8')
        client_environment = dict(self.environment, HOME=str(self.client_home),
                                  PYTHONPATH=str(self.client_program), PYTHONUNBUFFERED='1')
        self.client = subprocess.Popen([sys.executable, '-m', 'local_client.app', '--no-browser'],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       cwd=self.unrelated_cwd, env=client_environment,
                                       start_new_session=True, text=True)

        def output():
            for line in self.client.stdout:
                self.client_lines.put(line)

        def errors():
            for line in self.client.stderr:
                self.client_errors.append(line)

        self.client_readers = [threading.Thread(target=output, daemon=True),
                               threading.Thread(target=errors, daemon=True)]
        for reader in self.client_readers:
            reader.start()
        try:
            startup = self.client_lines.get(timeout=5)
        except queue.Empty:
            self.fail('Client startup timed out: ' + ''.join(self.client_errors))
        parsed = urlsplit('http://' + startup.split('http://', 1)[1].strip())
        self.http_port = parsed.port
        self.token = parse_qs(parsed.fragment)['token'][0]

    def request(self, path, body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.http_port, timeout=2)
        try:
            headers = {'X-CodeBridge-Token': self.token,
                       'Origin': f'http://127.0.0.1:{self.http_port}', 'Content-Type': 'application/json'}
            connection.request('GET' if body is None else 'POST', path,
                               None if body is None else json.dumps(body), headers)
            response = connection.getresponse()
            result = json.loads(response.read())
            self.assertLess(response.status, 300, result)
            return result
        finally:
            connection.close()

    def wait_for(self, predicate, timeout=20):
        deadline = time.monotonic() + timeout
        snapshot = None
        while time.monotonic() < deadline:
            snapshot = self.request('/api/status')
            if predicate(snapshot):
                return snapshot
            if snapshot['state'] == 'error':
                self.fail('Client connection failed: ' + snapshot['message'] + '\n' + ''.join(self.ssh.errors))
            time.sleep(.025)
        self.fail('Timed out waiting for client state: ' + json.dumps(snapshot, ensure_ascii=False))

    def cleanup(self):
        if self.client:
            if self.client.poll() is None:
                try:
                    self.client.send_signal(signal.SIGINT)
                    self.client.wait(5)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    stop_tree(self.client, grace=1)
        if self.ssh:
            self.ssh.close()
        if self.client:
            for reader in self.client_readers:
                reader.join(.5)
            self.client.stdout.close()
            self.client.stderr.close()
        unmount = shutil.which('fusermount3') or shutil.which('fusermount')
        for path in mounted_paths(self.base):
            if unmount:
                try:
                    subprocess.run([unmount, '-u', str(path)], capture_output=True, timeout=2)
                except subprocess.TimeoutExpired:
                    pass
        remaining = mounted_paths(self.base)
        if remaining:
            self.fail('Test mount still active; preserved temporary directory: ' + str(self.base))
        shutil.rmtree(self.base)

    def test_real_connection_automatic_verification_logs_and_disconnect(self):
        started = time.monotonic()
        self.request('/api/connect', {'host': '127.0.0.1', 'port': self.ssh.port,
                                     'username': 'fixture', 'password': self.password,
                                     'folder': str(self.shared), 'proxy': '', 'remote_os': 'Linux',
                                     'remote_mount_path': '~/integration mount'})
        pending = self.wait_for(lambda status: status['phase'] == 'host_trust', timeout=5)
        self.assertFalse(self.ssh.authenticated.is_set(), 'Password must wait for explicit server trust')
        self.request('/api/host-trust', {'id': pending['trust_challenge']['id'], 'accept': True})
        completed = self.wait_for(lambda status: status['readwrite_result'] is not None, timeout=19)
        elapsed = time.monotonic() - started
        self.assertTrue(completed['readwrite_result']['ok'], completed['readwrite_result']['message'])
        self.assertEqual(completed['phase'], 'write_verified')
        self.assertLess(elapsed, 20, 'Healthy loopback connection and all six steps must finish within 20 seconds')
        mount_path = Path(completed['mount_path'])
        self.assertEqual(mount_path, self.server_home / 'integration mount')
        self.assertIn(mount_path, mounted_paths(self.base))
        self.assertEqual(list(self.shared.glob('.codebridge-probe-*')), [])
        self.assertEqual((self.shared / 'sample.txt').read_text(encoding='utf-8'), '原始文件保持不变\n')
        record = json.loads((self.server_home / '.codebridge' / 'mount-session.json').read_text())
        self.assertEqual(record['connection_result'], 'success')
        self.assertEqual(sum('--verify-readwrite' in command for command in self.ssh.commands), 1)
        self.assertEqual(sum('--connection-result' in command and 'success' in command
                             for command in self.ssh.commands), 1)
        session = record['session']
        dates = date.today().isoformat() + '.log'
        client_log = self.client_program / 'logs' / dates
        server_log = self.server_program / 'logs' / dates
        for path in (client_log, server_log):
            content = path.read_text(encoding='utf-8')
            self.assertIn('连接流程运行结束', content)
            self.assertIn('session=' + session, content)
            for secret in (self.password, self.token, pending['trust_challenge']['id']):
                self.assertNotIn(secret, content)
            for row in csv.reader(content.splitlines()):
                self.assertEqual(len(row), 3)
                self.assertIn(row[1], ('INFO', 'WARN', 'DEBUG', 'ERROR'))
        self.assertFalse((self.unrelated_cwd / 'logs').exists())
        self.assertIn('六个步骤完成', client_log.read_text(encoding='utf-8'))
        self.assertIn('steps=6/6', server_log.read_text(encoding='utf-8'))
        client_rows = list(csv.reader(client_log.read_text(encoding='utf-8').splitlines()))
        verification_start = next(datetime.fromisoformat(row[0]) for row in client_rows if '步骤6开始' in row[2])
        verification_end = next(datetime.fromisoformat(row[0]) for row in client_rows if '步骤6运行结束' in row[2])
        verification_seconds = (verification_end - verification_start).total_seconds()
        self.request('/api/disconnect', {})
        self.wait_for(lambda status: status['state'] == 'disconnected', timeout=10)
        deadline = time.monotonic() + 10
        while mount_path in mounted_paths(self.base) and time.monotonic() < deadline:
            time.sleep(.05)
        self.assertNotIn(mount_path, mounted_paths(self.base))
        self.assertTrue(mount_path.is_dir())
        self.assertEqual(list(mount_path.iterdir()), [])
        print(f'\nReal HTTP/SSH/FUSE connection and both result logs: {elapsed:.3f}s; '
              f'step 6 verification: {verification_seconds:.3f}s', flush=True)


if __name__ == '__main__':
    unittest.main()
