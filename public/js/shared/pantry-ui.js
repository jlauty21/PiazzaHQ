// Pantry staples: the household's list of things it always has (salt, olive oil, flour). Recipes leave a matching ingredient unticked when you add its ingredients to the
// shopping list. One small panel, shared by the Family Hub's Shopping tab (phone page and control app) and the recipe's "Add to shopping list" sheet:
//   PantryUI.open(hostElement, { api, say, onClose })
// api(path, init) returns the parsed answer of the server (GET /api/pantry -> { items: [...] }, PUT /api/pantry with { items }). The panel draws itself into the host and
// empties it again on Done.
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (s) => (window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t(s) : s);

  function ensureStyle() {
    if (document.getElementById('pantry-ui-style')) return;
    const st = document.createElement('style');
    st.id = 'pantry-ui-style';
    st.textContent = `
  .pn-panel { box-sizing: border-box; background: var(--card, #1b2133); color: var(--text, #eef2fb); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 12px; padding: 12px 14px; margin: 8px 0 12px; font-family: inherit; }
  .pn-panel * { box-sizing: border-box; }
  .pn-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted, #9aa6c0); font-weight: 700; margin-bottom: 6px; }
  .pn-help { font-size: 12px; color: var(--muted, #9aa6c0); margin-bottom: 10px; line-height: 1.4; }
  .pn-add { display: flex; gap: 8px; margin-bottom: 10px; }
  .pn-input { flex: 1 1 auto; min-width: 0; background: var(--card2, rgba(255,255,255,0.06)); color: inherit; border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 10px; padding: 9px 12px; font: inherit; font-size: 15px; }
  .pn-input:focus { outline: none; border-color: var(--accent, #4A90D9); }
  .pn-btn { background: var(--card2, rgba(255,255,255,0.08)); color: inherit; border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 10px; padding: 9px 14px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .pn-btn.primary { background: var(--accent, #4A90D9); border-color: var(--accent, #4A90D9); color: #fff; }
  .pn-list { display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow-y: auto; margin-bottom: 10px; }
  .pn-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; background: var(--card2, rgba(255,255,255,0.06)); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 999px; padding: 4px 6px 4px 12px; font-size: 14px; }
  .pn-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pn-chip button { background: none; border: none; color: var(--muted, #9aa6c0); font-size: 15px; cursor: pointer; padding: 2px 6px; line-height: 1; }
  .pn-empty { font-size: 13px; color: var(--muted, #9aa6c0); }`;
    document.head.appendChild(st);
  }

  async function open(host, opts) {
    if (!host) return;
    ensureStyle();
    const api = opts.api, say = opts.say || function () {};
    let items = [];
    try { const r = await api('/api/pantry'); if (r && Array.isArray(r.items)) items = r.items; } catch (e) { /* an empty list; the first save will say if the server is not there */ }

    async function save(next) {
      let r = null;
      try { r = await api('/api/pantry', { method: 'PUT', body: JSON.stringify({ items: next }) }); } catch (e) { r = null; }
      if (!r || !Array.isArray(r.items)) { say(t('❌ The pantry could not be saved.')); return false; }
      items = r.items;
      return true;
    }
    function draw() {
      host.innerHTML = `<div class="pn-panel">
        <div class="pn-title">${esc(t('Pantry staples'))}</div>
        <div class="pn-help">${esc(t('Things you always have. They start unticked when you add a recipe’s ingredients to the shopping list, so you can still tick one when you run out.'))}</div>
        <div class="pn-add"><input class="pn-input" type="text" maxlength="60" placeholder="${esc(t('Add one (salt, olive oil…)'))}" autocomplete="off" autocapitalize="none" spellcheck="false"><button type="button" class="pn-btn primary pn-addbtn">${esc(t('Add'))}</button></div>
        <div class="pn-list">${items.length ? items.map((n, i) => `<span class="pn-chip"><span>${esc(n)}</span><button type="button" class="pn-rm" data-i="${i}" aria-label="${esc(t('Remove'))}">✕</button></span>`).join('') : `<span class="pn-empty">${esc(t('Nothing here yet.'))}</span>`}</div>
        <div><button type="button" class="pn-btn pn-done">${esc(t('Done'))}</button></div>
      </div>`;
      const input = host.querySelector('.pn-input');
      const add = async () => {
        const name = input.value.trim();
        if (!name) return;
        if (await save(items.concat([name]))) { draw(); const n = host.querySelector('.pn-input'); if (n) n.focus(); }
      };
      host.querySelector('.pn-addbtn').addEventListener('click', add);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      host.querySelectorAll('.pn-rm').forEach((b) => b.addEventListener('click', async () => {
        const i = Number(b.dataset.i);
        if (await save(items.filter((_, k) => k !== i))) draw();
      }));
      host.querySelector('.pn-done').addEventListener('click', () => { host.innerHTML = ''; if (opts.onClose) opts.onClose(items); });
    }
    draw();
    if (host.scrollIntoView) host.scrollIntoView({ block: 'nearest' });
  }

  window.PantryUI = { open };
})();
