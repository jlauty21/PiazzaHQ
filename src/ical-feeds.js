'use strict';
// iCal feeds API: add, edit, remove and sync calendar feeds (ICS links, Google and iCloud sources).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/ical*.test.js, google-calendar-pull, icloud-calendar-pull.
module.exports = function registerIcalFeeds({ app, db, markHostEditing, broadcastUpdate, isGoogleFeedUrl, googleFeedUrlValid, isIcloudFeedUrl, icloudFeedUrlValid, syncFeed }) {

  // GET /api/feeds
  app.get('/api/feeds', (req, res) => {
    const feeds = db.prepare(`SELECT * FROM ical_feeds ORDER BY id ASC`).all();
    const masterRow = db.prepare(`SELECT value FROM settings WHERE key = 'feed_default_opacity'`).get();
    let master = masterRow ? parseInt(masterRow.value, 10) : 100;
    if (Number.isNaN(master)) master = 100;
    // effective_opacity: what's ACTUALLY applied right now (the master default
    // if this feed hasn't opted out, its own color_opacity otherwise) — kept
    // alongside the raw color_opacity/use_global_opacity fields rather than
    // replacing them, since the Calendar Feeds edit UI needs the RAW state
    // (is the checkbox on, what's this feed's own stored slider value) while
    // the per-widget-override list (see populateFeedOpacityOverrideList() in
    // app.html) needs the resolved one, as the accurate starting point for
    // "here's what this feed currently looks like before you override it."
    res.json(feeds.map(f => ({ ...f, effective_opacity: f.use_global_opacity ? master : f.color_opacity })));
  });

  // POST /api/feeds
  app.post('/api/feeds', async (req, res) => {
    const { name, url, color } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
    if (isGoogleFeedUrl(url) && !googleFeedUrlValid(url)) return res.status(400).json({ error: 'That Google calendar id does not look right.' });
    if (isIcloudFeedUrl(url) && !icloudFeedUrlValid(url)) return res.status(400).json({ error: 'That iCloud calendar address does not look right. Pick the calendar from the list instead.' });
    try {
      const result = db.prepare(
        `INSERT INTO ical_feeds (name, url, color) VALUES (?, ?, ?)`
      ).run(name, url, color || '#a78bfa');
      const feed = db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(result.lastInsertRowid);
      broadcastUpdate('feeds');
      // Sync immediately, but don't let a sync failure undo adding the feed —
      // the URL might just be transiently unreachable, and the person can retry
      // the sync later without having to re-add it from scratch. Instead, report
      // the sync outcome honestly so a failure is visible rather than silently
      // looking like a successful "0 events" sync.
      try {
        await syncFeed(feed);
        broadcastUpdate('events');
        res.status(201).json({ ...feed, sync_warning: null });
      } catch (syncErr) {
        res.status(201).json({ ...feed, sync_warning: syncErr.message });
      }
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Feed URL already exists' });
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/feeds/:id
  app.put('/api/feeds/:id', async (req, res) => {
    const { name, url, color, color_timed, show_location, color_opacity, use_global_opacity, enabled } = req.body;
    const feed = db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(req.params.id);
    if (!feed) return res.status(404).json({ error: 'Feed not found' });

    const newUrl = (url !== undefined && url !== null && url.trim() !== '') ? url.trim() : feed.url;
    const urlChanged = newUrl !== feed.url;
    if (urlChanged && isGoogleFeedUrl(newUrl) && !googleFeedUrlValid(newUrl)) return res.status(400).json({ error: 'That Google calendar id does not look right.' });
    if (urlChanged && isIcloudFeedUrl(newUrl) && !icloudFeedUrlValid(newUrl)) return res.status(400).json({ error: 'That iCloud calendar address does not look right. Pick the calendar from the list instead.' });

    // Clamp defensively — this is a percentage a slider writes, but nothing
    // stops a malformed/out-of-range value arriving some other way, and an
    // opacity outside 0-100 would produce a nonsensical (or invalid) CSS
    // color wherever feedColorWithOpacity() applies it downstream.
    let newOpacity = feed.color_opacity;
    if (color_opacity !== undefined && color_opacity !== null) {
      const n = parseInt(color_opacity, 10);
      if (!Number.isNaN(n)) newOpacity = Math.max(0, Math.min(100, n));
    }

    try {
      db.prepare(`UPDATE ical_feeds SET name=?, url=?, color=?, color_timed=?, show_location=?, color_opacity=?, use_global_opacity=?, enabled=? WHERE id=?`)
        .run(
          name ?? feed.name,
          newUrl,
          color ?? feed.color,
          color_timed !== undefined ? (color_timed ? 1 : 0) : feed.color_timed,
          show_location !== undefined ? (show_location ? 1 : 0) : feed.show_location,
          newOpacity,
          use_global_opacity !== undefined ? (use_global_opacity ? 1 : 0) : feed.use_global_opacity,
          enabled !== undefined ? enabled : feed.enabled,
          req.params.id
        );
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Another calendar already uses that URL' });
      return res.status(500).json({ error: e.message });
    }

    const updated = db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(req.params.id);

    // If the URL changed, the existing events belong to the old calendar — clear them
    // and re-sync from the new URL. Report a sync warning rather than failing the whole
    // edit if the new URL can't be fetched (consistent with how adding a feed behaves).
    let sync_warning = null;
    if (urlChanged) {
      db.prepare(`DELETE FROM ical_events WHERE feed_id = ?`).run(req.params.id);
      try {
        await syncFeed(updated);
      } catch (syncErr) {
        sync_warning = syncErr.message;
      }
    }

    broadcastUpdate('feeds');
    broadcastUpdate('events');
    // Same reasoning as the master-opacity fix in PUT /api/settings above: this
    // broadcastUpdate() only reaches SSE clients on THIS device. A feed edit
    // (opacity, color, "use global default," etc.) previously didn't mark the
    // host as actively being edited, so a slave display picked it up on its
    // normal 15s poll rather than the 1.5s fast one layout saves already get.
    markHostEditing();
    res.json({ ...db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(req.params.id), sync_warning });
  });

  // DELETE /api/feeds/:id
  app.delete('/api/feeds/:id', (req, res) => {
    db.prepare(`DELETE FROM ical_events WHERE feed_id = ?`).run(req.params.id);
    const result = db.prepare(`DELETE FROM ical_feeds WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Feed not found' });
    broadcastUpdate('feeds');
    broadcastUpdate('events');
    res.json({ ok: true });
  });

  // POST /api/feeds/:id/sync — manual sync trigger
  app.post('/api/feeds/:id/sync', async (req, res) => {
    const feed = db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(req.params.id);
    if (!feed) return res.status(404).json({ error: 'Feed not found' });
    try {
      const count = await syncFeed(feed);
      broadcastUpdate('events');
      res.json({ ok: true, events_imported: count });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
