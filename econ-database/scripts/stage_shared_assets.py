#!/usr/bin/env python3
"""Copy shared assets into a local checkout of the private data repository.

This does not call GitHub and does not read a token, owner, or repository
name. After it copies, commit and push from that private checkout yourself.

Layout under the private repository:

    shared/data/database.json
    shared/data/database.js
    shared/data/vocabulary.json
    shared/diagrams/...
    shared/originals/...
    shared/papers/mock-tests/...
    shared/papers/past-papers/...
    shared/build/...

Question records keep paths such as diagrams/MT27-P1-24.jpg and
originals/27/q-p1-01.jpg. Those paths are relative to shared/.

    python3 econ-database/scripts/stage_shared_assets.py --check
    ECON_DATA_ROOT=/path/to/private/checkout python3 econ-database/scripts/stage_shared_assets.py

--check validates every destination path against the same rules as
fetchSharedAsset. It does not copy. The source is the working tree when the
question bank is still there, otherwise the latest ancestor commit that still
has econ-database/data/database.json. A full clone is required for that
fallback. A shallow clone that starts after the assets were removed cannot
see them.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MARKER = "econ-database/data/database.json"

# (source path relative to the public repo, destination path relative to shared/)
DIR_MAP = (
    ("econ-database/diagrams", "diagrams"),
    ("econ-database/originals", "originals"),
    ("MockTests", "papers/mock-tests"),
    ("PastPaper", "papers/past-papers"),
)
FILE_MAP = (
    ("econ-database/data/database.json", "data/database.json"),
    ("econ-database/data/database.js", "data/database.js"),
    ("econ-database/data/vocabulary.json", "data/vocabulary.json"),
    ("econ-database/_readme_stem_stats.json", "build/_readme_stem_stats.json"),
)


def shared_segment_ok(part: str) -> bool:
    if not part or part in (".", "..") or len(part) > 180:
        return False
    for ch in part:
        code = ord(ch)
        if code < 32 or code == 127:
            return False
        if code < 128 and ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._() -":
            return False
    return True


def shared_rel_ok(path: str) -> bool:
    if not path or len(path) > 400 or ".." in path or "\\" in path or path.endswith("/"):
        return False
    if any(ord(ch) < 32 or ord(ch) == 127 or ch in '?#%<>:"|*' for ch in path):
        return False
    parts = path.split("/")
    if parts[0] not in {"data", "diagrams", "originals", "papers", "build"}:
        return False
    if not all(shared_segment_ok(part) for part in parts):
        return False
    file_name = parts[-1]
    dot = file_name.rfind(".")
    if dot <= 0:
        return False
    ext = file_name[dot + 1 :].lower()
    return ext in {
        "json", "js", "jpg", "jpeg", "png", "gif", "webp", "svg",
        "pdf", "docx", "doc", "jsonl", "txt", "md",
    }


def run_git(args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=REPO,
        check=check,
        capture_output=True,
    )


def blob_exists(sha: str, path: str) -> bool:
    result = run_git(["cat-file", "-e", f"{sha}:{path}"], check=False)
    return result.returncode == 0


def find_source_commit() -> str:
    sha = run_git(["rev-parse", "HEAD"]).stdout.decode().strip()
    for _ in range(40):
        if blob_exists(sha, MARKER):
            return sha
        parent = run_git(["rev-parse", f"{sha}^"], check=False)
        if parent.returncode != 0:
            break
        nxt = parent.stdout.decode().strip()
        if not nxt or nxt == sha:
            break
        sha = nxt
    return ""


def list_git(sha: str, prefix: str) -> list[str]:
    # -z avoids quoted non-ASCII paths, which would drop Chinese paper filenames.
    result = run_git(["ls-tree", "-r", "-z", "--name-only", sha, prefix], check=False)
    if result.returncode != 0:
        return []
    return [
        item.decode("utf-8", "surrogateescape")
        for item in result.stdout.split(b"\0")
        if item
    ]


def build_json_sources() -> list[tuple[str, str]]:
    found = []
    scripts = REPO / "econ-database" / "scripts"
    if scripts.is_dir():
        for path in scripts.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in {".json", ".jsonl"}:
                continue
            rel = path.relative_to(REPO).as_posix()
            dest_rel = path.relative_to(scripts).as_posix()
            found.append((rel, f"build/{dest_rel}"))
    return found


def worktree_pairs() -> list[tuple[str, str]] | None:
    if not (REPO / MARKER).is_file():
        return None
    pairs = list(FILE_MAP)
    for src, dest in DIR_MAP:
        root = REPO / src
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.is_file():
                rel = path.relative_to(root).as_posix()
                pairs.append((path.relative_to(REPO).as_posix(), f"{dest}/{rel}"))
    pairs.extend(build_json_sources())
    return pairs


def git_pairs(sha: str) -> list[tuple[str, str]]:
    pairs = []
    for src, dest in FILE_MAP:
        if blob_exists(sha, src):
            pairs.append((src, dest))
    for src, dest in DIR_MAP:
        for rel in list_git(sha, src):
            prefix = src.rstrip("/") + "/"
            if not rel.startswith(prefix):
                continue
            pairs.append((rel, f"{dest}/{rel[len(prefix):]}"))
    build_prefixes = (
        "econ-database/scripts/",
        "econ-database/_readme_stem_stats.json",
    )
    listed = list_git(sha, "econ-database/scripts")
    scripts_prefix = "econ-database/scripts/"
    for rel in listed:
        if not rel.startswith(scripts_prefix):
            continue
        if not rel.lower().endswith((".json", ".jsonl")):
            continue
        pairs.append((rel, "build/" + rel[len(scripts_prefix):]))
    if blob_exists(sha, build_prefixes[1]):
        # FILE_MAP already added the stats file when present.
        pass
    return pairs


def resolve_pairs() -> tuple[str, list[tuple[str, str]]]:
    working = worktree_pairs()
    if working is not None:
        return "worktree", working
    sha = find_source_commit()
    if not sha:
        raise SystemExit(
            "The question bank is not in the working tree, and no ancestor commit still has it."
        )
    return sha, git_pairs(sha)


def copy_file(source_label: str, src: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if source_label == "worktree":
        data = (REPO / src).read_bytes()
    else:
        data = run_git(["cat-file", "blob", f"{source_label}:{src}"]).stdout
    dest.write_bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Stage shared assets into a private data checkout.")
    parser.add_argument("--check", action="store_true", help="Validate paths and print counts. Do not copy.")
    args = parser.parse_args()

    label, pairs = resolve_pairs()
    bad = [dest for _src, dest in pairs if not shared_rel_ok(dest)]
    if bad:
        print(f"{len(bad)} destination path(s) are not allowed:", file=sys.stderr)
        for path in bad[:30]:
            print(path, file=sys.stderr)
        raise SystemExit(1)

    counts: dict[str, int] = {}
    for _src, dest in pairs:
        top = dest.split("/", 1)[0]
        counts[top] = counts.get(top, 0) + 1
    print(f"source: {label}")
    print(f"files: {len(pairs)}")
    for key in sorted(counts):
        print(f"  {key}: {counts[key]}")

    if args.check:
        return

    raw = os.environ.get("ECON_DATA_ROOT", "").strip()
    if not raw:
        raise SystemExit("Set ECON_DATA_ROOT to the private data checkout. Use --check to validate only.")
    root = Path(raw).expanduser().resolve()
    shared = root / "shared" if (root / "shared").is_dir() or not (root / "data").is_dir() else root
    if (root / "data").is_dir() and not (root / "shared").is_dir():
        shared = root
    elif (root / "shared").exists() or not (root / "data").is_dir():
        shared = root / "shared"
    shared.mkdir(parents=True, exist_ok=True)
    for src, dest in pairs:
        copy_file(label, src, shared / dest)
    print(f"copied into {shared}")


if __name__ == "__main__":
    main()
