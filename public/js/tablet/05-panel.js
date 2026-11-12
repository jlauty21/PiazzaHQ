// The /tablet web app, part 5: the options of one tile while rearranging (a side panel on a sideways tablet, a bottom panel on an upright one), and adding, copying and removing tiles.
// The choices are the same as the app's editor (Layout, Tablet): they come from js/shared/tablet-model.js and tablet-icons.js. Needs 04-edit.js (the edit mode this lives in).
'use strict';
const tbNewId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const TB_TEXT_SIZES = [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']];
let tbAllEnts = null;                                                  // every Home Assistant entity, fetched when first needed (the page itself loads only what its tiles use)
async function tbEntities() {
  if (!tbAllEnts) { const r = await tbApi('/api/ha/entities'); tbAllEnts = tbOk(r) ? tbList(r) : []; }
  return tbAllEnts;
}
// The inputs a media player offers, or the choices of a dropdown helper, for the "switch input to" step. Not kept when empty: a TV that is off reports none, and may report some later.
const TB_CHOICES = {};
async function tbChoicesFor(ref) {
  if (TB_CHOICES[ref]) return TB_CHOICES[ref];
  if (ref.startsWith('remote.')) {                                      // a remote: the commands the app knows it has (from tiles); Home Assistant cannot list what it was taught
    const r = await tbApi('/api/ha/remote-commands/' + encodeURIComponent(ref)), list = tbOk(r) && Array.isArray(r.commands) ? [...new Set(r.commands.map((c) => c.command))] : [];
    if (list.length) TB_CHOICES[ref] = list;
    return list;
  }
  const r = await tbApi('/api/ha/state/' + encodeURIComponent(ref)), list = tbOk(r) ? (r.sourceList || r.options || []) : [];
  if (list.length) TB_CHOICES[ref] = list;
  return list;
}
function tbTileName(t) { try { return tbView(t).label || t.ref; } catch { return t.ref; } }

// ── the panel ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function tbSelectTile(id) {
  if (!TB.edit) return;
  TB.edit.sel = id;
  tbEditDecorate();
  tbPanelRender();
  setTimeout(() => { const el = document.querySelector(`#tb-grid [data-tile="${id}"]`); if (el && el.scrollIntoView && tbPortrait()) el.scrollIntoView({ block: 'nearest' }); }, 60);          // upright: the options panel takes the lower part of the screen, so bring the tile into the part that is left
}
function tbPanelClose(silent) {
  const p = tbEl('tb-panel'); if (p) p.remove();
  const app = tbEl('tb-app'); if (app) app.classList.remove('tb-withpanel');
  if (TB.edit) { TB.edit.sel = ''; if (!silent) { tbEditDecorate(); } }
}
function tbSeg(f, opts, cur) {
  return `<div class="tb-segs" role="group">${opts.map(([v, l]) => `<button type="button" class="tb-seg${String(cur) === String(v) ? ' on' : ''}" data-f="${f}" data-v="${tbEsc(v)}" aria-pressed="${String(cur) === String(v)}">${tbEsc(l)}</button>`).join('')}</div>`;
}
function tbPanelHtml(t) {
  const stateless = tbIsStateless(t), dom = tmDomain(t.ref), size = tmSizeOf(t), onHex = tmHex(t.color_on), offHex = tmHex(t.color_off);
  const sub = t.kind === 'ha' ? t.ref : t.kind === 'routine' ? 'Actions' : t.kind === 'group' ? `${(t.members || []).length} devices` : t.kind === 'camera' ? 'Camera' : 'Piazza HQ';
  const field = (label, body) => `<div class="tb-pf"><div class="tb-pl">${label}</div>${body}</div>`;
  const sw = [`<button type="button" class="tb-sw${!t.color_on ? ' on' : ''}" data-f="color_on" data-v="" aria-label="Default color">A</button>`]
    .concat(Object.entries(TB_COLORS).map(([k, hex]) => `<button type="button" class="tb-sw${t.color_on === k ? ' on' : ''}" data-f="color_on" data-v="${k}" aria-label="${k}" style="background:${hex}"></button>`)).join('');
  const pinBox = t.kind === 'ha' || t.kind === 'group' || t.kind === 'routine' || (t.kind === 'card' && TM_CARD_OPENABLE.includes(t.ref))
    ? `<button type="button" class="tb-seg tb-toggle${t.needs_pin || t.ref.startsWith('lock.') ? ' on' : ''}" data-f="pin" aria-pressed="${!!(t.needs_pin || t.ref.startsWith('lock.'))}" ${t.ref.startsWith('lock.') ? 'disabled' : ''}>Needs the PIN</button>` : '';
  let kind = '';
  if (t.kind === 'group') kind += field('What it does', tbSeg('gmode', [['toggle', 'Switch together'], ['all_on', 'All on'], ['all_off', 'All off']], t.group_mode || 'toggle')) + `<button type="button" class="tb-btn" data-f="members">Choose devices</button>`;
  if (tmCanSwitchWith(t)) kind += field('Switch it with', `<button type="button" class="tb-btn" data-f="switchwith">Choose what it switches with</button><p style="margin:6px 0 0;color:var(--muted);font-size:14px">Another scene, or turn something on or off. Each tap does the next one.</p>`);
  if (t.kind === 'routine') kind += field('Actions', `<div class="tb-rsum">${tmRoutineLists(t.routine).map((l) => `<div>${l.title ? `<b>${tbEsc(l.title)}</b> ` : ''}<span>${l.steps.length}</span> <span>${l.steps.length === 1 ? 'action' : 'actions'}</span></div>`).join('')}</div><button type="button" class="tb-btn" data-f="routine">Edit actions</button>`);
  if (t.kind === 'ha' && dom === 'remote') kind += field('Buttons', tbSeg('rinline', [['', 'Open when tapped'], ['1', 'Show on the tile']], (t.remote || {}).inline ? '1' : '')) + ((t.remote || {}).inline ? '<p style="margin:6px 0 0;color:var(--muted);font-size:14px">Give the tile room for the buttons: about 3 wide and 4 high.</p>' : '') + field('Kind of remote', tbSeg('rpreset', TM_REMOTE_PRESET_LIST, (t.remote || {}).preset || 'custom')) + field('Device name (for a learning remote)', `<input class="tb-input" id="tbp-rdev" maxlength="60" placeholder="amplifier" value="${tbEsc((t.remote || {}).device || '')}" aria-label="Device name">`) + `<button type="button" class="tb-btn" data-f="rkeys">Choose commands</button><button type="button" class="tb-btn" data-f="rarrange" style="margin-top:8px">Arrange buttons</button>`;
  if (t.kind === 'camera') kind += field('Picture', tbSeg('camfit', [['', 'Fill the tile'], ['contain', 'Show the whole picture']], t.fit === 'contain' ? 'contain' : '')) + '<p style="margin:6px 0 0;color:var(--muted);font-size:14px">Filling crops a picture whose shape is not the tile\'s. Showing the whole picture leaves bars at the sides or the top and bottom.</p>';
  if (t.kind === 'camera') kind += field('Live video', tbSeg('live', [['1', 'Live on the tile'], ['', 'Only when tapped']], t.live ? '1' : '')) + (t.live ? '<p style="margin:6px 0 0;color:var(--muted);font-size:14px">Shows up to four live cameras at a time, and stops when the screen goes idle.</p>' : '');
  if (tmIsSensor(t)) {
    if (dom === 'sensor') kind += field('Trend line', `<div class="tb-row">${tbSeg('spark', [['1', 'Show'], ['', 'Hide']], t.spark ? '1' : '')}</div>` + (t.spark ? tbSeg('spark_h', [1, 6, 12, 24, 48, 72].map((h) => [h, h + ' h']), t.spark_hours || 24) : ''));
    if (dom === 'sensor' || dom === 'climate') kind += field('Turn red', `<div class="tb-row"><label>Above <input class="tb-input tb-num" id="tbp-above" inputmode="decimal" value="${t.alert_above != null ? t.alert_above : ''}"></label><label>Below <input class="tb-input tb-num" id="tbp-below" inputmode="decimal" value="${t.alert_below != null ? t.alert_below : ''}"></label></div>`);
    if (dom === 'binary_sensor') kind += field('Turn red when it reads', tbSeg('astate', [['', 'Never'], ['on', 'On'], ['off', 'Off']], t.alert_state || ''));
  }
  if (t.kind === 'card') tmCardOptions(t.ref).forEach((o) => {
    const cur = String((t.card_config || {})[o.key] || '');
    if (o.type === 'text' || o.type === 'date') { kind += field(o.label, `<input class="tb-input tb-co" ${o.type === 'date' ? 'type="date"' : 'maxlength="60"'} data-co="${o.key}" data-type="${o.type}" value="${tbEsc(cur)}" aria-label="${tbEsc(o.label)}">`); return; }
    const opts = o.type === 'choice' ? o.choices : [[cur, cur ? '…' : (TM_OPTION_SOURCES[o.type] ? TM_OPTION_SOURCES[o.type].blank : '')]];
    kind += field(o.label, `<select class="tb-input tb-co" data-co="${o.key}" data-type="${o.type}" aria-label="${tbEsc(o.label)}">${opts.map(([v, l]) => `<option value="${tbEsc(v)}" ${String(v) === cur ? 'selected' : ''}>${tbEsc(l)}</option>`).join('')}</select>`);
  });
  if (t.kind === 'card' && t.ref === 'send_message') kind += field('Message to send', `<input class="tb-input" id="tbp-msg" maxlength="80" value="${tbEsc((t.card_config && t.card_config.text) || '')}">`);
  return `<div class="tb-phead"><div><div class="tb-ptitle" id="tbp-title">${tbEsc(tbTileName(t))}</div><div class="tb-psub">${tbEsc(sub)}</div></div><button type="button" class="tb-btn tb-pclose" data-f="close" aria-label="Close options">✕</button></div>
    <div class="tb-pbody">
      ${tbPhone() ? tbPhoneField(t) : ''}
      ${field('Name', `<input class="tb-input" id="tbp-name" maxlength="40" placeholder="${tbEsc(tbTileName({ ...t, label: '' }))}" value="${tbEsc(t.label || '')}">`)}
      ${field('Icon', `<button type="button" class="tb-btn tb-iconbtn" data-f="icon"><span class="tb-ico">${tbSvg(t.icon || tmDefaultIcon(t))}</span>Change icon</button>`)}
      ${field(stateless ? 'Color' : 'Color when on', `<div class="tb-sws">${sw}<input type="color" class="tb-hex" id="tbp-hex-on" value="${onHex || '#ffc857'}" aria-label="Pick a color"></div>`)}
      ${stateless ? '' : field('Color when off', `<div class="tb-sws"><input type="color" class="tb-hex" id="tbp-hex-off" value="${offHex || '#172033'}" aria-label="Pick a color when off">${t.color_off ? '<button type="button" class="tb-btn tb-small" data-f="off_clear">Clear</button>' : ''}</div>`)}
      ${field('Size', tbSeg('size', [...Object.entries(TM_SIZES).map(([k, v]) => [k, v[2]]), ...(size === 'custom' ? [['custom', `${t.w}×${t.h}`]] : [])], size))}
      ${field('Text size', tbSeg('text_size', TB_TEXT_SIZES, t.text_size || 'normal'))}
      ${field('When tapped', tbSeg('tap', tmTapOptions(t), t.tap || 'toggle'))}
      ${tbPhone() ? '' : tbPhoneField(t)}
      ${pinBox ? field('Safety', pinBox) : ''}
      ${tmCanConfirm(t) ? field('Ask first', `<div class="tb-segs"><button type="button" class="tb-seg tb-toggle${t.confirm ? ' on' : ''}" data-f="confirm" aria-pressed="${!!t.confirm}">Ask "Do this now?" before it acts</button></div>`) : ''}
      ${kind}
    </div>
    <div class="tb-pfoot"><button type="button" class="tb-btn" data-f="dup">Duplicate</button><button type="button" class="tb-btn danger" data-f="remove">${TB.edit && TB.edit.armed === t.id ? 'Tap again to remove' : 'Remove'}</button></div>`;
}
// "On a phone": how wide the tile is there (or hidden), and where it comes in the phone's order (a phone shows a page's tiles one after another).
function tbPhoneField(t) {
  const list = tmPhoneList(tbPage()), i = list.findIndex((x) => x.id === t.id);
  return `<div class="tb-pf"><div class="tb-pl">On a phone: width</div>${tbSeg('phone', TM_PHONE_SIZES, t.phone || '')}<div class="tb-pl" style="margin-top:10px">On a phone: height</div>${tbSeg('phone_h', TM_PHONE_HEIGHTS, t.phone_h || '')}
    <div class="tb-row" style="margin-top:8px;align-items:center;gap:8px"><button type="button" class="tb-btn" data-f="phone_up" ${i <= 0 ? 'disabled' : ''}>▲ Earlier</button><button type="button" class="tb-btn" data-f="phone_down" ${i < 0 || i >= list.length - 1 ? 'disabled' : ''}>▼ Later</button><span style="color:var(--muted);font-size:14px">${i + 1} of ${list.length}</span></div></div>`;
}
function tbPanelRender() {
  if (!TB.edit || !TB.edit.sel) return;
  const t = tbTileById(TB.edit.sel);
  if (!t) { tbPanelClose(); return; }
  let p = tbEl('tb-panel');
  const keep = p ? (p.querySelector('.tb-pbody') || {}).scrollTop || 0 : 0;
  if (!p) {
    p = document.createElement('aside'); p.id = 'tb-panel'; p.className = 'tb-panel'; p.setAttribute('aria-label', 'Tile options');
    document.body.appendChild(p);
    p.addEventListener('click', tbPanelClick);
    p.addEventListener('change', tbPanelChange);
  }
  p.innerHTML = tbPanelHtml(t);
  const body = p.querySelector('.tb-pbody'); if (body) body.scrollTop = keep;
  tbFillCardOptions(t);
  tbEl('tb-app').classList.add('tb-withpanel');
}

// Change the size, keeping the tile where it is when it fits there, else moving it to the first free spot. False when it fits nowhere.
function tbResize(t, w, h) {
  const { cols, rows } = TB.layout.grid, others = tbPage().tiles.filter((o) => o !== t), want = { ...t, w: Math.min(w, cols), h: Math.min(h, rows) };
  if (!tmFits(others, want, cols, rows)) { const f = tmFirstFree(others, want.w, want.h, cols, rows); if (!f) return false; want.x = f.x; want.y = f.y; }
  t.x = want.x; t.y = want.y; t.w = want.w; t.h = want.h;
  return true;
}
async function tbPanelClick(e) {
  const b = e.target.closest('[data-f]'); if (!b || b.disabled || !TB.edit) return;
  const t = tbTileById(TB.edit.sel); if (!t) return;
  const f = b.dataset.f, v = b.dataset.v;
  if (f === 'close') { tbPanelClose(); return; }
  // When the page has been frozen, the taps made meanwhile are handled when it wakes up, long after they were made, and land on whatever is under the finger by then. Those are ignored for Remove and Duplicate.
  const late = performance.now() - e.timeStamp > 800;
  if (f === 'remove') {
    if (late) { if (TB.edit) TB.edit.armed = ''; tbPanelRender(); return; }
    if (TB.edit && TB.edit.armed === t.id) { TB.edit.armed = ''; tbRemoveTile(t.id); return; }       // the second tap
    TB.edit.armed = t.id; tbPanelRender();
    setTimeout(() => { if (TB.edit && TB.edit.armed === t.id) { TB.edit.armed = ''; tbPanelRender(); } }, 4000);
    return;
  }
  if (f === 'dup') { if (late) return; tbDuplicateTile(t.id); return; }
  if (f === 'icon') { tbIconSheet(t); return; }
  if (f === 'members') { tbMembersSheet(t); return; }
  if (f === 'switchwith') { await tbSwitchWith(t); return; }
  if (f === 'rkeys') { await tbRemoteKeys(t); tbPanelRender(); await tbEditCommit(); return; }
  if (f === 'rarrange') { await tbRemoteArrange(t); tbPanelRender(); await tbEditCommit(); return; }
  if (f === 'routine') { tbRoutineEditor(t, async () => { tbLastGrid = ''; tbPanelRender(); await tbEditCommit(); }); return; }
  if (f === 'color_on') t.color_on = v;
  else if (f === 'off_clear') t.color_off = '';
  else if (f === 'size') { const s = TM_SIZES[v]; if (!s) return; if (!tbResize(t, s[0], s[1])) { tbToast('That does not fit on this page. Move a tile or add another page.'); return; } }
  else if (f === 'text_size') t.text_size = v;
  else if (f === 'tap') t.tap = v;
  else if (f === 'pin') { if (t.needs_pin && t.kind === 'routine' && tmHasUnlock(t)) { tbToast('Remove the unlock actions before turning the PIN off.'); return; } t.needs_pin = !t.needs_pin; }
  else if (f === 'confirm') { if (t.confirm) delete t.confirm; else t.confirm = true; }
  else if (f === 'gmode') t.group_mode = v;
  else if (f === 'rpreset') t.remote = { ...(t.remote || {}), preset: v };
  else if (f === 'rinline') {
    const r = { ...(t.remote || { preset: 'custom' }) }; if (v) r.inline = true; else delete r.inline; t.remote = r;
    if (v && (t.w < 3 || t.h < 4)) { const w = Math.max(t.w, 3), h = Math.max(t.h, 4); if (!tbResize(t, w, h) && !tbResize(t, Math.max(t.w, 2), Math.max(t.h, 3))) tbToast('There is no room on this page for the buttons. Move a tile or add another page.'); }
    tbLastGrid = '';
  }
  else if (f === 'phone') { if (v) t.phone = v; else delete t.phone; tbLastGrid = ''; }
  else if (f === 'phone_h') { if (v) t.phone_h = v; else delete t.phone_h; tbLastGrid = ''; }
  else if (f === 'phone_up' || f === 'phone_down') {
    if (!tmPhoneMove(tbPage(), t.id, f === 'phone_up' ? -1 : 1)) return;
    tbLastGrid = ''; tbRedraw(); tbPanelRender(); await tbEditCommit();
    const el = document.querySelector(`[data-tile="${t.id}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    return;
  }
  else if (f === 'camfit') { if (v) t.fit = 'contain'; else delete t.fit; tbLastGrid = ''; }
  else if (f === 'live') { if (v) t.live = true; else delete t.live; }
  else if (f === 'spark') { if (v) { t.spark = true; t.spark_hours = t.spark_hours || 24; } else { delete t.spark; delete t.spark_hours; } }
  else if (f === 'spark_h') t.spark_hours = Number(v) || 24;
  else if (f === 'astate') { if (v) t.alert_state = v; else delete t.alert_state; }
  else return;
  tbPanelRender();
  await tbEditCommit();
}
// Typed and picked values are saved when the box is left; the panel is not redrawn, so the next box a finger lands on is still there.
async function tbPanelChange(e) {
  if (!TB.edit) return;
  const t = tbTileById(TB.edit.sel); if (!t) return;
  const id = e.target.id, val = e.target.value;
  if (e.target.dataset.co) {                                           // an option of a Piazza HQ tile (which list, whose chores, how many items)
    const key = e.target.dataset.co, cfg = { ...(t.card_config || {}) };
    const kindOf = e.target.dataset.type;
    if (val.trim() === '') delete cfg[key]; else cfg[key] = ['shopping_list', 'todo_list', 'kid'].includes(kindOf) ? Number(val) : val.trim();
    t.card_config = cfg; tbLastGrid = '';
    if (key === 'list' || key === 'kid') tbRefreshCards().then(() => { tbLastGrid = ''; tbRedraw(); });
    await tbEditCommit(); return;
  }
  if (id === 'tbp-name') { t.label = val.trim().slice(0, 40); const ti = tbEl('tbp-title'); if (ti) ti.textContent = tbTileName(t); }
  else if (id === 'tbp-rdev') { const r = { ...(t.remote || { preset: 'custom' }) }; if (val.trim()) r.device = val.trim(); else delete r.device; t.remote = r; }
  else if (id === 'tbp-hex-on') t.color_on = val;
  else if (id === 'tbp-hex-off') t.color_off = val;
  else if (id === 'tbp-msg') { const text = val.trim().slice(0, 80); if (!text) return; t.card_config = { ...(t.card_config || {}), text }; t.label = t.label || text.slice(0, 40); }
  else if (id === 'tbp-above' || id === 'tbp-below') {
    const key = id === 'tbp-above' ? 'alert_above' : 'alert_below';
    if (val.trim() === '' || !Number.isFinite(Number(val))) delete t[key]; else t[key] = Number(val);
  } else return;
  if (id === 'tbp-hex-on' || id === 'tbp-hex-off') tbPanelRender();
  await tbEditCommit();
}

// ── pickers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
function tbIconSheet(t) {
  const { box, close } = tbSheet(`<h2>Choose an icon</h2><div class="tb-icons"><button type="button" class="tb-iconpick" data-i="">Default</button>${Object.keys(TB_ICONS).map((k) => `<button type="button" class="tb-iconpick${t.icon === k ? ' on' : ''}" data-i="${k}" aria-label="${k}"><span class="tb-ico">${tbSvg(k)}</span></button>`).join('')}</div><button type="button" class="tb-btn" data-close>Cancel</button>`, true);
  box.dataset.edit = '1';
  box.querySelector('[data-close]').addEventListener('click', close);
  box.querySelectorAll('.tb-iconpick').forEach((b) => b.addEventListener('click', async () => { t.icon = b.dataset.i; close(); tbPanelRender(); await tbEditCommit(); }));
}
async function tbMembersSheet(t) {
  const { box, close } = tbSheet(`<h2>Devices in this group</h2><input class="tb-input" id="tbm-search" placeholder="Search…" aria-label="Search"><div class="tb-list tb-choices" id="tbm-list"><p>Loading…</p></div><div class="tb-row"><button type="button" class="tb-btn" data-close>Cancel</button><button type="button" class="tb-btn primary" id="tbm-save">Done</button></div>`, true);
  box.dataset.edit = '1';
  const ents = (await tbEntities()).filter((e) => TM_GROUP_DOMAINS.includes(tmDomain(e.entity_id))), chosen = new Set(t.members || []);
  const paint = () => {
    const q = tbEl('tbm-search').value.trim().toLowerCase();
    const list = ents.filter((e) => !q || e.friendly_name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q)).slice(0, 120);
    tbEl('tbm-list').innerHTML = list.map((e) => `<label class="tb-choice"><input type="checkbox" data-id="${tbEsc(e.entity_id)}" ${chosen.has(e.entity_id) ? 'checked' : ''}><span>${tbEsc(e.friendly_name)}<small>${tbEsc(e.entity_id)}</small></span></label>`).join('') || '<p>No matches.</p>';
    tbEl('tbm-list').querySelectorAll('input').forEach((c) => c.addEventListener('change', () => { if (c.checked) chosen.add(c.dataset.id); else chosen.delete(c.dataset.id); }));
  };
  tbEl('tbm-search').addEventListener('input', paint); paint();
  box.querySelector('[data-close]').addEventListener('click', close);
  tbEl('tbm-save').addEventListener('click', async () => { if (!chosen.size) { tbToast('Choose at least one device.'); return; } t.members = [...chosen].slice(0, 30); close(); tbPanelRender(); await tbEditCommit(); });
}

// ── add, duplicate, remove ───────────────────────────────────────────────────────────────────────────────────────────────
// Put a new tile on the current page: at the tapped cell when it fits, else in the first free spot. Selects it and opens its options. False when the page is full.
async function tbPlaceTile(tile, at) {
  const page = tbPage(), { cols, rows } = TB.layout.grid;
  if (page.tiles.length >= TM_MAX_TILES) { tbToast('That page is full. Add another page.'); return false; }
  let spot = at && tmFits(page.tiles, { ...tile, x: at.x, y: at.y }, cols, rows) ? at : null;
  if (!spot && at && (tile.w > 1 || tile.h > 1) && tmFits(page.tiles, { ...tile, w: 1, h: 1, x: at.x, y: at.y }, cols, rows)) { tile.w = 1; tile.h = 1; spot = at; }   // a big tile in a one-cell gap: make it small
  if (!spot) spot = tmFirstFree(page.tiles, tile.w, tile.h, cols, rows) || (tile.w > 1 || tile.h > 1 ? tmFirstFree(page.tiles, 1, 1, cols, rows) : null);
  if (!spot) { tbToast('That page is full. Add another page.'); return false; }
  if (!tmFits(page.tiles, { ...tile, x: spot.x, y: spot.y }, cols, rows)) { tile.w = 1; tile.h = 1; }
  tile.x = spot.x; tile.y = spot.y;
  page.tiles.push(tile);
  TB.edit.sel = tile.id;
  tbRefreshHa().then(tbRedraw);                                       // a first device tile needs the entity states
  tbPanelRender();
  await tbEditCommit();
  return true;
}
async function tbDuplicateTile(id) {
  const t = tbTileById(id); if (!t) return;
  const c = JSON.parse(JSON.stringify(t)); c.id = tbNewId();
  await tbPlaceTile(c, null);
}
function tbSnack(msg, undo) {
  let s = tbEl('tb-snack'); if (s) s.remove();
  s = document.createElement('div'); s.id = 'tb-snack'; s.className = 'tb-snack'; s.setAttribute('role', 'status');
  s.innerHTML = `<span></span><button type="button" class="tb-btn">Undo</button>`;
  s.querySelector('span').textContent = msg;
  const gone = setTimeout(() => s.remove(), 8000);
  s.querySelector('button').addEventListener('click', () => { clearTimeout(gone); s.remove(); undo(); });
  document.body.appendChild(s);
}
async function tbRemoveTile(id) {
  const page = tbPage(), i = page.tiles.findIndex((t) => t.id === id); if (i < 0) return;
  const [t] = page.tiles.splice(i, 1), name = tbTileName(t), pageId = page.id;
  tbPanelClose();
  await tbEditCommit();
  tbSnack(`Removed "${name}"`, async () => {
    const p = TB.layout.pages.find((x) => x.id === pageId); if (!p) return;
    const { cols, rows } = TB.layout.grid;
    if (!tmFits(p.tiles, t, cols, rows)) { const f = tmFirstFree(p.tiles, t.w, t.h, cols, rows); if (!f) { tbToast('That page is full. Add another page.'); return; } t.x = f.x; t.y = f.y; }
    p.tiles.splice(Math.min(i, p.tiles.length), 0, t);
    await tbEditCommit();
  });
}

// ── the add-a-tile sheet ─────────────────────────────────────────────────────────────────────────────────────────────────
async function tbAddTile(at) {
  const SOURCES = [['ha', 'Devices'], ['scene', 'Scenes and automations'], ['sensor', 'Sensors'], ['more', 'More controls'], ['group', 'Group'], ['routine', 'Actions'], ['camera', 'Camera'], ['card', 'Piazza HQ']];
  const { box, close } = tbSheet(`<h2>Add a tile</h2>
    <div class="tb-segs wrap" id="tba-src">${SOURCES.map(([k, l]) => `<button type="button" class="tb-seg${k === 'ha' ? ' on' : ''}" data-src="${k}">${l}</button>`).join('')}</div>
    <input class="tb-input" id="tba-search" placeholder="Search…" aria-label="Search">
    <div class="tb-list tb-choices" id="tba-list"><p>Loading…</p></div><button type="button" class="tb-btn" data-close>Cancel</button>`, true);
  box.dataset.edit = '1';
  box.querySelector('[data-close]').addEventListener('click', close);
  let src = 'ha', cams = [];
  const form = { name: '', mode: 'toggle', chosen: new Set() };
  const ents = await tbEntities();
  { const c = await tbApi('/api/cameras'); cams = tbOk(c) ? tbList(c) : []; }
  const none = (m) => `<p>${m}</p>`;
  const noHa = none('Home Assistant is not set up. Connect it in Settings, Home Assistant first.');
  const entRow = (e) => `<button type="button" class="tb-choice" data-kind="ha" data-ref="${tbEsc(e.entity_id)}"><span>${tbEsc(e.friendly_name)}<small>${tbEsc(e.entity_id)}</small></span><em>${tbEsc(e.state)}${e.unit ? ' ' + tbEsc(e.unit) : ''}</em></button>`;
  const paint = () => {
    const q = tbEl('tba-search').value.trim().toLowerCase(), match = (e) => !q || e.friendly_name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q), dom = (e) => tmDomain(e.entity_id);
    const listOf = (fn, empty) => { const l = ents.filter((e) => fn(e) && match(e)).slice(0, 80); return l.length ? l.map(entRow) : [ents.length ? none(empty) : noHa]; };
    let rows;
    if (src === 'ha') rows = listOf((e) => !TM_ADD_SKIP.has(dom(e)), 'No matches.');
    else if (src === 'scene') rows = listOf((e) => ['scene', 'script', 'automation', 'button', 'input_button'].includes(dom(e)), 'No scenes, scripts, automations or buttons found.');
    else if (src === 'sensor') rows = listOf((e) => ['sensor', 'binary_sensor'].includes(dom(e)), 'No matches.');
    else if (src === 'more') rows = ['<p>Dropdowns, numbers and updates from Home Assistant.</p>', ...listOf((e) => TM_MORE_DOMAINS.includes(dom(e)), 'No dropdowns, numbers or updates found.')];
    else if (src === 'routine') rows = ['<p>A tile that does several things at once: run a scene and switch lights, switch between two states, or pick one of a few choices.</p>', `<input class="tb-input" id="tba-rname" placeholder="Name, for example Movie time" maxlength="40" value="${tbEsc(form.name)}">`, '<button type="button" class="tb-btn primary" id="tba-rcreate">Choose the actions</button>'];
    else if (src === 'camera') {
      const l = cams.filter((c) => !q || String(c.name).toLowerCase().includes(q)), more = tmCamCandidates(ents, cams).filter((c) => !q || c.name.toLowerCase().includes(q) || c.entity_id.includes(q));
      rows = l.map((c) => `<button type="button" class="tb-choice" data-kind="camera" data-ref="cam_${c.id}"><span>${tbEsc(c.name)}</span><em>Camera</em></button>`);
      if (more.length) rows.push('<div class="tb-pl">From Home Assistant</div>', ...more.map((c) => `<button type="button" class="tb-choice" data-newcam="${tbEsc(c.entity_id)}" data-name="${tbEsc(c.name)}"><span>${tbEsc(c.name)}<small>${tbEsc(c.entity_id)}</small></span><em>Camera</em></button>`));
      if (!rows.length) rows = [none('No cameras found. Connect Home Assistant, or add a camera in Settings, Cameras.')];
    }
    else if (src === 'group') {
      const l = ents.filter((e) => TM_GROUP_DOMAINS.includes(dom(e)) && match(e)).slice(0, 100);
      rows = [`<input class="tb-input" id="tba-gname" placeholder="Name, for example Downstairs lights" maxlength="40" value="${tbEsc(form.name)}">`, tbSeg('gmode_new', [['toggle', 'Switch together'], ['all_on', 'All on'], ['all_off', 'All off']], form.mode),
        ...(l.length ? l.map((e) => `<label class="tb-choice"><input type="checkbox" data-id="${tbEsc(e.entity_id)}" ${form.chosen.has(e.entity_id) ? 'checked' : ''}><span>${tbEsc(e.friendly_name)}<small>${tbEsc(e.entity_id)}</small></span></label>`) : [ents.length ? none('No matches.') : noHa]),
        '<button type="button" class="tb-btn primary" id="tba-gcreate">Create the group</button>'];
    } else {
      rows = Object.entries(TM_CARD_LABELS).filter(([, l]) => !q || l.toLowerCase().includes(q)).map(([ref, l]) => `<button type="button" class="tb-choice" data-kind="card" data-ref="${ref}"><span>${tbEsc(l)}</span></button>`);
      if (!rows.length) rows = [none('No matches.')];
    }
    const list = tbEl('tba-list'); list.innerHTML = rows.join('');
    list.querySelectorAll('.tb-choice[data-ref]').forEach((b) => b.addEventListener('click', async () => {
      const tile = tmNewTile(b.dataset.kind, b.dataset.ref, tbNewId());
      if (tile.ref === 'send_message') { await tbTextSheet(tile, close, at); return; }
      close(); await tbPlaceTile(tile, at);
    }));
    list.querySelectorAll('.tb-choice[data-newcam]').forEach((b) => b.addEventListener('click', async () => {         // a Home Assistant camera that is not on Piazza's list yet: add it, then its tile
      const r = await tbApi('/api/cameras', { method: 'POST', body: JSON.stringify({ name: b.dataset.name, kind: 'ha', url: 'ha:' + b.dataset.newcam }) });
      if (!tbOk(r) || !r.id) { tbToast((r && r.error) || 'Could not add that camera.'); return; }
      cams.push({ id: r.id, name: r.name, kind: 'ha', host_hint: b.dataset.newcam }); TB.cams[String(r.id)] = r.name; TB.camKinds[String(r.id)] = 'ha';
      close(); await tbPlaceTile(tmNewTile('camera', 'cam_' + r.id, tbNewId()), at);
    }));
    list.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => { if (c.checked) form.chosen.add(c.dataset.id); else form.chosen.delete(c.dataset.id); }));
    const gn = tbEl('tba-gname'); if (gn) gn.addEventListener('input', () => { form.name = gn.value; });
    list.querySelectorAll('[data-f="gmode_new"]').forEach((s) => s.addEventListener('click', () => { form.mode = s.dataset.v; paint(); }));
    const rn = tbEl('tba-rname'); if (rn) rn.addEventListener('input', () => { form.name = rn.value; });
    const rc = tbEl('tba-rcreate');
    if (rc) rc.addEventListener('click', () => {
      const name = (rn.value || '').trim(); if (!name) { tbToast('Give the tile a name.'); return; }
      const tile = tmNewTile('routine', 'routine', tbNewId(), { label: name.slice(0, 40), routine: { mode: 'run', steps: [] } });
      tbRoutineEditor(tile, async () => { close(); await tbPlaceTile(tile, at); });
    });
    const gc = tbEl('tba-gcreate');
    if (gc) gc.addEventListener('click', async () => {
      const name = (tbEl('tba-gname').value || '').trim();
      if (!name) { tbToast('Give the group a name.'); return; }
      if (!form.chosen.size) { tbToast('Choose at least one device.'); return; }
      close(); await tbPlaceTile(tmNewTile('group', 'g' + Date.now().toString(36), tbNewId(), { label: name.slice(0, 40), members: [...form.chosen].slice(0, 30), group_mode: form.mode }), at);
    });
  };
  box.querySelectorAll('#tba-src .tb-seg').forEach((b) => b.addEventListener('click', () => {
    src = b.dataset.src; box.querySelectorAll('#tba-src .tb-seg').forEach((x) => x.classList.toggle('on', x === b)); paint();
  }));
  tbEl('tba-search').addEventListener('input', paint);
  paint();
}
// ── the actions of a routine tile ──────────────────────────────────────────────────────────────────────────────────────
// Edits a copy of the tile's routine; "Done" checks it and stores it on the tile, then calls onDone. The tile's mode decides which lists show.
async function tbRoutineEditor(t, onDone) {
  const d = tmRoutineDraft(t.routine), names = {};
  (await tbEntities()).forEach((e) => { names[e.entity_id] = e.friendly_name || e.entity_id; });
  const { box, close } = tbSheet('<div id="tbr-body"></div>', true);
  box.dataset.edit = '1';
  const nm = (ref) => names[ref] || ref;
  const listOf = (id) => (id === 'steps' ? d.steps : id === 'off_steps' ? d.off_steps : (d.choices[Number(id.slice(1))] || {}).steps);
  const dlId = (ref) => 'tbr-dl-' + ref.replace(/\W/g, '_');
  const valueRow = (s, id, i) => !tmNeedsValue(s) ? '' : `<div class="tb-rstep tb-rval"><input class="tb-input" data-r="value" data-list="${id}" data-i="${i}" list="${dlId(s.ref)}" maxlength="100" autocomplete="off" value="${tbEsc(s.value || '')}" placeholder="${tmValueHint(s)}" aria-label="${tmValueHint(s)}"><select class="tb-input tb-rdo" data-r="wait" data-list="${id}" data-i="${i}" aria-label="Wait before this action">${tmWaitOptions(s).map(([n, l]) => `<option value="${n}" ${tmWaitValue(s) === n ? 'selected' : ''}>${tbEsc(l)}</option>`).join('')}</select></div>${s.do !== 'speak' ? '' : `<div class="tb-rstep tb-rval"><select class="tb-input" data-r="device" data-list="${id}" data-i="${i}" aria-label="Speaker to say it on"><option value="">Choose a speaker…</option>${(tbAllEnts || []).filter((e) => tmDomain(e.entity_id) === 'media_player').map((e) => `<option value="${tbEsc(e.entity_id)}" ${s.device === e.entity_id ? 'selected' : ''}>${tbEsc(e.friendly_name)}</option>`).join('')}</select></div>`}${s.do !== 'send_command' ? '' : `<div class="tb-rstep tb-rval"><input class="tb-input" data-r="device" data-list="${id}" data-i="${i}" maxlength="60" autocomplete="off" value="${tbEsc(s.device || '')}" placeholder="Device name, for example amplifier" aria-label="Device the command was learned for"><select class="tb-input tb-rdo" data-r="repeat" data-list="${id}" data-i="${i}" aria-label="How many times">${tmRepeatOptions(s.repeat).map(([n, l]) => `<option value="${n}" ${String(s.repeat || 1) === n ? 'selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="tb-btn tb-small" data-r="learn" data-list="${id}" data-i="${i}">Teach or test</button></div>`}`;
  const condRow = (s, id, i) => !TM_COND_ACTIONS.includes(s.do) ? '' : `<div class="tb-rcond"><select class="tb-input" data-r="condis" data-list="${id}" data-i="${i}" aria-label="When to do it"><option value="">Always</option><option value="off" ${s.only_if && s.only_if.is === 'off' ? 'selected' : ''}>Only if it is off</option><option value="on" ${s.only_if && s.only_if.is === 'on' ? 'selected' : ''}>Only if it is on</option></select>${s.only_if ? `<select class="tb-input" data-r="condref" data-list="${id}" data-i="${i}" aria-label="Which device">${(tbAllEnts || []).filter((e) => TM_COND_DOMAINS.includes(tmDomain(e.entity_id))).map((e) => `<option value="${tbEsc(e.entity_id)}" ${s.only_if.ref === e.entity_id ? 'selected' : ''}>${tbEsc(e.friendly_name)}</option>`).join('')}</select>` : ''}</div>`;
  const section = (title, id) => {
    const list = listOf(id);
    return `<div class="tb-rsec"><div class="tb-pl">${title}</div>${list.map((s, i) => `<div class="tb-rstep"><select class="tb-input tb-rdo" data-r="do" data-list="${id}" data-i="${i}" aria-label="What to do">${tmStepOptions(s.ref, t.needs_pin || s.do === 'unlock').map(([a, l]) => `<option value="${a}" ${a === s.do ? 'selected' : ''}>${tbEsc(l)}</option>`).join('')}</select><span class="tb-rname">${tbEsc(nm(s.ref))}</span><button type="button" class="tb-btn tb-small" data-r="up" data-list="${id}" data-i="${i}" aria-label="Move up">▲</button><button type="button" class="tb-btn tb-small" data-r="down" data-list="${id}" data-i="${i}" aria-label="Move down">▼</button><button type="button" class="tb-btn tb-small danger" data-r="rm" data-list="${id}" data-i="${i}" aria-label="Remove">✕</button></div>${valueRow(s, id, i)}${condRow(s, id, i)}`).join('')}${list.length < TM_MAX_STEPS ? `<button type="button" class="tb-btn tb-small" data-r="add" data-list="${id}">Add an action</button>` : ''}${id === 'off_steps' && tmOffFromOn(d.steps, d.off_steps).length > d.off_steps.length ? '<button type="button" class="tb-btn tb-small" data-r="fill">Add the opposite of each "on" action</button>' : ''}</div>`;
  };
  const paint = () => {
    let body = tbSeg('rmode', TM_ROUTINE_MODES, d.mode);
    if (d.mode === 'run') body += section('Actions, in this order', 'steps');
    else if (d.mode === 'toggle') {
      const inds = [...new Set([...d.steps, ...d.off_steps].map((s) => s.ref).filter((r) => TM_STATE_DOMAINS.includes(tmDomain(r))))];
      body += section('When switching on', 'steps') + section('When switching off', 'off_steps');
      body += `<div class="tb-pf"><div class="tb-pl">Lit when this is on</div><select class="tb-input" data-r="indicator" aria-label="Lit when this is on"><option value="">${inds.length ? 'The first light or switch' : 'What the tile did last'}</option>${inds.map((r) => `<option value="${tbEsc(r)}" ${d.indicator === r ? 'selected' : ''}>${tbEsc(nm(r))}</option>`).join('')}</select></div>`;
    } else {
      if (d.mode === 'cycle') body += '<p style="margin:8px 0 0;color:var(--muted);font-size:14px">Each tap does the next press, then it starts over.</p>' + `<div class="tb-pf"><div class="tb-pl">Start over after</div><select class="tb-input" data-r="reset" aria-label="Start over after">${tmResetOptions(d.reset_after).map(([m, l]) => `<option value="${m}" ${Number(d.reset_after || 0) === m ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
      body += d.choices.map((c, n) => `<div class="tb-rchoice"><div class="tb-row"><input class="tb-input" data-r="label" data-n="${n}" maxlength="40" value="${tbEsc(c.label)}" aria-label="${d.mode === 'cycle' ? 'Name of this press' : 'Name of the choice'}">${d.choices.length > 1 ? `<button type="button" class="tb-btn tb-small danger" data-r="rmchoice" data-n="${n}" aria-label="Remove this choice">✕</button>` : ''}</div>${section('Actions', 'c' + n)}</div>`).join('') + (d.choices.length < TM_MAX_CHOICES ? `<button type="button" class="tb-btn" data-r="addchoice">${d.mode === 'cycle' ? 'Add a press' : 'Add a choice'}</button>` : '');
    }
    tbEl('tbr-body').innerHTML = `<h2>Actions</h2>${body}<div class="tb-row"><button type="button" class="tb-btn" data-close>Cancel</button><button type="button" class="tb-btn primary" data-r="done">Done</button></div>`;
    tbEl('tbr-body').querySelector('[data-close]').addEventListener('click', close);
    const refs = [...new Set([d.steps, d.off_steps, ...d.choices.map((c) => c.steps)].flat().filter(tmNeedsValue).map((x) => x.ref))];
    refs.forEach((ref) => {
      const dl = document.createElement('datalist'); dl.id = dlId(ref); tbEl('tbr-body').appendChild(dl);
      tbChoicesFor(ref).then((list) => { dl.innerHTML = list.map((x) => `<option value="${tbEsc(x)}"></option>`).join(''); });
    });
  };
  box.addEventListener('click', async (e) => {
    const sg = e.target.closest('[data-f="rmode"]'); if (sg) { d.mode = sg.dataset.v; paint(); return; }
    const b = e.target.closest('[data-r]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const r = b.dataset.r, id = b.dataset.list, i = Number(b.dataset.i);
    if (r === 'add') { const ref = await tbStepPicker(); if (!ref) return; listOf(id).push(tmNewStep(ref)); }
    else if (r === 'learn') { const s = listOf(id)[i]; if (s) await tbRemoteLearn(s, nm(s.ref)); }
    else if (r === 'fill') d.off_steps = tmOffFromOn(d.steps, d.off_steps);
    else if (r === 'rm') listOf(id).splice(i, 1);
    else if (r === 'up') tmMoveIn(listOf(id), i, -1);
    else if (r === 'down') tmMoveIn(listOf(id), i, 1);
    else if (r === 'addchoice') d.choices.push({ label: (d.mode === 'cycle' ? 'Press ' : 'Choice ') + (d.choices.length + 1), steps: [] });
    else if (r === 'rmchoice') d.choices.splice(Number(b.dataset.n), 1);
    else if (r === 'done') {
      const out = tmRoutineFromDraft(d), problem = tmRoutineProblem(out);
      if (problem) { tbToast(problem); return; }
      t.routine = out; tmStripUnlock(t);
      if (tmRoutineProblem(t.routine)) { tbToast('Add at least one action.'); return; }
      close(); await onDone(); return;
    } else return;
    paint();
  });
  box.addEventListener('change', (e) => {
    const el = e.target.closest('[data-r]'); if (!el) return;
    if (el.dataset.r === 'do') { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) { tmSetStepAction(s, el.value); paint(); } }
    else if (el.dataset.r === 'device') { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) { if (el.value.trim()) s.device = el.value.trim(); else delete s.device; } }
    else if (el.dataset.r === 'condis') { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) { tmSetCond(s, el.value, tbAllEnts); paint(); } }
    else if (el.dataset.r === 'condref') { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s && s.only_if) s.only_if.ref = el.value; }
    else if (el.dataset.r === 'repeat') { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) { if (Number(el.value) > 1) s.repeat = Number(el.value); else delete s.repeat; } }
    else if (el.dataset.r === 'wait') { const s = listOf(el.dataset.list)[Number(el.dataset.i)]; if (s) tmSetWait(s, el.value); }
    else if (el.dataset.r === 'indicator') d.indicator = el.value;
    else if (el.dataset.r === 'reset') d.reset_after = Number(el.value) || 0;
  });
  box.addEventListener('input', (e) => {
    const el = e.target.closest('[data-r="label"]'); if (el) d.choices[Number(el.dataset.n)].label = el.value;
    const v = e.target.closest('[data-r="value"]'); if (v) { const s = listOf(v.dataset.list)[Number(v.dataset.i)]; if (s) s.value = v.value; }
    const dv = e.target.closest('[data-r="device"]'); if (dv) { const s = listOf(dv.dataset.list)[Number(dv.dataset.i)]; if (s) { if (dv.value.trim()) s.device = dv.value.trim(); else delete s.device; } }
  });
  paint();
}
// The commands of an on-screen remote: one row per button with the name of the command it sends (empty: the kind of remote's own), and Teach or test for a learning remote.
function tbRemoteKeys(t) {
  return new Promise(async (resolve) => {
    await tbEntities();
    const cfg = { ...(t.remote || { preset: 'custom' }) }, buttons = { ...(cfg.buttons || {}) }, custom = (cfg.custom || []).map((c) => ({ ...c })), hidden = new Set(cfg.hidden || []);
    const preset = TM_REMOTE_PRESETS[cfg.preset] || {}, name = (tbEntitiesNow()[t.ref] || {}).friendly_name || t.ref;
    const remotes = (tbAllEnts || []).filter((e) => tmDomain(e.entity_id) === 'remote' && e.entity_id !== t.ref);
    const known = {};                                                  // remote entity -> the commands the app knows it has (from tiles), for suggestions
    const dl = (ref) => 'tbl-cmds-' + ref.replace(/\W/g, '_');
    const fillLists = () => [...new Set([t.ref, ...custom.map((c) => c.ref).filter(Boolean)])].forEach(async (ref) => {
      if (!known[ref]) { const r = await tbApi('/api/ha/remote-commands/' + encodeURIComponent(ref)); known[ref] = tbOk(r) && Array.isArray(r.commands) ? r.commands : []; }
      const el = document.getElementById(dl(ref)); if (el) el.innerHTML = known[ref].map((c) => `<option value="${tbEsc(c.command)}" label="${tbEsc(c.device ? c.device + ': ' + c.command : c.command)}"></option>`).join('');
    });
    const open = () => {
      const rows = TM_REMOTE_KEYS.map(([k, l]) => `<div class="tb-rstep"><span class="tb-rname" style="flex:0 0 110px">${tbEsc(l)}</span><input class="tb-input" data-k="${k}" list="${dl(t.ref)}" maxlength="60" value="${tbEsc(buttons[k] || '')}" placeholder="${tbEsc(preset[k] || 'command name')}" aria-label="Command for ${tbEsc(l)}" ${hidden.has(k) ? 'disabled' : ''}><button type="button" class="tb-btn tb-small" data-teach="${k}" ${hidden.has(k) ? 'disabled' : ''}>Teach</button><button type="button" class="tb-btn tb-small${hidden.has(k) ? '' : ' danger'}" data-hide="${k}" aria-label="${hidden.has(k) ? 'Show ' + tbEsc(l) + ' again' : 'Remove ' + tbEsc(l) + ' from the remote'}">${hidden.has(k) ? 'Show' : '✕'}</button></div>`).join('');
      const crows = custom.map((c, i) => `<div class="tb-rcrow"><div class="tb-rstep"><input class="tb-input" data-cl="${i}" maxlength="20" value="${tbEsc(c.label || '')}" placeholder="Button name" aria-label="Button name"><select class="tb-input tb-rdo" data-cr="${i}" aria-label="Which remote sends it"><option value="">This remote</option>${remotes.map((e) => `<option value="${tbEsc(e.entity_id)}" ${c.ref === e.entity_id ? 'selected' : ''}>${tbEsc(e.friendly_name)}</option>`).join('')}</select><button type="button" class="tb-btn tb-small danger" data-crm="${i}" aria-label="Remove">✕</button></div><div class="tb-rstep"><input class="tb-input" data-cd="${i}" maxlength="60" value="${tbEsc(c.device || '')}" placeholder="${tbEsc(c.ref ? 'Device name, for example amplifier' : cfg.device || 'Device name')}" aria-label="Device name"><input class="tb-input" data-cc="${i}" list="${dl(c.ref || t.ref)}" maxlength="60" value="${tbEsc(c.command || '')}" placeholder="command name" aria-label="Command for ${tbEsc(c.label || 'this button')}"><button type="button" class="tb-btn tb-small" data-cteach="${i}">Teach</button></div></div>`).join('');
      const lists = [...new Set([t.ref, ...custom.map((c) => c.ref).filter(Boolean)])].map((ref) => `<datalist id="${dl(ref)}"></datalist>`).join('');
      const kindName = (TM_REMOTE_PRESET_LIST.find((x) => x[0] === (cfg.preset || 'custom')) || [0, 'remote'])[1];
      const { box, close } = tbSheet(`<h2>Commands for ${tbEsc(tbTileName(t))}</h2><p style="color:var(--muted);font-size:15px">Leave a box empty to use the ${tbEsc(kindName)} command shown in grey. A button with no command is left off the remote.</p><div class="tb-rsec">${rows}</div><div class="tb-pl" style="margin-top:14px">Custom buttons</div><p style="color:var(--muted);font-size:15px;margin:4px 0">Your own buttons, such as one for each input of an amplifier. A button can be sent by a different remote, for example an amplifier's next to an Apple TV's buttons. They show under the other buttons.</p><div class="tb-rsec">${crows}</div>${custom.length < TM_REMOTE_CUSTOM_MAX ? '<button type="button" class="tb-btn tb-small" data-cadd>Add a button</button>' : ''}<div class="tb-row"><button type="button" class="tb-btn primary" id="tbk-done">Done</button></div>${lists}`, true);
      box.dataset.edit = '1';
      fillLists();
      box.addEventListener('input', (e) => {
        const d = e.target.dataset || {};
        if (d.k) { if (e.target.value.trim()) buttons[d.k] = e.target.value.trim(); else delete buttons[d.k]; }
        else if (d.cl !== undefined) custom[Number(d.cl)].label = e.target.value;
        else if (d.cd !== undefined) custom[Number(d.cd)].device = e.target.value;
        else if (d.cc !== undefined) {
          const c = custom[Number(d.cc)]; c.command = e.target.value;
          const matches = (known[c.ref || t.ref] || []).filter((k) => k.command === c.command);              // a command the app knows by one device name: fill the device in
          if (matches.length === 1 && matches[0].device && !c.device && (c.ref || matches[0].device !== cfg.device)) { c.device = matches[0].device; const dv = box.querySelector('[data-cd="' + d.cc + '"]'); if (dv) dv.value = c.device; }
        }
      });
      box.addEventListener('change', (e) => { const d = e.target.dataset || {}; if (d.cr !== undefined) { const c = custom[Number(d.cr)]; if (e.target.value) c.ref = e.target.value; else delete c.ref; close(); open(); } });
      box.addEventListener('click', async (e) => {
        const d = (e.target.closest('button') || {}).dataset || {};
        if (d.hide) { if (hidden.has(d.hide)) hidden.delete(d.hide); else { hidden.add(d.hide); delete buttons[d.hide]; } close(); open(); return; }
        if (d.cadd !== undefined) { custom.push({ label: '', command: '', id: 'c' + Math.random().toString(36).slice(2, 8) }); close(); open(); return; }
        if (d.crm !== undefined) { custom.splice(Number(d.crm), 1); close(); open(); return; }
        const learn = d.teach || (d.cteach !== undefined ? 'c' + d.cteach : '');
        if (!learn) return;
        const c = d.cteach !== undefined ? custom[Number(d.cteach)] : null;
        const step = { ref: c && c.ref ? c.ref : t.ref, do: 'send_command', value: c ? c.command : buttons[d.teach] || '', device: c ? (c.device || (c.ref ? '' : cfg.device || '')) : cfg.device || '' };
        close(); await tbRemoteLearn(step, c && c.ref ? ((tbEntitiesNow()[c.ref] || {}).friendly_name || c.ref) : name);
        if (step.value) { if (c) c.command = step.value; else buttons[d.teach] = step.value; }
        if (step.device) {
          if (c && c.ref) c.device = step.device;                                      // another remote's own device name
          else if (!cfg.device) cfg.device = step.device;                              // this remote had no device name yet: it becomes the tile's
          else if (c && step.device !== cfg.device) c.device = step.device;            // a different name just for this button
          else if (!c) cfg.device = step.device;
        }
        open();
      });
      tbEl('tbk-done').addEventListener('click', () => {
        if (Object.keys(buttons).length) cfg.buttons = buttons; else delete cfg.buttons;
        if (hidden.size) cfg.hidden = [...hidden]; else delete cfg.hidden;
        const keep = custom.map((c, i) => { const o = { label: String(c.label || '').trim().slice(0, 20), command: String(c.command || '').trim(), id: tmCustomId(c, i) }; if (c.ref) o.ref = c.ref; if (String(c.device || '').trim()) o.device = String(c.device).trim(); return o; }).filter((c) => c.command);
        keep.forEach((c) => { if (!c.label) c.label = c.command.slice(0, 20); });
        if (keep.length) cfg.custom = keep; else delete cfg.custom;
        t.remote = cfg; close(); resolve();
      });
    };
    open();
  });
}
// Arrange the buttons of an on-screen remote: the ones that have a command, in a list that can be moved up and down; the pad then shows them in that order. "Usual layout" goes back to the shape of a real remote.
function tbRemoteArrange(t) {
  return new Promise((resolve) => {
    const cfg = { ...(t.remote || { preset: 'custom' }) }, names = Object.fromEntries(TM_REMOTE_KEYS);
    let ids = tmRemoteItems({ ...cfg, order: [''] }) || [];                                 // the buttons that have a command, in the arranged order (or the usual one)
    if (cfg.order && cfg.order.length) ids = tmRemoteItems(cfg) || ids;
    const label = (id) => { if (names[id]) return names[id]; const ci = (cfg.custom || []).findIndex((c, i) => tmCustomId(c, i) === id), c = (cfg.custom || [])[ci]; return c ? (c.label || c.command) : id; };
    const open = () => {
      const rows = ids.map((id, i) => `<div class="tb-rstep"><span class="tb-rname">${tbEsc(label(id))}</span><button type="button" class="tb-btn tb-small" data-up="${i}" aria-label="Move ${tbEsc(label(id))} earlier" ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" class="tb-btn tb-small" data-down="${i}" aria-label="Move ${tbEsc(label(id))} later" ${i === ids.length - 1 ? 'disabled' : ''}>▼</button></div>`).join('');
      const { box, close } = tbSheet(`<h2>Arrange the buttons of ${tbEsc(tbTileName(t))}</h2><p style="color:var(--muted);font-size:15px">Move a button up or down. The remote shows its buttons in this order.</p><div class="tb-rsec">${rows || '<p>This remote has no buttons yet.</p>'}</div><div class="tb-row"><button type="button" class="tb-btn" id="tba-usual">Usual layout</button><button type="button" class="tb-btn primary" id="tba-done">Done</button></div>`, true);
      box.dataset.edit = '1';
      box.addEventListener('click', (e) => {
        const d = (e.target.closest('button') || {}).dataset || {};
        const i = d.up !== undefined ? Number(d.up) : d.down !== undefined ? Number(d.down) : -1;
        if (i < 0) return;
        const j = d.up !== undefined ? i - 1 : i + 1;
        if (j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; close(); open(); }
      });
      tbEl('tba-usual').addEventListener('click', () => { delete cfg.order; t.remote = cfg; close(); resolve(); });
      tbEl('tba-done').addEventListener('click', () => { cfg.order = ids.slice(); t.remote = cfg; close(); resolve(); });
    };
    open();
  });
}
const tbEntitiesNow = () => TB.ents || {};
// Teach a universal remote (a BroadLink, say) a command, and test it. Home Assistant puts the remote into learning mode when asked; the person then presses the button on the original remote, pointing it at the
// universal remote, within about 20 seconds. Home Assistant does not say whether it worked, so "Test it" sends the command. The step's device and command are filled in when the sheet is closed with Done.
function tbRemoteLearn(step, name) {
  return new Promise((resolve) => {
    const { box, close } = tbSheet(`<h2>Teach ${tbEsc(name)} a command</h2><p style="color:var(--muted);font-size:15px">Name the device (like amplifier) and the command (like power). Press Start, then point your original remote at ${tbEsc(name)} and press that button within 20 seconds.</p><div class="tb-pf"><div class="tb-pl">Device</div><input class="tb-input" id="tbl-dev" maxlength="60" value="${tbEsc(step.device || '')}" placeholder="amplifier"></div><div class="tb-pf"><div class="tb-pl">Command</div><input class="tb-input" id="tbl-cmd" maxlength="60" value="${tbEsc(step.value || '')}" placeholder="power"></div><p id="tbl-msg" role="status" style="min-height:1.4em"></p><div class="tb-row"><button type="button" class="tb-btn primary" id="tbl-go">Start</button><button type="button" class="tb-btn" id="tbl-test">Test it</button><button type="button" class="tb-btn" id="tbl-done">Done</button></div><button type="button" class="tb-btn tb-small danger" id="tbl-del" style="margin-top:10px">Delete this command from the remote</button>`, true);
    box.dataset.edit = '1';
    const say = (t) => { tbEl('tbl-msg').textContent = t; };
    const call = async (action) => {
      const device = tbEl('tbl-dev').value.trim(), command = tbEl('tbl-cmd').value.trim();
      if (!device || !command) { say('Type a device name and a command name first.'); return; }
      const r = await tbApi('/api/ha/call-action', { method: 'POST', body: JSON.stringify({ entityId: step.ref, action, device, command }) });
      if (!tbOk(r)) { say((r && r.error) || 'That did not work.'); return; }
      say(action === 'learn_command' ? 'Now point your original remote at it and press the button (you have about 20 seconds).' : action === 'delete_command' ? 'Deleted from the remote.' : 'Sent. Did the device react?');
    };
    tbEl('tbl-go').addEventListener('click', () => call('learn_command'));
    tbEl('tbl-test').addEventListener('click', () => call('send_command'));
    tbEl('tbl-del').addEventListener('click', () => call('delete_command'));
    tbEl('tbl-done').addEventListener('click', () => {
      const device = tbEl('tbl-dev').value.trim(), command = tbEl('tbl-cmd').value.trim();
      if (device) step.device = device; else delete step.device;
      if (command) step.value = command;
      close(); resolve();
    });
  });
}
// Choose the device (or scene, script, automation or button) for a step. Resolves with its entity id, or '' when cancelled.
function tbStepPicker() {
  return new Promise(async (resolve) => {
    const { box, close } = tbSheet(`<h2>Choose a device</h2><div class="tb-segs wrap" id="tbs-kind"><button type="button" class="tb-seg on" data-k="all">All</button><button type="button" class="tb-seg" data-k="things">Devices</button><button type="button" class="tb-seg" data-k="scenes">Scenes and automations</button></div><input class="tb-input" id="tbs-search" placeholder="Search…" aria-label="Search"><div class="tb-list tb-choices" id="tbs-list"><p>Loading…</p></div><button type="button" class="tb-btn" data-close>Cancel</button>`, true);
    box.dataset.edit = '1';
    let kind = 'all', done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    box.querySelector('[data-close]').addEventListener('click', () => finish(''));
    box.addEventListener('click', (e) => { if (e.target === box) finish(''); });
    const ents = (await tbEntities()).filter((e) => tmStepDomainOk(e.entity_id));
    const SCENES = ['scene', 'script', 'automation', 'button', 'input_button'];
    const paint = () => {
      const q = tbEl('tbs-search').value.trim().toLowerCase();
      const list = ents.filter((e) => (kind === 'all' || (kind === 'scenes') === SCENES.includes(tmDomain(e.entity_id))) && (!q || e.friendly_name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q))).slice(0, 120);
      tbEl('tbs-list').innerHTML = list.map((e) => `<button type="button" class="tb-choice" data-ref="${tbEsc(e.entity_id)}"><span>${tbEsc(e.friendly_name)}<small>${tbEsc(e.entity_id)}</small></span><em>${tbEsc(e.state)}</em></button>`).join('') || '<p>' + (ents.length ? 'No matches.' : 'Home Assistant is not set up. Connect it in Settings, Home Assistant first.') + '</p>';
      tbEl('tbs-list').querySelectorAll('.tb-choice').forEach((b) => b.addEventListener('click', () => finish(b.dataset.ref)));
    };
    box.querySelectorAll('#tbs-kind .tb-seg').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k; box.querySelectorAll('#tbs-kind .tb-seg').forEach((x) => x.classList.toggle('on', x === b)); paint(); }));
    tbEl('tbs-search').addEventListener('input', paint);
    paint();
  });
}
// The "Send a message" tile needs the words to send.
async function tbTextSheet(tile, closeAdd, at) {
  const { box, close } = tbSheet(`<h2>Message to send</h2><p>What should this button post to the message board?</p><input class="tb-input" id="tbt-text" maxlength="80" value="Dinner's ready"><div class="tb-row"><button type="button" class="tb-btn" data-close>Cancel</button><button type="button" class="tb-btn primary" id="tbt-ok">Add tile</button></div>`);
  box.dataset.edit = '1';
  box.querySelector('[data-close]').addEventListener('click', close);
  tbEl('tbt-ok').addEventListener('click', async () => {
    const text = tbEl('tbt-text').value.trim(); if (!text) return;
    tile.card_config = { text: text.slice(0, 80) }; tile.label = text.slice(0, 40);
    close(); closeAdd(); await tbPlaceTile(tile, at);
  });
}

// The lists and kids a Piazza HQ tile can point at come from the server; fill the boxes once they arrive.
async function tbFillCardOptions(t) {
  const boxes = [...document.querySelectorAll('#tb-panel select.tb-co')].filter((b) => b.dataset.type !== 'choice'); if (!boxes.length) return;
  for (const b of boxes) {
    const type = b.dataset.type, cur = String((t.card_config || {})[b.dataset.co] || '');
    const src = TM_OPTION_SOURCES[type]; if (!src) continue;
    const answers = await Promise.all(src.urls.map((u) => tbApi(u)));
    if (!b.isConnected || !answers.some(tbOk)) continue;
    b.innerHTML = tmOptionRows(type, answers.map((r) => (tbOk(r) ? tbList(r) : []))).map(([v, l]) => '<option value="' + tbEsc(v) + '"' + (v === cur ? ' selected' : '') + '>' + tbEsc(l) + '</option>').join('');
  }
}

// A scene or script tile that is to switch with something else becomes a tile that takes turns (the first press is what it ran); the person fills in the next ones. Nothing changes
// unless they finish with Done.
async function tbSwitchWith(t) {
  const name = ((await tbEntities()).find((e) => e.entity_id === t.ref) || {}).friendly_name || '';
  const draft = tmSwitchWithDraft(t, name);
  await tbRoutineEditor(draft, async () => { Object.assign(t, draft); tmStripUnlock(t); tbLastGrid = ''; tbPanelRender(); await tbEditCommit(); });
}
