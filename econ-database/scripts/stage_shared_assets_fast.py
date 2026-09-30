#!/usr/bin/env python3
"""Fast stage: use git archive (whole trees) instead of per-file cat-file.

Same layout as stage_shared_assets.py. Windows-friendly (uses `git archive`
piped to Python tarfile; no external tar required).

  python stage_shared_assets_fast.py --check
  set ECON_DATA_ROOT=C:\\path\\to\\econ-database-data
  python stage_shared_assets_fast.py
"""
from __future__ import annotations

import argparse
import io
import os
import subprocess
import sys
import tarfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2] if (Path(__file__).resolve().parents[2] / "econ-database").is_dir() else Path.cwd()
# When copied next to scripts in repo:
if not (REPO / "econ-database").is_dir():
    # script lives at econ-database/scripts/...
    here = Path(__file__).resolve()
    for p in [here.parents[2], here.parents[1], Path.cwd()]:
        if (p / "econ-database").is_dir() or (p / ".git").is_dir() and (p / "MockTests").exists():
            REPO = p
            break

MARKER = "econ-database/data/database.json"

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


def run_git(args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=REPO, check=check, capture_output=True)


def blob_exists(sha: str, path: str) -> bool:
    return run_git(["cat-file", "-e", f"{sha}:{path}"], check=False).returncode == 0


def find_source_commit() -> str:
    sha = run_git(["rev-parse", "HEAD"]).stdout.decode().strip()
    for _ in range(80):
        if blob_exists(sha, MARKER):
            return sha
        parent = run_git(["rev-parse", f"{sha}^"], check=False)
        if parent.returncode != 0:
            break
        nxt = parent.stdout.decode().strip()
        if not nxt or nxt == sha:
            break
        sha = nxt
    raise SystemExit("No ancestor still has " + MARKER)


def shared_root(root: Path) -> Path:
    if (root / "shared").is_dir() or not (root / "data").is_dir():
        return root / "shared"
    return root


def extract_tree(sha: str, src_prefix: str, dest_dir: Path) -> int:
    """Extract all files under src_prefix from sha into dest_dir (flat relative)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    # git archive with path prefix; strip the prefix via tar members
    proc = subprocess.run(
        ["git", "archive", "--format=tar", sha, src_prefix],
        cwd=REPO,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace")
        if "path not in" in err or "did not match" in err or "Not a valid object" in err:
            return 0
        raise SystemExit(f"git archive failed for {src_prefix}: {err}")
    count = 0
    prefix = src_prefix.rstrip("/") + "/"
    with tarfile.open(fileobj=io.BytesIO(proc.stdout), mode="r:") as tar:
        for m in tar.getmembers():
            if not m.isfile():
                continue
            name = m.name
            # git archive may use src_prefix/... or just ...
            if name.startswith(prefix):
                rel = name[len(prefix) :]
            elif name == src_prefix.rstrip("/"):
                continue
            else:
                # sometimes no prefix strip needed if archive rooted oddly
                if "/" in name and name.split("/", 1)[0] in {
                    "econ-database", "MockTests", "PastPaper"
                }:
                    # keep only after mapped prefix
                    if not name.startswith(src_prefix):
                        continue
                    rel = name[len(prefix) :] if name.startswith(prefix) else name
                else:
                    rel = name
            if not rel or ".." in rel:
                continue
            out = dest_dir / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            f = tar.extractfile(m)
            if f is None:
                continue
            out.write_bytes(f.read())
            count += 1
    return count


def write_blob(sha: str, src: str, dest: Path) -> bool:
    if not blob_exists(sha, src):
        return False
    data = run_git(["cat-file", "blob", f"{sha}:{src}"]).stdout
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--repo", type=str, default="", help="Source git repo root")
    args = ap.parse_args()
    global REPO
    if args.repo:
        REPO = Path(args.repo).resolve()

    t0 = time.time()
    sha = find_source_commit()
    print(f"source commit: {sha}")
    print(f"repo: {REPO}")

    if args.check:
        total = 0
        for src, dest in DIR_MAP:
            listed = run_git(["ls-tree", "-r", "--name-only", sha, src], check=False)
            n = len([x for x in listed.stdout.splitlines() if x]) if listed.returncode == 0 else 0
            print(f"  {dest}: {n} (from {src})")
            total += n
        for src, dest in FILE_MAP:
            ok = blob_exists(sha, src)
            print(f"  {dest}: {'1' if ok else '0'} (from {src})")
            total += int(ok)
        # build json under scripts
        listed = run_git(["ls-tree", "-r", "--name-only", sha, "econ-database/scripts"], check=False)
        build_n = 0
        if listed.returncode == 0:
            for line in listed.stdout.decode("utf-8", "replace").splitlines():
                if line.lower().endswith((".json", ".jsonl")):
                    build_n += 1
        stats = blob_exists(sha, "econ-database/_readme_stem_stats.json")
        print(f"  build extras: ~{build_n} json/jsonl under scripts (+ stats={int(stats)})")
        print(f"approx files: {total + build_n}")
        print(f"check done in {time.time()-t0:.1f}s")
        return

    raw = os.environ.get("ECON_DATA_ROOT", "").strip()
    if not raw:
        raise SystemExit("Set ECON_DATA_ROOT to the private data checkout root")
    root = Path(raw).expanduser().resolve()
    shared = shared_root(root)
    shared.mkdir(parents=True, exist_ok=True)
    print(f"dest: {shared}")

    total = 0
    for src, dest in DIR_MAP:
        n = extract_tree(sha, src, shared / dest)
        print(f"  {dest}: {n} files")
        total += n
    for src, dest in FILE_MAP:
        if write_blob(sha, src, shared / dest):
            print(f"  wrote {dest}")
            total += 1
    # build: only json/jsonl from scripts
    listed = run_git(["ls-tree", "-r", "-z", "--name-only", sha, "econ-database/scripts"], check=False)
    if listed.returncode == 0:
        scripts_prefix = "econ-database/scripts/"
        for item in listed.stdout.split(b"\0"):
            if not item:
                continue
            rel = item.decode("utf-8", "surrogateescape")
            if not rel.startswith(scripts_prefix):
                continue
            if not rel.lower().endswith((".json", ".jsonl")):
                continue
            dest_rel = "build/" + rel[len(scripts_prefix) :]
            if write_blob(sha, rel, shared / dest_rel):
                total += 1
    print(f"done: {total} files into {shared} in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
