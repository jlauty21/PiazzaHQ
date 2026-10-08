'use strict';
// Home Assistant control over MQTT: the status route and the one-shot broker connection test for the Settings screen.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/voice-add-item.test.js.
module.exports = function registerMqttRoutes({ crypto, mqttBridge, app, getSetting }) {
  // Staged follow-up to the automation-token/REST door just above — same two
  // underlying actions (TV/monitor power, saved-layout+theme apply), reached
  // instead through the household's own MQTT broker with HA MQTT Discovery,
  // so entities just appear with no YAML. See mqtt-bridge.js for the actual
  // connection/discovery/command logic; this is just status + a one-shot
  // connection test for the Settings UI, same role /api/ha's own connection
  // check plays for the outbound integration above.
  app.get('/api/mqtt-status', (req, res) => {
    res.json({
      available: !!mqttBridge && mqttBridge.isAvailable(),
      configured: getSetting('mqtt_enabled') === '1' && !!getSetting('mqtt_broker_url'),
      connected: !!mqttBridge && mqttBridge.isConnected(),
    });
  });
  app.post('/api/mqtt/test', (req, res) => {
    let mqttLib; try { mqttLib = require('mqtt'); } catch { mqttLib = null; }
    if (!mqttLib) return res.status(503).json({ ok: false, error: 'The mqtt package isn\'t installed on this device yet — apply the latest update, then try again.' });
    const { brokerUrl, username, password } = req.body || {};
    if (!brokerUrl) return res.status(400).json({ ok: false, error: 'Broker URL is required.' });
    // A throwaway client, fully separate from the real persistent one in
    // mqtt-bridge.js — this only ever tests whatever's currently typed in the
    // form (which may not be saved yet), and always tears itself down before
    // responding, success or failure, so a test never leaks a connection
    // alongside the real one.
    let settled = false;
    const testClient = mqttLib.connect(brokerUrl, {
      username: username || undefined, password: password || undefined,
      clientId: `piazzahq_test_${crypto.randomBytes(4).toString('hex')}`,
      connectTimeout: 8000, reconnectPeriod: 0,
    });
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      try { testClient.end(true); } catch {}
      if (ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: error || 'Could not connect.' });
    };
    testClient.on('connect', () => finish(true));
    testClient.on('error', (e) => finish(false, e.message));
    setTimeout(() => finish(false, 'Connection timed out.'), 9000);
  });
};
