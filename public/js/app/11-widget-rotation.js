// Rotating widgets in the control app: widgets that share one space and take turns on the wall.
// A rotation is just widgets that carry the same rotGroup (see public/js/display/14-widget-rotation.js for how the wall plays it).
// The layout editor shows one box per rotation (the member being edited) with a "2 of 3" badge; the others wait behind it.
// Everything here edits the plain fields on the widgets; the layout API and the saved layouts carry them as they are.
const APP_ROT_DEFAULT_SECONDS = 15, APP_ROT_MIN_SECONDS = 3, APP_ROT_MAX_SECONDS = 600;
const APP_ROT_FIELDS = ['rotGroup', 'rotOrder', 'rotEvery', 'rotFx', 'rotSkipEmpty', 'rotSync', 'rotSeconds', 'rotFrom', 'rotTo', 'rotDays'];

function appRotClear(w) { for (const f of APP_ROT_FIELDS) delete w[f]; }
function appRotMembers(gid) {
  return layoutWidgets.filter((m) => m.rotGroup === gid).sort((a, b) => (a.rotOrder || 0) - (b.rotOrder || 0));
}
function appRotRenumber(list) { list.forEach((m, i) => { m.rotOrder = i; }); }

// The member shown in the editor for each rotation: the selected one if it belongs to the rotation, else the first.
function appRotFront(gid) {
  const list = appRotMembers(gid);
  return list.find((m) => m.id === selectedId) || list[0] || null;
}
function appRotIsFront(w) {
  if (!w.rotGroup) return true;
  const f = appRotFront(w.rotGroup);
  return !f || f === w || appRotMembers(w.rotGroup).length < 2;
}

// Keeps the data tidy before every redraw and save: a rotation of one is just a widget, the order is 0..n-1,
// and every member sits in the same space with the same timing as the one being edited.
function appRotNormalize() {
  const groups = new Map();
  for (const w of layoutWidgets) if (w.rotGroup) { if (!groups.has(w.rotGroup)) groups.set(w.rotGroup, []); groups.get(w.rotGroup).push(w); }
  for (const [gid, raw] of groups) {
    if (raw.length < 2) { appRotClear(raw[0]); continue; }
    const list = appRotMembers(gid);
    appRotRenumber(list);
    const anchor = list.find((m) => m.id === selectedId) || list[0];
    for (const m of list) {
      if (m === anchor) continue;
      m.x = anchor.x; m.y = anchor.y; m.w = anchor.w; m.h = anchor.h;
      m.rotEvery = anchor.rotEvery; m.rotFx = anchor.rotFx; m.rotSkipEmpty = anchor.rotSkipEmpty;
      if (anchor.rotSync === true) m.rotSync = true; else delete m.rotSync;
    }
  }
}

// Called after a drag or resize so the other members follow right away.
function appRotSyncGeometry(w) {
  if (!w || !w.rotGroup) return;
  for (const m of appRotMembers(w.rotGroup)) if (m !== w) { m.x = w.x; m.y = w.y; m.w = w.w; m.h = w.h; }
}

// Puts w into target's rotation (a new one if target had none): same space, same size, last in the order.
function appRotJoin(w, target) {
  if (!w || !target || w === target) return;
  if (w.rotGroup) appRotLeave(w, true);
  let gid = target.rotGroup;
  if (!gid || appRotMembers(gid).length < 1) {
    gid = 'rg_' + Math.random().toString(36).slice(2, 6);
    appRotClear(target);
    target.rotGroup = gid; target.rotOrder = 0; target.rotEvery = APP_ROT_DEFAULT_SECONDS; target.rotFx = 'fade'; target.rotSkipEmpty = true;
  }
  const count = appRotMembers(gid).length;
  w.rotGroup = gid; w.rotOrder = count; w.rotEvery = target.rotEvery; w.rotFx = target.rotFx; w.rotSkipEmpty = target.rotSkipEmpty; if (target.rotSync === true) w.rotSync = true; else delete w.rotSync;
  delete w.rotSeconds;
  w.x = target.x; w.y = target.y; w.w = target.w; w.h = target.h;
}

// Takes w out of its rotation. It keeps its place, nudged so it is not hidden under the others.
function appRotLeave(w, quiet) {
  const gid = w.rotGroup;
  appRotClear(w);
  const rest = appRotMembers(gid);
  appRotRenumber(rest);
  if (rest.length === 1) appRotClear(rest[0]);
  if (!quiet) { w.x = Math.min(100 - w.w, w.x + 3); w.y = Math.min(100 - w.h, w.y + 3); }
}

const appRotDayName = (d) => new Date(2024, 0, 7 + d).toLocaleDateString(undefined, { weekday: 'short' });   // 0 = Sunday, in the viewer's language
function appRotName(w) {
  const def = WIDGET_DEFS.find((d) => d.type === w.type) || { icon: '?', label: w.type };
  let label = def.label;
  if (w.type === 'text' && (w.textContent || '').trim()) label = (w.textContent).trim().slice(0, 24);
  const same = layoutWidgets.filter((x) => x.type === w.type);
  if (same.length > 1 && !(w.type === 'text' && (w.textContent || '').trim())) label += ' (' + (same.indexOf(w) + 1) + ')';
  return def.icon + ' ' + label;
}
function appRotEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// The small "‹ 2 of 3 ›" on the box in the layout editor. Tapping an arrow selects the neighbor, which brings it to the front.
function appRotBadge(el, w) {
  if (!w.rotGroup) return;
  const list = appRotMembers(w.rotGroup);
  if (list.length < 2) return;
  const i = list.indexOf(w);
  const badge = document.createElement('div');
  badge.className = 'w-rot-badge';
  badge.innerHTML = '<button type="button" class="w-rot-prev"></button><span class="w-rot-count">🔄 ' + (i + 1) + '/' + list.length + '</span><button type="button" class="w-rot-next"></button>';
  const prev = badge.querySelector('.w-rot-prev'), next = badge.querySelector('.w-rot-next');
  prev.textContent = '‹'; next.textContent = '›';
  prev.setAttribute('aria-label', 'Previous'); next.setAttribute('aria-label', 'Next');
  const go = (d) => selectWidget(list[(i + d + list.length) % list.length].id);
  for (const [btn, d] of [[prev, -1], [next, 1]]) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); go(d); });
  }
  el.appendChild(badge);
}

// The "Rotation" card in the widget's settings panel.
function rotationSectionHtml(w) {
  const list = w.rotGroup ? appRotMembers(w.rotGroup) : [];
  const rotating = list.length > 1;
  const typeOpts = '<option value="">Choose a widget…</option>' + WIDGET_DEFS.map((d) => '<option value="' + appRotEsc(d.type) + '">' + appRotEsc(d.icon + ' ' + d.label) + '</option>').join('');
  let html = '<div class="settings-row" id="rot-section"><label>🔄 Rotation</label>'
    + '<div class="rot-hint">Show this widget and other widgets one at a time in the same space, changing every few seconds.</div>';
  if (rotating) {
    const rows = list.map((m, i) => '<div class="rot-member' + (m === w ? ' current' : '') + '" data-id="' + appRotEsc(m.id) + '"><button type="button" class="rot-member-name">' + (i + 1) + '. ' + appRotEsc(appRotName(m)) + '</button>'
      + '<button type="button" class="rot-up"' + (i === 0 ? ' disabled' : '') + '>▲</button><button type="button" class="rot-down"' + (i === list.length - 1 ? ' disabled' : '') + '>▼</button></div>').join('');
    const fx = list[0].rotFx === 'slide' || list[0].rotFx === 'none' ? list[0].rotFx : 'fade';
    html += '<div class="rot-sub">In this rotation</div>' + rows
      + '<div class="rot-line"><span>Seconds each</span><input class="form-input" id="app-rot-every" type="number" min="' + APP_ROT_MIN_SECONDS + '" max="' + APP_ROT_MAX_SECONDS + '" value="' + (Number(list[0].rotEvery) || APP_ROT_DEFAULT_SECONDS) + '"></div>'
      + '<div class="rot-line"><span>Effect</span><select class="form-input" id="app-rot-fx"><option value="fade"' + (fx === 'fade' ? ' selected' : '') + '>Fade</option><option value="slide"' + (fx === 'slide' ? ' selected' : '') + '>Slide</option><option value="none"' + (fx === 'none' ? ' selected' : '') + '>None</option></select></div>'
      + '<label class="rot-check"><span>Skip ones with nothing to show</span><input type="checkbox" id="app-rot-skip"' + (list[0].rotSkipEmpty === false ? '' : ' checked') + '></label>'
      + (new Set(layoutWidgets.filter((m) => m.rotGroup && m.rotGroup !== w.rotGroup).map((m) => m.rotGroup)).size ? '<label class="rot-check"><span>Change at the same time as my other rotations</span><input type="checkbox" id="app-rot-sync"' + (list[0].rotSync === true ? ' checked' : '') + '></label><div class="rot-hint" id="app-rot-sync-note">It only changes at the same time as other rotations that have this box ticked too.</div>' : '')
      + '<div class="rot-sub">This widget</div>'
      + '<div class="rot-line"><span>Show this one for (seconds)</span><input class="form-input" id="app-rot-own" type="number" min="' + APP_ROT_MIN_SECONDS + '" max="' + APP_ROT_MAX_SECONDS + '" value="' + (Number(w.rotSeconds) >= APP_ROT_MIN_SECONDS ? Number(w.rotSeconds) : '') + '"></div>'
      + '<div class="rot-sub">Schedule</div>'
      + '<div class="rot-line"><span>Show only from</span><input class="form-input" id="app-rot-from" type="time" value="' + appRotEsc(w.rotFrom || '') + '"></div>'
      + '<div class="rot-line"><span>until</span><input class="form-input" id="app-rot-to" type="time" value="' + appRotEsc(w.rotTo || '') + '"></div>'
      + '<div class="rot-line"><span>On these days</span></div><div class="rot-days">' + [0, 1, 2, 3, 4, 5, 6].map((d) => '<button type="button" class="rot-day' + ((Array.isArray(w.rotDays) && w.rotDays.includes(d)) ? ' on' : '') + '" data-d="' + d + '">' + appRotDayName(d) + '</button>').join('') + '</div>'
      + '<button type="button" class="icon-btn rot-out" id="app-rot-out">Take this one out of the rotation</button>';
  }
  html += '<div class="rot-sub">Add another</div><div class="rot-line"><select class="form-input" id="app-rot-new">' + typeOpts + '</select><button type="button" class="icon-btn" id="app-rot-new-btn">Add</button></div></div>';
  return html;
}

// Wires the card. Every change edits the widgets, then redraws the canvas and the panel.
function wireRotationSection(w) {
  const $r = (id) => document.getElementById(id);
  const commit = (selectId) => {
    if (selectId !== undefined) selectedId = selectId;
    appRotNormalize();
    rebuildCanvas(); renderLayerList(); drawWidgetSettingsPanel();
  };
  const byId = (v) => layoutWidgets.find((x) => String(x.id) === String(v));
  const members = () => (w.rotGroup ? appRotMembers(w.rotGroup) : []);
  const setAll = (field, value) => { snapshotLayout(); members().forEach((m) => { m[field] = value; }); commit(w.id); };
  const every = $r('app-rot-every'), fx = $r('app-rot-fx'), skip = $r('app-rot-skip'), own = $r('app-rot-own'), out = $r('app-rot-out');
  if (every) every.addEventListener('change', () => setAll('rotEvery', Math.max(APP_ROT_MIN_SECONDS, Math.min(APP_ROT_MAX_SECONDS, parseInt(every.value, 10) || APP_ROT_DEFAULT_SECONDS))));
  if (fx) fx.addEventListener('change', () => setAll('rotFx', fx.value));
  if (skip) skip.addEventListener('change', () => setAll('rotSkipEmpty', skip.checked));
  const syncBox = $r('app-rot-sync');
  if (syncBox) syncBox.addEventListener('change', () => { snapshotLayout(); members().forEach((m) => { if (syncBox.checked) m.rotSync = true; else delete m.rotSync; }); commit(w.id); });
  const schedule = (field, value) => { snapshotLayout(); if (value) w[field] = value; else delete w[field]; commit(w.id); };
  const fromIn = $r('app-rot-from'), toIn = $r('app-rot-to');
  if (fromIn) fromIn.addEventListener('change', () => schedule('rotFrom', fromIn.value));
  if (toIn) toIn.addEventListener('change', () => schedule('rotTo', toIn.value));
  document.querySelectorAll('#rot-section .rot-day').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.d), cur = Array.isArray(w.rotDays) ? w.rotDays.slice() : [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : cur.concat(d).sort();
    schedule('rotDays', next.length ? next : '');
  }));
  if (own) own.addEventListener('change', () => {
    snapshotLayout();
    const v = parseInt(own.value, 10);
    if (v >= APP_ROT_MIN_SECONDS) w.rotSeconds = Math.min(APP_ROT_MAX_SECONDS, v); else delete w.rotSeconds;
    commit(w.id);
  });
  if (out) out.addEventListener('click', () => { snapshotLayout(); appRotLeave(w); commit(w.id); });
  document.querySelectorAll('#rot-section .rot-member').forEach((row) => {
    const m = byId(row.dataset.id), l = members();
    const move = (d) => { const i = l.indexOf(m), j = i + d; if (j < 0 || j >= l.length) return; snapshotLayout(); [l[i], l[j]] = [l[j], l[i]]; appRotRenumber(l); commit(w.id); };
    row.querySelector('.rot-member-name').addEventListener('click', () => { if (m && m !== w) selectWidget(m.id); });
    row.querySelector('.rot-up').addEventListener('click', () => move(-1));
    row.querySelector('.rot-down').addEventListener('click', () => move(1));
  });
  const addBtn = $r('app-rot-new-btn'), addType = $r('app-rot-new');
  if (addBtn) addBtn.addEventListener('click', () => {
    const def = WIDGET_DEFS.find((d) => d.type === addType.value);
    if (!def) { showToast('Choose a widget to add'); return; }
    snapshotLayout();
    const nw = newWidgetOfType(def);
    layoutWidgets.push(nw);
    appRotJoin(nw, w);
    commit(nw.id);
    showToast(def.label + ' added to the rotation');
  });
}
