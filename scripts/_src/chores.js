'use strict';
// Chores API: chore definitions, a kid's day, the wall chart, ticking off (with the allowance credit and auto stickers), photo proof and chore pictures.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/chores-core.test.js.
module.exports = function registerChores({ app, demoCleanText, db, upload, broadcastUpdate, getKidChores, getKidStreak, getKidStickerBalance, localDateStr, choreToday, ensureWeeklyAllowanceCredited }) {
  // Chores CRUD
  app.get('/api/chores', (req, res) => {
    res.json(db.prepare(`SELECT * FROM chores ORDER BY sort_order, id`).all());
  });
  app.post('/api/chores', (req, res) => {
    const b = req.body || {};
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'Title required' });
    const max = db.prepare(`SELECT MAX(sort_order) m FROM chores`).get().m || 0;
    const r = db.prepare(`INSERT INTO chores
    (title, icon, assignee, freq, byday, on_date, at_time, carryover, celebrate, pay_amount, notes, photo_required, bonus, sort_order, rotate, rotate_start, rotate_anchor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        demoCleanText(b.title.trim(), 120), b.icon || '✅', String(b.assignee || 'all'),
        b.freq || 'daily', b.byday || '', b.on_date || '', b.at_time || '',
        b.carryover ? 1 : 0, (b.celebrate === false || b.celebrate === 0) ? 0 : 1,
        Number(b.pay_amount) || 0, demoCleanText((b.notes || '').trim(), 500),
        b.photo_required ? 1 : 0, b.bonus ? 1 : 0, max + 1,
        b.rotate ? 1 : 0, Number(b.rotate_start) || 0, b.rotate ? localDateStr() : '');
    broadcastUpdate('chores');
    res.status(201).json(db.prepare(`SELECT * FROM chores WHERE id = ?`).get(r.lastInsertRowid));
  });
  app.put('/api/chores/:id', (req, res) => {
    const c = db.prepare(`SELECT * FROM chores WHERE id = ?`).get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    // Take turns. The anchor ("this person has it today") is reset only when something that decides who-has-it-when actually changed, so
    // editing a title or the pay on a rotating chore never moves the cycle. When it does change, today's and later unfinished rows are
    // dropped so they are made again for the right person.
    const newRotate = (b.rotate ?? c.rotate) ? 1 : 0;
    const newStart = b.rotate_start !== undefined ? (Number(b.rotate_start) || 0) : c.rotate_start;
    const newAssignee = String(b.assignee ?? c.assignee), newFreq = b.freq ?? c.freq, newByday = b.byday ?? c.byday;
    const cycleChanged = newRotate !== (c.rotate ? 1 : 0) || (newRotate && (newStart !== c.rotate_start || newAssignee !== c.assignee || newFreq !== c.freq || newByday !== c.byday));
    const newAnchor = !newRotate ? '' : (cycleChanged ? localDateStr() : c.rotate_anchor);
    if (cycleChanged) db.prepare(`DELETE FROM chore_instances WHERE chore_id = ? AND date >= ? AND done = 0`).run(c.id, localDateStr());
    db.prepare(`UPDATE chores SET title=?, icon=?, assignee=?, freq=?, byday=?, on_date=?, at_time=?,
              carryover=?, celebrate=?, pay_amount=?, notes=?, photo_required=?, bonus=?, active=?, rotate=?, rotate_start=?, rotate_anchor=? WHERE id=?`)
      .run(
        b.title !== undefined ? demoCleanText(b.title, 120) : c.title, b.icon ?? c.icon, String(b.assignee ?? c.assignee),
        b.freq ?? c.freq, b.byday ?? c.byday, b.on_date ?? c.on_date, b.at_time ?? c.at_time,
        (b.carryover ?? c.carryover) ? 1 : 0, (b.celebrate ?? c.celebrate) ? 1 : 0,
        (b.pay_amount !== undefined ? Number(b.pay_amount) || 0 : c.pay_amount),
        (b.notes !== undefined ? demoCleanText((b.notes || '').trim(), 500) : c.notes),
        (b.photo_required ?? c.photo_required) ? 1 : 0,
        (b.bonus ?? c.bonus) ? 1 : 0,
        (b.active ?? c.active) ? 1 : 0, newRotate, newStart, newAnchor, c.id);
    broadcastUpdate('chores');
    res.json(db.prepare(`SELECT * FROM chores WHERE id = ?`).get(c.id));
  });
  app.delete('/api/chores/:id', (req, res) => {
    db.prepare(`DELETE FROM chores WHERE id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM chore_instances WHERE chore_id = ?`).run(req.params.id);
    broadcastUpdate('chores');
    res.json({ ok: true });
  });

  // Upload a custom picture for a chore. Reuses the photo upload pipeline (same
  // /uploads dir, same slave sync). Returns an icon token "img:<filename>" the client
  // stores in the chore's icon field.
  app.post('/api/chore-image', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image (jpeg/png/webp/gif, ≤20MB)' });
    broadcastUpdate('chores'); // prompt slaves to pull the new file on next sync
    res.status(201).json({ icon: 'img:' + req.file.filename, filename: req.file.filename });
  });

  // Upload a "proof" photo for a completed chore instance — same upload pipeline
  // as the chore icon above. Separate from the toggle endpoint on purpose: the kid
  // takes/picks the photo first, THEN the client calls toggle(done:true), so a
  // chore that requires a photo never gets marked done without one actually
  // attached (the toggle endpoint below double-checks this server-side too).
  app.post('/api/chore-instances/:id/proof', upload.single('photo'), (req, res) => {
    const inst = db.prepare(`SELECT * FROM chore_instances WHERE id = ?`).get(req.params.id);
    if (!inst) return res.status(404).json({ error: 'Unknown chore instance' });
    if (!req.file) return res.status(400).json({ error: 'No image (jpeg/png/webp/gif, ≤20MB)' });
    db.prepare(`UPDATE chore_instances SET proof_photo = ? WHERE id = ?`).run(req.file.filename, inst.id);
    broadcastUpdate('chores');
    res.status(201).json({ ok: true, filename: req.file.filename });
  });

  // A kid's chores for today (or ?date=YYYY-MM-DD)
  app.get('/api/kids/:id/chores', (req, res) => {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const date = req.query.date || choreToday();
    let balance = null;
    if (kid.allowance_enabled) {
      ensureWeeklyAllowanceCredited(); // lazy-credit so the goal progress bar stays current
      balance = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM allowance_ledger WHERE kid_id = ?`).get(kid.id).total;
    }
    res.json({ kid, date, chores: getKidChores(kid.id, date), streak: getKidStreak(kid.id, date), balance, stickerBalance: getKidStickerBalance(kid.id) });
  });

  // The whole chart for the wall display: every kid + their day's chores.
  // 7-day (including today) completed/total count — the ranking stat for the
  // wall-display leaderboard widget. Same "total=0 means nothing was due, not a
  // miss" semantics as the /stats endpoint, just collapsed to two numbers instead
  // of a daily breakdown since the widget only needs a single ranking figure.
  function getKidWeeklyCompletion(kidId, todayStr) {
    const [y, m, d] = todayStr.split('-').map(Number);
    const start = new Date(y, m - 1, d); start.setDate(start.getDate() - 6);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const row = db.prepare(`SELECT COUNT(*) as total, SUM(done) as done FROM chore_instances WHERE kid_id = ? AND date >= ? AND date <= ?`)
      .get(kidId, startStr, todayStr);
    return { weeklyDone: row.done || 0, weeklyTotal: row.total || 0 };
  }
  app.get('/api/chore-chart', (req, res) => {
    const date = req.query.date || choreToday();
    const kids = db.prepare(`SELECT * FROM kids ORDER BY sort_order, id`).all();
    // The shared bonus / extra-credit pool for the day, so a chore-chart widget
    // can optionally surface it on the wall (claiming still happens in the app /
    // kid page). A claimed one carries who got it; unclaimed ones are up for
    // grabs. Same rows the per-kid /api/kids/:id/bonus-chores route reads.
    const claimRows = db.prepare(`
    SELECT ci.chore_id, k.name, k.avatar, k.color
    FROM chore_instances ci JOIN kids k ON k.id = ci.kid_id
    WHERE ci.date = ?`).all(date);
    const claimByChore = new Map(claimRows.map(r => [r.chore_id, r]));
    const bonusChores = db.prepare(
      `SELECT id, title, icon, pay_amount FROM chores WHERE active = 1 AND bonus = 1 ORDER BY sort_order, id`
    ).all().map(c => {
      const cl = claimByChore.get(c.id);
      return {
        id: c.id, title: c.title, icon: c.icon, pay_amount: c.pay_amount || 0,
        claimedBy: cl ? { name: cl.name, avatar: cl.avatar, color: cl.color } : null,
      };
    });
    res.json({
      date,
      bonusChores,
      kids: kids.map(k => ({
        ...k,
        chores: getKidChores(k.id, date),
        streak: getKidStreak(k.id, date),
        stickerBalance: getKidStickerBalance(k.id),
        ...getKidWeeklyCompletion(k.id, date),
      })),
    });
  });

  // Toggle / set a chore instance done state. Body: { done: true|false }.
  // Kid page and parent app both use this; parents can re-open (done:false).
  app.post('/api/chore-instances/:id/toggle', (req, res) => {
    const inst = db.prepare(`SELECT * FROM chore_instances WHERE id = ?`).get(req.params.id);
    if (!inst) return res.status(404).json({ error: 'Unknown chore instance' });
    const done = (typeof req.body.done === 'boolean') ? req.body.done : !inst.done;
    // Enforced here too, not just hidden/disabled in the UI — kids.html has no
    // login, so anyone on the LAN could otherwise call this endpoint directly and
    // skip a photo requirement the parent specifically set.
    if (done && !inst.proof_photo) {
      const chore = db.prepare(`SELECT photo_required FROM chores WHERE id = ?`).get(inst.chore_id);
      if (chore && chore.photo_required) {
        return res.status(400).json({ error: 'This chore needs a photo before it can be marked done.' });
      }
    }
    db.prepare(`UPDATE chore_instances SET done = ?, completed_at = ? WHERE id = ?`)
      .run(done ? 1 : 0, done ? new Date().toISOString() : '', inst.id);
    // Per-chore allowance: credit on completion, cleanly reverse if un-checked. Only
    // applies when the kid has allowance on and set to 'per_chore' — weekly_flat kids
    // aren't paid per instance, so a chore's pay_amount is simply ignored for them.
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(inst.kid_id);
    if (kid && kid.allowance_enabled && kid.allowance_mode === 'per_chore') {
      // Always clear any prior ledger row for this instance first — avoids double-credit
      // on repeated toggling and makes "un-check" a clean, exact reversal.
      db.prepare(`DELETE FROM allowance_ledger WHERE chore_instance_id = ? AND type = 'chore'`).run(inst.id);
      if (done && inst.pay_amount > 0) {
        db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, chore_instance_id) VALUES (?,?,?,?,?)`)
          .run(kid.id, inst.date, 'chore', inst.pay_amount, inst.id);
      }
    }
    // Auto-awarded stickers: only when the family has chosen 'auto' mode (default is
    // 'manual' — see sticker_award_mode). Reuses the chore's own celebrate flag as
    // the "this one's worth a sticker" signal rather than adding a second, separate
    // per-chore checkbox that would mean almost the same thing. Same delete-then-
    // insert dedupe shape as the allowance credit just above: always clear any prior
    // sticker tied to this instance first, so re-toggling never double-awards and
    // un-checking is a clean, exact reversal — not a silent leftover sticker.
    const choreFull = db.prepare(`SELECT celebrate FROM chores WHERE id = ?`).get(inst.chore_id);
    const stickerMode = db.prepare(`SELECT value FROM settings WHERE key = 'sticker_award_mode'`).get();
    if (stickerMode && stickerMode.value === 'auto' && choreFull && choreFull.celebrate) {
      db.prepare(`DELETE FROM stickers WHERE chore_instance_id = ?`).run(inst.id);
      if (done) {
        db.prepare(`INSERT INTO stickers (kid_id, date, chore_instance_id) VALUES (?,?,?)`)
          .run(inst.kid_id, inst.date, inst.id);
      }
    }
    broadcastUpdate('chores');
    res.json({ ok: true, done, celebrate: !!(choreFull && choreFull.celebrate) });
  });
};
