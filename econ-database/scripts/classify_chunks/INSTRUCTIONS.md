# Stem pattern classification instructions

Classify each question in the assigned `chunk_XX.jsonl` file. Use `vocab.json` as the primary stemPattern vocabulary.

## Goal

For every question with a non-empty `stem`, assign one abstract **stemPattern** that captures the question shape (not the format tag, not the concept name alone).

## Rules

1. **Prefer an exact string from `vocab.json`** when the stem is the same abstract question shape as an existing template.
2. **If none fit**, invent **ONE** new stemPattern in the same style as vocab:
   - Abstract placeholders such as `(某人)` / `(某事件)`
   - Blanks as `___________`
   - Slash alternatives as `／`
3. **Do NOT** use format tags like `填空` / `複選組合` — those belong in the `patterns` field, not `stemPatterns`.
4. **Do NOT** use concept names alone as stemPatterns (e.g. do not output just `機會成本`).
5. **Output JSON only**, shaped as:
   ```json
   {"ID": ["stemPattern"], ...}
   ```
   - One pattern per question unless the stem truly mixes multiple distinct stem shapes.
6. **Skip only if `stem` is empty**; otherwise always assign a pattern.

## Input fields (per JSONL line)

`id`, `publisher`, `year`, `paper`, `questionNumber`, `chapter`, `curriculum`, `concepts`, `patterns`, `stem`

Use `stem` as the main signal; `concepts` / `patterns` / chapter metadata are context only.

## Output

Return a single JSON object mapping question `id` → array of stemPattern strings. No markdown, no commentary.
