// The /tablet web app, part 3: drawing the page (header with the clock and room tabs, the tile grid, the status line), the refresh loop, the idle screen, and start-up.
'use strict';
let tbLastGrid = '';
let tbPress = null;                       // { id, timer, fired } for the tile being held down

function tbFormatTime(d) { return d.toLocaleTimeString((window.i18n && i18n.lang) || undefined, { hour: 'numeric', minute: '2-digit' }); }
function tbFormatDate(d) { return d.toLocaleDateString((window.i18n && i18n.lang) || undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }

function tbApplyLayout(layout, version) {
  TB.layout = layout; TB.version = version;
  document.documentElement.dataset.mode = layout.theme.mode;
  document.documentElement.dataset.palette = layout.theme.palette || '';
  document.documentElement.dataset.text = layout.theme.text || '';
  TM_LOOKS.forEach((l) => { document.documentElement.dataset['look' + l.key[0].toUpperCase() + l.key.slice(1)] = layout.theme[l.key] || ''; });
  document.documentElement.style.setProperty('--accent', layout.theme.accent);
  if (TB.page >= layout.pages.length) TB.page = 0;
  tbLastGrid = '';
}

// Where a tile goes. Landscape keeps the stored place and size. Portrait has half the columns, so tiles flow in reading order and keep their size as far as it fits.
// A phone is a screen whose shorter side is under 520 CSS pixels. The page then lays itself out for it (class tb-phone on the body): a compact header with the pages as a row of chips, two columns of tiles (three or
// four on a wider phone turned sideways), a tile that is two or more cells wide on the tablet is a full row, remotes take the height of their buttons, a one-line footer, and no idle screen or keeping the screen on
// (a phone has its own lock). The same tiles as the tablet, in the same order (reading order: top to bottom, left to right).
const tbPhone = () => !!window.TB_PHONE || (Math.min(window.innerWidth, window.innerHeight) < 520 && !(TB.edit && window.innerWidth >= window.innerHeight));       // /phone always is one       // (a phone turned sideways shows the tablet's grid while the tiles are being rearranged)
// A remote with its buttons on the tile must be as high as its buttons. Safari (and Chrome, when the screen is short) size an automatic grid row only from the space left on the screen, whatever the tile asks for, so on a phone
// the tile is given as many of the phone's short rows (58 px) as its buttons need: the height of its content is measured, and the tile spans that many rows. Rows of a fixed size behave the same in every browser.
function tbFitRemote(el) {
  const g = tbEl('tb-grid'); if (!g) return;
  el.style.gridRow = 'span 1';
  const need = el.scrollHeight + (el.offsetHeight - el.clientHeight), gap = parseFloat(getComputedStyle(g).rowGap) || 0;
  if (need > 0) el.style.gridRow = 'span ' + Math.max(1, Math.ceil((need + gap) / (58 + gap)));
}
function tbFitRemotes(on) {
  const g = tbEl('tb-grid'); if (!g || !on) return;
  g.querySelectorAll('.tb-tile.remote-inline').forEach(tbFitRemote);
}
const tbPhoneCols = () => (window.innerWidth < 460 ? 2 : window.innerWidth < 760 ? 3 : 4);
function tbPlace(tiles, portrait, page) {
  if (tbPhone()) {
    const pc = tbPhoneCols(), cell = 12 / pc, small = !!TB.layout.phone_small, list = tmPhoneList(page || { tiles }).map((t) => ({ ...t })).filter((t) => t.phone !== 'hide' || TB.edit);       // hidden tiles are left out (shown dimmed while rearranging, so they can come back)
    // The phone's grid has twelve columns: a whole row is 12, a half 6, a third 4; automatic is one cell (a half, a third or a quarter of the row by the width of the phone), or a whole row for a tile that is two or more cells wide on the tablet.
    // With "smaller tiles on phones" a simple one-cell tile is a third of a row; a simple tile can be one line high (compact).
    list.forEach((t) => {                                                                   // (the rules are in tmPhoneBox, shared with the phone layout in the app)
      const b = tmPhoneBox(t, small, cell);
      if (t.phone === 'hide') t._hidden = true;
      t._col = `span ${b.span}`; t._narrow = b.narrow; t._compact = b.compact;
      t._row = `span ${b.rows || 1}`;                                                       // rows are short (58 px); a remote on the tile has one row that grows to hold its buttons
    });
    return list;
  }
  const cols = TB.layout.grid.cols, pc = Math.max(2, Math.ceil(cols / 2));
  const list = tiles.map((t) => ({ ...t }));
  if (!portrait) { list.forEach((t) => { t._col = `${t.x + 1} / span ${t.w}`; t._row = `${t.y + 1} / span ${t.h}`; }); return list; }
  list.sort((a, b) => a.y - b.y || a.x - b.x);
  list.forEach((t) => { t._col = `span ${Math.min(t.w, pc)}`; t._row = `span ${t.h}`; });
  return list;
}

function tbRedraw() {
  if (!TB.layout) return;
  const L = TB.layout, page = L.pages[TB.page] || L.pages[0], portrait = window.innerHeight > window.innerWidth;
  if (!tbEl('tb-head')) {
    tbEl('tb-app').innerHTML = `<div class="tb-head" id="tb-head"><div class="tb-clock"><span class="tb-time" id="tb-time"></span><span class="tb-date" id="tb-date"></span></div><nav class="tb-tabs" id="tb-tabs" aria-label="Pages"></nav><div class="tb-weather" id="tb-weather"></div></div>
      <div class="tb-grid" id="tb-grid"></div><div class="tb-foot"><span id="tb-status"></span><span id="tb-hint"></span></div>`;
  }
  tbEl('tb-tabs').innerHTML = L.pages.length > 1 ? L.pages.map((p, i) => `<button type="button" class="tb-tab${i === TB.page ? ' sel' : ''}" data-page="${i}">${tbEsc(p.name)}</button>`).join('') : '';
  const w = TB.weather && TB.weather.current ? Math.round(TB.weather.current.temperature_2m) : null;
  tbEl('tb-weather').textContent = w === null ? '' : `${w}°`;
  const phone = tbPhone();
  document.body.classList.toggle('tb-phone', phone);
  const grid = tbEl('tb-grid'), cols = phone ? tbPhoneCols() : portrait ? Math.max(2, Math.ceil(L.grid.cols / 2)) : L.grid.cols;
  const tiles = tbPlace(page.tiles, portrait, page);
  const html = tiles.map(tbTileHtml).join('') || '<p style="grid-column:1/-1;color:var(--muted);font-size:18px;align-self:center;text-align:center">No tiles on this page yet. Add some in the app, under Layout, Tablet.</p>';
  grid.style.gridTemplateColumns = `repeat(${phone ? 12 : cols}, minmax(0, 1fr))`;
  if (phone) { grid.style.gridTemplateRows = ''; grid.style.gridAutoRows = 'minmax(58px, auto)'; grid.style.overflowY = 'auto'; grid.style.alignContent = 'start'; }
  else if (portrait) { grid.style.gridTemplateRows = ''; grid.style.gridAutoRows = 'minmax(130px, 1fr)'; grid.style.overflowY = 'auto'; grid.style.alignContent = ''; }
  else { grid.style.gridTemplateRows = `repeat(${L.grid.rows}, minmax(0, 1fr))`; grid.style.gridAutoRows = ''; grid.style.overflowY = ''; grid.style.alignContent = ''; }
  if (phone) { const sel = tbEl('tb-tabs').querySelector('.tb-tab.sel'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ inline: 'center', block: 'nearest' }); }       // the chip of the page that is showing is in view
  if (html !== tbLastGrid && !(TB.edit && TB.edit.drag)) { grid.innerHTML = html; delete grid.dataset.cells; tbLastGrid = html; tbPaintCams(); }   // not while a tile is being dragged: its element must stay
  tbFitRemotes(phone);
  if (TB.edit) tbEditDecorate();
  const st = tbEl('tb-status');
  st.innerHTML = `<span class="tb-dot${TB.online && TB.haOk ? '' : ' bad'}"></span>${TB.online ? (TB.haOk ? 'Live from the home hub' : 'Home Assistant is not reachable') : 'Reconnecting…'}`;
  tbEl('tb-hint').textContent = L.idle.mode === 'off' || !L.idle.minutes ? '' : `Dims after ${tmIdleLabel(L.idle.minutes)} without a touch`;
  tbTick();
}
function tbTick() {
  const d = new Date();
  const a = tbEl('tb-time'); if (a) a.textContent = tbFormatTime(d);
  const b = tbEl('tb-date'); if (b) b.textContent = tbFormatDate(d);
  document.querySelectorAll('[data-tb-clock]').forEach((el) => { el.textContent = tbFormatTime(d); });
  const ic = tbEl('tb-idle-time'); if (ic) { ic.textContent = tbFormatTime(d).replace(/\s?[AP]M$/i, ''); tbEl('tb-idle-date').textContent = tbFormatDate(d); }
}

// ── touches ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function tbTileById(id) { return tbTilesOf(TB.layout).find((t) => t.id === id); }
let tbSwipedAt = 0;
// A tip at the bottom centre for a few seconds when the page opens: how to get to editing. Not when the tablet's settings turn it off, in the preview, or when the page only reloaded itself after an update.
const TB_START_HINT_MS = 6000;
const tbStandalone = () => !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));       // opened from the Home Screen
// A phone is easy on its battery: Home Assistant is asked about every 16 seconds (8 on a tablet), camera stills every 8 (4), and live video does not start on a phone set to save data or on mobile data.
const tbSaver = () => { const c = navigator.connection; return tbPhone() && !!c && (!!c.saveData || c.type === 'cellular'); };
const tbDueAt = {};
const tbDue = (key, tabletMs) => { const gap = tbPhone() ? tabletMs * 2 : tabletMs, now = Date.now(); if (now - (tbDueAt[key] || 0) < gap - 500) return false; tbDueAt[key] = now; return true; };
function tbStartHint() {
  let quiet = false; try { quiet = sessionStorage.getItem('phq_tb_quiet') === '1'; sessionStorage.removeItem('phq_tb_quiet'); } catch { /* private window */ }
  if (TB.preview || quiet || !TB.layout || TB.layout.start_hint === false || TB.edit || tbEl('tb-starthint')) return;
  const h = document.createElement('div'); h.id = 'tb-starthint'; h.className = 'tb-starthint'; h.setAttribute('role', 'status');
  h.textContent = 'Press and hold the clock to edit';
  if (tbPhone() && !tbStandalone() && tbStore('phq_tb_addhome') !== '1') { h.textContent += '. Add this page to your Home Screen to open it full screen.'; tbStore('phq_tb_addhome', '1'); }       // told once on a phone
  document.body.appendChild(h);
  requestAnimationFrame(() => requestAnimationFrame(() => h.classList.add('on')));
  const gone = () => { h.classList.remove('on'); setTimeout(() => h.remove(), 450); };
  document.addEventListener('pointerdown', gone, { once: true, capture: true });          // any touch puts it away (it never takes the touch itself)
  setTimeout(gone, TB_START_HINT_MS);
}
// Show a page, sliding it in from the side it came from (a short slide, none when the system asks for less motion).
function tbGoPage(n, dir) {
  TB.page = n; tbLastGrid = ''; tbRedraw();
  const g = tbEl('tb-grid');
  if (dir && g && g.animate && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) g.animate([{ transform: 'translateX(' + (dir * 7) + '%)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'ease-out' });
}
function tbWire() {
  const app = tbEl('tb-app');
  // Press and hold the clock or the bottom bar to rearrange the tiles (a tile's own long press opens its details, which also offers "Rearrange tiles").
  let hold = null;
  const unhold = () => { if (hold) { clearTimeout(hold); hold = null; } };
  app.addEventListener('pointerdown', (e) => {
    if (TB.edit || TB.preview || !e.target.closest('.tb-clock, .tb-weather, .tb-foot')) return;
    unhold(); hold = setTimeout(() => { hold = null; tbStartEdit(); }, 900);
  });
  app.addEventListener('pointerup', unhold); app.addEventListener('pointerleave', unhold); app.addEventListener('pointercancel', unhold);
  app.addEventListener('pointerdown', (e) => {
    if (TB.edit) return;
    const el = e.target.closest('.tb-tile'); if (!el || e.target.closest('.tb-stepbtn, .tb-spk, .tb-rkey')) return;
    tbPress = { id: el.dataset.tile, fired: false };
    tbPress.timer = setTimeout(() => { const t = tbTileById(tbPress && tbPress.id); if (t && tbPress) { tbPress.fired = true; tbDetails(t); } }, 550);
  });
  // Swipe sideways across the tiles to go to the next or the previous page (a quick, mostly horizontal drag of a good length; slower or shorter ones are taps, holds and scrolls as before). Off while the
  // tablet is being rearranged, on a slider or a text box, or when the tablet's setting says not to. The tap that ends a swipe does nothing.
  let sw = null;
  const swipeable = (t) => !!t && !!t.closest && !!t.closest('#tb-grid') && !t.closest('input, select, textarea, .tb-range, .tb-chk');
  app.addEventListener('pointerdown', (e) => {
    sw = null;
    if (TB.edit || !TB.layout || TB.layout.swipe === false || TB.layout.pages.length < 2 || (e.pointerType === 'mouse' && e.button !== 0) || !swipeable(e.target)) return;
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
  });
  app.addEventListener('pointermove', (e) => {
    if (sw && e.pointerId === sw.id && Math.abs(e.clientX - sw.x) > 14 && tbPress) { clearTimeout(tbPress.timer); }       // it is a swipe, not a long press
  });
  app.addEventListener('pointerup', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y, dt = Date.now() - sw.t; sw = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6 || dt > 900) return;
    const n = TB.page + (dx < 0 ? 1 : -1);
    if (n < 0 || n >= TB.layout.pages.length) return;                                    // no page that way
    tbSwipedAt = Date.now(); if (tbPress) { clearTimeout(tbPress.timer); tbPress = null; }
    tbGoPage(n, dx < 0 ? 1 : -1);
  });
  app.addEventListener('pointercancel', () => { sw = null; });
  app.addEventListener('click', (e) => { if (Date.now() - tbSwipedAt < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
  const cancel = () => { if (tbPress) clearTimeout(tbPress.timer); };
  app.addEventListener('pointerup', cancel); app.addEventListener('pointerleave', cancel); app.addEventListener('pointercancel', cancel);
  app.addEventListener('click', (e) => {
    const tab = e.target.closest('.tb-tab');
    if (tab) { const n = Number(tab.dataset.page) || 0; tbGoPage(n, n > TB.page ? 1 : n < TB.page ? -1 : 0); return; }
    const el = e.target.closest('.tb-tile'); if (!el || TB.edit) return;
    const tile = tbTileById(el.dataset.tile); if (!tile) return;
    const rk = e.target.closest('.tb-rkey'); if (rk) { tbPress = null; tbRemotePress(tile, rk.dataset.custom !== undefined ? null : rk.dataset.key, rk.dataset.custom !== undefined ? Number(rk.dataset.custom) : undefined); return; }       // a button of a remote shown on its tile
    const spk = e.target.closest('.tb-spk'); if (spk) { tbPress = null; tbToggleSound(spk.dataset.cam); return; }       // the speaker on a live camera tile
    const chk = e.target.closest('.tb-chk'); if (chk) { tbPress = null; tbCheck(chk.dataset.chk); return; }       // a box ticked on a list tile
    const stepBtn = e.target.closest('.tb-stepbtn');
    if (stepBtn) { tbStep(tile, Number(stepBtn.dataset.step)); return; }
    if (tbPress && tbPress.fired) { tbPress = null; return; }       // that was a long press, already handled
    tbFeedback('tap');
    tbTap(tile);
  });
  const touched = () => { TB.lastTouch = Date.now(); };
  ['pointerdown', 'keydown'].forEach((n) => document.addEventListener(n, touched, true));
  // The browser lets sound start only after a touch on the page: from the first one, a camera whose sound was left on comes back with it.
  const unlock = (e) => { if (TB.gesture || (e.target.closest && e.target.closest('.tb-spk'))) return; TB.gesture = true; tbSoundAll(); };   // a tap on a speaker is handled by the speaker itself
  ['pointerup', 'click', 'keydown'].forEach((n) => document.addEventListener(n, unlock, true));
  window.addEventListener('resize', () => { tbLastGrid = ''; tbRedraw(); });
}

// ── the idle screen: a photo (or just the clock) after a while without a touch ──────────────────────────────────────────
// How the photos are chosen is the layout's idle.photos (see tmPhotoOpts in js/shared/tablet-model.js): from one tag or all the photos that are in the slideshow, shuffled so that none
// comes round twice before the rest have been shown (or in the library's order), each photo is loaded before it is shown (a photo that will not load is skipped, never a black screen),
// small photos that would look blurry blown up to this screen are passed over while there are better ones, and each one is fitted to the screen: filled when its shape is close to the
// screen's, else shown whole over a soft blurred copy of itself so nothing important is cut off. One photo fades into the next.
let tbIdleTimer = null, tbIdleSwap = null;
const tbPhotoUrl = (p) => '/uploads/' + encodeURIComponent(p.filename);
function tbPhotoPool(all, o) {
  const live = all.filter((p) => p && p.filename && p.active !== 0);
  const tag = String(o.tag || '').toLowerCase();
  const mine = tag ? live.filter((p) => String(p.tags || '').split(',').some((t) => t.trim().toLowerCase() === tag)) : live;
  const pool = mine.length ? mine : live;                              // a tag nobody has any more falls back to all the photos rather than leaving the screen bare
  return o.order === 'order' ? pool.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0)) : pool;
}
// The next photo to show from a deck that is used up before it is dealt again; in a shuffled deck the first photo of a new round is never the one that was just shown.
function tbPhotoNext(deck, pool, o, lastFile) {
  if (!deck.length) {
    const d = pool.slice();
    if (o.order !== 'order') {
      for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
      if (d.length > 1 && d[0].filename === lastFile) d.push(d.shift());
    }
    deck.push(...d);
  }
  return deck.shift();
}
const tbLoadPhoto = (p) => new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = tbPhotoUrl(p); setTimeout(() => resolve(null), 20000); });
// How much a photo has to be enlarged to cover this screen (1 = it is already as big as the screen's own pixels).
const tbPhotoZoom = (im) => { const k = window.devicePixelRatio || 1; return Math.max((innerWidth * k) / im.naturalWidth, (innerHeight * k) / im.naturalHeight); };
function tbPhotoFit(im, fit) {
  if (fit === 'fill' || fit === 'whole') return fit;
  const ia = im.naturalWidth / im.naturalHeight, sa = innerWidth / innerHeight;
  return 1 - Math.min(ia / sa, sa / ia) > 0.25 ? 'whole' : 'fill';       // more than a quarter of the photo would be cut off: show all of it
}
function tbIdleLayer(box, p, im, fit) {
  const url = 'url("' + im.src + '")', layer = document.createElement('div');
  layer.className = 'ph' + (fit === 'whole' ? ' whole' : ''); layer.dataset.photo = p.filename; layer.dataset.fit = fit;
  layer.innerHTML = (fit === 'whole' ? '<div class="bl"></div>' : '') + '<div class="pic"></div>';
  if (fit === 'whole') layer.querySelector('.bl').style.backgroundImage = url;
  layer.querySelector('.pic').style.backgroundImage = url;
  box.insertBefore(layer, box.querySelector('.shade'));
  requestAnimationFrame(() => requestAnimationFrame(() => { layer.classList.add('on'); }));
  const old = [...box.querySelectorAll('.ph')].filter((x) => x !== layer);
  setTimeout(() => old.forEach((x) => x.remove()), 1600);
}
async function tbShowIdle(forceMode) {
  if (tbPhone()) return;                                              // a phone has its own screen lock
  if (TB.idle || !TB.layout || (!forceMode && TB.layout.idle.mode === 'off')) return;
  const mode = forceMode || TB.layout.idle.mode;                    // a time-of-day rule can ask for the clock or photos whatever the usual setting is
  TB.idle = true; tbLiveSync();                                     // live tiles stop while the idle screen is up
  const box = document.createElement('div');
  box.className = 'tb-idle'; box.id = 'tb-idle';
  box.innerHTML = '<div class="shade"></div><div class="clock"><b id="tb-idle-time"></b><span id="tb-idle-date"></span></div><div class="extra" id="tb-idle-extra"></div>';
  document.body.appendChild(box);
  const up = TB.cards.next_up;
  tbEl('tb-idle-extra').innerHTML = (TB.weather && TB.weather.current ? `<span>${Math.round(TB.weather.current.temperature_2m)}°</span>` : '') + (up ? `<span>Next: ${tbEsc(up.title)}${up.when ? ', ' + tbEsc(up.when) : ''}</span>` : '');
  tbTick();
  const o = tmPhotoOpts(TB.layout.idle);
  let pool = [], deck = [], last = '', busy = false;
  const swap = async () => {
    if (mode !== 'photos' || busy || !box.isConnected || !pool.length) return;
    busy = true;
    try {
      let best = null;
      for (let tries = 0; tries < Math.min(8, pool.length + 2); tries++) {
        const p = tbPhotoNext(deck, pool, o, last), im = await tbLoadPhoto(p);
        if (!box.isConnected) return;
        if (!im) continue;                                            // would not load: try the next one
        const zoom = tbPhotoZoom(im);
        if (!best || zoom < best.zoom) best = { p, im, zoom };
        if (!o.skip_small || zoom <= 1.5 || pool.length === 1) break;    // sharp enough on this screen (not blown up by more than half again)
      }
      if (best) { last = best.p.filename; tbIdleLayer(box, best.p, best.im, tbPhotoFit(best.im, o.fit)); }
    } finally { busy = false; }
  };
  tbIdleSwap = swap;
  if (mode === 'photos') {
    const r = await tbApi('/api/photos');
    if (!box.isConnected) return;
    pool = tbPhotoPool(tbOk(r) ? tbList(r) : [], o);
    swap(); tbIdleTimer = setInterval(swap, o.seconds * 1000);
  }
  const wake = () => { clearInterval(tbIdleTimer); tbIdleSwap = null; box.remove(); TB.idle = false; TB.lastTouch = Date.now(); tbLiveSync(); tbRefreshAll(); };
  box.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); wake(); }, { once: true });
}
const tbIdleNext = () => (tbIdleSwap ? tbIdleSwap() : null);       // show the next photo now (used by the tests)

// ── refresh ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function tbRefreshAll() {
  await Promise.all([tbRefreshHa(), tbRefreshCards()]);
  tbRedraw();
}
// The page keeps running the code it loaded when it opened, so after the hub is updated it would go on with the old version (the wall display and the app reload themselves for this).
// The version of the hub is noted when the page opens and looked at again with every check-in; when it has changed the page reloads, unless the tablet is being edited or a sheet is open (it tries again later).
async function tbCheckVersion() {
  if (TB.preview) return;
  const v = await tbApi('/api/version');
  if (!tbOk(v) || !v.version) return;
  if (!TB.appVersion) { TB.appVersion = v.version; return; }
  if (v.version === TB.appVersion) return;
  if (TB.edit || tbEl('tb-panel') || document.querySelector('#tb-overlays .tb-sheet')) return;
  try { sessionStorage.setItem('phq_tb_quiet', '1'); } catch { /* private window */ }                // the page that opens after this reload does not show the tip again
  location.reload();
}
async function tbCheckin() {
  tbCheckVersion();
  const c = await tbApi(`/api/tablets/${encodeURIComponent(TB.id)}/checkin`, { method: 'POST', body: '{}' });
  if (!tbOk(c)) { if (c && c.__status === 404) { tbStore('phq_tablet_id', null); location.reload(); } return; }
  if (c.pin_set !== undefined) TB.pinSet = !!c.pin_set;
  if (c.pin_optional !== undefined) TB.pinOptional = !!c.pin_optional;
  if (c.version !== TB.version) {
    const t = await tbApi('/api/tablets/' + encodeURIComponent(TB.id));
    if (tbOk(t) && t.layout) { tbApplyLayout(t.layout, t.version); TB.name = t.name; await tbRefreshAll(); tbRefreshCams(); tbRulesTick(); }
  }
}
async function tbKeepAwake() {
  if (tbPhone()) return;                                              // and decides for itself when to sleep
  try { if (navigator.wakeLock && !TB.lock) { TB.lock = await navigator.wakeLock.request('screen'); TB.lock.addEventListener('release', () => { TB.lock = null; }); return; } } catch { /* needs HTTPS: fall through to the video trick below */ }
  if (!TB.lock) tbVideoAwake();
}
// On plain http the Wake Lock API is not offered. A playing (muted, looping) video keeps most tablets awake, so draw a still frame onto a canvas, play its stream, and do it on the first touch
// (browsers only start video after a touch). Best effort: the tablet's own Auto-Lock setting is the reliable way, and the editor says so.
function tbVideoAwake() {
  if (TB.video || !document.createElement('canvas').captureStream) return;
  const go = () => {
    if (TB.video) return;
    try {
      const c = document.createElement('canvas'); c.width = 16; c.height = 16;
      const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 16, 16);
      const v = document.createElement('video');
      v.setAttribute('playsinline', ''); v.muted = true; v.loop = true; v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none;left:0;top:0';
      v.srcObject = c.captureStream(1); document.body.appendChild(v);
      setInterval(() => { g.fillStyle = Math.random() < .5 ? '#000' : '#010101'; g.fillRect(0, 0, 16, 16); }, 5000);   // a changing frame keeps the stream alive
      v.play().then(() => { TB.video = v; }).catch(() => { v.remove(); });
    } catch { /* not supported here */ }
  };
  document.addEventListener('pointerdown', go, { once: true });
}
// Changes made in the app (the layout, the lists a tile counts, the meal plan) arrive as they happen; the 30-second check-in remains the fallback.
function tbLive() {
  if (!window.EventSource) return;
  const tok = tbStore(TB_TOKEN_KEY);
  const es = new EventSource('/api/live' + (tok ? '?_token=' + encodeURIComponent(tok) : ''));
  es.onmessage = (m) => {
    let topic = ''; try { topic = JSON.parse(m.data).topic; } catch { return; }
    if (topic === 'tablets') tbCheckin();
    else if (topic === 'screens' || topic === 'boards') {                  // a screen's presentation, or a drawing on a board, changed: only the tiles that show them are asked again
      const refs = new Set(tbTilesOf(TB.layout).filter((t) => t.kind === 'card').map((t) => t.ref));
      Promise.all(Object.entries(TB_CARD_EXTRA).filter(([r, ex]) => ex.live === topic && ex.refresh && refs.has(r)).map(([, ex]) => ex.refresh())).then(tbRedraw);
      if (TB.openSheet && TB.openSheet.alive() && TB.openSheet.topics.includes(topic)) TB.openSheet.refresh();
    }
    else if (['shopping', 'todos', 'meals', 'events', 'messages', 'chores'].includes(topic)) { tbRefreshCards().then(tbRedraw); if (TB.openSheet && TB.openSheet.alive() && TB.openSheet.topics.includes(topic)) TB.openSheet.refresh(); }
  };
}

// ── time-of-day rules: dim the screen, show the clock or photos, or open a page, between two times on chosen days ────────────────────────
const tbMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const tbDayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
// Is this rule's window open at `d`? Gives { on, key } where key names this one occurrence (the day it began), so a window does its one-time steps once.
function tbRuleWindow(r, d) {
  const mins = d.getHours() * 60 + d.getMinutes(), f = tbMin(r.from), t = tbMin(r.to), days = r.days && r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6];
  if (f === t) return { on: false };
  if (f < t) return mins >= f && mins < t && days.includes(d.getDay()) ? { on: true, key: r.id + '@' + tbDayKey(d) } : { on: false };
  if (mins >= f) return days.includes(d.getDay()) ? { on: true, key: r.id + '@' + tbDayKey(d) } : { on: false };       // wraps past midnight: the evening part
  if (mins < t) { const y = new Date(d); y.setDate(y.getDate() - 1); return days.includes(y.getDay()) ? { on: true, key: r.id + '@' + tbDayKey(y) } : { on: false }; }   // and the small hours
  return { on: false };
}
function tbRulesTick(now) {
  const rules = (TB.layout && TB.layout.rules) || [], d = now || new Date();
  let dim = 0;
  rules.forEach((r) => {
    const w = tbRuleWindow(r, d);
    if (!w.on) return;
    dim = Math.max(dim, r.dim || 0);
    if (TB.ruleSeen[w.key]) return;
    TB.ruleSeen[w.key] = true;                                      // the first time this window is seen: open its page, and show its screen
    const i = r.page ? TB.layout.pages.findIndex((p) => p.id === r.page) : -1;
    if (i >= 0 && i !== TB.page) { TB.page = i; tbLastGrid = ''; tbRedraw(); }
    if (r.screen && !TB.idle) tbShowIdle(r.screen);
  });
  const el = tbEl('tb-dim'); if (el) el.style.opacity = String(dim / 100);
  return dim;
}

// The editor shows the real page in a frame with ?preview=1: it gets the layout from the editor (so it follows every change at once), changes nothing on the server, and sleeps for no one.
function tbPreviewBoot() {
  TB.preview = true; TB.id = 'preview';
  tbWire();
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'tb-layout' || !e.data.layout) return;
    tbApplyLayout(e.data.layout, 0);
    if (typeof e.data.page === 'number' && e.data.page < TB.layout.pages.length) TB.page = e.data.page;
    tbRedraw(); tbRefreshAll();
  });
  setInterval(tbTick, 1000);
  setInterval(() => { if (!document.hidden && TB.layout) tbRefreshHa().then(tbRedraw); }, 8000);
  try { parent.postMessage({ type: 'tb-ready' }, location.origin); } catch { /* not in a frame */ }
}

// Stall recorder: the page tells the hub when it was stuck for a few seconds (the slow task, or a gap in its own one-second tick), with what it was showing, so a freeze can be looked into.
let tbLastStall = 0, tbTickAt = Date.now();
function tbReportStall(ms, how) {
  if (TB.preview || !TB.id || Date.now() - tbLastStall < 60000) return;
  tbLastStall = Date.now();
  const tiles = TB.layout ? TB.layout.pages.reduce((n, p) => n + p.tiles.length, 0) : 0;
  tbApi('/api/tablets/' + encodeURIComponent(TB.id) + '/stall', { method: 'POST', body: JSON.stringify({ ms: Math.round(ms), how, editing: !!TB.edit, idle: !!TB.idle, tiles, live: Object.keys(TB.live || {}).length, hidden: document.hidden, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0 }) }).catch(() => {});
}
try { new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.duration >= 2500) tbReportStall(e.duration, 'task'); }).observe({ entryTypes: ['longtask'] }); } catch { /* not supported here */ }
setInterval(() => { const now = Date.now(), gap = now - tbTickAt; tbTickAt = now; if (gap > 4000 && !document.hidden) tbReportStall(gap, 'tick'); }, 1000);
document.addEventListener('visibilitychange', () => { tbTickAt = Date.now(); });                  // a page that was in the background is not a stall

(async function tbBoot() {
  if (new URLSearchParams(location.search).get('preview')) { tbPreviewBoot(); return; }
  tbWire();
  let t = null;
  while (!t) { t = await tbIdentify(); if (!t) await new Promise((r) => setTimeout(r, 5000)); }
  TB.id = t.id; TB.name = t.name; TB.pinSet = !!t.pin_set; TB.pinOptional = !!t.pin_optional;
  tbCheckVersion();                                                  // note the version of the hub this page was loaded from
  tbApplyLayout(t.layout, t.version);
  tbRedraw();
  await tbRefreshWeather();
  await tbRefreshAll();
  tbRefreshCams();
  setTimeout(tbStartHint, 800);
  setInterval(tbTick, 1000);
  setInterval(() => { if (!document.hidden && !TB.idle && tbDue('ha', 8000)) tbRefreshHa().then(tbRedraw); }, 8000);
  setInterval(() => { if (!document.hidden && !TB.idle && tbDue('cams', 4000)) tbRefreshCams(); }, 4000);
  setInterval(() => { if (!document.hidden) { tbCheckin(); tbRefreshWeather(); tbRefreshCards().then(tbRedraw); } }, 30000);
  setInterval(() => tbRulesTick(), 15000); tbRulesTick();
  setInterval(() => { if (!document.hidden && TB.layout.idle.mode !== 'off' && TB.layout.idle.minutes > 0 && !TB.idle && Date.now() - TB.lastTouch > TB.layout.idle.minutes * 60000) tbShowIdle(); }, 5000);
  tbCheckin(); tbKeepAwake(); tbLive();
  document.addEventListener('visibilitychange', () => { tbLiveSync(); if (!document.hidden) { tbKeepAwake(); tbRefreshAll(); tbCheckin(); } });
})();
