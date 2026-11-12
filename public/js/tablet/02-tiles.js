// The /tablet web app, part 2: what each kind of tile shows and what a tap or a long press does. A tile is a Home Assistant device ("ha", ref = the entity id), a Piazza HQ tile
// ("card", ref = one of TB_CARDS below), a group of lights or switches ("group", members listed on the tile) or a camera ("camera", ref cam_<id>). Colors, size and label come
// from the tile's own stored fields, so the editor only has to change data. Icons and colors are shared with the editor: js/shared/tablet-icons.js.
'use strict';
const TB_CARDS = ['tonight_dinner', 'shopping_count', 'todo_count', 'next_up', 'send_message', 'screen_health', 'update_status', 'clock', 'weather', 'agenda', 'chores'];
const TB_WMO = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
// a thermostat's mode or what it is doing, in words a person reads (and the translations have)
const TB_MODES = { off: 'Off', heat: 'Heat', cool: 'Cool', heat_cool: 'Heat/Cool', auto: 'Auto', dry: 'Dry', fan_only: 'Fan', heating: 'Heating', cooling: 'Cooling', drying: 'Drying', fan: 'Fan', idle: 'Idle' };
const tbMode = (m) => TB_MODES[m] || m;
const tbList = (r) => (Array.isArray(r) ? r : (r && Array.isArray(r.__body) ? r.__body : []));
function tbColor(v) { if (!v) return ''; return TB_COLORS[v] || (/^#[0-9a-f]{6}$/i.test(v) ? v : ''); }
// black or white text, whichever reads better on the tile color
function tbInk(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150 ? '#0b1220' : '#ffffff';
}
const tbDomain = (ref) => String(ref).split('.')[0];
const tbIsOn = (e) => !!e && (e.state === 'on' || e.state === 'playing');
function tbHm(s) { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); if (!m) return ''; const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return tbFormatTime(d); }

// A trend line from history points [{t, v}]
function tbSparkSvg(points, w, h) {
  if (!points || points.length < 2) return '';
  const vs = points.map((p) => p.v), min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const pts = points.map((p, i) => `${(i / (points.length - 1) * w).toFixed(1)},${(h - 3 - ((p.v - min) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="tb-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
// does a sensor read past the limits set on its tile (a number above or below a line, or an exact state such as "on" for an open door)?
function tbPastLimit(tile, st) {
  if (tile.alert_state && st === tile.alert_state) return true;
  const n = parseFloat(st);
  if (Number.isFinite(n)) { if (tile.alert_above != null && n > tile.alert_above) return true; if (tile.alert_below != null && n < tile.alert_below) return true; }
  return false;
}

// The newer kinds of device (a robot vacuum or mower, a valve, a siren, a humidifier, a water heater, a number, a dropdown, an update, an alarm panel): the state in words and whether it counts as "on".
const TB_MORE_STATES = {
  vacuum: { docked: 'Docked', cleaning: 'Cleaning', returning: 'Returning to the dock', paused: 'Paused', idle: 'Idle', error: 'Needs help' },
  lawn_mower: { docked: 'Docked', mowing: 'Mowing', returning: 'Returning to the dock', paused: 'Paused', error: 'Needs help' },
  alarm_control_panel: { disarmed: 'Disarmed', armed_home: 'Armed, home', armed_away: 'Armed, away', armed_night: 'Armed, night', armed_vacation: 'Armed, vacation', armed_custom_bypass: 'Armed', arming: 'Arming…', pending: 'Pending…', disarming: 'Disarming…', triggered: 'Triggered' },
};
function tbMoreView(d, tile, e, st, base) {
  const ic = (n) => tile.icon || n, say = (m) => (st === 'unavailable' ? 'Unavailable' : (m && m[st]) || st);
  if (d === 'vacuum') return { ...base, icon: ic('vacuum'), on: st === 'cleaning' || st === 'returning', alert: st === 'error', state: say(TB_MORE_STATES.vacuum), defColor: 'teal' };
  if (d === 'lawn_mower') return { ...base, icon: ic('mower'), on: st === 'mowing' || st === 'returning', alert: st === 'error', state: say(TB_MORE_STATES.lawn_mower), defColor: 'green' };
  if (d === 'alarm_control_panel') return { ...base, icon: ic('shield'), on: st.startsWith('armed'), alert: st === 'triggered', state: say(TB_MORE_STATES.alarm_control_panel), defColor: 'red' };
  if (d === 'valve') return { ...base, icon: ic('drop'), on: st === 'open' || st === 'opening', state: st === 'unavailable' ? 'Unavailable' : st === 'open' ? 'Open' : st === 'opening' ? 'Opening' : st === 'closing' ? 'Closing' : 'Closed' };
  if (d === 'siren') return { ...base, icon: ic('bell'), on: st === 'on', alert: st === 'on', state: st === 'unavailable' ? 'Unavailable' : st === 'on' ? 'Sounding' : 'Off', defColor: 'red' };
  if (d === 'humidifier') { const x = TB.extra[tile.ref] || {}; return { ...base, icon: ic('drop'), on: st === 'on', state: st === 'unavailable' ? 'Unavailable' : st === 'on' ? (x.targetHumidity != null ? 'On, ' + x.targetHumidity + '%' : 'On') : 'Off', defColor: 'teal' }; }
  if (d === 'water_heater') return { ...base, icon: ic('temp'), on: st !== 'off' && st !== 'unavailable', state: st === 'unavailable' ? 'Unavailable' : st === 'off' ? 'Off' : st.replace(/_/g, ' '), defColor: 'amber' };
  if (d === 'number' || d === 'input_number') return { ...base, icon: ic('sliders'), still: true, state: (st + (e.unit ? ' ' + e.unit : '')).trim() };
  if (d === 'select' || d === 'input_select') return { ...base, icon: ic('list'), still: true, state: st };
  if (d === 'update') return { ...base, icon: ic('up'), on: st === 'on', state: st === 'unavailable' ? 'Unavailable' : st === 'on' ? 'Update available' : 'Up to date', defColor: 'amber' };
  return null;
}
// What a tile looks like right now: { icon, label, state, on, alert, step, still, offline, ... }. `on` fills it with its "on" color.
function tbView(tile) {
  if (tile.kind === 'card') return tbCardView(tile);
  if (tile.kind === 'camera') return tbCameraView(tile);
  if (tile.kind === 'group') return tbGroupView(tile);
  if (tile.kind === 'routine') return tbRoutineView(tile);
  const e = TB.ents[tile.ref], d = tbDomain(tile.ref), st = e ? String(e.state) : '';
  const name = tile.label || (e && e.friendly_name) || tile.ref;
  const base = { label: name, alert: false, step: false, still: false, on: false, defColor: 'blue' };
  if (!TB.haOk) return { ...base, icon: tile.icon || 'dot', state: 'Unreachable', still: true, offline: true };
  if (!e) return { ...base, icon: tile.icon || 'dot', state: 'Not found', still: true };
  if (d === 'light') return { ...base, icon: tile.icon || 'bulb', on: st === 'on', state: st === 'on' ? 'Switched on' : st === 'unavailable' ? 'Unavailable' : 'Switched off', defColor: 'amber' };
  if (d === 'automation' && tile.tap === 'run') return { ...base, icon: tile.icon || 'play', state: st === 'unavailable' ? 'Unavailable' : 'Tap to run' };
  if (d === 'switch' || d === 'input_boolean' || d === 'automation') return { ...base, icon: tile.icon || 'plug', on: st === 'on', state: st === 'on' ? 'Switched on' : st === 'unavailable' ? 'Unavailable' : 'Switched off', defColor: 'amber' };
  if (d === 'fan') return { ...base, icon: tile.icon || 'fan', on: st === 'on', state: st === 'on' ? 'Switched on' : 'Switched off', defColor: 'teal' };
  if (d === 'lock') { const open = st === 'unlocked' || st === 'unlocking' || st === 'open'; return { ...base, icon: tile.icon || 'lock', on: false, alert: open, state: open ? 'Unlocked' : st === 'jammed' ? 'Jammed' : 'Locked' }; }
  if (d === 'cover') { const open = st === 'open' || st === 'opening'; return { ...base, icon: tile.icon || 'cover', on: open, state: open ? 'Opened' : st === 'closing' ? 'Closing' : 'Closed' }; }
  if (d === 'media_player') return { ...base, icon: tile.icon || 'tv', on: st === 'on' || st === 'playing', state: st === 'playing' ? 'Playing' : st === 'on' ? 'Switched on' : st === 'paused' ? 'Paused' : 'Switched off' };
  if (d === 'button' || d === 'input_button') return { ...base, icon: tile.icon || 'play', state: st === 'unavailable' ? 'Unavailable' : 'Tap to press' };
  if (d === 'scene' || d === 'script') return { ...base, icon: tile.icon || 'play', on: d === 'script' && st === 'on', state: d === 'script' && st === 'on' ? 'Running' : 'Tap to run' };
  if (d === 'climate') { const x = TB.extra[tile.ref] || {}; return { ...base, icon: tile.icon || 'temp', step: true, target: x.targetTemp, now: x.currentTemp, state: x.hvacAction && x.hvacAction !== 'idle' ? x.hvacAction : st, alert: tbPastLimit(tile, st) }; }
  if (d === 'remote' && tile.remote && tile.remote.inline) return { ...base, icon: tile.icon || 'tv', inlineRemote: true, still: true, state: '' };          // a remote with its buttons on the tile
  { const more = tbMoreView(d, tile, e, st, base); if (more) return more; }
  // a sensor: its reading, a trend line when the tile asks for one, and red when it is past a limit
  const hist = TB.hist[tile.ref];
  const reading = d === 'binary_sensor' ? (st === 'on' ? 'On' : st === 'off' ? 'Off' : st) : (st + (e.unit ? ' ' + e.unit : '')).trim();
  return { ...base, icon: tile.icon || (tile.spark ? 'trend' : 'dot'), still: !tile.spark, state: reading, alert: tbPastLimit(tile, st), spark: tile.spark && hist ? tbSparkSvg(hist.points, 120, 34) : '' };
}

function tbGroupView(tile) {
  const mode = tile.group_mode || 'toggle', members = tile.members || [], on = members.filter((m) => tbIsOn(TB.ents[m])).length;
  const base = { label: tile.label || 'Group', icon: tile.icon || (mode === 'all_off' ? 'power' : 'layers'), alert: false, step: false, still: false, on: false, defColor: 'amber' };
  if (!TB.haOk) return { ...base, state: 'Unreachable', still: true, offline: true };
  if (mode === 'all_off') return { ...base, state: on ? `Turn off ${on} ${on === 1 ? 'device' : 'devices'}` : 'All off' };
  if (mode === 'all_on') return { ...base, state: 'Tap to turn all on', on: on === members.length };
  return { ...base, on: on > 0, state: on ? `${on} of ${members.length} on` : 'All off' };
}

// Which press a turn-taking tile ran last, or nothing when it has started over (its "start over after" time has passed since).
function tbCyclePos(tile) {
  const pos = TB.routineOn[tile.id], exp = (TB.routineOn._expires || {})[tile.id];
  return Number.isInteger(pos) && !(exp && Date.now() >= exp) ? pos : undefined;
}
// A routine tile: its mode says what it shows. A toggling one is lit when its device is on (or, with no device to read, when it last turned things on).
function tbRoutineView(tile) {
  const ro = tile.routine || {}, mode = ro.mode || 'run', lists = tmRoutineLists(ro);
  const base = { label: tile.label || 'Actions', icon: tile.icon || tmDefaultIcon(tile), alert: false, step: false, still: false, on: false, defColor: mode === 'toggle' ? 'amber' : 'blue', src: 'Actions' };
  if (!TB.haOk && tmRoutineRefs(ro).length) return { ...base, state: 'Unreachable', still: true, offline: true };
  if (mode === 'menu') return { ...base, state: lists.length === 1 ? 'One choice' : `${lists.length} choices` };
  if (mode === 'cycle') { const pos = tbCyclePos(tile), c = Number.isInteger(pos) ? (ro.choices || [])[pos] : null; return { ...base, state: c ? c.label : 'Tap to start' }; }   // what ran last
  if (mode === 'toggle' && lists.length > 1) {
    const on = tmRoutineIsOn(ro, TB.ents, TB.routineOn[tile.id]), gone = tmEntGone((TB.ents || {})[tmRoutineIndicator(ro)]);
    return { ...base, on: on && !gone, state: gone ? 'Not available' : on ? 'Switched on' : 'Switched off' };
  }
  return { ...base, state: 'Tap to run' };
}

function tbCameraView(tile) {
  const id = String(tile.ref).replace('cam_', ''), name = TB.cams[id];
  const lv = tile.live ? TB.live[id] : null, wait = lv ? (lv.state === 'on' ? '' : lv.state === 'failed' ? 'Live view unavailable' : 'Connecting…') : 'Tap for live view';   // a tile set to play live shows how that is going
  return { label: tile.label || name || 'Camera', icon: tile.icon || 'camera', state: name === undefined && TB.camsLoaded ? 'Camera not found' : TB.camKinds[id] === 'ha' && !TB.camImg[id] ? wait : '', camera: id, alert: false, step: false, still: false, on: false, defColor: 'blue' };
}

// The quick-action and extra Piazza HQ tiles (js/tablet/09-quick.js) register here: TB_CARD_EXTRA[ref] = { view(tile, base, wait), open(tile), refresh() }.
const TB_CARD_EXTRA = {};
// A Piazza HQ tile that opens a sheet is a real button (the others just show something).
function tbCardView(tile) {
  const v = tbCardViewBase(tile);
  if (TM_CARD_OPENABLE.includes(tile.ref) && tile.tap !== 'none' && !v.big) v.still = false;
  return v;
}
const tbCfg = (tile) => tile.card_config || {};
const tbDayStr = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
// A list tile (shopping, to-do, one kid's chores): the count; a first item or two when it is a row high; the items themselves, each with a box to tick, when it is two rows high or more.
function tbListView(tile, base, o) {
  const n = o.open.length, count = o.count(n), cap = Number(tbCfg(tile).items) || Math.max(3, tile.h * 3 - 1);
  const v = { ...base, label: o.label, icon: tile.icon || o.icon, state: count, still: false };
  if (tile.h >= 2 && n) v.items = o.open.slice(0, cap).map((i) => ({ key: o.key(i), text: o.text(i) }));
  else if (tile.h === 1 && tile.w >= 2 && n) v.state = count + ' · ' + o.open.slice(0, 2).map(o.text).join(', ');
  if (tile.h >= 2 && !n) v.state = o.empty;
  if (v.items && n > cap) v.more = n - cap;
  return v;
}
function tbCardViewBase(tile) {
  const c = TB.cards[tile.ref], base = { label: tile.label, icon: tile.icon, on: false, alert: false, step: false, still: false, defColor: 'blue', src: 'Piazza HQ' };
  const wait = (label, icon) => ({ ...base, label: tile.label || label, icon: tile.icon || icon, state: '…', still: true });
  const extra = TB_CARD_EXTRA[tile.ref]; if (extra && extra.view) return extra.view(tile, base, wait);
  if (tile.ref === 'clock') return { ...base, label: '', icon: '', big: true, still: true, state: '' };
  if (tile.ref === 'tonight_dinner') return c === undefined ? wait("Tonight's dinner", 'meal') : { ...base, label: tile.label || "Tonight's dinner", icon: tile.icon || 'meal', state: c && c.title ? c.title : 'Nothing planned', still: true };
  if (tile.ref === 'shopping_count') {
    const all = TB.cards.shop; if (all === undefined) return wait('Shopping list', 'check');
    const lid = Number(tbCfg(tile).list) || 0, list = lid ? (TB.cards.shopLists || []).find((l) => l.id === lid) : null;
    return tbListView(tile, base, { label: tile.label || (list ? list.name : 'Shopping list'), icon: 'check', open: (lid ? all.filter((i) => i.list_id === lid) : all).filter((i) => !i.done), key: (i) => 'shop:' + i.id, text: (i) => i.text, count: (n) => n + ' ' + (n === 1 ? 'item' : 'items'), empty: 'Nothing to buy' });
  }
  if (tile.ref === 'todo_count') {
    const lists = TB.cards.todoLists; if (lists === undefined) return wait('To-do', 'check');
    const lid = Number(tbCfg(tile).list) || 0, list = lid ? lists.find((l) => l.id === lid) : null;
    if (lid && list && (TB.cards.todoItems || {})[lid]) return tbListView(tile, base, { label: tile.label || list.name, icon: 'check', open: TB.cards.todoItems[lid].filter((i) => !i.done), key: (i) => 'todo:' + i.id, text: (i) => i.text, count: (n) => n + ' open', empty: 'All done' });
    const total = lists.reduce((n, l) => n + (l.itemCount || 0), 0), v = { ...base, label: tile.label || 'To-do', icon: tile.icon || 'check', state: total + ' open', still: false };
    if (tile.h >= 2 && lists.length) v.lines = lists.map((l) => ({ a: l.name, b: (l.itemCount || 0) + ' open' }));
    return v;
  }
  if (tile.ref === 'next_up') return c === undefined ? wait('Next up', 'cal') : { ...base, label: tile.label || 'Next up', icon: tile.icon || 'cal', state: c ? `${c.title}${c.when ? ', ' + c.when : ''}` : 'Nothing coming up', still: true };
  if (tile.ref === 'screen_health') return c === undefined ? wait('Screens', 'screen') : { ...base, label: tile.label || 'Screens', icon: tile.icon || 'screen', alert: !!(c && c.stuck), state: !c ? 'Unknown' : c.stuck ? `${c.stuck} need${c.stuck === 1 ? 's' : ''} attention` : c.repaired ? 'Fixed itself recently' : 'All good', still: true };
  if (tile.ref === 'update_status') return c === undefined ? wait('Updates', 'up') : { ...base, label: tile.label || 'Updates', icon: tile.icon || 'up', alert: false, on: !!(c && c.updateAvailable), state: !c ? 'Unknown' : c.updateAvailable ? `Update available: ${c.latest}` : 'Up to date', still: true, defColor: 'amber' };
  if (tile.ref === 'send_message') { const text = (tile.card_config && tile.card_config.text) || tile.label || 'Message'; return { ...base, label: tile.label || text, icon: tile.icon || 'msg', state: 'Tap to send', defColor: 'blue' }; }
  if (tile.ref === 'weather') {
    const w = TB.weather;
    if (!w || !w.current) return wait('Weather', 'cloud');
    const code = w.current.weather_code !== undefined ? w.current.weather_code : w.current.weathercode, dd = w.daily || {}, hi = (dd.temperature_2m_max || [])[0], lo = (dd.temperature_2m_min || [])[0];
    return { ...base, label: tile.label || TB_WMO[code] || 'Weather', icon: tile.icon || (code <= 1 ? 'sun' : 'cloud'), bigText: Math.round(w.current.temperature_2m) + '°', state: hi != null && lo != null ? `High ${Math.round(hi)}° · Low ${Math.round(lo)}°` : '', still: true, src: 'Weather' };
  }
  if (tile.ref === 'agenda') {
    if (c === undefined) return wait('Coming up', 'cal');
    const days = Number(tbCfg(tile).days) || 2, last = tbDayStr(days - 1), lines = (TB.cards.upcoming || []).filter((e) => e.date <= last).slice(0, 12).map((e) => {
      const t = e.start_time ? tbHm(e.start_time) : '', when = e.date === tbDayStr(0) ? [t || 'Today'] : e.date === tbDayStr(1) ? ['Tomorrow', t].filter(Boolean) : [e.date.slice(5).replace('-', '/'), t].filter(Boolean);
      return { a: when, b: e.title };                                // a is a list of words and times, each its own text so each can be translated
    });
    return { ...base, label: tile.label || 'Coming up', icon: tile.icon || 'cal', lines, state: lines.length ? '' : 'Nothing planned', still: true };
  }
  if (tile.ref === 'messages') {
    const list = TB.cards.messages; if (list === undefined) return wait('Messages', 'msg');
    const v = { ...base, label: tile.label || 'Messages', icon: tile.icon || 'msg', state: list.length ? list.length + ' ' + (list.length === 1 ? 'message' : 'messages') : 'No messages', still: false };
    if (tile.h >= 2 && list.length) v.lines = list.slice(0, Math.max(2, tile.h * 2)).map((m) => ({ a: m.author || '', b: m.text }));
    return v;
  }
  if (tile.ref === 'chores') {
    if (c === undefined) return wait('Chores', 'broom');
    const kid = tbCfg(tile).kid ? (TB.cards.choresRaw || []).find((k) => String(k.id) === String(tbCfg(tile).kid)) : null;
    if (kid) {
      const mine = kid.chores || [], open = mine.filter((x) => !x.done);
      return tbListView(tile, base, { label: tile.label || kid.name, icon: 'broom', open, key: (x) => 'chore:' + x.instance_id, text: (x) => x.title, count: () => (mine.length - open.length) + ' of ' + mine.length + ' done', empty: mine.length ? 'All done ✓' : 'No chores today' });
    }
    const left = c.reduce((n, k) => n + (k.total - k.done), 0);
    return { ...base, label: tile.label || 'Chores', icon: tile.icon || 'broom', lines: c.filter((k) => k.total).map((k) => ({ a: k.name, b: `${k.done} of ${k.total} done` })), state: c.some((k) => k.total) ? (left ? `${left} to do today` : 'All done today') : 'No chores today', on: c.some((k) => k.total) && !left, defColor: 'green', still: true };
  }
  return { ...base, label: tile.label || tile.ref, icon: tile.icon || 'dot', state: 'Not available', still: true };
}

// one line of a list tile: a bold lead (a list of words, each its own text) and the text after it
const tbLineHtml = (l) => `<li><b>${(Array.isArray(l.a) ? l.a : [l.a]).map((p) => `<span>${tbEsc(p)}</span>`).join(' ')}</b> <span>${tbEsc(l.b)}</span></li>`;

// ── drawing one tile ───────────────────────────────────────────────────────────────────────────────────────────────────
// The buttons of an on-screen remote drawn on its own tile (the tile's option "Show the buttons on the tile"): the same buttons as in the pad that opens from a tap, in the same order, with the tile's own buttons under them.
// A press goes through tbRemotePress (see the click handler in 03-page.js). While the tablet is being rearranged they do nothing.
function tbRemoteInlineHtml(tile, label) {
  const cfg = tile.remote || { preset: 'custom' }, names = Object.fromEntries(TM_REMOTE_KEYS);
  const key = (k) => (tmRemoteCommand(cfg, k) ? `<button type="button" class="tb-rkey" data-key="${k}" aria-label="${tbEsc(names[k])}">${tbEsc(names[k])}</button>` : '<span></span>');
  const ordered = tmRemoteItems(cfg);                                                    // the buttons in the order the person arranged them
  const arranged = ordered ? ordered.map((id) => { if (names[id]) return key(id); const ci = (cfg.custom || []).findIndex((c, i) => tmCustomId(c, i) === id), c = cfg.custom[ci]; return `<button type="button" class="tb-rkey" data-custom="${ci}">${tbEsc(c.label || c.command)}</button>`; }).join('') : '';
  const pad = ordered ? arranged : TM_PAD_ORDER.map(key).join('');
  const custom = ordered ? '' : (cfg.custom || []).map((c, i) => `<button type="button" class="tb-rkey" data-custom="${i}">${tbEsc(c.label || c.command)}</button>`).join('');
  const any = pad.includes('data-key') || pad.includes('data-custom') || custom;
  return `<div class="tb-rlabel">${tbEsc(label)}</div>${any ? `<div class="tb-rmini">${pad}</div>${custom ? `<div class="tb-rmini tb-rmini-custom">${custom}</div>` : ''}` : '<div class="tb-state">No buttons yet</div>'}`;
}
function tbTileHtml(tile) {
  const v = tbView(tile);
  const fl = TB.flash[tile.id];
  if (fl && fl.until > Date.now()) { v.state = fl.text; v.on = true; v.alert = false; }
  const failed = (TB.failed[tile.id] || 0) > Date.now(), busy = !!TB.busy[tile.id];
  const onColor = tbColor(tile.color_on) || TB_COLORS[v.defColor] || TB_COLORS.blue;
  const offColor = tbColor(tile.color_off);
  const fill = v.on ? onColor : (tbIsStateless(tile) && tbColor(tile.color_on)) || offColor;     // a tile with no on/off of its own wears its color all the time
  const style = [`grid-column:${tile._col}`, `grid-row:${tile._row}`];
  if (fill && !v.camera) { style.push(`background:${fill}`, `border-color:${fill}`, `color:${tbInk(fill)}`, `--fill:${fill}`); }
  const cls = `tb-tile t-${tile.text_size === 'small' ? 'small' : tile.text_size === 'large' ? 'large' : 'normal'}${tile.w === 1 ? ' w1' : ''}${tile.h === 1 ? ' h1' : ''}${v.alert ? ' alert' : ''}${v.still ? ' static' : ''}${v.offline ? ' offline' : ''}${failed ? ' failed' : ''}${busy ? ' busy' : ''}${v.camera ? ' cam' : ''}${tile._hidden ? ' phone-hidden' : ''}${tile._compact ? ' pc' : ''}${tile._narrow ? ' pn' : ''}`;
  if (v.inlineRemote) return `<div class="${cls} remote-inline${tile.phone_h === 'compact' ? ' rk-c' : tile.phone_h === 'tall' ? ' rk-t' : ''}" style="${style.join(';')}" data-tile="${tbEsc(tile.id)}">${tbRemoteInlineHtml(tile, v.label)}</div>`;
  if (v.big) return `<div class="${cls}" style="${style.join(';')}" data-tile="${tbEsc(tile.id)}"><div class="tb-big" data-tb-clock></div></div>`;
  if (v.camera) return `<button type="button" class="${cls}${tile.fit === 'contain' ? ' fit-contain' : ''}" style="${style.join(';')}" data-tile="${tbEsc(tile.id)}"><img class="tb-cam" data-cam="${tbEsc(v.camera)}" alt="">${tile.live ? `<span class="tb-livebox" data-livebox="${tbEsc(v.camera)}"></span>` : ''}<span class="tb-camlabel">${tbEsc(v.label)}${v.state ? ' · ' + tbEsc(v.state) : ''}</span></button>`;
  if (v.bg) return `<button type="button" class="${cls} photo" style="${style.join(';')};background-image:url('${tbEsc(v.bg)}')" data-tile="${tbEsc(tile.id)}"><span class="tb-camlabel">${tbEsc(v.label)}</span></button>`;
  const head = `<span class="tb-top"><span class="tb-ico">${tbSvg(v.icon)}</span><span class="tb-src">${tbEsc(v.src || (tile.kind === 'ha' ? 'Home' : tile.kind === 'group' ? 'Group' : ''))}</span></span>`;
  if (v.step) {
    const compact = tile.h === 1;                                  // one row high: no header, the name sits above the number
    return `<div class="${cls}" style="${style.join(';')}" data-tile="${tbEsc(tile.id)}">${compact ? '' : head}
      <div class="tb-step"><button type="button" class="tb-stepbtn" data-step="-1" aria-label="Lower the temperature">&minus;</button>
      <div style="text-align:center;min-width:0">${compact ? `<div class="tb-state tb-stepname">${tbEsc(v.label)}</div>` : ''}<div class="tb-big">${v.target != null ? tbEsc(Math.round(v.target * 2) / 2) + '°' : '--'}</div><div class="tb-state">${v.now != null ? `<span>Now ${tbEsc(v.now)}°</span> ` : ''}<span>${tbEsc(tbMode(v.state))}</span></div></div>
      <button type="button" class="tb-stepbtn" data-step="1" aria-label="Raise the temperature">+</button></div>
      ${compact ? '' : `<div class="tb-label">${tbEsc(v.label)}</div>`}</div>`;
  }
  const tag = v.still ? 'div' : 'button';
  const items = v.items && v.items.length ? '<ul class="tb-checks">' + v.items.map((i) => '<li class="tb-chk" data-chk="' + tbEsc(i.key) + '" role="checkbox" aria-checked="false" tabindex="0"><span class="tb-box"></span><span>' + tbEsc(i.text) + '</span></li>').join('') + (v.more ? '<li class="tb-more">+' + v.more + ' <span>more</span></li>' : '') + '</ul>' : '';
  const lines = v.lines && v.lines.length ? `<ul class="tb-lines">${v.lines.slice(0, Math.max(2, tile.h * 3)).map(tbLineHtml).join('')}</ul>` : '';
  return `<${tag} ${v.still ? '' : 'type="button"'} class="${cls}" style="${style.join(';')}" data-tile="${tbEsc(tile.id)}">${head}
    <span class="tb-body">${v.bigText ? `<span class="tb-bigtext"${v.timer ? ' data-tb-timer' : ''}>${tbEsc(v.bigText)}</span>` : ''}<span class="tb-label">${tbEsc(v.label)}</span>${v.state ? `<span class="tb-state">${tbEsc(v.state)}</span>` : ''}${v.bar != null ? `<span class="tb-bar"><i style="width:${Math.max(0, Math.min(100, v.bar))}%"></i></span>` : ''}${items}${lines}</span>${v.spark ? `<span class="tb-sparkwrap">${v.spark}</span>` : ''}</${tag}>`;
}

// ── data the tiles show ────────────────────────────────────────────────────────────────────────────────────────────────
function tbTilesOf(layout) { return layout.pages.reduce((all, p) => all.concat(p.tiles), []); }
async function tbRefreshHa() {
  const tiles = tbTilesOf(TB.layout).filter((t) => t.kind === 'ha' || t.kind === 'group' || t.kind === 'routine');
  if (!tiles.length) return;
  if (tiles.some((t) => t.kind === 'routine' && ['toggle', 'cycle'].includes((t.routine || {}).mode))) {
    const s = await tbApi(`/api/tablets/${encodeURIComponent(TB.id)}/routine-state`);
    if (tbOk(s)) TB.routineOn = { ...s };
  }
  const r = await tbApi('/api/ha/entities');
  const list = tbList(r);
  if (tbOk(r) && list.length) { TB.haOk = true; TB.ents = {}; list.forEach((e) => { TB.ents[e.entity_id] = e; }); }
  else if (r && !r.__networkError) TB.haOk = false;
  await Promise.all(tiles.filter((t) => t.kind === 'ha' && tbDomain(t.ref) === 'climate').map(async (t) => { const x = await tbApi('/api/ha/state/' + encodeURIComponent(t.ref)); if (tbOk(x) && x.entity_id) TB.extra[t.ref] = x; }));
  await Promise.all(tiles.filter((t) => t.kind === 'ha' && t.spark).map(async (t) => {
    const h = TB.hist[t.ref];
    if (h && Date.now() - h.at < 5 * 60000) return;
    const x = await tbApi(`/api/ha/history/${encodeURIComponent(t.ref)}?hours=${t.spark_hours || 24}`);
    if (tbOk(x) && Array.isArray(x.points)) TB.hist[t.ref] = { at: Date.now(), points: x.points };
  }));
}
async function tbRefreshWeather() {
  if (TB.weatherAt && Date.now() - TB.weatherAt < 15 * 60000) return;
  const w = await tbApi('/api/weather');
  if (tbOk(w) && w.current) { TB.weather = w; TB.weatherAt = Date.now(); }
}
async function tbRefreshCards() {
  const refs = new Set(tbTilesOf(TB.layout).filter((t) => t.kind === 'card').map((t) => t.ref));
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const jobs = [];
  if (refs.has('tonight_dinner')) jobs.push(tbApi(`/api/meals?from=${day(0)}&to=${day(0)}`).then((r) => { const m = tbList(r).find((x) => (x.slot || 'dinner') === 'dinner'); TB.cards.tonight_dinner = m || null; }));
  if (refs.has('shopping_count')) jobs.push(Promise.all([tbApi('/api/shopping-list?list=all'), tbApi('/api/shopping-lists')]).then(([r, l]) => { if (tbOk(l)) TB.cards.shopLists = tbList(l); if (tbOk(r)) TB.cards.shop = tbList(r); }));
  if (refs.has('todo_count')) jobs.push(tbApi('/api/todo-lists').then(async (r) => {
    if (!tbOk(r)) return;
    TB.cards.todoLists = tbList(r); TB.cards.todoItems = TB.cards.todoItems || {};
    const want = new Set(tbTilesOf(TB.layout).filter((t) => t.kind === 'card' && t.ref === 'todo_count' && t.card_config && t.card_config.list).map((t) => Number(t.card_config.list)));   // a tile for one list shows that list's items
    await Promise.all([...want].map(async (id) => { const x = await tbApi('/api/todo-lists/' + id + '/items'); if (tbOk(x)) TB.cards.todoItems[id] = tbList(x); }));
  }));
  if (refs.has('next_up') || refs.has('agenda')) jobs.push(tbApi(`/api/events?from=${day(0)}&to=${day(7)}`).then((r) => {
    if (!tbOk(r)) return;
    const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const upcoming = tbList(r).filter((e) => e.date > day(0) || !e.start_time || e.start_time >= hhmm).sort((a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || '')));
    const ev = upcoming[0];
    TB.cards.upcoming = upcoming;
    TB.cards.next_up = ev ? { title: ev.title, when: ev.date === day(0) ? (ev.start_time || 'today') : ev.date === day(1) ? 'tomorrow' : ev.date } : null;
    TB.cards.agenda = true;                                          // the lines are made when drawn, because each tile can ask for a different number of days
  }));
  for (const [ref, ex] of Object.entries(TB_CARD_EXTRA)) if (ex.refresh && refs.has(ref)) jobs.push(ex.refresh());
  if (refs.has('chores') || refs.has('chores_progress') || refs.has('sticker_balances')) jobs.push(tbApi('/api/chore-chart').then((r) => { if (tbOk(r) && r && Array.isArray(r.kids)) TB.cards.choresRaw = r.kids; TB.cards.chores = r.kids.map((k) => ({ name: k.name, total: (k.chores || []).length, done: (k.chores || []).filter((c) => c.done).length })); }));
  if (refs.has('messages')) jobs.push(tbApi('/api/messages').then((r) => { if (tbOk(r)) TB.cards.messages = tbList(r); }));
  if (refs.has('screen_health')) jobs.push(tbApi('/api/screen-health').then((r) => { if (tbOk(r) && r.summary) TB.cards.screen_health = r.summary; }));
  if (refs.has('update_status')) jobs.push(tbApi('/api/version-status').then((r) => { if (tbOk(r) && r.version) TB.cards.update_status = r; }));
  if (refs.has('weather')) jobs.push(tbRefreshWeather());
  await Promise.all(jobs);
}

// ── cameras: a still picture on the tile that refreshes every few seconds; a tap opens the live view ─────────────────────
async function tbFetchBlobUrl(path) {
  const headers = {}, tok = tbStore(TB_TOKEN_KEY); if (tok) headers['x-session-token'] = tok;
  try { const res = await fetch(path, { headers, cache: 'no-store' }); if (!res.ok) return ''; return URL.createObjectURL(await res.blob()); } catch { return ''; }
}
function tbPaintCams() {
  document.querySelectorAll('img[data-cam]').forEach((img) => { const u = TB.camImg[img.dataset.cam]; if (u && img.getAttribute('src') !== u) img.src = u; });
  tbLiveSync();
}
async function tbRefreshCams() {
  const page = TB.layout.pages[TB.page] || TB.layout.pages[0], cams = page.tiles.filter((t) => t.kind === 'camera');
  if (!cams.length) return;
  if (!TB.camsAt || Date.now() - TB.camsAt > 120000) {
    const r = await tbApi('/api/cameras');
    if (tbOk(r)) { TB.cams = {}; TB.camKinds = {}; tbList(r).forEach((c) => { TB.cams[String(c.id)] = c.name; TB.camKinds[String(c.id)] = c.kind; }); TB.camsLoaded = true; TB.camsAt = Date.now(); tbRedraw(); }   // the names are known now: draw them
  }
  await Promise.all(cams.map(async (t) => {
    const id = String(t.ref).replace('cam_', '');
    if (t.live && TB.live[id] && TB.live[id].state === 'on') return;          // its live video is playing: no need for stills
    const u = await tbFetchBlobUrl(`/api/camera/${encodeURIComponent(id)}/frame.jpeg?ts=${Date.now()}`);
    if (!u) return;
    const old = TB.camImg[id]; TB.camImg[id] = u; if (old) URL.revokeObjectURL(old);
  }));
  tbPaintCams();
}
function tbLoadRtc() {
  return new Promise((resolve) => {
    if (window.customElements && customElements.get('video-stream')) return resolve(true);
    const s = document.createElement('script'); s.src = '/vendor/video-rtc.js';
    s.onload = () => resolve(!!(window.customElements && customElements.get('video-stream'))); s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
// Live video of a Home Assistant camera through the server's relay (js: /api/camera/:id/ha-webrtc): Nest cameras only offer WebRTC, which Home Assistant brokers.
// Returns { ok: Promise<boolean> (true once video is flowing; false when it cannot be), stop() }.
// `onend` (optional) is called when the video drops after it had been playing, so a live tile can start again.
function tbHaLive(live, id, onend) {
  const v = document.createElement('video');
  v.className = 'tb-camvideo'; v.autoplay = true; v.muted = true; v.setAttribute('playsinline', '');
  let pc = null, ws = null, done = false, stopped = false, wasOk = false, resolveOk;
  const ok = new Promise((r) => { resolveOk = r; });
  const finish = (good) => { if (done) return; done = true; wasOk = good; clearTimeout(timer); resolveOk(good); };
  const ended = () => { if (stopped || !wasOk) return; stopped = true; if (onend) onend(); };
  const stop = () => { done = true; stopped = true; clearTimeout(timer); try { ws && ws.close(); } catch { /* closed */ } try { pc && pc.close(); } catch { /* closed */ } v.srcObject = null; };
  const timer = setTimeout(() => { stop(); resolveOk(false); }, 15000);
  const send = (o) => { try { ws.send(JSON.stringify(o)); } catch { /* closed */ } };
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + `/api/camera/${encodeURIComponent(id)}/ha-webrtc`); } catch { finish(false); return { ok, stop }; }
  ws.onerror = () => finish(false);
  ws.onclose = () => { finish(false); ended(); };
  ws.onmessage = async (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    try {
      if (m.type === 'config') {
        pc = new RTCPeerConnection({ iceServers: m.iceServers || [] });
        pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' });
        pc.createDataChannel(m.dataChannel || 'dataSendChannel');           // the camera's service wants a data channel in the offer (Home Assistant names it)
        pc.ontrack = (ev) => { if (!v.srcObject) v.srcObject = new MediaStream(); v.srcObject.addTrack(ev.track); v.play().catch(() => { /* needs a touch on some browsers; it is muted so it normally plays */ }); };
        pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') finish(true); else if (pc.connectionState === 'failed') { finish(false); ended(); } };
        pc.onicecandidate = (ev) => { if (ev.candidate && !m.getCandidatesUpfront) send({ type: 'candidate', candidate: ev.candidate.toJSON() }); };
        await pc.setLocalDescription(await pc.createOffer());
        if (m.getCandidatesUpfront) await new Promise((r) => { if (pc.iceGatheringState === 'complete') return r(); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') r(); }; setTimeout(r, 3000); });
        send({ type: 'offer', sdp: pc.localDescription.sdp });
      } else if (m.type === 'answer' && pc) await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      else if (m.type === 'candidate' && pc) { try { await pc.addIceCandidate(m.candidate); } catch { /* a late or unusable candidate */ } }
      else if (m.type === 'error') finish(false);
    } catch { finish(false); }
  };
  live.appendChild(v);
  return { ok, stop };
}
// ── live video on a tile: a camera tile with "Live on the tile" plays its camera itself ──────────────────────────────────
// Only the tiles on the page being shown, at most TB_LIVE_MAX at a time (Home Assistant's relay allows four), and none while the idle screen is up, the tablet is being edited,
// the browser tab is hidden, or that camera's big live view is open (it would be a second stream of the same camera). tbLiveSync starts and stops them as that changes; it runs
// after every redraw of the grid and on the camera refresh. A stream that drops, or cannot start, is tried again after a growing wait (8 s, 16 s ... up to a minute).
const TB_LIVE_MAX = 4;
function tbLiveWanted() {
  if (!TB.layout || TB.idle || document.hidden || TB.edit || !TB.camsLoaded || tbSaver()) return [];
  const page = TB.layout.pages[TB.page] || TB.layout.pages[0];
  const ids = page.tiles.filter((t) => t.kind === 'camera' && t.live).map((t) => String(t.ref).replace('cam_', ''));
  return ids.filter((id, i) => ids.indexOf(id) === i && TB.camKinds[id] && !TB.camOpen[id]).slice(0, TB_LIVE_MAX);
}
function tbLiveStart(id) {
  const prev = TB.live[id], holder = document.createElement('div');
  const entry = { state: 'connecting', stop() { /* nothing started yet */ }, el: null, fails: prev ? prev.fails : 0, retryAt: 0 };
  TB.live[id] = entry;
  const fail = () => { entry.stop(); if (entry.el) entry.el.remove(); entry.el = null; entry.state = 'failed'; entry.fails++; entry.retryAt = Date.now() + Math.min(60000, 8000 * entry.fails); tbRedraw(); };
  const on = () => { entry.state = 'on'; entry.fails = 0; tbRedraw(); tbLiveMount(); };
  if (TB.camKinds[id] === 'ha') {
    if (!window.RTCPeerConnection) { fail(); return; }
    const h = tbHaLive(holder, id, () => { if (TB.live[id] === entry) fail(); });
    entry.stop = h.stop; entry.el = holder.firstChild;
    h.ok.then((good) => { if (TB.live[id] !== entry) return; if (good) on(); else fail(); });
  } else {                                                          // an ordinary camera: the same player as the big view
    tbLoadRtc().then((have) => {
      if (TB.live[id] !== entry) return;
      if (!have) { fail(); return; }
      const vs = document.createElement('video-stream');
      vs.className = 'tb-camvideo'; vs.background = true; vs.media = 'video,audio'; vs.mode = 'webrtc,mse,mjpeg';
      vs.src = `/api/camera/${encodeURIComponent(id)}/ws`;
      holder.appendChild(vs); entry.el = vs;
      entry.stop = () => { try { vs.src = ''; } catch { /* already gone */ } vs.remove(); };
      setTimeout(() => { if (vs.video) { vs.video.controls = false; vs.video.muted = true; vs.video.setAttribute('playsinline', ''); } }, 0);
      on();
    });
  }
}
// Put each playing video into its tile's slot (a redraw of the grid made new, empty slots). A video taken out of the page pauses, so start it again.
function tbLiveMount() {
  const seen = new Set();
  document.querySelectorAll('[data-livebox]').forEach((box) => {
    const id = box.dataset.livebox, e = TB.live[id];
    if (seen.has(id) || !e || !e.el) return;
    seen.add(id);
    if (e.el.parentNode !== box) { box.appendChild(e.el); if (e.el.play) e.el.play().catch(() => { /* muted, so this normally works; otherwise it starts on the next touch */ }); }
    tbSoundApply(id);
  });
  tbSoundIcons();
}

// ── sound on live tiles ─────────────────────────────────────────────────────────────────────────────────────────────────
// Live video starts muted (a browser only lets video play by itself when it is silent). A small speaker on the tile turns the sound on and off; the choice is remembered for each camera
// on this tablet. After the page is opened again the video is silent until the first touch anywhere (the browser's rule), then the remembered sound comes on by itself.
const TB_SOUND_KEY = 'phq_cam_sound';
function tbSoundMap() { try { const m = JSON.parse(tbStore(TB_SOUND_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch { return {}; } }
const tbSoundPref = (id) => !!tbSoundMap()[id];
function tbSoundSet(id, on) { const m = tbSoundMap(); if (on) m[id] = true; else delete m[id]; tbStore(TB_SOUND_KEY, JSON.stringify(m)); }
const tbLiveVideo = (e) => (e && e.el ? e.el.video || e.el : null);          // the <video>, or the one inside the ordinary player
// Make the video match the remembered choice, as far as the browser allows sound yet.
function tbSoundApply(id) {
  const v = tbLiveVideo(TB.live[id]);
  if (!v || !('muted' in v)) return;
  const want = tbSoundPref(id) && !!TB.gesture;
  if (v.muted === !want) return;
  v.muted = !want;
  if (want && v.play) v.play().catch(() => { v.muted = true; });             // the browser said no after all: stay silent
}
function tbSoundAll() { Object.keys(TB.live).forEach(tbSoundApply); tbSoundIcons(); }
const TB_SPK_ON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
const TB_SPK_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l5 6M21 9l-5 6"/></svg>';
// The speaker sits on the tile, added here rather than in the tile's markup so that turning the sound on or off does not redraw the grid. Only on a tile whose video is playing, and (for a
// Home Assistant camera, where it is known) only when the camera sends sound.
function tbSoundIcons() {
  document.querySelectorAll('.tb-spk').forEach((b) => { const e = TB.live[b.dataset.cam]; if (!e || !e.el || e.el.parentNode !== (b.parentNode && b.parentNode.querySelector('[data-livebox]'))) b.remove(); });
  document.querySelectorAll('[data-livebox]').forEach((box) => {
    const id = box.dataset.livebox, e = TB.live[id], tile = box.closest('.tb-tile');
    if (!tile || !e || e.state !== 'on' || e.el.parentNode !== box) return;
    const v = tbLiveVideo(e), hasAudio = !(v && v.srcObject && v.srcObject.getAudioTracks && TB.camKinds[id] === 'ha') || v.srcObject.getAudioTracks().length > 0;
    let b = tile.querySelector('.tb-spk');
    if (!hasAudio) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'tb-spk'; b.setAttribute('role', 'button'); b.tabIndex = 0; b.dataset.cam = id; tile.appendChild(b); }
    const on = !!(v && !v.muted), state = on ? 'on' : 'off';
    if (b.dataset.s !== state) { b.dataset.s = state; b.innerHTML = on ? TB_SPK_ON : TB_SPK_OFF; b.setAttribute('aria-label', on ? 'Turn the sound off' : 'Turn the sound on'); b.setAttribute('aria-pressed', String(on)); }
    b.classList.toggle('on', on);
  });
}
// A tap on the speaker (a touch, so the browser lets sound start).
function tbToggleSound(id) {
  const v = tbLiveVideo(TB.live[id]);
  if (!v) return;
  TB.gesture = true;
  const on = v.muted;
  tbSoundSet(id, on);
  v.muted = !on;
  if (on && v.play) v.play().catch(() => { v.muted = true; });
  tbSoundAll();                                                                  // the other cameras can now start their remembered sound too
}
function tbLiveSync() {
  const want = tbLiveWanted();
  let changed = false;
  Object.keys(TB.live).forEach((id) => { if (!want.includes(id)) { const e = TB.live[id]; e.stop(); if (e.el) e.el.remove(); delete TB.live[id]; changed = true; } });   // the stopped video leaves its tile
  want.forEach((id) => { const e = TB.live[id]; if (!e || (e.state === 'failed' && Date.now() >= e.retryAt)) { tbLiveStart(id); changed = true; } });
  tbLiveMount();
  if (changed) tbRedraw();                                           // the tile's line ("Connecting…") follows what is happening
}

async function tbCamLive(tile) {
  const id = String(tile.ref).replace('cam_', ''), name = tile.label || TB.cams[id] || 'Camera';
  TB.camOpen[id] = true; tbLiveSync();                                // the tile's own live video makes way for the big one
  const box = document.createElement('div');
  box.className = 'tb-overlay tb-camview';
  box.innerHTML = `<div class="tb-camframe"><div class="tb-camtitle">${tbEsc(name)}</div><div class="tb-camlive"></div><button type="button" class="tb-btn" data-sound hidden>Turn the sound on</button><button type="button" class="tb-btn primary" data-close>Close</button></div>`;
  tbEl('tb-overlays').appendChild(box);
  const live = box.querySelector('.tb-camlive');
  let timer = null;
  let haStop = null;
  const close = () => { clearInterval(timer); if (haStop) haStop(); live.innerHTML = ''; box.remove(); delete TB.camOpen[id]; tbLiveSync(); };
  box.querySelector('[data-close]').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  // The sound button: shares the choice remembered for this camera. Shown once there is video (and, where it is known, sound to hear).
  const sb = box.querySelector('[data-sound]'), vid = () => live.querySelector('video');
  const paint = () => {
    const v = vid(), noAudio = v && v.srcObject && v.srcObject.getAudioTracks && TB.camKinds[id] === 'ha' && !v.srcObject.getAudioTracks().length;
    sb.hidden = !v || !!noAudio; sb.textContent = v && !v.muted ? 'Turn the sound off' : 'Turn the sound on';
  };
  const apply = () => { const v = vid(); if (v && tbSoundPref(id)) { v.muted = false; v.play().catch(() => { v.muted = true; }); } paint(); };
  sb.addEventListener('click', () => { const v = vid(); if (!v) return; const on = v.muted; tbSoundSet(id, on); v.muted = !on; if (on) v.play().catch(() => { v.muted = true; }); paint(); });
  const stills = () => {                                         // a still picture every second when live video cannot play here
    const img = document.createElement('img'); img.className = 'tb-camstill'; live.innerHTML = ''; live.appendChild(img);
    const go = async () => { const u = await tbFetchBlobUrl(`/api/camera/${encodeURIComponent(id)}/frame.jpeg?ts=${Date.now()}`); if (u) { const o = img.src; img.src = u; if (o.startsWith('blob:')) URL.revokeObjectURL(o); } };
    go(); timer = setInterval(go, 1000);
  };
  if (TB.camKinds[id] === 'ha' && window.RTCPeerConnection) {              // a Home Assistant camera (Nest): live video by way of Home Assistant's WebRTC
    live.innerHTML = '<p class="tb-camwait">Connecting…</p>';
    const h = tbHaLive(live, id); haStop = h.stop;
    if (await h.ok) { const w = live.querySelector('.tb-camwait'); if (w) w.remove(); apply(); setTimeout(paint, 1500); return; }
    h.stop(); haStop = null;
    if (!box.isConnected) return;
    live.innerHTML = '<p class="tb-camwait">Live view is not available for this camera right now.</p>';
    return;
  }
  if (!(await tbLoadRtc())) { stills(); return; }
  try {
    const vs = document.createElement('video-stream');
    vs.background = true; vs.media = 'video,audio'; vs.mode = 'webrtc,mse,mjpeg';
    live.appendChild(vs); vs.src = `/api/camera/${encodeURIComponent(id)}/ws`;
    setTimeout(() => { if (vs.video) { vs.video.controls = false; vs.video.muted = true; vs.video.setAttribute('playsinline', ''); vs.video.poster = TB.camImg[id] || ''; } apply(); }, 0);
    setTimeout(paint, 2000);
  } catch { stills(); }
}

// ── feedback: a short buzz or click on a touch, a shake when something did not work, and a brief "Done" after a scene ─────────────
let tbAudio = null;
function tbFeedback(kind) {
  const th = TB.layout && TB.layout.theme ? TB.layout.theme : {};
  try { if (th.haptics !== false && navigator.vibrate) navigator.vibrate(kind === 'fail' ? [30, 40, 30] : 12); } catch { /* not offered here */ }
  if (!th.sound) return;
  try {
    tbAudio = tbAudio || new (window.AudioContext || window.webkitAudioContext)();
    const o = tbAudio.createOscillator(), g = tbAudio.createGain();
    o.frequency.value = kind === 'fail' ? 180 : 880; g.gain.value = 0.04;
    o.connect(g); g.connect(tbAudio.destination); o.start(); o.stop(tbAudio.currentTime + (kind === 'fail' ? 0.18 : 0.05));
  } catch { /* no audio */ }
}
function tbFlash(tile, text, ms) {
  TB.flash[tile.id] = { until: Date.now() + (ms || 2200), text: text || 'Done ✓' };
  tbRedraw(); setTimeout(tbRedraw, (ms || 2200) + 60);
}
function tbBusy(tile, on) { if (on) TB.busy[tile.id] = true; else delete TB.busy[tile.id]; tbRedraw(); }
function tbFail(tile, msg) {
  TB.failed[tile.id] = Date.now() + 3000;
  tbToast(msg || 'That did not work.'); tbFeedback('fail'); tbRedraw(); setTimeout(tbRedraw, 3100);
}

// ── taps ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function tbHaAction(tile) {
  const d = tbDomain(tile.ref), e = TB.ents[tile.ref], st = e ? String(e.state) : '';
  if (tile.tap === 'none' || tile.tap === 'details') return '';
  if (tile.tap === 'turn_on' || tile.tap === 'turn_off') return tile.tap;
  if (tile.tap === 'run') return d === 'automation' ? 'run_automation' : d === 'scene' || d === 'script' ? 'trigger' : '';
  if (d === 'lock') return st === 'locked' ? 'unlock' : 'lock';
  if (d === 'cover') return st === 'open' || st === 'opening' ? 'close_cover' : 'open_cover';
  if (d === 'scene' || d === 'script') return 'trigger';
  if (d === 'button' || d === 'input_button') return 'press_button';
  if (['light', 'switch', 'fan', 'input_boolean', 'media_player', 'automation'].includes(d)) return 'toggle';
  return '';
}
// One call to a Home Assistant device through the server (which checks the PIN when the tile or the device needs it). `entityId` is for a member of a group.
const tbPreviewBlock = () => { if (TB.preview) { tbToast('This is only a preview. Nothing was changed.'); return true; } return false; };
// The PIN for a tile that needs one: the digits typed, '' when none is needed (the tablet has no PIN and Settings lets such tiles work without one), or null when it must stop (cancelled, or there is no PIN and none
// is allowed: a hint says where to set one).
async function tbTilePin(title) {
  if (!TB.pinSet) { if (TB.pinOptional) return ''; tbToast('This tile needs a PIN. Set a tablet PIN in the Piazza HQ app: Settings, Security, Tablet PIN. (Or turn on "Let tiles that need a PIN work without one" there.)', 9000); return null; }
  return tbPinPad(title, 'Enter the PIN to continue');
}
// One press on the on-screen remote of a tile. The server finds the command in the saved layout.
async function tbRemotePress(tile, key, index) {
  if (tbPreviewBlock()) return false;
  let pin = '';
  if (tile.needs_pin) { pin = await tbTilePin(tile.label || 'PIN needed'); if (pin === null) return false; }
  tbFeedback('tap');
  const r = await tbApi(`/api/tablets/${encodeURIComponent(TB.id)}/remote-press`, { method: 'POST', body: JSON.stringify(index !== undefined ? { tileId: tile.id, index, pin } : { tileId: tile.id, key, pin }) });
  if (!tbOk(r)) { tbToast(r && r.__networkError ? 'The home hub is not reachable.' : r && r.error ? r.error : 'That did not work.'); tbFeedback('fail'); return false; }
  return true;
}
async function tbSendHa(tile, action, extra, entityId) {
  if (tbPreviewBlock()) return false;
  const ref = entityId || tile.ref;
  const needsPin = (!entityId && tile.needs_pin) || ['lock', 'alarm_control_panel', 'update'].includes(tbDomain(ref));
  let pin = '';
  if (needsPin) {
    pin = await tbTilePin(tile.label || (TB.ents[ref] || {}).friendly_name || 'PIN needed');
    if (pin === null) return false;
  }
  tbBusy(tile, true);
  const r = await tbApi(`/api/tablets/${encodeURIComponent(TB.id)}/ha-action`, { method: 'POST', body: JSON.stringify({ entityId: ref, action, pin, ...(extra || {}) }) });
  tbBusy(tile, false);
  if (!tbOk(r)) { tbFail(tile, r && r.__networkError ? 'The home hub is not reachable.' : r && r.error ? r.error : 'That did not work.'); return false; }
  if (action === 'trigger' || action === 'run_automation' || action === 'press_button') tbFlash(tile, 'Done ✓');
  setTimeout(() => { tbRefreshHa().then(() => tbRedraw && tbRedraw()); }, 700);
  return true;
}
async function tbSendGroup(tile, action) {
  if (tbPreviewBlock()) return false;
  let pin = '';
  if (tile.needs_pin) { pin = await tbTilePin(tile.label || 'PIN needed'); if (pin === null) return false; }
  tbBusy(tile, true);
  const r = await tbApi(`/api/tablets/${encodeURIComponent(TB.id)}/group-action`, { method: 'POST', body: JSON.stringify({ tileId: tile.id, action, pin }) });
  tbBusy(tile, false);
  if (!tbOk(r)) { tbFail(tile, r && r.__networkError ? 'The home hub is not reachable.' : r && r.error ? r.error : 'That did not work.'); return false; }
  if ((tile.group_mode || 'toggle') !== 'toggle') tbFlash(tile, action === 'turn_off' ? 'All off ✓' : 'All on ✓');
  setTimeout(() => { tbRefreshHa().then(() => tbRedraw && tbRedraw()); }, 900);
  return true;
}
// "Do this now?" before a tile acts, when the tile says so or the layout does (confirm_mode: on a phone, or everywhere). True to go ahead. It puts itself away after 12 seconds, so that a tap that comes much later cannot confirm it.
function tbNeedsConfirm(tile) {
  if (TB.preview) return false;
  if (tile.confirm) return true;
  const m = TB.layout && TB.layout.confirm_mode;
  return m === 'all' || (m === 'phone' && tbPhone());
}
function tbConfirm(tile) {
  if (!tbNeedsConfirm(tile)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let name = tile.label || tile.ref; try { name = tbView(tile).label || name; } catch { /* use the plain name */ }
    const { box, close } = tbSheet(`<h2>${tbEsc(name)}</h2><p>Do this now?</p><div class="tb-confirm"><button type="button" class="tb-btn" data-no>Cancel</button><button type="button" class="tb-btn primary" data-yes>Yes, do it</button></div>`);
    box.setAttribute('data-confirm', '1');
    let done = false, timer = null;
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); document.removeEventListener('keydown', key, true); close(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') end(false); };
    document.addEventListener('keydown', key, true);
    box.querySelector('[data-yes]').addEventListener('click', () => end(true));
    box.querySelector('[data-no]').addEventListener('click', () => end(false));
    box.addEventListener('click', (e) => { if (e.target === box) end(false); });
    timer = setTimeout(() => end(false), 12000);
  });
}
async function tbTap(tile) {
  if (tile.tap === 'none') return;
  if (tile.tap === 'details') { tbDetails(tile, true); return; }
  if (tile.kind === 'camera') { tbCamLive(tile); return; }
  if (tile.kind === 'group') {
    const mode = tile.group_mode || 'toggle', on = (tile.members || []).filter((m) => tbIsOn(TB.ents[m])).length;
    if (!(await tbConfirm(tile))) return;
    await tbSendGroup(tile, mode === 'all_off' ? 'turn_off' : mode === 'all_on' ? 'turn_on' : on ? 'turn_off' : 'turn_on');
    return;
  }
  if (tile.kind === 'routine') { if ((tile.routine || {}).mode !== 'menu' && !(await tbConfirm(tile))) return; await tbRoutineTap(tile); return; }
  if (tile.kind === 'ha') {
    if (tbDomain(tile.ref) === 'climate') { tbDetails(tile, true); return; }
    const a = tbHaAction(tile);
    if (a) { if (!(await tbConfirm(tile))) return; await tbSendHa(tile, a); } else if (tile.spark) tbDetails(tile, true);
    return;
  }
  if (TM_CARD_OPENABLE.includes(tile.ref)) { tbOpenCard(tile); return; }
  if (tile.ref === 'send_message') {
    if (tbPreviewBlock()) return;
    const text = (tile.card_config && tile.card_config.text) || tile.label;
    if (!text) { tbToast('This tile has no message yet.'); return; }
    if (!(await tbConfirm(tile))) return;
    const r = await tbApi('/api/messages', { method: 'POST', body: JSON.stringify({ text }) });
    if (tbOk(r)) tbFlash(tile, 'Sent ✓'); else tbFail(tile, 'Could not send that.');
  }
}
// Run one list of a routine tile through the server (which checks the PIN when the tile or a lock in it needs it and says which steps did not work).
async function tbRunRoutine(tile, set, index) {
  if (tbPreviewBlock()) return false;
  const ro = tile.routine || {}, lists = tmRoutineLists(ro);
  let pin = '';
  const list = ro.mode === 'menu' || ro.mode === 'cycle' ? (ro.choices[index] || {}).steps || [] : set === 'off_steps' ? ro.off_steps || [] : ro.steps || [];
  if (tile.needs_pin || list.some((s) => tbDomain(s.ref) === 'lock')) { pin = await tbTilePin(tile.label || 'PIN needed'); if (pin === null) return false; }
  tbBusy(tile, true);
  const r = await tbApi(`/api/tablets/${encodeURIComponent(TB.id)}/routine-action`, { method: 'POST', body: JSON.stringify({ tileId: tile.id, set, index, pin }) });
  tbBusy(tile, false);
  const why = (list) => (list || []).slice(0, 3).map((f) => { const n = (TB.ents && TB.ents[f.ref] && TB.ents[f.ref].friendly_name) || f.ref; return /^is /.test(f.error) ? n + ' ' + f.error : n + ': ' + f.error; }).join('. ');       // "Living Room TV is not available right now ..."
  if (!tbOk(r)) { tbFail(tile, r && r.__networkError ? 'The home hub is not reachable.' : r && r.failed && r.failed.length ? why(r.failed) : r && r.error ? r.error : 'That did not work.'); return false; }
  if (r.failed && r.failed.length) { tbFail(tile, `${r.done} of ${r.total} worked. ${why(r.failed)}`); }
  else if (ro.mode === 'cycle') { /* the tile now says which press ran */ }
  else if (ro.mode !== 'toggle' || lists.length < 2) tbFlash(tile, 'Done ✓');
  if (ro.mode === 'toggle' && typeof r.on === 'boolean') TB.routineOn[tile.id] = r.on;
  if (ro.mode === 'cycle' && Number.isInteger(r.pos)) {
    TB.routineOn[tile.id] = r.pos;
    const ex = TB.routineOn._expires = TB.routineOn._expires || {};
    if (ro.reset_after) ex[tile.id] = Date.now() + ro.reset_after * 60000; else delete ex[tile.id];
  }
  tbRedraw();
  setTimeout(() => { tbRefreshHa().then(() => tbRedraw && tbRedraw()); }, 900);
  return true;
}
// A tap: a menu opens its choices; a turn-taking tile runs the press after the last one; a toggling tile runs its off steps when it is on (and has some), else its on steps; any other tile runs its steps.
async function tbRoutineTap(tile) {
  const ro = tile.routine || {};
  if (ro.mode === 'menu') { tbRoutineSheet(tile); return; }
  if (ro.mode === 'cycle') { await tbRunRoutine(tile, 'steps', tmCycleNext(ro, tbCyclePos(tile))); return; }
  if (ro.mode === 'toggle' && (ro.off_steps || []).length && tmRoutineIsOn(ro, TB.ents, TB.routineOn[tile.id])) { await tbRunRoutine(tile, 'off_steps'); return; }
  await tbRunRoutine(tile, 'steps');
}
// The sheet for a routine tile (a long press, or a tap on a menu): its choices or its lists, each with a button to run it.
function tbRoutineSheet(tile) {
  const ro = tile.routine || {}, lists = tmRoutineLists(ro), name = (ref) => ((TB.ents[ref] || {}).friendly_name || ref);
  const { box, close } = tbSheet(`<h2>${tbEsc(tbView(tile).label)}</h2><div class="tb-rlists"></div><button type="button" class="tb-btn primary" data-close>Close</button>`);
  box.querySelector('[data-close]').addEventListener('click', close);
  const host = box.querySelector('.tb-rlists');
  lists.forEach((l, i) => {
    const sec = document.createElement('div'); sec.className = 'tb-rlist';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'tb-btn' + (ro.mode === 'run' ? ' primary' : '');
    btn.textContent = ro.mode === 'menu' || ro.mode === 'cycle' ? l.title : ro.mode === 'toggle' && lists.length > 1 ? (i === 0 ? 'Run the "on" actions' : 'Run the "off" actions') : 'Run it';
    btn.addEventListener('click', async () => { close(); await tbRunRoutine(tile, i === 1 && ro.mode === 'toggle' ? 'off_steps' : 'steps', i); });
    sec.appendChild(btn);
    const ul = document.createElement('ul'); ul.className = 'tb-rsteps';
    l.steps.forEach((s) => { const li = document.createElement('li'); li.innerHTML = `<b>${tbEsc(tmStepLabel(s))}</b> <span>${tbEsc(tmStepDetail(s, name(s.ref)))}${s.only_if ? tbEsc(' · only if ' + name(s.only_if.ref) + ' is ' + s.only_if.is) : ''}</span>`; ul.appendChild(li); });
    sec.appendChild(ul); host.appendChild(sec);
  });
}
async function tbStep(tile, dir) {
  if (tbPreviewBlock()) return;
  const x = TB.extra[tile.ref] || {}, step = Number(x.tempStep) || 1, min = Number(x.minTemp), max = Number(x.maxTemp);
  let t = (Number(x.targetTemp) || Number(x.currentTemp) || 70) + dir * step;
  if (Number.isFinite(min)) t = Math.max(min, t); if (Number.isFinite(max)) t = Math.min(max, t);
  x.targetTemp = t; TB.extra[tile.ref] = x; tbRedraw();
  await tbSendHa(tile, 'set_temperature', { temperature: t });
}

// ── the details sheet (a long press, or a tap when the tile is set to open its controls): the full controls for the device ───────
async function tbDetails(tile, forced) {
  if (tile.long === 'none' && !forced) return;
  if (tile.kind === 'camera') { tbCamLive(tile); return; }
  if (tile.kind === 'routine') { tbRoutineSheet(tile); return; }
  const v = tbView(tile), box = document.createElement('div');
  box.className = 'tb-overlay';
  box.innerHTML = `<div class="tb-sheet" role="dialog" aria-label="${tbEsc(v.label)}"><h2>${tbEsc(v.label)}</h2><p data-state>${tbEsc(v.state)}</p><div class="tb-dbody"></div>${TB.preview ? '' : '<button type="button" class="tb-btn" data-edit>Rearrange tiles</button>'}<button type="button" class="tb-btn primary" data-close>Close</button></div>`;
  tbEl('tb-overlays').appendChild(box);
  const body = box.querySelector('.tb-dbody'), stateEl = box.querySelector('[data-state]');
  box.querySelector('[data-close]').addEventListener('click', () => box.remove());
  const editBtn = box.querySelector('[data-edit]'); if (editBtn) editBtn.addEventListener('click', () => { box.remove(); tbStartEdit(); });
  box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
  const sync = () => setTimeout(async () => { await tbRefreshHa(); if (box.isConnected) { stateEl.textContent = tbView(tile).state; tbRedraw(); } }, 900);
  const button = (label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tb-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.addEventListener('click', async () => { if (await fn()) sync(); }); return b; };
  const row = (...kids) => { const r = document.createElement('div'); r.className = 'tb-drow'; kids.forEach((k) => r.appendChild(k)); body.appendChild(r); return r; };
  const slider = (label, value, min, max, fn, id) => {
    const l = document.createElement('label'); l.className = 'tb-slabel'; l.textContent = label;
    const s = document.createElement('input'); s.type = 'range'; s.className = 'tb-range'; if (id) s.id = id; s.min = min; s.max = max; s.value = value;
    s.addEventListener('change', async () => { if (await fn(Number(s.value))) sync(); }); l.appendChild(s); body.appendChild(l); return s;
  };
  if (tile.kind === 'group') {
    const list = document.createElement('div'); list.className = 'tb-list'; body.appendChild(list);
    (tile.members || []).forEach((m) => {
      const e = TB.ents[m], r = document.createElement('div'); r.className = 'tb-member';
      r.innerHTML = `<span>${tbEsc((e && e.friendly_name) || m)}<small>${e ? (tbIsOn(e) ? 'On' : 'Off') : 'Not found'}</small></span>`;
      if (!tile.needs_pin && e) { const b = button(tbIsOn(e) ? 'Turn off' : 'Turn on', () => tbSendHa(tile, 'toggle', {}, m)); b.addEventListener('click', () => b.remove()); r.appendChild(b); }
      list.appendChild(r);
    });
    return;
  }
  if (tile.kind === 'card') {
    if (v.lines) { const ul = document.createElement('ul'); ul.className = 'tb-lines big'; ul.innerHTML = v.lines.map(tbLineHtml).join(''); body.appendChild(ul); }
    return;
  }
  const d = tbDomain(tile.ref);
  const s = await tbApi('/api/ha/state/' + encodeURIComponent(tile.ref)), x = tbOk(s) && s.entity_id ? s : {};
  if (d === 'light') {
    slider('Brightness', x.brightness != null ? Math.max(1, Math.round(x.brightness / 255 * 100)) : 80, 1, 100, (n) => tbSendHa(tile, 'set_brightness', { brightness_pct: n }), 'tb-bright');
    row(button('Turn on', () => tbSendHa(tile, 'turn_on')), button('Turn off', () => tbSendHa(tile, 'turn_off')));
  } else if (d === 'fan') {
    if (x.fanPercentage != null) slider('Speed', x.fanPercentage || 50, 1, 100, (n) => tbSendHa(tile, 'set_fan_speed', { fan_pct: n }));
    row(button('Turn on', () => tbSendHa(tile, 'turn_on')), button('Turn off', () => tbSendHa(tile, 'turn_off')));
  } else if (d === 'cover') {
    row(button('Open', () => tbSendHa(tile, 'open_cover')), button('Stop', () => tbSendHa(tile, 'stop_cover')), button('Close', () => tbSendHa(tile, 'close_cover')));
  } else if (d === 'lock') {
    row(button('Lock', () => tbSendHa(tile, 'lock')), button('Unlock', () => tbSendHa(tile, 'unlock')));
  } else if (d === 'scene' || d === 'script') {
    row(button('Run', () => tbSendHa(tile, 'trigger'), 'primary'));
  } else if (d === 'button' || d === 'input_button') {
    row(button('Press', () => tbSendHa(tile, 'press_button'), 'primary'));
  } else if (d === 'automation') {
    row(button('Run now', () => tbSendHa(tile, 'run_automation'), 'primary'));
    row(button('Turn on', () => tbSendHa(tile, 'turn_on')), button('Turn off', () => tbSendHa(tile, 'turn_off')));
  } else if (d === 'climate') {
    const cur = box.querySelector('[data-state]');
    const say = () => { cur.innerHTML = `${x.currentTemp != null ? `<span>Now ${tbEsc(x.currentTemp)}°</span> · ` : ''}<span>Set to ${x.targetTemp != null ? tbEsc(x.targetTemp) + '°' : '--'}</span>`; };
    say();
    const nudge = (dir) => async () => { await tbStep(tile, dir); x.targetTemp = (TB.extra[tile.ref] || {}).targetTemp; say(); return false; };
    row(button('−', nudge(-1), 'tb-bigbtn'), button('+', nudge(1), 'tb-bigbtn'));
    if (Array.isArray(x.hvacModes) && x.hvacModes.length) row(...x.hvacModes.map((m) => button(tbMode(m), () => tbSendHa(tile, 'set_hvac_mode', { hvac_mode: m }), x.state === m ? 'primary' : '')));
  } else if (['vacuum', 'lawn_mower', 'valve', 'siren'].includes(d)) {
    // a robot vacuum or mower, a valve or a siren: one button per thing it can do
    if (d === 'vacuum' && x.battery != null) { const t = document.createElement('p'); t.className = 'tb-now'; t.textContent = 'Battery ' + x.battery + '%'; body.appendChild(t); }
    const acts = { vacuum: [['Start', 'vacuum_start', 'primary'], ['Pause', 'vacuum_pause'], ['Dock', 'vacuum_return'], ['Find it', 'vacuum_locate']], lawn_mower: [['Start mowing', 'lawn_start', 'primary'], ['Pause', 'lawn_pause'], ['Dock', 'lawn_dock']], valve: [['Open', 'open_valve'], ['Close', 'close_valve']], siren: [['Turn on', 'turn_on'], ['Turn off', 'turn_off']] }[d];
    row(...acts.map(([l, a, c]) => button(l, () => tbSendHa(tile, a), c || '')));
  } else if (d === 'humidifier' || d === 'water_heater') {
    if (d === 'humidifier') slider('Humidity', x.targetHumidity != null ? x.targetHumidity : 50, x.minHumidity != null ? x.minHumidity : 0, x.maxHumidity != null ? x.maxHumidity : 100, (n) => tbSendHa(tile, 'set_humidity', { humidity: n }));
    else if (x.targetTemp != null) slider('Temperature', x.targetTemp, x.minTemp != null ? x.minTemp : 30, x.maxTemp != null ? x.maxTemp : 140, (n) => tbSendHa(tile, 'set_water_temp', { temperature: n }));
    row(button('Turn on', () => tbSendHa(tile, 'turn_on')), button('Turn off', () => tbSendHa(tile, 'turn_off')));
  } else if (d === 'number' || d === 'input_number') {
    const cur = Number(x.state), lbl = document.createElement('p'); lbl.className = 'tb-now'; lbl.textContent = String(x.state) + (((TB.ents[tile.ref] || {}).unit || '') ? ' ' + ((TB.ents[tile.ref] || {}).unit || '') : ''); body.appendChild(lbl);
    const s = slider('Value', Number.isFinite(cur) ? cur : 0, x.numMin != null ? x.numMin : 0, x.numMax != null ? x.numMax : 100, (n) => tbSendHa(tile, 'set_number', { value: n }));
    s.step = x.numStep || 1; s.addEventListener('input', () => { lbl.textContent = s.value; });
  } else if (d === 'select' || d === 'input_select') {
    // one button per choice, the current one filled in
    const list = document.createElement('div'); list.className = 'tb-list'; body.appendChild(list);
    (x.options || []).forEach((o) => { const b = button(o, () => tbSendHa(tile, 'select_option', { option: o }), o === x.state ? 'primary' : ''); b.classList.add('tb-optbtn'); list.appendChild(b); });
    if (!(x.options || []).length) { const t = document.createElement('p'); t.className = 'tb-now'; t.textContent = 'No choices to show.'; body.appendChild(t); }
  } else if (d === 'update') {
    const t = document.createElement('p'); t.className = 'tb-now';
    t.textContent = (x.updateTitle || v.label) + (x.installedVersion ? ' · now ' + x.installedVersion : '') + (x.state === 'on' && x.latestVersion ? ' · new ' + x.latestVersion : '');
    body.appendChild(t);
    if (x.releaseSummary && x.state === 'on') { const n = document.createElement('p'); n.className = 'tb-now'; n.textContent = x.releaseSummary; body.appendChild(n); }
    if (x.state === 'on') row(button('Install the update', () => tbSendHa(tile, 'update_install'), 'primary'));
  } else if (d === 'alarm_control_panel') {
    // arming and disarming ask for the household PIN (like a lock), and for the alarm's own code when it wants one
    const act = (a) => async () => {
      let code;
      if (x.codeFormat && (a === 'alarm_disarm' || x.state === 'disarmed')) { code = await tbPinPad(v.label, 'Enter the alarm code', { manual: true }); if (code === null) return false; }
      return tbSendHa(tile, a, code ? { code } : {});
    };
    row(button('Arm home', act('alarm_arm_home')), button('Arm away', act('alarm_arm_away')), button('Arm night', act('alarm_arm_night')));
    row(button('Disarm', act('alarm_disarm'), 'primary'));
  } else if (d === 'remote') {
    // the on-screen remote: the buttons that have a command (from the tile's key set or its own names for them), in the order of a real remote
    const cfg = tile.remote || { preset: 'custom' }, names = Object.fromEntries(TM_REMOTE_KEYS);
    const pad = document.createElement('div'); pad.className = 'tb-rpad'; body.appendChild(pad);
    let any = false;
    const ordered = tmRemoteItems(cfg);                                                    // the buttons in the order the person arranged them
    if (ordered) ordered.forEach((id) => {
      any = true;
      const ci = names[id] ? -1 : (cfg.custom || []).findIndex((c, i) => tmCustomId(c, i) === id), c = ci >= 0 ? cfg.custom[ci] : null, label = c ? (c.label || c.command) : names[id];
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tb-btn tb-rkey' + (id === 'ok' ? ' primary' : ''); b.textContent = label; b.setAttribute('aria-label', label);
      if (c) { b.dataset.custom = ci; b.addEventListener('click', () => tbRemotePress(tile, null, ci)); } else { b.dataset.key = id; b.addEventListener('click', () => tbRemotePress(tile, id)); }
      pad.appendChild(b);
    });
    if (!ordered) ['power', 'source', 'mute', 'vol_up', 'up', 'ch_up', 'left', 'ok', 'right', 'vol_down', 'down', 'ch_down', 'back', 'home', 'menu', 'rewind', 'play_pause', 'forward', 'info'].forEach((k) => {
      if (!tmRemoteCommand(cfg, k)) { pad.appendChild(document.createElement('span')); return; }
      any = true;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tb-btn tb-rkey' + (k === 'ok' ? ' primary' : ''); b.dataset.key = k; b.textContent = names[k]; b.setAttribute('aria-label', names[k]);
      b.addEventListener('click', () => tbRemotePress(tile, k));
      pad.appendChild(b);
    });
    if (!ordered) (cfg.custom || []).forEach((c, i) => { any = true; if (!i) { const hd = document.createElement('div'); hd.className = 'tb-rpad-gap'; body.appendChild(hd); const cp = document.createElement('div'); cp.className = 'tb-rpad tb-rcustom'; body.appendChild(cp); } const b = document.createElement('button'); b.type = 'button'; b.className = 'tb-btn tb-rkey'; b.dataset.custom = i; b.textContent = c.label || c.command; b.addEventListener('click', () => tbRemotePress(tile, null, i)); body.querySelector('.tb-rcustom').appendChild(b); });
    if (!any) { const p = document.createElement('p'); p.className = 'tb-now'; p.textContent = 'This remote has no buttons yet. Open the tile\'s options and choose what kind of remote it is.'; body.appendChild(p); }
  } else if (d === 'media_player') {
    if (x.mediaTitle) { const t = document.createElement('p'); t.className = 'tb-now'; t.textContent = x.mediaTitle + (x.mediaArtist ? ' · ' + x.mediaArtist : ''); body.appendChild(t); }
    row(button('⏮', () => tbSendHa(tile, 'media_previous_track'), 'tb-bigbtn'), button(x.state === 'playing' ? '⏸' : '▶', () => tbSendHa(tile, 'media_play_pause'), 'tb-bigbtn'), button('⏭', () => tbSendHa(tile, 'media_next_track'), 'tb-bigbtn'));
    if (x.volumeLevel != null) slider('Volume', Math.round(x.volumeLevel * 100), 0, 100, (n) => tbSendHa(tile, 'volume_set', { volume_pct: n }));
    row(button('Vol −', () => tbSendHa(tile, 'volume_down')), button(x.volumeMuted ? 'Unmute' : 'Mute', () => tbSendHa(tile, 'volume_mute', { muted: !x.volumeMuted })), button('Vol +', () => tbSendHa(tile, 'volume_up')), button('⏹ Stop', () => tbSendHa(tile, 'media_stop')));
    row(button('Turn on', () => tbSendHa(tile, 'turn_on')), button('Turn off', () => tbSendHa(tile, 'turn_off')));
  } else {
    // a sensor: the reading with a bigger trend line and its range over the last day
    const hrs = tile.spark_hours || 24, h = await tbApi(`/api/ha/history/${encodeURIComponent(tile.ref)}?hours=${hrs}`);
    if (tbOk(h) && Array.isArray(h.points) && h.points.length > 1) {
      const vs = h.points.map((p) => p.v), unit = (TB.ents[tile.ref] || {}).unit || '';
      const wrap = document.createElement('div'); wrap.className = 'tb-bigspark';
      wrap.innerHTML = tbSparkSvg(h.points, 300, 90) + `<div class="tb-range-text"><span>Last ${hrs} ${hrs === 1 ? 'hour' : 'hours'}</span> · <span>Low: ${tbEsc(Math.min(...vs))}${tbEsc(unit)}</span> · <span>High: ${tbEsc(Math.max(...vs))}${tbEsc(unit)}</span></div>`;
      body.appendChild(wrap);
    }
  }
}
