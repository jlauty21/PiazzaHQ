'use strict';
// Built-in To-Do lists: named lists with items, a done state and an order (fully local, separate from the Todoist widget).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/todo-lists.test.js.
module.exports = function registerTodoLists({ app, db, demoCleanText, broadcastUpdate }) {
  // Deliberately separate from the Todoist-backed Tasks widget — see the schema
  // comment above todo_lists for why.
  app.get('/api/todo-lists', (req, res) => {
    const lists = db.prepare(`
    SELECT tl.*,
      (SELECT COUNT(*) FROM todo_items ti WHERE ti.list_id = tl.id AND ti.done = 0) as itemCount
    FROM todo_lists tl ORDER BY tl.sort_order, tl.id
  `).all();
    res.json(lists);
  });
  app.post('/api/todo-lists', (req, res) => {
    const name = demoCleanText((req.body.name || '').trim(), 60);
    if (!name) return res.status(400).json({ error: 'A list name is required.' });
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM todo_lists`).get();
    const info = db.prepare(`INSERT INTO todo_lists (name, sort_order) VALUES (?, ?)`)
      .run(name, (maxOrder.m || 0) + 1);
    broadcastUpdate('todos');
    res.json({ id: info.lastInsertRowid, name, sort_order: (maxOrder.m || 0) + 1 });
  });
  app.put('/api/todo-lists/:id', (req, res) => {
    const list = db.prepare(`SELECT id FROM todo_lists WHERE id = ?`).get(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found.' });
    if (req.body.name !== undefined) {
      const name = demoCleanText(String(req.body.name).trim(), 60);
      if (!name) return res.status(400).json({ error: 'A list name is required.' });
      db.prepare(`UPDATE todo_lists SET name = ? WHERE id = ?`).run(name, req.params.id);
    }
    if (req.body.sort_order !== undefined) {
      db.prepare(`UPDATE todo_lists SET sort_order = ? WHERE id = ?`).run(Number(req.body.sort_order) || 0, req.params.id);
    }
    broadcastUpdate('todos');
    res.json({ ok: true });
  });
  app.delete('/api/todo-lists/:id', (req, res) => {
    db.prepare(`DELETE FROM todo_items WHERE list_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM todo_lists WHERE id = ?`).run(req.params.id);
    broadcastUpdate('todos');
    res.json({ ok: true });
  });

  app.get('/api/todo-lists/:id/items', (req, res) => {
    const items = db.prepare(`SELECT * FROM todo_items WHERE list_id = ? ORDER BY done, sort_order, id`).all(req.params.id);
    res.json(items);
  });
  app.post('/api/todo-lists/:id/items', (req, res) => {
    const text = demoCleanText((req.body.text || '').trim(), 120);
    if (!text) return res.status(400).json({ error: 'Item text is required.' });
    const list = db.prepare(`SELECT id FROM todo_lists WHERE id = ?`).get(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found.' });
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM todo_items WHERE list_id = ?`).get(req.params.id);
    const info = db.prepare(`INSERT INTO todo_items (list_id, text, sort_order) VALUES (?, ?, ?)`)
      .run(req.params.id, text, (maxOrder.m || 0) + 1);
    broadcastUpdate('todos');
    res.json({ id: info.lastInsertRowid, list_id: Number(req.params.id), text, done: 0 });
  });
  app.put('/api/todo-items/:id', (req, res) => {
    const item = db.prepare(`SELECT * FROM todo_items WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    if (req.body.text !== undefined) {
      const text = demoCleanText(String(req.body.text).trim(), 120);
      if (!text) return res.status(400).json({ error: 'Item text is required.' });
      db.prepare(`UPDATE todo_items SET text = ? WHERE id = ?`).run(text, req.params.id);
    }
    if (req.body.done !== undefined) {
      const done = req.body.done ? 1 : 0;
      const completedAt = done ? new Date().toISOString() : '';
      db.prepare(`UPDATE todo_items SET done = ?, completed_at = ? WHERE id = ?`).run(done, completedAt, req.params.id);
    }
    if (req.body.sort_order !== undefined) {
      db.prepare(`UPDATE todo_items SET sort_order = ? WHERE id = ?`).run(Number(req.body.sort_order) || 0, req.params.id);
    }
    broadcastUpdate('todos');
    res.json({ ok: true });
  });
  app.delete('/api/todo-items/:id', (req, res) => {
    db.prepare(`DELETE FROM todo_items WHERE id = ?`).run(req.params.id);
    broadcastUpdate('todos');
    res.json({ ok: true });
  });
};
