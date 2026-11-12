// The /tablet web app, part 9: the quick-action and extra Piazza HQ tiles, the ones the Favorites screen has and a few more. Each registers itself in TB_CARD_EXTRA (02-tiles.js) with how it
// looks on the page (view), what a tap does (open) and the data it needs (refresh). Quick actions: add to the shopping list, add a to-do, add an event, add a chore, give a sticker, redeem a
// reward, TV power, photo frame, switch layout, the Family Hub QR. Glance tiles: chores progress, sticker balances. Extras: kitchen timers, a countdown, a photo slideshow.
// Uses the sheet shell and helpers from 07-lists.js and 08-sheets.js.
'use strict';

const tbSimple = (ref, label, icon, hint, open) => { TB_CARD_EXTRA[ref] = { view: (tile, base) => ({ ...base, label: tile.label || label, icon: tile.icon || icon, state: hint, still: false }), open }; };
const tbKidsData = () => TB.cards.choresRaw;
async function tbLoadChart() { const r = await tbApi('/api/chore-chart'); return tbOk(r) && Array.isArray(r.kids) ? r.kids : []; }

// ── quick adds ────────────────────────────────────────────────────────────────────────────────────────────────────────────
tbSimple('add_shopping', 'Add to shopping', 'cart', 'Tap to add', (tile) => tbShoppingSheet(tile, { title: 'Add to shopping list', focus: true }));
tbSimple('add_todo', 'Add a to-do', 'plus', 'Tap to add', (tile) => tbTodoSheet(tile, { title: 'Add a to-do', focus: true }));
tbSimple('add_event', 'Add an event', 'cal', 'Tap to add', (tile) => tbAgendaSheet(tile, { form: true }));
tbSimple('add_chore', 'Add a chore', 'broom', 'Tap to add', (tile) => tbAddChoreSheet(tile));
tbSimple('give_sticker', 'Give a sticker', 'star', 'Tap to choose', (tile) => tbStickerSheet(tile));
tbSimple('redeem_reward', 'Redeem a reward', 'gift', 'Tap to choose', (tile) => tbRewardSheet(tile));
tbSimple('family_hub_qr', 'Family Hub', 'qr', 'Scan with a phone', (tile) => tbHubSheet(tile));

const TB_CHORE_ICONS = ['✅', '🛏️', '🧹', '🍽️', '🐕', '🗑️', '📚', '🦷', '🧺', '🌱', '🚗', '🧸'];
async function tbAddChoreSheet(tile) {
  const st = { who: 'all', icon: TB_CHORE_ICONS[0], when: 'once' };
  const sh = tbCardSheet(tile.label || 'Add a chore', []);
  const kids = await tbLoadChart();
  const draw = () => {
    sh.body.querySelector('[data-who]').innerHTML = [['all', 'Everyone'], ...kids.map((k) => [String(k.id), k.name])].map(([v, l]) => `<button type="button" class="tb-seg${st.who === v ? ' on' : ''}" data-who-v="${tbEsc(v)}">${tbEsc(l)}</button>`).join('');
    sh.body.querySelector('[data-icons]').innerHTML = TB_CHORE_ICONS.map((i) => `<button type="button" class="tb-emoji${st.icon === i ? ' on' : ''}" data-icon="${tbEsc(i)}" aria-label="${tbEsc(i)}">${tbEsc(i)}</button>`).join('');
    sh.body.querySelector('[data-when]').innerHTML = [['once', 'Today only'], ['daily', 'Every day']].map(([v, l]) => `<button type="button" class="tb-seg${st.when === v ? ' on' : ''}" data-when-v="${v}">${l}</button>`).join('');
  };
  sh.body.innerHTML = `<input class="tb-input" data-title maxlength="120" autocomplete="off" placeholder="What needs doing?" aria-label="What needs doing?">
    <div class="tb-pl">Who</div><div class="tb-segs" data-who></div><div class="tb-pl">Icon</div><div class="tb-emojis" data-icons></div><div class="tb-pl">When</div><div class="tb-segs" data-when></div>
    <button type="button" class="tb-btn primary" data-go>Add the chore</button>`;
  draw();
  sh.body.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-who-v]'), i = e.target.closest('[data-icon]'), n = e.target.closest('[data-when-v]');
    if (w) { st.who = w.dataset.whoV; draw(); } else if (i) { st.icon = i.dataset.icon; draw(); } else if (n) { st.when = n.dataset.whenV; draw(); }
    else if (e.target.closest('[data-go]')) {
      const title = sh.body.querySelector('[data-title]').value.trim();
      if (!title) { tbToast('Say what needs doing.'); return; }
      const r = await tbDo('/api/chores', 'POST', { title, icon: st.icon, assignee: st.who, freq: st.when, on_date: st.when === 'once' ? tbDayStr(0) : '' });
      if (r) { sh.close(); tbToast('Chore added'); tbAfterChange(); }
    }
  });
}

// ── stickers and rewards ──────────────────────────────────────────────────────────────────────────────────────────────────
async function tbStickerSheet(tile) {
  let kids = [];
  const sh = tbCardSheet(tile.label || 'Stickers', ['chores'], load);
  const draw = () => { sh.body.innerHTML = kids.length ? kids.map((k) => `<div class="tb-kid" style="--kc:${tbEsc(tbColor(k.color) || k.color || 'var(--accent)')}"><div class="tb-kidhead"><span class="tb-av" aria-hidden="true">${tbEsc(k.avatar || (k.name || '?').slice(0, 1))}</span><b>${tbEsc(k.name)}</b><span class="tb-kidn">⭐ ${tbEsc(k.stickerBalance || 0)}</span><button type="button" class="tb-btn primary" data-give="${tbEsc(k.id)}">Give a sticker</button></div></div>`).join('') : '<p class="tb-empty">Add a child in the app first.</p>'; };
  async function load() { kids = await tbLoadChart(); if (sh.alive()) draw(); }
  sh.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-give]'); if (!b) return;
    const k = kids.find((x) => String(x.id) === b.dataset.give); b.disabled = true;
    const r = await tbDo('/api/stickers', 'POST', { kid_id: Number(b.dataset.give) }); b.disabled = false;
    if (r) { tbFeedback('tap'); tbToast('Sticker given to ' + (k ? k.name : '')); await load(); tbAfterChange(); }
  });
  await load();
}
async function tbRewardSheet(tile) {
  let kids = [], rewards = [], kid = '';
  const sh = tbCardSheet(tile.label || 'Redeem a reward', ['chores'], load);
  const draw = () => {
    const k = kids.find((x) => String(x.id) === kid), bal = k ? Number(k.stickerBalance) || 0 : 0;
    const mine = rewards.filter((r) => r.active !== 0 && (!r.assignee || r.assignee === 'all' || String(r.assignee) === kid));
    sh.body.innerHTML = `<div class="tb-segs">${kids.map((x) => `<button type="button" class="tb-seg${String(x.id) === kid ? ' on' : ''}" data-kid="${tbEsc(x.id)}">${tbEsc(x.avatar || '')} ${tbEsc(x.name)} · ⭐ ${tbEsc(x.stickerBalance || 0)}</button>`).join('')}</div>
      <ul class="tb-itemlist">${mine.length ? mine.map((r) => `<li><button type="button" class="tb-rowchk" data-reward="${tbEsc(r.id)}" ${bal < r.star_cost ? 'aria-disabled="true"' : ''}><span class="tb-av">${tbEsc(r.icon || '🎁')}</span><span class="tb-rowtext">${tbEsc(r.title)}<small>${bal < r.star_cost ? '<span>Needs</span> ' + (r.star_cost - bal) + ' <span>more</span>' : '<span>Enough stars</span>'}</small></span><b>⭐ ${tbEsc(r.star_cost)}</b></button></li>`).join('') : '<li class="tb-empty">No rewards for this child yet.</li>'}</ul>`;
  };
  async function load() {
    const [c, r] = await Promise.all([tbLoadChart(), tbApi('/api/rewards')]);
    if (!sh.alive()) return;
    kids = c; rewards = tbOk(r) ? tbList(r) : [];
    if (!kid || !kids.some((x) => String(x.id) === kid)) kid = kids[0] ? String(kids[0].id) : '';
    draw();
  }
  sh.body.addEventListener('click', async (e) => {
    const kb = e.target.closest('[data-kid]'); if (kb) { kid = kb.dataset.kid; draw(); return; }
    const rb = e.target.closest('[data-reward]'); if (!rb || rb.getAttribute('aria-disabled') === 'true') { if (rb) tbToast('Not enough stars yet.'); return; }
    const r = rewards.find((x) => String(x.id) === rb.dataset.reward), k = kids.find((x) => String(x.id) === kid); if (!r || !k) return;
    const { box, close } = tbSheet(`<h2>Redeem ${tbEsc(r.title)}?</h2><p>${tbEsc(k.name)} spends <b>${tbEsc(r.star_cost)}</b> <span>stars</span>.</p><div class="tb-row"><button type="button" class="tb-btn" data-close>Cancel</button><button type="button" class="tb-btn primary" data-ok>Redeem</button></div>`);
    box.style.zIndex = 25;
    box.querySelector('[data-close]').addEventListener('click', close);
    box.querySelector('[data-ok]').addEventListener('click', async () => { const x = await tbDo('/api/rewards/' + r.id + '/redeem', 'POST', { kid_id: Number(kid) }); close(); if (x) { tbToast('Redeemed!'); await load(); tbAfterChange(); } });
  });
  await load();
}

// ── glance tiles ──────────────────────────────────────────────────────────────────────────────────────────────────────────
TB_CARD_EXTRA.chores_progress = {
  view(tile, base, wait) {
    const kids = tbKidsData(); if (!kids) return wait("Today's chores", 'broom');
    const all = kids.flatMap((k) => k.chores || []), done = all.filter((c) => c.done).length;
    const v = { ...base, label: tile.label || "Today's chores", icon: tile.icon || 'broom', bigText: all.length ? done + '/' + all.length : '–', bar: all.length ? Math.round(done / all.length * 100) : 0, state: !all.length ? 'No chores today' : done === all.length ? 'All done ✓' : (all.length - done) + ' to go', still: false };
    if (tile.h >= 2) v.lines = kids.filter((k) => (k.chores || []).length).map((k) => ({ a: k.name, b: k.chores.filter((c) => c.done).length + ' of ' + k.chores.length + ' done' }));
    return v;
  },
  open: (tile) => tbChoresSheet({ ...tile, card_config: {} }),
};
TB_CARD_EXTRA.sticker_balances = {
  view(tile, base, wait) {
    const kids = tbKidsData(); if (!kids) return wait('Stickers', 'star');
    const v = { ...base, label: tile.label || 'Stickers', icon: tile.icon || 'star', state: kids.length ? kids.map((k) => k.name + ' ⭐ ' + (k.stickerBalance || 0)).join(' · ') : 'No children yet', still: false };
    if (tile.h >= 2 && kids.length) { v.state = ''; v.lines = kids.map((k) => ({ a: k.name, b: '⭐ ' + (k.stickerBalance || 0) })); }
    return v;
  },
  open: (tile) => tbStickerSheet(tile),
};

// ── screens: TV power, photo frame, switch layout ─────────────────────────────────────────────────────────────────────────
const tbScreenRefresh = async () => {
  const [a, b] = await Promise.all([tbApi('/api/screens'), tbApi('/api/displays')]);
  if (tbOk(a)) TB.cards.screensList = tbList(a).filter((s) => !String(s.device_id).startsWith('preview_'));
  if (tbOk(b)) TB.cards.displaysList = tbList(b);
};
// The screen a tile points at: the one chosen in its options, else the first (for TV power, the first with a TV set up).
function tbScreenOf(tile) {
  const list = TB.cards.screensList || [], id = tbCfg(tile).screen;
  if (id) return list.find((s) => s.device_id === id) || null;
  return (tile.ref === 'tv_power' ? list.find((s) => s.tv_control_type) : null) || list[0] || null;
}
const tbScreenView = (hint) => (tile, base, wait) => {
  if (!TB.cards.screensList) return wait('Screen', 'screen');
  const s = tbScreenOf(tile);
  if (!s) return { ...base, label: tile.label || TM_CARD_LABELS[tile.ref], icon: tile.icon || TM_CARD_ICONS[tile.ref], state: 'No screen found', still: true };
  return { ...base, label: tile.label || s.name || TM_CARD_LABELS[tile.ref], icon: tile.icon || TM_CARD_ICONS[tile.ref], ...hint(s, tile), still: false };
};
TB_CARD_EXTRA.tv_power = { refresh: tbScreenRefresh, view: tbScreenView(() => ({ state: 'TV power' })), open: (tile) => tbTvSheet(tile) };
TB_CARD_EXTRA.photo_frame = {
  refresh: tbScreenRefresh,
  view: tbScreenView((s) => ({ state: s.ambient_mode ? 'Showing photos' : 'Normal layout', on: !!s.ambient_mode })),
  async open(tile) {
    const s = tbScreenOf(tile); if (!s) return;
    const turnOn = !s.ambient_mode, mode = turnOn ? (s.screensaver_mode === 'photo' ? 'photo' : 'photo_datetime') : '';
    const r = await tbDo('/api/screens/' + encodeURIComponent(s.device_id), 'PUT', { ambient_mode: mode });
    if (!r) return;
    s.ambient_mode = mode; tbFeedback('tap'); tbToast(turnOn ? 'Showing photos on the screen' : 'Back to the normal layout'); tbLastGrid = ''; tbRedraw();
  },
};
TB_CARD_EXTRA.switch_layout = {
  refresh: tbScreenRefresh,
  view: tbScreenView((s) => { const d = (TB.cards.displaysList || []).find((x) => x.slug === s.assigned_display_slug); return { state: d ? d.name : 'Default layout' }; }),
  open: (tile) => tbLayoutSheet(tile),
};
async function tbTvSheet(tile) {
  if (!TB.cards.screensList) await tbScreenRefresh();
  const s = tbScreenOf(tile); const sh = tbCardSheet((s && s.name) || tile.label || 'TV power', []);
  if (!s) { sh.body.innerHTML = '<p class="tb-empty">No screen found.</p>'; return; }
  sh.body.innerHTML = '<div class="tb-row"><button type="button" class="tb-btn tb-giant" data-tv="power-on">TV on</button><button type="button" class="tb-btn tb-giant" data-tv="power-off">TV off</button></div>';
  sh.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tv]'); if (!b) return;
    b.disabled = true; const r = await tbDo('/api/screens/' + encodeURIComponent(s.device_id) + '/tv/' + b.dataset.tv, 'POST', {}); b.disabled = false;
    if (r) { tbFeedback('tap'); tbToast(b.dataset.tv === 'power-on' ? 'TV is turning on' : 'TV is turning off'); }
  });
}
async function tbLayoutSheet(tile) {
  if (!TB.cards.screensList) await tbScreenRefresh();
  const s = tbScreenOf(tile); const sh = tbCardSheet((s && s.name) || tile.label || 'Switch layout', []);
  if (!s) { sh.body.innerHTML = '<p class="tb-empty">No screen found.</p>'; return; }
  const draw = () => { sh.body.innerHTML = '<div class="tb-segs">' + [['', 'Default layout'], ...(TB.cards.displaysList || []).map((d) => [d.slug, d.name])].map(([v, l]) => `<button type="button" class="tb-seg tb-giant${v === (s.assigned_display_slug || '') ? ' on' : ''}" data-slug="${tbEsc(v)}">${tbEsc(l)}</button>`).join('') + '</div>'; };
  draw();
  sh.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-slug]'); if (!b) return;
    const r = await tbDo('/api/screens/' + encodeURIComponent(s.device_id) + '/assign', 'POST', { display: b.dataset.slug });
    if (r) { s.assigned_display_slug = b.dataset.slug; tbFeedback('tap'); tbToast('Layout changed'); draw(); tbLastGrid = ''; tbRedraw(); }
  });
}

// ── the Family Hub QR ─────────────────────────────────────────────────────────────────────────────────────────────────────
function tbLoadQr() {
  return new Promise((resolve) => {
    if (window.QRCode) return resolve(true);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = () => resolve(!!window.QRCode); s.onerror = () => resolve(false); document.head.appendChild(s); setTimeout(() => resolve(!!window.QRCode), 6000);
  });
}
async function tbHubSheet(tile) {
  const sh = tbCardSheet(tile.label || 'Family Hub', []), url = location.origin + '/hub';
  sh.body.innerHTML = `<p class="tb-hint2">Scan this with a phone, then add it to the home screen.</p><div class="tb-qr" data-qr><span class="tb-empty">…</span></div><div class="tb-url">${tbEsc(url)}</div>`;
  const ok = await tbLoadQr(), box = sh.body.querySelector('[data-qr]');
  if (!sh.alive() || !box) return;
  box.innerHTML = '';
  if (!ok) { box.innerHTML = '<span class="tb-empty">The code needs the internet. Type the address below instead.</span>'; return; }
  try { new QRCode(box, { text: url, width: 260, height: 260, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); } catch { box.innerHTML = '<span class="tb-empty">Could not draw the code.</span>'; }
}

// ── kitchen timers ────────────────────────────────────────────────────────────────────────────────────────────────────────
const TBT_KEY = 'phq_tb_timers';
const tbTimers = () => { try { const l = JSON.parse(tbStore(TBT_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
const tbSaveTimers = (l) => { tbStore(TBT_KEY, JSON.stringify(l.slice(0, 12))); };
const tbNextTimer = (l) => l.filter((t) => !t.done).sort((a, b) => a.end - b.end)[0];
TB_CARD_EXTRA.timer = {
  view(tile, base) {
    const list = tbTimers(), run = tbNextTimer(list), ringing = list.some((t) => t.done);
    const v = { ...base, label: tile.label || 'Timers', icon: tile.icon || 'timer', state: 'Tap to start one', still: false };
    if (run) { v.bigText = tbClock((run.end - Date.now()) / 1000); v.timer = true; v.on = true; v.label = run.label || tile.label || 'Timer'; const n = list.filter((t) => !t.done).length; v.state = n > 1 ? n + ' timers' : ''; }
    if (ringing) { v.alert = true; v.state = 'Time is up!'; v.bigText = v.bigText || '0:00'; }
    return v;
  },
  open: (tile) => tbTimerSheet(tile),
};
function tbTimerSheet(tile) {
  const sh = tbCardSheet(tile.label || 'Kitchen timers', []);
  const draw = () => {
    const list = tbTimers().filter((t) => !t.done);
    sh.body.innerHTML = `<div class="tb-segs">${[1, 2, 3, 5, 10, 15, 20, 30, 45, 60].map((m) => `<button type="button" class="tb-seg tb-giant" data-min="${m}">${m} <span>min</span></button>`).join('')}</div>
      <div class="tb-row"><input class="tb-input" type="number" inputmode="numeric" min="1" max="600" data-cmin placeholder="Minutes" aria-label="Minutes"><input class="tb-input" data-clabel maxlength="30" placeholder="What for? (optional)" aria-label="What for?"><button type="button" class="tb-btn primary" data-start>Start</button></div>
      <ul class="tb-itemlist">${list.length ? list.map((t) => `<li data-id="${tbEsc(t.id)}"><span class="tb-rowtext">${tbEsc(t.label || 'Timer')}</span><b data-rem>${tbEsc(tbClock((t.end - Date.now()) / 1000))}</b><button type="button" class="tb-x" data-stop aria-label="Stop">✕</button></li>`).join('') : '<li class="tb-empty">No timers running.</li>'}</ul>`;
  };
  const start = (min, label) => { const sec = Math.round(Number(min) * 60); if (!(sec > 0)) { tbToast('Enter the minutes.'); return; } const l = tbTimers(); l.push({ id: 'tm' + Date.now().toString(36), label: String(label || '').slice(0, 30), sec, end: Date.now() + sec * 1000, done: false }); tbSaveTimers(l); tbFeedback('tap'); tbLastGrid = ''; tbRedraw(); draw(); };
  sh.body.addEventListener('click', (e) => {
    const m = e.target.closest('[data-min]'); if (m) { start(m.dataset.min, ''); return; }
    if (e.target.closest('[data-start]')) { start(sh.body.querySelector('[data-cmin]').value, sh.body.querySelector('[data-clabel]').value.trim()); return; }
    const s = e.target.closest('[data-stop]'); if (s) { const id = s.closest('li').dataset.id; tbSaveTimers(tbTimers().filter((t) => t.id !== id)); tbLastGrid = ''; tbRedraw(); draw(); }
  });
  const tick = setInterval(() => {
    if (!sh.alive()) { clearInterval(tick); return; }
    const list = tbTimers();
    sh.body.querySelectorAll('li[data-id]').forEach((li) => { const t = list.find((x) => x.id === li.dataset.id); const el = li.querySelector('[data-rem]'); if (t && el && !t.done) el.textContent = tbClock((t.end - Date.now()) / 1000); else if (t && t.done) draw(); });
  }, 1000);
  draw();
}
// Every second: a timer that has run out rings (the screen wakes, a sheet says so, the tablet beeps and buzzes until it is stopped), and the number on a timer tile counts down.
function tbRing(t) {
  const idle = document.querySelector('.tb-idle'); if (idle) { idle.remove(); TB.idle = false; tbLiveSync(); }
  const { box, close } = tbSheet(`<h2>Time is up!</h2><p>${tbEsc(t.label || 'Your timer')}</p><button type="button" class="tb-btn primary tb-giant" data-stop>Stop</button>`);
  box.style.zIndex = 60;
  let n = 0; tbBeep(); const again = setInterval(() => { if (!box.isConnected || ++n > 20) { clearInterval(again); return; } tbBeep(); }, 3000);
  box.querySelector('[data-stop]').addEventListener('click', () => { clearInterval(again); close(); tbSaveTimers(tbTimers().filter((x) => x.id !== t.id)); tbLastGrid = ''; tbRedraw(); });
}
function tbTimerTick() {
  if (TB.preview) return;
  const list = tbTimers(); if (!list.length) return;
  let changed = false;
  list.forEach((t) => { if (!t.done && Date.now() >= t.end) { t.done = true; changed = true; tbRing(t); } });
  if (changed) { tbSaveTimers(list); tbLastGrid = ''; tbRedraw(); }
  const run = tbNextTimer(list);
  document.querySelectorAll('[data-tb-timer]').forEach((el) => { el.textContent = run ? tbClock((run.end - Date.now()) / 1000) : '0:00'; });
}
setInterval(tbTimerTick, 1000);

// ── a countdown, and a photo slideshow ────────────────────────────────────────────────────────────────────────────────────
TB_CARD_EXTRA.countdown = {
  view(tile, base) {
    const c = tbCfg(tile), v = { ...base, label: tile.label || c.title || 'Countdown', icon: tile.icon || 'cal', still: true };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) return { ...v, state: 'Choose a day in the tile options' };
    const p = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }, n = Math.round((p(c.date) - p(tbDayStr(0))) / 86400000);
    return { ...v, bigText: n > 0 ? String(n) : n === 0 ? '🎉' : '✓', state: n > 1 ? n + ' days to go' : n === 1 ? '1 day to go' : n === 0 ? 'Today!' : 'Done', defColor: 'purple' };
  },
};
TB_CARD_EXTRA.photos = {
  async refresh() { const r = await tbApi('/api/photos'); if (tbOk(r)) TB.cards.photoList = tbList(r).filter((p) => p && p.filename && p.active !== 0); },
  view(tile, base, wait) {
    const list = TB.cards.photoList; if (!list) return wait('Photos', 'photo');
    if (!list.length) return { ...base, label: tile.label || 'Photos', icon: 'photo', state: 'No photos yet', still: true };
    const p = list[Math.floor(Date.now() / 20000) % list.length];
    return { ...base, label: tile.label || '', bg: '/uploads/' + encodeURI(p.filename).replace(/'/g, '%27'), still: false };
  },
  open: () => tbShowIdle('photos'),
};
