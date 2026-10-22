"""Private loopback web UI. No remote listener, no AI service."""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
import webbrowser

from .bridge import Bridge, BridgeError
from .trust import TrustStore, target_id
from .diagnostics import bounded_test

WEB = Path(__file__).with_name('web')
CONFIG = Path.home() / '.codebridge' / 'settings.json'
SETTING_KEYS = {'host', 'port', 'username', 'proxy', 'folder', 'remote_os', 'fingerprint'}


class Application:
    def __init__(self):
        self.lock = threading.RLock()
        self.bridge = None
        self.worker = None
        self.state = 'disconnected'
        self.phase = 'idle'
        self.diagnostics_limit = threading.BoundedSemaphore(2)
        self.message = '未连接'
        self.mount = ''
        self.pending_trust = None
        try:
            self.settings = {k: v for k, v in json.loads(CONFIG.read_text(encoding='utf-8')).items() if k in SETTING_KEYS}
        except (OSError, ValueError, AttributeError):
            self.settings = {}
        self.trust = TrustStore(CONFIG.with_name('trusted_hosts.json'), self.settings)

    def notify(self, message):
        with self.lock:
            self.message = message
            if message.startswith('已连接，远端挂载路径：'):
                self.state = 'connected'
                self.phase = 'readable'
                self.mount = message.split('：', 1)[1]
            elif message.startswith('正在连接服务器'):
                self.phase = 'ssh_connecting'
            elif message.startswith('身份已验证，正在启动'):
                self.phase = 'ssh_authenticated'
            elif message.startswith('身份已验证，正在挂载'):
                self.phase = 'mounting'
            elif message.startswith('挂载已建立，正在检查目录：'):
                self.phase = 'mounted'
                self.mount = message.split('：', 1)[1]
            elif message.startswith('已断开') or message == '首次连接确认已取消，未发送密码':
                self.state = 'disconnected'
                self.phase = 'idle'
                self.mount = ''
            elif '失败' in message or '超时' in message or '不匹配' in message or '中断' in message:
                self.state = 'error'
                self.phase = 'error'
                self.mount = ''

    def snapshot(self):
        with self.lock:
            if self.worker and not self.worker.is_alive() and self.state not in ('disconnected', 'error'):
                self.state = 'error'
                self.phase = 'error'
            return {'state': self.state, 'phase': self.phase, 'message': self.message, 'mount_path': self.mount,
                    'settings': {k: v for k, v in self.settings.items() if k != 'fingerprint'},
                    'trust_challenge': dict(self.pending_trust['public']) if self.pending_trust else None}

    def connect(self, data):
        with self.lock:
            if self.worker and self.worker.is_alive():
                raise ValueError('连接正在运行，请先断开')
            settings = {key: str(data.get(key, '')) for key in SETTING_KEYS if key != 'fingerprint'}
            if settings['remote_os'] not in ('Linux', 'macOS', 'Windows'):
                raise ValueError('请选择远端系统')
            if any(len(value) > 4096 for value in settings.values()):
                raise ValueError('设置过长')
            parsed_proxy = urlsplit(settings['proxy'])
            if parsed_proxy.username is not None or parsed_proxy.password is not None:
                raise ValueError('不支持代理凭据，且不会保存此输入')
            password = data.get('password', '')
            if not isinstance(password, str) or len(password) > 4096:
                raise ValueError('密码格式无效')
            self.trust.migrate()
            self.settings = settings
            CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            # Allowlist prevents accidental credential persistence.
            CONFIG.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding='utf-8')
            self.bridge = Bridge(self.notify, self.verify_host)
            self.state, self.message, self.mount = 'connecting', '正在连接…', ''
            self.phase = 'ssh_connecting'
            self.worker = threading.Thread(target=self.bridge.run, args=(settings, password), daemon=True)
            self.worker.start()

    def verify_host(self, bridge, host, port, actual):
        with self.lock:
            if self.bridge is not bridge or bridge.stop.is_set():
                raise BridgeError('连接已取消')
            expected = self.trust.expected(host, port)
            if expected is not None:
                if expected != actual:
                    raise BridgeError('服务器身份不匹配，可能更换了服务器或连接被拦截。已拒绝发送密码，请核实后处理信任记录。当前指纹：' + actual)
                self.trust.remember(host, port, actual)  # safely persist a matching legacy pin
                return
            pending = {'public': {'id': secrets.token_urlsafe(24), 'host': host, 'port': port, 'fingerprint': actual},
                       'bridge': bridge, 'event': threading.Event(), 'accepted': False,
                       'deadline': time.monotonic() + 120}
            self.pending_trust = pending
            self.phase = 'host_trust'
            self.message = '首次连接这台服务器，请确认是否信任；确认前不会发送密码'
        try:
            while not pending['event'].wait(0.2):
                if bridge.stop.is_set() or time.monotonic() >= pending['deadline']:
                    raise BridgeError('首次连接确认已取消或超时，未发送密码')
            if not pending['accepted'] or bridge.stop.is_set():
                raise BridgeError('首次连接确认已取消，未发送密码')
        finally:
            with self.lock:
                if self.pending_trust is pending:
                    self.pending_trust = None

    def decide_trust(self, data):
        with self.lock:
            pending = self.pending_trust
            if (not pending or not isinstance(data.get('id'), str) or
                    not hmac.compare_digest(data['id'], pending['public']['id']) or
                    type(data.get('accept')) is not bool or pending['event'].is_set() or
                    pending['bridge'] is not self.bridge or self.bridge.stop.is_set() or
                    time.monotonic() >= pending['deadline']):
                raise ValueError('确认已过期，请重新连接')
            if data['accept']:
                info = pending['public']
                # The caller supplies only a nonce and decision, never a new key/host.
                self.trust.remember(info['host'], info['port'], info['fingerprint'])
                pending['accepted'] = True
            pending['event'].set()
            self.pending_trust = None
            self.phase = 'ssh_connecting'
            self.message = '已记住服务器，正在继续连接…' if data['accept'] else '已取消首次连接确认，未发送密码'

    def forget_host(self, data):
        with self.lock:
            if self.worker and self.worker.is_alive():
                raise ValueError('请先断开连接，再删除服务器指纹')
            host, port = data.get('host'), data.get('port')
            if not isinstance(host, str) or type(port) is not int:
                raise ValueError('服务器地址或端口无效')
            target_id(host, port)  # validate before any persistence or challenge changes
            # Revoke stale challenges before reset; never close an active mount.
            if self.pending_trust:
                self.pending_trust['event'].set()
                self.pending_trust = None
            # Remove legacy settings first so a crash cannot restore a deleted pin.
            if 'fingerprint' in self.settings:
                self.trust.migrate()
                self.settings.pop('fingerprint', None)
                CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                CONFIG.write_text(json.dumps(self.settings, ensure_ascii=False, indent=2), encoding='utf-8')
            self.trust.forget(host, port)
            self.state, self.phase, self.mount = 'disconnected', 'idle', ''
            self.message = '已清除这台服务器的已保存身份；下次连接时会重新询问是否信任。网络或密码错误不会因此修复。'

    def verify_readwrite(self):
        with self.lock:
            current = self.bridge
            if self.state != 'connected' or not current:
                return {'ok': False, 'message': '请先连接并确认目录可读'}
        result = current.verify_readwrite()
        with self.lock:
            if self.bridge is not current or self.state != 'connected' or current.stop.is_set():
                return {'ok': False, 'message': '连接状态已改变，本次验证结果已作废'}
            self.phase = 'write_verified' if result['ok'] else 'readable'
            self.message = result['message']
        return result

    def disconnect(self):
        with self.lock:
            if self.bridge and self.worker and self.worker.is_alive():
                self.state = 'disconnecting'
                self.message = '正在断开…'
                self.bridge.disconnect()


def make_handler(app, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Neither tokens, request bodies, nor passwords enter logs.

        def send(self, status, body, content_type='application/json; charset=utf-8'):
            payload = json.dumps(body, ensure_ascii=False).encode() if isinstance(body, dict) else body
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            self.end_headers()
            self.wfile.write(payload)

        def authorized(self):
            expected_host = f'127.0.0.1:{self.server.server_port}'
            origin = self.headers.get('Origin')
            return (self.headers.get('Host') == expected_host and
                    (not origin or origin == 'http://' + expected_host) and
                    hmac.compare_digest(self.headers.get('X-CodeBridge-Token', ''), token))

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.startswith('/api/'):
                if not self.authorized():
                    return self.send(403, {'error': '请通过启动器打开客户端'})
                if path == '/api/status':
                    return self.send(200, app.snapshot())
                return self.send(404, {'error': '接口不存在'})
            name = 'index.html' if path == '/' else path.lstrip('/')
            candidate = (WEB / name).resolve()
            if not candidate.is_relative_to(WEB.resolve()) or not candidate.is_file():
                return self.send(404, {'error': '未找到页面'})
            types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                     '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'}
            return self.send(200, candidate.read_bytes(), types.get(candidate.suffix, 'application/octet-stream'))

        def do_POST(self):
            if not self.authorized():
                return self.send(403, {'error': '请求来源或会话令牌无效'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 <= length <= 32768:
                    return self.send(413, {'error': '请求过大'})
                body = json.loads(self.rfile.read(length) or b'{}')
                if not isinstance(body, dict):
                    raise ValueError('请求必须为对象')
                if self.path in ('/api/test-server', '/api/test-proxy'):
                    if not app.diagnostics_limit.acquire(blocking=False):
                        return self.send(429, {'error': '连接测试正在进行，请稍候'})
                    try:
                        return self.send(200, bounded_test(body, require_proxy=self.path == '/api/test-proxy'))
                    finally:
                        app.diagnostics_limit.release()
                if self.path == '/api/verify-readwrite':
                    return self.send(200, app.verify_readwrite())
                if self.path == '/api/forget-host':
                    app.forget_host(body)
                    return self.send(200, app.snapshot())
                if self.path == '/api/host-trust':
                    app.decide_trust(body)
                    return self.send(202, app.snapshot())
                if self.path == '/api/connect':
                    app.connect(body)
                    return self.send(202, app.snapshot())
                if self.path == '/api/disconnect':
                    app.disconnect()
                    return self.send(202, app.snapshot())
                if self.path == '/api/pick-directory':
                    try:
                        selected = subprocess.run([sys.executable, '-m', 'local_client.picker'], capture_output=True, timeout=120)
                        if selected.returncode != 0:
                            return self.send(409, {'error': '系统文件夹选择器不可用，请直接填写绝对路径'})
                        return self.send(200, json.loads(selected.stdout))
                    except subprocess.TimeoutExpired:
                        return self.send(408, {'error': '文件夹选择超时，请重试或手动填写路径'})
                return self.send(404, {'error': '接口不存在'})
            except BridgeError:
                return self.send(409, {'error': '服务器信任记录无法安全保存，请检查本地信任记录并重新连接'})
            except (ValueError, TypeError):
                return self.send(400, {'error': '设置无效，请检查输入和连接状态'})
            except OSError:
                return self.send(500, {'error': '无法保存本地设置，请检查用户目录权限'})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    app = Application()
    token = secrets.token_urlsafe(32)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(app, token))
    url = f'http://127.0.0.1:{server.server_port}/#token={token}'
    # This URL is local-session authorization, not SSH credentials. Console is local only.
    print('CodeBridge 本地客户端：' + url, flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.disconnect()
        if app.worker:
            app.worker.join(timeout=20)
        server.server_close()

if __name__ == '__main__':
    main()
