#!/usr/bin/env bash
# CodeBridge remote mount adapter installer, not a background agent or UI.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_DEPS=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) printf 'Usage: bash remote_server/scripts/linux.sh [--skip-deps] [--check]\nRun as the SSH account that will own the mount. --check is read-only.\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
[[ "$(uname -s)" == Linux ]] || { echo 'This script is for Linux.' >&2; exit 1; }
PYTHON="${CODEBRIDGE_PYTHON:-python3}"
SOURCE="$ROOT/remote_server/mount.py"
python_ok() { "$PYTHON" -c 'import sys; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; }
run_as_admin() {
  if [[ "$EUID" == 0 ]]; then "$@";
  elif command -v sudo >/dev/null; then sudo "$@";
  else echo 'An administrator must install these packages. Then rerun with --skip-deps.' >&2; return 1; fi
}
if (( CHECK_ONLY )); then
  python_ok || { echo 'Python >= 3.10 is required.' >&2; exit 1; }
  [[ -f "$SOURCE" ]] || { echo 'Missing remote_server/mount.py.' >&2; exit 1; }
  "$PYTHON" "$SOURCE" --self-test
  [[ -r /dev/fuse && -w /dev/fuse ]] || { echo 'Current account cannot use /dev/fuse. Ask the host administrator; no permission settings were changed.' >&2; exit 1; }
  command -v fusermount3 >/dev/null || command -v fusermount >/dev/null || { echo 'Missing fusermount3/fusermount for cleanup.' >&2; exit 1; }
  exit 0
fi
[[ -f "$SOURCE" ]] || { echo 'Extract the complete CodeBridge package first.' >&2; exit 1; }
if (( ! SKIP_DEPS )) && { ! python_ok || ! command -v sshfs >/dev/null; }; then
  echo 'Installing Python and SSHFS/FUSE through the system package manager. SSH and firewall configuration will not change.'
  if command -v apt-get >/dev/null; then
    run_as_admin apt-get update
    run_as_admin apt-get install -y python3 sshfs
  elif command -v dnf >/dev/null; then
    run_as_admin dnf install -y python3 fuse-sshfs
  elif command -v pacman >/dev/null; then
    run_as_admin pacman -S --needed python sshfs
  elif command -v zypper >/dev/null; then
    run_as_admin zypper install -y python3 sshfs
  else
    echo 'Unsupported package manager. Install Python >= 3.10 and SSHFS with passive mode, then rerun --skip-deps.' >&2
    exit 1
  fi
fi
python_ok || { echo 'Python >= 3.10 is required. CODEBRIDGE_PYTHON can select another interpreter.' >&2; exit 1; }
# This checks the real SSHFS binary, not just the package manager result.
"$PYTHON" "$SOURCE" --self-test
[[ -r /dev/fuse && -w /dev/fuse ]] || { echo 'Current account cannot read/write /dev/fuse. Ask the host administrator; this script never chmods the device or changes groups.' >&2; exit 1; }
command -v fusermount3 >/dev/null || command -v fusermount >/dev/null || { echo 'Missing fusermount3/fusermount, required for cleanup.' >&2; exit 1; }
umask 077
"$PYTHON" - "$SOURCE" <<'PY'
import os, shlex, sys
from pathlib import Path
home = Path.home()
base = home / ".codebridge"
target_dir = base / "remote_server"
bin_dir = home / ".local" / "bin"
for directory in (base, target_dir, home / ".local", bin_dir):
    if directory.is_symlink():
        raise SystemExit(f"Refusing symlinked install directory: {directory}")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
target = target_dir / "mount.py"
wrapper = bin_dir / "codebridge-mount"
for path in (target, wrapper):
    if path.is_symlink():
        raise SystemExit(f"Refusing symlinked install file: {path}")
target.write_bytes(Path(sys.argv[1]).read_bytes())
os.chmod(target, 0o600)
wrapper.write_text("#!/bin/sh\n# CodeBridge: binary SFTP stdout must remain untouched.\n"
                   + "exec " + shlex.quote(sys.executable) + " " + shlex.quote(str(target)) + ' "$@"\n')
os.chmod(wrapper, 0o700)
print(f"Installed helper: {target}\nInstalled launcher: {wrapper}")
PY
"$HOME/.local/bin/codebridge-mount" --self-test
echo 'Ready for a client connection test. The script did not start sshd or create a mount.'
echo 'Use your existing SSH account and SSH service. If sshd is absent or inaccessible, ask the host administrator to configure it.'
