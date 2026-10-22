'use strict';
// Version status for the Version widget (GET /api/version-status, public like the rest of what the wall display reads): which version this device runs, which one is the newest for it,
// whether an update is waiting, and (on a host) what version each screen last reported. A mirror screen also asks its host the same question, so a screen on the wall can say
// "the Docker host is behind". The newest-version answer comes from the central server through the same check the app already makes every 6 hours (fetchUpdateInfo); this
// module keeps the last answer and refreshes it at most every 3 hours (10 minutes after a failed try), so a display polling it never turns into extra check-ins.
// Nothing secret leaves: version numbers, screen names and whether they are online.
// Covered by test/unit/version-status.test.js and test/api/version-status.test.js.
module.exports = function registerVersionStatus({ app, db, http, https, URL, APP_VERSION, DEPLOYMENT, IS_CONTAINER, isBetaVersion, isSlave, hostBaseURL, hostHeaders, fetchUpdateInfo, SCREEN_ONLINE_MS, log }) {
  const say = log || (() => {});
  const FRESH_MS = 3 * 3600 * 1000, RETRY_MS = 10 * 60 * 1000, HOST_FRESH_MS = 5 * 60 * 1000, HOST_RETRY_MS = 30 * 1000, SCREEN_SEEN_MS = 3 * 24 * 3600 * 1000;
  let latest = { version: '', available: false, checkedAt: 0, error: '', triedAt: 0 };
  let inflight = null;
  let hostCache = { at: 0, data: null };

  // -1 / 0 / 1 for x.y.z and x.y.z-beta.N (a beta of x.y.z comes before x.y.z); anything else compares as equal
  function parse(v) { const m = /^(\d+)[.](\d+)[.](\d+)(?:-beta[.](\d+))?$/.exec(String(v || '')); return m ? { n: [+m[1], +m[2], +m[3]], beta: m[4] === undefined ? null : +m[4] } : null; }
  function compare(a, b) {
    const A = parse(a), B = parse(b);
    if (!A || !B) return 0;
    for (let i = 0; i < 3; i++) if (A.n[i] !== B.n[i]) return A.n[i] < B.n[i] ? -1 : 1;
    if (A.beta === B.beta) return 0;
    if (A.beta === null) return 1;
    if (B.beta === null) return -1;
    return A.beta < B.beta ? -1 : 1;
  }

  // the check the app already runs every 6 hours hands its answer in here
  function noteUpdateInfo(info) {
    if (!info || typeof info !== 'object') return;
    latest = { version: String(info.latestVersion || ''), available: !!info.updateAvailable, checkedAt: Date.now(), error: '', triedAt: Date.now() };
  }
  function ensureLatest() {
    const now = Date.now();
    if (latest.checkedAt && now - latest.checkedAt < FRESH_MS) return Promise.resolve();
    if (latest.triedAt && now - latest.triedAt < RETRY_MS) return Promise.resolve();
    if (inflight) return inflight;
    latest.triedAt = now;
    inflight = Promise.resolve().then(() => fetchUpdateInfo()).then(noteUpdateInfo).catch((e) => { latest.error = String((e && e.message) || e).slice(0, 120); say('[version-status] check failed: ' + latest.error); }).then(() => { inflight = null; });
    return inflight;
  }

  function own() {
    const updateAvailable = !!latest.version && latest.version !== APP_VERSION && (latest.available || compare(latest.version, APP_VERSION) > 0);
    return {
      version: APP_VERSION, beta: !!isBetaVersion(), deployment: DEPLOYMENT, container: !!IS_CONTAINER,
      latest: latest.version, updateAvailable, checked: !!latest.checkedAt, checkedAt: latest.checkedAt,
    };
  }
  function screens() {
    let rows = [];
    try { rows = db.prepare(`SELECT name, screen_version, last_seen FROM screens ORDER BY name COLLATE NOCASE`).all(); } catch (e) { return []; }
    const now = Date.now();
    // only screens that are in use: seen in the last three days, and not the "(Live Edit)" stand-ins
    rows = rows.filter((s) => now - (s.last_seen || 0) < SCREEN_SEEN_MS && !/\(Live Edit\)\s*$/i.test(String(s.name || '')));
    return rows.map((s) => ({
      name: String(s.name || '').slice(0, 60) || 'Screen', version: String(s.screen_version || '').slice(0, 40),
      online: (now - (s.last_seen || 0)) < SCREEN_ONLINE_MS,
      outdated: !!(latest.version && s.screen_version && compare(latest.version, s.screen_version) > 0),
    }));
  }

  // a mirror asks its host (4 seconds at most; the answer is kept for 5 minutes, and an unreachable host is remembered for that long too)
  function askHost() {
    return new Promise((resolve) => {
      const base = typeof hostBaseURL === 'function' ? hostBaseURL() : '';
      if (!base) return resolve(null);
      let u; try { u = new URL(base + '/api/version-status'); } catch (e) { return resolve(null); }
      const lib = u.protocol === 'https:' ? https : http;
      // a mirror is known to its host by the household PIN and its own key, sent the same way every other mirror-to-host request sends them (the host refuses anyone else, even for a page the wall reads)
      const headers = typeof hostHeaders === 'function' ? hostHeaders() : {};
      const req = lib.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers, timeout: 4000 }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (r.statusCode !== 200 || !j || typeof j.version !== 'string') return resolve(null);
            resolve({ version: j.version, beta: !!j.beta, deployment: String(j.deployment || ''), container: !!j.container, latest: String(j.latest || ''), updateAvailable: !!j.updateAvailable, checked: !!j.checked });
          } catch (e) { resolve(null); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => resolve(null));
    });
  }
  async function host() {
    const now = Date.now();
    if (hostCache.at && now - hostCache.at < (hostCache.data ? HOST_FRESH_MS : HOST_RETRY_MS)) return hostCache.data;      // an answer is kept 5 minutes, a miss 30 seconds
    const data = await askHost();
    hostCache = { at: now, data };
    return data;
  }

  app.get('/api/version-status', async (req, res) => {
    try {
      await ensureLatest();
      const out = { ...own(), screens: screens() };
      if (isSlave()) out.host = await host();                // null = the host could not be reached
      res.set('Cache-Control', 'no-store');
      res.json(out);
    } catch (e) { res.status(500).json({ error: 'Could not work out the version status.' }); }
  });
  return { noteUpdateInfo, compare };
};
