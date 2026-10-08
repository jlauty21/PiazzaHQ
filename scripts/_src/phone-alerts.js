'use strict';
// Phone alert switches: whether alerts are also pushed to phones, and the setup link for it.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/alert-switches.test.js.
module.exports = function registerPhoneAlerts({ app, resolveUpdateServerUrl, getSetting, setSetting }) {
  app.get('/api/phone-alerts', (req, res) => {
    const license = getSetting('update_license_key') || '';
    const server = resolveUpdateServerUrl() || '';
    res.json({
      enabled: getSetting('phone_alerts_enabled') || '0',
      has_license: !!license,
      setup_url: (server && license) ? `${server}/notify-setup?license=${encodeURIComponent(license)}` : '',
    });
  });
  app.put('/api/phone-alerts', (req, res) => {
    if (req.body && req.body.enabled !== undefined) {
      setSetting('phone_alerts_enabled', String(req.body.enabled) === '1' ? '1' : '0');
    }
    res.json({ ok: true, enabled: getSetting('phone_alerts_enabled') || '0' });
  });
};
