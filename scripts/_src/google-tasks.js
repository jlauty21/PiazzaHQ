'use strict';
// Google Tasks as a second source for the Tasks widget (next to Todoist). Sign-in is the same authorization-code flow as Calendar and Photos (relayed through the
// mothership, PKCE) but it keeps its OWN tokens (gtasks_*), so Tasks can be connected and disconnected independently of Calendar.
// It plugs into the Todoist routes instead of adding a widget: a Google task list appears in the same project pickers with the id "g:<listId>", its tasks come back
// in Todoist's shape ({ id, content, due: { date } }) with the id "g:<listId>~<taskId>", and tapping one completes it on Google. src/todoist.js does that routing.
// Covered by test/api/google-tasks.test.js against a fake Google. PIAZZA_GOOGLE_TASKS_URL points the Tasks API at that fake (tests only).
module.exports = function registerGoogleTasks({ crypto, app, broadcastUpdate, resolveUpdateServerUrl, getSetting, setSetting, httpsRequest, GOOGLE_TOKEN_URL, getGoogleConfig, formEncode, googleGetAccountEmail }) {
  const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  const API = (process.env.PIAZZA_GOOGLE_TASKS_URL || 'https://tasks.googleapis.com/tasks/v1').replace(/\/$/, '');
  const SCOPE = 'openid email https://www.googleapis.com/auth/tasks';
  const KEYS = ['gtasks_refresh_token', 'gtasks_access_token', 'gtasks_access_token_expiry', 'gtasks_account_email'];
  const pending = new Map(); // state -> { verifier, ts }
  const MAX_TASKS = 200;     // per list; the widget shows a dozen or so

  const redirectUri = () => resolveUpdateServerUrl() + '/oauth/google/callback';
  const connected = () => !!getSetting('gtasks_refresh_token');
  function disconnect() { for (const k of KEYS) setSetting(k, ''); }
  const isGoogleId = (id) => typeof id === 'string' && id.startsWith('g:');

  async function accessToken() {
    const cfg = getGoogleConfig();
    if (!cfg.clientId || !cfg.clientSecret) throw new Error('Google OAuth client is not configured on this server.');
    const refresh = getSetting('gtasks_refresh_token');
    if (!refresh) throw new Error("Google Tasks isn't connected.");
    const cached = getSetting('gtasks_access_token') || '';
    if (cached && Date.now() < Number(getSetting('gtasks_access_token_expiry') || 0) - 5 * 60 * 1000) return cached;
    const r = await httpsRequest(GOOGLE_TOKEN_URL, 'POST', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formEncode({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }) });
    let d = {}; try { d = JSON.parse(r.body || '{}'); } catch {}
    if (r.statusCode !== 200 || !d.access_token) {
      if (d.error === 'invalid_grant') { disconnect(); throw new Error('Google Tasks access expired or was revoked - connect again in Settings.'); }
      throw new Error('Google token refresh failed: ' + (d.error || 'HTTP ' + r.statusCode));
    }
    setSetting('gtasks_access_token', d.access_token);
    setSetting('gtasks_access_token_expiry', String(Date.now() + (d.expires_in || 3600) * 1000));
    return d.access_token;
  }

  // Google's refusal in words a person can act on.
  function googleWhy(status, json) {
    const e = (json && json.error) || {};
    const msg = String(e.message || '').trim();
    const details = Array.isArray(e.details) ? e.details : [];
    const reason = (details.find((d) => d && d.reason) || {}).reason || '';
    if (reason === 'SERVICE_DISABLED' || reason === 'ACCESS_NOT_CONFIGURED' || /has not been used in project|is disabled|accessNotConfigured/i.test(msg)) {
      return 'The Google Tasks API is not switched on in your Google Cloud project. In the Google Cloud Console open APIs & Services > Library, find "Google Tasks API" and press Enable (wait a minute afterwards), then try again.';
    }
    if (status === 403 && /scope|insufficient|permission/i.test(msg + ' ' + reason)) return 'Google did not allow access to your tasks. Disconnect Google Tasks and connect again, and tick the tasks permission on Google\'s screen.';
    if (status === 401) return 'Google Tasks access expired - connect again in Settings.';
    return 'Google Tasks answered with an error (HTTP ' + status + (msg ? ': ' + msg.slice(0, 200) : '') + ').';
  }

  async function call(method, urlPath, body) {
    const token = await accessToken();
    const r = await httpsRequest(API + urlPath, method, { headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : null });
    let json = null; try { json = r.body ? JSON.parse(r.body) : null; } catch {}
    if (r.statusCode === 401) { setSetting('gtasks_access_token_expiry', '0'); }
    if (r.statusCode < 200 || r.statusCode >= 300) { const err = new Error(googleWhy(r.statusCode, json)); err.status = r.statusCode === 401 ? 401 : 502; throw err; }
    return json;
  }

  // The task lists of the account, shaped like Todoist projects for the pickers.
  async function lists() {
    const out = []; let pageToken = '';
    for (let i = 0; i < 5; i++) {
      const j = await call('GET', '/users/@me/lists?maxResults=100' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
      for (const l of (j && j.items) || []) if (l && l.id) out.push({ id: 'g:' + l.id, name: 'Google Tasks: ' + (l.title || 'My Tasks'), google: true });
      pageToken = j && j.nextPageToken; if (!pageToken) break;
    }
    return out;
  }

  // One list's open tasks in Todoist's shape. Google keeps due as an RFC 3339 date at midnight UTC - the date part is the day.
  async function tasks(projectId) {
    const listId = String(projectId).slice(2);
    const out = []; let pageToken = '';
    for (let i = 0; i < 5 && out.length < MAX_TASKS; i++) {
      const j = await call('GET', '/lists/' + encodeURIComponent(listId) + '/tasks?showCompleted=false&showHidden=false&maxResults=100' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
      for (const t of (j && j.items) || []) {
        if (!t || !t.id || t.status === 'completed' || t.deleted || !String(t.title || '').trim()) continue;
        const date = typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.due) ? t.due.slice(0, 10) : null;
        out.push({ id: 'g:' + listId + '~' + t.id, content: String(t.title).trim(), description: t.notes || '', due: date ? { date } : null, priority: 1, project_id: projectId });
      }
      pageToken = j && j.nextPageToken; if (!pageToken) break;
    }
    return out;
  }

  async function complete(taskKey) {
    const m = /^g:([^~]+)~(.+)$/.exec(String(taskKey));
    if (!m) { const e = new Error('Not a Google task id'); e.status = 400; throw e; }
    await call('PATCH', '/lists/' + encodeURIComponent(m[1]) + '/tasks/' + encodeURIComponent(m[2]), { status: 'completed' });
    return true;
  }

  // Writes for the linked Family Hub to-do lists (src/todo-lists.js). Keys are the same g:<list>~<task> form tasks() returns.
  const splitKey = (k) => { const m = /^g:([^~]+)~(.+)$/.exec(String(k)); if (!m) { const e = new Error('Not a Google task id'); e.status = 400; throw e; } return m; };
  async function create(listKey, title) {
    if (!isGoogleId(listKey)) { const e = new Error('Not a Google list id'); e.status = 400; throw e; }
    const listId = String(listKey).slice(2);
    const j = await call('POST', '/lists/' + encodeURIComponent(listId) + '/tasks', { title: String(title) });
    if (!j || !j.id) { const e = new Error('Google did not return the new task.'); e.status = 502; throw e; }
    return 'g:' + listId + '~' + j.id;
  }
  async function reopen(taskKey) { const m = splitKey(taskKey); await call('PATCH', '/lists/' + encodeURIComponent(m[1]) + '/tasks/' + encodeURIComponent(m[2]), { status: 'needsAction', completed: null }); return true; }
  async function rename(taskKey, title) { const m = splitKey(taskKey); await call('PATCH', '/lists/' + encodeURIComponent(m[1]) + '/tasks/' + encodeURIComponent(m[2]), { title: String(title) }); return true; }
  async function remove(taskKey) { const m = splitKey(taskKey); await call('DELETE', '/lists/' + encodeURIComponent(m[1]) + '/tasks/' + encodeURIComponent(m[2])); return true; }

  // ── Settings routes ──────────────────────────────────────────────────────────
  // ?check=1 also asks Google for the lists once, so the settings card can say WHY none appear (API switched off, access not granted) instead of leaving the person to guess.
  app.get('/api/google-tasks', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cfg = getGoogleConfig();
    const out = { configured: !!(cfg.clientId && cfg.clientSecret), connected: connected(), email: getSetting('gtasks_account_email') || '' };
    if (req.query.check && out.connected) { try { out.lists = (await lists()).length; } catch (e) { out.problem = e.message; } }
    res.json(out);
  });

  app.post('/api/google-tasks/connect-start', (req, res) => {
    const cfg = getGoogleConfig();
    if (!cfg.clientId) return res.status(400).json({ error: 'Google OAuth client ID is not configured.' });
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(64).toString('base64url');
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [k, v] of pending) if (v.ts < cutoff) pending.delete(k);
    pending.set(state, { verifier, ts: Date.now() });
    res.json({ state, auth_url: AUTH_URL + '?' + formEncode({ client_id: cfg.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state }) });
  });

  app.post('/api/google-tasks/connect-poll', async (req, res) => {
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
      // The consent screen lets a person untick individual permissions: without the tasks one the connection is useless, so say so now.
      if (d.scope && !/auth\/tasks/.test(d.scope)) return res.json({ status: 'error', error: 'The tasks permission was not ticked on Google\'s screen. Connect again and leave it ticked.' });
      setSetting('gtasks_refresh_token', d.refresh_token);
      setSetting('gtasks_access_token', d.access_token || '');
      setSetting('gtasks_access_token_expiry', String(Date.now() + (d.expires_in || 3600) * 1000));
      const email = await googleGetAccountEmail(d.access_token);
      if (email) setSetting('gtasks_account_email', email);
      broadcastUpdate('settings');
      res.json({ status: 'connected', email });
    } catch (e) { res.status(502).json({ status: 'error', error: e.message }); }
  });

  app.post('/api/google-tasks/disconnect', (req, res) => { disconnect(); broadcastUpdate('settings'); res.json({ ok: true }); });

  return { connected, isGoogleId, lists, tasks, complete, create, reopen, rename, remove };
};
