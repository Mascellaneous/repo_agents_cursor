/**
 * Poe question-generation proxy for the econ-database site.
 *
 * The public site never sees the Poe API key and never sees who is allowed
 * to use the feature. Both live only in Script properties:
 *   POE_API_KEY
 *   ALLOWED_USERS and/or ALLOWED_USER_HASHES
 *
 * Least privilege (admin):
 * - Deploy the web app as "Execute as: Me" (the account that owns the key
 *   and can edit this spreadsheet). Confirm "Who has access: Anyone".
 *   The public site has no Google sign-in, so anonymous access is required.
 *   This script still refuses the Poe call unless the username is allowed.
 * - Do not put the key or the real allowlist in the sheet, this repo, or the page.
 * - urlFetchWhitelist in appsscript.json limits outbound calls to api.poe.com.
 * - UsageLog is created on first write. Protect that tab so casual editors
 *   cannot wipe the audit trail. The deploying account can still append.
 * - The spreadsheet may currently be shared with edit access. Narrow that
 *   share when you can. Visitors do not need sheet access; the web app
 *   writes the log as the deploying account.
 * - Prefer ALLOWED_USER_HASHES when other people can open Project Settings.
 *   The spreadsheet menu 出題代理 → 計算使用者名稱雜湊 shows only the hash.
 * - Script property changes apply immediately. Code changes need a new
 *   deployment version (Manage deployments → Edit → New version) so the
 *   existing /exec URL keeps working.
 * - Bind this project to the log spreadsheet (Extensions → Apps Script)
 *   or set SPREADSHEET_ID. Do not point LOG_SHEET_NAME at a data tab.
 */

var POE_CHAT_URL_ = 'https://api.poe.com/v1/chat/completions';
var POE_DEFAULT_MODEL_ = 'Claude-Sonnet-5.5';
var POE_INSTRUCTION_ = '參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。';
var POE_SYSTEM_PROMPT_ = '你是香港中學文憑試經濟科的出題助手。請只用繁體中文回答。題目必須是全新的，不可原句複製參考題。每題都要有問題與解釋；若問法有少許新意，請說明創新之處。';

function doGet() {
  var key = String(props_().getProperty('POE_API_KEY') || '').trim();
  return json_({
    ok: true,
    service: 'question-proxy',
    configured: key.length > 0
  });
}

function doPost(e) {
  try {
    return json_(handlePost_(e));
  } catch (err) {
    safeLog_(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

function handlePost_(e) {
  var body = parseBody_(e);
  var action = String(body.action || '');
  if (action === 'logLogin') return handleLogin_(body);
  if (action === 'checkAccess') return handleCheck_(body);
  if (action === 'generateQuestions') return handleGenerate_(body);
  return { ok: false, error: 'bad_request' };
}

function handleCheck_(body) {
  var username = normalizeUsername_(body.username);
  if (!username) return { ok: true, allowed: false };
  return { ok: true, allowed: isAllowed_(username) };
}

function handleLogin_(body) {
  var username = normalizeUsername_(body.username);
  if (!username) return { ok: false, error: 'bad_request' };
  if (shouldAudit_(username, 'login', 30 * 60)) {
    writeLog_({
      username: username,
      action: 'login',
      success: true,
      metadata: {}
    }, false);
  }
  return { ok: true };
}

function handleGenerate_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !isAllowed_(username)) {
    if (username && shouldAudit_(username, 'generate-denied', 60)) {
      writeLog_({
        username: username,
        action: 'generateQuestions',
        success: false,
        metadata: { error: 'denied' }
      }, false);
    }
    return { ok: false, error: 'feature_unavailable' };
  }

  var apiKey = String(props_().getProperty('POE_API_KEY') || '').trim();
  if (!apiKey) {
    writeLog_({
      username: username,
      action: 'generateQuestions',
      success: false,
      metadata: { error: 'proxy_not_configured' }
    }, true);
    return { ok: false, error: 'proxy_not_configured' };
  }

  try {
    getLogSheet_();
  } catch (err) {
    safeLog_(err);
    return { ok: false, error: 'server_error' };
  }

  var maxReferences = Math.min(positiveInt_(props_().getProperty('POE_MAX_REFERENCES'), 40), 80);
  var maxChars = Math.min(positiveInt_(props_().getProperty('POE_MAX_REFERENCE_CHARS'), 80000), 200000);
  var packed = packReferences_(body.questions, maxReferences, maxChars);
  if (!packed.questions.length) {
    return { ok: false, error: 'no_reference_questions' };
  }

  var filteredCount = clampInt_(body.filteredCount, packed.questions.length, 100000);
  if (filteredCount < packed.questions.length) filteredCount = packed.questions.length;

  var dailyLimit = nonNegativeInt_(props_().getProperty('POE_DAILY_LIMIT'), 40);
  if (dailyLimit > 0 && countTodayGenerations_(username) >= dailyLimit) {
    writeLog_({
      username: username,
      action: 'generateQuestions',
      success: false,
      metadata: { error: 'daily_limit' }
    }, true);
    return { ok: false, error: 'rate_limited' };
  }

  var intervalSeconds = nonNegativeInt_(props_().getProperty('POE_MIN_INTERVAL_SECONDS'), 20);
  if (!takeIntervalSlot_(username, intervalSeconds)) {
    return { ok: false, error: 'rate_limited' };
  }

  var model = String(props_().getProperty('POE_MODEL') || POE_DEFAULT_MODEL_).trim() || POE_DEFAULT_MODEL_;
  var started = Date.now();
  try {
    var completion = requestCompletion_(apiKey, model, buildPrompt_(packed.questions, filteredCount, packed.truncated));
    var durationMs = Date.now() - started;
    var result = {
      ok: true,
      content: completion.content,
      model: completion.model || model,
      sentCount: packed.questions.length,
      filteredCount: filteredCount,
      truncated: packed.truncated,
      logged: false,
      durationMs: durationMs
    };
    result.logged = writeLog_({
      username: username,
      action: 'generateQuestions',
      success: true,
      metadata: {
        model: result.model,
        sentCount: result.sentCount,
        filteredCount: filteredCount,
        truncated: packed.truncated,
        durationMs: durationMs,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens
      }
    }, true);
    return result;
  } catch (err) {
    releaseIntervalSlot_(username);
    var code = classifyFetchError_(err);
    safeLog_(err);
    writeLog_({
      username: username,
      action: 'generateQuestions',
      success: false,
      metadata: {
        error: code,
        model: model,
        sentCount: packed.questions.length,
        durationMs: Date.now() - started
      }
    }, true);
    return { ok: false, error: code };
  }
}

function buildPrompt_(questions, filteredCount, truncated) {
  var lines = [POE_INSTRUCTION_, ''];
  if (truncated || questions.length < filteredCount) {
    lines.push('（篩選結果共有 ' + filteredCount + ' 題，以下只附上 ' + questions.length + ' 題作為風格、用字與句式的參考。）');
    lines.push('');
  }
  lines.push('以下為參考題目。請撰寫全新題目，不要逐句抄寫參考題。');
  lines.push('');
  questions.forEach(function (q, index) {
    lines.push('【參考 ' + (index + 1) + '】');
    if (q.id) lines.push('編號：' + q.id);
    if (q.examination) lines.push('考試：' + q.examination);
    if (q.year) lines.push('年份：' + q.year);
    if (q.questionType) lines.push('題型：' + q.questionType);
    if (q.concepts) lines.push('概念：' + q.concepts);
    lines.push('題目：');
    lines.push(q.question);
    lines.push('解釋：');
    lines.push(q.explanation || '（沒有解釋）');
    lines.push('');
  });
  return lines.join('\n');
}

function requestCompletion_(apiKey, model, userPrompt) {
  var payload = {
    model: model,
    messages: [
      { role: 'system', content: POE_SYSTEM_PROMPT_ },
      { role: 'user', content: userPrompt }
    ]
  };
  var maxTokens = optionalNumber_('POE_MAX_TOKENS');
  var temperature = optionalNumber_('POE_TEMPERATURE');
  if (maxTokens != null && maxTokens > 0) payload.max_tokens = Math.round(maxTokens);
  if (temperature != null) payload.temperature = temperature;

  var response = UrlFetchApp.fetch(POE_CHAT_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var raw = response.getContentText() || '';
  if (status < 200 || status >= 300) {
    var httpError = new Error('upstream_http_' + status);
    httpError.code = status === 408 || status === 504 ? 'upstream_timeout' : 'upstream_error';
    throw httpError;
  }
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    var parseError = new Error('upstream_parse');
    parseError.code = 'upstream_error';
    throw parseError;
  }
  var content = messageText_(parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message);
  if (!content) {
    var emptyError = new Error('upstream_empty');
    emptyError.code = 'upstream_error';
    throw emptyError;
  }
  var usage = parsed.usage || {};
  return {
    content: content,
    model: parsed.model || model,
    promptTokens: numberOrNull_(usage.prompt_tokens),
    completionTokens: numberOrNull_(usage.completion_tokens)
  };
}

function messageText_(message) {
  if (!message) return '';
  var content = message.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(function (part) {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    }).join('').trim();
  }
  return '';
}

function packReferences_(raw, maxCount, maxChars) {
  var questions = [];
  var used = 0;
  var truncated = false;
  if (!Array.isArray(raw)) return { questions: questions, truncated: false };
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item || typeof item !== 'object') continue;
    var question = clip_(item.question, 6000);
    if (!question) continue;
    if (questions.length >= maxCount) {
      truncated = true;
      break;
    }
    var entry = {
      id: clip_(item.id, 80),
      examination: clip_(item.examination, 40),
      year: clip_(item.year, 20),
      questionType: clip_(item.questionType, 40),
      concepts: clip_(item.concepts, 300),
      question: question,
      explanation: clip_(item.explanation, 6000)
    };
    var weight = entry.question.length + entry.explanation.length;
    if (questions.length > 0 && used + weight > maxChars) {
      truncated = true;
      break;
    }
    questions.push(entry);
    used += weight;
  }
  return { questions: questions, truncated: truncated };
}

function isAllowed_(username) {
  var digest = sha256Hex_(username);
  var allowed = {};
  parseList_(props_().getProperty('ALLOWED_USER_HASHES')).forEach(function (hash) {
    var normalized = String(hash || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(normalized)) allowed[normalized] = true;
  });
  parseList_(props_().getProperty('ALLOWED_USERS')).forEach(function (name) {
    var normalized = normalizeUsername_(name);
    if (normalized) allowed[sha256Hex_(normalized)] = true;
  });
  return allowed[digest] === true;
}

function countTodayGenerations_(username) {
  try {
    var sheet = getLogSheet_();
    var last = sheet.getLastRow();
    if (last < 2) return 0;
    var height = Math.min(last - 1, 2000);
    var start = last - height + 1;
    var values = sheet.getRange(start, 1, height, 4).getValues();
    var today = startOfToday_().getTime();
    var count = 0;
    for (var i = 0; i < values.length; i++) {
      var ts = values[i][0];
      var user = normalizeUsername_(values[i][1]);
      var action = String(values[i][2] || '');
      var success = String(values[i][3] || '');
      if (user !== username || action !== 'generateQuestions' || success !== 'success') continue;
      if (ts instanceof Date && ts.getTime() >= today) count++;
    }
    return count;
  } catch (err) {
    safeLog_(err);
    return 0;
  }
}

function takeIntervalSlot_(username, seconds) {
  if (!seconds) return true;
  var cache = CacheService.getScriptCache();
  var key = 'poe_iv_' + sha256Hex_(username).slice(0, 32);
  if (cache.get(key)) return false;
  cache.put(key, '1', Math.min(seconds, 21600));
  return true;
}

function releaseIntervalSlot_(username) {
  try {
    CacheService.getScriptCache().remove('poe_iv_' + sha256Hex_(username).slice(0, 32));
  } catch (err) {
    safeLog_(err);
  }
}

function shouldAudit_(username, action, seconds) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'poe_au_' + sha256Hex_(action + '\n' + username).slice(0, 32);
    if (cache.get(key)) return false;
    cache.put(key, '1', Math.min(seconds, 21600));
    return true;
  } catch (err) {
    return true;
  }
}

function writeLog_(entry, priority) {
  try {
    if (!priority && !allowLowPriorityLog_()) return false;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return false;
    try {
      var sheet = getLogSheet_();
      var metadata = entry.metadata || {};
      var encoded = JSON.stringify(metadata);
      if (encoded.length > 500) encoded = encoded.slice(0, 500);
      sheet.appendRow([
        new Date(),
        entry.username,
        entry.action,
        entry.success ? 'success' : 'fail',
        encoded
      ]);
      return true;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    safeLog_(err);
    return false;
  }
}

function allowLowPriorityLog_() {
  try {
    var cache = CacheService.getScriptCache();
    var current = Number(cache.get('poe_log_bucket') || '0');
    if (current >= 60) return false;
    cache.put('poe_log_bucket', String(current + 1), 60);
    return true;
  } catch (err) {
    return true;
  }
}

function getLogSheet_() {
  var ss = getSpreadsheet_();
  var name = clip_(props_().getProperty('LOG_SHEET_NAME') || 'UsageLog', 80) || 'UsageLog';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'username', 'action', 'success', 'metadata']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSpreadsheet_() {
  var id = String(props_().getProperty('SPREADSHEET_ID') || '').trim();
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('no_spreadsheet');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('出題代理')
    .addItem('計算使用者名稱雜湊', 'promptUsernameHash')
    .addToUi();
}

function promptUsernameHash() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    '計算雜湊',
    '輸入一個使用者名稱。程式會去掉首尾空白並轉成小寫，然後只顯示雜湊。',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var username = normalizeUsername_(response.getResponseText());
  if (!username) {
    ui.alert('請輸入使用者名稱');
    return;
  }
  ui.alert('SHA-256', sha256Hex_(username), ui.ButtonSet.OK);
}

function selfTestPromptShape() {
  var sample = packReferences_([
    { id: 'SAMPLE-1', question: '測試題幹', explanation: '測試解釋', questionType: 'MC', concepts: '機會成本' }
  ], 5, 80000);
  var built = buildPrompt_(sample.questions, 1, false);
  if (built.indexOf(POE_INSTRUCTION_) !== 0) throw new Error('instruction_mismatch');
  if (built.indexOf('測試題幹') === -1) throw new Error('missing_reference');
  isAllowed_('sample_user');
  console.log('selfTestPromptShape ok');
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function parseBody_(e) {
  if (!e) return {};
  var raw = '';
  if (e.postData && e.postData.contents) raw = e.postData.contents;
  if (!raw && e.parameter && e.parameter.payload) raw = e.parameter.payload;
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function parseList_(value) {
  return String(value || '')
    .split(/[,;\n\r]+/)
    .map(function (part) { return String(part || '').trim(); })
    .filter(Boolean);
}

function normalizeUsername_(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    var hex = value.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function clip_(value, max) {
  return String(value == null ? '' : value).replace(/\s+$/g, '').trim().slice(0, max);
}

function positiveInt_(value, fallback) {
  var number = Number(value);
  if (!isFinite(number) || number <= 0) return fallback;
  return Math.round(number);
}

function nonNegativeInt_(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  var number = Number(value);
  if (!isFinite(number) || number < 0) return fallback;
  return Math.round(number);
}

function clampInt_(value, fallback, max) {
  var number = Number(value);
  if (!isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.round(number), max);
}

function optionalNumber_(name) {
  var raw = props_().getProperty(name);
  if (raw == null || String(raw).trim() === '') return null;
  var number = Number(raw);
  return isFinite(number) ? number : null;
}

function numberOrNull_(value) {
  var number = Number(value);
  return isFinite(number) ? number : null;
}

function startOfToday_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Hong_Kong';
  var day = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return Utilities.parseDate(day + ' 00:00:00', tz, 'yyyy-MM-dd HH:mm:ss');
}

function classifyFetchError_(err) {
  if (err && err.code === 'upstream_timeout') return 'upstream_timeout';
  if (err && err.code === 'upstream_error') return 'upstream_error';
  var msg = String(err && err.message || err || '').toLowerCase();
  if (msg.indexOf('timeout') !== -1 || msg.indexOf('timed out') !== -1) return 'upstream_timeout';
  return 'upstream_error';
}

function safeLog_(err) {
  var msg = String(err && err.stack || err && err.message || err || '');
  var key = String(props_().getProperty('POE_API_KEY') || '').trim();
  if (key && msg.indexOf(key) !== -1) msg = msg.split(key).join('[redacted]');
  console.error(msg.slice(0, 1000));
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
