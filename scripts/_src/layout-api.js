'use strict';
// Layout API: read and save a display's widget layout (per orientation), with the widget limit and the camera reload.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/layouts*.test.js.
module.exports = function registerLayoutApi({ app, db, markHostEditing, broadcastUpdate, reloadCameraService, resolveDisplay, updateSetting }) {
  // Layouts are scoped per display. ?display=<slug-or-id> selects which one;
  // omitting it falls back to the first display (keeps old bookmarked display
  // URLs and the control app's default view working without changes).

  // GET /api/layouts/:orientation?display=kitchen
  app.get('/api/layouts/:orientation', (req, res) => {
    const display = resolveDisplay(req.query.display);
    if (!display) return res.status(404).json({ error: 'No displays exist yet' });
    const row = db.prepare(`SELECT * FROM layouts WHERE display_id = ? AND orientation = ?`)
      .get(display.id, req.params.orientation);
    if (!row) return res.status(404).json({ error: 'Layout not found' });
    res.json({ orientation: row.orientation, widgets: JSON.parse(row.widgets), display_id: display.id, display_name: display.name });
  });

  // PUT /api/layouts/:orientation?display=kitchen
  app.put('/api/layouts/:orientation', (req, res) => {
    // A WRITE must never fall back to resolveDisplay()'s own "first display in
    // the database" default the way a read reasonably can — that default
    // exists so a read shows something sensible rather than erroring out, but
    // applied to a save it means any request that omits, mis-sends, or sends a
    // stale/typo'd 'display' silently overwrites some OTHER, unrelated, and
    // often arbitrary display's real content instead of failing loudly.
    // Confirmed as a real, reported incident: a display's own layout got
    // silently replaced with a completely different one's widgets, with no
    // error and no indication anything had gone wrong, while this fallback
    // landing on whichever display happens to sort first was never ruled out
    // as the mechanism. Checking resolveDisplay()'s return isn't enough on its
    // own — it returns a display in BOTH the "slug matched" and "nothing
    // matched, here's the fallback" cases, so the only way to tell them apart
    // is to verify the slug/id actually sent was actually what came back.
    const requested = req.query.display;
    if (!requested) return res.status(400).json({ error: 'A display slug is required to save a layout.' });
    const display = resolveDisplay(requested);
    if (!display || (display.slug !== requested && String(display.id) !== String(requested))) {
      return res.status(404).json({ error: 'That display could not be found.' });
    }
    const { widgets } = req.body;
    if (!Array.isArray(widgets)) return res.status(400).json({ error: 'widgets must be an array' });

    // Enforce the widget limit for non-active accounts — but only block genuinely
    // ADDING widgets beyond what this layout already had, same "never retroactively
    // lock someone out" principle as the device limit above. A layout that's
    // already over the limit (e.g. from before a limit applied, or after a
    // downgrade) can still be edited/rearranged — this only stops growing it further.
    try {
      const limitsRaw = updateSetting('limits_cache', '');
      const limits = limitsRaw ? JSON.parse(limitsRaw) : null;
      if (limits && typeof limits.maxWidgets === 'number') {
        const existingRow = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = ?`).get(display.id, req.params.orientation);
        const previousCount = existingRow ? (JSON.parse(existingRow.widgets || '[]').length || 0) : 0;
        if (widgets.length > limits.maxWidgets && widgets.length > previousCount) {
          return res.status(403).json({
            error: `This account is limited to ${limits.maxWidgets} widgets.`,
          });
        }
      }
    } catch { /* if the cache is missing/malformed, fail open rather than block a legitimate save */ }

    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, ?, ?)`)
      .run(display.id, req.params.orientation, JSON.stringify(widgets));
    markHostEditing();           // frequent layout saves = active editing; slaves speed up
    broadcastUpdate('layout', display.id);
    // A camera widget may have just been added or removed anywhere in the fleet —
    // (re)start or stop the local go2rtc media process to match.
    reloadCameraService();
    res.json({ ok: true });
  });
};
