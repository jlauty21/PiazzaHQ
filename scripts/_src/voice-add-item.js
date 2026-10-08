'use strict';
// Voice add-item (Siri Shortcuts; also used by the Alexa skill): token check, spoken-phrase cleanup, and adding to the shopping or a to-do list.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/voice-add-item.test.js.
module.exports = function registerVoiceAddItem({ crypto, app, db, broadcastUpdate, getSetting, defaultShoppingListId }) {
  // Strips natural command phrasing off the front and back of a spoken/typed
  // voice input, so "add bananas to the shopping list" and "put paper towels
  // on my list" both become just the actual item — "bananas", "paper towels"
  // — rather than being stored verbatim. Answering the Shortcuts prompt with
  // just the item name already worked fine before this and still does (no
  // leading/trailing pattern to strip means the text passes through
  // untouched) — this specifically targets the more natural full-sentence
  // phrasing someone would reasonably expect a voice assistant to handle,
  // since neither Siri Shortcuts' free-text dictation nor Alexa's custom slot
  // values do that kind of extraction on their own.
  // Deliberately simple pattern-matching, not real NLU — won't catch every
  // possible phrasing (rare/unusual wording can still come through
  // unstripped), but covers the common "add/put X to/on (the/my) ___ list"
  // shapes without needing an actual language model for something this small.
  function extractItemFromSpokenPhrase(raw) {
    let text = (raw || '').trim();
    if (!text) return text;
    text = text.replace(/^(please\s+)?(can you\s+)?(add|put|throw|include|get)\s+/i, '');
    text = text.replace(/\s+please\.?$/i, '');
    // The real target list is already decided by the `list` parameter, not by
    // whatever list name was actually spoken — so this doesn't need to match
    // a specific list name, just the general "to/on (the/my/our) ___ list"
    // shape at the end of the sentence. Stripping trailing "please" BEFORE
    // this, not after, matters — "add coffee to the list please" has "please"
    // sitting after "list", which would otherwise stop the list-phrase
    // pattern from anchoring to the actual end of the string.
    text = text.replace(/\s+(to|on|for)\s+(the\s+|my\s+|our\s+)?[\w\s]*?\blist\b\.?\s*$/i, '');
    text = text.trim().replace(/[.!?]+$/, '').trim();
    return text || raw.trim(); // never return empty if stripping happened to over-match
  }

  // Shared by both voice surfaces (Siri Shortcuts' REST endpoint below, and the
  // Alexa skill handler further down) so the actual "where does this item go"
  // logic exists exactly once. Returns { ok, list, id, text } on success, or
  // { error, status } on failure — callers translate that into whatever shape
  // their own protocol needs (plain JSON for Shortcuts, an Alexa speech
  // response for Alexa), rather than this function knowing about either.
  // list defaults to the shopping list; anything else is case-insensitively
  // matched against existing To-Do list names — an unrecognized name is a real
  // error, not a silent fallback to the wrong list.
  function addVoiceItem(text, listName) {
    text = extractItemFromSpokenPhrase(text);
    if (!text) return { error: 'No item text provided.', status: 400 };
    listName = (listName || 'shopping').trim();

    // "shopping" (the default, and what existing Shortcuts send) → the default
    // shopping list. Otherwise a shopping list with that name wins over a to-do
    // list of the same name, so "add milk to the Costco list" lands on a Costco
    // SHOPPING list when there is one.
    let shopListId = null;
    if (listName.toLowerCase() === 'shopping') shopListId = defaultShoppingListId();
    else {
      const sl = db.prepare(`SELECT id FROM shopping_lists WHERE LOWER(name) = LOWER(?)`).get(listName);
      if (sl) shopListId = sl.id;
    }
    if (shopListId !== null) {
      const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM shopping_items WHERE list_id = ?`).get(shopListId);
      const info = db.prepare(`INSERT INTO shopping_items (list_id, text, sort_order) VALUES (?, ?, ?)`)
        .run(shopListId, text, (maxOrder.m || 0) + 1);
      broadcastUpdate('shopping');
      return { ok: true, list: listName.toLowerCase() === 'shopping' ? 'shopping' : listName, id: info.lastInsertRowid, text };
    }
    const list = db.prepare(`SELECT id FROM todo_lists WHERE LOWER(name) = LOWER(?)`).get(listName);
    if (!list) return { error: `No list named "${listName}".`, status: 404 };
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM todo_items WHERE list_id = ?`).get(list.id);
    const info = db.prepare(`INSERT INTO todo_items (list_id, text, sort_order) VALUES (?, ?, ?)`)
      .run(list.id, text, (maxOrder.m || 0) + 1);
    broadcastUpdate('todos');
    return { ok: true, list: listName, id: info.lastInsertRowid, text };
  }

  // GET/POST /api/voice/add-item — the actual Siri Shortcuts target. Deliberately
  // narrow in what it can do (add an item, nothing else — no read, no delete,
  // no settings access) even though it bypasses the PIN entirely, so a leaked
  // token is a "someone can add junk to your shopping list" problem, not a
  // "someone has the run of the app" problem.
  //
  // Accepts credentials/params two ways, checked in this order:
  //   1. Query string (?token=...&text=...&list=...) — the recommended path.
  //      A single URL Shortcuts can build with one field and one inline
  //      variable insertion, instead of separately configuring Headers and a
  //      JSON Request Body in a "Show More" panel, which is where the real
  //      confusion happened in practice (see HANDOFF.md — a header ending up
  //      with the token in the wrong box, and an entire JSON blob crammed
  //      into a single body field, both directly caused by that older,
  //      more "correct" but much more error-prone setup). No request logging
  //      exists on this server (checked before adding this) that would write
  //      a token-bearing URL to a persistent log file.
  //   2. Authorization: Bearer header + JSON body — the original method,
  //      left working for anyone who already built a Shortcut that way, or
  //      who'd rather not have the token sitting in a URL for other reasons.
  // Whichever path supplies a token, it's checked identically via
  // timingSafeEqual against the configured voice_token.
  function voiceAddItemHandler(req, res) {
    const configuredToken = getSetting('voice_token');
    if (!configuredToken) return res.status(403).json({ error: 'Voice control isn\'t set up yet — generate a token in Settings first.' });

    const authHeader = req.headers['authorization'] || '';
    const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const presented = req.query.token || headerToken;
    const presentedBuf = Buffer.from(presented);
    const configuredBuf = Buffer.from(configuredToken);
    const validLength = presentedBuf.length === configuredBuf.length;
    // timingSafeEqual throws on mismatched lengths rather than returning
    // false, so length is checked first — but still compare SOMETHING of the
    // same length as configuredToken even on a length mismatch, rather than
    // short-circuiting straight to "reject," so a wrong-length guess doesn't
    // return measurably faster than a right-length one. (Real discrepancy
    // found auditing this: `validLength && timingSafeEqual(...)` short-circuits
    // via `&&` and never calls timingSafeEqual at all on a length mismatch —
    // exactly the shortcut this comment says it avoids. Negligible practical
    // impact given the token's 192 bits of entropy makes any timing channel
    // irrelevant for brute-forcing, but the code should actually do what its
    // own comment claims.)
    let isValid;
    if (validLength) {
      isValid = crypto.timingSafeEqual(presentedBuf, configuredBuf);
    } else {
      crypto.timingSafeEqual(configuredBuf, configuredBuf); // dummy same-length compare, for constant-ish time
      isValid = false;
    }
    if (!isValid) return res.status(401).json({ error: 'Invalid token' });

    const text = req.query.text || (req.body && req.body.text);
    const list = req.query.list || (req.body && req.body.list);
    const result = addVoiceItem(text, list);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    res.status(201).json(result);
  }
  app.get('/api/voice/add-item', voiceAddItemHandler);
  app.post('/api/voice/add-item', voiceAddItemHandler);
  return { addVoiceItem };
};
