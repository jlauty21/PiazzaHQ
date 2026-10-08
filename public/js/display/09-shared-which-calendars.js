// ── Shared "which calendars to show" content filter ─────────────────────────
// Applies to all four calendar-data widgets (Calendar, Upcoming, Today,
// Agenda) — ported from app.html's own isCalendarWidget-gated shared block,
// same reasoning: one filter, one behavior, reused everywhere rather than
// four separately-maintained copies. This was a real gap in Calendar's own
// advanced settings when that type shipped earlier — the shared block was
// missed at the time and only surfaced when actually reading through
// app.html's settings code for these three remaining types. Retrofitted
// into Calendar's panel here rather than left missing.
let cachedFeeds = null;
async function fetchCalendarFeeds() {
  if (cachedFeeds) return cachedFeeds;
  try {
    const r = await fetch('/api/feeds');
    cachedFeeds = await r.json();
    if (!Array.isArray(cachedFeeds)) cachedFeeds = [];
  } catch { cachedFeeds = []; }
  return cachedFeeds;
}
function renderCalendarFamilyFilterHtml(w, feeds) {
  const sources = [
    { id: 'local', name: 'Local Events', color: '#4A90D9' },
    ...feeds.map(f => ({ id: 'feed:' + f.id, name: f.name, color: f.color })),
  ];
  // No filter set yet = everything is shown (matches the display's own default).
  const activeSet = Array.isArray(w.sourceFilter) && w.sourceFilter.length
    ? new Set(w.sourceFilter)
    : new Set(sources.map(s => s.id));
  const sourceRows = sources.map(s => `
    <label style="display:flex;align-items:center;gap:10px;padding:4px 0;cursor:pointer">
      <input type="checkbox" class="cf-source-cb" data-id="${s.id}" ${activeSet.has(s.id) ? 'checked' : ''}>
      <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
      <span style="font-size:13px">${escapeHtmlD(s.name)}</span>
    </label>`).join('');
  return `
    <div class="was-section-label">📋 Content</div>
    <div class="was-row">
      <label>Calendars to Show</label>
      <div id="cf-source-list" style="display:flex;flex-direction:column;gap:2px;margin-top:4px">${sourceRows}</div>
    </div>
    <div class="was-toggle-row">
      <label>Show Multi-day Events</label>
      <input type="checkbox" id="cf-multiday-toggle" ${w.showMultiDay !== false ? 'checked' : ''}>
    </div>
  `;
}
function wireCalendarFamilyFilter(w) {
  const container = document.getElementById('cf-source-list');
  if (container) {
    const checkboxes = container.querySelectorAll('.cf-source-cb');
    checkboxes.forEach(cb => cb.addEventListener('change', () => {
      const checked = [...container.querySelectorAll('.cf-source-cb:checked')].map(el => el.dataset.id);
      // Everything checked = store null, so a calendar added later is included
      // automatically instead of silently excluded — same convention already
      // used for chorechart/chorelb's kid selection.
      w.sourceFilter = checked.length === checkboxes.length ? null : checked;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    }));
  }
  const multidayToggle = document.getElementById('cf-multiday-toggle');
  if (multidayToggle) multidayToggle.addEventListener('change', (e) => {
    w.showMultiDay = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

// Shared "show on each event" toggle set — same three checkboxes (time,
// calendar source label, notes), same field-name PREFIX pattern per type
// (up-/td-/ag-), just enough different per type that a single generic
// function would need as many special cases as three separate ones —
// written out individually to match app.html's own (also non-generic)
// structure exactly, not to avoid a slightly-longer file.
function renderUpcomingAdvancedSettings(w) {
  const fontPx = w.upFontPx || 14;
  const layout = w.upLayout || 'list';
  return `
    <div class="was-section-label">🎨 Display</div>
    <div class="was-row">
      <label>Layout Style</label>
      <select id="up-layout-select">
        <option value="list"    ${layout==='list'?'selected':''}>List</option>
        <option value="cards"   ${layout==='cards'?'selected':''}>Cards</option>
        <option value="compact" ${layout==='compact'?'selected':''}>Compact</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="up-font-range" min="8" max="56" step="1" value="${fontPx}">
        <span class="was-range-val" id="up-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Show on each event</label>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        <div class="was-toggle-row" style="margin-bottom:0"><label>Time / date range</label><input type="checkbox" id="up-show-time" ${w.upShowTime!==false?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Calendar source label</label><input type="checkbox" id="up-show-source" ${w.upShowSource!==false?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Notes</label><input type="checkbox" id="up-show-notes" ${w.upShowNotes?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Location <span style="color:var(--text2);font-size:0.85em">(for calendars that have it turned on)</span></label><input type="checkbox" id="up-show-location" ${w.upShowLocation!==false?'checked':''}></div>
      </div>
    </div>
    ${dateFormatOverrideRowHtml('up-date-format-select', w.upDateFormat)}
    ${ampmCaseOverrideRowHtml('up-ampm-case-select', w.upAmpmCase)}
    ${renderFeedOpacityOverrideSection(w)}
    ${renderFeedLocationOverrideSection(w)}
  `;
}
function wireUpcomingAdvancedSettings(w) {
  wireFeedOpacityOverrideSection(w);
  wireFeedLocationOverrideSection(w);
  const layoutSel = document.getElementById('up-layout-select');
  if (layoutSel) layoutSel.addEventListener('change', (e) => { w.upLayout = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const fontRange = document.getElementById('up-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.upFontPx = parseInt(e.target.value, 10);
    document.getElementById('up-font-val').textContent = w.upFontPx + 'px';
    rerenderSingleWidget(w.id); scheduleLayoutSave();
  });
  const showTime = document.getElementById('up-show-time');
  if (showTime) showTime.addEventListener('change', (e) => { w.upShowTime = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showSource = document.getElementById('up-show-source');
  if (showSource) showSource.addEventListener('change', (e) => { w.upShowSource = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showNotes = document.getElementById('up-show-notes');
  if (showNotes) showNotes.addEventListener('change', (e) => { w.upShowNotes = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showLoc = document.getElementById('up-show-location');
  if (showLoc) showLoc.addEventListener('change', (e) => { w.upShowLocation = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const dateFormatSel = document.getElementById('up-date-format-select');
  if (dateFormatSel) dateFormatSel.addEventListener('change', (e) => { w.upDateFormat = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const ampmCaseSel = document.getElementById('up-ampm-case-select');
  if (ampmCaseSel) ampmCaseSel.addEventListener('change', (e) => { w.upAmpmCase = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
}

function renderTodayAdvancedSettings(w) {
  const fontPx = w.tdFontPx || 15;
  const layout = w.tdLayout || 'list';
  return `
    <div class="was-section-label">🎨 Display</div>
    <div class="was-row">
      <label>Layout Style</label>
      <select id="td2-layout-select">
        <option value="list"    ${layout==='list'?'selected':''}>List</option>
        <option value="cards"   ${layout==='cards'?'selected':''}>Cards</option>
        <option value="compact" ${layout==='compact'?'selected':''}>Compact</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="td2-font-range" min="8" max="56" step="1" value="${fontPx}">
        <span class="was-range-val" id="td2-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Show on each event</label>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        <div class="was-toggle-row" style="margin-bottom:0"><label>Time</label><input type="checkbox" id="td2-show-time" ${w.tdShowTime!==false?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Calendar source label</label><input type="checkbox" id="td2-show-source" ${w.tdShowSource!==false?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Notes</label><input type="checkbox" id="td2-show-notes" ${w.tdShowNotes?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Location <span style="color:var(--text2);font-size:0.85em">(for calendars that have it turned on)</span></label><input type="checkbox" id="td2-show-location" ${w.tdShowLocation!==false?'checked':''}></div>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Ongoing Strip ${infoBtn("A separate summary line for multi-day events already in progress or starting in the next couple days — \"day 2 of 5\" instead of it just looking like another today-only event in the list.")}</label>
      <input type="checkbox" id="td2-show-ongoing" ${w.tdShowOngoing?'checked':''}>
    </div>
    ${dateFormatOverrideRowHtml('td2-date-format-select', w.tdDateFormat)}
    ${ampmCaseOverrideRowHtml('td2-ampm-case-select', w.tdAmpmCase)}
    ${renderFeedOpacityOverrideSection(w)}
    ${renderFeedLocationOverrideSection(w)}
  `;
}
function wireTodayAdvancedSettings(w) {
  wireFeedOpacityOverrideSection(w);
  wireFeedLocationOverrideSection(w);
  // Prefixed td2- (not td-) so these element ids can never collide with the
  // To-Do List widget's own td- prefixed fields — both this Today panel and
  // that one only ever exist one-at-a-time in the shared #widget-advanced-panel
  // (innerHTML is fully replaced on every open, so a real DOM collision was
  // never actually possible), but distinct prefixes make that obvious at a
  // glance rather than relying on knowing that architectural detail.
  const layoutSel = document.getElementById('td2-layout-select');
  if (layoutSel) layoutSel.addEventListener('change', (e) => { w.tdLayout = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const fontRange = document.getElementById('td2-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.tdFontPx = parseInt(e.target.value, 10);
    document.getElementById('td2-font-val').textContent = w.tdFontPx + 'px';
    rerenderSingleWidget(w.id); scheduleLayoutSave();
  });
  const showTime = document.getElementById('td2-show-time');
  if (showTime) showTime.addEventListener('change', (e) => { w.tdShowTime = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showSource = document.getElementById('td2-show-source');
  if (showSource) showSource.addEventListener('change', (e) => { w.tdShowSource = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showNotes = document.getElementById('td2-show-notes');
  if (showNotes) showNotes.addEventListener('change', (e) => { w.tdShowNotes = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showLoc = document.getElementById('td2-show-location');
  if (showLoc) showLoc.addEventListener('change', (e) => { w.tdShowLocation = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showOngoing = document.getElementById('td2-show-ongoing');
  if (showOngoing) showOngoing.addEventListener('change', (e) => { w.tdShowOngoing = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const dateFormatSel = document.getElementById('td2-date-format-select');
  if (dateFormatSel) dateFormatSel.addEventListener('change', (e) => { w.tdDateFormat = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const ampmCaseSel = document.getElementById('td2-ampm-case-select');
  if (ampmCaseSel) ampmCaseSel.addEventListener('change', (e) => { w.tdAmpmCase = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
}

function renderAgendaWidgetAdvancedSettings(w) {
  const fontPx = w.agFontPx || 14;
  const layout = w.agLayout || 'list';
  const days = w.agDays || 7;
  return `
    <div class="was-section-label">🎨 Display</div>
    <div class="was-row">
      <label>Layout Style</label>
      <select id="ag2-layout-select">
        <option value="list"    ${layout==='list'?'selected':''}>List</option>
        <option value="cards"   ${layout==='cards'?'selected':''}>Cards</option>
        <option value="compact" ${layout==='compact'?'selected':''}>Compact</option>
      </select>
    </div>
    <div class="was-row">
      <label>Days to Show ${infoBtn("Includes today plus this many days ahead. Actual events shown still depends on how much fits in the widget's size.")}</label>
      <div class="was-range-row">
        <input type="range" id="ag2-days-range" min="1" max="30" step="1" value="${days}">
        <span class="was-range-val" id="ag2-days-val">${days}</span>
      </div>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="ag2-font-range" min="8" max="56" step="1" value="${fontPx}">
        <span class="was-range-val" id="ag2-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Show on each event</label>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        <div class="was-toggle-row" style="margin-bottom:0"><label>Time</label><input type="checkbox" id="ag2-show-time" ${w.agShowTime!==false?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Calendar source label</label><input type="checkbox" id="ag2-show-source" ${w.agShowSource!==false?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Notes</label><input type="checkbox" id="ag2-show-notes" ${w.agShowNotes?'checked':''}></div>
        <div class="was-toggle-row" style="margin-bottom:0"><label>Location <span style="color:var(--text2);font-size:0.85em">(for calendars that have it turned on)</span></label><input type="checkbox" id="ag2-show-location" ${w.agShowLocation!==false?'checked':''}></div>
      </div>
    </div>
    <div class="was-toggle-row">
      <label>Ongoing Strip ${infoBtn("A separate summary line for multi-day events already in progress or starting in the next few days — \"day 2 of 5\" instead of it just looking like another one-day event grouped under today.")}</label>
      <input type="checkbox" id="ag2-show-ongoing" ${w.agShowOngoing?'checked':''}>
    </div>
    <div class="was-toggle-row">
      <label>Show Reminders ${infoBtn("Trash day, recycling, or anything else set up in a Reminders widget — shown as its own line on any day it's due, same schedule the Reminders widget and the calendar-grid badges read from.")}</label>
      <input type="checkbox" id="ag2-show-reminders" ${w.agShowReminders?'checked':''}>
    </div>
    ${dateFormatOverrideRowHtml('ag2-date-format-select', w.agDateFormat)}
    ${ampmCaseOverrideRowHtml('ag2-ampm-case-select', w.agAmpmCase)}
    ${renderFeedOpacityOverrideSection(w)}
    ${renderFeedLocationOverrideSection(w)}
  `;
}
function wireAgendaWidgetAdvancedSettings(w) {
  wireFeedOpacityOverrideSection(w);
  wireFeedLocationOverrideSection(w);
  // Prefixed ag2- (not ag-) for the same reason td2- avoids todo's td- prefix
  // — this Agenda WIDGET's settings live in the same shared panel as the
  // Calendar widget's own agenda LAYOUT MODE settings (a `calLayout: 'agenda'`
  // minical, a completely different widget type that happens to share the
  // English word "agenda") — distinct ids make the two unmistakable even
  // though, same as above, they can never actually be open simultaneously.
  const layoutSel = document.getElementById('ag2-layout-select');
  if (layoutSel) layoutSel.addEventListener('change', (e) => { w.agLayout = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const daysRange = document.getElementById('ag2-days-range');
  if (daysRange) daysRange.addEventListener('input', (e) => {
    w.agDays = parseInt(e.target.value, 10);
    document.getElementById('ag2-days-val').textContent = w.agDays;
    rerenderSingleWidget(w.id); scheduleLayoutSave();
  });
  const fontRange = document.getElementById('ag2-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.agFontPx = parseInt(e.target.value, 10);
    document.getElementById('ag2-font-val').textContent = w.agFontPx + 'px';
    rerenderSingleWidget(w.id); scheduleLayoutSave();
  });
  const showTime = document.getElementById('ag2-show-time');
  if (showTime) showTime.addEventListener('change', (e) => { w.agShowTime = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showSource = document.getElementById('ag2-show-source');
  if (showSource) showSource.addEventListener('change', (e) => { w.agShowSource = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showNotes = document.getElementById('ag2-show-notes');
  if (showNotes) showNotes.addEventListener('change', (e) => { w.agShowNotes = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showLoc = document.getElementById('ag2-show-location');
  if (showLoc) showLoc.addEventListener('change', (e) => { w.agShowLocation = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showOngoing = document.getElementById('ag2-show-ongoing');
  if (showOngoing) showOngoing.addEventListener('change', (e) => { w.agShowOngoing = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showReminders = document.getElementById('ag2-show-reminders');
  if (showReminders) showReminders.addEventListener('change', (e) => { w.agShowReminders = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const dateFormatSel = document.getElementById('ag2-date-format-select');
  if (dateFormatSel) dateFormatSel.addEventListener('change', (e) => { w.agDateFormat = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const ampmCaseSel = document.getElementById('ag2-ampm-case-select');
  if (ampmCaseSel) ampmCaseSel.addEventListener('change', (e) => { w.agAmpmCase = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
}

// ── Photo widget advanced settings ──────────────────────────────────────────
// The biggest remaining type (108 lines in app.html) — given its own scoping
// pass before starting, same as Calendar/Weather got. No account-linking
// involved (photos already live on this Pi), so unlike Tasks/TasksCombined
// there was no reason to hold this one back — confirmed directly rather than
// assumed. Tags are derived client-side from the same photo list (matching
// app.html's own ensurePhotoTagsLoaded()), not a separate endpoint — fetched
// fresh whenever this panel opens rather than relying on some other tab
// having been visited first as a side effect, which is how app.html's own
// version bootstraps this data (a "have I visited Devices yet" side effect
// that has no equivalent to lean on here).
async function fetchPhotosAndTags() {
  let photos = [];
  try {
    const r = await fetch('/api/photos');
    photos = await r.json();
    if (!Array.isArray(photos)) photos = [];
  } catch { photos = []; }
  const tagSet = new Set();
  photos.forEach(p => (p.tags || '').split(',').forEach(t => { const v = t.trim(); if (v) tagSet.add(v); }));
  return { photos, tags: Array.from(tagSet).sort() };
}
function renderPhotoAdvancedSettings(w, tags) {
  const mode = w.photoMode || 'all';
  const ivSec = w.photoInterval || null;
  return `
    <div class="was-section-label">🖼️ Which Photos</div>
    <div class="was-row">
      <label>Which Photos ${infoBtn("Choose a subset so this display shows different photos than another. Photos are uploaded in the app's Settings → Photos (shared library).")}</label>
      <select id="photo-mode-select">
        <option value="all"      ${mode==='all'?'selected':''}>All active photos</option>
        <option value="selected" ${mode==='selected'?'selected':''}>Only the ones I pick</option>
      </select>
    </div>
    <div class="was-row">
      <label>Filter by Tag ${infoBtn("This widget's own tag — independent of whatever tag a screen's screensaver is set to.")}</label>
      <select id="photo-tag-select">
        <option value="" ${!w.photoTag?'selected':''}>All tags</option>
        ${tags.map(t=>`<option value="${escapeHtmlD(t)}" ${w.photoTag===t?'selected':''}>${escapeHtmlD(t)}</option>`).join('')}
      </select>
    </div>
    <div class="was-row" id="photo-pick-row" style="${mode==='selected'?'':'display:none'}">
      <label>Pick Photos for This Display</label>
      <div id="photo-pick-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;margin-top:6px">
        <div class="was-hint">Loading photos…</div>
      </div>
    </div>
    <div class="was-section-label">🎨 Appearance</div>
    <div class="was-toggle-row">
      <label>Full-Screen Background ${infoBtn("Fills the whole display and sits behind every other widget. Doesn't change this widget's own position/size — turn it off anytime to go right back to exactly where it was.")}</label>
      <input type="checkbox" id="photo-fullscreen-bg-toggle" ${w.photoFullscreenBg?'checked':''}>
    </div>
    <div class="was-row">
      <label>Image Fit</label>
      <select id="photo-fit-select">
        <option value="cover"  ${(w.photoFit||'cover')==='cover'?'selected':''}>Fill (crop to fill, no gaps)</option>
        <option value="width"  ${w.photoFit==='width'?'selected':''}>Fit to width (whole width shown)</option>
        <option value="height" ${w.photoFit==='height'?'selected':''}>Fit to height (whole height shown)</option>
        <option value="auto"   ${w.photoFit==='auto'?'selected':''}>Auto (best fit per photo — good for mixed orientations)</option>
      </select>
    </div>
    <div class="was-toggle-row" id="photo-autoblurbg-row" style="display:${w.photoFit==='auto'?'flex':'none'}">
      <label>Blurred background behind mismatched photos</label>
      <input type="checkbox" id="photo-autoblurbg" ${w.photoAutoBlurBg!==false?'checked':''}>
    </div>
    <div class="was-row">
      <label>Edge Fade ${infoBtn("Softly fades the photo's edges into the background. Set any edge to 0 for a hard edge.")}</label>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:12px;opacity:0.6;width:54px">Top</span>
        <input type="range" id="pw-fade-top" min="0" max="300" step="5" value="${w.fadeTop||0}" style="flex:1">
        <span class="was-range-val" id="pw-fade-top-val" style="width:46px">${w.fadeTop||0}px</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:12px;opacity:0.6;width:54px">Bottom</span>
        <input type="range" id="pw-fade-bottom" min="0" max="300" step="5" value="${w.fadeBottom||0}" style="flex:1">
        <span class="was-range-val" id="pw-fade-bottom-val" style="width:46px">${w.fadeBottom||0}px</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:12px;opacity:0.6;width:54px">Left</span>
        <input type="range" id="pw-fade-left" min="0" max="300" step="5" value="${w.fadeLeft||0}" style="flex:1">
        <span class="was-range-val" id="pw-fade-left-val" style="width:46px">${w.fadeLeft||0}px</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;opacity:0.6;width:54px">Right</span>
        <input type="range" id="pw-fade-right" min="0" max="300" step="5" value="${w.fadeRight||0}" style="flex:1">
        <span class="was-range-val" id="pw-fade-right-val" style="width:46px">${w.fadeRight||0}px</span>
      </div>
    </div>
    <div class="was-section-label">🔄 Slideshow</div>
    <div class="was-toggle-row">
      <label>Fade between photos</label>
      <input type="checkbox" id="photo-fadetransition" ${w.photoFadeTransition!==false?'checked':''}>
    </div>
    <div class="was-row" id="photo-fadeduration-row" style="display:${w.photoFadeTransition!==false?'block':'none'}">
      <label>Fade Duration</label>
      <select id="photo-fadeduration-select">
        <option value="1" ${(parseFloat(w.photoFadeDuration)||2)==1?'selected':''}>1 second (quick)</option>
        <option value="2" ${!w.photoFadeDuration||(parseFloat(w.photoFadeDuration)||2)==2?'selected':''}>2 seconds (default)</option>
        <option value="3" ${(parseFloat(w.photoFadeDuration)||2)==3?'selected':''}>3 seconds</option>
        <option value="4" ${(parseFloat(w.photoFadeDuration)||2)==4?'selected':''}>4 seconds</option>
        <option value="5" ${(parseFloat(w.photoFadeDuration)||2)==5?'selected':''}>5 seconds (slow)</option>
        <option value="8" ${(parseFloat(w.photoFadeDuration)||2)==8?'selected':''}>8 seconds (very slow)</option>
      </select>
    </div>
    <div class="was-row">
      <label>Slide Interval</label>
      <select id="photo-interval-select">
        <option value=""   ${!ivSec?'selected':''}>Use global setting</option>
        <option value="5"  ${ivSec==5?'selected':''}>5 seconds</option>
        <option value="10" ${ivSec==10?'selected':''}>10 seconds</option>
        <option value="20" ${ivSec==20?'selected':''}>20 seconds</option>
        <option value="30" ${ivSec==30?'selected':''}>30 seconds</option>
        <option value="60" ${ivSec==60?'selected':''}>1 minute</option>
        <option value="300" ${ivSec==300?'selected':''}>5 minutes</option>
      </select>
    </div>
    <div class="was-toggle-row">
      <label>Shuffle Order</label>
      <input type="checkbox" id="photo-shuffle" ${w.photoShuffle?'checked':''}>
    </div>
  `;
}
function wirePhotoAdvancedSettings(w, photos) {
  const renderPickGrid = () => {
    const grid = document.getElementById('photo-pick-grid');
    if (!grid) return;
    if (!photos.length) {
      grid.innerHTML = '<div class="was-hint" style="grid-column:1/-1">No photos uploaded yet — add some in Settings → Photos.</div>';
      return;
    }
    if (!Array.isArray(w.photoIds)) w.photoIds = [];
    grid.innerHTML = photos.map(p => {
      const sel = w.photoIds.includes(p.id);
      return `<button type="button" class="photo-pick-thumb" data-pid="${p.id}" title="${escapeHtmlD(p.label||'')}"
        style="position:relative;padding:0;border-radius:8px;overflow:hidden;aspect-ratio:1;border:2px solid ${sel?'var(--accent, #4A90D9)':'transparent'};cursor:pointer">
        <img src="/uploads/${escapeHtmlD(p.filename)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
        ${sel ? `<span style="position:absolute;top:4px;right:4px;background:var(--accent, #4A90D9);color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:12px">✓</span>` : ''}
      </button>`;
    }).join('');
    grid.querySelectorAll('.photo-pick-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.pid, 10);
        const i = w.photoIds.indexOf(id);
        if (i >= 0) w.photoIds.splice(i, 1); else w.photoIds.push(id);
        renderPickGrid(); // re-render just the grid so the checkmark/border updates
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
      });
    });
  };

  const fsBgToggle = document.getElementById('photo-fullscreen-bg-toggle');
  if (fsBgToggle) fsBgToggle.addEventListener('change', (e) => {
    w.photoFullscreenBg = e.target.checked;
    scheduleLayoutSave();
    // This field changes POSITION/LAYERING, not just content — rerenderSingleWidget()
    // only replaces a widget's innerHTML, it never touches the outer positioning
    // styles that renderLayout() computes fresh each time, so a full renderLayout()
    // is needed here to actually reposition the widget on screen. Re-select
    // afterward so the edit overlay/handles correctly re-evaluate (they hide
    // entirely for a full-screen-background widget — see injectEditChrome()).
    renderLayout();
    selectWidgetForEdit(w.id);
  });

  const modeSel = document.getElementById('photo-mode-select');
  if (modeSel) modeSel.addEventListener('change', (e) => {
    w.photoMode = e.target.value;
    const row = document.getElementById('photo-pick-row');
    if (row) row.style.display = w.photoMode === 'selected' ? '' : 'none';
    if (w.photoMode === 'selected') renderPickGrid();
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const tagSel = document.getElementById('photo-tag-select');
  if (tagSel) tagSel.addEventListener('change', (e) => {
    w.photoTag = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fitSel = document.getElementById('photo-fit-select');
  if (fitSel) fitSel.addEventListener('change', (e) => {
    w.photoFit = e.target.value;
    const row = document.getElementById('photo-autoblurbg-row');
    if (row) row.style.display = e.target.value === 'auto' ? 'flex' : 'none';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const blurBg = document.getElementById('photo-autoblurbg');
  if (blurBg) blurBg.addEventListener('change', (e) => { w.photoAutoBlurBg = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const fadeTransition = document.getElementById('photo-fadetransition');
  if (fadeTransition) fadeTransition.addEventListener('change', (e) => {
    w.photoFadeTransition = e.target.checked;
    const row = document.getElementById('photo-fadeduration-row');
    if (row) row.style.display = e.target.checked ? 'block' : 'none';
    scheduleLayoutSave();
  });
  const fadeDuration = document.getElementById('photo-fadeduration-select');
  if (fadeDuration) fadeDuration.addEventListener('change', (e) => { w.photoFadeDuration = parseFloat(e.target.value); scheduleLayoutSave(); });
  const intervalSel = document.getElementById('photo-interval-select');
  if (intervalSel) intervalSel.addEventListener('change', (e) => {
    w.photoInterval = e.target.value ? parseInt(e.target.value, 10) : null;
    scheduleLayoutSave();
  });
  const shuffle = document.getElementById('photo-shuffle');
  if (shuffle) shuffle.addEventListener('change', (e) => { w.photoShuffle = e.target.checked; scheduleLayoutSave(); });
  ['top','bottom','left','right'].forEach(edge => {
    const el = document.getElementById(`pw-fade-${edge}`);
    if (el) el.addEventListener('input', (e) => {
      const key = 'fade' + edge.charAt(0).toUpperCase() + edge.slice(1);
      w[key] = parseInt(e.target.value, 10);
      document.getElementById(`pw-fade-${edge}-val`).textContent = e.target.value + 'px';
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  });

  if ((w.photoMode || 'all') === 'selected') renderPickGrid();
}

// deliberately ported directly from app.html's own arrays/add-widget logic
// of the same names/shape, rather than a hand-written second copy — keeps
// this a single source of truth for "what widget types exist and what their
// sensible defaults are" instead of two lists that can quietly drift apart.
// If app.html's WIDGET_DEFS or its add-widget default chain ever changes,
// this needs the matching update.
const WIDGET_DEFS = [
  { type:'clock',    label:'Clock',    icon:'🕐' },
  { type:'date',     label:'Date',     icon:'📅' },
  { type:'datetime', label:'Date & Time', icon:'🕰️' },
  { type:'reminders', label:'Reminders', icon:'🗑️' },
  { type:'weather',  label:'Weather',  icon:'☀️' },
  { type:'weatherCurrent',  label:'Current Wx', icon:'🌡️' },
  { type:'weatherForecast', label:'Forecast',   icon:'📆' },
  { type:'weatherHourly', label:'Hourly Wx', icon:'🕘' },
  { type:'weatherComboForecast', label:'Combo Forecast', icon:'🌦️' },
  { type:'minical',  label:'Calendar', icon:'🗓️' },
  { type:'upcoming', label:'Upcoming', icon:'📋' },
  { type:'today',    label:'Today',    icon:'📍' },
  { type:'agenda',   label:'Agenda',   icon:'🗒️' },
  { type:'tasks',    label:'Tasks',    icon:'✅' },
  { type:'tasksCombined', label:'Tasks (Combined)', icon:'📝' },
  { type:'todo', label:'To-Do List', icon:'📝' },
  { type:'news',     label:'News',     icon:'📰' },
  { type:'stocks',   label:'Stocks',   icon:'📈' },
  { type:'text',     label:'Text',     icon:'🅰️' },
  { type:'photo',    label:'Photo',    icon:'🖼️' },
  { type:'chorechart', label:'Chore Chart', icon:'🧹' },
  { type:'chorelb', label:'Chore Leaderboard', icon:'🏆' },
  { type:'shoppinglist', label:'Shopping List', icon:'🛒' },
  { type:'messageboard', label:'Message Board', icon:'📝' },
  { type:'mealplan', label:'Meal Plan', icon:'🍽️' },
  { type:'camera', label:'Camera', icon:'📹' },
  { type:'flightmap', label:'Flight Map', icon:'✈️' },
  { type:'countdown', label:'Countdown', icon:'⏳' },
  { type:'moonphase', label:'Moon Phase', icon:'🌙' },
  { type:'airquality', label:'Air Quality', icon:'🌬️' },
  { type:'radar',    label:'Weather Radar', icon:'🌩️' },
  { type:'travel', label:'Travel Time', icon:'🚗' },
  { type:'qrcode', label:'QR Code', icon:'▦' },
  { type:'webpage', label:'Web Page', icon:'🌐' },
  { type:'timer', label:'Timer', icon:'⏱️' },
  { type:'onthisday', label:'On This Day', icon:'📜' },
  { type:'dailyquote', label:'Daily Quote', icon:'💬' },
  { type:'sports', label:'Sports Scores', icon:'🏈' },
  { type:'metar', label:'METAR/TAF', icon:'✈️' },
  { type:'decoration', label:'Decoration', icon:'🌿' },
  { type:'entitystatus', label:'Entity Status', icon:'🏠' },
  { type:'smarthomeDashboard', label:'Smart Home Grid', icon:'🏘️' },
  { type:'groupcontrol', label:'Group Control', icon:'🎚️' },
];
const WIDGET_CATEGORIES = [
  { id:'time',     label:'Time',     icon:'🕐', types:['clock','date','datetime','countdown','timer'] },
  { id:'calendar', label:'Calendar', icon:'🗓️', types:['minical','upcoming','today','agenda'] },
  { id:'weather',  label:'Weather',  icon:'☀️', types:['weather','weatherCurrent','weatherForecast','weatherHourly','weatherComboForecast','airquality','moonphase','metar','radar'] },
  { id:'tasks',    label:'Tasks',    icon:'✅', types:['tasks','tasksCombined','todo'] },
  { id:'info',     label:'Info',     icon:'📰', types:['news','stocks','text','onthisday','dailyquote','sports','travel','flightmap'] },
  { id:'photos',   label:'Photos',   icon:'🖼️', types:['photo'] },
  { id:'family',   label:'Family',   icon:'🧹', types:['chorechart','chorelb','shoppinglist','reminders','messageboard','mealplan'] },
  { id:'utility',  label:'Utility',  icon:'▦', types:['qrcode','webpage'] },
  { id:'decor',    label:'Decor',    icon:'🌿', types:['decoration'] },
  { id:'smarthome', label:'Smart Home', icon:'🏠', types:['entitystatus','smarthomeDashboard','groupcontrol','camera'] },
];
// Collision-safe without needing to track/sync a counter against whatever
// IDs the server or the app's own editor have already handed out — app.html
// can do a simple incrementing counter because it always starts from a
// freshly-fetched layout, but this page can't assume that same clean slate
// (SSE pushes, another device's concurrent edits, etc.), so a
// timestamp+random suffix sidesteps needing to reconcile against anything.
function nextWidgetId() {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
// Mirrors app.html's own add-widget default-fields chain (the sequence of
// `if (def.type === 'x') {...}` blocks) field-for-field — deliberately NOT
// reinterpreted or "improved," so a widget added here starts out identical
// to one added from the app, rather than two subtly different versions of
// "a new Clock widget" existing depending on where it was added from.
function buildNewWidgetDefaults(type) {
  const w = { id: nextWidgetId(), type, x: 10, y: 10, w: 30, h: 20 };
  if (type === 'minical') { w.w = 60; w.h = 50; w.calView = 'month'; }
  else if (type === 'datetime') { w.w = 34; w.h = 30; w.dtStyle = 'classic'; w.dtFontPx = 70; w.dtShowSeconds = true; w.dtShowDate = true; w.dtShowTemp = true; }
  else if (type === 'reminders') { w.w = 30; w.h = 20; w.remStyle = 'banner'; w.remFontPx = 22; }
  else if (type === 'messageboard') { w.w = 34; w.h = 26; w.mbFontPx = 14; }
  else if (type === 'mealplan') { w.w = 30; w.h = 34; w.mpDays = 7; w.mpFontPx = 15; }
  else if (type === 'camera') { w.w = 44; w.h = 32; w.camFit = 'contain'; w.camShowTitle = true; }
  else if (type === 'flightmap') { w.w = 46; w.h = 38; w.fmSubject = 'filter'; w.fmFilter = { mil: true }; w.fmFollow = false; w.fmTrailMin = 30; w.fmShowData = true; w.fmLabels = true; w.fmFontPx = 13; }
  else if (type === 'tasks') { w.w = 30; w.h = 40; w.projectId = null; w.projectName = 'Tasks'; }
  else if (type === 'news') { w.w = 32; w.h = 45; }
  else if (type === 'stocks') { w.w = 28; w.h = 30; w.stockTickers = []; }
  else if (type === 'weatherCurrent') { w.w = 24; w.h = 22; w.wxForecastDays = 0; }
  else if (type === 'weatherForecast') { w.w = 40; w.h = 18; w.wxForecastDays = 5; }
  else if (type === 'weatherHourly') { w.w = 42; w.h = 20; w.wxHourlyStyle = 'hourly'; w.wxHours = 6; }
  else if (type === 'weatherComboForecast') { w.w = 42; w.h = 36; w.wxComboStyle = 'stacked'; }
  else if (type === 'chorechart') { w.w = 50; w.h = 45; w.choreTitle = 'Daily Chore Chart'; w.choreShowDone = true; w.choreShowBonus = false; w.choreFontPx = 15; }
  else if (type === 'countdown') { w.w = 24; w.h = 22; w.cdTitle = 'Countdown'; w.cdFontPx = 22; w.cdRepeatYearly = false; }
  else if (type === 'moonphase') { w.w = 22; w.h = 22; w.mpFontPx = 20; w.mpShowIllum = true; w.mpShowAge = false; }
  else if (type === 'airquality') { w.w = 26; w.h = 32; w.aqFontPx = 18; w.aqShowUV = true; w.aqShowPollen = true; }
  else if (type === 'radar') { w.w = 30; w.h = 30; w.radarTitle = 'Radar'; w.radarFontPx = 16; w.radarLat = ''; w.radarLon = ''; w.radarZoom = 6; w.radarAnimate = false; w.radarFrameCount = 6; w.radarOpacity = 80; w.radarShowTime = true; }
  else if (type === 'webpage') { w.w = 30; w.h = 40; w.wpUrl = ''; w.wpTitle = ''; w.wpRefreshMin = 0; w.wpFontPx = 14; }
  else if (type === 'qrcode') { w.w = 20; w.h = 24; w.qrPreset = 'text'; w.qrContent = ''; w.qrTitle = ''; w.qrFontPx = 14; }
  else if (type === 'timer') { w.w = 22; w.h = 18; w.timerTitle = 'Timer'; w.timerMinutes = 5; w.timerFontPx = 32; }
  else if (type === 'onthisday') { w.w = 30; w.h = 40; w.otdFontPx = 15; w.otdMaxItems = 4; }
  else if (type === 'dailyquote') { w.w = 32; w.h = 20; w.dqFontPx = 20; }
  else if (type === 'sports') { w.w = 24; w.h = 32; w.spFontPx = 16; }
  else if (type === 'metar') { w.w = 26; w.h = 34; w.wxIcao = ''; w.wxShowTaf = true; w.wxFontPx = 16; }
  else if (type === 'agenda') { w.w = 32; w.h = 55; w.agDays = 7; }
  else if (type === 'tasksCombined') { w.w = 32; w.h = 55; w.projectIds = []; w.projectNames = {}; }
  else if (type === 'text') { w.w = 30; w.h = 12; w.textContent = 'Your text'; w.textPreset = 'plain'; w.textFontPx = 28; w.textWeight = 'normal'; w.textAlign = 'left'; w.textFontFamily = 'Inter'; }
  else if (type === 'decoration') { w.w = 14; w.h = 14; w.decorEmoji = '🌿'; w.decorFontPx = 60; w.decorOpacity = 100; w.decorRotation = 0; }
  else if (type === 'entitystatus') { w.w = 20; w.h = 16; w.haEntityId = ''; w.haLabel = ''; w.haLabelAutoFor = ''; w.haFontPx = 20; w.haShowUnit = true; w.haShowSparkline = true; }
  else if (type === 'smarthomeDashboard') { w.w = 40; w.h = 40; w.haEntityIds = []; w.haAreaIds = []; w.haComboGroups = []; w.haDashTitle = ''; w.haDashFontPx = 16; w.haGroupByRoom = true; w.haDashView = 'grid'; }
  else if (type === 'groupcontrol') { w.w = 20; w.h = 16; w.gcTitle = ''; w.gcEntityIds = []; w.gcAreaIds = []; w.gcFontPx = 20; }
  return w;
}

function openWidgetPicker() {
  const overlay = document.getElementById('widget-picker-overlay');
  const body = document.getElementById('widget-picker-body');
  if (!overlay || !body) return;
  body.innerHTML = WIDGET_CATEGORIES.map(cat => {
    const items = cat.types.map(t => {
      const def = WIDGET_DEFS.find(d => d.type === t);
      if (!def) return '';
      return `<button class="wp-type-item" data-type="${def.type}" data-interactive="1">
        <span class="wp-type-icon">${def.icon}</span><span>${escapeHtmlD(def.label)}</span>
      </button>`;
    }).join('');
    return `<div class="wp-category" data-cat="${cat.id}">
      <div class="wp-category-head" data-interactive="1">
        <span class="wp-cat-icon">${cat.icon}</span><span>${escapeHtmlD(cat.label)}</span>
        <span class="wp-cat-chevron">›</span>
      </div>
      <div class="wp-type-grid">${items}</div>
    </div>`;
  }).join('');
  overlay.style.display = 'flex';
  wireWidgetPicker();
}
// Screen Settings panel — currently just the Screen Switcher, the
// one setting that previously required going to the app's Screens
// management to touch at all (see the toggle/picker built for that same
// setting there — this reuses the identical PUT /api/screens/:deviceId
// endpoint and the identical two-checklist shape, Live Displays + Saved
// Templates, just editable directly from the screen itself now). SCREEN_ID
// (this device's own persisted identity, see its own comment near where
// it's generated) is exactly the device_id that endpoint expects — no
// separate lookup needed, this panel edits ITS OWN screen's row.
async function openScreenSettingsPanel() {
  const overlay = document.getElementById('screen-settings-overlay');
  const body = document.getElementById('screen-settings-body');
  if (!overlay || !body) return;
  const toggleSectionInner = `
    <div class="was-toggle-row">
      <label>Show screen switcher</label>
      <input type="checkbox" id="ss-fls-toggle" ${state.floatingSwitcherEnabled ? 'checked' : ''}>
    </div>
    <p class="was-hint" style="margin-top:-8px">An always-present button on top of whatever layout is showing — lets you switch layouts on this screen even when the current one has no Layout Switcher widget of its own.</p>
    <div id="ss-fls-presets" style="${state.floatingSwitcherEnabled ? '' : 'display:none'}">
      <label class="was-hint" style="display:block;margin-bottom:6px">Position</label>
      <div id="ss-fls-edge-picker" style="display:flex;gap:6px;margin-bottom:12px">
        ${['top','bottom','left','right'].map(edge => `
          <button type="button" class="ss-fls-edge-btn${(state.floatingSwitcherEdge||'bottom')===edge?' active':''}" data-edge="${edge}"
            style="flex:1;padding:8px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.18);font-size:12px;font-weight:600;text-transform:capitalize;color:#e8edf5;
              background:${(state.floatingSwitcherEdge||'bottom')===edge?'rgba(74,144,217,0.5)':'rgba(255,255,255,0.08)'}">${edge}</button>
        `).join('')}
      </div>
      <label class="was-hint" style="display:block;margin-bottom:6px">Style</label>
      <div id="ss-fls-style-picker" style="display:flex;gap:6px;margin-bottom:12px">
        ${['circles','bar'].map(s => `
          <button type="button" class="ss-fls-style-btn${(state.floatingSwitcherStyle||'circles')===s?' active':''}" data-style="${s}"
            style="flex:1;padding:8px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.18);font-size:12px;font-weight:600;text-transform:capitalize;color:#e8edf5;
              background:${(state.floatingSwitcherStyle||'circles')===s?'rgba(74,144,217,0.5)':'rgba(255,255,255,0.08)'}">${s === 'circles' ? 'Circles' : 'Bar'}</button>
        `).join('')}
      </div>
      <div id="ss-fls-barmode-row" style="${(state.floatingSwitcherStyle||'circles')==='bar'?'':'display:none'};margin-bottom:12px">
        <label class="was-hint" style="display:block;margin-bottom:6px">Display</label>
        <div id="ss-fls-barmode-picker" style="display:flex;gap:6px">
          ${['icons','names'].map(m => `
            <button type="button" class="ss-fls-barmode-btn${(state.floatingSwitcherBarMode||'icons')===m?' active':''}" data-barmode="${m}"
              style="flex:1;padding:8px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.18);font-size:12px;font-weight:600;text-transform:capitalize;color:#e8edf5;
                background:${(state.floatingSwitcherBarMode||'icons')===m?'rgba(74,144,217,0.5)':'rgba(255,255,255,0.08)'}">${m === 'icons' ? 'Icons' : 'Names'}</button>
          `).join('')}
        </div>
      </div>
      <label class="was-hint" style="display:block;margin-bottom:6px">Visibility</label>
      <div id="ss-fls-reveal-picker" style="display:flex;gap:6px;margin-bottom:14px">
        ${['always','tap'].map(r => `
          <button type="button" class="ss-fls-reveal-btn${(state.floatingSwitcherReveal||'always')===r?' active':''}" data-reveal="${r}"
            style="flex:1;padding:8px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.18);font-size:12px;font-weight:600;color:#e8edf5;
              background:${(state.floatingSwitcherReveal||'always')===r?'rgba(74,144,217,0.5)':'rgba(255,255,255,0.08)'}">${r === 'always' ? 'Always visible' : 'Tap to reveal'}</button>
        `).join('')}
      </div>
      <label class="was-hint" style="display:block;margin-bottom:6px">Bar Color</label>
      <div style="margin-bottom:14px">
        <input type="color" id="ss-fls-color" value="${state.floatingSwitcherColor||'#0a0e1a'}" style="width:60px;height:44px;padding:2px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08)">
      </div>
      <label class="was-hint" style="display:block;margin-bottom:6px">Live Displays</label>
      <div id="ss-fls-display-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        <div class="was-hint">Loading…</div>
      </div>
      <label class="was-hint" style="display:block;margin-bottom:6px">Saved Templates</label>
      <div id="ss-fls-preset-list" style="display:flex;flex-direction:column;gap:8px">
        <div class="was-hint">Loading…</div>
      </div>
    </div>
  `;
  const scheduleSectionInner = `
    <p class="was-hint" style="margin:0 0 8px">Automatically switch at set times, whether or not the screen switcher button above is turned on.</p>
    <div id="ss-fls-schedule-list" style="display:flex;flex-direction:column;gap:10px"></div>
    <button type="button" class="btn" id="ss-fls-schedule-add-btn" style="width:100%;margin-top:8px;background:var(--card);border:1px solid var(--border)">+ Add a scheduled switch</button>
  `;
  const editBarSectionInner = `
    <label class="was-hint" style="display:block;margin-bottom:6px">Position</label>
    <div id="ss-editbar-position-picker" style="display:flex;gap:6px">
      ${['top','bottom'].map(pos => `
        <button type="button" class="ss-editbar-position-btn${(state.editBarPosition||'top')===pos?' active':''}" data-position="${pos}"
          style="flex:1;padding:8px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.18);font-size:12px;font-weight:600;text-transform:capitalize;color:#e8edf5;
            background:${(state.editBarPosition||'top')===pos?'rgba(74,144,217,0.5)':'rgba(255,255,255,0.08)'}">${pos}</button>
      `).join('')}
    </div>
    <p class="was-hint" style="margin-top:8px">Where the "Live Editing" bar sits while editing a layout. It can also be minimized down to a small button at any time by tapping the – on the bar itself, if a widget near that edge is still in the way.</p>
  `;
  body.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      ${accordionSection({ id: 'ss-fls-toggle-section', label: 'Show Screen Switcher', inner: toggleSectionInner }, true)}
      ${accordionSection({ id: 'ss-fls-schedule-section', label: 'Schedule', inner: scheduleSectionInner })}
      ${accordionSection({ id: 'ss-editbar-section', label: 'Edit Bar', inner: editBarSectionInner })}
    </div>
  `;
  overlay.style.display = 'flex';
  wireFlsSubAccordionsPreview();
  document.querySelectorAll('.ss-editbar-position-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ss-editbar-position-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.5)' : 'rgba(255,255,255,0.08)';
      });
      state.editBarPosition = btn.dataset.position;
      document.getElementById('edit-mode-bar').classList.toggle('edit-bar-bottom', btn.dataset.position === 'bottom');
      saveAppearance('edit_bar_position', btn.dataset.position);
    });
  });

  document.getElementById('ss-fls-toggle').addEventListener('change', async (e) => {
    document.getElementById('ss-fls-presets').style.display = e.target.checked ? '' : 'none';
    state.floatingSwitcherEnabled = e.target.checked;
    try {
      const r = await fetch(`/api/screens/${encodeURIComponent(SCREEN_ID)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floating_switcher_enabled: e.target.checked }),
      });
      // fetch() only rejects on a network-level failure — a non-2xx HTTP
      // response (404, 500, etc.) resolves normally and would otherwise
      // sail past this silently, leaving the UI showing a change that was
      // never actually saved server-side.
      if (!r.ok) { showDisplayToast('❌ Could not save — try again.'); return; }
    } catch { showDisplayToast('❌ Could not save — check the connection.'); return; }
    renderFloatingSwitcher();
  });

  const saveAppearance = async (field, value) => {
    try {
      const r = await fetch(`/api/screens/${encodeURIComponent(SCREEN_ID)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!r.ok) { showDisplayToast('❌ Could not save — try again.'); return; }
    } catch { showDisplayToast('❌ Could not save — check the connection.'); return; }
    renderFloatingSwitcher();
  };
  document.querySelectorAll('.ss-fls-edge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ss-fls-edge-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.5)' : 'rgba(255,255,255,0.08)';
      });
      state.floatingSwitcherEdge = btn.dataset.edge;
      saveAppearance('floating_switcher_edge', btn.dataset.edge);
    });
  });
  document.querySelectorAll('.ss-fls-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ss-fls-style-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.5)' : 'rgba(255,255,255,0.08)';
      });
      state.floatingSwitcherStyle = btn.dataset.style;
      // This panel's own barmode row isn't rebuilt by saveAppearance()'s
      // renderFloatingSwitcher() call below (that only re-renders the
      // actual on-screen switcher, not this settings panel) — needs its
      // own explicit show/hide right here.
      const barmodeRow = document.getElementById('ss-fls-barmode-row');
      if (barmodeRow) barmodeRow.style.display = btn.dataset.style === 'bar' ? '' : 'none';
      saveAppearance('floating_switcher_style', btn.dataset.style);
    });
  });
  document.querySelectorAll('.ss-fls-barmode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ss-fls-barmode-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.5)' : 'rgba(255,255,255,0.08)';
      });
      state.floatingSwitcherBarMode = btn.dataset.barmode;
      saveAppearance('floating_switcher_bar_mode', btn.dataset.barmode);
    });
  });
  document.querySelectorAll('.ss-fls-reveal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ss-fls-reveal-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.5)' : 'rgba(255,255,255,0.08)';
      });
      state.floatingSwitcherReveal = btn.dataset.reveal;
      saveAppearance('floating_switcher_reveal', btn.dataset.reveal);
    });
  });
  document.getElementById('ss-fls-color').addEventListener('change', (e) => {
    state.floatingSwitcherColor = e.target.value;
    saveAppearance('floating_switcher_color', e.target.value);
  });

  const saveTargets = async () => {
    const readIcon = (checkboxEl) => {
      const iconEl = checkboxEl.closest('label').querySelector('.ss-target-icon');
      return (iconEl && iconEl.value.trim()) || '';
    };
    const targets = [
      ...[...document.querySelectorAll('#ss-fls-display-list input[type="checkbox"]:checked')].map(el => ({ type: 'display', id: el.dataset.targetId, icon: readIcon(el) })),
      ...[...document.querySelectorAll('#ss-fls-preset-list input[type="checkbox"]:checked')].map(el => ({ type: 'saved', id: Number(el.dataset.targetId), icon: readIcon(el) })),
    ];
    state.floatingSwitcherPresets = targets;
    try {
      const r = await fetch(`/api/screens/${encodeURIComponent(SCREEN_ID)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floating_switcher_presets: targets }),
      });
      if (!r.ok) { showDisplayToast('❌ Could not save — try again.'); return; }
    } catch { showDisplayToast('❌ Could not save — check the connection.'); return; }
    renderFloatingSwitcher();
    // Schedule rules' own target dropdowns are now filtered to only the
    // targets checked here — without this, toggling a checkbox wouldn't
    // update what the schedule offers until some unrelated schedule edit
    // happened to re-render it.
    renderSchedule();
  };

  const assigned = new Map(normalizeSwitcherTargets(state.floatingSwitcherPresets).map(t => [switcherTargetKey(t), t]));

  let ssDisplays = [], ssPresets = [];
  const displayListEl = document.getElementById('ss-fls-display-list');
  try {
    const r = await fetch('/api/displays');
    ssDisplays = r.ok ? await r.json() : [];
    const others = ssDisplays.filter(d => d.slug !== DISPLAY_SLUG);
    displayListEl.innerHTML = others.length
      ? others.map(d => {
          const existing = assigned.get(`display:${d.slug}`);
          return `
          <label style="display:flex;align-items:center;gap:8px;font-size:14px">
            <input type="checkbox" data-target-id="${escapeHtmlD(d.slug)}" ${existing ? 'checked' : ''}>
            <input type="text" class="ss-target-icon" data-target-id="${escapeHtmlD(d.slug)}" value="${escapeHtmlD(existing ? existing.icon || '' : '')}" maxlength="8" placeholder="icon" style="width:44px;text-align:center;font-size:16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:#e8edf5;padding:6px">
            ${escapeHtmlD(d.name)}
          </label>`;
        }).join('')
      : `<div class="was-hint">No other displays yet.</div>`;
    displayListEl.querySelectorAll('input').forEach(el => el.addEventListener('change', saveTargets));
  } catch {
    displayListEl.innerHTML = `<div class="was-hint">Couldn't load displays.</div>`;
  }

  const presetListEl = document.getElementById('ss-fls-preset-list');
  try {
    const r = await fetch('/api/saved-layouts');
    ssPresets = r.ok ? await r.json() : [];
    presetListEl.innerHTML = ssPresets.length
      ? ssPresets.map(p => {
          const existing = assigned.get(`saved:${p.id}`);
          return `
          <label style="display:flex;align-items:center;gap:8px;font-size:14px">
            <input type="checkbox" data-target-id="${p.id}" ${existing ? 'checked' : ''}>
            <input type="text" class="ss-target-icon" data-target-id="${p.id}" value="${escapeHtmlD(existing ? existing.icon || '' : '')}" maxlength="8" placeholder="icon" style="width:44px;text-align:center;font-size:16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:#e8edf5;padding:6px">
            ${escapeHtmlD(p.name)}
          </label>`;
        }).join('')
      : `<div class="was-hint">No saved layouts yet.</div>`;
    presetListEl.querySelectorAll('input').forEach(el => el.addEventListener('change', saveTargets));
  } catch {
    presetListEl.innerHTML = `<div class="was-hint">Couldn't load saved layouts.</div>`;
  }

  // Schedule — reuses ssDisplays/ssPresets already fetched above. Same
  // shape and pattern as the widget's own schedule UI (app.html) and the
  // Screens management version of this same section — three places
  // building the identical rule editor because each has its own DOM and
  // save mechanism, not because the underlying concept differs at all.
  const dayNames = (window.i18n && i18n.weekdays('narrow')) || ['S','M','T','W','T','F','S'];
  const targetOptionsHtml = (selected) => {
    const selKey = selected ? `${selected.type}:${selected.id}` : '';
    // Restricted to only the targets currently checked in the "Live
    // Displays"/"Saved Templates" list above — by explicit request, the
    // schedule should offer the same curated set the floating switcher
    // itself already shows as buttons, not every display/template that
    // exists in the whole system. Still always includes the CURRENTLY
    // selected target even if it's since been unchecked from that list —
    // otherwise a rule pointing at something no longer checked would
    // silently lose that selection the moment this dropdown re-renders,
    // rather than the person seeing what's actually configured and
    // choosing to change it themselves.
    const checkedKeys = new Set(normalizeSwitcherTargets(state.floatingSwitcherPresets).map(t => `${t.type}:${t.id}`));
    // The current display being edited is ALSO always available here, even
    // though it's deliberately excluded from the switcher's own checklist
    // above (a manual button that switches to where you're already
    // standing is pointless, so it's never even shown as checkable there)
    // — by explicit request, since a rotation should still be able to
    // cycle back to this display's own native content, not just other
    // displays. The switcher's own checklist and exclusion logic are
    // untouched; this only widens what the SCHEDULE specifically treats
    // as available.
    const dispOpts = ssDisplays.filter(d => checkedKeys.has(`display:${d.slug}`) || selKey === `display:${d.slug}` || d.slug === DISPLAY_SLUG)
      .map(d => `<option value="display:${d.slug}" ${selKey === `display:${d.slug}` ? 'selected' : ''}>${escapeHtmlD(d.name)}</option>`).join('');
    const presetOpts = ssPresets.filter(p => checkedKeys.has(`saved:${p.id}`) || selKey === `saved:${p.id}`)
      .map(p => `<option value="saved:${p.id}" ${selKey === `saved:${p.id}` ? 'selected' : ''}>${escapeHtmlD(p.name)}</option>`).join('');
    return `<optgroup label="Live Displays">${dispOpts}</optgroup><optgroup label="Saved Templates">${presetOpts}</optgroup>`;
  };
  const targetLabel = (t) => {
    if (!t) return '(unknown)';
    if (t.type === 'display') {
      const d = ssDisplays.find(d => d.slug === t.id);
      return d ? d.name : t.id;
    }
    const p = ssPresets.find(p => p.id === t.id);
    return p ? p.name : `Template #${t.id}`;
  };
  const saveSchedule = async () => {
    try {
      const r = await fetch(`/api/screens/${encodeURIComponent(SCREEN_ID)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floating_switcher_schedule: state.floatingSwitcherSchedule }),
      });
      if (!r.ok) { showDisplayToast('❌ Could not save — try again.'); return; }
    } catch { showDisplayToast('❌ Could not save — check the connection.'); return; }
  };
  const renderSchedule = () => {
    const listEl = document.getElementById('ss-fls-schedule-list');
    if (!listEl) return;
    if (!Array.isArray(state.floatingSwitcherSchedule)) state.floatingSwitcherSchedule = [];
    const rules = state.floatingSwitcherSchedule;
    if (!rules.length) {
      listEl.innerHTML = `<div class="was-hint">No scheduled switches yet.</div>`;
      return;
    }
    const conflicted = scheduleConflictIndices(rules);
    listEl.innerHTML = rules.map((rule, idx) => {
      const mode = rule.mode === 'interval' ? 'interval' : rule.mode === 'rotation' ? 'rotation' : 'time';
      const intervalInputsHtml = `
           <input type="number" class="ss-rule-interval-value" min="1" value="${rule.intervalValue || 30}" style="width:64px;flex-shrink:0;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:#e8edf5;padding:9px">
           <select class="ss-rule-interval-unit" style="width:96px;flex-shrink:0;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:#e8edf5;padding:9px">
             <option value="seconds"${rule.intervalUnit === 'seconds' ? ' selected' : ''}>Seconds</option>
             <option value="minutes"${(rule.intervalUnit || 'minutes') === 'minutes' ? ' selected' : ''}>Minutes</option>
             <option value="hours"${rule.intervalUnit === 'hours' ? ' selected' : ''}>Hours</option>
           </select>`;
      const timingRowHtml = mode === 'rotation'
        ? `<div style="display:flex;gap:8px;align-items:center">
             ${intervalInputsHtml}
             <span style="font-size:11px;color:#e8edf5;opacity:0.6">per display</span>
           </div>
           <div class="ss-rotation-targets" style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
             ${(Array.isArray(rule.targets) ? rule.targets : []).map((t, tIdx) => `
               <div class="ss-rotation-target-row" data-tidx="${tIdx}" style="display:flex;gap:6px;align-items:center;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:8px;padding:6px 8px">
                 <span style="flex:1;font-size:12px;color:#e8edf5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtmlD(targetLabel(t))}</span>
                 <button type="button" class="ss-rot-move-up" aria-label="Move up" ${tIdx === 0 ? 'disabled' : ''} style="background:none;border:none;color:#e8edf5;opacity:0.6;font-size:14px;padding:2px 6px;flex-shrink:0">↑</button>
                 <button type="button" class="ss-rot-move-down" aria-label="Move down" ${tIdx === (rule.targets.length - 1) ? 'disabled' : ''} style="background:none;border:none;color:#e8edf5;opacity:0.6;font-size:14px;padding:2px 6px;flex-shrink:0">↓</button>
                 <button type="button" class="ss-rot-remove-target" aria-label="Remove" ${rule.targets.length <= 2 ? 'disabled' : ''} style="background:none;border:none;color:#e8edf5;opacity:0.6;font-size:16px;padding:2px 6px;flex-shrink:0">✕</button>
               </div>
             `).join('')}
             <select class="ss-rot-add-target" style="margin-top:2px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:#e8edf5;padding:9px">
               <option value="">+ Add a display or template…</option>
               ${targetOptionsHtml(null)}
             </select>
           </div>`
        : `<div style="display:flex;gap:8px;align-items:center">
             ${mode === 'interval' ? intervalInputsHtml : `<input type="time" class="ss-rule-time" value="${rule.time || '08:00'}" style="width:110px;flex-shrink:0;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:#e8edf5;padding:9px">`}
             <select class="ss-rule-target" style="flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:#e8edf5;padding:9px">${targetOptionsHtml(rule.target)}</select>
           </div>`;
      const enabled = rule.enabled !== false;
      const hasConflict = conflicted.has(idx);
      return `
      <div class="ss-schedule-rule" data-idx="${idx}" style="border:1px solid ${hasConflict ? 'rgba(255,176,32,0.6)' : 'rgba(255,255,255,0.15)'};border-radius:10px;padding:10px;opacity:${enabled ? '1' : '0.55'}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#e8edf5;flex:1;cursor:pointer">
            <input type="checkbox" class="ss-rule-enabled" ${enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:#4a90d9">
            Enabled
          </label>
          <button type="button" class="ss-rule-remove" aria-label="Remove" style="background:none;border:none;color:#e8edf5;opacity:0.6;font-size:18px;padding:4px 8px;flex-shrink:0">✕</button>
        </div>
        ${hasConflict ? `<div style="font-size:11px;color:#ffb020;background:rgba(255,176,32,0.12);border-radius:6px;padding:6px 8px;margin-bottom:10px">⚠️ Same time and day as another rule below — whichever fires last will win.</div>` : ''}
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <button type="button" class="ss-rule-mode-btn${mode === 'time' ? ' active' : ''}" data-mode="time"
            style="flex:1;padding:7px 0;border-radius:6px;border:1px solid rgba(255,255,255,0.18);font-size:11px;font-weight:600;color:#e8edf5;
              background:${mode === 'time' ? 'rgba(74,144,217,0.5)' : 'rgba(255,255,255,0.08)'}">At a time</button>
          <button type="button" class="ss-rule-mode-btn${mode === 'rotation' ? ' active' : ''}" data-mode="rotation"
            style="flex:1;padding:7px 0;border-radius:6px;border:1px solid rgba(255,255,255,0.18);font-size:11px;font-weight:600;color:#e8edf5;
              background:${mode === 'rotation' ? 'rgba(74,144,217,0.5)' : 'rgba(255,255,255,0.08)'}">Rotate</button>
        </div>
        ${timingRowHtml}
        <div style="display:flex;gap:4px;margin-top:8px">
          ${dayNames.map((d, i) => `<button type="button" class="ss-rule-dow-btn${(rule.daysOfWeek || []).includes(i) ? ' active' : ''}" data-dow="${i}"
            style="flex:1;padding:7px 0;border-radius:6px;border:1px solid rgba(255,255,255,0.18);font-size:11px;font-weight:700;
              background:${(rule.daysOfWeek || []).includes(i) ? 'rgba(74,144,217,0.5)' : 'rgba(255,255,255,0.08)'};color:#e8edf5">${d}</button>`).join('')}
        </div>
      </div>
    `;
    }).join('');
    listEl.querySelectorAll('.ss-schedule-rule').forEach(rowEl => {
      const idx = Number(rowEl.dataset.idx);
      const enabledCheckbox = rowEl.querySelector('.ss-rule-enabled');
      if (enabledCheckbox) enabledCheckbox.addEventListener('change', (e) => {
        state.floatingSwitcherSchedule[idx].enabled = e.target.checked;
        renderSchedule();
        saveSchedule();
      });
      rowEl.querySelectorAll('.ss-rule-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const newMode = btn.dataset.mode;
          const current = state.floatingSwitcherSchedule[idx].mode || 'time';
          if (current === newMode) return;
          state.floatingSwitcherSchedule[idx].mode = newMode;
          // Same seeding as the widget's own mode-toggle handler in app.html
          // — see its own comment for why this matters beyond what the
          // timing inputs' display-time fallbacks alone would cover.
          if ((newMode === 'interval' || newMode === 'rotation') && !state.floatingSwitcherSchedule[idx].intervalValue) {
            state.floatingSwitcherSchedule[idx].intervalValue = 30;
            state.floatingSwitcherSchedule[idx].intervalUnit = 'minutes';
          }
          if (newMode === 'time' && !state.floatingSwitcherSchedule[idx].time) {
            state.floatingSwitcherSchedule[idx].time = '08:00';
          }
          if (newMode === 'rotation' && !Array.isArray(state.floatingSwitcherSchedule[idx].targets)) {
            state.floatingSwitcherSchedule[idx].targets = state.floatingSwitcherSchedule[idx].target ? [state.floatingSwitcherSchedule[idx].target] : [];
          }
          // The missing symmetric case, found from a real report: LEAVING
          // rotation mode (to 'time' or 'interval') never set target
          // (singular) — those two modes need it, but a rotation rule only
          // ever has targets (plural). The server's own validation for
          // non-rotation modes requires target and drops the ENTIRE rule
          // when it's missing — the exact same silent-strip mechanism
          // fixed earlier for switching INTO rotation with too few
          // targets, just triggered from the opposite direction this
          // time. Carries the rotation's first target forward, mirroring
          // exactly how a single target gets carried forward into
          // targets[0] when switching the other way.
          if (newMode !== 'rotation' && !state.floatingSwitcherSchedule[idx].target && Array.isArray(state.floatingSwitcherSchedule[idx].targets) && state.floatingSwitcherSchedule[idx].targets.length) {
            state.floatingSwitcherSchedule[idx].target = state.floatingSwitcherSchedule[idx].targets[0];
          }
          renderSchedule();
          // Skip the save specifically when switching INTO rotation mode
          // leaves fewer than 2 targets (carrying forward a single prior
          // target, or starting from none at all) — the server requires 2+
          // valid targets for a rotation rule and silently drops the WHOLE
          // rule otherwise (200 OK, no error, just gone). Confirmed as the
          // actual root cause of a real report, not a hypothetical: saving
          // here unconditionally created a race between this doomed,
          // 1-target save and the very next one (once a second target gets
          // added) — if the earlier, invalid save happened to complete
          // AFTER the valid one, it silently overwrote the correct 2-target
          // save with nothing. The rule stays in memory and renders
          // correctly either way; it just doesn't hit the network until
          // there's something the server will actually accept.
          if (newMode === 'rotation' && (!state.floatingSwitcherSchedule[idx].targets || state.floatingSwitcherSchedule[idx].targets.length < 2)) return;
          saveSchedule();
        });
      });
      const timeInput = rowEl.querySelector('.ss-rule-time');
      if (timeInput) timeInput.addEventListener('change', (e) => {
        state.floatingSwitcherSchedule[idx].time = e.target.value;
        saveSchedule();
      });
      const intervalValueInput = rowEl.querySelector('.ss-rule-interval-value');
      if (intervalValueInput) intervalValueInput.addEventListener('change', (e) => {
        state.floatingSwitcherSchedule[idx].intervalValue = Number(e.target.value) || 1;
        saveSchedule();
      });
      const intervalUnitSelect = rowEl.querySelector('.ss-rule-interval-unit');
      if (intervalUnitSelect) intervalUnitSelect.addEventListener('change', (e) => {
        state.floatingSwitcherSchedule[idx].intervalUnit = e.target.value;
        saveSchedule();
      });
      const targetSelect = rowEl.querySelector('.ss-rule-target');
      if (targetSelect) targetSelect.addEventListener('change', (e) => {
        const [type, id] = e.target.value.split(/:(.+)/);
        state.floatingSwitcherSchedule[idx].target = { type, id: type === 'saved' ? Number(id) : id };
        saveSchedule();
      });
      const addTargetSelect = rowEl.querySelector('.ss-rot-add-target');
      if (addTargetSelect) addTargetSelect.addEventListener('change', (e) => {
        if (!e.target.value) return;
        const [type, id] = e.target.value.split(/:(.+)/);
        if (!Array.isArray(state.floatingSwitcherSchedule[idx].targets)) state.floatingSwitcherSchedule[idx].targets = [];
        state.floatingSwitcherSchedule[idx].targets.push({ type, id: type === 'saved' ? Number(id) : id });
        renderSchedule();
        // Same guard as the mode-switch handler above — normally this push
        // brings a 1-target rotation to 2 (safe to save), but if a rotation
        // ever started genuinely empty (no prior target to carry forward),
        // this first addition would only reach 1, which the server would
        // equally silently strip.
        if (state.floatingSwitcherSchedule[idx].targets.length < 2) return;
        saveSchedule();
      });
      rowEl.querySelectorAll('.ss-rotation-target-row').forEach(trEl => {
        const tIdx = Number(trEl.dataset.tidx);
        const upBtn = trEl.querySelector('.ss-rot-move-up');
        if (upBtn) upBtn.addEventListener('click', () => {
          const targets = state.floatingSwitcherSchedule[idx].targets;
          [targets[tIdx - 1], targets[tIdx]] = [targets[tIdx], targets[tIdx - 1]];
          renderSchedule();
          saveSchedule();
        });
        const downBtn = trEl.querySelector('.ss-rot-move-down');
        if (downBtn) downBtn.addEventListener('click', () => {
          const targets = state.floatingSwitcherSchedule[idx].targets;
          [targets[tIdx + 1], targets[tIdx]] = [targets[tIdx], targets[tIdx + 1]];
          renderSchedule();
          saveSchedule();
        });
        trEl.querySelector('.ss-rot-remove-target').addEventListener('click', () => {
          // Mirrors the disabled state on this same button above — rotation
          // has a hard minimum of 2 targets (see checkSchedules()'s own
          // rotation branch and the server's validation, both of which
          // require 2+), so removing down to 1 is never a state worth
          // reaching at all, not something to allow and then silently fail
          // to save.
          if (state.floatingSwitcherSchedule[idx].targets.length <= 2) return;
          state.floatingSwitcherSchedule[idx].targets.splice(tIdx, 1);
          renderSchedule();
          saveSchedule();
        });
      });
      rowEl.querySelectorAll('.ss-rule-dow-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const dow = Number(btn.dataset.dow);
          const days = new Set(state.floatingSwitcherSchedule[idx].daysOfWeek || []);
          if (days.has(dow)) days.delete(dow); else days.add(dow);
          state.floatingSwitcherSchedule[idx].daysOfWeek = [...days];
          renderSchedule();
          saveSchedule();
        });
      });
      const removeBtn = rowEl.querySelector('.ss-rule-remove');
      if (removeBtn) removeBtn.addEventListener('click', () => {
        state.floatingSwitcherSchedule.splice(idx, 1);
        renderSchedule();
        saveSchedule();
      });
    });
  };
  renderSchedule();
  document.getElementById('ss-fls-schedule-add-btn').addEventListener('click', () => {
    // Prefers the first CHECKED switcher target, consistent with the same
    // restriction now on the dropdown itself — falls back to the first
    // display/template in the whole system only if nothing's checked at
    // all yet, since otherwise an empty checklist would make it
    // impossible to create any rule in the first place.
    const checkedTargets = normalizeSwitcherTargets(state.floatingSwitcherPresets);
    const defaultTarget = checkedTargets[0] || (ssDisplays[0] ? { type: 'display', id: ssDisplays[0].slug }
      : ssPresets[0] ? { type: 'saved', id: ssPresets[0].id } : null);
    if (!defaultTarget) { showDisplayToast('Add a display or save a layout first.'); return; }
    if (!Array.isArray(state.floatingSwitcherSchedule)) state.floatingSwitcherSchedule = [];
    state.floatingSwitcherSchedule.push({ mode: 'time', time: '08:00', daysOfWeek: [1, 2, 3, 4, 5], target: defaultTarget });
    renderSchedule();
    saveSchedule();
  });
}
function closeWidgetPicker() {
  const overlay = document.getElementById('widget-picker-overlay');
  if (overlay) overlay.style.display = 'none';
}
function wireWidgetPicker() {
  document.querySelectorAll('.wp-category-head').forEach(head => {
    if (head._wired) return;
    head._wired = true;
    head.addEventListener('click', () => {
      head.closest('.wp-category').classList.toggle('open');
    });
  });
  document.querySelectorAll('.wp-type-item').forEach(item => {
    if (item._wired) return;
    item._wired = true;
    item.addEventListener('click', () => {
      closeWidgetPicker();
      enterPlacementMode(item.dataset.type);
    });
  });
  const closeBtn = document.getElementById('widget-picker-close');
  if (closeBtn && !closeBtn._wired) {
    closeBtn._wired = true;
    closeBtn.addEventListener('click', closeWidgetPicker);
  }
}

// Placement mode: the NEXT tap on the canvas places the widget there,
// rather than dropping it at a fixed spot the way app.html's editor does —
// see the HTML comment on #widget-place-banner for why this is deliberately
// different on the display specifically.
let pendingPlacementType = null;
function enterPlacementMode(type) {
  deselectWidgetForEdit(); // clean slate — avoid the settings panel and placement banner both showing at once
  pendingPlacementType = type;
  document.body.classList.add('placing-widget');
  document.getElementById('edit-mode-bar').style.display = 'none';
  const banner = document.getElementById('widget-place-banner');
  const def = WIDGET_DEFS.find(d => d.type === type);
  document.getElementById('widget-place-label').textContent =
    `Tap where you'd like to place the ${def ? def.label : 'widget'}`;
  banner.style.display = 'flex';
}
function cancelPlacementMode() {
  pendingPlacementType = null;
  document.body.classList.remove('placing-widget');
  document.getElementById('widget-place-banner').style.display = 'none';
  if (editModeActive) document.getElementById('edit-mode-bar').style.display = 'flex';
}
async function placeNewWidgetAt(clientX, clientY) {
  const type = pendingPlacementType;
  if (!type) return;
  const canvas = document.getElementById('canvas');
  const rect = canvas.getBoundingClientRect();
  const W = effectiveWidth(), H = effectiveHeight();
  const newWidget = buildNewWidgetDefaults(type);
  // Center the widget's default size on the tapped point, then clamp so it
  // can't be placed partially or fully off-canvas — the same clamp shape
  // onDragEnd() already uses for moving an existing widget.
  let x = ((clientX - rect.left) / W) * 100 - newWidget.w / 2;
  let y = ((clientY - rect.top) / H) * 100 - newWidget.h / 2;
  x = Math.max(0, Math.min(100 - newWidget.w, x));
  y = Math.max(0, Math.min(100 - newWidget.h, y));
  newWidget.x = x; newWidget.y = y;

  cancelPlacementMode();
  state.layout.push(newWidget);
  renderLayout();
  selectWidgetForEdit(newWidget.id);
  await saveLayoutNow();
  showDisplayToast(`${WIDGET_DEFS.find(d => d.type === type)?.label || 'Widget'} added`);
}
function wireCanvasPlacementTap() {
  const canvas = document.getElementById('canvas');
  if (!canvas || canvas._placementWired) return;
  canvas._placementWired = true;
  canvas.addEventListener('pointerdown', (e) => {
    if (!pendingPlacementType) return;
    // Placing is itself a "consuming" tap — stop it from also being treated
    // as an empty-canvas deselect tap or bubbling anywhere else.
    e.stopPropagation();
    placeNewWidgetAt(e.clientX, e.clientY);
  });
}
function wireChoreChartTaps() {
  document.querySelectorAll('.w-chorechart .cc-item[data-instance-id]').forEach(el => {
    if (el._tapWired) return; // avoid attaching a duplicate listener on every re-render
    el._tapWired = true;
    el.addEventListener('click', () => { if (editModeActive) return; toggleChoreChartItem(el); });
  });
}
function wireLayoutSwitcherTaps() {
  document.querySelectorAll('.w-layoutswitcher .ls-btn[data-target-id]').forEach(el => {
    if (el._tapWired) return;
    el._tapWired = true;
    el.addEventListener('click', () => {
      const type = el.dataset.targetType;
      const id = type === 'display' ? el.dataset.targetId : Number(el.dataset.targetId);
      switchToLayoutTarget({ type, id }, 'widget-button-tap');
    });
  });
}
function showDisplayToast(message, opts) {
  const o = opts || {};
  const el = document.createElement('div');
  el.className = 'cc-toast';
  el.textContent = message;
  // Optional inline "Undo" action (Family Message Board delete): keeps the
  // toast up a beat longer and self-dismisses once tapped or on timeout.
  let outAt = 2200, gone = 2600;
  if (typeof o.undo === 'function') {
    outAt = 3800; gone = 4200;
    const b = document.createElement('button');
    b.className = 'cc-toast-undo';
    b.textContent = 'Undo';
    b.addEventListener('click', () => { try { o.undo(); } finally { el.remove(); } });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('cc-toast-out'), outAt);
  setTimeout(() => el.remove(), gone);
}
async function toggleChoreChartItem(el) {
  const instId = el.dataset.instanceId;
  const wasDone = el.classList.contains('done');
  if (!wasDone && el.dataset.photoRequired === '1') {
    showDisplayToast('📷 This chore needs a photo — use the kid check-off page for it.');
    return;
  }
  // Optimistic flip, same pattern the kid page already uses.
  el.classList.toggle('done');
  const box = el.querySelector('.cc-box');
  if (box) box.textContent = el.classList.contains('done') ? '✓' : '';
  try {
    const res = await fetch(`/api/chore-instances/${instId}/toggle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !wasDone }),
    });
    const r = await res.json();
    if (!res.ok || r.error) throw new Error(r.error || 'toggle failed');
  } catch {
    // Revert on failure (e.g. the server-side photo-required check catching
    // something the data-attribute above didn't, or a network hiccup).
    el.classList.toggle('done');
    if (box) box.textContent = el.classList.contains('done') ? '✓' : '';
    showDisplayToast('❌ Could not update — try again.');
  }
}
// To-Do widget's own tap-to-complete — same pattern as the chore chart just
// above (and reusing its showDisplayToast() for the failure case), against
// PUT /api/todo-items/:id, the same endpoint the Family Hub's own to-do list
// already uses. No photo-required equivalent to worry about here.
function wireTodoWidgetTaps() {
  document.querySelectorAll('.w-todo .td-item[data-item-id]').forEach(el => {
    if (el._tapWired) return;
    el._tapWired = true;
    el.addEventListener('click', () => toggleTodoWidgetItem(el));
  });
}
async function toggleTodoWidgetItem(el) {
  const itemId = el.dataset.itemId;
  const wasDone = el.classList.contains('done');
  el.classList.toggle('done');
  const box = el.querySelector('.td-box');
  if (box) box.textContent = el.classList.contains('done') ? '✓' : '';
  try {
    const res = await fetch(`/api/todo-items/${itemId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !wasDone }),
    });
    const r = await res.json();
    if (!res.ok || r.error) throw new Error(r.error || 'toggle failed');
  } catch {
    el.classList.toggle('done');
    if (box) box.textContent = el.classList.contains('done') ? '✓' : '';
    showDisplayToast('❌ Could not update — try again.');
  }
}

// Tap-to-complete on a Tasks/Tasks Combined item — genuinely completes the
// task on Todoist itself (not a display-only hide), matching what tapping
// the checkbox in Todoist's own app does. Unlike Todo (a locally-owned
// table with its own toggle-back-and-forth semantics), there's no "reopen"
// here — once closed, Todoist itself won't return it in the active-tasks
// list this app reads from, so there's nothing local to toggle back even
// if someone wanted to.
function wireTasksWidgetTaps() {
  document.querySelectorAll('.w-tasks .tk-item[data-task-id], .w-tasks-combined .tk-item[data-task-id]').forEach(el => {
    if (el._tapWired) return;
    el._tapWired = true;
    el.addEventListener('click', () => completeTaskItem(el));
  });
}
async function completeTaskItem(el) {
  if (el.classList.contains('completing')) return; // ignore a double-tap mid-request
  const taskId = el.dataset.taskId;
  // Optimistic: fade the tapped item out immediately on THIS widget for
  // instant feedback, rather than waiting on a network round-trip. Other
  // widgets showing the same task (e.g. a "Tasks Combined" widget overlapping
  // with a single-project "Tasks" widget) catch up shortly after via the
  // full refetch below, rather than trying to hand-patch every possibly-
  // affected cache entry precisely — simpler and just as correct, at the
  // cost of those OTHER widgets updating a beat later than this one.
  el.classList.add('completing');
  el.style.transition = 'opacity .2s ease';
  el.style.opacity = '0.35';
  try {
    const res = await fetch(`/api/todoist/tasks/${encodeURIComponent(taskId)}/close`, { method: 'POST' });
    const r = await res.json();
    if (!res.ok || r.error) throw new Error(r.error || 'close failed');
    el.style.height = el.offsetHeight + 'px'; // lock current height before collapsing, so the collapse itself animates
    requestAnimationFrame(() => {
      el.style.height = '0px'; el.style.paddingTop = '0'; el.style.paddingBottom = '0'; el.style.marginTop = '0'; el.style.overflow = 'hidden';
    });
    setTimeout(async () => {
      await fetchTasksForLayout(); // reconciles every Tasks/Tasks Combined widget's cache from Todoist's real current state
      renderLayout();
    }, 220);
  } catch {
    el.classList.remove('completing');
    el.style.opacity = '';
    showDisplayToast('❌ Could not complete — try again.');
  }
}
function renderChoreLeaderboard(widget) {
  const w = widget || {};
  const data = state.choreChart;
  const title = w.lbTitle || 'Chore Leaderboard';
  const lbFontPx = w.lbFontPx || 15;
  const lbStyle = `--lb-font:calc(${lbFontPx}px * var(--ui-scale,1))`;
  if (!data || !data.kids || !data.kids.length) {
    return `<div class="w-chorelb" style="${lbStyle}"><div class="lb-head">${escapeHtmlD(title)}</div><div class="lb-empty">No kids set up yet</div></div>`;
  }
  let kidsList = data.kids;
  if (Array.isArray(w.lbKidIds) && w.lbKidIds.length) {
    const want = new Set(w.lbKidIds.map(String));
    kidsList = data.kids.filter(k => want.has(String(k.id)));
  }
  if (!kidsList.length) {
    return `<div class="w-chorelb" style="${lbStyle}"><div class="lb-head">${escapeHtmlD(title)}</div><div class="lb-empty">No children selected</div></div>`;
  }
  const rankBy = w.lbRankBy || 'streak';
  const statFor = (k) => rankBy === 'weekly' ? (k.weeklyDone || 0) : (k.streak || 0);
  // Rank by the chosen stat descending, ties broken alphabetically for a stable,
  // non-jumpy order (otherwise same-score kids could swap positions randomly
  // between refreshes, which is a confusing thing for a kid to watch happen).
  const ranked = [...kidsList].sort((a, b) => statFor(b) - statFor(a) || String(a.name).localeCompare(String(b.name)));
  const medals = ['🥇', '🥈', '🥉'];
  const rows = ranked.map((k, i) => {
    const stat = statFor(k);
    const statLabel = rankBy === 'weekly' ? `${stat}/${k.weeklyTotal || 0}` : (stat > 0 ? `🔥${stat}` : '—');
    return `<div class="lb-row">
      <span class="lb-rank">${medals[i] || (i + 1)}</span>
      <span class="lb-avatar">${k.avatar || '🙂'}</span>
      <span class="lb-name" style="color:${k.color || 'inherit'}">${escapeHtmlD(k.name)}</span>
      <span class="lb-stat">${statLabel}</span>
    </div>`;
  }).join('');
  return `<div class="w-chorelb" style="${lbStyle}">
    <div class="lb-head">${escapeHtmlD(title)}</div>
    <div class="lb-rows">${rows}</div>
  </div>`;
}
function renderTodoWidget(widget) {
  const w = widget || {};
  const tdFontPx = w.todoFontPx || 15;
  const tdStyle = `--td-font:calc(${tdFontPx}px * var(--ui-scale,1))`;
  if (!w.listId) {
    return `<div class="w-todo" style="${tdStyle}"><div class="td-head">To-Do</div><div class="no-data">Pick a list in this widget's settings</div></div>`;
  }
  const listMeta = (state.todoListsMeta || []).find(l => l.id === w.listId);
  const title = w.todoTitle || (listMeta ? listMeta.name : 'To-Do');
  const allItems = (state.todoItems && state.todoItems[w.listId]) || [];
  const items = (w.todoShowDone === false) ? allItems.filter(it => !it.done) : allItems;
  if (!items.length) {
    return `<div class="w-todo" style="${tdStyle}"><div class="td-head">${escapeHtmlD(title)}</div><div class="no-data">All done! 🎉</div></div>`;
  }
  const rows = items.map(it => `
    <div class="td-item${it.done ? ' done' : ''}" data-item-id="${it.id}" data-interactive="1">
      <span class="td-box">${it.done ? '✓' : ''}</span>
      <span class="td-text">${escapeHtmlD(it.text)}</span>
    </div>`).join('');
  return `<div class="w-todo" style="${tdStyle}">
    <div class="td-head">${escapeHtmlD(title)}</div>
    <div class="td-items">${rows}</div>
  </div>`;
}
function escapeHtmlD(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// Info button + popup — same pattern and API as app.html's own version
// (infoBtn/showInfoPopup/window._infoTexts), duplicated here rather than
// shared since this file and app.html don't share a module system (same
// constraint already true of several other things in this project, e.g.
// server.js/admin.html's version-compare functions). Widget settings text
// converted to use this lives inline as `${infoBtn('...')}` calls within
// each settings panel's own template literal, registering itself at
// render time rather than needing hand-curated IDs ahead of time.
window._infoTexts = window._infoTexts || {};
let _infoIdCounter = 0;
function infoBtn(text) {
  const id = 'info-' + (_infoIdCounter++);
  window._infoTexts[id] = text;
  return `<span class="info-btn" onclick="showInfoPopup('${id}')" role="button" aria-label="More info">ⓘ</span>`;
}
function showInfoPopup(id) {
  const text = window._infoTexts[id];
  if (!text) return;
  const existing = document.getElementById('info-popup-modal');
  if (existing) existing.remove(); // in case one's already open somehow
  const modal = document.createElement('div');
  modal.id = 'info-popup-modal';
  modal.innerHTML = `<div id="info-popup-content">${text}<div style="text-align:right;margin-top:14px"><button id="info-popup-close">Got it</button></div></div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  document.getElementById('info-popup-close').addEventListener('click', () => modal.remove());
}

// Tap-to-complete, same shape as the To-Do widget just below — the old
// read-only-on-purpose note here no longer applies (the developer's said to disregard
// it); this now mirrors the Chore Chart/To-Do pattern exactly: optimistic
// update against the same PUT /api/shopping-items/:id endpoint the Family
// Hub and app already use, revert-on-failure via showDisplayToast().
// Which shopping list a widget shows: its own shoppingListId, or the default
// (first) list when it has none — or when the list it was pointed at has since
// been deleted. null only if lists haven't loaded (or the host predates lists).
function shoppingListForWidget(w, lists) {
  lists = lists || [];
  return lists.find(l => l.id === Number(w && w.shoppingListId)) || lists[0] || null;
}
function renderShoppingListWidget(widget) {
  const w = widget || {};
  const slFontPx = w.shoppingFontPx || 15;
  const slStyle = `--sl-font:calc(${slFontPx}px * var(--ui-scale,1))`;
  const list = shoppingListForWidget(w, state.shoppingLists);
  const title = w.shoppingTitle || (list && list.name) || 'Shopping List';
  // Items with no list_id (a host that predates lists) count as belonging to
  // whichever list is showing, so nothing disappears during a mixed-version update.
  const allItems = (state.shoppingItems || []).filter(it => it.list_id == null || !list || Number(it.list_id) === list.id);
  const items = (w.shoppingShowDone === false) ? allItems.filter(it => !it.done) : allItems;
  if (!items.length) {
    return `<div class="w-shopping" style="${slStyle}"><div class="sl-head">${escapeHtmlD(title)}</div><div class="no-data">List's empty 🎉</div></div>`;
  }
  const rows = items.map(it => `
    <div class="sl-item${it.done ? ' done' : ''}" data-item-id="${it.id}" data-interactive="1">
      <span class="sl-box">${it.done ? '✓' : ''}</span>
      <span class="sl-text">${escapeHtmlD(it.text)}</span>
    </div>`).join('');
  return `<div class="w-shopping" style="${slStyle}">
    <div class="sl-head">${escapeHtmlD(title)}</div>
    <div class="sl-items">${rows}</div>
  </div>`;
}
// Shopping List widget's own tap-to-complete — same pattern as the To-Do
// widget above (and reusing its showDisplayToast() for the failure case),
// against PUT /api/shopping-items/:id, the same endpoint the Family Hub and
// app's own Shopping tab already use. No photo-required equivalent here.
// Shopping List auto-fit: shrink-only. Starts at the widget's own configured
// font size and steps down ~6% at a time until the whole list fits its box,
// with a floor so a huge list doesn't collapse into unreadable specks. A list
// that already fits is left exactly as configured, so turning this on never
// changes how an existing, non-overflowing widget looks. Deliberately NOT the
// ratio/grow-to-fill approach of the (currently disabled) weather/clock
// auto-fit above — height-only iterative shrink is the one variant that
// doesn't depend on getting a scale ratio right.
const SL_AUTOFIT_MIN_SCALE = 0.3;
function autoFitShoppingWidget(widgetEl, w) {
  const root = widgetEl.querySelector('.w-shopping');
  const list = root && root.querySelector('.sl-items');
  if (!root || !list) return;
  const startPx = w.shoppingFontPx || 15;
  let px = startPx;
  // The row gap shrinks with the text (--sl-gap); at full size it works out to
  // exactly the original 7px, so an untouched widget looks identical.
  const apply = () => {
    root.style.setProperty('--sl-font', `calc(${px.toFixed(2)}px * var(--ui-scale,1))`);
    root.style.setProperty('--sl-gap', `calc(${(7 * px / startPx).toFixed(2)}px * var(--ui-scale,1))`);
  };
  apply();
  let guard = 40;
  while (list.scrollHeight > list.clientHeight + 1 && guard-- > 0) {
    px *= 0.94;
    if (px <= startPx * SL_AUTOFIT_MIN_SCALE) { px = startPx * SL_AUTOFIT_MIN_SCALE; apply(); break; }
    apply();
  }
}
let _shoppingFitObserver = null;
function fitShoppingWidgets() {
  if (_shoppingFitObserver) _shoppingFitObserver.disconnect();
  _shoppingFitObserver = new ResizeObserver((entries) => {
    entries.forEach(entry => {
      const w = state.layout.find(x => String(x.id) === String(entry.target.dataset.widgetId));
      if (w && w.shoppingAutoFit !== false) autoFitShoppingWidget(entry.target, w);
    });
  });
  document.querySelectorAll('.widget[data-widget-id]').forEach(el => {
    const w = state.layout.find(x => String(x.id) === String(el.dataset.widgetId));
    if (w && w.type === 'shoppinglist' && w.shoppingAutoFit !== false) {
      autoFitShoppingWidget(el, w); // applied directly so the first paint is already fit
      _shoppingFitObserver.observe(el); // and again on any later resize (drag-resizing in Live Edit)
    }
  });
}
function wireShoppingWidgetTaps() {
  fitShoppingWidgets();
  document.querySelectorAll('.w-shopping .sl-item[data-item-id]').forEach(el => {
    if (el._tapWired) return;
    el._tapWired = true;
    el.addEventListener('click', () => toggleShoppingWidgetItem(el));
  });
}
async function toggleShoppingWidgetItem(el) {
  const itemId = el.dataset.itemId;
  const wasDone = el.classList.contains('done');
  el.classList.toggle('done');
  const box = el.querySelector('.sl-box');
  if (box) box.textContent = el.classList.contains('done') ? '✓' : '';
  try {
    const res = await fetch(`/api/shopping-items/${itemId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !wasDone }),
    });
    const r = await res.json();
    if (!res.ok || r.error) throw new Error(r.error || 'toggle failed');
  } catch {
    el.classList.toggle('done');
    if (box) box.textContent = el.classList.contains('done') ? '✓' : '';
    showDisplayToast('❌ Could not update — try again.');
  }
}
function choreIconHtmlD(icon){
  if (icon && icon.indexOf('img:') === 0) {
    return `<img src="/uploads/${encodeURIComponent(icon.slice(4))}" alt="" style="width:calc(18px * var(--ui-scale,1));height:calc(18px * var(--ui-scale,1));object-fit:cover;border-radius:4px;vertical-align:middle">`;
  }
  return icon || '';
}

// Same sticker badge spec as app.html's stickerBadgeHtmlApp / kids.html's
// stickerBadgeHtml — kept in sync by hand across the three files (no shared
// module system between them, same constraint noted elsewhere for
// server.js/admin.html's version-compare logic). This is the one used
// wherever a sticker badge appears on the wall display: the chore chart
// widget's per-kid balance and the calendar widget's day-cell badges.
// sizeExpr is a full CSS length value (e.g. '16px' or, for anything that
// needs to track the display's responsive scale the way every other
// pixel-based visual on this screen does, 'calc(16px * var(--ui-scale,1))')
// — never a bare number, so callers stay in control of whether/how this
// scales rather than this function silently baking in a fixed size.
function stickerBadgeHtmlD(kid, sizeExpr = '16px') {
  const initial = (kid.name || '?').trim().charAt(0).toUpperCase() || '?';
  if (kid.sticker_style === 'avatar') {
    return `<span style="font-size:${sizeExpr};line-height:1">${kid.avatar || '🙂'}</span>`;
  }
  if (kid.sticker_style === 'custom' && kid.sticker_emoji) {
    return `<span style="font-size:${sizeExpr};line-height:1">${kid.sticker_emoji}</span>`;
  }
  return `<span style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:${sizeExpr};height:${sizeExpr};flex-shrink:0">
    <svg viewBox="0 0 24 24" style="width:100%;height:100%;display:block"><path fill="${kid.color || '#4A90D9'}" d="M12 1.5l3.09 6.26 6.91 1-5 4.87 1.18 6.88L12 17.27l-6.18 3.24L7 13.63l-5-4.87 6.91-1z"/></svg>
    <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding-top:calc(${sizeExpr} * 0.08);font-size:calc(${sizeExpr} * 0.42);font-weight:800;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.35)">${initial}</span>
  </span>`;
}

