'use strict';
// The mouse pointer on a Pi that runs the display as a kiosk. install.sh starts a pointer hider in the desktop's autostart (unclutter on X11, unclutter-xfixes on
// Wayland) so a touchscreen wall never shows an arrow. For a screen used with a mouse, the setting "Always show the mouse pointer" (show_cursor) stops that hider;
// switching it off starts it again with the command it had. The setting has three values: '0' (hidden, the default), 'board' (only over Whiteboards: the page tells the
// server when one is on screen) and '1' (everywhere). The page's own "cursor: none" rule follows the same setting (see public/css/display/01-base-rotation-wrapper.css).
// Nothing happens anywhere that has no hider running (Windows, Docker, a Mac, a Pi without one): the setting is just remembered and the page shows the pointer.
// Covered by test/unit/pointer.test.js.
const HIDERS = ['unclutter-xfixes', 'unclutter'];

module.exports = function registerPointer({ fs, path, os, execFile, spawn, dataPath, getSetting, setSetting, broadcastUpdate, app, log, platform, kill, getuid }) {
  // (platform, kill and getuid are only passed in by the tests; the real ones are used otherwise)
  const PLATFORM = platform || process.platform;
  const KILL = kill || ((pid, sig) => process.kill(pid, sig));
  const GETUID = getuid || (typeof process.getuid === 'function' ? () => process.getuid() : null);
  const say = log || (() => {});
  const SAVED = () => dataPath('pointer-hider.json');
  const isLinux = () => PLATFORM === 'linux';

  // the hiders that are running now: [{ pid, name, argv }]. Matched on the whole command line: Linux cuts a process name at 15 letters ("unclutter-xfixe"), so an exact name never matches.
  function running() {
    if (!isLinux()) return Promise.resolve([]);
    return new Promise((resolve) => {
      execFile('pgrep', ['-a', '-f', '^(/[^ ]*/)?unclutter(-xfixes)?( |$)'], { timeout: 4000 }, (err, out) => {
        if (err || !out) return resolve([]);
        resolve(String(out).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const m = /^(\d+)\s+(.*)$/.exec(l);
          if (!m) return null;
          const argv = m[2].split(/\s+/).filter(Boolean), name = path.basename(argv[0] || '');
          return HIDERS.includes(name) ? { pid: Number(m[1]), name, argv } : null;
        }).filter(Boolean));
      });
    });
  }

  // the command that starts a hider, as the desktop's autostart has it
  function fromAutostart() {
    const home = (os && os.homedir && os.homedir()) || '';
    const files = [path.join(home, '.config', 'labwc', 'autostart'), path.join(home, '.config', 'lxsession', 'LXDE-pi', 'autostart'), '/etc/xdg/lxsession/LXDE-pi/autostart'];
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
      for (const raw of text.split('\n')) {
        const line = raw.trim().replace(/^@/, '').replace(/\s*&\s*$/, '').trim();
        if (!line || line.startsWith('#')) continue;
        const argv = line.split(/\s+/);
        const bin = path.basename(argv[0]);
        if (HIDERS.includes(bin)) return argv;
      }
    }
    return null;
  }
  function saved() {
    try { const j = JSON.parse(fs.readFileSync(SAVED(), 'utf8')); return Array.isArray(j.argv) && j.argv.length && HIDERS.includes(path.basename(j.argv[0])) ? j.argv : null; } catch (e) { return null; }
  }
  function remember(argv) { try { fs.writeFileSync(SAVED(), JSON.stringify({ argv })); } catch (e) { /* the autostart file is the fallback */ } }

  // show the pointer: stop every hider, remembering how the first one was started
  async function show() {
    const list = await running();
    if (!list.length) return { changed: 0, hiders: 0 };
    // Some desktops run two (the system's own and the installer's): remember the installer's, the one the autostart file names, so switching off puts back what the installer set up
    const auto = fromAutostart(), same = (h) => auto && path.basename(auto[0]) === h.name && auto.slice(1).join(' ') === h.argv.slice(1).join(' ');
    remember((list.find(same) || list[0]).argv);
    let stopped = 0;
    for (const h of list) { try { KILL(h.pid, 'SIGTERM'); stopped++; } catch (e) { say('[pointer] could not stop ' + h.name + ' ' + h.pid + ': ' + e.message); } }
    say('[pointer] showing the mouse pointer: stopped ' + stopped + ' hider(s)');
    return { changed: stopped, hiders: list.length };
  }
  // Start it in a unit of its own (systemd-run --user): the server runs as a service that stops everything it started whenever it restarts (every update), which would
  // take the hider with it. Not available (no user session manager, another system): the caller starts it directly instead.
  function startUnit(argv, display) {
    return new Promise((resolve) => {
      const uid = GETUID ? GETUID() : null;
      if (uid === null || !isLinux()) return resolve(false);
      const bin = path.isAbsolute(argv[0]) ? argv[0] : ['/usr/bin', '/usr/local/bin'].map((d) => d + '/' + argv[0]).find((f) => fs.existsSync && fs.existsSync(f)) || argv[0];
      const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: (os && os.homedir && os.homedir()) || '', XDG_RUNTIME_DIR: '/run/user/' + uid };
      execFile('systemd-run', ['--user', '--quiet', '--collect', '--setenv=DISPLAY=' + display, '--', bin, ...argv.slice(1)], { env, timeout: 8000 }, (err) => resolve(!err));
    });
  }
  // hide the pointer again: start the hider that was stopped (or the one the autostart file names)
  async function hide() {
    if ((await running()).length) return { changed: 0, hiders: 1 };
    const argv = saved() || fromAutostart();
    if (!argv) return { changed: 0, hiders: 0, missing: true };
    const display = process.env.DISPLAY || ':0';
    if (await startUnit(argv, display)) { say('[pointer] hiding the mouse pointer: started ' + argv.join(' ') + ' (in its own unit)'); afterHiderStart(); return { changed: 1, hiders: 1 }; }
    try {
      const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', env: { ...process.env, DISPLAY: display } });
      child.on('error', (e) => say('[pointer] could not start the hider: ' + e.message));
      child.unref();
      say('[pointer] hiding the mouse pointer: started ' + argv.join(' '));
      afterHiderStart();
      return { changed: 1, hiders: 1 };
    } catch (e) { say('[pointer] could not start the hider: ' + e.message); return { changed: 0, hiders: 0, error: e.message }; }
  }
  // Two things ask for the pointer: the device setting (Settings, or the hot key) and a Whiteboard widget set to show it that is on this screen now (the page says so, see below).
  let boardWant = false;
  const wanted = () => String(getSetting('show_cursor') || '') === '1' || boardWant;
  const apply = () => (wanted() ? show() : hide());
  // after the setting is saved: switching on stops the hider; switching off starts it (only if it is not running)
  function onSaved() { return apply().catch((e) => { say('[pointer] ' + e.message); }); }
  // a hider that has just been started: give it a moment to be up, then bump the pointer so the arrow that is showing goes at once
  function afterHiderStart() { const t = setTimeout(() => { bump().catch(() => {}); }, 1500); if (t && t.unref) t.unref(); }
  // The hider must be running whenever the pointer is not wanted. It stops while a Whiteboard wants the pointer, and nothing else ever put it back after a reload, a restart of the
  // server or the hider simply having stopped, which left the arrow on the screen for good. So it is checked at start and every minute: with the pointer not wanted, and a hider command
  // known (saved when it was stopped, or in the desktop's autostart), a missing hider is started again. Nothing is done where there is none to start.
  async function keepHiderRunning() {
    if (!isLinux() || wanted()) return;
    if ((await running()).length) return;
    if (!(saved() || fromAutostart())) return;
    say('[pointer] the pointer hider was not running although the pointer is not wanted: starting it');
    await hide();
  }
  // at boot the desktop starts its hider after the server, so look again a few times while the setting is on
  function startup() {
    if (!isLinux()) return;
    const t = setTimeout(() => { keepHiderRunning().catch(() => {}); }, 25 * 1000); if (t && t.unref) t.unref();
    const iv = setInterval(() => { keepHiderRunning().catch(() => {}); }, 60 * 1000); if (iv && iv.unref) iv.unref();
    if (!wanted()) return;
    for (const s of [15, 45, 120]) setTimeout(() => { if (wanted()) show().catch(() => {}); }, s * 1000).unref();
  }

  // Only the screen on this machine may use the two routes below (the same trust as the painted signal: loopback, no proxy headers).
  const isLocal = (req) => {
    const a = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/i, '');
    const proxied = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'true-client-ip'].some((h) => req.headers && req.headers[h] !== undefined);
    return (a === '::1' || /^127[.]/.test(a)) && !proxied;
  };
  // the page tells the server whether a Whiteboard set to show the pointer is on screen: the Pi's own pointer hider steps aside while it is
  app.post('/api/pointer/board', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only the screen on this device can do this.' });
    const want = !!(req.body && req.body.show === true);
    if (want !== boardWant) { boardWant = want; await onSaved(); }
    res.json({ ok: true, show: wanted() });
  });
  // the hot key on the display (Ctrl+Shift+M): the device setting flips, live, with no restart
  app.post('/api/pointer/toggle', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only the screen on this device can do this.' });
    const cur = String(getSetting('show_cursor') || '0');
    const now = cur === '1' ? '0' : cur === 'board' ? '1' : 'board';                       // hidden -> only over whiteboards -> everywhere -> hidden
    setSetting('show_cursor', now);
    broadcastUpdate('settings');
    await onSaved();
    res.json({ ok: true, show_cursor: now });
  });

  // A bump: when the page reloads or the layout switches, the browser puts its own arrow back and does not apply the page's "no pointer" until it sees the mouse MOVE (and a pointer
  // hider only starts counting after a move too), so the arrow stays until someone touches the mouse. Moving the pointer a few pixels and back fixes both (the kiosk launcher does
  // the same once at start). Not while the pointer is wanted (a screen set to show it, or a Whiteboard that asks for it), because that pointer must not be moved; at most once every
  // 4 seconds. Needs xdotool (the installer adds it); without it nothing happens.
  let lastBump = 0;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function bump() {
    if (!isLinux()) return { bumped: false, why: 'not linux' };
    const now = Date.now();
    if (now - lastBump < 4000) return { bumped: false, why: 'recently' };
    if (wanted()) return { bumped: false, why: 'pointer wanted' };
    lastBump = now;
    const homeDir = (os && os.homedir && os.homedir()) || '';
    const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: homeDir, DISPLAY: process.env.DISPLAY || ':0', XAUTHORITY: path.join(homeDir, '.Xauthority') };
    const move = (dx) => new Promise((resolve) => { execFile('xdotool', ['mousemove_relative', '--', String(dx), '0'], { env, timeout: 3000 }, (err) => resolve(!err)); });
    const first = await move(6);
    if (first) { await pause(250); await move(-6); }
    return { bumped: first, why: first ? '' : 'xdotool did not run' };
  }
  app.post('/api/pointer/bump', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only the screen on this device can do this.' });
    res.json(await bump());
  });

  // what Settings says under the switch
  async function status() {
    const list = await running();
    const mode = String(getSetting('show_cursor') || '0');
    return { show: wanted(), mode: mode === '1' || mode === 'board' ? mode : '0', board: boardWant, linux: isLinux(), hider: list.length ? list[0].name : '', canHide: !!(saved() || fromAutostart()) };
  }
  // set the device setting ('0' hidden, 'board' only over whiteboards, '1' everywhere) from the host's Devices tab: saved, announced to the screen, and the Pi's hider follows
  async function setMode(v) {
    if (!['0', 'board', '1'].includes(String(v))) return { status: 400, error: 'That is not a choice.' };
    setSetting('show_cursor', String(v));
    broadcastUpdate('settings');
    await onSaved();
    return { status: 200, ok: true, mode: String(v) };
  }
  app.get('/api/pointer', async (req, res) => { res.json(await status()); });
  return { show, hide, apply, onSaved, startup, running, fromAutostart, status, setMode, bump };
};
