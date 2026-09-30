#!/usr/bin/env python3
"""Apply stemPatterns from Past Paper分類表 題型分析 into database.json / vocabulary.json."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATABASE_JSON = ROOT / "data" / "database.json"
DATABASE_JS = ROOT / "data" / "database.js"
VOCABULARY_JSON = ROOT / "data" / "vocabulary.json"
IMPORT_JSON = Path(__file__).resolve().parent / "stem_patterns_import.json"
VOCAB_JSON = Path(__file__).resolve().parent / "stem_patterns_vocab.json"

DESCRIPTION_STEM = (
    "stemPatterns are abstract stem templates from Past Paper分類表 題型分析 "
    "(distinct from patterns format tags)"
)


def main() -> None:
    with DATABASE_JSON.open(encoding="utf-8") as f:
        db = json.load(f)

    with IMPORT_JSON.open(encoding="utf-8") as f:
        import_map = json.load(f)

    with VOCAB_JSON.open(encoding="utf-8") as f:
        stem_vocab = json.load(f)

    applied = 0
    ensured = 0
    for q in db.get("questions", []):
        qid = q.get("id")
        if "stemPatterns" not in q:
            q["stemPatterns"] = []
            ensured += 1
        if qid in import_map:
            q["stemPatterns"] = list(import_map[qid].get("stemPatterns", []))
            applied += 1

    desc = db.get("description") or ""
    if "stemPatterns" not in desc:
        db["description"] = (
            f"{desc.rstrip()} {DESCRIPTION_STEM}."
            if desc
            else f"{DESCRIPTION_STEM}."
        )

    with DATABASE_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with VOCABULARY_JSON.open(encoding="utf-8") as f:
        vocabulary = json.load(f)
    vocabulary["stemPatterns"] = sorted(stem_vocab)
    with VOCABULARY_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(vocabulary, f, ensure_ascii=False, indent=2)
        f.write("\n")

    if DATABASE_JS.exists():
        js_body = json.dumps(db, ensure_ascii=False, indent=2)
        with DATABASE_JS.open("w", encoding="utf-8", newline="\n") as f:
            f.write(f"window.QUESTION_DATABASE = {js_body};\n")

    nonempty = sum(
        1 for q in db.get("questions", []) if q.get("stemPatterns")
    )
    print(
        f"Applied stemPatterns to {applied} questions; "
        f"ensured key on {ensured} questions; "
        f"{nonempty} questions with nonempty stemPatterns; "
        f"vocab entries={len(vocabulary['stemPatterns'])}."
    )


if __name__ == "__main__":
    main()
