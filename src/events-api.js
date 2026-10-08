'use strict';
// Calendar events API: the combined event list (local + calendar feeds, with hidden/opacity handling), the manage list, and create / edit / delete (with the CalDAV and Google push).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/crud.test.js.
module.exports = function registerEventsApi({ app, demoCleanText, db, broadcastUpdate, pushLocalEventToCalDAV, deleteEventFromCalDAV, pushLocalEventToGoogle, deleteEventFromGoogle }) {
  // Resolves each iCal-sourced event's color_opacity to its EFFECTIVE value —
  // the master default (feed_default_opacity) for any feed that hasn't opted
  // out via its own use_global_opacity=0, or that feed's own color_opacity
  // otherwise. Called once on every events response so the client
  // (eventPillColor() in display.html) only ever has to reason about ONE
  // already-correct opacity per event — it never needs to know this master-
  // default/per-feed tier exists at all, same idea as eventPillColor() itself
  // hiding the per-widget-override tier from every OTHER part of the app.
  // Mutates events in place (this app's established convention — see
  // mergeEvents() and friends) and strips use_global_opacity before
  // returning, since it's an internal resolution detail the client has no
  // use for once this has already run.
  function resolveEventOpacity(events) {
    const masterRow = db.prepare(`SELECT value FROM settings WHERE key = 'feed_default_opacity'`).get();
    let master = masterRow ? parseInt(masterRow.value, 10) : 100;
    if (Number.isNaN(master)) master = 100;
    events.forEach(e => {
      if (e.source === 'ical' && e.use_global_opacity) e.color_opacity = master;
      delete e.use_global_opacity;
    });
    return events;
  }

  app.get('/api/events', (req, res) => {
    const { from, to } = req.query;

    // Local events — an event "overlaps" the [from, to] window if its span
    // (date .. end_date-or-date) intersects that window at all.
    let query = `SELECT *, 'local' as source FROM events`;
    const params = [];
    if (from && to) {
      query += ` WHERE date <= ? AND COALESCE(end_date, date) >= ?`;
      params.push(to, from);
    } else if (from) {
      query += ` WHERE COALESCE(end_date, date) >= ?`;
      params.push(from);
    }
    query += ` ORDER BY date ASC, start_time ASC`;
    const localEvents = db.prepare(query).all(...params);

    // iCal events (join with feed for color + enabled flag). The raw location and
    // the feed's show_location flag both go out; the display resolves visibility
    // (feed default -> per-widget master toggle -> per-widget-per-feed override),
    // exactly like the per-feed opacity override already works.
    let icalQuery = `
    SELECT ie.uid as id, ie.title, ie.date, ie.end_date, ie.start_time, ie.end_time, ie.notes,
           ie.location as location, f.show_location as show_location,
           f.id as feed_id, f.color, f.color_opacity, f.use_global_opacity, f.color_timed, f.name as feed_name, 'ical' as source
    FROM ical_events ie
    JOIN ical_feeds f ON f.id = ie.feed_id
    WHERE f.enabled = 1
  `;
    const icalParams = [];
    if (from && to) {
      icalQuery += ` AND ie.date <= ? AND COALESCE(ie.end_date, ie.date) >= ?`;
      icalParams.push(to, from);
    } else if (from) {
      icalQuery += ` AND COALESCE(ie.end_date, ie.date) >= ?`;
      icalParams.push(from);
    }
    icalQuery += ` ORDER BY ie.date ASC, ie.start_time ASC`;
    const icalEvents = db.prepare(icalQuery).all(...icalParams);

    // Merge and sort
    const all = resolveEventOpacity([...localEvents, ...icalEvents]).sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (!a.start_time) return -1;
      if (!b.start_time) return 1;
      return a.start_time < b.start_time ? -1 : 1;
    });

    // Drop anything the user has hidden. Series hides remove every occurrence of that
    // event key; occurrence hides remove only the matching date.
    const hidden = db.prepare(`SELECT event_key, scope, date FROM hidden_events`).all();
    if (hidden.length) {
      const seriesHidden = new Set(hidden.filter(h => h.scope === 'series').map(h => h.event_key));
      const occHidden = new Set(hidden.filter(h => h.scope !== 'series').map(h => `${h.event_key}|${h.date}`));
      const keyOf = (e) => e.source === 'ical' ? `ical:${e.id}` : `local:${e.id}`;
      const visible = all.filter(e => {
        const k = keyOf(e);
        if (seriesHidden.has(k)) return false;
        if (occHidden.has(`${k}|${e.date}`)) return false;
        return true;
      });
      return res.json(visible);
    }
    res.json(all);
  });

  // each annotated with its hidden state and a stable key, so the Events tab can
  // search and toggle visibility. Defaults to a forward-looking window.
  app.get('/api/events-manage', (req, res) => {
    const _today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
    const from = req.query.from || _today;
    const to = req.query.to || (() => { const d = new Date(); d.setDate(d.getDate() + 365); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

    const localEvents = db.prepare(
      `SELECT *, 'local' as source FROM events WHERE date <= ? AND COALESCE(end_date, date) >= ? ORDER BY date ASC, start_time ASC`
    ).all(to, from);
    const icalEvents = db.prepare(`
    SELECT ie.uid as id, ie.title, ie.date, ie.end_date, ie.start_time, ie.end_time, ie.notes,
           ie.location as location, f.show_location as show_location,
           f.id as feed_id, f.color, f.color_opacity, f.use_global_opacity, f.name as feed_name, 'ical' as source
    FROM ical_events ie JOIN ical_feeds f ON f.id = ie.feed_id
    WHERE f.enabled = 1 AND ie.date <= ? AND COALESCE(ie.end_date, ie.date) >= ?
    ORDER BY ie.date ASC, ie.start_time ASC
  `).all(to, from);

    const hidden = db.prepare(`SELECT event_key, scope, date FROM hidden_events`).all();
    const seriesHidden = new Set(hidden.filter(h => h.scope === 'series').map(h => h.event_key));
    const occHidden = new Set(hidden.filter(h => h.scope !== 'series').map(h => `${h.event_key}|${h.date}`));

    const annotate = (e) => {
      const key = e.source === 'ical' ? `ical:${e.id}` : `local:${e.id}`;
      const isSeries = seriesHidden.has(key);
      const isOcc = occHidden.has(`${key}|${e.date}`);
      return { ...e, event_key: key, hidden_series: isSeries, hidden_occurrence: isOcc,
               // ical events can recur; local events are single (no series concept unless multi-day)
               recurring: e.source === 'ical' };
    };
    const all = resolveEventOpacity([...localEvents, ...icalEvents]).map(annotate).sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (!a.start_time) return -1;
      if (!b.start_time) return 1;
      return a.start_time < b.start_time ? -1 : 1;
    });
    res.json(all);
  });

  // POST /api/events
  // Coerce a client-supplied owner_profile_id to a positive integer or null. Any
  // junk (0, negative, non-numeric, absent) becomes null = unassigned — we don't
  // verify the profile row exists here; a stale id just renders with the default
  // colour, same as null, and a real orphan is cleaned up on profile delete.
  function coerceOwnerProfileId(v) {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  app.post('/api/events', (req, res) => {
    let { title, date, end_date, start_time, end_time, color, notes, location, target_calendar, owner_profile_id } = req.body;
    if (!title || !date) {
      return res.status(400).json({ error: 'title and date are required' });
    }
    title = demoCleanText(title, 120);
    notes = demoCleanText(notes, 500);
    location = demoCleanText(location, 300);
    // Normalize: an end_date equal to or before the start date just means "single day"
    const normalizedEndDate = (end_date && end_date > date) ? end_date : null;
    // 'local' | 'google' | 'caldav:<url>' — where this one event should be
    // pushed. Anything unrecognized (or absent) is stored as NULL = the
    // legacy "push to whatever's enabled" default.
    const tc = (typeof target_calendar === 'string' && /^(local|google|caldav:.+)$/.test(target_calendar)) ? target_calendar : null;
    const ownerId = coerceOwnerProfileId(owner_profile_id);
    const result = db.prepare(`
    INSERT INTO events (title, date, end_date, start_time, end_time, color, notes, location, target_calendar, owner_profile_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, date, normalizedEndDate, start_time || null, end_time || null, color || '#4A90D9', notes || '', location || '', tc, ownerId);
    const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(result.lastInsertRowid);
    broadcastUpdate('events');
    res.status(201).json(event);
    pushLocalEventToCalDAV(event); // fire-and-forget; self-swallows all errors, no-ops if iCloud push isn't configured
    pushLocalEventToGoogle(event); // ditto for Google Calendar
  });

  // PUT /api/events/:id
  app.put('/api/events/:id', (req, res) => {
    let { title, date, end_date, start_time, end_time, color, notes, location, owner_profile_id } = req.body;
    const existing = db.prepare(`SELECT * FROM events WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    if (title !== undefined) title = demoCleanText(title, 120);
    if (notes !== undefined) notes = demoCleanText(notes, 500);
    if (location !== undefined) location = demoCleanText(location, 300);

    const finalDate = date ?? existing.date;
    let finalEndDate = end_date !== undefined ? end_date : existing.end_date;
    if (finalEndDate && finalEndDate <= finalDate) finalEndDate = null;

    db.prepare(`
    UPDATE events SET title=?, date=?, end_date=?, start_time=?, end_time=?, color=?, notes=?, location=?, owner_profile_id=?
    WHERE id=?
  `).run(
      title ?? existing.title,
      finalDate,
      finalEndDate,
      start_time !== undefined ? start_time : existing.start_time,
      end_time   !== undefined ? end_time   : existing.end_time,
      color ?? existing.color,
      notes ?? existing.notes,
      location !== undefined ? location : existing.location,
      owner_profile_id !== undefined ? coerceOwnerProfileId(owner_profile_id) : existing.owner_profile_id,
      req.params.id
    );
    broadcastUpdate('events');
    const updated = db.prepare(`SELECT * FROM events WHERE id = ?`).get(req.params.id);
    res.json(updated);
    pushLocalEventToCalDAV(updated); // re-PUTs to the same deterministic remote URL — handles both edit and first-push-after-enabling
    pushLocalEventToGoogle(updated);
  });

  // DELETE /api/events/:id
  app.delete('/api/events/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM events WHERE id = ?`).get(req.params.id); // read BEFORE delete — need caldav_url
    const result = db.prepare(`DELETE FROM events WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Event not found' });
    broadcastUpdate('events');
    res.json({ ok: true });
    if (existing) { deleteEventFromCalDAV(existing); deleteEventFromGoogle(existing); } // fire-and-forget; each no-ops if this event was never pushed there
  });
  return { coerceOwnerProfileId };
};
