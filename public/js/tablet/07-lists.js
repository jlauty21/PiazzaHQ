// The /tablet web app, part 7: what a Piazza HQ tile does when it is touched. The shell every sheet uses, ticking an item off right on a tile, and the three list sheets: the shopping list,
// a to-do list, and the chores. (08-sheets.js has the calendar, the meal plan with its recipes, the message board, the weather and the screens.) Ticking things off is open to everyone at the
// tablet, like it is in the app; a tile can still be marked "Needs the PIN" in its options.
'use strict';

// ── the shell ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A big sheet with a title and a close button. `topics` are the live-update topics (see tbLive) that make it reload itself; `refresh` reloads it.
function tbCardSheet(title, topics, refresh) {
  const box = document.createElement('div');
  box.className = 'tb-overlay';
  box.innerHTML = `<div class="tb-sheet wide tb-cs" role="dialog" aria-label="${tbEsc(title)}"><div class="tb-cs-head"><h2>${tbEsc(title)}</h2><button type="button" class="tb-btn tb-small" data-cs-close aria-label="Close">✕</button></div><div class="tb-cs-body"></div></div>`;
  tbEl('tb-overlays').appendChild(box);
  const sheet = { box, body: box.querySelector('.tb-cs-body'), topics: topics || [], refresh: refresh || (() => {}), alive: () => box.isConnected, close() { if (TB.openSheet === sheet) TB.openSheet = null; box.remove(); } };
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-cs-close]')) sheet.close(); });
  TB.openSheet = sheet;
  return sheet;
}
// One call to the server for a sheet: null (and a message) when it did not work.
async function tbDo(path, method, body) {
  if (tbPreviewBlock()) return null;
  const r = await tbApi(path, { method: method || 'GET', body: body === undefined ? undefined : JSON.stringify(body) });
  if (!tbOk(r)) { tbToast((r && r.__networkError) ? 'The home hub is not reachable.' : (r && r.error) || 'That did not work.'); return null; }
  return r;
}
// The PIN pad for a tile marked "Needs the PIN". Asked only when this tablet is signed in with a PIN (a household without one has nothing to ask). True when it may go on.
async function tbAskPin(title) {
  if (!tbStore(TB_TOKEN_KEY)) return true;
  for (;;) {
    const pin = await tbPinPad(title, 'Enter the household PIN to continue');
    if (pin === null) return false;
    let res; try { res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) }); } catch { tbToast('Could not reach the home hub.'); return false; }
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok !== false) return true;
    tbToast(j.error || 'That PIN is not right.');
  }
}
const tbLocale = () => (window.i18n && i18n.lang) || undefined;
const tbAfterChange = () => setTimeout(() => { tbRefreshCards().then(() => tbRedraw()); }, 300);

// ── ticking an item off right on a tile ───────────────────────────────────────────────────────────────────────────────────
async function tbCheck(key) {
  const [kind, id] = String(key).split(':');
  let r = null, undo = () => {};
  if (tbPreviewBlock()) return;
  if (kind === 'shop') { const it = (TB.cards.shop || []).find((i) => String(i.id) === id); if (it) { it.done = 1; undo = () => { it.done = 0; }; } r = await tbApi('/api/shopping-items/' + id, { method: 'PUT', body: JSON.stringify({ done: true }) }); }
  else if (kind === 'todo') { for (const list of Object.values(TB.cards.todoItems || {})) { const it = list.find((i) => String(i.id) === id); if (it) { it.done = 1; undo = () => { it.done = 0; }; } } r = await tbApi('/api/todo-items/' + id, { method: 'PUT', body: JSON.stringify({ done: true }) }); }
  else if (kind === 'chore') { for (const k of TB.cards.choresRaw || []) { const c = (k.chores || []).find((x) => String(x.instance_id) === id); if (c) { c.done = 1; undo = () => { c.done = 0; }; } } r = await tbApi('/api/chore-instances/' + id + '/toggle', { method: 'POST', body: JSON.stringify({ done: true }) }); }
  else return;
  tbFeedback('tap');
  tbLastGrid = ''; tbRedraw();
  if (!tbOk(r)) { undo(); tbToast((r && r.error) || 'That did not work.'); tbLastGrid = ''; tbRedraw(); return; }
  tbAfterChange();
}

// ── a list: shopping or to-do ─────────────────────────────────────────────────────────────────────────────────────────────
// spec: { title, topic, placeholder, fixed (a list id, or 0 to offer them all), lists(), items(listId), add(listId, text), toggle(item, done), remove(item), clear?(listId) }
async function tbListSheet(spec) {   // spec.focus: open with the keyboard ready (the "Add to..." tiles)
  const st = { lists: [], cur: spec.fixed || 0, items: [] };
  const sh = tbCardSheet(spec.title, [spec.topic], () => load(true));
  sh.body.innerHTML = `<div class="tb-segs" data-tabs></div>
    <form class="tb-addrow" data-add><input class="tb-input" data-new maxlength="120" autocomplete="off" placeholder="${tbEsc(spec.placeholder)}" aria-label="${tbEsc(spec.placeholder)}"><button type="submit" class="tb-btn primary">Add</button></form>
    <ul class="tb-itemlist" data-open></ul><div class="tb-subhead" data-donehead></div><ul class="tb-itemlist done" data-done></ul><div class="tb-row" data-foot></div>`;
  const $ = (s) => sh.body.querySelector(s);
  const row = (i) => `<li data-id="${tbEsc(i.id)}"><button type="button" class="tb-rowchk" role="checkbox" aria-checked="${!!i.done}"><span class="tb-box${i.done ? ' on' : ''}"></span><span class="tb-rowtext">${tbEsc(i.text)}</span></button><button type="button" class="tb-x" data-del aria-label="Remove">✕</button></li>`;
  function draw() {
    const showTabs = !spec.fixed && st.lists.length > 1;
    $('[data-tabs]').innerHTML = showTabs ? st.lists.map((l) => `<button type="button" class="tb-seg${l.id === st.cur ? ' on' : ''}" data-tab="${tbEsc(l.id)}">${tbEsc(l.name)}</button>`).join('') : '';
    const open = st.items.filter((i) => !i.done), done = st.items.filter((i) => i.done);
    $('[data-open]').innerHTML = open.length ? open.map(row).join('') : `<li class="tb-empty">${done.length ? 'Everything is ticked off.' : 'Nothing here yet.'}</li>`;
    $('[data-donehead]').innerHTML = done.length ? '<span>Done</span>' : '';
    $('[data-done]').innerHTML = done.map(row).join('');
    $('[data-foot]').innerHTML = done.length && spec.clear ? '<button type="button" class="tb-btn" data-clear>Clear done</button>' : '';
  }
  async function load(keepDraft) {
    st.lists = await spec.lists();
    if (!st.cur || !st.lists.some((l) => l.id === st.cur)) st.cur = st.lists[0] ? st.lists[0].id : 0;
    st.items = st.cur ? await spec.items(st.cur) : [];
    if (!sh.alive()) return;
    draw();
    if (!keepDraft) { const inp = $('[data-new]'); if (inp && (spec.focus || !('ontouchstart' in window))) inp.focus(); }
  }
  sh.body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('[data-new]'), text = inp.value.trim(); if (!text || !st.cur) return;
    inp.value = '';
    const r = await spec.add(st.cur, text);
    if (!r) { inp.value = text; return; }
    st.items = await spec.items(st.cur); draw(); inp.focus(); tbAfterChange();
  });
  sh.body.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { st.cur = Number(tab.dataset.tab) || tab.dataset.tab; st.items = await spec.items(st.cur); draw(); return; }
    const li = e.target.closest('li[data-id]');
    if (li && e.target.closest('[data-del]')) { const it = st.items.find((i) => String(i.id) === li.dataset.id); if (!it) return; st.items = st.items.filter((i) => i !== it); draw(); if (!(await spec.remove(it))) await load(true); tbAfterChange(); return; }
    if (li && e.target.closest('.tb-rowchk')) {
      const it = st.items.find((i) => String(i.id) === li.dataset.id); if (!it) return;
      it.done = it.done ? 0 : 1; draw(); tbFeedback('tap');
      if (!(await spec.toggle(it, !!it.done))) { it.done = it.done ? 0 : 1; draw(); }
      tbAfterChange(); return;
    }
    if (e.target.closest('[data-clear]')) { if (await spec.clear(st.cur)) { st.items = st.items.filter((i) => !i.done); draw(); tbAfterChange(); } }
  });
  await load(false);
}
const tbShoppingSheet = (tile, o) => tbListSheet({
  focus: !!(o && o.focus),
  title: (o && o.title) || tile.label || ((TB.cards.shopLists || []).find((l) => l.id === Number(tbCfg(tile).list)) || {}).name || 'Shopping list', topic: 'shopping', placeholder: 'Add an item…', fixed: Number(tbCfg(tile).list) || 0,
  lists: async () => tbList(await tbApi('/api/shopping-lists')),
  items: async (id) => tbList(await tbApi('/api/shopping-list?list=' + id)),
  add: (id, text) => tbDo('/api/shopping-list', 'POST', { text, list_id: id }),
  toggle: (it, done) => tbDo('/api/shopping-items/' + it.id, 'PUT', { done }),
  remove: (it) => tbDo('/api/shopping-items/' + it.id, 'DELETE'),
  clear: (id) => tbDo('/api/shopping-list/clear-done', 'POST', { list_id: id }),
});
const tbTodoSheet = (tile, o) => tbListSheet({
  focus: !!(o && o.focus),
  title: (o && o.title) || tile.label || ((TB.cards.todoLists || []).find((l) => l.id === Number(tbCfg(tile).list)) || {}).name || 'To-do', topic: 'todos', placeholder: 'Add a to-do…', fixed: Number(tbCfg(tile).list) || 0,
  lists: async () => tbList(await tbApi('/api/todo-lists')),
  items: async (id) => tbList(await tbApi('/api/todo-lists/' + id + '/items')),
  add: (id, text) => tbDo('/api/todo-lists/' + id + '/items', 'POST', { text }),
  toggle: (it, done) => tbDo('/api/todo-items/' + it.id, 'PUT', { done }),
  remove: (it) => tbDo('/api/todo-items/' + it.id, 'DELETE'),
});

// ── chores ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function tbChoresSheet(tile) {
  const cfg = tbCfg(tile); let data = null;
  const sh = tbCardSheet(tile.label || 'Chores', ['chores'], load);
  function draw() {
    const kids = (data.kids || []).filter((k) => !cfg.kid || String(k.id) === String(cfg.kid));
    sh.body.innerHTML = kids.length ? kids.map((k) => {
      const list = k.chores || [], done = list.filter((c) => c.done).length, pct = list.length ? Math.round(done / list.length * 100) : 0;
      return `<section class="tb-kid" style="--kc:${tbEsc(tbColor(k.color) || k.color || 'var(--accent)')}"><div class="tb-kidhead"><span class="tb-av" aria-hidden="true">${tbEsc(k.avatar || (k.name || '?').slice(0, 1))}</span><b>${tbEsc(k.name)}</b><span class="tb-kidn">${done} <span>of</span> ${list.length} <span>done</span></span>${k.streak ? `<span class="tb-streak">🔥 ${k.streak}</span>` : ''}</div>
        <div class="tb-prog"><i style="width:${pct}%"></i></div>
        <ul class="tb-itemlist">${list.length ? list.map((c) => `<li data-inst="${tbEsc(c.instance_id)}"><button type="button" class="tb-rowchk" role="checkbox" aria-checked="${!!c.done}"><span class="tb-box${c.done ? ' on' : ''}"></span><span class="tb-rowtext">${c.icon ? tbEsc(c.icon) + ' ' : ''}${tbEsc(c.title)}${c.at_time ? ` <small>${tbEsc(tbHm(c.at_time))}</small>` : ''}${c.overdue ? ' <small class="tb-late">overdue</small>' : ''}${c.photo_required && !c.done && !c.proof_photo ? ' <small>📷</small>' : ''}</span></button></li>`).join('') : '<li class="tb-empty">No chores today.</li>'}</ul></section>`;
    }).join('') : '<p class="tb-empty">No chores to show.</p>';
  }
  async function load() {
    const r = await tbApi('/api/chore-chart');
    if (!sh.alive()) return;
    if (tbOk(r) && Array.isArray(r.kids)) { data = r; draw(); } else sh.body.innerHTML = '<p class="tb-empty">Could not load the chores.</p>';
  }
  sh.body.addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-inst]'); if (!li || !e.target.closest('.tb-rowchk') || !data) return;
    let chore = null; for (const k of data.kids) for (const c of k.chores || []) if (String(c.instance_id) === li.dataset.inst) chore = c;
    if (!chore) return;
    const was = chore.done; chore.done = was ? 0 : 1; draw(); tbFeedback('tap');
    const r = await tbDo('/api/chore-instances/' + chore.instance_id + '/toggle', 'POST', { done: !was });
    if (!r) { chore.done = was; draw(); return; }
    tbAfterChange();
  });
  await load();
}
