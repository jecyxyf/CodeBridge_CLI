#!/usr/bin/env bash
# CodeBridge local web UI installer. Run as your normal desktop user, not with sudo.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_DEPS=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) printf 'Usage: bash local_client/scripts/linux.sh [--skip-deps] [--check]\n--skip-deps: use existing system dependencies and patched rclone; still installs Python requirements.\n--check: read-only dependency check; no installation or file changes.\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
[[ "$(uname -s)" == Linux ]] || { echo 'Use the macOS or Windows script on that platform.' >&2; exit 1; }
export PATH="$ROOT/.tools:$HOME/.local/bin:$PATH"
PYTHON="${CODEBRIDGE_PYTHON:-python3}"
python_ok() { "$PYTHON" -B -c 'import sys, tkinter, venv, ensurepip; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; }
rclone_ok() {
  [[ -x "$ROOT/.venv/bin/python" ]] &&
    "$ROOT/.venv/bin/python" -B "$ROOT/local_client/build_rclone.py" --check >/dev/null 2>&1
}
if (( CHECK_ONLY )); then
  python_ok || { echo 'Missing Python >= 3.10, Tkinter, or venv.' >&2; exit 1; }
  rclone_ok || { echo 'Missing verified CodeBridge rclone build. Run this installer without --check.' >&2; exit 1; }
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    "$ROOT/.venv/bin/python" -B -c 'import tkinter, paramiko, socks; print("Client imports OK")'
  else
    echo 'System dependencies OK; client .venv is not installed yet.'
  fi
  rclone version
  exit 0
fi
[[ "$EUID" != 0 ]] || { echo 'Run this script as your normal desktop user. It requests sudo only for OS packages.' >&2; exit 1; }
[[ -f "$ROOT/local_client/requirements.txt" ]] || { echo 'Run from an extracted complete CodeBridge package.' >&2; exit 1; }
if ! python_ok && (( ! SKIP_DEPS )); then
  command -v sudo >/dev/null || { echo 'sudo is required to install OS dependencies. Ask an administrator, then use --skip-deps.' >&2; exit 1; }
  echo 'Installing Python, Tkinter and venv using the system package manager. No SSH or firewall settings will change.'
  if command -v apt-get >/dev/null; then
    sudo apt-get update
    sudo apt-get install -y python3 python3-venv python3-tk ca-certificates
  elif command -v dnf >/dev/null; then
    sudo dnf install -y python3 python3-pip python3-tkinter ca-certificates
  elif command -v pacman >/dev/null; then
    sudo pacman -S --needed python python-pip tk ca-certificates
  elif command -v zypper >/dev/null; then
    sudo zypper install -y python3 python3-pip python3-tk ca-certificates
  else
    echo 'Unsupported package manager. Install Python >= 3.10 with tkinter and venv, then rerun with --skip-deps.' >&2
    exit 1
  fi
fi
python_ok || { echo 'Python >= 3.10 with tkinter and venv is required. CODEBRIDGE_PYTHON can select an existing interpreter.' >&2; exit 1; }
if [[ -e "$ROOT/.venv" && ! -x "$ROOT/.venv/bin/python" ]]; then
  echo 'Existing .venv is incompatible with Linux. Rename it before rerunning; it was not deleted.' >&2; exit 1
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
cat > "$ROOT/start-codebridge.sh" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$ROOT/.tools:$HOME/.local/bin:$PATH"
cd "$ROOT"
exec "$ROOT/.venv/bin/python" -m local_client.app "$@"
LAUNCHER
chmod u+x "$ROOT/start-codebridge.sh"
printf '\nInstalled. Start the local web UI: %s/start-codebridge.sh\n' "$ROOT"
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo 'No desktop display is present in this shell. Launch from a graphical Linux session; the web UI can still run, but the optional native folder picker requires a desktop.'
fi
