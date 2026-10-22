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
    -h|--help) printf 'Usage: bash local_client/scripts/linux.sh [--skip-deps] [--check]\n--skip-deps: use existing system dependencies; still installs Python requirements.\n--check: read-only dependency check; no installation or file changes.\n'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
[[ "$(uname -s)" == Linux ]] || { echo 'Use the macOS or Windows script on that platform.' >&2; exit 1; }
export PATH="$ROOT/.tools:$HOME/.local/bin:$PATH"
PYTHON="${CODEBRIDGE_PYTHON:-python3}"
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
  python_ok || { echo 'Missing Python >= 3.10, Tkinter, or venv.' >&2; exit 1; }
  rclone_ok || { echo 'Missing rclone >= 1.75.0 with serve sftp --stdio support.' >&2; exit 1; }
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    "$ROOT/.venv/bin/python" -c 'import tkinter, paramiko, socks; print("Client imports OK")'
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
if ! rclone_ok; then
  (( ! SKIP_DEPS )) || { echo 'Install a recent rclone from https://rclone.org/install/ and rerun.' >&2; exit 1; }
  echo 'Installing official rclone v1.75.2 in this project .tools directory (SHA-256 verified).'
  "$PYTHON" - "$ROOT/.tools" <<'PY'
import hashlib, io, os, platform, re, sys, urllib.request, zipfile
from pathlib import Path
arch = {"x86_64": "amd64", "aarch64": "arm64", "arm64": "arm64", "armv7l": "arm-v7", "i686": "386"}.get(platform.machine().lower())
if not arch:
    raise SystemExit("Unsupported rclone architecture. Install from https://rclone.org/downloads/ and rerun.")
def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "CodeBridge-deploy"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()
version = "v1.75.2"
name = f"rclone-{version}-linux-{arch}.zip"
base = f"https://downloads.rclone.org/{version}/"
sums = fetch(base + "SHA256SUMS").decode()
expected = None
for line in sums.splitlines():
    parts = line.split()
    if len(parts) == 2 and parts[1].lstrip("*") == name and re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
        expected = parts[0].lower()
if not expected:
    raise SystemExit("Official release checksum is missing; nothing was installed.")
data = fetch(base + name)
if hashlib.sha256(data).hexdigest() != expected:
    raise SystemExit("Checksum mismatch; refusing to install rclone.")
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    binary = archive.read(f"rclone-{version}-linux-{arch}/rclone")
destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
temporary = destination / "rclone.download"
temporary.write_bytes(binary)
os.chmod(temporary, 0o755)
temporary.replace(destination / "rclone")
print(f"Installed official rclone {version}")
PY
fi
rclone_ok || { echo 'rclone >= 1.75.0 with serve sftp --stdio is required. Update it and rerun.' >&2; exit 1; }
if [[ -e "$ROOT/.venv" && ! -x "$ROOT/.venv/bin/python" ]]; then
  echo 'Existing .venv is incompatible with Linux. Rename it before rerunning; it was not deleted.' >&2; exit 1
fi
"$PYTHON" -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/python" -m pip install --disable-pip-version-check -r "$ROOT/local_client/requirements.txt"
"$ROOT/.venv/bin/python" -c 'import tkinter, paramiko, socks; print("Python client dependencies OK")'
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
