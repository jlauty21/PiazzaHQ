// ── Layout → Tablet: set up the wall tablet dashboard (/tablet) ─────────────────────────────────────────────────────────
// Pick or add a tablet, give it pages (usually one per room) and put tiles on them. A tile is a Home Assistant device, a scene, a sensor, a group of lights, a camera or a Piazza HQ
// tile. Tiles are placed on a grid: drag one to move it, drag its corner to resize it, or use the size menu. Next to the grid is a live preview of the real tablet page, in landscape
// or portrait, that follows every change. Each tile can have its own icon, colors, text size and tap behavior; sensors can show a trend line and turn red past a limit. Time-of-day rules,
// a color palette, text size, sound and buzz are set per tablet, and a page or a tile can be copied to another tablet.
// Every change is saved at once; the tablet picks it up within seconds. Icons and colors come from js/shared/tablet-icons.js, the same file the tablet page draws with.
const TE = { id: '', tablets: [], tablet: null, layout: null, page: 0, saving: 0, base: '', lan: '', path: '/tablet', sel: '', landscape: true, phone: false, ready: false, open: new Set() };   // open: tiles whose More options panel is unfolded
const TE_CARD_LABELS = TM_CARD_LABELS;
const TE_COLORS = TB_COLORS;
const TE_SIZES = TM_SIZES;
const TE_GROUP_DOMAINS = TM_GROUP_DOMAINS;
const TE_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const teId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const teSizeOf = tmSizeOf;
const teHex = tmHex;

// ── where tiles sit ─────────────────────────────────────────────────────────────────────────────────────────────────────
const teOverlap = tmOverlap;
const teFits = tmFits;
const teFirstFree = tmFirstFree;
// Every tile stays where it is, unless it sticks out of the grid or lands on an earlier tile; those go to the first free spot. False when something did not fit anywhere.
function teFit(page, cols, rows) {
  const placed = []; let all = true;
  page.tiles.forEach((t) => {
    t.w = Math.min(t.w, cols); t.h = Math.min(t.h, rows);
    if (!teFits(placed, t, cols, rows)) {
      const f = teFirstFree(placed, t.w, t.h, cols, rows);
      if (f) { t.x = f.x; t.y = f.y; } else { all = false; t.x = 0; t.y = Math.max(0, rows - t.h); }
    }
    placed.push(t);
  });
  return all;
}
// first free spot for every tile, in order (the "Tidy up" button and a full reflow)
function tePack(page, cols, rows) {
  page.tiles.forEach((t) => { t.x = -1; t.y = -1; });
  const placed = []; let all = true;
  page.tiles.forEach((t) => {
    t.w = Math.min(t.w, cols); t.h = Math.min(t.h, rows);
    const f = teFirstFree(placed, t.w, t.h, cols, rows);
    if (f) { t.x = f.x; t.y = f.y; } else { all = false; t.x = 0; t.y = Math.max(0, rows - t.h); }
    placed.push(t);
  });
  return all;
}
// Run a change on a page; when the result does not fit, put everything back as it was.
function teTry(page, cols, rows, change) {
  const snap = page.tiles.map((t) => [t.x, t.y, t.w, t.h]);
  change();
  if (teFit(page, cols, rows)) return true;
  page.tiles.forEach((t, i) => { if (snap[i]) { t.x = snap[i][0]; t.y = snap[i][1]; t.w = snap[i][2]; t.h = snap[i][3]; } });
  return false;
}

// ── saving and the live preview ─────────────────────────────────────────────────────────────────────────────────────────
function tePreviewPost() {
  const f = $('te-preview'); if (!f || !f.contentWindow || !TE.ready || !TE.layout) return;
  try { f.contentWindow.postMessage({ type: 'tb-layout', layout: JSON.parse(JSON.stringify(TE.layout)), page: TE.page }, location.origin); } catch { /* the frame is not ready */ }
}
function tePreviewFit() {
  const wrap = $('te-prevbox'), f = $('te-preview'); if (!wrap || !f) return;
  const W = TE.phone ? 390 : TE.landscape ? 1024 : 768, H = TE.phone ? 844 : TE.landscape ? 768 : 1024, k = Math.min(1, wrap.clientWidth / W) || 0.5;
  f.style.width = W + 'px'; f.style.height = H + 'px'; f.style.transform = `scale(${k})`;
  wrap.style.height = Math.round(H * k) + 'px';
}
window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.type === 'tb-ready') { TE.ready = true; tePreviewPost(); } });
window.addEventListener('resize', () => { try { tePreviewFit(); } catch { /* the editor is not open */ } });

async function teSave(quiet) {
  const my = ++TE.saving;
  tePreviewPost();
  const r = await apiFetch(`/api/tablets/${encodeURIComponent(TE.id)}/layout`, { method: 'PUT', body: JSON.stringify({ layout: TE.layout }) });
  if (my !== TE.saving) return;
  // TE.layout stays the same object: the buttons on screen are wired to it, and swapping it for the server's copy would leave them editing a stale one.
  if (r && r.layout) { if (!quiet) showToast('Saved ✓'); } else showToast('❌ Could not save');
}

async function renderLayoutTabletSubTab() {
  const box = $('layout-subtab-content');
  if (!box) return;
  const list = await apiFetch('/api/tablets').catch(() => []);
  TE.tablets = Array.isArray(list) ? list : [];
  if (!TE.tablets.length) {
    box.innerHTML = `<div class="empty-state" style="padding:20px"><div class="emoji">📱</div><p>Turn a wall tablet into a touch dashboard for your lights, locks, scenes and family lists. Add a tablet, then open its address on the tablet itself.</p><button class="btn btn-primary" id="te-add-first" style="margin-top:10px">Add a tablet</button></div>`;
    $('te-add-first').addEventListener('click', teAddTablet);
    return;
  }
  let want = TE.id || (() => { try { return localStorage.getItem('phq_edit_tablet') || ''; } catch { return ''; } })();
  if (!TE.tablets.some((t) => t.id === want)) want = TE.tablets[0].id;
  TE.id = want;
  try { localStorage.setItem('phq_edit_tablet', want); } catch { /* ignore */ }
  const t = await apiFetch('/api/tablets/' + encodeURIComponent(TE.id));
  if (!t || !t.layout) { box.innerHTML = '<p style="color:var(--muted);padding:12px">Could not load that tablet.</p>'; return; }
  // The address a tablet should open: this server's Tailscale address when there is one (it works from any network), else the address this browser used.
  if (!TE.base) { const ts = await apiFetch('/api/tailscale-status').catch(() => null); TE.lan = location.origin; TE.tail = ts && ts.installed && ts.ip ? 'http://' + ts.ip + ':' + (ts.port || 3000) : ''; TE.base = TE.tail || location.origin; }
  if (!window._teCameras) { const c = await apiFetch('/api/cameras').catch(() => []); window._teCameras = Array.isArray(c) ? c : []; }
  TE.tablet = t; TE.layout = t.layout;
  TE.layout.rules = TE.layout.rules || [];
  if (TE.page >= TE.layout.pages.length) TE.page = 0;
  // The preview frame lives outside the part that is redrawn after each change, so it is not reloaded every time.
  box.innerHTML = `<div id="te-main"></div><div id="te-prevhost"></div><div id="te-rest"></div>`;
  TE.ready = false;
  $('te-prevhost').innerHTML = `<div class="settings-card" style="padding:12px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><div style="font-weight:600;font-size:13px">Live preview</div>
        <div style="display:flex;gap:6px"><button class="btn te-orient" data-l="1" style="width:auto;margin:0;padding:4px 12px;font-size:12px">Landscape</button><button class="btn te-orient" data-l="0" style="width:auto;margin:0;padding:4px 12px;font-size:12px">Portrait</button><button class="btn te-orient" data-l="p" style="width:auto;margin:0;padding:4px 12px;font-size:12px">Phone</button></div></div>
      <div id="te-prevbox" style="position:relative;width:100%;max-width:${TE.phone ? 300 : TE.landscape ? 760 : 520}px;margin:0 auto;overflow:hidden;border-radius:12px;border:1px solid var(--border);background:#000"><iframe id="te-preview" title="Preview of the tablet" src="/tablet?preview=1" style="position:absolute;left:0;top:0;border:0;transform-origin:0 0"></iframe></div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;text-align:center">This is the real tablet page. Tiles here do nothing when touched.</div></div>`;
  document.querySelectorAll('.te-orient').forEach((b) => b.addEventListener('click', () => { TE.phone = b.dataset.l === 'p'; if (!TE.phone) TE.landscape = b.dataset.l === '1'; teOrientPaint(); tePreviewFit(); }));
  teOrientPaint(); tePreviewFit();
  teDraw();
}
function teOrientPaint() {
  document.querySelectorAll('.te-orient').forEach((b) => { const on = TE.phone ? b.dataset.l === 'p' : b.dataset.l !== 'p' && (b.dataset.l === '1') === TE.landscape; b.style.background = on ? '' : 'var(--card)'; b.style.border = on ? '' : '1px solid var(--border)'; });
  const w = $('te-prevbox'); if (w) w.style.maxWidth = (TE.phone ? 300 : TE.landscape ? 760 : 520) + 'px';
}

// ── drawing the editor ──────────────────────────────────────────────────────────────────────────────────────────────────
const teDefaultIcon = tmDefaultIcon;
function teTileName(t) {
  if (t.label) return t.label;
  if (t.kind === 'card') return TE_CARD_LABELS[t.ref] || t.ref;
  if (t.kind === 'camera') { const c = (window._teCameras || []).find((x) => 'cam_' + x.id === t.ref); return c ? c.name : 'Camera'; }
  if (t.kind === 'group') return 'Group';
  if (t.kind === 'routine') return 'Actions';
  return teEntityName(t.ref);
}
function teEntityName(ref) { const e = (window._teEntities || []).find((x) => x.entity_id === ref); return e ? e.friendly_name : ref; }
const teIsSensor = tmIsSensor;

function teDraw() {
  const box = $('te-main'), rest = $('te-rest');
  if (!box || !rest || !TE.layout) return;
  const scroller = document.getElementById('content'), kept = scroller ? scroller.scrollTop : 0;       // the editor is drawn again after every change: the page stays where it was scrolled to
  const L = TE.layout, page = L.pages[TE.page], url = `${TE.base}${TE.path}?t=${encodeURIComponent(TE.id)}`;
  teFit(page, L.grid.cols, L.grid.rows);
  if (!page.tiles.some((t) => t.id === TE.sel)) TE.sel = '';
  const seen = TE.tablet.last_seen ? (TE.tablet.online ? 'Connected now' : 'Last seen ' + new Date(TE.tablet.last_seen).toLocaleString()) : 'Has not connected yet';
  const th = L.theme, sel = (v, cur) => (v === cur ? 'selected' : '');
  const top = `
    <div class="settings-card" style="padding:12px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="form-input" id="te-pick" style="flex:1;min-width:140px">${TE.tablets.map((x) => `<option value="${escapeHtml(x.id)}" ${x.id === TE.id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>
        <button class="icon-btn" id="te-rename" title="Rename">✏️</button><button class="icon-btn" id="te-add" title="Add a tablet">＋</button><button class="icon-btn del" id="te-del" title="Remove this tablet">🗑️</button>
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:12px">
        <div id="te-qr" style="background:#fff;padding:5px;border-radius:6px;width:110px;height:110px;flex-shrink:0"></div>
        <div style="min-width:0"><div style="font-size:12px;color:var(--muted)">Open this address on the tablet or phone, then add it to the home screen:</div>
          <div style="display:flex;gap:6px;margin:6px 0" role="group" aria-label="Which device"><button type="button" class="btn te-dev" data-p="/tablet" style="width:auto;margin:0;padding:4px 10px;font-size:12px;${TE.path === '/tablet' ? '' : 'background:var(--card);border:1px solid var(--border)'}">For a tablet</button><button type="button" class="btn te-dev" data-p="/phone" style="width:auto;margin:0;padding:4px 10px;font-size:12px;${TE.path === '/phone' ? '' : 'background:var(--card);border:1px solid var(--border)'}">For a phone</button></div>
          ${TE.tail && TE.lan && TE.tail !== TE.lan ? `<div style="display:flex;gap:6px;margin:6px 0" role="group" aria-label="Which address"><button type="button" class="btn te-addr" data-b="tail" style="width:auto;margin:0;padding:4px 10px;font-size:12px;${TE.base === TE.tail ? '' : 'background:var(--card);border:1px solid var(--border)'}">Anywhere (Tailscale)</button><button type="button" class="btn te-addr" data-b="lan" style="width:auto;margin:0;padding:4px 10px;font-size:12px;${TE.base === TE.lan ? '' : 'background:var(--card);border:1px solid var(--border)'}">Home Wi-Fi</button></div>` : ''}
          <div style="font-size:13px;word-break:break-all;margin:4px 0">${escapeHtml(url)}</div>
          <button class="btn" id="te-copy" style="width:auto;margin:0;padding:6px 12px;background:var(--card);border:1px solid var(--border)">Copy address</button>
          <div style="font-size:11px;color:var(--muted);margin-top:6px">${escapeHtml(seen)}</div></div>
      </div>
    </div>
    <div class="settings-card" style="padding:12px;margin-top:10px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${L.pages.map((p, i) => `<button type="button" class="te-page-btn" data-i="${i}" style="border:1px solid var(--border);border-radius:999px;padding:6px 14px;font-size:13px;cursor:pointer;background:${i === TE.page ? 'var(--accent)' : 'transparent'};color:${i === TE.page ? '#fff' : 'var(--text)'}">${escapeHtml(p.name)}</button>`).join('')}
        <button class="icon-btn" id="te-page-add" title="Add a page">＋</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn" id="te-page-rename" style="width:auto;margin:0;padding:6px 12px;background:var(--card);border:1px solid var(--border)">Rename page</button><button class="btn" id="te-page-copy" style="width:auto;margin:0;padding:6px 12px;background:var(--card);border:1px solid var(--border)">Copy page to…</button><button class="btn" id="te-tidy" style="width:auto;margin:0;padding:6px 12px;background:var(--card);border:1px solid var(--border)">Tidy up</button>${L.pages.length > 1 ? '<button class="btn" id="te-page-del" style="width:auto;margin:0;padding:6px 12px;background:var(--card);border:1px solid var(--border);color:#c0392b">Remove page</button>' : ''}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:10px">Drag a tile to move it. Drag its corner to resize it.</div>
      <div id="te-grid" aria-label="Tiles on this page" style="position:relative;margin-top:6px;width:100%;aspect-ratio:${(L.grid.cols * 1.25).toFixed(2)} / ${L.grid.rows};background-color:var(--bg);background-image:linear-gradient(to right,var(--border) 1px,transparent 1px),linear-gradient(to bottom,var(--border) 1px,transparent 1px);background-size:${(100 / L.grid.cols).toFixed(4)}% ${(100 / L.grid.rows).toFixed(4)}%;border:1px solid var(--border);border-radius:10px;touch-action:none;user-select:none">
        ${page.tiles.map((t) => teGridTile(t, L)).join('')}
      </div>
      <button class="btn btn-primary" id="te-tile-add" style="margin-top:12px">Add a tile</button>
    </div>`;
  const more = `
    ${tePhoneCard(page, L)}
    <div class="settings-card" style="padding:12px;margin-top:10px">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">Tiles on this page</div>
      <div id="te-tiles" style="display:flex;flex-direction:column;gap:8px">${page.tiles.map((t, i) => teTileRow(t, i, page.tiles.length)).join('') || '<p style="font-size:12px;color:var(--muted);margin:0">No tiles on this page yet.</p>'}</div>
    </div>
    <div class="settings-card" style="padding:12px;margin-top:10px">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">Look and idle screen</div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><label style="margin:0">Theme</label>
        <select class="form-input" id="te-mode" style="width:auto"><option value="dark" ${sel('dark', th.mode)}>Dark</option><option value="light" ${sel('light', th.mode)}>Light</option></select></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">Colors</label>
        <select class="form-input" id="te-palette" style="width:auto"><option value="" ${sel('', th.palette || '')}>Standard</option><option value="warm" ${sel('warm', th.palette)}>Warm</option><option value="forest" ${sel('forest', th.palette)}>Forest</option><option value="ocean" ${sel('ocean', th.palette)}>Ocean</option><option value="mono" ${sel('mono', th.palette)}>Black and white</option></select></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">Text size</label>
        <select class="form-input" id="te-text" style="width:auto"><option value="" ${sel('', th.text || '')}>Standard</option><option value="large" ${sel('large', th.text)}>Large</option><option value="xlarge" ${sel('xlarge', th.text)}>Extra large, for across the room</option></select></div>
      ${TM_LOOKS.map((l) => `<div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">${l.label}</label><select class="form-input" id="te-look-${l.key}" style="width:auto">${l.choices.map(([v, n]) => `<option value="${v}" ${(th[l.key] || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`).join('')}
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">Buzz on touch</label><input type="checkbox" id="te-haptics" ${th.haptics === false ? '' : 'checked'}></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">Click sound on touch</label><input type="checkbox" id="te-sound" ${th.sound ? 'checked' : ''}></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">Show how to edit when the page opens<small style="display:block;font-size:11px;color:var(--muted)">A tip about pressing and holding the clock, for a few seconds.</small></label><input type="checkbox" id="te-starthint" ${L.start_hint === false ? '' : 'checked'}></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0" for="te-confirmmode">Ask before a tile acts<small style="display:block;font-size:11px;color:var(--muted)">A touch by accident then asks "Do this now?" first. A tile can also ask on its own, in More options.</small></label><select class="form-input" id="te-confirmmode" style="width:auto;padding:4px 6px">${TM_CONFIRM_MODES.map(([v, l]) => `<option value="${v}" ${(L.confirm_mode || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">Swipe sideways to change page<small style="display:block;font-size:11px;color:var(--muted)">On a tablet with more than one page.</small></label><input type="checkbox" id="te-swipe" ${L.swipe === false ? '' : 'checked'}></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">Ask for the PIN before changing the layout on the tablet<small style="display:block;font-size:11px;color:var(--muted)">Only when this household has a PIN set.</small></label><input type="checkbox" id="te-editpin" ${L.edit_pin === false ? '' : 'checked'}></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">When idle</label>
        <select class="form-input" id="te-idle" style="width:auto"><option value="photos" ${L.idle.mode === 'photos' ? 'selected' : ''}>Show photos and the clock</option><option value="clock" ${L.idle.mode === 'clock' ? 'selected' : ''}>Show the clock</option><option value="off" ${L.idle.mode === 'off' ? 'selected' : ''}>Stay on the tiles</option></select></div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">Go idle after</label>
        <select class="form-input" id="te-mins" style="width:auto">${tmIdleOptions(L.idle.minutes).map(([m, l]) => `<option value="${m}" ${L.idle.minutes === m ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${tePhotoRows(L)}
    </div>
    <div class="settings-card" style="padding:12px;margin-top:10px">
      <div style="font-weight:600;font-size:13px">Time of day</div>
      <div style="font-size:12px;color:var(--muted);margin:2px 0 8px">For example: dim the screen and show the clock after 9pm, or open the Kitchen page at 6am.</div>
      <div id="te-rules" style="display:flex;flex-direction:column;gap:8px">${L.rules.map((r, i) => teRuleRow(r, i, L)).join('')}</div>
      <button class="btn" id="te-rule-add" style="margin-top:8px;width:auto;padding:6px 12px;background:var(--card);border:1px solid var(--border)" ${L.rules.length >= 8 ? 'disabled' : ''}>Add a rule</button>
    </div>
    <details class="settings-card" id="te-tips" style="padding:12px;margin-top:10px"><summary style="font-weight:600;font-size:13px;cursor:pointer">Tips for the tablet</summary>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:8px">
        <p style="margin:0 0 8px"><b>iPad:</b> open the address in Safari, tap Share, then Add to Home Screen. To keep it awake, set Settings, Display &amp; Brightness, Auto-Lock to Never and keep it plugged in. To stop anyone leaving the page, turn on Guided Access in Settings, Accessibility.</p>
        <p style="margin:0 0 8px"><b>Android:</b> open the address in Chrome, then Add to Home screen. To keep it awake, set the screen timeout to the longest setting or turn on Stay awake while charging. For a full-screen kiosk, Fully Kiosk Browser works well.</p>
        <p style="margin:0">An address that starts with http can not keep the screen awake by itself, so the tablet's own setting does that. Tailscale or the remote access address (https) lets the page do it.</p>
      </div></details>`;
  box.innerHTML = top; rest.innerHTML = more;
  if (scroller) scroller.scrollTop = kept;
  teWire();
  teFillCardOptions();
  tePreviewPost();
  if (scroller) { scroller.scrollTop = kept; requestAnimationFrame(() => { scroller.scrollTop = kept; }); }
}

// The idle-photo choices (which photos, how long each stays, the order, the fit, skipping small ones). They apply when the tablet goes idle to photos.
function tePhotoRows(L) {
  const o = tmPhotoOpts(L.idle), row = (label, ctl) => `<div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px"><label style="margin:0">${label}</label>${ctl}</div>`;
  const sel = (id, opts, cur) => `<select class="form-input" id="${id}" style="width:auto">${opts.map(([v, l]) => `<option value="${escapeHtml(String(v))}" ${String(v) === String(cur) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
  const secs = [...new Set([...TM_PHOTO_SECONDS, o.seconds])].sort((a, b) => a - b).map((n) => [n, n < 60 ? n + ' seconds' : (n / 60) + (n === 60 ? ' minute' : ' minutes')]);
  return row('Photos from', sel('te-ptag', [['', 'All the slideshow photos'], ...(o.tag ? [[o.tag, 'Tagged ' + o.tag]] : [])], o.tag))
    + row('Change photo every', sel('te-psec', secs, o.seconds))
    + row('Photo order', sel('te-porder', TM_PHOTO_ORDERS, o.order))
    + row('Fit to the screen', sel('te-pfit', TM_PHOTO_FITS, o.fit))
    + row('Skip small photos that would look blurry', `<input type="checkbox" id="te-pskip" ${o.skip_small ? 'checked' : ''}>`);
}
async function teFillPhotoTags() {
  const box = $('te-ptag'); if (!box) return;
  if (!window._tePhotoTags) window._tePhotoTags = tmPhotoTags(await apiFetch('/api/photos').catch(() => []));
  const cur = tmPhotoOpts(TE.layout.idle).tag;
  if (!box.isConnected) return;
  box.innerHTML = [['', 'All the slideshow photos'], ...[...new Set([...window._tePhotoTags, ...(cur ? [cur] : [])])].map((t) => [t, 'Tagged ' + t])].map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === cur ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
}

function teGridTile(t, L) {
  const col = teHex(t.color_on) || '#33456b', ink = teInk(col), p = (n, of) => (n / of * 100).toFixed(3) + '%';
  return `<div class="te-gt${TE.sel === t.id ? ' sel' : ''}" data-id="${escapeHtml(t.id)}" style="position:absolute;left:${p(t.x, L.grid.cols)};top:${p(t.y, L.grid.rows)};width:${p(t.w, L.grid.cols)};height:${p(t.h, L.grid.rows)};padding:2px;box-sizing:border-box;touch-action:none;cursor:grab">
    <div style="position:relative;width:100%;height:100%;box-sizing:border-box;background:${col};color:${ink};border-radius:8px;border:2px solid ${TE.sel === t.id ? 'var(--text)' : 'transparent'};padding:3px 5px;overflow:hidden;font-size:11px;line-height:1.15">
      <div style="width:16px;height:16px">${tbSvg(t.icon || teDefaultIcon(t))}</div><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(teTileName(t))}</div>
      <span class="te-grip" title="Resize" style="position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,${ink} 50%);opacity:.7;border-bottom-right-radius:6px"></span></div></div>`;
}
function teInk(hex) { const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150 ? '#0b1220' : '#ffffff'; }

function teRuleRow(r, i, L) {
  return `<div class="te-rule" data-i="${i}" style="border:1px solid var(--border);border-radius:12px;padding:10px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:12px">From</span><input type="time" class="form-input te-r-from" value="${r.from}" style="width:auto;padding:6px"><span style="font-size:12px">to</span><input type="time" class="form-input te-r-to" value="${r.to}" style="width:auto;padding:6px">
      <button class="icon-btn del te-r-rm" title="Remove this rule" style="margin-left:auto;width:30px;height:30px">🗑️</button></div>
    <div style="display:flex;gap:4px;margin-top:8px" role="group" aria-label="Days">${TE_DAYS.map((d, n) => `<button type="button" class="te-r-day" data-d="${n}" aria-pressed="${r.days.includes(n)}" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--border);cursor:pointer;background:${r.days.includes(n) ? 'var(--accent)' : 'transparent'};color:${r.days.includes(n) ? '#fff' : 'var(--text)'}">${d}</button>`).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <label style="font-size:12px">Dim the screen<select class="form-input te-r-dim" style="margin-top:2px">${[[0, 'Not at all'], [25, 'A little'], [50, 'Quite a lot'], [75, 'Very dark']].map(([v, l]) => `<option value="${v}" ${(r.dim || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label style="font-size:12px">Show<select class="form-input te-r-screen" style="margin-top:2px"><option value="" ${!r.screen ? 'selected' : ''}>The tiles</option><option value="clock" ${r.screen === 'clock' ? 'selected' : ''}>The clock</option><option value="photos" ${r.screen === 'photos' ? 'selected' : ''}>Photos and the clock</option></select></label>
      <label style="font-size:12px">Open the page<select class="form-input te-r-page" style="margin-top:2px"><option value="">Do not change</option>${L.pages.map((p) => `<option value="${escapeHtml(p.id)}" ${r.page === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>
    </div></div>`;
}

// The phone layout of a page: a small picture of how the tiles sit on a narrow phone, and a list in phone order where each tile has its width, its height, Earlier / Later, and can be hidden.
const TE_PMOCK_CSS = 'overflow:hidden;font-size:10px;line-height:1.1;border-radius:4px;border:1px solid var(--border);background:var(--card);padding:2px 4px;white-space:nowrap;text-overflow:ellipsis;box-sizing:border-box';
function tePhoneCard(page, L) {
  const list = tmPhoneList(page), small = !!L.phone_small, shown = list.filter((t) => t.phone !== 'hide'), hidden = list.filter((t) => t.phone === 'hide');
  const box = (t) => tmPhoneBox(t, small, 6);
  const mock = shown.map((t) => { const b = box(t); return `<div class="te-pmock-tile" style="${TE_PMOCK_CSS};grid-column:span ${b.span};grid-row:span ${b.rows || 4};${b.compact ? 'padding:3px 6px;' : ''}">${escapeHtml(teTileName(t))}</div>`; }).join('');
  return `<div class="settings-card" id="te-phone-card" style="padding:12px;margin-top:10px">
    <div style="font-weight:600;font-size:13px">How this page looks on a phone</div>
    <div style="font-size:11px;color:var(--muted);margin:2px 0 8px">Tiles go one after another. Choose how wide and how high each one is, move it, or hide it. The tablet is not changed.</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="width:100%;max-width:260px;flex-shrink:0"><div id="te-pmock" aria-label="Picture of the page on a narrow phone" style="display:grid;grid-template-columns:repeat(12,1fr);grid-auto-rows:14px;gap:4px;padding:8px;border:2px solid var(--border);border-radius:14px;background:var(--bg)">${mock || '<div style="grid-column:span 12;font-size:10px;color:var(--muted)">No tiles</div>'}</div>
        ${hidden.length ? `<div style="font-size:10px;color:var(--muted);margin-top:4px">Hidden: ${hidden.map((t) => escapeHtml(teTileName(t))).join(', ')}</div>` : ''}</div>
      <div style="flex:1;min-width:230px;display:flex;flex-direction:column;gap:6px">
        <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;margin:0">Smaller tiles on phones<input type="checkbox" id="te-phonesmall" ${L.phone_small ? 'checked' : ''}></label>
        <div style="font-size:11px;color:var(--muted)">Simple tiles are a third of a row wide and one line high. A tile below can choose its own size.</div>
        ${list.map((t) => tePhoneRow(t, list)).join('') || ''}
      </div>
    </div></div>`;
}
function tePhoneRow(t, list) {
  const k = list.findIndex((x) => x.id === t.id);
  const btn = (cls, label, off) => `<button type="button" class="btn ${cls}" ${off ? 'disabled' : ''} style="width:auto;margin:0;padding:4px 10px;background:var(--card);color:var(--text);border:1px solid var(--border)">${label}</button>`;
  return `<div class="te-prow" data-id="${escapeHtml(t.id)}" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:6px;font-size:12px"><div style="flex:1 0 100%;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(teTileName(t))}</div><label>Width <select class="form-input te-phone" style="display:inline-block;width:auto;padding:4px 6px">${TM_PHONE_SIZES.map(([v, l]) => `<option value="${v}" ${(t.phone || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Height <select class="form-input te-phone-h" style="display:inline-block;width:auto;padding:4px 6px">${TM_PHONE_HEIGHTS.map(([v, l]) => `<option value="${v}" ${(t.phone_h || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${btn('te-pup', '▲ Earlier', k <= 0)}${btn('te-pdown', '▼ Later', k < 0 || k >= list.length - 1)}<span style="color:var(--muted)">${k + 1} of ${list.length}</span></div>`;
}
function teTileRow(t, i, n) {
  const size = teSizeOf(t), name = t.label ? t.label : teTileName(t), dom = t.kind === 'ha' ? t.ref.split('.')[0] : '';
  const sub = t.kind === 'ha' ? t.ref : t.kind === 'routine' ? 'Actions' : t.kind === 'group' ? `${(t.members || []).length} devices` : t.kind === 'camera' ? 'Camera' : 'Piazza HQ';
  const iconKey = t.icon || teDefaultIcon(t), onHex = teHex(t.color_on), offHex = teHex(t.color_off);
  const tapOpts = tmTapOptions(t);
  return `<div class="te-row" data-i="${i}" data-id="${escapeHtml(t.id)}" style="border:1px solid ${TE.sel === t.id ? 'var(--accent)' : 'var(--border)'};border-radius:12px;padding:10px">
    <div style="display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(name)}</div><div style="font-size:11px;color:var(--muted)">${escapeHtml(sub)}</div></div>
      <button class="icon-btn te-label" title="Rename" style="width:30px;height:30px">✏️</button><button class="icon-btn te-up" ${i === 0 ? 'disabled' : ''} title="Move up" style="width:30px;height:30px">▲</button><button class="icon-btn te-down" ${i === n - 1 ? 'disabled' : ''} title="Move down" style="width:30px;height:30px">▼</button><button class="icon-btn del te-rm" title="Remove" style="width:30px;height:30px">🗑️</button></div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
      <select class="form-input te-size" style="width:auto;padding:6px 8px;font-size:13px">${Object.entries(TE_SIZES).map(([k, v]) => `<option value="${k}" ${size === k ? 'selected' : ''}>${v[2]}</option>`).join('')}${size === 'custom' ? `<option value="custom" selected>${t.w}×${t.h}</option>` : ''}</select>
      <div style="display:flex;gap:4px;align-items:center" role="group" aria-label="${tbIsStateless(t) ? 'Color' : 'Color when on'}">
        <button type="button" class="te-color" data-c="" title="Default color" aria-label="Default color" style="width:24px;height:24px;border-radius:50%;border:2px solid ${!t.color_on ? 'var(--text)' : 'var(--border)'};background:transparent;font-size:11px;cursor:pointer">A</button>
        ${Object.entries(TE_COLORS).map(([k, hex]) => `<button type="button" class="te-color" data-c="${k}" title="${k}" aria-label="${k}" style="width:24px;height:24px;border-radius:50%;border:2px solid ${t.color_on === k ? 'var(--text)' : 'transparent'};background:${hex};cursor:pointer"></button>`).join('')}</div>
      ${t.kind === 'card' && TM_CARD_OPENABLE.includes(t.ref) ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" class="te-pin" ${t.needs_pin ? 'checked' : ''}> Needs the PIN</label>` : ''}
      ${t.kind === 'ha' ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" class="te-pin" ${t.needs_pin || t.ref.startsWith('lock.') ? 'checked' : ''} ${t.ref.startsWith('lock.') ? 'disabled' : ''}> Needs the PIN</label>` : t.kind === 'group' || t.kind === 'routine' ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" class="te-pin" ${t.needs_pin ? 'checked' : ''}> Needs the PIN</label>` : ''}
    </div>
    <details class="te-more" style="margin-top:8px" ${TE.open.has(t.id) ? 'open' : ''}><summary style="font-size:12px;color:var(--muted);cursor:pointer">More options</summary>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;font-size:12px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn te-icon" style="width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border);display:flex;align-items:center;gap:6px"><span style="width:20px;height:20px;display:inline-block">${tbSvg(iconKey)}</span>Change icon</button>
          <label style="display:flex;align-items:center;gap:6px">${tbIsStateless(t) ? 'Color' : 'Color when on'} <input type="color" class="te-hex-on" value="${onHex || '#ffc857'}" style="width:34px;height:28px;padding:0;border:0;background:none"></label>
          ${tbIsStateless(t) ? '' : `<label style="display:flex;align-items:center;gap:6px">Color when off <input type="color" class="te-hex-off" value="${offHex || '#172033'}" style="width:34px;height:28px;padding:0;border:0;background:none"></label>
          ${t.color_off ? '<button type="button" class="btn te-off-clear" style="width:auto;margin:0;padding:4px 8px;background:var(--card);border:1px solid var(--border)">Clear off color</button>' : ''}`}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label>Text <select class="form-input te-text-size" style="display:inline-block;width:auto;padding:4px 6px"><option value="small" ${t.text_size === 'small' ? 'selected' : ''}>Small</option><option value="normal" ${t.text_size === 'normal' ? 'selected' : ''}>Normal</option><option value="large" ${t.text_size === 'large' ? 'selected' : ''}>Large</option></select></label>
          <label>When tapped <select class="form-input te-tap" style="display:inline-block;width:auto;padding:4px 6px">${tapOpts.map(([v, l]) => `<option value="${v}" ${(t.tap || 'toggle') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        ${t.kind === 'group' ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label>What it does <select class="form-input te-gmode" style="display:inline-block;width:auto;padding:4px 6px"><option value="toggle" ${t.group_mode === 'toggle' ? 'selected' : ''}>Switch them all together</option><option value="all_on" ${t.group_mode === 'all_on' ? 'selected' : ''}>Turn them all on</option><option value="all_off" ${t.group_mode === 'all_off' ? 'selected' : ''}>Turn them all off</option></select></label><button type="button" class="btn te-gpick" style="width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border)">Choose devices</button></div>` : ''}
        ${tmCanSwitchWith(t) ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn te-swith" style="width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border)">Switch it with\u2026</button><span style="color:var(--muted);font-size:12px">Another scene, or turn something on or off. Each tap does the next one.</span></div>` : ''}
        ${t.kind === 'routine' ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span>${tmRoutineLists(t.routine).map((l) => (l.title ? escapeHtml(l.title) + ': ' : '') + l.steps.length + (l.steps.length === 1 ? ' action' : ' actions')).join(' · ')}</span><button type="button" class="btn te-rpick" style="width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border)">Edit actions</button></div>` : ''}
        ${t.kind === 'ha' && dom === 'remote' ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="te-rinline" ${(t.remote || {}).inline ? 'checked' : ''}> Show the buttons on the tile (give it about 3 wide and 4 high)</label><select class="form-input te-rpreset" style="width:auto;padding:4px 6px" aria-label="Kind of remote">${TM_REMOTE_PRESET_LIST.map(([v, l]) => `<option value="${v}" ${((t.remote || {}).preset || 'custom') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="form-input te-rdev" maxlength="60" placeholder="Device name, for example amplifier" value="${escapeHtml((t.remote || {}).device || '')}" aria-label="Device name" style="width:auto;min-width:0;padding:4px 6px"><button type="button" class="btn te-rkeys" style="width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border)">Choose commands</button><button type="button" class="btn te-rarrange" style="width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border)">Arrange buttons</button></div>` : ''}
        ${t.kind === 'camera' ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select class="form-input te-camfit" style="width:auto;padding:4px 6px" aria-label="Picture"><option value="">Fill the tile (may crop)</option><option value="contain" ${t.fit === 'contain' ? 'selected' : ''}>Show the whole picture</option></select></div>` : ''}
        ${t.kind === 'camera' ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="te-live" ${t.live ? 'checked' : ''}> Play live video on the tile</label><span style="color:var(--muted);font-size:12px">Up to four at a time; it stops when the tablet goes idle.</span></div>` : ''}
        ${teIsSensor(t) ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          ${dom === 'sensor' ? `<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="te-spark" ${t.spark ? 'checked' : ''}> Show a trend line</label><select class="form-input te-spark-h" style="width:auto;padding:4px 6px">${[1, 6, 12, 24, 48, 72].map((h) => `<option value="${h}" ${(t.spark_hours || 24) === h ? 'selected' : ''}>${h} ${h === 1 ? 'hour' : 'hours'}</option>`).join('')}</select>` : ''}
          ${dom === 'sensor' || dom === 'climate' ? `<label>Turn red above <input type="number" class="form-input te-above" value="${t.alert_above != null ? t.alert_above : ''}" style="display:inline-block;width:80px;padding:4px 6px"></label><label>or below <input type="number" class="form-input te-below" value="${t.alert_below != null ? t.alert_below : ''}" style="display:inline-block;width:80px;padding:4px 6px"></label>` : ''}
          ${dom === 'binary_sensor' ? `<label>Turn red when it reads <select class="form-input te-astate" style="display:inline-block;width:auto;padding:4px 6px"><option value="" ${!t.alert_state ? 'selected' : ''}>Never</option><option value="on" ${t.alert_state === 'on' ? 'selected' : ''}>On</option><option value="off" ${t.alert_state === 'off' ? 'selected' : ''}>Off</option></select></label>` : ''}</div>` : ''}
        ${t.kind === 'card' && tmCardOptions(t.ref).length ? `<div class="te-card-opts" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${tmCardOptions(t.ref).map((o) => { const cur = String((t.card_config || {})[o.key] || ''), opts = o.type === 'choice' ? o.choices : [[cur, cur ? '…' : (o.type === 'kid' ? 'Everyone' : o.type === 'screen' ? 'The first one' : 'All lists')]]; if (o.type === 'text' || o.type === 'date') return `<label>${o.label} <input class="form-input te-co" ${o.type === 'date' ? 'type="date"' : 'maxlength="60"'} data-co="${o.key}" data-type="${o.type}" value="${escapeHtml(cur)}" style="display:inline-block;width:auto;padding:4px 6px"></label>`;
      return `<label>${o.label} <select class="form-input te-co" data-co="${o.key}" data-type="${o.type}" style="display:inline-block;width:auto;padding:4px 6px">${opts.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === cur ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>`; }).join('')}</div>` : ''}
        ${tmCanConfirm(t) ? `<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="te-confirm" ${t.confirm ? 'checked' : ''}> Ask "Do this now?" before it acts</label>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn te-dup" style="width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border)">Duplicate</button><button type="button" class="btn te-copyto" style="width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border)">Copy to…</button></div>
      </div></details></div>`;
}

// ── wiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
function teWire() {
  const L = TE.layout, page = L.pages[TE.page];
  const change = async () => { teDraw(); await teSave(true); };
  $('te-pick').addEventListener('change', (e) => { TE.id = e.target.value; TE.page = 0; TE.sel = ''; try { localStorage.setItem('phq_edit_tablet', TE.id); } catch { /* ignore */ } renderLayoutTabletSubTab(); });
  $('te-add').addEventListener('click', teAddTablet);
  $('te-rename').addEventListener('click', async () => {
    const name = (prompt('Tablet name', TE.tablet.name) || '').trim(); if (!name) return;
    const r = await apiFetch('/api/tablets/' + encodeURIComponent(TE.id), { method: 'PUT', body: JSON.stringify({ name }) });
    if (r && r.id) renderLayoutTabletSubTab(); else showToast('❌ Could not rename');
  });
  $('te-del').addEventListener('click', async () => {
    if (!confirm(`Remove "${TE.tablet.name}" and its layout? The tablet will ask which tablet it is again.`)) return;
    const r = await apiFetch('/api/tablets/' + encodeURIComponent(TE.id), { method: 'DELETE' });
    if (r && r.ok) { TE.id = ''; TE.page = 0; renderLayoutTabletSubTab(); } else showToast('❌ Could not remove');
  });
  const qr = $('te-qr'), addr = `${TE.base}${TE.path}?t=${encodeURIComponent(TE.id)}`;
  (function draw() { if (typeof QRCode === 'undefined') { setTimeout(draw, 200); return; } qr.innerHTML = ''; try { new QRCode(qr, { text: addr, width: 100, height: 100, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); } catch { /* no QR */ } })();
  $('te-copy').addEventListener('click', () => copyToClipboard(addr));
  document.querySelectorAll('.te-dev').forEach((b) => b.addEventListener('click', () => { TE.path = b.dataset.p; teDraw(); }));
  document.querySelectorAll('.te-addr').forEach((b) => b.addEventListener('click', () => { TE.base = b.dataset.b === 'tail' ? TE.tail : TE.lan; teDraw(); }));

  document.querySelectorAll('.te-page-btn').forEach((b) => b.addEventListener('click', () => { TE.page = Number(b.dataset.i); TE.sel = ''; teDraw(); }));
  $('te-page-add').addEventListener('click', async () => {
    if (L.pages.length >= 12) { showToast('That is the most pages a tablet can have.'); return; }
    const name = (prompt('Page name, for example Kitchen') || '').trim(); if (!name) return;
    L.pages.push({ id: 'p' + Date.now().toString(36), name, tiles: [] }); TE.page = L.pages.length - 1; await change();
  });
  $('te-page-rename').addEventListener('click', async () => { const name = (prompt('Page name', page.name) || '').trim(); if (!name) return; page.name = name; await change(); });
  $('te-page-copy').addEventListener('click', () => teCopyTo({ page: JSON.parse(JSON.stringify(page)) }));
  $('te-tidy').addEventListener('click', async () => { tePack(page, L.grid.cols, L.grid.rows); await change(); });
  const del = $('te-page-del');
  if (del) del.addEventListener('click', async () => { if (!confirm(`Remove the page "${page.name}" and its tiles?`)) return; L.pages.splice(TE.page, 1); L.rules.forEach((r) => { if (r.page === page.id) r.page = ''; }); TE.page = 0; await change(); });

  // the phone layout card: a tile's width and height there, Earlier / Later, and the switch for smaller tiles
  document.querySelectorAll('.te-prow').forEach((row) => {
    const t = page.tiles.find((x) => x.id === row.dataset.id); if (!t) return;
    row.querySelector('.te-phone').addEventListener('change', async (e) => { if (e.target.value) t.phone = e.target.value; else delete t.phone; await change(); });
    row.querySelector('.te-phone-h').addEventListener('change', async (e) => { if (e.target.value) t.phone_h = e.target.value; else delete t.phone_h; await change(); });
    row.querySelector('.te-pup').addEventListener('click', async () => { if (tmPhoneMove(page, t.id, -1)) await change(); });
    row.querySelector('.te-pdown').addEventListener('click', async () => { if (tmPhoneMove(page, t.id, 1)) await change(); });
  });
  teDragWire(page, change);
  document.querySelectorAll('.te-row').forEach((row) => {
    const i = Number(row.dataset.i), t = page.tiles[i];
    const swap = async (j) => { const o = page.tiles[j]; [t.x, o.x] = [o.x, t.x]; [t.y, o.y] = [o.y, t.y]; page.tiles[i] = o; page.tiles[j] = t; await change(); };
    const more = row.querySelector('.te-more'); more.addEventListener('toggle', () => { if (more.open) TE.open.add(t.id); else TE.open.delete(t.id); });
    row.querySelector('.te-label').addEventListener('click', async () => { const v = prompt('Name on the tile (leave empty for the default)', t.label || ''); if (v === null) return; t.label = v.trim().slice(0, 40); await change(); });
    row.querySelector('.te-up').addEventListener('click', () => swap(i - 1));
    row.querySelector('.te-down').addEventListener('click', () => swap(i + 1));
    row.querySelector('.te-rm').addEventListener('click', async () => { page.tiles.splice(i, 1); await change(); });
    row.querySelector('.te-size').addEventListener('change', async (e) => {
      const s = TE_SIZES[e.target.value]; if (!s) return;
      const ok = teTry(page, L.grid.cols, L.grid.rows, () => { t.w = s[0]; t.h = s[1]; });
      if (!ok) { showToast('That does not fit on this page. Add another page.'); teDraw(); return; }
      await change();
    });
    row.querySelectorAll('.te-color').forEach((b) => b.addEventListener('click', async () => { t.color_on = b.dataset.c; await change(); }));
    row.querySelectorAll('.te-co').forEach((sel) => sel.addEventListener('change', async () => {
      const cfg = { ...(t.card_config || {}) }, key = sel.dataset.co;
      if (sel.value.trim() === '') delete cfg[key]; else cfg[key] = ['shopping_list', 'todo_list', 'kid'].includes(sel.dataset.type) ? Number(sel.value) : sel.value.trim();
      t.card_config = cfg; await change();
    }));
    const cf2 = row.querySelector('.te-confirm'); if (cf2) cf2.addEventListener('change', async () => { if (cf2.checked) t.confirm = true; else delete t.confirm; await change(); });
    const pin = row.querySelector('.te-pin'); if (pin) pin.addEventListener('change', async () => { if (!pin.checked && t.kind === 'routine' && tmHasUnlock(t)) { showToast('Remove the unlock actions before turning the PIN off.'); pin.checked = true; return; } t.needs_pin = pin.checked; await change(); });
    row.querySelector('.te-icon').addEventListener('click', () => teIconPicker(t, change));
    row.querySelector('.te-hex-on').addEventListener('change', async (e) => { t.color_on = e.target.value; await change(); });
    const hexOff = row.querySelector('.te-hex-off'); if (hexOff) hexOff.addEventListener('change', async (e) => { t.color_off = e.target.value; await change(); });
    const offClr = row.querySelector('.te-off-clear'); if (offClr) offClr.addEventListener('click', async () => { t.color_off = ''; await change(); });
    row.querySelector('.te-text-size').addEventListener('change', async (e) => { t.text_size = e.target.value; await change(); });
    row.querySelector('.te-tap').addEventListener('change', async (e) => { t.tap = e.target.value; await change(); });
    const gm = row.querySelector('.te-gmode'); if (gm) gm.addEventListener('change', async (e) => { t.group_mode = e.target.value; await change(); });
    const sw = row.querySelector('.te-swith'); if (sw) sw.addEventListener('click', () => teSwitchWith(t, change));
    const rp = row.querySelector('.te-rpick'); if (rp) rp.addEventListener('click', () => teRoutineEditor(t, change));
    const gp = row.querySelector('.te-gpick'); if (gp) gp.addEventListener('click', () => teGroupPicker(t, change));
    const rinl = row.querySelector('.te-rinline'); if (rinl) rinl.addEventListener('change', async () => { const r = { ...(t.remote || { preset: 'custom' }) }; if (rinl.checked) r.inline = true; else delete r.inline; t.remote = r; await change(); });
    const rpre = row.querySelector('.te-rpreset'); if (rpre) rpre.addEventListener('change', async () => { t.remote = { ...(t.remote || {}), preset: rpre.value }; await change(); });
    const rdev = row.querySelector('.te-rdev'); if (rdev) rdev.addEventListener('change', async () => { const r = { ...(t.remote || { preset: 'custom' }) }; if (rdev.value.trim()) r.device = rdev.value.trim(); else delete r.device; t.remote = r; await change(); });
    const rarr = row.querySelector('.te-rarrange'); if (rarr) rarr.addEventListener('click', async () => { await teRemoteArrange(t); await change(); });
    const rkeys = row.querySelector('.te-rkeys'); if (rkeys) rkeys.addEventListener('click', async () => { await teRemoteKeys(t); await change(); });
    const cf = row.querySelector('.te-camfit'); if (cf) cf.addEventListener('change', async () => { if (cf.value === 'contain') t.fit = 'contain'; else delete t.fit; await change(); });
    const lv = row.querySelector('.te-live'); if (lv) lv.addEventListener('change', async () => { if (lv.checked) t.live = true; else delete t.live; await change(); });
    const sp = row.querySelector('.te-spark'); if (sp) sp.addEventListener('change', async () => { if (sp.checked) { t.spark = true; t.spark_hours = Number(row.querySelector('.te-spark-h').value) || 24; } else { delete t.spark; delete t.spark_hours; } await change(); });
    const sh = row.querySelector('.te-spark-h'); if (sh) sh.addEventListener('change', async () => { if (t.spark) { t.spark_hours = Number(sh.value) || 24; await change(); } });
    // a number typed here is saved without redrawing the editor, so moving on to the next box keeps what was typed there
    const numField = (cls, key) => { const el = row.querySelector(cls); if (el) el.addEventListener('change', async () => { if (el.value === '') delete t[key]; else t[key] = Number(el.value); await teSave(true); }); };
    numField('.te-above', 'alert_above'); numField('.te-below', 'alert_below');
    const as = row.querySelector('.te-astate'); if (as) as.addEventListener('change', async () => { if (as.value) t.alert_state = as.value; else delete t.alert_state; await change(); });
    row.querySelector('.te-dup').addEventListener('click', async () => {
      const c = JSON.parse(JSON.stringify(t)); c.id = teId(); page.tiles.splice(i + 1, 0, c);
      if (!teFit(page, L.grid.cols, L.grid.rows)) { page.tiles.splice(i + 1, 1); showToast('That page is full. Add another page.'); teDraw(); return; }
      TE.sel = c.id; await change();
    });
    row.querySelector('.te-copyto').addEventListener('click', () => teCopyTo({ tile: JSON.parse(JSON.stringify(t)) }));
    row.addEventListener('click', (e) => { if (e.target.closest('button,input,select,label,summary')) return; TE.sel = t.id; teDraw(); });
  });
  $('te-tile-add').addEventListener('click', teAddTile);

  const theme = (key, fn) => $(key).addEventListener('change', async (e) => { fn(e.target); await teSave(); });
  theme('te-mode', (el) => { L.theme.mode = el.value; });
  theme('te-palette', (el) => { if (el.value) L.theme.palette = el.value; else delete L.theme.palette; });
  theme('te-text', (el) => { if (el.value) L.theme.text = el.value; else delete L.theme.text; });
  TM_LOOKS.forEach((l) => theme('te-look-' + l.key, (el) => { if (el.value) L.theme[l.key] = el.value; else delete L.theme[l.key]; }));
  theme('te-haptics', (el) => { if (el.checked) delete L.theme.haptics; else L.theme.haptics = false; });
  theme('te-sound', (el) => { if (el.checked) L.theme.sound = true; else delete L.theme.sound; });
  $('te-starthint').addEventListener('change', async (ev) => { if (ev.target.checked) delete L.start_hint; else L.start_hint = false; await teSave(); });
  $('te-phonesmall').addEventListener('change', async (ev) => { if (ev.target.checked) L.phone_small = true; else delete L.phone_small; await teSave(); });
  $('te-confirmmode').addEventListener('change', async (ev) => { if (ev.target.value) L.confirm_mode = ev.target.value; else delete L.confirm_mode; await teSave(); });
  $('te-swipe').addEventListener('change', async (ev) => { if (ev.target.checked) delete L.swipe; else L.swipe = false; await teSave(); });
  $('te-editpin').addEventListener('change', async (ev) => { if (ev.target.checked) delete L.edit_pin; else L.edit_pin = false; await teSave(); });
  theme('te-idle', (el) => { L.idle.mode = el.value; });
  theme('te-mins', (el) => { L.idle.minutes = Number(el.value); });
  [['te-ptag', 'tag'], ['te-psec', 'seconds'], ['te-porder', 'order'], ['te-pfit', 'fit']].forEach(([id, key]) => { if ($(id)) theme(id, (el) => { tmSetPhotoOpt(L.idle, key, el.value); }); });
  if ($('te-pskip')) theme('te-pskip', (el) => { tmSetPhotoOpt(L.idle, 'skip_small', el.checked); });
  teFillPhotoTags();

  $('te-rule-add').addEventListener('click', async () => { if (L.rules.length >= 8) return; L.rules.push({ id: 'r' + Date.now().toString(36), from: '21:00', to: '06:00', days: [0, 1, 2, 3, 4, 5, 6], dim: 50, screen: '', page: '' }); await change(); });
  document.querySelectorAll('.te-rule').forEach((row) => {
    const r = L.rules[Number(row.dataset.i)];
    row.querySelector('.te-r-from').addEventListener('change', async (e) => { if (e.target.value) { r.from = e.target.value; await teSave(); } });
    row.querySelector('.te-r-to').addEventListener('change', async (e) => { if (e.target.value) { r.to = e.target.value; await teSave(); } });
    row.querySelector('.te-r-dim').addEventListener('change', async (e) => { r.dim = Number(e.target.value); await teSave(); });
    row.querySelector('.te-r-screen').addEventListener('change', async (e) => { r.screen = e.target.value; await teSave(); });
    row.querySelector('.te-r-page').addEventListener('change', async (e) => { r.page = e.target.value; await teSave(); });
    row.querySelectorAll('.te-r-day').forEach((b) => b.addEventListener('click', async () => {
      const d = Number(b.dataset.d), on = r.days.includes(d);
      if (on && r.days.length === 1) return;                         // a rule needs at least one day
      r.days = on ? r.days.filter((x) => x !== d) : [...r.days, d].sort(); await change();
    }));
    row.querySelector('.te-r-rm').addEventListener('click', async () => { L.rules.splice(Number(row.dataset.i), 1); await change(); });
  });
}

// Drag a tile to move it, drag its corner to resize it. A move that would land on another tile or off the grid snaps back.
function teDragWire(page, change) {
  const grid = $('te-grid'); if (!grid) return;
  const L = TE.layout, cols = L.grid.cols, rows = L.grid.rows;
  grid.querySelectorAll('.te-gt').forEach((el) => {
    const t = page.tiles.find((x) => x.id === el.dataset.id); if (!t) return;
    el.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault();
      const resizing = !!e.target.closest('.te-grip'), rect = grid.getBoundingClientRect(), cw = rect.width / cols, ch = rect.height / rows;
      const start = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, tw: t.w, th: t.h }; let cur = { x: t.x, y: t.y, w: t.w, h: t.h, ok: true }, moved = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
      el.style.zIndex = 5; el.style.cursor = 'grabbing';
      const others = page.tiles.filter((o) => o !== t);
      const paint = () => {
        el.style.left = (cur.x / cols * 100) + '%'; el.style.top = (cur.y / rows * 100) + '%'; el.style.width = (cur.w / cols * 100) + '%'; el.style.height = (cur.h / rows * 100) + '%';
        el.style.opacity = cur.ok ? '1' : '.55'; el.style.outline = cur.ok ? '' : '2px solid #f0765a';
      };
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (resizing) { cur.w = Math.max(1, Math.min(cols - t.x, Math.round(start.tw + dx / cw))); cur.h = Math.max(1, Math.min(rows - t.y, Math.round(start.th + dy / ch))); }
        else { cur.x = Math.max(0, Math.min(cols - t.w, Math.round(start.tx + dx / cw))); cur.y = Math.max(0, Math.min(rows - t.h, Math.round(start.ty + dy / ch))); }
        cur.ok = !others.some((o) => teOverlap(o, cur));
        paint();
      };
      const up = async () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (moved && cur.ok && (cur.x !== start.tx || cur.y !== start.ty || cur.w !== start.tw || cur.h !== start.th)) { t.x = cur.x; t.y = cur.y; t.w = cur.w; t.h = cur.h; TE.sel = t.id; await change(); }
        else { if (!moved) TE.sel = t.id; teDraw(); if (!moved) { const row = document.querySelector(`.te-row[data-id="${t.id}"]`); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' }); } }
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  });
}

async function teAddTablet() {
  const name = (prompt('Name this tablet or phone, for example Kitchen tablet or Dad\'s phone') || '').trim(); if (!name) return;
  const from = TE.tablet && TE.tablets.length && confirm(`Start with a copy of the tiles on "${TE.tablet.name}"? (OK copies them, Cancel starts empty.)`) ? TE.id : '';
  const r = await apiFetch('/api/tablets', { method: 'POST', body: JSON.stringify(from ? { name, copy_from: from } : { name }) });
  if (r && r.id) { TE.id = r.id; TE.page = 0; renderLayoutTabletSubTab(); } else showToast('❌ ' + ((r && r.error) || 'Could not add'));
}

// ── pickers: icon, group members, copy to another tablet ─────────────────────────────────────────────────────────────────
function teIconPicker(t, change) {
  showSheet(`<h3 style="margin:0 0 8px">Choose an icon</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:8px;max-height:50vh;overflow-y:auto">
      <button type="button" class="te-ico" data-i="" title="Default" style="height:48px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:11px">Default</button>
      ${Object.keys(TB_ICONS).map((k) => `<button type="button" class="te-ico" data-i="${k}" title="${k}" aria-label="${k}" style="height:48px;border-radius:10px;border:2px solid ${t.icon === k ? 'var(--accent)' : 'var(--border)'};background:var(--card);color:var(--text);cursor:pointer;padding:10px"><span style="display:block;width:100%;height:100%">${tbSvg(k)}</span></button>`).join('')}</div>
    <button class="btn" id="te-sheet-cancel" style="width:100%;margin-top:12px;background:var(--card);border:1px solid var(--border)">Cancel</button>`);
  $('te-sheet-cancel').addEventListener('click', closeSheet);
  document.querySelectorAll('.te-ico').forEach((b) => b.addEventListener('click', async () => { t.icon = b.dataset.i; closeSheet(); await change(); }));
}

async function teEntities() {
  if (!window._teEntities) { const e = await apiFetch('/api/ha/entities').catch(() => []); window._teEntities = Array.isArray(e) ? e : []; }
  return window._teEntities;
}
// Choose the lights and switches a group tile controls.
async function teGroupPicker(t, change) {
  const ents = (await teEntities()).filter((e) => TE_GROUP_DOMAINS.includes(e.entity_id.split('.')[0]));
  const chosen = new Set(t.members || []);
  showSheet(`<h3 style="margin:0 0 8px">Devices in this group</h3><input class="form-input" id="te-search" placeholder="Search…" style="margin-bottom:8px"><div id="te-members" style="max-height:46vh;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="te-sheet-cancel" style="flex:1;margin:0;background:var(--card);border:1px solid var(--border)">Cancel</button><button class="btn btn-primary" id="te-g-save" style="flex:1;margin:0">Done</button></div>`);
  const paint = () => {
    const q = $('te-search').value.trim().toLowerCase();
    $('te-members').innerHTML = ents.filter((e) => !q || e.friendly_name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q)).slice(0, 120).map((e) => `<label style="display:flex;gap:8px;align-items:center;padding:6px 4px"><input type="checkbox" class="te-gm" data-id="${escapeHtml(e.entity_id)}" ${chosen.has(e.entity_id) ? 'checked' : ''}><span style="min-width:0"><span style="display:block">${escapeHtml(e.friendly_name)}</span><span style="display:block;font-size:11px;color:var(--muted)">${escapeHtml(e.entity_id)}</span></span></label>`).join('') || '<p style="font-size:12px;color:var(--muted)">No matches.</p>';
    document.querySelectorAll('.te-gm').forEach((c) => c.addEventListener('change', () => { if (c.checked) chosen.add(c.dataset.id); else chosen.delete(c.dataset.id); }));
  };
  $('te-search').addEventListener('input', paint); paint();
  $('te-sheet-cancel').addEventListener('click', closeSheet);
  $('te-g-save').addEventListener('click', async () => { if (!chosen.size) { showToast('Choose at least one device.'); return; } t.members = [...chosen].slice(0, 30); closeSheet(); await change(); });
}

// ── the actions of a routine tile ──────────────────────────────────────────────────────────────────────────────────────
// Edits a copy of the tile's routine; "Done" checks it, stores it on the tile and calls onDone. Choosing a device swaps the sheet for a picker and back.
const TE_CHOICES = {};     // the inputs a media player offers, or the choices of a dropdown helper, for the "switch input to" step (not kept when empty: a TV that is off reports none)
async function teChoicesFor(ref) {
  if (TE_CHOICES[ref]) return TE_CHOICES[ref];
  if (ref.startsWith('remote.')) {                                      // a remote: the commands the app knows it has (from tiles); Home Assistant cannot list what it was taught
    const r = await apiFetch('/api/ha/remote-commands/' + encodeURIComponent(ref)).catch(() => null), list = r && Array.isArray(r.commands) ? [...new Set(r.commands.map((c) => c.command))] : [];
    if (list.length) TE_CHOICES[ref] = list;
    return list;
  }
  const r = await apiFetch('/api/ha/state/' + encodeURIComponent(ref)).catch(() => null), list = r ? (r.sourceList || r.options || []) : [];
  if (list.length) TE_CHOICES[ref] = list;
  return list;
}
async function teRoutineEditor(t, onDone) {
  const d = tmRoutineDraft(t.routine), ents = await teEntities();
  const nm = (ref) => { const e = ents.find((x) => x.entity_id === ref); return e ? e.friendly_name : ref; };
  const listOf = (id) => (id === 'steps' ? d.steps : id === 'off_steps' ? d.off_steps : (d.choices[Number(id.slice(1))] || {}).steps);
  const small = 'width:auto;margin:0;padding:6px 10px;background:var(--card);border:1px solid var(--border)';
  const dlId = (ref) => 'te-dl-' + ref.replace(/\W/g, '_');
  const condRow = (s, id, i) => !TM_COND_ACTIONS.includes(s.do) ? '' : `<div style="display:flex;align-items:center;gap:6px;margin:0 0 6px 12px"><select class="form-input te-r-condis" data-list="${id}" data-i="${i}" aria-label="When to do it" style="width:auto;padding:4px 6px;font-size:13px"><option value="">Always</option><option value="off" ${s.only_if && s.only_if.is === 'off' ? 'selected' : ''}>Only if it is off</option><option value="on" ${s.only_if && s.only_if.is === 'on' ? 'selected' : ''}>Only if it is on</option></select>${s.only_if ? `<select class="form-input te-r-condref" data-list="${id}" data-i="${i}" aria-label="Which device" style="flex:1;min-width:0;padding:4px 6px;font-size:13px">${ents.filter((e) => TM_COND_DOMAINS.includes(e.entity_id.split('.')[0])).map((e) => `<option value="${escapeHtml(e.entity_id)}" ${s.only_if.ref === e.entity_id ? 'selected' : ''}>${escapeHtml(e.friendly_name)}</option>`).join('')}</select>` : ''}</div>`;
  const valueRow = (s, id, i) => !tmNeedsValue(s) ? '' : `<div style="display:flex;align-items:center;gap:6px;margin:0 0 6px 12px"><input class="form-input te-r-value" data-list="${id}" data-i="${i}" list="${dlId(s.ref)}" maxlength="100" autocomplete="off" value="${escapeHtml(s.value || '')}" placeholder="${tmValueHint(s)}" aria-label="${tmValueHint(s)}" style="flex:1;min-width:0;padding:4px 6px;font-size:13px"><select class="form-input te-r-wait" data-list="${id}" data-i="${i}" style="width:auto;padding:4px 6px;font-size:13px" aria-label="Wait before this action">${tmWaitOptions(s).map(([n, l]) => `<option value="${n}" ${tmWaitValue(s) === n ? 'selected' : ''}>${l}</option>`).join('')}</select></div>${s.do !== 'speak' ? '' : `<div style="display:flex;align-items:center;gap:6px;margin:0 0 6px 12px"><select class="form-input te-r-device" data-list="${id}" data-i="${i}" aria-label="Speaker to say it on" style="flex:1;min-width:0;padding:4px 6px;font-size:13px"><option value="">Choose a speaker…</option>${ents.filter((e) => e.entity_id.startsWith('media_player.')).map((e) => `<option value="${escapeHtml(e.entity_id)}" ${s.device === e.entity_id ? 'selected' : ''}>${escapeHtml(e.friendly_name)}</option>`).join('')}</select></div>`}${s.do !== 'send_command' ? '' : `<div style="display:flex;align-items:center;gap:6px;margin:0 0 6px 12px"><input class="form-input te-r-device" data-list="${id}" data-i="${i}" maxlength="60" autocomplete="off" value="${escapeHtml(s.device || '')}" placeholder="Device name, for example amplifier" aria-label="Device the command was learned for" style="flex:1;min-width:0;padding:4px 6px;font-size:13px"><select class="form-input te-r-repeat" data-list="${id}" data-i="${i}" style="width:auto;padding:4px 6px;font-size:13px" aria-label="How many times">${tmRepeatOptions(s.repeat).map(([n, l]) => `<option value="${n}" ${String(s.repeat || 1) === n ? 'selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="btn te-r-act" data-a="learn" data-list="${id}" data-i="${i}" style="width:auto;margin:0;padding:4px 10px;font-size:13px;background:var(--card);border:1px solid var(--border)">Teach or test</button></div>`}`;
  const section = (title, id) => `<div style="margin-top:12px"><div style="font-size:12px;font-weight:600;margin-bottom:4px">${title}</div>
    ${listOf(id).map((s, i) => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><select class="form-input te-r-do" data-list="${id}" data-i="${i}" style="width:auto;padding:4px 6px;font-size:13px" aria-label="What to do">${tmStepOptions(s.ref, t.needs_pin || s.do === 'unlock').map(([a, l]) => `<option value="${a}" ${a === s.do ? 'selected' : ''}>${l}</option>`).join('')}</select><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${escapeHtml(nm(s.ref))}</span><button type="button" class="icon-btn te-r-act" data-a="up" data-list="${id}" data-i="${i}" title="Move up" style="width:28px;height:28px">▲</button><button type="button" class="icon-btn te-r-act" data-a="down" data-list="${id}" data-i="${i}" title="Move down" style="width:28px;height:28px">▼</button><button type="button" class="icon-btn del te-r-act" data-a="rm" data-list="${id}" data-i="${i}" title="Remove" style="width:28px;height:28px">🗑️</button></div>${valueRow(s, id, i)}${condRow(s, id, i)}`).join('')}
    ${listOf(id).length < TM_MAX_STEPS ? `<button type="button" class="btn te-r-act" data-a="add" data-list="${id}" style="${small}">Add an action</button>` : ''}${id === 'off_steps' && tmOffFromOn(d.steps, d.off_steps).length > d.off_steps.length ? `<button type="button" class="btn te-r-act" data-a="fill" style="${small};margin-left:6px">Add the opposite of each "on" action</button>` : ''}</div>`;
  const render = () => {
    let body = `<select class="form-input" id="te-r-mode">${TM_ROUTINE_MODES.map(([v, l]) => `<option value="${v}" ${d.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    if (d.mode === 'run') body += section('Actions, in this order', 'steps');
    else if (d.mode === 'toggle') {
      const inds = [...new Set([...d.steps, ...d.off_steps].map((s) => s.ref).filter((r) => TM_STATE_DOMAINS.includes(tmDomain(r))))];
      body += section('When switching on', 'steps') + section('When switching off', 'off_steps')
        + `<label style="display:block;font-size:12px;margin-top:12px">Lit when this is on<select class="form-input" id="te-r-ind" style="margin-top:2px"><option value="">${inds.length ? 'The first light or switch' : 'What the tile did last'}</option>${inds.map((r) => `<option value="${escapeHtml(r)}" ${d.indicator === r ? 'selected' : ''}>${escapeHtml(nm(r))}</option>`).join('')}</select></label>`;
    } else {
      if (d.mode === 'cycle') body += '<p style="margin:8px 0 0;color:var(--muted);font-size:12px">Each tap does the next press, then it starts over.</p>' + `<label style="display:block;font-size:12px;margin-top:10px">Start over after<select class="form-input" id="te-r-reset" style="margin-top:2px">${tmResetOptions(d.reset_after).map(([m, l]) => `<option value="${m}" ${Number(d.reset_after || 0) === m ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
      body += d.choices.map((c, n) => `<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:10px"><div style="display:flex;gap:6px"><input class="form-input te-r-label" data-n="${n}" maxlength="40" value="${escapeHtml(c.label)}" aria-label="${d.mode === 'cycle' ? 'Name of this press' : 'Name of the choice'}">${d.choices.length > 1 ? `<button type="button" class="icon-btn del te-r-act" data-a="rmchoice" data-n="${n}" title="Remove this choice">🗑️</button>` : ''}</div>${section('Actions', 'c' + n)}</div>`).join('')
        + (d.choices.length < TM_MAX_CHOICES ? `<button type="button" class="btn te-r-act" data-a="addchoice" style="${small};margin-top:10px">${d.mode === 'cycle' ? 'Add a press' : 'Add a choice'}</button>` : '');
    }
    showSheet(`<h3 style="margin:0 0 8px">Actions</h3><div style="max-height:56vh;overflow-y:auto">${body}</div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="te-sheet-cancel" style="flex:1;margin:0;background:var(--card);border:1px solid var(--border)">Cancel</button><button class="btn btn-primary" id="te-r-done" style="flex:1;margin:0">Done</button></div>`);
    $('te-sheet-cancel').addEventListener('click', closeSheet);
    $('te-r-mode').addEventListener('change', (e) => { d.mode = e.target.value; render(); });
    const rs = $('te-r-reset'); if (rs) rs.addEventListener('change', () => { d.reset_after = Number(rs.value) || 0; });
    const ind = $('te-r-ind'); if (ind) ind.addEventListener('change', () => { d.indicator = ind.value; });
    document.querySelectorAll('.te-r-label').forEach((el) => el.addEventListener('input', () => { d.choices[Number(el.dataset.n)].label = el.value; }));
    document.querySelectorAll('.te-r-do').forEach((el) => el.addEventListener('change', () => { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) { tmSetStepAction(s, el.value); render(); } }));
    document.querySelectorAll('.te-r-value').forEach((el) => el.addEventListener('input', () => { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) s.value = el.value; }));
    document.querySelectorAll('.te-r-condis').forEach((el) => el.addEventListener('change', () => { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) { tmSetCond(s, el.value, ents); render(); } }));
    document.querySelectorAll('.te-r-condref').forEach((el) => el.addEventListener('change', () => { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s && s.only_if) s.only_if.ref = el.value; }));
    document.querySelectorAll('.te-r-device').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) { if (el.value.trim()) s.device = el.value.trim(); else delete s.device; } }));
    document.querySelectorAll('.te-r-repeat').forEach((el) => el.addEventListener('change', () => { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) { if (Number(el.value) > 1) s.repeat = Number(el.value); else delete s.repeat; } }));
    document.querySelectorAll('.te-r-wait').forEach((el) => el.addEventListener('change', () => { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) tmSetWait(s, el.value); }));
    document.querySelectorAll('datalist.te-dl').forEach((x) => x.remove());
    [...new Set([d.steps, d.off_steps, ...d.choices.map((c) => c.steps)].flat().filter(tmNeedsValue).map((x) => x.ref))].forEach((ref) => {
      const dl = document.createElement('datalist'); dl.id = dlId(ref); dl.className = 'te-dl'; document.body.appendChild(dl);
      teChoicesFor(ref).then((list) => { dl.innerHTML = list.map((x) => `<option value="${escapeHtml(x)}"></option>`).join(''); });
    });
    document.querySelectorAll('.te-r-act').forEach((el) => el.addEventListener('click', async () => {
      const a = el.dataset.a, id = el.dataset.list, i = Number(el.dataset.i);
      if (a === 'add') { const ref = await tePickStep(ents); if (ref) listOf(id).push(tmNewStep(ref)); }
      else if (a === 'learn') { const s = listOf(id)[i]; if (s) await teRemoteLearn(s, nm(s.ref)); }
      else if (a === 'fill') d.off_steps = tmOffFromOn(d.steps, d.off_steps);
      else if (a === 'rm') listOf(id).splice(i, 1);
      else if (a === 'up') tmMoveIn(listOf(id), i, -1);
      else if (a === 'down') tmMoveIn(listOf(id), i, 1);
      else if (a === 'addchoice') d.choices.push({ label: (d.mode === 'cycle' ? 'Press ' : 'Choice ') + (d.choices.length + 1), steps: [] });
      else if (a === 'rmchoice') d.choices.splice(Number(el.dataset.n), 1);
      render();
    }));
    $('te-r-done').addEventListener('click', async () => {
      const out = tmRoutineFromDraft(d), problem = tmRoutineProblem(out);
      if (problem) { showToast(problem); return; }
      t.routine = out; tmStripUnlock(t);
      if (tmRoutineProblem(t.routine)) { showToast('Add at least one action.'); return; }
      closeSheet(); await onDone();
    });
  };
  render();
}
// The commands of an on-screen remote: one row per button with the name of the command it sends (empty: the kind of remote's own), and Teach for a learning remote. Done stores them on the tile.
// Arrange the buttons of an on-screen remote: the ones that have a command, in a list that can be moved up and down; the pad then shows them in that order. "Usual layout" goes back to the shape of a real remote.
function teRemoteArrange(t) {
  return new Promise((resolve) => {
    const cfg = { ...(t.remote || { preset: 'custom' }) }, names = Object.fromEntries(TM_REMOTE_KEYS);
    let ids = tmRemoteItems({ ...cfg, order: [''] }) || [];
    if (cfg.order && cfg.order.length) ids = tmRemoteItems(cfg) || ids;
    const label = (id) => { if (names[id]) return names[id]; const ci = (cfg.custom || []).findIndex((c, i) => tmCustomId(c, i) === id), c = (cfg.custom || [])[ci]; return c ? (c.label || c.command) : id; };
    const small = 'width:auto;margin:0;padding:4px 10px;font-size:13px;background:var(--card);border:1px solid var(--border)';
    const open = () => {
      const rows = ids.map((id, i) => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="flex:1;font-size:13px">${escapeHtml(label(id))}</span><button type="button" class="btn te-a-up" data-i="${i}" aria-label="Move ${escapeHtml(label(id))} earlier" style="${small}" ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" class="btn te-a-down" data-i="${i}" aria-label="Move ${escapeHtml(label(id))} later" style="${small}" ${i === ids.length - 1 ? 'disabled' : ''}>▼</button></div>`).join('');
      showSheet(`<h3 style="margin:0 0 8px">Arrange the buttons of ${escapeHtml(teTileName(t))}</h3><p style="font-size:13px;color:var(--muted);margin:0 0 8px">Move a button up or down. The remote shows its buttons in this order.</p><div style="max-height:56vh;overflow-y:auto">${rows || '<p style="font-size:12px;color:var(--muted)">This remote has no buttons yet.</p>'}</div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="te-a-usual" style="flex:1;margin:0;background:var(--card);border:1px solid var(--border)">Usual layout</button><button class="btn btn-primary" id="te-a-done" style="flex:1;margin:0">Done</button></div>`);
      const move = (i, j) => { if (j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; open(); } };
      document.querySelectorAll('.te-a-up').forEach((el) => el.addEventListener('click', () => move(Number(el.dataset.i), Number(el.dataset.i) - 1)));
      document.querySelectorAll('.te-a-down').forEach((el) => el.addEventListener('click', () => move(Number(el.dataset.i), Number(el.dataset.i) + 1)));
      $('te-a-usual').addEventListener('click', () => { delete cfg.order; t.remote = cfg; closeSheet(); resolve(); });
      $('te-a-done').addEventListener('click', () => { cfg.order = ids.slice(); t.remote = cfg; closeSheet(); resolve(); });
    };
    open();
  });
}
function teRemoteKeys(t) {
  return new Promise(async (resolve) => {
    const ents = await teEntities();
    const cfg = { ...(t.remote || { preset: 'custom' }) }, buttons = { ...(cfg.buttons || {}) }, custom = (cfg.custom || []).map((c) => ({ ...c })), hidden = new Set(cfg.hidden || []);
    const preset = TM_REMOTE_PRESETS[cfg.preset] || {}, name = teTileName(t);
    const kindName = (TM_REMOTE_PRESET_LIST.find((x) => x[0] === (cfg.preset || 'custom')) || [0, 'remote'])[1];
    const small = 'width:auto;margin:0;padding:4px 10px;font-size:13px;background:var(--card);border:1px solid var(--border)';
    const remotes = ents.filter((e) => e.entity_id.startsWith('remote.') && e.entity_id !== t.ref);
    const known = {};                                                  // remote entity -> the commands the app knows it has (from tiles), for suggestions
    const dl = (ref) => 'te-cmds-' + ref.replace(/\W/g, '_');
    const refsUsed = () => [...new Set([t.ref, ...custom.map((c) => c.ref).filter(Boolean)])];
    const fillLists = () => refsUsed().forEach(async (ref) => {
      if (!known[ref]) { const r = await apiFetch('/api/ha/remote-commands/' + encodeURIComponent(ref)).catch(() => null); known[ref] = r && Array.isArray(r.commands) ? r.commands : []; }
      const el = document.getElementById(dl(ref)); if (el) el.innerHTML = known[ref].map((c) => `<option value="${escapeHtml(c.command)}" label="${escapeHtml(c.device ? c.device + ': ' + c.command : c.command)}"></option>`).join('');
    });
    const inp = 'min-width:0;padding:4px 6px;font-size:13px';
    const open = () => {
      const rows = TM_REMOTE_KEYS.map(([k, l]) => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="flex:0 0 90px;font-size:13px">${escapeHtml(l)}</span><input class="form-input te-k-in" data-k="${k}" list="${dl(t.ref)}" maxlength="60" value="${escapeHtml(buttons[k] || '')}" placeholder="${escapeHtml(preset[k] || 'command name')}" aria-label="Command for ${escapeHtml(l)}" style="flex:1;${inp}" ${hidden.has(k) ? 'disabled' : ''}><button type="button" class="btn te-k-teach" data-k="${k}" style="${small}" ${hidden.has(k) ? 'disabled' : ''}>Teach</button><button type="button" class="btn te-k-hide" data-k="${k}" aria-label="${hidden.has(k) ? 'Show ' + escapeHtml(l) + ' again' : 'Remove ' + escapeHtml(l) + ' from the remote'}" style="${small}">${hidden.has(k) ? 'Show' : '✕'}</button></div>`).join('');
      const crows = custom.map((c, i) => `<div style="border:1px solid var(--border);border-radius:8px;padding:6px;margin-bottom:6px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><input class="form-input te-c-label" data-i="${i}" maxlength="20" value="${escapeHtml(c.label || '')}" placeholder="Button name" aria-label="Button name" style="flex:1;${inp}"><select class="form-input te-c-ref" data-i="${i}" aria-label="Which remote sends it" style="width:auto;${inp}"><option value="">This remote</option>${remotes.map((e) => `<option value="${escapeHtml(e.entity_id)}" ${c.ref === e.entity_id ? 'selected' : ''}>${escapeHtml(e.friendly_name)}</option>`).join('')}</select><button type="button" class="icon-btn del te-c-rm" data-i="${i}" title="Remove" style="width:28px;height:28px">🗑️</button></div><div style="display:flex;align-items:center;gap:6px"><input class="form-input te-c-dev" data-i="${i}" maxlength="60" value="${escapeHtml(c.device || '')}" placeholder="${escapeHtml(c.ref ? 'Device name, for example amplifier' : cfg.device || 'Device name')}" aria-label="Device name" style="flex:1;${inp}"><input class="form-input te-c-cmd" data-i="${i}" list="${dl(c.ref || t.ref)}" maxlength="60" value="${escapeHtml(c.command || '')}" placeholder="command name" aria-label="Command for ${escapeHtml(c.label || 'this button')}" style="flex:1;${inp}"><button type="button" class="btn te-c-teach" data-i="${i}" style="${small}">Teach</button></div></div>`).join('');
      const lists = refsUsed().map((ref) => `<datalist id="${dl(ref)}"></datalist>`).join('');
      showSheet(`<h3 style="margin:0 0 8px">Commands for ${escapeHtml(name)}</h3><p style="font-size:13px;color:var(--muted);margin:0 0 8px">Leave a box empty to use the ${escapeHtml(kindName)} command shown in grey. A button with no command is left off the remote.</p><div style="max-height:56vh;overflow-y:auto">${rows}<div style="font-size:12px;font-weight:600;margin:12px 0 2px">Custom buttons</div><p style="font-size:12px;color:var(--muted);margin:0 0 6px">Your own buttons, such as one for each input of an amplifier. A button can be sent by a different remote, for example an amplifier's next to an Apple TV's buttons. They show under the other buttons.</p>${crows}${custom.length < TM_REMOTE_CUSTOM_MAX ? `<button type="button" class="btn" id="te-c-add" style="${small}">Add a button</button>` : ''}</div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-primary" id="te-k-done" style="flex:1;margin:0">Done</button></div>${lists}`);
      fillLists();
      document.querySelectorAll('.te-k-in').forEach((el) => el.addEventListener('input', () => { if (el.value.trim()) buttons[el.dataset.k] = el.value.trim(); else delete buttons[el.dataset.k]; }));
      document.querySelectorAll('.te-c-label').forEach((el) => el.addEventListener('input', () => { custom[Number(el.dataset.i)].label = el.value; }));
      document.querySelectorAll('.te-c-dev').forEach((el) => el.addEventListener('input', () => { custom[Number(el.dataset.i)].device = el.value; }));
      document.querySelectorAll('.te-c-cmd').forEach((el) => el.addEventListener('input', () => {
        const c = custom[Number(el.dataset.i)]; c.command = el.value;
        const matches = (known[c.ref || t.ref] || []).filter((k) => k.command === c.command);              // a command the app knows by one device name: fill the device in
        if (matches.length === 1 && matches[0].device && !c.device && (c.ref || matches[0].device !== cfg.device)) { c.device = matches[0].device; const dv = document.querySelector('.te-c-dev[data-i="' + el.dataset.i + '"]'); if (dv) dv.value = c.device; }
      }));
      document.querySelectorAll('.te-c-ref').forEach((el) => el.addEventListener('change', () => { const c = custom[Number(el.dataset.i)]; if (el.value) c.ref = el.value; else delete c.ref; open(); }));
      document.querySelectorAll('.te-k-teach, .te-c-teach').forEach((el) => el.addEventListener('click', async () => {
        const isKey = el.classList.contains('te-k-teach'), c = isKey ? null : custom[Number(el.dataset.i)];
        const step = { ref: c && c.ref ? c.ref : t.ref, do: 'send_command', value: c ? c.command : buttons[el.dataset.k] || '', device: c ? (c.device || (c.ref ? '' : cfg.device || '')) : cfg.device || '' };
        await teRemoteLearn(step, c && c.ref ? ((ents.find((e) => e.entity_id === c.ref) || {}).friendly_name || c.ref) : name);
        if (step.value) { if (c) c.command = step.value; else buttons[el.dataset.k] = step.value; }
        if (step.device) {
          if (c && c.ref) c.device = step.device;                                      // another remote's own device name
          else if (!cfg.device) cfg.device = step.device;                              // this remote had no device name yet: it becomes the tile's
          else if (c && step.device !== cfg.device) c.device = step.device;            // a different name just for this button
          else if (!c) cfg.device = step.device;
        }
        open();
      }));
      document.querySelectorAll('.te-k-hide').forEach((el) => el.addEventListener('click', () => { const k = el.dataset.k; if (hidden.has(k)) hidden.delete(k); else { hidden.add(k); delete buttons[k]; } open(); }));
      document.querySelectorAll('.te-c-rm').forEach((el) => el.addEventListener('click', () => { custom.splice(Number(el.dataset.i), 1); open(); }));
      const add = $('te-c-add'); if (add) add.addEventListener('click', () => { custom.push({ label: '', command: '', id: 'c' + Math.random().toString(36).slice(2, 8) }); open(); });
      $('te-k-done').addEventListener('click', () => {
        if (Object.keys(buttons).length) cfg.buttons = buttons; else delete cfg.buttons;
        if (hidden.size) cfg.hidden = [...hidden]; else delete cfg.hidden;
        const keep = custom.map((c, i) => { const o = { label: String(c.label || '').trim().slice(0, 20), command: String(c.command || '').trim(), id: tmCustomId(c, i) }; if (c.ref) o.ref = c.ref; if (String(c.device || '').trim()) o.device = String(c.device).trim(); return o; }).filter((c) => c.command);
        keep.forEach((c) => { if (!c.label) c.label = c.command.slice(0, 20); });
        if (keep.length) cfg.custom = keep; else delete cfg.custom;
        t.remote = cfg; closeSheet(); resolve();
      });
    };
    open();
  });
}
// Teach a universal remote (a BroadLink, say) a command, and test it: Home Assistant puts the remote into learning mode, then the person presses the button on the original remote, pointing it at the
// universal remote, within about 20 seconds. Home Assistant does not say whether it worked, so "Test it" sends the command. The step's device and command are filled in on Done.
function teRemoteLearn(step, name) {
  return new Promise((resolve) => {
    showSheet(`<h3 style="margin:0 0 8px">Teach ${escapeHtml(name)} a command</h3><p style="font-size:13px;color:var(--muted);margin:0 0 10px">Name the device (like amplifier) and the command (like power). Press Start, then point your original remote at ${escapeHtml(name)} and press that button within 20 seconds.</p>
      <label style="display:block;font-size:12px">Device<input class="form-input" id="te-l-dev" maxlength="60" value="${escapeHtml(step.device || '')}" placeholder="amplifier" style="margin-top:2px"></label>
      <label style="display:block;font-size:12px;margin-top:8px">Command<input class="form-input" id="te-l-cmd" maxlength="60" value="${escapeHtml(step.value || '')}" placeholder="power" style="margin-top:2px"></label>
      <p id="te-l-msg" role="status" style="font-size:13px;min-height:1.4em;margin:10px 0 0"></p>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary" id="te-l-go" style="flex:1;margin:0">Start</button><button class="btn" id="te-l-test" style="flex:1;margin:0;background:var(--card);border:1px solid var(--border)">Test it</button><button class="btn" id="te-l-done" style="flex:1;margin:0;background:var(--card);border:1px solid var(--border)">Done</button></div><button class="btn" id="te-l-del" style="width:auto;margin:10px 0 0;padding:6px 10px;font-size:13px;background:var(--card);border:1px solid var(--border);color:var(--danger,#e5484d)">Delete this command from the remote</button>`);
    const say = (t) => { $('te-l-msg').textContent = t; };
    const call = async (action) => {
      const device = $('te-l-dev').value.trim(), command = $('te-l-cmd').value.trim();
      if (!device || !command) { say('Type a device name and a command name first.'); return; }
      const r = await apiFetch('/api/ha/call-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityId: step.ref, action, device, command }) }).catch(() => null);
      if (!r || r.error || r.__networkError) { say((r && r.error) || 'That did not work.'); return; }
      say(action === 'learn_command' ? 'Now point your original remote at it and press the button (you have about 20 seconds).' : action === 'delete_command' ? 'Deleted from the remote.' : 'Sent. Did the device react?');
    };
    $('te-l-go').addEventListener('click', () => call('learn_command'));
    $('te-l-test').addEventListener('click', () => call('send_command'));
    $('te-l-del').addEventListener('click', () => call('delete_command'));
    $('te-l-done').addEventListener('click', () => {
      const device = $('te-l-dev').value.trim(), command = $('te-l-cmd').value.trim();
      if (device) step.device = device; else delete step.device;
      if (command) step.value = command;
      resolve();
    });
  });
}
// Choose the device, scene, script, automation or button for one step. Resolves with its entity id, or '' when cancelled.
function tePickStep(ents) {
  return new Promise((resolve) => {
    const list = ents.filter((e) => tmStepDomainOk(e.entity_id)), SCENES = ['scene', 'script', 'automation', 'button', 'input_button'];
    showSheet(`<h3 style="margin:0 0 8px">Choose a device</h3><div style="display:flex;gap:6px;margin-bottom:8px"><select class="form-input" id="te-ps-kind" style="width:auto"><option value="all">All</option><option value="things">Devices</option><option value="scenes">Scenes and automations</option></select><input class="form-input" id="te-ps-search" placeholder="Search…"></div><div id="te-ps-list" style="max-height:46vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px"></div><button class="btn" id="te-sheet-cancel" style="width:100%;margin-top:12px;background:var(--card);border:1px solid var(--border)">Cancel</button>`);
    $('te-sheet-cancel').addEventListener('click', () => resolve(''));
    const paint = () => {
      const q = $('te-ps-search').value.trim().toLowerCase(), kind = $('te-ps-kind').value;
      const rows = list.filter((e) => (kind === 'all' || (kind === 'scenes') === SCENES.includes(e.entity_id.split('.')[0])) && (!q || e.friendly_name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q))).slice(0, 120);
      $('te-ps-list').innerHTML = rows.map((e) => `<button type="button" class="te-ps-pick" data-ref="${escapeHtml(e.entity_id)}" style="display:flex;justify-content:space-between;gap:8px;text-align:left;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);cursor:pointer"><span style="min-width:0"><span style="display:block">${escapeHtml(e.friendly_name)}</span><span style="display:block;font-size:11px;color:var(--muted)">${escapeHtml(e.entity_id)}</span></span><span style="font-size:11px;color:var(--muted)">${escapeHtml(e.state)}</span></button>`).join('') || '<p style="font-size:12px;color:var(--muted)">' + (list.length ? 'No matches.' : 'Home Assistant is not set up. Connect it in Settings → Home Assistant first.') + '</p>';
      document.querySelectorAll('.te-ps-pick').forEach((b) => b.addEventListener('click', () => resolve(b.dataset.ref)));
    };
    $('te-ps-search').addEventListener('input', paint); $('te-ps-kind').addEventListener('change', paint);
    paint();
  });
}

// Copy a tile or a whole page to this tablet or another one. Payload: { tile } or { page }.
async function teCopyTo(payload) {
  const isTile = !!payload.tile;
  showSheet(`<h3 style="margin:0 0 8px">${isTile ? 'Copy this tile to…' : 'Copy this page to…'}</h3>
    <label style="font-size:12px">Tablet<select class="form-input" id="te-cp-tab" style="margin-top:2px">${TE.tablets.map((x) => `<option value="${escapeHtml(x.id)}" ${x.id === TE.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.id === TE.id ? ' (this one)' : ''}</option>`).join('')}</select></label>
    ${isTile ? '<label style="font-size:12px;display:block;margin-top:8px">Page<select class="form-input" id="te-cp-page" style="margin-top:2px"></select></label>' : ''}
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="te-sheet-cancel" style="flex:1;margin:0;background:var(--card);border:1px solid var(--border)">Cancel</button><button class="btn btn-primary" id="te-cp-go" style="flex:1;margin:0">Copy</button></div>`);
  let target = TE.layout;
  const load = async () => {
    const id = $('te-cp-tab').value;
    if (id === TE.id) target = TE.layout; else { const r = await apiFetch('/api/tablets/' + encodeURIComponent(id)).catch(() => null); target = r && r.layout ? r.layout : null; }
    if (isTile) $('te-cp-page').innerHTML = target ? target.pages.map((p, i) => `<option value="${i}" ${id === TE.id && i === TE.page ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('') : '';
  };
  $('te-cp-tab').addEventListener('change', load); await load();
  $('te-sheet-cancel').addEventListener('click', closeSheet);
  $('te-cp-go').addEventListener('click', async () => {
    if (!target) { showToast('❌ Could not load that tablet'); return; }
    const id = $('te-cp-tab').value, same = id === TE.id;
    if (isTile) {
      const pg = target.pages[Number($('te-cp-page').value) || 0], c = { ...payload.tile, id: teId() };
      pg.tiles.push(c);
      if (!teFit(pg, target.grid.cols, target.grid.rows)) { pg.tiles.pop(); showToast('That page is full. Add another page.'); return; }
    } else {
      if (target.pages.length >= 12) { showToast('That is the most pages a tablet can have.'); return; }
      const pg = payload.page; pg.id = 'p' + Date.now().toString(36); pg.name = (same ? pg.name + ' copy' : pg.name).slice(0, 40); pg.tiles.forEach((x) => { x.id = teId(); });
      target.pages.push(pg);
    }
    closeSheet();
    if (same) { await teSave(true); teDraw(); showToast('Copied ✓'); return; }
    const r = await apiFetch(`/api/tablets/${encodeURIComponent(id)}/layout`, { method: 'PUT', body: JSON.stringify({ layout: target }) });
    showToast(r && r.layout ? 'Copied ✓' : '❌ Could not copy');
  });
}

// ── add a tile ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Add a tile: a Home Assistant device, scene or sensor (searchable), a group of devices, a camera, or one of the Piazza HQ tiles.
async function teAddTile() {
  const SOURCES = [['ha', 'Home Assistant'], ['scene', 'Scenes and automations'], ['sensor', 'Sensors'], ['more', 'More controls'], ['group', 'Group'], ['routine', 'Actions'], ['camera', 'Camera'], ['card', 'Piazza HQ']];
  showSheet(`<h3 style="margin:0 0 8px">Add a tile</h3>
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${SOURCES.map(([k, l]) => `<button class="btn te-src${k === 'ha' ? ' on' : ''}" data-src="${k}" style="margin:0;flex:1;min-width:84px;padding:8px;${k === 'ha' ? '' : 'background:var(--card);border:1px solid var(--border)'}">${l}</button>`).join('')}</div>
    <input class="form-input" id="te-search" placeholder="Search…" style="margin-bottom:8px">
    <div id="te-choices" style="max-height:46vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px"><p style="font-size:12px;color:var(--muted)">Loading…</p></div>
    <button class="btn" id="te-sheet-cancel" style="width:100%;margin-top:12px;background:var(--card);border:1px solid var(--border)">Cancel</button>`);
  $('te-sheet-cancel').addEventListener('click', closeSheet);
  let src = 'ha';
  const groupForm = { name: '', mode: 'toggle', chosen: new Set() }, routineForm = { name: '' };
  await teEntities();
  if (!window._teCameras) { const c = await apiFetch('/api/cameras').catch(() => []); window._teCameras = Array.isArray(c) ? c : []; }
  const SKIP = TM_ADD_SKIP;
  const choiceStyle = 'display:flex;justify-content:space-between;gap:8px;text-align:left;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);cursor:pointer';
  const entRow = (e) => `<button class="te-choice" data-kind="ha" data-ref="${escapeHtml(e.entity_id)}" style="${choiceStyle}"><span style="min-width:0"><span style="display:block">${escapeHtml(e.friendly_name)}</span><span style="display:block;font-size:11px;color:var(--muted)">${escapeHtml(e.entity_id)}</span></span><span style="font-size:11px;color:var(--muted)">${escapeHtml(e.state)}${e.unit ? ' ' + escapeHtml(e.unit) : ''}</span></button>`;
  const none = (m) => `<p style="font-size:12px;color:var(--muted)">${m}</p>`;
  const paint = () => {
    const q = $('te-search').value.trim().toLowerCase(), ents = window._teEntities, match = (e) => !q || e.friendly_name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q);
    const noHa = none('Home Assistant is not set up. Connect it in Settings → Home Assistant first.');
    let rows;
    if (src === 'ha') { const l = ents.filter((e) => !SKIP.has(e.entity_id.split('.')[0]) && match(e)).slice(0, 80); rows = l.length ? l.map(entRow) : [ents.length ? none('No matches.') : noHa]; }
    else if (src === 'scene') { const l = ents.filter((e) => ['scene', 'script', 'automation', 'button', 'input_button'].includes(e.entity_id.split('.')[0]) && match(e)).slice(0, 80); rows = l.length ? l.map(entRow) : [ents.length ? none('No scenes, scripts, automations or buttons found.') : noHa]; }
    else if (src === 'more') { const l = ents.filter((e) => TM_MORE_DOMAINS.includes(e.entity_id.split('.')[0]) && match(e)).slice(0, 80); rows = l.length ? l.map(entRow) : [ents.length ? none('No dropdowns, numbers or updates found.') : noHa]; }
    else if (src === 'sensor') { const l = ents.filter((e) => ['sensor', 'binary_sensor'].includes(e.entity_id.split('.')[0]) && match(e)).slice(0, 80); rows = l.length ? l.map(entRow) : [ents.length ? none('No matches.') : noHa]; }
    else if (src === 'routine') rows = ['<p style="font-size:12px;color:var(--muted);margin:0">A tile that does several things at once: run a scene and switch lights, switch between two states, or pick one of a few choices.</p>', `<input class="form-input" id="te-r-name" placeholder="Name, for example Movie time" value="${escapeHtml(routineForm.name)}" maxlength="40">`, '<button class="btn btn-primary" id="te-r-create" style="margin-top:8px">Choose the actions</button>'];
    else if (src === 'camera') {
      const l = (window._teCameras || []).filter((c) => !q || c.name.toLowerCase().includes(q)), more = tmCamCandidates(ents, window._teCameras).filter((c) => !q || c.name.toLowerCase().includes(q) || c.entity_id.includes(q));
      rows = l.map((c) => `<button class="te-choice" data-kind="camera" data-ref="cam_${c.id}" style="${choiceStyle}"><span>${escapeHtml(c.name)}</span><span style="font-size:11px;color:var(--muted)">Camera</span></button>`);
      if (more.length) rows.push('<div style="font-size:12px;color:var(--muted);margin-top:6px">From Home Assistant</div>', ...more.map((c) => `<button class="te-newcam" data-ent="${escapeHtml(c.entity_id)}" data-name="${escapeHtml(c.name)}" style="${choiceStyle}"><span style="min-width:0"><span style="display:block">${escapeHtml(c.name)}</span><span style="display:block;font-size:11px;color:var(--muted)">${escapeHtml(c.entity_id)}</span></span><span style="font-size:11px;color:var(--muted)">Camera</span></button>`));
      if (!rows.length) rows = [none('No cameras found. Connect Home Assistant, or add a camera in Settings, Cameras.')];
    }
    else if (src === 'group') {
      const l = ents.filter((e) => TE_GROUP_DOMAINS.includes(e.entity_id.split('.')[0]) && match(e)).slice(0, 100);
      rows = [`<input class="form-input" id="te-g-name" placeholder="Name, for example Downstairs lights" value="${escapeHtml(groupForm.name)}" maxlength="40">
        <select class="form-input" id="te-g-mode"><option value="toggle" ${groupForm.mode === 'toggle' ? 'selected' : ''}>Switch them all together</option><option value="all_on" ${groupForm.mode === 'all_on' ? 'selected' : ''}>Turn them all on</option><option value="all_off" ${groupForm.mode === 'all_off' ? 'selected' : ''}>Turn them all off</option></select>`,
        ...(l.length ? l.map((e) => `<label style="display:flex;gap:8px;align-items:center;padding:4px"><input type="checkbox" class="te-gm" data-id="${escapeHtml(e.entity_id)}" ${groupForm.chosen.has(e.entity_id) ? 'checked' : ''}><span style="min-width:0"><span style="display:block">${escapeHtml(e.friendly_name)}</span><span style="display:block;font-size:11px;color:var(--muted)">${escapeHtml(e.entity_id)}</span></span></label>`) : [ents.length ? none('No matches.') : noHa]),
        '<button class="btn btn-primary" id="te-g-create" style="margin-top:8px">Create the group</button>'];
    } else {
      rows = Object.entries(TE_CARD_LABELS).filter(([, l]) => !q || l.toLowerCase().includes(q)).map(([ref, l]) => `<button class="te-choice" data-kind="card" data-ref="${ref}" style="text-align:left;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);cursor:pointer">${escapeHtml(l)}</button>`);
    }
    $('te-choices').innerHTML = rows.join('');
    const add = async (tile) => {
      const L = TE.layout, page = L.pages[TE.page];
      if (page.tiles.length >= 80) { showToast('That page is full.'); return; }
      page.tiles.push(tile);
      if (!teFit(page, L.grid.cols, L.grid.rows)) { page.tiles.pop(); showToast('That page is full. Add another page.'); return; }
      TE.sel = tile.id; closeSheet(); teDraw(); await teSave(true);
    };
    const base = (kind, ref) => tmNewTile(kind, ref, teId());
    document.querySelectorAll('.te-choice').forEach((b) => b.addEventListener('click', async () => {
      const tile = base(b.dataset.kind, b.dataset.ref);
      if (tile.ref === 'send_message') { const text = (prompt('What should this button send to the message board?', "Dinner's ready") || '').trim(); if (!text) return; tile.card_config = { text: text.slice(0, 80) }; tile.label = text.slice(0, 40); }
      await add(tile);
    }));
    document.querySelectorAll('.te-newcam').forEach((b) => b.addEventListener('click', async () => {                // a Home Assistant camera that is not on Piazza's list yet: add it, then its tile
      const r = await apiFetch('/api/cameras', { method: 'POST', body: JSON.stringify({ name: b.dataset.name, kind: 'ha', url: 'ha:' + b.dataset.ent }) }).catch(() => null);
      if (!r || !r.id) { showToast('❌ ' + ((r && r.error) || 'Could not add that camera')); return; }
      window._teCameras = (window._teCameras || []).concat([{ id: r.id, name: r.name, kind: 'ha', host_hint: b.dataset.ent }]);
      await add(base('camera', 'cam_' + r.id));
    }));
    document.querySelectorAll('.te-gm').forEach((c) => c.addEventListener('change', () => { if (c.checked) groupForm.chosen.add(c.dataset.id); else groupForm.chosen.delete(c.dataset.id); }));
    const gn = $('te-g-name'); if (gn) gn.addEventListener('input', () => { groupForm.name = gn.value; });
    const gmode = $('te-g-mode'); if (gmode) gmode.addEventListener('change', () => { groupForm.mode = gmode.value; });
    const rn = $('te-r-name'); if (rn) rn.addEventListener('input', () => { routineForm.name = rn.value; });
    const rc = $('te-r-create');
    if (rc) rc.addEventListener('click', () => {
      const name = (rn.value || '').trim(); if (!name) { showToast('Give the tile a name.'); return; }
      const tile = base('routine', 'routine'); tile.label = name.slice(0, 40); tile.routine = { mode: 'run', steps: [] };
      teRoutineEditor(tile, async () => { await add(tile); });
    });
    const gc = $('te-g-create');
    if (gc) gc.addEventListener('click', async () => {
      const name = ($('te-g-name').value || '').trim();
      if (!name) { showToast('Give the group a name.'); return; }
      if (!groupForm.chosen.size) { showToast('Choose at least one device.'); return; }
      const tile = base('group', 'g' + Date.now().toString(36)); tile.label = name.slice(0, 40); tile.members = [...groupForm.chosen].slice(0, 30); tile.group_mode = groupForm.mode;
      await add(tile);
    });
  };
  document.querySelectorAll('.te-src').forEach((b) => b.addEventListener('click', () => {
    src = b.dataset.src;
    document.querySelectorAll('.te-src').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.style.background = on ? '' : 'var(--card)'; x.style.border = on ? '' : '1px solid var(--border)'; });
    paint();
  }));
  $('te-search').addEventListener('input', paint);
  paint();
}

// The lists and kids a Piazza HQ tile can point at come from the server; fill the boxes once they arrive (they show the saved choice meanwhile).
async function teFillCardOptions() {
  const boxes = [...document.querySelectorAll('select.te-co')].filter((b) => b.dataset.type !== 'choice'); if (!boxes.length) return;
  window._teCardData = window._teCardData || {};
  for (const b of boxes) {
    const type = b.dataset.type, id = b.closest('.te-row') ? b.closest('.te-row').dataset.id : '';
    const t = TE.layout.pages[TE.page].tiles.find((x) => x.id === id), cur = String(t && t.card_config ? t.card_config[b.dataset.co] || '' : '');
    const src = TM_OPTION_SOURCES[type]; if (!src) continue;
    const lists = [];
    for (const url of src.urls) { if (!window._teCardData[url]) window._teCardData[url] = await apiFetch(url).catch(() => []); lists.push(Array.isArray(window._teCardData[url]) ? window._teCardData[url] : []); }
    if (!b.isConnected) continue;
    b.innerHTML = tmOptionRows(type, lists).map(([v, l]) => '<option value="' + escapeHtml(v) + '"' + (v === cur ? ' selected' : '') + '>' + escapeHtml(l) + '</option>').join('');
  }
}

// A scene or script tile that is to switch with something else becomes a tile that takes turns (the first press is what it ran); the person fills in the next ones. Nothing changes
// unless they finish with Done.
async function teSwitchWith(t, change) {
  const name = ((await teEntities()).find((e) => e.entity_id === t.ref) || {}).friendly_name || '';
  const draft = tmSwitchWithDraft(t, name);
  await teRoutineEditor(draft, async () => { Object.assign(t, draft); tmStripUnlock(t); await change(); });
}
