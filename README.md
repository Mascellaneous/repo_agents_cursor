# Mock-paper question bank: notes for a future agent

This repository holds Aristo HKDSE Economics mock papers and the `econ-database` app that browses them. The app loads `econ-database/data/questions.json`. It does not fetch Google Sheets.

## What the Python script is for

`econ-database/scripts/build_mock_questions.py` is only the first import. It reads every `.docx` in `MockTests/`, splits Paper 1 and Paper 2 into questions, guesses a chapter (`topic`), specific concepts, and question patterns, and writes `econ-database/data/questions.json`.

That parse is rough. Word files repeat text boxes, glue diagram labels into the stem, and sometimes split one question into two. Do not treat the script output as finished.

## Fields a reviewer must keep

Each question object includes:

- `id`: stable key, `M{paper}-P{1|2}-Q{nn}`, for example `M35-P1-Q01`. Paper numbers are 35–44 today.
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

## Adding another mock paper

1. Put three files in `MockTests/`: 卷一, 卷二, and 參考答案. Keep the same filename style as the papers already there.
2. Add the Chinese paper number to `PAPER_NUM` in the builder if it is not already listed.
3. Run `python3 econ-database/scripts/build_mock_questions.py`. New ids arrive with `reviewedByAI` `N`. Existing `Y` rows stay as they are.
4. Review every new `N` row using the steps above. Do not mark `Y` from the script alone.
5. Commit `questions.json` and the new docx files together.
