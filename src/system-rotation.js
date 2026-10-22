'use strict';
// "Rotate this screen at the system level" (Settings): on a Raspberry Pi the desktop itself turns the screen (wlr-randr on Wayland, xrandr on X11), so the mouse and the touch
// follow the picture. The app's own rotation turns only the page inside the browser, which leaves the system thinking the screen is still landscape: a mouse moved up goes
// sideways on a screen that was turned. With this on, the page is not turned a second time (the display reads the setting, see browserRotation() in
// public/js/display/01-core-web-font-support.js).
//   system_rotation: '' (off: the app rotates in the browser as before) | 'left' | 'right' | 'inverted'  (the names Raspberry Pi's own Screen Configuration uses)
// A change is a TRIAL: it is applied and saved at once, and put back after 20 seconds unless it is kept (a wrong direction, or a monitor that cannot show it, must never leave
// a screen nobody can read). If the server restarts during a trial, the old setting is put back at start. While it is on, the rotation is checked every 90 seconds and put
// back if it has drifted (a monitor going to sleep resets it on labwc, which is what scripts/rotation-watchdog.sh was for).
// Nothing happens where there is nothing to turn (Docker, Windows, a Mac, a Pi without wlr-randr or xrandr).
// Covered by test/unit/system-rotation.test.js and test/api/system-rotation.test.js.
module.exports = function registerSystemRotation({ app, fs, path, os, execFile, dataPath, getSetting, setSetting, broadcastUpdate, IS_CONTAINER, IS_DEMO, log, platform, getuid }) {
  const say = log || (() => {});
  const PLATFORM = platform || process.platform;
  const GETUID = getuid || (typeof process.getuid === 'function' ? () => process.getuid() : null);
  const REVERT_MS = 20 * 1000, WATCH_MS = 90 * 1000, DETECT_MS = 30 * 1000;
  const NAMES = ['left', 'right', 'inverted'];
  // the name -> how each tool says it (wlr-randr's "90" is a quarter turn counter-clockwise, as xrandr's "left")
  const WLR = { normal: 'normal', left: '90', right: '270', inverted: '180' };
  const XRANDR = { normal: 'normal', left: 'left', right: 'right', inverted: 'inverted' };
  const PENDING = () => dataPath('system-rotation-pending.json');

  const supportedHere = () => PLATFORM === 'linux' && !IS_CONTAINER && !IS_DEMO;
  const home = () => (os && os.homedir && os.homedir()) || '';
  function envWayland() {
    const uid = GETUID ? GETUID() : 1000, dir = '/run/user/' + uid;
    let sock = 'wayland-0';
    try { const found = fs.readdirSync(dir).filter((f) => /^wayland-[0-9]+$/.test(f)).sort(); if (found.length) sock = found[0]; } catch (e) { /* the usual name */ }
    return { PATH: process.env.PATH || '/usr/bin:/bin', HOME: home(), XDG_RUNTIME_DIR: dir, WAYLAND_DISPLAY: sock };
  }
  function envX11() {
    return { PATH: process.env.PATH || '/usr/bin:/bin', HOME: home(), DISPLAY: process.env.DISPLAY || ':0', XAUTHORITY: path.join(home(), '.Xauthority') };
  }
  function run(cmd, args, env) {
    return new Promise((resolve) => {
      execFile(cmd, args, { env, timeout: 8000 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') }));
    });
  }

  // wlr-randr: an unindented line starts an output; "Enabled: yes" and "Transform: 90" belong to it
  function parseWlr(text) {
    const outs = [];
    let cur = null;
    for (const line of String(text).split('\n')) {
      if (line && !/^\s/.test(line)) { cur = { name: line.split(/\s+/)[0], enabled: true, transform: 'normal' }; outs.push(cur); continue; }
      if (!cur) continue;
      const en = /^\s*Enabled:\s*(\S+)/.exec(line); if (en) cur.enabled = /^(yes|true|1)$/i.test(en[1]);
      const tr = /^\s*Transform:\s*(\S+)/.exec(line); if (tr) cur.transform = tr[1];
    }
    return outs.filter((o) => o.name && o.enabled);
  }
  const fromWlr = (t) => ({ normal: 'normal', '90': 'left', '270': 'right', '180': 'inverted' }[String(t)] || 'normal');
  // xrandr --query: "HDMI-1 connected primary 1920x1080+0+0 left (normal left inverted right ...) ..."; no word after the geometry means normal
  function parseXrandr(text) {
    const outs = [];
    for (const line of String(text).split('\n')) {
      const m = /^(\S+)\s+connected\s+(?:primary\s+)?(\d+x\d+[+-]\d+[+-]\d+)?\s*(normal|left|right|inverted)?/.exec(line);
      if (m && m[2]) outs.push({ name: m[1], rotation: m[3] || 'normal' });
    }
    return outs;
  }

  let detected = { at: 0, value: null };
  // which tool answers on this machine, which output, and how it is turned now: { tool, env, output, current } or null
  async function detect(force) {
    if (!supportedHere()) return null;
    const now = Date.now();
    if (!force && detected.at && now - detected.at < DETECT_MS) return detected.value;
    let value = null;
    const w = await run('wlr-randr', [], envWayland());
    if (w.ok) { const outs = parseWlr(w.out); if (outs.length) value = { tool: 'wlr-randr', env: envWayland(), output: outs[0].name, current: fromWlr(outs[0].transform) }; }
    if (!value) {
      const x = await run('xrandr', ['--query'], envX11());
      if (x.ok) { const outs = parseXrandr(x.out); if (outs.length) value = { tool: 'xrandr', env: envX11(), output: outs[0].name, current: outs[0].rotation }; }
    }
    detected = { at: now, value };
    return value;
  }
  async function turn(d, name) {
    const args = d.tool === 'wlr-randr' ? ['--output', d.output, '--transform', WLR[name]] : ['--output', d.output, '--rotate', XRANDR[name]];
    const r = await run(d.tool, args, d.env);
    detected = { at: 0, value: null };
    return r;
  }

  let pending = null;                                         // { prev, timer, until } while a trial is running
  const wanted = () => { const v = String(getSetting('system_rotation') || ''); return NAMES.includes(v) ? v : ''; };
  function writePending(prev) { try { fs.writeFileSync(PENDING(), JSON.stringify({ prev })); } catch (e) { /* the timer still puts it back */ } }
  function clearPending() { try { fs.unlinkSync(PENDING()); } catch (e) { /* none */ } if (pending && pending.timer) clearTimeout(pending.timer); pending = null; }
  function readPending() { try { const j = JSON.parse(fs.readFileSync(PENDING(), 'utf8')); return typeof j.prev === 'string' ? j : null; } catch (e) { return null; } }

  async function status() {
    const d = supportedHere() ? await detect(true) : null;
    return { supported: !!d, tool: d ? d.tool : '', output: d ? d.output : '', current: d ? d.current : '', setting: wanted(), pendingSeconds: pending ? Math.max(0, Math.round((pending.until - Date.now()) / 1000)) : 0 };
  }

  // set the rotation ('' = off). A turn (not off) starts the 20-second trial.
  async function set(rotation) {
    if (!['off', 'left', 'right', 'inverted'].includes(rotation)) return { status: 400, error: 'That is not a rotation.' };
    const d = await detect(true);
    if (!d) return { status: 409, error: 'This device cannot turn its own screen (it needs a Raspberry Pi desktop with wlr-randr or xrandr).' };
    const prev = wanted();
    if (!pending) writePending(prev); else if (pending.timer) clearTimeout(pending.timer);
    const prevForTrial = pending ? pending.prev : prev;
    const r = await turn(d, rotation === 'off' ? 'normal' : rotation);
    if (!r.ok) { if (!pending) clearPending(); say('[system-rotation] could not turn the screen: ' + r.err.slice(0, 160)); return { status: 502, error: 'The screen did not turn: ' + (r.err.trim().slice(0, 120) || 'the desktop refused'), }; }
    setSetting('system_rotation', rotation === 'off' ? '' : rotation);
    broadcastUpdate('settings');
    say('[system-rotation] screen set to ' + rotation);
    if (rotation === 'off') { clearPending(); return { status: 200, ok: true, setting: '', pendingSeconds: 0 }; }
    pending = { prev: prevForTrial, until: Date.now() + REVERT_MS, timer: setTimeout(() => { revert().catch(() => {}); }, REVERT_MS) };
    if (pending.timer.unref) pending.timer.unref();
    return { status: 200, ok: true, setting: rotation, pendingSeconds: Math.round(REVERT_MS / 1000) };
  }
  function keep() { const had = !!pending; clearPending(); return { ok: true, kept: had }; }
  async function revert() {
    if (!pending && !readPending()) return { ok: true, setting: wanted(), nothing: true };            // no trial is running: leave things as they are
    const prev = pending ? pending.prev : ((readPending() || {}).prev || '');
    clearPending();
    const d = await detect(true);
    if (d) await turn(d, NAMES.includes(prev) ? prev : 'normal');
    setSetting('system_rotation', NAMES.includes(prev) ? prev : '');
    broadcastUpdate('settings');
    say('[system-rotation] put back to ' + (prev || 'normal'));
    return { ok: true, setting: NAMES.includes(prev) ? prev : '' };
  }

  // at start: a trial the server was restarted in the middle of is undone; then the saved rotation is checked every 90 seconds
  function startup() {
    if (!supportedHere()) return;
    setTimeout(async () => {
      try {
        const left = readPending();
        if (left) { await revert(); }
        else if (wanted()) { const d = await detect(true); if (d && d.current !== wanted()) await turn(d, wanted()); }
      } catch (e) { say('[system-rotation] start: ' + e.message); }
    }, 8000).unref();
    setInterval(async () => {
      try {
        if (!wanted() || pending) return;
        const d = await detect(true);
        if (d && d.current !== wanted()) { say('[system-rotation] rotation drifted (' + d.current + '), putting back ' + wanted()); await turn(d, wanted()); }
      } catch (e) { /* the next check tries again */ }
    }, WATCH_MS).unref();
  }

  app.get('/api/system-rotation', async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await status()); });
  app.post('/api/system-rotation', async (req, res) => {
    const r = await set(String((req.body && req.body.rotation) || ''));
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, setting: r.setting, pendingSeconds: r.pendingSeconds });
  });
  app.post('/api/system-rotation/keep', (req, res) => res.json(keep()));
  app.post('/api/system-rotation/revert', async (req, res) => res.json(await revert()));
  return { status, set, keep, revert, startup, parseWlr, parseXrandr };
};
