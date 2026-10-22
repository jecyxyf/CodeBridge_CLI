"""Atomic settings/trust persistence in a process the caller can terminate."""
import json
import os
from pathlib import Path
import sys
import tempfile

from .bridge import BridgeError
from .trust import TrustStore


def save_settings(path, settings):
    allowed = {'host', 'port', 'username', 'proxy', 'folder', 'remote_os', 'remote_mount_path'}
    settings = {key: value for key, value in settings.items() if key in allowed}
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.settings-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(settings, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def operate(data):
    store = TrustStore(data['trust_path'], {})
    store.legacy = data['legacy']
    operation = data['operation']
    if operation == 'prepare':
        store.migrate()
        save_settings(Path(data['config']), data['settings'])
    elif operation == 'remember':
        store.remember(*data['arguments'])
    elif operation == 'forget':
        store.migrate()
        # Remove the legacy source first, so it cannot be reimported on restart.
        if 'fingerprint' in data['settings']:
            save_settings(Path(data['config']), data['settings'])
        store.forget(*data['arguments'])
    else:
        raise ValueError('未知的配置保存操作')
    return {'ok': True, 'legacy': store.legacy}


def main():
    try:
        result = operate(json.loads(sys.stdin.buffer.read(65536)))
        print(json.dumps(result), flush=True)
        return 0
    except Exception as exc:
        message = str(exc) if isinstance(exc, BridgeError) else '配置保存失败（' + type(exc).__name__ + '）'
        print(json.dumps({'ok': False, 'message': message, 'kind': type(exc).__name__}), flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
