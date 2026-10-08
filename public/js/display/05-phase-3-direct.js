// ── Phase 3: direct-editing mode ─────────────────────────────────────────────
// Tap anywhere on the display (outside anything already handling its own tap,
// like a chore checkbox) to briefly reveal a small edit icon in the corner;
// tap that to enter edit mode, where every widget becomes draggable right on
// the actual rendered display — the real wall screen, or any tablet loading
// this same URL. Dropping a widget saves through the exact same
// PUT /api/layouts/:orientation endpoint the app's own Layout editor already
// uses, so the change is indistinguishable server-side from having been made
// there — including the same 'layout' broadcast that already propagates it
// live everywhere else (the app's editor if open, other screens on the same
// profile, etc.). Excluded from a plain preview (IS_PREVIEW) by default:
// that throwaway snapshot already has its own dedicated editor in the app,
// and letting a preview iframe write back to the real layout would be a
// strange, unexpected side effect of just looking at one — UNLESS the
// preview explicitly opts in via ?allowEdit=1 (ALLOW_EDIT_IN_PREVIEW), the
// one deliberate exception: the Layout tab's own Live Edit panel, which
// wants exactly this.
// ── Mini calendar: swipe/tap navigation ────────────────────────────────
// Same "interact directly wherever this is shown" spirit as the chore chart
// and to-do widgets above, but purely a LOCAL viewing change rather than a
// data mutation — nothing here is saved anywhere. Auto-resets back to the
// current window (month/week range/agenda window/strip range, depending on
// the widget's layout & view) after a period of no further navigation so the
// display doesn't end up permanently stuck showing some other time range
// days after someone briefly checked what's coming up. Originally month-grid
// only; extended to grid week views, Agenda, and Strip layouts too — same
// mechanism (arrows, swipe, auto-reset), each view just interprets the
// integer offset in its own natural unit (months for month view; whole
// window-widths — weeks/agenda days/strip days — for everything else).
let miniCalOffsets = {};
let _miniCalResetTimers = {};
const MINICAL_AUTO_RESET_MS = 90 * 1000;
function navigateMiniCal(widgetId, delta) {
  if (delta === 0) { delete miniCalOffsets[widgetId]; } // "Today" — jump straight back
  else { miniCalOffsets[widgetId] = (miniCalOffsets[widgetId] || 0) + delta; }
  renderLayout();
  clearTimeout(_miniCalResetTimers[widgetId]);
  _miniCalResetTimers[widgetId] = setTimeout(() => {
    if (miniCalOffsets[widgetId]) { delete miniCalOffsets[widgetId]; renderLayout(); }
  }, MINICAL_AUTO_RESET_MS);
}
// Shared nav-arrows/Today-button markup, reused by month view, week views,
// Agenda, and Strip alike — same shape as month view's original inline
// version, just factored out so all four views render identical, already-
// tested-feeling controls instead of four hand-copied variants.
function miniCalNavHtml(widgetId, offset, labelHtml, navLabel) {
  if (widgetId == null) return labelHtml;
  const prevLabel = navLabel ? `Previous ${navLabel}` : 'Previous';
  const nextLabel = navLabel ? `Next ${navLabel}` : 'Next';
  return `<button class="mc-nav-btn mc-nav-prev" data-widget-id="${widgetId}" data-interactive="1" aria-label="${prevLabel}">‹</button>`
    + labelHtml
    + `<button class="mc-nav-btn mc-nav-next" data-widget-id="${widgetId}" data-interactive="1" aria-label="${nextLabel}">›</button>`
    + (offset !== 0 ? `<button class="mc-nav-today" data-widget-id="${widgetId}" data-interactive="1">Today</button>` : '');
}
function wireMiniCalNav() {
  document.querySelectorAll('.mc-nav-prev[data-widget-id]').forEach(el => {
    if (el._navWired) return; el._navWired = true;
    el.addEventListener('click', (e) => { e.stopPropagation(); navigateMiniCal(el.dataset.widgetId, -1); });
  });
  document.querySelectorAll('.mc-nav-next[data-widget-id]').forEach(el => {
    if (el._navWired) return; el._navWired = true;
    el.addEventListener('click', (e) => { e.stopPropagation(); navigateMiniCal(el.dataset.widgetId, 1); });
  });
  document.querySelectorAll('.mc-nav-today[data-widget-id]').forEach(el => {
    if (el._navWired) return; el._navWired = true;
    el.addEventListener('click', (e) => { e.stopPropagation(); navigateMiniCal(el.dataset.widgetId, 0); });
  });
  // Swipe gesture across the calendar body itself — a real horizontal drag,
  // not just any tap, so it doesn't fight with tapping a day cell for
  // whatever a future date-tap interaction might do there. Covers all four
  // navigable views: grid (month + week), Agenda, and Strip all render one
  // of these three container classes with data-widget-id when navigable.
  document.querySelectorAll('.w-minical[data-widget-id], .w-minical-agenda[data-widget-id], .w-minical-strip[data-widget-id]').forEach(el => {
    if (el._swipeWired) return; el._swipeWired = true;
    let startX = null, startY = null, pointerId = null;
    el.addEventListener('pointerdown', (e) => {
      startX = e.clientX; startY = e.clientY; pointerId = e.pointerId;
    });
    el.addEventListener('pointerup', (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      pointerId = null;
      // Deliberately generous horizontal-vs-vertical ratio and a real
      // minimum distance — a light tap or an imprecise finger drag
      // shouldn't accidentally flip the window.
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        navigateMiniCal(el.dataset.widgetId, dx < 0 ? 1 : -1); // swipe left -> next, right -> previous
      }
    });
  });
  wireEventAddSheet();
  wireCalCellLongPress();
}
let editModeActive = false;
let _editModeExitedAt = 0; // see exitEditMode()'s own comment and checkSchedules()'s grace-period check
let _editIconHideTimer = null;
let _backLinkHideTimer = null;
let _flsHideTimer = null; // see toggleQuickAccessReveal()'s own comment for the floating switcher's optional tap-to-reveal
let _kioskExitHideTimer = null; // Windows kiosk "Exit full-screen" button — same reveal cluster (KIOSK_EXIT)
let _editModeHaPollTimer = null;
let _editModeEventsPollTimer = null;
function wireDirectEditMode() {
  // Was `IS_PREVIEW && !ALLOW_EDIT_IN_PREVIEW` — the intent was always "skip
  // this specifically in the embedded thumbnail," but ALLOW_EDIT_IN_PREVIEW
  // being incorrectly true there too (see EMBEDDED_THUMBNAIL's own comment)
  // meant this condition could never actually be true for that context.
  // EMBEDDED_THUMBNAIL is the precise, dedicated signal for it now.
  if (EMBEDDED_THUMBNAIL) return;
  if (document.body._editModeWired) return; // wire the tap-to-reveal listener exactly once, ever
  document.body._editModeWired = true;
  document.body.addEventListener('pointerdown', (e) => {
    if (editModeActive) {
      // Phase 4: tapping empty canvas (not a widget, its resize handles, or
      // the settings panel) deselects whatever's currently selected.
      if (!e.target.closest('.widget, #widget-edit-panel, #edit-selection-overlay, #widget-picker-overlay, #widget-place-banner, #widget-advanced-panel, #screen-settings-overlay')) deselectWidgetForEdit();
      return; // dragging takes over once active, see wireWidgetDragging()
    }
    if (e.target.closest('[data-interactive], #edit-mode-trigger, #edit-mode-bar')) return;
    toggleQuickAccessReveal();
  });
  document.getElementById('edit-mode-trigger').addEventListener('click', enterEditMode);
  document.getElementById('edit-mode-done').addEventListener('click', exitEditMode);
  document.getElementById('edit-mode-add-btn').addEventListener('click', openWidgetPicker);
  document.getElementById('edit-mode-collapse-btn').addEventListener('click', () => {
    document.getElementById('edit-mode-bar').classList.toggle('edit-bar-collapsed');
  });
  document.getElementById('edit-mode-screen-settings-btn').addEventListener('click', () => {
    openScreenSettingsPanel();
  });
  document.getElementById('screen-settings-close').addEventListener('click', () => {
    document.getElementById('screen-settings-overlay').style.display = 'none';
  });
  document.getElementById('event-detail-close').addEventListener('click', closeEventDetail);
  { const d = document.getElementById('event-detail-delete'); if (d) d.addEventListener('click', deleteEventFromDetail); }
  { const h = document.getElementById('event-detail-hide'); if (h) h.addEventListener('click', () => hideEventFromDetail('occurrence')); }
  { const h = document.getElementById('event-detail-hide-series'); if (h) h.addEventListener('click', () => hideEventFromDetail('series')); }
  document.getElementById('event-detail-overlay').addEventListener('click', (e) => {
    // Only the backdrop itself dismisses — a tap on the card (or anything
    // inside it) shouldn't close the modal out from under someone reading it.
    if (e.target.id === 'event-detail-overlay') closeEventDetail();
  });
  document.getElementById('widget-place-cancel').addEventListener('click', cancelPlacementMode);
  wireCanvasPlacementTap();
}
// Tap-to-reveal for the Live Editing pencil icon, the "Back to App" link
// (only relevant in the "Open to Edit in New Tab" context), and the
// floating switcher's OPTIONAL tap-to-reveal mode (floating_switcher_reveal
// === 'tap') — all three share one tap gesture and one timer, toggled
// together rather than independently. A tap while they're ALREADY visible
// dismisses them immediately instead of extending the timer further — a
// deliberate choice: someone who taps again clearly wants them gone now,
// not a longer wait for the same 4 seconds to pass. Checks the pencil
// icon's own current state to decide which way to toggle, since it's the
// one element of the three always present regardless of context.
function toggleQuickAccessReveal() {
  const btn = document.getElementById('edit-mode-trigger');
  if (btn && btn.classList.contains('shown')) {
    hideQuickAccessReveal();
    return;
  }
  if (btn) {
    btn.classList.add('shown');
    clearTimeout(_editIconHideTimer);
    _editIconHideTimer = setTimeout(() => btn.classList.remove('shown'), 4000);
  }
  // Same tap-to-reveal treatment as the pencil icon above, not a
  // persistent fixture — this link only ever exists at all (display:block)
  // in the "Open to Edit in New Tab" context to begin with (see its own
  // enabling code near ALLOW_EDIT_IN_PREVIEW), so this is a harmless no-op
  // everywhere else without needing its own separate context check here.
  const backLink = document.getElementById('back-to-app-link');
  if (backLink) {
    backLink.classList.add('shown');
    clearTimeout(_backLinkHideTimer);
    _backLinkHideTimer = setTimeout(() => backLink.classList.remove('shown'), 4000);
  }
  // Optional tap-to-reveal for the floating switcher itself (see the
  // floating_switcher_reveal schema comment) — only meaningful when the
  // fls-reveal-tap class is present (renderFloatingSwitcher() adds it only
  // when this mode's actually selected), so this is a harmless no-op the
  // rest of the time rather than needing its own separate check here.
  const fls = document.getElementById('floating-switcher');
  if (fls && fls.classList.contains('fls-reveal-tap')) {
    fls.classList.add('shown');
    clearTimeout(_flsHideTimer);
    _flsHideTimer = setTimeout(() => fls.classList.remove('shown'), 4000);
  }
  // Windows full-screen kiosk exit button — only made display:block at boot
  // when KIOSK_EXIT is set (?kiosk=1), a harmless no-op otherwise.
  const kioskExit = document.getElementById('kiosk-exit-btn');
  if (kioskExit && kioskExit.style.display !== 'none') {
    kioskExit.classList.add('shown');
    clearTimeout(_kioskExitHideTimer);
    _kioskExitHideTimer = setTimeout(() => kioskExit.classList.remove('shown'), 4000);
  }
}
// Dismisses all three immediately — called by a deliberate second tap (see
// toggleQuickAccessReveal() above), split out on its own in case anything
// else ever needs to dismiss these without going through the toggle check.
function hideQuickAccessReveal() {
  const btn = document.getElementById('edit-mode-trigger');
  if (btn) { btn.classList.remove('shown'); clearTimeout(_editIconHideTimer); }
  const backLink = document.getElementById('back-to-app-link');
  if (backLink) { backLink.classList.remove('shown'); clearTimeout(_backLinkHideTimer); }
  const fls = document.getElementById('floating-switcher');
  if (fls) { fls.classList.remove('shown'); clearTimeout(_flsHideTimer); }
  const kioskExit = document.getElementById('kiosk-exit-btn');
  if (kioskExit) { kioskExit.classList.remove('shown'); clearTimeout(_kioskExitHideTimer); }
}
function enterEditMode() {
  // This device mirrors a host: its layouts table is wholesale replaced
  // from the host on every sync (applySyncSnapshot()/replaceTable), with
  // no per-field carve-out for anything — including per-widget settings
  // labeled "this display only" (e.g. Per-Feed Opacity overrides), which
  // are stored inside the same widget JSON in that same shared table.
  // Any edit made here would look like it took (the checkbox/slider
  // updates locally, immediately), then silently revert on the next sync
  // pull from the host — as little as ~1.5s later while actively editing,
  // per markHostEditing()'s fast window. That's confusing rather than
  // useful, so block it outright with an explanation instead. Editing from
  // the host itself, or the app pointed at the host, is unaffected by any
  // of this and is the correct way to make changes that reach every slave.
  if (isSlaveDevice) {
    showDisplayToast('✋ This is a mirror display — edit from the host device or the app instead.');
    return;
  }
  editModeActive = true;
  document.body.classList.add('edit-mode-active');
  document.getElementById('edit-mode-trigger').classList.remove('shown');
  const editBar = document.getElementById('edit-mode-bar');
  editBar.classList.toggle('edit-bar-bottom', state.editBarPosition === 'bottom');
  editBar.classList.remove('edit-bar-collapsed');
  editBar.style.display = 'flex';
  wireWidgetDragging();
  // Poll Home Assistant entity state much more frequently while Live Edit
  // is actually open — real report: these are externally-controlled
  // devices (a physical switch, another app, a voice assistant, an
  // automation), so the normal ambient 60s poll (unchanged, still runs the
  // rest of the time — see its own setInterval near boot) is noticeably
  // stale specifically when someone's looking right at a toggle deciding
  // whether it's accurate. fetchHaEntities() itself already no-ops
  // cheaply when the layout has no HA widgets at all, so this costs
  // nothing when Live Edit is opened on a layout without any.
  if (!_editModeHaPollTimer) {
    _editModeHaPollTimer = setInterval(async () => {
      if (_dragState || _resizeState) return; // never re-render mid-drag — it drops the element you're holding
      if (await fetchHaEntities()) renderLayout();
    }, 4_000);
  }
  // Same reasoning, same interval, for calendar events: feed opacity, source
  // filters, and other calendar-widget settings are edited from the app while
  // someone is often standing right at the display watching for it to land.
  // Tiers 2 (per-feed) and 3 (master default) of the opacity system already
  // push an 'events' broadcast over SSE on save, so this is a backstop for a
  // missed/delayed push, not the primary path — same relationship this fast
  // poll already has with HA's own SSE-adjacent update flow above.
  // fetchEvents() is cheap (recent-range query only), so this costs nothing
  // extra beyond one more request every 8s while Live Edit is open.
  if (!_editModeEventsPollTimer) {
    _editModeEventsPollTimer = setInterval(async () => {
      if (_dragState || _resizeState) return; // never re-render mid-drag — it drops the element you're holding
      await fetchEvents();
      renderLayout();
    }, 8_000);
  }
}
function exitEditMode() {
  editModeActive = false;
  // Originally added because a schedule rule that became due WHILE
  // actively editing used to "catch up" and fire on the very next check
  // after editing ended — which meant a rule due during an editing session
  // fired the INSTANT editing ended, with editModeActive already false —
  // silently, since that's exactly the condition switchToLayoutTarget()'s
  // own confirmation dialog requires to show at all. Confirmed as a real,
  // reproducible incident at the time, not a hypothetical: a diagnostic
  // toast directly captured switchToLayoutTarget() firing with
  // editMode=false moments after exiting Live Edit.
  //
  // checkSchedules() no longer catches up at all, by later explicit
  // request (see its own comment) — a rule now only fires on an exact
  // match against the current moment, never late. This grace period still
  // matters for exactly the same reason, just phrased the other way now:
  // without it, a rule whose moment happens to fall in the instant right
  // after editing ends would still fire silently, with no confirmation
  // shown, since editModeActive is already false by then. _editModeExitedAt
  // gives checkSchedules() a brief window where it skips checking entirely
  // right after editing ends — and since nothing catches up anymore, a
  // rule whose moment falls inside that window simply doesn't fire this
  // time, rather than firing late once the window passes.
  _editModeExitedAt = Date.now();
  document.body.classList.remove('edit-mode-active');
  document.getElementById('edit-mode-bar').style.display = 'none';
  deselectWidgetForEdit();
  closeWidgetPicker();
  const ssOverlay = document.getElementById('screen-settings-overlay');
  if (ssOverlay) ssOverlay.style.display = 'none';
  cancelPlacementMode();
  if (_editModeHaPollTimer) { clearInterval(_editModeHaPollTimer); _editModeHaPollTimer = null; }
  if (_editModeEventsPollTimer) { clearInterval(_editModeEventsPollTimer); _editModeEventsPollTimer = null; }
}
function wireWidgetDragging() {
  document.querySelectorAll('#canvas .widget').forEach(el => {
    if (el._dragWired) return; // re-render (SSE, our own save echoing back, etc.) recreates elements — re-wire fresh ones only
    el._dragWired = true;
    el.addEventListener('pointerdown', (e) => {
      // BUG FIXED: this listener is wired once per widget element and never
      // torn down on exitEditMode() (by design — re-wiring per render is
      // cheap to skip via _dragWired, tearing down per mode-exit isn't worth
      // the complexity). startDrag() itself already checked editModeActive
      // and correctly refused to actually start a drag once Live Editing
      // was exited — but selectWidgetForEdit() had no matching guard, so a
      // tap after hitting Done still selected the widget (outline, resize
      // handles, settings panel), even though nothing could actually be
      // dragged. Both need the same guard, not just one of them.
      if (!editModeActive) return;
      // Placement mode (adding a new widget) takes priority over selecting
      // an existing one underneath the tap — without this, tapping on top
      // of an existing widget while placing a new one would select/start
      // dragging the EXISTING widget instead of placing the new one there,
      // since this listener (on the widget itself) fires before the tap
      // ever bubbles up to the canvas-level placement listener.
      if (pendingPlacementType) return;
      // Live Editing: select-and-drag in one gesture, same as app.html's own
      // editor — a tap that never turns into a real move just leaves the
      // widget selected (handles + settings panel shown), which is exactly
      // what tapping-to-select should do anyway.
      selectWidgetForEdit(el.dataset.widgetId);
      // A full-screen-background widget's position is a rendering-time
      // override (see renderLayout()) — dragging it would update its stored
      // x/y with no visible effect at all while the override is active,
      // which would just be confusing. Same restriction app.html's own
      // Editor applies to this field.
      const dw = state.layout.find(x => String(x.id) === String(el.dataset.widgetId));
      if (dw && dw.photoFullscreenBg) return;
      // Position locked — same restriction app.html's own Editor applies
      // (noDragResize = w.locked || fsBg there). Previously this flag was
      // checked nowhere in this file at all, so a locked widget dragged
      // exactly like an unlocked one here, silently ignoring the lock.
      // Selection (above) still happens either way — same as the
      // photoFullscreenBg case right above this one — only the drag itself
      // is blocked.
      if (dw && dw.locked) return;
      startDrag(e, el);
    });
  });
}
let _dragState = null;
let _dragRafPending = false;
function startDrag(e, el) {
  if (!editModeActive) return;
  e.preventDefault();
  // Best-effort: keeps the drag tracking correctly even if the pointer moves
  // outside the widget's own bounds mid-drag, but isn't essential to the
  // core drag logic working, and some pointer sources (or a synthetic event,
  // as opposed to a real touch/mouse interaction) can throw here rather than
  // silently no-op — genuinely fine to just continue without it either way.
  try { el.setPointerCapture(e.pointerId); } catch {}
  _dragState = {
    el, pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    startLeft: parseFloat(el.style.left) || 0,
    startTop: parseFloat(el.style.top) || 0,
    // Latest raw pointer position, updated on every event; the actual DOM
    // writes only happen once per animation frame (see applyDragFrame()),
    // not once per raw pointermove — pointermove can fire far faster than
    // the screen can paint, and writing to the DOM (plus the overlay's own
    // sync) on every single one of those events was the real cause of drag
    // and resize both feeling laggy/behind the finger, not anything about
    // the math being wrong.
    lastX: e.clientX, lastY: e.clientY,
  };
  _dragRafPending = false;
  el.classList.add('dragging');
  el.addEventListener('pointermove', onDragMove);
  el.addEventListener('pointerup', onDragEnd);
  el.addEventListener('pointercancel', onDragEnd);
  // Backstop: if the element-level listeners never fire (element detached
  // mid-drag, capture lost), a window-level release still ends the drag so
  // _dragState can't wedge and freeze every subsequent renderLayout().
  window.addEventListener('pointerup', onDragEnd, { once: true });
  window.addEventListener('pointercancel', onDragEnd, { once: true });
}
function onDragMove(e) {
  if (!_dragState || e.pointerId !== _dragState.pointerId) return;
  _dragState.lastX = e.clientX;
  _dragState.lastY = e.clientY;
  if (_dragRafPending) return;
  _dragRafPending = true;
  requestAnimationFrame(applyDragFrame);
}
function applyDragFrame() {
  _dragRafPending = false;
  if (!_dragState) return; // drag may have ended between the request and this frame running
  const dx = _dragState.lastX - _dragState.startX;
  const dy = _dragState.lastY - _dragState.startY;
  _dragState.el.style.left = (_dragState.startLeft + dx) + 'px';
  _dragState.el.style.top = (_dragState.startTop + dy) + 'px';
  if (String(selectedWidgetId) === String(_dragState.el.dataset.widgetId)) syncEditOverlayToWidget(_dragState.el);
}
async function onDragEnd(e) {
  if (!_dragState || e.pointerId !== _dragState.pointerId) return;
  const { el } = _dragState;
  el.classList.remove('dragging');
  el.removeEventListener('pointermove', onDragMove);
  el.removeEventListener('pointerup', onDragEnd);
  el.removeEventListener('pointercancel', onDragEnd);
  // Apply one final time synchronously with the LAST known pointer position
  // — the pending rAF frame (if any) hasn't necessarily run yet, and once
  // _dragState is cleared below, it would no-op if it ran after.
  applyDragFrame();
  _dragState = null;

  const W = effectiveWidth(), H = effectiveHeight();
  const widgetId = el.dataset.widgetId;
  const w = state.layout.find(x => String(x.id) === String(widgetId));
  if (w) {
    let newX = (parseFloat(el.style.left) / W) * 100;
    let newY = (parseFloat(el.style.top) / H) * 100;
    // Clamp so a drag can't push a widget fully or partially off-canvas.
    newX = Math.max(0, Math.min(100 - w.w, newX));
    newY = Math.max(0, Math.min(100 - w.h, newY));
    w.x = newX; w.y = newY;
    // Snap the visual position to the clamped/final value too, in case the
    // drag went past a boundary — otherwise the widget would visually sit
    // somewhere the saved data doesn't actually match.
    el.style.left = (newX / 100 * W) + 'px';
    el.style.top = (newY / 100 * H) + 'px';
    if (String(selectedWidgetId) === String(widgetId)) syncEditOverlayToWidget(el);
    await saveLayoutNow();
  }
  if (_renderDeferredDuringDrag) { _renderDeferredDuringDrag = false; renderLayout(); }
}

// ── Phase 4: selection, resize, delete, and basic on-device settings ────────
// Extends Phase 3's move-only editing. Resize/delete/settings all write
// through the exact same PUT /api/layouts/:orientation endpoint move already
// used — same as every other direct-editing feature on this page.
// Adding new widget TYPES from the display itself is deliberately out of
// scope for now (deferred, tracked as an open item) — this covers editing
// widgets already on the layout.
let selectedWidgetId = null;

// Which basic settings each widget type exposes here, and under what field
// names — deliberately NOT guessed: pulled directly from app.html's own
// per-type settings panel (the authoritative source for these field names)
// rather than assumed, since a wrong field name here would silently write to
// a key the renderer never reads, exactly the kind of gap the fetchDisplayConfig()
// lesson elsewhere in this file warns about. Types absent from this table
// (weather variants, Tasks, Photo) use a percentage-based or no font concept
// at all and fall back to "more settings in the app" — full parity with the
// app's much larger settings panel is out of scope here.
const WIDGET_BASIC_SETTINGS = {
  clock:         { fontField: 'clockFontPx',    fontDefault: 90, fontMin: 30, fontMax: 400, fontStep: 2 },
  date:          { fontField: 'dateFontPx',     fontDefault: 24, fontMin: 10, fontMax: 200, fontStep: 1 },
  weatherHourly: { fontField: 'wxLocationFontPx', fontDefault: 14, fontMin: 8, fontMax: 100, fontStep: 1 },
  minical:       { fontField: 'calFontPx',      fontDefault: 11, fontMin: 6,  fontMax: 64,  fontStep: 1 },
  upcoming:      { fontField: 'upFontPx',       fontDefault: 14, fontMin: 8,  fontMax: 56,  fontStep: 1 },
  today:         { fontField: 'tdFontPx',       fontDefault: 15, fontMin: 8,  fontMax: 56,  fontStep: 1 },
  agenda:        { fontField: 'agFontPx',       fontDefault: 14, fontMin: 8,  fontMax: 56,  fontStep: 1 },
  tasksCombined: { fontField: 'tcFontPx',       fontDefault: 14, fontMin: 8,  fontMax: 56,  fontStep: 1 },
  news:          { fontField: 'newsFontPx',     fontDefault: 13, fontMin: 8,  fontMax: 48,  fontStep: 1 },
  stocks:        { fontField: 'stockFontPx',    fontDefault: 14, fontMin: 8,  fontMax: 96,  fontStep: 1 },
  todo:          { fontField: 'todoFontPx',     fontDefault: 15, fontMin: 8,  fontMax: 80, fontStep: 1, titleField: 'todoTitle', titlePlaceholder: 'To-Do' },
  shoppinglist:  { fontField: 'shoppingFontPx', fontDefault: 15, fontMin: 8,  fontMax: 80, fontStep: 1, titleField: 'shoppingTitle', titlePlaceholder: 'Shopping List' },
  chorechart:    { fontField: 'choreFontPx',    fontDefault: 15, fontMin: 8,  fontMax: 80, fontStep: 1, titleField: 'choreTitle', titlePlaceholder: 'Daily Chore Chart' },
  chorelb:       { fontField: 'lbFontPx',       fontDefault: 15, fontMin: 8,  fontMax: 80, fontStep: 1, titleField: 'lbTitle', titlePlaceholder: 'Chore Leaderboard' },
  messageboard:  { fontField: 'mbFontPx',       fontDefault: 14, fontMin: 10, fontMax: 40, fontStep: 1 },
  mealplan:      { fontField: 'mpFontPx',       fontDefault: 15, fontMin: 10, fontMax: 36, fontStep: 1 },
  flightmap:     { fontField: 'fmFontPx',       fontDefault: 13, fontMin: 9,  fontMax: 28, fontStep: 1 },
  countdown:     { fontField: 'cdFontPx',       fontDefault: 22, fontMin: 8,  fontMax: 100, fontStep: 1, titleField: 'cdTitle', titlePlaceholder: 'Countdown' },
  moonphase:     { fontField: 'mpFontPx',       fontDefault: 20, fontMin: 8,  fontMax: 80,  fontStep: 1 },
  airquality:    { fontField: 'aqFontPx',       fontDefault: 18, fontMin: 8,  fontMax: 72,  fontStep: 1 },
  radar:         { fontField: 'radarFontPx',    fontDefault: 16, fontMin: 8,  fontMax: 64,  fontStep: 1, titleField: 'radarTitle', titlePlaceholder: 'Radar' },
  travel:        { fontField: 'travelFontPx',   fontDefault: 18, fontMin: 8,  fontMax: 72,  fontStep: 1 },
  qrcode:        { fontField: 'qrFontPx',       fontDefault: 14, fontMin: 8,  fontMax: 56, fontStep: 1, titleField: 'qrTitle', titlePlaceholder: '(none)' },
  timer:         { fontField: 'timerFontPx',    fontDefault: 32, fontMin: 12, fontMax: 110, fontStep: 1, titleField: 'timerTitle', titlePlaceholder: '(none)' },
  onthisday:     { fontField: 'otdFontPx',      fontDefault: 15, fontMin: 8,  fontMax: 64,  fontStep: 1 },
  dailyquote:    { fontField: 'dqFontPx',       fontDefault: 20, fontMin: 10, fontMax: 80,  fontStep: 1 },
  sports:        { fontField: 'spFontPx',       fontDefault: 16, fontMin: 8,  fontMax: 64,  fontStep: 1 },
  metar:         { fontField: 'wxFontPx',       fontDefault: 16, fontMin: 8,  fontMax: 64,  fontStep: 1 },
  text:          { fontField: 'textFontPx',     fontDefault: 28, fontMin: 10, fontMax: 480, fontStep: 2 },
  decoration:    { fontField: 'decorFontPx',    fontDefault: 60, fontMin: 16, fontMax: 300, fontStep: 2 },
  entitystatus:  { fontField: 'haFontPx',       fontDefault: 20, fontMin: 10, fontMax: 90, fontStep: 1, titleField: 'haLabel', titlePlaceholder: '(entity\'s own name)' },
  smarthomeDashboard: { fontField: 'haDashFontPx', fontDefault: 16, fontMin: 8, fontMax: 56, fontStep: 1, titleField: 'haDashTitle', titlePlaceholder: '(none)' },
};

function selectWidgetForEdit(id) {
  if (selectedWidgetId != null && String(selectedWidgetId) !== String(id)) {
    const prevEl = document.querySelector(`#canvas .widget[data-widget-id="${CSS.escape(String(selectedWidgetId))}"]`);
    if (prevEl) prevEl.classList.remove('selected');
  }
  selectedWidgetId = id;
  const el = document.querySelector(`#canvas .widget[data-widget-id="${CSS.escape(String(id))}"]`);
  if (el) { el.classList.add('selected'); injectEditChrome(el); }
  openWidgetSettingsPanel(id);
}
function deselectWidgetForEdit() {
  if (selectedWidgetId != null) {
    const el = document.querySelector(`#canvas .widget[data-widget-id="${CSS.escape(String(selectedWidgetId))}"]`);
    if (el) el.classList.remove('selected');
  }
  selectedWidgetId = null;
  removeEditChrome();
  closeWidgetSettingsPanel();
  closeWidgetAdvancedPanel(); // avoid a stale/orphaned advanced panel outliving its widget's selection
}
// Handles live on a single shared overlay element (a sibling of the widgets,
// not a child of one) repositioned to track whichever widget is currently
// selected — simpler and cheaper than creating/destroying 8 handles per
// widget, and avoids the overflow:hidden clipping problem entirely (see the
// overlay's own CSS comment).
function injectEditChrome(el) {
  const overlay = document.getElementById('edit-selection-overlay');
  if (!overlay) return;
  // Same reasoning as the drag gate above — resizing a full-screen-background
  // widget would have no visible effect while the override is active, so
  // don't even show the handles (matches app.html's Editor suppressing them
  // entirely for this field, not just disabling their function).
  const w = state.layout.find(x => String(x.id) === String(selectedWidgetId));
  if (w && w.photoFullscreenBg) { overlay.style.display = 'none'; return; }
  // Locked widgets: same suppression, matching app.html's Editor (which
  // hides its own resize handles entirely for a locked widget, not just
  // disabling their function — noDragResize covers drag AND resize there).
  if (w && w.locked) { overlay.style.display = 'none'; return; }
  overlay.style.display = 'block';
  syncEditOverlayToWidget(el);
  if (!overlay._handlesWired) {
    overlay._handlesWired = true;
    ['nw','ne','sw','se','n','s','e','w'].forEach(corner => {
      const h = document.createElement('div');
      h.className = `edit-resize-handle erh-${corner}`;
      h.dataset.corner = corner;
      h.setAttribute('data-interactive', '1');
      h.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (selectedWidgetId == null) return;
        const targetEl = document.querySelector(`#canvas .widget[data-widget-id="${CSS.escape(String(selectedWidgetId))}"]`);
        if (targetEl) startResize(e, targetEl, corner);
      });
      overlay.appendChild(h);
    });
  }
}
function removeEditChrome() {
  const overlay = document.getElementById('edit-selection-overlay');
  if (overlay) overlay.style.display = 'none';
}
function syncEditOverlayToWidget(el) {
  const overlay = document.getElementById('edit-selection-overlay');
  if (!overlay) return;
  overlay.style.left = el.style.left;
  overlay.style.top = el.style.top;
  overlay.style.width = el.style.width;
  overlay.style.height = el.style.height;
}

const MIN_WIDGET_SIZE_PCT = 6; // percent of canvas — a touch-target-sized floor
function clampNum(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
let _resizeState = null;
let _resizeRafPending = false;
function startResize(e, el, corner) {
  if (!editModeActive) return;
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch {}
  const widgetId = el.dataset.widgetId;
  const w = state.layout.find(x => String(x.id) === String(widgetId));
  if (!w) return;
  _resizeState = {
    el, w, corner, pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    origX: w.x, origY: w.y, origW: w.w, origH: w.h,
    W: effectiveWidth(), H: effectiveHeight(),
    // Latest raw pointer position; actual geometry math + DOM/data writes
    // only happen once per animation frame (see applyResizeFrame()) — see
    // the matching comment on _dragState.lastX/lastY above for why: raw
    // pointermove can fire faster than the screen paints, and doing the
    // full set of writes (widget style x4, overlay sync x4, plus mutating
    // state.layout itself) on every single one of those events was making
    // resize feel like it was lagging behind the finger and not tracking
    // the actual drag distance, not a bug in the resize math itself.
    lastX: e.clientX, lastY: e.clientY,
  };
  _resizeRafPending = false;
  el.classList.add('dragging');
  el.addEventListener('pointermove', onResizeMove);
  el.addEventListener('pointerup', onResizeEnd);
  el.addEventListener('pointercancel', onResizeEnd);
  window.addEventListener('pointerup', onResizeEnd, { once: true });
  window.addEventListener('pointercancel', onResizeEnd, { once: true });
}
function onResizeMove(e) {
  if (!_resizeState || e.pointerId !== _resizeState.pointerId) return;
  _resizeState.lastX = e.clientX;
  _resizeState.lastY = e.clientY;
  if (_resizeRafPending) return;
  _resizeRafPending = true;
  requestAnimationFrame(applyResizeFrame);
}
// Same anchoring logic as the app's own editor (public/app.html's startDrag,
// resize branch): corner handles adjust a pair of edges, anchoring the
// opposite corner in place; the four edge-middle handles adjust just one
// dimension, anchoring the opposite edge. Deliberately mirrors that math
// rather than inventing a new scheme, just adapted from % deltas (app.html's
// own coordinate system) to this page's pixel-based widget positioning.
function applyResizeFrame() {
  _resizeRafPending = false;
  if (!_resizeState) return; // resize may have ended between the request and this frame running
  const { el, w, corner, startX, startY, origX, origY, origW, origH, W, H, lastX, lastY } = _resizeState;
  const dx = ((lastX - startX) / W) * 100;
  const dy = ((lastY - startY) / H) * 100;
  const origRight = origX + origW, origBottom = origY + origH;
  const minSize = MIN_WIDGET_SIZE_PCT;
  let x = origX, y = origY, width = origW, height = origH;
  if (corner === 'se') {
    width = clampNum(origW + dx, minSize, 100 - origX);
    height = clampNum(origH + dy, minSize, 100 - origY);
  } else if (corner === 'sw') {
    x = clampNum(origX + dx, 0, origRight - minSize);
    width = origRight - x;
    height = clampNum(origH + dy, minSize, 100 - origY);
  } else if (corner === 'ne') {
    y = clampNum(origY + dy, 0, origBottom - minSize);
    height = origBottom - y;
    width = clampNum(origW + dx, minSize, 100 - origX);
  } else if (corner === 'nw') {
    x = clampNum(origX + dx, 0, origRight - minSize);
    width = origRight - x;
    y = clampNum(origY + dy, 0, origBottom - minSize);
    height = origBottom - y;
  } else if (corner === 'e') {
    width = clampNum(origW + dx, minSize, 100 - origX);
  } else if (corner === 'w') {
    x = clampNum(origX + dx, 0, origRight - minSize);
    width = origRight - x;
  } else if (corner === 'n') {
    y = clampNum(origY + dy, 0, origBottom - minSize);
    height = origBottom - y;
  } else if (corner === 's') {
    height = clampNum(origH + dy, minSize, 100 - origY);
  }
  w.x = x; w.y = y; w.w = width; w.h = height;
  el.style.left   = (x / 100 * W) + 'px';
  el.style.top    = (y / 100 * H) + 'px';
  el.style.width  = (width / 100 * W) + 'px';
  el.style.height = (height / 100 * H) + 'px';
  syncEditOverlayToWidget(el);
  // Explicit, direct call — not left to ResizeObserver alone. ResizeObserver
  // SHOULD pick up this exact style change on its own (that's its entire
  // purpose), but after this exact bug went through several rounds of fixes
  // that didn't fully resolve it, this stops depending on an assumption I
  // can't fully verify without a real browser and just calls the fit
  // function directly, every frame, live during the drag — matching the
  // established pattern immediately below (onResizeEnd already does the
  // equivalent explicit call for the calendar's own fitting logic, rather
  // than relying on anything automatic for that one either).
  if (w.type === 'weather' || w.type === 'weatherCurrent' || w.type === 'weatherForecast' || w.type === 'weatherHourly' || w.type === 'weatherComboForecast') {
    if (w.wxAutoFit) autoFitWeatherContent(el);
  } else if (['clock', 'date', 'countdown', 'timer', 'text'].includes(w.type)) {
    if (w.autoFit) autoFitTextWidgetContent(el, w);
  }
}
async function onResizeEnd(e) {
  if (!_resizeState || e.pointerId !== _resizeState.pointerId) return;
  const { el } = _resizeState;
  el.classList.remove('dragging');
  el.removeEventListener('pointermove', onResizeMove);
  el.removeEventListener('pointerup', onResizeEnd);
  el.removeEventListener('pointercancel', onResizeEnd);
  // Apply one final time synchronously with the LAST known pointer position
  // — a pending rAF frame (if any) hasn't necessarily run yet.
  applyResizeFrame();
  _resizeState = null;
  // Calendar cells trim overflowing event text based on the widget's actual
  // rendered size (fitCalendarCells(), normally run after a full
  // renderLayout()) — re-run it here too so a just-resized calendar doesn't
  // sit with stale overflow trimming until the next unrelated re-render.
  try { adaptCalendarEventFontSizes(); fitCalendarCells(); } catch {}
  await saveLayoutNow();
  if (_renderDeferredDuringDrag) { _renderDeferredDuringDrag = false; renderLayout(); }
}

// Real bug this fixes: a Live Editing change (e.g. the Date widget's Date
// Format dropdown) could visibly apply for a couple seconds, then silently
// revert. Saving a layout change broadcasts an SSE 'layout' event to every
// connected client of this display — INCLUDING back to the display that
// just made the edit. If that echo's fetchLayout() reconciliation (below)
// lands before the server has actually finished committing this display's
// own debounced save, it pulls back the pre-edit snapshot and stomps the
// fresh local change via the Object.assign() reconcile. _lastLocalLayoutSaveAt
// exists to recognize "this broadcast is almost certainly an echo of OUR
// OWN still-in-flight save" and skip the refetch rather than risk it —
// state.layout is already the newest truth in that case. A genuinely
// different client's edit landing in the same brief window would just wait
// for the next SSE broadcast or the 5-min poll instead of applying
// instantly — a minor, acceptable trade next to silently discarding the
// person's own just-made setting choice.
let _lastLocalLayoutSaveAt = 0;
const LAYOUT_ECHO_SUPPRESS_MS = 3000;
// True whenever this screen is currently showing a schedule-driven switch
// rather than its own true, pre-defined layout — see switchToLayoutTarget()
// for where this gets set/cleared, and checkSchedules() for the revert
// logic that reads it. By explicit request: since schedule-driven switches
// never persist (see switchToLayoutTarget()'s own comment on that), a
// screen would otherwise be stuck showing whatever the last switch left it
// on indefinitely once the schedule that put it there gets disabled, with
// no way back short of a manual reload.
let _scheduleOverrideActive = false;

async function saveLayoutNow() {
  // Never send a layout save without an explicit display slug — the server
  // now rejects this too (see the PUT endpoint's own comment for the real
  // incident this guards against: an empty/missing slug silently landing on
  // some OTHER, unrelated display's real content), but catching it here
  // first avoids a doomed request and gives an honest, specific error
  // instead of a generic "could not save" that wouldn't explain why.
  if (!DISPLAY_SLUG) {
    console.error('saveLayoutNow(): DISPLAY_SLUG is empty — refusing to save to avoid landing on the wrong display.');
    showDisplayToast('❌ Could not save — no display selected.');
    return;
  }
  // Never save while state.layout is a schedule-driven override (see
  // _scheduleOverrideActive's own comment) — real incident, confirmed live:
  // state.layout at that point holds a ROTATION TARGET's widgets, not
  // DISPLAY_SLUG's own, and this is the single actual choke point every
  // layout save funnels through. switchToLayoutTarget() itself already
  // knows never to persist a schedule-engine-triggered switch (see its own
  // callerTag check) — but that protection lives only in ONE caller. It did
  // NOT cover this: applyLocally() (called by every switch, including a
  // rotation's) fires a background refetch for any widget type new this
  // session, which for a 'stocks' widget runs
  // migrateLegacyStockTickersIfNeeded() — a one-time legacy-settings
  // migration with no awareness of rotation/preview context at all. It
  // found state.layout (at that moment the ROTATION TARGET's widgets, not
  // this screen's own) contained a stocks widget needing migration, and
  // called scheduleLayoutSave() — silently persisting the target's entire
  // layout onto DISPLAY_SLUG, permanently overwriting a real, named
  // display's own content the very first time its rotation ever reached a
  // target with an unmigrated stocks widget. Guarding the actual save
  // choke point, rather than patching that one caller, protects against
  // this same class of mistake from any OTHER path that ever calls
  // scheduleLayoutSave()/saveLayoutNow() without knowing about schedule
  // overrides — which is exactly how this one slipped through undetected.
  if (_scheduleOverrideActive) {
    console.error('saveLayoutNow(): blocked — state.layout is currently a schedule-driven override, not DISPLAY_SLUG\'s own content. Refusing to save it over the real display.');
    return;
  }
  _lastLocalLayoutSaveAt = Date.now();
  try {
    await fetch(`/api/layouts/${encodeURIComponent(currentOrientation)}?display=${encodeURIComponent(DISPLAY_SLUG)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgets: state.layout }),
    });
  } catch {
    showDisplayToast('❌ Could not save changes.');
  }
}
// Debounced save for the settings panel's text/range inputs, so rapid typing
// or slider-dragging coalesces into one write, same spirit as app.html's own
// autoSaveLayout() debounce.
let _layoutSaveTimer = null;
function scheduleLayoutSave() {
  clearTimeout(_layoutSaveTimer);
  _layoutSaveTimer = setTimeout(() => { saveLayoutNow(); }, 500);
}

// Re-renders just one widget's inner content (used after a title/font edit)
// instead of the full canvas — a full renderLayout() on every keystroke
// would tear down and recreate the settings panel's own text input mid-type,
// losing focus and cursor position. The selection overlay lives outside the
// widget itself, so it's unaffected by this and needs no special handling.
function rerenderSingleWidget(id) {
  const w = state.layout.find(x => String(x.id) === String(id));
  const el = document.querySelector(`#canvas .widget[data-widget-id="${CSS.escape(String(id))}"]`);
  if (!w || !el) return;
  // Keep the reuse-fingerprint (see renderLayout()'s own comment) in sync
  // with whatever was just edited here — without this, the NEXT full
  // renderLayout() would compare against a stale pre-edit fingerprint,
  // wrongly conclude nothing changed, and keep showing the OLD map/settings
  // instead of picking up what was just saved.
  if (w.type === 'radar') el.dataset.radarFingerprint = radarFingerprint(w);
  el.innerHTML = renderWidget(w);
  // Re-wire any tap-to-interact listeners inside this widget's freshly-
  // replaced DOM. All idempotent (each checks its own _tapWired flag before
  // attaching), so calling them broadly here is safe and simpler than
  // scoping each one to just this element.
  wireChoreChartTaps(); wireMessageBoardTaps(); wireMealPlanTaps(); wireCameraStreams(); wireCameraTaps(); wireFlightMaps(); wireTodoWidgetTaps(); wireShoppingWidgetTaps(); wireTasksWidgetTaps(); wireMiniCalNav(); wireEntityStatusTaps(); wireHaSparklines(); wireLayoutSwitcherTaps(); wireWeatherComboTabTaps(); wireEventDetailTaps();
  // QR codes are generated into their container by a separate pass after
  // any render (renderQRCodes(), normally run after a full renderLayout())
  // — innerHTML alone only creates an empty .qr-container div, so without
  // this, editing a QR widget's content in Live Editing would silently not
  // update the actual code shown. Cheap no-op when there's no QR widget on
  // this layout at all (see its own comment), so safe to call broadly here
  // too, same reasoning as the tap-wiring calls above.
  renderQRCodes();
  initRadarWidgets();
  // Calendar-specific: re-run the same overflow/adaptive-sizing fitting pass
  // renderLayout() does after a full render, scoped to just this widget's
  // freshly-replaced DOM. Without this, toggling a calendar setting in Live
  // Edit (wrap mode, max lines, and now Adaptive Font Sizing) wouldn't show
  // its effect until the next full renderLayout() happened to run — the
  // preview would look stale/wrong immediately after the very change it's
  // meant to demonstrate.
  if (w.type === 'minical') {
    requestAnimationFrame(() => { adaptCalendarEventFontSizes(); fitCalendarCells(); });
  }
  // Weather-specific: the box itself didn't resize (that's what the
  // ResizeObserver in setupWeatherAutoFit watches for), but the CONTENT'S
  // natural size may have just changed — a settings edit like toggling
  // forecast days, or the Auto-fit checkbox itself just being turned on or
  // off. Re-measure directly rather than waiting for a resize that isn't
  // coming, and keep the observer's registration in sync with the current
  // setting: turning Auto-fit off has to actually UNobserve, not just skip
  // re-observing — otherwise a widget observed from an earlier session
  // would still silently overwrite the user's manual scale the next time
  // its box happens to resize, well after they turned auto-fit off.
  // Runs synchronously (not requestAnimationFrame-deferred) — same "don't
  // let the browser paint an un-fit frame first" reasoning as
  // setupWeatherAutoFit/setupTextAutoFit's own comments.
  if (['weather', 'weatherCurrent', 'weatherForecast', 'weatherHourly', 'weatherComboForecast'].includes(w.type)) {
    if (w.wxAutoFit) {
      autoFitWeatherContent(el);
      if (_weatherAutoFitObserver) _weatherAutoFitObserver.observe(el); // no-op if already observed
    } else if (_weatherAutoFitObserver) {
      _weatherAutoFitObserver.unobserve(el);
    }
  }
  // Same reasoning as the weather block just above, for the second batch of
  // auto-fit widgets (Clock, Date, Countdown, Timer, Text).
  if (['clock', 'date', 'countdown', 'timer', 'text'].includes(w.type)) {
    if (w.autoFit) {
      autoFitTextWidgetContent(el, w);
      if (_textAutoFitObserver) _textAutoFitObserver.observe(el);
    } else if (_textAutoFitObserver) {
      _textAutoFitObserver.unobserve(el);
    }
  }
}

async function deleteWidget(id) {
  // Defensive, matching startDrag()/startResize()'s own self-guard rather
  // than relying solely on the Delete button being hidden once Live Editing
  // is exited — a destructive action shouldn't depend on nothing else
  // reaching it by some other path.
  if (!editModeActive) return;
  state.layout = state.layout.filter(x => String(x.id) !== String(id));
  if (String(selectedWidgetId) === String(id)) deselectWidgetForEdit();
  renderLayout();
  await saveLayoutNow();
}

// Widget types with a full "⚙️ More Settings" panel (see
// openWidgetAdvancedPanel() below) — deliberately a short, hand-picked list
// rather than "every type eventually," since each entry here is a real,
// separately-built settings UI ported field-for-field from app.html's own
// drawWidgetSettingsPanel(), not a generic renderer. Add to this list only
// alongside actually building that type's render/wire functions.
const WIDGET_ADVANCED_TYPES = ['webpage', 'minical', 'weather', 'weatherCurrent', 'weatherForecast', 'weatherHourly', 'weatherComboForecast', 'todo', 'shoppinglist', 'chorechart', 'chorelb', 'countdown', 'radar', 'qrcode', 'timer', 'moonphase', 'airquality', 'onthisday', 'dailyquote', 'metar', 'clock', 'date', 'news', 'stocks', 'travel', 'sports', 'text', 'decoration', 'upcoming', 'today', 'agenda', 'photo', 'tasks', 'tasksCombined', 'entitystatus', 'smarthomeDashboard', 'groupcontrol', 'messageboard', 'mealplan', 'camera', 'flightmap'];

function openWidgetSettingsPanel(id) {
  const w = state.layout.find(x => String(x.id) === String(id));
  const panel = document.getElementById('widget-edit-panel');
  if (!w || !panel) return;
  const cfg = WIDGET_BASIC_SETTINGS[w.type];
  const hasAdvanced = WIDGET_ADVANCED_TYPES.includes(w.type);
  panel.style.display = 'flex';

  const titleRow = document.getElementById('wep-title-row');
  const fontRow = document.getElementById('wep-font-row');
  const noOptsRow = document.getElementById('wep-noopts-row');
  const titleInput = document.getElementById('wep-title-input');
  const fontRange = document.getElementById('wep-font-range');
  const fontVal = document.getElementById('wep-font-val');
  const advancedBtn = document.getElementById('wep-advanced-btn');

  if (cfg && cfg.titleField) {
    titleRow.style.display = 'flex';
    titleInput.value = w[cfg.titleField] || '';
    titleInput.placeholder = cfg.titlePlaceholder || '';
  } else {
    titleRow.style.display = 'none';
  }

  if (cfg && cfg.fontField) {
    fontRow.style.display = 'flex';
    const val = w[cfg.fontField] || cfg.fontDefault;
    fontRange.min = cfg.fontMin; fontRange.max = cfg.fontMax; fontRange.step = cfg.fontStep;
    fontRange.value = val;
    fontVal.textContent = val + 'px';
  } else {
    fontRow.style.display = 'none';
  }

  advancedBtn.style.display = hasAdvanced ? 'inline-block' : 'none';
  // A type can have neither the basic title/font fields NOR an advanced
  // panel (most types), just the advanced panel and no basic fields
  // (Weather — its "font size" is a content-scale percentage, not a simple
  // px field, so it doesn't fit WIDGET_BASIC_SETTINGS' shape), or both
  // (Calendar). Only actually show "more settings in the app" when there's
  // truly nothing to do here at all.
  noOptsRow.style.display = (cfg || hasAdvanced) ? 'none' : 'flex';

  // Wired once; the panel persists across selections and is just
  // repopulated each time (reading the CURRENTLY selected widget at event
  // time via selectedWidgetId, not the id captured when this function was
  // first called), so one binding covers every widget ever selected.
  if (!panel._wired) {
    panel._wired = true;
    titleInput.addEventListener('input', () => {
      const cw = state.layout.find(x => String(x.id) === String(selectedWidgetId));
      const ccfg = cw && WIDGET_BASIC_SETTINGS[cw.type];
      if (!cw || !ccfg || !ccfg.titleField) return;
      cw[ccfg.titleField] = titleInput.value;
      rerenderSingleWidget(cw.id);
      scheduleLayoutSave();
    });
    fontRange.addEventListener('input', () => {
      const cw = state.layout.find(x => String(x.id) === String(selectedWidgetId));
      const ccfg = cw && WIDGET_BASIC_SETTINGS[cw.type];
      if (!cw || !ccfg || !ccfg.fontField) return;
      const v = parseInt(fontRange.value, 10);
      cw[ccfg.fontField] = v;
      fontVal.textContent = v + 'px';
      rerenderSingleWidget(cw.id);
      scheduleLayoutSave();
    });
    document.getElementById('wep-delete-btn').addEventListener('click', () => {
      if (selectedWidgetId == null) return;
      deleteWidget(selectedWidgetId);
    });
    document.getElementById('wep-advanced-btn').addEventListener('click', () => {
      if (selectedWidgetId == null) return;
      openWidgetAdvancedPanel(selectedWidgetId);
    });
  }
}
function closeWidgetSettingsPanel() {
  const panel = document.getElementById('widget-edit-panel');
  if (panel) panel.style.display = 'none';
}

// ── HA entity/area data for Live Edit's advanced panels ─────────────────────
// Mirrors app.html's cachedHaEntities/cachedHaAreas/ensureHaAreasLoaded, but
// using plain fetch() — this page has no session/auth layer at all (the
// wall display is always public by design), unlike app.html's apiFetch().
// Cached per page-load session; a full reload picks up any changes made in
// HA since. Both fetches run in parallel since the picker needs both to
// render its area-filter dropdown at all.
let cachedHaEntitiesD = null;
let cachedHaAreasD = null;
// Which combo group (if any) is currently being edited within the
// Dashboard's advanced panel — { widgetId, comboId } via just the id
// string, since only one widget's panel can be open at a time. null means
// "show the normal Dashboard settings view, not a combo group's editor."
let _editingComboGroupId = null;
// Set by wireComboGroupEditor() just before a selection click triggers a full
// panel re-render, and consumed by the next wireComboGroupEditor() call once
// that re-render lands — see the comment where it's set for why a full
// re-render is needed at all here. null means "nothing to restore" (a fresh
// open of the combo editor, or a plain navigation between groups).
let _comboListScrollToRestore = null;
async function ensureHaEntitiesAndAreasLoaded() {
  const tasks = [];
  if (!cachedHaEntitiesD) {
    tasks.push((async () => {
      try { const r = await fetch('/api/ha/entities'); const d = await r.json(); cachedHaEntitiesD = Array.isArray(d) ? d : []; }
      catch { cachedHaEntitiesD = []; }
    })());
  }
  if (!cachedHaAreasD) {
    tasks.push((async () => {
      try { const r = await fetch('/api/ha/areas'); const d = await r.json(); cachedHaAreasD = (d && Array.isArray(d.areas)) ? d : { areas: [], entityAreas: {} }; }
      catch { cachedHaAreasD = { areas: [], entityAreas: {} }; }
    })());
  }
  if (tasks.length) await Promise.all(tasks);
  return { entities: cachedHaEntitiesD, areas: cachedHaAreasD };
}
// Shared list-filtering logic for all three HA advanced-panel pickers below
// (Entity Status, Smart Home Dashboard, Group Control) — one place for
// "search text + optional area" filtering rather than three copies of the
// same few lines.
function filterHaEntitiesD(query, areaId) {
  let list = cachedHaEntitiesD || [];
  if (areaId) {
    const entityAreas = (cachedHaAreasD && cachedHaAreasD.entityAreas) || {};
    list = list.filter(en => entityAreas[en.entity_id] === areaId);
  }
  const q = (query || '').trim().toLowerCase();
  if (q) list = list.filter(en => en.friendly_name.toLowerCase().includes(q) || en.entity_id.toLowerCase().includes(q));
  return list;
}
// Shared area-<select> options builder — identical fallback-when-no-areas
// reasoning as app.html's pickers (hide the row entirely rather than show a
// dropdown with nothing but "All areas" in it).
function haAreaOptionsHtmlD() {
  if (!cachedHaAreasD || !cachedHaAreasD.areas.length) return null;
  return `<option value="">All areas</option>` +
    cachedHaAreasD.areas.map(a => `<option value="${escapeHtmlD(a.id)}">${escapeHtmlD(a.name)}</option>`).join('');
}
// Resolves a widget's whole-area selections into the entity ids CURRENTLY
// in those areas — called fresh on every render/poll, not cached against
// the widget itself. This IS the "live" behavior: whatever Home Assistant
// says is in the area right now, not a snapshot from whenever it was
// selected. Returns [] (not an error) if area data hasn't loaded yet —
// callers degrade gracefully; the next successful fetchHaEntities() poll
// fills it in and re-renders.
function resolveAreaMemberIds(areaIds) {
  if (!Array.isArray(areaIds) || !areaIds.length || !cachedHaAreasD) return [];
  const entityAreas = cachedHaAreasD.entityAreas || {};
  const areaSet = new Set(areaIds);
  return Object.keys(entityAreas).filter(entId => areaSet.has(entityAreas[entId]));
}
// A "combo group" bundles several areas and/or individual entities into ONE
// named toggle — e.g. "Upstairs" = the Bedroom + Bathroom + Office areas
// combined into a single switch, shown as one tile in the Dashboard
// alongside individual per-area tiles, not replacing them. combo is
// { id, name, entityIds, areaIds }. Live-resolved exactly like a plain area
// selection — combines direct entityIds with everything resolveAreaMemberIds()
// currently finds in areaIds, deduped.
function resolveComboMemberIds(combo) {
  const ids = new Set(Array.isArray(combo && combo.entityIds) ? combo.entityIds : []);
  if (combo && Array.isArray(combo.areaIds) && combo.areaIds.length) {
    resolveAreaMemberIds(combo.areaIds).forEach(id => ids.add(id));
  }
  return [...ids];
}
// Shared row markup for all three pickers below — a checkbox-style row
// (visually identical whether the underlying selection is single or
// multi — each caller's own click handler enforces the actual single vs.
// multi-select rule, this just draws what's currently selected). The
// optional isCoveredByArea predicate renders a row disabled/greyed with no
// click handler at all when the entity is already included via a whole
// selected area — the point being to make double-selection genuinely
// impossible to attempt, not just discouraged, since that's exactly the
// confusion this was built to prevent.
function haEntityRowsHtmlD(list, isSelected, isCoveredByArea) {
  if (!list.length) return `<p class="was-hint" style="padding:8px 4px">No matching entities.</p>`;
  return list.map(e => {
    if (isCoveredByArea && isCoveredByArea(e.entity_id)) {
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:1px solid rgba(255,255,255,0.08);opacity:0.4">
        <span style="width:20px;height:20px;flex-shrink:0;border-radius:5px;border:1px solid rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:11px;background:rgba(255,255,255,0.1)">✓</span>
        <span style="min-width:0;display:flex;flex-direction:column">
          <span style="font-size:14px">${escapeHtmlD(e.friendly_name)}</span>
          <span style="font-size:11px;opacity:0.85">Included via its area — uncheck the area above to pick it individually instead</span>
        </span>
      </div>`;
    }
    const sel = isSelected(e.entity_id);
    return `<div class="was-ha-row" data-id="${escapeHtmlD(e.entity_id)}" style="display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer">
      <span style="width:20px;height:20px;flex-shrink:0;border-radius:5px;border:1px solid rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:13px;${sel ? 'background:var(--accent,#4A90D9);border-color:var(--accent,#4A90D9);' : ''}">${sel ? '✓' : ''}</span>
      <span style="min-width:0;display:flex;flex-direction:column">
        <span style="font-size:14px">${escapeHtmlD(e.friendly_name)}</span>
        <span style="font-size:11px;opacity:0.6">${escapeHtmlD(e.entity_id)} — ${escapeHtmlD(e.state)}${e.unit ? ' ' + escapeHtmlD(e.unit) : ''}</span>
      </span>
    </div>`;
  }).join('');
}
// Area checkbox rows — same visual language as haEntityRowsHtmlD above, for
// the separate "select a whole area" section each multi-entity picker now
// has alongside its individual entity list.
function haAreaRowsHtmlD(isSelected) {
  if (!cachedHaAreasD || !cachedHaAreasD.areas.length) return `<p class="was-hint" style="padding:8px 4px">No areas found in Home Assistant.</p>`;
  return cachedHaAreasD.areas.map(a => {
    const sel = isSelected(a.id);
    return `<div class="was-ha-arearow" data-area-id="${escapeHtmlD(a.id)}" style="display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer">
      <span style="width:20px;height:20px;flex-shrink:0;border-radius:5px;border:1px solid rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:13px;${sel ? 'background:var(--accent,#4A90D9);border-color:var(--accent,#4A90D9);' : ''}">${sel ? '✓' : ''}</span>
      <span style="font-size:14px">${escapeHtmlD(a.name)}</span>
    </div>`;
  }).join('');
}

// ── Live Editing: full "⚙️ More Settings" panel for select widget types ────
// Calendar and the four Weather variants — see WIDGET_ADVANCED_TYPES above.
// Fields, defaults, and behavior are ported directly from app.html's own
// drawWidgetSettingsPanel() for these exact types, field-for-field, not a
// reinterpreted subset — the goal here is real parity with the app's editor
// for these two, not an approximation. showInfoPopup() (app.html's ⓘ-button
// popup system) doesn't exist on this page; the same explanatory text is
// inlined as plain hint paragraphs instead of porting that whole subsystem
// just for three tooltips.
// ── Reusable collapsible accordion ────────────────────────────────────────────
// Same API/behavior as accordionSection()/wireAccordion() in app.html — see
// that copy's own comment for the full explanation. New here rather than
// ported from an existing display.html pattern: this file never had a real
// accordion before (Per-Feed Opacity was a flat, always-visible section
// with a plain label, not collapsible), so this is this file's first use
// of the pattern, not a port of prior behavior.
function accordionSection(s, openByDefault = false) {
  return `
    <div class="acc-section${openByDefault ? ' open' : ''}" data-acc="${s.id}" style="${s.hidden ? 'display:none' : ''}">
      <button class="acc-head" data-acc-toggle="${s.id}" type="button">
        <span class="acc-ic">${s.icon || ''}</span>
        <span class="acc-text"><span class="acc-label">${s.label}</span>${s.sub ? `<span class="acc-sub">${s.sub}</span>` : ''}</span>
        <span class="acc-caret">${openByDefault ? '▾' : '▸'}</span>
      </button>
      <div class="acc-body" data-acc-body="${s.id}" style="${openByDefault ? '' : 'display:none'}">
        ${s.inner}
      </div>
    </div>`;
}
function wireAccordion(containerId) {
  const root = document.getElementById(containerId);
  if (!root) return;
  const ownSections = () => root.querySelectorAll(':scope > .acc-section');
  ownSections().forEach(sec => {
    const btn = sec.querySelector(':scope > .acc-head');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = sec.classList.contains('open');
      ownSections().forEach(s => {
        const body = s.querySelector(':scope > .acc-body');
        const caret = s.querySelector(':scope > .acc-head .acc-caret');
        s.classList.remove('open');
        if (body) body.style.display = 'none';
        if (caret) caret.textContent = '▸';
      });
      if (!isOpen) {
        sec.classList.add('open');
        const body = sec.querySelector(':scope > .acc-body');
        const caret = sec.querySelector(':scope > .acc-head .acc-caret');
        if (body) body.style.display = '';
        if (caret) caret.textContent = '▾';
      }
    });
  });
}
// "Show Screen Switcher" and "Schedule" inside the Screen Settings panel —
// deliberately NOT wired via wireAccordion() above, since that function
// enforces mutual exclusion (only one section open at a time). These two
// need to expand/collapse independently — by explicit request, and because
// the schedule can be actively firing regardless of whether the switcher
// button itself is enabled (checkSchedules() never checks
// floating_switcher_enabled at all), so tying one's visibility to the
// other's state would misrepresent that. No persisted open/closed state
// needed (unlike app.html's equivalent, openScreenSubAccordions) — this
// panel only ever renders once per open, it's never re-rendered in place
// the way Screens management's screen list periodically is.
function wireFlsSubAccordionsPreview() {
  ['ss-fls-toggle-section', 'ss-fls-schedule-section', 'ss-editbar-section'].forEach(id => {
    const sec = document.querySelector(`#screen-settings-body [data-acc="${id}"]`);
    if (!sec) return;
    const btn = sec.querySelector(':scope > .acc-head');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = sec.classList.contains('open');
      const bodyEl = sec.querySelector(':scope > .acc-body');
      const caret = sec.querySelector(':scope > .acc-head .acc-caret');
      sec.classList.toggle('open', !isOpen);
      if (bodyEl) bodyEl.style.display = isOpen ? 'none' : '';
      if (caret) caret.textContent = isOpen ? '▸' : '▾';
    });
  });
}
async function openWidgetAdvancedPanel(id) {
  const w = state.layout.find(x => String(x.id) === String(id));
  const panel = document.getElementById('widget-advanced-panel');
  const body = document.getElementById('widget-advanced-body');
  const title = document.getElementById('widget-advanced-title');
  if (!w || !panel || !body) return;
  if (_calSettingsOpenSectionForWidgetId !== id) {
    _calSettingsOpenSection = null;
    _calSettingsOpenSectionForWidgetId = id;
  }
  // Real, reported annoyance fixed here: every in-panel action (picking an
  // entity, toggling an area, removing something) calls this same function
  // again to redraw the whole panel with current state — and this used to
  // unconditionally reset scroll to the top every single time, so
  // selecting an area while scrolled down through a long entity list threw
  // you back to the top instead of staying where you were. Only reset on a
  // genuinely FRESH open (panel wasn't already visible) — an already-open
  // panel means this is a self-triggered re-render, not a new open, so its
  // scroll position gets captured now and restored once the new content is
  // actually in place below.
  const wasAlreadyOpen = panel.style.display === 'flex';
  const savedScroll = wasAlreadyOpen ? body.scrollTop : 0;
  panel.style.display = 'flex';
  if (!wasAlreadyOpen) body.scrollTop = 0;

  if (w.type === 'minical') {
    title.textContent = 'Calendar Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    const feeds = await fetchCalendarFeeds();
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderCalendarAdvancedSettings(w) + renderCalendarFamilyFilterHtml(w, feeds);
    wireCalendarAdvancedSettings(w);
    wireCalendarFamilyFilter(w);
  } else if (['weather', 'weatherCurrent', 'weatherForecast', 'weatherHourly', 'weatherComboForecast'].includes(w.type)) {
    title.textContent = 'Weather Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    let wxSettings = null;
    try { wxSettings = await (await fetch('/api/settings')).json(); } catch {}
    // Bail if the panel got closed or a different widget got selected while
    // that fetch was in flight — don't clobber whatever's on screen now.
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderWeatherAdvancedSettings(w, wxSettings);
    wireWeatherAdvancedSettings(w, wxSettings);
  } else if (w.type === 'tasks') {
    title.textContent = 'Tasks (Todoist) Settings';
    body.innerHTML = renderTasksAdvancedSettings(w);
    wireTasksAdvancedSettings(w);
  } else if (w.type === 'tasksCombined') {
    title.textContent = 'Tasks Combined Settings';
    body.innerHTML = renderTasksCombinedAdvancedSettings(w);
    wireTasksCombinedAdvancedSettings(w);
  } else if (w.type === 'todo') {
    title.textContent = 'To-Do List Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    let lists = [];
    try { lists = await (await fetch('/api/todo-lists')).json(); } catch {}
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderTodoAdvancedSettings(w, lists);
    wireTodoAdvancedSettings(w);
  } else if (w.type === 'shoppinglist') {
    title.textContent = 'Shopping List Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    let lists = [];
    try { lists = await (await fetch('/api/shopping-lists')).json(); } catch {}
    if (!Array.isArray(lists)) lists = [];
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderShoppingAdvancedSettings(w, lists);
    wireShoppingAdvancedSettings(w);
  } else if (w.type === 'chorechart') {
    title.textContent = 'Chore Chart Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    let kids = [];
    try { kids = await (await fetch('/api/kids')).json(); } catch {}
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderChoreChartAdvancedSettings(w, kids);
    wireChoreChartAdvancedSettings(w);
  } else if (w.type === 'chorelb') {
    title.textContent = 'Chore Leaderboard Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    let kids = [];
    try { kids = await (await fetch('/api/kids')).json(); } catch {}
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderChoreLbAdvancedSettings(w, kids);
    wireChoreLbAdvancedSettings(w);
  } else if (w.type === 'countdown') {
    title.textContent = 'Countdown Settings';
    body.innerHTML = renderCountdownAdvancedSettings(w);
    wireCountdownAdvancedSettings(w);
  } else if (w.type === 'radar') {
    title.textContent = 'Weather Radar Settings';
    body.innerHTML = renderRadarAdvancedSettings(w);
    wireRadarAdvancedSettings(w);
  } else if (w.type === 'webpage') {
    title.textContent = 'Web Page Settings';
    body.innerHTML = renderWebPageAdvancedSettings(w);
    wireWebPageAdvancedSettings(w);
  } else if (w.type === 'qrcode') {
    title.textContent = 'QR Code Settings';
    body.innerHTML = renderQRCodeAdvancedSettings(w);
    wireQRCodeAdvancedSettings(w);
  } else if (w.type === 'timer') {
    title.textContent = 'Timer Settings';
    body.innerHTML = renderTimerAdvancedSettings(w);
    wireTimerAdvancedSettings(w);
  } else if (w.type === 'moonphase') {
    title.textContent = 'Moon Phase Settings';
    body.innerHTML = renderMoonPhaseAdvancedSettings(w);
    wireMoonPhaseAdvancedSettings(w);
  } else if (w.type === 'airquality') {
    title.textContent = 'Air Quality Settings';
    body.innerHTML = renderAirQualityAdvancedSettings(w);
    wireAirQualityAdvancedSettings(w);
  } else if (w.type === 'onthisday') {
    title.textContent = 'On This Day Settings';
    body.innerHTML = renderOnThisDayAdvancedSettings(w);
    wireOnThisDayAdvancedSettings(w);
  } else if (w.type === 'dailyquote') {
    title.textContent = 'Daily Quote Settings';
    body.innerHTML = renderDailyQuoteAdvancedSettings(w);
    wireDailyQuoteAdvancedSettings(w);
  } else if (w.type === 'metar') {
    title.textContent = 'METAR/TAF Settings';
    body.innerHTML = renderMetarAdvancedSettings(w);
    wireMetarAdvancedSettings(w);
  } else if (w.type === 'clock') {
    title.textContent = 'Clock Settings';
    body.innerHTML = renderClockAdvancedSettings(w);
    wireClockAdvancedSettings(w);
  } else if (w.type === 'date') {
    title.textContent = 'Date Settings';
    body.innerHTML = renderDateAdvancedSettings(w);
    wireDateAdvancedSettings(w);
  } else if (w.type === 'datetime') {
    title.textContent = 'Date & Time Settings';
    body.innerHTML = renderDateTimeAdvancedSettings(w);
    wireDateTimeAdvancedSettings(w);
  } else if (w.type === 'reminders') {
    title.textContent = 'Reminders Settings';
    body.innerHTML = renderRemindersAdvancedSettings(w);
    wireRemindersAdvancedSettings(w);
  } else if (w.type === 'messageboard') {
    title.textContent = 'Message Board Settings';
    body.innerHTML = renderMessageBoardAdvancedSettings(w);
    wireMessageBoardAdvancedSettings(w);
  } else if (w.type === 'mealplan') {
    title.textContent = 'Meal Plan Settings';
    body.innerHTML = renderMealPlanAdvancedSettings(w);
    wireMealPlanAdvancedSettings(w);
  } else if (w.type === 'camera') {
    title.textContent = 'Camera Settings';
    if (_camPanelWidgetId !== w.id) { _camFormOpen = false; _camFormEditId = null; _camPanelWidgetId = w.id; }
    body.innerHTML = renderCameraAdvancedSettings(w);
    wireCameraAdvancedSettings(w);
  } else if (w.type === 'flightmap') {
    title.textContent = 'Flight Map Settings';
    body.innerHTML = renderFlightMapAdvancedSettings(w);
    wireFlightMapAdvancedSettings(w);
  } else if (w.type === 'news') {
    title.textContent = 'News Settings';
    body.innerHTML = renderNewsAdvancedSettings(w);
    wireNewsAdvancedSettings(w);
  } else if (w.type === 'stocks') {
    title.textContent = 'Stocks Settings';
    body.innerHTML = renderStocksAdvancedSettings(w);
    wireStocksAdvancedSettings(w);
  } else if (w.type === 'travel') {
    title.textContent = 'Travel Time Settings';
    body.innerHTML = renderTravelAdvancedSettings(w);
    wireTravelAdvancedSettings(w);
  } else if (w.type === 'sports') {
    title.textContent = 'Sports Settings';
    body.innerHTML = renderSportsAdvancedSettings(w);
    wireSportsAdvancedSettings(w);
  } else if (w.type === 'text') {
    title.textContent = 'Text Settings';
    body.innerHTML = renderTextAdvancedSettings(w);
    wireTextAdvancedSettings(w);
  } else if (w.type === 'decoration') {
    title.textContent = 'Decoration Settings';
    body.innerHTML = renderDecorationAdvancedSettings(w);
    wireDecorationAdvancedSettings(w);
  } else if (w.type === 'upcoming') {
    title.textContent = 'Upcoming Events Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    const feeds = await fetchCalendarFeeds();
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderUpcomingAdvancedSettings(w) + renderCalendarFamilyFilterHtml(w, feeds);
    wireUpcomingAdvancedSettings(w);
    wireCalendarFamilyFilter(w);
  } else if (w.type === 'today') {
    title.textContent = "Today's Events Settings";
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    const feeds = await fetchCalendarFeeds();
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderTodayAdvancedSettings(w) + renderCalendarFamilyFilterHtml(w, feeds);
    wireTodayAdvancedSettings(w);
    wireCalendarFamilyFilter(w);
  } else if (w.type === 'agenda') {
    title.textContent = 'Agenda Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    const feeds = await fetchCalendarFeeds();
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderAgendaWidgetAdvancedSettings(w) + renderCalendarFamilyFilterHtml(w, feeds);
    wireAgendaWidgetAdvancedSettings(w);
    wireCalendarFamilyFilter(w);
  } else if (w.type === 'photo') {
    title.textContent = 'Photo Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    const { photos, tags } = await fetchPhotosAndTags();
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderPhotoAdvancedSettings(w, tags);
    wirePhotoAdvancedSettings(w, photos);
  } else if (w.type === 'entitystatus') {
    title.textContent = 'Entity Status Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    await ensureHaEntitiesAndAreasLoaded();
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderEntityStatusAdvancedSettings(w);
    wireEntityStatusAdvancedSettings(w);
  } else if (w.type === 'smarthomeDashboard') {
    title.textContent = 'Smart Home Grid Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    await ensureHaEntitiesAndAreasLoaded();
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    // Editing a combo group is a genuinely separate sub-view of this same
    // panel (its own name field + its own area/entity pickers, scoped to
    // just that group's membership) rather than a whole new overlay — see
    // _editingComboGroupId below and openComboGroupEditor()/
    // closeComboGroupEditor(), which toggle between the two.
    if (!Array.isArray(w.haComboGroups)) w.haComboGroups = [];
    const editingCombo = _editingComboGroupId ? w.haComboGroups.find(c => c.id === _editingComboGroupId) : null;
    if (editingCombo) {
      title.textContent = `Combo Group: ${editingCombo.name || 'Untitled'}`;
      body.innerHTML = renderComboGroupEditor(w, editingCombo);
      wireComboGroupEditor(w, editingCombo);
    } else {
      title.textContent = 'Smart Home Grid Settings';
      body.innerHTML = renderSmartHomeDashboardAdvancedSettings(w);
      wireSmartHomeDashboardAdvancedSettings(w);
    }
  } else if (w.type === 'groupcontrol') {
    title.textContent = 'Group Control Settings';
    body.innerHTML = '<p class="was-hint">Loading…</p>';
    await ensureHaEntitiesAndAreasLoaded();
    if (document.getElementById('widget-advanced-panel').style.display === 'none') return;
    if (String(selectedWidgetId) !== String(id)) return;
    body.innerHTML = renderGroupControlAdvancedSettings(w);
    wireGroupControlAdvancedSettings(w);
  }
  const closeBtn = document.getElementById('widget-advanced-close');
  if (closeBtn && !closeBtn._wired) {
    closeBtn._wired = true;
    closeBtn.addEventListener('click', closeWidgetAdvancedPanel);
  }
  // Restore AFTER the new content is actually in the DOM — rAF so layout
  // has settled first, otherwise scrollTop can get silently clamped
  // against whatever the previous (shorter, "Loading…") content's height
  // was rather than the real final content.
  if (wasAlreadyOpen) requestAnimationFrame(() => { body.scrollTop = savedScroll; });
}
function closeWidgetAdvancedPanel() {
  const panel = document.getElementById('widget-advanced-panel');
  if (panel) panel.style.display = 'none';
  // A full close should always land back on the normal Dashboard settings
  // view next time it's opened, not leave someone stuck inside whichever
  // combo group they last happened to be editing.
  _editingComboGroupId = null;
  // The basic panel sits underneath, unchanged since it was last drawn —
  // if anything touched here also affects a basic-panel field (e.g. Entity
  // Status's auto-following label), it wouldn't show up until this
  // refreshes it. Cheap and safe to call unconditionally: openWidgetSettingsPanel()
  // always rebuilds fresh from current state.
  if (selectedWidgetId != null) openWidgetSettingsPanel(selectedWidgetId);
}

