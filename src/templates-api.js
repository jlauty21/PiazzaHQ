'use strict';
// Templates: the list of ready-made themed starting points, and applying one (creates a NEW display with both layouts).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/templates.test.js.
module.exports = function registerTemplatesApi({ app, db, broadcastUpdate, slugify, getTemplateSummaries, getTemplate, materializeWidgets }) {
  // Ready-made themed starting points. Applying one creates a NEW display (the
  // user's existing displays are never modified), seeds both orientation layouts
  // from the template, and stamps the theme so the display renders the matching
  // generated background + calendar decorations.

  app.get('/api/templates', (req, res) => {
    res.json(getTemplateSummaries());
  });

  app.post('/api/templates/apply', (req, res) => {
    const { templateId, name } = req.body;
    const tpl = getTemplate(templateId);
    if (!tpl) return res.status(404).json({ error: 'Unknown template' });

    const displayName = (name && name.trim()) ? name.trim() : tpl.name;
    const slug = slugify(displayName);
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM displays`).get().m || 0;

    const landscape = JSON.stringify(materializeWidgets(tpl.landscape, tpl.calDecor));
    const portrait  = JSON.stringify(materializeWidgets(tpl.portrait,  tpl.calDecor));

    const tx = db.transaction(() => {
      const result = db.prepare(
        `INSERT INTO displays (name, slug, sort_order, theme) VALUES (?, ?, ?, ?)`
      ).run(displayName, slug, maxOrder + 1, tpl.id);
      const id = result.lastInsertRowid;
      db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`).run(id, landscape);
      db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`).run(id, portrait);
      return id;
    });
    const newId = tx();

    broadcastUpdate('displays');
    res.status(201).json(db.prepare(`SELECT * FROM displays WHERE id = ?`).get(newId));
  });
};
