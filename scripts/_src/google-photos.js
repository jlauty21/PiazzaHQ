'use strict';
// Google Photos as a photo source, through Google's Photos Picker API. Google closed the old "read my whole library" API in 2025, so the only way in now
// is the picker: the person opens a link on their phone, ticks the photos they want, and we copy those into the local library (source='google', tagged
// 'google-photos'), exactly like uploads. There is no background sync — picking again adds more.
// Signing in is the same authorization-code flow as Calendar (relayed through the mothership, PKCE), but it keeps its OWN tokens (gphotos_*) so Calendar and
// Photos can be connected, and disconnected, independently. Host-only; a failure here never touches uploaded or iCloud photos.
// Covered by test/api/google-photos.test.js against a fake Google. PIAZZA_GOOGLE_PICKER_URL points the picker API at that fake (tests only).
module.exports = function registerGooglePhotos({ crypto, path, fs, app, db, UPLOAD_DIR, broadcastUpdate, fetchWithTimeout, resolveUpdateServerUrl, getSetting, setSetting, httpsRequest, GOOGLE_TOKEN_URL, getGoogleConfig, formEncode, googleGetAccountEmail, isSlave }) {
  const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  const PICKER_URL = (process.env.PIAZZA_GOOGLE_PICKER_URL || 'https://photospicker.googleapis.com/v1').replace(/\/$/, '');
  const SCOPE = 'openid email https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
  const MAX_PER_PICK = 500;
  const pending = new Map(); // state -> { verifier, ts }
  let importing = false;

  const redirectUri = () => resolveUpdateServerUrl() + '/oauth/google/callback';
  const connected = () => !!getSetting('gphotos_refresh_token');
  function disconnect() { for (const k of ['gphotos_refresh_token', 'gphotos_access_token', 'gphotos_access_token_expiry', 'gphotos_account_email', 'gphotos_session_id', 'gphotos_picker_url', 'gphotos_session_expiry']) setSetting(k, ''); }
  function clearSession() { for (const k of ['gphotos_session_id', 'gphotos_picker_url', 'gphotos_session_expiry']) setSetting(k, ''); }

  async function accessToken() {
    const cfg = getGoogleConfig();
    if (!cfg.clientId || !cfg.clientSecret) throw new Error('Google OAuth client is not configured on this server.');
    const refresh = getSetting('gphotos_refresh_token');
    if (!refresh) throw new Error("Google Photos isn't connected.");
    const cached = getSetting('gphotos_access_token') || '';
    if (cached && Date.now() < Number(getSetting('gphotos_access_token_expiry') || 0) - 5 * 60 * 1000) return cached;
    const r = await httpsRequest(GOOGLE_TOKEN_URL, 'POST', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formEncode({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }) });
    let d = {}; try { d = JSON.parse(r.body || '{}'); } catch {}
    if (r.statusCode !== 200 || !d.access_token) {
      if (d.error === 'invalid_grant') { disconnect(); throw new Error('Google Photos access expired or was revoked — connect again.'); }
      throw new Error('Google token refresh failed: ' + (d.error || 'HTTP ' + r.statusCode));
    }
    setSetting('gphotos_access_token', d.access_token);
    setSetting('gphotos_access_token_expiry', String(Date.now() + (d.expires_in || 3600) * 1000));
    return d.access_token;
  }

  async function picker(method, urlPath, token) {
    const r = await httpsRequest(PICKER_URL + urlPath, method, { headers: { Authorization: 'Bearer ' + token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: method === 'POST' ? '{}' : null });
    let json = null; try { json = r.body ? JSON.parse(r.body) : null; } catch {}
    return { status: r.statusCode, json };
  }

  // Google's refusal in words a person can act on. Google answers { error: { code, message, status, details: [{ reason, metadata: { activationUrl } }] } }.
  function googleWhy(status, json) {
    const e = (json && json.error) || {};
    const msg = String(e.message || '').trim();
    const details = Array.isArray(e.details) ? e.details : [];
    const reason = (details.find((d) => d && d.reason) || {}).reason || '';
    const link = (details.map((d) => d && d.metadata && d.metadata.activationUrl).find(Boolean)) || '';
    if (reason === 'SERVICE_DISABLED' || reason === 'ACCESS_NOT_CONFIGURED' || /has not been used in project|is disabled|accessNotConfigured/i.test(msg)) {
      return 'The Google Photos Picker API is not switched on in your Google Cloud project. In the Google Cloud Console open APIs & Services > Library, find "Photos Picker API" and press Enable (wait a minute afterwards), then try again.' + (link ? ' Direct link: ' + link : '');
    }
    if (status === 403 && /scope|insufficient|permission/i.test(msg + ' ' + reason)) {
      return 'Google did not allow access to your photos (' + (msg || 'permission denied') + '). Disconnect Google Photos and connect again, and tick the photos permission on Google\'s screen.';
    }
    return 'Google could not start a photo picker (HTTP ' + status + (msg ? ': ' + msg.slice(0, 200) : '') + ').';
  }

  function extFromMagic(b) {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
  }

  // Copy every photo the person picked in this session into the library. Already-imported ones (same Google id) are skipped, videos are skipped.
  async function importPicked(sessionId, token) {
    const out = { added: 0, skipped: 0 };
    const have = new Set(db.prepare(`SELECT ext_guid FROM photos WHERE source = 'google'`).all().map((r) => r.ext_guid));
    let items = [], pageToken = '';
    do {
      const r = await picker('GET', `/mediaItems?sessionId=${encodeURIComponent(sessionId)}&pageSize=100${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`, token);
      if (r.status !== 200 || !r.json) throw new Error('Google could not list the picked photos (HTTP ' + r.status + ').');
      items = items.concat(r.json.mediaItems || []);
      pageToken = r.json.nextPageToken || '';
    } while (pageToken && items.length < MAX_PER_PICK);
    items = items.slice(0, MAX_PER_PICK);
    for (const it of items) {
      const file = it.mediaFile || {};
      if (!it.id || it.type === 'VIDEO' || !file.baseUrl || have.has(it.id)) { out.skipped++; continue; }
      const safe = String(it.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || crypto.randomBytes(6).toString('hex');
      const tmp = path.join(UPLOAD_DIR, `.google.dl.${safe}.${process.pid}`);
      try {
        const res = await fetchWithTimeout(file.baseUrl + '=w2048-h2048', { headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'PiazzaHQ/1.0' }, timeoutMs: 60000, timeoutMessage: 'timeout' });
        if (res.status !== 200) throw new Error('HTTP ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = extFromMagic(buf.subarray(0, 16));
        if (!ext) { out.skipped++; continue; }
        fs.writeFileSync(tmp, buf);
        const filename = `google_${safe}.${ext}`;
        fs.renameSync(tmp, path.join(UPLOAD_DIR, filename));
        const maxOrder = db.prepare(`SELECT MAX(sort_order) m FROM photos`).get().m || 0;
        db.prepare(`INSERT INTO photos (filename, label, tags, sort_order, source, ext_guid) VALUES (?,?,?,?,?,?)`).run(filename, '', 'google-photos', maxOrder + 1, 'google', it.id);
        have.add(it.id);
        out.added++;
      } catch { try { fs.unlinkSync(tmp); } catch {} out.skipped++; }
    }
    return out;
  }

  const count = () => db.prepare(`SELECT COUNT(*) n FROM photos WHERE source = 'google'`).get().n;

  app.get('/api/google-photos', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cfg = getGoogleConfig();
    const exp = Number(getSetting('gphotos_session_expiry') || 0);
    const live = getSetting('gphotos_session_id') && exp > Date.now();
    res.json({
      configured: !!(cfg.clientId && cfg.clientSecret), connected: connected(), email: getSetting('gphotos_account_email') || '', count: count(),
      importing, last_import: getSetting('gphotos_last_import') || '', last_error: getSetting('gphotos_last_error') || '',
      session: live ? { picker_uri: getSetting('gphotos_picker_url'), expires: exp } : null,
    });
  });

  app.post('/api/google-photos/connect-start', (req, res) => {
    const cfg = getGoogleConfig();
    if (!cfg.clientId) return res.status(400).json({ error: 'Google OAuth client ID is not configured.' });
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(64).toString('base64url');
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [k, v] of pending) if (v.ts < cutoff) pending.delete(k);
    pending.set(state, { verifier, ts: Date.now() });
    res.json({ state, auth_url: AUTH_URL + '?' + formEncode({ client_id: cfg.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state }) });
  });

  app.post('/api/google-photos/connect-poll', async (req, res) => {
    const cfg = getGoogleConfig();
    const state = String((req.body && req.body.state) || '').trim();
    if (!cfg.clientId || !cfg.clientSecret) return res.status(400).json({ status: 'error', error: 'Google OAuth client is not configured.' });
    const p = pending.get(state);
    if (!p) return res.json({ status: 'error', error: 'This connection attempt expired — start again.' });
    try {
      const rr = await httpsRequest(resolveUpdateServerUrl() + '/api/oauth/google/relay/' + encodeURIComponent(state), 'GET', {});
      const relay = JSON.parse(rr.body || '{}');
      if (relay.status === 'pending') return res.json({ status: 'pending' });
      if (relay.status === 'denied') { pending.delete(state); return res.json({ status: 'denied' }); }
      if (relay.status !== 'ready' || !relay.code) { pending.delete(state); return res.json({ status: 'error', error: relay.error || 'No authorization code came back.' }); }
      pending.delete(state);
      const tr = await httpsRequest(GOOGLE_TOKEN_URL, 'POST', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formEncode({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: relay.code, code_verifier: p.verifier, grant_type: 'authorization_code', redirect_uri: redirectUri() }) });
      const d = JSON.parse(tr.body || '{}');
      if (tr.statusCode !== 200 || !d.refresh_token) return res.json({ status: 'error', error: d.error_description || d.error || `token exchange HTTP ${tr.statusCode}` });
      setSetting('gphotos_refresh_token', d.refresh_token);
      setSetting('gphotos_access_token', d.access_token || '');
      setSetting('gphotos_access_token_expiry', String(Date.now() + (d.expires_in || 3600) * 1000));
      setSetting('gphotos_last_error', '');
      const email = await googleGetAccountEmail(d.access_token);
      if (email) setSetting('gphotos_account_email', email);
      broadcastUpdate('settings');
      res.json({ status: 'connected', email });
    } catch (e) { res.status(502).json({ status: 'error', error: e.message }); }
  });

  // Open a picker session: returns the link the person opens on their phone (or this screen) to choose photos.
  app.post('/api/google-photos/pick', async (req, res) => {
    if (isSlave()) return res.status(400).json({ error: 'Photos are managed on the main screen.' });
    if (!connected()) return res.status(400).json({ error: "Google Photos isn't connected." });
    try {
      const token = await accessToken();
      const old = getSetting('gphotos_session_id');
      if (old) picker('DELETE', '/sessions/' + encodeURIComponent(old), token).catch(() => {});
      const r = await picker('POST', '/sessions', token);
      if (r.status !== 200 || !r.json || !r.json.id || !r.json.pickerUri) throw new Error(googleWhy(r.status, r.json));
      const poll = parseInt(String((r.json.pollingConfig || {}).pollInterval || '5'), 10) || 5;
      const ttl = parseInt(String((r.json.pollingConfig || {}).timeoutIn || '1800'), 10) || 1800;
      setSetting('gphotos_session_id', r.json.id);
      setSetting('gphotos_picker_url', r.json.pickerUri);
      setSetting('gphotos_session_expiry', String(Date.now() + ttl * 1000));
      res.json({ ok: true, picker_uri: r.json.pickerUri, poll_seconds: Math.max(2, Math.min(30, poll)), expires: Date.now() + ttl * 1000 });
    } catch (e) { setSetting('gphotos_last_error', String(e.message).slice(0, 300)); res.status(502).json({ error: e.message }); }
  });

  // The UI polls this while the person picks. Once Google says they're done, the photos are copied in and the session is closed.
  app.post('/api/google-photos/pick-poll', async (req, res) => {
    if (isSlave()) return res.status(400).json({ error: 'Photos are managed on the main screen.' });
    const sid = getSetting('gphotos_session_id');
    if (!connected() || !sid) return res.json({ status: 'none' });
    if (Number(getSetting('gphotos_session_expiry') || 0) < Date.now()) { clearSession(); return res.json({ status: 'expired' }); }
    if (importing) return res.json({ status: 'importing' });
    try {
      const token = await accessToken();
      const r = await picker('GET', '/sessions/' + encodeURIComponent(sid), token);
      if (r.status === 404 || r.status === 403) { clearSession(); return res.json({ status: 'expired' }); }
      if (r.status !== 200 || !r.json) throw new Error('Google could not check the picker (HTTP ' + r.status + ').');
      if (!r.json.mediaItemsSet) return res.json({ status: 'pending' });
      importing = true;
      try {
        const out = await importPicked(sid, token);
        picker('DELETE', '/sessions/' + encodeURIComponent(sid), token).catch(() => {});
        clearSession();
        setSetting('gphotos_last_import', new Date().toISOString());
        setSetting('gphotos_last_error', '');
        if (out.added) broadcastUpdate('photos');
        console.log(`[google-photos] import: +${out.added} (${out.skipped} skipped)`);
        res.json({ status: 'done', ...out, count: count() });
      } finally { importing = false; }
    } catch (e) { setSetting('gphotos_last_error', String(e.message).slice(0, 300)); res.status(502).json({ status: 'error', error: e.message }); }
  });

  app.post('/api/google-photos/cancel', (req, res) => { clearSession(); res.json({ ok: true }); });

  // Disconnect only (the photos stay) — or, with DELETE, remove what was imported too.
  app.post('/api/google-photos/disconnect', (req, res) => { disconnect(); broadcastUpdate('settings'); res.json({ ok: true }); });
  app.delete('/api/google-photos', (req, res) => {
    const rows = db.prepare(`SELECT id, filename FROM photos WHERE source = 'google'`).all();
    for (const row of rows) { try { fs.unlinkSync(path.join(UPLOAD_DIR, row.filename)); } catch {} }
    db.prepare(`DELETE FROM photos WHERE source = 'google'`).run();
    disconnect();
    for (const k of ['gphotos_last_import', 'gphotos_last_error']) setSetting(k, '');
    broadcastUpdate('photos'); broadcastUpdate('settings');
    res.json({ ok: true, removed: rows.length });
  });
};
