// ── Entity Status advanced settings (Live Edit parity) ──────────────────────
// Title and font size stay in the basic panel (already worked before this —
// see WIDGET_BASIC_SETTINGS) — this panel adds exactly what was missing:
// picking WHICH entity, and the Show Unit toggle.
function renderEntityStatusAdvancedSettings(w) {
  const areaOpts = haAreaOptionsHtmlD();
  const current = w.haEntityId ? (cachedHaEntitiesD || []).find(e => e.entity_id === w.haEntityId) : null;
  return `
    <div class="was-row">
      <label>Currently Selected</label>
      <p class="was-hint" style="margin-top:0">${w.haEntityId ? escapeHtmlD((current && current.friendly_name) || w.haEntityId) : 'None — choose one below'}</p>
    </div>
    <div class="was-row">
      <label>Search Entities</label>
      <input type="text" id="was-ha-search" placeholder="Search…">
    </div>
    ${areaOpts ? `<div class="was-row"><label>Area</label><select id="was-ha-area">${areaOpts}</select></div>` : ''}
    <div class="was-box" id="was-ha-list" style="max-height:280px;overflow-y:auto;padding:4px"></div>
    <div class="was-row">
      <label>Template wizard (optional) ${infoBtn("Write a Home Assistant template and the widget shows what Home Assistant makes of it. Not sure where to start? Tap Step by step, or Recipes for ready-made ones, and the Insert buttons add the right code for you. Put **double asterisks** around words to make them bold. The display asks Home Assistant again every few seconds. More examples: piazzahq.com/template-cookbook. When this is filled in it replaces the entity control above.")}</label>
      <textarea id="was-ha-template" rows="5" spellcheck="false" autocapitalize="none" placeholder="{{ states('sensor.washer') | title }}" style="width:100%;font-family:monospace;font-size:13px">${escapeHtmlD(w.haTemplate || '')}</textarea>
      <div id="was-ha-template-tools"></div>
    </div>
    <div class="was-row">
      <label>Template Alignment ${infoBtn("Which side of the widget the Template text lines up to. Left or Right keeps it snug against one edge, handy in a narrow column or a tight layout.")}</label>
      <select id="was-ha-align">
          <option value="center" ${(w.haAlign||'center')==='center'?'selected':''}>Center</option>
          <option value="left" ${w.haAlign==='left'?'selected':''}>Left</option>
          <option value="right" ${w.haAlign==='right'?'selected':''}>Right</option>
        </select>
    </div>
    <div class="was-toggle-row">
      <label>Show Unit ${infoBtn("Title and font size are set in the basic settings panel.")}</label>
      <input type="checkbox" id="was-ha-showunit" ${w.haShowUnit !== false ? 'checked' : ''}>
    </div>
    <div class="was-toggle-row">
      <label>Show Trend Graph ${infoBtn("The 24-hour line graph under a numeric sensor's value. Sensor entities only.")}</label>
      <input type="checkbox" id="was-ha-showsparkline" ${w.haShowSparkline !== false ? 'checked' : ''}>
    </div>
    <div class="was-toggle-row">
      <label>Show Time in This State ${infoBtn("Adds a small line under the value saying how long it has been like this, e.g. \"Cycle complete · 2 hr. ago\" for a washing machine.")}</label>
      <input type="checkbox" id="was-ha-showsince" ${w.haShowSince ? 'checked' : ''}>
    </div>
  `;
}
function wireEntityStatusAdvancedSettings(w) {
  const listEl = document.getElementById('was-ha-list');
  const searchEl = document.getElementById('was-ha-search');
  const areaEl = document.getElementById('was-ha-area');
  const refreshList = () => {
    if (!listEl) return;
    const list = filterHaEntitiesD(searchEl ? searchEl.value : '', areaEl ? areaEl.value : '');
    listEl.innerHTML = haEntityRowsHtmlD(list, (id) => id === w.haEntityId);
    listEl.querySelectorAll('.was-ha-row').forEach(row => {
      row.addEventListener('click', () => {
        const newId = row.dataset.id;
        const entity = (cachedHaEntitiesD || []).find(e => e.entity_id === newId);
        const newName = (entity && entity.friendly_name) || newId;
        // Same auto-label-follow rule as app.html's openEntityPicker(): only
        // touch the label if it's empty or was itself auto-filled from
        // whichever entity this widget PREVIOUSLY pointed to — never
        // overwrite a label someone actually typed themselves.
        if (!w.haLabel || w.haLabelAutoFor === w.haEntityId) {
          w.haLabel = newName;
          w.haLabelAutoFor = newId;
        }
        w.haEntityId = newId;
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id); // full refresh — "Currently Selected" and the checkmark both need to move
      });
    });
  };
  refreshList();
  if (searchEl) searchEl.addEventListener('input', refreshList);
  if (areaEl) areaEl.addEventListener('change', refreshList);
  const tplBox = document.getElementById('was-ha-template');
  if (tplBox) tplBox.addEventListener('change', async (e) => {
    w.haTemplate = e.target.value.trim();
    try { await fetchHaEntities(); } catch {}
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const tplTools = document.getElementById('was-ha-template-tools');
  if (tplTools && tplBox && window.HaTemplateBuilder) HaTemplateBuilder.mount({
    box: tplBox, host: tplTools,
    getEntities: () => fetch('/api/ha/entities').then((r) => r.json()),
    preview: (template) => fetch('/api/ha/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template }) }).then((r) => r.json()),
  });
  const alignSel = document.getElementById('was-ha-align');
  if (alignSel) alignSel.addEventListener('change', (e) => {
    w.haAlign = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showUnit = document.getElementById('was-ha-showunit');
  if (showUnit) showUnit.addEventListener('change', (e) => {
    w.haShowUnit = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showSince = document.getElementById('was-ha-showsince');
  if (showSince) showSince.addEventListener('change', (e) => {
    w.haShowSince = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showSparkline = document.getElementById('was-ha-showsparkline');
  if (showSparkline) showSparkline.addEventListener('change', (e) => {
    w.haShowSparkline = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

// ── Smart Home Dashboard advanced settings (Live Edit parity) ───────────────
// Title/font stay in the basic panel — this panel adds the whole entity
// management surface that was previously app.html-only: multi-select with
// area filter + bulk "Add all", per-entity room labels, and the Group by
// Room toggle.
function renderSmartHomeDashboardAdvancedSettings(w) {
  if (!Array.isArray(w.haEntityIds)) w.haEntityIds = [];
  if (!Array.isArray(w.haAreaIds)) w.haAreaIds = [];
  if (!Array.isArray(w.haComboGroups)) w.haComboGroups = [];
  const areaOpts = haAreaOptionsHtmlD();
  return `
    <p class="was-hint">A grid of tiles built from the devices and rooms you pick. It is not a copy of a Home Assistant dashboard — to show one of those, use a Web Page widget.</p>
    <div class="was-row">
      <label>View</label>
      <select id="was-ha-view-select">
        <option value="grid" ${(!w.haDashView || w.haDashView === 'grid') ? 'selected' : ''}>Grid</option>
        <option value="list" ${w.haDashView === 'list' ? 'selected' : ''}>List</option>
        <option value="icon" ${w.haDashView === 'icon' ? 'selected' : ''}>Icon-only</option>
        <option value="card" ${w.haDashView === 'card' ? 'selected' : ''}>Card</option>
        <option value="tapcard" ${w.haDashView === 'tapcard' ? 'selected' : ''}>Tap-card (whole card is the switch)</option>
      </select>
    </div>
    <div class="was-section-label">Combo Groups</div>
    <p class="was-hint" style="margin-top:-6px">Combine several areas and/or entities into ONE named switch — e.g. "Upstairs" = Bedroom + Bathroom + Office, one tile. Separate from the plain area tiles below, which stay one tile per area.</p>
    ${w.haComboGroups.length ? `
    <div id="was-ha-combos">${w.haComboGroups.map((combo, i) => {
      const memberCount = (combo.areaIds || []).length + (combo.entityIds || []).length;
      return `
      <div class="was-row" style="display:flex;align-items:center;gap:8px">
        <button type="button" class="was-ha-combo-edit-btn" data-id="${escapeHtmlD(combo.id)}"
          style="flex:1;text-align:left;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#e8edf5;padding:10px 12px;font-size:13px;cursor:pointer">
          ${escapeHtmlD(combo.name || 'Untitled')} — ${memberCount} member${memberCount === 1 ? '' : 's'}
        </button>
        <button type="button" class="was-ha-combo-remove-btn" data-id="${escapeHtmlD(combo.id)}" aria-label="Remove"
          style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.35);color:#ff7a7a;font-size:16px;cursor:pointer">×</button>
      </div>`;
    }).join('')}</div>
    ` : ''}
    <button type="button" id="was-ha-combo-add-btn"
      style="width:100%;background:rgba(74,144,217,0.15);border:1px solid var(--accent,#4A90D9);border-radius:8px;color:var(--accent,#4A90D9);padding:10px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:20px">
      + New Combo Group
    </button>
    ${w.haAreaIds.length ? `
    <div class="was-section-label">Selected Areas (live — always includes whatever's currently in each)</div>
    <div id="was-ha-selareas">${w.haAreaIds.map((areaId, i) => {
      const area = cachedHaAreasD && cachedHaAreasD.areas.find(a => a.id === areaId);
      return `
      <div class="was-row" style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;flex:1">${escapeHtmlD(area ? area.name : areaId)}</span>
        <button type="button" class="was-ha-area-remove-btn" data-index="${i}" aria-label="Remove"
          style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.35);color:#ff7a7a;font-size:16px;cursor:pointer">×</button>
      </div>`;
    }).join('')}</div>
    ` : ''}
    ${w.haEntityIds.length ? `
    <div class="was-section-label">Individual Entities</div>
    <div id="was-ha-rooms">${w.haEntityIds.map((entry, i) => `
      <div class="was-row" style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;opacity:0.7;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtmlD(entry.id)}</span>
        <input type="text" class="was-ha-room-input" data-index="${i}" value="${escapeHtmlD(entry.room || '')}" placeholder="Room" style="width:120px">
        <button type="button" class="was-ha-remove-btn" data-index="${i}" aria-label="Remove"
          style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.35);color:#ff7a7a;font-size:16px;cursor:pointer">×</button>
      </div>`).join('')}</div>
    ` : ''}
    ${w.haEntityIds.length ? `
    <div class="was-toggle-row">
      <label>Group by Room</label>
      <input type="checkbox" id="was-ha-grouptoggle" ${w.haGroupByRoom !== false ? 'checked' : ''}>
    </div>` : ''}
    <div class="was-section-label">Add a Whole Area</div>
    <p class="was-hint" style="margin-top:-6px">Selecting an area here stays live — any device you add to it in Home Assistant later shows up automatically, no need to come back and re-select. Its entities won't also show up below to avoid picking the same thing twice.</p>
    <div class="was-box" id="was-ha-arealist" style="max-height:180px;overflow-y:auto;padding:4px"></div>
    <div class="was-section-label">Add Individual Entities</div>
    <div class="was-row">
      <input type="text" id="was-ha-search" placeholder="Search entities…">
    </div>
    ${areaOpts ? `<div class="was-row"><label>Filter by Area ${infoBtn("Title is set in the basic settings panel — its font-size slider there also controls tile size across every view (icons, toggles, and text all scale together from that one setting).")}</label><select id="was-ha-area">${areaOpts}</select></div>` : ''}
    <div class="was-box" id="was-ha-list" style="max-height:260px;overflow-y:auto;padding:4px"></div>
  `;
}
function wireSmartHomeDashboardAdvancedSettings(w) {
  const listEl = document.getElementById('was-ha-list');
  const searchEl = document.getElementById('was-ha-search');
  const areaFilterEl = document.getElementById('was-ha-area');
  const areaListEl = document.getElementById('was-ha-arealist');

  const viewSelect = document.getElementById('was-ha-view-select');
  if (viewSelect) viewSelect.addEventListener('change', (e) => {
    w.haDashView = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });

  const comboAddBtn = document.getElementById('was-ha-combo-add-btn');
  if (comboAddBtn) comboAddBtn.addEventListener('click', () => {
    if (!Array.isArray(w.haComboGroups)) w.haComboGroups = [];
    const combo = { id: nextWidgetId(), name: 'New Group', entityIds: [], areaIds: [] };
    w.haComboGroups.push(combo);
    scheduleLayoutSave();
    _editingComboGroupId = combo.id;
    openWidgetAdvancedPanel(w.id); // switches into the new group's own editor
  });
  document.querySelectorAll('.was-ha-combo-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _editingComboGroupId = btn.dataset.id;
      openWidgetAdvancedPanel(w.id);
    });
  });
  document.querySelectorAll('.was-ha-combo-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = w.haComboGroups.findIndex(c => c.id === btn.dataset.id);
      if (idx >= 0) {
        w.haComboGroups.splice(idx, 1);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id);
      }
    });
  });

  // Whole-area selection (live) — checking an area here means "everything
  // currently in it, always" (see resolveAreaMemberIds()), a genuinely
  // different action from individually picking entities below, not the
  // old one-time "+ Add all" bulk-insert this replaces. An area selected
  // this way stays live, and its member entities are deliberately excluded
  // from being ALSO individually toggled in the list below — one clear
  // selection per entity, never two overlapping ones.
  const refreshAreaList = () => {
    if (!areaListEl) return;
    areaListEl.innerHTML = haAreaRowsHtmlD((id) => w.haAreaIds.includes(id));
    areaListEl.querySelectorAll('.was-ha-arearow').forEach(row => {
      row.addEventListener('click', () => {
        const areaId = row.dataset.areaId;
        const idx = w.haAreaIds.indexOf(areaId);
        if (idx >= 0) w.haAreaIds.splice(idx, 1);
        else w.haAreaIds.push(areaId);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id);
      });
    });
  };
  refreshAreaList();

  const isCoveredByArea = (entId) => {
    if (!w.haAreaIds.length || !cachedHaAreasD) return false;
    const areaId = (cachedHaAreasD.entityAreas || {})[entId];
    return !!areaId && w.haAreaIds.includes(areaId);
  };
  const refreshList = () => {
    if (!listEl) return;
    const list = filterHaEntitiesD(searchEl ? searchEl.value : '', areaFilterEl ? areaFilterEl.value : '');
    listEl.innerHTML = haEntityRowsHtmlD(list, (id) => w.haEntityIds.some(entry => entry.id === id), isCoveredByArea);
    listEl.querySelectorAll('.was-ha-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        const idx = w.haEntityIds.findIndex(entry => entry.id === id);
        if (idx >= 0) w.haEntityIds.splice(idx, 1);
        else w.haEntityIds.push({ id, room: '' });
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id); // full refresh — count, room list, and toggle visibility all need to move together
      });
    });
  };
  refreshList();
  if (searchEl) searchEl.addEventListener('input', refreshList);
  if (areaFilterEl) areaFilterEl.addEventListener('change', refreshList);
  document.querySelectorAll('.was-ha-room-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (w.haEntityIds[idx]) {
        w.haEntityIds[idx].room = e.target.value;
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
      }
    });
  });
  document.querySelectorAll('.was-ha-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (idx >= 0 && idx < w.haEntityIds.length) {
        w.haEntityIds.splice(idx, 1);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id); // full refresh — count, checkmarks, and remaining indices all need to move together
      }
    });
  });
  document.querySelectorAll('.was-ha-area-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (idx >= 0 && idx < w.haAreaIds.length) {
        w.haAreaIds.splice(idx, 1);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id);
      }
    });
  });
  const groupToggle = document.getElementById('was-ha-grouptoggle');
  if (groupToggle) groupToggle.addEventListener('change', (e) => {
    w.haGroupByRoom = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

// ── Combo Group editor (Live Edit) — a sub-view of the Dashboard's own
// advanced panel, not a separate overlay. Same area/entity picker shapes
// already built for the Dashboard/Group Control widgets themselves, just
// scoped to combo.areaIds/combo.entityIds instead of the widget's
// top-level ones. Deliberately independent of the widget's own top-level
// selections — this session's scope is "this group makes sense on its
// own," not cross-checking against every other combo group or the
// top-level list too (a real, documented simplification, not an
// oversight).
function renderComboGroupEditor(w, combo) {
  if (!Array.isArray(combo.entityIds)) combo.entityIds = [];
  if (!Array.isArray(combo.areaIds)) combo.areaIds = [];
  const areaOpts = haAreaOptionsHtmlD();
  return `
    <div class="was-row">
      <label>Name</label>
      <input type="text" id="was-combo-name" value="${escapeHtmlD(combo.name || '')}" placeholder="e.g. Upstairs">
    </div>
    ${combo.areaIds.length ? `
    <div class="was-section-label">Areas in this group</div>
    <div id="was-combo-selareas">${combo.areaIds.map((areaId, i) => {
      const area = cachedHaAreasD && cachedHaAreasD.areas.find(a => a.id === areaId);
      return `
      <div class="was-row" style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;flex:1">${escapeHtmlD(area ? area.name : areaId)}</span>
        <button type="button" class="was-combo-area-remove-btn" data-index="${i}" aria-label="Remove"
          style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.35);color:#ff7a7a;font-size:16px;cursor:pointer">×</button>
      </div>`;
    }).join('')}</div>
    ` : ''}
    ${combo.entityIds.length ? `
    <div class="was-section-label">Individual entities in this group</div>
    <div id="was-combo-selentities">${combo.entityIds.map((entId, i) => `
      <div class="was-row" style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;opacity:0.7;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtmlD(entId)}</span>
        <button type="button" class="was-combo-entity-remove-btn" data-index="${i}" aria-label="Remove"
          style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.35);color:#ff7a7a;font-size:16px;cursor:pointer">×</button>
      </div>`).join('')}</div>
    ` : ''}
    <div class="was-section-label">Add an Area</div>
    <div class="was-box" id="was-combo-arealist" style="max-height:160px;overflow-y:auto;padding:4px"></div>
    <div class="was-section-label">Add Individual Entities</div>
    <div class="was-row">
      <input type="text" id="was-combo-search" placeholder="Search entities…">
    </div>
    ${areaOpts ? `<div class="was-row"><label>Filter by Area</label><select id="was-combo-areafilter">${areaOpts}</select></div>` : ''}
    <div class="was-box" id="was-combo-entitylist" style="max-height:220px;overflow-y:auto;padding:4px"></div>
    <button type="button" id="was-combo-done-btn"
      style="width:100%;background:var(--accent,#4A90D9);border:none;border-radius:8px;color:#fff;padding:12px;font-size:14px;font-weight:600;cursor:pointer;margin-top:10px">
      ← Back to Dashboard Settings
    </button>
  `;
}
function wireComboGroupEditor(w, combo) {
  const nameInput = document.getElementById('was-combo-name');
  if (nameInput) nameInput.addEventListener('input', (e) => {
    combo.name = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });

  const areaListEl = document.getElementById('was-combo-arealist');
  const listEl = document.getElementById('was-combo-entitylist');
  // Selecting/removing an area or entity re-renders the WHOLE combo editor
  // via openWidgetAdvancedPanel() (the summary lists above these boxes, and
  // the conditional section headers around them, only exist in the full
  // render — there's no cheap local-only path that also keeps those in
  // sync). That full re-render creates brand-new DOM for these two
  // scrollable picker boxes every time, so their own scroll position doesn't
  // survive on its own — same underlying issue the outer panel body already
  // had fixed in openWidgetAdvancedPanel() (v1.77.67), just not extended to
  // these nested boxes when Combo Groups shipped in that same session.
  // Read LIVE at the moment of each click (not once when this function
  // first runs) — an earlier version of this fix captured it only at
  // mount time, which meant scrolling down after the panel opened and THEN
  // clicking something still restored the stale pre-scroll position instead
  // of where the click actually happened, silently reproducing the same
  // jump-to-top bug for anything below the fold. Restored below (after
  // wireComboGroupEditor runs again on the new DOM), same rAF-after-layout
  // reasoning as the outer fix so it isn't clamped against a shorter
  // intermediate "Loading…" state.
  const reopenPreservingScroll = () => {
    _comboListScrollToRestore = {
      area: areaListEl ? areaListEl.scrollTop : 0,
      entity: listEl ? listEl.scrollTop : 0,
    };
    openWidgetAdvancedPanel(w.id);
  };

  document.querySelectorAll('.was-combo-area-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (idx >= 0 && idx < combo.areaIds.length) {
        combo.areaIds.splice(idx, 1);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        reopenPreservingScroll();
      }
    });
  });
  document.querySelectorAll('.was-combo-entity-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (idx >= 0 && idx < combo.entityIds.length) {
        combo.entityIds.splice(idx, 1);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        reopenPreservingScroll();
      }
    });
  });

  const refreshAreaList = () => {
    if (!areaListEl) return;
    areaListEl.innerHTML = haAreaRowsHtmlD((id) => combo.areaIds.includes(id));
    areaListEl.querySelectorAll('.was-ha-arearow').forEach(row => {
      row.addEventListener('click', () => {
        const areaId = row.dataset.areaId;
        const idx = combo.areaIds.indexOf(areaId);
        if (idx >= 0) combo.areaIds.splice(idx, 1);
        else combo.areaIds.push(areaId);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        reopenPreservingScroll();
      });
    });
  };
  refreshAreaList();

  const searchEl = document.getElementById('was-combo-search');
  const areaFilterEl = document.getElementById('was-combo-areafilter');
  // Same "can't double-select" guard as the top-level pickers, scoped to
  // just this combo group's own area selections.
  const isCoveredByArea = (entId) => {
    if (!combo.areaIds.length || !cachedHaAreasD) return false;
    const areaId = (cachedHaAreasD.entityAreas || {})[entId];
    return !!areaId && combo.areaIds.includes(areaId);
  };
  const refreshEntityList = () => {
    if (!listEl) return;
    const list = filterHaEntitiesD(searchEl ? searchEl.value : '', areaFilterEl ? areaFilterEl.value : '');
    listEl.innerHTML = haEntityRowsHtmlD(list, (id) => combo.entityIds.includes(id), isCoveredByArea);
    listEl.querySelectorAll('.was-ha-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        const idx = combo.entityIds.indexOf(id);
        if (idx >= 0) combo.entityIds.splice(idx, 1);
        else combo.entityIds.push(id);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        reopenPreservingScroll();
      });
    });
  };
  refreshEntityList();
  if (searchEl) searchEl.addEventListener('input', refreshEntityList);
  if (areaFilterEl) areaFilterEl.addEventListener('change', refreshEntityList);

  // Apply whatever scroll a prior click asked to preserve, now that this
  // fresh render's boxes actually exist. rAF-deferred so it lands after the
  // browser has laid out the just-inserted rows — restoring immediately
  // risks the same "clamped against not-yet-laid-out content" issue the
  // outer panel fix already documented.
  if (_comboListScrollToRestore) {
    const { area, entity } = _comboListScrollToRestore;
    _comboListScrollToRestore = null;
    requestAnimationFrame(() => {
      if (areaListEl && area) areaListEl.scrollTop = area;
      if (listEl && entity) listEl.scrollTop = entity;
    });
  }

  const doneBtn = document.getElementById('was-combo-done-btn');
  if (doneBtn) doneBtn.addEventListener('click', () => {
    _editingComboGroupId = null;
    openWidgetAdvancedPanel(w.id);
  });
}

// ── Group Control advanced settings (Live Edit parity) ──────────────────────
// Same shape as the Dashboard picker above, minus room labels/grouping —
// Group Control never displays members individually, so there's nothing
// for a room to organize (see the widget's own rendering comment).
function renderGroupControlAdvancedSettings(w) {
  if (!Array.isArray(w.gcEntityIds)) w.gcEntityIds = [];
  if (!Array.isArray(w.gcAreaIds)) w.gcAreaIds = [];
  const areaOpts = haAreaOptionsHtmlD();
  return `
    ${w.gcAreaIds.length ? `
    <div class="was-section-label">Selected Areas (live — always includes whatever's currently in each)</div>
    <div id="was-gc-selareas">${w.gcAreaIds.map((areaId, i) => {
      const area = cachedHaAreasD && cachedHaAreasD.areas.find(a => a.id === areaId);
      return `
      <div class="was-row" style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;flex:1">${escapeHtmlD(area ? area.name : areaId)}</span>
        <button type="button" class="was-gc-area-remove-btn" data-index="${i}" aria-label="Remove"
          style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.35);color:#ff7a7a;font-size:16px;cursor:pointer">×</button>
      </div>`;
    }).join('')}</div>
    ` : ''}
    ${w.gcEntityIds.length ? `
    <div class="was-section-label">Selected Entities</div>
    <div id="was-gc-selected">${w.gcEntityIds.map((entId, i) => `
      <div class="was-row" style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;opacity:0.7;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtmlD(entId)}</span>
        <button type="button" class="was-gc-remove-btn" data-index="${i}" aria-label="Remove"
          style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.35);color:#ff7a7a;font-size:16px;cursor:pointer">×</button>
      </div>`).join('')}</div>
    ` : ''}
    <div class="was-section-label">Add a Whole Area</div>
    <p class="was-hint" style="margin-top:-6px">Selecting an area here stays live — any device you add to it in Home Assistant later is included automatically. Its entities won't also show up below to avoid picking the same thing twice.</p>
    <div class="was-box" id="was-gc-arealist" style="max-height:180px;overflow-y:auto;padding:4px"></div>
    <div class="was-section-label">Add Individual Entities</div>
    <div class="was-row">
      <input type="text" id="was-ha-search" placeholder="Search entities…">
    </div>
    ${areaOpts ? `<div class="was-row"><label>Filter by Area ${infoBtn("One tap on the wall display turns ALL of these on or off together. Title and font size are set in the basic settings panel.")}</label><select id="was-ha-area">${areaOpts}</select></div>` : ''}
    <div class="was-box" id="was-ha-list" style="max-height:260px;overflow-y:auto;padding:4px"></div>
  `;
}
function wireGroupControlAdvancedSettings(w) {
  const listEl = document.getElementById('was-ha-list');
  const searchEl = document.getElementById('was-ha-search');
  const areaFilterEl = document.getElementById('was-ha-area');
  const areaListEl = document.getElementById('was-gc-arealist');

  const refreshAreaList = () => {
    if (!areaListEl) return;
    areaListEl.innerHTML = haAreaRowsHtmlD((id) => w.gcAreaIds.includes(id));
    areaListEl.querySelectorAll('.was-ha-arearow').forEach(row => {
      row.addEventListener('click', () => {
        const areaId = row.dataset.areaId;
        const idx = w.gcAreaIds.indexOf(areaId);
        if (idx >= 0) w.gcAreaIds.splice(idx, 1);
        else w.gcAreaIds.push(areaId);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id);
      });
    });
  };
  refreshAreaList();

  document.querySelectorAll('.was-gc-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (idx >= 0 && idx < w.gcEntityIds.length) {
        w.gcEntityIds.splice(idx, 1);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id);
      }
    });
  });
  document.querySelectorAll('.was-gc-area-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (idx >= 0 && idx < w.gcAreaIds.length) {
        w.gcAreaIds.splice(idx, 1);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id);
      }
    });
  });

  const isCoveredByArea = (entId) => {
    if (!w.gcAreaIds.length || !cachedHaAreasD) return false;
    const areaId = (cachedHaAreasD.entityAreas || {})[entId];
    return !!areaId && w.gcAreaIds.includes(areaId);
  };
  const refreshList = () => {
    if (!listEl) return;
    const list = filterHaEntitiesD(searchEl ? searchEl.value : '', areaFilterEl ? areaFilterEl.value : '');
    listEl.innerHTML = haEntityRowsHtmlD(list, (id) => w.gcEntityIds.includes(id), isCoveredByArea);
    listEl.querySelectorAll('.was-ha-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        const idx = w.gcEntityIds.indexOf(id);
        if (idx >= 0) w.gcEntityIds.splice(idx, 1);
        else w.gcEntityIds.push(id);
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        openWidgetAdvancedPanel(w.id);
      });
    });
  };
  refreshList();
  if (searchEl) searchEl.addEventListener('input', refreshList);
  if (areaFilterEl) areaFilterEl.addEventListener('change', refreshList);
}

function renderCalendarAdvancedSettings(w) {
  const view = w.calView || 'month';
  const fontPx = w.calFontPx || 11;
  const wrapMode = (w.calWrap === 'clamp2') ? 'clamp2' : (w.calWrap === true || w.calWrap === 'on') ? 'on' : 'off';
  const calLayout = w.calLayout || 'grid';
  const agendaDays = w.calAgendaDays || 14;
  const stripDays = w.calStripDays || 7;
  const maxEventsPerDay = (w.calMaxEventsPerDay !== undefined ? w.calMaxEventsPerDay : 0);
  const dimPast = !!w.calDimPast;
  const showEndTime = !!w.calShowEndTime;
  // Matches each layout's OWN actual wrap-detection logic exactly (Grid's
  // renderMiniCalGrid uses the 3-way wrapMode below; Agenda's
  // renderMiniCalAgenda uses a plain `!!widget.calWrap` truthy check) — not
  // just `!!w.calWrap` here, since the string 'off' is itself truthy in JS
  // and would otherwise show this toggle as enabled for a Grid calendar
  // that's explicitly set to wrap Off.
  const wrapActiveForCurrentLayout = calLayout === 'agenda' ? !!w.calWrap : (wrapMode !== 'off');
  const layoutInner = `
    <div class="was-row">
      <label>Layout Style</label>
      <select id="cal-layout-select">
        <option value="grid"   ${calLayout==='grid'?'selected':''}>Grid (month/week)</option>
        <option value="agenda" ${calLayout==='agenda'?'selected':''}>Agenda (list)</option>
        <option value="strip"  ${calLayout==='strip'?'selected':''}>Strip (single row)</option>
      </select>
    </div>
    ${dateFormatOverrideRowHtml('cal-date-format-select', w.calDateFormat)}
    ${ampmCaseOverrideRowHtml('cal-ampm-case-select', w.calAmpmCase)}
    <div class="was-toggle-row" id="cal-show-end-time-row" style="${calLayout==='strip'?'display:none':''}">
      <label>Show End Times ${infoBtn("Shows \"9:00 – 10:00 AM\" instead of just the start time, for events that aren't all-day or multi-day. Strip layout always shows both regardless of this setting.")}</label>
      <input type="checkbox" id="cal-show-end-time-toggle" ${showEndTime?'checked':''}>
    </div>
    <div class="was-toggle-row" id="cal-adaptive-font-row" style="${calLayout==='strip'?'display:none':''}">
      <label>Adaptive Font Sizing ${infoBtn(`For an event that just barely wraps to a second line (e.g. "🎂Name🎂" tipping over because of the trailing emoji), shrinks that one event's text by up to ${ADAPTIVE_FONT_MAX_SHRINK_PX}px — only if that's enough to bring it back to one line. A title that's genuinely too long to fit is left wrapped exactly as before, at full size. ${wrapActiveForCurrentLayout ? '' : 'Requires Wrap Event Text to be on — grayed out until then, since text truncates with "…" instead of wrapping while it\'s off.'}`)}</label>
      <input type="checkbox" id="cal-adaptive-font-toggle" ${w.calAdaptiveFontSizing?'checked':''} ${wrapActiveForCurrentLayout?'':'disabled'}>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Calendar View</label>
      <select id="cal-view-select">
        <option value="1week" ${view==='1week'?'selected':''}>1 Week</option>
        <option value="2week" ${view==='2week'?'selected':''}>2 Weeks</option>
        <option value="3week" ${view==='3week'?'selected':''}>3 Weeks</option>
        <option value="4week" ${view==='4week'?'selected':''}>4 Weeks</option>
        <option value="month" ${view==='month'?'selected':''}>Month</option>
      </select>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Week Starts On</label>
      <select id="cal-week-start-select">
        <option value="default" ${(w.calWeekStart||'default')==='default'?'selected':''}>Use display setting</option>
        <option value="0" ${w.calWeekStart==='0'?'selected':''}>Sunday</option>
        <option value="1" ${w.calWeekStart==='1'?'selected':''}>Monday</option>
      </select>
    </div>
    <div class="was-row" style="${calLayout==='agenda'?'':'display:none'}">
      <label>Days to Show Ahead</label>
      <div class="was-range-row">
        <input type="range" id="cal-agenda-days-range" min="3" max="30" step="1" value="${agendaDays}">
        <span class="was-range-val" id="cal-agenda-days-val">${agendaDays}</span>
      </div>
    </div>
    <div class="was-toggle-row" style="${calLayout==='strip'?'display:none':''}">
      <label>Show Location ${infoBtn("Shows each event's location — for calendars that have location turned on in Settings → Calendars (or forced on below in Per-Feed Location). On by default. In Agenda layout it gets its own wrapped line; in Grid layout it's appended after the title on the same line — turn on Wrap Event Text to give it its own line.")}</label>
      <input type="checkbox" id="cal-show-location" ${w.calShowLocation!==false ? 'checked' : ''}>
    </div>
    <div class="was-row" style="${calLayout==='strip'?'':'display:none'}">
      <label>Days to Show</label>
      <div class="was-range-row">
        <input type="range" id="cal-strip-days-range" min="3" max="10" step="1" value="${stripDays}">
        <span class="was-range-val" id="cal-strip-days-val">${stripDays}</span>
      </div>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Max Events Per Day ${infoBtn("Auto (0) fits as many events as each day box can hold and collapses the rest into \"+X more\" — text never spills into another day. Set a number to force a hard cap instead.")}</label>
      <div class="was-range-row">
        <input type="range" id="cal-max-events-range" min="0" max="10" step="1" value="${maxEventsPerDay}">
        <span class="was-range-val" id="cal-max-events-val">${maxEventsPerDay === 0 ? 'Auto' : maxEventsPerDay}</span>
      </div>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Max Lines Per Day ${infoBtn("Caps each day by number of text lines (counting wrapped titles), not events. Use this if events still overflow despite Auto — it's the most reliable limit. Auto (0) uses height-based fitting.")}</label>
      <div class="was-range-row">
        <input type="range" id="cal-max-lines-range" min="0" max="12" step="1" value="${(w.calMaxLines||0)}">
        <span class="was-range-val" id="cal-max-lines-val">${(w.calMaxLines||0) === 0 ? 'Auto' : (w.calMaxLines)}</span>
      </div>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Wrap Event Text ${infoBtn("\"Max 2 lines\" wraps long titles but caps them at two lines so a busy day doesn't get clogged.")}</label>
      <select id="cal-wrap-mode">
        <option value="off" ${wrapMode==='off'?'selected':''}>Off — single line, cut with "…"</option>
        <option value="on" ${wrapMode==='on'?'selected':''}>On — wrap to as many lines as needed</option>
        <option value="clamp2" ${wrapMode==='clamp2'?'selected':''}>Wrap, max 2 lines</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="cal-font-range" min="6" max="64" step="1" value="${fontPx}">
        <span class="was-range-val" id="cal-font-val">${fontPx}px</span>
      </div>
    </div>
  `;
  const colorsInner = `
    <div class="was-toggle-row">
      <label>Color Coding ${infoBtn("Off removes every colored dot and highlight from this calendar — plain text only. On by default.")}</label>
      <input type="checkbox" id="cal-color-coding-toggle" ${w.calColorCoding !== false ? 'checked' : ''}>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Multi-Day Event Style ${infoBtn("How a multi-day event (a trip, a visit) shows across the days it covers. \"Bar\" is the original style; the others are lighter-weight for a calendar with lots of single-day entries already competing for space.")}</label>
      <select id="cal-multiday-style-select">
        <option value="bar"    ${(w.calMultiDayStyle||'bar')==='bar'?'selected':''}>Bar — spans across the days</option>
        <option value="dot"    ${w.calMultiDayStyle==='dot'?'selected':''}>Dot — listed like a regular event, each day</option>
        <option value="line"   ${w.calMultiDayStyle==='line'?'selected':''}>Line — thin underline, name once</option>
        <option value="stripe" ${w.calMultiDayStyle==='stripe'?'selected':''}>Stripe — colored edge on the cell</option>
      </select>
    </div>
    <div class="was-row" id="cal-fullday-style-row" style="${calLayout==='grid' && w.calColorCoding!==false?'':'display:none'}">
      <label>Full-Day Event Style ${infoBtn("How an all-day/multi-day event shows its color, independent of Color Coding above for timed events. \"Background\" is a colored pill. \"Dot\" is a lighter-weight marker matching a timed event's, no background. \"None\" shows plain text with no color indicator at all, for full-day events only. Hidden while Color Coding above is off.")}</label>
      <select id="cal-fullday-style-select">
        <option value="highlight" ${(w.calFullDayColorStyle||'highlight')==='highlight'?'selected':''}>Background — colored pill</option>
        <option value="dot"       ${w.calFullDayColorStyle==='dot'?'selected':''}>Dot — colored marker, no background</option>
        <option value="none"      ${w.calFullDayColorStyle==='none'?'selected':''}>None — plain text, no color</option>
      </select>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Today Indicator Style ${infoBtn("How today's date is marked in the grid. Grid layout only — Agenda and Strip mark today a different way already (a \"Today\" label / a highlighted column) and aren't affected by this. Color can be customized in the app's widget settings.")}</label>
      <select id="cal-today-style-select">
        <option value="circle"    ${(w.calTodayStyle||'circle')==='circle'?'selected':''}>Circle — filled, original style</option>
        <option value="outline"   ${w.calTodayStyle==='outline'?'selected':''}>Outline — ring only, no fill</option>
        <option value="fill"      ${w.calTodayStyle==='fill'?'selected':''}>Cell Highlight — tints the whole day box</option>
        <option value="underline" ${w.calTodayStyle==='underline'?'selected':''}>Underline — thin line beneath the number</option>
        <option value="text"      ${w.calTodayStyle==='text'?'selected':''}>Text Color — just colors the number itself</option>
        <option value="none"      ${w.calTodayStyle==='none'?'selected':''}>None — no special treatment</option>
      </select>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Dim Past Days</label>
      <input type="checkbox" id="cal-dim-past-toggle" ${dimPast?'checked':''}>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Past Events ${infoBtn("Controls events that have already happened. \"Show dimmed\" greys them out; \"Hide\" removes them entirely.")}</label>
      <select id="cal-past-events-select">
        <option value="show" ${(!w.pastEvents||w.pastEvents==='show')?'selected':''}>Show normally</option>
        <option value="dim"  ${w.pastEvents==='dim'?'selected':''}>Show dimmed</option>
        <option value="hide" ${w.pastEvents==='hide'?'selected':''}>Hide</option>
      </select>
    </div>
    <div class="was-row" style="${calLayout==='grid'?'':'display:none'}">
      <label>Decoration Style ${infoBtn("\"Post-it notes\" draws each day with events as a sticky note. The icon styles mark event days with a festive symbol instead of dots.")}</label>
      <select id="cal-decor-select">
        <option value="none"          ${(!w.calDecor||w.calDecor==='none')?'selected':''}>None (normal)</option>
        <option value="postit"        ${w.calDecor==='postit'?'selected':''}>Post-it notes</option>
        <option value="icon:star"     ${w.calDecor==='icon:star'?'selected':''}>Stars ⭐</option>
        <option value="icon:sparkle"  ${w.calDecor==='icon:sparkle'?'selected':''}>Sparkles ✨</option>
        <option value="icon:ornament" ${w.calDecor==='icon:ornament'?'selected':''}>Ornaments 🎄</option>
        <option value="icon:egg"      ${w.calDecor==='icon:egg'?'selected':''}>Easter eggs 🥚</option>
        <option value="icon:pumpkin"  ${w.calDecor==='icon:pumpkin'?'selected':''}>Pumpkins 🎃</option>
        <option value="icon:leaf"     ${w.calDecor==='icon:leaf'?'selected':''}>Leaves 🍁</option>
        <option value="icon:balloon"  ${w.calDecor==='icon:balloon'?'selected':''}>Balloons 🎈</option>
      </select>
    </div>
  `;
  const remindersInner = `
    <div class="was-toggle-row">
      <label>Show Reminder Badges ${infoBtn("Marks each day one of your Reminders (trash day, recycling, anything set up in a Reminders widget) is due with a small emoji badge — the same schedule the Reminders widget itself reads from, so they can never disagree.")}</label>
      <input type="checkbox" id="cal-show-reminders-toggle" ${w.calShowReminders?'checked':''}>
    </div>
    <div class="was-row" id="cal-reminder-position-row" style="${w.calShowReminders?'':'display:none'}">
      <label>Badge Position</label>
      <select id="cal-reminder-position-select">
        <option value="top-left"     ${(w.calReminderPosition||'top-left')==='top-left'?'selected':''}>Top left</option>
        <option value="top-right"    ${w.calReminderPosition==='top-right'?'selected':''}>Top right</option>
        <option value="bottom-right" ${w.calReminderPosition==='bottom-right'?'selected':''}>Bottom right</option>
        <option value="bottom-left"  ${w.calReminderPosition==='bottom-left'?'selected':''}>Bottom left</option>
      </select>
    </div>
    <div class="was-row" id="cal-reminder-size-row" style="${w.calShowReminders?'':'display:none'}">
      <label>Badge Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="cal-reminder-size-range" min="8" max="48" step="1" value="${w.calReminderSizePx || Math.round(fontPx * 1.4)}">
        <span class="was-range-val" id="cal-reminder-size-val">${w.calReminderSizePx || Math.round(fontPx * 1.4)}px</span>
      </div>
    </div>
    <div class="was-row" id="cal-reminder-text-size-row" style="${w.calShowReminders?'':'display:none'}">
      <label>Text Reminder Size ${infoBtn('Only affects reminders using a text label as their icon (e.g. "TRASH") — emoji and image icons use Badge Size above instead. A percentage on top of the automatic shrink-to-fit that already applies to longer labels.')}</label>
      <div class="was-range-row">
        <input type="range" id="cal-reminder-textsize-range" min="50" max="200" step="10" value="${w.calReminderTextSizePct || 100}">
        <span class="was-range-val" id="cal-reminder-textsize-val">${w.calReminderTextSizePct || 100}%</span>
      </div>
    </div>
  `;
  const stickersInner = `
    <div class="was-toggle-row">
      <label>Show Sticker Badges ${infoBtn("Marks each day a kid earned a sticker with a small badge — their chosen star/avatar/emoji style (set per kid in the Chores tab). One badge per kid per day, however many stickers they earned.")}</label>
      <input type="checkbox" id="cal-show-stickers-toggle" ${w.calShowStickers?'checked':''}>
    </div>
    <div class="was-row" id="cal-sticker-position-row" style="${w.calShowStickers?'':'display:none'}">
      <label>Badge Position</label>
      <select id="cal-sticker-position-select">
        <option value="top-right"    ${(w.calStickerPosition||'top-right')==='top-right'?'selected':''}>Top right</option>
        <option value="top-left"     ${w.calStickerPosition==='top-left'?'selected':''}>Top left</option>
        <option value="bottom-right" ${w.calStickerPosition==='bottom-right'?'selected':''}>Bottom right</option>
        <option value="bottom-left"  ${w.calStickerPosition==='bottom-left'?'selected':''}>Bottom left</option>
      </select>
    </div>
    <div class="was-row" id="cal-sticker-size-row" style="${w.calShowStickers?'':'display:none'}">
      <label>Badge Size (px) ${infoBtn("Defaults to matching the day number's own size. Drag to make badges bigger or smaller.")}</label>
      <div class="was-range-row">
        <input type="range" id="cal-sticker-size-range" min="8" max="60" step="1" value="${w.calStickerSizePx || Math.round(fontPx * 2)}">
        <span class="was-range-val" id="cal-sticker-size-val">${w.calStickerSizePx || Math.round(fontPx * 2)}px</span>
      </div>
    </div>
  `;
  return `
    <div id="minical-settings-acc">
      ${accordionSection({ id: 'layout', icon: '📐', label: 'Layout', sub: 'View, days shown, font sizing', inner: layoutInner }, _calSettingsOpenSection === 'layout')}
      ${accordionSection({ id: 'colors', icon: '🎨', label: 'Event Colors & Style', sub: 'Color coding, today indicator, decorations', inner: colorsInner }, _calSettingsOpenSection === 'colors')}
      ${accordionSection({ id: 'reminders', icon: '🗑️', label: 'Reminder Badges', sub: 'Show on calendar, position, size', inner: remindersInner, hidden: calLayout !== 'grid' }, _calSettingsOpenSection === 'reminders')}
      ${accordionSection({ id: 'stickers', icon: '⭐', label: 'Sticker Badges', sub: 'Show on calendar, position, size', inner: stickersInner, hidden: calLayout !== 'grid' }, _calSettingsOpenSection === 'stickers')}
    </div>
    ${renderFeedOpacityOverrideSection(w)}
    ${renderFeedLocationOverrideSection(w)}
  `;
}
function wireCalendarAdvancedSettings(w) {
  wireAccordion('minical-settings-acc');
  wireFeedOpacityOverrideSection(w);
  wireFeedLocationOverrideSection(w);
  const onLiveField = (id, evt, apply) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(evt, () => {
      apply(el);
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  };
  document.getElementById('cal-layout-select').addEventListener('change', (e) => {
    w.calLayout = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    _calSettingsOpenSection = 'layout'; // stay open in the section the control that triggered this redraw lives in
    openWidgetAdvancedPanel(w.id); // re-render so the right sub-settings show for the chosen layout
  });
  onLiveField('cal-view-select', 'change', (el) => { w.calView = el.value; });
  onLiveField('cal-week-start-select', 'change', (el) => { w.calWeekStart = el.value; });
  onLiveField('cal-date-format-select', 'change', (el) => { w.calDateFormat = el.value; });
  onLiveField('cal-ampm-case-select', 'change', (el) => { w.calAmpmCase = el.value; });
  document.getElementById('cal-color-coding-toggle').addEventListener('change', (e) => {
    w.calColorCoding = e.target.checked; // stored as false only when explicitly off — matches the !== false check used at render time
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    // Full-Day Event Style's row visibility depends on this — needs a full
    // settings-panel re-render, same reasoning as cal-wrap-mode below.
    _calSettingsOpenSection = 'colors';
    openWidgetAdvancedPanel(w.id);
  });
  onLiveField('cal-multiday-style-select', 'change', (el) => { w.calMultiDayStyle = el.value; });
  onLiveField('cal-fullday-style-select', 'change', (el) => { w.calFullDayColorStyle = el.value; });
  onLiveField('cal-today-style-select', 'change', (el) => { w.calTodayStyle = el.value; });
  onLiveField('cal-font-range', 'input', (el) => {
    w.calFontPx = parseInt(el.value, 10);
    document.getElementById('cal-font-val').textContent = w.calFontPx + 'px';
  });
  document.getElementById('cal-wrap-mode').addEventListener('change', (e) => {
    w.calWrap = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    // Unlike most fields here, this one needs a full settings-panel
    // re-render (not just onLiveField's rerenderSingleWidget) — Adaptive
    // Font Sizing's checkbox is enabled/disabled based on wrap mode, and
    // that only gets recomputed when renderCalendarAdvancedSettings runs
    // again, not from re-rendering the widget's own canvas tile.
    _calSettingsOpenSection = 'layout'; // safe by construction (only reachable while Layout is open) but set explicitly
    openWidgetAdvancedPanel(w.id);
  });
  onLiveField('cal-adaptive-font-toggle', 'change', (el) => { w.calAdaptiveFontSizing = el.checked; });
  onLiveField('cal-dim-past-toggle', 'change', (el) => { w.calDimPast = el.checked; });
  onLiveField('cal-decor-select', 'change', (el) => { w.calDecor = el.value; });
  document.getElementById('cal-show-stickers-toggle').addEventListener('change', (e) => {
    w.calShowStickers = e.target.checked;
    if (w.calShowStickers) fetchStickersForLayout().then(() => rerenderSingleWidget(w.id));
    else rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    // Badge Position's row visibility depends on this — same full-panel
    // re-render reasoning as Color Coding/Wrap Mode above.
    _calSettingsOpenSection = 'stickers';
    openWidgetAdvancedPanel(w.id);
  });
  onLiveField('cal-sticker-position-select', 'change', (el) => { w.calStickerPosition = el.value; });
  onLiveField('cal-sticker-size-range', 'input', (el) => {
    w.calStickerSizePx = parseInt(el.value, 10);
    document.getElementById('cal-sticker-size-val').textContent = w.calStickerSizePx + 'px';
  });
  document.getElementById('cal-show-reminders-toggle').addEventListener('change', (e) => {
    w.calShowReminders = e.target.checked;
    // Reminders are already kept in state.reminders (fetched at boot and
    // kept live via the 'reminders' SSE topic — see fetchReminders() and
    // its neighbors), so unlike Stickers there's nothing extra to fetch
    // here, just a re-render.
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    // Badge Position/Size rows' visibility depends on this — same
    _calSettingsOpenSection = 'reminders';
    // full-panel re-render reasoning as Stickers/Color Coding above.
    openWidgetAdvancedPanel(w.id);
  });
  onLiveField('cal-reminder-position-select', 'change', (el) => { w.calReminderPosition = el.value; });
  onLiveField('cal-reminder-size-range', 'input', (el) => {
    w.calReminderSizePx = parseInt(el.value, 10);
    document.getElementById('cal-reminder-size-val').textContent = w.calReminderSizePx + 'px';
  });
  onLiveField('cal-reminder-textsize-range', 'input', (el) => {
    w.calReminderTextSizePct = parseInt(el.value, 10);
    document.getElementById('cal-reminder-textsize-val').textContent = w.calReminderTextSizePct + '%';
  });
  onLiveField('cal-past-events-select', 'change', (el) => { w.pastEvents = el.value; });
  onLiveField('cal-max-events-range', 'input', (el) => {
    w.calMaxEventsPerDay = parseInt(el.value, 10);
    document.getElementById('cal-max-events-val').textContent = w.calMaxEventsPerDay === 0 ? 'Auto' : w.calMaxEventsPerDay;
  });
  onLiveField('cal-max-lines-range', 'input', (el) => {
    w.calMaxLines = parseInt(el.value, 10);
    document.getElementById('cal-max-lines-val').textContent = w.calMaxLines === 0 ? 'Auto' : w.calMaxLines;
  });
  onLiveField('cal-agenda-days-range', 'input', (el) => {
    w.calAgendaDays = parseInt(el.value, 10);
    document.getElementById('cal-agenda-days-val').textContent = w.calAgendaDays;
  });
  onLiveField('cal-strip-days-range', 'input', (el) => {
    w.calStripDays = parseInt(el.value, 10);
    document.getElementById('cal-strip-days-val').textContent = w.calStripDays;
  });
  onLiveField('cal-show-end-time-toggle', 'change', (el) => { w.calShowEndTime = el.checked; });
  onLiveField('cal-show-location', 'change', (el) => { w.calShowLocation = el.checked; });
}

function renderWeatherAdvancedSettings(w, wxSettings) {
  const locationFontPx = w.wxLocationFontPx || 14;
  const locationAlign = w.wxLocationAlign || 'left';
  const contentPct = Math.round(((w.wxContentScale) || 1) * 100);
  const locationVal = (wxSettings && (wxSettings.weather_location_manual || wxSettings.weather_location_auto)) || '';
  // Matches renderWeatherComboForecast()'s own per-style defaults exactly —
  // this slider should show the same "effective" day count the widget
  // itself would actually use when wxForecastDays hasn't been explicitly
  // set, not an unrelated flat default that wouldn't match what's on screen.
  const comboStyleDayDefaults = { stacked: 5, timeline: 4, columns: 5, tabs: 6 };
  const defaultDays = w.type === 'weatherCurrent' ? 0
    : w.type === 'weatherComboForecast' ? (comboStyleDayDefaults[w.wxComboStyle] || 5)
    : 5;
  const forecastDays = (w.wxForecastDays !== undefined) ? w.wxForecastDays : defaultDays;
  const dayMin = w.type === 'weatherCurrent' ? 0 : 1;
  const forecastSlider = (w.type === 'weather' || w.type === 'weatherForecast' || w.type === 'weatherCurrent' || w.type === 'weatherComboForecast') ? `
    <div class="was-row">
      <label>Forecast Days${w.type==='weatherCurrent' ? ' (0 = current only)' : ''}</label>
      <div class="was-range-row">
        <input type="range" id="wx-forecast-days-range" min="${dayMin}" max="16" step="1" value="${forecastDays}">
        <span class="was-range-val" id="wx-forecast-days-val">${forecastDays === 0 ? 'Off' : forecastDays}</span>
      </div>
      <p class="was-hint">How many days of forecast to show (up to 16). ${w.type==='weatherCurrent' ? 'Set to 0 for current conditions only.' : 'Default is 5.'}</p>
    </div>` : '';
  const comboStyleHourDefaults = { stacked: 8, timeline: 6, columns: 5, tabs: 8 };
  const wxComboStyle = w.wxComboStyle || 'stacked';
  const comboStyleControl = (w.type === 'weatherComboForecast') ? `
    <div class="was-row">
      <label>Layout Style</label>
      <select id="wx-combo-style-select">
        <option value="stacked"  ${wxComboStyle==='stacked'?'selected':''}>Stacked — hourly row on top, daily list below</option>
        <option value="timeline" ${wxComboStyle==='timeline'?'selected':''}>Timeline — one continuous strip, hours flowing into days</option>
        <option value="columns"  ${wxComboStyle==='columns'?'selected':''}>Split Columns — hourly and daily side by side</option>
        <option value="tabs"     ${wxComboStyle==='tabs'?'selected':''}>Compact Tabs — a tab switches between the two (tap it on the display)</option>
      </select>
    </div>
    <div class="was-row">
      <label>Content Alignment ${infoBtn("Where the whole hourly/daily block sits within the widget's box, if the box is wider than the content needs. Applies to all four layout styles.")}</label>
      <select id="wx-combo-align-select">
        <option value="left"   ${(w.wxComboAlign||'left')==='left'?'selected':''}>Left</option>
        <option value="center" ${w.wxComboAlign==='center'?'selected':''}>Center</option>
        <option value="right"  ${w.wxComboAlign==='right'?'selected':''}>Right</option>
      </select>
    </div>
    <div class="was-toggle-row">
      <label>Show current conditions</label>
      <input type="checkbox" id="wx-combo-show-current" ${w.wxComboShowCurrent !== false ? 'checked' : ''}>
    </div>` : '';
  const wxHourlyStyle = w.wxHourlyStyle || 'hourly';
  const wxHours = w.wxHours || (w.type === 'weatherComboForecast' ? (comboStyleHourDefaults[wxComboStyle] || 8) : 6);
  const hourlyStyleControl = (w.type === 'weatherHourly') ? `
    <div class="was-row">
      <label>Style</label>
      <select id="wx-hourly-style">
        <option value="hourly" ${wxHourlyStyle==='hourly'?'selected':''}>By hour (next N hours)</option>
        <option value="parts"  ${wxHourlyStyle==='parts'?'selected':''}>Morning / Afternoon / Evening</option>
      </select>
    </div>` : '';
  // Always rendered (not conditionally omitted) for weatherHourly, exactly
  // like before this widget type existed — only its CSS display toggles
  // based on Style above, so the existing show/hide JS (which looks up
  // #wx-hours-row and expects it to already be in the DOM either way)
  // keeps working correctly in both directions, including switching FROM
  // Parts back TO "By hour" within the same panel session. Always included
  // AND visible for the combo widget — none of its four layouts have an
  // equivalent "parts" mode to hide this behind.
  const includeHoursSlider = w.type === 'weatherHourly' || w.type === 'weatherComboForecast';
  const hoursSliderHidden = w.type === 'weatherHourly' && wxHourlyStyle !== 'hourly';
  const hoursSlider = includeHoursSlider ? `
    <div class="was-row" id="wx-hours-row" style="${hoursSliderHidden ? 'display:none' : ''}">
      <label>Hours to Show ${infoBtn("Number of upcoming hours in the strip. Widen the widget box if they get cramped.")}</label>
      <div class="was-range-row">
        <input type="range" id="wx-hours-range" min="2" max="12" step="1" value="${wxHours}">
        <span class="was-range-val" id="wx-hours-val">${wxHours}</span>
      </div>
    </div>` : '';
  // Only meaningful for the two widget types that actually stack a location
  // label above a forecast block — 'weather' always has one, 'weatherCurrent'
  // only when its own optional forecast-days slider above is turned on.
  const locationPosition = w.wxLocationPosition || 'top';
  const locationPositionControl = (w.type === 'weather' || w.type === 'weatherCurrent') ? `
    <div class="was-row">
      <label>Location Position</label>
      <select id="wx-location-position-select">
        <option value="top"    ${locationPosition==='top'?'selected':''}>Above current weather</option>
        <option value="bottom" ${locationPosition==='bottom'?'selected':''}>Above forecast</option>
      </select>
      ${w.type === 'weatherCurrent' ? `<p class="was-hint">Only visible when Forecast Days above is greater than 0 — otherwise there's no forecast for it to sit above.</p>` : ''}
    </div>` : '';
  // Off by default for every field — these only add visual weight to a
  // widget that's already tuned, so an existing saved layout shouldn't
  // change on update. Subset per widget type: weatherHourly is already
  // tight on width (only feels-like fits), weatherForecast has no
  // current-conditions block to hang feels/humidity/gust/UV off of (only
  // today's sunrise/sunset fits), and weather/weatherCurrent/
  // weatherComboForecast all show a full current-conditions block so they
  // get the complete set.
  const hasCurrentBlock = w.type === 'weather' || w.type === 'weatherCurrent' || w.type === 'weatherComboForecast';
  const extraFieldsControl = hasCurrentBlock ? `
    <div class="was-box">
      <div class="was-toggle-row">
        <label>Show Feels-Like Temp</label>
        <input type="checkbox" id="wx-show-feels" ${w.wxShowFeelsLike ? 'checked' : ''}>
      </div>
      <div class="was-toggle-row">
        <label>Show Humidity</label>
        <input type="checkbox" id="wx-show-humidity" ${w.wxShowHumidity ? 'checked' : ''}>
      </div>
      <div class="was-toggle-row">
        <label>Show Wind Gusts</label>
        <input type="checkbox" id="wx-show-gust" ${w.wxShowWindGust ? 'checked' : ''}>
      </div>
      <div class="was-toggle-row">
        <label>Show UV Index</label>
        <input type="checkbox" id="wx-show-uv" ${w.wxShowUV ? 'checked' : ''}>
      </div>
      <div class="was-toggle-row">
        <label>Show Sunrise / Sunset</label>
        <input type="checkbox" id="wx-show-sunrise" ${w.wxShowSunrise ? 'checked' : ''}>
      </div>
    </div>` : (w.type === 'weatherHourly') ? `
    <div class="was-box">
      <div class="was-toggle-row">
        <label>Show Feels-Like Temp ${infoBtn("Adds a small 'feels 71°' line under each hour's temperature.")}</label>
        <input type="checkbox" id="wx-show-feels" ${w.wxShowFeelsLike ? 'checked' : ''}>
      </div>
    </div>` : (w.type === 'weatherForecast') ? `
    <div class="was-box">
      <div class="was-toggle-row">
        <label>Show Sunrise / Sunset ${infoBtn("Adds today's sunrise and sunset time to today's row only.")}</label>
        <input type="checkbox" id="wx-show-sunrise" ${w.wxShowSunrise ? 'checked' : ''}>
      </div>
    </div>` : '';
  return `
    <div class="was-row" id="wx-content-scale-row">
      <label>Content Size ${infoBtn("Scales the temperature, icon, and forecast tiles together. Resize the widget box itself using the resize handles on the display.")}</label>
      <div class="was-range-row">
        <input type="range" id="wx-content-scale" min="50" max="250" step="5" value="${contentPct}">
        <span class="was-range-val" id="wx-content-scale-val">${contentPct}%</span>
      </div>
    </div>
    ${forecastSlider}
    ${locationPositionControl}
    ${comboStyleControl}
    ${hourlyStyleControl}
    ${hoursSlider}
    ${extraFieldsControl}
    <div class="was-box">
      <div class="was-toggle-row">
        <label>Override location for this widget ${infoBtn("Use a different location than the global one — e.g. a vacation-home display. Leave off to use the location from Settings → Weather.")}</label>
        <input type="checkbox" id="wx-loc-override" ${(w.wxLat && w.wxLon) ? 'checked' : ''}>
      </div>
      <div id="wx-loc-override-fields" style="${(w.wxLat && w.wxLon) ? '' : 'display:none'};margin-top:10px">
        <label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">ZIP / Postal code</label>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input type="text" id="wx-loc-zip" placeholder="e.g. 90210" style="flex:1" inputmode="numeric">
          <button id="wx-loc-lookup" type="button" class="was-inline-btn">Look up</button>
        </div>
        <div style="margin:2px 0 10px;font-size:11px;color:rgba(255,255,255,0.4);text-align:center">— or —</div>
        <label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Search by place name</label>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input type="text" id="wx-loc-place" placeholder="e.g. Denver, or Yellowstone National Park" style="flex:1">
          <button id="wx-loc-place-go" type="button" class="was-inline-btn">Search</button>
        </div>
        <label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Label (shown on the widget)</label>
        <input type="text" id="wx-loc-label" value="${w.wxLabel || ''}" placeholder="e.g. Lake House" style="margin-bottom:10px">
        <div id="wx-loc-status" class="was-hint">${(w.wxLat && w.wxLon) ? `📍 ${w.wxLat}, ${w.wxLon}` : 'No location set yet.'}</div>
      </div>
    </div>
    <div class="was-row">
      <label>Units for this widget</label>
      <select id="wx-unit-select">
        <option value="" ${!w.wxUnit ? 'selected' : ''}>Use global default (${wxSettings && wxSettings.weather_unit === 'celsius' ? 'Celsius' : 'Fahrenheit'})</option>
        <option value="fahrenheit" ${w.wxUnit === 'fahrenheit' ? 'selected' : ''}>Fahrenheit (°F)</option>
        <option value="celsius" ${w.wxUnit === 'celsius' ? 'selected' : ''}>Celsius (°C)</option>
      </select>
    </div>
    <div class="was-row">
      <div class="was-toggle-row">
        <label>Show Location Name ${infoBtn("Turn off to hide the location name entirely on this widget, keeping just the weather itself.")}</label>
        <input type="checkbox" id="wx-show-location" ${w.wxShowLocation !== false ? 'checked' : ''}>
      </div>
    </div>
    <div class="was-row">
      <label>Location Name ${infoBtn("Set above, in the override box — the Label field there is this widget's location name.")}</label>
      ${(w.wxLat && w.wxLon) ? `
      ` : `
      <p style="margin:0">${locationVal || '(not set)'}</p>
      <p class="was-hint">This is the device-wide default (Settings → Weather → Location Name), shown here for reference only — it's no longer editable from inside a widget's own settings. That used to be possible, and it was a real, confirmed source of confusion: editing it from one widget's panel silently changed every OTHER weather widget across every layout too. Turn on "Override location for this widget" above if you want this one widget to show somewhere else.</p>
      `}
    </div>
    <div class="was-row">
      <label>Location Name Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="wx-location-font-range" min="8" max="100" step="1" value="${locationFontPx}">
        <span class="was-range-val" id="wx-location-font-val">${locationFontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Location Name Alignment</label>
      <select id="wx-location-align-select">
        <option value="left"   ${locationAlign==='left'?'selected':''}>Left</option>
        <option value="center" ${locationAlign==='center'?'selected':''}>Center</option>
        <option value="right"  ${locationAlign==='right'?'selected':''}>Right</option>
      </select>
    </div>
  `;
}
function wireWeatherAdvancedSettings(w, wxSettings) {
  document.getElementById('wx-content-scale').addEventListener('input', (e) => {
    const pct = parseInt(e.target.value, 10);
    w.wxContentScale = pct / 100;
    document.getElementById('wx-content-scale-val').textContent = pct + '%';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const forecastRange = document.getElementById('wx-forecast-days-range');
  if (forecastRange) {
    forecastRange.addEventListener('input', (e) => {
      w.wxForecastDays = parseInt(e.target.value, 10);
      document.getElementById('wx-forecast-days-val').textContent = w.wxForecastDays === 0 ? 'Off' : w.wxForecastDays;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  }
  const locationPositionSelect = document.getElementById('wx-location-position-select');
  if (locationPositionSelect) {
    locationPositionSelect.addEventListener('change', (e) => {
      w.wxLocationPosition = e.target.value;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  }
  document.getElementById('wx-show-location').addEventListener('change', (e) => {
    w.wxShowLocation = e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const wireCheck = (id, prop) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', (e) => {
      w[prop] = e.target.checked;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  };
  wireCheck('wx-show-feels', 'wxShowFeelsLike');
  wireCheck('wx-show-humidity', 'wxShowHumidity');
  wireCheck('wx-show-gust', 'wxShowWindGust');
  wireCheck('wx-show-uv', 'wxShowUV');
  wireCheck('wx-show-sunrise', 'wxShowSunrise');
  const hourlyStyle = document.getElementById('wx-hourly-style');
  if (hourlyStyle) {
    hourlyStyle.addEventListener('change', (e) => {
      w.wxHourlyStyle = e.target.value;
      const hr = document.getElementById('wx-hours-row'); if (hr) hr.style.display = e.target.value === 'hourly' ? '' : 'none';
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  }
  const comboStyleSelect = document.getElementById('wx-combo-style-select');
  if (comboStyleSelect) {
    comboStyleSelect.addEventListener('change', (e) => {
      w.wxComboStyle = e.target.value;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
      // Re-renders the whole panel body, unlike the lighter single-element
      // toggles above — a style change shifts the DISPLAYED default for
      // both Forecast Days and Hours to Show at once (each style has its
      // own), not just one element's visibility, so patching those two
      // sliders individually would need duplicating this function's own
      // default-lookup logic here too. Simplest correct fix: rebuild from
      // the same render function already used to build this panel the
      // first time, now with the just-changed w.wxComboStyle in scope.
      const body = document.getElementById('widget-advanced-body');
      if (body) {
        body.innerHTML = renderWeatherAdvancedSettings(w, wxSettings);
        wireWeatherAdvancedSettings(w, wxSettings);
      }
    });
  }
  const comboAlignSelect = document.getElementById('wx-combo-align-select');
  if (comboAlignSelect) {
    comboAlignSelect.addEventListener('change', (e) => {
      w.wxComboAlign = e.target.value;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  }
  const comboShowCurrent = document.getElementById('wx-combo-show-current');
  if (comboShowCurrent) {
    comboShowCurrent.addEventListener('change', (e) => {
      w.wxComboShowCurrent = e.target.checked;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  }
  const hoursRange = document.getElementById('wx-hours-range');
  if (hoursRange) {
    hoursRange.addEventListener('input', (e) => {
      w.wxHours = parseInt(e.target.value, 10);
      document.getElementById('wx-hours-val').textContent = w.wxHours;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  }
  document.getElementById('wx-location-font-range').addEventListener('input', (e) => {
    w.wxLocationFontPx = parseInt(e.target.value, 10);
    document.getElementById('wx-location-font-val').textContent = w.wxLocationFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  document.getElementById('wx-location-align-select').addEventListener('change', (e) => {
    w.wxLocationAlign = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  // Location name is no longer editable from inside a widget's own settings
  // panel at all — it's a global setting (Settings → Weather), and letting
  // it be edited from here too (even with a warning label) was a real,
  // confirmed source of confusion: editing it from one widget's panel
  // silently changed every OTHER weather widget across every layout. The
  // panel now just displays it for reference; see the per-widget override
  // section above for giving THIS widget its own distinct location.
  const unitSelect = document.getElementById('wx-unit-select');
  if (unitSelect) {
    unitSelect.addEventListener('change', (e) => {
      w.wxUnit = e.target.value || undefined; // '' (use global default) stores as no override at all
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  }
  const ovToggle = document.getElementById('wx-loc-override');
  if (ovToggle) {
    ovToggle.addEventListener('change', (e) => {
      const fields = document.getElementById('wx-loc-override-fields');
      if (e.target.checked) {
        fields.style.display = '';
      } else {
        fields.style.display = 'none';
        delete w.wxLat; delete w.wxLon; delete w.wxLabel;
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        showDisplayToast('Using global weather location');
      }
    });
  }
  const locLabel = document.getElementById('wx-loc-label');
  if (locLabel) {
    locLabel.addEventListener('input', (e) => { w.wxLabel = e.target.value; scheduleLayoutSave(); });
  }
  const lookupBtn = document.getElementById('wx-loc-lookup');
  if (lookupBtn) {
    lookupBtn.addEventListener('click', async () => {
      const zip = document.getElementById('wx-loc-zip').value.trim();
      const status = document.getElementById('wx-loc-status');
      if (!zip) { status.textContent = 'Enter a ZIP/postal code first.'; return; }
      status.textContent = 'Looking up…';
      try {
        const r = await (await fetch(`/api/geocode?save=0&zip=${encodeURIComponent(zip)}`)).json();
        if (r && r.lat && r.lon) {
          w.wxLat = String(r.lat); w.wxLon = String(r.lon);
          if (!w.wxLabel && r.label) { w.wxLabel = r.label; document.getElementById('wx-loc-label').value = r.label; }
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
  const placeGo = document.getElementById('wx-loc-place-go');
  const placeIn = document.getElementById('wx-loc-place');
  const runPlaceSearch = async () => {
    const q = (placeIn.value || '').trim();
    const status = document.getElementById('wx-loc-status');
    if (q.length < 2) { status.textContent = 'Type at least 2 characters.'; return; }
    status.textContent = 'Searching…';
    try {
      const r = await (await fetch(`/api/place-search?q=${encodeURIComponent(q)}`)).json();
      if (r && r.lat != null && r.lon != null) {
        w.wxLat = String(r.lat); w.wxLon = String(r.lon);
        if (!w.wxLabel && r.label) { w.wxLabel = r.label; document.getElementById('wx-loc-label').value = r.label; }
        status.textContent = `📍 ${r.label || (r.lat + ', ' + r.lon)}`;
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
        showDisplayToast('Location set ✓');
      } else {
        status.textContent = (r && r.error) || 'Nothing found for that.';
      }
    } catch {
      status.textContent = 'Search failed — check your connection.';
    }
  };
  if (placeGo) placeGo.addEventListener('click', runPlaceSearch);
  if (placeIn) placeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runPlaceSearch(); } });
}

