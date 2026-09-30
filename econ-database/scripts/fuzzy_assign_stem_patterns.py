#!/usr/bin/env python3
"""Fuzzy-assign stemPatterns to unlabeled questions via stem similarity.

Uses ONLY existing vocab / labeled patterns. Writes
scripts/stem_patterns_fuzzy.json as {id: [pattern]}, then applies into
data/database.json and regenerates data/database.js.

Method: Jaccard on character bigrams of normalized stems (options stripped,
first 120 chars), plus weighted compare to the pattern string itself.
Assign when best >= MIN_BEST and (best - second) >= MIN_MARGIN, with a light
topic-keyword gate to cut shared-MCQ-framing false positives.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
DATABASE_JSON = ROOT / "data" / "database.json"
DATABASE_JS = ROOT / "data" / "database.js"
VOCAB_JSON = SCRIPTS / "stem_patterns_vocab.json"
FUZZY_JSON = SCRIPTS / "stem_patterns_fuzzy.json"

# Tunable (raise MIN_BEST / MIN_MARGIN if too many FPs; lower if too few)
MIN_BEST = 0.35
MIN_MARGIN = 0.05
STEM_CHARS = 120
PATTERN_WEIGHT = 0.70
NGRAM_N = 2
MAX_REFS_PER_PATTERN = 60
WEAK_PATTERNS = {"未命名題型1", "未命名題型2"}
WEAK_MIN_BEST = 0.55
# Asks that collapse to this after boilerplate strip are too generic to assign on
GENERIC_ASK_RE = re.compile(
    r"^(哪些|哪項|哪種)?(陳述|描述)?(是)?(正確|不正確)?的?$"
)

_OPTION_LINE = re.compile(
    r"(?:^|\n)\s*(?:[A-D][\.．、\t ]|[（(][1-4][）)]|[1-4][\.．、\t ])"
)
_YEAR_RE = re.compile(r"(?:19|20)\d{2}年?")
_DIGIT_RE = re.compile(r"\d+")
_NAME_HINT = re.compile(
    r"(?:先生|女士|小姐|同學|老師|"
    r"[李王張劉陳楊黃趙吳周徐孫馬朱胡郭何高林羅鄭梁謝宋唐許韓馮鄧曹彭曾蕭田董袁潘于蔣蔡余杜葉程魏蘇呂丁任沈姚盧姜崔鍾譚陸汪范金石廖賈夏韋付方白鄒孟熊秦邱江尹薛闞段雷侯龍史陶黎賀顧毛郝龔邵萬錢嚴覃武戴莫孔向湯][\u4e00-\u9fff]{1,2})"
)

# Shared framing only — keep 哪項/哪些/哪種 (pattern-discriminative)
_BOILERPLATE = re.compile(
    r"(?:以下|下列)"
    r"|有關|關於"
    r"|的?(?:陳述|描述)是?(?:正確|不正確)的?"
    r"|參閱以下|細閱下(?:表|圖)|下表顯示|下圖顯示"
    r"|根據上述(?:資料|數據)"
)


def text_of(q: dict) -> str:
    return (q.get("questionTextChi") or q.get("plainText") or q.get("stem") or "").strip()


def stem_only(text: str, max_chars: int = STEM_CHARS) -> str:
    if not text:
        return ""
    m = _OPTION_LINE.search(text)
    if m:
        text = text[: m.start()]
    text = text.strip()
    text = re.sub(r"\[圖[^\]]*\]", "", text)
    text = re.sub(r"\[表[^\]]*\]", "", text)
    return text[:max_chars]


def ask_focus(stem: str) -> str:
    s = stem.strip()
    parts = re.split(r"[。！？\n]+", s)
    parts = [p.strip() for p in parts if p.strip()]
    if not parts:
        return s
    for p in reversed(parts):
        if any(
            k in p
            for k in (
                "哪",
                "下列",
                "以下",
                "意味",
                "屬",
                "包括",
                "計算",
                "影響",
                "結論",
                "削弱",
                "機會成本",
            )
        ):
            return p
    return parts[-1] if len(parts[-1]) >= 10 else s


def normalize(stem: str, strip_boilerplate: bool = True) -> str:
    s = stem.replace("\t", " ").replace("\r", " ")
    s = re.sub(r"\s+", "", s)
    s = _YEAR_RE.sub("年", s)
    s = _DIGIT_RE.sub("#", s)
    s = _NAME_HINT.sub("某", s)
    for a, b in (
        ("／", "/"),
        ("，", ","),
        ("。", "."),
        ("？", "?"),
        ("：", ":"),
        ("（", "("),
        ("）", ")"),
        ("「", '"'),
        ("」", '"'),
        ("『", '"'),
        ("』", '"'),
        ("、", ","),
        ("…", "."),
        ("⋯", "."),
        ("＿", "_"),
        ("−", "-"),
        ("–", "-"),
        ("—", "-"),
        ("並不", "不"),
    ):
        s = s.replace(a, b)
    if strip_boilerplate:
        s = _BOILERPLATE.sub("", s)
    return s.lower()


def ngrams(s: str, n: int = NGRAM_N) -> set[str]:
    if len(s) < n:
        return {s} if s else set()
    return {s[i : i + n] for i in range(len(s) - n + 1)}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / (len(a) + len(b) - inter)


def stem_features(raw_stem: str) -> tuple[set[str], set[str], str]:
    """Return (full_ngrams, ask_ngrams, stem_text_for_keywords)."""
    full_n = normalize(raw_stem)
    ask_n = normalize(ask_focus(raw_stem))
    kw_text = normalize(raw_stem, strip_boilerplate=False)
    return ngrams(full_n), ngrams(ask_n), kw_text


def sim(q_full: set[str], q_ask: set[str], r_full: set[str], r_ask: set[str]) -> float:
    """Best of full↔full, ask↔ask, ask↔full (ask-focused matching)."""
    return max(
        jaccard(q_full, r_full),
        jaccard(q_ask, r_ask),
        jaccard(q_ask, r_full),
        jaccard(q_full, r_ask),
    )


_SKIP_TOKENS = {
    "下列",
    "以下",
    "有關",
    "關於",
    "陳述",
    "正確",
    "不正確",
    "情況",
    "事件",
    "某人",
    "某企業",
    "某市場",
    "某國家",
    "某政策",
    "某物品",
    "根據",
    "上述",
    "資料",
    "結論",
    "例子",
    "分別",
    "甚麼",
    "什麼",
    "一個",
    "不會",
    "出現",
    "改變",
    "未命名",
    "題型",
    "可能",
    "不可能",
    "負數",
    "答案",
    "選項",
    "提供",
    "數值",
    "轉變",
    "百分比",
    "推斷",
    "類型",
    "概念",
    "解釋",
    "最後",
    "個案",
    "作出",
    "兩項",
    "兩種",
    "行為",
    "需要",
    "可得出",
    "人士",
    "得益",
    "受損",
}


def distinctive_tokens(ptn: str) -> list[str]:
    tokens = re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9\-]{1,}", ptn)
    out: list[str] = []
    for t in tokens:
        if t in _SKIP_TOKENS:
            continue
        if t in ("XX", "XXX"):
            continue
        out.append(t)
    for special in (
        "稀少性",
        "機會成本",
        "實證",
        "規範",
        "聯繫匯率",
        "金融管理局",
        "以物易物",
        "共用品",
        "私用品",
        "平均生產力",
        "經常帳",
        "國際收支",
        "洛倫茨",
        "羅倫茲",
        "堅尼",
        "衍生需求",
        "引申需求",
        "需求定律",
        "經濟物品",
        "私有產權",
        "市場經濟",
        "計劃經濟",
        "從量稅",
        "賦稅原則",
        "價格訊息",
        "失業",
        "通脹",
        "通縮",
        "貨幣供應",
        "本地生產總值",
        "利息",
        "合併",
        "擴張",
        "接受存款",
        "直接稅",
        "間接稅",
        "為誰生產",
        "怎樣生產",
        "生產甚麼",
        "生產什麼",
        "政府指令",
        "市場機制",
        "均衡點",
        "SRAS",
        "LRAS",
        "AS-AD",
        "GDP",
        "GNI",
        "M1",
        "M2",
        "M3",
        "生產鏈",
        "貢獻",
        "勞工",
        "產量",
        "配額",
        "津貼",
        "消費券",
    ):
        if special.lower() in ptn.lower() and special not in out:
            out.append(special)
    # Drop ultra-common question words even if extracted from pattern text
    out = [t for t in out if t not in ("哪項", "哪些", "哪種", "哪幅", "下列", "以下")]
    return out


def keyword_hits(stem_kw: str, ptn: str) -> tuple[int, int]:
    toks = distinctive_tokens(ptn)
    if not toks:
        return 0, 0
    hits = sum(1 for t in toks if t.lower() in stem_kw)
    return hits, len(toks)


def revert_previous_fuzzy(questions: list[dict], fuzzy_path: Path) -> int:
    if not fuzzy_path.exists():
        return 0
    try:
        prev = json.loads(fuzzy_path.read_text(encoding="utf-8"))
    except Exception:
        return 0
    if not isinstance(prev, dict):
        return 0
    cleared = 0
    by_id = {q.get("id"): q for q in questions}
    for qid, ptns in prev.items():
        q = by_id.get(qid)
        if not q:
            continue
        cur = q.get("stemPatterns") or []
        if cur == ptns:
            q["stemPatterns"] = []
            cleared += 1
    return cleared


def main() -> None:
    with VOCAB_JSON.open(encoding="utf-8") as f:
        vocab: list[str] = json.load(f)
    vocab_set = set(vocab)

    with DATABASE_JSON.open(encoding="utf-8") as f:
        db = json.load(f)

    questions: list[dict] = db.get("questions", [])
    cleared = revert_previous_fuzzy(questions, FUZZY_JSON)
    if cleared:
        print(f"Reverted previous fuzzy assignments: {cleared}")

    # pattern -> list of (full_ng, ask_ng)
    refs: dict[str, list[tuple[set[str], set[str]]]] = defaultdict(list)
    pattern_feat: dict[str, tuple[set[str], set[str]]] = {}

    for ptn in vocab:
        pattern_feat[ptn] = stem_features(ptn)[:2]  # type: ignore[assignment]
        pf, pa, _ = stem_features(ptn)
        pattern_feat[ptn] = (pf, pa)

    labeled = 0
    for q in questions:
        patterns = q.get("stemPatterns") or []
        if not patterns:
            continue
        labeled += 1
        raw = stem_only(text_of(q))
        if not raw:
            continue
        full_ng, ask_ng, _ = stem_features(raw)
        for ptn in patterns:
            if len(refs[ptn]) < MAX_REFS_PER_PATTERN:
                refs[ptn].append((full_ng, ask_ng))

    assignments: dict[str, list[str]] = {}
    score_hist: Counter[str] = Counter()
    samples: list[tuple] = []
    near_misses: list[tuple] = []
    candidates_scored = 0

    empty_before = sum(1 for q in questions if not (q.get("stemPatterns") or []))

    for q in questions:
        if q.get("stemPatterns"):
            continue
        qid = q.get("id")
        if not qid:
            continue

        raw_stem = stem_only(text_of(q))
        q_full, q_ask, q_kw = stem_features(raw_stem)
        if len(q_ask) < 4 and len(q_full) < 6:
            continue
        candidates_scored += 1

        best_ptn = ""
        best = -1.0
        second = -1.0
        best_hits = 0
        best_tokn = 0

        scored: list[tuple[float, str]] = []
        for ptn in vocab:
            ref_score = 0.0
            for r_full, r_ask in refs.get(ptn, []):
                ref_score = max(ref_score, sim(q_full, q_ask, r_full, r_ask))

            pf, pa = pattern_feat[ptn]
            self_score = sim(q_full, q_ask, pf, pa) * PATTERN_WEIGHT
            sc = max(ref_score, self_score)
            scored.append((sc, ptn))

        scored.sort(key=lambda x: x[0], reverse=True)

        def passes_sense(ptn: str) -> bool:
            if "不相符" in ptn and "不相符" not in raw_stem and "並不相符" not in raw_stem:
                if "相符" in raw_stem:
                    return False
            if ("過度生產" in ptn or "生產不足" in ptn) and (
                "過度生產" not in raw_stem and "生產不足" not in raw_stem
            ):
                return False
            if "甲乙廠商" in ptn or "商業擁有權" in ptn:
                if not any(
                    k in raw_stem
                    for k in (
                        "甲廠商",
                        "乙廠商",
                        "擁有權",
                        "獨資",
                        "合夥",
                        "有限公司",
                        "東主數目",
                    )
                ):
                    return False
            if "支出面" in ptn and any(
                k in raw_stem
                for k in ("生產鏈", "增值", "中間消費", "對甲國以要素成本", "對甲國以市價")
            ):
                return False
            if "Adam Smith" in ptn or "賦稅原則" in ptn:
                if not any(k in raw_stem for k in ("Adam", "史密", "賦稅原則", "課稅原則")):
                    return False
            if "例子" in ptn and "例子" not in raw_stem and "陳述" in raw_stem:
                return False
            if "供需圖" in ptn and "均衡點" in ptn:
                if any(
                    k in raw_stem for k in ("貨幣需求", "貨幣供應", "名義利率", "貨幣數量")
                ):
                    if "物品" not in raw_stem and "供需圖" not in raw_stem:
                        return False
            if "M1" in ptn and "M2" in ptn:
                if not any(k in raw_stem for k in ("M1", "M2", "M3", "貨幣供應")):
                    return False
            # Interest-statement patterns need 利息 in stem
            if "利息" in ptn and "利息" not in raw_stem:
                return False
            # Lorenz / Gini
            if ("洛倫茨" in ptn or "羅倫茲" in ptn) and not any(
                k in raw_stem for k in ("洛倫茨", "羅倫茲", "堅尼")
            ):
                return False
            if "機會成本" in ptn or ("成本" in ptn and "增加" in ptn and "減低" in ptn):
                if "機會成本" not in raw_stem and not (
                    "成本" in raw_stem
                    and any(k in raw_stem for k in ("增加", "減低", "減少", "下降", "上升", "提高"))
                ):
                    return False
            if "聯繫匯率" in ptn and "聯繫匯率" not in raw_stem:
                return False
            return True

        # Pick best and second among sense-passing + keyword-passing patterns
        for sc, ptn in scored:
            if not passes_sense(ptn):
                continue
            hits, tokn = keyword_hits(q_kw, ptn)
            if tokn > 0 and hits < 1:
                continue
            if best < 0:
                best = sc
                best_ptn = ptn
                best_hits, best_tokn = hits, tokn
            elif second < 0:
                second = sc
                break
        if second < 0:
            second = 0.0

        margin = best - second if best >= 0 else 0.0
        if best < 0:
            best = 0.0
            best_ptn = ""
        bucket = f"{max(0.0, int(best * 10) / 10):.1f}"
        score_hist[bucket] += 1

        if not best_ptn:
            continue

        min_best = WEAK_MIN_BEST if best_ptn in WEAK_PATTERNS else MIN_BEST
        kw_ok = True  # already filtered in ranking

        ask_norm = normalize(ask_focus(raw_stem))
        ask_too_generic = (
            len(ask_norm) < 8
            or bool(GENERIC_ASK_RE.match(ask_norm))
            or ask_norm
            in {"哪些陳述是正確的", "哪項陳述是正確的", "哪些陳述是不正確的"}
        )
        if ask_too_generic and best < max(min_best, 0.48):
            continue

        if best >= min_best and margin >= MIN_MARGIN and best_ptn in vocab_set:
            assignments[qid] = [best_ptn]
            q["stemPatterns"] = [best_ptn]
            if len(samples) < 20:
                samples.append(
                    (qid, best_ptn, best, second, best_hits, best_tokn, raw_stem[:90])
                )
        elif best >= MIN_BEST - 0.03 and margin < MIN_MARGIN:
            if len(near_misses) < 12:
                near_misses.append((qid, best_ptn, best, second, raw_stem[:80]))

    with FUZZY_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(assignments, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with DATABASE_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.write("\n")

    js_body = json.dumps(db, ensure_ascii=False, indent=2)
    with DATABASE_JS.open("w", encoding="utf-8", newline="\n") as f:
        f.write(f"window.QUESTION_DATABASE = {js_body};\n")

    empty_after = sum(1 for q in questions if not (q.get("stemPatterns") or []))

    print(f"Labeled reference questions: {labeled}")
    print(f"Empty before: {empty_before}")
    print(f"Scored unlabeled: {candidates_scored}")
    print(f"Assigned (fuzzy): {len(assignments)}")
    print(f"Still empty stemPatterns: {empty_after}")
    print(
        f"Thresholds: best>={MIN_BEST} (weak>={WEAK_MIN_BEST}), "
        f"margin>={MIN_MARGIN}, ngram={NGRAM_N}, pattern_weight={PATTERN_WEIGHT}"
    )
    print(f"Wrote {FUZZY_JSON}")

    print("\nScore histogram (best score buckets for unlabeled scored):")
    for bucket in sorted(score_hist.keys(), key=float):
        print(f"  [{bucket}, {float(bucket) + 0.1:.1f}): {score_hist[bucket]}")

    print("\n20 sample assignments (id | best | 2nd | kw_hits | pattern | stem):")
    for qid, ptn, best, second, hits, tokn, stem in samples:
        print(
            f"  {qid}  best={best:.3f}  2nd={second:.3f}  "
            f"margin={best - second:.3f}  kw={hits}/{tokn}"
        )
        print(f"    -> {ptn}")
        print(f"    stem: {stem}")

    print("\nFalse-positive spot-check suggestions (kw hits == 0 or weak topic):")
    fp_suggestions = 0
    for qid, ptn_list in assignments.items():
        ptn = ptn_list[0]
        q = next(x for x in questions if x.get("id") == qid)
        stem_raw = stem_only(text_of(q))
        _, _, kw_text = stem_features(stem_raw)
        hits, tokn = keyword_hits(kw_text, ptn)
        # Flag if few hits relative to tokens, or known polarity risk
        risky = hits == 0 or (tokn >= 3 and hits / tokn < 0.25)
        # 相符 vs 不相符 polarity
        if "不相符" in ptn and "不相符" not in stem_raw and "相符" in stem_raw:
            risky = True
        if "例子" in ptn and "例子" not in stem_raw and "陳述" in stem_raw:
            risky = True
        if risky:
            print(f"  {qid} kw={hits}/{tokn} -> {ptn}")
            print(f"    stem: {stem_raw[:75]}")
            fp_suggestions += 1
            if fp_suggestions >= 12:
                break
    if fp_suggestions == 0:
        print("  (none flagged; still spot-check samples above)")

    print("\nAssigned pattern frequency:")
    freq = Counter(v[0] for v in assignments.values())
    for ptn, n in freq.most_common(15):
        print(f"  {n:3d}  {ptn}")

    if near_misses:
        print("\nNear-misses (score OK-ish but margin/kw failed):")
        for qid, ptn, best, second, stem in near_misses[:8]:
            print(f"  {qid} best={best:.3f} 2nd={second:.3f} -> {ptn[:48]}...")


if __name__ == "__main__":
    main()
