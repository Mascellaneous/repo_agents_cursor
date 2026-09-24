#!/usr/bin/env python3
"""Extract HKDSE Economics mock papers and classify each question by topic."""

import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MOCK_DIR = os.path.join(ROOT, "MockTests")
DATA_DIR = os.path.join(ROOT, "econ-database", "data")
OUT_PATH = os.path.join(DATA_DIR, "database.json")
VOCAB_PATH = os.path.join(DATA_DIR, "vocabulary.json")

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


# Specific concepts, separate from the chapter-level topic.
CONCEPT_RULES = [
    ("機會成本", ["機會成本", "最不重要的因素", "成本效益分析", "優先次序"]),
    ("稀少性", ["稀少性", "稀少"]),
    ("免費物品", ["免費物品"]),
    ("經濟物品", ["經濟物品"]),
    ("共用品", ["共用品"]),
    ("利息", ["利息"]),
    ("私有產權", ["私有產權"]),
    ("三個基本經濟問題", ["生產甚麼", "怎樣生產", "為誰生產"]),
    ("計劃經濟與市場經濟", ["計劃經濟", "市場經濟", "命令經濟"]),
    ("實證性與規範性陳述", ["實證性", "規範性"]),
    ("廠商所有權形式", ["獨資", "合夥", "有限公司", "無限債務責任", "有限債務", "公營", "私營"]),
    ("股票與債券", ["股票", "債券"]),
    ("分工", ["分工", "熟能生巧", "專責"]),
    ("生產類別", ["初級生產", "二級生產", "三級生產", "類別的生產"]),
    ("勞工生產力", ["勞工生產力", "平均勞工"]),
    ("資本", ["的資本", "是資本", "屬於資本"]),
    ("土地", ["土地"]),
    ("均衡", ["均衡"]),
    ("短缺與盈餘", ["短缺", "盈餘", "供過於求", "存貨未能售出"]),
    ("供需", ["供需", "供應曲線", "需求曲線", "均衡數量"]),
    ("勞工流動性", ["職業流動", "地域流動", "地理流動"]),
    ("衍生需求", ["衍生需求"]),
    ("工資差異", ["工資差異", "計件", "計時工資", "薪金"]),
    ("邊際回報遞減", ["邊際回報", "邊際產量"]),
    ("規模經濟", ["規模經濟", "規模不經濟"]),
    ("成本", ["固定成本", "可變成本", "平均成本", "邊際成本"]),
    ("固定與可變生產要素", ["固定生產要素", "可變生產要素"]),
    ("利潤極大化", ["利潤極大"]),
    ("結合與擴張", ["縱向", "橫向結合", "後向結合", "前向結合", "收購"]),
    ("需求定律", ["需求定律"]),
    ("供應定律", ["供應定律"]),
    ("消費者盈餘", ["消費者剩餘", "消費者盈餘", "邊際利益"]),
    ("價格的功能", ["分配功能", "配給", "價高者得", "價格的訊息"]),
    ("需求與供應的變化", ["代替品", "互補品", "正常物品", "劣等物品", "需求上升", "供應上升", "需求下降", "供應下降"]),
    ("彈性", ["需求彈性", "供應彈性", "價格彈性", "收入彈性", "交叉彈性", "總支出"]),
    ("價格管制", ["價格上限", "價格下限", "最低工資", "租金管制", "有效價格"]),
    ("稅項與津貼", ["從價稅", "從量稅", "從量銷售稅", "銷售稅", "從量津貼", "單位補貼", "津貼"]),
    ("界外影響", ["界外影響", "外部效益", "外部成本", "界外效益", "界外成本", "私人與社會", "社會成本", "社會利益"]),
    ("收入不均", ["堅尼", "基尼", "洛伦茨", "洛伦兹", "收入分配", "收入不均"]),
    ("本地生產總值", ["本地生產總值", "國民生產總值", "GDP", "GNP"]),
    ("物價指數", ["消費物價指數", "物價指數"]),
    ("失業", ["失業"]),
    ("通脹與通縮", ["通脹", "通縮"]),
    ("貨幣的功能", ["交易媒介", "記帳單位", "價值儲藏", "延期支付", "貨幣形式"]),
    ("銀行體系", ["商業銀行", "中央銀行", "有限制牌照銀行"]),
    ("貨幣供應", ["貨幣供應", "存款創造", "貨幣基礎", "貨幣乘數", "資產負債表", "超額儲備"]),
    ("財政政策與貨幣政策", ["財政政策", "貨幣政策", "貼現率", "公開市場"]),
    ("總需求與總供應", ["總需求", "總供應"]),
    ("比較優勢", ["比較優勢", "絕對優勢", "貿易得益", "貿易總得益", "貿易比率"]),
    ("貿易障礙", ["關稅", "進口配額", "配額", "貿易障礙"]),
    ("匯率", ["匯率", "升值", "貶值", "聯繫匯率"]),
    ("國際收支", ["國際收支", "貿易盈餘", "經常帳", "貿易差額"]),
    ("價格分歧", ["價格分歧"]),
    ("反競爭行為", ["反競爭", "競爭政策", "掠奪性", "合謀"]),
    ("經濟增長", ["經濟增長", "經濟發展"]),
]


def detect_concepts(text):
    found = []
    for label, keywords in CONCEPT_RULES:
        if any(kw in text for kw in keywords):
            found.append(label)
    return found[:6]


def detect_patterns(text):
    """Question patterns. questionType already records MC vs written, so it is not repeated here."""
    patterns = []
    def add(name, ok):
        if ok and name not in patterns:
            patterns.append(name)

    add("資料回應", "資料A" in text or "資料B" in text or "新聞" in text)
    add("短文", "短文" in text)
    add("以圖輔助", "以圖" in text or "毋須用圖" in text or "毋須運用圖" in text)
    add("繪圖", "繪畫" in text or "繪圖" in text or "在圖中" in text)
    add("圖表判讀", any(k in text for k in ("下圖", "細閱下圖", "哪幅圖", "供需圖")))
    add("表格判讀", "下表" in text or "表顯示" in text)
    add("計算", any(k in text for k in ("計算", "是多少", "找出", "百分")))
    add("解釋", "解釋" in text)
    add("舉例", "舉出" in text or "一個例子" in text or "例子" in text)
    add("比較", any(k in text for k in ("相比", "比較", "優點", "缺點", "分別")))
    add("複選組合", bool(re.search(r"\(1\)", text) and re.search(r"\(2\)", text)))
    add("填空", "____" in text or "________" in text)
    add("正誤判斷", "陳述是正確" in text or "哪些是正確" in text or "哪項是正確" in text)
    if not patterns:
        patterns.append("選擇最佳答案" if re.search(r"^[A-D][\.\t]", text, re.M) else "問答")
    return patterns


def classify(text):
    scores = score_topics(text)
    if not scores:
        for ch, code, curr, name, keywords in FALLBACK:
            if any(kw in text for kw in keywords):
                return {
                    "topic": name,
                    "curriculumClassification": [curr],
                    "AristochapterClassification": [f"Ch{ch}"],
                }
    if not scores:
        return {
            "topic": "未分類",
            "curriculumClassification": ["未分類"],
            "AristochapterClassification": [],
        }
    top = scores[0]
    chapters = [f"Ch{top[1]}"]
    curricula = [top[3]]
    names = [top[4]]
    # Second topic if it is a clearly different chapter and almost as strong
    if len(scores) > 1:
        second = scores[1]
        if second[1] != top[1] and second[0] >= max(4, int(top[0] * 0.65)):
            chapters.append(f"Ch{second[1]}")
            if second[3] not in curricula:
                curricula.append(second[3])
            names.append(second[4])
    return {
        "topic": "；".join(names),
        "curriculumClassification": curricula,
        "AristochapterClassification": chapters,
    }


DIAGRAM_TYPES = [
    "供需圖",
    "多幅供需圖",
    "供應曲線",
    "需求曲線",
    "總供需圖",
    "多幅總供需圖",
    "短期總供應曲線",
    "長期總供應曲線",
    "貨幣市場圖",
    "貨幣供應定義圖",
    "洛倫茨曲線",
    "稅制圖",
    "生產流程圖",
    "循環流程圖",
    "生產鏈",
    "結合示意圖",
    "生產可能線",
    "壟斷定價圖",
    "小型開放經濟貿易圖",
    "經濟周期圖",
    "匯率走勢圖",
    "考生繪圖",
]

TABLE_TYPES = [
    "投入產出表",
    "成本產出表",
    "銷量表",
    "總支出表",
    "喜好次序表",
    "需求表",
    "堅尼系數表",
    "資產負債表",
    "就業與人口表",
    "工資表",
    "貿易生產表",
    "生產與消費表",
    "匯率表",
    "本地生產總值表",
    "物價指數表",
    "國民收入帳表",
    "市場佔有率表",
    "貿易數據表",
    "經濟數據表",
    "政策比較表",
    "收費表",
]


def _has_figure(text):
    return any(k in text for k in ("[圖", "下圖", "細閱下圖", "圖一", "圖二", "圖三", "圖四", "以圖", "一幅供需", "參閱下圖", "參考下圖"))


def _has_table(text):
    return any(k in text for k in ("下表", "表顯示", "參閱下表", "參看下表", "下表顯示"))


def classify_table(text):
    if not _has_table(text):
        return None
    rules = [
        ("資產負債表", ("資產負債表", "超額儲備")),
        ("堅尼系數表", ("堅尼",)),
        ("市場佔有率表", ("市場佔有率",)),
        ("工資表", ("平均工資", "平均每月薪金")),
        ("匯率表", ("匯率",)),
        ("物價指數表", ("平減物價", "物價指數", "消費物價指數")),
        ("本地生產總值表", ("本地生產總值",)),
        ("就業與人口表", ("就業分布", "15歲", "失業人口", "勞動人口")),
        ("國民收入帳表", ("間接稅", "直接稅")),
        ("貿易生產表", ("工時", "所需的勞力", "工作時數", "資源數量", "可生產", "所需的工作")),
        ("生產與消費表", ("沒有貿易", "貿易前")),
        ("喜好次序表", ("喜好次序", "第一選項")),
        ("總支出表", ("總支出",)),
        ("銷量表", ("銷量",)),
        ("需求表", ("需求表",)),
        ("政策比較表", ("政策I", "政策II")),
        ("收費表", ("落旗", "跳錶")),
        ("成本產出表", ("平均成本", "邊際成本", "成本與產出", "總生產成本", "受價廠商", "固定成本")),
        ("投入產出表", ("投入與產出", "生產計劃", "平均產出", "平均產量", "總產量", "工人數目")),
        ("經濟數據表", ("物價水平的改變", "人口的改變")),
    ]
    for label, keys in rules:
        if any(k in text for k in keys):
            return label
    return "其他表格"


def classify_diagram(text):
    """Return a diagram type, or 'TABLE:<table type>' when a '下圖' is really a table."""
    if not _has_figure(text):
        return None
    if "[圖" not in text and "圖一" not in text and "圖二" not in text:
        if "下圖" in text or "細閱下圖" in text:
            if "市場佔有率" in text:
                return "TABLE:市場佔有率表"
            if "服務出口" in text or ("出口" in text and "進口" in text and "年份" in text):
                return "TABLE:貿易數據表"
            if "消費物價指數" in text:
                return "TABLE:物價指數表"
            if "失業" in text and "年份" in text:
                return "TABLE:就業與人口表"
            if "本地生產總值" in text and "年份" in text:
                return "TABLE:本地生產總值表"
    if "生產可能線" in text or "PPF" in text:
        return "生產可能線"
    if "洛倫茨" in text or "洛伦兹" in text:
        return "洛倫茨曲線"
    if "循環流程" in text:
        return "循環流程圖"
    if "生產鏈" in text:
        return "生產鏈"
    if "收購" in text and "結合" in text:
        return "結合示意圖"
    if "生產流程" in text or ("初級生產" in text and "二級生產" in text and "三級生產" in text):
        return "生產流程圖"
    if "貨幣供應定義" in text:
        return "貨幣供應定義圖"
    if "應課稅" in text or ("稅款" in text and "累進稅" in text):
        return "稅制圖"
    if "經濟周期" in text or ("平均增長率" in text and ("實質本地" in text or "轉變的百分率" in text or "變動百分率" in text)):
        return "經濟周期圖"
    if "匯率" in text and ("兌" in text or "走勢" in text) and "圖" in text and "下表" not in text.split("匯率")[0]:
        if "需求" in text or "總支出" in text:
            return "匯率走勢圖"
        return "匯率走勢圖"
    if "國際價格" in text or "小型開放" in text or ("進口配額" in text and "本地" in text):
        return "小型開放經濟貿易圖"
    if "貨幣需求" in text or "貨幣供應曲線" in text or ("Ms" in text and "Md" in text):
        return "貨幣市場圖"
    multi = "哪幅圖" in text or "四幅" in text or "下列哪圖" in text or "哪圖" in text
    macro = "總供需" in text or "LRAS" in text or "SRAS" in text or ("物價水平" in text and "總產出" in text)
    if multi and macro:
        return "多幅總供需圖"
    if multi and "供需" in text:
        return "多幅供需圖"
    if "SRAS" in text and "AD" not in text and "總需求" not in text and "LRAS" not in text:
        return "短期總供應曲線"
    if "長期總供應" in text and "總需求" not in text and "AD" not in text and "SRAS" not in text:
        return "長期總供應曲線"
    if any(k in text for k in ("總需求", "總供需", "AD", "SRAS", "LRAS")):
        return "總供需圖"
    if any(k in text for k in ("邊際成本", "邊際收入", "簡單壟斷", "QM", "PM")):
        return "壟斷定價圖"
    if "供應曲線" in text and "需求" not in text:
        return "供應曲線"
    if "需求曲線" in text and "供應" not in text and "供需" not in text:
        return "需求曲線"
    if "供需" in text or ("供應" in text and "需求" in text):
        return "供需圖"
    if "以圖" in text or "一幅" in text:
        return "考生繪圖"
    return "其他圖"


CALCULATION_TYPES = [
    "機會成本計算",
    "產量計算",
    "勞工生產力計算",
    "彈性計算",
    "利潤計算",
    "本地生產總值計算",
    "實質產出計算",
    "物價指數計算",
    "貨幣數量論計算",
    "貨幣供應計算",
    "貿易得益計算",
]

MULTIPLE_SELECTION_TYPES = [
    "兩項陳述組合",
    "三項陳述組合",
    "四項陳述組合",
    "圖選組合",
]


def _asks_for_number(text):
    """True when the student must work out a number, not merely read the word 計算."""
    if any(k in text for k in ("是多少", "列示你的計算", "寫出你的計算", "計算步驟")):
        return True
    if re.search(r"(?:計算|找出)(?:上述|該|甲國|食物|乙國)?[^。\n]{0,16}(?:比率|通脹率|得益|獲益|機會成本|貨幣供應|貨幣基礎|存款|利潤|彈性|總產量)", text):
        return True
    if re.search(r"[\t\n]計算", text) or text.startswith("計算"):
        return True
    if re.search(r"[XxＸ]的(?:值|數值)是", text):
        return True
    if "貢獻分別是" in text or "貢獻是" in text:
        return True
    if "本地生產總值為" in text or "本地生產總值是" in text:
        return True
    if re.search(r"彈性是\s*[_＿]", text) or "弧彈性是" in text:
        return True
    if "機會成本是多少" in text or re.search(r"機會成本是\s*[_＿]", text):
        return True
    if "平均勞工生產力" in text and ("差異" in text or "差別" in text):
        return True
    if ("平均產量" in text or "總產量" in text or "邊際產量" in text) and ("邊際回報" in text or "陳述是正確" in text or "能否說明" in text):
        return True
    if "資產負債表" in text and ("法定儲備" in text or "貨幣供應" in text or "存款" in text) and ("計算" in text or "下列哪項是" in text or "哪些有關" in text):
        return True
    if "貨幣數量論" in text and "百分" in text:
        return True
    if "以市價計算" in text and "以要素成本" in text and ("淨出口" in text or "本地居民總收入" in text):
        return True
    if "內含平減物價指數" in text and "實質產出" in text:
        return True
    if "海外要素收益淨值" in text and "平減物價指數" in text:
        return True
    return False


def classify_calculation(text):
    """Return a calculation type, or None when the question does not ask for a number."""
    if not _asks_for_number(text):
        return None
    if any(k in text for k in ("貿易得益", "貿易獲益", "貿易比率", "比較優勢", "運輸成本", "運輸費用")):
        return "貿易得益計算"
    if "機會成本是多少" in text or re.search(r"機會成本是\s*[_＿]", text):
        return "機會成本計算"
    if "計算" in text and "通脹率" in text:
        return "物價指數計算"
    if "貨幣數量論" in text:
        return "貨幣數量論計算"
    if "實質產出" in text and "平減" in text:
        return "實質產出計算"
    if any(k in text for k in ("本地生產總值", "生產鏈", "以要素成本", "以市價計算", "海外要素收益")):
        return "本地生產總值計算"
    if any(k in text for k in ("法定儲備", "貨幣供應", "貨幣基礎", "存款創造", "超額儲備", "資產負債表")):
        return "貨幣供應計算"
    if "弧彈性" in text or "需求彈性是" in text:
        return "彈性計算"
    if "利潤" in text and "平均成本" in text:
        return "利潤計算"
    if "平均勞工生產力" in text:
        return "勞工生產力計算"
    if any(k in text for k in ("本地生產總值", "生產鏈", "以要素成本", "以市價計算", "海外要素收益")):
        return "本地生產總值計算"
    if "平均產量" in text or "邊際產量" in text or "總產量" in text or "邊際回報" in text:
        return "產量計算"
    return "其他計算"


def classify_multiple(text):
    """Return a combination-question type, or None when it is not one."""
    if not (re.search(r"\(1\)", text) and re.search(r"\(2\)", text)):
        return None
    head = text.split("\nA")[0]
    nums = [int(n) for n in re.findall(r"\((\d+)\)", head)]
    if not nums:
        return None
    if "哪幅圖" in text or "哪圖" in head:
        return "圖選組合"
    n = max(nums)
    if n >= 4:
        return "四項陳述組合"
    if n == 3:
        return "三項陳述組合"
    if n == 2:
        return "兩項陳述組合"
    return "陳述組合"


def features(text):
    diagram = classify_diagram(text)
    table = classify_table(text)
    if diagram and diagram.startswith("TABLE:"):
        graph = "-"
        table = diagram.split(":", 1)[1]
    else:
        graph = diagram or "-"
    if not table:
        table = "-"
    multi = classify_multiple(text) or "-"
    calc = classify_calculation(text) or "-"
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


def _clean_labels(values):
    cleaned = []
    for value in values or []:
        text = str(value).strip()
        if text and text not in ("-", "圖", "表格", "其他圖", "其他表格") and text not in cleaned:
            cleaned.append(text)
    return cleaned


def labels_from_questions(questions):
    concepts, patterns, diagrams, tables, calculations, multiples = [], [], [], [], [], []
    for question in questions:
        concepts.extend(question.get("concepts") or [])
        patterns.extend(question.get("patterns") or [])
        diagrams.append(question.get("graphType") or "")
        tables.append(question.get("tableType") or "")
        calculations.append(question.get("calculationType") or "")
        multiples.append(question.get("multipleSelectionType") or "")
    return (
        _clean_labels(concepts),
        _clean_labels(patterns),
        _clean_labels(diagrams),
        _clean_labels(tables),
        _clean_labels(calculations),
        _clean_labels(multiples),
    )


def merge_labels(preferred, existing, found, banned=()):
    """Keep a stable order, then append any label that appears in the bank."""
    merged = []
    blocked = {"-", "圖", "表格", "其他圖", "其他表格", *banned}
    for label in list(preferred or []) + list(existing or []) + list(found or []):
        text = str(label).strip()
        if text in blocked or text in merged:
            continue
        if text:
            merged.append(text)
    return merged


def write_vocabulary(questions):
    """Rewrite vocabulary.json from the question bank so new labels are not left out."""
    existing = {}
    if os.path.exists(VOCAB_PATH):
        try:
            existing = json.load(open(VOCAB_PATH, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}
    concepts, patterns, diagrams, tables, calculations, multiples = labels_from_questions(questions)
    payload = {
        "concepts": merge_labels([], existing.get("concepts"), concepts),
        "patterns": merge_labels([], existing.get("patterns"), patterns),
        "diagramTypes": merge_labels(DIAGRAM_TYPES, existing.get("diagramTypes"), diagrams),
        "tableTypes": merge_labels(TABLE_TYPES, existing.get("tableTypes"), tables),
        "calculationTypes": merge_labels(CALCULATION_TYPES, existing.get("calculationTypes"), calculations, banned=("計算", "複選", "其他計算")),
        "multipleSelectionTypes": merge_labels(MULTIPLE_SELECTION_TYPES, existing.get("multipleSelectionTypes"), multiples, banned=("計算", "複選", "其他計算")),
        "note": "Written by build_mock_questions.py from database.json. Do not edit by hand; run the script so new concepts, patterns, diagram types, table types, calculation types, and multiple-selection types are added.",
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(VOCAB_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return payload


def load_previous_questions():
    """Reviewed rows live in database.json. Fall back to the older questions.json name."""
    for path in (OUT_PATH, os.path.join(DATA_DIR, "questions.json")):
        if not os.path.exists(path):
            continue
        try:
            previous = json.load(open(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        questions = previous.get("questions", [])
        if questions:
            return questions
    return []


def sync_vocabulary_from_disk():
    questions = load_previous_questions()
    if not questions:
        raise SystemExit(f"No questions found in {OUT_PATH}")
    payload = write_vocabulary(questions)
    print(
        "vocabulary",
        len(payload["concepts"]),
        "concepts",
        len(payload["patterns"]),
        "patterns",
        len(payload["diagramTypes"]),
        "diagrams",
        len(payload["tableTypes"]),
        "tables",
        len(payload["calculationTypes"]),
        "calculations",
        len(payload["multipleSelectionTypes"]),
        "multiple-selection",
    )


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
                "concepts": detect_concepts(plain),
                "patterns": detect_patterns(plain),
                "graphType": graph,
                "tableType": table,
                "multipleSelectionType": multi,
                "calculationType": calc,
                "source": f"模擬試卷{label} 卷一",
                "reviewedByAI": "N",
                "lastReviewDate": "",
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
                "concepts": detect_concepts(plain),
                "patterns": detect_patterns(plain),
                "graphType": graph,
                "tableType": table,
                "multipleSelectionType": multi,
                "calculationType": calc,
                "source": f"模擬試卷{label} 卷二",
                "reviewedByAI": "N",
                "lastReviewDate": "",
            })

    reviewed = {}
    for old in load_previous_questions():
        if str(old.get("reviewedByAI", "")).upper() == "Y" and old.get("id"):
            reviewed[old["id"]] = old

    merged = []
    seen = set()
    for question in questions:
        kept = reviewed.get(question["id"])
        if kept:
            merged.append(kept)
        else:
            merged.append(question)
        seen.add(question["id"])
    # Keep reviewed questions even if this parse no longer emits their id.
    for qid, old in reviewed.items():
        if qid not in seen:
            merged.append(old)

    payload = {
        "version": "1.0",
        "source": "Aristo HKDSE Economics mock papers 35–44",
        "description": "Each record is one question. topic is the chapter; concepts are specific ideas such as 機會成本; patterns are question styles and do not repeat questionType; plainText is the wording. reviewedByAI is Y or N. lastReviewDate is YYYY-MM-DD when reviewed. The builder does not overwrite records with reviewedByAI Y.",
        "questionCount": len(merged),
        "questions": merged,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    vocab = write_vocabulary(merged)
    print(
        "vocabulary",
        len(vocab["concepts"]),
        "concepts",
        len(vocab["patterns"]),
        "patterns",
    )
    print("\n".join(report))
    print("TOTAL", len(merged), "preserved", len(reviewed))
    # topic distribution
    from collections import Counter
    c = Counter(q["topic"].split("；")[0] for q in questions)
    for name, n in c.most_common():
        print(f"{n:4d}  {name}")


if __name__ == "__main__":
    if "--sync-vocabulary" in sys.argv:
        sync_vocabulary_from_disk()
    else:
        build()
