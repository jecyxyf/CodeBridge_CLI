"""Disposable process for local filesystem checks and nonce-scoped probe I/O."""
import json
import os
from pathlib import Path
import re
import sys
import time

from .bridge import BridgeError, checked_root, probe_bytes


def operate(data):
    operation = data['operation']
    if operation == 'root':
        return {'root': str(checked_root(data['root']))}
    probe = data['probe']
    if not re.fullmatch('[a-f0-9]{32}', probe):
        raise BridgeError('验证标识无效')
    path = Path(data['root']) / ('.codebridge-probe-' + probe)
    before = ('CodeBridge:' + probe + ':before').encode()
    after = ('CodeBridge:' + probe + ':after').encode()
    if operation == 'create':
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as file:
            file.write(before)
            file.flush()
            os.fsync(file.fileno())
        return {'ok': True}
    if operation == 'wait':
        expires = time.monotonic() + float(data['timeout'])
        while True:
            content, _ = probe_bytes(path, (before, after))
            if content == after:
                return {'ok': True}
            if time.monotonic() >= expires:
                raise BridgeError('等待本地写回超时')
            time.sleep(.05)
    if operation == 'cleanup':
        _, identity = probe_bytes(path, (before, after))
        current = path.lstat()
        if path.is_symlink() or (current.st_dev, current.st_ino) != identity:
            raise BridgeError('验证文件再次被替换；不会删除它')
        path.unlink()
        return {'ok': True}
    raise BridgeError('未知的本地验证操作')


def main():
    try:
        result = operate(json.loads(sys.stdin.buffer.read(32768)))
        print(json.dumps(result), flush=True)
        return 0
    except Exception as exc:
        message = str(exc) if isinstance(exc, BridgeError) else '本地文件操作失败（' + type(exc).__name__ + '）'
        print(json.dumps({'ok': False, 'message': message}), flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
