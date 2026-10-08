'use strict';
// Live custom-theme slots: one background and three decorations (upload, replace, clear) and each decoration's behaviour; also the helpers the saved-theme library uses to copy / remove those files.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/custom-theme-slots.test.js and custom-themes.test.js.
module.exports = function registerCustomThemeSlots({ path, fs, app, CUSTOM_THEME_DIR, uploadFilePath, uploadCustomBg, uploadCustomDeco, broadcastUpdate, setSetting, updateSetting }) {
  // Deliberately global settings, not per-display — a display's "theme" picks
  // among Piazza HQ's built-in themes PLUS whichever custom theme is currently
  // loaded into these "live" slots below. See the custom_themes table above for
  // the named, saved-snapshot side of this — these settings are just the mutable
  // working copy that gets edited live and shown on displays set to "Custom".
  // Old files are removed on replacement/removal so they don't silently
  // accumulate on disk over time.
  const VALID_DECO_BEHAVIORS = new Set(['top', 'bottom', 'left', 'right', 'random']);
  function removeCustomThemeFile(settingKey) {
    const existing = updateSetting(settingKey, '');
    if (!existing) return;
    const filePath = uploadFilePath(existing);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* best-effort */ }
  }
  // Physically copies a custom-theme file (background or decoration) to a fresh,
  // independent filename in the same directory — used any time a saved theme and
  // the live working slots need to stop sharing a file, so editing one can never
  // silently corrupt the other. urlPath is like "/uploads/custom-theme/bg_123.png";
  // returns the new url path, or '' if there was nothing to copy.
  function copyCustomThemeFile(urlPath, prefix) {
    if (!urlPath) return '';
    const srcPath = uploadFilePath(urlPath);
    if (!fs.existsSync(srcPath)) return '';
    const ext = path.extname(srcPath);
    const newName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(CUSTOM_THEME_DIR, newName);
    fs.copyFileSync(srcPath, destPath);
    return `/uploads/custom-theme/${newName}`;
  }

  app.post('/api/custom-theme/background', uploadCustomBg.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded (must be JPEG, PNG, or WebP).' });
    removeCustomThemeFile('custom_theme_bg');
    setSetting('custom_theme_bg', `/uploads/custom-theme/${req.file.filename}`);
    broadcastUpdate('displays');
    res.json({ ok: true, url: `/uploads/custom-theme/${req.file.filename}` });
  });
  app.delete('/api/custom-theme/background', (req, res) => {
    removeCustomThemeFile('custom_theme_bg');
    setSetting('custom_theme_bg', '');
    broadcastUpdate('displays');
    res.json({ ok: true });
  });

  app.post('/api/custom-theme/decoration/:slot', uploadCustomDeco.single('image'), (req, res) => {
    const slot = Number(req.params.slot);
    if (![1, 2, 3].includes(slot)) return res.status(400).json({ error: 'Slot must be 1, 2, or 3.' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded (must be PNG, for transparency).' });
    removeCustomThemeFile(`custom_theme_deco${slot}`);
    setSetting(`custom_theme_deco${slot}`, `/uploads/custom-theme/${req.file.filename}`);
    broadcastUpdate('displays');
    res.json({ ok: true, url: `/uploads/custom-theme/${req.file.filename}` });
  });
  app.delete('/api/custom-theme/decoration/:slot', (req, res) => {
    const slot = Number(req.params.slot);
    if (![1, 2, 3].includes(slot)) return res.status(400).json({ error: 'Slot must be 1, 2, or 3.' });
    removeCustomThemeFile(`custom_theme_deco${slot}`);
    setSetting(`custom_theme_deco${slot}`, '');
    broadcastUpdate('displays');
    res.json({ ok: true });
  });
  app.put('/api/custom-theme/decoration/:slot/behavior', (req, res) => {
    const slot = Number(req.params.slot);
    if (![1, 2, 3].includes(slot)) return res.status(400).json({ error: 'Slot must be 1, 2, or 3.' });
    const behavior = (req.body && req.body.behavior || '').trim();
    if (!VALID_DECO_BEHAVIORS.has(behavior)) return res.status(400).json({ error: 'Behavior must be top, bottom, left, right, or random.' });
    setSetting(`custom_theme_deco${slot}_behavior`, behavior);
    broadcastUpdate('displays');
    res.json({ ok: true });
  });
  return { removeCustomThemeFile, copyCustomThemeFile };
};
