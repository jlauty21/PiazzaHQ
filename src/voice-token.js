'use strict';
// Voice control (Siri Shortcuts): generate and clear the long-lived voice token.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/tokens-and-discovery.test.js.
module.exports = function registerVoiceToken({ crypto, app, db }) {
  // A long-lived bearer token, generated server-side (never user-typed, unlike
  // ha_token which comes from HA itself — this one needs to BE strong since
  // nothing else vouches for it), stored as a normal setting so it round-trips
  // through the existing GET/PUT /api/settings the same as everything else.
  // Generation stays behind the normal requireAuth (PIN session, or open if no
  // PIN — same as the rest of Settings) since minting a new credential is a
  // sensitive action; USING it (the actual add-item route below) authenticates
  // itself instead, since a voice automation can't do an interactive PIN login.
  app.post('/api/voice-token/generate', (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('voice_token', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(token);
    res.json({ token });
  });
  app.delete('/api/voice-token', (req, res) => {
    db.prepare(`DELETE FROM settings WHERE key = 'voice_token'`).run();
    res.json({ ok: true });
  });
};
