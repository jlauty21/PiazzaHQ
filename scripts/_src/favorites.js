'use strict';
// Favorites tab: the cards on the Favorites screen (add, list, edit, reorder, delete).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/favorites.test.js.
module.exports = function registerFavoriteCards({ app, db, broadcastUpdate }) {
  // GET is the only one that needs to be fast/simple — config is returned
  // pre-parsed from JSON so the client never touches raw JSON strings.
  app.get('/api/favorite-cards', (req, res) => {
    const rows = db.prepare(`SELECT * FROM favorite_cards ORDER BY sort_order, id`).all();
    res.json(rows.map(r => {
      let config = {};
      try { config = JSON.parse(r.config || '{}'); } catch {}
      return { ...r, config };
    }));
  });
  app.post('/api/favorite-cards', (req, res) => {
    const type = (req.body.type || '').trim();
    if (!type) return res.status(400).json({ error: 'type is required' });
    const config = req.body.config && typeof req.body.config === 'object' ? req.body.config : {};
    const max = db.prepare(`SELECT MAX(sort_order) m FROM favorite_cards`).get().m || 0;
    const r = db.prepare(`INSERT INTO favorite_cards (type, config, sort_order) VALUES (?,?,?)`)
      .run(type, JSON.stringify(config), max + 1);
    broadcastUpdate('favorites');
    res.status(201).json({ id: r.lastInsertRowid, type, config, sort_order: max + 1 });
  });
  app.put('/api/favorite-cards/:id', (req, res) => {
    const card = db.prepare(`SELECT * FROM favorite_cards WHERE id = ?`).get(req.params.id);
    if (!card) return res.status(404).json({ error: 'Not found' });
    const config = req.body.config !== undefined
      ? JSON.stringify(req.body.config && typeof req.body.config === 'object' ? req.body.config : {})
      : card.config;
    const sortOrder = req.body.sort_order !== undefined ? Number(req.body.sort_order) : card.sort_order;
    db.prepare(`UPDATE favorite_cards SET config = ?, sort_order = ? WHERE id = ?`).run(config, sortOrder, card.id);
    broadcastUpdate('favorites');
    res.json({ ok: true });
  });
  // Swap this card's sort_order with its immediate neighbor — a simpler,
  // lower-risk reorder primitive than accepting a full reordered id list from
  // the client (nothing to validate/reconcile against a race if two browsers
  // reorder at once; each move is just one atomic swap).
  app.post('/api/favorite-cards/:id/move', (req, res) => {
    const dir = req.body.direction === 'up' ? -1 : 1;
    const cards = db.prepare(`SELECT * FROM favorite_cards ORDER BY sort_order, id`).all();
    const idx = cards.findIndex(c => c.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= cards.length) return res.json({ ok: true }); // already at an edge — no-op, not an error
    const a = cards[idx], b = cards[swapIdx];
    const tx = db.transaction(() => {
      db.prepare(`UPDATE favorite_cards SET sort_order = ? WHERE id = ?`).run(b.sort_order, a.id);
      db.prepare(`UPDATE favorite_cards SET sort_order = ? WHERE id = ?`).run(a.sort_order, b.id);
    });
    tx();
    broadcastUpdate('favorites');
    res.json({ ok: true });
  });
  app.delete('/api/favorite-cards/:id', (req, res) => {
    db.prepare(`DELETE FROM favorite_cards WHERE id = ?`).run(req.params.id);
    broadcastUpdate('favorites');
    res.json({ ok: true });
  });
};
