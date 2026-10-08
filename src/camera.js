'use strict';
// Camera streaming: the managed go2rtc helper (download, start / stop / reload, config), the camera list routes, live frames and the browser WebSocket proxy.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/cameras.test.js and test/unit/camera-pure.test.js.
module.exports = function registerCamera({ path, http, fs, crypto, IS_WIN, WebSocketClient, app, demoCleanText, dataPath, db, extractZip, requestIsRemote, remoteGateEnabled, findRemoteSession, broadcastUpdate, downloadFile, getSetting, haWsRequest, URL, spawn }) {
  // The "camera" layout widget shows a live RTSP / ONVIF / Home Assistant camera
  // on the wall. Browsers can't play RTSP, so a local go2rtc process ingests each
  // camera once and repackages it (WebRTC / MSE / MJPEG) for the browser. go2rtc's
  // own HTTP API binds to 127.0.0.1 and is NEVER exposed: the browser reaches
  // exactly one thing — the WebSocket at /api/camera/:id/ws, reverse-proxied to
  // go2rtc's /api/ws?src=cam_<id> (that single socket carries WebRTC signalling,
  // MSE and MJPEG) — plus /api/camera/:id/frame.jpeg for a poster still. Stream
  // URLs (which routinely embed rtsp://user:pass@host) live only in the cameras
  // table and go2rtc.yaml on disk, never in an API response.

  // The binary is bundled by install.sh (Pi), the Docker image, and the Windows
  // installer. When an install updates code-only through the in-app updater the
  // binary won't be there — ensureGo2rtcBinary() below downloads the pinned build
  // on first camera use so it self-heals on every platform. Keep this version +
  // the sha256 map in step with scripts/go2rtc-version.sh on a bump.
  const GO2RTC_VERSION = 'v1.9.14';
  const GO2RTC_SHA256 = {
    go2rtc_linux_amd64: '32d616af226bd731678ffde328b94cfb94e30339bfefc469cfb76323144615a6',
    go2rtc_linux_arm64: '359fabade8a7a51e81a55fe6df6b0ef81764a5e1d63179577534eaaa71904b50',
    go2rtc_linux_arm:   '4d7e1639af5a2722a28e864468fd8099b3c1682565446c798bf9e3b38fde12e4',
    go2rtc_linux_armv6: '4dc20370556b29f3a90f4c7a09dcd95472c8f74cca56d4d1fb91f32bdd15174c',
    go2rtc_linux_i386:  '12a114d19fc9fba1b3541cf7c6bb9b01896a6845f31285ec77269e2e7c613885',
    'go2rtc_win64.zip':     'dd4167d75cb04abe618855b7c71f8658bd009f60c1a71835d134d2c11c939907',
    'go2rtc_win_arm64.zip': '814be0f6d8669025c7bccdd1f026ffaf613abae5352239f4ec84de543b94594a',
    'go2rtc_win32.zip':     '6fafb817477f4d34e5edfd8bb3c547151dfc5c404bde41e274db146b17ed5c03',
    'go2rtc_mac_amd64.zip': '9b0b9a27a4dc3a5b8b93376e7e8fc2787c6af624a512842622be84aec0171c7a',
    'go2rtc_mac_arm64.zip': '919b78adc759d6b3883d1e1b2ac915ac0985bb903ff1897b4d228527bd64690c',
  };
  // process.arch/platform -> release asset name (or null for an arch with no build).
  function go2rtcAssetName() {
    const a = process.arch, p = process.platform;
    if (p === 'linux') {
      if (a === 'x64') return 'go2rtc_linux_amd64';
      if (a === 'arm64') return 'go2rtc_linux_arm64';
      if (a === 'arm') return 'go2rtc_linux_arm';   // Node reports 'arm' for v6 and v7; the v7 build covers Pi 2+
      if (a === 'ia32') return 'go2rtc_linux_i386';
      return null;
    }
    if (p === 'win32') {
      if (a === 'x64') return 'go2rtc_win64.zip';
      if (a === 'arm64') return 'go2rtc_win_arm64.zip';
      if (a === 'ia32') return 'go2rtc_win32.zip';
      return null;
    }
    if (p === 'darwin') return a === 'arm64' ? 'go2rtc_mac_arm64.zip' : 'go2rtc_mac_amd64.zip';
    return null;
  }

  const GO2RTC_BIN_NAME = IS_WIN ? 'go2rtc.exe' : 'go2rtc';
  const GO2RTC_BIN_PATH = path.join(__dirname, 'bin', GO2RTC_BIN_NAME);
  function go2rtcBinReady() { try { return fs.existsSync(GO2RTC_BIN_PATH); } catch { return false; } }
  const GO2RTC_CONFIG_PATH = dataPath('go2rtc.yaml');
  const GO2RTC_WEBRTC_PORT = 8555; // fixed local UDP port for WebRTC media (single-box case)
  function go2rtcPort() {
    const p = parseInt(getSetting('go2rtc_port'), 10);
    return Number.isFinite(p) && p > 0 && p < 65536 ? p : 1984;
  }

  const CAMERA_URL_SCHEMES = new Set(['rtsp', 'rtsps', 'rtmp', 'rtmps', 'http', 'https', 'onvif', 'hls']);
  // Validate + normalise a camera source. Returns { ok, value } | { ok:false, error }.
  // This is the whole SSRF story on the input side: the browser never causes a
  // server-side fetch (it only talks to /api/camera/*), and the only URL the
  // server hands onward is this one, to the local go2rtc — same trust class as
  // ha_base_url / the SMTP host / an iCal feed URL. We don't allowlist hosts (it
  // breaks legitimate NVRs on odd subnets), but we do bound the scheme and block
  // the cloud metadata address, the one target that turns "fetch a URL" into a
  // credential-theft primitive on a hosted box.
  function validateCameraUrl(kind, raw) {
    const s = (raw || '').toString().trim();
    if (kind === 'ha') {
      return /^ha:camera\.[a-z0-9_]+$/.test(s)
        ? { ok: true, value: s }
        : { ok: false, error: 'Home Assistant cameras must be ha:camera.<entity_id>' };
    }
    let u;
    try { u = new URL(s); } catch { return { ok: false, error: 'That is not a valid URL' }; }
    const scheme = u.protocol.replace(/:$/, '').toLowerCase();
    if (!CAMERA_URL_SCHEMES.has(scheme)) {
      return { ok: false, error: `Unsupported "${scheme}:" — use rtsp / rtsps / http / https / onvif / rtmp` };
    }
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === '169.254.169.254' || host === 'metadata.google.internal' || host === 'metadata') {
      return { ok: false, error: 'That address is not allowed' };
    }
    return { ok: true, value: s };
  }

  // ── go2rtc process management ──
  let _go2rtc = null;              // the child process, or null
  let _go2rtcRestartTID = null;
  let _go2rtcBackoff = 1000;
  let _go2rtcStarting = false;
  let _go2rtcUnavailable = false;    // spawn failed for a non-arch reason
  let _go2rtcUnsupportedArch = false; // no go2rtc build for this platform/arch — permanent
  let _go2rtcDownloading = false;    // fetching the binary right now
  let _go2rtcDownloadPromise = null; // in-flight download, so concurrent callers share it
  let _go2rtcStopRequested = false;
  let _go2rtcWantImmediateRespawn = false;
  const _haStreamCache = new Map(); // entity_id -> { url, at }

  // Make sure bin/go2rtc exists — download + sha256-verify the pinned build for
  // this platform if it doesn't. Self-swallowing; sets _go2rtcUnsupportedArch /
  // _go2rtcUnavailable on a permanent / transient failure. Returns true once the
  // binary is present and ready.
  async function ensureGo2rtcBinary() {
    if (go2rtcBinReady()) return true;
    if (_go2rtcUnsupportedArch) return false;
    if (_go2rtcDownloadPromise) return _go2rtcDownloadPromise;
    const asset = go2rtcAssetName();
    const sha = asset && GO2RTC_SHA256[asset];
    if (!asset || !sha) {
      _go2rtcUnsupportedArch = true;
      console.error(`[go2rtc] no build for ${process.platform}/${process.arch} — the Camera widget is unavailable on this device`);
      return false;
    }
    _go2rtcDownloadPromise = (async () => {
      _go2rtcDownloading = true;
      const url = `https://github.com/AlexxIT/go2rtc/releases/download/${GO2RTC_VERSION}/${asset}`;
      const binDir = path.join(__dirname, 'bin');
      const tmp = path.join(binDir, `.go2rtc.download.${process.pid}`);
      try {
        fs.mkdirSync(binDir, { recursive: true });
        console.log(`[go2rtc] downloading ${GO2RTC_VERSION} (${asset})…`);
        await downloadFile(url, tmp, 120000);
        const got = crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex');
        if (got !== sha) throw new Error(`sha256 mismatch (expected ${sha}, got ${got})`);
        if (asset.endsWith('.zip')) {
          const exDir = path.join(binDir, '.go2rtc.extract');
          fs.rmSync(exDir, { recursive: true, force: true });
          extractZip(tmp, exDir);
          // the zip holds a single go2rtc / go2rtc.exe
          const found = fs.readdirSync(exDir).find((f) => f === GO2RTC_BIN_NAME) || fs.readdirSync(exDir)[0];
          fs.renameSync(path.join(exDir, found), GO2RTC_BIN_PATH);
          fs.rmSync(exDir, { recursive: true, force: true });
          fs.rmSync(tmp, { force: true });
        } else {
          fs.renameSync(tmp, GO2RTC_BIN_PATH);
        }
        if (!IS_WIN) { try { fs.chmodSync(GO2RTC_BIN_PATH, 0o755); } catch {} }
        _go2rtcUnavailable = false;
        console.log('[go2rtc] binary ready');
        return true;
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        _go2rtcUnavailable = true; // transient — a later reload retries
        console.error('[go2rtc] binary download failed (Camera widget unavailable for now): ' + e.message);
        return false;
      } finally {
        _go2rtcDownloading = false;
        _go2rtcDownloadPromise = null;
      }
    })();
    return _go2rtcDownloadPromise;
  }

  function anyLayoutHasCamera() {
    try {
      for (const r of db.prepare(`SELECT widgets FROM layouts`).all()) {
        const arr = JSON.parse(r.widgets || '[]');
        if (Array.isArray(arr) && arr.some(w => w && w.type === 'camera' && w.camId)) return true;
      }
    } catch {}
    return false;
  }

  function cameraServiceState() {
    if (getSetting('camera_service_autostart') === '0') return 'disabled';
    if (_go2rtcDownloading) return 'downloading';
    if (_go2rtcUnsupportedArch || _go2rtcUnavailable) return 'unavailable';
    if (_go2rtc) return 'running';
    if (anyLayoutHasCamera()) return 'starting';
    return 'stopped';
  }

  // Ask Home Assistant for a playable stream source for a camera entity. Prefers
  // the WebSocket `camera/stream` command (yields an HA-proxied HLS URL whose
  // token is in the path — no LLAT exposure). Cached ~5 min. null = unresolvable
  // (the widget then shows "offline"; the user can add it as a direct RTSP URL).
  async function resolveHaCameraSource(entityId) {
    const cached = _haStreamCache.get(entityId);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.url;
    const base = getSetting('ha_base_url'), token = getSetting('ha_token');
    if (!base || !token || !WebSocketClient) return null;
    let url = null;
    try {
      const r = await haWsRequest(base, token, [{ type: 'camera/stream', entity_id: entityId }]);
      const result = r && r['camera/stream'];
      if (result && result.url) {
        url = /^(https?|rtsps?):/.test(result.url)
          ? result.url
          : base.replace(/\/+$/, '') + result.url; // HA returns a relative /api/hls/... path
      }
    } catch {}
    _haStreamCache.set(entityId, { url, at: Date.now() });
    return url;
  }

  async function buildGo2rtcConfig() {
    const streams = {};
    for (const c of db.prepare(`SELECT * FROM cameras`).all()) {
      let src = c.url;
      if (c.kind === 'ha') {
        src = await resolveHaCameraSource(c.url.slice(3));
        if (!src) continue; // unresolvable — skip; widget shows offline
      }
      streams[`cam_${c.id}`] = src;
    }
    return streams;
  }
  function toGo2rtcYaml(streams) {
    const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const lines = [
      'api:', `  listen: ${q('127.0.0.1:' + go2rtcPort())}`,
      'rtsp:', '  listen: ""',
      'webrtc:', `  listen: ":${GO2RTC_WEBRTC_PORT}"`, '  candidates:', `    - ${q('127.0.0.1:' + GO2RTC_WEBRTC_PORT)}`,
      'log:', '  level: "warn"',
      'streams:',
    ];
    for (const [k, v] of Object.entries(streams)) lines.push(`  ${k}: ${q(v)}`);
    return lines.join('\n') + '\n';
  }

  function _go2rtcLog(buf) {
    String(buf).split(/\r?\n/).filter(Boolean).forEach((l) => console.log('[go2rtc] ' + l));
  }
  function startCameraService() {
    if (_go2rtc || _go2rtcStarting) return;
    // Prefer the bundled/downloaded binary; fall back to a bare command in case
    // go2rtc is on PATH (a hand-rolled install).
    const bin = go2rtcBinReady() ? GO2RTC_BIN_PATH : GO2RTC_BIN_NAME;
    _go2rtcStarting = true;
    _go2rtcStopRequested = false;
    let child;
    try {
      child = spawn(bin, ['-config', GO2RTC_CONFIG_PATH], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      _go2rtcStarting = false; _go2rtcUnavailable = true;
      console.error('[go2rtc] could not start — camera widgets will show "unavailable": ' + e.message);
      return;
    }
    child.on('error', (e) => {
      _go2rtcStarting = false;
      if (e.code === 'ENOENT') { _go2rtcUnavailable = true; console.error('[go2rtc] binary not found — cameras unavailable on this device'); }
      else console.error('[go2rtc] process error: ' + e.message);
    });
    child.stdout.on('data', _go2rtcLog);
    child.stderr.on('data', _go2rtcLog);
    child.on('spawn', () => {
      _go2rtcStarting = false; _go2rtcUnavailable = false; _go2rtcBackoff = 1000;
      console.log(`[go2rtc] started (pid ${child.pid}, api 127.0.0.1:${go2rtcPort()})`);
    });
    child.on('exit', (code, sig) => {
      console.log(`[go2rtc] exited (code ${code}${sig ? ', signal ' + sig : ''})`);
      _go2rtc = null; _go2rtcStarting = false;
      if (_go2rtcStopRequested && !_go2rtcWantImmediateRespawn) { _go2rtcStopRequested = false; return; }
      const immediate = _go2rtcWantImmediateRespawn;
      _go2rtcWantImmediateRespawn = false; _go2rtcStopRequested = false;
      if (getSetting('camera_service_autostart') === '0' || !anyLayoutHasCamera()) return;
      const delay = immediate ? 200 : _go2rtcBackoff;
      if (!immediate) _go2rtcBackoff = Math.min(_go2rtcBackoff * 2, 15000);
      _go2rtcRestartTID = setTimeout(() => { _go2rtcRestartTID = null; startCameraService(); }, delay);
    });
    _go2rtc = child;
  }
  function stopCameraService(reason) {
    if (_go2rtcRestartTID) { clearTimeout(_go2rtcRestartTID); _go2rtcRestartTID = null; }
    if (!_go2rtc) return;
    console.log('[go2rtc] stopping (' + (reason || 'requested') + ')');
    _go2rtcStopRequested = true; _go2rtcWantImmediateRespawn = false;
    try { _go2rtc.kill(); } catch {}
  }
  // Rewrite the config and make go2rtc pick it up: kill + immediate respawn when
  // it's running (go2rtc reads its config only at startup — no reliable partial
  // reload), a fresh start when it wasn't. No-ops (and stops the service) when
  // nothing needs a camera or the hard off-switch is set.
  async function reloadCameraService() {
    try {
      if (getSetting('camera_service_autostart') === '0') { stopCameraService('service disabled'); return; }
      if (!anyLayoutHasCamera()) { stopCameraService('no camera widgets'); return; }
      let yaml;
      try { yaml = toGo2rtcYaml(await buildGo2rtcConfig()); }
      catch (e) { console.error('[go2rtc] config build failed: ' + e.message); return; }
      try { fs.writeFileSync(GO2RTC_CONFIG_PATH, yaml); }
      catch (e) { console.error('[go2rtc] config write failed: ' + e.message); return; }
      if (_go2rtc) {
        _go2rtcWantImmediateRespawn = true;
        try { _go2rtc.kill(); } catch {}
      } else {
        // Bundled by the installer / image; downloaded on demand otherwise so a
        // code-only in-app update still ends up with a working Camera widget.
        const ready = await ensureGo2rtcBinary();
        if (ready) startCameraService();
      }
    } catch (e) {
      console.error('[go2rtc] reload error: ' + e.message);
    }
  }
  // A camera widget exists but the service isn't up (typically a first-run
  // binary download that failed while offline) — retry periodically so it
  // self-heals once the network is back. Cheap: no-ops unless all conditions hold.
  setInterval(() => {
    if (!_go2rtc && !_go2rtcStarting && !_go2rtcDownloading && !_go2rtcUnsupportedArch
        && getSetting('camera_service_autostart') !== '0' && anyLayoutHasCamera()) {
      reloadCameraService();
    }
  }, 20 * 60 * 1000);
  function go2rtcApi(method, pathname) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: go2rtcPort(), path: pathname, method, timeout: 4000 },
        (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => {
          if (r.statusCode >= 400) return reject(new Error('go2rtc ' + r.statusCode));
          try { resolve(d ? JSON.parse(d) : null); } catch { resolve(null); }
        }); }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('go2rtc timeout')));
      req.end();
    });
  }

  // WebSocket reverse-proxy: /api/camera/:id/ws  <->  ws://127.0.0.1:<port>/api/ws?src=cam_<id>
  let _camWss = null;
  function attachCameraWsProxy(server) {
    if (!WebSocketClient || _camWss) return;
    const WSS = WebSocketClient.Server || WebSocketClient.WebSocketServer;
    if (!WSS) return;
    _camWss = new WSS({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      let pathname;
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return; }
      const m = pathname.match(/^\/api\/camera\/(\d+)\/ws$/);
      if (!m) return; // not ours — leave the socket for any other handler
      // Upgrades never pass through Express middleware, so the remote login
      // gate never sees them. Camera media stays off the remote path entirely.
      if (remoteGateEnabled(req) && (requestIsRemote(req) || !findRemoteSession(req))) { socket.destroy(); return; }
      const id = parseInt(m[1], 10);
      if (!db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(id)) { socket.destroy(); return; }
      _camWss.handleUpgrade(req, socket, head, (client) => {
        let upstream;
        try { upstream = new WebSocketClient(`ws://127.0.0.1:${go2rtcPort()}/api/ws?src=cam_${id}`); }
        catch { try { client.close(); } catch {} return; }
        const closeBoth = () => { try { client.close(); } catch {} try { upstream.close(); } catch {} };
        upstream.on('open', () => {
          client.on('message', (d, isBinary) => { try { upstream.send(d, { binary: isBinary }); } catch {} });
          upstream.on('message', (d, isBinary) => { try { client.send(d, { binary: isBinary }); } catch {} });
        });
        upstream.on('error', closeBoth);
        upstream.on('close', closeBoth);
        client.on('error', closeBoth);
        client.on('close', closeBoth);
      });
    });
  }

  // ── Camera API ──
  function redactCamera(c) {
    let host_hint = '';
    if (c.kind === 'ha') host_hint = c.url.slice(3);
    else { try { host_hint = new URL(c.url).host; } catch {} }
    return { id: c.id, name: c.name, kind: c.kind, url_set: !!c.url, host_hint, created_at: c.created_at };
  }

  app.get('/api/cameras', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(db.prepare(`SELECT * FROM cameras ORDER BY name COLLATE NOCASE, id`).all().map(redactCamera));
  });

  app.post('/api/cameras', (req, res) => {
    const b = req.body || {};
    const name = demoCleanText((b.name || '').toString().slice(0, 60), 60).trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const kind = b.kind === 'ha' ? 'ha' : 'url';
    const v = validateCameraUrl(kind, b.url);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const r = db.prepare(`INSERT INTO cameras (name, kind, url) VALUES (?, ?, ?)`).run(name, kind, v.value);
    broadcastUpdate('cameras');
    reloadCameraService();
    res.status(201).json(redactCamera(db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(r.lastInsertRowid)));
  });

  app.put('/api/cameras/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Camera not found' });
    const b = req.body || {};
    const sets = [], vals = [];
    if (b.name !== undefined) {
      const name = demoCleanText((b.name || '').toString().slice(0, 60), 60).trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      sets.push('name=?'); vals.push(name);
    }
    const kind = b.kind === 'ha' ? 'ha' : b.kind === 'url' ? 'url' : existing.kind;
    if (b.kind !== undefined) { sets.push('kind=?'); vals.push(kind); }
    const urlGiven = b.url !== undefined && (b.url || '').toString().trim() !== '';
    if (urlGiven) {
      const v = validateCameraUrl(kind, b.url);
      if (!v.ok) return res.status(400).json({ error: v.error });
      sets.push('url=?'); vals.push(v.value);
    } else if (kind !== existing.kind) {
      return res.status(400).json({ error: 'Changing the source type needs a new URL' });
    }
    if (!sets.length) return res.json(redactCamera(existing));
    vals.push(existing.id);
    db.prepare(`UPDATE cameras SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    broadcastUpdate('cameras');
    reloadCameraService();
    res.json(redactCamera(db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(existing.id)));
  });

  app.delete('/api/cameras/:id', (req, res) => {
    const r = db.prepare(`DELETE FROM cameras WHERE id = ?`).run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Camera not found' });
    broadcastUpdate('cameras');
    reloadCameraService();
    res.json({ ok: true });
  });

  app.get('/api/cameras/:id/test', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = parseInt(req.params.id, 10);
    if (!db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(id)) return res.status(404).json({ error: 'Camera not found' });
    const state = cameraServiceState();
    if (state === 'downloading') return res.json({ ok: false, error: 'Setting up the camera service — try again in a moment.' });
    if (state === 'unavailable') {
      return res.json({ ok: false, error: _go2rtcUnsupportedArch
        ? 'No camera service build for this device — run the server on Docker or Windows instead.'
        : "Couldn't set up the camera service (offline?). It will retry on its own." });
    }
    if (state === 'disabled') return res.json({ ok: false, error: 'The camera service is turned off in settings.' });
    try {
      const info = await go2rtcApi('GET', `/api/streams?src=cam_${id}`);
      const s = info && (info[`cam_${id}`] || info);
      const producers = s && s.producers;
      const online = Array.isArray(producers) && producers.some((p) => p && !p.error);
      res.json(online ? { ok: true } : { ok: false, error: 'The camera service could not connect to this stream yet.' });
    } catch {
      res.json({ ok: false, error: 'The camera service is not responding.' });
    }
  });

  app.get('/api/camera/service', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ state: cameraServiceState() });
  });

  // Poster / last-frame still (also what the widget shows dimmed while
  // reconnecting). Proxied straight from go2rtc; never cached.
  app.get('/api/camera/:id/frame.jpeg', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || !db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(id)) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store');
    const up = http.request(
      { host: '127.0.0.1', port: go2rtcPort(), path: `/api/frame.jpeg?src=cam_${id}`, method: 'GET', timeout: 10000 },
      (r) => {
        if (r.statusCode >= 400) { res.sendStatus(502); r.resume(); return; }
        res.status(200);
        if (r.headers['content-type']) res.set('Content-Type', r.headers['content-type']);
        r.pipe(res);
      }
    );
    up.on('error', () => { if (!res.headersSent) res.sendStatus(502); });
    up.on('timeout', () => up.destroy());
    up.end();
  });
  // _go2rtc (the running helper process) is reassigned inside this module, so it cannot be handed out by value: hand out a getter. The reader is the
  // process exit handler in server.js, which stops the helper.
  return { stopCameraService, reloadCameraService, attachCameraWsProxy, ensureGo2rtcBinary, getGo2rtcProc: () => _go2rtc };
};
