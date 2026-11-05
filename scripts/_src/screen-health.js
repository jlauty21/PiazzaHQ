'use strict';
// "Screen health" (Devices tab): is each screen OK, without SSH. This device builds a small summary of itself (version, uptime, how long ago its display last
// drew a frame, whether it is on Wi-Fi or a cable and the Wi-Fi signal, and what the Wi-Fi watchdog repaired in the last 7 days). A mirror sends that summary to
// its host with its normal 30-second check-in (see registerWithHost in server.js); the host keeps the last one per screen and GET /api/screen-health puts
// them all together with a status for each:
//   good      running normally
//   repaired  fixed itself (Wi-Fi) in the last 7 days
//   stuck     reporting in, but its display has not drawn a frame for over 5 minutes
//   off       not reporting (switched off, off at night, or out of reach): grey, never an alarm, since many screens are off on purpose
// The page text is built by the control app from these facts, so it can be translated. "Reload display" reloads a screen's display page (safe), on this device
// or relayed to a mirror's own server. Covered by test/unit/screen-health.test.js and test/api/screen-health.test.js.
module.exports = function registerScreenHealth({ app, fs, os, path, db, DEVICE_ID, APP_VERSION, DEPLOYMENT, SCREEN_ONLINE_MS, PORT, isSlave, displayPainted, sendScreenCommand, fetchWithTimeout, getSetting, clock, platform }) {
  const PLATFORM = platform || process.platform;
  const now = () => (clock ? clock() : Date.now());
  const STUCK_AFTER_S = 5 * 60;
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const FORGET_AFTER_MS = 14 * 24 * 3600 * 1000;    // a screen not heard from for two weeks is an old record, not a screen to worry about: left out of the card
  const stateDir = () => path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'piazzahq');

  // The Wi-Fi watchdog's own log (src/wifi-watchdog.js), one line per event: "2026-10-27 04:47:28 UTC Wi-Fi was down 120s; it is back after: turned Wi-Fi off and on".
  function readRepairs(at) {
    let text = '';
    try { text = fs.readFileSync(path.join(stateDir(), 'wifi-watchdog.log'), 'utf8'); } catch { return { count7: 0, items: [] }; }
    const items = [];
    for (const line of text.split('\n').slice(-400)) {
      const m = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC Wi-Fi was down (\d+)s; it is back after: (.+)$/.exec(line.trim());
      if (!m) continue;
      const when = Date.parse(m[1].replace(' ', 'T') + 'Z');
      if (!when || at - when > WEEK_MS || when > at + 3600 * 1000) continue;
      const how = /off and on/.test(m[3]) ? 'radio' : /services/.test(m[3]) ? 'services' : /driver/.test(m[3]) ? 'driver' : 'other';
      items.push({ at: when, down_s: Number(m[2]), how });
    }
    items.sort((a, b) => b.at - a.at);
    return { count7: items.length, items: items.slice(0, 5) };
  }

  // Cable or Wi-Fi, and the Wi-Fi signal in dBm; read from /sys and /proc, nothing is run. Anything unclear is "unknown".
  function netInfo() {
    const out = { kind: 'unknown', signal_dbm: null };
    if (PLATFORM !== 'linux') return out;
    let wired = false, wifi = '', any = false;
    try {
      for (const n of fs.readdirSync('/sys/class/net')) {
        if (n === 'lo' || /^(docker|veth|br-|tailscale|tun|virbr|p2p|wg)/.test(n)) continue;
        let st = '';
        try { st = fs.readFileSync('/sys/class/net/' + n + '/operstate', 'utf8').trim(); } catch { continue; }
        any = true;
        if (st !== 'up') continue;
        if (/^wl/.test(n)) wifi = n; else if (/^(eth|en)/.test(n)) wired = true;
      }
    } catch { return out; }
    if (!any) return out;
    out.kind = wired ? 'wired' : wifi ? 'wifi' : 'none';
    if (out.kind === 'wifi') {
      try {
        const w = fs.readFileSync('/proc/net/wireless', 'utf8');
        const m = new RegExp('^\\s*' + wifi.replace(/[^a-z0-9]/gi, '') + ':\\s+\\S+\\s+\\S+\\s+(-?\\d+)\\.?', 'm').exec(w);
        if (m) { const v = Number(m[1]); if (v < 0 && v > -120) out.signal_dbm = v; }
      } catch { /* no wireless statistics */ }
    }
    return out;
  }
  function modelName() {
    try { return fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').replace(/\s+Rev\s+.*$/i, '').trim().slice(0, 40); } catch { return ''; }
  }

  // This device's own summary.
  function snapshot() {
    const at = now();
    const sp = displayPainted && displayPainted.sincePaintedMs ? displayPainted.sincePaintedMs() : null;
    return { v: 1, version: APP_VERSION, deployment: DEPLOYMENT, model: modelName(), uptime_s: Math.round(os.uptime()), painted_s: sp === null || sp === undefined ? null : Math.round(sp / 1000), net: netInfo(), repairs: readRepairs(at) };
  }

  // What a mirror sent: only known fields, only sensible numbers, short strings. Returns null when it is not a summary at all.
  function sanitize(raw) {
    let o = raw;
    if (typeof raw === 'string') { if (raw.length > 3000) return null; try { o = JSON.parse(raw); } catch { return null; } }
    if (!o || typeof o !== 'object') return null;
    const int = (v, lo, hi) => { const n = Math.round(Number(v)); return v !== null && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
    const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, n) : '');
    const net = o.net && typeof o.net === 'object' ? o.net : {};
    const rep = o.repairs && typeof o.repairs === 'object' ? o.repairs : {};
    const items = (Array.isArray(rep.items) ? rep.items : []).slice(0, 5)
      .map((i) => ({ at: int(i && i.at, 1e12, 4e12), down_s: int(i && i.down_s, 0, 7 * 86400) || 0, how: ['radio', 'services', 'driver', 'other'].includes(i && i.how) ? i.how : 'other' }))
      .filter((i) => i.at !== null);
    return {
      v: 1, version: str(o.version, 24), deployment: str(o.deployment, 12), model: str(o.model, 40),
      uptime_s: int(o.uptime_s, 0, 1e9), painted_s: int(o.painted_s, 0, 1e9),
      net: { kind: ['wifi', 'wired', 'none', 'unknown'].includes(net.kind) ? net.kind : 'unknown', signal_dbm: int(net.signal_dbm, -120, -1) },
      repairs: { count7: Math.max(items.length, int(rep.count7, 0, 1000) || 0), items },
    };
  }

  function classify(online, health) {
    if (!online) return { status: 'off' };
    if (health && health.painted_s !== null && health.painted_s !== undefined && health.painted_s > STUCK_AFTER_S) return { status: 'stuck', stuck_minutes: Math.max(5, Math.round(health.painted_s / 60)) };
    if (health && health.repairs && health.repairs.count7 > 0) return { status: 'repaired' };
    return { status: 'good' };
  }

  // Every screen this device knows (the host knows all of its mirrors; a mirror only itself).
  function list() {
    const at = now();
    const rows = db.prepare(`SELECT device_id, name, last_seen, is_remote, screen_version, health_json FROM screens ORDER BY created_at ASC`).all().filter((s) => !String(s.device_id).startsWith('preview_'))
      .filter((s) => s.device_id === DEVICE_ID || at - (s.last_seen || 0) < FORGET_AFTER_MS);
    const screens = rows.map((s) => {
      const own = s.device_id === DEVICE_ID;
      const online = own ? true : (at - (s.last_seen || 0)) < SCREEN_ONLINE_MS;
      let health = null;
      if (own) health = snapshot();
      else if (s.health_json) { try { health = sanitize(s.health_json); } catch { health = null; } }
      const c = classify(online, health);
      return {
        device_id: s.device_id, name: s.name || (own ? getSetting('display_name') : '') || '',
        role: own ? (isSlave() ? 'mirror' : 'host') : (s.is_remote ? 'mirror' : 'display'),
        online, last_seen: own ? at : (s.last_seen || 0),
        version: (health && health.version) || s.screen_version || '', health, ...c,
      };
    });
    const rank = { stuck: 0, repaired: 1, good: 2, off: 3 };
    screens.sort((a, b) => rank[a.status] - rank[b.status]);
    const summary = { total: screens.length, good: 0, repaired: 0, stuck: 0, off: 0 };
    for (const s of screens) summary[s.status]++;
    return { generated_at: at, summary, screens };
  }
  app.get('/api/screen-health', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(list()); });

  // Reload a display page: this device's own, or relayed to a mirror's server (the host cannot reach a mirror's display directly; it is connected to the mirror).
  let lastReload = 0;
  app.post('/api/display/reload', (req, res) => {
    const t = now();
    if (t - lastReload < 5000) return res.status(429).json({ error: 'Just reloaded; give it a few seconds.' });
    lastReload = t;
    res.json({ ok: true, delivered: !!sendScreenCommand(DEVICE_ID, 'reload') });
  });
  app.post('/api/screens/:deviceId/reload-display', async (req, res) => {
    const screen = db.prepare(`SELECT * FROM screens WHERE device_id = ?`).get(req.params.deviceId);
    if (!screen) return res.status(404).json({ error: 'Screen not found.' });
    if (!screen.is_remote) return res.json({ ok: true, delivered: !!sendScreenCommand(screen.device_id, 'reload') });
    if (!screen.remote_addr) return res.status(409).json({ error: 'This screen is offline or unreachable.' });
    const addr = screen.remote_addr.includes(':') ? screen.remote_addr : `${screen.remote_addr}:${PORT}`;
    try {
      const r = await fetchWithTimeout(`http://${addr}/api/display/reload`, { method: 'POST', timeoutMs: 8000, headers: { 'Content-Type': 'application/json', 'x-host-pin': getSetting('app_pin') || '' }, body: '{}' });
      let json = {}; try { json = await r.json(); } catch { json = {}; }
      res.status(r.status).json(json);
    } catch (e) { res.status(502).json({ error: 'Could not reach that screen: ' + String(e.message || e).slice(0, 100) }); }
  });

  return { snapshot, sanitize, classify, list, readRepairs, netInfo };
};
