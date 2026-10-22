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
export PATH="$ROOT/.tools:/opt/homebrew/bin:/usr/local/bin:$PATH"
if command -v brew >/dev/null 2>&1; then
  BREW_PREFIX="$(brew --prefix)"
else
  BREW_PREFIX=""
fi
PYTHON="${CODEBRIDGE_PYTHON:-${BREW_PREFIX:-/usr/local}/opt/python@3.13/bin/python3.13}"
python_ok() { "$PYTHON" -B -c 'import sys, tkinter, venv, ensurepip; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; }
rclone_ok() {
  [[ -x "$ROOT/.venv/bin/python" ]] &&
    "$ROOT/.venv/bin/python" -B "$ROOT/local_client/build_rclone.py" --check >/dev/null 2>&1
}
if (( CHECK_ONLY )); then
  python_ok || { echo 'Missing Python >= 3.10 with tkinter and venv (or set CODEBRIDGE_PYTHON).' >&2; exit 1; }
  rclone_ok || { echo 'Missing verified CodeBridge rclone build. Run this installer without --check.' >&2; exit 1; }
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    "$ROOT/.venv/bin/python" -B -c 'import tkinter, paramiko, socks; print("Client imports OK")'
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
    echo 'Alternatively install Python with Tkinter and the verified CodeBridge rclone build, set CODEBRIDGE_PYTHON, and use --skip-deps.' >&2
    exit 1
  fi
  echo 'Installing Python 3.13 and Tkinter through Homebrew. No SSH or security settings will change.'
  brew install python@3.13 python-tk@3.13
fi
python_ok || { echo 'Python >= 3.10 with tkinter and venv is required. Set CODEBRIDGE_PYTHON to select another installation.' >&2; exit 1; }
if [[ -e "$ROOT/.venv" && ! -x "$ROOT/.venv/bin/python" ]]; then
  echo 'Existing .venv is incompatible with macOS. Rename it before rerunning; it was not deleted.' >&2; exit 1
fi
"$PYTHON" -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/python" -m pip install --disable-pip-version-check -r "$ROOT/local_client/requirements.txt"
"$ROOT/.venv/bin/python" -c 'import tkinter, paramiko, socks; print("Python client dependencies OK")'
if ! rclone_ok; then
  (( ! SKIP_DEPS )) || { echo 'Verified patched rclone is required. Run without --skip-deps to build it inside .tools.' >&2; exit 1; }
  "$ROOT/.venv/bin/python" "$ROOT/local_client/build_rclone.py"
fi
rclone_ok || { echo 'Patched rclone build verification failed.' >&2; exit 1; }
(cd "$ROOT" && "$ROOT/.venv/bin/python" -m local_client.rclone_check --rclone "$ROOT/.tools/rclone")
cat > "$ROOT/Start-CodeBridge.command" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$ROOT/.tools:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$ROOT"
exec "$ROOT/.venv/bin/python" -m local_client.app "$@"
LAUNCHER
chmod u+x "$ROOT/Start-CodeBridge.command"
printf '\nInstalled. Double-click %s/Start-CodeBridge.command or run it from Terminal.\n' "$ROOT"
echo 'If macOS blocks a downloaded launcher, review the package and use the normal Open action; this installer does not bypass Gatekeeper.'
