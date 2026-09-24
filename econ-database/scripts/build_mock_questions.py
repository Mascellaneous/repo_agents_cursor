#!/usr/bin/env python3
"""Extract HKDSE Economics mock papers and classify each question by topic."""

import json
import os
import re
import zipfile
from xml.etree import ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MOCK_DIR = os.path.join(ROOT, "MockTests")
OUT_PATH = os.path.join(ROOT, "econ-database", "data", "questions.json")

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

PAPER_NUM = {
    "三十五": 35,
    "三十六": 36,
    "三十七": 37,
    "三十八": 38,
    "三十九": 39,
    "四十": 40,
    "四十一": 41,
    "四十二": 42,
    "四十三": 43,
    "四十四": 44,
}

# (chapter, curriculum code, curriculum label, chapter label, keywords)
# Longer / more specific phrases are listed first and score higher.
TOPICS = [
    ("01", "A", "A 基本經濟概念", "基本經濟概念",
     ["機會成本", "稀少性", "稀少", "免費物品", "經濟物品", "共用品", "利息", "私用品", "沉沒", "最不重要的因素", "成本效益分析", "優先次序"]),
    ("02", "A", "A 基本經濟概念", "三個基本經濟問題與私有產權",
     ["生產甚麼", "怎樣生產", "為誰生產", "私有產權", "計劃經濟", "市場經濟", "命令經濟", "實證性", "規範性", "基本經濟問題"]),
    ("03", "B", "B 廠商與生產", "廠商的所有權形式",
     ["私人有限公司", "公眾有限公司", "有限公司", "獨資", "合夥", "股票", "債券", "股東", "有限債務", "無限債務責任", "法人", "上市"]),
    ("04", "B", "B 廠商與生產", "生產與分工",
     ["分工", "初級生產", "二級生產", "三級生產", "專業化", "類別的生產", "熟能生巧", "專責"]),
    ("05", "B", "B 廠商與生產", "生產要素",
     ["職業流動", "地域流動", "地理流動", "勞工生產力", "生產要素", "企業家精神", "企業家", "勞力供應", "衍生需求", "工資差異", "計件", "計時工資", "資本", "土地"]),
    ("06", "B", "B 廠商與生產", "生產及成本",
     ["邊際產量", "平均產量", "總產量", "邊際回報", "規模經濟", "規模不經濟", "固定成本", "可變成本", "平均成本", "邊際成本", "固定生產要素", "可變生產要素", "短期", "長期", "邊際產量"]),
    ("07", "B", "B 廠商與生產", "廠商的目標與擴張",
     ["利潤極大", "縱向後向", "縱向前向", "橫向結合", "後向結合", "前向結合", "橫向擴張", "縱向擴張", "收購"]),
    ("08", "C", "C 市場與價格", "市場價格的訂定",
     ["需求定律", "供應定律", "均衡價格", "均衡數量", "均衡點", "消費者剩餘", "消費者盈餘", "生產者剩餘", "邊際利益", "市場需求曲線", "市場供應曲線", "需求曲線", "供應曲線", "供需圖", "價格的分配", "配給", "價高者得", "平均質素", "價格差異"]),
    ("09", "C", "C 市場與價格", "市場價格的變化",
     ["代替品", "互補品", "正常物品", "劣等物品", "需求上升", "需求下降", "供應上升", "供應下降", "交易量", "樓價", "物業落成"]),
    ("10", "C", "C 市場與價格", "需求和供應的價格彈性",
     ["需求價格彈性", "供應價格彈性", "收入彈性", "交叉彈性", "價格彈性", "需求彈性", "供應彈性", "總支出", "總收入"]),
    ("11", "C", "C 市場與價格", "市場干預",
     ["價格上限", "價格下限", "最低工資", "最高租金", "租金管制", "從價稅", "從量稅", "從量銷售稅", "從量津貼", "銷售稅", "間接稅", "定額稅", "單位稅", "單位補貼", "政府補貼", "津貼得益", "非價格競爭", "離境稅", "黑市", "有效價格"]),
    ("12", "D", "D 競爭與市場結構", "市場結構",
     ["完全競爭", "壟斷性競爭", "寡頭壟斷", "寡頭", "市場結構", "價格接受者", "進入障礙", "自由進出"]),
    ("13", "E", "E 效率、公平和政府的角色", "效率、公平和政府的角色 (I)",
     ["界外影響", "外部效益", "外部成本", "界外效益", "界外成本", "配置效率", "私人與社會", "私人利益", "社會利益", "社會成本", "社會效益", "噪音"]),
    ("14", "E", "E 效率、公平和政府的角色", "效率、公平和政府的角色 (II)",
     ["堅尼係數", "堅尼系數", "基尼係數", "基尼系數", "洛伦茨", "洛伦兹", "收入分配", "收入不均", "累進稅", "累退稅", "財富轉移", "更公平", "應課稅", "稅制", "公平賦稅"]),
    ("15", "F", "F 經濟表現的量度", "經濟表現的量度 (I)",
     ["本地生產總值", "國民生產總值", "GDP", "GNP", "消費物價指數", "以要素成本", "以市價計算", "名義GDP", "實質GDP", "物價指數", "名義本地", "實質本地"]),
    ("16", "F", "F 經濟表現的量度", "經濟表現的量度 (II)",
     ["人均本地生產總值", "人均本地", "失業率", "勞動人口", "就業不足", "生活素質", "隱藏性失業"]),
    ("17", "G", "G 國民收入決定及價格水平", "總需求和總供應",
     ["總需求", "總供應"]),
    ("18", "G", "G 國民收入決定及價格水平", "產出和價格的決定",
     ["通脹差距", "通縮差距", "充分就業產出", "物價水平", "產出水平", "通貨緊縮差距", "通貨膨脹差距"]),
    ("19", "H", "H 貨幣與銀行", "貨幣與銀行",
     ["交易媒介", "記帳單位", "價值儲藏", "延期支付", "商業銀行", "中央銀行", "有限制牌照銀行", "貨幣的功能", "法定貨幣", "活期存款", "定期存款", "貨幣形式", "容易分割"]),
    ("20", "H", "H 貨幣與銀行", "貨幣供應和貨幣需求",
     ["貨幣供應", "貨幣需求", "貨幣基礎", "存款創造", "流動性偏好", "信貸創造", "貨幣乘數", "資產負債表", "超額儲備"]),
    ("21", "I", "I 宏觀經濟問題和政府", "經濟周期、一般物價水平的變動和失業",
     ["經濟周期", "成本推動", "需求拉動", "通脹", "通縮", "失業", "滯脹", "一般物價"]),
    ("22", "I", "I 宏觀經濟問題和政府", "財政政策與貨幣政策",
     ["財政政策", "貨幣政策", "公開市場操作", "貼現率", "法定儲備率", "政府開支", "預算", "量化寬鬆"]),
    ("23", "J", "J 國際貿易和金融", "國際貿易",
     ["比較優勢", "絕對優勢", "貿易得益", "貿易總得益", "貿易比率", "互惠", "國際貿易", "生產可能性"]),
    ("24", "J", "J 國際貿易和金融", "貿易障礙",
     ["關稅", "進口配額", "配額", "貿易障礙", "保護主義", "出口補貼", "進口稅"]),
    ("25", "J", "J 國際貿易和金融", "國際收支平衡表與匯率",
     ["國際收支", "匯率", "升值", "貶值", "聯繫匯率", "貿易差額", "經常帳", "資本帳", "貿易盈餘", "無形貿易"]),
    ("26", "E1", "E1 選修單元一", "壟斷定價",
     ["價格分歧", "第三級價格", "壟斷定價", "邊際收益等於邊際成本"]),
    ("27", "E1", "E1 選修單元一", "反競爭行為與競爭政策",
     ["反競爭", "競爭政策", "掠奪性定價", "合謀", "競爭條例", "市場霸權"]),
    ("28", "E2", "E2 選修單元二", "貿易理論的延伸",
     ["貿易條件", "進口需求", "出口供應", "小國", "大國"]),
    ("29", "E2", "E2 選修單元二", "經濟增長及發展",
     ["經濟增長", "經濟發展", "可持續發展", "人力資本"]),
]


def paper_number(filename):
    for label, num in sorted(PAPER_NUM.items(), key=lambda kv: len(kv[0]), reverse=True):
        if label in filename:
            return num, label
    raise ValueError(filename)


def docx_paragraphs(path):
    with zipfile.ZipFile(path) as zf:
        root = ET.fromstring(zf.read("word/document.xml"))
    paras = []
    for p in root.iter(W + "p"):
        parts = []
        for node in p.iter():
            if node.tag == W + "t" and node.text:
                parts.append(node.text)
            elif node.tag == W + "tab":
                parts.append("\t")
        line = "".join(parts).strip()
        if line and (not paras or paras[-1] != line):
            paras.append(line)
    return paras


def is_option(line):
    return re.match(r"^[A-D][\.\t\s]", line) is not None


def option_letter(line):
    m = re.match(r"^([A-D])[\.\t\s]", line)
    return m.group(1) if m else None


def parse_paper1(paras):
    start = 0
    for i, line in enumerate(paras):
        if "選擇每題中的最佳答案" in line or "考試結束前不可將試卷攜離試場" in line:
            start = i + 1
    body = paras[start:]
    questions = []
    buf = []
    letters = []
    for line in body:
        if line in ("試卷完", "試卷完。") or line.startswith("試卷完"):
            break
        if re.match(r"^雅集出版社", line) or line in ("香港中學文憑考試", "考生須知"):
            continue
        letter = option_letter(line)
        buf.append(line)
        if letter:
            letters.append(letter)
            if letter == "D" and set(letters) >= {"A", "B", "C", "D"}:
                questions.append(buf)
                buf = []
                letters = []
        elif letters and "D" in letters and set(letters) >= {"A", "B", "C", "D"}:
            # safety: D already closed
            pass
    # Drop a duplicated second copy of the paper if present
    if len(questions) > 40 and len(questions) % 2 == 0:
        half = len(questions) // 2
        if questions[:3] and questions[half:half + 1]:
            a = "".join(questions[0])[:40]
            b = "".join(questions[half])[:40]
            if a == b:
                questions = questions[:half]
    return questions


def clean_lines(lines):
    skip_exact = {
        "請在此貼上電腦條碼",
        "考生編號",
        "由閱卷員",
        "填寫",
        "閱卷員編號",
        "試題編號",
        "積分",
        "總分",
        "甲部完",
        "乙部完",
    }
    out = []
    for line in lines:
        if line in skip_exact:
            continue
        if re.fullmatch(r"\d{1,2}", line) and out and out[-1] in ("試題編號", "積分"):
            continue
        if "請在此貼上電腦條碼" in line and len(line) < 40:
            continue
        if line.startswith("考生須以短文形式回答"):
            out.append(line)
            continue
        out.append(line)
    return out


def parse_paper2(paras):
    """Return list of {section, number, lines}."""
    section = "A"
    seen = set()
    skipping = False
    current = None
    questions = []

    def flush():
        nonlocal current
        if current and current["lines"]:
            questions.append(current)
        current = None

    started = False
    for line in paras:
        if "甲部" in line and ("分" in line or line.startswith("甲部")):
            section = "A"
            started = True
        elif "乙部" in line and ("分" in line or line.startswith("乙部")):
            if current and current["section"] == "A":
                flush()
            section = "B"
            started = True
        if not started:
            continue
        if line.startswith("試卷完"):
            break
        m = re.match(r"^(\d{1,2})\.\t", line)
        if m and not line.startswith("("):
            num = int(m.group(1))
            if num > 20:
                continue
            # Long concatenated duplicate of the whole question
            # Text boxes repeat the whole question on one long line before the real paragraphs.
            if len(line) > 180:
                continue
            key = (section, num)
            if key in seen:
                skipping = True
                continue
            flush()
            seen.add(key)
            skipping = False
            current = {"section": section, "number": num, "lines": [line]}
            continue
        if skipping or current is None:
            continue
        if line in ("甲部完", "乙部完"):
            continue
        # A repeated stem without us having closed — still same question until next number
        current["lines"].append(line)
    flush()
    return questions


def mc_answers_from_docx(path):
    """Answer key is one table of letters, e.g. CBCCDB..."""
    with zipfile.ZipFile(path) as zf:
        root = ET.fromstring(zf.read("word/document.xml"))
    body = root.find(W + "body")
    seen = False
    for child in list(body):
        texts = []
        for t in child.iter(W + "t"):
            if t.text:
                texts.append(t.text)
        blob = "".join(texts).strip()
        if blob == "卷一":
            seen = True
            continue
        if not seen:
            continue
        if blob.startswith("答案解釋") or blob == "卷二":
            break
        letters = re.sub(r"[^A-D]", "", blob)
        if len(letters) >= 20 and len(letters) == len(re.sub(r"\s+", "", blob)):
            return list(letters)
        if re.fullmatch(r"[A-D]+", blob) and len(blob) >= 20:
            return list(blob)
    return []


def mc_explanations(paras):
    """Map question number -> explanation text, from 答案解釋 until 卷二."""
    start = None
    end = None
    for i, line in enumerate(paras):
        if line == "答案解釋" and start is None:
            start = i + 1
        elif line == "卷二" and start is not None:
            end = i
            break
    if start is None:
        return {}
    chunk = paras[start:end]
    grouped = {}
    current = None
    buf = []
    for line in chunk:
        m = re.match(r"^(\d{1,2})\.\t", line)
        if m:
            if current is not None:
                grouped[current] = "\n".join(buf).strip()
            current = int(m.group(1))
            buf = [line]
        elif current is not None:
            buf.append(line)
    if current is not None:
        grouped[current] = "\n".join(buf).strip()
    return grouped


def paper2_answers(paras):
    start = None
    for i, line in enumerate(paras):
        if line == "卷二":
            start = i + 1
            break
    if start is None:
        return {}
    grouped = {}
    current = None
    buf = []
    for line in paras[start:]:
        m = re.match(r"^(\d{1,2})\.\t", line)
        if m:
            if current is not None:
                grouped[current] = "\n".join(buf).strip()
            current = int(m.group(1))
            buf = [line]
        elif current is not None:
            buf.append(line)
    if current is not None:
        grouped[current] = "\n".join(buf).strip()
    return grouped


def score_topics(text):
    # Weight the stem above the options so a keyword in choice D does not win.
    option_at = None
    for i, line_start in enumerate(text.split("\n")):
        if re.match(r"^[A-D][\.\t\s]", line_start):
            option_at = text.find(line_start)
            break
    stem = text if option_at is None else text[:option_at]
    scores = []
    for ch, code, curr, name, keywords in TOPICS:
        score = 0
        hits = []
        for kw in keywords:
            if not kw:
                continue
            weight = max(3, len(kw))
            if kw in stem:
                score += weight * 3
                hits.append(kw)
            elif kw in text:
                score += weight
                hits.append(kw)
        if score:
            scores.append((score, ch, code, curr, name, hits))
    scores.sort(key=lambda row: (row[0], len(row[4])), reverse=True)
    return scores


FALLBACK = [
    ("09", "C", "C 市場與價格", "市場價格的變化", ["簽證", "價格上升會令", "折扣", "牌照", "單位價格"]),
    ("11", "C", "C 市場與價格", "市場干預", ["輪候", "供過於求", "定額"]),
    ("05", "B", "B 廠商與生產", "生產要素", ["薪金", "獎金"]),
    ("01", "A", "A 基本經濟概念", "基本經濟概念", ["成本上升", "額外花"]),
    ("08", "C", "C 市場與價格", "市場價格的訂定", ["定額月費", "入場費"]),
    ("03", "B", "B 廠商與生產", "廠商的所有權形式", ["公營", "專營權", "非牟利", "法定機構"]),
    ("23", "J", "J 國際貿易和金融", "國際貿易", ["運輸成本", "進口國"]),
    ("20", "H", "H 貨幣與銀行", "貨幣供應和貨幣需求", ["儲備", "貸款", "存款"]),
]


def classify(text):
    scores = score_topics(text)
    if not scores:
        for ch, code, curr, name, keywords in FALLBACK:
            if any(kw in text for kw in keywords):
                return {
                    "topic": name,
                    "curriculumClassification": [curr],
                    "AristochapterClassification": [f"Ch{ch}"],
                    "concepts": [name],
                }
    if not scores:
        return {
            "topic": "未分類",
            "curriculumClassification": ["未分類"],
            "AristochapterClassification": [],
            "concepts": [],
        }
    top = scores[0]
    chapters = [f"Ch{top[1]}"]
    curricula = [top[3]]
    concepts = [top[4]]
    # Second topic if it is a clearly different chapter and almost as strong
    if len(scores) > 1:
        second = scores[1]
        if second[1] != top[1] and second[0] >= max(4, int(top[0] * 0.65)):
            chapters.append(f"Ch{second[1]}")
            if second[3] not in curricula:
                curricula.append(second[3])
            concepts.append(second[4])
    topic = "；".join(concepts)
    return {
        "topic": topic,
        "curriculumClassification": curricula,
        "AristochapterClassification": chapters,
        "concepts": concepts,
    }


def features(text):
    graph = "圖" if ("下圖" in text or "細閱下圖" in text or "圖中" in text or "以圖" in text) else "-"
    table = "表格" if ("下表" in text or "表顯示" in text or "下表顯示" in text) else "-"
    multi = "複選" if re.search(r"\(1\)", text) and re.search(r"\(2\)", text) else "-"
    calc = "計算" if re.search(r"計算|找出|百分率|彈性是|平均產量|邊際產量", text) else "-"
    return graph, table, multi, calc


def sum_marks(text):
    nums = [int(n) for n in re.findall(r"[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[)）]", text)]
    return sum(nums) if nums else None


def join_plain(lines):
    junk = (
        "考試結束前不可將試卷攜離試場",
        "雅集出版社",
        "香港中學文憑考試",
        "考生須知",
    )
    kept = []
    for line in clean_lines(lines):
        if any(j in line and len(line) < 40 for j in junk):
            continue
        kept.append(line)
    text = "\n".join(kept)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def build():
    files = os.listdir(MOCK_DIR)
    by_num = {}
    for name in files:
        num, label = paper_number(name)
        by_num.setdefault(num, {"label": label})
        if "卷一" in name:
            by_num[num]["p1"] = os.path.join(MOCK_DIR, name)
        elif "卷二" in name:
            by_num[num]["p2"] = os.path.join(MOCK_DIR, name)
        elif "參考答案" in name:
            by_num[num]["ans"] = os.path.join(MOCK_DIR, name)

    questions = []
    report = []
    for num in sorted(by_num):
        info = by_num[num]
        label = info["label"]
        ans_paras = docx_paragraphs(info["ans"])
        p1_answers = mc_answers_from_docx(info["ans"])
        p1_expl = mc_explanations(ans_paras)
        p2_ans = paper2_answers(ans_paras)

        p1 = parse_paper1(docx_paragraphs(info["p1"]))
        report.append(f"P{num} paper1={len(p1)} answers={len(p1_answers)}")
        for i, lines in enumerate(p1, start=1):
            plain = join_plain(lines)
            topic = classify(plain)
            graph, table, multi, calc = features(plain)
            qid = f"M{num}-P1-Q{i:02d}"
            answer = p1_answers[i - 1] if i - 1 < len(p1_answers) else ""
            questions.append({
                "id": qid,
                "publisher": "雅集出版社",
                "examination": "HKDSE",
                "year": str(num),
                "paper": "1",
                "questionType": "MC",
                "marks": 1,
                "section": "-",
                "questionNumber": str(i),
                "questionTextChi": plain,
                "plainText": plain,
                "topic": topic["topic"],
                "question": qid,
                "answerMC": answer,
                "answerChi": p1_expl.get(i, ""),
                "curriculumClassification": topic["curriculumClassification"],
                "AristochapterClassification": topic["AristochapterClassification"],
                "concepts": topic["concepts"],
                "patterns": ["多項選擇題"],
                "graphType": graph,
                "tableType": table,
                "multipleSelectionType": multi,
                "calculationType": calc,
                "source": f"模擬試卷{label} 卷一",
            })

        p2 = parse_paper2(docx_paragraphs(info["p2"]))
        report.append(f"P{num} paper2={len(p2)} numbered={[q['number'] for q in p2]}")
        for item in p2:
            plain = join_plain(item["lines"])
            topic = classify(plain)
            graph, table, multi, calc = features(plain)
            marks = sum_marks(plain)
            n = item["number"]
            qid = f"M{num}-P2-Q{n:02d}"
            questions.append({
                "id": qid,
                "publisher": "雅集出版社",
                "examination": "HKDSE",
                "year": str(num),
                "paper": "2",
                "questionType": "文字題 (SQ/LQ)",
                "marks": marks if marks is not None else 0,
                "section": item["section"],
                "questionNumber": str(n),
                "questionTextChi": plain,
                "plainText": plain,
                "topic": topic["topic"],
                "question": qid,
                "answerMC": "",
                "answerChi": p2_ans.get(n, ""),
                "curriculumClassification": topic["curriculumClassification"],
                "AristochapterClassification": topic["AristochapterClassification"],
                "concepts": topic["concepts"],
                "patterns": ["結構題"],
                "graphType": graph,
                "tableType": table,
                "multipleSelectionType": multi,
                "calculationType": calc,
                "source": f"模擬試卷{label} 卷二",
            })

    payload = {
        "version": "1.0",
        "source": "Aristo HKDSE Economics mock papers 35–44",
        "description": "Each record is one question. topic is the identified syllabus topic; plainText is the question wording.",
        "questionCount": len(questions),
        "questions": questions,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print("\n".join(report))
    print("TOTAL", len(questions))
    # topic distribution
    from collections import Counter
    c = Counter(q["topic"].split("；")[0] for q in questions)
    for name, n in c.most_common():
        print(f"{n:4d}  {name}")


if __name__ == "__main__":
    build()
