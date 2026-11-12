// Actions widget: the Actions tiles of one tablet (Layout, Tablet) as buttons on the wall display, so a TV can be turned on and switched to its input from the wall as well as from the tablet.
// The tiles stay on the tablet (one place to edit them); only tiles that need no PIN and have no lock in them are shown. A tap runs the tile through POST /api/tablet-actions/:id/run.
//   actTablet  the tablet whose tiles are shown      actFontPx  text size (default 16)      actTitle  heading (default none)
// What the buttons say comes from tmActionView / tmActionTap (js/shared/tablet-model.js), the same logic as the Favorites tab's Actions card.
const ACT_REFRESH_MS = 15000;
const ACT = { data: {}, ents: null, entsAt: 0, loading: {}, open: '', busy: {}, timer: null };

async function actLoad(tabletId, force) {
  const have = ACT.data[tabletId];
  if (ACT.loading[tabletId] || (!force && have && Date.now() - have.at < ACT_REFRESH_MS - 1000)) return;
  ACT.loading[tabletId] = true;
  try {
    const [res, ents] = await Promise.all([
      fetch('/api/tablet-actions/' + encodeURIComponent(tabletId)).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/ha/entities').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    if (Array.isArray(ents)) { ACT.ents = {}; ents.forEach((e) => { ACT.ents[e.entity_id] = e; }); ACT.entsAt = Date.now(); }
    ACT.data[tabletId] = { at: Date.now(), failed: !res, tiles: res && Array.isArray(res.tiles) ? res.tiles : [], state: (res && res.state) || {} };
  } finally { ACT.loading[tabletId] = false; }
  (state.layout || []).filter((w) => w && w.type === 'actions' && w.actTablet === tabletId).forEach((w) => { try { rerenderSingleWidget(w.id); } catch (e) { /* not on screen */ } });
}
function actEnsure() {
  const ids = [...new Set((state.layout || []).filter((w) => w && w.type === 'actions' && w.actTablet).map((w) => w.actTablet))];
  ids.forEach((id) => actLoad(id));
  if (!ACT.timer) ACT.timer = setInterval(() => { [...new Set((state.layout || []).filter((w) => w && w.type === 'actions' && w.actTablet).map((w) => w.actTablet))].forEach((id) => actLoad(id, true)); }, ACT_REFRESH_MS);
}

function renderActions(widget) {
  const w = widget || {};
  actEnsure();
  const fontPx = w.actFontPx || 16, title = (w.actTitle || '').trim();
  const style = '--act-font:calc(' + fontPx + 'px * var(--ui-scale,1))';
  const head = title ? '<div class="act-title">' + escapeHtmlD(title) + '</div>' : '';
  const wrap = (inner) => '<div class="w-actions" style="' + style + '">' + head + inner + '</div>';
  if (!w.actTablet) return wrap('<div class="no-data">Choose a tablet in this widget\'s settings</div>');
  const d = ACT.data[w.actTablet];
  if (!d) return wrap('<div class="no-data">Loading…</div>');
  if (d.failed) return wrap('<div class="no-data">Could not load the actions</div>');
  if (!d.tiles.length) return wrap('<div class="no-data">This tablet has no Actions tiles that can be used here</div>');
  const btns = d.tiles.map((t) => {
    const v = tmActionView(t, ACT.ents || {}, d.state), open = v.mode === 'menu' && ACT.open === w.id + '|' + t.id;
    const icon = typeof tbSvg === 'function' ? tbSvg(v.icon) : '';
    const main = '<button type="button" class="act-btn' + (v.on ? ' on' : '') + (v.gone ? ' gone' : '') + (ACT.busy[t.id] ? ' busy' : '') + '" data-interactive="1" data-act-w="' + escapeHtmlD(String(w.id)) + '" data-act-tile="' + escapeHtmlD(t.id) + '">'
      + '<span class="act-top"><span class="act-ico">' + icon + '</span><span class="act-label">' + escapeHtmlD(v.label) + '</span></span><span class="act-state">' + escapeHtmlD(v.state) + '</span></button>';
    const choices = open ? '<div class="act-choices">' + v.choices.map((c) => '<button type="button" class="act-choice" data-interactive="1" data-act-w="' + escapeHtmlD(String(w.id)) + '" data-act-tile="' + escapeHtmlD(t.id) + '" data-act-index="' + c.index + '">' + escapeHtmlD(c.label) + '</button>').join('') + '</div>' : '';
    return '<div class="act-cell">' + main + choices + '</div>';
  }).join('');
  return wrap('<div class="act-grid">' + btns + '</div>');
}

async function actRun(widgetId, tileId, body) {
  const w = (state.layout || []).find((x) => String(x.id) === String(widgetId));
  if (!w || !w.actTablet || ACT.busy[tileId]) return;
  ACT.busy[tileId] = true; try { rerenderSingleWidget(w.id); } catch (e) { /* not on screen */ }
  let said = '';
  try {
    const r = await fetch('/api/tablet-actions/' + encodeURIComponent(w.actTablet) + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tileId, ...body }) });
    const j = await r.json().catch(() => ({}));
    said = tmActionResult(r.ok || j.failed ? j : { error: j.error || 'That did not work.' }, ACT.ents || {});
  } catch (e) { said = 'The home hub is not reachable.'; }
  delete ACT.busy[tileId];
  if (said && typeof showDisplayToast === 'function') showDisplayToast('⚠ ' + said);
  await actLoad(w.actTablet, true);
  setTimeout(() => actLoad(w.actTablet, true), 2500);                        // the device has had a moment to change by then
}
// One listener for every Actions widget (the canvas is redrawn, so the buttons themselves are not wired).
document.addEventListener('click', (e) => {
  const choice = e.target.closest && e.target.closest('.act-choice[data-act-tile]');
  if (choice) { e.stopPropagation(); ACT.open = ''; actRun(choice.dataset.actW, choice.dataset.actTile, { index: Number(choice.dataset.actIndex) }); return; }
  const b = e.target.closest && e.target.closest('.act-btn[data-act-tile]');
  if (!b) return;
  e.stopPropagation();
  const w = (state.layout || []).find((x) => String(x.id) === b.dataset.actW), d = w && ACT.data[w.actTablet], t = d && d.tiles.find((x) => x.id === b.dataset.actTile);
  if (!t) return;
  const plan = tmActionTap(t, ACT.ents || {}, d.state);
  if (plan === null) { const k = w.id + '|' + t.id; ACT.open = ACT.open === k ? '' : k; try { rerenderSingleWidget(w.id); } catch (err) { /* not on screen */ } return; }
  actRun(w.id, t.id, plan);
}, true);

// Live Edit settings: which tablet, the text size and a heading.
function renderActionsAdvancedSettings(w) {
  const fontPx = w.actFontPx || 16;
  return `<div class="was-row"><label>Tablet</label><select id="act-tablet"><option value="">Loading…</option></select></div>
    <p class="was-hint">Shows that tablet's Actions tiles as buttons. Edit the tiles under Layout, Tablet. Tiles that ask for the PIN or have a lock in them stay on the tablet.</p>
    <div class="was-row"><label>Heading</label><input type="text" id="act-title" maxlength="40" placeholder="(none)" value="${escapeHtmlD(w.actTitle || '')}"></div>
    <div class="was-row"><label>Text size (px)</label><input type="range" id="act-font" min="10" max="48" step="1" value="${fontPx}"><span id="act-font-val">${fontPx}px</span></div>`;
}
function wireActionsAdvancedSettings(w) {
  const sel = document.getElementById('act-tablet');
  if (sel) fetch('/api/tablet-actions').then((r) => (r.ok ? r.json() : [])).catch(() => []).then((list) => {
    const rows = Array.isArray(list) ? list : [];
    sel.innerHTML = '<option value="">Choose a tablet…</option>' + rows.map((t) => '<option value="' + escapeHtmlD(t.id) + '"' + (t.id === w.actTablet ? ' selected' : '') + '>' + escapeHtmlD(t.name) + '</option>').join('');
  });
  if (sel) sel.addEventListener('change', (e) => { if (e.target.value) w.actTablet = e.target.value; else delete w.actTablet; actEnsure(); rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const title = document.getElementById('act-title');
  if (title) title.addEventListener('input', (e) => { const v = e.target.value.trim(); if (v) w.actTitle = v; else delete w.actTitle; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const font = document.getElementById('act-font');
  if (font) font.addEventListener('input', (e) => { w.actFontPx = parseInt(e.target.value, 10); document.getElementById('act-font-val').textContent = w.actFontPx + 'px'; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
}
