// ── Tasks widget: project picker ────────────────────────────────────────────
async function populateTasksProjectDropdown(w) {
  if (!cachedTodoistProjects) {
    const result = await apiFetch('/api/todoist/projects');
    if (Array.isArray(result)) {
      cachedTodoistProjects = result;
    } else {
      // Error case (no token configured, invalid token, etc.)
      const sel = $('tasks-project-select');
      if (sel) {
        sel.innerHTML = `<option value="">⚠️ ${result.error || 'Could not load projects'}</option>`;
      }
      return;
    }
  }

  const sel = $('tasks-project-select');
  if (!sel) return; // panel may have been redrawn already

  sel.innerHTML = `
    <option value="">All Projects</option>
    ${cachedTodoistProjects.map(p => `
      <option value="${p.id}" ${w.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>
    `).join('')}
  `;

  sel.addEventListener('change', (e) => {
    const proj = cachedTodoistProjects.find(p => p.id === e.target.value);
    w.projectId = e.target.value || null;
    w.projectName = proj ? proj.name : 'Tasks';
  });
}

// ── Tasks Combined: multi-project checklist ─────────────────────────────────
async function populateTasksCombinedProjectList(w) {
  if (!cachedTodoistProjects) {
    const result = await apiFetch('/api/todoist/projects');
    if (Array.isArray(result)) {
      cachedTodoistProjects = result;
    } else {
      const container = $('tc-project-list');
      if (container) container.innerHTML = `<p style="font-size:12px;color:var(--muted);margin:0">⚠️ ${result.error || 'Could not load projects'}</p>`;
      return;
    }
  }

  const container = $('tc-project-list');
  if (!container) return; // panel may have been redrawn already

  if (!cachedTodoistProjects.length) {
    container.innerHTML = `<p style="font-size:12px;color:var(--muted);margin:0">No Todoist projects found.</p>`;
    return;
  }

  // No selection yet = nothing checked (unlike calendar source filters, an empty
  // combined Tasks widget isn't useful by default, so this doesn't default to "all").
  const activeSet = new Set(w.projectIds || []);

  container.innerHTML = cachedTodoistProjects.map(p => `
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
      <input type="checkbox" class="tc-project-cb" data-id="${p.id}" data-name="${escapeHtml(p.name)}" ${activeSet.has(p.id) ? 'checked' : ''}
        style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
      ${escapeHtml(p.name)}
    </label>
  `).join('');

  container.querySelectorAll('.tc-project-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...container.querySelectorAll('.tc-project-cb:checked')];
      w.projectIds = checked.map(el => el.dataset.id);
      // Store names alongside IDs so the display side can label groups without
      // needing its own separate project-list fetch.
      w.projectNames = w.projectNames || {};
      checked.forEach(el => { w.projectNames[el.dataset.id] = el.dataset.name; });
    });
  });
}

// ── Calendar source filter (shared by Mini Calendar, Upcoming, Today) ─────────
let cachedFeeds = null; // cache so we don't refetch every time the panel redraws

// Loads the photo library into the picker grid for a photo widget, letting the
// user choose a per-display subset. Selected IDs live on w.photoIds.
async function loadPhotoPickGrid(w) {
  const grid = $('photo-pick-grid');
  if (!grid) return;
  let photos = [];
  try { photos = await apiFetch('/api/photos'); } catch {}
  if (!Array.isArray(photos) || !photos.length) {
    grid.innerHTML = '<div style="font-size:12px;color:var(--muted);grid-column:1/-1">No photos uploaded yet — add some in Settings → Photos.</div>';
    return;
  }
  if (!Array.isArray(w.photoIds)) w.photoIds = [];
  grid.innerHTML = photos.map(p => {
    const sel = w.photoIds.includes(p.id);
    return `<button class="photo-pick${sel?' sel':''}" data-pid="${p.id}" title="${(p.label||'').replace(/"/g,'&quot;')}">
      <img src="/uploads/${p.filename}" alt="">
      <span class="photo-check">✓</span>
    </button>`;
  }).join('');
  grid.querySelectorAll('.photo-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.pid);
      const i = w.photoIds.indexOf(id);
      if (i >= 0) { w.photoIds.splice(i, 1); btn.classList.remove('sel'); }
      else { w.photoIds.push(id); btn.classList.add('sel'); }
      // A plain button click never fires 'change'/'input', so it doesn't reach the
      // delegated auto-save listener on the settings panel (see drawWidgetSettingsPanel())
      // the way every other field in this panel does automatically. Without this, the
      // pick was correctly stored in memory but never actually saved or pushed to the
      // live display — until some unrelated field's real change/input event happened
      // to fire afterward and piggyback the already-mutated photoIds along with it.
      // That's exactly the "toggle the mode dropdown away and back to make it stick"
      // symptom this was reported as.
      autoSaveLayout();
    });
  });
}

async function populateSourceFilterList(w) {
  if (!cachedFeeds) {
    const result = await apiFetch('/api/feeds');
    cachedFeeds = Array.isArray(result) ? result : [];
  }

  const container = $('source-filter-list');
  if (!container) return; // panel may have been redrawn already

  // Build the full list of selectable sources: Local Events + each iCal feed
  const sources = [
    { id: 'local', name: 'Local Events', color: '#4A90D9' },
    ...cachedFeeds.map(f => ({ id: 'feed:' + f.id, name: f.name, color: f.color })),
  ];

  // No filter set yet = everything is shown (matches display-side default behavior)
  const activeSet = Array.isArray(w.sourceFilter) && w.sourceFilter.length
    ? new Set(w.sourceFilter)
    : new Set(sources.map(s => s.id));

  container.innerHTML = sources.map(s => `
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
      <input type="checkbox" class="source-filter-cb" data-id="${s.id}" ${activeSet.has(s.id) ? 'checked' : ''}
        style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
      <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
      ${escapeHtml(s.name)}
    </label>
  `).join('');

  container.querySelectorAll('.source-filter-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...container.querySelectorAll('.source-filter-cb:checked')].map(el => el.dataset.id);
      // If everything is checked, store null so future-added calendars are included
      // automatically rather than silently excluded.
      w.sourceFilter = checked.length === sources.length ? null : checked;
    });
  });
}

// Per-widget feed opacity override — mirrors display.html's own
// renderFeedOpacityOverrideSection()/wireFeedOpacityOverrideSection() pair
// (same data shape: w.feedOpacityOverride = {feedId: percentage}, same
// fallback to the feed's own global color_opacity when this widget has no
// override for a given feed — see eventPillColor() in display.html for the
// two-tier resolution both files ultimately feed into). Async, same reason
// populateSourceFilterList() right above it is: cachedFeeds may need an
// actual fetch the first time a settings panel opens.
async function populateFeedOpacityOverrideList(w) {
  if (!cachedFeeds) {
    const result = await apiFetch('/api/feeds');
    cachedFeeds = Array.isArray(result) ? result : [];
  }
  const container = $('feed-opacity-override-list');
  if (!container) return; // panel may have been redrawn already

  if (!cachedFeeds.length) {
    container.innerHTML = `<div style="font-size:12px;color:var(--muted)">No calendars subscribed yet.</div>`;
    return;
  }

  const overrides = w.feedOpacityOverride || {};
  container.innerHTML = cachedFeeds.map(f => {
    const hasOverride = overrides[f.id] !== undefined && overrides[f.id] !== null;
    const val = hasOverride ? overrides[f.id] : (f.effective_opacity ?? 100);
    return `
      <div class="fop-row" data-feed-id="${f.id}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <label style="margin-bottom:0;display:flex;align-items:center;gap:8px;font-size:13px">
            <span style="width:10px;height:10px;border-radius:50%;background:${f.color};display:inline-block;flex-shrink:0"></span>
            ${escapeHtml(f.name)}
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer">
            Override
            <input type="checkbox" class="fop-toggle" data-feed-id="${f.id}" ${hasOverride?'checked':''} style="width:16px;height:16px;accent-color:var(--accent)">
          </label>
        </div>
        <div class="range-row fop-slider-row" style="${hasOverride?'':'display:none'}">
          <input type="range" class="fop-slider" data-feed-id="${f.id}" min="10" max="100" step="5" value="${val}">
          <span class="range-val fop-slider-val" data-feed-id="${f.id}">${val}%</span>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.fop-toggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const feedId = e.target.dataset.feedId;
      const row = container.querySelector(`.fop-row[data-feed-id="${feedId}"]`);
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
      autoSaveLayout();
    });
  });
  container.querySelectorAll('.fop-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const feedId = e.target.dataset.feedId;
      // The row this slider sits in is only ever shown (via
      // sliderRow.style.display) when this feed's own .fop-toggle checkbox
      // is checked — but that's a visual hiding, not a hard block on the
      // element itself, and this handler previously trusted it as one: it
      // wrote to w.feedOpacityOverride[feedId] unconditionally on 'input',
      // with nothing here checking whether the override was actually
      // supposed to be active. A real report confirmed this could write a
      // value even with the checkbox unchecked. Read the checkbox directly
      // and bail if it isn't checked, so this can't happen regardless of
      // how the slider ended up receiving the event.
      const toggle = container.querySelector(`.fop-toggle[data-feed-id="${feedId}"]`);
      if (!toggle || !toggle.checked) return;
      const val = parseInt(e.target.value, 10);
      w.feedOpacityOverride = w.feedOpacityOverride || {};
      w.feedOpacityOverride[feedId] = val;
      const label = container.querySelector(`.fop-slider-val[data-feed-id="${feedId}"]`);
      if (label) label.textContent = val + '%';
      autoSaveLayout();
    });
  });
}

// Per-widget-per-feed LOCATION override — the app-side twin of display.html's
// renderFeedLocationOverrideSection()/wireFeedLocationOverrideSection(). Same
// data shape (w.feedLocationOverride = {feedId: true|false}); the actual
// show/hide resolution lives in display.html's widgetShowsLocation().
async function populateFeedLocationOverrideList(w) {
  if (!cachedFeeds) {
    const result = await apiFetch('/api/feeds');
    cachedFeeds = Array.isArray(result) ? result : [];
  }
  const container = $('feed-location-override-list');
  if (!container) return;
  if (!cachedFeeds.length) {
    container.innerHTML = `<div style="font-size:12px;color:var(--muted)">No calendars subscribed yet.</div>`;
    return;
  }
  const overrides = w.feedLocationOverride || {};
  container.innerHTML = cachedFeeds.map(f => {
    const has = typeof overrides[f.id] === 'boolean';
    const globalOn = !!f.show_location;
    const val = has ? overrides[f.id] : globalOn;
    return `
      <div class="flo-row" data-feed-id="${f.id}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <label style="margin-bottom:0;display:flex;align-items:center;gap:8px;font-size:13px">
            <span style="width:10px;height:10px;border-radius:50%;background:${f.color};display:inline-block;flex-shrink:0"></span>
            ${escapeHtml(f.name)}
            <span style="font-size:10px;color:var(--muted)">${globalOn ? 'on' : 'off'} globally</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer">
            Override
            <input type="checkbox" class="flo-toggle" data-feed-id="${f.id}" ${has?'checked':''} style="width:16px;height:16px;accent-color:var(--accent)">
          </label>
        </div>
        <div class="flo-value-row" style="${has?'':'display:none'}">
          <select class="form-input flo-value" data-feed-id="${f.id}" style="font-size:13px">
            <option value="1" ${val?'selected':''}>Show location here</option>
            <option value="0" ${!val?'selected':''}>Hide location here</option>
          </select>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.flo-toggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const feedId = e.target.dataset.feedId;
      const row = container.querySelector(`.flo-row[data-feed-id="${feedId}"]`);
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
      autoSaveLayout();
    });
  });
  container.querySelectorAll('.flo-value').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const feedId = e.target.dataset.feedId;
      const toggle = container.querySelector(`.flo-toggle[data-feed-id="${feedId}"]`);
      if (!toggle || !toggle.checked) return;
      w.feedLocationOverride = w.feedLocationOverride || {};
      w.feedLocationOverride[feedId] = e.target.value === '1';
      autoSaveLayout();
    });
  });
}

// ── Layer ordering helpers ──────────────────────────────────────────────────
// Widgets are stored in array order = stacking order (later in array = on top).
// We keep an explicit z to be unambiguous and pass it straight to the display.
function normalizeZ() {
  layoutWidgets.forEach((w, i) => { w.z = i; });
}
function getLayerPosition(w) {
  normalizeZ();
  const idx = layoutWidgets.findIndex(x => x.id === w.id);
  return `${idx + 1} of ${layoutWidgets.length}`;
}
function bringToFront(w) {
  layoutWidgets = layoutWidgets.filter(x => x.id !== w.id);
  layoutWidgets.push(w);
  normalizeZ();
  rebuildCanvas();
  drawWidgetSettingsPanel();
  autoSaveLayout(); // see the audit note by panelExpandBtn — same missing-save class of bug
  showToast('Brought to front');
}
function sendToBack(w) {
  layoutWidgets = layoutWidgets.filter(x => x.id !== w.id);
  layoutWidgets.unshift(w);
  normalizeZ();
  rebuildCanvas();
  drawWidgetSettingsPanel();
  autoSaveLayout();
  showToast('Sent to back');
}
function moveLayer(w, dir) {
  const idx = layoutWidgets.findIndex(x => x.id === w.id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layoutWidgets.length) return;
  const [item] = layoutWidgets.splice(idx, 1);
  layoutWidgets.splice(newIdx, 0, item);
  normalizeZ();
  rebuildCanvas();
  drawWidgetSettingsPanel();
  autoSaveLayout();
  showToast(dir > 0 ? 'Moved forward' : 'Moved backward');
}

// Fine-Tune Position: a zoomed-in crop centered on the selected widget, so small
// adjustments are easier than dragging at full-canvas scale on a small screen.
// Renders every widget (for context) inside a small, clipped viewport panned to
// keep the selected widget centered, and makes just the selected widget's box
// draggable within it — same underlying x/y math as the main canvas's own drag,
// just at a finer effective resolution because the same finger movement now
// covers a smaller percentage of the real canvas.
//
// Zoom is computed from the WIDGET'S OWN size, not a fixed multiplier — a fixed
// 5x, for instance, blows anything bigger than ~20% of the canvas up past the
// edges of the viewport entirely (only ever showing the middle, edges never in
// frame). Instead, pick whatever zoom makes the widget's larger dimension fill
// about TARGET_FILL of the viewport, so its edges are always visible with some
// surrounding context — small widgets get zoomed in a lot, big ones only a little.
const FINE_TUNE_TARGET_FILL = 0.45; // widget's larger side fills ~45% of the viewport
const FINE_TUNE_MIN_ZOOM = 0.6; // lets a very large widget shrink below 1x if needed — keeping all its edges in frame matters more than guaranteeing some minimum magnification
const FINE_TUNE_MAX_ZOOM = 8;   // caps how far a tiny widget gets blown up
function renderFineTune(w) {
  const viewport = $('fine-tune-viewport');
  const stage = $('fine-tune-stage');
  if (!viewport || !stage) return;
  // The viewport's own shape needs to actually match the screen's real
  // proportions, or the "small adjustments" this exists for are being made
  // against the wrong frame entirely. Was a real bug before this: a fixed
  // 190px-tall box regardless of orientation or rotation, so a portrait (or
  // rotated) layout was fine-tuned against a landscape-shaped preview.
  // Reference ratios are the same standard 16:9 used elsewhere as a stand-in
  // for "the real screen's shape" when the exact resolution isn't known —
  // good enough for judging relative position, which is all this is for.
  const current = (typeof cachedDisplays !== 'undefined' && cachedDisplays || []).find(d => d.slug === currentDisplaySlug);
  const rotation = current ? (Number(current.rotation) || 0) : 0;
  let isLandscape = layoutOrientation === 'landscape';
  if (rotation === 90 || rotation === 270) isLandscape = !isLandscape; // rotated 90°/270° swaps which way is "wide"
  viewport.style.aspectRatio = isLandscape ? '16/9' : '9/16';
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  const zoomX = (FINE_TUNE_TARGET_FILL * 100) / Math.max(1, w.w);
  const zoomY = (FINE_TUNE_TARGET_FILL * 100) / Math.max(1, w.h);
  const zoom = Math.min(FINE_TUNE_MAX_ZOOM, Math.max(FINE_TUNE_MIN_ZOOM, Math.min(zoomX, zoomY)));
  const stageW = vw * zoom, stageH = vh * zoom;

  // Pan the stage so the selected widget's center lands on the viewport's center.
  const cx = (w.x + w.w / 2) / 100 * stageW;
  const cy = (w.y + w.h / 2) / 100 * stageH;
  stage.style.position = 'absolute';
  stage.style.width  = stageW + 'px';
  stage.style.height = stageH + 'px';
  stage.style.left = (vw / 2 - cx) + 'px';
  stage.style.top  = (vh / 2 - cy) + 'px';

  stage.innerHTML = layoutWidgets.map(ow => {
    const def = WIDGET_DEFS.find(d => d.type === ow.type) || { icon:'?', label: ow.type };
    const isSel = ow.id === w.id;
    const handles = (isSel && !w.locked && !w.photoFullscreenBg) ? `
      <div class="resize-handle rh-nw" data-corner="nw"></div>
      <div class="resize-handle rh-ne" data-corner="ne"></div>
      <div class="resize-handle rh-sw" data-corner="sw"></div>
      <div class="resize-handle rh-se" data-corner="se"></div>
      <div class="resize-handle rh-n" data-corner="n"></div>
      <div class="resize-handle rh-s" data-corner="s"></div>
      <div class="resize-handle rh-e" data-corner="e"></div>
      <div class="resize-handle rh-w" data-corner="w"></div>
    ` : '';
    return `<div class="ft-widget${isSel ? ' ft-selected' : ''}" data-id="${ow.id}"
      style="position:absolute; left:${ow.x}%; top:${ow.y}%; width:${ow.w}%; height:${ow.h}%;
             box-sizing:border-box; border:2px solid ${isSel ? 'var(--accent)' : 'var(--border)'};
             background:${isSel ? 'rgba(74,144,217,0.25)' : 'rgba(255,255,255,0.03)'};
             border-radius:4px; display:flex; align-items:center; justify-content:center;
             overflow:visible; ${isSel ? 'cursor:grab;touch-action:none;' : 'pointer-events:none;opacity:0.5;'}">
      <span style="font-size:${Math.min(vw, vh) * 0.09}px;white-space:nowrap;overflow:hidden">${def.icon}</span>
      ${handles}
    </div>`;
  }).join('');

  const selEl = stage.querySelector('.ft-selected');
  if (!selEl || w.locked || w.photoFullscreenBg) return;
  selEl.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return; // handled separately below
    e.preventDefault(); e.stopPropagation();
    selEl.style.cursor = 'grabbing';
    const startX = e.clientX, startY = e.clientY;
    const origX = w.x, origY = w.y;
    let movedSnapshotTaken = false;
    const mainEl = document.querySelector(`.editor-widget[data-id="${w.id}"]`);

    function onMove(ev) {
      const dx = ((ev.clientX - startX) / stageW) * 100;
      const dy = ((ev.clientY - startY) / stageH) * 100;
      if (!movedSnapshotTaken && (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)) {
        movedSnapshotTaken = true;
        snapshotLayout();
      }
      w.x = clamp(origX + dx, 0, 100 - w.w);
      w.y = clamp(origY + dy, 0, 100 - w.h);
      // Keep the main canvas in sync live, and re-pan this stage to re-center
      // (rather than sliding the widget to the edge of a static viewport).
      if (mainEl) { mainEl.style.left = w.x + '%'; mainEl.style.top = w.y + '%'; }
      renderFineTune(w);
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (movedSnapshotTaken) { renderLayerList(); autoSaveLayout(); }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Resize handles — same single-vs-both-dimension math as the main canvas's own
  // resize (see startDrag), just converting drag pixels to percent using this
  // zoomed stage's dimensions instead of the full canvas's, which is what makes
  // the same finger movement here produce a finer, more precise size change.
  selEl.querySelectorAll('.resize-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const corner = handle.dataset.corner;
      const startX = e.clientX, startY = e.clientY;
      const origX = w.x, origY = w.y, origW = w.w, origH = w.h;
      const origRight = origX + origW, origBottom = origY + origH;
      const minSize = GRID * 2;
      let movedSnapshotTaken = false;
      const mainEl = document.querySelector(`.editor-widget[data-id="${w.id}"]`);

      function onMove(ev) {
        const dx = ((ev.clientX - startX) / stageW) * 100;
        const dy = ((ev.clientY - startY) / stageH) * 100;
        if (!movedSnapshotTaken && (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)) {
          movedSnapshotTaken = true;
          snapshotLayout();
        }
        if (corner === 'se') {
          w.w = snap(clamp(origW + dx, minSize, 100 - origX));
          w.h = snap(clamp(origH + dy, minSize, 100 - origY));
          w.x = origX; w.y = origY;
        } else if (corner === 'sw') {
          w.x = snap(clamp(origX + dx, 0, origRight - minSize));
          w.w = snap(origRight - w.x);
          w.h = snap(clamp(origH + dy, minSize, 100 - origY));
          w.y = origY;
        } else if (corner === 'ne') {
          w.y = snap(clamp(origY + dy, 0, origBottom - minSize));
          w.h = snap(origBottom - w.y);
          w.w = snap(clamp(origW + dx, minSize, 100 - origX));
          w.x = origX;
        } else if (corner === 'nw') {
          w.x = snap(clamp(origX + dx, 0, origRight - minSize));
          w.w = snap(origRight - w.x);
          w.y = snap(clamp(origY + dy, 0, origBottom - minSize));
          w.h = snap(origBottom - w.y);
        } else if (corner === 'e') {
          w.w = snap(clamp(origW + dx, minSize, 100 - origX));
          w.x = origX; w.y = origY; w.h = origH;
        } else if (corner === 'w') {
          w.x = snap(clamp(origX + dx, 0, origRight - minSize));
          w.w = snap(origRight - w.x);
          w.y = origY; w.h = origH;
        } else if (corner === 'n') {
          w.y = snap(clamp(origY + dy, 0, origBottom - minSize));
          w.h = snap(origBottom - w.y);
          w.x = origX; w.w = origW;
        } else if (corner === 's') {
          w.h = snap(clamp(origH + dy, minSize, 100 - origY));
          w.y = origY; w.x = origX; w.w = origW;
        }
        if (mainEl) {
          mainEl.style.left = w.x + '%'; mainEl.style.top = w.y + '%';
          mainEl.style.width = w.w + '%'; mainEl.style.height = w.h + '%';
        }
        renderFineTune(w);
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (movedSnapshotTaken) { renderLayerList(); autoSaveLayout(); }
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });
}

function startDrag(e, w, el, mode, corner) {
  const canvas = $('editor-canvas');
  const rect = canvas.getBoundingClientRect();
  const startX = e.clientX, startY = e.clientY;
  const origX = w.x, origY = w.y, origW = w.w, origH = w.h;
  // The opposite corner from the one being dragged stays fixed in place — e.g.
  // dragging the top-left handle keeps the bottom-right corner anchored, growing/
  // shrinking the box up and to the left instead of always down-and-right.
  const origRight  = origX + origW;
  const origBottom = origY + origH;
  let movedSnapshotTaken = false;

  function onMove(ev) {
    const dx = ((ev.clientX - startX) / rect.width)  * 100;
    const dy = ((ev.clientY - startY) / rect.height) * 100;
    // Record the pre-move state once, on the first actual movement, so a plain tap
    // (select without moving) doesn't create an empty undo step.
    if (!movedSnapshotTaken && (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2)) {
      movedSnapshotTaken = true;
      snapshotLayout();
    }

    if (mode === 'move') {
      w.x = snap(clamp(origX + dx, 0, 100 - w.w));
      w.y = snap(clamp(origY + dy, 0, 100 - w.h));
      el.style.left = w.x + '%';
      el.style.top  = w.y + '%';
      return;
    }

    // Resize: corners adjust a pair of edges (anchoring the opposite corner);
    // the four edge-middle handles adjust just ONE dimension, anchoring the
    // opposite edge — e.g. dragging the right-middle handle changes only width,
    // left edge fixed in place, height/position untouched.
    const minSize = GRID * 2;
    if (corner === 'se') {
      w.w = snap(clamp(origW + dx, minSize, 100 - origX));
      w.h = snap(clamp(origH + dy, minSize, 100 - origY));
      w.x = origX; w.y = origY;
    } else if (corner === 'sw') {
      w.x = snap(clamp(origX + dx, 0, origRight - minSize));
      w.w = snap(origRight - w.x);
      w.h = snap(clamp(origH + dy, minSize, 100 - origY));
      w.y = origY;
    } else if (corner === 'ne') {
      w.y = snap(clamp(origY + dy, 0, origBottom - minSize));
      w.h = snap(origBottom - w.y);
      w.w = snap(clamp(origW + dx, minSize, 100 - origX));
      w.x = origX;
    } else if (corner === 'nw') {
      w.x = snap(clamp(origX + dx, 0, origRight - minSize));
      w.w = snap(origRight - w.x);
      w.y = snap(clamp(origY + dy, 0, origBottom - minSize));
      w.h = snap(origBottom - w.y);
    } else if (corner === 'e') {
      w.w = snap(clamp(origW + dx, minSize, 100 - origX));
      w.x = origX; w.y = origY; w.h = origH;
    } else if (corner === 'w') {
      w.x = snap(clamp(origX + dx, 0, origRight - minSize));
      w.w = snap(origRight - w.x);
      w.y = origY; w.h = origH;
    } else if (corner === 'n') {
      w.y = snap(clamp(origY + dy, 0, origBottom - minSize));
      w.h = snap(origBottom - w.y);
      w.x = origX; w.w = origW;
    } else if (corner === 's') {
      w.h = snap(clamp(origH + dy, minSize, 100 - origY));
      w.y = origY; w.x = origX; w.w = origW;
    }
    el.style.left   = w.x + '%';
    el.style.top    = w.y + '%';
    el.style.width  = w.w + '%';
    el.style.height = w.h + '%';
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (movedSnapshotTaken) {
      renderLayerList(); autoSaveLayout();
      // Keep the fine-tune zoom view in sync if it's currently showing this widget.
      if (selectedId === w.id && $('fine-tune-viewport')) renderFineTune(w);
    }
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ── Chores tab ────────────────────────────────────────────────────────────────
const KID_AVATARS = ['🙂','😀','😎','🥳','🤓','😺','🦄','🐱','🐶','🐰','🦊','🐼','🐯','🦁','🐨','🐷','🐸','🐵','🦖','🦕','🐬','🦋','🐢','🐙','🦉','🚀','⭐','🌈','⚡','🎨','⚽','🎮','🎸','👑','🧜‍♀️','🦸','🧙','🥷'];
const KID_COLORS = ['#4A90D9','#3ec97a','#ff6b9d','#ffd454','#a78bfa','#f4845f','#2dd4bf','#fb7185'];
const CHORE_ICONS = [...new Set([
  '🪥','🛏️','🧸','🛁','📚','🍽️','🧹','🗑️','👕','🐕','🌱','🚮','🧼','🦷','🎒','✏️','🧺','🍳','💧','🪴','🧴','🐾','⚽','🎹','✅',
  '🧽','🪣','👗','🧦','🪒','🚿','🪟','🧻','🥣','🥤','🧊','🗄️','📦','🚗','🚲','🏡','🌻','🍂','🍁','🦴',
  '📖','🖍️','🎨','🧩','🎻','🎵','💻','📱','⏰','🛒','💵','💰','🐈','🐹','🐦','🐠','🌳','🧤','🎂','🧁','⭐','🏆','🙌'
])];
// Sticker style icons for the kid editor's quick-pick row (used only when
// sticker_style is set to 'custom' — 'star' and 'avatar' don't need a picker
// since they derive from the kid's color/initial or their existing avatar).
const STICKER_EMOJI_OPTS = ['🌟','✨','🎉','🏆','💎','🎯','🥇','🦄','🌈','👑','🎈','🍭'];
// Reward icons for the parent's Rewards editor.
const REWARD_ICONS = ['🎁','🍦','🍕','🎮','🎬','🏊','🧸','📱','🚲','🎨','🛍️','🎢','🍿','⭐','💵'];

async function renderTodoTab() {
  const content = $('content');
  const todoLists = await apiFetch('/api/todo-lists').catch(() => []);
  await Promise.all((todoLists || []).map(async (l) => {
    l.items = await apiFetch(`/api/todo-lists/${l.id}/items`).catch(() => []);
  }));
  const hubLink = `${window.location.origin}/hub`;
  content.innerHTML = `
    <div style="padding:14px">
      <div class="settings-card" style="font-size:12px;color:var(--muted);margin-bottom:12px;padding:14px 16px">
        🏠 Want to manage this without opening the full app? Family Hub (<b>${hubLink}</b> <button class="hub-link-copy-btn" data-url="${hubLink}" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer;vertical-align:middle">📋</button>) has a To-Do tab too — see Settings → Family Hub for a QR code.
      </div>
      <div id="todo-lists-manager">
        ${(todoLists && todoLists.length) ? todoLists.map(l => `
          <div class="acc-section" data-acc="todolist-${l.id}" style="margin-bottom:8px">
            <button class="acc-head" data-acc-toggle="todolist-${l.id}">
              <span class="acc-ic">📝</span>
              <span class="acc-text"><span class="acc-label">${escapeHtml(l.name)}</span><span class="acc-sub">${l.items.length} item${l.items.length===1?'':'s'}</span></span>
              <span class="acc-caret">▸</span>
            </button>
            <div class="acc-body" data-acc-body="todolist-${l.id}" style="display:none;padding:10px">
              <div id="todo-items-${l.id}" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
                ${l.items.length ? l.items.map(it => `
                  <div style="display:flex;align-items:center;gap:8px" data-item-id="${it.id}">
                    <input type="checkbox" class="todo-item-done" data-item-id="${it.id}" ${it.done?'checked':''} style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
                    <span style="flex:1;${it.done?'text-decoration:line-through;color:var(--muted)':''}">${escapeHtml(it.text)}</span>
                    <button type="button" class="icon-btn del small todo-item-del" data-item-id="${it.id}" title="Delete item">🗑️</button>
                  </div>`).join('') : '<p style="font-size:12px;color:var(--muted);margin:0">No items yet.</p>'}
              </div>
              <div style="display:flex;gap:8px">
                <input class="form-input todo-item-input" data-list-id="${l.id}" placeholder="Add an item…" style="flex:1">
                <button type="button" class="todo-item-add-btn" data-list-id="${l.id}" style="background:var(--accent);border:none;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer">Add</button>
              </div>
              <button type="button" class="todo-list-del-btn" data-list-id="${l.id}" data-list-name="${escapeHtml(l.name)}" style="background:none;border:none;color:var(--danger,#ff5d5d);font-size:12px;cursor:pointer;margin-top:10px;padding:0">Delete this list</button>
            </div>
          </div>
        `).join('') : '<div class="empty-state"><div class="emoji">📝</div><p>No lists yet. Add one below, then place a To-Do List widget from the Layout tab.</p></div>'}
        <div style="display:flex;gap:8px;margin-top:8px">
          <input class="form-input" id="todo-newlist-input" placeholder="New list name, e.g. Groceries" style="flex:1">
          <button type="button" id="todo-newlist-btn" style="background:var(--accent);border:none;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer">Add List</button>
        </div>
      </div>
    </div>
  `;
  wireAccordion('todo-lists-manager');
  wireTodoListsManager();
  document.querySelectorAll('.hub-link-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.url));
  });
}

// Same buyUrlFor as the Hub (hub.html) — kept in sync deliberately, not shared
// via an import, since these are two separate static HTML files. If you touch
// one, touch the other.
function buyUrlFor(itemText, store) {
  const q = encodeURIComponent(itemText);
  switch (store) {
    case 'target': return `https://www.target.com/s?searchTerm=${q}`;
    case 'kroger': return `https://www.kroger.com/q/${q}`;
    case 'amazon': return `https://www.amazon.com/s?k=${q}`;
    case 'walmart':
    default: return `https://www.walmart.com/search?query=${q}`;
  }
}

// Which shopping list the tab is showing — remembered across visits.
let _shopSelectedList = null;
async function renderShoppingTab() {
  const content = $('content');
  let lists = [], items = [], settings = {};
  try { [lists, settings] = await Promise.all([apiFetch('/api/shopping-lists'), apiFetch('/api/settings')]); } catch {}
  if (!Array.isArray(lists)) lists = [];
  let sel = _shopSelectedList;
  try { if (sel == null) sel = Number(localStorage.getItem('shopping_selected_list')) || null; } catch {}
  const cur = lists.find(l => l.id === sel) || lists[0] || null;
  _shopSelectedList = cur ? cur.id : null;
  try { items = await apiFetch('/api/shopping-list' + (cur ? '?list=' + cur.id : '')); } catch {}
  if (!Array.isArray(items)) items = [];
  const store = (settings && settings.shopping_store) || 'walmart';
  content.innerHTML = `
    <div style="padding:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <select class="form-input" id="shop-list-select" style="flex:1;min-width:140px">
          ${lists.map(l => `<option value="${l.id}" ${cur && cur.id === l.id ? 'selected' : ''}>${escapeHtml(l.name)}${l.open_count ? ' (' + l.open_count + ')' : ''}</option>`).join('')}
        </select>
        <button type="button" id="shop-list-new-btn" class="ghost small" title="Add a list">＋ New list</button>
        <button type="button" id="shop-list-rename-btn" class="ghost small" title="Rename this list">Rename</button>
        ${lists.length > 1 ? '<button type="button" id="shop-list-delete-btn" class="icon-btn del small" title="Delete this list">🗑️</button>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <label style="font-size:13px;color:var(--muted);flex-shrink:0">Buy links search</label>
        <select class="form-input" id="shop-store-select" style="width:auto">
          <option value="walmart" ${store==='walmart'?'selected':''}>Walmart</option>
          <option value="target" ${store==='target'?'selected':''}>Target</option>
          <option value="kroger" ${store==='kroger'?'selected':''}>Kroger</option>
          <option value="amazon" ${store==='amazon'?'selected':''}>Amazon</option>
        </select>
        <div class="spacer"></div>
        <button type="button" id="shop-clear-btn" class="ghost small">Clear checked</button>
      </div>
      <div id="shop-items" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        ${(items && items.length) ? items.map(it => `
          <div class="settings-card" style="display:flex;align-items:center;gap:10px;padding:10px 12px" data-item-id="${it.id}">
            <input type="checkbox" class="shop-item-done" data-item-id="${it.id}" ${it.done?'checked':''} style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
            <span class="shop-item-text" style="flex:1;${it.done?'text-decoration:line-through;color:var(--muted)':''}">${escapeHtml(it.text)}</span>
            <a class="ghost small" href="${buyUrlFor(it.text, store)}" target="_blank" rel="noopener" style="text-decoration:none">🛍️ Buy</a>
            <button type="button" class="icon-btn del small shop-item-del" data-item-id="${it.id}" title="Delete item">🗑️</button>
          </div>`).join('') : '<div class="empty-state"><div class="emoji">🛒</div><p>Nothing on the list yet.</p></div>'}
      </div>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="shop-newitem-input" placeholder="Add an item…" style="flex:1">
        <button type="button" id="shop-newitem-btn" style="background:var(--accent);border:none;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer">Add</button>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:14px">Also available as its own installable app at <b>/hub</b> (Shopping tab), and as a wall-display widget from the Layout tab — each widget shows one list.</p>
    </div>
  `;
  wireShoppingListManager(store, cur);
}
function wireShoppingListManager(store, cur) {
  const wrap = $('shop-items');
  if (!wrap) return;
  const listId = cur ? cur.id : undefined;

  if ($('shop-list-select')) $('shop-list-select').addEventListener('change', (e) => {
    _shopSelectedList = parseInt(e.target.value);
    try { localStorage.setItem('shopping_selected_list', String(_shopSelectedList)); } catch {}
    renderShoppingTab();
  });
  if ($('shop-list-new-btn')) $('shop-list-new-btn').addEventListener('click', async () => {
    const name = (prompt('Name for the new list (e.g. Costco):') || '').trim();
    if (!name) return;
    const r = await apiFetch('/api/shopping-lists', { method: 'POST', body: JSON.stringify({ name }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    _shopSelectedList = r.id;
    try { localStorage.setItem('shopping_selected_list', String(r.id)); } catch {}
    renderShoppingTab();
  });
  if ($('shop-list-rename-btn')) $('shop-list-rename-btn').addEventListener('click', async () => {
    if (!cur) return;
    const name = (prompt('Rename this list:', cur.name) || '').trim();
    if (!name || name === cur.name) return;
    const r = await apiFetch(`/api/shopping-lists/${cur.id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    renderShoppingTab();
  });
  if ($('shop-list-delete-btn')) $('shop-list-delete-btn').addEventListener('click', async () => {
    if (!cur) return;
    if (!confirm(`Delete "${cur.name}" and everything on it?`)) return;
    const r = await apiFetch(`/api/shopping-lists/${cur.id}`, { method: 'DELETE' });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    _shopSelectedList = null;
    try { localStorage.removeItem('shopping_selected_list'); } catch {}
    renderShoppingTab();
  });

  if ($('shop-store-select')) $('shop-store-select').addEventListener('change', async (e) => {
    await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ shopping_store: e.target.value }) });
    renderShoppingTab(); // re-render so every Buy link picks up the new store immediately
  });

  if ($('shop-newitem-btn')) $('shop-newitem-btn').addEventListener('click', addShopItem);
  if ($('shop-newitem-input')) $('shop-newitem-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addShopItem(); });
  async function addShopItem() {
    const input = $('shop-newitem-input');
    const text = input.value.trim();
    if (!text) return;
    const r = await apiFetch('/api/shopping-list', { method: 'POST', body: JSON.stringify({ text, list_id: listId }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    input.value = '';
    renderShoppingTab();
  }

  wrap.querySelectorAll('.shop-item-done').forEach(cb => cb.addEventListener('change', async (e) => {
    const id = e.target.dataset.itemId;
    await apiFetch(`/api/shopping-items/${id}`, { method: 'PUT', body: JSON.stringify({ done: e.target.checked }) });
    const span = wrap.querySelector(`[data-item-id="${id}"] .shop-item-text`);
    if (span) span.style.cssText = e.target.checked ? 'flex:1;text-decoration:line-through;color:var(--muted)' : 'flex:1';
  }));
  wrap.querySelectorAll('.shop-item-del').forEach(btn => btn.addEventListener('click', async () => {
    await apiFetch(`/api/shopping-items/${btn.dataset.itemId}`, { method: 'DELETE' });
    renderShoppingTab();
  }));

  if ($('shop-clear-btn')) $('shop-clear-btn').addEventListener('click', async () => {
    if (!confirm('Clear every checked-off item on this list?')) return;
    await apiFetch('/api/shopping-list/clear-done' + (listId !== undefined ? '?list=' + listId : ''), { method: 'POST' });
    renderShoppingTab();
  });
}

let _choreState = { kids: [], chores: [] };

async function renderChoresTab() {
  const content = $('content');
  let kids = [], chores = [], choreChart = null, rewards = [], stickerMode = 'manual';
  try {
    [kids, chores, choreChart, rewards] = await Promise.all([apiFetch('/api/kids'), apiFetch('/api/chores'), apiFetch('/api/chore-chart'), apiFetch('/api/rewards')]);
    const s = await apiFetch('/api/settings');
    stickerMode = (s && s.sticker_award_mode) || 'manual';
  } catch {}
  _choreState.kids = kids; _choreState.chores = chores;

  const kidName = id => { const k = kids.find(x => x.id === parseInt(id)); return k ? k.name : 'Unknown'; };
  const assigneeLabel = assignee => assignee === 'all' ? 'Everyone' :
    String(assignee).split(',').map(s => s.trim()).filter(Boolean).map(kidName).join(', ');
  const freqLabel = c => {
    if (c.freq === 'once') return c.on_date ? `Once on ${c.on_date}` : 'Once';
    if (c.freq === 'daily') return 'Every day';
    if (c.freq === 'weekly') return c.byday ? c.byday.split(',').join(', ') : 'Every day (weekly)';
    return c.freq;
  };
  // Balance lookup from the same chore-chart response the kid cards already use
  // (stickerBalance is included per kid there) — avoids a second round-trip per kid.
  const stickerBalanceFor = id => {
    const k = (choreChart && choreChart.kids || []).find(x => x.id === id);
    return k ? (k.stickerBalance || 0) : 0;
  };

  // Today's chores across every kid, flattened, for the reassign section below.
  // Only undone ones get a reassign control (see the endpoint's own restriction:
  // a completed instance may already have an allowance ledger row tied to the
  // original kid, so swapping it isn't offered here — un-check it first).
  const todayItems = (choreChart && choreChart.kids) ? choreChart.kids.flatMap(k =>
    (k.chores || []).map(c => ({ ...c, kid_id: k.id, kid_name: k.name, kid_avatar: k.avatar, kid_color: k.color }))
  ) : [];
  const otherKidOptions = (forKidId) => kids.filter(k => k.id !== forKidId)
    .map(k => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join('');
  const todayRows = todayItems.length ? todayItems.map(c => `
    <div class="settings-card" style="display:flex;align-items:center;gap:10px;padding:10px 12px;${c.done?'opacity:.5':''}">
      <span style="font-size:22px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${choreIconHtmlApp(c.icon, 26)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${escapeHtml(c.title)}${c.done?' ✓':''}${c.overdue?' <span style="color:#ffb454">(from before)</span>':''}</div>
        <div style="font-size:11px;color:${c.kid_color||'var(--muted)'}">${c.kid_avatar||''} ${escapeHtml(c.kid_name)}</div>
      </div>
      ${c.done ? '' : `
        <select class="form-input today-reassign" data-inst="${c.instance_id}" data-kid="${c.kid_id}" style="width:auto;font-size:12px;padding:6px 8px">
          <option value="">Reassign to…</option>
          ${otherKidOptions(c.kid_id)}
        </select>`}
    </div>`).join('') : `<div class="empty-state"><div class="emoji">📆</div><p>No chores today.</p></div>`;

  const kidCards = kids.length ? kids.map(k => `
    <div class="settings-card" style="display:flex;align-items:center;gap:12px">
      <span style="font-size:34px">${k.avatar||'🙂'}</span>
      <div style="flex:1">
        <div style="font-weight:600;color:${k.color}">${escapeHtml(k.name)}</div>
        <div style="font-size:12px;color:var(--muted)">${k.display_mode === 'pictures' ? 'Pictures' : k.display_mode === 'words' ? 'Words' : 'Pictures + words'}${k.allowance_enabled ? ' · 💰 allowance on' : ''} · ⭐ ${stickerBalanceFor(k.id)}</div>
      </div>
      <button class="icon-btn kid-stickers" data-id="${k.id}" title="Stickers &amp; Rewards">${stickerBadgeHtmlApp(k, 20)}</button>
      ${k.allowance_enabled ? `<button class="icon-btn kid-allowance" data-id="${k.id}" title="Allowance">💰</button>` : ''}
      <button class="icon-btn kid-stats" data-id="${k.id}" title="History">📊</button>
      <button class="icon-btn kid-edit" data-id="${k.id}" title="Edit">✏️</button>
      <button class="icon-btn del kid-del" data-id="${k.id}" title="Remove">🗑️</button>
    </div>`).join('') : `<div class="empty-state"><div class="emoji">🧒</div><p>No kids yet. Add one to start.</p></div>`;

  const choreCards = chores.length ? chores.map(c => `
    <div class="settings-card" style="display:flex;align-items:center;gap:12px;${c.active?'':'opacity:.5'}">
      <span style="font-size:30px;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${choreIconHtmlApp(c.icon, 34)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${escapeHtml(c.title)}${c.bonus ? ' 🎁' : ''}</div>
        <div style="font-size:12px;color:var(--muted)">
          ${c.bonus ? 'Bonus — shared pool' : `${c.rotate && c.freq !== 'once' ? '🔄 Takes turns: ' : ''}${assigneeLabel(c.assignee)} · ${freqLabel(c)}${c.at_time ? ' · ' + c.at_time : ''}${c.carryover ? ' · carries over' : ''}`}${c.celebrate ? '' : ' · no celebration'}${c.pay_amount ? ` · 💰 ${i18n.money(Number(c.pay_amount))}` : ''}${c.photo_required ? ' · 📷 photo required' : ''}
        </div>
      </div>
      <button class="icon-btn chore-edit" data-id="${c.id}" title="Edit">✏️</button>
      <button class="icon-btn del chore-del" data-id="${c.id}" title="Delete">🗑️</button>
    </div>`).join('') : `<div class="empty-state"><div class="emoji">📋</div><p>No chores yet. Add one below.</p></div>`;

  const rewardCards = rewards.length ? rewards.map(r => `
    <div class="settings-card" style="display:flex;align-items:center;gap:12px;${r.active?'':'opacity:.5'}">
      <span style="font-size:28px;width:34px;height:34px;display:flex;align-items:center;justify-content:center">${r.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${escapeHtml(r.title)}</div>
        <div style="font-size:12px;color:var(--muted)">⭐ ${r.star_cost} · ${assigneeLabel(r.assignee)}</div>
      </div>
      <button class="icon-btn reward-edit" data-id="${r.id}" title="Edit">✏️</button>
      <button class="icon-btn del reward-del" data-id="${r.id}" title="Delete">🗑️</button>
    </div>`).join('') : `<div class="empty-state"><div class="emoji">🎁</div><p>No rewards yet. Add one below — e.g. "Ice cream trip" for 10 stars.</p></div>`;

  const kidLink = `${window.location.origin}/kids`;
  const hubLink = `${window.location.origin}/hub`;

  content.innerHTML = `
    <div class="section-header">Today's Chores</div>
    <div id="today-chores-acc">
      ${accordionSection({ id:'today-chores', icon:'📆', label:"Today's Chores", sub: todayItems.length ? `${todayItems.filter(c=>c.done).length}/${todayItems.length} done` : 'Nothing due', inner: todayRows })}
    </div>

    <div class="section-header" style="margin-top:22px">Kids</div>
    <div class="settings-card" style="font-size:12px;color:var(--muted);padding:14px 16px">
      📱 Kids open <b>${kidLink}</b> <button class="hub-link-copy-btn" data-url="${kidLink}" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer;vertical-align:middle">📋</button> on their tablet (over Tailscale), tap their name, and check off chores. The page remembers each kid per device.
      <br><br>🏠 Want Chores, To-Do, and Shopping together in one installable app instead of the full calendar? That's <b>${hubLink}</b> <button class="hub-link-copy-btn" data-url="${hubLink}" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer;vertical-align:middle">📋</button> — see Settings → Family Hub for a QR code.
    </div>
    <div id="kids-list">${kidCards}</div>
    <button class="btn" id="add-kid-btn" style="background:var(--card);border:1px solid var(--border);margin-top:8px">+ Add Kid</button>

    <div class="section-header" style="margin-top:22px">Chores</div>
    <div id="chores-list">${choreCards}</div>
    <button class="btn btn-primary" id="add-chore-btn" style="margin-top:8px">+ Add Chore</button>

    <div class="section-header" style="margin-top:22px">⭐ Stickers &amp; Rewards</div>
    <div class="settings-card" style="padding:14px 16px">
      <div style="font-weight:600;font-size:13px">How are stickers awarded?</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">Tap ${stickerBadgeHtmlApp({sticker_style:'star',color:'#4A90D9',name:'?'},13)} on a kid's card to give one anytime, either way.</div>
      <select class="form-input" id="sticker-mode-select" style="margin-top:10px">
        <option value="manual" ${stickerMode==='manual'?'selected':''}>Manual</option>
        <option value="auto" ${stickerMode==='auto'?'selected':''}>Auto (on chore completion)</option>
      </select>
    </div>
    <div class="section-header" style="margin-top:14px;font-size:13px">Rewards</div>
    <div id="rewards-list">${rewardCards}</div>
    <button class="btn btn-primary" id="add-reward-btn" style="margin-top:8px">+ Add Reward</button>
  `;

  wireAccordion('today-chores-acc');
  document.querySelectorAll('.hub-link-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.url));
  });
  content.querySelectorAll('.today-reassign').forEach(sel => sel.addEventListener('change', async (e) => {
    const newKidId = e.target.value;
    if (!newKidId) return;
    const instId = e.target.dataset.inst;
    e.target.disabled = true;
    const r = await apiFetch(`/api/chore-instances/${instId}/reassign`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ kid_id: Number(newKidId) }) });
    if (r && r.ok) {
      showToast('✓ Reassigned');
      renderChoresTab();
    } else {
      showToast('❌ ' + ((r && r.error) || 'Could not reassign'));
      e.target.value = ''; e.target.disabled = false;
    }
  }));
  $('add-kid-btn').addEventListener('click', () => openKidEditor(null));
  $('add-chore-btn').addEventListener('click', () => openChoreEditor(null));
  $('add-reward-btn').addEventListener('click', () => openRewardEditor(null));
  $('sticker-mode-select').addEventListener('change', async (e) => {
    const mode = e.target.value;
    const r = await apiFetch('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sticker_award_mode: mode }) });
    if (r && !r.__authFailed) showToast(mode === 'auto' ? '⭐ Auto-award on' : '⭐ Manual award only');
    else { showToast('❌ Could not save'); e.target.value = stickerMode; }
  });
  content.querySelectorAll('.kid-edit').forEach(b => b.addEventListener('click', () => openKidEditor(kids.find(k => k.id === parseInt(b.dataset.id)))));
  content.querySelectorAll('.kid-del').forEach(b => b.addEventListener('click', () => deleteKid(parseInt(b.dataset.id))));
  content.querySelectorAll('.kid-stickers').forEach(b => b.addEventListener('click', () => openStickerSheet(kids.find(k => k.id === parseInt(b.dataset.id)))));
  content.querySelectorAll('.kid-allowance').forEach(b => b.addEventListener('click', () => openAllowanceSheet(kids.find(k => k.id === parseInt(b.dataset.id)))));
  content.querySelectorAll('.kid-stats').forEach(b => b.addEventListener('click', () => openStatsSheet(kids.find(k => k.id === parseInt(b.dataset.id)))));
  content.querySelectorAll('.chore-edit').forEach(b => b.addEventListener('click', () => openChoreEditor(chores.find(c => c.id === parseInt(b.dataset.id)))));
  content.querySelectorAll('.chore-del').forEach(b => b.addEventListener('click', () => deleteChore(parseInt(b.dataset.id))));
  content.querySelectorAll('.reward-edit').forEach(b => b.addEventListener('click', () => openRewardEditor(rewards.find(r => r.id === parseInt(b.dataset.id)))));
  content.querySelectorAll('.reward-del').forEach(b => b.addEventListener('click', () => deleteReward(parseInt(b.dataset.id))));
}

function openKidEditor(kid) {
  const isNew = !kid;
  kid = kid || { name:'', color:KID_COLORS[0], avatar:'🙂', display_mode:'both', allowance_enabled:1, allowance_mode:'per_chore', weekly_rate:0, sticker_style:'star', sticker_emoji:'' };
  const avatarOpts = KID_AVATARS.map(a => `<button type="button" class="emoji-pick ${a===kid.avatar?'sel':''}" data-v="${a}" style="font-size:26px;background:${a===kid.avatar?'var(--accent)':'var(--card)'};border:1px solid var(--border);border-radius:10px;padding:6px;cursor:pointer">${a}</button>`).join('');
  const colorOpts = KID_COLORS.map(c => `<button type="button" class="color-pick ${c===kid.color?'sel':''}" data-v="${c}" style="width:34px;height:34px;border-radius:50%;background:${c};border:3px solid ${c===kid.color?'#fff':'transparent'};cursor:pointer"></button>`).join('');
  const stickerStyle = kid.sticker_style || 'star';
  const stickerEmojiOpts = STICKER_EMOJI_OPTS.map(e => `<button type="button" class="emoji-pick sticker-emoji-pick ${e===kid.sticker_emoji?'sel':''}" data-v="${e}" style="font-size:24px;background:${e===kid.sticker_emoji?'var(--accent)':'var(--card)'};border:1px solid var(--border);border-radius:10px;padding:6px;cursor:pointer">${e}</button>`).join('');
  showSheet(`
    <h3 style="margin:0 0 14px">${isNew ? 'Add Kid' : 'Edit Kid'}</h3>
    <label class="lbl">Name</label>
    <input class="form-input" id="kid-name" value="${escapeHtml(kid.name)}" placeholder="e.g. Suzy">
    <label class="lbl" style="margin-top:12px">Avatar</label>
    <div id="kid-avatars" style="display:flex;flex-wrap:wrap;gap:6px">${avatarOpts}</div>
    <button type="button" class="btn" id="kid-emoji-btn" style="background:var(--card);border:1px solid var(--border);margin-top:6px;font-size:13px">😀 More emoji…</button>
    <label class="lbl" style="margin-top:12px">Color</label>
    <div id="kid-colors" style="display:flex;gap:10px">${colorOpts}</div>
    <label class="lbl" style="margin-top:12px">Show chores as</label>
    <select class="form-input" id="kid-mode">
      <option value="both" ${kid.display_mode==='both'?'selected':''}>Pictures + words</option>
      <option value="pictures" ${kid.display_mode==='pictures'?'selected':''}>Pictures only (pre-reader)</option>
      <option value="words" ${kid.display_mode==='words'?'selected':''}>Words only</option>
    </select>
    <label class="lbl" style="margin-top:12px">⭐ Sticker style</label>
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px">How ${kid.name ? escapeHtml(kid.name) : 'this kid'}'s sticker badge looks on the calendar, chore chart, and their own page.</p>
    <select class="form-input" id="kid-sticker-style">
      <option value="star" ${stickerStyle==='star'?'selected':''}>⭐ Colored star with initial</option>
      <option value="avatar" ${stickerStyle==='avatar'?'selected':''}>${kid.avatar||'🙂'} Their avatar</option>
      <option value="custom" ${stickerStyle==='custom'?'selected':''}>🎯 A different emoji…</option>
    </select>
    <div id="kid-sticker-emoji-row" style="display:${stickerStyle==='custom'?'block':'none'};margin-top:8px">
      <div id="kid-sticker-emojis" style="display:flex;flex-wrap:wrap;gap:6px">${stickerEmojiOpts}</div>
      <button type="button" class="btn" id="kid-sticker-emoji-btn" style="background:var(--card);border:1px solid var(--border);margin-top:6px;font-size:13px">😀 More emoji…</button>
    </div>
    <label class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:16px">
      <span>💰 Allowance</span>
      <input type="checkbox" id="kid-allowance-enabled" ${kid.allowance_enabled?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
    </label>
    <div id="kid-allowance-opts" style="display:${kid.allowance_enabled?'block':'none'};margin-top:10px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:12px">
      <label class="lbl">How is it earned?</label>
      <select class="form-input" id="kid-allowance-mode">
        <option value="per_chore" ${kid.allowance_mode==='per_chore'?'selected':''}>Pay per chore completed</option>
        <option value="weekly_flat" ${kid.allowance_mode==='weekly_flat'?'selected':''}>Flat weekly amount</option>
      </select>
      <p style="font-size:11px;color:var(--muted);margin-top:6px" id="kid-allowance-hint">Set how much each chore pays when you edit that chore.</p>
      <div id="kid-weekly-rate-row" style="display:${kid.allowance_mode==='weekly_flat'?'block':'none'};margin-top:10px">
        <label class="lbl">Weekly amount (${i18n.currencySymbol()}) ${infoBtn("Credited automatically once per calendar week, regardless of which chores get done.")}</label>
        <input class="form-input" id="kid-weekly-rate" type="number" min="0" step="0.01" value="${kid.weekly_rate||0}" placeholder="e.g. 5.00">
      </div>
      <label class="lbl" style="margin-top:12px">🎯 Saving for (optional)</label>
      <input class="form-input" id="kid-goal-name" value="${escapeHtml(kid.savings_goal_name||'')}" placeholder="e.g. Lego set">
      <label class="lbl" style="margin-top:10px">Goal amount (${i18n.currencySymbol()}) ${infoBtn("Shows a progress bar toward this on the kid's chore screen, based on their current balance. Purely motivational — doesn't limit payouts.")}</label>
      <input class="form-input" id="kid-goal-amount" type="number" min="0" step="0.01" value="${kid.savings_goal_amount||''}" placeholder="e.g. 20.00">
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-primary" id="kid-save" style="flex:1">${isNew?'Add':'Save'}</button>
      <button class="btn" id="kid-cancel" style="flex:1;background:var(--card);border:1px solid var(--border)">Cancel</button>
    </div>
  `);
  $('kid-allowance-enabled').addEventListener('change', e => {
    $('kid-allowance-opts').style.display = e.target.checked ? 'block' : 'none';
  });
  $('kid-allowance-mode').addEventListener('change', e => {
    const weekly = e.target.value === 'weekly_flat';
    $('kid-weekly-rate-row').style.display = weekly ? 'block' : 'none';
    $('kid-allowance-hint').style.display = weekly ? 'none' : 'block';
  });
  $('kid-sticker-style').addEventListener('change', e => {
    $('kid-sticker-emoji-row').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
  let selAvatar = kid.avatar, selColor = kid.color, selStickerEmoji = kid.sticker_emoji || STICKER_EMOJI_OPTS[0];
  $('kid-emoji-btn').addEventListener('click', () => openEmojiPicker(emoji => {
    selAvatar = emoji;
    // Reflect choice: clear other selections, and if it's in the quick row highlight it.
    document.querySelectorAll('#kid-avatars .emoji-pick').forEach(x => x.style.background = (x.dataset.v === emoji ? 'var(--accent)' : 'var(--card)'));
    showToast(`Avatar: ${emoji}`);
  }));
  document.querySelectorAll('#kid-avatars .emoji-pick').forEach(b => b.addEventListener('click', () => {
    selAvatar = b.dataset.v;
    document.querySelectorAll('#kid-avatars .emoji-pick').forEach(x => x.style.background = 'var(--card)');
    b.style.background = 'var(--accent)';
  }));
  document.querySelectorAll('#kid-colors .color-pick').forEach(b => b.addEventListener('click', () => {
    selColor = b.dataset.v;
    document.querySelectorAll('#kid-colors .color-pick').forEach(x => x.style.border = '3px solid transparent');
    b.style.border = '3px solid #fff';
  }));
  $('kid-sticker-emoji-btn').addEventListener('click', () => openEmojiPicker(emoji => {
    selStickerEmoji = emoji;
    document.querySelectorAll('#kid-sticker-emojis .emoji-pick').forEach(x => x.style.background = (x.dataset.v === emoji ? 'var(--accent)' : 'var(--card)'));
    showToast(`Sticker: ${emoji}`);
  }));
  document.querySelectorAll('#kid-sticker-emojis .emoji-pick').forEach(b => b.addEventListener('click', () => {
    selStickerEmoji = b.dataset.v;
    document.querySelectorAll('#kid-sticker-emojis .emoji-pick').forEach(x => x.style.background = 'var(--card)');
    b.style.background = 'var(--accent)';
  }));
  $('kid-cancel').addEventListener('click', closeSheet);
  $('kid-save').addEventListener('click', async () => {
    const name = $('kid-name').value.trim();
    if (!name) { showToast('Please enter a name'); return; }
    const allowanceEnabled = $('kid-allowance-enabled').checked;
    const body = {
      name, avatar:selAvatar, color:selColor, display_mode:$('kid-mode').value,
      allowance_enabled: allowanceEnabled,
      allowance_mode: $('kid-allowance-mode').value,
      weekly_rate: Number($('kid-weekly-rate').value) || 0,
      savings_goal_name: $('kid-goal-name').value.trim(),
      savings_goal_amount: Number($('kid-goal-amount').value) || 0,
      sticker_style: $('kid-sticker-style').value,
      sticker_emoji: selStickerEmoji,
    };
    try {
      if (isNew) await apiFetch('/api/kids', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      else await apiFetch(`/api/kids/${kid.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      closeSheet(); renderChoresTab();
    } catch { showToast('❌ Could not save'); }
  });
}

// Shows a kid's running allowance balance, recent history, and lets the parent
// record a payout (cash handed over) or a manual bonus/deduction. This was
// referenced by the 💰 button but never implemented — the backend ledger
// (per-chore credits, weekly flat credits, payouts, adjustments) already existed
// and worked; only this view was missing.
async function openAllowanceSheet(kid) {
  if (!kid) return;
  showSheet(`<h3 style="margin:0 0 14px">💰 ${escapeHtml(kid.name)}'s Allowance</h3><p style="color:var(--muted)">Loading…</p>`);
  let data;
  try { data = await apiFetch(`/api/kids/${kid.id}/allowance`); }
  catch { showSheet(`<h3 style="margin:0 0 14px">💰 Allowance</h3><p>❌ Could not load.</p><button class="btn" id="al-close" style="width:100%;margin-top:10px;background:var(--card);border:1px solid var(--border)">Close</button>`); $('al-close').addEventListener('click', closeSheet); return; }

  const balance = data.balance || 0;
  const typeIcon = t => ({ chore:'✅', weekly:'📅', payout:'💵', adjustment:'⚖️' }[t] || '•');
  const typeLabel = (e) => {
    if (e.type === 'chore') return 'Chore completed';
    if (e.type === 'weekly') return 'Weekly allowance';
    if (e.type === 'payout') return e.note ? `Paid out — ${escapeHtml(e.note)}` : 'Paid out';
    if (e.type === 'adjustment') return e.note ? escapeHtml(e.note) : (e.amount >= 0 ? 'Bonus' : 'Deduction');
    return e.type;
  };
  const rows = (data.entries || []).map(e => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:18px">${typeIcon(e.type)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px">${typeLabel(e)}</div>
        <div style="font-size:11px;color:var(--muted)">${e.date}</div>
      </div>
      <div style="font-weight:700;color:${e.amount >= 0 ? '#3ec97a' : '#fb7185'}">${i18n.money(e.amount, { sign: true })}</div>
    </div>`).join('') || `<p style="color:var(--muted);font-size:13px">No activity yet.</p>`;

  showSheet(`
    <h3 style="margin:0 0 4px">💰 ${escapeHtml(kid.name)}'s Allowance</h3>
    <div style="font-size:38px;font-weight:800;color:${balance >= 0 ? 'var(--text)' : '#fb7185'};margin:10px 0">${i18n.money(balance)}</div>
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <button class="btn" id="al-payout-btn" style="flex:1;background:var(--card);border:1px solid var(--border)">💵 Record Payout</button>
      <button class="btn" id="al-adjust-btn" style="flex:1;background:var(--card);border:1px solid var(--border)">⚖️ Bonus / Deduction</button>
    </div>
    <div id="al-form"></div>
    <div class="section-header" style="margin:14px 0 6px">Recent activity</div>
    <div style="max-height:32vh;overflow-y:auto">${rows}</div>
    <button class="btn" id="al-close" style="width:100%;margin-top:16px;background:var(--card);border:1px solid var(--border)">Close</button>
  `);

  const showMiniForm = (kind) => {
    const isPayout = kind === 'payout';
    $('al-form').innerHTML = `
      <div style="padding:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:10px">
        <label class="lbl">${isPayout ? `Amount paid out (${i18n.currencySymbol()})` : 'Amount (use negative for a deduction)'}</label>
        <input class="form-input" id="al-amount" type="number" step="0.01" ${isPayout ? 'min="0.01"' : ''} placeholder="${isPayout ? 'e.g. 10.00' : 'e.g. 2.00 or -2.00'}">
        <label class="lbl" style="margin-top:8px">Note (optional)</label>
        <input class="form-input" id="al-note" placeholder="${isPayout ? 'e.g. Cash for the week' : 'e.g. Extra help with dishes'}">
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-primary" id="al-submit" style="flex:1">${isPayout ? 'Record' : 'Save'}</button>
          <button class="btn" id="al-form-cancel" style="flex:1;background:var(--bg);border:1px solid var(--border)">Cancel</button>
        </div>
      </div>`;
    $('al-form-cancel').addEventListener('click', () => { $('al-form').innerHTML = ''; });
    $('al-submit').addEventListener('click', async () => {
      const amount = Number($('al-amount').value);
      if (!Number.isFinite(amount) || amount === 0 || (isPayout && amount < 0)) { showToast('Enter a valid amount'); return; }
      const note = $('al-note').value.trim();
      try {
        await apiFetch(`/api/kids/${kid.id}/allowance/${isPayout ? 'payout' : 'adjust'}`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ amount, note })
        });
        openAllowanceSheet(kid); // reload with fresh balance/history
      } catch { showToast('❌ Could not save'); }
    });
  };
  $('al-payout-btn').addEventListener('click', () => showMiniForm('payout'));
  $('al-adjust-btn').addEventListener('click', () => showMiniForm('adjust'));
  $('al-close').addEventListener('click', closeSheet);
}

// Parent-facing history/stats view: streak, 7/30-day completion rate, all-time
// total, and a simple day-by-day bar strip for the last few weeks so a parent can
// see patterns (e.g. weekends slipping) without digging through raw data.
async function openStatsSheet(kid) {
  if (!kid) return;
  showSheet(`<h3 style="margin:0 0 14px">📊 ${escapeHtml(kid.name)}'s History</h3><p style="color:var(--muted)">Loading…</p>`);
  let data;
  try { data = await apiFetch(`/api/kids/${kid.id}/stats?days=28`); }
  catch { showSheet(`<h3 style="margin:0 0 14px">📊 History</h3><p>❌ Could not load.</p><button class="btn" id="st-close" style="width:100%;margin-top:10px;background:var(--card);border:1px solid var(--border)">Close</button>`); $('st-close').addEventListener('click', closeSheet); return; }

  const pctText = p => p === null ? '—' : `${p}%`;
  const bars = data.daily.map(d => {
    const pct = d.total ? Math.round((d.done / d.total) * 100) : null;
    const color = pct === null ? 'var(--border)' : pct === 100 ? '#3ec97a' : pct > 0 ? '#ffb454' : '#fb7185';
    const h = pct === null ? 6 : Math.max(6, Math.round(pct * 0.01 * 46));
    const dow = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0">
      <div title="${d.date}: ${d.total ? `${d.done}/${d.total} done` : 'nothing due'}" style="width:100%;max-width:14px;height:46px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${h}px;background:${color};border-radius:3px 3px 0 0"></div>
      </div>
      <div style="font-size:9px;color:var(--muted)">${dow}</div>
    </div>`;
  }).join('');

  showSheet(`
    <h3 style="margin:0 0 14px">📊 ${escapeHtml(kid.name)}'s History</h3>
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800">${data.streak > 0 ? '🔥 ' + data.streak : '—'}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">day streak</div>
      </div>
      <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800">${pctText(data.last7Pct)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">last 7 days</div>
      </div>
      <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800">${pctText(data.last30Pct)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">last 30 days</div>
      </div>
    </div>
    <div class="section-header" style="margin:0 0 8px">Last 4 weeks</div>
    <div style="display:flex;gap:3px;align-items:flex-end;padding:8px 4px;background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:14px">${bars}</div>
    <p style="font-size:12px;color:var(--muted);margin:0 0 16px">✅ ${data.allTimeCompleted} chore${data.allTimeCompleted === 1 ? '' : 's'} completed all-time. Gray bars mean nothing was due that day, not a miss.</p>
    <button class="btn" id="st-close" style="width:100%;background:var(--card);border:1px solid var(--border)">Close</button>
  `);
  $('st-close').addEventListener('click', closeSheet);
}

async function deleteKid(id) {
  const k = _choreState.kids.find(x => x.id === id);
  if (!confirm(`Remove ${k ? k.name : 'this kid'}? Their chore history will be cleared.`)) return;
  try { await apiFetch(`/api/kids/${id}`, { method:'DELETE' }); renderChoresTab(); } catch { showToast('❌ Could not remove'); }
}

// Sticker badge preview HTML for a kid — same three styles the calendar widget,
// chore chart widget, and kids.html all render, kept in one place so a change
// to what a style looks like only has to happen here (this function IS the
// spec other renderers copy, not a separate parallel implementation).
function stickerBadgeHtmlApp(kid, sizePx = 28) {
  const initial = (kid.name || '?').trim().charAt(0).toUpperCase() || '?';
  if (kid.sticker_style === 'avatar') {
    return `<span style="font-size:${sizePx}px;line-height:1">${kid.avatar || '🙂'}</span>`;
  }
  if (kid.sticker_style === 'custom' && kid.sticker_emoji) {
    return `<span style="font-size:${sizePx}px;line-height:1">${kid.sticker_emoji}</span>`;
  }
  // Default: a colored star with the kid's initial inside.
  return `<span style="position:relative;display:inline-block;width:${sizePx}px;height:${sizePx}px">
    <svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}"><path fill="${kid.color || '#4A90D9'}" d="M12 1.5l3.09 6.26 6.91 1-5 4.87 1.18 6.88L12 17.27l-6.18 3.24L7 13.63l-5-4.87 6.91-1z"/></svg>
    <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding-top:${Math.round(sizePx*0.08)}px;font-size:${Math.round(sizePx*0.42)}px;font-weight:800;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.35)">${initial}</span>
  </span>`;
}

// Sticker balance, recent history, "give a sticker" (manual award, always
// available regardless of sticker_award_mode — see server-side comment), and
// available rewards with redeem buttons. Mirrors openAllowanceSheet's shape:
// balance up top, actions below it, recent activity at the bottom.
async function openStickerSheet(kid) {
  if (!kid) return;
  showSheet(`<h3 style="margin:0 0 14px">${stickerBadgeHtmlApp(kid, 22)} ${escapeHtml(kid.name)}'s Stickers</h3><p style="color:var(--muted)">Loading…</p>`);
  let data, rewards;
  try {
    [data, rewards] = await Promise.all([apiFetch(`/api/kids/${kid.id}/stickers`), apiFetch('/api/rewards')]);
  } catch {
    showSheet(`<h3 style="margin:0 0 14px">⭐ Stickers</h3><p>❌ Could not load.</p><button class="btn" id="sk-close" style="width:100%;margin-top:10px;background:var(--card);border:1px solid var(--border)">Close</button>`);
    $('sk-close').addEventListener('click', closeSheet); return;
  }
  const balance = data.balance || 0;
  const kidRewards = (rewards || []).filter(r => r.active && (r.assignee === 'all' || String(r.assignee).split(',').map(s=>s.trim()).includes(String(kid.id))));

  const rewardRows = kidRewards.length ? kidRewards.map(r => {
    const afford = balance >= r.star_cost;
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);${afford?'':'opacity:.55'}">
      <span style="font-size:22px">${r.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600">${escapeHtml(r.title)}</div>
        <div style="font-size:11px;color:var(--muted)">⭐ ${r.star_cost}</div>
      </div>
      <button class="btn sk-redeem" data-id="${r.id}" data-cost="${r.star_cost}" data-title="${escapeHtml(r.title)}" ${afford?'':'disabled'} style="width:auto;flex-shrink:0;margin-top:0;font-size:12px;padding:8px 12px;background:${afford?'var(--accent)':'var(--card)'};border:1px solid var(--border)">Redeem</button>
    </div>`;
  }).join('') : `<p style="font-size:12px;color:var(--muted)">No rewards set up yet — add one in the Rewards section below.</p>`;

  const historyRows = [
    ...(data.stickers||[]).map(s => ({ date:s.date, icon:'⭐', label: s.note ? `Bonus — ${escapeHtml(s.note)}` : (s.chore_instance_id ? 'Earned (chore)' : 'Earned'), amt:'+1', id:s.id, isSticker:true })),
    ...(data.redemptions||[]).map(r => ({ date:r.date, icon:'🎁', label:`Redeemed — ${escapeHtml(r.reward_title)}`, amt:`-${r.star_cost}`, id:r.id, isRedemption:true })),
  ].sort((a,b) => a.date < b.date ? 1 : -1).slice(0, 40);
  const historyHtml = historyRows.length ? historyRows.map(h => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:16px">${h.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px">${h.label}</div>
        <div style="font-size:11px;color:var(--muted)">${h.date}</div>
      </div>
      <div style="font-weight:700;color:${h.amt.startsWith('+')?'#3ec97a':'#fb7185'}">${h.amt}</div>
      ${h.isRedemption ? `<button class="icon-btn sk-undo" data-id="${h.id}" title="Undo">↩︎</button>` : ''}
      ${h.isSticker ? `<button class="icon-btn sk-del-sticker" data-id="${h.id}" title="Remove this sticker">🗑️</button>` : ''}
    </div>`).join('') : `<p style="color:var(--muted);font-size:13px">No activity yet.</p>`;

  showSheet(`
    <h3 style="margin:0 0 4px">${stickerBadgeHtmlApp(kid, 22)} ${escapeHtml(kid.name)}'s Stickers</h3>
    <div style="font-size:38px;font-weight:800;margin:10px 0">⭐ ${balance}</div>
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <button class="btn btn-primary" id="sk-give-btn" style="flex:1">🏅 Give a Sticker</button>
      <button class="btn" id="sk-clear-btn" style="flex:1;background:var(--card);border:1px solid var(--border);color:#fb7185" ${(data.stickers||[]).length ? '' : 'disabled'}>🧹 Clear All</button>
    </div>
    <div id="sk-give-form"></div>
    <div class="section-header" style="margin:0 0 6px">Rewards</div>
    <div style="margin-bottom:14px">${rewardRows}</div>
    <div class="section-header" style="margin:0 0 6px">Recent activity</div>
    <div style="max-height:26vh;overflow-y:auto">${historyHtml}</div>
    <button class="btn" id="sk-close" style="width:100%;margin-top:16px;background:var(--card);border:1px solid var(--border)">Close</button>
  `);

  $('sk-give-btn').addEventListener('click', () => {
    const todayStr = (()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
    $('sk-give-form').innerHTML = `
      <div style="padding:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:10px">
        <label class="lbl">Date</label>
        <input class="form-input" id="sk-date" type="date" value="${todayStr}" max="${todayStr}">
        <label class="lbl" style="margin-top:10px">Reason (optional)</label>
        <input class="form-input" id="sk-note" placeholder="e.g. Great sharing today!">
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-primary" id="sk-submit" style="flex:1">Give ⭐</button>
          <button class="btn" id="sk-form-cancel" style="flex:1;background:var(--bg);border:1px solid var(--border)">Cancel</button>
        </div>
      </div>`;
    $('sk-form-cancel').addEventListener('click', () => { $('sk-give-form').innerHTML = ''; });
    $('sk-submit').addEventListener('click', async () => {
      const date = $('sk-date').value || todayStr;
      const note = $('sk-note').value.trim();
      const r = await apiFetch('/api/stickers', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ kid_id: kid.id, date, note }) });
      if (r && r.id) { showToast('⭐ Sticker given!'); renderChoresTab(); openStickerSheet(kid); }
      else showToast('❌ ' + ((r && r.error) || 'Could not save'));
    });
  });
  $('sk-clear-btn').addEventListener('click', async () => {
    if (!confirm(`Clear all of ${kid.name}'s stickers? This resets their balance to 0 and can't be undone. Redemption history is kept either way.`)) return;
    const r = await apiFetch(`/api/stickers?kid_id=${kid.id}`, { method:'DELETE' });
    if (r && r.ok) { showToast('🧹 Cleared'); renderChoresTab(); openStickerSheet(kid); }
    else showToast('❌ ' + ((r && r.error) || 'Could not clear'));
  });
  document.querySelectorAll('.sk-redeem').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Redeem "${b.dataset.title}" for ${b.dataset.cost} stars?`)) return;
    const r = await apiFetch(`/api/rewards/${b.dataset.id}/redeem`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ kid_id: kid.id }) });
    if (r && r.ok) { showToast('🎉 Redeemed!'); renderChoresTab(); openStickerSheet(kid); }
    else showToast('❌ ' + ((r && r.error) || 'Could not redeem'));
  }));
  document.querySelectorAll('.sk-undo').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Undo this redemption and give the stars back?')) return;
    const r = await apiFetch(`/api/sticker-redemptions/${b.dataset.id}`, { method:'DELETE' });
    if (r && r.ok) { renderChoresTab(); openStickerSheet(kid); }
    else showToast('❌ Could not undo');
  }));
  document.querySelectorAll('.sk-del-sticker').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this sticker?')) return;
    const r = await apiFetch(`/api/stickers/${b.dataset.id}`, { method:'DELETE' });
    if (r && r.ok) { renderChoresTab(); openStickerSheet(kid); }
    else showToast('❌ Could not remove');
  }));
  $('sk-close').addEventListener('click', closeSheet);
}

function openChoreEditor(chore) {
  const isNew = !chore;
  chore = chore || { title:'', icon:'✅', assignee:'all', freq:'daily', byday:'', on_date:'', at_time:'', carryover:0, celebrate:1, photo_required:0, bonus:0, active:1 };
  const kids = _choreState.kids;
  const iconOpts = CHORE_ICONS.map(i => `<button type="button" class="emoji-pick" data-v="${i}" style="font-size:24px;background:${i===chore.icon?'var(--accent)':'var(--card)'};border:1px solid var(--border);border-radius:10px;padding:5px;cursor:pointer">${i}</button>`).join('');
  const selAssignees = chore.assignee === 'all' ? new Set(['all']) :
    new Set(String(chore.assignee || 'all').split(',').map(s => s.trim()).filter(Boolean));
  if (!selAssignees.size) selAssignees.add('all');
  const whoBtn = (val, label) => `<button type="button" class="who-pick" data-v="${val}" style="padding:8px 14px;border-radius:20px;border:1px solid var(--border);background:${selAssignees.has(val)?'var(--accent)':'var(--card)'};color:var(--text);cursor:pointer;font-size:13px">${label}</button>`;
  const whoOpts = whoBtn('all', 'Everyone') + kids.map(k => whoBtn(String(k.id), escapeHtml(k.name))).join('');
  const days = ['MO','TU','WE','TH','FR','SA','SU'];
  const dayLabels = {MO:'Mon',TU:'Tue',WE:'Wed',TH:'Thu',FR:'Fri',SA:'Sat',SU:'Sun'};
  const selDays = new Set((chore.byday||'').split(',').filter(Boolean));
  const dayBtns = days.map(d => `<button type="button" class="day-pick" data-v="${d}" style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);background:${selDays.has(d)?'var(--accent)':'var(--card)'};color:var(--text);cursor:pointer;font-size:12px">${dayLabels[d]}</button>`).join('');

  showSheet(`
    <h3 style="margin:0 0 14px">${isNew ? 'Add Chore' : 'Edit Chore'}</h3>
    <label class="lbl">What is it?</label>
    <input class="form-input" id="chore-title" value="${escapeHtml(chore.title)}" placeholder="e.g. Brush teeth">
    <label class="lbl" style="margin-top:12px">Picture</label>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <div id="chore-icon-preview" style="width:54px;height:54px;border-radius:12px;background:var(--card);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:32px;overflow:hidden">${choreIconHtmlApp(chore.icon, 50)}</div>
      <button type="button" class="btn" id="chore-emoji-btn" style="background:var(--card);border:1px solid var(--border);flex:1">😀 Pick emoji</button>
      <button type="button" class="btn" id="chore-photo-btn" style="background:var(--card);border:1px solid var(--border);flex:1">📷 Upload photo</button>
    </div>
    <input type="file" id="chore-photo-input" accept="image/*" style="display:none">
    <div id="chore-icons" style="display:flex;flex-wrap:wrap;gap:6px">${iconOpts}</div>
    <label class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px">
      <span>🎁 Bonus chore <span style="color:var(--muted);font-weight:400">— shared pool, anyone can claim it</span></span>
      <input type="checkbox" id="chore-bonus" ${chore.bonus?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
    </label>
    <div id="chore-normal-fields" style="display:${chore.bonus?'none':'block'}">
    <label class="lbl" style="margin-top:12px">Who? ${infoBtn("Tap \"Everyone\" or pick one or more specific kids.")}</label>
    <div id="chore-who" style="display:flex;flex-wrap:wrap;gap:8px">${whoOpts}</div>
    <div id="chore-rotate-block">
      <label class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px">
        <span>🔄 Take turns <span style="color:var(--muted);font-weight:400">— a different person each day</span> ${infoBtn("Instead of giving this chore to everyone picked, ONE of them has it each day, and it moves to the next person the next time the chore comes up. Set up each chore once and it keeps cycling by itself. Give each of your chores a different \"Starts with\" so everyone has something different every night.")}</span>
        <input type="checkbox" id="chore-rotate" ${chore.rotate?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </label>
      <div id="chore-rotate-start-wrap" style="display:${chore.rotate?'block':'none'}">
        <label class="lbl" style="margin-top:10px">Starts with <span style="color:var(--muted);font-weight:400">— whose turn it is today</span></label>
        <div id="chore-rotate-start" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>
    </div>
    <label class="lbl" style="margin-top:12px">When?</label>    <select class="form-input" id="chore-freq">
      <option value="daily" ${chore.freq==='daily'?'selected':''}>Every day</option>
      <option value="weekly" ${chore.freq==='weekly'?'selected':''}>Certain days of the week</option>
      <option value="once" ${chore.freq==='once'?'selected':''}>One time</option>
    </select>
    <div id="freq-weekly" style="margin-top:10px;display:${chore.freq==='weekly'?'flex':'none'};gap:5px">${dayBtns}</div>
    <div id="freq-once" style="margin-top:10px;display:${chore.freq==='once'?'block':'none'}">
      <input class="form-input" id="chore-date" type="date" value="${chore.on_date||''}">
    </div>
    <label class="lbl" style="margin-top:12px">Time (optional)</label>
    <input class="form-input" id="chore-time" type="time" value="${chore.at_time||''}">
    <label class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
      <span>Carry over if not done</span>
      <input type="checkbox" id="chore-carry" ${chore.carryover?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
    </label>
    </div>
    <label class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <span>Celebrate when finished 🎉</span>
      <input type="checkbox" id="chore-celebrate" ${chore.celebrate?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
    </label>
    <label class="toggle-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <span>📷 Require a photo to mark done</span>
      <input type="checkbox" id="chore-photo-required" ${chore.photo_required?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
    </label>
    <label class="lbl" style="margin-top:12px">💰 Pay per completion (optional) ${infoBtn("Only used for kids whose allowance is set to \"Pay per chore completed\" — ignored otherwise. Leave blank for no pay.")}</label>
    <input class="form-input" id="chore-pay" type="number" min="0" step="0.01" value="${chore.pay_amount||''}" placeholder="e.g. 0.50">
    <label class="lbl" style="margin-top:12px">Notes for the kid (optional)</label>
    <textarea class="form-input" id="chore-notes" rows="2" placeholder="e.g. Don't forget behind the ears!">${escapeHtml(chore.notes||'')}</textarea>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-primary" id="chore-save" style="flex:1">${isNew?'Add':'Save'}</button>
      <button class="btn" id="chore-cancel" style="flex:1;background:var(--card);border:1px solid var(--border)">Cancel</button>
    </div>
  `);

  let selIcon = chore.icon;
  const updateIconPreview = () => { $('chore-icon-preview').innerHTML = choreIconHtmlApp(selIcon, 50); };
  const setIcon = (v) => {
    selIcon = v;
    document.querySelectorAll('#chore-icons .emoji-pick').forEach(x => x.style.background = (x.dataset.v === v ? 'var(--accent)' : 'var(--card)'));
    updateIconPreview();
  };
  document.querySelectorAll('#chore-icons .emoji-pick').forEach(b => b.addEventListener('click', () => setIcon(b.dataset.v)));
  // Global emoji picker
  $('chore-emoji-btn').addEventListener('click', () => openEmojiPicker(emoji => setIcon(emoji)));
  // Custom photo upload
  $('chore-photo-btn').addEventListener('click', () => $('chore-photo-input').click());
  $('chore-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('photo', file);
    $('chore-photo-btn').textContent = 'Uploading…';
    try {
      const r = await apiFetch('/api/chore-image', { method:'POST', body: fd });
      if (r && r.icon) { setIcon(r.icon); }
      else showToast('❌ Upload failed');
    } catch { showToast('❌ Upload failed'); }
    $('chore-photo-btn').textContent = '📷 Upload photo';
  });
  // Take turns: "Starts with" offers the people picked above (everyone when "Everyone" is picked); never a person who is not in the cycle.
  let selStart = String(chore.rotate_start || '');
  const rotateCandidates = () => selAssignees.has('all') ? kids : kids.filter(k => selAssignees.has(String(k.id)));
  const syncRotate = () => {
    const once = $('chore-freq').value === 'once';
    $('chore-rotate-block').style.display = once ? 'none' : 'block';
    const on = $('chore-rotate').checked && !once;
    $('chore-rotate-start-wrap').style.display = on ? 'block' : 'none';
    const cands = rotateCandidates();
    if (!cands.some(k => String(k.id) === selStart)) selStart = cands.length ? String(cands[0].id) : '';
    $('chore-rotate-start').innerHTML = cands.map(k => `<button type="button" class="start-pick" data-v="${k.id}" style="padding:8px 14px;border-radius:20px;border:1px solid var(--border);background:${String(k.id)===selStart?'var(--accent)':'var(--card)'};color:var(--text);cursor:pointer">${escapeHtml(k.name)}</button>`).join('');
    $('chore-rotate-start').querySelectorAll('.start-pick').forEach(b => b.addEventListener('click', () => { selStart = b.dataset.v; syncRotate(); }));
  };
  $('chore-rotate').addEventListener('change', syncRotate);
  document.querySelectorAll('#chore-who .who-pick').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.v;
    if (v === 'all') {
      selAssignees.clear(); selAssignees.add('all');
    } else {
      selAssignees.delete('all');
      if (selAssignees.has(v)) selAssignees.delete(v); else selAssignees.add(v);
      if (!selAssignees.size) selAssignees.add('all'); // never allow zero kids selected
    }
    document.querySelectorAll('#chore-who .who-pick').forEach(x => {
      x.style.background = selAssignees.has(x.dataset.v) ? 'var(--accent)' : 'var(--card)';
    });
    syncRotate();
  }));
  document.querySelectorAll('#freq-weekly .day-pick').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset.v;
    if (selDays.has(d)) { selDays.delete(d); b.style.background = 'var(--card)'; }
    else { selDays.add(d); b.style.background = 'var(--accent)'; }
  }));
  $('chore-freq').addEventListener('change', e => {
    $('freq-weekly').style.display = e.target.value === 'weekly' ? 'flex' : 'none';
    $('freq-once').style.display = e.target.value === 'once' ? 'block' : 'none';
    syncRotate();
  });
  syncRotate();
  $('chore-bonus').addEventListener('change', e => {
    $('chore-normal-fields').style.display = e.target.checked ? 'none' : 'block';
  });
  $('chore-cancel').addEventListener('click', closeSheet);
  $('chore-save').addEventListener('click', async () => {
    const title = $('chore-title').value.trim();
    if (!title) { showToast('Please enter a chore'); return; }
    const freq = $('chore-freq').value;
    const body = {
      title, icon:selIcon, assignee: selAssignees.has('all') ? 'all' : [...selAssignees].join(','), freq,
      byday: freq === 'weekly' ? [...selDays].join(',') : '',
      on_date: freq === 'once' ? $('chore-date').value : '',
      at_time: $('chore-time').value || '',
      carryover: $('chore-carry').checked, celebrate: $('chore-celebrate').checked,
      pay_amount: Number($('chore-pay').value) || 0,
      notes: $('chore-notes').value.trim(),
      photo_required: $('chore-photo-required').checked,
      bonus: $('chore-bonus').checked,
      rotate: $('chore-rotate').checked && freq !== 'once' && !$('chore-bonus').checked,
      rotate_start: Number(selStart) || 0,
    };
    try {
      if (isNew) await apiFetch('/api/chores', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      else await apiFetch(`/api/chores/${chore.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...body, active:chore.active}) });
      closeSheet(); renderChoresTab();
    } catch { showToast('❌ Could not save'); }
  });
}

async function deleteChore(id) {
  const c = _choreState.chores.find(x => x.id === id);
  if (!confirm(`Delete "${c ? c.title : 'this chore'}"?`)) return;
  try { await apiFetch(`/api/chores/${id}`, { method:'DELETE' }); renderChoresTab(); } catch { showToast('❌ Could not delete'); }
}

// Reward editor — deliberately reuses openChoreEditor's exact "Who?" pill-picker
// pattern (Everyone or one-or-more specific kids) rather than inventing a second
// assignee UI, since rewards' assignee field is the same shape as chores' for
// the same reason (an older kid's bigger-ticket goal vs. something shared).
function openRewardEditor(reward) {
  const isNew = !reward;
  reward = reward || { title:'', icon:'🎁', star_cost:10, assignee:'all', active:1 };
  const kids = _choreState.kids;
  const iconOpts = REWARD_ICONS.map(i => `<button type="button" class="emoji-pick" data-v="${i}" style="font-size:24px;background:${i===reward.icon?'var(--accent)':'var(--card)'};border:1px solid var(--border);border-radius:10px;padding:5px;cursor:pointer">${i}</button>`).join('');
  const selAssignees = reward.assignee === 'all' ? new Set(['all']) :
    new Set(String(reward.assignee || 'all').split(',').map(s => s.trim()).filter(Boolean));
  if (!selAssignees.size) selAssignees.add('all');
  const whoBtn = (val, label) => `<button type="button" class="who-pick" data-v="${val}" style="padding:8px 14px;border-radius:20px;border:1px solid var(--border);background:${selAssignees.has(val)?'var(--accent)':'var(--card)'};color:var(--text);cursor:pointer;font-size:13px">${label}</button>`;
  const whoOpts = whoBtn('all', 'Everyone') + kids.map(k => whoBtn(String(k.id), escapeHtml(k.name))).join('');

  showSheet(`
    <h3 style="margin:0 0 14px">${isNew ? 'Add Reward' : 'Edit Reward'}</h3>
    <label class="lbl">What is it?</label>
    <input class="form-input" id="reward-title" value="${escapeHtml(reward.title)}" placeholder="e.g. Ice cream trip">
    <label class="lbl" style="margin-top:12px">Icon</label>
    <div id="reward-icons" style="display:flex;flex-wrap:wrap;gap:6px">${iconOpts}</div>
    <button type="button" class="btn" id="reward-emoji-btn" style="background:var(--card);border:1px solid var(--border);margin-top:6px;font-size:13px">😀 More emoji…</button>
    <label class="lbl" style="margin-top:12px">⭐ Star cost</label>
    <input class="form-input" id="reward-cost" type="number" min="1" step="1" value="${reward.star_cost||10}" placeholder="e.g. 10">
    <label class="lbl" style="margin-top:12px">Who can redeem it?</label>
    <div id="reward-who" style="display:flex;flex-wrap:wrap;gap:8px">${whoOpts}</div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-primary" id="reward-save" style="flex:1">${isNew?'Add':'Save'}</button>
      <button class="btn" id="reward-cancel" style="flex:1;background:var(--card);border:1px solid var(--border)">Cancel</button>
    </div>
  `);

  let selIcon = reward.icon;
  document.querySelectorAll('#reward-icons .emoji-pick').forEach(b => b.addEventListener('click', () => {
    selIcon = b.dataset.v;
    document.querySelectorAll('#reward-icons .emoji-pick').forEach(x => x.style.background = (x.dataset.v === selIcon ? 'var(--accent)' : 'var(--card)'));
  }));
  $('reward-emoji-btn').addEventListener('click', () => openEmojiPicker(emoji => {
    selIcon = emoji;
    document.querySelectorAll('#reward-icons .emoji-pick').forEach(x => x.style.background = 'var(--card)');
    showToast(`Icon: ${emoji}`);
  }));
  document.querySelectorAll('#reward-who .who-pick').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.v;
    if (v === 'all') {
      selAssignees.clear(); selAssignees.add('all');
    } else {
      selAssignees.delete('all');
      if (selAssignees.has(v)) selAssignees.delete(v); else selAssignees.add(v);
      if (!selAssignees.size) selAssignees.add('all'); // never allow zero kids selected
    }
    document.querySelectorAll('#reward-who .who-pick').forEach(x => {
      x.style.background = selAssignees.has(x.dataset.v) ? 'var(--accent)' : 'var(--card)';
    });
  }));
  $('reward-cancel').addEventListener('click', closeSheet);
  $('reward-save').addEventListener('click', async () => {
    const title = $('reward-title').value.trim();
    if (!title) { showToast('Please enter a reward name'); return; }
    const starCost = parseInt($('reward-cost').value);
    if (!Number.isFinite(starCost) || starCost <= 0) { showToast('Enter a star cost of 1 or more'); return; }
    const body = {
      title, icon:selIcon, star_cost:starCost,
      assignee: selAssignees.has('all') ? 'all' : [...selAssignees].join(','),
    };
    const r = isNew
      ? await apiFetch('/api/rewards', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
      : await apiFetch(`/api/rewards/${reward.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...body, active:reward.active}) });
    if (r && r.id) { closeSheet(); renderChoresTab(); }
    else showToast('❌ ' + ((r && r.error) || 'Could not save'));
  });
}

async function deleteReward(id) {
  if (!confirm('Delete this reward? Past redemptions of it are kept in history either way.')) return;
  const r = await apiFetch(`/api/rewards/${id}`, { method:'DELETE' });
  if (r && r.ok) renderChoresTab();
  else showToast('❌ Could not delete');
}

// Renders a chore icon for the app UI — emoji, or an uploaded image token.
function choreIconHtmlApp(icon, px) {
  if (icon && icon.indexOf('img:') === 0) {
    return `<img src="/uploads/${encodeURIComponent(icon.slice(4))}" alt="" style="width:${px}px;height:${px}px;object-fit:cover;border-radius:10px">`;
  }
  return icon || '✅';
}

