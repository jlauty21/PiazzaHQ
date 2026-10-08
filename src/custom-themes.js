'use strict';
// Saved custom-theme library: snapshot the live background/decoration slots under a name, rename, overwrite, load back, delete.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/custom-themes.test.js.
module.exports = function registerCustomThemes({ fs, app, db, uploadFilePath, broadcastUpdate, getSetting, removeCustomThemeFile, copyCustomThemeFile, setSetting }) {
  // List every saved theme (background/decorations already reflected in the live
  // slots don't need re-fetching from this response — the client already has that).
  app.get('/api/custom-themes', (req, res) => {
    res.json(db.prepare(`SELECT * FROM custom_themes ORDER BY updated_at DESC, id DESC`).all());
  });
  // Save the CURRENT live custom-theme slots as a new named theme. Copies the
  // files rather than referencing the live ones, so later live edits can't
  // corrupt this snapshot.
  app.post('/api/custom-themes', (req, res) => {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A name is required.' });
    const live = {
      bg: getSetting('custom_theme_bg') || '',
      deco1: getSetting('custom_theme_deco1') || '', deco1b: getSetting('custom_theme_deco1_behavior') || 'random',
      deco2: getSetting('custom_theme_deco2') || '', deco2b: getSetting('custom_theme_deco2_behavior') || 'random',
      deco3: getSetting('custom_theme_deco3') || '', deco3b: getSetting('custom_theme_deco3_behavior') || 'random',
    };
    if (!live.bg && !live.deco1 && !live.deco2 && !live.deco3) {
      return res.status(400).json({ error: 'Build a custom theme first — upload a background or a decoration.' });
    }
    const bgFile = copyCustomThemeFile(live.bg, 'saved-bg');
    const deco1File = copyCustomThemeFile(live.deco1, 'saved-deco1');
    const deco2File = copyCustomThemeFile(live.deco2, 'saved-deco2');
    const deco3File = copyCustomThemeFile(live.deco3, 'saved-deco3');
    const r = db.prepare(`INSERT INTO custom_themes
    (name, bg_file, deco1_file, deco1_behavior, deco2_file, deco2_behavior, deco3_file, deco3_behavior)
    VALUES (?,?,?,?,?,?,?,?)`).run(name, bgFile, deco1File, live.deco1b, deco2File, live.deco2b, deco3File, live.deco3b);
    res.status(201).json(db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(r.lastInsertRowid));
  });
  // Rename a saved theme.
  app.put('/api/custom-themes/:id', (req, res) => {
    const theme = db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(req.params.id);
    if (!theme) return res.status(404).json({ error: 'Theme not found.' });
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A name is required.' });
    db.prepare(`UPDATE custom_themes SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, theme.id);
    res.json(db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(theme.id));
  });
  // Overwrite a saved theme's files with whatever is CURRENTLY in the live
  // slots — "save my edits back to this theme" after loading + tweaking it.
  app.post('/api/custom-themes/:id/update', (req, res) => {
    const theme = db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(req.params.id);
    if (!theme) return res.status(404).json({ error: 'Theme not found.' });
    // Remove this theme's OWN old files (not the live ones) before replacing them.
    for (const f of [theme.bg_file, theme.deco1_file, theme.deco2_file, theme.deco3_file]) {
      if (!f) continue;
      const p = uploadFilePath(f);
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
    const live = {
      bg: getSetting('custom_theme_bg') || '',
      deco1: getSetting('custom_theme_deco1') || '', deco1b: getSetting('custom_theme_deco1_behavior') || 'random',
      deco2: getSetting('custom_theme_deco2') || '', deco2b: getSetting('custom_theme_deco2_behavior') || 'random',
      deco3: getSetting('custom_theme_deco3') || '', deco3b: getSetting('custom_theme_deco3_behavior') || 'random',
    };
    const bgFile = copyCustomThemeFile(live.bg, 'saved-bg');
    const deco1File = copyCustomThemeFile(live.deco1, 'saved-deco1');
    const deco2File = copyCustomThemeFile(live.deco2, 'saved-deco2');
    const deco3File = copyCustomThemeFile(live.deco3, 'saved-deco3');
    db.prepare(`UPDATE custom_themes SET bg_file=?, deco1_file=?, deco1_behavior=?, deco2_file=?, deco2_behavior=?,
              deco3_file=?, deco3_behavior=?, updated_at=datetime('now') WHERE id=?`)
      .run(bgFile, deco1File, live.deco1b, deco2File, live.deco2b, deco3File, live.deco3b, theme.id);
    res.json(db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(theme.id));
  });
  // Load a saved theme INTO the live working slots — copies its files into the
  // live slots (again, copies, so tweaking after loading doesn't touch the saved
  // snapshot). Any display currently set to "Custom" picks this up immediately.
  app.post('/api/custom-themes/:id/load', (req, res) => {
    const theme = db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(req.params.id);
    if (!theme) return res.status(404).json({ error: 'Theme not found.' });
    removeCustomThemeFile('custom_theme_bg');
    removeCustomThemeFile('custom_theme_deco1');
    removeCustomThemeFile('custom_theme_deco2');
    removeCustomThemeFile('custom_theme_deco3');
    setSetting('custom_theme_bg', copyCustomThemeFile(theme.bg_file, 'bg'));
    setSetting('custom_theme_deco1', copyCustomThemeFile(theme.deco1_file, 'deco1'));
    setSetting('custom_theme_deco1_behavior', theme.deco1_behavior || 'random');
    setSetting('custom_theme_deco2', copyCustomThemeFile(theme.deco2_file, 'deco2'));
    setSetting('custom_theme_deco2_behavior', theme.deco2_behavior || 'random');
    setSetting('custom_theme_deco3', copyCustomThemeFile(theme.deco3_file, 'deco3'));
    setSetting('custom_theme_deco3_behavior', theme.deco3_behavior || 'random');
    broadcastUpdate('displays');
    res.json({ ok: true, loadedThemeId: theme.id, loadedThemeName: theme.name });
  });
  app.delete('/api/custom-themes/:id', (req, res) => {
    const theme = db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(req.params.id);
    if (!theme) return res.status(404).json({ error: 'Theme not found.' });
    for (const f of [theme.bg_file, theme.deco1_file, theme.deco2_file, theme.deco3_file]) {
      if (!f) continue;
      const p = uploadFilePath(f);
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
    db.prepare(`DELETE FROM custom_themes WHERE id = ?`).run(theme.id);
    res.json({ ok: true });
  });
};
