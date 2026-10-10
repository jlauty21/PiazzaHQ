// ── Reminders, as a Family Hub tab ──────────────────────────────────────────
// Reminders are household-shared data (same as Chores/To-Do/Shopping), not
// something that should only be reachable through a specific widget's
// settings — if someone never adds a Reminders widget to a layout, or
// removes the one they had, they'd otherwise lose easy access to manage
// reminders at all even though the data (and the calendar-grid badges,
// Agenda rows, and Daily Briefing email that all read from it) is still
// very much alive. This reuses the EXACT SAME list/form/save/delete
// functions the widget-settings modal uses — just points them at this
// tab's own container (via _mrBodyId) instead of the modal's, so there's
// only ever one implementation of the actual CRUD logic to keep correct.
async function renderRemindersFamilyTab() {
  const content = $('content');
  content.innerHTML = `
    <div style="padding:14px">
      <div id="family-reminders-body"></div>
    </div>
  `;
  _mrBodyId = 'family-reminders-body';
  await renderManageRemindersListView();
}

// ── Family Hub · Board sub-tab ────────────────────────────────────────────
// The companion-app side of the Family Message Board widget. A compose box +
// the current list of notes, ✕ to clear and 📌 to pin — same data and
// endpoints (/api/messages) the wall widget uses; the display picks up every
// change over the 'messages' SSE topic. Gated by messageboard_enabled.
const MESSAGEBOARD_NAME_KEY = 'messageboard_name';
function mbBoardTimeAgo(createdAt) {
  if (!createdAt) return '';
  const t = Date.parse(String(createdAt).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}
function mbBoardNoteColor(m) {
  if (m && m.author_profile_id != null) {
    const p = (PROFILES || []).find(x => Number(x.id) === Number(m.author_profile_id));
    if (p && p.color) return p.color;
  }
  return (m && m.color) || '#4A90D9';
}
const MESSAGEBOARD_PROFILE_KEY = 'messageboard_profile_id';
function mbSavedProfileChoice() {
  try { return localStorage.getItem(MESSAGEBOARD_PROFILE_KEY) || ''; } catch { return ''; }
}
async function renderBoardFamilyTab() {
  const content = $('content');
  let notes = [];
  try { notes = await apiFetch('/api/messages'); } catch {}
  if (!Array.isArray(notes)) notes = [];
  const cards = notes.map(m => {
    const color = mbBoardNoteColor(m);
    const p = m.author_profile_id != null ? (PROFILES || []).find(x => Number(x.id) === Number(m.author_profile_id)) : null;
    const who = p
      ? `${profileAvatarHtml(p, 16)}<span style="font-weight:700;color:var(--text)">${escapeHtml(p.name)}</span>`
      : (m.author ? `<span style="font-weight:700;color:var(--text)">${escapeHtml(m.author)}</span>` : '');
    return `
      <div class="settings-card" style="display:flex;gap:10px;padding:10px 12px;border-left:4px solid ${color}${m.pinned ? ';background:rgba(232,184,74,0.08)' : ''}" data-msg-id="${m.id}" data-pinned="${m.pinned ? 1 : 0}">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:11px;color:var(--muted)">
            ${who}
            <span>${escapeHtml(mbBoardTimeAgo(m.created_at))}</span>
          </div>
          <div style="font-size:14px;color:var(--text);white-space:pre-wrap;word-break:break-word">${escapeHtml(m.text)}</div>
        </div>
        <button type="button" class="icon-btn small mb-pin-btn" data-msg-id="${m.id}" title="${m.pinned ? 'Unpin' : 'Pin'}" style="opacity:${m.pinned ? '1' : '0.5'}">📌</button>
        <button type="button" class="icon-btn del small mb-del-btn" data-msg-id="${m.id}" title="Remove">✕</button>
      </div>`;
  }).join('');
  // When profiles exist, let the poster say who it's from — defaults to the
  // active profile, else the last choice on this device, else the first.
  let posterRow = '';
  if ((PROFILES || []).length) {
    const def = (activeProfile && String(activeProfile.id)) || mbSavedProfileChoice() || String(PROFILES[0].id);
    posterRow = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:12px;color:var(--muted);flex-shrink:0">Posting as</span>
        <select class="form-input" id="mb-poster" style="width:auto;padding:6px 8px;font-size:13px">
          ${PROFILES.map(p => `<option value="${p.id}" ${String(p.id) === def ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          <option value="__other__">Someone else…</option>
        </select>
      </div>`;
  }
  content.innerHTML = `
    <div style="padding:14px">
      ${posterRow}
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <textarea class="form-input" id="mb-compose" rows="2" maxlength="280" placeholder="Leave a note for the family…" style="flex:1;resize:none;font-family:inherit"></textarea>
        <button type="button" id="mb-post-btn" style="background:var(--accent);border:none;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;flex-shrink:0">Post</button>
      </div>
      <div id="mb-notes" style="display:flex;flex-direction:column;gap:6px">
        ${cards || '<div class="empty-state"><div class="emoji">📝</div><p>No messages yet.</p></div>'}
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:14px">Notes show on any wall display with a Message Board widget, and clear for everyone. Pinned notes stay put and skip the auto-clear.</p>
    </div>
  `;
  wireBoardFamilyTab();
}
function wireBoardFamilyTab() {
  const post = async () => {
    const ta = $('mb-compose');
    const btn = $('mb-post-btn');
    const text = (ta.value || '').trim();
    if (!text) return;
    // Author: from the "Posting as" picker when profiles exist (remembered
    // per device), else the active profile, else a one-time name prompt.
    let author = '', authorProfileId = null, color;
    const poster = $('mb-poster');
    if (poster && poster.value && poster.value !== '__other__') {
      const p = profileById(poster.value);
      if (p) { author = p.name || ''; authorProfileId = p.id; color = p.color || undefined; }
      try { localStorage.setItem(MESSAGEBOARD_PROFILE_KEY, String(poster.value)); } catch {}
    } else if (poster && poster.value === '__other__') {
      let saved = (prompt('Name for this note:') || '').trim();
      author = saved;
    } else if (activeProfile) {
      author = activeProfile.name || '';
      authorProfileId = activeProfile.id;
      color = activeProfile.color || undefined;
    } else {
      let saved = '';
      try { saved = localStorage.getItem(MESSAGEBOARD_NAME_KEY) || ''; } catch {}
      if (!saved) {
        saved = (prompt('Your name (shown on notes you post):') || '').trim();
        if (saved) { try { localStorage.setItem(MESSAGEBOARD_NAME_KEY, saved); } catch {} }
      }
      author = saved;
    }
    btn.disabled = true; btn.textContent = 'Posting…';
    try {
      const r = await apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ text, author, author_profile_id: authorProfileId, color }) });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
      ta.value = '';
      renderBoardFamilyTab();
    } catch {
      showToast('❌ Could not post — try again');
    } finally {
      btn.disabled = false; btn.textContent = 'Post';
    }
  };
  if ($('mb-post-btn')) $('mb-post-btn').addEventListener('click', post);
  if ($('mb-compose')) $('mb-compose').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
  });
  document.querySelectorAll('.mb-del-btn').forEach(btn => btn.addEventListener('click', async () => {
    await apiFetch(`/api/messages/${btn.dataset.msgId}`, { method: 'DELETE' });
    renderBoardFamilyTab();
  }));
  document.querySelectorAll('.mb-pin-btn').forEach(btn => btn.addEventListener('click', async () => {
    const card = document.querySelector(`[data-msg-id="${btn.dataset.msgId}"]`);
    const isPinned = card && card.dataset.pinned === '1';
    await apiFetch(`/api/messages/${btn.dataset.msgId}`, { method: 'PUT', body: JSON.stringify({ pinned: isPinned ? 0 : 1 }) });
    renderBoardFamilyTab();
  }));
}

// ── Family Hub · Meals sub-tab ───────────────────────────────────────────────
// A 14-day plan. Which slots (breakfast / lunch / dinner) the household plans
// is settings.mealplan_slots — toggled at the top of this tab. Tap a slot on a
// day to plan/edit/clear it. Same /api/meals endpoints the wall widget uses.
const MP_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MP_SLOTS = ['breakfast', 'lunch', 'dinner'];
const MP_SLOT_NAME = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
function mpIso(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function mpParseSlots(raw) {
  const list = String(raw || 'dinner').split(',').map(s => s.trim().toLowerCase()).filter(s => MP_SLOTS.includes(s));
  return MP_SLOTS.filter(s => list.includes(s)).length ? MP_SLOTS.filter(s => list.includes(s)) : ['dinner'];
}
let _mpEdit = null; // { date, slot } of the open inline editor, or null
async function renderMealsFamilyTab() {
  const content = $('content');
  const from = mpIso(0), to = mpIso(13);
  let rows = [], settings = {};
  try { [rows, settings] = await Promise.all([apiFetch(`/api/meals?from=${from}&to=${to}`), apiFetch('/api/settings')]); } catch {}
  const activeSlots = mpParseSlots(settings && settings.mealplan_slots);
  const byKey = {};
  (Array.isArray(rows) ? rows : []).forEach(m => { byKey[m.date + '|' + (m.slot || 'dinner')] = m; });

  const slotToggles = MP_SLOTS.map(s =>
    `<button type="button" class="mp-slot-toggle ${activeSlots.includes(s) ? 'on' : ''}" data-slot="${s}"
      style="border:1px solid var(--border);border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;background:${activeSlots.includes(s) ? 'var(--accent)' : 'transparent'};color:${activeSlots.includes(s) ? '#fff' : 'var(--text)'}">${MP_SLOT_NAME[s]}</button>`
  ).join('');

  const dayCards = [];
  for (let i = 0; i < 14; i++) {
    const date = mpIso(i);
    const [y, mo, d] = date.split('-').map(Number);
    const dow = new Date(y, mo - 1, d).getDay();
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${MP_DOW[dow]} ${MP_MON[mo - 1]} ${d}`;
    const slotRows = activeSlots.map(slot => {
      const m = byKey[date + '|' + slot];
      if (_mpEdit && _mpEdit.date === date && _mpEdit.slot === slot) {
        return `
          <div class="mp-editrow" data-mp-date="${date}" data-mp-slot="${slot}" style="padding:8px 0 4px">
            <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px">${activeSlots.length > 1 ? MP_SLOT_NAME[slot] + ' · ' : ''}${label}</div>
            <input class="form-input mp-f-title" maxlength="80" placeholder="Tacos, leftovers, Grandma's…" value="${escapeHtml(m ? m.title : '')}">
            <textarea class="form-input mp-f-notes" rows="2" maxlength="300" placeholder="Notes (optional)" style="margin-top:8px;resize:none">${escapeHtml(m ? m.notes : '')}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button type="button" class="mp-f-save" style="flex:1;background:var(--accent);border:none;border-radius:10px;padding:9px;color:#fff;font-weight:700;cursor:pointer">Save</button>
              <button type="button" class="mp-f-clear ghost small">Clear</button>
              <button type="button" class="mp-f-cancel ghost small">Cancel</button>
            </div>
          </div>`;
      }
      return `
        <div class="mp-slot-row" data-mp-date="${date}" data-mp-slot="${slot}" style="display:flex;align-items:center;gap:10px;padding:7px 0;cursor:pointer">
          ${activeSlots.length > 1 ? `<span style="font-size:11px;font-weight:700;color:var(--muted);min-width:64px">${MP_SLOT_NAME[slot]}</span>` : ''}
          <span style="flex:1;font-size:14px;${m ? 'color:var(--text)' : 'color:var(--muted);opacity:0.7'}">${m ? escapeHtml(m.title) : '+ Add'}</span>
        </div>`;
    }).join('');
    dayCards.push(`
      <div class="settings-card" style="padding:10px 14px${i === 0 ? ';border-left:3px solid var(--accent)' : ''}">
        <div style="font-size:12.5px;font-weight:${i === 0 ? '700' : '600'};color:${i === 0 ? 'var(--accent)' : 'var(--muted)'};margin-bottom:2px">${label}</div>
        ${slotRows}
      </div>`);
  }

  content.innerHTML = `
    <div style="padding:14px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <span style="font-size:12px;color:var(--muted)">Plan</span>
        ${slotToggles}
        <div class="spacer" style="flex:1"></div>
        <button type="button" id="mp-copy-week" class="ghost small">📋 Copy last week</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">${dayCards.join('')}</div>
      <p style="font-size:11px;color:var(--muted);margin-top:14px">Also shows as a wall-display widget (Layout → Meal Plan). Tap a meal to plan it.</p>
    </div>
  `;
  wireMealsFamilyTab(activeSlots);
}
function wireMealsFamilyTab(activeSlots) {
  document.querySelectorAll('.mp-slot-toggle').forEach(btn => btn.addEventListener('click', async () => {
    const s = btn.dataset.slot;
    let next = activeSlots.includes(s) ? activeSlots.filter(x => x !== s) : [...activeSlots, s];
    next = MP_SLOTS.filter(x => next.includes(x));
    if (!next.length) { showToast('Keep at least one meal'); return; }
    try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ mealplan_slots: next.join(',') }) }); } catch {}
    _mpEdit = null;
    renderMealsFamilyTab();
  }));
  document.querySelectorAll('.mp-slot-row').forEach(row => row.addEventListener('click', () => {
    _mpEdit = { date: row.dataset.mpDate, slot: row.dataset.mpSlot };
    renderMealsFamilyTab();
  }));
  const openRow = _mpEdit ? document.querySelector(`.mp-editrow[data-mp-date="${_mpEdit.date}"][data-mp-slot="${_mpEdit.slot}"]`) : null;
  if (openRow) {
    const titleEl = openRow.querySelector('.mp-f-title');
    if (titleEl) setTimeout(() => titleEl.focus(), 30);
    const submit = async (title) => {
      const notes = openRow.querySelector('.mp-f-notes').value || '';
      try {
        const r = await apiFetch(`/api/meals/${_mpEdit.date}/${_mpEdit.slot}`, { method: 'PUT', body: JSON.stringify({ title, notes }) });
        if (r && r.error) { showToast('❌ ' + r.error); return; }
        _mpEdit = null;
        renderMealsFamilyTab();
      } catch { showToast('❌ Could not save — try again'); }
    };
    openRow.querySelector('.mp-f-save').addEventListener('click', () => {
      const t = (openRow.querySelector('.mp-f-title').value || '').trim();
      if (!t) { showToast('Enter a meal, or tap Clear'); return; }
      submit(t);
    });
    openRow.querySelector('.mp-f-clear').addEventListener('click', () => submit(''));
    openRow.querySelector('.mp-f-cancel').addEventListener('click', () => { _mpEdit = null; renderMealsFamilyTab(); });
  }
  const copyBtn = $('mp-copy-week');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    copyBtn.disabled = true;
    try {
      const prev = await apiFetch(`/api/meals?from=${mpIso(-7)}&to=${mpIso(-1)}`);
      const cur = await apiFetch(`/api/meals?from=${mpIso(0)}&to=${mpIso(6)}`);
      const prevByKey = {};
      (Array.isArray(prev) ? prev : []).forEach(m => {
        const off = Math.round((new Date(m.date + 'T00:00:00') - new Date(mpIso(-7) + 'T00:00:00')) / 86400000);
        prevByKey[off + '|' + (m.slot || 'dinner')] = m; // off 0..6
      });
      const curKeys = new Set((Array.isArray(cur) ? cur : []).map(m => (m.date) + '|' + (m.slot || 'dinner')));
      let copied = 0;
      for (let i = 0; i < 7; i++) {
        for (const slot of activeSlots) {
          const src = prevByKey[i + '|' + slot];
          const dstKey = mpIso(i) + '|' + slot;
          if (src && src.title && !curKeys.has(dstKey)) {
            await apiFetch(`/api/meals/${mpIso(i)}/${slot}`, { method: 'PUT', body: JSON.stringify({ title: src.title, notes: src.notes || '' }) });
            copied++;
          }
        }
      }
      showToast(copied ? `Copied ${copied} meal${copied === 1 ? '' : 's'}` : 'Nothing to copy (last week empty, or this week already planned)');
      renderMealsFamilyTab();
    } catch { showToast('❌ Could not copy'); }
    finally { copyBtn.disabled = false; }
  });
}

async function saveReminderFromModal() {
  const name = $('mr-f-name').value.trim();
  const activeTypeBtn = document.querySelector('.mr-icontype-btn.active');
  const iconType = activeTypeBtn ? activeTypeBtn.dataset.icontype : 'emoji';
  let icon;
  if (iconType === 'text') {
    icon = $('mr-f-icon-text').value.trim();
    if (!icon) { showToast('Enter a short text label, or switch to Emoji/Image'); return; }
  } else if (iconType === 'image') {
    if (!_mrPendingIconImage) { showToast('Choose an image first, or switch to Emoji/Text'); return; }
    icon = null;
  } else {
    icon = $('mr-f-icon').value.trim() || '📌';
  }
  const scheduleType = $('mr-f-type').value;
  if (!name) { showToast('Give this reminder a name first'); return; }
  const startDate = $('mr-f-start-date').value;
  let scheduleConfig;
  if (scheduleType === 'weekly') {
    const days = [...document.querySelectorAll('.mr-dow-btn.active')].map(b => parseInt(b.dataset.dow, 10));
    if (!days.length) { showToast('Pick at least one day of the week'); return; }
    const weekInterval = parseInt($('mr-f-week-interval').value, 10) || 1;
    scheduleConfig = { daysOfWeek: days, weekInterval, startDate };
  } else if (scheduleType === 'interval') {
    const intervalDays = parseInt($('mr-f-interval-days').value, 10);
    if (!intervalDays || intervalDays < 1 || !startDate) { showToast('Fill in both the interval and start date'); return; }
    scheduleConfig = { intervalDays, startDate };
  } else if (scheduleType === 'monthly') {
    const monthInterval = parseInt($('mr-f-month-interval').value, 10) || 1;
    const monthlyMode = $('mr-f-monthly-mode').value;
    if (!startDate) { showToast('Pick a start date'); return; }
    scheduleConfig = { monthlyMode, monthInterval, startDate };
    if (monthlyMode === 'dayOfMonth') {
      const dayOfMonth = parseInt($('mr-f-day-of-month').value, 10);
      if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) { showToast('Pick a valid day of the month'); return; }
      scheduleConfig.dayOfMonth = dayOfMonth;
    } else {
      scheduleConfig.nthWeek = parseInt($('mr-f-nth-week').value, 10);
      scheduleConfig.nthWeekday = parseInt($('mr-f-nth-weekday').value, 10);
    }
  } else { // yearly
    const yearInterval = parseInt($('mr-f-year-interval').value, 10) || 1;
    const yearlyMonth = parseInt($('mr-f-yearly-month').value, 10);
    const yearlyMode = $('mr-f-yearly-mode').value;
    if (!startDate) { showToast('Pick a start date'); return; }
    scheduleConfig = { yearlyMode, yearlyMonth, yearInterval, startDate };
    if (yearlyMode === 'date') {
      const yearlyDay = parseInt($('mr-f-yearly-day').value, 10);
      if (!yearlyDay || yearlyDay < 1 || yearlyDay > 31) { showToast('Pick a valid day'); return; }
      scheduleConfig.yearlyDay = yearlyDay;
    } else {
      scheduleConfig.yearlyNthWeek = parseInt($('mr-f-yearly-nth-week').value, 10);
      scheduleConfig.yearlyNthWeekday = parseInt($('mr-f-yearly-nth-weekday').value, 10);
    }
  }
  // Universal end condition, layered onto whichever pattern was built above.
  const endType = $('mr-f-end-type').value;
  scheduleConfig.endType = endType;
  if (endType === 'onDate') {
    const endDate = $('mr-f-end-date').value;
    if (!endDate) { showToast('Pick an end date'); return; }
    scheduleConfig.endDate = endDate;
  } else if (endType === 'afterCount') {
    const endCount = parseInt($('mr-f-end-count').value, 10);
    if (!endCount || endCount < 1) { showToast('Enter how many times it should repeat'); return; }
    scheduleConfig.endCount = endCount;
  }
  const payload = {
    name, icon, icon_type: iconType,
    icon_image: iconType === 'image' ? _mrPendingIconImage : undefined,
    schedule_type: scheduleType, schedule_config: scheduleConfig,
  };
  const saveBtn = $('mr-f-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  try {
    if (_manageRemindersEditingId) {
      await apiFetch(`/api/reminders/${_manageRemindersEditingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/api/reminders', { method: 'POST', body: JSON.stringify(payload) });
    }
    showToast('Reminder saved ✓');
    renderManageRemindersListView();
  } catch {
    showToast('❌ Could not save — try again');
    saveBtn.disabled = false; saveBtn.textContent = 'Save';
  }
}
(function wireManageRemindersModal() {
  $('mr-close-btn').addEventListener('click', () => $('manage-reminders-overlay').classList.remove('open'));
  $('manage-reminders-overlay').addEventListener('click', (e) => { if (e.target.id === 'manage-reminders-overlay') $('manage-reminders-overlay').classList.remove('open'); });
})();

// ── Undo history for the layout editor ────────────────────────────────────────
// We snapshot the widget array BEFORE each change (move, resize, add, delete) so a
// single Undo restores the previous arrangement — handy when a widget gets nudged
// by accident. History is per editing session (cleared when the layout reloads).
let layoutHistory = [];
const MAX_HISTORY = 30;
function snapshotLayout() {
  try {
    layoutHistory.push(JSON.stringify(layoutWidgets));
    if (layoutHistory.length > MAX_HISTORY) layoutHistory.shift();
    updateUndoButton();
  } catch {}
}
function undoLayout() {
  if (!layoutHistory.length) return;
  const prev = layoutHistory.pop();
  try {
    layoutWidgets = JSON.parse(prev);
    // Keep selection valid.
    if (selectedId && !layoutWidgets.find(w => w.id === selectedId)) selectedId = null;
    rebuildCanvas();
    renderLayerList();
    drawWidgetSettingsPanel();
    updateUndoButton();
  } catch {}
}
function updateUndoButton() {
  const btn = $('layout-undo-btn');
  if (btn) {
    const has = layoutHistory.length > 0;
    btn.disabled = !has;
    btn.classList.toggle('undo-ready', has);
  }
}

// ── Layer list — tap a widget by name to select it ────────────────────────────
// Makes it easy to grab a widget that's hard to tap on the canvas (e.g. one behind
// a full-screen photo). Mirrors canvas selection both ways.
function renderLayerList() {
  const box = $('widget-layer-list');
  if (!box) return;
  if (!layoutWidgets.length) {
    box.innerHTML = '<div class="layer-empty">No widgets yet — add one below.</div>';
    return;
  }
  box.innerHTML = layoutWidgets.map(w => {
    const def = WIDGET_DEFS.find(d => d.type === w.type) || { icon:'?', label:w.type };
    const isSelected = w.id === selectedId;
    return `<button class="layer-row${isSelected ? ' active' : ''}" data-layer="${w.id}">
      <span class="layer-ic">${def.icon}</span>
      <span class="layer-name">${def.label}</span>
      <span class="layer-expand" data-layer-expand="${w.id}" title="Make 10% bigger">⤢</span>
      <span class="layer-del" data-layer-del="${w.id}" title="Remove">✕</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.layer-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.dataset.layerDel !== undefined || e.target.dataset.layerExpand !== undefined) return;
      selectWidget(row.dataset.layer);
    });
  });
  box.querySelectorAll('[data-layer-del]').forEach(x => {
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = x.dataset.layerDel;
      snapshotLayout();
      layoutWidgets = layoutWidgets.filter(w => w.id !== id);
      if (selectedId === id) { selectedId = null; drawWidgetSettingsPanel(); }
      rebuildCanvas(); renderLayerList();
    });
  });
  // Always present in the DOM for every row (shown/hidden via CSS keyed off
  // the row's .active class, see .layer-row .layer-expand below) rather than
  // conditionally rendered here based on selection — selectWidget() below
  // does a lightweight direct class-toggle on the existing row rather than a
  // full re-render (for responsiveness when just clicking between widgets),
  // so conditionally including this button in the template would only ever
  // update on a FULL layer-list rebuild (add/delete), not on a normal
  // selection click — confirmed this the hard way via a live test that
  // selected a widget and found the button never actually appeared. Exists
  // specifically for widgets that have gotten too small to grab a resize
  // handle on, or to find enough margin around to click a delete button on
  // the canvas itself. Grows 10% per click, anchored on the widget's current
  // CENTER (not its top-left corner) so it visibly grows in place rather
  // than shifting position as it expands — same snap()/clamp() helpers the
  // canvas drag-resize logic already uses, so the result always lands
  // on-grid and never pushes the widget off the canvas edge.
  box.querySelectorAll('[data-layer-expand]').forEach(x => {
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = x.dataset.layerExpand;
      const w = layoutWidgets.find(x => x.id === id);
      if (!w) return;
      snapshotLayout();
      const minSize = GRID * 2;
      const newW = clamp(snap(w.w * 1.1), minSize, 100);
      const newH = clamp(snap(w.h * 1.1), minSize, 100);
      const dw = newW - w.w, dh = newH - w.h;
      w.x = clamp(snap(w.x - dw / 2), 0, 100 - newW);
      w.y = clamp(snap(w.y - dh / 2), 0, 100 - newH);
      w.w = newW; w.h = newH;
      rebuildCanvas(); renderLayerList();
    });
  });
}

// Persist the current layout to the server immediately (used by manual save and the
// debounced auto-save). Pushes to the display in real time via the normal layout API.
async function persistLayoutNow() {
  const displayParam = currentDisplaySlug ? '?display=' + encodeURIComponent(currentDisplaySlug) : '';
  const attemptedWidgets = layoutWidgets;
  const r = await apiFetch(`/api/layouts/${layoutOrientation}${displayParam}`, {
    method: 'PUT', body: JSON.stringify({ widgets: attemptedWidgets })
  });
  if (r && r.error) {
    // Rejected (e.g. the widget limit) — revert to what the server actually has
    // rather than leaving the UI showing a widget that didn't really save, which
    // would otherwise just silently vanish next reload with no explanation.
    showToast('❌ ' + r.error);
    try {
      const fresh = await apiFetch(`/api/layouts/${layoutOrientation}${displayParam}`);
      if (fresh && Array.isArray(fresh.widgets)) { layoutWidgets = fresh.widgets; rebuildCanvas(); renderLayerList(); }
    } catch {}
  }
}

// Debounced auto-save: edits push to the display shortly after you stop moving things,
// so the wall updates in near-real-time without tapping Save. A short delay coalesces
// rapid drags/resizes into a single write.
let _autoSaveTimer = null;
// Camera widget settings-panel state (app-side mirror of display.html's own).
let _appCamForm = { open: false, editId: null, source: 'url' };
let _appCamPanelWidgetId = null;
let _appCamList = [];
let _autoSaveEnabled = false; // turned on once the Layout tab is fully loaded
function autoSaveLayout() {
  if (!_autoSaveEnabled) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => { persistLayoutNow().catch(()=>{}); }, 500);
}

function rebuildCanvas() {
  const canvas = $('editor-canvas');
  if (!canvas) return;
  canvas.innerHTML = '';
  layoutWidgets.forEach(w => canvas.appendChild(makeEditorWidget(w)));
  autoSaveLayout(); // any change that rebuilds the canvas also pushes to the display
}

function makeEditorWidget(w) {
  const def = WIDGET_DEFS.find(d => d.type === w.type) || { icon:'?', label: w.type };
  const el = document.createElement('div');
  // Full-screen background: a rendering-time-only override, deliberately never
  // touching the widget's own stored x/y/w/h — unchecking it later restores
  // exactly where it was with no restore logic needed. Behaves like a locked
  // widget for drag/resize purposes (moving/resizing would have no visible
  // effect while the override is active, which would just be confusing) but
  // isn't the SAME as being locked — gets its own badge/tooltip so it's clear
  // why, not mistaken for the person having locked it themselves.
  const fsBg = !!w.photoFullscreenBg;
  const noDragResize = w.locked || fsBg;
  el.className = 'editor-widget' + (w.id === selectedId ? ' selected' : '') + (w.locked ? ' locked' : '') + (fsBg ? ' fullscreen-bg' : '');
  el.dataset.id = w.id;
  if (fsBg) {
    el.style.left = '0%';
    el.style.top = '0%';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.zIndex = (w.id === selectedId) ? 999 : -1;
  } else {
    el.style.left   = w.x + '%';
    el.style.top    = w.y + '%';
    el.style.width  = w.w + '%';
    el.style.height = w.h + '%';
    if (w.id === selectedId) el.style.zIndex = 999;
  }
  const labelText = (w.type === 'text' && (w.textContent || '').trim())
    ? `🅰️ ${(w.textContent).trim().slice(0, 24)}${w.textContent.trim().length > 24 ? '…' : ''}`
    : `${def.icon} ${def.label}`;
  el.innerHTML = `
    <div class="w-label">${labelText.replace(/</g,'&lt;')}</div>
    ${w.locked ? `<div class="w-lock-badge" title="Position locked — unlock in settings to move or resize">🔒</div>` : ''}
    ${fsBg ? `<div class="w-lock-badge" title="Full-screen background — turn off in settings to move or resize">🖼️</div>` : ''}
    <button class="w-del" data-id="${w.id}">✕</button>
    ${noDragResize ? '' : `
    <div class="resize-handle rh-nw" data-id="${w.id}" data-corner="nw"></div>
    <div class="resize-handle rh-ne" data-id="${w.id}" data-corner="ne"></div>
    <div class="resize-handle rh-sw" data-id="${w.id}" data-corner="sw"></div>
    <div class="resize-handle rh-se" data-id="${w.id}" data-corner="se"></div>
    <div class="resize-handle rh-n" data-id="${w.id}" data-corner="n"></div>
    <div class="resize-handle rh-s" data-id="${w.id}" data-corner="s"></div>
    <div class="resize-handle rh-e" data-id="${w.id}" data-corner="e"></div>
    <div class="resize-handle rh-w" data-id="${w.id}" data-corner="w"></div>
    `}
  `;

  // Select on tap — with cycle-through for overlapping widgets. If several widgets
  // sit under the tap point, the first tap grabs the topmost; tapping the same spot
  // again steps to the next one underneath (and wraps around). This is how you reach
  // a widget hidden behind a full-screen photo without fighting the z-order.
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('w-del') || e.target.classList.contains('resize-handle')) return;
    e.preventDefault();

    // Which widgets sit under this point, topmost last.
    const stack = widgetsAtPoint(e.clientX, e.clientY);
    let target;
    if (selectedId && stack.some(s => s.id === selectedId)) {
      // The already-selected widget is under the cursor → DRAG IT. Don't cycle to
      // the one behind; cycling only happens on a tap that doesn't turn into a drag
      // (handled on pointerup below). This is what lets you grab-and-move a selected
      // widget without it jumping to the layer beneath.
      target = selectedId;
    } else {
      // Nothing selected here yet → grab the topmost widget under the point.
      target = stack.length ? stack[stack.length - 1].id : w.id;
    }
    const tw = layoutWidgets.find(x => x.id === target) || w;
    selectWidget(tw.id);
    const targetEl = document.querySelector(`.editor-widget[data-id="${tw.id}"]`) || el;
    if (!tw.locked && !tw.photoFullscreenBg) startDrag(e, tw, targetEl, 'move');

    // If this press ends WITHOUT a drag (a tap), and there are overlapping widgets,
    // cycle to the next one down so taps still let you reach covered widgets.
    const downX = e.clientX, downY = e.clientY;
    const onUp = (ev) => {
      window.removeEventListener('pointerup', onUp);
      const moved = Math.abs(ev.clientX - downX) > 4 || Math.abs(ev.clientY - downY) > 4;
      if (!moved && stack.length > 1) {
        const idx = stack.findIndex(s => s.id === selectedId);
        const next = idx === -1 ? stack[stack.length - 1].id
                                : stack[(idx - 1 + stack.length) % stack.length].id;
        if (next !== selectedId) selectWidget(next);
      }
    };
    window.addEventListener('pointerup', onUp);
  });

  // Delete
  el.querySelector('.w-del').addEventListener('click', (e) => {
    e.stopPropagation();
    snapshotLayout();
    layoutWidgets = layoutWidgets.filter(x => x.id !== w.id);
    if (selectedId === w.id) { selectedId = null; drawWidgetSettingsPanel(); }
    rebuildCanvas(); renderLayerList();
  });

  // Resize — one handle per corner, each anchoring the opposite corner in place
  el.querySelectorAll('.resize-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      startDrag(e, w, el, 'resize', handle.dataset.corner);
    });
  });

  return el;
}

function selectWidget(id) {
  selectedId = id;
  document.querySelectorAll('.editor-widget').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  document.querySelectorAll('.layer-row').forEach(row => {
    row.classList.toggle('active', row.dataset.layer === id);
  });
  drawWidgetSettingsPanel();
}

// Given a tap point (client coords) and the widget that physically received the
// event, return which widget id should be selected. When multiple widgets overlap
// the point, repeated taps cycle downward through the stack so you can reach a
// covered widget. The DOM order of .editor-widget reflects array order; later =
// visually on top (plus the selected one is bumped via z-index), so we cycle in a
// stable, predictable order.
// All widgets covering a client point, in array order (topmost last). Shared by the
// press-to-drag / tap-to-cycle logic.
function widgetsAtPoint(clientX, clientY) {
  const canvas = $('editor-canvas');
  if (!canvas) return [];
  const rect = canvas.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * 100;
  const py = ((clientY - rect.top) / rect.height) * 100;
  return layoutWidgets.filter(w =>
    px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h
  );
}

function pickWidgetAt(clientX, clientY, fallbackId) {
  const canvas = $('editor-canvas');
  if (!canvas) return fallbackId;
  const rect = canvas.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * 100;
  const py = ((clientY - rect.top) / rect.height) * 100;
  // All widgets covering the point, in array order.
  const hits = layoutWidgets.filter(w =>
    px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h
  );
  if (hits.length <= 1) return hits.length ? hits[0].id : fallbackId;
  // Cycle: if the currently selected widget is in the stack, pick the next one
  // (wrapping); otherwise start from the topmost (last in array order).
  const idx = hits.findIndex(w => w.id === selectedId);
  if (idx === -1) return hits[hits.length - 1].id;
  return hits[(idx - 1 + hits.length) % hits.length].id; // step downward through the stack
}

let cachedTodoistProjects = null; // cache so we don't refetch every time the panel redraws

async function drawWidgetSettingsPanel() {
  const _st = {};
  const panel = $('widget-settings-panel');
  if (!panel) return;
  // Any control change inside the settings panel triggers a debounced auto-save, so
  // property edits (font, color, which kids show, etc.) push to the display in real
  // time too. Attached once; survives panel re-renders since it's on the container.
  if (!panel._autoSaveBound) {
    panel.addEventListener('input', () => autoSaveLayout());
    panel.addEventListener('change', () => autoSaveLayout());
    panel._autoSaveBound = true;
  }
  const w = layoutWidgets.find(x => x.id === selectedId);
  if (_calSettingsOpenSectionForWidgetId !== selectedId) {
    _calSettingsOpenSection = null;
    _calSettingsOpenSectionForWidgetId = selectedId;
  }

  if (!w) { panel.innerHTML = ''; return; }

  const def = WIDGET_DEFS.find(d => d.type === w.type) || { icon:'?', label: w.type };
  const isCalendarWidget = w.type === 'minical' || w.type === 'upcoming' || w.type === 'today' || w.type === 'agenda';
  _st.wxSettings = null; // populated below when rendering a Weather widget; reused later when wiring its listeners

  _st.typeSpecificHtml = '';
  if (w.type === 'clock') {
    drawWidgetSettingsPanel_Build_clock({ w, _st });
  } else if (w.type === 'date') {
    const fontPx = w.dateFontPx || 24;
    const dateSettings = await apiFetch('/api/settings');
    const globalDateLabel = DATE_FORMAT_LABELS[(dateSettings && dateSettings.date_format) || 'us_long'];
    _st.typeSpecificHtml = `
      <div class="settings-row" id="date-font-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="date-font-range" min="10" max="200" step="1" value="${fontPx}">
          <span class="range-val" id="date-font-val">${fontPx}px</span>
        </div>
      </div>
      ${dateFormatOverrideRowHtml('date-format-select', w.dateFormat, globalDateLabel)}
      <p style="font-size:11px;color:var(--muted);margin-top:-8px">Sets the format for just this widget. To change the format everywhere (Agenda, Mini Calendar, Tasks due dates, etc.), use Settings → Display → Date Format instead.</p>
    `;
  } else if (w.type === 'datetime') {
    await drawWidgetSettingsPanel_Build_datetime({ w, _st });
  } else if (w.type === 'reminders') {
    const remFontPx = w.remFontPx || 22;
    const remStyle = w.remStyle || 'banner';
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Style</label>
        <select class="form-input" id="rem-style-select">
          <option value="banner" ${remStyle==='banner'?'selected':''}>Banner (soonest reminder)</option>
          <option value="list" ${remStyle==='list'?'selected':''}>List (all reminders)</option>
          <option value="hero" ${remStyle==='hero'?'selected':''}>Hero + chips</option>
          <option value="week" ${remStyle==='week'?'selected':''}>Weekly strip</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="rem-font-range" min="12" max="60" step="1" value="${remFontPx}">
          <span class="range-val" id="rem-font-val">${remFontPx}px</span>
        </div>
      </div>
      <button class="btn" id="rem-manage-btn" type="button" style="width:100%;background:rgba(74,144,217,0.15);border:1px solid var(--border);color:var(--text);margin-top:4px">🗑️ Manage Reminders</button>
      <p style="font-size:11.5px;color:var(--muted);margin:8px 0 0">Reminders are shared across every Reminders widget and the calendar — add or edit one here, it updates everywhere.</p>
    `;
  } else if (w.type === 'messageboard') {
    drawWidgetSettingsPanel_Build_messageboard({ w, _st });
  } else if (w.type === 'mealplan') {
    await drawWidgetSettingsPanel_Build_mealplan({ w, _st });
  } else if (w.type === 'flightmap') {
    await drawWidgetSettingsPanel_Build_flightmap({ w, _st });
  } else if (w.type === 'camera') {
    await drawWidgetSettingsPanel_Build_camera({ w, _st });
  } else if (w.type === 'weather' || w.type === 'weatherCurrent' || w.type === 'weatherForecast' || w.type === 'weatherHourly' || w.type === 'weatherComboForecast') {
    await drawWidgetSettingsPanel_Build_weather({ w, _st });
  } else if (w.type === 'minical') {
    await drawWidgetSettingsPanel_Build_minical({ w, _st });
  } else if (w.type === 'upcoming') {
    await drawWidgetSettingsPanel_Build_upcoming({ w, _st });
  } else if (w.type === 'today') {
    await drawWidgetSettingsPanel_Build_today({ w, _st });
  } else if (w.type === 'agenda') {
    await drawWidgetSettingsPanel_Build_agenda({ w, _st });
  } else if (w.type === 'tasks') {
    const tkScalePct = Math.round(((w.taskFontScale || 1)) * 100);
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Project</label>
        <select class="form-input" id="tasks-project-select">
          <option value="">Loading projects…</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Text Size ${infoBtn("Resizes both the list name and the task rows together.")}</label>
        <div class="range-row">
          <input type="range" id="task-font-scale" min="50" max="250" step="5" value="${tkScalePct}">
          <span class="range-val" id="task-font-scale-val">${tkScalePct}%</span>
        </div>
      </div>
    `;
  } else if (w.type === 'tasksCombined') {
    drawWidgetSettingsPanel_Build_tasksCombined({ w, _st });
  } else if (w.type === 'news') {
    const fontPx = w.newsFontPx || 13;
    const maxItems = w.newsMaxItems || 8;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="news-font-range" min="8" max="48" step="1" value="${fontPx}">
          <span class="range-val" id="news-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Headlines to Show</label>
        <div class="range-row">
          <input type="range" id="news-max-range" min="3" max="15" step="1" value="${maxItems}">
          <span class="range-val" id="news-max-val">${maxItems}</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:-4px">Top general headlines, refreshed about every 15 minutes.</p>
    `;
  } else if (w.type === 'stocks') {
    drawWidgetSettingsPanel_Build_stocks({ w, _st });
  } else if (w.type === 'photo') {
    drawWidgetSettingsPanel_Build_photo({ w, _st });
  } else if (w.type === 'todo') {
    await drawWidgetSettingsPanel_Build_todo({ w, _st });
  } else if (w.type === 'shoppinglist') {
    await drawWidgetSettingsPanel_Build_shoppinglist({ w, _st });
  } else if (w.type === 'chorechart') {
    await drawWidgetSettingsPanel_Build_chorechart({ w, _st });
  } else if (w.type === 'chorelb') {
    await drawWidgetSettingsPanel_Build_chorelb({ w, _st });
  } else if (w.type === 'countdown') {
    drawWidgetSettingsPanel_Build_countdown({ w, _st });
  } else if (w.type === 'radar') {
    drawWidgetSettingsPanel_Build_radar({ w, _st });
  } else if (w.type === 'moonphase') {
    const fontPx = w.mpFontPx || 20;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="mp-font-range" min="8" max="80" step="1" value="${fontPx}">
          <span class="range-val" id="mp-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show illumination %</label>
        <input type="checkbox" id="mp-show-illum" ${w.mpShowIllum!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show lunar cycle day ${infoBtn("Computed locally from a standard moon-cycle formula — no internet needed, works even if the Pi is offline.")}</label>
        <input type="checkbox" id="mp-show-age" ${w.mpShowAge?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
    `;
  } else if (w.type === 'airquality') {
    const fontPx = w.aqFontPx || 18;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="aq-font-range" min="8" max="72" step="1" value="${fontPx}">
          <span class="range-val" id="aq-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show UV Index</label>
        <input type="checkbox" id="aq-show-uv" ${w.aqShowUV!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Pollen</label>
        <input type="checkbox" id="aq-show-pollen" ${w.aqShowPollen!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px;cursor:pointer" onclick="showInfoPopup('aq-help')">About this data ⓘ</p>
    `;
  } else if (w.type === 'travel') {
    drawWidgetSettingsPanel_Build_travel({ w, _st });
  } else if (w.type === 'webpage') {
    drawWidgetSettingsPanel_Build_webpage({ w, _st });
  } else if (w.type === 'qrcode') {
    drawWidgetSettingsPanel_Build_qrcode({ w, _st });
  } else if (w.type === 'timer') {
    drawWidgetSettingsPanel_Build_timer({ w, _st });
  } else if (w.type === 'layoutswitcher') {
    drawWidgetSettingsPanel_Build_layoutswitcher({ w, _st });
  } else if (w.type === 'onthisday') {
    const fontPx = w.otdFontPx || 15;
    const maxItems = w.otdMaxItems || 4;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Max Items</label>
        <div class="range-row">
          <input type="range" id="otd-max-range" min="1" max="6" step="1" value="${maxItems}">
          <span class="range-val" id="otd-max-val">${maxItems}</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="otd-font-range" min="8" max="64" step="1" value="${fontPx}">
          <span class="range-val" id="otd-font-val">${fontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Historical events from Wikipedia's "On This Day" — a fresh random pick each day so it doesn't repeat the exact same facts every year.</p>
    `;
  } else if (w.type === 'dailyquote') {
    const fontPx = w.dqFontPx || 20;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="dq-font-range" min="10" max="80" step="1" value="${fontPx}">
          <span class="range-val" id="dq-font-val">${fontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">A new inspirational quote each day, with attribution.</p>
    `;
  } else if (w.type === 'sports') {
    drawWidgetSettingsPanel_Build_sports({ w, _st });
  } else if (w.type === 'metar') {
    const fontPx = w.wxFontPx || 16;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Airport (ICAO code) ${infoBtn("The 4-letter ICAO code, not the 3-letter airport code (e.g. KJFK, not JFK). <a href=\"https://www.airnav.com/airports/\" target=\"_blank\" style=\"color:var(--accent)\">Look one up</a> if you're not sure.")}</label>
        <input class="form-input" id="wx-icao" value="${escapeHtml(w.wxIcao||'')}" placeholder="e.g. KJFK" style="text-transform:uppercase" maxlength="4">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show forecast (TAF)</label>
        <input type="checkbox" id="wx-show-taf" ${w.wxShowTaf!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="wx-font-range" min="8" max="64" step="1" value="${fontPx}">
          <span class="range-val" id="wx-font-val">${fontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px;cursor:pointer" onclick="showInfoPopup('metar-help')">About this data ⓘ</p>
    `;
  } else if (w.type === 'text') {
    drawWidgetSettingsPanel_Build_text({ w, _st });
  } else if (w.type === 'decoration') {
    drawWidgetSettingsPanel_Build_decoration({ w, _st });
  } else if (w.type === 'entitystatus') {
    drawWidgetSettingsPanel_Build_entitystatus({ w, _st });
  } else if (w.type === 'smarthomeDashboard') {
    drawWidgetSettingsPanel_Build_smarthomeDashboard({ w, _st });
  } else if (w.type === 'groupcontrol') {
    drawWidgetSettingsPanel_Build_groupcontrol({ w, _st });
  }

  // Shared "Content" filters for the three calendar-data widgets: which calendars
  // to pull from, and whether to include ongoing multi-day events.
  _st.contentHtml = '';
  if (isCalendarWidget) {
    drawWidgetSettingsPanel_Build_isCalendarWidget({ w, _st });
  }

  // Text color override — available on every widget type, since washed-out text
  // over a photo background can affect any of them, not just the calendar widgets.
  const hasOverride = !!w.textColor;
  const hasOverride2 = !!w.textColor2;
  const tileOpacityVal = (w.tileOpacity !== undefined ? w.tileOpacity : 0);
  const textOpacityVal = (w.textOpacity !== undefined ? w.textOpacity : 100);
  const colorHtml = `
    <div class="settings-row">
      <label style="display:flex;justify-content:space-between;align-items:center">
        Text Color
        ${hasOverride ? `<button id="text-color-reset-btn" style="background:none;border:none;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer;padding:6px 4px">Use Default</button>` : ''}
      </label>
      <div id="widget-text-color-swatches" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <input type="color" id="widget-text-color-custom" value="${w.textColor || '#e8edf5'}"
          style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:none;cursor:pointer;padding:0">
        <span style="font-size:12px;color:var(--muted)">${hasOverride ? 'Custom color' : 'Currently using the global default'}</span>
      </div>
      <label class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
        <span>Use a different color for secondary text ${infoBtn("For widgets with more than one kind of text — like a clock's AM/PM, or a date's day-of-week vs. full date — this lets those secondary parts have their own color instead of a dimmed version of the main one.")}</span>
        <input type="checkbox" id="widget-text-color2-toggle" ${hasOverride2 ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </label>
      <div id="widget-text-color2-row" style="display:${hasOverride2 ? 'block' : 'none'};margin-top:10px">
        <div id="widget-text-color2-swatches" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
          <input type="color" id="widget-text-color2-custom" value="${w.textColor2 || '#9aa6c0'}"
            style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:none;cursor:pointer;padding:0">
          <span style="font-size:12px;color:var(--muted)">Secondary text color</span>
        </div>
      </div>
    </div>
    <div class="settings-row">
      <label>Tile Background ${infoBtn("Adds a translucent tile behind this widget so text stays readable over busy photos. 0% = no tile (fully see-through).")}</label>
      <div class="range-row">
        <input type="range" id="widget-tile-opacity-range" min="0" max="100" step="5" value="${tileOpacityVal}">
        <span class="range-val" id="widget-tile-opacity-val">${tileOpacityVal === 0 ? 'Off' : tileOpacityVal + '%'}</span>
      </div>
    </div>
    <div class="settings-row">
      <label>Text / Color Opacity ${infoBtn("Fades this widget's words and colors so the background shows through. 100% = fully solid.")}</label>
      <div class="range-row">
        <input type="range" id="widget-text-opacity-range" min="1" max="100" step="1" value="${textOpacityVal}">
        <span class="range-val" id="widget-text-opacity-val">${textOpacityVal}%</span>
      </div>
    </div>
  `;

  // Font override — available on every widget type, same "falls back to a
  // display-wide default unless this widget picks its own" pattern as the
  // color override above. The Text widget also has its own, separate font
  // picker in its type-specific settings below — that one still wins if set,
  // since it's applied directly to the text element itself rather than
  // inherited from the wrapper; this one covers every OTHER widget type,
  // which had no way to pick a font at all before now.
  const hasFontOverride = !!w.fontFamily;
  const fontHtml = `
    <div class="settings-row">
      <label style="display:flex;justify-content:space-between;align-items:center">
        Font
        ${hasFontOverride ? `<button id="widget-font-reset-btn" style="background:none;border:none;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer;padding:6px 4px">Use Default</button>` : ''}
      </label>
      <select class="form-input" id="widget-font-select">
        <option value="">${hasFontOverride ? 'Use Default' : 'Using the display default'}</option>
        ${Object.keys(FONT_CHOICES).map(f => `<option value="${f}" ${w.fontFamily === f ? 'selected' : ''}>${f}</option>`).join('')}
      </select>
    </div>
  `;

  drawWidgetSettingsPanel_Wire_panelInnerHTML({ panel, w, def, colorHtml, fontHtml, _st });

  $('widget-lock-toggle').addEventListener('change', (e) => {
    w.locked = e.target.checked;
    rebuildCanvas();
    drawWidgetSettingsPanel();
  });

  // Same expand/delete controls the layer list has, but living right here too
  // — sitting right in front of you next to the widget's own name, instead of
  // needing to scroll down to the layer list to reach them. Particularly for
  // a widget that's gotten too small to grab its own resize handles or
  // delete button directly on the canvas, this is the fastest way back.
  const panelExpandBtn = $('widget-panel-expand-btn');
  if (panelExpandBtn) panelExpandBtn.addEventListener('click', () => {
    snapshotLayout();
    const minSize = GRID * 2;
    const newW = clamp(snap(w.w * 1.1), minSize, 100);
    const newH = clamp(snap(w.h * 1.1), minSize, 100);
    const dw = newW - w.w, dh = newH - w.h;
    w.x = clamp(snap(w.x - dw / 2), 0, 100 - newW);
    w.y = clamp(snap(w.y - dh / 2), 0, 100 - newH);
    w.w = newW; w.h = newH;
    rebuildCanvas(); renderLayerList(); drawWidgetSettingsPanel();
    autoSaveLayout(); // a plain button click, not a native change/input event, so it never
                       // reaches the panel's own delegated auto-save listener — same class
                       // of gap as the photo-picker bug, found during that same audit.
  });
  const panelDelBtn = $('widget-panel-del-btn');
  if (panelDelBtn) panelDelBtn.addEventListener('click', () => {
    snapshotLayout();
    layoutWidgets = layoutWidgets.filter(x => x.id !== w.id);
    selectedId = null;
    rebuildCanvas(); renderLayerList(); drawWidgetSettingsPanel();
    autoSaveLayout(); // same gap as above — without this, a deleted widget could reappear
                       // after a refresh since the deletion itself was never persisted.
  });

  renderFineTune(w);

  // The photo widget's tag dropdown depends on window._photoTags, which is
  // otherwise only populated as a side effect of having visited the Devices tab —
  // if someone opens Layout first, ensure it independently instead of silently
  // only ever offering "All tags".
  if (w.type === 'photo' && window._photoTags === undefined) {
    ensurePhotoTagsLoaded().then(() => { if (selectedId === w.id) drawWidgetSettingsPanel(); });
  }

  renderColorSwatches('widget-text-color-swatches', 'widget-text-color-custom', w.textColor, (val) => {
    w.textColor = val;
    autoSaveLayout(); // swatches are buttons, not native inputs — see the audit note by panelExpandBtn above
    drawWidgetSettingsPanel(); // re-render so "Use Default" appears and label updates
  });
  $('widget-text-color-custom').addEventListener('input', (e) => {
    w.textColor = e.target.value;
  });
  $('widget-text-color-custom').addEventListener('change', () => {
    drawWidgetSettingsPanel(); // commit re-render once the picker closes, avoids redrawing mid-drag
  });
  if ($('text-color-reset-btn')) {
    $('text-color-reset-btn').addEventListener('click', () => {
      delete w.textColor;
      autoSaveLayout();
      drawWidgetSettingsPanel();
    });
  }

  $('widget-font-select').addEventListener('change', (e) => {
    if (e.target.value) { w.fontFamily = e.target.value; } else { delete w.fontFamily; }
    rebuildCanvas();
    drawWidgetSettingsPanel();
  });
  if ($('widget-font-reset-btn')) {
    $('widget-font-reset-btn').addEventListener('click', () => {
      delete w.fontFamily;
      autoSaveLayout();
      rebuildCanvas();
      drawWidgetSettingsPanel();
    });
  }

  $('widget-text-color2-toggle').addEventListener('change', (e) => {
    if (e.target.checked) {
      w.textColor2 = w.textColor2 || '#9aa6c0';
    } else {
      delete w.textColor2;
    }
    drawWidgetSettingsPanel();
  });
  if ($('widget-text-color2-row')) {
    renderColorSwatches('widget-text-color2-swatches', 'widget-text-color2-custom', w.textColor2, (val) => {
      w.textColor2 = val;
      autoSaveLayout();
      drawWidgetSettingsPanel();
    });
    $('widget-text-color2-custom').addEventListener('input', (e) => {
      w.textColor2 = e.target.value;
    });
    $('widget-text-color2-custom').addEventListener('change', () => {
      drawWidgetSettingsPanel();
    });
  }

  if ($('widget-tile-opacity-range')) {
    $('widget-tile-opacity-range').addEventListener('input', (e) => {
      w.tileOpacity = parseInt(e.target.value);
      $('widget-tile-opacity-val').textContent = w.tileOpacity === 0 ? 'Off' : w.tileOpacity + '%';
    });
  }
  if ($('widget-text-opacity-range')) {
    $('widget-text-opacity-range').addEventListener('input', (e) => {
      w.textOpacity = parseInt(e.target.value);
      $('widget-text-opacity-val').textContent = w.textOpacity + '%';
    });
  }

  if (w.type === 'clock') {
    drawWidgetSettingsPanel_Wire_clock({ w });
  } else if (w.type === 'date') {
    $('date-font-range').addEventListener('input', (e) => {
      w.dateFontPx = parseInt(e.target.value);
      $('date-font-val').textContent = w.dateFontPx + 'px';
    });
    if ($('date-format-select')) $('date-format-select').addEventListener('change', (e) => { w.dateFormat = e.target.value; });
  } else if (w.type === 'datetime') {
    drawWidgetSettingsPanel_Wire_datetime({ w });
  } else if (w.type === 'reminders') {
    $('rem-style-select').addEventListener('change', (e) => { w.remStyle = e.target.value; });
    $('rem-font-range').addEventListener('input', (e) => {
      w.remFontPx = parseInt(e.target.value);
      $('rem-font-val').textContent = w.remFontPx + 'px';
    });
    // Safe to re-wire every time this settings panel opens — this button is
    // part of typeSpecificHtml's own output, freshly created each time. The
    // Manage Reminders modal ITSELF is wired exactly once elsewhere in this
    // file (see wireManageRemindersModal()), same reasoning as Copy Widgets'
    // own modal earlier this session: a persistent overlay's internal
    // wiring must never live inside a function that reruns on every
    // settings-panel open, or every rerun stacks another duplicate listener
    // onto the same never-recreated DOM nodes.
    if ($('rem-manage-btn')) $('rem-manage-btn').addEventListener('click', openManageRemindersModal);
  } else if (w.type === 'messageboard') {
    $('mb-font-range').addEventListener('input', (e) => {
      w.mbFontPx = parseInt(e.target.value);
      $('mb-font-val').textContent = w.mbFontPx + 'px';
    });
    $('mb-max-range').addEventListener('input', (e) => {
      w.mbMaxNotes = parseInt(e.target.value);
      $('mb-max-val').textContent = String(w.mbMaxNotes);
    });
    $('mb-show-author').addEventListener('change', (e) => { w.mbShowAuthor = e.target.checked; });
    $('mb-show-time').addEventListener('change', (e) => { w.mbShowTime = e.target.checked; });
  } else if (w.type === 'mealplan') {
    $('mp-days-range').addEventListener('input', (e) => {
      w.mpDays = parseInt(e.target.value);
      $('mp-days-val').textContent = String(w.mpDays);
    });
    $('mp-font-range').addEventListener('input', (e) => {
      w.mpFontPx = parseInt(e.target.value);
      $('mp-font-val').textContent = w.mpFontPx + 'px';
    });
    if ($('mp-hide-empty')) $('mp-hide-empty').addEventListener('change', (e) => { w.mpHideEmpty = e.target.checked; });
    document.querySelectorAll('.mp-slot-cb').forEach(cb => cb.addEventListener('change', async () => {
      let picked = [...document.querySelectorAll('.mp-slot-cb:checked')].map(x => x.value);
      if (!picked.length) { cb.checked = true; picked = [cb.value]; }
      picked = MP_SLOTS.filter(s => picked.includes(s));
      let s = {};
      try { s = await apiFetch('/api/settings'); } catch {}
      const household = mpParseSlots(s && s.mealplan_slots);
      if (picked.length === household.length && picked.every(x => household.includes(x))) delete w.mpSlots;
      else w.mpSlots = picked;
      rebuildCanvas();
    }));
  } else if (w.type === 'flightmap') {
    drawWidgetSettingsPanel_Wire_flightmap({ w });
  } else if (w.type === 'camera') {
    drawWidgetSettingsPanel_Wire_camera({ w });
  } else if (w.type === 'weather' || w.type === 'weatherCurrent' || w.type === 'weatherForecast' || w.type === 'weatherHourly' || w.type === 'weatherComboForecast') {
    drawWidgetSettingsPanel_Wire_weather({ w });
  }

  if (w.type === 'minical') {
    drawWidgetSettingsPanel_Wire_minical({ w });
  }

  if (w.type === 'upcoming') {
    $('up-layout-select').addEventListener('change', (e) => {
      w.upLayout = e.target.value;
    });
    $('up-font-range').addEventListener('input', (e) => {
      w.upFontPx = parseInt(e.target.value);
      $('up-font-val').textContent = w.upFontPx + 'px';
    });
    $('up-show-time').addEventListener('change', (e) => { w.upShowTime = e.target.checked; });
    $('up-show-source').addEventListener('change', (e) => { w.upShowSource = e.target.checked; });
    $('up-show-notes').addEventListener('change', (e) => { w.upShowNotes = e.target.checked; });
    $('up-date-format-select').addEventListener('change', (e) => { w.upDateFormat = e.target.value; });
    if ($('up-ampm-case-select')) $('up-ampm-case-select').addEventListener('change', (e) => { w.upAmpmCase = e.target.value; });
  }

  if (w.type === 'today') {
    $('td-layout-select').addEventListener('change', (e) => {
      w.tdLayout = e.target.value;
    });
    $('td-font-range').addEventListener('input', (e) => {
      w.tdFontPx = parseInt(e.target.value);
      $('td-font-val').textContent = w.tdFontPx + 'px';
    });
    $('td-show-time').addEventListener('change', (e) => { w.tdShowTime = e.target.checked; });
    $('td-show-source').addEventListener('change', (e) => { w.tdShowSource = e.target.checked; });
    $('td-show-notes').addEventListener('change', (e) => { w.tdShowNotes = e.target.checked; });
    $('td-show-ongoing').addEventListener('change', (e) => { w.tdShowOngoing = e.target.checked; });
    $('td-date-format-select').addEventListener('change', (e) => { w.tdDateFormat = e.target.value; });
    if ($('td-ampm-case-select')) $('td-ampm-case-select').addEventListener('change', (e) => { w.tdAmpmCase = e.target.value; });
  }

  if (w.type === 'agenda') {
    $('ag-layout-select').addEventListener('change', (e) => {
      w.agLayout = e.target.value;
    });
    $('ag-days-range').addEventListener('input', (e) => {
      w.agDays = parseInt(e.target.value);
      $('ag-days-val').textContent = w.agDays;
    });
    $('ag-font-range').addEventListener('input', (e) => {
      w.agFontPx = parseInt(e.target.value);
      $('ag-font-val').textContent = w.agFontPx + 'px';
    });
    $('ag-show-time').addEventListener('change', (e) => { w.agShowTime = e.target.checked; });
    $('ag-show-source').addEventListener('change', (e) => { w.agShowSource = e.target.checked; });
    $('ag-show-notes').addEventListener('change', (e) => { w.agShowNotes = e.target.checked; });
    $('ag-show-ongoing').addEventListener('change', (e) => { w.agShowOngoing = e.target.checked; });
    if ($('ag-show-reminders')) $('ag-show-reminders').addEventListener('change', (e) => { w.agShowReminders = e.target.checked; });
    $('ag-date-format-select').addEventListener('change', (e) => { w.agDateFormat = e.target.value; });
    if ($('ag-ampm-case-select')) $('ag-ampm-case-select').addEventListener('change', (e) => { w.agAmpmCase = e.target.value; });
  }

  if (w.type === 'tasks') {
    populateTasksProjectDropdown(w);
    if ($('task-font-scale')) {
      $('task-font-scale').addEventListener('input', (e) => {
        w.taskFontScale = parseInt(e.target.value) / 100;
        $('task-font-scale-val').textContent = e.target.value + '%';
      });
    }
  }

  if (w.type === 'tasksCombined') {
    populateTasksCombinedProjectList(w);
    $('tc-align-select').addEventListener('change', (e) => {
      w.tcAlign = e.target.value;
    });
    $('tc-font-range').addEventListener('input', (e) => {
      w.tcFontPx = parseInt(e.target.value);
      $('tc-font-val').textContent = w.tcFontPx + 'px';
    });
    $('tc-show-due').addEventListener('change', (e) => { w.tcShowDue = e.target.checked; });
  }

  if (w.type === 'todo') {
    if ($('td-list-select')) $('td-list-select').addEventListener('change', (e) => {
      w.listId = e.target.value ? parseInt(e.target.value) : null;
    });
    if ($('td-title')) $('td-title').addEventListener('input', (e) => { w.todoTitle = e.target.value; });
    if ($('td-font-range')) $('td-font-range').addEventListener('input', (e) => {
      w.todoFontPx = parseInt(e.target.value);
      $('td-font-val').textContent = w.todoFontPx + 'px';
    });
    if ($('td-showdone')) $('td-showdone').addEventListener('change', (e) => { w.todoShowDone = e.target.checked; });
  }

  if (w.type === 'shoppinglist') {
    if ($('sl-list-select')) $('sl-list-select').addEventListener('change', (e) => { w.shoppingListId = parseInt(e.target.value); });
    if ($('sl-title')) $('sl-title').addEventListener('input', (e) => { w.shoppingTitle = e.target.value; });
    if ($('sl-font-range')) $('sl-font-range').addEventListener('input', (e) => {
      w.shoppingFontPx = parseInt(e.target.value);
      $('sl-font-val').textContent = w.shoppingFontPx + 'px';
    });
    if ($('sl-showdone')) $('sl-showdone').addEventListener('change', (e) => { w.shoppingShowDone = e.target.checked; });
    if ($('sl-autofit')) $('sl-autofit').addEventListener('change', (e) => { w.shoppingAutoFit = e.target.checked; });
  }

  if (w.type === 'chorechart') {
    if ($('cc-title')) $('cc-title').addEventListener('input', (e) => { w.choreTitle = e.target.value; });
    if ($('cc-font-range')) $('cc-font-range').addEventListener('input', (e) => {
      w.choreFontPx = parseInt(e.target.value);
      $('cc-font-val').textContent = w.choreFontPx + 'px';
    });
    if ($('cc-showdone')) $('cc-showdone').addEventListener('change', (e) => { w.choreShowDone = e.target.checked; });
    if ($('cc-showstickers')) $('cc-showstickers').addEventListener('change', (e) => { w.choreShowStickers = e.target.checked; });
    if ($('cc-showbonus')) $('cc-showbonus').addEventListener('change', (e) => { w.choreShowBonus = e.target.checked; });
    const picks = document.querySelectorAll('.cc-kid-pick');
    const syncKidSel = () => {
      const all = [...picks];
      const checked = all.filter(c => c.checked).map(c => c.value);
      // If everyone is checked, store null (= all, future-proof for new kids).
      w.choreKidIds = (checked.length === all.length) ? null : checked;
    };
    picks.forEach(c => c.addEventListener('change', syncKidSel));
  }

  if (w.type === 'chorelb') {
    if ($('lb-title')) $('lb-title').addEventListener('input', (e) => { w.lbTitle = e.target.value; });
    if ($('lb-rankby')) $('lb-rankby').addEventListener('change', (e) => { w.lbRankBy = e.target.value; });
    if ($('lb-font-range')) $('lb-font-range').addEventListener('input', (e) => {
      w.lbFontPx = parseInt(e.target.value);
      $('lb-font-val').textContent = w.lbFontPx + 'px';
    });
    const lbPicks = document.querySelectorAll('.lb-kid-pick');
    const syncLbKidSel = () => {
      const all = [...lbPicks];
      const checked = all.filter(c => c.checked).map(c => c.value);
      w.lbKidIds = (checked.length === all.length) ? null : checked;
    };
    lbPicks.forEach(c => c.addEventListener('change', syncLbKidSel));
  }

  if (w.type === 'countdown') {
    if ($('cd-title')) $('cd-title').addEventListener('input', (e) => { w.cdTitle = e.target.value; });
    if ($('cd-date')) $('cd-date').addEventListener('change', (e) => { w.cdDate = e.target.value; });
    if ($('cd-time')) $('cd-time').addEventListener('change', (e) => { w.cdTime = e.target.value; });
    if ($('cd-repeat')) $('cd-repeat').addEventListener('change', (e) => { w.cdRepeatYearly = e.target.checked; });
    if ($('cd-font-range')) $('cd-font-range').addEventListener('input', (e) => {
      w.cdFontPx = parseInt(e.target.value);
      $('cd-font-val').textContent = w.cdFontPx + 'px';
    });
  }

  if (w.type === 'radar') {
    drawWidgetSettingsPanel_Wire_radar({ w });
  }

  if (w.type === 'moonphase') {
    if ($('mp-font-range')) $('mp-font-range').addEventListener('input', (e) => {
      w.mpFontPx = parseInt(e.target.value);
      $('mp-font-val').textContent = w.mpFontPx + 'px';
    });
    if ($('mp-show-illum')) $('mp-show-illum').addEventListener('change', (e) => { w.mpShowIllum = e.target.checked; });
    if ($('mp-show-age')) $('mp-show-age').addEventListener('change', (e) => { w.mpShowAge = e.target.checked; });
  }

  if (w.type === 'airquality') {
    if ($('aq-font-range')) $('aq-font-range').addEventListener('input', (e) => {
      w.aqFontPx = parseInt(e.target.value);
      $('aq-font-val').textContent = w.aqFontPx + 'px';
    });
    if ($('aq-show-uv')) $('aq-show-uv').addEventListener('change', (e) => { w.aqShowUV = e.target.checked; });
    if ($('aq-show-pollen')) $('aq-show-pollen').addEventListener('change', (e) => { w.aqShowPollen = e.target.checked; });
  }

  if (w.type === 'travel') {
    if ($('tv-label')) $('tv-label').addEventListener('input', (e) => { w.travelLabel = e.target.value; });
    if ($('tv-origin')) $('tv-origin').addEventListener('input', (e) => { w.travelOrigin = e.target.value; });
    if ($('tv-destination')) $('tv-destination').addEventListener('input', (e) => { w.travelDestination = e.target.value; });
    if ($('tv-mode')) $('tv-mode').addEventListener('change', (e) => { w.travelMode = e.target.value; });
    if ($('tv-font-range')) $('tv-font-range').addEventListener('input', (e) => {
      w.travelFontPx = parseInt(e.target.value);
      $('tv-font-val').textContent = w.travelFontPx + 'px';
    });
  }

  if (w.type === 'webpage') {
    if ($('wp-url')) $('wp-url').addEventListener('input', (e) => {
      w.wpUrl = e.target.value.trim();
      const hint = $('wp-url-hint');
      if (hint) hint.textContent = (w.wpUrl && !wpUrlOk(w.wpUrl)) ? 'That is not a web address. It has to start with http:// or https://' : 'Starts with http:// or https://';
    });
    if ($('wp-title')) $('wp-title').addEventListener('input', (e) => { w.wpTitle = e.target.value; });
    if ($('wp-keep-login')) $('wp-keep-login').addEventListener('change', (e) => { w.wpKeepLogin = e.target.checked; });
    if ($('wp-refresh')) $('wp-refresh').addEventListener('change', (e) => { w.wpRefreshMin = parseInt(e.target.value, 10) || 0; });
    [['wp-zoom', 'wpZoom', '%'], ['wp-scroll-y', 'wpScrollY', 'px']].forEach(([id, key, unit]) => {
      if ($(id)) $(id).addEventListener('input', (e) => { w[key] = parseInt(e.target.value, 10) || 0; $(id + '-val').textContent = w[key] + unit; });
    });
  }

  if (w.type === 'qrcode') {
    if ($('qr-title')) $('qr-title').addEventListener('input', (e) => { w.qrTitle = e.target.value; });
    if ($('qr-size-range')) $('qr-size-range').addEventListener('input', (e) => {
      w.qrSizePx = parseInt(e.target.value);
      $('qr-size-val').textContent = w.qrSizePx + 'px';
    });
    if ($('qr-preset')) $('qr-preset').addEventListener('change', (e) => {
      w.qrPreset = e.target.value;
      $('qr-text-row').style.display = w.qrPreset === 'text' ? 'block' : 'none';
      $('qr-wifi-rows').style.display = w.qrPreset === 'wifi' ? 'block' : 'none';
    });
    if ($('qr-content')) $('qr-content').addEventListener('input', (e) => { w.qrContent = e.target.value; });
    if ($('qr-ssid')) $('qr-ssid').addEventListener('input', (e) => { w.qrSSID = e.target.value; });
    if ($('qr-password')) $('qr-password').addEventListener('input', (e) => { w.qrPassword = e.target.value; });
    if ($('qr-encryption')) $('qr-encryption').addEventListener('change', (e) => { w.qrEncryption = e.target.value; });
    if ($('qr-font-range')) $('qr-font-range').addEventListener('input', (e) => {
      w.qrFontPx = parseInt(e.target.value);
      $('qr-font-val').textContent = w.qrFontPx + 'px';
    });
  }

  if (w.type === 'timer') {
    drawWidgetSettingsPanel_Wire_timer({ w });
  }

  if (w.type === 'layoutswitcher') {
    drawWidgetSettingsPanel_Wire_layoutswitcher({ w });
  }

  if (w.type === 'onthisday') {
    if ($('otd-max-range')) $('otd-max-range').addEventListener('input', (e) => {
      w.otdMaxItems = parseInt(e.target.value);
      $('otd-max-val').textContent = w.otdMaxItems;
    });
    if ($('otd-font-range')) $('otd-font-range').addEventListener('input', (e) => {
      w.otdFontPx = parseInt(e.target.value);
      $('otd-font-val').textContent = w.otdFontPx + 'px';
    });
  }

  if (w.type === 'dailyquote') {
    if ($('dq-font-range')) $('dq-font-range').addEventListener('input', (e) => {
      w.dqFontPx = parseInt(e.target.value);
      $('dq-font-val').textContent = w.dqFontPx + 'px';
    });
  }

  if (w.type === 'sports') {
    drawWidgetSettingsPanel_Wire_sports({ w });
  }

  if (w.type === 'metar') {
    if ($('wx-icao')) $('wx-icao').addEventListener('input', (e) => {
      w.wxIcao = e.target.value.trim().toUpperCase();
    });
    if ($('wx-show-taf')) $('wx-show-taf').addEventListener('change', (e) => { w.wxShowTaf = e.target.checked; });
    if ($('wx-font-range')) $('wx-font-range').addEventListener('input', (e) => {
      w.wxFontPx = parseInt(e.target.value);
      $('wx-font-val').textContent = w.wxFontPx + 'px';
    });
  }

  if (w.type === 'news') {
    $('news-font-range').addEventListener('input', (e) => {
      w.newsFontPx = parseInt(e.target.value);
      $('news-font-val').textContent = w.newsFontPx + 'px';
    });
    $('news-max-range').addEventListener('input', (e) => {
      w.newsMaxItems = parseInt(e.target.value);
      $('news-max-val').textContent = w.newsMaxItems;
    });
  }

  if (w.type === 'stocks') {
    drawWidgetSettingsPanel_Wire_stocks({ w });
  } else if (w.type === 'photo') {
    drawWidgetSettingsPanel_Wire_photo({ w });
  } else if (w.type === 'text') {
    drawWidgetSettingsPanel_Wire_text({ w });
  } else if (w.type === 'decoration') {
    drawWidgetSettingsPanel_Wire_decoration({ w });
  } else if (w.type === 'entitystatus') {
    if ($('ha-entity-picker-btn')) {
      $('ha-entity-picker-btn').addEventListener('click', () => openEntityPicker(w));
    }
    if ($('ha-label-input')) {
      // Typing here directly makes this a genuine custom label — clear the
      // auto-fill tracker so a future entity swap (see openEntityPicker())
      // never silently overwrites what was just typed.
      $('ha-label-input').addEventListener('input', (e) => { w.haLabel = e.target.value; w.haLabelAutoFor = ''; });
    }
    if ($('ha-align-select')) {
      $('ha-align-select').addEventListener('change', (e) => { w.haAlign = e.target.value; });
    }
    if ($('ha-show-unit')) {
      $('ha-show-unit').addEventListener('change', (e) => { w.haShowUnit = e.target.checked; });
    }
    if ($('ha-template-input')) $('ha-template-input').addEventListener('input', (e) => { w.haTemplate = e.target.value; });
    // the helper under the box: insert buttons, recipes, live preview and plain-English errors (public/js/shared/ha-template-builder.js)
    if ($('ha-template-tools') && window.HaTemplateBuilder) HaTemplateBuilder.mount({
      box: $('ha-template-input'), host: $('ha-template-tools'),
      getEntities: () => apiFetch('/api/ha/entities'),
      getAttributes: (id) => apiFetch('/api/ha/entity-details/' + encodeURIComponent(id)),     // the Inspect button (needs the app login, so not offered on the display)
      preview: (template) => apiFetch('/api/ha/template', { method: 'POST', body: JSON.stringify({ template }) }),
    });
    if ($('ha-show-since')) {
      $('ha-show-since').addEventListener('change', (e) => { w.haShowSince = e.target.checked; });
    }
    if ($('ha-show-sparkline')) {
      $('ha-show-sparkline').addEventListener('change', (e) => { w.haShowSparkline = e.target.checked; });
    }
    if ($('ha-font-range')) {
      $('ha-font-range').addEventListener('input', (e) => {
        w.haFontPx = parseInt(e.target.value);
        $('ha-font-val').textContent = w.haFontPx + 'px';
      });
    }
  } else if (w.type === 'smarthomeDashboard') {
    drawWidgetSettingsPanel_Wire_smarthomeDashboard({ w });
  } else if (w.type === 'groupcontrol') {
    drawWidgetSettingsPanel_Wire_groupcontrol({ w });
  }

  if (isCalendarWidget) {
    populateSourceFilterList(w);
    populateFeedOpacityOverrideList(w);
    populateFeedLocationOverrideList(w);
    $('show-multiday-toggle').addEventListener('change', (e) => {
      w.showMultiDay = e.target.checked;
    });
    if ($('show-location-toggle')) {
      $('show-location-toggle').addEventListener('change', (e) => {
        const k = { minical: 'calShowLocation', agenda: 'agShowLocation', upcoming: 'upShowLocation', today: 'tdShowLocation' }[w.type];
        if (k) w[k] = e.target.checked;
        autoSaveLayout();
      });
    }
    wireAccordion('flo-accordion-wrap');
    // Per-Feed Opacity now uses the same shared accordion mechanism as
    // everything else (Displays/Settings, Mini Calendar's own settings
    // groups below) instead of a hand-rolled one-off toggle. It's the only
    // section inside its own container, so wireAccordion()'s "collapse the
    // others" behavior is a no-op here — there's nothing else to collapse
    // — but it's the same component either way, not a special case.
    wireAccordion('fop-accordion-wrap');
  }

  $('layer-front-btn').addEventListener('click', () => { bringToFront(w); });
  $('layer-back-btn').addEventListener('click', () => { sendToBack(w); });
  $('layer-up-btn').addEventListener('click', () => { moveLayer(w, 1); });
  $('layer-down-btn').addEventListener('click', () => { moveLayer(w, -1); });
}

