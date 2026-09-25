#!/usr/bin/env python3
"""Crop mock-test figures from the official PDFs and attach the English wording.

Question text stays the wording already taken from the Word files. Images are
rendered from the PDF and cut to one question, then to a figure when the page
shows one. English text is attached only when the question number and the
multiple-choice key agree with the Chinese record.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
MOCK = ROOT / "MockTests"
DATA = ROOT / "econ-database" / "data"
ORIG = ROOT / "econ-database" / "originals"
DIAG = ROOT / "econ-database" / "diagrams"
DB_PATH = DATA / "database.json"

PAPER_LABEL = {
    27: "二十七", 28: "二十八", 29: "二十九", 30: "三十",
    31: "三十一", 32: "三十二", 33: "三十三", 34: "三十四",
    35: "三十五", 36: "三十六", 37: "三十七", 38: "三十八",
    39: "三十九", 40: "四十", 41: "四十一", 42: "四十二",
    43: "四十三", 44: "四十四",
}
DPI = 120
NOISE = (
    "Answers written in the margins will not be marked",
    "Please stick the barcode label here",
    "Not to be taken away before",
    "END OF PAPER",
    "HKDSE-ECON",
    "Go on to the next page",
)


def chi_pdf(num, kind):
    path = MOCK / f"模擬試卷{PAPER_LABEL[num]} {kind}.pdf"
    return path if path.is_file() else None


def eng_pdf(num, kind):
    path = MOCK / f"Mock Test {num} {kind}.pdf"
    return path if path.is_file() else None


def layout_text(pdf):
    return subprocess.check_output(
        ["pdftotext", "-layout", str(pdf), "-"], text=True, errors="replace"
    )


def clean_lines(text):
    kept = []
    for line in text.splitlines():
        if any(n in line for n in NOISE):
            continue
        if re.search(r"©\s*20\d\d", line):
            continue
        kept.append(line.rstrip())
    return "\n".join(kept)


def split_numbered(text):
    body = clean_lines(text)
    parts = re.split(r"\n\s*(\d{1,2})\.\s+", "\n" + body)
    found = {}
    for i in range(1, len(parts) - 1, 2):
        num = int(parts[i])
        chunk = re.sub(r"\n{3,}", "\n\n", parts[i + 1]).strip()
        chunk = re.sub(r"[ \t]+\n", "\n", chunk)
        if chunk:
            found[num] = chunk
    return found


def english_questions(pdf):
    text = layout_text(pdf)
    marker = re.search(r"Choose the BEST answer|Section A|There are \d+ questions", text)
    body = text[marker.start():] if marker else text
    return split_numbered(body)


def english_answers(pdf):
    text = layout_text(pdf)
    paper2_at = text.find("\nPaper 2")
    paper1 = text[:paper2_at] if paper2_at > 0 else text
    paper2 = text[paper2_at:] if paper2_at > 0 else ""
    exp = re.search(r"\n\s*1\.\s+Answer:", paper1)
    paper1_exp = split_numbered(paper1[exp.start():]) if exp else {}
    return paper1_exp, split_numbered(paper2)


def mc_letter(text):
    match = re.search(r"Answer:\s*([A-D])\b", text or "")
    return match.group(1) if match else None


def has_options(text):
    return all(re.search(rf"(?m)^[ \t]*{letter}[\.\)\s]", text or "") for letter in "ABCD")


def question_starts(pdf):
    html = subprocess.check_output(
        ["pdftotext", "-bbox-layout", str(pdf), "-"], text=True, errors="replace"
    )
    starts = []
    for page_no, page in enumerate(re.findall(r"<page\b[^>]*>.*?</page>", html, re.S), 1):
        size = re.search(r'width="([\d.]+)" height="([\d.]+)"', page)
        if not size:
            continue
        width, height = float(size.group(1)), float(size.group(2))
        tokens = []
        for word in re.finditer(
            r'<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]+)</word>', page
        ):
            x, y, label = float(word.group(1)), float(word.group(2)), word.group(3).strip()
            if x < 180 and 40 < y < height - 50 and re.match(r"\d", label):
                tokens.append((x, y, label))
        tokens.sort(key=lambda item: (item[1], item[0]))
        marks = []
        i = 0
        while i < len(tokens):
            x, y, label = tokens[i]
            if x > 70:
                i += 1
                continue
            if (
                i + 1 < len(tokens)
                and abs(tokens[i + 1][1] - y) < 1.2
                and 0 < tokens[i + 1][0] - x < 14
                and re.fullmatch(r"\d{1,2}\.?", label + tokens[i + 1][2])
            ):
                label += tokens[i + 1][2]
                i += 1
            followed = any(
                abs(tok[1] - y) < 1.2 and x + 8 < tok[0] < x + 18 and re.match(r"\d", tok[2])
                for tok in tokens[i + 1:]
            )
            if re.fullmatch(r"\d{1,2}\.?", label) and not followed:
                marks.append((int(label.rstrip(".")), y))
            i += 1
        if len(marks) >= 12:
            continue
        for num, y in marks:
            starts.append({"page": page_no, "num": num, "y": y, "width": width, "height": height})
    # Drop a repeated number; keep the later explanation if the first was a contents line.
    kept = []
    seen = set()
    for mark in starts:
        if kept and mark["num"] == 1 and kept[-1]["num"] > 1:
            seen.clear()
        if mark["num"] in seen:
            continue
        if kept and mark["num"] < kept[-1]["num"] and mark["num"] != 1:
            continue
        seen.add(mark["num"])
        kept.append(mark)
    return kept


def render_pages(pdf, dest_dir):
    dest_dir.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(
        ["pdftoppm", "-jpeg", "-r", str(DPI), "-jpegopt", "quality=80", str(pdf), str(dest_dir / "p")],
        stdout=subprocess.DEVNULL,
    )
    pages = {}
    for path in sorted(dest_dir.glob("p-*.jpg")):
        pages[int(path.stem.split("-")[-1])] = path
    return pages


def save_crop(image, box, dest):
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(image.width, x1), min(image.height, y1)
    if y1 - y0 < 24 or x1 - x0 < 40:
        return None
    crop = image.crop((x0, y0, x1, y1))
    gray = np.array(crop.convert("L"))
    ink = np.argwhere(gray < 200)
    if len(ink) < 30:
        return None
    pad = 10
    top = max(0, int(ink[:, 0].min()) - pad)
    bottom = min(crop.height, int(ink[:, 0].max()) + pad)
    left = max(0, int(ink[:, 1].min()) - pad)
    right = min(crop.width, int(ink[:, 1].max()) + pad)
    crop = crop.crop((left, top, right, bottom))
    if crop.width > 980:
        crop = crop.resize((980, max(1, int(crop.height * 980 / crop.width))), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    crop.convert("RGB").save(dest, quality=74, optimize=True)
    return dest


def footer_limits(pages):
    """Y of the copyright line on each PDF page, so crops stop above it."""
    limits = {}
    for page in pages:
        ys = [
            y for x, y, label in page["words"]
            if y > page["height"] * 0.8 and (
                "©" in label or "HKDSE" in label or label.startswith("參考答案") or "Suggested" in label
            )
        ]
        if ys:
            limits[page["page"]] = min(ys) - 4
    return limits


def crop_span(pages, start, end, dest, footers=None):
    """Cut from one question number to the next, across a page break if needed."""
    scale = DPI / 72
    footers = footers or {}
    pieces = []
    page = start["page"]
    y0 = start["y"]
    last_page = end["page"] if end else start["page"]
    y1 = end["y"] if end and end["page"] == page else start["height"] - 36
    while True:
        image_path = pages.get(page)
        if image_path:
            image = Image.open(image_path)
            top = int((y0 - 4) * image.height / start["height"]) if page == start["page"] else 48
            if page == last_page and end and end["page"] == page:
                limit = end["y"] - 2
            else:
                limit = footers.get(page, start["height"] - 36)
            bottom = int(limit * image.height / (end["height"] if end and end["page"] == page else start["height"]))
            left = int(36 * scale)
            right = image.width - int(24 * scale)
            piece = image.crop((max(0, left), max(0, top), right, min(image.height, bottom)))
            if piece.height > 20:
                pieces.append(piece)
        if page >= last_page:
            break
        page += 1
        y0 = 50
    if not pieces:
        return None
    width = max(p.width for p in pieces)
    height = sum(p.height for p in pieces)
    canvas = Image.new("RGB", (width, height), "white")
    y = 0
    for piece in pieces:
        canvas.paste(piece, (0, y))
        y += piece.height
    return save_crop(canvas, (0, 0, canvas.width, canvas.height), dest)


def figure_boxes(image):
    gray = np.array(image.convert("L"))
    ink = gray < 185
    height, width = ink.shape
    rows = ink.sum(axis=1) > 3
    bands = []
    in_run = False
    for i, on in enumerate(list(rows) + [False]):
        if on and not in_run:
            start = i
            in_run = True
        elif not on and in_run:
            if i - start > 70:
                band = ink[start:i]
                cols = np.where(band.sum(axis=0) > 2)[0]
                if len(cols):
                    span = int(cols[-1] - cols[0])
                    density = float(band.mean())
                    wide_rows = np.mean(band.sum(axis=1) > width * 0.55)
                    if 0.006 < density < 0.045 and span > width * 0.35 and wide_rows < 0.25 and (i - start) < height * 0.8:
                        bands.append((int(cols[0]) - 12, start - 8, int(cols[-1]) + 12, i + 8))
            in_run = False
    return bands


def wants_figure(question):
    text = question.get("plainText") or ""
    graph = question.get("graphType") or "-"
    return bool(question.get("inlineDiagrams")) or "[圖" in text or graph not in ("-", "", "考生繪圖")


def page_words(pdf):
    html = subprocess.check_output(
        ["pdftotext", "-bbox-layout", str(pdf), "-"], text=True, errors="replace"
    )
    pages = []
    for page_no, page in enumerate(re.findall(r"<page\b[^>]*>.*?</page>", html, re.S), 1):
        size = re.search(r'width="([\d.]+)" height="([\d.]+)"', page)
        if not size:
            continue
        words = []
        for word in re.finditer(
            r'<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]+)</word>', page
        ):
            words.append((float(word.group(1)), float(word.group(2)), word.group(3).strip()))
        pages.append({
            "page": page_no,
            "width": float(size.group(1)),
            "height": float(size.group(2)),
            "words": words,
        })
    return pages


def _after(page, y, start):
    if start is None:
        return False
    return (page, y) > (start[0], start[1] - 1)


def _before(page, y, end):
    if end is None:
        return True
    return (page, y) < (end[0], end[1] - 1)


def explanation_window(pages, language):
    """Page/y of the MC explanation heading, and of Paper 2 after it."""
    start = end = None
    for page in pages:
        words = page["words"]
        for i, (x, y, label) in enumerate(words):
            if x > 90:
                continue
            if language == "chi" and label == "答案解釋" and start is None:
                start = (page["page"], y)
            if language == "eng" and label == "Explanation" and start is None:
                start = (page["page"], y)
            if start is None or not _after(page["page"], y, start):
                continue
            if language == "chi" and label == "卷二":
                return start, (page["page"], y)
            if language == "eng" and label == "Paper":
                nxt = next((w for w in words[i + 1:i + 4] if abs(w[1] - y) < 2), None)
                if nxt and nxt[2] == "2":
                    return start, (page["page"], y)
    return start, end


def explanation_starts(pages, language):
    start, end = explanation_window(pages, language)
    if not start:
        return []
    starts = []
    seen = set()
    for page in pages:
        if page["page"] < start[0] or (end and page["page"] > end[0]):
            continue
        tokens = [
            (x, y, label)
            for x, y, label in page["words"]
            if x < 180 and 40 < y < page["height"] - 40 and re.match(r"\d", label)
            and _after(page["page"], y, start) and _before(page["page"], y, end)
        ]
        tokens.sort(key=lambda item: (item[1], item[0]))
        i = 0
        while i < len(tokens):
            x, y, label = tokens[i]
            if x > 70:
                i += 1
                continue
            if (
                i + 1 < len(tokens)
                and abs(tokens[i + 1][1] - y) < 1.2
                and 0 < tokens[i + 1][0] - x < 14
                and re.fullmatch(r"\d{1,2}\.?", label + tokens[i + 1][2])
            ):
                label += tokens[i + 1][2]
                i += 1
            followed = any(
                abs(tok[1] - y) < 1.2 and x + 8 < tok[0] < x + 50 and re.match(r"\d", tok[2])
                for tok in tokens[i + 1:]
            )
            if re.fullmatch(r"\d{1,2}\.?", label) and not followed:
                num = int(label.rstrip("."))
                if num not in seen and (not starts or num > starts[-1]["num"]):
                    seen.add(num)
                    starts.append({
                        "page": page["page"], "num": num, "y": y,
                        "width": page["width"], "height": page["height"],
                    })
            i += 1
    return starts


def english_explanation_text(pdf):
    text = layout_text(pdf)
    exp = re.search(r"(?:^|\n|\f)\s*Explanation\s*(?:\n|\f)", text)
    if not exp:
        return {}
    paper2 = re.search(r"(?:^|\n|\f)\s*Paper 2\s*(?:\n|\f)", text[exp.end():])
    body = text[exp.end(): exp.end() + paper2.start()] if paper2 else text[exp.end():]
    return split_numbered(body)


def recrop_mc_answers():
    """Replace paper-1 answer crops with the explanation block, plus English crops."""
    db = json.loads(DB_PATH.read_text())
    by_id = {q["id"]: q for q in db["questions"]}
    chi_saved = eng_saved = text_saved = 0
    short = []
    for num in range(27, 45):
        chi = chi_pdf(num, "參考答案")
        eng = eng_pdf(num, "Suggested Solution")
        chi_words = page_words(chi) if chi else []
        eng_words = page_words(eng) if eng else []
        chi_pages = render_pages(chi, Path(f"/tmp/mt-render/{num}-ans")) if chi else {}
        eng_pages = render_pages(eng, Path(f"/tmp/mt-render/{num}-eng-ans")) if eng else {}
        chi_starts = explanation_starts(chi_words, "chi") if chi else []
        eng_starts = explanation_starts(eng_words, "eng") if eng else []
        eng_text = english_explanation_text(eng) if eng else {}
        for group, pages, prefix, field, words in (
            (chi_starts, chi_pages, "a", "originalAnswerImage", chi_words),
            (eng_starts, eng_pages, "ae", "originalAnswerImageEng", eng_words),
        ):
            for i, mark in enumerate(group):
                qid = f"M{num}-P1-Q{mark['num']:02d}"
                question = by_id.get(qid)
                if not question or question.get("questionType") != "MC":
                    continue
                dest = ORIG / str(num) / f"{prefix}-p1-{mark['num']:02d}.jpg"
                # Stop at the next question. A paragraph belongs to the question it is printed under.
                end = group[i + 1] if i + 1 < len(group) else None
                saved = crop_span(pages, mark, end, dest, footer_limits(words))
                if not saved:
                    short.append((qid, prefix, "missing"))
                    continue
                question[field] = f"originals/{num}/{prefix}-p1-{mark['num']:02d}.jpg"
                if prefix == "a":
                    chi_saved += 1
                else:
                    eng_saved += 1
                with Image.open(saved) as image:
                    if image.height < 80:
                        short.append((qid, prefix, image.height))
        for qnum, answer in eng_text.items():
            question = by_id.get(f"M{num}-P1-Q{qnum:02d}")
            if not question or question.get("questionType") != "MC":
                continue
            letter = mc_letter(answer)
            if letter and question.get("answerMC") and letter != question["answerMC"]:
                continue
            question["answerEng"] = answer.strip()
            text_saved += 1
        print("mc answers", num, "chi", len(chi_starts), "eng", len(eng_starts), flush=True)
    text = json.dumps(db, ensure_ascii=False, indent=2) + "\n"
    DB_PATH.write_text(text)
    (DATA / "database.js").write_text("window.QUESTION_DATABASE = " + text.strip() + ";\n")
    print("chi", chi_saved, "eng", eng_saved, "text", text_saved, "short", short[:20], "nshort", len(short))


def main():
    db = json.loads(DB_PATH.read_text())
    by_id = {q["id"]: q for q in db["questions"]}
    attached = 0
    mismatched = []
    cropped = 0
    figures = 0

    for num in range(27, 45):
        eng_q = {}
        eng_a1, eng_a2 = {}, {}
        for paper, name in ((1, "Paper 1"), (2, "Paper 2")):
            pdf = eng_pdf(num, name)
            if pdf:
                eng_q[paper] = english_questions(pdf)
        sol = eng_pdf(num, "Suggested Solution")
        if sol:
            eng_a1, eng_a2 = english_answers(sol)
        answers = {1: eng_a1, 2: eng_a2}

        for paper in (1, 2):
            kind = "卷一" if paper == 1 else "卷二"
            qpdf = chi_pdf(num, kind)
            apdf = chi_pdf(num, "參考答案")
            q_starts = question_starts(qpdf) if qpdf else []
            a_starts = question_starts(apdf) if apdf else []
            q_pages = render_pages(qpdf, Path(f"/tmp/mt-render/{num}-p{paper}")) if qpdf else {}
            a_pages = render_pages(apdf, Path(f"/tmp/mt-render/{num}-ans")) if apdf and paper == 1 else {}
            if paper == 2 and apdf:
                a_pages = render_pages(apdf, Path(f"/tmp/mt-render/{num}-ans"))

            ids = [q["id"] for q in db["questions"] if q.get("publisher") == "雅集出版社" and str(q.get("year")) == str(num) and str(q.get("paper")) == str(paper)]
            for qid in ids:
                question = by_id[qid]
                qnum = int(re.match(r"\d+", str(question.get("questionNumber") or "0")).group(0))
                english = eng_q.get(paper, {}).get(qnum, "")
                answer = answers.get(paper, {}).get(qnum, "")
                if paper == 1 and question.get("answerMC") and answer:
                    letter = mc_letter(answer)
                    if letter and letter != question["answerMC"]:
                        mismatched.append((qid, question["answerMC"], letter))
                        english, answer = "", ""
                letter = mc_letter(answer) if paper == 1 else None
                same_key = letter and letter == question.get("answerMC")
                if paper == 1 and english and not has_options(english) and not same_key:
                    mismatched.append((qid, "options", "missing"))
                    english = ""
                if english:
                    question["questionTextEng"] = english
                    attached += 1
                if answer:
                    question["answerEng"] = answer

                q_index = next((i for i, s in enumerate(q_starts) if s["num"] == qnum), None)
                if q_index is not None:
                    dest = ORIG / str(num) / f"q-p{paper}-{qnum:02d}.jpg"
                    end = q_starts[q_index + 1] if q_index + 1 < len(q_starts) else None
                    saved = crop_span(q_pages, q_starts[q_index], end, dest)
                    if saved:
                        question["originalQuestionImage"] = f"originals/{num}/q-p{paper}-{qnum:02d}.jpg"
                        cropped += 1
                        if wants_figure(question):
                            image = Image.open(saved)
                            boxes = figure_boxes(image)
                            paths = []
                            for n, box in enumerate(boxes[:2], 1):
                                name = f"{qid}.jpg" if len(boxes) == 1 else f"{qid}-{n}.jpg"
                                fig = save_crop(image, box, DIAG / name)
                                if fig:
                                    paths.append(f"diagrams/{name}")
                            if paths:
                                question["inlineDiagrams"] = ",".join(paths)
                                figures += 1
                            elif question.get("inlineDiagrams"):
                                question.pop("inlineDiagrams", None)

                a_index = next((i for i, s in enumerate(a_starts) if s["num"] == qnum), None)
                if a_index is not None and a_pages:
                    dest = ORIG / str(num) / f"a-p{paper}-{qnum:02d}.jpg"
                    end = a_starts[a_index + 1] if a_index + 1 < len(a_starts) else None
                    # Paper 1 and paper 2 explanations share one solution PDF.
                    # Only keep an answer crop whose following text is on an explanation page
                    # already selected by question_starts.
                    if crop_span(a_pages, a_starts[a_index], end, dest):
                        # Do not let paper 2 overwrite paper 1 when numbers collide in one pass.
                        if paper == 1 or not str(question.get("originalAnswerImage") or "").endswith(f"a-p1-{qnum:02d}.jpg"):
                            question["originalAnswerImage"] = f"originals/{num}/a-p{paper}-{qnum:02d}.jpg"
        print("paper", num, "attached so far", attached, "crops", cropped, flush=True)

    # Paper 2 answer crops were rendered from the same solution PDF as paper 1,
    # so a second pass assigns them after both papers have their own starts.
    for num in range(27, 45):
        apdf = chi_pdf(num, "參考答案")
        if not apdf:
            continue
        starts = question_starts(apdf)
        pages = render_pages(apdf, Path(f"/tmp/mt-render/{num}-ans"))
        # The solution lists paper 1 explanations first, then paper 2.
        # Split at the second run of question 1.
        ones = [i for i, s in enumerate(starts) if s["num"] == 1]
        if len(ones) >= 2:
            p1, p2 = starts[:ones[1]], starts[ones[1]:]
        else:
            p1, p2 = starts, []
        for paper, group in ((1, p1), (2, p2)):
            for i, mark in enumerate(group):
                qid = f"M{num}-P{paper}-Q{mark['num']:02d}"
                question = by_id.get(qid)
                if not question:
                    continue
                dest = ORIG / str(num) / f"a-p{paper}-{mark['num']:02d}.jpg"
                end = group[i + 1] if i + 1 < len(group) else None
                if crop_span(pages, mark, end, dest):
                    question["originalAnswerImage"] = f"originals/{num}/a-p{paper}-{mark['num']:02d}.jpg"

    text = json.dumps(db, ensure_ascii=False, indent=2) + "\n"
    DB_PATH.write_text(text)
    (DATA / "database.js").write_text("window.QUESTION_DATABASE = " + text.strip() + ";\n")
    print("attached", attached, "cropped", cropped, "figures", figures, "mismatched", len(mismatched))
    for row in mismatched[:30]:
        print(" mismatch", row)


def english_question_starts(pdf):
    """Question numbers after the paper heading, ignoring the instruction list."""
    pages = page_words(pdf)
    start = None
    for page in pages:
        for x, y, label in page["words"]:
            if x < 140 and label in ("There", "Section", "Choose"):
                start = (page["page"], y)
                break
        if start:
            break
    kept = []
    for mark in question_starts(pdf):
        if start and (mark["page"], mark["y"]) <= (start[0], start[1] + 1):
            continue
        if kept and mark["num"] <= kept[-1]["num"]:
            break
        kept.append(mark)
    return kept, pages


def crop_english_questions():
    """Crop each English mock question. Leave Chinese crops unchanged."""
    db = json.loads(DB_PATH.read_text())
    by_id = {q["id"]: q for q in db["questions"]}
    saved_n = skipped = 0
    for num in range(27, 45):
        for paper, name in ((1, "Paper 1"), (2, "Paper 2")):
            pdf = eng_pdf(num, name)
            if not pdf:
                continue
            starts, words = english_question_starts(pdf)
            pages = render_pages(pdf, Path(f"/tmp/mt-render/{num}-eng-p{paper}"))
            footers = footer_limits(words)
            for i, mark in enumerate(starts):
                qid = f"M{num}-P{paper}-Q{mark['num']:02d}"
                question = by_id.get(qid)
                if not question or not question.get("questionTextEng"):
                    skipped += 1
                    continue
                dest = ORIG / str(num) / f"qe-p{paper}-{mark['num']:02d}.jpg"
                end = starts[i + 1] if i + 1 < len(starts) else None
                if crop_span(pages, mark, end, dest, footers):
                    question["originalQuestionImageEng"] = f"originals/{num}/qe-p{paper}-{mark['num']:02d}.jpg"
                    saved_n += 1
        print("english questions", num, "saved", saved_n, flush=True)
    text = json.dumps(db, ensure_ascii=False, indent=2) + "\n"
    DB_PATH.write_text(text)
    (DATA / "database.js").write_text("window.QUESTION_DATABASE = " + text.strip() + ";\n")
    print("english question images", saved_n, "skipped", skipped)


if __name__ == "__main__":
    if "--mc-answers" in sys.argv:
        recrop_mc_answers()
    elif "--english-questions" in sys.argv:
        crop_english_questions()
    else:
        main()
