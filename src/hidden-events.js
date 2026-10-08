'use strict';
// Hidden events: hide one occurrence of an event (or its whole series) on the displays, and show it again.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/hidden-events.test.js.
module.exports = function registerHiddenEvents({ app, db, broadcastUpdate }) {
  app.get('/api/hidden-events', (req, res) => {
    res.json(db.prepare(`SELECT * FROM hidden_events ORDER BY created_at DESC`).all());
  });
  app.post('/api/hidden-events', (req, res) => {
    const { event_key, scope, date, title } = req.body || {};
    if (!event_key) return res.status(400).json({ error: 'event_key required' });
    const sc = scope === 'series' ? 'series' : 'occurrence';
    // For a series hide, store a single row with date = '' (PK-safe sentinel) and
    // clear any per-occurrence hides for that key to avoid redundancy.
    if (sc === 'series') {
      db.prepare(`DELETE FROM hidden_events WHERE event_key = ?`).run(event_key);
      db.prepare(`INSERT OR REPLACE INTO hidden_events (event_key, scope, date, title) VALUES (?, 'series', '', ?)`)
        .run(event_key, title || '');
    } else {
      db.prepare(`INSERT OR REPLACE INTO hidden_events (event_key, scope, date, title) VALUES (?, 'occurrence', ?, ?)`)
        .run(event_key, date || '', title || '');
    }
    broadcastUpdate('events');
    res.json({ ok: true });
  });
  app.delete('/api/hidden-events', (req, res) => {
    // Unhide: remove by event_key (+ optional date for a single occurrence).
    const { event_key, date } = req.body || {};
    if (!event_key) return res.status(400).json({ error: 'event_key required' });
    if (date !== undefined && date !== null) {
      db.prepare(`DELETE FROM hidden_events WHERE event_key = ? AND date = ?`).run(event_key, date);
    } else {
      db.prepare(`DELETE FROM hidden_events WHERE event_key = ?`).run(event_key);
    }
    broadcastUpdate('events');
    res.json({ ok: true });
  });
};
