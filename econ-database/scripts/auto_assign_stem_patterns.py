#!/usr/bin/env python3
"""High-confidence auto-assign of stemPatterns for unlabeled questions.

Only assigns when exactly one vocab template clearly wins.
Writes scripts/stem_patterns_auto.json as {id: [pattern]},
then applies into data/database.json and regenerates data/database.js.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
DATABASE_JSON = ROOT / "data" / "database.json"
DATABASE_JS = ROOT / "data" / "database.js"
VOCAB_JSON = SCRIPTS / "stem_patterns_vocab.json"
AUTO_JSON = SCRIPTS / "stem_patterns_auto.json"

FORCE_ID = "DSE-2026-P1-01"


def load_vocab() -> list[str]:
    with VOCAB_JSON.open(encoding="utf-8") as f:
        vocab = json.load(f)
    if not isinstance(vocab, list) or not vocab:
        raise SystemExit("stem_patterns_vocab.json must be a non-empty list")
    return vocab


def text_of(q: dict) -> str:
    return (q.get("questionTextChi") or q.get("plainText") or q.get("stem") or "").strip()


def has_any(t: str, *needles: str) -> bool:
    return any(n in t for n in needles)


def has_all(t: str, *needles: str) -> bool:
    return all(n in t for n in needles)


def match_rules(t: str, vocab: list[str]) -> list[str]:
    """Return matching vocab patterns (duplicates OK; uniqueness checked later)."""
    hits: list[str] = []

    def add(idx: int) -> None:
        hits.append(vocab[idx])

    # --- ultra-distinctive ---
    if "沒有稀少性" in t:
        add(53)

    if has_any(t, "意味着稀少性", "意味著稀少性") or re.search(r"意味[着著]稀少性", t):
        add(9)

    if (
        has_any(t, "稀少性意味着", "稀少性意味著")
        or re.search(r"「?稀少性」?的?存在意味[着著]", t)
    ):
        if "沒有稀少性" not in t and not has_any(t, "意味着稀少性", "意味著稀少性"):
            add(58)

    if "私有產權被削弱" in t:
        add(56)

    # Tax
    if has_any(
        t,
        "需要向香港政府繳交哪些稅",
        "繳交哪些稅項",
        "須向香港政府繳交",
        "需要向香港政府繳交",
    ):
        add(5)
    elif (
        has_any(t, "有多種收入", "收入如下", "賺取月薪")
        and has_any(t, "繳付哪", "須要在香港繳付", "需要在香港繳付", "須在香港繳付")
        and has_any(t, "稅", "直接稅", "間接稅")
    ):
        add(74)
    elif has_any(t, "屬香港的直接稅", "屬香港的間接稅") or (
        "下列哪些屬香港的" in t and has_any(t, "直接稅", "間接稅")
    ):
        add(11)

    # 實證 / 規範 — pick best
    if has_any(t, "實證性", "規範性", "實證陳述", "規範陳述", "實證的陳述", "規範的陳述"):
        if "因為" in t and has_any(
            t, "的陳述屬", "____________ 的陳述", "________ 的陳述", "的陳述是"
        ):
            add(36)
        elif has_any(
            t,
            "一項實證的陳述",
            "一項規範的陳述",
            "實證陳述的性質",
            "規範陳述的性質",
        ) or (
            has_any(t, "永遠是對", "可以被事實推翻")
            and has_any(t, "實證", "規範")
        ):
            add(37)
        elif has_any(
            t,
            "下列哪項(些)是實證",
            "下列哪些是實證",
            "下列哪項是實證",
            "下列哪些是規範",
            "下列哪項是規範",
            "哪些是實證性陳述",
            "哪些是規範性陳述",
            "哪項是實證性陳述",
            "哪項是規範性陳述",
            "下列哪項(些)是規範",
        ):
            add(16)

    # 機會成本: 28 vs 65
    # Require explicit 機會成本 for both 28 and 65
    if "機會成本" in t:
        asks_change = has_any(
            t,
            "會增加",
            "會減低",
            "會減少",
            "會上升",
            "會下降",
            "令他",
            "令她",
            "令其",
            "的機會成本下降",
            "的機會成本上升",
            "的機會成本？",
            "旅行的成本下降",
            "的成本下降？",
            "的成本上升？",
        )
        numericish = bool(
            re.search(r"\$\s*\d", t)
            or re.search(r"\d[\d,\s]*元", t)
            or "實際金額" in t
            or "成本是多少" in t
        )
        if asks_change and has_any(t, "下列哪", "以下哪", "哪項會", "哪項會令"):
            add(28)
        elif numericish and has_any(
            t, "成本是多少", "機會成本是", "繼續使用", "實際金額"
        ):
            # MC dollar amount, not a long multi-part P2 discussion
            if not asks_change and "資料A" not in t and "(a)" not in t:
                add(65)

    # HKMA / linked rate
    if "金融管理局" in t and "功能" in t and has_any(t, "不是", "下列哪項"):
        add(17)
    if "聯繫匯率" in t and has_any(t, "陳述是正確", "下列哪項有關", "有關香港聯繫匯率"):
        add(23)

    if has_any(t, "衍生需求", "引申需求"):
        add(61)

    if has_any(t, "下列哪些可在以物易物", "可在以物易物的經濟中存在"):
        add(10)

    if has_any(t, "共用品的例子", "私用品的例子") or (
        has_any(t, "下列哪項是共用品", "下列哪項是私用品", "哪項是共用品", "哪項是私用品")
    ):
        add(19)

    if "勞工的平均生產力" in t or (
        "平均生產力" in t
        and has_any(t, "下列哪項會提高", "下列哪項會降低", "會提高勞工", "會降低勞工")
    ):
        add(21)

    if "經常帳差額" in t and has_any(t, "包括在", "計算之內", "計算之中"):
        add(18)

    if "國際收支平衡" in t and has_any(t, "包括在", "計算之內", "計算之中"):
        add(12)

    if has_any(t, "Adam Smith", "亞當史密", "亞當·史密", "亞當斯密") and has_any(
        t, "賦稅原則", "課稅原則"
    ):
        add(69)

    if has_any(t, "洛倫茨", "羅倫茲"):
        if "堅尼系數" in t and has_any(t, "人均", "人口"):
            add(29)
        else:
            add(68)

    # M1/M2/M3 personal deposit/withdrawal sequence
    if has_any(t, "系統提款存款", "作出一系統") or (
        has_all(t, "M1", "M2")
        and has_any(t, "貨幣供應", "M3", "定義一", "定義二", "定義三")
        and has_any(t, "影響", "即時")
        and "銀行系統的資產負債表" not in t
        and "可能最大值" not in t
        and has_any(t, "提取", "存入", "提款", "放在家中", "匯至")
    ):
        add(4)

    if (
        has_any(t, "哪些機構可接受", "下列哪些機構可接受", "可以接受該筆存款", "可接受這筆存款")
        and has_any(t, "持牌銀行", "接受存款公司", "有限制牌照")
    ) or (
        "接受存款機構" in t
        and has_any(t, "可接受", "可以接受", "想存款")
        and "貨幣供應" not in t
        and "M1" not in t
        and "M2" not in t
    ):
        add(3)

    # GDP expenditure 44/45
    if has_any(t, "私人消費支出", "政府消費支出") and has_any(t, "本地生產總值", "GDP"):
        if (
            re.search(r"\bX\b", t)
            or "X的值" in t
            or "X 的值" in t
            or "存貨增加 X" in t
            or "存貨減少 X" in t
        ):
            add(44)
        elif "X" not in t and has_any(
            t,
            "計算的本地生產總值是",
            "本地生產總值是",
            "以要素成本計算",
            "以市價計算",
        ):
            add(45)

    if "需求定律並不相符" in t or "與需求定律並不相符" in t:
        add(25)

    if has_any(t, "有關經濟物品的陳述", "關於經濟物品的陳述"):
        add(22)

    # Basic economic problems (1) — avoid mechanism fill-in (2)
    if has_any(t, "基本經濟問題相關", "與哪些基本經濟問題") or (
        has_any(t, "和經濟學中的", "與經濟學中的")
        and has_any(t, "問題有關", "問題相關")
        and has_any(
            t,
            "生產什麼",
            "生產甚麼",
            "為誰生產",
            "怎樣生產",
            "如何生產",
            "___________",
            "_______",
        )
    ):
        if not (has_any(t, "這是以", "是以 __________") and has_any(t, "去解決")):
            if "政府指令" not in t and "市場機制" not in t:
                if not has_any(
                    t,
                    "哪（幾）項",
                    "哪(幾)項",
                    "下列哪些有關上述",
                    "以下哪（幾）項有關上述",
                ):
                    add(1)

    if (
        has_any(t, "這是以", "是以")
        and has_any(t, "去解決", "解決")
        and has_any(t, "政府指令", "市場機制")
        and has_any(t, "生產甚麼", "生產什麼", "怎樣生產", "如何生產", "為誰生產")
    ):
        add(2)

    # AS-AD four diagrams
    if has_any(t, "哪幅圖", "下列哪幅") and has_any(
        t, "物價水平", "產出水平", "AD1", "SRAS", "LRAS", "AS-AD"
    ):
        add(71)
    elif has_all(t, "物價水平", "產出") and has_any(t, "AD1", "SRAS1", "LRAS1"):
        add(71)

    if "新的均衡點" in t or (has_all(t, "均衡點", "E0") and has_any(t, "E1", "E2")):
        if has_any(t, "供需圖", "供求圖", "E1", "E2", "E3", "E4", "均衡點會是", "起初的均衡"):
            add(77)

    if has_any(
        t, "非預期的通脹", "非預期通脹", "非預期的通縮", "非預期通縮", "非預期的通貨膨脹"
    ) and has_any(t, "得益", "受損", "受惠", "會受惠", "會受損"):
        add(57)

    if has_any(t, "經常帳盈餘", "經常帳赤字") and has_any(t, "若一國", "若某國", "一國有"):
        add(60)

    if has_any(
        t,
        "比較市場經濟與計劃經濟",
        "計劃經濟轉變為市場",
        "市場主導經濟",
    ) or (has_all(t, "市場經濟", "計劃經濟") and has_any(t, "比較", "轉變為", "相比")):
        add(52)

    if has_any(
        t, "市場需求曲線", "市場供應曲線", "市場需求／供應曲線", "市場需求/供應曲線"
    ) and has_any(t, "假設不變", "導出"):
        add(55)

    if has_any(
        t,
        "私人與社會的成本",
        "私人與社會的利益",
        "私人與社會的成本／利益",
        "私人與社會的成本/利益",
    ):
        add(35)

    if has_any(t, "過度生產", "生產不足") and has_any(
        t, "陳述是正確", "關於過度", "關於生產不足"
    ):
        add(27)

    if has_any(t, "有關利息的陳述", "關於利息的陳述", "利息的陳述"):
        if has_any(t, "下列哪些有關利息", "下列哪些關於利息", "哪些有關利息", "哪些關於利息"):
            add(13)
        elif has_any(
            t,
            "下列哪項有關利息",
            "下列哪項關於利息",
            "以下哪項關於利息",
            "哪項關於利息",
            "哪項有關利息",
        ):
            add(26)

    if ("合併" in t or "收購" in t) and "並不是" in t and "好處" in t:
        add(32)

    # 甲/乙 ownership-form table (東主/債務/股票) — not labour-productivity tables
    if (
        "甲廠商" in t
        and "乙廠商" in t
        and has_any(t, "東主數目", "債務責任", "向公眾發行股票", "向公眾公開其財務", "獨立法人")
        and "工人數目" not in t
        and "平均勞工生產力" not in t
        and "產量" not in t
    ):
        add(54)

    if has_any(t, "擴張的類型", "擴張類型分別", "所示的擴張類型", "兩種擴張的類型"):
        add(6)
    elif has_any(t, "擴張類型", "的擴張類型") or (
        "擴張" in t
        and has_any(t, "分別是")
        and has_any(t, "前向", "後向", "集團", "側向", "橫向", "縱向")
    ):
        add(6)

    if "價格訊息指導" in t or "由價格訊息指導" in t:
        add(70)

    if has_any(
        t,
        "會令該經濟的失業率上升",
        "會令該經濟的失業率下降",
        "會令失業率上升",
        "會令失業率下降",
        "令失業率上升",
        "令失業率下降",
        "令該經濟的失業率",
        "哪些會令失業率",
        "哪些情況會令該經濟的失業率",
    ):
        add(0)

    if has_any(t, "經濟周期", "經濟週期") and has_any(t, "階段", "邊個階段"):
        add(31)

    if has_any(
        t,
        "貨幣的功能被削弱",
        "貨幣功能被削弱",
        "哪些貨幣功能被削弱",
        "哪項貨幣的功能被削弱",
    ):
        add(49)

    if has_any(t, "貨幣兌換", "兌換率如下") and has_any(
        t, "賺取了", "損失了", "賺蝕", "購入人民幣", "購入美元", "出售該筆"
    ):
        add(66)
    elif has_all(t, "匯率", "第一天", "第二天") and has_any(t, "賺取", "損失", "港幣"):
        add(66)

    if (
        "堅尼系數" in t
        and has_any(t, "人均GDP", "人均本地生產總值", "人均本地")
        and has_any(t, "人口", "兩個經濟", "兩國", "甲國", "乙國")
        and not has_any(t, "洛倫茨", "羅倫茲")
    ):
        add(29)

    if has_any(t, "計算GNI", "本地居民總收入") and has_any(
        t, "加上", "扣除", "需要加上", "需要扣除", "須在"
    ):
        if has_any(t, "下列哪項", "下列哪些", "我們須", "要計算"):
            add(64)

    return hits


def pick_winner(hits: list[str]) -> str | None:
    uniq = sorted(set(hits))
    if len(uniq) == 1:
        return uniq[0]
    return None


def main() -> None:
    vocab = load_vocab()
    vocab_set = set(vocab)

    with DATABASE_JSON.open(encoding="utf-8") as f:
        db = json.load(f)

    questions = db.get("questions", [])
    assignments: dict[str, list[str]] = {}
    skipped_ambiguous = 0
    considered = 0

    for q in questions:
        qid = q.get("id")
        if not qid:
            continue
        existing = q.get("stemPatterns") or []
        if existing:
            continue

        considered += 1
        t = text_of(q)
        hits = match_rules(t, vocab)
        winner = pick_winner(hits)

        if qid == FORCE_ID and "沒有稀少性" in t:
            winner = vocab[53]

        if winner is None:
            if hits:
                skipped_ambiguous += 1
            continue

        if winner not in vocab_set:
            raise SystemExit(f"Invented pattern not in vocab: {winner!r} for {qid}")

        assignments[qid] = [winner]
        q["stemPatterns"] = [winner]

    with AUTO_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(assignments, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with DATABASE_JSON.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.write("\n")

    js_body = json.dumps(db, ensure_ascii=False, indent=2)
    with DATABASE_JS.open("w", encoding="utf-8", newline="\n") as f:
        f.write(f"window.QUESTION_DATABASE = {js_body};\n")

    empty_after = sum(1 for q in questions if not (q.get("stemPatterns") or []))
    filled_after = sum(1 for q in questions if q.get("stemPatterns"))

    print(f"Assigned (high confidence): {len(assignments)}")
    print(f"Still empty stemPatterns: {empty_after}")
    print(f"Nonempty stemPatterns: {filled_after}")
    print(f"Considered unlabeled: {considered}")
    print(f"Skipped ambiguous (multi-hit): {skipped_ambiguous}")
    print(f"Wrote {AUTO_JSON}")

    sample_ids: list[str] = []
    if FORCE_ID in assignments:
        sample_ids.append(FORCE_ID)
    for qid in assignments:
        if qid not in sample_ids:
            sample_ids.append(qid)
        if len(sample_ids) >= 15:
            break

    print("\nSample assignments (up to 15):")
    for qid in sample_ids:
        print(f"  {qid}: {assignments[qid][0]}")

    if FORCE_ID not in assignments:
        q = next((x for x in questions if x.get("id") == FORCE_ID), None)
        if q:
            print(f"\nNOTE: {FORCE_ID} not assigned; stemPatterns={q.get('stemPatterns')!r}")
            print(f"  text starts: {text_of(q)[:80]!r}")


if __name__ == "__main__":
    main()
