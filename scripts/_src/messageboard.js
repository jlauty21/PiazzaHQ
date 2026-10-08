'use strict';
// Family message board: short notes for the wall widget and the Family Hub (post, list, pin/edit, delete, the 60-note cap and the auto-clear sweep).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/messageboard.test.js.
module.exports = function registerMessageBoard({ app, db, isSlave, getSetting, demoCleanText, coerceOwnerProfileId, broadcastUpdate }) {
  // Short notes shown on the wall (the "messageboard" widget) and managed from
  // the app's Family Hub. See the `messages` table comment. Syncs host->slave
  // like profiles/events; on a slave these mutating routes proxy to the host
  // (not in slaveWriteGuard's local-only allowlist).

  const MESSAGE_MAX_NOTES = 60; // cap the board; over this, the oldest UNPINNED note is dropped on insert
  // Delete notes older than settings.messageboard_autoclear_days (pinned notes
  // exempt; '0' = never). Cheap; runs at boot, on every GET /api/messages, and
  // hourly. Host-only — a slave mirrors the host's table wholesale.
  function sweepMessages() {
    if (isSlave()) return;
    const days = parseInt(getSetting('messageboard_autoclear_days'), 10);
    if (!Number.isFinite(days) || days <= 0) return;
    db.prepare(`DELETE FROM messages WHERE pinned = 0 AND created_at < datetime('now', ?)`).run(`-${days} days`);
  }
  try { sweepMessages(); } catch {}
  setInterval(() => { try { sweepMessages(); } catch {} }, 60 * 60 * 1000);

  app.get('/api/messages', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { sweepMessages(); } catch {}
    res.json(db.prepare(`SELECT * FROM messages ORDER BY pinned DESC, created_at DESC, id DESC`).all());
  });

  app.post('/api/messages', (req, res) => {
    const b = req.body || {};
    const text = demoCleanText((b.text || '').toString().slice(0, 280), 280).trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const author = demoCleanText((b.author || '').toString().slice(0, 40), 40).trim();
    const color = /^#[0-9a-fA-F]{3,8}$/.test(b.color || '') ? b.color : '#4A90D9';
    const authorProfileId = coerceOwnerProfileId(b.author_profile_id);
    const result = db.prepare(
      `INSERT INTO messages (text, author, author_profile_id, color) VALUES (?, ?, ?, ?)`
    ).run(text, author, authorProfileId, color);
    // Trim to the cap — keep pinned + the newest, drop the rest.
    db.prepare(`
    DELETE FROM messages WHERE pinned = 0 AND id NOT IN (
      SELECT id FROM messages ORDER BY pinned DESC, created_at DESC, id DESC LIMIT ?
    )`).run(MESSAGE_MAX_NOTES);
    broadcastUpdate('messages');
    res.status(201).json(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(result.lastInsertRowid));
  });

  app.put('/api/messages/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (b.pinned !== undefined) { sets.push('pinned=?'); vals.push(b.pinned ? 1 : 0); }
    if (b.text !== undefined) {
      const t = demoCleanText((b.text || '').toString().slice(0, 280), 280).trim();
      if (!t) return res.status(400).json({ error: 'text cannot be empty' });
      sets.push('text=?'); vals.push(t);
    }
    if (!sets.length) return res.json(existing);
    vals.push(existing.id);
    db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    broadcastUpdate('messages');
    res.json(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(existing.id));
  });

  app.delete('/api/messages/:id', (req, res) => {
    const r = db.prepare(`DELETE FROM messages WHERE id = ?`).run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Message not found' });
    broadcastUpdate('messages');
    res.json({ ok: true });
  });
};
