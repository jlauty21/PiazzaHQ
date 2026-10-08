// ── Add event via touchscreen (long-press a calendar day cell) ──────────────
// Plain typed form. Saving POSTs /api/events; on a slave display that write
// is proxied to the host by slaveWriteGuard(), and the host's own CRUD
// handler then fans the new event out to iCloud/Google if push is on.
let _eaSaving = false;
let _eaHandwritingReady = null; // null = not checked yet, then true/false; cached for the session
async function eaCheckHandwriting() {
  if (_eaHandwritingReady !== null) return _eaHandwritingReady;
  try {
    const r = await fetch('/api/handwriting-settings');
    const j = await r.json();
    _eaHandwritingReady = !!(j && j.handwriting_ready);
  } catch { _eaHandwritingReady = false; }
  return _eaHandwritingReady;
}
// Populate the "Add to" picker. Re-fetched each open so a calendar added in
// settings shows up without reloading the display. Hidden entirely when the
// only option is "This device only" (nothing else is configured).
async function eaLoadTargets() {
  const row = document.getElementById('ea-target-row');
  const sel = document.getElementById('ea-target');
  if (!row || !sel) return;
  row.hidden = true;
  sel.innerHTML = '';
  try {
    const j = await (await fetch('/api/event-targets')).json();
    const targets = (j && Array.isArray(j.targets)) ? j.targets : [];
    if (targets.length <= 1) return; // only "local" — nothing to choose
    sel.innerHTML = targets.map(t =>
      `<option value="${String(t.id).replace(/"/g,'&quot;')}"${t.id === j.default ? ' selected' : ''}>${escapeHtmlD(t.label)}</option>`
    ).join('');
    row.hidden = false;
  } catch { /* leave hidden — event just saves locally + follows the global push toggles */ }
}
function openEventAddSheet(dateStr) {
  const overlay = document.getElementById('event-add-overlay');
  if (!overlay) return;
  _eaSaving = false;
  const today = todayStr();
  document.getElementById('ea-title').value = '';
  document.getElementById('ea-date').value = dateStr || today;
  document.getElementById('ea-enddate').value = '';
  { const l = document.getElementById('ea-location'); if (l) l.value = ''; }
  document.getElementById('ea-allday').checked = true;
  document.getElementById('ea-start').value = '';
  document.getElementById('ea-end').value = '';
  document.getElementById('ea-time-row').style.display = 'none';
  eaClosePad(); // make sure the stroke pad is put away
  const err = document.getElementById('ea-error');
  err.style.display = 'none'; err.textContent = '';
  const save = document.getElementById('ea-save');
  save.disabled = false; save.textContent = 'Add event';
  overlay.style.display = 'flex';
  eaLoadTargets();
  eaLoadOwners();
  eaCheckHandwriting().then(ready => {
    const b = document.getElementById('ea-write-btn');
    if (b) b.hidden = !ready;
  });
  setTimeout(() => { try { document.getElementById('ea-title').focus(); } catch {} }, 50);
}
function closeEventAddSheet() {
  const overlay = document.getElementById('event-add-overlay');
  if (overlay) overlay.style.display = 'none';
  eaClosePad();
}
// Family member profiles: let whoever's adding an event on the wall tag it
// for a person, so it colour-codes by owner. Row stays hidden unless the
// household has set up profiles.
function eaLoadOwners() {
  const row = document.getElementById('ea-owner-row');
  const sel = document.getElementById('ea-owner');
  if (!row || !sel) return;
  const profiles = Array.isArray(state.profiles) ? state.profiles : [];
  if (!profiles.length) { row.hidden = true; sel.innerHTML = ''; return; }
  row.hidden = false;
  sel.innerHTML = `<option value="">Everyone</option>` +
    profiles.map(p => `<option value="${p.id}">${escapeHtmlD(p.name)}</option>`).join('');
  sel.value = '';
}

// ── Stroke pad for the add-event sheet (optional handwriting-to-text) ───────
let _eaStrokes = [];     // [[ {x,y,t}, ... ], ...]
let _eaStrokeT0 = 0;
let _eaPadCur = null;
function eaOpenPad() {
  document.getElementById('ea-pad-row').hidden = false;
  const hint = document.getElementById('ea-pad-hint');
  hint.textContent = 'Print a few words, then "Use this".'; hint.style.color = '';
  eaPadClear();
  eaFitPad();
}
function eaClosePad() {
  const row = document.getElementById('ea-pad-row');
  if (row) row.hidden = true;
  _eaStrokes = []; _eaPadCur = null;
}
function eaFitPad() {
  const pad = document.getElementById('ea-pad');
  if (!pad || pad.hidden) return;
  const r = pad.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  pad.width = r.width * dpr; pad.height = r.height * dpr;
  const ctx = pad.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#e8edf5';
  eaRedrawPad();
}
function eaRedrawPad() {
  const pad = document.getElementById('ea-pad');
  const ctx = pad.getContext('2d');
  const r = pad.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  for (const s of _eaStrokes) {
    ctx.beginPath();
    s.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  }
}
function eaPadClear() {
  _eaStrokes = []; _eaPadCur = null;
  const pad = document.getElementById('ea-pad');
  if (pad) { const ctx = pad.getContext('2d'); const r = pad.getBoundingClientRect(); ctx.clearRect(0, 0, r.width, r.height); }
}
async function eaRecognizePad() {
  if (!_eaStrokes.length) return;
  const hint = document.getElementById('ea-pad-hint');
  const doneBtn = document.getElementById('ea-pad-done');
  hint.style.color = ''; hint.textContent = 'Reading…';
  doneBtn.disabled = true;
  try {
    let text = '';
    // On-device first if the platform actually supports it (ChromeOS / some
    // Windows builds). Raspberry Pi OS does not, so this quietly falls through.
    if ('createHandwritingRecognizer' in navigator) {
      try {
        const sup = await navigator.queryHandwritingRecognizerSupport({ languages: ['en'] });
        if (sup && sup.languages) {
          const rec = await navigator.createHandwritingRecognizer({ languages: ['en'] });
          const drawing = rec.startDrawing({ recognitionType: 'text', inputType: 'touch' });
          for (const s of _eaStrokes) {
            const hs = new HandwritingStroke();
            for (const p of s) hs.addPoint({ x: p.x, y: p.y, t: p.t });
            drawing.addStroke(hs);
          }
          const preds = await drawing.getPrediction();
          text = preds && preds.length ? preds[0].text : '';
          rec.finish && rec.finish();
        }
      } catch {}
    }
    if (!text) {
      const r = await fetch('/api/handwriting/recognize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes: _eaStrokes }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not read that.');
      text = (j.text || '').trim();
    }
    if (!text) { hint.style.color = '#ff9b9b'; hint.textContent = 'Nothing recognized — try again, or type it.'; doneBtn.disabled = false; return; }
    const title = document.getElementById('ea-title');
    title.value = title.value ? (title.value.trim() + ' ' + text) : text;
    eaClosePad();
    try { title.focus(); } catch {}
  } catch (e) {
    hint.style.color = '#ff9b9b'; hint.textContent = e.message || 'Could not read that.';
  } finally {
    doneBtn.disabled = false;
  }
}
async function submitEventAddSheet() {
  if (_eaSaving) return;
  const err = document.getElementById('ea-error');
  const showErr = (m) => { err.textContent = m; err.style.display = 'block'; };
  const title = document.getElementById('ea-title').value.trim();
  const date = document.getElementById('ea-date').value;
  const endDateRaw = document.getElementById('ea-enddate').value;
  const allDay = document.getElementById('ea-allday').checked;
  const start = document.getElementById('ea-start').value;
  const end = document.getElementById('ea-end').value;
  if (!title) return showErr('Give the event a title.');
  if (!date) return showErr('Pick a date.');
  if (endDateRaw && endDateRaw < date) return showErr('The end date is before the start date.');
  if (!allDay && start && end && end < start) return showErr('The end time is before the start time.');
  const targetRow = document.getElementById('ea-target-row');
  const targetSel = document.getElementById('ea-target');
  const payload = {
    title,
    date,
    end_date: endDateRaw || null,
    start_time: allDay ? null : (start || null),
    end_time: allDay ? null : (end || null),
  };
  if (targetRow && !targetRow.hidden && targetSel && targetSel.value) payload.target_calendar = targetSel.value;
  const ownerSel = document.getElementById('ea-owner');
  if (ownerSel && ownerSel.value) payload.owner_profile_id = Number(ownerSel.value) || null;
  const locInput = document.getElementById('ea-location');
  if (locInput && locInput.value.trim()) payload.location = locInput.value.trim();
  _eaSaving = true;
  const saveBtn = document.getElementById('ea-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Adding…';
  try {
    const r = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      let msg = 'Could not save the event.';
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    closeEventAddSheet();
    try { await fetchEvents(); renderLayout(); } catch {}
  } catch (e) {
    _eaSaving = false;
    saveBtn.disabled = false; saveBtn.textContent = 'Add event';
    showErr(e.message || 'Could not save the event.');
  }
}
function wireEventAddSheet() {
  const overlay = document.getElementById('event-add-overlay');
  if (!overlay || overlay._wired) return;
  overlay._wired = true;
  document.getElementById('event-add-close').addEventListener('click', closeEventAddSheet);
  document.getElementById('ea-cancel').addEventListener('click', closeEventAddSheet);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEventAddSheet(); });
  document.getElementById('ea-allday').addEventListener('change', (e) => {
    document.getElementById('ea-time-row').style.display = e.target.checked ? 'none' : '';
  });
  document.getElementById('ea-save').addEventListener('click', submitEventAddSheet);
  document.getElementById('ea-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitEventAddSheet(); }
  });

  // Handwriting stroke pad
  document.getElementById('ea-write-btn').addEventListener('click', eaOpenPad);
  document.getElementById('ea-pad-clear').addEventListener('click', eaPadClear);
  document.getElementById('ea-pad-cancel').addEventListener('click', () => {
    eaClosePad();
    try { document.getElementById('ea-title').focus(); } catch {}
  });
  document.getElementById('ea-pad-done').addEventListener('click', eaRecognizePad);
  const pad = document.getElementById('ea-pad');
  const padPt = (ev) => {
    const r = pad.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, t: Math.round(performance.now() - _eaStrokeT0) };
  };
  pad.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    try { pad.setPointerCapture(ev.pointerId); } catch {}
    if (!_eaStrokes.length) _eaStrokeT0 = performance.now();
    _eaPadCur = [padPt(ev)];
    _eaStrokes.push(_eaPadCur);
  });
  pad.addEventListener('pointermove', (ev) => {
    if (!_eaPadCur) return;
    _eaPadCur.push(padPt(ev));
    eaRedrawPad();
  });
  const eaEndStroke = () => { _eaPadCur = null; };
  pad.addEventListener('pointerup', eaEndStroke);
  pad.addEventListener('pointercancel', eaEndStroke);
  pad.addEventListener('pointerleave', eaEndStroke);
}

// Long-press (~500ms, near-stationary) on a calendar widget's day cell opens
// the add-event sheet for that date. Stationary by design so it never fights
// the horizontal-swipe navigation on the same element (that needs >40px of
// travel). Presses that land on an event pill are left alone — those open
// the read-only detail on tap.
function wireCalCellLongPress() {
  if (typeof EMBEDDED_THUMBNAIL !== 'undefined' && EMBEDDED_THUMBNAIL) return;
  document.querySelectorAll('.w-minical[data-widget-id]').forEach(cal => {
    if (cal._addWired) return;
    cal._addWired = true;
    let timer = null, sx = 0, sy = 0, targetDate = null, fired = false;
    const reset = () => { clearTimeout(timer); timer = null; targetDate = null; fired = false; };
    cal.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.mc-cell[data-date]');
      if (!cell || e.target.closest('[data-event-key]')) { reset(); return; }
      sx = e.clientX; sy = e.clientY; targetDate = cell.dataset.date; fired = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        fired = true;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch {} }
        openEventAddSheet(targetDate);
      }, 500);
    });
    cal.addEventListener('pointermove', (e) => {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) reset();
    });
    cal.addEventListener('pointerup', (e) => {
      if (fired) { e.stopPropagation(); e.preventDefault(); }
      reset();
    });
    cal.addEventListener('pointercancel', reset);
    cal.addEventListener('pointerleave', reset);
  });
}
// Delegated, idempotent — same re-wire-on-every-render pattern as
// wireChoreChartTaps() etc. elsewhere in this file. Listens on each
// rendered widget root rather than one document-level listener, since
// that's the granularity rerenderSingleWidget() re-wires at.
function wireEventDetailTaps() {
  document.querySelectorAll('[data-event-key]').forEach(el => {
    if (el._eventTapWired) return;
    el._eventTapWired = true;
    el.addEventListener('click', (e) => {
      // In Live Edit, a tap on an event is the person trying to grab the
      // widget, not open the event — let it bubble to widget selection.
      if (editModeActive) return;
      e.stopPropagation();
      // Which widget was this opened from — so the detail popup's location
      // line matches that widget's own Show Location / per-feed override.
      const host = el.closest('[data-widget-id]');
      const openerWidget = host ? (state.layout || []).find(x => String(x.id) === String(host.dataset.widgetId)) : null;
      openEventDetail(el.dataset.eventKey, openerWidget);
    });
  });
}

// Chalkboard's cells render with a transparent background (see
// body[data-theme="chalkboard"] .mc-cell), showing the page's own dark
// slate straight through. A low-alpha color that reads clearly against a
// light/white cell background — every other theme — can be genuinely hard
// to perceive against that dark one, with nothing about eventPillColor()'s
// own math being wrong (proven correct with real output, more than once in
// this file's history). This recomputes the SAME already-resolved
// color+opacity from eventPillColor(), capped to a legibility-safe max
// alpha under Chalkboard specifically, so different opacity settings stay
// visibly, unmistakably different there. On every other theme this is a
// harmless passthrough — returns the exact rgba/hex eventPillColor() itself
// produced, untouched.
// Raised once already from an initial 0.35 cap, which was mathematically
// correct but still too subtle to read as "doing anything" at a glance —
// full opacity range only spanned ~0.07 to 0.35 alpha. 0.65 gives real
// separation while staying short of the full-strength 1.0 every other
// theme gets, keeping Chalkboard's own softer look.
const CHALKBOARD_MAX_ALPHA = 0.65;
function chalkboardAwareColor(e, widget) {
  const color = eventPillColor(e, widget);
  if (document.body.dataset.theme !== 'chalkboard') return color;
  let r = 74, g = 144, b = 217, a = 1; // fallback: the same default blue eventPillColor() itself falls back to
  const rgbaMatch = /rgba?\(([^)]+)\)/.exec(color);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map(s => parseFloat(s));
    if (parts.length >= 3) { [r, g, b] = parts; if (parts.length > 3) a = parts[3]; }
  } else {
    const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color || '');
    if (hexMatch) {
      let h = hexMatch[1];
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    }
  }
  const cappedAlpha = Math.max(0, Math.min(1, a)) * CHALKBOARD_MAX_ALPHA;
  return `rgba(${r}, ${g}, ${b}, ${cappedAlpha.toFixed(3)})`;
}
// Used by the 'highlight' full-day pill and the 'bar' multi-day style,
// where the CSS declaration is a `background`. .mc-ev-pill has a
// competing stylesheet rule (background:transparent !important) that this
// needs to beat — inline !important wins that tie on specificity.
// .mc-span-bar has no such competing rule, so the !important there is
// harmless (nothing to beat; same output either way) — kept anyway so this
// stays one shared implementation instead of two near-identical ones.
function eventPillBackgroundStyle(e, widget) {
  const color = chalkboardAwareColor(e, widget);
  const impt = document.body.dataset.theme === 'chalkboard' ? ' !important' : '';
  return `background:${color}${impt}`;
}
// Used wherever the color is needed as a bare value rather than a full
// `background:` declaration — the 'stripe' style's border-left and title
// label, and the 'line' style's underline background. None of these have
// a competing stylesheet rule to beat, so no !important is needed or added
// here; chalkboardAwareColor()'s alpha cap is what actually matters for
// these, for the exact same low-alpha-on-dark-background reason as the
// pill and bar.
function eventPillBorderColor(e, widget) {
  return chalkboardAwareColor(e, widget);
}

// Returns a source identifier for an event: 'local' for manually-added events,
// or the iCal feed's id for subscribed-calendar events.
function eventSourceId(e) {
  return e.source === 'ical' ? ('feed:' + e.feed_id) : 'local';
}

// Distinct list of subscribed iCal feeds currently visible in state.events —
// derived from events already in memory (each carries feed_id/feed_name/
// color/color_opacity, see the SELECT in server.js's /api/events) rather
// than a separate fetch just for this. Used only by the per-widget feed-
// opacity-override settings section below; if a feed has no events in the
// currently-loaded window it simply won't appear here until it does — an
// acceptable tradeoff for a settings-panel convenience list, not something
// that affects actual rendering anywhere.
function distinctFeedsFromEvents() {
  const byId = new Map();
  (state.events || []).forEach(e => {
    if (e.source !== 'ical' || e.feed_id == null || byId.has(e.feed_id)) return;
    byId.set(e.feed_id, { id: e.feed_id, name: e.feed_name || `Feed ${e.feed_id}`, color: e.color || '#4A90D9',
      color_opacity: e.color_opacity ?? 100, show_location: e.show_location === 1 || e.show_location === true });
  });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Should this event's LOCATION show, in this widget? Three layers, resolved
// here so every render path (agenda rows, grid cells, standalone Agenda/
// Upcoming/Today) agrees:
//   1. per-widget-per-feed override — widget.feedLocationOverride[feedId] is
//      true/false and is the MOST specific instruction: it wins over both the
//      feed default and this widget's own master toggle (matching how the
//      per-feed opacity override behaves — a deliberate "force on/off here").
//   2. widget master — the widget's own "Show Location" toggle (masterOn)
//   3. feed default  — ical_feeds.show_location (arrives as e.show_location);
//                      local events have no feed and always count as "on"
function widgetShowsLocation(e, widget, masterOn) {
  if (!e || !e.location) return false;
  const ov = widget && widget.feedLocationOverride;
  if (ov && e.feed_id != null && typeof ov[e.feed_id] === 'boolean') return ov[e.feed_id];
  if (!masterOn) return false;
  return e.source === 'local' ? true : (e.show_location === 1 || e.show_location === true);
}

// ── Per-widget feed opacity override — shared by every widget type that
// shows a feed's color (Mini Calendar, Agenda, Upcoming, Today). One
// render+wire pair here rather than duplicating this section four times;
// each widget's own settings function just calls these two with itself.
// Data shape: widget.feedOpacityOverride = { [feedId]: percentage }. A
// feed absent from this map falls back to its own global opacity (set in
// the Calendar Feeds section) — see eventPillColor()'s own doc comment
// for the full two-tier resolution.
function renderFeedOpacityOverrideSection(w) {
  const feeds = distinctFeedsFromEvents();
  if (!feeds.length) return '';
  const overrides = w.feedOpacityOverride || {};
  const inner = `
    <p style="font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 10px">Override a calendar's opacity for just this widget, without changing its global default in Calendar Feeds.</p>
    ${feeds.map(f => {
      const hasOverride = overrides[f.id] !== undefined && overrides[f.id] !== null;
      const val = hasOverride ? overrides[f.id] : f.color_opacity;
      return `
      <div class="was-row fop-row" data-feed-id="${f.id}" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <label style="margin-bottom:0;display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;border-radius:50%;background:${f.color};display:inline-block;flex-shrink:0"></span>
            ${escapeHtmlD(f.name)}
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(255,255,255,0.55);cursor:pointer">
            Override
            <input type="checkbox" class="fop-toggle" data-feed-id="${f.id}" ${hasOverride?'checked':''} style="width:16px;height:16px;accent-color:var(--accent)">
          </label>
        </div>
        <div class="was-range-row fop-slider-row" style="${hasOverride?'':'display:none'}">
          <input type="range" class="fop-slider" data-feed-id="${f.id}" min="10" max="100" step="5" value="${val}">
          <span class="was-range-val fop-slider-val" data-feed-id="${f.id}">${val}%</span>
        </div>
      </div>`;
    }).join('')}
  `;
  return `<div id="fop-accordion-wrap">${accordionSection({ id: 'fop', icon: '🎨', label: 'Per-Feed Opacity', sub: 'this display only', inner })}</div>`;
}
function wireFeedOpacityOverrideSection(w) {
  wireAccordion('fop-accordion-wrap');
  document.querySelectorAll('.fop-toggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const feedId = e.target.dataset.feedId;
      const row = document.querySelector(`.fop-row[data-feed-id="${feedId}"]`);
      const sliderRow = row ? row.querySelector('.fop-slider-row') : null;
      w.feedOpacityOverride = w.feedOpacityOverride || {};
      if (e.target.checked) {
        if (sliderRow) sliderRow.style.display = '';
        const slider = row.querySelector('.fop-slider');
        w.feedOpacityOverride[feedId] = parseInt(slider.value, 10);
      } else {
        if (sliderRow) sliderRow.style.display = 'none';
        delete w.feedOpacityOverride[feedId];
      }
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  });
  document.querySelectorAll('.fop-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const feedId = e.target.dataset.feedId;
      // Same guard as app.html's copy of this function — the slider's row
      // is only visually hidden (display:none) when this feed's override
      // checkbox is off, which isn't a hard guarantee against this handler
      // still firing. Read the checkbox directly and bail if unchecked.
      const toggle = document.querySelector(`.fop-toggle[data-feed-id="${feedId}"]`);
      if (!toggle || !toggle.checked) return;
      const val = parseInt(e.target.value, 10);
      w.feedOpacityOverride = w.feedOpacityOverride || {};
      w.feedOpacityOverride[feedId] = val;
      const label = document.querySelector(`.fop-slider-val[data-feed-id="${feedId}"]`);
      if (label) label.textContent = val + '%';
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  });
}

// Per-widget-per-feed LOCATION override — same shape as the opacity override
// above, but the overridden value is a plain show/hide. widget.feedLocationOverride
// = { [feedId]: true|false }; a feed absent from the map follows its own global
// "Show location" setting from Calendar Feeds. See widgetShowsLocation().
function renderFeedLocationOverrideSection(w) {
  const feeds = distinctFeedsFromEvents();
  if (!feeds.length) return '';
  const overrides = w.feedLocationOverride || {};
  const inner = `
    <p style="font-size:11px;color:rgba(255,255,255,0.5);margin:0 0 10px">Force a calendar's location on or off for just this widget — wins over both its global "Show location" in Calendar Feeds and this widget's own Show Location toggle.</p>
    ${feeds.map(f => {
      const has = typeof overrides[f.id] === 'boolean';
      const val = has ? overrides[f.id] : f.show_location;
      return `
      <div class="was-row flo-row" data-feed-id="${f.id}" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <label style="margin-bottom:0;display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;border-radius:50%;background:${f.color};display:inline-block;flex-shrink:0"></span>
            ${escapeHtmlD(f.name)}
            <span style="font-size:10px;color:rgba(255,255,255,0.4)">${f.show_location ? 'on' : 'off'} globally</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(255,255,255,0.55);cursor:pointer">
            Override
            <input type="checkbox" class="flo-toggle" data-feed-id="${f.id}" ${has?'checked':''} style="width:16px;height:16px;accent-color:var(--accent)">
          </label>
        </div>
        <div class="was-row flo-value-row" style="${has?'':'display:none'}">
          <select class="flo-value" data-feed-id="${f.id}">
            <option value="1" ${val?'selected':''}>Show location here</option>
            <option value="0" ${!val?'selected':''}>Hide location here</option>
          </select>
        </div>
      </div>`;
    }).join('')}
  `;
  return `<div id="flo-accordion-wrap">${accordionSection({ id: 'flo', icon: '📍', label: 'Per-Feed Location', sub: 'this widget only', inner })}</div>`;
}
function wireFeedLocationOverrideSection(w) {
  wireAccordion('flo-accordion-wrap');
  document.querySelectorAll('.flo-toggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const feedId = e.target.dataset.feedId;
      const row = document.querySelector(`.flo-row[data-feed-id="${feedId}"]`);
      const valRow = row ? row.querySelector('.flo-value-row') : null;
      w.feedLocationOverride = w.feedLocationOverride || {};
      if (e.target.checked) {
        if (valRow) valRow.style.display = '';
        const sel = row.querySelector('.flo-value');
        w.feedLocationOverride[feedId] = sel.value === '1';
      } else {
        if (valRow) valRow.style.display = 'none';
        delete w.feedLocationOverride[feedId];
      }
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  });
  document.querySelectorAll('.flo-value').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const feedId = e.target.dataset.feedId;
      const toggle = document.querySelector(`.flo-toggle[data-feed-id="${feedId}"]`);
      if (!toggle || !toggle.checked) return;
      w.feedLocationOverride = w.feedLocationOverride || {};
      w.feedLocationOverride[feedId] = e.target.value === '1';
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  });
}

// Applies a widget's content filters (which calendars to show, whether to include
// ongoing multi-day events) to a list of events. Shared by Mini Calendar, Upcoming,
// and Today so behavior stays consistent across all three.
function filterEventsForWidget(events, widget) {
  let result = events;

  // sourceFilter: array of source ids to include. Absent/null = show everything.
  if (widget && Array.isArray(widget.sourceFilter) && widget.sourceFilter.length) {
    const allowed = new Set(widget.sourceFilter);
    result = result.filter(e => allowed.has(eventSourceId(e)));
  }

  // showMultiDay: defaults to true. When false, hide events that span multiple days.
  const showMultiDay = !widget || widget.showMultiDay !== false;
  if (!showMultiDay) {
    result = result.filter(e => !(e.end_date && e.end_date > e.date));
  }

  // pastEvents: 'show' (default) | 'hide' | 'dim'. When 'hide', drop events whose
  // date is before today. 'dim' keeps them (the renderer greys them via a class).
  const pastMode = (widget && widget.pastEvents) || 'show';
  if (pastMode === 'hide') {
    const today = todayStr();
    result = result.filter(e => (e.end_date || e.date) >= today);
  }

  return result;
}

// Whether an event is in the past (ended before today). Used by renderers to
// apply a dimmed style when a widget's pastEvents mode is 'dim'.
function isPastEvent(e) {
  return (e.end_date || e.date) < todayStr();
}

function renderMiniCal(widget) {
  const layoutMode = (widget && widget.calLayout) || 'grid'; // 'grid'|'agenda'|'strip'
  if (layoutMode === 'agenda') return renderMiniCalAgenda(widget);
  if (layoutMode === 'strip')  return renderMiniCalStrip(widget);
  return renderMiniCalGrid(widget);
}

function renderMiniCalGrid(widget) {
  const view = (widget && widget.calView) || 'month'; // '1week'|'2week'|'3week'|'4week'|'month'
  const fontPx = (widget && widget.calFontPx) || 11; // base font size in px
  // Per-widget override: 'default' (or unset) follows the display-wide Settings
  // value; '0'/'1' pins this specific calendar to Sunday/Monday regardless.
  const wsdOverride = (widget && widget.calWeekStart && widget.calWeekStart !== 'default') ? parseInt(widget.calWeekStart, 10) : undefined;
  // calWrap: false/'off' = single line; true/'on' = wrap unlimited; 'clamp2' = wrap, max 2 lines
  const wrapMode = (widget && widget.calWrap === 'clamp2') ? 'clamp2'
                 : (widget && (widget.calWrap === true || widget.calWrap === 'on')) ? 'on' : 'off';
  const wrapText = wrapMode !== 'off';
  const wrapClass = wrapMode === 'clamp2' ? ' cal-wrap2' : wrapMode === 'on' ? ' cal-wrap' : '';
  const dimPastDays = !!(widget && widget.calDimPast);
  const calDecor = (widget && widget.calDecor) || 'none'; // 'none'|'postit'|'icon:NAME'
  const decorIcon = calDecor.startsWith('icon:') ? CAL_DECOR_ICONS[calDecor.slice(5)] : null;
  const isPostit = calDecor === 'postit';
  const widgetEvents = filterEventsForWidget(state.events, widget);
  // How multi-day (spanning) events are drawn — 'bar' is the original
  // Google-Calendar-style continuous bar; the other three are lighter-
  // weight alternatives for a calendar with lots of single-day entries
  // already competing for cell space. See each style's own comment further
  // down for what it actually does.
  const multiDayStyle = (widget && widget.calMultiDayStyle) || 'bar';

  const now = new Date();
  const todayStr2 = todayStr();

  // Swipe/tap navigation (Phase 2, extended) — a LOCAL, in-memory offset
  // only, not saved anywhere: this is temporary browsing ("what's next month
  // look like"), not a change to the widget's own configuration. Resets on
  // reload, and auto-resets back to the current window after a period of no
  // further navigation (see scheduleMiniCalAutoReset()/MINICAL_AUTO_RESET_MS
  // above) so the display doesn't end up permanently stuck showing some
  // other time range. Originally month-view only; now covers the week views
  // too — each "next"/"previous" step there pages by the view's own window
  // width (e.g. a 2-week view pages two weeks at a time), since unlike
  // month view there's no single natural "next/previous" unit smaller than
  // the window itself.
  const widgetId = widget && widget.id;
  const periodOffset = (widgetId != null) ? (miniCalOffsets[widgetId] || 0) : 0;

  // Build the list of calendar cell dates
  let cellDates = [];
  let headerLabel = '';

  if (view === 'month') {
    const effective = new Date(now.getFullYear(), now.getMonth() + periodOffset, 1);
    const year = effective.getFullYear(), month = effective.getMonth();
    const first = dayIndexForWeekStart(new Date(year, month, 1), wsdOverride);
    const last  = new Date(year, month + 1, 0).getDate();
    const prevLast = new Date(year, month, 0).getDate();
    for (let i = first - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevLast - i);
      cellDates.push({ date: d, other: true });
    }
    for (let d = 1; d <= last; d++) cellDates.push({ date: new Date(year, month, d), other: false });
    const filled = first + last, trail = filled % 7 === 0 ? 0 : 7 - (filled % 7);
    for (let i = 1; i <= trail; i++) cellDates.push({ date: new Date(year, month + 1, i), other: true });
    const monthLabel = `<span class="mc-month">${MONTHS[month]}</span><span class="mc-year">${year}</span>`;
    headerLabel = miniCalNavHtml(widgetId, periodOffset, monthLabel, 'month');
  } else {
    const weeks = { '1week':1, '2week':2, '3week':3, '4week':4 }[view] || 1;
    // Start from the configured start of the current week (Sunday or Monday),
    // then page the whole window (weeks * 7 days) per nav step.
    const start = new Date(now);
    start.setDate(now.getDate() - dayIndexForWeekStart(now, wsdOverride) + periodOffset * weeks * 7);
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cellDates.push({ date: d, other: d.getMonth() !== now.getMonth() });
    }
    const endDate = new Date(start); endDate.setDate(start.getDate() + weeks*7 - 1);
    const sameMonth = start.getMonth() === endDate.getMonth();
    const rangeLabel = sameMonth
      ? `<span class="mc-month">${MONTHS[start.getMonth()]}</span><span class="mc-year">${start.getFullYear()}</span>`
      : `<span class="mc-month">${monthDayLabel(start, widget.calDateFormat || globalDateFormat())} – ${monthDayLabel(endDate, widget.calDateFormat || globalDateFormat())}</span><span class="mc-year">${endDate.getFullYear()}</span>`;
    headerLabel = miniCalNavHtml(widgetId, periodOffset, rangeLabel, 'week');
  }

  const numRows = cellDates.length / 7;
  const dateStrs = cellDates.map(c => `${c.date.getFullYear()}-${pad(c.date.getMonth()+1)}-${pad(c.date.getDate())}`);
  const gridStartStr = dateStrs[0];
  const gridEndStr = dateStrs[dateStrs.length - 1];

  // Split events into multi-day spans vs single-day events
  const spanEvents = [];
  const singleDayByDate = {};
  widgetEvents.forEach(e => {
    const isSpan = e.end_date && e.end_date > e.date;
    // Skip events entirely outside the visible grid range
    const evEnd = e.end_date || e.date;
    if (evEnd < gridStartStr || e.date > gridEndStr) return;

    if (isSpan) spanEvents.push(e);
    else (singleDayByDate[e.date] = singleDayByDate[e.date] || []).push(e);
  });

  // For the three non-bar styles: which span events touch each visible date,
  // and whether that date is the event's REAL start/end (not just where a
  // week-row segment happens to begin/end) — 'line' needs this to label only
  // the actual start day, and 'stripe'/'dot' read naturally regardless of
  // where a week boundary falls.
  const spanTouchByDate = {};
  if (multiDayStyle !== 'bar') {
    spanEvents.forEach(e => {
      const evEndDate = e.end_date || e.date;
      dateStrs.forEach(ds => {
        if (ds >= e.date && ds <= evEndDate) {
          (spanTouchByDate[ds] = spanTouchByDate[ds] || []).push({
            event: e, isStart: ds === e.date, isEnd: ds === evEndDate,
          });
        }
      });
    });
  }

  // Build per-week spanning bar rows. Each week (row of 7) gets its own set of
  // bars, since a multi-day event crossing a week boundary needs to restart
  // visually on the next row (like Google Calendar / DAKboard).
  const weeksCount = numRows;
  const barsByWeek = Array.from({length: weeksCount}, () => []); // each: {event, startCol, span, lane}

  spanEvents.forEach(e => {
    const evStart = e.date < gridStartStr ? gridStartStr : e.date;
    const evEnd   = (e.end_date > gridEndStr ? gridEndStr : e.end_date);
    const startIdx = dateStrs.indexOf(evStart);
    const endIdx   = dateStrs.indexOf(evEnd);
    if (startIdx === -1 || endIdx === -1) return;

    // Walk week by week, clipping the bar segment to each week's 7-day row
    for (let week = Math.floor(startIdx / 7); week <= Math.floor(endIdx / 7); week++) {
      const weekStart = week * 7, weekEnd = week * 7 + 6;
      const segStart = Math.max(startIdx, weekStart);
      const segEnd   = Math.min(endIdx, weekEnd);
      barsByWeek[week].push({
        event: e,
        startCol: segStart - weekStart, // 0-6
        span: segEnd - segStart + 1,    // number of days this segment covers
      });
    }
  });

  // Assign each bar a "lane" (vertical stacking slot) within its week so overlapping
  // events don't collide — simple greedy first-fit.
  let maxLanesAnyWeek = 0;
  barsByWeek.forEach(weekBars => {
    weekBars.sort((a, b) => a.startCol - b.startCol);
    const laneEnds = []; // laneEnds[lane] = last occupied column+1 in that lane
    weekBars.forEach(bar => {
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] > bar.startCol) lane++;
      bar.lane = lane;
      laneEnds[lane] = bar.startCol + bar.span;
    });
    maxLanesAnyWeek = Math.max(maxLanesAnyWeek, laneEnds.length);
  });
  const visibleLanes = Math.min(maxLanesAnyWeek, 3); // cap so we don't eat the whole cell; overflow shown as "+more"

  // Render spanning bars as an absolutely-positioned overlay grid matching the day grid.
  // Each bar sits just below the day-number circle, then stacks downward per lane.
  const barHtml = barsByWeek.flatMap((weekBars, week) =>
    weekBars
      .filter(bar => bar.lane < visibleLanes)
      .map(bar => `
        <div class="mc-span-bar" style="
          grid-row: ${week + 1};
          grid-column: ${bar.startCol + 1} / span ${bar.span};
          margin-top: calc(var(--cal-font) * 2 + 5px + ${bar.lane} * (var(--cal-font) * 1.5 + 2px));
          ${eventPillBackgroundStyle(bar.event, widget)};
        ">${escapeHtmlD(bar.event.title)}</div>
      `)
  ).join('');

  // Sticker badges: opt-in (calShowStickers) — one badge per kid per day,
  // regardless of how many stickers that kid earned that day (a badge means
  // "earned at least one," not a count — the sticker sheet in app.html/
  // kids.html is where the actual count/history lives). Built once here
  // rather than inside the per-cell map below so a day with many kids
  // isn't re-filtering the entire stickers array once per kid per cell.
  const showStickers = !!(widget && widget.calShowStickers);
  const stickerPos = (widget && widget.calStickerPosition) || 'top-right';
  // Default size matches the day-number circle's own diameter exactly
  // (.mc-daynum is calc(var(--cal-font) * 2), and --cal-font is already
  // fontPx * ui-scale) — badges should read as visually equal-weight to the
  // day number, not an afterthought, unless a family deliberately shrinks
  // them via the widget's Sticker Size slider. Always expressed through
  // --ui-scale like every other pixel-based value on this screen, so it
  // stays correctly sized on any resolution without needing a re-render.
  const stickerSizePx = (widget && widget.calStickerSizePx) || Math.round(fontPx * 2);
  const stickerSizeExpr = `calc(${stickerSizePx}px * var(--ui-scale,1))`;
  const stickerKidsByDate = {};
  if (showStickers && state.stickers && state.stickers.length) {
    const kidById = {};
    ((state.choreChart && state.choreChart.kids) || []).forEach(k => { kidById[k.id] = k; });
    state.stickers.forEach(s => {
      if (s.date < gridStartStr || s.date > gridEndStr) return;
      const kid = kidById[s.kid_id];
      if (!kid) return;
      const bucket = stickerKidsByDate[s.date] || (stickerKidsByDate[s.date] = new Map());
      bucket.set(kid.id, kid); // Map dedupes to one entry per kid regardless of sticker count
    });
  }
  const stickerBadgesHtml = (ds) => {
    const kidsMap = stickerKidsByDate[ds];
    if (!kidsMap || !kidsMap.size) return '';
    const badges = [...kidsMap.values()].map(k => stickerBadgeHtmlD(k, stickerSizeExpr)).join('');
    return `<div class="mc-sticker-badges pos-${stickerPos}">${badges}</div>`;
  };

  // Reminder badges: same opt-in pattern as stickers just above (calShowReminders,
  // default off) — a small emoji per reminder that occurs on that date, using the
  // exact same reminderOccursOnDate() every other reminder surface in this app
  // reads from, so this can never disagree with the Reminders widget or Agenda
  // about what's due. Defaults to the OPPOSITE corner from stickers (top-left vs.
  // top-right) so the two badge systems don't visually collide if a household
  // uses both on the same calendar; each still has its own position setting if
  // that default doesn't fit.
  const showReminderBadges = !!(widget && widget.calShowReminders);
  const reminderBadgePos = (widget && widget.calReminderPosition) || 'top-left';
  const reminderBadgeSizePx = (widget && widget.calReminderSizePx) || Math.round(fontPx * 1.4);
  const reminderBadgeSizeExpr = `calc(${reminderBadgeSizePx}px * var(--ui-scale,1))`;
  const reminderTextScale = ((widget && widget.calReminderTextSizePct) || 100) / 100;
  const activeReminders = showReminderBadges ? (state.reminders || []).filter(r => r.active !== 0) : [];
  const reminderBadgesHtml = (ds) => {
    if (!activeReminders.length) return '';
    const matches = activeReminders.filter(r => reminderOccursOnDate(r, ds));
    if (!matches.length) return '';
    const badges = matches.map(r => `<span class="mc-reminder-badge" style="font-size:${reminderBadgeSizeExpr}" title="${escapeHtmlD(r.name)}">${reminderIconHtml(r, reminderTextScale)}</span>`).join('');
    return `<div class="mc-reminder-badges pos-${reminderBadgePos}">${badges}</div>`;
  };

  // Weather-on-calendar: opt-in (calShowWeather, default off). Reuses
  // whichever forecast the household's default weather location already has
  // cached (weatherForWidget falls back to state.weather when this widget
  // has no wxLat/wxLon of its own, which minical widgets never set today) —
  // no separate fetch, no per-calendar location setting to configure. Only
  // days the forecast API's daily window actually covers (today + however
  // many days out it returns) get anything; a day further out, or in the
  // past, just shows no weather cue.
  const showWeather = !!(widget && widget.calShowWeather);
  const weatherStyle = (widget && widget.calWeatherStyle) || 'badge'; // 'badge'|'row'|'icon' — content only, not position
  // Position — one field, 4 values, shared by all three styles.
  // top-left/top-right: inline on .mc-daynum's own row (see .mc-day-toprow).
  // bottom-left/bottom-right: their own row at the foot of the cell.
  const weatherPos = (widget && widget.calWeatherPosition) || 'top-right';
  const weatherIsTop = showWeather && (weatherPos === 'top-left' || weatherPos === 'top-right');
  const weatherIsBottomLeft = showWeather && weatherPos === 'bottom-left';
  const weatherIsBottomRight = showWeather && weatherPos === 'bottom-right';
  const weatherIconSizePx = (widget && widget.calWeatherSizePx) || Math.round(fontPx * 1.4);
  const weatherIconSizeExpr = `calc(${weatherIconSizePx}px * var(--ui-scale,1))`;
  const weatherByDate = {};
  if (showWeather) {
    const wx = weatherForWidget(widget);
    const daily = wx && wx.daily;
    if (daily && Array.isArray(daily.time)) {
      daily.time.forEach((t, idx) => {
        const code = daily.weather_code ? daily.weather_code[idx] : undefined;
        if (code === undefined) return;
        weatherByDate[t] = { code, hi: Math.round(daily.temperature_2m_max[idx]), lo: Math.round(daily.temperature_2m_min[idx]) };
      });
    }
  }
  const weatherIconSpan = (code, cls, sizeExpr) => `<span class="${cls}" style="width:${sizeExpr};height:${sizeExpr}">${weatherSVG(code)}</span>`;
  const weatherContentHtml = (ds) => {
    const w = weatherByDate[ds];
    if (!w) return '';
    const title = ` title="${escapeHtmlD(WMO_DESC[w.code]||'')}"`;
    if (weatherStyle === 'badge') return `<span class="mc-wx-chip"${title}>${weatherIconSpan(w.code, 'mc-wx-icon', weatherIconSizeExpr)}<span>${w.hi}°</span></span>`;
    if (weatherStyle === 'row') return `<span class="mc-wx-row"${title}>${weatherIconSpan(w.code, 'mc-wx-icon', weatherIconSizeExpr)}<span class="mc-wx-temps"><b>${w.hi}°</b>/${w.lo}°</span></span>`;
    return weatherIconSpan(w.code, 'mc-wx-icon-solo', weatherIconSizeExpr); // 'icon'
  };

  const cellsHtml = cellDates.map((c, i) => {
    const ds = dateStrs[i];
    const isToday = ds === todayStr2;
    const isPast = dimPastDays && ds < todayStr2;
    // Only reserve spacer height for lanes whose bar segment actually covers THIS
    // day's column — not just any day in the week. A multi-day event later in the
    // week shouldn't push down single-day events on earlier days that it never touches.
    const week = Math.floor(i / 7);
    const col = i % 7;
    const lanesTouchingThisDay = barsByWeek[week].filter(
      b => b.lane < visibleLanes && col >= b.startCol && col < b.startCol + b.span
    );
    const lanesInWeek = lanesTouchingThisDay.length
      ? Math.max(...lanesTouchingThisDay.map(b => b.lane + 1))
      : 0;
    const reservedHeight = (multiDayStyle === 'bar' && lanesInWeek > 0) ? `calc(${lanesInWeek} * (var(--cal-font) * 1.5 + 2px))` : '0px';

    // Render ALL single-day events (not a fixed slice). A post-render pass
    // (fitCalendarCells) measures each cell and hides any that overflow, replacing
    // them with an accurate "+N more" — so long/wrapping titles never spill into the
    // next day's box. calMaxEventsPerDay still acts as an optional hard cap if set.
    const allDayEvents = (singleDayByDate[ds] || []);
    // 'dot' style: multi-day events touching this date get folded into the SAME
    // list as single-day events, rendered exactly like a colored-dot timed event
    // — so they automatically get the existing overflow/"+N more" handling for
    // free, rather than needing their own separate cap. Listed first (they were
    // planned further ahead, generally the more significant entry for the day).
    const spanTouches = spanTouchByDate[ds] || [];
    const spanDotEvents = multiDayStyle === 'dot' ? spanTouches.map(t => t.event) : [];
    const allDayEventsForDisplay = multiDayStyle === 'dot' ? [...spanDotEvents, ...allDayEvents] : allDayEvents;
    const hardCap = (widget && widget.calMaxEventsPerDay) ? widget.calMaxEventsPerDay : 0;
    const dayEvents = hardCap > 0 ? allDayEventsForDisplay.slice(0, hardCap) : allDayEventsForDisplay;
    const moreCount = allDayEventsForDisplay.length - dayEvents.length;
    const totalDayEvents = allDayEventsForDisplay.length;

    // ── Decoration styles ──
    // icon:NAME — each event line is led by the themed icon instead of the
    //   usual colored dot, e.g. "🎃 3pm Trunk-or-Treat".
    //
    // Color Coding (widget setting, default on): a master switch that hides
    // every dot/highlight on this calendar entirely when off — real report
    // that some people find the colored markers visually noisy and just
    // want plain text. Independent of each calendar's own per-feed
    // "color-code timed events" setting (color_timed) — this widget-level
    // switch overrides everything when off, regardless of what any
    // individual feed is configured to do.
    const colorCodingOn = !widget || widget.calColorCoding !== false;
    // Full-Day Event Style (widget setting, default 'highlight'/background):
    // how an all-day/multi-day event shows its color. Three mutually
    // exclusive choices — 'highlight' (colored pill background), 'dot' (a
    // marker matching a timed event's, no background), 'none' (plain text,
    // no color indicator at all, scoped to full-day events only — timed
    // events keep following colorCodingOn independently). The pill no
    // longer forces an inner dot regardless of this setting the way it used
    // to: that was a workaround for Chalkboard's pill background being
    // unconditionally transparent before beta.11/12 fixed it to actually
    // show color there too, so it's no longer needed to keep that theme
    // legible — and forcing it made "background vs dot" not actually a
    // real choice (background style always included a dot anyway).
    const fullDayColorStyle = (widget && widget.calFullDayColorStyle) || 'highlight';
    // Location in a grid day-cell follows the feed's own "Show location" by
    // default (same as Agenda) — turning it on for a calendar in Settings
    // should surface it everywhere, not just the wrapped Agenda view. It's
    // appended inline after the title and truncates with the rest of the line;
    // "Wrap Event Text" gives it its own line. Turn the widget's Show Location
    // off to suppress it here without touching the feed.
    const gridShowLoc = !widget || widget.calShowLocation !== false;
    const gridLoc = (e) => widgetShowsLocation(e, widget, gridShowLoc) ? ` <span class="mc-ev-loc">· ${escapeHtmlD(e.location)}</span>` : '';
    const evHtml = dayEvents.map(e => {
      if (e.start_time) {
        // Timed events: when the calendar has color-coding for timed events enabled
        // (the default), prefix a colored dot in the calendar's color. iCal events
        // carry a color_timed flag; local events (no flag) are always color-coded.
        // An icon decoration replaces that dot with the themed icon instead.
        const colorTimed = e.color_timed === undefined ? true : e.color_timed !== 0;
        const marker = !colorCodingOn ? '' : decorIcon
          ? `<span class="mc-ev-decor-icon">${decorIcon}</span>`
          : (colorTimed ? `<span class="mc-ev-dot" style="background:${eventPillColor(e, widget)}"></span>` : '');
        // calShowEndTime: "9:00–10:00" instead of just "9:00" — off by default
        // since Grid cells are already tight on space; only applies to timed,
        // single-day events (an all-day/multi-day event never reaches this
        // branch at all, it has no start_time).
        const timeStr = (widget && widget.calShowEndTime && e.end_time)
          ? `${fmtTime(e.start_time, widget && widget.calAmpmCase).replace(' ','')}–${fmtTime(e.end_time, widget && widget.calAmpmCase).replace(' ','')}`
          : fmtTime(e.start_time, widget && widget.calAmpmCase).replace(' ','');
        return `<div class="mc-ev-text" data-event-key="${eventDetailKey(e)}">${marker}${timeStr} ${escapeHtmlD(e.title)}${gridLoc(e)}</div>`;
      }
      // A 'dot' multi-day event has no start_time — reuses this exact same
      // colored-dot-plus-text row single-day events use, so it's visually
      // indistinguishable from them apart from spanning multiple days.
      const prefix = decorIcon ? `<span class="mc-ev-decor-icon">${decorIcon}</span>` : '';
      if (!colorCodingOn || fullDayColorStyle === 'none') {
        // Master switch off, OR this widget's Full-Day Event Style is
        // explicitly 'none': plain text, no dot, no pill background.
        return `<div class="mc-ev-text" data-event-key="${eventDetailKey(e)}">${prefix}${escapeHtmlD(e.title)}${gridLoc(e)}</div>`;
      }
      if (fullDayColorStyle === 'dot') {
        // 'dot' style: same row shape a timed event uses, no highlight.
        return `<div class="mc-ev-text" data-event-key="${eventDetailKey(e)}"><span class="mc-ev-dot" style="background:${eventPillColor(e, widget)}"></span>${prefix}${escapeHtmlD(e.title)}${gridLoc(e)}</div>`;
      }
      // 'highlight' (default): colored pill background only — no inner dot
      // anymore, see this function's own opening comment for why. Chalkboard
      // still shows a legible, capped-alpha tint here via
      // eventPillBackgroundStyle() (beta.11), and its title text now
      // correctly follows --pill-text (beta.12) instead of a hardcoded
      // color, so the pill alone carries enough contrast on its own.
      return `<div class="mc-ev-pill" data-event-key="${eventDetailKey(e)}" style="${eventPillBackgroundStyle(e, widget)}">${prefix}${escapeHtmlD(e.title)}${gridLoc(e)}</div>`;
    }).join('');
    const moreHtml = moreCount > 0 ? `<div class="mc-ev-more" data-base-more="${moreCount}">+${moreCount} more</div>` : `<div class="mc-ev-more" data-base-more="0" style="display:none"></div>`;

    // 'stripe': a colored left-edge border on the cell itself, like a day-
    // planner tab, instead of a bar competing for horizontal space. Multiple
    // overlapping multi-day events collapse to just the first one's color —
    // a real, deliberate simplification (a genuinely accurate multi-stripe
    // rendering would need meaningfully more layout work for a case that's
    // fairly rare in practice: two DIFFERENT multi-day trips/visits actually
    // overlapping on the same days).
    const stripeStyle = (multiDayStyle === 'stripe' && spanTouches.length)
      ? `border-left:3px solid ${eventPillBorderColor(spanTouches[0].event, widget)};padding-left:6px`
      : '';
    // Previously the stripe was the ONLY identifying mark of a multi-day
    // event — a colored border with no title anywhere, on any day,
    // including the start day. Same fix idea the 'line' style already
    // uses below: print the title once, only on the event's actual start
    // day (t.isStart), not on every day it spans (that's what the 'bar'
    // style is for). If more than one span touches this day, only the
    // first's title shows — consistent with the stripe itself already
    // only showing the first event's color when multiple overlap.
    const stripeStartTouch = multiDayStyle === 'stripe' ? spanTouches.find(t => t.isStart) : null;
    const stripeLabelHtml = stripeStartTouch
      ? `<div class="mc-stripe-label" style="color:${eventPillBorderColor(stripeStartTouch.event, widget)}">${escapeHtmlD(stripeStartTouch.event.title)}</div>`
      : '';
    // 'line': a thin colored underline for every day the event touches, with
    // the name printed only on its actual start day — keeps the "this is one
    // continuous thing" cue without repeating the title on every day like
    // the bar style does. Multiple overlapping events stack additional lines
    // upward from the bottom edge.
    const lineHtml = multiDayStyle === 'line' ? spanTouches.map((t, idx) => `
      <div class="mc-multi-line" style="bottom:calc(2px + ${idx} * 5px);background:${eventPillBorderColor(t.event, widget)};
        ${t.isStart ? 'border-radius:2px 0 0 2px' : ''}${t.isEnd ? (t.isStart ? '' : 'border-radius:0 2px 2px 0') : ''}"></div>
      ${t.isStart ? `<div class="mc-multi-line-label" style="bottom:calc(5px + ${idx} * 5px)">${escapeHtmlD(t.event.title)}</div>` : ''}
    `).join('') : '';

    // postit — a day with events becomes a little sticky note listing them.
    if (isPostit) {
      const noteColor = ['#fff7a8','#bfe9ff','#ffd6e0','#caffbf','#ffd8a8'][i % 5];
      const noteItems = dayEvents.map(e =>
        `<div class="mc-note-line">${e.start_time ? fmtTime(e.start_time, widget && widget.calAmpmCase).replace(' ','')+' ' : ''}${escapeHtmlD(e.title)}</div>`
      ).join('');
      const moreNote = moreCount > 0 ? `<div class="mc-note-line mc-note-more">+${moreCount} more</div>` : '';
      const note = totalDayEvents > 0
        ? `<div class="mc-note" style="--note-bg:${noteColor}">${noteItems}${moreNote}</div>`
        : `<div class="mc-note mc-note-empty" style="--note-bg:${noteColor}"></div>`;
      return `<div class="mc-cell mc-cell-postit${isPast?' past':''}${isToday?' today':''}" data-date="${ds}">
        <div class="mc-day-toprow">
          ${weatherIsTop && weatherPos === 'top-left' ? weatherContentHtml(ds) : ''}
          <div class="mc-daynum">${c.date.getDate()}</div>
          ${weatherIsTop && weatherPos === 'top-right' ? weatherContentHtml(ds) : ''}
        </div>
        ${note}
        ${weatherIsBottomLeft ? `<div class="mc-weather-bottom-row" style="justify-content:flex-start">${weatherContentHtml(ds)}</div>` : ''}
        ${weatherIsBottomRight ? `<div class="mc-weather-bottom-row" style="justify-content:flex-end">${weatherContentHtml(ds)}</div>` : ''}
        ${stickerBadgesHtml(ds)}
        ${reminderBadgesHtml(ds)}
      </div>`;
    }

    return `<div class="mc-cell${isPast?' past':''}${isToday?' today':''}" style="${stripeStyle}" data-date="${ds}">
      <div class="mc-day-toprow">
        ${weatherIsTop && weatherPos === 'top-left' ? weatherContentHtml(ds) : ''}
        <div class="mc-daynum">${c.date.getDate()}</div>
        ${weatherIsTop && weatherPos === 'top-right' ? weatherContentHtml(ds) : ''}
      </div>
      ${stripeLabelHtml}
      <div class="mc-span-spacer" style="height:${reservedHeight}"></div>
      <div class="mc-events" data-fit="1" data-max-lines="${(widget && widget.calMaxLines) || 0}">${evHtml}${moreHtml}</div>
      ${weatherIsBottomLeft ? `<div class="mc-weather-bottom-row" style="justify-content:flex-start">${weatherContentHtml(ds)}</div>` : ''}
      ${weatherIsBottomRight ? `<div class="mc-weather-bottom-row" style="justify-content:flex-end">${weatherContentHtml(ds)}</div>` : ''}
      ${lineHtml}
      ${stickerBadgesHtml(ds)}
      ${reminderBadgesHtml(ds)}
    </div>`;
  }).join('');

  const DOW_LETTERS = (window.i18n && i18n.weekdays('narrow')) || ['S','M','T','W','T','F','S']; // Sun..Sat, JS's native order
  const wsd = weekStartDay(wsdOverride);
  const dowHtml = [...DOW_LETTERS.slice(wsd), ...DOW_LETTERS.slice(0, wsd)].map(l => `<span>${l}</span>`).join('');

  const todayStyle = (widget && widget.calTodayStyle) || 'circle';
  const todayColorVar = (widget && widget.calTodayColor) ? `--today-color:${widget.calTodayColor};` : '';
  return `<div class="w-minical${wrapClass}" data-today-style="${todayStyle}" style="display:flex;flex-direction:column;--cal-font:calc(${fontPx}px * var(--ui-scale,1));${todayColorVar}"${widgetId != null ? ` data-widget-id="${widgetId}" data-interactive="1"` : ''}>
    <div class="mc-header">${headerLabel}</div>
    <div class="mc-names">${dowHtml}</div>
    <div class="mc-body-wrap" style="position:relative;flex:1;min-height:0">
      <div class="mc-body" style="grid-template-rows:repeat(${numRows},1fr)">${cellsHtml}</div>
      ${(isPostit || multiDayStyle !== 'bar') ? '' : `<div class="mc-span-overlay" style="grid-template-rows:repeat(${numRows},1fr)">${barHtml}</div>`}
    </div>
  </div>`;
}

// ── Agenda layout: scrolling day-grouped list, no grid cells ─────────────────
function renderMiniCalAgenda(widget) {
  const fontPx = (widget && widget.calFontPx) || 11;
  const wrapText = !!(widget && widget.calWrap);
  const daysAhead = (widget && widget.calAgendaDays) || 14;
  const widgetEvents = filterEventsForWidget(state.events, widget);

  const today = todayStr();
  const pastMode = (widget && widget.pastEvents) || 'show';
  const showLocation = !widget || widget.calShowLocation !== false; // default ON

  // Swipe/tap navigation, same mechanism as the grid views above (local,
  // unsaved offset in units of "whole windows" — each nav step pages forward
  // or back by daysAhead days). At the default position (offset 0) this is
  // byte-for-byte the original behavior, including pastMode's extra
  // backward-looking window. Once actually navigated away, the requested
  // window is shown as asked — regardless of pastEvents — since paging
  // backward is an explicit request to see the past, not something that
  // "showing past events" should have to be turned on for first.
  const widgetId = widget && widget.id;
  const periodOffset = (widgetId != null) ? (miniCalOffsets[widgetId] || 0) : 0;
  const anchorStart = new Date(); anchorStart.setDate(anchorStart.getDate() + periodOffset * daysAhead);
  const anchorStartStr = `${anchorStart.getFullYear()}-${pad(anchorStart.getMonth()+1)}-${pad(anchorStart.getDate())}`;
  const endDate = new Date(anchorStart); endDate.setDate(anchorStart.getDate() + daysAhead);
  const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth()+1)}-${pad(endDate.getDate())}`;

  // Window: by default the agenda is forward-looking (today onward). When the user
  // asks to show past events (show/dim), widen the start to include recent ones.
  const startStr = (periodOffset === 0 && (pastMode === 'show' || pastMode === 'dim'))
    ? (() => { const s = new Date(); s.setDate(s.getDate() - daysAhead); return `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`; })()
    : anchorStartStr;

  const rangeStartD = new Date(startStr + 'T00:00:00'), rangeEndD = new Date(endStr + 'T00:00:00');
  const sameMonth = rangeStartD.getMonth() === rangeEndD.getMonth();
  const rangeLabel = sameMonth
    ? `<span class="mc-month">${MONTHS[rangeStartD.getMonth()]}</span><span class="mc-year">${rangeStartD.getFullYear()}</span>`
    : `<span class="mc-month">${monthDayLabel(rangeStartD, widget.calDateFormat || globalDateFormat())} – ${monthDayLabel(rangeEndD, widget.calDateFormat || globalDateFormat())}</span><span class="mc-year">${rangeEndD.getFullYear()}</span>`;
  const headerHtml = miniCalNavHtml(widgetId, periodOffset, rangeLabel, 'window');
  const widgetAttrs = widgetId != null ? ` data-widget-id="${widgetId}" data-interactive="1"` : '';

  const upcoming = widgetEvents
    .filter(e => (e.end_date || e.date) >= startStr && e.date <= endStr)
    .sort((a,b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (!a.start_time) return -1;
      if (!b.start_time) return 1;
      return a.start_time < b.start_time ? -1 : 1;
    });

  if (!upcoming.length) {
    return `<div class="w-minical-agenda" style="--cal-font:calc(${fontPx}px * var(--ui-scale,1))"${widgetAttrs}><div class="mc-header">${headerHtml}</div><div class="no-data">No events in this range</div></div>`;
  }

  // Group by date
  const groups = {};
  upcoming.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });

  const itemsHtml = Object.entries(groups).map(([date, evs]) => {
    const d = new Date(date + 'T00:00:00');
    const isToday = date === today;
    const isPast = date < today;
    const dimClass = (isPast && pastMode === 'dim') ? ' past-dimmed' : '';
    const dayLabel = isToday ? 'Today' : weekdayDateLabel(d, widget.calDateFormat || globalDateFormat());
    const colorCodingOn = !widget || widget.calColorCoding !== false;
    const evHtml = evs.map(e => {
      const timeLabel = e.end_date && e.end_date > e.date
        ? 'All day'
        : (e.start_time
            ? ((widget.calShowEndTime && e.end_time) ? `${fmtTime(e.start_time)} – ${fmtTime(e.end_time)}` : fmtTime(e.start_time))
            : 'All day');
      const titleHtml = wrapText
        ? `<span class="ag-title" style="white-space:normal">${escapeHtmlD(e.title)}</span>`
        : `<span class="ag-title">${escapeHtmlD(e.title)}</span>`;
      const locHtml = widgetShowsLocation(e, widget, showLocation)
        ? `<div class="ag-loc">📍 ${escapeHtmlD(e.location)}</div>` : '';
      return `<div class="ag-ev" data-event-key="${eventDetailKey(e)}">
        ${colorCodingOn ? `<div class="ag-dot" style="background:${eventPillColor(e, widget)}"></div>` : ''}
        <div class="ag-time">${timeLabel}</div>
        ${titleHtml}
        ${locHtml}
      </div>`;
    }).join('');
    return `<div class="ag-group${dimClass}">
      <div class="ag-day-label${isToday?' today':''}">${dayLabel}</div>
      ${evHtml}
    </div>`;
  }).join('');

  return `<div class="w-minical-agenda" style="--cal-font:calc(${fontPx}px * var(--ui-scale,1))"${widgetAttrs}>
    <div class="mc-header">${headerHtml}</div>
    <div class="ag-scroll">${itemsHtml}</div>
  </div>`;
}

// ── Strip layout: single horizontal row of upcoming days with event dots ─────
function renderMiniCalStrip(widget) {
  const fontPx = (widget && widget.calFontPx) || 11;
  const daysCount = (widget && widget.calStripDays) || 7;
  const widgetEvents = filterEventsForWidget(state.events, widget);
  const today = todayStr();

  // Swipe/tap navigation, same mechanism as the other views — local, unsaved
  // offset in units of "whole windows" (each nav step pages the strip forward
  // or back by daysCount days).
  const widgetId = widget && widget.id;
  const periodOffset = (widgetId != null) ? (miniCalOffsets[widgetId] || 0) : 0;
  const dayOffset = periodOffset * daysCount;

  const eventsByDate = {};
  widgetEvents.forEach(e => {
    // For multi-day events, mark every day in the span so the strip shows continuity
    const start = e.date;
    const end = e.end_date || e.date;
    let cur = new Date(start + 'T00:00:00');
    const endD = new Date(end + 'T00:00:00');
    while (cur <= endD) {
      const ds = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`;
      (eventsByDate[ds] = eventsByDate[ds] || []).push(e);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const colorCodingOn = !widget || widget.calColorCoding !== false;
  const cellsHtml = Array.from({length: daysCount}).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i + dayOffset);
    const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const isToday = ds === today;
    const evs = (eventsByDate[ds] || []).slice(0, 3);
    const dotsHtml = colorCodingOn ? evs.map(e => `<span class="st-dot" style="background:${eventPillColor(e, widget)}"></span>`).join('') : '';
    return `<div class="st-cell${isToday?' today':''}">
      <div class="st-dayname">${isToday?'Today':DAYS_S[d.getDay()]}</div>
      <div class="st-daynum">${d.getDate()}</div>
      <div class="st-dots">${dotsHtml}</div>
    </div>`;
  }).join('');

  // Compact header — arrows + Today only, no date-range label (the strip's
  // own cells already show each day's name/number, so a redundant range
  // label here would just be visual noise on an otherwise minimal widget).
  const headerHtml = miniCalNavHtml(widgetId, periodOffset, '', 'range');
  const widgetAttrs = widgetId != null ? ` data-widget-id="${widgetId}" data-interactive="1"` : '';

  return `<div class="w-minical-strip" style="--cal-font:calc(${fontPx}px * var(--ui-scale,1))"${widgetAttrs}>
    ${widgetId != null ? `<div class="mc-header st-header">${headerHtml}</div>` : ''}
    <div class="st-row">${cellsHtml}</div>
  </div>`;
}

// Builds a single event row's HTML for Upcoming/Today, in whichever layout mode
// is selected. Keeping this shared means List/Cards/Compact behave identically
// for both widgets — same field visibility rules, same data, just different markup.
function buildEventRow(e, opts) {
  const { layoutMode, showTime, showSource, showNotes, showLocation, todayStr: today, dateBadge, dateFormat, ampmCaseOverride, widget } = opts;
  const feedLabel = (showSource && e.feed_name)
    ? `<span class="ev-source">${escapeHtmlD(e.feed_name)}</span>` : '';
  const isMultiDay = e.end_date && e.end_date > e.date;
  const timeLabel = showTime ? (
    isMultiDay
      ? (dateBadge ? 'All day' : `through ${monthDayLabel(new Date(e.end_date+'T00:00:00'), dateFormat || globalDateFormat())}`)
      : (e.start_time ? `${fmtTime(e.start_time, ampmCaseOverride)}${e.end_time?' – '+fmtTime(e.end_time, ampmCaseOverride):''}` : 'All day')
  ) : '';
  const notesLabel = (showNotes && e.notes) ? `<div class="ev-notes">${escapeHtmlD(e.notes)}</div>` : '';
  const locLabel = widgetShowsLocation(e, widget, showLocation !== false)
    ? `<div class="ev-loc">📍 ${escapeHtmlD(e.location)}</div>` : '';
  const dateBadgeHtml = dateBadge ? (() => {
    const d = new Date(e.date+'T00:00:00');
    return `<div class="ev-date"><div class="ev-mo">${MONTHS_S[d.getMonth()]}</div><div class="ev-d">${d.getDate()}</div></div>`;
  })() : '';

  if (layoutMode === 'cards') {
    return `<div class="ev-card" data-event-key="${eventDetailKey(e)}" style="border-left-color:${eventPillColor(e, widget)}">
      ${dateBadgeHtml}
      <div class="ev-card-body">
        <div class="ev-title">${escapeHtmlD(e.title)}</div>
        ${(feedLabel || timeLabel) ? `<div class="ev-time">${timeLabel}${feedLabel?(timeLabel?' · ':'')+feedLabel:''}</div>` : ''}
        ${locLabel}
        ${notesLabel}
      </div>
    </div>`;
  }

  if (layoutMode === 'compact') {
    return `<div class="ev-compact" data-event-key="${eventDetailKey(e)}">
      <div class="ev-compact-dot" style="background:${eventPillColor(e, widget)}"></div>
      ${timeLabel ? `<div class="ev-compact-time">${timeLabel}</div>` : ''}
      <div class="ev-compact-title">${escapeHtmlD(e.title)}</div>
      ${feedLabel}
    </div>`;
  }

  // 'list' — original style
  return `<div class="ev" data-event-key="${eventDetailKey(e)}">
    ${dateBadgeHtml}
    <div class="ev-bar" style="background:${eventPillColor(e, widget)}"></div>
    <div class="ev-body">
      <div class="ev-title">${escapeHtmlD(e.title)}</div>
      ${(feedLabel || timeLabel) ? `<div class="ev-time">${feedLabel}${timeLabel}</div>` : ''}
      ${locLabel}
      ${notesLabel}
    </div>
  </div>`;
}

// Builds the "Ongoing" strip (the third multi-day display style explored
// alongside bar/dot/line/stripe) — a compact status-update-style summary of
// currently-active and imminently-starting multi-day events, worded like
// "day 3 of 5" / "starts tomorrow, 5 days" rather than shown as just another
// row in the day-by-day list. Shared by Agenda and Today — both already mix
// ongoing multi-day events into their regular list with nothing calling out
// that a "today" row is actually day 3 of a 5-day trip; this pulls that
// context into its own line instead. Opt-in per widget (agShowOngoing/
// tdShowOngoing) — off by default so this doesn't change how an existing
// widget looks without the person choosing it.
function buildOngoingStripHtml(events, today, lookaheadDays, widget) {
  const multiDay = events.filter(e => e.end_date && e.end_date > e.date);
  const relevant = multiDay.filter(e => {
    const isActive = e.date <= today && e.end_date >= today;
    const startsSoon = e.date > today && e.date <= addDaysStr(today, lookaheadDays);
    return isActive || startsSoon;
  }).sort((a, b) => a.date < b.date ? -1 : 1);
  if (!relevant.length) return '';

  const todayD = new Date(today + 'T00:00:00');
  const rows = relevant.map(e => {
    const start = new Date(e.date + 'T00:00:00');
    const end = new Date(e.end_date + 'T00:00:00');
    const totalDays = Math.round((end - start) / 86400000) + 1;
    const isActive = e.date <= today && e.end_date >= today;
    let statusText;
    if (isActive) {
      const dayNum = Math.round((todayD - start) / 86400000) + 1;
      statusText = e.end_date === today ? `day ${dayNum} of ${totalDays}, ends today` : `day ${dayNum} of ${totalDays}`;
    } else {
      const daysUntil = Math.round((start - todayD) / 86400000);
      const dayWord = totalDays === 1 ? 'day' : 'days';
      statusText = daysUntil === 1 ? `starts tomorrow, ${totalDays} ${dayWord}` : `starts in ${daysUntil} days, ${totalDays} ${dayWord}`;
    }
    return `<div class="ag-ongoing-row">
      <span class="ag-ongoing-dot" style="background:${eventPillColor(e, widget)}"></span>
      <span class="ag-ongoing-title">${escapeHtmlD(e.title)}</span>
      <span class="ag-ongoing-status">${statusText}</span>
    </div>`;
  }).join('');
  return `<div class="ag-ongoing-strip">${rows}</div>`;
}

// Combines Today + Upcoming into one continuous, grouped list — avoids the gap/
// cutoff problem of running them as two separate widgets (e.g. Today showing
// nothing while Upcoming's first item is still 4 days out, or Upcoming getting
// cut off mid-day because of a fixed event-count cap).
function renderAgenda(widget) {
  const today = todayStr();
  const fontPx = (widget && widget.agFontPx) || 14;
  const showSource = !widget || widget.agShowSource !== false;
  const showTime = !widget || widget.agShowTime !== false;
  const showNotes = !!(widget && widget.agShowNotes);
  const showLocation = !widget || widget.agShowLocation !== false; // default ON
  const layoutMode = (widget && widget.agLayout) || 'list'; // 'list'|'cards'|'compact'
  const daysAhead = (widget && widget.agDays) || 7; // user-set cap, in days — not an event count
  const dateFormat = (widget && widget.agDateFormat) || globalDateFormat();
  // Opt-in (default off, same convention as calShowReminders on the
  // calendar grid) — reminders read from the exact same state.reminders +
  // reminderOccursOnDate() every other reminder surface uses, so this can
  // never disagree with the Reminders widget or the calendar-grid badges
  // about what's due.
  const showReminders = !!(widget && widget.agShowReminders);

  const filtered = filterEventsForWidget(state.events, widget);
  const windowEnd = addDaysStr(today, daysAhead - 1); // inclusive of today, e.g. agDays=7 covers today + 6 more days

  // Anything whose span touches the window: ongoing multi-day events that started
  // before today (still relevant today) through events starting within the window.
  const inWindow = filtered.filter(e => {
    const start = e.date, end = e.end_date || e.date;
    return end >= today && start <= windowEnd;
  });

  // Group by the date each event is relevant for. A multi-day event that's
  // already in progress is grouped under TODAY (so it doesn't get buried under
  // its original start date, possibly off-screen in the past), everything else
  // groups under its actual start date.
  const groups = {}; // dateStr -> events[], with a non-numeric ._reminders property stashed alongside for that date's due reminders (arrays are objects — an extra named property doesn't affect .map()/.length/etc.)
  inWindow.forEach(e => {
    const groupDate = e.date < today ? today : e.date;
    (groups[groupDate] = groups[groupDate] || []).push(e);
  });

  // Unlike events, a reminder can create a day group of its own — "trash
  // today" is exactly the kind of thing worth showing even on an otherwise
  // empty day, not just tacked onto a day that already has something else.
  if (showReminders) {
    const activeReminders = (state.reminders || []).filter(r => r.active !== 0);
    if (activeReminders.length) {
      let d = today;
      while (d <= windowEnd) {
        const dayReminders = activeReminders.filter(r => reminderOccursOnDate(r, d));
        if (dayReminders.length) {
          if (!groups[d]) groups[d] = [];
          groups[d]._reminders = dayReminders;
        }
        d = addDaysStr(d, 1);
      }
    }
  }

  const orderedDates = Object.keys(groups).sort();
  if (!orderedDates.length) {
    return `<div class="w-agenda"><div class="no-data">Nothing scheduled</div></div>`;
  }

  const html = orderedDates.map(d => {
    const label = agendaDayLabel(d, today, dateFormat);
    const reminderRows = (groups[d]._reminders || []).map(r => `
      <div class="ag2-reminder-row">
        <span class="ag2-reminder-icon">${reminderIconHtml(r)}</span>
        <span class="ag2-reminder-name">${escapeHtmlD(r.name)}</span>
      </div>`).join('');
    const rows = groups[d].map(e => buildEventRow(e, {
      layoutMode, showTime, showSource, showNotes, showLocation, todayStr: today, dateBadge: false, dateFormat,
      ampmCaseOverride: widget && widget.agAmpmCase, widget,
    })).join('');
    return `<div class="ag2-group">
      <div class="ag2-day-label${d===today?' today':''}">${label}</div>
      ${reminderRows}
      ${rows}
    </div>`;
  }).join('');

  const ongoingHtml = (widget && widget.agShowOngoing) ? buildOngoingStripHtml(inWindow, today, 3, widget) : '';
  return `<div class="w-agenda w-agenda-${layoutMode}" style="--ag-font:calc(${fontPx}px * var(--ui-scale,1))">${ongoingHtml}${html}</div>`;
}

// "Today" / "Tomorrow" / weekday name for dates within the next week, falling back
// to "Mon, Jan 5" ("Mon, 5 Jan" for International) style for anything further out.
function agendaDayLabel(dateStr, todayStr2, format) {
  if (dateStr === todayStr2) return 'Today';
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(todayStr2 + 'T00:00:00');
  const diffDays = Math.round((d - t) / 86400000);
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays < 7) return DAYS[d.getDay()];
  return weekdayDateLabel(d, format || globalDateFormat());
}

function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function renderUpcoming(widget) {
  const today = todayStr();
  const fontPx = (widget && widget.upFontPx) || 14;
  const showSource = !widget || widget.upShowSource !== false;
  const showTime = !widget || widget.upShowTime !== false;
  const showNotes = !!(widget && widget.upShowNotes);
  const showLocation = !widget || widget.upShowLocation !== false; // default ON
  const layoutMode = (widget && widget.upLayout) || 'list'; // 'list'|'cards'|'compact'
  const dateFormat = (widget && widget.upDateFormat) || globalDateFormat();

  const filtered = filterEventsForWidget(state.events, widget);
  // Strictly-future start dates, same as before — ongoing multi-day events that already
  // started show in the Today widget instead, so Upcoming stays focused on what's next.
  const future = filtered.filter(e=>e.date>today).slice(0,8);
  if(!future.length) return `<div class="w-upcoming"><div class="no-data">No upcoming events</div></div>`;
  const items = future.map(e => buildEventRow(e, {
    layoutMode, showTime, showSource, showNotes, showLocation, todayStr: today, dateBadge: true, dateFormat,
    ampmCaseOverride: widget && widget.upAmpmCase, widget,
  })).join('');
  return `<div class="w-upcoming w-upcoming-${layoutMode}" style="--up-font:calc(${fontPx}px * var(--ui-scale,1))">${items}</div>`;
}

function renderToday(widget) {
  const today = todayStr();
  const fontPx = (widget && widget.tdFontPx) || 15;
  const showSource = !widget || widget.tdShowSource !== false;
  const showTime = !widget || widget.tdShowTime !== false;
  const showNotes = !!(widget && widget.tdShowNotes);
  const showLocation = !widget || widget.tdShowLocation !== false; // default ON
  const layoutMode = (widget && widget.tdLayout) || 'list'; // 'list'|'cards'|'compact'
  const dateFormat = (widget && widget.tdDateFormat) || globalDateFormat();

  const filtered = filterEventsForWidget(state.events, widget);
  // Today's events = anything whose span includes today (covers ongoing multi-day events)
  const evs = filtered.filter(e => e.date <= today && (e.end_date || e.date) >= today);
  if(!evs.length) return `<div class="w-today"><div class="td-label">Today</div><div class="no-data">Nothing scheduled</div></div>`;
  const items = evs.map(e => buildEventRow(e, {
    layoutMode, showTime, showSource, showNotes, showLocation, todayStr: today, dateBadge: false, dateFormat,
    ampmCaseOverride: widget && widget.tdAmpmCase, widget,
  })).join('');
  const ongoingHtml = (widget && widget.tdShowOngoing) ? buildOngoingStripHtml(filtered, today, 2, widget) : '';
  return `<div class="w-today w-today-${layoutMode}" style="--td-font:calc(${fontPx}px * var(--ui-scale,1))"><div class="td-label">Today</div>${ongoingHtml}${items}</div>`;
}

// Combines multiple Todoist projects into one widget, grouped under a project-name
// header per group — same motivation as the Agenda widget: running several
// single-project Tasks widgets can leave awkward gaps where one project has
// nothing due while another's list runs off the bottom of its own box.
function renderTasksCombined(widget) {
  // projectIds: array of Todoist project IDs (or null for "all projects" as one entry).
  // projectNames: parallel array of display names, captured at config time in the
  // Layout editor — avoids needing a separate project-list fetch just to label groups.
  const projectIds = (widget && widget.projectIds && widget.projectIds.length) ? widget.projectIds : [null];
  const projectNames = (widget && widget.projectNames) || {};
  const showDueDate = !widget || widget.tcShowDue !== false;
  const fontPx = (widget && widget.tcFontPx) || 14;
  const alignSetting = (widget && widget.tcAlign) || 'top'; // 'top'|'center'|'bottom'
  const alignCss = alignSetting === 'center' ? 'center' : alignSetting === 'bottom' ? 'flex-end' : 'flex-start';

  // Pull each selected project's cached tasks and tag them with which project
  // they came from, so they can be grouped and labeled after merging.
  let anyError = null;
  let allLoaded = true;
  const merged = [];
  projectIds.forEach(pid => {
    const key = pid || '__all__';
    const tasks = state.tasksByProject[key];
    const error = state.tasksErrorByProject[key];
    if (error) anyError = anyError || error;
    if (tasks === undefined) { allLoaded = false; return; }
    const label = projectNames[key] || (pid ? 'Project' : 'All Tasks');
    tasks.forEach(t => merged.push({ ...t, __projectName: label }));
  });

  if (!merged.length) {
    if (!allLoaded) return `<div class="w-tasks-combined"><div class="no-data">Loading…</div></div>`;
    if (anyError) return `<div class="w-tasks-combined"><div class="no-data">${escapeHtmlD(anyError)}</div></div>`;
    return `<div class="w-tasks-combined"><div class="no-data">No tasks — nice!</div></div>`;
  }

  // Sort within each project group: overdue/today first, then by due date, undated last
  const sortTasks = (a, b) => {
    const ad = a.due ? a.due.date : '9999-99-99';
    const bd = b.due ? b.due.date : '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.priority || 1) < (b.priority || 1) ? 1 : -1;
  };

  // Group by project, preserving the order projects were selected in (not alphabetical),
  // so the person controls the display order via the order they picked projects.
  const groups = {};
  merged.forEach(t => { (groups[t.__projectName] = groups[t.__projectName] || []).push(t); });
  const today = todayStr();

  const html = Object.entries(groups).map(([projectName, tasks]) => {
    const sorted = [...tasks].sort(sortTasks);
    const items = sorted.map(t => {
      const priorityClass = t.priority === 4 ? 'p1' : t.priority === 3 ? 'p2' : t.priority === 2 ? 'p3' : '';
      let dueLabel = '';
      if (showDueDate && t.due && t.due.date) {
        const d = new Date(t.due.date + 'T00:00:00');
        if (t.due.date === today) dueLabel = 'Today';
        else if (t.due.date < today) dueLabel = 'Overdue';
        else dueLabel = monthDayLabel(d, globalDateFormat());
      }
      return `<div class="tk-item" data-task-id="${escapeHtmlD(String(t.id))}">
        <div class="tk-check ${priorityClass}" data-interactive="1"></div>
        <div class="tk-body">
          <div class="tk-title">${escapeHtmlD(t.content)}</div>
          ${dueLabel ? `<div class="tk-due">${dueLabel}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="tc-group">
      <div class="tc-project-label">${escapeHtmlD(projectName)}</div>
      <div class="tk-list">${items}</div>
    </div>`;
  }).join('');

  return `<div class="w-tasks-combined" style="--tc-font:calc(${fontPx}px * var(--ui-scale,1));--tc-align:${alignCss}">${html}</div>`;
}

function renderTasks(widget) {
  const projectId = (widget && widget.projectId) || null; // null = all projects
  const projectKey = projectId || '__all__';
  const tasks = state.tasksByProject[projectKey];
  const error = state.tasksErrorByProject[projectKey];
  const label = (widget && widget.projectName) || 'Tasks';
  // Global text size for this widget (scales both the list name and task
  // rows) — was a real bug here: taskFontScale alone, with no --ui-scale
  // multiplied in at all, unlike every other widget in this file. Meant
  // Tasks text stayed full-size regardless of screen resolution or the
  // phone app's Live Preview (a scaled-down simulation) — everything
  // around it would shrink correctly and Tasks alone wouldn't, since
  // nothing here ever referenced the screen's actual scale.
  const tkScale = (widget && widget.taskFontScale) ? widget.taskFontScale : 1;
  const rootStyle = `--tk-scale:calc(${tkScale} * var(--ui-scale,1))`;

  if (!tasks || !tasks.length) {
    if (error) {
      return `<div class="w-tasks" style="${rootStyle}"><div class="tk-label">${escapeHtmlD(label)}</div><div class="no-data">${escapeHtmlD(error)}</div></div>`;
    }
    if (!tasks) {
      return `<div class="w-tasks" style="${rootStyle}"><div class="tk-label">${escapeHtmlD(label)}</div><div class="no-data">Loading…</div></div>`;
    }
    return `<div class="w-tasks" style="${rootStyle}"><div class="tk-label">${escapeHtmlD(label)}</div><div class="no-data">No tasks — nice!</div></div>`;
  }
  // Sort: overdue/today first, then by due date, undated last
  const sorted = [...tasks].sort((a, b) => {
    const ad = a.due ? a.due.date : '9999-99-99';
    const bd = b.due ? b.due.date : '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.priority || 1) < (b.priority || 1) ? 1 : -1;
  });
  const items = sorted.slice(0, 12).map(t => {
    const priorityClass = t.priority === 4 ? 'p1' : t.priority === 3 ? 'p2' : t.priority === 2 ? 'p3' : '';
    let dueLabel = '';
    if (t.due && t.due.date) {
      const d = new Date(t.due.date + 'T00:00:00');
      const todayD = todayStr();
      if (t.due.date === todayD) dueLabel = 'Today';
      else if (t.due.date < todayD) dueLabel = 'Overdue';
      else dueLabel = monthDayLabel(d, globalDateFormat());
    }
    return `<div class="tk-item" data-task-id="${escapeHtmlD(String(t.id))}">
      <div class="tk-check ${priorityClass}" data-interactive="1"></div>
      <div class="tk-body">
        <div class="tk-title">${escapeHtmlD(t.content)}</div>
        ${dueLabel ? `<div class="tk-due">${dueLabel}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="w-tasks" style="${rootStyle}"><div class="tk-label">${escapeHtmlD(label)}</div><div class="tk-list">${items}</div></div>`;
}

function renderNews(widget) {
  const fontPx = (widget && widget.newsFontPx) || 13;
  const maxItems = (widget && widget.newsMaxItems) || 8;

  if (!state.news || !state.news.length) {
    if (state.newsError) {
      return `<div class="w-news"><div class="nw-label">News</div><div class="no-data">${state.newsError}</div></div>`;
    }
    return `<div class="w-news"><div class="nw-label">News</div><div class="no-data">Loading…</div></div>`;
  }

  const shown = state.news.slice(0, maxItems);

  // If every headline shares the same group (or none are grouped), render a single
  // flat list with one header — keeps the simple/National-only case clean.
  const groups = [];
  const groupIndex = {};
  for (const n of shown) {
    const g = n.group || 'Top Stories';
    if (!(g in groupIndex)) { groupIndex[g] = groups.length; groups.push({ label: g, items: [] }); }
    groups[groupIndex[g]].items.push(n);
  }

  const itemHtml = (n) => `
    <div class="nw-item">
      <div class="nw-dot"></div>
      <div class="nw-body">
        <div class="nw-title">${escapeHtmlD(n.title)}</div>
        ${n.source ? `<div class="nw-source">${escapeHtmlD(n.source)}</div>` : ''}
      </div>
    </div>`;

  if (groups.length === 1) {
    const items = groups[0].items.map(itemHtml).join('');
    return `<div class="w-news" style="--news-font:calc(${fontPx}px * var(--ui-scale,1))"><div class="nw-label">${groups[0].label}</div><div class="nw-list">${items}</div></div>`;
  }

  // Multiple groups: a small labeled section per source.
  const sections = groups.map(g => `
    <div class="nw-group">
      <div class="nw-group-label">${g.label}</div>
      <div class="nw-list">${g.items.map(itemHtml).join('')}</div>
    </div>
  `).join('');

  return `<div class="w-news" style="--news-font:calc(${fontPx}px * var(--ui-scale,1))">${sections}</div>`;
}

function renderStocks(widget) {
  const fontPx = (widget && widget.stockFontPx) || 14;

  if (!state.stocks || !state.stocks.length) {
    if (state.stocksError) {
      return `<div class="w-stocks"><div class="sk-label">Markets</div><div class="no-data">${escapeHtmlD(state.stocksError)}</div></div>`;
    }
    return `<div class="w-stocks"><div class="sk-label">Markets</div><div class="no-data">Loading…</div></div>`;
  }

  // Per-widget visibility for the three default indices. Each defaults to shown;
  // a widget can hide any of them via its settings.
  const hideDow = !!(widget && widget.hideDow);
  const hideNasdaq = !!(widget && widget.hideNasdaq);
  const hideSP = !!(widget && widget.hideSP);
  // Custom tickers: each widget shows only the ones it's specifically
  // configured to track (v1.77.77 — previously every Stock widget on the
  // display showed the same device-wide list, since tracking individual
  // tickers used to be one shared Data Sources setting rather than a
  // per-widget one). `undefined` (not yet migrated/created) falls back to
  // showing everything fetched, matching the old behavior until migration
  // or widget creation sets an explicit list.
  const ownTickers = widget && Array.isArray(widget.stockTickers) ? new Set(widget.stockTickers.map(t => t.toUpperCase())) : null;
  const visibleStocks = state.stocks.filter(s => {
    if (s.symbol === '^DJI'  && hideDow) return false;
    if (s.symbol === '^IXIC' && hideNasdaq) return false;
    if (s.symbol === '^GSPC' && hideSP) return false;
    if (!s.isIndex && ownTickers && !ownTickers.has(s.symbol.toUpperCase())) return false;
    return true;
  });

  if (!visibleStocks.length) {
    return `<div class="w-stocks"><div class="sk-label">Markets</div><div class="no-data">No markets selected</div></div>`;
  }

  const items = visibleStocks.map(s => {
    const dir = s.change > 0 ? 'up' : s.change < 0 ? 'down' : 'flat';
    const arrow = s.change > 0 ? '▲' : s.change < 0 ? '▼' : '–';
    // Sub-$1 assets (small-cap crypto especially) need more than 2 decimals or they
    // just render as "$0.00" — scale precision down as the price gets smaller.
    const priceDecimals = s.close >= 1 ? 2 : s.close >= 0.01 ? 4 : 6;
    const changeStr = s.change !== null
      ? `${arrow} ${fmtNum(Math.abs(s.change), priceDecimals)} (${fmtNum(Math.abs(s.changePct), 2)}%)`
      : '';
    return `<div class="sk-item">
      <div>
        <span class="sk-name">${escapeHtmlD(s.label)}</span>${s.isCrypto ? `<span class="sk-crypto-tag">crypto</span>` : (!s.isIndex ? `<span class="sk-symbol">${escapeHtmlD(s.symbol)}</span>` : '')}
      </div>
      <div class="sk-right">
        <div class="sk-price">${s.close.toLocaleString((window.i18n && i18n.lang) || undefined,{minimumFractionDigits:priceDecimals,maximumFractionDigits:priceDecimals})}</div>
        <div class="sk-change ${dir}">${changeStr}</div>
      </div>
    </div>`;
  }).join('');

  return `<div class="w-stocks" style="--stock-font:calc(${fontPx}px * var(--ui-scale,1))"><div class="sk-label">Markets</div><div class="sk-list">${items}</div></div>`;
}

// User-defined text box. Honors per-widget font size (scaled via --ui-scale like
// every other widget), weight, alignment, and the 'label' preset's uppercase look.
function renderText(widget) {
  const w = widget || {};
  const fontPx = w.textFontPx || 28;
  const weight = w.textWeight || 'normal';
  const align = w.textAlign || 'left';
  const isLabel = w.textPreset === 'label';
  const fontFamily = w.textFontFamily || 'Inter';
  ensureWebFont(fontFamily); // load from Google if needed (no-op for system fonts)
  const content = (w.textContent || '');
  // Escape HTML, then turn newlines into <br> so multi-line text renders.
  const esc = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const styles = [
    `font-family:${cssFontStack(fontFamily)}`,
    `font-size:calc(${fontPx}px * var(--ui-scale,1))`,
    `font-weight:${weight}`,
    `text-align:${align}`,
    isLabel ? 'text-transform:uppercase;letter-spacing:0.08em' : '',
  ].filter(Boolean).join(';');
  return `<div class="w-text"><div class="tx-body" style="${styles}">${esc || ''}</div></div>`;
}

// A purely decorative graphic — an emoji placed anywhere on the canvas (a plant
// in a corner, a seasonal sticker, etc.), independent of any theme or template.
function renderDecoration(widget) {
  const w = widget || {};
  const emoji = w.decorEmoji || '🌿';
  const fontPx = w.decorFontPx || 60;
  const opacity = (w.decorOpacity ?? 100) / 100;
  const rotation = w.decorRotation || 0;
  const esc = String(emoji).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<div class="w-decoration" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:calc(${fontPx}px * var(--ui-scale,1));opacity:${opacity.toFixed(2)};transform:rotate(${rotation}deg);line-height:1">${esc}</div>`;
}

// Builds a CSS mask-image string that fades a photo's own pixels toward
// transparent near its edges, independently per side, by `Npx` from each edge —
// applied directly to the <img> so whatever's actually behind the widget shows
// through, rather than dimming with an opaque colored layer on top of it.
//
// Scaled by --ui-scale, same as every other pixel-based visual value in this
// file (fonts, padding, border-radius) — real report: a fade set for the
// reference 1920px display ate a disproportionately larger share of the photo
// on a smaller screen, since it was the one pixel value here that never got
// wired into that scaling convention when it was established. Written as a
// live calc() referencing the CSS variable (not a value baked in once in JS)
// so it stays correct if --ui-scale itself ever changes without this widget's
// HTML being fully re-rendered.
function buildEdgeFadeMask(top, bottom, left, right) {
  if (!top && !bottom && !left && !right) return '';
  // Smoothstep (3x²-2x³) stops instead of a straight linear ramp. A linear
  // fade has a visible "kink" right where it meets the flat opaque region
  // (or the flat fully-transparent void beyond the edge) — human vision is
  // sensitive to that rate-of-change discontinuity even though the gradient
  // itself is technically continuous, and it reads as a hard line across the
  // photo. Smoothstep eases in and out at both ends instead, removing the
  // kink. It also smooths the corners naturally when both axes are faded —
  // the intersection of two eased curves stays smooth, where two straight
  // ramps would intersect into a harder, more squared-off look.
  const S = [0, 0.043, 0.156, 0.316, 0.5, 0.684, 0.844, 0.957, 1]; // smoothstep at t = 0, .125, .25, ..., 1
  const scaledPx = (px) => `calc(${px.toFixed(2)}px * var(--ui-scale,1))`;

  function axisGradient(dir, startPx, endPx) {
    const stops = [];
    if (startPx) {
      S.forEach(t => stops.push(`rgba(0,0,0,${t.toFixed(3)}) ${scaledPx(startPx * t)}`));
    } else {
      stops.push(`rgba(0,0,0,1) 0px`);
    }
    if (endPx) {
      S.forEach(t => stops.push(`rgba(0,0,0,${(1 - t).toFixed(3)}) calc(100% - ${scaledPx(endPx * (1 - t))})`));
    } else {
      stops.push(`rgba(0,0,0,1) 100%`);
    }
    return `linear-gradient(to ${dir}, ${stops.join(', ')})`;
  }

  const vGrad = (top || bottom) ? axisGradient('bottom', top, bottom) : null;
  const hGrad = (left || right) ? axisGradient('right', left, right) : null;
  const grads = [vGrad, hGrad].filter(Boolean);
  if (grads.length === 1) {
    return `mask-image:${grads[0]};-webkit-mask-image:${grads[0]};mask-size:100% 100%;-webkit-mask-size:100% 100%;`;
  }
  // Both directions faded — layer both gradients and intersect them, so a
  // corner only fully fades where BOTH conditions overlap, not either alone.
  return `mask-image:${grads.join(',')};mask-composite:intersect;mask-size:100% 100%;`
    + `-webkit-mask-image:${grads.join(',')};-webkit-mask-composite:source-in;-webkit-mask-size:100% 100%;`;
}

// Photos included in the slideshow/background cycle. A photo is included unless
// it's been explicitly toggled off (active === 0) in the app's Photos tab, so
// you can upload many but cycle only a chosen subset (or just one).
// The pool of photos this SCREEN's screensaver/blank view cycles through. If this
// screen has a screensaver_tag set (Displays tab, per screen), only photos carrying
// that tag are shown; otherwise every active photo is used (unchanged default
// behavior). Every photo file already lives locally on this device via sync, so this
// is a pure client-side filter — no network round trip needed to resolve it.
function activePhotos() {
  const all = state.photos || [];
  const tag = (displayConfig.screensaverTag || '').trim();
  // Same reasoning as photosForWidget(): once a tag's been explicitly chosen for
  // this screen's screensaver, that IS the selection — the general "active"
  // toggle (meant for the default, unfiltered pool) shouldn't ALSO gate it,
  // which used to silently exclude a correctly-tagged photo that just hadn't
  // been separately marked active too.
  if (!tag) return all.filter(p => p.active === undefined || p.active === 1 || p.active === '1');
  const filtered = all.filter(p => (p.tags || '').split(',').map(t => t.trim()).includes(tag));
  // If the chosen tag matches nothing (e.g. it was just changed and nothing's tagged
  // yet), fall back to the active pool rather than showing a blank screensaver.
  return filtered.length ? filtered : all.filter(p => p.active === undefined || p.active === 1 || p.active === '1');
}

// Returns the photo list for a specific photo widget, honoring its OWN tag filter
// (independent of the screensaver's — see below), per-display subset selection
// (photoMode 'selected' + photoIds), and shuffle option. Falls back to all active
// photos if nothing narrows it down.
function photosForWidget(widget) {
  // Deliberately NOT built on activePhotos() — that function is specifically the
  // SCREENSAVER's own tag filter, and this widget previously inherited it with no
  // way to point at a different tag, which looked like "the widget is tied to
  // whatever the screensaver shows" because, structurally, it always was.
  const all = state.photos || [];
  const tag = (widget && widget.photoTag || '').trim();
  const hasSpecificSelection = !!tag || (widget && widget.photoMode === 'selected' && Array.isArray(widget.photoIds) && widget.photoIds.length);
  // "active" is the general on/off toggle for the DEFAULT, unfiltered photo pool
  // (the Photos tab's "tap to include/exclude" checkbox). Once a tag or a
  // specific photo has been explicitly chosen here, that choice IS the
  // selection — applying "active" on top of it used to silently exclude a photo
  // that correctly matched the tag (or was explicitly picked by ID) just because
  // it hadn't ALSO been separately marked active in the general pool.
  let list = hasSpecificSelection ? all : all.filter(p => p.active === undefined || p.active === 1 || p.active === '1');
  if (tag) {
    const filtered = list.filter(p => (p.tags || '').split(',').map(t => t.trim()).includes(tag));
    if (filtered.length) list = filtered; // ignore a tag matching nothing, same fallback as the screensaver's own
  }
  if (widget && widget.photoMode === 'selected' && Array.isArray(widget.photoIds) && widget.photoIds.length) {
    const wanted = new Set(widget.photoIds);
    const subset = list.filter(p => wanted.has(p.id));
    if (subset.length) list = subset; // ignore an empty selection rather than show nothing
  }
  if (widget && widget.photoShuffle) {
    // Deterministic shuffle seeded by widget id, so all clients stay in sync.
    list = shuffleSeeded(list.slice(), String(widget.id || 'photo'));
  }
  return list;
}
function shuffleSeeded(arr, seed) {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const j = h % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Read-only "Home Hub" style chore chart for the wall display: a column per kid,
// each listing today's chores with a checkbox state. Updates live (SSE 'chores').
function renderChoreChart(widget) {
  const w = widget || {};
  const data = state.choreChart;
  const title = w.choreTitle || 'Daily Chore Chart';
  const ccFontPx = w.choreFontPx || 15;
  const ccStyle = `--cc-font:calc(${ccFontPx}px * var(--ui-scale,1))`;
  if (!data || !data.kids || !data.kids.length) {
    return `<div class="w-chorechart" style="${ccStyle}"><div class="cc-head">${escapeHtmlD(title)}</div><div class="no-data">No kids set up yet</div></div>`;
  }
  const showDone = w.choreShowDone !== false; // optionally hide completed
  const showStickers = w.choreShowStickers !== false; // optionally hide sticker balance
  const showBonus = !!w.choreShowBonus; // optionally append the shared bonus pool
  // Optional per-display child filter. null/undefined = all children.
  let kidsList = data.kids;
  if (Array.isArray(w.choreKidIds) && w.choreKidIds.length) {
    const want = new Set(w.choreKidIds.map(String));
    kidsList = data.kids.filter(k => want.has(String(k.id)));
  }
  if (!kidsList.length) {
    return `<div class="w-chorechart" style="${ccStyle}"><div class="cc-head">${escapeHtmlD(title)}</div><div class="no-data">No children selected</div></div>`;
  }
  const cols = kidsList.map(k => {
    const chores = (k.chores || []).filter(c => showDone || !c.done);
    const items = chores.length ? chores.map(c => `
      <div class="cc-item ${c.done ? 'done' : ''}" data-instance-id="${c.instance_id}" data-photo-required="${c.photo_required ? '1' : '0'}" data-interactive="1">
        <span class="cc-box">${c.done ? '✓' : ''}</span>
        <span class="cc-ic">${choreIconHtmlD(c.icon)}</span>
        <span class="cc-label">${escapeHtmlD(c.title)}</span>
      </div>`).join('') : `<div class="cc-empty">All done! 🎉</div>`;
    return `<div class="cc-col">
      <div class="cc-kid" style="color:${k.color || 'inherit'}">${k.avatar || ''} ${escapeHtmlD(k.name)}${k.streak > 0 ? `<span class="cc-streak">🔥${k.streak}</span>` : ''}${(showStickers && k.stickerBalance > 0) ? `<span class="cc-streak" style="color:inherit">${stickerBadgeHtmlD(k, 'calc(var(--cc-font) * 1)')} ${k.stickerBalance}</span>` : ''}</div>
      <div class="cc-items">${items}</div>
    </div>`;
  }).join('');
  let bonusHtml = '';
  if (showBonus) {
    const bonus = (data.bonusChores || []);
    const chips = bonus.length ? bonus.map(b => {
      const claimed = !!b.claimedBy;
      const pay = b.pay_amount > 0 ? ` <span class="cc-bonus-pay">+${i18n.money((+b.pay_amount))}</span>` : '';
      const who = claimed
        ? `<span class="cc-bonus-who" style="color:${b.claimedBy.color || 'inherit'}">${b.claimedBy.avatar || ''} ${escapeHtmlD(b.claimedBy.name || '')}</span>`
        : '';
      return `<div class="cc-bonus-chip ${claimed ? 'claimed' : ''}">
        <span class="cc-ic">${choreIconHtmlD(b.icon)}</span>
        <span class="cc-bonus-label">${escapeHtmlD(b.title)}</span>${pay}${who}
      </div>`;
    }).join('') : `<div class="cc-empty">No bonus chores right now</div>`;
    bonusHtml = `<div class="cc-bonus"><div class="cc-bonus-head">⭐ Up for grabs</div><div class="cc-bonus-list">${chips}</div></div>`;
  }
  return `<div class="w-chorechart" style="${ccStyle}">
    <div class="cc-head">${escapeHtmlD(title)}</div>
    <div class="cc-cols" style="--cc-count:${kidsList.length}">${cols}</div>
    ${bonusHtml}
  </div>`;
}
// Phase 2 of the "interact directly on whatever screen is showing this"
// effort: tap a chore on the chore chart widget to mark it done, right from
// wherever the widget is being viewed — the real wall display, or another
// screen/tablet loading the same URL over LAN or Tailscale. Reuses the exact
// same toggle endpoint (and the same optimistic-update-then-revert-on-
// failure approach) the kid check-off page (/kids) already uses — this is
// bringing that same interaction into the widget itself, not a new one.
// Deliberately excludes photo-required chores: capturing/uploading a photo
// is its own real flow (see /kids), and a wall-mounted screen typically has
// no camera to use for it anyway — tapping one here shows a brief message
// pointing at the kid page instead, rather than silently failing (the
// server enforces this regardless, so this is purely about giving an
// explanation instead of nothing happening).
