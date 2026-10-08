'use strict';
// Shopping list: several named lists, items with a done state, and clearing the checked-off ones (un-targeted calls use the first list so older clients keep working).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/shopping.test.js.
module.exports = function registerShoppingList({ app, db, demoCleanText, broadcastUpdate }) {
  // "Buy" links to store search pages are built entirely client-side (see hub.html
  // and the wall-display widget) from the item text — no product matching, no
  // scraping, no API keys, just a plain search-URL per store.
  //
  // Multiple lists: like to-dos, shopping can now have several named lists
  // (regular grocery vs Costco). Every call that predates lists — GET/POST
  // /api/shopping-list and POST .../clear-done with no list given — acts on the
  // DEFAULT list (the first one), so older clients (a mirror or hub tab still on
  // an earlier version) behave exactly as they did with a single list.
  function defaultShoppingListId() {
    const r = db.prepare(`SELECT id FROM shopping_lists ORDER BY sort_order, id LIMIT 1`).get();
    if (r) return r.id;
    return Number(db.prepare(`INSERT INTO shopping_lists (name, sort_order) VALUES ('Shopping List', 0)`).run().lastInsertRowid);
  }
  // A request-supplied list id → a real list id, the default when none was
  // given, or null when one was given that doesn't exist.
  function resolveShoppingListId(v) {
    if (v === undefined || v === null || v === '') return defaultShoppingListId();
    const r = db.prepare(`SELECT id FROM shopping_lists WHERE id = ?`).get(Number(v));
    return r ? r.id : null;
  }
  app.get('/api/shopping-lists', (req, res) => {
    defaultShoppingListId(); // guarantees at least one list exists
    res.json(db.prepare(`
    SELECT sl.id, sl.name, sl.sort_order,
           (SELECT COUNT(*) FROM shopping_items si WHERE si.list_id = sl.id AND si.done = 0) AS open_count
    FROM shopping_lists sl ORDER BY sl.sort_order, sl.id`).all());
  });
  app.post('/api/shopping-lists', (req, res) => {
    const name = demoCleanText(String((req.body && req.body.name) || '').trim(), 60);
    if (!name) return res.status(400).json({ error: 'A list name is required.' });
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM shopping_lists`).get();
    const info = db.prepare(`INSERT INTO shopping_lists (name, sort_order) VALUES (?, ?)`).run(name, (maxOrder.m || 0) + 1);
    broadcastUpdate('shopping');
    res.status(201).json({ id: Number(info.lastInsertRowid), name });
  });
  app.put('/api/shopping-lists/:id', (req, res) => {
    const list = db.prepare(`SELECT id FROM shopping_lists WHERE id = ?`).get(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found.' });
    if (req.body.name !== undefined) {
      const name = demoCleanText(String(req.body.name).trim(), 60);
      if (!name) return res.status(400).json({ error: 'A list name is required.' });
      db.prepare(`UPDATE shopping_lists SET name = ? WHERE id = ?`).run(name, req.params.id);
    }
    if (req.body.sort_order !== undefined) {
      db.prepare(`UPDATE shopping_lists SET sort_order = ? WHERE id = ?`).run(Number(req.body.sort_order) || 0, req.params.id);
    }
    broadcastUpdate('shopping');
    res.json({ ok: true });
  });
  app.delete('/api/shopping-lists/:id', (req, res) => {
    const list = db.prepare(`SELECT id FROM shopping_lists WHERE id = ?`).get(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found.' });
    // Never delete the last remaining list — there's always somewhere for the
    // default (un-targeted) add to land.
    const count = db.prepare(`SELECT COUNT(*) AS n FROM shopping_lists`).get().n;
    if (count <= 1) return res.status(409).json({ error: 'You need at least one shopping list.' });
    db.prepare(`DELETE FROM shopping_items WHERE list_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM shopping_lists WHERE id = ?`).run(req.params.id);
    broadcastUpdate('shopping');
    res.json({ ok: true });
  });
  // ?list=<id> → that list's items; ?list=all → every list's items (each row
  // carries its list_id — what the wall display uses so several widgets can each
  // show a different list from one fetch); no param → the default list.
  app.get('/api/shopping-list', (req, res) => {
    if (req.query.list === 'all') {
      return res.json(db.prepare(`SELECT * FROM shopping_items ORDER BY done, sort_order, id`).all());
    }
    const listId = resolveShoppingListId(req.query.list);
    if (listId === null) return res.status(404).json({ error: 'List not found.' });
    res.json(db.prepare(`SELECT * FROM shopping_items WHERE list_id = ? ORDER BY done, sort_order, id`).all(listId));
  });
  app.post('/api/shopping-list', (req, res) => {
    const text = demoCleanText((req.body.text || '').trim(), 120);
    if (!text) return res.status(400).json({ error: 'Item text is required.' });
    const listId = resolveShoppingListId(req.body.list_id);
    if (listId === null) return res.status(404).json({ error: 'List not found.' });
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM shopping_items WHERE list_id = ?`).get(listId);
    const info = db.prepare(`INSERT INTO shopping_items (list_id, text, sort_order) VALUES (?, ?, ?)`)
      .run(listId, text, (maxOrder.m || 0) + 1);
    broadcastUpdate('shopping');
    res.status(201).json({ id: info.lastInsertRowid, list_id: listId, text, done: 0 });
  });
  app.put('/api/shopping-items/:id', (req, res) => {
    const item = db.prepare(`SELECT * FROM shopping_items WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    if (req.body.text !== undefined) {
      const text = demoCleanText(String(req.body.text).trim(), 120);
      if (!text) return res.status(400).json({ error: 'Item text is required.' });
      db.prepare(`UPDATE shopping_items SET text = ? WHERE id = ?`).run(text, req.params.id);
    }
    if (req.body.done !== undefined) {
      const done = req.body.done ? 1 : 0;
      const completedAt = done ? new Date().toISOString() : '';
      db.prepare(`UPDATE shopping_items SET done = ?, completed_at = ? WHERE id = ?`).run(done, completedAt, req.params.id);
    }
    broadcastUpdate('shopping');
    res.json({ ok: true });
  });
  app.delete('/api/shopping-items/:id', (req, res) => {
    db.prepare(`DELETE FROM shopping_items WHERE id = ?`).run(req.params.id);
    broadcastUpdate('shopping');
    res.json({ ok: true });
  });
  // Clears every checked-off item at once — the "I put it all away" button.
  // Scoped to one list (?list=<id> or body.list_id; the default list if neither).
  app.post('/api/shopping-list/clear-done', (req, res) => {
    const listId = resolveShoppingListId(req.query.list !== undefined ? req.query.list : (req.body && req.body.list_id));
    if (listId === null) return res.status(404).json({ error: 'List not found.' });
    const r = db.prepare(`DELETE FROM shopping_items WHERE done = 1 AND list_id = ?`).run(listId);
    broadcastUpdate('shopping');
    res.json({ ok: true, removed: r.changes });
  });
  return { defaultShoppingListId };
};
