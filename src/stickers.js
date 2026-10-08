'use strict';
// Stickers: award, list, revoke and clear the stars on the chore chart, a kid's balance summary, and the combined redeemed-prizes feed.
// Moved out of server.js as the first piece of the split (see TODO.md). Behavior is unchanged: the routes are registered at the same point
// in server.js as before (route order matters in Express), and everything they use comes in through the one object below.
// Covered by test/api/stickers.test.js.
module.exports = function registerStickerRoutes({ app, db, choreToday, broadcastUpdate, getKidStickerBalance }) {
  // GET /api/stickers?from=YYYY-MM-DD&to=YYYY-MM-DD&kid_id=3
  // Range query (not just "today") because both the calendar widget (a month grid)
  // and the kid's own sticker board (last few weeks) need a window, not a single day.
  // kid_id is optional — omit it to get every kid's stickers in range (calendar
  // widget's use case); pass it to scope to one kid (kids.html's use case).
  app.get('/api/stickers', (req, res) => {
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '2999-12-31';
    const kidId = req.query.kid_id ? parseInt(req.query.kid_id) : null;
    const rows = kidId
      ? db.prepare(`SELECT * FROM stickers WHERE date >= ? AND date <= ? AND kid_id = ? ORDER BY date, id`).all(from, to, kidId)
      : db.prepare(`SELECT * FROM stickers WHERE date >= ? AND date <= ? ORDER BY date, id`).all(from, to);
    res.json(rows);
  });

  // POST /api/stickers — manual award. Body: { kid_id, date?, note? }. date defaults
  // to today. Available regardless of sticker_award_mode: 'manual' mode uses this as
  // the ONLY way stickers happen; 'auto' mode still allows a parent to hand out an
  // extra one for something outside the chore chart entirely (a kind word, good
  // behavior at school, etc.) without that needing its own separate mechanism.
  app.post('/api/stickers', (req, res) => {
    const kidId = parseInt(req.body.kid_id);
    if (!Number.isFinite(kidId)) return res.status(400).json({ error: 'kid_id required' });
    const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(kidId);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const date = (req.body.date || choreToday()).trim();
    const note = (req.body.note || '').trim();
    const r = db.prepare(`INSERT INTO stickers (kid_id, date, note) VALUES (?,?,?)`).run(kidId, date, note);
    broadcastUpdate('chores');
    res.status(201).json(db.prepare(`SELECT * FROM stickers WHERE id = ?`).get(r.lastInsertRowid));
  });

  // DELETE /api/stickers/:id — revoke one sticker (manual or auto). Parent-app only
  // (not in the public-routes whitelist below), same trust boundary as editing any
  // other chore-chart data — a kid on kids.html can view their stickers but not
  // remove them.
  app.delete('/api/stickers/:id', (req, res) => {
    db.prepare(`DELETE FROM stickers WHERE id = ?`).run(req.params.id);
    broadcastUpdate('chores');
    res.json({ ok: true });
  });

  // DELETE /api/stickers?kid_id=5 — clear ALL of a kid's stickers at once (a full
  // reset to zero), for a manual correction rather than deleting one at a time.
  // Deliberately kept on /api/stickers (not nested under /api/kids/:id/...) so
  // it inherits the same protected trust boundary as the single-sticker DELETE
  // above — /api/kids itself is public (kids.html/hub.html both manage kids
  // without a login), and a route path merely nested under it would silently
  // inherit that same public status via the whitelist's prefix match, which
  // isn't the right boundary for a bulk-destructive action like this one.
  // Deliberately does NOT touch sticker_redemptions — past redemptions keep
  // their own history regardless (same "don't rewrite what already happened"
  // reasoning as deleting a reward definition not touching redemptions made
  // against it). That means clearing stickers can put a kid's balance
  // temporarily negative if they'd already redeemed more than they now have on
  // record — an intentional, visible signal that a correction happened, not
  // silently hidden.
  app.delete('/api/stickers', (req, res) => {
    const kidId = parseInt(req.query.kid_id);
    if (!Number.isFinite(kidId)) return res.status(400).json({ error: 'kid_id required' });
    const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(kidId);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const info = db.prepare(`DELETE FROM stickers WHERE kid_id = ?`).run(kid.id);
    broadcastUpdate('chores');
    res.json({ ok: true, cleared: info.changes, balance: getKidStickerBalance(kid.id) });
  });

  // GET a kid's sticker summary: running balance, recent stickers, recent
  // redemptions. Mirrors GET /api/kids/:id/allowance's exact shape (balance +
  // entries) — kids.html and app.html's stats sheet both read this the same way
  // the allowance sheet already reads its own summary endpoint.
  app.get('/api/kids/:id/stickers', (req, res) => {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const balance = getKidStickerBalance(kid.id);
    const stickers = db.prepare(`SELECT * FROM stickers WHERE kid_id = ? ORDER BY date DESC, id DESC LIMIT 50`).all(kid.id);
    const redemptions = db.prepare(`SELECT * FROM sticker_redemptions WHERE kid_id = ? ORDER BY date DESC, id DESC LIMIT 50`).all(kid.id);
    res.json({ kid, balance, stickers, redemptions });
  });

  // GET /api/sticker-redemptions — every kid's redeemed rewards, most recent
  // first, for the Family Hub's parent-facing "Redeemed Prizes" list (a single
  // combined feed across kids, not one summary call per kid). Joins in the
  // kid's name/avatar/color at read time rather than trusting the snapshot on
  // each row for those fields — reward_title/star_cost ARE meant to be frozen
  // snapshots (see the table's own schema comment), but a kid's name/avatar/
  // color are live identity, not part of what was "redeemed."
  app.get('/api/sticker-redemptions', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const rows = db.prepare(`
    SELECT sr.*, k.name as kid_name, k.avatar as kid_avatar, k.color as kid_color
    FROM sticker_redemptions sr
    JOIN kids k ON k.id = sr.kid_id
    ORDER BY sr.date DESC, sr.id DESC
    LIMIT ?
  `).all(limit);
    res.json(rows);
  });
};
