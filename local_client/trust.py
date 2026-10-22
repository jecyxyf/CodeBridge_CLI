"""Host-scoped SSH pins. First-use trust is explicit, never automatic."""
import base64
import ipaddress
import json
import os
from pathlib import Path
import tempfile

from .bridge import BridgeError


def target_id(host, port):
    if not isinstance(host, str):
        raise ValueError('服务器地址格式无效')
    host = host.strip()
    if not host or any(c.isspace() or ord(c) < 32 for c in host) or any(c in host for c in '/\\'):
        raise ValueError('服务器地址格式无效')
    if host.startswith('[') and host.endswith(']'):
        host = host[1:-1]
    try:
        host = str(ipaddress.ip_address(host))
    except ValueError:
        host = host.rstrip('.').encode('idna').decode('ascii').lower()
        if not host or ':' in host:
            raise ValueError('服务器地址格式无效')
    port = int(port)
    if not 0 < port < 65536 or len(host) > 253:
        raise ValueError('服务器地址或端口无效')
    return json.dumps([host, port], separators=(',', ':'))


def valid_pin(pin):
    if not isinstance(pin, str) or not pin.startswith('SHA256:'):
        return False
    try:
        data = base64.b64decode(pin[7:] + '=', validate=True)
        return len(data) == 32 and base64.b64encode(data).decode().rstrip('=') == pin[7:]
    except (ValueError, TypeError):
        return False


class TrustStore:
    def __init__(self, path, legacy):
        self.path = Path(path)
        self.legacy = {}
        # Only the previously persisted host/port gets the old manual pin.
        # Never import a fingerprint from a new connect request.
        if valid_pin(legacy.get('fingerprint')):
            try:
                self.legacy[target_id(legacy.get('host', ''), legacy.get('port', ''))] = legacy['fingerprint']
            except (ValueError, TypeError, UnicodeError):
                pass

    def read(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:
            raise BridgeError('服务器信任记录无法读取，已停止连接；请检查本地 trusted_hosts.json') from exc
        if not isinstance(data, dict) or any(not valid_pin(v) for v in data.values()):
            raise BridgeError('服务器信任记录无效，已停止连接')
        return data

    def expected(self, host, port):
        key = target_id(host, port)
        return self.read().get(key, self.legacy.get(key))

    def remember(self, host, port, pin):
        key = target_id(host, port)
        data = self.read()
        expected = data.get(key, self.legacy.get(key))
        if not valid_pin(pin) or (expected is not None and expected != pin):
            raise BridgeError('服务器身份已变化，已拒绝覆盖信任记录')
        data[key] = pin
        self._write(data)

    def migrate(self):
        data = self.read()
        changed = False
        for key, pin in self.legacy.items():
            if key not in data:
                data[key] = pin
                changed = True
        if changed:
            self._write(data)

    def forget(self, host, port):
        key = target_id(host, port)
        self.migrate()
        data = self.read()
        if key in data:
            del data[key]
            self._write(data)
        self.legacy.pop(key, None)

    def _write(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, name = tempfile.mkstemp(prefix='.trusted-hosts-', dir=self.path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                json.dump(data, output, ensure_ascii=False, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
