'use strict';
// Built-in To-Do lists: named lists with items, a done state and an order. A list can be LOCAL (the default) or LINKED to a Todoist project or a Google Tasks list.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged for local lists: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/todo-lists.test.js and test/api/todo-linked.test.js.
//
// LINKED lists keep a local mirror: the rows in todo_items are copies of the open tasks of the remote list (each remembers its remote id), so every screen that already
// reads /api/todo-lists/:id/items - the control app, the Family Hub page, the To-Do widget on the display, voice add - works unchanged and keeps showing the last known
// list if the service cannot be reached. Reading refreshes the mirror (at most every few seconds); adding, completing, renaming and deleting go to the service FIRST
// and the local row follows only if that worked, so the two never disagree about what the person did. A background sweep refreshes linked lists once a minute so a
// change made in the Todoist or Google app reaches the display without anyone opening the list. An item added while the service was unreachable (or by voice) is
// local with no remote id and is pushed on the next refresh. Deleting a linked LIST only removes the link and the local copy - the Todoist / Google list is not touched.
module.exports = function registerTodoLists({ app, db, demoCleanText, broadcastUpdate, linkedProviders }) {
  const P = linkedProviders || {};
  const SWEEP_MS = Number(process.env.PIAZZA_LINKED_SWEEP_MS) || 60000;
  const FRESH_MS = Number(process.env.PIAZZA_LINKED_FRESH_MS) || 15000;
  const JUST_DONE_MS = 20000;                 // a task completed here this recently is not flipped back by a refresh that was already in flight
  const KEEP_DONE_MS = 24 * 3600 * 1000;      // completed rows stay visible (struck through) for a day, like on a local list
  const enc = encodeURIComponent;
  const errMsg = (e) => String((e && e.message) || 'Could not reach the service.');

  // One small adapter per service, all with the same shape. Ids are whatever the service uses (a Todoist task id; Google's g:<list>~<task>).
  function adapter(source) {
    if (source === 'todoist') {
      const td = P.todoist; if (!td) return null;
      const token = () => td.getToken();
      return {
        label: 'Todoist',
        connected: () => !!token(),
        async open(remoteId) {
          const tasks = await td.todoistGet(token(), '/api/v1/tasks?limit=200&project_id=' + enc(remoteId));
          return tasks.filter((t) => t && t.id && String(t.content || '').trim()).map((t) => ({ id: String(t.id), text: String(t.content).trim() }));
        },
        async add(remoteId, text) {
          const t = await td.todoistSend(token(), 'POST', '/api/v1/tasks', { content: text, project_id: remoteId });
          if (!t || !t.id) throw new Error('Todoist did not return the new task.');
          return String(t.id);
        },
        setDone: (id, done) => td.todoistSend(token(), 'POST', '/api/v1/tasks/' + enc(id) + (done ? '/close' : '/reopen')),
        rename: (id, text) => td.todoistSend(token(), 'POST', '/api/v1/tasks/' + enc(id), { content: text }),
        remove: (id) => td.todoistSend(token(), 'DELETE', '/api/v1/tasks/' + enc(id)),
      };
    }
    if (source === 'google') {
      const g = P.gtasks; if (!g) return null;
      return {
        label: 'Google Tasks',
        connected: () => g.connected(),
        async open(remoteId) { return (await g.tasks(remoteId)).map((t) => ({ id: t.id, text: t.content })); },
        add: (remoteId, text) => g.create(remoteId, text),
        setDone: (id, done) => (done ? g.complete(id) : g.reopen(id)),
        rename: (id, text) => g.rename(id, text),
        remove: (id) => g.remove(id),
      };
    }
    return null;
  }
  const notConnected = (a, source) => ({ error: (a ? a.label : (source === 'google' ? 'Google Tasks' : 'Todoist')) + " isn't connected - connect it in Settings > Data Sources." });

  const getList = (id) => db.prepare(`SELECT * FROM todo_lists WHERE id = ?`).get(id);
  const lastRefresh = new Map();   // list id -> when it was last asked
  const inflight = new Map();      // list id -> the refresh running now
  const problems = new Map();      // list id -> why the last refresh failed

  async function pushPending(list, a) {
    const rows = db.prepare(`SELECT * FROM todo_items WHERE list_id = ? AND remote_id = '' AND done = 0 ORDER BY sort_order, id`).all(list.id);
    for (const it of rows) {
      const rid = await a.add(list.remote_id, it.text);
      db.prepare(`UPDATE todo_items SET remote_id = ? WHERE id = ?`).run(rid, it.id);
    }
  }

  // Make the local rows match the remote open tasks. Returns how many rows changed.
  function applyRemote(list, open) {
    const rows = db.prepare(`SELECT * FROM todo_items WHERE list_id = ?`).all(list.id);
    const byRemote = new Map(rows.filter((r) => r.remote_id).map((r) => [r.remote_id, r]));
    const seen = new Set();
    let changed = 0, order = 0;
    const now = Date.now();
    db.transaction(() => {
      for (const t of open) {
        seen.add(t.id); order++;
        const ex = byRemote.get(t.id);
        if (!ex) { db.prepare(`INSERT INTO todo_items (list_id, text, sort_order, remote_id) VALUES (?, ?, ?, ?)`).run(list.id, t.text, order, t.id); changed++; continue; }
        const justDone = ex.done && ex.completed_at && now - Date.parse(ex.completed_at) < JUST_DONE_MS;
        if (justDone) continue;
        if (ex.text !== t.text || ex.done || ex.sort_order !== order) {
          db.prepare(`UPDATE todo_items SET text = ?, done = 0, completed_at = '', sort_order = ? WHERE id = ?`).run(t.text, order, ex.id);
          if (ex.text !== t.text || ex.done) changed++;
        }
      }
      for (const r of rows) {
        if (r.remote_id && seen.has(r.remote_id)) continue;
        if (!r.remote_id && !r.done) continue;                                       // waiting to be pushed
        if (r.done && r.completed_at && now - Date.parse(r.completed_at) < KEEP_DONE_MS) continue;   // finished lately: stays, struck through
        db.prepare(`DELETE FROM todo_items WHERE id = ?`).run(r.id); changed++;
      }
    })();
    return changed;
  }

  // Never rejects: false means the mirror was left as it was (not linked / not connected / the service said no).
  function refresh(list, force) {
    const a = adapter(list.source);
    if (!a || !a.connected()) return Promise.resolve(false);
    if (inflight.has(list.id)) return inflight.get(list.id);
    if (!force && Date.now() - (lastRefresh.get(list.id) || 0) < FRESH_MS) return Promise.resolve(true);
    const p = (async () => {
      try {
        await pushPending(list, a);
        const open = await a.open(list.remote_id);
        const changed = applyRemote(getList(list.id) || list, open);
        problems.delete(list.id);
        if (changed) broadcastUpdate('todos');
        return true;
      } catch (e) { problems.set(list.id, errMsg(e)); return false; }
      finally { lastRefresh.set(list.id, Date.now()); inflight.delete(list.id); }
    })();
    inflight.set(list.id, p);
    return p;
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(false), ms))]);

  const sweep = setInterval(() => {
    for (const l of db.prepare(`SELECT * FROM todo_lists WHERE source != ''`).all()) refresh(l, true);
  }, SWEEP_MS);
  if (sweep.unref) sweep.unref();

  // Deliberately separate from the Todoist-backed Tasks widget - see the schema comment above todo_lists for why.
  app.get('/api/todo-lists', (req, res) => {
    const lists = db.prepare(`
    SELECT tl.*,
      (SELECT COUNT(*) FROM todo_items ti WHERE ti.list_id = tl.id AND ti.done = 0) as itemCount
    FROM todo_lists tl ORDER BY tl.sort_order, tl.id
  `).all();
    for (const l of lists) if (l.source) { l.problem = problems.get(l.id) || ''; refresh(l, false); }   // the answer is the mirror as it is now; a fresher one follows
    res.json(lists);
  });
  app.post('/api/todo-lists', async (req, res) => {
    const name = demoCleanText((req.body.name || '').trim(), 60);
    if (!name) return res.status(400).json({ error: 'A list name is required.' });
    const source = String(req.body.source || '');
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM todo_lists`).get();
    if (!source) {
      const info = db.prepare(`INSERT INTO todo_lists (name, sort_order) VALUES (?, ?)`)
        .run(name, (maxOrder.m || 0) + 1);
      broadcastUpdate('todos');
      return res.json({ id: info.lastInsertRowid, name, sort_order: (maxOrder.m || 0) + 1 });
    }
    // Link to a Todoist project / Google Tasks list: it must be connected, the list must answer, and the same one cannot be linked twice.
    const a = adapter(source);
    if (!a) return res.status(400).json({ error: 'Unknown list source.' });
    if (!a.connected()) return res.status(400).json(notConnected(a, source));
    const remoteId = String(req.body.remote_id || '').trim().slice(0, 300);
    if (!remoteId || (source === 'google' && !P.gtasks.isGoogleId(remoteId))) return res.status(400).json({ error: 'Choose the list to link.' });
    if (db.prepare(`SELECT id FROM todo_lists WHERE source = ? AND remote_id = ?`).get(source, remoteId)) return res.status(409).json({ error: 'That list is already linked.' });
    let open;
    try { open = await a.open(remoteId); } catch (e) { return res.status(502).json({ error: errMsg(e) }); }
    if (db.prepare(`SELECT id FROM todo_lists WHERE source = ? AND remote_id = ?`).get(source, remoteId)) return res.status(409).json({ error: 'That list is already linked.' });
    const info = db.prepare(`INSERT INTO todo_lists (name, sort_order, source, remote_id) VALUES (?, ?, ?, ?)`).run(name, (maxOrder.m || 0) + 1, source, remoteId);
    applyRemote(getList(info.lastInsertRowid), open);
    lastRefresh.set(Number(info.lastInsertRowid), Date.now());
    broadcastUpdate('todos');
    res.json({ id: info.lastInsertRowid, name, sort_order: (maxOrder.m || 0) + 1, source, remote_id: remoteId, itemCount: open.length });
  });
  app.put('/api/todo-lists/:id', (req, res) => {
    const list = db.prepare(`SELECT id FROM todo_lists WHERE id = ?`).get(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found.' });
    if (req.body.name !== undefined) {
      const name = demoCleanText(String(req.body.name).trim(), 60);
      if (!name) return res.status(400).json({ error: 'A list name is required.' });
      db.prepare(`UPDATE todo_lists SET name = ? WHERE id = ?`).run(name, req.params.id);
    }
    if (req.body.sort_order !== undefined) {
      db.prepare(`UPDATE todo_lists SET sort_order = ? WHERE id = ?`).run(Number(req.body.sort_order) || 0, req.params.id);
    }
    broadcastUpdate('todos');
    res.json({ ok: true });
  });
  app.delete('/api/todo-lists/:id', (req, res) => {
    db.prepare(`DELETE FROM todo_items WHERE list_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM todo_lists WHERE id = ?`).run(req.params.id);
    lastRefresh.delete(Number(req.params.id)); problems.delete(Number(req.params.id));   // a linked list: only the link and the local copy go
    broadcastUpdate('todos');
    res.json({ ok: true });
  });

  app.get('/api/todo-lists/:id/items', async (req, res) => {
    const list = getList(req.params.id);
    if (list && list.source) await withTimeout(refresh(list, false), 8000);
    const items = db.prepare(`SELECT * FROM todo_items WHERE list_id = ? ORDER BY done, sort_order, id`).all(req.params.id);
    res.json(items);
  });
  app.post('/api/todo-lists/:id/items', async (req, res) => {
    const text = demoCleanText((req.body.text || '').trim(), 120);
    if (!text) return res.status(400).json({ error: 'Item text is required.' });
    const list = getList(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found.' });
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM todo_items WHERE list_id = ?`).get(req.params.id);
    let remoteId = '';
    if (list.source) {
      const a = adapter(list.source);
      if (!a || !a.connected()) return res.status(400).json(notConnected(a, list.source));
      try { remoteId = await a.add(list.remote_id, text); } catch (e) { return res.status(502).json({ error: errMsg(e) }); }
      // a refresh that ran while we waited may already have picked the new task up: use that row instead of adding a second one
      const seen = db.prepare(`SELECT id FROM todo_items WHERE list_id = ? AND remote_id = ?`).get(list.id, remoteId);
      if (seen) { broadcastUpdate('todos'); return res.json({ id: seen.id, list_id: Number(req.params.id), text, done: 0 }); }
    }
    const info = db.prepare(`INSERT INTO todo_items (list_id, text, sort_order, remote_id) VALUES (?, ?, ?, ?)`)
      .run(req.params.id, text, (maxOrder.m || 0) + 1, remoteId);
    broadcastUpdate('todos');
    res.json({ id: info.lastInsertRowid, list_id: Number(req.params.id), text, done: 0 });
  });
  app.put('/api/todo-items/:id', async (req, res) => {
    const item = db.prepare(`SELECT * FROM todo_items WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    let newText;
    if (req.body.text !== undefined) {
      newText = demoCleanText(String(req.body.text).trim(), 120);
      if (!newText) return res.status(400).json({ error: 'Item text is required.' });
    }
    const list = item.remote_id ? getList(item.list_id) : null;
    if (list && list.source) {   // linked: the service goes first; the local row only changes if it agreed
      const a = adapter(list.source);
      if (!a || !a.connected()) return res.status(400).json(notConnected(a, list.source));
      try {
        if (req.body.done !== undefined && !!req.body.done !== !!item.done) await a.setDone(item.remote_id, !!req.body.done);
        if (newText !== undefined && newText !== item.text) await a.rename(item.remote_id, newText);
      } catch (e) { return res.status(502).json({ error: errMsg(e) }); }
    }
    if (newText !== undefined) db.prepare(`UPDATE todo_items SET text = ? WHERE id = ?`).run(newText, req.params.id);
    if (req.body.done !== undefined) {
      const done = req.body.done ? 1 : 0;
      const completedAt = done ? new Date().toISOString() : '';
      db.prepare(`UPDATE todo_items SET done = ?, completed_at = ? WHERE id = ?`).run(done, completedAt, req.params.id);
    }
    if (req.body.sort_order !== undefined) {
      db.prepare(`UPDATE todo_items SET sort_order = ? WHERE id = ?`).run(Number(req.body.sort_order) || 0, req.params.id);
    }
    broadcastUpdate('todos');
    res.json({ ok: true });
  });
  app.delete('/api/todo-items/:id', async (req, res) => {
    const item = db.prepare(`SELECT * FROM todo_items WHERE id = ?`).get(req.params.id);
    const list = item && item.remote_id ? getList(item.list_id) : null;
    if (list && list.source) {
      const a = adapter(list.source);
      if (!a || !a.connected()) return res.status(400).json(notConnected(a, list.source));
      try { await a.remove(item.remote_id); } catch (e) { return res.status(502).json({ error: errMsg(e) }); }
    }
    db.prepare(`DELETE FROM todo_items WHERE id = ?`).run(req.params.id);
    broadcastUpdate('todos');
    res.json({ ok: true });
  });
};
