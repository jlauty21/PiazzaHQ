'use strict';
// Presentations: decks (an ordered set of page images, made in the control app from a PDF or from pictures) and showing one on a screen, started,
// stopped and stepped by hand or timed. The control app turns each page into a picture in the browser, so the server (often a Pi) never converts
// anything; it stores the pictures, the order and the deck's settings. Covered by test/api/presentations.test.js.
//
// Files live under uploads/decks/<deckId>/ (page: p<pageId>.<ext>, small preview: t<pageId>.jpg). Mirrors copy them with the photos (see syncPhotoFiles
// in server.js) and receive the two tables in the sync snapshot.
//
// Which deck a screen is showing is stored on the screen (screens.presentation_deck_id / presentation_mode: '' stopped, 'auto' timed, 'manual' by hand),
// so a screen that restarts goes back to its presentation. The page it is on is only held in memory: the display reports it after every change.
// A screen that belongs to another device (a mirror) is controlled by passing the request on to that device's own server, like the TV buttons.
module.exports = function registerPresentations({ path, fs, app, db, UPLOAD_DIR, multer, broadcastUpdate, sendScreenCommand, DEVICE_ID, PORT, http, URL }) {
  const DECKS_DIR = path.join(UPLOAD_DIR, 'decks');
  const MAX_DECKS = 50;
  const MAX_PAGES = 200;
  const TRANSITIONS = ['fade', 'slide', 'none'];
  const FITS = ['contain', 'cover'];
  const BACKGROUNDS = ['black', 'white', 'blur'];
  const MODES = ['auto', 'manual'];
  const ROTATIONS = [0, 90, 180, 270];
  const turnOf = (v, dflt) => { const n = Number(v); return ROTATIONS.includes(n) ? n : dflt; };

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 2 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
  });
  const pageUpload = upload.fields([{ name: 'page', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);

  const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
  const cleanName = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  const extFor = (mime) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');
  const urlOf = (rel) => (rel ? '/uploads/' + rel : '');

  function deckRow(id) { return db.prepare(`SELECT * FROM decks WHERE id = ?`).get(id); }
  function pagesOf(deckId) { return db.prepare(`SELECT * FROM deck_pages WHERE deck_id = ? ORDER BY position ASC, id ASC`).all(deckId); }
  function pageOut(p) { return { id: p.id, position: p.position, url: urlOf(p.filename), thumb: urlOf(p.thumb || p.filename), duration_sec: p.duration_sec || 0, rotation: ROTATIONS.includes(p.rotation) ? p.rotation : -1 }; }
  function deckOut(d, pages) {
    const out = {
      id: d.id, name: d.name, interval_sec: d.interval_sec, loop: !!d.looping, transition: d.transition, fit: d.fit, background: d.background,
      touch: !!d.touch, rotation: ROTATIONS.includes(d.rotation) ? d.rotation : 0, created_at: d.created_at,
    };
    if (pages) { out.pages = pages.map(pageOut); out.page_count = pages.length; }
    return out;
  }
  function removeDeckFiles(deckId) { try { fs.rmSync(path.join(DECKS_DIR, String(deckId)), { recursive: true, force: true }); } catch { /* nothing to remove */ } }
  function removeFile(rel) { if (!rel) return; try { fs.unlinkSync(path.join(UPLOAD_DIR, rel)); } catch { /* already gone */ } }

  // ── decks ──────────────────────────────────────────────────────────────────────────────────────────
  app.get('/api/decks', (req, res) => {
    const rows = db.prepare(`SELECT * FROM decks ORDER BY sort_order ASC, id ASC`).all();
    const counts = Object.fromEntries(db.prepare(`SELECT deck_id, COUNT(*) AS n FROM deck_pages GROUP BY deck_id`).all().map((r) => [r.deck_id, r.n]));
    res.json(rows.map((d) => {
      const first = db.prepare(`SELECT * FROM deck_pages WHERE deck_id = ? ORDER BY position ASC, id ASC LIMIT 1`).get(d.id);
      return { ...deckOut(d), page_count: counts[d.id] || 0, cover: first ? urlOf(first.thumb || first.filename) : '' };
    }));
  });

  app.post('/api/decks', (req, res) => {
    const b = req.body || {};
    const name = cleanName(b.name);
    if (!name) return res.status(400).json({ error: 'Give the presentation a name.' });
    if (db.prepare(`SELECT COUNT(*) AS n FROM decks`).get().n >= MAX_DECKS) return res.status(400).json({ error: `You can have up to ${MAX_DECKS} presentations. Delete one first.` });
    const max = db.prepare(`SELECT MAX(sort_order) AS m FROM decks`).get().m || 0;
    const r = db.prepare(`INSERT INTO decks (name, interval_sec, looping, transition, fit, background, touch, sort_order) VALUES (?,?,?,?,?,?,?,?)`).run(
      name, clampInt(b.interval_sec, 0, 3600, 10), b.loop === false || b.loop === 0 ? 0 : 1,
      TRANSITIONS.includes(b.transition) ? b.transition : 'fade', FITS.includes(b.fit) ? b.fit : 'contain',
      BACKGROUNDS.includes(b.background) ? b.background : 'black', b.touch === false || b.touch === 0 ? 0 : 1, max + 1);
    broadcastUpdate('decks');
    res.status(201).json(deckOut(deckRow(r.lastInsertRowid), []));
  });

  app.get('/api/decks/:id', (req, res) => {
    const d = deckRow(req.params.id);
    if (!d) return res.status(404).json({ error: 'Presentation not found' });
    res.json(deckOut(d, pagesOf(d.id)));
  });

  app.put('/api/decks/:id', (req, res) => {
    const d = deckRow(req.params.id);
    if (!d) return res.status(404).json({ error: 'Presentation not found' });
    const b = req.body || {};
    let name = d.name;
    if (b.name !== undefined) { name = cleanName(b.name); if (!name) return res.status(400).json({ error: 'Give the presentation a name.' }); }
    db.prepare(`UPDATE decks SET name=?, interval_sec=?, looping=?, transition=?, fit=?, background=?, touch=?, rotation=? WHERE id=?`).run(
      name,
      b.interval_sec !== undefined ? clampInt(b.interval_sec, 0, 3600, d.interval_sec) : d.interval_sec,
      b.loop !== undefined ? (b.loop ? 1 : 0) : d.looping,
      TRANSITIONS.includes(b.transition) ? b.transition : d.transition,
      FITS.includes(b.fit) ? b.fit : d.fit,
      BACKGROUNDS.includes(b.background) ? b.background : d.background,
      b.touch !== undefined ? (b.touch ? 1 : 0) : d.touch,
      b.rotation !== undefined ? turnOf(b.rotation, d.rotation || 0) : (d.rotation || 0),
      d.id);
    broadcastUpdate('decks');
    res.json(deckOut(deckRow(d.id), pagesOf(d.id)));
  });

  app.delete('/api/decks/:id', (req, res) => {
    const d = deckRow(req.params.id);
    if (!d) return res.status(404).json({ error: 'Presentation not found' });
    db.transaction(() => {
      forgetTarget('deck', d.id);   // any screen showing it stops; it leaves schedules and playlists
      db.prepare(`DELETE FROM deck_pages WHERE deck_id = ?`).run(d.id);
      db.prepare(`DELETE FROM decks WHERE id = ?`).run(d.id);
    })();
    removeDeckFiles(d.id);
    broadcastUpdate('decks');
    res.json({ ok: true });
  });

  // ── pages ──────────────────────────────────────────────────────────────────────────────────────────
  // One page picture (and its small preview) at a time, added to the end. The control app renders the pages and sends them one by one.
  app.post('/api/decks/:id/pages', (req, res) => {
    const d = deckRow(req.params.id);
    if (!d) return res.status(404).json({ error: 'Presentation not found' });
    pageUpload(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That page picture is too large (15 MB at most).' : 'The page could not be uploaded.' });
      const file = req.files && req.files.page && req.files.page[0];
      if (!file) return res.status(400).json({ error: 'No page picture was uploaded (JPEG, PNG or WebP).' });
      const count = db.prepare(`SELECT COUNT(*) AS n FROM deck_pages WHERE deck_id = ?`).get(d.id).n;
      if (count >= MAX_PAGES) return res.status(400).json({ error: `A presentation can have up to ${MAX_PAGES} pages.` });
      const pos = (db.prepare(`SELECT MAX(position) AS m FROM deck_pages WHERE deck_id = ?`).get(d.id).m || 0) + 1;
      const ins = db.prepare(`INSERT INTO deck_pages (deck_id, position, filename, thumb, duration_sec) VALUES (?,?,?,?,?)`).run(d.id, pos, '', '', clampInt((req.body || {}).duration_sec, 0, 3600, 0));
      const pageId = ins.lastInsertRowid;
      const rel = `decks/${d.id}/p${pageId}.${extFor(file.mimetype)}`;
      let thumbRel = '';
      try {
        fs.mkdirSync(path.join(DECKS_DIR, String(d.id)), { recursive: true });
        fs.writeFileSync(path.join(UPLOAD_DIR, rel), file.buffer);
        const th = req.files.thumb && req.files.thumb[0];
        if (th) { thumbRel = `decks/${d.id}/t${pageId}.${extFor(th.mimetype)}`; fs.writeFileSync(path.join(UPLOAD_DIR, thumbRel), th.buffer); }
        db.prepare(`UPDATE deck_pages SET filename = ?, thumb = ? WHERE id = ?`).run(rel, thumbRel, pageId);
      } catch (e) {
        db.prepare(`DELETE FROM deck_pages WHERE id = ?`).run(pageId); removeFile(rel); removeFile(thumbRel);
        return res.status(500).json({ error: 'The page could not be saved.' });
      }
      broadcastUpdate('decks');
      res.status(201).json(pageOut(db.prepare(`SELECT * FROM deck_pages WHERE id = ?`).get(pageId)));
    });
  });

  app.put('/api/decks/:id/order', (req, res) => {
    const d = deckRow(req.params.id);
    if (!d) return res.status(404).json({ error: 'Presentation not found' });
    const ids = Array.isArray((req.body || {}).pageIds) ? req.body.pageIds.map(Number) : null;
    const have = pagesOf(d.id).map((p) => p.id);
    if (!ids || ids.length !== have.length || new Set(ids).size !== ids.length || !ids.every((i) => have.includes(i))) {
      return res.status(400).json({ error: 'The page order must list every page of the presentation once.' });
    }
    const set = db.prepare(`UPDATE deck_pages SET position = ? WHERE id = ?`);
    db.transaction(() => ids.forEach((id, i) => set.run(i + 1, id)))();
    broadcastUpdate('decks');
    res.json(deckOut(deckRow(d.id), pagesOf(d.id)));
  });

  app.put('/api/decks/:id/pages/:pageId', (req, res) => {
    const p = db.prepare(`SELECT * FROM deck_pages WHERE id = ? AND deck_id = ?`).get(req.params.pageId, req.params.id);
    if (!p) return res.status(404).json({ error: 'Page not found' });
    if ((req.body || {}).duration_sec !== undefined) db.prepare(`UPDATE deck_pages SET duration_sec = ? WHERE id = ?`).run(clampInt(req.body.duration_sec, 0, 3600, 0), p.id);
    if ((req.body || {}).rotation !== undefined) db.prepare(`UPDATE deck_pages SET rotation = ? WHERE id = ?`).run(Number(req.body.rotation) === -1 ? -1 : turnOf(req.body.rotation, p.rotation), p.id);
    broadcastUpdate('decks');
    res.json(pageOut(db.prepare(`SELECT * FROM deck_pages WHERE id = ?`).get(p.id)));
  });

  app.delete('/api/decks/:id/pages/:pageId', (req, res) => {
    const p = db.prepare(`SELECT * FROM deck_pages WHERE id = ? AND deck_id = ?`).get(req.params.pageId, req.params.id);
    if (!p) return res.status(404).json({ error: 'Page not found' });
    db.transaction(() => {
      db.prepare(`DELETE FROM deck_pages WHERE id = ?`).run(p.id);
      const set = db.prepare(`UPDATE deck_pages SET position = ? WHERE id = ?`);
      pagesOf(p.deck_id).forEach((q, i) => set.run(i + 1, q.id));
    })();
    removeFile(p.filename); removeFile(p.thumb);
    broadcastUpdate('decks');
    res.json({ ok: true });
  });

  // ── what a screen shows: one flat list of pages ──────────────────────────────────────────────────────
  // A deck, or a playlist (decks and photos, one after the other), is handed to the display as ONE list of pages, each with its own seconds, fit,
  // background and effect, so the display has a single way of playing anything. seconds 0 = by hand only (the display uses 10 s if it is timed anyway).
  function deckPagesFlat(d) {
    return pagesOf(d.id).map((p) => ({ url: urlOf(p.filename), thumb: urlOf(p.thumb || p.filename), seconds: p.duration_sec || d.interval_sec || 0, fit: d.fit, background: d.background, transition: d.transition, rotation: ROTATIONS.includes(p.rotation) ? p.rotation : (d.rotation || 0), pageId: p.id }));
  }
  function photosFor(tag) {
    const all = db.prepare(`SELECT * FROM photos ORDER BY sort_order ASC, id ASC`).all();
    const t = String(tag || '').trim();
    if (!t) return all.filter((p) => p.active === 1 || p.active === undefined || p.active === null);
    const hit = all.filter((p) => String(p.tags || '').split(',').map((x) => x.trim()).includes(t));
    return hit;
  }
  function photoPagesFlat(item) {
    return photosFor(item.ref).map((p) => ({ url: urlOf(p.filename), thumb: urlOf(p.filename), seconds: item.seconds || 10, fit: 'contain', background: 'blur', transition: 'fade', rotation: 0 }));
  }
  const playlistRow = (id) => db.prepare(`SELECT * FROM playlists WHERE id = ?`).get(id);
  const itemsOf = (id) => db.prepare(`SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC, id ASC`).all(id);
  function playlistPagesFlat(pl) {
    const out = [];
    for (const it of itemsOf(pl.id)) {
      if (it.kind === 'deck') { const d = deckRow(it.ref); if (d) out.push(...deckPagesFlat(d)); }
      else if (it.kind === 'photos') out.push(...photoPagesFlat(it));
    }
    return out.slice(0, 1000);
  }
  function sourceOf(kind, id) {
    if (kind === 'deck') { const d = deckRow(id); return d ? { kind, id: d.id, name: d.name, loop: !!d.looping, touch: !!d.touch, timed: d.interval_sec > 0, pages: deckPagesFlat(d) } : null; }
    if (kind === 'playlist') { const p = playlistRow(id); return p ? { kind, id: p.id, name: p.name, loop: !!p.looping, touch: !!p.touch, timed: true, pages: playlistPagesFlat(p) } : null; }
    return null;
  }
  app.get('/api/present/:kind/:id', (req, res) => {
    const src = sourceOf(req.params.kind, req.params.id);
    if (!src) return res.status(404).json({ error: 'Presentation not found' });
    res.json(src);
  });

  // ── playlists ───────────────────────────────────────────────────────────────────────────────────────
  const MAX_PLAYLISTS = 30, MAX_ITEMS = 30;
  function itemOut(it) {
    if (it.kind === 'deck') { const d = deckRow(it.ref); return { id: it.id, position: it.position, kind: 'deck', ref: String(it.ref), seconds: it.seconds, label: d ? d.name : '', exists: !!d, pages: d ? pagesOf(d.id).length : 0 }; }
    return { id: it.id, position: it.position, kind: 'photos', ref: String(it.ref || ''), seconds: it.seconds, label: it.ref || '', exists: true, pages: photosFor(it.ref).length };
  }
  function playlistOut(p, withItems) {
    const out = { id: p.id, name: p.name, loop: !!p.looping, touch: !!p.touch, created_at: p.created_at };
    const items = itemsOf(p.id);
    out.item_count = items.length;
    if (withItems) out.items = items.map(itemOut);
    out.page_count = playlistPagesFlat(p).length;
    return out;
  }
  app.get('/api/playlists', (req, res) => res.json(db.prepare(`SELECT * FROM playlists ORDER BY sort_order ASC, id ASC`).all().map((p) => playlistOut(p))));
  app.post('/api/playlists', (req, res) => {
    const b = req.body || {};
    const name = cleanName(b.name);
    if (!name) return res.status(400).json({ error: 'Give the playlist a name.' });
    if (db.prepare(`SELECT COUNT(*) AS n FROM playlists`).get().n >= MAX_PLAYLISTS) return res.status(400).json({ error: `You can have up to ${MAX_PLAYLISTS} playlists. Delete one first.` });
    const max = db.prepare(`SELECT MAX(sort_order) AS m FROM playlists`).get().m || 0;
    const r = db.prepare(`INSERT INTO playlists (name, looping, touch, sort_order) VALUES (?,?,?,?)`).run(name, b.loop === false || b.loop === 0 ? 0 : 1, b.touch === false || b.touch === 0 ? 0 : 1, max + 1);
    broadcastUpdate('playlists');
    res.status(201).json(playlistOut(playlistRow(r.lastInsertRowid), true));
  });
  app.get('/api/playlists/:id', (req, res) => {
    const p = playlistRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Playlist not found' });
    res.json(playlistOut(p, true));
  });
  app.put('/api/playlists/:id', (req, res) => {
    const p = playlistRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Playlist not found' });
    const b = req.body || {};
    let name = p.name;
    if (b.name !== undefined) { name = cleanName(b.name); if (!name) return res.status(400).json({ error: 'Give the playlist a name.' }); }
    db.prepare(`UPDATE playlists SET name=?, looping=?, touch=? WHERE id=?`).run(name, b.loop !== undefined ? (b.loop ? 1 : 0) : p.looping, b.touch !== undefined ? (b.touch ? 1 : 0) : p.touch, p.id);
    broadcastUpdate('playlists');
    res.json(playlistOut(playlistRow(p.id), true));
  });
  // Replaces the whole list of items (the editor sends the list as it now stands, in order).
  app.put('/api/playlists/:id/items', (req, res) => {
    const p = playlistRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Playlist not found' });
    const given = Array.isArray((req.body || {}).items) ? req.body.items : null;
    if (!given) return res.status(400).json({ error: 'Send the list of items.' });
    if (given.length > MAX_ITEMS) return res.status(400).json({ error: `A playlist can have up to ${MAX_ITEMS} items.` });
    const clean = [];
    for (const it of given) {
      const kind = it && it.kind;
      if (kind === 'deck') {
        if (!deckRow(it.ref)) return res.status(400).json({ error: 'One of the presentations in the list no longer exists.' });
        clean.push({ kind, ref: String(Number(it.ref)), seconds: 0 });
      } else if (kind === 'photos') {
        clean.push({ kind, ref: cleanName(it.ref).slice(0, 40), seconds: clampInt(it.seconds, 2, 3600, 10) });
      } else return res.status(400).json({ error: 'Each item must be a presentation or photos.' });
    }
    const ins = db.prepare(`INSERT INTO playlist_items (playlist_id, position, kind, ref, seconds) VALUES (?,?,?,?,?)`);
    db.transaction(() => {
      db.prepare(`DELETE FROM playlist_items WHERE playlist_id = ?`).run(p.id);
      clean.forEach((c, i) => ins.run(p.id, i + 1, c.kind, c.ref, c.seconds));
    })();
    broadcastUpdate('playlists');
    res.json(playlistOut(playlistRow(p.id), true));
  });

  // A deck or playlist is going away: stop any screen showing it and drop it from schedules (and from playlists, for a deck).
  function forgetTarget(kind, id) {
    const col = kind === 'deck' ? 'presentation_deck_id' : 'presentation_playlist_id';
    const showing = db.prepare(`SELECT device_id FROM screens WHERE ${col} = ?`).all(id);
    db.prepare(`UPDATE screens SET ${col} = NULL, presentation_mode = '' WHERE ${col} = ?`).run(id);
    for (const s of showing) { live.delete(s.device_id); sendScreenCommand(s.device_id, 'presentation', { action: 'stop' }); }
    for (const s of db.prepare(`SELECT device_id, presentation_schedule FROM screens`).all()) {
      let rules; try { rules = JSON.parse(s.presentation_schedule || '[]'); } catch { rules = []; }
      const kept = rules.filter((r) => !(r.kind === kind && Number(r.id) === Number(id)));
      if (kept.length !== rules.length) {
        db.prepare(`UPDATE screens SET presentation_schedule = ? WHERE device_id = ?`).run(JSON.stringify(kept), s.device_id);
        sendScreenCommand(s.device_id, 'presentation', { action: 'refresh' });
      }
    }
    if (kind === 'deck') { db.prepare(`DELETE FROM playlist_items WHERE kind = 'deck' AND ref = ?`).run(String(id)); broadcastUpdate('playlists'); }
  }
  app.delete('/api/playlists/:id', (req, res) => {
    const p = playlistRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Playlist not found' });
    db.transaction(() => { forgetTarget('playlist', p.id); db.prepare(`DELETE FROM playlist_items WHERE playlist_id = ?`).run(p.id); db.prepare(`DELETE FROM playlists WHERE id = ?`).run(p.id); })();
    broadcastUpdate('playlists');
    res.json({ ok: true });
  });

  // ── showing something on a screen ────────────────────────────────────────────────────────────────────
  const live = new Map();   // deviceId -> { index, mode, kind, ref, name, count, source, at }: what the display last reported
  const LIVE_FRESH_MS = 120 * 1000;
  const screenRow = (id) => db.prepare(`SELECT * FROM screens WHERE device_id = ?`).get(id);
  const isRemoteScreen = (s) => s && s.device_id !== DEVICE_ID && s.is_remote;
  const SCREEN_RECENT_MS = 120 * 1000;
  const screenSeenRecently = (s) => Date.now() - (Number(s.last_seen) || 0) < SCREEN_RECENT_MS;
  const remoteBase = (s) => { const a = String(s.remote_addr || ''); return a ? 'http://' + (a.includes(':') ? a : `${a}:${PORT}`) : ''; };

  function sendJson(method, url, body, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let u; try { u = new URL(url); } catch (e) { return reject(e); }
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout: timeoutMs,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (resp) => {
        const chunks = []; resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          let parsed = {}; try { parsed = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* not JSON */ }
          if (resp.statusCode && resp.statusCode < 400) resolve(parsed); else reject(new Error(parsed.error || `HTTP ${resp.statusCode}`));
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out.')); });
      if (data) req.write(data); req.end();
    });
  }

  // The schedule: up to 8 rules {start:'HH:MM', end:'HH:MM', days:[0-6] (empty = every day), kind:'deck'|'playlist', id}. A window may run past midnight.
  const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  function cleanSchedule(raw) {
    if (!Array.isArray(raw)) return null;
    if (raw.length > 8) return null;
    const out = [];
    for (const r of raw) {
      if (!r || !HM.test(String(r.start)) || !HM.test(String(r.end)) || r.start === r.end) return null;
      if (r.kind !== 'deck' && r.kind !== 'playlist') return null;
      if (!sourceOf(r.kind, r.id)) return null;
      const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
      out.push({ start: r.start, end: r.end, days: days.length === 7 ? [] : days, kind: r.kind, id: Number(r.id) });
    }
    return out;
  }
  const scheduleOf = (s) => { try { const r = JSON.parse(s.presentation_schedule || '[]'); return Array.isArray(r) ? r : []; } catch { return []; } };

  // What is saved on the screen (the person's own start) and what is showing right now (that, or a scheduled one the display reports).
  function stateOf(s) {
    let kind = s.presentation_deck_id ? 'deck' : s.presentation_playlist_id ? 'playlist' : null;
    let ref = kind === 'deck' ? s.presentation_deck_id : kind === 'playlist' ? s.presentation_playlist_id : null;
    let src = kind ? sourceOf(kind, ref) : null;
    if (kind && !src) {   // gone (deleted on the host): no longer presenting
      db.prepare(`UPDATE screens SET presentation_deck_id = NULL, presentation_playlist_id = NULL, presentation_mode = '' WHERE device_id = ?`).run(s.device_id);
      live.delete(s.device_id); kind = null; ref = null;
    }
    const l = live.get(s.device_id);
    const fresh = l && Date.now() - l.at < LIVE_FRESH_MS;
    const out = { kind, ref_id: ref, deck_id: kind === 'deck' ? ref : null, playlist_id: kind === 'playlist' ? ref : null, schedule: scheduleOf(s), active: false, source: '', mode: '', playing: false, index: 0, page_count: 0, name: '', deck_name: '' };
    if (src) {
      const mode = MODES.includes(s.presentation_mode) ? s.presentation_mode : 'manual';
      const m = fresh && l.mode ? l.mode : mode;
      Object.assign(out, { active: true, source: 'manual', name: src.name, deck_name: src.name, page_count: src.pages.length, mode: m, playing: m === 'auto', index: fresh ? Math.min(l.index, Math.max(0, src.pages.length - 1)) : 0, active_kind: kind, active_ref: ref });
    } else if (fresh && l.source === 'schedule') {
      Object.assign(out, { active: true, source: 'schedule', name: l.name || '', deck_name: l.name || '', page_count: l.count || 0, mode: l.mode || 'auto', playing: (l.mode || 'auto') === 'auto', index: Math.min(l.index || 0, Math.max(0, (l.count || 1) - 1)), active_kind: l.kind, active_ref: l.ref });
    }
    return out;
  }

  app.get('/api/screens/:deviceId/presentation', async (req, res) => {
    const s = screenRow(req.params.deviceId);
    if (!s) return res.status(404).json({ error: 'Screen not found' });
    if (isRemoteScreen(s)) {
      const base = remoteBase(s);
      if (!base || !screenSeenRecently(s)) return res.status(502).json({ error: 'This screen is offline.' });
      try { return res.json(await sendJson('GET', `${base}/api/screens/${encodeURIComponent(s.device_id)}/presentation`, undefined, 3000)); }
      catch (e) { return res.status(502).json({ error: 'Could not reach this screen: ' + e.message }); }
    }
    res.json(stateOf(s));
  });

  app.post('/api/screens/:deviceId/presentation', async (req, res) => {
    const s = screenRow(req.params.deviceId);
    if (!s) return res.status(404).json({ error: 'Screen not found' });
    const b = req.body || {};
    const action = String(b.action || '');
    if (!['start', 'stop', 'next', 'prev', 'goto', 'play', 'pause', 'rotate'].includes(action)) return res.status(400).json({ error: 'Unknown presentation action.' });
    if (isRemoteScreen(s)) {
      const base = remoteBase(s);
      if (!base || !screenSeenRecently(s)) return res.status(502).json({ error: 'This screen is offline.' });
      try { return res.json(await sendJson('POST', `${base}/api/screens/${encodeURIComponent(s.device_id)}/presentation`, b, 8000)); }
      catch (e) { return res.status(502).json({ error: 'Could not reach this screen: ' + e.message }); }
    }
    const cmd = { action };
    const cur = stateOf(s);
    if (action === 'start') {
      const kind = b.kind === 'playlist' ? 'playlist' : 'deck';
      const id = b.kind ? b.id : b.deck_id;           // deck_id: how it was asked for before playlists existed
      const src = sourceOf(kind, id);
      if (!src) return res.status(404).json({ error: 'Presentation not found' });
      if (!src.pages.length) return res.status(400).json({ error: kind === 'deck' ? 'That presentation has no pages yet.' : 'That playlist has nothing to show yet.' });
      const mode = MODES.includes(b.mode) ? b.mode : (src.timed ? 'auto' : 'manual');
      const index = clampInt(b.index, 0, src.pages.length - 1, 0);
      db.prepare(`UPDATE screens SET presentation_deck_id = ?, presentation_playlist_id = ?, presentation_mode = ? WHERE device_id = ?`).run(kind === 'deck' ? src.id : null, kind === 'playlist' ? src.id : null, mode, s.device_id);
      live.set(s.device_id, { index, mode, kind, ref: src.id, name: src.name, count: src.pages.length, source: 'manual', at: Date.now() });
      Object.assign(cmd, { kind, id: src.id, deck_id: kind === 'deck' ? src.id : undefined, mode, index });
    } else if (action === 'stop') {
      db.prepare(`UPDATE screens SET presentation_deck_id = NULL, presentation_playlist_id = NULL, presentation_mode = '' WHERE device_id = ?`).run(s.device_id);
      live.delete(s.device_id);
    } else {
      if (!cur.active) return res.status(409).json({ error: 'This screen is not showing a presentation.' });
      const l = live.get(s.device_id) || { index: 0, mode: cur.mode };
      if (action === 'goto') { cmd.index = clampInt(b.index, 0, Math.max(0, cur.page_count - 1), 0); live.set(s.device_id, { ...l, index: cmd.index, at: Date.now() }); }
      if (action === 'rotate') {
        // Turn the page that is on screen now (by default a quarter turn clockwise). A page of a presentation keeps its new turn; a photo in a playlist
        // is only turned for as long as it is up.
        const by = [90, -90, 180, 270].includes(Number(b.by)) ? Number(b.by) : 90;
        const src = sourceOf(cur.active_kind, cur.active_ref);
        const index = Math.min(l.index || 0, Math.max(0, (src ? src.pages.length : 1) - 1));
        const pg = src && src.pages[index];
        if (!pg) return res.status(409).json({ error: 'There is no page to turn.' });
        const to = (((Number(pg.rotation) || 0) + by) % 360 + 360) % 360;
        Object.assign(cmd, { index, rotation: to });
        if (pg.pageId) { db.prepare(`UPDATE deck_pages SET rotation = ? WHERE id = ?`).run(to, pg.pageId); broadcastUpdate('decks'); }
      }
      if (action === 'play' || action === 'pause') {
        const mode = action === 'play' ? 'auto' : 'manual';
        if (cur.source === 'manual') db.prepare(`UPDATE screens SET presentation_mode = ? WHERE device_id = ?`).run(mode, s.device_id);
        live.set(s.device_id, { ...l, mode, at: Date.now() });
      }
    }
    const delivered = sendScreenCommand(s.device_id, 'presentation', cmd);
    broadcastUpdate('screens');
    res.json({ ok: true, delivered, state: stateOf(screenRow(s.device_id)) });
  });

  // The display says where it is (after every page change, and when it ends or is paused by touch), so the remote shows the right page. A scheduled
  // presentation exists only on the display, so what it reports is also how the server (and the remote) knows about it.
  app.post('/api/screens/:deviceId/presentation-report', (req, res) => {
    const s = screenRow(req.params.deviceId);
    if (!s) return res.status(404).json({ error: 'Screen not found' });
    const b = req.body || {};
    const source = b.source === 'schedule' ? 'schedule' : 'manual';
    const persisted = !!(s.presentation_deck_id || s.presentation_playlist_id);
    if (source === 'manual' && !persisted) return res.json({ ok: true });
    const mode = MODES.includes(b.mode) ? b.mode : (s.presentation_mode || 'manual');
    live.set(s.device_id, { index: clampInt(b.index, 0, 100000, 0), mode, kind: b.kind === 'playlist' ? 'playlist' : 'deck', ref: Number(b.ref) || null, name: cleanName(b.name), count: clampInt(b.count, 0, 100000, 0), source, at: Date.now() });
    if (source === 'manual' && mode !== s.presentation_mode) db.prepare(`UPDATE screens SET presentation_mode = ? WHERE device_id = ?`).run(mode, s.device_id);
    res.json({ ok: true });
  });
  // The display ended a scheduled presentation (its hours are over): forget it.
  app.post('/api/screens/:deviceId/presentation-report/end', (req, res) => {
    const l = live.get(req.params.deviceId);
    if (l && l.source === 'schedule') live.delete(req.params.deviceId);
    res.json({ ok: true });
  });

  // ── schedule: when this screen shows what ────────────────────────────────────────────────────────────
  app.get('/api/screens/:deviceId/presentation-schedule', async (req, res) => {
    const s = screenRow(req.params.deviceId);
    if (!s) return res.status(404).json({ error: 'Screen not found' });
    if (isRemoteScreen(s)) {
      const base = remoteBase(s);
      if (!base || !screenSeenRecently(s)) return res.status(502).json({ error: 'This screen is offline.' });
      try { return res.json(await sendJson('GET', `${base}/api/screens/${encodeURIComponent(s.device_id)}/presentation-schedule`, undefined, 3000)); }
      catch (e) { return res.status(502).json({ error: 'Could not reach this screen: ' + e.message }); }
    }
    res.json({ schedule: scheduleOf(s) });
  });
  app.put('/api/screens/:deviceId/presentation-schedule', async (req, res) => {
    const s = screenRow(req.params.deviceId);
    if (!s) return res.status(404).json({ error: 'Screen not found' });
    if (isRemoteScreen(s)) {
      const base = remoteBase(s);
      if (!base || !screenSeenRecently(s)) return res.status(502).json({ error: 'This screen is offline.' });
      try { return res.json(await sendJson('PUT', `${base}/api/screens/${encodeURIComponent(s.device_id)}/presentation-schedule`, req.body || {})); }
      catch (e) { return res.status(502).json({ error: 'Could not reach this screen: ' + e.message }); }
    }
    const raw = (req.body || {}).schedule;
    if (Array.isArray(raw) && raw.length > 8) return res.status(400).json({ error: 'At most 8 scheduled times.' });
    const clean = cleanSchedule(raw);
    if (!clean) return res.status(400).json({ error: 'Each scheduled time needs a start and a different end time, like 11:00 and 14:00, and something to show.' });
    db.prepare(`UPDATE screens SET presentation_schedule = ? WHERE device_id = ?`).run(JSON.stringify(clean), s.device_id);
    sendScreenCommand(s.device_id, 'presentation', { action: 'refresh' });
    res.json({ ok: true, schedule: clean });
  });
};
