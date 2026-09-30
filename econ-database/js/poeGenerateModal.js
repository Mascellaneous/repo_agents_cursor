// poeGenerateModal.js
// Modal for generating new questions from the current filters.
// The browser only talks to the Apps Script web app in config.js.
// The Poe key and the allowlist stay in Apps Script properties.

(function () {
    // Keep this sentence identical to POE_INSTRUCTION_ in apps-script/Code.gs.
    // It is shown in the modal. The server rebuilds the real request.
    var POE_INSTRUCTION = '參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。';
    var CLIENT_SEND_CAP = 60;
    var LOCAL_KEY = 'econ_poe_generations_v1';
    var HISTORY_LIMIT = 30;
    var ERROR_TEXT = {
        feature_unavailable: '此功能暫不可用。',
        proxy_not_configured: '出題服務尚未完成設定。',
        no_reference_questions: '沒有可送出的參考題目。請先篩選出含題幹的題目。',
        missing_references: '找不到當時的參考題。請改用「根據目前篩選出題」。',
        rate_limited: '出題次數暫時達到上限，請稍後再試。',
        upstream_error: '出題服務暫時未能回應，請再試一次。',
        upstream_timeout: '出題時間過長而被中斷。可以縮小篩選範圍後再試。',
        bad_request: '無法送出這次請求。',
        server_error: '出題服務發生錯誤，請再試一次。',
        network: '無法連線到出題服務。',
        save_failed: '題目已產生，但未能寫入這部瀏覽器。'
    };

    var poeUi = {
        overlay: null,
        busy: false,
        control: null,
        timer: null,
        startedAt: 0,
        records: [],
        activeRecord: null,
        filteredCount: 0,
        counting: false,
        trigger: null,
        db: null,
        storeMode: null
    };

    function proxyUrl() {
        if (typeof CONFIG === 'undefined' || !CONFIG.POE_PROXY_WEB_APP_URL) return '';
        return String(CONFIG.POE_PROXY_WEB_APP_URL).trim();
    }

    function currentUsername() {
        if (!window.authManager || !window.authManager.currentUser) return '';
        return String(window.authManager.currentUser).trim().toLowerCase();
    }

    function beginRequest(timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        return {
            signal: controller.signal,
            cancel: function () { controller.abort(); },
            clear: function () { clearTimeout(timer); }
        };
    }

    function parseProxyJson(text) {
        var cleaned = String(text || '').replace(/^\uFEFF/, '').replace(/^\)\]\}',?\n/, '');
        return JSON.parse(cleaned);
    }

    async function proxyRequest(payload, timeoutMs, control) {
        var url = proxyUrl();
        if (!url) {
            var missing = new Error('network');
            missing.code = 'network';
            throw missing;
        }
        var handle = beginRequest(timeoutMs);
        if (control) control.handle = handle;
        try {
            var response = await fetch(url, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload),
                signal: handle.signal
            });
            var text = await response.text();
            try {
                return parseProxyJson(text);
            } catch (error) {
                var invalid = new Error('network');
                invalid.code = 'network';
                throw invalid;
            }
        } catch (error) {
            if (error && error.name === 'AbortError') {
                var aborted = new Error('aborted');
                aborted.code = control && control.cancelled ? 'cancelled' : 'upstream_timeout';
                throw aborted;
            }
            if (error && error.code) throw error;
            var network = new Error('network');
            network.code = 'network';
            throw network;
        } finally {
            handle.clear();
        }
    }

    async function poeCheckAccess() {
        var username = currentUsername();
        if (!username || !proxyUrl()) return false;
        try {
            var data = await proxyRequest({ action: 'checkAccess', username: username }, 20000, null);
            return !!(data && data.ok === true && data.allowed === true);
        } catch (error) {
            return false;
        }
    }

    function hideGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (button) button.hidden = true;
    }

    function showGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (button) button.hidden = false;
    }

    async function refreshPoeGenerateAccess() {
        hideGenerateButton();
        var allowed = await poeCheckAccess();
        if (allowed) showGenerateButton();
    }

    function logQuestionToolLogin() {
        var username = currentUsername();
        if (!username || !proxyUrl()) return;
        var key = 'econ_proxy_login_logged:' + username;
        try {
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, '1');
        } catch (error) {
            // Continue. The server also dedupes login rows.
        }
        proxyRequest({ action: 'logLogin', username: username }, 15000, null).catch(function () {
            try { sessionStorage.removeItem(key); } catch (error) {}
        });
    }

    function initPoeGenerateFeature() {
        bindGenerateButton();
        refreshPoeGenerateAccess();
    }

    function bindGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (!button || button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', function () {
            openPoeGenerateModal();
        });
    }

    function explanationText(question) {
        var letter = question.answerMC && question.answerMC !== '-' ? String(question.answerMC).trim() : '';
        var written = question.answerChi && question.answerChi !== '-' ? String(question.answerChi).trim() : '';
        if (letter && written) {
            return written.indexOf(letter) !== -1 ? written : letter + '\n' + written;
        }
        return letter || written || '';
    }

    function toReference(question) {
        var concepts = Array.isArray(question.concepts)
            ? question.concepts.map(function (item) { return String(item || '').trim(); }).filter(Boolean).join('、')
            : '';
        return {
            id: question.id || '',
            examination: question.examination || '',
            year: question.year == null ? '' : String(question.year),
            questionType: question.questionType || '',
            concepts: concepts,
            question: String(question.plainText || question.questionTextChi || '').trim(),
            explanation: explanationText(question)
        };
    }

    function currentFilters() {
        var searchEl = document.getElementById('search');
        return {
            search: searchEl ? searchEl.value : '',
            searchScope: window.searchScope || 'all',
            triState: typeof triStateFilters !== 'undefined' ? triStateFilters : {},
            percentageFilter: window.percentageFilter,
            marksFilter: window.marksFilter,
            questionNumberFilter: window.questionNumberFilter
        };
    }

    async function loadFilteredQuestions() {
        if (!window.storage || typeof window.storage.getQuestions !== 'function') return [];
        var questions = await window.storage.getQuestions(currentFilters());
        var sortSelect = document.getElementById('sort-order');
        var sortBy = sortSelect ? sortSelect.value : 'default';
        if (typeof sortQuestions === 'function') questions = sortQuestions(questions, sortBy);
        return questions.filter(function (question) {
            return String(question.plainText || question.questionTextChi || '').trim().length > 0;
        });
    }

    async function questionsByIds(ids) {
        if (!window.storage || typeof window.storage.getQuestions !== 'function') return [];
        var questions = await window.storage.getQuestions({ triState: {} });
        var byId = {};
        questions.forEach(function (question) {
            if (question && question.id) byId[question.id] = question;
        });
        return ids.map(function (id) { return byId[id]; }).filter(function (question) {
            return question && String(question.plainText || question.questionTextChi || '').trim();
        });
    }

    function filterSummary(count) {
        var searchEl = document.getElementById('search');
        var search = searchEl ? String(searchEl.value || '').trim() : '';
        if (search) {
            var clipped = search.length > 40 ? search.slice(0, 40) + '…' : search;
            return '篩選 ' + count + ' 題，搜尋「' + clipped + '」';
        }
        return '篩選 ' + count + ' 題';
    }

    function leadForCount(count) {
        if (!count) return '沒有符合篩選條件、而且含有題幹的題目。';
        if (count > CLIENT_SEND_CAP) {
            return '目前篩選有 ' + count + ' 題含題幹。出題時會依目前排序送出前 ' + CLIENT_SEND_CAP + ' 題，伺服器可能再減少。';
        }
        return '目前篩選有 ' + count + ' 題含題幹，會全部送出作為參考。';
    }

    function idbRequest(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    function transactionDone(tx) {
        return new Promise(function (resolve, reject) {
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
            tx.onabort = function () { reject(tx.error || new Error('aborted')); };
        });
    }

    function openGenerationDb() {
        return new Promise(function (resolve, reject) {
            if (!window.indexedDB) {
                reject(new Error('no indexedDB'));
                return;
            }
            var request = window.indexedDB.open('econPoeGenerations', 1);
            request.onupgradeneeded = function () {
                var db = request.result;
                if (!db.objectStoreNames.contains('generations')) {
                    var store = db.createObjectStore('generations', { keyPath: 'id' });
                    store.createIndex('byUser', 'username', { unique: false });
                }
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    async function ensureStore() {
        if (poeUi.storeMode) return poeUi.storeMode;
        try {
            poeUi.db = await openGenerationDb();
            poeUi.storeMode = 'idb';
        } catch (error) {
            poeUi.storeMode = 'local';
        }
        return poeUi.storeMode;
    }

    function readLocal() {
        try {
            var raw = localStorage.getItem(LOCAL_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function writeLocal(records) {
        var next = records.slice();
        var lastError = null;
        while (next.length) {
            try {
                localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
                return;
            } catch (error) {
                lastError = error;
                if (next.length === 1) break;
                next = next.slice(Math.ceil(next.length / 2));
            }
        }
        throw lastError || new Error('quota');
    }

    async function listGenerations(username) {
        var mode = await ensureStore();
        if (mode === 'local') {
            return readLocal()
                .filter(function (record) { return record.username === username; })
                .sort(function (a, b) { return b.createdAt - a.createdAt; });
        }
        var index = poeUi.db.transaction('generations', 'readonly').objectStore('generations').index('byUser');
        var rows = await idbRequest(index.getAll(username));
        return (rows || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
    }

    async function saveGeneration(record) {
        var mode = await ensureStore();
        if (mode === 'local') {
            var all = readLocal().filter(function (item) { return item.id !== record.id; });
            all.push(record);
            var mine = all
                .filter(function (item) { return item.username === record.username; })
                .sort(function (a, b) { return b.createdAt - a.createdAt; });
            var keep = {};
            mine.slice(0, HISTORY_LIMIT).forEach(function (item) { keep[item.id] = true; });
            writeLocal(all.filter(function (item) {
                return item.username !== record.username || keep[item.id];
            }));
            return;
        }
        var writeTx = poeUi.db.transaction('generations', 'readwrite');
        writeTx.objectStore('generations').put(record);
        await transactionDone(writeTx);
        var rows = await listGenerations(record.username);
        var extra = rows.slice(HISTORY_LIMIT);
        if (!extra.length) return;
        var tx = poeUi.db.transaction('generations', 'readwrite');
        var store = tx.objectStore('generations');
        extra.forEach(function (item) { store.delete(item.id); });
        await transactionDone(tx);
    }

    async function deleteGeneration(id) {
        var mode = await ensureStore();
        if (mode === 'local') {
            writeLocal(readLocal().filter(function (record) { return record.id !== id; }));
            return;
        }
        var tx = poeUi.db.transaction('generations', 'readwrite');
        tx.objectStore('generations').delete(id);
        await transactionDone(tx);
    }

    async function clearGenerations(username) {
        var mode = await ensureStore();
        if (mode === 'local') {
            writeLocal(readLocal().filter(function (record) { return record.username !== username; }));
            return;
        }
        var rows = await listGenerations(username);
        if (!rows.length) return;
        var tx = poeUi.db.transaction('generations', 'readwrite');
        var store = tx.objectStore('generations');
        rows.forEach(function (record) { store.delete(record.id); });
        await transactionDone(tx);
    }

    function ensureModal() {
        if (poeUi.overlay) return;
        var overlay = document.createElement('div');
        overlay.id = 'poe-generate-overlay';
        overlay.className = 'poe-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="poe-dialog" role="dialog" aria-modal="true" aria-labelledby="poe-generate-title">'
            + '  <header class="poe-header">'
            + '    <div>'
            + '      <h2 id="poe-generate-title">根據篩選題目出題</h2>'
            + '      <p class="poe-subtitle">參考目前篩選結果的風格、用字與句式，經伺服器向 Poe 要求全新題目與解釋。</p>'
            + '    </div>'
            + '    <button type="button" class="poe-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="poe-body">'
            + '    <aside class="poe-history" aria-label="過往生成">'
            + '      <div class="poe-history-head">'
            + '        <h3>此瀏覽器的紀錄</h3>'
            + '        <button type="button" class="poe-text-btn" id="poe-history-clear">清除</button>'
            + '      </div>'
            + '      <div id="poe-history-list"></div>'
            + '    </aside>'
            + '    <section class="poe-main">'
            + '      <div class="poe-meta" id="poe-meta"></div>'
            + '      <div class="poe-stage" id="poe-stage" tabindex="0"></div>'
            + '    </section>'
            + '  </div>'
            + '  <footer class="poe-footer">'
            + '    <p class="poe-footer-status" id="poe-status" aria-live="polite"></p>'
            + '    <div class="poe-footer-actions">'
            + '      <button type="button" class="btn btn-primary" id="poe-start">根據目前篩選出題</button>'
            + '      <button type="button" class="btn btn-secondary" id="poe-again" disabled>再生成</button>'
            + '      <button type="button" class="btn btn-outline-primary" id="poe-copy" disabled>複製內容</button>'
            + '      <button type="button" class="btn btn-outline-danger" id="poe-cancel" hidden>取消</button>'
            + '    </div>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);
        poeUi.overlay = overlay;

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closePoeGenerateModal();
        });
        overlay.querySelector('.poe-close').addEventListener('click', closePoeGenerateModal);
        overlay.querySelector('#poe-start').addEventListener('click', generateFromFilters);
        overlay.querySelector('#poe-again').addEventListener('click', regenerateActive);
        overlay.querySelector('#poe-copy').addEventListener('click', copyActive);
        overlay.querySelector('#poe-cancel').addEventListener('click', function () { cancelGeneration(false); });
        overlay.querySelector('#poe-history-clear').addEventListener('click', clearHistory);
        overlay.addEventListener('keydown', onDialogKeydown);
    }

    function onDialogKeydown(event) {
        if (!isPoeGenerateModalOpen()) return;
        if (event.key === 'Tab') trapTab(event);
    }

    function trapTab(event) {
        var dialog = poeUi.overlay.querySelector('.poe-dialog');
        var focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        var items = Array.prototype.filter.call(focusable, function (node) {
            return !node.disabled && !node.hidden && node.offsetParent !== null;
        });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function isPoeGenerateModalOpen() {
        return !!(poeUi.overlay && !poeUi.overlay.hidden);
    }

    function closePoeGenerateModal() {
        if (!isPoeGenerateModalOpen()) return;
        if (poeUi.busy) cancelGeneration(true);
        poeUi.overlay.hidden = true;
        document.body.classList.remove('poe-modal-open');
        stopElapsed();
        if (poeUi.trigger && typeof poeUi.trigger.focus === 'function') poeUi.trigger.focus();
    }

    async function openPoeGenerateModal() {
        if (poeUi.opening || isPoeGenerateModalOpen()) return;
        poeUi.opening = true;
        try {
            await openPoeGenerateModalBody();
        } finally {
            poeUi.opening = false;
        }
    }

    async function openPoeGenerateModalBody() {
        var allowed = await poeCheckAccess();
        if (!allowed) {
            hideGenerateButton();
            return;
        }
        ensureModal();
        poeUi.trigger = document.getElementById('poe-generate-btn');
        poeUi.overlay.hidden = false;
        document.body.classList.add('poe-modal-open');
        setStatus('');
        poeUi.counting = true;
        if (!poeUi.activeRecord) showIdle(0, true);
        updateMeta(0, true);
        syncActionButtons();
        var closeButton = poeUi.overlay.querySelector('.poe-close');
        if (closeButton) closeButton.focus();
        try {
            poeUi.records = await listGenerations(currentUsername());
        } catch (error) {
            poeUi.records = [];
        }
        renderHistory();
        var usable = [];
        try {
            usable = await loadFilteredQuestions();
        } catch (error) {
            usable = [];
        }
        poeUi.counting = false;
        poeUi.filteredCount = usable.length;
        updateMeta(usable.length, false);
        if (!poeUi.activeRecord) showIdle(usable.length, false);
        syncActionButtons();
    }

    function updateMeta(count, counting) {
        poeUi.filteredCount = count;
        var meta = document.getElementById('poe-meta');
        if (!meta) return;
        meta.textContent = counting ? '正在計算目前篩選的題數…' : leadForCount(count);
    }

    function setStatus(message) {
        var status = document.getElementById('poe-status');
        if (status) status.textContent = message || '';
    }

    function showIdle(count, counting) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        stage.textContent = '';
        var lead = document.createElement('p');
        lead.className = 'poe-lead';
        lead.textContent = '按「根據目前篩選出題」後，伺服器會附上參考題，並要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        var details = document.createElement('details');
        details.className = 'poe-instruction';
        var summary = document.createElement('summary');
        summary.textContent = '出題指示';
        var copy = document.createElement('p');
        copy.textContent = POE_INSTRUCTION;
        details.appendChild(summary);
        details.appendChild(copy);
        stage.appendChild(lead);
        stage.appendChild(details);
        if (counting || !count) {
            var empty = document.createElement('p');
            empty.className = 'poe-note';
            empty.textContent = counting ? '正在計算目前篩選的題數…' : leadForCount(0);
            stage.appendChild(empty);
        }
    }

    function showLoading() {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        stage.textContent = '';
        var wrap = document.createElement('div');
        wrap.className = 'poe-loading';
        var bar = document.createElement('div');
        bar.className = 'poe-progress';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', '正在出題');
        var fill = document.createElement('div');
        fill.className = 'poe-progress-bar';
        bar.appendChild(fill);
        var title = document.createElement('p');
        title.textContent = '正在出題，請稍候。一次寫多題時，模型可能需要約一分鐘。';
        var elapsed = document.createElement('p');
        elapsed.id = 'poe-elapsed';
        elapsed.className = 'poe-elapsed';
        elapsed.textContent = '已等待 0 秒';
        wrap.appendChild(bar);
        wrap.appendChild(title);
        wrap.appendChild(elapsed);
        stage.appendChild(wrap);
    }

    function showError(code) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        stage.textContent = '';
        var box = document.createElement('div');
        box.className = 'poe-error';
        box.setAttribute('role', 'alert');
        var title = document.createElement('p');
        title.className = 'poe-error-title';
        title.textContent = '未能完成出題';
        var message = document.createElement('p');
        message.textContent = ERROR_TEXT[code] || ERROR_TEXT.server_error;
        box.appendChild(title);
        box.appendChild(message);
        stage.appendChild(box);
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Escape first, then allow only strong/em. A function replacer avoids
    // treating $&, $`, or $' in the model text as replacement patterns.
    function inlineMarkdownHtml(text) {
        var html = escapeHtml(text);
        html = html.replace(/\*\*([^*\n]+?)\*\*/g, function (_match, inner) {
            return '<strong>' + inner + '</strong>';
        });
        html = html.replace(/__([^_\n]+?)__/g, function (_match, inner) {
            return '<strong>' + inner + '</strong>';
        });
        html = html.replace(/(^|[\s（(])\*([^*\s](?:[^*]*[^*\s])?)\*(?=[\s。，、；：！？)）」]|$)/g, function (_match, prefix, inner) {
            return prefix + '<em>' + inner + '</em>';
        });
        return html;
    }

    function setInlineMarkdown(element, text) {
        element.innerHTML = inlineMarkdownHtml(text);
    }

    function renderStructured(container, text) {
        container.textContent = '';
        var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
        var list = null;
        function endList() {
            if (!list) return;
            container.appendChild(list);
            list = null;
        }
        lines.forEach(function (line) {
            var trimmed = line.trim();
            var heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
            var bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
            if (!trimmed) {
                endList();
                return;
            }
            if (heading) {
                endList();
                var level = heading[1].length;
                var head = document.createElement(level === 1 ? 'h3' : 'h4');
                head.className = 'poe-md-h';
                setInlineMarkdown(head, heading[2]);
                container.appendChild(head);
                return;
            }
            if (bullet) {
                if (!list) {
                    list = document.createElement('ul');
                    list.className = 'poe-md-list';
                }
                var item = document.createElement('li');
                setInlineMarkdown(item, bullet[1]);
                list.appendChild(item);
                return;
            }
            endList();
            var paragraph = document.createElement('p');
            setInlineMarkdown(paragraph, line);
            container.appendChild(paragraph);
        });
        endList();
        if (!container.childNodes.length) {
            var empty = document.createElement('p');
            empty.textContent = '（沒有內容）';
            container.appendChild(empty);
        }
    }

    function showResult(record) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        stage.textContent = '';
        var article = document.createElement('article');
        article.className = 'poe-result';
        renderStructured(article, record.content);
        stage.appendChild(article);
        stage.scrollTop = 0;
    }

    function formatTime(timestamp) {
        var date = new Date(timestamp);
        if (isNaN(date.getTime())) return '';
        try {
            return date.toLocaleString('zh-HK', {
                hour12: false,
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return date.toISOString();
        }
    }

    function clipPreview(line, max) {
        var count = 0;
        var index = 0;
        while (index < line.length && count < max) {
            if (line.substr(index, 2) === '**' || line.substr(index, 2) === '__') {
                index += 2;
                continue;
            }
            count += 1;
            index += 1;
        }
        var sliced = line.slice(0, index);
        if ((sliced.match(/\*\*/g) || []).length % 2 === 1) sliced += '**';
        if ((sliced.match(/__/g) || []).length % 2 === 1) sliced += '__';
        if (index < line.length) sliced += '…';
        return sliced;
    }

    function previewText(content) {
        var line = String(content || '').split('\n').map(function (item) { return item.trim(); }).filter(Boolean)[0] || '（沒有內容）';
        line = line.replace(/^#{1,6}\s+/, '');
        return clipPreview(line, 42);
    }

    function renderHistory() {
        var list = document.getElementById('poe-history-list');
        if (!list) return;
        list.textContent = '';
        if (!poeUi.records.length) {
            var empty = document.createElement('p');
            empty.className = 'poe-history-empty';
            empty.textContent = '尚未有儲存的生成結果。成功出題後可以在這裡重新打開。';
            list.appendChild(empty);
            return;
        }
        poeUi.records.forEach(function (record) {
            var row = document.createElement('div');
            row.className = 'poe-history-item' + (poeUi.activeRecord && poeUi.activeRecord.id === record.id ? ' is-active' : '');
            var open = document.createElement('button');
            open.type = 'button';
            open.className = 'poe-history-open';
            open.setAttribute('aria-current', poeUi.activeRecord && poeUi.activeRecord.id === record.id ? 'true' : 'false');
            var time = document.createElement('span');
            time.className = 'poe-history-time';
            time.textContent = formatTime(record.createdAt);
            var preview = document.createElement('span');
            preview.className = 'poe-history-preview';
            setInlineMarkdown(preview, previewText(record.content));
            var meta = document.createElement('span');
            meta.className = 'poe-history-meta';
            meta.textContent = (record.sentCount || 0) + ' 題參考';
            open.appendChild(time);
            open.appendChild(preview);
            open.appendChild(meta);
            open.addEventListener('click', function () { selectRecord(record); });
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'poe-history-delete';
            remove.setAttribute('aria-label', '刪除這筆紀錄');
            remove.textContent = '刪除';
            remove.addEventListener('click', function () { removeRecord(record); });
            row.appendChild(open);
            row.appendChild(remove);
            list.appendChild(row);
        });
    }

    function selectRecord(record) {
        if (poeUi.busy) return;
        poeUi.activeRecord = record;
        showResult(record);
        var bits = [formatTime(record.createdAt), record.filterSummary || ''];
        if (record.model) bits.push('模型：' + record.model);
        if (record.truncated) bits.push('參考題曾經截斷');
        setStatus(bits.filter(Boolean).join(' · '));
        renderHistory();
        syncActionButtons();
    }

    async function removeRecord(record) {
        if (poeUi.busy) return;
        try {
            await deleteGeneration(record.id);
        } catch (error) {
            setStatus('未能刪除這筆紀錄。');
            return;
        }
        poeUi.records = poeUi.records.filter(function (item) { return item.id !== record.id; });
        if (poeUi.activeRecord && poeUi.activeRecord.id === record.id) {
            poeUi.activeRecord = null;
            showIdle(poeUi.filteredCount);
            setStatus('已刪除。');
        }
        renderHistory();
        syncActionButtons();
    }

    async function clearHistory() {
        if (poeUi.busy) return;
        var username = currentUsername();
        if (!username || !poeUi.records.length) return;
        if (!confirm('清除這部瀏覽器上目前使用者的出題紀錄？')) return;
        try {
            await clearGenerations(username);
        } catch (error) {
            setStatus('未能清除紀錄。');
            return;
        }
        poeUi.records = [];
        poeUi.activeRecord = null;
        renderHistory();
        showIdle(poeUi.filteredCount);
        setStatus('已清除這部瀏覽器上的出題紀錄。');
        syncActionButtons();
    }

    function syncActionButtons() {
        var start = document.getElementById('poe-start');
        var again = document.getElementById('poe-again');
        var copy = document.getElementById('poe-copy');
        var cancel = document.getElementById('poe-cancel');
        var canRegenerate = !!(poeUi.activeRecord && poeUi.activeRecord.referenceIds && poeUi.activeRecord.referenceIds.length);
        if (start) start.disabled = poeUi.busy || poeUi.counting || poeUi.filteredCount === 0;
        if (again) again.disabled = poeUi.busy || !canRegenerate;
        if (copy) copy.disabled = poeUi.busy || !(poeUi.activeRecord && poeUi.activeRecord.content);
        if (cancel) cancel.hidden = !poeUi.busy;
        var dialog = poeUi.overlay && poeUi.overlay.querySelector('.poe-dialog');
        if (dialog) dialog.setAttribute('aria-busy', poeUi.busy ? 'true' : 'false');
    }

    function startElapsed() {
        stopElapsed();
        poeUi.startedAt = Date.now();
        poeUi.timer = setInterval(function () {
            var node = document.getElementById('poe-elapsed');
            if (!node) return;
            var seconds = Math.floor((Date.now() - poeUi.startedAt) / 1000);
            node.textContent = '已等待 ' + seconds + ' 秒';
        }, 500);
    }

    function stopElapsed() {
        if (poeUi.timer) clearInterval(poeUi.timer);
        poeUi.timer = null;
    }

    function cancelGeneration(silent) {
        if (poeUi.control) {
            poeUi.control.cancelled = true;
            if (poeUi.control.handle) poeUi.control.handle.cancel();
        }
        if (!silent && isPoeGenerateModalOpen()) setStatus('已取消這次出題。');
    }

    async function generateFromFilters() {
        var usable = [];
        try {
            usable = await loadFilteredQuestions();
        } catch (error) {
            showError('no_reference_questions');
            return;
        }
        updateMeta(usable.length);
        syncActionButtons();
        await runGeneration(usable, filterSummary(usable.length));
    }

    async function regenerateActive() {
        if (!poeUi.activeRecord || !poeUi.activeRecord.referenceIds) return;
        var questions = await questionsByIds(poeUi.activeRecord.referenceIds);
        if (!questions.length) {
            showError('missing_references');
            syncActionButtons();
            return;
        }
        await runGeneration(questions, poeUi.activeRecord.filterSummary || '沿用上一批參考題');
    }

    async function runGeneration(bankQuestions, summary) {
        if (poeUi.busy) return;
        var references = bankQuestions.map(toReference).filter(function (item) { return item.question; });
        if (!references.length) {
            showError('no_reference_questions');
            syncActionButtons();
            return;
        }
        var filteredCount = references.length;
        var sending = references.slice(0, CLIENT_SEND_CAP);
        poeUi.busy = true;
        poeUi.control = { cancelled: false, handle: null };
        syncActionButtons();
        showLoading();
        startElapsed();
        setStatus(filteredCount > sending.length
            ? '正在送出前 ' + sending.length + ' / ' + filteredCount + ' 題參考。'
            : '正在送出 ' + sending.length + ' 題參考。');
        try {
            var data = await proxyRequest({
                action: 'generateQuestions',
                username: currentUsername(),
                filteredCount: filteredCount,
                questions: sending
            }, 240000, poeUi.control);
            if (!isPoeGenerateModalOpen()) return;
            if (!data || data.ok !== true || !data.content) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') hideGenerateButton();
                showError(code);
                setStatus('');
                return;
            }
            var record = {
                id: currentUsername() + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8),
                username: currentUsername(),
                createdAt: Date.now(),
                content: String(data.content),
                model: data.model || '',
                sentCount: data.sentCount || sending.length,
                filteredCount: data.filteredCount || filteredCount,
                truncated: !!data.truncated || filteredCount > sending.length,
                referenceIds: sending.map(function (item) { return item.id; }).filter(Boolean),
                filterSummary: summary,
                durationMs: data.durationMs || (Date.now() - poeUi.startedAt)
            };
            var saved = true;
            try {
                await saveGeneration(record);
                poeUi.records = await listGenerations(currentUsername());
            } catch (error) {
                saved = false;
                poeUi.records = [record].concat(poeUi.records.filter(function (item) { return item.id !== record.id; }));
            }
            poeUi.activeRecord = record;
            showResult(record);
            renderHistory();
            var statusParts = [];
            if (record.model) statusParts.push('模型：' + record.model);
            statusParts.push('參考 ' + record.sentCount + ' / ' + record.filteredCount + ' 題');
            if (record.durationMs) statusParts.push('用時 ' + Math.max(1, Math.round(record.durationMs / 1000)) + ' 秒');
            statusParts.push(saved ? '已儲存在這部瀏覽器' : ERROR_TEXT.save_failed);
            if (data.logged === false) statusParts.push('未能寫入試算表紀錄');
            setStatus(statusParts.join(' · '));
        } catch (error) {
            if (!isPoeGenerateModalOpen()) return;
            if (error && error.code === 'cancelled') {
                showIdle(poeUi.filteredCount);
                setStatus('已取消這次出題。');
                return;
            }
            showError(error && error.code ? error.code : 'network');
            setStatus('');
        } finally {
            poeUi.busy = false;
            poeUi.control = null;
            stopElapsed();
            if (isPoeGenerateModalOpen()) syncActionButtons();
        }
    }

    function copyWithFallback(text) {
        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
            return navigator.clipboard.writeText(text).catch(function () {
                return copyWithTextarea(text);
            });
        }
        return copyWithTextarea(text);
    }

    function copyWithTextarea(text) {
        return new Promise(function (resolve, reject) {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.top = '0';
            area.style.left = '0';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.focus();
            area.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
            area.remove();
            if (ok) resolve();
            else reject(new Error('copy'));
        });
    }

    function copyActive() {
        if (!poeUi.activeRecord || !poeUi.activeRecord.content) return;
        var button = document.getElementById('poe-copy');
        var original = button ? button.textContent : '複製內容';
        copyWithFallback(poeUi.activeRecord.content).then(function () {
            if (button) {
                button.textContent = '✓';
                setTimeout(function () {
                    if (button.textContent === '✓') button.textContent = original;
                }, 1500);
            }
            setStatus('已複製到剪貼簿。');
        }).catch(function () {
            setStatus('複製失敗，請手動選取文字。');
        });
    }

    window.openPoeGenerateModal = openPoeGenerateModal;
    window.closePoeGenerateModal = closePoeGenerateModal;
    window.isPoeGenerateModalOpen = isPoeGenerateModalOpen;
    window.initPoeGenerateFeature = initPoeGenerateFeature;
    window.logQuestionToolLogin = logQuestionToolLogin;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindGenerateButton);
    } else {
        bindGenerateButton();
    }
})();
