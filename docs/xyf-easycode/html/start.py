#!/usr/bin/env python3
"""Start a local EasyCode editor server for zero-popup loading and saving."""

import argparse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import webbrowser


ROOT = Path(__file__).resolve().parent
PROJECT_FILE = ROOT / "software_architecture.js"
API_PATH = "/__easycode__/project"
ASSIGNMENT = re.compile(
    r"\A\s*globalThis\.softwareArchitecture\s*=\s*(\{.*\})\s*;\s*\Z",
    re.DOTALL,
)


def validate_payload(raw_bytes):
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("UTF-8 text is required") from exc
    match = ASSIGNMENT.fullmatch(text.lstrip("\ufeff"))
    if not match:
        raise ValueError("Expected globalThis.softwareArchitecture = <JSON>;")
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid JSON content") from exc
    if not isinstance(data, dict) or data.get("formatVersion") != 1:
        raise ValueError("Invalid softwareArchitecture formatVersion")
    return text


def atomic_write(destination, data):
    with tempfile.NamedTemporaryFile(
        mode="wb", dir=destination.parent, prefix=".easycode-save-", delete=False
    ) as handle:
        temp_path = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise
    try:
        if temp_path.read_bytes() != data:
            raise OSError("Temporary file verification failed")
        os.replace(temp_path, destination)
    finally:
        temp_path.unlink(missing_ok=True)


class EditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format_str, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_text(self, status, message, content_type="text/plain; charset=utf-8"):
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-EasyCode-Project", "1")
        self.end_headers()
        self.wfile.write(body)

    def _check_same_origin(self):
        if self.headers.get("X-EasyCode-Project") != "1":
            return False
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if origin and origin not in (f"http://{host}", f"https://{host}"):
            return False
        return True

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == API_PATH:
            if not PROJECT_FILE.is_file():
                self._send_text(HTTPStatus.NOT_FOUND, "software_architecture.js not found")
                return
            try:
                content = PROJECT_FILE.read_text(encoding="utf-8")
            except OSError as exc:
                self._send_text(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))
                return
            self._send_text(
                HTTPStatus.OK, content, "text/javascript; charset=utf-8"
            )
            return
        super().do_GET()

    def do_PUT(self):
        path = self.path.split("?", 1)[0]
        if path != API_PATH:
            self._send_text(HTTPStatus.NOT_FOUND, "Not found")
            return
        if not self._check_same_origin():
            self._send_text(HTTPStatus.FORBIDDEN, "Forbidden")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length <= 0 or length > 50 * 1024 * 1024:
            self._send_text(HTTPStatus.BAD_REQUEST, "Invalid content length")
            return
        raw = self.rfile.read(length)
        try:
            validate_payload(raw)
            atomic_write(PROJECT_FILE, raw)
        except (OSError, ValueError) as exc:
            self._send_text(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self._send_text(HTTPStatus.OK, "OK")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=0, help="Bind port (default: 0 for auto)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    args = parser.parse_args()

    with ThreadingHTTPServer((args.host, args.port), EditorHandler) as server:
        port = server.server_address[1]
        url = f"http://{args.host}:{port}/index.html"
        print(f"EasyCode editor running at: {url}", flush=True)
        print(f"Bound file: {PROJECT_FILE}", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        if not args.no_browser:
            threading.Timer(0.15, lambda: webbrowser.open(url)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
