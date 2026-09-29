#!/usr/bin/env python3
"""Merge HKEAA classification fields from the Sheets-backed database into
the local question bank.

Policy (from review of both banks):
- AristochapterClassification / curriculumClassification: prefer Sheets when
  present; keep local when Sheets left them blank (older CE/AL items).
- topic: rebuild from chapter numbers via CHAPTER_DESCRIPTIONS.
- concepts: rebuild from Sheets learning-focus + stem when possible, using the
  local short vocabulary. Prefer a concept the stem explicitly asks about.
  Keep local labels only when neither focus nor stem yields a match.
- patterns / multipleSelectionType: keep the local bank's simpler labels;
  lightly drop 計算 / 複選組合 when Sheets says the item is neither.
- graphType / tableType / calculationType: keep local vocabulary; only fill
  from Sheets when local is empty and the Sheets label already exists in
  vocabulary.json. Long Sheets type labels are ignored.
- outSyl: copy Sheets Y flags onto matching local rows.
- Mock-paper rows are not overwritten from Sheets; topic strings are aligned
  to their existing chapter labels.

Does not modify the Sheets-backed database.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.parse
import urllib.request
from collections import Counter
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DB_JSON = DATA / "database.json"
DB_JS = DATA / "database.js"
VOCAB = DATA / "vocabulary.json"
CONSTANTS = ROOT / "js" / "constants.js"
INDEX = ROOT / "index.html"

SHEETS_URL = (
    "https://script.google.com/macros/s/"
    "AKfycbyz0vQ1VM5ouux34jApZpvWbkW48u-4OOKQYJmUij6LfIq6ulEm9oCwfWvyL33fMg85/exec"
)
SEP = chr(30)
ROW = chr(31)

CHAPTER_DESCRIPTIONS = {
    "01": "基本經濟概念",
    "02": "三個基本經濟問題與私有產權",
    "03": "廠商的所有權形式",
    "04": "生產與分工",
    "05": "生產要素",
    "06": "生產及成本",
    "07": "廠商的目標與擴張",
    "08": "市場價格的訂定",
    "09": "市場價格的變化",
    "10": "需求和供應的價格彈性",
    "11": "市場干預",
    "12": "市場結構",
    "13": "效率、公平和政府的角色 (I)",
    "14": "效率、公平和政府的角色 (II)",
    "15": "經濟表現的量度 (I)",
    "16": "經濟表現的量度 (II)",
    "17": "總需求和總供應",
    "18": "產出和價格的決定",
    "19": "貨幣與銀行",
    "20": "貨幣供應和貨幣需求",
    "21": "經濟周期、一般物價水平的變動和失業",
    "22": "財政政策與貨幣政策",
    "23": "國際貿易",
    "24": "貿易障礙",
    "25": "國際收支平衡表與匯率",
    "26": "壟斷定價",
    "27": "反競爭行為與競爭政策",
    "28": "貿易理論的延伸",
    "29": "經濟增長及發展",
}

NEGATIVE_TYPE_LABELS = {
    "",
    "-",
    "沒有圖",
    "沒有表格",
    "沒有計算",
    "未命名計算題",
    "未命名圖表",
    "未命名表格",
    "並非複選型",
    "不適用",
}


def chapter_num(tag: str) -> str:
    m = re.search(r"(\d{1,2})", tag or "")
    return m.group(1).zfill(2) if m else ""


def topic_from_chapters(chapters: list[str]) -> str:
    names = []
    for ch in chapters:
        num = chapter_num(ch)
        if num and num in CHAPTER_DESCRIPTIONS:
            names.append(CHAPTER_DESCRIPTIONS[num])
    return "；".join(names)


def normalize_chapters(values) -> list[str]:
    out = []
    seen = set()
    for v in values or []:
        num = chapter_num(str(v))
        if not num:
            continue
        tag = f"Ch{num}"
        if tag not in seen:
            seen.add(tag)
            out.append(tag)
    return out


def nonempty_list(values) -> list:
    if not values:
        return []
    if isinstance(values, str):
        values = [s.strip() for s in values.split(",") if s.strip()]
    return [v for v in values if v and v != "-"]


def is_blank_type(value) -> bool:
    if value is None:
        return True
    text = str(value).strip()
    return text in NEGATIVE_TYPE_LABELS


def concepts_from_learning_focus(
    lf: str, vocab_concepts: list[str], question_text: str = ""
) -> list[str]:
    """Turn a Sheets learning-focus string into short concept labels.

    Prefer vocabulary hits inside the learning-focus text. Fall back to a short
    focus phrase only when it is compact enough to use as a concept.
    """
    text = (lf or "").strip()
    if text == "-":
        text = ""

    generic = {"成本", "價格", "供需", "均衡", "產量", "數量", "收入", "利潤", "產出"}

    def norm(s: str) -> str:
        out = (
            s.replace(" ", "")
            .replace("和", "與")
            .replace("／", "/")
            .replace("（", "(")
            .replace("）", ")")
        )
        for filler in (
            "區分",
            "解釋",
            "了解",
            "分析",
            "列出",
            "透過",
            "利用",
            "說明",
            "比較",
            "討論",
            "指出",
        ):
            out = out.replace(filler, "")
        return out

    def soft(s: str) -> str:
        return norm(s).replace("陳述", "")

    def extract_hits(source: str, allow_generic: bool = False) -> list[str]:
        if not source:
            return []
        hays = [norm(source), soft(source)]
        found = []
        for concept in sorted(vocab_concepts, key=len, reverse=True):
            n_concept = norm(concept)
            s_concept = soft(concept)
            if not n_concept:
                continue
            if any(n_concept in h or s_concept in h for h in hays):
                if allow_generic or concept not in generic:
                    found.append(concept)
        out = []
        for concept in found:
            if any(concept != other and concept in other for other in found):
                continue
            out.append(concept)
        specific = [c for c in out if c not in generic]
        return specific or out

    lf_hits = extract_hits(text)

    stem = question_text or ""
    cut = re.search(r"\n\s*A[\.、\t ]", stem)
    if cut:
        stem = stem[: cut.start()]
    stem_hits = extract_hits(stem[:500])

    # Concepts the stem is explicitly asking about beat broader learning-focus
    # wording. Mentions inside examples / numbered statements do not.
    asked = []
    for concept in sorted(vocab_concepts, key=len, reverse=True):
        if concept in generic:
            continue
        if re.search(
            rf"(下列|哪項|哪些|哪種|屬於|屬|是).{{0,30}}{re.escape(concept)}",
            stem,
        ):
            asked.append(concept)
    asked_filtered = []
    for concept in asked:
        if any(concept != other and concept in other for other in asked):
            continue
        asked_filtered.append(concept)

    if asked_filtered:
        filtered = asked_filtered
    elif lf_hits:
        filtered = lf_hits
    elif stem_hits:
        filtered = stem_hits
    else:
        filtered = []

    if filtered:
        return filtered[:4]

    # If focus mentions production kinds / sectors, prefer that label.
    if any(k in text for k in ("初級生產", "次級生產", "三級生產", "生產種類", "生產類別")):
        if "生產類別" in vocab_concepts:
            return ["生產類別"]

    compact = re.split(r"[，,、；;：:]", text)
    compact = [p.strip() for p in compact if p.strip()]
    short = [p for p in compact if 2 <= len(p) <= 18]
    if short:
        # Prefer a short phrase that already exists in vocabulary.
        for phrase in short:
            for concept in vocab_concepts:
                if soft(concept) == soft(phrase) or soft(concept) in soft(phrase):
                    return [concept]
        return short[:3]
    if len(text) <= 18:
        return [text]
    return []


def parse_sheets_payload(data: str) -> dict[str, dict]:
    lines = [ln for ln in data.split(ROW) if ln.strip()]
    headers = [h.strip() for h in lines[0].split(SEP)]
    by_id = {}
    for line in lines[1:]:
        vals = line.split(SEP)
        q = {}
        for i, header in enumerate(headers):
            raw = vals[i] if i < len(vals) else ""
            raw = raw.replace("\\n", "\n").strip()
            if header in {
                "curriculumClassification",
                "AristochapterClassification",
                "concepts",
                "patterns",
            }:
                q[header] = nonempty_list(raw)
            else:
                q[header] = raw
        qid = q.get("id")
        if qid:
            by_id[qid] = q
    return by_id


def fetch_sheets(username: str) -> dict[str, dict]:
    url = f"{SHEETS_URL}?username={urllib.parse.quote(username)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("error") or not payload.get("success"):
        raise SystemExit(f"Sheets fetch failed: {payload}")
    return parse_sheets_payload(payload["data"])


def load_sheets_from_file(path: Path) -> dict[str, dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "data" in raw:
        return parse_sheets_payload(raw["data"])
    if isinstance(raw, dict) and "questions" in raw:
        return {q["id"]: q for q in raw["questions"] if q.get("id")}
    raise SystemExit(f"Unrecognized sheets file format: {path}")


def bump_app_version(today: str = "2026.09.30") -> str:
    text = CONSTANTS.read_text(encoding="utf-8")
    m = re.search(r"const APP_VERSION = '([^']+)'", text)
    if not m:
        raise SystemExit("APP_VERSION not found")
    old = m.group(1)
    parts = old.split(".")
    if len(parts) >= 4 and ".".join(parts[:3]) == today:
        new = f"{today}.{int(parts[3]) + 1}"
    else:
        new = f"{today}.1"
    CONSTANTS.write_text(text.replace(old, new, 1), encoding="utf-8")
    html = INDEX.read_text(encoding="utf-8")
    html2, n = re.subn(r"(\?v=)[^\"'\s>]+", rf"\g<1>{new}", html)
    if n == 0:
        raise SystemExit("No ?v= query params found in index.html")
    INDEX.write_text(html2, encoding="utf-8")
    return new


def write_database(db: dict) -> None:
    DB_JSON.write_text(
        json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    DB_JS.write_text(
        "window.QUESTION_DATABASE = "
        + json.dumps(db, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )


def sync_vocabulary(questions: list[dict]) -> None:
    vocab = json.loads(VOCAB.read_text(encoding="utf-8"))
    note = vocab.get("note", "")

    def collect(field: str, skip=("-", "", None)):
        values = set(vocab.get(field, []))
        for q in questions:
            val = q.get(field if field != "diagramTypes" else "graphType")
            key = {
                "concepts": "concepts",
                "patterns": "patterns",
                "diagramTypes": "graphType",
                "tableTypes": "tableType",
                "calculationTypes": "calculationType",
                "multipleSelectionTypes": "multipleSelectionType",
            }[field]
            raw = q.get(key)
            if isinstance(raw, list):
                for item in raw:
                    if item and item not in skip:
                        values.add(item)
            elif raw and raw not in skip:
                values.add(raw)
        return sorted(values)

    vocab = {
        "concepts": collect("concepts"),
        "patterns": collect("patterns"),
        "diagramTypes": collect("diagramTypes"),
        "tableTypes": collect("tableTypes"),
        "calculationTypes": collect("calculationTypes"),
        "multipleSelectionTypes": collect("multipleSelectionTypes"),
        "note": note
        or "Written by build_mock_questions.py from database.json. Do not edit by hand.",
    }
    VOCAB.write_text(
        json.dumps(vocab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def merge_question(local: dict, sheets: dict, vocab: dict, stats: Counter) -> dict:
    updated = deepcopy(local)
    changed = False
    chapters_changed = False

    sheets_chapters = normalize_chapters(sheets.get("AristochapterClassification"))
    if sheets_chapters:
        if normalize_chapters(local.get("AristochapterClassification")) != sheets_chapters:
            updated["AristochapterClassification"] = sheets_chapters
            changed = True
            chapters_changed = True
            stats["chapter_updated"] += 1
        topic = topic_from_chapters(sheets_chapters)
        if topic and updated.get("topic") != topic:
            updated["topic"] = topic
            changed = True
            stats["topic_updated"] += 1
    else:
        stats["chapter_kept_local_blank_sheets"] += 1

    sheets_curr = nonempty_list(sheets.get("curriculumClassification"))
    if sheets_curr:
        if nonempty_list(local.get("curriculumClassification")) != sheets_curr:
            updated["curriculumClassification"] = sheets_curr
            changed = True
            stats["curriculum_updated"] += 1
    else:
        stats["curriculum_kept_local_blank_sheets"] += 1

    # Concepts: prefer short labels rebuilt from Sheets learning focus when that
    # focus yields vocabulary matches. Otherwise keep the local AI labels.
    local_concepts = nonempty_list(local.get("concepts"))
    rebuilt = concepts_from_learning_focus(
        sheets.get("Aristolearningfocus") or "",
        vocab.get("concepts", []),
        local.get("plainText") or local.get("questionTextChi") or "",
    )
    if rebuilt:
        if rebuilt != local_concepts:
            updated["concepts"] = rebuilt
            changed = True
            stats["concepts_rebuilt_from_focus"] += 1
        else:
            stats["concepts_kept_local"] += 1
    elif chapters_changed and not local_concepts:
        stats["concepts_empty"] += 1
    else:
        stats["concepts_kept_local"] += 1

    # Patterns and multiple-selection labels stay local (simpler scheme), with
    # light cleanup when Sheets shows the question is neither calculation nor
    # multiple-selection and the chapter assignment just changed.
    patterns = list(nonempty_list(updated.get("patterns")))
    if chapters_changed and patterns:
        ms = sheets.get("multipleSelectionType") or ""
        calc = sheets.get("calculationType") or ""
        cleaned = patterns
        if ms in {"並非複選型", "不適用"}:
            cleaned = [p for p in cleaned if p not in {"複選組合", "多項選擇題"}]
        if calc in {"", "-", "沒有計算", "未命名計算題"}:
            cleaned = [p for p in cleaned if p != "計算"]
        if cleaned != patterns:
            updated["patterns"] = cleaned or patterns
            if cleaned:
                changed = True
                stats["patterns_cleaned"] += 1
            else:
                stats["patterns_kept_local"] += 1
        else:
            stats["patterns_kept_local"] += 1
    else:
        stats["patterns_kept_local"] += 1

    for field, vocab_key in (
        ("graphType", "diagramTypes"),
        ("tableType", "tableTypes"),
        ("calculationType", "calculationTypes"),
    ):
        local_val = local.get(field)
        sheets_val = sheets.get(field)
        if is_blank_type(local_val) and not is_blank_type(sheets_val):
            if sheets_val in set(vocab.get(vocab_key, [])):
                updated[field] = sheets_val
                changed = True
                stats[f"{field}_filled_from_sheets"] += 1
            else:
                stats[f"{field}_sheets_unmapped"] += 1
        else:
            stats[f"{field}_kept_local"] += 1

    sheets_out = str(sheets.get("outSyl") or "").strip().upper()
    local_out = str(local.get("outSyl") or "").strip().upper()
    if sheets_out == "Y" and local_out != "Y":
        updated["outSyl"] = "Y"
        changed = True
        stats["outSyl_set"] += 1
    elif sheets_out != "Y" and local_out == "Y":
        stats["outSyl_kept_local"] += 1

    if changed:
        updated["reviewedByAI"] = "Y"
        updated["lastReviewDate"] = "2026-09-30"
        stats["rows_changed"] += 1
    else:
        stats["rows_unchanged"] += 1
    return updated


def review_mock_consistency(questions: list[dict]) -> list[dict]:
    """Flag mock questions whose topic does not match chapter labels."""
    issues = []
    for q in questions:
        if not str(q.get("id", "")).startswith("M"):
            continue
        chapters = normalize_chapters(q.get("AristochapterClassification"))
        expected = topic_from_chapters(chapters)
        topic = q.get("topic") or ""
        if chapters and expected and topic and topic != expected:
            # Allow semicolon vs Chinese semicolon and partial multi-topic.
            if expected not in topic and topic not in expected:
                issues.append(
                    {
                        "id": q["id"],
                        "topic": topic,
                        "chapters": chapters,
                        "expectedTopic": expected,
                        "concepts": q.get("concepts"),
                        "patterns": q.get("patterns"),
                    }
                )
    return issues


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default="colleagues")
    parser.add_argument("--sheets-file", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--report",
        type=Path,
        default=ROOT / "scripts" / "merge_hkeaa_report.json",
    )
    args = parser.parse_args()

    if args.sheets_file:
        sheets_by_id = load_sheets_from_file(args.sheets_file)
    else:
        sheets_by_id = fetch_sheets(args.username)

    db = json.loads(DB_JSON.read_text(encoding="utf-8"))
    vocab = json.loads(VOCAB.read_text(encoding="utf-8"))
    stats: Counter = Counter()
    examples = []

    new_questions = []
    for q in db["questions"]:
        qid = q.get("id")
        if qid in sheets_by_id:
            before = {
                "AristochapterClassification": q.get("AristochapterClassification"),
                "curriculumClassification": q.get("curriculumClassification"),
                "topic": q.get("topic"),
                "concepts": q.get("concepts"),
                "patterns": q.get("patterns"),
                "graphType": q.get("graphType"),
                "tableType": q.get("tableType"),
                "calculationType": q.get("calculationType"),
                "outSyl": q.get("outSyl"),
            }
            merged = merge_question(q, sheets_by_id[qid], vocab, stats)
            after = {
                "AristochapterClassification": merged.get("AristochapterClassification"),
                "curriculumClassification": merged.get("curriculumClassification"),
                "topic": merged.get("topic"),
                "concepts": merged.get("concepts"),
                "patterns": merged.get("patterns"),
                "graphType": merged.get("graphType"),
                "tableType": merged.get("tableType"),
                "calculationType": merged.get("calculationType"),
                "outSyl": merged.get("outSyl"),
            }
            if before != after and len(examples) < 80:
                examples.append(
                    {
                        "id": qid,
                        "before": before,
                        "after": after,
                        "learningFocus": sheets_by_id[qid].get("Aristolearningfocus"),
                    }
                )
            new_questions.append(merged)
            stats["matched"] += 1
        else:
            new_questions.append(q)
            if q.get("publisher") == "HKEAA":
                stats["hkeaa_unmatched"] += 1
            else:
                stats["mock_skipped"] += 1

    mock_issues = review_mock_consistency(new_questions)
    # Auto-fix mock topic when chapters clearly imply a single topic string.
    mock_fixed = 0
    for i, q in enumerate(new_questions):
        if not str(q.get("id", "")).startswith("M"):
            continue
        chapters = normalize_chapters(q.get("AristochapterClassification"))
        expected = topic_from_chapters(chapters)
        if chapters and expected and q.get("topic") != expected:
            # Only auto-fix when chapter set is non-empty.
            q = deepcopy(q)
            q["topic"] = expected
            q["reviewedByAI"] = "Y"
            q["lastReviewDate"] = "2026-09-30"
            new_questions[i] = q
            mock_fixed += 1

    mock_issues_after = review_mock_consistency(new_questions)

    report = {
        "stats": dict(stats),
        "sheets_count": len(sheets_by_id),
        "examples": examples,
        "mock_topic_fixed": mock_fixed,
        "mock_issues_before": mock_issues[:50],
        "mock_issues_after_count": len(mock_issues_after),
        "policy": {
            "chapters": "prefer Sheets when present",
            "curriculum": "prefer Sheets when present",
            "concepts": "keep local unless chapter changed; then rebuild from learning focus + vocabulary",
            "patterns": "keep local; light cleanup when chapter changed",
            "multipleSelectionType": "keep local",
            "learningFocus": "used only to rebuild short concepts after chapter changes",
            "typeFields": "fill from Sheets only when local blank and label in vocabulary",
            "mock": "align topic strings to chapter labels",
        },
    }
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report["stats"], ensure_ascii=False, indent=2))
    print("mock_topic_fixed", mock_fixed)
    print("report", args.report)

    if args.dry_run:
        print("dry-run: no files written")
        return

    db["questions"] = new_questions
    db["questionCount"] = len(new_questions)
    write_database(db)
    sync_vocabulary(new_questions)
    version = bump_app_version()
    print("wrote database.json / database.js / vocabulary.json")
    print("APP_VERSION", version)


if __name__ == "__main__":
    main()
