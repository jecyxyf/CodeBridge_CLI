#!/usr/bin/env bash
# CodeBridge local web UI installer. Uses official Homebrew packages; no FUSE needed locally.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_DEPS=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) printf 'Usage: bash local_client/scripts/macos.sh [--skip-deps] [--check]\n--skip-deps: use installed dependencies; still installs Python requirements.\n--check: read-only dependency check.\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
[[ "$(uname -s)" == Darwin ]] || { echo 'This script is for macOS.' >&2; exit 1; }
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if command -v brew >/dev/null 2>&1; then
  BREW_PREFIX="$(brew --prefix)"
else
  BREW_PREFIX=""
fi
PYTHON="${CODEBRIDGE_PYTHON:-${BREW_PREFIX:-/usr/local}/opt/python@3.13/bin/python3.13}"
python_ok() { "$PYTHON" -c 'import sys, tkinter, venv, ensurepip; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; }
rclone_ok() {
  "$PYTHON" -c 'import re, subprocess, sys
try:
    version = subprocess.check_output(["rclone", "version"], text=True, timeout=10)
    match = re.search(r"rclone v(\d+)\.(\d+)\.(\d+)", version)
    help_text = subprocess.check_output(["rclone", "serve", "sftp", "--help"], text=True, timeout=10)
    sys.exit(0 if match and tuple(map(int, match.groups())) >= (1, 75, 0) and "--stdio" in help_text else 1)
except (OSError, subprocess.SubprocessError):
    sys.exit(1)' >/dev/null 2>&1
}
if (( CHECK_ONLY )); then
  python_ok || { echo 'Missing Python >= 3.10 with tkinter and venv (or set CODEBRIDGE_PYTHON).' >&2; exit 1; }
  rclone_ok || { echo 'Missing rclone >= 1.75.0 with serve sftp --stdio support.' >&2; exit 1; }
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    "$ROOT/.venv/bin/python" -c 'import tkinter, paramiko, socks; print("Client imports OK")'
  else
    echo 'System dependencies OK; client .venv is not installed yet.'
  fi
  rclone version
  exit 0
fi
[[ "$EUID" != 0 ]] || { echo 'Run as your normal desktop user, not with sudo.' >&2; exit 1; }
[[ -f "$ROOT/local_client/requirements.txt" ]] || { echo 'Extract the complete CodeBridge package first.' >&2; exit 1; }
if (( ! SKIP_DEPS )); then
  if [[ -z "$BREW_PREFIX" ]]; then
    echo 'Homebrew is required for automatic installation. Install it from https://brew.sh/ and rerun.' >&2
    echo 'Alternatively install Python with Tkinter and rclone yourself, set CODEBRIDGE_PYTHON, and use --skip-deps.' >&2
    exit 1
  fi
  echo 'Installing Python 3.13, Tkinter and rclone through Homebrew. No SSH or security settings will change.'
  brew install python@3.13 python-tk@3.13 rclone
fi
python_ok || { echo 'Python >= 3.10 with tkinter and venv is required. Set CODEBRIDGE_PYTHON to select another installation.' >&2; exit 1; }
rclone_ok || { echo 'rclone >= 1.75.0 with serve sftp --stdio is required. Run brew upgrade rclone, then rerun this installer.' >&2; exit 1; }
if [[ -e "$ROOT/.venv" && ! -x "$ROOT/.venv/bin/python" ]]; then
  echo 'Existing .venv is incompatible with macOS. Rename it before rerunning; it was not deleted.' >&2; exit 1
fi
"$PYTHON" -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/python" -m pip install --disable-pip-version-check -r "$ROOT/local_client/requirements.txt"
"$ROOT/.venv/bin/python" -c 'import tkinter, paramiko, socks; print("Python client dependencies OK")'
cat > "$ROOT/Start-CodeBridge.command" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$ROOT"
exec "$ROOT/.venv/bin/python" -m local_client.app "$@"
LAUNCHER
chmod u+x "$ROOT/Start-CodeBridge.command"
printf '\nInstalled. Double-click %s/Start-CodeBridge.command or run it from Terminal.\n' "$ROOT"
echo 'If macOS blocks a downloaded launcher, review the package and use the normal Open action; this installer does not bypass Gatekeeper.'
