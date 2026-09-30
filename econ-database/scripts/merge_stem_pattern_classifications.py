#!/usr/bin/env python3
"""Merge classify_chunks/out_01.json … out_08.json stemPatterns into the DB.

Only fills questions whose stemPatterns are currently empty (does not overwrite
nonempty Excel/auto values). Ensures every question has a stemPatterns key,
rebuilds vocabulary, regenerates database.js, and prints merge stats.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
from data_paths import build_dir, data_dir

CHUNKS = build_dir() / "classify_chunks"
DATABASE_JSON = data_dir() / "database.json"
DATABASE_JS = data_dir() / "database.js"
VOCABULARY_JSON = data_dir() / "vocabulary.json"
STEM_VOCAB_JSON = build_dir() / "stem_patterns_vocab.json"

DESCRIPTION = (
    "Each record is one question. topic is the chapter; concepts are specific "
    "ideas; patterns are format/style tags (e.g. 填空, 複選組合) and do not "
    "repeat questionType; stemPatterns are abstract stem templates describing "
    "question shape (placeholders, blanks, slash alternatives)—distinct from "
    "patterns. plainText is the wording. reviewedByAI is Y or N. lastReviewDate "
    "is YYYY-MM-DD when reviewed. The builder does not overwrite records with "
    "reviewedByAI Y."
)

SPOT_CHECK_IDS = (
    "DSE-2026-P1-01",
    "DSE-2023-P1-35",
    "DSE-PP-P1-01",
)


def load_outs() -> dict[str, list]:
    merged: dict[str, list] = {}
    for i in range(1, 9):
        path = CHUNKS / f"out_{i:02d}.json"
        with path.open(encoding="utf-8") as f:
            chunk = json.load(f)
        if not isinstance(chunk, dict):
            raise SystemExit(f"{path.name} must be a JSON object")
        for qid, pats in chunk.items():
            if qid in merged:
                raise SystemExit(f"Duplicate id across outs: {qid}")
            if not isinstance(pats, list):
                pats = [pats] if pats else []
            merged[qid] = [str(p) for p in pats if p]
    return merged


def text_preview(q: dict, n: int = 120) -> str:
    for key in ("questionTextChi", "questionTextEng"):
        t = (q.get(key) or "").strip()
        if t:
            return t[:n]
    return ""


def main() -> None:
    with DATABASE_JSON.open(encoding="utf-8") as f:
        db = json.load(f)

    with STEM_VOCAB_JSON.open(encoding="utf-8") as f:
        old_vocab = set(json.load(f))

    outs = load_outs()
    by_id = {q["id"]: q for q in db.get("questions", [])}

    applied = 0
    filled_from_text = 0
    newly_invented_applied: set[str] = set()

    for q in db.get("questions", []):
        if "stemPatterns" not in q or q["stemPatterns"] is None:
            q["stemPatterns"] = []
        if not isinstance(q["stemPatterns"], list):
            q["stemPatterns"] = list(q["stemPatterns"]) if q["stemPatterns"] else []

        # Only fill when currently empty — never overwrite nonempty Excel/auto.
        if q["stemPatterns"]:
            continue

        qid = q.get("id")
        if qid in outs and outs[qid]:
            q["stemPatterns"] = list(outs[qid])
            applied += 1
            for p in q["stemPatterns"]:
                if p not in old_vocab:
                    newly_invented_applied.add(p)

    # Step 2: still-empty → try first 120 chars of Chi/Eng text.
    still_empty_ids: list[str] = []
    for q in db.get("questions", []):
        if q.get("stemPatterns"):
            continue
        preview = text_preview(q, 120)
        if preview:
            q["stemPatterns"] = [preview]
            filled_from_text += 1
            if preview not in old_vocab:
                newly_invented_applied.add(preview)
        else:
            still_empty_ids.append(q["id"])
            q["stemPatterns"] = []

    # Rebuild stemPatterns vocab from all nonempty values across DB.
    freq: Counter[str] = Counter()
    for q in db.get("questions", []):
        for p in q.get("stemPatterns") or []:
            p = str(p).strip()
            if p:
                freq[p] += 1

    stem_vocab = sorted(freq.keys())

    db["description"] = DESCRIPTION
    db["questionCount"] = len(db.get("questions", []))

    with DATABASE_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with VOCABULARY_JSON.open(encoding="utf-8") as f:
        vocabulary = json.load(f)
    vocabulary["stemPatterns"] = stem_vocab
    with VOCABULARY_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(vocabulary, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with STEM_VOCAB_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(stem_vocab, f, ensure_ascii=False, indent=2)
        f.write("\n")

    js_body = json.dumps(db, ensure_ascii=False, indent=2)
    with DATABASE_JS.open("w", encoding="utf-8", newline="\n") as f:
        f.write(f"window.QUESTION_DATABASE = {js_body};\n")

    empty_count = sum(1 for q in db["questions"] if not q.get("stemPatterns"))
    top30 = freq.most_common(30)
    invented_sample = sorted(newly_invented_applied)[:20]

    print(f"applied count: {applied}")
    print(f"filled from questionText (first 120 chars): {filled_from_text}")
    print(f"still empty count: {empty_count}")
    print(f"unique stemPatterns count: {len(stem_vocab)}")
    print()
    print("top 30 most frequent stemPatterns:")
    for i, (p, c) in enumerate(top30, 1):
        print(f"  {i:2d}. ({c}) {p}")
    print()
    print(f"sample of 20 newly invented patterns (of {len(newly_invented_applied)}):")
    for p in invented_sample:
        print(f"  - {p}")
    print()
    if still_empty_ids:
        print(f"still-empty ids ({len(still_empty_ids)}):")
        for qid in still_empty_ids:
            print(f"  {qid}")
    else:
        print("still-empty ids: (none)")
    print()
    print("spot-check (expected scarcity/tax templates):")
    for qid in SPOT_CHECK_IDS:
        q = by_id.get(qid)
        if not q:
            print(f"  {qid}: MISSING from DB")
            continue
        print(f"  {qid}: {q.get('stemPatterns')}")


if __name__ == "__main__":
    main()
