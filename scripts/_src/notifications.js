'use strict';
// Notification center: the on-screen banner list, per-kind delivery preferences, dismissing, and relaying new notifications to phones (every alert producer flows through raiseNotification).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/notif-prefs.test.js and the weather / Home Assistant alert tests.
module.exports = function registerNotifications({ fs, app, IS_DEMO, resolveUpdateServerUrl, fetchJSON, getSetting, isSlave, hostBaseURL, httpsRequest, _haAlertRuntime, _haActiveAlerts, _activeWeatherAlertIds, WX_KIND, wxDismissThread, setSetting }) {
  // One channel every producer (HA alerts today, more later) flows through.
  // The display polls /api/notifications/active for the banner. If phone
  // alerts are on, each NEW notification is also relayed to the household's
  // phones through the mothership (the device serves plain HTTP on the LAN,
  // which isn't a secure context, so it can't do Web Push itself).
  const _activeNotifications = new Map(); // key -> { key, kind, title, body, url, firedAt }

  // The notification kinds that exist. The delivery-preferences UI renders
  // from this list; add a row here when a new producer is introduced.
  const NOTIF_KINDS = [
    { id: 'ha-alert', label: 'Home Assistant alerts' },
    { id: 'weather-alert', label: 'Severe weather alerts' },
  ];
  function getNotifPrefs() {
    let stored = {};
    try { stored = JSON.parse(getSetting('notif_prefs_json') || '{}') || {}; } catch {}
    const out = {};
    for (const k of NOTIF_KINDS) {
      const p = stored[k.id] || {};
      out[k.id] = { screen: p.screen !== false, phone: p.phone !== false }; // default both on
    }
    return out;
  }
  function notifKindAllows(kind, channel) {
    const p = getNotifPrefs()[kind];
    if (!p) return true; // unknown kind — don't silently swallow it
    return p[channel] !== false;
  }

  // `screen` / `phone` are optional per-notification overrides (a producer,
  // e.g. one HA alert rule, can force a channel off); the per-KIND preference
  // gates on top of them, and phone also needs the global toggle + the relay.
  function raiseNotification({ kind, key, title, body, url, screen, phone }) {
    kind = kind || 'info';
    key = key || `${kind}:${Date.now()}`;
    const toScreen = (screen !== false) && notifKindAllows(kind, 'screen');
    const toPhone  = (phone  !== false) && notifKindAllows(kind, 'phone');
    const wasNew = !_activeNotifications.has(key);
    if (toScreen) {
      _activeNotifications.set(key, {
        key, kind, title: title || 'Piazza HQ', body: body || '', url: url || '',
        firedAt: wasNew ? Date.now() : _activeNotifications.get(key).firedAt,
      });
    } else {
      _activeNotifications.delete(key); // screen delivery is off for this kind/rule
    }
    if (wasNew && toPhone) relayPushToPhones(title || 'Piazza HQ', body || '', url || '');
  }
  function clearNotification(key) { _activeNotifications.delete(key); }

  async function relayPushToPhones(title, body, url) {
    try {
      if (IS_DEMO) return;
      if (getSetting('phone_alerts_enabled') !== '1' || isSlave()) return;
      const license = getSetting('update_license_key');
      const server = resolveUpdateServerUrl();
      if (!license || !server) return;
      // Tests only: record the push instead of sending it, after every real check above has passed (same idea as PIAZZA_MAIL_CAPTURE_DIR).
      if (process.env.PIAZZA_PUSH_CAPTURE_FILE) { fs.appendFileSync(process.env.PIAZZA_PUSH_CAPTURE_FILE, JSON.stringify({ title, body, url }) + '\n'); return; }
      await httpsRequest(`${server}/api/push/relay`, 'POST', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license, title, body, url }),
      });
    } catch { /* best-effort — a failed phone push never affects the on-screen one */ }
  }

  app.get('/api/notifications/active', async (req, res) => {
    if (isSlave()) {
      const base = hostBaseURL();
      if (base) { try { return res.json(await fetchJSON(`${base}/api/notifications/active`, 6000)); } catch { return res.json({ notifications: [] }); } }
      return res.json({ notifications: [] });
    }
    res.json({ notifications: [..._activeNotifications.values()].sort((a, b) => b.firedAt - a.firedAt) });
  });
  app.post('/api/notifications/dismiss', (req, res) => {
    const key = String((req.body && req.body.key) || '');
    clearNotification(key);
    _activeWeatherAlertIds.delete(key);
    if (key.startsWith(WX_KIND + ':')) wxDismissThread(key);   // the whole warning, updates included - not just this one message
    const m = key.match(/^ha-alert:(.+)$/);
    if (m) {
      _haActiveAlerts.delete(m[1]);
      const rt = _haAlertRuntime.get(m[1]);
      if (rt) { rt.firing = false; rt.dismissed = true; _haAlertRuntime.set(m[1], rt); }
    }
    res.json({ ok: true });
  });

  app.get('/api/notif-prefs', (req, res) => {
    res.json({ kinds: NOTIF_KINDS, prefs: getNotifPrefs() });
  });
  app.put('/api/notif-prefs', (req, res) => {
    const incoming = (req.body && req.body.prefs) || {};
    const clean = {};
    for (const k of NOTIF_KINDS) {
      const p = incoming[k.id] || {};
      clean[k.id] = { screen: p.screen !== false, phone: p.phone !== false };
    }
    setSetting('notif_prefs_json', JSON.stringify(clean));
    res.json({ ok: true, prefs: clean });
  });
  return { _activeNotifications, raiseNotification, clearNotification };
};
