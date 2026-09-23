/* =============================================================================
 * models.js — 模型目錄（支援 OpenRouter 線上目錄 與 Poe 手動清單）
 * ============================================================================= */

window.Models = (() => {

  const CACHE_TTL = 12 * 60 * 60 * 1000;             // 12 小時
  let catalog = [];
  let pickerMode = 'single';
  let onPick = null;
  let multiSelection = [];

  const provider = () => Settings.get('provider') || 'openrouter';
  const isPoe = () => provider() === 'poe';

  /* --------------------- 目前供應商的設定鍵 --------------------- */

  const modelKey = () => (isPoe() ? 'poeModel' : 'model');
  const titleKey = () => (isPoe() ? 'poeTitleModel' : 'titleModel');

  function defaultModel() {
    const v = Settings.get(modelKey());
    if (v) return v;
    return isPoe() ? ((Settings.get('poeModels') || [])[0] || '') : DEFAULT_SETTINGS.model;
  }
  const setDefaultModel = id => Settings.set(modelKey(), id);
  const titleModel = () => Settings.get(titleKey()) || '';
  const setTitleModel = id => Settings.set(titleKey(), id);

  /** 對話上記錄的模型若不屬於目前供應商 → 回退到預設模型 */
  function resolve(id) {
    if (!id) return defaultModel();
    if (!catalog.length) return id;
    return find(id) ? id : defaultModel();
  }

  /* ------------------------------ 正規化 ------------------------------ */

  function normalize(m) {
    const inputs = m.architecture?.input_modalities || m.architecture?.modality?.split('->')[0]?.split('+') || [];
    return {
      id: m.id,
      name: m.name || m.id,
      context: m.context_length || m.top_provider?.context_length || 0,
      promptPrice: parseFloat(m.pricing?.prompt ?? '0') || 0,
      completionPrice: parseFloat(m.pricing?.completion ?? '0') || 0,
      vision: m.vision ?? inputs.includes('image'),
      free: m.id.endsWith(':free') ||
        ((parseFloat(m.pricing?.prompt ?? '0') || 0) === 0 && (parseFloat(m.pricing?.completion ?? '0') || 0) === 0),
      description: m.description || '',
      created: m.created || 0,
      provider: 'openrouter',
    };
  }

  /** 由使用者維護的 Poe 清單建目錄（無價格 / 無 context 資訊） */
  function poeCatalog() {
    const list = Settings.get('poeModels');
    const ids = (Array.isArray(list) && list.length) ? list : POE_DEFAULT_MODELS;
    return ids.map(id => ({
      id, name: id,
      context: 0, promptPrice: 0, completionPrice: 0,
      vision: POE_VISION_HINT.test(id),
      free: false,
      description: 'Poe bot',
      created: 0,
      provider: 'poe',
    }));
  }

  /* ------------------------------ 載入 -------------------------------- */

  async function load(force = false) {
    if (isPoe()) { catalog = poeCatalog(); return catalog; }

    const cache = Store.get(STORAGE_KEYS.modelCache);
    if (!force && cache?.at && Date.now() - cache.at < CACHE_TTL && cache.list?.length) {
      catalog = cache.list;
      return catalog;
    }
    try {
      const res = await fetch(`${Settings.get('baseUrl')}/models`, { headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      catalog = (json.data || []).map(normalize).filter(m => m.id);
      Store.set(STORAGE_KEYS.modelCache, { at: Date.now(), list: catalog });
    } catch (e) {
      console.warn('[Models] 無法取得線上清單，使用備援清單', e);
      catalog = (cache?.list?.length ? cache.list : FALLBACK_MODELS.map(normalize));
      if (force) Toast.warn('無法取得線上模型清單，暫時使用快取／備援清單');
    }
    return catalog;
  }

  const all = () => catalog;
  const find = id => catalog.find(m => m.id === id) || null;
  const nameOf = id => find(id)?.name || id || '未選擇';
  const contextOf = id => find(id)?.context || 0;
  const supportsVision = id => !!find(id)?.vision;

  function costOf(id, usage = {}) {
    const m = find(id);
    if (!m) return 0;
    return (usage.prompt_tokens || 0) * m.promptPrice + (usage.completion_tokens || 0) * m.completionPrice;
  }

  /* ------------------------------ 收藏 -------------------------------- */

  function toggleFav(id) {
    const favs = [...(Settings.get('favoriteModels') || [])];
    const i = favs.indexOf(id);
    i > -1 ? favs.splice(i, 1) : favs.push(id);
    Settings.set('favoriteModels', favs);
  }
  const isFav = id => (Settings.get('favoriteModels') || []).includes(id);

  /* ------------------------------ 選擇器 ------------------------------ */

  function openPicker(opts = {}) {
    pickerMode = opts.mode || 'single';
    onPick = opts.onPick || null;
    multiSelection = pickerMode === 'multi' ? [...(opts.selected || [])] : [];
    U.$('#model-picker-title').textContent =
      (opts.title || (pickerMode === 'multi' ? '🧠 選擇多個模型' : '🧠 選擇模型')) +
      `　·　${PROVIDERS[provider()].label}`;
    Modal.open('modal-models');          // Modal 會自動把它疊到最上層
    renderList(opts.selected);
  }

  function currentFilters() {
    return {
      q: (U.$('#model-search')?.value || '').trim().toLowerCase(),
      free: !!U.$('#model-filter-free')?.checked,
      vision: !!U.$('#model-filter-vision')?.checked,
      fav: !!U.$('#model-filter-fav')?.checked,
      sort: U.$('#model-sort')?.value || 'name',
    };
  }

  function renderList(selected) {
    const box = U.$('#model-list');
    if (!box) return;
    const f = currentFilters();
    const sel = pickerMode === 'multi' ? multiSelection : [selected ?? defaultModel()].flat();

    let list = catalog.filter(m => {
      if (f.free && !m.free) return false;
      if (f.vision && !m.vision) return false;
      if (f.fav && !isFav(m.id)) return false;
      if (f.q && !(m.id.toLowerCase().includes(f.q) || m.name.toLowerCase().includes(f.q))) return false;
      return true;
    });

    list.sort((a, b) => {
      if (f.sort === 'context') return b.context - a.context;
      if (f.sort === 'price') return (a.promptPrice + a.completionPrice) - (b.promptPrice + b.completionPrice);
      return a.name.localeCompare(b.name);
    });
    list = [...list.filter(m => isFav(m.id)), ...list.filter(m => !isFav(m.id))];

    box.innerHTML = '';
    const count = U.$('#model-count');
    if (count) count.textContent = `共 ${list.length} / ${catalog.length} 個模型（${PROVIDERS[provider()].label}）`;

    if (!list.length) {
      box.appendChild(U.el('p.muted', {
        text: isPoe()
          ? '清單是空的。請到「設定 → API → 常用模型清單」自行填入 Poe bot 名稱。'
          : '找不到符合條件的模型。',
      }));
      return;
    }

    list.forEach(m => {
      const row = U.el('div.model-row');
      if (sel.includes(m.id)) row.classList.add('is-selected');

      const badges = [
        m.provider === 'poe' ? '<span class="badge">Poe</span>' : '',
        m.free ? '<span class="badge badge--free">免費</span>' : '',
        m.vision ? '<span class="badge badge--vision">🖼 圖片</span>' : '',
      ].join('');

      row.appendChild(U.el('div.model-row__main', {
        html:
          `<div class="model-row__name">${U.escapeHtml(m.name)} ${badges}</div>` +
          `<div class="model-row__id">${U.escapeHtml(m.id)}</div>`,
      }));

      row.appendChild(U.el('div.model-row__meta', {
        html: m.provider === 'poe'
          ? '依 Poe 方案計點'
          : `${U.formatNum(m.context)} ctx<br>` +
            (m.free ? '免費'
                    : `輸入 $${(m.promptPrice * 1e6).toFixed(2)}/M<br>輸出 $${(m.completionPrice * 1e6).toFixed(2)}/M`),
      }));

      const fav = U.el('button.fav', {
        text: isFav(m.id) ? '★' : '☆',
        title: '收藏',
        onclick: e => { e.stopPropagation(); toggleFav(m.id); renderList(selected); },
      });
      if (isFav(m.id)) fav.classList.add('is-on');
      row.appendChild(fav);

      row.onclick = () => {
        if (pickerMode === 'multi') {
          const i = multiSelection.indexOf(m.id);
          i > -1 ? multiSelection.splice(i, 1) : multiSelection.push(m.id);
          onPick?.(multiSelection);
          renderList(selected);
        } else {
          onPick?.(m.id);
          Modal.close('modal-models');
        }
      };
      box.appendChild(row);
    });
  }

  /* ------------------------------ 初始化 ------------------------------ */

  function init() {
    const rerender = U.debounce(() => renderList(), 120);
    ['#model-search', '#model-filter-free', '#model-filter-vision', '#model-filter-fav', '#model-sort']
      .forEach(sel => U.$(sel)?.addEventListener('input', rerender));

    const refresh = U.$('#btn-refresh-models');
    if (refresh) refresh.onclick = async () => {
      if (isPoe()) { await load(true); renderList(); Toast.info('Poe 模型清單由「設定 → API」手動維護'); return; }
      const t = Toast.loading('更新模型清單…');
      await load(true);
      t.update(`已載入 ${catalog.length} 個模型`, 'ok');
      renderList();
    };

    /* 供應商 / Poe 清單變更 → 重建目錄 */
    Settings.on('provider', async () => {
      await load();
      window.UI?.onProviderChanged?.();
    });
    Settings.on('poeModels', U.debounce(async () => {
      if (!isPoe()) return;
      await load();
      window.UI?.onProviderChanged?.();
    }, 500));
  }

  return {
    load, all, find, nameOf, contextOf, supportsVision, costOf, toggleFav, isFav, openPicker, init,
    provider, isPoe, defaultModel, setDefaultModel, titleModel, setTitleModel, resolve,
  };
})();