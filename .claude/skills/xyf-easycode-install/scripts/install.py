#!/usr/bin/env python3
"""Deploy the bundled editor and copy the project's prompt rules."""

import argparse
from collections import Counter
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import urljoin, urlsplit
from urllib.request import url2pathname


SOURCE_REQUIRED = {
    "index.html": "file",
    "start.py": "file",
    "software_architecture.js": "file",
    "language.js": "file",
    "assert": "directory",
    "assert/language_zh.js": "file",
    "assert/language_eng.js": "file",
    "module": "directory",
    "references": "directory",
    "references/architecture-data.jsonc": "file",
}
LANGUAGES = {
    "zh": ("assert/language_zh.js", "zh-CN", "简体中文"),
    "en": ("assert/language_eng.js", "en", "English"),
}
ASSIGNMENT = re.compile(
    r"\A\s*(?://[^\n]*\n\s*)*globalThis\.EasyCodeLanguage\s*=\s*(\{.*\})\s*;?\s*\Z",
    re.DOTALL,
)
PLACEHOLDER = re.compile(r"\{([\w.-]+)\}", re.ASCII)
RULES_NAME = "PromptsRules.md"


def kind(path):
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        return "symlink"
    if path.is_dir():
        return "directory"
    if path.is_file():
        return "file"
    if path.exists():
        return "other"
    return "missing"


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate language key: " + key)
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("Invalid JSON constant: " + value)


def read_language(data, label):
    match = ASSIGNMENT.fullmatch(data.decode("utf-8-sig"))
    if not match:
        raise ValueError(label + ": expected globalThis.EasyCodeLanguage = <JSON>;")
    config = json.loads(
        match.group(1), object_pairs_hook=reject_duplicates, parse_constant=reject_constant
    )
    for field in ("locale", "name"):
        if not isinstance(config.get(field), str) or not config[field].strip():
            raise ValueError(label + ": missing or empty " + field)
    messages = config.get("messages")
    if not isinstance(messages, dict) or not messages:
        raise ValueError(label + ": messages must be a nonempty object")
    for key, value in messages.items():
        if not isinstance(value, str) or not value.strip() or value == key:
            raise ValueError(label + ": empty or untranslated message: " + key)
    return config


def validate_language(config, template, expected=None):
    messages, original = config["messages"], template["messages"]
    missing, extra = set(original) - set(messages), set(messages) - set(original)
    if missing or extra:
        raise ValueError(
            "Language message keys differ: "
            + json.dumps({"missing": sorted(missing), "extra": sorted(extra)})
        )
    for key, value in messages.items():
        if Counter(PLACEHOLDER.findall(value)) != Counter(PLACEHOLDER.findall(original[key])):
            raise ValueError("Language placeholders differ: " + key)
    if expected and any(config[field] != expected[field] for field in ("locale", "name")):
        raise ValueError("Language locale/name differ from the requested language; existing files preserved")


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
        self.base = None

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if tag == "base" and name == "href":
                if self.base is None:
                    self.base = value
                continue
            if name in ("src", "href") and value:
                self.paths.append(value)


def check_references(data, target, planned=()):
    parser = References()
    parser.feed(data.decode("utf-8-sig"))
    base = urljoin((target / "index.html").as_uri(), parser.base or "")
    missing = []
    for reference in parser.paths:
        if not urlsplit(reference).path:
            continue
        url = urlsplit(urljoin(base, reference.strip()))
        if url.scheme != "file" or url.netloc not in ("", "localhost"):
            continue
        path = Path(url2pathname(url.path)).resolve()
        if not path.is_file() and path not in planned:
            missing.append(reference)
    if missing:
        raise ValueError("Missing local index.html resources: " + ", ".join(missing))


def publish_missing_file(destination, data):
    # Stage on the destination filesystem. Normal file creation respects umask.
    with tempfile.TemporaryDirectory(prefix=".easycode-", dir=destination.parent) as staging:
        temporary = Path(staging) / destination.name
        with temporary.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        if temporary.read_bytes() != data:
            raise ValueError("Temporary file verification failed: " + str(destination))
        # Creating a hard link is atomic and fails if any destination item exists.
        # Do not fall back to rename/replace, which could overwrite existing files.
        os.link(temporary, destination)


def install_editor(args, report):
    project = Path(args.project).expanduser().resolve()
    workspace = project / "docs" / "xyf-easycode"
    target = workspace / "html"
    report.update(workspace=str(workspace), entry=str(target / "index.html"), copied=0)

    # Do not follow deployment directories that could redirect writes elsewhere.
    for directory in (project, project / "docs", workspace, target):
        if kind(directory) not in ("missing", "directory"):
            raise ValueError("Directory conflict (preserved): " + str(directory))

    source = Path(__file__).resolve().parent.parent / "html"
    if target == source or source in target.parents or target in source.parents:
        raise ValueError("The deployment destination must not overlap the skill's HTML source")
    if any(kind(source / relative) != expected for relative, expected in SOURCE_REQUIRED.items()):
        raise ValueError("The skill's HTML source is incomplete")

    entries = sorted(source.rglob("*"))
    files, directories, conflicts = [], [], []
    complete = True
    for entry in entries:
        relative = entry.relative_to(source)
        expected, actual = kind(entry), kind(target / relative)
        if expected not in ("file", "directory"):
            raise ValueError("Unsupported source item: " + str(entry))
        if actual not in ("missing", expected):
            conflicts.append(str(target / relative))
        if actual == "missing":
            complete = False
        (files if expected == "file" else directories).append(relative)
    if conflicts:
        raise ValueError("File/directory conflicts (preserved): " + ", ".join(conflicts))

    # Check the entire source inventory, without reading any file contents.
    if complete:
        report.update(
            status="skipped",
            preserved=len(files),
            checks={"inventory": "passed", "contents": "not_checked"},
        )
        return

    baseline = read_language((source / "assert/language_zh.js").read_bytes(), "Chinese template")
    language_data, selected = None, None
    if args.language:
        filename, locale, name = LANGUAGES[args.language]
        language_data = (source / filename).read_bytes()
        selected = read_language(language_data, filename)
        validate_language(selected, baseline, {"locale": locale, "name": name})
    elif args.language_file:
        language_data = Path(args.language_file).expanduser().read_bytes()
        selected = read_language(language_data, args.language_file)
        validate_language(selected, baseline)

    language_path = target / "language.js"
    current = None
    if language_path.is_file():
        current = read_language(language_path.read_bytes(), str(language_path))
        validate_language(current, baseline, selected)
    elif selected is None:
        raise ValueError("language.js is missing; confirm the language, then use --language zh/en or --language-file PATH")
    report["locale"] = (current if current is not None else selected)["locale"]

    # Validate the complete plan before creating any files.
    pending = {}
    for relative in files:
        destination = target / relative
        if not destination.exists():
            pending[relative] = language_data if relative == Path("language.js") else (source / relative).read_bytes()
    index = target / "index.html"
    index_data = index.read_bytes() if index.is_file() else pending[Path("index.html")]
    check_references(index_data, target, {target / relative for relative in files})

    target.mkdir(parents=True, exist_ok=True)
    for relative in directories:
        (target / relative).mkdir(parents=True, exist_ok=True)
    for relative, data in pending.items():
        destination = target / relative
        publish_missing_file(destination, data)
        report["copied"] += 1
        if destination.read_bytes() != data:
            raise ValueError("Copied file verification failed: " + str(destination))

    if any(not (target / relative).is_file() for relative in files):
        raise ValueError("Source inventory verification failed")
    check_references(index.read_bytes(), target)
    report.update(
        status="installed",
        preserved=len(files) - len(pending),
        checks={"inventory": "passed", "copied_contents": "passed", "language": "passed", "local_resources": "passed"},
    )


def install(args, report):
    install_editor(args, report)
    source = Path(__file__).resolve().parent.parent / RULES_NAME
    destination = Path(report["workspace"]) / RULES_NAME
    state = kind(destination)
    if state not in ("missing", "file"):
        raise ValueError("File conflict (preserved): " + str(destination))
    report["rules_path"] = str(destination)
    # Keep the project's own rules; only copy the template when the file is missing.
    if state == "file":
        report["rules"] = "preserved"
        return
    data = source.read_bytes()
    publish_missing_file(destination, data)
    if destination.read_bytes() != data:
        raise ValueError("Copied file verification failed: " + str(destination))
    report["rules"] = "copied"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="Target project directory")
    language = parser.add_mutually_exclusive_group()
    language.add_argument("--language", choices=sorted(LANGUAGES), help="Confirmed UI language; existing files are preserved")
    language.add_argument("--language-file", help="Reviewed translation in the same JSON assignment format as the templates")
    args = parser.parse_args()
    started = time.perf_counter()
    report = {"status": "error", "browser": "not_opened"}
    try:
        install(args, report)
    except (OSError, ValueError) as error:
        report.update(status="error", error=str(error))
    report["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["status"] == "error" else 0


if __name__ == "__main__":
    sys.exit(main())
