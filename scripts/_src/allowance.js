'use strict';
// Allowance + completion stats: the weekly flat credit, a kid's ledger (payouts, adjustments) and the History view's stats.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/allowance.test.js.
module.exports = function registerAllowanceRoutes({ app, db, isSlave, localDateStr, broadcastUpdate, getKidStreak }) {
  // ISO week string like '2026-W28', used to dedupe the weekly flat credit so it's
  // only ever granted once per calendar week no matter how often this is checked.
  function isoWeekStr(d = new Date()) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  // Credits this week's flat allowance for weekly_flat kids, if not already credited
  // this week. Host-only, same reasoning as the briefing/feedback schedulers: a slave
  // writing this locally would silently diverge from the host instead of syncing.
  function ensureWeeklyAllowanceCredited() {
    if (isSlave()) return;
    const period = isoWeekStr();
    const kids = db.prepare(`SELECT * FROM kids WHERE allowance_enabled = 1 AND allowance_mode = 'weekly_flat' AND weekly_rate > 0`).all();
    for (const k of kids) {
      const already = db.prepare(`SELECT id FROM allowance_ledger WHERE kid_id = ? AND type = 'weekly' AND period = ?`).get(k.id, period);
      if (already) continue;
      db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, period, note) VALUES (?,?,?,?,?,?)`)
        .run(k.id, localDateStr(), 'weekly', k.weekly_rate, period, 'Weekly allowance');
    }
  }
  // GET a kid's completion history/stats for the parent's History view. ?days=N
  // (default 30, capped at 180) controls how far back the daily breakdown goes.
  // A day with total=0 means no chore was due that day (not a miss) — the UI should
  // distinguish that from a day with total>0 and done<total.
  app.get('/api/kids/:id/stats', (req, res) => {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 180);
    const todayStr = localDateStr();
    const [y, m, d] = todayStr.split('-').map(Number);
    const dates = [];
    let cursor = new Date(y, m - 1, d);
    for (let i = 0; i < days; i++) {
      dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
      cursor.setDate(cursor.getDate() - 1);
    }
    dates.reverse(); // oldest first
    const rows = db.prepare(`SELECT date, done FROM chore_instances WHERE kid_id = ? AND date >= ? AND date <= ?`)
      .all(kid.id, dates[0], todayStr);
    const byDate = {};
    for (const r of rows) {
      if (!byDate[r.date]) byDate[r.date] = { total: 0, done: 0 };
      byDate[r.date].total++;
      if (r.done) byDate[r.date].done++;
    }
    const daily = dates.map(ds => ({ date: ds, total: (byDate[ds] || {}).total || 0, done: (byDate[ds] || {}).done || 0 }));
    const pctOverLastN = (n) => {
      const slice = daily.slice(-n);
      const total = slice.reduce((s, x) => s + x.total, 0);
      const done = slice.reduce((s, x) => s + x.done, 0);
      return total ? Math.round((done / total) * 100) : null; // null = no chores due in that window
    };
    const allTimeCompleted = db.prepare(`SELECT COUNT(*) c FROM chore_instances WHERE kid_id = ? AND done = 1`).get(kid.id).c;
    res.json({
      kid, days, daily,
      last7Pct: pctOverLastN(7),
      last30Pct: pctOverLastN(30),
      streak: getKidStreak(kid.id, todayStr),
      allTimeCompleted,
    });
  });
  // GET a kid's allowance summary: running balance + recent ledger entries.
  app.get('/api/kids/:id/allowance', (req, res) => {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    ensureWeeklyAllowanceCredited();
    const balance = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM allowance_ledger WHERE kid_id = ?`).get(kid.id).total;
    const entries = db.prepare(`SELECT * FROM allowance_ledger WHERE kid_id = ? ORDER BY id DESC LIMIT 50`).all(kid.id);
    res.json({ kid, balance, entries });
  });
  // Record a payout (parent hands over cash) — reduces the balance.
  app.post('/api/kids/:id/allowance/payout', (req, res) => {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Positive amount required' });
    db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, note) VALUES (?,?,?,?,?)`)
      .run(kid.id, localDateStr(), 'payout', -Math.abs(amount), (req.body.note || '').trim());
    broadcastUpdate('chores');
    const balance = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM allowance_ledger WHERE kid_id = ?`).get(kid.id).total;
    res.status(201).json({ ok: true, balance });
  });
  // Manual bonus (positive) or deduction (negative) — e.g. docking for a missed chore,
  // or a one-off bonus that doesn't fit the per-chore/weekly model.
  app.post('/api/kids/:id/allowance/adjust', (req, res) => {
    const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!kid) return res.status(404).json({ error: 'Unknown kid' });
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Non-zero amount required' });
    db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, note) VALUES (?,?,?,?,?)`)
      .run(kid.id, localDateStr(), 'adjustment', amount, (req.body.note || '').trim());
    broadcastUpdate('chores');
    const balance = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM allowance_ledger WHERE kid_id = ?`).get(kid.id).total;
    res.status(201).json({ ok: true, balance });
  });
  return { ensureWeeklyAllowanceCredited };
};
