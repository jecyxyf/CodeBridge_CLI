"""Credential-free application-level SSH ping, respecting the configured proxy."""
import time
from .bridge import BridgeError, connect_socket
from .runtime import bounded_process


def target(data, require_proxy=False):
    host = str(data.get('host', '')).strip()
    proxy = str(data.get('proxy', '')).strip()
    try:
        port = int(data.get('port', 22))
    except (TypeError, ValueError):
        raise BridgeError('SSH 端口必须是 1–65535 的整数') from None
    if not host or len(host) > 253 or any(c.isspace() or ord(c) < 32 for c in host) or '/' in host or '\\' in host or not 0 < port < 65536:
        raise BridgeError('请填写有效服务器地址和 SSH 端口')
    if require_proxy and not proxy:
        raise BridgeError('请先填写代理地址')
    if len(proxy) > 2048:
        raise BridgeError('代理地址过长')
    return host, port, proxy


def test_ssh(data, require_proxy=False):
    started = time.monotonic()
    route = '代理' if str(data.get('proxy', '')).strip() else '直连'
    sock = None
    try:
        host, port, proxy = target(data, require_proxy)
        sock = connect_socket(host, port, proxy)
        sock.settimeout(5)
        # TCP openness alone does not establish an SSH service or proxy tunnel.
        content = b''
        deadline = time.monotonic() + 5
        while len(content) < 8192 and time.monotonic() < deadline:
            part = sock.recv(1024)
            if not part:
                break
            content += part
            if any(line.startswith((b'SSH-2.0-', b'SSH-1.99-')) for line in content.split(b'\n') if line.endswith(b'\r')):
                return {'ok': True, 'message': ('代理隧道及目标 SSH 服务可达' if require_proxy else 'SSH 服务可达') + '；尚未认证或挂载',
                        'elapsed_ms': round((time.monotonic() - started) * 1000), 'route': route}
        raise BridgeError('连接已打开，但未收到有效 SSH 服务标识')
    except Exception as exc:
        message = str(exc) if isinstance(exc, BridgeError) else '连接测试失败或超时（' + type(exc).__name__ + '）'
        return {'ok': False, 'message': message, 'elapsed_ms': round((time.monotonic() - started) * 1000), 'route': route}
    finally:
        if sock is not None:
            sock.close()


def bounded_test(data, require_proxy=False):
    """Bound DNS resolution as well as sockets; no credentials enter child argv."""
    import json
    import sys
    from pathlib import Path
    try:
        host, port, proxy = target(data, require_proxy)
        payload = {'host': host, 'port': port, 'proxy': proxy, 'require_proxy': require_proxy}
        completed = bounded_process([sys.executable, '-m', 'local_client.diagnostics'],
                                    timeout=30, label='SSH 连接诊断',
                                    input=json.dumps(payload), text=True,
                                    cwd=str(Path(__file__).resolve().parents[1]))
        if completed.returncode:
            raise BridgeError('测试进程未正常完成')
        return json.loads(completed.stdout)
    except Exception as exc:
        return {'ok': False, 'message': str(exc) if isinstance(exc, BridgeError) else '连接测试超时或无法完成',
                'route': '代理' if str(data.get('proxy', '')).strip() else '直连', 'elapsed_ms': None}


if __name__ == '__main__':
    import json
    import sys
    data = json.loads(sys.stdin.read(32768))
    print(json.dumps(test_ssh(data, bool(data.get('require_proxy')))))
