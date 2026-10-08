'use strict';
// Severe weather alerts (NWS): polling, one banner per warning however many updates NWS issues, dismissing, and muting / snoozing event types; the settings routes for that.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/weather-alerts.test.js and test/api/weather-alert-updates.test.js.
module.exports = function registerWeatherAlerts({ app, IS_DEMO, fetchJSON, getSetting, isSlave, hostBaseURL, _activeWeatherAlertIds, WX_KIND, setSetting, httpGetJSON, _activeNotifications, raiseNotification, clearNotification }) {
  // A second producer into the same notification pipeline the HA alerts above
  // use — no new banner, no new delivery-prefs UI, just another thing that
  // calls raiseNotification()/clearNotification(). Polls the household's own
  // weather location, independent of whichever provider (Open-Meteo/OWM/NWS)
  // is actually chosen for the forecast display.
  // PIAZZA_NWS_ALERTS_URL overrides the base (tests only; unset in prod).
  const NWS_ALERTS_BASE = process.env.PIAZZA_NWS_ALERTS_URL || 'https://api.weather.gov';
  const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

  // Muting, snoozing, and following one warning through its updates
  // Found by looking at live api.weather.gov data (2026-10-02): NWS does not keep one alert per warning. It re-issues
  // the same Flood Warning every few minutes as an "Update" with a NEW id and a `references` list naming the messages
  // it replaces (68 of 75 live Flood Warnings were Updates). Keying everything on the id made every update look like a
  // brand-new alert: a new banner AND a new phone push each time, and dismissing one never stuck. Also, flood warnings
  // are all "Severe", so no severity floor can silence them without silencing tornado warnings - hence per-type muting.
  //
  // Persisted as small JSON settings (this device only):
  //   severe_weather_muted_events    ["Flood Warning", ...]            event types that never alert
  //   severe_weather_snoozed_events  { "Flood Warning": untilMs }      event types quiet until then
  //   severe_weather_seen            { ident: {event, until, key, dismissed} }   what was already notified, so an update
  //                                                                     of it (any id in its references) is the SAME alert
  //   severe_weather_event_history   { "Flood Warning": lastSeenMs }   types seen here lately, for the Settings list
  const WX_SEEN_GRACE_MS = 6 * 3600 * 1000;       // keep a finished warning's record a while: a late update can still point at it
  const WX_MAX_SEEN = 400;
  function wxLoad(key, fallback) {
    try { const v = JSON.parse(getSetting(key) || ''); return (v && typeof v === 'object') ? v : fallback; } catch { return fallback; }
  }
  function wxCleanEvent(e) { return String(e == null ? '' : e).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80); }
  function wxMutedEvents() {
    const a = wxLoad('severe_weather_muted_events', []);
    return Array.isArray(a) ? a.map(wxCleanEvent).filter(Boolean).slice(0, 100) : [];
  }
  function wxSnoozedEvents() {
    const o = wxLoad('severe_weather_snoozed_events', {});
    const now = Date.now(), out = {};
    let pruned = false;
    for (const [ev, until] of Object.entries(Array.isArray(o) ? {} : o)) {
      const name = wxCleanEvent(ev);
      if (name && Number(until) > now) out[name] = Number(until); else pruned = true;
    }
    if (pruned) setSetting('severe_weather_snoozed_events', JSON.stringify(out));
    return out;
  }
  // A banner is titled with its event type, so muting/snoozing a type can take its banners down at once.
  function wxClearBannersFor(event) {
    for (const n of [..._activeNotifications.values()]) if (n.kind === WX_KIND && n.title === event) { clearNotification(n.key); _activeWeatherAlertIds.delete(n.key); }
  }
  // The user dismissed a weather banner: remember it for the whole warning, updates included.
  function wxDismissThread(key) {
    const seen = wxLoad('severe_weather_seen', {});
    let changed = false;
    for (const rec of Object.values(seen)) if (rec && rec.key === key && !rec.dismissed) { rec.dismissed = true; changed = true; }
    if (changed) setSetting('severe_weather_seen', JSON.stringify(seen));
  }

  async function checkWeatherAlerts() {
    if (IS_DEMO || isSlave()) return;
    if (getSetting('severe_weather_alerts_enabled') !== '1') return;
    const lat = getSetting('weather_lat'), lon = getSetting('weather_lon');
    if (!lat || !lon) return;
    const minSeverity = SEVERITY_RANK[getSetting('severe_weather_min_severity') || 'Moderate'] ?? 2;
    let alerts;
    try {
      const j = await httpGetJSON(`${NWS_ALERTS_BASE}/alerts/active?point=${(+lat).toFixed(4)},${(+lon).toFixed(4)}`);
      alerts = (j && j.features) || [];
    } catch { return; } // transient NWS failure — leave existing alerts as-is, try again next poll

    const now = Date.now();
    const muted = new Set(wxMutedEvents());
    const snoozed = wxSnoozedEvents();
    const seen = wxLoad('severe_weather_seen', {});
    const history = wxLoad('severe_weather_event_history', {});
    const liveKeys = new Set();
    let seenChanged = false, historyChanged = false;

    for (const f of alerts) {
      const p = f.properties || {};
      const event = wxCleanEvent(p.event) || 'Weather Alert';
      if (history[event] !== now) { history[event] = now; historyChanged = true; }
      if ((SEVERITY_RANK[p.severity] ?? 0) < minSeverity) continue;
      if (muted.has(event) || snoozed[event]) continue;        // not wanted: never raised (a banner already up is cleared below)

      // Is this a new warning, or an update of one we already told about? An update names the messages it replaces.
      const ident = String(p.id || f.id || '');
      const refs = (Array.isArray(p.references) ? p.references : [])
        .map((r) => r && (r.identifier || r['@id'])).filter(Boolean).map(String);
      const prior = (ident && seen[ident]) || refs.map((r) => seen[r]).find((r) => r && r.event === event);
      const key = prior ? prior.key : `${WX_KIND}:${f.id}`;
      const until = Math.max(Date.parse(p.expires) || 0, Date.parse(p.ends) || 0) || (now + 24 * 3600 * 1000);
      const rec = { event, until, key, dismissed: !!(prior && prior.dismissed) };
      if (ident) {
        const old = seen[ident];
        if (!old || old.key !== rec.key || old.dismissed !== rec.dismissed || old.until !== rec.until) { seen[ident] = rec; seenChanged = true; }
      }
      if (rec.dismissed) continue;                              // dismissed once: stays dismissed through every update
      liveKeys.add(key);
      // Only the FIRST message of a warning goes to phones; an update just refreshes the banner text in place.
      raiseNotification({
        kind: WX_KIND, key,
        title: p.event || 'Weather Alert', body: p.headline || p.description || '',
        ...(prior ? { phone: false } : {}),
      });
    }

    for (const key of [..._activeWeatherAlertIds]) if (!liveKeys.has(key)) clearNotification(key);
    _activeWeatherAlertIds.clear();
    for (const key of liveKeys) _activeWeatherAlertIds.add(key);

    // housekeeping: forget finished warnings after a grace period, and event types not seen for two weeks
    for (const [id, r] of Object.entries(seen)) if (!r || (Number(r.until) || 0) + WX_SEEN_GRACE_MS < now) { delete seen[id]; seenChanged = true; }
    const ids = Object.keys(seen);
    if (ids.length > WX_MAX_SEEN) { ids.sort((x, y) => (seen[x].until || 0) - (seen[y].until || 0)).slice(0, ids.length - WX_MAX_SEEN).forEach((id) => delete seen[id]); seenChanged = true; }
    for (const [ev, t] of Object.entries(history)) if (now - Number(t) > 14 * 86400000) { delete history[ev]; historyChanged = true; }
    if (seenChanged) setSetting('severe_weather_seen', JSON.stringify(seen));
    if (historyChanged) setSetting('severe_weather_event_history', JSON.stringify(history));
  }
  setInterval(checkWeatherAlerts, 10 * 60 * 1000);
  setTimeout(checkWeatherAlerts, 25 * 1000); // stagger from checkHaAlerts' own 20s boot kick

  // The NWS event types people are likely to want to mute. Not exhaustive on purpose - anything else NWS sends shows up
  // under "seen near you" once it has actually been issued here, and can be muted from there.
  const WX_KNOWN_EVENTS = [
    'Tornado Warning', 'Tornado Watch', 'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch', 'Severe Weather Statement',
    'Flash Flood Warning', 'Flash Flood Watch', 'Flash Flood Statement', 'Flood Warning', 'Flood Watch', 'Flood Advisory', 'Flood Statement',
    'Coastal Flood Warning', 'Coastal Flood Watch', 'Coastal Flood Advisory',
    'Winter Storm Warning', 'Winter Storm Watch', 'Winter Weather Advisory', 'Blizzard Warning', 'Ice Storm Warning', 'Lake Effect Snow Warning',
    'Freeze Warning', 'Freeze Watch', 'Frost Advisory', 'Wind Chill Warning', 'Wind Chill Advisory', 'Extreme Cold Warning',
    'Excessive Heat Warning', 'Excessive Heat Watch', 'Heat Advisory', 'High Wind Warning', 'High Wind Watch', 'Wind Advisory',
    'Dense Fog Advisory', 'Dust Storm Warning', 'Red Flag Warning', 'Fire Weather Watch', 'Air Quality Alert',
    'Hurricane Warning', 'Hurricane Watch', 'Tropical Storm Warning', 'Tropical Storm Watch', 'Storm Surge Warning',
    'Special Weather Statement', 'Special Marine Warning', 'Small Craft Advisory', 'Rip Current Statement', 'Tsunami Warning',
  ];
  function wxState() {
    const snoozed = wxSnoozedEvents();
    const history = wxLoad('severe_weather_event_history', {});
    return {
      enabled: getSetting('severe_weather_alerts_enabled') === '1',
      min_severity: getSetting('severe_weather_min_severity') || 'Moderate',
      muted: wxMutedEvents(),
      snoozed,
      active: [..._activeNotifications.values()].filter((n) => n.kind === WX_KIND).map((n) => ({ key: n.key, event: n.title, since: n.firedAt })),
      recent_events: Object.entries(history).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([event, last_seen]) => ({ event, last_seen })),
      known_events: WX_KNOWN_EVENTS,
    };
  }
  app.get('/api/weather-alerts/state', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Only the host polls NWS and holds the settings; a mirror shows the host's.
    if (isSlave()) {
      const base = hostBaseURL();
      if (base) { try { return res.json(await fetchJSON(`${base}/api/weather-alerts/state`, 6000)); } catch {} }
    }
    res.json(wxState());
  });
  // Replace the list of muted event types. A muted type is never raised, whatever its severity; any banner it has up goes away.
  app.put('/api/weather-alerts/muted', (req, res) => {
    const raw = req.body && req.body.events;
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'Body must be { events: [...] }.' });
    const events = [...new Set(raw.map(wxCleanEvent).filter(Boolean))].slice(0, 100);
    setSetting('severe_weather_muted_events', JSON.stringify(events));
    for (const ev of events) wxClearBannersFor(ev);
    setTimeout(checkWeatherAlerts, 300);               // an un-muted type should show up now, not in up to 10 minutes
    res.json(wxState());
  });
  // Quiet one event type for a while (hours: 0 cancels). Keyed by TYPE, not by alert id, because NWS re-issues the same
  // warning under new ids all day - a snooze on one id would be useless.
  app.post('/api/weather-alerts/snooze', (req, res) => {
    const event = wxCleanEvent(req.body && req.body.event);
    const hours = Number(req.body && req.body.hours);
    if (!event) return res.status(400).json({ error: 'Which alert type? Send { event, hours }.' });
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) return res.status(400).json({ error: 'Hours must be between 0 (cancel) and 168.' });
    const snoozed = wxSnoozedEvents();
    if (hours === 0) delete snoozed[event]; else snoozed[event] = Date.now() + Math.round(hours * 3600 * 1000);
    setSetting('severe_weather_snoozed_events', JSON.stringify(snoozed));
    if (hours > 0) wxClearBannersFor(event);
    setTimeout(checkWeatherAlerts, 300);
    res.json(wxState());
  });
  return { wxDismissThread, checkWeatherAlerts };
};
