"""Build native release binaries, test synchronization, and package clean bundles."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import time
import tomllib
import zipfile


ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "bin" / "target"
VERSION = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
PLATFORMS = {
    "windows-x64": ("Windows", "x86_64-pc-windows-msvc"),
    "linux-x64": ("Linux", "x86_64-unknown-linux-gnu"),
    "macos-arm64": ("Darwin", "aarch64-apple-darwin"),
    "macos-x64": ("Darwin", "x86_64-apple-darwin"),
}


def run(*args, cwd=ROOT, env=None, capture=False, timeout=1800):
    print("+ " + " ".join(map(str, args)), flush=True)
    return subprocess.run(
        list(map(str, args)), cwd=cwd, env=env, text=True,
        capture_output=capture, check=True, timeout=timeout,
    ).stdout


def wait_for_sync(mutagen, env, predicate):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        run(mutagen, "sync", "flush", "--all", env=env, capture=True, timeout=30)
        if predicate():
            return
        time.sleep(1)
    raise RuntimeError("File synchronization did not finish within 45 seconds")


def smoke_test(binary):
    """Run the real embedded runtime in a separate data directory and app copy."""
    with tempfile.TemporaryDirectory(prefix="cb-") as directory:
        sandbox = Path(directory)
        app = sandbox / "app"
        alpha = sandbox / "alpha"
        beta = sandbox / "beta"
        home = sandbox / "home"
        for path in (app, alpha, beta, home):
            path.mkdir()
        client = app / binary.name
        shutil.copy2(binary, client)
        env = os.environ.copy()
        env.update(HOME=str(home), USERPROFILE=str(home), MUTAGEN_DATA_DIRECTORY=str(sandbox / "state"))
        (home / ".mutagen.yml").write_text(
            "sync:\n  defaults:\n    ignore:\n      vcs: true\n      paths:\n        - global-ignored\n",
            encoding="utf-8",
        )
        markers = [".git", "bin", "target", "node_modules", ".venv", "depends", "global-ignored"]
        for name in markers:
            path = alpha / name / "marker.txt"
            path.parent.mkdir()
            path.write_bytes(("release-marker:" + name).encode())
        if os.name != "nt":
            (alpha / "absolute-link").symlink_to(alpha / "bin" / "marker.txt")
        mutagen = app / ".codebridge_runtime" / ("mutagen.exe" if os.name == "nt" else "mutagen")
        try:
            result = json.loads(run(
                client, "start", "--vps-ip", "127.0.0.1", "--web-port", "3000",
                "--local-path", alpha, "--vps-path", beta,
                env=env, capture=True, timeout=90,
            ))
            assert result["ok"], result
            sessions = json.loads(run(mutagen, "sync", "list", "--template", "{{json .}}", env=env, capture=True, timeout=15))
            assert len(sessions) == 1, sessions
            session = sessions[0]
            assert session.get("mode") == "two-way-resolved", session
            assert not session.get("ignore", {}).get("vcs"), session
            assert not session.get("ignore", {}).get("paths"), session
            if os.name != "nt":
                assert session.get("symlink", {}).get("mode") == "posix-raw", session
            wait_for_sync(mutagen, env, lambda: all(
                (beta / name / "marker.txt").is_file()
                and (beta / name / "marker.txt").read_bytes() == (alpha / name / "marker.txt").read_bytes()
                for name in markers
            ))
            if os.name != "nt":
                assert os.readlink(beta / "absolute-link") == os.readlink(alpha / "absolute-link")
            (beta / "remote-marker.txt").write_bytes(b"remote-to-local")
            wait_for_sync(mutagen, env, lambda: (alpha / "remote-marker.txt").is_file()
                          and (alpha / "remote-marker.txt").read_bytes() == b"remote-to-local")
            print("PASS: full-file sync, VCS sync, global ignores bypassed, two-way sync, and platform symlink mode", flush=True)
        finally:
            if mutagen.is_file():
                for args in (("sync", "terminate", "--all"), ("forward", "terminate", "--all"), ("daemon", "stop")):
                    try:
                        subprocess.run([str(mutagen), *args], env=env, capture_output=True, timeout=20)
                    except subprocess.TimeoutExpired:
                        pass
                time.sleep(1)


def build(name):
    expected_system, expected_target = PLATFORMS[name]
    assert platform.system() == expected_system, (platform.system(), name)
    compiler = run("rustc", "-vV", capture=True)
    assert "host: " + expected_target in compiler, compiler
    mutagen_source = ROOT / "depends" / "mutagen"
    run("go", "run", "scripts/build.go", "--mode=slim", cwd=mutagen_source)
    assets = TARGET / "embedded_assets"
    (assets / "Local").mkdir(parents=True, exist_ok=True)
    suffix = ".exe" if name.startswith("windows") else ""
    shutil.copy2(mutagen_source / "build" / ("mutagen" + suffix), assets / "Local" / ("mutagen" + suffix))
    shutil.copy2(mutagen_source / "build" / "mutagen-agents.tar.gz", assets / "Local" / "mutagen-agents.tar.gz")
    bins = ["CodeBridgeLocal"]
    if name == "linux-x64":
        (assets / "VPS").mkdir(parents=True, exist_ok=True)
        shutil.copy2(mutagen_source / "build" / "agent" / "linux_amd64", assets / "VPS" / "mutagen-agent")
        bins.append("CodeBridgeVPS")
    args = ["cargo", "build", "--release", "--locked"]
    for binary_name in bins:
        args.extend(["--bin", binary_name])
    run(*args)
    client = TARGET / "release" / ("CodeBridgeLocal" + suffix)
    assert run(client, "--version", capture=True).strip() == "CodeBridgeLocal " + VERSION
    run(client, "--help", capture=True)
    smoke_test(client)
    stage = TARGET / "release-artifacts" / name
    (stage / "Local").mkdir(parents=True, exist_ok=True)
    shutil.copy2(client, stage / "Local" / client.name)
    if name == "linux-x64":
        server = TARGET / "release" / "CodeBridgeVPS"
        assert run(server, "--version", capture=True).strip() == "CodeBridgeVPS " + VERSION
        run(server, "--help", capture=True)
        (stage / "VPS").mkdir()
        shutil.copy2(server, stage / "VPS" / server.name)
    information = {
        "version": VERSION,
        "platform": name,
        "source_commit": run("git", "rev-parse", "HEAD", capture=True).strip(),
        "mutagen_commit": run("git", "rev-parse", "HEAD", cwd=mutagen_source, capture=True).strip(),
        "rustc": run("rustc", "--version", capture=True).strip(),
        "go": run("go", "version", capture=True).strip(),
        "synchronization_smoke_test": "passed",
    }
    (stage / "build-info.json").write_text(json.dumps(information, indent=2) + "\n", encoding="utf-8")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package():
    incoming = TARGET / "release-components"
    output = TARGET / "release-packages"
    output.mkdir(parents=True, exist_ok=True)
    metadata = {name: json.loads((incoming / ("component-" + name) / "build-info.json").read_text()) for name in PLATFORMS}
    for field in ("version", "source_commit", "mutagen_commit"):
        assert len({info[field] for info in metadata.values()}) == 1, (field, metadata)
    assert all(info["version"] == VERSION and info["synchronization_smoke_test"] == "passed" for info in metadata.values())
    checksums = []
    for name in PLATFORMS:
        with tempfile.TemporaryDirectory(prefix="cb-package-") as directory:
            stage = Path(directory)
            suffix = ".exe" if name.startswith("windows") else ""
            for side, source in (("Local", incoming / ("component-" + name) / "Local" / ("CodeBridgeLocal" + suffix)),
                                 ("VPS", incoming / "component-linux-x64" / "VPS" / "CodeBridgeVPS")):
                (stage / side).mkdir()
                executable = stage / side / source.name
                shutil.copy2(source, executable)
                executable.chmod(0o755)
            for skill in ("codebridge_local", "codebridge_vps_install"):
                shutil.copytree(ROOT / "skills" / skill, stage / "Local" / "skills" / skill)
            shutil.copytree(ROOT / "skills" / "codebridge_vps", stage / "VPS" / "skills" / "codebridge_vps")
            for document in ("README.md", "LICENSE"):
                shutil.copy2(ROOT / document, stage / document)
            info = {"client": metadata[name], "server": metadata["linux-x64"]}
            (stage / "BUILD-INFO.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
            stem = "CodeBridge-v" + VERSION + "-" + name
            files = sorted(path for path in stage.rglob("*") if path.is_file())
            if suffix:
                archive = output / (stem + ".zip")
                with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                    for path in files:
                        bundle.write(path, path.relative_to(stage).as_posix())
                with zipfile.ZipFile(archive) as bundle:
                    assert bundle.testzip() is None
                    assert set(bundle.namelist()) == {path.relative_to(stage).as_posix() for path in files}
            else:
                archive = output / (stem + ".tar.gz")
                with tarfile.open(archive, "w:gz") as bundle:
                    for path in files:
                        bundle.add(path, arcname=path.relative_to(stage).as_posix(), recursive=False)
                with tarfile.open(archive) as bundle:
                    assert set(bundle.getnames()) == {path.relative_to(stage).as_posix() for path in files}
                    for executable in ("Local/CodeBridgeLocal", "VPS/CodeBridgeVPS"):
                        assert bundle.getmember(executable).mode & 0o111
            checksum = sha256(archive)
            checksums.append(checksum + "  " + archive.name)
            print(archive.name + " " + checksum, flush=True)
    (output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("build").add_argument("platform", choices=PLATFORMS)
    subparsers.add_parser("package")
    arguments = parser.parse_args()
    if arguments.command == "build":
        build(arguments.platform)
    else:
        package()
