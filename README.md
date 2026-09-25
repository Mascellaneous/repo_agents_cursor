# Mock-paper question bank: notes for a future agent

This repository holds Aristo HKDSE Economics mock papers, an HKEAA question export, and the `econ-database` app that browses them. Opening `econ-database/index.html` through a web server fetches `econ-database/data/database.json`. Opening that file directly (`file://`) cannot fetch a neighbour file, so the page loads `econ-database/data/database.js` instead. The builder writes both files together. The app does not fetch Google Sheets.

## Version number

`APP_VERSION` in `econ-database/js/constants.js` is printed in the browser console as `Question bank version:` when the page loads. The same value is on the `?v=` of every script in `econ-database/index.html`, so a new number also bypasses a cached copy of the scripts.

Bump both together on every change to the app or the question bank. Do not keep a record of what each version changed. A reader checks the console line against the number in `constants.js` to see whether the open page is current. GitHub Pages may keep the previous scripts for about ten minutes; the version line is how you tell.

## What the Python script is for

`econ-database/scripts/build_mock_questions.py` is only the first import. It reads every `.docx` in `MockTests/`, splits Paper 1 and Paper 2 into questions, guesses a chapter (`topic`), specific concepts, and question patterns, and writes `econ-database/data/database.json`.

That parse is rough. Word files repeat text boxes, glue diagram labels into the stem, and sometimes split one question into two. Do not treat the script output as finished.

## Fields a reviewer must keep

Each question object includes:

- `id`: stable key, `M{paper}-P{1|2}-Q{nn}`, for example `M35-P1-Q01`. Paper numbers are 27–44 today.
- Do not put that question number at the start of `plainText`, `questionTextChi`, or `answerChi`. The id already has it.
- `topic`: chapter name. This is the broad classification.
- `concepts`: specific ideas such as 機會成本 or 勞工生產力. Not the chapter name.
- `patterns`: how the question is asked (解釋, 計算, 圖表判讀, …). Do not put 多項選擇題 or 結構題 here. That distinction is `questionType`.
- `plainText` and `questionTextChi`: the same cleaned wording. `plainText` is the column a person reads.
- `reviewedByAI`: `Y` or `N`.
- `lastReviewDate`: `YYYY-MM-DD` when `reviewedByAI` is `Y`, otherwise an empty string.

## Do not overwrite a reviewed question

The builder loads the existing JSON before it writes. If `reviewedByAI` is `Y`, that whole record is copied back unchanged, even when the parser emits a new draft with the same `id`. Reviewed records whose `id` the parser no longer emits are still appended, so a boundary fix is not dropped.

After you correct a question by hand, set `reviewedByAI` to `Y` and `lastReviewDate` to the day you finished. Leave `N` on anything you did not read.

Running the script again is safe for reviewed rows. It will still refresh rows marked `N`.

## How to review one question

Read the `.docx` and the JSON row together. For each question:

1. Find the stem in `MockTests/`. Paper 1 files end in 卷一, Paper 2 in 卷二, marking schemes in 參考答案.
2. Drop running headers, barcodes, 「請在此貼上電腦條碼」, page furniture, and a second copy of the same paragraph.
3. Keep the stem, any table that is part of the question, and options A–D. If a diagram does not survive as text, write a short bracket such as `[圖：供需曲線，原均衡 E0]` instead of pasting the same axis labels three times. Do not assign a number to price or quantity unless the file states that pairing.
4. Put the cleaned wording in both `plainText` and `questionTextChi`.
5. Check `topic`, `concepts`, and `patterns` against that cleaned wording. Fix them if the draft was based on junk text.
6. Copy the keyed answer from 參考答案 when it is missing. Do not invent an answer.
7. Set `reviewedByAI` to `Y` and `lastReviewDate` to today only after that read.

## Vocabulary for concepts, patterns, diagrams, and tables

Read `econ-database/data/vocabulary.json` before you classify a new paper. It lists the concepts, question patterns, diagram types, and table types already used.

- `concepts` are specific ideas such as 機會成本 and 勞工生產力. Do not put the chapter name there.
- `patterns` describe how the question is asked. Do not repeat `questionType`.
- `graphType` is a diagram type from `diagramTypes`, or `-` when there is no diagram. Do not leave it as 圖.
- `tableType` is a table type from `tableTypes`, or `-` when there is no table. Do not leave it as 表格.
- `calculationType` is a calculation type from `calculationTypes`, or `-`. Do not leave it as 計算. Wording such as 包括在本地生產總值的計算之內 is not a calculation question.
- `multipleSelectionType` is a combination type from `multipleSelectionTypes`, or `-`. Do not leave it as 複選. Three numbered statements are 三項陳述組合; four are 四項陳述組合. A 哪幅圖 item whose choices are numbered diagrams is 圖選組合.
- A figure labelled 下圖 that is only rows of numbers is a table, not a diagram.
- 細閱以下 by itself is not a diagram. Use it only when the question actually shows or asks for a figure.
- Add a new label on the question when none of the existing ones fits. Do not edit `vocabulary.json` by hand. Every time the builder writes `database.json`, it rewrites `vocabulary.json` from the concepts, patterns, diagram types, and table types on those questions, and it keeps labels already in the file. After you change labels without a full import, run `python3 econ-database/scripts/build_mock_questions.py --sync-vocabulary`. That reads `database.json` and updates `vocabulary.json` only.

## HKEAA questions

`econ-database/data/database.json` also holds questions published by HKEAA (HKDSE, HKCEE, and HKALE). They use the same fields as the mock papers. `publisher` is `HKEAA` or `雅集出版社`. The filter row has a 出版商 control that includes or excludes either publisher. A publisher badge on a question card applies the same filter.

Import another HKEAA export with:

`python3 econ-database/scripts/build_mock_questions.py --import-hkeaa path/to/export.json`

The importer classifies topic, concepts, patterns, diagram type, table type, calculation type, and combination type from the wording. New rows stay `reviewedByAI` `N`. A row already marked `Y` is not replaced. It refreshes `vocabulary.json` in the same run.

Question images for the mock papers are cut from the official PDF, not from the Word file. The Chinese wording still comes from the Word file. `questionTextEng` is the English paper when the question number and, for multiple choice, the answer letter match the Chinese record. The matching English question image is `originalQuestionImageEng`.

Multiple-choice answer images are the「答案解釋」block in the Chinese solution PDF, and the matching「Explanation」block in the English solution PDF (`originalAnswerImageEng`). Each English multiple-choice answer is kept only when its letter matches the Chinese key. Written questions (SQ/LQ, Paper 2) also have an English answer image, cropped from the Paper 2 section of the English solution. The blank ruled lines left for students to write on (答案線) are not part of the question and are removed from both the Chinese and English question images. `python3 econ-database/scripts/capture_from_pdf.py --sq-images` repeats that Paper 2 update.

HKDSE papers for 2012–2025 live in `PastPaper/` as one Chinese file and one English file per year. Each file contains the question papers, the marking scheme, and the markers’ comments. `python3 econ-database/scripts/capture_hkeaa.py` cuts question images, written-answer images, and the exam-report image for a question. A crop is kept only when its wording agrees with the Chinese plain text or the English question text already stored for that question. Multiple-choice answer keys are not cropped. Report images use the 報告 and 英報告 buttons.

2013 is skipped. Those two PDFs are scans, and OCR does not finish reliably, so the crops cannot be matched to the stored questions. The images still needed, and the filenames to use, are listed in `econ-database/HKEAA-2013-待補.md`.

## Adding another mock paper

1. Put three files in `MockTests/`: 卷一, 卷二, and 參考答案. Keep the same filename style as the papers already there.
2. Add the Chinese paper number to `PAPER_NUM` in the builder if it is not already listed.
3. Run `python3 econ-database/scripts/build_mock_questions.py`. New ids arrive with `reviewedByAI` `N`. Existing `Y` rows stay as they are.
4. Review every new `N` row using the steps above. Do not mark `Y` from the script alone.
5. Commit `database.json`, `vocabulary.json`, and the new docx files together. The builder refreshes `vocabulary.json` in the same run.
