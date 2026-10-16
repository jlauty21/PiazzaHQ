'use strict';
// The community recipe library, from this device's side (the library itself lives on piazzahq.com). The browser never talks to that server: it asks this one, which
// asks the library with the same key the feedback form uses, so nothing about the library address or key reaches a web page and the library's pictures come through here too.
//   Browse and copy:  GET  /api/recipe-library/status | recipes | recipes/:id | photos/:file,  POST /api/recipe-library/recipes/:id/add | report
//   Share your own:   POST /api/recipes/:id/share (share), PUT (update the shared copy), DELETE (stop sharing)
// A recipe from the household's own box can be shared, one they typed in or one imported from a web page: the sharer confirms the library's line (that they wrote it or put it in
// their own words, and may share it). An imported recipe goes without its picture and with the name of the site it came from ("Adapted from ..."). A copy of a community recipe is not the
// copier's to share. The author confirms the library's own sharing line (fetched from the library, so its wording can change without an app update) and chooses the name shown;
// the household's notes are only shared if they say so. What the library gives back when sharing - its id for the recipe and a secret that proves the recipe is theirs -
// is kept in the recipe (library_id / library_token) and the secret never leaves this server.
// If the library cannot be reached, or does not exist yet on the server, the status says unavailable and the app shows nothing about it. Covered by test/api/recipe-library.test.js.
module.exports = function registerRecipeLibrary({ app, db, fs, path, UPLOAD_DIR, recipes, isSlave, broadcastUpdate, central, URL }) {
  const PHOTO_MAX = 1.5 * 1024 * 1024;
  const SAFE_PHOTO = /^lib-[0-9a-f]{16}\.(jpg|png|webp)$/;
  const SAFE_LOCAL = /^recipe-\d+-[0-9a-f]+\.(jpg|png|webp)$/;
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  // One request to the library: { status, json } (status 0 = could not be reached); raw: true gives { status, buffer }.
  async function ask(method, p, body, opts = {}) {
    const base = central.base();
    if (!base) return { status: 0, json: null };
    let url; try { url = new URL(base + p); } catch { return { status: 0, json: null }; }
    const key = central.key();
    try {
      const res = await central.fetch(url, {
        method,
        headers: { Accept: opts.raw ? 'image/*' : 'application/json', ...(key ? { 'x-feedback-key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
        body: body ? JSON.stringify(body) : undefined,
        timeoutMs: opts.timeoutMs || 12000,
      });
      if (opts.raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
      let json = null; try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, json };
    } catch { return { status: 0, json: null }; }
  }
  // What to tell the person: the library's own sentence for a refusal that is about what they sent, and a plain one when it is the library's or the network's trouble.
  function fail(res, r, fallback) {
    if ([400, 404, 409, 429].includes(r.status) && r.json && r.json.error) return res.status(r.status).json({ error: r.json.error });
    if (r.status === 404) return res.status(404).json({ error: 'That recipe is not in the library any more.' });
    return res.status(502).json({ error: fallback || 'The community library could not be reached right now. Try again in a little while.' });
  }

  // ── is there a library at all (the server this device uses may not have it yet) ─────────────────────────────────────
  let cached = { at: 0, data: { available: false } };
  async function libraryStatus() {
    if (Date.now() - cached.at < (cached.data.available ? 60000 : 20000)) return cached.data;
    const r = await ask('GET', '/api/v1/library/status', null, { timeoutMs: 6000 });
    cached = { at: Date.now(), data: r.status === 200 && r.json && r.json.available ? { available: true, terms_version: r.json.terms_version, terms_text: String(r.json.terms_text || ''), count: r.json.count || 0 } : { available: false } };
    return cached.data;
  }
  app.get('/api/recipe-library/status', async (req, res) => { res.json(await libraryStatus()); });

  const photoPath = (p) => (p ? '/api/recipe-library/photos/' + String(p).split('/').pop() : '');
  app.get('/api/recipe-library/recipes', async (req, res) => {
    const qs = new URLSearchParams();
    for (const k of ['q', 'course', 'tag', 'limit', 'offset']) if (req.query[k] !== undefined && String(req.query[k]) !== '') qs.set(k, String(req.query[k]).slice(0, 80));
    const r = await ask('GET', '/api/v1/library/recipes?' + qs.toString());
    if (r.status !== 200 || !r.json) return fail(res, r);
    res.json({ total: r.json.total || 0, recipes: (r.json.recipes || []).map((x) => ({ ...x, photo: photoPath(x.photo) })) });
  });
  app.get('/api/recipe-library/recipes/:id', async (req, res) => {
    if (!/^r_[0-9a-f]{12}$/.test(req.params.id)) return res.status(404).json({ error: 'That recipe is not in the library any more.' });
    const r = await ask('GET', '/api/v1/library/recipes/' + req.params.id);
    if (r.status !== 200 || !r.json) return fail(res, r);
    res.json({ ...r.json, photo: photoPath(r.json.photo) });
  });
  app.get('/api/recipe-library/photos/:file', async (req, res) => {
    if (!SAFE_PHOTO.test(req.params.file)) return res.status(404).end();
    const r = await ask('GET', '/api/v1/library/photos/' + req.params.file, null, { raw: true });
    if (r.status !== 200 || !r.buffer || !r.buffer.length) return res.status(404).end();
    res.set({ 'Content-Type': req.params.file.endsWith('.png') ? 'image/png' : req.params.file.endsWith('.webp') ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.send(r.buffer);
  });

  // ── copy a community recipe into this household's recipe box ──────────────────────────────────────────────────────
  app.post('/api/recipe-library/recipes/:id/add', async (req, res) => {
    if (!/^r_[0-9a-f]{12}$/.test(req.params.id)) return res.status(404).json({ error: 'That recipe is not in the library any more.' });
    const r = await ask('GET', '/api/v1/library/recipes/' + req.params.id);
    if (r.status !== 200 || !r.json) return fail(res, r);
    const x = r.json;
    const id = recipes.createRecipe({
      title: x.title, description: x.description, servings: x.servings, prep_min: x.prep_min, cook_min: x.cook_min, tags: x.tags, course: x.course,
      ingredients: x.ingredients, steps: x.steps, notes: x.notes, source_name: x.source ? clean(x.source, 60) + ' · shared by ' + clean(x.author, 40) : 'Community recipe by ' + clean(x.author, 40), source_url: x.source_url || '', origin: 'shared',
    });
    if (!id) return res.status(400).json({ error: 'The recipe could not be added (the recipe box may be full).' });
    if (x.photo) {
      const pr = await ask('GET', '/api/v1/library/photos/' + String(x.photo).split('/').pop(), null, { raw: true });
      if (pr.status === 200 && pr.buffer && pr.buffer.length) recipes.attachPhoto(id, pr.buffer);
    }
    ask('POST', '/api/v1/library/recipes/' + req.params.id + '/added', { device_id: central.deviceId() }).catch(() => {});      // only a count on their side; never blocks the copy
    res.status(201).json(recipes.fullOut(recipes.recipeRow(id)));
  });

  app.post('/api/recipe-library/recipes/:id/report', async (req, res) => {
    if (!/^r_[0-9a-f]{12}$/.test(req.params.id)) return res.status(404).json({ error: 'That recipe is not in the library any more.' });
    const b = req.body || {};
    const r = await ask('POST', '/api/v1/library/recipes/' + req.params.id + '/report', { device_id: central.deviceId(), reason: ['copyright', 'offensive', 'spam', 'other'].includes(b.reason) ? b.reason : 'other', note: clean(b.note, 300) });
    if (r.status !== 200 || !r.json) return fail(res, r, 'The report could not be sent right now. Try again in a little while.');
    res.json({ ok: true });
  });

  // ── share one of our own ──────────────────────────────────────────────────────────────────────────────────────
  // What the library is sent: the recipe at its own servings, ingredient lines as typed (a section title as a line ending in a colon), steps with their timers, the picture
  // if it is small enough, and the notes only if asked.
  function payloadFor(row, b) {
    const f = recipes.fullOut(row);
    const lines = []; let g = '';
    for (const i of f.ingredients) { if (i.group_label && i.group_label !== g) lines.push(i.group_label + ':'); g = i.group_label || ''; lines.push(i.raw || i.display); }
    const out = {
      device_id: central.deviceId(), author_name: clean(b.author_name, 40), author_location: clean(b.author_location, 60), source_name: row.origin === 'imported' ? clean(f.source_name || hostOf(f.source_url), 80) : '', source_url: row.origin === 'imported' ? f.source_url : '', title: f.title, description: f.description, servings: f.base_servings, prep_min: f.prep_min, cook_min: f.cook_min,
      course: f.course, tags: f.tags, ingredients: lines, steps: f.steps.map((s) => ({ text: s.text, timer_sec: s.timer_sec || 0 })), notes: b.include_notes ? f.notes : '',
    };
    let photoSkipped = false, hasPhoto = false;
    if (row.photo && row.origin !== 'imported' && SAFE_LOCAL.test(row.photo)) {          // a picture that came from a web page is never sent
      try {
        const buf = fs.readFileSync(path.join(UPLOAD_DIR, row.photo));
        if (buf.length <= PHOTO_MAX) { out.photo_base64 = buf.toString('base64'); hasPhoto = true; } else photoSkipped = true;
      } catch { /* no picture file: share without */ }
    }
    return { out, photoSkipped, hasPhoto };
  }
  const rowOf = (id) => recipes.recipeRow(Number(id));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

  app.post('/api/recipes/:id/share', async (req, res) => {
    const row = rowOf(req.params.id);
    if (!row) return res.status(404).json({ error: 'That recipe no longer exists.' });
    const b = req.body || {};
    if (isSlave()) return res.status(409).json({ error: 'Share recipes from your main (host) device.' });
    if ((row.origin || 'own') === 'shared') return res.status(400).json({ error: 'This recipe was copied from the community, so it is already in the library.' });
    if (row.library_id) return res.status(409).json({ error: 'This recipe is already shared. Use Update shared copy to change it.' });
    if (b.terms_accepted !== true) return res.status(400).json({ error: 'Confirm the sharing line first.' });
    const st = await libraryStatus();
    if (!st.available) return res.status(502).json({ error: 'The community library is not available right now.' });
    const { out, photoSkipped } = payloadFor(row, b);
    const r = await ask('POST', '/api/v1/library/recipes', { ...out, terms_accepted: true, terms_version: st.terms_version }, { timeoutMs: 30000 });
    if (r.status !== 201 || !r.json || !r.json.id) return fail(res, r, 'The recipe could not be shared right now. Try again in a little while.');
    db.prepare(`UPDATE recipes SET library_id = ?, library_token = ?, library_author = ?, library_location = ?, library_shared_at = datetime('now') WHERE id = ?`).run(r.json.id, r.json.owner_token, out.author_name, out.author_location, row.id);
    broadcastUpdate('recipes');
    res.status(201).json({ ok: true, photo_skipped: photoSkipped, recipe: recipes.fullOut(rowOf(row.id)) });
  });

  app.put('/api/recipes/:id/share', async (req, res) => {
    const row = rowOf(req.params.id);
    if (!row) return res.status(404).json({ error: 'That recipe no longer exists.' });
    if (isSlave()) return res.status(409).json({ error: 'Share recipes from your main (host) device.' });
    if (!row.library_id) return res.status(409).json({ error: 'This recipe is not shared.' });
    const b = { ...(req.body || {}) }; if (b.author_name === undefined) b.author_name = row.library_author; if (b.author_location === undefined) b.author_location = row.library_location;
    const { out, photoSkipped, hasPhoto } = payloadFor(row, b);
    const r = await ask('PUT', '/api/v1/library/recipes/' + row.library_id, { ...out, ...(hasPhoto ? {} : { remove_photo: !photoSkipped }) }, { headers: { 'x-owner-token': row.library_token }, timeoutMs: 30000 });
    if (r.status === 404 || r.status === 403) {          // the library no longer has it (removed there): this one is no longer shared
      db.prepare(`UPDATE recipes SET library_id = '', library_token = '', library_author = '', library_location = '', library_shared_at = '' WHERE id = ?`).run(row.id);
      broadcastUpdate('recipes');
      return res.status(404).json({ error: 'The community library no longer has this recipe, so it is not shared any more.' });
    }
    if (r.status !== 200) return fail(res, r, 'The shared copy could not be updated right now. Try again in a little while.');
    db.prepare(`UPDATE recipes SET library_author = ?, library_location = ?, library_shared_at = datetime('now') WHERE id = ?`).run(out.author_name, out.author_location, row.id);
    broadcastUpdate('recipes');
    res.json({ ok: true, photo_skipped: photoSkipped, recipe: recipes.fullOut(rowOf(row.id)) });
  });

  app.delete('/api/recipes/:id/share', async (req, res) => {
    const row = rowOf(req.params.id);
    if (!row) return res.status(404).json({ error: 'That recipe no longer exists.' });
    if (!row.library_id) return res.json({ ok: true, recipe: recipes.fullOut(row) });
    if (isSlave()) return res.status(409).json({ error: 'Stop sharing from your main (host) device.' });
    const r = await ask('DELETE', '/api/v1/library/recipes/' + row.library_id, null, { headers: { 'x-owner-token': row.library_token } });
    if (r.status === 0 || r.status >= 500 || r.status === 401) return res.status(502).json({ error: 'The community library could not be reached, so the recipe is still shared. Try again in a little while.' });
    db.prepare(`UPDATE recipes SET library_id = '', library_token = '', library_author = '', library_location = '', library_shared_at = '' WHERE id = ?`).run(row.id);   // gone there (or never there): not shared here
    broadcastUpdate('recipes');
    res.json({ ok: true, recipe: recipes.fullOut(rowOf(row.id)) });
  });
};
