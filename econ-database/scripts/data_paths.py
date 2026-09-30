"""Locations of shared question assets.

Diagrams, originals, the question bank, and paper packs are not stored in
this public site repository. Set ECON_DATA_ROOT to a local checkout of the
private data repository. Point it at the repository root (the directory that
contains shared/) or at shared/ itself.

Paths stored on each question stay relative to that shared folder:
diagrams/... and originals/...
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def shared_root() -> Path:
    raw = os.environ.get("ECON_DATA_ROOT", "").strip()
    if not raw:
        raise SystemExit(
            "Set ECON_DATA_ROOT to a checkout of the private data repository "
            "(the directory that contains shared/)."
        )
    root = Path(raw).expanduser().resolve()
    if (root / "shared").is_dir() and not (root / "data").is_dir():
        return root / "shared"
    return root


def data_dir() -> Path:
    return shared_root() / "data"


def diagrams_dir() -> Path:
    return shared_root() / "diagrams"


def originals_dir() -> Path:
    return shared_root() / "originals"


def mock_tests_dir() -> Path:
    return shared_root() / "papers" / "mock-tests"


def past_papers_dir() -> Path:
    return shared_root() / "papers" / "past-papers"


def build_dir() -> Path:
    return shared_root() / "build"


if __name__ == "__main__":
    try:
        print(shared_root())
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        raise
