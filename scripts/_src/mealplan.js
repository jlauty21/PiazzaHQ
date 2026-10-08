'use strict';
// Meal plan: one planned meal per date and slot for the wall widget and the Family Hub (list, set, clear, and the nightly sweep of old meals).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/mealplan.test.js.
module.exports = function registerMealPlan({ app, db, isSlave, demoCleanText, broadcastUpdate }) {
  // One planned meal per (date, slot). slot is breakfast|lunch|dinner; which
  // slots the household actually plans is settings.mealplan_slots (default just
  // 'dinner'). An unplanned slot has no row. Shown on the wall (the "mealplan"
  // widget) and managed from the app's Family Hub "Meals" sub-tab. Syncs
  // host->slave like messages.
  const MEAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
  function sweepMeals() {
    if (isSlave()) return;
    db.prepare(`DELETE FROM meals WHERE date < date('now','-7 days') OR date > date('now','+120 days')`).run();
  }
  try { sweepMeals(); } catch {}
  setInterval(() => { try { sweepMeals(); } catch {} }, 6 * 60 * 60 * 1000);

  app.get('/api/meals', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { sweepMeals(); } catch {}
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const defFrom = iso(today);
    const defTo = (() => { const d = new Date(today); d.setDate(d.getDate() + 14); return iso(d); })();
    const from = MEAL_DATE_RE.test(req.query.from || '') ? req.query.from : defFrom;
    const to = MEAL_DATE_RE.test(req.query.to || '') ? req.query.to : defTo;
    // A stable slot order (breakfast -> lunch -> dinner) so the client doesn't
    // have to re-sort.
    res.json(db.prepare(`
    SELECT * FROM meals WHERE date BETWEEN ? AND ?
    ORDER BY date, CASE slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END
  `).all(from, to));
  });

  function upsertMeal(req, res, date, slot) {
    if (!MEAL_DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (!MEAL_SLOTS.includes(slot)) return res.status(400).json({ error: 'slot must be breakfast, lunch or dinner' });
    const b = req.body || {};
    const title = demoCleanText((b.title || '').toString().slice(0, 80), 80).trim();
    const notes = demoCleanText((b.notes || '').toString().slice(0, 300), 300).trim();
    if (!title) {
      // Empty title = clear this slot.
      db.prepare(`DELETE FROM meals WHERE date = ? AND slot = ?`).run(date, slot);
      broadcastUpdate('meals');
      return res.json({ ok: true, cleared: true });
    }
    db.prepare(`
    INSERT INTO meals (date, slot, title, notes, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date, slot) DO UPDATE SET title = excluded.title, notes = excluded.notes, updated_at = excluded.updated_at
  `).run(date, slot, title, notes);
    broadcastUpdate('meals');
    res.json(db.prepare(`SELECT * FROM meals WHERE date = ? AND slot = ?`).get(date, slot));
  }
  // /api/meals/:date defaults to the dinner slot (back-compat with the
  // pre-slots widget/app); /api/meals/:date/:slot is explicit.
  app.put('/api/meals/:date/:slot', (req, res) => upsertMeal(req, res, req.params.date, req.params.slot));
  app.put('/api/meals/:date', (req, res) => upsertMeal(req, res, req.params.date, 'dinner'));

  function deleteMeal(req, res, date, slot) {
    if (!MEAL_DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (!MEAL_SLOTS.includes(slot)) return res.status(400).json({ error: 'bad slot' });
    db.prepare(`DELETE FROM meals WHERE date = ? AND slot = ?`).run(date, slot);
    broadcastUpdate('meals');
    res.json({ ok: true });
  }
  app.delete('/api/meals/:date/:slot', (req, res) => deleteMeal(req, res, req.params.date, req.params.slot));
  app.delete('/api/meals/:date', (req, res) => deleteMeal(req, res, req.params.date, 'dinner'));
};
