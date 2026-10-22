#!/usr/bin/env bash
# CodeBridge remote mount adapter installer. Never alters macOS security policy.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_DEPS=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) printf 'Usage: bash remote_server/scripts/macos.sh [--skip-deps] [--check]\nRun as the SSH account that will own the mount. --check is read-only.\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
[[ "$(uname -s)" == Darwin ]] || { echo 'This script is for macOS.' >&2; exit 1; }
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
BREW_PREFIX=""
if command -v brew >/dev/null 2>&1; then BREW_PREFIX="$(brew --prefix)"; fi
PYTHON="${CODEBRIDGE_PYTHON:-${BREW_PREFIX:-/usr/local}/opt/python@3.13/bin/python3.13}"
SOURCE="$ROOT/remote_server/mount.py"
python_ok() { "$PYTHON" -c 'import sys; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; }
if (( CHECK_ONLY )); then
  python_ok || { echo 'Python >= 3.10 is required (or set CODEBRIDGE_PYTHON).' >&2; exit 1; }
  "$PYTHON" "$SOURCE" --self-test
  echo 'Dependency check only: this does not prove macFUSE driver approval or a working mount.'
  exit 0
fi
[[ "$EUID" != 0 ]] || { echo 'Run as the normal SSH account, not with sudo. Homebrew will request elevation if needed.' >&2; exit 1; }
[[ -f "$SOURCE" ]] || { echo 'Extract the complete CodeBridge package first.' >&2; exit 1; }
if (( ! SKIP_DEPS )); then
  [[ -n "$BREW_PREFIX" ]] || { echo 'Install Homebrew from https://brew.sh/ then rerun. Or install official Python/macFUSE/SSHFS yourself and use --skip-deps with CODEBRIDGE_PYTHON.' >&2; exit 1; }
  echo 'Installing Python, macFUSE and SSHFS from Homebrew core packages.'
  echo 'macFUSE may request administrator approval, driver approval or reboot. This script does not bypass those protections.'
  brew install python@3.13
  brew install --cask macfuse sshfs-mac
fi
python_ok || { echo 'Python >= 3.10 is required. Set CODEBRIDGE_PYTHON to select another interpreter.' >&2; exit 1; }
"$PYTHON" "$SOURCE" --self-test
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
wrapper.write_text('#!/bin/sh\n# CodeBridge: keep stdout exclusively for SFTP.\n'
                   + 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"\n'
                   + "exec " + shlex.quote(sys.executable) + " " + shlex.quote(str(target)) + ' "$@"\n')
os.chmod(wrapper, 0o700)
print(f"Installed helper: {target}\nInstalled launcher: {wrapper}")
PY
"$HOME/.local/bin/codebridge-mount" --self-test
"$HOME/.local/bin/codebridge-mount" --initialize
echo 'Adapter installed; an actual client connection is required to verify the filesystem driver.'
echo 'If macOS asks for macFUSE approval or a restart, complete the official vendor steps yourself before connecting.'
echo 'See https://macfuse.github.io/ . No Remote Login, firewall, Gatekeeper or system security settings were changed.'
