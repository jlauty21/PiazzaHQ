'use strict';
// Whiteboards: a drawing board the Whiteboard widget (and later the kids' drawing pad) draws on. A board is a list of strokes, not a picture: each stroke is
// { t: 'pen' | 'marker' | 'eraser', c: '#rrggbb', w: width as a fraction of the board's width, p: [x, y, x, y, ...] each as a fraction 0..1 of the board's size }.
// That keeps a board small, lets undo take the last stroke off, and lets it be drawn again at any size (a wall screen, a phone). A rubbing eraser is just a stroke that rubs out
// what is under it when the strokes are replayed in order.
//   GET    /api/stamps | POST /api/stamps (a picture as the body) | DELETE /api/stamps/:id    the household's own stamps (a stamp stroke has s: 'img:<filename>')
//   GET    /api/boards                    the boards a phone can draw on: every Whiteboard widget on a wall layout, with its board name
//   GET    /api/boards/:id                the board (an empty one if nothing has been drawn on it yet)
//   POST   /api/boards/:id/strokes        add a stroke (also how a redo puts one back)
//   PUT    /api/boards/:id/strokes/last   replace the last stroke (resizing a sticker just placed)
//   PUT    /api/boards/:id/strokes/<n>    replace stroke number n (moved, resized, recolored); POST .../strokes/<n>/remove takes it off; POST .../strokes/insert {index, stroke} puts one back.
//                                         The first two name the stroke ({expect: {t, s, p: [x, y], n}}): a stale one is a 409
//   DELETE /api/boards/:id/strokes/last   take the last stroke off (undo)
//   POST   /api/boards/:id/clear          wipe it
//   PUT    /api/boards/:id                { background, photo? } (background 'photo' = a picture behind the drawing)
//   POST   /api/boards/:id/flatten?n=     the board's strokes (n of them) as one PNG: it becomes the board's "ink" picture and the strokes are cleared (a full board carries on)
//   POST   /api/boards/:id/photo          a picture (jpeg/png/webp as the body) to draw on
//   strokes: pen/marker/eraser (path), line/rect/ellipse (two corners, f = filled), stamp (an emoji at a point), fill (the paint bucket at a point)
//   POST   /api/boards/:id/keep?name=     the PNG itself as the body (Content-Type image/png: the JSON reader is limited to 100 KB) -> a kept drawing (kid_drawings, kid 0 = the family) with the board's strokes, shown by the Kids' Drawing widget as the newest
//   GET    /api/kid-drawing/status        { enabled, approval, live } for the kids page (live: a kid may draw straight onto a wall Whiteboard board)
//   POST   /api/kid-drawing/:kidId        the kid's PNG as the body -> a kept drawing (kid_drawings: the picture AND the strokes of the kid's draft board; or waiting for a grown-up). The draft stays on the pad.
//   GET | PUT /api/kid-drawing/:kidId/prefs   the kid's own color, size, tool and stamp: the pad starts the way they left it, on any tablet
//   GET    /api/kid-drawings/showing      what the Kids' Drawing widgets rotate through: the newest SHOW (one drawing just sent, or the drawings a kid picked to rotate); the newest show wins, whoever made it
//   GET    /api/kid-drawings?kid=<id>     one kid's drawings, newest first (showing: true on the ones in the show now)
//   POST   /api/kid-drawing/:kidId/show   { ids: [...] } the kid picks some of their drawings to rotate on the wall: that becomes the newest show
//   POST   /api/kid-drawing/:kidId/load/:id   open one of that kid's drawings on their pad (it replaces the draft), to change and send again
//   GET    /api/drawings/all              every kept drawing, newest first (a grown-up's list: now showing, pinned, waiting)   POST /api/drawings/:id/pin | DELETE /api/drawings/pin   keep one on the widgets whatever is sent after it
//   GET    /api/drawings/pending          the drawings waiting for a grown-up        POST /api/drawings/:id/approve        DELETE /api/drawings/:id (a waiting one)
// Every change raises the board's version and tells the other screens ('boards'), which fetch it only if the version is new to them. Covered by test/api/whiteboard.test.js.
module.exports = function registerWhiteboard({ app, express, db, fs, path, crypto, UPLOAD_DIR, broadcastUpdate }) {
  const ID = /^[A-Za-z0-9_-]{1,40}$/;
  const BACKGROUNDS = ['white', 'chalkboard', 'paper', 'grid', 'lined', 'clear', 'photo'];        // 'photo': a picture behind the drawing (the board's photo)
  const FREE = ['pen', 'marker', 'eraser'];           // p = the path
  const SHAPES = ['line', 'rect', 'ellipse'];         // p = [x1, y1, x2, y2]; f: 1 = filled (rect, ellipse)
  const TOOLS = [...FREE, ...SHAPES, 'stamp', 'text', 'fill']; // stamp: p = [x, y], s = the emoji, w = its size; text: p = [x, y], s = the words, w = their size; fill: p = [x, y], the paint bucket
  const MAX_PHOTO = 6 * 1024 * 1024;
  const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const MAX_BOARDS = 100;
  const MAX_STROKE_POINTS = 5000;          // points in one stroke
  const MAX_BOARD_POINTS = 60000;          // points on a board (a full day of busy doodling is far below this)
  const MAX_PNG = 3 * 1024 * 1024;
  const MAX_WAITING = 40;                  // drawings waiting for a grown-up
  const getSetting = (k, d) => { const r = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k); return r && r.value !== null && r.value !== undefined ? String(r.value) : d; };

  const rowOf = (id) => db.prepare(`SELECT * FROM whiteboards WHERE id = ?`).get(id);
  const strokesOf = (row) => { try { const a = JSON.parse(row.strokes || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const pointsIn = (strokes) => strokes.reduce((n, s) => n + (s.p ? s.p.length / 2 : 0), 0);
  const out = (id, row) => (row
    ? { id, background: row.background || 'white', photo: row.photo || '', ink: row.ink || '', strokes: strokesOf(row), version: row.version || 0, updated_at: row.updated_at || '', cleared_at: row.cleared_at || '' }
    : { id, background: 'white', photo: '', ink: '', strokes: [], version: 0, updated_at: '', cleared_at: '' });
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

  // The stroke as it will be kept, or null if it is not a stroke.
  function cleanStroke(s) {
    if (!s || typeof s !== 'object') return null;
    const t = TOOLS.includes(s.t) ? s.t : null;
    const c = /^#[0-9a-fA-F]{6}$/.test(String(s.c || '')) ? String(s.c).toLowerCase() : null;
    const w = num(s.w);
    if (!t || !c || !(w > 0)) return null;
    if (!Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2) return null;
    if (s.p.length / 2 > MAX_STROKE_POINTS) return null;
    if (SHAPES.includes(t) && s.p.length !== 4) return null;
    if ((t === 'stamp' || t === 'text' || t === 'fill') && s.p.length !== 2) return null;
    const p = [];
    for (const v of s.p) { const n = num(v); if (!Number.isFinite(n)) return null; p.push(Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000); }
    const out = { t, c, w: Math.round(Math.min(t === 'stamp' ? 0.4 : t === 'text' ? 0.25 : 0.2, Math.max(0.0005, w)) * 100000) / 100000, p };
    if (t === 'stamp') {
      const e = String(s.s || '');
      if (/^img:stamp-[0-9a-f]{12}\.(png|jpg|webp)$/.test(e)) {                       // one of the household's own stamps
        if (!db.prepare(`SELECT 1 FROM stamps WHERE filename = ?`).get(e.slice(4))) return null;
      } else if (!e || e.length > 8 || /[\u0000-\u001f<>&"']/.test(e)) return null;       // one emoji (a few code units), nothing that could be markup
      out.s = e;
    }
    if (t === 'text') {
      const e = String(s.s || '');
      if (!e.trim() || e.length > 120 || /[\u0000-\u001f]/.test(e)) return null;       // a line of words (they are only ever drawn on a canvas, never read as markup)
      out.s = e;
    }
    if ((t === 'rect' || t === 'ellipse') && s.f) out.f = 1;
    return out;
  }

  function save(id, strokes, background, extra) {
    const cur = rowOf(id);
    const version = (cur ? cur.version : 0) + 1;
    const photo = extra && extra.photo !== undefined ? extra.photo : (cur ? cur.photo || '' : '');
    const ink = extra && extra.ink !== undefined ? extra.ink : (cur ? cur.ink || '' : '');
    db.prepare(`INSERT INTO whiteboards (id, background, strokes, version, updated_at, cleared_at, photo, ink) VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET background = excluded.background, strokes = excluded.strokes, version = excluded.version, updated_at = excluded.updated_at, cleared_at = excluded.cleared_at, photo = excluded.photo, ink = excluded.ink`)
      .run(id, background, JSON.stringify(strokes), version, extra && extra.cleared ? new Date().toISOString() : (cur ? cur.cleared_at || '' : ''), photo, ink);
    broadcastUpdate('boards');
    return version;
  }
  const idOk = (req, res) => { if (!ID.test(req.params.id)) { res.status(400).json({ error: 'That is not a board name.' }); return false; } return true; };
  const room = (id, res) => {
    if (!rowOf(id) && db.prepare(`SELECT COUNT(*) AS n FROM whiteboards`).get().n >= MAX_BOARDS) { res.status(400).json({ error: 'There are too many boards.' }); return false; }
    return true;
  };

  // The same board name the display works out for a widget (public/js/display/02-widget-renderers.js, wbBoardId).
  const boardIdOf = (w) => String((w && w.wbBoard) || ('wb_' + (w && w.id))).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'wb';
  app.get('/api/boards', (req, res) => {
    const seen = new Map();
    const rows = db.prepare(`SELECT l.widgets AS widgets, d.name AS dname FROM layouts l LEFT JOIN displays d ON d.id = l.display_id`).all();
    for (const r of rows) {
      let ws = []; try { ws = JSON.parse(r.widgets || '[]'); } catch { ws = []; }
      for (const w of Array.isArray(ws) ? ws : []) {
        if (!w || w.type !== 'whiteboard') continue;
        const id = boardIdOf(w);
        if (!ID.test(id) || seen.has(id)) continue;
        seen.set(id, { id, name: w.wbBoard ? String(w.wbBoard) : (r.dname ? String(r.dname) + ' whiteboard' : 'Whiteboard') });
      }
    }
    const out = [...seen.values()].map((b) => { const row = rowOf(b.id); return { ...b, strokes: row ? strokesOf(row).length : 0, version: row ? row.version : 0 }; });
    res.json(out);
  });

  app.get('/api/boards/:id', (req, res) => {
    if (!idOk(req, res)) return;
    res.json(out(req.params.id, rowOf(req.params.id)));
  });

  app.post('/api/boards/:id/strokes', (req, res) => {
    if (!idOk(req, res) || !room(req.params.id, res)) return;
    const stroke = cleanStroke((req.body || {}).stroke);
    if (!stroke) return res.status(400).json({ error: 'That is not a stroke.' });
    const row = rowOf(req.params.id), strokes = row ? strokesOf(row) : [];
    if (pointsIn(strokes) + stroke.p.length / 2 > MAX_BOARD_POINTS) return res.status(413).json({ error: 'This board is full. Keep it as a creation, then clear it.' });
    strokes.push(stroke);
    const version = save(req.params.id, strokes, row ? row.background : 'white');
    res.status(201).json({ ok: true, version, count: strokes.length });
  });

  // Replace the last stroke in one step (a sticker resized right after it was placed): the other screens never see it vanish.
  app.put('/api/boards/:id/strokes/last', (req, res) => {
    if (!idOk(req, res)) return;
    const stroke = cleanStroke((req.body || {}).stroke);
    if (!stroke) return res.status(400).json({ error: 'That is not a stroke.' });
    const row = rowOf(req.params.id), strokes = row ? strokesOf(row) : [];
    if (!strokes.length) return res.status(404).json({ error: 'There is nothing to replace.' });
    strokes[strokes.length - 1] = stroke;
    const version = save(req.params.id, strokes, row.background);
    res.json({ ok: true, version, count: strokes.length });
  });

  // Any stroke in the list can be moved, resized, recolored, removed, and put back (undo). The client says which stroke it means - its kind, its words or emoji, where it starts and how
  // many points it has - so two screens editing at once cannot change or remove the wrong one: if the stroke at that place is not that one any more, the answer is 409 and the screen
  // reloads the board.
  const strokeAt = (strokes, idx, expect) => {
    const s0 = strokes[idx], e = expect || {};
    if (!s0) return null;
    if (e.t !== undefined && e.t !== s0.t) return null;
    if (e.s !== s0.s) return null;
    if (!Array.isArray(e.p) || e.p.length < 2 || Math.abs(Number(e.p[0]) - s0.p[0]) > 0.002 || Math.abs(Number(e.p[1]) - s0.p[1]) > 0.002) return null;
    if (e.n !== undefined && Number(e.n) !== s0.p.length / 2) return null;
    return s0;
  };
  app.put('/api/boards/:id/strokes/:index(\\d+)', (req, res) => {
    if (!idOk(req, res)) return;
    const stroke = cleanStroke((req.body || {}).stroke);
    if (!stroke) return res.status(400).json({ error: 'That is not a stroke.' });
    const row = rowOf(req.params.id), strokes = row ? strokesOf(row) : [], idx = Number(req.params.index);
    if (idx >= strokes.length) return res.status(404).json({ error: 'There is nothing there.' });
    const old = strokeAt(strokes, idx, (req.body || {}).expect);
    if (!old) return res.status(409).json({ error: 'That has changed.' });
    if (stroke.t !== old.t) return res.status(400).json({ error: 'A stroke cannot change what it is.' });
    strokes[idx] = stroke;
    const version = save(req.params.id, strokes, row.background);
    res.json({ ok: true, version, count: strokes.length });
  });
  app.post('/api/boards/:id/strokes/:index(\\d+)/remove', (req, res) => {
    if (!idOk(req, res)) return;
    const row = rowOf(req.params.id), strokes = row ? strokesOf(row) : [], idx = Number(req.params.index);
    if (idx >= strokes.length) return res.status(404).json({ error: 'There is nothing there.' });
    if (!strokeAt(strokes, idx, (req.body || {}).expect)) return res.status(409).json({ error: 'That has changed.' });
    strokes.splice(idx, 1);
    const version = save(req.params.id, strokes, row.background);
    res.json({ ok: true, version, count: strokes.length });
  });
  // put a stroke back where it was (undoing a delete)
  app.post('/api/boards/:id/strokes/insert', (req, res) => {
    if (!idOk(req, res) || !room(req.params.id, res)) return;
    const stroke = cleanStroke((req.body || {}).stroke), at = Number((req.body || {}).index);
    if (!stroke || !Number.isInteger(at) || at < 0) return res.status(400).json({ error: 'That is not a stroke.' });
    const row = rowOf(req.params.id), strokes = row ? strokesOf(row) : [];
    if (at > strokes.length) return res.status(404).json({ error: 'There is nothing there.' });
    if (pointsIn(strokes) + stroke.p.length / 2 > MAX_BOARD_POINTS) return res.status(413).json({ error: 'This board is full. Keep it as a creation, then clear it.' });
    strokes.splice(at, 0, stroke);
    const version = save(req.params.id, strokes, row ? row.background : 'white');
    res.status(201).json({ ok: true, version, count: strokes.length });
  });

  app.delete('/api/boards/:id/strokes/last', (req, res) => {
    if (!idOk(req, res)) return;
    const row = rowOf(req.params.id), strokes = row ? strokesOf(row) : [];
    if (!strokes.length) return res.json({ ok: true, removed: null, version: row ? row.version : 0, count: 0 });
    const removed = strokes.pop();
    const version = save(req.params.id, strokes, row.background);
    res.json({ ok: true, removed, version, count: strokes.length });
  });

  app.post('/api/boards/:id/clear', (req, res) => {
    if (!idOk(req, res)) return;
    const row = rowOf(req.params.id);
    if (!row || (!strokesOf(row).length && !row.ink)) return res.json({ ok: true, version: row ? row.version : 0, count: 0 });   // nothing to wipe: no change, no news
    const version = save(req.params.id, [], row.background, { cleared: true, ink: '' });
    dropFile(row.ink);
    res.json({ ok: true, version, count: 0 });
  });

  app.put('/api/boards/:id', (req, res) => {
    if (!idOk(req, res) || !room(req.params.id, res)) return;
    const bg = (req.body || {}).background;
    if (!BACKGROUNDS.includes(bg)) return res.status(400).json({ error: 'That is not a background.' });
    const row = rowOf(req.params.id);
    let photo;
    if (bg === 'photo') {
      photo = String((req.body || {}).photo || (row && row.photo) || '');
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(photo) || !fs.existsSync(path.join(UPLOAD_DIR, photo))) return res.status(400).json({ error: 'That picture is not there.' });
      const known = db.prepare(`SELECT 1 FROM photos WHERE filename = ?`).get(photo) || photoInUse(photo);
      if (!known) return res.status(400).json({ error: 'That picture is not there.' });
    }
    const version = save(req.params.id, row ? strokesOf(row) : [], bg, photo === undefined ? undefined : { photo });
    res.json({ ok: true, version, background: bg, photo: photo === undefined ? (row ? row.photo || '' : '') : photo });
  });

  // A picture to draw on, from the phone's camera or files: kept as board-<random>.<ext> in uploads (not a photo in the slideshow). Replacing it removes the old one.
  app.post('/api/boards/:id/photo', express.raw({ type: Object.keys(PHOTO_TYPES), limit: MAX_PHOTO + 1024 }), (req, res) => {
    if (!idOk(req, res) || !room(req.params.id, res)) return;
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    const ext = PHOTO_TYPES[type];
    const magic = (ext === 'jpg' && buf[0] === 0xff && buf[1] === 0xd8) || (ext === 'png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) || (ext === 'webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP');
    if (!ext || !magic || buf.length < 32 || buf.length > MAX_PHOTO) return res.status(400).json({ error: 'A picture is needed.' });
    const filename = 'board-' + crypto.randomBytes(6).toString('hex') + '.' + ext;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
    const row = rowOf(req.params.id), old = row ? row.photo || '' : '';
    const version = save(req.params.id, row ? strokesOf(row) : [], 'photo', { photo: filename });
    if (/^board-[0-9a-f]{12}\.(jpg|png|webp)$/.test(old) && !photoInUse(old)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, old)); } catch { /* already gone */ } }
    broadcastUpdate('photos');
    res.status(201).json({ ok: true, version, background: 'photo', photo: filename });
  });

  // A board that fills up is "flattened": the drawing so far becomes one picture (sent by the screen, as a transparent PNG), drawn first under whatever comes next, and the strokes
  // are cleared. Undo cannot reach back past that. n says how many strokes the picture was made from: if the board has changed since, the answer is 409 and nothing is lost.
  app.post('/api/boards/:id/flatten', express.raw({ type: 'image/png', limit: 8 * 1024 * 1024 + 1024 }), (req, res) => {
    if (!idOk(req, res)) return;
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buf.length < 67 || buf.length > 8 * 1024 * 1024 || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return res.status(400).json({ error: 'A picture is needed.' });
    const row = rowOf(req.params.id), strokes = row ? strokesOf(row) : [];
    if (!row || Number(req.query.n) !== strokes.length || !strokes.length) return res.status(409).json({ error: 'The board has changed.' });
    const filename = 'board-' + crypto.randomBytes(6).toString('hex') + '.png';
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
    const old = row.ink;
    const version = save(req.params.id, [], row.background, { ink: filename });
    dropFile(old);
    res.json({ ok: true, version, ink: filename });
  });

  // ── the household's own stamps: a picture (the screen shrinks it to 256 px first) kept as stamp-<random>.<ext>; the newest 24 are kept, older ones fall off the list ──────────
  const MAX_STAMPS = 24, MAX_STAMP_BYTES = 1024 * 1024;
  const stampUsed = (fn) => { const like = '%' + fn + '%'; return !!(db.prepare(`SELECT 1 FROM whiteboards WHERE strokes LIKE ?`).get(like) || db.prepare(`SELECT 1 FROM kid_drawings WHERE strokes LIKE ?`).get(like)); };
  function pruneStamps() {                                // a stamp taken off the list goes for good once no board or kept drawing draws it
    for (const r of db.prepare(`SELECT id, filename FROM stamps WHERE deleted = 1`).all()) {
      if (stampUsed(r.filename)) continue;
      db.prepare(`DELETE FROM stamps WHERE id = ?`).run(r.id);
      try { fs.unlinkSync(path.join(UPLOAD_DIR, r.filename)); } catch { /* already gone */ }
    }
  }
  app.get('/api/stamps', (req, res) => res.json(db.prepare(`SELECT id, filename FROM stamps WHERE deleted = 0 ORDER BY id`).all()));
  app.post('/api/stamps', express.raw({ type: Object.keys(PHOTO_TYPES), limit: MAX_STAMP_BYTES + 1024 }), (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    const ext = PHOTO_TYPES[type];
    const magic = (ext === 'jpg' && buf[0] === 0xff && buf[1] === 0xd8) || (ext === 'png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) || (ext === 'webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP');
    if (!ext || !magic || buf.length < 32 || buf.length > MAX_STAMP_BYTES) return res.status(400).json({ error: 'A picture is needed.' });
    const filename = 'stamp-' + crypto.randomBytes(6).toString('hex') + '.' + ext;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
    const r = db.prepare(`INSERT INTO stamps (filename) VALUES (?)`).run(filename);
    const live = db.prepare(`SELECT id FROM stamps WHERE deleted = 0 ORDER BY id DESC`).all();
    for (const old of live.slice(MAX_STAMPS)) db.prepare(`UPDATE stamps SET deleted = 1 WHERE id = ?`).run(old.id);
    pruneStamps();
    broadcastUpdate('boards');
    res.status(201).json({ id: r.lastInsertRowid, filename });
  });
  app.delete('/api/stamps/:id', (req, res) => {
    const r = db.prepare(`UPDATE stamps SET deleted = 1 WHERE id = ? AND deleted = 0`).run(Number(req.params.id) || 0);
    if (!r.changes) return res.status(404).json({ error: 'That stamp is not there.' });
    pruneStamps();
    res.json({ ok: true });
  });

  // Keep: the picture of a board kept with its strokes as a drawing of the family (kid 0). It is the newest "show", so the Kids' Drawing widgets show it.
  app.post('/api/boards/:id/keep', express.raw({ type: 'image/png', limit: MAX_PNG + 1024 }), (req, res) => {
    if (!idOk(req, res)) return;
    const buf = pngOf(req);
    if (!buf) return res.status(400).json({ error: 'A picture is needed.' });
    const row = rowOf(req.params.id), name = cleanName(req.query.name);
    const background = row && row.background ? row.background : 'white';
    const png = 'drawing-' + crypto.randomBytes(6).toString('hex') + '.png';
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, png), buf);
    const label = `${name} - ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric' })}`;
    const r = db.prepare(`INSERT INTO kid_drawings (kid_id, kid_name, label, strokes, background, photo, ink, png, status, show_id, show_pos) VALUES (0, ?, ?, ?, ?, ?, ?, ?, 'shown', ?, 0)`)
      .run(name, label, JSON.stringify(row ? strokesOf(row) : []), background, row && background === 'photo' ? row.photo || '' : '', row ? row.ink || '' : '', png, nextShow());
    for (const old of db.prepare(`SELECT * FROM kid_drawings WHERE kid_id = 0 ORDER BY id DESC`).all().slice(MAX_PER_KID)) dropDrawing(old);
    broadcastUpdate('drawings');
    res.status(201).json({ ok: true, drawing: outDrawing(db.prepare(`SELECT * FROM kid_drawings WHERE id = ?`).get(r.lastInsertRowid), nowShowing()) });
  });

  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Whiteboard'; }
  const waitingRows = () => db.prepare(`SELECT id, kid_id, kid_name, label, png AS filename, sent_at FROM kid_drawings WHERE status = 'pending' ORDER BY id`).all();
  const pngOf = (req) => { const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); return buf.length < 67 || buf.length > MAX_PNG || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? null : buf; };

  // ── the kids' drawing pad (kids.html): a draft board per kid (kid-<id>) that Send turns into a creation ──────────
  app.get('/api/kid-drawing/status', (req, res) => {
    res.json({ enabled: getSetting('kids_draw_enabled', '1') !== '0', approval: getSetting('kids_draw_approval', '0') === '1', live: getSetting('kids_draw_live', '1') !== '0' });
  });
  const MAX_PER_KID = 60;                  // a kid's drawings kept; the oldest go first
  const photoInUse = (fn) => !!fn && !!(db.prepare(`SELECT 1 FROM whiteboards WHERE photo = ? OR ink = ?`).get(fn, fn) || db.prepare(`SELECT 1 FROM kid_drawings WHERE photo = ? OR ink = ?`).get(fn, fn));
  function dropFile(fn) { if (/^board-[0-9a-f]{12}\.(jpg|png|webp)$/.test(fn || '') && !photoInUse(fn)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, fn)); } catch { /* already gone */ } } }
  function dropDrawing(row) {
    db.prepare(`DELETE FROM kid_drawings WHERE id = ?`).run(row.id);
    try { fs.unlinkSync(path.join(UPLOAD_DIR, row.png)); } catch { /* already gone */ }
    dropFile(row.photo); dropFile(row.ink);
  }
  const nextShow = () => db.prepare(`SELECT COALESCE(MAX(show_id), 0) + 1 AS n FROM kid_drawings`).get().n;
  const showNow = () => { const r = db.prepare(`SELECT show_id FROM kid_drawings WHERE status = 'shown' AND show_id > 0 ORDER BY show_id DESC LIMIT 1`).get(); return r ? r.show_id : 0; };
  // a grown-up can pin one drawing: it is what the widgets show until it is unpinned, whatever is sent after it
  const pinnedId = () => { const id = Number(getSetting('kids_draw_pin', '')) || 0; return id && db.prepare(`SELECT 1 FROM kid_drawings WHERE id = ? AND status = 'shown'`).get(id) ? id : 0; };
  const nowShowing = () => ({ show: showNow(), pin: pinnedId() });
  const MAX_SHOW = 12;                    // drawings in one rotation
  const outDrawing = (r, ctx) => ({ id: r.id, kid_id: r.kid_id, name: r.kid_name, label: r.label, filename: r.png, status: r.status, sent_at: r.sent_at, pinned: !!ctx && ctx.pin === r.id, showing: !!ctx && r.status === 'shown' && (ctx.pin ? ctx.pin === r.id : !!ctx.show && r.show_id === ctx.show) });
  app.post('/api/kid-drawing/:kidId', express.raw({ type: 'image/png', limit: MAX_PNG + 1024 }), (req, res) => {
    if (getSetting('kids_draw_enabled', '1') === '0') return res.status(403).json({ error: 'Drawing is turned off.' });
    const kid = db.prepare(`SELECT id, name FROM kids WHERE id = ?`).get(Number(req.params.kidId) || 0);
    if (!kid) return res.status(404).json({ error: 'Who is this?' });
    const buf = pngOf(req);
    if (!buf) return res.status(400).json({ error: 'A picture is needed.' });
    const pending = getSetting('kids_draw_approval', '0') === '1';
    if (pending && waitingRows().length >= MAX_WAITING) return res.status(429).json({ error: 'A grown-up needs to look at the other drawings first.' });
    // the picture the kid sees, and the strokes behind it (the draft board), so the drawing can be opened and changed later
    const draft = rowOf('kid-' + kid.id);
    const strokes = draft ? strokesOf(draft) : [];
    const background = draft && draft.background ? draft.background : 'white';
    const photo = draft && background === 'photo' ? draft.photo || '' : '';
    const ink = draft ? draft.ink || '' : '';
    const png = 'drawing-' + crypto.randomBytes(6).toString('hex') + '.png';
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, png), buf);
    const name = cleanName(kid.name), d = new Date();
    const label = `${name} - ${d.toLocaleString('en-US', { month: 'short', day: 'numeric' })}`;
    const r = db.prepare(`INSERT INTO kid_drawings (kid_id, kid_name, label, strokes, background, photo, ink, png, status, show_id, show_pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(kid.id, name, label, JSON.stringify(strokes), background, photo, ink, png, pending ? 'pending' : 'shown', pending ? 0 : nextShow());
    for (const old of db.prepare(`SELECT * FROM kid_drawings WHERE kid_id = ? ORDER BY id DESC`).all(kid.id).slice(MAX_PER_KID)) dropDrawing(old);
    broadcastUpdate('drawings');
    res.status(201).json({ ok: true, pending, drawing: outDrawing(db.prepare(`SELECT * FROM kid_drawings WHERE id = ?`).get(r.lastInsertRowid), nowShowing()) });
  });

  // what the Kids' Drawing widgets rotate through: the newest show (a drawing waiting for a grown-up is not part of any show yet)
  app.get('/api/kid-drawings/showing', (req, res) => {
    const ctx = nowShowing();
    const rows = ctx.pin ? db.prepare(`SELECT * FROM kid_drawings WHERE id = ?`).all(ctx.pin)
      : ctx.show ? db.prepare(`SELECT * FROM kid_drawings WHERE status = 'shown' AND show_id = ? ORDER BY show_pos, id`).all(ctx.show) : [];
    res.json({ show_id: ctx.show, pinned: !!ctx.pin, drawings: rows.map((r) => outDrawing(r, ctx)) });
  });
  app.get('/api/kid-drawings', (req, res) => {
    const kid = Number(req.query.kid) || 0;
    if (!kid) return res.json([]);
    const ctx = nowShowing();
    res.json(db.prepare(`SELECT * FROM kid_drawings WHERE kid_id = ? ORDER BY id DESC LIMIT ${MAX_PER_KID}`).all(kid).map((r) => outDrawing(r, ctx)));
  });
  // a kid picks some of their drawings to rotate on the wall: that is now the newest show, so it replaces whatever was showing (whoever's it was)
  app.post('/api/kid-drawing/:kidId/show', (req, res) => {
    if (getSetting('kids_draw_enabled', '1') === '0') return res.status(403).json({ error: 'Drawing is turned off.' });
    const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(Number(req.params.kidId) || 0);
    if (!kid) return res.status(404).json({ error: 'Who is this?' });
    const ids = [...new Set((Array.isArray((req.body || {}).ids) ? req.body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one drawing.' });
    if (ids.length > MAX_SHOW) return res.status(400).json({ error: 'Pick up to ' + MAX_SHOW + ' drawings.' });
    const rows = ids.map((id) => db.prepare(`SELECT id, status FROM kid_drawings WHERE id = ? AND kid_id = ?`).get(id, kid.id));
    if (rows.some((r) => !r)) return res.status(404).json({ error: 'One of those drawings is not there.' });
    const ok = rows.filter((r) => r.status === 'shown');                          // one still waiting for a grown-up cannot be shown yet
    if (!ok.length) return res.status(409).json({ error: 'Those drawings are waiting for a grown-up.' });
    const show = nextShow(), up = db.prepare(`UPDATE kid_drawings SET show_id = ?, show_pos = ? WHERE id = ?`);
    db.transaction(() => ok.forEach((r, i) => up.run(show, i, r.id)))();
    broadcastUpdate('drawings');
    res.json({ ok: true, show_id: show, count: ok.length });
  });
  // open one of a kid's drawings on their pad: the strokes replace the draft, then the kid changes it and sends it again
  app.post('/api/kid-drawing/:kidId/load/:id', (req, res) => {
    if (getSetting('kids_draw_enabled', '1') === '0') return res.status(403).json({ error: 'Drawing is turned off.' });
    const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(Number(req.params.kidId) || 0);
    const row = kid && db.prepare(`SELECT * FROM kid_drawings WHERE id = ? AND kid_id = ?`).get(Number(req.params.id) || 0, kid.id);
    if (!row) return res.status(404).json({ error: 'That drawing is not there.' });
    let strokes = []; try { strokes = JSON.parse(row.strokes || '[]'); } catch { strokes = []; }
    const version = save('kid-' + kid.id, Array.isArray(strokes) ? strokes : [], row.background || 'white', { photo: row.photo || '', ink: row.ink || '' });
    res.json({ ok: true, version });
  });

  // ── each kid's own pad settings: color, size, tool, stamp ─────────────────────────────────────────────────────────
  const PREF_TOOLS = ['pen', 'marker', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'stamp', 'text'];
  function cleanPrefs(b) {
    b = b || {};
    const o = {};
    if (/^#[0-9a-fA-F]{6}$/.test(String(b.color || ''))) o.color = String(b.color).toLowerCase();
    const size = Number(b.size);
    if (size >= 0.002 && size <= 0.06) o.size = Math.round(size * 100000) / 100000;
    if (PREF_TOOLS.includes(b.tool)) o.tool = b.tool;
    const st = typeof b.stamp === 'string' ? b.stamp : '';
    if (/^img:stamp-[0-9a-f]{12}\.(png|jpg|webp)$/.test(st) || (st && st.length <= 8 && !/[\u0000-\u001f<>&"']/.test(st))) o.stamp = st;
    if (SHAPES.includes(b.shape)) o.shape = b.shape;
    if (typeof b.fillShape === 'boolean') o.fillShape = b.fillShape;
    return o;
  }
  app.get('/api/kid-drawing/:kidId/prefs', (req, res) => {
    const kid = Number(req.params.kidId) || 0;
    if (!db.prepare(`SELECT 1 FROM kids WHERE id = ?`).get(kid)) return res.status(404).json({ error: 'Who is this?' });
    const row = db.prepare(`SELECT prefs FROM kid_draw_prefs WHERE kid_id = ?`).get(kid);
    let o = {}; try { o = cleanPrefs(JSON.parse(row ? row.prefs : '{}')); } catch { o = {}; }
    res.json(o);
  });
  app.put('/api/kid-drawing/:kidId/prefs', (req, res) => {
    const kid = Number(req.params.kidId) || 0;
    if (!db.prepare(`SELECT 1 FROM kids WHERE id = ?`).get(kid)) return res.status(404).json({ error: 'Who is this?' });
    const o = cleanPrefs(req.body);
    db.prepare(`INSERT OR REPLACE INTO kid_draw_prefs (kid_id, prefs) VALUES (?, ?)`).run(kid, JSON.stringify(o));
    res.json(o);
  });

  // ── a grown-up's side: drawings waiting ──────────────────────────────────────────────────────────────────────────
  app.get('/api/drawings/pending', (req, res) => res.json(waitingRows()));
  app.get('/api/drawings/all', (req, res) => {
    const ctx = nowShowing();
    res.json(db.prepare(`SELECT * FROM kid_drawings ORDER BY id DESC LIMIT 60`).all().map((r) => outDrawing(r, ctx)));
  });
  const setPin = (v) => { db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('kids_draw_pin', ?)`).run(String(v || '')); broadcastUpdate('drawings'); };
  app.delete('/api/drawings/pin', (req, res) => { setPin(''); res.json({ ok: true }); });               // (before the delete-by-id route below)
  app.post('/api/drawings/:id/pin', (req, res) => {
    const row = db.prepare(`SELECT id FROM kid_drawings WHERE id = ? AND status = 'shown'`).get(Number(req.params.id) || 0);
    if (!row) return res.status(404).json({ error: 'That drawing cannot be pinned.' });
    setPin(row.id);
    res.json({ ok: true });
  });
  app.post('/api/drawings/:id/approve', (req, res) => {
    const p = db.prepare(`SELECT id FROM kid_drawings WHERE id = ? AND status = 'pending'`).get(Number(req.params.id) || 0);
    if (!p) return res.status(404).json({ error: 'That drawing is not waiting.' });
    db.prepare(`UPDATE kid_drawings SET status = 'shown', sent_at = datetime('now'), show_id = ?, show_pos = 0 WHERE id = ?`).run(nextShow(), p.id);       // approved now: it is the newest show
    broadcastUpdate('drawings');
    res.json({ ok: true });
  });
  app.delete('/api/drawings/:id', (req, res) => {
    const p = db.prepare(`SELECT * FROM kid_drawings WHERE id = ?`).get(Number(req.params.id) || 0);
    if (!p) return res.status(404).json({ error: 'That drawing is not there.' });
    dropDrawing(p);
    if (Number(getSetting('kids_draw_pin', '')) === p.id) setPin('');
    broadcastUpdate('drawings');
    res.json({ ok: true });
  });
};
