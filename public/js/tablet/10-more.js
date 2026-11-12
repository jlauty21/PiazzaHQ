// The /tablet web app, part 10: three more Piazza HQ tiles. Presentation (start, step and stop a deck or playlist on a screen), Whiteboard (the family board: a picture of it on the tile, the
// full drawing pad when tapped, the same one the app and the wall use) and Bonus chores (extra chores a child can claim). Each registers itself in TB_CARD_EXTRA (02-tiles.js). `live` names the
// live-update topic that should refresh it (03-page.js). Uses the sheet shell and helpers from 07-lists.js, the screen helpers from 09-quick.js and js/shared/draw-ui.js.
'use strict';

// ── presentation ──────────────────────────────────────────────────────────────────────────────────────────────────────────
TB.cards.pres = TB.cards.pres || {};
const tbPresUrl = (s) => '/api/screens/' + encodeURIComponent(s.device_id) + '/presentation';
TB_CARD_EXTRA.presentation = {
  live: 'screens',
  async refresh() {
    await tbScreenRefresh();
    const ids = new Set(tbTilesOf(TB.layout).filter((t) => t.kind === 'card' && t.ref === 'presentation').map((t) => { const s = tbScreenOf(t); return s && s.device_id; }).filter(Boolean));
    await Promise.all([...ids].map(async (id) => { const r = await tbApi('/api/screens/' + encodeURIComponent(id) + '/presentation'); TB.cards.pres[id] = tbOk(r) ? r : { offline: true }; }));
  },
  view(tile, base, wait) {
    const label = tile.label || 'Presentation', icon = tile.icon || 'screen';
    if (!TB.cards.screensList) return wait(label, icon);
    const s = tbScreenOf(tile);
    if (!s) return { ...base, label, icon, state: 'No screen found', still: true };
    const p = TB.cards.pres[s.device_id];
    if (p && p.offline) return { ...base, label, icon, state: 'Screen is offline' };
    if (p && p.active) {
      const v = { ...base, label, icon, on: true, defColor: 'purple', state: 'Page ' + ((p.index || 0) + 1) + ' of ' + (p.page_count || 1) };
      if (tile.h >= 2 && p.name) v.lines = [{ a: p.name, b: '' }];
      return v;
    }
    return { ...base, label, icon, state: 'Tap to start', defColor: 'purple' };
  },
  open: (tile) => tbPresentationSheet(tile),
};
async function tbPresentationSheet(tile) {
  if (!TB.cards.screensList) await tbScreenRefresh();
  const s = tbScreenOf(tile), sh = tbCardSheet(tile.label || 'Presentation', ['screens'], load);
  if (!s) { sh.body.innerHTML = '<p class="tb-empty">No screen found.</p>'; return; }
  let st = null, decks = [], lists = [];
  const preset = String(tbCfg(tile).show || '');
  const startBtn = (key, name, n, big) => { const [k, id] = key.split(':'); return `<li><button type="button" class="tb-rowchk${big ? ' tb-presbig' : ''}" data-start="${tbEsc(k)}" data-id="${tbEsc(id)}"><span class="tb-av" aria-hidden="true">${k === 'deck' ? '🖼️' : '🎞️'}</span><span class="tb-rowtext">${tbEsc(name)}</span>${typeof n === 'number' ? `<b>${n} <span>${n === 1 ? 'page' : 'pages'}</span></b>` : ''}</button></li>`; };
  function draw() {
    if (!sh.alive()) return;
    if (!st || st.offline) { sh.body.innerHTML = '<p class="tb-empty">This screen is offline.</p>'; return; }
    let h = '';
    if (st.active) {
      h += `<div class="tb-presnow"><b>${tbEsc(st.name || '')}</b><span>Page ${(st.index || 0) + 1} of ${st.page_count || 1}</span></div>
        <div class="tb-row"><button type="button" class="tb-btn tb-giant" data-act="prev"><span aria-hidden="true">◀</span> <span>Back</span></button>
        <button type="button" class="tb-btn tb-giant" data-act="${st.playing ? 'pause' : 'play'}">${st.playing ? '<span>Pause</span>' : '<span>Play</span>'}</button>
        <button type="button" class="tb-btn tb-giant" data-act="next"><span>Next</span> <span aria-hidden="true">▶</span></button>
        <button type="button" class="tb-btn tb-giant" data-act="stop"><span>Stop</span></button></div>`;
    }
    const rows = [];
    const [pk, pid] = preset.split(':'), px = preset ? (pk === 'deck' ? decks : lists).find((d) => String(d.id) === pid) : null;
    if (px) rows.push(startBtn(preset, px.name, px.page_count, true));
    decks.forEach((d) => { if (preset !== 'deck:' + d.id) rows.push(startBtn('deck:' + d.id, d.name, d.page_count)); });
    lists.forEach((d) => { if (preset !== 'playlist:' + d.id) rows.push(startBtn('playlist:' + d.id, d.name)); });
    h += `<div class="tb-pl">${st.active ? 'Show something else' : 'Start'}</div><ul class="tb-itemlist">${rows.length ? rows.join('') : '<li class="tb-empty">No presentations yet. Make one in the app.</li>'}</ul>`;
    sh.body.innerHTML = h;
  }
  async function load() {
    const [a, b, c] = await Promise.all([tbApi(tbPresUrl(s)), tbApi('/api/decks'), tbApi('/api/playlists')]);
    if (!sh.alive()) return;
    st = tbOk(a) ? a : { offline: true }; decks = tbOk(b) ? tbList(b) : []; lists = tbOk(c) ? tbList(c) : [];
    TB.cards.pres[s.device_id] = st; draw();
  }
  sh.body.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'), g = e.target.closest('[data-start]');
    if (!a && !g) return;
    const body = a ? { action: a.dataset.act } : { action: 'start', kind: g.dataset.start, id: Number(g.dataset.id) };
    const r = await tbDo(tbPresUrl(s), 'POST', body);
    if (r && r.state) { st = r.state; TB.cards.pres[s.device_id] = st; tbFeedback('tap'); draw(); tbLastGrid = ''; tbRedraw(); if (!r.delivered && body.action === 'start') tbToast('The screen will start it in a moment.'); }
  });
  await load();
}

// ── whiteboard ────────────────────────────────────────────────────────────────────────────────────────────────────────────
TB.cards.boards = TB.cards.boards || null; TB.cards.boardPics = TB.cards.boardPics || {};
const tbBoardOf = (tile) => { const list = TB.cards.boards || [], id = String(tbCfg(tile).board || ''); return (id ? list.find((b) => b.id === id) : list[0]) || null; };
// The picture of a board for its tile: drawn again from the strokes, kept until the board changes.
async function tbBoardPicture(b) {
  const have = TB.cards.boardPics[b.id];
  if (have && have.version === b.version) return;
  if (typeof DrawUI === 'undefined') return;
  const full = await tbApi('/api/boards/' + encodeURIComponent(b.id));
  if (!tbOk(full)) return;
  const url = await new Promise((resolve) => {
    try { DrawUI.toPng(full.strokes || [], full.background || 'white', 4, 3, (blob) => resolve(blob ? URL.createObjectURL(blob) : ''), full.photo ? '/uploads/' + encodeURI(full.photo) : '', full.ink ? '/uploads/' + encodeURI(full.ink) : ''); } catch { resolve(''); }
    setTimeout(() => resolve(''), 8000);
  });
  if (have && have.url) URL.revokeObjectURL(have.url);
  TB.cards.boardPics[b.id] = { version: b.version, url, strokes: (full.strokes || []).length };
}
TB_CARD_EXTRA.whiteboard = {
  live: 'boards',
  async refresh() {
    const r = await tbApi('/api/boards'); if (!tbOk(r)) return;
    TB.cards.boards = tbList(r);
    const mine = tbTilesOf(TB.layout).filter((t) => t.kind === 'card' && t.ref === 'whiteboard' && t.w * t.h >= 2).map(tbBoardOf).filter(Boolean);
    await Promise.all([...new Set(mine)].map(tbBoardPicture));
  },
  view(tile, base, wait) {
    const label = tile.label || 'Whiteboard', icon = tile.icon || 'pencil';
    if (!TB.cards.boards) return wait(label, icon);
    const b = tbBoardOf(tile);
    if (!b) return { ...base, label, icon, state: 'No whiteboard on a wall screen yet', still: true };
    const pic = TB.cards.boardPics[b.id];
    if (pic && pic.url && tile.w * tile.h >= 2) return { ...base, label: tile.label || b.name, bg: pic.url };
    return { ...base, label: tile.label || b.name, icon, state: b.strokes ? 'Tap to draw' : 'Blank. Tap to draw', defColor: 'teal' };
  },
  open: (tile) => tbBoardSheet(tile),
};
const tbDrawApi = (path, init) => {
  const h = { ...((init && init.headers) || {}) }; if (init && typeof init.body === 'string' && !h['Content-Type']) h['Content-Type'] = 'application/json';
  const tok = tbStore(TB_TOKEN_KEY); if (tok) h['x-session-token'] = tok;
  return fetch(path, { ...(init || {}), headers: h }).then((r) => r.json());
};
async function tbBoardSheet(tile) {
  if (!TB.cards.boards) { const r = await tbApi('/api/boards'); if (tbOk(r)) TB.cards.boards = tbList(r); }
  const b = tbBoardOf(tile);
  const sh = tbCardSheet(tile.label || (b && b.name) || 'Whiteboard', ['boards'], () => { if (ctl) ctl.refresh(); });
  sh.box.querySelector('.tb-sheet').classList.add('tb-wbsheet');
  if (!b || typeof DrawUI === 'undefined') { sh.body.innerHTML = '<p class="tb-empty">No whiteboard on a wall screen yet.</p>'; return; }
  sh.body.innerHTML = '<div class="tb-wbhost"></div>';
  let ctl = null;
  try { ctl = DrawUI.mount(sh.body.querySelector('.tb-wbhost'), { board: b.id, api: tbDrawApi, readOnly: !!TB.preview, toolbar: 'always', big: true, name: b.name || 'Whiteboard', isEditing: () => false }); } catch { ctl = null; }
  const close0 = sh.close;
  sh.close = () => { const c = ctl; ctl = null; close0.call(sh); if (c) c.flush().then(() => { c.destroy(); tbBoardsChanged(); }); };
}
// After drawing: draw the tile's picture again.
function tbBoardsChanged() { TB_CARD_EXTRA.whiteboard.refresh().then(() => { tbLastGrid = ''; tbRedraw(); }); }

// ── bonus chores ──────────────────────────────────────────────────────────────────────────────────────────────────────────
TB_CARD_EXTRA.bonus_chores = {
  live: 'chores',
  async refresh() {
    const kids = await tbLoadChart(); TB.cards.bonusKids = kids;
    const k = kids[0]; if (!k) { TB.cards.bonus = []; return; }
    const r = await tbApi('/api/kids/' + k.id + '/bonus-chores'); TB.cards.bonus = tbOk(r) ? tbList(r) : [];
  },
  view(tile, base, wait) {
    const label = tile.label || 'Bonus chores', icon = tile.icon || 'star';
    if (!TB.cards.bonus) return wait(label, icon);
    const n = TB.cards.bonus.length, v = { ...base, label, icon, defColor: 'amber', still: false, state: n ? n + (n === 1 ? ' extra chore to claim' : ' extra chores to claim') : 'None right now' };
    if (tile.h >= 2 && n) v.lines = TB.cards.bonus.slice(0, Math.max(2, tile.h * 3)).map((c) => ({ a: (c.icon || '') + ' ' + c.title, b: c.pay_amount > 0 ? '$' + Number(c.pay_amount).toFixed(2) : '' }));
    return v;
  },
  open: (tile) => tbBonusSheet(tile),
};
async function tbBonusSheet(tile) {
  let kids = [], chores = [], kid = String(tbCfg(tile).kid || '');
  const sh = tbCardSheet(tile.label || 'Bonus chores', ['chores'], load);
  const draw = () => {
    if (!sh.alive()) return;
    if (!kids.length) { sh.body.innerHTML = '<p class="tb-empty">Add a child in the app first.</p>'; return; }
    sh.body.innerHTML = `<div class="tb-pl">Who is claiming</div><div class="tb-segs">${kids.map((k) => `<button type="button" class="tb-seg${String(k.id) === kid ? ' on' : ''}" data-kid="${tbEsc(k.id)}">${tbEsc(k.avatar || '')} ${tbEsc(k.name)}</button>`).join('')}</div>
      <ul class="tb-itemlist">${chores.length ? chores.map((c) => `<li><button type="button" class="tb-rowchk" data-claim="${tbEsc(c.id)}"><span class="tb-av" aria-hidden="true">${tbEsc(c.icon || '✅')}</span><span class="tb-rowtext">${tbEsc(c.title)}${c.notes ? `<small>${tbEsc(c.notes)}</small>` : ''}</span>${c.pay_amount > 0 ? `<b>$${tbEsc(Number(c.pay_amount).toFixed(2))}</b>` : ''}</button></li>`).join('') : '<li class="tb-empty">No bonus chores left today.</li>'}</ul>`;
  };
  async function load() {
    kids = await tbLoadChart();
    if (!sh.alive()) return;
    if (!kid || !kids.some((k) => String(k.id) === kid)) kid = kids[0] ? String(kids[0].id) : '';
    const r = kid ? await tbApi('/api/kids/' + kid + '/bonus-chores') : null;
    chores = r && !r.error ? tbList(r) : [];
    draw();
  }
  sh.body.addEventListener('click', async (e) => {
    const kb = e.target.closest('[data-kid]'); if (kb) { kid = kb.dataset.kid; draw(); return; }
    const cb = e.target.closest('[data-claim]'); if (!cb || !kid) return;
    cb.disabled = true;
    const r = await tbDo('/api/kids/' + kid + '/claim-bonus/' + cb.dataset.claim, 'POST', {});
    cb.disabled = false;
    if (r) { tbFeedback('tap'); tbToast('Chore claimed'); await load(); tbAfterChange(); }
    else await load();                                   // someone else may have claimed it first: show what is left
  });
  await load();
}
