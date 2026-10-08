'use strict';
// Photo library routes: upload, label/tags/order/active, bulk slideshow selection, delete, and the photo settings.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/photos.test.js.
module.exports = function registerPhotoRoutes({ path, fs, app, db, UPLOAD_DIR, upload, broadcastUpdate }) {
  app.post('/api/photos', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const label = req.body.label || '';
    const tags = (req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean).join(',');
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM photos`).get().m || 0;
    const result = db.prepare(
      `INSERT INTO photos (filename, label, tags, sort_order) VALUES (?, ?, ?, ?)`
    ).run(req.file.filename, label, tags, maxOrder + 1);
    broadcastUpdate('photos');
    res.status(201).json(db.prepare(`SELECT * FROM photos WHERE id = ?`).get(result.lastInsertRowid));
  });

  // PUT /api/photos/:id — update label, tags, sort_order, or active (slideshow inclusion)
  app.put('/api/photos/:id', (req, res) => {
    const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const { label, tags, sort_order, active } = req.body;
    const normTags = tags !== undefined
      ? String(tags).split(',').map(t => t.trim()).filter(Boolean).join(',')
      : photo.tags;
    db.prepare(`UPDATE photos SET label=?, tags=?, sort_order=?, active=? WHERE id=?`)
      .run(
        label ?? photo.label,
        normTags,
        sort_order ?? photo.sort_order,
        active !== undefined ? (active ? 1 : 0) : photo.active,
        req.params.id
      );
    broadcastUpdate('photos');
    res.json(db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.id));
  });

  // PUT /api/photos-active — bulk set which photos are in the slideshow at once.
  // Body: { activeIds: [1,4,7] } — those become active, all others inactive.
  app.put('/api/photos-active', (req, res) => {
    const ids = Array.isArray(req.body.activeIds) ? req.body.activeIds.map(Number) : null;
    if (!ids) return res.status(400).json({ error: 'activeIds array required' });
    const setActive = db.prepare(`UPDATE photos SET active = 1 WHERE id = ?`);
    const allInactive = db.prepare(`UPDATE photos SET active = 0`);
    db.transaction(() => {
      allInactive.run();
      for (const id of ids) setActive.run(id);
    })();
    broadcastUpdate('photos');
    res.json(db.prepare(`SELECT * FROM photos ORDER BY sort_order ASC, id ASC`).all());
  });

  // DELETE /api/photos/:id — delete photo + file
  app.delete('/api/photos/:id', (req, res) => {
    const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const filePath = path.join(UPLOAD_DIR, photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare(`DELETE FROM photos WHERE id = ?`).run(req.params.id);
    broadcastUpdate('photos');
    res.json({ ok: true });
  });

  // GET /api/photo-settings
  app.get('/api/photo-settings', (req, res) => {
    const rows = db.prepare(`SELECT key, value FROM photo_settings`).all();
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
  });

  // PUT /api/photo-settings
  app.put('/api/photo-settings', (req, res) => {
    const upsert = db.prepare(`INSERT OR REPLACE INTO photo_settings (key, value) VALUES (?, ?)`);
    const tx = db.transaction(pairs => { for (const [k, v] of pairs) upsert.run(k, String(v)); });
    tx(Object.entries(req.body));
    const rows = db.prepare(`SELECT key, value FROM photo_settings`).all();
    broadcastUpdate('photo-settings');
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
  });
};
