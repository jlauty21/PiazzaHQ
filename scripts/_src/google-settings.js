'use strict';
// Google Calendar push settings: what is saved, the client id / secret entry, and disconnecting.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/calendar-push-settings.test.js.
module.exports = function registerGoogleSettings({ app, db, getSetting, googleClientConfigured, setGoogleDisconnected, setSetting }) {
  app.get('/api/google-settings', (req, res) => {
    res.json({
      google_push_enabled: getSetting('google_push_enabled') || '0',
      google_connected: !!getSetting('google_refresh_token'),
      google_client_configured: googleClientConfigured(),
      google_account_email: getSetting('google_account_email') || '',
      google_calendar_id: getSetting('google_calendar_id') || '',
      google_calendar_name: getSetting('google_calendar_name') || '',
    });
  });

  // Non-secret fields + optional client id/secret entry (for when they're not
  // coming from env). Tokens are NEVER set through here — only the device flow
  // writes them. push_enabled:'0' with disconnect:true fully unlinks the account.
  app.put('/api/google-settings', (req, res) => {
    if (req.body.disconnect === true) { setGoogleDisconnected(); return res.json({ ok: true }); }
    const plain = ['google_push_enabled', 'google_calendar_id', 'google_calendar_name',
                   'google_oauth_client_id', 'google_oauth_client_secret'];
    const tx = db.transaction(() => {
      for (const key of plain) {
        if (req.body[key] !== undefined) setSetting(key, String(req.body[key]));
      }
    });
    tx();
    res.json({ ok: true });
  });
};
