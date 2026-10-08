'use strict';
// Layout library: duplicate a display, save / list / read / apply / delete layout presets, read a display in full, and copy one display onto another.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/layout-library.test.js.
module.exports = function registerLayoutLibrary({ app, db, broadcastUpdate, resolveDisplay, slugify }) {
  // A saved layout is a complete snapshot (both orientations + theme), not tied to
  // any display. It can be applied onto an existing display or used to create a new
  // one — the user picks at apply time.

  // Helper: create a new display from explicit layout JSON strings + theme.
  function createDisplayFromLayouts(name, landscapeJson, portraitJson, theme) {
    const displayName = (name && name.trim()) ? name.trim() : 'Display';
    const slug = slugify(displayName);
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM displays`).get().m || 0;
    const tx = db.transaction(() => {
      const result = db.prepare(
        `INSERT INTO displays (name, slug, sort_order, theme) VALUES (?, ?, ?, ?)`
      ).run(displayName, slug, maxOrder + 1, theme || '');
      const id = result.lastInsertRowid;
      db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`).run(id, landscapeJson);
      db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`).run(id, portraitJson);
      return id;
    });
    return tx();
  }

  // Duplicate an existing display (its layouts + theme) into a new "… (copy)" profile.
  app.post('/api/displays/:id/duplicate', (req, res) => {
    const src = db.prepare(`SELECT * FROM displays WHERE id = ?`).get(req.params.id);
    if (!src) return res.status(404).json({ error: 'Display not found' });
    const land = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'landscape'`).get(src.id);
    const port = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'portrait'`).get(src.id);
    // Find a non-colliding name like "Kitchen (copy)", "Kitchen (copy 2)", …
    let base = `${src.name} (copy)`, name = base, n = 2;
    while (db.prepare(`SELECT id FROM displays WHERE name = ?`).get(name)) { name = `${src.name} (copy ${n++})`; }
    const newId = createDisplayFromLayouts(
      name,
      land?.widgets || '[]',
      port?.widgets || '[]',
      src.theme || ''
    );
    broadcastUpdate('displays');
    const created = db.prepare(`SELECT slug FROM displays WHERE id = ?`).get(newId);
    res.json({ ok: true, id: newId, name, slug: created?.slug });
  });

  app.get('/api/saved-layouts', (req, res) => {
    const rows = db.prepare(`SELECT id, name, theme, created_at FROM saved_layouts ORDER BY created_at DESC, id DESC`).all();
    res.json(rows);
  });

  // Full detail for ONE saved layout, including its widget data — the list
  // endpoint above deliberately omits this to stay lightweight for a picker
  // UI. Used by the Layout Switcher (widget and floating, display.html) to
  // pre-fetch what a target preset actually contains, ahead of when someone
  // taps to switch to it.
  app.get('/api/saved-layouts/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM saved_layouts WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Saved layout not found' });
    res.json({
      id: row.id, name: row.name, theme: row.theme || '', created_at: row.created_at,
      widgets_landscape: JSON.parse(row.widgets_landscape || '[]'),
      widgets_portrait: JSON.parse(row.widgets_portrait || '[]'),
    });
  });

  // Save the CURRENT layout of a display (both orientations + its theme) as a preset.
  app.post('/api/saved-layouts', (req, res) => {
    const { name, display } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'A name is required' });
    const disp = resolveDisplay(display);
    if (!disp) return res.status(404).json({ error: 'Display not found' });

    const land = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'landscape'`).get(disp.id);
    const port = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'portrait'`).get(disp.id);
    const landscape = land ? land.widgets : '[]';
    const portrait  = port ? port.widgets : '[]';

    const result = db.prepare(
      `INSERT INTO saved_layouts (name, widgets_landscape, widgets_portrait, theme) VALUES (?, ?, ?, ?)`
    ).run(name.trim(), landscape, portrait, disp.theme || '');
    res.status(201).json(db.prepare(`SELECT id, name, theme, created_at FROM saved_layouts WHERE id = ?`).get(result.lastInsertRowid));
  });

  // Apply a saved layout. mode='current' overwrites an existing display (its
  // arrangement AND theme); mode='new' creates a fresh display from the preset.
  // Core of "apply a saved layout to a live display" (mode:'current' below),
  // factored out so both the HTTP route and the MQTT bridge's layout `select`
  // entity (see mqtt-bridge.js) call the exact same logic rather than one of
  // them re-implementing it. Returns { ok:true, display_id } on success, or
  // { ok:false, status, error } — never throws, so a caller with no HTTP
  // response to write to (the MQTT bridge) doesn't need its own try/catch
  // around DB errors it can't otherwise anticipate.
  function applySavedLayoutToDisplay(presetId, displaySlugOrId) {
    const preset = db.prepare(`SELECT * FROM saved_layouts WHERE id = ?`).get(presetId);
    if (!preset) return { ok: false, status: 404, error: 'Saved layout not found' };
    // Same hardening as PUT /api/layouts/:orientation, and for the identical
    // reason — resolveDisplay() falls back to "the first display in the
    // database" for ANY unresolved slug (empty, missing, or simply not
    // matching), which is fine for a read but means a write with a bad slug
    // silently overwrites some OTHER, unrelated display instead of failing.
    // This is the DESTINATION of an apply — getting it wrong here is exactly
    // the "layouts got swapped" failure mode this was built to rule out.
    if (!displaySlugOrId) return { ok: false, status: 400, error: 'A target display slug is required.' };
    const disp = resolveDisplay(displaySlugOrId);
    if (!disp || (disp.slug !== displaySlugOrId && String(disp.id) !== String(displaySlugOrId))) {
      return { ok: false, status: 404, error: 'Target display not found' };
    }
    const tx = db.transaction(() => {
      db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`).run(disp.id, preset.widgets_landscape);
      db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`).run(disp.id, preset.widgets_portrait);
      db.prepare(`UPDATE displays SET theme = ? WHERE id = ?`).run(preset.theme || '', disp.id);
    });
    tx();
    broadcastUpdate('displays');
    broadcastUpdate('layout', disp.id);
    return { ok: true, display_id: disp.id };
  }

  app.post('/api/saved-layouts/:id/apply', (req, res) => {
    const preset = db.prepare(`SELECT * FROM saved_layouts WHERE id = ?`).get(req.params.id);
    if (!preset) return res.status(404).json({ error: 'Saved layout not found' });
    const { mode, display, name } = req.body;

    if (mode === 'new') {
      const newId = createDisplayFromLayouts(
        name || preset.name, preset.widgets_landscape, preset.widgets_portrait, preset.theme
      );
      broadcastUpdate('displays');
      return res.status(201).json(db.prepare(`SELECT * FROM displays WHERE id = ?`).get(newId));
    }

    // mode === 'current' (default): overwrite the target display
    const result = applySavedLayoutToDisplay(req.params.id, display);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, display_id: result.display_id });
  });

  // Full detail for ONE live display — both orientations' widgets + theme, in
  // the same shape GET /api/saved-layouts/:id already returns for templates.
  // Needed for the Layout Switcher to point at a live display directly, not
  // just a saved template — the pre-fetch cache reads whichever endpoint
  // matches the target's type but treats the result the same way either way.
  app.get('/api/displays/:slug/full', (req, res) => {
    const disp = resolveDisplay(req.params.slug);
    if (!disp) return res.status(404).json({ error: 'Display not found' });
    const land = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'landscape'`).get(disp.id);
    const port = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'portrait'`).get(disp.id);
    res.json({
      slug: disp.slug, name: disp.name, theme: disp.theme || '',
      widgets_landscape: JSON.parse(land?.widgets || '[]'),
      widgets_portrait: JSON.parse(port?.widgets || '[]'),
    });
  });

  // Copies THIS display's current layout (both orientations + theme) onto
  // another display — the live-display equivalent of
  // POST /api/saved-layouts/:id/apply's mode:'current'. Used both by Layout
  // Switcher (switching TO a live display copies that display's current
  // arrangement onto the screen doing the switching) and available generally
  // for the same "clone one display onto another" use a saved-layout preset
  // already offers.
  app.post('/api/displays/:slug/apply-to', (req, res) => {
    const source = resolveDisplay(req.params.slug);
    if (!source) return res.status(404).json({ error: 'Source display not found' });
    // Same hardening as the two endpoints above, same reason — this is the
    // DESTINATION of an apply (the display about to be overwritten), so an
    // unresolved slug falling back to "whichever display sorts first" here
    // is exactly the failure mode this whole pattern exists to rule out. The
    // SOURCE (req.params.slug, from the URL path) doesn't need this same
    // guard — an Express route param can't arrive empty the way a body field
    // can, and it was already checked as resolved above.
    const targetSlug = req.body && req.body.display;
    if (!targetSlug) return res.status(400).json({ error: 'A target display slug is required.' });
    const target = resolveDisplay(targetSlug);
    if (!target || (target.slug !== targetSlug && String(target.id) !== String(targetSlug))) {
      return res.status(404).json({ error: 'Target display not found' });
    }
    if (source.id === target.id) return res.status(400).json({ error: 'Source and target are the same display' });
    const land = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'landscape'`).get(source.id);
    const port = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'portrait'`).get(source.id);
    const tx = db.transaction(() => {
      db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`).run(target.id, land?.widgets || '[]');
      db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`).run(target.id, port?.widgets || '[]');
      db.prepare(`UPDATE displays SET theme = ? WHERE id = ?`).run(source.theme || '', target.id);
    });
    tx();
    broadcastUpdate('displays');
    broadcastUpdate('layout', target.id);
    res.json({ ok: true, display_id: target.id });
  });

  app.delete('/api/saved-layouts/:id', (req, res) => {
    const result = db.prepare(`DELETE FROM saved_layouts WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Saved layout not found' });
    res.json({ ok: true });
  });
  return { applySavedLayoutToDisplay };
};
