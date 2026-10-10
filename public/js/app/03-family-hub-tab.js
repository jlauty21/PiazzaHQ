// ── Family Hub tab (Chores/To-Do/Shopping subtabs) ──────────────────────────
// Chores/To-Do/Shopping used to each be their own top-level tab; consolidated
// into one "Family Hub" tab with subtabs, to cut down the number of tabs
// competing for space up top. renderChoresTab()/renderTodoTab()/
// renderShoppingTab() below are unchanged and still fully replace #content's
// innerHTML themselves (that's how they always worked) — so rather than
// rewrite all three to render into a sub-container, the subtab bar is
// prepended AFTER whichever one runs, via insertAdjacentHTML. Lower-risk
// than restructuring three large existing render functions.
let familySubtab = 'chores';
async function renderFamilyHubTab() {
  try { familySubtab = localStorage.getItem('family_hub_subtab') || 'chores'; } catch {}
  const enabled = {
    chores: window._choresEnabled !== false,
    todo: !!window._todoEnabled,
    shopping: !!window._shoppingEnabled,
    reminders: window._remindersEnabled !== false,
    board: !!window._messageboardEnabled,
    meals: !!window._mealplanEnabled,
  };
  if (!enabled[familySubtab]) {
    familySubtab = ['chores', 'todo', 'shopping', 'reminders', 'board', 'meals'].find(t => enabled[t]) || 'chores';
  }
  await renderFamilySubtab(familySubtab, enabled);
}
async function renderFamilySubtab(subtab, enabled) {
  familySubtab = subtab;
  try { localStorage.setItem('family_hub_subtab', subtab); } catch {}
  if (subtab === 'todo') await renderTodoTab();
  else if (subtab === 'shopping') await renderShoppingTab();
  else if (subtab === 'reminders') await renderRemindersFamilyTab();
  else if (subtab === 'board') await renderBoardFamilyTab();
  else if (subtab === 'meals') await renderMealsFamilyTab();
  else await renderChoresTab();

  enabled = enabled || {
    chores: window._choresEnabled !== false,
    todo: !!window._todoEnabled,
    shopping: !!window._shoppingEnabled,
    reminders: window._remindersEnabled !== false,
    board: !!window._messageboardEnabled,
    meals: !!window._mealplanEnabled,
  };
  const content = $('content');
  content.insertAdjacentHTML('afterbegin', `
    <div class="family-subtabbar">
      <button class="family-subtab ${subtab === 'chores' ? 'active' : ''}" data-subtab="chores" style="display:${enabled.chores ? '' : 'none'}">🧹 Chores</button>
      <button class="family-subtab ${subtab === 'todo' ? 'active' : ''}" data-subtab="todo" style="display:${enabled.todo ? '' : 'none'}">✅ To-Do</button>
      <button class="family-subtab ${subtab === 'shopping' ? 'active' : ''}" data-subtab="shopping" style="display:${enabled.shopping ? '' : 'none'}">🛒 Shopping</button>
      <button class="family-subtab ${subtab === 'reminders' ? 'active' : ''}" data-subtab="reminders" style="display:${enabled.reminders ? '' : 'none'}">🗑️ Reminders</button>
      <button class="family-subtab ${subtab === 'board' ? 'active' : ''}" data-subtab="board" style="display:${enabled.board ? '' : 'none'}">📝 Board</button>
      <button class="family-subtab ${subtab === 'meals' ? 'active' : ''}" data-subtab="meals" style="display:${enabled.meals ? '' : 'none'}">🍽️ Meals</button>
    </div>`);
  content.querySelectorAll('.family-subtab').forEach(btn => {
    btn.addEventListener('click', () => renderFamilySubtab(btn.dataset.subtab, enabled));
  });
}
// Shared by the settings-save handler and the initial page load (previously
// duplicated per-tab logic in both places, once for each of the three now-
// merged tabs) — updates the enabled-feature globals, shows/hides the whole
// Family Hub tab (only when NONE of the three are enabled — same "don't
// show a door to nothing" principle as the Family Hub app's own Home tab),
// and if currently viewing Family Hub with a subtab that just got disabled,
// re-renders onto whichever subtab is still available.
function updateFamilyHubVisibility(s) {
  s = s || {};
  window._choresEnabled = s.chores_enabled !== '0';
  window._todoEnabled = s.todo_enabled === '1';
  window._shoppingEnabled = s.shopping_enabled === '1';
  window._remindersEnabled = s.reminders_enabled !== '0';
  window._messageboardEnabled = s.messageboard_enabled === '1';
  window._mealplanEnabled = s.mealplan_enabled === '1';
  window._flightmapEnabled = s.flightmap_enabled === '1';
  const enabled = { chores: window._choresEnabled, todo: window._todoEnabled, shopping: window._shoppingEnabled, reminders: window._remindersEnabled, board: window._messageboardEnabled, meals: window._mealplanEnabled };
  const anyEnabled = enabled.chores || enabled.todo || enabled.shopping || enabled.reminders || enabled.board || enabled.meals;
  const familyTabEl = document.getElementById('tab-family');
  if (familyTabEl) {
    familyTabEl.style.display = anyEnabled ? '' : 'none';
    if (!anyEnabled && familyTabEl.classList.contains('active')) {
      const calTab = document.querySelector('.tab[data-tab="calendars"]');
      if (calTab) calTab.click();
    } else if (familyTabEl.classList.contains('active') && !enabled[familySubtab]) {
      renderFamilySubtab(['chores', 'todo', 'shopping', 'reminders', 'board', 'meals'].find(t => enabled[t]), enabled);
    }
  }
}

// ── Getting-started checklist ──────────────────────────────────────────────
// Self-paced companion to the spotlight tour above — a few deeper, optional
// actions someone can tackle whenever, at their own pace, rather than
// crammed into a tour they'd likely click through without reading. Lives at
// the top of the Calendar tab (the default landing spot), host-only, and
// fully dismissible. Every item is tracked by explicit action (clicking "Go"
// or the checkmark itself) rather than inferring completion from possibly-
// stale or not-yet-loaded app data, which would be more fragile than useful.
const CHECKLIST_ITEMS = [
  { id: 'event',  label: 'Add your first event',           tab: 'calendars' },
  { id: 'theme',  label: 'Pick a theme',                    tab: 'layout' },
  { id: 'layout', label: 'Customize your layout',           tab: 'layout' },
  { id: 'remote', label: 'Set up remote access (optional)', tab: 'settings' },
];

function getChecklistDoneSet(doneStr) {
  return new Set((doneStr || '').split(',').filter(Boolean));
}

async function checklistCardHtml() {
  let s;
  try { s = await apiFetch('/api/settings'); } catch { return ''; }
  if (!s) return '';
  if (s.checklist_dismissed === '1') return '';
  if ((s.device_role || 'host') !== 'host') return '';
  const doneSet = getChecklistDoneSet(s.checklist_done);
  if (CHECKLIST_ITEMS.every(i => doneSet.has(i.id))) return ''; // nothing left to show

  return `<div class="getting-started-card" id="getting-started-card">
    <div class="gs-header">
      <span>Getting started</span>
      <button class="gs-dismiss" id="gs-dismiss" aria-label="Dismiss">×</button>
    </div>
    ${CHECKLIST_ITEMS.map(i => {
      const done = doneSet.has(i.id);
      return `<div class="gs-item${done ? ' done' : ''}">
        <span class="gs-check" data-toggle-id="${i.id}">✓</span>
        <span class="gs-label">${i.label}</span>
        ${done ? '' : `<button class="gs-go" data-go-tab="${i.tab}" data-go-id="${i.id}">Go</button>`}
      </div>`;
    }).join('')}
  </div>`;
}

async function toggleChecklistItem(id, forceDone) {
  let s;
  try { s = await apiFetch('/api/settings'); } catch { s = {}; }
  const doneSet = getChecklistDoneSet(s && s.checklist_done);
  if (forceDone === undefined) { doneSet.has(id) ? doneSet.delete(id) : doneSet.add(id); }
  else if (forceDone) doneSet.add(id); else doneSet.delete(id);
  const value = Array.from(doneSet).join(',');
  try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ checklist_done: value }) }); } catch {}
}

async function dismissChecklist() {
  try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ checklist_dismissed: '1' }) }); } catch {}
}

function wireChecklistCard() {
  const card = document.getElementById('getting-started-card');
  if (!card) return;
  card.querySelectorAll('[data-toggle-id]').forEach(el => {
    el.addEventListener('click', async () => {
      await toggleChecklistItem(el.dataset.toggleId);
      renderCalendarTab(); // re-render so the card reflects the change (or disappears once all done/dismissed)
    });
  });
  card.querySelectorAll('[data-go-tab]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleChecklistItem(btn.dataset.goId, true);
      const targetTab = document.querySelector(`.tab[data-tab="${btn.dataset.goTab}"]`);
      if (targetTab) targetTab.click();
    });
  });
  if ($('gs-dismiss')) $('gs-dismiss').addEventListener('click', async () => {
    await dismissChecklist();
    renderCalendarTab();
  });
}

// ── Calendar tab (Events + Calendar Feeds, as sub-tabs) ──────────────────────
// Merged from two separate top-level tabs into one, with a small sub-tab bar —
// they're both calendar-data concerns (viewing/managing events vs. managing the
// feeds those events come from), and having them as two adjacent top-level tabs
// read as more of an artificial split than a real one.
let calendarSubTab = 'feeds'; // 'events' | 'feeds' — Calendar Feeds is the more
// commonly-needed starting point (adding/managing the actual sources events
// come from), and this default only matters on first load anyway — switching
// sub-tabs during a session just changes the variable, doesn't persist.
async function renderCalendarTab() {
  const checklistHtml = await checklistCardHtml();
  $('content').innerHTML = `
    <div class="subtab-bar">
      <button class="subtab-btn${calendarSubTab==='feeds'?' active':''}" data-subtab="feeds">Calendar Feeds</button>
      <button class="subtab-btn${calendarSubTab==='events'?' active':''}" data-subtab="events">Events</button>
    </div>
    ${checklistHtml}
    <div id="calendar-subtab-content"></div>
  `;
  wireChecklistCard();
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (calendarSubTab === btn.dataset.subtab) return;
      calendarSubTab = btn.dataset.subtab;
      await renderCalendarTab();
      // renderCalendarTab() just replaced #content's innerHTML wholesale, but
      // the element itself is the same node — its scroll position carries
      // over from whatever it was in the PREVIOUS sub-tab. If that was
      // scrolled down (e.g. partway through a long feed list), the new
      // sub-tab's content — including the sub-tab bar itself — could open
      // already scrolled past the top of the viewport, looking like it
      // "disappeared" rather than actually being there above the fold.
      // Awaiting renderCalendarTab() above matters here: it's what actually
      // replaces the content and (for Events) triggers its own internal
      // scroll-to-today behavior — resetting scroll before that finished
      // just got silently overwritten a moment later.
      const contentEl = $('content');
      if (contentEl) contentEl.scrollTop = 0;
    });
  });
  if (calendarSubTab === 'events') await renderEventsSubTab();
  else await renderCalendarsSubTab();
}

// ── Events sub-tab ────────────────────────────────────────────────────────────
// A searchable list of upcoming events from all sources. Each event can be hidden
// from the displays — a single occurrence, or (for recurring events) all future
// occurrences. Hidden events stay listed here (dimmed) so they can be restored.
let _eventsCache = [];
async function renderEventsSubTab() {
  $('calendar-subtab-content').innerHTML = `
    <div class="events-sticky-header">
      <input class="form-input" id="events-search" placeholder="🔍 Search events…" autocomplete="off">
      <div style="display:flex;gap:18px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <label style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="events-show-hidden" style="width:18px;height:18px;accent-color:var(--accent)"> Show hidden
        </label>
        <label style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="events-show-past" style="width:18px;height:18px;accent-color:var(--accent)"> Show past
        </label>
        ${(PROFILES.length && activeProfile) ? `
        <label style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="events-mine-only" style="width:18px;height:18px;accent-color:var(--accent)"> ${escapeHtml(activeProfile.name)} only
        </label>` : ''}
      </div>
    </div>
    <div id="events-list"><div style="color:var(--muted);font-size:13px;padding:8px">Loading events…</div></div>
  `;
  $('events-search').addEventListener('input', () => renderEventsList());
  $('events-show-hidden').addEventListener('change', () => renderEventsList());
  $('events-show-past').addEventListener('change', () => loadEventsManage());
  if ($('events-mine-only')) {
    try { $('events-mine-only').checked = localStorage.getItem('events_mine_only') === '1'; } catch {}
    $('events-mine-only').addEventListener('change', () => {
      try { localStorage.setItem('events_mine_only', $('events-mine-only').checked ? '1' : '0'); } catch {}
      renderEventsList();
    });
  }
  await loadEventsManage();
}

// Fetches the manage-list, optionally including up to 2 years of past events.
let _eventsScrollToToday = false;
async function loadEventsManage() {
  _eventsScrollToToday = true; // anchor the view on today after this (re)load
  const box = $('events-list');
  if (box) box.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">Loading events…</div>`;
  const showPast = $('events-show-past')?.checked;
  let url = '/api/events-manage';
  if (showPast) {
    // ~2 years back so a full history is browsable.
    const d = new Date(); d.setDate(d.getDate() - 730);
    const from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    url += `?from=${from}`;
  }
  try {
    _eventsCache = await apiFetch(url);
  } catch { _eventsCache = []; }
  renderEventsList();
}

function renderEventsList() {
  const box = $('events-list');
  if (!box) return;
  const q = ($('events-search')?.value || '').trim().toLowerCase();
  const showHidden = $('events-show-hidden')?.checked;
  const mineOnly = $('events-mine-only')?.checked && activeProfile;
  let list = _eventsCache.slice();
  if (q) list = list.filter(e => (e.title || '').toLowerCase().includes(q) || (e.feed_name || '').toLowerCase().includes(q));
  if (mineOnly) list = list.filter(e => Number(e.owner_profile_id) === Number(activeProfile.id));

  // Group by date for readability.
  const visible = list.filter(e => showHidden || !(e.hidden_series || e.hidden_occurrence));
  if (!visible.length) {
    box.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:14px;text-align:center">${q ? 'No matching events.' : 'No upcoming events.'}</div>`;
    return;
  }
  const byDate = {};
  visible.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });

  const todayStr = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
  const sortedDates = Object.keys(byDate).sort();
  // The first date that is today or later — we anchor the scroll here so checking
  // "Show past" keeps the view on the current date, with older dates above to scroll up to.
  const anchorDate = sortedDates.find(d => d >= todayStr);

  box.innerHTML = sortedDates.map(date => {
    const d = new Date(date + 'T00:00:00');
    const dateLabel = d.toLocaleDateString((window.i18n && i18n.lang) || undefined, { weekday:'short', month:'short', day:'numeric' });
    const isAnchor = date === anchorDate;
    const rows = byDate[date].map(e => {
      const isHidden = e.hidden_series || e.hidden_occurrence;
      const time = e.start_time ? fmtTime(e.start_time) : 'All day';
      const owner = e.owner_profile_id != null ? profileById(e.owner_profile_id) : null;
      const dotColor = owner ? owner.color : e.color;
      const dot = dotColor ? `<span title="${owner ? escapeHtml(owner.name) : ''}" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>` : '';
      const tags = [];
      if (owner) tags.push(`<span style="font-size:10px;color:var(--muted)">${escapeHtml(owner.name)}</span>`);
      if (e.location && (e.source === 'local' || e.show_location)) tags.push(`<span style="font-size:10px;color:var(--muted)">📍 ${escapeHtml(e.location)}</span>`);
      if (e.hidden_series) tags.push('<span style="font-size:10px;color:var(--danger,#ff5d5d)">hidden (all)</span>');
      else if (e.hidden_occurrence) tags.push('<span style="font-size:10px;color:var(--danger,#ff5d5d)">hidden</span>');
      if (e.feed_name) tags.push(`<span style="font-size:10px;color:var(--muted)">${e.feed_name}</span>`);

      // Action buttons depend on current state + whether it's recurring.
      let actions = '';
      if (isHidden) {
        actions = `<button class="ev-action" data-act="show" data-key="${e.event_key}" data-date="${e.date}">Show</button>`;
      } else if (e.recurring) {
        actions = `
          <button class="ev-action" data-act="hide-occ" data-key="${e.event_key}" data-date="${e.date}" data-title="${(e.title||'').replace(/"/g,'&quot;')}">Hide this</button>
          <button class="ev-action danger" data-act="hide-series" data-key="${e.event_key}" data-title="${(e.title||'').replace(/"/g,'&quot;')}">Hide all</button>`;
      } else {
        actions = `<button class="ev-action" data-act="hide-occ" data-key="${e.event_key}" data-date="${e.date}" data-title="${(e.title||'').replace(/"/g,'&quot;')}">Hide</button>`;
      }
      return `
        <div class="ev-manage-row${isHidden ? ' dimmed' : ''}">
          <div style="display:flex;align-items:center;gap:9px;flex:1;min-width:0">
            ${dot}
            <div style="min-width:0">
              <div class="ev-manage-title">${(e.title||'(untitled)')}</div>
              <div class="ev-manage-sub">${time}${tags.length ? ' · ' + tags.join(' · ') : ''}</div>
            </div>
          </div>
          <div class="ev-manage-actions">${actions}</div>
        </div>`;
    }).join('');
    return `<div class="ev-date-group"${isAnchor ? ' id="ev-today-anchor"' : ''}><div class="ev-date-label">${dateLabel}</div>${rows}</div>`;
  }).join('');

  // Keep the view anchored on the current date so turning on "Show past" doesn't
  // jump to two years ago — past dates sit above, reachable by scrolling up. Only
  // do this on a fresh (re)load, not after a hide/show action, so we don't yank the
  // user back to today while they're reading older entries.
  if (_eventsScrollToToday) {
    _eventsScrollToToday = false;
    const anchorEl = document.getElementById('ev-today-anchor');
    if (anchorEl) anchorEl.scrollIntoView({ block: 'start' });
  }

  // Wire action buttons.
  box.querySelectorAll('.ev-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { act, key, date, title } = btn.dataset;
      if (act === 'show') {
        await apiFetch('/api/hidden-events', { method:'DELETE', body: JSON.stringify({ event_key: key }) });
        showToast('Event restored');
      } else if (act === 'hide-occ') {
        await apiFetch('/api/hidden-events', { method:'POST', body: JSON.stringify({ event_key: key, scope:'occurrence', date, title }) });
        showToast('Event hidden');
      } else if (act === 'hide-series') {
        if (!confirm(`Hide "${title}" and all its future occurrences from every display?`)) return;
        await apiFetch('/api/hidden-events', { method:'POST', body: JSON.stringify({ event_key: key, scope:'series', title }) });
        showToast('All occurrences hidden');
      }
      await loadEventsManage();
    });
  });
}

// ── Calendars ─────────────────────────────────────────────────────────────────
async function renderCalendarsSubTab() {
  const feeds = await apiFetch('/api/feeds');
  const settings = await apiFetch('/api/settings');
  const masterOpacity = parseInt(settings.feed_default_opacity, 10) || 100;

  let html = `
    <div class="settings-card" style="margin-bottom:16px">
      <div class="settings-row" style="margin-bottom:0">
        <label>Master Opacity</label>
        <p style="font-size:11px;color:var(--muted);margin:-2px 0 8px">Applies to every calendar below, unless a specific one has its own "Use global default" turned off.</p>
        <div class="range-row">
          <input type="range" id="feed-master-opacity" min="10" max="100" step="5" value="${masterOpacity}">
          <span class="range-val" id="feed-master-opacity-val">${masterOpacity}%</span>
        </div>
      </div>
    </div>
    <div class="section-header" style="margin-top:4px">Subscribed Calendars</div>
  `;

  if (feeds.length === 0) {
    html += `
      <div class="empty-state">
        <div class="emoji">📡</div>
        <p>No calendars added yet.<br>Tap below to add one.</p>
      </div>`;
  } else {
    feeds.forEach(f => {
      const synced = f.last_synced
        ? 'Synced ' + new Date(f.last_synced + 'Z').toLocaleTimeString((window.i18n && i18n.lang) || undefined, {hour:'2-digit',minute:'2-digit'})
        : 'Never synced';
      const timedOn = f.color_timed === undefined ? true : f.color_timed !== 0;
      const showLocOn = f.show_location ? true : false;
      html += `
        <div class="event-card">
          <div class="event-color-bar feed-color-bar" data-id="${f.id}" data-color="${f.color}" style="background:${f.color};cursor:pointer" title="Tap to edit"></div>
          <div class="event-card-body feed-edit-toggle" data-id="${f.id}" style="cursor:pointer">
            <div class="event-card-title">${escapeHtml(f.name)}</div>
            <div class="event-card-sub">${synced} · ${f.enabled ? 'Active' : 'Paused'} · tap to edit</div>
          </div>
          <div class="event-card-actions">
            <button class="icon-btn sync-btn" data-id="${f.id}" title="Sync now">🔄</button>
            <button class="icon-btn del feed-del-btn" data-id="${f.id}" title="Remove">🗑️</button>
          </div>
        </div>
        <div class="feed-edit-panel" id="feed-edit-panel-${f.id}" style="display:none;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin:-8px 0 12px">
          <div class="settings-row">
            <label>Calendar Name</label>
            <input class="form-input feed-edit-name" data-id="${f.id}" value="${(f.name||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="settings-row">
            <label>${(f.url||'').startsWith('google:') ? 'Google calendar ("google:primary" is your main calendar)' : (f.url||'').startsWith('icloud:') ? 'iCloud calendar (picked from your account)' : 'iCal URL'}</label>
            <input class="form-input feed-edit-url" data-id="${f.id}" value="${(f.url||'').replace(/"/g,'&quot;')}" autocapitalize="none" autocorrect="off">
          </div>
          <div class="settings-row">
            <label>Color</label>
            <div class="color-picker feed-edit-colors" data-id="${f.id}" data-color="${f.color}">
              ${COLORS.map(c => `
                <div class="color-swatch feed-edit-swatch${c===f.color?' selected':''}" style="background:${c}" data-id="${f.id}" data-color="${c}"></div>
              `).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
              <input type="color" class="feed-edit-custom" data-id="${f.id}" value="${f.color || '#4A90D9'}"
                style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:none;cursor:pointer;padding:0">
              <span style="font-size:12px;color:var(--muted)">Or pick any color</span>
            </div>
          </div>
          <div class="settings-row">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <label style="margin-bottom:0">Opacity</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer">
                Use global default
                <input type="checkbox" class="feed-edit-use-global" data-id="${f.id}" ${(f.use_global_opacity===undefined||f.use_global_opacity)?'checked':''} style="width:16px;height:16px;accent-color:var(--accent)">
              </label>
            </div>
            <div class="range-row feed-edit-opacity-row" data-id="${f.id}" style="${(f.use_global_opacity===undefined||f.use_global_opacity)?'display:none':''}">
              <input type="range" class="feed-edit-opacity" data-id="${f.id}" min="10" max="100" step="5" value="${f.color_opacity ?? 100}">
              <span class="range-val feed-edit-opacity-val" data-id="${f.id}">${f.color_opacity ?? 100}%</span>
            </div>
            <p style="font-size:11px;color:var(--muted);margin-top:4px">Fades this calendar's color wherever it shows up — dots, pills, background tints — without affecting event text. On: follows the master slider at the top of this page. Off: set your own value for just this calendar.</p>
          </div>
          <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
            <label style="margin-bottom:0">Color-code timed events</label>
            <input type="checkbox" class="feed-edit-timed" data-id="${f.id}" ${timedOn?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
          </div>
          <p style="font-size:11px;color:var(--muted);margin-top:-4px">On: events with a specific time get a colored dot in this calendar's color. Off: only all-day events are color-coded.</p>
          <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
            <label style="margin-bottom:0">Show location on the display</label>
            <input type="checkbox" class="feed-edit-showloc" data-id="${f.id}" ${showLocOn?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
          </div>
          <p style="font-size:11px;color:var(--muted);margin-top:-4px">On: each event's location (e.g. the venue or address from the calendar) shows under its title in the agenda and event views. Leave off for calendars where the location would just be clutter.</p>
          <button class="btn btn-primary feed-edit-save" data-id="${f.id}" style="margin-top:8px">Save Changes</button>
        </div>`;
    });
  }

  html += `
    <div class="section-header">Add a Calendar</div>
    <div class="settings-card">
      <div class="settings-row">
        <label>Calendar Name</label>
        <input class="form-input" id="feed-name" placeholder="e.g. Family, Work, Sarah">
      </div>
      <div class="settings-row">
        <label>iCal URL</label>
        <input class="form-input" id="feed-url" placeholder="webcal:// or https://" autocapitalize="none" autocorrect="off">
      </div>
      <div class="settings-row">
        <label>Color</label>
        <div class="color-picker" id="feed-color-picker"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
          <input type="color" id="feed-color-custom" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:none;cursor:pointer;padding:0">
          <span style="font-size:12px;color:var(--muted)">Or pick any color</span>
        </div>
      </div>
    </div>

    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:16px;font-size:13px;color:var(--muted);line-height:1.6"><strong style="color:var(--text)">How to get your iCal URL:</strong><br> <strong style="color:var(--accent2)">Google Calendar:</strong> Open Google Calendar → Settings → pick a calendar → scroll to "Secret address in iCal format"<br><br> <strong style="color:var(--accent2)">Apple Calendar (iCloud):</strong> iCloud.com → Calendar → click the share icon next to a calendar → enable Public Calendar → copy the link</div>

    <button class="btn btn-primary" id="feed-add-btn">Add Calendar</button>

    <div class="settings-card" id="gcal-add-card" style="display:none;margin-top:24px"></div>
    <div class="settings-card" id="icloud-add-card" style="display:none;margin-top:24px"></div>
  `;

  $('calendar-subtab-content').innerHTML = html;

  if ($('feed-master-opacity')) {
    $('feed-master-opacity').addEventListener('input', (e) => {
      $('feed-master-opacity-val').textContent = e.target.value + '%';
    });
    // Saves on 'change' (once, when the drag settles), not on every 'input'
    // tick — this is a global setting saved via a direct PUT /api/settings,
    // not the per-widget layout autosave, so there's no batched "Save"
    // button elsewhere in this section to rely on instead.
    $('feed-master-opacity').addEventListener('change', async (e) => {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ feed_default_opacity: e.target.value }) });
      showToast('Master opacity updated ✓');
    });
  }

  // Color picker for feed
  let feedColor = COLORS[4]; // purple default
  function buildFeedColorPicker() {
    const cp = $('feed-color-picker');
    cp.innerHTML = COLORS.map(c => `
      <div class="color-swatch${c===feedColor?' selected':''}" style="background:${c}" data-color="${c}"></div>
    `).join('');
    cp.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => { feedColor = sw.dataset.color; buildFeedColorPicker(); });
    });
    const customInput = $('feed-color-custom');
    if (customInput) {
      customInput.value = feedColor;
      // Guarded — this whole subtab redraws via innerHTML on various actions,
      // but buildFeedColorPicker() itself can also be called again (from a
      // swatch click) without a fresh redraw, and re-attaching to the same
      // persistent native input each time would stack duplicate listeners.
      if (!customInput._wired) {
        customInput._wired = true;
        customInput.addEventListener('input', (e) => { feedColor = e.target.value; });
        customInput.addEventListener('change', () => { buildFeedColorPicker(); });
      }
    }
  }
  buildFeedColorPicker();

  // Sync button
  document.querySelectorAll('.sync-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.textContent = '⏳';
      btn.disabled = true;
      try {
        const r = await apiFetch(`/api/feeds/${btn.dataset.id}/sync`, { method: 'POST' });
        // apiFetch resolves even on server error responses (it doesn't throw on
        // non-2xx), so the failure case has to be checked explicitly here rather
        // than relying on a catch block — that previously meant sync failures
        // always showed a generic "Sync failed" with the real reason discarded.
        if (r.error) showToast('Sync failed: ' + r.error, 6000);
        else showToast(`Synced — ${r.events_imported} events`);
      } catch { showToast('Sync failed — could not reach the server'); }
      renderCalendarsSubTab();
    });
  });

  // Delete feed
  document.querySelectorAll('.feed-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this calendar?')) return;
      await apiFetch(`/api/feeds/${btn.dataset.id}`, { method: 'DELETE' });
      cachedFeeds = null; // invalidate so the Layout tab's source filter picks up the change
      showToast('Calendar removed');
      renderCalendarsSubTab();
      loadEvents();
    });
  });

  // Tap a calendar's color bar or body to expand its edit panel
  function toggleFeedEditPanel(id) {
    const panel = $(`feed-edit-panel-${id}`);
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    document.querySelectorAll('.feed-edit-panel').forEach(p => p.style.display = 'none');
    panel.style.display = isOpen ? 'none' : 'block';
  }
  document.querySelectorAll('.feed-color-bar').forEach(bar => {
    bar.addEventListener('click', () => toggleFeedEditPanel(bar.dataset.id));
  });
  document.querySelectorAll('.feed-edit-toggle').forEach(body => {
    body.addEventListener('click', () => toggleFeedEditPanel(body.dataset.id));
  });

  // Color swatch selection within an edit panel (visual only until Save is tapped)
  document.querySelectorAll('.feed-edit-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const picker = sw.closest('.feed-edit-colors');
      picker.querySelectorAll('.feed-edit-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      picker.dataset.color = sw.dataset.color;
      const customInput = document.querySelector(`.feed-edit-custom[data-id="${sw.dataset.id}"]`);
      if (customInput) customInput.value = sw.dataset.color;
    });
  });
  // Custom color input: kept in sync via the picker container's own
  // data-color, read at Save time below — NOT via the swatches' .selected
  // class, since a genuinely custom color won't match any swatch and would
  // otherwise silently be lost (no swatch would ever have .selected).
  document.querySelectorAll('.feed-edit-custom').forEach(input => {
    input.addEventListener('input', (e) => {
      const picker = document.querySelector(`.feed-edit-colors[data-id="${e.target.dataset.id}"]`);
      if (picker) {
        picker.dataset.color = e.target.value;
        picker.querySelectorAll('.feed-edit-swatch').forEach(s => s.classList.remove('selected'));
      }
    });
  });
  // Opacity and "Use global default" now auto-save on their own, separately
  // from the rest of this panel (name/URL/color/color-code toggle, still
  // gated behind the explicit Save Changes button below — a URL change in
  // particular triggers a feed re-fetch, which isn't something to fire on
  // every keystroke). This was the actual root of a long back-and-forth: an
  // opacity change looked like it should be live (the label/row visibility
  // update instantly) but silently did nothing until Save Changes was
  // tapped, unlike the per-widget override list and master slider
  // elsewhere, which already auto-save. Debounced 500ms for the slider,
  // matching autoSaveLayout()'s own debounce elsewhere in this file — the
  // checkbox saves immediately since a toggle is a single discrete action,
  // not a continuous drag.
  let _feedOpacityAutoSaveTimer = null;
  function autoSaveFeedOpacity(id, body) {
    clearTimeout(_feedOpacityAutoSaveTimer);
    _feedOpacityAutoSaveTimer = setTimeout(async () => {
      const r = await apiFetch(`/api/feeds/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      cachedFeeds = null; // invalidate so widgets pick up the change
      if (r && r.error) showToast('Error: ' + r.error, 6000);
    }, 500);
  }
  document.querySelectorAll('.feed-edit-opacity').forEach(input => {
    input.addEventListener('input', (e) => {
      const val = document.querySelector(`.feed-edit-opacity-val[data-id="${e.target.dataset.id}"]`);
      if (val) val.textContent = e.target.value + '%';
      autoSaveFeedOpacity(e.target.dataset.id, { color_opacity: parseInt(e.target.value, 10) });
    });
  });
  document.querySelectorAll('.feed-edit-use-global').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const row = document.querySelector(`.feed-edit-opacity-row[data-id="${e.target.dataset.id}"]`);
      if (row) row.style.display = e.target.checked ? 'none' : '';
      const body = { use_global_opacity: e.target.checked };
      // Unchecking reveals the slider at whatever value it already shows —
      // save that in the SAME request rather than leaving it stale until
      // the slider itself is touched.
      if (!e.target.checked) {
        const slider = document.querySelector(`.feed-edit-opacity[data-id="${e.target.dataset.id}"]`);
        if (slider) body.color_opacity = parseInt(slider.value, 10);
      }
      autoSaveFeedOpacity(e.target.dataset.id, body);
    });
  });

  // Save all edits for a calendar at once
  document.querySelectorAll('.feed-edit-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const name = document.querySelector(`.feed-edit-name[data-id="${id}"]`).value.trim();
      let url = document.querySelector(`.feed-edit-url[data-id="${id}"]`).value.trim();
      const picker = document.querySelector(`.feed-edit-colors[data-id="${id}"]`);
      const color = picker ? picker.dataset.color : undefined;
      const opacitySlider = document.querySelector(`.feed-edit-opacity[data-id="${id}"]`);
      const color_opacity = opacitySlider ? parseInt(opacitySlider.value, 10) : undefined;
      const useGlobalCb = document.querySelector(`.feed-edit-use-global[data-id="${id}"]`);
      const use_global_opacity = useGlobalCb ? useGlobalCb.checked : undefined;
      const color_timed = document.querySelector(`.feed-edit-timed[data-id="${id}"]`).checked;
      const showLocCb = document.querySelector(`.feed-edit-showloc[data-id="${id}"]`);
      const show_location = showLocCb ? showLocCb.checked : undefined;
      if (!name || !url) { showToast('Name and URL are required'); return; }
      url = url.replace(/^webcal:\/\//i, 'https://');
      btn.textContent = 'Saving…';
      btn.disabled = true;
      const r = await apiFetch(`/api/feeds/${id}`, {
        method: 'PUT', body: JSON.stringify({ name, url, color, color_opacity, use_global_opacity, color_timed, show_location }),
      });
      cachedFeeds = null; // invalidate so widgets pick up changes
      if (r.error) {
        showToast('Error: ' + r.error, 6000);
        btn.textContent = 'Save Changes'; btn.disabled = false;
      } else if (r.sync_warning) {
        showToast('Saved, but sync failed: ' + r.sync_warning, 6000);
        renderCalendarsSubTab(); loadEvents();
      } else {
        showToast('Calendar updated ✓');
        renderCalendarsSubTab(); loadEvents();
      }
    });
  });

  // Add feed
  $('feed-add-btn').addEventListener('click', async () => {
    const name = $('feed-name').value.trim();
    let url  = $('feed-url').value.trim();
    if (!name || !url) { showToast('Name and URL are required'); return; }
    // Convert webcal:// → https://
    url = url.replace(/^webcal:\/\//i, 'https://');

    // Very common mistake: pasting the calendar.google.com/calendar/u/0?cid=...
    // link (Google's "share this calendar" / browser address-bar link) instead of
    // the actual iCal feed URL. That link opens the web app and requires a Google
    // login — it never returns calendar data, so it would otherwise fail with a
    // generic "didn't look like a calendar file" error that doesn't explain why.
    // Catch it here with the specific fix instead. A real iCal feed URL's path
    // always contains "/ical/" and ends in ".ics"; the web-UI link never does.
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'calendar.google.com' && !/\/ical\//i.test(parsed.pathname) && !/\.ics$/i.test(parsed.pathname)) {
        showToast('That looks like a link to open Google Calendar in your browser, not the calendar\u2019s iCal feed. In Google Calendar, go to Settings → pick the calendar in the left list → scroll to "Secret address in iCal format" → copy that URL instead (it ends in .ics).', 9000);
        return;
      }
    } catch { /* not a parseable URL at all — let the normal add-flow surface that */ }

    $('feed-add-btn').textContent = 'Subscribing…';
    $('feed-add-btn').disabled = true;
    try {
      const r = await apiFetch('/api/feeds', {
        method: 'POST',
        body: JSON.stringify({ name, url, color: feedColor })
      });
      if (r.error) {
        showToast('Error: ' + r.error);
      } else if (r.sync_warning) {
        // Feed was added, but the first sync didn't succeed — surface this
        // clearly rather than showing a generic success toast, since otherwise
        // the calendar silently shows zero events with no indication why.
        showToast('Calendar added, but sync failed: ' + r.sync_warning, 6000);
        cachedFeeds = null; loadEvents();
      } else {
        cachedFeeds = null; showToast('Calendar added ✓'); loadEvents();
      }
    } catch { showToast('Failed to add calendar'); }
    renderCalendarsSubTab();
  });
  renderGoogleAddCard(() => feedColor);
  renderIcloudAddCard(() => feedColor, feeds);
}

// ── Add a calendar straight from the connected Google account (Calendars -> Add a Calendar) ─────────────────────────
// A feed whose address is google:<calendar id> is read through the Google sign-in this device already uses to push
// events out - no private link to paste, and it keeps itself up to date. The sign-in can read a calendar it is given the
// id of but cannot list the account's calendars, so the main calendar is one click and any other is added by its id.
async function renderGoogleAddCard(getColor) {
  const card = document.getElementById('gcal-add-card');
  if (!card) return;
  let g = null;
  try { g = await apiFetch('/api/google-settings'); } catch { g = null; }
  if (!g || g.error || g.__authFailed || !document.getElementById('gcal-add-card')) return;   // not available here: leave it hidden
  card.style.display = '';
  if (!g.google_connected) {
    card.innerHTML = '<div style="font-size:13px;color:var(--muted);line-height:1.45">Use Google Calendar? Connect your Google account (Settings \u2192 Push to Google Calendar) and you can add its calendars here with no link to paste.</div>';
    return;
  }
  card.innerHTML = `
    <div class="settings-row">
      <label>Add from your Google account</label>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Connected as ${escapeHtml(g.google_account_email || 'your Google account')}. No link to paste, and it stays up to date.</div>
      <input class="form-input" id="gcal-name" placeholder="Calendar name, e.g. Family">
    </div>
    <div class="settings-row">
      <label>Calendar id (optional)</label>
      <input class="form-input" id="gcal-id" placeholder="Leave empty for your main calendar" autocapitalize="none" autocorrect="off" spellcheck="false">
      <div style="font-size:11px;color:var(--muted);margin-top:4px">For another calendar, paste its id: in Google Calendar open Settings, pick the calendar, then "Integrate calendar". It looks like name@group.calendar.google.com. It uses the color picked above.</div>
    </div>
    <button class="btn btn-primary" id="gcal-add-btn" type="button">Add from Google</button>`;
  document.getElementById('gcal-add-btn').addEventListener('click', async () => {
    const btn = document.getElementById('gcal-add-btn');
    const name = document.getElementById('gcal-name').value.trim() || 'Google Calendar';
    const id = document.getElementById('gcal-id').value.trim();
    if (id && !/^[A-Za-z0-9._@+=%-]{1,200}$/.test(id)) { showToast("That calendar id doesn't look right."); return; }
    btn.textContent = 'Adding\u2026'; btn.disabled = true;
    try {
      const r = await apiFetch('/api/feeds', { method: 'POST', body: JSON.stringify({ name, url: 'google:' + (id ? encodeURIComponent(id) : 'primary'), color: getColor() }) });
      if (r.error) showToast('Error: ' + r.error, 6000);
      else if (r.sync_warning) showToast('Calendar added, but sync failed: ' + r.sync_warning, 7000);
      else showToast('Calendar added \u2713');
    } catch { showToast('Failed to add calendar'); }
    cachedFeeds = null; loadEvents(); renderCalendarsSubTab();
  });
}

// ── Add a calendar straight from the connected iCloud account (Calendars -> Add a Calendar) ──────────────────────
// A feed whose address is icloud:<calendar collection URL> is read over CalDAV with the Apple ID + app-specific password
// already saved for pushing events to iCloud (push does not have to be switched on). Apple has no sign-in button for
// calendars, so those two are what "signing in" means here. The calendars come from the same discovery the push settings
// use, so people pick from a list instead of pasting anything.
async function renderIcloudAddCard(getColor, feeds) {
  const card = document.getElementById('icloud-add-card');
  if (!card) return;
  let c = null;
  try { c = await apiFetch('/api/caldav-settings'); } catch { c = null; }
  if (!c || c.error || c.__authFailed || !document.getElementById('icloud-add-card')) return;   // not available here: leave it hidden
  card.style.display = '';
  if (!c.icloud_username || !c.icloud_app_password_set) {
    card.innerHTML = '<div style="font-size:13px;color:var(--muted);line-height:1.45">Use iCloud Calendar? Save your Apple ID and an app-specific password (Settings \u2192 Push to iCloud Calendar) and you can pick its calendars here with no link to paste. You do not have to turn push on.</div>';
    return;
  }
  const have = new Set((feeds || []).map((f) => f.url));
  let list = Array.isArray(c.icloud_calendars) ? c.icloud_calendars.filter((x) => x && x.url && x.name) : [];
  const draw = (msg) => {
    card.innerHTML = `
      <div class="settings-row">
        <label>Add from your iCloud account</label>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Signed in as ${escapeHtml(c.icloud_username)}. Pick a calendar: no link to paste, and it stays up to date.</div>
        ${list.length ? list.map((x, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)">
            <div style="flex:1;font-size:14px">${escapeHtml(x.name)}</div>
            <button type="button" class="btn icloud-add" data-i="${i}" ${have.has('icloud:' + x.url) ? 'disabled' : ''} style="padding:6px 14px">${have.has('icloud:' + x.url) ? 'Added' : 'Add'}</button>
          </div>`).join('') : '<div style="font-size:13px;color:var(--muted)">No calendars listed yet.</div>'}
        <div style="margin-top:10px"><button type="button" class="btn" id="icloud-find" style="padding:6px 14px">${list.length ? 'Refresh the list' : 'Find my calendars'}</button></div>
        <div id="icloud-msg" style="font-size:12px;margin-top:8px;color:var(--muted)">${msg ? escapeHtml(msg) : ''}</div>
      </div>`;
    card.querySelectorAll('.icloud-add').forEach((b) => b.addEventListener('click', async () => {
      const x = list[Number(b.dataset.i)];
      b.disabled = true; b.textContent = 'Adding\u2026';
      try {
        const r = await apiFetch('/api/feeds', { method: 'POST', body: JSON.stringify({ name: x.name, url: 'icloud:' + x.url, color: getColor() }) });
        if (r.error) showToast('Error: ' + r.error, 6000);
        else if (r.sync_warning) showToast('Calendar added, but sync failed: ' + r.sync_warning, 7000);
        else showToast('Calendar added \u2713');
      } catch { showToast('Failed to add calendar'); }
      cachedFeeds = null; loadEvents(); renderCalendarsSubTab();
    }));
    const find = document.getElementById('icloud-find');
    if (find) find.addEventListener('click', async () => {
      find.disabled = true; find.textContent = 'Looking\u2026';
      let r = null;
      try { r = await apiFetch('/api/caldav/discover', { method: 'POST', body: JSON.stringify({ username: c.icloud_username }) }); } catch { r = null; }
      if (r && r.ok && Array.isArray(r.calendars)) {
        list = r.calendars.filter((x) => x && x.url && x.name);
        try { await apiFetch('/api/caldav-settings', { method: 'PUT', body: JSON.stringify({ icloud_calendars: list }) }); } catch {}
        draw(list.length ? '' : 'iCloud answered, but no calendars were found.');
      } else {
        draw((r && r.error) ? r.error : 'Could not reach iCloud. Check the Apple ID and app-specific password in Settings.');
      }
    });
  };
  draw('');
}

// ── Photos ────────────────────────────────────────────────────────────────────
async function renderPhotos() {
  const photos = await apiFetch('/api/photos');
  let album = null;
  try { album = await apiFetch('/api/photo-album'); } catch (e) { album = null; }
  let gp = null;
  try { gp = await apiFetch('/api/google-photos'); } catch (e) { gp = null; }

  // iCloud shared-album card — paste a public shared-album link and the hub
  // pulls those photos into the shared library (tagged "icloud"), re-checking
  // on a timer. Host-only feature; a slave just proxies these calls.
  let albumCard = '';
  if (album) {
    const connected = !!album.connected;
    const last = album.last_sync ? new Date(album.last_sync) : null;
    const lastTxt = last && !isNaN(last) ? last.toLocaleString((window.i18n && i18n.lang) || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
    let status = '';
    if (connected) {
      status = `<div style="font-size:12px;color:var(--muted);margin-top:8px">`
        + `${album.count} photo${album.count === 1 ? '' : 's'} imported · last checked ${lastTxt}`
        + (album.syncing ? ' · <span style="color:var(--accent)">syncing now…</span>' : '')
        + (album.last_error ? `<br><span style="color:#c0392b">Last error: ${String(album.last_error).replace(/</g, '&lt;')}</span>` : '')
        + `</div>`;
    }
    albumCard = `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:4px">
        ☁️ iCloud Shared Album
        ${infoBtn('On an iPhone/iPad: open the shared album in Photos → the people icon → "Public Website" (turn it on) → "Share Link". Paste that <b>icloud.com/sharedalbum/…</b> link here. The hub copies new photos from that album into this library automatically. HEIC photos are skipped (browsers can\'t show them) — turn on "Most Compatible" in iPhone Settings → Camera → Formats if that\'s a problem.')}
      </div>
      <p style="font-size:12px;color:var(--muted);margin:0 0 10px">Photos added to a public iCloud shared album show up here on their own, tagged <b>icloud</b>.</p>
      <input class="form-input" id="album-url" placeholder="https://www.icloud.com/sharedalbum/#…" value="${(album.url || '').replace(/"/g, '&quot;')}" style="margin:0 0 8px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-mini" id="album-save-btn" style="background:var(--accent);color:#fff;border-color:var(--accent)">${connected ? 'Update link' : 'Connect'}</button>
        ${connected ? `<button class="btn-mini" id="album-sync-btn">Sync now</button>` : ''}
        ${connected ? `<button class="btn-mini" id="album-disconnect-btn" style="color:#c0392b">Disconnect</button>` : ''}
      </div>
      ${status}
    </div>`;
  }

  // Google Photos card — Google only lets apps read photos the person picks, so this is "Pick photos" (opens Google's own picker), not a live sync.
  let gpCard = '';
  if (gp) {
    const esc = (t) => String(t || '').replace(/</g, '&lt;');
    const btnAcc = 'background:var(--accent);color:#fff;border-color:var(--accent)';
    let body;
    if (!gp.configured) {
      body = '<p style="font-size:12px;color:var(--muted);margin:0">Add your Google Client ID and Secret first (Settings → Push to Google Calendar). The same ones work here.</p>';
    } else if (!gp.connected) {
      body = '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-mini" id="gp-connect-btn" style="' + btnAcc + '">Connect Google Photos</button></div><div id="gp-status" style="font-size:12px;color:var(--muted);margin-top:8px"></div>';
    } else {
      const last = gp.last_import ? new Date(gp.last_import) : null;
      const lastTxt = last && !isNaN(last) ? last.toLocaleString((window.i18n && i18n.lang) || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
      body = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px"><span>Connected as</span> ${esc(gp.email || 'your Google account')} · <span>${gp.count} photo${gp.count === 1 ? '' : 's'} imported</span> · <span>last picked</span> ${lastTxt}</div>`
        + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-mini" id="gp-pick-btn" style="' + btnAcc + '">' + (gp.session ? 'Open the picker again' : 'Pick photos') + '</button>'
        + '<button class="btn-mini" id="gp-disconnect-btn">Disconnect</button>'
        + (gp.count ? '<button class="btn-mini" id="gp-remove-btn" style="color:#c0392b">Remove imported photos</button>' : '') + '</div>'
        + '<div id="gp-status" style="font-size:12px;color:var(--muted);margin-top:8px"></div>'
        + (gp.last_error ? `<div style="font-size:12px;color:#c0392b;margin-top:6px"><span>Last error:</span> ${esc(gp.last_error)}</div>` : '');
    }
    gpCard = '<div style="background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:16px">'
      + '<div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:4px">🖼️ Google Photos '
      + infoBtn('Google only lets apps see the photos you choose. Tap <b>Pick photos</b>, choose what you want in Google\'s own picker, and tap Done — those photos are copied into this library (tagged <b>google-photos</b>). To add more later, tap Pick photos again. It does not keep itself in sync with your Google library.')
      + '</div><p style="font-size:12px;color:var(--muted);margin:0 0 10px">Choose photos from your Google Photos library and copy them here.</p>' + body + '</div>';
  }

  let photoGrid = '';
  if (photos.length === 0) {
    photoGrid = `<div class="empty-state"><div class="emoji">🖼️</div><p>No photos yet.<br>Upload one below.</p></div>`;
  } else {
    const activeCount = photos.filter(p => p.active === undefined || p.active === 1).length;
    photoGrid = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--muted)" id="photos-grid-hint">${activeCount} of ${photos.length} in slideshow · tap a photo to include/exclude</div>
        <div style="display:flex;gap:8px">
          <button class="btn-mini" id="photos-select-all">All</button>
          <button class="btn-mini" id="photos-select-none">None</button>
          <button class="btn-mini" id="photos-tag-mode-btn">🏷️ Tag multiple</button>
        </div>
      </div>
      <div id="photos-tag-bar" style="display:none;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--accent);border-radius:10px;padding:10px 12px;margin-bottom:10px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--muted)"><span id="photos-tag-selcount">0</span> selected</span>
        <input class="form-input" id="photos-tag-bulk-input" placeholder="Tag to apply, e.g. kids" style="flex:1;min-width:140px;margin:0">
        <button class="btn-mini" id="photos-tag-apply-btn" style="background:var(--accent);color:#fff;border-color:var(--accent)">Apply</button>
        <button class="btn-mini" id="photos-tag-cancel-btn">Cancel</button>
      </div>
      <div class="photo-grid" id="photos-grid">` + photos.map(p => {
        const isActive = p.active === undefined || p.active === 1;
        return `
        <div class="photo-thumb${isActive ? '' : ' photo-inactive'}" data-id="${p.id}" data-active="${isActive ? '1' : '0'}" role="button" title="Tap to ${isActive ? 'exclude from' : 'include in'} slideshow">
          <img src="/uploads/${p.filename}" alt="${p.label || ''}">
          ${p.label ? `<div class="photo-thumb-label">${p.label}</div>` : ''}
          <div class="photo-thumb-check">${isActive ? '✓' : ''}</div>
          <div class="photo-thumb-selectbox">☐</div>
          <button class="photo-thumb-del" data-id="${p.id}">✕</button>
          <button class="photo-thumb-tag" data-id="${p.id}" data-tags="${(p.tags||'').replace(/"/g,'&quot;')}" title="Edit tags" onclick="event.stopPropagation()">🏷️${p.tags ? ' ' + p.tags.split(',')[0] : ''}</button>
        </div>`;
      }).join('') + `</div>`;
  }

  $('content').innerHTML = `
    <div class="section-header" style="margin-top:4px">Your Photos (${photos.length})</div>
    <p style="font-size:12px;color:var(--muted);margin:-4px 0 12px;padding:0 2px">Upload your photos here. Tap the 🏷️ on a photo to tag it (e.g. "kids", "vacation") — then in the <b>Devices</b> tab, point any screen's screensaver at a tag so it shows just that subset. To choose <b>which</b> photos show in a placed widget, add a Photo widget in the <b>Layout</b> tab instead.</p>
    ${albumCard}
    ${gpCard}
    ${photoGrid}

    <input type="file" id="photo-file-input" accept="image/jpeg,image/png,image/webp,image/gif">
    <div class="upload-zone" id="upload-zone">
      <div class="emoji">📸</div>
      <p>Tap to upload a photo</p>
    </div>

    <button class="btn btn-primary" id="ps-save-btn">Save Photo Settings</button>
  `;

  // Upload
  $('upload-zone').addEventListener('click', () => $('photo-file-input').click());
  $('photo-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const label = file.name.replace(/\.[^.]+$/, '');
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('label', label);
    $('upload-zone').innerHTML = '<div class="emoji">⏳</div><p>Uploading…</p>';
    // A plain fetch() here never sent the session token, so this silently
    // 401'd ("Upload failed: Unauthorized") on any device with a PIN set —
    // same bug class as the reminder-icon/custom-theme uploads below.
    // apiFetch() already handles a FormData body correctly (it just skips
    // setting Content-Type, same as the working chore-photo upload).
    const data = await apiFetch('/api/photos', { method: 'POST', body: fd });
    if (data.error) { showToast('Upload failed: ' + data.error); }
    else { showToast('Photo uploaded ✓'); }
    renderPhotos();
  });

  // iCloud shared-album card
  if ($('album-save-btn')) {
    $('album-save-btn').addEventListener('click', async () => {
      const url = ($('album-url').value || '').trim();
      if (!url) { showToast('Paste a shared-album link first'); return; }
      const btn = $('album-save-btn'); btn.disabled = true; btn.textContent = 'Saving…';
      const r = await apiFetch('/api/photo-album', { method: 'PUT', body: JSON.stringify({ url }) });
      if (r && r.error) { showToast('❌ ' + r.error); btn.disabled = false; btn.textContent = 'Connect'; return; }
      showToast('Album connected — importing photos…');
      setTimeout(renderPhotos, 2500);
    });
  }
  if ($('album-sync-btn')) {
    $('album-sync-btn').addEventListener('click', async () => {
      const btn = $('album-sync-btn'); btn.disabled = true; btn.textContent = 'Syncing…';
      const r = await apiFetch('/api/photo-album/sync', { method: 'POST' });
      if (r && r.error) showToast('❌ ' + r.error);
      else showToast(`Sync done: +${r.added || 0} −${r.removed || 0}${r.skipped ? ` (${r.skipped} skipped)` : ''}`);
      renderPhotos();
    });
  }
  if ($('album-disconnect-btn')) {
    $('album-disconnect-btn').addEventListener('click', async () => {
      if (!confirm('Disconnect the iCloud album? Photos it imported will be removed from this library (your uploads stay).')) return;
      const r = await apiFetch('/api/photo-album', { method: 'DELETE' });
      showToast(r && r.removed != null ? `Removed ${r.removed} imported photo${r.removed === 1 ? '' : 's'}` : 'Album disconnected');
      renderPhotos();
    });
  }

  // Google Photos card
  const gpStatus = (h) => { if ($('gp-status')) $('gp-status').innerHTML = h; };
  const gpPollPick = async (deadline) => {
    if (!$('gp-status')) return; // left this tab
    if (Date.now() > deadline) { gpStatus('The picker timed out — tap Pick photos to try again.'); return; }
    let r;
    try { r = await apiFetch('/api/google-photos/pick-poll', { method: 'POST', body: '{}' }); } catch (e) { r = { status: 'pending' }; }
    if (r.status === 'done') { showToast(r.added ? 'Added ' + r.added + ' photo' + (r.added === 1 ? '' : 's') + ' from Google Photos ✓' : 'No new photos picked'); renderPhotos(); return; }
    if (r.status === 'expired' || r.status === 'none') { gpStatus('The picker closed without any photos.'); return; }
    if (r.status === 'error') { gpStatus('<span style="color:#c0392b">' + String(r.error || 'Something went wrong').replace(/</g, '&lt;') + '</span>'); return; }
    gpStatus(r.status === 'importing' ? 'Copying your photos in…' : 'Waiting for you to finish picking in Google Photos…');
    setTimeout(() => gpPollPick(deadline), 4000);
  };
  const gpWaiting = (uri, expires, opened) => {
    gpStatus('<a href="' + String(uri).replace(/"/g, '&quot;') + '" target="_blank" rel="noopener" style="color:var(--accent)">Open the Google Photos picker</a>, choose your photos and tap Done.<div style="margin-top:6px">Waiting for you to finish…</div>');
    gpPollPick(expires || Date.now() + 30 * 60 * 1000);
  };
  if ($('gp-connect-btn')) {
    $('gp-connect-btn').addEventListener('click', async () => {
      const btn = $('gp-connect-btn'); btn.disabled = true; gpStatus('Preparing…');
      let start; try { start = await apiFetch('/api/google-photos/connect-start', { method: 'POST', body: '{}' }); } catch (e) { start = null; }
      if (!start || !start.auth_url) { gpStatus((start && start.error) || 'Could not start the connection.'); btn.disabled = false; return; }
      try { window.open(start.auth_url, '_blank', 'noopener'); } catch (e) {}
      gpStatus('<a href="' + start.auth_url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener" style="color:var(--accent)">Open the Google sign-in page</a>, pick the account that has your photos, and approve.<div style="margin-top:6px">Waiting for you to approve…</div>');
      const deadline = Date.now() + 15 * 60 * 1000;
      const poll = async () => {
        if (!$('gp-status')) return;
        if (Date.now() > deadline) { gpStatus('Timed out — tap Connect to try again.'); btn.disabled = false; return; }
        let r; try { r = await apiFetch('/api/google-photos/connect-poll', { method: 'POST', body: JSON.stringify({ state: start.state }) }); } catch (e) { r = { status: 'pending' }; }
        if (r.status === 'pending') { setTimeout(poll, 3000); return; }
        if (r.status === 'connected') { showToast('✓ Google Photos connected'); renderPhotos(); return; }
        gpStatus(r.status === 'denied' ? 'Access was not granted in the Google prompt.' : 'Something went wrong: ' + String(r.error || r.status).replace(/</g, '&lt;'));
        btn.disabled = false;
      };
      setTimeout(poll, 3000);
    });
  }
  if ($('gp-pick-btn')) {
    $('gp-pick-btn').addEventListener('click', async () => {
      const btn = $('gp-pick-btn'); btn.disabled = true; gpStatus('Opening the picker…');
      const r = await apiFetch('/api/google-photos/pick', { method: 'POST', body: '{}' });
      btn.disabled = false;
      if (!r || r.error) { gpStatus('<span style="color:#c0392b">' + String((r && r.error) || 'Could not open the picker').replace(/</g, '&lt;') + '</span>'); return; }
      try { window.open(r.picker_uri, '_blank', 'noopener'); } catch (e) {}
      gpWaiting(r.picker_uri, r.expires);
    });
    // Came back to this tab while a picker was still open: carry on waiting for it.
    if (gp && gp.session) gpWaiting(gp.session.picker_uri, gp.session.expires);
  }
  if ($('gp-disconnect-btn')) {
    $('gp-disconnect-btn').addEventListener('click', async () => {
      if (!confirm('Disconnect Google Photos? Photos already imported stay in your library.')) return;
      await apiFetch('/api/google-photos/disconnect', { method: 'POST', body: '{}' });
      showToast('Google Photos disconnected'); renderPhotos();
    });
  }
  if ($('gp-remove-btn')) {
    $('gp-remove-btn').addEventListener('click', async () => {
      if (!confirm('Remove the photos imported from Google Photos and disconnect? Your uploads stay.')) return;
      const r = await apiFetch('/api/google-photos', { method: 'DELETE' });
      showToast(r && r.removed != null ? 'Removed ' + r.removed + ' imported photo' + (r.removed === 1 ? '' : 's') : 'Disconnected');
      renderPhotos();
    });
  }

  // Delete photo
  document.querySelectorAll('.photo-thumb-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // don't also trigger the thumb's include/exclude toggle
      if (!confirm('Remove this photo?')) return;
      await apiFetch(`/api/photos/${btn.dataset.id}`, { method: 'DELETE' });
      showToast('Photo removed');
      renderPhotos();
    });
  });

  // Tag a photo (comma-separated). Tags let a screen's screensaver show just a subset
  // — e.g. tag some photos "kids" and point one screen's screensaver at that tag.
  document.querySelectorAll('.photo-thumb-tag').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const current = btn.dataset.tags || '';
      const next = prompt('Tags for this photo (comma-separated, e.g. "family, kids"):', current);
      if (next === null) return;
      await apiFetch(`/api/photos/${btn.dataset.id}`, { method: 'PUT', body: JSON.stringify({ tags: next }) });
      showToast('Tags saved ✓');
      renderPhotos();
    });
  });

  // Tag-selection mode state. When on, tapping a thumbnail selects it for bulk tagging
  // instead of toggling slideshow inclusion; the mode is local UI state, not persisted.
  let tagModeOn = false;
  const tagSelected = new Set();

  function updateTagBar() {
    const bar = $('photos-tag-bar');
    const count = $('photos-tag-selcount');
    if (count) count.textContent = String(tagSelected.size);
    if (bar) bar.style.display = tagModeOn ? 'flex' : 'none';
  }

  if ($('photos-tag-mode-btn')) {
    $('photos-tag-mode-btn').addEventListener('click', () => {
      tagModeOn = !tagModeOn;
      tagSelected.clear();
      const grid = $('photos-grid'), hint = $('photos-grid-hint'), btn = $('photos-tag-mode-btn');
      if (grid) grid.classList.toggle('tag-mode', tagModeOn);
      document.querySelectorAll('.photo-thumb').forEach(t => t.classList.remove('tag-selected'));
      if (hint) hint.textContent = tagModeOn
        ? 'Tap photos to select them, then apply a tag to all at once.'
        : `${document.querySelectorAll('.photo-thumb:not(.photo-inactive)').length} of ${document.querySelectorAll('.photo-thumb').length} in slideshow · tap a photo to include/exclude`;
      if (btn) btn.textContent = tagModeOn ? '✕ Cancel' : '🏷️ Tag multiple';
      updateTagBar();
    });
  }
  if ($('photos-tag-cancel-btn')) {
    $('photos-tag-cancel-btn').addEventListener('click', () => $('photos-tag-mode-btn').click());
  }
  if ($('photos-tag-apply-btn')) {
    $('photos-tag-apply-btn').addEventListener('click', async () => {
      const tag = ($('photos-tag-bulk-input').value || '').trim();
      if (!tag) { showToast('Enter a tag first'); return; }
      if (!tagSelected.size) { showToast('Select at least one photo'); return; }
      const btn = $('photos-tag-apply-btn');
      btn.disabled = true; btn.textContent = 'Applying…';
      // Merge the new tag into each selected photo's existing tags (don't clobber ones already set).
      for (const id of tagSelected) {
        const thumbTag = document.querySelector(`.photo-thumb-tag[data-id="${id}"]`);
        const existing = (thumbTag && thumbTag.dataset.tags || '').split(',').map(t => t.trim()).filter(Boolean);
        if (!existing.includes(tag)) existing.push(tag);
        await apiFetch(`/api/photos/${id}`, { method: 'PUT', body: JSON.stringify({ tags: existing.join(',') }) });
      }
      showToast(`Tagged ${tagSelected.size} photo${tagSelected.size===1?'':'s'} "${tag}" ✓`);
      tagModeOn = false; tagSelected.clear();
      renderPhotos();
    });
  }

  // Tap a thumbnail: in tag mode, toggle selection; otherwise include/exclude from the slideshow.
  document.querySelectorAll('.photo-thumb').forEach(thumb => {
    thumb.addEventListener('click', async () => {
      const id = thumb.dataset.id;
      if (tagModeOn) {
        if (tagSelected.has(id)) { tagSelected.delete(id); thumb.classList.remove('tag-selected'); }
        else { tagSelected.add(id); thumb.classList.add('tag-selected'); }
        const box = thumb.querySelector('.photo-thumb-selectbox');
        if (box) box.textContent = tagSelected.has(id) ? '☑' : '☐';
        updateTagBar();
        return;
      }
      const nowActive = thumb.dataset.active !== '1'; // toggling
      // Optimistic UI: flip immediately, then persist
      thumb.dataset.active = nowActive ? '1' : '0';
      thumb.classList.toggle('photo-inactive', !nowActive);
      const check = thumb.querySelector('.photo-thumb-check');
      if (check) check.textContent = nowActive ? '✓' : '';
      const r = await apiFetch(`/api/photos/${id}`, {
        method: 'PUT', body: JSON.stringify({ active: nowActive }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); renderPhotos(); return; }
      renderPhotos(); // refresh the "N of M" count
    });
  });

  // Select all / none for the slideshow
  if ($('photos-select-all')) {
    $('photos-select-all').addEventListener('click', async () => {
      const all = await apiFetch('/api/photos');
      const ids = Array.isArray(all) ? all.map(p => p.id) : [];
      await apiFetch('/api/photos-active', { method: 'PUT', body: JSON.stringify({ activeIds: ids }) });
      showToast('All photos in slideshow ✓');
      renderPhotos();
    });
  }
  if ($('photos-select-none')) {
    $('photos-select-none').addEventListener('click', async () => {
      await apiFetch('/api/photos-active', { method: 'PUT', body: JSON.stringify({ activeIds: [] }) });
      showToast('All photos excluded');
      renderPhotos();
    });
  }
}

// ── Displays ──────────────────────────────────────────────────────────────────
// Shared by the Devices tab (screensaver tag/photo dropdowns) and the Layout
// tab's photo widget (its own, independent tag dropdown) — populates
// window._photoTags and window._photosList once, whichever tab triggers it first.
async function ensurePhotoTagsLoaded() {
  if (window._photoTags !== undefined) return; // already loaded (even an empty array counts)
  try {
    const photos = await apiFetch('/api/photos');
    window._photosList = photos || [];
    const tagSet = new Set();
    (photos || []).forEach(p => (p.tags || '').split(',').forEach(t => { const v = t.trim(); if (v) tagSet.add(v); }));
    window._photoTags = Array.from(tagSet).sort();
  } catch { window._photoTags = []; window._photosList = []; }
}

async function renderDisplaysTab() {
  // Just the physical screens now — profile/template/saved-layout management
  // moved to the Layout tab's own sub-tabs (Profiles/Templates/Saved Layouts),
  // since those aren't really "devices" at all, just the tooling for what a
  // device can show. This tab is now purely about the hardware: which screens
  // exist and which profile each one is currently showing.
  $('content').innerHTML = `
    <div style="margin-bottom:6px">
      <p style="font-size:12px;color:var(--muted);margin:0 0 12px;padding:0 2px">Your screens, and the layout each one shows. Pick a profile for a screen and it switches instantly — no SSH or reboot.</p>
      <div id="screens-list"><div style="color:var(--muted);font-size:13px;padding:8px">Loading…</div></div>
      <div id="add-display-section" style="margin-top:20px"></div>
    </div>`;
  loadScreens();
  startScreensAutoRefresh();
  renderAddDisplaySection();
}

// ── Add a Display (non-Pi) ───────────────────────────────────────────────────
// This is really the same mechanism the Layout tab's Profiles list already
// exposes (every profile has always had a shareable URL) — surfaced here
// instead, since "how do I add another screen" is what someone actually
// comes to the Devices tab looking for, not the Layout tab. A screen is
// just anything with a browser pointed at this URL: an old tablet, a Fire
// Stick's browser, a spare monitor plugged into a cheap streaming box —
// none of that requires a Raspberry Pi at all.
async function renderAddDisplaySection() {
  const section = $('add-display-section');
  if (!section) return;
  let displays = [], ts = { installed: false, ip: null, port: null };
  try {
    [displays, ts] = await Promise.all([
      getDisplaysList(),
      apiFetch('/api/tailscale-status').catch(() => ({ installed: false, ip: null, port: null })),
    ]);
  } catch {}
  if (!displays || !displays.length) { section.innerHTML = ''; return; }

  const defaultSlug = displays[0].slug;
  // Prefer this Pi's own Tailscale IP for the generated URL/QR — it works
  // regardless of what network the NEW device is on, as long as it's also
  // on the same tailnet. window.location.origin only works if the new
  // device happens to share this admin's current network, which isn't a
  // safe assumption for something that might get moved between rooms.
  const baseUrl = ts.installed
    ? `http://${ts.ip}:${ts.port || 3000}`
    : window.location.origin;

  section.innerHTML = `
    <div class="settings-card" style="margin-top:4px">
      <div style="padding:14px 16px 4px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:18px">📺</span>
          <b style="font-size:14px">Add a Display</b>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 14px">Any screen with a web browser can show your layout — an old tablet, a Fire Stick or Chromecast's browser, a spare monitor on a cheap streaming box. No Pi, no install script needed.</p>
        ${ts.installed ? `
          <div style="background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.35);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#34d399">
            ✓ Tailscale detected on this server — the link/QR below will work from any device on your tailnet, not just this Wi-Fi network.
          </div>
        ` : `
          <div style="background:rgba(255,176,32,0.1);border:1px solid rgba(255,176,32,0.35);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#ffb020">
            ⚠️ Tailscale isn't detected on this server. The link below will only work if
            the new device is on this <b>same Wi-Fi network</b>. For a device that might
            move between rooms or networks (a tablet you carry around, a Fire Stick),
            install Tailscale on <b>both</b> this server and the new device first —
            <a href="https://tailscale.com/download" target="_blank" rel="noopener" style="color:#ffb020">tailscale.com/download</a>.
          </div>
        `}
      </div>
      <div class="settings-row" style="margin-bottom:12px">
        <label>Which layout should it show?</label>
        <select class="form-input" id="add-display-profile-select">
          ${displays.map(d => `<option value="${d.slug}">${escapeHtml(d.name)}</option>`).join('')}
        </select>
      </div>
      <div style="padding:0 16px 14px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div id="add-display-qr" style="background:#fff;padding:10px;border-radius:10px;flex-shrink:0"></div>
        <div style="flex:1;min-width:180px">
          <p style="font-size:11px;color:var(--muted);margin:0 0 6px">Scan on the new device, or open this address in its browser:</p>
          <div style="display:flex;gap:8px;align-items:center">
            <code id="add-display-url" style="font-size:11px;word-break:break-all;background:var(--bg,#0f1420);border-radius:6px;padding:8px 10px;flex:1">${baseUrl}/?display=${defaultSlug}</code>
            <button id="add-display-copy-btn" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;font-size:13px;cursor:pointer;flex-shrink:0">📋</button>
          </div>
        </div>
      </div>
    </div>`;

  const renderQr = (slug) => {
    const url = `${baseUrl}/?display=${slug}`;
    $('add-display-url').textContent = url;
    const qrEl = $('add-display-qr');
    qrEl.innerHTML = '';
    try { new QRCode(qrEl, { text: url, width: 130, height: 130, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); } catch {}
  };
  renderQr(defaultSlug);
  $('add-display-profile-select').addEventListener('change', (e) => renderQr(e.target.value));
  $('add-display-copy-btn').addEventListener('click', () => copyToClipboard($('add-display-url').textContent));
}

// Builds just the toggle link + empty-state + profile cards fragment — kept
// separate from the intro paragraph and "Add a profile" card below (which
// never change based on the filter) so the "Show all" toggle can replace
// ONLY this fragment in place, not the entire sub-tab. That's what actually
// fixes the "collapses and reshows" effect: swapping the whole panel's
// innerHTML (intro text, add-profile input and any half-typed name in it,
// scroll position) for a change that's really just "reveal a few more
// cards" was the disruption, not the filtering itself.
function buildProfilesListHtml(displays, visibleDisplays, inactiveCount) {
  let html = '';
  if (inactiveCount > 0) {
    html += `
      <div style="text-align:center;padding:2px 0 10px">
        <button id="profiles-toggle-all-btn" style="background:none;border:none;color:var(--accent);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 10px">
          ${showAllProfiles ? 'Show only active' : `Show all (${inactiveCount} not on an active device)`}
        </button>
      </div>`;
  }
  if (!visibleDisplays.length) {
    html += `<div class="empty-state"><div class="emoji">🎛️</div><p>No profiles are currently showing on an active device.</p></div>`;
  }
  visibleDisplays.forEach(d => {
    const url = `${window.location.origin}/?display=${encodeURIComponent(d.slug)}`;
    const forceO = d.force_orientation || 'auto';
    const rot = Number(d.rotation) || 0;
    const themeBadge = d.theme
      ? `<span style="display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;background:var(--accent2);color:#fff;border-radius:6px;padding:2px 7px;margin-left:8px;vertical-align:middle">🎨 ${d.theme}</span>`
      : '';
    html += `
      <div class="swipe-wrap" data-id="${d.id}" data-name="${escapeHtml(d.name)}" data-slug="${d.slug}" data-can-delete="${displays.length > 1 ? 1 : 0}">
        <div class="swipe-bg">
          <span class="swipe-bg-dup">⧉ Duplicate</span>
          <span class="swipe-bg-del">Delete 🗑️</span>
        </div>
        <div class="event-card swipe-card" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div class="event-card-title">${escapeHtml(d.name)}${themeBadge}</div>
            <div class="event-card-sub" style="word-break:break-all">${url}</div>
          </div>
          <div class="event-card-actions" style="flex-shrink:0">
            <button class="icon-btn display-copy-btn" data-url="${url}" title="Copy URL">📋</button>
            <button class="icon-btn display-editlayout-btn" data-slug="${d.slug}" data-name="${escapeHtml(d.name)}" title="Edit this profile's layout">🎛️</button>
            <button class="icon-btn display-rename-btn" data-id="${d.id}" data-name="${escapeHtml(d.name)}" title="Rename">✏️</button>
            ${displays.length > 1 ? `<button class="icon-btn del display-del-btn" data-id="${d.id}" data-name="${escapeHtml(d.name)}" title="Remove">🗑️</button>` : ''}
          </div>
        </div>
        <!-- Deliberately NOT appending ?preview=1 here — that flag disables
             direct-editing (tap-to-edit on the display itself), so this
             needs to be the actual, real display URL a screen would load,
             not the Layout tab's own testing-only Live Edit panel link above. Confirmed
             the hard way: someone reaching their real screen through a
             preview-flavored link (this one, prior to being re-enabled, or
             the Layout tab's own "Open in New Tab" button, which correctly
             stays preview-flavored on purpose) had no way to tell that was
             why direct-editing wasn't showing up. -->
        <a href="${url}" target="_blank" rel="noopener" style="display:inline-block;font-size:12px;color:var(--accent2);text-decoration:none">↗ Open this display in a new tab</a>        ${d.theme ? `<button class="display-cleartheme-btn" data-id="${d.id}" style="align-self:flex-start;background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer">Remove theme</button>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Force Orientation</label>
            <select class="form-input display-orientation-select" data-id="${d.id}">
              <option value="auto"      ${forceO==='auto'?'selected':''}>Use Screen Settings</option>
              <option value="landscape" ${forceO==='landscape'?'selected':''}>Landscape</option>
              <option value="portrait"  ${forceO==='portrait'?'selected':''}>Portrait</option>
            </select>
          </div>
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Rotate View</label>
            <select class="form-input display-rotation-select" data-id="${d.id}">
              <option value="0"   ${rot===0?'selected':''}>Use Screen Settings</option>
              <option value="90"  ${rot===90?'selected':''}>90° clockwise</option>
              <option value="180" ${rot===180?'selected':''}>180°</option>
              <option value="270" ${rot===270?'selected':''}>270° clockwise</option>
            </select>
          </div>
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Font</label>
            <select class="form-input display-font-select" data-id="${d.id}">
              <option value="">${d.theme === 'chalkboard' ? "Theme default (Caveat)" : "Default (Inter / DM Sans)"}</option>
              ${Object.keys(FONT_CHOICES).map(f => `<option value="${f}" ${d.fontFamily === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin:2px 0 0">"Rotate View" turns the whole display in the browser — use it to get landscape/portrait right without changing the Pi's OS screen rotation. "Font" applies to every widget on this profile, unless a specific widget has chosen its own.</p>
        </div>
      </div>`;
  });
  return html;
}

// Wires everything inside the profile-list fragment above (toggle button,
// swipe gestures, every per-card action). Callable standalone after either
// a full render OR an in-place toggle update — each call only finds/binds
// elements currently in the DOM, so re-running it after replacing the list
// fragment is safe (old elements are gone, not double-bound) and necessary
// (new elements start with no listeners at all).
function wireProfilesList(displays) {
  wireProfileSwipes();
  if ($('profiles-toggle-all-btn')) {
    $('profiles-toggle-all-btn').addEventListener('click', () => {
      // In-place only — deliberately NOT calling renderLayoutProfilesSubTab()
      // here, which would replace the whole sub-tab (intro text, the
      // add-profile input and anything half-typed in it, scroll position)
      // just to reveal a few more cards. That full replace was the
      // "collapses and reshows" effect. This recomputes the filtered set
      // from the same `displays`/activeSlugs this render already has
      // (closed over below), rebuilds ONLY the list container's HTML, and
      // rewires just that fragment.
      showAllProfiles = !showAllProfiles;
      refreshProfilesList(displays);
    });
  }
  document.querySelectorAll('.display-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.url));
  });

  document.querySelectorAll('.display-editlayout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remember which profile to open, then jump to the Editor sub-tab —
      // same idea as before (this used to jump to a separate Layout tab),
      // just staying within Layout's own sub-tabs now.
      currentDisplaySlug = btn.dataset.slug;
      try { localStorage.setItem('lastEditedDisplay', btn.dataset.slug); } catch {}
      layoutSubTab = 'editor';
      renderLayoutTab();
    });
  });

  document.querySelectorAll('.display-rename-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newName = prompt('Rename profile:', btn.dataset.name);
      if (!newName || !newName.trim() || newName.trim() === btn.dataset.name) return;
      await apiFetch(`/api/displays/${btn.dataset.id}`, {
        method: 'PUT', body: JSON.stringify({ name: newName.trim() }),
      });
      showToast('Profile renamed ✓');
      renderLayoutProfilesSubTab();
    });
  });

  document.querySelectorAll('.display-orientation-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/displays/${sel.dataset.id}`, {
        method: 'PUT', body: JSON.stringify({ force_orientation: sel.value }),
      });
      cachedDisplays = null; // invalidate so other views reflect the change
      if (r.error) showToast('❌ ' + r.error);
    });
  });

  document.querySelectorAll('.display-rotation-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/displays/${sel.dataset.id}`, {
        method: 'PUT', body: JSON.stringify({ rotation: parseInt(sel.value) }),
      });
      cachedDisplays = null; // invalidate so other views reflect the change
      if (r.error) showToast('❌ ' + r.error);
    });
  });

  document.querySelectorAll('.display-font-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/displays/${sel.dataset.id}`, {
        method: 'PUT', body: JSON.stringify({ fontFamily: sel.value }),
      });
      cachedDisplays = null; // invalidate so other views reflect the change
      if (r.error) showToast('❌ ' + r.error);
    });
  });

  document.querySelectorAll('.display-del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteDisplayById(btn.dataset.id, btn.dataset.name));
  });

  document.querySelectorAll('.display-cleartheme-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/api/displays/${btn.dataset.id}`, {
        method: 'PUT', body: JSON.stringify({ theme: '' }),
      });
      cachedDisplays = null;
      showToast('Theme removed');
      renderLayoutProfilesSubTab();
    });
  });
}

// The actual in-place update the toggle button triggers: recompute the
// visible set from the already-fetched `displays` (no re-fetch needed —
// active/inactive status doesn't change just because the filter did),
// swap only #profiles-list-wrap's contents, and rewire that fragment.
function refreshProfilesList(displays) {
  const activeSlugsSync = _lastProfilesActiveSlugs || new Set();
  const activeDisplays = displays.filter(d => activeSlugsSync.has(d.slug));
  const inactiveCount = displays.length - activeDisplays.length;
  const visibleDisplays = showAllProfiles ? displays : activeDisplays;
  const wrap = $('profiles-list-wrap');
  if (!wrap) return;
  wrap.innerHTML = buildProfilesListHtml(displays, visibleDisplays, inactiveCount);
  wireProfilesList(displays);
}
let _lastProfilesActiveSlugs = null; // set by renderLayoutProfilesSubTab, read by refreshProfilesList above

async function renderLayoutProfilesSubTab() {
  const displays = await getDisplaysList(true); // force refresh — this is the source of truth tab
  const activeSlugs = await getActiveDisplaySlugs(displays);
  _lastProfilesActiveSlugs = activeSlugs;
  const activeDisplays = displays.filter(d => activeSlugs.has(d.slug));
  const inactiveCount = displays.length - activeDisplays.length;
  // Same self-correcting rule as the offline-screens toggle: don't show an
  // empty list with nothing but a "Show all" link and no profiles at all
  // (e.g. no screens registered yet, so nothing counts as active).
  if (!activeDisplays.length && displays.length && !showAllProfiles) {
    showAllProfiles = true;
  }
  const visibleDisplays = showAllProfiles ? displays : activeDisplays;

  $('layout-subtab-content').innerHTML = `
    <p style="font-size:12px;color:var(--muted);margin:0 0 12px;padding:0 2px">Each profile is a saved widget layout. Calendars, photos, and other content are shared across all of them. <b>Swipe a profile left to delete, right to duplicate.</b></p>
    <div id="profiles-list-wrap">${buildProfilesListHtml(displays, visibleDisplays, inactiveCount)}</div>
    <div class="settings-card" style="margin-top:12px">
      <div class="settings-row">
        <label>Add a profile ${infoBtn("A new profile starts with the default layout — customize it here, then assign it to a screen in the Devices tab.")}</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="display-new-name" placeholder="e.g. Family Hub, Minimal, Photo Frame" style="flex:1">
          <button id="display-add-btn" style="background:var(--accent);border:none;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap">Add</button>
        </div>
      </div>
    </div>
  `;

  wireProfilesList(displays);
  $('display-add-btn').addEventListener('click', async () => {
    const name = $('display-new-name').value.trim();
    if (!name) { showToast('Enter a name for the display'); return; }
    const result = await apiFetch('/api/displays', {
      method: 'POST', body: JSON.stringify({ name }),
    });
    if (result.error) { showToast('❌ ' + result.error); return; }
    showToast(`Profile "${name}" added ✓`);
    renderLayoutProfilesSubTab();
  });
}

async function renderLayoutTemplatesSubTab() {
  $('layout-subtab-content').innerHTML = `
    <p style="font-size:12px;color:var(--muted);margin:0 0 12px;padding:0 2px">Applying one creates a <b>new profile</b> so your existing layouts are untouched.</p>
    <div id="template-gallery" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px"><div style="color:var(--muted);font-size:13px;padding:8px">Loading…</div></div>`;
  loadTemplateGallery();
}

async function renderLayoutSavedSubTab() {
  $('layout-subtab-content').innerHTML = `
    <p style="font-size:12px;color:var(--muted);margin:0 0 12px;padding:0 2px">Save one from the Editor sub-tab's "Save as Preset" button, then apply it to a screen or spin up a new profile.</p>
    <div id="saved-layout-list"><div style="color:var(--muted);font-size:13px;padding:8px">Loading…</div></div>`;
  loadSavedLayouts();
}

// Small visual swatch representing each theme in the template gallery, so the
// look is previewable without a full screenshot. Mirrors the display's scenes.
const TEMPLATE_SWATCH = {
  july4:    'radial-gradient(circle at 50% 120%, #1b2a6b, #05060f)',
  newyear:  'radial-gradient(circle at 50% 0%, #2a2350, #0a0818)',
  christmas:'radial-gradient(circle at 50% 30%, #14532d, #3b0d12)',
  minimalfam: 'linear-gradient(160deg, #a9b8a0, #7c8a72 65%, #56624f)',
  chalkboard: 'linear-gradient(160deg, #3a3f3a, #22261f)',
  corkboard:  'linear-gradient(160deg, #d9b98a, #c19a6b 60%, #a37b4f)',
  postit:   'linear-gradient(135deg, #cda968, #b88d4e)',
  easter:   'linear-gradient(160deg, #d9f0ff, #ffe5ec 55%, #e8fce9)',
  halloween:'radial-gradient(circle at 50% 120%, #3b1457, #0a0512)',
  autumn:   'radial-gradient(circle at 50% 0%, #7a3b12, #2e1a0d)',
  birthday: 'radial-gradient(circle at 50% 0%, #5a2a6b, #1a1030)',
  valentine:  'radial-gradient(circle at 50% 20%, #ff8fab, #e63950 65%, #8a1024)',
  spring:     'radial-gradient(circle at 50% 20%, #f4a6c0, #52b788 70%)',
  summer:     'linear-gradient(160deg, #ffb703, #0077b6 55%, #023e5c)',
  moderndark: 'radial-gradient(circle at 30% 20%, #22d3ee, #7c5cff 55%, #14101f)',
  homehub:    'radial-gradient(circle at 70% 30%, #7c5cff, #22d3ee 55%, #10141f)',
  minimal:  '#0a0e1a',
  photoframe: 'linear-gradient(160deg, #3a3530, #1a1815 55%, #2b2318)',
  dailydigest:   'linear-gradient(160deg, #e8dcc0, #b8863d 65%, #5c7d5c)',
  commandcenter: 'radial-gradient(circle at 30% 20%, #00d4b8, #0a84ff 55%, #061a2e)',
  aviation: 'linear-gradient(180deg, #0d2240, #3a5f8a 70%, #d98a4a)',
  flightdeck: 'radial-gradient(ellipse at 50% 100%, #5b8dd6, #10151f 65%, #0a0d12)',
  nautical: 'linear-gradient(180deg, #0a2e3d, #1c5a73 55%, #3f8fa8 85%, #e8c468)',
  thanksgiving: 'radial-gradient(circle at 50% 100%, #c2703a, #6b3a17 55%, #2c1608)',
  hanukkah: 'radial-gradient(circle at 50% 70%, #f2c94c, #1d3461 55%, #0a1830)',
  backtoschool: 'linear-gradient(160deg, #d9622b, #2f6b4f 65%, #1c3d2c)',
  custom: 'linear-gradient(160deg, #3a3a3a, #1a1a1a)',
};
const TEMPLATE_EMOJI = {
  july4:'🎆', newyear:'🎊', christmas:'🎄', minimalfam:'🌿', chalkboard:'✏️',
  corkboard:'📌', postit:'📝', easter:'🥚', halloween:'🎃', autumn:'🍁',
  birthday:'🎈', valentine:'💗', spring:'🌸', summer:'☀️', moderndark:'💠',
  homehub:'🏠', minimal:'▫️', photoframe:'🖼️', dailydigest:'📰', commandcenter:'🖥️',
  aviation:'✈️', flightdeck:'🛫', nautical:'⛵', thanksgiving:'🦃', hanukkah:'🕎',
  backtoschool:'🎒', custom:'🖌️',
};

async function loadTemplateGallery() {
  const gallery = $('template-gallery');
  if (!gallery) return;
  let templates;
  try {
    templates = await apiFetch('/api/templates');
  } catch {
    gallery.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">Couldn't load templates.</div>`;
    return;
  }
  if (!Array.isArray(templates) || !templates.length) {
    gallery.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">No templates available.</div>`;
    return;
  }

  // Group templates by category, in a sensible fixed order (unknown cats appended).
  const CAT_ORDER = ['Holidays', 'Seasons', 'Celebrations', 'General'];
  const byCat = {};
  templates.forEach(t => { const c = t.category || 'General'; (byCat[c] = byCat[c] || []).push(t); });
  const cats = [...CAT_ORDER.filter(c => byCat[c]), ...Object.keys(byCat).filter(c => !CAT_ORDER.includes(c))];

  const cardHtml = (t) => `
    <div class="template-card" data-id="${t.id}" data-name="${t.name.replace(/"/g,'&quot;')}"
         style="border:1px solid var(--border);border-radius:12px;overflow:hidden;cursor:pointer;background:var(--card)">
      <div style="height:74px;background:${TEMPLATE_SWATCH[t.id] || '#222'};display:flex;align-items:center;justify-content:center;font-size:30px">
        ${TEMPLATE_EMOJI[t.id] || '🎨'}
      </div>
      <div style="padding:8px 10px">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${t.name}</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.3;margin-top:3px">${t.blurb}</div>
      </div>
    </div>`;

  // Each category is an expandable accordion section: tap the header to reveal its
  // templates; opening one collapses the others. All collapsed by default.
  gallery.style.display = 'block';
  gallery.innerHTML = cats.map((cat) => `
    <div class="tmpl-cat" data-cat="${cat}">
      <button class="tmpl-cat-head" type="button">
        <span class="tmpl-cat-name">${cat}</span>
        <span class="tmpl-cat-count">${byCat[cat].length}</span>
        <span class="tmpl-cat-caret">▸</span>
      </button>
      <div class="tmpl-cat-body" style="display:none">
        <div class="tmpl-cat-grid">${byCat[cat].map(cardHtml).join('')}</div>
      </div>
    </div>
  `).join('');

  // Accordion behavior.
  gallery.querySelectorAll('.tmpl-cat-head').forEach(head => {
    head.addEventListener('click', () => {
      const sec = head.closest('.tmpl-cat');
      const isOpen = sec.classList.contains('open');
      gallery.querySelectorAll('.tmpl-cat').forEach(s => {
        s.classList.remove('open');
        s.querySelector('.tmpl-cat-body').style.display = 'none';
        s.querySelector('.tmpl-cat-caret').textContent = '▸';
      });
      if (!isOpen) {
        sec.classList.add('open');
        sec.querySelector('.tmpl-cat-body').style.display = '';
        sec.querySelector('.tmpl-cat-caret').textContent = '▾';
      }
    });
  });

  gallery.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.id;
      const defaultName = card.dataset.name;
      const name = prompt(`Create a new display from the "${defaultName}" template.\n\nName it:`, defaultName);
      if (name === null) return; // cancelled
      const finalName = name.trim() || defaultName;
      card.style.opacity = '0.5';
      const result = await apiFetch('/api/templates/apply', {
        method: 'POST', body: JSON.stringify({ templateId: id, name: finalName }),
      });
      if (result.error) { showToast('❌ ' + result.error); card.style.opacity = '1'; return; }
      cachedDisplays = null;
      showToast(`"${finalName}" created ✓`);
      renderLayoutTemplatesSubTab();
    });
  });
}

async function loadSavedLayouts() {
  const list = $('saved-layout-list');
  if (!list) return;
  let presets, displays;
  try {
    [presets, displays] = await Promise.all([
      apiFetch('/api/saved-layouts'),
      getDisplaysList(),
    ]);
  } catch {
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">Couldn't load saved layouts.</div>`;
    return;
  }
  if (!Array.isArray(presets) || !presets.length) {
    list.innerHTML = `<div class="empty-state" style="padding:16px"><div class="emoji">💾</div><p>No saved layouts yet.<br>Save one from the Layout tab.</p></div>`;
    return;
  }

  const displayOptions = (displays || []).map(d =>
    `<option value="${d.slug}">${escapeHtml(d.name)}</option>`
  ).join('');

  list.innerHTML = presets.map(p => {
    const themeBadge = p.theme
      ? `<span style="display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;background:var(--accent2);color:#fff;border-radius:6px;padding:2px 7px;margin-left:8px;vertical-align:middle">🎨 ${p.theme}</span>`
      : '';
    return `
      <div class="event-card" style="flex-direction:column;align-items:stretch;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div class="event-card-title">${escapeHtml(p.name)}${themeBadge}</div>
          </div>
          <button class="icon-btn del saved-del-btn" data-id="${p.id}" data-name="${(p.name||'').replace(/"/g,'&quot;')}" title="Delete preset">🗑️</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select class="form-input saved-target" data-id="${p.id}" style="flex:1;min-width:120px">${displayOptions}</select>
          <button class="btn saved-apply-current" data-id="${p.id}" style="background:var(--accent);border:none;color:#fff;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Apply to selected</button>
          <button class="btn saved-apply-new" data-id="${p.id}" data-name="${(p.name||'').replace(/"/g,'&quot;')}" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:8px 12px;font-size:13px;cursor:pointer;white-space:nowrap">Create new display</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.saved-apply-current').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const target = list.querySelector(`.saved-target[data-id="${id}"]`).value;
      const targetName = list.querySelector(`.saved-target[data-id="${id}"] option:checked`).textContent;
      if (!confirm(`Apply this layout onto "${targetName}"? Its current arrangement and theme will be replaced.`)) return;
      const r = await apiFetch(`/api/saved-layouts/${id}/apply`, {
        method: 'POST', body: JSON.stringify({ mode: 'current', display: target }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
      cachedDisplays = null;
      showToast(`Applied to ${targetName} ✓`);
    });
  });

  list.querySelectorAll('.saved-apply-new').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const defaultName = btn.dataset.name;
      const name = prompt('Create a new display from this layout.\n\nName it:', defaultName);
      if (name === null) return;
      const r = await apiFetch(`/api/saved-layouts/${id}/apply`, {
        method: 'POST', body: JSON.stringify({ mode: 'new', name: name.trim() || defaultName }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
      cachedDisplays = null;
      showToast(`"${name.trim() || defaultName}" created ✓`);
      renderLayoutSavedSubTab();
    });
  });

  list.querySelectorAll('.saved-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete the saved layout "${btn.dataset.name}"? This can't be undone.`)) return;
      await apiFetch(`/api/saved-layouts/${btn.dataset.id}`, { method: 'DELETE' });
      showToast('Preset deleted');
      loadSavedLayouts();
    });
  });
}

