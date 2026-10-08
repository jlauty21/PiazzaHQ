// ── Clock tick ───────────────────────────────────────────────────────────────
function tickClock() {
  // Update only clock widgets in-place for performance
  document.querySelectorAll('.w-clock .time').forEach(el => {
    const wrap = el.closest('.w-clock');
    const override = wrap && wrap.dataset.format; // '12'|'24'|undefined — per-widget override, if set
    const ampmOverride = wrap && wrap.dataset.ampm; // 'upper'|'lower'|undefined — per-widget override, if set
    const use24 = override ? (override === '24') : use24Hour();
    const now=new Date(); let h=now.getHours(),m=now.getMinutes();
    if (use24) { el.innerHTML = `${pad(h)}:${pad(m)}`; return; }
    const meridiem=h>=12?'pm':'am'; h=h%12||12;
    const ampm = ampmCase(ampmOverride) === 'upper' ? meridiem.toUpperCase() : meridiem;
    el.innerHTML=`${h}:${pad(m)}<span class="ampm">${ampm}</span>`;
  });
  // Analog clocks: rotate the three hands in place via CSS transform rather
  // than re-rendering the whole face every second — same "update in place,
  // don't rebuild" spirit as the digital clock's own text update just above.
  document.querySelectorAll('.w-clock-analog').forEach(wrap => {
    const deg = analogHandDegrees(new Date());
    const hour = wrap.querySelector('.hand-hour'), minute = wrap.querySelector('.hand-minute'), second = wrap.querySelector('.hand-second');
    if (hour) hour.style.setProperty('--deg', deg.hour + 'deg');
    if (minute) minute.style.setProperty('--deg', deg.minute + 'deg');
    if (second) second.style.setProperty('--deg', deg.second + 'deg');
  });
  document.querySelectorAll('.w-date .day-name').forEach(el=>{
    el.textContent=DAYS[new Date().getDay()];
  });
  // Real bug this fixed: this used to unconditionally hardcode US-long
  // format ("August 5, 2026") here, regardless of the widget's own format
  // setting or the global default — so every second, this silently
  // overwrote whatever renderDate() had just correctly rendered. Visually
  // that looked like the date format "constantly swapping back and forth":
  // a full re-render (layout save, live-sync update, etc.) would briefly
  // show the real configured format, then within a second this tick would
  // stomp it back to US-long, until the next re-render flashed it correct
  // again. Reads the SAME resolved format renderDate() stored on the
  // wrapper via data-format, using the same formatDateFull() helper, so
  // this refresh agrees with the actual render instead of fighting it.
  document.querySelectorAll('.w-date .date-str').forEach(el=>{
    const wrap = el.closest('.w-date');
    const format = (wrap && wrap.dataset.format) || globalDateFormat();
    el.textContent = formatDateFull(new Date(), format);
  });
  // Combined DateTime widget: same in-place-update approach as the
  // standalone Clock above (not a full renderDateTime() re-render every
  // second, which would also mean re-fetching/re-checking the weather
  // state for no reason) — reads its own data-format/data-ampm overrides
  // the same way .w-clock does, plus the seconds span if the widget has
  // them turned on.
  document.querySelectorAll('.w-datetime').forEach(wrap => {
    const hmEl = wrap.querySelector('.dt-hm');
    if (!hmEl) return;
    const override = wrap.dataset.format;
    const ampmOverride = wrap.dataset.ampm;
    const use24 = override ? (override === '24') : use24Hour();
    const now = new Date();
    let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    const secEl = wrap.querySelector('.dt-seconds');
    if (secEl) secEl.textContent = pad(s);
    if (use24) { hmEl.textContent = `${pad(h)}:${pad(m)}`; return; }
    const meridiem = h >= 12 ? 'pm' : 'am';
    const ampmEl = wrap.querySelector('.dt-ampm');
    if (ampmEl) ampmEl.textContent = ampmCase(ampmOverride) === 'upper' ? meridiem.toUpperCase() : meridiem;
    h = h % 12 || 12;
    hmEl.textContent = `${h}:${pad(m)}`;
  });
  // Timer widgets: update in-place every second rather than a full re-render.
  // Only widgets actively running (data-ends-at set) need per-second math; a
  // paused/reset timer's display never changes on its own.
  document.querySelectorAll('.w-timer .timer-display[data-ends-at]:not([data-ends-at=""])').forEach(el => {
    const endsAt = new Date(el.dataset.endsAt).getTime();
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    el.textContent = fmtMMSS(remaining);
    const card = el.closest('.w-timer');
    const statusEl = card && card.querySelector('.timer-status');
    if (remaining <= 0) {
      if (card && !card.classList.contains('timer-done')) card.classList.add('timer-done');
      if (statusEl) statusEl.textContent = '⏰ Time\'s Up!';
    }
  });
}
async function handleOrientationChange() {
  applyRotation(); // recompute wrapper sizing for the new viewport, then re-layout
  const o = getOrientation();
  if(o === currentOrientation) { renderLayout(); applyBackground(); return; }
  currentOrientation = o;
  await fetchLayoutAndRender(o);
  applyBackground();
}

// ── Init ─────────────────────────────────────────────────────────────────────
// ── Live updates (Server-Sent Events) ─────────────────────────────────────────
// Pushes instant refreshes when the control app saves changes, instead of
// waiting on the polling fallback below. Reconnects automatically if dropped.
function connectLiveUpdates() {
  const es = new EventSource(withDisplayParam('/api/live'));

  es.onmessage = async (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch { return; }
    const topic = data.topic;

    // Live command targeted at this specific screen (e.g. the app assigned it a
    // new display profile). The server only sends these to the matching screen,
    // but we double-check the id defensively.
    if (topic === 'screen-command') {
      if (data.screenId && data.screenId !== SCREEN_ID) return;
      if (data.command === 'switch-profile') {
        const newSlug = data.display || '';
        if (newSlug !== DISPLAY_SLUG) {
          // Reload onto the new profile. Using the URL makes the switch clean and
          // ensures all per-profile state (layout, theme, blank key) resets correctly.
          const base = window.location.origin + window.location.pathname;
          window.location.replace(newSlug ? `${base}?display=${encodeURIComponent(newSlug)}` : base);
        }
      } else if (data.command === 'set-info-corner') {
        noteConfiguredInfoCorner(data.corner || '');
      } else if (data.command === 'reload') {
        // Used when a per-screen setting (e.g. orientation/rotation) changed and must
        // be re-read at page load.
        window.location.reload();
      } else if (data.command === 'refresh-photos') {
        // A lighter touch than 'reload': re-fetch this screen's config (for its
        // screensaver tag/photo) and the photo list, so the screensaver filter
        // updates live. If ambient mode is currently showing, also rebuild it —
        // otherwise the already-synthesized layout keeps using whatever tag/photo
        // it was built with, ignoring a change made while it's actively displayed.
        fetchDisplayConfig().then(() => {
          if (typeof window.setAmbientMode === 'function') window.setAmbientMode(displayConfig.ambientMode || '');
        }).then(fetchPhotos).catch(() => {});
      } else if (data.command === 'refresh-floating-switcher') {
        // Floating switcher settings live in /api/screen-config, which
        // resolveAssignedProfile() already fetches and applies (including
        // the floating-switcher state hookup + re-render + pre-fetch kick).
        // Re-running it is a little more than strictly needed (it also
        // re-checks profile assignment), but that's harmless and reusing
        // it avoids a near-duplicate fetch function existing for just this.
        resolveAssignedProfile().catch(() => {});
      } else if (data.command === 'refresh-alert-banner') {
        // alert_banner_* also live in /api/screen-config — same reasoning as
        // refresh-floating-switcher. Re-fetch, then re-render the banner so a
        // style/size/position change shows immediately even while one is up.
        resolveAssignedProfile().then(() => { applyAlertBannerConfig(); pollHaAlerts(); }).catch(() => {});
      } else if (data.command === 'set-ambient-mode') {
        // Instant — no reload, mirrors set-info-corner above. window.setAmbientMode
        // is defined during init(); guard in case this somehow arrives first.
        if (typeof window.setAmbientMode === 'function') window.setAmbientMode(data.mode || '');
      }
      return;
    }

    if (topic === 'events') {
      await fetchEvents();
      await fetchTasksForLayout(); // task widgets don't depend on events, but cheap to keep in sync
      renderLayout();
    } else if (topic === 'profiles') {
      await fetchProfiles();
      renderLayout();
    } else if (topic === 'reminders') {
      await fetchReminders();
      renderLayout();
    } else if (topic === 'messages') {
      await fetchMessages();
      renderLayout();
    } else if (topic === 'cameras') {
      await fetchCameras();
      renderLayout();
    } else if (topic === 'meals') {
      await fetchMeals();
      renderLayout();
    } else if (topic === 'flightmap') {
      fetchFlightmap(true);
    } else if (topic === 'flight_watch') {
      try { state.flightWatch = await fetch('/api/flight-watch').then(r => r.json()); } catch {}
      fetchFlightmap(true);
    } else if (topic === 'settings') {
      const sRes = await fetch('/api/settings');
      state.settings = await sRes.json();
      // A mirror gets host changes through its sync, which announces only the
      // generic topics (this one included) - never 'photo-settings'. Re-read the
      // photo settings here too so a slideshow switched on/off or re-timed on the
      // host reaches a mirror's open display promptly instead of at the next
      // 5-minute refresh. The render calls further down pick up the new values.
      try {
        state.photoSettings = await fetch('/api/photo-settings').then(r => r.json());
        startSlideshowTimer();
      } catch {}
      checkSetupOverlay();
      applyTextColor();
      applyFontFamily();
      // Re-read this screen's own config (orientation, rotation, theme, ambient
      // …). Also a self-heal path: if a boot-time fetchDisplayConfig() failed
      // (e.g. reloaded mid-update) and left orientation on the seeded/last-known
      // value, any settings broadcast now brings it fully back in sync.
      await fetchDisplayConfig();
      const _preOrient = currentOrientation;
      // The host can reassign this screen's display profile (it lands in settings as
      // assigned_display_slug_remote on a slave). Re-resolve so a reassignment from
      // the host's Displays tab switches the layout live, without a reboot.
      await resolveAssignedProfile();
      // If the resolved orientation actually changed, switch layouts to match.
      const _postOrient = getOrientation();
      if (_postOrient !== _preOrient) { currentOrientation = _postOrient; applyRotation(); }
      await fetchWeather();
      await fetchStocks(); // stock_tickers may have changed
      await fetchNews();   // news source config may have changed
      await fetchHaEntities(); // ha_base_url/ha_token may have just been configured
      await fetchLayout(getOrientation());
      // fetchLayout() just overwrote state.layout with the real, non-ambient
      // widgets — this topic fires for MANY unrelated settings changes across
      // the whole app (weather config, stock tickers, anything), not just
      // things about this screen, so a display sitting in Photo mode would
      // otherwise silently revert to normal widgets every time ANY setting
      // changed anywhere. Re-synthesize on top if ambient mode is active.
      if (displayConfig.ambientMode && typeof window.setAmbientMode === 'function') {
        window.setAmbientMode(displayConfig.ambientMode);
      } else {
        renderLayout();
        applyBackground();
      }
    } else if (topic === 'photos') {
      await fetchPhotos();
      applyBackground();
      renderLayout();
    } else if (topic === 'photo-settings') {
      const psRes = await fetch('/api/photo-settings');
      state.photoSettings = await psRes.json();
      startSlideshowTimer();
      applyBackground();
      renderLayout();
    } else if (topic === 'layout') {
      // Only widget TYPES matter for deciding whether a full data refetch is
      // needed below — position/size changes (the vast majority of Live
      // Editing activity: dragging, resizing) never add a type that wasn't
      // already present, so comparing the set before/after is a cheap,
      // reliable way to tell "just moved something" apart from "a
      // genuinely new widget type showed up."
      const previousTypes = new Set((state.layout || []).map(w => w.type));
      await fetchLayout(currentOrientation);
      const newTypes = new Set((state.layout || []).map(w => w.type));
      const hasNewWidgetType = [...newTypes].some(t => !previousTypes.has(t));
      if (hasNewWidgetType) {
        // Full fetch set, matching the boot sequence exactly — not just Tasks/
        // News/Stocks. A widget type newly added to the layout while this
        // display is already running (e.g. Shopping List, Air Quality, Travel
        // Time, Chore Leaderboard — anything not in the smaller set this used
        // to call) would otherwise never get its first fetch: each of these
        // functions internally no-ops if that widget type isn't present, so
        // calling the full set unconditionally is cheap and safe, and is the
        // only way a brand-new widget's data arrives without waiting for its
        // own periodic timer (5–30 minutes depending on the widget) or the
        // display being switched to another layout and back, which happened to
        // trigger a full re-fetch as a side effect.
        //
        // Deliberately scoped to ONLY this case now, rather than running
        // unconditionally on every layout change — skipping it for a plain
        // position/size tweak (no new widget type) noticeably speeds up how
        // fast an edit shows up on another screen during active Live
        // Editing, since none of these 13 calls (several hitting external
        // APIs with real network latency) actually needed to run at all for
        // data that hadn't changed.
        await fetchAllWidgetDataSet();
      }
      // Same reasoning as 'settings' above — fetchLayout() just overwrote
      // state.layout with the real widgets, so re-synthesize ambient mode on
      // top if it's currently active, rather than silently reverting.
      if (displayConfig.ambientMode && typeof window.setAmbientMode === 'function') {
        window.setAmbientMode(displayConfig.ambientMode);
      } else {
        renderLayout();
        applyBackground();
      }
    } else if (topic === 'feeds') {
      await fetchEvents();
      renderLayout();
    } else if (topic === 'chores') {
      await Promise.allSettled([fetchChoreChart(), fetchStickersForLayout()]);
      renderLayout();
    } else if (topic === 'todos') {
      await fetchTodoForLayout();
      renderLayout();
    } else if (topic === 'shopping') {
      await fetchShoppingListForLayout();
      renderLayout();
    } else if (topic === 'displays') {
      // Orientation/rotation may have changed for this display — reload config,
      // re-apply rotation, and re-fetch the (possibly different) layout.
      await fetchDisplayConfig();
      applyRotation();
      applyTheme();
      const o = getOrientation();
      currentOrientation = o;
      await fetchLayout(o);
      await fetchTasksForLayout();
      await fetchNews();
      await fetchStocks();
      // Same reasoning again — and here it matters even more, since
      // fetchDisplayConfig() just re-read displayConfig.ambientMode fresh from
      // the server, so this correctly reflects the CURRENT setting, not a
      // stale one.
      if (displayConfig.ambientMode && typeof window.setAmbientMode === 'function') {
        window.setAmbientMode(displayConfig.ambientMode);
      } else {
        renderLayout();
        applyBackground();
      }
    }
  };

  es.onerror = () => {
    // EventSource auto-reconnects on its own (per the `retry:` hint the server sends),
    // but if the browser gives up entirely, force a fresh connection after a pause.
    es.close();
    setTimeout(connectLiveUpdates, 5000);
  };
}

// Backstop check-in: independent of SSE, ping the server every 30s so this screen
// stays "online" in the Screens manager even if SSE is briefly dropped/throttled.
let _checkinTimer = null;
function startScreenCheckin() {
  if (_checkinTimer) clearInterval(_checkinTimer);
  const ping = () => {
    let url = `/api/screen-checkin?screen=${encodeURIComponent(SCREEN_ID)}`;
    // The REAL display (not a preview) reports its physical screen resolution so the
    // phone preview can render at the TV's true size and look identical. screen.width
    // is in CSS px; multiply by devicePixelRatio for the actual pixel resolution.
    if (!IS_PREVIEW && window.screen) {
      const dpr = window.devicePixelRatio || 1;
      const sw = Math.round((window.screen.width || 0) * dpr);
      const sh = Math.round((window.screen.height || 0) * dpr);
      if (sw && sh) url += `&sw=${sw}&sh=${sh}`;
    }
    fetch(url, { method: 'POST' }).catch(() => {});
  };
  ping();
  _checkinTimer = setInterval(ping, 30000);
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // The display must NEVER white-screen, even if a startup call fails (e.g. a slave
  // on a different network momentarily can't reach things). Each step is guarded so
  // one failure can't abort the whole boot; we always reach renderLayout().
  //
  // Settings (and the force_real_display IS_PREVIEW correction that depends on
  // them) are fetched FIRST, before resolveAssignedProfile() — that function's
  // own screen-identity persistence (adoptCanonicalScreenId()) checks IS_PREVIEW
  // too, and on a misdetected real display that check running before the
  // correction would silently skip persisting this screen's canonical id on
  // every single boot, not just skip edit mode.
  try {
    const [sRes, psRes] = await Promise.all([fetch('/api/settings'), fetch('/api/photo-settings')]);
    state.settings = await sRes.json();
    state.photoSettings = await psRes.json();
  } catch (e) { console.error('init: settings', e); state.settings = state.settings || {}; state.photoSettings = state.photoSettings || {}; }
  try { applyForceRealDisplayOverride(); } catch (e) { console.error('init: forceRealDisplay', e); }

  // Seed orientation/rotation from the last successful config fetch. Without
  // this, a display that reloads mid-update (server still restarting, so
  // /api/display-config times out through fetchWithRetry's ~6s of retries)
  // falls back to displayConfig's hardcoded { force_orientation:'auto',
  // rotation:0 }. "auto" then derives orientation from the physical viewport —
  // which is landscape on a portrait screen that's rotated in the browser — so
  // the whole layout flips portrait->landscape and stays that way until
  // something else forces a re-fetch (the reported bug). Seeding from the cache
  // holds the device's real orientation through that window; a later successful
  // fetchDisplayConfig() (retry / SSE 'settings' / periodic) still applies a
  // genuine change.
  if (!IS_PREVIEW) {
    try {
      const cached = JSON.parse(localStorage.getItem('phq_display_orient') || 'null');
      if (cached && ['auto', 'landscape', 'portrait'].includes(cached.f)) {
        displayConfig.force_orientation = cached.f;
        displayConfig.rotation = Number(cached.r) || 0;
      }
    } catch {}
  }

  try { await resolveAssignedProfile(); } catch (e) { console.error('init: resolveAssignedProfile', e); }

  try { checkTrialNotice(); } catch (e) { console.error('init: trialNotice', e); }
  try { applyTextColor(); } catch {}
  try { applyFontFamily(); } catch {}
  try { await fetchDisplayConfig(); } catch (e) { console.error('init: displayConfig', e); }
  try { checkSetupOverlay(); } catch (e) { console.error('init: setupOverlay', e); }
  try { checkLicenseBlock(); } catch (e) { console.error('init: licenseBlock', e); }
  try { applyRotation(); applyTheme(); } catch {}
  try { wireDirectEditMode(); } catch (e) { console.error('init: directEditMode', e); }

  currentOrientation = getOrientation();
  // Seed the layout from the last one that loaded cleanly for this
  // orientation. Same reasoning as the orientation seed above: a reload that
  // lands mid-update (server restarting, /api/layouts times out through
  // fetchWithRetry) otherwise leaves state.layout empty and the screen blank
  // until an SSE event or a manual display switch forces a re-fetch (the
  // reported bug). fetchLayout() reconciles the real data over this by id, so
  // a successful fetch a moment later converges cleanly.
  if (!IS_PREVIEW && (!state.layout || !state.layout.length)) {
    try {
      const cachedLayout = JSON.parse(localStorage.getItem('phq_layout_' + currentOrientation) || 'null');
      if (Array.isArray(cachedLayout) && cachedLayout.length) state.layout = cachedLayout;
    } catch {}
  }
  // Load the layout + data, each guarded. A failure in one doesn't blank the screen.
  let _layoutBootOk = false;
  try { await fetchLayout(currentOrientation); _layoutBootOk = true; } catch (e) { console.error('init: layout', e); state.layout = state.layout || []; }
  await Promise.allSettled([fetchEvents(), fetchReminders(), fetchMessages(), fetchCameras(), fetchMeals(), fetchWeather(), fetchPhotos(), fetchProfiles(), fetchFlightmap(true)]);
  await Promise.allSettled([fetchTasksForLayout(), fetchTodoForLayout(), fetchShoppingListForLayout(), fetchNews(), fetchStocks(), fetchChoreChart(), fetchStickersForLayout(), fetchAirQuality(), fetchTravelTimes(), fetchOnThisDay(), fetchDailyQuote(), fetchSports(), fetchMetarTaf(), fetchHaEntities()]);
  fetchEventHistory().then(renderLayout).catch(()=>{}); // deep history in background
  try { renderLayout(); } catch (e) { console.error('init: render', e); }
  // If the boot layout fetch failed outright (not just "no widgets"), keep
  // retrying hard for a couple of minutes so the screen fills itself in,
  // rather than waiting on the next SSE/settings event or a manual switch.
  if (!_layoutBootOk) {
    let _lTries = 0;
    const _lRetry = setInterval(async () => {
      _lTries++;
      try {
        await fetchLayout(currentOrientation);
        clearInterval(_lRetry);
        renderLayout(); applyBackground();
        Promise.allSettled([fetchTasksForLayout(), fetchTodoForLayout(), fetchShoppingListForLayout(), fetchNews(), fetchStocks(), fetchChoreChart(), fetchStickersForLayout(), fetchAirQuality(), fetchTravelTimes(), fetchHaEntities()]).then(() => { try { renderLayout(); } catch {} }).catch(() => {});
      } catch {}
      if (_lTries >= 15) clearInterval(_lRetry);
    }, 8000);
  }
  try { applyBackground(); } catch {}
  startSlideshowTimer();
  try { reportPainted(); } catch {}

  // Clock ticks every second
  setInterval(tickClock, 1000);

  // Auto-reload after a software update: capture the running server version at boot,
  // then poll periodically. When the server comes back on a NEW version (e.g. after
  // an auto-pushed update), reload the page so the kiosk picks up the new display
  // code automatically — no manual reboot needed. This is what makes pushed updates
  // actually take effect on the wall display.
  let _bootVersion = null;
  try { const v = await (await fetch('/api/version')).json(); _bootVersion = v.version; initDemoBanner(v); } catch {}
  setInterval(async () => {
    try {
      const v = await (await fetch('/api/version')).json();
      if (_bootVersion && v.version && v.version !== _bootVersion) {
        console.log(`Server updated ${_bootVersion} -> ${v.version}; reloading display.`);
        window.location.reload();
      }
    } catch { /* server mid-restart; try again next tick */ }
  }, 60_000);

  // Home Assistant condition alerts — poll the (host-evaluated) active list
  // and show a dismissible banner. Cheap; no SSE plumbing needed.
  pollHaAlerts();
  setInterval(pollHaAlerts, 60_000);

  // Live push handles instant updates; these polls are just a safety net in case
  // the SSE connection drops silently (e.g. through a flaky tunnel) without erroring.
  setInterval(async ()=>{ await fetchEvents(); renderLayout(); }, 300_000);       // 5min (recent events)
  setInterval(async ()=>{ await fetchEventHistory(); renderLayout(); }, 86_400_000); // once/day (deep history)
  setInterval(async ()=>{ await fetchReminders(); renderLayout(); }, 86_400_000); // once/day safety-net refresh — SSE ('reminders' topic) is the primary path, this just covers a missed broadcast
  setInterval(async ()=>{ await fetchMessages(); renderLayout(); }, 86_400_000); // once/day safety-net refresh — SSE ('messages' topic) is the primary path
  setInterval(async ()=>{ await fetchCameras(); renderLayout(); }, 3_600_000); // hourly — also re-checks the go2rtc service state so a fixed install recovers on its own
  setInterval(async ()=>{ await fetchMeals(); renderLayout(); }, 86_400_000); // once/day safety-net — SSE ('meals' topic) is the primary path; a daily refresh also rolls the window forward

  // Re-check trial status hourly — the underlying cache this reads only refreshes
  // every 6 hours server-side, but re-checking more often on the client catches a
  // day-boundary crossing (so "3 days left" ticks down) without needing a reload.
  setInterval(async () => {
    try { state.settings = await (await fetch('/api/settings')).json(); checkTrialNotice(); checkLicenseBlock(); } catch {}
  }, 3_600_000);
  // Weather refresh interval is user-configurable (Settings → Weather), 5–60 min.
  // Default 15 min. We read it from settings and clamp to the allowed range.
  const weatherMins = Math.max(5, Math.min(60, parseInt(state.settings?.weather_refresh_min) || 15));
  setInterval(async ()=>{ await fetchWeather(); renderLayout(); }, weatherMins * 60_000);
  setInterval(async ()=>{ await fetchPhotos(); applyBackground(); }, 600_000);    // 10min
  // Chore chart: refresh every 5 min as a safety net and to roll the day over at
  // midnight (live SSE 'chores' handles instant check-offs in between).
  setInterval(async ()=>{ await Promise.allSettled([fetchChoreChart(), fetchStickersForLayout()]); renderLayout(); }, 300_000);
  setInterval(async ()=>{ await fetchTasksForLayout(); await fetchTodoForLayout(); await fetchShoppingListForLayout(); renderLayout(); }, 300_000); // 5min
  setInterval(async ()=>{ await fetchNews(); renderLayout(); }, 900_000);         // 15min — matches server cache
  setInterval(async ()=>{ await fetchStocks(); renderLayout(); }, 300_000);       // 5min — matches server cache
  // Home Assistant entities — 8s ambient poll. History: 60s felt slow →
  // 15s (matched to the old 10s server cache floor) → now 8s, paired with
  // the server cache dropping to 4s (HA_STATE_CACHE_MS), so a change made
  // in the HA app or by an automation shows on the wall within a few
  // seconds. A tap on a control doesn't wait for this at all — it updates
  // optimistically and does its own confirm read (see callHaAction). The
  // per-entity fetch is cheap and the server cache absorbs multi-display
  // overlap, so this stays well short of hammering a household HA. Live
  // Edit's own poll (_editModeHaPollTimer) is faster still at 4s.
  setInterval(async ()=>{ if (await fetchHaEntities()) renderLayout(); }, 8_000);
  setInterval(async ()=>{ await fetchAirQuality(); renderLayout(); }, 1_800_000); // 30min — AQI/pollen/UV change slowly
  setInterval(async ()=>{ await fetchTravelTimes(); renderLayout(); }, 300_000);  // 5min — traffic conditions change fast
  setInterval(async ()=>{ await fetchOnThisDay(); renderLayout(); }, 3_600_000);  // hourly — server caches per-day anyway, this just catches midnight rollover
  setInterval(async ()=>{ await fetchDailyQuote(); renderLayout(); }, 3_600_000); // hourly — same reasoning
  setInterval(async ()=>{ await fetchSports(); renderLayout(); }, 900_000);       // 15min — schedule/final scores, not live in-play
  setInterval(async ()=>{ await fetchMetarTaf(); renderLayout(); }, 600_000);     // 10min — matches server cache

  // Full-page auto-reload (like pressing F5), per-display setting, every 6 hours by default (0 = off). A
  // kiosk that runs for weeks benefits from re-issuing its page load now and then: it clears any drift or
  // memory buildup and recovers from a page that got stuck. We read the setting fresh each minute so a
  // change takes effect without a manual reload.
  //
  // Because this is on for everyone by default, the reload is careful about WHEN it happens. Once due it
  // waits for (a) a quiet moment - nobody touching the screen, and not in Live Edit, where a reload would
  // throw away unsaved changes - and (b) the server to actually answer: a reload while the Pi's own server
  // is mid-restart would land the browser on its "can't reach this page" screen and leave it there, a
  // far worse state than the slightly stale page it replaced. If either isn't true it simply tries again
  // a minute later.
  let _refreshElapsedMs = 0;
  let _lastInputAt = Date.now();
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, () => { _lastInputAt = Date.now(); }, { passive: true, capture: true });
  async function autoRefreshTick() {
    const mins = parseInt(state.settings?.display_refresh_min) || 0;
    if (mins <= 0) { _refreshElapsedMs = 0; return; }
    // Skip while ambient mode (Photo only / Photo + time) is showing — reloading
    // a screen that's meant to be a calm, uninterrupted photo display defeats the
    // point, and if re-applying ambient mode after the reload ever hiccups for any
    // reason, it's stuck showing normal widgets until the NEXT scheduled reload,
    // which could be hours away. Ambient mode's own footprint is minimal anyway,
    // so the original memory-drift justification for reloading matters less here.
    if (displayConfig.ambientMode) { _refreshElapsedMs = 0; return; }
    _refreshElapsedMs += 60_000;
    if (_refreshElapsedMs < mins * 60_000) return;
    if (editModeActive || Date.now() - _lastInputAt < 120_000) return;   // not while someone is using or editing the screen
    try {
      const r = await fetch('/api/version', { cache: 'no-store' });
      if (!r.ok) return;                                                  // server not answering properly yet - try again next minute
    } catch { return; }
    window.location.reload();
  }
  setInterval(autoRefreshTick, 60_000);
  setInterval(async ()=>{
    const [sRes,psRes] = await Promise.all([fetch('/api/settings'),fetch('/api/photo-settings')]);
    state.settings = await sRes.json();
    state.photoSettings = await psRes.json();
    startSlideshowTimer();
    await resolveAssignedProfile();   // catch host profile reassignments even if SSE missed it
    await fetchLayout(currentOrientation);
    await fetchTasksForLayout();
    // Same bug as the settings/layout/displays SSE topics had — this periodic
    // check runs unconditionally every 5 minutes regardless of anything else,
    // and fetchLayout() just overwrote state.layout with the real, non-ambient
    // widgets. Re-synthesize ambient mode on top if it's currently active,
    // rather than silently reverting to normal widgets every 5 minutes forever.
    if (displayConfig.ambientMode && typeof window.setAmbientMode === 'function') {
      window.setAmbientMode(displayConfig.ambientMode);
    } else {
      renderLayout();
      applyBackground();
    }
  }, 300_000); // 5min

  // Fast profile-assignment poll: every 20s, re-check this screen's assigned profile
  // directly (local call). This guarantees a host reassignment applies promptly even
  // if the live SSE connection has dropped — which is the common case for a screen on
  // a different network. resolveAssignedProfile() only reloads the layout when the
  // slug actually changes, so this is cheap when nothing's changed.
  setInterval(async () => {
    try { await resolveAssignedProfile(); } catch {}
  }, 20_000);

  // Scheduled auto-switching (Layout Switcher's schedule rules, both the
  // widget's own and the floating switcher's) — checked independently of
  // the profile poll above since it doesn't need a network round trip, just
  // the current time against whatever rules are already in state. 5s
  // (down from an original 30s) — needed once interval-mode rules
  // ("every X seconds") existed at all: a 30s check couldn't fire any more
  // precisely than every 30 seconds no matter what shorter interval was
  // configured, since the check itself only runs that often. The function
  // is cheap (no network calls unless a rule actually fires), so checking
  // 6x more often isn't meaningfully more expensive.
  //
  // Never runs at all in the small, embedded thumbnail preview — that
  // context is read-only and not something anyone is actively watching for
  // a schedule rule to visibly fire in, unlike "Open to Edit in New Tab",
  // which still runs this (and still correctly can't persist a switch —
  // see switchToLayoutTarget()'s own IS_PREVIEW guard). Checks
  // EMBEDDED_THUMBNAIL specifically, not ALLOW_EDIT_IN_PREVIEW — the
  // original version of this gate assumed the embedded thumbnail was
  // ALLOW_EDIT_IN_PREVIEW=false, which was never actually true (both
  // contexts share allowEdit=1 in their URL — a separate, real bug in
  // app.html's buildPreviewUrl(), only found because THIS gate's own
  // premise turned out to be wrong): the schedule-check toast fired inside
  // that "read-only" thumbnail, live, on a real report. The
  // switchToLayoutTarget() persist-guard still correctly stopped anything
  // from actually saving even while this gate was broken, since it only
  // ever needed IS_PREVIEW — but the visible, confusing symptom (a
  // "read-only" preview switching on its own) was this gate's fault, not
  // that one's.
  if (!EMBEDDED_THUMBNAIL) {
    setInterval(() => {
      try { checkSchedules(); } catch {}
    }, 5_000);
    try { checkSchedules(); } catch {} // don't wait up to 5s for a rule already due right now
  }

  // Orientation change — respond to both resize and the explicit orientationchange
  // event (mobile browsers sometimes fire the latter slightly after a rotation, and
  // report stale dimensions on the former). A short debounce coalesces the pair.
  let _orientTimer = null;
  const onViewportChange = () => {
    clearTimeout(_orientTimer);
    _orientTimer = setTimeout(handleOrientationChange, 150);
  };
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);

  // ── Blank mode (Tab key) ──
  // Tab toggles a "blanked" view that hides everything except the photo
  // background (or a solid dark screen if no photo). State is remembered per
  // display (BLANK_KEY, defined at top) so a refresh keeps the chosen mode;
  // it's already applied pre-paint there, so here we only wire the toggle.
  function setBlanked(on) {
    document.body.classList.toggle('blanked', on);
    try { localStorage.setItem(BLANK_KEY, on ? '1' : '0'); } catch {}
    // Re-assert the background: when blanking, force the photo to show even if a
    // photo widget is in the layout (widgets are hidden now). When un-blanking,
    // restore the normal rule.
    applyBackground(on);
  }

  // DISABLED — Tab-key screensaver isn't used; commented out rather than
  // removed in case it's wanted again later. (See also BLANK_KEY's pre-paint
  // restoration above, disabled for the same reason.) setBlanked() itself is
  // left defined below — unreachable now, but harmless, and keeps this easy
  // to restore by just uncommenting both spots.
  // window.addEventListener('keydown', (e) => {
  //   if (e.key === 'Tab') {
  //     e.preventDefault(); // stop Tab from moving focus around behind the scenes
  //     setBlanked(!document.body.classList.contains('blanked'));
  //   }
  // });

  // ── Ambient mode (app-driven, Devices tab) ──
  // Redesigned to synthesize a temporary full-screen widget layout (a real Photo
  // widget, plus real Clock/Date widgets for the "+ time" variant) and feed it
  // through the SAME renderLayout() every normal widget already uses — rather
  // than a separate, parallel "hide the canvas, force a special background photo
  // mode" pipeline. Reusing the already-working, already-fixed widget rendering
  // (independent tag filter, proper slideshow cycling, existing tickClock()
  // updates) is both simpler and more robust than maintaining a second system.
  const AMBIENT_CORNER_POS = {
    tl: { x: 4,  y: 4  },
    tr: { x: 50, y: 4  },
    bl: { x: 4,  y: 68 },
    br: { x: 50, y: 68 },
  };
  function buildAmbientLayout(mode, realLayout) {
    if (mode !== 'photo' && mode !== 'photo_datetime') return null;
    const photoWidget = {
      id: '__ambient_photo', type: 'photo', x: 0, y: 0, w: 100, h: 100, z: 0,
      photoFit: displayConfig.ambientPhotoFit || 'cover',
      photoFadeTransition: displayConfig.ambientFadeTransition !== false,
      photoInterval: displayConfig.ambientPhotoInterval ? parseInt(displayConfig.ambientPhotoInterval) : null,
      photoAutoBlurBg: displayConfig.ambientBlurBg !== false,
      photoFadeDuration: parseFloat(displayConfig.ambientFadeDuration) || 2,
    };
    // Tie this to the screen's own configured screensaver source — a specific
    // photo (no cycling) takes priority if set, else a tag-based slideshow (or
    // all photos, if no tag either). Previously this widget carried neither
    // setting at all, so "Photo only" mode showed every active photo regardless
    // of what the screen's screensaver was actually configured to show.
    if (displayConfig.screensaverPhotoId) {
      photoWidget.photoMode = 'selected';
      photoWidget.photoIds = [displayConfig.screensaverPhotoId];
    } else {
      photoWidget.photoTag = displayConfig.screensaverTag || '';
    }
    if (mode === 'photo') return [photoWidget];

    // If the real (non-ambient) layout already has a Clock/Date widget, match
    // its exact position/size/font/color — ambient mode should look like an
    // extension of what's already there, not something different bolted on. If
    // one or both are missing, fall back to the chosen corner (Devices tab)
    // instead, using the same tileOpacity-for-legibility approach either way.
    const existingClock = (realLayout || []).find(w => w.type === 'clock');
    const existingDate  = (realLayout || []).find(w => w.type === 'date');
    const corner = AMBIENT_CORNER_POS[displayConfig.ambientClockCorner] || AMBIENT_CORNER_POS.bl;

    const clockWidget = existingClock
      ? { ...existingClock, id: '__ambient_clock' }
      : { id: '__ambient_clock', type: 'clock', x: corner.x, y: corner.y, w: 46, h: 16, z: 1, clockFontPx: 90, textColor: '#ffffff', tileOpacity: 35 };
    const dateWidget = existingDate
      ? { ...existingDate, id: '__ambient_date' }
      : { id: '__ambient_date', type: 'date', x: corner.x, y: corner.y + 16, w: 46, h: 10, z: 1, dateFontPx: 26, textColor: '#ffffff', tileOpacity: 35 };
    return [photoWidget, clockWidget, dateWidget];
  }
  let _layoutBeforeAmbient = null;
  window.setAmbientMode = function setAmbientMode(mode) {
    // Keep this synced to whatever's ACTUALLY currently showing — previously
    // only ever set once, from the initial page load's fetchDisplayConfig().
    // Toggling ambient mode live (the normal way anyone would actually turn
    // this on, via the app, not by reloading the page) called this function
    // directly without ever touching displayConfig.ambientMode, leaving it
    // stale — which silently broke the auto-refresh-skip fix (and anything
    // else that might ever check this variable), since it was reading
    // whatever ambient mode happened to be at the last page load, not
    // what's actually on screen right now.
    displayConfig.ambientMode = mode || '';
    const wantsAmbient = mode === 'photo' || mode === 'photo_datetime';
    if (wantsAmbient) {
      // Capture the real layout BEFORE it gets overwritten — needed both to
      // restore later, and so buildAmbientLayout can match existing clock/date
      // widget positions on this exact switch (not just subsequent ones).
      const realLayout = _layoutBeforeAmbient || state.layout;
      if (!_layoutBeforeAmbient) _layoutBeforeAmbient = state.layout;
      state.layout = buildAmbientLayout(mode, realLayout);
    } else if (_layoutBeforeAmbient) {
      state.layout = _layoutBeforeAmbient;
      _layoutBeforeAmbient = null;
    }
    renderLayout();
    // Safety net: correctly suppresses the old full-screen background mechanism
    // now that a real Photo widget is present (hasPhotoWidget becomes true), and
    // cleans up anything left over from before switching modes.
    applyBackground();
  };
  if (displayConfig.ambientMode) setAmbientMode(displayConfig.ambientMode);

  // The other two here (a persistent 30s check-in loop that registers a
  // phantom "screen" with the server, and a wake-lock re-acquire timer) don't
  // belong in a preview iframe at all — a throwaway snapshot render has no
  // business registering itself as a real screen, and there's no display to
  // keep awake. Live updates (SSE) used to be excluded here too, for a real
  // reason: closing the preview used to just hide the iframe rather than
  // destroy it, so a connection left running here leaked indefinitely in the
  // background — a solid explanation for real instability on a phone
  // browser. That's fixed now (closing the preview genuinely tears down the
  // iframe's document, see the Live Preview toggle in app.html), so SSE is
  // no longer excluded — this is specifically what makes moving a widget in
  // the editor show up in Live Preview immediately, instead of needing a
  // manual reload to see it.
  connectLiveUpdates();
  if (!IS_PREVIEW) {
    // Backstop online-presence pings (independent of SSE).
    startScreenCheckin();

    // Keep the screen awake (disable screensaver / display sleep) from within the
    // page using the Screen Wake Lock API. Chromium on the Pi supports this. The
    // lock is dropped by the browser if the tab is hidden, so we re-acquire it on
    // visibility change. This is the in-app layer; the installer also disables
    // OS-level screen blanking for belt-and-suspenders coverage.
    initWakeLock();
  }
}

let _wakeLock = null;
async function initWakeLock() {
  if (!('wakeLock' in navigator)) return; // older browser — OS-level setting covers it
  const acquire = async () => {
    try {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', () => { /* will re-acquire on visibility */ });
    } catch { /* e.g. not visible yet; retried on visibilitychange */ }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });
  await acquire();
  // Safety net: some Chromium builds drop the lock silently; re-check periodically.
  setInterval(() => { if (document.visibilityState === 'visible' && (!_wakeLock || _wakeLock.released)) acquire(); }, 60_000);
}

window.__phqBooted = true; // the boot watchdog in display.html looks for this
init();
