'use strict';
// Kids: add, list, edit and remove the children the chore chart is for.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/chores-core.test.js.
module.exports = function registerKids({ app, db, broadcastUpdate }) {
  // Kids CRUD
  app.get('/api/kids', (req, res) => {
    res.json(db.prepare(`SELECT * FROM kids ORDER BY sort_order, id`).all());
  });
  app.post('/api/kids', (req, res) => {
    const { name, color, avatar, display_mode, allowance_enabled, allowance_mode, weekly_rate, savings_goal_name, savings_goal_amount, sticker_style, sticker_emoji } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const max = db.prepare(`SELECT MAX(sort_order) m FROM kids`).get().m || 0;
    const r = db.prepare(`INSERT INTO kids
    (name, color, avatar, display_mode, sort_order, allowance_enabled, allowance_mode, weekly_rate, savings_goal_name, savings_goal_amount, sticker_style, sticker_emoji)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        name.trim(), color || '#4A90D9', avatar || '🙂', display_mode || 'both', max + 1,
        allowance_enabled ? 1 : 0, allowance_mode || 'per_chore', Number(weekly_rate) || 0,
        (savings_goal_name || '').trim(), Number(savings_goal_amount) || 0,
        sticker_style || 'star', (sticker_emoji || '').trim());
    broadcastUpdate('chores');
    res.status(201).json(db.prepare(`SELECT * FROM kids WHERE id = ?`).get(r.lastInsertRowid));
  });
  app.put('/api/kids/:id', (req, res) => {
    const { name, color, avatar, display_mode, allowance_enabled, allowance_mode, weekly_rate, savings_goal_name, savings_goal_amount, sticker_style, sticker_emoji } = req.body;
    const k = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
    if (!k) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE kids SET name=?, color=?, avatar=?, display_mode=?,
              allowance_enabled=?, allowance_mode=?, weekly_rate=?,
              savings_goal_name=?, savings_goal_amount=?, sticker_style=?, sticker_emoji=? WHERE id=?`)
      .run(name ?? k.name, color ?? k.color, avatar ?? k.avatar, display_mode ?? k.display_mode,
           (allowance_enabled ?? k.allowance_enabled) ? 1 : 0,
           allowance_mode ?? k.allowance_mode,
           (weekly_rate !== undefined ? Number(weekly_rate) || 0 : k.weekly_rate),
           (savings_goal_name !== undefined ? (savings_goal_name || '').trim() : k.savings_goal_name),
           (savings_goal_amount !== undefined ? Number(savings_goal_amount) || 0 : k.savings_goal_amount),
           sticker_style ?? k.sticker_style,
           (sticker_emoji !== undefined ? (sticker_emoji || '').trim() : k.sticker_emoji),
           k.id);
    broadcastUpdate('chores');
    res.json(db.prepare(`SELECT * FROM kids WHERE id = ?`).get(k.id));
  });
  app.delete('/api/kids/:id', (req, res) => {
    db.prepare(`DELETE FROM kids WHERE id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM chore_instances WHERE kid_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM allowance_ledger WHERE kid_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM stickers WHERE kid_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM sticker_redemptions WHERE kid_id = ?`).run(req.params.id);
    broadcastUpdate('chores');
    res.json({ ok: true });
  });
};
