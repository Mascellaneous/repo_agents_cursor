# Stem patterns review notes

Notes from merging `classify_chunks/out_01.json`–`out_08.json` into the DB (empty slots only; Excel/auto values preserved).

## Abstraction style

Good `stemPatterns` describe **question shape**, not the concrete story:

- Replace proper names / firms / goods with `(某人)`, `(某事件)`, `(某物品)`, `(某市場)`, `(某廠商)`, etc.
- Keep the **ask** (哪項正確、影響、計算、推斷彈性…) and the structural cue (供需圖、表格、AS-AD、填空).
- Prefer one template that covers many near-duplicates over copying the full stem.

Examples that work well:

- `(經濟數據) 根據上述資料/數據，可得出的結論是`
- `以下／下列哪項會增加／減低（某事件）的機會成本？`
- `沒有稀少性，___________。`

Weaker inventions tend to list topic keywords or part labels without a reusable ask, e.g. `(AS-AD圖) 通脹差距、緊縮政策、政策比較、SRAS政策` or `(a)… (b)…` essay outlines. Prefer collapsing those into a single abstract ask when possible.

## Slash alternatives (`／` / `/`)

Use slash to encode **option families** that share one stem shape:

- 增加／減低、正確／不正確、直接稅／間接稅、需求／供應、通脹／通縮
- Mixed fullwidth `／` and ASCII `/` appear in legacy vocab; prefer `／` for Chinese templates going forward, but do not mass-rename existing Excel strings unless consolidating deliberately.

## Blanks and placeholders

- Fill-in stems: keep blanks as `___________` / `____________` (length need not be exact).
- Parenthetical slots `(某…)` mark variable scene content; do not put format tags there.
- Diagram/table stems often lead with a type cue: `(供需圖)`, `(供需表)`, `圖片：…`, `所有投入轉變：總產出總成本表格`.

## Difference from `patterns`

| Field | Means | Examples |
| --- | --- | --- |
| `patterns` | Format / presentation tags | 填空、複選組合、圖表題 |
| `stemPatterns` | Abstract stem template (question shape) | `XXX意味着稀少性。`, `(某人進行了某些行為) 需要向香港政府繳交哪些稅項？` |

Do **not** put format tags or lone concept names (`機會成本`) in `stemPatterns`. Concepts stay in `concepts`; chapter in `topic`.

## When to invent a new pattern

1. Prefer an **exact** string from the current vocab when the ask + structure match.
2. Invent **one** new template only if no existing shape fits—same abstraction style as above.
3. Do not invent for empty stems / missing OCR text; leave `[]` (85 DSE P2 rows still empty after merge: no Chi/Eng text).
4. After inventing, the merge rebuilds vocab as the sorted unique nonempty set across the whole DB—new strings become part of the shared list automatically.

## Spot-check (post-merge, preserved nonempty)

| Id | `stemPatterns` |
| --- | --- |
| DSE-2026-P1-01 | `沒有稀少性，___________。` |
| DSE-PP-P1-01 | `沒有稀少性，___________。` |
| DSE-2023-P1-35 | `(某人進行了某些行為) 需要向香港政府繳交哪些稅項？` |

These were already filled (Excel/auto) and were correctly **not** overwritten by chunk outs.

## Merge snapshot

- Applied from outs: **1469**
- Still empty: **85** (no question text to fallback-fill)
- Unique `stemPatterns`: **1265** (includes ~1187 newly invented vs pre-merge vocab of 78)
- Highest-frequency templates remain the classic Excel ones (data-conclusion, market equilibrium shift, bank deposits/M1–M3, opportunity cost, AS-AD effects).
