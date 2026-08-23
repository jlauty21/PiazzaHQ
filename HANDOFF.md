# Piazza HQ — Handoff

**Read this first if you're picking up this project fresh.** This file exists so a new
Claude session — or a human collaborator — can get real context fast, including the
non-obvious stuff that took actual debugging to learn. It is NOT a changelog (each repo
has its own `CHANGELOG.md` for that) and NOT a feature list. It's the "here's what you'd
otherwise have to rediscover the hard way" document.

**Instruction to whoever is reading this, including future Claude instances:**
Keep this file current. Update it whenever you ship something that changes the
architecture, adds a new hard-won lesson, changes a convention, or changes the business
state described below. A copy of this exact file lives at the root of both repos
(`piazzahq/HANDOFF.md` and `piazzahq-server/HANDOFF.md`) — keep them identical:
update one, copy it to the other, and commit both.

---

## What this is

Piazza HQ is a self-hosted family/team wall calendar that runs on a Raspberry Pi — the
whole pitch is "not in the cloud." Two separate repos:

- **`piazzahq`** — the actual product. Runs on the customer's own Pi. Node/Express +
  better-sqlite3 backend, vanilla JS frontend. Two main surfaces:
  - `public/display.html` — the wall display itself (kiosk-mode Chromium)
  - `public/app.html` — the phone/browser control app (settings, adding events, etc.)
- **`piazzahq-server`** — the developer's own business infrastructure (the "mothership"), NOT
  shipped to customers. Handles licensing/trials, release distribution (devices pull
  updates from here), the marketing site (piazzahq.com), and the admin panel.

A device (host or slave) periodically checks in with `piazzahq-server` for updates
and to report its version/license status. Slaves also sync data from their host over the
LAN/Tailscale independently of that central check-in.

---

## Architecture patterns worth knowing before touching code

- **In-memory-at-startup HTML pages** (`piazzahq-server`): `/`, `/guide`, `/contact`,
  `/privacy`, `/troubleshooting` are all read from disk ONCE at server startup into a
  const, then served from memory on every request (`fs.readFileSync` wrapped in a
  route). Fast, and consistent with how `/admin` already worked. New static pages should
  follow this same pattern.
- **`LOCAL_ONLY_SETTINGS`** (`piazzahq/server.js`): a `Set` of setting keys that are
  per-device and should NEVER sync from host to slave (things like `device_role`,
  `setup_complete`, `tour_completed`, `checklist_done`). Everything else in the
  `settings` table is treated as shared/synced. When adding a new per-device setting,
  add it here — forgetting this is an easy, quiet bug (a slave silently inheriting a
  host's "I've already seen the tour" flag, for example).
- **`defaultSettings`** (`piazzahq/server.js`): the single source of truth for every
  setting's default value and a one-line comment on what it's for. Keep this current —
  it's the fastest way for a fresh session to understand what settings exist at all.
- **Widget rendering** (`display.html`): each widget type has a `renderXWidget(widget)`
  function returning an HTML string, dispatched from a big switch in `renderWidget()`.
  Theme-specific particle effects (snow, planes, boats, etc.) live in `applyTheme()`,
  using a shared `make(count, buildFn)` helper that respects user-configurable
  `fxDensity`/`fxScale`.
- **A widget that needs a real, already-in-the-DOM library instance (not just an HTML
  string) needs its own post-render init function, hooked into BOTH `renderLayout()`'s
  post-render pass and `rerenderSingleWidget()`** — `renderXWidget()` alone can only
  return markup (a placeholder container with a `data-*-id` marker), since libraries
  like Leaflet or qrcodejs need to run their own JS against an element that's actually
  attached to the page. Two live examples of this: `renderQRCodes()` (qrcodejs) and
  `initRadarWidgets()` (Leaflet, for the Weather Radar widget — RainViewer tiles). Both
  are called via `requestAnimationFrame(...)` after the full-render loop in
  `renderLayout()`, AND synchronously inside `rerenderSingleWidget()` (Live Edit's
  single-widget refresh path) — missing either call site means the widget works on
  first load but silently goes stale/blank the moment its own settings are edited, or
  vice versa. Because `renderLayout()` does `canvas.innerHTML = ''` and rebuilds every
  widget's DOM from scratch on every refresh (SSE push, periodic timer, anything), any
  library instance from the PREVIOUS render is now attached to a detached, orphaned
  element — these init functions must tear down (clear timers, call the library's own
  `.remove()`/cleanup) before creating a fresh instance each time, or you get one more
  leaked instance/timer per refresh, compounding forever on a display left running for
  days.
- **`display.html` has NO `$()` shorthand helper** — unlike `app.html` and `hub.html`,
  which both define `const $ = id => document.getElementById(id)` (or equivalent).
  `display.html` uses `document.getElementById(...)` directly, everywhere. Using `$(...)`
  in `display.html` compiles fine (no syntax error) but throws `ReferenceError: $ is not
  defined` at runtime — and since it's usually inside an event listener or init function,
  it fails SILENTLY (caught by a surrounding try/catch, or just never logged anywhere
  visible) rather than crashing loudly. This took down an entire new feature (direct
  touch-editing) for a full round of "should be working" review before an actual browser
  test caught it. Lesson: don't assume a helper exists in a given file just because it
  exists in a sibling file with similar conventions — grep for its definition first.
- **Two different `api`/`apiFetch` helpers, two different error behaviors.**
  `app.html`'s `apiFetch()` special-cases a 401 (shows the PIN screen) but otherwise just
  returns `res.json()` for ANY status code, including 4xx/5xx — it does NOT throw.
  `hub.html`'s `api()` is even plainer: always just `res.json()`, no status handling at
  all. Neither one throws on an HTTP error status. A `try { await apiFetch(...) } catch`
  will NOT catch a 500 with a valid JSON error body — that has to be checked explicitly
  (`if (!data || data.error) ...`) after the call, not assumed to throw. Got this wrong
  once while porting a feature between the two files; caused a real, confirmed crash
  (`data.daily.map is not a function` on an error response with no `.daily` field) that a
  test that actually simulated a failed request caught, not code review.
- **Per-profile settings are real DB columns on `displays`, not `settings` table rows —
  but the client has to be told about each field twice.** `theme` and `fontFamily` are
  both stored per-display (mirroring each other exactly: a migration adding the column, a
  spot in the GET response, a spot in the PUT handler). But `display.html`'s
  `fetchDisplayConfig()` REBUILDS its `displayConfig` object from an explicit, hardcoded
  list of fields read off the server response — it does NOT just spread the whole
  response object. Adding a new per-profile field to the server (columns + endpoints) is
  NOT enough on its own; it also has to be added to this explicit list, or the field is
  silently `undefined` client-side forever, even though the server has been sending it
  correctly the entire time. This exact gap shipped once (the font feature's own tests
  passed because they set `displayConfig` directly, bypassing `fetchDisplayConfig()`
  entirely — see lessons below) and went unnoticed until real end-to-end use.
- **A theme's own CSS can silently defeat a general-purpose feature via `!important`,
  even when the feature's own logic is entirely correct.** The Chalkboard theme used
  `!important` to force its handwritten Caveat font across several widget types — which
  is fine in isolation, but unconditionally beats CSS variables AND direct inline
  per-widget style overrides, regardless of specificity. When the font-selection feature
  was built, this theme rule silently defeated BOTH the global setting and any per-widget
  override, on that theme only — every other theme worked correctly. Fixed by folding the
  theme's own font preference into the SAME `--per-widget-font` → `--global-font-family`
  → `--theme-font-family` → hardcoded-default fallback chain every other font rule uses,
  instead of a separate rule competing against it. Lesson: a theme-specific `!important`
  is a reasonable way to guarantee a look in isolation, but it needs revisiting any time a
  new cross-cutting, user-controllable feature is added — it doesn't announce that it's
  in the way.
- **Direct touch-interaction on `display.html`** (Chore Chart, To-Do widget, mini
  calendar swipe, and drag-to-reposition edit mode) all follow the same shape: real,
  server-persisted mutations (chore/to-do toggles, widget position) go through the EXACT
  SAME endpoints the app/Hub already use, with an optimistic local update that reverts on
  failure. Purely local/temporary UI state (the mini calendar's month-browsing offset)
  is explicitly NOT persisted anywhere and auto-resets after a period of inactivity.
  Every interactive element gets `data-interactive="1"`, which the edit-mode tap-reveal
  listener explicitly excludes (`e.target.closest('[data-interactive], ...')`) so tapping
  a chore checkbox doesn't also pop the edit-mode icon. New interactive widgets should
  follow this same convention rather than inventing a new one.
- **Edit mode's drag-to-reposition writes through `PUT /api/layouts/:orientation`, the
  SAME endpoint the app's own Layout editor uses** — an edit made by dragging directly on
  the display is indistinguishable server-side from one made in the app, including
  triggering the same `'layout'` SSE broadcast that already propagates changes live
  elsewhere. That endpoint currently has NO authentication at all (matches `display.html`
  itself, which is deliberately unauthenticated for the wall-display use case) — worth
  reconsidering if this direct-edit capability gets exposed more prominently, since the
  save endpoint's exposure is now reachable through more surfaces than before.
- **Settings auto-save (`app.html`) reads DOM values LAZILY, at save time, not at the
  moment of the triggering event.** The debounce is ~400ms; navigating to a different
  tab before it fires replaces `#content`'s DOM before the deferred save actually reads
  it. One function in the save chain (`collectSettingsBody()`) defensively treats a
  since-vanished field as unchecked/empty, silently discarding the very change someone
  just made. A different function called right after it in the same chain
  (`saveBriefingFields()`) had NO such guard on several of its fields and would throw
  outright — aborting the whole save before ever reaching the code (further down the
  same function) that updates tab visibility live. This is the actual explanation for a
  bug reported and mis-diagnosed three separate times as a Family Hub sync problem — it
  had nothing to do with the Hub at all, and lived entirely in the main app's own
  settings-saving code. Fixed by flushing any pending save immediately, synchronously,
  the moment a tab-switch begins (before the DOM changes), plus hardening the previously
  unguarded fields with the same defensive pattern already used elsewhere in the same
  object. Lesson: when a bug's supposed cause has already been investigated and "fixed"
  more than once without resolving it, seriously consider that the diagnosis itself —
  not just the fix — is wrong, and look somewhere else entirely rather than iterating on
  the same theory.
- **`piazzahq-server`'s actual settings (admin password, Stripe keys, SMTP
  credentials) live in a `.env` file, completely separate from `store.js`'s
  `data/mothership.json`.** Any feature that touches "the server's data" (backups,
  migrations, etc.) needs to consider both files explicitly — they're both equally
  critical (losing `.env` alone means the admin can't even log back in, independent of
  whether the business data survives) and nothing keeps them in sync automatically.
- **Settings auto-save** (`app.html`): NOT manually wired per-field. A single delegated
  `input`/`change` listener on `#content` catches any `input, select, textarea` and
  calls `scheduleSettingsAutoSave()`, which debounces into `saveAllSettings()` →
  `collectSettingsBody()`. New settings fields need to be added to
  `collectSettingsBody()` explicitly (it's a manually-built object, not auto-collected
  from the DOM) but do NOT need their own event listener — the delegation already covers
  them as long as they're inside `#content` and use a real `<input>`/`<select>`.
- **No shared global `state` object in `app.html`.** This is a real trap — `display.html`
  has a `state` object (`state.settings`, `state.reachable`, etc.) that's used
  extensively, but `app.html` has NO equivalent. Every function that needs settings
  re-fetches via `apiFetch('/api/settings')` independently. Assuming `state.settings`
  exists in `app.html` is a guaranteed `ReferenceError` — this actually happened while
  building the getting-started checklist (see lessons below).

---

## Hard-won lessons (bugs that took real debugging to find)

These are worth reading before assuming something "obviously" works — several of these
were confirmed-in-production-shaped bugs, not hypotheticals.

- **RESOLVED (was UNCONFIRMED in 1.81.1): the Favorites tab "most buttons stop
  responding after adding a card" report.** A follow-up report with an actual
  screenshot (1.81.4-beta.1) finally pinned it down: a "Redeem a Reward" card
  sitting in its empty/not-set-up state. Its `render()` correctly omits the
  `.fav-redeem-btn` element in that state, but its `wire()` did
  `document.querySelector('.fav-redeem-btn').addEventListener(...)`
  unconditionally — `querySelector` returns `null` when nothing matches,
  `.addEventListener` on `null` throws, and that throw happened inside the
  `favoriteCards.forEach(card => def.wire(...))` loop, halting it immediately
  and silently skipping every remaining card's wiring AND the trash/Add-a-Card
  listeners two lines below the loop. One misconfigured card took out
  everything after it in that loop, which is exactly why it looked like "the
  whole tab" broke. The exact same pattern existed in four more card types
  (`kid_shortcut`, `ha_light_toggle`, `ha_group_toggle`, `ha_scene_trigger`),
  all fixed the same way, plus each card's `wire()` call is now individually
  try/caught so a future card making this same mistake can only ever break
  itself, not cascade. 1.81.1-beta.2's generation-counter hardening (see the
  next entry below) was a real, independent fix for a real race condition —
  just never the cause of this particular report. Lesson: when a bug report
  says "everything on this screen stopped working" after one specific
  action, look for a single early exception aborting a shared loop before
  assuming a systemic cause (a race condition, an auth issue) — "innocent
  code after the crash site never got a chance to run" produces the
  identical symptom to "many things independently broke," and looks far
  scarier than the actual fix turns out to be.

- **A confirmed, independent bug, unrelated to the report above but found
  while investigating it: overlapping `renderFavoritesTab()` calls could
  clobber each other's DOM/listeners.** The function does several awaited
  fetches before repainting; if the 15s auto-refresh fired while a previous
  call's fetches were still in flight, or a rapid user action overlapped
  with it, whichever call happened to FINISH last would win and repaint —
  even if it was the call that started FIRST and was now working from a
  stale snapshot. Fixed with a monotonic generation counter (same pattern
  as the existing `authGeneration`) in 1.81.1-beta.2: a now-stale render
  checks its own generation number before touching the DOM and abandons
  itself if a newer call has since started.

- **Chromium's "Unlock Keyring" prompt on kiosk boot, and how to fix it on an
  EXISTING device** (fixed for new installs in 1.81.1-beta.1 via
  `--password-store=basic` in `KIOSK_CMD` — see that changelog entry for the
  root cause). That flag isn't retroactive — a Pi imaged before this fix will
  keep showing the prompt until one of the following is done on it directly:
  1. **Preferred — same fix, applied by hand.** Find wherever this specific
     Pi launches Chromium (`~/.config/labwc/autostart` or `wayfire.ini`'s
     `[autostart]` section, depending on `$SESSION_TYPE` — see the
     `add_line_if_absent`/wayfire branch in install.sh for exactly where
     THIS install put it) and add `--password-store=basic` to the existing
     Chromium command line, then reboot (or just re-run install.sh's latest
     version — the flag is now baked into `KIOSK_CMD` there).
  2. **Alternative — remove the password from the existing keyring instead**,
     if for some reason the flag approach isn't wanted on a given device:
     `sudo apt install seahorse` → open "Passwords and Keys" → right-click
     the "Login" (or "Default") keyring → Change Password → enter the
     current password, then leave the NEW password blank (both fields) and
     confirm despite the warning. This makes the keyring permanently
     unlocked, so nothing prompts for it again — the tradeoff being an
     unlocked keyring is unencrypted-at-rest, which matters far less on a
     single-purpose kiosk with no other secrets stored in it than it would
     on a general-purpose machine, but is worth knowing before recommending
     it as a fix.

- **An absolutely-positioned overlay sibling next to a Leaflet-managed container can
  render completely invisible for reasons that don't show up in code review** — the
  radar widget's frame-time badge (position:absolute, z-index:20, sibling of the
  Leaflet `.radar-map` div) was reasoned through carefully at build time (stacking
  contexts, DOM order, Leaflet's internal z-indices being scoped to inside its own
  container) and looked correct on paper. Confirmed on real hardware: toggle on,
  genuinely zero visual trace, not just misplaced. Root cause not conclusively
  identified even after re-tracing scoping, CSS specificity, and DOM structure by
  hand. Rather than keep guessing, replaced it with a plain in-flow line (no
  position:absolute, no z-index, no positioning-context dependency at all) — an
  element that exists and isn't `display:none` in normal flow WILL take space and
  render; there's no failure mode left to hide in. Lesson: when overlaying content on
  top of a third-party library's own managed container (Leaflet, or anything else
  that does its own DOM/stacking management), prefer normal flow siblings positioned
  by layout (flex order, margins) over position:absolute + z-index tricks unless
  there's a specific reason the content MUST float over library-managed content —
  the latter has more ways to silently fail and fewer ways to debug why.

- **A new feature's tables can ship correctly everywhere except the host↔mirror sync
  snapshot, and the symptom looks like a settings/theme bug, not a sync bug.** The developer
  reported sticker badges showing on the host but not on a mirror, and his first two
  guesses (theme-specific CSS, template default) were both reasonable and both wrong.
  Root cause: `buildSyncSnapshot()`/`applySyncSnapshot()` (server.js) had an explicit,
  named table list — and the Sticker Chart feature's `stickers`, `rewards`, and
  `sticker_redemptions` tables were never added to it, same gap shape as the earlier
  todo_lists/todo_items miss. The misleading part: the calendar widget's "Show Sticker
  Badges" toggle lives in the `layouts` table, which DOES sync — so the setting looks
  correctly applied on the mirror (because it is), while the data it depends on stays
  permanently empty underneath it. Lesson: when a new feature adds its own table(s),
  grep `buildSyncSnapshot`/`applySyncSnapshot` specifically, in addition to the obvious
  places (schema, API routes, both settings-panel UIs) — a feature can be otherwise
  fully wired and still be invisible on every mirror in the household, indefinitely,
  with no error anywhere. Fixed in 1.80.1-beta.1.

- **A widget's user-typed title text can silently ignore the Text Color override
  by hardcoding `color:var(--accent)` instead of relying on the `.widget` base
  rule's `color:var(--text)` (or explicitly using `var(--text2)`).** Found via a
  user bug report on Countdown: the number and "days to go" label both responded
  correctly to the widget's Text Color / Secondary Text Color settings, but the
  custom title ("ALANA'S BIRTHDAY!!!") stayed stuck at the theme's accent color no
  matter what was set. Grepping for the same `color:var(--accent)` pattern on a
  `-title` class found two more live instances — `.timer-title` and `.qr-title` —
  both also user-typed custom text, both with the identical bug, neither yet
  reported. All three fixed in 1.80.1-beta.2. There's already a comment on
  `.widget` in display.html noting this exact bug class was found and fixed
  "behind several widgets" before — these three were leftover instances that
  predated or were missed by that pass. Lesson: when a "text color override
  doesn't work for X" report comes in, grep the whole file for
  `color:var(--accent)` on `-title`/label-style classes rather than just
  patching the one reported widget — this bug shape tends to exist in more than
  one place at a time.

- **A full `innerHTML` re-render on a timer or after any list-item action will wipe
  out in-progress typing in any input inside that list, even on items the person
  never touched.** `admin.html`'s Feedback list re-renders completely every 60s
  (auto-refresh) and after literally any action on any card — mark handled,
  archive, delete, reply — because every one of those calls `loadFeedback()`,
  which rebuilds `box.innerHTML` from scratch, including a brand-new empty reply
  `<textarea>` per card. The developer reported this as "typing a reply clears itself out" —
  the auto-refresh timer was firing mid-type. Fixed with a module-level
  `feedbackReplyDrafts` Map (same shape as the pre-existing `expandedFeedback` Set
  used for collapse state) populated on the textarea's `input` event and restored
  into the template on render; PLUS capturing/restoring `document.activeElement`
  and `selectionStart`/`selectionEnd` around the re-render, since text surviving
  isn't enough on its own — losing focus mid-type still reads as broken even when
  nothing was actually lost. Lesson: any admin/dashboard screen with both (a) a
  polling auto-refresh and (b) free-text inputs inside the repeatedly-re-rendered
  list needs an explicit survives-re-render mechanism for BOTH the input's value
  AND focus/cursor state — collapse-state-only solutions (like `expandedFeedback`)
  don't cover this by themselves, and it's easy to assume they do because the
  symptom (state resetting) looks the same on the surface.

- **`renderLayout()`'s core model — wipe `canvas.innerHTML` and recreate every widget's
  DOM from scratch on every call — is fine for widgets that are just HTML strings, but
  actively hostile to any widget holding real, expensive-to-recreate state (a live
  library instance, a running timer).** Gating out the HA poll timers' unconditional
  `renderLayout()` calls (beta.4) fixed ONE source of unnecessary full re-renders, but
  the Radar widget kept visibly reloading anyway — nearly every OTHER widget's own
  independent refresh timer (weather, tasks, chores, news, stocks, travel…) also calls
  `renderLayout()` on its own schedule, and every one of those, too, was blowing away
  Radar's Leaflet map/tiles/animation for no reason connected to radar at all. Fixed
  with a narrow, opt-in reuse mechanism scoped to just this one widget type: detach the
  existing radar element BEFORE the wipe, compare a small fingerprint of its
  content-relevant settings against the incoming widget config, and put the SAME
  element back untouched (skipping both the `innerHTML` rebuild and Leaflet
  teardown/recreate in `initRadarWidgets()`) when nothing that matters changed. This
  is a real, load-bearing pattern now — if a future widget also needs a live
  library instance (a chart, another map, anything with its own animation/timers),
  copy this reuse approach (fingerprint the content-relevant fields, detach-and-compare
  before the wipe, skip the teardown in its own init function when reused) rather than
  accepting "it reloads on every refresh" as inherent to how this app renders.
- **A conditional `if (x) el.style.setProperty(...)` with no `else el.style.removeProperty(...)`
  is safe ONLY as long as `el` is guaranteed fresh on every render — the instant
  anything makes a widget's DOM element persist across renders (see the radar reuse
  point above), every one of these becomes a real bug: a value that was true, then
  turned back off, silently keeps its stale prior style forever, because nothing was
  ever there to clear it.** Found and fixed four of these in `renderLayout()`
  (`--text`, `--text2`, `--per-widget-font`/`fontFamily`, and the opacity style) the
  moment the radar reuse mechanism above made them reachable for the first time. They
  were correct-by-accident before, not correct-by-design. Any future code touching
  this loop should set-or-clear in pairs, not just set.

- **A periodic poll timer that calls `renderLayout()` unconditionally after its own
  fetch — regardless of whether that fetch found anything relevant, or anything
  actually changed — silently forces a full teardown/rebuild of EVERY widget on
  EVERY tick, forever, on every install, even ones that don't use the feature
  the timer is polling for.** Both Home Assistant poll timers (`fetchHaEntities()`
  on a standing 15s interval, plus a Live Edit-only 8s interval) did `await
  fetchHaEntities(); renderLayout();` — even `fetchHaEntities()`'s own early-exit
  (`if (!ids.size) return`) for a layout with zero HA widgets didn't stop the
  `renderLayout()` after it from firing anyway. This was harmless-LOOKING for
  years because every other widget just re-renders as inert HTML — nothing visibly
  resets. It stopped being harmless the moment a widget existed whose render has
  real teardown cost (the Weather Radar widget's Leaflet map instance, base tiles,
  and animation loop — see `initRadarWidgets()`): that widget now visibly "fully
  reloaded" every 8–15 seconds on literally every display in the fleet, whether or
  not anyone had ever configured Home Assistant. Root-caused from a report that
  sounded, at first, like a radar-specific animation bug. Fixed by having
  `fetchHaEntities()` return whether anything actually changed (diffing a snapshot
  of `state.haEntities` before/after) and gating both `renderLayout()` calls on
  that. Lesson: any `setInterval(async () => { await fetchX(); renderLayout(); },
  ...)` pattern should gate the render on whether `fetchX()` found something
  relevant AND something changed — "poll on a timer" is fine, "unconditionally
  re-render everything on a timer regardless of the poll's result" is a
  compounding cost that stays invisible until a widget with real render cost
  exposes it.

- **A widget wrapper class that never sets `display:flex` on itself means every
  `flex:1` on its children does nothing — the child silently collapses to zero
  size instead of erroring.** The new Weather Radar widget's `.w-radar` wrapper
  only set alignment-adjacent properties, following the visual pattern of
  `.w-countdown`/`.w-timer`/`.w-qrcode` (which also never declare `display:flex`
  themselves) — but those widgets get away with it because their content is
  short, naturally-sized text centered via `text-align:center`, not a child that
  NEEDS to fill real remaining space. The Radar widget's map div relied on
  `flex:1` to get its actual height, and `flex:1` is a no-op unless the PARENT
  is itself `display:flex` — so the map mounted into a genuine zero-height
  container and Leaflet had nothing to paint into. No error anywhere; it just
  silently rendered nothing, confirmed on real hardware. The widgets that
  correctly fill real space (`.w-photo`) all explicitly declare `display:flex`
  themselves rather than assuming anything is inherited from `.widget`. Lesson:
  when a new widget's content needs to genuinely fill its box (not just center
  some text), copy the sizing approach from an existing space-FILLING widget
  (`.w-photo`, `.w-weather`), not from a compact/centered one (`.w-countdown`,
  `.w-timer`) — the two groups look similar in isolation but rely on completely
  different CSS mechanics.

- **A full `innerHTML` re-render on a timer or after any list-item action will wipe
  out in-progress typing in any input inside that list, even on items the person
  never touched.** `admin.html`'s Feedback list re-renders completely every 60s
  (auto-refresh) and after literally any action on any card — mark handled,
  archive, delete, reply — because every one of those calls `loadFeedback()`,
  which rebuilds `box.innerHTML` from scratch, including a brand-new empty reply
  `<textarea>` per card. The developer reported this as "typing a reply clears itself out" —
  the auto-refresh timer was firing mid-type. Fixed with a module-level
  `feedbackReplyDrafts` Map (same shape as the pre-existing `expandedFeedback` Set
  used for collapse state) populated on the textarea's `input` event and restored
  into the template on render; PLUS capturing/restoring `document.activeElement`
  and `selectionStart`/`selectionEnd` around the re-render, since text surviving
  isn't enough on its own — losing focus mid-type still reads as broken even when
  nothing was actually lost. Lesson: any admin/dashboard screen with both (a) a
  polling auto-refresh and (b) free-text inputs inside the repeatedly-re-rendered
  list needs an explicit survives-re-render mechanism for BOTH the input's value
  AND focus/cursor state — collapse-state-only solutions (like `expandedFeedback`)
  don't cover this by themselves, and it's easy to assume they do because the
  symptom (state resetting) looks the same on the surface.

- **A fallback/init-logic pattern that exists in two places (a shared function for
  ongoing changes, plus a separate one-shot version for first load) can get updated in
  only one of them, and the bug stays completely invisible until the specific
  first-load state that exercises the missed copy.** `hub.html` has
  `syncTabVisibilityAndFallback()` (used whenever a setting changes later — an SSE
  push, this Hub's own toggle) and a separate, similar-looking IIFE that runs ONCE at
  page load and was written before the shared function existed. Adding a new tab
  (Home/Smart Home) meant updating the fallback tab-list in BOTH — updating only the
  shared one looked complete (every code REVIEW of the obviously-relevant function
  passed), but the init-time copy still had the old, shorter list. The bug only
  showed up under one specific condition: a genuinely FRESH page load where the new
  tab is the ONLY enabled one — common tests (open the Hub, toggle the new setting,
  watch it appear) never hit this path at all, since toggling a setting AFTER load
  goes through the correctly-updated shared function; only a first load starting in
  that exact state hits the stale copy. Caught by a test that specifically simulated
  a fresh page load with that combination, not by manually toggling settings after
  the page was already open. Lesson: when a codebase has two versions of "the same"
  fallback/init logic for historical reasons (one written before the other existed,
  never consolidated), grep for BOTH before considering a change to that behavior
  complete — and specifically test the FIRST-LOAD path, not just the
  changed-after-load path, since they can silently diverge.

- **`qrcodejs`'s `QRCode` constructor APPENDS into its target element — it never
  clears existing content first.** This bit `renderQRCodes()` specifically because
  it's not a one-shot render: it runs against every `.qr-container` on the page any
  time it's called, and it genuinely gets called from more than one trigger that can
  land close together (boot, an SSE push, a reconnect, a profile reassignment — see
  `applyInfoOverlay()`). Every call that hits an already-populated container stacks
  one more canvas into it instead of replacing the previous one. Fix is a one-line
  `el.innerHTML = ''` immediately before `new QRCode(...)` — but the real lesson is
  broader: any code that calls a third-party drawing/rendering library's constructor
  or init function MORE THAN ONCE against the same target element should not assume
  that library clears its own target first. Check (or test) that assumption
  explicitly rather than treating "it's a rendering library, it must handle
  re-rendering sanely" as given — confirmed via a stub that faithfully reproduces
  the real library's actual append behavior, not assumed from documentation or
  general reputation.

- **A shared fetch-wrapper's return shape being unwrapped inconsistently across call
  sites can hide a real bug behind what looks like correct, boring code.**
  `admin.html`'s `api()` helper returns `{ok, status, data}`, and every caller in the
  file correctly does `r.data` to get the actual payload — except one,
  `loadBackupList()`, which checked `.length` directly on the wrapper object itself.
  `{}.length` is `undefined`, so `!rows.length` was always `true`, meaning the backup
  list UI unconditionally showed "No automatic backups yet" no matter how many
  backups actually existed on the server. This isn't a subtle async/timing bug or a
  race condition — it's a plain, deterministic logic error that would fail 100% of
  the time, every single load, for as long as it existed. It went unnoticed because
  the SYMPTOM (an empty list) looks completely plausible on its own — nothing crashes,
  nothing throws, the empty-state message is well-written and reads as if it's
  correctly reporting a real absence of backups, not the presence of a bug. Lesson:
  when a shared helper wraps responses in a consistent shape, grep for EVERY call
  site and confirm each one unwraps it the same way — a single missed unwrap doesn't
  announce itself, it just quietly always takes the "empty" branch.

- **A single delegated `input`/`change` auto-save listener on a settings panel doesn't
  catch plain `<button>` clicks — and that gap can hide behind a symptom that looks
  unrelated.** `drawWidgetSettingsPanel()`'s auto-save is one listener on the panel
  container for `input`/`change` bubbling up — correct and sufficient for every native
  `<select>`/`<input>`/checkbox in the panel, since those fire real `change`/`input`
  events. But several pickers in that same panel are built from plain `<button>`
  elements (photo thumbnails, color swatches, the HA entity picker, decoration
  emoji quick-picks) — a click on those never fires `input` or `change` at all, so the
  data mutation happened correctly in memory but silently never got saved. The reported
  symptom ("pick a photo, it doesn't take effect until you toggle an unrelated dropdown
  away and back") makes perfect sense once you see it this way: toggling that dropdown
  fires a REAL `change` event, which piggybacks whatever was already sitting mutated
  but unsaved in memory. Six confirmed instances found by systematically auditing every
  `.addEventListener('click', ...)` inside the panel for a `w.<field> = ...` mutation
  with no accompanying save — not by guessing from the one reported case alone.
  Distinguish this from a similar-LOOKING but different situation: some other buttons
  in the same panel (expand-in-panel, delete-in-panel, the four layer-order controls)
  call `rebuildCanvas()`, which already calls `autoSaveLayout()` internally — those
  were never actually broken, and adding an explicit save call there is a defensive
  clarity improvement, not a bug fix. Don't conflate the two when counting/reporting
  what was actually found. Lesson for any FUTURE button-based picker added to this
  panel: a plain `<button>` click needs an explicit `autoSaveLayout()` call — it will
  NOT get caught by the delegated listener the way a `<select>` or checkbox would.

- **A widget-settings port done type-by-type can miss a field that's actually SHARED
  across several types, gated on a condition rather than listed per-type.** app.html's
  `drawWidgetSettingsPanel()` has a "Content" block (which calendars to show, show/hide
  multi-day events) gated on `isCalendarWidget` — true for Calendar, Upcoming, Today,
  AND Agenda together, rendered once and reused, not copy-pasted per type. When
  Calendar's Live Editing settings were built first (1.56.0), this shared block was
  missed — reading Calendar's own `w.type === 'minical'` branch in isolation didn't
  surface it, since the shared block lives OUTSIDE any single type's branch, gated on
  a boolean computed from a `||` chain. Only surfaced later while reading the source
  for Upcoming/Today/Agenda and noticing the same `isCalendarWidget` condition guards
  content they'd also need. Retrofitted into Calendar's already-shipped panel rather
  than left as a silent gap. Lesson: when porting a type's settings, grep the source
  for shared/gated blocks near it (`isXWidget`-style booleans, conditions combining
  multiple `w.type ===` checks with `||`) before considering that type "done" — a
  block that isn't inside the type's own `else if` branch is easy to miss entirely by
  only reading that branch.

- **`rerenderSingleWidget()`'s "just update this one widget's innerHTML" shortcut
  doesn't cover widgets whose visible content is generated by a SEPARATE pass, not
  produced directly by their own render function.** QR codes are the clearest example:
  `renderQRCode()` only outputs an empty `.qr-container` div with the intended content
  in a data attribute — the actual scannable code gets drawn into that div afterward by
  `renderQRCodes()`, a distinct function normally run once after a full `renderLayout()`.
  `rerenderSingleWidget()` (used after every Live Editing field edit, specifically to
  avoid the focus-loss problems a full re-render would cause — see the Testing section)
  only ever called the first part, so editing a QR widget's content through Live Editing
  correctly updated the saved data while the on-screen code silently stayed stale until
  some unrelated full re-render happened to come along and finally pick it up. Fixed by
  having `rerenderSingleWidget()` also call `renderQRCodes()` unconditionally (cheap
  no-op if there's no QR widget on the layout at all). Lesson for the remaining widget
  types still to get Live Editing settings: before assuming a field edit + single-widget
  re-render is sufficient, check whether that widget type has any OTHER post-render pass
  like this one (anything called separately after `renderLayout()`, not just inside the
  widget's own `render*()` function) — QR codes needed it, Calendar's `fitCalendarCells()`
  already gets called explicitly after resize for the same underlying reason, but it's
  easy to miss for a type where the split isn't as obvious as "generates an image into a
  placeholder div."

- **A shared CSS class's own `width:100%` can silently starve a flex sibling, and
  `flex-shrink:0` alone doesn't protect against it.** The Home Assistant entity
  picker's search input rendered squeezed to a ~30px sliver while its "Done" button
  next to it stretched to fill almost the entire row — both are children of a
  `display:flex` row, the input has `flex:1`, the button has `flex-shrink:0`. The
  actual cause: the button's `.btn` class sets `width:100%`, and with no explicit
  `flex-basis` given, that width becomes the flex-basis — so the button's "preferred
  size" is the ENTIRE row, and `flex-shrink:0` means it refuses to give any of that
  back, leaving the input's `flex:1` next to nothing to grow into. Fixed by explicitly
  overriding `width:auto` alongside `flex-shrink:0`. This is the exact same trap as an
  earlier one already documented for `.form-input`'s own `width:100%` — but that
  earlier fix only touched the INPUT side of a row; this time the untouched sibling
  (a `.btn`) was the actual culprit. Lesson: when copying a flex-row pattern (input +
  button, in this case reusing the emoji picker's own layout), check EVERY child's
  base CSS class for a competing `width` declaration, not just the one that visually
  looks wrong — the element that's too NARROW is often a symptom of a sibling that's
  claiming too much, not a problem with the narrow element's own styling.

- **Two independent tap listeners on overlapping DOM elements can silently race, and
  whichever fires first wins — even when that's not the intended behavior.** Adding
  tap-to-place for new widgets, a canvas-level pointerdown listener handles placing the
  widget wherever the next tap lands. But existing widgets ALSO have their own
  pointerdown listener (for select/drag), and since an existing widget can visually sit
  underneath where someone taps to place a new one, ITS listener fires first (the tap's
  actual target), before the event ever bubbles up to the canvas-level placement
  listener — so without an explicit check, tapping on top of an existing widget while
  placing a new one would select/start-dragging the existing widget instead of placing
  the new one, silently doing the wrong one of two plausible things rather than erroring.
  Fixed by having the existing widget's own listener explicitly check for and defer to
  an in-progress placement (`if (pendingPlacementType) return;`) before doing its normal
  job. Lesson: whenever a new interaction can occur while the pointer is physically over
  an element that ALREADY has its own tap/click handling, that existing handler needs an
  explicit check for the new mode — proximity/overlap alone means nothing about which
  handler "should" win without saying so directly.

- **A drag/resize state machine can have TWO entry points into the same action, and
  guarding one doesn't guard the other.** `startDrag()` correctly checked
  `editModeActive` and refused to start an actual drag once Live Editing was exited —
  but the pointerdown listener that CALLS it also unconditionally called
  `selectWidgetForEdit()` first, with no matching guard, so tapping a widget after Done
  still fully selected it (outline, resize handles, settings panel) even though nothing
  could actually be dragged. Same class of gap fixed defensively in `deleteWidget()`
  too, even though it wasn't reachable by the reported bug specifically — a destructive
  action shouldn't depend on the button that triggers it simply staying hidden as the
  only thing standing between it and firing. Lesson: when a feature has several actions
  gated by the same mode flag, audit EVERY entry point into each action individually,
  not just the one most directly downstream of the flag.

- **High-frequency raw pointer events (`pointermove`) can fire faster than a browser can
  paint, and writing to the DOM synchronously on every single one is a real, user-
  perceptible source of lag — not a micro-optimization.** Both the drag and resize
  handlers were doing 4+ style writes (the widget itself) plus another 4 (the separate
  selection overlay tracking it) on every raw `pointermove`, with no batching. Under
  real touch input this read as "slow to recognize and respond," and very plausibly also
  explained "resized less than I actually dragged" if the browser was dropping/coalescing
  events under that write load rather than guaranteeing the last one always got applied.
  Fixed by storing only the LATEST pointer position on every event and batching the
  actual writes through `requestAnimationFrame` (see `applyDragFrame()`/
  `applyResizeFrame()`) — with one final synchronous apply on pointer-up, since a
  pending rAF frame isn't guaranteed to have run yet when the gesture ends. Confirmed
  with a REALISTIC multi-step simulated drag (25 incremental `pointermove` events, not
  one big jump) landing exactly on the full dragged distance — a test using only a
  single big jump wouldn't have caught this class of bug at all, since it wouldn't
  exercise the batching path realistically.

- **A resize/drag handle's VISUAL size and its actual clickable hit target don't have to
  be the same size, and conflating them either clutters the UI or makes touch input
  unreliable.** The original resize handles were a 26px circle, both visible and
  clickable — comfortably under typical ~44px touch-target-size guidance. An imprecise
  tap landing just outside that small area fell through to the WIDGET underneath
  instead (handles live on a separate overlay with `pointer-events:none` except for the
  handles themselves — see the overlay's own architecture note above), starting a MOVE
  instead of a resize. Fixed by decoupling the two: the actual element is 44px
  (reliable touch target) with a smaller 26px dot centered inside it via `::after` (so
  it doesn't visually clutter every selected widget with eight large circles). Verified
  by checking `document.elementFromPoint()` at a deliberately off-center tap location
  that would have missed the old hit area — confirming it still resolves to the handle,
  not the widget.

- **An inline `style="display:none"` on an element permanently defeats ANY class-based
  or CSS-driven show mechanism for that element, no matter how correct the JS toggling
  the class is.** The direct-editing tap-to-reveal icon (`#edit-mode-trigger`) was built
  to show/hide via a CSS opacity transition — `.shown` toggles `opacity:0` → `opacity:1`
  — but the button's HTML tag also had `style="display:none"` hard-coded on it from
  Phase 3's very first version. `display:none` overrides opacity entirely; the element
  was never in the render tree to begin with, so the icon could never have appeared on
  ANY device, ever, regardless of `IS_PREVIEW` or anything else. This one took an
  extended real debugging session to find precisely because every OTHER thing checked
  out correctly at each step (`IS_PREVIEW: false`, `document.body._editModeWired: true`)
  — which is exactly the signature to watch for: when every upstream condition you can
  verify from the JS side is correct and the feature still doesn't work, check the
  static HTML/CSS for something that would silently override the JS's own effect,
  rather than continuing to distrust the JS logic. Also led directly to a real product
  gap: the app had no visible link to the actual non-preview display URL at all (the
  only "open in new tab" affordance re-used the preview-flavored one on purpose, for a
  different job) — fixed in 1.55.12 by re-enabling a real-URL link and Copy URL button
  that already existed in the code, just commented out.

- **A widget's "today" cell can be wrong the moment paging/navigation is added, if
  "today" was originally computed positionally instead of by actual date.** The Strip
  calendar layout's original code labeled its first rendered cell "Today"
  unconditionally (`i === 0` in the render loop) — correct when the strip could only
  ever show one fixed window starting today, but silently wrong the instant swipe/nav
  was added and the first cell could be some other day entirely. Caught before shipping
  by explicitly testing a paged-forward state and asserting the first cell does NOT say
  "Today" (not just that paging changes the day numbers) — a test that only checked "did
  the numbers change" would have missed this entirely. Fixed by comparing the cell's own
  computed date string against the real current date, same pattern the grid and Agenda
  views already used. Lesson: any "is this the current one" check tied to array position
  rather than actual value needs re-auditing the moment the underlying data can shift
  (paging, filtering, sorting) out from under that position.

- **`IS_PREVIEW`'s viewport-size heuristic misfired on a REAL display, not just in
  testing** (see the Testing section below for the test-writing version of this same
  trap). `window.innerWidth`/`innerHeight` are CSS pixels, not physical ones — on a
  screen where OS-level display scaling doesn't match what the OS's own settings claim
  (confirmed real case: a touchscreen reporting ~220% effective scaling despite its
  display settings saying 100%), the CSS viewport read small enough to trip the same
  "under 1100px, must be a phone" threshold a real phone would trip, permanently and
  silently disabling direct-editing on a genuine wall/desk display with no error
  anywhere. Multiplying by `devicePixelRatio` to correct for this was considered and
  rejected — real phones have high DPR BY DESIGN (2-3x, for retina screens), so that
  "fix" would misclassify actual phones as real displays and break Live Preview
  detection broadly instead. A per-device manual override (Settings → Display → "Force
  real display mode", `force_real_display`) shipped first (1.55.9) as a targeted fix,
  but the underlying auto-detection kept misfiring for this specific device even with
  the override available, so **1.55.10 removed the viewport-size auto-detection
  entirely** — `IS_PREVIEW` is now `true` ONLY via an explicit `?preview=1` in the URL,
  which is exactly what the real Live Preview iframe already sends on its own, so
  nothing legitimate broke. `force_real_display` is now vestigial (harmless, but
  no longer load-bearing) since the failure mode it existed to work around can't happen
  anymore. Also worth remembering: `IS_PREVIEW` gates more than just edit mode —
  `resolveAssignedProfile()`'s own screen-identity persistence checks it too, so the same
  misdetection was silently breaking a second, unrelated thing (this screen never
  reliably remembering its own canonical id across reloads) that had nothing to do with
  editing at all. Lesson: when a boolean flag gates several unrelated features, a wrong
  value doesn't announce which features it broke — audit every `if (IS_PREVIEW)` /
  `if (!IS_PREVIEW)` site, not just the one someone happened to notice. Second lesson:
  when a targeted fix for a heuristic's edge case doesn't actually resolve the real-world
  report, don't keep tuning the heuristic — consider whether the heuristic should exist
  at all, given a reliable explicit signal (`?preview=1`, already sent by the only
  legitimate caller) was available the whole time.

- **`grep -qF "$match"` breaks when `$match` starts with `--`** (e.g. `"--kiosk"`) —
  grep parses a leading `--` as an unrecognized option and errors out, which calling
  code reads as "not found." This silently duplicated a line in `install.sh`'s autostart
  file on every single re-run. Fixed with `grep -qF -- "$match"`. If you're ever writing
  a bash idempotency check with grep, use `--`.
- **Switching Wayland→X11 mid-script, then using a session name detected BEFORE the
  switch** wrote the kiosk autostart entry to the wrong session folder — X11 never read
  it. Confirmed via direct user testing on real hardware. Fixed by re-detecting the
  session name fresh right after the switch, AND defensively writing to every distinct
  candidate name available (pre-switch, post-switch, and the classic `LXDE-pi`
  fallback) rather than betting on exactly one being right, since there's no way to
  fully verify the true post-reboot value without an actual reboot.
- **The `setup_complete` migration bug (serious — affected every fresh install).** A
  migration meant to detect "this device predates the wizard" checked the `layouts`
  table as a signal of prior use. But `layouts` gets a default auto-seeded by
  `seedDefaultLayoutsForDisplay()` on EVERY server startup, regardless of any real user
  action. Fresh installs start the server twice (once during `install.sh`, once after
  its own reboot) — on the second startup, the migration saw `layouts > 0` from the
  first startup's auto-seed and wrongly concluded the device was already configured,
  marking `setup_complete='1'` before the wizard ever ran. This meant the required-email
  step had likely never actually fired on a real fresh install since it was added.
  Fixed by removing `layouts` from the check. **Lesson: any "does this table have real
  user data" check needs to account for whatever the app itself auto-seeds.**
- **The wizard's ZIP code field never actually geocoded.** It saved the raw ZIP digits
  directly as a setting via the generic settings PUT, but nothing about that converts a
  ZIP into the lat/lon coordinates the weather widget needs — that conversion lives
  entirely in a separate `/api/geocode` endpoint that only Settings' own "Zip lookup"
  button was calling. Weather stayed stuck on "loading" forever. Lesson: when a feature
  has two entry points (wizard vs. Settings) doing conceptually the same thing, verify
  they're ACTUALLY calling the same underlying logic, not just producing similar-looking
  UI.
- **`app.html` has no global `state` object** — see architecture section above. Assumed
  incorrectly while building the getting-started checklist; every interaction would have
  thrown `ReferenceError: state is not defined`. Caught via testing, not review — a
  reminder that even "should obviously work" JS needs an actual browser test, not just a
  syntax check.
- **The original `piazzahq-server` had literally no generic `express.static`
  middleware** — every route was hand-written, so a new `/assets` folder full of images
  silently 404'd until this was discovered and fixed. Testing with a generic Python
  `http.server` had masked this (it serves everything by default), which is why the bug
  shipped in the first place. Lesson: test file-serving against the REAL server code,
  not a generic static server standing in for it.
- **Admin panel's device "online" threshold had zero margin over the device's own
  check-in interval** (both exactly 6h) — any normal timing jitter flipped a healthy
  device to "offline" in the UI. Fixed with a real buffer (9h). Related: the Devices tab
  was only ever loaded once, on login, with no refresh mechanism at all — a stale tab
  could show arbitrarily old data with no indication it was stale. Fixed with a refresh
  button + 60s auto-poll while the panel is actually open.
- **A feature's own tests can pass fully while still missing the actual bug**, if they
  test the logic in isolation rather than the real data path end-to-end. The per-profile
  font feature shipped with 23 passing tests, all verifying `applyFontFamily()` — but
  every one of them set `displayConfig` directly rather than going through
  `fetchDisplayConfig()`, which is exactly where the real bug lived (see the
  `fetchDisplayConfig()` architecture note above). It took an actual user report on real
  hardware to surface it. Lesson: for any feature whose data crosses a server→client
  boundary, at least one test needs to exercise the REAL fetch/parse function against a
  mocked server response, not just the function that consumes the already-correct data.

---

## Testing approach used throughout this project

Every non-trivial change gets tested with real logic execution, not just a syntax
check — usually via Playwright driving the actual HTML/JS files against a local Python
`http.server`, with `page.route()` mocking whatever API responses are needed. For
backend-only logic (bash, pure JS functions), isolated Node/bash scripts that
copy-paste the real function and run it against constructed scenarios, including the
specific edge case that motivated the fix. Screenshots for anything visual, especially
overlays/mobile layouts. This project has a real track record of catching bugs THROUGH
this testing (see lessons above) that a syntax check alone would have missed — don't
skip it to save time.

Two additions worth knowing about for specific situations:
- **Real SSE/live-connection behavior needs a real server, not just `page.route()`
  mocking.** Verifying that a live connection actually opens, actually receives a
  pushed event, and actually CLOSES when it's supposed to (the critical check when
  re-enabling something that was previously disabled specifically to prevent a
  connection leak) requires a genuine long-lived HTTP response — a small standalone
  Node `http` server with a real `text/event-stream` endpoint, hit with Playwright
  pointed at the real port. Used for both the Family Hub sync fix and re-enabling live
  updates in Live Preview.
- **Playwright's `page.mouse` API doesn't reliably synthesize `pointerdown`/`pointermove`
  events in this environment** — a real drag gesture built from `page.mouse.down()` /
  `.move()` / `.up()` silently failed to trigger `pointerdown` listeners at all, with no
  error, just nothing happening. Dispatching real `PointerEvent`s directly via
  `page.evaluate()` (`el.dispatchEvent(new PointerEvent('pointerdown', {...}))`) is the
  reliable way to test pointer-based drag interactions here.
- **A synthetic drag test has to account for `setPointerCapture()` itself, not just the
  gesture it's simulating.** Testing the Phase 4 resize handles, dispatching
  `pointerdown` on the handle (correct — only the handle has the listener) then
  `pointermove`/`pointerup` on that SAME handle element silently did nothing, because
  `startResize()` calls `el.setPointerCapture(e.pointerId)` on the WIDGET, not the
  handle — in a real browser this redirects all subsequent events for that pointerId to
  the widget regardless of where the pointer physically is, but `dispatchEvent()`
  doesn't emulate capture at all; it only fires on the exact element you call it on. Had
  to dispatch the follow-up `pointermove`/`pointerup` on the WIDGET element to correctly
  simulate what a real captured drag does. Lesson: when a gesture starts on one element
  but calls `setPointerCapture` on a different one, a synthetic test needs to follow the
  capture, not the visual start point.
- **`IS_PREVIEW` auto-detects off viewport size (`Math.max(vw, vh) < 1100`) and
  disables direct-editing entirely when true** — by design, so a phone previewing the
  Layout tab can't accidentally write back to the real layout just by being viewed. A
  Playwright test running at a phone-sized viewport (1000×600, chosen with no
  particular reasoning behind the number) silently exercised none of Phase 4's
  edit-mode feature at all — not a crash, not an error, just every deselect-on-outside-
  tap and Done-button check quietly failing because `wireDirectEditMode()` had returned
  early and never wired the listeners those checks depended on. Size any test viewport
  for `display.html`'s interactive features at real wall-display dimensions (≥1100px),
  not an arbitrary phone/tablet-shaped number, or the feature under test may simply
  never be reachable.

Standard verification pass before any commit: `node -c server.js` /
`bash -n install.sh` for syntax, extract and syntax-check every `<script>` block in
touched HTML files, and (for `piazzahq-server`) an independent re-verification by
actually unzipping the packaged output and grepping for the expected changes, rather
than trusting the build step blindly.

---

## Versioning & release discipline

- Both repos bump `package.json`'s version on every change and keep their own
  `CHANGELOG.md`. `piazzahq-server` didn't originally have one (history lived in
  git commit messages alone) but gained one this session (started at 1.21.1, for the
  website content-catch-up release) — don't assume it's still commit-messages-only.
- For `piazzahq`, the changelog entry gets written BEFORE packaging — it doubles as
  the release notes shown in the admin panel (auto-filled from it when publishing).
- **`piazzahq` zips are NOT automatically live for customers.** The developer has to manually
  upload one to `piazzahq-server`'s `/admin` → Publish a Release. Fresh installs and
  in-app update checks only ever see whatever's currently published there — NOT
  whatever's newest in a zip handed over in conversation. This caused real confusion
  earlier in this project (the developer testing against a much older published version without
  realizing it) — always confirm what's actually published before assuming a fix is
  "live."
- The two `piazzahq` zips historically delivered (`piazzahqinstall.zip` and
  `piazzahqupdate.zip`) are byte-identical — same source, two names for clarity of
  intent. Only one needs to actually be uploaded/deployed.
- **Zip filenames handed to the developer must not contain dashes or periods** (other than the
  single `.zip` extension) — e.g. `piazzahq1801beta1.zip`, not
  `piazzahq-1.80.1-beta.1.zip`. Applies to every packaged deliverable, not just
  version bumps.
- **the developer's ask: only present `piazzahqupdate.zip` when handing off a build, not both
  files.** They're byte-identical (see above) — presenting both was redundant
  clutter for something he's already told Claude he doesn't need duplicated. Still
  build/verify both names internally if that's ever useful, just don't surface
  `piazzahqinstall.zip` to him going forward.

---

## Current business state (as of this writing)

- **Piazza HQ is now public.** Confirmed directly by the developer this session — flagging
  here since earlier sessions in this file (e.g. a stale `TODO(before public
  launch)` mentioned around v1.60.1) were written when that wasn't yet true.
  Nothing in the code changed as a direct result of this by itself; it's
  noted here because it changes the STAKES of what ships — e.g. the
  donation/support links added this session (see the session-update entry
  below) are a "makes sense now that real people outside the developer's own household
  can see this" feature, not something that would have made sense pre-launch.
- **the developer's own real devices, for context in future sessions**: a host Pi
  (`raspberrypical`, running both `pi-calendar.service` — the device app, despite
  the name still on old naming per Option A — and, on the same machine,
  `piazzahq-server.service`, the central server) plus a slave display named
  "Mirror," reachable over Tailscale at `100.118.107.40:3000`. Both devices and
  the central server are confirmed on the latest renamed code (device 1.57.0,
  server 1.22.0) as of the rename saga described in the Open Items list below.
- `FREE_MODE` is currently on — checkout is hard-blocked, marketing site does email
  capture → creates a `status:'trial'` license, bounded by `TRIAL_FREE_UNTIL`
  (2026-12-31 by default).
- Trial licenses are created identically whether someone signs up via the marketing
  site's form OR via the device wizard's required-email step — same backend endpoint,
  same email-deduplication logic. Nobody needs to visit the website first for a working
  license.
- License key auto-fills in the device's own Settings (Software Update section) purely
  as a side effect of the wizard's required email step succeeding — never meant to be
  manually typed by a user.
- `LICENSE_REQUIRED_FROM` is deliberately unset — licensing isn't enforced yet, only
  tracked.
- Not yet built: real Stripe checkout testing (test-mode keys needed), ToS/privacy
  policy legal review, annual pricing.
- **`piazzahq-server` now has automated data backups** (every 6 hours, ~2 week
  retention, covers both `mothership.json` and `.env` together) plus a manual
  download/restore path in the admin console — see the CHANGELOG for the version that
  shipped this. This was explicitly the highest-priority item at the time it was built,
  to protect against losing license/account data or the credentials needed to run
  the business at all.
- **Clarified and now underway: "GCP hosting move" was ambiguous in earlier versions
  of this file — it read as if it meant moving the CUSTOMER product itself off the Pi,
  which really would be a reversal of the "not in the cloud" pitch and the product's
  core identity. That's NOT what this is.** Confirmed directly: this is only about
  `piazzahq-server` (the mothership — licensing, updates, admin panel, the
  marketing/docs site), which was running as a double-clickable Mac app on a physical
  machine that could (and did) get unplugged. Customers' own Pis and their data are
  completely unaffected — this doesn't touch the pitch at all. Driven by real reliability
  problems (intermittent downtime, the literal unplugging incident), not a strategic
  repositioning. See the Open Items list below for the concrete deployment plan
  (`deploy-gcp.sh`, `MIGRATION.md`) already written and tested.
  Home Assistant Tier 1 (a read-only Entity Status widget) shipped in 1.56.0 — see the
  Open Items list below for the full writeup. Tier 2 (light/switch toggle, thermostat
  touch-adjust, scene-trigger buttons) shipped in 1.58.0 — see the Open Items list
  below. Tiers 3-4 remain under discussion, not started: Tier 3 (presence-aware
  Ambient Mode), Tier 4 (multi-entity dashboard/history, not yet scoped in detail).

---

## Open items list (as of this writing)

Tracked informally in conversation with the developer, executed in batches on explicit "go ahead."
Recent work (chronological, most recent last): global/per-widget font selection → moved
to per-profile after a real usability request → the `fetchDisplayConfig()` field-mapping
bug and the Chalkboard `!important` conflict, both found and fixed; a batch of smaller
feature requests (sports search nickname matching, widget-palette category fix, Shopping
widget confirmed already complete, chore-analytics-in-the-Hub found and ported under a
different name); Live Preview's live SSE updates re-enabled (the original leak concern
that disabled it had already been separately fixed); direct touch-interaction on
`display.html` in phases — Phase 2 (tap-to-complete on Chore Chart, To-Do widget, and
mini-calendar month swipe/nav, all shipped) and Phase 3 (tap-to-reveal edit mode with
drag-to-reposition, shipped) — with Phase 4 (full editing: resize, add/remove widgets)
deliberately deferred until later; the Family Hub sync bug, misdiagnosed and "fixed"
three times before the real cause (in the main app, not the Hub) was found; and the
`piazzahq-server` backup/restore system described above.

Still open / explicitly deferred, roughly in the order the developer wants them tackled next:
Phase 4's remaining piece — adding NEW widget types from the display itself (deferred
per the developer's explicit direction; app.html's ~25-type WIDGET_DEFS palette is a separate,
larger piece of work than editing what's already placed) — then Home Assistant install
documentation (commands + basics — deliberately NOT a built-in installer UI, given that
would mean this app's own server shelling out to run system-level Docker commands, a
materially different and riskier capability than anything it does today), then GCP
hosting move and further Home Assistant tiers.

Shopping widget tap-to-complete (Chore Chart/To-Do already had it; Shopping was
previously left read-only-on-purpose per an in-code comment) shipped in 1.55.6 — same
pattern as To-Do, against `PUT /api/shopping-items/:id`.

Calendar swipe/nav (previously month-grid only) extended to week views, Agenda, and
Strip layouts in 1.55.7 — see `miniCalNavHtml()` for the shared nav-arrows/Today-button
markup now used by all four. Week views page by their own window width per nav step
(no smaller natural unit than that); Agenda/Strip gained the same arrows/swipe/Today
mechanism. Caught and fixed a real bug in Strip's original code during this work: it
labeled the first cell "Today" unconditionally (`i === 0`) rather than checking the
actual date — harmless before paging existed, would have mislabeled every paged view
had it shipped as-is.

Phase 4 resize/delete/basic-settings shipped in 1.55.8 (see `WIDGET_BASIC_SETTINGS` for
the per-type title/font field map, `injectEditChrome()`/`onResizeMove()` for the resize
handles). Adding new widget types from the display is the one piece of "full editing"
still deferred — see above.

Fixed in 1.55.9: `IS_PREVIEW` misdetecting a real display as a phone/tablet preview on
screens with unusual OS-level display scaling, which was silently disabling direct-
editing (and, found in the same investigation, silently breaking screen-identity
persistence too — see the hard-won-lessons entry above for the full explanation). Added
a per-device Settings → Display → "Force real display mode" override
(`force_real_display`) rather than trying to make the auto-detection itself smarter —
see that lessons entry for why a smarter heuristic isn't really achievable here.

1.55.10: the 1.55.9 fix didn't fully resolve it for the reporting device, so the
viewport-size auto-detection was removed entirely rather than tuned further —
`IS_PREVIEW` is now `true` only via explicit `?preview=1` (already sent by the real
Live Preview iframe). `force_real_display` is now vestigial, left in place rather than
removed under time pressure. Shipped directly without independent re-testing per
explicit direction that round — worth a first real look next time this file's touched.

1.55.11: found the ACTUAL root cause after 1.55.9/1.55.10 both turned out to be real
fixes for a problem that was never the (only) blocker — `#edit-mode-trigger` had a
stray inline `style="display:none"` since Phase 3's first version, permanently
overriding the opacity-based show mechanism regardless of `IS_PREVIEW` or anything
else. See the hard-won-lessons entry above for the full diagnostic story.

1.55.12: re-enabled the real (non-preview) "Open this display in a new tab" link and
Copy URL button on each display profile card (Displays → Profiles) — previously
commented out, code already existed. Distinct from the Layout tab's own Live Preview
"Open in New Tab" button, which correctly keeps `?preview=1` on purpose.

1.55.13: renamed "Edit Mode" to "Live Editing" throughout. Fixed a real bug — widgets
stayed selectable/showing their edit chrome after Done, since the selection entry point
had no `editModeActive` guard even though the actual drag logic downstream of it did.
Fixed drag/resize feeling laggy and sometimes resizing less than actually dragged (both
now batch DOM writes through `requestAnimationFrame` instead of writing synchronously
on every raw `pointermove`) and fixed resize handles sometimes moving the widget instead
of resizing it (44px hit target now, was 26px — under typical touch-target-size
guidance). See the hard-won-lessons entries above for the full diagnostic story on both.

1.55.14: shipped the add-widget palette — full 31-type palette (all of app.html's
WIDGET_DEFS, not a curated subset — confirmed scope directly this time), tap-to-place
rather than app.html's fixed-spot-then-drag. See the hard-won-lessons entry above for
the existing-widget-tap-conflict this surfaced and fixed. `WIDGET_DEFS`/
`WIDGET_CATEGORIES`/`buildNewWidgetDefaults()` in display.html mirror app.html's own
arrays/add-widget-defaults chain field-for-field — if app.html's ever changes, this
needs the matching update, same caution as `WIDGET_BASIC_SETTINGS` already carries.

1.55.15: shipped full settings parity (not a trimmed subset) for Calendar and Weather
(all four variants) specifically, via a new "⚙️ More Settings" full-screen panel —
`WIDGET_ADVANCED_TYPES` gates which types show the button, `openWidgetAdvancedPanel()`
dispatches to `renderCalendarAdvancedSettings()`/`renderWeatherAdvancedSettings()` +
their matching `wire*()` functions, all ported field-for-field from app.html's
`drawWidgetSettingsPanel()` for these two. The weather ZIP lookup and the
global-location blur-save both hit real server endpoints (`/api/geocode`,
`/api/settings`), not simplified/faked. Confirmed a scope decision explicitly before
starting (deep parity on a couple of hand-picked types, not a shallow pass across all
~31) — see the "How should we scope this session's work?" exchange for why: the full
settings function is ~2000 lines across ~31 types, porting all of it in one go was never
realistic.

Still open, explicitly requested but not yet built:
- **Every widget type EXCEPT Tasks/Tasks Combined now has full Live Editing settings
  parity (28 of ~29)** — Calendar, Weather (all 4 variants), To-Do List, Shopping List,
  Chore Chart, Chore Leaderboard, Countdown, QR Code, Timer, Moon Phase, Air Quality,
  On This Day, Daily Quote, METAR/TAF, Clock, Date, News, Stocks, Travel Time, Sports,
  Text, Decoration, Upcoming, Today, Agenda, and finally Photo (see
  `WIDGET_ADVANCED_TYPES` for the current list). Calendar's own panel was also
  retrofitted with a shared "which calendars to show" content filter it was missing
  since it first shipped — see the hard-won-lessons entry above for how that gap was
  found. This was the developer's explicit multi-session goal ("I eventually want all of
  them... keep going down the list") — essentially complete now.

  **Explicitly paused (not skipped — deliberately deferred):** Tasks and Tasks
  Combined. Per the developer: hold off until Home Assistant's actual functionality has been
  tested against a real instance — Tasks/TasksCombined are Todoist-account-linked, the
  same "external account, needs a picker" shape as HA's entity picker, and he wants
  that pattern proven out for real before building more of it. Not a technical
  blocker, a sequencing choice — revisit once HA's been confirmed working. This is now
  the ONLY remaining widget-type gap.

  **Also found, deliberately NOT built yet — Text Color / Tile Background / Text
  Opacity overrides.** A shared feature (`w.textColor`/`w.textColor2`/
  `w.tileOpacity`/`w.textOpacity`) that applies to literally every widget type in the
  app, not just calendar-family ones — none of the 28 types with Live Editing parity
  so far have it. Real scope: custom + preset color swatches, a secondary-color
  toggle, two opacity sliders, multiplied across 28+ existing panels (and growing).
  Needs its own scoping conversation — how thoroughly to apply it, and to which types
  first — not a guess baked into whichever batch happens to be in progress when it's
  noticed.

1.56.0: shipped Home Assistant Tier 1 — a read-only `entitystatus` widget, single
entity per widget (see the top-of-file "under discussion" note above, now updated).
Base URL + Long-Lived Access Token live in settings, used server-side only
(`haRequest()`/`haRequestWith()` in server.js) — never sent to the display/browser,
same pattern as `weather_api_key`/`todoist_token`. Three endpoints: `/api/ha/test`
(accepts `?url=&token=` overrides so Test Connection checks what's typed, not what's
saved — same reasoning as the weather ZIP lookup's `?save=0`), `/api/ha/entities` (full
list, for the picker), `/api/ha/state/:entityId` (single entity, 10s-cached). Entity
picker in app.html is a real searchable list (modeled on `openEmojiPicker()`), not a
raw entity-ID text field. Addable from both app.html's Layout editor and display.html's
Live Editing add-widget palette (`WIDGET_DEFS`/`WIDGET_CATEGORIES`/
`buildNewWidgetDefaults()` in display.html got the matching entries, same as every
other widget type added there). Confirmed single-vs-multi-entity scope explicitly
before starting — see the "one entity per widget, or several?" exchange for the
`tasks`→`tasksCombined` precedent that decided it. Two real bugs found and fixed during
testing (Settings section missing from the accordion group map; the entity picker's
search input starved by a sibling's `width:100%` — see the hard-won-lessons entry
above for the second one, a real trap worth knowing about). Tested against a REAL local
mock Home Assistant server for the server-side logic (network access to npm isn't
available in this environment, so the actual server.js couldn't be booted — this was
the next-best rigor, not a shortcut), plus full display.html and app.html coverage —
47 checks total across all three pieces.

Still open: Home Assistant Tiers 3-4 and HA install documentation — see the
GCP-hosting-and-Home-Assistant-tiers note near the top of this file. (Tier 2 shipped
in 1.58.0 — see below.)

1.58.0: shipped Home Assistant Tier 2 — actual device control (toggle lights/
switches/fans, touch-adjust a thermostat, fire scenes/scripts), not just reading
state. Scoped explicitly before building: all three control types in one pass, "one
adaptive widget" (Entity Status itself becomes interactive based on the entity's
domain, not a separate new widget type — the read-only Tier 1 case is just what
happens for any domain not in the controllable set), and — genuinely revised mid-
conversation once the actual surfaces were understood — controls live in BOTH
`display.html` (Live Editing, and since nothing gates it to edit-mode-only, any
touch-capable display in normal mode too, same as chore/todo/shopping already work)
AND a brand-new "Home" tab in `hub.html` ("Family Hub"), which turned out to be the
actually-intended PRIMARY surface once its existence as a real, separate touch-first
PWA was discovered (not assumed) partway through scoping.

Server: `POST /api/ha/call-action` takes only `{entityId, action}` from the client —
the real HA service call (domain + service name) is decided by a small, fixed,
server-side whitelist, keyed off the action plus the entity's own domain (parsed
server-side from the entity id, never trusted from the request). This is
deliberately more conservative than proxying an arbitrary client-specified service
call — a bug or bad request can only ever trigger one of a few known-safe actions.
`/api/ha/state/:entityId` extended with climate attributes (target/current temp,
min/max, step), a true no-op for every non-climate entity. A successful action busts
that entity's 10s cache immediately rather than waiting out the window.

`display.html`: Entity Status renders a real toggle for light/switch/fan/
input_boolean, a +/- stepper for climate (respecting HA's OWN reported min/max/step,
not a guessed range), a trigger button for scene/script — reusing the exact
`data-interactive="1"` pattern chore/todo/shopping already use so these don't fight
Live Editing's tap-to-select. Everything else still falls back to Tier 1's original
read-only rendering, unchanged.

`hub.html`: new "Home" tab, off by default like To-Do/Shopping, full settings-
toggle/visibility/SSE wiring matching the existing three tabs. A searchable entity
picker (filtered to only controllable domains) adds to a small persisted list
(`smarthome_hub_entities`, a JSON array stored as an ordinary setting — no new table)
— confirmed the generic settings PUT endpoint already accepts arbitrary keys before
assuming this would work without a server change.

**A real bug found and fixed during testing, not assumed away**: `hub.html` had TWO
separate places deciding which tab to fall back to — the shared
`syncTabVisibilityAndFallback()` (for later settings changes) and a completely
separate one-time init IIFE that only runs on first page load. Only the first got
updated to include the new tab; the init-time one was missed entirely, so a FIRST
load with only Home enabled found nothing in its stale fallback list and wiped the
whole tab area — destroying the very tab that was actually on. See the hard-won-
lessons entry below.

Verified end-to-end, 56 checks: 24 against a real local mock Home Assistant server
(exercising the actual extracted server.js code — confirming the whitelist can't be
bypassed, bad temperatures rejected before any network call, trigger domains can't
be spoofed by the client), 16 on `display.html`'s interactive widget, 16 on the full
Family Hub flow (add → toggle → adjust → remove, including that the picker actually
filters correctly and that removal genuinely persists the right updated list, not
just looking right in the DOM).

1.21.1 (piazzahq-server): website content catch-up — the marketing/docs site
(`piazzahq-server/public/*.html`) hadn't kept pace with several rounds of recent
device-app work. Added a real "Live Editing" section to `index.html` (photo not
captured yet — the `<img>` has a working `onerror` fallback, drop a real screenshot
into `/assets/screenshots/live-editing.jpg` whenever one's ready, no code change
needed) and a full guide-card in `user-guide.html`; added Home Assistant to the setup
wizard's own step (see the device-app 1.56.x entries above) and documented it across
`guide.html`'s FAQ and `user-guide.html`'s Data Sources description; fixed a
pre-existing, HA-unrelated accuracy gap in `privacy.html` ("Stripe is the only third
party" was already incomplete given Todoist/weather providers); fixed the site's theme
count (claimed 22, actual is 21) and a harmless-but-invalid doubled `</section>` tag.
Full writeup in this repo's own `CHANGELOG.md` under 1.21.1.

Still open, not yet done: a proper design/content audit of `admin.html` itself (the
actual admin panel UI, ~1100 lines) — only checked it for stale widget/theme-count
references (found none), not reviewed more broadly for UX or copy issues the way the
public-facing marketing/docs pages were.

**One bug reported by the developer, investigated in two passes — the DATA was fine, the
DISPLAY was actually broken (fixed in 1.22.1):**
- ~~Automatic server backups aren't working~~ — **CORRECTED, then FIXED.** First
  pass confirmed the underlying backup DATA was fine the whole time — 7 real
  files, confirmed via production logs and a filesystem search
  (`sudo find / -iname "mothership-*.json"`), sitting exactly where the running
  process's `DATA_DIR` actually resolves to (`~/pi-calendar-server/data/backups`
  — the OLD, never-renamed folder path, since `piazzahq-server.service`'s
  `WorkingDirectory` still points there; a self-update swaps code in place, it
  doesn't rename its own containing folder). That first pass incorrectly closed
  this as "not a bug" — it stopped at confirming the data existed on disk and
  never actually checked the admin panel's OWN display code, which is where
  the developer's real, reported symptom ("backups aren't working," meaning: don't show up
  in the panel) was actually living. The developer's follow-up correction was right.
  - **Actual root cause, found in the second pass**: `admin.html`'s shared
    `api()` fetch helper returns `{ok, status, data}` — a wrapper, not the raw
    response. Every other function in the file correctly unwraps `.data` before
    using it. `loadBackupList()` was the one place that checked `.length`
    directly on the wrapper object itself (always `undefined` on a plain
    object), so it unconditionally showed "No automatic backups yet" no matter
    what the server actually returned — a pure display bug, confirmed to have
    nothing to do with the underlying data (which the first investigation
    pass had already correctly verified was fine).
  - Fixed to match the established `r.ok`/`r.data` pattern already used
    everywhere else in `admin.html`.
  - Verified with a genuine before/after test: a Playwright test against a
    mock server returning 3 real backups confirmed the fix renders them
    correctly (right count, right sizes, working download links) — then the
    IDENTICAL test was run against the OLD code (temporarily restored in an
    isolated copy) and confirmed to genuinely fail, crashing on a missing
    selector because the old code never rendered a table or any download
    links at all. Not assumed fixed — proven both ways.
  - Optional (not urgent) cleanup still available if the developer ever wants the
    on-disk folder to match the service name: stop the service, `mv
    ~/pi-calendar-server ~/piazzahq-server`, update `WorkingDirectory` in the
    unit file, `daemon-reload`, restart.
  - **Lesson**: confirming the underlying data/state is correct is necessary
    but not sufficient when a person reports something "isn't working" in a
    UI — the display layer consuming that correct data can have its own,
    completely separate bug. Don't stop investigating at the first layer that
    checks out; trace all the way to what the person actually sees.

**One bug reported by the developer, investigated, root cause found, and fixed (1.57.2):**
- ~~Photo widget stuck defaulting to a slideshow after picking a single photo~~ —
  **FIXED.** Root cause: the photo picker's thumbnails are plain `<button>`
  elements, and the settings panel's auto-save only listens for `input`/`change`
  bubbling — a button click fires neither, so the pick was stored in memory
  correctly but never actually saved until an unrelated field's real `change`
  event happened to piggyback it. See the hard-won-lessons entry above for the
  full mechanism and the five OTHER instances of the identical gap found and
  fixed during the same audit (text-color swatches ×2, text-color reset, HA
  entity picker, decoration quick-picks). Verified with 7 checks capturing the
  actual save payload after each interaction, not just that a function ran.
- ~~The "Control this screen" corner overlay starts populating multiple/duplicate QR
  codes when the screen changes~~ — **FIXED (1.57.3).** The original hypothesis was
  confirmed exactly: `renderQRCodes()` can genuinely get triggered from several
  places close together around a screen change (`applyInfoOverlay()` at boot, on an
  SSE push, on reconnect, on profile reassignment), and `qrcodejs`'s `QRCode`
  constructor APPENDS a freshly-drawn canvas into its target — it never clears
  existing content first. Each additional call stacked one more QR code instead of
  replacing the last one. Fixed with a one-line `el.innerHTML = ''` before drawing,
  making every call fully idempotent. Verified with a stub `QRCode` class
  faithfully replicating the real library's actual behavior — confirmed exactly one
  QR code survives three rapid calls, then confirmed the un-fixed code genuinely
  produces 3 stacked duplicates against the identical test, not just theoretically
  could.

~~**One feature request from the developer, not yet built:**~~ **SHIPPED (1.57.3).** A
`photoFullscreenBg` checkbox on the Photo widget, in both app.html's Editor and
display.html's own Live Editing — fills the display and sits behind every other
widget. Confirmed with the developer before building: it's a pure rendering-time override,
never touches the widget's own stored x/y/w/h/z — unchecking it restores the widget
to exactly where it was, no restore logic needed. Scope confirmed too: only
changes position/layering, not which photos show — the widget's existing photo-
selection settings (mode, tag, slideshow options) keep working exactly as
configured. Dragging/resizing are disabled while it's on, matching the existing
treatment of a locked widget (though it's a distinct field with its own badge, not
the same thing as being locked) — applied consistently everywhere position/z-order
gets decided: app.html's Editor canvas, its Fine-tune Position mini-map, and
display.html's `renderLayout()` plus its Live Editing selection/resize overlay.
19 checks across both files confirm the override applies correctly, the stored
fields genuinely stay untouched (checked directly), a real drag attempt has zero
effect on stored position, and unchecking restores the exact original position —
not assumed reversible, actually verified.

**GCP migration for `piazzahq-server` — plan written and tested, actual cloud
provisioning still to be done (the developer's own GCP Console/gcloud steps, not something doable
from this environment).** Mirrors kc46study.com's own setup (e2-micro, Debian,
Cloudflare Tunnel — confirmed directly rather than assumed) since that's already a
pattern the developer trusts. Two new files in the `piazzahq-server` repo:
- `deploy-gcp.sh` — run on the fresh VM; installs Node 20+, project dependencies (pure
  JS, no native modules, so no build toolchain needed), sets up
  `piazzahq-server.service` (mirrors `piazzahq.service`'s own systemd
  conventions — same idempotent diff-before-overwrite pattern, `Restart=always`), and
  installs `cloudflared`. Deliberately REFUSES to start the server at all if `.env`
  isn't already in place (never auto-generates one with broken/placeholder secrets) —
  same reasoning applies to `data/`/`releases/`/`feedback-images/`, which must be
  migrated by hand, never silently created empty on what looks like a successful
  deploy. The non-privileged logic (project-directory detection, Node version
  comparison, unit-file rendering, the `.env` gate, the diff-before-overwrite check)
  was extracted and tested against real filesystem fixtures — 16 checks — since the
  actual privileged parts (apt/sudo/systemctl) can't be exercised without a real VM.
- `MIGRATION.md` — the full runbook for the parts that can't be scripted: creating the
  VM itself, migrating secrets/data from the old Mac via `gcloud compute scp`, the
  Cloudflare Tunnel setup (needs an interactive browser OAuth login, genuinely can't be
  automated), a verification checklist before cutover, and a rollback plan (DNS is the
  fast lever back). Confirmed against the actual code rather than assumed: the real
  device check-in endpoint (`GET /api/v1/update-check`) and the real Stripe webhook
  path (`/api/stripe/webhook`) — an earlier draft had a made-up endpoint name for the
  former, caught and fixed before shipping this doc, not after.

**TOP PRIORITY, per the developer: rename the old `pi-calendar`/`pi-calendar-server` codenames to
`piazzahq`/`piazzahq-server` before any real customers exist** — deliberately timed
now, specifically BECAUSE there's no installed base yet to migrate; this becomes much
harder once customer Pis are running a `pi-calendar.service` in the field.

**Status: DONE in both repos, code-side.** Only packaging/verification of the actual
zip artifacts remains (see below) — every functional file in both repos has been
renamed and independently syntax/logic-verified, not just search-replaced and
assumed correct.

Naming convention: literal string `pi-calendar` → `piazzahq` everywhere, which cleanly
cascaded (`pi-calendar-server` → `piazzahq-server`, `pi-calendar.service` →
`piazzahq.service`, etc.) — one consistent substitution rule, not two separate ones,
since `pi-calendar-server` contains `pi-calendar` as a literal substring already.

**`piazzahq-server` (this repo) — done and verified:** `server.js` (the actual
zip-validation logic, both for accepting device-app releases AND self-updates —
this is the part that means a newly-packaged `piazzahq-server` zip will actually be
ACCEPTED now, not hit the same "Inspect failed" error from earlier this session for
the opposite reason), `store.js` (no references existed), `package.json`,
`build-mac.sh`/`BUILD-MAC.md` (including the PascalCase `PiCalendarServer` →
`PiazzaHQServer` executable name), `deploy-gcp.sh`/`MIGRATION.md`, `README.md`,
`CHANGELOG.md` (1.22.0 entry), this file, and every website doc
(`public/admin.html`, `public/bootstrap-install.sh` — the actual customer-facing
installer script, verified line-by-line — `public/guide.html`,
`public/troubleshooting.html`).

**`piazzahq` (device-app repo) — also done and verified.** This repo's own
`server.js` turned out to be the single highest-risk file across the WHOLE rename,
not just this repo's — real application logic, not just strings:
`SERVER_INSTALL_DIR` (the Guided Central-Server Install feature's target directory),
the nested-folder check for uploaded device-app update zips, the nested-folder check
for uploaded central-server zips (confirmed to match what `piazzahq-server`'s own
`server.js` actually produces — these two had to agree with each other, checked
directly rather than assumed), the generated systemd unit filename and every
copy-paste `systemctl`/`cp` command the Guided Install flow hands back to the
operator, the backup folder-naming convention, and — easy to miss, a completely
separate code path — the host-to-slave "push update" builder
(`buildSelfUpdateZip()`), whose staged folder name has to match whatever the
RECEIVING slave's own validation logic expects, or the host-to-slave push feature
would have silently broken for anyone using it. Also done: `package.json`,
`install.sh` (re-read after the rename, not just syntax-checked, given real
customers run this script), the three `scripts/*.service`/`*.sh` files
(`rotation-watchdog.service` had an actual hardcoded example username, `jlauty` —
only the folder path was renamed, the username left untouched as an unrelated
personal detail), `public/app.html`, `README.md`, `REMOTE_ACCESS.md`,
`CHANGELOG.md` (1.57.0 entry), outbound `User-Agent` HTTP headers
(`PiCalendar/1.0` → `PiazzaHQ/1.0` and variants). Also found during this pass: "Pi
Calendar" (space-separated, not hyphenated) still appeared in
`rotation-watchdog.service`'s `Description=` line — a genuinely different string
pattern the earlier hyphenated searches wouldn't have caught, found by a deliberate
separate search, not assumed covered.

Two real mistakes were made and caught mid-edit, both on `piazzahq-server`'s own
`server.js` during the first half of this work: validation logic got accidentally
deleted twice while trying to rename a single line inside a larger function (a
`str_replace` context-boundary mistake, not a rename mistake) — both caught
immediately via `node -c` + a before/after line-count comparison and fully restored
before moving on. That experience directly shaped a more careful line-targeted
approach (`sed` with explicit line numbers, or very tightly-scoped `str_replace`
calls) for the rest of the rename, verifying syntax AND line count after every
single edit rather than batching several together — no further mistakes of that
kind happened in the device-app repo's `server.js`, despite it having even more
surface area than the central server's.

Verified across both repos: zero `pi-calendar`/`PiCalendar` references remain
anywhere in functional files (confirmed by repo-wide greps, not spot-checked),
`node -c server.js` passes for both, every touched shell script passes `bash -n`,
every touched HTML file's script blocks pass a syntax check, both `package.json`
files still valid JSON.

**Deliberately NOT done: nothing in either repo talks to any EXISTING running
install.** The developer's own current device (and his own currently-running
`pi-calendar-server`, pending the separate GCP migration) stay on the old naming for
now, by his own explicit choice — he'll migrate manually (or via a future script)
when ready, rather than this rename trying to auto-migrate a live device. Practical
effect: the developer's own device's automatic "Settings → Software Update" will stop finding
anything to apply once new zips ship under the new folder name, since it's still
looking for `pi-calendar/server.js` inside a downloaded zip — not an error, a quiet
no-op, and the expected tradeoff of deliberately not building backward-compatible
dual-name detection for a problem that isn't needed yet (no other customers exist).

**Packaging: done.** All three on-disk folders renamed (`update/piazzahq`,
`install/piazzahq`, `server/piazzahq-server`), all three zips built and verified —
including running the ACTUAL extracted validation logic from the packaged
`server.js` against the ACTUAL packaged zips (not just checking that folder names
matched), confirming both device-app zips and the server zip would genuinely be
accepted.

**A real bootstrapping gotcha, discovered when the developer actually tried uploading the
renamed server zip and hit "Inspect failed: server.js/store.js missing" — again, but
for the opposite reason this time.** The developer's own currently-running `piazzahq-server`
instance is still running the OLD, pre-rename code (Option A from earlier — his
instance was deliberately left alone). The OLD code's validation logic checks for a
`pi-calendar-server/server.js` folder inside an uploaded zip. The newly-packaged
`piazzahq-server-update.zip` has a `piazzahq-server/` folder instead, since that's
what the NEW code expects — so the OLD, still-running code correctly (from its own
perspective) rejects it. Classic chicken-and-egg: the only way to get the new
folder-naming recognized is to first get the new code running, but the currently-
running code only accepts zips shaped the old way.

**Resolved with a one-time bridge zip**: the new v1.22.0 code, packaged inside a
folder still named `pi-calendar-server` (not `piazzahq-server`) specifically so the
CURRENTLY-RUNNING old code accepts it. Verified against the actual old validation
logic before handing it over (not assumed): confirmed the old check passes, AND
separately confirmed the code inside is genuinely the new version and genuinely
expects `piazzahq-server` naming for everything after this one upload — so this
bridge only needs to exist once, not become an ongoing dual-naming shim. Delivered
as `piazzahq-server-BRIDGE-update.zip`, clearly labeled as a one-time special case;
every update after this one uses the regular `piazzahq-server-update.zip` naming,
since by then the running code will be the new code.

**Lesson for next time a repo gets renamed while a live (even if
customer-count-of-one) instance exists**: the OLD code's acceptance criteria matter
just as much as the NEW code's — a rename needs a bridge artifact shaped for
whatever's ACTUALLY currently running, not just a final-state package that assumes
the receiving end already understands the new shape.

**The exact same problem, discovered a second time on the DEVICE side.** After the
server-side bridge zip fixed the central server, the developer's device app (still
intentionally on old, un-renamed code — same Option A) tried its normal automatic
"Update" flow and got a generic "❌ Update failed — tap to check Settings for
details" banner. Real diagnostic trail worth recording, not just the fix:
- The error text itself comes from `app.html`'s `installUpdateFromBanner()`, not the
  central server's admin panel at all — a completely different code path than the
  one just fixed. Worth checking WHICH surface an error is actually coming from
  before assuming it's the same bug in a new place.
- `journalctl -u pi-calendar` showed nothing related — traced to `fetchUpdateInfo()`
  never logging on failure, it just rejects a promise that becomes a JSON error
  response. A dead end that cost real time before being ruled out; logs aren't
  guaranteed to cover a failure just because a service crashed elsewhere in that
  same request's history.
- `curl`'d the actual `/api/v1/update-check` endpoint directly from the Pi to see
  the raw response instead of guessing — confirmed `updateAvailable: true`,
  `latestVersion: "1.57.0"`, and a `downloadUrl`. Noticed a real (separate, minor)
  bug in passing: the URL came back as `https://Piazzahq.com/...` — capitalized,
  from the developer's own `.env`'s `PUBLIC_BASE_URL` value, not from anything in this
  session's code. Domain names are case-insensitive for DNS/HTTP, so this almost
  certainly isn't what broke the update, but still worth the developer fixing in his `.env`
  for tidiness — not something to silently normalize in code, since `.env` is
  explicitly never touched by any update/deploy tooling.
- `curl`'d the actual `downloadUrl` too, rather than assume it worked — confirmed
  HTTP 200, correct byte count matching what update-check reported, and a valid
  zip with the expected `piazzahq/` top-level folder. This ruled out the download
  step entirely and pointed straight at `installFromZip()` on the RECEIVING
  (still-old) device code as the actual failure point — the identical
  chicken-and-egg shape as the server-side bug, just one level down: old code
  looks for `pi-calendar/` inside the zip, new zip has `piazzahq/`, old code falls
  through to checking the zip's flat root for `server.js`, doesn't find it there
  either, fails.
- **Resolved the same way**: a one-time bridge zip, new v1.57.0 code wrapped in a
  folder still named `pi-calendar` (not `piazzahq`), verified against the
  reconstructed old validation logic before handing it over — confirmed the old
  check passes, confirmed the code inside is genuinely 1.57.0, confirmed it
  expects `piazzahq` naming for everything after. Delivered as
  `piazzahq-DEVICE-BRIDGE-update.zip`, applied via the device's "Advanced: install
  a zip manually" fallback (Settings → Software Update) since the automatic
  "Update" button only knows how to fetch from the server, not accept a
  hand-delivered file — the manual upload path was the only way to get a bridge
  zip onto an old-code device at all.
- Also confirmed no SHA256 or other hash-verification step exists in
  `installFromZip()`'s path — the bridge zip's different byte layout (old wrapper
  folder name) couldn't have tripped up a hash check that doesn't exist, but this
  was verified rather than assumed given how much else in this saga turned out to
  need direct confirmation instead of inference.

**Broader lesson, confirmed not twice but THREE times in one afternoon — the third
one discovered live, not anticipated in advance.** After the host device's bridge
zip succeeded, its own logs showed a THIRD instance of the identical problem,
completely unprompted: `Push: failed for Mirror (100.118.107.40:3000): HTTP 400`.
**the developer has a second device** — a slave display named "Mirror," reachable over
Tailscale — that this session had no prior knowledge of. The host's own
`pushUpdateToSlaves()` (calling the same renamed `buildSelfUpdateZip()` from
earlier in this saga) automatically tried to push its update to Mirror the moment
it came back up — and Mirror, still on old code, rejected it for the exact same
`piazzahq/`-vs-`pi-calendar/` reason as everything else in this saga. Traced by
reading `pushUpdateToSlaves()`'s actual source rather than assumed from the HTTP
400 alone — confirmed it really does call the same `/api/update` endpoint on the
slave with the same zip shape.

**Resolved the same way a third time, with one genuine convenience**: since Mirror
is reachable over Tailscale from the host, the exact same
`piazzahq-DEVICE-BRIDGE-update.zip` could be pushed to it directly from the host's
own SSH session (`curl -F "package=@..." http://100.118.107.40:3000/api/update`)
— no separate SSH access to Mirror itself ever needed. Verified with the same
rigor as the host: waited for the restart, confirmed `{"version":"1.57.0"}` via a
direct API call (an initial silent+short-timeout check came back empty and looked
concerning, but a slower, non-silent retry showed a clean `HTTP 200` — the empty
result was just an early check racing the restart, not a real failure; worth
retrying with visible errors before concluding something's actually wrong).

**Final state, fully confirmed in production, not just in a packaged zip**: central
server v1.22.0 (host Pi, `piazzahq-server.service`), host device v1.57.0
(`pi-calendar.service` — still the old SERVICE NAME by choice, Option A, but
running fully-renamed CODE), slave device "Mirror" v1.57.0. All three verified via
direct API/version checks and clean systemd restart logs, not assumed from a
successful-looking upload response alone. The rename saga that started as "sounds
like a big ask, better to do now" is genuinely complete end to end — code, central
server, and every currently-known device.

Check git log / CHANGELOG.md in both repos for what's actually shipped vs. still pending
beyond this — this list is not guaranteed current by the time you're reading it; the git
history is the source of truth, this paragraph is just a pointer to go check it.

---

## Session update: HA auto-detection, found while actually setting up a real instance

The developer set up a real Home Assistant instance for the first time this session (Docker on
`raspberrypical`, reached over Tailscale while away from the Pi) specifically to
live-verify the Tier 2/4 work from earlier in this same overall session. Two real
issues came up during that setup, both resolved:
- First `docker run` silently failed to create the container (likely a transient
  network hiccup mid-pull) — rerunning it worked cleanly.
- HA's `http` component lost a one-time bind race for port 8123 on first boot
  (`address in use`, then the port was free moments later on inspection) — the
  component doesn't retry within a boot, so the container stayed "Up" while the actual
  web server never came alive. A plain `docker restart` won the race the second time.

That hands-on setup surfaced a real quality-of-life gap: manual entry of the
instance's URL assumes you already know it, which isn't a given (the developer didn't, having
just stood the instance up fresh on a Tailscale address he had to look up separately).
**Shipped in v1.60.0**: a "Detect automatically" button (`GET /api/ha/discover`)
that probes this machine itself, `homeassistant.local`, this machine's own LAN
subnet, and — if the `tailscale` CLI is present — its Tailscale peers, confirming
matches via HA's unauthenticated `/manifest.json`. Plus a one-tap deep link straight
to `<instance>/profile/security` once a URL is known, next to the existing written
instructions (kept, not replaced). Detected Tailscale-range results are flagged with
a note that HA's login page can reject Tailscale-only origins — a real thing observed
this session, not a hypothetical.

**Not yet live-verified**: like the Tier 4 work earlier this session, this was built
and syntax-checked but not run against a real network — this sandbox still has no
network access. The actual HA instance the developer stood up this session (on `raspberrypical`,
via Tailscale) is the natural place to verify Detect actually finds it.

---

## Session update: HA Tier 4, and a documentation-staleness finding

**HA Tier 4 shipped (pending live verification) — v1.59.0.** Multi-entity dashboard,
built on both surfaces Tier 2 already touched rather than picking just one: a new
`display.html` widget type ("Smart Home Dashboard," grid of entities with optional
room grouping) and a reworked Family Hub Home tab (Favorites + Rooms, replacing the
old flat entity-id-string list with `{id, room, favorite}` objects, normalized for
backward compatibility). Both share the same control-rendering code Tier 2 built,
factored out into `renderHaEntityControl()` in `display.html` rather than duplicated.
Tier 3 (presence-aware Ambient Mode) was explicitly skipped this round, per direction
— still open, still unscoped.

**Important caveat, stated plainly rather than glossed over**: this was built and
syntax-checked (`node --check` on every touched file's script block, all clean) and
reviewed against the existing Tier 2 code, but NOT live-tested against a real Home
Assistant instance — the sandbox this was built in has no network access. Every prior
HA milestone in this file describes a real end-to-end verification pass (Tier 2's was
56 checks against a mock HA server); this one doesn't have that yet. Treat v1.59.0 as
"believed correct, not yet proven" until it's actually run against a live instance.

**Also found while scoping this session, worth flagging**: the "universal Text
Color / Tile Background / Text Opacity" feature — flagged in this same file's Open
Items list, and in a 1.56.5 CHANGELOG entry, as "needs its own scoping conversation,
not yet built" — turned out to already be fully implemented and working in the
current codebase (`w.textColor`/`w.textColor2`/`w.tileOpacity`/`w.textOpacity`/
`w.fontFamily`, global default + per-widget override, applied universally in
`display.html`'s render loop for every widget type). It shipped at some point without
a CHANGELOG or HANDOFF entry recording it — the same kind of bookkeeping gap this file
itself warns about in its closing paragraph below. Confirmed real (not just present in
code but genuinely wired end-to-end) before treating it as done; per direction, no
further work was done on it beyond that confirmation. One real gap remains if it's
ever revisited: "Tile Background" is opacity-only of one fixed dark color, not an
actual color picker — and unlike Text Color, Tile Opacity and Text Opacity have no
Settings-level global default, only a per-widget fallback to off/100%.

**Done as of v1.63.0** (was deferred earlier this session): per-widget font size caps
raised across 25 widgets — roughly doubled for the calendar-family/list widgets that
were capped lowest (news, upcoming/today/agenda/tasksCombined, minical,
onthisday/sports/metar), similar-sized bumps elsewhere. `text`/`decoration`/`clock`
were already generous and left alone. Only `fontMax` changed, not defaults/min/step,
so this is purely "more headroom available," not a visual change for anyone who
hasn't already maxed a widget out. Not tested against every widget-size/font-size
combination for clipping/overflow at the extremes — worth keeping an eye out for that
in practice rather than assuming it's fully verified.

---

## Session update: security scan + fixes (v1.60.1)

A code scan across both repos surfaced two real security gaps and one stale TODO,
fixed this session: `/api/update` and `/api/install-server` (arbitrary-zip-upload
endpoints) were fully reachable with no auth at all on any device that never had a
PIN set — now gated unconditionally via a new `ALWAYS_AUTH_ROUTES` check ahead of the
normal no-PIN-means-open bypass. `/api/auth/login` had zero rate limiting against PIN
guessing — added the same 5-attempts/15-minute-lockout pattern `piazzahq-server`'s
admin login already used. Also rewrote a stale `TODO(before public launch)` on
`/api/update` — its paired UI doesn't exist in `app.html` anymore, but the route's
still a real working fallback, so removal is now a real decision to make rather than
an unresolved leftover. A spot-check of the ~50 bare `catch {}` blocks across
`server.js`/`app.html` turned up nothing concerning — all legitimate best-effort
operations, no changes needed there.

---

## Session update: voice control via Siri Shortcuts (v1.61.0)

Shipped the long-lived-token version of voice control discussed this session — not
just a feasibility writeup, the actual thing. New Settings → Voice Control section:
generate/regenerate/revoke a server-generated bearer token, with the exact Shortcuts-
app setup steps shown inline once a token exists (Ask for Input → Get Contents of URL
→ POST to `/api/voice/add-item` with the token as an `Authorization: Bearer` header —
uses `window.location.origin` for the URL so instructions are always correct for
whatever address the person's actually viewing the app from, LAN or Tailscale alike).

Server side: the new route is deliberately narrow — add-item only, nothing else —
even though it bypasses the PIN entirely, so a leaked token is a much smaller problem
than a leaked session would be. Exempted from `requireAuth`'s PIN check by an exact
`POST /api/voice/add-item` route match (not a wildcard), then gates itself with its
own `timingSafeEqual` bearer-token check; rejects everything outright if no token's
been generated yet. `list` in the request body defaults to the shopping list,
otherwise case-insensitively matches an existing To-Do list name — an unrecognized
name is a real 404, not a silent wrong-list fallback.

Not yet live-tested (no network access in this sandbox, same caveat as the HA work
earlier this session) — the real test is building an actual Shortcut against a real
deployed instance and saying the trigger phrase out loud.

Alexa/Google Assistant equivalents were discussed but explicitly not pursued this
round — materially bigger lift (a public webhook, a separate developer-console skill
registration), treated as its own future question if wanted.

---

## Session update: Alexa skill (v1.62.0), Google Assistant ruled out

Built the Alexa half of "the bigger expansion" flagged at the end of the Siri work.
Refactored `addVoiceItem()` out of the Siri route so both voice surfaces share one
"where does this item go" implementation. New `POST /api/alexa`, built on the
official `ask-sdk-core`/`ask-sdk-express-adapter` rather than hand-written signature
verification — deliberately not reinventing cryptographic request validation from
scratch. Needs `ALEXA_SKILL_ID` in `.env` once the skill exists in the Alexa
Developer Console. New deps are required lazily (try/catch) so a device that hasn't
run `npm install` yet gets a clean 503 on that one route instead of failing to boot.

**Real gotcha caught during the build, not left for the developer to discover**: the global
`express.json()` parser would have consumed the Alexa request's raw body before
signature verification ever saw it — verification needs the exact raw bytes Alexa
sent. Fixed by skipping JSON parsing specifically for `/api/alexa`, same principle as
`piazzahq-server`'s own Stripe webhook handling.

**Real infrastructure prerequisite, not just code**: Alexa requires a publicly
reachable HTTPS endpoint with a trusted-CA cert — Tailscale-only reachability (how
the device app is normally accessed) doesn't satisfy that. The developer agreed to set up a
narrow Cloudflare Tunnel on the Pi scoped to just `/api/alexa`, separate from
`piazzahq-server`'s own tunnel (different repo, different machine's public exposure)
— not yet done as of this entry; needs its own domain/subdomain decision and the
actual tunnel setup, same shape as the GCP migration's Cloudflare Tunnel steps
earlier this session but for the device app instead of the central server.

**Google Assistant/Gemini investigated and ruled out**, not just skipped without
looking: Conversational Actions (the old custom-voice-command system) was sunset in
2023 with nothing equivalent for self-hosted use since — current developer surface is
Smart Home API only, shaped for device control (lights/thermostats), not arbitrary
text actions. Google Assistant itself is also being retired in favor of Gemini
starting September 2026. Not revisited unless Google opens a genuinely equivalent
path in the future.

Not yet live-tested — same caveat as every other voice/HA feature this session, no
network access in this sandbox. The real test needs the Cloudflare Tunnel actually
set up, a skill actually created in the Alexa Developer Console with the interaction
model pasted in, and a real Echo device.

---

## Session update: 3 new analog clock faces (v1.64.0)

The developer asked for ways to make the analog clock "more beautiful" — built a live HTML
preview (4 options, actually ticking) as an artifact first so he could compare
visually before any real code got written, rather than describing options in prose.
He picked "build all of them in" rather than choosing just one.

Shipped as a new "Face" dropdown (Minimalist Line / Aviation Chronograph / Warm
Brass / Bold Modern) alongside the existing Style dropdown, in both `app.html`'s
full editor and `display.html`'s own on-screen quick settings. Original analog
behavior is exactly "Minimalist Line" now — zero visual change for existing analog
clocks unless someone actively picks a different Face. Aviation and Brass use fixed
palettes (meant to look like specific physical objects, not themed UI elements);
Bold Modern follows the widget's own text/accent color settings instead, since that
one reads as a treatment of the display's own theme rather than a distinct object.

The existing per-second hand-rotation code needed zero changes — all four faces
share the same `.hand-hour`/`.hand-minute`/`.hand-second` class names, so the
already-existing "update in place via CSS custom property" logic just applies
uniformly across all of them.

Not yet seen on a real device — built and both syntax- and CSS-brace-checked clean,
but the real test is opening it on the actual wall display and seeing how each face
actually reads at real viewing distance/size.

---

## Session update: Family Hub tab restructure (v1.65.0)

Chores/To-Dos/Shopping collapsed into subtabs under one "Home" tab, out of a flat
4-tab bar. Caught a real naming collision before building anything: the smart-home/HA
tab was already labeled "Home" (from the Tier 2 work earlier this session) — flagged
it rather than silently building two tabs with the same name. Discussed "Home Hub" as
an option; pushed back since it's redundant with "the Family Hub" as the app's own
name and close enough to "Home" to misread at a glance. Landed on renaming the
existing HA tab to **"Smart Home"** instead, keeping "Home" for the new umbrella tab.

Two-level fallback logic was the real complexity here, not the HTML restructure
itself: subtab-level fallback (switch subtabs, stay in Home) is now separate from
top-level fallback (leave Home for Smart Home, or the other way, or the "nothing
enabled" message) — previously this was all one flat level. `lastEnabledState` is now
cached at module scope (refreshed by `applyFeatureVisibility()`) specifically so the
Home tab-button's own click handler can pick the right subtab without needing its own
API round-trip first.

No settings schema changes — `chores_enabled`/`todo_enabled`/`shopping_enabled`/
`smarthome_enabled` mean exactly what they did before; this is purely navigation.
Verified every `$('id')` reference in the file resolves to a real element (one
false-positive flagged and confirmed: `sh-edit-sheet` is created dynamically via JS,
not static HTML, from the earlier Smart Home room-edit work).

---

## Session update: Siri Shortcuts instructions rewrite, real bug found (v1.65.1)

The developer actually followed the Voice Control setup instructions and sent a screenshot of
the result — surfaced two real mistakes that were the instructions' fault, not user
error. The old text described the Authorization header and the JSON body as single
combined strings ("Authorization = Bearer...", a whole `{"text": ..., "list": ...}`
blob), but Shortcuts' real UI has separate Key/Value box pairs for each header and
each body field. Following the old wording literally produced a header with the
token pasted into the Key box, and a body with the entire JSON string crammed into
one Value box — both broken, both directly traceable to how the instructions were
worded, not to anything the developer did wrong.

Rewritten as 9 explicit, one-action-at-a-time numbered steps, with Key/Value spelled
out separately everywhere Shortcuts actually has separate boxes, and an explicit
callout that "Provided Input" needs to go in as a real variable chip (via the
variable picker) rather than typed text — typing it literally sends the words
"Provided Input" instead of whatever the person actually said, which wouldn't have
been obvious from the old instructions either. Added a test-before-you-wire-it-up
step (the ▶ play button in Shortcuts) so a broken setup gets caught immediately
rather than discovered later as a confusing Siri failure.

Also: removed the "Ask Claude for the walkthrough" line from the Alexa mention
underneath, per direction — Alexa is still mentioned as an option, just without
pointing at an AI assistant to explain it. And bumped padding on the token
input/button rows, which felt cramped.

**Lesson for next time a setup flow gets written for an external app's UI (Shortcuts,
Alexa console, anything neither of us can click through in this sandbox)**: describe
literally what boxes/fields will appear, not a shorthand notation like "Key = Value"
that assumes the reader already knows the target UI's actual layout.

---

## Session update: simplified the mechanism instead of the instructions (v1.66.0)

The 9-step instruction rewrite above still didn't work in practice — the developer reported the
variable picker didn't offer "Provided Input" at all, a different problem than the
header/body mix-up the rewrite had targeted. Rather than keep iterating on
instructions for an inherently fiddly multi-panel flow (Headers panel + separate JSON
Body panel, each with their own Key/Value rows), changed what the Shortcut actually
needs to do: `/api/voice/add-item` now accepts everything as URL query parameters via
GET, not just the header+JSON-body POST. One field to build (the URL, with the token
already filled in), one variable inserted inline at the very end — Method/Headers/
Body panels don't need to be touched at all anymore.

**Real lesson worth keeping**: when the same category of confusion survives a
documentation rewrite, that's a signal the *mechanism* is the problem, not the
wording — a second rewrite of instructions for something inherently fiddly is often
a worse use of effort than making the fiddly thing simpler or removing it. Checked
(not assumed) that no request-logging middleware would write the now-more-sensitive
token-bearing URL to a persistent log file before shipping this.

Old POST+Headers+JSON-body method still works unchanged, for anyone who already built
a Shortcut that way or would rather keep the token out of a URL.

---

## Session update: Siri Shortcuts CONFIRMED WORKING END-TO-END (v1.66.1)

First real proof this whole voice-control feature actually works — the developer built the
Shortcut following the v1.66.0 instructions, hit a real bug (multi-word items
silently truncated at the first space — Shortcuts inserts a variable into a URL as
raw unencoded text), we diagnosed it live via a "Show Result" action inserted as a
temporary diagnostic step (isolated exactly what Shortcuts was capturing, before it
ever touched the URL — confirmed the value itself was right and the URL-insertion
step was where it broke), fixed it with a "Replace Text" (space→%20) action, and
confirmed a real item landed in the real shopping list.

Also hit, and fixed same-session: saying a natural full sentence ("add bananas to
the shopping list") added the whole sentence as the item, not just "bananas" — no
extraction logic existed at all before this. New `extractItemFromSpokenPhrase()`
strips common command phrasing (leading "add/put/throw", trailing "to/on the ___
list", stray "please") before storing, shared by both Siri and Alexa through
`addVoiceItem()`. Verified against 8 realistic phrasings via a standalone Node test
before shipping — caught a real ordering bug in the process (trailing "please" after
"list" broke the list-phrase regex's end-anchor until the please-strip was moved
earlier in the pipeline).

**Real, hard-won lesson from this whole arc**: the developer pointed out AnyList has a literal
one-tap "Add to Siri" button with none of this complexity — worth being honest about
why, rather than pretending Shortcuts could ever match that. AnyList is a native
compiled iOS app using Apple's App Intents/SiriKit framework, which only exists for
apps distributed through the App Store. A self-hosted web app talking to Siri through
the generic Shortcuts automation tool is structurally a different, fundamentally more
fiddly thing — there's no version of this that gets to AnyList's UX without actually
shipping a native iOS app, a materially bigger undertaking than anything reasonable
here. The instructions are now as good as they're going to get for this mechanism;
future confusion reports should assume the person's follow-through, not the
instructions, unless a new specific failure mode turns up (in which case: fix the
instructions once, and if the SAME category of confusion persists after that, the
right move is changing the mechanism, not writing a third version of the same
instructions — that's exactly what happened between v1.65.1 and v1.66.0).

---

## Session update: main app tab consolidation + scroll-hide header (v1.67.0)

The developer initially asked about "the Home Hub tab with sub-tabs" — turned out he meant the
*main app* (`app.html`), not the Family Hub app (`hub.html`) where that restructure
actually happened (v1.65.0). Worth flagging the naming confusion risk this created:
the main app is casually called "the app" and the Family Hub app is casually called
"the Hub" or "Family Hub," but a phrase like "Home Hub" could plausibly point at
either — clarified with a direct question before touching anything, rather than
guessing which file.

Applied the same consolidation pattern to `app.html` that already existed in
`hub.html`: Chores/To-Do/Shopping (3 top-level tabs) collapsed into one **"Family
Hub"** tab with subtabs — deliberately named "Family Hub," not "Home," avoiding the
exact naming collision that came up building the Hub's own version of this. 8 top
tabs down to 6.

Implementation note worth remembering: `renderChoresTab()`/`renderTodoTab()`/
`renderShoppingTab()` each fully replace `#content`'s innerHTML themselves (always
have) — rather than refactor three large existing functions to render into a
sub-container, the subtab bar gets prepended via `insertAdjacentHTML('afterbegin',
...)` immediately after whichever one runs. Lower-risk, and means those three
functions needed zero internal changes.

Also added: header (nav + tab row) hides on scroll-down, reappears on scroll-up,
using a `max-height` collapse (not `transform`) so `#content` actually reflows
upward into the reclaimed space rather than leaving a visual gap — and reduced
header padding/font sizes throughout for a more compact default. Verified: CSS brace
balance, every `$('id')` reference resolves to a real element (3 pre-existing
false-positives confirmed unrelated — dynamically-created overlays same as
`ha-entity-picker` from earlier this session), and no stray references to the old
`tab-chores`/`tab-todo`/`tab-shopping` IDs anywhere in the file.

---

## Session update: Shopping Mode (v1.68.0)

The developer referenced AnyList's item-by-item shopping walkthrough ("go to the next item on
the list or skip it while staying in the app"). Scoped before building: confirmed
Family Hub (not the main phone app) and confirmed the exact interaction (Next/Skip +
a Check Off button, not just browsing) via two quick questions rather than guessing
at a 3-button design.

Real design decision worth remembering: Back/Skip are a stable-snapshot-plus-index
navigation, not a shift/splice queue — a splice-based "remove as you resolve it"
approach would make Back meaningless once you'd skipped past something, since the
item would already be gone from the queue. Snapshot-plus-index means Back always
works, and the underlying list is genuinely untouched by Back/Skip — only Check Off
calls the API at all.

Check Off advances the UI immediately rather than waiting on the PUT request to
resolve, so a slow/dropped connection doesn't stall someone mid-shopping-trip — the
real list gets reconciled when Shopping Mode closes (`loadShoppingList()` re-fetches
true state regardless of whether every individual check-off actually landed).

---

## Session update: "Add a Display" feature (v1.69.0), device app half

Real UX bug found while scoping this: the Devices tab's empty state literally said
"Open the display on a Pi and it'll appear here" — but the mechanism (a shareable
profile URL) has never actually been Pi-specific; any browser registers identically.
The copy itself was teaching the wrong mental model. Fixed, and built the feature
The developer actually wanted: a persistent "Add a Display" card in the Devices tab with a QR
code + copyable URL per profile, so adding an old tablet, a Fire Stick's browser, or
a spare monitor is now a real discoverable flow instead of something only findable
by digging into the Layout tab's Profiles list.

Tailscale requirement made explicit rather than assumed, per direction — new
`GET /api/tailscale-status` detects (doesn't assume) whether Tailscale is actually
running on the server via the same `tailscale` CLI pattern as the HA-discovery
Tailscale-peer lookup from earlier this session, just querying "Self" this time
instead of "Peer". If detected, the generated URL uses the Pi's own Tailscale IP —
works regardless of what network the new device is actually on. If not detected, an
honest amber warning instead of a URL that silently only works on the same Wi-Fi.

Reused the QRCode library already loaded for the QR Code widget and the Family Hub
install prompt — no new dependency needed.

**Update**: the marketing-site half (`piazzahq-server` v1.22.3) is done too — see that
repo's own HANDOFF.md. Both halves of "Add a Display" are complete.

---

## Session update: setup-splash QR code, host-conflict UI, a real Finish-button bug (v1.70.0)

Three separate things, worth logging together since they landed in the same package:

**Setup-splash QR code**: added to the "Let's get set up" full-screen overlay, same
`qrcodejs`/`.qr-container` convention as the existing corner info-overlay and QR Code
widget — picked up by the already-existing `renderQRCodes()` pass, no separate
rendering path needed.

**Host-registration conflict, now a real choice instead of "Registration failed"**:
traced the actual mechanism first rather than guessing at a fix — the central
server's `/api/trial/signup` never actually rejected a duplicate email at all
(silently returned the same existing license key either way); the only place a
second-host conflict was ever detected was later, via the periodic check-in's
`checkHostStatus()`, non-blocking, surfaced through the existing Settings host-
conflict modal. That meant a NEW device's first-run wizard had no way to catch this
at registration time — whatever "Registration failed" the developer saw was something else
entirely (never fully identified; superseded by building real detection instead of
chasing that specific message).

Real fix spans both repos: central server now detects a genuine conflict (a
DIFFERENT device already recognized as host for that email) at registration time and
returns a structured 409, not just at check-in time. Device sends its own stable
device ID with the registration request specifically so the server can tell "a
different device already claims this" apart from "same device re-running setup." App
side shows an actual choice card — Mirror instead, or a different email — rather than
a bare error string. Requires both halves deployed together; an older central server
just falls through to the original behavior, harmless but inert.

**Real bug found and fixed in the Finish button itself**: the developer reported the wizard
"keeps crashing and brings me back to the start" when adding a second device.
Traced to `finish()`'s settings-save call being wrapped in a bare `try {} catch {}`
— any failure was silently swallowed, and the wizard reloaded unconditionally
afterward regardless of whether the save actually landed. A failed save meant
reloading back onto a wizard that still thinks setup isn't done, everything typed
gone — exactly what "crashes and resets" looks like without anything technically
crashing. Fixed to verify the server's response actually reflects `setup_complete`
before reloading, with a real visible error and preserved input if it doesn't.

**Caught and fixed a bug in my own first pass at that fix**, worth recording since it
almost shipped: the error message was targeted at `wiz-email-status`/`wiz-host-
status`, both of which live inside specific wizard steps (6 and 2) that aren't
necessarily visible when `finish()` actually runs — a slave/Mirror setup calls
`finish()` from step 3, which has neither element in view. The error would have been
set correctly but never seen. Added a genuinely step-independent `#wiz-finish-status`
element instead, living in the wizard's persistent chrome rather than any one step.

Not yet verified against the real "keeps crashing" report — the developer is retrying the
add-a-second-device sequence now that this is packaged. If it still fails, the new
error message (rather than a silent reload) should finally show what's actually
going wrong.

---

## Session update: confirmed working, 2 more real bugs found and fixed (v1.71.0)

The "keeps crashing" report from the previous entry got a real resolution: the
Finish-button fix alone was enough — the developer retried and it worked. Root cause never
100% pinned down beyond "the settings save was silently failing and the old code
reloaded anyway" (the new error-surfacing didn't actually need to fire, since the
retry succeeded), but likely explanation is stale `device_role` from an earlier
failed attempt (made before the fix existed) routing that request through
`slaveWriteGuard`'s proxy logic unexpectedly — addressed properly in this version,
see below, rather than left as a one-off "it works now, don't know why" close-out.

**Remote-access QR code**: straightforward addition, second `.qr-container` for the
Tailscale URL, smaller than the primary one to match its secondary visual weight.

**Stale-state hardening**: added the cleanup the developer deferred earlier — a fresh wizard
attempt now clears any leftover `device_role`/host-address fields from a prior
incomplete attempt *before* the wizard even shows, not just when finishing. This is
what should prevent a repeat of the exact confusion from the "keeps crashing"
report, even though that specific report's actual cause turned out to be the
Finish-button bug instead.

**Real, systemic bug found and fixed while investigating a reported "calendar
filter doesn't save" issue**: traced it fully rather than patching the calendar
widget specifically — the actual cause was in `fetchLayout()` itself, which
replaced `state.layout` wholesale with fresh object copies on every sync. Since a
save's own success broadcasts back to the same display that made it, ANY open
widget settings panel would have its underlying widget object silently swapped out
from under it the moment that echo arrived — meaning any edit made after that point
in the same panel session mutated a disconnected copy that never reached an actual
save. This affected every widget type's Live Editing settings panel identically,
not just Calendar — toggling several checkboxes in a row (exactly what invited the
bug report) just made it easy to trigger. Fixed at the root: `fetchLayout()` now
reconciles into existing objects by ID rather than replacing the array, preserving
object identity across syncs. Checked whether `app.html` has the same
SSE-driven-refetch pattern and could have the identical latent bug — it doesn't
(no `EventSource` usage there at all), so no parallel fix was needed there.

---

## Session update: widget scaling audit + Todoist task completion (v1.72.0)

The developer asked for a holistic check of widget scaling between Live Editing and the real
screen — investigated properly rather than guessing: confirmed the core `--ui-scale`
mechanism itself never changes based on `editModeActive` (verified via grep, not
assumed), so a widget's actual size genuinely is identical editing vs not. But the
audit surfaced two real, separate bugs while checking every widget's CSS:

1. Tasks widget's `--tk-scale` was purely the user's own font-size setting, with
   `--ui-scale` never multiplied in at all — the one widget in this file that didn't
   bake screen-scale into its font-size at the source. This was specifically the one
   the developer had already noticed himself. Fixed at the source, plus the same fix for both
   widgets' fixed-14px checkboxes.
2. Not scaling-related, found during the same audit: Live Editing's toolbar is
   `position:fixed` full-width across the top at high z-index — genuinely covers any
   widget positioned near the top edge while editing. Deliberately did NOT reposition
   any widget to fix this — traced the actual drag math (confirmed delta-based, not
   absolute-position, so a canvas shift wouldn't break dragging) but a full "never
   cover anything" fix has real risk of pushing bottom-row widgets off-screen without
   live-device verification. Shipped the safe, verifiable-without-a-device version
   instead: a floating pill instead of a full-bleed bar, reading clearly as temporary
   chrome rather than part of the actual layout.

**Todoist task completion**, built the same session after confirming real feasibility
first (checked Todoist's actual current API — they're mid-migration off REST v2,
shutting down Feb 2026, and this app was already correctly on v1): `POST
/api/v1/tasks/{id}/close`, same personal token already stored for reading. New
`todoistPost()` helper (todoistGet() only did GET), new `/api/todoist/tasks/:id/close`
route, and `wireTasksWidgetTaps()`/`completeTaskItem()` on the display side — Tasks
and Tasks Combined had zero interactivity before this, unlike Todo/Shopping/Chores.
Optimistic fade-and-collapse for instant feedback, then a full `fetchTasksForLayout()`
+ `renderLayout()` reconciliation rather than hand-patching every widget's cache
individually — simpler and correct even when the same task appears in more than one
widget on screen.

Also fixed in passing, found while touching this code: task content from Todoist
was being inserted into the page unescaped (`${t.content}`, not
`${escapeHtmlD(t.content)}`) — the one place in this render path that didn't already
follow the file's own consistent escaping convention. Low real-world risk (would need
a task whose text happened to contain HTML-like characters) but a genuine, easy-to-fix
gap next to code already being edited.

---

## Session update: Tasks/Tasks Combined Live Editing settings (v1.73.0)

The developer asked to add To-Do settings to Live Editing — turned out To-Do already had full
parity (confirmed field-for-field against app.html before assuming there was a gap).
Asked which "live preview" he meant to avoid guessing wrong given there are two
distinct features with overlapping names (on-device Live Editing vs. the Layout tab's
separate, deliberately non-interactive `🔍 Live Preview` iframe) — turned out to be
on-device Live Editing, and the actual gap was Tasks/Tasks Combined specifically, not
To-Do at all.

Real finding: Tasks and Tasks Combined were the only two widget types never added to
`WIDGET_ADVANCED_TYPES` — tapping their settings on the display showed the generic
"more settings available in the app" fallback every other widget type outgrew long
ago. Ported both panels from `app.html` field-for-field, same porting convention this
file already uses for Calendar/Weather/To-Do (comment at the top of this section of
the file literally says "Fields, defaults, and behavior are ported directly from
app.html's own drawWidgetSettingsPanel() ... not a reinterpreted subset"). New shared
`fetchTodoistProjectsD()` (cache-once, mirrors `cachedFeeds`/`cachedDisplays`
elsewhere) backs both project pickers.

Worth flagging for whoever next adds a genuinely new widget type to this file: check
`WIDGET_ADVANCED_TYPES` explicitly as part of that work, not just the render-dispatch
switch statement — a widget can render correctly on the display (as Tasks/Tasks
Combined already did, including this session's own tap-to-complete work) while still
being invisible to Live Editing's settings system entirely, and nothing surfaces that
gap on its own until someone actually goes looking for the missing settings.

---

## Session update: serious PIN-setting bug, fully traced and fixed (v1.74.0)

The developer reported setting a PIN for the first time led to a repeated kick-out loop and,
eventually, the first-run setup wizard reappearing on an already fully-configured
device — genuinely worried it might have broken something. Told him plainly it
almost certainly hadn't (setup_complete/PIN state lives in a completely separate
settings space from actual data — calendars, widgets, photos, chores — matching this
file's own established LOCAL_ONLY_SETTINGS separation), and that held up once
actually investigated.

Traced the real mechanism end to end rather than guessing at a single fix — three
genuinely separate bugs, chained together into one bad experience:

1. Settings' PIN-save flow makes two sequential requests (set the PIN, then save the
   rest of the form) — but only the FIRST one happens before the new PIN takes
   effect server-side. The second was still sent with no session token, since typing
   into a settings field was never the same as calling `/api/auth/login`. Server-side
   `requireAuth` reads the PIN fresh from the DB on every request (no caching), so
   the very next request after setting it got rejected — kicking the person out of
   the app they were actively using, moments after saving.
2. Even after logging back in successfully, OTHER requests already in flight from
   before that login (fired with the old/no token) could land afterward and each
   independently re-trigger `showPinScreen()` — no coordination existed between
   concurrent requests at all. This is the actual mechanism behind "kicked out
   again" repeating multiple times. Fixed with an `authGeneration` counter — each
   `apiFetch()` call snapshots it at send time, and a 401 only acts if no newer
   login happened since that specific request went out.
3. The most serious one: `apiFetch()` returned an identical empty `{}` for both "a
   401 happened" and "this endpoint genuinely returned nothing," and `init()`'s
   first-run check (`!s0.setup_complete`) couldn't tell those apart — a 401 during
   the startup settings fetch looked exactly like "this device was never set up,"
   incorrectly launching the wizard on a device that was actually fully configured.
   This is what produced the "asks to set up a new device" symptom specifically.
   Fixed with a distinct `__authFailed` marker `init()` explicitly checks for and
   bails out on, rather than evaluating setup data that was never actually fetched.

Also fixed in the same pass: the PIN-login success handler only ever called
`loadEvents()` regardless of which tab was actually showing when the PIN screen
interrupted it — now calls `renderTab()`, which correctly re-renders whatever tab is
actually active. Noted but deliberately left alone for scope: a full re-run of
`init()`'s one-time setup (tour, fleet-update check, host-conflict check) after a
mid-session re-login isn't triggered by this path either, same as before this fix —
re-running the *entire* `init()` sequence here risked stacking a duplicate
`setInterval` for the fleet-update check without a live device to verify against,
so this stayed a deliberately narrower fix than it could have been.

Also added, per direction, independent of the root-cause fixes above: a confirm-PIN
field (type it twice) everywhere a PIN gets set — Settings and the setup wizard both.
The actual root cause wasn't a mistyped PIN, but requiring confirmation is a real gap
worth closing on its own regardless of what caused this specific report.

---

## Session update: v1.74.0's own fix regressed something, plus a real second bug (v1.74.1)

A device already running v1.74.0 still ended up in a genuine hard lockout — fully
stuck on the PIN screen, "no option to get out," requiring a direct SQLite edit
(`DELETE FROM settings WHERE key='app_pin'`) via SSH to recover, on a completely
different physical Pi (`raspberrypical`, the main one) than the test Pi
(`raspberrypi`) this whole PIN saga had been diagnosed and fixed against. Worth
remembering going forward: this deployment has multiple real devices, and a fix
verified on one doesn't confirm it's actually deployed or behaving identically on
another — checked the running version directly on `raspberrypical` before assuming
this was a new bug rather than the old one on a stale deploy, and confirmed it was
genuinely 1.74.0.

Two real, distinct things found by re-tracing rather than assuming the earlier fix
was complete:

1. **v1.74.0's own fix had a real regression**: the `__authFailed` guard was an early
   `return` out of the entire `init()` function, not just a skip of the wizard-trigger
   condition. Since the settings fetch that can produce `__authFailed` is the very
   FIRST network call `init()` makes, and will always 401 on a fresh page load for any
   PIN-protected device (a completely normal state, not an error), this meant
   `checkAuth()` — and everything after it — silently stopped running on *every*
   normal page load for a PIN-protected device, not just the one specific scenario the
   fix was written for. Narrowed the fix to gate only the wizard condition.
2. **A separate, genuinely serious bug, likely the actual mechanism behind this
   specific lockout report**: the PIN screen's error handling always displayed a
   hardcoded "Incorrect PIN — try again," completely discarding the server's real
   response — including a 429 rate-limit response ("Too many attempts, try again in
   N minutes," from the rate limiter added earlier this session). The original
   kick-out-loop bug forcing repeated re-entries would very plausibly have exhausted
   that 5-attempts/10-minute allowance; every subsequent attempt after that —
   including with the genuinely correct PIN — would show "Incorrect PIN" with zero
   indication that waiting, not retyping, was the actual fix. Checked the rate
   limiter's own behavior before concluding this was safe to just surface correctly:
   confirmed retrying during an active lockout does NOT extend it further (stays
   fixed at 15 minutes from the first trigger), so simply showing the real message
   is the complete fix, not just a partial mitigation.

Real process lesson from this whole arc: a serious auth bug fix shipped in v1.74.0
was declared fixed after reasoning through the code, without a live device to
actually exercise the fix against — and it turned out to be incomplete in a way that
only surfaced under real, messy conditions (a genuinely rate-limited IP, a second
physical device). Worth being more explicit going forward that a fix reasoned through
carefully in this sandbox is still a hypothesis until confirmed on a real device,
even when the reasoning itself is sound.

---

## Session update: the ACTUAL root cause, after a very long chase (v1.74.4)

Every session token has been expiring ~1 millisecond after being issued, not 30
days, since the very first version of the PIN/token system this session (way back
in the security-hardening pass). `SESSIONS`' expiry used `setTimeout(fn, 30 * 24 *
60 * 60 * 1000)` = 2,592,000,000ms, which exceeds Node's 32-bit signed integer limit
for setTimeout delays (~24.8 days max, `2147483647`). Node doesn't throw on this —
it silently clamps to 1ms and emits a `TimeoutOverflowWarning`, which is easy to
never notice unless something's actively watching the logs at the right moment.

This is what actually explains the multi-day "flashes the app, then back to PIN
screen" saga — a token was always going to die within a millisecond of being handed
out, making the very next request fail every single time, unconditionally,
regardless of anything else going on. Found by asking the developer to watch `journalctl`
live during an actual reproduction on `raspberrypical` (not the test Pi) — the
`TimeoutOverflowWarning` line was sitting right there the whole time, just never
looked at directly until this point. Confirmed the exact mechanism by reproducing
the same warning on demand in an isolated Node snippet before shipping the fix, not
just inferring it from the math and hoping.

**Important, worth being honest about**: the several earlier fixes this session
(the init() regression, the swallowed rate-limit message, the tour/z-index overlay
issue) were all real, legitimate, separately-confirmed bugs — genuinely worth
fixing, and likely contributed to some of the confusion and earlier reports along
the way. But none of them were *this* bug, and it took a live device, a person
willing to keep testing through several rounds of "try this now," and eventually a
raw systemd log to actually find it. Real lesson for next time a symptom survives
multiple seemingly-correct fixes in a row: that pattern itself is a signal to
step back and look for something more fundamental (like a silently-clamped timer)
rather than continuing to patch adjacent, plausible-looking theories one at a time.

`SESSIONS` restructured from a `Set` to a `Map` (token → expiry timestamp), checked
against `Date.now()` in `validToken()`, with an hourly sweep to reclaim expired
entries — the correct general pattern for any expiry duration past ~24.8 days in
Node, not just a smaller number that happens to fit under the limit this one time.

---

## Session update: PIN saga fully closed out (v1.74.5)

Confirmed genuinely resolved through real testing after v1.74.4: a "PIN doesn't seem
to stick" follow-up report turned out to be the 30-day session working correctly —
The developer's browser already had a valid session from setting the PIN (which logs you in
immediately, per an earlier fix in this same saga), and a plain new tab shares
localStorage with existing tabs, so it picked that up automatically rather than
re-prompting. Confirmed with a real test rather than assumed: a private/incognito
window (no shared localStorage) correctly asked for the PIN and held there. Nothing
left to fix — this was the system working as designed.

Removed the v1.74.2 diagnostic panel now that the actual root cause is confirmed and
verified — it did its job (the `journalctl` evidence it prompted the developer to check was
what actually cracked the case) and was always meant to be temporary.

---

## Session update: mirror-to-host sync + a host PIN, previously impossible (v1.75.0)

Real gap surfaced directly by finishing the PIN saga above: once `raspberrypical`
(the host) genuinely had a working PIN, trying to sync a mirror to it started
failing with a flat `HTTP 401`, no workaround. Root cause: the host-communication
code (`proxyJSONToHost()`, the shared `fetchJSON`/`fetchJSONPost` helpers, and
`proxyWriteToHost`'s raw multipart-forwarding branch for photo sync) has never sent
any authentication at all — it predates PINs existing on this host at all, and
nothing updated it once they did. A PIN correctly protects browser access; it was
also silently blocking legitimate sync between a person's own two devices, with
no way through at all until this version.

New `host_pin` local-only setting — a slave's own copy of the *host's* PIN, entered
in the wizard's host-address step or Settings → Multi-Device, sent as a dedicated
`x-host-pin` header on every host-communication request. Deliberately a raw PIN
header rather than a session token — there's no human present during an unattended
periodic sync to do an interactive PIN-screen login, so the session-token model
doesn't fit this use case at all. `requireAuth` on the receiving end accepts this
header with plain equality, matching how `/api/auth/login` already compares the PIN
elsewhere in this same file.

Fixed at the shared-helper level rather than patching the one call site the developer
happened to hit — traced every place `hostBaseURL()` gets used (found 6 call sites
across `runSyncOnce()`, `registerWithHost()`, the periodic ping/watch timer,
`/api/sync/test`, and `proxyWriteToHost`'s two branches) to make sure this covers
every host-communication path in the file, not just the one that surfaced the bug.

---

## Session update: a foundational requireAuth bug, hiding since the PIN system was built (v1.75.1)

The developer reported a brand-new mirror's wall display stuck on its "let's get set up"
splash even after setup genuinely completed (confirmed via direct database check:
`setup_complete: '1'`, `device_role: 'slave'` — the wizard worked correctly). Ruled
out a live-update/SSE issue (persisted through a manual refresh) before escalating
to checking the live server directly: `curl localhost:3000/api/settings` on the
mirror returned a flat `{"error":"Unauthorized"}` — which should be structurally
impossible, since `GET /api/settings` is explicitly listed in `publicRoutes`
specifically so the always-public wall display never needs to log in.

Root cause: `requireAuth` is only ever invoked from inside
`app.use('/api', (req,res,next) => { ...; requireAuth(req,res,next); })`. Express
strips the `/api` mount prefix from `req.path` for the entire duration that
middleware layer runs — confirmed directly from this file's own code, not just
Express docs: the SAME wrapper checks `req.path.startsWith('/auth')` (not
`/api/auth`) specifically because it already knows it's working with a
mount-relative path at that point. But every check *inside* `requireAuth` itself —
`publicRoutes`, `ALWAYS_AUTH_ROUTES`, the voice/Alexa exemptions, all written this
session — compares against full `/api/...` paths, which never actually matched.

This bug has existed since the very first PIN/auth work earlier this session and
affected every one of these path-based exemptions identically, not just
`publicRoutes` — it just had zero visible symptoms until now, because every one of
them exists specifically to grant access WITHOUT a session token. The phone app
always sends a real token once logged in, so its own requests never depended on any
of this working correctly. Only token-less callers — the always-public wall display,
and unauthenticated automation like Shortcuts/Alexa — ever actually exercised this
code path, and nobody had tested display.html itself against a genuinely
PIN-protected device until this exact mirror setup.

Fixed with `req.baseUrl + req.path` at the top of `requireAuth`, reconstructing the
true original path once, used for every comparison in the function — Express's own
documented mechanism for this exact scenario, not a workaround. Syntax-checked, and
grounded in stable Express 4.x semantics, but genuinely NOT live-tested against a
real HTTP server — this sandbox has no network access to install Express and run
one. Confirming this on the actual Pi is the real test.

**Worth remembering**: this means the Alexa skill and the Siri Shortcuts voice
control, both built and shipped earlier this session, may have been silently broken
by this same bug on any device that has a PIN set — worth explicitly retesting both
once this fix is confirmed working, not just assuming they're fine because they
worked during original testing (which happened on a device with no PIN at the
time).

---

## Session update: one shared PIN instead of separate ones, and the push bug closes for free (v1.76.0)

The developer asked, reasonably, given how much trouble this whole area caused: should PINs
just be removed entirely? Gave an honest answer rather than just doing it —
`GET /api/settings` returns the whole settings table in one response, including
real credentials (Home Assistant token, Todoist token, the voice-control token).
With no PIN option at all, that's wide open to anyone who can reach the device,
which matters for OTHER customers whose network setups aren't under the developer's control,
even though his own Tailscale-only setup makes the risk genuinely low for him
personally. Recommended keeping single-device PIN protection (now solid — the two
real foundational bugs are fixed) and dropping only the more marginal multi-device
piece.

The developer's actual follow-up question was the better path forward: can a slave just use
the SAME pin as the host, instead of tracking a separate value? Yes — implemented
exactly that. A slave's own `app_pin` (already used for logging into its own
control app) now IS the household's shared PIN, set directly from the wizard's
host-PIN field rather than into a separate `host_pin` setting. This is a genuine
simplification, not just a rename:

- One PIN concept instead of two per slave device (its own login PIN, and a
  separate "what I present to the host" value that had to somehow stay in sync)
- The still-open "host can't push updates to slaves" bug (found earlier this
  session — `postZip()` sent zero auth, and `/api/update` is deliberately the
  strictest route in the app) closes as a DIRECT CONSEQUENCE of this simplification,
  not as separate work: since every device shares one PIN by construction, the host
  already knows the right credential for every slave — no per-slave PIN storage or
  UI needed at all, which was the real complexity in my original plan for that fix.

Real collision caught and fixed while wiring this up: step 3 of the wizard (optional
basics) has its own PIN field, shown for both roles — for a slave, filling that in
too would have silently overwritten the value just set from step 2's host-PIN field,
with no indication anything happened. Guarded the logic AND hid the field entirely
for a slave role, rather than just the logic fix alone, since a visible-but-inert
field is its own source of confusion.

Known limitation, not automated: if the household PIN changes later (via Settings
on the host), existing slaves' stored PINs go stale until manually updated to match.
Accepted as a reasonable tradeoff — building automatic PIN propagation on change
would add back real complexity for something that changes rarely, working against
the whole point of this simplification pass.

---

## Session update: multi-day event display alternatives, built for real (v1.77.0)

Grew directly out of the earlier visual-mockup comparison (a standalone HTML file
showing 5 rough previews before any real code) — the developer picked 1/2/4 for the Calendar
widget and 3 for Agenda/Today, so what shipped here is exactly what was chosen
rather than a guess at what "alternatives" might mean.

**Calendar widget** — new `calMultiDayStyle` setting (bar/dot/line/stripe), wired
into both Live Editing and the main app. Built on top of the EXISTING bar-rendering
architecture rather than a rewrite: `spanEvents`/`barsByWeek`/lane-assignment all
stayed exactly as they were for 'bar' mode; the three new modes route through a
new `spanTouchByDate` per-date lookup instead, with `reservedHeight` and the
`.mc-span-overlay` insertion both correctly gated to bar-mode only so the other
three styles don't reserve dead vertical space for a bar that isn't rendering.
Dot mode specifically reuses the exact same `.mc-ev-pill` markup single-day events
already use — meaning it inherits the existing per-day overflow/"+N more" fitting
logic for free, rather than needing a parallel implementation.

**Ongoing strip** — new shared `buildOngoingStripHtml()`, wired into Agenda
(`agShowOngoing`) and Today (`tdShowOngoing`), both opt-in and off by default.
Deliberately NOT added to Upcoming — traced its actual filter logic first
(`future = filtered.filter(e=>e.date>today)`) and confirmed it structurally
excludes already-started events, so a "what's ongoing right now" strip doesn't fit
what that widget is for. Every new setting was added to both `display.html` (Live
Editing) and `app.html` (phone editor) in the same pass, matching this session's
established field-for-field porting convention — not left half-done on one side.

---

## Session update: piazzahq.com as the non-kiosk browser homepage (v1.77.1)

The developer asked whether the "default homepage" could be changed at install time — clarified
which browser context first, since `install.sh` already sets a "homepage" of sorts
for the KIOSK display (its explicit launch URL), and changing that would have broken
the actual product. Confirmed he meant a REGULAR, non-kiosk Chromium window someone
opens on the Pi (e.g. troubleshooting) — currently lands on Chromium's generic
default new-tab page, not anything Piazza HQ-branded.

Implemented via a Chromium managed-policy JSON file (the standard, supported
mechanism for this — not editing the live `Preferences` file directly, which
Chromium owns and rewrites itself, making direct edits fragile). Verified
`NewTabPageLocation` is a real, currently-documented Chromium policy against Chrome
Enterprise's own docs before using it, rather than assuming from memory — confirmed
it specifically governs new tabs/windows, separate from `RestoreOnStartup`, and that
`HomepageIsNewTabPage: false` is required alongside `HomepageLocation` for the Home
button to actually go to the custom URL rather than staying on the built-in NTP.

Policy directory path derived from the SAME `CHROMIUM_BIN` detection already used
for the kiosk launch command (`chromium` vs `chromium-browser` resolve to different
`/etc/.../policies/managed` paths) — reused the existing detection rather than
duplicating it. Non-fatal if the policy directory can't be written (permissions,
some unusual setup) — warns and moves on, since this is a nice-to-have, not
something that should ever block a real install.

---

## Session update: Entity Status touch race, Area filtering, settings-save data loss, update-restart PIN screen — two separate copies of the same bug (v1.77.57–1.77.62)

Four related fixes, all triggered by two real reports: "if you tap an entity status toggle quickly, sometimes the shown status is opposite" and "Home Assistant settings I set before have dropped out at some point." A filtering feature request (Areas vs. individual entities) came out of the same conversation.

**v1.77.57 — Entity Status/Smart Home Dashboard toggle race.** `state.haEntities` was written from two independent places — the periodic 60s poll (`fetchHaEntities()`) and the post-tap confirm fetch in `callHaAction()` — with nothing stopping an older response from resolving after a newer one and overwriting it. Tap a toggle right as the poll's request for that same entity is in flight, and the poll's (pre-toggle) response could land after the tap's own fresh-confirm fetch, silently reverting the display to the opposite of the real state. Fixed with a per-entity fetch-sequence guard (`haEntityFetchSeq`/`applyHaEntityState` in `display.html`): every fetch for an entity stamps itself with the next sequence number at issue time, and a response only applies if it's still the latest one issued for that entity.

**v1.77.58 — Entity Status label not following an entity swap, + real HA Area filtering.**
- The entity picker's label auto-fill only ever fired when the label was empty (`if (!w.haLabel) w.haLabel = ...`), so swapping which entity a widget pointed to kept showing the PREVIOUS entity's name. Fixed with a `haLabelAutoFor` tracking field on the widget — distinguishes an auto-filled label (follows future entity swaps) from a manually-typed one (never touched again). Existing widgets keep their current label until touched or swapped again — no retroactive rewrite.
- New real Area filtering for both entity pickers (`openEntityPicker` single-select, `openEntityPickerMulti` for Smart Home Dashboard), sourced from Home Assistant's actual area registry rather than the old free-text "room" label. **Key technical finding: HA's REST API has no area/entity/device registry endpoint at all** — confirmed against HA's own docs and a still-open 2021 community feature request. The only way to get this is HA's WebSocket API. Built `haWsRequest()` in `server.js` — a one-shot (not persistent) WS client: connect, authenticate, request `config/area_registry/list` + `config/device_registry/list` + `config/entity_registry/list`, resolve each entity's EFFECTIVE area (direct assignment, or inherited from its device — HA doesn't flatten this, most entities go the device-inheritance route), close. New `GET /api/ha/areas`, cached 5 minutes server-side. Uses the `ws` package — already a project dependency (previously only used by the Samsung TV driver in `tv-control.js`) — wrapped in the same defensive try/catch so an install that hasn't run `npm install` since this shipped only loses area filtering, not the rest of the HA integration. The Smart Home Dashboard picker also got a one-tap "+ Add all" per area that bulk-adds every entity in it and auto-fills the room label from the real area name.

**v1.77.59 — the actual root cause of settings dropping out.** Ruled out backup/restore first (the developer confirmed he hadn't restored one — also confirmed as a non-issue either way, since restore is a full `calendar.db` file swap and always included every setting, no code change needed there). Traced it to a real, demonstrable bug instead: `renderSettings()` wires a fresh 'input'/'change' listener onto the shared `#content` container every time the Settings tab is (re)opened, and nothing removed the previous one — delegated listeners on a container that survives every tab switch (only its innerHTML gets replaced, confirmed against `renderTab()`). A session with more than one Settings visit ends up with that many duplicate listeners stacked, each independently debouncing and firing its own `PUT /api/settings` for the same edit, with nothing ordering the requests against each other. An earlier-scheduled save (built from a momentarily blank/half-typed field, e.g. mid-paste into the HA token box) could resolve AFTER a later, complete one and silently overwrite it. Fixed by chaining every save through one shared, app-wide promise (`window._settingsSaveChain`) and building `collectSettingsBody()`'s payload at the moment the save actually runs, not when it was scheduled — so outgoing PUT order always matches actual edit order regardless of how many listeners are stacked.

**v1.77.60 — cleaned up the duplicate-listener stacking itself.** 1.77.59 made the stacking harmless from a data-loss standpoint, but surfaced a second, separate bug while investigating it: an old stacked listener's closure still points at whatever `tickers`/`briefingProjectIds` array existed when IT was first wired (both are `let`-redeclared fresh every `renderSettings()` call, not persistent state) — so a save triggered by a stale listener could silently persist an outdated stock-ticker list or Todoist project selection instead of what's actually on screen. Fixed by tracking the handlers on `window._settingsInputHandler`/`window._settingsChangeHandler` and removing the previous render's pair before attaching new ones, so exactly one correct, current listener is ever attached.

**v1.77.61 — PIN screen incorrectly appearing during a normal self-update.** Real report from the developer, a different recurrence of the same class of issue as the earlier fresh-install PIN screen bug (that one was a duplicate `display:none`/`display:flex` CSS property — confirmed that fix is still intact, this is a genuinely separate mechanism). Root cause: installing an update polls `/api/version` in a tight one-second loop while the server restarts (`installUpdateFromBanner()`), and the brief window between the old process exiting and the new one binding the port is a normal, expected connection failure during any restart — nothing to do with auth. But the shared `apiFetch()` helper's network-error handler was unconditionally calling `showPinScreen()` on any failed request, regardless of whether a PIN was even configured. Fixed by removing that call from the network-error branch only — a real 401 (server reachable, session genuinely invalid) still correctly shows the PIN screen; a connectivity gap no longer does. Confirmed no other code relies on the old side effect (nothing else distinguishes `__networkError` from a real 401 in its own handling).

**v1.77.62 — same bug, second copy, found because the developer reported 1.77.61 didn't fix it.** `checkAuth()` (the boot-time auth check) uses its own raw `fetch()`, entirely separate from the shared `apiFetch()` helper 1.77.61 fixed — and had an identical, independent copy of the same mistake in its own network-error handling. Fixed the same way: a network-level failure (can't reach the server at all) no longer shows the PIN screen; only a genuine server-confirmed "PIN required, not authenticated" does. Also widened this path's retry budget from one 1.2s retry to three, now that we know why it matters: **updates install fully automatically in the background** — `periodicUpdateCheck()`, a server-side timer, checks every 6 hours and self-installs with zero client coordination at all (confirmed reading server.js — this was news this session, not something either of us had front-of-mind while investigating the outage below). So this was never just a "right after tapping the update banner" issue — a page load or reload can land in the middle of one of these restarts at literally any time, and 1.2s was never going to reliably cover a real restart.

This retroactively makes the earlier "app totally crashed" outage worth revisiting mentally, though NOT confirmed: this checkAuth() bug plausibly explains why `app.html` specifically would show a false PIN screen during that incident. It does NOT explain why `display.html` was also reported down at the same time — display.html has no PIN/auth-screen concept at all (confirmed, grepped for it, genuinely nothing there), so whatever affected the wall display during that outage is still a separate, unexplained question if it really was down too, not just the control app. Worth keeping an eye out for the next time an update happens, now that this specific bug is closed.

**Deployment note — a real outage happened, cause still unconfirmed.** v1.77.60 was packaged and deployed to the developer's actual host (`raspberrypical`, service name still `pi-calendar` — never renamed at the systemd level despite the code rename). The developer reported the app "totally crashed and would not load" — both `display.html` and `app.html` unreachable. Investigated live over several turns: `sudo systemctl status pi-calendar` showed the server itself healthy the whole time (no crash-loop, clean "Update confirmed healthy" boot log, `/api/version` correctly returning `1.77.60`) — so this was NOT a server-side crash, and the auto-rollback guard correctly never triggered (nothing to roll back from). It self-resolved after "taking a while" with no code change, restart, or manual rollback — the developer confirmed everything (including Home Assistant) is reachable now. This pattern (no crash-loop, self-resolves with time, both display and control app affected together) fits a transient network/connectivity gap far better than a JS crash would — a real crash doesn't self-heal by waiting. But we never captured the browser console output DURING the actual incident, so this is not confirmed, just the best-fit theory given the evidence gathered. The developer's call: push v1.77.61 (the PIN-screen fix above) and watch for a recurrence rather than chase this further right now. If it happens again, the browser console output captured DURING the outage (not after) is the missing piece that would actually settle it.


**Not done:** none of this has been live-tested against real hardware or a real Home Assistant instance yet beyond the outage investigation above — Area filtering in particular still needs a real HA instance to confirm the WebSocket registry calls actually behave as expected (auth handshake, the entity→device→area resolution) before trusting it fully. Only a single flat copy of the device app was available to edit this session (no separate `update`/`install` tree pair) — needs applying to whichever tree is source-of-truth, and the two trees re-synced, before this ships for real.

---

## Session update: Group Control widget, real Live Edit HA settings parity (v1.77.63)

Grew out of a single message with four related asks: mass-toggle a group of entities ("turn a whole floor off"), a way to show entities from different rooms together but still individually controlled, a report that Live Edit's toggles don't reflect reality, and a request to bring Live Edit's HA widget settings up to real parity with the app.

**Design decisions confirmed with the developer before building:** a NEW widget for mass-toggle (not a mode bolted onto Entity Status) — his call, "probably cleaner." The individually-controlled-multi-room idea turned out to already be covered by the Smart Home Dashboard widget once you can bulk-add by area (shipped earlier this cycle) — confirmed with him directly rather than building something redundant.

**Group Control widget, built end-to-end:**
- `POST /api/ha/call-group-action` (server.js) — one real HA service call across every member at once (`turn_on`/`turn_off` accept an array of entity ids natively, even across domains). Deliberately does NOT expose `toggle` for groups — HA's toggle service flips each entity independently based on its OWN state, which inverts a mixed-state group instead of acting as one clear action. The CLIENT works out the correct single target action (anything on → turn_off everything; otherwise turn_on everything) using its own already-loaded `state.haEntities`, and tells the server which one to run — same "client decides, server only ever runs one of a few known-safe things" split as the existing single-entity `call-action`.
- `renderGroupControl()` (display.html) — combined toggle + "X of Y on" readout. Reuses the `.ha-toggle-switch` class (same styling, same one tap-wiring pass in `wireEntityStatusTaps()`) but carries `data-group-ids` instead of `data-entity-id`, routing to a new `callHaGroupAction()` instead of the single-entity path.
- Full app.html registration: widget picker entry, Smart Home category, new-widget defaults, settings panel (`openGroupEntityPicker` — a dedicated flat-array picker, not reusing the {id,room} multi-picker since groups don't need per-entity room labels at all), event wiring.
- `fetchHaEntities()` updated to include group members in the regular poll sweep.

**Live Edit polling fix:** a new dedicated 8-second poll runs specifically while Live Edit is open (`enterEditMode()`/`exitEditMode()`), on top of the unchanged 60s ambient poll. Root of the report wasn't a race condition (traced the code — Live Edit renders through the exact same functions as the normal display, no duplicate path) — the developer's actual point was that these are externally-controlled devices (physical switches, other apps, automations), so the normal cadence is noticeably stale specifically while someone's staring at a toggle deciding if it's accurate.

**Real Live Edit settings parity for Entity Status, Smart Home Dashboard, and Group Control** — the big one. Confirmed before building that NONE of the three were in `WIDGET_ADVANCED_TYPES` at all — Live Edit could only rename/resize them, not even pick a different entity. Built:
- Shared HA entity/area fetch-and-cache for this page (`cachedHaEntitiesD`/`cachedHaAreasD`/`ensureHaEntitiesAndAreasLoaded()`) — mirrors app.html's equivalent but uses plain `fetch()`, since this page has no session/auth layer at all (the wall display is always public by design, confirmed again this session).
- Shared list-filtering (`filterHaEntitiesD`) and row-rendering (`haEntityRowsHtmlD`) helpers reused across all three panels rather than tripled.
- Three full render/wire function pairs (`renderEntityStatusAdvancedSettings`/`wireEntityStatusAdvancedSettings`, and the Dashboard/GroupControl equivalents), each added to `WIDGET_ADVANCED_TYPES` and wired into `openWidgetAdvancedPanel()`'s dispatch. Title/font stayed in the EXISTING basic panel (already worked, per `WIDGET_BASIC_SETTINGS` — same dual-panel pattern Calendar already uses) rather than duplicating those fields into the advanced panel too.
- Every selection change triggers a full `openWidgetAdvancedPanel(w.id)` re-render rather than a manual per-field patch — simpler and safer than trying to keep counts/room-lists/toggle-visibility in sync by hand across several interdependent pieces.
- `closeWidgetAdvancedPanel()` now also refreshes the basic panel underneath on close (`openWidgetSettingsPanel(selectedWidgetId)`) — needed because Entity Status's label can auto-update when you swap entities via the advanced panel, and the basic panel sitting underneath wouldn't otherwise pick that up until the widget was deselected and reselected.

**Not done / worth knowing:** none of this has touched real hardware or a real Home Assistant instance yet. The Live Edit pickers in particular are a genuinely new UI surface (full-screen advanced panel, not a nested overlay like app.html's) — worth a real pass on an actual touchscreen before trusting the layout/scrolling holds up, especially with a long entity list.

---

## Session update: entity removal UX, live Home Assistant Area selection (v1.77.64)

Two related asks from the developer: Smart Home Dashboard needed a way to remove a selected entity without reopening the picker and hunting for it, and — bigger — the ability to select a whole HA Area as a unit across all HA widgets, with individual entities under a selected area made deliberately un-selectable to avoid confusion about double-selection.

**Removal UX (small, shipped first):** both Smart Home Dashboard and Group Control settings panels (app.html basic panel AND display.html Live Edit) now show a × remove button directly next to each selected entity — no need to reopen the picker and search for it.

**Live Area selection (the big one) — design decision confirmed with the developer before building:** LIVE/dynamic (always reflects HA's current area membership — add a new device to a room in HA later and it's automatically included) rather than a locked snapshot, and available on BOTH Smart Home Dashboard and Group Control (not just one).

Data model: added `w.haAreaIds` (Dashboard) and `w.gcAreaIds` (Group Control) — arrays of area_id strings, alongside the existing individual entity arrays. No server.js changes needed at all — `/api/ha/areas`'s existing `entityAreas` map (entity_id → area_id) already provides everything needed to resolve "what's in this area right now" as a client-side reverse lookup.

Resolution happens at the point of use, never cached against the widget itself — that's the actual "live" behavior:
- `resolveAreaMemberIds(areaIds)` (display.html) — the shared resolver, used by both rendering and polling.
- `fetchHaEntities()` now checks whether any widget has area selections before building its polled id set; if so, ensures `cachedHaAreasD` is loaded (lazy, cached after first fetch) then resolves and includes each selected area's current members alongside individually-picked entities.
- `renderSmartHomeDashboard()`/`renderGroupControl()` both combine individually-picked entities with freshly-resolved area members (deduped) on every render — an area-derived entity in the Dashboard gets the area's own current display name as its room, so grouping still makes sense without anyone typing a label.
- Group Control's toggle button gets the FULLY resolved id list baked into its `data-group-ids` attribute at render time — `callHaGroupAction()` itself needed zero changes, it just acts on whatever array it's handed.

Picker UI (four places — app.html's `openEntityPickerMulti`/`openGroupEntityPicker`, display.html's Live Edit advanced panels for both widgets) all got the same treatment: a new "Add a Whole Area" checkbox section, separate from individual entity picking. This REPLACES the old one-time "+ Add all" bulk-insert entirely (in all four places) rather than leaving two different ways to add a room's worth of devices with different semantics side by side — confirmed this was the right call rather than just bolting live selection on next to the old button. An entity covered by a selected area renders disabled/greyed in the individual list with an explanatory note, and simply has no click handler attached — genuinely can't be double-selected, not just discouraged from it.

Shared helpers added/extended in display.html: `haEntityRowsHtmlD()` gained an optional `isCoveredByArea` predicate (renders the disabled state), and a new `haAreaRowsHtmlD()` mirrors it for the area checkboxes. Both widgets' basic settings panels (app.html) now show entity count + area count together in their summary line (e.g. "3 entities + 1 area selected").

**Not done:** none of this has touched real hardware or a real HA instance — this is the most interconnected change of the session (polling, rendering, and four separate picker UIs all touched together), so treat it as needing real verification more than anything else built this session. Worth specifically confirming: the covered-entity disabling actually prevents a double-add in practice (not just visually), and that `fetchHaEntities()`'s lazy area-loading doesn't introduce a visible delay/flash on first boot for a layout that uses area selections.

---

## Session update: corrected Dashboard area rendering (v1.77.65)

Immediate follow-up to v1.77.64. The developer's actual ask was simpler than what shipped: "I wanted the areas just to be the area switch, then everything off/on in an area" — i.e., an area selected in the Smart Home Dashboard should be ONE combined toggle for everything in it, identical in shape to the Group Control widget's own tile, not expanded into individually-listed, individually-controlled entity rows grouped under the area's name as a room heading (which is what 1.77.64 actually built). Confirmed this reading with a direct yes/no question before touching code, given how much back-and-forth this feature had already gone through.

Fix scoped entirely to `renderSmartHomeDashboard()` in display.html — reworked to render each selected area as its own combined-toggle tile (same markup and the same `data-group-ids` tap-wiring path Group Control already uses, so `callHaGroupAction()` needed zero changes), sitting in its own section alongside individually-picked entity tiles, never expanded into separate rows. Nothing about the picker UI, the data model (`w.haAreaIds` unchanged), or the covered-entity disabling needed to change — those were already correct; only the DASHBOARD's own rendering was wrong. Also tightened "Group by Room" to only show in both settings panels (app.html basic panel, display.html Live Edit) when there are individual entities to actually group — it never affected area tiles, so showing it for an area-only selection had no visible effect and was just confusing.

**Not done:** same as 1.77.64 — none of this has touched real hardware or a real HA instance yet.

---

## Session update: fixed missing Live Edit widget registration, five Dashboard view styles (v1.77.66)

Two things from the developer: a bug report ("not all of the new smart home widgets seem to be integrated into live edit") and a feature request (different views + per-tile resizing for the Dashboard, "give me some options" first).

**Bug, confirmed and fixed:** `display.html` maintains its OWN widget catalog for Live Edit's "+" add-widget picker (`WIDGET_DEFS`/`WIDGET_CATEGORIES`/`buildNewWidgetDefaults()`), completely separate from `app.html`'s. Only Entity Status had ever been added to it — Smart Home Dashboard and Group Control were both missing entirely, so neither could be added as a NEW widget directly from Live Edit at all (you could still edit an existing one there, since the advanced panels built earlier this session covered that, but creating a new one required going through the app first). Fixed: both fully registered — catalog entry, Smart Home category, and matching default field values on creation (mirroring app.html's own `newWidget.*` inits exactly, including the `haLabelAutoFor`/`haAreaIds`/`gcAreaIds` fields added in prior updates this session, which display.html's defaults builder had also never picked up).

**View styles — built the mockup-first workflow again** (same pattern as the earlier multi-day-event mockup comparison): built a standalone HTML file with rough previews of 4 proposed styles (Grid/List/Icon-only/Card) using the widget's real colors/fonts before writing any real code, the developer said "all sound great" and asked for a 5th ("whole tappable card") with its own rendering before committing, THEN said "build it."

Implementation:
- Grid (the existing, already-shipped view) is **completely untouched** — its exact original code path stayed as-is; the four new views are additive functions (`renderDashItem()`, `renderDashToggleTile()`, `wrapDashItems()`), not a rewrite. Real regression risk avoided by design, not just by testing.
- `w.haDashView` — new field, `'grid'` (default) | `'list'` | `'icon'` | `'card'` | `'tapcard'`.
- Toggle-like items (light/switch/fan/input_boolean domains, and every area — an area is always a combined toggle by definition) get full native support in all five views. Non-toggle domains (climate, scene/script) reuse the exact same `renderHaEntityControl()` markup already built for Grid, just re-wrapped per view — not reimplemented five times. Icon-only and Tap-card both have explicit, documented fallback behavior for non-toggle items (Icon-only: icon + tiny value, no interactivity; Tap-card: falls back to Card's layout, since "tap anywhere" doesn't work for something needing its own +/- buttons).
- New `haDomainIcon(domain)` — a deliberately coarse domain→emoji lookup table for the Icon-only/Card views, since HA's own richer per-entity icon system was never fetched (the trimmed `/api/ha/state` response never included it, and pulling it in would mean a real new fetch pipeline for a cosmetic touch — noted as a real trade-off, not an oversight).
- Tap wiring: Icon-only's circle and Tap-card's whole-card button aren't `.ha-toggle-switch` elements visually, so `wireEntityStatusTaps()` needed extending — factored the shared entity-vs-group dispatch logic out into `wireToggleLike(selector)` and applied it to all three toggle-shaped selectors, rather than tripling the click-handler code.
- Per-tile sizing: reused the EXISTING Font Size control rather than adding a second slider — relabeled "Tile/Text Size" in both settings surfaces, since every dimension in every view (including the four new ones) already derives from the same `--ha-font` CSS variable via `calc()`. One slider already did this job; it just wasn't framed that way before.

**Not done:** none of this has touched real hardware or a real HA instance. The four new views in particular are a meaningful amount of new CSS/markup (verified brace-balanced and JS-syntax-clean, nothing more) — worth a real look at each one on the actual touchscreen, especially Tap-card's touch-target sizing and Icon-only's density at various font-size settings, before trusting any of them fully.

---

## Session update: faster HA polling, Live Edit scroll preservation, Combo Groups (v1.77.67)

Three asks from one message: entity status updates felt slow, a request to combine multiple areas/entities into one named toggle within the Dashboard specifically, and a UX bug (Live Edit's panel jumping to the top on every selection).

**Polling speed:** ambient poll (the one always running, not just during Live Edit) went from 60s to 15s. Chose 15s deliberately — the server's own per-entity state cache is 10s (`HA_STATE_CACHE_MS` in server.js), so anything faster than that wouldn't return fresher data anyway; 15s stays just above that floor while cutting worst-case staleness 4x. Live Edit's separate 8s poll (built earlier this session) is untouched.

**Scroll preservation, `openWidgetAdvancedPanel()`:** was unconditionally resetting `body.scrollTop = 0` on every call — fine for a fresh open, wrong for the many in-panel actions (area/entity toggling, combo group edits, removals) that call this same function again to redraw with current state. Now captures scroll only when the panel was already open (i.e. this is a self-triggered re-render, not a new open), restores it via `requestAnimationFrame` after the new content is actually laid out (immediate restoration risked getting silently clamped against the "Loading…" placeholder's shorter height rather than the real final content's).

**Combo Groups — confirmed the exact model before building, given this topic's had a couple of corrections already this session:** Group Control already combines multiple areas/entities into one toggle at the WHOLE-WIDGET level; this brings the same capability to the Dashboard as a PER-TILE option — select several areas/entities, name the combination, get one tile for it, sitting alongside individual per-area tiles rather than replacing them.

- New field `w.haComboGroups` — array of `{ id, name, entityIds, areaIds }`.
- `resolveComboMemberIds(combo)` (display.html) — same live-resolution pattern as `resolveAreaMemberIds()`, combining direct entityIds with resolved area membership, deduped.
- Rendering: `renderDashItem()` gained an `isCombo` branch, reusing the exact same toggle-tile rendering as areas (including all five view styles) — a combo group behaves identically to an area tile from the renderer's perspective, just with a different membership source.
- Polling: `fetchHaEntities()` resolves and includes combo group members in its polled set, same as it already does for plain area selections.
- Settings UI, built in BOTH surfaces (app.html and Live Edit) since the developer flagged missing Live Edit parity as a bug earlier this session and I didn't want to reintroduce that gap for a brand new feature:
  - **Live Edit**: combo group editing is a genuine sub-view of the Dashboard's own advanced panel (`_editingComboGroupId` module-level state, `renderComboGroupEditor()`/`wireComboGroupEditor()`), not a separate overlay — toggling between the two views within the same panel.
  - **App**: a dedicated bottom-sheet overlay (`openComboGroupPicker()`), matching the existing `openEntityPickerMulti()`/`openGroupEntityPicker()` pattern.
  - Both reuse the same area-checkbox-list/entity-checkbox-list UI components already built for the top-level pickers (`haAreaRowsHtmlD()`/`haEntityRowsHtmlD()` in display.html; the equivalent inline markup in app.html), just scoped to the combo group's own `areaIds`/`entityIds` instead of the widget's top-level ones — including the same covered-by-area disabling within the combo group's own scope.
- **Deliberate scope limit, stated plainly rather than left implicit:** a combo group's membership does NOT cross-check against the widget's top-level individual/area selections, or against other combo groups. An entity could theoretically end up covered by both a top-level area selection AND a combo group simultaneously — accepted as out of scope for this build (documented in both files' comments) rather than building a much larger cross-grouping consistency system that wasn't asked for.

**Not done:** none of this has touched real hardware or a real HA instance. Combo groups are the largest net-new concept added this session on top of everything already built — worth a real test of the full flow (create a group, name it, add a mix of areas and entities, confirm the tile renders correctly across all five views and actually toggles the right things) before trusting it.

---

## Session update: fixed mirror license key silently reverting (v1.77.68)

Real live bug the developer hit while testing: he fixed an intentionally-wrong test license key on his mirror, it verified and said it saved, but reverted a few minutes later on refresh — every time.

Root-caused precisely: `update_license_key` was missing from `LOCAL_ONLY_SETTINGS` (the list of settings protected from host→mirror sync — device role, host address, display name, etc.). A mirror syncs from its host every 5 minutes by default (`sync_interval_min`), and `buildSyncSnapshot()`/`applySyncSnapshot()` both key off that same shared constant to decide what's exported/applied — so with this field unprotected, whatever the host had stored kept getting silently pushed down and overwriting the mirror's own correctly-typed key, every cycle. This is exactly the same class of bug as the already-fixed `screen_device_id_cache` entry in that same list (found live, same mechanism, same "silently re-breaks a manual fix within minutes" symptom) — just never caught for this field until now. A mirror is specifically supposed to hold its own independently-verified key (the host's own `checkMirrorLicense()` requires a mirror to present a matching one before it'll even sync at all), so this wasn't just an inconsistency, it defeated the actual point of the field.

Fixed with a one-line addition to `LOCAL_ONLY_SETTINGS`, closing both directions since export and apply share the same constant. Flagged for the developer that his HOST's own stored key is quite possibly also still the incorrect test value from earlier — a mirror alone being fixed can't stick if the host it's syncing from still has the wrong one, so that's worth checking too, separately from this code fix.

**Also queued (not built yet) from this same conversation:** a customer-facing "revoke the other host" flow to complement the host-claim notification email discussed a few messages earlier — signed/expiring token, a confirmation webpage (mockup already built and approved: `host-claim-page-mockup.html`, four states — landing/device-info, "this was me," "removed," expired-link), wired so the link only acts on an explicit click, never on page load (avoids email-scanner false-triggers). Real security design discussion happened around this: NOT adding a bare claim button to the wizard's *email-based* conflict card (that path requires no secret, just knowing an email address — adding self-serve claim there would undo an existing deliberate protection), instead adding a key-verified claim option to that card specifically, so claiming always requires proving possession of the actual license key regardless of which path someone came in through.

---

## Session update: closed the wizard's host-conflict dead end (v1.77.69)

Direct follow-up to the central server work (piazzahq-server v1.32.6, the host-claim notification/revoke feature). The developer caught a real gap after that was packaged: he asked "are you sure this doesn't need an app update too — I didn't see an option to override and choose as host." He was right. What got built in that session was entirely server-side (token signing, the notification email, the revoke confirmation page) and correctly hooks into the ONGOING check-in conflict modal's existing Claim button — that part genuinely needed no device update. But the actual thing that started this whole thread — the setup wizard's "Already have a host" card, which only ever offered Mirror or a different email, no self-serve claim at all — never got its fix built. Only the server half of the plan shipped; the device half was dropped.

Fixed now: a third button on that card, "This is my account — enter my license key," which switches the wizard into its existing direct-key-entry mode (`keyModeActive = true`, same toggle the "Already have a key?" link already uses) rather than building any new claim logic — `finishWithDirectKey()` was already correct (verifies the key, proceeds, no host-conflict check at all in that path). Deliberately still requires the actual key, not a bare confirmation click — reaching this card only ever required knowing an email address, so a no-proof claim button here would have undone the exact protection discussed when this was first designed (see the earlier host-claim security conversation in this file).

**Not done:** untested on real hardware, same as everything else recently. Worth confirming the full loop live: hit the email-conflict card, tap the new button, paste a real key, confirm setup completes and the ongoing conflict modal correctly picks up and resolves whatever's left server-side.

---

## Session update: fixed a real packaging bug in every zip built this session (device v1.77.69 repackaged, server v1.32.7)

The developer ran the actual fresh-install flow live to test it and hit: "Unpacked, but install.sh wasn't found where expected." Traced immediately, no back-and-forth needed — this was a genuine mistake on my end, not his.

**Root cause:** every device-app zip built this entire session was packaged flat (`zip -r name.zip .` from inside the project folder) — files sitting directly at the zip's own root, no wrapping `piazzahq/` folder. `installFromZip()` (the normal in-app self-update path, in server.js) has always explicitly tolerated either shape — checks for a `piazzahq/` subfolder first, falls back to the zip's root if that's not there. `bootstrap-install.sh` (used only by the one-line `curl | bash` fresh-install/install flow) had no such tolerance — it unzips straight into `$HOME` and rigidly requires `$HOME/piazzahq/install.sh` to exist, no fallback. That inconsistency meant every flat zip built this session installed completely fine through every normal in-app update (which is most of what got tested live this session) and would ONLY ever fail on a genuinely fresh bootstrap install — which nobody had actually exercised until the developer did, right here.

**Fixed two ways, not just patched around this one instance:**
1. `bootstrap-install.sh` now tolerates both zip shapes, matching `installFromZip()`'s already-established behavior — unzips to a temp staging folder first, checks for either `piazzahq/install.sh` (wrapped) or a bare `install.sh` (flat) inside it, and normalizes either case into `~/piazzahq`. This closes the actual gap regardless of how any future release zip happens to get built, not just this one.
2. Rebuilt and repackaged v1.77.69 correctly with the proper `piazzahq/` wrapper this time (device app), confirmed via `unzip -l` that `piazzahq/install.sh` actually lands where the (now also independently fixed) bootstrap script expects it.

Central server bumped to 1.32.7 for the bootstrap fix.

**Process note for future sessions:** package verification this session checked file *contents* thoroughly (`node -c`, inline-script syntax checks, CSS brace balance) but never once checked the zip's own top-level folder structure against what the actual deployment tooling expects. That's the gap that let this ship repeatedly without being caught — worth adding a real structure check (e.g. confirm `unzip -l` shows the expected `piazzahq/install.sh` path) as a standing step before calling any future build "packaged," the same way the content checks already are.

Made the same orphaned-changelog-header mistake as an earlier session's server update while writing this one up (deleted a version header while leaving its content behind) — caught and fixed it in the same turn before shipping, but noting the pattern: str_replace-ing a single changelog header line without including it in the replacement text is an easy, repeatable way to silently orphan a whole section. Worth being more careful with that specific edit shape going forward.

---

## Session update: mirror grace-period clear bug, found live (v1.77.72)

Direct continuation of the 1.77.71 wizard-refresh fix. The developer reported "still the same issue" after applying it — but the screenshot he sent showed a DIFFERENT device (different Tailscale IP, "This screen is linked to your host" banner — a mirror, not the fresh-installed host) with Account Status correctly showing **Active** and the right expiry date, right next to a stale "license required, 7 days left" warning that hadn't cleared. Two genuinely separate bugs on two separate devices, easy to conflate as "the same issue" from the outside — asked for the exact status text and confirmed the license was active in the admin panel before chasing this, rather than guessing a third time in a row on this topic.

Root cause: `storeLicenseInfo()`'s entire grace-period block — both the branch that STARTS a countdown and the branch that CLEARS one — was gated to `device_role !== 'slave'`. Correct for starting (a mirror shouldn't independently begin its own grace period), wrong for clearing: `no_license_since` is genuinely per-device (in `LOCAL_ONLY_SETTINGS`, deliberately excluded from host→mirror sync), and confirmed by reading `display.html` that a mirror actually enforces its own grace period locally from this same value. With the whole block skipped for mirrors, a mirror that ever set its own `no_license_since` had literally no path back — not its own check-ins (skipped the clearing branch), not sync (field never syncs). `license_status_cache` correctly updates to Active on a mirror's own check-ins (that upsert was never role-gated), which is exactly why the account status and the stuck warning could show contradictory information side by side.

Fixed by splitting the gate: clearing now runs for any role; only starting a new grace period stays host-only. Also corrected a stale comment on `no_license_since`'s `LOCAL_ONLY_SETTINGS` entry that claimed the value was "meaningless... on a mirror" — it isn't, per the same `display.html` enforcement code just confirmed.

Gave the developer an immediate one-line SQL workaround for his currently-stuck mirror (`DELETE FROM settings WHERE key='no_license_since'` — no restart needed, nothing caches this) rather than making him wait for a full release+update cycle just to unblock his live test.

**Not done:** untested on real hardware beyond what the developer already reported. Worth confirming after this reaches his mirror (via normal update, not another fresh-install) that the warning actually clears on its own next check-in without needing the manual SQL fix again.

---

## Session update: Fahrenheit/Celsius toggle, weather-location cross-layout bug (v1.77.73)

Two related asks: add a temperature unit toggle to weather widgets, and fix a real bug where changing one weather widget's location was silently changing others across different layouts.

**Root cause of the location bug, found by reading the actual widget settings panel code rather than guessing:** every weather widget's own settings panel (both app.html and display.html Live Edit) had a "Location Name" field positioned right inside that widget's panel, that looked scoped to the widget but actually wrote directly to `weather_location_manual`, a single global device-wide setting. It already had a warning comment ("editing it here updates it everywhere") — confirms this was a known tradeoff, not an oversight, but the warning clearly wasn't enough given the report. Fixed by removing the field entirely when the widget isn't using the (separate, already-correct) per-widget location override — replaced with a plain read-only display of the current global value plus a pointer to Settings → Weather, so the mistake is now structurally impossible rather than just discouraged. The real per-widget override (`wxLat`/`wxLon`, checkbox + ZIP lookup, originally built for a vacation-home use case) was already correct and untouched.

**Fahrenheit/Celsius**, confirmed with the developer as global-default-plus-per-widget-override (matching the location override's own shape exactly) rather than purely global or purely per-widget:
- New `weather_unit` setting (`'fahrenheit'` default, matches prior hardcoded behavior — no surprise change for existing installs), editable in Settings → Weather.
- New `w.wxUnit` per-widget override field, added to all four weather widget types (`weather`, `weatherCurrent`, `weatherForecast`, `weatherHourly`), in both app.html's settings panel and display.html's Live Edit advanced panel.
- Deliberately a display-time-only conversion, not a second fetch path: weather is still fetched and cached in Fahrenheit exactly once (`getWeather()` in server.js is completely unchanged), and a new `formatTemp(fahrenheit, unit)` helper in display.html does the F→C math right at render time in all four render functions. This kept the whole feature to a rendering-layer change — no cache-key complexity, no doubled API calls.
- Caught and fixed a real double-rounding bug of my own making while building this: an hourly-average temperature (`renderWeatherHourly`'s "parts" style, and the email digest's equivalent) was being rounded to a whole Fahrenheit degree *before* my new Celsius conversion ran, losing precision it didn't need to lose. Fixed by moving the only `Math.round()` to inside `formatTemp()`/`emailFormatTemp()`, after conversion.

**Extended to the daily briefing email on my own initiative, flagged first:** found while investigating that the email digest (server.js, a completely separate server-side rendering path from display.html) was still hardcoded to `°F` in three places. Fixed with a mirrored `emailFormatTemp()`/`emailTempUnitLabel()` pair, so the email and the wall display can't show contradictory units. Kept the email's existing convention of stating the unit letter once (in the headline) rather than repeating it on every value, rather than importing display.html's "bare degree symbol everywhere" styling wholesale.

**Not done:** untested on real hardware, same as everything else built purely from code review this session. Worth specifically confirming: the read-only location display renders sensibly when NO global location has ever been set at all (shows literal "(not set)"), and that switching units on a widget with an active per-widget location override doesn't interact oddly with that override's own state.

---

## Session update: Sticker Chart, built on top of the existing chore system (v1.77.96-beta.2)

The developer's ask: a sticker chart integrated with the kids feature, optionally shown on the main calendar widget too — stars with the kid's initial in the middle, color-coded so two kids sharing a first initial still look different. Then, on continuing: parent choice of manual vs. auto award, per-kid choice of sticker look (their own emoji or the star), a star count visible somewhere, and a parent-defined rewards system (e.g. 10 stars = ice cream).

**Deliberately built as a layer on the existing chore chart, not a parallel system** — kids already had `color` + `avatar`, and the chore chart's kids/chores/chore_instances/allowance_ledger tables already established every pattern this needed: an append-only ledger for balance (never a mutable running total), snapshotting a definition's values at the moment of use so a later edit doesn't rewrite history, and a `celebrate`-style flag as a lightweight per-chore signal rather than adding a second checkbox that would mean almost the same thing.

**Data model:**
- `stickers` — one row per earn event. `chore_instance_id` set only for auto-awarded ones (reuses each chore's own `celebrate` flag as the "worth a sticker" signal), NULL for manual awards. A kid can have several in one day; the calendar badge only cares whether the count for that kid/day is > 0.
- `rewards` — parent-defined prize definitions. `assignee` is the exact same field shape as chores' own (`'all'` or a specific/comma-separated kid id list) — reused the chore editor's "Who?" pill-picker UI verbatim rather than building a second one.
- `sticker_redemptions` — the spend ledger. Snapshots `reward_title`/`star_cost` at redemption time, so deleting or editing a reward later doesn't corrupt history already redeemed against it (same reasoning as `chore_instances.pay_amount` snapshotting a chore's rate).
- Balance is always derived: `getKidStickerBalance()` = COUNT(stickers) − SUM(redemptions.star_cost). Never a running-total column, so an undo (un-checking an auto-awarded chore, or reversing a mistaken redemption) is exact, not a guess.
- `kids.sticker_style` (`'star'|'avatar'|'custom'`) + `kids.sticker_emoji` — kept separate from the existing `avatar` field on purpose, so a kid's name-picker avatar and their sticker look can differ (e.g. fox 🦊 avatar, trophy 🏆 sticker) without one overwriting the other.
- `sticker_award_mode` setting (`'manual'` default | `'auto'`) — global, not per-kid; the developer's ask was "an option that parents choose," and every other family-wide toggle in this app (`chores_enabled`, `week_start_day`, etc.) is global too, so this matches existing precedent rather than introducing a new per-kid-settings shape for one field.

**The one shared visual spec, duplicated by hand three times:** `stickerBadgeHtmlApp()` (app.html), `stickerBadgeHtml()` (kids.html), `stickerBadgeHtmlD()` (display.html) all render the identical star/avatar/custom badge. No shared module system between these three files (same constraint already noted for `server.js`/`admin.html`'s version-compare functions on the mothership) — if the badge's look ever changes, all three need the identical edit, same maintenance burden as that existing pair.

**Calendar widget (the original, specific ask):** new `calShowStickers` (off by default — genuinely optional, not just off-by-default-until-discovered) and `calStickerPosition` (default `top-right`, chosen to avoid the day-number circle which occupies the top-left of each cell) settings on `minical`. Badge computation happens once per render (`stickerKidsByDate`, a date→kid Map for dedup) rather than re-filtering the whole stickers array per kid per cell. Data fetching (`fetchStickersForLayout()`) only runs at all if some calendar widget on the current layout actually has the toggle on — same "don't do work nothing's using" pattern `fetchTodoForLayout()`/`fetchShoppingListForLayout()` already use — wired into all three existing chore-data fetch points (initial load, the 5-minute periodic refresh, and the live-update handler for the `'chores'` broadcast topic, which stickers/rewards reuse rather than adding a new topic).

**Chore chart widget:** each kid's balance now sits next to their existing streak badge (`cc-streak`), reusing that class's styling rather than inventing a new one.

**Kid page (`/kids`):** a new header badge (icon reflects the kid's own sticker style, not a fixed ⭐) opens a sticker board overlay — same shell/pattern as the existing history overlay (`#hist-overlay` → `#sticker-overlay`, `openHistory()`/`closeHistory()` → `openStickers()`/`closeStickers()`). Shows recent stickers and rewards with affordability greyed out, but redeeming itself stays parent-only, in app.html — this page has never had a login (deliberately, so kids don't need the parent PIN to check off chores), and letting a kid spend their own balance unsupervised felt like a different trust decision than letting them view it, not something to fold into this ask silently. Worth raising with the developer explicitly if he wants that changed later.

**Parent app:** kid editor gained a sticker-style picker (star/avatar/custom, with the same emoji-picker escape hatch chore icons and avatars already have). New `openStickerSheet()` mirrors `openAllowanceSheet()`'s exact shape (balance up top, an action button, a form that appears inline, recent activity at the bottom) rather than a new layout pattern. Rewards get their own CRUD section on the Chores tab, reusing the chore editor's assignee-picker UI.

**A real bug caught mid-build, not shipped:** `apiFetch()` in app.html does NOT throw on a non-401 error response — it resolves with the parsed `{error: '...'}` body regardless of status code. My first pass at the redeem/give-sticker handlers used `try/catch` around `apiFetch()` expecting a throw on failure (e.g. "not enough stars"), which would have silently swallowed real server-side rejections and shown a generic success path instead. Caught by checking the actual `apiFetch` implementation rather than assuming, and fixed to the `if (r && r.ok) ... else showToast(r.error)` pattern the existing reassign-chore handler already establishes.

**Not done:** nothing here has touched a live server or real device — same standing caveat as this whole project's recent history. Specifically worth confirming before trusting this: the calendar badge's visual placement doesn't collide with the postit/icon decoration styles when both are active on the same widget at once (badge z-index was set above the postit note layer, but not visually confirmed); the auto-award path actually skips a chore correctly when `celebrate` is off; and that a kid picking "custom" sticker style with no emoji actually chosen yet doesn't render blank (falls through to the star default in the code, but not visually checked).

---

## Session update: sticker badge fixes — app-side settings panel, size/scale, top-left collision (v1.77.96-beta.3 through beta.5)

Three follow-up rounds on the sticker chart work above, each from the developer actually using it.

**beta.3 — the app's own Layout tab was missing the whole Stickers section.** Real gap, not cosmetic: `display.html` (wall display Live Edit) and `app.html` (Layout tab) are two completely separate, independently-built settings panels for the same widget — no shared module system between them, confirmed by the existing comment on `WIDGET_ADVANCED_TYPES` about each entry being "ported field-for-field" from app.html's implementation. beta.2 only added the toggle/position picker to the display.html side; the app.html side (`drawWidgetSettingsPanel()`'s `w.type === 'minical'` branch) never got the matching HTML or wiring. Added field-for-field to match, including the redraw-on-toggle so the position row's visibility updates (same pattern the existing Color Coding toggle already uses).

**beta.4 — badges weren't using `--ui-scale` at all.** The developer: "the stars need to be as big as the day numbers, or maybe an adjustable size?" Investigating turned up a real bug underneath the request, not just a sizing preference: `stickerBadgeHtmlD()` took a bare JS pixel number and baked it into inline styles at render time, while literally everything else pixel-based on this screen (including `.mc-daynum`, the day number circle sitting right next to it) is sized via `calc(Npx * var(--ui-scale,1))` so it stays correct across resolutions without needing a re-render. Fixed by changing the function's contract entirely — it now takes a full CSS length value (a string like `'16px'` or `'calc(16px * var(--ui-scale,1))'`), not a number, so callers control scaling instead of the function silently baking in a fixed size. The inner initial-letter font-size/padding use nested `calc()` against that same expression rather than JS multiplication, since a `calc()` string can't be multiplied in JS. Default size now derived directly from the day number's own formula (`fontPx * 2`, matching `.mc-daynum`'s width calc exactly) rather than an arbitrary constant. Added the adjustable slider the developer asked for as a fallback/override on top of that correct default, in both settings panels (same beta.3 duplication-by-hand reality).

**beta.5 — top-left badge position covered the day number.** The developer reported this directly, explicitly asked for a fix only ("don't build yet, just fix"). Root cause: `.mc-daynum` sits in **normal document flow** (not absolutely positioned) at the top-left of the cell — it's the first flex child, explicit width `calc(var(--cal-font) * 2)`, and flex-column's default cross-axis behavior places it at the start (left) since its explicit width prevents stretch. The top-left sticker badge was absolutely positioned at the cell's bare corner (`top:2px; left:2px`) with zero awareness of that circle, landing directly on top of it. Fixed by offsetting the badge's `left` to `calc(var(--cal-font) * 2 + 4px)` — the exact same formula the day number's own width is built from, so they can never collide at any font size, rather than a guessed fixed offset that would only work for one specific font size.

**Flagged, not fixed:** The developer separately guessed (correctly, on inspection) that a bottom-corner badge position could similarly collide with a day's "+X more" overflow indicator on a busy day. Confirmed the mechanism is real: `.mc-events` is `flex:1`, stacks top-down with no reserved bottom margin, and "+X more" is just its last line — on a day packed enough to fill the cell, that line ends up at the actual bottom edge, where an absolutely-positioned bottom badge (`z-index:2`) can land on top of it. Unlike the day-number fix, this can't be solved with a static formula — the event list's height is dynamic, and the badge size is now a per-widget adjustable setting (beta.4), so a real fix would need the cell to carry the configured badge size as a CSS custom property and have `.mc-events` reserve matching bottom padding only when a bottom position is active. Deliberately NOT built yet, per the developer's explicit "don't build yet" — this needs its own pass, tracked here so it isn't lost, not guessed at speculatively in the same turn as an unrelated confirmed-bug fix.

**Not done (still, across all three of these):** none of this has been checked on real hardware — same standing caveat as everything else in this project's recent history. The bottom-corner/+X-more collision above should be visually confirmed as an actual practical problem (vs. a theoretical one) before spending a full pass building the fix for it.

---

## Session update: new Favorites tab (v1.79.0-beta.1)

The developer's ask: a new landing tab ahead of Calendar, personally populated with user-added cards from commonly-used items — not a fixed dashboard, a picker-driven one. Clarified up front: add via a "+" picker (not swipe/long-press elsewhere), replaces Calendar as the first tab, and status cards should live-refresh while the tab is open.

**Data model:** one new table, `favorite_cards` (id, type, config JSON, sort_order). Deliberately server-side and shared for the whole household — same scope as kids/chores/rewards — not per-browser localStorage, so the tab looks identical regardless of which device opens the app. `config` is freeform JSON per type rather than a rigid column set, since the card catalog is expected to grow past this first pass (currently only one card type — the kid-shortcut card — actually needs a config value at add-time).

**Card catalog:** built as a JS object (`FAVORITE_CARD_DEFS`) rather than a database-driven registry — the catalog itself isn't user data, it's fixed inventory, same reasoning as `FONT_CHOICES`/`KID_AVATARS` elsewhere in this file. Each entry declares which shared data source(s) it needs (`needs: ['kids', 'weather', ...]`), a `render(card, data)` function, and a `wire(card, data)` function for interactivity. `renderFavoritesTab()` unions the `needs` across every card currently on the tab before fetching anything, so a household with two quick-action cards and nothing else never calls the weather API. Thirteen types shipped this round, covering all four categories from the brainstorm; the remaining ones discussed (Add To-Do, Allowance Payout, a Layout Editor shortcut, a specific screen's live URL/QR, an Add Device shortcut, an Upcoming Events card) follow the exact same pattern and are straightforward to add later — didn't build all of them this round given the scope already involved standing up the whole framework from nothing.

**Reordering:** up/down swap (`POST /api/favorite-cards/:id/move`, direction up/down, swaps this card's `sort_order` with its immediate neighbor) rather than full drag-and-drop or accepting a reordered id array from the client — deliberately the simpler, lower-risk primitive. A dedicated `move` endpoint also sidesteps any race between two browsers reordering at once, since each move is one atomic DB swap, not a wholesale "here's the new order" overwrite that could stomp a concurrent change.

**Live refresh:** copied `startScreensAutoRefresh()`'s exact shape (Devices tab) — a `setInterval` that checks `currentTab === 'favorites'` before refreshing and self-stops the moment that's no longer true. Full re-render on each tick rather than a partial DOM patch per card, since these cards are cheap to rebuild and this avoids maintaining two separate "build" and "update" code paths per card type — a real cost only if this tab ever needs to hold something expensive to fully rebuild, which none of the current 13 types are.

**Reused existing state carefully:** `add_chore`'s card calls the existing `openChoreEditor(null)`, which reads `_choreState.kids` for its assignee picker — that module-level variable is normally only populated by visiting the Chores sub-tab first. Populated it manually from the Favorites tab's own already-fetched chore-chart data right before opening the editor, rather than leaving the assignee picker silently empty if someone's never opened Chores this session.

**Empty by default, deliberately:** no starter/seed cards on a fresh table. The developer's own framing ("personally populated") argued directly against a pre-filled set someone would have to prune — matches how this app's other genuinely-new-data features (stickers, rewards) also started at zero for everyone rather than guessing at defaults.

**Not done:** same standing caveat as this whole project's recent history — nothing here has touched a live server or real device. One thing flagged as a guess while writing this note got checked immediately rather than left open: whether `current.temperature_2m` was safe to assume across all three weather providers. Confirmed directly — `getWeatherOWM()` and `getWeatherNWS()` both explicitly normalize to that same Open-Meteo field name server-side, specifically so a caller like this card never needs to branch per-provider. Simplified the card to rely on that rather than guessing with a `??` fallback chain. What's still genuinely unverified: general layout/legibility of the card grid on a real phone screen.

---

## Session update: user-facing "What's New" popup + BETA_CHECKLIST.md process (v1.79.0-beta.4)

Two related process additions, both aimed at the gap between "what got built" (this file, CHANGELOG.md) and two other audiences: real end users, and the developer's own pre-promotion review.

**"What's New" popup** — `RELEASE_NOTES` (app.html, near the top) is a hand-maintained, version-keyed object of short, plain-language bullets, deliberately separate from CHANGELOG.md's own developer-facing entries for the same versions. `checkForNewVersionPopup()` runs on every app boot (staggered at 900ms, between the tour's 600ms and the feedback popup's 1200ms — same "don't compete for first-paint attention" pattern both of those already use), compares the actual running version (`/api/version`) against `localStorage['last_seen_version']`, and if newer, shows one popup covering every version's notes in between — not one popup per version, so jumping several releases at once doesn't spam. A version bump with no `RELEASE_NOTES` entry just stays silent rather than showing an empty popup, so purely-internal changes don't need any special-casing. Never fires on a genuinely first-ever page load (nothing in localStorage to compare against) — that's deliberately left to the Getting Started tour instead, not this popup.

**Going forward, from this session on: every version meant to actually reach a real device needs a `RELEASE_NOTES` entry alongside its CHANGELOG.md entry** — same discipline CHANGELOG.md itself already established, just aimed at end users instead of a developer. Skippable for anything genuinely internal-only, same as CHANGELOG.md already allows.

**`BETA_CHECKLIST.md`** — a new file, purely for one question: "is this beta cycle safe to promote to stable yet?" Distinct from both CHANGELOG.md (what changed) and this file (why/how) — a running, cumulative, checkable list of what's worth actually testing on real hardware, organized by which beta build introduced each item. Backfilled retroactively with beta.1 through beta.3's own items, since the 1.79.0 cycle was already in progress when this file was introduced this session.

**Going forward: every beta build should add its own dated section to `BETA_CHECKLIST.md`**, listing what that build specifically touched and what's worth checking about it — same discipline as the CHANGELOG.md entry for that build, just framed as verification items instead of a description of the change. Items accumulate across a whole cycle; nothing gets removed just because a later beta shipped. **On promotion to stable, wipe the file back to the template section at its own bottom** (a fresh, empty "Currently open" list) rather than carrying a growing backlog into the next cycle — the template exists specifically so this reset is a copy-paste, not a rewrite.

**Not done:** same standing caveat as everything else in this project's recent history — nothing here has touched a live server or real device, including the popup itself, which is particularly hard to verify from code review alone since its whole trigger condition depends on real localStorage state from actual prior use. Flagged explicitly as its own checklist item in `BETA_CHECKLIST.md`'s new beta.4 section, not just noted here.

---

## Session update: promoted to stable as v1.79.1

The developer confirmed the beta line (through beta.4) checks out and asked to promote. Same discipline as every promotion before this one: a fresh, plain-numbered upload built from the beta.4 working tree, not a relabel.

This cycle had two distinct threads: Favorites card improvements (real weather forecast data instead of just current temp, secondary "view more" links on the quick-action cards, an overall compression pass, four new Home Assistant cards, and three more cards — Next Up, To-Do Count, Add a To-Do Item), and a font-slider bug hunt that grew well past its original scope.

**The font-slider bug is worth remembering in full, since it's a good example of "confirm before generalizing":** The developer reported the Agenda widget's font slider capped at 28px. Checking for identical cases first (not a broader audit yet) turned up three more widgets — Upcoming, Today, Tasks Combined — sharing that exact same 28px cap, clearly one shared bug rather than four coincidentally-identical design choices; fixed those four first as a clean, confirmed unit. A wider systematic comparison against `WIDGET_BASIC_SETTINGS` (the wall display's own on-screen quick-editor metadata table) then turned up ~20 MORE sliders across both files also capped below what that table listed. Rather than assuming that was the same bug and fixing all 24 in one pass, checked the RATIO between each slider's max and the metadata's max first — every single one fell in a tight, non-random 1.25x–2.0x band, with several exact repeats (eight widgets at precisely 2.00x, six at precisely 1.67x). That consistency is what one bug applied inconsistently over time looks like, not what independent per-widget judgment calls look like. Got the developer's explicit go-ahead before touching the other ~20, then fixed all of them — 40 slider instances total across both files, each one individually matched and verified as an exact single match before being written, specifically because `app.html` has a real id collision (Today and the built-in To-Do widget both use the HTML id `td-font-range`) that made blind find-and-replace dangerous. Re-scanned everything afterward and confirmed zero remaining mismatches.

**Not done:** same standing caveat as every promotion before this one — nothing in this release has touched a live server or real device beyond what's already been individually tested and reported back during the beta cycle (documented turn-by-turn in this file's beta.1–beta.4 entries above). Worth a specific real-device look before fully trusting this release: whether the widgets that got much larger font-size headroom (some going from a 28-48px cap up to 56-110px) actually render legibly and don't overflow their own containers at the new top end — a slider allowing a size was never a guarantee the widget's own layout logic handles it gracefully.

---

## Session update: promoted to stable as v1.79.2

A user-reported bug (a synced Google Calendar event's specific time landing 6 hours off — 1:00 PM UK showing as 7:00 AM) traced to `getLocalTimezone()` reading a `timezone` settings key that had no UI control anywhere and silently sat at its hardcoded `America/Chicago` default for every install. Fixed by consolidating onto the existing `timezone_override` setting (Settings → Display → Timezone), which was previously used only for chore-reset/briefing "what day is it" logic — one setting now drives both. Also overhauled that dropdown while in there: it now enumerates the full ~400-zone IANA list via `Intl.supportedValuesOf('timeZone')` (with a curated fallback for older browsers), each option labeled with its live UTC offset computed at render time so it stays correct across DST rather than a hardcoded label — and dropped the old "Custom…" free-text entry, since the list is now exhaustive enough that typing a zone by hand should never be needed.

**Worth remembering: TZID vs. Z-marked is the whole story here, and it's easy to conflate the two.** This fix ONLY affects events whose feed marks the time as plain UTC (`DTSTART:...Z`) — the conversion path that was silently broken. Events with a named zone (`DTSTART;TZID=America/Chicago:...`), which is what the overwhelming majority of real calendar feeds actually use (confirmed against the developer's own real iCloud feed: ~all `TZID=America/Chicago`, only 3 events out of the whole feed were `Z`-marked), are NOT converted at all — shown exactly as written, correct only by coincidence when the feed's own zone happens to match the display's. Changing the Timezone setting will never move a TZID event, even to a totally different zone — that's a known, documented limitation (see the `parseICS` doc comment), not something this fix touches. Came up explicitly this session: the developer tested by changing his zone and re-syncing his own real calendar and saw nothing move, which briefly looked like a regression — turned out his feed's only 3 `Z`-marked events were all already in the past (not visible on the default Events view), and everything else he was looking at was TZID and correctly inert to the setting by design. Good case study for explaining this distinction clearly to the developer up front on any future timezone work, rather than after confusion sets in.

**Not done — flagged explicitly to the developer before promotion, not glossed over:** unlike every other item in this cycle, this fix has NOT been confirmed to resolve the original reporting user's actual issue — we don't have their raw ICS feed, only their reported symptom, which matches this bug's exact signature (6-hour CDT-shaped offset) closely enough to be a confident diagnosis but not a verified one. The developer is shipping this to find out. If the user reports back that it's still broken, next steps: get their actual feed's `DTSTART` lines (same way we checked the developer's) before assuming a different cause — don't re-guess blind.

---

## Session update: promoted to stable as v1.79.3

The developer confirmed the beta line (through beta.7) checks out and asked to promote. Same discipline as every promotion before this one: a fresh, plain-numbered build from the beta.7 working tree, not a relabel.

This cycle grew well past its original scope, and the growth itself is the main thing worth remembering. It started as a single user-reported bug (international ZIP/postal codes not resolving in Weather setup). Fixing that surfaced a regression (a US ZIP colliding with an overseas postal code and silently resolving to the wrong country) that needed its own fix. Separately, the developer reported the Date widget's Date Format setting flashing to a new value then reverting — which turned out to have **three genuinely independent causes layered on top of each other**, each one real, each one only explaining part of what the developer was seeing:
1. A live-sync echo race on the wall display itself (beta.3) — saving a change broadcasts back to the same display that made it, and that echo could race ahead of the save actually committing.
2. Date Format wasn't a global setting at all (beta.4) — it only ever affected the standalone Date widget, so comparing it against Agenda/Mini Calendar looked like it "didn't take," and testing from the mobile app (which has no live-sync connection at all, so beta.3's fix was never relevant there) kept looking like a still-open bug for the wrong reason.
3. A slave/mirror sync race (beta.5) — only surfaced once the developer clarified he was testing on a host+slave setup: an edit forwarded to the host could get silently dropped by the slave's own re-sync logic if a background sync happened to already be in flight, with nothing else requesting a fresh pull until the next scheduled interval.

Even after all three, the developer reported the Date widget STILL continuously flickering — not just reverting once. That turned out to be a fourth, completely unrelated bug (beta.6): a per-second clock tick with its own separate, hardcoded US-format date string, silently fighting every real render. None of the first three fixes could ever have caught this, since it doesn't involve sync or live-update at all — just a timer nobody had looked at because the natural instinct after finding one real race condition is to assume the NEXT symptom is the same class of bug.

**The actual lesson, worth internalizing for next time a "revert" or "flicker" bug gets reported:** don't stop at the first plausible race condition found, especially if the reported symptom doesn't fully match what the fix should produce (a one-time revert vs. continuous flickering are different signatures pointing at different mechanisms). Ask early which surface/topology (single display vs. host+slave) is actually being tested — that question, asked only after two rounds of guessing wrong, would have pointed straight at the beta.5 mechanism immediately instead of after the fact. And when a fix doesn't fully resolve a report, resist folding the new investigation into confirming/extending the *previous* theory — treat it as a fresh "what else could cause this specific symptom" search, the way beta.6's tickClock discovery required.

Also in this cycle: Date Format's promotion from a Date-widget-only property to a real global setting (beta.4) came with a further request — per-widget overrides on the OTHER calendar widgets too (Mini Calendar, Agenda, Upcoming, Today), each defaulting to "Use global default" (beta.7), mirroring the Weather widget's established per-widget-override pattern. Verified the override chain directly (not just by inspection): an explicit per-widget override takes precedence, an unset one falls through to global, and each widget resolves independently of its siblings.

**Not done:** same standing caveat as every promotion before this one — nothing in this release has touched a live server or real device beyond what's already been individually tested and reported back during the beta cycle. The host+slave sync fix (beta.5) in particular only exists because the developer was testing on real multi-device hardware; it's exactly the kind of interaction that's very hard to find by code review alone on a single-device setup.

---

## Session update: Settings search (v1.80.0-beta.1)

Added a search box at the top of Settings so a user can find a setting without knowing which of the 20 accordion sections it lives in. Deliberately built as two separate layers rather than one:

1. **The index is auto-scraped from the live DOM**, not hand-maintained. `buildSettingsSearchIndex()` runs right after `transformSettingsToAccordion()` finishes building the accordion, and walks every leaf `.acc-section` for its label + toggle button + each `.settings-row`'s label text + (new) its ⓘ tooltip text, pulled from `window._infoTexts` by parsing the info button's `showInfoPopup('...')` onclick attribute. This means a newly added setting is searchable by its own literal wording the moment it ships — nothing to remember to update here.
2. **`SETTINGS_SEARCH_SYNONYMS`** is the only hand-curated part — about 90 everyday words (time, pin, kids, money, etc.) mapped to fragments that actually appear in the settings UI, so "time" surfaces Date Format/Timezone/etc. even though "time" itself isn't in either label. This is intentionally small and only needed for the "broad concept" gap; it's not a duplicate of the index.

`searchSettingsIndex()` requires every typed word to match (AND across words), where each word's own synonym group is OR'd — so "weather units" needs both "weather" and "units" to hit, not either. A literal label match ranks above a synonym-only match, so typing an exact setting name is still guaranteed the top result.

`jumpToSettingsResult()` deliberately reuses the SAME toggle buttons `wireAccordion()` already wired (`.click()` on the group button, then the section button) rather than re-implementing open/close state in a second place — the risk of a hand-rolled parallel version silently drifting out of sync with the real accordion's own state tracking wasn't worth it for what's ultimately just "open two things and scroll."

**Not done:** the usual caveat — built and syntax-checked (`node --check` on the extracted script block) but not yet touched on a real device. Flagged as beta.1's own section in `BETA_CHECKLIST.md` with concrete checks (exact-label match, synonym match, multi-word AND, empty state, nested-group jump, already-open jump, real-touchscreen tap targets/keyboard-covers-results check).

---

## Session update: "Support the Project" donation links (v1.80.0-beta.2, server v1.32.21)

Added an optional donation/support card, prompted directly now that the project is public (see the business-state note above). Two independent links — a Stripe Payment Link (one-time, distinct from the recurring `STRIPE_PRICE_ID`) and a PayPal link — configured centrally on `piazzahq-server` rather than per-device, so it's set once instead of per-install.

**Split across both repos:**
- **`piazzahq-server`**: `SUPPORT_STRIPE_LINK` / `SUPPORT_PAYPAL_LINK` added to `SETTINGS_FIELDS` (admin panel renders both automatically — no admin.html changes needed beyond the `SETTINGS_META` label/help text, since the settings UI is fully generic over that array) and a new public endpoint `GET /api/v1/support-links` returning whichever are set. Deliberately NO auth/license gate on this endpoint — a donation link is exactly the kind of thing that should still work for a trial or lapsed device, unlike the update-check/download endpoints it sits next to.
- **`piazzahq` (device)**: `fetchSupportLinks()` in `server.js` proxies that endpoint server-to-server (same reason as `fetchUpdateInfo()` — a browser-side call would hit CORS, since the mothership doesn't allow arbitrary cross-origin requests), with a 6-hour in-memory cache since these links change rarely and there's no reason to hit the mothership on every Settings tab open. A fetch failure falls back to the last cached value instead of clearing it — better to show a slightly stale link than none at all. Exposed to the frontend at `GET /api/support-links`.
- **`app.html`**: a new `.settings-row` inside the existing Feedback & Ideas section (deliberately not a new top-level section — no new entry needed in `SETTINGS_ICONS`/`SETTINGS_GROUPS`, and it keeps the "did I actually add real value or a whole vein of pain" bar the same as a real settings section would need) rendering a button per link that's actually set, hiding the whole card if neither is configured. Labeled "Support the Project" so it also picks up the existing settings-search index for free (searchable via "donate"/"coffee"/"paypal"/"tip" — added those to `SETTINGS_SEARCH_SYNONYMS`).

**PayPal is intentionally unfinished beyond "store and display a URL."** No webhook, no attribution back to a specific device/user, nothing PayPal-API-specific — the developer asked for the OPTION to add it later, not a full integration now. If a real PayPal integration (IPN webhooks, etc.) is ever wanted, that's new work, not something this session's plumbing already supports under the hood.

**Not done:** neither `SUPPORT_STRIPE_LINK` nor `SUPPORT_PAYPAL_LINK` has an actual value set on the real mothership yet — both env vars exist and the code path is ready, but the card will show as hidden on every real device until the developer pastes an actual link into `/admin` → Server settings → Support & Donations and restarts the server (same restart-required caveat as every other `.env`-backed setting on this server). Also not yet touched on a real device, same as every other item in this beta cycle.

---

## Session update: self-update false-failure fix (server v1.32.22)

Confirmed live, not theoretical: the developer applied the v1.32.21 update (the Support & Donations release above) via `/admin` → "Update this server," and it showed a bare `"Self-update failed."` with no reason — but the update had actually succeeded (confirmed by reloading `/admin` and seeing v1.32.21 live).

**Root cause, traced from the exact wording of the error rather than guessed:** `"Self-update failed."` (period, no colon, no reason) only ever comes from `admin.html`'s hardcoded fallback text — the backend endpoint (`POST /api/admin/self-update`) always sends a specific reason string on a real failure. Getting the generic fallback instead means the browser never received a parseable JSON response at all. The endpoint runs `unzip` + file-copy + a synchronous `npm install` (via `execFileSync`, own internal timeout 180s) BEFORE writing any HTTP response. The mothership sits behind a Cloudflare Tunnel (`deploy-gcp.sh`), whose edge has its own timeout on tunneled connections shorter than that worst case. If the round-trip ran past Cloudflare's timeout, Cloudflare serves its own timeout page instead of the origin's real response — the frontend can't parse that as JSON, `data.error` comes back empty, and the generic fallback fires — even though the Node process on the VM itself was never killed and kept running to completion (restart included) the whole time.

**Fix: taught the admin page to distinguish "genuinely failed" from "succeeded, but the confirmation got lost in transit."** Before reporting either a non-JSON response or a thrown connection error as a failure, it now polls `/api/admin/me` for up to 10s checking whether the server is already running the version that was being applied. If so, shows success (with a note explaining why the confirmation was late) instead of a false alarm. A real failure still correctly falls through to the actual error after that same check — this only changes how a successful-but-unconfirmed update gets reported, nothing about failure detection itself.

**Worth remembering for next time this comes up:** the diagnostic move that actually found this was reading the EXACT error text character-for-character before guessing at causes — the missing colon+reason was the tell that pointed straight at "response never arrived" rather than "code threw an error," which in turn pointed at the tunnel/proxy layer rather than anything in the self-update logic itself. Also worth knowing going forward: this same blocking-npm-install-before-responding pattern exists in TWO other places in this codebase (`/api/admin/releases` upload validation, and `piazzahq/server.js`'s own `/api/install-server`) — neither has hit this specific symptom yet, but the same tunnel-timeout risk applies to any of them if a future `npm install` there ever takes long enough. Not fixed preemptively this session (no confirmed failure yet), just flagged here so it's not rediscovered from scratch if it ever does surface elsewhere.

**Not done:** the underlying slowness itself (long synchronous `npm install` blocking the response) is untouched — this session only fixed how a slow-but-successful case gets REPORTED, not the fact that it's slow. If Cloudflare's timeout is ever short enough to cut off updates that need a REAL (not just no-op) `npm install`, e.g. a future release that adds a new dependency, that could still show as a false failure that then resolves within the 10s poll — worth watching for, but not a scenario that's been hit yet since this cycle didn't change any dependencies.


---

## Session update: AM/PM Style setting + new Date & Time widget (v1.81.2-beta.4, alignment regression fixed in beta.5, Compact removed + date-row fix in beta.6, seconds/am-pm layout in beta.7-8)

Two feature requests off the same admin-panel feedback screenshot: the calendar grid was showing event times jammed in all-caps ("7:15PM"), and a request for a DakBoard-style combined clock/date/temp card.

**AM/PM casing was hardcoded, not a setting — fixed the same way `week_start_day` already handles a global-default-with-per-widget-override.** `fmtTime()`, `renderClock()`/`tickClock()`, and `formatRadarFrameTime()` all had `'PM'`/`'AM'` literals baked in. Added `ampmCase(override)` (mirrors `weekStartDay(override)`'s exact shape — global `ampm_case` setting, default `'lower'`, optional per-widget `'upper'`/`'lower'` override) and threaded it through: `fmtTime(t, override)`, `buildEventRow()`'s new `ampmCaseOverride` opt (used by Agenda/Upcoming/Today, each with its own field: `agAmpmCase`/`upAmpmCase`/`tdAmpmCase`), the Mini Calendar grid and agenda-note lines (`calAmpmCase`), and the Clock widget (`clockAmpmCase`, plus a `data-ampm` attribute on the wrapper so `tickClock()`'s per-second in-place update can read it — same trick already used for `clockTimeFormat`/`data-format`). Added a shared `ampmCaseOverrideRowHtml()` helper in both `display.html` and `app.html`, mirroring the existing `dateFormatOverrideRowHtml()`. `ampm_case` added to `defaultSettings` in `server.js` and to the global Settings → Display panel in `app.html`.

**Known gap, not fixed:** `app.html`'s own standalone mobile "Events" tab has its own separate `fmtTime()` that doesn't cache global settings the way the rest of the file does (it re-fetches `/api/settings` ad hoc per-section instead of once), so it's left hardcoded lowercase rather than wired to the toggle. Small, isolated, would need a small refactor — not urgent since it's a secondary preview list, not the actual display.

**New `datetime` widget type — combined clock + date + optional temperature, three styles.** Deliberately reuses the exact helpers the standalone Clock/Date/Weather widgets already use (`use24Hour()`/`ampmCase()`, `globalDateFormat()`/`formatDateFull()`, `weatherForWidget()`/`formatTemp()`) rather than any new formatting logic, so it can't drift out of sync with what those widgets already show for the same settings. Three `dtStyle` presets via CSS classes (`w-datetime-classic/-split/-compact`): Classic (big time, seconds+AM/PM stacked, date below, temp below that — the DakBoard layout that was asked for), Split (time and date/temp side by side, for a wide short box), Compact (one line, for a small corner tile). Seconds tick in-place via `tickClock()`, same "update the DOM directly, don't re-render the whole widget every second" approach the standalone Clock already uses, reading `data-format`/`data-ampm` off the wrapper the same way.

**Left/Right alignment (`dtAlign`) — worth understanding WHY this actually works before touching this widget's CSS again:** `.w-datetime` itself has no explicit width; the outer `.widget` wrapper (`display:flex; flex-direction:column`, no `align-items` set, so it defaults to `stretch`) stretches it to the FULL widget box width regardless of style. That's what makes `align-items:flex-end` (Classic/Split, column layout) or `justify-content:flex-end` (Compact, row layout) actually move the content to the right edge of the box, rather than just re-aligning text within an already content-sized element. `.dt-date`'s two lines (day name vs. the longer full date string) also get `text-align:right` + `align-items:flex-end` when right-aligned, so their right edges line up instead of their left ones.

**Correction, found the next session:** the above was the intended design, but it initially shipped broken — `.w-datetime`'s base rule set `align-items` without ever declaring `display:flex` on itself. `align-items`/`flex-direction`/`justify-content` are all silent no-ops on a non-flex element (no console error, they just do nothing), so none of Classic's, Split's, or Right-alignment's positioning ever actually took effect. Split never laid out side-by-side at all — it silently fell back to stacking exactly like Classic, the whole time. This went unnoticed because Classic's default LEFT alignment happened to look identical either way (normal block-layout stacking is already left-aligned by default), so it took someone actually trying right-alignment to expose it. Fixed by adding `display:flex; flex-direction:column;` to the base `.w-datetime` rule — every other declaration in this widget's CSS was already correct, it just had no flex container to apply to. **Lesson for next time:** on any widget using `align-items`/`justify-content`/`flex-direction` for layout, verify `display:flex` (or `grid`) is actually declared somewhere in that same element's applied rules before trusting that those properties are doing anything — they fail completely silently otherwise, and a left-aligned-by-default layout can mask the bug indefinitely.

**Second correction, same session it turns out — that "fix" above caused a real regression, confirmed on an actual display.** Making `.w-datetime` itself `display:flex; flex-direction:column` turned `.dt-time` from an ordinary full-width block into a flex ITEM. A non-stretched flex item sizes to its own preferred content width rather than the block's previous fill-available-width behavior — and at large font sizes, that preferred-width calculation for a NESTED flex row (`.dt-hm` + `.dt-seconds` + `.dt-ampm` inside `.dt-time`, itself `display:flex`) doesn't reliably keep everything on one line the way a plain block box does. Visibly: Classic's time split into separately-sized chunks ("05" / "29 am" instead of "5:29 am" together) as soon as alignment was actually tried on real hardware. **Correct fix, this time verified against beta.3's actual rendering rather than reasoned about from the spec:** revert `.w-datetime` itself back to plain block (byte-for-byte the same box model beta.3 had for Classic — not just visually similar), and instead put `justify-content:flex-end` directly on `.dt-time` and `.dt-sub`, which were ALREADY flex containers on their own regardless of their parent's display mode. A block-level flex container still fills its parent's width by default; `justify-content` on it moves its own content to either edge without changing its own sizing or its parent's layout mode at all — which is the part the first fix got wrong by reaching for a container-level `align-items` solution when a narrower, already-flex target existed. Split's `.dt-sub` needed one exception: it's `flex-direction:column` there (date over temp, not beside it), so its cross axis is horizontal and needs `align-items` for right-alignment, not `justify-content` (which is the main/vertical axis in a column container and would move it up/down instead). **Broader lesson, layered on the one above:** "the CSS mechanism is textbook-correct" is not the same as "verified against the specific rendering it's replacing" — reasoning about flex behavior from first principles missed a real, hardware-confirmed regression that a side-by-side comparison against the actual beta.3 screenshot would have caught immediately. When a fix changes a container's `display`/layout mode (not just adds a missing property to an unchanged one), that's a strictly bigger blast radius than the bug being fixed, and deserves the same "did the working case actually stay working" scrutiny as the broken case getting fixed.

**Registration checklist for this widget type, if it needs touching again:** `WIDGET_DEFS` + `WIDGET_CATEGORIES` (both files), the add-widget default-fields chain (`buildNewWidgetDefaults()` in `display.html`, the `def.type === 'datetime'` block in `app.html`'s palette-click handler), the `renderWidget()` dispatch switch (`display.html` only — `app.html` doesn't render widgets itself), and the advanced-settings render+wire pair registered in the Live Editing dispatch chain (`display.html`) plus the `typeSpecificHtml` if/else chain (`app.html`) — same ~4-5 touch points every other widget type in this codebase needs, nothing DateTime-specific about the list itself.

**Third correction, beta.6 — two more things found once this was actually looked at on real hardware.** (1) Compact (the one-line style) didn't hold up visually at real font sizes — removed entirely rather than tuned: dropped the dropdown option in both files' settings panels and its CSS block. Anything already saved with `dtStyle: 'compact'` just falls back to Classic's plain rendering since there's no matching CSS class anymore — no migration needed, nothing to crash, it's a beta-only option that was live for two versions. (2) Right-aligned Classic still had the date row falling short of the time row's right edge above it — NOT the same bug as beta.5's regression, a different one: `dt-sub`'s markup order is date-then-temp, so in a plain right-justified row TEMP (the last DOM child) lands at the true right edge and DATE sits short of it by temp's own width, even though `dt-sub` as a whole was correctly flush right. Fixed with a CSS `order` swap (visual order only — the markup itself, and everything else that reads it, is untouched) so date renders last/rightmost when right-aligned, with temp shifted to its left instead. Split's date/temp stack in a column there, not a row (see the beta.5 correction above), so this exact issue is Classic-specific; scoped the fix accordingly rather than applying it everywhere out of caution.

**Verified on real hardware as of beta.6** (screenshots from the actual display, not just `node --check`) — Classic confirmed matching beta.3's rendering with right-alignment now genuinely working, including the date-row fix above. Split has not been screenshot-checked yet; worth a look before calling this fully done.

**Beta.7:** seconds+am/pm layout changed to match the original DakBoard reference photo — stacked (seconds on top, am/pm below, both to the right of h:mm) instead of side by side, which is what it actually looked like once seconds got turned on and compared against the reference. Scoped narrowly: only the both-shown-together case changed markup (wraps them in a new `.dt-suffix` column flex span); seconds-alone and am/pm-alone paths are untouched. `tickClock()`'s per-second update needed no changes at all — it locates `.dt-seconds`/`.dt-ampm` by `querySelector`, which finds them regardless of nesting depth, so the extra wrapper span is invisible to it.

**Beta.8:** the beta.7 stack looked right in isolation but sank too low once actually compared against the time — `.dt-time`'s `align-items:baseline` was still governing `.dt-suffix` as a whole flex item, aligning the BOTTOM of the two-line stack (am/pm) with h:mm's baseline, rather than pinning the TOP (seconds) to the top of the digits like the reference photo's superscript look. `align-self:flex-start` on `.dt-suffix` overrides just that one item's cross-axis alignment without touching `dt-hm` or anything else in the row. **Pattern worth remembering:** a flex row's `align-items` sets the DEFAULT for every child, but any individual child can opt out with its own `align-self` — useful any time one item in a row needs different vertical treatment than its siblings, which is exactly this case (h:mm wants baseline, the stacked suffix wants top).

---

## Session update: Update timing (Immediate default / Scheduled daily install) (v1.81.4-beta.2)

New request, unrelated to the Date & Time widget work above: an update scheduler, so a device can wait for a chosen daily time to install rather than the instant a release is found, with a manual Check/Update fallback for that mode.

**Found before writing anything: this already half-existed, deliberately removed.** 1.39.3's changelog entry ("Removed: the manual/automatic update choice") explains exactly why — "Updates now always install automatically in the background — there is no setting that can leave a device stuck on an old version," and it stripped Settings → Software Update down to just the version number and license key, removing the Manual/Automatic dropdown, beta-channel toggle, "Update now"/"Check again" buttons, and more. `periodicUpdateCheck()` (checks ~90s after boot, then every 6 hours) already installs unconditionally the moment it finds something — that's the ENTIRE "Immediate" mode this request wants as the default, already built, no changes needed to it beyond one added mode check.

**Didn't just revert 1.39.3 — the new Scheduled option specifically preserves what that removal was actually protecting against.** 1.39.3's real goal was "nothing ever keeps running an outdated version," not "installs must happen the instant a release exists." A daily scheduled time still guarantees the first goal (it can't be left indefinitely on Manual with no auto-install at all, which is what 1.39.3 actually killed) while fixing the real complaint driving this request — an update landing mid-use. Scheduled is opt-in; Immediate stays the default and is byte-for-byte the same code path as every version since 1.39.3.

**Scheduled mode needed its own precise timer, not just a flag check inside the existing 6-hour cadence.** `periodicUpdateCheck()` runs at ~90s-post-boot-then-every-6-hours, which almost never lands on an arbitrary chosen minute like 3:00am — a device that boots at 2pm would only ever check at 2pm/8pm/2am/8am. `scheduleNextDailyUpdateInstall()` instead computes the exact ms until the next occurrence of the chosen time (today if still upcoming, tomorrow otherwise) and arms a dedicated `setTimeout` for that moment specifically, doing its own fresh `fetchUpdateInfo()` when it fires rather than trusting whatever `periodicUpdateCheck()` last happened to see. Re-arms itself after every fire (whether or not anything installed) and, via a new hook in `PUT /api/settings`, immediately on any change to either `update_schedule_mode` or `update_schedule_time` — without that hook, flipping the setting wouldn't take effect until the device's next restart, silently leaving the OLD schedule running underneath a Settings UI that claims otherwise.

**Extracted `downloadAndInstallUpdate(info)` as a shared helper** (download-to-temp + `installFromZip()` with the same no-op `res` stub `periodicUpdateCheck()` already used) — both the immediate path and the new scheduled-timer path call it, rather than duplicating the download+install sequence a second time.

**The manual Check/Update buttons are the one piece that's genuinely new UI, not a repurposed old one, and only show in Scheduled mode.** Immediate mode still has nothing to manually manage — same reasoning 1.39.3 removed the equivalent controls for in the first place, preserved here by scoping visibility to Scheduled specifically rather than restoring them unconditionally. "Check for Updates" reuses `/api/update-check` (the same endpoint the top banner's `checkFleetUpdateStatus()` already polls every 10 minutes). "Update Now" reuses `/api/update-from-server` and the same restart-can-look-like-a-network-error handling `installUpdateFromBanner()` already has — kept as its own separate implementation targeting the Settings-tab status area, rather than refactored to share code with the banner function, for the exact reason that function's own comment already gives for not reusing Settings' `pollForReturn`: it closes over banner-specific DOM elements (`server-update-banner`) that don't exist wherever this runs instead.

**Not yet verified on real hardware.** `node --check`-clean on both files' inline scripts and `server.js`, but the actual daily-timer firing, the settings-change re-arm, and the Immediate↔Scheduled UI toggle haven't been watched happen on an actual device yet — worth confirming the timer math (especially the day-rollover case) against a real clock before trusting it unattended.


---

## Session update: Copy & Replace stale-on-slave bug — traced to a real architectural gap (v1.81.5-beta.6)

Started as "the widget copy feature doesn't work right," ended up being a systemic bug in every write made from a slave/mirror device — worth a full write-up since it's the kind of thing that'll bite something else eventually if it isn't understood, not just patched.

**Diagnostic path, in order, since each ruled-out theory is useful context if this shape of bug ever comes up again:** editor showed the new widgets correctly, but the physical display kept showing old ones "hidden in the background." Confirmed via targeted questions rather than guessing: (1) a full RELOAD of the display didn't fix it — ruled out live-update-propagation/SSE issues, since a reload does a from-scratch fetch+render with none of that machinery involved. (2) Orientation was confirmed to match on both sides — ruled out the "edited landscape, TV is actually running portrait" mundane explanation. (3) `.locked` widgets, checked directly in code — only ever affects drag/resize protection in the editor and Live Editing; no code path anywhere lets a locked widget survive a replace or a fetch. (4) The success toast showed cleanly, no error — ruled out a silently-rejected save (the beta.5 fix's own target) actually being the culprit this time. (5) Decisive test: a full reload of the PHONE APP, not just the TV, ALSO showed stale data. Since the phone app and the display hit the exact same `GET /api/layouts/:orientation` endpoint, both being wrong ruled out every remaining client-side theory at once and pointed straight at the server.

**Root cause: this household runs a multi-device host/slave (mirror) setup, and the device being edited is a slave.** The routing has a real asymmetry: writes on a slave get proxied to the host (`proxyWriteToHost()`), but reads are NEVER proxied — `GET` always hits the slave's own LOCAL database, regardless of how caught-up it is with the host. `proxyWriteToHost()` kicked off `runSyncOnce()` (pulls the host's data back down locally) but never awaited it — `res.json(out.json)` fired the instant the HOST confirmed the write, which could be well before this device's own copy had caught up. The client's `{ok:true}` was completely honest — the write really did succeed, on the host — but nothing about that response meant "and this specific device already has it," which is what a subsequent read from that same device actually needs to be true.

**Why beta.5's fix (await the save, check `r.ok`) didn't catch this:** it was awaiting the right promise chain, but the promise it was awaiting had nothing to wait FOR — the host's response came back real and successful; the gap was entirely on the OTHER side of that response, inside `proxyWriteToHost()`, which beta.5 never touched.

**Fix: made `proxyWriteToHost()` actually await the sync-back before responding**, and split a new `syncDataOnly()` out of `runSyncOnce()` — just the fetch + `applySyncSnapshot()` transaction, deliberately excluding `syncPhotoFiles()` (can legitimately take a while transferring actual photo binaries) and `registerWithHost()` (a presence heartbeat), neither of which affects whether the DATA a write just changed reads back correctly. A write only needs to wait for data, not photos. The periodic background timer still calls the full `runSyncOnce()` (data + photos + heartbeat) exactly as before — this only changed what a WRITE waits for before responding. If the sync-back itself fails, the write still isn't lost (the host has it — still the source of truth), but the response now carries a `syncWarning` field instead of a bare `{ok:true}` that wouldn't match what's still on screen. Copy & Replace's own toast checks for it.

**Known gap, not fixed:** `syncDataOnly()` doesn't take the `_syncing` lock the periodic sync uses, so if a write's sync-back happens to overlap with the periodic timer's own sync, both independently fetch the host's snapshot — SQLite serializes the actual writes safely underneath (no corruption risk), just occasionally redundant network/DB work. Left as-is rather than adding a shared-in-flight-promise mechanism for what should be a rare, harmless overlap — worth revisiting if it ever turns out to matter in practice.

**Broader lesson, worth keeping in mind for anything else in this host/slave architecture:** "the write succeeded" and "this device's own copy reflects it" are two genuinely different claims here, and the code was only ever making the first one explicit. Any future proxied-write endpoint that doesn't go through `proxyWriteToHost()`'s now-fixed path should be checked against the same question.


---

## Session update: Copy & Replace's ACTUAL bug — duplicate event listeners, not the sync issue (v1.81.5-beta.7)

Same reported feature, third round. beta.5 and beta.6 above were both real fixes for real bugs (a save that silently reverted on rejection with no error shown; a slave device's local copy not being caught up before responding) — but a follow-up report ("still the exact same symptoms, but now the confirm() dialog asks 5 times, and afterward NOTHING shows up on screen, not even the old widgets") made clear neither of those was actually what this specific person was hitting.

**5 repeated confirm() dialogs on one click is close to a textbook symptom for one thing: the same click handler registered multiple times on the same DOM element.** That reframed the search immediately — not "why is data stale," but "why is this handler wired more than once."

**Found it fast once reframed: `copy-widgets-overlay` (the modal) lives at the top level of the page, outside `layout-subtab-content` — the div `drawEditor()` replaces wholesale via `.innerHTML =` every time it runs. `layout-copy-from-btn` itself is INSIDE that div, so it's a fresh DOM node every single `drawEditor()` call — re-wiring its listener each time is completely safe, exactly like `layout-save-btn`/`layout-reset-btn` right next to it.** But the modal's own buttons (`cw-close-btn`, `cw-load-btn`, `cw-copy-btn`, the orientation toggles) are static markup that never gets recreated — and the original code wired ALL of them from inside `drawEditor()` too, alongside the open-button. Every time `drawEditor()` ran again (switching displays, switching orientation, leaving and re-entering the Editor sub-tab), it added ANOTHER complete set of listeners on top of the SAME persistent nodes, with nothing ever calling `removeEventListener` on the old ones. A user who'd switched displays or orientations 5 times before trying this feature would get exactly 5 confirm() dialogs on the very next click — and, far more damaging, up to 5 REAL overlapping PUT-then-sync-back cycles firing back to back, each with a freshly-generated but DIFFERENT widget-id set (`nextId()` isn't idempotent between calls), racing the server and this device's own sync-back against each other. That's what corrupted the layout down to genuinely empty rather than just stale — not a new class of bug, but beta.6's own `syncDataOnly()` colliding with itself: its doc comment explicitly called concurrent overlapping calls "a rare, harmless edge case," written without knowing a client-side bug could make 5-way concurrency the NORMAL case for this specific button.

**Fix: moved every piece of the modal's internal wiring — close, orientation toggle, load, the copy-and-replace handler itself — out of `drawEditor()` into its own function that runs exactly once**, matching the pattern `feedback-popup-overlay` already uses elsewhere in this same file (a top-level `(function wireFeedbackPopup() {...})();` IIFE, executed once when the script itself parses, not from inside any per-tab-render function). `drawEditor()` now only re-wires the open trigger (`layout-copy-from-btn`), which was never the problem since it's genuinely recreated every render. The one thing that needed threading through: the modal's internal code referenced `displays`, a parameter local to `drawEditor()`'s own closure — swapped for `_editorAllDisplays`, a page-level variable that's already kept in sync with the same data (set in `renderLayoutEditorSubTab()` right before it calls `drawEditor(displays, ...)`), so the standalone function has everything it needs without `drawEditor()` having to hand anything to it.

**General lesson for this codebase specifically, given how many features use the same top-level-overlay pattern (`modal-overlay`, `feedback-popup-overlay`, and now this one):** any new overlay's OWN internal wiring belongs in a one-time IIFE parsed alongside the markup, never inside a function that redraws per-tab or per-selection. The trigger button that OPENS an overlay can safely live wherever it's drawn (including inside a redrawn tab, if that's where it naturally belongs) as long as opening it just calls a shared, single, top-level `open*()` function rather than containing any of the modal's own logic directly. Worth a quick audit of anything added to this file between when this pattern was established and now, in case the same mistake happened somewhere else without yet producing a symptom as obvious as "asks 5 times."


---

## Session update: the ACTUAL final layer of the Copy & Replace saga — a correctness bug in my own beta.8 "fix" (v1.81.5-beta.9)

Fourth and (so far) final round on the same feature. beta.7 fixed a real, serious bug (duplicate listeners causing repeated confirms and racing writes). But afterward, the person reported the exact original symptom was STILL happening — editor correct, mirror device's display still stuck on the pre-edit layout — describing it as, paraphrased, "is it possible you're overthinking how this has to work?" That question was worth taking seriously rather than defending the pile of fixes already made.

**Diagnostic reset, deliberately going back to basics instead of adding a fifth theory:** does a completely normal drag-edit (nothing to do with Copy & Replace) show up on the display? No — same symptom, on that same one profile, meaning it was never actually specific to the copy feature at all; it just happened to be the feature being tested when it was first noticed. Does it happen on OTHER layouts/profiles too? No — everything else works. Does it happen on a completely fresh, brand-new profile (no history to be tangled up in)? Still broken — on the mirror. The exact same fresh-profile test on the HOST: works seamlessly. That last comparison was the turning point — it isolated the bug to the host/slave proxy+sync path specifically, with everything else (screen assignment, ambient mode, the general SSE/render pipeline, the browser being on the right IP) checked and ruled out one at a time first, each because guessing wrong again would've meant another round of this.

**Then the actual test that found it: do a Copy & Replace, confirm the app shows a clean, warning-free success (meaning `syncDataOnly()` itself reported `synced: true`, no `syncWarning`), then IMMEDIATELY hard-reload the display. Still showed the old layout.** Given the write, the sync-back, AND a fresh reload had all now been directly confirmed/ruled out one at a time, the only place left to look was whether "the sync-back reported success" and "the sync-back's data is actually fresh" were secretly two different claims — they were.

**Root cause, and it's beta.8's own fault:** that same session had added deduplication to `syncDataOnly()` — concurrent calls piggyback on whichever fetch was already in flight, to cut down on redundant full-table resyncs. Reasonable-sounding, and even correctly reasoned against a REAL problem (the beta.7 bug could fire 5 of these at once). But `scheduleChangeWatch()` — a background job, unrelated to any bug, that's been in this codebase since before this session — polls the host every 1.5 seconds during active editing specifically and independently triggers this exact same sync path. If THAT background fetch had already started (already querying the host) before a write's own PUT reached the host, and the write's own confirmation call for `syncDataOnly()` landed while that older fetch was still in flight, piggybacking returned a "success" built from data that predated the very write it was meant to be confirming. The client got an honest `{ok:true}` from a function that was itself lying to it about what it had actually confirmed.

**Fix: reverted the dedup entirely.** Every call to `syncDataOnly()` now does its own independent fetch again — the only way to actually guarantee a caller gets data that reflects the specific write it's confirming. The "wasted work from concurrent calls" beta.8 was solving for is real but minor (an extra network round-trip + DB transaction); a function whose success return value doesn't mean what its caller needs it to mean is not a minor problem, and it directly undermined the ENTIRE POINT of the beta.6 fix (awaiting the sync-back so a write's response is trustworthy) two versions earlier without anyone noticing until a live device surfaced it.

**Broader lesson, and it's really about the danger of a plausible-sounding optimization more than about sync code specifically:** beta.8's dedup wasn't a bug because the reasoning was wrong — the reasoning (repeated concurrent full resyncs are real, unnecessary load) was correct. It was a bug because deduplicating a function's WORK is not the same as deduplicating its RESULT, when different callers need that result to mean "reflects a specific, particular change" rather than just "the data is probably reasonably fresh." Any future change to a function whose return value is trusted as a correctness signal (not just a completion signal) needs to ask, specifically: could this exact optimization return a technically-successful result that doesn't actually satisfy what the caller is relying on it for? That question would have caught this before it shipped.

**Also worth remembering for its own sake:** partway through this round, the mirror device appeared to go completely dark (app broken, SSH failing) right as this was being chased, which briefly looked like it might BE the actual cause (repeated heavy writes damaging the SD card). It turned out to be an unrelated reimage with a new Tailscale IP — genuinely nothing to do with any of this. Good reminder that a scary-looking coincidence during an active debugging session isn't evidence on its own; it's just worth asking about directly rather than assuming, which is exactly what happened here before any code went into fixing an outage that didn't exist.


---

## Session update: Reminders — new widget + calendar-grid + Agenda integration, one shared data model (v1.81.6-beta.6)

Feature request originated as a specific idea ("trash/recycling day widget") that got deliberately generalized before any code was written — the actual ask, once talked through, was a generic rotation reminder system that trash/recycling day is just the first use of, not a trash-day-specific feature. Worth remembering that reframing happened BEFORE implementation, not as a refactor after: the schedule model (`weekly` days-of-week, or `interval` every-N-days-from-a-date) has nothing trash-specific in it anywhere.

**Design process, worth preserving:** built four rendered CSS mockups (Banner/List/Hero/Weekly-strip) as a standalone HTML artifact BEFORE writing any real widget code, using the actual theme tokens pulled from `display.html` (`--bg`, `--accent`, etc.) rather than guessing at a palette, specifically so the mockups would look like genuine options rather than generic UI-kit renders. Asked which one before building — answer was "all four, I like them all," so all four shipped as selectable styles rather than picking a winner. Same pattern already established for the Date & Time widget's Classic/Split — a "this widget has genuinely different layout modes, not just size sliders" widget is now a repeated, working pattern in this codebase, not a one-off.

**Data model:** new `reminders` table (id, name, icon, schedule_type, schedule_config JSON, active), full CRUD, participates in the host/slave sync snapshot exactly the way `events` does (`buildSyncSnapshot`/`applySyncSnapshot`/`SHARED_TOPICS`) — this was deliberate, not copied blindly: reminders are household-shared data, same category as events/photos/layouts, not per-widget or per-display config, so they needed the same sync treatment events already get, and the recent host/slave sync saga (see the beta.5–9 entries above) meant this got real scrutiny before shipping, not just a copy-paste of the existing pattern.

**One shared pair of helpers is the load-bearing piece of this whole feature:** `reminderOccursOnDate(reminder, dateStr)` and `nextReminderOccurrence(reminder, fromDateStr, maxDays)`, defined once in `display.html`, called from the Reminders widget itself, the Mini Calendar's day-cell badges, and the Agenda integration. Every surface that shows "is X due" reads the same two functions — there's no way for the widget and the calendar grid to disagree about what's due on a given day, because there's only one place that decision is actually made. Worth keeping this invariant if this feature grows (e.g. a Today/Upcoming widget integration later) — always call into these two functions, never reimplement the schedule-matching logic at a new call site.

**Calendar-grid badges deliberately reuse the EXISTING sticker-badge system's shape rather than inventing a second one:** same opt-in-toggle convention (`calShowStickers` → `calShowReminders`), same position/size settings pattern, same corner-positioning CSS approach (`.mc-sticker-badges.pos-*` → `.mc-reminder-badges.pos-*`), default position deliberately set to the OPPOSITE corner (top-left vs. stickers' top-right) specifically so a household using both doesn't get visual collision without needing to think about it. A day cell now supports two independent opt-in badge systems side by side without either needing to know the other exists.

**Agenda integration went slightly further than a literal reading of "show it near events" would have:** reminders can create their OWN day-group in the Agenda list, not just attach to a day that already has a real event. "Trash today" matters exactly as much on a day with nothing else scheduled as on a busy one — arguably more, since a busy day already has other things drawing attention to it. Implemented by stashing a `._reminders` array directly on the `groups[date]` array object (arrays are objects in JS; an extra named property doesn't affect `.map()`/`.length`/anything else that treats it as a plain array) rather than a parallel data structure, keeping the existing grouping/sorting logic completely untouched.

**Manage Reminders (the actual add/edit/delete UI) is where the biggest process lesson of this whole build lives:** it was built as a standalone, wired-exactly-once panel/modal from the START, on both `display.html` and `app.html` — specifically because this exact mistake (a persistent modal's internals wired from inside a function that reruns every time a widget's settings panel opens) is THE bug that took multiple beta rounds to fully run down for Copy From Another Layout earlier this same session (see the beta.7 entry above — "asks to replace 5 times"). Getting it right the first time here, rather than shipping the naive version and rediscovering the same failure mode independently, is the concrete payoff of writing that lesson down where the next session (or this one) would actually see it before making the same choice again.

**Known scope boundaries, not gaps — deliberate for v1:** no Today/Upcoming widget integration yet (Agenda only, since that's what was actually asked for); no recurring-reminder history/completion tracking (a reminder just tells you it's due, nothing marks it "done" the way a chore does); Mini Calendar Agenda-layout and Strip-layout views weren't touched, only the Grid/Month view's day cells. All straightforward to extend later using the same two shared helper functions — noted here so a future "can reminders also show in Upcoming" request starts from "call `reminderOccursOnDate()` from a new call site" rather than re-deriving the schedule-matching logic from scratch.


