'use strict';
// Home Assistant condition alerts: the saved rules, evaluating them against live states, and raising / clearing notifications as they fire.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/ha-alert-lifecycle.test.js.
module.exports = function registerHaAlerts({ IS_DEMO, getSetting, isSlave, haRequest, raiseNotification, clearNotification }) {
  // A small rules engine: "if entity X's state is/above/below Y for N minutes,
  // raise an alert." Alerts show as a banner on the display (which polls
  // /api/ha-alerts/active). Fire-once semantics: an alert fires when the
  // condition has held for its dwell time, and does NOT fire again until the
  // condition first goes false (or the person dismisses it, which also waits
  // for a false before it can re-fire). Host-only — a slave proxies its reads
  // to the host and never runs this loop.
  function getHaAlerts() {
    try { const a = JSON.parse(getSetting('ha_alerts_json') || '[]'); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  const _haAlertRuntime = new Map();  // id -> { since, firing, dismissed }
  const _haActiveAlerts = new Map();  // id -> { id, message, entityName, firedAt }

  function evalHaAlertCondition(op, current, value) {
    if (op === 'eq') return String(current).toLowerCase() === String(value).toLowerCase();
    const n = parseFloat(current), v = parseFloat(value);
    if (!Number.isFinite(n) || !Number.isFinite(v)) return false;
    if (op === 'above') return n > v;
    if (op === 'below') return n < v;
    return false;
  }

  async function checkHaAlerts() {
    if (IS_DEMO) return;
    if (isSlave()) return;
    const base = getSetting('ha_base_url'), token = getSetting('ha_token');
    if (!base || !token) return;
    const alerts = getHaAlerts().filter(a => a && a.enabled && a.entityId && a.op);
    const liveIds = new Set(alerts.map(a => a.id));
    for (const id of [..._haAlertRuntime.keys()]) if (!liveIds.has(id)) {
      _haAlertRuntime.delete(id); _haActiveAlerts.delete(id); clearNotification(`ha-alert:${id}`);
    }
    for (const a of alerts) {
      let cur;
      try { cur = await haRequest(`/api/states/${encodeURIComponent(a.entityId)}`); }
      catch { continue; } // entity temporarily unreachable — leave state as-is
      const met = evalHaAlertCondition(a.op, cur.state, a.value);
      const rt = _haAlertRuntime.get(a.id) || { since: null, firing: false, dismissed: false };
      if (!met) {
        rt.since = null; rt.firing = false; rt.dismissed = false;
        _haActiveAlerts.delete(a.id);
        clearNotification(`ha-alert:${a.id}`);
      } else {
        if (rt.since == null) rt.since = Date.now();
        const held = (Date.now() - rt.since) >= (Number(a.dwellMin) || 0) * 60000;
        if (held && !rt.firing && !rt.dismissed) {
          rt.firing = true;
          const name = (cur.attributes && cur.attributes.friendly_name) || a.name || a.entityId;
          const opText = a.op === 'eq' ? `is "${a.value}"` : a.op === 'above' ? `above ${a.value}` : `below ${a.value}`;
          const message = (a.message && a.message.trim()) || `${name} ${opText}`;
          _haActiveAlerts.set(a.id, { id: a.id, message, entityName: name, firedAt: Date.now() });
          raiseNotification({ kind: 'ha-alert', key: `ha-alert:${a.id}`, title: 'Home Assistant', body: message,
            screen: a.screen !== false, phone: a.phone !== false });
        }
      }
      _haAlertRuntime.set(a.id, rt);
    }
  }
  setInterval(checkHaAlerts, 2 * 60 * 1000);
  setTimeout(checkHaAlerts, 20 * 1000); // first pass shortly after boot
  return { getHaAlerts, _haAlertRuntime, _haActiveAlerts, checkHaAlerts };
};
