'use strict';
// Displays API: display profiles (create, rename, theme, orientation), resolving a profile from a slug or id, the render config a screen gets, and clearing out stale preview screens.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/screens-displays.test.js.
module.exports = function registerDisplays({ app, db, seedDefaultLayoutsForDisplay, broadcastUpdate, updateSetting }) {
  // Resolves a display from a slug (preferred, used in ?display=kitchen URLs) or
  // falls back to the first display by sort_order — keeps things working for any
  // screen/URL that doesn't specify a display at all (e.g. pre-multi-display bookmarks).
  function resolveDisplay(slugOrId) {
    if (slugOrId) {
      const bySlug = db.prepare(`SELECT * FROM displays WHERE slug = ?`).get(slugOrId);
      if (bySlug) return bySlug;
      const byId = db.prepare(`SELECT * FROM displays WHERE id = ?`).get(slugOrId);
      if (byId) return byId;
    }
    return db.prepare(`SELECT * FROM displays ORDER BY sort_order ASC, id ASC LIMIT 1`).get();
  }

  function slugify(name) {
    const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'display';
    let slug = base, n = 1;
    while (db.prepare(`SELECT id FROM displays WHERE slug = ?`).get(slug)) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }

  // Auto-names a preview screen identity (device_id starting with 'preview_')
  // with a descriptive name derived from the display it's previewing, rather
  // than leaving it to show as "Unnamed display" in the Devices tab —
  // confirmed as a real point of confusion, not a hypothetical: these
  // disposable, per-display identities (see SCREEN_ID's own comment in
  // display.html for why they exist at all — a dedicated, never-colliding
  // identity specifically for "Open to Edit in New Tab") were showing up
  // indistinguishable from an unconfigured real device needing attention.
  // Returns null for anything that isn't a preview-prefixed id, so callers
  // can fall back to their own existing naming logic untouched.
  function previewScreenName(screenId) {
    if (!screenId || !screenId.startsWith('preview_')) return null;
    const slug = screenId.slice('preview_'.length);
    // Exact match only — resolveDisplay() deliberately falls back to the
    // first display in the system when nothing matches, which would be
    // actively wrong here: misnaming this preview after a display it has
    // nothing to do with, rather than a generic fallback using the slug
    // itself.
    const display = db.prepare(`SELECT name FROM displays WHERE slug = ?`).get(slug);
    return `${display ? display.name : slug} (Live Edit)`;
  }

  // Periodically deletes preview screen identities that haven't checked in for
  // longer than the configured threshold. Safe to delete outright, not just
  // hide: these are inherently disposable, single-purpose identities (see
  // previewScreenName()'s own comment for why they exist at all), and their
  // own settings — schedule rules, switcher targets — are entirely isolated
  // to that one specific preview session, stored per-device_id exactly like
  // a real screen's own settings are, never touching any real, deployed
  // screen's configuration. Confirmed directly, not assumed: both
  // floating_switcher_presets and floating_switcher_schedule are saved via
  // `UPDATE screens ... WHERE device_id = ?`, so deleting a stale preview_*
  // row can never affect anything a real screen depends on.
  // Threshold is configurable via the preview_screen_cleanup_days setting
  // (an ordinary key on /api/settings, not a dedicated endpoint), by explicit
  // request — ranges from a few days to a year, defaulting to 7, so
  // infrequent but intentional re-use of the same preview doesn't lose it
  // prematurely.
  function cleanupStalePreviewScreens() {
    try {
      const days = Number(updateSetting('preview_screen_cleanup_days', '7')) || 7;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const result = db.prepare(`DELETE FROM screens WHERE device_id LIKE 'preview\\_%' ESCAPE '\\' AND last_seen < ?`).run(cutoff);
      if (result.changes > 0) broadcastUpdate('screens');
    } catch {}
  }
  setInterval(cleanupStalePreviewScreens, 6 * 60 * 60 * 1000); // every 6 hours — no need to check more often for a days-to-a-year-scale threshold
  cleanupStalePreviewScreens(); // also run once at boot, so a long-stale entry doesn't have to wait for the first interval tick

  app.get('/api/displays', (req, res) => {
    res.json(db.prepare(`SELECT * FROM displays ORDER BY sort_order ASC, id ASC`).all());
  });

  // GET /api/display-config?display=kitchen&device=scr_xxx — the resolved render config
  // (orientation override + rotation). The physical SCREEN's own orientation/rotation, if
  // set, takes precedence over the profile's — so a sideways-mounted TV stays portrait no
  // matter which profile it shows. Unset ('' / -1) falls back to the profile's values.
  app.get('/api/display-config', (req, res) => {
    const display = resolveDisplay(req.query.display);
    if (!display) return res.status(404).json({ error: 'No displays exist yet' });

    let force_orientation = display.force_orientation || 'auto';
    let rotation = display.rotation || 0;
    let screensaverTag = '';
    let screensaverPhotoId = null;
    let ambientMode = '';
    let ambientClockCorner = 'bl';
    let ambientPhotoFit = 'cover';
    let ambientFadeTransition = true;
    let ambientPhotoInterval = '';
    let ambientBlurBg = true;
    let ambientFadeDuration = '2';
    let fxScale = '1';
    let fxDensity = '1';

    const deviceId = (req.query.device || req.query.screen || '').toString();
    if (deviceId) {
      const scr = db.prepare(`SELECT screen_orientation, screen_rotation, screensaver_tag, screensaver_photo_id, ambient_mode, ambient_clock_corner, ambient_photo_fit, ambient_fade_transition, ambient_photo_interval, ambient_blur_bg, ambient_fade_duration, fx_scale, fx_density FROM screens WHERE device_id = ?`).get(deviceId);
      if (scr) {
        if (scr.screen_orientation && scr.screen_orientation !== '') force_orientation = scr.screen_orientation;
        if (typeof scr.screen_rotation === 'number' && scr.screen_rotation >= 0) rotation = scr.screen_rotation;
        screensaverTag = scr.screensaver_tag || '';
        screensaverPhotoId = scr.screensaver_photo_id || null;
        ambientMode = scr.ambient_mode || '';
        ambientClockCorner = scr.ambient_clock_corner || 'bl';
        ambientPhotoFit = scr.ambient_photo_fit || 'cover';
        ambientFadeTransition = scr.ambient_fade_transition !== '0';
        ambientPhotoInterval = scr.ambient_photo_interval || '';
        ambientBlurBg = scr.ambient_blur_bg !== '0';
        ambientFadeDuration = scr.ambient_fade_duration || '2';
        fxScale = scr.fx_scale || '1';
        fxDensity = scr.fx_density || '1';
      }
    }

    res.json({
      id: display.id,
      name: display.name,
      slug: display.slug,
      force_orientation,
      rotation,
      theme: display.theme || '',
      fontFamily: display.font_family || '',
      screensaverTag,
      screensaverPhotoId,
      ambientMode,
      ambientClockCorner,
      ambientPhotoFit,
      ambientFadeTransition,
      ambientPhotoInterval,
      ambientBlurBg,
      ambientFadeDuration,
      fxScale,
      fxDensity,
      customBg: updateSetting('custom_theme_bg', ''),
      customDeco1: updateSetting('custom_theme_deco1', ''),
      customDeco2: updateSetting('custom_theme_deco2', ''),
      customDeco3: updateSetting('custom_theme_deco3', ''),
      customDeco1Behavior: updateSetting('custom_theme_deco1_behavior', 'random'),
      customDeco2Behavior: updateSetting('custom_theme_deco2_behavior', 'random'),
      customDeco3Behavior: updateSetting('custom_theme_deco3_behavior', 'random'),
    });
  });

  app.post('/api/displays', (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'A display name is required' });
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM displays`).get().m || 0;
    const slug = slugify(name);
    const result = db.prepare(`INSERT INTO displays (name, slug, sort_order) VALUES (?, ?, ?)`)
      .run(name.trim(), slug, maxOrder + 1);
    seedDefaultLayoutsForDisplay(result.lastInsertRowid);
    res.status(201).json(db.prepare(`SELECT * FROM displays WHERE id = ?`).get(result.lastInsertRowid));
  });

  app.put('/api/displays/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM displays WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Display not found' });
    const { name, force_orientation, rotation, theme, fontFamily } = req.body;
    // Slug is intentionally NOT changed on rename — the physical screen's bookmarked
    // URL (?display=old-slug) would otherwise silently break.
    const validOrientations = ['auto', 'landscape', 'portrait'];
    const validRotations = [0, 90, 180, 270];
    const newOrientation = (force_orientation !== undefined && validOrientations.includes(force_orientation))
      ? force_orientation : existing.force_orientation;
    const newRotation = (rotation !== undefined && validRotations.includes(Number(rotation)))
      ? Number(rotation) : existing.rotation;
    const newTheme = (theme !== undefined) ? String(theme) : existing.theme;
    const newFontFamily = (fontFamily !== undefined) ? String(fontFamily) : existing.font_family;
    db.prepare(`UPDATE displays SET name=?, force_orientation=?, rotation=?, theme=?, font_family=? WHERE id=?`).run(
      name !== undefined ? name.trim() : existing.name,
      newOrientation,
      newRotation,
      newTheme,
      newFontFamily,
      req.params.id
    );
    broadcastUpdate('displays');
    res.json(db.prepare(`SELECT * FROM displays WHERE id = ?`).get(req.params.id));
  });
  return { resolveDisplay, slugify, previewScreenName };
};
