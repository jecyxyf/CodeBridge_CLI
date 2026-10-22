"""Build the pinned CodeBridge rclone; keep toolchains and caches inside .tools."""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen
import zipfile


ROOT = Path(__file__).resolve().parents[1]
PATCHES = ROOT / 'third_party' / 'rclone'
WORK = ROOT / '.tools' / 'rclone-build'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def host_platform():
    system = {'Linux': 'linux', 'Darwin': 'darwin', 'Windows': 'windows'}.get(platform.system())
    machine = platform.machine().lower()
    architecture = {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64',
                    'arm64': 'arm64', 'i386': '386', 'i686': '386',
                    'x86': '386', 'armv7l': 'armv6l', 'armv6l': 'armv6l'}.get(machine)
    if not system or not architecture:
        raise RuntimeError('Unsupported build platform: ' + platform.platform())
    return system + '-' + architecture


def inputs_digest():
    value = hashlib.sha256()
    paths = [Path(__file__).resolve(), *sorted(PATCHES.rglob('*'))]
    for path in paths:
        if path.is_file() and '__pycache__' not in path.parts:
            value.update(str(path.relative_to(ROOT)).replace('\\', '/').encode() + b'\0')
            value.update(bytes.fromhex(digest(path)))
    return value.hexdigest()


def check(output, lock):
    manifest_path = Path(str(output) + '.build.json')
    if output.is_symlink() or manifest_path.is_symlink():
        raise RuntimeError('Build output and manifest must be ordinary files, not links')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    expected = {'schema': 1, 'version': lock['version'], 'platform': host_platform(),
                'inputs_sha256': inputs_digest(), 'go_version': lock['go_version']}
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise RuntimeError('Build manifest does not match the pinned sources and patches')
    if manifest.get('sha256') != digest(output):
        raise RuntimeError('Built rclone SHA-256 mismatch')
    check_version(output, lock['version'])
    return {'ok': True, 'path': str(output), 'version': lock['version'],
            'sha256': manifest['sha256'], 'manifest': str(manifest_path)}


def check_version(output, version):
    result = subprocess.run([str(output), 'version'], capture_output=True, text=True,
                            timeout=10, check=True)
    lines = result.stdout.splitlines()
    if not lines or lines[0] != 'rclone ' + version:
        raise RuntimeError('Built rclone version mismatch')


@contextmanager
def build_lock():
    WORK.mkdir(parents=True, exist_ok=True)
    lock_path = WORK / 'build.lock'
    try:
        descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise RuntimeError('Another build owns ' + str(lock_path) +
                           '; wait for it to finish. If it was interrupted, confirm no build '
                           'is running before removing this lock.') from None
    try:
        with os.fdopen(descriptor, 'w', encoding='ascii') as file:
            file.write(str(os.getpid()) + '\n')
        yield
    finally:
        lock_path.unlink()


def download(url, target):
    if target.is_file():
        return
    temporary = target.with_name(target.name + '.part')
    for attempt in range(3):
        try:
            print('Downloading ' + target.name, file=sys.stderr, flush=True)
            with urlopen(url, timeout=60) as response, temporary.open('wb') as destination:
                shutil.copyfileobj(response, destination, 1024 * 1024)
            os.replace(temporary, target)
            return
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def module_hash(archive):
    """Go's dirhash.HashZip/Hash1: SHA256 of sorted per-file digest records."""
    result = hashlib.sha256()
    with zipfile.ZipFile(archive) as source:
        names = source.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError('Duplicate archive entries')
        for name in sorted(names):
            if '\n' in name:
                raise RuntimeError('Invalid archive entry name')
            value = hashlib.sha256()
            with source.open(name) as file:
                for chunk in iter(lambda: file.read(1024 * 1024), b''):
                    value.update(chunk)
            result.update((value.hexdigest() + '  ' + name + '\n').encode())
    return 'h1:' + base64.b64encode(result.digest()).decode()


def extract_module(archive, prefix, destination):
    destination.mkdir()
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            if not entry.filename.startswith(prefix + '/'):
                raise RuntimeError('Unexpected module archive prefix')
            relative = PurePosixPath(entry.filename[len(prefix) + 1:])
            if relative.is_absolute() or '..' in relative.parts or '\\' in entry.filename:
                raise RuntimeError('Unsafe module archive path')
            target = destination.joinpath(*relative.parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(entry) as file, target.open('xb') as output:
                shutil.copyfileobj(file, output)
            target.chmod(0o755 if (entry.external_attr >> 16) & 0o111 else 0o644)


def toolchain(lock, host):
    item = lock['toolchains'][host]
    module_version = item['module_version']
    archive = WORK / ('toolchain-' + lock['go_version'] + '-' + host + '.zip')
    download('https://proxy.golang.org/golang.org/toolchain/@v/' + module_version + '.zip', archive)
    if module_hash(archive) != item['module_sum']:
        raise RuntimeError('Official Go toolchain module checksum mismatch: ' + str(archive))
    # Re-extract from the verified archive; do not trust a previously unpacked executable.
    destination = WORK / (lock['go_version'] + '-' + host)
    if destination.exists():
        shutil.rmtree(destination)
    extract_module(archive, 'golang.org/toolchain@' + module_version, destination)
    return destination / 'bin' / ('go.exe' if os.name == 'nt' else 'go')


def go_environment(go):
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith('GO') and not key.startswith('CGO_')}
    environment.update(GOROOT=str(go.parent.parent), GOPATH=str(WORK / 'gopath'),
                       GOMODCACHE=str(WORK / 'modules'), GOCACHE=str(WORK / 'cache'),
                       GOTMPDIR=str(WORK / 'tmp'), GOENV='off', GOWORK='off',
                       GOTOOLCHAIN='local', GOPROXY='https://proxy.golang.org',
                       GOSUMDB='sum.golang.org', CGO_ENABLED='0')
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        environment[key] = str(WORK / 'tmp')
    environment['PATH'] = str(go.parent) + os.pathsep + environment.get('PATH', '')
    if platform.machine().lower() in ('armv7l', 'armv6l'):
        environment['GOARM'] = '6'
    (WORK / 'tmp').mkdir(exist_ok=True)
    return environment


def go_run(go, args, cwd, environment, capture=False):
    print('go ' + ' '.join(args), file=sys.stderr, flush=True)
    return subprocess.run([str(go), *args], cwd=cwd, env=environment, check=True,
                          stdout=subprocess.PIPE if capture else sys.stderr,
                          stderr=sys.stderr, text=True, timeout=1800)


def source_module(name, lock, go, environment, destination):
    item = lock['modules'][name]
    completed = go_run(go, ['mod', 'download', '-json', item['path'] + '@' + item['version']],
                       WORK, environment, capture=True)
    record = json.loads(completed.stdout)
    if record.get('Sum') != item['sum'] or record.get('GoModSum') != item['go_mod_sum']:
        raise RuntimeError('Go module checksum mismatch: ' + item['path'])
    archive = Path(record['Zip'])
    if module_hash(archive) != item['sum']:
        raise RuntimeError('Cached Go module ZIP checksum mismatch: ' + item['path'])
    extract_module(archive, item['path'] + '@' + item['version'], destination)


def apply_patch(source, patch):
    """Apply reviewed unified diffs exactly, without external patch or fuzzy matching."""
    lines = patch.read_text(encoding='utf-8').splitlines(keepends=True)
    index = 0
    while index < len(lines):
        if not lines[index].startswith('--- a/'):
            raise RuntimeError('Invalid patch file header')
        name = lines[index][6:].strip()
        index += 1
        if lines[index].strip() != '+++ b/' + name:
            raise RuntimeError('Patch target mismatch')
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise RuntimeError('Unsafe patch target')
        target = source.joinpath(*relative.parts)
        original = target.read_text(encoding='utf-8').splitlines(keepends=True)
        output, cursor = [], 0
        index += 1
        while index < len(lines) and lines[index].startswith('@@ '):
            match = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', lines[index])
            if not match:
                raise RuntimeError('Invalid patch hunk')
            start = int(match[1]) - 1
            if start < cursor:
                raise RuntimeError('Overlapping patch hunks')
            output.extend(original[cursor:start])
            cursor = start
            index += 1
            old_count = new_count = 0
            while index < len(lines) and lines[index][:1] in (' ', '+', '-') and not lines[index].startswith('--- a/'):
                line = lines[index]
                if line[0] in ' -':
                    if cursor >= len(original) or original[cursor] != line[1:]:
                        raise RuntimeError('Patch context mismatch: ' + name)
                    cursor += 1
                    old_count += 1
                if line[0] in ' +':
                    output.append(line[1:])
                    new_count += 1
                index += 1
            if old_count != int(match[2] or 1) or new_count != int(match[4] or 1):
                raise RuntimeError('Patch hunk size mismatch')
        output.extend(original[cursor:])
        target.write_text(''.join(output), encoding='utf-8', newline='')


def build(output, lock):
    fingerprint = inputs_digest()
    if json.loads((PATCHES / 'sources.json').read_text(encoding='utf-8')) != lock:
        raise RuntimeError('Pinned sources changed before the build started')
    host = host_platform()
    if host not in lock['toolchains']:
        raise RuntimeError('No pinned Go toolchain for ' + host)
    WORK.mkdir(parents=True, exist_ok=True)
    go = toolchain(lock, host)
    environment = go_environment(go)
    # Each build starts from verified, unmodified upstream archives.
    workspace = Path(tempfile.mkdtemp(prefix='source-', dir=WORK))
    rclone, sftp = workspace / 'rclone', workspace / 'sftp'
    source_module('rclone', lock, go, environment, rclone)
    source_module('sftp', lock, go, environment, sftp)
    apply_patch(rclone, PATCHES / 'rclone.patch')
    apply_patch(sftp, PATCHES / 'pkg-sftp.patch')
    shutil.copyfile(PATCHES / 'rclone_codebridge_test.go', rclone / 'cmd/serve/sftp/codebridge_test.go')
    shutil.copyfile(PATCHES / 'sftp_codebridge_test.go', sftp / 'codebridge_test.go')
    go_run(go, ['mod', 'edit', '-replace=github.com/pkg/sftp=../sftp'], rclone, environment)
    for directory, package in ((sftp, '.'), (rclone, './cmd/serve/sftp')):
        go_run(go, ['test', '-mod=readonly', '-count=1', '-timeout=120s',
                    '-run=^TestCodeBridge', package], directory, environment)
    candidate = workspace / ('rclone-built.exe' if os.name == 'nt' else 'rclone-built')
    go_run(go, ['build', '-mod=readonly', '-trimpath', '-buildvcs=false',
                '-ldflags=-s -w -X github.com/rclone/rclone/fs.Version=' + lock['version'],
                '-o', str(candidate), '.'], rclone, environment)
    check_version(candidate, lock['version'])
    if inputs_digest() != fingerprint:
        raise RuntimeError('Build inputs changed during compilation; candidate was not published')
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_symlink() or Path(str(output) + '.build.json').is_symlink():
        raise RuntimeError('Refusing linked build destination')
    manifest = {'schema': 1, 'version': lock['version'], 'platform': host,
                'sha256': digest(candidate), 'inputs_sha256': fingerprint,
                'go_version': lock['go_version'], 'sources': lock['modules'],
                'toolchain_sum': lock['toolchains'][host]['module_sum'],
                'targeted_go_tests': 'passed'}
    staged = output.with_name(output.name + '.new')
    shutil.copyfile(candidate, staged)
    staged.chmod(0o755)
    manifest_path = Path(str(output) + '.build.json')
    manifest_temporary = Path(str(manifest_path) + '.new')
    manifest_temporary.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    os.replace(staged, output)
    os.replace(manifest_temporary, manifest_path)
    return check(output, lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path,
                        default=ROOT / '.tools' / ('rclone.exe' if os.name == 'nt' else 'rclone'))
    parser.add_argument('--check', action='store_true', help='Read-only; do not download or build')
    args = parser.parse_args()
    try:
        if Path(sys.prefix).resolve() != (ROOT / '.venv').resolve():
            raise RuntimeError('Run with the current repository .venv Python interpreter')
        lock = json.loads((PATCHES / 'sources.json').read_text(encoding='utf-8'))
        output = args.output.absolute()
        if args.check:
            result = check(output, lock)
        else:
            try:
                result = check(output, lock)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
                with build_lock():
                    result = build(output, lock)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
