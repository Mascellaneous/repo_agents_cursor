/* =============================================================================
 * ui-header.js — 頂列與儲存空間統計
 * 只在字串真的不同時才寫 textContent（避免 layout thrash）
 * v2.4：儲存統計以 IndexedDB 實際用量／配額呈現，不再出現過期的「5 MB」文案
 * ============================================================================= */
 
window.UIHeader = (() => {
 
  const R = UIState.R;
  let storageAt = 0;
 
  function renderHeader() {
    const chat = Chats.current();
    if (!chat) return;
    if (R.title.textContent !== chat.title) R.title.textContent = chat.title;
 
    const st = Chats.stats(chat);
    const modelId = Models.resolve(chat.model);
    const ctx = Models.contextOf(modelId);
    const used = st.estTokens;
    const ratio = ctx ? used / ctx : 0;
 
    const parts = [`${st.count} 則訊息`];
    if (chat.temporary) parts.unshift('🕶️ 暫時對話（不儲存／不同步）');
    if (UIState.isGenerating(chat.id)) parts.push('⏳ 正在生成回覆…');
    if (ctx) parts.push(`上下文約 ${U.formatNum(used)} / ${U.formatNum(ctx)}${ratio > Settings.get('contextWarnRatio') ? ' ⚠️' : ''}`);
    if (Settings.get('showTokenUsage') && st.cost) parts.push(`花費 ${U.formatCost(st.cost)}`);
    if (chat.systemPrompt) parts.push('已設系統提示詞');
    /* 低調監看：有摘要就在頂列常駐一行小字 */
    if (chat.summary) parts.push(chat.summarizedUpTo ? `📝 已摘要 ${chat.summarizedUpTo} 則` : '📝 含自訂摘要');
    if (chat.overrides) parts.push('專用參數');
 
    const metaText = parts.join('　·　');
    if (R.meta.textContent !== metaText) R.meta.textContent = metaText;
 
    const cmpList = (Settings.get('compareModels') || []).filter(id => Models.find(id));
    const cmp = Settings.get('compareEnabled') && cmpList.length;
    const label = cmp ? `比較 ${cmpList.length} 個模型` : Models.nameOf(modelId);
    if (R.modelLabel.textContent !== label) R.modelLabel.textContent = label;
 
    U.$('#btn-model').title = `目前模型：${modelId}\n點擊可更換（Ctrl+M）`;
    U.$('#btn-model').classList.toggle('is-active', !!cmp);
    U.$('#btn-tts-toggle').classList.toggle('is-active', Settings.get('ttsAutoPlay'));
 
    const prov = Settings.get('provider') || 'openrouter';
    if (R.providerBadge) {
      if (R.providerBadge.textContent !== PROVIDERS[prov].label) R.providerBadge.textContent = PROVIDERS[prov].label;
      R.providerBadge.classList.toggle('is-poe', prov === 'poe');
    }
 
    // 同步暫時/永久切換按鈕圖示
    const tempBtn = U.$('#btn-toggle-temp');
    if (tempBtn) {
      const chat = Chats.current();
      if (chat) {
        tempBtn.textContent = chat.temporary ? '💾' : '🕶️';
        tempBtn.title = chat.temporary 
          ? '轉為永久對話（開始儲存／同步）' 
          : '轉為暫時對話（不儲存、不同步）';
      }
    }
 
  }
 
  /** 儲存空間統計（3 秒節流；開啟設定時可 force） */
  function updateStorageBadge(force = false) {
    const now = Date.now();
    if (!force && now - storageAt < 3000) return;
    storageAt = now;
 
    const { total, quota } = Store.usage();
    const txt = quota
      ? `💾 ${U.formatBytes(total)} / 約 ${U.formatBytes(quota)}`
      : `💾 ${U.formatBytes(total)}`;
    const el = U.$('#storage-usage');
    if (el && el.textContent !== txt) el.textContent = txt;
 
    const detail = U.$('#storage-detail');
    if (detail) {
      const g = Chats.globalStats();
      const temp = Chats.temporaryList().length;
      const html =
        `已使用 <b>${U.formatBytes(total)}</b>` +
        (quota ? `／瀏覽器配額約 <b>${U.formatBytes(quota)}</b>（IndexedDB，容量由磁碟可用空間決定）` : '') +
        `<br>對話 ${g.chats} 個、訊息 ${g.messages} 則、累計 ${U.formatNum(g.tokens)} tokens、估算花費 ${U.formatCost(g.cost)}` +
        (temp ? `<br>🕶️ 其中 ${temp} 個是暫時對話（不佔用儲存空間）` : '');
      if (detail.innerHTML !== html) detail.innerHTML = html;
    }
  }
 
  return { renderHeader, updateStorageBadge };
})();