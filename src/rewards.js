'use strict';
// Rewards: the prizes kids spend stickers on - create, edit, delete, redeem (balance re-checked here) and undo a redemption.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/rewards.test.js.
module.exports = function registerRewardRoutes({ app, db, broadcastUpdate, getKidStickerBalance, localDateStr }) {
  // GET is public/read-only (kids.html shows what's available + affordable);
  // create/edit/delete/redeem/undo all require the parent PIN like the rest of
  // the chore chart's management surface.
  app.get('/api/rewards', (req, res) => {
    res.json(db.prepare(`SELECT * FROM rewards ORDER BY sort_order, id`).all());
  });
  app.post('/api/rewards', (req, res) => {
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title required' });
    const starCost = parseInt(req.body.star_cost);
    if (!Number.isFinite(starCost) || starCost <= 0) return res.status(400).json({ error: 'star_cost must be a positive number' });
    const max = db.prepare(`SELECT MAX(sort_order) m FROM rewards`).get().m || 0;
    const r = db.prepare(`INSERT INTO rewards (title, icon, star_cost, assignee, sort_order) VALUES (?,?,?,?,?)`)
      .run(title, (req.body.icon || '🎁').trim(), starCost, req.body.assignee || 'all', max + 1);
    broadcastUpdate('chores');
    res.status(201).json(db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(r.lastInsertRowid));
  });
  app.put('/api/rewards/:id', (req, res) => {
    const rw = db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(req.params.id);
    if (!rw) return res.status(404).json({ error: 'Not found' });
    const starCost = req.body.star_cost !== undefined ? parseInt(req.body.star_cost) : rw.star_cost;
    if (!Number.isFinite(starCost) || starCost <= 0) return res.status(400).json({ error: 'star_cost must be a positive number' });
    db.prepare(`UPDATE rewards SET title=?, icon=?, star_cost=?, assignee=?, active=? WHERE id=?`)
      .run((req.body.title ?? rw.title).trim(), (req.body.icon ?? rw.icon).trim(), starCost,
           req.body.assignee ?? rw.assignee, (req.body.active ?? rw.active) ? 1 : 0, rw.id);
    broadcastUpdate('chores');
    res.json(db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(rw.id));
  });
  app.delete('/api/rewards/:id', (req, res) => {
    // Deliberately does NOT touch sticker_redemptions — past redemptions keep
    // their own snapshotted reward_title/star_cost, so deleting the reward
    // definition doesn't erase or corrupt history of what was already redeemed.
    db.prepare(`DELETE FROM rewards WHERE id = ?`).run(req.params.id);
    broadcastUpdate('chores');
    res.json({ ok: true });
  });

  // POST /api/rewards/:id/redeem — body: { kid_id }. Parent confirms the kid has
  // enough stars and records the spend; this is the moment the parent actually
  // hands over the ice cream trip etc. Re-checks the balance server-side (not
  // just trusting a greyed-out button in the UI) since kids.html is unauthenticated
  // on the LAN — same reasoning as the photo-required check on chore completion.
  app.post('/api/rewards/:id/redeem', (req, res) => {
    const reward = db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(req.params.id);
    if (!reward) return res.status(404).json({ error: 'Unknown reward' });
    const kidId = parseInt(req.body.kid_id);
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(kidId);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const balance = getKidStickerBalance(kidId);
    if (balance < reward.star_cost) {
      return res.status(400).json({ error: `Not enough stars — ${kid.name} has ${balance}, this costs ${reward.star_cost}.` });
    }
    db.prepare(`INSERT INTO sticker_redemptions (kid_id, reward_id, reward_title, star_cost, date) VALUES (?,?,?,?,?)`)
      .run(kidId, reward.id, reward.title, reward.star_cost, localDateStr());
    broadcastUpdate('chores');
    res.status(201).json({ ok: true, balance: getKidStickerBalance(kidId) });
  });

  // DELETE /api/sticker-redemptions/:id — undo a redemption recorded by mistake,
  // giving the stars back. Symmetric with the rest of this ledger's reversibility
  // (allowance payouts/adjustments and auto-award stickers are all cleanly
  // reversible too) rather than a one-way spend with no way back.
  app.delete('/api/sticker-redemptions/:id', (req, res) => {
    db.prepare(`DELETE FROM sticker_redemptions WHERE id = ?`).run(req.params.id);
    broadcastUpdate('chores');
    res.json({ ok: true });
  });
};
