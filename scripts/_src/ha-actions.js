'use strict';
// Home Assistant Tier 2, controlling devices: the allowed actions, the per-domain guards, and the fire-and-forget call routes.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/ha-fire-and-forget.test.js and test/unit/ha-action-guards.test.js.
module.exports = function registerHaActions({ app, getSetting, haRequestWith, haStateCache }) {
  // POST /api/ha/call-action — the client NEVER gets to specify an arbitrary HA
  // domain/service. It sends only { entityId, action, ...extra }, where action
  // is one of a small fixed whitelist decided right here — the actual HA
  // service call (domain + service name) is derived server-side from that
  // action plus the entity's own domain (parsed from its id, e.g. "light." in
  // "light.living_room"), never trusted from the request. This is deliberately
  // more conservative than just proxying whatever service name a client sends:
  // a bug or a malicious request on the client side can only ever trigger one
  // of these specific, known-safe actions, never an arbitrary HA service call.
  const HA_ACTIONS = {
    // Generic on/off/toggle — HA's own domain-agnostic services, dispatch
    // correctly for light/switch/fan/etc. without needing per-domain handling.
    turn_on:  () => ({ domain: 'homeassistant', service: 'turn_on' }),
    turn_off: () => ({ domain: 'homeassistant', service: 'turn_off' }),
    toggle:   () => ({ domain: 'homeassistant', service: 'toggle' }),
    // Climate: HA has no generic "set_temperature", it's domain-specific.
    set_temperature: () => ({ domain: 'climate', service: 'set_temperature' }),
    // Scenes/scripts don't have a generic "trigger" service either — the actual
    // convention IS <domain>.turn_on for both, so the entity's own domain
    // (parsed below, not trusted from the client) decides which.
    trigger: (domain) => ({ domain, service: 'turn_on' }),
    // Covers (garage doors, blinds, shades) and locks — domain-specific
    // services, like set_temperature. The route below rejects these unless the
    // target entity is actually of the matching domain (see DOMAIN_LOCKED_ACTIONS).
    open_cover:  () => ({ domain: 'cover', service: 'open_cover' }),
    close_cover: () => ({ domain: 'cover', service: 'close_cover' }),
    stop_cover:  () => ({ domain: 'cover', service: 'stop_cover' }),
    lock:        () => ({ domain: 'lock', service: 'lock' }),
    unlock:      () => ({ domain: 'lock', service: 'unlock' }),
    // Dimming: light.turn_on carrying brightness_pct (added to the service
    // data in the route). Same create-or-adjust semantics HA uses.
    set_brightness: () => ({ domain: 'light', service: 'turn_on' }),
    // media_player transport + volume.
    media_play_pause:     () => ({ domain: 'media_player', service: 'media_play_pause' }),
    media_next_track:     () => ({ domain: 'media_player', service: 'media_next_track' }),
    media_previous_track: () => ({ domain: 'media_player', service: 'media_previous_track' }),
    volume_set:           () => ({ domain: 'media_player', service: 'volume_set' }),
    // Fan variable speed: fan.set_percentage carrying `percentage` (added in
    // the route from fan_pct).
    set_fan_speed:        () => ({ domain: 'fan', service: 'set_percentage' }),
    // Light colour: both are light.turn_on with a colour arg added in the route.
    set_color_temp:       () => ({ domain: 'light', service: 'turn_on' }),
    set_color:            () => ({ domain: 'light', service: 'turn_on' }),
  };
  // Actions that only make sense aimed at one specific entity domain — a guard
  // so "unlock" can't be fired at a light, etc. (HA would just error, but this
  // gives a clear message and never dispatches a nonsensical call).
  const DOMAIN_LOCKED_ACTIONS = {
    open_cover: 'cover', close_cover: 'cover', stop_cover: 'cover',
    lock: 'lock', unlock: 'lock',
    set_brightness: 'light',
    media_play_pause: 'media_player', media_next_track: 'media_player',
    media_previous_track: 'media_player', volume_set: 'media_player',
    set_fan_speed: 'fan',
    set_color_temp: 'light', set_color: 'light',
  };
  // Read-only domains: no actionable service exists, so an on/off/toggle/trigger
  // aimed at one means a mis-picked entity (a sensor dropped into a switch
  // widget slot, say). HA silently no-ops the call and returns ok, which looks
  // like it worked — reject it here so the mistake is visible instead.
  const HA_READ_ONLY_DOMAINS = new Set(['sensor', 'binary_sensor', 'weather', 'sun', 'air_quality', 'zone']);
  const HA_UNTARGETED_ACTIONS = new Set(['turn_on', 'turn_off', 'toggle', 'trigger']);

  // Fire an HA service call without making the client wait for its full
  // completion. HA's REST /api/services endpoint holds the HTTP response until
  // the service action AND everything listening for the resulting state change
  // have finished — for a cover that's the whole travel time, several seconds.
  // HA's own UI doesn't feel this because it calls services over the websocket
  // API, which returns as soon as the call is scheduled. This mirrors that: we
  // wait a short window for a *fast* failure (bad token, unknown entity, HA
  // unreachable — all resolve well under it), then answer the client
  // optimistically and let the request finish in the background, logging only a
  // genuine late failure. A generous ceiling still bounds the background request
  // (covers the old 8s timeout being too short for a slow cover, without
  // letting it hang forever).
  const HA_ACTION_SOFT_ACK_MS = 1500;
  const HA_ACTION_HARD_TIMEOUT_MS = 35000;
  async function fireHaServiceCall(servicePath, body, onSettle) {
    const call = haRequestWith(
      getSetting('ha_base_url'), getSetting('ha_token'),
      servicePath, 'POST', body, { timeoutMs: HA_ACTION_HARD_TIMEOUT_MS },
    );
    let settled = null; // null = still running, 'ok' = done, Error-ish = failed
    call.then(
      () => { settled = 'ok'; try { onSettle(); } catch {} },
      (e) => { settled = e || new Error('failed'); console.warn(`HA ${servicePath} did not complete cleanly: ${(e && e.message) || e}`); },
    );
    await new Promise(r => setTimeout(r, HA_ACTION_SOFT_ACK_MS));
    if (settled && settled !== 'ok') {
      const err = new Error(settled.message || 'Home Assistant rejected the command');
      err.status = settled.status || 502;
      throw err;
    }
    // Drop the cached state now too, so the client's follow-up poll (~700ms
    // later) reads fresh rather than the stale pre-action value.
    try { onSettle(); } catch {}
    return { ok: true, pending: settled !== 'ok' };
  }

  app.post('/api/ha/call-action', async (req, res) => {
    const { entityId, action, temperature } = req.body || {};
    if (!entityId || typeof entityId !== 'string' || !entityId.includes('.')) {
      return res.status(400).json({ error: 'Missing or invalid entityId.' });
    }
    if (!Object.prototype.hasOwnProperty.call(HA_ACTIONS, action)) {
      return res.status(400).json({ error: `Unknown action "${action}".` });
    }
    const domain = entityId.split('.')[0];
    if (DOMAIN_LOCKED_ACTIONS[action] && domain !== DOMAIN_LOCKED_ACTIONS[action]) {
      return res.status(400).json({ error: `"${action}" is only valid for ${DOMAIN_LOCKED_ACTIONS[action]} entities.` });
    }
    if (HA_UNTARGETED_ACTIONS.has(action) && HA_READ_ONLY_DOMAINS.has(domain)) {
      return res.status(400).json({ error: `${domain} entities are read-only — no on/off/toggle control.` });
    }
    const { domain: svcDomain, service } = HA_ACTIONS[action](domain);
    const data = { entity_id: entityId };
    if (action === 'set_temperature') {
      const t = Number(temperature);
      if (!Number.isFinite(t)) return res.status(400).json({ error: 'set_temperature needs a numeric temperature.' });
      data.temperature = t;
    }
    if (action === 'set_brightness') {
      const p = Number(req.body && req.body.brightness_pct);
      if (!Number.isFinite(p) || p < 1 || p > 100) return res.status(400).json({ error: 'set_brightness needs brightness_pct between 1 and 100.' });
      data.brightness_pct = Math.round(p);
    }
    if (action === 'volume_set') {
      const v = Number(req.body && req.body.volume_pct);
      if (!Number.isFinite(v) || v < 0 || v > 100) return res.status(400).json({ error: 'volume_set needs volume_pct between 0 and 100.' });
      data.volume_level = Math.round(v) / 100;
    }
    if (action === 'set_fan_speed') {
      const p = Number(req.body && req.body.fan_pct);
      if (!Number.isFinite(p) || p < 1 || p > 100) return res.status(400).json({ error: 'set_fan_speed needs fan_pct between 1 and 100.' });
      data.percentage = Math.round(p);
    }
    if (action === 'set_color_temp') {
      const k = Number(req.body && req.body.kelvin);
      if (!Number.isFinite(k) || k < 1000 || k > 10000) return res.status(400).json({ error: 'set_color_temp needs kelvin between 1000 and 10000.' });
      data.color_temp_kelvin = Math.round(k);
    }
    if (action === 'set_color') {
      const parts = String((req.body && req.body.rgb) || '').split(',').map(n => parseInt(n, 10));
      if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n < 0 || n > 255)) {
        return res.status(400).json({ error: 'set_color needs rgb as "r,g,b" with each 0-255.' });
      }
      data.rgb_color = parts;
    }
    try {
      // Fire-and-forget: reply as soon as HA accepts the call (or a fast error
      // comes back), not after the cover/lock/etc. physically finishes. The
      // cache drop lets the next /api/ha/state/:entityId poll (a few seconds
      // out, not the full 10s window) reflect the real new state.
      const out = await fireHaServiceCall(`/api/services/${svcDomain}/${service}`, data, () => haStateCache.delete(entityId));
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // POST /api/ha/call-group-action — for the Group Control widget (turn a
  // whole set of entities on/off with one tap, e.g. "turn a whole floor
  // off"). Deliberately a SEPARATE endpoint from call-action above rather than
  // letting entityId also accept an array there: only turn_on/turn_off are
  // allowed here, NOT toggle — HA's own toggle service, given multiple
  // entity_ids, toggles each one independently based on its OWN current
  // state, which is wrong for a group tile (a mixed on/off group would end up
  // with the on ones turning off and the off ones turning on, the opposite of
  // "one clear group action"). The client already has every member's current
  // state loaded (it's rendering the tile from it), so it decides the target
  // action itself — if anything in the group is on, send turn_off; only if
  // everything is off does it send turn_on — and this endpoint just executes
  // whichever one it's told, the same restrained "client decides, server
  // only ever runs one of a few known-safe things" split already used by
  // call-action above. One real HA service call with entity_id as an array,
  // not N separate calls — turn_on/turn_off are HA's domain-agnostic
  // dispatch services, so a group spanning light/switch/fan entities in one
  // call is normal, supported usage, not a hack.
  app.post('/api/ha/call-group-action', async (req, res) => {
    const { entityIds, action } = req.body || {};
    if (!Array.isArray(entityIds) || !entityIds.length || entityIds.some(id => typeof id !== 'string' || !id.includes('.'))) {
      return res.status(400).json({ error: 'entityIds must be a non-empty array of valid entity ids.' });
    }
    if (action !== 'turn_on' && action !== 'turn_off') {
      return res.status(400).json({ error: `Unsupported group action "${action}" — only turn_on/turn_off are allowed here.` });
    }
    try {
      // Same fire-and-forget treatment as call-action — a group turn_on/off
      // spanning several entities can take HA a moment to fully settle.
      const out = await fireHaServiceCall(`/api/services/homeassistant/${action}`, { entity_id: entityIds }, () => entityIds.forEach(id => haStateCache.delete(id)));
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
};
