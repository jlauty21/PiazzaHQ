// What a tablet tile is, shared by the editor in the app (js/app/15-tablet-editor.js) and the rearrange mode on the tablet itself (js/tablet/04-06), so both offer the same choices and
// a new option or tile kind shows up in both. Only data and pure functions live here: no drawing, no network. Needs nothing else loaded first.
'use strict';
const TM_CARD_LABELS = { tonight_dinner: "Tonight's dinner", shopping_count: 'Shopping list', todo_count: 'To-do list', next_up: 'Next up', send_message: 'Send a message', screen_health: 'Screens status', update_status: 'Update status', clock: 'Clock', weather: 'Weather', agenda: "Today's calendar", chores: 'Chores', messages: 'Message board',
  add_shopping: 'Add to shopping list', add_todo: 'Add a to-do', add_event: 'Add an event', add_chore: 'Add a chore', give_sticker: 'Give a sticker', redeem_reward: 'Redeem a reward', chores_progress: "Today's chores progress", sticker_balances: 'Sticker balances',
  tv_power: 'TV power', photo_frame: 'Photo frame', switch_layout: 'Switch layout', family_hub_qr: 'Family Hub QR', timer: 'Kitchen timers', countdown: 'Countdown', photos: 'Photo slideshow',
  presentation: 'Presentation', whiteboard: 'Whiteboard', bonus_chores: 'Bonus chores' };
const TM_CARD_SIZES = { clock: [2, 1], weather: [2, 1], agenda: [2, 2], chores: [2, 2], shopping_count: [2, 2], todo_count: [2, 2], messages: [2, 2], tonight_dinner: [2, 1], chores_progress: [2, 1], sticker_balances: [2, 2], timer: [2, 1], countdown: [2, 1], photos: [2, 2], presentation: [2, 1], whiteboard: [2, 2], bonus_chores: [2, 2] };
// The Piazza HQ tiles that open a sheet when tapped (the list, the week, the board...), and the options each one has (saved in the tile's card_config).
const TM_CARD_OPENABLE = ['shopping_count', 'todo_count', 'chores', 'agenda', 'next_up', 'tonight_dinner', 'messages', 'weather', 'screen_health',
  'add_shopping', 'add_todo', 'add_event', 'add_chore', 'give_sticker', 'redeem_reward', 'chores_progress', 'sticker_balances', 'tv_power', 'photo_frame', 'switch_layout', 'family_hub_qr', 'timer', 'photos', 'presentation', 'whiteboard', 'bonus_chores'];
const TM_ITEM_CHOICES = [['', 'Automatic'], ['3', '3 items'], ['5', '5 items'], ['8', '8 items'], ['12', '12 items']];
// Where the choices of a select-type option come from: the server addresses to ask, and how to turn the answers into [value, label] rows. Used by both editors.
const TM_OPTION_SOURCES = {
  shopping_list: { urls: ['/api/shopping-lists'], blank: 'All lists', rows: ([l]) => (l || []).map((x) => [String(x.id), x.name]) },
  todo_list: { urls: ['/api/todo-lists'], blank: 'All lists', rows: ([l]) => (l || []).map((x) => [String(x.id), x.name]) },
  kid: { urls: ['/api/kids'], blank: 'Everyone', rows: ([l]) => (l || []).map((x) => [String(x.id), x.name]) },
  screen: { urls: ['/api/screens'], blank: 'The first one', rows: ([l]) => (l || []).filter((x) => !String(x.device_id || '').startsWith('preview_')).map((x) => [String(x.device_id), x.name || x.device_id]) },
  board: { urls: ['/api/boards'], blank: 'The first board', rows: ([l]) => (l || []).map((x) => [String(x.id), x.name]) },
  presentation: { urls: ['/api/decks', '/api/playlists'], blank: 'Let me choose each time', rows: ([d, p]) => [...(d || []).map((x) => ['deck:' + x.id, x.name]), ...(p || []).map((x) => ['playlist:' + x.id, x.name + ' (playlist)'])] },
};
const tmOptionRows = (type, lists) => { const src = TM_OPTION_SOURCES[type]; return src ? [['', src.blank], ...src.rows((lists || []).map((l) => (Array.isArray(l) ? l : [])))] : []; };
// Options for a Piazza HQ tile: [{ key, label, type }] where type is 'shopping_list', 'todo_list', 'kid' (the editor fills the choices from the server) or 'choice' (with `choices`).
function tmCardOptions(ref) {
  if (ref === 'shopping_count') return [{ key: 'list', label: 'Which list', type: 'shopping_list' }, { key: 'items', label: 'Items shown on the tile', type: 'choice', choices: TM_ITEM_CHOICES }];
  if (ref === 'todo_count') return [{ key: 'list', label: 'Which list', type: 'todo_list' }, { key: 'items', label: 'Items shown on the tile', type: 'choice', choices: TM_ITEM_CHOICES }];
  if (ref === 'chores') return [{ key: 'kid', label: 'Whose chores', type: 'kid' }];
  if (ref === 'add_shopping') return [{ key: 'list', label: 'Which list', type: 'shopping_list' }];
  if (ref === 'add_todo') return [{ key: 'list', label: 'Which list', type: 'todo_list' }];
  if (['tv_power', 'photo_frame', 'switch_layout'].includes(ref)) return [{ key: 'screen', label: 'Which screen', type: 'screen' }];
  if (ref === 'presentation') return [{ key: 'screen', label: 'Which screen', type: 'screen' }, { key: 'show', label: 'What to show', type: 'presentation' }];
  if (ref === 'whiteboard') return [{ key: 'board', label: 'Which board', type: 'board' }];
  if (ref === 'bonus_chores') return [{ key: 'kid', label: 'Who is claiming', type: 'kid' }];
  if (ref === 'countdown') return [{ key: 'title', label: 'What is it counting down to?', type: 'text' }, { key: 'date', label: 'On which day', type: 'date' }];
  if (ref === 'agenda') return [{ key: 'days', label: 'Days shown', type: 'choice', choices: [['', 'Today and tomorrow'], ['3', 'Three days'], ['7', 'A week']] }];
  return [];
}
const TM_CARD_ICONS = { tonight_dinner: 'meal', shopping_count: 'check', todo_count: 'check', next_up: 'cal', send_message: 'msg', screen_health: 'screen', update_status: 'up', clock: 'cal', weather: 'cloud', agenda: 'cal', chores: 'broom', messages: 'msg', add_shopping: 'cart', add_todo: 'plus', add_event: 'cal', add_chore: 'broom', give_sticker: 'star', redeem_reward: 'gift', chores_progress: 'broom', sticker_balances: 'star', tv_power: 'tv', photo_frame: 'photo', switch_layout: 'layers', family_hub_qr: 'qr', timer: 'timer', countdown: 'cal', photos: 'photo', presentation: 'screen', whiteboard: 'pencil', bonus_chores: 'star' };
const TM_SIZES = { small: [1, 1, 'Small'], medium: [2, 1, 'Medium'], large: [2, 2, 'Large'] };
const TM_GROUP_DOMAINS = ['light', 'switch', 'fan', 'input_boolean', 'media_player'];
const TM_ADD_SKIP = new Set(['automation', 'sensor', 'binary_sensor', 'update', 'person', 'zone', 'sun', 'weather', 'device_tracker', 'button', 'input_button', 'number', 'select', 'event', 'tts', 'stt', 'conversation', 'todo', 'calendar', 'image', 'text', 'scene', 'script', 'camera']);
const TM_MAX_TILES = 80, TM_MAX_PAGES = 12;
// On a phone (see js/tablet/03-page.js) a tile takes half a row, or a whole row, or is left out. Automatic ('') is: two or more cells wide on the tablet is a whole row, else half.
const TM_PHONE_SIZES = [['', 'Automatic'], ['full', 'Whole row'], ['half', 'Half a row'], ['third', 'A third of a row'], ['hide', 'Hide on phones']];
const TM_PHONE_HEIGHTS = [['', 'Automatic'], ['compact', 'Compact'], ['normal', 'Usual'], ['tall', 'Tall']];
// "Ask first": a tile (or every tile, by the layout's confirm_mode) can ask "do this now?" before it acts, to guard against a touch by accident. Only a tap that DOES something asks: not one that opens details, a camera or a card.
const TM_CONFIRM_MODES = [['', 'Only the tiles that ask'], ['phone', 'Every tile, on a phone'], ['all', 'Every tile, on every screen']];
function tmCanConfirm(t) {
  if (t.tap === 'none' || t.tap === 'details') return false;
  if (t.kind === 'routine') return (t.routine || {}).mode !== 'menu';
  if (t.kind === 'group') return true;
  if (t.kind === 'card') return t.ref === 'send_message';
  if (t.kind !== 'ha') return false;
  return !['climate', 'sensor', 'binary_sensor', 'camera', 'image', 'weather', 'sun', 'person', 'zone', 'update', 'select', 'input_select', 'number'].includes(String(t.ref || '').split('.')[0]) && !(t.remote && t.remote.inline);
}
// A tile whose face is just an icon, a name and a line of state (not a thermostat, camera, remote, list, clock, chart or other card) can be made one line high on a phone.
const TM_PHONE_SIMPLE_DOMAINS = ['light', 'switch', 'input_boolean', 'automation', 'fan', 'lock', 'cover', 'media_player', 'button', 'input_button', 'scene', 'script', 'remote'];       // (remote: one that opens its pad when tapped, not one with its buttons on the tile)
function tmPhoneSimple(t) {
  if (t.kind === 'routine' || t.kind === 'group') return true;
  if (t.kind !== 'ha') return false;
  if (t.remote && t.remote.inline) return false;
  return TM_PHONE_SIMPLE_DOMAINS.includes(String(t.ref || '').split('.')[0]);
}
// Where a tile goes on a phone. The phone's grid has twelve columns: a whole row is 12, a half 6, a third 4. Automatic is one cell (cell: 6, 4 or 3 by the width of the phone), or a whole row for a tile
// that is two or more cells wide on the tablet; with "smaller tiles on phones" a simple one-cell tile is a third of a row. Height is counted in short rows: compact 1, usual 2 for a one-cell tile (more for taller
// ones), tall 3; 0 means as high as its own buttons (a remote on the tile). Compact is only for simple tiles. Only a list or a camera (a card, a camera) grows with the rows it has on the tablet; any other tile is the usual
// two rows however tall it is on the tablet, because that size is for the wall tablet, not for a phone.
function tmPhoneBox(t, small, cell) {
  const simple = tmPhoneSimple(t), inline = !!(t.kind === 'ha' && t.remote && t.remote.inline);
  const span = t.phone === 'full' ? 12 : t.phone === 'half' ? 6 : t.phone === 'third' ? 4 : t.w >= 2 ? 12 : small && simple ? 4 : cell;
  const compact = simple && (t.phone_h === 'compact' || (!t.phone_h && !!small && t.h === 1));
  const grows = t.kind === 'card' || t.kind === 'camera';
  const rows = inline ? 0 : compact ? 1 : t.phone_h === 'tall' ? (grows ? Math.max(3, t.h * 3) : 3) : (grows ? Math.max(2, t.h * 2) : 2);
  return { span, rows, compact, narrow: span <= 4 };
}
// A page's tiles in the order a phone shows them: the ones in the page's phone_order first, in that order, then the rest in reading order (top to bottom, left to right).
function tmPhoneList(page) {
  const tiles = (page && page.tiles) || [], reading = tiles.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const listed = [];
  for (const id of (page && page.phone_order) || []) { const t = reading.find((x) => x.id === id); if (t && !listed.includes(t)) listed.push(t); }
  return listed.concat(reading.filter((t) => !listed.includes(t)));
}
// Put a tile before (or, with after, behind) another one in the phone order. Stores the whole order (or clears it when it is the reading order again). False when nothing changes.
function tmPhoneReorder(page, id, targetId, after) {
  const ids = tmPhoneList(page).map((t) => t.id), from = ids.indexOf(id);
  if (from < 0 || id === targetId || ids.indexOf(targetId) < 0) return false;
  ids.splice(from, 1);
  const at = ids.indexOf(targetId) + (after ? 1 : 0);
  ids.splice(at, 0, id);
  const reading = (page.tiles || []).slice().sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.id);
  if (ids.every((x, k) => x === reading[k])) delete page.phone_order; else page.phone_order = ids;
  return true;
}
// Move a tile one place earlier (-1) or later (1) in the phone order. Stores the whole order (or clears it when it is the reading order again). False when it cannot move.
function tmPhoneMove(page, id, dir) {
  const list = tmPhoneList(page), i = list.findIndex((t) => t.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  const reading = (page.tiles || []).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  if (list.every((t, k) => t === reading[k])) delete page.phone_order; else page.phone_order = list.map((t) => t.id);
  return true;
}

const tmDomain = (ref) => String(ref || '').split('.')[0];
const tmOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const tmFits = (placed, t, cols, rows) => t.x >= 0 && t.y >= 0 && t.x + t.w <= cols && t.y + t.h <= rows && !placed.some((p) => tmOverlap(p, t));
function tmFirstFree(placed, w, h, cols, rows) {
  for (let y = 0; y + h <= rows; y++) for (let x = 0; x + w <= cols; x++) if (!placed.some((p) => tmOverlap(p, { x, y, w, h }))) return { x, y };
  return null;
}
function tmSizeOf(t) { return t.w === 1 && t.h === 1 ? 'small' : t.w === 2 && t.h === 1 ? 'medium' : t.w === 2 && t.h === 2 ? 'large' : 'custom'; }
function tmIsSensor(t) { return t.kind === 'ha' && ['sensor', 'binary_sensor', 'climate'].includes(tmDomain(t.ref)); }
// An automation (what other apps call a routine) can be run with a tap instead of being switched on and off.
const tmIsRun = (t) => t.kind === 'ha' && tmDomain(t.ref) === 'automation' && t.tap === 'run';
function tmDefaultIcon(t) {
  if (t.kind === 'card') return TM_CARD_ICONS[t.ref] || 'dot';
  if (t.kind === 'camera') return 'camera';
  if (t.kind === 'group') return t.group_mode === 'all_off' ? 'power' : 'layers';
  if (t.kind === 'routine') return { toggle: 'power', menu: 'layers', cycle: 'layers' }[(t.routine || {}).mode] || 'play';
  if (tmIsRun(t)) return 'play';
  return { light: 'bulb', switch: 'plug', input_boolean: 'plug', automation: 'plug', lock: 'lock', cover: 'cover', media_player: 'tv', remote: 'tv', vacuum: 'vacuum', lawn_mower: 'mower', valve: 'drop', siren: 'bell', humidifier: 'drop', water_heater: 'temp', number: 'sliders', input_number: 'sliders', select: 'list', input_select: 'list', update: 'up', alarm_control_panel: 'shield', fan: 'fan', climate: 'temp', scene: 'play', script: 'play', button: 'play', input_button: 'play' }[tmDomain(t.ref)] || (t.spark ? 'trend' : 'dot');
}
// Devices with no on/off of their own: a tap opens their controls. And the ones listed under "More controls" when adding a tile (they are too many to list with the devices).
const TM_PANEL_ONLY = ['vacuum', 'lawn_mower', 'update', 'alarm_control_panel', 'number', 'input_number', 'select', 'input_select', 'water_heater'];
const TM_MORE_DOMAINS = ['select', 'number', 'update'];
// What "when tapped" can be for this kind of tile: [value, label].
function tmTapOptions(t) {
  if (t.kind === 'routine' && (t.routine || {}).mode === 'cycle') return [['toggle', 'Do the next one'], ['details', 'Open the list of presses'], ['none', 'Nothing']];
  if (t.kind === 'routine') return (t.routine || {}).mode === 'menu' ? [['toggle', 'Open the choices'], ['none', 'Nothing']] : [['toggle', 'Do its actions'], ['details', 'Open the list of actions'], ['none', 'Nothing']];
  if (t.kind === 'camera') return [['toggle', 'Open the live view'], ['none', 'Nothing']];
  if (t.kind === 'ha' && tmDomain(t.ref) === 'remote') return [['details', 'Open the remote'], ['toggle', 'Switch it on or off'], ['none', 'Nothing']];
  if (t.kind === 'ha' && TM_PANEL_ONLY.includes(tmDomain(t.ref))) return [['details', 'Open its controls'], ['none', 'Nothing']];
  if (t.kind === 'card' && TM_CARD_OPENABLE.includes(t.ref)) return [['toggle', 'Open it'], ['details', 'Open the quick view'], ['none', 'Nothing']];
  if (t.kind === 'card') return [['toggle', 'Do its usual thing'], ['details', 'Open the details'], ['none', 'Nothing']];
  if (t.kind === 'ha' && ['button', 'input_button'].includes(tmDomain(t.ref))) return [['toggle', 'Press it'], ['details', 'Open its controls'], ['none', 'Nothing']];
  if (t.kind === 'ha' && tmDomain(t.ref) === 'automation') return [['run', 'Run it now'], ['toggle', 'Switch it on or off'], ['details', 'Open its controls'], ['none', 'Nothing']];
  return [['toggle', 'Switch it'], ['details', 'Open its controls'], ['none', 'Nothing']];
}
// A new tile for a device, card, group or camera, with the size and tap that suit its kind. `opts` can carry label, members, group_mode, card_config.
function tmNewTile(kind, ref, id, opts) {
  const t = { id, kind, ref, x: 0, y: 0, w: 1, h: 1, label: '', color_on: '', color_off: '', text_size: 'normal', needs_pin: String(ref).startsWith('lock.'), tap: 'toggle', long: 'details' };
  if (kind === 'card' && TM_CARD_SIZES[ref]) { t.w = TM_CARD_SIZES[ref][0]; t.h = TM_CARD_SIZES[ref][1]; }
  if (kind === 'camera') { t.w = 2; t.h = 2; }
  if (kind === 'card' && ref === 'redeem_reward') t.needs_pin = true;                  // spending a child's stars asks for the PIN unless the tile is set otherwise
  if (kind === 'ha' && String(ref).startsWith('climate.')) { t.w = 2; t.h = 1; t.tap = 'details'; }
  if (kind === 'ha' && String(ref).startsWith('remote.')) { t.tap = 'details'; t.remote = { preset: 'custom' }; }
  if (kind === 'ha' && TM_PANEL_ONLY.includes(String(ref).split('.')[0])) t.tap = 'details';
  if (kind === 'ha' && ['alarm_control_panel.', 'update.'].some((d) => String(ref).startsWith(d))) t.needs_pin = true;           // an alarm panel and an update ask for the PIN, like a lock              // a remote opens its button pad
  if (kind === 'ha' && String(ref).startsWith('automation.')) t.tap = 'run';
  return Object.assign(t, opts || {});
}
// ── the on-screen remote of a remote.* tile ────────────────────────────────────────────────────────────────────────────
// t.remote = { preset, device, buttons }: preset says which key set the buttons use ("roku", "samsung", or "custom" for a learning remote such as a BroadLink, where each button
// gets the name of a command that was taught), device is the name commands were learned for (BroadLink), buttons are the tile's own names for some buttons.
// src/tablet.js has the same key sets (test/unit/tablet-layout.test.js keeps them equal).
const TM_REMOTE_KEYS = [['power', 'Power'], ['source', 'Input'], ['mute', 'Mute'], ['vol_up', 'Vol +'], ['vol_down', 'Vol −'], ['ch_up', 'Ch +'], ['ch_down', 'Ch −'], ['up', '▲'], ['down', '▼'], ['left', '◀'], ['right', '▶'], ['ok', 'OK'], ['back', 'Back'], ['home', 'Home'], ['menu', 'Menu'], ['info', 'Info'], ['play_pause', 'Play/Pause'], ['rewind', 'Rewind'], ['forward', 'Forward']];
const TM_REMOTE_PRESETS = {
    roku: { power: 'power', mute: 'volume_mute', vol_up: 'volume_up', vol_down: 'volume_down', ch_up: 'channel_up', ch_down: 'channel_down', up: 'up', down: 'down', left: 'left', right: 'right', ok: 'select', back: 'back', home: 'home', menu: 'info', info: 'info', play_pause: 'play', rewind: 'reverse', forward: 'forward' },
    samsung: { power: 'KEY_POWER', source: 'KEY_SOURCE', mute: 'KEY_MUTE', vol_up: 'KEY_VOLUP', vol_down: 'KEY_VOLDOWN', ch_up: 'KEY_CHUP', ch_down: 'KEY_CHDOWN', up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', ok: 'KEY_ENTER', back: 'KEY_RETURN', home: 'KEY_HOME', menu: 'KEY_MENU', info: 'KEY_INFO', play_pause: 'KEY_PLAY', rewind: 'KEY_REWIND', forward: 'KEY_FF' },
    vizio: { power: 'power', source: 'input_next', mute: 'mute', vol_up: 'vol_up', vol_down: 'vol_down', ch_up: 'ch_up', ch_down: 'ch_down', up: 'up', down: 'down', left: 'left', right: 'right', ok: 'ok', back: 'back', home: 'smartcast', menu: 'menu', info: 'info', play_pause: 'play', rewind: 'seek_back', forward: 'seek_fwd' },
    appletv: { power: 'wakeup', vol_up: 'volume_up', vol_down: 'volume_down', up: 'up', down: 'down', left: 'left', right: 'right', ok: 'select', back: 'menu', home: 'home', menu: 'top_menu', play_pause: 'play_pause', rewind: 'skip_backward', forward: 'skip_forward' },
    custom: {},
  };
// The order of the buttons of a pad. Without an arrangement a pad has the shape of a real remote (TM_PAD_ORDER, with a gap where a button has no command) and the tile's own buttons under it. With one
// (cfg.order, a list of button names and the ids of the tile's own buttons) the buttons that have a command come in a plain grid in that order; any that the list does not name (a button added since) follow.
const TM_PAD_ORDER = ['power', 'source', 'mute', 'vol_up', 'up', 'ch_up', 'left', 'ok', 'right', 'vol_down', 'down', 'ch_down', 'back', 'home', 'menu', 'rewind', 'play_pause', 'forward', 'info'];
const tmCustomId = (c, i) => (c && c.id) || 'c' + i;
function tmRemoteItems(cfg) {                                                       // the ids in the arranged order, or null for the usual shape
  if (!cfg || !Array.isArray(cfg.order) || !cfg.order.length) return null;
  const avail = [...TM_PAD_ORDER.filter((k) => tmRemoteCommand(cfg, k)), ...(cfg.custom || []).map(tmCustomId)], have = new Set(avail), out = [];
  cfg.order.forEach((id) => { if (have.has(id) && !out.includes(id)) out.push(id); });
  avail.forEach((id) => { if (!out.includes(id)) out.push(id); });
  return out;
}
const TM_REMOTE_CUSTOM_MAX = 16;          // the most buttons of its own a remote tile may have: [{ label, command }]
const TM_REMOTE_PRESET_LIST = [['roku', 'Roku'], ['samsung', 'Samsung TV'], ['vizio', 'Vizio'], ['appletv', 'Apple TV'], ['custom', 'Other (commands you taught it)']];
// The command a button sends, or '' when it has none (the pad does not show that button).
const tmRemoteCommand = (cfg, key) => {
  if (cfg && (cfg.hidden || []).includes(key)) return '';                                  // a button the person turned off
  return ((cfg && cfg.buttons) || {})[key] || (TM_REMOTE_PRESETS[(cfg && cfg.preset) || 'custom'] || {})[key] || '';
};
// ── routine tiles: a list of steps, each a device and what to do with it ─────────────────────────────────────────────────
// A routine tile has t.routine = { mode, steps, off_steps, indicator, choices }: mode "run" runs steps in order; "toggle" runs steps ("on") or off_steps by turns, lit by the
// indicator device (else the first light or switch in steps, else what the tile last did); "menu" shows choices = [{ label, steps }] to pick from; "cycle" has the same
// choices and runs the next one on each tap, then the first again. A step is { ref, do }.
// The actions a kind of device allows ([action, label]); src/tablet.js has the same table (test/unit/tablet-layout.test.js keeps them equal).
const TM_ONOFF = [['turn_on', 'Turn on'], ['turn_off', 'Turn off'], ['toggle', 'Switch on or off']];
const TM_STEP_ACTIONS = { light: TM_ONOFF, switch: TM_ONOFF, fan: TM_ONOFF, input_boolean: TM_ONOFF, media_player: [...TM_ONOFF, ['select_source', 'Switch input to'], ['volume_up', 'Volume up'], ['volume_down', 'Volume down'], ['media_play_pause', 'Play or pause']], remote: [['send_command', 'Send command']],
  vacuum: [['vacuum_start', 'Start cleaning'], ['vacuum_pause', 'Pause'], ['vacuum_return', 'Return to the dock'], ['vacuum_locate', 'Make it beep']], lawn_mower: [['lawn_start', 'Start mowing'], ['lawn_dock', 'Return to the dock'], ['lawn_pause', 'Pause']],
  valve: [['open_valve', 'Open'], ['close_valve', 'Close']], siren: TM_ONOFF, humidifier: [...TM_ONOFF, ['set_humidity', 'Set humidity to']], water_heater: [...TM_ONOFF, ['set_water_temp', 'Set temperature to']],
  number: [['set_number', 'Set to']], input_number: [['set_number', 'Set to']], tts: [['speak', 'Say']], input_select: [['select_option', 'Choose']], select: [['select_option', 'Choose']], scene: [['trigger', 'Run']], script: [['trigger', 'Run']],
  automation: [['run_automation', 'Run now'], ['turn_on', 'Turn on'], ['turn_off', 'Turn off']], button: [['press_button', 'Press']], input_button: [['press_button', 'Press']],
  lock: [['lock', 'Lock'], ['unlock', 'Unlock']], cover: [['open_cover', 'Open'], ['close_cover', 'Close'], ['stop_cover', 'Stop']] };
// Steps that name an input (select_source) or an option (select_option) in step.value, and may wait step.wait seconds before they run (a TV just switched on is slow to take an input).
const TM_VALUE_ACTIONS = ['select_source', 'select_option', 'send_command', 'set_number', 'set_humidity', 'set_water_temp', 'speak'], TM_MAX_WAIT = 60, TM_WAITS = [0, 1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60];
const tmNeedsValue = (step) => TM_VALUE_ACTIONS.includes(step.do);
// "Only if": a step that is done only when a device is on or off, such as a remote's power button (which switches a TV off when it is on) sent only when the TV is off. step.only_if = { ref, is: 'on' | 'off' }.
const TM_COND_DOMAINS = ['media_player', 'light', 'switch', 'fan', 'input_boolean', 'humidifier', 'siren', 'water_heater'];
const TM_COND_ACTIONS = ['turn_on', 'turn_off', 'toggle', 'send_command'];       // the steps that are offered "only if"
// Set or clear the condition of a step. Turning one on picks the step's own device when it can be checked, else the first device in the list.
function tmSetCond(step, is, ents) {
  if (!is) { delete step.only_if; return; }
  const ok = (r) => r && TM_COND_DOMAINS.includes(tmDomain(r)), keep = step.only_if && step.only_if.ref;
  const pick = ok(keep) ? keep : ok(step.ref) ? step.ref : ((ents || []).find((e) => ok(e.entity_id)) || {}).entity_id || '';
  if (pick) step.only_if = { ref: pick, is }; else delete step.only_if;
}
// What the box for a step's value asks for.
const tmValueHint = (step) => ({ select_source: 'Input name, for example HDMI 2', send_command: 'Command name, for example power', set_number: 'Number, for example 21', set_humidity: 'Humidity, 0 to 100', set_water_temp: 'Temperature, for example 120', speak: 'What to say' }[step.do] || 'Option to choose');
const tmWaitLabel = (n) => (n ? 'Wait ' + n + ' sec first' : 'No wait');
// The waits a step may have, [value, label]: seconds, and for switching an input "until it is on" (the device is asked as soon as it says it is on, or after at most step.wait seconds).
const tmWaitOptions = (step) => [...(step.do === 'select_source' ? [['on', 'Wait until it is on']] : []), ...[...new Set([...TM_WAITS, step.wait_on ? 0 : Number(step.wait) || 0])].sort((a, b) => a - b).map((n) => [String(n), tmWaitLabel(n)])];
const tmWaitValue = (step) => (step.wait_on ? 'on' : String(Number(step.wait) || 0));
function tmSetWait(step, v) {
  if (v === 'on') { step.wait_on = true; if (!step.wait) step.wait = 30; return; }
  delete step.wait_on; if (Number(v)) step.wait = Number(v); else delete step.wait;
}
const TM_ROUTINE_MODES = [['run', 'Run them all'], ['toggle', 'Switch on and off'], ['menu', 'Pick one'], ['cycle', 'Take turns']];
const TM_MAX_STEPS = 12, TM_MAX_CHOICES = 8;
const TM_STATE_DOMAINS = ['light', 'switch', 'fan', 'input_boolean', 'media_player'];      // devices whose on/off a toggling routine can show
const tmStepDomainOk = (ref) => !!TM_STEP_ACTIONS[tmDomain(ref)];
// The actions offered for a device: unlocking only on a tile that asks for the PIN.
const tmStepOptions = (ref, needsPin) => (TM_STEP_ACTIONS[tmDomain(ref)] || []).filter(([a]) => a !== 'unlock' || needsPin);
const tmNewStep = (ref) => { const a = (TM_STEP_ACTIONS[tmDomain(ref)] || [['turn_on']])[0][0]; return TM_VALUE_ACTIONS.includes(a) ? { ref, do: a, value: '' } : { ref, do: a }; };
// The person changed what a step does: a step that names an input or option gets (and a step that does not loses) its value and wait. Switching a TV's input after turning it on needs the TV to be awake, so that starts as "wait until it is on" (at most 30 seconds).
function tmSetStepAction(step, action) {
  step.do = action;
  if (TM_VALUE_ACTIONS.includes(action)) { if (typeof step.value !== 'string') step.value = ''; if (step.wait === undefined && action === 'select_source') { step.wait_on = true; step.wait = 30; } }
  else { delete step.value; delete step.wait; delete step.wait_on; }
  if (action !== 'send_command') { delete step.device; delete step.repeat; }
  if (action !== 'select_source') delete step.wait_on;
}
// What a step is aimed at, for a summary: the device, and for a step that names an input or option, "HDMI 2 on Living Room TV".
const tmStepDetail = (step, name) => {
  if (!tmNeedsValue(step) || !step.value) return name;
  if (step.do === 'send_command') return step.value + (step.device ? ' (' + step.device + ')' : '') + (step.repeat > 1 ? ' x' + step.repeat : '') + ' via ' + name;
  if (step.do === 'speak') return '"' + step.value + '" with ' + name;
  return step.value + (['select_source', 'set_number', 'set_humidity', 'set_water_temp'].includes(step.do) ? ' on ' : ' in ') + name;
};
// How many times a remote command is sent: once, or a few times (volume up).
const TM_REPEATS = [1, 2, 3, 4, 5, 6, 8, 10];
const tmRepeatOptions = (cur) => [...new Set([...TM_REPEATS, Number(cur) || 1])].sort((a, b) => a - b).map((n) => [String(n), n === 1 ? 'Once' : n + ' times']);
const tmStepLabel = (step) => { const o = (TM_STEP_ACTIONS[tmDomain(step.ref)] || []).find(([a]) => a === step.do); return o ? o[1] : step.do; };
// The steps lists of a routine, whichever mode: [{ title, steps }] for showing a summary or running.
function tmRoutineLists(r) {
  if (!r) return [];
  if (r.mode === 'menu' || r.mode === 'cycle') return (r.choices || []).map((c) => ({ title: c.label, steps: c.steps || [] }));
  if (r.mode === 'toggle') return [{ title: 'On', steps: r.steps || [] }, ...(r.off_steps && r.off_steps.length ? [{ title: 'Off', steps: r.off_steps }] : [])];
  return [{ title: '', steps: r.steps || [] }];
}
const tmRoutineRefs = (r) => [...new Set(tmRoutineLists(r).flatMap((l) => l.steps.map((s) => s.ref)))];
// Why a routine cannot be saved yet ('' when it can).
function tmRoutineProblem(r) {
  if (!r) return 'Add at least one action.';
  if (tmRoutineLists(r).some((l) => l.steps.some((x) => x.do === 'speak' && !String(x.device || '').trim()))) return 'Choose which speaker should say it.';
  if (tmRoutineLists(r).some((l) => l.steps.some((x) => tmNeedsValue(x) && !String(x.value || '').trim()))) return 'Fill in the input, option or command for each action.';
  if (r.mode === 'menu') return (r.choices || []).some((c) => (c.steps || []).length) ? '' : 'Add at least one choice with an action.';
  if (r.mode === 'cycle') return (r.choices || []).filter((c) => (c.steps || []).length).length >= 2 ? '' : 'Add at least two presses, each with an action.';
  return (r.steps || []).length ? '' : 'Add at least one action.';
}
// The device a toggling routine reads its on/off from.
function tmRoutineIndicator(r) {
  if (!r || r.mode !== 'toggle') return '';
  if (r.indicator) return r.indicator;
  const s = (r.steps || []).find((x) => TM_STATE_DOMAINS.includes(tmDomain(x.ref)));
  return s ? s.ref : '';
}
// Is a device on? A media player is on whenever it is not off, in standby or out of reach (a TV that is paused or showing an app is on, though Home Assistant calls that "paused" or "idle").
const tmEntOn = (e) => !!e && (tmDomain(e.entity_id) === 'media_player' ? !['off', 'standby', 'unavailable', 'unknown', ''].includes(String(e.state)) : e.state === 'on' || e.state === 'playing');
const tmEntGone = (e) => !!e && String(e.state) === 'unavailable';
// Whether a toggling routine is on: its indicator device when that is known, else what the tile last did (remembered by the server).
function tmRoutineIsOn(r, ents, remembered) {
  const ind = tmRoutineIndicator(r), e = ind && ents ? ents[ind] : null;
  if (e) return tmEntOn(e);
  return !!remembered;
}
// ── Actions tiles shown on other screens (the wall display's Actions widget, the Favorites tab's Actions card) ───────────────────────────────────────────
// They get the tablet's shareable tiles and what each last did from GET /api/tablet-actions/:id ({ tiles, state }), the devices' states from /api/ha/entities, and show one button per tile.
// What a button says and is lit by: ents is { entity_id: { state, ... } }, st is the "state" of that answer ({ tileId: true | false | number of the press that ran last, _expires: { tileId: ms } }).
function tmActionView(tile, ents, st) {
  const ro = tile.routine || {}, mode = ro.mode || 'run', lists = tmRoutineLists(ro), s = st || {};
  const v = { id: tile.id, label: tile.label || 'Actions', icon: tile.icon || tmDefaultIcon({ kind: 'routine', routine: ro }), mode, on: false, gone: false, state: 'Tap to run', choices: [] };
  if (mode === 'menu') { v.choices = lists.map((l, i) => ({ label: l.title, index: i })); v.state = lists.length === 1 ? 'One choice' : lists.length + ' choices'; }
  else if (mode === 'cycle') {
    const pos = s[tile.id], exp = (s._expires || {})[tile.id], c = Number.isInteger(pos) && !(exp && Date.now() >= exp) ? (ro.choices || [])[pos] : null;
    v.state = c ? c.label : 'Tap to start'; v.choices = lists.map((l, i) => ({ label: l.title, index: i }));
  } else if (mode === 'toggle' && lists.length > 1) {
    const ind = tmRoutineIndicator(ro), e = ind && ents ? ents[ind] : null, gone = tmEntGone(e), on = tmRoutineIsOn(ro, ents, s[tile.id]);
    v.gone = gone; v.on = on && !gone; v.state = gone ? 'Not available' : on ? 'Switched on' : 'Switched off';
  }
  return v;
}
// What a tap sends to POST /api/tablet-actions/:id/run, or null when a person has to choose first (a menu): a toggling tile that is on runs its "off" list, otherwise its steps; a tile that takes turns lets the server pick the next press.
function tmActionTap(tile, ents, st) {
  const ro = tile.routine || {}, mode = ro.mode || 'run';
  if (mode === 'menu') return null;
  if (mode === 'cycle') return {};
  if (mode === 'toggle' && (ro.off_steps || []).length && tmRoutineIsOn(ro, ents, (st || {})[tile.id])) return { set: 'off_steps' };
  return { set: 'steps' };
}
// The words for how a run went, from the answer of the run request.
function tmActionResult(r, ents) {
  const name = (ref) => (ents && ents[ref] && ents[ref].friendly_name) || ref;
  const why = (r.failed || []).slice(0, 3).map((f) => (/^is /.test(f.error) ? name(f.ref) + ' ' + f.error : name(f.ref) + ': ' + f.error)).join('. ');
  if (r.__networkError) return 'The home hub is not reachable.';
  if (r.error) return r.failed && r.failed.length ? why : r.error;
  if (r.failed && r.failed.length) return r.done + ' of ' + r.total + ' worked. ' + why;
  return '';
}

// The opposite of an action, for the "off" list of a tile that switches on and off: what turns a device on is undone by turning it off, a blind that was opened is closed, a vacuum or a mower goes back to its dock,
// a valve closes, an unlocked door locks. Things with no opposite (running a scene, switching an input, a remote command, setting a number) have none.
const TM_OPPOSITE = { turn_on: 'turn_off', open_cover: 'close_cover', vacuum_start: 'vacuum_return', lawn_start: 'lawn_dock', open_valve: 'close_valve', unlock: 'lock' };
// The "off" list for a list of "on" steps, added to what the "off" list has already: each action's opposite, once per device.
function tmOffFromOn(onSteps, have) {
  const out = [...(have || [])], seen = new Set(out.map((s) => s.ref + '|' + s.do));
  for (const s of onSteps || []) {
    const o = TM_OPPOSITE[s.do]; if (!o || seen.has(s.ref + '|' + o) || out.length >= TM_MAX_STEPS) continue;
    seen.add(s.ref + '|' + o); out.push({ ref: s.ref, do: o });
  }
  return out;
}
// A fresh copy of a routine to edit in a sheet, with every list present.
function tmRoutineDraft(r) {
  const c = JSON.parse(JSON.stringify(r || {}));
  return { mode: c.mode || 'run', steps: c.steps || [], off_steps: c.off_steps || [], indicator: c.indicator || '', reset_after: c.reset_after || 0, choices: c.choices && c.choices.length ? c.choices : [{ label: 'Choice 1', steps: [] }] };
}
// The draft as it is stored: only what its mode uses.
function tmRoutineFromDraft(d) {
  if (d.mode === 'menu' || d.mode === 'cycle') {
    const out = { mode: d.mode, choices: d.choices.filter((c) => c.steps.length).map((c) => ({ label: String(c.label || '').trim().slice(0, 40), steps: c.steps })) };
    if (d.mode === 'cycle' && d.reset_after) out.reset_after = Number(d.reset_after);
    return out;
  }
  const out = { mode: d.mode, steps: d.steps };
  if (d.mode === 'toggle') {
    if (d.off_steps.length) out.off_steps = d.off_steps;
    if (d.indicator && [...d.steps, ...d.off_steps].some((s) => s.ref === d.indicator)) out.indicator = d.indicator;
  }
  return out;
}
// How long a turn-taking tile waits without a tap before it goes back to its first press (routine.reset_after, in minutes; 0 or none: never).
const TM_RESET_AFTER = [0, 1, 5, 15, 30, 60, 120, 240, 480];
const tmResetOptions = (cur) => [...new Set([...TM_RESET_AFTER, Number(cur) || 0])].sort((a, b) => a - b).map((m) => [m, m ? tmIdleLabel(m) : 'Never']);
// A scene or script tile that is to switch with something else: a copy of it as a tile that takes turns, with what it ran as the first press and an empty second one to fill in.
// (Only turned into the real tile when the person is done choosing; see tbSwitchWith / teSwitchWith.)
const tmCanSwitchWith = (t) => t.kind === 'ha' && ['scene', 'script'].includes(tmDomain(t.ref));
function tmSwitchWithDraft(t, name) {
  const label = String(t.label || name || '').trim().slice(0, 40);
  return { ...t, kind: 'routine', ref: 'routine', label, icon: t.icon || tmDefaultIcon(t), tap: 'toggle', routine: { mode: 'cycle', choices: [{ label: label || 'Press 1', steps: [{ ref: t.ref, do: 'trigger' }] }, { label: 'Press 2', steps: [] }] } };
}
// The next press of a turn-taking tile after pos (the one that ran last; the first when it is not a number).
const tmCycleNext = (r, pos) => ((r.choices || []).length ? (Number.isInteger(pos) && pos >= 0 ? pos + 1 : 0) % r.choices.length : 0);
// Does a routine tile have an unlock step? (Then it cannot stop asking for the PIN.)
const tmHasUnlock = (t) => tmRoutineLists(t.routine).some((l) => l.steps.some((s) => s.do === 'unlock'));
// A tile that does not ask for the PIN cannot unlock anything: take unlock steps out of its routine.
function tmStripUnlock(t) {
  const r = t.routine; if (!r || t.needs_pin) return;
  const keep = (list) => (list || []).filter((s) => s.do !== 'unlock');
  if (r.steps) r.steps = keep(r.steps);
  if (r.off_steps) { r.off_steps = keep(r.off_steps); if (!r.off_steps.length) delete r.off_steps; }
  if (r.choices) r.choices.forEach((c) => { c.steps = keep(c.steps); });
}
const tmMoveIn = (list, i, dir) => { const j = i + dir; if (j < 0 || j >= list.length) return false; [list[i], list[j]] = [list[j], list[i]]; return true; };

// ── cameras ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Piazza keeps its own list of cameras (/api/cameras). A Home Assistant camera is { id, name, kind: 'ha', host_hint: 'camera.<entity>' }. These find the Home Assistant cameras that are
// not on that list yet, so a tile can be made for one without going through a Camera widget: the editors add it to the list when it is chosen.
function tmCamName(e) {
  const n = String((e && e.friendly_name) || '').trim();
  if (n && !/^<?null>?$/i.test(n)) return n.slice(0, 60);
  return (String((e && e.entity_id) || '').split('.')[1] || 'camera').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim().slice(0, 60) || 'Camera';
}
function tmCamCandidates(ents, cams) {
  const have = new Set((cams || []).filter((c) => c.kind === 'ha').map((c) => c.host_hint));
  return (ents || []).filter((e) => tmDomain(e.entity_id) === 'camera' && !have.has(e.entity_id)).map((e) => ({ entity_id: e.entity_id, name: tmCamName(e) }));
}
// How the tiles look, set per tablet (layout.theme[key]); the first choice of each is the usual look and is not stored.
const TM_LOOKS = [
  { key: 'tiles', label: 'Tile style', choices: [['', 'Solid'], ['outline', 'Outline'], ['glass', 'Glass']] },
  { key: 'corners', label: 'Corners', choices: [['', 'Rounded'], ['square', 'Square'], ['pill', 'Very round']] },
  { key: 'gap', label: 'Space between tiles', choices: [['', 'Normal'], ['tight', 'Tight'], ['roomy', 'Roomy']] },
  { key: 'icons', label: 'Icons', choices: [['', 'Normal'], ['large', 'Large'], ['none', 'None']] },
  { key: 'details', label: 'Small print on tiles', choices: [['', 'Show'], ['simple', 'Hide']] },
  { key: 'backdrop', label: 'Background', choices: [['', 'Plain'], ['gradient', 'Soft glow']] },
];
// How long the tablet waits without a touch before the idle screen comes on (layout.idle.minutes, 1 to 480; 0 is never). tmIdleOptions keeps a stored value that is not on the usual list, so it is never lost.
const TM_IDLE_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480];
const tmIdleLabel = (m) => (!m ? 'Never' : m >= 60 && m % 60 === 0 ? `${m / 60} ${m === 60 ? 'hour' : 'hours'}` : `${m} ${m === 1 ? 'minute' : 'minutes'}`);
const tmIdleOptions = (cur) => [...[...new Set([...TM_IDLE_MINUTES, Number(cur) || 5])].sort((a, b) => a - b), 0].map((m) => [m, tmIdleLabel(m)]);          // "Never" is the last choice
// How the idle screen picks photos (layout.idle.photos). Only what differs from the usual way is stored; tmPhotoOpts gives the full set, with the usual values filled in.
const TM_PHOTO_DEFAULTS = { tag: '', seconds: 30, order: 'shuffle', fit: 'auto', skip_small: true };
const TM_PHOTO_SECONDS = [10, 15, 30, 60, 120, 300];
const TM_PHOTO_FITS = [['auto', 'Best fit for each photo'], ['fill', 'Fill the screen'], ['whole', 'Show the whole photo']];
const TM_PHOTO_ORDERS = [['shuffle', 'Shuffled'], ['order', 'In the library order']];
const tmPhotoOpts = (idle) => ({ ...TM_PHOTO_DEFAULTS, ...((idle && idle.photos) || {}) });
function tmSetPhotoOpt(idle, key, value) {
  const p = { ...(idle.photos || {}) }, v = key === 'seconds' ? Number(value) : value;
  if (v === TM_PHOTO_DEFAULTS[key]) delete p[key]; else p[key] = v;
  if (Object.keys(p).length) idle.photos = p; else delete idle.photos;
}
// The tags in use across the photo library, for the "photos from" choice.
const tmPhotoTags = (photos) => [...new Set((photos || []).flatMap((p) => String((p && p.tags) || '').split(',')).map((t) => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
// A stored tile color (a name from TB_COLORS, or #rrggbb) as #rrggbb, else ''. Needs js/shared/tablet-icons.js loaded first.
const tmHex = (v) => (TB_COLORS[v] || (/^#[0-9a-f]{6}$/i.test(v || '') ? v : ''));
