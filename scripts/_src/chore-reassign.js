'use strict';
// Reassign a chore for one day: a one-off swap of a single day's chore to another kid.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/chores-core.test.js.
module.exports = function registerChoreReassign({ app, db, broadcastUpdate }) {
  // Reassign a single day's chore instance to a different kid — a one-off swap
  // (sick kid, schedule change) that does NOT touch the chore's own recurring
  // assignee rule. Only allowed while undone: a completed instance may already
  // have an allowance ledger row tied to the original kid, and un-picking that
  // apart cleanly isn't worth the complexity for what's meant to be a same-day,
  // before-it's-done swap. Parent un-checks it first if they really need to move
  // a completed one.
  app.put('/api/chore-instances/:id/reassign', (req, res) => {
    const inst = db.prepare(`SELECT * FROM chore_instances WHERE id = ?`).get(req.params.id);
    if (!inst) return res.status(404).json({ error: 'Unknown chore instance' });
    if (inst.done) return res.status(400).json({ error: 'Un-check this chore before reassigning it.' });
    const newKidId = parseInt(req.body.kid_id);
    if (!Number.isFinite(newKidId)) return res.status(400).json({ error: 'kid_id required' });
    if (newKidId === inst.kid_id) return res.json({ ok: true }); // no-op
    const newKid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(newKidId);
    if (!newKid) return res.status(404).json({ error: 'Unknown kid' });
    const clash = db.prepare(`SELECT id FROM chore_instances WHERE chore_id = ? AND kid_id = ? AND date = ?`)
      .get(inst.chore_id, newKidId, inst.date);
    if (clash) return res.status(400).json({ error: 'That kid already has this chore today.' });
    // Remember the kid it was first moved from (kept across a chain of swaps); moving it back to that kid clears the note.
    const origin = inst.reassigned_from || inst.kid_id;
    db.prepare(`UPDATE chore_instances SET kid_id = ?, reassigned_from = ? WHERE id = ?`).run(newKidId, newKidId === origin ? null : origin, inst.id);
    broadcastUpdate('chores');
    res.json({ ok: true });
  });
};
