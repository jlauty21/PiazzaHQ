'use strict';
// Connect Google: the authorization-code flow relayed through the mothership (start returns a consent URL with PKCE; poll exchanges the code directly with Google).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/google-connect.test.js.
module.exports = function registerGoogleConnect({ crypto, app, resolveUpdateServerUrl, getSetting, httpsRequest, GOOGLE_TOKEN_URL, GOOGLE_SCOPE, getGoogleConfig, formEncode, googleGetAccountEmail, setSetting }) {
  // Google's device flow doesn't allow Calendar scopes, and this device has no
  // stable public URL to be a redirect target. So: the consent redirect goes to
  // https://piazzahq.com/oauth/google/callback, which just stashes the auth
  // `code` keyed by an opaque `state`; this device polls for it and then
  // exchanges the code for tokens DIRECTLY with Google, here, using the client
  // secret + a PKCE verifier that never leave this box. The mothership only
  // ever holds a short-lived single-use code, useless without those.
  const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  const googleConnectPending = new Map(); // state -> { verifier, ts }
  function googleRedirectUri() { return resolveUpdateServerUrl() + '/oauth/google/callback'; }

  // Step 1: hand the UI a Google consent URL to open on a phone.
  app.post('/api/google/connect-start', (req, res) => {
    const cfg = getGoogleConfig();
    if (!cfg.clientId) return res.status(400).json({ error: 'Google OAuth client ID is not configured.' });
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(64).toString('base64url'); // 86 chars, within the 43-128 PKCE range
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    // Prune anything stale, then remember this attempt's verifier.
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [k, v] of googleConnectPending) if (v.ts < cutoff) googleConnectPending.delete(k);
    googleConnectPending.set(state, { verifier, ts: Date.now() });
    const authUrl = GOOGLE_AUTH_URL + '?' + formEncode({
      client_id: cfg.clientId,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    res.json({ auth_url: authUrl, state });
  });

  // Step 2: the UI polls this. It asks the mothership relay whether the callback
  // has landed for this `state`; once it has, exchanges the code for tokens and
  // returns the account's calendars for the picker.
  app.post('/api/google/connect-poll', async (req, res) => {
    const cfg = getGoogleConfig();
    const state = (req.body && req.body.state || '').trim();
    if (!cfg.clientId || !cfg.clientSecret) return res.status(400).json({ status: 'error', error: 'Google OAuth client is not configured.' });
    const pending = googleConnectPending.get(state);
    if (!pending) return res.json({ status: 'error', error: 'This connection attempt expired — start again.' });
    try {
      const relayUrl = resolveUpdateServerUrl() + '/api/oauth/google/relay/' + encodeURIComponent(state);
      const rr = await httpsRequest(relayUrl, 'GET', {});
      const relay = JSON.parse(rr.body || '{}');
      if (relay.status === 'pending') return res.json({ status: 'pending' });
      if (relay.status === 'denied') { googleConnectPending.delete(state); return res.json({ status: 'denied' }); }
      if (relay.status !== 'ready' || !relay.code) { googleConnectPending.delete(state); return res.json({ status: 'error', error: relay.error || 'No authorization code came back.' }); }
      googleConnectPending.delete(state);
      // Exchange the code with Google directly.
      const tr = await httpsRequest(GOOGLE_TOKEN_URL, 'POST', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code: relay.code,
          code_verifier: pending.verifier,
          grant_type: 'authorization_code',
          redirect_uri: googleRedirectUri(),
        }),
      });
      const data = JSON.parse(tr.body || '{}');
      if (tr.statusCode !== 200 || !data.refresh_token) {
        return res.json({ status: 'error', error: data.error_description || data.error || `token exchange HTTP ${tr.statusCode}` });
      }
      setSetting('google_refresh_token', data.refresh_token);
      setSetting('google_access_token', data.access_token || '');
      setSetting('google_access_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
      const email = await googleGetAccountEmail(data.access_token);
      if (email) setSetting('google_account_email', email);
      // Default the target to the primary calendar unless one was already set.
      if (!getSetting('google_calendar_id')) {
        setSetting('google_calendar_id', 'primary');
        setSetting('google_calendar_name', email ? `${email} (primary)` : 'Primary calendar');
      }
      res.json({ status: 'connected', email });
    } catch (e) {
      res.status(502).json({ status: 'error', error: e.message });
    }
  });
};
