// ── Screens manager ───────────────────────────────────────────────────────────
// Lists connected physical screens (Pis) and lets you assign each a display
// profile, switching it live. New screens prompt to be named.
// Tracks which screens' "Screen Settings" accordion is currently open, so the
// periodic 15s auto-refresh (and any other re-render) can restore that state
// instead of always resetting every accordion back to closed — which is what
// was happening: the accordion never remembered anything, so it looked like it
// was randomly auto-collapsing a few seconds after any change.
const openScreenAccordions = new Set();
// Same idea, one level deeper — which of a screen's own Display / Ambient
// Mode / TV Control sub-sections is open. Keyed by "deviceId:subId" so each
// screen's three sub-sections are tracked independently of every other
// screen's. Mutually exclusive within a screen (opening one closes the
// other two for THAT screen) to match how every other accordion in this
// app already behaves — but independent ACROSS screens, same reasoning as
// openScreenAccordions above: comparing two screens side by side is
// reasonable, so one screen's open sub-section shouldn't affect another's.
const openScreenSubAccordions = new Set();
// Offline screens (an old test Pi, a display that's been unplugged for a
// while) can outnumber the ones actually worth looking at and bury them —
// hidden by default, same "Show X" toggle convention used elsewhere in this
// app (Feedback/Contact in admin.html). Persisted at module level, not
// re-derived from the DOM, so the periodic 15s auto-refresh doesn't silently
// re-collapse it back to hidden right after someone expands it.
let showOfflineScreens = false;
let showPreviewScreens = false; // collapsed by default — these are lower-priority than real devices, by explicit request

// Layout Profiles sub-tab: same "Show X" toggle convention as offline screens
// above — default to only showing profiles actually assigned to a screen
// (an "active" one), with a link to reveal the rest. Persisted at module
// level for the same reason: survives a re-render without silently
// re-collapsing.
let showAllProfiles = false;

// Returns the set of rule indices that have at least one genuine conflict
// with another rule — used purely for a UI warning, never by the actual
// firing logic in display.html's checkSchedules(), which already handles
// this correctly on its own (one fire per check, whichever rule happens to
// go second silently wins). By explicit request, so this doesn't happen as
// a surprise: two ENABLED rules sharing the exact same time AND at least
// one overlapping day would both fire within seconds of each other, with
// whichever fires second overwriting whatever the first one just showed.
// Only compares 'time'-mode rules (or legacy, mode-less rules, which
// default to 'time') against each other — Rotate (and the retired,
// dormant 'interval' mode some existing rules may still carry) runs
// continuously rather than at one discrete moment, so pairing either of
// those against a 'time' rule is a deliberate "override the rotation at
// this one moment" pattern, not a coincidental collision worth flagging.
// Identical logic to display.html's own copy of this function.
function scheduleConflictIndices(rules) {
  const conflicted = new Set();
  for (let i = 0; i < rules.length; i++) {
    const a = rules[i];
    if (!a || a.enabled === false) continue;
    const aMode = (a.mode === 'interval' || a.mode === 'rotation') ? a.mode : 'time';
    if (aMode !== 'time' || !a.time) continue;
    for (let j = i + 1; j < rules.length; j++) {
      const b = rules[j];
      if (!b || b.enabled === false) continue;
      const bMode = (b.mode === 'interval' || b.mode === 'rotation') ? b.mode : 'time';
      if (bMode !== 'time' || !b.time) continue;
      if (a.time !== b.time) continue;
      const aDays = new Set(a.daysOfWeek || []);
      if ((b.daysOfWeek || []).some(d => aDays.has(d))) { conflicted.add(i); conflicted.add(j); }
    }
  }
  return conflicted;
}

async function loadScreens() {
  const list = $('screens-list');
  if (!list) return;
  let screens, displays;
  try {
    let photos, hostVer, appSettings;
    [screens, displays, photos, hostVer, appSettings] = await Promise.all([
      apiFetch('/api/screens'), getDisplaysList(), apiFetch('/api/photos').catch(()=>[]),
      apiFetch('/api/version').catch(()=>null), apiFetch('/api/settings').catch(()=>({})),
    ]);
    window._hostVersion = (hostVer && hostVer.version) || '';
    window._photosList = photos || [];
    window._previewCleanupDays = Number((appSettings || {}).preview_screen_cleanup_days) || 7;
    const tagSet = new Set();
    (photos || []).forEach(p => (p.tags || '').split(',').forEach(t => { const v = t.trim(); if (v) tagSet.add(v); }));
    window._photoTags = Array.from(tagSet).sort();
  } catch {
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">Couldn't load displays.</div>`;
    return;
  }
  if (!Array.isArray(screens) || !screens.length) {
    list.innerHTML = `<div class="empty-state" style="padding:16px"><div class="emoji">🖥️</div>
      <p>No displays have connected yet.<br>Any screen with a browser works — see "Add a Display" below.</p></div>`;
    return;
  }

  const displayOptions = (slug) => (displays || []).map(d =>
    `<option value="${d.slug}" ${d.slug===slug?'selected':''}>${escapeHtml(d.name)}</option>`
  ).join('');

  // Preview screen identities (see previewScreenName()'s own comment in
  // server.js for why they exist at all) are pulled out into their own
  // group first, by explicit request — mixed in with real devices, they
  // were indistinguishable from genuine, unconfigured screens needing
  // attention. Filtered out here BEFORE the online/offline split below, so
  // neither of those two groups ever includes one.
  const previewScreens = screens.filter(s => s.device_id.startsWith('preview_'));
  const realScreens = screens.filter(s => !s.device_id.startsWith('preview_'));
  const onlineScreens = realScreens.filter(s => s.online);
  const offlineScreens = realScreens.filter(s => !s.online);
  if (!onlineScreens.length && offlineScreens.length && !showOfflineScreens) {
    // Every screen is offline — auto-reveal rather than showing an empty
    // list with just a "Show offline" link and nothing else on the page.
    showOfflineScreens = true;
  }
  const offlineToggleHtml = offlineScreens.length ? `
    <div style="text-align:center;padding:10px 0">
      <button id="screens-toggle-offline-btn" style="background:none;border:none;color:var(--accent);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 10px">
        ${showOfflineScreens ? 'Hide offline' : `Show offline (${offlineScreens.length})`}
      </button>
    </div>` : '';
  // Online screens always group first regardless of /api/screens' own
  // ordering — offline ones (if shown) come after, separated by the toggle
  // link above, rather than interleaved by whatever order the API returned.
  const renderScreenCard = (s) => {
    return loadScreens_renderScreenCard({ displayOptions }, s);
  };
  const previewToggleHtml = previewScreens.length ? `
    <div style="text-align:center;padding:10px 0;border-top:1px solid var(--border);margin-top:10px">
      <button id="screens-toggle-preview-btn" style="background:none;border:none;color:var(--accent);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 10px">
        ${showPreviewScreens ? 'Hide Live Edit previews' : `Show Live Edit previews (${previewScreens.length})`}
      </button>
    </div>` : '';
  const previewSectionHtml = showPreviewScreens ? `
    <p style="font-size:11px;color:var(--muted);padding:0 4px;margin:0 0 8px">
      Temporary identities created by "Open to Edit in New Tab" — one per display previewed this way. Each has its own separate switcher/schedule settings that never affect a real screen.
    </p>
    <div style="display:flex;align-items:center;gap:8px;padding:0 4px;margin:0 0 12px">
      <label for="preview-cleanup-days" style="font-size:11px;color:var(--muted)">Auto-remove after unseen for</label>
      <select id="preview-cleanup-days" class="form-input" style="width:auto;padding:6px 10px;font-size:12px">
        ${[3, 7, 14, 30, 90, 365].map(d => `<option value="${d}" ${window._previewCleanupDays === d ? 'selected' : ''}>${d < 30 ? `${d} days` : d < 365 ? `${Math.round(d / 30)} month${d >= 60 ? 's' : ''}` : '1 year'}</option>`).join('')}
      </select>
    </div>
    ${previewScreens.map(renderScreenCard).join('')}` : '';
  list.innerHTML = onlineScreens.map(renderScreenCard).join('')
    + offlineToggleHtml
    + (showOfflineScreens ? offlineScreens.map(renderScreenCard).join('') : '')
    + previewToggleHtml
    + previewSectionHtml;
  if ($('preview-cleanup-days')) {
    $('preview-cleanup-days').addEventListener('change', async (e) => {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ preview_screen_cleanup_days: Number(e.target.value) }) });
      window._previewCleanupDays = Number(e.target.value);
    });
  }
  if ($('screens-toggle-preview-btn')) {
    $('screens-toggle-preview-btn').addEventListener('click', () => {
      showPreviewScreens = !showPreviewScreens;
      loadScreens();
    });
  }
  if ($('screens-toggle-offline-btn')) {
    $('screens-toggle-offline-btn').addEventListener('click', () => {
      showOfflineScreens = !showOfflineScreens;
      loadScreens();
    });
  }
  wireScreenSwipes();
  wireScreenSettingsAccordions();
  wireScreenSubAccordions();
  wireFlsSubAccordions();

  // Prompt to name any brand-new, still-online, unnamed screen (once).
  const unnamed = screens.find(s => !s.name && s.online);
  loadScreens_if572Etc({ list, unnamed });

  const wireAlertBannerField = (cls, key) => list.querySelectorAll(cls).forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ [key]: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
  loadScreens_wireAlertBannerFieldEtc({ list, wireAlertBannerField });

  loadScreens_listQuerySelectorAll({ list });

  loadScreens_listQuerySelectorAllEtc({ list });

  loadScreens_listQuerySelectorAll2({ list });

  loadScreens_listQuerySelectorAll3({ list });

  function wireTvScheduleSlotHandlers(deviceId) {
    const container = list.querySelector(`.tv-schedule-slots[data-id="${deviceId}"]`);
    if (!container) return;
    container.querySelectorAll('.tv-slot-time').forEach(inp => {
      inp.addEventListener('change', async () => {
        const r = await apiFetch(`/api/tv-schedule/${inp.dataset.slotId}`, { method: 'PUT', body: JSON.stringify({ time: inp.value }) });
        if (r && r.error) { showToast('❌ ' + r.error); return; }
      });
    });
    container.querySelectorAll('.tv-slot-action').forEach(sel => {
      sel.addEventListener('change', async () => {
        const r = await apiFetch(`/api/tv-schedule/${sel.dataset.slotId}`, { method: 'PUT', body: JSON.stringify({ action: sel.value }) });
        if (r && r.error) { showToast('❌ ' + r.error); return; }
      });
    });
    container.querySelectorAll('.tv-slot-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await apiFetch(`/api/tv-schedule/${btn.dataset.slotId}`, { method: 'DELETE' });
        refreshTvScheduleSlots(deviceId);
      });
    });
  }

  async function refreshTvScheduleSlots(deviceId) {
    const slots = await apiFetch(`/api/screens/${deviceId}/tv-schedule`).catch(() => []);
    const container = list.querySelector(`.tv-schedule-slots[data-id="${deviceId}"]`);
    if (!container) return;
    container.innerHTML = (slots && slots.length) ? slots.map(slot => `
      <div style="display:flex;gap:6px;align-items:center" data-slot-id="${slot.id}">
        <input type="time" class="form-input tv-slot-time" data-slot-id="${slot.id}" value="${slot.time}" style="flex:1">
        <select class="form-input tv-slot-action" data-slot-id="${slot.id}" style="width:100px;flex:0 0 auto">
          <option value="on"  ${slot.action==='on'?'selected':''}>Power on</option>
          <option value="off" ${slot.action==='off'?'selected':''}>Power off</option>
        </select>
        <button type="button" class="icon-btn del tv-slot-del" data-slot-id="${slot.id}" title="Remove this time">🗑️</button>
      </div>
    `).join('') : '<p style="font-size:12px;color:var(--muted);margin:0">No scheduled times yet.</p>';
    wireTvScheduleSlotHandlers(deviceId);
  }

  loadScreens_listQuerySelectorAllEtc2({ list, wireTvScheduleSlotHandlers, refreshTvScheduleSlots });
  // Populated once for every screen card at once — same "fetch the light
  // list once, reuse for every checklist on the page" approach as the
  // widget's own preset picker, just applied across N screen cards instead
  // of one widget's settings panel. Two separate checklists (Live Displays,
  // Saved Templates) write into the SAME floating_switcher_presets array on
  // save, so every change reads BOTH lists' current checked state — not
  // just the one that changed — otherwise checking a box in one list would
  // silently wipe out whatever was already checked in the other.
  loadScreens_block1021({ list, onlineScreens });

  list.querySelectorAll('.screen-rename-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = prompt('Name this display:', btn.dataset.name || '');
      if (name === null) return;
      await apiFetch(`/api/screens/${btn.dataset.id}`, { method:'PUT', body: JSON.stringify({ name: name.trim() }) });
      loadScreens();
    });
  });

  list.querySelectorAll('.screen-del-btn').forEach(btn => {
    btn.addEventListener('click', () => forgetScreen(btn.dataset.id, btn.closest('.swipe-wrap')?.dataset.name || 'this display'));
  });

  list.querySelectorAll('.screen-push-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name || 'this screen';
      btn.disabled = true;
      showToast(`⏳ Pushing update to ${name}…`);
      try {
        const resp = await apiFetch('/api/push-to-slaves', { method:'POST', body: JSON.stringify({ deviceIds: [btn.dataset.id] }) });
        const r = (resp.results || [])[0];
        if (r && r.ok) showToast(`✅ Update sent to ${name} — it will restart shortly.`);
        else showToast(`❌ Push failed: ${(r && r.error) || 'unknown error'}`);
      } catch (e) {
        showToast('❌ Push failed: ' + (e.message || 'unknown error'));
      }
      loadScreens();
    });
  });
}
loadScreens._prompted = new Set();

async function forgetScreen(id, name) {
  if (!confirm(`Forget "${name}"? It will reappear if it reconnects.`)) { loadScreens(); return; }
  await apiFetch(`/api/screens/${id}`, { method:'DELETE' });
  showToast('Display forgotten');
  loadScreens();
}

// Swipe a screen card left to forget it (delete-only — duplicating a screen makes
// no sense). Mirrors the profile swipe but with a single action.
function wireScreenSwipes() {
  document.querySelectorAll('.screen-swipe').forEach(wrap => {
    const card = wrap.querySelector('.swipe-card');
    if (!card) return;
    let startX = 0, dx = 0, dragging = false, decided = false;
    const THRESH = 90;
    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, select, a, input')) return;
      dragging = true; decided = false; startX = e.clientX; dx = 0;
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      if (!decided && Math.abs(dx) > 6) { decided = true; try { card.setPointerCapture(e.pointerId); } catch {} }
      if (decided && dx < 0) { // only allow left-swipe
        card.style.transform = `translateX(${dx}px)`;
        wrap.classList.toggle('swipe-left', dx < -20);
      }
    });
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      card.style.transition = 'transform .2s';
      if (dx <= -THRESH) {
        card.style.transform = 'translateX(-100%)';
        setTimeout(() => forgetScreen(wrap.dataset.id, wrap.dataset.name), 180);
      } else {
        card.style.transform = '';
        wrap.classList.remove('swipe-left');
      }
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
  });
}

// While the Displays tab is open, refresh the screens list periodically so
// online/offline status and newly-connected screens stay reasonably current
// without a manual reload. Cleared when leaving the tab.
let _screensRefreshTimer = null;
function startScreensAutoRefresh() {
  stopScreensAutoRefresh();
  _screensRefreshTimer = setInterval(() => {
    if (currentTab !== 'displays' || !document.getElementById('screens-list')) { stopScreensAutoRefresh(); return; }
    // Skip this tick if focus is currently inside the list — loadScreens()
    // fully rebuilds every screen card's markup from scratch, which would
    // silently yank out from under someone anything they're mid-interaction
    // with (a dropdown they're browsing keeps focus the whole time it's
    // open, an input they're typing into, etc.). Confirmed as a real
    // report, not a hypothetical: specifically caught someone trying to
    // add a target to a schedule rule's own dropdown — the exact kind of
    // interaction this would interrupt. The next tick, 15s later, tries
    // again; this only ever delays a refresh, never skips it forever,
    // since the same check re-runs fresh every time.
    const active = document.activeElement;
    if (active && document.getElementById('screens-list').contains(active)) return;
    loadScreens();
  }, 15000);
}
function stopScreensAutoRefresh() {
  if (_screensRefreshTimer) { clearInterval(_screensRefreshTimer); _screensRefreshTimer = null; }
}

