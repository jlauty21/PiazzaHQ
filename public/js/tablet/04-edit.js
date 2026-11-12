// The /tablet web app, part 4: changing the layout on the tablet itself. Press and hold the clock (or the bottom bar), or choose "Rearrange tiles" in any tile's long-press sheet.
// Two gestures stay apart: press and drag a tile to MOVE it (the corner handle resizes it); a quick TAP selects it and opens its options in a side panel (05-panel.js). The bar at the top
// adds a tile, edits the pages and the tablet's own settings (06-sheets.js), and says Done. Faint "+" cells in the free spots add a tile right there.
// A move that would land on another tile or off the grid snaps back. Every change is saved at once, one save at a time, and a save that finds the layout changed somewhere else reloads it.
// When the household has a PIN (and the tablet is set to ask, which is the default) the PIN pad comes first. It leaves by itself after 90 seconds without a touch.
// Dragging needs the tablet sideways (a portrait tablet lays tiles out in reading order, so there is no place to drag to); options, add, remove, pages and settings work either way.
'use strict';
const TB_EDIT_IDLE_MS = 90 * 1000;
const tbPortrait = () => window.innerHeight > window.innerWidth;
const tbPage = () => TB.layout.pages[TB.page] || TB.layout.pages[0];

// How far one grid column and one grid row are from the next, in screen pixels (the cell plus the gap).
function tbStepSize(grid) {
  const cs = getComputedStyle(grid), r = grid.getBoundingClientRect(), { cols, rows } = TB.layout.grid;
  const px = (v) => parseFloat(v) || 0;
  const colGap = px(cs.columnGap), rowGap = px(cs.rowGap) || colGap;
  const w = r.width - px(cs.paddingLeft) - px(cs.paddingRight), h = r.height - px(cs.paddingTop) - px(cs.paddingBottom);
  return { sx: (w - colGap * (cols - 1)) / cols + colGap, sy: (h - rowGap * (rows - 1)) / rows + rowGap };
}

// A centered sheet over the page. Returns { box, close }; `wide` for the bigger ones (lists, settings).
function tbSheet(html, wide) {
  const box = document.createElement('div');
  box.className = 'tb-overlay';
  box.innerHTML = `<div class="tb-sheet${wide ? ' wide' : ''}" role="dialog">${html}</div>`;
  tbEl('tb-overlays').appendChild(box);
  const close = () => box.remove();
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  return { box, close };
}

async function tbStartEdit() {
  if (TB.preview || TB.edit || !TB.layout) return;
  const tip = tbEl('tb-starthint'); if (tip) tip.remove();             // the tip about getting here is not needed any more
  if (TB.pinSet && TB.layout.edit_pin !== false) {                  // this tablet has a PIN (its own, or the household's): ask for it before changing anything
    for (;;) {
      const pin = await tbPinPad('Rearrange tiles', 'Enter the PIN to change this layout');
      if (pin === null) return;
      const r = await tbApi(`/api/tablets/${encodeURIComponent(TB.id)}/verify-pin`, { method: 'POST', body: JSON.stringify({ pin }) });
      if (tbOk(r)) break;
      tbToast(r && r.__networkError ? 'Could not reach the home hub.' : (r && r.error) || 'That PIN is not right.');
    }
  }
  const bar = document.createElement('div');
  bar.className = 'tb-editbar'; bar.id = 'tb-editbar';
  bar.innerHTML = `<span class="tb-editmsg"><b>Rearranging</b><span id="tb-edithint"></span></span>
    <span class="tb-editbtns"><button type="button" class="tb-btn" id="tb-ed-add">＋ Add tile</button><button type="button" class="tb-btn" id="tb-ed-pages">Pages</button><button type="button" class="tb-btn" id="tb-ed-set">Settings</button><button type="button" class="tb-btn" id="tb-editdone">Done</button></span>`;
  tbEl('tb-app').insertBefore(bar, tbEl('tb-head'));
  bar.querySelector('#tb-editdone').addEventListener('click', tbStopEdit);
  bar.querySelector('#tb-ed-add').addEventListener('click', () => tbAddTile());
  bar.querySelector('#tb-ed-pages').addEventListener('click', tbPagesSheet);
  bar.querySelector('#tb-ed-set').addEventListener('click', tbSettingsSheet);
  const grid = tbEl('tb-grid');
  grid.addEventListener('pointerdown', tbEditDown, true);
  grid.addEventListener('click', tbEditClick);
  document.addEventListener('pointerdown', tbEditTouched, true);
  TB.edit = { drag: false, last: Date.now(), sel: '', timer: setInterval(() => { if (TB.edit.drag && Date.now() - TB.edit.last > 20000) TB.edit.drag = false; if (Date.now() - TB.edit.last > TB_EDIT_IDLE_MS && !TB.edit.drag) tbStopEdit(); }, 5000) };
  tbLastGrid = ''; tbRedraw(); tbLiveSync();                        // live tiles pause while the tablet is being edited
}
const tbEditTouched = () => { if (TB.edit) TB.edit.last = Date.now(); };

function tbStopEdit() {
  if (!TB.edit) return;
  clearInterval(TB.edit.timer);
  TB.edit = null; tbLiveSync();
  document.removeEventListener('pointerdown', tbEditTouched, true);
  tbPanelClose(true);
  document.querySelectorAll('#tb-overlays .tb-overlay[data-edit]').forEach((n) => n.remove());
  const snack = tbEl('tb-snack'); if (snack) snack.remove();
  const bar = tbEl('tb-editbar'); if (bar) bar.remove();
  const grid = tbEl('tb-grid'); if (grid) { grid.removeEventListener('pointerdown', tbEditDown, true); grid.removeEventListener('click', tbEditClick); grid.classList.remove('editing', 'movable'); delete grid.dataset.cells; }
  tbLastGrid = ''; tbRedraw();
}

// Called after each draw while editing: the grid looks "editable", every tile has its corner handle, the selected tile is ringed, and free cells offer a "+".
function tbEditDecorate() {
  const grid = tbEl('tb-grid'); if (!grid || !TB.edit) return;
  const portrait = tbPortrait();
  grid.classList.add('editing'); grid.classList.toggle('movable', !portrait);
  const hint = tbEl('tb-edithint');
  if (hint) hint.textContent = tbPhone() ? 'Drag the corner to resize a tile, the ☰ to move it. Tap a tile for its options.' : portrait ? 'Tap a tile for its options. Turn the tablet sideways to move or resize tiles.' : 'Drag a tile to move it. Drag its corner to resize it. Tap a tile for its options.';
  const { cols, rows } = TB.layout.grid, page = tbPage();
  grid.querySelectorAll('.tb-tile').forEach((el) => {
    el.classList.toggle('tb-sel', el.dataset.tile === TB.edit.sel);
    const g = el.querySelector('.tb-grip');
    if (tbPhone()) {                                                // a phone: a corner to resize (width and height snap to the phone's sizes) and a handle to move the tile in the phone order
      if (g) g.remove();
      if (!el.querySelector('.tb-pgrip')) { const n = document.createElement('span'); n.className = 'tb-pgrip'; n.setAttribute('aria-label', 'Resize'); el.appendChild(n); const m = document.createElement('span'); m.className = 'tb-pmove'; m.setAttribute('aria-label', 'Move'); m.textContent = '☰'; el.appendChild(m); }
      return;
    }
    if (portrait) { if (g) g.remove(); return; }
    if (!g) { const n = document.createElement('span'); n.className = 'tb-grip'; n.setAttribute('aria-hidden', 'true'); el.appendChild(n); }
  });
  // free cells (landscape only: a portrait page has no places)
  const sig = portrait ? 'p' : [cols, rows, TB.page, ...page.tiles.map((t) => `${t.x},${t.y},${t.w},${t.h}`)].join('|');
  if (grid.dataset.cells === sig) return;                           // (a redraw of the tiles clears this, see tbRedraw)
  grid.querySelectorAll('.tb-addcell').forEach((n) => n.remove());
  grid.dataset.cells = sig;
  if (portrait) return;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (page.tiles.some((t) => tmOverlap(t, { x, y, w: 1, h: 1 }))) continue;
    const c = document.createElement('button'); c.type = 'button'; c.className = 'tb-addcell'; c.dataset.x = x; c.dataset.y = y; c.setAttribute('aria-label', 'Add a tile here'); c.textContent = '＋';
    c.style.gridColumn = String(x + 1); c.style.gridRow = String(y + 1);
    grid.appendChild(c);
  }
}
function tbEditClick(e) {
  const c = e.target.closest('.tb-addcell'); if (!c || !TB.edit) return;
  tbAddTile({ x: Number(c.dataset.x), y: Number(c.dataset.y) });
}

// ── saving: one at a time, naming the version this tablet started from ───────────────────────────────────────────────────
let tbSaveChain = Promise.resolve();
function tbSaveLayout() {
  tbSaveChain = tbSaveChain.then(async () => {
    const r = await tbApi(`/api/tablets/${encodeURIComponent(TB.id)}/layout`, { method: 'PUT', body: JSON.stringify({ layout: TB.layout, base_version: TB.version }) });
    if (tbOk(r)) { if (r.version) TB.version = r.version; tbToast('Saved'); return true; }
    if (r && r.__status === 409) tbToast('This layout was changed somewhere else. The latest one is showing now.');
    else tbToast('Could not save that change');
    await tbEditReload();
    return false;
  });
  return tbSaveChain;
}
// Take the layout from the server again (after a refused or failed save), keeping what is open as far as it still exists.
async function tbEditReload() {
  const t = await tbApi('/api/tablets/' + encodeURIComponent(TB.id));
  if (!(tbOk(t) && t.layout)) return;
  tbApplyLayout(t.layout, t.version);
  if (TB.edit && TB.edit.sel && !tbTileById(TB.edit.sel)) tbPanelClose();
  tbLastGrid = ''; tbRedraw(); tbPanelRender();
}
// Apply a change that is already made to TB.layout: redraw at once, then save.
function tbEditCommit(opts) {
  if (opts && opts.theme) tbApplyLayout(TB.layout, TB.version);
  tbLastGrid = ''; tbRedraw();
  return tbSaveLayout();
}

// ── rearranging on a phone: drag the corner of a tile to size it, drag its handle to move it ───────────────────────────────────
// Sizing snaps to what a phone has: a third, a half or a whole row wide, and compact (one line), usual or tall. Moving puts the tile before or after the one it is dropped on, in the phone order. The tile follows the
// finger; the list scrolls by itself when the finger is near its top or bottom edge.
function tbPhoneDrag(e, el, tile, mode) {
  e.preventDefault(); e.stopPropagation();
  TB.edit.last = Date.now(); TB.edit.drag = true;
  const grid = tbEl('tb-grid'), page = tbPage(), pc = tbPhoneCols(), small = !!TB.layout.phone_small;
  const cs = getComputedStyle(grid), px = (v) => parseFloat(v) || 0, gap = px(cs.columnGap), rowGap = px(cs.rowGap) || gap;
  const unit = (grid.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight) - gap * 11) / 12 + gap, rowStep = 58 + rowGap;
  const was = tmPhoneBox(tile, small, 12 / pc), r0 = el.getBoundingClientRect();
  const WIDTHS = [4, 6, 12], simple = tmPhoneSimple(tile), inline = was.rows === 0;
  const level0 = tile.phone_h === 'compact' || was.compact ? 0 : tile.phone_h === 'tall' ? 2 : 1, cur = { span: was.span, level: level0 };       // (for a remote on the tile the height choice is how big its buttons are)
  let moved = false, target = null, after = false, px_ = e.clientX, py_ = e.clientY;
  try { el.setPointerCapture(e.pointerId); } catch { /* an old browser */ }
  const nearest = (v, list) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const clearDrop = () => grid.querySelectorAll('.tb-drop-before, .tb-drop-after').forEach((n) => n.classList.remove('tb-drop-before', 'tb-drop-after'));
  const scroller = setInterval(() => {                                                 // near the edge of the list: keep scrolling
    if (mode !== 'move' || !moved) return;
    const g = grid.getBoundingClientRect();
    if (py_ < g.top + 70) grid.scrollTop -= 14; else if (py_ > g.bottom - 70) grid.scrollTop += 14;
  }, 30);
  const move = (ev) => {
    px_ = ev.clientX; py_ = ev.clientY;
    const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
    if (!moved) return;
    if (mode === 'size') {
      cur.span = nearest((r0.width + dx + gap) / unit, WIDTHS);
      cur.level = Math.max(simple || inline ? 0 : 1, Math.min(2, level0 + Math.round(dy / rowStep)));
      const rows = inline ? 0 : cur.level === 0 ? 1 : cur.level === 2 ? Math.max(3, tile.h * 3) : Math.max(2, tile.h * 2);
      el.style.gridColumn = `span ${cur.span}`; el.style.gridRow = `span ${rows || 1}`;
      el.classList.toggle('pc', cur.level === 0 && !inline); el.classList.toggle('pn', cur.span <= 4);
      if (inline) { el.classList.toggle('rk-c', cur.level === 0); el.classList.toggle('rk-t', cur.level === 2); tbFitRemote(el); }
    } else {
      el.classList.add('dragging'); el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.pointerEvents = 'none';                                                 // so the tile under the finger can be found
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList && n.classList.contains('tb-tile') && n !== el);
      el.style.pointerEvents = '';
      clearDrop(); target = under || null;
      if (target) { const r = target.getBoundingClientRect(), midY = r.top + r.height / 2; after = Math.abs(ev.clientY - midY) > r.height / 4 ? ev.clientY > midY : ev.clientX > r.left + r.width / 2; target.classList.add(after ? 'tb-drop-after' : 'tb-drop-before'); }
    }
  };
  const up = async (ev) => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    clearInterval(scroller); clearDrop();
    el.classList.remove('dragging'); el.style.transform = '';
    if (TB.edit) { TB.edit.drag = false; TB.edit.last = Date.now(); }
    let changed = false;
    if (moved && ev.type === 'pointerup') {
      if (mode === 'size') {
        const width = { 4: 'third', 6: 'half', 12: 'full' }[cur.span], height = ['compact', 'normal', 'tall'][cur.level];
        if (cur.span !== was.span) { tile.phone = width; changed = true; }
        if (cur.level !== level0) { tile.phone_h = height; changed = true; }
      } else if (target && tmPhoneReorder(page, tile.id, target.dataset.tile, after)) changed = true;
    }
    if (changed) { tbFeedback('tap'); tbLastGrid = ''; tbRedraw(); tbPanelRender(); await tbEditCommit(); return; }
    tbLastGrid = ''; tbRedraw();
    if (!moved && ev.type === 'pointerup') tbSelectTile(tile.id);                      // a tap on the handle: just select it
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// ── press and drag ───────────────────────────────────────────────────────────────────────────────────────────────────────
function tbEditDown(e) {
  if (!TB.edit || TB.edit.drag || e.button) return;
  const el = e.target.closest('.tb-tile'); if (!el) return;
  const tile = tbTileById(el.dataset.tile); if (!tile) return;
  if (tbPhone()) { const h = e.target.closest('.tb-pgrip, .tb-pmove'); if (h) { tbPhoneDrag(e, el, tile, h.classList.contains('tb-pgrip') ? 'size' : 'move'); return; } }
  e.preventDefault(); e.stopPropagation();
  TB.edit.last = Date.now(); TB.edit.drag = true;
  const portrait = tbPortrait();
  const grid = tbEl('tb-grid'), { cols, rows } = TB.layout.grid, { sx, sy } = tbStepSize(grid);
  const others = tbPage().tiles.filter((o) => o !== tile);
  const resizing = !portrait && !!e.target.closest('.tb-grip');
  const was = { x: tile.x, y: tile.y, w: tile.w, h: tile.h }, cur = { ...was, ok: true };
  let moved = false, ghost = null;
  if (!portrait) { ghost = document.createElement('div'); ghost.className = 'tb-ghost'; grid.appendChild(ghost); }
  const showGhost = () => {
    if (!ghost) return;
    ghost.style.gridColumn = `${cur.x + 1} / span ${cur.w}`; ghost.style.gridRow = `${cur.y + 1} / span ${cur.h}`;
    ghost.classList.toggle('bad', !cur.ok);
  };
  showGhost();
  try { el.setPointerCapture(e.pointerId); } catch { /* an old browser */ }
  const move = (ev) => {
    const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 8) { if (!moved) el.classList.add('dragging'); moved = true; }
    if (portrait) return;
    if (resizing) {
      cur.w = Math.max(1, Math.min(cols - was.x, Math.round(was.w + dx / sx)));
      cur.h = Math.max(1, Math.min(rows - was.y, Math.round(was.h + dy / sy)));
    } else {
      cur.x = Math.max(0, Math.min(cols - was.w, Math.round(was.x + dx / sx)));
      cur.y = Math.max(0, Math.min(rows - was.h, Math.round(was.y + dy / sy)));
      if (moved) el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    cur.ok = !others.some((o) => tmOverlap(o, cur));
    showGhost();
  };
  const up = async (ev) => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    if (ghost) ghost.remove();
    el.classList.remove('dragging'); el.style.transform = '';
    if (TB.edit) { TB.edit.drag = false; TB.edit.last = Date.now(); }
    const changed = cur.x !== was.x || cur.y !== was.y || cur.w !== was.w || cur.h !== was.h;
    if (!moved && ev.type === 'pointerup') { tbSelectTile(tile.id); return; }          // a tap: select it and show its options
    if (ev.type === 'pointercancel' && portrait) return;                                // the browser took the touch to scroll the tiles: nothing to put back, and a redraw now would stop the scroll
    if (moved && !portrait && cur.ok && changed) {
      tile.x = cur.x; tile.y = cur.y; tile.w = cur.w; tile.h = cur.h;
      tbFeedback('tap');
      tbPanelRender();
      await tbEditCommit();
      return;
    }
    tbLastGrid = ''; tbRedraw();
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
