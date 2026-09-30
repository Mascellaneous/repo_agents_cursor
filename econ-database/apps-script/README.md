# AI question proxy (admin setup)

The site button **AI出題** is hidden until `checkAccess` allows the signed-in user. It sends the currently filtered questions, plus the edited 出題指示, to this Apps Script web app. The script calls the upstream question API and appends a row to the spreadsheet. The browser never receives the API key, and the public repository does not contain the allowlist.

Question data still loads from `econ-database/data/database.json`. This proxy is only for generation and the usage log.

`Code.gs` in this repository is the source of truth. If the copy already deployed in Apps Script has drifted, replace it with this file and **redeploy** (section 4). Property-only edits apply immediately. Code changes, including the editable 出題指示, do not: an old deployment ignores the client `instruction` field until you deploy a new version.

## Security model

- `POE_API_KEY` and the allowlist live only in **Apps Script → Project Settings → Script properties**.
- The page calls `POST` on the web app URL. It does not call the upstream API host directly.
- `checkAccess` returns `{ "ok": true, "allowed": true|false }`. A refusal looks the same for every username that is not allowed. The page then leaves the button hidden. Do not show a disabled button in its place.
- `generateQuestions` checks the allowlist before it reads the API key or calls upstream. A refused call does not reveal who is allowed.
- The model id is `POE_MODEL` on the server. The browser cannot choose a model.
- `appsscript.json` limits `UrlFetchApp` to `https://api.poe.com/`.
- Do not commit real usernames, hashes of real usernames, or the API key. Examples below use placeholders such as `user_a` and an obviously fake hash. Never paste a production hash into git.

## 1. Open the spreadsheet

Use the spreadsheet that should store the log:

https://docs.google.com/spreadsheets/d/1b_Z5jVXh_P0t97CuQoMRUg5u0saCuGawbEcgb12hfgI/edit

**Extensions → Apps Script**. If a bound project already exists, paste into that project. Binding the project lets the script use the active spreadsheet without `SPREADSHEET_ID`.

Set the Apps Script timezone and the spreadsheet timezone to `Asia/Hong_Kong` so daily limits match the log timestamps.

## 2. Paste the project

- Replace the default `Code.gs` with `econ-database/apps-script/Code.gs` from this repo.
- **Project Settings → tick “Show appsscript.json”**, then replace that file with `econ-database/apps-script/appsscript.json`.
- Save, then reload the spreadsheet so the **出題代理** menu appears.

After every pull, compare the deployed script with this repo. If they differ, paste the repo file again and redeploy a new version (section 4). Do not keep a private fork of `Code.gs` as the source of truth.

You can ignore the editor’s run dropdown until the properties below exist. `selfTestPromptShape` checks that an empty client instruction still starts the prompt with the built-in sentence, and that a non-empty instruction replaces it after the length cap. It does not call the upstream API.

## 3. Script properties

**Project Settings → Script properties**. Names must match. Values are not in git.

Production allowlist is **only** `ALLOWED_USER_HASHES`. Do not store plaintext usernames in the production project.

### Allowlist (production): hashes only

1. Open the bound spreadsheet linked above.
2. Reload the spreadsheet after `Code.gs` is saved so **出題代理** is on the menu bar.
3. Choose **出題代理 → 計算使用者名稱雜湊**.
4. For each person, paste the username into that dialog. Do this privately. The dialog does not write the name into the sheet or into the repo. It lowercases and trims the name, then shows only the SHA-256 hex.
5. Copy that hex into Script property `ALLOWED_USER_HASHES`. Separate hashes with commas or newlines. Repeat for each person.
6. Leave `ALLOWED_USERS` unset. If it is already set on the production project, delete it after the hashes are in place. Otherwise those plaintext names remain in Project Settings and still grant access.

`ALLOWED_USERS` (comma-separated plaintext names) still works in the script for a local or development project. Do not use it in production, and do not commit names or their real hashes.

If `ALLOWED_USER_HASHES` is empty and `ALLOWED_USERS` is empty, nobody is allowed. `checkAccess` does not say which property matched.

A hash is 64 hex characters. This is a fake shape only — do not paste it into Script properties:

```
0000000000000000000000000000000000000000000000000000000000000000
```

To check the menu output on your own machine, hash a placeholder name and do not commit the result:

```bash
printf '%s' 'user_a' | shasum -a 256
```

Changing properties does **not** require a new deployment. Changing `Code.gs` does.

| Property | Required | Placeholder / default |
| --- | --- | --- |
| `POE_API_KEY` | yes | key from the upstream API key page |
| `ALLOWED_USER_HASHES` | yes in production | SHA-256 hex list from the menu above. Comma or newline separated. |
| `ALLOWED_USERS` | no; legacy/dev only | `user_a,user_b,user_c`. Leave empty in production. |
| `POE_MODEL` | no | `Claude-Sonnet-5.5` (the script default when this property is empty) |
| `POE_MAX_REFERENCES` | no | `40` (hard cap 80) |
| `POE_MAX_REFERENCE_CHARS` | no | `80000` |
| `POE_MIN_INTERVAL_SECONDS` | no | `20` (`0` disables the cooldown) |
| `POE_DAILY_LIMIT` | no | `40` successful generations per username per day (`0` disables) |
| `POE_MAX_TOKENS` | no | empty; a low value cuts long answers short |
| `POE_TEMPERATURE` | no | empty |
| `SPREADSHEET_ID` | only if the script is not bound | the id in the sheet URL |
| `LOG_SHEET_NAME` | no | `UsageLog` |

Usernames are trimmed and lowercased before the hash check. The site already stores the signed-in name that way.

## 4. Deploy the web app

**Deploy → New deployment → Select type: Web app**.

- Execute as: **Me** (the account that owns the key and can edit the sheet).
- Who has access: **Anyone**.

Copy the URL that ends in `/exec`.

The first deployment asks you to authorize Sheets and external requests. Approve that as the deploying account.

When you later edit the script, including after pulling a new `Code.gs`: **Deploy → Manage deployments → Edit → Version: New version → Deploy**. Keep the same `/exec` URL. The editable 出題指示 is ignored by a deployment that still runs an older script.

## 5. Point the site at the web app

In `econ-database/js/config.js`, set `POE_PROXY_WEB_APP_URL` to that `/exec` URL. It is not a secret. The key stays in Script properties.

Reload the site and sign in. People whose username hash is listed see **AI出題** next to **複製篩選題目**. Everyone else does not see the button, and a failed check does not say why.

Opening the `/exec` URL in a browser should return JSON like `{ "ok": true, "service": "question-proxy", "configured": true }`. `configured` only means a key is present. It does not list users.

## What gets logged

The script creates a tab named `UsageLog` (or `LOG_SHEET_NAME`) with:

`timestamp | username | action | success | metadata`

- `login` — once per username about every 30 minutes, after someone signs in on the site.
- `generateQuestions` — success or failure, with model, counts, duration, and the length of the 出題指示 (`instructionChars`, plus `instructionProvidedChars` for the raw client length). The instruction text and the question text are not written to the sheet.

Protect the `UsageLog` tab (**Data → Protect sheets and ranges**) so casual editors cannot clear it. The web app still appends rows because it runs as the deploying account.

The sheet is the audit log, so usernames of people who sign in or generate questions will appear there. That is outside the public git repo. Narrow the spreadsheet’s share list when you can; site visitors do not need edit access.

Login and denied-generation rows are deduped so a public `/exec` URL cannot fill the tab as quickly. Successful generations are always logged.

## How a generation is built

The user message starts with the 出題指示, then the filtered questions (stem plus Chinese explanation).

The modal shows this default instruction and lets the signed-in user edit it before generating. The last edit is kept in that browser’s `localStorage`. **回復預設** restores the sentence below. The request field is `instruction`. The script keeps a client instruction only when it is a non-empty string after trimming and control-character stripping, and it caps the length at 4000 characters. An empty or missing instruction uses the server default:

> 參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。

The browser may send up to 60 questions. The script then applies `POE_MAX_REFERENCES` and `POE_MAX_REFERENCE_CHARS`. The upstream call is `POST https://api.poe.com/v1/chat/completions`. The full reply is returned to the modal (Apps Script does not stream the body back to the browser). The modal keeps past replies in IndexedDB on that browser, keyed by the signed-in username and time, and falls back to `localStorage` if IndexedDB is unavailable.

## Local pages

`file://` pages often cannot `fetch` the web app because the origin is `null`. Use the hosted site (or any `http`/`https` origin) when you try the button.
