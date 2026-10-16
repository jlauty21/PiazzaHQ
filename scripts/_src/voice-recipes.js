'use strict';
// Voice for recipes (Siri Shortcuts): "add the ingredients for lasagna" puts a recipe's ingredients on the shopping list (merged with what is
// already there, like the Add to shopping list button), and "start lasagna on the kitchen screen" cooks it on a named screen (the cook board, see presentations.js).
// The REST routes use the same voice token as /api/voice/add-item, and are as narrow: they can add a recipe's
// ingredients to a shopping list and start a recipe on a screen, nothing else. Covered by test/api/voice-recipes.test.js.
module.exports = function registerVoiceRecipes({ app, db, voiceAuth, recipes, presentations }) {
  const norm = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  // The ingredients of a recipe (named the way a person says it) onto a shopping list: the first one, or the one named. { ok, recipe, list, added, merged, skipped }
  // or { error, status }.
  function addRecipeIngredients(spoken, listName) {
    const r = recipes.findRecipeByName(spoken);
    if (!r) return { error: `I couldn't find a recipe called "${String(spoken || '').trim()}".`, status: 404 };
    const body = {};
    const ln = String(listName || '').trim();
    if (ln && norm(ln) !== 'shopping' && norm(ln) !== 'shopping list') {
      const sl = db.prepare(`SELECT id FROM shopping_lists WHERE LOWER(name) = LOWER(?)`).get(ln);
      if (!sl) return { error: `No shopping list named "${ln}".`, status: 404 };
      body.list_id = sl.id;
    }
    const out = recipes.addToShopping(r.id, body);
    if (out.status !== 200) return { error: out.body.error || 'Could not add them.', status: out.status };
    return { ok: true, recipe: { id: r.id, title: r.title }, list: out.body.list_name, added: out.body.added, merged: out.body.merged, skipped: out.body.skipped };
  }

  // A screen a person can name: it has a name, is not a Live Edit preview, and has been heard from lately.
  function namedScreens() {
    return db.prepare(`SELECT * FROM screens`).all().filter((s) => s.name && !String(s.device_id).startsWith('preview_') && presentations.screenSeenRecently(s));
  }
  function findScreen(spoken, screens) {
    const q = norm(spoken).replace(/\b(the|my|our|screen|display|tv)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!q) return null;
    const names = screens.map((s) => ({ s, n: norm(s.name).replace(/\b(the|screen|display|tv)\b/g, ' ').replace(/\s+/g, ' ').trim() }));
    const hit = names.find((x) => x.n === q) || names.find((x) => x.n.startsWith(q)) || names.find((x) => x.n.includes(q)) || names.find((x) => x.n && q.includes(x.n));
    return hit ? hit.s : null;
  }

  // Cook a recipe on a screen. With no screen named, the only screen that is on is used. { ok, recipe, screen } or { error, status }.
  async function cookRecipe(spoken, screenSpoken) {
    const r = recipes.findRecipeByName(spoken);
    if (!r) return { error: `I couldn't find a recipe called "${String(spoken || '').trim()}".`, status: 404 };
    const screens = namedScreens();
    if (!screens.length) return { error: 'No screens are on right now.', status: 409 };
    let screen;
    if (String(screenSpoken || '').trim()) {
      screen = findScreen(screenSpoken, screens);
      if (!screen) return { error: `I couldn't find a screen called "${String(screenSpoken).trim()}". The screens that are on: ${screens.map((s) => s.name).join(', ')}.`, status: 404 };
    } else if (screens.length === 1) screen = screens[0];
    else return { error: `Which screen? ${screens.map((s) => s.name).join(', ')}.`, status: 400 };
    const out = await presentations.screenAction(screen, { action: 'start', kind: 'recipe', id: r.id });
    if (out.status !== 200) return { error: (out.body && out.body.error) || 'The screen could not be started.', status: out.status };
    return { ok: true, recipe: { id: r.id, title: r.title }, screen: screen.name, delivered: !!(out.body && out.body.delivered) };
  }

  const pick = (req, k) => String(req.query[k] || (req.body && req.body[k]) || '');
  const ingredientsRoute = (req, res) => {
    if (!voiceAuth(req, res)) return;
    const out = addRecipeIngredients(pick(req, 'recipe'), pick(req, 'list'));
    if (out.error) return res.status(out.status || 500).json({ error: out.error });
    res.status(201).json(out);
  };
  const cookRoute = async (req, res) => {
    if (!voiceAuth(req, res)) return;
    const out = await cookRecipe(pick(req, 'recipe'), pick(req, 'screen'));
    if (out.error) return res.status(out.status || 500).json({ error: out.error });
    res.json(out);
  };
  app.get('/api/voice/recipe-ingredients', ingredientsRoute);
  app.post('/api/voice/recipe-ingredients', ingredientsRoute);
  app.get('/api/voice/cook', cookRoute);
  app.post('/api/voice/cook', cookRoute);

  return { addRecipeIngredients, cookRecipe };
};
