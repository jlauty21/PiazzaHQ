'use strict';
// Home Assistant areas (WebSocket-only) plus the cached single-entity state and history routes.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/ha-read.test.js.
module.exports = function registerHaAreas({ URL, WebSocketClient, app, getSetting, haRequest }) {
  // HA's REST API (what haRequest()/haRequestWith() above use for everything
  // else) has no endpoint for the area/entity/device registries — genuinely
  // not there, confirmed against HA's own docs and a still-open community
  // feature request for exactly this. The ONLY way to get "which area is
  // entity X actually in" is HA's WebSocket API. This is a one-shot
  // connection (auth, ask for what we need, close) rather than a persistent
  // one — area assignments change rarely enough that the short cache below is
  // far simpler than keeping a live socket open for the life of the process.
  //
  // Resolving an entity's EFFECTIVE area takes two lookups, not one: HA lets
  // an entity either have its own direct area_id, OR inherit one from its
  // device (most entities go this route — a device gets placed in a room, and
  // every entity that device exposes inherits that placement unless
  // individually overridden). Skipping the device fallback would leave most
  // real installs showing almost nothing grouped, since a direct per-entity
  // area_id is the less common case in practice.
  function haWsRequest(baseUrl, token, commandTypes) {
    return new Promise((resolve, reject) => {
      if (!WebSocketClient) return reject({ status: 500, message: 'The "ws" module isn\'t installed on this device yet — apply the latest update, then try again.' });
      if (!baseUrl || !token) return reject({ status: 400, message: 'Home Assistant isn\'t configured yet — add a URL and token in Settings' });
      let wsUrl;
      try {
        const u = new URL(baseUrl.replace(/\/+$/, ''));
        wsUrl = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/api/websocket`;
      } catch { return reject({ status: 400, message: 'Invalid Home Assistant URL' }); }

      let sock;
      try { sock = new WebSocketClient(wsUrl); }
      catch (e) { return reject({ status: 502, message: `Could not reach Home Assistant: ${e.message}` }); }

      const results = {};
      const pending = new Map(); // request id -> command type, so a result can be routed back to the right key
      let nextId = 1;
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { sock.terminate(); } catch {}
        reject({ status: 502, message: 'Home Assistant WebSocket request timed out' });
      }, 8000);
      const finish = (err, val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { sock.close(); } catch {}
        if (err) reject(err); else resolve(val);
      };
      sock.on('error', (err) => finish({ status: 502, message: `Could not reach Home Assistant: ${err.message}` }));
      sock.on('close', () => finish({ status: 502, message: 'Home Assistant closed the connection unexpectedly' }));
      sock.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'auth_required') {
          sock.send(JSON.stringify({ type: 'auth', access_token: token }));
        } else if (msg.type === 'auth_invalid') {
          finish({ status: 401, message: 'Home Assistant rejected the token — check it\'s still valid' });
        } else if (msg.type === 'auth_ok') {
          commandTypes.forEach(type => {
            const id = nextId++;
            pending.set(id, type);
            sock.send(JSON.stringify({ id, type }));
          });
        } else if (msg.type === 'result' && pending.has(msg.id)) {
          const type = pending.get(msg.id);
          pending.delete(msg.id);
          // Best-effort per-command: a single registry query failing (unlikely,
          // but e.g. a permissions issue on an unusually locked-down token)
          // degrades that one piece to "nothing found" rather than failing the
          // whole areas feature outright.
          results[type] = msg.success ? msg.result : [];
          if (pending.size === 0) finish(null, results);
        }
      });
    });
  }

  // GET /api/ha/areas — real Home Assistant areas, plus which area each
  // entity effectively belongs to (direct assignment, or inherited from its
  // device). Cached for 5 minutes — area layout changes rarely, and every
  // open of an entity picker shouldn't cost a fresh WebSocket round-trip.
  let haAreasCache = null; // { data, fetchedAt }
  const HA_AREAS_CACHE_MS = 5 * 60 * 1000;
  app.get('/api/ha/areas', async (req, res) => {
    if (haAreasCache && (Date.now() - haAreasCache.fetchedAt) < HA_AREAS_CACHE_MS) {
      return res.json(haAreasCache.data);
    }
    try {
      const results = await haWsRequest(getSetting('ha_base_url'), getSetting('ha_token'), [
        'config/area_registry/list',
        'config/device_registry/list',
        'config/entity_registry/list',
      ]);
      const areas = (results['config/area_registry/list'] || [])
        .map(a => ({ id: a.area_id, name: a.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const deviceArea = new Map(); // device_id -> area_id
      (results['config/device_registry/list'] || []).forEach(d => { if (d.area_id) deviceArea.set(d.id, d.area_id); });
      const entityAreas = {}; // entity_id -> area_id
      (results['config/entity_registry/list'] || []).forEach(e => {
        const areaId = e.area_id || (e.device_id ? deviceArea.get(e.device_id) : null);
        if (areaId) entityAreas[e.entity_id] = areaId;
      });
      const data = { areas, entityAreas };
      haAreasCache = { data, fetchedAt: Date.now() };
      res.json(data);
    } catch (e) {
      // Degrade gracefully rather than break the picker: an old HA version, a
      // locked-down token, or ws being unavailable (see WebSocketClient guard
      // above) all mean "no area data available," not "the picker is broken" —
      // the entity list itself still comes from the REST endpoint either way.
      res.status(e.status || 500).json({ error: e.message, areas: [], entityAreas: {} });
    }
  });

  // GET /api/ha/entity-details/:entityId — one entity with its attributes, for the Template helper's "Inspect" (what can I show from this device?). Unlike the
  // state route below this is NOT on the public list: it needs the app's own login when a PIN is set. Attributes that could carry a secret or a location are
  // left out (tokens, passwords, picture/stream addresses, coordinates, network addresses), only plain values are kept (a short list is joined with commas),
  // and there is a cap on how many and how long.
  const ATTR_SKIP = /token|password|passwd|secret|credential|entity_picture|stream|url$|ip_address|mac_address|latitude|longitude|gps|ssid|serial/i;
  app.get('/api/ha/entity-details/:entityId', async (req, res) => {
    const id = String(req.params.entityId || '');
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(id)) return res.status(400).json({ error: 'That is not a device id.' });
    try {
      const e = await haRequest('/api/states/' + encodeURIComponent(id));
      const plain = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
      const attributes = {};
      let n = 0;
      for (const [k, v] of Object.entries(e.attributes || {})) {
        if (n >= 60) break;
        if (ATTR_SKIP.test(k)) continue;
        let val = v;
        if (!plain(val)) {
          if (Array.isArray(val) && val.length <= 8 && val.every(plain)) val = val.join(', ');
          else continue;
        }
        attributes[k] = typeof val === 'string' ? val.slice(0, 200) : val;
        n++;
      }
      res.json({ entity_id: e.entity_id, state: e.state, last_changed: e.last_changed || '', attributes });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // GET /api/ha/state/:entityId — one entity's current value, for the widget
  // itself. Cached briefly (10s) since multiple displays (or multiple widgets
  // showing the same entity) polling independently could otherwise add up to a
  // lot of requests against someone's home server for data that barely changes
  // that fast.
  const haStateCache = new Map(); // entity_id -> { data, fetchedAt }
  // 4s — short enough that a change made elsewhere (the HA app, an automation)
  // shows on the wall within a few seconds, still long enough to absorb the
  // overlap when several displays poll the same entity. Cleared outright after
  // an action so a tap's confirm read is always live.
  const HA_STATE_CACHE_MS = 4_000;
  // POST /api/ha/refresh/:entityId — ask Home Assistant to poll the device now (homeassistant.update_entity) and answer with its state. A device Home Assistant polls (a Vizio TV is looked at about
  // every 30 seconds) can be on while Home Assistant still says off; the tablet's routines look here before deciding whether a "turn on" or "turn off" is needed. If the refresh fails the
  // state Home Assistant already has is answered. { entity_id, state, source }.
  app.post('/api/ha/refresh/:entityId', async (req, res) => {
    const id = String(req.params.entityId || '');
    if (!/^[a-z_]+\.[a-zA-Z0-9_]+$/.test(id)) return res.status(400).json({ error: 'That is not a device.' });
    try { await haRequest('/api/services/homeassistant/update_entity', 'POST', { entity_id: id }, { timeoutMs: 6000 }); } catch { /* answer with what is known */ }
    haStateCache.delete(id);
    try {
      const e = await haRequest('/api/states/' + encodeURIComponent(id));
      const attrs = e.attributes || {};
      res.json({ entity_id: e.entity_id, state: e.state, friendly_name: attrs.friendly_name || e.entity_id, source: attrs.source ? String(attrs.source) : undefined });
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });
  app.get('/api/ha/state/:entityId', async (req, res) => {
    const id = req.params.entityId;
    const cached = haStateCache.get(id);
    if (cached && (Date.now() - cached.fetchedAt) < HA_STATE_CACHE_MS) {
      return res.json(cached.data);
    }
    try {
      const e = await haRequest(`/api/states/${encodeURIComponent(id)}`);
      const attrs = e.attributes || {};
      const trimmed = {
        entity_id: e.entity_id,
        state: e.state,
        friendly_name: attrs.friendly_name || e.entity_id,
        unit: attrs.unit_of_measurement || '',
      };
      // When the state last changed (ISO) — for the Entity Status widget's optional "time in this state" line. Only when HA says.
      if (e.last_changed) trimmed.changed = e.last_changed;
      // Climate-specific extras, only included when actually present (a light
      // or switch entity simply won't have these fields, so this stays a no-op
      // trim for every domain except climate) — needed by the thermostat
      // stepper UI to know the current target, the live sensed temperature,
      // and the safe range/step to move it in. Never trust a client-supplied
      // range instead of what HA itself reports for this specific device.
      if (attrs.temperature !== undefined) trimmed.targetTemp = attrs.temperature;
      if (attrs.current_temperature !== undefined) trimmed.currentTemp = attrs.current_temperature;
      if (attrs.min_temp !== undefined) trimmed.minTemp = attrs.min_temp;
      if (attrs.max_temp !== undefined) trimmed.maxTemp = attrs.max_temp;
      if (attrs.target_temp_step !== undefined) trimmed.tempStep = attrs.target_temp_step;
      // Thermostat modes and what it is doing right now (heating, cooling, idle), and a media player's artist, for the tablet's full control panels.
      if (Array.isArray(attrs.hvac_modes)) trimmed.hvacModes = attrs.hvac_modes.map(String).slice(0, 10);
      if (attrs.hvac_action) trimmed.hvacAction = String(attrs.hvac_action);
      if (attrs.media_artist) trimmed.mediaArtist = String(attrs.media_artist);
      // Light brightness (0-255) for the dimmer slider — only present on a
      // dimmable light that's currently on, a no-op trim for everything else.
      if (attrs.brightness !== undefined && attrs.brightness !== null) trimmed.brightness = attrs.brightness;
      // Light color: temp (kelvin) + range for the warm/cool slider, and the
      // supported modes so the client knows whether to offer temp / swatches.
      if (attrs.color_temp_kelvin !== undefined && attrs.color_temp_kelvin !== null) trimmed.colorTempK = attrs.color_temp_kelvin;
      if (attrs.min_color_temp_kelvin !== undefined) trimmed.minColorTempK = attrs.min_color_temp_kelvin;
      if (attrs.max_color_temp_kelvin !== undefined) trimmed.maxColorTempK = attrs.max_color_temp_kelvin;
      if (Array.isArray(attrs.supported_color_modes)) trimmed.colorModes = attrs.supported_color_modes;
      if (Array.isArray(attrs.rgb_color)) trimmed.rgbColor = attrs.rgb_color;
      // media_player extras for the transport + volume controls.
      if (attrs.media_title !== undefined && attrs.media_title !== null) trimmed.mediaTitle = String(attrs.media_title);
      if (attrs.volume_level !== undefined && attrs.volume_level !== null) trimmed.volumeLevel = attrs.volume_level;
      if (attrs.is_volume_muted !== undefined) trimmed.volumeMuted = !!attrs.is_volume_muted;
      // The inputs a media player offers (a TV's HDMI ports, apps) and the one it is on, and the choices of a dropdown helper (input_select, select), for the tablet's "switch input" step.
      // A TV that is switched off often reports no list at all; the editor then lets the person type the name.
      if (Array.isArray(attrs.source_list)) trimmed.sourceList = attrs.source_list.map(String).slice(0, 60);
      if (attrs.source) trimmed.source = String(attrs.source);
      if (Array.isArray(attrs.options)) trimmed.options = attrs.options.map(String).slice(0, 60);
      // A robot vacuum's battery, an update's versions, a number's range, a humidifier's target, and the kind of code an alarm panel wants (number or text), for the tablet's control panels.
      if (attrs.battery_level !== undefined && attrs.battery_level !== null) trimmed.battery = attrs.battery_level;
      if (attrs.installed_version) trimmed.installedVersion = String(attrs.installed_version).slice(0, 60);
      if (attrs.latest_version) trimmed.latestVersion = String(attrs.latest_version).slice(0, 60);
      if (attrs.title) trimmed.updateTitle = String(attrs.title).slice(0, 80);
      if (attrs.release_summary) trimmed.releaseSummary = String(attrs.release_summary).slice(0, 300);
      if (attrs.min !== undefined && attrs.max !== undefined) { trimmed.numMin = attrs.min; trimmed.numMax = attrs.max; if (attrs.step !== undefined) trimmed.numStep = attrs.step; }
      if (attrs.humidity !== undefined && attrs.humidity !== null) trimmed.targetHumidity = attrs.humidity;
      if (attrs.current_humidity !== undefined && attrs.current_humidity !== null) trimmed.currentHumidity = attrs.current_humidity;
      if (attrs.min_humidity !== undefined) trimmed.minHumidity = attrs.min_humidity;
      if (attrs.max_humidity !== undefined) trimmed.maxHumidity = attrs.max_humidity;
      if (attrs.code_format) trimmed.codeFormat = String(attrs.code_format);
      // Fan speed (0-100) for the speed slider — only on a variable-speed fan.
      if (attrs.percentage !== undefined && attrs.percentage !== null) trimmed.fanPercentage = attrs.percentage;
      haStateCache.set(id, { data: trimmed, fetchedAt: Date.now() });
      res.json(trimmed);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // POST /api/ha/template  { template }  ->  { text } or { error }
  // Entity Status "Template": the household writes a Home Assistant template ({{ states('sensor.washer') | title }} ...) and the widget shows what Home
  // Assistant itself makes of it, so anything a Home Assistant card can say can be said here without a new widget option for each variation. Rendering
  // is Home Assistant's own (POST /api/template with the saved token); this only validates the input, shares one answer between widgets and displays
  // polling at the same time (a few seconds), and caps the size of what goes in and comes out. Read-only: a template cannot call a service.
  const TEMPLATE_MAX_IN = 2000, TEMPLATE_MAX_OUT = 1000, TEMPLATE_CACHE_MS = 5000, TEMPLATE_CACHE_MAX = 100;
  const templateCache = new Map();   // template text -> { at, promise }
  app.post('/api/ha/template', async (req, res) => {
    const template = String((req.body && req.body.template) || '').trim();
    if (!template) return res.status(400).json({ error: 'Write a template first.' });
    if (template.length > TEMPLATE_MAX_IN) return res.status(400).json({ error: 'That template is too long (' + TEMPLATE_MAX_IN + ' characters at most).' });
    const now = Date.now();
    let hit = templateCache.get(template);
    if (!hit || now - hit.at > TEMPLATE_CACHE_MS) {
      if (templateCache.size >= TEMPLATE_CACHE_MAX) { for (const [k, v] of templateCache) if (now - v.at > TEMPLATE_CACHE_MS) templateCache.delete(k); if (templateCache.size >= TEMPLATE_CACHE_MAX) templateCache.delete(templateCache.keys().next().value); }
      hit = { at: now, promise: haRequest('/api/template', 'POST', { template }, { textBody: true, timeoutMs: 8000 }) };
      templateCache.set(template, hit);
      hit.promise.catch(() => { if (templateCache.get(template) === hit) templateCache.delete(template); });   // do not keep a failure
    }
    try {
      const out = await hit.promise;
      let text = String(out == null ? '' : out).trim();
      if (text.length > TEMPLATE_MAX_OUT) text = text.slice(0, TEMPLATE_MAX_OUT) + '…';
      res.json({ text });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Could not render the template' });
    }
  });

  // Recent numeric history for one entity, for the Entity Status widget's
  // sparkline. History is heavier than a state poll, so it's cached longer and
  // downsampled server-side. Returns { points: [{t, v}] } (t = epoch ms).
  const haHistoryCache = new Map(); // key `${id}|${hours}` -> { data, fetchedAt }
  const HA_HISTORY_CACHE_MS = 5 * 60 * 1000;
  app.get('/api/ha/history/:entityId', async (req, res) => {
    const id = req.params.entityId;
    let hours = parseInt(req.query.hours, 10);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) hours = 24;
    const key = `${id}|${hours}`;
    const cached = haHistoryCache.get(key);
    if (cached && (Date.now() - cached.fetchedAt) < HA_HISTORY_CACHE_MS) return res.json(cached.data);
    try {
      const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const raw = await haRequest(`/api/history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(id)}&minimal_response&no_attributes&significant_changes_only`);
      const series = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : [];
      let points = [];
      for (const p of series) {
        const v = parseFloat(p.state);
        if (!Number.isFinite(v)) continue; // skip 'unavailable'/'unknown'/text
        const t = Date.parse(p.last_changed || p.last_updated || '');
        if (!Number.isFinite(t)) continue;
        points.push({ t, v });
      }
      // Downsample to at most ~100 points so the payload + the SVG stay small.
      const MAX = 100;
      if (points.length > MAX) {
        const step = points.length / MAX;
        const out = [];
        for (let i = 0; i < MAX; i++) out.push(points[Math.floor(i * step)]);
        out.push(points[points.length - 1]);
        points = out;
      }
      const data = { points, hours };
      haHistoryCache.set(key, { data, fetchedAt: Date.now() });
      res.json(data);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
  return { haWsRequest, haStateCache };
};
