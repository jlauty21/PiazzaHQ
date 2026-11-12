'use strict';
// Checklists for the Favorites tab: named lists of things to do ("Before leaving for work", "Bedtime") that clear themselves every day. A checklist can be limited to certain days of the
// week, hours of the day and a range of dates, so the one for the morning is the one in front when it is the morning. Ticks are kept per day (a tick belongs to one date), so a new day
// starts with nothing ticked and nothing has to be reset. Covered by test/api/checklists.test.js and test/unit/checklists.test.js.
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayOfWeek = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const cleanDays = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((x) => (x === '' || x == null ? NaN : Number(x))).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
const cleanTime = (v) => (TIME.test(String(v || '')) ? String(v) : '');
const cleanDate = (v) => (DATE.test(String(v || '')) ? String(v) : '');

// Is this checklist meant for right now? `now` is { date: 'YYYY-MM-DD', time: 'HH:MM' } in the household's time zone.
const isActiveNow = (c, now) => {
  if (c.start_date && now.date < c.start_date) return false;
  if (c.end_date && now.date > c.end_date) return false;
  const days = cleanDays(c.days);
  if (days.length && !days.includes(dayOfWeek(now.date))) return false;
  if (c.from_time && now.time < c.from_time) return false;
  if (c.to_time && now.time >= c.to_time) return false;
  return true;
};


module.exports = function registerChecklists({ app, db, demoCleanText, broadcastUpdate, appNow, localDateStr }) {
  const MAX_LISTS = 30, MAX_ITEMS = 40, MAX_NAME = 60, MAX_TEXT = 120;
  db.exec(`
    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '',
      days TEXT NOT NULL DEFAULT '', from_time TEXT NOT NULL DEFAULT '', to_time TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', hide_outside INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS checklist_items (id INTEGER PRIMARY KEY AUTOINCREMENT, checklist_id INTEGER NOT NULL, text TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS checklist_ticks (item_id INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (item_id, day));
  `);

  const sweep = () => db.prepare(`DELETE FROM checklist_ticks WHERE day < date('now', '-14 days')`).run();
  try { sweep(); } catch { /* the table is new; nothing to sweep */ }
  setInterval(() => { try { sweep(); } catch { /* try again tomorrow */ } }, 12 * 60 * 60 * 1000).unref();

  const text = (v, max) => demoCleanText(String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max), max).trim();

  const clock = () => { const n = appNow(); return { date: localDateStr(), time: `${String(n.h).padStart(2, '0')}:${String(n.min).padStart(2, '0')}` }; };

  function view(now) {
    const lists = db.prepare(`SELECT * FROM checklists ORDER BY sort_order, id`).all();
    const items = db.prepare(`SELECT i.id, i.checklist_id, i.text, (t.item_id IS NOT NULL) AS done FROM checklist_items i LEFT JOIN checklist_ticks t ON t.item_id = i.id AND t.day = ? ORDER BY i.sort_order, i.id`).all(now.date);
    return lists.map((c) => {
      const mine = items.filter((i) => i.checklist_id === c.id).map((i) => ({ id: i.id, text: i.text, done: !!i.done }));
      return {
        id: c.id, name: c.name, icon: c.icon, days: cleanDays(c.days), from: c.from_time, to: c.to_time, start_date: c.start_date, end_date: c.end_date, hide_outside: !!c.hide_outside,
        active: isActiveNow(c, now), items: mine, done: mine.filter((i) => i.done).length, total: mine.length,
      };
    });
  }
  const changed = () => broadcastUpdate('favorites');
  const getList = (id) => db.prepare(`SELECT * FROM checklists WHERE id = ?`).get(id);
  const getItem = (id) => db.prepare(`SELECT * FROM checklist_items WHERE id = ?`).get(id);

  app.get('/api/checklists', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ today: clock().date, now: clock().time, lists: view(clock()) }); });

  // The fields a checklist can carry, cleaned. `b` is what was sent; `cur` is the row being changed (or nothing, for a new one).
  function fields(b, cur) {
    const out = {};
    if (b.name !== undefined || !cur) { out.name = text(b.name, MAX_NAME); if (!out.name) return { error: 'Give the checklist a name.' }; }
    if (b.icon !== undefined) out.icon = String(b.icon || '').slice(0, 8);
    if (b.days !== undefined) out.days = cleanDays(b.days).join(',');
    if (b.from !== undefined) out.from_time = cleanTime(b.from);
    if (b.to !== undefined) out.to_time = cleanTime(b.to);
    if (b.start_date !== undefined) out.start_date = cleanDate(b.start_date);
    if (b.end_date !== undefined) out.end_date = cleanDate(b.end_date);
    if (b.hide_outside !== undefined) out.hide_outside = b.hide_outside ? 1 : 0;
    const from = out.from_time !== undefined ? out.from_time : cur && cur.from_time, to = out.to_time !== undefined ? out.to_time : cur && cur.to_time;
    if (from && to && to <= from) return { error: 'The end time has to be after the start time.' };
    const sd = out.start_date !== undefined ? out.start_date : cur && cur.start_date, ed = out.end_date !== undefined ? out.end_date : cur && cur.end_date;
    if (sd && ed && ed < sd) return { error: 'The last date has to be on or after the first date.' };
    return { out };
  }

  app.post('/api/checklists', (req, res) => {
    const b = req.body || {};
    if (db.prepare(`SELECT COUNT(*) n FROM checklists`).get().n >= MAX_LISTS) return res.status(400).json({ error: `Up to ${MAX_LISTS} checklists.` });
    const f = fields(b, null);
    if (f.error) return res.status(400).json({ error: f.error });
    const max = db.prepare(`SELECT MAX(sort_order) m FROM checklists`).get().m || 0;
    const o = { icon: '', days: '', from_time: '', to_time: '', start_date: '', end_date: '', hide_outside: 0, ...f.out };
    const id = db.transaction(() => {
      const r = db.prepare(`INSERT INTO checklists (name, icon, days, from_time, to_time, start_date, end_date, hide_outside, sort_order) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(o.name, o.icon, o.days, o.from_time, o.to_time, o.start_date, o.end_date, o.hide_outside, max + 1);
      (Array.isArray(b.items) ? b.items : []).map((t) => text(t, MAX_TEXT)).filter(Boolean).slice(0, MAX_ITEMS)
        .forEach((t, i) => db.prepare(`INSERT INTO checklist_items (checklist_id, text, sort_order) VALUES (?,?,?)`).run(r.lastInsertRowid, t, i + 1));
      return r.lastInsertRowid;
    })();
    changed();
    res.status(201).json(view(clock()).find((c) => c.id === Number(id)));
  });

  app.put('/api/checklists/:id', (req, res) => {
    const cur = getList(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const f = fields(req.body || {}, cur);
    if (f.error) return res.status(400).json({ error: f.error });
    const keys = Object.keys(f.out);
    if (keys.length) db.prepare(`UPDATE checklists SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f.out[k]), cur.id);
    changed();
    res.json(view(clock()).find((c) => c.id === cur.id));
  });

  app.delete('/api/checklists/:id', (req, res) => {
    const cur = getList(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    db.transaction(() => {
      db.prepare(`DELETE FROM checklist_ticks WHERE item_id IN (SELECT id FROM checklist_items WHERE checklist_id = ?)`).run(cur.id);
      db.prepare(`DELETE FROM checklist_items WHERE checklist_id = ?`).run(cur.id);
      db.prepare(`DELETE FROM checklists WHERE id = ?`).run(cur.id);
    })();
    changed();
    res.json({ ok: true });
  });

  app.post('/api/checklists/:id/items', (req, res) => {
    const cur = getList(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const t = text((req.body || {}).text, MAX_TEXT);
    if (!t) return res.status(400).json({ error: 'Type what to add.' });
    if (db.prepare(`SELECT COUNT(*) n FROM checklist_items WHERE checklist_id = ?`).get(cur.id).n >= MAX_ITEMS) return res.status(400).json({ error: `Up to ${MAX_ITEMS} items on a checklist.` });
    const max = db.prepare(`SELECT MAX(sort_order) m FROM checklist_items WHERE checklist_id = ?`).get(cur.id).m || 0;
    const r = db.prepare(`INSERT INTO checklist_items (checklist_id, text, sort_order) VALUES (?,?,?)`).run(cur.id, t, max + 1);
    changed();
    res.status(201).json({ id: r.lastInsertRowid, text: t, done: false });
  });

  app.put('/api/checklist-items/:id', (req, res) => {
    const it = getItem(req.params.id);
    if (!it) return res.status(404).json({ error: 'Not found' });
    const t = text((req.body || {}).text, MAX_TEXT);
    if (!t) return res.status(400).json({ error: 'An item needs some text.' });
    db.prepare(`UPDATE checklist_items SET text = ? WHERE id = ?`).run(t, it.id);
    changed();
    res.json({ ok: true });
  });

  app.delete('/api/checklist-items/:id', (req, res) => {
    const it = getItem(req.params.id);
    if (!it) return res.status(404).json({ error: 'Not found' });
    db.prepare(`DELETE FROM checklist_ticks WHERE item_id = ?`).run(it.id);
    db.prepare(`DELETE FROM checklist_items WHERE id = ?`).run(it.id);
    changed();
    res.json({ ok: true });
  });

  // Swap with the neighbour, as the Favorites cards do.
  app.post('/api/checklist-items/:id/move', (req, res) => {
    const it = getItem(req.params.id);
    if (!it) return res.status(404).json({ error: 'Not found' });
    const all = db.prepare(`SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY sort_order, id`).all(it.checklist_id);
    const i = all.findIndex((x) => x.id === it.id), j = i + (req.body && req.body.direction === 'up' ? -1 : 1);
    if (j >= 0 && j < all.length) {
      const a = all[i], b = all[j], upd = db.prepare(`UPDATE checklist_items SET sort_order = ? WHERE id = ?`);
      db.transaction(() => { upd.run(j + 1, a.id); upd.run(i + 1, b.id); })();      // by position, so equal sort orders cannot leave them tied
      all.forEach((x, k) => { if (k !== i && k !== j) upd.run(k + 1, x.id); });
      changed();
    }
    res.json({ ok: true });
  });

  // Tick or untick one item for today.
  app.post('/api/checklist-items/:id/tick', (req, res) => {
    const it = getItem(req.params.id);
    if (!it) return res.status(404).json({ error: 'Not found' });
    const day = localDateStr();
    if (req.body && req.body.done === false) db.prepare(`DELETE FROM checklist_ticks WHERE item_id = ? AND day = ?`).run(it.id, day);
    else db.prepare(`INSERT OR IGNORE INTO checklist_ticks (item_id, day) VALUES (?, ?)`).run(it.id, day);
    changed();
    res.json({ ok: true, done: !(req.body && req.body.done === false) });
  });

  // Start today's list over (untick everything on it).
  app.post('/api/checklists/:id/reset', (req, res) => {
    const cur = getList(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    db.prepare(`DELETE FROM checklist_ticks WHERE day = ? AND item_id IN (SELECT id FROM checklist_items WHERE checklist_id = ?)`).run(localDateStr(), cur.id);
    changed();
    res.json({ ok: true });
  });
};
module.exports.isActiveNow = isActiveNow;
module.exports.cleanDays = cleanDays;
