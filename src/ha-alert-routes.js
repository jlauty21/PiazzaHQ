'use strict';
// Home Assistant alert rules (routes): list and save the rules, the active alerts, and dismissing one.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/ha-alert-lifecycle.test.js and test/api/alert-switches.test.js.
module.exports = function registerHaAlertRoutes({ crypto, app, fetchJSON, isSlave, hostBaseURL, setSetting, getHaAlerts, _haAlertRuntime, _haActiveAlerts, checkHaAlerts, clearNotification }) {
  app.get('/api/ha-alerts', (req, res) => {
    res.json({ alerts: getHaAlerts() });
  });
  app.put('/api/ha-alerts', (req, res) => {
    const raw = Array.isArray(req.body && req.body.alerts) ? req.body.alerts : null;
    if (!raw) return res.status(400).json({ error: 'Body must be { alerts: [...] }.' });
    const OPS = new Set(['eq', 'above', 'below']);
    const clean = raw.slice(0, 40).map(a => ({
      id: String(a.id || crypto.randomBytes(6).toString('hex')),
      entityId: String(a.entityId || '').slice(0, 200),
      name: String(a.name || '').slice(0, 120),
      op: OPS.has(a.op) ? a.op : 'eq',
      value: String(a.value == null ? '' : a.value).slice(0, 120),
      dwellMin: Math.max(0, Math.min(1440, Math.round(Number(a.dwellMin) || 0))),
      message: String(a.message || '').slice(0, 200),
      enabled: a.enabled !== false,
      screen: a.screen !== false,  // per-rule: show the banner on the display
      phone: a.phone !== false,    // per-rule: also relay to phones
    })).filter(a => a.entityId);
    setSetting('ha_alerts_json', JSON.stringify(clean));
    // Drop runtime/active for anything no longer present so a re-added rule
    // starts fresh rather than inheriting a stale "already firing" flag.
    const ids = new Set(clean.map(a => a.id));
    // Also clear the on-screen banner for a removed rule — the display polls
    // /api/notifications/active, and deleting the runtime entry here hides the
    // id from checkHaAlerts()'s own cleanup pass, so it must happen here or a
    // deleted alert's banner sticks until a server restart.
    for (const id of [..._haAlertRuntime.keys()]) if (!ids.has(id)) {
      _haAlertRuntime.delete(id); _haActiveAlerts.delete(id); clearNotification(`ha-alert:${id}`);
    }
    if (!isSlave()) setTimeout(checkHaAlerts, 500);
    res.json({ ok: true, alerts: clean });
  });
  app.get('/api/ha-alerts/active', async (req, res) => {
    // The evaluator only runs on the host, so a slave has no active alerts of
    // its own — proxy the read so a slave display shows the same banner.
    if (isSlave()) {
      const base = hostBaseURL();
      if (base) {
        try { return res.json(await fetchJSON(`${base}/api/ha-alerts/active`, 6000)); }
        catch { return res.json({ active: [] }); }
      }
      return res.json({ active: [] });
    }
    res.json({ active: [..._haActiveAlerts.values()].sort((a, b) => b.firedAt - a.firedAt) });
  });
  app.post('/api/ha-alerts/dismiss', (req, res) => {
    const id = String((req.body && req.body.id) || '');
    _haActiveAlerts.delete(id);
    const rt = _haAlertRuntime.get(id);
    if (rt) { rt.firing = false; rt.dismissed = true; _haAlertRuntime.set(id, rt); }
    res.json({ ok: true });
  });
};
