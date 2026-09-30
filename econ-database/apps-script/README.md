# Poe question proxy (admin setup)

The site button **根據篩選題目連接 poe API 出題** sends the currently filtered questions to this Apps Script web app. The script calls Poe and appends a row to the spreadsheet. The browser never receives the Poe API key, and the public repository does not contain the allowlist.

Question data still loads from `econ-database/data/database.json`. This proxy is only for generation and the usage log.

## Security model

- `POE_API_KEY` and the allowed usernames live only in **Apps Script → Project Settings → Script properties**.
- The page calls `POST` on the web app URL. It does not call `api.poe.com`.
- `checkAccess` returns `{ "ok": true, "allowed": true|false }`. A refusal looks the same for every username that is not allowed. The page then leaves the button hidden.
- `generateQuestions` checks the allowlist before it reads the API key or calls Poe. A refused call does not reveal who is allowed.
- The model id is `POE_MODEL` on the server. The browser cannot choose a model.
- `appsscript.json` limits `UrlFetchApp` to `https://api.poe.com/`.
- Do not commit real usernames, hashes of real usernames, or the API key. `script.properties.example` uses placeholders such as `user_a`.

## 1. Open the spreadsheet

Use the spreadsheet that should store the log:

https://docs.google.com/spreadsheets/d/1b_Z5jVXh_P0t97CuQoMRUg5u0saCuGawbEcgb12hfgI/edit

**Extensions → Apps Script**. If a bound project already exists, paste into that project. Binding the project lets the script use the active spreadsheet without `SPREADSHEET_ID`.

Set the Apps Script timezone and the spreadsheet timezone to `Asia/Hong_Kong` so daily limits match the log timestamps.

## 2. Paste the project

- Replace the default `Code.gs` with `econ-database/apps-script/Code.gs`.
- **Project Settings → tick “Show appsscript.json”**, then replace that file with `econ-database/apps-script/appsscript.json`.
- Save.

You can ignore the editor’s run dropdown until the properties below exist. `selfTestPromptShape` checks that the built-in instruction is still the first line of the prompt. It does not call Poe.

## 3. Script properties

**Project Settings → Script properties**. Names must match. Values are not in git.

| Property | Required | Placeholder / default |
| --- | --- | --- |
| `POE_API_KEY` | yes | key from https://poe.com/api/keys |
| `ALLOWED_USERS` | one of the two allowlist properties | `user_a,user_b,user_c` |
| `ALLOWED_USER_HASHES` | one of the two allowlist properties | SHA-256 hex list, see below |
| `POE_MODEL` | no | `Claude-Sonnet-4.6` (also valid: `GPT-5.4`) |
| `POE_MAX_REFERENCES` | no | `40` (hard cap 80) |
| `POE_MAX_REFERENCE_CHARS` | no | `80000` |
| `POE_MIN_INTERVAL_SECONDS` | no | `20` (`0` disables the cooldown) |
| `POE_DAILY_LIMIT` | no | `40` successful generations per username per day (`0` disables) |
| `POE_MAX_TOKENS` | no | empty; a low value cuts long answers short |
| `POE_TEMPERATURE` | no | empty |
| `SPREADSHEET_ID` | only if the script is not bound | the id in the sheet URL |
| `LOG_SHEET_NAME` | no | `UsageLog` |

Usernames are trimmed and lowercased before the check. The site already stores the signed-in name that way.

Prefer `ALLOWED_USER_HASHES` when other people can open Project Settings. In the spreadsheet, reload after the first save so the menu appears, then use **出題代理 → 計算使用者名稱雜湊**. The dialog shows only the hash. Or, on your own machine:

```bash
printf '%s' 'user_a' | shasum -a 256
```

Put the hex digests in `ALLOWED_USER_HASHES`, separated by commas. You can set either property or both. If both are empty, nobody is allowed.

Changing properties does **not** require a new deployment. Changing `Code.gs` does.

## 4. Deploy the web app

**Deploy → New deployment → Select type: Web app**.

- Execute as: **Me** (the account that owns the key and can edit the sheet).
- Who has access: **Anyone**.

Copy the URL that ends in `/exec`.

The first deployment asks you to authorize Sheets and external requests. Approve that as the deploying account.

When you later edit the script: **Deploy → Manage deployments → Edit → Version: New version → Deploy**. Keep the same `/exec` URL.

## 5. Point the site at the web app

In `econ-database/js/config.js`, set `POE_PROXY_WEB_APP_URL` to that `/exec` URL. It is not a secret. The key stays in Script properties.

Reload the site and sign in. People listed in the allowlist see **根據篩選題目連接 poe API 出題** next to **複製篩選題目**. Everyone else does not see the button, and a failed check does not say why.

Opening the `/exec` URL in a browser should return JSON like `{ "ok": true, "service": "question-proxy", "configured": true }`. `configured` only means a key is present. It does not list users.

## What gets logged

The script creates a tab named `UsageLog` (or `LOG_SHEET_NAME`) with:

`timestamp | username | action | success | metadata`

- `login` — once per username about every 30 minutes, after someone signs in on the site.
- `generateQuestions` — success or failure, with model, counts, and duration. Question text is not written to the sheet.

Protect the `UsageLog` tab (**Data → Protect sheets and ranges**) so casual editors cannot clear it. The web app still appends rows because it runs as the deploying account.

The sheet is the audit log, so usernames of people who sign in or generate questions will appear there. That is outside the public git repo. Narrow the spreadsheet’s share list when you can; site visitors do not need edit access.

Login and denied-generation rows are deduped so a public `/exec` URL cannot fill the tab as quickly. Successful generations are always logged.

## How a generation is built

The user message starts with this instruction, then the filtered questions (stem plus Chinese explanation):

> 參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。

The browser may send up to 60 questions. The script then applies `POE_MAX_REFERENCES` and `POE_MAX_REFERENCE_CHARS`. Poe is called at `POST https://api.poe.com/v1/chat/completions`. The full reply is returned to the modal (Apps Script does not stream the body back to the browser). The modal keeps past replies in IndexedDB on that browser, keyed by the signed-in username and time, and falls back to `localStorage` if IndexedDB is unavailable.

## Local pages

`file://` pages often cannot `fetch` the web app because the origin is `null`. Use the hosted site (or any `http`/`https` origin) when you try the button.
