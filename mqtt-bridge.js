// mqtt-bridge.js — Home Assistant control, MQTT direction (staged follow-up
// to the REST/automation-token door — see Settings → Home Assistant Control
// and CHANGELOG 1.89.0-beta.22). Same underlying actions as that REST path
// (TV/monitor power, saved-layout + theme apply), reached instead through
// the household's own MQTT broker with Home Assistant MQTT Discovery, so
// entities just appear in HA with no YAML and no token to manage.
//
// Deliberately thin: this module owns the MQTT connection, discovery
// payloads, and command-topic parsing — never DB access or the actual
// device-control logic, both of which stay exactly where they already live
// in server.js (runTvAction, applySavedLayoutToDisplay). Host-only; a
// mirror never opens its own broker connection (see server.js's isSlave()
// guard on start()) — same reasoning as runTvAction's own proxy-to-host
// design: the host already knows how to reach every screen in the
// household, a mirror doesn't need a second, competing connection to do it
// again.
//
// Optional dependency, same defensive pattern as tv-control.js's `ws` (for
// Samsung) — never installed unless MQTT is actually turned on, and on
// Windows this HAS to already be in the bundled node_modules at build time
// (self-update skips npm install there entirely — see its own comment in
// server.js). Absent = the feature silently does nothing rather than
// crashing the server.
let mqtt;
try { mqtt = require('mqtt'); } catch { mqtt = null; }

let client = null;
let connected = false;
let ctx = null; // injected by start(): { db, getSetting, runTvAction, applySavedLayoutToDisplay, log, deviceId }
let discoveryTimer = null;

const AVAILABILITY_TOPIC = 'piazzahq/bridge/status';
const DISCOVERY_PREFIX_DEFAULT = 'homeassistant';

// Required by Home Assistant's MQTT discovery schema — found live: without
// this, HA silently drops the discovery message entirely (no error, no log
// line at default verbosity) rather than rejecting it visibly. Confirmed
// against a real HA 2026.8.1 instance: identical payloads with this field
// added were the only change needed to make entities actually appear.
function originInfo() {
  return { name: 'Piazza HQ', sw_version: ctx.appVersion || '', support_url: 'https://piazzahq.com' };
}

function isConnected() { return connected; }

function stop() {
  if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
  if (client) {
    try { client.end(true); } catch {} // true = force-close, don't wait on in-flight publishes
    client = null;
  }
  connected = false;
}

// Re-entrant: settings changed, or the app is just booting — either way,
// tear down any existing connection first rather than accumulating a second
// one alongside it (a real risk here, since this can be called from a
// PUT /api/settings handler that might run more than once in quick
// succession if someone's actively editing the broker fields).
function start(context) {
  ctx = context;
  stop();
  if (!mqtt) { ctx.log('mqtt-bridge: mqtt package not installed — MQTT control unavailable until the next update.'); return; }
  const brokerUrl = (ctx.getSetting('mqtt_broker_url') || '').trim();
  if (ctx.getSetting('mqtt_enabled') !== '1' || !brokerUrl) return; // not configured — silently idle, not an error

  const username = ctx.getSetting('mqtt_username') || undefined;
  const password = ctx.getSetting('mqtt_password') || undefined;
  client = mqtt.connect(brokerUrl, {
    username, password,
    clientId: `piazzahq_${ctx.deviceId}`,
    reconnectPeriod: 10000,
    connectTimeout: 15000,
    will: { topic: AVAILABILITY_TOPIC, payload: 'offline', qos: 1, retain: true },
  });

  client.on('connect', () => {
    connected = true;
    ctx.log('mqtt-bridge: connected to ' + brokerUrl);
    client.publish(AVAILABILITY_TOPIC, 'online', { qos: 1, retain: true });
    publishDiscovery();
    subscribeCommands();
    // Republish periodically too, not just on connect — catches a screen
    // renamed, added, or removed without requiring a broker/HA restart to
    // pick it up. 10 minutes is a deliberate trade for simplicity over
    // hooking every single mutation site that could affect entity naming;
    // see this file's header comment.
    if (discoveryTimer) clearInterval(discoveryTimer);
    discoveryTimer = setInterval(publishDiscovery, 10 * 60 * 1000);
  });
  client.on('reconnect', () => { connected = false; });
  client.on('close', () => { connected = false; });
  client.on('error', (e) => { ctx.log('mqtt-bridge error: ' + (e && e.message || e)); });
  client.on('message', handleMessage);
}

function discoveryPrefix() {
  return (ctx.getSetting('mqtt_discovery_prefix') || DISCOVERY_PREFIX_DEFAULT).trim() || DISCOVERY_PREFIX_DEFAULT;
}

// One MQTT Discovery `switch` per screen that actually has TV control
// configured (tv_control_type != '') — no point publishing a power toggle
// for a screen nothing's wired to drive. Optimistic (no state_topic): none
// of the tv-control.js drivers can reliably report real power state either
// (Samsung's own comment there is explicit that it can't — one toggle
// button, no query), so this doesn't claim precision the REST path
// (Settings → Home Assistant Control) doesn't have either; same honest
// limitation, just with auto-discovery on top.
function publishSwitches() {
  const screens = ctx.db.prepare(`SELECT device_id, name, tv_control_type FROM screens WHERE tv_control_type != ''`).all();
  for (const s of screens) {
    const objectId = `piazzahq_${s.device_id}_power`;
    const topic = `${discoveryPrefix()}/switch/${objectId}/config`;
    const payload = {
      name: 'Power',
      unique_id: objectId,
      command_topic: `piazzahq/${s.device_id}/tv/set`,
      payload_on: 'ON',
      payload_off: 'OFF',
      optimistic: true,
      availability_topic: AVAILABILITY_TOPIC,
      origin: originInfo(),
      device: {
        identifiers: [`piazzahq_screen_${s.device_id}`],
        name: s.name || 'Piazza HQ Screen',
        manufacturer: 'Piazza HQ',
        model: 'Wall Display',
      },
    };
    client.publish(topic, JSON.stringify(payload), { qos: 1, retain: true });
  }
  return screens.map(s => s.device_id);
}

// One MQTT Discovery `select` per display PROFILE (not per physical screen
// — a saved layout applies to a profile, which one or more screens can be
// showing; see applySavedLayoutToDisplay's own comment in server.js),
// options = every saved layout's name. Also optimistic: there's no stored
// link from "a display's current widgets" back to "which saved layout that
// came from" (someone could hand-edit the layout afterward anyway), so
// truthfully reporting current selection isn't possible — same as the
// REST path's own equivalent limitation.
function publishSelects() {
  const displays = ctx.db.prepare(`SELECT id, name, slug FROM displays`).all();
  const layouts = ctx.db.prepare(`SELECT id, name FROM saved_layouts ORDER BY created_at DESC, id DESC`).all();
  if (!layouts.length) return []; // nothing to select FROM yet — skip publishing an empty-options select, which HA rejects anyway
  const options = layouts.map(l => l.name);
  for (const d of displays) {
    const objectId = `piazzahq_display_${d.id}_layout`;
    const topic = `${discoveryPrefix()}/select/${objectId}/config`;
    const payload = {
      name: 'Layout',
      unique_id: objectId,
      command_topic: `piazzahq/display/${d.id}/layout/set`,
      options,
      optimistic: true,
      availability_topic: AVAILABILITY_TOPIC,
      origin: originInfo(),
      device: {
        identifiers: [`piazzahq_display_${d.id}`],
        name: d.name || d.slug,
        manufacturer: 'Piazza HQ',
        model: 'Display Profile',
      },
    };
    client.publish(topic, JSON.stringify(payload), { qos: 1, retain: true });
  }
  return displays.map(d => d.id);
}

function publishDiscovery() {
  if (!client || !connected) return;
  try {
    publishSwitches();
    publishSelects();
  } catch (e) {
    ctx.log('mqtt-bridge: discovery publish failed — ' + e.message);
  }
}

function subscribeCommands() {
  client.subscribe('piazzahq/+/tv/set', { qos: 1 });
  client.subscribe('piazzahq/display/+/layout/set', { qos: 1 });
}

async function handleMessage(topic, payloadBuf) {
  const payload = payloadBuf.toString().trim();
  const tvMatch = topic.match(/^piazzahq\/([^/]+)\/tv\/set$/);
  if (tvMatch) {
    const deviceId = tvMatch[1];
    const action = payload.toUpperCase() === 'ON' ? 'power-on' : payload.toUpperCase() === 'OFF' ? 'power-off' : null;
    if (!action) { ctx.log(`mqtt-bridge: ignoring unrecognized TV payload "${payload}" on ${topic}`); return; }
    try {
      await ctx.runTvAction(deviceId, action);
    } catch (e) {
      ctx.log(`mqtt-bridge: TV action failed for ${deviceId}: ${e.message}`);
    }
    return;
  }
  const layoutMatch = topic.match(/^piazzahq\/display\/([^/]+)\/layout\/set$/);
  if (layoutMatch) {
    const displayId = layoutMatch[1];
    // The select's command payload is the layout's NAME (that's what HA's
    // MQTT select sends back — one of the `options` strings verbatim), so
    // it has to be resolved to an id here. Names aren't DB-enforced unique
    // (see saved_layouts' own schema comment); this takes the most
    // recently created match, same tie-break saved_layouts listings
    // already sort by — a documented, not silent, choice.
    const preset = ctx.db.prepare(`SELECT id FROM saved_layouts WHERE name = ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(payload);
    if (!preset) { ctx.log(`mqtt-bridge: no saved layout named "${payload}" (from ${topic})`); return; }
    const result = ctx.applySavedLayoutToDisplay(preset.id, displayId);
    if (!result.ok) ctx.log(`mqtt-bridge: layout apply failed — ${result.error}`);
    return;
  }
}

module.exports = { start, stop, isConnected, isAvailable: () => !!mqtt };
