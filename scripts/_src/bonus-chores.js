'use strict';
// Bonus / extra-credit chores: the shared pool a kid can claim from, and claiming one (once only, paid for pay-per-chore kids).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/bonus-claim.test.js.
module.exports = function registerBonusChores({ app, db, broadcastUpdate, choreToday }) {
  // A shared pool (not pre-assigned to anyone — see materializeChoreInstances,
  // which skips bonus chores) that any kid can claim for the day; whoever claims
  // it first gets it and it's gone for everyone else. Claiming = doing it (no
  // separate "claim then complete" step) since these are meant to be quick,
  // opportunistic extra tasks.
  app.get('/api/kids/:id/bonus-chores', (req, res) => {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const date = req.query.date || choreToday();
    const claimedToday = new Set(
      db.prepare(`SELECT chore_id FROM chore_instances WHERE date = ?`).all(date).map(r => r.chore_id)
    );
    const bonusChores = db.prepare(`SELECT * FROM chores WHERE active = 1 AND bonus = 1 ORDER BY sort_order, id`).all()
      .filter(c => !claimedToday.has(c.id));
    res.json(bonusChores);
  });
  app.post('/api/kids/:id/claim-bonus/:choreId', (req, res) => {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const chore = db.prepare(`SELECT * FROM chores WHERE id = ? AND bonus = 1 AND active = 1`).get(req.params.choreId);
    if (!chore) return res.status(404).json({ error: 'Unknown bonus chore' });
    const date = choreToday();
    // Whole-pool check (any kid), not the usual per-kid uniqueness — see schema note.
    const already = db.prepare(`SELECT id FROM chore_instances WHERE chore_id = ? AND date = ?`).get(chore.id, date);
    if (already) return res.status(400).json({ error: 'Someone already claimed this one today.' });
    const r = db.prepare(`INSERT INTO chore_instances (chore_id, kid_id, date, done, completed_at, pay_amount)
    VALUES (?, ?, ?, 1, ?, ?)`).run(chore.id, kid.id, date, new Date().toISOString(), chore.pay_amount || 0);
    if (kid.allowance_enabled && kid.allowance_mode === 'per_chore' && chore.pay_amount > 0) {
      db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, chore_instance_id) VALUES (?,?,?,?,?)`)
        .run(kid.id, date, 'chore', chore.pay_amount, r.lastInsertRowid);
    }
    broadcastUpdate('chores');
    res.status(201).json({ ok: true, celebrate: !!chore.celebrate });
  });
};
