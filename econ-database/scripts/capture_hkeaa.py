#!/usr/bin/env python3
"""Crop HKDSE question, written-answer, and markers-report images from PastPaper PDFs.

A crop is kept only when its wording agrees with the question already stored
in the bank (Chinese plain text, or the English question text).
"""

import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import capture_from_pdf as base

ROOT = Path(__file__).resolve().parents[2]
PAST = ROOT / "PastPaper"
DATA = ROOT / "econ-database" / "data"
ORIG = ROOT / "econ-database" / "originals" / "dse"
DB_PATH = DATA / "database.json"
DPI = 110

NUM_RE = re.compile(r"^(\d{1,2})[.\-．、•‧]")


def pdf_path(year, lang):
    name = f"DSE {year} ({'Chi' if lang == 'chi' else 'Eng'}).pdf"
    path = PAST / name
    return path if path.is_file() else None


def bbox_pages(pdf):
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
        page = {
            "page": page_no,
            "width": float(size.group(1)),
            "height": float(size.group(2)),
            "words": words,
        }
        fit_box(page)
        pages.append(page)
    return pages


def fit_box(page):
    """pdftotext reports the unrotated media box; word positions follow the page image."""
    words = page["words"]
    if not words:
        return
    max_x = max(x for x, _, _ in words)
    max_y = max(y for _, y, _ in words)
    if max_y > page["height"] * 1.05 and max_x <= page["height"] * 1.15:
        page["width"], page["height"] = page["height"], page["width"]
    page["width"] = max(page["width"], max_x + 8)
    page["height"] = max(page["height"], max_y + 8)


def ocr_page(image_path, width, height, lang="chi_tra+eng"):
    dest = Path(str(image_path) + ".tsv")
    usable = dest.is_file() and dest.stat().st_size > 200
    if not usable:
        try:
            subprocess.check_call(
                ["tesseract", str(image_path), str(image_path), "-l", lang, "--psm", "6", "tsv"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
            )
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
            return []
    scale = 1
    words = []
    text = dest.read_text(errors="replace").splitlines()
    for line in text[1:]:
        cols = line.split("\t")
        if len(cols) < 12 or not cols[11].strip():
            continue
        px, py = float(cols[6]), float(cols[7])
        words.append((px * scale * 72 / DPI, py * scale * 72 / DPI, cols[11].strip()))
    return words


def page_image(cache_dir, number):
    """pdftoppm pads names (p-01.jpg); accept either padded or plain names."""
    for path in cache_dir.glob("p-*.jpg"):
        stem = path.stem.split("-")[-1]
        if stem.isdigit() and int(stem) == number:
            return path
    return None


def load_pages(pdf, cache_dir, ocr_lang="chi_tra+eng"):
    pages = bbox_pages(pdf)
    need = [p for p in pages if len(p["words"]) == 0]
    if not need:
        return pages
    cache_dir.mkdir(parents=True, exist_ok=True)
    missing = [p["page"] for p in need if page_image(cache_dir, p["page"]) is None]
    if missing:
        subprocess.check_call(
            ["pdftoppm", "-jpeg", "-r", str(DPI), "-f", str(min(missing)), "-l", str(max(missing)),
             "-jpegopt", "quality=70", str(pdf), str(cache_dir / "p")],
            stdout=subprocess.DEVNULL,
        )
    jobs = []
    for page in need:
        image = page_image(cache_dir, page["page"])
        if image is not None:
            jobs.append((page, image))
    with ThreadPoolExecutor(max_workers=1) as pool:
        words = list(pool.map(
            lambda item: ocr_page(item[1], item[0]["width"], item[0]["height"], ocr_lang),
            jobs,
        ))
    for (page, _image), found in zip(jobs, words):
        page["words"] = found
        fit_box(page)
    return pages


def page_text(page):
    return " ".join(word for _, _, word in page["words"])


def is_blank_sheet(page):
    text = page_text(page)
    if text.count("寫") + text.count("邊") > 12:
        return True
    if len(page["words"]) < 40 and ("Answers written in the margins" in text or "will not be marked" in text):
        return True
    return False


def heading_text(page):
    return " ".join(label for _x, y, label in page["words"] if y < 140)


def section_marks(pages):
    """Return (paper1_start, paper2_start, marking_start, report_start) as page numbers."""
    p1 = p2 = marking = report = None
    for page in pages:
        head = heading_text(page).replace("&apos;", "'").replace("&#39;", "'")
        if report is None and re.search(r"考生表現|Candidates.?\s*Performance", head, re.I):
            report = page["page"]
        elif marking is None and report is None and re.search(r"評卷參考|Marking", head, re.I):
            marking = page["page"]
        elif p2 is None and marking is None and re.search(r"試卷二|卷二|\bPaper\s*2\b", head, re.I):
            p2 = page["page"]
        elif p1 is None and re.search(r"選擇每題|BEST answer|There are \d+ questions|共\s*\d+\s*題", page_text(page)[:500]):
            p1 = page["page"]
    return p1, p2, marking, report


def question_marks(pages, first, last):
    marks = []
    for page in pages:
        if first and page["page"] < first:
            continue
        if last and page["page"] >= last:
            continue
        if is_blank_sheet(page):
            continue
        head = heading_text(page)
        if re.search(r"考生須知|INSTRUCTIONS", page_text(page)):
            continue
        found = []
        for x, y, label in page["words"]:
            if not (54 <= x <= 100 and 50 < y < page["height"] - 40):
                continue
            token = label.replace("&apos;", "'")
            number = None
            if token in {"I.", "l.", "1."}:
                number = 1
            else:
                match = re.match(r"^(\d{1,2})[.\-．、•‧]?$", token)
                if match:
                    number = int(match.group(1))
            if not number or number > 45 or y > page["height"] - 55:
                continue
            found.append((number, y))
        # A marking-key page lists many numbers a few points apart.
        if len(found) >= 10 and found[-1][1] - found[0][1] < 280:
            continue
        found.sort(key=lambda item: item[1])
        for num, y in found:
            marks.append({
                "page": page["page"], "num": num, "y": y,
                "width": page["width"], "height": page["height"],
            })
    kept = []
    for mark in marks:
        if kept and mark["num"] <= kept[-1]["num"]:
            continue
        kept.append(mark)
    return kept


def span_text(pages, start, end):
    chunks = []
    for page in pages:
        if page["page"] < start["page"]:
            continue
        if end and page["page"] > end["page"]:
            break
        for x, y, label in page["words"]:
            if page["page"] == start["page"] and y < start["y"] - 2:
                continue
            if end and page["page"] == end["page"] and y >= end["y"] - 2:
                continue
            chunks.append(label)
    return "".join(chunks)


def trim_ruled_space(image):
    """Remove a run of blank ruled lines left for written answers."""
    import numpy as np
    gray = np.array(image.convert("L"))
    height, width = gray.shape
    groups = []
    for i in range(height):
        faint = float((gray[i] < 250).mean())
        dark = float((gray[i] < 160).mean())
        if faint > 0.35 and dark < 0.08:
            if groups and i - groups[-1][-1] <= 3:
                groups[-1].append(i)
            else:
                groups.append([i])
    blocks = []
    run = []
    for index, group in enumerate(groups):
        if not run:
            run = [index]
            continue
        gap = group[0] - groups[index - 1][-1]
        if 18 <= gap <= 60:
            run.append(index)
        else:
            if len(run) >= 3:
                blocks.append(run)
            run = [index]
    if len(run) >= 3:
        blocks.append(run)
    if not blocks:
        return image
    pieces = []
    y = 0
    for run in blocks:
        top = max(0, groups[run[0]][0] - 8)
        bottom = min(height, groups[run[-1]][-1] + 10)
        if top > y + 8:
            pieces.append(image.crop((0, y, width, top)))
        y = bottom
    if y < height - 8:
        pieces.append(image.crop((0, y, width, height)))
    pieces = [piece for piece in pieces if piece.height > 16]
    if not pieces:
        return image
    canvas = Image.new("RGB", (width, sum(piece.height for piece in pieces)), "white")
    at = 0
    for piece in pieces:
        canvas.paste(piece, (0, at))
        at += piece.height
    return canvas


def agrees(crop, reference):
    if not reference or not crop:
        return False
    crop_n = re.sub(r"\s+", "", crop)
    ref_n = re.sub(r"\s+", "", reference)
    if len(ref_n) < 6:
        return False
    window = ref_n[:48]
    for size in (8, 6, 4):
        hits = 0
        for i in range(0, max(1, len(window) - size + 1)):
            piece = window[i:i + size]
            if piece and piece in crop_n:
                hits += 1
        need = 2 if size == 4 else 1
        if hits >= need:
            return True
    words = re.findall(r"[A-Za-z]{5,}", reference.lower())[:40]
    if words and sum(word in crop.lower() for word in words) >= 3:
        return True
    return False


def render(pdf, dest_dir):
    if not any(dest_dir.glob("p-*.jpg")):
        dest_dir.mkdir(parents=True, exist_ok=True)
        subprocess.check_call(
            ["pdftoppm", "-jpeg", "-r", str(DPI), "-jpegopt", "quality=74", str(pdf), str(dest_dir / "p")],
            stdout=subprocess.DEVNULL,
        )
    pages = {}
    for path in dest_dir.glob("p-*.jpg"):
        pages[int(path.stem.split("-")[-1])] = path
    return pages


def save_db(db):
    text = json.dumps(db, ensure_ascii=False, indent=2) + "\n"
    DB_PATH.write_text(text)
    (DATA / "database.js").write_text("window.QUESTION_DATABASE = " + text.strip() + ";\n")


def main():
    only = set(sys.argv[1:])
    db = json.loads(DB_PATH.read_text())
    by_id = {q["id"]: q for q in db["questions"]}
    saved = {"q": 0, "a": 0, "r": 0}
    # 2013 scans do not OCR reliably; see HKEAA-待補圖片.md.
    skip = {2013}
    for year in range(2012, 2026):
        if year in skip or (only and str(year) not in only):
            continue
        before = dict(saved)
        for lang, prefix, field_q, field_a, field_r, ref_key in (
            ("eng", "qe", "originalQuestionImageEng", "originalAnswerImageEng", "originalReportImageEng", "questionTextEng"),
            ("chi", "q", "originalQuestionImage", "originalAnswerImage", "originalReportImage", "plainText"),
        ):
            pdf = pdf_path(year, lang)
            if not pdf:
                continue
            cache = Path(f"/tmp/hkeaa-ocr/{year}-{lang}")
            pages = load_pages(pdf, cache, "eng" if lang == "eng" else "chi_tra+eng")
            p1, p2, marking, report = section_marks(pages)
            images = render(pdf, Path(f"/tmp/hkeaa-render/{year}-{lang}"))
            footers = base.footer_limits(pages)
            q_marks = question_marks(pages, p1, p2 or marking or report)
            # Paper 2 questions sit before the marking scheme.
            q2_marks = question_marks(pages, p2, marking or report) if p2 else []
            groups = [(1, q_marks), (2, q2_marks)]
            for paper, group in groups:
                for i, mark in enumerate(group):
                    qid = f"DSE-{year}-P{paper}-{mark['num']:02d}"
                    question = by_id.get(qid)
                    if not question:
                        continue
                    end = group[i + 1] if i + 1 < len(group) else None
                    reference = question.get(ref_key) or question.get("questionTextChi") or ""
                    body = span_text(pages, mark, end)
                    # Chinese scans often OCR poorly. Keep the crop when the English
                    # text for this same question number already matched.
                    if not agrees(body, reference):
                        if not (lang == "chi" and question.get("originalQuestionImageEng")):
                            continue
                    name = f"{prefix}-p{paper}-{mark['num']:02d}.jpg"
                    dest = ORIG / str(year) / name
                    try:
                        cropped = base.crop_span(images, mark, end, dest, footers)
                    except ValueError:
                        cropped = None
                    if cropped:
                        image = Image.open(dest)
                        if question.get("questionType") != "MC":
                            image = trim_ruled_space(base.strip_answer_lines(image))
                            image.convert("RGB").save(dest, quality=74, optimize=True)
                        question[field_q] = f"originals/dse/{year}/{name}"
                        saved["q"] += 1
            # Written answers: question numbers inside the marking scheme, after Paper 2.
            if marking:
                answer_from = marking
                for page in pages:
                    if page["page"] < marking or (report and page["page"] >= report):
                        continue
                    if re.search(r"卷二|Paper\s*2|甲部|Section A", page_text(page)[:300]):
                        answer_from = page["page"]
                        break
                a_marks = question_marks(pages, answer_from, report)
                ap = "a" if lang == "chi" else "ae"
                for i, mark in enumerate(a_marks):
                    qid = f"DSE-{year}-P2-{mark['num']:02d}"
                    question = by_id.get(qid)
                    if not question or question.get("questionType") == "MC":
                        continue
                    # The answer crop must not be the question stem again.
                    end = a_marks[i + 1] if i + 1 < len(a_marks) else None
                    stem = question.get(ref_key) or ""
                    body = span_text(pages, mark, end)
                    if agrees(body, stem) and not re.search(r"分|mark", body, re.I):
                        continue
                    name = f"{ap}-p2-{mark['num']:02d}.jpg"
                    dest = ORIG / str(year) / name
                    try:
                        cropped = base.crop_span(images, mark, end, dest, footers)
                    except ValueError:
                        cropped = None
                    if cropped:
                        question[field_a] = f"originals/dse/{year}/{name}"
                        saved["a"] += 1
            if report:
                rp = "r" if lang == "chi" else "re"
                report_pages = [p for p in pages if p["page"] >= report and "一般評論" not in page_text(p)[:80] and "General comments" not in page_text(p)[:80]]
                for paper in (1, 2):
                    ids = [q["id"] for q in db["questions"] if q.get("id", "").startswith(f"DSE-{year}-P{paper}-")]
                    for qid in ids:
                        question = by_id.get(qid)
                        found = re.search(r"-(\d+)$", qid)
                        if not found:
                            continue
                        num = int(found.group(1))
                        pattern = rf"第\s*{num}\s*題|Question\s*{num}\b|(?<!\d){num}\s*[\(（][a-dA-D]"
                        hits = []
                        for page in report_pages:
                            text = page_text(page)
                            if not re.search(pattern, text):
                                continue
                            ys = [y for x, y, label in page["words"] if re.search(pattern, label) or re.search(rf"^{num}[.\(（]", label)]
                            y0 = min(ys) if ys else 60
                            mark = {"page": page["page"], "num": num, "y": y0, "width": page["width"], "height": page["height"]}
                            later = [w[1] for w in page["words"] if w[1] > y0 + 20 and re.match(r"^第?\d", w[2])]
                            end = None
                            if later:
                                end = {"page": page["page"], "y": min(later), "height": page["height"]}
                            name = f"{rp}-p{paper}-{num:02d}.jpg"
                            dest = ORIG / str(year) / name
                            try:
                                cropped = base.crop_span(images, mark, end, dest, footers)
                            except ValueError:
                                cropped = None
                            if cropped:
                                question[field_r] = f"originals/dse/{year}/{name}"
                                saved["r"] += 1
                                hits.append(page["page"])
                                break
        print("year", year, {key: saved[key] - before[key] for key in saved}, flush=True)
        save_db(db)
    print("done", saved)


if __name__ == "__main__":
    main()
