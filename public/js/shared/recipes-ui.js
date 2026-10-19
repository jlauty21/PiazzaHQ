// Recipes screens, shared by the Family Hub page (hub.html) and the control app (app.html): the recipe list with search / tags / favorites, one recipe with a
// servings scaler, and the editor. The host page gives it a container and its own way of talking to the server, so the module needs nothing else from the page:
//   const ui = RecipesUI.mount(container, { api(path, init) -> Promise<json>, upload(path, formData) -> Promise<json>, toast(text), confirm(text) -> boolean });
//   ui.refresh()   redraw from the server (the hosts call it when a live "recipes" update arrives)
// Covered by test/ui/recipes-ui.spec.js.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bad = (r) => !r || r.error || r.__networkError || r.__authFailed || r.__parseError;
  // 600 -> "10 min", 5400 -> "1 hr 30 min" (how a step's timer is written back into the editor)
  const timerText = (sec) => { sec = Math.max(0, Math.round(Number(sec) || 0)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return [h ? h + ' hr' : '', m ? m + ' min' : '', s ? s + ' sec' : ''].filter(Boolean).join(' '); };
  const minutes = (n) => (n > 0 ? `<span class="rcp-time">${Number(n)} <span>min</span></span>` : '');

  const CSS = `
  .rcp { color: var(--text, #eef2fb); font-family: inherit; padding: 12px 12px 28px; max-width: 900px; margin: 0 auto; }
  .rcp * { box-sizing: border-box; }
  .rcp button { font: inherit; cursor: pointer; }
  .rcp-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
  .rcp-bar .rcp-search { flex: 1 1 100%; min-width: 0; }
  /* Import, Community and + New recipe always share one row (they shrink and share the space; a long label is cut short rather than wrapping the row) */
  .rcp-bar.rcp-actions-row { flex-wrap: nowrap; }
  .rcp-bar.rcp-actions-row .rcp-btn { flex: 1 1 auto; min-width: 0; padding: 9px 8px; overflow: hidden; text-overflow: ellipsis; text-align: center; }
  .rcp-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
  .rcp-fbtn { background: var(--card2, rgba(255,255,255,0.08)); color: var(--text, #eef2fb); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 999px; padding: 7px 14px; font-size: 14px; font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rcp-fbtn.on { background: var(--accent, #4A90D9); border-color: var(--accent, #4A90D9); color: #fff; }
  .rcp-picker { background: var(--card, #1b2133); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 12px; padding: 10px; margin-bottom: 12px; }
  .rcp-picker-list { display: flex; gap: 6px; flex-wrap: wrap; max-height: 230px; overflow-y: auto; margin-top: 8px; }
  .rcp-picker .rcp-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .rcp-chip.dim { opacity: 0.55; }
  .rcp-chip .n { opacity: 0.7; margin-left: 4px; }
  .rcp-chip.x::after { content: ' ✕'; opacity: 0.85; }
  .rcp-input, .rcp-ta { width: 100%; background: var(--card2, rgba(255,255,255,0.06)); color: var(--text, #eef2fb); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 10px; padding: 10px 12px; font: inherit; font-size: 15px; }
  /* iPhone Safari draws a date box wider than the width it is given (it sticks out of its sheet): take away its own look and pin it to its container */
  .rcp-input[type="date"], .rcp-input[type="time"] { -webkit-appearance: none; appearance: none; display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 46px; text-align: left; }
  .rcp-input[type="date"]::-webkit-date-and-time-value, .rcp-input[type="time"]::-webkit-date-and-time-value { text-align: left; min-height: 1.2em; }
  .rcp-field { min-width: 0; }
  .rcp-ta { resize: vertical; min-height: 90px; line-height: 1.4; }
  .rcp-input:focus, .rcp-ta:focus { outline: none; border-color: var(--accent, #4A90D9); }
  .rcp-btn { background: var(--card2, rgba(255,255,255,0.08)); color: var(--text, #eef2fb); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 10px; padding: 9px 14px; font-size: 14px; font-weight: 600; white-space: nowrap; }
  .rcp-btn.primary { background: var(--accent, #4A90D9); border-color: var(--accent, #4A90D9); color: #fff; }
  .rcp-btn.danger { color: #e0584c; }
  .rcp-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .rcp-chip { background: var(--card2, rgba(255,255,255,0.06)); color: var(--muted, #9aa6c0); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 999px; padding: 5px 12px; font-size: 13px; }
  .rcp-chips.all { max-height: 170px; overflow-y: auto; }
  .rcp-chip.on { background: var(--accent, #4A90D9); border-color: var(--accent, #4A90D9); color: #fff; }
  .rcp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .rcp-card { background: var(--card, #1b2133); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 12px; overflow: hidden; text-align: left; padding: 0; color: inherit; display: flex; flex-direction: column; }
  .rcp-pic { aspect-ratio: 4 / 3; background: var(--card2, rgba(255,255,255,0.06)); display: flex; align-items: center; justify-content: center; font-size: 34px; overflow: hidden; }
  .rcp-pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .rcp-cardbody { padding: 8px 10px 10px; min-width: 0; }
  .rcp-title { font-weight: 700; font-size: 14px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .rcp-meta { font-size: 12px; color: var(--muted, #9aa6c0); margin-top: 3px; display: flex; gap: 8px; flex-wrap: wrap; }
  .rcp-empty { color: var(--muted, #9aa6c0); text-align: center; padding: 36px 12px; line-height: 1.5; }
  .rcp-h1 { font-size: 24px; font-weight: 800; line-height: 1.2; margin: 6px 0 4px; }
  .rcp-desc { color: var(--muted, #9aa6c0); margin: 0 0 10px; line-height: 1.45; white-space: pre-wrap; }
  .rcp-hero { width: 100%; max-height: 280px; object-fit: cover; border-radius: 12px; display: block; margin-bottom: 10px; }
  .rcp-sec { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted, #9aa6c0); margin: 18px 0 8px; font-weight: 700; }
  .rcp-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 4px; }
  .rcp-cooking { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 8px 0 4px; padding: 8px 12px; border-radius: 10px; background: rgba(74,144,217,0.14); border: 1px solid rgba(74,144,217,0.4); font-size: 14px; }
  .rcp-cooking .grow { flex: 1 1 100%; min-width: 0; overflow-wrap: anywhere; }            /* the words take their own full line; the buttons sit under them and share the width */
  .rcp-cooking .rcp-btn { flex: 1 1 auto; text-align: center; }
  .rcp-check { display: flex; gap: 10px; align-items: flex-start; margin: 10px 0; font-size: 14px; line-height: 1.4; cursor: pointer; }
  .rcp-check input { flex: 0 0 20px; width: 20px; height: 20px; margin-top: 1px; accent-color: var(--accent, #4A90D9); }
  .rcp-by { font-size: 13px; color: var(--muted, #9aa6c0); }
  .rcp-serv { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
  .rcp-serv .rcp-btn { padding: 6px 14px; font-size: 18px; }
  .rcp-serv-val { min-width: 34px; text-align: center; font-size: 18px; font-weight: 700; }
  .rcp-group { font-weight: 700; margin: 12px 0 4px; font-size: 14px; }
  .rcp-ing { display: flex; gap: 10px; align-items: baseline; padding: 8px 4px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); font-size: 16px; cursor: pointer; user-select: none; }
  .rcp-ing .box { flex: 0 0 18px; height: 18px; border: 2px solid var(--muted, #9aa6c0); border-radius: 5px; align-self: center; }
  .rcp-ing.done { color: var(--muted, #9aa6c0); text-decoration: line-through; }
  .rcp-ing.done .box { background: var(--accent, #4A90D9); border-color: var(--accent, #4A90D9); }
  .rcp-step { display: flex; gap: 12px; padding: 10px 2px; font-size: 17px; line-height: 1.45; }
  .rcp-step .n { flex: 0 0 28px; height: 28px; border-radius: 50%; background: var(--accent, #4A90D9); color: #fff; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  .rcp-notes { white-space: pre-wrap; line-height: 1.45; background: var(--card, #1b2133); border-radius: 10px; padding: 10px 12px; }
  .rcp-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .rcp-field { margin-bottom: 12px; }
  .rcp-field > label { display: block; font-size: 12px; color: var(--muted, #9aa6c0); margin-bottom: 4px; font-weight: 600; }
  .rcp-help { font-size: 12px; color: var(--muted, #9aa6c0); margin-top: 3px; }
  .rcp-two { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .rcp-thumb { width: 96px; height: 72px; object-fit: cover; border-radius: 8px; display: block; }
  .rcp-time { white-space: nowrap; }
  .rcp-star { background: none; border: none; font-size: 24px; color: var(--muted, #9aa6c0); padding: 2px 6px; }
  .rcp-star.on { color: #f5b942; }
  .rcp-sheet { background: var(--card, #1b2133); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
  .rcp-pickrow { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; }
  .rcp-pickrow .rcp-pick { flex: 1 1 60%; min-width: 0; }
  .rcp-pantry-tag { font-size: 12px; color: var(--muted, #9aa6c0); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
  .rcp-link { background: none; border: none; color: var(--accent, #4A90D9); font-size: 12px; padding: 4px 2px; cursor: pointer; white-space: nowrap; }
  .rcp-pick { display: flex; gap: 10px; align-items: center; padding: 7px 2px; font-size: 15px; cursor: pointer; }
  .rcp-pick input { width: 20px; height: 20px; accent-color: var(--accent, #4A90D9); flex: 0 0 auto; }
  .rcp-note { background: var(--card, #1b2133); border: 1px solid var(--accent, #4A90D9); border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; font-size: 14px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .rcp-link { background: none; border: none; color: var(--accent, #4A90D9); font-weight: 700; padding: 2px 4px; text-decoration: underline; }
  `;
  function ensureStyle() {
    if (document.getElementById('rcp-style')) return;
    const s = document.createElement('style'); s.id = 'rcp-style'; s.textContent = CSS; document.head.appendChild(s);
  }

  // A photo from a phone can be several MB: shrink it before upload (the server keeps whatever it is given, and mirrors copy it).
  async function shrink(file, max) {
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale >= 1 && file.size < 1500000) return file;
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.85));
    } catch { return file; }
  }

  // What the person was doing is kept in this browser, so leaving the page (another app, another tab, a reload) never throws away a recipe being typed:
  // the editor saves a draft as you type, and the screen reopens on the recipe you had open.
  const KEY_DRAFT = 'rcp_draft_v1', KEY_VIEW = 'rcp_view_v1';
  const TAGS_SHOWN = 8;
  const COURSES = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['appetizer', 'Appetizer'], ['main', 'Main dish'], ['side', 'Side dish'], ['soup', 'Soup'], ['salad', 'Salad'], ['dessert', 'Dessert'], ['drink', 'Drink'], ['snack', 'Snack']];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: the screens still work */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function mount(root, opts) {
    ensureStyle();
    const api = opts.api, upload = opts.upload;
    const say = opts.toast || (() => {});
    const ask = opts.confirm || ((t) => window.confirm(t));
    const S = { view: 'list', q: '', tag: '', course: '', fav: false, list: [], tags: [], courses: [], recipe: null, servings: 0, done: new Set(), photoFile: null, removePhoto: false, token: 0, flushDraft: null, picker: '', tagQ: '', lib: null, libQ: '', libCourse: '', libPicker: false, libRows: [], libTotal: 0, libOpen: null };
    root.classList.add('rcp-root');
    api('/api/recipe-library/status').then((st) => { if (st && st.available) { S.lib = st; if (S.view === 'list') drawList(); } }).catch(() => {});

    const fail = (r, fallback) => { say(r && r.error ? '❌ ' + r.error : fallback); };
    const inputs = (sel) => root.querySelectorAll(sel);

    // ── the list ──────────────────────────────────────────────────────────────────────────────────────────
    async function loadList() {
      const mine = ++S.token;
      S.view = 'list'; store.del(KEY_VIEW);
      const qs = [S.q ? `q=${encodeURIComponent(S.q)}` : '', S.tag ? `tag=${encodeURIComponent(S.tag)}` : '', S.course ? `course=${encodeURIComponent(S.course)}` : '', S.fav ? 'favorite=1' : ''].filter(Boolean).join('&');
      const [list, tags, courses] = await Promise.all([api('/api/recipes' + (qs ? '?' + qs : '')).catch(() => null), api('/api/recipes/tags').catch(() => null), api('/api/recipes/courses').catch(() => null)]);
      if (mine !== S.token || S.view !== 'list') return;
      S.list = Array.isArray(list) ? list : []; S.tags = Array.isArray(tags) ? tags : []; S.courses = Array.isArray(courses) ? courses : [];
      drawList();
    }
    function drawList() {
      const filtering = !!(S.q || S.tag || S.course || S.fav);
      const courseName = (c) => (COURSES.find((x) => x[0] === c) || [c, c])[1];
      const cards = S.list.map((r) => `
        <button class="rcp-card" data-id="${r.id}">
          <div class="rcp-pic">${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy" draggable="false">` : '🍳'}</div>
          <div class="rcp-cardbody"><div class="rcp-title">${esc(r.title)}</div>
            <div class="rcp-meta">${r.prep_min + r.cook_min > 0 ? minutes(r.prep_min + r.cook_min) : ''}${r.favorite ? '<span>★</span>' : ''}</div></div>
        </button>`).join('');
      const empty = filtering ? `<div class="rcp-empty">No recipes match.</div>`
        : `<div class="rcp-empty"><div>No recipes yet.</div><div>Tap “+ New recipe” to add your first one.</div></div>`;
      const counts = new Map(S.courses.map((c) => [c.course, c.count]));
      const courseBtn = `<button class="rcp-fbtn rcp-course-btn ${S.course ? 'on' : ''}">${S.course ? esc(courseName(S.course)) : 'Course'} ▾</button>`;
      const tagBtn = `<button class="rcp-fbtn rcp-tag-btn ${S.tag ? 'on' : ''}">${S.tag ? esc(S.tag) : 'Tags'} ▾</button>`;
      let picker = '';
      if (S.picker === 'course') {
        picker = `<div class="rcp-picker"><div class="rcp-picker-list">
          <button class="rcp-chip rcp-course-chip ${S.course ? '' : 'on'}" data-course="">All courses</button>
          ${COURSES.map((c) => `<button class="rcp-chip rcp-course-chip ${S.course === c[0] ? 'on' : ''} ${counts.has(c[0]) ? '' : 'dim'}" data-course="${c[0]}">${esc(c[1])}${counts.has(c[0]) ? `<span class="n">${counts.get(c[0])}</span>` : ''}</button>`).join('')}
        </div></div>`;
      } else if (S.picker === 'tag') {
        const q = S.tagQ.trim().toLowerCase();
        const shown = S.tags.filter((t) => !q || t.tag.toLowerCase().includes(q));
        picker = `<div class="rcp-picker"><input class="rcp-input rcp-tag-q" type="search" placeholder="Find a tag" value="${esc(S.tagQ)}" autocomplete="off" autocapitalize="none" spellcheck="false">
          <div class="rcp-picker-list"><button class="rcp-chip rcp-tag-chip ${S.tag ? '' : 'on'}" data-tag="">All tags</button>
          ${shown.map((t) => `<button class="rcp-chip rcp-tag-chip ${S.tag === t.tag ? 'on' : ''}" data-tag="${esc(t.tag)}">${esc(t.tag)}<span class="n">${t.count}</span></button>`).join('')}
          ${S.tags.length && !shown.length ? '<span class="rcp-help">No tag matches.</span>' : ''}${S.tags.length ? '' : '<span class="rcp-help">No tags yet.</span>'}</div></div>`;
      }
      root.innerHTML = `<div class="rcp">
        <div class="rcp-bar"><input class="rcp-input rcp-search" type="search" placeholder="Search recipes" value="${esc(S.q)}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
        <div class="rcp-bar rcp-actions-row"><button class="rcp-btn rcp-import">Import</button>${libOn() ? '<button class="rcp-btn rcp-community">Community</button>' : ''}<button class="rcp-btn primary rcp-new">+ New recipe</button></div>
        <div class="rcp-filters">${courseBtn}${tagBtn}<button class="rcp-fbtn rcp-fav-chip ${S.fav ? 'on' : ''}">★ Favorites</button></div>
        ${picker}
        ${S.list.length ? `<div class="rcp-grid">${cards}</div>` : empty}
      </div>`;
      const search = root.querySelector('.rcp-search');
      let timer = null;
      search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { S.q = search.value.trim(); loadList().then(() => { const s = root.querySelector('.rcp-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }); }, 220); });
      root.querySelector('.rcp-new').addEventListener('click', () => openEditor(null));
      root.querySelector('.rcp-import').addEventListener('click', () => openImport());
      const comm = root.querySelector('.rcp-community'); if (comm) comm.addEventListener('click', () => openLibrary());
      root.querySelector('.rcp-fav-chip').addEventListener('click', () => { S.fav = !S.fav; S.picker = ''; loadList(); });
      root.querySelector('.rcp-course-btn').addEventListener('click', () => { S.picker = S.picker === 'course' ? '' : 'course'; drawList(); });
      root.querySelector('.rcp-tag-btn').addEventListener('click', () => { S.picker = S.picker === 'tag' ? '' : 'tag'; S.tagQ = ''; drawList(); });
      inputs('.rcp-course-chip').forEach((x) => x.addEventListener('click', () => { S.course = x.dataset.course; S.picker = ''; loadList(); }));
      inputs('.rcp-tag-chip').forEach((x) => x.addEventListener('click', () => { S.tag = x.dataset.tag; S.picker = ''; loadList(); }));
      const tq = root.querySelector('.rcp-tag-q');
      if (tq) { tq.addEventListener('input', () => { S.tagQ = tq.value; drawList(); const n = root.querySelector('.rcp-tag-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }
      inputs('.rcp-card').forEach((b) => b.addEventListener('click', () => openRecipe(Number(b.dataset.id))));
    }

    // ── the community library: browse, copy a recipe into this box, report one ───────────────────────────────────
    // Shown only when the server says there is a library (the status is asked for once, when this screen opens).
    const libOn = () => !!(S.lib && S.lib.available);
    const libMeta = (r) => [r.author ? `<span class="rcp-by">${esc(r.author)}${r.location ? ' · ' + esc(r.location) : ''}</span>` : '', r.prep_min + r.cook_min > 0 ? minutes(r.prep_min + r.cook_min) : ''].join('');
    async function openLibrary() {
      S.view = 'library'; S.token++; store.del(KEY_VIEW);
      S.libOpen = null;
      drawLibrary(true);
      await loadLibrary(false);
    }
    async function loadLibrary(more) {
      const mine = S.token;
      const qs = [S.libQ ? `q=${encodeURIComponent(S.libQ)}` : '', S.libCourse ? `course=${encodeURIComponent(S.libCourse)}` : '', 'limit=24', more ? `offset=${S.libRows.length}` : ''].filter(Boolean).join('&');
      const r = await api('/api/recipe-library/recipes?' + qs).catch(() => null);
      if (mine !== S.token || S.view !== 'library') return;
      if (bad(r) || !Array.isArray(r.recipes)) { S.libErr = (r && r.error) || 'The community library could not be reached right now.'; if (!more) { S.libRows = []; S.libTotal = 0; } drawLibrary(false); return; }
      S.libErr = '';
      S.libRows = more ? S.libRows.concat(r.recipes) : r.recipes; S.libTotal = r.total || 0;
      drawLibrary(false);
    }
    function drawLibrary(loading) {
      const cards = S.libRows.map((r) => `
        <button class="rcp-card" data-lid="${esc(r.id)}">
          <div class="rcp-pic">${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy" draggable="false">` : '🍳'}</div>
          <div class="rcp-cardbody"><div class="rcp-title">${esc(r.title)}</div><div class="rcp-meta">${libMeta(r)}</div></div>
        </button>`).join('');
      const body = loading ? `<div class="rcp-empty">Loading…</div>`
        : S.libErr ? `<div class="rcp-empty"><div>${esc(S.libErr)}</div><div style="margin-top:10px"><button class="rcp-btn rcp-lib-retry">Try again</button></div></div>`
        : S.libRows.length ? `<div class="rcp-grid">${cards}</div>${S.libRows.length < S.libTotal ? '<div class="rcp-row" style="justify-content:center;margin-top:12px"><button class="rcp-btn rcp-lib-more">Show more</button></div>' : ''}`
        : `<div class="rcp-empty">${S.libQ || S.libCourse ? 'No recipes match.' : 'No recipes have been shared yet.'}</div>`;
      root.innerHTML = `<div class="rcp">
        <div class="rcp-bar"><input class="rcp-input rcp-search rcp-lib-search" type="search" placeholder="Search community recipes" value="${esc(S.libQ)}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
        <div class="rcp-filters"><button class="rcp-btn rcp-lib-back">‹ My recipes</button><button class="rcp-fbtn rcp-lib-course-btn ${S.libCourse ? 'on' : ''}">${S.libCourse ? esc((COURSES.find((c) => c[0] === S.libCourse) || [0, S.libCourse])[1]) : 'Course'} ▾</button></div>
        ${S.libPicker ? `<div class="rcp-picker"><div class="rcp-picker-list"><button class="rcp-chip rcp-lib-course ${S.libCourse ? '' : 'on'}" data-course="">All courses</button>${COURSES.map((c) => `<button class="rcp-chip rcp-lib-course ${S.libCourse === c[0] ? 'on' : ''}" data-course="${c[0]}">${esc(c[1])}</button>`).join('')}</div></div>` : ''}
        ${body}
      </div>`;
      root.querySelector('.rcp-lib-back').addEventListener('click', () => loadList());
      const search = root.querySelector('.rcp-lib-search');
      let timer = null;
      search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { S.libQ = search.value.trim(); loadLibrary(false).then(() => { const x = root.querySelector('.rcp-lib-search'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }); }, 300); });
      const lcb = root.querySelector('.rcp-lib-course-btn'); if (lcb) lcb.addEventListener('click', () => { S.libPicker = !S.libPicker; drawLibrary(false); });
      inputs('.rcp-lib-course').forEach((b) => b.addEventListener('click', () => { S.libCourse = b.dataset.course; S.libPicker = false; loadLibrary(false); }));
      inputs('.rcp-card').forEach((b) => b.addEventListener('click', () => openLibRecipe(b.dataset.lid)));
      const more = root.querySelector('.rcp-lib-more'); if (more) more.addEventListener('click', () => { more.disabled = true; loadLibrary(true); });
      const retry = root.querySelector('.rcp-lib-retry'); if (retry) retry.addEventListener('click', () => { drawLibrary(true); loadLibrary(false); });
    }

    async function openLibRecipe(id) {
      const mine = ++S.token;
      const r = await api('/api/recipe-library/recipes/' + encodeURIComponent(id)).catch(() => null);
      if (mine !== S.token) return;
      if (bad(r)) { fail(r, '❌ That recipe could not be opened.'); S.token++; S.view = 'library'; return drawLibrary(false); }
      S.view = 'libdetail'; S.libOpen = r;
      let n = 0;
      const ings = (r.ingredients || []).map((l) => (/:\s*$/.test(l) ? `<div class="rcp-group">${esc(l.replace(/:\s*$/, ''))}</div>` : `<div class="rcp-ing" style="cursor:default"><span>${esc(l)}</span></div>`)).join('');
      const steps = (r.steps || []).map((st) => `<div class="rcp-step"><span class="n">${++n}</span><span>${esc(st.text)}${st.timer_sec ? ` <span class="rcp-time">⏱ ${Math.round(st.timer_sec / 60) || 1} <span>min</span></span>` : ''}</span></div>`).join('');
      root.innerHTML = `<div class="rcp">
        <div class="rcp-bar"><button class="rcp-btn rcp-lib-back">‹ Community</button></div>
        ${r.photo ? `<img class="rcp-hero" src="${esc(r.photo)}" alt="" draggable="false">` : ''}
        <div class="rcp-h1">${esc(r.title)}</div>
        <div class="rcp-by"><span>Submitted by</span> ${esc(r.author)}${r.location ? ` <span>from</span> ${esc(r.location)}` : ''}</div>
        ${r.source ? `<div class="rcp-by"><span>Adapted from</span> ${/^https?:\/\//.test(r.source_url || '') ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent,#4A90D9)">${esc(r.source)}</a>` : esc(r.source)}</div>` : ''}
        ${r.description ? `<p class="rcp-desc">${esc(r.description)}</p>` : ''}
        <div class="rcp-meta" style="font-size:13px;gap:12px">${r.prep_min ? `<span><span>Prep</span> ${Number(r.prep_min)} <span>min</span></span>` : ''}${r.cook_min ? `<span><span>Cook</span> ${Number(r.cook_min)} <span>min</span></span>` : ''}${r.servings ? `<span><span>Serves</span> ${esc(String(Math.round(r.servings * 100) / 100))}</span>` : ''}</div>
        <div class="rcp-actions"><button class="rcp-btn primary rcp-lib-add">Add to my recipes</button><button class="rcp-btn rcp-lib-report">Report</button></div>
        <div id="rcp-sheet-host"></div>
        <div class="rcp-sec">Ingredients</div>${ings}
        <div class="rcp-sec">Steps</div>${steps}
        ${r.notes ? `<div class="rcp-sec">Notes</div><div class="rcp-notes">${esc(r.notes)}</div>` : ''}
      </div>`;
      root.querySelector('.rcp-lib-back').addEventListener('click', () => { S.token++; S.view = 'library'; S.libOpen = null; drawLibrary(false); });
      root.querySelector('.rcp-lib-add').addEventListener('click', async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        const res = await api('/api/recipe-library/recipes/' + encodeURIComponent(r.id) + '/add', { method: 'POST', body: JSON.stringify({}) }).catch(() => null);
        if (bad(res)) { btn.disabled = false; return fail(res, '❌ The recipe could not be added.'); }
        say('Added to your recipes');
        openRecipe(res.id);
      });
      root.querySelector('.rcp-lib-report').addEventListener('click', () => {
        const host = root.querySelector('#rcp-sheet-host');
        host.innerHTML = `<div class="rcp-sheet">
          <div class="rcp-sec" style="margin-top:0">Report this recipe</div>
          <div class="rcp-field"><label>Why</label><select class="rcp-input" id="rcp-rep-reason"><option value="copyright">It was copied from somewhere</option><option value="offensive">It is offensive</option><option value="spam">It is spam or an advert</option><option value="other">Something else</option></select></div>
          <div class="rcp-field"><label>Anything to add (optional)</label><textarea class="rcp-ta" id="rcp-rep-note" rows="2" maxlength="300"></textarea></div>
          <div class="rcp-row"><button class="rcp-btn primary rcp-rep-send">Send report</button><button class="rcp-btn rcp-rep-cancel">Cancel</button></div></div>`;
        host.querySelector('.rcp-rep-cancel').addEventListener('click', () => { host.innerHTML = ''; });
        host.querySelector('.rcp-rep-send').addEventListener('click', async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          const res = await api('/api/recipe-library/recipes/' + encodeURIComponent(r.id) + '/report', { method: 'POST', body: JSON.stringify({ reason: host.querySelector('#rcp-rep-reason').value, note: host.querySelector('#rcp-rep-note').value }) }).catch(() => null);
          if (bad(res)) { btn.disabled = false; return fail(res, '❌ The report could not be sent.'); }
          say('Thanks. We will take a look.'); host.innerHTML = '';
        });
        host.scrollIntoView && host.scrollIntoView({ block: 'nearest' });
      });
    }

    // ── getting a recipe in from somewhere else ───────────────────────────────────────────────────────────
    function openImport() {
      S.view = 'import'; S.token++; store.del(KEY_VIEW);
      root.innerHTML = `<div class="rcp">
        <div class="rcp-bar"><button class="rcp-btn rcp-cancel">Cancel</button></div>
        <div class="rcp-h1">Import a recipe</div>
        <div class="rcp-field" style="margin-top:14px"><label>From a web address</label><div class="rcp-row" style="flex-wrap:nowrap"><input class="rcp-input" id="rcp-i-url" type="url" inputmode="url" placeholder="https://" autocapitalize="none" autocorrect="off" spellcheck="false"><button class="rcp-btn primary" id="rcp-i-url-go">Read recipe</button></div></div>
        <div class="rcp-help" style="text-align:center;margin:10px 0">or</div>
        <div class="rcp-field"><label>Paste the recipe text</label><textarea class="rcp-ta" id="rcp-i-text" rows="10" placeholder="Pancakes&#10;Ingredients&#10;2 cups flour&#10;2 eggs&#10;Directions&#10;Mix. Fry."></textarea><div class="rcp-row" style="margin-top:8px"><button class="rcp-btn primary" id="rcp-i-text-go">Read text</button></div></div>
        <div class="rcp-help" id="rcp-i-msg" role="status" style="min-height:20px;font-size:14px"></div>
      </div>`;
      root.querySelector('.rcp-cancel').addEventListener('click', () => loadList());
      const msg = root.querySelector('#rcp-i-msg');
      const go = async (path, body) => {
        inputs('#rcp-i-url-go, #rcp-i-text-go').forEach((b) => { b.disabled = true; });
        msg.style.color = ''; msg.textContent = 'Reading…';
        const r = await api(path, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
        if (bad(r)) {
          inputs('#rcp-i-url-go, #rcp-i-text-go').forEach((b) => { b.disabled = false; });
          msg.style.color = '#e0584c'; msg.textContent = (r && r.error) || 'The recipe could not be read.';
          return;
        }
        openEditor(null, { prefill: r });
      };
      root.querySelector('#rcp-i-url-go').addEventListener('click', () => { const u = root.querySelector('#rcp-i-url').value.trim(); if (u) go('/api/recipes/import-url', { url: u }); else { msg.style.color = '#e0584c'; msg.textContent = 'Enter a web address first.'; } });
      root.querySelector('#rcp-i-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); root.querySelector('#rcp-i-url-go').click(); } });
      root.querySelector('#rcp-i-text-go').addEventListener('click', () => { const t = root.querySelector('#rcp-i-text').value; if (t.trim()) go('/api/recipes/parse-text', { text: t }); else { msg.style.color = '#e0584c'; msg.textContent = 'Paste the recipe text first.'; } });
    }

    // ── one recipe ────────────────────────────────────────────────────────────────────────────────────────
    async function openRecipe(id, servings) {
      const mine = ++S.token;
      const r = await api(`/api/recipes/${id}${servings ? `?servings=${encodeURIComponent(servings)}` : ''}`).catch(() => null);
      if (mine !== S.token) return;
      if (bad(r)) { fail(r, '❌ That recipe could not be opened.'); return loadList(); }
      if (S.recipe && S.recipe.id !== r.id) S.done = new Set();
      S.view = 'detail'; S.recipe = r; S.servings = r.servings;
      store.set(KEY_VIEW, { id: r.id, servings: Math.abs(r.servings - r.base_servings) > 1e-9 ? r.servings : 0, at: Date.now() });
      drawRecipe();
    }
    const stepServ = (v, dir) => { const next = v + dir; return next < 1 && dir < 0 ? Math.max(0.5, v - 0.5) : Math.max(0.5, next); };
    function drawRecipe() {
      const r = S.recipe;
      let group = '';
      const ings = r.ingredients.map((i) => {
        const showHead = !!i.group_label && i.group_label !== group;
        group = i.group_label || '';
        return `${showHead ? `<div class="rcp-group">${esc(i.group_label)}</div>` : ''}<div class="rcp-ing ${S.done.has(i.id) ? 'done' : ''}" data-i="${i.id}" role="checkbox" aria-checked="${S.done.has(i.id)}" tabindex="0"><span class="box"></span><span>${esc(i.display)}</span></div>`;
      }).join('');
      const steps = r.steps.map((s, n) => `<div class="rcp-step"><span class="n">${n + 1}</span><span>${esc(s.text)}${s.timer_sec ? ` <span class="rcp-time">⏱ ${Math.round(s.timer_sec / 60) || 1} <span>min</span></span>` : ''}</span></div>`).join('');
      const changed = Math.abs(S.servings - r.base_servings) > 1e-9;
      root.innerHTML = `<div class="rcp">
        <div class="rcp-bar"><button class="rcp-btn rcp-back">‹ All recipes</button><span style="flex:1"></span><button class="rcp-star ${r.favorite ? 'on' : ''}" aria-label="Favorite" title="Favorite">${r.favorite ? '★' : '☆'}</button></div>
        ${r.photo ? `<img class="rcp-hero" src="${esc(r.photo)}" alt="" draggable="false">` : (r.origin === 'shared' && r.source_url ? '<div class="rcp-row" style="margin:0 0 8px"><button class="rcp-btn rcp-get-pic">Get the picture from the original page</button></div>' : '')}
        <div class="rcp-h1">${esc(r.title)}</div>
        ${r.description ? `<p class="rcp-desc">${esc(r.description)}</p>` : ''}
        <div class="rcp-meta" style="font-size:13px;gap:12px">${r.course ? `<span class="rcp-chip on" style="padding:2px 9px;font-size:12px">${esc((COURSES.find((x) => x[0] === r.course) || [r.course, r.course])[1])}</span>` : ''}${r.prep_min ? `<span><span>Prep</span> ${minutes(r.prep_min)}</span>` : ''}${r.cook_min ? `<span><span>Cook</span> ${minutes(r.cook_min)}</span>` : ''}${r.tags.map((t) => `<span class="rcp-chip" style="padding:2px 9px;font-size:12px">${esc(t)}</span>`).join('')}</div>
        ${r.source_url || r.source_name ? `<div class="rcp-meta" style="margin-top:6px"><span>Source</span> ${r.source_url ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent,#4A90D9)">${esc(r.source_name || r.source_url)}</a>` : esc(r.source_name)}</div>` : ''}
        <div class="rcp-sec">Servings</div>
        <div class="rcp-serv"><button class="rcp-btn rcp-serv-minus" aria-label="Fewer servings">−</button><span class="rcp-serv-val">${esc(String(Math.round(S.servings * 100) / 100))}</span><button class="rcp-btn rcp-serv-plus" aria-label="More servings">+</button>${changed ? `<button class="rcp-btn rcp-serv-reset">Reset</button>` : ''}</div>
        ${changed ? `<div class="rcp-help"><span>This recipe makes</span> ${esc(String(r.base_servings))}</div>` : ''}
        <div class="rcp-actions"><button class="rcp-btn primary rcp-cook">Cook on a screen</button><button class="rcp-btn rcp-shop">Add to shopping list</button><button class="rcp-btn rcp-plan">Plan a meal</button><button class="rcp-btn rcp-print">Print</button><button class="rcp-btn rcp-edit">Edit</button></div>
        <div id="rcp-cooking-host"></div>
        <div id="rcp-sheet-host"></div>
        <div class="rcp-sec">Ingredients</div>
        ${ings || '<div class="rcp-help">No ingredients.</div>'}
        <div class="rcp-sec">Steps</div>
        ${steps || '<div class="rcp-help">No steps.</div>'}
        ${r.notes ? `<div class="rcp-sec">Notes</div><div class="rcp-notes">${esc(r.notes)}</div>` : ''}
        ${communityHtml(r)}
        <div class="rcp-row" style="margin-top:26px"><button class="rcp-btn danger rcp-delete">Delete</button></div>
      </div>`;
      root.querySelector('.rcp-back').addEventListener('click', () => loadList());
      refreshCooking();
      wireCommunity(r);
      const getPic = root.querySelector('.rcp-get-pic');
      if (getPic) getPic.addEventListener('click', async () => {
        getPic.disabled = true; getPic.textContent = 'Getting the picture…';
        const res = await api(`/api/recipes/${r.id}/photo-from-source`, { method: 'POST', body: JSON.stringify({}) }).catch(() => null);
        if (bad(res)) { getPic.disabled = false; getPic.textContent = 'Get the picture from the original page'; return fail(res, '❌ No picture could be added.'); }
        say('Picture added');
        openRecipe(r.id, S.servings === r.base_servings ? 0 : S.servings);
      });
      clearInterval(S.cookIv);
      S.cookIv = setInterval(() => { if (S.view === 'detail' && S.recipe && S.recipe.id === r.id && root.isConnected) refreshCooking(); else clearInterval(S.cookIv); }, 15000);
      root.querySelector('.rcp-star').addEventListener('click', async () => {
        const res = await api(`/api/recipes/${r.id}`, { method: 'PUT', body: JSON.stringify({ favorite: !r.favorite }) }).catch(() => null);
        if (bad(res)) return fail(res, '❌ The recipe could not be saved.');
        openRecipe(r.id, S.servings === r.base_servings ? 0 : S.servings);
      });
      const scale = (v) => openRecipe(r.id, v);
      root.querySelector('.rcp-serv-minus').addEventListener('click', () => scale(stepServ(S.servings, -1)));
      root.querySelector('.rcp-serv-plus').addEventListener('click', () => scale(stepServ(S.servings, 1)));
      const reset = root.querySelector('.rcp-serv-reset'); if (reset) reset.addEventListener('click', () => scale(0));
      inputs('.rcp-ing').forEach((el) => {
        const flip = () => { const id = Number(el.dataset.i); if (S.done.has(id)) S.done.delete(id); else S.done.add(id); el.classList.toggle('done', S.done.has(id)); el.setAttribute('aria-checked', String(S.done.has(id))); };
        el.addEventListener('click', flip); el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
      });
      root.querySelector('.rcp-cook').addEventListener('click', () => openCook());
      root.querySelector('.rcp-shop').addEventListener('click', () => openShopping());
      root.querySelector('.rcp-plan').addEventListener('click', () => openPlan());
      root.querySelector('.rcp-print').addEventListener('click', () => printRecipe());
      root.querySelector('.rcp-edit').addEventListener('click', () => openEditor(r));
      root.querySelector('.rcp-delete').addEventListener('click', async () => {
        if (!ask(r.library ? 'This recipe is shared with the community. Delete it and stop sharing it? This cannot be undone.' : 'Delete this recipe? This cannot be undone.')) return;
        if (r.library) {
          const un = await api(`/api/recipes/${r.id}/share`, { method: 'DELETE' }).catch(() => null);
          if (bad(un)) return fail(un, '❌ Sharing could not be stopped, so the recipe was not deleted.');
        }
        const res = await api(`/api/recipes/${r.id}`, { method: 'DELETE' }).catch(() => null);
        if (bad(res)) return fail(res, '❌ The recipe could not be deleted.');
        say('Recipe deleted'); S.recipe = null; loadList();
      });
    }

    // Sharing a recipe you wrote with the community (and updating or stopping it). Recipes imported from a web page or copied from the community cannot be shared.
    function communityHtml(r) {
      if (!libOn()) return '';
      if (r.library) return `<div class="rcp-sec">Community</div>
        <div class="rcp-cooking"><span class="grow"><span>Shared with the community as</span> <b>${esc(r.library.author || 'A Piazza HQ household')}</b>${r.library.location ? ` <span>from</span> ${esc(r.library.location)}` : ''}</span><button class="rcp-btn rcp-share-update">Update shared copy</button><button class="rcp-btn rcp-share-stop">Stop sharing</button></div>
        <div id="rcp-share-host"></div>`;
      if ((r.origin || 'own') === 'shared') return `<div class="rcp-sec">Community</div><div class="rcp-help">This recipe was copied from the community, so it is already in the library.</div>`;
      return `<div class="rcp-sec">Community</div><div class="rcp-help" style="margin:0 0 8px">Share this recipe so other Piazza HQ households can copy it.</div>
        <button class="rcp-btn rcp-share-open">Share with the community</button><div id="rcp-share-host"></div>`;
    }
    function wireCommunity(r) {
      const open = root.querySelector('.rcp-share-open'), upd = root.querySelector('.rcp-share-update'), stop = root.querySelector('.rcp-share-stop');
      const sheet = (updating) => {
        const host = root.querySelector('#rcp-share-host'); if (!host) return;
        const name = (updating && r.library ? r.library.author : store.get('rcp_author')) || '';
        const place = (updating && r.library ? r.library.location : store.get('rcp_author_loc')) || '';
        host.innerHTML = `<div class="rcp-sheet" style="margin-top:8px">
          <div class="rcp-sec" style="margin-top:0">${updating ? 'Update the shared copy' : 'Share with the community'}</div>
          <div class="rcp-field"><label>Your name (optional)</label><input class="rcp-input" id="rcp-share-name" maxlength="40" value="${esc(name)}" placeholder="Jane Doe" autocomplete="off"></div>
          <div class="rcp-field"><label>Where you are from (optional)</label><input class="rcp-input" id="rcp-share-loc" maxlength="60" value="${esc(place)}" placeholder="Atlanta, GA" autocomplete="off"><div class="rcp-help">Shown like “Submitted by Jane Doe from Atlanta, GA”. Leave either one blank to keep it private. Never your email or anything else about your household.</div></div>
          ${r.notes ? '<label class="rcp-check"><input type="checkbox" id="rcp-share-notes"><span>Include my notes</span></label>' : ''}
          ${updating ? '' : `<label class="rcp-check"><input type="checkbox" id="rcp-share-ok"><span>${esc((S.lib && S.lib.terms_text) || '')}</span></label>`}
          <div class="rcp-row"><button class="rcp-btn primary rcp-share-go" ${updating ? '' : 'disabled'}>${updating ? 'Update' : 'Share'}</button><button class="rcp-btn rcp-share-cancel">Cancel</button></div></div>`;
        const go = host.querySelector('.rcp-share-go'), ok = host.querySelector('#rcp-share-ok');
        if (ok) ok.addEventListener('change', () => { go.disabled = !ok.checked; });
        host.querySelector('.rcp-share-cancel').addEventListener('click', () => { host.innerHTML = ''; });
        go.addEventListener('click', async () => {
          const author = host.querySelector('#rcp-share-name').value.trim();
          const place = host.querySelector('#rcp-share-loc').value.trim();
          go.disabled = true;
          const body = { author_name: author, author_location: place, include_notes: !!(host.querySelector('#rcp-share-notes') && host.querySelector('#rcp-share-notes').checked), ...(updating ? {} : { terms_accepted: true }) };
          const res = await api(`/api/recipes/${r.id}/share`, { method: updating ? 'PUT' : 'POST', body: JSON.stringify(body) }).catch(() => null);
          if (bad(res)) { go.disabled = false; if (updating && res && /no longer/.test(String(res.error))) openRecipe(r.id, S.servings === r.base_servings ? 0 : S.servings); return fail(res, updating ? '❌ The shared copy could not be updated.' : '❌ The recipe could not be shared.'); }
          store.set('rcp_author', author); store.set('rcp_author_loc', place);
          say(res.photo_skipped ? (updating ? 'Updated. The picture was too large to share.' : 'Shared. The picture was too large, so it was left out.') : (updating ? 'Shared copy updated' : 'Shared with the community'));
          openRecipe(r.id, S.servings === r.base_servings ? 0 : S.servings);
        });
      };
      if (open) open.addEventListener('click', () => sheet(false));
      if (upd) upd.addEventListener('click', () => sheet(true));
      if (stop) stop.addEventListener('click', async () => {
        if (!ask('Stop sharing this recipe? It is removed from the community library. Households that already copied it keep their copy.')) return;
        const res = await api(`/api/recipes/${r.id}/share`, { method: 'DELETE' }).catch(() => null);
        if (bad(res)) return fail(res, '❌ Sharing could not be stopped.');
        say('No longer shared');
        openRecipe(r.id, S.servings === r.base_servings ? 0 : S.servings);
      });
    }

    // Which screens are cooking this recipe right now, each with a Stop (so it never takes starting it again to get rid of it).
    async function refreshCooking() {
      const r = S.recipe, host = root.querySelector('#rcp-cooking-host');
      if (!r || !host) return;
      const all = await api('/api/screens').catch(() => null);
      if (!S.recipe || S.recipe.id !== r.id || S.view !== 'detail' || !root.contains(host)) return;
      const cooking = (Array.isArray(all) ? all : []).filter((x) => Number(x.presentation_recipe_id) === Number(r.id) && !String(x.device_id).startsWith('preview_'));
      host.innerHTML = cooking.map((x) => `<div class="rcp-cooking"><span class="grow">🍳 <span>Cooking on</span> <b>${esc(x.name || x.device_id)}</b></span><button class="rcp-btn rcp-cook-stop" data-id="${esc(x.device_id)}">Stop</button></div>`).join('');
      host.querySelectorAll('.rcp-cook-stop').forEach((b) => b.addEventListener('click', async () => {
        host.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        const res = await api(`/api/screens/${encodeURIComponent(b.dataset.id)}/presentation`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => null);
        if (bad(res)) { host.querySelectorAll('button').forEach((x) => { x.disabled = false; }); return fail(res, '❌ The screen could not be stopped.'); }
        say('Stopped');
        refreshCooking();
      }));
    }

    // Cook it on a screen: pick the screen; the recipe is shown there page by page (cover, ingredients, a page per step) at the servings shown here.
    async function openCook() {
      const r = S.recipe, host = root.querySelector('#rcp-sheet-host');
      if (!r || !host) return;
      const all = await api('/api/screens').catch(() => null);
      const screens = (Array.isArray(all) ? all : []).filter((s) => s.name && s.online && !String(s.device_id).startsWith('preview_'));
      host.innerHTML = `<div class="rcp-sheet">
        <div class="rcp-sec" style="margin-top:0">Cook on a screen</div>
        ${screens.length ? screens.map((s) => `<button class="rcp-btn rcp-cook-pick" data-id="${esc(s.device_id)}" style="display:block;width:100%;text-align:left;margin-bottom:6px">🖥️ ${esc(s.name)}</button>`).join('') : '<div class="rcp-help">No screens are on right now. Connect a display and give it a name in Devices first.</div>'}
        <div class="rcp-help" style="margin:6px 0 10px"><span>Servings</span> ${esc(String(Math.round(S.servings * 100) / 100))}</div>
        <div class="rcp-row"><button class="rcp-btn rcp-cook-cancel">Cancel</button></div>
      </div>`;
      host.querySelector('.rcp-cook-cancel').addEventListener('click', () => { host.innerHTML = ''; });
      host.querySelectorAll('.rcp-cook-pick').forEach((b) => b.addEventListener('click', async () => {
        host.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        const res = await api(`/api/screens/${encodeURIComponent(b.dataset.id)}/presentation`, { method: 'POST', body: JSON.stringify({ action: 'start', kind: 'recipe', id: r.id, servings: S.servings }) }).catch(() => null);
        if (bad(res)) { host.querySelectorAll('button').forEach((x) => { x.disabled = false; }); return fail(res, '❌ The recipe could not be started on that screen.'); }
        say(res.delivered ? 'Started on the screen' : 'Saved. The screen starts when it next connects.');
        host.innerHTML = '';
        refreshCooking();
        if (opts.afterCook) { try { opts.afterCook(b.dataset.id); } catch { /* the screen is cooking either way */ } }
      }));
      host.scrollIntoView && host.scrollIntoView({ block: 'nearest' });
    }

    // Put it on the meal plan: a day and a meal; the planned meal is named after the recipe and linked to it (so it can be opened or cooked from the plan).
    function openPlan() {
      const r = S.recipe, host = root.querySelector('#rcp-sheet-host');
      if (!r || !host) return;
      const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      host.innerHTML = `<div class="rcp-sheet">
        <div class="rcp-sec" style="margin-top:0">Plan a meal</div>
        <div class="rcp-field"><label>Day</label><input type="date" class="rcp-input" id="rcp-plan-date" value="${today}"></div>
        <div class="rcp-field"><label>Meal</label><select class="rcp-input" id="rcp-plan-slot"><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner" selected>Dinner</option></select></div>
        <div class="rcp-row"><button class="rcp-btn primary rcp-plan-go">Add to the meal plan</button><button class="rcp-btn rcp-plan-cancel">Cancel</button></div>
      </div>`;
      host.querySelector('.rcp-plan-cancel').addEventListener('click', () => { host.innerHTML = ''; });
      host.querySelector('.rcp-plan-go').addEventListener('click', async () => {
        const date = host.querySelector('#rcp-plan-date').value, slot = host.querySelector('#rcp-plan-slot').value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const there = await api(`/api/meals?from=${date}&to=${date}`).catch(() => []);
        const taken = Array.isArray(there) ? there.find((m) => (m.slot || 'dinner') === slot && m.title && m.recipe_id !== r.id) : null;
        if (taken && !ask('Replace what is planned for that meal?')) return;
        const res = await api(`/api/meals/${date}/${slot}`, { method: 'PUT', body: JSON.stringify({ title: r.title, recipe_id: r.id }) }).catch(() => null);
        if (bad(res)) return fail(res, '❌ The meal plan could not be updated.');
        say('Added to the meal plan');
        host.innerHTML = '';
      });
      host.scrollIntoView && host.scrollIntoView({ block: 'nearest' });
    }

    // Add the ingredients (at the servings shown) to a shopping list: pick which ones and which list.
    async function openShopping() {
      const r = S.recipe, host = root.querySelector('#rcp-sheet-host');
      if (!r || !host) return;
      const lists = await api('/api/shopping-lists').catch(() => null);
      const many = Array.isArray(lists) && lists.length > 1;
      host.innerHTML = `<div class="rcp-sheet">
        <div class="rcp-sec" style="margin-top:0">Add to shopping list</div>
        ${many ? `<div class="rcp-field"><label>List</label><select class="rcp-input" id="rcp-shop-list">${lists.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>` : ''}
        ${r.ingredients.map((i) => `<div class="rcp-pickrow"><label class="rcp-pick"><input type="checkbox" class="rcp-pick-box" value="${i.id}" ${i.pantry ? '' : 'checked'}><span>${esc(i.display)}</span></label>${i.pantry ? '<span class="rcp-pantry-tag">In your pantry</span>' : `<button type="button" class="rcp-link rcp-have" data-name="${esc(i.name)}">We always have this</button>`}</div>`).join('') || '<div class="rcp-help">No ingredients.</div>'}
        <div class="rcp-row" style="margin-top:10px"><button class="rcp-btn primary rcp-shop-go">Add</button><button class="rcp-btn rcp-shop-cancel">Cancel</button>${window.PantryUI ? '<button class="rcp-link rcp-pantry-manage">Pantry staples</button>' : ''}</div>
      </div>`;
      host.querySelector('.rcp-shop-cancel').addEventListener('click', () => { host.innerHTML = ''; });
      // a staple is added from here as you shop: the name is asked for (so "coarse Kosher salt" can become "salt" and match every recipe), then the sheet is drawn again with it applied
      host.querySelectorAll('.rcp-have').forEach((b) => b.addEventListener('click', async () => {
        const name = String(window.prompt('Add to your pantry as:', b.dataset.name) || '').trim();
        if (!name) return;
        const cur = await api('/api/pantry').catch(() => null);
        const res = await api('/api/pantry', { method: 'PUT', body: JSON.stringify({ items: ((cur && cur.items) || []).concat([name]) }) }).catch(() => null);
        if (bad(res) || !Array.isArray(res.items)) return fail(res, '❌ The pantry could not be saved.');
        say('Added to your pantry');
        const fresh = await api(`/api/recipes/${r.id}${S.servings && S.servings !== r.base_servings ? '?servings=' + encodeURIComponent(S.servings) : ''}`).catch(() => null);
        if (!bad(fresh)) S.recipe = fresh;
        openShopping();
      }));
      const manage = host.querySelector('.rcp-pantry-manage');
      if (manage) manage.addEventListener('click', () => window.PantryUI.open(host, { api, say, onClose: async () => {
        const fresh = await api(`/api/recipes/${r.id}${S.servings && S.servings !== r.base_servings ? '?servings=' + encodeURIComponent(S.servings) : ''}`).catch(() => null);
        if (!bad(fresh)) S.recipe = fresh;
        openShopping();
      } }));
      host.querySelector('.rcp-shop-go').addEventListener('click', async () => {
        const ids = [...host.querySelectorAll('.rcp-pick-box:checked')].map((c) => Number(c.value));
        if (!ids.length) { host.innerHTML = ''; return; }
        const sel = host.querySelector('#rcp-shop-list');
        const body = { ingredient_ids: ids, servings: S.servings };
        if (sel) body.list_id = Number(sel.value);
        const res = await api(`/api/recipes/${r.id}/shopping`, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
        if (bad(res)) return fail(res, '❌ The shopping list could not be updated.');
        say(res.merged ? 'Added to the shopping list. Some amounts were combined.' : 'Added to the shopping list');
        host.innerHTML = '';
      });
      host.scrollIntoView && host.scrollIntoView({ block: 'nearest' });
    }

    // Print: the recipe opens on its own page (in a new tab) laid out for paper, with Print, Share and Copy text. The print dialog is not available inside a web app
    // saved to a phone's Home Screen, so the page also offers Share (which has Print on a phone) and Copy.
    function printRecipe() {
      const r = S.recipe;
      if (!r) return;
      const url = `/recipe-print?id=${r.id}${Math.abs(S.servings - r.base_servings) > 1e-9 ? '&servings=' + encodeURIComponent(S.servings) : ''}&auto=1&from=${encodeURIComponent(location.pathname + location.search)}`;
      const w = window.open(url, '_blank');
      if (!w) window.location.href = url;                                  // pop-ups blocked: open it here (it has a Back button)
    }

    // ── the editor ────────────────────────────────────────────────────────────────────────────────────────
    // The ingredient text is the typed lines again; a section title is written back as a line ending in a colon.
    const ingredientText = (r) => { let g = ''; const out = []; for (const i of (r && r.ingredients) || []) { if ((i.group_label || '') !== g) { g = i.group_label || ''; if (g) out.push(g + ':'); } out.push(i.raw || i.display); } return out.join('\n'); };
    // r: the recipe being changed, or null for a new one. opts.prefill: what an import found (shown for checking, not saved yet). opts.draft: unsaved changes to bring back.
    async function openEditor(r, opts2) {
      const o = opts2 || {};
      if (r && !r.base_servings) r = await api(`/api/recipes/${r.id}`).catch(() => r);
      S.token++; S.view = 'edit'; S.recipe = r; S.photoFile = null; S.removePhoto = false; store.del(KEY_VIEW);
      const target = r ? r.id : 0;
      const pre = o.prefill || null;
      const base = r ? { title: r.title, description: r.description, servings: r.base_servings, prep: r.prep_min || '', cook: r.cook_min || '', tags: (r.tags || []).join(', '), course: r.course || '', ings: ingredientText(r), steps: (r.steps || []).map((s) => s.text + (s.timer_sec ? ' [' + timerText(s.timer_sec) + ']' : '')).join('\n'), notes: r.notes || '', source: r.source_name || '', url: r.source_url || '' }
        : pre ? { title: pre.title || '', description: pre.description || '', servings: pre.servings || 4, prep: pre.prep_min || '', cook: pre.cook_min || '', tags: (pre.tags || []).join(', '), course: pre.course || '', ings: (pre.ingredients || []).join('\n'), steps: (pre.steps || []).join('\n'), notes: '', source: pre.source_name || '', url: pre.source_url || '' }
        : { title: '', description: '', servings: 4, prep: '', cook: '', tags: '', course: '', ings: '', steps: '', notes: '', source: '', url: '' };
      const dr = o.draft && o.draft.id === target ? o.draft : null;
      const F = dr ? { ...base, ...dr.fields } : base;
      const origin = dr && dr.origin ? dr.origin : (pre ? pre.origin : 'own');
      const imageUrl = dr && dr.image_url !== undefined ? dr.image_url : (pre ? pre.image_url || '' : '');
      const useImage = dr && dr.use_image !== undefined ? dr.use_image : true;
      const v = (x) => esc(x === undefined || x === null ? '' : x);
      root.innerHTML = `<div class="rcp">
        <div class="rcp-bar"><button class="rcp-btn rcp-cancel">Cancel</button><span style="flex:1"></span><button class="rcp-btn primary rcp-save">Save</button></div>
        ${dr ? `<div class="rcp-note"><span>Your unsaved changes were restored.</span> <button class="rcp-link rcp-startover" type="button">Start over</button></div>` : (pre ? `<div class="rcp-note"><span>Check it over, then save.</span></div>` : '')}
        <div class="rcp-field"><label>Title</label><input class="rcp-input" id="rcp-f-title" maxlength="120" value="${v(F.title)}"></div>
        <div class="rcp-field"><label>Description</label><textarea class="rcp-ta" id="rcp-f-desc" rows="2" maxlength="2000" style="min-height:60px">${v(F.description)}</textarea></div>
        <div class="rcp-two">
          <div class="rcp-field"><label>Servings</label><input class="rcp-input" id="rcp-f-servings" type="number" min="0.5" step="0.5" inputmode="decimal" value="${v(F.servings)}"></div>
          <div class="rcp-field"><label>Prep (min)</label><input class="rcp-input" id="rcp-f-prep" type="number" min="0" step="5" inputmode="numeric" value="${v(F.prep)}"></div>
          <div class="rcp-field"><label>Cook (min)</label><input class="rcp-input" id="rcp-f-cook" type="number" min="0" step="5" inputmode="numeric" value="${v(F.cook)}"></div>
        </div>
        <div class="rcp-field"><label>Course</label><select class="rcp-input" id="rcp-f-course"><option value="">No course</option>${COURSES.map((c) => `<option value="${c[0]}" ${F.course === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select></div>
        <div class="rcp-field"><label>Tags</label><input class="rcp-input" id="rcp-f-tags" placeholder="dinner, quick, kids" value="${v(F.tags)}" autocapitalize="none"><div class="rcp-help">Separate tags with commas.</div></div>
        <div class="rcp-field"><label>Ingredients</label><textarea class="rcp-ta" id="rcp-f-ings" rows="9" spellcheck="false" placeholder="1 1/2 cups flour&#10;2 eggs&#10;salt to taste">${v(F.ings)}</textarea><div class="rcp-help">One per line, like “1 1/2 cups flour” or “2 eggs”. A line ending in a colon starts a section, like “For the sauce:”.</div></div>
        <div class="rcp-field"><label>Steps</label><textarea class="rcp-ta" id="rcp-f-steps" rows="9" placeholder="Mix the dry ingredients.&#10;Add the eggs and milk.">${v(F.steps)}</textarea><div class="rcp-help">One step per line. To give a step a timer, end it with the time in brackets, like “Simmer the sauce. [10 min]”.</div></div>
        <div class="rcp-field"><label>Notes</label><textarea class="rcp-ta" id="rcp-f-notes" rows="3" maxlength="4000" style="min-height:60px">${v(F.notes)}</textarea></div>
        <div class="rcp-two" style="grid-template-columns:1fr 2fr">
          <div class="rcp-field"><label>Source</label><input class="rcp-input" id="rcp-f-source" maxlength="80" value="${v(F.source)}"></div>
          <div class="rcp-field"><label>Web address</label><input class="rcp-input" id="rcp-f-url" type="url" inputmode="url" placeholder="https://" autocapitalize="none" value="${v(F.url)}"></div>
        </div>
        <div class="rcp-field"><label>Photo</label><div class="rcp-row">
          <div id="rcp-f-thumb">${r && r.photo ? `<img class="rcp-thumb" src="${esc(r.photo)}" alt="">` : ''}</div>
          <label class="rcp-btn" style="cursor:pointer">Choose photo<input id="rcp-f-photo" type="file" accept="image/jpeg,image/png,image/webp,image/*" style="display:none"></label>
          ${r && r.photo ? `<button class="rcp-btn danger rcp-rmphoto" type="button">Remove photo</button>` : ''}
        </div>
        ${imageUrl && !r ? `<label class="rcp-pick" style="margin-top:8px"><input type="checkbox" id="rcp-f-useimg" ${useImage ? 'checked' : ''}><span>Use the picture from the page</span></label>` : ''}
        </div>
        <div class="rcp-row" style="margin-top:6px"><button class="rcp-btn primary rcp-save2">Save</button><button class="rcp-btn rcp-cancel2">Cancel</button></div>
      </div>`;

      const val = (id) => root.querySelector('#' + id).value;
      const collect = () => ({ title: val('rcp-f-title'), description: val('rcp-f-desc'), servings: val('rcp-f-servings'), prep: val('rcp-f-prep'), cook: val('rcp-f-cook'), tags: val('rcp-f-tags'), course: val('rcp-f-course'), ings: val('rcp-f-ings'), steps: val('rcp-f-steps'), notes: val('rcp-f-notes'), source: val('rcp-f-source'), url: val('rcp-f-url') });
      const startSnapshot = JSON.stringify(dr ? base : collect());                    // what "no changes" looks like: the saved recipe (or the import as found)
      const dirty = () => JSON.stringify(collect()) !== startSnapshot;
      const useImg = () => { const c = root.querySelector('#rcp-f-useimg'); return c ? c.checked : false; };
      const writeDraft = () => { if (S.view === 'edit' && root.querySelector('#rcp-f-title') && dirty()) store.set(KEY_DRAFT, { id: target, at: Date.now(), fields: collect(), origin, image_url: imageUrl, use_image: useImg() }); };
      let draftTimer = null;
      const queueDraft = () => { clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 300); };
      root.querySelector('.rcp').addEventListener('input', queueDraft);
      root.querySelector('.rcp').addEventListener('change', queueDraft);
      S.flushDraft = () => { clearTimeout(draftTimer); writeDraft(); };                // called when the page is hidden or closed
      if (dirty()) writeDraft();                                                       // a restored draft stays stored until it is saved or discarded

      const leave = () => { clearTimeout(draftTimer); S.flushDraft = null; store.del(KEY_DRAFT); if (r) openRecipe(r.id); else loadList(); };
      const cancel = () => { if (dirty() && !ask('Discard your changes?')) return; leave(); };
      inputs('.rcp-cancel, .rcp-cancel2').forEach((b) => b.addEventListener('click', cancel));
      const startOver = root.querySelector('.rcp-startover');
      if (startOver) startOver.addEventListener('click', () => { store.del(KEY_DRAFT); openEditor(r, { prefill: pre }); });
      const photo = root.querySelector('#rcp-f-photo');
      photo.addEventListener('change', () => {
        const f = photo.files && photo.files[0]; if (!f) return;
        S.photoFile = f; S.removePhoto = false;
        const t = root.querySelector('#rcp-f-thumb'); t.innerHTML = ''; const img = document.createElement('img'); img.className = 'rcp-thumb'; img.alt = ''; img.src = URL.createObjectURL(f); t.appendChild(img);
      });
      const rm = root.querySelector('.rcp-rmphoto');
      if (rm) rm.addEventListener('click', () => { S.removePhoto = true; S.photoFile = null; root.querySelector('#rcp-f-thumb').innerHTML = ''; rm.style.display = 'none'; });
      let saving = false;
      const save = async () => {
        if (saving) return;
        const title = val('rcp-f-title').trim();
        if (!title) { say('❌ A recipe needs a title.'); root.querySelector('#rcp-f-title').focus(); return; }
        saving = true; inputs('.rcp-save, .rcp-save2').forEach((b) => { b.disabled = true; });
        const body = {
          title, description: val('rcp-f-desc'), servings: Number(val('rcp-f-servings')) || 4, prep_min: Number(val('rcp-f-prep')) || 0, cook_min: Number(val('rcp-f-cook')) || 0,
          tags: val('rcp-f-tags'), course: val('rcp-f-course'), ingredients: val('rcp-f-ings').split(/\r?\n/), steps: val('rcp-f-steps').split(/\r?\n/), notes: val('rcp-f-notes'),
          source_name: val('rcp-f-source'), source_url: val('rcp-f-url').trim(),
        };
        if (!r) body.origin = origin;
        const res = await api(r ? `/api/recipes/${r.id}` : '/api/recipes', { method: r ? 'PUT' : 'POST', body: JSON.stringify(body) }).catch(() => null);
        if (bad(res)) { saving = false; inputs('.rcp-save, .rcp-save2').forEach((b) => { b.disabled = false; }); return fail(res, '❌ The recipe could not be saved.'); }
        const id = res.id;
        clearTimeout(draftTimer); S.flushDraft = null; store.del(KEY_DRAFT);              // saved: the draft has done its job
        if (S.photoFile) {
          const blob = await shrink(S.photoFile, 1600);
          const fd = new FormData(); fd.append('photo', blob, 'recipe.jpg');
          const up = await upload(`/api/recipes/${id}/photo`, fd).catch(() => null);
          if (bad(up)) say(up && up.error ? '❌ ' + up.error : '❌ The recipe was saved, but the picture could not be.');
        } else if (!r && imageUrl && useImg()) {
          const up = await api(`/api/recipes/${id}/photo-from-url`, { method: 'POST', body: JSON.stringify({ url: imageUrl }) }).catch(() => null);
          if (bad(up)) say('❌ The recipe was saved, but its picture could not be copied.');
        } else if (S.removePhoto && r && r.photo) {
          await api(`/api/recipes/${id}/photo`, { method: 'DELETE' }).catch(() => null);
        }
        say('Recipe saved');
        openRecipe(id);
      };
      inputs('.rcp-save, .rcp-save2').forEach((b) => b.addEventListener('click', save));
      if (!r && !pre && !dr) root.querySelector('#rcp-f-title').focus();
    }

    function refresh() { if (S.view === 'list') return loadList(); if (S.view === 'detail' && S.recipe) return openRecipe(S.recipe.id, S.servings === S.recipe.base_servings ? 0 : S.servings); }

    // leaving the page (another app, a reload) keeps what was typed
    const flush = () => { if (S.flushDraft) S.flushDraft(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', onHide);

    // where to start: an unsaved draft (up to a week old), else the recipe that was open (up to half a day), else the list
    (async function start() {
      const d = store.get(KEY_DRAFT);
      if (d && d.fields && Date.now() - (d.at || 0) < 7 * 86400000) {
        if (!d.id) return openEditor(null, { draft: d });
        const r = await api(`/api/recipes/${d.id}`).catch(() => null);
        if (!bad(r)) return openEditor(r, { draft: d });
        store.del(KEY_DRAFT);                                                          // that recipe is gone
      } else if (d) store.del(KEY_DRAFT);
      const w = store.get(KEY_VIEW);
      if (w && w.id && Date.now() - (w.at || 0) < 12 * 3600000) return openRecipe(w.id, w.servings || 0);
      loadList();
    })();
    return { refresh, destroy() { S.token++; clearInterval(S.cookIv); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onHide); root.innerHTML = ''; } };
  }

  window.RecipesUI = { mount };
})();
