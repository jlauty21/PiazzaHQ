// ── To-Do List / Shopping List / Chore Chart advanced settings ─────────────
// Same porting discipline as Calendar/Weather above: fields, defaults, and
// behavior taken directly from app.html's drawWidgetSettingsPanel() for
// these three types, not reinterpreted. All three are genuinely compact
// (each was under 40 lines in app.html), so unlike Calendar/Weather these
// don't need their own section-label groupings — just a flat list of rows.
// ── Tasks (Todoist, single project) — ported field-for-field from app.html's
// own settings panel for this type, same convention as Calendar/Weather/
// To-Do above. Previously missing entirely from Live Editing (this widget
// type wasn't in WIDGET_ADVANCED_TYPES at all), so tapping into its
// settings on the display just showed the generic "more settings available
// in the app" fallback instead of anything real.
function renderTasksAdvancedSettings(w) {
  const tkScalePct = Math.round(((w && w.taskFontScale) || 1) * 100);
  return `
    <div class="was-row">
      <label>Project</label>
      <select id="tasks-project-select">
        <option value="">Loading projects…</option>
      </select>
    </div>
    <div class="was-row">
      <label>Text Size ${infoBtn("Resizes both the list name and the task rows together.")}</label>
      <div class="was-range-row">
        <input type="range" id="task-font-scale" min="50" max="250" step="5" value="${tkScalePct}">
        <span class="was-range-val" id="task-font-scale-val">${tkScalePct}%</span>
      </div>
    </div>
    <p class="was-hint">Tap a task right on the display to mark it complete on Todoist.</p>
  `;
}
// Shared by both Tasks and Tasks Combined — same cache-once convention as
// cachedFeeds/cachedDisplays elsewhere in this file, so switching between
// widgets (or reopening the panel) doesn't refetch projects every time.
let cachedTodoistProjectsD = null;
async function fetchTodoistProjectsD() {
  if (cachedTodoistProjectsD) return cachedTodoistProjectsD;
  try {
    const result = await (await fetch('/api/todoist/projects')).json();
    if (Array.isArray(result)) { cachedTodoistProjectsD = result; return result; }
    return { error: (result && result.error) || 'Could not load projects' };
  } catch {
    return { error: 'Could not reach server' };
  }
}
async function populateTasksProjectDropdownD(w) {
  const result = await fetchTodoistProjectsD();
  const sel = document.getElementById('tasks-project-select');
  if (!sel) return; // panel may have been closed/redrawn already by the time this resolves
  if (!Array.isArray(result)) {
    sel.innerHTML = `<option value="">⚠️ ${escapeHtmlD(result.error)}</option>`;
    return;
  }
  sel.innerHTML = `
    <option value="">All Projects</option>
    ${result.map(p => `<option value="${escapeHtmlD(p.id)}" ${w.projectId === p.id ? 'selected' : ''}>${escapeHtmlD(p.name)}</option>`).join('')}
  `;
  sel.addEventListener('change', (e) => {
    const proj = result.find(p => p.id === e.target.value);
    w.projectId = e.target.value || null;
    w.projectName = proj ? proj.name : 'Tasks';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}
function wireTasksAdvancedSettings(w) {
  populateTasksProjectDropdownD(w);
  const scaleRange = document.getElementById('task-font-scale');
  if (scaleRange) scaleRange.addEventListener('input', (e) => {
    w.taskFontScale = parseInt(e.target.value, 10) / 100;
    document.getElementById('task-font-scale-val').textContent = e.target.value + '%';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

// ── Tasks Combined (Todoist, multiple projects grouped) — same porting
// approach as plain Tasks above.
function renderTasksCombinedAdvancedSettings(w) {
  const fontPx = (w && w.tcFontPx) || 14;
  const tcAlign = (w && w.tcAlign) || 'top';
  return `
    <div class="was-row">
      <label>Projects to Include ${infoBtn("Each selected project gets its own group with a header, all in one widget.")}</label>
      <div id="tc-project-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        <p class="was-hint">Loading projects…</p>
      </div>
    </div>
    <div class="was-row">
      <label>Vertical Alignment ${infoBtn("Where the task list sits within the widget's box when it doesn't fill the whole space.")}</label>
      <select id="tc-align-select">
        <option value="top" ${tcAlign==='top'?'selected':''}>Top</option>
        <option value="center" ${tcAlign==='center'?'selected':''}>Center</option>
        <option value="bottom" ${tcAlign==='bottom'?'selected':''}>Bottom</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="tc-font-range" min="8" max="56" step="1" value="${fontPx}">
        <span class="was-range-val" id="tc-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Show Due Date ${infoBtn("Tap a task right on the display to mark it complete on Todoist.")}</label>
      <input type="checkbox" id="tc-show-due" ${w.tcShowDue !== false ? 'checked' : ''}>
    </div>
  `;
}
async function populateTasksCombinedProjectListD(w) {
  const result = await fetchTodoistProjectsD();
  const container = document.getElementById('tc-project-list');
  if (!container) return; // panel may have been closed/redrawn already
  if (!Array.isArray(result)) {
    container.innerHTML = `<p class="was-hint">⚠️ ${escapeHtmlD(result.error)}</p>`;
    return;
  }
  if (!result.length) {
    container.innerHTML = `<p class="was-hint">No Todoist projects found.</p>`;
    return;
  }
  // No selection yet = nothing checked (unlike the calendar source filter,
  // an empty combined Tasks widget isn't useful by default) — same
  // convention app.html's own version of this uses.
  const activeSet = new Set(w.projectIds || []);
  container.innerHTML = result.map(p => `
    <label style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:400">
      <input type="checkbox" class="tc-project-cb" data-id="${escapeHtmlD(p.id)}" data-name="${escapeHtmlD(p.name)}" ${activeSet.has(p.id) ? 'checked' : ''}>
      ${escapeHtmlD(p.name)}
    </label>
  `).join('');
  container.querySelectorAll('.tc-project-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...container.querySelectorAll('.tc-project-cb:checked')];
      w.projectIds = checked.map(el => el.dataset.id);
      w.projectNames = w.projectNames || {};
      checked.forEach(el => { w.projectNames[el.dataset.id] = el.dataset.name; });
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  });
}
function wireTasksCombinedAdvancedSettings(w) {
  populateTasksCombinedProjectListD(w);
  const alignSel = document.getElementById('tc-align-select');
  if (alignSel) alignSel.addEventListener('change', (e) => {
    w.tcAlign = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('tc-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.tcFontPx = parseInt(e.target.value, 10);
    document.getElementById('tc-font-val').textContent = w.tcFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showDue = document.getElementById('tc-show-due');
  if (showDue) showDue.addEventListener('change', (e) => {
    w.tcShowDue = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderTodoAdvancedSettings(w, lists) {
  const fontPx = w.todoFontPx || 15;
  const listOptions = (lists && lists.length)
    ? lists.map(l => `<option value="${l.id}" ${Number(w.listId)===l.id?'selected':''}>${escapeHtmlD(l.name)}</option>`).join('')
    : '';
  return `
    <div class="was-row">
      <label>Which List</label>
      ${lists && lists.length ? `
      <select id="td-list-select">
        <option value="">Choose a list…</option>
        ${listOptions}
      </select>` : `<p class="was-hint">No to-do lists yet. Add one in the app's Settings → To-Do Lists.</p>`}
    </div>
    <div class="was-row">
      <label>Title (optional)</label>
      <input type="text" id="td-title" value="${escapeHtmlD(w.todoTitle||'')}" placeholder="Defaults to the list's own name">
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="td-font-range" min="8" max="80" step="1" value="${fontPx}">
        <span class="was-range-val" id="td-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Show completed items ${infoBtn("Tap an item right on the display to check it off, or add/manage items from Family Hub or the app.")}</label>
      <input type="checkbox" id="td-showdone" ${w.todoShowDone!==false?'checked':''}>
    </div>
  `;
}
function wireTodoAdvancedSettings(w) {
  const listSel = document.getElementById('td-list-select');
  if (listSel) listSel.addEventListener('change', (e) => {
    w.listId = e.target.value ? parseInt(e.target.value, 10) : null;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const titleInput = document.getElementById('td-title');
  if (titleInput) titleInput.addEventListener('input', (e) => {
    w.todoTitle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('td-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.todoFontPx = parseInt(e.target.value, 10);
    document.getElementById('td-font-val').textContent = w.todoFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showDone = document.getElementById('td-showdone');
  if (showDone) showDone.addEventListener('change', (e) => {
    w.todoShowDone = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderShoppingAdvancedSettings(w, lists) {
  const fontPx = w.shoppingFontPx || 15;
  const chosen = shoppingListForWidget(w, lists);
  const listPicker = (lists && lists.length) ? `
    <div class="was-row">
      <label>Which List ${infoBtn("Add more lists, like Costco or Pharmacy, in the app under Family Hub → Shopping. Each Shopping List widget shows one list.")}</label>
      <select id="sl-list-select">
        ${lists.map(l => `<option value="${l.id}" ${chosen && chosen.id === l.id ? 'selected' : ''}>${escapeHtmlD(l.name)}</option>`).join('')}
      </select>
    </div>` : '';
  return `
    ${listPicker}
    <div class="was-row">
      <label>Title</label>
      <input type="text" id="sl-title" value="${escapeHtmlD(w.shoppingTitle||'Shopping List')}">
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="sl-font-range" min="8" max="80" step="1" value="${fontPx}">
        <span class="was-range-val" id="sl-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Show checked-off items ${infoBtn("Tap an item right on the display to check it off, or add/manage items from Family Hub or the app.")}</label>
      <input type="checkbox" id="sl-showdone" ${w.shoppingShowDone!==false?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Shrink text to fit the whole list ${infoBtn("When the list is longer than the widget, the text shrinks until every item shows. A list that already fits keeps the font size above.")}</label>
      <input type="checkbox" id="sl-autofit" ${w.shoppingAutoFit!==false?'checked':''}>
    </div>
  `;
}
function wireShoppingAdvancedSettings(w) {
  const listSel = document.getElementById('sl-list-select');
  if (listSel) listSel.addEventListener('change', (e) => {
    w.shoppingListId = parseInt(e.target.value, 10);
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const titleInput = document.getElementById('sl-title');
  if (titleInput) titleInput.addEventListener('input', (e) => {
    w.shoppingTitle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('sl-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.shoppingFontPx = parseInt(e.target.value, 10);
    document.getElementById('sl-font-val').textContent = w.shoppingFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showDone = document.getElementById('sl-showdone');
  if (showDone) showDone.addEventListener('change', (e) => {
    w.shoppingShowDone = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const autoFit = document.getElementById('sl-autofit');
  if (autoFit) autoFit.addEventListener('change', (e) => {
    w.shoppingAutoFit = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderChoreChartAdvancedSettings(w, kids) {
  const fontPx = w.choreFontPx || 15;
  const selected = Array.isArray(w.choreKidIds) ? w.choreKidIds.map(String) : null; // null = all
  const kidChecks = (kids && kids.length) ? kids.map(k => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
      <input type="checkbox" class="cc-kid-pick" value="${k.id}" ${(!selected || selected.includes(String(k.id)))?'checked':''}>
      <span style="font-size:20px">${k.avatar||'🙂'}</span>
      <span style="color:${k.color}">${escapeHtmlD(k.name)}</span>
    </label>`).join('') : `<p class="was-hint">No kids yet. Add them in the app's Chores tab.</p>`;
  return `
    <div class="was-row">
      <label>Chart Title</label>
      <input type="text" id="cc-title" value="${escapeHtmlD(w.choreTitle||'Daily Chore Chart')}">
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="cc-font-range" min="8" max="80" step="1" value="${fontPx}">
        <span class="was-range-val" id="cc-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Which Children ${infoBtn("Defaults to everyone. Uncheck a child to leave them off this display.")}</label>
      <div id="cc-kid-picks">${kidChecks}</div>
    </div>
    <div class="was-toggle-row">
      <label>Show completed chores</label>
      <input type="checkbox" id="cc-showdone" ${w.choreShowDone!==false?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Show ⭐ Sticker Balance ${infoBtn("Shows each kid's sticker balance next to their streak, when they have one. On by default.")}</label>
      <input type="checkbox" id="cc-showstickers" ${w.choreShowStickers!==false?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Show ⭐ Bonus chores ${infoBtn("Adds a strip below the chart listing the shared bonus / extra-credit chores that are up for grabs today. Claiming still happens in the app or on the kid page. Off by default.")}</label>
      <input type="checkbox" id="cc-showbonus" ${w.choreShowBonus?'checked':''}>
    </div>
    <p class="was-hint">If this is blank on the display, make sure kids and chores are set up in the app's Chores tab.</p>
  `;
}
function wireChoreChartAdvancedSettings(w) {
  const titleInput = document.getElementById('cc-title');
  if (titleInput) titleInput.addEventListener('input', (e) => {
    w.choreTitle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('cc-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.choreFontPx = parseInt(e.target.value, 10);
    document.getElementById('cc-font-val').textContent = w.choreFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showDone = document.getElementById('cc-showdone');
  if (showDone) showDone.addEventListener('change', (e) => {
    w.choreShowDone = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showStickers = document.getElementById('cc-showstickers');
  if (showStickers) showStickers.addEventListener('change', (e) => {
    w.choreShowStickers = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showBonus = document.getElementById('cc-showbonus');
  if (showBonus) showBonus.addEventListener('change', (e) => {
    w.choreShowBonus = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const picks = document.querySelectorAll('.cc-kid-pick');
  const syncKidSel = () => {
    const all = [...picks];
    const checked = all.filter(c => c.checked).map(c => c.value);
    // If everyone is checked, store null (= all, future-proof for new kids) —
    // same convention app.html's own editor already uses for this field.
    w.choreKidIds = (checked.length === all.length) ? null : checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  };
  picks.forEach(c => c.addEventListener('change', syncKidSel));
}

function renderChoreLbAdvancedSettings(w, kids) {
  const fontPx = w.lbFontPx || 15;
  const selected = Array.isArray(w.lbKidIds) ? w.lbKidIds.map(String) : null; // null = all
  const kidChecks = (kids && kids.length) ? kids.map(k => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
      <input type="checkbox" class="lb-kid-pick" value="${k.id}" ${(!selected || selected.includes(String(k.id)))?'checked':''}>
      <span style="font-size:20px">${k.avatar||'🙂'}</span>
      <span style="color:${k.color}">${escapeHtmlD(k.name)}</span>
    </label>`).join('') : `<p class="was-hint">No kids yet. Add them in the app's Chores tab.</p>`;
  return `
    <div class="was-row">
      <label>Title</label>
      <input type="text" id="lb-title" value="${escapeHtmlD(w.lbTitle||'Chore Leaderboard')}">
    </div>
    <div class="was-row">
      <label>Rank By</label>
      <select id="lb-rankby">
        <option value="streak" ${(w.lbRankBy||'streak')==='streak'?'selected':''}>Current streak</option>
        <option value="weekly" ${w.lbRankBy==='weekly'?'selected':''}>Chores done this week</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="lb-font-range" min="8" max="80" step="1" value="${fontPx}">
        <span class="was-range-val" id="lb-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Which Children ${infoBtn("Defaults to everyone. Uncheck a child to leave them off this leaderboard.")}</label>
      <div id="lb-kid-picks">${kidChecks}</div>
    </div>
    <p class="was-hint">Ties are broken by name. If this is blank on the display, make sure kids and chores are set up in the app's Chores tab.</p>
  `;
}
function wireChoreLbAdvancedSettings(w) {
  const titleInput = document.getElementById('lb-title');
  if (titleInput) titleInput.addEventListener('input', (e) => {
    w.lbTitle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const rankBy = document.getElementById('lb-rankby');
  if (rankBy) rankBy.addEventListener('change', (e) => {
    w.lbRankBy = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('lb-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.lbFontPx = parseInt(e.target.value, 10);
    document.getElementById('lb-font-val').textContent = w.lbFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const picks = document.querySelectorAll('.lb-kid-pick');
  const syncKidSel = () => {
    const all = [...picks];
    const checked = all.filter(c => c.checked).map(c => c.value);
    w.lbKidIds = (checked.length === all.length) ? null : checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  };
  picks.forEach(c => c.addEventListener('change', syncKidSel));
}

function renderCountdownAdvancedSettings(w) {
  const fontPx = w.cdFontPx || 22;
  return `
    <div class="was-row">
      <label>Title</label>
      <input type="text" id="cd-title" value="${escapeHtmlD(w.cdTitle||'Countdown')}" placeholder="e.g. Disney Trip">
    </div>
    <div class="was-row">
      <label>Target Date</label>
      <input type="date" id="cd-date" value="${w.cdDate||''}">
    </div>
    <div class="was-row">
      <label>Time (optional)</label>
      <input type="time" id="cd-time" value="${w.cdTime||''}">
    </div>
    <div class="was-toggle-row">
      <label>Repeats every year ${infoBtn("For birthdays/anniversaries — always counts down to the next occurrence instead of going negative once the date passes.")}</label>
      <input type="checkbox" id="cd-repeat" ${w.cdRepeatYearly?'checked':''}>
    </div>
    <div class="was-row" id="cd-font-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="cd-font-range" min="8" max="100" step="1" value="${fontPx}">
        <span class="was-range-val" id="cd-font-val">${fontPx}px</span>
      </div>
    </div>
  `;
}
function wireCountdownAdvancedSettings(w) {
  const titleInput = document.getElementById('cd-title');
  if (titleInput) titleInput.addEventListener('input', (e) => {
    w.cdTitle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const dateInput = document.getElementById('cd-date');
  if (dateInput) dateInput.addEventListener('input', (e) => {
    w.cdDate = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const timeInput = document.getElementById('cd-time');
  if (timeInput) timeInput.addEventListener('input', (e) => {
    w.cdTime = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const repeatToggle = document.getElementById('cd-repeat');
  if (repeatToggle) repeatToggle.addEventListener('change', (e) => {
    w.cdRepeatYearly = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('cd-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.cdFontPx = parseInt(e.target.value, 10);
    document.getElementById('cd-font-val').textContent = w.cdFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderRadarAdvancedSettings(w) {
  const fontPx = w.radarFontPx || 16;
  const zoom = w.radarZoom || 6;
  const opacity = (w.radarOpacity !== undefined ? w.radarOpacity : 80);
  const frameCount = w.radarFrameCount || 6;
  const animate = !!w.radarAnimate;
  const showTime = w.radarShowTime !== false;
  return `
    <div class="was-row">
      <label>Title</label>
      <input type="text" id="radar-title" value="${escapeHtmlD(w.radarTitle||'Radar')}" placeholder="e.g. Radar">
    </div>
    <div class="was-box">
      <div class="was-toggle-row">
        <label>Override location for this widget ${infoBtn("Use a different location than the global one — e.g. a vacation house, or a storm you're tracking elsewhere. Leave off to use the location from Settings → Weather.")}</label>
        <input type="checkbox" id="radar-loc-override" ${(w.radarLat && w.radarLon) ? 'checked' : ''}>
      </div>
      <div id="radar-loc-override-fields" style="${(w.radarLat && w.radarLon) ? '' : 'display:none'};margin-top:10px">
        <label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">ZIP / Postal code</label>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input type="text" id="radar-loc-zip" placeholder="e.g. 90210" style="flex:1" inputmode="numeric">
          <button id="radar-loc-lookup" type="button" class="was-inline-btn">Look up</button>
        </div>
        <div id="radar-loc-status" class="was-hint">${(w.radarLat && w.radarLon) ? `📍 ${w.radarLat}, ${w.radarLon}` : 'No location set yet.'}</div>
      </div>
    </div>
    <div class="was-row">
      <label>Zoom Level</label>
      <div class="was-range-row">
        <input type="range" id="radar-zoom-range" min="3" max="8" step="1" value="${zoom}">
        <span class="was-range-val" id="radar-zoom-val">${zoom}</span>
      </div>
    </div>
    <div class="was-row">
      <label>Radar Opacity (%)</label>
      <div class="was-range-row">
        <input type="range" id="radar-opacity-range" min="10" max="100" step="5" value="${opacity}">
        <span class="was-range-val" id="radar-opacity-val">${opacity}%</span>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Show Frame Time ${infoBtn("Shows the currently-displayed frame's clock time and how old (or, for forecast frames, how far ahead) it is, as a small badge in the corner of the map.")}</label>
      <input type="checkbox" id="radar-show-time" ${showTime?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Animate ${infoBtn("Loops through the last several radar frames (about 10 minutes apart) instead of showing just the latest one. Uses a little more data/CPU on the display.")}</label>
      <input type="checkbox" id="radar-animate" ${animate?'checked':''}>
    </div>
    <div class="was-row" id="radar-frames-row" style="display:${animate?'block':'none'}">
      <label>Frames to Loop ${infoBtn("Up to ~13 frames is RainViewer's observed radar history — a hard 2-hour ceiling on their free tier, not a limit set here. Going higher extends the loop into their short-term nowcast: a near-future extrapolation (roughly 30–60 min ahead), not a full weather-model forecast.")}</label>
      <div class="was-range-row">
        <input type="range" id="radar-frames-range" min="2" max="20" step="1" value="${frameCount}">
        <span class="was-range-val" id="radar-frames-val">${frameCount}</span>
      </div>
    </div>
    <div class="was-row" id="radar-font-row">
      <label>Title Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="radar-font-range" min="8" max="64" step="1" value="${fontPx}">
        <span class="was-range-val" id="radar-font-val">${fontPx}px</span>
      </div>
    </div>
    <p class="was-hint" style="margin-top:-8px">Radar data from RainViewer — free, worldwide coverage, no account needed.</p>
  `;
}
function wireRadarAdvancedSettings(w) {
  const titleInput = document.getElementById('radar-title');
  if (titleInput) titleInput.addEventListener('input', (e) => {
    w.radarTitle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const ovToggle = document.getElementById('radar-loc-override');
  if (ovToggle) {
    ovToggle.addEventListener('change', (e) => {
      const fields = document.getElementById('radar-loc-override-fields');
      if (e.target.checked) {
        fields.style.display = '';
      } else {
        fields.style.display = 'none';
        delete w.radarLat; delete w.radarLon;
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        showDisplayToast('Using global weather location');
      }
    });
  }
  const lookupBtn = document.getElementById('radar-loc-lookup');
  if (lookupBtn) {
    lookupBtn.addEventListener('click', async () => {
      const zip = document.getElementById('radar-loc-zip').value.trim();
      const status = document.getElementById('radar-loc-status');
      if (!zip) { status.textContent = 'Enter a ZIP/postal code first.'; return; }
      status.textContent = 'Looking up…';
      try {
        const r = await (await fetch(`/api/geocode?save=0&zip=${encodeURIComponent(zip)}`)).json();
        if (r && r.lat && r.lon) {
          w.radarLat = String(r.lat); w.radarLon = String(r.lon);
          status.textContent = `📍 ${r.label || (r.lat + ', ' + r.lon)}`;
          rerenderSingleWidget(w.id);
          scheduleLayoutSave();
          showDisplayToast('Location set ✓');
        } else {
          status.textContent = r && r.error ? r.error : 'Could not find that location.';
        }
      } catch {
        status.textContent = 'Lookup failed — check your connection.';
      }
    });
  }
  const zoomRange = document.getElementById('radar-zoom-range');
  if (zoomRange) zoomRange.addEventListener('input', (e) => {
    w.radarZoom = parseInt(e.target.value, 10);
    document.getElementById('radar-zoom-val').textContent = w.radarZoom;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const opacityRange = document.getElementById('radar-opacity-range');
  if (opacityRange) opacityRange.addEventListener('input', (e) => {
    w.radarOpacity = parseInt(e.target.value, 10);
    document.getElementById('radar-opacity-val').textContent = w.radarOpacity + '%';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showTimeToggle = document.getElementById('radar-show-time');
  if (showTimeToggle) showTimeToggle.addEventListener('change', (e) => {
    w.radarShowTime = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const animateToggle = document.getElementById('radar-animate');
  if (animateToggle) animateToggle.addEventListener('change', (e) => {
    w.radarAnimate = e.target.checked;
    const framesRow = document.getElementById('radar-frames-row');
    if (framesRow) framesRow.style.display = w.radarAnimate ? 'block' : 'none';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const framesRange = document.getElementById('radar-frames-range');
  if (framesRange) framesRange.addEventListener('input', (e) => {
    w.radarFrameCount = parseInt(e.target.value, 10);
    document.getElementById('radar-frames-val').textContent = w.radarFrameCount;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('radar-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.radarFontPx = parseInt(e.target.value, 10);
    document.getElementById('radar-font-val').textContent = w.radarFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderQRCodeAdvancedSettings(w) {
  const preset = w.qrPreset || 'text';
  const fontPx = w.qrFontPx || 14;
  const sizePx = w.qrSizePx || 180;
  return `
    <div class="was-row">
      <label>Title (optional)</label>
      <input type="text" id="qr-title" value="${escapeHtmlD(w.qrTitle||'')}" placeholder="e.g. Join Our WiFi">
    </div>
    <div class="was-row">
      <label>Code Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="qr-size-range" min="80" max="500" step="10" value="${sizePx}">
        <span class="was-range-val" id="qr-size-val">${sizePx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Content Type</label>
      <select id="qr-preset">
        <option value="text" ${preset==='text'?'selected':''}>Text or URL</option>
        <option value="wifi" ${preset==='wifi'?'selected':''}>WiFi Network</option>
      </select>
    </div>
    <div class="was-row" id="qr-text-row" style="display:${preset==='text'?'block':'none'}">
      <label>Content</label>
      <textarea id="qr-content" rows="2" placeholder="https://example.com or any text" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:8px;color:#e8edf5;padding:11px 12px;font-size:14px;font-family:inherit">${escapeHtmlD(w.qrContent||'')}</textarea>
    </div>
    <div id="qr-wifi-rows" style="display:${preset==='wifi'?'block':'none'}">
      <div class="was-row">
        <label>Network Name (SSID)</label>
        <input type="text" id="qr-ssid" value="${escapeHtmlD(w.qrSSID||'')}" placeholder="e.g. HomeWiFi">
      </div>
      <div class="was-row">
        <label>Password</label>
        <input type="text" id="qr-password" value="${escapeHtmlD(w.qrPassword||'')}" placeholder="Network password">
      </div>
      <div class="was-row">
        <label>Security</label>
        <select id="qr-encryption">
          <option value="WPA" ${(w.qrEncryption||'WPA')==='WPA'?'selected':''}>WPA/WPA2</option>
          <option value="WEP" ${w.qrEncryption==='WEP'?'selected':''}>WEP</option>
          <option value="nopass" ${w.qrEncryption==='nopass'?'selected':''}>None (open network)</option>
        </select>
      </div>
      <p class="was-hint" style="margin-top:-8px">Guests scan this to join automatically — no typing the password. Password is stored in your layout data like any other widget setting.</p>
    </div>
    <div class="was-row">
      <label>Title Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="qr-font-range" min="8" max="56" step="1" value="${fontPx}">
        <span class="was-range-val" id="qr-font-val">${fontPx}px</span>
      </div>
    </div>
  `;
}
function wireQRCodeAdvancedSettings(w) {
  const titleInput = document.getElementById('qr-title');
  if (titleInput) titleInput.addEventListener('input', (e) => {
    w.qrTitle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const sizeRange = document.getElementById('qr-size-range');
  if (sizeRange) sizeRange.addEventListener('input', (e) => {
    w.qrSizePx = parseInt(e.target.value, 10);
    document.getElementById('qr-size-val').textContent = w.qrSizePx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const presetSel = document.getElementById('qr-preset');
  if (presetSel) presetSel.addEventListener('change', (e) => {
    w.qrPreset = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    // Re-render the panel itself so the right content-type rows show/hide —
    // same self-refresh pattern the calendar layout-style selector already
    // uses, not a fresh idea invented just for this widget.
    openWidgetAdvancedPanel(w.id);
  });
  const contentInput = document.getElementById('qr-content');
  if (contentInput) contentInput.addEventListener('input', (e) => {
    w.qrContent = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const ssidInput = document.getElementById('qr-ssid');
  if (ssidInput) ssidInput.addEventListener('input', (e) => {
    w.qrSSID = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const pwInput = document.getElementById('qr-password');
  if (pwInput) pwInput.addEventListener('input', (e) => {
    w.qrPassword = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const encSel = document.getElementById('qr-encryption');
  if (encSel) encSel.addEventListener('change', (e) => {
    w.qrEncryption = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('qr-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.qrFontPx = parseInt(e.target.value, 10);
    document.getElementById('qr-font-val').textContent = w.qrFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderTimerAdvancedSettings(w) {
  const fontPx = w.timerFontPx || 32;
  const isRunning = !!w.timerEndsAt;
  const isPaused = !isRunning && typeof w.timerRemainingSec === 'number' && w.timerRemainingSec > 0;
  return `
    <div class="was-row">
      <label>Title</label>
      <input type="text" id="tm-title" value="${escapeHtmlD(w.timerTitle||'Timer')}">
    </div>
    <div class="was-row">
      <label>Duration (minutes)</label>
      <input type="number" id="tm-minutes" min="1" max="240" step="1" value="${w.timerMinutes||5}" ${isRunning||isPaused?'disabled':''}>
      ${isRunning||isPaused ? '<p class="was-hint">Reset the timer to change the duration.</p>' : ''}
    </div>
    <div class="was-row" style="display:flex;gap:8px">
      ${!isRunning && !isPaused ? `<button type="button" id="tm-start" class="was-inline-btn" style="flex:1;height:44px">▶ Start</button>` : ''}
      ${isRunning ? `<button type="button" id="tm-pause" class="was-inline-btn" style="flex:1;height:44px;background:rgba(255,255,255,0.12)">⏸ Pause</button>` : ''}
      ${isPaused ? `<button type="button" id="tm-resume" class="was-inline-btn" style="flex:1;height:44px">▶ Resume</button>` : ''}
      ${isRunning || isPaused ? `<button type="button" id="tm-reset" class="was-inline-btn" style="flex:1;height:44px;background:rgba(255,255,255,0.12)">↺ Reset</button>` : ''}
    </div>
    <p class="was-hint">Start/Pause/Reset live here in the settings panel — the countdown itself shows live on the widget, updating every second.</p>
    <div class="was-row" id="tm-font-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="tm-font-range" min="12" max="110" step="1" value="${fontPx}">
        <span class="was-range-val" id="tm-font-val">${fontPx}px</span>
      </div>
    </div>
  `;
}
function wireTimerAdvancedSettings(w) {
  const titleInput = document.getElementById('tm-title');
  if (titleInput) titleInput.addEventListener('input', (e) => {
    w.timerTitle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const minutesInput = document.getElementById('tm-minutes');
  if (minutesInput) minutesInput.addEventListener('input', (e) => {
    w.timerMinutes = parseInt(e.target.value, 10) || 5;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('tm-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.timerFontPx = parseInt(e.target.value, 10);
    document.getElementById('tm-font-val').textContent = w.timerFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  // Start/Pause/Resume/Reset mutate real running-timer state (timerEndsAt /
  // timerRemainingSec), same math as app.html's own editor uses — then
  // re-render the WHOLE panel (not just the widget), since which buttons
  // show depends on the timer's new running/paused/idle state, same
  // self-refresh reasoning as the calendar layout-style selector.
  const startBtn = document.getElementById('tm-start');
  if (startBtn) startBtn.addEventListener('click', () => {
    const mins = w.timerMinutes || 5;
    w.timerEndsAt = new Date(Date.now() + mins * 60000).toISOString();
    w.timerRemainingSec = null;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    openWidgetAdvancedPanel(w.id);
  });
  const pauseBtn = document.getElementById('tm-pause');
  if (pauseBtn) pauseBtn.addEventListener('click', () => {
    if (w.timerEndsAt) {
      w.timerRemainingSec = Math.max(0, Math.round((new Date(w.timerEndsAt).getTime() - Date.now()) / 1000));
    }
    w.timerEndsAt = null;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    openWidgetAdvancedPanel(w.id);
  });
  const resumeBtn = document.getElementById('tm-resume');
  if (resumeBtn) resumeBtn.addEventListener('click', () => {
    const remaining = typeof w.timerRemainingSec === 'number' ? w.timerRemainingSec : (w.timerMinutes || 5) * 60;
    w.timerEndsAt = new Date(Date.now() + remaining * 1000).toISOString();
    w.timerRemainingSec = null;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    openWidgetAdvancedPanel(w.id);
  });
  const resetBtn = document.getElementById('tm-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    w.timerEndsAt = null;
    w.timerRemainingSec = null;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    openWidgetAdvancedPanel(w.id);
  });
}

function renderMoonPhaseAdvancedSettings(w) {
  const fontPx = w.mpFontPx || 20;
  return `
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="mp-font-range" min="8" max="80" step="1" value="${fontPx}">
        <span class="was-range-val" id="mp-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Show illumination %</label>
      <input type="checkbox" id="mp-show-illum" ${w.mpShowIllum!==false?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Show lunar cycle day ${infoBtn("Computed locally from a standard moon-cycle formula — no internet needed, works even if the Pi is offline.")}</label>
      <input type="checkbox" id="mp-show-age" ${w.mpShowAge?'checked':''}>
    </div>
  `;
}
function wireMoonPhaseAdvancedSettings(w) {
  const fontRange = document.getElementById('mp-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.mpFontPx = parseInt(e.target.value, 10);
    document.getElementById('mp-font-val').textContent = w.mpFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showIllum = document.getElementById('mp-show-illum');
  if (showIllum) showIllum.addEventListener('change', (e) => {
    w.mpShowIllum = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showAge = document.getElementById('mp-show-age');
  if (showAge) showAge.addEventListener('change', (e) => {
    w.mpShowAge = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderAirQualityAdvancedSettings(w) {
  const fontPx = w.aqFontPx || 18;
  return `
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="aq-font-range" min="8" max="72" step="1" value="${fontPx}">
        <span class="was-range-val" id="aq-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Show UV Index</label>
      <input type="checkbox" id="aq-show-uv" ${w.aqShowUV!==false?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Show Pollen ${infoBtn("Uses the same location as the Weather widget. Pollen data is currently only available for European locations from the free data source this uses — it'll just show AQI/PM/UV elsewhere.")}</label>
      <input type="checkbox" id="aq-show-pollen" ${w.aqShowPollen!==false?'checked':''}>
    </div>
  `;
}
function wireAirQualityAdvancedSettings(w) {
  const fontRange = document.getElementById('aq-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.aqFontPx = parseInt(e.target.value, 10);
    document.getElementById('aq-font-val').textContent = w.aqFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showUV = document.getElementById('aq-show-uv');
  if (showUV) showUV.addEventListener('change', (e) => {
    w.aqShowUV = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showPollen = document.getElementById('aq-show-pollen');
  if (showPollen) showPollen.addEventListener('change', (e) => {
    w.aqShowPollen = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderOnThisDayAdvancedSettings(w) {
  const fontPx = w.otdFontPx || 15;
  const maxItems = w.otdMaxItems || 4;
  return `
    <div class="was-row">
      <label>Max Items</label>
      <div class="was-range-row">
        <input type="range" id="otd-max-range" min="1" max="6" step="1" value="${maxItems}">
        <span class="was-range-val" id="otd-max-val">${maxItems}</span>
      </div>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="otd-font-range" min="8" max="64" step="1" value="${fontPx}">
        <span class="was-range-val" id="otd-font-val">${fontPx}px</span>
      </div>
    </div>
    <p class="was-hint">Historical events from Wikipedia's "On This Day" — a fresh random pick each day so it doesn't repeat the exact same facts every year.</p>
  `;
}
function wireOnThisDayAdvancedSettings(w) {
  const maxRange = document.getElementById('otd-max-range');
  if (maxRange) maxRange.addEventListener('input', (e) => {
    w.otdMaxItems = parseInt(e.target.value, 10);
    document.getElementById('otd-max-val').textContent = w.otdMaxItems;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('otd-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.otdFontPx = parseInt(e.target.value, 10);
    document.getElementById('otd-font-val').textContent = w.otdFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderDailyQuoteAdvancedSettings(w) {
  const fontPx = w.dqFontPx || 20;
  return `
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="dq-font-range" min="10" max="80" step="1" value="${fontPx}">
        <span class="was-range-val" id="dq-font-val">${fontPx}px</span>
      </div>
    </div>
    <p class="was-hint">A new inspirational quote each day, with attribution.</p>
  `;
}
function wireDailyQuoteAdvancedSettings(w) {
  const fontRange = document.getElementById('dq-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.dqFontPx = parseInt(e.target.value, 10);
    document.getElementById('dq-font-val').textContent = w.dqFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderMetarAdvancedSettings(w) {
  const fontPx = w.wxFontPx || 16;
  return `
    <div class="was-row">
      <label>Airport (ICAO code) ${infoBtn("The 4-letter ICAO code, not the 3-letter airport code (e.g. KJFK, not JFK).")}</label>
      <input type="text" id="wx-icao" value="${escapeHtmlD(w.wxIcao||'')}" placeholder="e.g. KJFK" style="text-transform:uppercase" maxlength="4">
    </div>
    <div class="was-toggle-row">
      <label>Show forecast (TAF)</label>
      <input type="checkbox" id="wx-show-taf" ${w.wxShowTaf!==false?'checked':''}>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="wx-font-range" min="8" max="64" step="1" value="${fontPx}">
        <span class="was-range-val" id="wx-font-val">${fontPx}px</span>
      </div>
    </div>
    <p class="was-hint">Live METAR conditions and TAF forecast from NOAA's Aviation Weather Center. Flight category (VFR/MVFR/IFR/LIFR) is computed from the reported visibility and cloud ceiling.</p>
  `;
}
function wireMetarAdvancedSettings(w) {
  const icaoInput = document.getElementById('wx-icao');
  if (icaoInput) icaoInput.addEventListener('input', (e) => {
    w.wxIcao = e.target.value.toUpperCase();
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  // A new ICAO code has no data yet in state.metarTaf until fetched — the
  // debounced save alone won't trigger that fetch, so kick it off directly
  // once someone's actually finished typing (blur), same "don't fetch on
  // every keystroke" restraint the weather ZIP lookup and location field
  // already use elsewhere in this file.
  if (icaoInput) icaoInput.addEventListener('blur', async () => {
    if (w.wxIcao) { await fetchMetarTaf(); rerenderSingleWidget(w.id); }
  });
  const showTaf = document.getElementById('wx-show-taf');
  if (showTaf) showTaf.addEventListener('change', (e) => {
    w.wxShowTaf = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('wx-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.wxFontPx = parseInt(e.target.value, 10);
    document.getElementById('wx-font-val').textContent = w.wxFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderClockAdvancedSettings(w) {
  const fontPx = w.clockFontPx || 90;
  const timeFormat = w.clockTimeFormat || 'default';
  const clockStyle = w.clockStyle || 'digital';
  const analogStyle = w.analogStyle || 'line';
  return `
    <div class="was-row">
      <label>Style</label>
      <select id="clock-style">
        <option value="digital" ${clockStyle==='digital'?'selected':''}>Digital</option>
        <option value="analog" ${clockStyle==='analog'?'selected':''}>Analog</option>
      </select>
    </div>
    <div class="was-row" id="clock-analog-style-row" style="${clockStyle === 'analog' ? '' : 'display:none'}">
      <label>Face</label>
      <select id="clock-analog-style">
        <option value="line" ${analogStyle==='line'?'selected':''}>Minimalist Line</option>
        <option value="aviation" ${analogStyle==='aviation'?'selected':''}>Aviation Chronograph</option>
        <option value="brass" ${analogStyle==='brass'?'selected':''}>Warm Brass</option>
        <option value="bold" ${analogStyle==='bold'?'selected':''}>Bold Modern</option>
      </select>
    </div>
    <div class="was-row" id="clock-font-row">
      <label>${clockStyle === 'analog' ? 'Size (px)' : 'Font Size (px)'}</label>
      <div class="was-range-row">
        <input type="range" id="clock-font-range" min="30" max="400" step="2" value="${fontPx}">
        <span class="was-range-val" id="clock-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row" id="clock-time-format-row" style="${clockStyle === 'analog' ? 'display:none' : ''}">
      <label>Time Format</label>
      <select id="clock-time-format">
        <option value="default" ${timeFormat==='default'?'selected':''}>Use display setting</option>
        <option value="12" ${timeFormat==='12'?'selected':''}>12-hour (2:30 PM)</option>
        <option value="24" ${timeFormat==='24'?'selected':''}>24-hour (14:30)</option>
      </select>
    </div>
    <div class="was-row" id="clock-ampm-case-row" style="${clockStyle === 'analog' ? 'display:none' : ''}">
      <label>AM/PM Style</label>
      <select id="clock-ampm-case">
        <option value="default" ${(w.clockAmpmCase||'default')==='default'?'selected':''}>Use display setting</option>
        <option value="lower" ${w.clockAmpmCase==='lower'?'selected':''}>Lowercase (2:30 pm)</option>
        <option value="upper" ${w.clockAmpmCase==='upper'?'selected':''}>Uppercase (2:30 PM)</option>
      </select>
    </div>
  `;
}
function wireClockAdvancedSettings(w) {
  const styleSel = document.getElementById('clock-style');
  if (styleSel) styleSel.addEventListener('change', (e) => {
    w.clockStyle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    // Whether the Face row (only meaningful when Style is Analog), the Time
    // Format row (meaningless for an analog face), and the font-size row's
    // own label ("Size" vs "Font Size") show correctly all depend on the
    // style just picked — reopen, same self-refresh pattern as every other
    // type-switching field in this file.
    openWidgetAdvancedPanel(w.id);
  });
  const analogStyleSel = document.getElementById('clock-analog-style');
  if (analogStyleSel) analogStyleSel.addEventListener('change', (e) => {
    w.analogStyle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('clock-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.clockFontPx = parseInt(e.target.value, 10);
    document.getElementById('clock-font-val').textContent = w.clockFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const ampmCaseSel = document.getElementById('clock-ampm-case');
  if (ampmCaseSel) ampmCaseSel.addEventListener('change', (e) => {
    w.clockAmpmCase = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const timeFormatSel = document.getElementById('clock-time-format');
  if (timeFormatSel) timeFormatSel.addEventListener('change', (e) => {
    w.clockTimeFormat = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

// Short label for each date_format value, reused wherever a "Use global
// default (X)" option needs to show what the global choice actually is.
const DATE_FORMAT_LABELS = {
  locale: 'Follow the language',
  us_long: 'August 5, 2026 (US)',
  intl_long: '5 August 2026 (International)',
  iso: '2026-08-05 (ISO)',
  us_short: '08/05/2026 (US numeric)',
  intl_short: '05/08/2026 (International numeric)',
  us_ordinal: 'August 5th, 2026 (Ordinal)',
  intl_ordinal: '5th of August 2026 (International Ordinal)',
};
// Shared "Date Format" override row for the calendar-related widgets (Mini
// Calendar, Agenda, Upcoming, Today) — same options and the same "Use
// global default" pattern as the standalone Date widget's own dropdown
// below, just parametrized per widget since each stores its override
// under its own prefixed field name (calDateFormat, agDateFormat, etc.).
function dateFormatOverrideRowHtml(selectId, currentValue) {
  const globalLabel = DATE_FORMAT_LABELS[globalDateFormat()] || DATE_FORMAT_LABELS.us_long;
  return `
    <div class="was-row">
      <label>Date Format</label>
      <select id="${selectId}">
        <option value=""            ${!currentValue?'selected':''}>Use global default (${globalLabel})</option>
        <option value="us_long"    ${currentValue==='us_long'?'selected':''}>August 5, 2026 (US)</option>
        <option value="intl_long"  ${currentValue==='intl_long'?'selected':''}>5 August 2026 (International)</option>
        <option value="iso"        ${currentValue==='iso'?'selected':''}>2026-08-05 (ISO)</option>
        <option value="us_short"   ${currentValue==='us_short'?'selected':''}>08/05/2026 (US numeric)</option>
        <option value="intl_short" ${currentValue==='intl_short'?'selected':''}>05/08/2026 (International numeric)</option>
        <option value="us_ordinal" ${currentValue==='us_ordinal'?'selected':''}>August 5th, 2026 (Ordinal)</option>
        <option value="intl_ordinal" ${currentValue==='intl_ordinal'?'selected':''}>5th of August 2026 (International Ordinal)</option>
      </select>
    </div>
  `;
}
// Shared "AM/PM Style" override row for the calendar-related widgets (Mini
// Calendar, Agenda, Upcoming, Today) — same "Use display setting" pattern
// as the Clock widget's own dropdown, parametrized per widget since each
// stores its override under its own prefixed field name (calAmpmCase,
// agAmpmCase, etc.).
function ampmCaseOverrideRowHtml(selectId, currentValue) {
  return `
    <div class="was-row">
      <label>AM/PM Style</label>
      <select id="${selectId}">
        <option value="default" ${!currentValue||currentValue==='default'?'selected':''}>Use display setting</option>
        <option value="lower" ${currentValue==='lower'?'selected':''}>Lowercase (2:30 pm)</option>
        <option value="upper" ${currentValue==='upper'?'selected':''}>Uppercase (2:30 PM)</option>
      </select>
    </div>
  `;
}
function renderDateAdvancedSettings(w) {
  const fontPx = w.dateFontPx || 24;
  const globalLabel = DATE_FORMAT_LABELS[globalDateFormat()] || DATE_FORMAT_LABELS.us_long;
  return `
    <div class="was-row" id="date-font-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="date-font-range" min="10" max="200" step="1" value="${fontPx}">
        <span class="was-range-val" id="date-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Date Format</label>
      <select id="date-format-select">
        <option value=""            ${!w.dateFormat?'selected':''}>Use global default (${globalLabel})</option>
        <option value="us_long"    ${w.dateFormat==='us_long'?'selected':''}>August 5, 2026 (US)</option>
        <option value="intl_long"  ${w.dateFormat==='intl_long'?'selected':''}>5 August 2026 (International)</option>
        <option value="iso"        ${w.dateFormat==='iso'?'selected':''}>2026-08-05 (ISO)</option>
        <option value="us_short"   ${w.dateFormat==='us_short'?'selected':''}>08/05/2026 (US numeric)</option>
        <option value="intl_short" ${w.dateFormat==='intl_short'?'selected':''}>05/08/2026 (International numeric)</option>
        <option value="us_ordinal" ${w.dateFormat==='us_ordinal'?'selected':''}>August 5th, 2026 (Ordinal)</option>
        <option value="intl_ordinal" ${w.dateFormat==='intl_ordinal'?'selected':''}>5th of August 2026 (International Ordinal)</option>
      </select>
    </div>
  `;
}
function wireDateAdvancedSettings(w) {
  const fontRange = document.getElementById('date-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.dateFontPx = parseInt(e.target.value, 10);
    document.getElementById('date-font-val').textContent = w.dateFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const formatSel = document.getElementById('date-format-select');
  if (formatSel) formatSel.addEventListener('change', (e) => {
    w.dateFormat = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

// One row of the Date & Time widget's per-item font-size overrides — 0
// means "Auto" (unset, falls through to the proportional calc() rule in
// CSS), any other value is an explicit px override for just that one
// element. Six of these share this same shape (Time/Seconds/AM-PM/Day
// Name/Date/Temperature), so it's written once rather than six times.
function dtSizeOverrideRowHtml(id, label, currentValue, max) {
  const val = currentValue || 0;
  return `
    <div class="was-row">
      <label>${label}</label>
      <div class="was-range-row">
        <input type="range" id="${id}" min="0" max="${max}" step="1" value="${val}">
        <span class="was-range-val" id="${id}-val">${val ? val + 'px' : 'Auto'}</span>
      </div>
    </div>
  `;
}
function renderDateTimeAdvancedSettings(w) {
  const style = w.dtStyle || 'classic';
  const fontPx = w.dtFontPx || 70;
  const timeFormat = w.dtTimeFormat || 'default';
  return `
    <div class="was-row">
      <label>Style</label>
      <select id="dt-style-select">
        <option value="classic" ${style==='classic'?'selected':''}>Classic (stacked)</option>
        <option value="split" ${style==='split'?'selected':''}>Split (side by side)</option>
      </select>
    </div>
    <div class="was-row">
      <label>Alignment</label>
      <select id="dt-align-select">
        <option value="left" ${(w.dtAlign||'left')==='left'?'selected':''}>Left</option>
        <option value="right" ${w.dtAlign==='right'?'selected':''}>Right</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="dt-font-range" min="20" max="300" step="2" value="${fontPx}">
        <span class="was-range-val" id="dt-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Per-Item Font Sizes ${infoBtn("Each item defaults to a proportional share of the Font Size above. Drag any of these off 0 to size that one item independently instead — set it back to 0 (Auto) to return it to proportional.")}</label>
    </div>
    ${dtSizeOverrideRowHtml('dt-time-size', 'Time', w.dtTimeSizePx, 300)}
    ${dtSizeOverrideRowHtml('dt-seconds-size', 'Seconds', w.dtSecondsSizePx, 200)}
    ${dtSizeOverrideRowHtml('dt-ampm-size', 'AM/PM', w.dtAmpmSizePx, 200)}
    ${dtSizeOverrideRowHtml('dt-day-size', 'Day Name', w.dtDaySizePx, 200)}
    ${dtSizeOverrideRowHtml('dt-date-size', 'Date', w.dtDateSizePx, 200)}
    ${dtSizeOverrideRowHtml('dt-temp-size', 'Temperature', w.dtTempSizePx, 200)}
    <div class="was-toggle-row">
      <label>Show Seconds</label>
      <input type="checkbox" id="dt-show-seconds" ${w.dtShowSeconds?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Show Date</label>
      <input type="checkbox" id="dt-show-date" ${w.dtShowDate !== false ? 'checked' : ''}>
    </div>
    <div class="was-toggle-row">
      <label>Show Temperature ${infoBtn("Pulls from this display's Weather settings — same location/unit any Weather widget uses. Shows a loading dot until the first weather fetch completes.")}</label>
      <input type="checkbox" id="dt-show-temp" ${w.dtShowTemp?'checked':''}>
    </div>
    <div class="was-row">
      <label>Time Format</label>
      <select id="dt-time-format">
        <option value="default" ${timeFormat==='default'?'selected':''}>Use display setting</option>
        <option value="12" ${timeFormat==='12'?'selected':''}>12-hour (2:30 PM)</option>
        <option value="24" ${timeFormat==='24'?'selected':''}>24-hour (14:30)</option>
      </select>
    </div>
    ${ampmCaseOverrideRowHtml('dt-ampm-case-select', w.dtAmpmCase)}
    ${dateFormatOverrideRowHtml('dt-date-format-select', w.dtDateFormat)}
  `;
}
function wireDateTimeAdvancedSettings(w) {
  const styleSel = document.getElementById('dt-style-select');
  if (styleSel) styleSel.addEventListener('change', (e) => {
    w.dtStyle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const alignSel = document.getElementById('dt-align-select');
  if (alignSel) alignSel.addEventListener('change', (e) => {
    w.dtAlign = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('dt-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.dtFontPx = parseInt(e.target.value, 10);
    document.getElementById('dt-font-val').textContent = w.dtFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  // Same wiring shape for all six per-item size overrides — 0 clears the
  // override back to Auto (proportional), matching dtSizeOverrideRowHtml's
  // own 0-means-Auto convention above.
  [['dt-time-size', 'dtTimeSizePx'], ['dt-seconds-size', 'dtSecondsSizePx'],
   ['dt-ampm-size', 'dtAmpmSizePx'], ['dt-day-size', 'dtDaySizePx'],
   ['dt-date-size', 'dtDateSizePx'], ['dt-temp-size', 'dtTempSizePx']].forEach(([id, field]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (v) w[field] = v; else delete w[field];
      document.getElementById(id + '-val').textContent = v ? v + 'px' : 'Auto';
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  });
  const showSeconds = document.getElementById('dt-show-seconds');
  if (showSeconds) showSeconds.addEventListener('change', (e) => { w.dtShowSeconds = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showDate = document.getElementById('dt-show-date');
  if (showDate) showDate.addEventListener('change', (e) => { w.dtShowDate = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showTemp = document.getElementById('dt-show-temp');
  if (showTemp) showTemp.addEventListener('change', (e) => { w.dtShowTemp = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const timeFormatSel = document.getElementById('dt-time-format');
  if (timeFormatSel) timeFormatSel.addEventListener('change', (e) => { w.dtTimeFormat = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  onLiveField('dt-ampm-case-select', 'change', (el) => { w.dtAmpmCase = el.value; });
  onLiveField('dt-date-format-select', 'change', (el) => { w.dtDateFormat = el.value; });
}

function renderRemindersAdvancedSettings(w) {
  const style = w.remStyle || 'banner';
  const fontPx = w.remFontPx || 22;
  return `
    <div class="was-row">
      <label>Style</label>
      <select id="rem-style-select">
        <option value="banner" ${style==='banner'?'selected':''}>Banner (soonest reminder)</option>
        <option value="list" ${style==='list'?'selected':''}>List (all reminders)</option>
        <option value="hero" ${style==='hero'?'selected':''}>Hero + chips</option>
        <option value="week" ${style==='week'?'selected':''}>Weekly strip</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="rem-font-range" min="12" max="60" step="1" value="${fontPx}">
        <span class="was-range-val" id="rem-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <button id="rem-manage-btn" type="button" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(74,144,217,0.15);color:#fff;font-size:14px;font-weight:600">🗑️ Manage Reminders</button>
      <p style="font-size:11.5px;color:rgba(255,255,255,0.5);margin:8px 0 0">Reminders are shared across every Reminders widget and the calendar — add or edit one here, it updates everywhere.</p>
    </div>
  `;
}
function wireRemindersAdvancedSettings(w) {
  const styleSel = document.getElementById('rem-style-select');
  if (styleSel) styleSel.addEventListener('change', (e) => {
    w.remStyle = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('rem-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.remFontPx = parseInt(e.target.value, 10);
    document.getElementById('rem-font-val').textContent = w.remFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  // Safe to re-wire every time this settings panel opens (unlike the modal
  // itself, below) — this button is part of renderRemindersAdvancedSettings()'s
  // own output, freshly created in the DOM each time body.innerHTML is set.
  const manageBtn = document.getElementById('rem-manage-btn');
  if (manageBtn) manageBtn.addEventListener('click', openManageRemindersPanel);
}

function renderMessageBoardAdvancedSettings(w) {
  const fontPx = w.mbFontPx || 14;
  const maxNotes = Number.isFinite(w.mbMaxNotes) && w.mbMaxNotes > 0 ? w.mbMaxNotes : 8;
  return `
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="mb-font-range" min="10" max="40" step="1" value="${fontPx}">
        <span class="was-range-val" id="mb-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Max notes shown ${infoBtn("How many of the most recent notes this widget displays. Pinned notes always show first.")}</label>
      <div class="was-range-row">
        <input type="range" id="mb-max-range" min="1" max="20" step="1" value="${maxNotes}">
        <span class="was-range-val" id="mb-max-val">${maxNotes}</span>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Show author</label>
      <input type="checkbox" id="mb-show-author" ${w.mbShowAuthor!==false?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Show time</label>
      <input type="checkbox" id="mb-show-time" ${w.mbShowTime!==false?'checked':''}>
    </div>
    <p class="was-hint">Notes are shared across every Message Board widget and the app's Board tab — post or clear one anywhere, it updates everywhere.</p>
  `;
}
function wireMessageBoardAdvancedSettings(w) {
  const fontRange = document.getElementById('mb-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.mbFontPx = parseInt(e.target.value, 10);
    document.getElementById('mb-font-val').textContent = w.mbFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const maxRange = document.getElementById('mb-max-range');
  if (maxRange) maxRange.addEventListener('input', (e) => {
    w.mbMaxNotes = parseInt(e.target.value, 10);
    document.getElementById('mb-max-val').textContent = String(w.mbMaxNotes);
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showAuthor = document.getElementById('mb-show-author');
  if (showAuthor) showAuthor.addEventListener('change', (e) => {
    w.mbShowAuthor = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showTime = document.getElementById('mb-show-time');
  if (showTime) showTime.addEventListener('change', (e) => {
    w.mbShowTime = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderMealPlanAdvancedSettings(w) {
  const days = Math.max(3, Math.min(14, Number(w.mpDays) || 7));
  const fontPx = w.mpFontPx || 15;
  const active = mpActiveSlots(w);
  const householdSlots = mpActiveSlots({});
  const slotRow = MP_SLOT_ORDER.map(s =>
    `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;cursor:pointer">
      <input type="checkbox" class="mp-slot-cb" value="${s}" ${active.includes(s) ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
      ${MP_SLOT_NAME[s]}
    </label>`).join('');
  return `
    <div class="was-row">
      <label>Meals shown</label>
      <div style="display:flex;flex-wrap:wrap">${slotRow}</div>
      <p class="was-hint" style="margin-top:6px">Leave these matching the household default (${householdSlots.map(s => MP_SLOT_NAME[s]).join(', ')}) to follow it, or pick a different set just for this widget. Change which meals the household plans in the app's Meals tab.</p>
    </div>
    <div class="was-row">
      <label>Days shown</label>
      <div class="was-range-row">
        <input type="range" id="mp-days-range" min="3" max="14" step="1" value="${days}">
        <span class="was-range-val" id="mp-days-val">${days}</span>
      </div>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="mp-font-range" min="10" max="36" step="1" value="${fontPx}">
        <span class="was-range-val" id="mp-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Hide unplanned meals ${infoBtn("Only list days/meals that actually have something planned — drop the ones showing a dash.")}</label>
      <input type="checkbox" id="mp-hide-empty" ${w.mpHideEmpty ? 'checked' : ''}>
    </div>
    <p class="was-hint">Meals are shared across every Meal Plan widget and the Family Hub Meals tab — set one anywhere, it shows everywhere. Tap a meal on the display to plan it.</p>
  `;
}
function wireMealPlanAdvancedSettings(w) {
  const daysRange = document.getElementById('mp-days-range');
  if (daysRange) daysRange.addEventListener('input', (e) => {
    w.mpDays = parseInt(e.target.value, 10);
    document.getElementById('mp-days-val').textContent = String(w.mpDays);
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('mp-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.mpFontPx = parseInt(e.target.value, 10);
    document.getElementById('mp-font-val').textContent = w.mpFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const hideEmpty = document.getElementById('mp-hide-empty');
  if (hideEmpty) hideEmpty.addEventListener('change', (e) => {
    w.mpHideEmpty = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  document.querySelectorAll('.mp-slot-cb').forEach(cb => cb.addEventListener('change', () => {
    let picked = [...document.querySelectorAll('.mp-slot-cb:checked')].map(x => x.value);
    if (!picked.length) { cb.checked = true; picked = [cb.value]; } // never zero
    picked = MP_SLOT_ORDER.filter(s => picked.includes(s));
    const household = mpActiveSlots({});
    // Matches the household set exactly -> follow it (drop the override).
    if (picked.length === household.length && picked.every(s => household.includes(s))) delete w.mpSlots;
    else w.mpSlots = picked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  }));
}

