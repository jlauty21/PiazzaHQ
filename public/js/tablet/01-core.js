// The /tablet web app, part 1: shared state, the server calls (with the PIN sign-in when the household has one), "which tablet is this", and the PIN pad.
// Layout: 01-core.js (this), 02-tiles.js (what each kind of tile shows and does), 03-page.js (drawing the page, the refresh loop, the idle screen).
'use strict';
const TB = {
  id: '', name: '', layout: null, version: 0, page: 0,
  ents: {}, extra: {}, cards: {},          // Home Assistant states by entity id; per-entity detail (thermostat targets); data for the Piazza HQ tiles
  hist: {},                                // sensor history by entity id, for trend lines: { at, points }
  cams: {}, camImg: {}, camsLoaded: false, camsAt: 0,   // camera names by id and the latest still picture (a blob address) per camera
  flash: {}, failed: {}, busy: {},         // per tile id: a brief message ("Done"), a recent failure, an action in progress
  weather: null, weatherAt: 0, online: true, lastTouch: Date.now(), idle: false, haOk: true, routineOn: {}, camKinds: {}, live: {}, camOpen: {}, gesture: false,
  preview: false, ruleSeen: {},            // preview: shown inside the editor, so nothing is changed; ruleSeen: which time-of-day rule windows already did their one-time steps
};
const tbEl = (id) => document.getElementById(id);
const tbEsc = (s) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function tbStore(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } return ''; }
const TB_TOKEN_KEY = 'pi_cal_token';        // the same sign-in the main app uses on this browser

// ── server calls ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function tbApi(path, opts = {}, retried) {
  if (TB.preview && opts.method && opts.method !== 'GET') { tbToast('This is only a preview. Nothing was changed.'); return { error: 'preview', __status: 0 }; }
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const tok = tbStore(TB_TOKEN_KEY); if (tok) headers['x-session-token'] = tok;
  let res;
  try { res = await fetch(path, { ...opts, headers }); } catch { TB.online = false; return { __networkError: true }; }
  TB.online = true;
  if (res.status === 401 && !retried) { await tbSignIn(); return tbApi(path, opts, true); }
  let json = null; try { json = await res.json(); } catch { json = null; }
  if (json && typeof json === 'object' && !Array.isArray(json)) { Object.defineProperty(json, '__status', { value: res.status, enumerable: false }); }
  else json = { __status: res.status, __body: json };
  return json;
}
const tbOk = (r) => r && !r.__networkError && !r.error && (r.__status === undefined || r.__status < 400);

// ── the PIN pad (sign-in and the step before a lock or garage tile) ────────────────────────────────────────────────────
function tbPinPad(title, sub, opts) {
  const manual = !!(opts && opts.manual);          // a code of any length, ended with OK (an alarm's own code), not four digits
  return new Promise((resolve) => {
    let pin = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Cancel', '0', '⌫'];
    const box = document.createElement('div');
    box.className = 'tb-overlay';
    box.innerHTML = `<div class="tb-sheet" role="dialog" aria-label="Enter PIN"><h2>${tbEsc(title)}</h2><p>${tbEsc(sub || 'Enter the household PIN')}</p>
      <div class="tb-dots">${[0, 1, 2, 3].map(() => '<span class="tb-pd"></span>').join('')}</div>
      <div class="tb-err" id="tb-pin-err" role="alert"></div>
      <div class="tb-keys">${keys.map((k) => `<button type="button" class="tb-key${k === 'Cancel' ? ' small' : ''}" data-k="${k}" ${k === '⌫' ? 'aria-label="Delete"' : ''}>${k}</button>`).join('')}${manual ? '<button type="button" class="tb-key" data-k="OK" style="grid-column:1/-1">OK</button>' : ''}</div></div>`;
    tbEl('tb-overlays').appendChild(box);
    const paint = () => box.querySelectorAll('.tb-pd').forEach((d, i) => d.classList.toggle('full', i < pin.length));
    const done = (v) => { box.remove(); resolve(v); };
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.tb-key'); if (!b) return;
      const k = b.dataset.k;
      if (k === 'Cancel') return done(null);
      if (k === 'OK') { if (pin) done(pin); return; }
      if (k === '⌫') pin = pin.slice(0, -1);
      else if (pin.length < 8) pin += k;
      paint();
      if (!manual && pin.length === 4) setTimeout(() => done(pin), 120);        // household PINs are four digits
    });
    paint();
  });
}
// Sign in with the household PIN when the server asks for one; the token is shared with the main app on this browser.
async function tbSignIn() {
  for (;;) {
    const pin = await tbPinPad('Sign in', 'Enter the household PIN to use this tablet');
    if (pin === null) continue;                                     // a tablet on the wall cannot be dismissed
    let res; try { res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) }); } catch { continue; }
    let j = {}; try { j = await res.json(); } catch { j = {}; }
    if (res.ok && j.ok !== false) { if (j.token) tbStore(TB_TOKEN_KEY, j.token); return; }
    tbToast(j.error || 'That PIN is not right.');
  }
}
function tbToast(msg, ms) {
  let t = tbEl('tb-toast');
  if (!t) { t = document.createElement('div'); t.id = 'tb-toast'; t.setAttribute('role', 'status'); t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--surface-hi);color:var(--text);border:1px solid var(--line);border-radius:14px;padding:12px 20px;font-size:16px;z-index:40;max-width:90%;text-align:center'; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, ms || 3200);
}

// ── which tablet is this ──────────────────────────────────────────────────────────────────────────────────────────────
// The address can carry it (/tablet?t=tab_ab12cd, which the app's QR code does); otherwise this browser remembers it; otherwise the person picks or names it, once.
async function tbIdentify() {
  const fromUrl = new URLSearchParams(location.search).get('t');
  if (fromUrl) { tbStore('phq_tablet_id', fromUrl); history.replaceState(null, '', '/tablet'); }
  const saved = tbStore('phq_tablet_id');
  if (saved) {
    const t = await tbApi('/api/tablets/' + encodeURIComponent(saved));
    if (tbOk(t) && t.id) return t;
    if (t && t.__status === 404) tbStore('phq_tablet_id', null);   // it was removed in the app: choose again
    else if (!tbOk(t)) return null;                                 // the server is not reachable right now: keep what is remembered and retry
  }
  const list = await tbApi('/api/tablets');
  const tablets = Array.isArray(list.__body) ? list.__body : (Array.isArray(list) ? list : []);
  return new Promise((resolve) => {
    const isPhone = !!window.TB_PHONE, listHtml = `<div class="tb-list">${tablets.map((t) => `<button type="button" class="tb-btn" data-id="${tbEsc(t.id)}">${tbEsc(t.name)}</button>`).join('')}</div>`;
    const box = document.createElement('div');
    box.className = 'tb-overlay';
    box.innerHTML = `<div class="tb-sheet"><h2>${isPhone ? 'Which phone is this?' : 'Which tablet is this?'}</h2><p>${isPhone ? 'Give this phone a name and choose what to start with. Or use one that already exists.' : 'Pick it from the list, or give this one a name.'}</p>
      ${isPhone ? '' : listHtml}
      <input class="tb-input" id="tb-newname" maxlength="40" placeholder="Name, for example Kitchen tablet or Dad's phone" aria-label="Name of this tablet or phone">
      ${tablets.length ? `<label class="tb-copylab">Start with the tiles of <select class="tb-input" id="tb-copyfrom" aria-label="Start with the tiles of"><option value="">No tiles (start empty)</option>${tablets.map((t) => `<option value="${tbEsc(t.id)}">${tbEsc(t.name)}</option>`).join('')}</select></label>` : ''}
      <button type="button" class="tb-btn primary" id="tb-create">Use this name</button><div class="tb-err" id="tb-setup-err" role="alert"></div>
      ${isPhone && tablets.length ? `<details class="tb-copylab"><summary>Use one that already exists</summary>${listHtml}</details>` : ''}</div>`;
    tbEl('tb-overlays').appendChild(box);
    const pick = async (id) => { const t = await tbApi('/api/tablets/' + encodeURIComponent(id)); if (tbOk(t)) { tbStore('phq_tablet_id', t.id); box.remove(); resolve(t); } };
    box.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.id)));
    tbEl('tb-create').addEventListener('click', async () => {
      const name = tbEl('tb-newname').value.trim();
      if (!name) { tbEl('tb-setup-err').textContent = 'Give this tablet a name first.'; return; }
      const from = tbEl('tb-copyfrom') ? tbEl('tb-copyfrom').value : '';
      const t = await tbApi('/api/tablets', { method: 'POST', body: JSON.stringify(from ? { name, copy_from: from } : { name }) });
      if (tbOk(t) && t.id) { tbStore('phq_tablet_id', t.id); box.remove(); resolve(t); } else tbEl('tb-setup-err').textContent = (t && t.error) || 'Could not add this tablet.';
    });
  });
}
