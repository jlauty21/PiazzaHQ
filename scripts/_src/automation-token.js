'use strict';
// Home Assistant control, automation token: generate and clear it, plus the read-only discovery lists the HA integration uses.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/tokens-and-discovery.test.js.
module.exports = function registerAutomationToken({ crypto, app, db }) {
  // Same shape as the Siri Shortcuts voice_token just above — a long-lived,
  // server-generated bearer token, stored as a normal setting, that lets an
  // external automation (Home Assistant's rest_command, or any curl-capable
  // tool) call a small, explicitly-listed set of device-control routes without
  // an interactive PIN session. See the requireAuth() exemption below for
  // exactly which routes this unlocks — deliberately narrow: TV/monitor power
  // and saved-layout apply (which also switches theme), nothing else.
  app.post('/api/automation-token/generate', (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('automation_token', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(token);
    res.json({ token });
  });
  app.delete('/api/automation-token', (req, res) => {
    db.prepare(`DELETE FROM settings WHERE key = 'automation_token'`).run();
    res.json({ ok: true });
  });

  // Read-only discovery under the same automation_token, for a client that
  // needs to find valid ids on its own (the HA custom integration's config
  // flow) rather than have them typed in by hand. Same queries mqtt-bridge.js
  // already uses for its own discovery (publishSwitches/publishSelects) —
  // deliberately reused verbatim rather than re-derived, so all three doors
  // agree on exactly what counts as "a screen with TV control" or "a saved
  // layout" without risk of drifting apart.
  app.get('/api/automation/screens', (req, res) => {
    const rows = db.prepare(`SELECT device_id, name FROM screens WHERE tv_control_type != ''`).all();
    res.json(rows);
  });
  app.get('/api/automation/displays', (req, res) => {
    const rows = db.prepare(`SELECT slug, name FROM displays ORDER BY sort_order ASC, id ASC`).all();
    res.json(rows);
  });
  app.get('/api/automation/saved-layouts', (req, res) => {
    const rows = db.prepare(`SELECT id, name FROM saved_layouts ORDER BY created_at DESC, id DESC`).all();
    res.json(rows);
  });
};
