// ── Layout Editor ─────────────────────────────────────────────────────────────

// Mirrors FONT_STACKS' keys in display.html (a separate file — this doesn't
// need the actual CSS stack strings, just the same list of names, kept in
// sync by hand since there's no shared module between the two).
const FONT_CHOICES = {
  'Inter': 'Inter', 'Montserrat': 'Montserrat', 'Oswald': 'Oswald', 'Bebas Neue': 'Bebas Neue',
  'Playfair Display': 'Playfair Display', 'Merriweather': 'Merriweather', 'Georgia': 'Georgia',
  'Dancing Script': 'Dancing Script', 'Pacifico': 'Pacifico', 'Great Vibes': 'Great Vibes',
  'Sacramento': 'Sacramento', 'Satisfy': 'Satisfy', 'Caveat': 'Caveat', 'Lobster': 'Lobster',
  'Comfortaa': 'Comfortaa', 'Righteous': 'Righteous',
};
// Short label for each date_format value, reused wherever a "Use global
// default (X)" option needs to show what the global choice actually is —
// shared across the Date widget's own dropdown and the calendar-related
// widgets' (Mini Calendar, Agenda, Upcoming, Today) per-widget overrides.
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
// One row of the Date & Time widget's per-item font-size overrides — 0
// means "Auto" (unset, falls through to the proportional calc() rule in
// display.html's CSS), any other value is an explicit px override for
// just that one element. Six of these share this same shape (Time/
// Seconds/AM-PM/Day Name/Date/Temperature), so it's written once rather
// than six times.
function dtSizeOverrideRowHtml(id, label, currentValue, max) {
  const val = currentValue || 0;
  return `
    <div class="settings-row">
      <label>${label}</label>
      <div class="range-row">
        <input type="range" id="${id}" min="0" max="${max}" step="1" value="${val}">
        <span class="range-val" id="${id}-val">${val ? val + 'px' : 'Auto'}</span>
      </div>
    </div>
  `;
}
function dateFormatOverrideRowHtml(selectId, currentValue, globalLabel) {
  return `
    <div class="settings-row">
      <label>Date Format</label>
      <select class="form-input" id="${selectId}">
        <option value=""            ${!currentValue?'selected':''}>Use global default (${globalLabel})</option>
        <option value="locale"     ${currentValue==='locale'?'selected':''}>Follow the language</option>
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
// agAmpmCase, etc.). Mirrors ampmCaseOverrideRowHtml() in display.html.
function ampmCaseOverrideRowHtml(selectId, currentValue) {
  return `
    <div class="settings-row">
      <label>AM/PM Style</label>
      <select class="form-input" id="${selectId}">
        <option value="default" ${!currentValue||currentValue==='default'?'selected':''}>Use display setting</option>
        <option value="lower" ${currentValue==='lower'?'selected':''}>Lowercase (2:30 pm)</option>
        <option value="upper" ${currentValue==='upper'?'selected':''}>Uppercase (2:30 PM)</option>
      </select>
    </div>
  `;
}
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
  { type:'layoutswitcher', label:'Layout Switcher', icon:'🔀' },
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

// Widget palette grouped into expandable categories. Tapping a category reveals the
// specific widgets inside it. Each entry references WIDGET_DEFS by type.
const WIDGET_CATEGORIES = [
  { id:'time',     label:'Time',     icon:'🕐', types:['clock','date','datetime','countdown','timer'] },
  { id:'calendar', label:'Calendar', icon:'🗓️', types:['minical','upcoming','today','agenda'] },
  { id:'weather',  label:'Weather',  icon:'☀️', types:['weather','weatherCurrent','weatherForecast','weatherHourly','weatherComboForecast','airquality','moonphase','metar','radar'] },
  { id:'tasks',    label:'Tasks',    icon:'✅', types:['tasks','tasksCombined','todo'] },
  { id:'info',     label:'Info',     icon:'📰', types:['news','stocks','text','onthisday','dailyquote','sports','travel','flightmap'] },
  { id:'photos',   label:'Photos',   icon:'🖼️', types:['photo'] },
  { id:'family',   label:'Family',   icon:'🧹', types:['chorechart','chorelb','shoppinglist','reminders','messageboard','mealplan'] },
  { id:'utility',  label:'Utility',  icon:'▦', types:['qrcode','webpage','layoutswitcher'] },
  { id:'decor',    label:'Decor',    icon:'🌿', types:['decoration'] },
  { id:'smarthome', label:'Smart Home', icon:'🏠', types:['entitystatus','smarthomeDashboard','groupcontrol','camera'] },
];
const widgetDefByType = (t) => WIDGET_DEFS.find(d => d.type === t);
let openWidgetCategory = null; // which palette category is expanded

// Persisted in localStorage so reopening the app/Layout tab lands back on whichever
// orientation you were last editing, instead of always resetting to landscape.
let layoutOrientation = localStorage.getItem('lastEditedOrientation') || 'landscape';
let layoutWidgets = [];

// ── Web font support (shared by the text widget) ──────────────────────────────
// A few fonts are always available (system or bundled); the rest are loaded from
// Google Fonts on demand. FONT_STACKS maps a friendly name to its CSS stack;
// GOOGLE_FONTS lists which ones need a stylesheet injected.
const FONT_STACKS = {
  'Inter': "'Inter',sans-serif",
  'Montserrat': "'Montserrat',sans-serif",
  'Oswald': "'Oswald',sans-serif",
  'Bebas Neue': "'Bebas Neue',sans-serif",
  'Playfair Display': "'Playfair Display',serif",
  'Merriweather': "'Merriweather',serif",
  'Georgia': "Georgia,'Times New Roman',serif",
  'Dancing Script': "'Dancing Script',cursive",
  'Pacifico': "'Pacifico',cursive",
  'Great Vibes': "'Great Vibes',cursive",
  'Sacramento': "'Sacramento',cursive",
  'Satisfy': "'Satisfy',cursive",
  'Caveat': "'Caveat',cursive",
  'Lobster': "'Lobster',cursive",
  'Comfortaa': "'Comfortaa',sans-serif",
  'Righteous': "'Righteous',sans-serif",
};
// Georgia is a system font; everything else here is loaded from Google.
const GOOGLE_FONTS = new Set(Object.keys(FONT_STACKS).filter(f => f !== 'Georgia' && f !== 'Inter'));
function cssFontStack(name) { return FONT_STACKS[name] || FONT_STACKS['Inter']; }
function ensureWebFont(name) {
  if (!name || !GOOGLE_FONTS.has(name)) return;
  const id = 'gfont-' + name.replace(/\s+/g, '-');
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;500;700&display=swap`;
  document.head.appendChild(link);
}
let snapEnabled = true;
const GRID = 2; // snap grid in % units
let selectedId = null;
let idCounter = Date.now();
// Live Edit panel state — MUST be top-level (not declared inside drawEditor()), since
// drawEditor() re-runs on every orientation/display switch. A `let` declared inside
// it would create a fresh variable and a fresh `window.addEventListener('resize',...)`
// on every single call — window itself never gets recreated, so those listeners (and
// the increasingly stale `previewOn` each one's closure captured) accumulated forever
// across a session, which is exactly the kind of bug that "works after a fresh
// reload, breaks again after a while" points to.
let previewOn = false;
let reportedRes = null; // this device's own real resolution, if it's reported one

// Also top-level for the same reason as previewOn above — defined once, not
// redefined (and re-closed-over) on every drawEditor() call.
function getPreviewResolution() {
  const presetEl = $('preview-res-preset');
  if (!presetEl) return null; // Layout tab isn't the active tab right now
  const preset = presetEl.value;
  let tw, th;
  if (preset === 'reported' && reportedRes) {
    tw = reportedRes.w; th = reportedRes.h;
  } else if (preset === 'custom') {
    tw = parseInt($('preview-res-w').value) || 1920;
    th = parseInt($('preview-res-h').value) || 1080;
  } else {
    [tw, th] = preset.split('x').map(Number);
  }
  if (!tw || !th) return null;
  return { tw, th, preset };
}

function buildPreviewUrl(tw, th) {
  // Include this profile's own rotation override (if any) so the Live Edit panel
  // shows what the screen will ACTUALLY look like once rotated, not just the
  // pre-rotation landscape/portrait shape — confirmed this was a real bug:
  // a profile set to rotate 90° still previewed flat, landscape, unrotated.
  // "Use Screen Settings" (rotation 0, deferring to whatever screen it ends
  // up on) has nothing meaningful to preview here, so only pass a value when
  // this profile has an actual override set.
  const current = (cachedDisplays || []).find(d => d.slug === currentDisplaySlug);
  const rotation = current ? (Number(current.rotation) || 0) : 0;
  const rotationParam = rotation ? `&previewRotation=${rotation}` : '';
  return `${window.location.origin}/?display=${encodeURIComponent(currentDisplaySlug||'')}&previewOrientation=${layoutOrientation}&previewResolution=${tw}x${th}${rotationParam}&preview=1&allowEdit=1`;
}

function updateLivePreview() {
  const res = getPreviewResolution();
  if (!res) return;
  const { tw, th, preset } = res;

  // Size the CONTAINER to the correct aspect ratio, fitting the available width —
  // the iframe just fills it at 100%. display.html's own applyPreviewScale()
  // (now resolution-aware via ?previewResolution=) handles ALL the internal
  // letterboxing/font-scaling/rotation itself — reusing the same, already-correct
  // mechanism the wall display uses for its own phone-preview link, rather than a
  // second, competing implementation (which is what caused portrait previews to
  // render landscape-shaped: two different scaling systems disagreeing about
  // which resolution was authoritative).
  const container = $('preview-scale-container');
  const availWidth = container.parentElement.clientWidth;
  const boxW = availWidth;
  const boxH = Math.round(availWidth * (th / tw));
  container.style.width = boxW + 'px';
  container.style.height = boxH + 'px';

  const iframe = $('preview-iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.transform = 'none';

  $('preview-res-note').textContent = preset === 'reported' && reportedRes
    ? `Showing this device's own reported resolution (${reportedRes.w}×${reportedRes.h}) — for a different screen, pick a preset or Custom above.`
    : `Real size is ${tw}×${th} — scaled to fit here, full-size in a new tab.`;

  // Only reload the iframe src when something that actually changes the render
  // (display/orientation/resolution) changed, not on every resize tick.
  const targetSrc = buildPreviewUrl(tw, th);
  // The iframe's own src gets an extra &embedded=1 that the "open in a new
  // tab" link below deliberately does NOT get — see EMBEDDED_THUMBNAIL's
  // own comment in display.html for why this needs to be a distinct signal
  // from allowEdit=1, which both URLs still correctly share.
  const iframeSrc = targetSrc + '&embedded=1';
  if (iframe.dataset.src !== iframeSrc) {
    iframe.dataset.src = iframeSrc;
    iframe.src = iframeSrc;
  }
  // Keep the "open in a new tab" link pointed at the same display/orientation/resolution.
  const openBtn = $('preview-open-tab-btn');
  if (openBtn) openBtn.href = targetSrc;
}
// Registered exactly once, ever — reads the top-level previewOn directly, and
// updateLivePreview() itself no-ops safely if the Layout tab (and its preview
// DOM) isn't currently on screen.
window.addEventListener('resize', () => { if (previewOn) updateLivePreview(); });

// Which display profile is currently being edited in the Layout tab. Persisted in
// localStorage purely as a UX convenience (reopen the app, land back on the same
// display you were last editing) — not used for anything server-side.
let cachedDisplays = null;
let currentDisplaySlug = localStorage.getItem('lastEditedDisplay') || null;

async function getDisplaysList(forceRefresh = false) {
  if (!cachedDisplays || forceRefresh) {
    cachedDisplays = await apiFetch('/api/displays');
    if (!Array.isArray(cachedDisplays)) cachedDisplays = [];
  }
  return cachedDisplays;
}

// Which profile slugs are actually showing on a screen right now — an
// "active" layout, specifically one on an "active" (online) device, not
// just assigned-but-possibly-unplugged. Shared by both the Editor and
// Profiles sub-tabs' "active only" filters, so the fallback-to-first-profile
// logic (a screen with no explicit assignment is really showing the FIRST
// profile, same as the server's own resolveDisplay()) only has to be gotten
// right in one place.
async function getActiveDisplaySlugs(displays) {
  let screens = [];
  try { screens = await apiFetch('/api/screens'); } catch { screens = []; }
  if (!Array.isArray(screens)) screens = [];
  const activeSlugs = new Set();
  screens.filter(s => s.online).forEach(s => {
    const slug = s.assigned_display_slug || (displays[0] && displays[0].slug);
    if (slug) activeSlugs.add(slug);
  });
  return activeSlugs;
}

function nextId() { return 'w' + (idCounter++); }
function snap(v) { return snapEnabled ? Math.round(v / GRID) * GRID : Math.round(v * 10) / 10; }
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

let layoutSubTab = 'editor'; // 'editor' | 'profiles' | 'templates' | 'saved'
async function renderLayoutTab() {
  $('content').innerHTML = `
    <div class="subtab-bar">
      <button class="subtab-btn${layoutSubTab==='editor'?' active':''}" data-subtab="editor">Editor</button>
      <button class="subtab-btn${layoutSubTab==='profiles'?' active':''}" data-subtab="profiles">Profiles</button>
      <button class="subtab-btn${layoutSubTab==='templates'?' active':''}" data-subtab="templates">Templates</button>
      <button class="subtab-btn${layoutSubTab==='saved'?' active':''}" data-subtab="saved">Saved Layouts</button>
    </div>
    <div id="layout-subtab-content"></div>
  `;
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (layoutSubTab === btn.dataset.subtab) return;
      layoutSubTab = btn.dataset.subtab;
      await renderLayoutTab();
      // Same reasoning as the Calendar tab's sub-tab fix — the content area's
      // scroll position carries over from whatever it was on the previous
      // sub-tab, so reset it after the new content is actually in place.
      const contentEl = $('content');
      if (contentEl) contentEl.scrollTop = 0;
    });
  });
  if (layoutSubTab === 'editor') await renderLayoutEditorSubTab();
  else if (layoutSubTab === 'profiles') await renderLayoutProfilesSubTab();
  else if (layoutSubTab === 'templates') await renderLayoutTemplatesSubTab();
  else if (layoutSubTab === 'saved') await renderLayoutSavedSubTab();
}

async function renderLayoutEditorSubTab() {
  const displays = await getDisplaysList();
  // Validate the remembered display still exists; otherwise fall back to the first one
  if (!currentDisplaySlug || !displays.some(d => d.slug === currentDisplaySlug)) {
    currentDisplaySlug = displays[0] ? displays[0].slug : null;
  }
  if (currentDisplaySlug) localStorage.setItem('lastEditedDisplay', currentDisplaySlug);

  // Derived fresh every time this loads — never a sticky toggle that
  // outlives the visit. Default is active-only; the one standing exception
  // is that whatever's currently selected always stays visible even if
  // it's inactive, so picking an inactive layout from the "Show all" list
  // (below) doesn't hide it again the moment it becomes the selection.
  // Cached at module scope so the "Show all" option in the dropdown can
  // expand the option list instantly (no data reload, no full re-render —
  // see its own handler below) rather than by calling this function again.
  const activeSlugs = await getActiveDisplaySlugs(displays);
  _editorAllDisplays = displays;
  const visibleDisplays = displays.filter(d => activeSlugs.has(d.slug) || d.slug === currentDisplaySlug);
  const inactiveCount = displays.length - visibleDisplays.length;
  _editorVisibleDisplays = visibleDisplays;
  _editorInactiveCount = inactiveCount;

  // Cache whether the built-in To-Do widget is enabled, so the Add Widget
  // picker can filter it in/out — it's opt-in (Settings tab), not always shown.
  try {
    const s = await apiFetch('/api/settings');
    window._todoEnabled = s.todo_enabled === '1';
    window._shoppingEnabled = s.shopping_enabled === '1';
    window._messageboardEnabled = s.messageboard_enabled === '1';
    window._mealplanEnabled = s.mealplan_enabled === '1';
    window._flightmapEnabled = s.flightmap_enabled === '1';
  } catch { window._todoEnabled = window._todoEnabled || false; }

  // Load current display+orientation's layout
  const r = await apiFetch(`/api/layouts/${layoutOrientation}${currentDisplaySlug ? '?display=' + encodeURIComponent(currentDisplaySlug) : ''}`);
  layoutWidgets = r.widgets ? r.widgets.map(w => ({...w})) : [];
  selectedId = null;
  layoutHistory = []; // fresh editing session — nothing to undo yet
  _autoSaveEnabled = false;      // suppress auto-save during the initial render
  drawEditor(displays, visibleDisplays, inactiveCount);
  // Enable real-time auto-save now that the tab is fully drawn. A tiny delay ensures
  // the initial rebuildCanvas() during drawEditor doesn't trigger a spurious write.
  setTimeout(() => { _autoSaveEnabled = true; }, 0);
}

// Full list from the Editor sub-tab's last real load, so the custom
// "Editing Layout" dropdown's "Show all" row can expand the visible
// options in place (see openLayoutDisplayMenu/its handlers below) without
// re-fetching or reloading the currently-edited layout.
let _editorAllDisplays = [];

// Custom dropdown for "Editing Layout" — deliberately NOT a native <select>.
// A native select always closes the instant an option is picked (OS-level
// behavior, not something CSS/JS can override), which meant "Show all"
// could only ever widen the list for the NEXT time someone reopened it —
// exactly the "click it, it closes, click it again to see more" complaint
// this replaces. This version is just a button + an absolutely-positioned
// list this code fully controls, so "Show all" can append more rows to
// the SAME still-open list instead.
// Bug fix: this menu (and its "Show all" expanded list in particular, since
// that's what actually grows tall enough to need scrolling) had no
// touch-action set anywhere — reported as "scrolling on the text works,
// but a blank area to the right doesn't register as a scroll and instead
// triggers the page's pull-to-refresh." Without an explicit touch-action,
// a touch's vertical drag can get treated ambiguously by the browser
// depending on exactly what's under the touch point, and on WebKit,
// unclaimed vertical drags on a scrollable container can fall through to
// native pull-to-refresh instead of scrolling that container. touch-action:
// pan-y here (on the container and each button, for the same reason
// .swipe-card elsewhere in this file already has it) tells the browser
// unambiguously, before any JS even runs, that a vertical drag anywhere on
// this menu is always a scroll — never something else to arbitrate.
function renderLayoutDisplayMenuItems(list, showAllRow) {
  const menu = $('layout-display-menu');
  if (!menu) return;
  const itemsHtml = list.map(d => `
    <button type="button" class="layout-display-item" data-slug="${d.slug}"
      style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;font-size:14px;cursor:pointer;touch-action:pan-y;
        background:${d.slug===currentDisplaySlug?'var(--accent)':'transparent'};color:${d.slug===currentDisplaySlug?'#fff':'var(--text)'}">
      ${escapeHtml(d.name)}
    </button>`).join('');
  const showAllHtml = showAllRow ? `
    <button type="button" id="layout-display-showall"
      style="display:block;width:100%;text-align:left;padding:10px 14px;background:transparent;border:none;border-top:1px solid var(--border);color:var(--accent);font-size:12.5px;font-weight:600;cursor:pointer;touch-action:pan-y">
      — Show all (${_editorInactiveCount} not on an active device) —
    </button>` : '';
  menu.innerHTML = itemsHtml + showAllHtml;
  menu.querySelectorAll('.layout-display-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      closeLayoutDisplayMenu();
      currentDisplaySlug = btn.dataset.slug;
      try { localStorage.setItem('lastEditedDisplay', currentDisplaySlug); } catch {}
      await renderLayoutEditorSubTab();
    });
  });
  if ($('layout-display-showall')) {
    $('layout-display-showall').addEventListener('click', (e) => {
      // Critical: stop this from bubbling to the document-level
      // outside-click listener below. Without this, the real bug was here
      // — renderLayoutDisplayMenuItems() below replaces menu.innerHTML,
      // which detaches THIS button (the actual click target) from the
      // document. The click event keeps bubbling regardless (its
      // propagation path was fixed at dispatch), and by the time it
      // reaches the document listener, wrap.contains(e.target) sees a
      // now-detached node and returns false — indistinguishable from a
      // genuine outside click — so the menu got closed again immediately
      // after this handler had just expanded it. Net effect: looked like
      // clicking "Show all" did nothing at all.
      e.stopPropagation();
      // The one thing this whole rebuild is for: expand to the full list
      // WITHOUT closing the menu or reloading anything. currentDisplaySlug
      // is unchanged, so nothing about the editing session is disturbed.
      renderLayoutDisplayMenuItems(_editorAllDisplays, false);
    });
  }
}
function openLayoutDisplayMenu() {
  renderLayoutDisplayMenuItems(_editorVisibleDisplays, _editorInactiveCount > 0);
  $('layout-display-menu').style.display = 'block';
}
function closeLayoutDisplayMenu() {
  const menu = $('layout-display-menu');
  if (menu) menu.style.display = 'none';
}
// Bound once at script load (not per-render) — closes the menu on any
// click outside it. Safe to run even when the Editor sub-tab isn't
// currently showing: the wrap element simply won't exist, and this no-ops.
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('layout-display-wrap');
  if (wrap && !wrap.contains(e.target)) closeLayoutDisplayMenu();
});
let _editorVisibleDisplays = []; // this render's active-plus-selected set, read by openLayoutDisplayMenu above
let _editorInactiveCount = 0;

function drawEditor(displays, visibleDisplays, inactiveCount) {
  visibleDisplays = visibleDisplays || displays;
  inactiveCount = inactiveCount || 0;
  const isLandscape = layoutOrientation === 'landscape';
  const currentDisplay = displays.find(d => d.slug === currentDisplaySlug);
  $('layout-subtab-content').innerHTML = `
    <div class="settings-row" style="margin-bottom:10px">
      <label>Editing Layout</label>
      <div id="layout-display-wrap" style="position:relative">
        <button type="button" class="form-input" id="layout-display-btn" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;text-align:left">
          <span id="layout-display-btn-label">${currentDisplay ? escapeHtml(currentDisplay.name) : 'Select…'}</span>
          <span style="opacity:.6;margin-left:8px">▾</span>
        </button>
        <div id="layout-display-menu" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--card);border:1px solid var(--border);border-radius:10px;max-height:280px;overflow-y:auto;touch-action:pan-y;overscroll-behavior-y:contain;z-index:1001;box-shadow:0 8px 24px rgba(0,0,0,.35)"></div>
      </div>
    </div>

    <div class="layout-actions layout-actions-compact layout-actions-sticky">
      <button class="btn btn-primary" id="layout-save-btn">Save Layout</button>
      <button class="btn" style="background:var(--card);border:1px solid var(--border)" id="layout-save-preset-btn">Save as Preset…</button>
      <button class="btn" style="background:var(--card);border:1px solid var(--border)" id="layout-copy-from-btn">Copy From…</button>
      <button class="btn" style="background:var(--card);border:1px solid var(--border);color:var(--muted)" id="layout-reset-btn">Reset</button>
    </div>

    <div class="layout-toolbar">
      <button class="layout-orient-btn${isLandscape?' active':''}" id="lo-land">⬜ Landscape</button>
      <button class="layout-orient-btn${!isLandscape?' active':''}" id="lo-port">🔲 Portrait</button>
      <button class="snap-toggle${snapEnabled?' on':''}" id="snap-btn">${snapEnabled?'Snap ✓':'Snap ○'}</button>
      <button class="snap-toggle" id="layout-undo-btn" title="Undo last change" disabled>↶ Undo</button>
      <button class="snap-toggle" id="live-preview-btn" title="See the real, live-rendered display at true proportions instead of the editing boxes — open in a new tab to actually edit it">✏️ Live Edit</button>
    </div>

    <div class="canvas-wrap ${layoutOrientation}" id="editor-canvas"></div>

    <div id="live-preview-wrap" style="display:none;margin-bottom:14px">
      <div class="settings-row" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
        <div style="flex:1;min-width:140px">
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Screen Resolution</label>
          <select class="form-input" id="preview-res-preset">
            <option value="reported">Use this screen's reported size</option>
            <option value="1920x1080">1920 × 1080 (Full HD)</option>
            <option value="3840x2160">3840 × 2160 (4K)</option>
            <option value="1280x800">1280 × 800</option>
            <option value="1080x1920">1080 × 1920 (Portrait HD)</option>
            <option value="800x1280">800 × 1280 (Portrait)</option>
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div id="preview-res-custom-row" style="display:none;gap:8px;align-items:center">
          <input type="number" class="form-input" id="preview-res-w" placeholder="Width" style="width:90px" min="200" max="7680">
          <span style="color:var(--muted)">×</span>
          <input type="number" class="form-input" id="preview-res-h" placeholder="Height" style="width:90px" min="200" max="4320">
        </div>
        <a id="preview-open-tab-btn" href="#" target="_blank" rel="noopener" class="btn"
           style="background:var(--card);border:1px solid var(--border);white-space:nowrap;text-decoration:none;display:flex;align-items:center;padding:0 14px;height:44px">
          ↗ Open to Edit in New Tab
        </a>
      </div>
      <p id="preview-res-note" style="font-size:11px;color:var(--muted);margin:0 0 10px"></p>
      <p style="font-size:11px;color:var(--muted);margin:0 0 10px">This embedded view is a small, glance-only thumbnail — use "Open to Edit in New Tab" for a full-page version where you can actually tap and drag widgets, same as Live Editing directly on the wall display.</p>
      <div id="preview-scale-container" style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#000">
        <iframe id="preview-iframe" style="border:none;display:block;pointer-events:none"></iframe>
      </div>
    </div>

    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;text-align:center">Tap to select · Tap again to reach a widget underneath · Drag to move · Drag corner to resize</div>

    <div id="widget-settings-panel"></div>

    <div class="section-header">Widgets on this display</div>
    <div id="widget-layer-list" class="layer-list"></div>

    <div class="section-header">Add Widget</div>
    <div class="widget-cats">
      ${WIDGET_CATEGORIES.filter(c => c.id !== 'smarthome' || typeof profileAllows !== 'function' || profileAllows('ha')).map(c=>{ const visibleTypes = c.types.filter(t => (t !== 'todo' || window._todoEnabled) && (t !== 'shoppinglist' || window._shoppingEnabled) && (t !== 'messageboard' || window._messageboardEnabled) && (t !== 'mealplan' || window._mealplanEnabled) && (t !== 'flightmap' || window._flightmapEnabled)); return `
        <div class="widget-cat" data-cat="${c.id}">
          <button class="cat-head" data-cat-toggle="${c.id}">
            <span class="cat-ic">${c.icon}</span>
            <span class="cat-label">${c.label}</span>
            <span class="cat-count">${visibleTypes.length}</span>
            <span class="cat-caret">▸</span>
          </button>
          <div class="cat-body" data-cat-body="${c.id}" style="display:none">
            ${visibleTypes.map(t=>{ const d=widgetDefByType(t); return d?`
              <div class="palette-item" data-type="${d.type}">
                <div class="p-icon">${d.icon}</div>${d.label}
              </div>`:''; }).join('')}
          </div>
        </div>`;}).join('')}
    </div>
  `;

  // Draw widgets onto canvas
  rebuildCanvas();
  renderLayerList();
  updateUndoButton();

  // Widget category accordion — tap a category to reveal its widgets; opening one
  // closes the others.
  document.querySelectorAll('[data-cat-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.catToggle;
      openWidgetCategory = (openWidgetCategory === id) ? null : id;
      document.querySelectorAll('.widget-cat').forEach(cat => {
        const body = cat.querySelector('[data-cat-body]');
        const caret = cat.querySelector('.cat-caret');
        const isOpen = cat.dataset.cat === openWidgetCategory;
        body.style.display = isOpen ? 'grid' : 'none';
        cat.classList.toggle('open', isOpen);
        if (caret) caret.textContent = isOpen ? '▾' : '▸';
      });
    });
  });

  // Undo button
  $('layout-undo-btn').addEventListener('click', undoLayout);

  // Display selector — a custom dropdown (see renderLayoutDisplayMenuItems
  // and friends above); this just wires the trigger button to open it.
  $('layout-display-btn').addEventListener('click', (e) => {
    e.stopPropagation(); // don't let the document-level outside-click listener immediately re-close what this just opened
    const menu = $('layout-display-menu');
    if (menu.style.display === 'none') openLayoutDisplayMenu();
    else closeLayoutDisplayMenu();
  });

  // Orientation buttons
  $('lo-land').addEventListener('click', async () => {
    layoutOrientation = 'landscape';
    localStorage.setItem('lastEditedOrientation', layoutOrientation);
    await renderLayoutEditorSubTab();
  });
  $('lo-port').addEventListener('click', async () => {
    layoutOrientation = 'portrait';
    localStorage.setItem('lastEditedOrientation', layoutOrientation);
    await renderLayoutEditorSubTab();
  });

  // Snap toggle
  $('snap-btn').addEventListener('click', () => {
    snapEnabled = !snapEnabled;
    $('snap-btn').textContent = snapEnabled ? 'Snap ✓' : 'Snap ○';
    $('snap-btn').classList.toggle('on', snapEnabled);
  });

  // ── Live Edit panel ── shows the ACTUAL rendered display (real widgets, real
  // data, real fonts) shrunk to fit, instead of the abstract editing boxes —
  // for checking how something really looks without walking over to the TV.
  // previewOn/reportedRes are top-level state (declared once, above) — reset the
  // toggle here since this freshly-drawn HTML always starts with preview closed.
  previewOn = false;
  $('live-preview-btn').addEventListener('click', async () => {
    previewOn = !previewOn;
    $('live-preview-btn').classList.toggle('on', previewOn);
    $('editor-canvas').style.display = previewOn ? 'none' : '';
    $('live-preview-wrap').style.display = previewOn ? 'block' : 'none';
    if (previewOn) {
      if (!reportedRes) {
        try {
          const cfg = await apiFetch('/api/screen-config');
          reportedRes = cfg.displayRes || null;
        } catch {}
        const presetSel = $('preview-res-preset');
        if (!reportedRes) {
          // Nothing reported yet — fall back to a normal preset instead of an
          // option that would have nothing to show.
          presetSel.value = '1920x1080';
          presetSel.querySelector('option[value="reported"]').disabled = true;
        }
      }
      updateLivePreview();
    } else {
      // Actually destroy the iframe's document, not just hide it — otherwise
      // every interval/connection it started (weather/stocks/news polling, etc.)
      // keeps running in the background indefinitely, since a hidden iframe is
      // still a live document as far as the browser's concerned.
      const iframe = $('preview-iframe');
      iframe.src = 'about:blank';
      delete iframe.dataset.src;
    }
  });

  $('preview-res-preset').addEventListener('change', () => {
    $('preview-res-custom-row').style.display = $('preview-res-preset').value === 'custom' ? 'flex' : 'none';
    updateLivePreview();
  });
  $('preview-res-w').addEventListener('input', updateLivePreview);
  $('preview-res-h').addEventListener('input', updateLivePreview);

  // Palette — add widget
  document.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('click', () => {
      const def = WIDGET_DEFS.find(d => d.type === item.dataset.type);
      const newWidget = { id: nextId(), type: def.type, x: 10, y: 10, w: 30, h: 20 };
      if (def.type === 'minical') {
        newWidget.w = 60; newWidget.h = 50; newWidget.calView = 'month';
      }
      if (def.type === 'datetime') {
        newWidget.w = 34; newWidget.h = 30; newWidget.dtStyle = 'classic'; newWidget.dtFontPx = 70;
        newWidget.dtShowSeconds = true; newWidget.dtShowDate = true; newWidget.dtShowTemp = true;
      }
      if (def.type === 'reminders') {
        newWidget.w = 30; newWidget.h = 20; newWidget.remStyle = 'banner'; newWidget.remFontPx = 22;
      }
      if (def.type === 'messageboard') {
        newWidget.w = 34; newWidget.h = 26; newWidget.mbFontPx = 14;
      }
      if (def.type === 'mealplan') {
        newWidget.w = 30; newWidget.h = 34; newWidget.mpDays = 7; newWidget.mpFontPx = 15;
      }
      if (def.type === 'camera') {
        newWidget.w = 44; newWidget.h = 32; newWidget.camFit = 'contain'; newWidget.camShowTitle = true;
      }
      if (def.type === 'flightmap') {
        newWidget.w = 46; newWidget.h = 38; newWidget.fmSubject = 'filter'; newWidget.fmFilter = { mil: true };
        newWidget.fmFollow = false; newWidget.fmTrailMin = 30; newWidget.fmShowData = true; newWidget.fmLabels = true; newWidget.fmFontPx = 13;
      }
      if (def.type === 'tasks') {
        newWidget.w = 30; newWidget.h = 40; newWidget.projectId = null; newWidget.projectName = 'Tasks';
      }
      if (def.type === 'news') {
        newWidget.w = 32; newWidget.h = 45;
      }
      if (def.type === 'stocks') {
        newWidget.w = 28; newWidget.h = 30; newWidget.stockTickers = [];
      }
      if (def.type === 'weatherCurrent') {
        newWidget.w = 24; newWidget.h = 22; newWidget.wxForecastDays = 0;
      }
      if (def.type === 'weatherForecast') {
        newWidget.w = 40; newWidget.h = 18; newWidget.wxForecastDays = 5;
      }
      if (def.type === 'weatherHourly') {
        newWidget.w = 42; newWidget.h = 20; newWidget.wxHourlyStyle = 'hourly'; newWidget.wxHours = 6;
      }
      if (def.type === 'weatherComboForecast') {
        newWidget.w = 42; newWidget.h = 36; newWidget.wxComboStyle = 'stacked';
      }
      if (def.type === 'chorechart') {
        newWidget.w = 50; newWidget.h = 45; newWidget.choreTitle = 'Daily Chore Chart'; newWidget.choreShowDone = true; newWidget.choreShowBonus = false; newWidget.choreFontPx = 15;
      }
      if (def.type === 'countdown') {
        newWidget.w = 24; newWidget.h = 22; newWidget.cdTitle = 'Countdown'; newWidget.cdFontPx = 22; newWidget.cdRepeatYearly = false;
      }
      if (def.type === 'moonphase') {
        newWidget.w = 22; newWidget.h = 22; newWidget.mpFontPx = 20; newWidget.mpShowIllum = true; newWidget.mpShowAge = false;
      }
      if (def.type === 'airquality') {
        newWidget.w = 26; newWidget.h = 32; newWidget.aqFontPx = 18; newWidget.aqShowUV = true; newWidget.aqShowPollen = true;
      }
      if (def.type === 'radar') {
        newWidget.w = 30; newWidget.h = 30; newWidget.radarTitle = 'Radar'; newWidget.radarFontPx = 16;
        newWidget.radarLat = ''; newWidget.radarLon = ''; newWidget.radarZoom = 6;
        newWidget.radarAnimate = false; newWidget.radarFrameCount = 6; newWidget.radarOpacity = 80; newWidget.radarShowTime = true;
      }
      if (def.type === 'webpage') {
        newWidget.w = 30; newWidget.h = 40; newWidget.wpUrl = ''; newWidget.wpTitle = ''; newWidget.wpRefreshMin = 0; newWidget.wpFontPx = 14;
      }
      if (def.type === 'qrcode') {
        newWidget.w = 20; newWidget.h = 24; newWidget.qrPreset = 'text'; newWidget.qrContent = ''; newWidget.qrTitle = ''; newWidget.qrFontPx = 14;
      }
      if (def.type === 'timer') {
        newWidget.w = 22; newWidget.h = 18; newWidget.timerTitle = 'Timer'; newWidget.timerMinutes = 5; newWidget.timerFontPx = 32;
      }
      if (def.type === 'layoutswitcher') {
        newWidget.w = 30; newWidget.h = 12; newWidget.switcherTargets = []; newWidget.switcherSchedule = []; newWidget.switcherFontPx = 15;
      }
      if (def.type === 'onthisday') {
        newWidget.w = 30; newWidget.h = 40; newWidget.otdFontPx = 15; newWidget.otdMaxItems = 4;
      }
      if (def.type === 'dailyquote') {
        newWidget.w = 32; newWidget.h = 20; newWidget.dqFontPx = 20;
      }
      if (def.type === 'sports') {
        newWidget.w = 24; newWidget.h = 32; newWidget.spFontPx = 16;
      }
      if (def.type === 'metar') {
        newWidget.w = 26; newWidget.h = 34; newWidget.wxIcao = ''; newWidget.wxShowTaf = true; newWidget.wxFontPx = 16;
      }
      if (def.type === 'agenda') {
        newWidget.w = 32; newWidget.h = 55; newWidget.agDays = 7;
      }
      if (def.type === 'tasksCombined') {
        newWidget.w = 32; newWidget.h = 55; newWidget.projectIds = []; newWidget.projectNames = {};
      }
      if (def.type === 'text') {
        newWidget.w = 30; newWidget.h = 12;
        newWidget.textContent = 'Your text';
        newWidget.textPreset = 'plain'; newWidget.textFontPx = 28; newWidget.textWeight = 'normal'; newWidget.textAlign = 'left'; newWidget.textFontFamily = 'Inter';
      }
      if (def.type === 'decoration') {
        newWidget.w = 14; newWidget.h = 14;
        newWidget.decorEmoji = '🌿'; newWidget.decorFontPx = 60; newWidget.decorOpacity = 100; newWidget.decorRotation = 0;
      }
      if (def.type === 'entitystatus') {
        newWidget.w = 20; newWidget.h = 16;
        newWidget.haEntityId = ''; newWidget.haLabel = ''; newWidget.haLabelAutoFor = ''; newWidget.haFontPx = 20; newWidget.haShowUnit = true; newWidget.haShowSparkline = true;
      }
      if (def.type === 'smarthomeDashboard') {
        newWidget.w = 40; newWidget.h = 40;
        newWidget.haEntityIds = []; newWidget.haAreaIds = []; newWidget.haComboGroups = []; newWidget.haDashTitle = ''; newWidget.haDashFontPx = 16; newWidget.haGroupByRoom = true; newWidget.haDashView = 'grid';
      }
      if (def.type === 'groupcontrol') {
        newWidget.w = 20; newWidget.h = 16;
        newWidget.gcTitle = ''; newWidget.gcEntityIds = []; newWidget.gcAreaIds = []; newWidget.gcFontPx = 20;
      }
      snapshotLayout();
      layoutWidgets.push(newWidget);
      selectedId = newWidget.id;
      rebuildCanvas();
      renderLayerList();
      drawWidgetSettingsPanel();
      // After adding, collapse the category list so the canvas/settings are visible.
      showToast(`${def.label} added`);
    });
  });

  // Save (manual button still works, but edits also auto-save in real time below).
  $('layout-save-btn').addEventListener('click', async () => {
    await persistLayoutNow();
    showToast(`Layout saved ✓${currentDisplay ? ' (' + currentDisplay.name + ')' : ''}`);
  });

  // Save as a reusable preset (Layout Library). Snapshots BOTH orientations + the
  // display's theme. We persist the current working orientation first so the
  // snapshot reflects unsaved edits the user is looking at right now.
  $('layout-save-preset-btn').addEventListener('click', async () => {
    const name = prompt('Save this layout as a preset named:', currentDisplay ? currentDisplay.name + ' copy' : 'My layout');
    if (name === null) return;
    if (!name.trim()) { showToast('Enter a name'); return; }
    const displayParam = currentDisplaySlug ? '?display=' + encodeURIComponent(currentDisplaySlug) : '';
    // Persist current edits first so the preset captures what's on screen
    await apiFetch(`/api/layouts/${layoutOrientation}${displayParam}`, {
      method: 'PUT', body: JSON.stringify({ widgets: layoutWidgets })
    });
    const r = await apiFetch('/api/saved-layouts', {
      method: 'POST', body: JSON.stringify({ name: name.trim(), display: currentDisplaySlug || undefined }),
    });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    showToast(`Preset "${name.trim()}" saved ✓`);
  });

  // Reset to defaults
  $('layout-reset-btn').addEventListener('click', async () => {
    if (!confirm('Reset to default layout?')) return;
    const defaults = layoutOrientation === 'landscape' ? [
      {id:nextId(),type:'clock',x:2,y:2,w:30,h:9},
      {id:nextId(),type:'date',x:2,y:11,w:30,h:5},
      {id:nextId(),type:'weather',x:66,y:2,w:32,h:14},
      {id:nextId(),type:'minical',x:2,y:18,w:96,h:80,calView:'month'},
    ] : [
      {id:nextId(),type:'clock',x:2,y:1,w:55,h:8},
      {id:nextId(),type:'weather',x:59,y:1,w:39,h:8},
      {id:nextId(),type:'date',x:2,y:10,w:96,h:4},
      {id:nextId(),type:'minical',x:2,y:15,w:96,h:83,calView:'month'},
    ];
    layoutWidgets = defaults;
    selectedId = null;
    drawWidgetSettingsPanel();
    rebuildCanvas();
    showToast('Reset to defaults');
  });

  $('layout-copy-from-btn').addEventListener('click', openCopyWidgetsModal);
}

// ── Copy from Another Layout ──────────────────────────────────────────────
// Wired ONCE here, NOT inside drawEditor() — confirmed real bug, and the
// actual explanation for a second report ("asks to replace 5 times, then
// nothing shows up at all"): copy-widgets-overlay and its buttons live
// OUTSIDE the dynamically-replaced layout-subtab-content div (same overlay
// pattern as modal-overlay/feedback-popup-overlay elsewhere in this file),
// so unlike layout-copy-from-btn itself — which IS recreated fresh every
// time drawEditor() runs, since it's part of that div's innerHTML — these
// elements are static and never get recreated. Wiring them from inside
// drawEditor() (which reruns every time the Editor sub-tab loads OR the
// edited display/orientation changes) stacked a brand new duplicate
// listener onto the SAME persistent DOM nodes each time, with nothing ever
// removing the previous ones. A single click then fired the handler once
// per accumulated listener — the confirm() dialog appearing 5 times, and,
// far more seriously, up to 5 overlapping PUT-then-sync-back requests
// racing each other, which is almost certainly what actually corrupted the
// layout down to nothing: the beta.6 fix's syncDataOnly() deliberately
// doesn't take the periodic sync's own _syncing lock (see its own comment),
// so several of these firing back to back was exactly the "rare overlap"
// scenario that comment flagged as unlikely — not rare at all once one
// click could trigger five real save+sync cycles. Fixed at the actual
// source: this modal's wiring — open trigger aside, which stays inside
// drawEditor() since layout-copy-from-btn itself IS safely re-wirable —
// now only ever runs the one time this script parses, same pattern as
// wireFeedbackPopup() elsewhere in this file.
//
// Pulls specific widgets from a DIFFERENT (display, orientation) pair's live
// layout into the one currently being edited — same widgets, same x/y/w/h,
// same every setting, just a fresh id each (nextId()) so they don't collide
// with anything already here. Deliberately NOT a rescale/reposition: the
// request was for an exact copy, so if the source is a different
// orientation than what's being edited now, the percentages just carry
// over as-is and may not land anywhere sensible — cw-orientation-warning
// below says so up front rather than silently producing a surprising result.
function openCopyWidgetsModal() {
  const sel = $('cw-source-display');
  sel.innerHTML = _editorAllDisplays.map(d => `<option value="${d.slug}"${d.slug === currentDisplaySlug ? ' selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
  $('cw-orient-land').classList.add('active');
  $('cw-orient-port').classList.remove('active');
  $('cw-orientation-warning').style.display = 'none';
  $('cw-widget-list').innerHTML = '';
  $('cw-copy-btn').style.display = 'none';
  $('copy-widgets-overlay').classList.add('open');
}
(function wireCopyWidgetsModal() {
  $('cw-close-btn').addEventListener('click', () => $('copy-widgets-overlay').classList.remove('open'));
  $('copy-widgets-overlay').addEventListener('click', (e) => { if (e.target.id === 'copy-widgets-overlay') $('copy-widgets-overlay').classList.remove('open'); });
  $('cw-orient-land').addEventListener('click', () => { $('cw-orient-land').classList.add('active'); $('cw-orient-port').classList.remove('active'); $('cw-widget-list').innerHTML = ''; $('cw-copy-btn').style.display = 'none'; });
  $('cw-orient-port').addEventListener('click', () => { $('cw-orient-port').classList.add('active'); $('cw-orient-land').classList.remove('active'); $('cw-widget-list').innerHTML = ''; $('cw-copy-btn').style.display = 'none'; });

  let _copySourceWidgets = null; // the loaded source layout's widgets, keyed to what's currently checked below
  $('cw-load-btn').addEventListener('click', async () => {
    const sourceSlug = $('cw-source-display').value;
    const sourceOrientation = $('cw-orient-land').classList.contains('active') ? 'landscape' : 'portrait';
    const list = $('cw-widget-list');
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">Loading…</div>`;
    $('cw-copy-btn').style.display = 'none';
    let r;
    try {
      r = await apiFetch(`/api/layouts/${sourceOrientation}?display=${encodeURIComponent(sourceSlug)}`);
    } catch { r = null; }
    if (!r || r.error || !Array.isArray(r.widgets) || !r.widgets.length) {
      list.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">${r && r.error ? escapeHtml(r.error) : 'That layout has no widgets to copy.'}</div>`;
      _copySourceWidgets = null;
      return;
    }
    _copySourceWidgets = r.widgets;
    $('cw-orientation-warning').style.display = (sourceOrientation !== layoutOrientation) ? '' : 'none';
    const defByType = {}; WIDGET_DEFS.forEach(d => { defByType[d.type] = d; });
    list.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
        <button type="button" id="cw-select-all" style="background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;padding:4px">Select All / None</button>
      </div>
      ${r.widgets.map((w, i) => {
        const def = defByType[w.type];
        const label = def ? def.label : w.type;
        const icon = def ? def.icon : '❔';
        return `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border)">
          <input type="checkbox" class="cw-widget-check" data-i="${i}" checked style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
          <span>${icon}</span>
          <span style="font-size:13px;color:var(--text)">${escapeHtml(label)}</span>
        </label>`;
      }).join('')}
    `;
    $('cw-select-all').addEventListener('click', () => {
      const boxes = list.querySelectorAll('.cw-widget-check');
      const allChecked = [...boxes].every(b => b.checked);
      boxes.forEach(b => { b.checked = !allChecked; });
    });
    $('cw-copy-btn').style.display = 'block';
  });

  $('cw-copy-btn').addEventListener('click', async () => {
    if (!_copySourceWidgets) return;
    const checked = [...document.querySelectorAll('.cw-widget-check:checked')].map(b => parseInt(b.dataset.i, 10));
    if (!checked.length) { showToast('Select at least one widget'); return; }
    // Replaces, not appends — whatever's currently in this layout is
    // deleted first, same as Reset already does. Confirm before wiping it,
    // for the same reason Reset does too.
    if (!confirm(`Replace this layout? The ${layoutWidgets.length} widget${layoutWidgets.length === 1 ? '' : 's'} currently here will be deleted and replaced with the ${checked.length} you selected.`)) return;
    // Same widgets, same locations, same settings — an exact copy of
    // everything except the id (has to be fresh so it doesn't collide with
    // anything from a PREVIOUS copy still in history/undo) and `locked`
    // (deliberately dropped, one specific exception to "exact copy"):
    // confirmed real bug — a widget locked in its SOURCE layout carried
    // that lock into the destination too, since noDragResize in
    // makeEditorWidget() just reads w.locked directly, with no awareness
    // this widget just arrived via a copy. Locking exists to protect a
    // widget from accidental drag/resize IN THE PLACE IT WAS DELIBERATELY
    // positioned — carrying that into a brand new layout, where
    // repositioning to fit is usually the very next thing someone needs to
    // do, defeats the point of copying in the first place rather than
    // protecting anything.
    const newWidgets = checked.map(i => _copySourceWidgets[i]).filter(Boolean).map(src => {
      const copy = { ...src, id: nextId() };
      delete copy.locked;
      return copy;
    });
    // Saved explicitly and awaited here, rather than trusting the normal
    // debounced auto-save (rebuildCanvas() -> autoSaveLayout(), 500ms
    // later, fire-and-forget). Root cause of a real reported bug: a
    // rejected save silently reverted layoutWidgets in the background with
    // nothing connecting that outcome back to the success toast, which
    // fired unconditionally regardless of whether the save actually
    // succeeded.
    snapshotLayout();
    const btn = $('cw-copy-btn');
    btn.disabled = true;
    btn.textContent = 'Replacing…';
    const displayParam = currentDisplaySlug ? '?display=' + encodeURIComponent(currentDisplaySlug) : '';
    const r = await apiFetch(`/api/layouts/${layoutOrientation}${displayParam}`, {
      method: 'PUT', body: JSON.stringify({ widgets: newWidgets })
    });
    btn.disabled = false;
    btn.textContent = 'Copy & Replace';
    if (!r || !r.ok) {
      // Checking for explicit success (r.ok) rather than just "no .error
      // present" — apiFetch() never throws, but a genuine network failure
      // or an auth hiccup comes back as a sentinel object (__networkError/
      // __authFailed/__parseError) that also has no .error property. That
      // shape would have silently fallen through to the success path
      // below otherwise — the exact same class of bug this whole change
      // exists to fix, just from a different trigger.
      const reason = (r && r.error) ? r.error
        : (r && r.__networkError) ? 'Could not reach the server.'
        : (r && r.__authFailed) ? 'Session expired — sign back in and try again.'
        : 'Unknown error.';
      showToast('❌ ' + reason);
      return; // modal stays open, current layoutWidgets untouched — nothing was actually replaced
    }
    layoutWidgets = newWidgets;
    $('copy-widgets-overlay').classList.remove('open');
    rebuildCanvas();
    renderLayerList();
    drawWidgetSettingsPanel();
    // syncWarning: present on a multi-device (host/slave) setup when the
    // write reached the host fine but THIS device — a slave/mirror — hasn't
    // caught up locally yet. The save is real either way (the host has it),
    // but reading it back from this specific device right now, including
    // on the physical display it drives, may still show the pre-edit
    // layout until that catches up. Worth saying plainly rather than a
    // plain "✓" that doesn't match what's still on screen a moment later.
    if (r.syncWarning) {
      showToast(`⚠️ Saved, but this device hasn't synced yet — it may take a moment to show up.`);
    } else {
      showToast(`${checked.length} widget${checked.length === 1 ? '' : 's'} copied ✓`);
    }
  });
})();

// ── Manage Reminders ────────────────────────────────────────────────────────
// Same top-level-overlay-wired-once pattern as Copy Widgets just above —
// see that modal's own history for why this matters: wiring a persistent
// overlay's internals from inside a per-render settings function (like
// typeSpecificHtml's own Reminders block) stacks a duplicate listener onto
// the same never-recreated DOM nodes every time that function reruns. Only
// the OPEN trigger lives inside the widget's own settings HTML, since that
// button genuinely is recreated fresh each time.
// Which Mini Calendar settings accordion section is open — survives the full
// panel redraws that several controls trigger (Layout, Color Coding, Wrap
// Event Text, Show Reminders, Show Stickers, and the three Today Indicator
// color controls — they gate other rows' visibility, so a full redraw is
// genuinely needed for those), so opening a section and then touching one
// of those controls doesn't snap the whole accordion shut on the very next
// render. Defaults to nothing open (null) — reset back to that whenever a
// different widget gets selected — see drawWidgetSettingsPanel()'s own
// widget-switch handling for where that reset happens.
let _calSettingsOpenSection = null; // null = nothing open by default
let _calSettingsOpenSectionForWidgetId = null;
let _manageRemindersEditingId = null; // null = "add new"; a reminder's id = editing that one
// Tracks the uploaded (but not-yet-saved) icon image filename for the form
// currently open — set on upload, read at Save time, reset whenever the
// form is (re)opened. Needs its own variable rather than just reading the
// DOM at save time because there's no input element holding this value:
// the actual <img> preview shows it, but the filename itself only exists
// server-side once uploaded.
let _mrPendingIconImage = null;
let _mrCachedReminders = []; // populated by renderManageRemindersListView(); the edit form looks the record back up here rather than a second fetch
// Which container the list/form views render into — 'mr-body' (the modal,
// opened from a Reminders widget's own settings) by default, or
// 'family-reminders-body' (the new inline Family Hub tab) when entered that
// way instead. Same underlying CRUD logic either way — see
// renderRemindersFamilyTab() below for why this exists: reminders are
// household-shared data, not something that should only be reachable
// through a specific widget's settings, so Family Hub needed its own entry
// point into the exact same add/edit/delete flow rather than a second,
// duplicated implementation of it.
let _mrBodyId = 'mr-body';
function openManageRemindersModal() {
  _manageRemindersEditingId = null;
  _mrBodyId = 'mr-body';
  renderManageRemindersListView();
  $('manage-reminders-overlay').classList.add('open');
}
// Same rendering logic as reminderIconHtml() in display.html — this app-side
// copy exists because the reminders management list (below) is the one
// place in app.html that displays a saved reminder's icon outside the edit
// form itself (which reads/writes the raw fields directly, not through
// this). Kept in sync deliberately, not shared as a single file, matching
// how this codebase already keeps app.html and display.html as two
// separate copies rather than a shared module.
// Human-readable description of a reminder's recurrence, for the management
// list. Covers all four frequency types plus the universal end condition —
// used instead of the inline version this replaced, which only ever
// understood the original weekly/interval pair.
function reminderScheduleSummary(r) {
  const cfg = r.schedule_config || {};
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const nthLabel = (n) => n === -1 ? 'last' : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
  let base = '';
  if (r.schedule_type === 'weekly') {
    const days = (cfg.daysOfWeek || []).map(d => dayNames[d]).join(', ');
    const every = (cfg.weekInterval || 1) > 1 ? `Every ${cfg.weekInterval} weeks` : 'Weekly';
    base = days ? `${every} — ${days}` : `${every} — no days set`;
  } else if (r.schedule_type === 'interval') {
    base = `Every ${cfg.intervalDays || '?'} days`;
  } else if (r.schedule_type === 'monthly') {
    const every = (cfg.monthInterval || 1) > 1 ? `Every ${cfg.monthInterval} months` : 'Monthly';
    base = cfg.monthlyMode === 'nthWeekday'
      ? `${every} on the ${nthLabel(cfg.nthWeek)} ${dayNames[cfg.nthWeekday]}`
      : `${every} on day ${cfg.dayOfMonth || '?'}`;
  } else if (r.schedule_type === 'yearly') {
    const every = (cfg.yearInterval || 1) > 1 ? `Every ${cfg.yearInterval} years` : 'Yearly';
    const month = monthNames[(cfg.yearlyMonth || 1) - 1];
    base = cfg.yearlyMode === 'nthWeekday'
      ? `${every} on the ${nthLabel(cfg.yearlyNthWeek)} ${dayNames[cfg.yearlyNthWeekday]} of ${month}`
      : `${every} on ${month} ${cfg.yearlyDay || '?'}`;
  }
  if (cfg.endType === 'onDate' && cfg.endDate) base += `, until ${cfg.endDate}`;
  else if (cfg.endType === 'afterCount' && cfg.endCount) base += `, ${cfg.endCount}×`;
  return base;
}
function reminderIconHtml(r) {
  if (!r) return '';
  const type = r.icon_type || 'emoji';
  if (type === 'image' && r.icon_image) {
    return `<img style="width:1em;height:1em;object-fit:contain;vertical-align:middle;border-radius:0.15em" src="/uploads/${encodeURIComponent(r.icon_image)}" alt="">`;
  }
  if (type === 'text' && r.icon) {
    const len = r.icon.length;
    const scale = len <= 3 ? 1 : len <= 6 ? 0.62 : len <= 9 ? 0.46 : 0.36;
    return `<span style="font-weight:800;letter-spacing:0.02em;font-size:${scale}em">${escapeHtml(r.icon)}</span>`;
  }
  return escapeHtml(r.icon || '📌');
}
async function renderManageRemindersListView() {
  if ($('mr-modal-title')) $('mr-modal-title').textContent = 'Manage Reminders';
  const body = $(_mrBodyId);
  body.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">Loading…</div>`;
  let reminders = [];
  try { reminders = await apiFetch('/api/reminders') || []; } catch { reminders = []; }
  _mrCachedReminders = reminders; // cached so the edit form (opened by id) can look the record back up without a second fetch
  const scheduleLabel = (r) => reminderScheduleSummary(r);
  body.innerHTML = `
    <button class="btn btn-primary" id="mr-add-btn" type="button" style="width:100%;margin-bottom:14px">+ Add Reminder</button>
    ${reminders.length ? reminders.map(r => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--border)">
        <div style="font-size:22px;flex-shrink:0">${reminderIconHtml(r)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:600;color:var(--text)">${escapeHtml(r.name)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${escapeHtml(scheduleLabel(r))}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="mr-edit-btn" data-id="${r.id}" style="width:32px;height:32px;border-radius:8px;border:none;background:var(--card);color:var(--text);font-size:14px">✏️</button>
          <button class="mr-delete-btn" data-id="${r.id}" style="width:32px;height:32px;border-radius:8px;border:none;background:rgba(227,92,92,0.15);color:#e35c5c;font-size:14px">🗑️</button>
        </div>
      </div>
    `).join('') : `<p style="color:var(--muted);font-size:13.5px;text-align:center;margin-top:24px">No reminders yet — add one to get started.</p>`}
  `;
  $('mr-add-btn').addEventListener('click', () => renderManageRemindersFormView(null));
  body.querySelectorAll('.mr-edit-btn').forEach(btn => btn.addEventListener('click', () => renderManageRemindersFormView(btn.dataset.id)));
  body.querySelectorAll('.mr-delete-btn').forEach(btn => btn.addEventListener('click', () => deleteReminderFromModal(btn.dataset.id, reminders)));
}
async function deleteReminderFromModal(id, reminders) {
  const r = reminders.find(x => String(x.id) === String(id));
  if (!confirm(`Delete "${r ? r.name : 'this reminder'}"? This removes it everywhere it's shown, including the calendar.`)) return;
  try {
    await apiFetch(`/api/reminders/${id}`, { method: 'DELETE' });
    showToast('Reminder deleted');
    renderManageRemindersListView();
  } catch { showToast('❌ Could not delete — try again'); }
}
// Small <option> list builders shared by the Monthly/Yearly recurrence UI
// below — kept as plain functions rather than inlined repeatedly since
// nth-week and weekday options are needed in two places each (Monthly's
// nthWeekday mode, Yearly's nthWeekday mode).
function nthWeekOptions(selected) {
  const opts = [[1,'First'],[2,'Second'],[3,'Third'],[4,'Fourth'],[-1,'Last']];
  return opts.map(([v,l]) => `<option value="${v}" ${String(selected)===String(v)?'selected':''}>${l}</option>`).join('');
}
function weekdayOptions(dayNames, selected) {
  const full = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return full.map((l, i) => `<option value="${i}" ${String(selected)===String(i)?'selected':''}>${l}</option>`).join('');
}
function monthOptions(selected) {
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names.map((l, i) => `<option value="${i+1}" ${String(selected)===String(i+1)?'selected':''}>${l}</option>`).join('');
}
function renderManageRemindersFormView(id) {
  _manageRemindersEditingId = id;
  const existing = id ? _mrCachedReminders.find(x => String(x.id) === String(id)) : null;
  _mrPendingIconImage = existing && existing.icon_type === 'image' ? (existing.icon_image || null) : null;
  if ($('mr-modal-title')) $('mr-modal-title').textContent = existing ? 'Edit Reminder' : 'Add Reminder';
  const cfg = (existing && existing.schedule_config) || {};
  const scheduleType = (existing && existing.schedule_type) || 'weekly';
  const selectedDays = new Set(scheduleType === 'weekly' ? (cfg.daysOfWeek || []) : []);
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  $(_mrBodyId).innerHTML = `
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" type="text" id="mr-f-name" value="${existing ? escapeHtml(existing.name) : ''}" placeholder="e.g. Trash, Recycling, Water plants" maxlength="40">
    </div>
    <div class="form-group">
      <label class="form-label">Icon</label>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        ${[['emoji','Emoji'],['text','Text'],['image','Image']].map(([val, label]) => `
          <button type="button" class="mr-icontype-btn${(existing ? (existing.icon_type || 'emoji') : 'emoji') === val ? ' active' : ''}" data-icontype="${val}"
            style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);
              background:${(existing ? (existing.icon_type || 'emoji') : 'emoji') === val ? 'rgba(74,144,217,0.3)' : 'var(--card)'};
              color:${(existing ? (existing.icon_type || 'emoji') : 'emoji') === val ? '#fff' : 'var(--muted)'};font-size:12px;font-weight:700">${label}</button>
        `).join('')}
      </div>
      <div id="mr-f-icon-emoji-row" style="${(existing ? (existing.icon_type||'emoji') : 'emoji') !== 'emoji' ? 'display:none' : ''}">
        <input class="form-input" type="text" id="mr-f-icon" value="${existing && existing.icon ? existing.icon : '📌'}" maxlength="4" style="width:70px;text-align:center;font-size:20px">
      </div>
      <div id="mr-f-icon-text-row" style="${(existing ? existing.icon_type : '') !== 'text' ? 'display:none' : ''}">
        <input class="form-input" type="text" id="mr-f-icon-text" value="${existing && existing.icon_type === 'text' ? escapeHtml(existing.icon || '') : ''}" maxlength="12" placeholder="e.g. Trash">
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Short label — long text will shrink to fit wherever it's shown, but stays most readable around 4-6 characters.</div>
      </div>
      <div id="mr-f-icon-image-row" style="${(existing ? existing.icon_type : '') !== 'image' ? 'display:none' : ''}">
        <input type="file" id="mr-f-icon-file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
        <div style="display:flex;align-items:center;gap:10px">
          <div id="mr-f-icon-preview" style="width:44px;height:44px;border-radius:8px;border:1px solid var(--border);background:var(--card) center/contain no-repeat;background-image:${existing && existing.icon_type === 'image' && existing.icon_image ? `url('/uploads/${escapeHtml(existing.icon_image)}')` : 'none'}"></div>
          <button type="button" class="btn" id="mr-f-icon-upload-btn" style="background:var(--card);border:1px solid var(--border)">${existing && existing.icon_type === 'image' && existing.icon_image ? 'Replace image' : 'Choose image'}</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Shown small everywhere a reminder icon appears — a simple, high-contrast image works best.</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Repeats</label>
      <select class="form-input" id="mr-f-type">
        <option value="weekly" ${scheduleType==='weekly'?'selected':''}>Weekly</option>
        <option value="interval" ${scheduleType==='interval'?'selected':''}>Daily</option>
        <option value="monthly" ${scheduleType==='monthly'?'selected':''}>Monthly</option>
        <option value="yearly" ${scheduleType==='yearly'?'selected':''}>Yearly</option>
      </select>
    </div>
    <div class="form-group" id="mr-f-weekly-row" style="${scheduleType!=='weekly'?'display:none':''}">
      <label class="form-label">Every</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="form-input" type="number" id="mr-f-week-interval" min="1" max="52" value="${cfg.weekInterval || 1}" style="width:70px">
        <span style="color:var(--muted);font-size:13px">week(s), on:</span>
      </div>
      <div style="display:flex;gap:5px;margin-top:10px">
        ${dayNames.map((d, i) => `<button type="button" class="mr-dow-btn${selectedDays.has(i)?' active':''}" data-dow="${i}" style="flex:1;padding:9px 0;border-radius:8px;border:1px solid var(--border);background:${selectedDays.has(i)?'rgba(74,144,217,0.3)':'var(--card)'};color:${selectedDays.has(i)?'#fff':'var(--muted)'};font-size:12px;font-weight:700">${d}</button>`).join('')}
      </div>
    </div>
    <div class="form-group" id="mr-f-interval-row" style="${scheduleType!=='interval'?'display:none':''}">
      <label class="form-label">Repeat every (days)</label>
      <input class="form-input" type="number" id="mr-f-interval-days" min="1" max="365" value="${cfg.intervalDays || 14}">
    </div>
    <div class="form-group" id="mr-f-monthly-row" style="${scheduleType!=='monthly'?'display:none':''}">
      <label class="form-label">Every</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="form-input" type="number" id="mr-f-month-interval" min="1" max="24" value="${cfg.monthInterval || 1}" style="width:70px">
        <span style="color:var(--muted);font-size:13px">month(s)</span>
      </div>
      <select class="form-input" id="mr-f-monthly-mode" style="margin-top:10px">
        <option value="dayOfMonth" ${(cfg.monthlyMode||'dayOfMonth')==='dayOfMonth'?'selected':''}>On a specific day of the month</option>
        <option value="nthWeekday" ${cfg.monthlyMode==='nthWeekday'?'selected':''}>On the nth weekday</option>
      </select>
      <div id="mr-f-monthly-dayofmonth-row" style="margin-top:10px;${cfg.monthlyMode==='nthWeekday'?'display:none':''}">
        <label class="form-label">Day of month</label>
        <input class="form-input" type="number" id="mr-f-day-of-month" min="1" max="31" value="${cfg.dayOfMonth || 1}">
      </div>
      <div id="mr-f-monthly-nthweekday-row" style="margin-top:10px;display:flex;gap:8px;${cfg.monthlyMode!=='nthWeekday'?'display:none':''}">
        <select class="form-input" id="mr-f-nth-week" style="flex:1">${nthWeekOptions(cfg.nthWeek)}</select>
        <select class="form-input" id="mr-f-nth-weekday" style="flex:1">${weekdayOptions(dayNames, cfg.nthWeekday)}</select>
      </div>
    </div>
    <div class="form-group" id="mr-f-yearly-row" style="${scheduleType!=='yearly'?'display:none':''}">
      <label class="form-label">Every</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="form-input" type="number" id="mr-f-year-interval" min="1" max="20" value="${cfg.yearInterval || 1}" style="width:70px">
        <span style="color:var(--muted);font-size:13px">year(s), in:</span>
      </div>
      <select class="form-input" id="mr-f-yearly-month" style="margin-top:10px">${monthOptions(cfg.yearlyMonth)}</select>
      <select class="form-input" id="mr-f-yearly-mode" style="margin-top:10px">
        <option value="date" ${(cfg.yearlyMode||'date')==='date'?'selected':''}>On a specific date</option>
        <option value="nthWeekday" ${cfg.yearlyMode==='nthWeekday'?'selected':''}>On the nth weekday</option>
      </select>
      <div id="mr-f-yearly-date-row" style="margin-top:10px;${cfg.yearlyMode==='nthWeekday'?'display:none':''}">
        <label class="form-label">Day</label>
        <input class="form-input" type="number" id="mr-f-yearly-day" min="1" max="31" value="${cfg.yearlyDay || 1}">
      </div>
      <div id="mr-f-yearly-nthweekday-row" style="margin-top:10px;display:flex;gap:8px;${cfg.yearlyMode!=='nthWeekday'?'display:none':''}">
        <select class="form-input" id="mr-f-yearly-nth-week" style="flex:1">${nthWeekOptions(cfg.yearlyNthWeek)}</select>
        <select class="form-input" id="mr-f-yearly-nth-weekday" style="flex:1">${weekdayOptions(dayNames, cfg.yearlyNthWeekday)}</select>
      </div>
    </div>
    <div class="form-group" id="mr-f-startdate-row">
      <label class="form-label">Starts</label>
      <input class="form-input" type="date" id="mr-f-start-date" value="${cfg.startDate || todayIso}">
    </div>
    <div class="form-group">
      <label class="form-label">Ends</label>
      <select class="form-input" id="mr-f-end-type">
        <option value="never" ${(cfg.endType||'never')==='never'?'selected':''}>Never</option>
        <option value="onDate" ${cfg.endType==='onDate'?'selected':''}>On a date</option>
        <option value="afterCount" ${cfg.endType==='afterCount'?'selected':''}>After a number of times</option>
      </select>
      <div id="mr-f-end-date-row" style="margin-top:10px;${cfg.endType!=='onDate'?'display:none':''}">
        <input class="form-input" type="date" id="mr-f-end-date" value="${cfg.endDate || ''}">
      </div>
      <div id="mr-f-end-count-row" style="margin-top:10px;${cfg.endType!=='afterCount'?'display:none':''}">
        <input class="form-input" type="number" id="mr-f-end-count" min="1" max="999" value="${cfg.endCount || 10}">
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:20px">
      <button class="btn" id="mr-f-cancel" type="button" style="flex:1;background:var(--card);border:1px solid var(--border)">Cancel</button>
      <button class="btn btn-primary" id="mr-f-save" type="button" style="flex:1">Save</button>
    </div>
  `;
  $('mr-f-type').addEventListener('change', (e) => {
    $('mr-f-weekly-row').style.display = e.target.value === 'weekly' ? '' : 'none';
    $('mr-f-interval-row').style.display = e.target.value === 'interval' ? '' : 'none';
    $('mr-f-monthly-row').style.display = e.target.value === 'monthly' ? '' : 'none';
    $('mr-f-yearly-row').style.display = e.target.value === 'yearly' ? '' : 'none';
  });
  if ($('mr-f-monthly-mode')) {
    $('mr-f-monthly-mode').addEventListener('change', (e) => {
      $('mr-f-monthly-dayofmonth-row').style.display = e.target.value === 'dayOfMonth' ? '' : 'none';
      $('mr-f-monthly-nthweekday-row').style.display = e.target.value === 'nthWeekday' ? '' : 'none';
    });
  }
  if ($('mr-f-yearly-mode')) {
    $('mr-f-yearly-mode').addEventListener('change', (e) => {
      $('mr-f-yearly-date-row').style.display = e.target.value === 'date' ? '' : 'none';
      $('mr-f-yearly-nthweekday-row').style.display = e.target.value === 'nthWeekday' ? '' : 'none';
    });
  }
  $('mr-f-end-type').addEventListener('change', (e) => {
    $('mr-f-end-date-row').style.display = e.target.value === 'onDate' ? '' : 'none';
    $('mr-f-end-count-row').style.display = e.target.value === 'afterCount' ? '' : 'none';
  });
  document.querySelectorAll('.mr-dow-btn').forEach(btn => btn.addEventListener('click', () => {
    const nowActive = !btn.classList.contains('active');
    btn.classList.toggle('active', nowActive);
    btn.style.background = nowActive ? 'rgba(74,144,217,0.3)' : 'var(--card)';
    btn.style.color = nowActive ? '#fff' : 'var(--muted)';
  }));
  document.querySelectorAll('.mr-icontype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mr-icontype-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.3)' : 'var(--card)';
        b.style.color = active ? '#fff' : 'var(--muted)';
      });
      $('mr-f-icon-emoji-row').style.display = btn.dataset.icontype === 'emoji' ? '' : 'none';
      $('mr-f-icon-text-row').style.display = btn.dataset.icontype === 'text' ? '' : 'none';
      $('mr-f-icon-image-row').style.display = btn.dataset.icontype === 'image' ? '' : 'none';
    });
  });
  $('mr-f-icon-upload-btn').addEventListener('click', () => $('mr-f-icon-file').click());
  $('mr-f-icon-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    showToast('Uploading…');
    try {
      // See /api/photos' upload handler above — same "plain fetch() never
      // sends the session token" bug.
      const data = await apiFetch('/api/reminders/icon-image', { method: 'POST', body: fd });
      if (data.error) { showToast('Upload failed: ' + data.error); return; }
      _mrPendingIconImage = data.filename;
      $('mr-f-icon-preview').style.backgroundImage = `url('/uploads/${data.filename}')`;
      $('mr-f-icon-upload-btn').textContent = 'Replace image';
      showToast('Image uploaded ✓');
    } catch { showToast('❌ Upload failed — try again'); }
  });
  $('mr-f-cancel').addEventListener('click', renderManageRemindersListView);
  $('mr-f-save').addEventListener('click', saveReminderFromModal);
}

