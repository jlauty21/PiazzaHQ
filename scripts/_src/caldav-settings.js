'use strict';
// iCloud CalDAV push settings: discovery of the account's calendars, saving the account (write-only password) and the calendar list, and the 'Add to' picker.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/calendar-push-settings.test.js.
module.exports = function registerCaldavSettings({ app, db, getSetting, discoverCalDAVCalendars, getCaldavConfig, getGoogleConfig, googleClientConfigured }) {
  // Same split as briefing-settings above (separate from /api/settings so the
  // app-specific password never rides along in a generic settings GET).

  // Tests UNSAVED credentials and returns the account's calendars for the
  // picker. POST, not GET-with-query, specifically so a real Apple ID password
  // doesn't end up in an access log or proxy the way a query string would.
  app.post('/api/caldav/discover', async (req, res) => {
    const username = (req.body && req.body.username || '').trim();
    let password = (req.body && req.body.app_password || '').trim();
    // Blank password + already-saved one => test the saved credential (lets the
    // user re-run discovery to change calendars without re-typing the password).
    if (!password) password = getSetting('icloud_app_password') || '';
    if (!username || !password) return res.status(400).json({ ok: false, error: 'Apple ID and app-specific password are both required.' });
    try {
      const calendars = await discoverCalDAVCalendars(username, password);
      res.json({ ok: true, calendars });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.put('/api/caldav-settings', (req, res) => {
    const allowed = ['icloud_push_enabled', 'icloud_username', 'icloud_calendar_url', 'icloud_calendar_name'];
    const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    const tx = db.transaction(() => {
      for (const key of allowed) {
        if (req.body[key] !== undefined) upsert.run(key, String(req.body[key]));
      }
      // Password only overwrites when the user actually typed a new one — blank means "keep existing".
      const newPass = (req.body.icloud_app_password || '').trim();
      if (newPass) upsert.run('icloud_app_password', newPass);
      // Full discovered calendar list, for the per-event picker on the widget.
      if (Array.isArray(req.body.icloud_calendars)) {
        const clean = req.body.icloud_calendars
          .filter(c => c && c.url && c.name)
          .map(c => ({ url: String(c.url), name: String(c.name) }));
        upsert.run('icloud_calendars_json', JSON.stringify(clean));
      }
    });
    tx();
    res.json({ ok: true });
  });

  function getIcloudCalendars() {
    try { const a = JSON.parse(getSetting('icloud_calendars_json') || '[]'); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }

  app.get('/api/caldav-settings', (req, res) => {
    res.json({
      icloud_push_enabled: getSetting('icloud_push_enabled') || '0',
      icloud_username: getSetting('icloud_username') || '',
      icloud_app_password_set: !!getSetting('icloud_app_password'),
      icloud_calendar_url: getSetting('icloud_calendar_url') || '',
      icloud_calendar_name: getSetting('icloud_calendar_name') || '',
      icloud_calendars: getIcloudCalendars(),
    });
  });

  // The list of places a new event can be sent, for the calendar widget's
  // "Add to" picker. Only includes a target if it's actually usable right now.
  // `id` is what gets stored on the event as `target_calendar`.
  app.get('/api/event-targets', (req, res) => {
    const targets = [{ id: 'local', label: 'This device only' }];
    let dflt = 'local';
    const cd = getCaldavConfig();
    if (cd.enabled && cd.username && cd.password) {
      const list = getIcloudCalendars();
      const entries = list.length ? list : (cd.calendarUrl ? [{ url: cd.calendarUrl, name: getSetting('icloud_calendar_name') || 'iCloud' }] : []);
      for (const c of entries) targets.push({ id: `caldav:${c.url}`, label: `${c.name} (iCloud)` });
      if (cd.calendarUrl) dflt = `caldav:${cd.calendarUrl}`;
      else if (entries.length) dflt = `caldav:${entries[0].url}`;
    }
    const g = getGoogleConfig();
    if (g.enabled && g.refreshToken && g.calendarId && googleClientConfigured()) {
      const gname = getSetting('google_calendar_name') || getSetting('google_account_email') || 'Google';
      targets.push({ id: 'google', label: `${gname} (Google)` });
      if (dflt === 'local') dflt = 'google';
    }
    res.json({ targets, default: dflt });
  });
};
