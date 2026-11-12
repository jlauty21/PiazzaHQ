// The /tablet web app, part 8: the other Piazza HQ sheets: the calendar (a list and a month, add an event), the meal plan (change a meal, open its recipe with ingredients and step timers),
// the message board, the weather (hours and days) and the screens (status, TV power, which layout each shows). tbOpenCard() at the bottom is what a tap on one of these tiles calls.
// The lists and the chores are in 07-lists.js, which this needs.
'use strict';

// ── the calendar ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function tbAgendaSheet(tile, o) {
  const st = { tab: 'agenda', month: new Date(), sel: tbDayStr(0), events: [], form: !!(o && o.form), open: '' };
  st.month.setDate(1);
  const sh = tbCardSheet(tile.label || 'Calendar', ['events'], load);
  sh.body.innerHTML = `<div class="tb-segs"><button type="button" class="tb-seg on" data-tab="agenda">Coming up</button><button type="button" class="tb-seg" data-tab="month">Month</button><button type="button" class="tb-seg tb-addev" data-addev>＋ Add event</button></div>
    <form class="tb-evform" data-form hidden>
      <input class="tb-input" data-f="title" maxlength="120" placeholder="What is happening?" aria-label="Event title">
      <div class="tb-row"><label>Date<input type="date" class="tb-input" data-f="date"></label><label>Starts<input type="time" class="tb-input" data-f="start"></label><label>Ends<input type="time" class="tb-input" data-f="end"></label></div>
      <div class="tb-row"><button type="button" class="tb-btn" data-evcancel>Cancel</button><button type="submit" class="tb-btn primary">Add to the calendar</button></div></form>
    <div data-view></div>`;
  const $ = (s) => sh.body.querySelector(s);
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayName = (s) => (s === tbDayStr(0) ? 'Today' : s === tbDayStr(1) ? 'Tomorrow' : parse(s).toLocaleDateString(tbLocale(), { weekday: 'long', month: 'long', day: 'numeric' }));
  const daysOf = (e) => { const out = [], end = e.end_date && e.end_date > e.date ? e.end_date : e.date; for (let d = parse(e.date), n = 0; ymd(d) <= end && n < 60; d.setDate(d.getDate() + 1), n++) out.push(ymd(d)); return out; };
  const byDay = () => { const m = {}; st.events.forEach((e) => daysOf(e).forEach((d) => { (m[d] = m[d] || []).push(e); })); Object.values(m).forEach((l) => l.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))); return m; };
  const evRow = (e, day, i) => `<li class="tb-ev" data-day="${day}" data-ev="${i}"><span class="tb-evt">${e.start_time ? tbEsc(tbHm(e.start_time)) : '<span>All day</span>'}</span><span class="tb-evm"><b style="border-color:${tbEsc(e.color || 'var(--accent)')}">${tbEsc(e.title)}</b>${e.location ? `<small>${tbEsc(e.location)}</small>` : ''}${st.open === day + '#' + i && e.notes ? `<span class="tb-evn">${tbEsc(e.notes)}</span>` : ''}</span></li>`;
  function draw() {
    const map = byDay(), view = $('[data-view]');
    $('[data-form]').hidden = !st.form;
    sh.body.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
    if (st.tab === 'agenda') {
      const days = Object.keys(map).filter((d) => d >= tbDayStr(0)).sort();
      view.innerHTML = days.length ? days.map((d) => `<div class="tb-subhead"><span>${tbEsc(dayName(d))}</span></div><ul class="tb-itemlist">${map[d].map((e, i) => evRow(e, d, i)).join('')}</ul>`).join('') : '<p class="tb-empty">Nothing planned for the next month.</p>';
      return;
    }
    const first = new Date(st.month), lead = first.getDay(), total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells = []; for (let i = 0; i < lead; i++) cells.push(null); for (let d = 1; d <= total; d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
    const dow = [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2023, 0, 1 + i).toLocaleDateString(tbLocale(), { weekday: 'short' }));
    const list = map[st.sel] || [];
    view.innerHTML = `<div class="tb-monthbar"><button type="button" class="tb-btn tb-small" data-mv="-1" aria-label="Earlier month">‹</button><b>${tbEsc(first.toLocaleDateString(tbLocale(), { month: 'long', year: 'numeric' }))}</b><button type="button" class="tb-btn tb-small" data-mv="1" aria-label="Later month">›</button></div>
      <div class="tb-month">${dow.map((n) => `<span class="tb-dow">${tbEsc(n)}</span>`).join('')}${cells.map((d) => { if (!d) return '<span></span>'; const k = ymd(d), n = (map[k] || []).length; return `<button type="button" class="tb-mc${k === st.sel ? ' sel' : ''}${k === tbDayStr(0) ? ' today' : ''}" data-d="${k}"><span>${d.getDate()}</span><i>${(map[k] || []).slice(0, 3).map((e) => `<u style="background:${tbEsc(e.color || 'var(--accent)')}"></u>`).join('')}</i>${n > 3 ? '' : ''}</button>`; }).join('')}</div>
      <div class="tb-subhead"><span>${tbEsc(dayName(st.sel))}</span></div><ul class="tb-itemlist">${list.length ? list.map((e, i) => evRow(e, st.sel, i)).join('') : '<li class="tb-empty">Nothing planned.</li>'}</ul>`;
  }
  async function load() {
    const from = st.tab === 'agenda' ? tbDayStr(0) : ymd(st.month), to = st.tab === 'agenda' ? tbDayStr(30) : ymd(new Date(st.month.getFullYear(), st.month.getMonth() + 1, 0));
    const r = await tbApi('/api/events?from=' + from + '&to=' + to);
    if (!sh.alive()) return;
    if (tbOk(r)) st.events = tbList(r);
    draw();
  }
  sh.body.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]'); if (tab) { st.tab = tab.dataset.tab; await load(); return; }
    if (e.target.closest('[data-addev]')) { st.form = !st.form; const d = $('[data-form] [data-f="date"]'); if (!d.value) d.value = st.tab === 'month' ? st.sel : tbDayStr(0); draw(); if (st.form) $('[data-f="title"]').focus(); return; }
    if (e.target.closest('[data-evcancel]')) { st.form = false; draw(); return; }
    const mv = e.target.closest('[data-mv]'); if (mv) { st.month.setMonth(st.month.getMonth() + Number(mv.dataset.mv)); st.sel = ymd(st.month); await load(); return; }
    const dc = e.target.closest('[data-d]'); if (dc) { st.sel = dc.dataset.d; draw(); return; }
    const ev = e.target.closest('li[data-ev]'); if (ev) { const key = ev.dataset.day + '#' + ev.dataset.ev; st.open = st.open === key ? '' : key; draw(); }
  });
  sh.body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = (k) => $('[data-form] [data-f="' + k + '"]').value.trim(), title = f('title'), date = f('date');
    if (!title) { tbToast('Give the event a name.'); return; }
    if (!date) { tbToast('Choose a date.'); return; }
    const r = await tbDo('/api/events', 'POST', { title, date, start_time: f('start') || null, end_time: f('end') || null });
    if (!r) return;
    st.form = false; $('[data-form] [data-f="title"]').value = ''; tbToast('Added to the calendar'); await load(); tbAfterChange();
  });
  await load();
  if (st.form) { $('[data-form] [data-f="date"]').value = tbDayStr(0); $('[data-f="title"]').focus(); }
}

// ── the meal plan and its recipes ─────────────────────────────────────────────────────────────────────────────────────────
const TB_SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
async function tbMealsSheet(tile) {
  let meals = [];
  const sh = tbCardSheet(tile.label || 'Meals', ['meals'], load);
  const dayName = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : d.toLocaleDateString(tbLocale(), { weekday: 'long', month: 'short', day: 'numeric' }); };
  function draw() {
    sh.body.innerHTML = Array.from({ length: 7 }, (_, n) => {
      const date = tbDayStr(n), mine = (slot) => meals.find((m) => m.date === date && (m.slot || 'dinner') === slot);
      return `<section class="tb-mday"><div class="tb-subhead"><span>${tbEsc(dayName(n))}</span></div>${TB_SLOTS.map(([slot, name]) => {
        const m = mine(slot);
        if (!m && slot !== 'dinner') return `<button type="button" class="tb-slot empty small" data-date="${date}" data-slot="${slot}"><span>＋ ${tbEsc(name)}</span></button>`;
        return `<div class="tb-slot${m ? '' : ' empty'}"><button type="button" class="tb-slotmain" data-date="${date}" data-slot="${slot}"><small>${tbEsc(name)}</small><b>${m ? tbEsc(m.title) : '＋ Plan dinner'}</b></button>${m && m.recipe_id ? `<button type="button" class="tb-btn tb-small" data-recipe="${tbEsc(m.recipe_id)}">Recipe</button>` : ''}</div>`;
      }).join('')}</section>`;
    }).join('');
  }
  async function load() {
    const r = await tbApi('/api/meals?from=' + tbDayStr(0) + '&to=' + tbDayStr(6));
    if (!sh.alive()) return;
    if (tbOk(r)) meals = tbList(r);
    draw();
  }
  sh.body.addEventListener('click', (e) => {
    const rc = e.target.closest('[data-recipe]'); if (rc) { tbRecipeSheet(Number(rc.dataset.recipe)); return; }
    const sl = e.target.closest('[data-slot]'); if (sl) tbMealEditor(sl.dataset.date, sl.dataset.slot, meals.find((m) => m.date === sl.dataset.date && (m.slot || 'dinner') === sl.dataset.slot), async () => { await load(); tbAfterChange(); });
  });
  await load();
}
// Change one meal: its name, or a recipe from the collection (which names it), or clear it.
function tbMealEditor(date, slot, meal, done) {
  const { box, close } = tbSheet(`<h2>${tbEsc((TB_SLOTS.find((s) => s[0] === slot) || [0, 'Meal'])[1])}</h2><input class="tb-input" id="tbmeal-title" maxlength="80" placeholder="What is for ${slot === 'dinner' ? 'dinner' : slot}?" value="${tbEsc(meal ? meal.title : '')}" aria-label="Meal">
    <input class="tb-input" id="tbmeal-q" placeholder="Or search your recipes…" aria-label="Search your recipes"><div class="tb-list tb-choices" id="tbmeal-list"></div>
    <div class="tb-row"><button type="button" class="tb-btn danger" data-clear ${meal ? '' : 'disabled'}>Clear</button><button type="button" class="tb-btn" data-close>Cancel</button><button type="button" class="tb-btn primary" data-save>Save</button></div>`, true);
  box.style.zIndex = 25;
  let recipeId = meal && meal.recipe_id ? meal.recipe_id : null, timer = null;
  const q = box.querySelector('#tbmeal-q'), list = box.querySelector('#tbmeal-list'), title = box.querySelector('#tbmeal-title');
  async function search() {
    const r = await tbApi('/api/recipes?q=' + encodeURIComponent(q.value.trim())), all = tbOk(r) ? tbList(r).slice(0, 12) : [];
    list.innerHTML = all.length ? all.map((x) => `<button type="button" class="tb-choice" data-rid="${tbEsc(x.id)}" data-rt="${tbEsc(x.title)}"><span>${tbEsc(x.title)}</span><em>${x.prep_min || x.cook_min ? tbEsc((x.prep_min || 0) + (x.cook_min || 0)) + ' min' : ''}</em></button>`).join('') : '<p class="tb-empty">No recipes found.</p>';
  }
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); }); search();
  title.addEventListener('input', () => { recipeId = null; });                // typing a different name unlinks the recipe
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-rid]'); if (!b) return; recipeId = Number(b.dataset.rid); title.value = b.dataset.rt; list.querySelectorAll('.tb-choice').forEach((x) => x.classList.toggle('picked', x === b)); });
  const save = async (text) => { const r = await tbDo('/api/meals/' + date + '/' + slot, 'PUT', { title: text, recipe_id: recipeId }); if (r) { close(); done(); } };
  box.querySelector('[data-close]').addEventListener('click', close);
  box.querySelector('[data-save]').addEventListener('click', () => { const t = title.value.trim(); if (!t) { tbToast('Type a meal or choose a recipe.'); return; } save(t); });
  box.querySelector('[data-clear]').addEventListener('click', () => { recipeId = null; save(''); });
}
// A recipe on the screen: the servings, the ingredients (tick them as you go) and the steps, each with its own timer.
async function tbRecipeSheet(id) {
  const sh = tbCardSheet('Recipe', []);
  let servings = 0, timers = {};
  async function load() {
    const r = await tbApi('/api/recipes/' + id + (servings ? '?servings=' + servings : ''));
    if (!sh.alive()) return;
    if (!tbOk(r) || !r.title) { sh.body.innerHTML = '<p class="tb-empty">That recipe is not available.</p>'; return; }
    servings = r.servings;
    sh.box.querySelector('h2').textContent = r.title;
    const mins = (r.prep_min || 0) + (r.cook_min || 0);
    sh.body.innerHTML = `<div class="tb-recmeta">${mins ? `<span>${mins} <span>min</span></span>` : ''}<span class="tb-serv"><button type="button" class="tb-btn tb-small" data-serv="-1" aria-label="Fewer servings">−</button><b>${tbEsc(servings)}</b> <span>servings</span><button type="button" class="tb-btn tb-small" data-serv="1" aria-label="More servings">+</button></span></div>
      <div class="tb-subhead"><span>Ingredients</span></div><ul class="tb-itemlist">${(r.ingredients || []).map((i) => `<li><button type="button" class="tb-rowchk" role="checkbox" aria-checked="false"><span class="tb-box"></span><span class="tb-rowtext">${tbEsc(i.display || i.raw || i.name)}</span></button></li>`).join('')}</ul>
      <div class="tb-subhead"><span>Steps</span></div><ol class="tb-steps">${(r.steps || []).map((s, n) => `<li><span class="tb-sn">${n + 1}</span><span class="tb-st">${tbEsc(s.text)}</span>${s.timer_sec ? `<button type="button" class="tb-btn tb-small tb-timer" data-timer="${tbEsc(s.id)}" data-sec="${tbEsc(s.timer_sec)}">⏱ ${tbEsc(tbClock(s.timer_sec))}</button>` : ''}</li>`).join('')}</ol>`;
  }
  const clearTimers = () => Object.values(timers).forEach((t) => clearInterval(t.h));
  sh.body.addEventListener('click', async (e) => {
    const sv = e.target.closest('[data-serv]'); if (sv) { servings = Math.max(1, servings + Number(sv.dataset.serv)); await load(); return; }
    const row = e.target.closest('.tb-rowchk'); if (row) { const on = row.getAttribute('aria-checked') !== 'true'; row.setAttribute('aria-checked', String(on)); row.querySelector('.tb-box').classList.toggle('on', on); return; }
    const tm = e.target.closest('[data-timer]'); if (!tm) return;
    const key = tm.dataset.timer;
    if (timers[key]) { clearInterval(timers[key].h); delete timers[key]; tm.classList.remove('run', 'ring'); tm.textContent = '⏱ ' + tbClock(Number(tm.dataset.sec)); return; }   // a second tap stops it
    const end = Date.now() + Number(tm.dataset.sec) * 1000;
    tm.classList.add('run');
    timers[key] = { h: setInterval(() => {
      if (!tm.isConnected) { clearInterval(timers[key] && timers[key].h); return; }
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      tm.textContent = left ? '⏱ ' + tbClock(left) : 'Time is up!';
      if (!left) { clearInterval(timers[key].h); tm.classList.remove('run'); tm.classList.add('ring'); tbBeep(); }
    }, 500) };
  });
  const orig = sh.close; sh.close = () => { clearTimers(); orig(); };
  await load();
}
const tbClock = (sec) => { const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') : m + ':' + String(s % 60).padStart(2, '0'); };
function tbBeep() {
  try { if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]); } catch { /* not supported */ }
  try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.2; o.start(); setTimeout(() => { o.stop(); a.close(); }, 700); } catch { /* no sound */ }
}

// ── the message board ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function tbMessagesSheet(tile) {
  let list = [];
  const sh = tbCardSheet(tile.label || 'Messages', ['messages'], load);
  const quick = [...new Set(tbTilesOf(TB.layout).filter((t) => t.kind === 'card' && t.ref === 'send_message').map((t) => (t.card_config && t.card_config.text) || t.label).filter(Boolean))].slice(0, 8);
  sh.body.innerHTML = `<form class="tb-addrow" data-add><input class="tb-input" data-new maxlength="280" autocomplete="off" placeholder="Write a message…" aria-label="Write a message"><button type="submit" class="tb-btn primary">Send</button></form>
    ${quick.length ? `<div class="tb-segs">${quick.map((q) => `<button type="button" class="tb-seg" data-quick="${tbEsc(q)}">${tbEsc(q)}</button>`).join('')}</div>` : ''}<ul class="tb-itemlist" data-list></ul>`;
  const ago = (iso) => { const t = Date.parse(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso)) ? '' : 'Z')); if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(tbLocale(), { month: 'short', day: 'numeric' }); };
  function draw() {
    sh.body.querySelector('[data-list]').innerHTML = list.length ? list.map((m) => `<li class="tb-msg" data-id="${tbEsc(m.id)}"><span class="tb-msgdot" style="background:${tbEsc(m.color || 'var(--accent)')}"></span><span class="tb-rowtext">${m.pinned ? '📌 ' : ''}${tbEsc(m.text)}<small>${m.author ? tbEsc(m.author) + ' · ' : ''}${tbEsc(ago(m.created_at))}</small></span><button type="button" class="tb-x" data-del aria-label="Remove">✕</button></li>`).join('') : '<li class="tb-empty">No messages.</li>';
  }
  async function load() { const r = await tbApi('/api/messages'); if (!sh.alive()) return; if (tbOk(r)) list = tbList(r); draw(); }
  const send = async (text) => { const r = await tbDo('/api/messages', 'POST', { text }); if (r) { await load(); tbAfterChange(); } return !!r; };
  sh.body.addEventListener('submit', async (e) => { e.preventDefault(); const inp = sh.body.querySelector('[data-new]'), t = inp.value.trim(); if (!t) return; inp.value = ''; if (!(await send(t))) inp.value = t; });
  sh.body.addEventListener('click', async (e) => {
    const q = e.target.closest('[data-quick]'); if (q) { await send(q.dataset.quick); return; }
    const li = e.target.closest('li[data-id]'); if (li && e.target.closest('[data-del]')) { list = list.filter((m) => String(m.id) !== li.dataset.id); draw(); await tbDo('/api/messages/' + li.dataset.id, 'DELETE'); tbAfterChange(); }
  });
  await load();
}

// ── the weather ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function tbWeatherSheet(tile) {
  const sh = tbCardSheet(tile.label || 'Weather', []);
  if (!TB.weather || !TB.weather.current) { TB.weatherAt = 0; await tbRefreshWeather(); }
  const w = TB.weather;
  if (!w || !w.current) { sh.body.innerHTML = '<p class="tb-empty">The weather is not available.</p>'; return; }
  const code = (c) => TB_WMO[c] || '', cur = w.current, d = w.daily || {}, h = w.hourly || {};
  const nowIso = new Date(); nowIso.setMinutes(0, 0, 0);
  const idx = (h.time || []).findIndex((t) => new Date(t) >= nowIso), hours = idx >= 0 ? (h.time || []).slice(idx, idx + 12).map((t, i) => ({ t, temp: h.temperature_2m[idx + i], code: (h.weather_code || [])[idx + i], pop: (h.precipitation_probability || [])[idx + i] })) : [];
  sh.body.innerHTML = `<div class="tb-wxnow"><span class="tb-bigtext">${tbEsc(Math.round(cur.temperature_2m))}°</span><span>${tbEsc(code(cur.weather_code !== undefined ? cur.weather_code : cur.weathercode))}</span>${cur.apparent_temperature != null ? `<small><span>Feels like</span> ${tbEsc(Math.round(cur.apparent_temperature))}°</small>` : ''}</div>
    ${hours.length ? `<div class="tb-subhead"><span>Next hours</span></div><div class="tb-hours">${hours.map((x) => `<div><small>${tbEsc(new Date(x.t).toLocaleTimeString(tbLocale(), { hour: 'numeric' }))}</small><b>${tbEsc(Math.round(x.temp))}°</b>${x.pop ? `<small>${tbEsc(x.pop)}%</small>` : '<small>&nbsp;</small>'}</div>`).join('')}</div>` : ''}
    ${(d.time || []).length ? `<div class="tb-subhead"><span>This week</span></div><ul class="tb-itemlist">${d.time.slice(0, 7).map((t, i) => `<li class="tb-wxday"><span>${tbEsc(i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString(tbLocale(), { weekday: 'long' }))}</span><span class="tb-rowtext"><small>${tbEsc(code((d.weather_code || [])[i]))}</small></span><span>${(d.precipitation_probability_max || [])[i] ? tbEsc(d.precipitation_probability_max[i]) + '%' : ''}</span><b>${tbEsc(Math.round(d.temperature_2m_max[i]))}° <small>${tbEsc(Math.round(d.temperature_2m_min[i]))}°</small></b></li>`).join('')}</ul>` : ''}`;
}

// ── the screens ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function tbScreensSheet(tile) {
  let screens = [], displays = [], health = {};
  const sh = tbCardSheet(tile.label || 'Screens', ['screens'], load);
  function draw() {
    sh.body.innerHTML = screens.length ? screens.map((s) => {
      const h = health[s.device_id], st = h ? h.status : (s.online ? 'good' : 'off'), tv = s.tv_control_type;
      return `<section class="tb-scr" data-dev="${tbEsc(s.device_id)}"><div class="tb-scrhead"><span class="tb-dot${st === 'stuck' ? ' bad' : st === 'off' ? ' off' : ''}"></span><b>${tbEsc(s.name || s.device_id)}</b><small>${st === 'good' ? '<span>Online</span>' : st === 'stuck' ? '<span>Needs attention</span>' : st === 'repaired' ? '<span>Fixed itself</span>' : '<span>Offline</span>'}</small></div>
        <div class="tb-row">${displays.length ? `<label>Layout<select class="tb-input" data-layout>${[['', 'Default'], ...displays.map((d) => [d.slug, d.name])].map(([v, l]) => `<option value="${tbEsc(v)}" ${v === (s.assigned_display_slug || '') ? 'selected' : ''}>${tbEsc(l)}</option>`).join('')}</select></label>` : ''}
        ${tv ? '<button type="button" class="tb-btn" data-tv="power-on">TV on</button><button type="button" class="tb-btn" data-tv="power-off">TV off</button>' : ''}</div></section>`;
    }).join('') : '<p class="tb-empty">No screens found.</p>';
  }
  async function load() {
    const [a, b, c] = await Promise.all([tbApi('/api/screens'), tbApi('/api/screen-health'), tbApi('/api/displays')]);
    if (!sh.alive()) return;
    if (tbOk(a)) screens = tbList(a).filter((s) => !String(s.device_id).startsWith('preview_'));
    if (tbOk(c)) displays = tbList(c);
    health = {}; if (tbOk(b) && Array.isArray(b.screens)) b.screens.forEach((x) => { health[x.device_id] = x; });
    draw();
  }
  sh.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tv]'); if (!b) return;
    const dev = b.closest('[data-dev]').dataset.dev;
    b.disabled = true; const r = await tbDo('/api/screens/' + encodeURIComponent(dev) + '/tv/' + b.dataset.tv, 'POST', {}); b.disabled = false;
    if (r) tbToast(b.dataset.tv === 'power-on' ? 'TV is turning on' : 'TV is turning off');
  });
  sh.body.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-layout]')) return;
    const dev = e.target.closest('[data-dev]').dataset.dev, r = await tbDo('/api/screens/' + encodeURIComponent(dev) + '/assign', 'POST', { display: e.target.value });
    if (r) tbToast('Layout changed');
  });
  await load();
}

// ── what a tap on a Piazza HQ tile opens ──────────────────────────────────────────────────────────────────────────────────
async function tbOpenCard(tile) {
  if (TB.preview) { tbToast('This is only a preview. Nothing was changed.'); return; }
  if (tile.needs_pin && !(await tbAskPin(tile.label || TM_CARD_LABELS[tile.ref] || 'PIN needed'))) return;
  const ex = TB_CARD_EXTRA[tile.ref]; if (ex && ex.open) { ex.open(tile); return; }
  const fn = { shopping_count: tbShoppingSheet, todo_count: tbTodoSheet, chores: tbChoresSheet, agenda: tbAgendaSheet, next_up: tbAgendaSheet, tonight_dinner: tbMealsSheet, messages: tbMessagesSheet, weather: tbWeatherSheet, screen_health: tbScreensSheet }[tile.ref];
  if (fn) fn(tile);
}
