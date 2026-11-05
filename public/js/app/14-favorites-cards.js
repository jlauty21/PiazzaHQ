// ── More Favorites cards ─────────────────────────────────────────────────────
// Twelve cards added to FAVORITE_CARD_DEFS (02-formatting.js): meals (Tonight's Dinner, This Week's Dinners, Cook Tonight), lists you can tick off (To-Do Checklist,
// Shopping Checklist), quick adds (Quick Event, Weekly Reminder, One-tap Messages, Add a Photo), a kid's chores for today (Chore Checklist), and two at-a-glance cards (Screens Needing
// Attention, Update Available). Each card says what it needs by a fetch(card, data) that runs before the tab is drawn (renderFavoritesTab waits for them), and acts through the
// same API the rest of the app uses. A card that is being typed into (FV_EDIT, or any input with focus) is not redrawn by the 15-second refresh.
const FV_EDIT = { key: '' };          // the inline meal editor that is open: "<card id>|<date>|<slot>"

function fvRoot(card) { return document.querySelector(`.fav-card[data-id="${card.id}"]`); }
function fvArr(r) { return Array.isArray(r) ? r : []; }
function fvBad(r) { return !r || r.error || r.__networkError || r.__authFailed || r.__parseError; }
function fvOnce(data, key, load) {         // several cards often want the same lookup: make it once per draw
  data._fv = data._fv || {};
  if (!data._fv[key]) data._fv[key] = Promise.resolve().then(load).catch(() => null);
  return data._fv[key];
}
function fvSend(path, body, method) { return apiFetch(path, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
function fvSaved(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function fvSave(key, v) { try { localStorage.setItem(key, v); } catch { /* private window */ } }
const fvMuted = (t) => `<p style="font-size:12px;color:var(--muted);margin:2px 0 0">${t}</p>`;
const fvTitle = (icon, t) => `<div style="font-weight:600;font-size:12.5px;margin-bottom:6px">${icon} ${t}</div>`;
const fvBtn = 'background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:6px 0 0;text-align:left';
const fvDay = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d); };
function fvDayName(offset) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const d = fvDay(mpIso(offset));
  return `${MP_DOW[d.getDay()]} ${MP_MON[d.getMonth()]} ${d.getDate()}`;
}

// ── meals: the same /api/meals the wall widget and Family Hub use ──────────────────────────────────────────────────
async function fvLoadMeals(card, data) {
  const [meals, settings, recipes] = await Promise.all([
    fvOnce(data, 'meals7', () => apiFetch(`/api/meals?from=${mpIso(0)}&to=${mpIso(6)}`)),
    fvOnce(data, 'settings', () => apiFetch('/api/settings')),
    fvOnce(data, 'recipes', () => apiFetch('/api/recipes')),
  ]);
  data.fvMeals = {};
  fvArr(meals).forEach((m) => { data.fvMeals[m.date + '|' + (m.slot || 'dinner')] = m; });
  data.fvSlots = mpParseSlots(settings && settings.mealplan_slots);
  data.fvRecipes = fvArr(recipes);
}
function fvMealRow(card, data, offset, slot) {
  const date = mpIso(offset), key = `${card.id}|${date}|${slot}`, m = data.fvMeals[date + '|' + slot];
  const label = data.fvSlots.length > 1 ? `<span style="font-size:11px;color:var(--muted);margin-right:6px">${MP_SLOT_NAME[slot]}</span>` : '';
  if (FV_EDIT.key === key) {
    return `<div class="fv-meal-edit-box" data-date="${date}" data-slot="${slot}" style="padding:6px 0">
      <input class="form-input fv-meal-title" maxlength="80" placeholder="What's for ${escapeHtml(MP_SLOT_NAME[slot].toLowerCase())}?" value="${escapeHtml(m ? m.title : '')}" style="width:100%;padding:8px 10px;font-size:14px">
      ${data.fvRecipes.length ? `<select class="form-input fv-meal-recipe" style="width:100%;padding:8px;font-size:13px;margin-top:6px"><option value="">Or pick a saved recipe…</option>${data.fvRecipes.map((r) => `<option value="${r.id}">${escapeHtml(r.title)}</option>`).join('')}</select>` : ''}
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-primary fv-meal-save" style="margin:0;padding:8px;flex:1">Save</button>
        ${m ? `<button class="btn fv-meal-clear" style="margin:0;padding:8px;background:var(--card);border:1px solid var(--border)">Clear</button>` : ''}
        <button class="btn fv-meal-cancel" style="margin:0;padding:8px;background:var(--card);border:1px solid var(--border)">Cancel</button>
      </div></div>`;
  }
  return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
    <div style="flex:1;min-width:0;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}${m ? escapeHtml(m.title) : '<span style="color:var(--muted)">Nothing planned</span>'}</div>
    <button class="icon-btn fv-meal-edit" data-date="${date}" data-slot="${slot}" title="${m ? 'Change' : 'Plan'}" style="width:28px;height:28px;font-size:13px">${m ? '✏️' : '＋'}</button>
  </div>`;
}
function fvWireMeals(card) {
  const root = fvRoot(card);
  if (!root) return;
  const keyOf = (el) => `${card.id}|${el.dataset.date}|${el.dataset.slot}`;
  root.querySelectorAll('.fv-meal-edit').forEach((b) => b.addEventListener('click', () => { FV_EDIT.key = keyOf(b); renderFavoritesTab(); }));
  root.querySelectorAll('.fv-meal-cancel').forEach((b) => b.addEventListener('click', () => { FV_EDIT.key = ''; renderFavoritesTab(); }));
  root.querySelectorAll('.fv-meal-edit-box').forEach((box) => {
    const put = async (body, done) => {
      const r = await fvSend(`/api/meals/${box.dataset.date}/${box.dataset.slot}`, body, 'PUT');
      if (fvBad(r)) { showToast('❌ ' + ((r && r.error) || 'Could not save')); return; }
      FV_EDIT.key = ''; showToast(done); renderFavoritesTab();
    };
    const save = () => {
      const title = box.querySelector('.fv-meal-title').value.trim();
      const rec = box.querySelector('.fv-meal-recipe');
      const body = { title };
      if (rec && rec.value) body.recipe_id = Number(rec.value);
      if (!title && !(rec && rec.value)) { showToast('Type what is planned first'); return; }
      put(body, 'Saved ✓');
    };
    box.querySelector('.fv-meal-save').addEventListener('click', save);
    box.querySelector('.fv-meal-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const clr = box.querySelector('.fv-meal-clear');
    if (clr) clr.addEventListener('click', () => put({ title: '' }, 'Cleared ✓'));
    box.querySelector('.fv-meal-title').focus();
  });
}

// ── ticking things off: one list at a time, picked on the card and remembered on this phone ───────────────────────────
function fvListSelect(card, lists, cls) {
  if (lists.length < 2) return '';
  const sel = fvSelectedList(card, lists);
  return `<select class="form-input ${cls}" style="width:auto;max-width:55%;padding:5px 8px;font-size:12px;margin:0 0 6px">${lists.map((l) => `<option value="${l.id}" ${String(l.id) === String(sel) ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}</select>`;
}
function fvSelectedList(card, lists) {
  const want = fvSaved('fv_list_' + card.id);
  const hit = lists.find((l) => String(l.id) === want);
  return String((hit || lists[0] || {}).id || '');
}
function fvChecklistHtml(items, chkCls, more) {
  const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);
  const row = (i) => `<label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;${i.done ? 'opacity:.55;text-decoration:line-through' : ''}"><input type="checkbox" class="${chkCls}" data-id="${i.id}" ${i.done ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0"><span style="font-size:14px;min-width:0;overflow-wrap:anywhere">${escapeHtml(i.text)}</span></label>`;
  return (open.length ? open.slice(0, 15).map(row).join('') : fvMuted('Nothing left. ✓'))
    + (open.length > 15 ? fvMuted(`+${open.length - 15} more`) : '')
    + (done.length ? `<div style="border-top:1px solid var(--border);margin-top:4px">${done.slice(0, 3).map(row).join('')}</div>` : '')
    + (more || '');
}
function fvWireAdd(root, inputCls, btnCls, add) {
  const input = root.querySelector('.' + inputCls), btn = root.querySelector('.' + btnCls);
  if (!input || !btn) return;
  const go = async () => { const text = input.value.trim(); if (!text) return; btn.disabled = true; const ok = await add(text); btn.disabled = false; if (ok) input.value = ''; };
  btn.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

Object.assign(FAVORITE_CARD_DEFS, {
  tonight_dinner: {
    label: "Tonight's Dinner", icon: '🍽️', category: 'Meals', needs: [],
    fetch: (card, data) => fvLoadMeals(card, data),
    render(card, data) {
      return fvTitle('🍽️', data.fvSlots.length > 1 ? "Today's Meals" : "Tonight's Dinner")
        + data.fvSlots.map((s) => fvMealRow(card, data, 0, s)).join('')
        + `<button class="fav-card-link" data-target-tab="family" data-subtab="meals" style="${fvBtn}">Meal plan ›</button>`;
    },
    wire(card) { fvWireMeals(card); },
  },
  week_dinners: {
    label: "This Week's Dinners", icon: '📆', category: 'Meals', needs: [],
    fetch: (card, data) => fvLoadMeals(card, data),
    render(card, data) {
      const days = [0, 1, 2, 3, 4, 5, 6].map((i) => `<div style="padding:5px 0;${i ? 'border-top:1px solid var(--border)' : ''}">
        <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${i ? 'var(--muted)' : 'var(--accent)'}">${escapeHtml(fvDayName(i))}</div>
        ${data.fvSlots.map((s) => fvMealRow(card, data, i, s)).join('')}</div>`).join('');
      return fvTitle('📆', "This Week's Dinners") + days + `<button class="fav-card-link" data-target-tab="family" data-subtab="meals" style="${fvBtn}">Meal plan ›</button>`;
    },
    wire(card) { fvWireMeals(card); },
  },
  cook_tonight: {
    label: 'Cook Tonight', icon: '👩‍🍳', category: 'Meals', needs: ['screens'], configField: 'screen',
    fetch: (card, data) => fvLoadMeals(card, data),
    render(card, data) {
      const scr = (data.screens || []).find((x) => x.device_id === card.config.device_id);
      if (!scr) return `<p style="font-size:12px;color:var(--muted);margin:0">That screen no longer exists. Remove this card.</p>`;
      const m = data.fvMeals[mpIso(0) + '|dinner'];
      if (!m) return fvTitle('👩‍🍳', 'Cook Tonight') + fvMuted('Nothing is planned for tonight yet. Plan it on the Tonight\'s Dinner card.');
      if (!m.recipe_id) return fvTitle('👩‍🍳', escapeHtml(m.title)) + fvMuted('This meal has no recipe linked. Change it and pick a saved recipe to cook from it here.');
      return fvTitle('👩‍🍳', escapeHtml(m.recipe_title || m.title)) + `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary fv-cook-show" style="margin:0;padding:9px 12px;width:auto">Show on ${escapeHtml(scr.name || 'screen')}</button>
          <button class="btn fv-cook-shop" style="margin:0;padding:9px 12px;width:auto;background:var(--card);border:1px solid var(--border)">Add ingredients to shopping</button>
        </div>`;
    },
    wire(card, data) {
      const root = fvRoot(card);
      if (!root) return;
      const m = data.fvMeals[mpIso(0) + '|dinner'];
      const show = root.querySelector('.fv-cook-show'), shop = root.querySelector('.fv-cook-shop');
      if (show) show.addEventListener('click', async () => {
        show.disabled = true;
        const r = await fvSend(`/api/screens/${encodeURIComponent(card.config.device_id)}/presentation`, { action: 'start', kind: 'recipe', id: Number(m.recipe_id) });
        show.disabled = false;
        showToast(fvBad(r) ? '❌ Could not start it on that screen' : (r.delivered ? 'On the screen ✓' : 'Saved. The screen starts when it next connects.'));
      });
      if (shop) shop.addEventListener('click', async () => {
        shop.disabled = true;
        const r = await fvSend(`/api/recipes/${Number(m.recipe_id)}/shopping`, {});
        shop.disabled = false;
        showToast(fvBad(r) ? '❌ ' + ((r && r.error) || 'Could not add') : `Added ${r.added || 0}${r.merged ? `, merged ${r.merged}` : ''} to ${r.list_name || 'the shopping list'} ✓`);
      });
    },
  },

  todo_checklist: {
    label: 'To-Do Checklist', icon: '☑️', category: 'Lists', needs: [],
    async fetch(card, data) {
      const lists = fvArr(await fvOnce(data, 'todoLists', () => apiFetch('/api/todo-lists')));
      const id = fvSelectedList(card, lists);
      data.fvTodo = data.fvTodo || {};
      data.fvTodo[card.id] = { lists, id, items: id ? fvArr(await apiFetch(`/api/todo-lists/${id}/items`).catch(() => [])) : [] };
    },
    render(card, data) {
      const t = data.fvTodo[card.id];
      if (!t.lists.length) return fvTitle('☑️', 'To-Do Checklist') + fvMuted('Add a list in Settings → Built-in To-Do Lists first.');
      return fvTitle('☑️', 'To-Do Checklist') + fvListSelect(card, t.lists, 'fv-todo-list')
        + fvChecklistHtml(t.items, 'fv-todo-chk')
        + `<div style="display:flex;gap:6px;margin-top:6px"><input class="form-input fv-todo-input" placeholder="Add an item" style="flex:1;padding:8px 10px;font-size:13px"><button class="btn btn-primary fv-todo-add" style="margin:0;padding:8px 14px;width:auto">Add</button></div>`;
    },
    wire(card, data) {
      const root = fvRoot(card), t = data.fvTodo[card.id];
      if (!root || !t.lists.length) return;
      const sel = root.querySelector('.fv-todo-list');
      if (sel) sel.addEventListener('change', () => { fvSave('fv_list_' + card.id, sel.value); renderFavoritesTab(); });
      root.querySelectorAll('.fv-todo-chk').forEach((c) => c.addEventListener('change', async () => {
        const r = await fvSend(`/api/todo-items/${c.dataset.id}`, { done: c.checked }, 'PUT');
        if (fvBad(r)) showToast('❌ ' + ((r && r.error) || 'Could not update'));
        renderFavoritesTab();
      }));
      fvWireAdd(root, 'fv-todo-input', 'fv-todo-add', async (text) => {
        const r = await fvSend(`/api/todo-lists/${t.id}/items`, { text });
        if (fvBad(r)) { showToast('❌ ' + ((r && r.error) || 'Could not add')); return false; }
        renderFavoritesTab(); return true;
      });
    },
  },
  shopping_checklist: {
    label: 'Shopping Checklist', icon: '🛒', category: 'Lists', needs: [],
    async fetch(card, data) {
      const lists = fvArr(await fvOnce(data, 'shopLists', () => apiFetch('/api/shopping-lists')));
      const id = fvSelectedList(card, lists);
      data.fvShop = data.fvShop || {};
      data.fvShop[card.id] = { lists, id, items: fvArr(await apiFetch(`/api/shopping-list?list=${id || 'all'}`).catch(() => [])) };
    },
    render(card, data) {
      const t = data.fvShop[card.id], doneCount = t.items.filter((i) => i.done).length;
      return fvTitle('🛒', 'Shopping Checklist') + fvListSelect(card, t.lists, 'fv-shop-list')
        + fvChecklistHtml(t.items, 'fv-shop-chk')
        + `<div style="display:flex;gap:6px;margin-top:6px"><input class="form-input fv-shop-input" placeholder="Add an item" style="flex:1;padding:8px 10px;font-size:13px"><button class="btn btn-primary fv-shop-add" style="margin:0;padding:8px 14px;width:auto">Add</button></div>`
        + (doneCount ? `<button class="fv-shop-clear" style="${fvBtn}">Clear ${doneCount} checked</button>` : '');
    },
    wire(card, data) {
      const root = fvRoot(card), t = data.fvShop[card.id];
      if (!root) return;
      const sel = root.querySelector('.fv-shop-list');
      if (sel) sel.addEventListener('change', () => { fvSave('fv_list_' + card.id, sel.value); renderFavoritesTab(); });
      root.querySelectorAll('.fv-shop-chk').forEach((c) => c.addEventListener('change', async () => {
        const r = await fvSend(`/api/shopping-items/${c.dataset.id}`, { done: c.checked }, 'PUT');
        if (fvBad(r)) showToast('❌ ' + ((r && r.error) || 'Could not update'));
        renderFavoritesTab();
      }));
      fvWireAdd(root, 'fv-shop-input', 'fv-shop-add', async (text) => {
        const r = await fvSend('/api/shopping-list', { text, list_id: Number(t.id) || undefined });
        if (fvBad(r)) { showToast('❌ ' + ((r && r.error) || 'Could not add')); return false; }
        renderFavoritesTab(); return true;
      });
      const clr = root.querySelector('.fv-shop-clear');
      if (clr) clr.addEventListener('click', async () => {
        if (!confirm('Remove the checked items from this list?')) return;
        await fvSend(`/api/shopping-list/clear-done?list=${encodeURIComponent(t.id)}`, {});
        renderFavoritesTab();
      });
    },
  },
  today_chores: {
    label: 'Chore Checklist', icon: '🧹', category: 'Lists', needs: ['kids'], configField: 'kid',
    render(card, data) {
      const kid = ((data.chart && data.chart.kids) || []).find((k) => k.id === card.config.kid_id);
      if (!kid) return `<p style="font-size:12px;color:var(--muted);margin:0">That kid no longer exists. Remove this card.</p>`;
      const chores = kid.chores || [], done = chores.filter((c) => c.done).length;
      const row = (c) => {
        const blocked = c.photo_required && !c.proof_photo && !c.done;
        return `<label style="display:flex;align-items:center;gap:10px;padding:6px 0;${blocked ? 'opacity:.6;' : 'cursor:pointer;'}${c.done ? 'text-decoration:line-through;opacity:.55' : ''}">
          <input type="checkbox" class="fv-chore-chk" data-id="${c.instance_id}" ${c.done ? 'checked' : ''} ${blocked ? 'disabled' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0">
          <span style="font-size:14px;min-width:0;overflow-wrap:anywhere">${escapeHtml(c.icon || '')} ${escapeHtml(c.title)}${c.overdue ? ' <span style="color:#fbbf24;font-size:11px">from earlier</span>' : ''}${blocked ? ' <span style="font-size:11px;color:var(--muted)">📷 needs a photo</span>' : ''}</span></label>`;
      };
      return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><div style="font-weight:600;font-size:12.5px;color:${kid.color || 'inherit'}">${escapeHtml(kid.avatar || '🙂')} ${escapeHtml(kid.name)}'s chores</div><div style="font-size:11px;color:var(--muted)">${chores.length ? `${done} of ${chores.length} done` : ''}</div></div>`
        + (chores.length ? chores.map(row).join('') : fvMuted('No chores today.'));
    },
    wire(card) {
      const root = fvRoot(card);
      if (!root) return;
      root.querySelectorAll('.fv-chore-chk').forEach((c) => c.addEventListener('change', async () => {
        const r = await fvSend(`/api/chore-instances/${c.dataset.id}/toggle`, { done: c.checked });
        if (fvBad(r)) showToast('❌ ' + ((r && r.error) || 'Could not update'));
        renderFavoritesTab();
      }));
    },
  },

  quick_event: {
    label: 'Quick Event', icon: '🗓️', category: 'Quick actions', needs: [],
    render() {
      return fvTitle('🗓️', 'Add an Event') + `
        <input class="form-input fv-ev-title" placeholder="e.g. Dentist" maxlength="120" style="width:100%;padding:8px 10px;font-size:13px">
        <div style="display:flex;gap:6px;margin-top:6px">
          <input type="date" class="form-input fv-ev-date" value="${todayStr()}" style="flex:1;padding:8px;font-size:13px;min-width:0">
          <input type="time" class="form-input fv-ev-time" style="flex:1;padding:8px;font-size:13px;min-width:0">
        </div>
        <button class="btn btn-primary fv-ev-add" style="margin-top:6px;padding:9px">Add to calendar</button>`;
    },
    wire(card) {
      const root = fvRoot(card);
      if (!root) return;
      const title = root.querySelector('.fv-ev-title'), btn = root.querySelector('.fv-ev-add');
      const go = async () => {
        const t = title.value.trim(), date = root.querySelector('.fv-ev-date').value, time = root.querySelector('.fv-ev-time').value;
        if (!t) { showToast('Give the event a name first'); return; }
        if (!date) { showToast('Pick a date'); return; }
        btn.disabled = true;
        const r = await fvSend('/api/events', { title: t, date, start_time: time || null });
        btn.disabled = false;
        if (fvBad(r)) { showToast('❌ ' + ((r && r.error) || 'Could not add')); return; }
        showToast(`✅ Added "${t}"`); title.value = ''; root.querySelector('.fv-ev-time').value = '';
      };
      btn.addEventListener('click', go);
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    },
  },
  quick_reminder: {
    label: 'Weekly Reminder', icon: '⏰', category: 'Quick actions', needs: [],
    render() {
      const today = new Date().getDay();
      return fvTitle('⏰', 'Add a Weekly Reminder') + `
        <input class="form-input fv-rem-text" placeholder="e.g. Take out the trash" maxlength="120" style="width:100%;padding:8px 10px;font-size:13px">
        <div style="display:flex;gap:4px;margin-top:6px">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => `<button type="button" class="fv-rem-dow" data-dow="${i}" aria-pressed="${i === today}" style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);cursor:pointer;font-size:13px;font-weight:600;background:${i === today ? 'var(--accent)' : 'var(--card)'};color:${i === today ? '#fff' : 'var(--text)'}">${l}</button>`).join('')}</div>
        ${fvMuted('Shows on the screens each week on the days you pick.')}
        <button class="btn btn-primary fv-rem-add" style="margin-top:6px;padding:9px">Add reminder</button>`;
    },
    wire(card) {
      const root = fvRoot(card);
      if (!root) return;
      root.querySelectorAll('.fv-rem-dow').forEach((b) => b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on)); b.style.background = on ? 'var(--accent)' : 'var(--card)'; b.style.color = on ? '#fff' : 'var(--text)';
      }));
      const text = root.querySelector('.fv-rem-text'), btn = root.querySelector('.fv-rem-add');
      const go = async () => {
        const name = text.value.trim(), days = [...root.querySelectorAll('.fv-rem-dow[aria-pressed="true"]')].map((b) => Number(b.dataset.dow));
        if (!name) { showToast('Give the reminder a name first'); return; }
        if (!days.length) { showToast('Pick at least one day of the week'); return; }
        btn.disabled = true;
        const r = await fvSend('/api/reminders', { name, icon: '📌', icon_type: 'emoji', schedule_type: 'weekly', schedule_config: { daysOfWeek: days, weekInterval: 1, startDate: todayStr() } });
        btn.disabled = false;
        if (fvBad(r)) { showToast('❌ ' + ((r && r.error) || 'Could not add')); return; }
        showToast(`✅ Added "${name}"`); text.value = '';
      };
      btn.addEventListener('click', go);
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    },
  },
  quick_messages: {
    label: 'One-tap Messages', icon: '📣', category: 'Quick actions', needs: [],
    render(card) {
      const msgs = fvMessages(card);
      return fvTitle('📣', 'One-tap Messages') + `<div style="display:flex;flex-wrap:wrap;gap:6px">${msgs.map((m, i) => `<button class="btn fv-msg-send" data-i="${i}" style="margin:0;padding:9px 12px;width:auto;background:var(--card);border:1px solid var(--border)">${escapeHtml(m)}</button>`).join('')}</div>
        <button class="fv-msg-edit" style="${fvBtn}">Edit messages ›</button>`;
    },
    wire(card) {
      const root = fvRoot(card);
      if (!root) return;
      const msgs = fvMessages(card);
      root.querySelectorAll('.fv-msg-send').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        const r = await fvSend('/api/messages', { text: msgs[Number(b.dataset.i)] });
        b.disabled = false;
        showToast(fvBad(r) ? '❌ ' + ((r && r.error) || 'Could not send') : 'Sent ✓');
      }));
      root.querySelector('.fv-msg-edit').addEventListener('click', () => {
        FV_EDIT.key = 'msg|' + card.id;
        showSheet(`<h3 style="margin:0 0 4px">One-tap Messages</h3>
          <p style="font-size:12px;color:var(--muted);margin:0 0 10px">One message per line (up to 6). Each becomes a button that posts it to the message board.</p>
          <textarea class="form-input" id="fv-msg-text" rows="6" style="resize:vertical">${escapeHtml(msgs.join('\n'))}</textarea>
          <div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn-primary" id="fv-msg-save" style="flex:1">Save</button><button class="btn" id="fv-msg-cancel" style="flex:1;background:var(--card);border:1px solid var(--border)">Cancel</button></div>`);
        $('fv-msg-cancel').addEventListener('click', () => { FV_EDIT.key = ''; closeSheet(); });
        $('fv-msg-save').addEventListener('click', async () => {
          const lines = $('fv-msg-text').value.split('\n').map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, 6);
          if (!lines.length) { showToast('Add at least one message'); return; }
          const r = await fvSend(`/api/favorite-cards/${card.id}`, { config: { ...card.config, messages: lines } }, 'PUT');
          FV_EDIT.key = ''; closeSheet();
          if (fvBad(r)) { showToast('❌ Could not save'); return; }
          renderFavoritesTab();
        });
      });
    },
  },
  add_photo: {
    label: 'Add a Photo', icon: '📷', category: 'Quick actions', needs: [],
    render() {
      return fvTitle('📷', 'Add a Photo') + fvMuted('Take or choose pictures to add to the photo slideshow.')
        + `<input type="file" class="fv-photo-file" accept="image/*" multiple style="display:none">
        <button class="btn btn-primary fv-photo-pick" style="margin-top:8px;padding:9px">Choose photos</button>`;
    },
    wire(card) {
      const root = fvRoot(card);
      if (!root) return;
      const file = root.querySelector('.fv-photo-file'), pick = root.querySelector('.fv-photo-pick');
      pick.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const files = [...file.files];
        if (!files.length) return;
        pick.disabled = true;
        let ok = 0;
        for (let i = 0; i < files.length; i++) {
          pick.textContent = 'Adding photos…';
          const fd = new FormData(); fd.append('photo', files[i]);
          const r = await apiFetch('/api/photos', { method: 'POST', body: fd }).catch(() => null);
          if (!fvBad(r)) ok++;
        }
        pick.disabled = false; pick.textContent = 'Choose photos'; file.value = '';
        showToast(ok === files.length ? `📷 Added ${ok === 1 ? '1 photo' : ok + ' photos'}` : `Added ${ok} of ${files.length}. Some could not be added.`);
      });
    },
  },

  screens_attention: {
    label: 'Screens Needing Attention', icon: '🩺', category: 'At a glance', needs: [],
    async fetch(card, data) { data.fvHealth = await fvOnce(data, 'health', () => apiFetch('/api/screen-health')); },
    render(card, data) {
      const h = data.fvHealth;
      if (fvBad(h) || !Array.isArray(h.screens)) return fvTitle('🩺', 'Screens') + fvMuted('Could not read the screens\' health right now.');
      const shown = h.screens.filter((s) => s.status === 'stuck' || s.status === 'repaired');
      const head = `<div class="fav-card-link" data-target-tab="displays" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between"><span style="font-weight:600;font-size:12.5px">🩺 Screens</span><span style="font-size:12px;color:${h.summary.stuck ? 'var(--danger)' : h.summary.repaired ? '#fbbf24' : '#34d399'};font-weight:600">${h.summary.stuck ? 'Needs attention' : h.summary.repaired ? 'Fixed itself recently' : (h.screens.length ? 'All good' : 'None yet')}</span></div>`;
      if (!shown.length) return head + (h.screens.length ? fvMuted(`${h.screens.length === 1 ? '1 screen' : h.screens.length + ' screens'}${h.summary.off ? `, ${h.summary.off} not reporting` : ' running normally'}`) : '');
      return head + shown.map((s) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border);margin-top:6px">
        <span style="width:9px;height:9px;border-radius:50%;flex-shrink:0;background:${s.status === 'stuck' ? '#f87171' : '#fbbf24'}"></span>
        <div style="flex:1;min-width:0;font-size:13px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.name || s.device_id)}</div><div style="font-size:11px;color:var(--muted)">${s.status === 'stuck' ? `Display not drawing for ${s.stuck_minutes} min` : `Wi-Fi fixed itself ${s.health && s.health.repairs ? s.health.repairs.count7 : 1}×`}</div></div>
        ${s.status === 'stuck' ? `<button class="btn fv-att-reload" data-id="${escapeHtml(s.device_id)}" style="margin:0;padding:7px 10px;width:auto;font-size:12px">Reload</button>` : ''}</div>`).join('');
    },
    wire(card) {
      const root = fvRoot(card);
      if (!root) return;
      root.querySelectorAll('.fv-att-reload').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        const r = await fvSend(`/api/screens/${encodeURIComponent(b.dataset.id)}/reload-display`, {});
        b.disabled = false;
        showToast(fvBad(r) ? 'Could not reload that display' : 'Reloading the display…');
      }));
    },
  },
  update_available: {
    label: 'Update Available', icon: '⬆️', category: 'At a glance', needs: [],
    async fetch(card, data) { data.fvVersion = await fvOnce(data, 'version', () => apiFetch('/api/version-status')); },
    render(card, data) {
      const v = data.fvVersion;
      if (fvBad(v) || !v.version) return fvTitle('⬆️', 'Version') + fvMuted('Could not check for updates right now.');
      const behind = (v.screens || []).filter((s) => s.outdated);
      const line = v.updateAvailable
        ? `<span style="color:#fbbf24;font-weight:600">Update available: ${escapeHtml(v.latest)}</span>`
        : `<span style="color:#34d399;font-weight:600">${v.checked ? 'Up to date' : 'Not checked yet'}</span>`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-weight:600;font-size:12.5px">⬆️ Version</span><span style="font-size:12px">${line}</span></div>`
        + fvMuted(`This device runs ${escapeHtml(v.version)}${v.beta ? ' (beta)' : ''}.`)
        + (v.updateAvailable && v.container ? fvMuted('Pull the new Docker image and restart the container to update.') : '')
        + (behind.length ? fvMuted(`Behind: ${behind.map((s) => escapeHtml(s.name)).join(', ')}`) : '');
    },
  },
});

function fvMessages(card) {
  const m = card.config && Array.isArray(card.config.messages) ? card.config.messages.filter((s) => typeof s === 'string' && s.trim()) : [];
  return m.length ? m.slice(0, 6) : ["Dinner's ready", 'Time to go', 'Come here, please'];
}
