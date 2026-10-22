// Rotating widgets (SWITCHER-PLAN.md): ordinary widgets stacked in the same space and marked with a shared rotGroup. The wall shows one at a time and moves to the next on a
// timer. Every member is a full normal widget, so nothing else in the display needs to know about this: renderLayout() calls applyRotations() once the widgets are in the page,
// which hides all but the current member (a class, never removing it, so a web page or a map keeps living) and puts the dots (or, in Live Edit, the "2 / 3" stepper) on top.
//   rotGroup      a short id shared by the members            rotOrder    the member's place (0, 1, 2...)
//   rotEvery      seconds each member shows (same on all)      rotSeconds  this member's own time (optional)
//   rotFx         'fade' | 'slide' | 'none' (same on all)      rotSkipEmpty  false = show members that have nothing to show too (same on all; default true)
// A group with one member is just a widget. Live Edit: the rotation stops, one member shows with a stepper, and a move or a resize applies to every member.
const ROT_DEFAULT_SECONDS = 15, ROT_MIN_SECONDS = 3, ROT_MAX_SECONDS = 600, ROT_PAUSE_MS = 60000;
const rotSyncRun = { since: Date.now(), pausedUntil: 0 };   // the one clock that rotations marked "change at the same time" share
const rotRun = new Map();                                   // group id -> { idx, since, pausedUntil }; kept across redraws so the rotation does not start over

// What "nothing to show right now" looks like in each widget's own markup. A type that is not here is never skipped.
const ROT_EMPTY = {
  today: (el) => !!el.querySelector('.no-data'),
  agenda: (el) => !!el.querySelector('.no-data'),
  upcoming: (el) => !!el.querySelector('.no-data'),
  todo: (el) => !!el.querySelector('.no-data'),
  shoppinglist: (el) => !!el.querySelector('.no-data'),
  tasks: (el) => !!el.querySelector('.no-data'),
  tasksCombined: (el) => !!el.querySelector('.no-data'),
  recipe: (el) => !!el.querySelector('.rcw-empty'),
  kiddrawing: (el) => !!el.querySelector('.kd-empty'),
  mealplan: (el) => !!el.querySelector('.mp-hint'),
  messageboard: (el) => { const l = el.querySelector('.mb-list'); return !!l && !l.children.length; },
};

function rotGroups() {                                      // group id -> its members in order (only groups of two or more)
  const g = new Map();
  for (const w of state.layout || []) {
    if (!w || !w.rotGroup) continue;
    if (!g.has(w.rotGroup)) g.set(w.rotGroup, []);
    g.get(w.rotGroup).push(w);
  }
  for (const [id, list] of [...g]) { if (list.length < 2) g.delete(id); else list.sort((a, b) => (a.rotOrder || 0) - (b.rotOrder || 0)); }
  return g;
}
const rotEl = (w) => document.querySelector('#canvas .widget[data-widget-id="' + CSS.escape(String(w.id)) + '"]');
function rotSecondsOf(w, list) {
  const own = Number(w.rotSeconds);
  if (own >= ROT_MIN_SECONDS) return Math.min(ROT_MAX_SECONDS, own);
  const every = Number(list[0].rotEvery);
  return every >= ROT_MIN_SECONDS ? Math.min(ROT_MAX_SECONDS, every) : ROT_DEFAULT_SECONDS;
}
function rotIsEmpty(w) {
  const test = ROT_EMPTY[w.type], el = rotEl(w);
  return !!(test && el && test(el));
}
// A member can have a schedule: rotFrom / rotTo ("HH:MM", either may be left out; from later than to means overnight) and rotDays (0 = Sunday ... 6; none = every day).
// Outside its window it is passed over like a widget with nothing to show; if no member is in its window, the space is empty until one is. Live Edit ignores schedules.
const rotDayName = (d) => new Date(2024, 0, 7 + d).toLocaleDateString(undefined, { weekday: 'short' });   // 0 = Sunday, in the viewer's language
function rotMinutes(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Math.min(1439, (+m[1]) * 60 + (+m[2])) : null; }
function rotAvail(w) {
  if (editModeActive) return true;
  const from = rotMinutes(w.rotFrom), to = rotMinutes(w.rotTo);
  const d = new Date(), cur = d.getHours() * 60 + d.getMinutes();
  let day = d.getDay();
  if (from !== null && to !== null && from !== to) {
    if (from < to) { if (cur < from || cur >= to) return false; }
    else { if (cur < from && cur >= to) return false; if (cur < to) day = (day + 6) % 7; }   // overnight: after midnight it is still last night's window
  } else if (from !== null && to === null) { if (cur < from) return false; }
  else if (to !== null && from === null) { if (cur >= to) return false; }
  if (Array.isArray(w.rotDays) && w.rotDays.length && w.rotDays.length < 7 && !w.rotDays.includes(day)) return false;
  return true;
}
const rotIsSynced = (id) => { const l = rotGroups().get(id); return !!l && l[0].rotSync === true; };
function rotRunOf(id) {
  let r = rotRun.get(id);
  if (!r) { r = { idx: 0, since: Date.now(), pausedUntil: 0 }; rotRun.set(id, r); }
  return r;
}
// the member after (dir 1) or before (dir -1) `from`; with skipEmpty, members with nothing to show are passed over (if all are empty, `from` stays)
function rotNext(list, from, dir, skipEmpty) {
  const n = list.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (rotAvail(list[i]) && (!skipEmpty || !rotIsEmpty(list[i]))) return i;
  }
  return from;
}

function applyRotations() {
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
  canvas.querySelectorAll('.rot-dots, .rot-edit').forEach((n) => n.remove());
  const groups = rotGroups();
  for (const id of [...rotRun.keys()]) if (!groups.has(id)) rotRun.delete(id);
  groups.forEach((list, id) => {
    const run = rotRunOf(id);
    if (run.idx >= list.length) run.idx = 0;
    const none = !list.some((m) => rotAvail(m));                            // nobody is in their window: the space stays empty
    if (!none && !rotAvail(list[run.idx])) run.idx = rotNext(list, run.idx, 1, false);
    if (!editModeActive && list[0].rotSkipEmpty !== false && rotIsEmpty(list[run.idx])) run.idx = rotNext(list, run.idx, 1, true);       // never open on an empty one
    list.forEach((m, i) => {
      const el = rotEl(m);
      if (!el) return;
      el.dataset.rot = id; el.dataset.rotfx = list[0].rotFx === 'slide' ? 'slide' : list[0].rotFx === 'none' ? 'none' : 'fade';
      el.classList.toggle('rot-off', none || i !== run.idx);
    });
    if (!none) drawRotControls(id, list, run);
  });
  rotPauseHidden();
}
// A member that is not on show stays in the page (so a web page keeps its place) but should not keep working: its camera disconnects, its radar stops animating, its
// flight map stops refreshing and its web page stops reloading. When it comes back it picks up again (the camera reconnects, the map and the page refresh at once).
function rotHidden(id) {
  const el = document.querySelector('#canvas .widget[data-widget-id="' + CSS.escape(String(id)) + '"]');
  return !!el && el.classList.contains('rot-off');
}
function rotPauseHidden() {
  document.querySelectorAll('#canvas .widget').forEach((el) => {
    const off = el.classList.contains('rot-off');
    if (off === !!el._rotOff) return;                       // nothing changed for this one since the last pass
    el._rotOff = off;
    el.querySelectorAll('video-stream').forEach((v) => {
      try { if (off) v.ondisconnect(); else v.onconnect(); } catch {}
    });
    if (!off) {
      const frame = el.querySelector('.wp-frame');
      if (frame && frame._wpStale) { frame._wpStale = false; try { frame.src = frame.src; } catch {} }
      if (el.querySelector('.w-flightmap') && typeof fetchFlightmap === 'function') fetchFlightmap(false);
    }
  });
}
function drawRotControls(id, list, run) {
  const cur = rotEl(list[run.idx]);
  const canvas = document.getElementById('canvas');
  if (!cur || !canvas) return;
  const box = document.createElement('div');
  box.dataset.rotGroup = id; box.setAttribute('data-interactive', '1');
  box.style.cssText = 'left:' + cur.style.left + ';top:' + cur.style.top + ';width:' + cur.style.width + ';height:' + cur.style.height + ';z-index:' + ((parseInt(cur.style.zIndex, 10) || 0) + 1000);
  if (editModeActive) {
    box.className = 'rot-edit';
    box.innerHTML = '<button type="button" data-dir="-1" aria-label="Previous">‹</button><span>' + (run.idx + 1) + ' / ' + list.length + '</span><button type="button" data-dir="1" aria-label="Next">›</button>';
  } else {
    box.className = 'rot-dots';
    box.innerHTML = '<div class="rot-dots-row">' + list.map((m, i) => rotAvail(m) ? '<button type="button" data-i="' + i + '" class="' + (i === run.idx ? 'on' : '') + '"></button>' : '').join('') + '</div>';
    const dots = box.querySelectorAll('button[data-i]');
    if (dots.length < 2) return;                                                  // one widget in its window: nothing to move between
    dots.forEach((b, i) => b.setAttribute('aria-label', (i + 1) + ' / ' + dots.length));
  }
  canvas.appendChild(box);
}
function rotGo(id, idx, manual) {
  const list = rotGroups().get(id);
  if (!list) return;
  const run = rotRunOf(id);
  run.idx = Math.max(0, Math.min(list.length - 1, idx)); run.since = Date.now();
  if (manual) { run.pausedUntil = Date.now() + ROT_PAUSE_MS; if (list[0].rotSync === true) rotSyncRun.pausedUntil = run.pausedUntil; }
  applyRotations();
}
function rotStep(id, dir, manual) {
  const list = rotGroups().get(id);
  if (!list) return;
  const run = rotRunOf(id);
  rotGo(id, rotNext(list, run.idx, dir, !editModeActive && list[0].rotSkipEmpty !== false), manual);
}
// a move or a resize of one member applies to all of them, so they always share the same space
function rotSyncGeometry(w) {
  if (!w || !w.rotGroup) return;
  const list = rotGroups().get(w.rotGroup);
  if (!list) return;
  const W = effectiveWidth(), H = effectiveHeight();
  for (const m of list) {
    if (m === w) continue;
    m.x = w.x; m.y = w.y; m.w = w.w; m.h = w.h; if (w.z !== undefined) m.z = w.z;
    const el = rotEl(m);
    if (el) { el.style.left = (m.x / 100 * W) + 'px'; el.style.top = (m.y / 100 * H) + 'px'; el.style.width = (m.w / 100 * W) + 'px'; el.style.height = (m.h / 100 * H) + 'px'; if (m.z !== undefined) el.style.zIndex = m.z; }
  }
  applyRotations();
}

// ── the clock, the dots, the swipe ────────────────────────────────────────────────────────────────────
let rotSig = '';
setInterval(() => {
  if (editModeActive) return;                               // Live Edit: the rotation stands still
  const now = Date.now();
  let changed = false;
  const synced = [];
  rotGroups().forEach((list, id) => {
    const run = rotRunOf(id);
    if (list[0].rotSync === true) { synced.push([id, list, run]); return; }       // these move together, below
    if (now < run.pausedUntil) return;
    if (run.idx >= list.length) run.idx = 0;
    const skip = list[0].rotSkipEmpty !== false, cur = list[run.idx];
    const due = now - run.since >= rotSecondsOf(cur, list) * 1000, curEmpty = (skip && rotIsEmpty(cur)) || !rotAvail(cur);
    if (!due && !curEmpty) return;
    const j = rotNext(list, run.idx, 1, skip);
    run.since = now;
    if (j !== run.idx) { run.idx = j; changed = true; }
  });
  if (synced.length && now >= rotSyncRun.pausedUntil) {
    // rotations set to change at the same time share one beat: the shortest time any of them is showing its current widget for
    const beat = Math.min(...synced.map(([, list, run]) => rotSecondsOf(list[run.idx < list.length ? run.idx : 0], list)));
    const due = now - rotSyncRun.since >= beat * 1000;
    synced.forEach(([, list, run]) => {
      if (run.idx >= list.length) run.idx = 0;
      const skip = list[0].rotSkipEmpty !== false, curEmpty = (skip && rotIsEmpty(list[run.idx])) || !rotAvail(list[run.idx]);
      if (!due && !curEmpty) return;
      const j = rotNext(list, run.idx, 1, skip);
      run.since = now;
      if (j !== run.idx) { run.idx = j; changed = true; }
    });
    if (due) rotSyncRun.since = now;
  }
  const sig = [...rotGroups().values()].flat().map((m) => (rotAvail(m) ? 1 : 0)).join('');   // a window opened or closed
  if (sig !== rotSig) { rotSig = sig; changed = true; }
  if (changed) applyRotations();
}, 1000);

(function wireRotationTouch() {
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
  canvas.addEventListener('click', (e) => {
    const dot = e.target.closest && e.target.closest('.rot-dots button[data-i]');
    if (dot) { e.stopPropagation(); rotGo(dot.closest('.rot-dots').dataset.rotGroup, Number(dot.dataset.i), true); return; }
    const arrow = e.target.closest && e.target.closest('.rot-edit button[data-dir]');
    if (arrow) { e.stopPropagation(); rotStep(arrow.closest('.rot-edit').dataset.rotGroup, Number(arrow.dataset.dir), false); }
  });
  let swipe = null;
  canvas.addEventListener('pointerdown', (e) => {
    swipe = null;
    if (editModeActive) return;
    const wEl = e.target.closest && e.target.closest('.widget[data-rot]');
    if (!wEl) return;
    rotRunOf(wEl.dataset.rot).pausedUntil = Date.now() + ROT_PAUSE_MS;      // someone is looking at it: do not move on for a minute
    if (rotIsSynced(wEl.dataset.rot)) rotSyncRun.pausedUntil = Date.now() + ROT_PAUSE_MS;   // (and the rotations that move with it wait too)
    if (e.target.closest('[data-interactive], button, input, select, textarea, a')) return;   // a swipe on a widget's own controls is theirs
    swipe = { id: wEl.dataset.rot, x: e.clientX, y: e.clientY, t: Date.now(), pid: e.pointerId };
  });
  canvas.addEventListener('pointerup', (e) => {
    const s = swipe; swipe = null;
    if (!s || e.pointerId !== s.pid) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 45 && Date.now() - s.t < 700) rotStep(s.id, dx < 0 ? 1 : -1, true);
  });
})();

// ── Live Edit: the Rotation panel (opened from the widget's settings bar) ────────────────────────────────
function rotWidgetName(w) {
  const def = (typeof WIDGET_DEFS !== 'undefined' ? WIDGET_DEFS : []).find((d) => d.type === w.type);
  const base = def ? def.label : w.type;
  const cfg = typeof WIDGET_BASIC_SETTINGS !== 'undefined' ? WIDGET_BASIC_SETTINGS[w.type] : null;
  const title = cfg && cfg.titleField ? w[cfg.titleField] : '';
  if (title) return base + ' - ' + title;
  const same = (state.layout || []).filter((x) => x.type === w.type);
  return same.length > 1 ? base + ' (' + (same.indexOf(w) + 1) + ')' : base;
}
const ROT_FIELDS = ['rotGroup', 'rotOrder', 'rotEvery', 'rotFx', 'rotSkipEmpty', 'rotSync', 'rotSeconds', 'rotFrom', 'rotTo', 'rotDays'];
function rotClear(w) { for (const f of ROT_FIELDS) delete w[f]; }
function rotRenumber(list) { list.forEach((m, i) => { m.rotOrder = i; }); }
// put w into target's rotation (a new one if target had none): same space, same size, last in the order, and the one on show
function rotJoin(w, target) {
  if (!w || !target || w === target) return;
  if (w.rotGroup) rotLeave(w, true);
  let gid = target.rotGroup;
  if (!gid || !rotGroups().has(gid)) {
    gid = 'rg_' + Math.random().toString(36).slice(2, 6);
    rotClear(target);
    target.rotGroup = gid; target.rotOrder = 0; target.rotEvery = ROT_DEFAULT_SECONDS; target.rotFx = 'fade'; target.rotSkipEmpty = true;
  }
  const members = (state.layout || []).filter((m) => m.rotGroup === gid);
  w.rotGroup = gid; w.rotOrder = members.length; w.rotEvery = target.rotEvery; w.rotFx = target.rotFx; w.rotSkipEmpty = target.rotSkipEmpty; if (target.rotSync === true) w.rotSync = true; else delete w.rotSync;
  delete w.rotSeconds;
  w.x = target.x; w.y = target.y; w.w = target.w; w.h = target.h; if (target.z !== undefined) w.z = target.z;
  const list = rotGroups().get(gid);
  if (list) rotRunOf(gid).idx = list.indexOf(w);
}
function rotLeave(w, quiet) {                               // takes w out of its rotation; it keeps its place, nudged so it is not hidden under the others
  const gid = w.rotGroup;
  rotClear(w);
  const rest = (state.layout || []).filter((m) => m.rotGroup === gid);
  rotRenumber(rest.sort((a, b) => (a.rotOrder || 0) - (b.rotOrder || 0)));
  if (rest.length === 1) rotClear(rest[0]);
  if (!quiet) { w.x = Math.min(100 - w.w, w.x + 3); w.y = Math.min(100 - w.h, w.y + 3); }
}
function rotCommit(reopenId) {
  renderLayout();
  saveLayoutNow();
  if (reopenId !== undefined) openRotationPanel(reopenId);
}
function openRotationPanel(id) {
  const w = (state.layout || []).find((x) => String(x.id) === String(id));
  const panel = document.getElementById('widget-advanced-panel'), body = document.getElementById('widget-advanced-body'), title = document.getElementById('widget-advanced-title');
  if (!w || !panel || !body) return;
  const wasOpen = panel.style.display === 'flex', saved = wasOpen ? body.scrollTop : 0;
  title.textContent = 'Rotation';
  panel.style.display = 'flex';
  const list = w.rotGroup ? rotGroups().get(w.rotGroup) : null;
  const others = (state.layout || []).filter((x) => x !== w && !(list && list.includes(x)));
  const options = (extra) => '<option value="">' + extra + '</option>' + others.map((x) => '<option value="' + escapeHtmlD(String(x.id)) + '">' + escapeHtmlD(rotWidgetName(x)) + (x.rotGroup ? ' (in a rotation)' : '') + '</option>').join('');
  let html = '';
  if (!list) {
    html += '<p class="was-hint">Show this widget and other widgets one at a time in the same space, changing every few seconds. Pick a widget to rotate with: this one moves into its space and size.</p>'
      + '<div class="was-row"><label>Rotate with</label><select class="form-input" id="rot-with">' + options('Choose a widget…') + '</select></div>';
  } else {
    const rows = list.map((m, i) => '<div class="rot-member" data-id="' + escapeHtmlD(String(m.id)) + '"><span class="rot-member-name">' + (i + 1) + '. ' + escapeHtmlD(rotWidgetName(m)) + (m === w ? ' <em>(this one)</em>' : '') + '</span>'
      + '<button type="button" class="rot-up" aria-label="Earlier"' + (i === 0 ? ' disabled' : '') + '>▲</button><button type="button" class="rot-down" aria-label="Later"' + (i === list.length - 1 ? ' disabled' : '') + '>▼</button></div>').join('');
    const fx = list[0].rotFx === 'slide' || list[0].rotFx === 'none' ? list[0].rotFx : 'fade';
    html += '<div class="was-section-label">In this rotation</div>' + rows
      + '<div class="was-row"><label>Seconds each</label><input class="form-input" id="rot-every" type="number" min="' + ROT_MIN_SECONDS + '" max="' + ROT_MAX_SECONDS + '" value="' + (Number(list[0].rotEvery) || ROT_DEFAULT_SECONDS) + '"></div>'
      + '<div class="was-row"><label>Effect</label><select class="form-input" id="rot-fx"><option value="fade"' + (fx === 'fade' ? ' selected' : '') + '>Fade</option><option value="slide"' + (fx === 'slide' ? ' selected' : '') + '>Slide</option><option value="none"' + (fx === 'none' ? ' selected' : '') + '>None</option></select></div>'
      + '<div class="was-toggle-row"><label>Skip ones with nothing to show</label><input type="checkbox" id="rot-skip"' + (list[0].rotSkipEmpty === false ? '' : ' checked') + '></div>'
      + (rotGroups().size > 1 ? '<div class="was-toggle-row"><label>Change at the same time as my other rotations</label><input type="checkbox" id="rot-sync"' + (list[0].rotSync === true ? ' checked' : '') + '></div><p class="was-hint" id="rot-sync-note">It only changes at the same time as other rotations that have this box ticked too.</p>' : '')
      + '<div class="was-section-label">This widget</div>'
      + '<div class="was-row"><label>Show this one for (seconds)</label><input class="form-input" id="rot-own" type="number" min="' + ROT_MIN_SECONDS + '" max="' + ROT_MAX_SECONDS + '" placeholder="Same as the others" value="' + (Number(w.rotSeconds) >= ROT_MIN_SECONDS ? Number(w.rotSeconds) : '') + '"></div>'
      + '<div class="was-section-label">Schedule</div>'
      + '<div class="was-row"><label>Show only from</label><input class="form-input" id="rot-from" type="time" value="' + escapeHtmlD(w.rotFrom || '') + '"></div>'
      + '<div class="was-row"><label>until</label><input class="form-input" id="rot-to" type="time" value="' + escapeHtmlD(w.rotTo || '') + '"></div>'
      + '<div class="was-row"><label>On these days</label><div class="rot-days">' + [0, 1, 2, 3, 4, 5, 6].map((d) => '<button type="button" class="rot-day' + ((Array.isArray(w.rotDays) && w.rotDays.length && w.rotDays.includes(d)) ? ' on' : '') + '" data-d="' + d + '">' + rotDayName(d) + '</button>').join('') + '</div></div>'
      + '<div class="was-row"><button type="button" class="rot-out" id="rot-out">Take this one out of the rotation</button></div>'
      + (others.length ? '<div class="was-section-label">Add another</div><div class="was-row"><label>Rotate this space with</label><select class="form-input" id="rot-add">' + options('Choose a widget…') + '</select></div>' : '');
  }
  body.innerHTML = html;
  if (wasOpen) body.scrollTop = saved;
  const closeBtn = document.getElementById('widget-advanced-close');                      // the close button is wired by the other advanced panels the first time they open
  if (closeBtn && !closeBtn._wired) { closeBtn._wired = true; closeBtn.addEventListener('click', closeWidgetAdvancedPanel); }
  const byId = (v) => (state.layout || []).find((x) => String(x.id) === String(v));
  const joinPick = (sel, intoThis) => { if (!sel) return; sel.addEventListener('change', () => {
    const other = byId(sel.value);
    if (!other) return;
    if (intoThis) rotJoin(other, w); else rotJoin(w, other);          // "Add another": it moves into this one's space; "Rotate with": this one moves into the other's
    rotCommit(w.id);
  }); };
  joinPick(document.getElementById('rot-with'), false);
  joinPick(document.getElementById('rot-add'), true);
  const setAll = (field, value) => { const l = rotGroups().get(w.rotGroup) || []; l.forEach((m) => { if (value === undefined) delete m[field]; else m[field] = value; }); rotCommit(w.id); };
  const every = document.getElementById('rot-every'), fxSel = document.getElementById('rot-fx'), skip = document.getElementById('rot-skip'), own = document.getElementById('rot-own'), out = document.getElementById('rot-out');
  if (every) every.addEventListener('change', () => setAll('rotEvery', Math.max(ROT_MIN_SECONDS, Math.min(ROT_MAX_SECONDS, parseInt(every.value, 10) || ROT_DEFAULT_SECONDS))));
  if (fxSel) fxSel.addEventListener('change', () => setAll('rotFx', fxSel.value));
  if (skip) skip.addEventListener('change', () => setAll('rotSkipEmpty', skip.checked));
  const syncBox = document.getElementById('rot-sync');
  if (syncBox) syncBox.addEventListener('change', () => { setAll('rotSync', syncBox.checked ? true : undefined); });
  const schedule = (field, value) => { if (value) w[field] = value; else delete w[field]; rotCommit(w.id); };
  const fromIn = document.getElementById('rot-from'), toIn = document.getElementById('rot-to');
  if (fromIn) fromIn.addEventListener('change', () => schedule('rotFrom', fromIn.value));
  if (toIn) toIn.addEventListener('change', () => schedule('rotTo', toIn.value));
  body.querySelectorAll('.rot-day').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.d), cur = Array.isArray(w.rotDays) ? w.rotDays.slice() : [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : cur.concat(d).sort();
    schedule('rotDays', next.length ? next : '');
  }));
  if (own) own.addEventListener('change', () => { const v = parseInt(own.value, 10); if (v >= ROT_MIN_SECONDS) w.rotSeconds = Math.min(ROT_MAX_SECONDS, v); else delete w.rotSeconds; rotCommit(w.id); });
  if (out) out.addEventListener('click', () => { rotLeave(w); rotCommit(w.id); });
  body.querySelectorAll('.rot-member').forEach((row) => {
    const m = byId(row.dataset.id), l = rotGroups().get(w.rotGroup);
    const move = (d) => { if (!l) return; const i = l.indexOf(m), j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; rotRenumber(l); rotCommit(w.id); };
    const up = row.querySelector('.rot-up'), down = row.querySelector('.rot-down');
    if (up) up.addEventListener('click', () => move(-1));
    if (down) down.addEventListener('click', () => move(1));
  });
}
