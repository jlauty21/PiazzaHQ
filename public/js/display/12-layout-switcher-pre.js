// ── Layout Switcher: pre-fetch cache + instant local switch ──────────────────
// Core mechanic shared by both placements — the per-layout widget and the
// screen-level floating button (see renderLayoutSwitcher() and
// renderFloatingSwitcher() below). The point of pre-fetching is entirely
// about perceived speed: applying a saved layout normally means a full
// round trip (fetch the new widget list, then fetch data for any widget
// type that's newly showing up) before anything visible happens. Since a
// switcher's target presets are known in advance — configured, not
// discovered at tap time — that data can be kept warm in the background
// ahead of time, so tapping the button does an instant local swap instead
// of waiting on a fetch.
state._switcherPresetCache = state._switcherPresetCache || {}; // targetKey -> {widgets_landscape, widgets_portrait, theme, fetchedAt}
state._switcherNamesCache = state._switcherNamesCache || null;   // [{id, name}], saved templates — from the light list endpoint
state._switcherDisplayNamesCache = state._switcherDisplayNamesCache || null; // [{slug, name}], live displays
const SWITCHER_CACHE_TTL_MS = 5 * 60 * 1000; // re-warm every 5 min, matching this app's usual "periodic refresh" cadence
let _switcherDataWarmedAt = 0; // last time prefetchSwitcherPresets() ran fetchAllWidgetDataSet(), separate from per-preset cache timestamps

// A switch target is either a saved template ({type:'saved', id: <saved_layout id, a number>})
// or a live display ({type:'display', id: <display slug, a string>}) — added
// after the widget-only version turned out to be a real, not just perceived,
// gap: people reasonably expect to point a switcher at one of their actual
// screens, not only a template saved ahead of time. Normalizes a raw list
// (which may be OLD-format bare numbers/numeric-strings — always meant a
// saved_layout id, from before this expansion existed) into canonical
// target objects, so every other switcher function only ever deals with
// one consistent shape regardless of how old the data is.
function normalizeSwitcherTargets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(t => {
    if (typeof t === 'number' || (typeof t === 'string' && /^\d+$/.test(t))) return { type: 'saved', id: Number(t) };
    if (t && t.type === 'saved' && Number.isInteger(Number(t.id))) return { type: 'saved', id: Number(t.id), icon: (typeof t.icon === 'string' && t.icon.trim()) ? t.icon.trim().slice(0, 8) : '' };
    if (t && t.type === 'display' && typeof t.id === 'string' && t.id) return { type: 'display', id: t.id, icon: (typeof t.icon === 'string' && t.icon.trim()) ? t.icon.trim().slice(0, 8) : '' };
    return null;
  }).filter(Boolean);
}
function switcherTargetKey(target) { return `${target.type}:${target.id}`; }

// Every target currently referenced by ANY switcher on this screen — every
// Layout Switcher widget on the CURRENT layout, plus the floating
// switcher's own configured list (which persists across whatever layout is
// showing, unlike a widget). Used both to decide what to pre-fetch and, on
// the picker side, which names to show.
function getSwitcherTargetsInUse() {
  const seen = new Map(); // keyed to dedupe — the same target could appear on multiple switchers
  const add = (t) => seen.set(switcherTargetKey(t), t);
  (state.layout || []).forEach(w => {
    if (w.type !== 'layoutswitcher') return;
    // switcherTargets is the current field; switcherPresetIds is what any
    // widget saved before this expansion still has — read both, write only
    // the new one going forward (see the widget's own settings panel).
    normalizeSwitcherTargets(w.switcherTargets || w.switcherPresetIds).forEach(add);
  });
  normalizeSwitcherTargets(state.floatingSwitcherPresets).forEach(add);
  return [...seen.values()];
}

// ── Scheduled auto-switching ──────────────────────────────────────────────
// Every rule currently in play — every Layout Switcher widget on the
// CURRENT layout's own switcherSchedule, plus the floating switcher's own
// floating_switcher_schedule (persists across whatever layout is showing,
// same as its manual presets do). Not deduped like getSwitcherTargetsInUse()
// — two different rules can legitimately target the same thing at
// different times, there's nothing to collapse.
function getScheduleRulesInUse() {
  const rules = [];
  (state.layout || []).forEach(w => {
    if (w.type !== 'layoutswitcher' || !Array.isArray(w.switcherSchedule)) return;
    rules.push(...w.switcherSchedule);
  });
  if (Array.isArray(state.floatingSwitcherSchedule)) rules.push(...state.floatingSwitcherSchedule);
  return rules;
}
// Stable identity for a rule, used to track "already fired"/"last fired at"
// — two rules with identical timing/days/target are indistinguishable
// anyway, so collapsing them onto the same key is correct, not a bug.
// Branches on mode explicitly rather than just using rule.time directly —
// an interval-mode rule has no time field at all, so falling back to that
// alone would collapse every interval rule onto the same key regardless of
// its actual interval or target.
function scheduleRuleKey(rule) {
  if (rule.mode === 'rotation') {
    // Own branch, not folded into the generic path below — a rotation
    // rule has a targets ARRAY, not a single target, so the generic
    // rule.target.type:rule.target.id construction would crash on
    // rule.target being undefined for this mode entirely.
    return `rotation:${(rule.targets || []).map(t => `${t.type}:${t.id}`).join(',')}|${rule.intervalValue}${rule.intervalUnit}`;
  }
  const timing = rule.mode === 'interval' ? `every:${rule.intervalValue}${rule.intervalUnit}` : `at:${rule.time}`;
  return `${timing}|${[...(rule.daysOfWeek || [])].sort().join(',')}|${rule.target.type}:${rule.target.id}`;
}
// Returns the set of rule indices that have at least one genuine conflict
// with another rule — used purely for a UI warning, never by the actual
// firing logic in checkSchedules() itself, which already handles this
// correctly on its own (one fire per check, whichever rule happens to go
// second silently wins). By explicit request, so this doesn't happen as a
// surprise: two ENABLED rules sharing the exact same time AND at least one
// overlapping day would both fire within seconds of each other, with
// whichever fires second overwriting whatever the first one just showed.
// Only compares 'time'-mode rules (or legacy, mode-less rules, which
// default to 'time') against each other — Rotate (and the retired,
// dormant 'interval' mode some existing rules may still carry) runs
// continuously rather than at one discrete moment, so pairing either of
// those against a 'time' rule is a deliberate "override the rotation at
// this one moment" pattern, not a coincidental collision worth flagging.
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
const _scheduleFiredToday = {}; // ruleKey -> "YYYY-MM-DD" it last fired, self-cleaning by nature (see below)
// Interval-mode's own tracking — ruleKey -> timestamp (ms) it last fired.
// A rolling "how long since last fire" check, not a once-per-calendar-day
// one, so this can't share _scheduleFiredToday's date-string shape; needs
// its own object. Same self-bounding property though: each key's value is
// overwritten in place every fire, so size stays bounded to "how many
// distinct interval rules have ever existed," not how many times any of
// them has fired.
const _intervalRuleLastFired = {};
// Rotation-mode's own tracking — ruleKey -> {index, lastAdvance}. Needs
// both a POSITION (which target of the list is currently showing) and a
// timestamp, so it can't share either _scheduleFiredToday's or
// _intervalRuleLastFired's shape — this is genuinely a different kind of
// state, not just a different key format for the same kind. Same
// self-bounding property as the others: each key's value is overwritten
// in place, never accumulated.
const _rotationState = {};
// Converts an interval rule's {intervalValue, intervalUnit} into
// milliseconds. Returns 0 (falsy) for anything malformed, so callers can
// treat a bad/missing config as "never due" with a single falsy check
// rather than needing their own separate validation.
function intervalToMs(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const perUnit = { seconds: 1000, minutes: 60_000, hours: 3_600_000 };
  return n * (perUnit[unit] || perUnit.minutes);
}

// Checked on a periodic interval (see its own setup near init()). By
// explicit request, fires a time-mode rule only on an EXACT match against
// the current minute — not "at or after, as long as it hasn't fired yet
// today" the way this originally worked. A page that's backgrounded,
// mid-edit, or just slow to poll during the scheduled moment now simply
// misses that firing for the day entirely, rather than catching up once
// checking resumes. _scheduleFiredToday still exists to prevent re-firing
// repeatedly within that same matching minute (this check runs every 5s,
// so one minute is roughly a dozen checks) — never needs explicit pruning
// either way: each rule key's value gets overwritten in place every time
// it fires, so the object's size stays bounded to "how many distinct
// rules have ever existed," not how many days have passed.
function checkSchedules() {
  // Never let a scheduled switch interrupt active editing or pop up the
  // confirmation switchToLayoutTarget() shows during Live Edit — that
  // confirmation exists for a person's own deliberate tap, not something an
  // automatic timer should ever trigger. Simplest possible guard: skip the
  // whole check while editing. By explicit request, this is no longer a
  // "catches up on the next check" delay — see the exact-match logic below
  // for both modes — so a rule whose moment falls during an editing
  // session, or during the grace period right after (below), simply
  // doesn't fire this time at all, rather than firing late once editing
  // ends.
  if (editModeActive) return;
  // Grace period after Live Edit ends specifically — a rule that became due
  // WHILE editing would otherwise fire on the very first check afterward,
  // silently (editModeActive is already false by then, so the
  // confirmation dialog inside switchToLayoutTarget() never shows).
  // Confirmed as a real, reproducible incident, not a hypothetical: a
  // diagnostic toast directly captured this exact sequence. Combined with
  // the exact-match logic below (no catch-up, by explicit request), a rule
  // whose moment falls inside this window now simply doesn't fire at all
  // this time — it's not delayed and then fired late, it's skipped, same
  // as if editing hadn't happened to be in the way at all.
  //
  // Was 2 minutes; reduced to 15 seconds by explicit request — a genuinely
  // new rotation waiting a full 2 minutes to even show its first target
  // felt like an unreasonably long, uncertain wait. 15s still gives a
  // meaningful buffer to glance at what was just configured before an
  // automatic switch could interrupt it, without the wait itself feeling
  // like something might be broken.
  const EDIT_EXIT_SCHEDULE_GRACE_MS = 15_000; // 15 seconds
  if (Date.now() - _editModeExitedAt < EDIT_EXIT_SCHEDULE_GRACE_MS) return;
  const rules = getScheduleRulesInUse();
  // By explicit request: if this screen is currently showing a
  // schedule-driven override (see _scheduleOverrideActive's own comment)
  // but no ENABLED rule remains to justify that — the whole schedule got
  // disabled, or every rule was removed outright — revert back to the
  // screen's own true, pre-defined layout. Checked before the "no rules"
  // early return below specifically so this fires whether the rules were
  // disabled OR deleted entirely, not just one of those two cases.
  if (_scheduleOverrideActive && !rules.some(r => r && r.enabled !== false)) {
    _scheduleOverrideActive = false;
    // Deliberately bypasses fetchLayout()'s own echo-suppression guard
    // (LAYOUT_ECHO_SUPPRESS_MS) — that guard exists to ignore an unwanted
    // echo of this screen's OWN still-in-flight save, which is exactly
    // backwards here: this IS the intentional, deliberate re-fetch, not
    // something to suppress.
    _lastLocalLayoutSaveAt = 0;
    fetchLayoutAndRender(currentOrientation);
    // Also re-fetches and re-applies the screen's own true display-level
    // config — found missing via direct browser testing, not assumed:
    // applyLocally() (the schedule-driven switch itself) can override
    // displayConfig.theme (and calls applyTheme() when it does), but
    // fetchLayoutAndRender() alone only ever touches widgets/layout, never
    // displayConfig. Without this, a rotation target with a different
    // theme than the screen's own assigned display would leave the theme
    // stuck on whatever the rotation last set, even after everything else
    // correctly reverted.
    fetchDisplayConfig().then(() => { try { applyTheme(); } catch {} });
    return;
  }
  if (!rules.length) return;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD, local calendar day is close enough for this purpose
  const dow = now.getDay(); // 0=Sun..6=Sat, matches daysOfWeek's own convention
  const nowMs = now.getTime();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const rule of rules) {
    // Rotation rules have no rule.target at all (targets, plural, instead)
    // — requiring it unconditionally here would silently filter out every
    // rotation rule before ever reaching its own branch below.
    if (!rule || !Array.isArray(rule.daysOfWeek) || (rule.mode !== 'rotation' && !rule.target)) continue;
    // Explicit === false, not a truthiness check — a rule saved before
    // this field existed at all has no `enabled` key, and should keep
    // firing exactly as it always did rather than being silently turned
    // off by a field that was never there to begin with. Only an
    // explicit, deliberate uncheck should ever skip a rule.
    if (rule.enabled === false) continue;
    if (!rule.daysOfWeek.includes(dow)) continue;
    const key = scheduleRuleKey(rule);
    if (rule.mode === 'rotation') {
      // Genuinely even rotation, by explicit request — the actual reason
      // this mode exists at all. Several independent same-interval rules
      // can never give even spacing: each one is "due" the instant the
      // interval elapses since IT last fired, so when two are due at the
      // same moment they cascade through a few seconds apart (one switch
      // per check) rather than each getting a clean, equal share of time.
      // A single rotation rule sidesteps this entirely — there's only ONE
      // clock (lastAdvance below), so nothing competes with itself.
      if (!Array.isArray(rule.targets) || rule.targets.length < 2) continue; // need 2+ to rotate between
      const intervalMs = intervalToMs(rule.intervalValue, rule.intervalUnit);
      if (!intervalMs) continue;
      let state = _rotationState[key];
      if (!state) {
        // First time this rotation is seen — start at index 0 immediately
        // rather than seeding-and-waiting the way a single-target interval
        // rule does (see that branch's own comment). A rotation has no
        // natural "ambient" starting point the way a single scheduled
        // switch does; whatever happened to already be showing before the
        // rotation began isn't necessarily even one of its targets. Show
        // target[0] right away to establish a clear, immediate start, then
        // advance every full interval from there.
        state = { index: 0, lastAdvance: nowMs };
        _rotationState[key] = state;
        switchToLayoutTarget(rule.targets[0], 'schedule-engine');
        break;
      }
      if (nowMs - state.lastAdvance < intervalMs) continue;
      state.index = (state.index + 1) % rule.targets.length;
      state.lastAdvance = nowMs;
      switchToLayoutTarget(rule.targets[state.index], 'schedule-engine');
      break; // one switch per check is enough — if two rules are somehow due
             // at once, the next check (moments later) picks up the other
    }
    if (rule.mode === 'interval') {
      // No catch-up, by explicit request: fires only once a FULL interval
      // has genuinely elapsed since it last actually fired — never
      // immediately just because it's "been a while," including the very
      // first time a rule is ever seen. A brand new rule (or a fresh page
      // load, which starts with no memory of past firings at all) used to
      // treat "never fired" as an effective lastFired of 0 (the epoch),
      // meaning nowMs - 0 was always enormous — so it fired instantly on
      // sight rather than waiting out its own interval even once. Now
      // seeds its own baseline the first time it's seen instead, and
      // simply waits from there, same as it would for every fire after.
      const intervalMs = intervalToMs(rule.intervalValue, rule.intervalUnit);
      if (!intervalMs) continue; // malformed/missing config — never due
      if (_intervalRuleLastFired[key] === undefined) { _intervalRuleLastFired[key] = nowMs; continue; }
      if (nowMs - _intervalRuleLastFired[key] < intervalMs) continue;
      _intervalRuleLastFired[key] = nowMs;
      switchToLayoutTarget(rule.target, 'schedule-engine');
      break; // one switch per check is enough — if two rules are somehow due
             // at once, the next check (moments later) picks up the other
    }
    if (!rule.time) continue;
    // No catch-up here either, by the same explicit request — an EXACT
    // match against the current minute, not "at or after," so a rule
    // whose moment has already passed today simply doesn't fire again
    // until it's next scheduled (tomorrow, if this is a daily rule) rather
    // than firing late the moment something happens to check again. Still
    // needs the _scheduleFiredToday guard below — this check itself runs
    // every 5s, so the same matching minute would otherwise match roughly
    // a dozen times over before it rolls over.
    if (rule.time !== hhmm) continue;
    if (_scheduleFiredToday[key] === todayStr) continue; // already fired this exact minute
    _scheduleFiredToday[key] = todayStr;
    switchToLayoutTarget(rule.target, 'schedule-engine');
    break; // one switch per check is enough — if two rules are somehow due
           // at once, the next check (moments later) picks up the other
  }
}

async function prefetchSwitcherPresets() {
  const targets = getSwitcherTargetsInUse();
  if (!targets.length) return; // nothing configured anywhere on this screen — skip entirely, no wasted work
  let namesFreshlyLoaded = false;
  try {
    if (!state._switcherNamesCache && targets.some(t => t.type === 'saved')) {
      const r = await fetch('/api/saved-layouts');
      if (r.ok) { state._switcherNamesCache = await r.json(); namesFreshlyLoaded = true; }
    }
    if (!state._switcherDisplayNamesCache && (targets.some(t => t.type === 'display') || ALLOW_EDIT_IN_PREVIEW)) {
      const r = await fetch('/api/displays');
      if (r.ok) { state._switcherDisplayNamesCache = await r.json(); namesFreshlyLoaded = true; }
    }
  } catch {}
  const now = Date.now();
  await Promise.allSettled(targets.map(async (target) => {
    const key = switcherTargetKey(target);
    const cached = state._switcherPresetCache[key];
    if (cached && (now - cached.fetchedAt) < SWITCHER_CACHE_TTL_MS) return;
    try {
      const url = target.type === 'display'
        ? `/api/displays/${encodeURIComponent(target.id)}/full`
        : `/api/saved-layouts/${target.id}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const preset = await r.json();
      state._switcherPresetCache[key] = { ...preset, fetchedAt: now };
    } catch {}
  }));
  // Names weren't available yet on the very first render after boot, so any
  // switcher button (widget or floating) currently on screen would still be
  // showing its generic fallback label — re-render both surfaces now that
  // real names are in. A no-op re-render on every OTHER call (names are
  // cached after the first successful fetch, so this branch only fires
  // once per boot per name-source actually in use).
  if (namesFreshlyLoaded) {
    renderFloatingSwitcher();
    if ((state.layout || []).some(w => w.type === 'layoutswitcher')) renderLayout();
  }
  // Warm the data every possible target's widgets could need. Gated
  // behind its own TTL, same as the per-target fetches above — this whole
  // function is called every 20s via resolveAssignedProfile()'s existing
  // interval (see its own comment: "Fast profile-assignment poll"), so
  // calling all 14 of fetchAllWidgetDataSet()'s fetches unconditionally on
  // every invocation would run them 15x more often than the intended
  // 5-minute warming cadence, not free even though most are cheap.
  if ((now - _switcherDataWarmedAt) >= SWITCHER_CACHE_TTL_MS) {
    _switcherDataWarmedAt = now;
    await fetchAllWidgetDataSet();
  }
}

// The actual switch. target is {type, id} — callers own normalization via
// normalizeSwitcherTargets() before this is ever invoked (button data
// attributes carry both fields separately, see wireLayoutSwitcherTaps() and
// renderFloatingSwitcher()). callerTag identifies which of the known call
// sites triggered this (used below to scope the preview-toast to not the
// schedule engine specifically) — was also a diagnostic toast at one point,
// removed once it had done its job (correctly identified schedule-engine
// as the actual cause across several reports) and would otherwise have
// kept firing repeatedly during interval-based rotation.
async function switchToLayoutTarget(target, callerTag) {
  // Switching is a REAL, immediately-persisted action, not a preview — see
  // this function's own comment further down for why (pre-fetch cache +
  // optimistic local swap, by design). That's exactly right for the normal
  // kiosk case (someone walks up and taps a button, expects it to just
  // work, no friction) but is genuinely dangerous during Live Edit: testing
  // a switcher button while actively editing silently replaces the layout
  // being edited — including anything just added that isn't part of the
  // target — with no warning and no undo. Confirmed as a real incident, not
  // a hypothetical: testing a freshly-added switcher widget's buttons in
  // Live Edit permanently discarded it, because the target tapped during
  // testing didn't itself contain that widget. Gated on editModeActive
  // specifically so the real kiosk experience stays completely
  // frictionless — this only fires while actively editing.
  if (editModeActive) {
    const ok = confirm('Switching now will REPLACE the current layout — including anything not yet saved elsewhere — with the target layout. This can\'t be undone. Continue?');
    if (!ok) return;
  }
  const key = switcherTargetKey(target);
  const cached = state._switcherPresetCache[key];
  const applyLocally = (preset) => {
    const widgetsKey = currentOrientation === 'portrait' ? 'widgets_portrait' : 'widgets_landscape';
    state.layout = preset[widgetsKey] || [];
    if (preset.theme !== undefined) { displayConfig.theme = preset.theme || ''; applyTheme(); }
    // Suppresses the echo of our OWN persist call below (see
    // _lastLocalLayoutSaveAt's own comment near saveLayoutNow()) — without
    // this, the SSE 'layout' broadcast the apply endpoint triggers would
    // come right back to this same screen and redundantly re-fetch+re-render
    // data we already just applied.
    _lastLocalLayoutSaveAt = Date.now();
    renderLayout();
    applyBackground();
    // Re-fetch widget data for whatever's genuinely NEW in this layout —
    // confirmed as a real report, not a hypothetical: stocks/news/sports
    // specifically got stuck on "Loading..." after a rotation switch and
    // never recovered, since several widget types (stocks, air quality,
    // travel times, tasks, chores, stickers, sports, METAR, on-this-day,
    // daily quote, HA entities) each check state.layout themselves and
    // skip any real fetch entirely when their own widget type isn't
    // currently present — correct on its own, but it meant a widget type
    // that only appears via a SWITCH, never having been in the layout
    // loaded at boot, was never fetched at all.
    //
    // Tracks every widget type EVER seen this whole session (not just the
    // immediately preceding layout) plus a time throttle on the batch
    // itself — found necessary from a second report of the exact same
    // symptom recurring. An earlier version of this fix compared only
    // against the single previous layout, but "skip when the widget type
    // is absent" (each fetch function's own guard) is not the same thing
    // as "skip when the widget type isn't new" — a rotation alternating
    // between displays with genuinely different widget sets would still
    // have a type disappear and reappear on every other switch, re-firing
    // this whole 14-call batch every time even though nothing was
    // actually new to the session. Now a type only counts as new the
    // FIRST time it's ever seen at all; after that, the 30s throttle on
    // the whole batch is the only thing that can still trigger a
    // re-fetch, which is intentional — it's a safety net for genuinely
    // stale data on a slow rotation, not something a fast one should ever
    // hit. Weather/events/reminders/photos still aren't included here
    // since those fetch unconditionally regardless of the layout either
    // way (see fetchWeather()'s own comment) — nothing to fix there.
    if (!state._everSeenWidgetTypes) state._everSeenWidgetTypes = new Set();
    const currentTypes = new Set(state.layout.map(w => w.type));
    const hasGenuinelyNewType = [...currentTypes].some(t => !state._everSeenWidgetTypes.has(t));
    currentTypes.forEach(t => state._everSeenWidgetTypes.add(t));
    const WIDGET_REFETCH_THROTTLE_MS = 30_000;
    const throttleElapsed = !state._lastWidgetDataRefetchAt || (Date.now() - state._lastWidgetDataRefetchAt >= WIDGET_REFETCH_THROTTLE_MS);
    if (hasGenuinelyNewType || throttleElapsed) {
      state._lastWidgetDataRefetchAt = Date.now();
      (async () => {
        await Promise.allSettled([
          fetchTasksForLayout(), fetchTodoForLayout(), fetchShoppingListForLayout(),
          fetchNews(), fetchStocks(), fetchChoreChart(), fetchStickersForLayout(),
          fetchAirQuality(), fetchTravelTimes(), fetchOnThisDay(), fetchDailyQuote(),
          fetchSports(), fetchMetarTaf(), fetchHaEntities(),
        ]);
        renderLayout();
      })();
    }
  };

  if (cached) {
    applyLocally(cached);
  } else {
    // Not pre-fetched yet (e.g. tapped right after boot, before the first
    // background pre-fetch completed) — fall back to fetching it live. Still
    // correct, just not instant this one time.
    showDisplayToast('Switching layout…');
    try {
      const url = target.type === 'display'
        ? `/api/displays/${encodeURIComponent(target.id)}/full`
        : `/api/saved-layouts/${target.id}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('fetch failed');
      const preset = await r.json();
      state._switcherPresetCache[key] = { ...preset, fetchedAt: Date.now() };
      applyLocally(preset);
    } catch {
      showDisplayToast('❌ Could not switch layouts — check the connection.');
      return;
    }
  }

  // Persist server-side in the background — this is what makes the switch
  // survive a refresh/reboot and shows up on other screens/the app. The
  // visible switch above already happened; this is fire-and-forget from the
  // person's point of view.
  //
  // NEVER persist in the "Open to Edit in New Tab" context — this is the
  // actual root cause of a whole series of reports that looked like several
  // different bugs (destination-resolution fallbacks, schedule timing) but
  // were really one design mismatch. Persisting a switch means "copy the
  // target's content onto DISPLAY_SLUG" — exactly right on a real kiosk,
  // where DISPLAY_SLUG is THIS SCREEN's own disposable profile that's
  // MEANT to become a copy of whatever it switches to. But in this preview
  // context, DISPLAY_SLUG is a real, named, shared display (whatever was
  // opened to edit) — applyLocally() above never changes DISPLAY_SLUG when
  // switching, so persisting here means literally overwriting that real,
  // named display's actual content with the target's. Confirmed directly
  // against the code, not inferred: this is exactly what {display:
  // DISPLAY_SLUG} sent to the apply endpoints does. The local, visual
  // switch above still gives a genuine preview of what the target looks
  // like; it just can never be allowed to save over the display actually
  // being edited.
  //
  // Checks IS_PREVIEW, not just ALLOW_EDIT_IN_PREVIEW — the small, embedded
  // thumbnail preview elsewhere in the app is EQUALLY a real, named display
  // being previewed, not a screen's own disposable profile, and isn't
  // reliably distinguishable from "Open to Edit in New Tab" by
  // ALLOW_EDIT_IN_PREVIEW alone (both currently carry allowEdit=1 in their
  // URL — see EMBEDDED_THUMBNAIL's own comment for the real bug behind
  // that). IS_PREVIEW is true for both regardless, so this check was
  // already correct without needing to know that distinction at all — it
  // only needs "is this ANY kind of preview," which IS_PREVIEW answers
  // directly.
  //
  // ALSO never persists for the schedule engine specifically, regardless
  // of preview status — a second, separate reason to skip, found from a
  // real, serious incident: on a REAL, assigned screen (IS_PREVIEW=false,
  // not a preview context at all), a rotation's persist step still sends
  // {display: DISPLAY_SLUG} to the apply endpoint, meaning every single
  // advance permanently copies the new target's content onto whatever
  // display this screen currently happens to be assigned to. That's
  // completely fine if DISPLAY_SLUG really is a disposable, per-screen
  // profile with nothing worth keeping — but if it's a real, named,
  // deliberately-crafted display (which it very much can be, and was in
  // the reported case), a rotation running for any length of time
  // destroys that display's own saved content on every single advance,
  // whether or not that display is even one of the rotation's own
  // targets. A schedule's entire purpose is to keep CYCLING what's shown,
  // never to permanently reassign the underlying display data — the local,
  // visual switch above already gives the intended cycling effect on its
  // own; persisting on top of that was never something schedule-driven
  // switching needed to do correctly, only something it happened to
  // inherit from the exact same persist step a manual button tap uses.
  if (IS_PREVIEW || callerTag === 'schedule-engine') {
    // Marks that this screen is currently showing a schedule-driven
    // override rather than its own true, pre-defined layout — checked by
    // checkSchedules()'s own revert logic (see its own comment) so that
    // disabling the schedule that put it there can bring it back. Set
    // regardless of IS_PREVIEW — "Open to Edit in New Tab" has a real,
    // named display of its own to revert to just the same as a real
    // screen does, so this should work identically in both contexts.
    if (callerTag === 'schedule-engine') _scheduleOverrideActive = true;
    // The toast itself is scoped to NOT the schedule engine — the actual
    // protection (never persisting) below applies unconditionally
    // regardless of caller, this only decides whether to say something
    // about it. A manual button tap benefits from the confirmation (a
    // person testing switcher buttons in "Open to Edit in New Tab" may
    // genuinely wonder whether that just saved); a repeating automatic
    // rotation firing every few seconds does not — showing the same toast
    // on every single automatic switch is disruptive rather than
    // informative, confirmed as a real complaint, not a hypothetical.
    if (callerTag !== 'schedule-engine') {
      showDisplayToast('👁️ Previewing — not saved (editing a real display here, not a screen).');
    }
    return;
  }
  // A manual, PERSISTING switch reaching this point becomes the new, real,
  // saved layout — the "pre-defined layout" itself has just changed to
  // this, so any pending schedule-driven override is no longer meaningful
  // to revert to something that no longer represents the true, current
  // assignment.
  _scheduleOverrideActive = false;

  if (target.type === 'display') {
    // Pointer-based reassignment, NOT a content copy — reuses the exact
    // mechanism Screens management already uses (assigned_display_slug),
    // instead of the copy-based apply endpoint below. This is the actual
    // fix for "toggling between Calendar and Chores destroys the other
    // one": switching between two real, named, live displays now just
    // changes which one this screen POINTS AT. Neither display's own
    // content is ever touched, so flipping back and forth is genuinely
    // safe no matter how many times it happens.
    //
    // Deliberately does NOT check DISPLAY_SLUG first (unlike the
    // template-copy path below) — a pointer reassignment only needs
    // SCREEN_ID, this device's own stable identity, which is always
    // available. That also means a screen with no display assigned yet
    // (DISPLAY_SLUG === '') can now safely become assigned via a switcher
    // tap — something the old copy-based path could never do safely (see
    // beta.28's own incident, where an empty/unresolved slug silently
    // landing on the wrong destination was exactly the danger).
    //
    // selfInitiated:true skips the server's own push-a-reload-command-back
    // step — this screen already applied the switch instantly and
    // locally (applyLocally() above), so that push would only cause a
    // redundant, visible reload of content already showing correctly.
    try {
      await fetch(`/api/screens/${encodeURIComponent(SCREEN_ID)}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display: target.id, selfInitiated: true }),
      });
    } catch {
      showDisplayToast('⚠️ Switched, but couldn\'t save — it may revert on refresh.');
    }
    return;
  }

  // Saved-layout (template) targets stay copy-based, unchanged — a
  // template is a reusable stencil meant to stamp out independent copies,
  // not something a screen can "point at" the way a live display is, so
  // there's no pointer-reassignment equivalent that makes sense here.
  // Never send this without an explicit DISPLAY_SLUG — the server now
  // rejects it too (see both apply endpoints' own comments for the real
  // incident this guards against), but catching it here first avoids a
  // doomed request and an unclear error.
  if (!DISPLAY_SLUG) {
    showDisplayToast('⚠️ Switched, but couldn\'t save — no display selected.');
    return;
  }
  try {
    await fetch(`/api/saved-layouts/${target.id}/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'current', display: DISPLAY_SLUG }),
    });
  } catch {
    showDisplayToast('⚠️ Switched, but couldn\'t save — it may revert on refresh.');
  }
}

async function fetchLayoutAndRender(orientation) {
  await fetchLayout(orientation);
  if (displayConfig.ambientMode && typeof window.setAmbientMode === 'function') {
    window.setAmbientMode(displayConfig.ambientMode);
  } else {
    renderLayout();
  }
}

async function resolveAssignedProfile() {
  // Always fetch screen-config (even with a URL override) so we learn the
  // info-overlay corner for this screen; only the profile is skipped on override.
  try {
    // First, learn this Pi's canonical id (server-persisted) and adopt it BEFORE we
    // register, so we never create a duplicate "new screen" from a stale localStorage id.
    // On a SLAVE, this same call also returns the host-assigned slug by the server's
    // own identity — independent of any browser/localStorage id — which is the reliable
    // path for host-controlled profile switching.
    let canonicalId = null, selfSlug = null, isSlaveRole = false;
    try {
      const pre = await fetch('/api/screen-config');
      if (pre.ok) {
        const c = await pre.json();
        canonicalId = c.canonicalId || null;
        if (c.role === 'slave') { isSlaveRole = true; selfSlug = c.assigned_display_slug || ''; }
      }
    } catch {}
    isSlaveDevice = isSlaveRole;
    if (canonicalId) adoptCanonicalScreenId(canonicalId);

    // On a slave, trust the server's self-resolved slug and apply it directly.
    if (isSlaveRole && !URL_DISPLAY_SLUG) {
      if ((selfSlug || '') !== (DISPLAY_SLUG || '')) {
        DISPLAY_SLUG = selfSlug || '';
        try { await fetchLayoutAndRender(getOrientation()); } catch {}
      }
    }

    const r = await fetch(`/api/screen-config?screen=${encodeURIComponent(SCREEN_ID)}`);
    if (r.ok) {
      const cfg = await r.json();
      // On a SLAVE, the profile is decided by the host (resolved above from the
      // server's own identity). Do NOT let this id-based response override it — its
      // assigned_display_slug reflects the slave's LOCAL screens-table row, which is
      // not the source of truth and would clobber the host's assignment.
      if (!URL_DISPLAY_SLUG && !isSlaveRole) {
        const newSlug = cfg.assigned_display_slug || '';
        if (newSlug !== (DISPLAY_SLUG || '')) {
          // Profile reassigned (locally, on a host's own screen). Adopt + reload.
          DISPLAY_SLUG = newSlug;
          try { await fetchLayoutAndRender(getOrientation()); } catch {}
        }
      }
      state.reachable = cfg.addresses || null;
      state.reachablePort = cfg.port || 3000;
      state.displayRes = cfg.displayRes || null; // real TV resolution, for accurate previews
      noteConfiguredInfoCorner(cfg.info_corner || '');
      state.floatingSwitcherEnabled = !!cfg.floating_switcher_enabled;
      state.floatingSwitcherPresets = cfg.floating_switcher_presets || [];
      state.floatingSwitcherSchedule = cfg.floating_switcher_schedule || [];
      state.floatingSwitcherEdge = cfg.floating_switcher_edge || 'bottom';
      state.floatingSwitcherIcon = cfg.floating_switcher_icon || '🔀';
      state.floatingSwitcherColor = cfg.floating_switcher_color || '#0a0e1a';
      state.floatingSwitcherStyle = cfg.floating_switcher_style || 'circles';
      state.floatingSwitcherBarMode = cfg.floating_switcher_bar_mode || 'icons';
      state.floatingSwitcherReveal = cfg.floating_switcher_reveal || 'always';
      state.editBarPosition = cfg.edit_bar_position || 'top';
      state.alertBannerPosition = cfg.alert_banner_position || 'top';
      state.alertBannerSize = cfg.alert_banner_size || 'm';
      state.alertBannerStyle = cfg.alert_banner_style || 'solid';
      applyAlertBannerConfig();
      renderFloatingSwitcher();
      prefetchSwitcherPresets().catch(() => {});
    }
  } catch { /* keep default on failure */ }
}

// Shows/hides the per-Pi control-URL overlay in the chosen corner. It shows the
// address other devices can actually use to reach THIS Pi — the LAN IP, plus the
// Tailscale address if the Pi is on a tailnet — rather than "localhost" (which the
// kiosk browser loads from and which would be useless to a phone).
function applyInfoOverlay(corner) {
  const el = document.getElementById('info-overlay');
  if (!el) return;
  el.classList.remove('corner-tl','corner-tr','corner-bl','corner-br');
  if (!corner) { el.style.display = 'none'; return; }
  const port = state.reachablePort || window.location.port || '3000';
  const r = state.reachable || {};
  // Prefer the LAN IP as the primary line; fall back to the loaded host only if we
  // somehow have no detected address.
  const primary = r.lan || (window.location.hostname && window.location.hostname !== 'localhost' ? window.location.hostname : null);
  // Small QR code next to each URL — same qrcodejs library and .qr-container
  // convention the QR widget itself uses, so renderQRCodes() (already called
  // after every layout render) picks these up automatically without needing
  // a separate code path. Kept small (56px) since this is a corner overlay,
  // not a widget — big enough to scan from a few feet away, not so big it
  // dominates the corner.
  let qrIndex = 0;
  const qrTag = (content) => {
    qrIndex++;
    return `<div class="qr-container io-qr" id="qr-c-io-${qrIndex}" data-content="${content.replace(/"/g, '&quot;')}" data-size="56"></div>`;
  };
  const lines = [];
  if (primary) {
    const url = `http://${primary}:${port}/app`;
    lines.push(`<div class="io-url-row"><div class="io-url">${url}</div>${qrTag(url)}</div>`);
  }
  if (r.tailscale) {
    const url = `http://${r.tailscale}:${port}/app`;
    lines.push(`<div class="io-url-row"><div class="io-url io-url-2">${url} <span class="io-tag">remote</span></div>${qrTag(url)}</div>`);
  }
  if (!lines.length) lines.push(`<div class="io-url">http://&lt;this-pi-ip&gt;:${port}/app</div>`);
  const screenName = (state.screenName || '').trim();
  el.innerHTML = `<div class="io-label">Control this screen at</div>
    ${lines.join('')}
    ${screenName ? `<div class="io-name">${screenName}</div>` : ''}`;
  el.classList.add('corner-' + corner);
  el.style.display = 'block';
  requestAnimationFrame(renderQRCodes);
}

// Screen-level floating Layout Switcher — an always-present button overlaid
// on top of whatever layout is currently active, independent of any
// per-layout Layout Switcher widget. Exists specifically so switching TO a
// saved layout that has no switcher widget of its own never becomes a dead
// end (see the widget's own comment for the full design reasoning). Calls
// the exact same switchToLayoutTarget() the widget uses — this function
// only handles showing/hiding/building the floating button itself.
// Positions the switcher for the chosen edge and style. 'circles' (the
// original default) keeps its exact prior behavior — a compact cluster
// centered along the edge with a fixed offset, never spanning it — see the
// comment on that branch below for why. 'bar' spans the FULL edge instead,
// flush against it — left-aligned within the strip on top/bottom, but
// CENTERED on left/right (see that branch's own comment for why these two
// differ: a real, reported overlap with the top-left "Back to App" link,
// found only after the mockup-approved left-aligned version had already
// shipped, not part of the original design itself). Also manages an
// fls-edge-* class on the element (not just inline styles) — the bar+names
// rotation rules in CSS need to target a specific edge, which inline
// styles alone can't express as a selector.
function applyFloatingSwitcherPosition(el, edge, style) {
  el.style.top = el.style.bottom = el.style.left = el.style.right = el.style.transform = el.style.justifyContent = '';
  el.classList.remove('fls-edge-top', 'fls-edge-bottom', 'fls-edge-left', 'fls-edge-right');
  el.classList.add('fls-edge-' + (edge || 'bottom'));
  el.style.flexDirection = (edge === 'left' || edge === 'right') ? 'column' : 'row';
  el.style.alignItems = 'center';
  if (style === 'bar') {
    // All four edges centered — by explicit request, for consistency with
    // Circles style, which was already centered on every edge. Left/right
    // being centered (not top-aligned) also avoids a real, previously
    // reported overlap: the top-left "Back to App" link (see its own
    // markup comment) sits exactly where a top-aligned left/right bar's
    // first button would land, silently covering it and making it
    // untappable.
    el.style.justifyContent = 'center';
    if (edge === 'top') { el.style.top = '0'; el.style.left = '0'; el.style.right = '0'; }
    else if (edge === 'left') { el.style.left = '0'; el.style.top = '0'; el.style.bottom = '0'; }
    else if (edge === 'right') { el.style.right = '0'; el.style.top = '0'; el.style.bottom = '0'; }
    else { el.style.bottom = '0'; el.style.left = '0'; el.style.right = '0'; } // default: bottom
    return;
  }
  // circles — every target renders as its own always-visible icon button —
  // no collapse/expand step (a tap-to-reveal FAB was the actual complaint
  // this replaced: the person wanted to see every option at a glance and
  // switch in one tap, not hide them behind an icon first). Direction is
  // simply row for a horizontal edge (top/bottom) or column for a vertical
  // one (left/right) — no "reverse" needed the way the old FAB version
  // required, since every button is now equal; there's no longer a single
  // special element that has to stay nearest the edge while others unfold
  // away from it.
  const OFFSET = '20px';
  if (edge === 'top') { el.style.top = OFFSET; el.style.left = '50%'; el.style.transform = 'translateX(-50%)'; }
  else if (edge === 'left') { el.style.left = OFFSET; el.style.top = '50%'; el.style.transform = 'translateY(-50%)'; }
  else if (edge === 'right') { el.style.right = OFFSET; el.style.top = '50%'; el.style.transform = 'translateY(-50%)'; }
  else { el.style.bottom = OFFSET; el.style.left = '50%'; el.style.transform = 'translateX(-50%)'; } // default: bottom
}
// Builds one switcher button's HTML — shared by both the regular targets
// loop and the original-display special case below, so the two can never
// drift out of sync with each other on markup/attributes. Handles both
// styles: circles keeps the exact prior structure (glyph as the button's
// only content, background set per-button); bar wraps an icon face and a
// name face in the same button (CSS shows/hides the right one for the
// current mode), no per-button background — bar style colors the
// container itself, not individual buttons, matching the approved mockup.
function buildSwitcherButtonHtml(t, style, color) {
  const label = switcherTargetLabel(t);
  const glyph = t.icon || label.trim().charAt(0).toUpperCase() || '•';
  const idAttr = `data-target-type="${t.type}" data-target-id="${escapeHtmlD(String(t.id))}"`;
  const a11y = `aria-label="${escapeHtmlD(label)}" title="${escapeHtmlD(label)}"`;
  if (style === 'bar') {
    return `<button type="button" class="fls-bar-btn" ${idAttr} ${a11y}><span class="icon-face">${escapeHtmlD(glyph)}</span><span class="name-face">${escapeHtmlD(label)}</span></button>`;
  }
  return `<button type="button" class="fls-btn" ${idAttr} ${a11y} style="background:${escapeHtmlD(color)}">${escapeHtmlD(glyph)}</button>`;
}
function renderFloatingSwitcher() {
  const el = document.getElementById('floating-switcher');
  if (!el) return;
  const targets = normalizeSwitcherTargets(state.floatingSwitcherPresets);
  if (!state.floatingSwitcherEnabled || !targets.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const color = state.floatingSwitcherColor || '#0a0e1a';
  const style = state.floatingSwitcherStyle === 'bar' ? 'bar' : 'circles';
  const barMode = state.floatingSwitcherBarMode === 'names' ? 'names' : 'icons';
  const revealTap = state.floatingSwitcherReveal === 'tap';
  // Falls back to the target's own initial (first letter of its name) if
  // nobody's picked an icon for it yet — always shows SOMETHING recognizable
  // rather than a blank or generic placeholder button.
  let buttons = targets.map(t => buildSwitcherButtonHtml(t, style, color)).join('');
  // Original display, offered as an ordinary switch option — ONLY in the
  // "Open to Edit in New Tab" context. Real reason this exists: the target
  // checklist deliberately excludes "the display you're currently on" from
  // its own addable options (adding aviation as a target while ON aviation
  // is meaningless) — but since switching here is preview-only and
  // DISPLAY_SLUG never actually changes (see switchToLayoutTarget's own
  // ALLOW_EDIT_IN_PREVIEW branch), that exclusion permanently locks out the
  // ORIGINAL display too, even after previewing away from it — there was
  // no way back at all before this. Deliberately built via the exact same
  // buttonhtml helper as every other target — no distinct "back" icon or
  // visual treatment, rather than standing out as a special control.
  // Targets DISPLAY_SLUG itself as a completely ordinary {type:'display'}
  // target — the exact same fetch/cache/apply machinery every other button
  // already uses, no special-case logic needed, since the original display
  // IS just a valid switch target that happens to already be the one in
  // view. Always shown (not just after a switch) since re-applying it
  // while already on it is a harmless no-op, and a consistent, always-there
  // option is simpler to rely on than one that appears and disappears.
  if (ALLOW_EDIT_IN_PREVIEW && DISPLAY_SLUG) {
    buttons = buildSwitcherButtonHtml({ type: 'display', id: DISPLAY_SLUG }, style, color) + buttons;
  }
  el.innerHTML = buttons;
  // Preserves .shown across this reassignment — el.className replaces
  // every class at once, and without this, a re-render that happens to
  // land while the switcher is currently visible from a recent tap (an
  // unrelated SSE update, say) would abruptly hide it early instead of
  // letting the existing 4-second window finish naturally.
  const wasShown = el.classList.contains('shown');
  el.className = 'fls-style-' + style + (style === 'bar' ? ' fls-mode-' + barMode : '') + (revealTap ? ' fls-reveal-tap' : '') + (wasShown ? ' shown' : '');
  // Bar style colors the container (the visible strip) rather than each
  // button — circles colors each button instead, and the container stays
  // fully transparent, so this only ever applies for bar.
  el.style.background = style === 'bar' ? color : '';
  applyFloatingSwitcherPosition(el, state.floatingSwitcherEdge || 'bottom', style);
  // 'flex', not 'block' — #floating-switcher's own stylesheet rule
  // declares display:flex (needed for align-items/flex-direction on its
  // children to mean anything at all); setting the inline style to
  // 'block' silently overrode that every time this ran, since an inline
  // style always wins over a stylesheet rule regardless of specificity.
  el.style.display = 'flex';
  el.querySelectorAll('.fls-btn[data-target-id], .fls-bar-btn[data-target-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.targetType;
      const id = type === 'display' ? btn.dataset.targetId : Number(btn.dataset.targetId);
      switchToLayoutTarget({ type, id }, 'floating-switcher-button-tap');
    });
  });
}

// Wraps applyInfoOverlay() with a one-time "show it automatically right after
// boot, even if nobody's configured a persistent corner" behavior — so a fresh
// Pi is discoverable without anyone already knowing to go find the Info Corner
// setting first. Only fires once per page load: resolveAssignedProfile() (the
// caller) runs repeatedly for the display's whole lifetime — on every periodic
// re-check, on live-update pushes, on reconnect-after-network-loss — and this
// must NOT re-trigger the temporary overlay on every one of those, only the
// very first time. If a persistent corner IS configured (from the start, or
// configured live while the boot overlay happens to be showing), this defers
// to it entirely — no extra auto-hide fights the user's actual choice.
let _configuredInfoCorner = '';
let _bootOverlayTimerSet = false;
const BOOT_OVERLAY_MS = 45000; // 45s — long enough to read and act on, not so long it lingers
function noteConfiguredInfoCorner(corner) {
  _configuredInfoCorner = corner || '';
  applyInfoOverlay(_configuredInfoCorner);
  if (!_configuredInfoCorner && !_bootOverlayTimerSet) {
    _bootOverlayTimerSet = true;
    applyInfoOverlay('br');
    setTimeout(() => {
      // Only auto-hide if nobody configured a persistent corner in the meantime
      // (checked fresh here, not a stale value from when the timer was set).
      if (!_configuredInfoCorner) applyInfoOverlay('');
    }, BOOT_OVERLAY_MS);
  }
}

// Shows a small corner notice when a trial license is within 14 days of its
// access_through date (or already past it) — reads the local cache that
// periodicUpdateCheck() on the server side refreshes every 6 hours. Dismissible
// for the rest of the current day only, via localStorage — reappears the next
// day rather than being gone for good on one tap, since the point is a series
// of gentle reminders as the actual deadline approaches, not a one-time notice.
//
// Also covers the SEPARATE post-expiry grace period (days 0-7 after
// no_license_since — a real license lapsing, or never having had one at
// all) with escalating urgency: friendly and dismissible for the first
// several days, then firmer and no longer dismissible as day 7 (the hard
// block — see checkLicenseBlock()) actually approaches. The always-
// dismissible, link-included version of this same idea lives separately
// as the in-app banner (checkLicenseGraceBanner() in app.html) instead.
function checkTrialNotice() {
  const el = document.getElementById('trial-notice');
  if (!el) return;
  const status = state.settings.license_status_cache;
  const until = state.settings.trial_until_cache;
  const noLicenseSince = Number(state.settings.no_license_since) || 0;

  // Before expiry: an active trial with a real, future end date.
  if (status === 'trial' && until) {
    const now = new Date();
    const untilDate = new Date(until + 'T00:00:00');
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysLeft = Math.round((untilDate - todayMidnight) / 86_400_000);
    if (daysLeft > 0 && daysLeft <= 14) {
      const today = now.toISOString().slice(0, 10);
      if (localStorage.getItem('trial_notice_dismissed_on') === today) { el.style.display = 'none'; return; }
      el.innerHTML = `
        <div class="tn-text"><div class="tn-title">Piazza HQ</div>Your license key expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Visit piazzahq.com to renew it.</div>
        <div class="tn-close" onclick="dismissTrialNotice()">✕</div>`;
      el.style.display = 'flex';
      return;
    }
  }

  // After: the 7-day grace period once genuinely license-less (expired,
  // canceled, past_due, or never had one at all). Friendly and dismissible
  // for the first several days, then firmer and no longer dismissible as
  // day 7 (the hard block — see checkLicenseBlock()) actually approaches —
  // the deliberately always-dismissible-with-a-link version of this notice
  // now lives separately as the in-app banner (checkLicenseGraceBanner() in
  // app.html) instead of here.
  if (noLicenseSince) {
    const daysSince = Math.floor((Date.now() - noLicenseSince) / 86_400_000);
    const daysLeftInGrace = 7 - daysSince;
    if (daysLeftInGrace > 0) {
      const urgent = daysLeftInGrace <= 3; // last 3 days of the grace period
      if (!urgent) {
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem('trial_notice_dismissed_on') === today) { el.style.display = 'none'; return; }
      }
      const msg = `License needed — ${daysLeftInGrace} day${daysLeftInGrace === 1 ? '' : 's'} left. piazzahq.com`;
      el.innerHTML = urgent
        ? `<div class="tn-text"><div class="tn-title" style="color:#ff8585">Piazza HQ</div>${msg}</div>`
        : `<div class="tn-text"><div class="tn-title">Piazza HQ</div>${msg}</div>
           <div class="tn-close" onclick="dismissTrialNotice()">✕</div>`;
      el.style.display = 'flex';
      return;
    }
    // daysLeftInGrace <= 0 — grace period is over; checkLicenseBlock() takes
    // over from here with the actual full-screen block, this corner notice
    // has nothing further to add once that's showing.
  }

  el.style.display = 'none';
}
function dismissTrialNotice() {
  localStorage.setItem('trial_notice_dismissed_on', new Date().toISOString().slice(0, 10));
  document.getElementById('trial-notice').style.display = 'none';
}

// Shows a full-screen "go here to finish setup" overlay until the control
// app's first-run wizard marks setup_complete — otherwise a brand new install
// just shows an empty/default calendar with zero indication of what to do
// next. Same URL-building logic as applyInfoOverlay() above, reused for
// consistency (LAN IP preferred, falling back to whatever hostname the page
// itself loaded from if no LAN address was detected yet).
function checkSetupOverlay() {
  const el = document.getElementById('setup-needed-overlay');
  if (!el) return;
  const setupDone = !!(state.settings && state.settings.setup_complete === '1');
  if (setupDone) { el.style.display = 'none'; return; }

  const port = state.reachablePort || window.location.port || '3000';
  const r = state.reachable || {};
  const primary = r.lan || (window.location.hostname && window.location.hostname !== 'localhost' ? window.location.hostname : null);
  const urlEl = document.getElementById('setup-needed-url');
  const primaryUrl = primary ? `http://${primary}:${port}/app` : null;
  if (urlEl) urlEl.textContent = primaryUrl || 'Address not detected yet — check back in a moment';
  // QR code for the primary URL — same qrcodejs library and .qr-container
  // convention as the corner info-overlay's own QR codes (applyInfoOverlay()
  // above), so renderQRCodes() picks this up too without a separate code
  // path. Only shown once a real address is actually detected — a QR
  // encoding the placeholder "not detected yet" text would just be
  // confusing to scan.
  const qrWrap = document.getElementById('setup-needed-qr-wrap');
  const qrEl = document.getElementById('setup-needed-qr');
  if (qrWrap && qrEl) {
    if (primaryUrl) {
      qrEl.dataset.content = primaryUrl;
      qrWrap.style.display = 'flex';
    } else {
      qrWrap.style.display = 'none';
    }
  }
  // Second line: the Tailscale address, if this Pi is on a tailnet — same data
  // source as applyInfoOverlay() above, just also surfaced here so remote setup
  // (e.g. finishing setup from off-network) doesn't require already knowing
  // this address exists. A "Remote access" label sits above the URL (not an
  // inline tag after it) specifically so it can't read as part of the URL
  // itself at a glance.
  const url2Wrap = document.getElementById('setup-needed-url-2-wrap');
  const url2El = document.getElementById('setup-needed-url-2');
  const qr2Wrap = document.getElementById('setup-needed-qr-2-wrap');
  const qr2El = document.getElementById('setup-needed-qr-2');
  if (url2Wrap && url2El) {
    if (r.tailscale) {
      const remoteUrl = `http://${r.tailscale}:${port}/app`;
      url2El.textContent = remoteUrl;
      url2Wrap.style.display = 'block';
      if (qr2Wrap && qr2El) {
        qr2El.dataset.content = remoteUrl;
        qr2Wrap.style.display = 'flex';
      }
    } else {
      url2Wrap.style.display = 'none';
      if (qr2Wrap) qr2Wrap.style.display = 'none';
    }
  }
  el.style.display = 'flex';
  renderQRCodes();
}

// The actual hard block: once the 7-day grace period (tracked via
// no_license_since — see checkTrialNotice() for the escalating warnings
// leading up to this point) is over, the display stops rendering the
// normal calendar entirely until a license is entered. Modeled directly
// on checkSetupOverlay() above for the same URL/QR-building approach.
function checkLicenseBlock() {
  const el = document.getElementById('license-required-overlay');
  if (!el) return;
  const noLicenseSince = Number(state.settings.no_license_since) || 0;
  if (!noLicenseSince) { el.style.display = 'none'; return; }
  const daysSince = Math.floor((Date.now() - noLicenseSince) / 86_400_000);
  if (daysSince < 7) { el.style.display = 'none'; return; }

  const port = state.reachablePort || window.location.port || '3000';
  const r = state.reachable || {};
  const primary = r.lan || (window.location.hostname && window.location.hostname !== 'localhost' ? window.location.hostname : null);
  const urlEl = document.getElementById('license-required-url');
  const primaryUrl = primary ? `http://${primary}:${port}/app` : null;
  if (urlEl) urlEl.textContent = primaryUrl || 'Address not detected yet — check back in a moment';
  const qrWrap = document.getElementById('license-required-qr-wrap');
  const qrEl = document.getElementById('license-required-qr');
  if (qrWrap && qrEl) {
    if (primaryUrl) {
      qrEl.dataset.content = primaryUrl;
      qrWrap.style.display = 'flex';
    } else {
      qrWrap.style.display = 'none';
    }
  }
  const url2Wrap = document.getElementById('license-required-url-2-wrap');
  const url2El = document.getElementById('license-required-url-2');
  const qr2Wrap = document.getElementById('license-required-qr-2-wrap');
  const qr2El = document.getElementById('license-required-qr-2');
  if (url2Wrap && url2El) {
    if (r.tailscale) {
      const remoteUrl = `http://${r.tailscale}:${port}/app`;
      url2El.textContent = remoteUrl;
      url2Wrap.style.display = 'block';
      if (qr2Wrap && qr2El) {
        qr2El.dataset.content = remoteUrl;
        qr2Wrap.style.display = 'flex';
      }
    } else {
      url2Wrap.style.display = 'none';
      if (qr2Wrap) qr2Wrap.style.display = 'none';
    }
  }
  el.style.display = 'flex';
  renderQRCodes();
}

// Retries a fetch-and-parse a few times with a short delay before giving up.
// Added specifically because of a real, confirmed bug: a single transient
// failure of fetchDisplayConfig() at boot (plausible on resource-constrained
// hardware where the server is also doing its own heavy boot-time work) used
// to leave the display permanently stuck on default/unrotated orientation —
// nothing ever self-corrected it, since the SERVER side hadn't changed, so
// the normal live-update re-sync never fired. The workaround people found by
// accident (switching to a different layout and back) only worked because
// THAT action legitimately changes server state, re-triggering the same
// reload-config path that should have succeeded cleanly at boot in the first
// place. fetchLayout() gets the same treatment for the same reason — same
// boot-time risk profile, same "silently wrong until something else forces a
// retry" failure mode.
async function fetchWithRetry(fn, attempts = 4, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs)); }
  }
  throw lastErr;
}

async function fetchLayout(orientation) {
  // See _lastLocalLayoutSaveAt's own comment (above saveLayoutNow()) for
  // why this exists. A no-op here leaves state.layout exactly as it already
  // is, which is correct — it's newer than what this broadcast could be
  // telling us. Any real external change made in this same brief window
  // will still arrive on the next SSE broadcast or periodic poll.
  if (Date.now() - _lastLocalLayoutSaveAt < LAYOUT_ECHO_SUPPRESS_MS) return;
  await fetchWithRetry(async () => {
    const r = await fetch(withDisplayParam(`/api/layouts/${orientation}`));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const incoming = data.widgets || [];
    // Remember the last layout that loaded cleanly, per orientation, so a
    // reload mid-update can seed from it instead of showing a blank screen —
    // see init()'s own comment. Keyed on orientation only (a device shows one
    // display at a time; a stale cache from a since-reassigned profile is
    // still better than blank and is corrected by this same fetch on success).
    if (!IS_PREVIEW && incoming.length) {
      try { localStorage.setItem('phq_layout_' + orientation, JSON.stringify(incoming)); } catch {}
    }
    // Reconcile in place rather than replacing the array with brand-new
    // object literals — preserves object identity for any widget that
    // already existed, which matters because an open Live Editing "More
    // Settings" panel's event handlers close over a specific widget
    // object reference. A wholesale replacement here orphans that
    // reference the moment ANY layout save's own broadcast echoes back to
    // this same client — which happens on every save, including the one
    // that just fired from this exact panel. Any further edit made in an
    // already-open panel after that point would silently mutate the
    // orphaned object and never actually reach a save. Confirmed as the
    // real cause of a reported "calendar filter changes don't save" bug —
    // not calendar-specific; this affects every widget type's settings
    // panel the same way, toggling several checkboxes in a row (exactly
    // what a calendar filter list invites) just makes it easy to trigger.
    const existingById = new Map(state.layout.map(w => [String(w.id), w]));
    state.layout = incoming.map(w => {
      const existing = existingById.get(String(w.id));
      if (!existing) return w; // genuinely new widget — nothing to preserve
      // Mutate the SAME object in place — clear first so a field removed
      // server-side (e.g. sourceFilter reset back to null) doesn't linger
      // as a stale leftover property that was never actually cleared.
      Object.keys(existing).forEach(k => delete existing[k]);
      return Object.assign(existing, w);
    });
  });
}

// Loads this display's render config (orientation override + rotation).
async function fetchDisplayConfig() {
  try {
    await fetchWithRetry(async () => {
      const r = await fetch(withDisplayParam('/api/display-config'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cfg = await r.json();
      const _newForce = cfg.force_orientation || 'auto';
      const _newRotation = Number(cfg.rotation) || 0;
      // Remember this device's real orientation so a reload that happens while
      // the server is still restarting (self-update) can fall back to it
      // instead of guessing — see the seed in init() for the full rationale.
      if (!IS_PREVIEW) {
        try { localStorage.setItem('phq_display_orient', JSON.stringify({ f: _newForce, r: _newRotation })); } catch {}
      }
      displayConfig = {
        force_orientation: _newForce,
        rotation: _newRotation,
        theme: cfg.theme || '',
        fontFamily: cfg.fontFamily || '',
        screensaverTag: cfg.screensaverTag || '',
        screensaverPhotoId: cfg.screensaverPhotoId || null,
        ambientClockCorner: cfg.ambientClockCorner || 'bl',
        ambientPhotoFit: cfg.ambientPhotoFit || 'cover',
        ambientFadeTransition: cfg.ambientFadeTransition !== false,
        ambientPhotoInterval: cfg.ambientPhotoInterval || '',
        ambientBlurBg: cfg.ambientBlurBg !== false,
        ambientFadeDuration: cfg.ambientFadeDuration || '2',
        fxScale: cfg.fxScale || '1',
        fxDensity: cfg.fxDensity || '1',
        ambientMode: cfg.ambientMode || '',
        customBg: cfg.customBg || '',
        customDeco1: cfg.customDeco1 || '',
        customDeco2: cfg.customDeco2 || '',
        customDeco3: cfg.customDeco3 || '',
        customDeco1Behavior: cfg.customDeco1Behavior || 'random',
        customDeco2Behavior: cfg.customDeco2Behavior || 'random',
        customDeco3Behavior: cfg.customDeco3Behavior || 'random',
      };
    });
  } catch (e) {
    console.error('fetchDisplayConfig failed after retries — keeping current/default config:', e);
  }
}

async function fetchPhotos() {
  // Same fix as fetchLayout()/fetchDisplayConfig() (see fetchWithRetry's comment) —
  // this one was missed in that pass. A single transient failure here used to leave
  // state.photos empty for the rest of the session (no retry, and the only
  // self-correction was the 10-minute background refresh interval), which shows up
  // as a screensaver/ambient photo mode that's correctly configured but renders a
  // blank screen — looks like a tagging or config problem, isn't one.
  await fetchWithRetry(async () => {
    const r = await fetch('/api/photos');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    state.photos = await r.json();
  });
}

async function fetchOneProjectTasks(projectId) {
  const projectKey = projectId || '__all__';
  try {
    const url = projectId ? `/api/todoist/tasks?project_id=${encodeURIComponent(projectId)}` : '/api/todoist/tasks';
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) {
      state.tasksByProject[projectKey] = [];
      state.tasksErrorByProject[projectKey] = data.error;
    } else {
      state.tasksByProject[projectKey] = data;
      state.tasksErrorByProject[projectKey] = null;
    }
  } catch {
    state.tasksByProject[projectKey] = [];
    state.tasksErrorByProject[projectKey] = 'Could not reach Todoist';
  }
}

// Fetches tasks for every distinct project referenced by Tasks widgets in the current layout.
// Multiple Tasks widgets pointing at the same project share one fetch. The combined
// Tasks widget (tasksCombined) can reference several projects at once, so its list
// gets flattened in alongside the single-project Tasks widgets.
async function fetchTasksForLayout() {
  const taskWidgets = state.layout.filter(w => w.type === 'tasks');
  const combinedWidgets = state.layout.filter(w => w.type === 'tasksCombined');
  if (!taskWidgets.length && !combinedWidgets.length) return;
  const singleIds = taskWidgets.map(w => w.projectId || null);
  const combinedIds = combinedWidgets.flatMap(w => (w.projectIds && w.projectIds.length) ? w.projectIds : [null]);
  const projectIds = [...new Set([...singleIds, ...combinedIds])];
  await Promise.all(projectIds.map(pid => fetchOneProjectTasks(pid)));
}

async function fetchNews() {
  if (!state.layout.some(w => w.type === 'news')) return; // skip work if no News widget is in use
  try {
    const r = await fetch('/api/news');
    const data = await r.json();
    if (data.error) {
      state.news = [];
      state.newsError = data.error;
    } else {
      state.news = data.items;
      state.newsError = null;
    }
  } catch {
    state.news = [];
    state.newsError = 'Could not reach news service';
  }
}

// Individual ticker tracking moved from one device-wide Data Sources setting
// to each Stock widget's own settings in v1.77.77 (w.stockTickers). This
// fetches the UNION of every Stock widget's list in one batched request —
// same reasoning as fetchWeather()'s shared-by-location fetch — and
// renderStocks() below filters that shared result down to each widget's own
// subset, so widgets can track different tickers without a separate network
// round-trip each.
function migrateLegacyStockTickersIfNeeded() {
  const legacy = (state.settings && state.settings.stock_tickers) || '';
  if (!legacy) return; // nothing to migrate
  const legacyList = legacy.split(',').map(t => t.trim()).filter(Boolean);
  if (!legacyList.length) return;
  let migrated = false;
  state.layout.forEach(w => {
    // undefined (never touched since upgrading) vs. [] (deliberately cleared
    // by the user) — only the former should be migrated, or clearing a
    // widget's tickers would get silently undone on every reload.
    if (w.type === 'stocks' && w.stockTickers === undefined) {
      w.stockTickers = [...legacyList];
      migrated = true;
    }
  });
  if (migrated) scheduleLayoutSave();
}
async function fetchStocks() {
  const stockWidgets = state.layout.filter(w => w.type === 'stocks');
  if (!stockWidgets.length) return; // skip work if no Stocks widget is in use
  migrateLegacyStockTickersIfNeeded();
  const tickerUnion = new Set();
  stockWidgets.forEach(w => (Array.isArray(w.stockTickers) ? w.stockTickers : []).forEach(t => t && tickerUnion.add(String(t).trim().toUpperCase())));
  try {
    const r = await fetch('/api/stocks?tickers=' + encodeURIComponent([...tickerUnion].join(',')));
    const data = await r.json();
    if (data.error) {
      state.stocks = [];
      state.stocksError = data.error;
    } else {
      state.stocks = data.quotes;
      state.stocksError = null;
    }
  } catch {
    state.stocks = [];
    state.stocksError = 'Could not reach stock service';
  }
}

async function fetchAirQuality() {
  if (!state.layout.some(w => w.type === 'airquality')) return; // skip work if no widget is in use
  try {
    const r = await fetch('/api/air-quality');
    const data = await r.json();
    if (data.error) {
      state.airQuality = null;
      state.airQualityError = data.error;
    } else {
      state.airQuality = data;
      state.airQualityError = null;
    }
  } catch {
    state.airQuality = null;
    state.airQualityError = 'Could not reach air quality service';
  }
}

// Keyed by widget id (not a single shared slot like weather/air-quality) since
// multiple Travel Time widgets on the same display can have entirely different
// routes — e.g. "To Work" and "To School" — each needs its own result.
async function fetchTravelTimes() {
  const widgets = state.layout.filter(w => w.type === 'travel' && w.travelOrigin && w.travelDestination);
  if (!widgets.length) return;
  state.travelTimes = state.travelTimes || {};
  state.travelTimesError = state.travelTimesError || {};
  await Promise.all(widgets.map(async (w) => {
    try {
      const params = new URLSearchParams({ origin: w.travelOrigin, destination: w.travelDestination, mode: w.travelMode || 'driving' });
      const r = await fetch('/api/travel-time?' + params.toString());
      const data = await r.json();
      if (data.error) {
        state.travelTimes[w.id] = null;
        state.travelTimesError[w.id] = data.error;
      } else {
        state.travelTimes[w.id] = data;
        state.travelTimesError[w.id] = null;
      }
    } catch {
      state.travelTimes[w.id] = null;
      state.travelTimesError[w.id] = 'Could not reach travel time service';
    }
  }));
}

// Home Assistant entities — keyed by entity_id (not widget id), same reasoning
// as fetchWeather()'s per-location keying: if more than one widget happens to
// point at the same entity, they share a single fetch instead of duplicating
// it. Errors are stored inline per entity (rather than a separate error map
// like fetchTravelTimes above) since renderEntityStatus() only ever needs one
// or the other for a given entity, never both at once.
async function fetchHaEntities() {
  // Area data must be loaded BEFORE the ids Set below is built — a widget
  // with area selections needs its current members resolved, and that
  // resolution depends on cachedHaAreasD (see resolveAreaMemberIds()).
  // Only pays this cost for households that actually use area selections;
  // ensureHaEntitiesAndAreasLoaded() is a no-op once cached either way.
  const needsAreas = (state.layout || []).some(w =>
    (w.type === 'smarthomeDashboard' && Array.isArray(w.haAreaIds) && w.haAreaIds.length) ||
    (w.type === 'groupcontrol' && Array.isArray(w.gcAreaIds) && w.gcAreaIds.length) ||
    (w.type === 'smarthomeDashboard' && Array.isArray(w.haComboGroups) && w.haComboGroups.some(c => c.areaIds && c.areaIds.length))
  );
  if (needsAreas) await ensureHaEntitiesAndAreasLoaded();
  const ids = new Set();
  (state.layout || []).forEach(w => {
    if (w.type === 'entitystatus' && w.haEntityId) ids.add(w.haEntityId);
    if (w.type === 'smarthomeDashboard') {
      if (Array.isArray(w.haEntityIds)) w.haEntityIds.forEach(entry => { if (entry && entry.id) ids.add(entry.id); });
      if (Array.isArray(w.haAreaIds) && w.haAreaIds.length) resolveAreaMemberIds(w.haAreaIds).forEach(id => ids.add(id));
      if (Array.isArray(w.haComboGroups)) w.haComboGroups.forEach(combo => resolveComboMemberIds(combo).forEach(id => ids.add(id)));
    }
    if (w.type === 'groupcontrol') {
      if (Array.isArray(w.gcEntityIds)) w.gcEntityIds.forEach(id => { if (id) ids.add(id); });
      if (Array.isArray(w.gcAreaIds) && w.gcAreaIds.length) resolveAreaMemberIds(w.gcAreaIds).forEach(id => ids.add(id));
    }
  });
  // Entity Status widgets with a Template: Home Assistant renders them (POST /api/ha/template), one request per distinct template.
  const templates = new Set();
  (state.layout || []).forEach(w => { if (w.type === 'entitystatus' && String(w.haTemplate || '').trim()) templates.add(String(w.haTemplate).trim()); });
  if (!ids.size && !templates.size) return false;
  state.haEntities = state.haEntities || {};
  state.haTemplates = state.haTemplates || {};
  // Snapshot before the fetch so callers (both poll timers below) can skip a
  // full renderLayout() when nothing actually changed — previously both
  // timers called renderLayout() unconditionally on every tick regardless of
  // whether there were any HA widgets at all or whether any entity's state
  // had moved, which meant EVERY widget on the display (not just HA ones)
  // was torn down and rebuilt from scratch every 15s (8s in Live Edit),
  // forever, on every install — harmless-looking for static-HTML widgets,
  // but a real, visible full reload for the Weather Radar widget (its
  // Leaflet map instance, base tiles, and animation all get destroyed and
  // recreated from zero on every renderLayout() call — see initRadarWidgets()).
  const before = JSON.stringify(state.haEntities) + JSON.stringify(state.haTemplates);
  const fetchTemplates = Promise.all([...templates].map(async (t) => {
    try {
      const r = await fetch('/api/ha/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: t }) });
      const d = await r.json();
      state.haTemplates[t] = (d && typeof d.text === 'string') ? { text: d.text } : { error: (d && d.error) || 'Unavailable' };
    } catch { state.haTemplates[t] = { error: 'Could not reach server' }; }
  }));
  await Promise.all([...ids].map(async (id) => {
    // Sequence-stamped at issue time (see haEntityFetchSeq guard near
    // callHaAction) — if a tap's own post-action confirm fetch for this same
    // entity gets issued and resolves while this poll request is still in
    // flight, this poll's (now-stale) response is discarded instead of
    // overwriting the fresher, action-confirmed state.
    const mySeq = nextHaSeq(id);
    try {
      const r = await fetch(`/api/ha/state/${encodeURIComponent(id)}`);
      const data = await r.json();
      applyHaEntityState(id, mySeq, (data && data.entity_id) ? data : { error: (data && data.error) || 'Unavailable' });
    } catch {
      applyHaEntityState(id, mySeq, { error: 'Could not reach server' });
    }
  }));
  await fetchTemplates;
  return (JSON.stringify(state.haEntities) + JSON.stringify(state.haTemplates)) !== before;
}

async function fetchOnThisDay() {
  if (!state.layout.some(w => w.type === 'onthisday')) return;
  try {
    const r = await fetch('/api/on-this-day');
    const data = await r.json();
    if (data.error) {
      state.onThisDay = null;
      state.onThisDayError = data.error;
    } else {
      state.onThisDay = data;
      state.onThisDayError = null;
    }
  } catch {
    state.onThisDay = null;
    state.onThisDayError = 'Could not reach Wikipedia';
  }
}

async function fetchDailyQuote() {
  if (!state.layout.some(w => w.type === 'dailyquote')) return;
  try {
    const r = await fetch('/api/daily-quote');
    const data = await r.json();
    if (data.error) {
      state.dailyQuote = null;
      state.dailyQuoteError = data.error;
    } else {
      state.dailyQuote = data;
      state.dailyQuoteError = null;
    }
  } catch {
    state.dailyQuote = null;
    state.dailyQuoteError = 'Could not reach quote service';
  }
}

async function fetchSports() {
  const sportsWidgets = state.layout.filter(w => w.type === 'sports' && w.spTeamId);
  if (!sportsWidgets.length) return;
  state.sports = state.sports || {};
  state.sportsError = state.sportsError || {};
  // Multiple sports widgets could track different teams — fetch each team once
  // (dedup by id) rather than once per widget instance.
  const teamIds = [...new Set(sportsWidgets.map(w => String(w.spTeamId)))];
  await Promise.allSettled(teamIds.map(async (id) => {
    try {
      const r = await fetch(`/api/sports/team/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (data.error) {
        state.sportsError[id] = data.error;
      } else {
        state.sports[id] = data;
        state.sportsError[id] = null;
      }
    } catch {
      state.sportsError[id] = 'Could not reach sports service';
    }
  }));
}

async function fetchMetarTaf() {
  const wxWidgets = state.layout.filter(w => w.type === 'metar' && w.wxIcao);
  if (!wxWidgets.length) return;
  state.metarTaf = state.metarTaf || {};
  state.metarTafError = state.metarTafError || {};
  // Multiple widgets could track different airports — fetch each ICAO once.
  const icaos = [...new Set(wxWidgets.map(w => String(w.wxIcao).toUpperCase()))];
  await Promise.allSettled(icaos.map(async (icao) => {
    try {
      const r = await fetch(`/api/metar-taf?icao=${encodeURIComponent(icao)}`);
      const data = await r.json();
      if (data.error) {
        state.metarTafError[icao] = data.error;
      } else {
        state.metarTaf[icao] = data;
        state.metarTafError[icao] = null;
      }
    } catch {
      state.metarTafError[icao] = 'Could not reach the Aviation Weather Center';
    }
  }));
}

