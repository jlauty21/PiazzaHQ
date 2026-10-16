'use strict';
// Recipes: the household recipe box. A recipe has a title, servings, times, tags, a photo, ingredients and steps. Ingredients are typed as ordinary lines
// ("1 1/2 cups flour, sifted"; a line ending in ":" starts a section such as "For the sauce:") and are read into amount / unit / name / note by
// src/recipe-parse.js so the recipe can be scaled to another number of servings. Covered by test/api/recipes.test.js.
//
// The photo is a flat file in uploads/ (recipe-<id>-<random>.<ext>): mirrors copy it with the photos and the three tables arrive in the sync snapshot
// (see /api/sync/export and /api/sync/photos in server.js). On a mirror, writes are passed on to the host like every other shared content.
const { parseIngredient, parseIngredientLines, ingredientDisplay, parseTimer } = require('./recipe-parse');
const { parseRecipeText, extractRecipeFromHtml, safeGet, imageKind } = require('./recipe-import');
const { buildRecipePdf } = require('./recipe-pdf');

module.exports = function registerRecipes({ path, fs, crypto, app, db, UPLOAD_DIR, multer, broadcastUpdate, forgetRecipe }) {
  const MAX_RECIPES = 2000;
  const MAX_INGREDIENTS = 100;
  const MAX_STEPS = 100;
  const COURSES = ['breakfast', 'lunch', 'dinner', 'appetizer', 'main', 'side', 'soup', 'salad', 'dessert', 'drink', 'snack'];

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
  });

  const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
  const clampInt = (v, lo, hi, dflt) => Math.round(clampNum(v, lo, hi, dflt));
  const oneLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const longText = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
  const urlOf = (file) => (file ? '/uploads/' + file : '');
  const extFor = (mime) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');
  const SAFE_FILE = /^recipe-\d+-[0-9a-f]+\.(jpg|png|webp)$/;

  // "Dinner, quick ,dinner" -> "dinner,quick": lower case, no blanks or repeats, at most 20 of up to 30 characters
  function cleanTags(v) {
    const list = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
    const seen = new Set(), out = [];
    for (const t of list) {
      const tag = oneLine(t, 30).toLowerCase();
      if (tag && !seen.has(tag)) { seen.add(tag); out.push(tag); }
      if (out.length >= 20) break;
    }
    return out.join(',');
  }
  const tagList = (s) => String(s || '').split(',').filter(Boolean);
  const cleanUrl = (v) => { const s = oneLine(v, 500); return /^https?:\/\/\S+$/i.test(s) ? s : ''; };

  // what the caller sent for ingredients / steps -> rows to store
  function ingredientRows(input) {
    const lines = Array.isArray(input) ? input.map((x) => (typeof x === 'string' ? x : x && (x.raw || x.text || x.name) || '')) : input;
    return parseIngredientLines(lines, MAX_INGREDIENTS);
  }
  function stepRows(input) {
    const items = Array.isArray(input) ? input : String(input == null ? '' : input).split(/\n+/);
    const out = [];
    for (const s of items) {
      let text = longText(typeof s === 'string' ? s : s && s.text, 2000);
      let timer = typeof s === 'object' && s ? clampInt(s.timer_sec, 0, 86400, 0) : 0;
      // a step can end with its time in brackets ("Simmer the sauce. [10 min]"): that becomes the step's timer
      const m = /\s*\[([^\]]*)\]\s*$/.exec(text);
      if (m && parseTimer(m[1]) > 0) { timer = parseTimer(m[1]); text = text.slice(0, m.index).trim(); }
      if (!text) continue;
      out.push({ text, timer_sec: timer });
      if (out.length >= MAX_STEPS) break;
    }
    return out;
  }

  function recipeRow(id) { return db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(id); }
  function listOut(r) {
    return {
      id: r.id, title: r.title, description: r.description || '', servings: r.servings, prep_min: r.prep_min || 0, cook_min: r.cook_min || 0,
      tags: tagList(r.tags), course: COURSES.includes(r.course) ? r.course : '', photo: urlOf(r.photo), favorite: !!r.favorite, origin: r.origin || 'own', shared: !!r.library_id, updated_at: r.updated_at,
      ingredient_count: r.ingredient_count != null ? r.ingredient_count : db.prepare(`SELECT COUNT(*) AS n FROM recipe_ingredients WHERE recipe_id = ?`).get(r.id).n,
      step_count: r.step_count != null ? r.step_count : db.prepare(`SELECT COUNT(*) AS n FROM recipe_steps WHERE recipe_id = ?`).get(r.id).n,
    };
  }
  // The whole recipe. `servings` (optional) scales the ingredient lines: ingredient.display is what to show at that many servings.
  function fullOut(r, servings) {
    const base = Number(r.servings) > 0 ? Number(r.servings) : 4;
    const want = Number(servings) > 0 ? clampNum(servings, 0.5, 1000, base) : base;
    const factor = want / base;
    const ings = db.prepare(`SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position ASC, id ASC`).all(r.id).map((i) => ({
      id: i.id, position: i.position, group_label: i.group_label || '', quantity: i.quantity, quantity_max: i.quantity_max, unit: i.unit || '', name: i.name,
      note: i.note || '', raw: i.raw || '', display: ingredientDisplay(i, factor),
    }));
    const steps = db.prepare(`SELECT id, position, text, timer_sec FROM recipe_steps WHERE recipe_id = ? ORDER BY position ASC, id ASC`).all(r.id);
    return { ...listOut(r), notes: r.notes || '', source_url: r.source_url || '', source_name: r.source_name || '', created_at: r.created_at,
      library: r.library_id ? { author: r.library_author || '', location: r.library_location || '', shared_at: r.library_shared_at || '' } : null,       // shared with the community (the library's id and the secret stay on the server)
      base_servings: base, scale: factor, servings: want, ingredients: ings, steps };
  }

  const insertIngredients = (recipeId, rows) => {
    const ins = db.prepare(`INSERT INTO recipe_ingredients (recipe_id, position, quantity, quantity_max, unit, name, note, group_label, raw) VALUES (?,?,?,?,?,?,?,?,?)`);
    rows.forEach((r, i) => ins.run(recipeId, i + 1, r.quantity, r.quantity_max, r.unit || '', r.name, r.note || '', r.group_label || '', r.raw || ''));
  };
  const insertSteps = (recipeId, rows) => {
    const ins = db.prepare(`INSERT INTO recipe_steps (recipe_id, position, text, timer_sec) VALUES (?,?,?,?)`);
    rows.forEach((r, i) => ins.run(recipeId, i + 1, r.text, r.timer_sec || 0));
  };

  function removePhotoFile(file) {
    if (file && SAFE_FILE.test(file)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, file)); } catch { /* already gone */ } }
  }

  // ── list, tags, one recipe ───────────────────────────────────────────────────────────────────────────────
  app.get('/api/recipes', (req, res) => {
    const q = oneLine(req.query.q, 100).toLowerCase();
    const tag = oneLine(req.query.tag, 30).toLowerCase();
    const favOnly = req.query.favorite === '1' || req.query.favorite === 'true';
    const course = COURSES.includes(String(req.query.course || '')) ? String(req.query.course) : '';
    const rows = db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM recipe_ingredients i WHERE i.recipe_id = r.id) AS ingredient_count,
                  (SELECT COUNT(*) FROM recipe_steps s WHERE s.recipe_id = r.id) AS step_count
        FROM recipes r ORDER BY r.title COLLATE NOCASE ASC, r.id ASC`).all();
    const ingNames = q ? db.prepare(`SELECT recipe_id, group_concat(lower(name), ' | ') AS names FROM recipe_ingredients GROUP BY recipe_id`).all() : [];
    const byRecipe = new Map(ingNames.map((x) => [x.recipe_id, x.names || '']));
    const words = q.split(/\s+/).filter(Boolean);
    const out = rows.filter((r) => {
      if (favOnly && !r.favorite) return false;
      if (tag && !tagList(r.tags).includes(tag)) return false;
      if (course && r.course !== course) return false;
      if (words.length) {
        const hay = `${r.title} ${r.description} ${r.tags} ${byRecipe.get(r.id) || ''}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;           // every word must be found somewhere: title, description, tag or ingredient
      }
      return true;
    }).map(listOut);
    res.json(out);
  });

  // which courses have recipes, in the usual order (breakfast to snack), for the filter chips
  app.get('/api/recipes/courses', (req, res) => {
    const count = new Map();
    for (const r of db.prepare(`SELECT course FROM recipes WHERE course != ''`).all()) count.set(r.course, (count.get(r.course) || 0) + 1);
    res.json(COURSES.filter((c) => count.has(c)).map((c) => ({ course: c, count: count.get(c) })));
  });

  app.get('/api/recipes/tags', (req, res) => {
    const count = new Map();
    for (const r of db.prepare(`SELECT tags FROM recipes WHERE tags != ''`).all()) for (const t of tagList(r.tags)) count.set(t, (count.get(t) || 0) + 1);
    res.json([...count.entries()].map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)));
  });

  app.get('/api/recipes/:id', (req, res) => {
    const r = recipeRow(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'That recipe no longer exists.' });
    res.json(fullOut(r, req.query.servings));
  });

  // The recipe as a PDF at the servings asked for (for printing from a phone: it opens in the phone's own viewer, where Share and Print work). inline, so a browser shows it.
  const COURSE_NAME = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', appetizer: 'Appetizer', main: 'Main dish', side: 'Side dish', soup: 'Soup', salad: 'Salad', dessert: 'Dessert', drink: 'Drink', snack: 'Snack' };
  app.get('/api/recipes/:id/pdf', (req, res) => {
    const r = recipeRow(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'That recipe no longer exists.' });
    const f = fullOut(r, req.query.servings);
    const num = (n) => String(Math.round(n * 100) / 100);
    const facts = [f.course && COURSE_NAME[f.course], 'Serves ' + num(f.servings), f.prep_min ? 'Prep ' + f.prep_min + ' min' : '', f.cook_min ? 'Cook ' + f.cook_min + ' min' : ''].filter(Boolean);
    const ingredients = []; let g = '';
    for (const i of f.ingredients) { if (i.group_label && i.group_label !== g) ingredients.push({ group: i.group_label }); g = i.group_label || ''; ingredients.push({ text: i.display }); }
    const buf = buildRecipePdf({ title: f.title, description: f.description, facts, ingredients: ingredients.filter((x) => x.group || x.text), steps: f.steps.map((s) => s.text + (s.timer_sec ? ' (' + Math.round(s.timer_sec / 60 * 10) / 10 + ' min)' : '')), notes: f.notes, source: f.source_name || f.source_url ? 'Source: ' + (f.source_name || f.source_url) : '' });
    const name = String(f.title).replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'recipe';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + name + '.pdf"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(buf);
  });

  // ── create, change, delete ───────────────────────────────────────────────────────────────────────────────
  // 'shared' (a copy from the community library) can only be set by the library module through createRecipe(), never by a request to the recipes routes
  let allowSharedOrigin = false;
  const save = db.transaction((id, b, isNew) => {
    const cur = isNew ? null : recipeRow(id);
    const pick = (k, dflt) => (b[k] !== undefined ? b[k] : (cur ? cur[k] : dflt));
    const title = oneLine(pick('title', ''), 120);
    const fields = {
      title,
      description: longText(pick('description', ''), 2000),
      servings: clampNum(pick('servings', 4), 0.5, 1000, 4),
      prep_min: clampInt(pick('prep_min', 0), 0, 6000, 0),
      cook_min: clampInt(pick('cook_min', 0), 0, 6000, 0),
      source_url: b.source_url !== undefined ? cleanUrl(b.source_url) : (cur ? cur.source_url : ''),
      source_name: oneLine(pick('source_name', ''), 80),
      tags: b.tags !== undefined ? cleanTags(b.tags) : (cur ? cur.tags : ''),
      notes: longText(pick('notes', ''), 4000),
      favorite: b.favorite !== undefined ? (b.favorite ? 1 : 0) : (cur ? cur.favorite : 0),
      origin: cur ? cur.origin : (b.origin === 'imported' ? 'imported' : (b.origin === 'shared' && allowSharedOrigin) ? 'shared' : 'own'),
      course: b.course !== undefined ? (COURSES.includes(b.course) ? b.course : '') : (cur ? (cur.course || '') : ''),
    };
    if (isNew) {
      const r = db.prepare(`INSERT INTO recipes (title, description, servings, prep_min, cook_min, source_url, source_name, tags, notes, favorite, origin, course) VALUES (@title,@description,@servings,@prep_min,@cook_min,@source_url,@source_name,@tags,@notes,@favorite,@origin,@course)`).run(fields);
      id = Number(r.lastInsertRowid);
    } else {
      db.prepare(`UPDATE recipes SET title=@title, description=@description, servings=@servings, prep_min=@prep_min, cook_min=@cook_min, source_url=@source_url, source_name=@source_name, tags=@tags, notes=@notes, favorite=@favorite, course=@course, updated_at=datetime('now') WHERE id=@id`).run({ ...fields, origin: undefined, id });
    }
    if (b.ingredients !== undefined) { db.prepare(`DELETE FROM recipe_ingredients WHERE recipe_id = ?`).run(id); insertIngredients(id, ingredientRows(b.ingredients)); }
    if (b.steps !== undefined) { db.prepare(`DELETE FROM recipe_steps WHERE recipe_id = ?`).run(id); insertSteps(id, stepRows(b.steps)); }
    return id;
  });

  app.post('/api/recipes', (req, res) => {
    const b = req.body || {};
    if (!oneLine(b.title, 120)) return res.status(400).json({ error: 'A recipe needs a title.' });
    if (db.prepare(`SELECT COUNT(*) AS n FROM recipes`).get().n >= MAX_RECIPES) return res.status(400).json({ error: `At most ${MAX_RECIPES} recipes.` });
    const id = save(0, b, true);
    broadcastUpdate('recipes');
    res.status(201).json(fullOut(recipeRow(id)));
  });

  app.put('/api/recipes/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!recipeRow(id)) return res.status(404).json({ error: 'That recipe no longer exists.' });
    const b = req.body || {};
    if (b.title !== undefined && !oneLine(b.title, 120)) return res.status(400).json({ error: 'A recipe needs a title.' });
    save(id, b, false);
    broadcastUpdate('recipes');
    res.json(fullOut(recipeRow(id)));
  });

  app.delete('/api/recipes/:id', (req, res) => {
    const id = Number(req.params.id);
    const r = recipeRow(id);
    if (!r) return res.status(404).json({ error: 'That recipe no longer exists.' });
    db.transaction(() => {
      db.prepare(`DELETE FROM recipe_ingredients WHERE recipe_id = ?`).run(id);
      db.prepare(`DELETE FROM recipe_steps WHERE recipe_id = ?`).run(id);
      db.prepare(`DELETE FROM recipes WHERE id = ?`).run(id);
      db.prepare(`UPDATE meals SET recipe_id = NULL WHERE recipe_id = ?`).run(id);          // a planned meal keeps its name but loses the link
    })();
    removePhotoFile(r.photo);
    try { forgetRecipe(id); } catch { /* a screen cooking it is stopped when it next asks */ }   // stop any screen cooking it and drop it from schedules
    broadcastUpdate('recipes');
    res.json({ ok: true });
  });


  // ── phase 2: getting a recipe in from somewhere else ─────────────────────────────────────────────────────
  // Both routes only READ and hand back what the editor needs to show for checking (nothing is saved until the person saves it).
  const previewOut = (p) => ({ title: p.title, description: p.description, servings: p.servings, prep_min: p.prep_min, cook_min: p.cook_min, tags: p.tags, ingredients: p.ingredients, steps: p.steps,
    source_name: p.source_name, source_url: p.source_url, origin: p.origin, image_url: p.image_url || '', course: p.course || '' });

  app.post('/api/recipes/parse-text', (req, res) => {
    const text = String((req.body || {}).text == null ? '' : req.body.text);
    if (!text.trim()) return res.status(400).json({ error: 'Paste the recipe text first.' });
    if (text.length > 30000) return res.status(400).json({ error: 'That is too long for one recipe (30,000 characters at most).' });
    const p = parseRecipeText(text);
    if (!p || (!p.ingredients.length && !p.steps.length)) return res.status(422).json({ error: 'No ingredients or steps could be found in that text. Try adding the words Ingredients and Directions on lines of their own.' });
    res.json(previewOut(p));
  });

  app.post('/api/recipes/import-url', async (req, res) => {
    const url = oneLine((req.body || {}).url, 1000);
    if (!url) return res.status(400).json({ error: 'Enter a web address first.' });
    try {
      const page = await safeGet(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url, { maxBytes: 3 * 1024 * 1024 });
      const p = extractRecipeFromHtml(page.buffer.toString('utf8'), page.url);
      if (!p || (!p.ingredients.length && !p.steps.length)) return res.status(422).json({ error: 'No recipe was found on that page. Copy the recipe text and use Paste instead.' });
      res.json(previewOut(p));
    } catch (e) {
      const status = e.code === 'BAD_URL' || e.code === 'BLOCKED' ? 400 : 502;
      res.status(status).json({ error: e.code ? e.message : 'The page could not be read.' });
    }
  });

  // The picture from the page the recipe came from, copied into the recipe (so it still shows if the site changes or goes away).
  app.post('/api/recipes/:id/photo-from-url', async (req, res) => {
    const id = Number(req.params.id);
    const r = recipeRow(id);
    if (!r) return res.status(404).json({ error: 'That recipe no longer exists.' });
    const url = oneLine((req.body || {}).url, 1000);
    if (!url) return res.status(400).json({ error: 'There is no picture address.' });
    try {
      const got = await safeGet(url, { maxBytes: 10 * 1024 * 1024, accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8' });
      const kind = imageKind(got.buffer);
      if (!kind) return res.status(422).json({ error: 'That is not a JPEG, PNG or WebP picture.' });
      const file = `recipe-${id}-${crypto.randomBytes(4).toString('hex')}.${extFor(kind)}`;
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, file), got.buffer);
      db.prepare(`UPDATE recipes SET photo = ?, updated_at = datetime('now') WHERE id = ?`).run(file, id);
      removePhotoFile(r.photo);
      broadcastUpdate('recipes');
      res.json(fullOut(recipeRow(id)));
    } catch (e) {
      res.status(e.code === 'BAD_URL' || e.code === 'BLOCKED' ? 400 : 502).json({ error: e.code ? e.message : 'The picture could not be fetched.' });
    }
  });

  // The picture from the recipe's own source page: reads the page the recipe came from (its source address), finds the recipe's picture and keeps a copy here. For a recipe copied
  // from the community whose sharer could not include the picture; the same safe fetching as an import, so nothing on a private network can be reached this way.
  app.post('/api/recipes/:id/photo-from-source', async (req, res) => {
    const id = Number(req.params.id);
    const r = recipeRow(id);
    if (!r) return res.status(404).json({ error: 'That recipe no longer exists.' });
    if (!r.source_url) return res.status(400).json({ error: 'This recipe has no original page to get a picture from.' });
    try {
      const page = await safeGet(r.source_url, { maxBytes: 3 * 1024 * 1024 });
      const p = extractRecipeFromHtml(page.buffer.toString('utf8'), page.url);
      if (!p || !p.image_url) return res.status(422).json({ error: 'No picture could be found on that page.' });
      const got = await safeGet(p.image_url, { maxBytes: 10 * 1024 * 1024, accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8' });
      if (!attachPhoto(id, got.buffer)) return res.status(422).json({ error: 'No picture could be found on that page.' });
      res.json(fullOut(recipeRow(id)));
    } catch (e) {
      res.status(e.code === 'BAD_URL' || e.code === 'BLOCKED' ? 400 : 502).json({ error: e.code ? e.message : 'The page could not be read, so no picture was added.' });
    }
  });

  // ── phase 2: ingredients to the shopping list ────────────────────────────────────────────────────────────
  // "2 cups flour" already on the list plus "1 cup flour" from a recipe becomes "3 cups flour" (same name, same unit); anything else is a new line.
  // Items already ticked off are left alone, and a line with no amount ("salt") is not added twice.
  const nameKey = (n) => { let s = String(n || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y'; else if (s.endsWith('es') && /(ch|sh|x|s|o)es$/.test(s)) s = s.slice(0, -2); else if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) s = s.slice(0, -1); return s; };
  function addToShopping(id, b) {
    id = Number(id);
    const r = recipeRow(id);
    if (!r) return { status: 404, body: { error: 'That recipe no longer exists.' } };
    b = b || {};
    let list;
    if (b.list_id === undefined || b.list_id === null || b.list_id === '') list = db.prepare(`SELECT id, name FROM shopping_lists ORDER BY sort_order, id LIMIT 1`).get();
    else list = db.prepare(`SELECT id, name FROM shopping_lists WHERE id = ?`).get(Number(b.list_id));
    if (!list && (b.list_id === undefined || b.list_id === null || b.list_id === '')) {
      const nid = Number(db.prepare(`INSERT INTO shopping_lists (name, sort_order) VALUES ('Shopping List', 0)`).run().lastInsertRowid);
      list = { id: nid, name: 'Shopping List' };
    }
    if (!list) return { status: 404, body: { error: 'That shopping list no longer exists.' } };
    const base = Number(r.servings) > 0 ? Number(r.servings) : 4;
    const want = Number(b.servings) > 0 ? clampNum(b.servings, 0.5, 1000, base) : base;
    const factor = want / base;
    const only = Array.isArray(b.ingredient_ids) ? new Set(b.ingredient_ids.map(Number)) : null;
    const ings = db.prepare(`SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position ASC, id ASC`).all(id).filter((i) => !only || only.has(i.id));
    if (!ings.length) return { status: 400, body: { error: 'There is nothing to add.' } };

    const result = { list_id: list.id, list_name: list.name, added: 0, merged: 0, skipped: 0 };
    db.transaction(() => {
      const existing = db.prepare(`SELECT id, text FROM shopping_items WHERE list_id = ? AND done = 0`).all(list.id).map((e) => ({ ...e, p: parseIngredient(e.text) })).filter((e) => e.p && !e.p.header);
      const maxOrder = db.prepare(`SELECT MAX(sort_order) AS m FROM shopping_items WHERE list_id = ?`).get(list.id).m || 0;
      let order = maxOrder;
      for (const i of ings) {
        const q = i.quantity === null || i.quantity === undefined ? null : Number(i.quantity_max || i.quantity) * factor;   // shop for the top of a range
        const key = nameKey(i.name);
        // the same name in the same unit; or the same name already on the list with no amount at all ("milk"), which the recipe's line ("1 cup milk") replaces
        const same = existing.find((e) => nameKey(e.p.name) === key && (e.p.unit || '') === (i.unit || '')) || existing.find((e) => nameKey(e.p.name) === key && e.p.quantity === null);
        if (same) {
          if (q !== null && same.p.quantity !== null) {
            const total = Number(same.p.quantity) + q;
            const merged = { quantity: total, unit: i.unit || '', name: total > 1.0001 && String(i.name).length > String(same.p.name).length ? i.name : same.p.name, note: same.p.note || '' };   // 1 egg + 2 eggs -> 3 eggs
            const text = ingredientDisplay(merged, 1).slice(0, 120);
            db.prepare(`UPDATE shopping_items SET text = ? WHERE id = ?`).run(text, same.id);
            same.p = parseIngredient(text); same.text = text; result.merged++;
          } else if (q !== null && same.p.quantity === null) {
            const text = ingredientDisplay({ quantity: q, unit: i.unit || '', name: i.name, note: '' }, 1).slice(0, 120);
            db.prepare(`UPDATE shopping_items SET text = ? WHERE id = ?`).run(text, same.id);
            same.p = parseIngredient(text); same.text = text; result.merged++;
          } else result.skipped++;                                                           // it is on the list already and there is no amount to add
          continue;
        }
        const text = ingredientDisplay({ quantity: q, unit: i.unit || '', name: i.name, note: i.note || '' }, 1).slice(0, 120);
        const ins = db.prepare(`INSERT INTO shopping_items (list_id, text, sort_order) VALUES (?, ?, ?)`).run(list.id, text, ++order);
        existing.push({ id: Number(ins.lastInsertRowid), text, p: parseIngredient(text) });
        result.added++;
      }
    })();
    broadcastUpdate('shopping');
    return { status: 200, body: result };
  }
  app.post('/api/recipes/:id/shopping', (req, res) => { const out = addToShopping(req.params.id, req.body); res.status(out.status).json(out.body); });

  // ── photo ────────────────────────────────────────────────────────────────────────────────────────────────
  app.post('/api/recipes/:id/photo', (req, res) => {
    upload.single('photo')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That picture is too big (10 MB at most).' : 'The picture could not be read.' });
      const id = Number(req.params.id);
      const r = recipeRow(id);
      if (!r) return res.status(404).json({ error: 'That recipe no longer exists.' });
      if (!req.file) return res.status(400).json({ error: 'Choose a JPEG, PNG or WebP picture.' });
      const file = `recipe-${id}-${crypto.randomBytes(4).toString('hex')}.${extFor(req.file.mimetype)}`;
      try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); fs.writeFileSync(path.join(UPLOAD_DIR, file), req.file.buffer); }
      catch { return res.status(500).json({ error: 'The picture could not be saved.' }); }
      db.prepare(`UPDATE recipes SET photo = ?, updated_at = datetime('now') WHERE id = ?`).run(file, id);
      removePhotoFile(r.photo);
      broadcastUpdate('recipes');
      res.json(fullOut(recipeRow(id)));
    });
  });

  app.delete('/api/recipes/:id/photo', (req, res) => {
    const id = Number(req.params.id);
    const r = recipeRow(id);
    if (!r) return res.status(404).json({ error: 'That recipe no longer exists.' });
    db.prepare(`UPDATE recipes SET photo = '', updated_at = datetime('now') WHERE id = ?`).run(id);
    removePhotoFile(r.photo);
    broadcastUpdate('recipes');
    res.json(fullOut(recipeRow(id)));
  });
  // A recipe by what a person says aloud ("lasagna", "the chicken parmesan recipe"): the best match on the title, the shorter title winning a tie. null when none match.
  function findRecipeByName(spoken) {
    const norm = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const q = norm(spoken).replace(/^(the|my|our|a)\s+/, '').replace(/\s+(please|recipe)$/, '').replace(/\s+(please|recipe)$/, '').trim();
    if (!q) return null;
    const words = q.split(' ');
    let best = null;
    for (const r of db.prepare(`SELECT id, title FROM recipes`).all()) {
      const t = norm(r.title), tw = t.split(' ');
      let score = 0;
      if (t === q) score = 100; else if (t.startsWith(q)) score = 80; else if (t.includes(q)) score = 60;
      else if (words.every((w) => tw.some((x) => x === w || x === w + 's' || x + 's' === w))) score = 40;
      if (score && (!best || score > best.score || (score === best.score && t.length < best.len))) best = { id: r.id, score, len: t.length };
    }
    return best ? recipeRow(best.id) : null;
  }

  // For the community library module: make a recipe from the same fields the editor sends, and set a picture from the bytes of an image.
  function createRecipe(b) {
    if (!oneLine((b || {}).title, 120)) return null;
    if (db.prepare(`SELECT COUNT(*) AS n FROM recipes`).get().n >= MAX_RECIPES) return null;
    allowSharedOrigin = true;
    let id;
    try { id = save(0, b, true); } finally { allowSharedOrigin = false; }
    broadcastUpdate('recipes');
    return id;
  }
  function attachPhoto(id, buffer) {
    const r = recipeRow(id); const kind = imageKind(buffer);
    if (!r || !kind) return false;
    const file = `recipe-${id}-${crypto.randomBytes(4).toString('hex')}.${extFor(kind)}`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buffer);
    db.prepare(`UPDATE recipes SET photo = ?, updated_at = datetime('now') WHERE id = ?`).run(file, id);
    removePhotoFile(r.photo);
    broadcastUpdate('recipes');
    return true;
  }
  return { addToShopping, findRecipeByName, recipeRow, fullOut, createRecipe, attachPhoto };
};
