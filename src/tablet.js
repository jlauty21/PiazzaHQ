'use strict';
// Tablet display: the stored layouts behind the /tablet web app (a touch dashboard for a wall tablet, a bit like ActionTiles). Each tablet that opens the page is one row in
// `tablets`: its name, when it last checked in, and its layout as JSON. A layout is a few pages (shown as tabs, usually one per room); a page is a grid of tiles; a tile is either
// a Home Assistant device (kind "ha", ref "light.kitchen") or a Piazza HQ card (kind "card", ref a Favorites card type such as "tonight_dinner"). A tile stores where it sits and
// how big it is in grid cells, its colors, label, icon and text size, whether it needs the household PIN, and what a tap and a long press do, so that bigger or smaller tiles and
// custom colors are data from the start; the editor only has to learn to change those fields. cleanLayout() is the one gate every stored layout goes through.
// A tile that needs a PIN does not call Home Assistant itself: it asks POST /api/tablets/:id/ha-action, which checks the PIN here (with a limit on wrong tries) and only then
// passes the action on to the same /api/ha/call-action everything else uses.
// More kinds of tile: a "group" (several lights or switches switched together, or a room's "all off"), a "camera" (a camera set up under Layout, Camera), and sensors with a trend line
// and an alert threshold. A layout can also carry time-of-day rules (dim, show the clock, open a page) and a palette, text size and feedback settings for that one tablet.
// Covered by test/unit/tablet-layout.test.js and test/api/tablet.test.js.
module.exports = function registerTablet({ app, db, broadcastUpdate, getSetting, setSetting, fetchWithTimeout, PORT, clock, randomId, timing }) {
  const now = () => (clock ? clock() : Date.now());
  // How long the routine runner waits at certain points (a test shortens these): between asking a device to switch input and checking it did, before trying again, between looks at a device that is waking up, and after it reports on.
  const T = Object.assign({ verifyMs: 3000, retryMs: 3000, pollMs: 1500, settleMs: 2000 }, timing || {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ONLINE_MS = 3 * 60 * 1000;                              // a tablet checks in every 30 seconds
  const MAX_PAGES = 12, MAX_TILES = 80, MAX_NAME = 40;
  const GRID = { min: 4, max: 24 };
  const COLOR_PRESETS = ['amber', 'blue', 'green', 'red', 'purple', 'teal', 'pink', 'gray'];
  const ACTIONS = ['toggle', 'turn_on', 'turn_off', 'open', 'run', 'details', 'none'];
  const LONG_ACTIONS = ['details', 'none'];
  const SIZES = ['small', 'normal', 'large'];
  const IDLE_MODES = ['photos', 'clock', 'off'];
  const HA_ACTION_WHITELIST = new Set(['toggle', 'turn_on', 'turn_off', 'trigger', 'open_cover', 'close_cover', 'stop_cover', 'lock', 'unlock', 'set_temperature', 'set_brightness',
    'media_play_pause', 'media_next_track', 'media_previous_track', 'volume_set', 'set_fan_speed', 'set_hvac_mode', 'run_automation', 'press_button',
    'vacuum_start', 'vacuum_pause', 'vacuum_stop', 'vacuum_return', 'vacuum_locate', 'lawn_start', 'lawn_dock', 'lawn_pause', 'open_valve', 'close_valve', 'update_install',
    'alarm_arm_home', 'alarm_arm_away', 'alarm_arm_night', 'alarm_disarm', 'set_number', 'set_humidity', 'set_water_temp', 'select_option', 'select_source', 'volume_up', 'volume_down', 'volume_mute', 'media_stop']);
  // Devices whose panels always ask for the household PIN, as locks do: an alarm panel, and installing an update.
  const PIN_DOMAINS = ['lock', 'alarm_control_panel', 'update'];
  const EXTRA_KEYS = ['temperature', 'brightness_pct', 'volume_pct', 'fan_pct', 'hvac_mode', 'value', 'humidity', 'option', 'source', 'code', 'muted'];     // the numbers and words an action may carry along
  const KINDS = ['ha', 'card', 'group', 'camera', 'routine'];
  // A "routine" tile runs a list of steps (a device and what to do with it): all of them in order, the "on" or the "off" list by turns, one list picked from a menu, or the next of several lists on each tap.
  // Which actions a step may take depends on the kind of device; this table is the same as TM_STEP_ACTIONS in public/js/shared/tablet-model.js (a unit test keeps them equal).
  const ONOFF = ['turn_on', 'turn_off', 'toggle'];
  const STEP_ACTIONS = { light: ONOFF, switch: ONOFF, fan: ONOFF, input_boolean: ONOFF, media_player: [...ONOFF, 'select_source', 'volume_up', 'volume_down', 'media_play_pause'], remote: ['send_command'], vacuum: ['vacuum_start', 'vacuum_pause', 'vacuum_return', 'vacuum_locate'], lawn_mower: ['lawn_start', 'lawn_dock', 'lawn_pause'], valve: ['open_valve', 'close_valve'], siren: ONOFF, humidifier: [...ONOFF, 'set_humidity'], water_heater: [...ONOFF, 'set_water_temp'], number: ['set_number'], input_number: ['set_number'], tts: ['speak'], input_select: ['select_option'], select: ['select_option'], scene: ['trigger'], script: ['trigger'], automation: ['run_automation', 'turn_on', 'turn_off'],
    button: ['press_button'], input_button: ['press_button'], lock: ['lock', 'unlock'], cover: ['open_cover', 'close_cover', 'stop_cover'] };
  // The on-screen remote of a remote.* tile (the tile's options hold { preset, device, buttons }): which command each button sends. See the note in public/js/shared/tablet-model.js.
  const REMOTE_KEYS = ['power', 'source', 'mute', 'vol_up', 'vol_down', 'ch_up', 'ch_down', 'up', 'down', 'left', 'right', 'ok', 'back', 'home', 'menu', 'info', 'play_pause', 'rewind', 'forward'];
  const REMOTE_PRESETS = {
    roku: { power: 'power', mute: 'volume_mute', vol_up: 'volume_up', vol_down: 'volume_down', ch_up: 'channel_up', ch_down: 'channel_down', up: 'up', down: 'down', left: 'left', right: 'right', ok: 'select', back: 'back', home: 'home', menu: 'info', info: 'info', play_pause: 'play', rewind: 'reverse', forward: 'forward' },
    samsung: { power: 'KEY_POWER', source: 'KEY_SOURCE', mute: 'KEY_MUTE', vol_up: 'KEY_VOLUP', vol_down: 'KEY_VOLDOWN', ch_up: 'KEY_CHUP', ch_down: 'KEY_CHDOWN', up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', ok: 'KEY_ENTER', back: 'KEY_RETURN', home: 'KEY_HOME', menu: 'KEY_MENU', info: 'KEY_INFO', play_pause: 'KEY_PLAY', rewind: 'KEY_REWIND', forward: 'KEY_FF' },
    vizio: { power: 'power', source: 'input_next', mute: 'mute', vol_up: 'vol_up', vol_down: 'vol_down', ch_up: 'ch_up', ch_down: 'ch_down', up: 'up', down: 'down', left: 'left', right: 'right', ok: 'ok', back: 'back', home: 'smartcast', menu: 'menu', info: 'info', play_pause: 'play', rewind: 'seek_back', forward: 'seek_fwd' },
    appletv: { power: 'wakeup', vol_up: 'volume_up', vol_down: 'volume_down', up: 'up', down: 'down', left: 'left', right: 'right', ok: 'select', back: 'menu', home: 'home', menu: 'top_menu', play_pause: 'play_pause', rewind: 'skip_backward', forward: 'skip_forward' },
    custom: {},
  };
  function cleanRemote(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const out = { preset: oneOf(r.preset, Object.keys(REMOTE_PRESETS), 'custom') }, device = str(r.device, 60);
    if (device) out.device = device;
    const buttons = {};
    if (r.buttons && typeof r.buttons === 'object' && !Array.isArray(r.buttons)) for (const k of REMOTE_KEYS) { const c = str(r.buttons[k], 60); if (c) buttons[k] = c; }
    if (Object.keys(buttons).length) out.buttons = buttons;
    if (r.inline === true) out.inline = true;                      // the buttons are on the tile itself, not behind a tap
    const hidden = [...new Set((Array.isArray(r.hidden) ? r.hidden : []).filter((k) => REMOTE_KEYS.includes(k)))];      // buttons of the pad the person turned off
    if (hidden.length) out.hidden = hidden;
    const custom = (Array.isArray(r.custom) ? r.custom : []).map((c) => {          // buttons of the person's own: a command, and optionally another remote (an amplifier's, next to an Apple TV's pad) and the device it was learned for
      const command = str(c && c.command, 60), o = { label: str(c && c.label, 20) || command.slice(0, 20), command }, ref = str(c && c.ref, 80), device = str(c && c.device, 60);
      if (c && typeof c.id === 'string') o.id = c.id;
      if (/^remote\.[a-zA-Z0-9_]+$/.test(ref)) o.ref = ref;
      if (device) o.device = device;
      return o;
    }).filter((c) => c.command).slice(0, 16);
    const used = new Set();                                          // each of the tile's own buttons has an id that stays when others are added or removed, so an arrangement can name it
    custom.forEach((c, i) => { let id = c.id; if (!/^c[a-z0-9]{1,10}$/.test(id || '') || used.has(id)) id = 'c' + i; while (used.has(id)) id += 'x'; used.add(id); c.id = id; });
    if (custom.length) out.custom = custom;
    const order = [...new Set((Array.isArray(r.order) ? r.order : []).filter((k) => REMOTE_KEYS.includes(k) || used.has(k)))].slice(0, 40);      // the person's arrangement of the buttons, if any
    if (order.length) out.order = order;
    return out;
  }
  const ROUTINE_MODES = ['run', 'toggle', 'menu', 'cycle'];
  const VALUE_ACTIONS = ['select_source', 'select_option', 'send_command', 'set_number', 'set_humidity', 'set_water_temp', 'speak'], MAX_WAIT_S = 60;      // steps that name an input or option; the most one may wait before it runs
  const MAX_STEPS = 12, MAX_CHOICES = 8, STEP_GAP_MS = 350;
  const GROUP_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'media_player']);    // nothing that needs a PIN or can hurt anyone when switched as one
  const GROUP_MODES = ['toggle', 'all_on', 'all_off'];
  const PHONE_SIZES = ['full', 'half', 'third', 'hide'];
  const PHONE_HEIGHTS = ['compact', 'normal', 'tall'];                   // how high a tile is on a phone, when not the automatic way                  // how a tile shows on a phone, when not the automatic way
  const PALETTES = ['warm', 'forest', 'ocean', 'mono'];            // "" is the standard one
  const LOOKS = { tiles: ['outline', 'glass'], corners: ['square', 'pill'], gap: ['tight', 'roomy'], icons: ['large', 'none'], details: ['simple'], backdrop: ['gradient'] };    // how the tiles look; the usual way is "" and is not stored
  const TEXT_SCALES = ['large', 'xlarge'];                         // "" is the standard size
  const RULE_SCREENS = ['', 'clock', 'photos'];
  const MAX_RULES = 8, MAX_MEMBERS = 30;
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '');
  const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
  const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const color = (v) => { const s = str(v, 12); return COLOR_PRESETS.includes(s) || HEX.test(s) ? s.toLowerCase() : ''; };
  const ENTITY = /^[a-z_]+\.[a-zA-Z0-9_]+$/;
  const CARD = /^[a-z][a-z0-9_]{1,40}$/;
  const CAMERA = /^cam_\d{1,9}$/;
  const ID = /^[A-Za-z0-9_-]{1,40}$/;

  // One step of a routine, cleaned, or null. Unlocking is only kept on a tile that asks for the PIN.
  // A step may only run when another device (or its own) is on or off: { only_if: { ref, is: 'on' | 'off' } }. That is how a remote's power button, which switches a TV off when it is on, is only sent when the TV is off.
  const COND_DOMAINS = ['media_player', 'light', 'switch', 'fan', 'input_boolean', 'humidifier', 'siren', 'water_heater'];
  function cleanStep(s, needsPin) {
    const out = cleanStepCore(s, needsPin); if (!out) return null;
    const c = s.only_if, cref = c && typeof c === 'object' ? str(c.ref, 80) : '';
    if (c && (c.is === 'on' || c.is === 'off') && ENTITY.test(cref) && COND_DOMAINS.includes(cref.split('.')[0])) out.only_if = { ref: cref, is: c.is };
    return out;
  }
  function cleanStepCore(s, needsPin) {
    if (!s || typeof s !== 'object') return null;
    const ref = str(s.ref, 80); if (!ENTITY.test(ref)) return null;
    const allowed = STEP_ACTIONS[ref.split('.')[0]]; if (!allowed || !allowed.includes(s.do)) return null;
    if (s.do === 'unlock' && !needsPin) return null;
    if (VALUE_ACTIONS.includes(s.do)) {                         // "switch input to ..." and "choose ..." carry the name of the input or option, and may wait first (a TV that was just switched on is slow to take it)
      const value = str(s.value, s.do === 'speak' ? 250 : 100); if (!value) return null;
      if (['set_number', 'set_humidity', 'set_water_temp'].includes(s.do) && !Number.isFinite(Number(value))) return null;          // these take a number
      if (s.do === 'speak') { const player = str(s.device, 80); if (!/^media_player\.[a-zA-Z0-9_]+$/.test(player)) return null; return { ref, do: s.do, value, device: player }; }      // the speaker is the media player to speak on
      if (s.do === 'select_source' && s.wait_on === true) return { ref, do: s.do, value, wait_on: true, wait: int(s.wait, 1, MAX_WAIT_S, 30) };      // wait until the device reports on, for at most wait seconds
      const wait = int(s.wait, 0, MAX_WAIT_S, 0), out = { ref, do: s.do, value };
      if (s.do === 'send_command') { const device = str(s.device, 60), repeat = int(s.repeat, 1, 20, 1); if (device) out.device = device; if (repeat > 1) out.repeat = repeat; }      // a remote's command also names the device it was learned for, and may be sent several times (volume)
      if (wait) out.wait = wait;
      return out;
    }
    return { ref, do: s.do };
  }
  const cleanSteps = (list, needsPin) => (Array.isArray(list) ? list : []).slice(0, MAX_STEPS).map((s) => cleanStep(s, needsPin)).filter(Boolean);
  // The steps of a routine tile, cleaned: only what its mode uses is kept. Null when there is nothing to run.
  function cleanRoutine(r, needsPin) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const mode = oneOf(r.mode, ROUTINE_MODES, 'run'), out = { mode };
    if (mode === 'menu' || mode === 'cycle') {                  // a cycle takes the same list of named choices, but runs the next one on each tap
      const choices = (Array.isArray(r.choices) ? r.choices : []).slice(0, MAX_CHOICES).map((c) => ({ label: str(c && c.label, MAX_NAME), steps: cleanSteps(c && c.steps, needsPin) })).filter((c) => c.steps.length);
      if (!choices.length) return null;
      choices.forEach((c, i) => { if (!c.label) c.label = 'Choice ' + (i + 1); });
      out.choices = choices;
      const again = mode === 'cycle' ? int(r.reset_after, 0, 1440, 0) : 0;      // minutes without a tap after which a turn-taking tile goes back to its first press (0: never)
      if (again) out.reset_after = again;
      return out;
    }
    const steps = cleanSteps(r.steps, needsPin); if (!steps.length) return null;
    out.steps = steps;
    if (mode === 'toggle') {
      const off = cleanSteps(r.off_steps, needsPin); if (off.length) out.off_steps = off;
      const ind = str(r.indicator, 80); if (ENTITY.test(ind) && [...steps, ...off].some((x) => x.ref === ind)) out.indicator = ind;
    }
    return out;
  }

  function emptyLayout() { return { v: 1, theme: { mode: 'dark', accent: '#5aa2f0' }, idle: { mode: 'photos', minutes: 5 }, grid: { cols: 8, rows: 5 }, pages: [{ id: 'home', name: 'Home', tiles: [] }] }; }

  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null; };

  // Time-of-day rules: between `from` and `to` (it may run past midnight) on the chosen days (0 is Sunday) the screen dims, goes to the clock or photos, and/or opens a page.
  function cleanRules(list, pageIds) {
    const seen = new Set(), out = [];
    for (const r of (Array.isArray(list) ? list : []).slice(0, MAX_RULES)) {
      if (!r || typeof r !== 'object' || !HHMM.test(String(r.from || '')) || !HHMM.test(String(r.to || ''))) continue;
      let id = str(r.id, 40); if (!ID.test(id) || seen.has(id)) id = 'r' + (out.length + 1) + '_' + (randomId ? randomId() : Math.random().toString(36).slice(2, 6));
      seen.add(id);
      const days = [...new Set((Array.isArray(r.days) ? r.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      out.push({ id, from: r.from, to: r.to, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6], dim: int(r.dim, 0, 85, 0), screen: oneOf(r.screen, RULE_SCREENS, ''), page: pageIds.has(r.page) ? r.page : '' });
    }
    return out;
  }

  // One tile, cleaned. Returns null when it cannot be used at all (no usable source). A tile sits inside the grid whatever its stored size says.
  function cleanTile(t, cols, rows, seen) {
    if (!t || typeof t !== 'object') return null;
    const kind = oneOf(t.kind, KINDS, '');
    const ref = str(t.ref, 80);
    if (kind === 'ha' ? !ENTITY.test(ref) : kind === 'camera' ? !CAMERA.test(ref) : kind ? !CARD.test(ref) : true) return null;
    let members = [];
    if (kind === 'group') {
      members = [...new Set((Array.isArray(t.members) ? t.members : []).map((m) => str(m, 80)).filter((m) => ENTITY.test(m) && GROUP_DOMAINS.has(m.split('.')[0])))].slice(0, MAX_MEMBERS);
      if (!members.length) return null;
    }
    let routine = null;
    if (kind === 'routine') { routine = cleanRoutine(t.routine, !!t.needs_pin); if (!routine) return null; }
    let id = str(t.id, 40); if (!ID.test(id) || seen.has(id)) { id = 't' + (seen.size + 1) + '_' + (randomId ? randomId() : Math.random().toString(36).slice(2, 8)); }
    seen.add(id);
    const w = int(t.w, 1, cols, 1), h = int(t.h, 1, rows, 1);
    const out = {
      id, kind, ref,
      x: int(t.x, 0, cols - w, 0), y: int(t.y, 0, rows - h, 0), w, h,
      label: str(t.label, MAX_NAME), icon: str(t.icon, 40),
      color_on: color(t.color_on), color_off: color(t.color_off),
      text_size: oneOf(t.text_size, SIZES, 'normal'),
      needs_pin: !!t.needs_pin,
      tap: oneOf(t.tap, ACTIONS, 'toggle'), long: oneOf(t.long, LONG_ACTIONS, 'details'),
    };
    if (kind === 'card' && t.card_config && typeof t.card_config === 'object' && !Array.isArray(t.card_config)) {
      const j = JSON.stringify(t.card_config);
      out.card_config = j.length <= 2000 ? JSON.parse(j) : {};
    }
    if (routine) out.routine = routine;
    if (PHONE_SIZES.includes(t.phone)) out.phone = t.phone;
    if (t.confirm === true) out.confirm = true;                   // the tile asks "do this now?" before it acts
    if (PHONE_HEIGHTS.includes(t.phone_h)) out.phone_h = t.phone_h;
    if (kind === 'camera' && t.fit === 'contain') out.fit = 'contain';        // show the whole picture, with bars where its shape differs from the tile's, instead of filling the tile and cropping
    if (kind === 'camera' && t.live) out.live = true;               // the tile plays the camera's live video itself, not just a still picture
    if (kind === 'group') { out.members = members; out.group_mode = oneOf(t.group_mode, GROUP_MODES, 'toggle'); }
    if (kind === 'ha' && ref.startsWith('remote.')) { const rm = cleanRemote(t.remote); if (rm) out.remote = rm; }
    if (kind === 'ha') {                                           // a sensor can show a trend line and turn red past a limit (or when it reads a given state, such as "on" for an open door)
      const above = num(t.alert_above), below = num(t.alert_below), state = str(t.alert_state, 40);
      if (above !== null) out.alert_above = above;
      if (below !== null) out.alert_below = below;
      if (state) out.alert_state = state;
      if (t.spark) { out.spark = true; out.spark_hours = int(t.spark_hours, 1, 72, 24); }
    }
    return out;
  }

  // The idle screen: when it comes on, and (only what differs from the usual way) how its photos are picked: from one tag, how long each stays, in order or shuffled without repeats,
  // how a photo is fitted to the screen, and whether small photos (which would look blurry blown up) are skipped.
  function cleanIdle(idle) {
    const out = { mode: oneOf(idle.mode, IDLE_MODES, 'photos'), minutes: int(idle.minutes, 0, 480, 5) };      // 0: never goes idle
    const p = idle.photos && typeof idle.photos === 'object' && !Array.isArray(idle.photos) ? idle.photos : {}, ph = {};
    const tag = str(p.tag, 40).replace(/,/g, ''); if (tag) ph.tag = tag;
    const seconds = int(p.seconds, 5, 600, 30); if (seconds !== 30) ph.seconds = seconds;
    if (p.order === 'order') ph.order = 'order';
    if (p.fit === 'fill' || p.fit === 'whole') ph.fit = p.fit;
    if (p.skip_small === false) ph.skip_small = false;
    if (Object.keys(ph).length) out.photos = ph;
    return out;
  }

  // The whole layout, cleaned: unknown fields dropped, numbers clamped, strings shortened, tiles without a usable source dropped. Never throws; junk gives an empty layout.
  function cleanLayout(raw) {
    let o = raw;
    if (typeof raw === 'string') { if (raw.length > 400000) return emptyLayout(); try { o = JSON.parse(raw); } catch { return emptyLayout(); } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return emptyLayout();
    const g = o.grid && typeof o.grid === 'object' ? o.grid : {};
    const cols = int(g.cols, GRID.min, GRID.max, 8), rows = int(g.rows, GRID.min, GRID.max, 5);
    const theme = o.theme && typeof o.theme === 'object' ? o.theme : {};
    const idle = o.idle && typeof o.idle === 'object' ? o.idle : {};
    const pagesIn = Array.isArray(o.pages) ? o.pages.slice(0, MAX_PAGES) : [];
    const seenPages = new Set(), seenTiles = new Set();
    const pages = pagesIn.filter((p) => p && typeof p === 'object').map((p, i) => {
      let id = str(p.id, 40); if (!ID.test(id) || seenPages.has(id)) id = 'p' + (i + 1);
      while (seenPages.has(id)) id += '_';
      seenPages.add(id);
      const tiles = (Array.isArray(p.tiles) ? p.tiles.slice(0, MAX_TILES) : []).map((t) => cleanTile(t, cols, rows, seenTiles)).filter(Boolean);
      const page = { id, name: str(p.name, MAX_NAME) || `Page ${i + 1}`, tiles };
      const have = new Set(tiles.map((t) => t.id)), order = [...new Set((Array.isArray(p.phone_order) ? p.phone_order : []).map((x) => str(x, 40)).filter((x) => have.has(x)))];
      if (order.length) page.phone_order = order;                    // the order a phone shows this page's tiles in, when it is not reading order
      return page;
    });
    const outTheme = { mode: oneOf(theme.mode, ['dark', 'light'], 'dark'), accent: HEX.test(String(theme.accent || '')) ? String(theme.accent).toLowerCase() : '#5aa2f0' };
    if (PALETTES.includes(theme.palette)) outTheme.palette = theme.palette;                   // only what differs from the standard is stored
    if (TEXT_SCALES.includes(theme.text)) outTheme.text = theme.text;
    for (const [k, list] of Object.entries(LOOKS)) if (list.includes(theme[k])) outTheme[k] = theme[k];
    if (theme.sound === true) outTheme.sound = true;
    if (theme.haptics === false) outTheme.haptics = false;
    const finalPages = pages.length ? pages : emptyLayout().pages;
    const rules = cleanRules(o.rules, new Set(finalPages.map((p) => p.id)));
    const out = {
      v: 1,
      theme: outTheme,
      idle: cleanIdle(idle),
      grid: { cols, rows },
      pages: finalPages,
    };
    if (rules.length) out.rules = rules;
    if (o.start_hint === false) out.start_hint = false;              // the tip about editing, shown for a few seconds when the page opens, is on unless this tablet says not to
    if (['phone', 'all'].includes(o.confirm_mode)) out.confirm_mode = o.confirm_mode;       // every tile asks first: on a phone, or on every screen (absent: only the tiles that say so)
    if (o.phone_small === true) out.phone_small = true;            // on a phone, simple one-cell tiles are a third of a row wide and one line high, unless a tile says otherwise
    if (o.swipe === false) out.swipe = false;                       // swiping sideways between pages is on unless this tablet says not to
    if (o.edit_pin === false) out.edit_pin = false;                // rearranging on the tablet asks for the household PIN unless this tablet says not to
    return out;
  }

  function rowOut(r) {
    let layout; try { layout = cleanLayout(r.layout_json); } catch { layout = emptyLayout(); }
    return { id: r.id, name: r.name, last_seen: r.last_seen || 0, online: r.last_seen ? now() - r.last_seen < ONLINE_MS : false, version: r.version || 1, layout, pin_set: !!requiredPin(), pin_optional: pinOptional() };      // pin_set: rearranging asks for a PIN (the tablet's own, else the app's)
  }
  // What each toggling routine tile last did (on = its "on" steps ran last), kept here so every tablet shows the same, for tiles that have no device to read it from.
  db.exec(`CREATE TABLE IF NOT EXISTS tablet_routine_state (tablet_id TEXT NOT NULL, tile_id TEXT NOT NULL, on_state INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tablet_id, tile_id))`);
  const getRow = (id) => db.prepare(`SELECT * FROM tablets WHERE id = ?`).get(id);

  app.get('/api/tablets', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(db.prepare(`SELECT * FROM tablets ORDER BY created_at ASC, id ASC`).all().map((r) => {
      const t = rowOut(r);
      return { id: t.id, name: t.name, last_seen: t.last_seen, online: t.online, pages: t.layout.pages.length, tiles: t.layout.pages.reduce((n, p) => n + p.tiles.length, 0) };
    }));
  });
  app.post('/api/tablets', (req, res) => {
    const name = str(req.body && req.body.name, MAX_NAME) || 'Tablet';
    const id = 'tab_' + (randomId ? randomId() : Math.random().toString(36).slice(2, 10));
    const count = db.prepare(`SELECT COUNT(*) n FROM tablets`).get().n;
    if (count >= 30) return res.status(400).json({ error: 'That is the most tablets one household can have.' });
    const from = req.body && req.body.copy_from ? getRow(str(req.body.copy_from, 40)) : null;          // start with another tablet's tiles (a phone usually wants the same ones)
    const start = from ? cleanLayout(from.layout_json) : emptyLayout();
    db.prepare(`INSERT INTO tablets (id, name, layout_json, version, created_at, last_seen) VALUES (?, ?, ?, 1, ?, 0)`).run(id, name, JSON.stringify(start), now());
    broadcastUpdate('tablets');
    res.status(201).json(rowOut(getRow(id)));
  });
  app.get('/api/tablets/:id', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    res.json(rowOut(r));
  });
  app.put('/api/tablets/:id', (req, res) => {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    const name = str(req.body && req.body.name, MAX_NAME);
    if (!name) return res.status(400).json({ error: 'Give the tablet a name.' });
    db.prepare(`UPDATE tablets SET name = ? WHERE id = ?`).run(name, r.id);
    broadcastUpdate('tablets');
    res.json(rowOut(getRow(r.id)));
  });
  app.delete('/api/tablets/:id', (req, res) => {
    const out = db.prepare(`DELETE FROM tablets WHERE id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM tablet_routine_state WHERE tablet_id = ?`).run(req.params.id);
    if (!out.changes) return res.status(404).json({ error: 'Tablet not found.' });
    broadcastUpdate('tablets');
    res.json({ ok: true });
  });
  // The tablet checks in (its page calls this every 30 seconds); the answer says whether the layout changed since the page last drew it.
  app.post('/api/tablets/:id/checkin', (req, res) => {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    db.prepare(`UPDATE tablets SET last_seen = ? WHERE id = ?`).run(now(), r.id);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, version: r.version || 1, name: r.name, pin_set: !!requiredPin(), pin_optional: pinOptional() });
  });
  app.put('/api/tablets/:id/layout', (req, res) => {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    if (!req.body || typeof req.body.layout !== 'object') return res.status(400).json({ error: 'layout is required.' });
    // The tablet sends the version it started from: if the layout was changed somewhere else since (the app, another tablet's copy), refuse instead of overwriting it.
    if (req.body.base_version !== undefined && Number(req.body.base_version) !== (r.version || 1)) return res.status(409).json({ error: 'This layout was changed somewhere else.', code: 'STALE_LAYOUT', version: r.version || 1 });
    const layout = cleanLayout(req.body.layout);
    db.prepare(`UPDATE tablets SET layout_json = ?, version = version + 1 WHERE id = ?`).run(JSON.stringify(layout), r.id);
    remember(commandsInLayout(layout));
    broadcastUpdate('tablets');
    res.json(rowOut(getRow(r.id)));
  });

  // ── a tile that needs the PIN ──────────────────────────────────────────────────────────────────────────────────────
  const tries = new Map();                                     // ip -> { n, first, until }
  function allowTry(ip) {
    const t = now(), e = tries.get(ip);
    if (e && e.until && t < e.until) return { ok: false, wait: e.until - t };
    if (!e || t - e.first > 10 * 60 * 1000) { tries.set(ip, { n: 1, first: t, until: 0 }); return { ok: true }; }
    e.n++;
    if (e.n > 5) { e.until = t + 5 * 60 * 1000; return { ok: false, wait: 5 * 60 * 1000 }; }
    return { ok: true };
  }
  const ipOf = (req) => String((req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '')).split(',')[0].trim();
  // The PIN step shared by single devices and groups. Answers the request itself and returns { ok: false } when the caller must stop.
  // The tablet has a PIN of its own (the setting tablet_pin), so the tablet can ask for one without the app asking for one on the phone. Tiles that need a PIN and rearranging ask for it; when there is none,
  // the app's PIN (app_pin) is used as before. The hub's own calls to itself still carry the app PIN, which is what the rest of the hub checks.
  const requiredPin = () => getSetting('tablet_pin') || getSetting('app_pin') || '';
  // With no PIN at all, tiles that need one stop and say where to set one, unless Settings, Security says they may work without a PIN (the setting tablet_pin_optional).
  const pinOptional = () => getSetting('tablet_pin_optional') === '1';
  const PIN_HINT = 'This tile needs a PIN. Set a tablet PIN in the Piazza HQ app: Settings, Security, Tablet PIN. (Or turn on "Let tiles that need a PIN work without one" there.)';
  function pinGate(req, res, needsPin) {
    const pin = getSetting('app_pin') || '', want = requiredPin();
    if (!needsPin) return { ok: true, pin };
    if (!want) {
      if (pinOptional()) return { ok: true, pin };                         // no PIN, and the household said tiles may work without one
      res.status(403).json({ error: PIN_HINT, code: 'PIN_NOT_SET' }); return { ok: false };
    }
    const lim = allowTry(ipOf(req));
    if (!lim.ok) { res.status(429).json({ error: 'Too many wrong PINs. Try again in a few minutes.', retry_after_ms: lim.wait }); return { ok: false }; }
    if (String((req.body && req.body.pin) || '') !== want) { res.status(403).json({ error: 'That PIN is not right.', code: 'BAD_PIN' }); return { ok: false }; }
    tries.delete(ipOf(req));
    return { ok: true, pin };
  }
  // Check a PIN without doing anything (the tablet asks for it before rearranging). Same limit on wrong tries as the tiles.
  app.post('/api/tablets/:id/verify-pin', (req, res) => {
    if (!getRow(req.params.id)) return res.status(404).json({ error: 'Tablet not found.' });
    if (!requiredPin()) return res.json({ ok: true, required: false });
    const lim = allowTry(ipOf(req));
    if (!lim.ok) return res.status(429).json({ error: 'Too many wrong PINs. Try again in a few minutes.', retry_after_ms: lim.wait });
    if (String((req.body && req.body.pin) || '') !== requiredPin()) return res.status(403).json({ error: 'That PIN is not right.', code: 'BAD_PIN' });
    tries.delete(ipOf(req));
    res.json({ ok: true, required: true });
  });
  async function callLocal(path, body, pin, res) {
    try {
      const resp = await fetchWithTimeout(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', timeoutMs: 12000, headers: { 'Content-Type': 'application/json', 'x-host-pin': pin }, body: JSON.stringify(body) });
      let json = {}; try { json = await resp.json(); } catch { json = {}; }
      res.status(resp.status).json(json);
    } catch (e) { res.status(502).json({ error: 'Could not reach Home Assistant: ' + String((e && e.message) || e).slice(0, 100) }); }
  }
  app.post('/api/tablets/:id/ha-action', async (req, res) => {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    const b = req.body || {};
    const entityId = String(b.entityId || ''), action = String(b.action || '');
    if (!ENTITY.test(entityId) || !HA_ACTION_WHITELIST.has(action)) return res.status(400).json({ error: 'That action is not available.' });
    // does the layout say this device needs the PIN? Locks always do.
    const layout = rowOut(r).layout;
    const flagged = layout.pages.some((p) => p.tiles.some((t) => t.kind === 'ha' && t.ref === entityId && t.needs_pin));
    const gate = pinGate(req, res, flagged || PIN_DOMAINS.some((d) => entityId.startsWith(d + '.')));
    if (!gate.ok) return;
    const body = { entityId, action };
    for (const k of EXTRA_KEYS) if (b[k] !== undefined) body[k] = b[k];
    await callLocal('/api/ha/call-action', body, gate.pin, res);
  });
  // A group tile switches all of its stored members on or off in one call. The members come from the saved layout, never from the request, so a tablet can only ever switch what the layout names.
  app.post('/api/tablets/:id/group-action', async (req, res) => {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    const b = req.body || {}, action = String(b.action || '');
    if (action !== 'turn_on' && action !== 'turn_off') return res.status(400).json({ error: 'That action is not available.' });
    let tile = null;
    for (const p of rowOut(r).layout.pages) for (const t of p.tiles) if (t.kind === 'group' && t.id === String(b.tileId || '')) tile = t;
    if (!tile) return res.status(404).json({ error: 'That tile was not found.' });
    const gate = pinGate(req, res, !!tile.needs_pin);
    if (!gate.ok) return;
    await callLocal('/api/ha/call-group-action', { entityIds: tile.members, action }, gate.pin, res);
  });

  // One call to Home Assistant for one step. Answers { ok } or { ok: false, error }, never throws.
  // Is this device off (or not there)? Home Assistant calls a media player that is switched off "off" or "standby"; one that is unplugged or not reachable "unavailable".
  const OFFISH = new Set(['off', 'standby', 'unavailable', 'unknown', '']);
  // The state of a device for a decision (is it on? did it change input?): Home Assistant is asked to look at the device again first, because one it polls (a Vizio TV, every 30 seconds) can be on while
  // Home Assistant still says off, and a power command sent then switches it off again. When that cannot be done the state Home Assistant has is used.
  async function readState(ref, pin) {
    try {
      let resp = await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/ha/refresh/${encodeURIComponent(ref)}`, { method: 'POST', timeoutMs: 9000, headers: { 'x-host-pin': pin } });
      if (!resp.ok && resp.status !== 404) resp = await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/ha/state/${encodeURIComponent(ref)}`, { timeoutMs: 8000, headers: { 'x-host-pin': pin } });
      if (!resp.ok) return resp.status === 404 ? { missing: true } : null;
      return await resp.json();
    } catch { return null; }
  }
  // Wait for a device that was just switched on to report that it is on (up to maxS seconds), then a moment more for it to accept commands. True when it came on; a device that was on already is not waited for.
  async function waitUntilOn(ref, maxS, pin) {
    const t0 = Date.now(); let first = true;
    for (;;) {
      const st = await readState(ref, pin);
      if (st && typeof st.state === 'string' && !OFFISH.has(st.state)) { if (!first) await sleep(T.settleMs); return true; }
      first = false;
      if (Date.now() - t0 + T.pollMs > maxS * 1000) return false;
      await sleep(T.pollMs);
    }
  }
  // Why a step failed, in words a person can act on: the device is not reachable, or is not in Home Assistant, else what Home Assistant said.
  async function explain(step, said, pin) {
    const st = await readState(step.ref, pin);
    if (st && st.missing) return 'is not in Home Assistant any more';
    if (st && st.state === 'unavailable') return 'is not available right now (switched off at the wall, or not connected)';
    return said;
  }
  async function callStepOnce(step, pin) {
    try {
      const resp = await fetchWithTimeout(`http://127.0.0.1:${PORT}/api/ha/call-action`, { method: 'POST', timeoutMs: 20000, headers: { 'Content-Type': 'application/json', 'x-host-pin': pin }, body: JSON.stringify({ entityId: step.ref, action: step.do, source: step.do === 'select_source' ? step.value : undefined, option: step.do === 'select_option' ? step.value : undefined, command: step.do === 'send_command' ? step.value : undefined, device: step.do === 'send_command' ? step.device : undefined, value: step.do === 'set_number' ? step.value : undefined, humidity: step.do === 'set_humidity' ? step.value : undefined, temperature: step.do === 'set_water_temp' ? step.value : undefined, message: step.do === 'speak' ? step.value : undefined, media_player: step.do === 'speak' ? step.device : undefined, num_repeats: step.do === 'send_command' && step.repeat > 1 ? step.repeat : undefined }) });
      let json = {}; try { json = await resp.json(); } catch { json = {}; }
      return resp.ok ? { ok: true } : { ok: false, ref: step.ref, error: str(json.error, 120) || 'That did not work.' };
    } catch (e) { return { ok: false, ref: step.ref, error: 'Could not reach Home Assistant.' }; }
  }
  // One step. Switching an input or choosing an option can be done twice without harm, so one that fails is tried again after a moment, and a switch that Home Assistant accepted but the device
  // ignored (it reports another input a moment later) is asked for once more. Anything that still fails says why.
  // Is a device on? A media player is on whenever it is not off, in standby or out of reach; anything else when Home Assistant says "on".
  const isOnState = (ref, state) => (ref.startsWith('media_player.') ? !OFFISH.has(state) : state === 'on');
  async function callStep(step, pin) {
    // "Only if": a step that depends on a device being on or off is skipped when it is not (when its state cannot be read the step runs).
    if (step.only_if) { const st = await readState(step.only_if.ref, pin); if (st && typeof st.state === 'string' && isOnState(step.only_if.ref, st.state) !== (step.only_if.is === 'on')) return { ok: true, skipped: true }; }
    // "Turn on" for a media player that is on already is left alone, and so is "Turn off" for one that is off: some TVs have one power command that toggles, so a second one undoes the first.
    if ((step.do === 'turn_on' || step.do === 'turn_off') && step.ref.startsWith('media_player.')) {
      const st = await readState(step.ref, pin);
      if (st && typeof st.state === 'string' && (step.do === 'turn_on' ? !OFFISH.has(st.state) : (st.state === 'off' || st.state === 'standby'))) return { ok: true, skipped: true };
    }
    let r = await callStepOnce(step, pin);
    if (VALUE_ACTIONS.includes(step.do)) {
      if (!r.ok) { await sleep(T.retryMs); const again = await callStepOnce(step, pin); if (again.ok) r = again; }
      else if (step.do === 'select_source') {
        await sleep(T.verifyMs);
        const st = await readState(step.ref, pin);
        if (st && st.source && String(st.source).toLowerCase() !== step.value.toLowerCase()) await callStepOnce(step, pin);
      }
    }
    if (!r.ok) r.error = await explain(step, r.error, pin);
    return r;
  }
  // A routine tile runs the steps its saved layout names (never ones from the request): all of a run tile's, the on or the off list of a toggle tile, one choice of a menu tile.
  // Steps start a third of a second apart, in order, without waiting for each to finish (Home Assistant answers a call only after about a second and a half, so waiting would
  // make a routine of six steps take ten seconds). A step that fails does not stop the rest; the answer says which ones did not work.
  // A tile that other screens (the wall display, the Favorites tab) may run: an Actions tile that needs no PIN and has no lock in it. Those screens have no PIN pad, so such a tile stays on the tablet.
  const sharable = (t) => t.kind === 'routine' && !t.needs_pin && !tmRoutineHasLock(t.routine);
  const tmRoutineHasLock = (ro) => [ro.steps, ro.off_steps, ...(ro.choices || []).map((c) => c.steps)].some((l) => (l || []).some((s) => s.ref.startsWith('lock.')));
  async function runRoutine(req, res, onlyShared) {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    const b = req.body || {};
    let tile = null;
    for (const p of rowOut(r).layout.pages) for (const t of p.tiles) if (t.kind === 'routine' && t.id === String(b.tileId || '')) tile = t;
    if (!tile || (onlyShared && !sharable(tile))) return res.status(404).json({ error: 'That tile was not found.' });
    const ro = tile.routine; let steps, which = 'steps';
    let pos;
    if (ro.mode === 'menu') { const c = ro.choices[Number(b.index)]; if (!c) return res.status(400).json({ error: 'That choice was not found.' }); steps = c.steps; }
    else if (ro.mode === 'cycle') {                              // the one asked for, else the one after the last that ran here (the first when none has)
      const n = ro.choices.length;
      if (b.index !== undefined && b.index !== null) { pos = Number(b.index); if (!Number.isInteger(pos) || pos < 0 || pos >= n) return res.status(400).json({ error: 'That choice was not found.' }); }
      else { const st = db.prepare(`SELECT on_state, at FROM tablet_routine_state WHERE tablet_id = ? AND tile_id = ?`).get(r.id, tile.id), stale = ro.reset_after && st && now() - st.at > ro.reset_after * 60000; pos = st && !stale && Number.isInteger(st.on_state) && st.on_state >= 0 ? (st.on_state + 1) % n : 0; }
      steps = ro.choices[pos].steps;
    }
    else if (ro.mode === 'toggle' && b.set === 'off_steps' && ro.off_steps) { steps = ro.off_steps; which = 'off_steps'; }
    else steps = ro.steps;
    const gate = pinGate(req, res, !!tile.needs_pin || steps.some((s) => s.ref.startsWith('lock.')));
    if (!gate.ok) return;
    // The same on or off asked of the same device twice in one run is done once (a TV that is told to turn on again while it is still starting up can switch itself off).
    const seenOnOff = new Set();
    steps = steps.filter((x) => { if (x.do !== 'turn_on' && x.do !== 'turn_off') return true; const k = x.ref + '|' + x.do; if (seenOnOff.has(k)) return false; seenOnOff.add(k); return true; });
    const t0 = Date.now(), calls = []; let at = 0;                // when each step starts: a third of a second after the one before, plus its own wait; the steps after a wait come later too
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.wait_on) await waitUntilOn(s.ref, s.wait || 30, gate.pin);        // "wait until it is on": as soon as the device says so, or after the longest wait
      else at += s.wait ? s.wait * 1000 : 0;
      if (i) at += STEP_GAP_MS;
      const delay = at - (Date.now() - t0); if (delay > 0) await sleep(delay);
      at = Math.max(at, Date.now() - t0);
      calls.push(callStep(s, gate.pin));
    }
    const results = await Promise.all(calls);
    const failed = results.filter((x) => !x.ok).map((x) => ({ ref: x.ref, error: x.error })), done = results.length - failed.length;
    if (!done) return res.status(502).json({ error: failed[0].error, failed, done: 0, total: results.length });
    if (ro.mode === 'cycle') db.prepare(`INSERT INTO tablet_routine_state (tablet_id, tile_id, on_state, at) VALUES (?, ?, ?, ?) ON CONFLICT(tablet_id, tile_id) DO UPDATE SET on_state = excluded.on_state, at = excluded.at`).run(r.id, tile.id, pos, now());
    if (ro.mode === 'toggle') db.prepare(`INSERT INTO tablet_routine_state (tablet_id, tile_id, on_state, at) VALUES (?, ?, ?, ?) ON CONFLICT(tablet_id, tile_id) DO UPDATE SET on_state = excluded.on_state, at = excluded.at`).run(r.id, tile.id, which === 'steps' ? 1 : 0, now());
    res.json({ ok: !failed.length, done, total: results.length, failed, on: ro.mode === 'toggle' ? which === 'steps' : undefined, pos: ro.mode === 'cycle' ? pos : undefined });
  }
  app.post('/api/tablets/:id/routine-action', (req, res) => runRoutine(req, res, false));
  // The commands a layout uses, as [{ ref, device, command }]: a remote tile's buttons and custom buttons, and the "send command" steps of Actions tiles.
  function commandsInLayout(layout) {
    const out = [], add = (ref, device, command) => { command = str(command, 60); if (ref && command) out.push({ ref, device: str(device, 60), command }); };
    for (const p of layout.pages) for (const t of p.tiles) {
      if (t.kind === 'ha' && t.remote) {
        Object.values(t.remote.buttons || {}).forEach((c) => add(t.ref, t.remote.device, c));
        (t.remote.custom || []).forEach((c) => add(c.ref || t.ref, c.ref ? c.device : (c.device !== undefined ? c.device : t.remote.device), c.command));
      }
      if (t.kind === 'routine' && t.routine) for (const l of [t.routine.steps, t.routine.off_steps, ...(t.routine.choices || []).map((c) => c.steps)]) (l || []).forEach((s) => { if (s.do === 'send_command') add(s.ref, s.device, s.value); });
    }
    return out;
  }
  // What the app remembers of the commands remotes were taught (the setting remote_commands: { "remote.x": ["Device|Command", ...] }), so they are still offered after the tile that used them is removed.
  // Home Assistant cannot list them. Kept to a few hundred per remote.
  function readMemory() { try { const m = JSON.parse(getSetting('remote_commands') || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; } }
  function remember(items) {                                    // items: [{ ref, device, command }]
    if (!setSetting || !items.length) return;
    const mem = readMemory(); let changed = false;
    for (const it of items) {
      if (!/^remote\.[a-zA-Z0-9_]+$/.test(it.ref)) continue;
      const list = Array.isArray(mem[it.ref]) ? mem[it.ref] : (mem[it.ref] = []), key = (it.device || '') + '|' + it.command;
      if (!list.includes(key) && list.length < 300) { list.push(key); changed = true; }
    }
    if (changed) { try { setSetting('remote_commands', JSON.stringify(mem)); } catch { /* a convenience */ } }
  }
  function forget(ref, device, command) {
    if (!setSetting) return;
    const mem = readMemory(), key = (device || '') + '|' + command;
    if (Array.isArray(mem[ref]) && mem[ref].includes(key)) { mem[ref] = mem[ref].filter((k) => k !== key); try { setSetting('remote_commands', JSON.stringify(mem)); } catch { /* a convenience */ } }
  }
  const onRemoteCommand = (what, ref, device, command) => { if (what === 'learn') remember([{ ref, device: device || '', command }]); else forget(ref, device || '', command); };
  // Home Assistant cannot list the commands a learning remote was taught, so the ones the app knows of are offered: those saved in tiles (a remote's buttons, custom buttons, Actions steps), with their device names.
  app.get('/api/ha/remote-commands/:entityId', (req, res) => {
    const entity = String(req.params.entityId || ''), seen = new Map();
    if (!/^remote\.[a-zA-Z0-9_]+$/.test(entity)) return res.status(400).json({ error: 'That is not a remote.' });
    const add = (device, command) => { command = str(command, 60); device = str(device, 60); if (command && !seen.has(device + '|' + command)) seen.set(device + '|' + command, { device, command }); };
    for (const row of db.prepare('SELECT id FROM tablets').all()) { const r = getRow(row.id); if (r) commandsInLayout(rowOut(r).layout).forEach((c) => { if (c.ref === entity) add(c.device, c.command); }); }
    ((readMemory()[entity]) || []).forEach((k) => { const i = k.indexOf('|'); add(k.slice(0, i), k.slice(i + 1)); });          // taught or used once, and remembered even if the tile is gone
    res.set('Cache-Control', 'no-store');
    res.json({ commands: [...seen.values()].sort((a, b) => a.device.localeCompare(b.device) || a.command.localeCompare(b.command)) });
  });
  // Stalls the tablet page reports (it was stuck for a few seconds), the last fifty, kept in the setting tablet_stalls: when, which tablet, how long, and what it was showing. For looking into a freeze.
  const readStalls = () => { try { const l = JSON.parse(getSetting('tablet_stalls') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
  app.post('/api/tablets/:id/stall', (req, res) => {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    const b = req.body || {}, n = (v, hi) => int(v, 0, hi, 0);
    const item = { at: now(), tablet: r.id, name: r.name, ms: n(b.ms, 600000), how: b.how === 'tick' ? 'tick' : 'task', editing: !!b.editing, idle: !!b.idle, tiles: n(b.tiles, 1000), live: n(b.live, 100), hidden: !!b.hidden, heap_mb: n(b.heap, 100000) };
    if (setSetting) { try { setSetting('tablet_stalls', JSON.stringify([item, ...readStalls()].slice(0, 50))); } catch { /* a convenience */ } }
    res.json({ ok: true });
  });
  app.get('/api/tablets/:id/stalls', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(readStalls().filter((x) => x.tablet === req.params.id)); });
  // A press on the on-screen remote of a remote.* tile. The command comes from the saved layout (the tile's own name for the button, else its key set's), never from the request.
  app.post('/api/tablets/:id/remote-press', async (req, res) => {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    const b = req.body || {}, key = String(b.key || ''), custom = b.index !== undefined && b.index !== null;       // a button of the pad (key), or one of the tile's own (index)
    let tile = null;
    for (const p of rowOut(r).layout.pages) for (const t of p.tiles) if (t.kind === 'ha' && t.ref.startsWith('remote.') && t.id === String(b.tileId || '')) tile = t;
    if (!tile || (custom ? !Number.isInteger(Number(b.index)) || !((tile.remote || {}).custom || [])[Number(b.index)] : !REMOTE_KEYS.includes(key))) return res.status(404).json({ error: 'That button was not found.' });
    const cfg = tile.remote || { preset: 'custom' };
    if (!custom && (cfg.hidden || []).includes(key)) return res.status(400).json({ error: 'That button is turned off.' });
    const cb = custom ? cfg.custom[Number(b.index)] : null;
    const command = custom ? cb.command : (cfg.buttons || {})[key] || (REMOTE_PRESETS[cfg.preset] || {})[key];
    const target = cb && cb.ref ? cb.ref : tile.ref, device = cb ? (cb.device !== undefined ? cb.device : cb.ref ? undefined : cfg.device) : cfg.device;       // a custom button can send to another remote
    if (!command) return res.status(400).json({ error: 'That button has no command yet. Choose one in the tile\'s options.' });
    const gate = pinGate(req, res, !!tile.needs_pin);
    if (!gate.ok) return;
    const out = await callStep({ ref: target, do: 'send_command', value: command, device }, gate.pin);
    if (!out.ok) return res.status(502).json({ error: out.error });
    res.json({ ok: true });
  });
  // The same, for the wall display and the Favorites tab: only tiles that may be shared (see above).
  app.post('/api/tablet-actions/:id/run', (req, res) => runRoutine(req, res, true));
  // The tablets, and one tablet's shareable Actions tiles with what each last did (the same answer as routine-state), for a wall widget or Favorites card that shows them.
  app.get('/api/tablet-actions', (req, res) => {
    res.json(db.prepare(`SELECT id, name FROM tablets ORDER BY name COLLATE NOCASE`).all());
  });
  app.get('/api/tablet-actions/:id', (req, res) => {
    const r = getRow(req.params.id);
    if (!r) return res.status(404).json({ error: 'Tablet not found.' });
    const out = rowOut(r), tiles = [];
    for (const p of out.layout.pages) for (const t of p.tiles) if (sharable(t)) tiles.push({ id: t.id, label: t.label, icon: t.icon, color_on: t.color_on, color_off: t.color_off, routine: t.routine, page: p.name });
    res.set('Cache-Control', 'no-store');
    res.json({ id: r.id, name: r.name, tiles, state: routineStateOf(r.id) });
  });
  // What this tablet's toggling and turn-taking routine tiles last did: { tileId: true | false } for a toggle, { tileId: number of the choice that ran last } for a cycle.
  function routineStateOf(tabletId) {
    const out = {}, cycles = new Map(), expires = {};
    for (const p of rowOut(getRow(tabletId)).layout.pages) for (const t of p.tiles) if (t.kind === 'routine' && t.routine && t.routine.mode === 'cycle') cycles.set(t.id, t.routine.reset_after || 0);
    for (const x of db.prepare(`SELECT tile_id, on_state, at FROM tablet_routine_state WHERE tablet_id = ?`).all(tabletId)) {
      if (!cycles.has(x.tile_id)) { out[x.tile_id] = !!x.on_state; continue; }
      const again = cycles.get(x.tile_id);
      if (again && now() - x.at > again * 60000) continue;                      // it has started over: nothing to remember
      out[x.tile_id] = x.on_state; if (again) expires[x.tile_id] = x.at + again * 60000;
    }
    if (Object.keys(expires).length) out._expires = expires;                    // when each turn-taking tile that starts over will do so
    return out;
  }
  app.get('/api/tablets/:id/routine-state', (req, res) => {
    if (!getRow(req.params.id)) return res.status(404).json({ error: 'Tablet not found.' });
    res.set('Cache-Control', 'no-store');
    res.json(routineStateOf(req.params.id));
  });

  try { for (const row of db.prepare('SELECT id FROM tablets').all()) { const r = getRow(row.id); if (r) remember(commandsInLayout(rowOut(r).layout)); } } catch { /* the tables may not exist yet */ }          // what the layouts already use is remembered from now on
  return { cleanLayout, emptyLayout, STEP_ACTIONS, REMOTE_PRESETS, REMOTE_KEYS, onRemoteCommand };
};
