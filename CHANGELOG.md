# Changelog

All notable changes to Piazza HQ (formerly Pi Calendar). The central server
reads the top matching section here to pre-fill release notes when you
publish a build.

## 1.81.8-beta.2
- **New: an updated, corrected `LICENSE`** — free license key for personal
  use (no subscription, no cost, ever), commercial/company/organizational
  use routed to negotiate separate terms instead of the earlier "personal
  or organizational" wording that didn't actually match the intended model.
- **Fixed a real gap found while making that exact change: `LICENSE` was
  never actually included in what a self-update installs.** The update
  installer works off an explicit file allowlist (`codeItems`) rather than
  blindly copying everything in the zip — deliberate, so it never touches
  user data like `calendar.db` — but `LICENSE` had simply been left off
  that list since it was first introduced. An existing installation could
  apply update after update and never receive a licensing change at all;
  only a brand-new install (not an update) ever got the current file.
  Fixed in both places that list is declared: the main self-update
  installer, and the separate host→slave mirror-push builder (its own
  comment already said "keep these in sync" with the installer's copy —
  now it actually is). `CHANGELOG.md`/`HANDOFF.md` deliberately stay off
  both lists — internal dev docs, no stakes either way — but `LICENSE` is
  the actual legal terms a real device is running under, and needed to
  travel with every update like the rest of the app does.

## 1.81.8-beta.1
- No code changes — version bump only, published to the beta channel to
  test the mothership's new "push beta releases to GitHub too" toggle.

## 1.81.7
- No code changes — version bump only, published to the stable channel to
  verify the mothership's new GitHub-push-on-stable-publish feature end to
  end (1.81.6 couldn't be re-published to test it once the token issue was
  fixed, since the release-version-already-exists check blocks a repeat
  publish of the same version+channel).

## 1.81.6
- **New: Reminders** — generic rotation reminders (trash/recycling day and
  anything else that recurs on a schedule but isn't a real calendar
  event), reachable from three places that all share one dataset and one
  schedule-matching source of truth, so they can never disagree:
  - A new Reminders widget with four selectable styles (Banner, List,
    Hero + chips, Weekly strip), plus opt-in integration into the Mini
    Calendar's day-cell badges and the Agenda widget (reminders can create
    their own day-group even on days with no other events).
  - The Daily Briefing email, on by default, showing only on days
    something's actually due rather than an empty-state line every
    morning.
  - Family Hub, as a fourth tab alongside Chores/To-Do/Shopping — so
    managing reminders never depends on having a specific widget added to
    a layout.
  - Add/edit/delete is implemented exactly once and reused everywhere it's
    reachable from, not duplicated per entry point.
- **Fixed pull-to-refresh triggering accidentally** throughout the app —
  most visibly when scrolling a long "Show all" list in the Layout
  Editor's "Editing Layout" dropdown, but the underlying fix (`touch-
  action` plus `overscroll-behavior` plus a raw-touch fallback for
  WebKit's inconsistent handling of the latter) is app-wide, since this is
  a kiosk-style control app where an accidental refresh mid-edit is never
  wanted. Took a few rounds to land correctly, including one overcorrection
  that briefly broke horizontal tab-bar scrolling and another that
  weakened the fix it was trying to improve — both caught and reverted
  before this reached stable.
- Developed and hardened across 8 beta rounds, several driven directly by
  real-hardware testing and follow-up requests once earlier rounds
  shipped. This entry is the consolidated, as-shipped description; the
  full round-by-round history is preserved below and in HANDOFF.md.

## 1.81.6-beta.8
- **Reminders now also live in Family Hub, as a fourth tab alongside
  Chores/To-Do/Shopping** — asked directly after beta.7 shipped ("Reminders
  should probably live outside the widget too... probably family hub?").
  Previously the only way to manage reminders at all was through a
  Reminders widget's own settings, which meant removing that one widget
  from a layout (or never adding it) meant losing easy access to the
  feature entirely, even though the underlying data — and the calendar
  badges, Agenda rows, and Daily Briefing email all reading from it —
  was still fully alive. New `reminders_enabled` setting (on by default,
  same as Chores) controls visibility, same pattern as the other three
  tabs.
- Reuses the *exact same* add/edit/delete functions the widget-settings
  modal already used, rather than a second, parallel implementation of
  the same CRUD logic — refactored them to render into either the modal's
  container or the new tab's, chosen by a single `_mrBodyId` variable set
  explicitly at each entry point. Only one place in the codebase now
  actually builds a reminder's list row or its add/edit form; both
  surfaces just point that same logic at a different spot in the page.

## 1.81.6-beta.7
- **Reminders now show up in the Daily Briefing email too** — asked
  directly after beta.6 shipped ("is this built into the daily digest
  email as well?"), and it wasn't. Added a Reminders section, using the
  same server-side mirror of the shared schedule-matching logic every
  other reminder surface reads from (a new `reminderOccursOnDateServer()`,
  since the email has no browser context to call the client-side version
  from). On by default (`briefing_include_reminders`, unlike Stocks/News
  which default off) — reminders sit at the same "what do I need to know
  today" tier as Events and Tasks, not an optional extra. Unlike
  Events/Tasks, the section only appears in the email at all when
  something's actually due that day, rather than always showing with a
  "nothing" message — absence is the common case for something like trash
  day (once or twice a week), so an empty-state line every single day
  would just be daily clutter.
- Found and fixed three separate hardcoded settings-key allowlists that
  all needed the new field added — `GET /api/briefing-settings`,
  `PUT /api/briefing-settings`, and the internal `getEmailSettings()` the
  actual send job reads from. Missing any one of these would have been a
  quiet, confusing bug: e.g. missing it from the PUT allowlist alone would
  have made the toggle appear to save in the UI but silently never
  persist, only surfacing the next time the settings screen reloaded.

## 1.81.6-beta.6
- **New: Reminders — generic rotation reminders (trash/recycling day and
  anything else that recurs on a schedule but isn't a real calendar
  event), with a new widget, calendar-grid badges, and Agenda integration
  all sharing one source of truth.**
  - New `reminders` table + full CRUD API, participating in the host/
    slave sync snapshot the same way events do. Each reminder is a name,
    an emoji icon, and one of two schedule types — specific day(s) of the
    week (trash: every Tuesday), or every N days from a reference date
    (recycling: every 14 days) — deliberately short of full RRULE
    complexity, since that covers the real cases this was built for.
  - One shared pair of helpers (`reminderOccursOnDate()`/
    `nextReminderOccurrence()`) computes "is this due" for every surface
    below, so the widget, the calendar badges, and the Agenda rows can
    never disagree about what's due on a given day.
  - **New Reminders widget, four selectable styles:** Banner (one line,
    whichever reminder is soonest), List (every reminder always visible
    with its own next-due date), Hero + chips (soonest gets a big
    treatment, the rest as small reference chips), and Weekly strip (a
    7-day timeline with icons on the days each reminder falls, today
    outlined) — all four built and available from day one rather than
    picking just one to start.
  - **Calendar-grid integration:** an opt-in small emoji badge on Mini
    Calendar day cells for any day a reminder is due, reusing the exact
    corner-badge system the existing Sticker badges already use (own
    position/size settings, defaults to the opposite corner so the two
    don't collide if both are on).
  - **Agenda integration:** an opt-in reminder line on any day it's due,
    including days that would otherwise have no events at all — "trash
    today" shows up even on an empty day, not just tacked onto a day that
    already has something else scheduled.
  - **Manage Reminders**, a dedicated add/edit/delete screen reachable
    from any Reminders widget's own settings (on the display itself via
    Live Editing, and from the phone app) — shared data, so adding one
    from either place updates every widget, every calendar badge, and
    every Agenda instantly.
  - Both the display's own Manage Reminders panel and the phone app's
    modal are deliberately wired exactly once each, NOT from inside the
    widget's own per-render settings code — the exact bug class fixed
    earlier this session for Copy From Another Layout (a modal wired
    from a function that reruns on every settings-panel open stacks a
    duplicate listener every time). Built correctly from the start this
    round rather than needing a follow-up fix for the same mistake twice.

## 1.81.6-beta.5
- **Fixed another regression from the pull-to-refresh guard: horizontal
  scrolling of the top tab bar silently stopped working.** `.tabs` itself
  was never touched — it still scrolls horizontally by design when there
  are more tabs than fit, exactly as before. The guard was checking
  downward movement in isolation, and a real-world horizontal swipe is
  never perfectly axis-aligned — a little incidental vertical wobble
  during a sideways swipe across the tab bar was enough to get mistaken
  for a downward pull and cancel the touch, breaking horizontal scrolling
  anywhere it happened, tabs included. Now requires the vertical
  component to genuinely dominate the horizontal one before considering
  it a pull-to-refresh candidate at all — closer to what that gesture
  actually looks like, and enough to stop misfiring on anything mostly
  sideways.

## 1.81.6-beta.4
- **Reverted an overcorrection from beta.3: removing the pull-to-refresh
  guard's document-level fallback (to protect the Layout Editor's drag
  surfaces) instead made the actual reported bug easier to hit again
  everywhere that fallback used to catch it.** The worry behind removing
  it wasn't right: `preventDefault()` on a `touchmove` event suppresses
  the browser's own default action (scroll, pull-to-refresh) but does NOT
  stop `pointermove` events from firing — they're independent — so it was
  never actually going to interfere with this app's pointer-based widget
  dragging, and suppressing the page's own scroll while a drag is in
  progress is desirable anyway. Fallback restored. Keeping the one
  exclusion that IS genuinely correct: the guard still backs off entirely
  — doing nothing at all — the moment it crosses an element explicitly
  marked `touch-action:none`, since that's this codebase's own deliberate
  signal (used on the Layout Editor's resize handles) that something
  needs completely unblocked raw touch control, and this guard should
  never second-guess that specific case.

## 1.81.6-beta.3
- **Pull-to-refresh still fired even with beta.2's `overscroll-behavior`
  in place — confirmed on real hardware: the rubber-band bounce stayed
  contained inside the list correctly, but the page reloaded anyway.**
  WebKit's actual support for `overscroll-behavior` blocking the NATIVE
  pull-to-refresh gesture specifically (as opposed to just the bounce
  animation) has been inconsistent across iOS Safari versions — the CSS
  property alone isn't a reliable guarantee there. Added the standard,
  more reliable fallback: a global touch handler that intercepts the raw
  gesture directly and calls `preventDefault()` at the exact moment a
  pull-to-refresh would begin — a downward drag while the nearest
  actually-scrollable ancestor of the touch (found generically by walking
  up looking for real `overflow-y:auto/scroll` content, not a hardcoded
  list of selectors, so it automatically covers any current or future
  scrollable area including inside modals) is already at its topmost
  scroll position. Every other scroll/touch interaction is unaffected —
  this only intervenes at that one specific boundary condition.

## 1.81.6-beta.2
- **Fixed at the source, app-wide: pulling down at the top of any
  scrollable list (nothing left to scroll up) could trigger the page's
  pull-to-refresh instead of just stopping.** Different property from
  beta.1's fix — `touch-action` governs how a gesture gets classified at
  the START of a touch; `overscroll-behavior` governs what happens once
  you're already AT a scroll boundary and keep dragging, which normally
  "chains" the overscroll up through parent scrollables to the document
  itself — that's specifically what native pull-to-refresh responds to.
  Set `overscroll-behavior-y: contain` on `.content` (the actual
  container nearly everything in this app scrolls inside), plus a
  matching backstop on `html`/`body` in case anything ever scrolls the
  page directly, and directly on the "Editing Layout" dropdown from
  beta.1 for good measure. This is a kiosk-style control app, not
  something anyone actually wants "pull down to refresh" on — an
  accidental refresh mid-edit was only ever a nuisance, never intentional
  — so this is app-wide rather than scoped to the one dropdown that
  happened to surface it.

## 1.81.6-beta.1
- **Fixed: in the Layout Editor's "Editing Layout" dropdown, expanding
  "Show all" and then scrolling the longer list could trigger the page's
  pull-to-refresh instead of scrolling, if the touch happened to land on
  blank space rather than directly on the text.** The dropdown and its
  buttons had no `touch-action` set at all, unlike `.swipe-card`
  elsewhere in this file, which already has this exact fix for the same
  reason. Without it, an unclaimed vertical drag on a scrollable
  container can fall through to native pull-to-refresh on WebKit instead
  of scrolling, depending on exactly what's under the touch point. Added
  `touch-action: pan-y` to the menu container and every button in it, so
  a vertical drag anywhere on this menu is unambiguously always a scroll.

## 1.81.5
- **International and US Ordinal date formats now read naturally in full:**
  "21st of August 2026" (International) and "August 5th, 2026" (US),
  instead of an abbreviated month with no connecting word. Applies
  everywhere a full date string shows up — the Date widget, the Date &
  Time widget, and their live per-second refresh. The short, compact
  Ordinal labels used in Agenda headers and the Mini Calendar Strip are
  deliberately unchanged; those exist to be compact, and a full month
  name plus "of" would defeat that.
- **New: "Copy from Another Layout…" in the Layout Editor.** Pick any
  other (display, orientation) pair's live layout, choose which widgets
  to bring in, and copy them into what's currently being edited — same
  widgets, same locations, same settings, replacing (not merging with)
  whatever's currently there. A copied widget's `locked` state is
  deliberately dropped rather than carried over, since a lock exists to
  protect a widget in the place it was originally positioned, and
  defeats the point of copying if it follows the widget into a brand new
  layout where repositioning is often the very next step.
- **Fixed a genuine multi-device (host/slave) correctness bug**, found
  through extensive real-hardware testing on an actual mirror setup: a
  write made from a slave device — layout saves in particular, though the
  same path handles events and settings too — could report success
  before the slave's own local copy had actually caught up with what it
  just sent the host, leaving the physical display it drives showing
  stale content indefinitely, even across a full reload. Proxied writes
  from a slave now wait for the sync-back to genuinely complete (checking
  only the fast data path, not slower photo file transfers, so this
  doesn't stall on unrelated work) before confirming success back to the
  client, and an early optimization that briefly reintroduced a subtler
  version of the same problem (deduplicating concurrent sync calls in a
  way that could return stale results) was found and reverted.
- Developed and hardened across 9 beta rounds — several addressing
  regressions found in earlier rounds of this same cycle, including one
  serious one only fully confirmed and fixed via live testing against a
  real host/slave device pair. This entry is the consolidated, as-shipped
  description; the full round-by-round history (including what each
  regression actually was and why) is preserved below and in HANDOFF.md.

## 1.81.5-beta.9
- **Reverted beta.8's sync deduplication — it was a real bug, not a fix.**
  Traced through extensive testing on an actual host/mirror setup: a Copy
  & Replace on a mirror device could report a clean, warning-free success
  while the mirror's own local data — and the physical display reading
  from it — still didn't reflect the change, even after a hard reload
  moments later. Root cause was beta.8 itself: `syncDataOnly()` made a
  concurrent call piggyback on whichever sync was already in flight,
  reasoning that repeated full resyncs from the beta.7-era duplicate-
  listener bug were wasteful. True, but `scheduleChangeWatch()` polls the
  host as often as every 1.5 seconds during active editing and
  independently triggers this same sync path — if that background fetch
  had already started querying the host BEFORE a write reached it, and
  the write's own confirmation call landed while that fetch was still in
  flight, piggybacking handed back a "success" built from a snapshot that
  predated the very write it was supposed to be confirming. Every call to
  `syncDataOnly()` now does its own independent fetch again, guaranteeing
  it reflects whatever write it's confirming. An occasional redundant
  fetch during heavy concurrent activity is real but minor; a false "it
  worked" is not — correctness wins that tradeoff.
- **Known gap, not fixed here:** the OLDER, pre-existing `_syncing`/
  `_syncQueued` lock inside `runSyncOnce()` itself (not touched this
  session) has the same shape of risk — a call made while another is
  already running just sets a flag and returns immediately, without
  actually waiting for anything. The multipart/photo-upload branch of
  `proxyWriteToHost()` still awaits the FULL `runSyncOnce()` (needed there
  specifically, since photo files are the point of that branch), so a
  photo upload could theoretically hit the same "reports success before
  actually catching up" pattern this changelog entry just fixed for
  layout/event/settings writes. Not reported as an active bug, and out of
  scope for what was actually being chased this round — flagged here so
  it isn't rediscovered from scratch if it ever surfaces.

## 1.81.5-beta.8
- **Fixed: Copy & Replace copied a widget's `locked` state along with
  everything else, making a copied widget impossible to drag or resize in
  its new layout.** `locked` protects a widget from accidental drag/resize
  in the place it was deliberately positioned — carrying that into a brand
  new layout, where repositioning to fit is usually the very next thing
  someone needs to do, defeated the point of copying rather than
  protecting anything. Now the one deliberate exception to "exact copy":
  every other setting still carries over unchanged, `locked` doesn't.
- **Hardened `syncDataOnly()` against concurrent calls** — any call made
  while one is already running now piggybacks on that same in-flight
  result instead of starting an independent second fetch-and-rewrite of
  every shared table. Not a fix for a currently-reproducing bug (the
  client-side cause of concurrent calls was already fixed in beta.7), but
  a real gap worth closing on its own: `proxyWriteToHost()` awaits this on
  every write a slave makes, and repeated concurrent full-table
  DELETE+INSERTs are genuine unnecessary load on both the slave and the
  host — and on a Raspberry Pi's SD card specifically, repeated heavy
  writes are a real risk to the card itself, not just a performance
  concern. Doesn't undo any damage already done by the beta.7-era bug;
  makes sure this specific pattern can't happen again regardless of what
  triggers concurrent calls in the future.

## 1.81.5-beta.7
- **Found the real bug at last: Copy & Replace's own modal was wired up
  wrong from the start.** New symptom made it obvious — the confirm()
  dialog started appearing 5 times per click, and after confirming
  through all of them, the layout ended up completely empty on the actual
  display, not just stale. Root cause: `copy-widgets-overlay` and its
  buttons live OUTSIDE the dynamically-replaced Editor content (same
  top-level overlay pattern as `modal-overlay`/`feedback-popup-overlay`
  elsewhere), but they were being wired up FROM INSIDE `drawEditor()` —
  which reruns every time the Editor sub-tab loads or the edited
  display/orientation changes. `layout-copy-from-btn` itself is safely
  re-wirable each time (it's part of the div that actually gets
  recreated), but the modal's own elements are static and never get
  recreated — so every `drawEditor()` call stacked ANOTHER duplicate
  listener onto the exact same persistent DOM nodes, with nothing ever
  removing the previous ones. A single click fired the handler once per
  accumulated listener: 5 confirm() dialogs, and — far more seriously —
  up to 5 overlapping PUT-then-sync-back requests racing each other,
  which is what actually corrupted the layout down to nothing. (beta.6's
  `syncDataOnly()` deliberately doesn't take the periodic sync's own lock
  since concurrent calls were assumed to be a rare, harmless edge case —
  they're not rare at all when one click triggers five real save cycles.)
  Fixed by moving all of the modal's internal wiring (close, orientation
  toggle, load, the actual copy-and-replace) into its own function that
  only ever runs once, the same way `feedback-popup-overlay` is wired
  elsewhere in this file — `drawEditor()` now only ever re-wires the open
  button itself, which was never the problem.
- The two previous fixes (beta.5's explicit-await-and-check-the-real-
  result, beta.6's await-the-sync-back-before-responding) were both
  real, correct fixes for real bugs — just not THE bug behind this
  specific report. Left in place; they're still the reason this bug even
  had "here's exactly why it looks like it succeeded" toasts to diagnose
  from once the actual cause (this file) got found.

## 1.81.5-beta.6
- **Fixed the actual root cause of the Copy & Replace bug — a systemic
  issue in every write made from a slave/mirror device, not specific to
  Copy & Replace at all.** Traced through the multi-device architecture:
  on a slave, a write (layout save, event edit, etc.) gets proxied to the
  host and the response comes straight back the moment the HOST confirms
  it — `runSyncOnce()`, which pulls the host's data back down into this
  device's own local tables, was fired off in the background but never
  awaited. Reads are NEVER proxied (by design — GETs always hit local
  data), so the app and the physical display, both reading this same
  slave's local copy, could keep showing the pre-edit state indefinitely
  after a save that had already genuinely succeeded on the host — exactly
  what beta.5's "still showed old widgets after a full reload, even from
  a different device" report turned out to be. beta.5's explicit-await
  fix on the client side was correct as far as it went, but had nothing
  to actually wait FOR — the host's `{ok:true}` was real, honest, and
  came back before this device had caught up regardless.
  - `proxyWriteToHost()` now awaits the sync-back before responding to a
    JSON write, instead of firing it and responding immediately.
  - Split out a new `syncDataOnly()` — just the fast part (one fetch +
    an in-process SQLite transaction: settings/events/layouts/photo rows)
    — from the full `runSyncOnce()`, which also copies actual photo
    *files* and can genuinely take a while on a big library. A write
    only needs to wait for the DATA to catch up, not for unrelated photo
    transfers — `runSyncOnce()` itself is unchanged for the periodic
    background timer, which still does both.
  - If the sync-back itself fails (host reachable for the write, but not
    for the immediate follow-up fetch, say), the write still isn't lost —
    the host already has it, which remains the source of truth — but the
    response now carries a `syncWarning` explaining that THIS device
    hasn't caught up yet, instead of a bare `{ok:true}` that doesn't match
    what's still on screen a moment later. Copy & Replace's own toast
    checks for this and says so plainly rather than a misleading "✓" if it
    happens again.
  - The multipart/photo-upload proxy branch had the identical
    fire-and-forget pattern — fixed the same way, kept on the FULL
    `runSyncOnce()` there specifically, since photo files are the whole
    point of that branch.
  - Known remaining gap: `syncDataOnly()` doesn't take the same
    `_syncing` lock the periodic background sync does, so in the rare case
    where a write's sync-back and the periodic timer's sync overlap,
    both fetch the host's snapshot independently — SQLite serializes the
    actual writes safely (no corruption risk), just occasionally
    redundant work. Not fixed here; noted for if it's ever worth the
    added locking complexity.

## 1.81.5-beta.5
- **Fixed: Copy & Replace could show "N widgets copied ✓" while the actual
  display never updated — confirmed on real hardware, reproducible even
  after a full page reload on the display itself.** Root cause: the
  handler relied on the normal debounced auto-save (`rebuildCanvas()` →
  `autoSaveLayout()`, fires 500ms later, fire-and-forget) completely
  decoupled from the success toast, which fired unconditionally the
  moment the LOCAL widget array was replaced — regardless of whether that
  later save actually succeeded. If the server rejected it (e.g. a trial
  account's widget limit), `persistLayoutNow()` silently reverts
  `layoutWidgets` back to whatever the server actually has and shows its
  own toast, but nothing connected that outcome back to what the person
  watching the screen a moment earlier had already been told. Fixed by
  saving explicitly and awaiting the real result before touching local
  state or showing anything: only updates `layoutWidgets`/closes the
  modal/shows the success toast once the server has confirmed `{ok:true}`
  — a rejected save now shows the actual reason and leaves the modal open
  with nothing changed, instead of silently reverting somewhere the person
  already stopped looking.
- Also checked for explicit success (`r.ok`) rather than just "no `.error`
  present" on that same save — `apiFetch()` never throws, but a genuine
  network failure or auth hiccup comes back as its own sentinel shape
  (`__networkError`/`__authFailed`/`__parseError`) that also has no
  `.error` property, which would have silently fallen through to the
  success path too. Same class of bug, different trigger — worth noting
  as a pattern: anywhere a save's result gets checked with `if (r.error)`
  rather than `if (!r.ok)`, a network-level failure can slip through as a
  false success.

## 1.81.5-beta.4
- **Copy from Another Layout now actually replaces, not appends.**
  Confirmed on real hardware that the beta.3 version just added the
  copied widgets on top of whatever was already there instead of
  replacing it — fixed to clear the destination layout first (same as
  Reset already does, including its own confirm() before wiping anything)
  and made that explicit up front in the modal's copy, not just something
  discovered after the fact.
- **Fixed the Editor toolbar's 4-button row overflowing on phone-width
  screens** (confirmed via screenshot — "Save as Preset" and the new
  "Copy from Another Layout" button were both visibly clipped). Root
  cause: `.layout-actions-compact .btn` used `flex:1` with no minimum
  width, so a row built for 3 short labels just kept dividing evenly as
  buttons were added, squeezing each one below what its own text needed
  once a 4th (longer) button joined. Gave buttons a real `min-width` and
  let the row `flex-wrap` instead of keep shrinking — degrades to two
  rows on a narrow phone rather than clipping text, and won't break again
  if a 5th button shows up later. Also shortened "Copy from Another
  Layout…" to "Copy From…" on the button itself (the modal it opens
  already has the full name as its title).

## 1.81.5-beta.3
- **New: "Copy from Another Layout…" in the Layout Editor.** Pick any other
  (display, orientation) pair's live layout, choose which of its widgets
  to bring in, and copy them into whatever's currently being edited — same
  widgets, same locations, same settings, just a fresh id each so they
  don't collide with anything already there. No new server endpoint;
  reuses the existing `GET /api/layouts/:orientation?display=` to read the
  source. Deliberately not a rescale or reposition — an exact copy, so if
  the source is a different orientation than the one being edited, the
  x/y/w/h percentages carry over as-is and may not land anywhere sensible
  on the new aspect ratio. A warning says so up front (shown after loading
  the source, only when the orientations actually differ) rather than
  letting that be a surprise after the fact. Own standalone modal
  (`copy-widgets-overlay`), not the event-editing modal's state machine —
  same reasoning `feedback-popup-overlay` already documents for being its
  own thing: a different, purpose-built flow deserves its own overlay
  rather than being wedged into one built for something else, even though
  all three share the same `.overlay`/`.modal` CSS for visual consistency.

## 1.81.5-beta.2
- **Same fix as beta.1, US Ordinal:** "August 5th, 2026" instead of "Aug
  5th, 2026" — full month name, no "of" (unlike International, US
  ordering is month-first, and "August of 5th, 2026" isn't how anyone
  reads that). Same scoping as beta.1: `formatDateFull()` only,
  short-label `weekdayDateLabel()`/`monthDayLabel()` untouched. Removed
  the now-unused `monShort` variable from `formatDateFull()` — both
  Ordinal cases use the full month name now, so nothing in that function
  reads the abbreviated form anymore.

## 1.81.5-beta.1
- **International Ordinal date format now reads "21st of August 2026"
  instead of "21st Aug 2026"** — added "of" and switched to the full
  month name, matching how the ordinal format is actually spoken/written
  in the locales that use day-before-month ordering, rather than reading
  like a truncated label. Scoped to `formatDateFull()` only (the Date
  widget, Date & Time widget, and their live per-second tick refresh —
  everywhere a full date string like this appears); the short-label
  version of Ordinal International used by Agenda day-group headers and
  Mini Calendar Strip (`weekdayDateLabel()`/`monthDayLabel()`, e.g. "Sat,
  5th Aug") is deliberately unchanged — those exist specifically to be
  compact for tight UI spaces, and "of" plus a full month name would
  defeat that.

## 1.81.4
- **Fixed: Favorites tab buttons (trash icon, "Add a Card", and more) going
  unresponsive after adding certain cards.** Root cause: a handful of card
  types' `wire()` unconditionally queried for a button their `render()`
  correctly omits in an empty/not-set-up state — `querySelector` returning
  `null` there threw, which silently halted the entire wiring loop for
  every OTHER card and the trash/Add-a-Card buttons right after it. Fixed
  the five affected card types, wrapped each card's `wire()` in its own
  try/catch so this shape of bug can never cascade again, and fixed a
  related bug found along the way where two different card types shared
  one CSS class, silently breaking one of them if a household favorited
  both.
- **New: Settings → Version & License → Update timing.** Updates have
  installed automatically the instant they're found since 1.39.3, with no
  way to change that — this adds an opt-in "At a scheduled time" choice
  alongside the still-default "Immediately," so an update doesn't have to
  land mid-use. Immediate mode is unchanged from before this existed;
  Scheduled arms a precise daily timer (not just a flag check on the
  existing 6-hour background cadence, which would rarely land on the
  actual chosen minute) and reintroduces manual "Check for Updates" /
  "Update Now" buttons — shown only in Scheduled mode, since Immediate
  still has nothing to manually manage.
- Developed across 2 beta rounds; this entry is the consolidated,
  as-shipped description.

## 1.81.4-beta.2
- **New: Settings → Version & License → Update timing.** Since 1.39.3,
  every update installed automatically the moment it was found, with no
  way to change that. Reintroducing choice here deliberately, not as a
  blanket revert of that decision: the default is still "Immediately" —
  fully automatic, nothing to manage, same behavior as before this
  existed — and the new "At a scheduled time" option is opt-in. Chosen
  because 1.39.3's actual goal ("nothing ever keeps running an outdated
  version") doesn't require installing the INSTANT a release appears,
  just installing it reliably — a daily time (e.g. 3am) still guarantees
  that while avoiding a restart landing mid-use for anyone on Immediate,
  which was never the point of removing the choice in the first place.
  - **Immediate** (default): unchanged — `periodicUpdateCheck()` installs
    as soon as it finds something, same as every version since 1.39.3.
  - **Scheduled**: a new `scheduleNextDailyUpdateInstall()` arms a precise
    timer for the next occurrence of the chosen daily time (today if it
    hasn't passed, tomorrow otherwise) — deliberately not just relying on
    `periodicUpdateCheck()`'s existing 6-hour cadence, which would only
    ever land on whatever times-of-day happen to fall 6 hours apart from
    boot, essentially never the actual chosen minute. Re-arms itself after
    every check (whether or not anything was available), and immediately
    on any settings change to either the mode or the time, so switching
    modes or picking a new time takes effect right away rather than
    waiting for the next restart.
  - **"Check for Updates" / "Update Now" buttons** — reintroduced in
    Settings, but only shown in Scheduled mode. Immediate mode still has
    nothing to manually manage (same reasoning 1.39.3 removed these
    controls for in the first place); Scheduled mode needs them, for
    anyone who doesn't want to wait for the next daily window.
    "Check for Updates" reuses the same `/api/update-check` the top
    banner already polls every 10 minutes; "Update Now" reuses the same
    `/api/update-from-server` install path and restart-survives-network-
    error handling the banner's own `installUpdateFromBanner()` already
    has, kept as a separate, self-contained implementation for the same
    reason that function gives for not sharing Settings' own
    `pollForReturn` — it closes over banner-specific DOM elements that
    won't exist wherever this runs instead.

## 1.81.4-beta.1
- **Actually root-caused and fixed: the Favorites tab bug from 1.81.1
  ("most buttons stop responding after adding a card"), confirmed this
  time via a real screenshot** — clicking the trash icon or "Add a Card"
  did nothing, on a tab showing a "Redeem a Reward" card in its
  empty/not-set-up state ("Set up kids and rewards in the Chores tab
  first"). Root cause: that card's `render()` correctly omits its
  `.fav-redeem-btn` element in that empty state, but its `wire()`
  unconditionally did `document.querySelector('.fav-redeem-btn')
  .addEventListener(...)` — `querySelector` returns `null` when nothing
  matches, and calling `.addEventListener` on `null` throws. That throw
  happened inside the `favoriteCards.forEach(card => def.wire(...))`
  loop, which halted immediately — silently skipping every remaining
  card's wiring AND the trash/Add-a-Card listener attachments two lines
  below the loop, which is why "everything" looked broken even though
  only one specific card was actually misbehaving. 1.81.1's generation-
  counter hardening was a real fix for a real (different) race
  condition, but was never the cause of this specific report.
- The exact same unguarded-querySelector pattern existed in four more
  card types — `kid_shortcut` (kid since deleted), `ha_light_toggle`,
  `ha_group_toggle`, `ha_scene_trigger` (all three: entity/scene not
  found in Home Assistant) — all fixed the same way, since all four have
  the identical "render() has an empty state that omits the button,
  wire() doesn't check" shape.
- **Defense in depth**: each card's `wire()` call is now individually
  try/caught, so a future card type making this same mistake can only
  ever break that one card — not cascade into silently disabling every
  other card's buttons and the trash/Add-a-Card buttons along with it.
  Logs to console instead of failing silently.
- Also fixed, found along the way (not crash-causing, but a real bug):
  `copy_kids_link` and `copy_hub_link` both rendered a button with the
  identical `.fav-copy-btn` class — if a household favorited both,
  `document.querySelector('.fav-copy-btn')` (returns only the first
  match) meant the second card's button silently never got wired at
  all, and the first button could end up firing both cards' click
  handlers. Each now has its own distinct class.

## 1.81.3
- **New date format: Ordinal** — "Aug 5th, 2026" (US-style) and "5th Aug
  2026" (International/day-first), for the standard st/nd/rd/th suffix.
  Available everywhere the Date Format picker already is: global
  Settings → Display, the standalone Date widget, Date & Time, and the
  per-widget overrides on Mini Calendar, Agenda, Upcoming, and Today —
  including in the compact day-label helpers those last four widgets
  use, which don't share the same formatting function as the Date
  widgets and needed their own explicit ordinal handling to avoid the
  option silently doing nothing there.
- **New: individual font-size overrides for every item in the Date &
  Time widget.** Time, Seconds, AM/PM, Day Name, Date, and Temperature
  can each be sized independently now, instead of only ever scaling
  together off one master slider. Opt-in and backward compatible: every
  item defaults to "Auto" (0), which is the exact original proportional
  behavior — nothing changes for anyone not using this. Set any single
  item's slider above 0 and it becomes an independent, fixed px size.
- Developed across 3 beta rounds; this entry is the consolidated,
  as-shipped description.

## 1.81.3-beta.3
- **New: individual font-size overrides for every item in the Date &
  Time widget** — Time, Seconds, AM/PM, Day Name, Date, and Temperature
  can each now be sized independently, instead of only ever scaling
  together off the single master Font Size slider. This changes the
  widget's original "one slider drives everything proportionally"
  design (matching Clock/Date's own philosophy) into an opt-in system:
  each item defaults to 0 ("Auto"), which keeps the exact existing
  proportional `calc(var(--dt-font) * ratio)` behavior — nothing shifts
  for anyone not using this. Drag any one item's slider off 0 and it
  switches to that exact px size instead, independent of the master
  slider and every other item.
  - Implemented as a plain inline `style="font-size:...px"` set directly
    on that element when overridden (nothing when not) — inline styles
    already win over the stylesheet's calc() rule by normal CSS
    specificity, so no `!important` or CSS-variable indirection needed.
  - `tickClock()`'s per-second update only ever touches `.textContent`
    on the seconds/am-pm elements, never their attributes, so an inline
    size style set at initial render survives every later tick untouched.
  - Same six sliders, same 0-means-Auto convention, in both the app's
    Layout tab and the display's own Live Edit panel.

## 1.81.3-beta.2
- **New "International Ordinal" date format**: "5th Aug 2026" — day-
  first counterpart to beta.1's US-style "Aug 5th, 2026", for anyone
  who reads dates day-before-month. Same coverage as beta.1: global
  Settings → Display, standalone Date widget, Date & Time widget, and
  the per-widget overrides on Mini Calendar, Agenda, Upcoming, and
  Today — including the same explicit handling in the two compact-label
  helpers (`weekdayDateLabel()`, `monthDayLabel()`) so it's not silently
  inert in those four widgets like a naive addition would be.

## 1.81.3-beta.1
- **New "Ordinal" date format option**: "Aug 5th, 2026" — user request,
  for the standard st/nd/rd/th suffix DakBoard-style users are used to.
  Available everywhere the existing Date Format dropdown already is:
  global Settings → Display, the standalone Date widget, the new Date &
  Time widget, and the per-widget overrides on Mini Calendar, Agenda,
  Upcoming, and Today.
- New `ordinalSuffix()` helper (standard last-digit rule, with the
  11th/12th/13th exceptions English needs) feeding a new `us_ordinal`
  case in the shared `formatDateFull()` used by the standalone Date and
  Date & Time widgets.
- Mini Calendar/Agenda/Upcoming/Today don't call `formatDateFull()` at
  all — they use their own compact label helpers (`weekdayDateLabel()`,
  `monthDayLabel()`) that only ever branched on day-first vs month-first
  word order, dropping the year and not otherwise distinguishing between
  formats. Selecting "Ordinal" there would have been a silently inert
  option (identical output to "US Long") without also teaching those two
  helpers about it specifically — done, so the option is genuinely
  functional everywhere it's offered rather than working in some places
  and not others.

## 1.81.2
- **New: Date & Time widget** — a combined clock + date (+ optional
  current temperature) card, for a single-tile "everything at a glance"
  layout instead of needing separate Clock/Date/Weather widgets side by
  side. Two styles: Classic (big time with seconds and AM/PM, date below,
  temp below that) and Split (time and date/temp side by side, for a
  wide short box). Seconds, date, and temperature are each independent
  toggles; has its own Time Format and AM/PM Style overrides same as the
  standalone Clock, plus Left/Right alignment.
- **New: global "AM/PM Style" setting** (Settings → Display, defaults to
  lowercase), with a per-widget override on Clock, Mini Calendar, Agenda,
  Upcoming, and Today. Previously every 12-hour time across the app —
  calendar grid events, Agenda/Upcoming/Today, mini-cal agenda notes, the
  Clock widget, the weather radar frame time — hardcoded uppercase
  PM/AM, which is why the calendar grid showed times jammed together in
  all caps with no way to change it.
- Classic style, refined over several rounds of real-device feedback:
  seconds now stack above AM/PM (matching the reference DakBoard-style
  layout) rather than sitting beside it, spread evenly across the full
  height of the time digits and sized to fill close to half that height
  each, rather than both floating small near the top. The date/temp row
  moved up close under the time, and date now reaches the same right
  edge as the time above it when right-aligned instead of falling short
  by the width of the temperature next to it.
- Along the way: fixed two real regressions caught before real-world use
  settled — an early version of the right-alignment fix broke Classic's
  time layout entirely (digits splitting into separate-sized chunks) by
  turning `.dt-time` into a non-stretched flex item; and Split/right-
  alignment were both silently inert at first because the widget's base
  CSS rule set `align-items`/`flex-direction` without ever declaring
  `display:flex`, a no-op with no visible error. Also tried and removed
  a third "Compact" one-line style (beta.4–beta.6) — didn't hold up
  visually at the font sizes people actually use it at; Classic and
  Split cover the useful cases.
- Known gap, not fixed here: the mobile app's own standalone Events tab
  list still hardcodes lowercase am/pm rather than reading the new
  global setting — that file doesn't cache settings the way the rest of
  the app does, so wiring it up needs a small refactor. Left for a
  follow-up rather than holding up this release.
- Housekeeping, no functional changes: reworded every user-facing/
  business-model reference to "subscription" (LICENSE, footer, settings
  search, tooltips, error messages, CHANGELOG history) to use "license"
  terminology instead, and removed all personal-name references from
  shipped files — this repo ships to every self-hoster's own Pi, so
  anything in it is something any installer could open and read.
- Developed across 11 beta rounds; this entry is the consolidated,
  as-shipped description — see HANDOFF.md for the full session-by-
  session history, including root-cause detail on both regressions
  above.

## 1.81.2-beta.11
- **Seconds and AM/PM (stacked mode) sized up to fill close to half the
  time row's height each**, instead of floating small within the space
  beta.10 gave them. `0.32×`/`0.28×` → `0.46×`/`0.42×` the widget's font
  size. Scoped to `.dt-suffix .dt-seconds`/`.dt-suffix .dt-ampm`
  specifically — NOT the base `.dt-seconds`/`.dt-ampm` classes, which are
  shared with the seconds-alone or am/pm-alone inline suffix modes (a
  single small item next to h:mm, unrelated to this stacked pair) and
  would have oversized that unrelated case too if touched directly.

## 1.81.2-beta.10
- **Date & Time widget, Classic style: moved the date/temp row up even
  further** — `.dt-sub`'s `margin-top` cut from `0.03×` to `0.01×` the
  widget's font size (beta.9 wasn't tight enough).
- **New: seconds and AM/PM now distribute evenly across the full height
  of the time digits, instead of both sitting bunched near the top.**
  `.dt-suffix` (the seconds+am/pm stack next to "11:24") was
  `align-self:flex-start` with no explicit height, so it only ever took
  on its own small content height — nowhere near as tall as the big time
  digits beside it — meaning "top-aligned" really meant "both items
  stacked together near the top, with unused space below neither of them
  used." Changed to `align-self:stretch` (so the stack now takes on the
  full height of the time row, matching the digits) plus
  `justify-content:space-between` on the same element, so seconds land
  at the true top and am/pm at the true bottom, spaced evenly apart
  across that height rather than bunched together.

## 1.81.2-beta.9
- **Date & Time widget, Classic style: tightened the gap between the
  time row and the date/temp row below it, and between date and temp
  themselves.** Real-device report: the date/day sat noticeably far
  below the time (empty space above it) and far apart from the
  temperature, at the font sizes people actually run this widget at.
  `.dt-sub`'s `margin-top` (time-to-subrow gap) dropped from `0.12×` to
  `0.03×` the widget's font size, and its `gap` (temp-to-date gap)
  dropped from `0.25×` to `0.12×` — both proportional multipliers, not
  hardcoded pixels, so the fix holds at any widget size. Split style
  has its own independent `gap`/`margin-top` values and wasn't touched.

## 1.81.2-beta.8
- **Date & Time widget: seconds+am/pm stack now top-aligns to the time row
  instead of baseline-aligning.** Beta.7 stacked them but didn't override
  `.dt-time`'s `align-items:baseline`, so the whole seconds/am-pm column
  sank down to line up with h:mm's baseline — noticeably lower than the
  top-aligned superscript look in the reference photo. Added
  `align-self:flex-start` on `.dt-suffix` itself so it ignores the row's
  baseline alignment and pins to the top instead.

## 1.81.2-beta.7
- **Date & Time widget: seconds now stack above am/pm instead of sitting
  beside it**, when both are shown together — matches the original
  DakBoard-style reference layout (small seconds, am/pm directly below,
  both to the right of h:mm) rather than the side-by-side "h:mm SS am"
  arrangement it had before. Only changes the markup when both are on at
  once; seconds-alone (24-hour mode, no am/pm to stack with) and am/pm-
  alone (seconds off) stay exactly as they were, as a plain inline suffix.
  No changes needed to the per-second tick update — it finds `.dt-seconds`/
  `.dt-ampm` by class regardless of how deeply they're nested.

## 1.81.2-beta.6
- **Removed the Compact (one-line) Date & Time style.** Didn't hold up
  visually at the font sizes people actually use it at. Down to two style
  presets: Classic and Split. Any widget still saved with `dtStyle:
  'compact'` from beta.4/5 just falls back to Classic's plain rendering
  (no crash, no matching CSS class, nothing else to clean up) — not worth
  a migration for a beta-only option that was live for two versions.
- **Fixed: the date row still didn't reach the same right edge as the time
  above it when right-aligned, in Classic.** `dt-sub`'s markup order is
  date-then-temp; in a right-justified row that puts TEMP at the true
  right edge and leaves date short of it by temp's own width — dt-sub as
  a whole was correctly flush right, but date specifically wasn't. Fixed
  with a `order` swap (CSS visual order only, markup untouched) so date
  renders last/rightmost when right-aligned, with temp to its left
  instead. Split's date/temp stack in a column, not a row, so this
  specific issue doesn't apply there — scoped the swap to Classic only.

## 1.81.2-beta.5
- **Fixed a regression from beta.4's own fix: Classic style visibly broke
  (the time split into separate-sized chunks, e.g. "05" / "29 am" instead
  of "5:29 am" together) once right-alignment was actually tried on a real
  display.** Root cause: beta.4 made `.w-datetime` itself
  `display:flex; flex-direction:column` so one `align-items` rule on the
  outer element could right-align everything at once. That's a real,
  common CSS mechanism, but it changed `.dt-time` from an ordinary
  full-width block into a flex ITEM — and a non-stretched flex item sizes
  to its own preferred content width rather than the block's previous
  fill-available-width behavior, which at large font sizes doesn't
  reliably keep a nested flex row (`.dt-hm` + `.dt-seconds` + `.dt-ampm`)
  on one line the way a plain block box does. Reverted `.w-datetime` back
  to plain block (matching beta.3's Classic rendering exactly, not just
  approximately), and moved the right-alignment logic to the elements that
  were ALREADY flex containers on their own (`.dt-time`, `.dt-sub`) — a
  `justify-content:flex-end` on an already-full-width block flex container
  right-aligns its own content without changing anything about how that
  block itself is sized or positioned. Split and Compact keep their own
  `display:flex` (added in beta.4, still needed — see below) since they
  never had beta.3's layout to preserve; only Classic needed reverting.
- Split's `.dt-sub` is the one place this needed a genuine exception:
  unlike Classic/Compact, Split's `.dt-sub` is `flex-direction:column`
  (date stacks over temp there, to save horizontal room next to the time),
  so its cross axis is horizontal — right-aligning it needs `align-items`,
  not `justify-content` (which would move it up/down instead, since that's
  the main axis in a column container). Handled with a more specific
  `.w-datetime-split.w-datetime-align-right .dt-sub` override.
- Net effect: Classic looks exactly like beta.3 again (byte-for-byte the
  same CSS mechanism, not just visually similar) whenever alignment is
  left/default, right-alignment now actually works in every style without
  perturbing anything else, and Split genuinely lays out side-by-side for
  the first time (still broken as of beta.3, unrelated to this specific
  regression — see the beta.4 entry below).

## 1.81.2-beta.4
- **New: AM/PM casing is now a real setting, not hardcoded.** Every 12-hour
  time on the display — calendar grid events, Agenda/Upcoming/Today,
  mini-cal agenda notes, the Clock widget, and the weather radar frame
  time — was hardcoding uppercase `PM`/`AM`, which is why the calendar grid
  showed "7:15PM" jammed together in all caps. Added a global "AM/PM Style"
  setting (Settings → Display, defaults to lowercase) plus a per-widget
  override on Clock, Mini Calendar, Agenda, Upcoming, and Today — same
  "Use display setting" / explicit-override convention already used for
  Time Format and Date Format on those same widgets, both in Live Editing
  on the display itself and in the app's own widget settings.
- **New: Date & Time widget** — a combined clock + date (+ optional current
  temperature) card, for a single-tile "everything at a glance" layout
  like DakBoard's, instead of needing separate Clock/Date/Weather widgets
  side by side. Three styles: Classic (big time with seconds and AM/PM,
  date below, temp below that), Split (time and date/temp side by side,
  for a wide short box), and Compact (one line, for a small corner tile).
  Seconds, date, and temperature are each independent toggles; has its own
  Time Format and AM/PM Style overrides same as the standalone Clock, plus
  a Left/Right alignment option (which edge of the widget box the whole
  block hugs — classic/split use align-items, compact uses justify-content,
  since the widget's own content div is stretched to the full box width by
  its wrapper either way).
  Reuses the exact same formatting helpers the Clock/Date/Weather widgets
  already use rather than any new formatting logic, so it can't drift out
  of sync with what those show for the same settings.
- **Fixed within this same beta: Split style and right alignment were both
  silently inert.** The `.w-datetime` base CSS rule set `align-items`
  without ever declaring `display:flex` on itself — `align-items`,
  `flex-direction`, and `justify-content` are all no-ops on a non-flex
  element (no error, they just do nothing), so Split never actually laid
  out side-by-side (it silently fell back to stacking exactly like
  Classic), and the Left/Right alignment option had no visible effect in
  any style. Classic's default LEFT alignment happened to look correct
  anyway, purely because normal block layout is inherently left-aligned —
  which is what made this easy to miss until right-alignment was actually
  tried. Added `display:flex; flex-direction:column;` to the base rule;
  every other rule in this widget's CSS was already correct and just
  needed an actual flex container to apply to.
- Known gap, not fixed here: the mobile app's own standalone Events tab
  list still hardcodes lowercase am/pm rather than reading the new global
  setting — that file doesn't cache settings the way the rest of the app
  does, so wiring it up needs a small refactor. Small and isolated; left
  for a follow-up rather than holding up this patch.

## 1.81.2-beta.1
- **Housekeeping, no functional changes.** Reworded every user-facing/
  business-model reference to "subscription" (LICENSE, footer, settings
  search, tooltips, error messages, CHANGELOG history) to use "license"
  terminology instead, and removed all personal-name references from
  shipped files (LICENSE copyright line, footer, CHANGELOG history) —
  this repo ships to every self-hoster's own Pi, so anything in it is
  something any installer could open and read. Calendar-feed "subscribe"
  language (Google/iCloud calendar subscriptions) is unrelated
  terminology and was deliberately left alone.

## 1.81.1
- **Fixed: fresh installs prompted for a Chromium "Unlock Keyring"
  password on every boot** — Chromium tries to encrypt its saved-password
  store using a key held in the OS keyring, but an auto-login kiosk has
  no login password for the OS to unlock that keyring with, so it
  prompted for one that was never set and had no UI path to answer.
  Added `--password-store=basic` to the kiosk launch command, which
  skips the OS keyring entirely. New installs only — doesn't retroactively
  fix a Pi imaged before this; see HANDOFF.md for the manual fix on
  existing devices.
- **Hardening, not a confirmed fix: a report that most Favorites tab
  buttons stopped responding after adding a card.** Couldn't be
  reproduced. Added a generation-counter guard against the one plausible
  race condition found in review — overlapping `renderFavoritesTab()`
  calls (the 15s auto-refresh firing mid-render, or a rapid action
  overlapping with it) where a stale, slow-to-finish call could clobber
  a fresher one's DOM and event listeners. If this recurs, see
  HANDOFF.md for what diagnostic info would actually help pin it down.
- Minor: `favorites` was missing from the SSE `SHARED_TOPICS` list
  (mirrors weren't getting the fast-refresh signal for favorites
  changes), and a stale code comment about the PIN screen's z-index
  was corrected.
- Developed across 2 beta rounds; this entry is the consolidated,
  as-shipped description.

## 1.81.1-beta.2
- **Possible fix, NOT confirmed: a user-reported bug where most Favorites
  tab buttons (delete, add, presumably move) stopped responding after
  adding a card.** Could not be reproduced locally, and the exact root
  cause wasn't pinned down — this hardens the most plausible candidate
  found during code review rather than a confirmed fix. `renderFavoritesTab()`
  does several awaited fetches before repainting the tab; if a second call
  started before a first one's fetches resolved (the 15s auto-refresh
  firing mid-render, or a rapid add/delete overlapping with it), whichever
  call happened to FINISH last would win and repaint/rewire everything —
  even if it was the call that started FIRST and was working from the
  most stale snapshot of the data. Added a monotonic generation counter
  (same pattern as the existing `authGeneration`) so a now-stale render
  abandons itself instead of clobbering a fresher one's DOM and listeners.
  Also now bails out if the person has since navigated off the tab
  entirely, since the tab-check in `startFavoritesAutoRefresh()`'s own
  interval can only catch that BEFORE a render starts, not if it happens
  while one is still in flight.
- Ruled out along the way: the PIN screen's actual z-index is 99999 (a
  code comment claiming 500 was simply stale/outdated — fixed the
  comment), well above every other overlay in the file, so an obscured-
  PIN-screen theory doesn't hold up. Also found (unrelated, drive-by fix)
  that `favorites` was missing from `SHARED_TOPICS`, meaning mirrors
  weren't getting the fast-refresh signal for favorites changes.
- If this recurs, the next useful diagnostic would be the browser console
  for a JS error at the moment it happens, or which specific card type
  was involved — neither was available this round.

## 1.81.1-beta.1
- **Fixed: fresh installs prompted for a Chromium "Unlock Keyring" password
  on every boot, asking for a password that was never set and that the
  kiosk has no UI path to answer.** Chromium tries to encrypt its saved-
  password store using a key held in the OS keyring (GNOME Keyring via
  libsecret on Raspberry Pi OS); on an auto-login kiosk there's no login
  password for the OS to unlock that keyring with, so Chromium prompts
  for one instead. Added `--password-store=basic` to `KIOSK_CMD` in
  install.sh — skips the OS keyring entirely in favor of Chromium's own
  local (still encrypted, just not keyring-backed) storage. New installs
  only; doesn't retroactively fix a Pi that's already showing the prompt
  — see HANDOFF.md for the manual fix on existing devices.

## 1.81.0
- **New: Weather Radar widget.** Live radar map (RainViewer — free,
  worldwide coverage, no API key/account) centered on the same location
  as the Weather widget by default, with a per-widget ZIP/postal code
  override for a different spot (matching the same override flow the
  Weather widget already uses). Settings: Title, Location Override, Zoom
  Level, Radar Opacity, Animate (loops recent frames instead of a static
  latest one), Frames to Loop, Show Frame Time, and the standard Title
  Font Size control.
- Animation loops through RainViewer's observed radar history (up to
  ~13 frames / 2 hours — their own free-tier ceiling) and, if set higher,
  extends into their short-term nowcast (a near-future extrapolation, not
  a full forecast model) up to 20 frames total. A small badge under the
  title shows the current frame's clock time and how old — or, for
  forecast frames, how far ahead — it is.
- Frame transitions are a clean, instant cut with no flash or fade:
  each frame's tiles fully buffer (all of them, not just the next one)
  before the loop starts moving, and the actual swap sets opacity
  directly on each frame's own container element rather than through
  Leaflet's per-tile opacity API, which doesn't paint as atomically as it
  looks from the outside.
- Radar widgets hold a live Leaflet map instance and a running animation
  timer — real state that a naive full-page re-render would otherwise
  destroy and recreate on every unrelated refresh elsewhere on the
  display (weather, tasks, chores, Home Assistant, anything). Along the
  way, found and fixed two general, non-radar-specific bugs this
  exposed: (1) both Home Assistant poll timers were calling a full
  re-render unconditionally on every tick regardless of whether anything
  actually changed, affecting every display in the fleet whether or not
  anyone had HA configured; (2) a handful of per-widget style properties
  were only ever conditionally set, never cleared, which was harmless by
  accident before this widget existed and a real bug the moment
  something could persist across renders.
- Developed across 14 beta rounds (1.81.0-beta.1 through beta.14); this
  entry is the consolidated, as-shipped description — see HANDOFF.md for
  the full session-by-session history, including root-cause detail on
  each fix and a couple of dead ends (an absolutely-positioned time badge
  that rendered invisible for reasons never fully pinned down, replaced
  with a plainer, more robust design) worth knowing about before
  touching this widget again.

## 1.81.0-beta.14
- **Fixed: the frame time badge added in beta.13 didn't appear at all** —
  confirmed on real hardware with the toggle correctly on. Root cause not
  fully pinned down through code review (the absolute-positioning/
  z-index approach it used should have worked on paper), so rather than
  keep guessing at the exact interaction, replaced the whole approach
  with something structurally simpler and harder to get invisibly wrong:
  the time badge is now a plain line in normal document flow, right below
  the title, instead of an absolutely-positioned overlay floating on top
  of the map's corner. No position:absolute, no z-index stacking, no
  dependency on getting a positioning context right — if the element
  exists and isn't display:none, it occupies space and renders, full
  stop. Costs a little vertical space in the widget instead of floating
  over the map for free; that trade is worth the reliability given the
  previous approach's failure couldn't be conclusively diagnosed.

## 1.81.0-beta.13
- **New: a "Show Frame Time" badge on the radar widget** — a small corner
  overlay showing the currently-displayed frame's clock time and a
  relative offset ("20 min ago", "now", or "+15 min" for forecast frames
  — tinted differently and labeled "(forecast)" using the `kind` field
  added in beta.12). Respects the same 12/24-hour preference as the rest
  of the display. On by default; a new toggle in the widget's settings
  turns it off. Updates immediately when a frame is chosen, not gated
  behind that frame's tiles finishing loading — no reason to make known
  information wait on network latency.
- The badge is a plain sibling element next to the Leaflet map container,
  not inserted inside it — avoids any risk of Leaflet's own DOM
  management touching or discarding content placed directly inside its
  container.
- Title, font size, and this new toggle are all handled the same way in
  `renderLayout()`'s radar-reuse path (beta.6): none of them touch the
  fingerprint, so toggling "Show Frame Time" doesn't force the live map
  to tear down and rebuild — it's purely a visibility flip on the
  existing badge element.

## 1.81.0-beta.12
- **New: "Frames to Loop" can now go up to 20**, not capped at 13. Up to
  ~13 is RainViewer's observed radar history (their own hard 2-hour
  ceiling on the free tier — not a limit set here, and going higher than
  20 wouldn't gain anything since that's roughly what their nowcast
  window covers). Going past ~13 pulls in RainViewer's short-term
  nowcast: a near-future extrapolation (roughly 30–60 min ahead), not a
  full weather-model forecast. `/api/radar-frames` now includes
  `radar.nowcast` frames in addition to `radar.past` (previously
  discarded entirely), tagged `kind: 'observed'` vs `kind: 'forecast'`
  so a future version could label them differently on-widget if wanted —
  not surfaced visually yet, just available. Added an info tooltip on
  the setting explaining the distinction.

## 1.81.0-beta.11
- **Fixed: animated radar still blinked roughly once a second, every
  single frame change, even with everything fully buffered ahead of time
  (beta.10).** The blinking happening consistently regardless of network/
  cache state — not just on cold loads — pointed at the swap mechanism
  itself, not a loading race. Root cause: `layer.setOpacity()` applies
  opacity TILE-BY-TILE internally (iterating every individual tile image
  in the layer), which looks like one atomic call from the outside but
  isn't necessarily one atomic paint on screen. Rewrote the swap to set
  `style.opacity` directly on each layer's own single container element
  (`layer.getContainer()`) instead — one property change on one element,
  not N changes across N tiles that could paint slightly out of step with
  each other. Also decoupled the old layer's actual DOM teardown (heavier
  — removes every tile) from the visual swap itself: the old layer is
  hidden (opacity 0) and the new one shown in the same synchronous step,
  and the old layer's real removal is deferred to the next animation
  frame, so that heavier cleanup work can never compete with or delay the
  swap.

## 1.81.0-beta.10
- **Changed: the animation loop now waits for EVERY frame to be fully
  buffered before it starts moving at all**, instead of preloading in the
  background while already animating (beta.8). The latest frame still
  shows immediately so the widget isn't blank, but the loop itself holds
  there until every other frame has confirmed-loaded — so there's no
  window where a frame could come up in rotation before its own preload
  actually finished, which the previous fire-and-forget approach didn't
  fully rule out on a slow or congested connection.
- Also capped preload concurrency at 3 simultaneous frame loads instead of
  firing all of them at once — a dozen-plus tile layers (each several
  individual tile requests) competing at once for the browser's own
  ~6-connections-per-host limit and a Pi's limited resources was
  plausibly making things choppier, not smoother.

## 1.81.0-beta.9
- **Fixed: Live Edit never showed the Weather Radar widget's real settings
  panel at all** — `radar` was missing from `WIDGET_ADVANCED_TYPES`, the
  list gating which widget types get their "More Settings" button in Live
  Edit. The full settings panel (`renderRadarAdvancedSettings()`/
  `wireRadarAdvancedSettings()` — Zoom Level, Location Override, Animate,
  Frames to Loop, Opacity) was already built and correctly wired in
  1.81.0-beta.1, but was completely unreachable from Live Edit specifically
  — it fell back to the generic quick panel (title + font size only, no
  zoom control at all), which is what looked like "zoom is stuck at
  whatever it currently is." app.html's own Layout tab was never affected
  by this — its settings panel doesn't go through this gate.

## 1.81.0-beta.8
- **Fixed: the first pass through an animated radar loop was choppy, then
  smoothed out from the second pass onward.** The load-before-swap/buffer
  logic itself (beta.3, beta.7) was already correct — no flash once a
  frame's tiles ARE loaded — but nothing preloaded ahead of time, so the
  very first loop was fetching each frame's tiles cold, over the network,
  right as it tried to display them. By the second pass, the browser's
  own HTTP cache already had everything from the first pass, so it looked
  smooth from then on — a real diagnostic clue that pointed at cache
  warm-up, not the buffer itself. Now every other frame's tiles preload
  in the background, concurrently, the moment the widget starts (fetch
  once, discard — opacity 0 the whole time, removed the instant each one
  finishes loading, never shown), so the visible loop should already be
  hitting warm cache on its very first pass instead of its second.

## 1.81.0-beta.7
- **Two more layers of defense against animated-frame flashing, on top of
  the full-widget reuse fix (beta.6):**
  1. Leaflet has a long-standing upstream quirk where its own tile-level
     fade-in CSS transition isn't always fully suppressed by the
     `fadeAnimation: false` map option alone in every version/scenario
     (documented in multiple open Leaflet issues). Added a direct CSS
     override (`transition: none !important` on `.leaflet-tile`,
     `.leaflet-tile-loaded`, and `.leaflet-layer`, scoped to `.w-radar`
     only) so the load-before-swap technique is guaranteed to produce a
     hard cut regardless of whether the JS-level option alone was fully
     effective.
  2. The animation interval fired every 800ms unconditionally, even if
     the previous frame's tiles hadn't finished loading yet — on a slower
     connection this meant repeatedly starting a new frame's load on top
     of one already in flight, discarding the abandoned one via the
     version guard, over and over, without ever letting one actually
     finish and display cleanly. The interval now skips its tick entirely
     if a load is still in progress, holding the current frame a little
     longer instead of continually interrupting.

## 1.81.0-beta.6
- **Fixed: the Radar widget still visibly "reloaded" periodically even
  after gating out the Home Assistant poll timers (beta.4)** — those
  weren't the only thing calling `renderLayout()`; nearly every other
  widget's own independent refresh timer does too (weather, tasks,
  chores, news, stocks, travel times…), and `renderLayout()` fully wipes
  and rebuilds EVERY widget's DOM on every single call, regardless of
  which widget's data actually changed. For most widgets that's invisible
  (plain HTML re-renders identically). For Radar it meant the live
  Leaflet map, base tiles, and animation were destroyed and recreated
  from zero on every one of those refreshes — a real, visible reload with
  no connection to radar's own settings at all.
- `renderLayout()` now detaches a radar widget's existing element BEFORE
  the wholesale wipe, and puts it back untouched (map, tiles, and running
  animation all still intact and uninterrupted) whenever none of its
  actual radar settings (location, zoom, animate, frame count, opacity)
  changed since the last render — determined by comparing a small
  fingerprint stored on the element. Title and font size are still kept
  live even on a reused element (they don't need the map itself touched).
  `initRadarWidgets()` now recognizes and skips a reused container the
  same way. A widget that's genuinely removed, or whose radar settings
  DID change, still tears down and rebuilds normally.
- Along the way, fixed a related latent bug this reuse mechanism exposed:
  several per-widget style properties (text color, secondary text color,
  font family, text opacity) were only ever conditionally SET on a
  widget's element, never explicitly cleared when turned back off. This
  was harmless before — every widget element was always freshly created
  from scratch on every render, so there was never a stale prior value to
  leak from — but is a real bug now that an element can persist across
  renders. Fixed by explicitly clearing each one in the else branch.

## 1.81.0-beta.5
- **Fixed: animated radar frames visibly faded in/out instead of cutting
  straight to the next frame.** The previous load-before-swap fix (fixed
  the blank-gap flash, beta.3) still fired through Leaflet's own default
  tile opacity CSS transition, so the instant opacity jump from 0 to full
  was still visibly animated as a fade. Added `fadeAnimation: false` to
  the map's own options — kills that built-in transition while keeping
  the load-before-swap technique that prevents the gap, so frame changes
  now cut cleanly with no gap AND no fade.
- **Changed: Location Override is now a ZIP/postal code lookup, matching
  Settings → Weather and the Weather widget's own per-widget override**,
  instead of raw latitude/longitude number fields. Reuses the existing
  `/api/geocode?save=0` endpoint (already built specifically for
  per-widget overrides — it geocodes without touching the global weather
  location). Internally still stores resolved lat/lon on `radarLat`/
  `radarLon`, same as before — only the input method changed.
- **New: one more zoom level (8), a bit closer than the previous max (7).**
  RainViewer's radar tiles only exist natively up to zoom 7, so the tile
  layer now sets `maxNativeZoom: 7` — at zoom 8, Leaflet automatically
  upscales the z7 tiles instead of requesting a z8 tile that doesn't
  exist (which would otherwise just 404 and show nothing).

## 1.81.0-beta.4
- **Fixed: the Weather Radar widget appeared to "completely reload" every
  ~5–15 seconds** — not a radar-specific bug at all. Both Home Assistant
  poll timers (the standing 15s poll that runs on every display, and
  Live Edit's dedicated 8s poll) called `renderLayout()` UNCONDITIONALLY
  on every tick, regardless of whether the layout had any HA widgets at
  all or whether any entity's state had actually changed. This meant
  every widget on every display was torn down and rebuilt from scratch
  every 15 seconds, forever — invisible for static-HTML widgets, but a
  real, visible full reload for Radar, whose Leaflet map instance, base
  map tiles, and animation all get destroyed and recreated from zero on
  every `renderLayout()` call (see `initRadarWidgets()`, 1.81.0-beta.1).
  `fetchHaEntities()` now returns whether anything actually changed
  (early-exits `false` when there are no HA widgets at all, otherwise
  diffs a snapshot of `state.haEntities` before/after), and both timers
  now only call `renderLayout()` when it returns true.

## 1.81.0-beta.3
- **Fixed: animated radar visibly flashed on every frame change.**
  `showFrame()` was using `L.tileLayer#setUrl()`, which swaps every tile
  in the layer in place — the old frame disappears the instant new tiles
  START loading, not when they finish, so there was a real blank gap
  between "old tiles gone" and "new tiles painted" on every single frame
  change. Replaced with a cross-fade: each new frame loads as its own
  layer at opacity 0, and only once it reports fully loaded (Leaflet's
  `load` event) does it fade to the configured opacity and the old layer
  get removed — there's always a fully-painted frame on screen, so
  nothing to flash. Guarded with a version counter so a slow-loading
  frame that gets superseded before it finishes can't pop back in after
  a newer one already won.

## 1.81.0-beta.2
- **Fixed: the Weather Radar widget rendered nothing at all on a real
  device** — reported immediately after beta.1. Root cause: `.w-radar`
  never set `display:flex` on itself, so its map child's `flex:1` had no
  effect (flex properties only do anything when the PARENT is a flex
  container) and the map div collapsed to zero height. Leaflet mounted
  into that zero-size container and had nothing to actually paint.
  Every other widget that fills real remaining space (e.g. the Photo
  widget) explicitly sets `display:flex` itself rather than relying on
  anything inherited from `.widget` — missed that for this widget.
  `.w-radar` now explicitly sets `display:flex; flex-direction:column;
  width:100%; height:100%;`.

## 1.81.0-beta.1
- **New: Weather Radar widget.** Shows a live radar map (RainViewer — free,
  worldwide coverage, no API key/account) centered on the same location as
  the Weather widget by default, with an optional per-widget lat/lon
  override for a different spot (vacation house, tracking a storm
  elsewhere). Settings: Title, Location Override, Zoom Level (3–7, matches
  RainViewer's own tile zoom ceiling), Radar Opacity, Animate toggle
  (loops the last 2–13 frames, ~10 min apart, instead of showing just the
  latest one), Frames to Loop, and the standard Title Font Size control.
  Fixed, non-interactive view — no pan/zoom on the display itself, since
  the wall display has no touch input; it's a picture, not a live map.
- Architecture: added a small `/api/radar-frames` server-side proxy for
  RainViewer's frame-list JSON (same reasoning as the existing
  `/api/weather` and `/api/air-quality` proxies — keeps the display's
  outbound dependency list to "this server" only), but the actual radar
  tile IMAGES load directly in the browser via Leaflet, not proxied —
  proxying binary tile traffic would add real bandwidth/CPU cost for no
  benefit. Leaflet added via the same cdnjs+defer pattern already used for
  qrcodejs, `display.html` only (not `app.html` — its Layout tab preview
  is just an iframe onto `display.html`, so it doesn't need its own copy).
- This is the first widget that needs a real JS-managed library instance
  rather than just an HTML string — see the new HANDOFF.md architecture
  note on the post-render init pattern (`initRadarWidgets()`, modeled
  directly on the existing `renderQRCodes()`) for what a future widget
  like this needs to hook into.

## 1.80.1
- **Fixed: sticker badges, reward catalogs, and redemption history/balances
  never appeared on a mirror**, even with real stickers earned and rewards
  redeemed on the host, even with the calendar widget's "Show Sticker
  Badges" toggle checked. The toggle lives in the `layouts` table, which
  synced correctly — but `stickers`, `rewards`, and `sticker_redemptions`
  were never part of the host↔mirror sync snapshot at all, so the data
  underneath the toggle stayed permanently empty on every mirror. All
  three tables added to both the export and apply side.
- **Fixed: a widget's custom title text could ignore its Text Color
  setting and stay stuck on the theme's accent color.** Countdown's title,
  Timer's title, and QR Code's title all hardcoded `color:var(--accent)`
  in CSS instead of participating in the per-widget text-color override
  system, unlike every other piece of user-typed text on those widgets.
  Countdown's title is now grouped with "days to go" under Secondary Text
  Color (muted by default, no override needed to match the old look);
  Timer's and QR Code's titles now follow the primary Text Color, same as
  their main content.
- Developed across 3 beta rounds (1.80.1-beta.1 through beta.3); this
  entry is the consolidated, as-shipped description — see HANDOFF.md for
  the full session-by-session history, including the root-cause detail on
  both bugs and why Countdown's title landed in a different color category
  than Timer's and QR Code's.

## 1.80.1-beta.3
- **Countdown's custom title text is now grouped with "days to go" under the
  same Secondary Text Color, instead of the primary Text Color** — the developer's ask,
  after beta.2 shipped it under primary. `.cd-title` now uses `var(--text2)`
  instead of `var(--text)`. Note this is a visible default-appearance change
  for every existing countdown widget: the title previously showed the
  theme's accent color (its original, pre-beta.1 hardcoded default) and will
  now show the muted secondary-text default until a Secondary Text Color
  override is set — confirmed as the intended behavior, not left as a
  fallback-preserving shim.
- Timer's and QR Code's title text were NOT changed here — they're still on
  `var(--text)` (primary), matching beta.2. Only Countdown's title was asked
  to move to the secondary category.

## 1.80.1-beta.2
- **Fixed: a widget's custom title text ignored the Text Color override
  and always rendered in the theme's accent color** — reported by a user
  whose countdown widget's title ("ALANA'S BIRTHDAY!!!") stayed stuck
  orange while the number and "days to go" label both changed color
  correctly. Root cause: `.cd-title` (Countdown), `.timer-title` (Timer),
  and `.qr-title` (QR Code) all hardcoded `color:var(--accent)` in their
  CSS, instead of `color:var(--text)` like every other piece of
  user-typed text on a widget. The Number and "days to go" elements
  worked because they either inherit the `.widget` base rule's
  `color:var(--text)` or explicitly use `var(--text2)` — only the title
  text on these three widgets was disconnected from the override system.
  All three fixed the same way. Same underlying bug class already noted
  in a `.widget` CSS comment ("root cause behind several widgets only
  partially responding to their own text-color setting") — these three
  were remaining, unreported instances of it.

## 1.80.1-beta.1
- **Fixed: a mirror could have "Show Sticker Badges" checked on its calendar
  widget and still show no badges at all**, even with real stickers earned
  on the host. Root cause: `stickers`, `rewards`, and `sticker_redemptions`
  were never included in the host↔mirror sync snapshot (`buildSyncSnapshot()`
  / `applySyncSnapshot()` in server.js) — the widget's on/off setting lives
  in the `layouts` table, which DID sync correctly, so the toggle looked
  fine while the actual sticker data underneath it stayed empty on every
  mirror, permanently. Same missing-table shape as the earlier todo_lists/
  todo_items gap (1.7x). Added all three tables to both the export and
  apply side. Reward catalogs and redemption history/balances on a mirror's
  kids.html were silently broken the identical way — same fix covers both.
- Not yet verified against a real host+mirror pair; next real-device sync
  should confirm badges appear on the mirror after a sync cycle without
  needing to re-toggle anything.

## 1.80.0
- **New: Settings now has a search box** (top of the Settings tab) to find
  a setting without knowing which section it lives in. Matching goes
  beyond literal label text — a synonym table expands everyday words
  ("time", "pin", "kids", "money", "donate", and about 90 others) to the
  settings-specific terms they actually map to, so a broad/casual query
  still lands on the right setting. The underlying index is built
  automatically from the live Settings DOM (every label + its ⓘ tooltip
  text) each time the tab renders, so a newly added setting is searchable
  immediately with nothing to maintain by hand — only the "broad concept"
  synonyms need curation. Tapping a result opens the right section and
  scrolls to it with a brief highlight.
- **New: "Support the Project" — an optional one-time donation link**,
  now that the app is public. Shows a Stripe "buy me a coffee" button
  and/or a PayPal button, whichever the central server has configured;
  the section doesn't appear at all if neither is set, so a self-hosted
  install with nothing configured never sees an empty or broken-looking
  entry. Fully optional, never nags — no reminder or repeated prompt.
- **Feedback & Ideas and Support the Project are now standalone top-level
  Settings sections** instead of nested inside Advanced — both sit at the
  very bottom of the list (Feedback & Ideas second-from-bottom, Support
  the Project last), out of the way since neither is something you'd
  browse to routinely, but no longer an extra tap deep inside Advanced.
- Developed across 3 beta rounds (1.80.0-beta.1 through beta.3); this
  entry is the consolidated, as-shipped description — see HANDOFF.md for
  the full session-by-session history, including the reasoning behind the
  search index's synonym-vs-auto-scrape split and a real found-and-fixed
  gap in how the donation section handles having nothing configured.

## 1.80.0-beta.3
- **Feedback & Ideas and Support the Project are now standalone top-level
  Settings sections instead of nested inside Advanced** — the developer's ask, after
  confirming the beta.2 donation card worked correctly on real hardware.
  Both now sit at the very bottom of the Settings list (below even the
  Advanced group), in that order — Feedback & Ideas second from bottom,
  Support the Project last. Neither is something a user browses to
  routinely, so "bottom of the list" keeps them out of the way without
  burying them an extra tap deep inside Advanced.
  - **Support the Project's fetch was also restructured** while pulling it
    into its own section: the link check now happens up front (alongside
    the rest of Settings' own initial data fetch) instead of after the
    page has already rendered. This matters more now that it's a real
    standalone section with its own header — fetching after the fact
    would've meant a permanently-empty, still-tappable "Support the
    Project" entry on any install with neither link configured, instead of
    the whole section correctly not existing at all (which is what it did
    before, tucked inside Feedback & Ideas where an empty card was just
    invisible inside an otherwise-real section).

## 1.80.0-beta.2
- **New: "Support the Project" card** (Settings → Feedback & Ideas) — an
  optional one-time "buy me a coffee" link, now that the app is public.
  Shows a button per link the central server has configured (Stripe
  Payment Link and/or a PayPal link) and hides itself entirely if neither
  is set, so a self-hosted install with nothing configured never sees an
  empty/broken-looking card. Fully optional and never blocks or nags —
  there's no reminder, badge, or repeated prompt, just a quiet link where
  people already are (right next to Feedback, where the "this app is
  good" mindset already lives).
  - Also searchable in the new Settings search (added last beta) via
    "donate", "coffee", "paypal", or "tip", in addition to its own label.
  - Central-server side of this (the two new config fields and the public
    endpoint devices poll) is documented in the `piazzahq-server`
    changelog, v1.32.21.

## 1.80.0-beta.1
- **New: Settings now has a search box** (top of the Settings tab) to find
  a setting without knowing which of the 20 sections it lives in or
  scrolling the whole accordion. Type a word and matching settings show up
  as a tappable list — tapping one opens the right section (and its group,
  if nested under Display & Appearance / Data Sources / Advanced) and
  scrolls straight to that row with a brief highlight flash.
  - Matching isn't limited to literal label text: a small synonym table
    expands common everyday words to the settings-specific terms they
    actually map to — e.g. "time" surfaces Time Format, Date Format,
    Timezone, and Send Time (Daily Briefing); "pin" surfaces the App PIN;
    "kids" surfaces the Chore Chart and Built-in To-Do Lists. Around 90
    everyday words are covered at launch (time/date, weather/location,
    security/pin, chores/tasks, email/briefing, theme/appearance,
    calendar/sync, voice/smart-home, stocks/news, travel, multi-device,
    version/license, backup, and more) — see HANDOFF.md for the full list
    and how to add more.
  - The underlying index is built automatically from the live Settings DOM
    every time the tab renders — every field's label AND its ⓘ tooltip
    text, where it has one — so a newly added setting is searchable by its
    own literal wording immediately, with no separate list to maintain.
    Only the "broad concept" synonyms (time → timezone, kids → chores,
    etc.) need hand-curation; everything else stays in sync on its own.
  - A multi-word query requires every word to match (each word's own
    synonym group is OR'd, the words themselves are AND'd), and a direct
    hit on a setting's actual label ranks above a synonym-only match, so
    typing an exact setting name still goes straight to the top.

## 1.79.3
- **New: Weather setup now accepts international ZIP/postal codes** (UK,
  Canada, etc.), not just US ZIPs — the geocoding lookup previously
  restricted every search to `country=US`. Applies everywhere a location
  gets entered: Settings → Weather, a widget's per-widget location
  override, and first-run setup. Non-US results get a clearer label (e.g.
  "London, England, United Kingdom") since city names repeat across
  countries in a way they mostly don't across US states.
- **Fixed: a ZIP/postal code matching more than one real place (e.g.
  67228 matching both a Kansas ZIP and an unrelated Lithuanian postal
  code) could silently resolve to the wrong country.** Weather setup now
  asks which one is yours when a code is genuinely ambiguous, shown as a
  simple tappable list right where you looked it up. An unambiguous
  match — still the overwhelming majority of lookups — resolves exactly
  as before with no extra step.
- **New: Date Format is now a global setting** (Settings → Display),
  followed by every widget that shows a date — Agenda, Mini Calendar
  (all three layouts), Upcoming, Today, and Tasks/Tasks Combined due
  dates — not just the standalone Date widget, which previously was the
  only thing it affected.
- **New: Mini Calendar, Agenda, Upcoming, and Today can each override
  Date Format individually**, same as the Date widget already could —
  each gets a "Use global default (X)" dropdown defaulting to the global
  setting, with an explicit per-widget choice taking precedence when set.
- **Fixed: a Live Editing change (e.g. Date Format) could visibly apply
  for a couple seconds, then silently revert.** Two distinct causes, both
  fixed: (1) saving a layout change broadcasts a live-sync event back to
  the same display that made the edit, and that echo could race ahead of
  the save actually finishing on the server, causing a refetch against a
  stale pre-edit snapshot — not specific to Date Format, this could
  affect any Live Editing setting; (2) on a host + slave/mirror setup, an
  edit forwarded to the host could get silently dropped by the slave's
  own sync logic if a background sync happened to already be running at
  that exact moment, with nothing else requesting a fresh pull until the
  next scheduled sync (potentially minutes away).
- **Fixed: the Date widget specifically could flicker continuously
  between formats, not just revert once.** A lightweight per-second timer
  that keeps the Clock and Date widgets' text current (so they don't need
  a full re-render just to catch a minute/day rollover) had its own
  separate, hardcoded US-long date string completely unrelated to the
  actual Date Format setting — every second, it silently overwrote
  whatever the real render had just correctly shown. Only ever affected
  the Date widget's own display; Agenda, Mini Calendar, and the rest were
  never touched by this timer.
- **Fixed: synced calendar events with a specific time could show at the
  wrong time, off by the gap between the Pi's actual timezone and
  America/Chicago** — e.g. a 1:00 PM UK event landing at 7:00 AM. Google
  Calendar (and other ICS feeds) send some events as a plain UTC
  timestamp; converting those to local time was reading a `timezone`
  setting that had no Settings-tab control and silently stayed at its
  hardcoded `America/Chicago` default for every install. The Settings →
  Timezone control (previously used only for chore-reset/briefing "what
  day is it" logic) now also drives this conversion. Events whose feed
  already specifies a named zone (e.g. `TZID=Europe/London`) were
  unaffected by this bug and remain unaffected by this fix — that's the
  majority of most feeds, including subscribed Google/iCloud calendars.
- **Timezone dropdown now lists every IANA timezone (400+), each labeled
  with its live UTC offset** — e.g. "Chicago (America) — CDT, UTC-5" —
  computed fresh so it stays correct across Daylight Saving changes
  rather than being hardcoded. Removes the old "Custom…" free-text entry
  entirely; the list is exhaustive enough that typing a zone name by hand
  should never be necessary.

## 1.79.2
- **Fixed: synced calendar events with a specific time could show at the
  wrong time, off by the gap between the Pi's actual timezone and
  America/Chicago** — e.g. a 1:00 PM UK event landing at 7:00 AM. Google
  Calendar (and other ICS feeds) send some events as a plain UTC
  timestamp; converting those to local time was reading a `timezone`
  setting that had no Settings-tab control and silently stayed at its
  hardcoded `America/Chicago` default for every install. The Settings →
  Timezone control (previously used only for chore-reset/briefing "what
  day is it" logic) now also drives this conversion, so setting it
  actually fixes calendar sync too. Events whose feed already specifies a
  named zone (e.g. `TZID=Europe/London`) were unaffected by this bug and
  remain unaffected by this fix — that's the majority of most feeds,
  including subscribed Google/iCloud calendars, which typically export
  in the calendar owner's own zone rather than UTC.
- **Timezone dropdown now lists every IANA timezone (400+), each labeled
  with its live UTC offset** — e.g. "Chicago (America) — CDT, UTC-5" —
  computed fresh so it stays correct across Daylight Saving changes
  rather than being hardcoded. Removes the old "Custom…" free-text entry
  entirely; the list is exhaustive enough that typing a zone name by hand
  should never be necessary.

## 1.79.1
- **New: the Weather Favorites card now shows a real forecast** — today's
  high/low plus a compact 4-day strip (icon + high/low per day), not just
  the current temperature. The data was already being fetched the whole
  time; this only changes what the card renders.
- **New: more Favorites cards link out.** Give a Sticker, Add a Chore, Add
  to Shopping List, and Redeem a Reward each get a small secondary link
  to the relevant tab, alongside their existing do-it-right-here action.
- **Favorites cards are noticeably more compact** — tighter padding,
  smaller gaps, smaller fonts throughout every card type.
- **New: 4 Home Assistant Favorites cards** — Light/Switch Toggle,
  Room/Group Toggle (pick any set of entities and a name, independent of
  the wall display's own Combo Groups), Scene/Script Button, and
  Thermostat (current + target temp with a +/− stepper, using the
  device's own real min/max/step). Each entity/group picker is
  searchable and filtered to domains that make sense for that card type;
  if Home Assistant isn't connected yet, the picker says so plainly.
- **New: 3 more Favorites cards** — Next Up (your next calendar event
  with a countdown), To-Do Count, and Add a To-Do Item.
- **Fixed: font-size sliders on 24 different widgets were capped well
  below what the widgets themselves actually support** — Agenda,
  Upcoming, Today, Tasks Combined, Date, Weather, Mini Calendar, News,
  Stocks, To-Do, Shopping List, Chore Chart, Leaderboard, Countdown, Moon
  Phase, Air Quality, Travel Time, QR Code, Timer, On This Day, Daily
  Quote, Sports, METAR, and Home Assistant widgets can now all be sized
  significantly larger, in both the app's Layout tab and the wall
  display's own Live Edit panel.

## 1.79.0
- **New: Favorites tab** — replaces Calendar as the app's landing tab. A
  personally-curated dashboard of quick-action and at-a-glance cards,
  built from a fixed catalog via a "+ Add a Card" picker rather than
  free-form content, and starting empty by design (no pre-seeded starter
  set to prune).
  - **Quick actions**: Give a Sticker (tap a kid, done), Add a Chore, Add
    to Shopping List, Redeem a Reward.
  - **At a glance**: Today's Chores progress, Sticker Balances, Weather,
    Shopping List count, Screens Online — each links straight to its
    related tab/sub-tab when tapped.
  - **Shortcuts**: a specific kid's sticker card (opens straight to their
    sticker sheet), the Family Hub QR code.
  - **Utility**: Copy `/kids` link, Copy `/hub` link, and a standing
    "Request a New Card" button for suggesting a card that isn't in the
    picker — goes straight to the developer through the same pipeline as
    Settings → Feedback & Ideas.
  - Cards can be reordered (▲/▼) and removed; stored server-side as one
    shared list for the household, so Favorites looks the same on every
    device the app is opened from.
- **New: choose which tab the app opens to** — Settings → App Preferences
  → Default Tab. A personal, per-browser preference (like the existing
  auto-hide/pull-to-refresh preferences already there), not synced across
  devices.
- **New: a banner when the developer replies to feedback you've sent** —
  visible from any tab, not just if you happen to already be in Settings.
  Tapping it jumps straight to an expanded Feedback & Ideas section
  rather than leaving you to find it.
- **New: click-to-copy** for the `/kids` and `/hub` links already shown in
  the Family Hub tab's Chores and To-Do sub-tabs.
- **New: an in-app "What's New" popup** (the one you're reading right
  now) — shows a short, plain-language summary automatically after the
  app updates, instead of leaving you to guess what changed.
- **Fixed:** the "Copy Link" button in Devices → Add a Display didn't
  work at all on a plain HTTP connection (which is how this app is
  normally reached) — a real bug, not just a rough edge. Every copy
  button in the app now shares one reliable implementation.
- **Fixed:** a visual glitch where the "Redeem" button in a kid's sticker
  sheet stretched across and overlapped the reward's own text.
- **Fixed:** the "How are stickers awarded?" card was squeezed
  side-by-side instead of stacked, cramming the dropdown into a narrow
  strip.
- **New:** stickers can now be backdated to a previous day when awarded
  manually, instead of only today.
- **New:** new kids default to Allowance turned on in the kid editor,
  easy to miss when it was off by default.
- **New:** the "screens running an older version" banner now waits a
  short while after a host update before it can appear (mirrors need a
  few minutes to catch up after any update — that's normal, not a
  problem), and can be dismissed.
- Most explanatory text across the app is now tucked behind a small ⓘ
  button next to the label it explains, instead of always taking up
  space as visible paragraph text.
- The tab bar is a bit more compact so more tabs fit before it needs to
  scroll.

## 1.78.1
- **New: most explanatory hint text across the app is now behind an ⓘ info
  button instead of always-visible paragraph text**, inline next to the
  label/heading it actually explains — matching the app's pre-existing
  hand-built pattern ("Decoration Style ⓘ") rather than floating on its
  own line. Developed across 10 beta rounds (1.78.1-beta.1 through
  beta.10); this entry is the consolidated, as-shipped description — see
  HANDOFF.md for the full session-by-session history, including two real
  bugs caught and fixed before they ever reached this release (a
  corruption bug that spliced an info button into the middle of a
  `style` attribute, and a stale detection check that let some hints get
  paired with unrelated text several fields away).
  - Both `display.html` (the wall display's own Live Edit panel) and
    `hub.html` (Family Hub) had no info-button mechanism at all before
    this — added the same `infoBtn()`/`showInfoPopup()` pattern to both,
    restyled to match each file's own theme.
  - Every hint that had a single, unambiguous label or section-row to
    attach to now lives inline in that label. Hints with no such
    anchor — a section-level intro, or a note spanning several controls
    at once — were deliberately left as plain, always-visible text rather
    than shown as an orphaned icon with nothing to explain what it
    belonged to.
- **New: "Give a Sticker" has a Date field**, so a sticker can be
  manually backdated to a previous day instead of only today. Capped at
  today (no future dates). The server already supported this; only the
  app was missing a way to set one.
- **New: click-to-copy for the `/kids` and `/hub` links** shown in the
  Family Hub tab's Chores and To-Do sub-tabs.
- **New: new kids default to Allowance turned on** in the kid editor,
  easy to miss when it was off by default.
- **Fixed: the "Copy Link" button in Devices → Add a Display didn't
  work at all** — a real bug (a clipboard write with no error handling,
  silently failing on the plain-HTTP addresses this app is normally
  reached at). Factored every copy button in the app (Add a Display, the
  Profiles sub-tab, the Family Hub QR card, and the two new ones above)
  onto one shared `copyToClipboard()` helper with a proper fallback,
  rather than three slightly different versions of the same logic.
- **Fixed: the "Redeem" button in a kid's sticker sheet visually
  stretched across and overlapped the reward's title/cost text.** The
  global `.btn` class defaults to full width, sized for primary
  full-width buttons elsewhere in the app; this particular button never
  overrode that for its actual small, inline use.
- **Fixed: the "How are stickers awarded?" card** was laid out
  side-by-side, squeezing the mode dropdown into a narrow strip next to
  a two-line hint — now stacked vertically like every other settings row
  in the app.

## 1.77.96-beta.14
- **Fixed: "Show all" appeared to do nothing at all.** Real bug in
  beta.13's new custom dropdown, not a tuning issue: its handler replaces
  the menu's contents to show the full list — but that innerHTML swap
  detaches the very "Show all" button that was just clicked, from the
  document. The click event keeps bubbling regardless (its path was fixed
  when the click was first dispatched), and by the time it reaches the
  document-level "close on outside click" listener, that listener's
  `wrap.contains(e.target)` check sees a now-detached node and can't tell
  it apart from an actual outside click — so the menu got closed again
  immediately after this same click had just expanded it. Net visible
  effect: expansion and closure both happened on the same click, back to
  back, faster than a screen could show — indistinguishable from nothing
  happening. Fixed with `e.stopPropagation()` on the "Show all" button's
  own handler, so this click never reaches the document listener at all.

## 1.77.96-beta.13
- **The Editor sub-tab's "Editing Layout" picker is no longer a native
  `<select>`.** beta.11/12 both tried to fix "Show all" by avoiding a full
  page rebuild, but missed the actual, more fundamental cause of "click
  Show all, it closes, click again to see the rest": a native `<select>`
  element always closes the instant any option is picked — that's OS-level
  browser behavior, not something CSS or JS can override from inside the
  page. No amount of in-place-update cleverness on what happens AFTER
  selection could fix a browser closing the dropdown DURING it.
  - Replaced with a custom dropdown this code fully controls: a button
    showing the current layout, opening an absolutely-positioned list of
    options. "Show all" is a row inside that same open list — clicking it
    appends the rest of the options to the still-open list instead of
    closing anything.
  - Same behavior as before otherwise: default is active-on-a-device
    layouts plus whatever's currently selected (even if inactive); picking
    a real layout closes the menu and loads it; clicking outside closes
    it. No visual/styling regression intended — matches the app's existing
    form-input look for the trigger button.

## 1.77.96-beta.12
- **Fixed the same "collapses and reshows" effect on the Profiles sub-tab's
  own "Show all" — missed in beta.11, which only fixed the Editor
  sub-tab's dropdown version of this control.** Clicking "Show all" here
  called the full sub-tab render, replacing everything (the intro
  paragraph, the "Add a profile" input and anything half-typed into it,
  scroll position) just to reveal a few more cards — same root cause as
  the Editor sub-tab, different UI shape (a card list instead of a
  `<select>`).
  - Split the card-list generation (`buildProfilesListHtml()`) and its
    wiring (`wireProfilesList()`) out of the full-render function so the
    toggle can call a new `refreshProfilesList()` that only replaces the
    list's own container (`#profiles-list-wrap`) and rewires just that
    fragment — the intro text and add-profile section never move.
  - Filtering itself was already correct (this was purely about HOW the
    update happened, not what it showed) — same active-on-a-device
    definition as before, unchanged.

## 1.77.96-beta.11
- **Reworked the Editor sub-tab's "Show all" — no longer causes the whole
  editor to collapse and rebuild, and no longer persists as a sticky
  toggle.** Previously, picking "Show all" from the dropdown called the
  full sub-tab render (reloading the layout, rebuilding the canvas and
  toolbar underneath it) just to widen an option list — that full rebuild
  was the "collapses and then shows the items" effect. Now it only expands
  the `<select>`'s own options in place; the layout you're editing never
  reloads.
  - There's no longer a persisted on/off filter state at all. What's
    visible is derived fresh every time the sub-tab actually loads
    (switching sub-tabs, saving, changing orientation, picking a different
    layout): active-on-a-device profiles, plus whichever one is currently
    selected even if it's inactive. Picking "Show all" only widens the
    dropdown's own option list for that moment — it doesn't change what
    the NEXT real load of this sub-tab shows, which goes back to
    active-only unless you've actually selected an inactive one.
  - Matches exactly: "each time it opens it should only show the active
    items, unless another layout that is not active is selected."

## 1.77.96-beta.10
- **Fixed: the ⭐ balance next to a kid's name on the Family Hub tab's Chores
  view didn't update after deleting/clearing stickers, redeeming a reward,
  or undoing a redemption from the sticker sheet.** Root cause: every
  mutating action inside `openStickerSheet()` only ever refreshed the sheet
  itself (`openStickerSheet(kid)` again) — never the Chores tab underneath
  it, which is a separate render (`renderChoresTab()`) holding its own,
  now-stale copy of each kid's balance. Since the sheet is a floating
  overlay appended to `document.body` (not inside the tab's own content
  area), and app.html has no live-update listener that would have caught
  this automatically either, nothing ever told the tab behind the sheet to
  redraw — the number was only ever correct again after leaving and
  re-entering the tab. Fixed by having every mutation (give, clear all,
  redeem, undo redemption, delete one sticker) refresh both: the tab
  underneath immediately reflects the true balance regardless of how the
  sheet eventually gets closed — the Close button, or tapping the backdrop
  (which bypasses the button's own handler entirely, so fixing only that
  button wouldn't have been enough).

## 1.77.96-beta.9
- **"Active" now means on an active (online) device, not just assigned to
  one.** beta.6–8's filter only checked whether a profile was assigned to
  ANY screen, regardless of whether that screen was actually online — a
  profile sitting on a long-unplugged test Pi still counted as "active."
  `getActiveDisplaySlugs()` (the one shared helper both sub-tabs use) now
  only counts screens with `online: true`, so the filter reflects what's
  genuinely showing right now, not just what's nominally assigned.
- **Editor sub-tab: "Show all" moved into the dropdown itself**, as its own
  option at the bottom of the list, instead of a separate link below it.
  Selecting it flips the filter and re-renders the option list — picking
  it doesn't change which layout you're editing, only what's offered.
  Symmetric in both directions: filtered down to active shows "— Show all
  (N not on an active device) —"; showing all shows "— Show only active
  (N) —" to flip back. Only appears at all when there's something to
  reveal or hide — a fleet with everything active sees no extra option.

## 1.77.96-beta.8
- **Extended the "active only" profile filter to the Editor sub-tab.**
  beta.6 added this to the Profiles sub-tab only; the "Editing Layout"
  dropdown on the Editor sub-tab still listed every profile regardless of
  whether it was actually on a screen. Same convention — a "Show all (N
  not on any screen)" link, hidden away by default — now applies there
  too, with its own independently-remembered on/off state (filtering one
  sub-tab doesn't silently change what the other shows).
  - The active-slug computation (a screen with no explicit assignment is
    really showing the FIRST profile) is now a single shared helper
    (`getActiveDisplaySlugs()`) used by both sub-tabs, rather than two
    copies of the same fallback logic that could drift apart later.
  - Auto-reveals all profiles if filtering would either leave the dropdown
    empty OR hide the profile currently being edited — a filter should
    never make the thing you're actively looking at disappear out from
    under you.

## 1.77.96-beta.7
- **New: Show ⭐ Sticker Balance toggle on the chore chart widget** — on by
  default (matches the existing, un-toggleable behavior), but now optional
  in the widget's settings in both the app's Layout tab and the wall
  display's Live Edit panel, same as the calendar widget's own sticker
  toggle.
- **New: manual sticker management** in each kid's sticker sheet (app.html,
  Chores tab → tap a kid's badge):
  - Every earned sticker in the activity history now has its own 🗑️ remove
    button, matching the undo button redemptions already had.
  - A "🧹 Clear All" button resets a kid's sticker balance to zero in one
    step, for a bulk correction rather than deleting one at a time.
    Deliberately doesn't touch redemption history — a kid's past redeemed
    prizes stay on record regardless of a later balance correction, the
    same "don't rewrite what already happened" principle the rest of this
    ledger already follows.
- **New: 🎁 Redeemed Prizes section in the Family Hub** (`/hub`) — a
  read-only, combined feed of every kid's redeemed rewards, most recent
  first, so a parent using the Hub (not the full app) can see what's been
  claimed without digging through each kid's individual sticker sheet.
  Display only, same as the Hub's existing chores/kids sections — actually
  redeeming or undoing a redemption still happens in the full app.
- New `GET /api/sticker-redemptions` endpoint (combined feed across all
  kids, joins in each kid's current name/avatar/color rather than trusting
  a stale snapshot for those fields — only reward_title/star_cost are
  meant to be frozen at redemption time) and `DELETE /api/stickers?kid_id=`
  (bulk clear). Both kept under `/api/stickers` rather than nested under
  `/api/kids/:id/...` specifically to avoid accidentally inheriting that
  broader path's already-public status via the route whitelist's prefix
  match — a bulk-destructive action needed the same protected boundary the
  single-sticker delete already has, not the public one `/api/kids` itself
  uses.

## 1.77.96-beta.6
- **New: Layout Profiles now default to showing only "active" ones** — a
  profile actually assigned to at least one screen right now — with a
  "Show all (N not on any screen)" link to reveal the rest, exactly the
  same convention the Devices tab already uses for offline screens ("Show
  offline (N)" / "Hide offline"). Reused deliberately rather than inventing
  a new filter pattern.
  - "Active" correctly accounts for the default-profile fallback: a screen
    with no explicit profile assignment is actually showing the FIRST
    profile (same resolveDisplay() logic the server uses to render it), so
    that first profile counts as active even if no screen ever explicitly
    picked it by name.
  - Same self-correcting behavior as the offline-screens toggle: if
    filtering to "active" would leave the list empty (e.g. no screens
    registered yet), it auto-shows all rather than displaying a bare
    "Show all" link with nothing underneath it.
  - The "Add a profile" section and swipe-to-delete/duplicate are
    unaffected by the filter — deletion still checks the true total
    profile count (not just what's currently visible) before allowing the
    last one to be removed.

## 1.77.96-beta.5
- **Fixed: the "Top left" sticker badge position covered the day number.**
  `.mc-daynum` sits in normal flow at the top-left of every cell (a circle
  `calc(var(--cal-font) * 2)` wide); the top-left badge position was pinned
  to the cell's bare corner with no awareness of that circle, landing
  directly on top of it. Now offset to start right after the day number's
  own width (same formula, so it can never collide regardless of font
  size) instead of the literal corner. Top-right, bottom-left, and
  bottom-right were untouched — they were never overlapping the day number
  in the first place.
- **Known, not yet fixed:** a bottom-corner badge (Bottom Left / Bottom
  Right) can still visually collide with a day's "+X more" overflow
  indicator, on a day busy enough that the event list fills the whole cell
  height. Unlike the day-number fix, the event list's height is dynamic
  (not a fixed size/position), so this needs the cell to carry the
  configured badge size as a CSS variable and reserve matching space in
  whichever bottom corner is active — flagged and intentionally deferred
  rather than built speculatively; revisit if it's confirmed as a real
  problem in practice.

## 1.77.96-beta.4
- **Fixed: sticker badges weren't scaled by --ui-scale like every other
  pixel-based visual on the wall display** — they were baked to a fixed
  pixel size in JS at render time, unlike the day number circle they sit
  next to (`.mc-daynum`, sized via `calc(var(--cal-font) * 2)`, which
  itself already includes `var(--ui-scale,1)`). On most screens this made
  the badges read as noticeably smaller/weaker than the day numbers, not
  matched to them. `stickerBadgeHtmlD()` now takes a full CSS length value
  (a `calc()` expression including `var(--ui-scale,1)`, same pattern used
  everywhere else on this screen) instead of a bare pixel number, so it
  responds correctly to the display's overall scale without needing a
  re-render.
- **New: adjustable Badge Size**, alongside Badge Position in the calendar
  widget's sticker settings (app.html's Layout tab and the wall display's
  Live Edit panel, kept in sync as always). Defaults to matching the day
  number's own diameter exactly — same size, not an afterthought — with a
  slider to make them bigger or smaller from there.
- Sticker badge row on a day cell now wraps instead of overflowing past the
  cell edge if several kids earned one on the same day at a larger size.

## 1.77.96-beta.3
- **Fixed: the Stickers section was missing from the app's own Layout tab
  settings panel** for the calendar widget — beta.2 only added it to the
  wall display's Live Edit panel (`display.html`). These are two separate,
  independently-built settings UIs for the same widget (no shared module
  system between the app and the display), and the app-side one was missed
  entirely. Added field-for-field to match: the toggle, the position picker,
  and their wiring (including the redraw-on-toggle so the position row's
  visibility updates correctly, same pattern the existing Color Coding
  toggle already uses for its own dependent row).

## 1.77.96-beta.2
- **New: Sticker Chart**, integrated with the existing chore chart rather than
  built as a separate system. A kid can earn a sticker either automatically
  (when a chore with celebration on is completed) or manually (a parent taps
  "Give a Sticker" any time, for anything) — the family picks which, via a new
  Manual/Auto setting on the Chores tab. Default is Manual.
  - Each kid picks how their sticker looks: a colored star with their initial
    (the default — this is what solves two kids sharing a first initial,
    since the color is still per-kid and always distinct), their existing
    avatar emoji, or a separate custom emoji just for stickers.
  - **Rewards**: parents define redeemable prizes (e.g. "Ice cream trip" for
    10 stars), scoped to one kid or everyone, managed from a new Rewards
    section on the Chores tab. Redeeming checks the balance server-side (not
    just a greyed-out button) and is reversible — an accidental redemption
    can be undone, giving the stars back.
  - **Calendar widget**: an opt-in badge (off by default) marks any day a kid
    earned a sticker — one badge per kid per day regardless of how many they
    earned that day. Configurable corner placement. New setting under the
    calendar widget's Advanced Settings, alongside the existing Decoration
    Style options.
  - **Chore chart widget**: each kid's star balance now shows next to their
    streak, using their same chosen sticker style.
  - **Kid page** (`/kids`): a new balance badge in the header opens a sticker
    board — recent stickers earned and available/affordable rewards (view
    only; redeeming stays a parent action in the main app, same trust
    boundary as everything else that isn't just checking off a chore).
  - Data model: `stickers` (earn events) and `sticker_redemptions` (spend
    ledger) are both append-only, same shape as the existing allowance
    ledger — a kid's balance is always derived (earned − spent), never a
    mutable running total, so undoing a redemption or un-checking an
    auto-awarding chore is a clean, exact reversal.
- **Not done:** untested on real hardware or against a live server, same as
  everything else built this session from code review. Worth specifically
  confirming: the calendar badge doesn't visually collide with existing
  decoration styles (postit/icon) when both are on at once, and that the
  auto-award path correctly skips chores with celebration off.

## 1.77.96-beta.1
- Start of the beta line under the new versioning scheme (mothership
  server v1.32.16 — see its CHANGELOG for the full reasoning) — identical
  to stable 1.77.95 at this point, no changes yet. Beta work continues
  from here; when it's ready, it gets incorporated into a fresh
  plain-numbered stable release (1.77.96) rather than promoted from this
  build directly. The mothership's "Promote to Stable" button/endpoint no
  longer exists for exactly this reason.

## 1.77.95
- **Removed the "Auto-fit to widget size" checkboxes entirely** — the
  underlying logic was already disabled last version, but the checkboxes
  themselves were still sitting in Settings, checkable but doing nothing.
  Pulled from all six widget types (Weather, Clock, Date, Countdown,
  Timer, Text) in both the app and Live Edit — 12 spots total. Font
  Size/Content Size sliders are back to always visible, exactly as they
  were before any of this existed. Also removed the now-pointless
  `autoFit`/`wxAutoFit: true` defaults that were being set on newly
  created widgets, and the quick-access panel's auto-fit-aware note and
  guard, reverting it to its original simple behavior.
  - The core measurement functions from last version's disable are
    untouched — still no-ops, still there if this is ever picked back up.
    This release only removes the UI that pointed at them.
- **Not done:** untested on real hardware.

## 1.77.94
- **Disabled auto-fit** (Weather, Clock, Date, Countdown, Timer, Text) —
  several rounds of fixes across v1.77.88–93 didn't resolve the reported
  "doesn't grow with widget size" behavior, and continuing to guess at it
  without being able to see it run wasn't a good use of anyone's time.
  Turned off with the least invasive change possible: the three core
  measurement functions (`autoFitWeatherContent`, `autoFitLineContent`,
  `autoFitWrappedTextContent`) now return immediately as a no-op, with
  their real logic left in place below (unreachable) rather than deleted.
  Every call site — `setupWeatherAutoFit`/`setupTextAutoFit`,
  `rerenderSingleWidget`'s hooks, `applyResizeFrame`'s direct calls, and
  both `ResizeObserver` callbacks — stays exactly as it was and is now
  simply harmless, since the function it calls does nothing. All content
  sizing is back to purely the manual Content Size/Font Size sliders,
  same as before any of this existed.
  - Known trade-off, worth knowing about rather than discovering later:
    the "Auto-fit to widget size" checkboxes are still visible and
    toggleable in Settings for all six widget types — checking one just
    won't visibly do anything anymore. Left as-is rather than also
    stripping the UI, to keep this change small and easy to fully reverse
    later (undoing it is a matter of deleting one `return;` line per
    function, not rewiring anything).
  - Verified with a runtime test: calling the now-disabled function
    against a widget with an existing manual value confirms that value
    passes through completely untouched.

## 1.77.93
- **Auto-fit now runs directly during a live resize-drag, not just via
  `ResizeObserver`.** Real report: after several rounds of fixes to the
  auto-fit math and clamps, content still wasn't growing/shrinking while
  actually dragging a widget's resize handles. Root cause: every previous
  fix assumed `ResizeObserver` would automatically detect the box size
  change from a drag and re-run the fit on its own — which is what it's
  *for*, but that assumption was never actually confirmed against this
  codebase in a real browser, and evidently didn't hold up. Rather than
  keep debugging that assumption, `applyResizeFrame()` — the one and only
  place a widget's width/height ever changes — now calls
  `autoFitWeatherContent()`/`autoFitTextWidgetContent()` directly, live,
  every frame of the drag, the same way `onResizeEnd()` already explicitly
  re-runs the calendar's own fitting logic rather than trusting anything
  automatic for that one either. `ResizeObserver` is still registered
  alongside this (harmless, and still useful for a resize triggered some
  other way — e.g. a layout change synced in from another device), it's
  just no longer the only thing standing between a resize and the content
  actually updating.
- **Not done:** still untested on real hardware — flagging this
  particularly plainly this time, since the last several rounds on this
  exact feature were each verified by a different kind of test (math
  simulation, timing trace, boundary values) that turned out not to catch
  the actual problem. None of that should be read as a substitute for
  watching this run in a real browser, which is the one thing I still
  can't do from here.

## 1.77.92
- **Removed the upper size clamp from auto-fit** — Weather was capped at
  2.5x its base size, Clock/Date/Countdown/Timer at 3x (270px for Clock).
  Real report: a large widget box stopped growing well short of what the
  box could actually fit, looking like auto-fit had "maxed out." Kept the
  *lower* clamp on both (0.4x for Weather, 0.25x for the line widgets) —
  that one guards against a real failure mode (a sliver of a box producing
  unreadably tiny text), which the upper clamp never had an equivalent
  case for: the widget's own box size is already a direct, real
  measurement of available room, so there's nothing to protect against on
  the "too big" side.
  - Verified with a runtime test: a box sized for a 10x ratio (previously
    hard-capped at 3x/270px) now correctly scales all the way to 900px;
    a tiny box still correctly clamps at the 22.5px floor.

## 1.77.91
- **Fixed: auto-fit widgets flashed at the correct (bigger) size briefly,
  then visibly reverted to the small un-fit size.** Real report on Clock,
  but the same mechanism affected every auto-fit widget (Weather included).
  Root cause: the fit was applied via `requestAnimationFrame`, deferred one
  frame after the widget's base HTML was written — meaning the browser got
  a real opportunity to paint the un-fit frame before the correction
  landed. This file has a lot of background polling that calls a full
  `renderLayout()` (weather every few minutes, calendar every 5, Home
  Assistant every 8-15 **seconds** while editing) — every single one of
  those repainted the un-fit-then-fit flash, not just the initial page
  load.
  - Fixed by applying the fit directly and synchronously — both in
    `setupWeatherAutoFit()`/`setupTextAutoFit()` (called once per full
    `renderLayout()`) and in the two `rerenderSingleWidget()` hooks (Live
    Edit settings changes) — instead of deferring to
    `requestAnimationFrame` or relying on `ResizeObserver.observe()`'s own
    initial callback. Both of those are asynchronous by nature —
    `ResizeObserver` callbacks are *always* async by spec, never
    synchronous, regardless of whether `.observe()` itself is called
    eagerly or deferred; an earlier attempt at this exact fix mistakenly
    assumed calling `.observe()` synchronously would make the fit land
    synchronously too, and it doesn't. `.observe()` still gets called in
    both places — it's still what catches genuine future resizes (a
    user's own drag-resize) — it's only the very first application that
    no longer waits on it.
  - This was safe to do synchronously because every widget's box size was
    already set as an explicit, absolute pixel value earlier in the same
    function (never intrinsic/content-driven) — there was nothing
    genuinely asynchronous the old deferral was waiting on.
  - Verified with a runtime test confirming the CSS variable is correctly
    set to the fitted value within the same synchronous call, with no
    `await`/`setTimeout` gap, while `.observe()` is still separately
    registered for future resizes.
- **Not done:** still untested on real hardware.

## 1.77.90
- **Fixed a real, significant bug in auto-fit's math — affects Weather too,
  not just this phase's widgets.** Real report: Clock's auto-fit wasn't
  scaling at all, and the manual Font Size slider stopped responding after
  turning auto-fit back off.
  - Root cause: the measurement step reset each widget's size variable to
    a bare, un-scaled baseline (`'1'` for weather, `'90px'` for clock)
    before measuring — but the box being measured against
    (`clientWidth`/`clientHeight`) is always real on-screen pixels, which
    already reflect whatever `--ui-scale` is active for the current
    screen/preview. That's only exactly 1 at the literal 1920px reference
    resolution — everywhere else, comparing an un-scaled measurement
    against an already-scaled box produces a result that's off by a
    factor of `--ui-scale`, in either direction depending on whether it's
    above or below 1. Verified numerically: at `--ui-scale: 0.3` (a
    typical scaled-down preview), content rendered at just 30% of the
    correct size — reads exactly like "not scaling," which is what got
    reported. At `--ui-scale: 1.5`, it overshot by 50% instead.
  - This is exactly why the standalone runtime tests before v1.77.88/89
    didn't catch it: those tests used plain numbers with no actual CSS
    `var(--ui-scale)` resolution involved at all, so this class of bug
    couldn't surface there no matter how many cases were tried — a real
    gap in that testing approach, not just bad luck.
  - Fixed in both `autoFitWeatherContent()` (shipped in v1.77.88) and
    `autoFitLineContent()` (Clock/Date/Countdown/Timer, this phase) by
    including `var(--ui-scale,1)` in the measurement baseline too, not
    just the final applied value. Text's own auto-fit already did this
    correctly by coincidence (its loop always used the full scaled
    formula from the first iteration) and needed no change.
  - Also fixed a second, related gap while investigating: Live Edit's
    quick-access widget panel has its own separate "Font Size" slider,
    entirely unaware `autoFit` exists — dragging it while auto-fit was on
    would get silently overwritten by the very next auto-fit pass,
    looking exactly like "the slider doesn't work." That slider (and its
    row) now hides itself with an explanatory note whenever auto-fit is
    on for the selected widget, and the slider's own change handler now
    also refuses to write a value in that state as a second line of
    defense. This gap only affects the five widgets from this phase —
    Weather has no entry in the registry this quick-access panel reads
    from, so it was never exposed to it.
  - Verified the corrected math with a numeric simulation across three
    `--ui-scale` values (1, 0.3, 1.5): the old formula was off by exactly
    the predicted factor in each case, the new one lands exactly on the
    available size every time.
- **Not done:** still untested on real hardware — this fix is verified by
  the numeric model of what a browser's CSS `calc()`/`var()` resolution
  does, not by watching it happen in an actual browser.

## 1.77.89
- **New: Auto-fit to widget size for Clock, Date, Countdown, Timer, and
  Text** — phase 1 of extending weather's auto-fit (v1.77.88) to the rest
  of the app, since investigation showed weather was never uniquely
  broken; every text-bearing widget uses the same fixed-font-slider
  pattern with no box awareness. This batch covers the ones with a single
  large/prominent line, where the mismatch is most visually obvious.
  - Built as one shared engine rather than five near-duplicate
    implementations, using each widget's own pre-existing CSS custom
    property (`--clock-font`, `--date-font`, `--cd-font`, `--timer-font` —
    all already there, not added for this).
  - Text needed a genuinely different approach from the other four: it
    already wraps at 100% of its container's width, and changing a
    wrapping element's font size changes where it wraps — a single ratio
    calculation (fine for Clock/Date/Countdown/Timer, which are always one
    fixed-format line) can still overflow or undershoot for wrapping
    content. Text gets an iterative shrink-to-fit-by-height loop instead,
    starting from its own configured size rather than always resetting to
    a shared default, since an existing Text widget's chosen size is far
    more likely to be intentional than the others' defaults are.
  - Clock's Auto-fit is digital-only — an analog face's size is already
    box-relative via its own "Size" field, so the toggle hides itself when
    Style is set to Analog.
  - Same rollout shape as weather: on by default for newly-created
    widgets, existing ones keep current manual behavior untouched unless
    turned on.
  - Verified with standalone runtime tests: the line-based scaling
    (width-constrained, height-constrained, both clamps, and the
    analog-clock no-match case), and the text shrink loop (normal shrink,
    already-fits no-op, and an extreme case confirming it hits the floor
    and stops rather than looping). Caught and removed one piece of dead
    code in my own first draft before shipping — a loop condition that
    looked like a floor-check but was always true regardless of actual
    value, left over from an earlier version of the logic; the real floor
    stop was already handled by an explicit break elsewhere, so this
    wasn't a functional bug, just misleading code worth cleaning up.
- **Not done:** untested on real hardware. The remaining ~22 widgets in the
  font-slider registry (Stocks, News, To-Do, Sports, and the rest) are a
  separate, later phase if wanted.

## 1.77.88
- **New: Auto-fit to widget size for all four Weather widgets** (Weather,
  Current Weather, Weather Forecast, Weather Hourly). Real report — the
  cork board theme's weather widget wasn't resizing with the widget box,
  and investigation found the actual root cause: content size was driven
  entirely by a manual "Content Size" slider, completely independent of
  the widget's actual box dimensions, in every theme. Cork board just made
  it most visible, since its pushpin + padding decoration leaves less room
  to begin with.
  - New "Auto-fit to widget size" toggle (on by default for newly-created
    weather widgets; existing ones keep their current manual behavior
    unless turned on, so nobody's already-tuned layout changes underneath
    them). When on, a `ResizeObserver` on the widget's actual box measures
    available space against the weather content's natural size and
    computes a fitting `--wx-scale` automatically — genuinely resizes with
    the box now, dragging the resize handles included. When off, behaves
    exactly as before with the manual slider.
  - Measures via `clientWidth`/`clientHeight`, which already reflects
    whatever padding/decoration the active theme adds — cork board's extra
    chrome is automatically accounted for with no theme-specific code.
  - Caught and fixed a real bug in my own first pass before shipping:
    turning Auto-fit off didn't actually stop the resize observer from
    watching that widget, so a later resize could still silently
    overwrite the manual value the person had just gone back to. Fixed by
    explicitly unobserving when the toggle goes off, not just skipping
    re-observation.
  - Verified the core scale math with a standalone test (undersized box,
    oversized box past the clamp, tiny box past the other clamp, exact
    match, and width- vs. height-constrained cases) — all five correct.
- **Not done:** untested on real hardware — the ResizeObserver and actual
  visual behavior haven't been watched running in a real browser, only the
  math and DOM-selector logic verified directly.

## 1.77.87
- **Hid the Account Status section in Settings** (trial/access-ends
  messaging and the "Manage your license" link) — Piazza HQ
  is being offered free right now, so this had no reason to show. Done as
  a comment-out, not a deletion: `renderLicenseStatus()` and everything it
  builds is untouched, just not called from either of its two call sites.
  Uncommenting those two lines brings it straight back if that changes
  later. Also stopped a settings re-fetch that only existed to feed that
  now-disabled function — no point in the extra round-trip on every
  license key save with nothing consuming the result.
  - The License Key field itself, and the whole system underneath it, is
    untouched — someone can still paste a key in (e.g. a Mirror needing
    the main device's key), it just won't display status/expiry
    information about it anymore.
- **Not done:** untested on real hardware.

## 1.77.86
- **New: a periodic feedback prompt, roughly weekly, on the host device.**
  Real request. A lightweight bottom-sheet ("Got a minute?") with a kind
  selector and a short textarea, posting to the same `/api/feedback`
  endpoint the full Settings-page form already uses — this is a faster,
  lower-friction path to the same place, not a separate system.
  - Host-only — a mirror is typically a secondary/kids' display, not where
    the primary user would naturally be asked this.
  - Doesn't ambush a brand-new install: the very first time this runs (no
    prior schedule recorded at all), it silently schedules the first
    prompt a few days out instead of showing immediately.
  - "Maybe later" (or tapping the backdrop) reschedules ~7 days out. "Don't
    ask again" pushes it ~10 years out — no separate opt-out flag, just a
    much longer version of the same reschedule.
  - Tracked with one new settings field
    (`feedback_popup_next_eligible_at`), stored the same way every other
    per-household setting already is — locally on this household's own
    server, nothing new sent anywhere else.
  - Verified the eligibility logic with a standalone runtime test (never-
    scheduled, future date, past date, opt-out horizon) — all four cases
    passed as expected, not just a syntax check.
- **Not done:** untested on real hardware — haven't watched the popup
  actually appear and dismiss/submit/snooze in a real browser session.

## 1.77.85
- **New: the app's own Devices tab now shows online devices by default,**
  with a "Show offline (N)" link to reveal the rest — same convention
  already used for Feedback/Contact in the admin panel. Real request.
  Online devices always group first regardless of the API's own return
  order; if every device happens to be offline, it auto-reveals rather
  than showing an empty page with nothing but a link on it.
  - Verified with a standalone runtime test (mixed online/offline devices,
    toggling the link on and off) confirming the filtering, counting, and
    toggle behavior all work as expected — not just a syntax check.
- **Not done:** untested on real hardware.

## 1.77.84 (hotfix)
- **Fixed: the Calendar widget disappeared entirely on every screen.** My
  bug, from the Color Coding feature two versions back (v1.77.81) —
  `renderMiniCalGrid(widget)` referenced an undefined variable `w` instead
  of its actual parameter `widget` in two spots, throwing a ReferenceError
  the instant any Grid-layout calendar (i.e. virtually every calendar,
  since that's the default layout) tried to render. Grid layout is used by
  default, so this broke calendars everywhere, immediately, on update.
  Fixed both references. Went through the rest of every function touched
  this session (renderMiniCalGrid/Agenda/Strip, renderWeather/Current,
  renderStocks, the combo group editor, calendar settings) checking for
  the same class of mistake — none found. Actually executed
  renderMiniCalGrid/Agenda/Strip in a sandboxed Node environment against
  representative widgets (color coding on/off, both full-day event styles,
  a multi-day span, real timed/all-day/multi-day events) and confirmed
  each one runs without throwing and produces the expected markup — not
  just a syntax check this time, an actual runtime execution.
- Apologies for this one — it should have been caught before v1.77.81
  shipped.

## 1.77.83
- **Fixed: Photo widget edge fade wasn't scaled for smaller screens.** Real
  report. The app scales every other pixel-based visual value (fonts,
  padding, border-radius) by `--ui-scale` so content authored for the
  1920px reference display doesn't look oversized on a smaller screen — the
  edge fade's pixel distances were simply never wired into that same
  convention. A fade that looked right at reference size ate a
  disproportionately larger share of the photo on a smaller screen, since
  everything around it shrank but the fade itself didn't. Rewrote
  buildEdgeFadeMask() to emit a live `calc(Npx * var(--ui-scale,1))`
  directly in the gradient stops instead of a value computed once in JS, so
  it now scales the same way everything else does — and stays correct even
  if `--ui-scale` changes without this widget's HTML being fully
  re-rendered.
- **Not done:** untested on real hardware at a genuinely small size —
  confirmed the CSS is well-formed and the scaling math is consistent with
  how every other scaled value in this file works, but haven't watched it
  render at a small screen size side-by-side with the reference size.

## 1.77.82
- **New: Today Indicator Style for the Calendar widget's Grid layout.** Real
  request — the red circle was the only option before this. New dropdown
  offers six choices: Circle (the original), Outline (ring only, no fill),
  Cell Highlight (tints the whole day box instead of just the number),
  Underline, Text Color (just colors the number, no shape at all), and
  None. Color is customizable per-widget in the app (swatches + a native
  color picker, same pattern as the calendar event colors added last
  version) — defaults to each theme's own red if left alone, matching
  today's look exactly.
  - Refactored chalkboard's and corkboard's own hardcoded today-circle
    colors to set the same `--today-color` variable the new style choices
    read from, instead of hardcoding the circle shape directly. Both themes
    still show their own distinct red by default; the shape is now a
    genuine user choice layered on top rather than baked into each theme.
  - Scoped to Grid layout only, matching what was actually described (a
    circle around the day number) — Agenda and Strip already mark today a
    different way (a "Today" list-group label, and a highlighted column
    respectively) that isn't really the same kind of "circle vs. dot"
    choice, so left alone.
- **Not done:** untested on real hardware, including whether the new
  styles read cleanly against every theme's own background/text colors —
  only checked the CSS specificity math by hand, not by looking at it.

## 1.77.81
- **New: Color Coding on/off and Full-Day Event Style for the Calendar
  widget.** Real report. Two related additions:
  - **Color Coding** (new toggle, on by default): a master switch that
    removes every colored dot and pill highlight from the calendar
    entirely — plain text only — for anyone who finds the color markers
    visually noisy. Applies across Grid, Agenda, and Strip layouts.
    Independent of each individual calendar's own "color-code timed
    events" setting; this widget-level switch overrides everything when
    off, regardless of what any one feed is configured to do.
  - **Full-Day Event Style** (new dropdown, Grid layout only): "Highlight"
    (the original colored-background pill) or "Dot" (a colored marker with
    no background, matching how a timed event's dot looks) — for anyone
    who wants a lighter-weight look for all-day events specifically.
    Grayed out while Color Coding above is off.
- **Fixed a real visibility gap: full-day events had no color indicator at
  all in the chalkboard theme** (and any future theme that does the same
  thing) — chalkboard forces the colored pill background transparent for
  legibility on the dark slate background, but nothing ever filled in for
  it, so there was no way to tell which calendar a full-day event belonged
  to just by looking. The default "Highlight" style now always includes a
  small dot inside the pill regardless of theme, closing that gap
  universally rather than needing a chalkboard-specific patch — with a
  subtle white ring around it so it stays visible even in normal themes
  where it'd otherwise blend into the pill's own matching-color background.
- Scoped to what was actually described — colored dots/highlights "next to"
  or "behind" an event. Left the Bar/Line/Stripe multi-day event styles
  (a different mechanism — colored spans/borders, not a dot-or-plain-text
  choice) unaffected by the Color Coding master switch; happy to extend if
  that's wanted too.
- **Not done:** untested on real hardware, including the chalkboard fix
  specifically — worth a direct look at a chalkboard-themed calendar with
  full-day events before assuming this fully closes the gap.

## 1.77.80
- **New: a native color picker alongside the 8 preset swatches, everywhere
  calendar colors are set.** Real request for "more options" — the fixed
  8-swatch palette was the only choice before this. Added to all three
  places a calendar color gets picked: a manually-added event's own color,
  a new calendar subscription's color, and editing an existing subscribed
  calendar's color. Picking a preset swatch still works exactly as before;
  the new color wheel next to it opens the OS's native picker for any
  color at all.
  - Editing an existing calendar's color used to read the selected color
    from which swatch had a `.selected` CSS class at Save time — which
    would have silently dropped a genuinely custom color, since no swatch
    would ever be marked selected for one. Reworked to track the current
    color on the picker's own container instead (updated by both swatches
    and the new custom input), read from there at Save time.
- **Not done:** untested on real hardware.

## 1.77.79
- **New: Adaptive Font Sizing for the Calendar widget.** Real report — some
  calendar events are styled like "🎂Name🎂" for birthdays, and the trailing
  emoji alone was sometimes enough to tip the line onto an orphaned second
  line. Adds an opt-in toggle (requires Wrap Event Text to be on) that
  measures each event's actual rendered height after layout and, only for
  ones that wrapped, tries shrinking that ONE event's font by up to 2px —
  keeping the smaller size only if it's enough to bring it back to one
  line. If even the max 2px shrink still wraps, it's left at full size and
  wrapped exactly as before. This is deliberately narrow (a character or
  two over the edge), not a general auto-shrink-to-fit, so a genuinely long
  title is never silently squeezed down to something hard to read. Applies
  to Grid and Agenda layouts.
  - Runs before the existing overflow-fitting pass (fitCalendarCells), since
    shrinking a wrapped event back to one line changes how much vertical
    space it takes — doing this after would measure stale, still-wrapped
    heights.
  - Side benefit: Live Edit changes to any calendar setting (wrap mode, max
    lines, and now this) now re-run that overflow fitting immediately
    instead of waiting for the next full render — previously only a widget
    resize or the periodic full re-render triggered it, so some settings
    changes wouldn't visibly update in the Live Edit preview until later.
- **Not done:** untested on real hardware, and I haven't visually confirmed
  the birthday-emoji case specifically resolves as expected — worth a
  direct look before assuming this is fully working.

## 1.77.78
- **New: Show End Times option for the Calendar widget.** Adds a toggle in
  Live Edit and the app's widget settings — off by default — that shows
  "9:00 – 10:00 AM" instead of just the start time, for events that aren't
  all-day or multi-day. Applies to both Grid and Agenda layouts. Strip
  layout already showed both start and end time unconditionally before this
  existed as a setting anywhere, so it's untouched and keeps doing that
  regardless of the toggle — the row and its hint text are hidden while
  Strip is selected, rather than showing a control that wouldn't do
  anything.
- **Not done:** untested on real hardware.

## 1.77.77
- **Moved: tracking individual stock/crypto tickers is now a Stock widget
  setting, not a device-wide Data Sources setting.** Previously every Stock
  widget on every display shared one global ticker list, edited from
  Settings → Data Sources — the same "one shared setting, no override" shape
  weather's location was in before v1.77.x added per-widget overrides.
  "Tickers to Track" (the input, chips, and crypto quick-add buttons) has
  moved into each Stock widget's own settings, in both the app and Live
  Edit, so different Stock widgets can now track entirely different lists.
  Market Indices (Dow/Nasdaq/S&P visibility) stays in Data Sources, since
  which indices exist at all is still genuinely device-wide.
  - Existing tickers aren't lost: any Stock widget that's never had its own
    list set inherits the old global list once, the first time it loads
    after updating.
  - The Daily Briefing email's markets summary now pulls the union of
    tickers across every Stock widget on every display, since it's one
    device-wide digest with no single widget to ask.
  - `/api/stocks` now takes the ticker list as a request parameter instead
    of always reading one DB-wide value, so multiple widgets can request
    different (or overlapping) sets from the same batched, cached fetch.
- **Not done:** untested on real hardware, and untested against an actual
  household with multiple Stock widgets already using the old shared list —
  worth specifically confirming the one-time migration lands correctly
  there before this goes wide.

## 1.77.76
- **New: Location Position setting for the Weather and Current Weather
  widgets.** Adds a "Location Position" control in Live Edit — "Above
  current weather" (the existing default) or "Above forecast", which moves
  the location label down to sit directly on top of the forecast strip.
  Current weather always fills whichever slot the location isn't in, so
  there's one setting to manage rather than two that could disagree. For
  the Current Weather widget specifically, this only has a visible effect
  once its own Forecast Days slider is turned on — with no forecast strip,
  there's nothing for the location to sit "above" in that second position.
- **Not done:** untested on real hardware.

## 1.77.75
- **Fixed my own bug from v1.77.74's fix.** That release preserved the combo
  group editor's picker-list scroll position across the re-render triggered
  by each selection click — but captured the scroll position once, when the
  panel first rendered, rather than fresh at the moment of each click. In
  practice: scroll down to find an entity, tap it, and the "restore" step
  put you back at the position the list was in when it FIRST opened (almost
  always the top), not where you actually were when you tapped — silently
  reproducing the exact bug it was meant to fix for anything below the
  fold. Items near the top of a freshly-opened list "worked" purely because
  there was nothing to restore (0 → 0), which is why it looked like a
  partial fix rather than no fix at all. Corrected to read the live scroll
  position inside each click handler, right before triggering the
  re-render, instead of a value captured once at mount time.
- **Not done:** untested on real hardware.

## 1.77.74
- **Fixed: tapping an entity or area inside Live Edit's Combo Group editor
  jumped the picker list back to the top instead of visibly selecting it.**
  Real report. Root cause: every selection/removal click in the combo group
  editor called the full `openWidgetAdvancedPanel()` re-render (needed,
  since the summary lists and conditional section headers above the pickers
  only exist in that full render) — which builds brand-new DOM for the two
  scrollable picker boxes every time. The outer panel's own scroll was
  already preserved across this kind of re-render (v1.77.67), but that fix
  never extended to these two nested boxes, so each click silently reset
  them to the top. The underlying selection itself was actually working the
  whole time — the mutation happened correctly — it just wasn't visible,
  since a click near the bottom of a long entity list immediately bounced
  back to the top, making it look like the tap had been swallowed. Fixed by
  capturing each box's scroll position right before the re-render and
  restoring it after the new DOM lands, same rAF-after-layout approach as
  the existing outer-panel fix.
- **Not done:** untested on real hardware.

## 1.77.73
- **New: Fahrenheit/Celsius for weather widgets.** A global default in
  Settings → Weather, plus a per-widget override (same "use global default
  or override it" pattern already used for the location override) on all
  four weather widget types, in both the app's settings panel and Live
  Edit. Weather is still fetched and cached in Fahrenheit exactly once —
  the conversion happens purely at display time (`formatTemp()` in
  display.html, `emailFormatTemp()` in server.js for the daily briefing
  email), so this didn't double outbound API calls or complicate caching
  by unit. Also caught and fixed two premature-rounding spots along the
  way (an hourly-average temperature was being rounded to a whole
  Fahrenheit degree *before* converting to Celsius, losing a bit of
  accuracy) — both in display.html and the email digest.
- **Fixed: changing a weather widget's location in one layout silently
  changed every other weather widget across every other layout too.**
  Real report, root-caused precisely: every individual weather widget's
  own settings panel had a "Location Name" field that looked scoped to
  that one widget but actually edited a single global, device-wide
  setting — it even had a warning comment already, which clearly wasn't
  enough to prevent the confusion. Removed that field entirely (replaced
  with a read-only display of the current global default, plus a pointer
  to where it's actually editable) in both the app and Live Edit — it's
  now structurally impossible to make this mistake again. The
  already-working per-widget location override (checkbox + ZIP lookup,
  for something like a vacation-home display) is untouched and remains
  the correct way to give one specific widget its own distinct location.
- **Bonus fix caught while investigating the above:** the daily briefing
  email was still hardcoded to Fahrenheit in three separate spots (HTML
  headline, hourly table, plain-text version) — all three now respect the
  same global unit setting, so the email and the wall display no longer
  show contradictory units.

## 1.77.72
- **Fixed a mirror's "license required, N days left" warning being
  permanently stuck even after Account Status correctly showed Active.**
  Real report, found live on the same fresh-install test as 1.77.71:
  `storeLicenseInfo()`'s entire grace-period block (both starting AND
  clearing `no_license_since`) was gated to hosts only. That's correct for
  STARTING a grace period — a mirror shouldn't independently begin its own
  countdown — but wrong for CLEARING one: `no_license_since` is genuinely
  per-device (deliberately excluded from host→mirror sync), and a mirror
  already independently checks in with its own key, gets its own
  `license_status_cache` set from the result, and — confirmed by reading
  `display.html` — actually enforces its own grace period locally. With
  the whole block skipped for mirrors, a mirror that ever set its own
  `no_license_since` had no code path anywhere that could ever clear it
  again — not its own check-ins (skipped the clearing branch entirely),
  not sync (the field never syncs by design). Split the logic: clearing
  now runs for any role; only starting a new grace period stays host-only.

## 1.77.71
- **Fixed a freshly-entered license key showing "No license — free trial"
  for up to 6 hours after finishing setup.** Real report, found on the
  very first live fresh-install test: entering a genuinely valid key
  directly in the setup wizard (as opposed to the email/trial-signup path)
  saved it correctly, but never refreshed `license_status_cache` —
  `periodicUpdateCheck()` only runs ~90 seconds after boot and then every
  6 hours, and that first run typically already happens (correctly caching
  "no license" at that point) before someone's even finished clicking
  through the wizard to enter their key. The Settings tab's own key-entry
  field already refreshes immediately after saving specifically to avoid
  this exact failure mode (see its own long-standing comment) — the wizard's
  direct-key path just never got the same fix applied to it. Now it does.

## 1.77.70
- **Packaging fix only — no code changes from 1.77.69.** That build was
  packaged as a flat zip (no wrapping `piazzahq/` folder), which installs
  fine through every normal in-app update but fails a genuine fresh
  install via `bootstrap-install.sh` (fixed separately, central server
  v1.32.7) with "install.sh wasn't found where expected." Version bump
  exists only because the admin panel's release publisher hard-rejects
  re-uploading an already-published version number — this is otherwise
  byte-identical in content to 1.77.69, just correctly packaged.

## 1.77.69
- **Closed the setup wizard's "Already have a host" dead end.** That card
  (shown when registering by email finds a different device already
  recognized as this account's host) only ever offered two ways out —
  set up as a Mirror, or try a different email — with no way to actually
  claim host on the spot, even if you genuinely were the legitimate owner
  standing right there re-setting-up your own device (a real-world case
  this came from directly: wiping and reinstalling on a replacement/
  reimaged device). Added a third option, "This is my account — enter my
  license key," which switches into the wizard's existing direct-key entry
  mode rather than adding any new claim logic — `finishWithDirectKey()`
  was already correct and secure (proceeds once the key itself is
  verified, no separate host-conflict check at all), it just wasn't
  reachable from this specific card. Deliberately NOT a bare "yes it's
  me" button: reaching this card only ever required knowing an email
  address, not a secret, so a no-proof claim option here would have undone
  that protection. Requiring the actual key keeps the same bar regardless
  of which door someone came in through. If a real conflict still exists
  after setup completes, it surfaces properly moments later via the
  ongoing check-in flow's own Claim/Slave/Trial modal, unchanged.

## 1.77.68
- **Fixed: a mirror's license key silently reverting a few minutes after
  being saved.** Real report — looked like "saving doesn't work" but
  actually saved correctly every time; a mirror syncs from its host every
  5 minutes by default, and `update_license_key` was missing from the list
  of settings protected from being overwritten by that sync (same category
  as device role, host address, display name — things that MUST stay
  per-device). A mirror is specifically supposed to hold its own
  independently-verified key (the host even requires a mirror to present
  a matching one before it'll sync at all) — but with this field
  unprotected, whatever the host had stored kept getting silently pushed
  down and overwriting a mirror's correctly-typed key, every cycle, even
  when the host's own value was itself wrong. Added to
  `LOCAL_ONLY_SETTINGS`, closing both directions at once (it's the same
  constant governing what gets exported from the host and what gets
  applied on the mirror).

## 1.77.67
- **Sped up HA entity status updates** — the ambient poll (the one that
  runs all the time, not just while Live Edit is open) was checking every
  60 seconds; real report that this felt slow. Now 15 seconds — still
  comfortably above the server's own 10-second per-entity cache floor
  (anything faster than that wouldn't actually return fresher data
  anyway), but cuts worst-case staleness by 4x. Live Edit's own dedicated
  8-second poll is unchanged and stays faster still, since that's the
  moment someone's actually watching a toggle to see if it's accurate.
- **Fixed Live Edit's widget settings panel jumping back to the top on
  every selection.** Selecting an area (or picking an entity, or removing
  something) redraws the whole panel to reflect the change — and that
  redraw was unconditionally resetting scroll to the top every time, so
  browsing partway down a long entity list and tapping something threw you
  back to the top instead of staying put. Now only resets on a genuinely
  fresh open of the panel; an in-panel action re-rendering an already-open
  panel preserves exactly where you were scrolled to.
- **New: Combo Groups for the Smart Home Dashboard** — combine several
  areas and/or individual entities into ONE named tile (e.g. "Upstairs" =
  Bedroom + Bathroom + Office, one switch), sitting alongside individual
  per-area tiles rather than replacing them. Distinct from Group Control,
  which already did this at the whole-widget level — this brings the same
  "combine several things into one toggle" capability to the Dashboard,
  where it's an option per-tile rather than the only thing the widget can
  show. Each combo group gets its own small editor (name + area/entity
  picker, reusing the same live-resolution and covered-by-area disabling
  already built for the top-level pickers) — in Live Edit as a sub-view of
  the Dashboard's own advanced panel, and in the app as its own bottom
  sheet. Deliberately scoped: a combo group's own membership doesn't
  cross-check against the widget's top-level selections or other combo
  groups — keeping "does this group make sense on its own" as the only
  guarantee, not a much larger consistency web across every grouping
  mechanism at once.

## 1.77.66
- **Fixed: Smart Home Dashboard and Group Control couldn't be added as NEW
  widgets from Live Edit at all.** `display.html` maintains its own widget
  catalog for Live Edit's own "+" add-widget picker, entirely separate
  from `app.html`'s — only Entity Status had ever been added to it. Both
  missing widgets are now fully registered there (catalog entry, Smart
  Home category, and default field values on creation), so all three HA
  widget types can be added directly from Live Edit, not just edited there
  after being created in the app.
- **New: five view styles for the Smart Home Dashboard** — Grid (unchanged
  default), List (compact rows), Icon-only (icon circles colored by
  state, maximum density), Card (larger rows with more visual weight),
  and Tap-card (the whole card is the tap target — no small toggle switch
  to aim for on a wall-mounted touchscreen; state shown by the card's own
  background/border color instead). Picked via a new View selector in the
  widget's settings, in both the app and Live Edit. Non-toggle entities
  (climate, scenes/scripts) keep their full existing controls (stepper,
  trigger button) embedded in whichever view's layout, except Icon-only
  (shows an icon + tiny value, no room for a stepper at that size) and
  Tap-card (falls back to Card's layout for these, since "tap anywhere"
  doesn't make sense for something needing its own +/- buttons). Grid's
  underlying code path is completely untouched — the four new views are
  additive, not a rewrite of what already shipped.
- **New: tile/row sizing, unified with the existing font-size control** —
  rather than adding a second, separate size slider, the widget's existing
  Font Size setting was reframed (and relabeled "Tile/Text Size") to do
  double duty: since virtually every dimension in every view already
  derives from the same `--ha-font` CSS variable via `calc()` (icon
  circles, toggle switches, padding, gaps, text), one slider already
  proportionally scales the whole tile, not just its text.

## 1.77.65
- **Corrected 1.77.64's area selection for the Smart Home Dashboard —
  the developer's actual ask was simpler than what shipped.** An area selected in
  the Dashboard was expanding into individually-listed, individually-
  controlled entity rows (grouped under the area's name as a room
  heading). What was actually wanted: an area is just a switch — one
  combined toggle for everything in it, same shape as the Group Control
  widget's own tile, not a way to list its entities out. Fixed:
  `renderSmartHomeDashboard()` now renders each selected area as one
  combined on/off tile (reusing the exact same tap-wiring path as Group
  Control's toggle), sitting in its own section alongside any
  individually-picked entities — never expanded into separate rows. The
  picker behavior is unchanged and was already correct: an entity covered
  by a selected area still can't also be individually picked in the same
  widget, since it's covered by the area's tile now, not displayed
  individually at all. "Group by Room" (which only ever affected
  individually-picked entities' groupings) now only shows in the settings
  panel when there are individual entities to group — showing it
  alongside an area-only selection had no visible effect.

## 1.77.64
- **Fixed: no way to remove a selected entity from Smart Home Dashboard (or
  Group Control) without reopening the picker and hunting for it in the
  full list.** Both widgets' settings panels now show a clear × remove
  button right next to each selected entity, in the app and in Live Edit —
  removal is one tap, not a re-search.
- **New: select a whole Home Assistant Area, not just individual entities
  — and it stays live.** Previously the only way to add "everything in the
  Kitchen" was a one-time bulk-insert (the old "+ Add all") that just
  copied in whatever was there at that moment; anything added to that room
  in Home Assistant later had to be found and added by hand. Areas
  selected now are resolved fresh every time the widget renders or acts —
  add a new light to the room in HA and it shows up here automatically,
  no re-editing needed. Available on both Smart Home Dashboard and Group
  Control. To prevent the exact confusion this was built to avoid — is an
  entity selected individually, via its area, or both? — an entity that's
  covered by a selected area is shown disabled/greyed in the individual
  entity list, with no way to also pick it separately; unchecking the area
  is what makes it individually selectable again. Entities and areas can
  both be removed independently once selected. Replaces the old "+ Add
  all" button entirely, in the app and in Live Edit, rather than leaving
  two different ways to add a room's worth of devices with different
  semantics side by side.

## 1.77.63
- **New: real Live Edit settings parity for Entity Status, Smart Home
  Dashboard, and the new Group Control widget.** Previously none of the
  three had an advanced settings panel in Live Edit at all — you couldn't
  even pick a different entity for an Entity Status widget without leaving
  the wall display for the app. Now all three have the full picker
  experience right on the display itself: search, real Home Assistant Area
  filtering with bulk "Add all" (same capability shipped in the app
  earlier this cycle), per-entity room labels and Group by Room for the
  Dashboard widget, and the Show Unit toggle for Entity Status. Title and
  font size stay in the existing basic panel (already worked) — this adds
  exactly what was missing, not a duplicate of what already existed.
  Fetches entities/areas via plain `fetch()` (this page has no session/auth
  layer — the wall display is always public by design), with its own
  small cache (`cachedHaEntitiesD`/`cachedHaAreasD`) mirroring the app's.
- **New: Group Control widget** — a single tile that turns a whole set of
  entities on/off together with one tap (e.g. "turn a whole floor off"),
  distinct from the Smart Home Dashboard (which shows multiple entities
  individually controlled — confirmed already covers the "dining
  room/family room together" ask via today's area bulk-add, no separate
  work needed there). Works out the correct single action itself before
  sending anything: if anything in the group is currently on, tapping
  turns everything off; only turns everything on if the whole group is
  off. New server endpoint `POST /api/ha/call-group-action` fires one real
  HA service call across every member at once (HA's `turn_on`/`turn_off`
  natively accept an array of entity ids, even across different domains —
  not N separate requests). Deliberately does NOT support HA's `toggle`
  service for groups — given multiple entity ids, `toggle` flips each one
  independently based on its OWN state, which is wrong for a mixed
  on/off group (the on ones would turn off and the off ones would turn on
  — the opposite of one clear group action). Full picker with the same
  area-filter/bulk-add capability as the other entity pickers, managing a
  flat entity-id list (no room labels — this widget never displays members
  individually, so there's nothing for a room to organize).
- **Fixed Live Edit's Entity Status/Smart Home Dashboard/Group Control
  toggles not reflecting reality while you're actively looking at them.**
  Real report: these are externally-controlled devices — a physical
  switch, another app, a voice assistant, an automation — so the normal
  ambient 60-second poll (unchanged, still what runs the rest of the time)
  is noticeably stale specifically when you're staring right at a toggle
  deciding whether it's accurate. Live Edit now runs its own dedicated
  8-second poll for HA entity state while it's actually open, on top of
  the normal one — costs nothing when Live Edit is opened on a layout with
  no HA widgets at all (`fetchHaEntities()` already no-ops cheaply in that
  case).

## 1.77.62
- **Fixed the SAME bug as 1.77.61 in a second, separate place** — the developer
  reported the PIN screen still appearing after updating to 1.77.61.
  `checkAuth()` (the boot-time auth check) uses its own raw `fetch()`
  rather than the shared `apiFetch()` helper 1.77.61 fixed, and had its own
  independent copy of the identical mistake: showing the PIN screen on a
  genuine network-level failure (couldn't reach the server at all), not
  just a real 401 (server reachable, explicitly said no). Also learned
  while chasing this down that updates now install fully automatically in
  the background — a server-side timer (`periodicUpdateCheck()`, every 6
  hours) with zero client coordination — so this isn't limited to "right
  after tapping an update banner" the way it first looked; a page
  load/reload can land in the middle of one of those restarts at any time.
  Fixed the same way as 1.77.61: a network-level failure no longer shows
  the PIN screen, only a genuine server-confirmed "PIN required, not
  authenticated" does. Also widened the retry budget for this specific
  network-error path from one 1.2s retry to three (about 3.6s of total
  patience) — better matched to how long a real background restart can
  actually take, now that we know these restarts aren't rare/one-time
  events tied to a manual update tap.

## 1.77.61
- **Fixed the PIN screen incorrectly appearing during a normal self-update,
  even on a device with no PIN configured at all.** A different recurrence
  of the same underlying class of issue as the earlier fresh-install PIN
  screen bug, but a genuinely new mechanism this time — not the old
  duplicate-CSS-property cause, which stayed fixed. Root cause: installing
  an update polls `/api/version` in a tight one-second loop while the
  server restarts (`installUpdateFromBanner()`), and the brief window
  between the old process exiting and the new one binding the port is a
  completely normal, expected connection failure during ANY restart —
  nothing to do with authentication. But the shared `apiFetch()` helper's
  network-error handler was unconditionally calling `showPinScreen()` on
  ANY failed request, regardless of whether a PIN was even configured,
  treating "couldn't reach the server at all" as identical to "the server
  rejected your session." The update-poll loop's own retry logic already
  correctly handles a failed tick as "still restarting, try again" — the
  PIN screen popping up on top of that was pure unwanted side effect, not
  anything actually needed. A real 401 (server reachable, session
  genuinely invalid) is unaffected and still correctly prompts for a PIN —
  this only stops a connectivity gap from being mistaken for a login
  requirement. Confirmed no other code relies on this side effect: nothing
  else in the app distinguishes a network error from a real 401 in its own
  follow-up handling, so removing just the screen-show call here changes
  nothing else.

## 1.77.60
- **Cleaned up the duplicate-listener stacking that made 1.77.59's save
  queue necessary in the first place.** `renderSettings()` was defining
  fresh 'input'/'change' handlers on every visit to the Settings tab
  without ever removing the previous visit's — since they're delegated
  listeners on the persistent `#content` container (survives every tab
  switch), a session with several Settings visits left that many duplicate
  handlers stacked. 1.77.59 already made this harmless from a data-loss
  standpoint (queued saves can't race and corrupt each other anymore), but
  turned up a second, separate problem while looking at it: an old stacked
  handler's closure still points at whatever `tickers`/`briefingProjectIds`
  array existed at the moment IT was first wired, not the current render's
  — so a save triggered by a stale handler could silently persist an
  outdated stock-ticker list or Todoist project selection instead of what
  was actually on screen. Fixed properly (not just papered over) by
  tracking the handlers on `window` and removing the previous pair before
  attaching new ones each render, so exactly one correct, current handler
  is ever attached at a time.

## 1.77.59
- **Found and fixed the actual, demonstrable root cause behind settings
  (Home Assistant's URL/token among them) silently reverting to blank with
  no specific action anyone could point to.** Confirmed NOT a backup/restore
  issue (that's a full-file swap and always included every setting anyway,
  no change needed there). The real mechanism: `renderSettings()` wires a
  fresh 'input'/'change' listener onto the shared `#content` container
  every single time the Settings tab is (re)opened, and nothing ever
  removed the previous one — they're delegated listeners on a container
  that survives every tab switch (only its inner content gets replaced), so
  a session with more than one visit to Settings ends up with that many
  duplicate listeners silently stacked. Each one independently debounces
  and fires its own `PUT /api/settings` for the exact same edit, and
  nothing previously ordered those requests against each other — an
  earlier-scheduled save (built from a momentarily blank or half-typed
  field, e.g. mid-select-all-and-paste into the token box) could resolve
  AFTER a later, complete one and silently overwrite it, since the server
  just applies whatever arrives last with no concept of "older" or "newer."
  Fixed by chaining every save through one shared, app-wide queue and
  building the save's payload at the moment it actually runs (not when it
  was originally scheduled) — the order PUT requests actually go out in now
  always matches the order edits actually happened in, regardless of how
  many duplicate listeners are stacked. The duplicate-listener stacking
  itself is a separate, lower-stakes issue (redundant requests carrying the
  same correct data, now harmless) — left alone for now; worth a proper
  cleanup pass later if it's ever worth the risk of touching that code path
  again.

## 1.77.58
- **Fixed Entity Status widget not updating its display label when swapping
  which entity it points to.** The entity picker only ever auto-filled the
  label when it was completely empty — so changing which entity a widget
  showed kept displaying the PREVIOUS entity's name/label, since the field
  already had something in it. Fixed with a small tracking field
  (`haLabelAutoFor`) that distinguishes an auto-filled label from one
  someone actually typed: an auto-filled label now correctly follows the
  entity when you swap it, while anything typed by hand is never touched,
  swap or not. Existing widgets keep whatever label they currently show
  until you either edit it or swap entities again — this doesn't
  retroactively rewrite text anyone might already be relying on.
- **New: real Home Assistant Area filtering**, for both the Entity Status
  widget's picker and the Smart Home Dashboard's multi-select picker.
  Previously the only way to organize entities was a free-text "room" label
  you typed yourself per entity — no connection to Home Assistant's actual
  areas at all. Now both pickers show a real area dropdown (sourced from
  HA's own area registry, with each entity's area resolved either from its
  own direct assignment or inherited from its device, matching how HA
  itself determines "which room is this in"); picking an area narrows the
  list, and the Smart Home Dashboard picker adds a one-tap "+ Add all" that
  bulk-adds every entity in that area at once — auto-filling the room label
  from the real area name instead of typing it in by hand for each one.
  Never overwrites a room label someone already set on purpose, same
  restraint as the label-auto-fill fix above.
  - Technical note: Home Assistant's REST API (everything else this
    integration uses) has no endpoint for the area/entity/device
    registries — genuinely not there, confirmed against HA's own docs and
    a still-open community feature request asking for exactly this. The
    only way to get this data is HA's WebSocket API, so this required
    adding a proper (one-shot, not persistent — connect, authenticate, ask
    for the three registries needed, close) WebSocket client
    (`haWsRequest()`), not just one more REST call. Uses the `ws` package
    already a project dependency (previously only used by the Samsung TV
    driver), wrapped in the same defensive try/catch as that existing use
    so an install that hasn't run `npm install` since this shipped loses
    only area filtering, not the rest of Home Assistant or the server
    itself. New `GET /api/ha/areas` endpoint, cached 5 minutes
    server-side (area layout changes rarely) — degrades gracefully to "no
    areas" rather than breaking the picker on an older HA version, a
    locked-down token, or if `ws` itself isn't available.

## 1.77.57
- **Fixed Entity Status/Smart Home Dashboard sometimes showing the opposite
  state right after a quick tap.** Root cause: `state.haEntities` was
  written from two independent places — the periodic 60s poll and the
  post-toggle confirm fetch that fires right after you tap — with nothing
  stopping an older response from resolving after a newer one and
  overwriting it. Concretely: tap a toggle right as the poll's request for
  that same entity is already in flight, and the poll's (pre-toggle)
  response could land *after* your tap's own fresh-confirm fetch, silently
  reverting the display to the opposite of the real state. Fixed with a
  per-entity fetch-sequence guard (`haEntityFetchSeq`/`applyHaEntityState`)
  — every state fetch for an entity stamps itself with the next sequence
  number at issue time, and a response only gets applied if it's still the
  latest one issued for that entity; anything older arriving late is now
  discarded instead of trusted. Applies to both the periodic poll
  (`fetchHaEntities()`) and the tap's own confirm fetch (`callHaAction()`),
  since either one could theoretically be the "late" one depending on
  timing.

## 1.77.56
- **Corrected a mistake from 1.77.55**: the display-side popup's escalation
  behavior (friendly + dismissible for days 1-4, firmer + non-dismissible
  for days 5-7 — the actual 1.77.54 behavior) had accidentally been
  overwritten to always-dismissible-with-a-link and shipped bundled into
  1.77.55 alongside the new in-app banner, which was never the intent.
  Reverted the display popup back to exactly 1.77.54's behavior (the
  genuine positioning/responsive-width fixes from 1.77.53/54 are
  untouched — only the escalation/dismissibility logic was reverted). The
  always-dismissible, link-included version now lives correctly as its
  own separate thing: the in-app banner from 1.77.55.

## 1.77.55
- **New: an in-app license grace-period notification, separate from and
  in addition to the wall display's own popups** (which stay exactly as
  they were). Visible the moment the app opens regardless of which tab
  someone's on — not just as text buried within Settings → Version &
  License itself. Always dismissible for the rest of the current day
  (same pattern as the display-side notice), tapping the text jumps
  straight to the Version & License section.

## 1.77.54
- **Fixed the day-1-4 license notice (and both the setup-needed and
  license-required full-screen overlays) not appearing at all in Live
  Edit / preview mode** — the exact same root cause as the earlier
  toolbar positioning bug: `position:fixed` anchors to the raw browser
  viewport, not the letterboxed preview box Live Edit actually renders
  into, so these could render entirely outside the visible area (or, for
  the full-screen overlays, cover the wrong bounds) whenever the preview
  box doesn't fill the whole viewport. Switched all three to
  `position:absolute`, anchoring correctly to `#rotate-wrap` instead —
  same fix already applied to the edit toolbar and widget panels earlier.

## 1.77.53
- **Fixed the day-1-4 license grace-period notice looking oversized on a
  narrow screen (e.g. testing on a phone)** — the notice already had a
  fixed 280px max-width (a genuinely small corner size on a large wall
  display), but that's proportionally huge on a phone's much narrower
  viewport. Now capped at `min(280px, 70vw)` so it stays a small corner
  notification regardless of actual screen size. Also shortened the
  message text itself (removed a redundant "Piazza HQ" already in the
  title above it), reducing wrapping/height on top of the width fix. The
  intentionally full-screen day-7+ hard-block overlay is unaffected —
  that one's meant to be unmissable.

## 1.77.52
- **New: real enforcement for a host operating with no valid license.**
  Previously ran indefinitely with just trial-tier widget/device limits,
  no matter how long that lasted. Now:
  - `no_license_since` — a stable timestamp set once a host is first
    detected with no valid license (checked on every periodic check-in),
    not recalculated each time, so the grace-period countdown is actually
    consistent rather than perpetually resetting. Cleared automatically
    the moment a valid license is detected again. Scoped to hosts only —
    a mirror has no independent licensing responsibility of its own.
  - **Days 1-4 of the 7-day grace period**: a friendly, dismissible
    (for the rest of the day) corner notice on the wall display —
    extends the existing pre-expiry trial-reminder system rather than
    building a separate one.
  - **Days 5-7**: the same notice, but firmer wording and no longer
    dismissible, as the actual deadline approaches.
  - **Day 7+**: the wall display stops rendering the normal calendar
    entirely, replaced by a full-screen "a license is required to
    continue" overlay with the same LAN/remote QR-code pattern as the
    existing first-run setup overlay — pointing to Settings → Version &
    License to resolve it.
  - The control app's own license status display now shows the same
    countdown, so whoever's managing the device via Settings sees it too,
    not just the wall display once it's already stopped.
  - Settings now requires a real confirmation before clearing an existing
    license key — a genuinely consequential action now, not something to
    silently accept. Role-aware wording (a mirror's consequence is just
    "can't sync," a host's is the full grace-period/hard-block above).
  - The host-conflict resolution's "trial" option (which clears the key
    deliberately) and any pre-existing/legacy device are both already
    correctly covered by this same runtime system as a safety net,
    regardless of how they ended up without a valid license — no separate
    fix needed for either.

## 1.77.51
- **Host setup's "one last thing" email step now has a toggle to paste an
  existing license key directly instead** — "Already have a license key?
  Enter it directly →". For someone who already signed up through the
  website's own standalone signup form (which gives a key with no device
  connection at all — nothing there knows which device it's for), this
  avoids the confusion of the email flow, which is specifically designed
  for someone who *doesn't* have an account yet. Reuses the same
  `/api/validate-license` endpoint mirror setup already validates
  against, for consistent behavior between both paths.

## 1.77.50
- **Removed the diagnostic tooling built for tracking down the false-PIN-
  screen bug**, now that the actual root cause (1.77.48) is fixed and
  confirmed working: the "Show diagnostic info" button on the PIN screen,
  `clientLog()` and every call site, the global uncaught-error/rejection
  listeners, the `init()` boot-start marker, and the server-side
  `/api/client-log` endpoint. Kept the genuine, permanent improvements
  this effort uncovered along the way — `apiFetch()` no longer throws
  uncaught on a network failure or an unparseable non-401 response body,
  and `checkAuth()` still retries once before giving up — since those are
  real fixes, not diagnostic scaffolding.

## 1.77.49
- **Mirror setup's "we don't recognize that license key" message now
  offers two real next steps** instead of just a dead end: a link to get
  a license key (for someone who doesn't actually have an account yet),
  and a "Go back and choose Host instead" link (for someone realizing
  this should be their first/only device, not a Mirror of one that
  doesn't exist). The latter reuses the existing back-button navigation
  rather than duplicating it.

## 1.77.48
- **The actual root cause of the false-PIN-screen mystery, finally
  found** — and it had nothing to do with any of the JavaScript auth
  logic six versions of diagnostics were built to catch. `#pin-screen`'s
  static inline `style` attribute declared `display` TWICE:
  `display:none` first, then `display:flex` later in the same
  attribute — and in CSS, the last declaration of a duplicated property
  wins. The element's actual, effective default state had always been
  visible, not hidden, regardless of any JavaScript ever running at all.
  This is exactly why nothing was ever captured: `showPinScreen()` never
  needed to be called for the element to appear, so logging placed
  anywhere in its call chain — no matter how thorough — could never have
  caught it. It surfaced specifically on the setup wizard path because
  `runSetupWizard()` had no reason to ever call `hidePinScreen()`, since
  the element was only ever supposed to start hidden by default.
  - Removed the duplicate `display:flex` from the static HTML — the
    element now genuinely starts hidden, exactly as intended.
  - Found and fixed the identical bug pattern in one other place
    (`#s-ha-detect-results`, the Home Assistant auto-detect results box —
    same double-`display:` mistake, same fix). Checked every other inline
    style in this file plus display.html/kids.html/hub.html for the same
    pattern; no other instances found.
  - Added a defensive `hidePinScreen()` call at the very start of
    `runSetupWizard()` — belt-and-suspenders on top of the actual fix, so
    the wizard (which has no login concept of its own) can never coexist
    with the PIN screen visible even if some future CSS mistake
    reintroduces a similar issue.

## 1.77.47
- **Likely the actual root cause of the whole false-PIN-screen mystery**:
  `res.sendFile()` for all four core pages (`/`, `/app`, `/kids`/`/chores`,
  `/hub`) had no explicit cache-control at all. Confirmed via a real clue —
  diagnostic logging added across five straight versions (1.77.43 through
  1.77.46, including logging placed directly inside `showPinScreen()`
  itself with a stack trace, the most robust possible catch-all) never
  captured anything beyond a boot-start marker, on a device repeatedly
  confirmed to be running the latest server version via `curl`. That
  combination — server confirmed updated, yet code added to the client
  file never executably ran — points at exactly one thing: the browser
  serving an old, cached copy of app.html from before any of that logging
  existed, entirely invisible to logging added to the very file that was
  stale. Now sends explicit `Cache-Control: no-store` on all four core
  pages — actively-developed, frequently-updated files where a browser
  silently serving a stale copy indefinitely is exactly the kind of
  failure that looks identical to a real bug from the outside. No service
  worker involved (checked and ruled out).

## 1.77.46
- **The actual fix for the diagnostic capturing nothing, after every
  previously-instrumented call site (apiFetch's three failure modes,
  checkAuth's two give-ups, even global uncaught-error/rejection
  listeners) came up completely empty across multiple confirmed-1.77.45
  tests, despite the bug reproducing every time.** Logging was happening
  at each known *caller* of `showPinScreen()` — meaning a caller that
  hadn't been found (or wasn't correctly instrumented) could never be
  caught, no matter how many individual call sites got covered one at a
  time. Moved the log into `showPinScreen()` itself — the single, shared
  point every caller must go through — with a stack trace attached, so it
  now catches literally any caller automatically and identifies exactly
  which one, rather than continuing to guess at individual call sites.

## 1.77.45
- **Two more diagnostic gaps closed for the still-unresolved false-PIN-
  screen bug**, after 1.77.44's fix only ever captured a boot-start
  marker and nothing else, despite the bug reproducing — meaning
  whatever's actually happening wasn't going through any of the points
  instrumented so far.
  - `apiFetch()`'s `res.json()` parsing was still unguarded — a non-401
    error response (500, etc.) with a body that isn't valid JSON would
    throw uncaught, silently swallowed by `init()`'s own empty `catch {}`
    with zero trace. Now caught and logged explicitly, same as the two
    failure modes already handled.
  - Added global `window.addEventListener('error'/'unhandledrejection')`
    listeners — a much broader safety net than trying to guess at
    individual failure points one at a time: catches literally any
    uncaught error or promise rejection anywhere on the page, logged the
    same way as everything else.

## 1.77.44
- **Real fix for the false-PIN-screen diagnostics not capturing
  anything**, after learning the bug is seen on a phone accessing this
  device remotely (likely over Tailscale), not on the device's own local
  display — meaning `journalctl` on the device only shows what actually
  reached its server, and can't see a failure in the phone's own
  connection getting there in the first place.
  - `apiFetch()`'s own `fetch()` call was completely unguarded — a genuine
    network-level failure (the request never completing at all, not an
    HTTP error response) threw uncaught instead of being handled, meaning
    neither the 401 path nor its logging ever ran for this specific
    failure mode. Now caught and logged explicitly.
  - `clientLog()` now writes to `localStorage` FIRST, before best-effort
    trying to also reach the server — a log that only exists once
    delivered to the server can't capture the exact failure (the phone's
    own connection) that would have prevented that delivery.
  - New "Show diagnostic info" link directly on the PIN screen, displaying
    whatever's been captured as plain, selectable text — meant to be
    copied or screenshotted straight off the phone that's actually stuck
    on this screen, since it has no SSH access of its own to check
    `localStorage` any other way.

## 1.77.43
- **Diagnostic aid for the still-unresolved false-PIN-screen bug** —
  server-side and database state have both been directly confirmed
  correct, but nothing has caught what actually triggers the PIN screen
  at the moment it happens. New `/api/client-log` endpoint (exempt from
  auth, same as `/api/auth/*` — must work even mid-auth-flow) lets the
  client report exactly what it saw right before showing the PIN screen
  into this device's own journalctl, reusing the SSH workflow already in
  use rather than needing browser dev-tools remote debugging on a mobile
  device. Instruments `apiFetch()`'s 401 handler (logs the exact path
  that 401'd) and both of `checkAuth()`'s give-up points (logs the actual
  response or error seen), plus a boot-start marker in `init()` for
  timing correlation. Safe to leave in permanently — harmless if never
  triggered, useful for any future "something happened but I can't see
  why" report.

## 1.77.42
- **Mirror setup now validates the license key against the central server
  directly**, giving real, immediate feedback ("we don't recognize that
  license key") instead of only discovering a mismatch later when the
  first background sync silently fails. Requires the paired central
  server update (`/api/v1/license-check`, a dedicated no-side-effect
  lookup — deliberately not reusing `/api/v1/update-check`, which logs a
  device check-in on every call and would have polluted the device list
  with junk entries from a wizard field validated on blur). Fails open if
  the central server is unreachable (e.g. still connecting to wifi during
  setup) rather than blocking setup entirely over a transient network
  hiccup — the host-side check in `/api/sync/export` is still the real
  enforcement at actual sync time regardless.

## 1.77.41
- **Fixed `/api/sync/photos` having zero license verification**, unlike
  `/api/sync/export` — a mirror with a wrong or missing license key could
  still pull the full photo listing (and the actual photo files
  downloadable from there) even after export was properly locked down.
  Extracted the check into a shared `checkMirrorLicense()` helper used by
  both endpoints, specifically because having it duplicated per-route is
  exactly how this endpoint ended up with none in the first place — two
  copies of the same logic drifted apart. The actual photo file download
  itself (`/uploads/*`) is a static file path outside `/api/*` entirely,
  deliberately left as-is — that's existing, intentional design (the
  unauthenticated wall display needs to load photos directly), not a new
  gap, and a mirror would need to already know exact, random-looking
  filenames to use it without the listing.
- **Fixed the "Manage your license" link pointing at a
  placeholder domain that never resolves.** `update_server_url` defaulted
  to `https://updates.picalendar.example` — a leftover placeholder,
  literally commented "change before relying on it," never actually
  updated to the real, live production URL despite the product being
  fully live throughout the rest of this codebase. Now defaults to
  `https://piazzahq.com`. Only affects brand-new installs — an existing
  device with the stale value already saved needs it corrected directly
  (see conversation for the exact fix).

## 1.77.40
- **install.sh: fixed a first-boot timing race that could leave the X11
  desktop panel/wallpaper missing** — confirmed live on a genuinely fresh
  install today. Toggling the kiosk off (Ctrl+Alt+K) showed a black screen
  instead of the desktop, even though the toggle itself worked correctly.
  Root cause: the system-default autostart file this script restores
  missing desktop-shell lines from (`@lxpanel-pi`/`@pcmanfm-pi` on this
  particular OS image) can still not exist yet if the script runs very
  soon after first boot — e.g. SSHing in and running the bootstrap install
  immediately after flashing, outpacing Raspberry Pi OS's own first-boot
  package setup. Previously this silently skipped the entire restoration
  with zero indication anything was wrong — the file just not being there
  yet looked identical to "nothing needed restoring." Now retries for up
  to 20 seconds before giving up, and clearly warns (with the exact fix —
  re-run this script) if it's genuinely still missing after that.

## 1.77.39
- **Mirror setup now requires a matching license key before sync is
  allowed at all.** Previously, a mirror could inherit a host's full
  license and settings just by knowing a reachable address — the only
  thing gating this was the host's own PIN, and a host with no PIN
  configured meant literally anyone reachable on the network (e.g. the
  same Tailscale tailnet) could register as a mirror and walk away with
  everything, no license or email verification of any kind required.
  - Mirror setup now has a required license key field (find it in
    Settings → Version & License on the host, or the original signup
    email).
  - The mirror presents this key on every sync request; the host verifies
    it matches its own license before handing over a settings snapshot
    (which includes the license key itself, among everything else). A
    mismatch or missing key is rejected outright with a clear explanation
    of how to fix it, rather than silently trusting whatever device shows
    up.
  - A host with no license configured at all has nothing to protect here,
    so sync proceeds as before — this only applies once a host actually
    has a real license.
  - This enforcement lives server-side (in the sync endpoint itself), so
    it can't be bypassed by setting up a mirror through a different path
    (Settings → Multi-Device, the host-conflict resolution card, etc.).
  - Also fixed `_httpGet`'s error handling to surface a server's actual
    error message instead of discarding it for a bare "HTTP 403" — needed
    so this new rejection message actually reaches the person via the
    sync status, not just a meaningless status code.
- **Fixed the Live Editing top bar (and the widget-picker banner, and the
  per-widget settings panel) covering widgets or floating above the
  actual screen entirely, depending on aspect ratio.** All three used
  `position:fixed` with hardcoded offsets, anchoring to the raw browser
  viewport instead of the actual (possibly letterboxed) display content
  box. Switched to `position:absolute`, anchoring correctly to
  `#rotate-wrap` (already sized/positioned to match the real content box)
  instead. Deliberately did NOT touch the resize-handle overlay — it
  already shares the same viewport-relative coordinate system as widgets
  themselves (both use JS-calculated pixel values that already account
  for the letterbox offset), so applying the same change there would have
  broken currently-correct resize-handle alignment instead of fixing
  anything.

## 1.77.38
- **Two fixes for a false PIN prompt appearing on a freshly-flashed
  device that was never configured with one.** Confirmed via direct
  server check that the underlying data was correct all along
  (`{"pin_set":false,"authenticated":true}`) — this was a client-side
  issue, not a persistent data/logic bug.
  - `checkAuth()` now retries once (after a short delay) instead of
    immediately committing to "a PIN is genuinely needed" on the very
    first attempt — the most likely explanation is a boot-timing race,
    loading `/app` in the narrow window right after first boot, before
    the server/database has fully settled.
  - Removed a client-side guard that silently refused to even attempt
    submitting an empty PIN. The server already correctly handles this
    itself (accepts anything, including empty, when no PIN is actually
    configured) — the client's own redundant check blocked the exact
    recovery path that should work if this screen ever does show up when
    it shouldn't have.

## 1.77.37
- **Fixed setup breaking when entering an email that already has a license
  key** — a real gap from the central server's 1.32.0 security fix (which
  stopped returning an existing license's key directly, emailing it
  instead). This device's own `/api/register-trial` called that same
  endpoint and required a key to come back or it would throw a generic
  "No license key returned" error — exactly what an existing email now
  correctly triggers, since it's just as reachable during initial setup
  (no PIN configured yet) as the marketing site's identical form was.
  Now handles this gracefully: shows a toast explaining the key was
  emailed and to paste it into Settings once retrieved, then continues
  setup normally (finishing with no license key configured yet is already
  a normal, fully-supported state — same as choosing "trial" from the
  host-conflict resolution card). Deliberately a toast, not a blocking
  status message requiring a second click — the wizard's Next/Finish
  button unconditionally re-runs this same registration attempt on every
  click with no state tracking, so blocking here would have re-triggered
  the identical email lookup and landed right back on this exact message,
  forever, with no way to actually finish setup.

## 1.77.36
- **Fixed text rendering roughly half-size in Live Edit/preview compared
  to the real display** — a confirmed cap mismatch between two twin
  scaling functions, found from a screenshot showing the same calendar
  widget wrapping to a second line on the real display but barely
  filling half its box in preview. `applyUiScale()` (the real display)
  was previously updated to allow font scaling up to 2x for a
  larger-than-1920px-reference display (4K etc.), via a `MAX_UI_SCALE`
  constant — but `applyPreviewScale()`'s parallel `tvUiScale` calculation
  was never updated to match, left hardcoded at the old `min(1, ...)`
  formula from before that fix existed. Any target resolution above the
  1920px reference rendered at roughly half the correct scale in preview.
  `MAX_UI_SCALE` is now a single shared constant both functions reference
  (previously a value local to `applyUiScale()` alone) — the actual fix
  for the bug class here, not just this one instance: two formulas that
  need to match can't silently drift apart if there's only one copy of
  the number to begin with.

## 1.77.35
- **Fixed the same grid/flex-shrinking gap in Weather Hourly's
  Morning/Afternoon/Evening/Night breakdown row** (`.wxh-part`), found
  while auditing every widget with a similar "row of equal-width text
  items" shape for the same bug that hit the calendar's day-of-week
  header. Its sibling row (`.wxh-hour`, the hour-by-hour strip) already
  had the right protection; this one didn't. Checked several other
  similar-shaped widgets — weather's daily forecast row (already safe,
  wraps instead of clipping), the chore chart's per-kid columns, and the
  calendar's strip layout — all already built correctly.

## 1.77.34
- **Fixed the days-of-week header (and calendar cells generally) not
  actually shrinking when the widget itself is resized narrower** — the
  real, separate mechanism from 1.77.33's viewport-scaling fix. This is
  the classic CSS Grid gotcha: grid items get an implicit `min-width:
  auto`, meaning text refuses to shrink below its own natural content
  width regardless of the column track technically having less room. No
  widget in this app auto-scales its font size from its own box
  dimensions (font size is always a separate, manual per-widget setting)
  — so narrowing a calendar widget without also reducing its font size
  hit exactly this: the day letters didn't shrink together, the excess
  just overflowed past the last column and got clipped by the outer
  widget's `overflow:hidden`. Added `min-width:0` to the day-name grid
  items and to the base calendar-cell class (covering both regular and
  post-it cells, which share it) so they can actually shrink to fit their
  share of the row instead of resisting it.

## 1.77.33
- **Likely fix for the post-it calendar's rightmost column disappearing
  entirely (no scrolling, just gone) when viewed on a device narrower
  than the ~1920px reference width** — e.g. a display URL opened directly
  in Safari on an iPad, not through Live Edit's own letterboxed preview
  scaling. Root cause: every other spacing value in this file scales with
  `--ui-scale` (which shrinks proportionally on a narrower viewport), but
  the post-it block's cell padding and note margin/padding (added in
  1.77.31/1.77.32) were hardcoded pixel values that stayed full-size
  regardless. On a real 1920px+ display `--ui-scale` ≈ 1, so this never
  showed up — but on a narrower viewport, these fixed, unscaled paddings
  ate a disproportionate chunk out of the grid's available width,
  squeezing the last column out entirely. Now scaled with `--ui-scale`
  like everything else.

## 1.77.32
- **Live Editing changes now show up on other screens noticeably faster.**
  Every layout change (even just moving one widget a few pixels) was
  triggering a full re-fetch of all 13 widget-data types — weather, news,
  stocks, sports, METAR/TAF, travel times, everything — before the other
  screen would re-render, several of which hit external APIs with real
  network latency. None of that data changes from a drag/resize, only
  positions do. Now compares the set of widget TYPES before/after a
  layout update, and only runs the full data refetch if a genuinely NEW
  widget type appeared (the original reason this existed — a widget added
  while the display is already running needs its first fetch immediately,
  not on its own periodic timer). A plain position/size tweak — the vast
  majority of Live Editing activity — skips straight to re-rendering with
  data that hasn't changed.

## 1.77.31
- **Fixed the Post-it notes calendar decoration clipping the rightmost
  note.** A prior fix already gave each rotated note margin room within
  its own cell, but the outer widget container's `overflow:hidden` still
  clips anything extending past the widget's own edge — and the calendar
  grid fills that edge-to-edge with zero slack, so the last column's note
  had nowhere left to give. Added small horizontal padding to the grid
  (only when post-it cells are actually present, via `:has()`), applied
  to both the grid and the day-of-week header row above it together —
  they're sibling 7-column grids, so padding only one would have
  misaligned the header from the columns below it.

## 1.77.30
- **Fixed Live Editing never actually persisting on a PIN-protected
  device — likely broken this entire time, on any device with a PIN set.**
  display.html's own save (`saveLayoutNow()`, used by dragging/resizing a
  widget directly on the wall OR via the Layout tab's new Live Edit panel)
  uses a plain, unauthenticated `fetch()` — deliberately, since Live
  Editing has always been meant to work with no login at all. But
  `PUT /api/layouts/:orientation` was never added to `publicRoutes`, so
  that save silently 401'd on any PIN-protected device. The drag still
  looked like it worked (immediate local state update before the save
  even completes), but nothing actually persisted — not on the screen
  being edited, and not on any other screen either, since there was
  nothing new in the database to broadcast in the first place. Confirmed
  `app.html`'s own editor was unaffected — it correctly uses `apiFetch`
  (authenticated), which is why that always worked fine.

## 1.77.29
- **Fixed "Unauthorized" on the METAR/TAF widget** — and three other
  silently-broken endpoints found by checking every widget-data call
  display.html makes directly, not just the one reported. `/api/metar-taf`,
  `/api/sports/*`, `/api/travel-time`, and `/api/screen-config` were all
  missing from `publicRoutes`, the same root cause as the earlier hub/kids
  fix: display.html is never authenticated, so any of these 401 silently
  on a device with a PIN set. Sports and Travel Time widgets, and screen-
  resolution detection, were likely broken the same way, just not yet
  reported. None of the four return anything sensitive — LAN addresses/
  resolution, or plain proxied responses from free external APIs with no
  credentials in the response body.

## 1.77.28
- **Layout tab: "Live Preview" renamed to "Live Edit," and it now
  actually is one** — "Open to Edit in New Tab" (was "Open in New Tab")
  opens the accurately-rendered layout with real Live Editing available
  (tap the screen, then the pencil icon), instead of a pure look-only
  preview. The small embedded thumbnail panel stays glance-only/non-
  interactive on purpose — genuinely too small to usefully drag a widget
  in — so real editing lives specifically behind the New Tab link, the
  bigger and more practical canvas.
  - New `?allowEdit=1` URL flag, deliberately independent of `?preview=1`
    itself: the Layout tab's preview needed real editing enabled without
    disturbing anything else `?preview=1` correctly still does — resolution
    override (previewing at a chosen resolution rather than the browser's
    real viewport) and avoiding screen-identity registration (a phone
    glancing at a layout shouldn't register itself as a new physical
    screen). A blanket removal of `?preview=1` would have broken both.
  - The Devices tab's real per-screen display URL (used for the actual
    physical screens/QR codes) was already correctly built without
    `?preview=1` at all — unaffected by any of this.

## 1.77.27
- **Instant push updates to mirrors now work with no PIN set** — a
  deliberate policy change, made at explicit request after the tradeoff
  was laid out clearly. `/api/update` (the raw code-install endpoint,
  which host-to-mirror push updates POST to directly) was previously kept
  locked even with no PIN configured, on the reasoning that code execution
  is a different risk class than a settings change. In practice this made
  it the one thing on the device stricter than everything else once no
  PIN was set, and it broke host→mirror instant push entirely whenever no
  PIN existed anywhere in the household — a mirror with no PIN (correctly
  inheriting the host's own PIN state since the sync fix a few versions
  back) refused ALL incoming pushes unconditionally, correct credentials
  or not.
  - Now follows the same "open when no PIN, gated when one exists" policy
    as the rest of the app. With no PIN set, this endpoint is reachable by
    anyone on the network — same as every other endpoint already is once
    no PIN exists, not a new category of exposure, just no longer a
    stricter special case.
  - `/api/install-server` (a separate, central-server-only bootstrapping
    endpoint, unrelated to host/mirror push) is unaffected and stays
    always-locked.

## 1.77.26
- **Removing PIN protection now requires re-entering the current PIN**,
  not just a yes/no confirm dialog. An active session alone was previously
  enough to disable PIN protection entirely — meaning a stale or hijacked
  session could silently remove it, with lasting effect long after that
  temporary access was gone. Enforced both client-side (a prompt asking
  for the current PIN before the removal request is even sent) and
  server-side in `PUT /api/settings` (a scripted request that skips the
  prompt entirely gets rejected with a clear error) — the server-side
  check is the one that actually matters for security; the client prompt
  is just the normal way of triggering it. Only gates the specific
  transition from a real PIN to none — setting a PIN for the first time,
  or changing an existing one to a different value, is unaffected.

## 1.77.25
- **Live Editing on the wall display now respects a widget's lock.** The
  `locked` flag existed only in app.html's own layout editor (properly
  blocking drag/resize there); display.html's on-screen Live Editing never
  checked it anywhere at all, so a locked widget dragged and resized
  exactly like an unlocked one directly on the wall. Fixed at both drag-
  start and the resize-handle overlay, following the exact same pattern
  already used for full-screen-background widgets right above each check
  (which get the same treatment for a different reason). Selecting a
  locked widget still works — only the drag/resize itself is blocked.

## 1.77.24
- **Fixed self-updates being blocked entirely on a device with no PIN set
  — the actual root cause of the whole "remove PIN, update fails" thread.**
  Not a deliberate policy applied to this endpoint at all: a path-matching
  bug. `ALWAYS_AUTH_ROUTES` (routes that stay PIN-gated even on an
  otherwise-open device) lists `/api/update` — the old manual arbitrary-
  zip-upload fallback, where requiring a PIN genuinely makes sense, since
  it accepts an uploaded file from anyone on the network. But the matching
  logic used `startsWith`, and `/api/update-from-server` (fetches a
  specific, already-validated release from the trusted central server —
  no upload involved at all, a completely different risk profile) starts
  with that same literal string, so it silently inherited a restriction
  never meant for it. Switched `ALWAYS_AUTH_ROUTES` matching to exact
  path equality instead of prefix matching — both listed routes are
  precise, non-parameterized paths that never needed prefix matching in
  the first place. `publicRoutes` elsewhere is untouched and still uses
  prefix matching deliberately, for legitimate parameterized sub-paths.

## 1.77.23
- No code changes — version bump only, so there's a real target to test
  the 1.77.22 race-condition fix against (specifically: does "remove PIN,
  then update" still fail now that the fixed banner code is what's
  actually running during the attempt, rather than 1.77.21's pre-fix
  version).

## 1.77.22
- **Fixed the tap-to-update banner falsely reporting "Update failed" on a
  genuinely successful update.** Root cause, found live via `curl`ing the
  endpoint directly: the server exits to restart moments after sending its
  success response (applying the update), which can cut the connection
  before the browser's `fetch()` finishes receiving it — a network-level
  error even though the update had already started fine server-side. Any
  thrown error there was being treated as an outright failure. Now falls
  through to the same polling path as a clean success instead — a REAL
  failure (no update available, a download error) returns a proper JSON
  response and never reaches that code path at all, so this doesn't risk
  masking an actual problem, just stops a race-condition false negative.
- **The banner and server logs now show the real failure reason** when an
  update genuinely does fail, instead of always the same generic "tap
  Settings for details" text that had no details anywhere to find —
  journalctl never logged this route's failures at all (it only ever
  returned the error directly to the client), so there was previously no
  way to diagnose a real failure without exactly this kind of manual curl
  investigation.

## 1.77.21
- **The actual, complete fix for a mirror's PIN going stale** — 1.77.20
  handled "removed and stays removed," but a remove-then-re-add (or any
  change to a genuinely different value) still hit the same
  chicken-and-egg wall: a mirror's own stored PIN is also its credential
  to authenticate the very sync request that would tell it about a new
  one, so the instant the PIN actually changes, a mirror one step behind
  was permanently locked out of ever catching up.
  - The host now remembers the PIN's value from just before its last
    change (`app_pin_previous`, set/changed/removed — recorded in
    `PUT /api/settings`) and accepts either the current or that previous
    value as valid for sync authentication. One generation of grace, not
    indefinite: a mirror authenticates with its stale value exactly once,
    pulls the new one down via the normal sync that just unblocked, and is
    caught up from then on.
  - Every client-side sync request now always explicitly sends
    `x-host-pin` — even empty — instead of omitting the header when its
    own stored PIN happens to be blank. This mattered for doing the grace
    check safely: without it, "header omitted entirely" (from literally
    any caller) would have been indistinguishable from "deliberately
    presenting an empty PIN," which could've let any request that simply
    left the header off match a household that's never once changed its
    PIN (leaving `app_pin_previous` unset).
  - `app_pin_previous` is local-only — meaningful only to this specific
    host's own recent PIN history, never synced to a slave.

## 1.77.20
- **A mirror's PIN now follows the host's automatically** — set, or
  removed. Previously `app_pin` was deliberately local-only, a known,
  documented tradeoff from v1.76.0 accepted at the time; removed from
  `LOCAL_ONLY_SETTINGS` now that it's causing real friction in practice
  (a mirror kept enforcing a PIN after the host owner intentionally
  removed it, effectively locking out access that was meant to be open).
  Also exempted `app_pin` specifically from the "don't let an empty
  synced value clobber a non-empty one" guard that protects things like
  API keys from accidental wipe — for app_pin, going from set to empty
  IS the legitimate, intended action of removing the PIN, not accidental
  data loss, and that guard would otherwise have silently blocked exactly
  the case this fix is for.
  - **Known remaining limit, inherent not fixable by this change**:
    changing an EXISTING PIN to a genuinely different one still can't
    propagate automatically. The old PIN is the mirror's own credential to
    authenticate the very sync request that would tell it the new one — a
    chicken-and-egg limit built into using the PIN itself as the sync
    credential. Still requires the manual fix (re-entering the new PIN
    directly on the mirror). Removing a PIN entirely, or setting one for
    the first time, both work automatically now, since an unset host PIN
    means sync itself is unauthenticated/open.

## 1.77.19
- **Pull-to-refresh is now an opt-in preference, off by default** —
  Settings → App Preferences → "Pull down to refresh," same pattern as the
  tab-autohide toggle.
- **Fixed pull-to-refresh not firing at all on Layout or (almost anywhere
  on) Devices**, an over-correction from 1.77.18: that fix blocked the
  entire Layout tab and every swipe-card (used heavily on Devices), when
  the actual conflict was much narrower. Found the real, broader source —
  `.editor-widget` (any widget in the layout canvas, not just an
  already-selected one via `.ft-selected`) — and swipe-cards were never
  actually the problem to begin with: they track horizontal movement, a
  different axis from this listener's vertical dy, so excluding them just
  silently broke pull-to-refresh almost everywhere on Devices for no
  reason. Now only bails on the widget/resize-handle elements that
  genuinely conflict.
- **Refresh now returns to whichever tab it was triggered from**, instead
  of always landing back on Calendar. One-time: the tab is remembered right
  before the reload and cleared as soon as it's restored, not a standing
  "always open to this tab" preference.

## 1.77.18
- **Fixed pull-to-refresh (1.77.17) triggering while dragging a widget
  down in the Layout editor.** Widget dragging uses `pointerdown`/
  `pointermove` with its own `stopPropagation()` — but pointer events and
  touch events are separate, parallel event streams; stopping one doesn't
  stop the other, so pull-to-refresh's own touch listeners still saw every
  drag as a pull attempt regardless. Now explicitly stays out of the way
  on the Layout tab and on any known-draggable element (widget drag
  handles, resize handles, swipe cards) rather than relying on another
  handler's stopPropagation to suppress it.

## 1.77.17
- **Pull-to-refresh for standalone/home-screen mode.** iOS Safari's native
  pull-to-refresh doesn't exist once the app is added to the home screen
  and run full-screen — that gesture lives in the browser chrome, which
  standalone display mode strips out entirely, leaving no way to force a
  refresh short of fully closing and reopening the app. Rebuilt manually
  against `#content`: pulling down while already at the very top, past a
  threshold, triggers a real reload. Only tracks a pull that starts at
  `scrollTop` 0, so it never fights a normal scroll gesture partway down
  the page.
- **Fixed the server-update banner getting stuck on "restarting…"
  indefinitely.** A fourth spot using unauthenticated `fetch('/api/version')`
  instead of `apiFetch()` — missed in the 1.77.6 sweep since this whole
  install-from-banner flow is a separate, later-added function that sweep
  never looked at. It always 401'd, so the success check never fired;
  polling silently ran for the full 60s before falling back to a "tap to
  check Settings" message instead of ever actually reloading on its own,
  reading as fully stuck.

## 1.77.16
- **The actual fix for the auto-hide header bounce** — 1.77.15's scrollTop
  clamping addressed a different (also real, still worth having) bounce
  than the one actually happening here. Hiding/showing the header resizes
  the sibling content area as it animates (that's what lets tabs reclaim
  the space rather than just fading in place), and that resize can itself
  nudge scrollTop mid-transition — firing a new scroll event that
  re-triggers the listener and flips the header right back. A feedback
  loop between the header's own CSS transition and the scroll listener,
  not genuine new scroll intent, and it would show up most at the bottom
  of a page since that's where the resize most directly affects the
  scrollable range. Scroll events are now ignored for the transition's
  duration whenever the listener itself causes a toggle, breaking the loop
  at its source.

## 1.77.15
- **Fixed the auto-hide tab bar (opt-in preference from 1.77.8) bouncing
  show/hide at the bottom of a scrolled page.** iOS's elastic overscroll
  briefly reports a `scrollTop` beyond the real scrollable range as it
  rubber-bands back into place at the top/bottom edge — without clamping,
  that bounce read as genuine scroll movement and flipped the header's
  hidden/visible state rapidly back and forth, a visible flicker rather
  than an actual change in scroll direction. `scrollTop` is now clamped to
  the valid `[0, scrollHeight - clientHeight]` range before being used.

## 1.77.14
- **Fixed Layout tab's subtabs overflowing horizontally**, causing
  left/right scroll to interfere with normal up/down page scroll — same
  root pattern as an earlier fix on the marketing site's footer links (a
  horizontally-overflowing row fighting with vertical scroll gestures).
  `.subtab-btn` had `margin-right: 18px` stacked on top of the container's
  own `gap: 4px` (~22px effective spacing per button — the "extra space"),
  and the container never had `flex-wrap` set at all, so 4 subtabs
  (Editor/Profiles/Templates/Saved Layouts) had nowhere to go but overflow
  on narrower screens. Removed the redundant margin (spacing now comes
  from a single `column-gap: 14px`) and added wrapping, so subtabs that
  don't fit on one line wrap to a second instead of scrolling sideways.
  Also benefits Calendar's Events/Feeds subtabs, which share the same
  styling — harmless there since two short labels were never at risk of
  overflowing, just more consistent now.

## 1.77.13
- **Calendar widget: the "stripe" multi-day style now actually shows what
  the event is.** Previously it was just a colored left-edge border on the
  cell, with the event's title never appearing anywhere — not even on its
  start day. Added a small title label, printed once on the event's actual
  start day only (the same pattern the "line" style already uses), colored
  to match its stripe. If multiple multi-day events overlap on the same
  day, only the first's title shows — consistent with the stripe itself
  already only showing the first event's color in that case.

## 1.77.12
- **The actual, ongoing root cause of a mirror sharing its host's device id
  — found live, mid-investigation.** `screen_device_id_cache` was missing
  from `LOCAL_ONLY_SETTINGS`, meaning it was treated as a SHARED setting
  and synced host -> mirror on every regular sync cycle (every 5 minutes
  by default). Manually clearing/regenerating a mirror's id (the fix
  suggested for what looked like a one-time historical collision) worked
  for exactly one sync interval, then got silently overwritten right back
  to the host's id on the very next sync — making the collision look like
  it kept "swapping" or reappearing on its own. This wasn't a one-time
  incident at all: it would happen to any mirror, every time, forever,
  regardless of how it originally got a colliding id. `screen_device_id_cache`
  now stays local to each device the way it always should have — a
  mirror's identity to the central server isn't something that should ever
  come from its host.
  - 1.77.11's `/etc/machine-id` self-healing check (still worth having)
    only ever addressed how a collision could FIRST happen; it did nothing
    to stop this sync from re-creating one every few minutes afterward.
    This fix is the one that actually stops the recurrence.

## 1.77.11
- **Detects and self-heals a device id copied from a different physical
  machine.** Discovered live: two physically different Pis ended up
  presenting the identical `screen_device_id_cache` to the central server,
  because one had been bootstrapped (pre-website, pre-setup-wizard) by
  copying the whole project folder — `calendar.db` included — from the
  other, rather than a fresh install. The central server literally
  couldn't tell them apart: every check-in from either device silently
  overwrote the same single shared activation record, flipping its role
  back and forth depending on whichever device happened to check in most
  recently.
  - New check on every boot, using `/etc/machine-id` — a Debian/Raspberry
    Pi OS-level identifier generated fresh by the OS itself on that
    machine's first boot, entirely separate from anything in this app's
    own files, so it can't get carried along by copying `calendar.db` (or
    the whole project folder) the way `screen_device_id_cache` itself can.
    If the stored machine-id doesn't match the current one, the device id
    is regenerated automatically.
  - Runs at the app level (not install-time-only), so it self-heals on any
    future boot too — not dependent on `install.sh` being able to tell "a
    legitimate re-run on the same Pi" apart from "files copied from a
    different Pi," which it genuinely can't.
  - Safe, non-disruptive rollout: neither currently-known affected device
    has a stored machine-id yet, so both simply adopt their own current
    one as a fresh baseline on next restart — no existing device id
    changes because of this update itself.

## 1.77.10
- **Fixed /hub and /kids showing no data at all** on any device with a PIN
  set. Both pages have their own separate fetch wrapper that never attached
  a session token — by design, since neither has ever had a login screen
  (kids shouldn't need the parent PIN to check off their own chores, same
  "physical access is the trust boundary" model as Live Editing on the
  wall display). That meant their backing endpoints (todo lists, shopping
  list, kids, chores) were never actually reachable — every request
  silently 401'd, with nothing shown but empty lists. Central server's
  `publicRoutes` now includes the full endpoint surface both pages
  actually use (verified directly against both files' code, not guessed).
  `/api/settings` PUT is deliberately NOT included — hub.html's few writes
  to it (smarthome entity picker, shopping-store selector) will still
  fail; that's a separate, broader-impact decision left for its own fix.
- **Smoother tab-bar auto-hide** (opt-in preference from 1.77.8): the
  reveal-on-scroll-up used to visually "pop" in abruptly rather than
  animating smoothly. Root cause: it animated `max-height` up to an
  arbitrary 200px ceiling regardless of the header's real (usually much
  shorter) height, so most of the transition was spent animating through
  empty space the content never used, and became fully visible well before
  the animation finished. Switched to a CSS Grid `1fr`/`0fr` row collapse,
  which animates to the content's actual height, whatever that is — no
  ceiling to guess, no wasted transition time.

## 1.77.9
- **A mirror rejected by the host over a bad PIN now says so, instead of
  silently retrying forever.** `registerWithHost()` — the 30s LAN heartbeat
  that keeps a mirror showing "online" in the host's Devices tab — caught
  every failure identically with a comment assuming the only cause was
  "host briefly unreachable." A wrong, blank, or stale PIN (e.g. the
  household PIN changed on the host after this mirror was set up — a
  known, previously-unresolved gap noted back in v1.76.0) fails the exact
  same way on every single retry forever, but was getting the exact same
  silent shrug as a transient network blip: no log line, no status update,
  nothing. Found this while investigating a real report of a mirror that
  was reachable directly by IP but showed offline everywhere else.
  - A 401 specifically now logs clearly and writes to `last_sync_status`
    (already shown in Settings → Multi-Device — this simply started
    actually using it for this failure), pointing directly at Settings →
    Security → App PIN as the fix. Any other failure (genuinely transient)
    stays silent, exactly as before.

## 1.77.8
- **Tab bar auto-hide is back, now as an opt-in preference** instead of the
  removed always-on behavior from 1.77.7. New "App Preferences" section in
  Settings with a single toggle, off (pinned) by default. Local-only —
  stored in this browser's `localStorage`, not synced to other devices or
  the wall display, since it's purely about how this one control-app
  instance behaves for whoever's using it. Takes effect immediately on
  toggle, no reload needed.

## 1.77.7
- **Tab bar no longer hides on scroll.** The top nav/tab area previously
  auto-hid on scroll-down and reappeared on scroll-up (a common mobile
  toolbar pattern) — worked as designed, but made the tabs themselves feel
  unreliable since they're primary navigation, not a toolbar someone would
  expect to have to scroll up to get back. Removed the scroll listener and
  its supporting CSS/reset code entirely rather than just disabling it, so
  there's no dead code left pretending to do something it no longer does.

## 1.77.6
- **The actual fix for "v?"/"unknown" on the version display**: 1.77.3
  correctly detected that `/api/version` was failing, but never asked why
  — it was failing because the fetch call itself never sent the session
  token in the first place. `apiFetch()` (used everywhere else in this
  file) attaches `x-session-token`; this one call site used a plain,
  unauthenticated `fetch()`, which 401s unconditionally regardless of
  whether the session is valid — logged in or not, incognito or not,
  fresh session or 29-days-old, made no difference. Switched to
  `apiFetch()`, matching the rest of `wireUpdate()`.
  - Found (and fixed) the same bug at two more call sites while tracing
    every place this file talks to `/api/version`, not just the one that
    got reported: the "reload when the app updates underneath you" banner
    and the "your screens are behind the host" fleet banner were BOTH
    silently non-functional this whole time for the identical reason —
    each compared against a `.version` that was always `undefined` from
    an unauthenticated 401, so neither banner could ever actually fire.

## 1.77.5
- **Now sends this device's own display name with every check-in** (e.g.
  "Kitchen", "Home"), not just its version/channel/device-id as before.
  Purely additive — older devices simply don't send it and the central
  server falls back to a shortened device-id like it always did. Paired
  with a central-server change (see piazzahq-server's own CHANGELOG) that
  actually shows this name in the admin panel, so an account's devices
  read as recognizable names instead of opaque id hashes with no way to
  tell them apart.

## 1.77.4
- **Sessions now survive a restart — including every self-update.** Root
  cause of the "v?"/"unknown" version-display investigation: login sessions
  lived in an in-memory-only `Map`, which starts empty on every process
  restart. Since a self-update always restarts the process, this meant a
  perfectly healthy update silently logged everyone out every time, on
  every device, with no indication why — it just happened to first surface
  as a confusing version display, but affected every authenticated request
  equally.
  - New `sessions` table (token, expires_at), hydrated into the existing
    in-memory `Map` on boot (pruning already-expired rows in the same
    pass) so `validToken()`'s hot path stays exactly as fast as before —
    this is additive persistence, not a rewrite of how sessions are
    checked.
  - `SESSIONS.set()`/`.delete()` now write through to the table too, at
    login, logout, and the existing hourly sweep.
  - Deliberately NOT a new secret or token format: the token was already
    HMAC-signed with `SESSION_SECRET`, which already persists to
    `.session-secret` and already survives restarts — only the *expiry*
    half of the session was ever actually being lost. This closes that
    other half rather than reworking something that already worked.

## 1.77.3
- **Settings: fixed the version display showing "v?"** — `/api/version`
  requires auth, so a stale/expired session (e.g. right after an update
  restart) returned a 401 JSON error body instead of `{version}`. The
  Settings page parsed that error body anyway, found no `.version` field,
  and silently showed "v?" instead of anything indicating an auth problem.
  Now checks `r.ok` first and falls back to the same "unknown" text a real
  network failure already showed — since neither case means the version is
  genuinely blank, they should read the same way to the person looking at
  Settings.

## 1.77.2
- No code changes — version bump only, published to the beta channel to
  verify the update pipeline (check → download → apply → healthy-boot
  confirmation) completes cleanly end-to-end after the earlier tester-flag
  investigation.

## 1.77.1
- **install.sh: piazzahq.com set as the homepage for a *regular*, non-kiosk
  browser window** — e.g. if someone opens Chromium normally on the Pi
  while troubleshooting, instead of Chromium's generic default new-tab
  page. Deliberately does NOT touch the kiosk display itself — that always
  launches with its own explicit URL on the command line (`KIOSK_CMD`),
  which takes priority over any homepage/new-tab policy regardless, so
  there's no risk of this interfering with the actual wall display.
  Implemented as a Chromium managed-policy file (`HomepageLocation` +
  `HomepageIsNewTabPage: false` + `NewTabPageLocation`) rather than editing
  Chromium's live `Preferences` JSON directly — Chromium rewrites that file
  itself, and a mid-edit conflict there can corrupt it; a policy file is
  the standard, supported mechanism for exactly this instead. Verified
  `NewTabPageLocation` is a real, correctly-behaving Chromium policy
  (confirmed against Chrome Enterprise's own current documentation) before
  shipping, not assumed from memory. Non-fatal if it can't write the policy
  directory — warns and continues, since this is cosmetic, not required
  for the app to actually work.

## 1.77.0
- **Multi-day event display, now with real alternatives** — grew out of a
  visual mockup comparison built before committing any real code, so what
  shipped is exactly what was actually chosen rather than a guess.
  - **Calendar widget — new "Multi-Day Event Style" setting** (Bar / Dot /
    Line / Stripe), in both Live Editing and the main app's own Calendar
    settings:
    - **Bar** — unchanged, the original Google-Calendar-style continuous
      spanning bar.
    - **Dot** — a multi-day event folds into the exact same colored-dot-
      plus-text row single-day events already use, on every day it
      touches — gets the existing overflow/"+N more" handling for free,
      rather than needing its own separate cap.
    - **Line** — a thin colored underline for every day the event covers,
      with the title printed only on its actual start day, not repeated on
      every segment.
    - **Stripe** — a colored left-edge border on the cell itself, like a
      day-planner tab, instead of competing for horizontal space with that
      day's other events. Overlapping multi-day events collapse to the
      first one's color — a deliberate simplification for a genuinely rare
      case (two different multi-day trips actually overlapping).
  - **New "Ongoing" strip**, opt-in on the **Agenda** and **Today**
    widgets — a compact, separate summary line for multi-day events
    already in progress or starting within the next few days ("day 3 of
    5," "starts tomorrow, 5 days"), instead of it just reading as another
    same-looking row mixed into the regular event list. Deliberately not
    added to **Upcoming** — that widget's whole model is strictly future,
    not-yet-started events, so a "what's currently ongoing" strip doesn't
    fit its purpose the way it does for Agenda/Today.

## 1.76.0
- **One shared household PIN instead of separate per-device PINs** — a real
  simplification, not just a bug fix, after this whole area turned out to
  be a lot more convoluted than it needed to be. A slave's own PIN *is*
  now the household's PIN, not a separately-tracked value:
  - Setup wizard's "main device's PIN" field (step 2, for a slave) now
    saves directly as this device's own `app_pin` — it doubles as both
    "unlock this device's own control app" and "the credential this
    device presents when syncing with the host." The now-redundant
    `host_pin` setting is gone entirely — removed from every place it was
    read, and the separate "Host PIN" field in Settings → Multi-Device is
    gone too, replaced with a one-line note pointing at the existing App
    PIN field in Security.
  - Fixed a real collision this created: step 3 (optional basics) has its
    own PIN field, shown for both roles — for a slave, that field is now
    hidden entirely (its value would never have been used correctly
    anyway once step 2's host-PIN field already decided the device's PIN;
    showing it was actively confusing, not just unused).
  - **This also fully solves "the host can't push updates to slaves"** —
    a real, separate bug found this session (`pushUpdateToSlaves()`/
    `postZip()` sent zero authentication, and a slave's `/api/update` is
    deliberately the most locked-down route in the app). No new "host
    needs to track every slave's individual PIN" feature was needed at
    all: since every device now shares the same PIN by construction, the
    host can just send its own PIN when pushing to any slave, and
    `/api/update`'s strict check now accepts that credential — still
    gated on knowing the actual secret, the same as a real login, just a
    transport suited for an unattended push rather than an interactive
    session.
  - Net result: one PIN to think about per household, not a web of
    separate host/slave PIN fields — and the push-to-slave gap closes as
    a consequence of the simplification, not as separate new work.

## 1.75.1
- **Fixed a foundational bug in `requireAuth`: every path-based exemption
  has actually never worked on any device with a PIN set** —
  `publicRoutes` (the always-public wall-display endpoints — settings,
  events, weather, photos, etc.), `ALWAYS_AUTH_ROUTES`, and the
  voice/Alexa exemptions. `requireAuth` is only ever reached via
  `app.use('/api', ...)`, and Express strips the `/api` mount prefix from
  `req.path` for the entire duration that middleware executes — so every
  comparison against a full `/api/...` path was silently comparing against
  the wrong string the whole time (`/settings`, never `/api/settings`).
  This stayed completely invisible because every affected check exists
  specifically to grant access *without* a session token — the phone app
  always sends one once logged in, so its own requests never depended on
  any of this working. Only token-less callers ever exercised this code:
  the always-public wall display, and unauthenticated automation
  (Shortcuts, Alexa). Found via a real, reported symptom — a brand-new
  mirror device's wall display stuck on its "let's get set up" splash
  screen even after setup genuinely completed, traced down to `curl
  localhost:3000/api/settings` returning a flat `Unauthorized` on a
  PIN-protected device, which should never happen for that specific
  endpoint.
  - Fixed with a one-line reconstruction (`req.baseUrl + req.path`) at the
    top of `requireAuth`, used for every comparison in the function from
    there down — Express's own documented mechanism for recovering the
    true original path from inside mounted middleware, not a workaround.
  - Syntax-checked, and grounded in standard, stable Express 4.x
    semantics — but not live-tested against a real HTTP server in this
    sandbox (no network access here to install Express and run one).
    Real confirmation happens on the Pi.

## 1.75.0
- **Mirror/slave devices can now sync with a host that has a PIN set** —
  previously they couldn't at all: `HTTP 401` on every sync attempt, no
  workaround. The host-communication code (`proxyJSONToHost()`, the shared
  `fetchJSON`/`fetchJSONPost` helpers, and the raw multipart-forwarding
  branch used for photo sync) sent no authentication whatsoever — this
  predates the host ever having a PIN, and simply never got updated once
  PINs existed. A PIN correctly protects *browser* access, but it was also
  silently blocking legitimate device-to-device sync between a person's
  own two devices, with no way through.
  - New **Host PIN** field — in the setup wizard's host-address step (for
    a brand-new mirror) and in Settings → Multi-Device (for an existing
    one). Only relevant if the host actually has a PIN; left blank
    otherwise.
  - Stored as a new `host_pin` local-only setting (this device's own copy
    of the *host's* PIN, never synced — syncing it would leak one device's
    credential into the very payload meant to stay device-local).
  - Sent as a dedicated `x-host-pin` header on every host-communication
    request — a raw PIN, not a session token, since there's no human
    present during an unattended periodic sync to do an interactive PIN
    screen login. The host's `requireAuth` now accepts this header as a
    valid credential, checked with plain equality, matching how
    `/api/auth/login` itself already compares the PIN elsewhere in this
    file — not a new, separate security posture for this value.
  - Fixed at the shared-helper level (`_httpGet`/`fetchJSONPost`/
    `proxyJSONToHost`) plus the one place that builds its own headers
    separately (`proxyWriteToHost`'s multipart-forwarding branch, used for
    photo sync) — covers every host-communication path in the file, not
    just the one a person happens to hit first.

## 1.74.5
- **Removed the temporary diagnostic panel** added in v1.74.2 while
  chasing the session-expiry bug found and fixed in v1.74.4 — the actual
  root cause (a silently-clamped 30-day `setTimeout` overflowing Node's
  32-bit limit) is confirmed fixed and verified against a real device
  through several rounds of testing since. The 401-logging code in
  `apiFetch()`, the debug readout on the PIN screen, and its HTML
  container are all removed — this was always meant to be temporary, and
  it did its job.

## 1.74.4
- **The actual root cause, finally found and fixed**: every session token
  has been expiring roughly **1 millisecond** after being issued, not the
  intended 30 days, since the token/session system was first built earlier
  this session. `SESSIONS`' expiry used `setTimeout(fn, 30 * 24 * 60 * 60 *
  1000)` — 2,592,000,000ms — which exceeds Node's 32-bit signed integer
  limit for `setTimeout` delays (~24.8 days max). Node doesn't error on
  this; it silently clamps the delay to 1ms instead. Confirmed directly
  from this app's own production logs (`journalctl` showing a live
  `TimeoutOverflowWarning`, matching this exact math precisely — 2.592
  billion is exactly 30 days in ms), then reproduced the exact warning
  on demand in isolation to prove the mechanism before shipping the fix,
  not just inferring it from the math. This explains, fully and precisely,
  a days-long "flashes the app, then back to PIN screen" report that
  survived several earlier real fixes (a genuine regression in the first
  PIN fix, a rate-limit message bug, a tour/z-index overlay bug) because
  none of those were actually the root cause — they were all real, legitimate,
  separate bugs, just not *this* one.
  - `SESSIONS` changed from a `Set` (token only) to a `Map` (token →
    expiry timestamp) — expiry is now checked directly in `validToken()`
    against `Date.now()`, with an hourly sweep to actually reclaim expired
    entries, rather than relying on an individual `setTimeout` per session
    (the correct pattern for any expiry duration longer than ~24 days in
    Node — a smaller number that happens to fit under the 32-bit limit
    would have worked too, but doesn't fix the underlying pattern for
    future changes to the TTL).
  - Everywhere `SESSIONS` gets read or written (login, logout, validation)
    updated to match the new Map-based shape.

## 1.74.3
- **Real, confirmed fix for the still-open "flashes the app, then back to
  PIN screen" report** — found via a genuinely useful clue (what was
  visible was the onboarding checklist/tour, not a blank or broken
  screen): the tour overlay's elements (`#tour-blocker`/`#tour-spotlight`/
  `#tour-callout`) live *outside* `.app`, so `showPinScreen()`'s own
  hide-the-app step never touched them — and `#tour-blocker`'s z-index
  (997) is higher than the PIN screen's (500) was. If the tour is active
  or re-triggers at the same moment auth is required, it renders on top of
  the PIN screen — which looks exactly like "the PIN screen flashed away,"
  even though it may never have actually closed underneath.
  - `showPinScreen()` now force-closes the tour overlay explicitly, every
    time, regardless of what triggered either one or in what order.
  - The PIN screen's z-index raised to `99999` — genuinely higher than
    every other element in this file (checked directly rather than
    guessing a number that might still lose to something), including the
    setup wizard and an info popup modal that were also sitting at 9999.
    Defense-in-depth: auth-gating should always win visually against any
    other overlay, not just the one specific case found this time.
  - The v1.74.2 diagnostic logging (last 8 401s, shown directly on the PIN
    screen) is left in for now, still harmless and still useful if
    anything else surfaces — not removed yet.

## 1.74.2
- **Temporary diagnostic build** — the previous fixes (v1.74.0/1.74.1)
  didn't fully resolve a still-open report of the same symptom (flashes
  the app briefly after a correct PIN, then reverts to the PIN screen),
  and it's no longer reproducing under the theories already checked and
  ruled out (server restart during the sequence — confirmed absent via
  `journalctl`; a periodic re-check timer — none exists in this file).
  Rather than keep guessing blind, this version logs the last 8 401
  responses `apiFetch()` sees (path, whether a token was attached, the
  auth-generation numbers at send-time vs. current) to `localStorage`, and
  displays that log directly on the PIN screen itself — readable on a
  phone with no dev tools available, which is what's actually accessible
  right now. Purely additive, doesn't change any real behavior. Safe to
  remove once the actual cause is found from what this surfaces.

## 1.74.1
- **Fixed a real regression in v1.74.0's own PIN fix, and a separate, real
  bug that together produced a genuine hard lockout** — a device already
  running 1.74.0 still ended up fully stuck on the PIN screen with "no
  option to get out," requiring a direct database edit to recover. Two
  distinct issues, found by re-tracing the actual flow rather than
  assuming the earlier fix was already complete:
  1. **Regression in the 1.74.0 fix itself**: guarding against a 401 being
     misread as "never set up" was implemented as an early `return` out of
     `init()` entirely — which also skipped `checkAuth()` and everything
     after it (loading events, the host-conflict check, the tour, the
     fleet-update poll) on *every* normal page load for a PIN-protected
     device, not just the one moment it was meant to guard against, since
     the settings fetch that triggers this is the very first network call
     `init()` makes and will always 401 before a fresh browser has logged
     in. Narrowed to only gate the wizard-trigger condition, not the whole
     function — `checkAuth()` now always runs normally.
  2. **A real, separate, more serious bug**: the PIN-login screen always
     showed a hardcoded "Incorrect PIN — try again," even when the actual
     server response was a 429 rate-limit ("Too many attempts, try again
     in N minutes" — 5 attempts/10min, added earlier this session). Someone
     genuinely rate-limited (easy to hit by accident from the original
     kick-out-loop bug forcing repeated re-entries) would see "Incorrect
     PIN" on their *correct* PIN, with no indication they just needed to
     wait rather than keep retrying — this is very likely the actual
     mechanism behind a reported hard lockout on an already-1.74.0 device.
     Confirmed the rate limiter itself doesn't compound (retrying during a
     lockout doesn't extend it further, it stays fixed at 15 minutes from
     the first trigger) — the real message now surfaces correctly instead
     of being silently discarded, which is the complete fix needed here.

## 1.74.0
- **Fixed a serious, three-part bug: setting a PIN for the first time could
  kick you out repeatedly and eventually show the first-run setup wizard**,
  even on a fully set-up device. Traced fully rather than patched at the
  symptom — three real, separate bugs, all part of the same story:
  1. Setting a new PIN in Settings writes it to the server via one request,
     then immediately makes a *second* request (saving the rest of the
     settings form) — but that second request was still sent with no
     session token, since typing a PIN into a field was never the same
     thing as logging in with it. The PIN takes effect on the server
     immediately, so that second request got rejected with 401 — kicking
     the person out of the app moments after they'd just saved. Fixed by
     establishing a real session (logging in with the PIN that was just
     set) immediately after setting it, before anything else can fail.
  2. Even after a successful login, *other* requests already in flight
     from before that login (carrying the old, invalid, or entirely
     absent token) could land afterward and each independently trigger
     another kick-back-to-PIN-screen — explaining the repeating loop. New
     `authGeneration` counter: `apiFetch()` snapshots it per-request and
     only acts on a 401 if no newer login has happened since that specific
     request was sent, so a stale straggler can't undo a fresh session.
  3. The actual "asks to set up a new device" part: `apiFetch()` returning
     an indistinguishable `{}` for both "a 401 happened" and "this
     genuinely has no settings" meant `init()`'s first-run check
     (`!s0.setup_complete`) couldn't tell the difference — a 401 during
     that one specific fetch incorrectly looked identical to "this device
     was never set up," launching the wizard on a fully configured device.
     Fixed with a distinct `__authFailed` marker `init()` now checks for
     and bails out on, rather than evaluating `setup_complete` on data
     that was never actually retrieved.
- **Also fixed while touching the same code**: logging back in via the PIN
  screen only ever refreshed the Calendar tab's events (`loadEvents()`),
  regardless of which tab was actually showing when the PIN screen
  interrupted it — now re-renders whichever tab is actually active.
- **Added a confirm-PIN field everywhere a PIN gets set** — Settings and
  the setup wizard both now require typing the PIN twice, catching a
  fat-fingered PIN before it's saved rather than after. Requested
  regardless of the above — the actual root cause turned out to be the
  three bugs above, not a mistyped PIN, but confirmation was a real,
  independent gap worth closing either way.

## 1.73.0
- **Tasks and Tasks Combined (Todoist) widgets now have real settings in
  Live Editing** — previously the only two widget types missing from
  `WIDGET_ADVANCED_TYPES` entirely, so tapping into their settings on the
  display just showed the generic "more settings available in the app"
  fallback instead of anything real. Ported field-for-field from
  `app.html`'s own settings panels for these types, same convention
  already used for Calendar/Weather/To-Do/etc.:
  - **Tasks**: Project picker, Text Size (a percentage scale — resizes
    both the list name and task rows together).
  - **Tasks Combined**: Projects to Include (multi-select), Vertical
    Alignment, Font Size, Show Due Date.
  - Both project pickers share one new `fetchTodoistProjectsD()` (cached
    once, same convention as `cachedFeeds`/`cachedDisplays` elsewhere in
    this file) — no duplicate fetch if you open one, close it, then open
    the other.

## 1.72.0
- **Fixed a real, systemic widget-scaling bug**: the Tasks widget's text
  size came from `--tk-scale`, set purely from the widget's own font-size
  setting with `--ui-scale` never multiplied in — unlike every other
  widget in this file, which all bake `--ui-scale` into their font-size at
  the source. Meant Tasks text stayed full-size regardless of actual
  screen resolution or the phone app's Live Preview (a scaled-down
  simulation), while everything around it correctly shrank — Tasks would
  look oversized relative to the rest of the layout outside the reference
  resolution. Fixed at the source (`--tk-scale` itself now includes
  `--ui-scale`), so every CSS rule using it is correct without touching
  each one individually. Tasks' and Tasks Combined's round checkboxes,
  hardcoded at a fixed 14×14px with no scaling at all, fixed the same way.
- **Live Editing's toolbar changed from a full-bleed top bar to a floating
  pill** (margin + rounded corners), so it reads clearly as temporary
  editing chrome sitting on top of the canvas, not something that's part
  of the actual layout. The old full-width treatment made it easy to
  mistake "this widget is temporarily covered by the toolbar" for "this
  widget's actual position changed" — visually identical problems with
  very different causes. Doesn't reposition any widget — a real "never
  cover anything" fix would need either live device testing to verify
  safely, or a more invasive change to how the canvas maps widget
  percentages to pixels; this is the safe, verifiable-without-a-device
  improvement instead of a riskier guess at that larger fix.
- **Tasks and Tasks Combined widgets can now complete a task by tapping
  it** — genuinely completes it on Todoist itself (`POST
  /api/v1/tasks/{id}/close`, same personal API token already used for
  reading), not just a display-only hide. No "reopen" — once closed,
  Todoist's own active-tasks list won't return it, so there's nothing
  local to toggle back even if wanted. Optimistic fade-and-collapse
  animation on the tapped item for instant feedback, followed by a full
  refetch so every Tasks/Tasks Combined widget (including ones showing an
  overlapping project) reconciles against Todoist's real current state
  rather than each widget's cache being hand-patched separately.
  - Also fixed, found while touching this code: task content from Todoist
    was being inserted into the page without HTML-escaping — harmless in
    practice unless a task's own text happened to contain HTML-like
    characters, but a real gap next to everywhere else in this file that
    correctly escapes third-party/user-entered text.

## 1.71.0
- **QR code for the "Remote access" (Tailscale) address too**, on the "Let's
  get set up" splash screen — previously only the primary LAN address had
  one. Smaller than the primary QR (110px vs 160px), matching that URL's
  own secondary visual weight. Same `.qr-container`/`renderQRCodes()`
  mechanism as everything else, so no separate rendering path was needed.
- **Setup wizard now clears stale `device_role`/host-address state from a
  previous incomplete attempt**, before showing the wizard at all — not
  just when finishing. A failed or abandoned setup attempt could leave
  `device_role` (and `host_lan_address`/`host_ts_address`/`host_port`, for
  an attempted Mirror setup) behind in the database even though setup
  itself never completed. A fresh retry's very first settings write would
  then see that stale `device_role` already present and get routed through
  `slaveWriteGuard`'s host-proxy logic based on leftover state from an
  attempt that never finished — confirmed as a real contributor to an
  earlier "wizard keeps failing" report, even though the actual root cause
  of *that* specific report turned out to be the Finish-button bug fixed
  in v1.70.0. This closes the related-but-separate gap: every fresh wizard
  attempt now starts from genuinely clean state, regardless of what a
  prior abandoned attempt left behind.
- **Fixed a real, systemic Live Editing bug**: any widget's "More Settings"
  panel could silently stop saving further changes if a layout sync
  happened while the panel was still open — which happens on every save,
  since a save's own success broadcasts back to the same display that made
  it. The widget object the open panel was editing would get silently
  swapped out from under it by that refresh; any edit made after that
  point mutated a disconnected copy that never reached an actual save.
  Found via a reported "calendar filter changes don't save" bug — not
  calendar-specific, this affected every widget type's settings panel the
  same way, toggling several checkboxes in a row (exactly what a calendar
  filter list invites) just made it easy to trigger. Fixed at the root:
  `fetchLayout()` now reconciles incoming layout data into the *existing*
  widget objects in place, instead of replacing the whole array with fresh
  copies — preserves object identity across any number of syncs, so an
  open settings panel never loses track of what it's actually editing.

## 1.70.0
- **QR code on the "Let's get set up" splash screen** — scan instead of
  typing the address on a fresh install. Reuses the existing `qrcodejs`
  library and `.qr-container` convention already used by the corner info
  overlay and the QR Code widget, so it's picked up by the same
  `renderQRCodes()` pass rather than needing its own rendering path. White
  card behind it, since the splash's dark gradient background would
  otherwise make it barely scannable. Only shows once a real address is
  actually detected.
- **Real, UI-based resolution when a second host tries to register with an
  email that's already in use** — previously just a bare "Registration
  failed" message. Now: the central server detects the conflict at
  registration time (not just later via a periodic check-in) and the setup
  wizard shows an actual choice card — "🖥️ Set up as a Mirror instead"
  (switches role and jumps straight to the host-address step, no need to
  go back through the role picker) or "✉️ Use a different email instead."
  Requires the companion `piazzahq-server` v1.23.0 update to actually
  detect the conflict — an older central server just falls through to the
  original silent-reuse behavior, so this device-side change alone is
  harmless without it, just inert.
  - New: this device sends its own stable device ID with every trial
    registration attempt, so the central server can tell "a genuinely
    different device already claims this email's host slot" apart from
    "this is the same device re-running setup" (e.g. after a factory
    reset) — without it, every duplicate-email attempt would look
    identical from the server's side.
- **Fixed a real bug in the setup wizard's Finish button**: it saved
  settings via a bare `try { } catch {}` — any failure (a network hiccup,
  the host being briefly unreachable) was silently swallowed, and the
  wizard reloaded the page unconditionally right after regardless of
  whether the save actually worked. A failed save meant landing back on a
  wizard that still thinks setup isn't done, with everything just typed
  gone — which is exactly what "the wizard keeps crashing and resetting"
  looks like from the outside, even though nothing technically crashed.
  Now verifies the server's response actually reflects `setup_complete`
  before reloading; shows a real, always-visible error and preserves
  everything typed if it doesn't. New `#wiz-finish-status` element
  specifically because `finish()` can be called from step 3 (a slave/
  Mirror setup, or a host who skipped everything skippable) as well as
  step 6, and step 3 had no status element of its own — an earlier version
  of this same fix targeted the wrong (hidden) status element before this
  was caught.

## 1.69.0
- **"Add a Display" — a real, discoverable way to add non-Pi screens.**
  This mechanism always existed (every profile has always had a shareable
  URL), but was buried in the Layout tab's Profiles list, and the Devices
  tab's own empty state actively said *"Open the display on a Pi"* —
  misleading, since any browser works identically. New persistent card in
  the Devices tab: pick a layout, get a QR code (scan on the new device)
  and a copyable URL. Fixed the misleading empty-state copy too.
  - **Tailscale-aware.** New `GET /api/tailscale-status` (server-side,
    detects via the `tailscale` CLI — same pattern as the HA-discovery
    Tailscale-peer lookup from earlier this session, but this time the
    machine's own IP, not peers') tells the UI whether Tailscale is
    actually running here, not assumed. If detected, the generated URL
    uses the Pi's Tailscale IP specifically — works from any device on the
    same tailnet regardless of which Wi-Fi network it's actually on, which
    matters for something like a tablet or Fire Stick that might move
    between rooms. If not detected, a clear amber warning explains the
    link will only work on the same Wi-Fi, and links to
    tailscale.com/download for both ends.
  - QR generation reuses the existing `QRCode` library already loaded for
    the QR Code widget and the Family Hub install prompt — no new
    dependency.

## 1.68.0
- **Shopping Mode**, on the Family Hub — a full-screen, one-item-at-a-time
  walkthrough for actually shopping, versus the normal checklist view being
  better for building the list at home. New "🛍️ Shopping Mode" button in
  the Shopping toolbar.
  - **Back** and **Skip** are pure local navigation — neither touches the
    server at all, just moves a cursor through a stable snapshot of
    not-yet-done items taken when Shopping Mode opens. Deliberately a
    snapshot with an index (not a shift/splice queue) specifically so
    **Back** always has something to go back to — a splice-based "remove as
    you go" queue would lose a skipped item's position entirely.
  - **Check Off** is the only action that calls the API
    (`PUT /api/shopping-items/:id`) — advances immediately without waiting
    on the network response, so the walkthrough doesn't stall mid-flow; a
    failed request is recovered later when Shopping Mode closes and
    `loadShoppingList()` re-fetches the true state, rather than
    interrupting the person's shopping with an error for something they can
    just re-check from the normal list afterward.
  - End-of-list screen shows how many were checked off vs. skipped (skipped
    items stay on the real list for next time, exactly as if Shopping Mode
    had never been opened) — reads as "Reached the end," not "All done,"
    since skipping means it isn't necessarily complete.
  - Large text and big touch targets throughout — this runs on a
    wall-mounted touch device, viewed and tapped differently than a phone
    held close.

## 1.67.0
- **Main app tab bar consolidated**: Chores/To-Do/Shopping (3 separate
  top-level tabs) collapsed into one **"Family Hub"** tab with subtabs —
  same idea as the Home/subtabs restructure shipped for the Family Hub app
  itself a few versions back, now applied to the main phone app too. Down
  from 8 top-level tabs to 6 (Calendar, Photos, Layout, Devices, Family
  Hub, Settings).
  - `renderChoresTab()`/`renderTodoTab()`/`renderShoppingTab()` are
    unchanged internally — they still fully replace `#content` themselves,
    same as always. The subtab bar is prepended via `insertAdjacentHTML`
    *after* whichever one runs, rather than rewriting all three to render
    into a sub-container — lower-risk than restructuring three large
    existing functions for this.
  - Each subtab's enabled/disabled behavior is unchanged (same
    `chores_enabled`/`todo_enabled`/`shopping_enabled` settings) — just
    gates the subtab button instead of a top-level one now. The whole
    Family Hub tab only shows when at least one of the three is enabled.
    Settings-save and initial-load previously had three near-identical
    blocks of this show/hide logic (one per tab); consolidated into one
    shared `updateFamilyHubVisibility()`.
- **Header (top title bar + tab row) now hides on scroll-down, reappears on
  scroll-up** — reclaims vertical space while reading content on a phone
  screen. Resets to visible on every tab switch, so it never gets stuck
  hidden on a freshly-opened tab. Uses a `max-height` collapse rather than
  a transform, specifically so `#content` actually reflows upward into the
  reclaimed space rather than just visually hiding the header while leaving
  a gap.
- **Reduced header height** — smaller title text, smaller tab padding/font
  size, tighter vertical padding throughout. More compact without dropping
  below comfortable tap-target size.

## 1.66.1
- **Fixed a real space-truncation bug in the Siri Shortcuts instructions**:
  multi-word items ("paper towels," "brown rice") were silently cut off at
  the first space, because Shortcuts inserts a variable into a URL field as
  raw unencoded text. Added a "Replace Text" step to the instructions
  (space → `%20`) before the value goes into the URL — found and confirmed
  fixed via live testing with a real device, not theoretical.
- **Extracts the actual item from natural voice phrasing**, instead of
  storing whatever was said verbatim. "Add bananas to the shopping list"
  now adds "bananas," not the whole sentence — same for "put paper towels
  on my list," "can you add coffee to the grocery list please," etc.
  Answering with just the item name (no surrounding sentence) still works
  exactly as before, since there's nothing for the pattern to strip.
  - New `extractItemFromSpokenPhrase()`, applied inside `addVoiceItem()` —
    so this fixes both Siri Shortcuts (free-text dictation, which had no
    extraction at all before this) and Alexa (whose custom slot values are
    usually already just the item, but harmless to run through the same
    pass) in one place, rather than duplicating logic per voice surface.
  - Deliberately simple pattern-matching (strip a leading command verb,
    strip a trailing "to/on (the/my/our) ___ list" shape, strip a stray
    trailing "please"), not real NLU — verified against 8 realistic
    phrasings before shipping, including an ordering bug the test itself
    caught (trailing "please" *after* "list," as in "...to the list
    please," broke the list-phrase pattern's end-of-string anchor until
    the please-strip was moved earlier). Won't catch every possible
    phrasing — unusual wording can still come through unstripped — but
    covers the common shapes without needing an actual language model for
    something this small.

## 1.66.0
- **Radically simplified the Siri Shortcuts setup** after the previous
  rewrite (v1.65.1) still proved confusing in practice — "the variable
  picker doesn't show 'Provided Input'" was the actual real-world blocker.
  Rather than iterate on instructions for the Headers/JSON-body approach
  again, changed the underlying mechanism: `/api/voice/add-item` now also
  accepts `GET` with the token and item text as plain query-string
  parameters (`?token=...&text=...&list=...`), alongside the original
  header/JSON-body `POST` (kept working for anyone who already built a
  Shortcut that way). The Shortcuts setup is now genuinely one field —
  paste one URL (with the token already filled in) into "Get Contents of
  URL," insert exactly one variable inline at the end, done. No Method
  change, no Headers panel, no JSON Request Body panel — the two most
  error-prone steps from the old flow don't exist anymore, rather than
  being explained more carefully.
  - Checked before doing this: no request-logging middleware exists on
    this server that would write a token-bearing URL to a persistent log
    file — confirmed, not assumed, before putting a credential in a URL.
  - `requireAuth`'s exemption for this route (bypasses the PIN check, same
    as before) now covers GET as well as POST.
  - Settings → Voice Control instructions rewritten to match — down to 7
    steps from 9, only one of which involves the variable picker at all.

## 1.65.1
- **Rewrote the Siri Shortcuts setup instructions** in Settings → Voice
  Control, after real mistakes surfaced actually following the old ones:
  the old text described headers and the JSON body as single combined
  lines ("Authorization = Bearer...", `{"text": "Provided Input", "list":
  "shopping"}`) — but Shortcuts' own UI uses separate Key/Value box pairs
  for each header and each body field, not one field with the whole thing
  typed in. Following the old instructions literally produced a header
  with the token in the Key box, and a body with the entire JSON string
  crammed into one Value box. Rewritten as 9 explicit numbered steps, each
  one action at a time, with Key/Value spelled out separately wherever
  Shortcuts actually has separate boxes, and an explicit note that
  "Provided Input" needs to be inserted as a real variable chip via the
  variable picker — not typed as plain text, which silently sends the
  literal words instead of what the person said. Step 8 now has the person
  test with the ▶ play button before wiring up "Add to Siri," so a broken
  setup gets caught immediately instead of discovered later via a
  confusing Siri failure.
- Removed the "Ask Claude for the walkthrough" line from the Alexa mention
  underneath — kept the neutral fact that Alexa works too and needs its
  own setup, just without pointing at an AI assistant to explain it.
- Increased padding on the Voice Token input/buttons row and the
  Generate/Regenerate/Revoke button row (12px/16-18px instead of 9px/12-16px,
  more consistent with the input's own existing padding) — felt cramped
  next to each other.

## 1.65.0
- **Family Hub tab restructure**: Chores/To-Dos/Shopping are now subtabs
  under a single top-level "Home" tab, instead of three separate top-level
  tabs. The smart-home/HA tab (previously also labeled "Home" — a naming
  collision with this change) is renamed **"Smart Home"**.
  - Each subtab's individual enabled/disabled behavior is unchanged — same
    `chores_enabled`/`todo_enabled`/`shopping_enabled` settings, same
    show/hide logic, just one level deeper (gates the subtab button instead
    of a top-level one). The Home tab itself only shows at all when at
    least one of the three is enabled — hidden entirely otherwise, same
    "don't show a door to nothing" principle the old code applied per-tab.
  - Fallback logic now has two levels: if the current *subtab* becomes
    disabled while Home is still otherwise usable, it switches subtabs
    without leaving Home; only falls back to Smart Home (or the "nothing
    enabled" message) if Home has nothing left in it at all. Same trigger
    conditions as before — the Hub's own settings toggles, or a `settings`
    SSE broadcast from elsewhere (the full app's Settings, another device).
  - New `hub_active_subtab` localStorage key remembers which of the three
    was last open, alongside the existing `hub_active_tab` (now just
    `'home'`/`'smarthome'`) — reopening the Hub returns to both the right
    top-level tab and the right subtab within it.
  - No settings schema changes — this is purely a navigation/UI
    restructure. `chores_enabled`/`todo_enabled`/`shopping_enabled`/
    `smarthome_enabled` all mean exactly what they did before.

## 1.64.0
- **Three new analog clock faces**, alongside the original (now called
  "Minimalist Line" in Settings, visually unchanged from before — anyone
  already using analog sees no difference unless they pick something else):
  - **Aviation Chronograph** — instrument-panel styling, 60-tick minute
    track with amber major ticks every 5, monospace cardinal numerals, an
    inner sub-dial ring.
  - **Warm Brass** — cream/gold radial-gradient face, spade-shaped hands
    (via CSS clip-path), Roman numerals at 12/3/6/9, a red second hand.
  - **Bold Modern** — thick rounded hands, dot markers (accent-colored at
    the quarter points), oversized accent-color second hand. The one new
    face that follows the widget's own text/accent color settings rather
    than a fixed palette, since it's meant to feel like a treatment of the
    display's theme rather than a specific physical object like the other
    two.
  - New "Face" dropdown in the clock's settings (both `app.html`'s full
    editor and `display.html`'s own on-screen quick settings — kept in
    sync, same as the Style dropdown it sits next to), only shown when
    Style is set to Analog.
  - The existing per-second hand-rotation update (`.hand-hour`/`.hand-minute`
    /`.hand-second`, updated in place via CSS custom property rather than
    re-rendering the whole face) needed no changes — all four faces share
    those same class names, so it already applies uniformly.
  - Cardinal-point numeral/Roman-numeral positions are computed at render
    time (real trigonometry against the face's own percentage-based size),
    not approximated in pure CSS — same technique used in the design
    preview this was built from.

## 1.63.0
- **Raised font size caps across most widgets** — the calendar-family and
  list widgets (upcoming, today, agenda, tasksCombined, news, minical,
  onthisday, sports, metar) roughly doubled their max font size, and most
  others (todo, shopping list, chore chart/leaderboard, countdown,
  moonphase, air quality, travel, QR code, timer, daily quote, entity
  status, smart home dashboard) got a similar-sized bump. `text`,
  `decoration`, and `clock` were already generous (fontMax 480/300/400) and
  left alone. Only `fontMax` changed — defaults, minimums, and step sizes
  are untouched, so nothing looks different for anyone who hasn't gone out
  of their way to max out a widget's font size; this just removes a ceiling
  that was hit too easily on a real TV-sized display. Not narrowed to
  specific widgets or scoped further per direction ("across the board");
  worth watching for any widget where a maxed-out font now clips or
  overflows at small widget sizes, since that wasn't explicitly tested
  against every size/font combination.

## 1.62.0
- **Alexa skill support**, same underlying `addVoiceItem()` as the Siri
  Shortcuts work — refactored that shared logic out of the Siri route so
  both surfaces call one function instead of duplicating "where does this
  item go" logic. New `POST /api/alexa`, built on the official
  `ask-sdk-core`/`ask-sdk-express-adapter` packages rather than hand-rolled
  request verification — Alexa authenticates each request with a
  cryptographic signature (an X.509 cert chain + timestamp), and getting
  that verification subtly wrong would be worse than not having it at all,
  so it uses the trusted library instead of reinventing it.
  - Requires `ALEXA_SKILL_ID` in `.env` (from the Alexa Developer Console,
    once the skill's created there) to confirm requests are actually for
    this skill specifically — signature/timestamp verification happens
    either way.
  - New dependencies (`ask-sdk-core`, `ask-sdk-express-adapter`) are
    required lazily, wrapped in try/catch — a device that hasn't run
    `npm install` since this update yet gets a clear 503 on `/api/alexa`
    instead of failing to start entirely.
  - Fixed a real gotcha found while building this: the global
    `express.json()` body parser would have consumed the Alexa request's
    raw body before the signature verifier ever saw it, breaking
    verification for every legitimate request, not just forged ones — now
    skipped specifically for `/api/alexa`, same principle as the Stripe
    webhook's own raw-body handling on the central server.
  - Alexa requires a publicly reachable HTTPS endpoint with a trusted-CA
    cert (unlike Siri Shortcuts, which only needs the phone's own network
    reachability) — this is a real infrastructure prerequisite, not just a
    code change; see HANDOFF.md for the Cloudflare Tunnel setup this
    needs on top of what's already running.
  - Google Assistant/Gemini investigated and deliberately NOT pursued:
    the old custom-voice-command system (Conversational Actions) was
    sunset in 2023 with no equivalent replacement for self-hosted use: the
    current developer path is Smart Home API only (device-control schemas,
    not arbitrary text actions). Google Assistant itself is also being
    retired in favor of Gemini starting September 2026.

## 1.61.0
- **Voice control via Siri Shortcuts** — new Settings → Voice Control section
  generates a long-lived bearer token (server-generated via
  `crypto.randomBytes`, never user-typed, unlike `ha_token` which comes from
  HA itself and is already strong) and shows step-by-step instructions for
  building an iOS Shortcut around it: "Ask for Input" → "Get Contents of
  URL" → POST to the new `/api/voice/add-item` with the token as an
  `Authorization: Bearer` header. No native app or App Store presence
  needed — this is the same mechanism Things/Todoist/etc. use for their own
  Siri support.
  - `POST /api/voice/add-item` — `{text, list}`, `list` optional (defaults
    to the shopping list, otherwise case-insensitively matched against
    existing To-Do list names). Deliberately narrow: this token can add an
    item and do literally nothing else — no read, no delete, no settings
    access — so a leaked token is a "someone added junk to your shopping
    list" problem, not a "someone has the run of the app" problem.
  - Authenticates itself via the bearer token rather than the normal PIN
    session (a Shortcut can't do an interactive PIN login) — exempted from
    `requireAuth`'s PIN check by exact route match only, then gates itself
    with a `timingSafeEqual` token comparison. Rejects everything if no
    token's been generated yet, regardless of whether a PIN is set on the
    device otherwise.
  - Regenerate/Revoke both require confirming, since either immediately
    breaks any Shortcut already built with the old token.

## 1.60.1
- **Security: `/api/update` and `/api/install-server` now require a PIN
  unconditionally**, even on a device with no PIN configured at all. Every
  other `/api` route intentionally stays open with no PIN set (a reasonable
  default for a single-household device), but these two accept an uploaded
  `.zip` and install it — code execution, not configuration — so they're
  gated regardless, via a new `ALWAYS_AUTH_ROUTES` list checked ahead of the
  normal no-PIN bypass. A PIN-less device previously left both reachable to
  anyone on the same network.
- **Security: `/api/auth/login` (PIN check) now has rate limiting** — 5
  attempts per 10 minutes, 15-minute lockout — ported from the same pattern
  `piazzahq-server`'s own admin login already used. Previously unlimited
  attempts against a short numeric PIN.
- **Cleanup**: `/api/update`'s `TODO(before public launch): remove this
  route` was stale — its paired "Advanced: install a zip manually" UI in
  `app.html` doesn't exist anymore (nothing in the app calls this route at
  all), but it's still a real, working manual fallback for when the central
  server's unreachable. Rewrote the comment to reflect that honestly and
  flag keep-vs-remove as a decision to actually make, rather than leaving a
  pre-launch TODO unresolved indefinitely. No behavior change beyond the
  auth tightening above.
- Spot-checked the ~50 bare `catch {}` blocks across `server.js`/`app.html`
  for anything silently swallowing a failure that matters — all legitimate
  (temp-file cleanup, best-effort cache reads, `LOCAL_ONLY_SETTINGS` writes).
  No changes needed.

## 1.60.0
- **Home Assistant auto-detection**: a "🔍 Detect automatically" button in
  Settings → Home Assistant, so setup doesn't require already knowing (or
  typing) the instance's address. New `GET /api/ha/discover` tries, in
  order: this machine itself (covers HA running in Docker alongside this
  server), `homeassistant.local` (most home networks resolve this via
  mDNS), a concurrency-capped sweep of this machine's own LAN /24, and —
  only if the `tailscale` CLI happens to be installed here — every peer on
  its own tailnet, since Tailscale addresses aren't in any guessable
  subnet. Confirmed via HA's unauthenticated `/manifest.json` (a stable
  public fingerprint), no token needed just to detect it. One result
  auto-fills the URL field; several show as tappable options; none found
  falls back to the existing manual entry, unchanged.
- **One-tap link straight to the token page**: once the URL field has a
  value (detected or typed), a "→ Open Home Assistant's Security page to
  create one" link appears under the token field, pointed at
  `<that-instance>/profile/security` — saves the manual profile → Security
  tab navigation, doesn't replace the written instructions underneath it.
- Detected Tailscale-range addresses (100.x) are flagged in the UI with a
  note that Home Assistant's own login page can sometimes reject
  Tailscale-only origins — found while setting this up against a real
  instance reached over Tailscale, not theoretical.

## 1.59.0
- **Home Assistant Tier 4: multi-entity dashboard**, on both surfaces that
  already had Tier 2, sharing logic between them rather than building two
  unrelated things — Tier 3 (presence-aware Ambient Mode) intentionally
  skipped for now, per direction.
  - **New `display.html` widget type, "Smart Home Dashboard"**: shows a grid
    of several HA entities in one widget, each with the exact same
    toggle/thermostat-stepper/trigger controls Tier 2's Entity Status widget
    already has — factored the actual control markup out into a shared
    `renderHaEntityControl()` so both widget types render (and now, tap-wire)
    identically instead of maintaining two copies. Entities can optionally be
    tagged with a room when picking them in `app.html`'s settings panel; the
    dashboard groups into per-room sections when at least one is set, same
    "Other" catch-all + stable first-seen room ordering used on the Hub side
    below. A new `openEntityPickerMulti()` in `app.html` (checkbox variant of
    the existing single-entity picker) handles selecting several entities at
    once.
  - **Family Hub's Home tab reworked to support Favorites and Rooms**:
    `smarthome_hub_entities` moved from a flat array of entity-id strings to
    `{id, room, favorite}` objects — a normalizer upgrades old-shape data on
    read, so existing installs don't break, and nothing is ever written back
    in the old shape again. Each card now has a ⭐ favorite toggle (pins it
    into its own Favorites section at the top, in addition to its room
    section — favoriting is a shortcut, not an exclusive category) and a ✏️
    button opening a small room-name sheet with a `<datalist>` of rooms
    already in use, to avoid accidentally creating near-duplicate room names
    ("Kitchen" vs "kitchen").
  - **Not yet live-tested against a real Home Assistant instance** — built
    and syntax-checked (all three files' script blocks pass `node --check`),
    logic reviewed against the existing Tier 2 code it extends, but this
    sandbox has no network access to actually exercise it end-to-end the way
    Tier 2's 56-check verification pass did. Needs the same real-instance
    pass before considering this genuinely done, not just written.

## 1.58.0
- **Home Assistant Tier 2: actually controlling devices, not just reading
  them.** Toggle lights/switches/fans, touch-adjust a thermostat, and fire
  scenes/scripts — from two places, per direction: `display.html`'s Entity
  Status widget (now interactive, both in Live Editing and on any
  touch-capable display in normal mode) and a brand-new "Home" tab in the
  Family Hub, the primary surface for actually using this day to day.
  - **Server**: `POST /api/ha/call-action` — the client sends only
    `{entityId, action}` (plus a temperature for thermostats); the actual
    Home Assistant service call is decided from a small, fixed, server-side
    whitelist, never from anything the client specifies directly. A bug or
    a bad request can trigger one of a few known-safe actions, never an
    arbitrary HA service. `/api/ha/state/:entityId` extended with climate
    attributes (target/current temp, min/max, step) — a genuine no-op for
    every non-climate entity. A successful action busts that entity's
    cache immediately, so the next read reflects reality within seconds
    instead of the full 10s cache window.
  - **`display.html`**: the Entity Status widget now renders a real toggle
    switch for light/switch/fan/input_boolean, a +/- stepper for climate
    (respecting HA's own actual min/max/step, not a guessed range), and a
    trigger button for scene/script — reusing the exact same
    `data-interactive="1"` tap-through pattern chore/todo/shopping widgets
    already established, so these controls don't fight Live Editing's own
    tap-to-select. Anything else still falls back to Tier 1's original
    read-only display, completely unchanged.
  - **`hub.html`** ("Family Hub"): new "Home" tab, off by default (matching
    To-Do/Shopping's own convention), full settings-toggle/visibility/SSE
    wiring matching the existing three tabs exactly. A real searchable
    entity picker (filtered to only controllable domains — a sensor here
    would be a dead end, that's what the widget is for) adds entities to a
    small persisted list (`smarthome_hub_entities`, stored as a setting —
    no new table needed). Each entity renders the same toggle/stepper/
    trigger shape as the display widget, adapted to the Hub's own
    touch-native styling, plus a remove button.
  - **A real, confirmed bug found and fixed during testing, not just
    assumed away**: `hub.html` had TWO separate places deciding which tab
    to fall back to if the remembered one is disabled — the shared
    `syncTabVisibilityAndFallback()` (used for later settings changes) and
    a completely separate one-time IIFE that only runs on the very first
    page load. Only the first one got updated to include `smarthome` in
    its fallback list initially; the init-time one was missed entirely.
    Result: opening the Hub for the first time with ONLY Home enabled
    (chores/todos/shopping all off) found nothing in its stale two-tab
    fallback list, and wiped the entire tab content area with a "nothing
    enabled" message — destroying the very tab that WAS enabled. Caught
    by an end-to-end test that actually exercised a fresh page load with
    that exact settings combination, not by reading the code and assuming
    one fix covered both places it was needed.
  - Verified end-to-end, not just written and assumed correct — 56 checks
    total: 24 against a real local mock Home Assistant server (exercising
    the actual extracted server.js code, confirming the whitelist can't be
    bypassed, bad temperatures are rejected before any network call, and
    domain-derivation for triggers can't be spoofed by the client), 16 on
    `display.html`'s interactive widget (correct control rendering per
    domain, correct action payloads, correct fallback for non-controllable
    entities), and 16 on the full Family Hub flow (add → toggle → adjust →
    remove, including the picker correctly filtering out non-controllable
    and already-added entities, and confirming removal actually persists
    the right updated list, not just optimistically looking right in the
    DOM).

## 1.57.3
- **Fixed the "Control this screen" corner overlay showing duplicate/multiple
  QR codes when the screen changes.** Root cause confirmed exactly as
  hypothesized when this was first traced: `qrcodejs`'s `QRCode` constructor
  APPENDS a freshly-drawn canvas into its target element — it never clears
  any existing content first. `renderQRCodes()` runs against every
  `.qr-container` on the page any time it's called, and `applyInfoOverlay()`
  can trigger it from several different places (boot, an SSE push, a
  reconnect, a profile reassignment) that can legitimately land close
  together around a screen change — each additional call was stacking one
  more QR code into the same container instead of replacing the last one.
  Fixed with a one-line clear (`el.innerHTML = ''`) before drawing, making
  every call fully idempotent regardless of how many times it fires.
  Verified with a real before/after test: a stub `QRCode` class faithfully
  replicating the real library's actual append-don't-clear behavior proved
  the fix produces exactly one QR code after three rapid calls (and
  correctly reflects updated content, and doesn't cross-contaminate between
  multiple containers on the same page) — then the same test was run
  against the un-fixed code and confirmed it genuinely produces 3 stacked
  duplicates, not just theoretically could.
- **New: Photo widget "Full-Screen Background" checkbox**, in both app.html's
  Editor and display.html's own Live Editing — fills the whole display and
  sits behind every other widget, a quick way to get a photo-backed look
  without switching to Ambient Mode or a different template.
  - Deliberately a rendering-time-only override: turning it on never touches
    the widget's own stored x/y/w/h/z, so turning it back off restores the
    widget to exactly where it was, with no restore/cleanup logic needed at
    all — confirmed by design, then confirmed again by test.
  - Dragging and resizing are disabled while it's on (matches the existing
    treatment of a locked widget, though this isn't the same field and gets
    its own distinct badge/tooltip explaining why) — otherwise moving or
    resizing it would silently have zero visible effect while the override
    is active, which would just be confusing.
  - Applied consistently everywhere position/z-order gets decided: app.html's
    main Editor canvas, its Fine-tune Position mini-map, and display.html's
    own `renderLayout()` and Live Editing selection/resize overlay.
  - Verified end-to-end, 19 checks across both files — confirming the visual
    override actually applies (fills the screen, correct z-index), the
    stored fields genuinely stay untouched (checked directly, not inferred),
    a real drag attempt has no effect on the stored position, resize handles
    disappear and reappear correctly, other widgets on the same layout are
    unaffected, and unchecking restores the exact original position and
    handle visibility — not assumed reversible, checked.

## 1.57.2
- **Fixed the reported Photo widget bug — picking a specific photo silently
  didn't take effect until toggling the mode dropdown away and back.** Root
  cause: the settings panel auto-saves via a single delegated listener on
  `input`/`change` events bubbling up from the panel (see
  `drawWidgetSettingsPanel()`) — but the photo picker's thumbnails are plain
  `<button>` elements, and a click never fires either of those events. The
  pick was correctly stored in memory the whole time; it just never
  triggered a save until some unrelated field's real `change`/`input` event
  happened to fire afterward and piggyback the already-mutated data along
  with it — exactly matching the reported symptom.
- **While tracing that one, systematically audited every other click-based
  control in the same settings panel for the identical gap** — found and
  fixed 5 more genuine instances: the primary and secondary text-color
  swatch pickers, the text-color reset button, the Home Assistant entity
  picker's selection step, and the Decoration widget's emoji quick-pick
  buttons. All six now explicitly call `autoSaveLayout()` on click, the
  same way every native form control in this panel already does
  automatically.
  - **Also audited, and correctly determined were NOT actually broken**:
    the in-panel expand/delete buttons and the layer-order controls
    (bring to front/send to back/move up/down) all already call
    `rebuildCanvas()`, which itself calls `autoSaveLayout()` internally —
    these were saving correctly the whole time. Added an explicit
    `autoSaveLayout()` call to each anyway, as a deliberate, harmless
    defensive measure (debounced, so calling it twice in a row is a
    no-op beyond resetting the same timer) — makes the save-intent
    explicit at each call site rather than depending on a future reader
    knowing that `rebuildCanvas()` happens to have that side effect.
    Documented as NOT a bug fix, to avoid overstating what was actually
    found — 6 genuine bugs, 5 defensive additions, not 11 bugs.
  - Confirmed the Sports widget's own team-search picker (built earlier
    this session) already correctly called `autoSaveLayout()` — the
    original author of that one got it right; this audit just confirms
    it wasn't also carrying the gap.
  - Confirmed `display.html`'s own equivalent Live Editing pickers (photo
    thumbnails, decoration quick-picks, sports search) were never affected
    — that code always explicitly calls `scheduleLayoutSave()` at every
    such site, verified directly rather than assumed just because it's
    a different file using a different save mechanism (no shared delegated
    listener there — every handler calls its own save directly).
  - Verified end-to-end, not just read through: 7 checks, each one
    capturing the REAL save payload sent to `PUT /api/layouts/...` after
    the relevant interaction and confirming the correct field is actually
    present (or correctly absent, for the reset button) in what gets
    persisted — not just that a function got called.

## 1.57.1
- **Test release — no functional changes.** Version bump only, deliberately
  trivial, to confirm the normal update flow works end-to-end now that both
  the central server and the developer's devices (host + Mirror) are fully on the
  renamed `piazzahq` code — no bridge zip needed this time, this is meant
  to go through `/api/v1/update-check` → download → `installFromZip()` →
  restart, and (for the host) the automatic push to Mirror, exactly as
  designed. If this succeeds cleanly, the whole rename saga from 1.57.0 is
  genuinely closed out, not just individually bridged.

## 1.57.0
- **Renamed this repo (and the sibling `piazzahq-server` central-server repo)
  from `pi-calendar`/`pi-calendar-server` to `piazzahq`/`piazzahq-server`** —
  the internal codename finally matching the actual product name everywhere
  else. Deliberately timed before real customers exist, so this is a clean
  rename rather than a live-migration problem.
  - **The highest-risk file was this repo's own `server.js`, not just the
    central server's** — the rename touches real application logic here,
    not just strings: `SERVER_INSTALL_DIR` (the Guided Central-Server
    Install feature's target directory), the nested-folder check for
    uploaded device-app update zips, the nested-folder check for uploaded
    central-server zips (matched to what `piazzahq-server`'s own `server.js`
    now actually produces — these two had to agree with each other), the
    generated systemd unit filename and every copy-paste `systemctl`/`cp`
    command the Guided Install flow hands back to the operator, the backup
    folder-naming convention, AND — easy to miss since it's a completely
    separate code path from the update/install logic — the host-to-slave
    "push update" builder (`buildSelfUpdateZip()`), which stages files into
    a folder matching whatever name the RECEIVING slave's own validation
    logic expects. These two were checked against each other directly, not
    assumed consistent from the rename alone — a mismatch there would have
    silently broken the host-to-slave push feature for anyone using it.
  - `install.sh` (the actual script customers run) — systemd service name,
    fresh-Pi zip-unpacking convenience, and the final summary commands.
    Re-read after the rename, not just syntax-checked, given how directly
    customer-facing this file is.
  - The three `scripts/*.service`/`*.sh` files — `rotation-watchdog.service`
    had an actual hardcoded example username (`jlauty`) alongside the
    folder path; only the folder path was renamed, the username left
    untouched since it's an unrelated personal detail, not part of the
    product's own naming.
  - Also caught during this pass, a pattern the earlier `pi-calendar`
    (hyphenated) searches wouldn't have found: "Pi Calendar" (space-
    separated) still appeared in `rotation-watchdog.service`'s
    `Description=` line — found by a separate, deliberate search for that
    exact different pattern, not assumed covered by the hyphenated search
    alone.
  - `public/app.html`, `README.md`, `REMOTE_ACCESS.md`, `package.json`
    (`name` field), and every outbound HTTP `User-Agent` header
    (`PiCalendar/1.0` → `PiazzaHQ/1.0` and variants) — external services
    don't validate the exact string, but no reason to leave the old name
    identifying this app to weather/calendar-sync APIs going forward.
  - Verified: zero `pi-calendar`/`PiCalendar` references remain anywhere in
    this repo's functional files (confirmed by a repo-wide grep, not
    spot-checked), `node -c server.js` passes, every touched shell script
    passes `bash -n`, both `app.html` and `display.html`'s script blocks
    pass a syntax check, `package.json` still valid JSON. Two real mistakes
    were made and caught mid-edit on the `piazzahq-server` repo's own
    `server.js` during the first half of this rename (validation logic
    accidentally deleted twice while renaming a single line inside a larger
    function) — informed a more careful line-targeted approach here,
    verifying syntax AND line count after every single edit rather than
    batching several together.
  - **Not done, deliberately: nothing in this repo talks to any EXISTING
    running install.** The developer's own current device stays on the old
    `pi-calendar`/`pi-calendar.service` naming for now, by his own choice —
    he'll migrate it manually (or via a future script) when he's ready,
    rather than this rename trying to force or auto-migrate a live device.
    Practical effect: that device's automatic "Settings → Software Update"
    will stop finding anything to apply once new zips use the new folder
    name, since it's still looking for `pi-calendar/server.js` inside a
    downloaded zip — not an error, just a quiet no-op, and the expected
    tradeoff of choosing not to build backward-compatible dual-name
    detection for a problem that isn't needed yet.
  - **Both repos' zips still need repackaging under the new names** and
    independently verifying the packaged output — same discipline as every
    other release this session, not yet done as of this entry.

## 1.56.6
- **Full Live Editing settings parity for the Photo widget** — the last
  type in this whole effort besides Tasks/Tasks Combined (still explicitly
  paused pending Home Assistant validation). Given its own scoping
  conversation first, same treatment Calendar/Weather got at the very
  start — confirmed it needed no external-account handling (photos already
  live on the Pi itself) and no reason to split it into a smaller first
  pass, so it shipped as full parity in one go rather than a partial cut.
  - **Which Photos**: show all active photos or a hand-picked subset, plus
    an independent tag filter — tags are derived client-side from the
    actual photo list (matching app.html's own approach) rather than a
    separate endpoint, fetched fresh whenever the panel opens.
  - **The photo picker itself**: a real inline thumbnail grid (not a
    separate full-screen picker like the entity/widget pickers) — tap a
    photo to select or deselect it, matching app.html's own inline
    placement exactly rather than introducing a different interaction
    pattern for what's usually a much smaller set of images than a Home
    Assistant entity list.
  - **Appearance**: image fit (fill/width/height/auto — with a
    blur-background toggle that correctly only shows for "auto" fit),
    four independent edge-fade sliders (top/bottom/left/right).
  - **Slideshow**: fade-between-photos toggle with a duration select that
    correctly hides when transitions are off, slide interval (or defer to
    the global setting), shuffle order.
  - Every field ported directly from app.html's own settings block and
    confirmed against the display's actual rendering/crossfade logic
    before wiring anything up — same discipline as every batch this
    entire effort.
  - Verified end-to-end, 20 checks — including that tags are correctly
    deduplicated and sorted from the raw comma-separated photo data (not
    just that some tags show up), the picker grid population hitting a
    real `/api/photos` call, a thumbnail's selection state actually
    toggling on repeat clicks (select then deselect, not just select), and
    two separate conditional-visibility checks (blur-background only for
    "auto" fit, fade duration only when transitions are on) confirmed in
    both directions. Zero page errors. Screenshot taken to confirm the
    full three-section panel renders correctly.
  - Caught and fixed a real string-escaping bug during this build, not
    just written and assumed correct: an escaped apostrophe inside a
    single-quoted JS string came out malformed on first attempt (a stray
    double-backslash that would have broken the whole script block) —
    caught by the same "syntax-check before testing" step every change
    this session goes through, not shipped and discovered later.
  - **28 of ~29 widget types now have full settings parity — every type
    except Tasks/Tasks Combined**, which remain explicitly paused per
    the developer's direction until Home Assistant's picker pattern is validated
    against a real instance. The universal Text Color / Tile Background /
    Text Opacity feature (applies across every widget type, not scoped to
    one) also remains open, flagged for its own future conversation.

## 1.56.5
- **Full Live Editing settings parity for Upcoming, Today, and Agenda** —
  the last three widgets besides Tasks/Tasks Combined (still explicitly
  paused) and Photo (getting its own scoping pass next). Each gets its own
  layout style (list/cards/compact), font size, and per-event show/hide
  toggles (time, calendar source label, notes) — Agenda additionally gets
  its own days-ahead range, distinct from Calendar's own `agenda` LAYOUT
  MODE, a same-word-different-thing naming coincidence handled with
  distinct element ids (`ag2-` vs. Calendar's `cal-agenda-*`) so the two
  can never be confused even though, architecturally, only one settings
  panel is ever actually open at a time.
- **Found and fixed a real gap in Calendar's own settings, shipped back in
  1.56.0** — while reading app.html's source for these three types, found
  a shared "Content" block (which calendars to show, show/hide multi-day
  events) that app.html gates on `isCalendarWidget` — true for Calendar,
  Upcoming, Today, AND Agenda alike. Calendar's advanced settings never
  got this block when it first shipped; only surfaced now while building
  the other three types that share it. **Retrofitted into Calendar's
  existing panel**, not left as a known gap — same underlying
  `sourceFilter`/`showMultiDay` fields the display's own event-filtering
  logic already reads, confirmed genuinely wired into all four render
  paths before shipping, not assumed from the shared gating condition
  alone.
  - The shared filter itself: a real list of "Local Events" plus every
    connected iCal feed (fetched from `/api/feeds`, cached once and reused
    across all four widget types' panels rather than re-fetched on every
    open), each individually checkable — same `null` = "everything,
    future-proof for a calendar added later" convention already used for
    Chore Chart/Leaderboard's kid selection.
- **A second large feature was found during this same read-through and
  deliberately NOT built**: Text Color, Tile Background, and Text/Color
  Opacity overrides apply to literally every widget type in the app
  (`w.textColor`/`w.textColor2`/`w.tileOpacity`/`w.textOpacity`), not just
  calendar-family ones — none of the 24 widget types with Live Editing
  parity so far have this. Flagged rather than quietly retrofitted into
  everything at once, given the real scope (custom + preset color swatches,
  a secondary-color toggle, two opacity sliders, times 24+ existing panels)
  — this needs its own scoping conversation the way Calendar/Weather and
  now Photo have gotten, not a guess at how thoroughly to apply it.
  - Verified end-to-end, 17 checks — including that `/api/feeds` is
    fetched exactly once total across four separate panel opens (Upcoming,
    Today, Agenda, Calendar) confirming the caching actually works, that
    the retrofit genuinely added the shared filter to Calendar's panel
    without disturbing its own existing fields, and the `td2-`/`up-`
    element-id scheme genuinely avoids the pre-existing collision with the
    To-Do List widget's own `td-` prefixed fields (confirmed by directly
    checking `#td-list-select` does NOT appear on the Today panel, not
    just that `#td2-` does). Zero page errors. Screenshot taken of the
    retrofitted Calendar panel, scrolled to the new section, to confirm
    the visual result.
- **24 of ~29 widget types now have full settings parity.** Remaining:
  Tasks/Tasks Combined (paused pending HA validation), and Photo — next up
  for its own scoping conversation, same treatment Calendar/Weather got at
  the very start of this effort.

## 1.56.4
- **Full Live Editing settings parity for Clock, Date, News, Stocks, Travel
  Time, Sports, Text, and Decoration** — 8 in one round, continuing down
  the widget list. Deliberately skipped Tasks/Tasks Combined this round per
  direction — those share Home Assistant's account-linked-integration
  pattern, held off until HA itself has been tried against a real instance.
  - **Clock**: style (digital/analog), size, and — only shown for digital,
    correctly hidden for analog — time format (12/24-hour or match the
    display's own setting). Switching style live re-renders the panel so
    the right fields show and the size label switches between "Font Size"
    and "Size" to match.
  - **Date**: font size, date format (5 formats: US/international,
    long/short, ISO).
  - **News**: font size, headlines to show (3-15).
  - **Stocks**: font size, and per-index show/hide (Dow/Nasdaq/S&P 500) —
    each checkbox maps to a `hide*` flag, not a `show*` one (inverted
    naming already baked into the app's own data model), confirmed
    unchecking one doesn't touch the others' state.
  - **Travel Time**: label, from/to addresses, mode (driving/walking/
    bicycling). Editing an address triggers a real route re-fetch on blur
    once BOTH origin and destination are set — confirmed a fetch does NOT
    fire with only one of the two filled in, not just that it eventually
    fires once both are present.
  - **Sports**: font size, and a real team search-and-pick flow hitting the
    actual `/api/sports/search-team` endpoint (a public sports database,
    not an account-linked integration, so not held back by the Tasks/HA
    pause above) — picking a result fetches that team's game data and
    switches the panel from the search UI to a "current team, tap Change"
    view, mirroring the app's own editor exactly.
  - **Text**: content, style preset (plain/heading/label, each applying its
    own sensible font-size/weight defaults), font family (the same 16-font
    list as the app, grouped identically, with a live preview sample and
    on-demand Google Fonts loading), size, weight, alignment. Deliberately
    scoped to just the fields inside the `text` type's own settings block —
    the Text Color override system is a separate, SHARED feature spanning
    multiple widget types, not part of this pass; left for its own future
    scoping.
  - **Decoration**: a 24-emoji quick-pick grid plus free-text entry, size,
    opacity, rotation.
  - Every field ported directly from app.html's own settings blocks,
    confirmed against the actual display.html renderers before wiring
    anything up, same discipline as every prior batch.
  - Verified end-to-end, 27 checks — including the Clock style-switch
    field visibility, Stocks' inverted hide-flag mapping specifically (not
    just that a checkbox does something), Travel's two-fields-required
    fetch gating, the Sports search hitting a real mocked endpoint and the
    panel correctly switching views after picking a result, and the Text
    widget's font-family change actually injecting a Google Fonts `<link>`
    tag, not just updating a data field. Zero page errors. Screenshot taken
    of the Text panel to confirm the visual result.
  - **20 of ~29 widget types now have full settings parity.** Remaining:
    Tasks/Tasks Combined (paused), Upcoming/Today/Agenda (share Calendar-
    family filtering logic worth checking for overlap with `minical`'s own
    before building), and Photo (the biggest remaining one at 108 lines,
    likely wants its own scoping pass).

## 1.56.3
- **Full Live Editing settings parity for Timer, Moon Phase, Air Quality, On
  This Day, Daily Quote, and METAR/TAF** — six in one round, continuing
  down the widget list.
  - **Timer**: title, duration, and — the one with real behavior beyond
    simple fields — actual Start/Pause/Resume/Reset controls, mutating the
    same `timerEndsAt`/`timerRemainingSec` state the app's own editor uses,
    with the exact same math (not simplified). The settings panel re-
    renders itself after each action so the right button shows for the
    timer's new state (idle → Start; running → Pause; paused → Resume +
    Reset), same self-refresh pattern already established for Calendar's
    layout-style selector.
  - **Moon Phase**: font size, show/hide illumination %, show/hide lunar
    cycle day.
  - **Air Quality**: font size, show/hide UV Index, show/hide Pollen.
  - **On This Day**: max items shown, font size.
  - **Daily Quote**: font size (its only setting beyond title/font, which
    it doesn't even have a title field for).
  - **METAR/TAF**: airport ICAO code (auto-uppercased as you type, matching
    the app's own field behavior), show/hide TAF forecast, font size.
    Editing the ICAO code triggers a real fetch for the new airport's data
    on blur (not on every keystroke) — a new code has no data cached under
    it yet, so without this the widget would just sit empty until some
    unrelated refresh happened to come along, the same class of gap the
    QR-code re-render bug was last round, caught proactively here by
    checking for it up front instead.
  - Every field ported directly from app.html's own settings blocks for
    these six types — field names, defaults, and behavior, not
    reinterpreted — and confirmed each one is a real field the display's
    actual renderers already consume before wiring anything up, same
    discipline as every batch so far.
  - Verified end-to-end, 23 checks — including the full timer lifecycle
    (idle → running → paused → reset → idle again) confirming both the
    underlying state AND that the right controls actually show at each
    step, not just that the data changed. Zero page errors.
  - **12 of ~29 widget types now have full settings parity.** Continuing
    down the list.

## 1.56.2
- **Full Live Editing settings parity for Chore Leaderboard, Countdown, and
  QR Code** — continuing down the widget list.
  - **Chore Leaderboard**: title, rank-by (streak vs. weekly), font size,
    which kids to include — same kid-checkbox/`null`-means-everyone
    convention as Chore Chart, ported separately since it's a distinct
    field (`lbKidIds`, not `choreKidIds`) even though the UI pattern is
    identical.
  - **Countdown**: title, target date, optional time, "repeats every year"
    (for birthdays/anniversaries — counts down to the next occurrence
    instead of going negative once the date passes), font size.
  - **QR Code**: title, code size, content type (Text/URL vs. WiFi Network),
    the type-specific fields for each (raw content, or SSID/password/
    security for a scan-to-join WiFi code), title font size. Switching
    content type live re-renders the panel so the right fields show,
    matching the same self-refresh pattern the Calendar widget's layout-
    style selector already established.
  - **Found and fixed a real bug in the process, not just added new
    settings on top of it**: `rerenderSingleWidget()` (used after every
    Live Editing field edit to update just the one changed widget) never
    called `renderQRCodes()` — the separate pass that actually generates a
    QR widget's visible code into its container. Editing a QR widget's
    content in Live Editing was silently updating the saved data while the
    on-screen code stayed stale until some unrelated full re-render
    happened to come along. Fixed by having `rerenderSingleWidget()` also
    call `renderQRCodes()` — cheap and safe to call unconditionally on
    every single-widget update, same as the existing tap-listener rewiring
    calls it already made.
  - Verified end-to-end, 17 checks. The QR regeneration fix specifically
    was tested against real call-and-target logic, not just assumed fixed:
    the actual QRCode library loads from a CDN unreachable in this sandbox,
    so a lightweight stub was substituted to prove `renderQRCodes()` is
    actually invoked with the freshly-edited content for the right
    container — confirmed both for a plain text/URL edit and, distinctly,
    for a WiFi-preset edit (checking the generated string actually starts
    with `WIFI:` and contains the SSID just typed, not merely that
    *something* changed). Zero page errors.

## 1.56.1
- **Full Live Editing settings parity for To-Do List, Shopping List, and
  Chore Chart** — the next batch after Calendar/Weather, continuing down the
  full widget list per direction to keep going rather than stopping after
  each type to ask.
  - **To-Do List**: which list (a real picker fetched from `/api/todo-lists`,
    not a raw ID field), optional title override, font size, show/hide
    completed items.
  - **Shopping List**: title, font size, show/hide checked-off items.
  - **Chore Chart**: chart title, font size, which kids to show (checkboxes
    fetched from `/api/kids` — unchecking one excludes just that kid from
    this specific display; checking everyone back stores `null`, matching
    the app's own "future-proof for new kids" convention exactly, not a
    simplified version of it), show/hide completed chores.
  - All three ported field-for-field from app.html's own
    `drawWidgetSettingsPanel()` blocks for these types, including the exact
    same field names, defaults, and the `choreKidIds: null` = everyone
    convention — confirmed each field genuinely drives the real widget
    renderer (already used server-side; this just exposes existing,
    working fields to Live Editing, not new rendering behavior) before
    wiring anything up.
  - Verified end-to-end, 13 checks: advanced-settings button visibility,
    panel titles, the To-Do list picker populating with real fetched
    options and updating on selection, Shopping List's title edit live-
    updating the rendered widget, Chore Chart's kid checkboxes defaulting
    to all-checked, unchecking one correctly narrowing `choreKidIds` to an
    array, and re-checking everyone correctly reverting to `null`. Zero
    console errors beyond the pre-existing benign EventSource-in-a-test-
    harness noise already accounted for elsewhere in this project's test
    suite. Screenshot taken of the Chore Chart panel to confirm the visual
    result.
  - Next batch not yet chosen — per the developer, working continuously down the
    full widget list rather than re-confirming scope each time; whichever
    types get picked up next should follow the same pattern (check
    app.html's actual settings block size/complexity first, don't assume).

## 1.56.0
- **Home Assistant integration, Tier 1: a read-only Entity Status widget** —
  the first integration in this project that talks to a genuinely new
  external system, so it got its own scoping pass before any code was
  written (single entity per widget for now, matching this project's own
  precedent for "ship the simple version first, add a genuinely separate
  widget type later if a multi-entity version turns out to be needed" — see
  `tasks` → `tasksCombined`, `weatherCurrent` → `weather`).
  - **Credentials never reach the display or browser** — Home Assistant's
    base URL and Long-Lived Access Token live in settings and are used ONLY
    server-side, the exact same pattern already established for Weather's
    and Todoist's own API keys. The display and app only ever talk to this
    server's own `/api/ha/*` proxy endpoints.
  - Settings → Home Assistant: Base URL, Token, and a **Test Connection**
    button that validates whatever's currently *typed*, not whatever's
    already saved — otherwise a test's pass/fail would depend on whether
    the debounced auto-save happened to have already fired, the same
    reasoning the existing weather ZIP lookup's `?save=0` already uses.
  - New `entitystatus` widget type (🏠), addable from both the app's Layout
    editor and the display's own Live Editing add-widget palette. Picking
    an entity uses a real **searchable picker** (fetched live from Home
    Assistant, modeled on the existing emoji picker's search-and-filter
    shape) rather than requiring someone to type a raw entity ID like
    `sensor.living_room_temperature` by hand.
  - Server-side: entity data is cached for 10 seconds so multiple displays
    or multiple widgets pointed at the same entity don't add up to
    excessive load against someone's home server. The display's own fetch
    layer also dedupes — two widgets showing the same entity share one
    request, not two — mirroring how `fetchWeather()` already shares one
    fetch across widgets at the same location.
  - **Verified against a REAL local Home Assistant-shaped mock server**, not
    mocked fetches — 18 checks exercising the actual `haRequest()`/endpoint
    code extracted verbatim from server.js: auth headers, 401/404/
    unreachable-host/invalid-URL handling, entity trimming/sorting, and
    that caching genuinely prevents a second real request within the TTL
    window. Network access to the npm registry isn't available in this
    environment, so the full server couldn't be booted end-to-end; testing
    the real request/response logic directly against a real local HTTP
    server was the next-best rigor available, not a shortcut taken lightly.
  - Further verified: 17 checks on the display.html widget (loading/error
    states, shared-entity fetch dedup, Live Editing basic settings and
    add-widget palette/tap-to-place), and 12 checks on the app.html Settings
    section and entity picker (prefilled fields, Test Connection using
    live-typed values, search filtering, picking an entity updates the
    widget and autofills its label).
  - Caught and fixed two real bugs during this verification, not just
    guessed at fixes:
    - The new "Home Assistant" Settings section wasn't in the page's
      section→accordion-group map, so it would have rendered as an orphaned
      block outside the normal Settings navigation structure. Registered it
      under the existing "Data Sources" group alongside Weather/Todoist.
    - The entity picker's search input rendered nearly invisible, squeezed
      to a sliver — `.btn`'s own CSS sets `width:100%`, and the picker's
      "Done" button only added `flex-shrink:0` without overriding that
      width, so its flex-basis defaulted to the full row and, refusing to
      shrink, starved the search input of any space. Same underlying trap
      as `.form-input`'s own `width:100%`, just on the sibling element this
      time — see the hard-won-lessons entry for the general pattern.
  - Not built in this release, deliberately out of scope: further Home
    Assistant tiers (write/toggle controls, presence-aware Ambient Mode, a
    multi-entity dashboard widget) and HA install documentation — both
    still separate, open items.

## 1.55.15
- **Full settings parity for Calendar and Weather widgets during Live
  Editing** — a new "⚙️ More Settings" button (shown on the compact bottom
  panel for these types specifically) opens a full-screen scrollable
  settings sheet with real depth, not a trimmed-down subset.
  - **Calendar**: layout style (grid/agenda/strip) with the right
    sub-settings showing per layout, calendar view (1-4 week/month), week
    start day, max events per day, max lines per day, event text wrapping,
    dim-past-days, past-events handling, decoration style, font size — the
    same fields app.html's own editor exposes for this type, not a curated
    subset. Changing layout style live re-renders the panel so the correct
    sub-settings show, matching the app's own behavior exactly.
  - **Weather** (all four variants — Weather, Current, Forecast, Hourly):
    content size, forecast day count, hourly-specific style/hours controls,
    per-widget location override with a real ZIP-code lookup (hits the same
    `/api/geocode` endpoint the app uses), global location name (a genuinely
    shared setting with Settings → Weather, saved via `/api/settings` on
    blur — not a per-widget field, ported faithfully rather than
    simplified), location font size and alignment.
  - Every field, default, and behavior — including the "only save the
    location name as a manual override if it actually differs from the
    auto-derived value" nuance, and the location-override toggle correctly
    clearing lat/lon when turned back off — ported directly from app.html's
    `drawWidgetSettingsPanel()` for these exact types, not reinterpreted.
    Confirmed each field genuinely drives the real widget renderers (not
    dead data) before wiring anything up.
  - `showInfoPopup()`'s ⓘ-button popup system doesn't exist on this page;
    the same three explanatory texts are inlined as plain hint paragraphs
    instead of porting that whole subsystem for three tooltips.
  - Deliberately scoped to just these types this round, per explicit
    direction — the remaining ~27 widget types still get the existing
    title/font-only basic settings (or "more settings in the app" where
    even that doesn't apply). Not a general mechanism for "any type can get
    a rich panel" yet, though the pattern (`WIDGET_ADVANCED_TYPES`,
    `openWidgetAdvancedPanel()`) is built to extend to more types later
    without restructuring.
  - Verified end-to-end, 27 checks: advanced button visibility gated
    correctly per type (shows for Calendar/Weather, not for Clock), panel
    content/title per type, grid/agenda/strip sub-settings showing and
    hiding correctly, live layout-style change re-rendering the panel,
    every field type (select, range, checkbox, text) updating state and
    saving, the weather location override toggle and its ZIP lookup working
    against a real mock endpoint including the autofilled label, the
    override-off-clears-lat/lon behavior, and the global-location blur-save
    firing with the correct value. Zero page errors. Screenshot taken of
    the Calendar panel to confirm the visual result matches the intended
    design, not just the DOM state.

## 1.55.14
- **Add new widgets from the display itself, during Live Editing** — the
  first of the two bigger deferred items on the Live Editing list. Full
  palette (all 31 widget types, same as the app's own editor), grouped into
  the same 9 categories.
  - New ➕ button in the Live Editing bar opens a full-screen picker — tap a
    category to expand it, tap a type to pick it.
  - **Tap-to-place**: rather than dropping the new widget at a fixed spot
    the way the app's own editor does (fine there, since dragging to
    reposition is easy with a mouse — more fiddly on a touchscreen),
    picking a type here enters a placement mode: the display pulses a blue
    outline and shows "Tap where you'd like to place the [Type]" — the next
    tap on the canvas places it centered there (clamped so it can't land
    partially off-canvas), immediately selects it, and saves.
  - Widget type list, category groupings, and every type's default
    size/starting fields are ported directly from app.html's own
    `WIDGET_DEFS`/`WIDGET_CATEGORIES`/add-widget-defaults logic — field for
    field, not re-derived or guessed — so a widget added from the display
    starts out identical to one added from the app, not a second, subtly
    different version of "a new Clock widget."
  - Fixed a real conflict caught during testing, not just guessed at: tapping
    on top of an EXISTING widget while placing a new one would otherwise
    select/start-dragging the existing widget instead of placing the new one
    there, since the existing widget's own tap listener fires before the tap
    ever bubbles up to the canvas-level placement handler. Both listeners
    now agree on whose turn it is.
  - Verified end-to-end, 24 checks: picker shows all 31 types across all 9
    categories, category expand/collapse, placement mode's visual state
    (banner text, body class, Live Editing bar hidden underneath it),
    correct default size/fields for both a simple type (Clock) and a
    type with several default fields (Chore Chart), correct placement math
    (centered on the tap point, not the tap point itself as the corner),
    auto-selection and save after placing, Cancel correctly adding nothing,
    and the existing-widget-underneath conflict fix specifically. Zero page
    errors. Screenshots taken of the picker and placement mode to confirm
    the visual result.
  - The remaining Live Editing item — a fuller per-widget settings popup
    closer to the Layout tab editor's own capabilities — not attempted in
    this release; likely wants its own scoping pass given how large the
    app's per-type settings panel already is.

## 1.55.13
- **Renamed "Edit Mode" to "Live Editing"** throughout the UI (the pencil
  icon's tooltip, the top bar's label, and the related Settings help text)
  — a clearer name that also reads naturally alongside the existing "Live
  Preview" feature rather than the generic, slightly technical "edit mode."
- **Fixed: after tapping Done, widgets on the display were still tappable
  and would still show the selection outline/resize handles/settings
  panel** — a real bug, not cosmetic. The widget's own tap-to-select-and-
  drag listener never checked whether Live Editing was actually still on;
  `startDrag()` correctly refused to start an actual drag once it wasn't,
  but `selectWidgetForEdit()` had no matching guard, so a tap after Done
  still fully selected the widget with nothing to show for it being
  selected. Added the same guard `deleteWidget()` was already missing too
  (defensive — a destructive action shouldn't depend on the Delete button
  simply staying hidden as the only thing preventing it from firing).
- **Fixed two separate causes of resize/move feeling unreliable and
  laggy**, both real, both confirmed and fixed, not just one:
  - Resize handles were a 26px hit target — comfortably under the ~44px
    touch-target-size guideline. An imprecise tap landing just outside that
    small area fell through to the widget underneath instead, starting a
    MOVE rather than a resize — exactly the "grab a corner and it sometimes
    just moves it" symptom. Hit target is now 44px (kept the VISIBLE dot at
    the original smaller 26px via a centered `::after`, so this doesn't
    turn into eight big blue circles cluttering every selected widget —
    just a more forgiving invisible margin around each one). Confirmed with
    a targeted test: a tap 18px off the handle's true center — which would
    have missed the old hit area entirely — now still lands on the handle.
  - Both drag and resize were doing a full set of DOM writes (widget
    position/size style, PLUS the separate selection-overlay's own sync)
    synchronously on every single raw `pointermove` event. Raw pointer
    events can fire considerably faster than the screen can actually paint,
    so under real touch input this was very likely the "just in general
    slow to recognize and respond to input" feeling, and could plausibly
    also explain resizing "not as much as I dragged it" if events were
    getting dropped/coalesced under that write load rather than the last
    one always being applied. Both now batch through
    `requestAnimationFrame` — only the LATEST pointer position gets written
    to the DOM, once per frame, with one final synchronous apply on
    pointer-up so the very last position is never dropped even if a
    pending frame hadn't run yet. Confirmed with a realistic 25-step
    simulated drag (rather than one big jump) landing exactly on the full
    dragged distance, not short of it.
  - Verified end-to-end: Done correctly stops further selection and a
    re-tapped widget shows nothing; re-entering Live Editing afterward
    still works normally (regression check); the enlarged hit target
    catches an off-center tap; a multi-step realistic drag reaches the
    exact expected final size. Zero page errors.
  - Adding new widgets from the display, and a fuller per-widget settings
    popup closer to the Layout tab editor's own capabilities, are both
    substantial separate pieces of work — not attempted in this release.

## 1.55.12
- **Re-enabled the "Open this display in a new tab" link and Copy URL button on
  each display profile card** (Settings → Displays → Profiles) — these existed
  in the code already but were commented out ("never worked reliably"). Given
  everything found in 1.55.9–1.55.11, "unreliable" was almost certainly this
  exact link opening with `?preview=1` appended, which disables direct-editing
  — the same root confusion that took the last several releases to fully run
  down. Re-enabled using the plain, real display URL (no preview flag), plus
  the URL text itself is now visible on the card, not just hidden behind a
  button — so a person doesn't have to reverse-engineer the URL structure
  the way this conversation just did.
  - Deliberately did NOT touch the separate "Open in New Tab" button in the
    Layout tab's own Live Preview panel — that one is supposed to carry
    `?preview=1`, since it's specifically for viewing/testing the preview
    render at different resolutions, not for reaching the real interactive
    display. Two different buttons, two different intended destinations;
    conflating them was never the right fix.
  - The click handler for both re-enabled buttons already existed in the
    code (previously orphaned since the buttons were commented out) — no new
    JS needed, just the markup restored, using the URL variable this
    function already built correctly.
  - Verified end-to-end: the link's `href` and the copy button's underlying
    URL are both the plain `?display=<slug>` URL with no preview flag, and
    clicking Copy URL actually writes that exact URL to the clipboard.

## 1.55.11
- **Found and fixed the ACTUAL root cause of the "no edit icon" report** — a real
  bug, present since Phase 3 first shipped (1.55.3), completely unrelated to
  `IS_PREVIEW`. The `#edit-mode-trigger` button had `style="display:none"`
  hard-coded directly in its HTML tag. The show/hide mechanism it's actually
  meant to use is a CSS opacity transition (`.shown` toggles `opacity:0` →
  `opacity:1`) — but `display:none` overrides opacity entirely; no amount of
  correctly wiring the reveal-on-tap listener or fixing `IS_PREVIEW` could
  ever have made the icon appear, because the element was never in the
  render tree to begin with. Every fix across 1.55.9–1.55.10 was correct for
  the problem it targeted, just aimed at something that was never actually
  the (or at least the only) blocker — this device's specific `IS_PREVIEW`
  misdetection was real and worth fixing, but the icon was ALWAYS going to
  stay invisible underneath it regardless, on every device, this whole time.
  Confirmed via the diagnostic trail: `IS_PREVIEW: false` and
  `document.body._editModeWired: true` (both correct) with the icon still
  invisible — the only remaining explanation once both of those check out.
  Fixed by removing the stray inline style so the CSS opacity mechanism it
  was always meant to use actually controls it.
  - Verified end-to-end (targeted check, not the full suite, given where
    this investigation already was time-wise): icon's computed `display` is
    now `block` (was `none`) at boot, opacity genuinely transitions `0 → 1`
    on tap, `pointer-events` genuinely becomes clickable (not just visually
    present), and clicking it actually flips `editModeActive` to `true`.
  - Lesson for HANDOFF.md: an inline `style="display:none"` on an element
    silently defeats ANY class-based/CSS-driven show mechanism for that
    element, permanently, no matter how correct the JS toggling the class
    is — worth specifically checking for stray inline `display` attributes
    when a CSS class-toggle "should obviously be working" but isn't, rather
    than assuming the JS logic driving the class must be at fault.

## 1.55.10
- **Removed the viewport-size auto-detection for `IS_PREVIEW` entirely** — the
  1100px heuristic from 1.55.9 still wasn't reliably distinguishing real
  displays from phone/tablet previews on some screens, so rather than keep
  tuning the threshold, preview mode is now ONLY entered via an explicit
  `?preview=1` in the URL. That's exactly what the real Live Preview iframe
  in app.html's Layout tab already sends on its own (see the iframe src
  builder and the "Open this display in a new tab" link), so removing the
  auto-detection doesn't affect that legitimate use — everything else now
  defaults to being treated as a real display, full stop. The 1.55.9
  `force_real_display` Settings toggle is no longer necessary (auto-
  misdetection can't happen anymore) but left in place harmlessly rather
  than ripped out under time pressure.
  - Not independently re-tested end-to-end per this round's direction to
    ship the removal directly — the change itself is a straightforward
    deletion of the size check (one `return` statement replacing a
    multi-branch heuristic), and the explicit-`?preview=1` path it now
    relies on exclusively was already covered by prior end-to-end testing.

## 1.55.9
- **Fixed: direct-editing (Phase 4) could be permanently, silently unavailable on
  a real display, with no error and no obvious cause — the culprit was
  `IS_PREVIEW` auto-detection, which decides "is this a real display or a
  phone/tablet previewing the Layout tab" purely from `window.innerWidth`/
  `innerHeight`.** On a screen where OS-level display scaling shrinks the
  browser's own reported viewport well below the physical screen size — the
  confirmed real-world case: a touchscreen reporting ~220% effective scaling
  despite its own display settings claiming 100% — the CSS viewport reads
  small enough to trip the same "under 1100px, treat as a small device"
  threshold a real phone would trip, disabling edit mode (and, it turns out,
  a second, unrelated thing: `resolveAssignedProfile()`'s own canonical
  screen-id persistence, which also gates on `IS_PREVIEW` and was silently
  skipping `localStorage` writes on the same misdetected device every single
  boot — not just missing edit mode, but never reliably remembering its own
  identity across reloads either).
  - Multiplying by `devicePixelRatio` to "correct" the viewport check was
    considered and rejected: real phones have high devicePixelRatio BY
    DESIGN (2-3x, for retina displays), so that change would have
    misclassified actual phones as real displays and broken Live Preview
    detection broadly — the two cases aren't reliably distinguishable from
    viewport numbers alone.
  - **New: a per-device Settings → Display toggle, "Force real display
    mode"** (`force_real_display`, off by default, `LOCAL_ONLY_SETTINGS` —
    one screen's scaling quirk shouldn't affect any other screen's
    detection). When on, corrects `IS_PREVIEW` to false on that device
    specifically, once settings have loaded — an explicit `?preview=`/
    `?nopreview` URL parameter still always wins over the setting, since
    that's someone deliberately requesting a specific mode for testing.
  - Moved the settings fetch (and this correction) to run BEFORE
    `resolveAssignedProfile()` in `init()`, not after — the original order
    had the screen-identity persistence check running on the stale,
    pre-correction `IS_PREVIEW` value regardless of this fix, which would
    have left that second bug in place even after fixing edit mode.
  - Verified end-to-end against a real server-shaped mock, 9 checks across 5
    scenarios: the setting OFF at a small viewport still behaves as a normal
    preview (regression check), the SAME small viewport with the setting ON
    correctly flips `IS_PREVIEW` and — the check that actually matters —
    the edit icon genuinely becomes tappable and shows up, not just that an
    internal flag changed; the explicit `?preview=1`/`?nopreview` URL
    overrides both still win regardless of the setting; and a normal
    real-sized viewport with the setting off (the common case for everyone
    else) is completely unaffected. Zero page errors.

## 1.55.8
- **Phase 4 (partial): resize, delete, and basic on-device settings for
  widgets already on the layout, right on the actual display** — extends
  Phase 3's move-only editing. Adding NEW widget types from the display
  itself is deliberately still out of scope (kept as an open item; app.html
  has ~25 widget types each with their own default config, and porting that
  whole palette is a separate, larger piece of work) — this covers editing
  what's already placed.
  - **Resize**: tap a widget to select it (outline + 8 handles, same
    corner/edge-anchoring math as the app's own editor — dragging a corner
    anchors the opposite corner in place, an edge-middle handle adjusts just
    that one dimension). A 6%-of-canvas minimum size floor prevents shrinking
    a widget into an unusable sliver. Handles live on a single shared overlay
    element (a sibling of the widgets, not a child of one) since `.widget`'s
    own `overflow:hidden` would otherwise clip handles drawn just outside its
    edges — same trap the `$()` shorthand bug and others in this project have
    hit before: something that "should obviously work" but silently doesn't
    because of a sibling file's/element's own unrelated rule.
  - **Delete**: a Delete Widget button in a new bottom settings panel (not a
    tiny per-widget ✕ badge — a bigger, more reliable touch target on a wall
    TV, especially viewed from a distance).
  - **Basic settings (title + font size)**: the same bottom panel shows a
    Title field and/or Font Size slider depending on widget type, wired
    directly to each type's own field name (`choreTitle`/`choreFontPx`,
    `shoppingTitle`/`shoppingFontPx`, etc.) — pulled directly from app.html's
    own settings panel code as the source of truth for field names/ranges,
    not guessed, since a wrong field name would silently write to a key the
    renderer never reads. Widget types with no simple px-based font field
    (Weather variants use a %-based scale, Tasks uses a %-based scale, Photo
    has no font concept at all) show "More settings available in the app."
    instead of a broken or misleading control — full settings parity with
    the app's much larger panel is out of scope here.
  - Edits re-render just the ONE affected widget instead of the whole
    canvas — a full re-render on every keystroke would tear down and
    recreate the settings panel's own text input mid-type, losing focus and
    cursor position.
  - Selection survives a full canvas re-render (SSE push, the periodic
    5-minute refresh) instead of going stale — re-syncs onto the freshly
    created element, or cleanly deselects if the selected widget is simply no
    longer there (e.g. deleted from another device mid-edit).
  - Verified end-to-end against a real server-shaped mock, 29 checks:
    selection chrome and panel population per widget type, resize via
    multiple handles with correct anchoring and min-size floor, title/font
    edits updating state/DOM/save, the "more in app" fallback for
    unsupported types, deselect-on-outside-tap, delete's full effect
    (state/DOM/panel/save), Phase 3 move still working unchanged, chrome
    surviving a full re-render, clean deselection when the selected widget
    vanishes externally, and exiting edit mode cleaning up selection state.
    Two real debugging dead-ends along the way, both worth remembering:
    dispatching synthetic pointermove/pointerup on the resize HANDLE element
    doesn't work once `setPointerCapture()` has redirected the pointer to the
    WIDGET element — a real browser reroutes captured events regardless of
    literal event target, but `dispatchEvent()` doesn't emulate capture, so a
    test simulating a captured drag has to dispatch the follow-up events on
    the captured element, not the one the gesture visually started on. And
    `IS_PREVIEW` (which disables direct-editing entirely, on purpose, so a
    phone previewing the Layout tab can't write back to the real layout)
    auto-detects off viewport size — `Math.max(vw, vh) < 1100` — so a test
    running at a phone-sized viewport silently exercises none of this
    feature at all, no matter how correct the underlying code is, unless the
    viewport is sized like a real wall display. Zero page errors.
  - Screenshot taken of a selected widget mid-edit to confirm the resize
    handles, outline, top edit-mode bar, and bottom settings panel all
    render and coexist correctly, not just that the DOM state looked right.

## 1.55.7
- **Calendar swipe/tap navigation extended to the week views, Agenda, and
  Strip layouts** — previously only the month-grid view had it. Same
  mechanism throughout: tap the ‹ › arrows or swipe the widget itself, a
  "Today" button appears once you've navigated away to jump straight back,
  and it's a purely local viewing change that auto-resets after 90 seconds
  of no further navigation — nothing here is saved anywhere, same as the
  original month-view feature.
  - **Grid week views (1/2/3/4-week)**: each nav step now pages by the
    view's own window width — a 2-week view's "next" jumps two weeks
    forward, not one — since unlike month view there's no smaller natural
    "next" unit than the window itself.
  - **Agenda layout**: gained a small header (arrows + date-range label,
    matching the grid views' look) it didn't have before. Paging shows
    whatever's actually in the requested window regardless of the
    "past events" setting — navigating backward is an explicit request to
    see the past, not something that setting should have to be turned on
    for first. At the default (un-navigated) position, behavior is
    unchanged, including the past-events setting's own extra look-back
    window.
  - **Strip layout**: gained a compact header (arrows only, no date label —
    each cell already shows its own day name/number, so a redundant range
    label would just be visual noise on an otherwise minimal widget).
    Fixed a real correctness bug the review process caught before shipping:
    the strip's original single-window code labeled the FIRST cell "Today"
    unconditionally (`i === 0`); once paging exists, the first cell isn't
    always today, so this would have mislabeled every paged-forward view.
    Now compares the cell's actual date against the real current date.
  - Refactored the nav-arrows/Today-button markup into one shared helper
    (`miniCalNavHtml()`) used by all four views instead of four hand-copied
    versions, including rewriting month view's own (already-shipped)
    version to use it — reduces duplication, but meant re-verifying month
    view's existing behavior wasn't disturbed by the refactor, not just
    testing the three new cases.
  - Verified end-to-end against a real server-shaped mock, 20 checks across
    all four views: nav-button presence, header label actually changing on
    next/prev, swipe-left correctly advancing by the same amount as a real
    click, Today correctly resetting the label and correctly hiding itself
    again once at the default position, the strip mislabeling fix
    specifically (paged-forward first cell no longer reads "Today"; reset
    position correctly still does), month view's original behavior
    confirmed unchanged after the shared-helper refactor, and — mirroring
    the same regression class the Chore Chart/To-Do/Shopping widgets guard
    against — repeated `wireMiniCalNav()` calls (simulating re-renders)
    don't double-attach listeners (checked by comparing a real click's
    result against a single controlled programmatic nav step). Zero page
    errors. Screenshots taken of all three newly-navigable layouts before
    and after paging to confirm the visual result, not just the DOM state.

## 1.55.6
- **Shopping List widget now supports tap-to-complete on the display**,
  bringing it in line with the Chore Chart and To-Do widget's own
  direct-interaction pattern. The widget was previously left read-only on
  purpose (an in-code comment said checking things off should only happen
  from the Hub or the app) — disregarded per direction to ship this now.
  Exact same shape as the To-Do widget: tap an item, optimistic update,
  `PUT /api/shopping-items/:id` (the same endpoint the Family Hub and app's
  own Shopping tab already use), revert-on-failure with the same toast used
  elsewhere. Also fixed a stale line in the app's widget settings panel that
  still described the widget as read-only.
  - Verified end-to-end against a real server-shaped mock: correct
    `data-item-id`/`data-interactive` wiring so a tap doesn't also pop the
    edit-mode icon, tapping toggles both directions with the exact right
    request sent to the real endpoint, a server failure correctly reverts
    the optimistic update and shows the same toast the Chore Chart/To-Do
    widgets use, and — mirroring the exact regression the Chore Chart test
    already guards against — calling the wiring function again (simulating
    a re-render) does not attach duplicate listeners that would otherwise
    fire multiple requests from a single tap. Zero page errors.

## 1.55.5
- **Fixed: the per-profile font setting had no effect at all** —
  reported specifically on Chalkboard, where it's most noticeable
  since that theme has such a distinct default look, but the bug
  affected every theme equally. Found the exact cause:
  `fetchDisplayConfig()` explicitly rebuilds its config object field by
  field from the server's response, and `fontFamily` was simply never
  included in that list — a real gap introduced when the per-profile
  font feature was first built, not a regression from anything since.
  The server had been sending the field correctly the entire time; the
  client just never copied it over, so `displayConfig.fontFamily` was
  always `undefined` regardless of what was actually chosen. Per-widget
  font overrides were correctly unaffected, since those live in a
  completely separate data path (each widget's own settings) that
  never touched this bug at all — which is exactly why only the
  profile-level setting appeared broken.
  - Honest note on test coverage: the original feature's tests (23
    checks, all passing at the time) verified `applyFontFamily()`
    thoroughly, but only by setting `displayConfig` directly — they
    never actually exercised `fetchDisplayConfig()` itself, which is
    exactly where this bug lived. Fixed now: verified with a true
    end-to-end reproduction (a real, unmodified init sequence — fetch
    the config, apply the theme, apply the font — against a mocked
    server response) confirming the fix all the way through to an
    actual rendered widget showing the chosen font instead of
    Chalkboard's own default. Zero page errors.

## 1.55.4
- **Phase 2 complete: the To-Do widget and the mini calendar now
  support direct interaction too, alongside the Chore Chart shipped
  earlier.** Same idea throughout — interact directly on whatever
  screen is actually showing the widget, not just through the app or
  Family Hub.
  - **To-Do widget**: tap an item to check it off, right on the
    display. Mirrors the Chore Chart's own pattern exactly — optimistic
    update, the same `PUT /api/todo-items/:id` endpoint the Family Hub
    already uses, revert-on-failure. (The Shopping List widget was
    deliberately left alone — it already had an explicit, intentional
    "read-only on the wall, checking things off happens from the Hub
    or the app" note in the code, which this respects rather than
    overriding.)
  - **Mini calendar (month view)**: swipe left/right, or tap the new
    ‹ › arrows, to browse to a different month — plus a "Today" button
    that appears once you've navigated away, to jump straight back.
    Deliberately a purely local, temporary viewing change, not saved
    anywhere — auto-resets back to the current month after 90 seconds
    of no further navigation, so the display doesn't end up stuck
    showing some other month long after someone briefly checked what's
    coming up. Scoped to month view specifically; the week views
    didn't get this, since "next/previous month" doesn't map onto them
    as directly. The swipe gesture requires a real, clearly horizontal
    drag past a genuine distance threshold, so an imprecise tap or a
    vertical scroll attempt doesn't accidentally flip the month.
  - Verified with 27 checks across both features: correct scoping
    (arrows only appear for month view), correct offset math across
    repeated navigation, the Today button appearing and disappearing
    at the right moments, a real swipe correctly triggering navigation
    while a small or mostly-vertical movement correctly does not, and
    — for both widgets — confirming a tap never also triggers the
    Phase 3 edit-mode icon reveal. Zero page errors.

## 1.55.3
- **New: direct edit mode (Phase 3) — tap the screen, tap the small
  edit icon that appears, and every widget becomes draggable right on
  the actual rendered display.** The real wall display, or any tablet
  loading the same address over LAN or Tailscale, can now reposition
  widgets directly instead of only through the app's own editor.
  Dropping a widget saves through the exact same
  `PUT /api/layouts/:orientation` endpoint the app's editor already
  uses, so it's indistinguishable server-side from an edit made there
  — including the same live broadcast that already propagates it
  everywhere else. Deliberately excluded from Live Preview, which
  already has its own dedicated editor and shouldn't write back to the
  real layout as a side effect of just being viewed.
  - The edit icon is deliberately understated: hidden by default,
    briefly revealed by a tap on empty space (not on anything already
    interactive, like a chore checkbox), auto-hiding again after a few
    seconds untouched — available if you go looking for it, not a
    permanent fixture on a screen that's normally just being looked at.
  - Security note worth knowing: the layout-save endpoint this calls
    already had zero authentication before this — same as the display
    page itself — so this doesn't introduce a new risk, just a new
    surface for an existing one. Worth considering gating that
    specific endpoint behind the app's existing PIN at some point.
  - Two real bugs caught and fixed by actually running this, not just
    reading the code back: every new function used `$('id')`, assuming
    the same shorthand the app and Family Hub both have — but the
    device display page has no such helper at all, so the entire
    feature was silently crashing via ReferenceError on init and never
    actually worked until this was caught. Separately,
    `setPointerCapture()` could throw and abort a drag partway through
    in some cases (confirmed by watching a test fail to track drag
    movement correctly) — wrapped defensively, which visibly fixed it.
  - Verified with 18 checks across two full runs: the tap-to-reveal
    icon, entering and exiting edit mode (body state, visible chrome),
    a genuine drag correctly saved through the real endpoint with the
    right updated coordinates, dragging past the canvas edge correctly
    clamping instead of going out of bounds, and confirming edit mode
    is never even wired up at all when running in Live Preview. Zero
    page errors.

## 1.55.2
- **New: tap a chore on the Chore Chart widget to mark it done —
  right from wherever it's being shown**, not just the dedicated kid
  check-off page. Proof of concept for a bigger direct-interaction
  effort: any screen showing the display (the real wall display, or
  another tablet loading the same address over LAN or Tailscale) can
  now check off a chore directly, with the change reflected everywhere
  else live via the same broadcast mechanism the app already uses.
  Reuses the exact same toggle endpoint and optimistic-update pattern
  the kid page already relies on — this is the same interaction,
  reachable from a second place, not a new one built from scratch.
  - Photo-required chores are deliberately excluded here — capturing
    and uploading a photo is its own real flow on the kid page, and a
    wall-mounted screen typically has no camera to use for it anyway.
    Tapping one shows a brief explanatory message instead of either
    silently failing or (worse) letting it through without the photo
    the server would reject anyway.
  - Verified with 15 checks: correct data attributes on each chore,
    tapping toggles both directions with the exact right request sent
    to the real endpoint, a photo-required chore never even calls the
    endpoint and shows the explanatory message, a server-side failure
    correctly reverts the optimistic update with an error message
    instead of leaving the UI in a state that doesn't match the
    server, and — a real bug this test caught and the fix specifically
    guards against — calling the wiring function again (simulating
    repeated re-renders, which happen constantly as other data
    updates) does NOT attach duplicate listeners that would otherwise
    fire multiple requests from a single tap. Zero page errors.

## 1.55.1
- **New: Live Preview now updates live — move a widget, see it change
  in the preview without any manual reload.** This was disabled on
  purpose, for a real reason: closing Live Preview used to just hide
  the iframe rather than destroy it, so a live connection left running
  leaked indefinitely in the background — a real stability problem on
  phone browsers. That root cause was already fixed earlier (closing
  Live Preview now genuinely tears down the iframe's document), which
  is specifically what made it safe to re-enable this. The layout
  live-update mechanism itself already existed and needed no changes —
  the only thing missing was that Live Preview's connection was
  categorically excluded from using it at all.
  - Deliberately selective about what else runs in preview, not a
    blanket "enable everything": the persistent screen check-in loop
    (which registers a real screen entry server-side) and the
    wake-lock timer stay disabled — a throwaway preview snapshot has
    no business registering itself as a real screen or keeping a
    display awake that doesn't exist.
  - Verified with a real server (not simulated calls): confirmed the
    live connection actually opens while previewing, confirmed a real
    layout-change event triggers the actual fetch-and-redraw live with
    zero manual reload involved, confirmed the check-in loop and
    wake-lock stay genuinely off, and — the critical safety check,
    given the whole reason this was disabled in the first place —
    confirmed that closing the preview (exactly the same
    `iframe.src = 'about:blank'` the toggle already used) genuinely
    closes the connection immediately, with real before/after
    connection-count evidence rather than just re-confirming the code
    looks right. Zero page errors across all of it.

## 1.55.0
- **Confirmed: the Shopping List widget was already fully built** —
  found while starting this batch that it already exists end-to-end
  (render function, palette entry, settings panel). No work needed.
- **Fixed: the internal To-Do List widget was never actually near
  Tasks in the widget picker.** The first attempt at this reordered
  the wrong thing entirely — the picker groups widgets by
  `WIDGET_CATEGORIES`, not the flat list I originally touched, which
  has no visual effect on the picker at all. Moved `todo` into the
  real "Tasks" category alongside Tasks and Tasks (Combined), out of
  "Family" where it sat instead.
- **New: sports team search now understands common nicknames.**
  TheSportsDB's own search endpoint — which does the actual matching,
  not something a query tweak on this end can fix — favors something
  closer to prefix/exact matching, so "Packers" alone never surfaced
  "Green Bay Packers" the way searching "Green Bay" did, despite being
  the same team. Added a nickname → full-name lookup table for the
  major leagues (NFL, NBA, MLB, NHL); a recognized nickname now also
  searches the full name alongside whatever the raw query already
  finds, merged and deduped by team id — handles genuinely ambiguous
  nicknames too (searching "Giants" now correctly finds both the NFL
  and MLB team). Also enlarged the search box itself, which was
  cramped. Verified with 8 checks against a mocked API, including
  confirming a full name typed directly still sends exactly one query
  (no redundant duplicate) and that matching results from both the raw
  query and the nickname expansion are correctly deduplicated.
- **New: chore analytics in the Family Hub.** Found the actual
  existing feature under a different name — a parent-facing stats view
  (current streak, 7/30-day completion rate, a 4-week bar chart,
  all-time completed count) that only ever existed in the full app's
  Chores tab, completely absent from the Hub. Ported it over: a new
  📊 History button on each kid's row in the Hub's own Kids list,
  reusing the exact same `/api/kids/:id/stats` endpoint (no backend
  changes needed) with the Hub's own modal styling.
  - Caught and fixed a real bug while testing: the Hub's `api()`
    helper never throws on an HTTP error status, it just returns
    whatever JSON body came back — so a failed request was falling
    through to code expecting real stats data, crashing instead of
    showing an error. Fixed by checking the response shape explicitly
    rather than relying on a catch block that would never fire.
    (Confirmed the full app's own original version of this feature has
    the same latent gap in its own equivalent helper — untouched here,
    since fixing that was out of scope for this specific task, but
    worth knowing about.)
  - Verified with 10 checks: the button appears, the modal opens with
    the correct kid's name, every stat value renders correctly (streak,
    both percentages, all-time count), all 28 daily bars in the chart
    actually render, the close button works, and the fixed error
    handling shows a real message instead of crashing.

## 1.54.7
- **New: the "Control this screen" overlay now shows a QR code next
  to each address** — the LAN address, and the Tailscale one too when
  remote access is set up — not just the plain text. Reuses the exact
  same QR generation the QR code widget already uses (same library,
  same `.qr-container` convention), so it needed no separate code path
  — `renderQRCodes()` picks up the overlay's own QR containers
  automatically. Kept compact (56px) since this is a corner overlay,
  not a full widget; white background behind each code specifically,
  since a dark-on-dark code wouldn't scan reliably against the
  overlay's own translucent dark background.
  - Verified with 10 checks: both addresses present produces two QR
    codes with the exact right URLs; LAN-only produces exactly one;
    no detected address at all produces zero (falling back to the
    existing placeholder text, unchanged); the overlay hiding
    entirely leaves no orphaned QR containers behind; and — using a
    stub of the QR library, since the real one loads from a CDN
    unavailable in this environment — confirming the shared
    `renderQRCodes()` mechanism genuinely generates both codes with
    the correct respective content. Zero page errors.

## 1.54.6
- **Font is now a per-profile setting, not a device-wide one** — moved
  from a single "Default Font" in Settings → Display to a "Font"
  dropdown right on each profile in Layout → Profiles, alongside Force
  Orientation and Rotate View, which already work exactly this way per
  profile. Different profiles on the same device can now genuinely
  have different default fonts, matching how theme itself already
  works. Stored as a real column on the display record (`font_family`,
  mirroring `theme`), not a settings-table entry.
- **Fixed: the font setting had no visible effect at all on the
  Chalkboard theme** — its own CSS used `!important` on six widget
  types (Date, Clock, Mini Calendar, Weather, Upcoming, Agenda) to get
  its handwritten look, which unconditionally beats everything else
  regardless of specificity, including CSS variables and even direct
  per-widget inline styles. Folded Chalkboard's own font preference
  into the same fallback chain every other font rule already uses
  (`per-widget → profile → theme's own default → generic fallback`)
  instead of a separate rule fighting the new system — an explicit
  choice now correctly wins even on this theme, while leaving nothing
  set still defaults to the chalk look exactly as before.
  - Verified with 14 checks: reading from the profile (not the old
    global setting, which is now correctly ignored entirely) and
    correctly getting different results for different profiles;
    Chalkboard's Caveat default preserved with nothing chosen; an
    explicit choice correctly overriding Chalkboard's default (the
    actual reported bug); a per-widget override still winning over
    everything, including an explicit profile-level choice; a
    non-Chalkboard theme staying on the plain generic default with no
    cross-contamination from the theme-specific fallback; the new
    profile-card dropdown actually appearing with a theme-aware
    default label, sending the right API field on change; and
    confirming the old global dropdown is genuinely gone from
    Settings. Zero page errors.

## 1.54.5
- **Fixed (genuinely different this time — three prior attempts on
  this were all looking in the wrong file entirely): "toggle Family
  Hub / Chores / To-Do / Shopping on, and the tab doesn't show up
  live" — this turned out to live in the main app's own Settings
  auto-save, not the separate Hub page at all.** The debounced
  auto-save (checkboxes save ~400ms after being checked) reads form
  field values LAZILY, at the moment it actually fires — so switching
  to a different tab right after checking a box (a completely natural
  thing to do, to go see whether it worked) meant the save ran later
  against a DOM that no longer had Settings' own fields in it at all.
  `collectSettingsBody()`'s defensive `$('x') && ...` guards silently
  treated the now-missing checkbox as unchecked, reverting the very
  change just made; a second, unrelated function further down
  (`saveBriefingFields()`, used no matter which setting triggered the
  save) had no such guards at all and would throw outright, which
  aborted the save before ever reaching the code that updates tab
  visibility — precisely matching "the checkbox is right eventually,
  but the tab never appears."
  - Fixed at the source: switching tabs now flushes any pending
    settings save immediately, synchronously, before the DOM changes —
    so the values it reads are always the ones actually on screen,
    regardless of how quickly someone navigates away. Also hardened
    `saveBriefingFields()` with proper guards on every field (matching
    the pattern already used for some of its own fields, just not
    consistently), so a similar gap elsewhere can't cause the same
    kind of silent failure again.
  - Verified against the exact reported workflow, using real UI clicks
    rather than simulated function calls: check a real checkbox,
    immediately click a different tab (well under the debounce
    window), confirm no crash occurs and the setting saves correctly,
    then navigate back to Settings and confirm BOTH the checkbox and
    the actual tab are correct — not just one or the other. Also
    regression-tested the already-working "stay on the same page"
    flow to confirm it's unaffected.

## 1.54.4
- **New: choose a font, both display-wide and per-widget.** A new
  Default Font setting under Settings → Display applies across every
  widget; any individual widget can also pick its own font in its own
  settings (with a "Use Default" reset), overriding the display-wide
  choice for just that one. Reuses the same 16-font catalog (with
  automatic Google Fonts loading) that already existed but was
  previously wired only into the Text widget.
  - Architecture note: rather than touching every widget's own render
    function individually, this applies at the shared widget-wrapper
    level and lets normal CSS inheritance carry it down — most widgets
    have no font-family rule of their own at all, so they pick it up
    automatically. The one exception found was the Clock widget, which
    hardcodes its own distinct default (Inter, vs. the display's
    overall DM Sans) — given a proper CSS variable fallback chain
    (per-widget → global → Inter) so an unrelated widget's setting
    change doesn't silently alter the clock's look for anyone who
    hasn't touched this feature.
  - The Text widget's existing, separate font picker still wins if
    set, since it applies directly to the text element rather than
    being inherited — no conflict with the new universal picker.
  - Verified with 23 checks: exact baseline behavior preserved when
    nothing is set (no regression for any existing display), the
    global setting correctly cascading to ordinary widgets AND
    overriding the Clock's special default, a per-widget override
    correctly winning over both the global setting and any special
    default, clearing the global setting properly falling back rather
    than leaving a stale value, an invalid font name being safely
    ignored, the real (not simulated) renderLayout() widget loop
    applying an override correctly end-to-end, and the full settings
    UI — the per-widget dropdown, its reset button, and the global
    dropdown's auto-save all confirmed against the actual delegated
    save listener. Zero page errors.

## 1.54.3
- **Fixed: the QR code widget could render corrupted in Live Preview**
  (reported as appearing "cut in half," top and bottom swapped). Found
  the real cause: the QR image/canvas was set to `width/height:100%`,
  but its container had no explicit size of its own — a circular
  sizing dependency (parent sized by its child, child sized as 100% of
  its parent) that browsers can resolve inconsistently under frequent
  relayout, exactly what Live Preview does constantly while editing.
  It happened to render fine on the real, static display, which never
  relayouts anywhere near as often. Fixed by giving the container a
  real, explicit size — removing the ambiguity outright rather than
  working around a specific symptom of it.
- **New: the QR code widget's size is now adjustable** (a Code Size
  slider in the widget's own settings, 80–500px), fixing the same gap
  that made the sizing bug possible in the first place — size was
  previously hardcoded. The QR code's native generation resolution now
  scales proportionally with the chosen display size too (previously a
  fixed 240px, sized for the old fixed 180px display size), so a
  larger code stays sharp and scannable instead of just getting
  stretched and blurry.
  - Verified with 9 checks: the default size matches the old fixed
    180px exactly (no regression for existing widgets), a custom size
    flows correctly through both the CSS and the data attribute the
    generation pass reads, the container now has a real explicit
    computed size instead of an ambiguous one, a canvas of an
    unrelated native resolution correctly scales to fill that
    container without distortion, and — using a stub of the QR
    library, since the real one loads from a CDN unavailable in this
    environment — confirming the native generation size scales exactly
    proportionally with the configured display size rather than
    staying fixed. Zero page errors.

## 1.54.2
- **New: analog option for the Clock widget.** A real clock face —
  hour markers, three hands (the second hand in the accent color),
  smoothly interpolated hour hand (6:30 correctly sits halfway between
  6 and 7, not stuck at the hour mark) — ticking live every second the
  same way the digital clock's text already updates in place, no
  full re-render. Switch it under the widget's own Settings → Style;
  the existing size slider is reused as the face's diameter, so
  swapping styles doesn't reset or need a separate size setting. Time
  Format only applies to Digital and hides itself when Analog is
  selected. Verified with 15 checks: correct structure (face, 12
  markers, 3 hands, center dot), exact hand-angle math for several
  known times including the smooth hour-hand interpolation, live
  per-second rotation updates, and confirming the digital style is
  completely unchanged when the new field is unset (no regression).

## 1.54.1
- **Fixed: applying a Template or a Saved Layout (as a new display) left
  the tab bar showing Layout while the content underneath switched to
  the Devices tab.** Leftover from the earlier Layout/Devices
  restructuring — both spots called `renderDisplaysTab()` to refresh
  after applying, correct back when Templates and Saved Layouts lived
  inside the Devices tab, wrong now that they're their own Layout
  sub-tabs. Now correctly call `renderLayoutTemplatesSubTab()` and
  `renderLayoutSavedSubTab()` respectively. Verified by spying on both
  candidate render functions after applying a template — confirms the
  correct one fires and the old one doesn't.

## 1.54.0
- **New: a popup when two devices are both set up as the "main" one
  for the same license key.** Part of the fix for license keys being
  shareable across unrelated households with no limit at all — the
  mothership now recognizes only one device as a license's host at a
  time; when a second, different device presents the same key as a
  host, this device shows a popup in Settings with three real choices:
  **"Make this device the main one"** (claims host status, replacing
  the other), **"This is a second screen for the same setup"**
  (becomes a genuine Multi-Device slave — finish pointing it at the
  other device's address under Settings → Multi-Device), or **"Keep
  this one on the free trial instead"** (opts this device out of the
  license entirely, running independently). A "Decide later" option is
  also there — dismissing doesn't call anything server-side, so
  nothing gets silently decided just because the popup showed up at an
  inconvenient moment. This device now also reports its host/slave
  role on every check-in, which the mothership needs to actually tell
  the difference between a household's own multiple screens and
  separate households sharing a key.
  - Verified with 13 checks: the modal correctly shows/stays hidden
    based on whether a real conflict is present, handles malformed
    cache data without crashing, all three resolution actions send the
    right request and update local state correctly afterward, the
    slave path's Multi-Device follow-up guidance actually shows, the
    dismiss button explicitly does NOT call the server, and a server
    error keeps the modal open with a visible error and re-enabled
    buttons rather than silently vanishing as if it had succeeded.

## 1.53.2
- **Fixed (for real this time): Family Hub feature toggles didn't show
  a new tab live** — two earlier attempts at this missed the actual
  cause. The real one: the server broadcasts a `'settings'` topic over
  SSE on every settings change, from anywhere — the full app's
  Settings, another device syncing, the Hub itself — but the Hub's own
  live-update listener had no handler for that topic at all, so an
  already-open Hub tab had no way to know settings had changed
  somewhere else. A checkbox toggled from the Hub's own settings panel
  already updated its own tab live (that part always worked); this is
  specifically what covers every other case — the full app enables a
  feature while the Hub is already open elsewhere. Verified against a
  real SSE event (not a direct function call) reproducing the exact
  reported scenario: Hub already open, a settings change happens
  elsewhere, tab appears with no reload at all. Also regression-tested
  the existing toggle-from-Hub-panel flow to confirm the shared-logic
  refactor behind this didn't disturb it. 3 checks, zero page errors.

## 1.53.1
- **Fixed: turning Animation Density to "Off" in Screen Settings didn't
  actually stop the animation.** Classic JavaScript falsy-value bug:
  `parseFloat(fxDensity) || 1` treats an explicit `0` exactly the same
  as "nothing was set," silently falling back to the default (full)
  density — so "Off" quietly did nothing. Fixed to check for `NaN`
  specifically, the correct signal for "nothing valid was set," and
  let a real `0` survive as `0`. Verified with a real theme applying
  particle effects: density Off now genuinely spawns zero particles
  (immediately and after a delay, so no interval-based spawn sneaks
  through either), default density is unaffected, and the in-between
  "Occasional" setting still correctly scales down from default —
  confirming both the bug and the fix precisely, not just that the
  code runs. 5 checks, zero page errors.

## 1.53.0
- **New: Version & License now shows your actual account status** — a
  friendly label (Active / Payment Past Due / Canceled / No License —
  Free Trial), an expiration or renewal date when there is one, and a
  link back to the site to manage the license when the
  account isn't active. All of it was already sitting in settings the
  app already fetches; this just surfaces it instead of leaving it
  invisible until something (like a widget limit) broke because of it.
  Verified across every status type — active, trial, past-due,
  canceled, never-checked-in, and no-expiry-set — 14 checks.
- **Fixed: Fine-Tune Position and Live Preview didn't reflect a
  screen's rotation.** A profile set to rotate 90° still showed a
  flat, landscape-shaped preview in both places — confirmed real bugs
  in both. Live Preview's underlying scale calculation now swaps its
  reference frame's width/height for a 90°/270° rotation, the same way
  the real (non-preview) display already does for an actual rotated
  screen. Fine-Tune Position's own viewport used to be a fixed 190px
  box regardless of orientation; it now dynamically matches the
  profile's actual shape (orientation and rotation both), capped at a
  sensible max height so a portrait shape doesn't stretch absurdly
  tall on a narrow panel. 12 checks across both fixes, including
  confirming the aspect ratio correctly inverts for a real rotation
  and stays put when there's none.
- **New: expand and delete buttons live right in the widget settings
  panel now**, not just the layer list below — next to the widget's
  own name and Layer position, e.g. "🚗 Travel Time [expand][delete]
  Layer: 9 of 9." For a widget that's gotten too small to grab its own
  handles on the canvas, this puts the fix right in front of you
  instead of requiring a scroll down to the layer list. Same
  center-anchored 10%-per-click growth as the layer list's version.
  6 checks, including confirming the delete button correctly clears
  the panel afterward.
- **Fixed: two real caching bugs behind "Family Hub toggles a feature
  on but no new tab appears."** The first attempt at this (a missing
  `Cache-Control` header on the settings endpoint) turned out to be
  the wrong diagnosis — confirmed via a genuinely unmocked test (a
  real server, real network requests, no route interception) that the
  actual toggle logic was already correct. The real cause: the Hub's
  service worker cached `/hub` itself with a stale-while-revalidate
  strategy, which always answers the CURRENT load from whatever's
  already cached and only fetches fresh content in the background for
  next time — so a device that had ever cached an old, buggy version
  kept serving that exact version forever, regardless of how many
  times the app itself got updated server-side. Especially bad given
  the Hub is meant to be installed as a home-screen PWA, which rarely
  gets the kind of hard refresh that would otherwise paper over this.
  Static assets (icons, manifest) stay cache-first; `/hub` and `/kids`
  — the actively-changing app pages — are now network-first, falling
  back to cache only when genuinely offline.
- **Fixed: the Backup info popup was stale**, still describing the old
  download-only process with no in-app restore — the in-app restore
  shipped back in v1.50.0 and this was never updated to match. Swept
  all 21 info popups in the app for similar staleness; found no others.
- **Fixed: two more spots where text sat right against the edge of its
  box** — the bottom of the Multi-Device section, and the Family Hub
  callout in the To-Do tab.

## 1.52.0
- **Fixed: entering a new license key didn't seem to take effect** —
  saving it worked fine, but whether the account was on trial (and any
  limits tied to that, like the widget-count block) was driven by a
  cache only refreshed by a scheduled check-in — first run ~90s after
  boot, then every 6 hours. Nothing re-checked that cache when the key
  itself changed, so a genuinely-upgraded account could still hit the
  old trial limit for hours afterward with no indication why. Saving a
  key now triggers an immediate refresh instead of waiting.
- **Fixed: adding a Family Hub feature (Chores/To-Do/Shopping) from
  the Hub's own settings checked the box but the tab didn't actually
  appear** until toggling it again. Root cause: the settings endpoint
  had no cache-control header, so the browser could legally serve a
  cached pre-write response to the very next read — which is exactly
  what decides tab visibility. Added `Cache-Control: no-store`
  server-side and `cache: 'no-store'` on the client fetch.
- **New: Layout editor — expand and delete buttons on the selected
  widget's layer row.** For when a widget gets resized down so small
  its own on-canvas handles and delete button become impossible to
  grab. Expand grows it 10% per click, anchored on its current center
  so it grows in place rather than shifting position. Found and fixed
  a real bug while building this: the button was conditionally
  rendered based on selection, but selecting a widget only does a
  lightweight class-toggle on the existing row, not a full re-render —
  so the button would never have actually appeared on a real click.
  Fixed by always rendering it and controlling visibility with CSS
  keyed off the same class the selection logic already toggles.
- **New: Devices → Screen Settings' Display / Ambient Mode / TV
  Control are now their own collapsible sub-sections**, nested inside
  the existing Screen Settings accordion, instead of all showing at
  once whenever it's open. Caught and fixed a real HTML nesting bug
  while restructuring this — traced a dropped closing tag by hand and
  confirmed the fix with a raw tag-count across the whole function.
- **Fixed: the Live Preview overlay in the Layout editor** was showing
  the "control this screen" address card at full TV-sized proportions
  inside a small preview frame. Suppressed it specifically in preview
  mode, the same way it's already suppressed on a blanked screen.
- **Settings tab consolidated from 16 sections down to 6** — Display,
  Photo Widget Defaults, and Custom Theme now live under "Display &
  Appearance"; Weather, Travel Time, News, Stocks, and Todoist under
  a new "Data Sources" group; Calendar Sync, Version & License,
  Multi-Device, Daily Briefing, Feedback & Ideas, and Backup under
  "Advanced." Features & Family Hub and Security stay standalone.
  Also fixed a stale reference from the "Software Update" → "Version &
  License" rename a few versions back — it had silently fallen out of
  the Advanced group and become its own orphaned top-level item.
- All of the above verified with real interaction tests (not just
  reading the code) — clicking through actual selection, toggling,
  and expand/collapse flows in a real browser, not just checking that
  functions exist. 49 checks total across this batch, zero page
  errors.

## 1.51.0
- **Layout tab restructured into 4 sub-tabs: Editor, Profiles, Templates,
  Saved Layouts.** Profiles/Templates/Saved Layouts used to live in a
  "Layouts & profiles" accordion buried in the Devices tab — they
  aren't really devices, just the tooling for what a device can show,
  so they now live where they conceptually belong. The Devices tab
  goes back to being purely about hardware: the physical screens list
  and which profile each one is currently showing. Clicking a
  profile's edit-layout button now jumps straight to the Editor
  sub-tab with that profile preselected, rather than switching tabs
  entirely. Also: "Auto (detect)" and "0° (normal)" renamed to "Use
  Screen Settings" for Force Orientation and Rotate View — clearer
  that these are overrides on top of a screen-level default, not some
  separate auto-detection behavior. "Editing Display" renamed to
  "Editing Layout" (that's what you're actually doing there), and
  removed a now-inaccurate line about managing profiles in the
  Displays tab, since they're not there anymore.
  - The riskiest single piece of this — `drawEditor()`'s canvas
    rendering — turned out to write to exactly one container in exactly
    one place, so redirecting it to a nested sub-tab container was a
    contained, low-risk change; nothing about the actual drag/resize
    editor logic itself was touched.
  - Verified with 15 checks: all 4 sub-tabs present in the right order
    with Editor active by default, the editor genuinely renders inside
    the new container (not just that the container exists), Profiles
    and Editor content don't leak into each other, the profile→editor
    jump correctly preselects the right profile, Templates and Saved
    Layouts render their containers, and the Devices tab is confirmed
    trimmed down to just the screens list. Plus 3 more checks
    confirming profile rename and add still work correctly from their
    new home (renaming triggered a fresh fetch through the *new*
    function, not the old one that no longer renders profiles at all —
    exactly the kind of stale-reference bug this refactor could have
    quietly introduced). Zero page errors throughout.

- **New: an optional theme-picker step in first-run setup**, so a
  fresh install can look like something other than the plain default
  from the very first boot instead of only after someone finds the
  theme picker later. Reuses the same theme swatches already used
  elsewhere in the app. Deliberately does not create a new profile to
  apply it (the endpoint that does that always inserts a new display
  row, and a fresh install already auto-seeds one — calling it here
  would've left that orphaned) — instead updates the auto-seeded
  "Main Display" in place. Caught a real bug while testing this: the
  first version referenced a constant by the wrong name entirely,
  which would have silently rendered an empty theme grid — fixed
  before it ever shipped. 12 checks on the main flow, plus 5 more
  confirming the slave setup path is completely unaffected and that
  skipping the theme step sends no unnecessary request.

- **New: Family Hub has its own Chores/To-Do/Shopping toggles.** A
  settings gear button (always reachable, even if every feature is
  currently off — it's the one way back from that state) opens a
  panel to turn each one on or off right from the Hub. These write to
  the exact same shared settings the full app's Settings → Features
  toggles use, so a change made in either place is automatically
  reflected in the other — no separate sync step. Tab visibility
  updates live, and turning off the tab you're currently looking at
  correctly falls back to a different enabled one. 9 checks, zero
  page errors.

- **Fixed: two more spots where text was getting clipped by the
  rounded box around it** — Photo Widget Defaults, and the Kids
  section of the Chores tab (this one had zero padding on the card at
  all, with raw text sitting directly against the rounded corners —
  the most severe instance of this bug found yet). Did a full sweep
  afterward and found no further instances of the same pattern.

## 1.50.0
- **New: restore a backup from inside the app** — previously the only
  restore path was SSH in and manually replace files by hand, despite
  the Backup section only ever offering a *download*. Now Settings →
  Backup has a matching upload flow: pick a `.zip` (from this device or
  another Piazza HQ install), confirm — the warning is explicit that
  this replaces everything currently on the device — and it validates,
  safety-backs-up the current data, swaps in the restored data, and
  restarts, using the exact same validate → back up → swap → restart
  pattern already trusted for code updates, just applied to data.
  Tolerates both this app's own nested backup folder format and a flat
  zip someone reassembled themselves. Rejects anything that isn't
  actually a valid backup (missing or non-SQLite database) before
  touching anything live, and always keeps one safety copy of what was
  live immediately before a restore, so a bad restore can be undone by
  hand over SSH even without any in-app rollback.
  - Verified thoroughly: the exact validation logic run against real
    zip files (real `unzip`, real filesystem checks, real byte-level
    SQLite header validation) — a real nested backup, a real flat one,
    one missing `calendar.db` entirely, and one with a `calendar.db`
    that isn't actually SQLite — all classified correctly, 6 checks.
    Separately verified the UI: the restore button stays hidden until
    a file is actually chosen, the confirmation is shown and is
    appropriately explicit about the consequences, upload only fires
    after confirming (never on cancel — checked both directions), and
    the success message appears correctly. Zero page errors throughout.

- **Settings cleanup, several real fixes at once:**
  - **Text getting clipped by the box above it** on 6 specific Settings
    sections (Backup, Travel Time, Family Hub, Custom Theme, News,
    Multi-Device) — root cause: `.settings-card` has no default
    padding at all (most cards look fine because their content is
    entirely `.settings-row` children, which supply their own), but
    these 6 had a description paragraph sitting directly in the
    card — a couple with an actual *negative* top margin, pulling the
    text further up into the rounded corner. Fixed by giving each
    paragraph its own top padding directly, rather than changing the
    shared card class (which would have thrown off spacing everywhere
    else that already looks correct).
  - **Features and Family Hub combined** into one "Features & Family
    Hub" section, making the connection between them explicit — a
    feature switched off is now clearly documented as also being
    hidden from the Hub, not just the full app.
  - **`/hub` now actually hides a tab whose feature is switched off**,
    which it never did before — enabling a feature toggle without a
    matching visibility change on the one surface most likely to be
    used standalone. Falls back to a different enabled tab if the
    remembered/default one is now disabled, and shows a plain
    explanatory message rather than a blank or broken-looking screen
    if literally nothing is enabled. Verified 4 realistic scenarios
    (all on, the real defaults, a stale remembered tab that's now
    disabled, and nothing enabled at all) — 6 checks, zero page errors.
  - **"Software Update" renamed to "Version & License"** — accurate to
    what's actually there (version display + license key); the old
    name implied a manual update process that no longer exists there.
  - **Calendar tab: clicking a sub-tab could leave the page scrolled
    past the top**, hiding the very sub-tab bar you just clicked, until
    scrolled back up manually. Root cause: switching sub-tabs rebuilds
    the content area's HTML, but the scroll position carries over from
    before the click — if you'd been scrolled down, the new content
    opened at that same offset. Caught and fixed a related bug while
    testing this: the fix initially reset scroll too early, before the
    async re-render (and Events' own internal "scroll to today"
    behavior) had actually finished, so it kept getting silently
    overwritten — verified with a real scroll-position check, not just
    that the code runs. Also swapped the sub-tab button order so
    Calendar Feeds sits to the left of Events, matching Feeds also
    being the default. 6 checks, zero page errors.

## 1.49.0
- **Fixed: the Family Hub settings card's Copy Link button didn't work.**
  Root cause: `navigator.clipboard.writeText()` requires a secure
  context (HTTPS or localhost) — Piazza HQ is virtually always reached
  over plain HTTP (a LAN IP or a Tailscale IP, never TLS), so
  `navigator.clipboard` is simply undefined in real-world use here, not
  occasionally unavailable. Added a fallback to the older
  `execCommand('copy')` technique (via a temporary, invisible, selected
  textarea), which has no such secure-context restriction. Verified
  both paths against the real code: the actual real-world case
  (`navigator.clipboard` undefined, matching plain-HTTP deployment)
  correctly falls back and the fallback genuinely copies via
  `execCommand`, with no leftover temporary element in the DOM
  afterward; and separately confirmed the modern API is still used
  directly (no unnecessary fallback) on the rare setups where it's
  actually available.
- **New: Family Hub's Chores tab is now a parent management view, not
  the kid-facing check-off view.** Previously it just embedded `/kids`
  — useful for a kid's own tablet, but not what a parent reaching for
  the Hub wants. Now built natively into the Hub (not an iframe):
  Today's Chores with reassignment, a Kids list with full add/edit/
  delete (name, avatar, color, chore-list display style, allowance
  settings and savings goal), and a Chores list with full add/edit/
  delete (title, icon, who it's assigned to, frequency — daily/certain
  days of the week/once — time, carryover, celebration, pay, photo-
  required, and the bonus/shared-pool option). `/kids` itself is
  completely unchanged and still the right choice for a kid's own
  tablet — this only changes what the Hub itself shows.
  - Found and fixed a real bug while building this: the Hub's default
    active tab (Chores) triggers its data-load function immediately on
    page load, but that call was happening before several things it
    depends on (`api`, and the new Chores state) had actually finished
    being declared elsewhere in the script — a "cannot access before
    initialization" error on first load, every time. This exact bug
    was latent even before today's change (calling the default tab's
    load function too early), it just never surfaced before because
    the old iframe-based Chores tab had nothing to load. Fixed by
    moving the initial tab-activation to the true end of the script,
    after everything it could possibly depend on is declared.
  - Verified with 27 checks against the real code and real (mocked)
    API responses: both kids and chores load and render correctly on
    open; adding, editing, and deleting a kid all send the correct
    request with correct field values, including allowance settings
    and the fields correctly showing/hiding as the allowance toggle
    changes; adding a chore correctly builds its assignee list from the
    "Everyone" vs. specific-kid chip selection (including "picking a
    specific kid deselects Everyone" and vice versa), the weekly-day
    picker only appears for weekly frequency, and the Bonus toggle
    hides the normal assignment/schedule fields; editing an existing
    chore correctly reconstructs its chip selections from the saved
    comma-separated data; and Today's Chores reassignment sends the
    correct instance id and new kid id. Zero page errors throughout.
    Also visually confirmed via screenshot.

## 1.48.1
- **Fixed three real bugs in the Flightdeck theme's TCAS simulation:**
  - **Contacts stuttering (fast, then stopped, then slow again)**: the
    glide between positions was a CSS transition hardcoded to exactly
    1.6s, tied to a `setInterval` that doesn't fire at a jitter-free
    1600ms — if the main thread was briefly busy with anything else, a
    tick could fire late, by which point the previous fixed-duration
    transition had already finished, leaving the contact motionless
    until the late tick arrived. The glide duration now tracks the
    actual elapsed time since the last tick instead of a fixed value.
    Also fixed the same root issue's other symptom: a contact
    respawning (flying back in from the edge) used to visibly glide
    there over 1.6s, looking like it suddenly flew across the whole
    display at high speed — it now snaps instantly to its new spawn
    position instead, since it's a new contact "appearing," not the
    same one moving.
  - **Missing altitude tags**: every contact now shows its altitude,
    not just ones already close enough to be Proximate/TA/RA traffic —
    real TCAS traffic symbols always carry an altitude tag.
  - **Close contacts not triggering a TA or RA**: the old logic
    required a negative "closure rate" on top of being within range
    and co-altitude — but a contact on a grazing/tangential path can be
    genuinely very close at the exact sampled instant while its closure
    rate reads near zero (right around its closest point of approach,
    where closure rate crosses zero by definition), so a real close
    pass could sample as "not closing" and never alert. TA/RA now
    trigger on range + altitude alone.
  - Verified: an isolated test of the exact state-decision algorithm
    (20 checks) confirms close+co-altitude always alerts regardless of
    closure rate, and that altitude tags are always present and
    correctly formatted; a live browser test running the real code
    (not a stand-in) confirms contacts spawn, altitude tags are never
    empty across multiple real tick cycles, and precisely confirmed the
    glide duration is clamped sanely on the very first tick then
    correctly tracks ~1.6s on real subsequent `setInterval` ticks.
- **Fixed: text getting clipped at the corners of some rounded boxes**
  (a global issue, not specific to one theme). Root cause: several
  rounded-corner boxes had padding smaller than — or not scaling
  together with — their border-radius, most severely at smaller UI
  scale settings, where a fixed-pixel border-radius stayed the same
  size while scaled padding shrank around it. Fixed the Flightdeck
  METAR panel, the Home Hub chore chart panel, the general per-widget
  translucent tile background (used by any widget with the "tile"
  background option on), and the weather forecast-day boxes — all four
  now keep padding at or above their border-radius at any UI scale,
  with a little extra margin added on top for safety. Verified by
  computed style, not just the source values: rendered each one at
  three different UI scales (0.5, 1, 1.5) and confirmed padding stays
  greater than or equal to border-radius in every case, 12 checks, zero
  page errors.

## 1.48.0
- **Fixed: a newly-added widget could get stuck on "Loading…" until the
  display was switched to another layout and back.** Root cause: the
  live-update handler for layout changes only re-fetched data for 4
  widget types (Tasks, News, Stocks, plus the layout itself) — around
  10 others (Shopping List, Air Quality, Travel Time, Chore
  Leaderboard, Chore Chart, On This Day, Daily Quote, Sports, METAR,
  weather-family widgets) were never covered, so a widget of one of
  those types added to an already-running display would render its
  placeholder and just... stay there, since nothing ever triggered its
  first fetch. Switching layouts happened to trigger a full re-fetch as
  a side effect, which is why that "fixed" it. Now the layout handler
  calls the same complete fetch set the boot sequence already uses —
  every widget-data function already no-ops on its own if that widget
  type isn't present, so calling the full set unconditionally is cheap
  and safe. Verified against the real code path: intercepted the
  actual `EventSource` the page creates (not a stand-in), fired a real
  synthetic "layout changed" message through the real handler, and
  confirmed three previously-uncovered widget types (Shopping List,
  Chore Chart, Air Quality) both fetch their data and render it — not
  just that the right URLs got called.
- **Changed: Calendar Feeds is now the default sub-tab under Calendar**
  (previously Events), and the sub-tab bar now renders above the
  Getting Started checklist card instead of below it — both sub-tabs
  are visible right at the top the moment the tab loads, rather than
  the tab bar being easy to miss underneath a potentially-tall
  checklist card. Verified: Calendar Feeds active and rendered by
  default, the sub-tab bar is literally the first element in the
  content area, both buttons are present, and switching to Events
  still works exactly as before.

## 1.47.4
- **Fixed: the kiosk keyboard shortcut is now Ctrl+Alt+K, not Super+K.**
  Found via real hardware testing: the Raspberry Pi desktop panel grabs
  the Super key by itself as a "tap to open the Pi menu" gesture,
  independent of whatever else is pressed with it — so Super+K arrived
  as two separate events (the menu opening, then K landing a beat
  later as a search keystroke inside it) rather than reaching the
  window manager as one combined shortcut. This conflict could only
  ever surface once the desktop panel was actually running to grab
  that key — i.e., only after the black-screen fix in 1.47.2 restored
  it, which is why it wasn't visible until now.
  - `install.sh` now binds Ctrl+Alt+K instead. Critically, an already-
    affected install (like the one this was found on, which already
    had the old Super+K binding from a previous run) gets the new
    Ctrl+Alt+K binding added *alongside* the old one on a re-run, not
    silently skipped — the idempotency check now matches on the
    specific key combo being added, not just "does a kiosk-toggle
    binding exist somewhere in this file" (which would have falsely
    looked "already done" and skipped adding the new one).
  - README's manual fallback instructions and `pi-calendar-server`'s
    troubleshooting page both updated to match — the troubleshooting
    page previously said "there's no keyboard shortcut for this, on
    purpose," which was accurate when it was written but had gone
    stale once the automatic binding was added in 1.46.2.
  - Verified: fed the exact real-world case (a file already containing
    the old Super+K binding) through the actual updated function,
    confirmed the new Ctrl+Alt+K binding gets added while the old one
    is preserved untouched, confirmed a second run doesn't duplicate
    anything, and confirmed the fresh-install case (no existing binding
    at all) still works. 3 scenarios, all passing.

## 1.47.3
- **Polish: "Remote access" is now a clear label above the Tailscale
  URL on the first-run splash screen**, not a small tag stuck right
  after it — the trailing tag could read as if it were part of the
  address itself at a glance. Same restructuring on both the label and
  the underlying markup, not just a spacing tweak, so it can't
  ambiguously blend in regardless of screen size or theme.
  - Verified: URL text now contains only the URL (no label text mixed
    in), the label reads "Remote access" as its own separate element,
    and everything else about the section (hiding cleanly with no
    Tailscale address, the overlay disappearing once setup is
    complete, the "not detected yet" fallback) still works. 10 checks,
    zero page errors. Visually confirmed via screenshot.

## 1.47.2
- **Fixed: `kiosk off` (and Super+K) left a black screen with no usable
  desktop**, even though it was actually working correctly underneath.
  Two separate real bugs, both found via real hardware output:
  - **Cursor kept re-hiding itself.** `kiosk off` tries to kill the
    cursor-hider with `pkill -x unclutter-xfixes` — but Linux truncates
    process names to 15 characters, and `unclutter-xfixes` is 16, so
    the exact-match search for the untruncated name never matched the
    truncated process, and it just kept running. Switched to `pkill -f`
    (matches the full command line, which isn't truncated) instead.
    Reproduced the exact failure against a real process before fixing
    it, then confirmed the fix actually kills it.
  - **No desktop to show at all.** `install.sh` was creating a personal
    LXSession autostart file containing only the kiosk-specific lines
    (xset settings, cursor-hider, the Chromium launch) — but a personal
    `~/.config/lxsession/<name>/autostart`, once it exists, is used
    INSTEAD OF the system-wide default, not merged with it, and that
    system default is where `@lxpanel` and `@pcmanfm --desktop`
    normally live. The result: closing Chromium correctly left nothing
    else running to paint a wallpaper or taskbar — a plain black root
    window, which looked exactly like "still stuck in kiosk mode" even
    though the kiosk itself was genuinely off.
  - Fixed by merging in any system-default autostart lines that are
    missing from the personal file, using the same idempotent
    line-by-line mechanism this script already uses everywhere else —
    deliberately NOT a one-time "only if the file doesn't exist yet"
    fix, since that wouldn't have repaired an install that already hit
    this bug (like the one this was diagnosed on) — only prevented new
    ones. Re-running `install.sh` now repairs an already-affected
    install in place.
  - Verified against the exact real-world case: fed the real broken
    autostart content (captured directly from an affected Pi) and a
    representative system-default file through the actual merge logic,
    confirmed the missing `@lxpanel`/`@pcmanfm --desktop` lines get
    added while every existing line is preserved untouched, confirmed
    a second run doesn't duplicate anything, and confirmed the
    no-system-default-available case degrades gracefully rather than
    crashing. 4 scenarios, all passing.

## 1.47.1
- **New: the "Let's get set up" first-run splash screen now also shows
  the Tailscale address**, not just the local one. This is the actual
  screen a brand-new Pi shows before `setup_complete` — different from
  the boot info-overlay added in 1.47.0, which only appears on an
  already-set-up display. Same underlying address data, shown as a
  smaller secondary line tagged "remote" below the primary local
  address, so it doesn't compete with it for attention. Hides itself
  cleanly if no Tailscale address is available, same as it already did
  when no local address was detected yet.
  - Verified: both lines show correctly when both addresses are known,
    the Tailscale line hides cleanly (no broken layout) when it isn't
    available, the whole overlay still hides correctly once setup is
    actually complete, and the existing "address not detected yet"
    fallback still works when nothing is known at all. 10 checks, zero
    page errors. Also visually confirmed via screenshot — correct
    hierarchy, readable, matches the screen's existing style.

## 1.47.0
- **New: the control-URL overlay (local + Tailscale addresses) now shows
  automatically for 45 seconds after a fresh boot**, even without
  anyone configuring it first. This overlay already existed — a
  per-display "Info Corner" setting that shows a persistent corner
  badge with both addresses — but it defaulted to hidden and required
  knowing to go find that setting. A brand-new Pi is now discoverable
  the moment it boots, with zero configuration.
  - If a persistent corner IS already configured, this changes nothing
    — the overlay just shows normally, permanently, like before.
  - Careful about *when* this fires: the underlying config-check this
    hooks into runs repeatedly for the display's entire lifetime (every
    periodic re-check, every live-update push, every reconnect after a
    network drop) — the auto-show-then-hide behavior needed to trigger
    exactly once per page load, not re-appear every time that function
    happens to run again hours later.
  - Also handles the case where someone configures a persistent corner
    *while* the temporary boot overlay is still showing — the original
    45-second timer doesn't fight that choice when it later fires; it
    checks the current configured state fresh rather than trusting
    stale data from when it was set.
  - Verified with Playwright, including that specific race condition:
    15 checks covering the no-configuration boot flow (auto-show,
    correct URLs, Tailscale line tagged "remote", auto-hide once the
    window elapses), confirming it does NOT re-trigger on a later
    periodic re-check, confirming a from-the-start persistent
    configuration skips the boot-timer machinery entirely, and the
    live-reconfiguration-mid-window race surviving correctly. Zero page
    errors.

## 1.46.4
- **Fixed: the automatic Super+K shortcut (1.46.2) silently failed on
  current Raspberry Pi OS images.** Found via real hardware testing —
  a genuinely different install than assumed, not a hypothetical: the
  openbox config file it's actually named `rpd-rc.xml` ("Raspberry Pi
  Desktop") on current images, not `lxde-pi-rc.xml` as originally
  assumed from older documentation. Since that exact file didn't
  exist yet and neither did the system-default path being seeded from,
  the step failed with a warning and moved on — correctly, per its own
  design, but on the wrong assumption.
  - Rather than swap one hardcoded guess for another (bound to break
    again on some other image), this now resolves the real filename
    dynamically: if openbox is already running (the normal case), its
    own `--config-file` argument is the single most authoritative
    answer for that exact system — read directly rather than guessed.
    Falls back to checking which system-wide default under
    `/etc/xdg/openbox/` actually exists if openbox isn't running yet,
    trying both known naming conventions before finally guessing the
    current one as a last resort.
  - Verified against the exact real-world case: extracted `rpd-rc.xml`
    correctly from a `pgrep -a openbox` output byte-for-byte matching
    what a real affected Pi reported, confirmed the older
    `lxde-pi-rc.xml` naming still resolves correctly for anyone on an
    older image, confirmed the last-resort fallback when neither can
    be determined, and ran the full resolve → seed → insert pipeline
    end-to-end reproducing the exact diagnosed scenario, resulting in
    the binding landing in the file it's actually running from — not
    just a syntax check.
  - Also fixed a genuine bug caught mid-edit while doing this: an
    earlier version of this same fix briefly merged two adjacent lines
    together (`fi` and the following `echo` with no line break between
    them) during a bad find-and-replace — caught immediately by
    re-viewing the file before moving on, not shipped.
  - README's manual fallback instructions updated to mention both
    filenames and how to check which one applies to you.

## 1.46.3
- **New: `install.sh` now enables SSH automatically**, as its very first
  step — before anything else that could fail or need attention. The
  installer previously assumed SSH was already on (the normal flow is
  to SSH in and run it from there), which left no way back in for
  anyone who ran it at the Pi directly with a monitor/keyboard instead.
  - Idempotent: skips entirely if SSH is already enabled, whichever way
    that happened (a previous run of this script, Raspberry Pi
    Imager's advanced options at flash time, or by hand).
  - Prefers `raspi-config nonint do_ssh 0` (keeps it in sync with the
    Pi's own settings UI), falls back to `systemctl enable --now ssh`
    directly if `raspi-config` isn't available or its call fails, and
    warns with the exact manual command as a last resort — never
    silently fails.
  - Verified this can't abort the rest of the install if it fails: this
    script runs under `set -euo pipefail`, so a naive implementation
    could take the whole installer down over something as minor as SSH
    already being in a weird state. Tested the exact function against
    5 scenarios including the "everything fails" case, confirming it
    warns and lets the script continue in every case rather than
    exiting early.

## 1.46.2
- **New: automatic Super+K keyboard shortcut for `kiosk toggle`.** This
  already existed as a manual "Tip" in the README (add some XML to
  `~/.config/labwc/rc.xml` yourself) — the installer now does it for
  you. Binds in whichever window manager's config is relevant (labwc
  for Wayland, openbox for X11 — writes both regardless of the
  currently-detected session, matching the same reasoning the autostart
  step already uses: this Pi might switch to X11 later in the very same
  run, and both should be ready for the one reboot at the end either
  way). Idempotent — safe on every install/update, won't duplicate the
  binding on a re-run.
  - Verified the two window managers actually need different XML, not
    assumed: openbox requires the command as a nested `<command>`
    element, while labwc is more lenient and also accepts it as an
    attribute (confirmed via labwc's own docs — it parses rc.xml in an
    "element/attribute agnostic" way) — used the correct schema for
    each rather than copy-pasting one to both.
  - Tested the exact, verbatim install.sh function (not a paraphrase)
    against 5 real scenarios with real files: seeding from the system
    default when no personal config exists yet, inserting into an
    existing config, idempotent re-run (no duplicate), a config with no
    `<keyboard>` section (must skip cleanly, not corrupt the file), and
    neither a personal config nor a system default being present (must
    fail gracefully, not crash). All 5 passed.
  - README updated to describe this as automatic, keeping the manual
    XML as a documented fallback for anyone on an older install.

## 1.46.1
- **Fixed: a real install could look like "Tailscale only gave a local
  IP" with no explanation why.** Root cause: the final install summary
  only ever printed the remote (Tailscale) address if it was available
  at that exact instant — if `sudo tailscale up`'s login step hadn't
  been completed yet (easy to miss — it's an interactive browser
  approval step), or if the IP simply hadn't propagated yet, the line
  just silently didn't appear. Nothing said why; it just looked like
  Tailscale had only ever handed out a LAN address.
  - The install summary and `setup-remote-access.sh`'s summary both now
    ALWAYS show a "Control app (remote)" / "Remote (Tailscale)" line,
    in one of three states rather than sometimes not at all: a real
    address, "not set up yet" with the exact command to run, or
    "installed but not connected" with the exact commands to check and
    fix it.
  - `setup-remote-access.sh` also now polls for up to 5 seconds after
    `tailscale up` returns before giving up — the IP can take a moment
    to actually propagate even on a fully successful connection, which
    was the single biggest cause of a real, working setup still hitting
    this.
  - `setup-remote-access.sh --status` now shows the local LAN URL
    alongside the Tailscale one, not just Tailscale's.
  - Verified against the real, exact script logic (not a paraphrase) in
    isolated harnesses with a mocked `tailscale` command: all three
    install-summary states render correctly, the propagation-delay
    retry loop genuinely catches a delayed IP (tested with a mock that
    stays empty for 2 calls then returns one on the 3rd) rather than
    just having a retry loop that never gets exercised, the "never
    propagates" case surfaces a clear message instead of hanging or
    silently failing, and `--status` shows both URLs.

## 1.46.0
- **Theme-aware widget sweep complete** (increment 3, final) — Moon
  Phase and Daily Quote were the last two widget types with no
  theme-colored element at all.
  - **Moon Phase**: the phase name ("Waxing Gibbous," etc.) now takes
    the theme's accent color — the widget's clear headline, so it gets
    the same treatment as every other widget's header/label.
  - **Daily Quote**: rather than bolting on a header that doesn't fit
    its intentionally minimal quote-card design (no widget on this one
    has ever had a section label), the big opening quotation mark now
    takes the theme's accent color instead of a flat muted gray —
    matches the sweep's spirit without fighting the widget's own
    aesthetic. Bumped its opacity from 0.5 to 0.7 so it reads clearly
    as a colored accent rather than washing out.
  - With this, every widget type (except the user-uploaded Custom
    theme, unchanged by design) now has at least one theme-responsive
    element. Verified live across 4 themes spanning very different
    palettes (July 4th, Home Hub, Minimal, Chalkboard) — 12 checks,
    plus confirmed neither widget's other content (illumination %,
    lunar cycle day, quote text, author) was disturbed. Zero page
    errors, CSS brace-balance and JS syntax both clean.

## 1.45.1
- **Cleanup: deduplicated the calendar widget's per-theme colors onto
  `--accent`** (increment 2 of the theme sweep) — 17 themes had their
  calendar header color hand-written as a literal hex value that
  happened to exactly equal the `--accent` I set for that theme last
  time; now they reference `var(--accent)` instead, so there's one
  source of truth instead of two copies that could quietly drift apart
  later. Same for Minimalfam's text widget. Zero visual change by
  design — verified by comparing the live computed color against the
  original hex for all 17 themes plus Minimalfam, confirmed identical
  down to the pixel, plus confirmed Chalkboard's clock/date still use
  their handwriting font correctly (untouched, unaffected by this).
  - Deliberately did NOT touch: Chalkboard's clock/date/weather/
    upcoming/agenda color (currently inherits `--text`, a different,
    intentionally-separate variable — recoloring it to `--accent` would
    be a real behavior change if the two ever diverge later, not a true
    duplicate-cleanup); Post-it, Easter, and Corkboard's text-widget
    colors (confirmed last round to be deliberately different, muted
    body-text tones, not accidental duplicates of the accent) —
    verified this round that those three are still exactly their
    original, un-migrated colors, not accidentally swept up.

## 1.45.0
- **New: theme-aware widget headers (increment 1 of an ongoing sweep).**
  Previously, picking a theme only changed the wallpaper and the
  calendar widget's accent — every other widget looked identical
  regardless of theme. First step towards full coverage across all 26
  widget types and 21 themes, done incrementally as planned:
  - Every theme (except the user-uploaded Custom theme, which has no
    fixed palette by design) now defines its own `--accent` color —
    reusing each theme's existing signature color where one already
    existed, and picking new fitting ones for the 3 that didn't
    (Post-it: amber; Home Hub: lavender, matching its existing violet
    glow; Minimal: soft off-white, kept deliberately restrained).
  - 13 widget types that previously had zero theme awareness now pick
    up that color on their header/label: Chore Leaderboard, To-Do,
    Shopping List, Air Quality, Travel Time, Countdown, Tasks, Stocks,
    On This Day, Timer, QR Code, Sports, and News.
  - Not yet covered (next increment): the handful of widgets that
    already had bespoke hand-tuned per-theme colors before this pass
    (clock, date, calendar, weather, upcoming, agenda, chore chart,
    METAR, text) haven't been switched over to the new shared
    `--accent` mechanism yet — they still look correct, just aren't
    using the unified approach. Moon Phase and Daily Quote don't have
    a distinct header element to color yet either.
  - Verified live with Playwright, not just read over: every theme
    correctly colors a sample widget (breadth — 20 checks), one theme
    correctly colors every newly-covered widget type (depth — 13
    checks), and the Custom theme correctly falls back to the app's
    default accent rather than picking up a stray color. 34 checks
    total, zero page errors.

## 1.44.0
- **New: Family Hub is now discoverable.** Previously it only existed if
  someone happened to type `/hub` into a browser — nothing in the app
  mentioned it.
  - Settings → Family Hub: a new card with a QR code and the direct link
    (plus a Copy Link button) for whoever's setting the household up.
    Uses the same QR library/pattern as the existing wall-display QR
    widget, and degrades gracefully (no error) if the CDN can't be
    reached at the moment the card renders.
  - Chores, To-Do, and Shopping tabs each got a one-line mention pointing
    to Family Hub as an alternative to the full app, matching the
    Chores tab's existing "kids open this on their tablet" hint style.
  - Verified: the Settings card shows the correct origin-based link,
    the QR path doesn't throw when the CDN is unreachable, the copy
    button works, and all three tabs (Chores, To-Do, Shopping) mention
    the /hub link without disturbing their existing content.

## 1.43.0
- **New: Shopping List**, off by default like the built-in To-Do lists —
  turn it on in Settings → Features ("Shopping list") to get a Shopping
  tab in the full app, a wall-display widget in Layout, and the Shopping
  tab in Family Hub (`/hub`) all at once. A single running list (unlike
  To-Do's multiple named lists), matching how most families actually
  keep one shared grocery list.
  - **"Buy" links**: each item links to a store search for that item's
    text — no scraping, no product matching, no API keys. Idea borrowed
    from a similar feature in another household app of the developer's (a
    Total-Wine/Walmart/Target buy-button pattern for cocktail
    ingredients); adapted here for groceries with a user-selectable
    preferred store (Walmart, Target, Kroger, or Amazon) stored as a
    real shared setting — not per-browser localStorage — so the Hub, the
    wall widget, and the full app all agree on the same choice. Search
    URL formats were verified against current retailer behavior via web
    search rather than assumed from memory (Walmart's turned out to use
    `?query=`, not the `?q=` the source app used — confirmed via a live
    example URL before shipping it).
  - Feature-toggle wiring follows the exact pattern already established
    by To-Do lists: tab visibility updates immediately on save (no
    reload needed), the Layout tab's widget picker is gated by the same
    flag, and the toggle defaults off so nothing changes for anyone who
    doesn't turn it on.
  - Verified: the Buy-URL builder (10 checks — correct format per store,
    fallback for an unset/unrecognized store, and proper encoding of
    spaces/ampersands/apostrophes so item names never break a link); the
    Hub's Shopping tab end-to-end (add/toggle/delete items, store
    switching, live updates); and the Settings toggle's full effect on
    the full app — tab hidden by default, becomes visible immediately on
    save without a reload, and the widget-picker gate — plus the full
    app's own Shopping tab CRUD (11 checks). Zero page errors throughout.

## 1.42.0
- **New: Family Hub — an installable "web app" for Chores + To-Dos**,
  independent of opening the full calendar app. Visit `/hub` and "Add to
  Home Screen" (Android shows an in-page install prompt; iOS uses
  Safari's native Share → Add to Home Screen) — it launches full-screen
  with its own icon, no browser address bar.
  - Combined app with a tab switcher between Chores and To-Dos (tab
    choice persists locally). Chores reuses the existing `/kids` page
    directly rather than reimplementing it, so all of that page's
    already-tested behavior (photo proof, bonus chores, history) comes
    along for free with zero duplicated code. To-Dos is new: a
    horizontal list-of-lists with item counts, add/rename/delete lists,
    add/check/delete items, backed by the built-in to-do lists feature
    that already existed inside the full app (its API had no login
    requirement already, same open-on-LAN model as Chores — this is the
    first UI to expose it standalone).
  - A service worker caches the app shell (this page, the Chores page,
    icons, the manifest) so the Hub opens instantly even on a flaky
    connection — deliberately does NOT cache anything under `/api/`, so
    chore/to-do data is always live, never stale from cache.
  - New app icons generated for the manifest (192px, 512px, and a
    512px maskable variant for Android's adaptive-icon shapes, plus an
    Apple touch icon for iOS).
  - Verified with Playwright against the real page: PWA meta tags
    present and correct, tab switching and persistence, the Chores
    iframe correctly targets `/kids`, and the full To-Dos CRUD loop
    (add/switch/rename/delete lists, add/toggle/delete items, item
    counts, empty states) — 22 checks, zero page errors.

## 1.41.1
- **Fixed: a device could get permanently stuck reporting "beta" on the
  mothership's Devices list**, with no way to fix it from the device
  itself. Root cause: removing the beta-channel toggle (1.39.3) took the
  *control* away but never reset the *value* — a device that had beta
  switched on before that removal kept silently reporting 'beta' on every
  check-in forever afterward, since the setting itself was untouched and
  the UI to change it back no longer existed. The channel sent on every
  check-in is now a hardcoded 'stable' rather than read from that setting
  at all, closing off this whole class of bug rather than just resetting
  the current value. The mothership's Devices list will show the
  corrected channel the next time each affected device checks in (next
  boot, or within 6 hours) — no action needed on the mothership side.

## 1.41.0
- **New: international date formats for the Date widget.** A "Date Format"
  dropdown in the widget's Layout settings offers 5 prominent, distinct
  formats rather than a full locale database: US long ("August 5, 2026",
  the original default — existing layouts are unaffected), International
  long ("5 August 2026"), ISO ("2026-08-05"), US numeric ("08/05/2026"),
  and International numeric ("05/08/2026").
- **New: named, saved custom themes.** Settings → Custom Theme now has a
  "Saved Themes" list — save the current background + decorations under a
  name, load a saved one back in later, rename, or delete. Loading and
  saving both physically copy files rather than sharing them with the
  live editing slots, so editing after loading a saved theme (or editing
  the live theme after saving one) can never silently corrupt a saved
  snapshot — verified directly against the filesystem, including the
  "update this saved theme with my edits" path cleaning up its own old
  file with no orphans left behind.
- **New: Travel Time widget.** Shows drive/walk/bike time + distance
  between any two addresses, one widget per route (so "To Work" and "To
  School" can coexist independently). Free by default — road-network
  routing via OSRM, no account needed — with an optional upgrade to
  live-traffic-aware Google Maps timing if you add your own API key in
  the new Settings → Travel Time section (mirrors the existing Weather
  source pattern exactly, including safely falling back to the free
  option if "Google" is selected but no key is entered). Refreshes every
  5 minutes given how fast traffic conditions change.
  - Reminder: air quality was requested alongside these but already
    existed (AQI, PM2.5/PM10, UV index, pollen) — no changes made there.
  - All three verified: date formats against the real render code (6
    checks); the theme library's file-copy safety against real
    filesystem + SQLite (12 checks) plus its Settings UI end-to-end,
    including native prompt()/confirm() dialogs (15 checks); Travel
    Time's provider-selection/unit-conversion/caching logic (18 checks),
    its widget rendering across all states and both providers (12
    checks), and its Settings UI including the save/reload round-trip
    (11 checks). 74 checks total, zero page errors.

## 1.40.0
- **New: five chore-feature additions**, all built on the existing chore
  chart / allowance system.
  - **Photo proof of completion**: a per-chore "Require a photo" toggle
    (Chores tab → edit a chore). When on, a kid's Kids page prompts for a
    camera/photo pick before the chore can be marked done — enforced on
    the backend too (not just hidden in the UI), since the Kids page has
    no login and a chore instance's done-toggle could otherwise be called
    directly.
  - **Bonus / extra-credit chores**: a new "Bonus chore" toggle when
    editing a chore. Bonus chores aren't auto-assigned to anyone — they
    sit in a shared pool any kid can claim from their Kids page ("I did
    this!"). Whoever claims one first gets it; it disappears from the
    pool for everyone else that day. Pay-per-chore still applies if the
    claiming kid has allowance on.
  - **Wall-display Chore Leaderboard widget**: new widget type, ranks
    kids by current streak or by chores completed this week (per-widget
    choice), medal emojis for the top 3, optional per-widget child
    filter — same pattern as the existing Chore Chart widget.
  - **History/weekly view on the Kids page**: a new 📊 button opens a
    streak / 7-day / 30-day completion overview with a 4-week bar strip.
    The backend for this already existed (built for the parent app's own
    History view) — this just brings the same view to the kid-facing
    page.
  - **One-off chore reassignment**: a new "Today's Chores" section in the
    Chores tab lists every kid's chores for today with a "Reassign to…"
    picker on any not-yet-done one — for a sick kid, a schedule change,
    etc., without touching the chore's own recurring assignment. Only
    offered while undone (a completed instance may already have an
    allowance ledger entry tied to the original kid); un-check it first
    to move a completed one.
  - Backend logic (bonus-chore claim race/double-claim protection,
    reassign clash detection, the done-state guard, photo enforcement,
    the weekly-completion ranking math) verified against a real SQLite
    database (`node:sqlite`), not just read over — all edge cases hit:
    two kids racing to claim the same bonus chore, reassigning a done
    chore, reassigning onto a kid who already has that chore that day,
    marking a photo-required chore done without a photo attached.
  - Frontend verified with Playwright against the real widget/page code:
    the leaderboard's ranking (both modes), medal assignment, tie-
    breaking, and per-widget filtering; the Kids page's full photo-
    required flow (confirmed the toggle call is genuinely deferred until
    the photo upload succeeds, then fires automatically), bonus-chore
    claiming and pool depletion, and the history overlay; and the
    Chores tab's reassign section (correct instance targeted, correct
    kid offered, done instances correctly excluded).

## 1.39.4
- **Removed: "Advanced: install the central server" from the app's
  Settings → Software Update.** That panel let someone upload
  `pi-calendar-server.zip` and bootstrap the mothership from inside
  the customer-facing app — not something end users should have
  access to, and unnecessary now that the central server is up and
  running. The `/api/install-server` backend endpoint is untouched
  (harmless if unused) — only the client-facing drop zone, toggle,
  and its wiring are gone. Verified with Playwright against the real
  Settings-render function: the panel and its elements are absent,
  no console errors, and the rest of the Settings tab (e.g. the
  weather ZIP lookup wiring right after it) still works.

## 1.39.3
- **Removed: the manual/automatic update choice.** Updates now always
  install automatically in the background — there is no setting that
  can leave a device stuck on an old version. Concretely:
  - Backend: `periodicUpdateCheck()` no longer checks an `update_mode`
    setting before installing — a newer release found by the ~90s
    post-boot check or the 6-hour recurring check is now installed
    unconditionally, the same way it already did for anyone who had
    manually chosen "Automatic" before.
  - Settings → Software Update is stripped down to just the current
    version number and the license key field. Removed: the
    Manual/Automatic dropdown, the beta-channel toggle, the "Update
    now" / "Check again" buttons and status panel, the Push-to-Slaves
    control, and the advanced manual-zip-upload drop zone. The
    "Advanced: install the central server (one-time)" panel is
    unrelated (one-time mothership setup, not an app-update path) and
    is unaffected.
  - The underlying `/api/update` (used internally when a host pushes
    an update to its slaves) and `/api/update-from-server` endpoints
    are untouched — only the user-facing manual controls in this app
    are gone.

## 1.39.2
- **New: per-widget overrides for time format and week-start**, so
  different displays (or different widgets on the same display) can
  disagree with the global Settings → Display value.
  - **Clock widget**: "Time Format" dropdown (Use display setting /
    12-hour / 24-hour) in the widget's settings panel in Layout.
    Wired in both places that render a clock — the initial render
    and the per-second tick-update — via a `data-format` attribute
    on the widget so the tick function doesn't need the full widget
    object, matching the lesson from the original 1.38.0 time-format
    work about needing to hit every render path.
  - **Calendar widget (Grid layout only)**: "Week Starts On" dropdown
    (Use display setting / Sunday / Monday) alongside Calendar View.
    Not added to the Agenda or Strip layouts since neither does
    week-start grid math.
  - Both default to "Use display setting," so existing layouts are
    unaffected until a user explicitly opts a widget out of the
    global value.
  - Verified with Playwright against the real `display.html` code:
    clock override wins over the global setting in both directions,
    survives the per-second tick, calendar override wins over the
    global setting, `'default'` correctly falls through to the global
    value, and two calendar widgets with different overrides render
    correctly side-by-side on one display alongside an independently-
    overridden clock.

## 1.39.1
- **New: `HANDOFF.md`** — a living document for a fresh Claude session
  (or human collaborator) to get real context fast: architecture
  patterns, hard-won bugs and lessons from this whole project, testing
  approach, versioning discipline, and current business state.
  Identical copy in both repos, kept in sync. Contains its own
  instruction to keep itself updated on every release going forward.

## 1.39.0
- **New: spotlight tour + getting-started checklist** for first-time
  users. Host devices only, triggered once right after setup
  completes.
  - **Tour**: 5 short stops over the real tab bar (Calendar, Photos,
    Layout, Devices, Settings) — a cutout-highlight effect, a click
    blocker so the underlying app can't be accidentally interacted
    with mid-tour, and auto-scroll for tabs that start off-screen on
    a narrow phone. "Show tour again" in Settings brings it back any
    time.
  - **Checklist**: a small dismissible card at the top of the
    Calendar tab — add your first event, pick a theme, customize
    your layout, set up remote access (optional). Each item tracked
    by explicit action (tapping "Go" or the checkmark itself), not
    inferred from possibly-stale app data. Auto-hides once every item
    is done, fully dismissible, and recoverable via "Show checklist
    again" in Settings.
  - Caught and fixed a real bug during testing: the checklist was
    initially written against a `state.settings` global that doesn't
    actually exist anywhere in this file (a false assumption carried
    over from display.html's different pattern) — fixed to fetch
    settings directly, matching how every other function in this
    file actually works.
  - Tested extensively via Playwright: the tour's full 5-step
    progression and completion save, exclusion for slave devices and
    already-completed devices (with manual replay still working via
    Settings), the checklist's Go/checkmark/dismiss interactions and
    their saved payloads, and all three of its own exclusion cases
    (all done, already dismissed, non-host).

## 1.38.0
- **New: first day of week setting** (Sunday or Monday), in Settings
  → Display. Affects the month-grid calendar's day-offset math, the
  week-view widgets' start-of-week calculation, and the "S M T W T F
  S" header row, which now builds dynamically instead of being
  hardcoded Sunday-first. Verified against real, known calendar
  dates — a real Saturday's position in the grid, a real Wednesday's
  correct week-start under both settings.
- **New: 12-hour/24-hour time format setting**, same Settings
  section. Fixed in all three places that needed it: the clock
  widget's initial render, its separate per-second tick-update
  function (which would have silently reverted to 12-hour on the
  very next tick if missed), and event time formatting throughout
  the calendar.

## 1.37.1
- **Fixed**: entering a ZIP code in the setup wizard's optional
  location field saved the raw ZIP as a setting, but never actually
  looked it up — nothing ever converted it into the coordinates the
  weather widget needs, so weather stayed stuck on "loading weather"
  forever. Now calls the real geocoding endpoint (the same one
  Settings' own "Zip lookup" button already uses) instead. Best
  effort: an invalid/unrecognized ZIP doesn't block finishing setup,
  same as everything else optional on that step — easy to fix later
  from Settings if needed. Verified the fix directly: drove the
  wizard through a real ZIP entry and confirmed the geocoding
  endpoint is now actually called with the right ZIP, and the old
  broken direct-save no longer happens.

## 1.37.0
- **Fixed a serious, confirmed bug**: the required-email wizard step
  (added several versions back) was silently never triggering on a
  genuinely fresh install. Root cause: a startup migration meant for
  devices that predated the wizard checked the `layouts` table as a
  signal of "this device already has history" — but `layouts` gets a
  default auto-seeded by the app itself on every server startup,
  completely independent of any real user action. On a fresh install,
  the server starts once during install.sh (seeding the default
  layout for the first time), then again after the installer's own
  final reboot — and on that second startup, the migration saw
  `layouts > 0` from the first startup's auto-seed and incorrectly
  concluded the device was already configured, marking
  `setup_complete='1'` before the wizard ever had a chance to run.
  This affected every fresh install, not just one test device.
  Removed `layouts` from the history check; verified with a test
  simulating the exact two-startup sequence, plus sanity checks
  confirming genuine prior use (real events, or an already-configured
  slave) is still correctly detected.
- **Auto-reboot, for real**: `install.sh` previously just told you to
  run `sudo reboot` yourself, while the website claimed it happened
  automatically — genuinely false. Now it actually reboots at the
  end, with a 15s countdown defaulting to yes (so it happens on its
  own even if nobody's watching the terminal), while still giving a
  real window to type `n` and skip it.
- **New "let's get set up" screen** on the wall display itself —
  full-screen, shown until `setup_complete` is actually saved, then
  disappears live the instant that happens (no refresh needed).
  Shows the Pi's real LAN address and a short explanation of what
  happens once you get there.
- **New troubleshooting page** (piazzahq.com/troubleshooting) with
  copy-paste commands for remote access setup, manually switching to
  X11, re-running install.sh safely, kiosk controls, and checking
  logs/status.

## 1.36.3
- **Fixed**: after switching to X11 via the end-of-install prompt
  (added in 1.36.2), the kiosk sometimes didn't launch after
  rebooting, even though X11 itself was confirmed active. Root cause,
  confirmed via direct user testing: the session name used to build
  the autostart file path (LXSESSION_NAME, read from lightdm.conf) was
  detected once, early in the script, while still on Wayland — if the
  X11 switch itself changes that value, the autostart entry was
  silently written to the wrong session's folder, one X11 would never
  actually read. Fixed by re-reading the session name fresh
  immediately after the switch, and — since there's no way to fully
  verify the real post-reboot value without an actual reboot —
  defensively writing the autostart entries to every distinct
  candidate name available (the originally-detected one, the freshly
  re-read one, and the classic "LXDE-pi" fallback) rather than
  betting everything on exactly one being right. Harmless when they
  turn out to match: verified the normal (no-mismatch) case still
  only writes once, no redundant work.

## 1.36.2
- **install.sh: moved the X11 switch offer to the very end**, after
  everything else (Node, the app, systemd, kiosk autostart) is
  already fully installed. It used to be offered right after session
  detection, near the start — but switching only takes effect after a
  reboot (raspi-config just sets next-boot config; the currently
  running session doesn't change), so accepting it early meant
  exiting immediately with almost nothing installed and being told to
  reboot AND re-run the whole installer from scratch. Now, accepting
  at the end costs nothing extra: the X11-specific autostart file
  gets written proactively too, so a single reboot at the end picks
  up everything correctly regardless of which session type comes up.
- **Fixed a real, separate bug found while testing the above**: the
  add_line_if_absent() helper's "is this line already here" check
  used `grep -qF "$match"`, which breaks when $match starts with `--`
  (exactly the case for the kiosk launch line's "--kiosk" match) --
  grep parses a leading "--" as an unrecognized option instead of a
  search pattern, silently fails, and the if/else reads that failure
  as "not found." The kiosk launch line was being appended again on
  *every single re-run* of the installer, on both X11 and Wayland.
  Fixed with `grep -qF -- "$match"`. Verified with an isolated test
  running the real (copy-pasted) function three times in a row --
  confirmed exactly 5 lines each time, not 7+.

## 1.36.1
- **Fixed**: a photo widget with its own custom slideshow interval
  would keep cycling through its OLD photo selection after being
  edited down to a single photo — the fix (switching to "show all"
  and back) worked but shouldn't have been necessary. Root cause: the
  per-widget timer's callback closed over the widget object as it
  existed the moment the timer was created, and only rebuilt if the
  interval itself changed — editing which photo(s) are selected
  doesn't change the interval, so the old timer kept running,
  permanently iterating the pre-edit photo list. Fixed by having the
  callback re-resolve the current widget from the live layout on every
  tick instead, matching the pattern the shared global slideshow timer
  already used correctly. Confirmed via an instrumented test that the
  timer now genuinely uses the post-edit widget the moment it fires.

## 1.36.0
- **New Nautical theme** — open ocean background, boats (4 varieties)
  drifting slowly across the waterline. Reuses the existing
  fx-flypath animation built for the Aviation theme's planes rather
  than inventing a new one; boats are flipped via scaleX for
  direction rather than rotated, so they stay upright on the water.
- **New Custom theme** — upload your own background image plus up to
  3 PNG decorations, each with an independent behavior: falls from
  top, rises from bottom, enters from a side, or a random mix.
  Decorations are PNG-only (transparency is what makes a floating
  decoration actually read as one, not a solid rectangle); the
  background accepts JPEG/PNG/WebP. New "Custom Theme" section in
  Settings for uploading/replacing/removing each, and choosing each
  decoration's behavior. Old files are cleaned up automatically on
  replacement.
- Both new themes tested end-to-end: particle counts, animation
  types per behavior (including confirming "random" genuinely mixes
  behaviors across particles), the empty/background-only/fully-empty
  states for Custom, and the Settings UI in both empty and populated
  states.
- Fixed a real bug caught before it shipped: the new upload endpoints
  were broadcasting an invented 'theme' topic that display.html has
  no handler for at all (would have silently done nothing) — fixed
  to use the existing 'displays' topic, which actually triggers a
  live theme refresh.

## 1.35.3
- Added a small copyright notice at the very bottom of Settings ("Piazza
  HQ · © 2026", year computed dynamically so it doesn't go
  stale). Quiet companion to the LICENSE file added last version —
  cheap, and it's the kind of thing that shows up in a screenshot if
  a modified copy ever surfaces somewhere it shouldn't.

## 1.35.2
- Added a LICENSE file — proprietary, personal/organizational use on
  your own hardware, no redistribution of original or modified
  copies. Not primarily a technical protection (the code has to run
  readable on customer hardware, nothing stops someone from stripping
  license checks locally) but gives real legal standing if a stripped
  or modified copy ever surfaces publicly.

## 1.35.1
- Hid the "install a zip manually" option from Settings → Software
  Update — not something a regular customer should need, now that
  updates flow through the central server. Reversible (same
  `display:none` pattern already used for the central-server-install
  option), not removed outright.

## 1.35.0
- **Trial licenses now actually expire.** A new admin-configurable date
  (defaults to end of this year) marks how long a free trial stays
  fully active — previously trials never expired at all.
- **New trial-ending notice** on the wall display: a small corner
  card appears within 14 days of a trial's end (or after it's
  passed), dismissible for the rest of the day. Nothing shown for
  active licenses.
- **New admin-defined limits for non-licensed accounts**: max
  devices (default 1) and max widgets (default 8). Enforced without
  ever retroactively locking anyone out — only blocks genuinely
  adding a new screen or widget beyond what you already had, never
  blocks editing/rearranging something you already had before a
  limit applied. Active licenses are always unlimited.
- **First-run setup now registers a real trial license** (host
  devices only) via the central server, instead of running unregistered.
- **The control app now forces a refresh after an update** — previously
  showed a tappable banner requiring a manual tap; now shows a visible
  countdown and reloads on its own, with a "Not now" option that only
  postpones it by 5 minutes rather than cancelling it, so it still
  actually happens.
- Fixed a real bug in the layout-save flow: a rejected save (e.g. from
  the new widget limit) previously failed completely silently — the
  widget would appear added in the UI but never actually persist,
  vanishing on the next reload with no explanation. Now shows a clear
  error and reverts to what's actually saved.

## 1.34.0
- **First-run setup now requires an email** (host devices only — an
  added screen inherits the same license automatically once it syncs,
  no separate prompt). This registers a real trial license via the
  central server, the same as the marketing site's free-trial signup
  — no payment, just a way to reach you before pricing ever goes
  live. Not skippable, but retriable: if it can't reach the server
  (e.g. wifi still connecting), it shows a clear error and lets you
  try again rather than being a dead end.

## 1.33.2
- **Fixed a real bug affecting the central server's device tracking**:
  every install was sending the same hardcoded literal `'pi'` as its
  device ID on every update check — meaning all installs everywhere
  indistinguishably overwrote the same check-in record, making
  per-device data on the server side meaningless. Now generates a
  real, random, persistent ID once per install and reuses it from
  then on. No visible change on the device itself.

## 1.33.1
- Central server address switched from the old Tailscale Funnel URL to
  the new **piazzahq.com** domain (now that hosting there is confirmed
  working) — this is what devices check for updates and download
  releases from.

## 1.33.0
- **Rebranded to Piazza HQ.** All visible text — the setup wizard, PIN
  screen, license key help text, email digests, installer output, and
  systemd service descriptions — now says Piazza HQ instead of Pi
  Calendar. Purely cosmetic: the underlying folder name, package name,
  and zip filename convention are unchanged, so this doesn't affect
  updates, installs, or the central server's build validation.

## 1.32.5
- **New optional License key field** (Settings → Software Update). Only
  relevant if you have an active Pi Calendar license — leave blank otherwise,
  nothing else changes. When set, it's sent with update checks so the
  central server can determine what you have access to.

## 1.32.4
- **Aviation planes now use real artwork instead of a hand-derived
  silhouette.** Replaced the SVG shapes with three actual plane images (a
  small prop plane, a medium business jet, and a large wide-body) — cleaned
  up (a baked-in "Made with AI" badge removed, cropped to content, bundled
  as permanent app assets) and wired in with the same nose-up orientation
  convention as before, so the rotation-to-travel-direction math needed no
  changes at all.

## 1.32.3
- **KC-46 Ready Room renamed to Flight Deck** — a more generic aviation name
  (id also renamed to `flightdeck` throughout, for consistency).
- **Aviation planes fixed for real this time.** The ✈️ emoji's own drawn
  angle varies by font/platform, which made it impossible to reliably know
  where its nose actually was — that was the real bug, not the rotation
  math. Replaced with precisely-drawn CSS shapes, nose-up by default, so the
  rotation to face the actual travel direction is now an exact calculation.
  Also switched from one shape at 3 sizes to 3 genuinely different plane
  silhouettes (small dart/fighter, mid commercial jet, wide tanker/widebody)
  — matching how the different snowflake glyphs work, not one shape scaled
  up and down.
- **TCAS movement rebuilt on an actual physical model.** The previous
  version directly simulated range and closure rate as independent numbers,
  which meant every contact moved on a straight line toward or away from
  ownship — hence everything looking aimed at it. Each contact now has its
  own independent position and velocity, flying its own random heading with
  no relation to ownship's position; range and closure rate are derived
  from that real geometry each tick, so most contacts just pass through the
  area at varying distances rather than converging and bouncing off.
- Range rings now labeled (2.5 / 5 / 7.5 / 10) at their actual positions.
- Ownship symbol is now 3x bigger and a true hollow shape (white SVG
  stroke, transparent fill) rather than a solid filled triangle.

## 1.32.2
- **KC-46's TCAS traffic rebuilt as an actual simulation, not decorative
  colors.** Each of 5 contacts now carries a real range, bearing, closure
  rate, and relative altitude that evolve every 1.6 seconds, with state
  DERIVED from those values using real TCAS thresholds: Other Traffic
  (hollow diamond) beyond 5.5nm, Proximate Traffic (filled diamond) inside
  that, a genuine Traffic Advisory (filled amber circle) only when actually
  closing AND within 3nm AND near co-altitude — not just "close" — and a
  rare Resolution Advisory (filled red square, pulsing) if a TA keeps
  closing inside 1.4nm. Range and closure rate do a bounded random walk
  with boundary bounces, so contacts realistically open and close over time.
- **Added an ownship symbol and matched the nav-display background to it.**
  A static chevron sits at a fixed bottom-center reference point; the
  background's range rings are now centered on that same point (previously
  screen-center) and spaced at real 2.5nm increments matching the
  simulation's own scale, so a contact's on-screen distance from ownship
  actually corresponds to its simulated range rather than being pure
  decoration.
- Movement is now smooth positional interpolation between tick updates
  rather than a fixed animation loop, and altitude tags are hidden for
  Other Traffic, matching how real displays de-emphasize distant contacts.

## 1.32.1
- **New "Animation Density" setting** (Devices tab, next to Animation Size) —
  controls how MANY particles a theme's effect spawns, separate from how big
  each one is. Off / Occasional / Default / Lots / Tons. So one person can
  have the occasional heart float by on Valentine's while another wants a
  lot of them, without anything else about the effect changing. Applies
  automatically to every theme's particle count.
- **Aviation now has planes flying across the screen** — varying altitudes
  and speeds, split evenly between both directions so it doesn't read as a
  single one-way parade.
- **KC-46 Ready Room gained two things**: TCAS-style traffic symbols
  (diamond markers with relative-altitude tags, in real TCAS coloring —
  green for proximate traffic, amber for advisories) that appear, drift
  slightly, and fade; and a subtle nav-display texture in the background —
  faint concentric range rings, kept low-opacity so they read as texture
  rather than competing with the widgets on top of them.
- **Edge Fade no longer shows a visible line where the fade starts.** It was
  a straight linear fade, which has a real, well-known perceptual issue: a
  visible "kink" right where it meets the flat, unfaded region on either
  end — human vision picks up on that rate-of-change discontinuity even
  though the gradient itself is technically continuous. Replaced with a
  smoothstep-eased curve that eases in and out at both ends instead, which
  also smooths out the corners naturally when two sides are faded at once —
  the intersection of two eased curves stays smooth, where two straight
  ramps would intersect into a harder, more squared-off look.

## 1.32.0
- **Edge Fade rebuilt properly.** The previous overlay-div approach could only
  ever dim toward a fixed color — never actually see-through, no matter how
  it was tuned. Replaced with a CSS mask applied directly to the photo
  itself, making the photo's own pixels transparent near the edges so
  whatever's actually behind the widget shows through. Also fixed the
  slideshow crossfade, which creates a fresh image on every transition —
  without the same mask there, the fade would've disappeared after the
  first photo change.
- **The app now reloads itself automatically after installing an update.**
  Found the same gap in two separate places (the update banner, and the
  standalone "Install Now" flow in Settings): both confirmed success and
  stopped, leaving the app running old, stale JavaScript until someone
  manually refreshed. Both now reload about a second after confirming
  success. The wall display itself already had a solid version-polling
  reload mechanism in place — no changes needed there.
- **New Decoration widget** — a purely decorative graphic (a plant, a
  seasonal emoji, anything) placeable anywhere on any layout, independent of
  template or theme. Quick-pick grid of 24 common choices leading with
  greenery, a custom text input for anything else, plus size/opacity/
  rotation controls.
- **Two new templates**: Aviation (a high-altitude twilight sky, with the
  METAR/TAF widget for current conditions) and KC-46 Ready Room (built more
  like an actual ready-room display — METAR/TAF given real prominence with
  both origin and destination weather, a dark operational backdrop, and
  USAF-blue/amber accent theming). Both get full widget-level theming
  (calendar tinting, accent header text), not just a themed background.

## 1.31.8
- **Edge Fade now stays translucent instead of fading to a solid block of
  color.** Capped its max opacity at 0.65 — the photo shows through even at
  the very edge, just dimmed toward the background color, rather than being
  completely hidden behind an opaque overlay.

## 1.31.7
- **Fixed the Photo widget's Edge Fade doing nothing.** The photo's `<img>`
  has an explicit `z-index:1`, but the fade overlay divs had no z-index set
  at all. In CSS, a positioned element with an explicit z-index always
  stacks above a positioned sibling with `z-index:auto`, regardless of DOM
  order — so the fade was rendering exactly as configured, just completely
  hidden behind the opaque photo the whole time.

## 1.31.6
- **Easter eggs now gently rock side to side as they float upward**, instead
  of rising perfectly upright with zero rotation. Deliberately a rock, not a
  full spin — that would read more like a tumbling autumn leaf than a
  floating egg. Kept as its own dedicated animation rather than changing the
  one shared with hearts/balloons/bubbles, so those are unaffected.
- **July 4th and New Year's fireworks look more like actual fireworks now.**
  Fixed the ray gradient, which was backwards — brightest at the burst's
  origin and fading to nothing at the tip, when real sparks are the
  opposite; each ray now glows brightest at its outer tip, with a small
  glowing spark dot right at the end. Added a shower of falling embers after
  each burst — the most recognizable real-firework trait that was missing
  entirely — timed to share its parent burst's exact duration so it stays
  synced across every infinite loop repetition rather than drifting.

## 1.31.5
- **11 of the 12 templates that had no widget-level theming now do.** Most
  templates only ever styled their background and particle effects — the
  actual calendar cells, clock, weather, and text widgets rendered with the
  exact same default look regardless of theme. Added a subtle calendar cell
  tint plus themed header text for July 4th, New Year's, Christmas,
  Halloween, Autumn, Birthday, Valentine's, Summer, and Modern Dark, each
  matched to its own accent color. Easter and postit needed extra care since
  their light backgrounds require dark text — found and used the existing
  `LIGHT_THEMES` mechanism (which skips stamping the global text-color
  setting over a theme's own), rather than a plain CSS override that would
  have been silently overwritten. Minimalist intentionally stays untouched
  — "no decorations" is the whole point of that one.

## 1.31.4
- **Fixed theme animations (fireworks, snow, falling leaves, and every other
  themed particle effect) looking too small on a large screen.** Their sizes
  were hardcoded pixel values, never wired into the `--ui-scale` system the
  rest of the app already uses to scale fonts and widgets correctly across
  different screen resolutions — so a 4K TV rendered the same physical
  particle size as a 1080p one. Now scales automatically with actual screen
  resolution, same as everything else.
- **New "Animation Size" setting** (Devices tab → Display) for explicit
  control on top of the automatic scaling — Smaller / Default / Larger /
  Much larger / Huge — for cases auto-scaling alone doesn't get quite right,
  like a big TV viewed from further away. Updates live, no reload needed.
- **Found and fixed three more of the same scaling gap** while auditing for
  others: the News/Stocks widgets' "News"/"Markets" section labels (the
  actual headlines and prices already scaled; these labels didn't), the
  Agenda and Strip calendar layouts' small event dot markers (everything
  else in those layouts already scaled), and QR codes — which needed a
  proper fix rather than just a bigger CSS size, since naively scaling up a
  QR code generated at a fixed native resolution would make it blurry
  instead of actually sharper, undermining how reliably it scans.
- **Birthday's theme animation is now multi-colored balloons drifting
  upward**, instead of sharing the smaller firework/sparkle burst New
  Year's uses. CSS-drawn (not an emoji) so each balloon can actually be a
  different color.
- **Christmas snow and Easter eggs redesigned** — both were previously just
  plain colored circles ("blobs"). Christmas now uses real snowflake
  shapes (mixed with a few small plain dots for depth, like real snowfall
  at a distance). Easter now uses actual CSS-drawn egg shapes with a
  decorative stripe, each a different pastel — not identical colored dots.
- **New Year's twinkling stars and both fireworks' flash cores now use an
  actual star shape** instead of a plain circle — required separating the
  glow into its own layer behind the sharp star shape, since a shape mask
  would otherwise have clipped off the glow too. New Year's burst also
  gained a flash core it didn't have before, matching July 4th's.

## 1.31.3
- **Fixed icon calendar decorations (1.31.2) placing the themed icon in the
  wrong spot** — it was showing as a single summary marker sitting above the
  whole event list, rather than leading each individual event. Now each
  event line is led directly by the icon, replacing the usual colored dot:
  "🎃 3pm Trunk-or-Treat" instead of a colored circle. All-day events (shown
  as colored pills) get the same treatment.

## 1.31.2
- **Fixed the actual root cause behind icon calendar decorations showing no
  event text** — not just in templates (1.31.1), but the feature itself, for
  any calendar widget with an icon decoration style chosen. The rendering
  code did a full early-return before the event list was even computed;
  restructured so icon mode shows the themed marker AND the real event text
  together, the same way the post-it note style already worked correctly.
  Also shrunk the icon itself (previously sized to be the only thing in the
  cell) so it doesn't crowd out the text, and restored multi-day event bars,
  which were silently disabled in icon mode too.
- With the real bug fixed, reverted the 9 templates from 1.31.1 (July 4th,
  Christmas, Easter, Halloween, Autumn, Birthday, Valentine's, Spring,
  Summer) back to their original themed icons — now getting both the
  festive look and the actual event text, rather than the plain style they
  were switched to as a workaround.

## 1.31.1
- **9 templates' calendar widgets now list actual event text** (July 4th,
  Christmas, Easter, Halloween, Autumn, Birthday, Valentine's, Spring,
  Summer) instead of only a themed decorative icon per day — same setting a
  normal, undecorated calendar widget already uses. Also added wrap/line
  settings so the text fits cleanly given these calendars share width with
  an upcoming-events widget alongside them. New Year's (agenda/list mode)
  and the postit-style template were already showing real event text and
  didn't need this.

## 1.31.0
- **New: full backup download** (Settings → Backup). Zips up the actual live
  database file plus every uploaded photo — not a partial export, everything
  including local-only settings and the PIN. Flushes pending WAL-mode writes
  first so nothing recent is missed. Download/export only for now; restoring
  is a manual file-swap (steps included in the info popup) rather than an
  in-app button.
- **Fixed two real gaps in remote slave sync**, found while auditing it:
  photo files that were deleted on the host previously stayed on every
  slave's disk forever (a slow storage leak on Pi SD cards) — sync now
  cleans up orphaned files too. To-Do list data was missing from sync
  entirely, meaning a To-Do widget on a slave's assigned layout always
  showed empty — now included.
- **Fixed a real bug affecting 8 templates**: calendar widgets using an
  "icon" decoration style (July 4th, Easter, Halloween, Birthday,
  Valentine's, Spring, Summer, Autumn) never actually showed event text at
  all — a day with an event showed only the decorative icon, by design in
  the rendering code, regardless of available space. Paired each one with an
  upcoming-events widget so event details are actually visible. Also fixed
  New Year's, which had been silently rendering as a normal grid instead of
  its intended agenda/list view due to a property-name mix-up.
- **Fixed 8 templates missing custom gallery preview swatches** — they were
  falling back to a generic gray box with a paint-palette emoji instead of
  something representative of their actual theme.
- **Home Hub now includes the built-in To-Do widget** alongside the chore
  chart, matching its "family command center" framing.
- **Two new templates showcasing widget types that appeared in zero existing
  templates**: Daily Digest (a quote, a headline, a bit of history, and the
  moon phase — every widget works with zero setup) and Command Center (a
  dashboard with stocks, a countdown, a kitchen timer, and a QR code).
  Combined with Photo Frame and Home Hub's new to-do widget, every widget
  type in the app now appears in at least one template, except the two
  (sports, tasks) that need account-specific setup a template can't
  meaningfully pre-fill.

## 1.30.0
- **Sub-grouped the Devices tab's Screen Settings accordion** into three
  clearly labeled mini-sections — 🖥️ Display, 🖼️ Ambient Mode, 📺 TV Control —
  instead of one long scroll once opened.
- **Grouped related Settings sections.** Generalized the existing single-
  purpose "Advanced" grouping into a reusable multi-group system, and added a
  new "Display & Photos" group (Display + Photo Widget Defaults) inserted
  where Display used to sit. Advanced keeps its existing five sections and
  its long-standing position at the bottom.
- **Sub-grouped the Calendar and Photo widget settings panels** into labeled
  mini-sections (Layout / Event Display for Calendar; Which Photos /
  Appearance / Slideshow for Photo) — also moved Edge Fade into Appearance,
  where it actually belongs, rather than sitting after the slideshow timing
  fields.
- **Standardized icon-button styling app-wide.** Found several real
  inconsistencies from being added in different passes: To-Do item delete
  buttons were using inline styles (gray, ✕) instead of the established
  red-🗑️ pattern used everywhere else; kid/chore delete buttons and TV
  schedule slot delete buttons were using the right icon but missing the
  color modifier entirely, making them gray instead of red like every other
  delete action. All standardized, plus a new compact "small" variant for
  tight list-row contexts.
- **Reduced toast notification spam on the Devices tab.** Removed 23 success-
  confirmation toasts for simple dropdown/checkbox changes where the field
  itself already shows the new state clearly (orientation, rotation,
  screensaver mode, display mode, photo fit, fade settings, TV control
  type/IP, clock position, TV schedule edits, control-badge visibility,
  display rename). Kept error toasts everywhere (unchanged), and kept
  confirmations where there's no visible in-app feedback or the outcome
  genuinely matters — TV power/input commands, the Samsung pairing flow, and
  the push-update-to-all-displays flow.

## 1.29.0
- **App-wide cleanup pass.** Several long-standing explanatory paragraphs had
  accumulated across the app and made things feel wordy — replaced with a
  reusable ⓘ info button (tap for a popup with the explanation) everywhere a
  section used to carry an always-visible block of text. Short one-liners were
  left alone; only the genuinely long ones were converted.
- **Merged Calendars + Events into one "Calendar" tab**, with a small sub-tab
  bar (Events / Calendar Feeds) styled distinctly from the main tab bar so the
  hierarchy stays clear. Tab count is down to 7.
- **Simplified the Photos tab down to upload + tagging.** The "Placement"
  field (Full screen/Left/Right) was confirmed dead code — never actually read
  anywhere — and removed outright. Brightness/Opacity/Slideshow/Slide Interval
  turned out to be genuine global defaults (what any Photo widget or screen's
  ambient mode falls back to without its own override), so those moved to a
  new "Photo Widget Defaults" section in Settings rather than being deleted,
  with an info button clarifying that relationship. Both integrate into
  Settings' existing auto-save.
- **Disabled the Tab-key screensaver** (pressing Tab on a display's own
  keyboard to blank to a photo) — unused, and its settings UI had gone missing
  in an earlier pass without anyone noticing, meaning it was fully live with
  no way to configure it. Commented out rather than deleted, including a
  pre-paint safety fix so a display that was ever toggled blanked before can't
  get permanently stuck that way with no listener left to undo it.

## 1.28.6
- **New: user-configurable Fade Duration** (1/2/3/4/5/8 seconds), instead of a
  fixed default — available both on the Photo widget's own settings (Layout
  tab) and ambient mode's settings (Devices tab), each shown only when fade is
  turned on. Set it as slow or quick as actually wanted, directly.

## 1.28.5
- **Fixed the slideshow fade looking abrupt/choppy instead of gradual.** The
  fade timer was starting the instant a new photo's image element was
  created — before the browser had actually finished loading and decoding it.
  If that took even 200-600ms (realistic for a full-resolution photo), that
  chunk of the fade was spent animating something invisible, making the
  visible portion of the transition consistently shorter and choppier than
  intended. Now waits for the image to genuinely finish loading before the
  fade clock starts, so the full duration is what actually gets seen.
  Also lengthened the duration (1.2s → 2s) and switched to a smoother,
  symmetric easing curve, and added a safety net: a broken or missing photo
  file no longer leaves the previous photo stuck on screen forever waiting for
  a load event that would never arrive.

## 1.28.4
- **Added the missing "Blurred background behind mismatched photos" toggle for
  ambient mode** (Devices tab, shown when Photo Fit is Auto) — same gap as the
  Slide Interval/Fade settings just added: this previously only existed on a
  placed Photo widget's own settings, so ambient mode had no way to control it
  and was permanently stuck with it on.
- **Fixed the blurred background visibly swapping before the photo it belongs
  to had finished transitioning.** The background was deliberately swapped
  instantly while the actual photo crossfaded over 1.2 seconds — a real design
  mistake: it meant the background could already show the next photo's blur
  while the current photo was still visibly fading out in front of it, its own
  jarring mismatch. Now crossfades both layers together, same timing, same
  easing.

## 1.28.3
- **Gave ambient mode (Photo only / Photo + time) its own complete, self-
  contained slideshow settings** — Slide Interval and Fade Between Photos,
  right alongside the existing Photo Fit control in the Devices tab. Previously
  these only existed on a placed Photo widget's own settings panel, which meant
  someone using only ambient mode (no widget anywhere in their layout) had no
  way to configure fade or timing at all. Fully independent of whether any
  Photo widget exists — ambient mode now configures its own slideshow
  completely on its own, same live-update behavior as everything else here.

## 1.28.2
- **Fixed the real cause of ambient mode (Photo only / Photo + time) eventually
  reverting to normal widgets on its own** — a genuine, unconditional periodic
  check (every 5 minutes, unrelated to anything else including the phone app)
  had the same underlying bug already fixed elsewhere this session: it fetches
  the real layout and re-renders, with no awareness that ambient mode might be
  active. Found two more instances of the same gap while tracking this down
  (a profile-reassignment check, and the orientation-change handler). Rather
  than patch each individually again, centralized the fix into one shared
  helper every one of these now goes through, specifically to make this bug
  class much harder to accidentally reintroduce in some future function.
- **Fixed the brief flash of letterboxing on every photo in "Auto" fit mode** —
  every photo previously started with `object-fit: contain` regardless of its
  real orientation (genuinely unknown until the browser finishes loading it),
  then snapped to full-bleed once JS learned the orientations matched. Now uses
  a persisted, per-device cache: once a photo's orientation is known, it's
  remembered permanently, so only a photo's very first-ever showing can flash —
  never again after that.
- **New: fade transition between slideshow photos.** Photo widgets now update
  in place with a real crossfade instead of an instant cut, which also fixes a
  secondary issue: nothing else on screen actually changes when only the photo
  advances, so rebuilding the entire display every time was wasted work. On by
  default, with a per-widget toggle for a hard cut instead.
- **New: per-widget slide interval, made actually functional.** The "Slide
  Interval" field already existed in the Photo widget's settings, but — same
  gap as an earlier per-widget setting this session — was never actually wired
  up on the display side. Now works: any photo widget with its own interval
  set cycles independently, on its own timer, rather than all photo widgets
  sharing one global clock.
- **New: toggle for the blurred background behind mismatched-orientation
  photos** in Auto fit mode — on by default as a softer alternative to plain
  bars, but now optional per widget if you'd rather have plain letterboxing.

## 1.28.1
- **Fixed the To-Do enable toggle appearing to silently revert** — it wasn't
  reverting, it just required pressing "Save Settings" and that wasn't obvious.
  Moved the built-in To-Do widget from its own in-Settings management panel to
  a proper top-level "To-Do" tab (shown/hidden exactly like Chores), with the
  enable toggle moved into the existing Features section alongside Chore chart.
- **Settings now auto-save** — any field change saves automatically (checkboxes
  and selects almost immediately, text fields a beat after the last keystroke),
  so nothing gets silently lost by forgetting to press the save button. The PIN
  field is deliberately excluded and stays manual-only — it has a confirmation
  dialog for removing protection that would be genuinely risky to trigger
  automatically while someone's still typing.
- **Fixed no way to clear a TV on/off time once set, and no way to have more
  than one.** Replaced the old fixed single-on/single-off schedule with an
  unlimited list of time slots per screen — add as many as needed, edit or
  delete any of them individually. Existing schedules were migrated
  automatically.
- **Fixed mixed-orientation photo slideshows always cropping or letterboxing
  one orientation.** New "Auto" fit option decides per photo once it's loaded:
  matches the widget's own shape, it fills cleanly; doesn't match, it shows the
  whole photo uncropped with a softly blurred copy of that same photo filling
  the letterboxed space instead of stark bars. Available for the normal Photo
  widget and ambient mode.

## 1.28.0
- **Fixed ambient mode (Photo only / Photo + time) reverting to the normal
  calendar view unpredictably** — not just after updates. Root cause: the
  `settings`, `layout`, and `displays` SSE broadcast topics all called
  `fetchLayout()` directly, silently overwriting the ambient layout any time
  *any* unrelated setting changed anywhere in the app (weather config, stock
  tickers, really anything using the general "settings changed" broadcast).
  All three handlers now re-apply ambient mode after fetching, instead of
  reverting to normal widgets.
- **Fixed the Devices tab's "Screen Settings" accordion auto-collapsing** —
  traced to the tab's 15-second background refresh (keeps online/offline
  status current), which rebuilt the entire screens list from scratch each
  time with no memory of what was open. Now tracks open state and restores it
  across re-renders.
- **The "update available" banner now actually installs the update when
  tapped**, polling for the restart and confirming success — instead of just
  navigating to the Settings tab and leaving the actual button-press to you.
- **New: built-in To-Do widget** — a fully local, fully self-contained
  to-do list, no external account needed (unlike the Tasks widget, which is
  Todoist-specific and wasn't a good fit to retrofit this into). Turn it on in
  Settings → To-Do Lists, manage lists and items right there, then add a
  "To-Do List" widget from the Layout tab and pick which list to show. Font
  size, optional title override, and show/hide-completed are all configurable
  per widget. Fully live over SSE like every other widget.

## 1.27.4
- **Fixed "Cut HDMI Signal" actually doing nothing** — `vcgencmd display_power`
  (the original mechanism) turned out to be a silent no-op on the current
  KMS/DRM graphics driver stack: it returns success without actually affecting
  the output at all, a known limitation of that legacy-era command on current
  Raspberry Pi OS. Replaced with `xrandr --output <name> --off/--auto` as the
  primary mechanism, confirmed to genuinely work by testing it directly.
  `vcgencmd` is kept only as a last-resort fallback if `xrandr` truly isn't
  usable at all. Since this runs from a background service rather than an
  interactive login session, `DISPLAY` and `XAUTHORITY` are now set explicitly
  rather than assumed inherited, which an SSH shell under the same user
  account gets for free but a systemd service does not.

## 1.27.3
- **New: "Cut HDMI Signal" TV control option**, for monitors and displays with
  no CEC support at all (most computer monitors, confirmed the case for at
  least one setup this session). Doesn't ask the display to power off — most
  monitors don't understand any such request over HDMI without CEC. Instead it
  just stops the Pi from sending a signal at all (`vcgencmd display_power`),
  relying on the display's own built-in sleep-on-no-signal behavior, which is
  near-universal even on displays with zero smart features. No input
  switching (there's nothing to switch on the Pi's own output).
- **Collapsed each screen's settings into an accordion** (Devices tab) — the
  card had grown genuinely busy after several rounds of new per-screen
  settings this session. Orientation, screensaver source, display mode, and
  TV control now live in a closed-by-default "⚙️ Screen Settings" section with
  a quick summary line (e.g. "Photo + time mode · TV: cec") so what's
  configured is visible at a glance without expanding. Name, online status,
  and profile assignment stay always-visible above it. Each screen toggles
  independently — reuses the same accordion component already used elsewhere
  in this tab for visual consistency.

## 1.27.2
- **Fixed a significant gap affecting every per-screen setting on a remote
  slave** (ambient mode, screensaver source, TV control, clock corner, photo
  fit, info corner, orientation) — not just TV control, which is what surfaced
  it. A slave's 30-second check-in with the host only ever returned
  `assigned_display_slug` (which layout to show); every other per-screen
  setting changed via the app only ever reached the host's own copy of that
  screen's row. A remote slave's own local database — what its own display
  actually reads from — never learned about any of it, even across a full
  reload. Went unnoticed all session because testing mostly exercised the
  host's own screen, where no cross-device sync is needed at all.
  Now the check-in carries the screen's full config, and the slave writes it
  into its own local database, firing the same live-update commands (`reload`,
  `refresh-photos`, `set-ambient-mode`, `set-info-corner`) the host already
  uses for these fields — so a remote slave gets the same instant, no-reload
  behavior as the host's own screen, not just eventual correctness.

## 1.27.1
- No code changes — re-packaged and version-bumped from 1.27.0 to give a clean,
  unambiguous way to confirm this exact build (with `tv-control.js` genuinely
  included) actually applies. A prior 1.27.0 update attempt left `tv-control.js`
  missing on disk despite it being correctly present in that package; the cause
  wasn't pinned down with certainty, so this distinct version number makes it
  possible to confirm success via `screen_version` / `/api/version` rather than
  re-checking the same version number against uncertainty about which file was
  actually used last time.

## 1.27.0
- **New: TV power/input control**, per screen (Devices tab → 📺 TV Control) —
  HDMI-CEC (no extra hardware, same cable already in use), Roku (IP address
  only, no pairing), and Samsung (IP + one-time on-screen pairing). Includes
  test buttons for power on/off and input switching, plus a **daily on/off
  schedule** checked every minute, the same pattern already used for the
  existing briefing scheduler. Routes each command to whichever specific Pi is
  actually connected to that TV (local or a remote slave), reusing the same
  direct-reach pattern already used for pushing updates to slaves.
  - CEC requires the `cec-utils` apt package — included in `install.sh` now,
    but a normal zip update won't install system packages, so an existing
    install needs `install.sh` re-run (or `sudo apt install cec-utils`
    manually) to actually use CEC specifically. Roku/Samsung need no extra
    system packages.
  - Found and fixed a real gap while building this: normal zip-based updates
    never ran `npm install` at all (unlike the central server's own update
    path), which would have silently broken the server the moment it required
    the new `ws` package this feature needs for Samsung's WebSocket API. Fixed
    generally — protects against any future dependency addition breaking a
    normal update, not just this one.
  - Known limitation, confirmed relevant for Frame TVs specifically: Samsung's
    remote API exposes one power button (a toggle), not separate on/off
    signals, and whether it lands on true-off or Art Mode depends on a setting
    on the TV itself.
- **Fixed the real cause of "Photo only"/"Photo + time" reverting to normal
  widgets on refresh.** The previous fix (skip the periodic auto-refresh while
  ambient mode is active) was correct in principle, but checked a variable
  (`displayConfig.ambientMode`) that only ever got set once, at initial page
  load — turning ambient mode on live through the app (the normal way anyone
  would actually use it) never updated it, so the skip check was silently
  looking at stale data. Now kept synchronized inside `setAmbientMode()`
  itself, regardless of how or when it's triggered.
- **Fixed photos in ambient mode only being constrained by screen width, not
  height.** Traced to the widget wrapper's CSS (`display:flex;
  flex-direction:column`) — flex containers only auto-stretch children along
  the cross axis (width, for column direction) by default; the main axis
  (height) just sizes to content unless a child explicitly claims it. Fixed by
  having the photo container explicitly fill both dimensions of its parent.
- **Added a "Photo Fit" option** (Devices tab, shown whenever Photo mode is
  active) — Fill / Fit to width / Fit to height, the same three choices the
  normal Photo widget already has, now available for ambient mode too instead
  of being hardcoded to Fill.

## 1.26.4
- **Fixed the actual cause of tagged/specific photos not showing**: the Photos
  tab's general "active" toggle (tap to include/exclude from the default pool)
  was being applied *before* the tag or specific-photo filter — so a photo that
  correctly matched a chosen tag, or was explicitly picked by ID, still got
  silently excluded unless it was *also* separately marked active. Once a tag
  or specific photo has been explicitly chosen, that choice IS the selection;
  "active" now only gates the default, unfiltered pool. Fixed in both the photo
  widget's own filtering and the older Tab-key screensaver's, for consistency.
- **"Photo + time" now matches an existing Clock/Date widget's position**
  automatically, if this display's real layout already has one — ambient mode
  looks like an extension of what's already there instead of something
  different bolted on. Falls back to a new manual corner picker (Devices tab,
  shown only for "Photo + time") only when there's no existing widget to match.
- **Stopped the periodic "Auto-refresh Display" reload from running while
  ambient mode is active** — likely the actual cause of "eventually reverts to
  the normal calendar view." That feature reloads the whole page periodically
  to clear memory drift on long-running kiosks, with no awareness of ambient
  mode at all; reloading a screen that's supposed to be a calm, uninterrupted
  photo display defeats the point, and any hiccup in re-applying ambient mode
  after the reload would leave it stuck on normal widgets until the next
  scheduled reload, possibly hours later.

## 1.26.3
- **Fixed "Photo only"/"Photo + time" ignoring the screensaver's configured tag**
  — the ambient photo widget carried neither a tag nor a specific-photo setting
  at all, so it showed every active photo regardless of what the screensaver was
  actually set to.
- **Redesigned screensaver source selection** (Devices tab): choose either a
  **Tag (slideshow)** — cycles through every photo with that tag — or **One
  specific photo** (no cycling), per screen. Changing this while Photo mode is
  already showing on screen now correctly rebuilds it live instead of leaving
  the currently-displayed photo stuck on the old setting.
- **Defensive fix for photo overflow/fit issues**: a full-screen photo widget
  (100% width/height) no longer has rounded corners, which at that size were
  clipping small triangles of the image at each corner.

## 1.26.2
- **Rebuilt "Photo only" / "Photo + time" Display Mode from scratch**, replacing
  the CSS-class-toggling "hide the canvas, force a special background photo
  mode" pipeline with something much simpler: it now synthesizes a temporary
  full-screen widget layout (a real Photo widget, plus real Clock/Date widgets
  for the "+ time" variant) and feeds it through the exact same `renderLayout()`
  every normal widget already uses. This reuses the Photo widget's independent
  tag filter (1.26.1) instead of the old, separate screensaver-tag-only path,
  and reuses the existing Clock/Date rendering and per-second update instead of
  a hand-rolled overlay. Still fully live via the existing app-driven toggle —
  no reload needed to switch in or out.
- **Fixed a real, separate bug found while rebuilding this**: the photo
  slideshow timer only ever ran as part of the old background-photo mechanism —
  a normal Photo widget configured with multiple photos never actually advanced
  through them at all, stuck showing just the first one indefinitely. Replaced
  with a single, always-running shared timer that correctly drives slideshow
  cycling for any photo-consuming widget, not just the background mode.

## 1.26.1
- **Gave the photo widget its own independent tag filter**, separate from
  whatever tag a screen's screensaver happens to be set to. Previously the
  widget had no tag concept of its own at all — `photosForWidget()` was built
  directly on top of the screensaver-specific `activePhotos()`, so the widget
  structurally always showed whatever the screensaver's tag pulled in, with no
  way to point it at something different. New "Filter by Tag" dropdown in the
  photo widget's settings, independent of the screensaver's tag setting in the
  Devices tab. Also made sure that dropdown populates correctly even if the
  Layout tab is opened before ever visiting Devices (the tag list used to only
  get loaded as a side effect of that other tab rendering).

## 1.26.0
- **Fixed Photo-only/Photo+time Display Mode showing a blank screen** despite
  having correctly tagged photos. `fetchPhotos()` had no retry logic — unlike
  `fetchLayout()`/`fetchDisplayConfig()`, which got this exact fix back in
  1.21.1 after finding the same failure pattern there. A single failed fetch
  left `state.photos` empty for the rest of the session (nothing crashed, since
  everything downstream defensively falls back to an empty list), which with
  widgets hidden in photo mode renders as a blank screen with no error anywhere.
  Now retries the same way the other two already do.
- **Raised the cap on `--ui-scale` for real (non-preview) displays** from a hard
  1.0 to a bounded 2.0. The scale factor was already being computed on the real
  device (contrary to what I initially, incorrectly said — it's genuinely wired
  up), but explicitly refused to ever exceed 1.0, meaning a 4K screen rendered
  widget fonts at the exact same pixel size as a 1080p one, looking small and
  cramped relative to everything else (which does scale, being percentage-based).
  A prior version allowed unlimited upscaling and reportedly broke the wall
  display, per an existing code comment — raising to a bounded max (2x, covering
  4K relative to the 1080p reference) rather than removing the cap outright, to
  get real cross-resolution scaling without reopening that original failure.
- **Renamed the "Displays" tab to "Devices."** It's primarily about managing
  physical screens (orientation, rotation, ambient mode, which profile each one
  shows), with profile/layout management as a secondary, clearly-labeled section
  within it — but the tab's own name read like it was about display *profiles*,
  the same terminology used elsewhere for the actual content side of things. That
  one-word collision was the real source of confusion, not the underlying
  architecture (screen ↔ profile assignment, many-to-one, is a sound and
  intentional design — it's what lets multiple screens share one layout).
  Updated a few in-app references that pointed to the old tab name to match.

## 1.25.2
- **Added resizing to Fine-Tune Position** — the same corner and edge-middle
  handles now appear on the widget within the zoomed fine-tune view, using the
  same resize math as the main canvas, just converted through the zoom stage's
  dimensions — so the same finger movement produces a finer, more precise size
  change than resizing at full-canvas scale.
- **Fixed calendar-event widgets (especially Agenda) rendering oversized in Live
  Preview.** Their text correctly scales with the display's `--ui-scale`, but
  several spacing values around it — padding, gaps, margins, and particularly the
  colored event-bar's width/height — were fixed, unscaled pixel values. At full
  wall-display size these are proportionate; shrunk down for a small preview, the
  now-tiny (correctly-scaled) text sits next to spacing/bars that stayed full
  size, making the whole thing look broken/oversized. Fixed across Agenda,
  Upcoming, and Today, including their Cards and Compact layout variants.

## 1.25.1
- **Fixed Fine-Tune Position's zoom being too aggressive** — a fixed 5x zoom
  blows anything bigger than ~20% of the canvas up past the edges of the
  viewport entirely, so only the middle of most widgets was ever visible, edges
  never in frame. Zoom is now computed from the widget's own size instead of a
  flat multiplier — small widgets still get zoomed in a lot for precision, large
  ones only a little (or even slightly shrunk, for anything close to full-canvas
  size), so edges stay visible regardless of how big the widget is.

## 1.25.0
- **Fixed Live Preview showing the wrong shape/resolution** — a portrait layout
  could render landscape-shaped with the wrong proportions. The real cause: I'd
  built a second, competing scaling system in the app, when display.html already
  has its own complete one (`applyPreviewScale()`, used by its existing phone-
  preview link) — which uses the *server-reported* screen resolution as its
  reference, completely ignoring whatever resolution the Live Preview picker had
  selected. Fixed properly this time by making the *existing* mechanism accept a
  `?previewResolution=` override instead of maintaining a parallel one — the app
  now just tells display.html what resolution to use and lets its own (already
  correct) letterboxing/font-scaling logic handle everything, rather than
  fighting it with a second implementation.
- **Added "↗ Open in New Tab"** next to the Live Preview controls — the embedded
  preview is intentionally a small, non-interactive thumbnail, so this opens the
  same display/orientation/resolution as a real full page you can pinch-zoom and
  scroll around freely.
- **Removed Snap to Position** (the 9-point anchor grid from 1.23.0) — replaced by
  what was actually wanted:
  - **Edge-middle resize handles** — widgets could only be resized from their four
    corners (always changing width and height together); there are now also
    handles at the middle of each edge, for adjusting just width or just height
    independently.
  - **Fine-Tune Position** — a new zoomed-in view in the widget settings panel,
    centered on the selected widget, for small drag adjustments that are easier
    to land precisely than dragging at full-canvas scale on a small phone screen.

## 1.24.2
- **Fixed the real cause of Live Preview's crash** — 1.24.1's iframe-isolation fixes
  were real and correct, but not the actual problem: `previewOn` and the
  `window.addEventListener('resize', ...)` handler were declared *inside*
  `drawEditor()`, which re-runs every time the Layout tab redraws (switching
  orientation, switching display profile). `window` itself never gets recreated,
  so every single redraw registered another resize listener on top of all the
  previous ones — each holding its own increasingly stale copy of `previewOn` —
  and none of them were ever cleaned up. This is exactly the signature the
  crash pattern pointed to: works fine right after a fresh page load, breaks
  again after using the app for a while, fixed again by reloading. Both
  `previewOn` and the resize listener are now declared exactly once, at the top
  level, alongside the app's other persistent editor state.

## 1.24.1
- **Fixed Live Preview causing real instability** (crashing, kicking back to the
  Calendars tab) — 1.24.0's preview iframe was, in every meaningful way, running a
  second full instance of the real display: it opened its own SSE connection, ran
  every widget's own polling interval (weather, stocks, news, etc.) indefinitely,
  and registered a persistent 30-second server check-in loop — none of which ever
  got cleaned up when the preview was toggled off, since closing it only hid the
  iframe rather than destroying it. Worse: `resolveAssignedProfile()` runs
  unconditionally at the very start of the page's init, before any preview-specific
  logic — and it was writing the **host device's own real, persistent canonical
  identity** into `localStorage`, which is shared with the parent app on the same
  origin, then using that adopted identity in every API call the preview made for
  the rest of the session.
  Fixed at each layer: the SSE connection, check-in loop, and wake-lock timer no
  longer start at all in preview mode; the host's canonical identity is now never
  persisted to shared storage from a preview (only kept in memory for that one page
  load); and closing the preview now actually destroys the iframe's document
  (`src` → `about:blank`) instead of just hiding it, so anything still running
  genuinely stops.

## 1.24.0
- **Live Preview in the Layout tab**: a "🔍 Live Preview" toggle that swaps the
  abstract editing boxes for the actual, live-rendered display — real widgets,
  real data, real fonts — scaled down to fit the phone. Pick a resolution (common
  presets, this device's own reported real resolution, or a custom size) and it
  renders at true proportions via a scaled iframe, so you can check how something
  really looks without walking over to the TV. The server-side piece for this
  (each display self-reporting its real resolution specifically "for accurate
  previews") already existed — the preview UI itself just hadn't been built yet.
- Fixed a related gap found while building this: there was no way to tell the
  display which orientation to render in preview besides its own detection logic
  (which can depend on the actual screen's reported resolution) — added a
  purely-additive `previewOrientation` URL override so the Live Preview reliably
  shows the orientation currently being edited, without changing how any real
  display detects its own orientation.

## 1.23.0
- **Secondary text color**: widget settings now have an optional "Use a different
  color for secondary text" toggle. When on, a second color picker controls every
  "secondary" element within that widget (AM/PM, date strings, forecast lows, task
  due dates, and the ~50 other spots fixed in 1.22.2) independently from the
  widget's main text color, instead of just a dimmed version of it. Left off,
  behavior is unchanged from before.
- **Remote "Display Mode" per screen**: new dropdown in the Displays tab — Normal
  (full layout) / Photo only / Photo + time. Reuses the existing Tab-key "blanked"
  photo rendering under the hood, applies instantly via a live command (no reboot,
  no page reload), and persists so it survives a refresh. "Photo + time" adds a
  clock/date overlay, styled to stay legible over any photo.
- **Snap to Position**: a 9-point anchor grid (corners, edges, center) in the
  widget settings panel, with an adjustable margin, for one-tap positioning
  against a screen edge/corner instead of manual dragging. Sets the widget's
  position once, the same as dragging it there by hand — not a new persisted
  "anchored" mode, so it's still freely movable afterward.
- **Lock Position**: a per-widget lock toggle in its settings panel. While locked,
  a 🔒 badge shows directly on the widget in the layout editor, its resize handles
  don't appear, and dragging is disabled — while still selectable, so its
  settings (including unlocking it again) stay reachable.

## 1.22.2
- **Widget text color now applies consistently across every widget**, not just
  Clock/Date (fixed last release) — this was confirmed to be a genuinely
  widget-wide issue, not isolated to the two originally reported. Fixed at the
  root this time: the shared base `.widget` class (the same element a per-widget
  text-color override is actually set on) now declares `color: var(--text)`
  itself, so any text inside any widget that doesn't set its own color correctly
  inherits that widget's real resolved color — global default or per-widget
  override — instead of silently inheriting from all the way up at the page
  body, unaffected by anything set on that specific widget. On top of that
  structural fix, ~50 additional spots that were hardcoded to `var(--muted)` or
  `var(--accent)`/`var(--accent2)` (secondary/label text across weather, calendar,
  agenda, tasks, news, stocks, countdown, moon phase, timer, on-this-day, daily
  quote, sports, METAR, chore chart, and hourly weather) now derive from
  `var(--text)` too, using opacity to keep secondary text visually distinct
  instead of a disconnected fixed color. Genuinely functional/semantic colors —
  the today-highlight badge, and the stock up/down/flat indicator triad — were
  deliberately left untouched, since those exist to convey status and shouldn't
  shift just because someone picked a different text color.

## 1.22.1
- **Fixed the Clock and Date widgets only partially responding to their text color
  setting.** A widget's color picker works by setting a `--text` CSS variable
  scoped to that widget — but that only actually changes anything where a rule
  explicitly reads `color: var(--text))`. None of Clock's or Date's inner elements
  did: the main clock digits and the date's day-name had no color rule of their
  own at all (silently inheriting a color fixed way up at the page's `body` level,
  unaffected by the per-widget override), while AM/PM and the date string were
  hardcoded to `var(--muted)`/`var(--accent2)` — different variables entirely, so
  they never moved no matter what color was chosen. All four now explicitly use
  `var(--text)`, with the secondary elements (AM/PM, the date string) kept
  visually distinct via opacity instead of a disconnected fixed color, so the
  whole widget consistently follows whatever color is actually chosen.
- **Note**: this same pattern (a sub-element hardcoded to `--muted`/`--accent2`
  instead of deriving from `--text`) appears in roughly 50 other places across the
  stylesheet, affecting other widgets too — only Clock and Date were fixed here,
  since those were the ones reported. Worth a broader pass if this comes up again
  elsewhere.

## 1.22.0
- **The installer now offers to switch a Wayland session to X11 up front**,
  defaulting to yes. Across a full night of real hardware testing, Wayland/labwc
  was the source of nearly every hard-to-diagnose kiosk problem hit — cursor-hiding
  tools that silently did nothing on some builds, a GPU/EGL driver incompatibility
  that cascaded into real Chromium instability, and XWayland-vs-native-Wayland
  input/rendering mismatches that don't exist under X11 at all. X11 was solid every
  single time it was tried. Since switching requires a reboot to take effect, the
  installer exits cleanly with reboot + re-run instructions after switching, rather
  than trying to continue configuring now-irrelevant Wayland-specific settings in
  the same run. Falls back to printing the manual `raspi-config` menu path if the
  non-interactive switch command isn't supported on a given OS image (confirmed
  during testing: not guaranteed to exist everywhere). Skippable — answering "n"
  keeps the existing Wayland setup and configuration continues as before.

## 1.21.7
- **Found and fixed the actual reason X11 autostart wasn't working at all**, after
  the previous fix correctly wrote a well-formed, correctly-located-by-assumption
  file that `lxsession` never once read: `lxsession` loads its autostart file from
  `~/.config/lxsession/<session-name>/autostart`, and the session name isn't a safe
  constant. The installer assumed the common older name `LXDE-pi`; this exact
  Trixie-based image actually runs a session named `rpd-x` (confirmed directly —
  both the running `lxsession -s rpd-x` process and lightdm.conf's `user-session=`
  setting agree). Now reads the real session name from `lightdm.conf` directly
  instead of assuming, falling back to `LXDE-pi` only if that lookup is empty.

## 1.21.6
- Session-type detection (used to decide how to set up cursor-hiding and where to
  write kiosk autostart config) now asks `systemd-logind` directly which type the
  real seat0 session is running, instead of relying on `raspi-config nonint
  get_wayland` — confirmed by direct testing that this raspi-config function
  doesn't exist at all on some OS images (`get_wayland: not found` on a
  Trixie-based image), silently breaking detection on every run. Also fixed: seat0
  can have more than one session at once — a tty console alongside the real
  graphical one — so grabbing just the first seat0 match could land on the console
  instead of the display; now loops through all seat0 sessions and uses the first
  one whose type is actually `x11` or `wayland`.
- Autostart file selection also now branches on the actually-detected session type
  explicitly, rather than on whether `~/.config/labwc` merely exists on disk —
  switching an existing install from Wayland to X11 leaves that directory sitting
  around, which used to cause a re-run to keep silently writing to the wrong,
  inert file instead of the one X11/LXDE-pi actually reads
  (`~/.config/lxsession/LXDE-pi/autostart`, which also needs different syntax —
  `@command` per line, no shell chaining or backgrounding — now written correctly).

## 1.21.5
- **Found and fixed the actual cause of the mouse-nudge workaround not working**:
  `xdotool` was failing silently on every attempt (`Can't open display: (null)`) —
  a background script launched from the session autostart doesn't reliably inherit
  `DISPLAY` the way an interactive SSH shell does, and its stderr was being thrown
  away, hiding the failure completely. It was never a distance or timing problem
  (1.21.4's larger sweep was chasing the wrong theory) — the command never ran
  successfully even once. Now explicitly sets `DISPLAY=:0` (confirmed correct via
  direct testing) and logs to `/tmp/pi-calendar-xdotool.log` instead of discarding
  output, so any future failure here is immediately visible instead of silent.
  **However**: further direct testing after this fix showed the move succeeding
  (exit code 0) with no visible cursor movement at all — confirming XWayland's
  pointer state is isolated from the real, compositor-level cursor Chromium
  displays when rendering as a native Wayland client. No amount of XWayland-layer
  synthetic input (`xdotool`) was ever going to reach it. The documented, actually
  guaranteed fix for this whole category of problem is switching the desktop
  session to X11 (`sudo raspi-config` → Advanced Options → Wayland → X11), where
  everything — including Chromium itself — becomes genuinely X11-native and
  classic `unclutter` works reliably via XFixes with no compatibility-layer gap.
- **Fixed a real installer bug found while preparing for that switch**: autostart
  file selection was based on whether `~/.config/labwc` existed on disk, not on
  the actually-detected session type. Switching an existing install from Wayland
  to X11 leaves that directory sitting on disk (raspi-config doesn't clean it up),
  so re-running the installer after switching kept silently writing to the now-
  inert labwc autostart file instead of the one X11/LXDE-pi actually reads
  (`~/.config/lxsession/LXDE-pi/autostart`, which also uses different syntax —
  `@command` per line, no shell chaining or backgrounding). Now branches on the
  detected session type explicitly and writes correct, working X11/LXDE-pi
  autostart entries.
- **And the session-type detection itself needed two more real fixes**, found only
  by testing directly on real hardware rather than assumed: (1) `raspi-config
  nonint get_wayland` — previously the primary signal — doesn't exist as a
  function at all on some OS images (confirmed: `get_wayland: not found` on a
  Trixie-based image), silently breaking detection on every run regardless of
  check ordering; replaced with asking `systemd-logind` directly which session
  type the real seat0 session is running, which doesn't depend on an internal
  raspi-config function name staying stable across OS versions. (2) seat0 can
  have *more than one* session at once — a tty console alongside the real
  graphical one (confirmed directly: session 1 was `tty`, session 3 was the
  actual `x11` session) — so grabbing just the first seat0 match landed on the
  console, not the display. Now loops through all seat0 sessions and uses the
  first one whose type is actually `x11` or `wayland`.

## 1.21.4
- Increased the synthetic mouse nudge from 1.21.3 (1px, no gap between the
  there-and-back moves) to a much larger, clearly-real sweep (200px, with an actual
  0.5s pause in between) — the 1px version wasn't enough to register on at least one
  real setup. Still a pragmatic workaround, not a confirmed root-cause fix; if this
  distance still doesn't help, that would point to the synthetic input not reaching
  whatever's actually tracking cursor visibility at all (rather than a
  distance/timing threshold), which would call for a different injection approach.

## 1.21.3
- **Pragmatic fix for the cursor only hiding after it moves**, on setups where
  neither `--start-hidden` nor the CSS `cursor: none` rule resolve it (confirmed by
  direct, repeated testing rather than assumed — this is a workaround, not a
  root-cause fix; exactly why this specific compositor/browser combination needs a
  real motion event isn't fully nailed down). `wait-for-server-and-launch-kiosk.sh`
  now nudges the pointer 1px and back, a few seconds after Chromium launches, via
  `xdotool` (new dependency — added to `install.sh`; needs a manual
  `sudo apt-get install -y xdotool` on an existing install, since a code update
  can't run apt installs).
- **Note for existing installs**: unlike other kiosk-line fixes this cycle, this one
  needs *no* manual autostart edit — the fix lives inside
  `wait-for-server-and-launch-kiosk.sh` itself, which a normal code update already
  replaces automatically.

## 1.21.2
- **Fixed the cursor not staying hidden on some real displays.** Not actually an
  `unclutter-xfixes`/OS-level cursor problem (that was a red herring pursued last
  release) — the page has an existing, correct `cursor: none !important` CSS rule
  for the real kiosk view, but it deliberately excludes "preview mode" (used when
  someone's previewing a layout on their phone in the app's Layout tab, where a
  visible cursor is wanted). With no explicit `?preview=`/`?nopreview` URL param,
  preview mode was being *guessed* from viewport size alone (anything under 1100px
  on its larger dimension assumed to be a phone/tablet, not a real wall display) —
  a guess a smaller or portrait-oriented real display can trip just as easily as an
  actual phone, silently defeating the cursor-hiding rule for a completely
  different reason than anything about cursor-hiding tools. The kiosk launch URL
  now explicitly appends `?nopreview`, so this is deterministic instead of guessed
  for the one case that matters most.
- **Note for existing installs**: same as other kiosk-line fixes this cycle — needs
  a one-time manual edit to the existing `~/.config/labwc/autostart` (append
  `?nopreview` to the URL) since the installer won't touch it automatically. A fresh
  install gets this correctly from the start.

## 1.21.1
- **Fixed orientation/rotation not persisting across a boot** — same underlying bug
  category as several other fixes this cycle (a boot-time fetch with no retry,
  silently keeping stale/default state on a single transient failure). Display
  rotation and orientation are handled entirely in-browser (no OS-level rotation
  needed), loaded once via `fetchDisplayConfig()` at boot — which, if that one fetch
  failed for any reason, used to silently keep the default (`rotation: 0`,
  unrotated) forever, with no retry and nothing to ever self-correct it, since
  nothing on the *server* side had changed to trigger the normal live-update
  re-sync. This is exactly why switching to a different layout and back "fixed" it
  — that action genuinely changes server state, coincidentally triggering the same
  reload-config path that should have succeeded cleanly at boot. Both
  `fetchDisplayConfig()` and `fetchLayout()` now retry (4 attempts, 1.5s apart)
  before giving up.

## 1.21.0
- **Found and fixed the real cause of a persistent (not just intermittent) white
  screen on lower-end hardware** (confirmed on a Pi 3 B+): Chromium's GPU process
  was failing to create a GLES 3.0 context (`EGL_BAD_ATTRIBUTE`) because VideoCore
  IV — this hardware's actual GPU — doesn't support ES 3.0 at all, no matter how
  long it's given to retry. That failure cascaded into real Chromium instability
  (the network service crashing and restarting, child processes self-terminating
  after "15 seconds with no connection"), which could leave the page never
  successfully painting. The kiosk now launches with `--disable-gpu`, forcing
  software rendering — plenty for this app's mostly-static, periodically-refreshing
  content, and sidesteps the driver incompatibility entirely.
- Added Chromium flags to trim memory/CPU overhead this kiosk never needs
  (`--disable-extensions`, `--disable-component-update`,
  `--disable-background-networking`, `--disable-sync`,
  `--disable-features=Translate`, `--renderer-process-limit=1`) — meaningful on a
  low-RAM Pi (e.g. a 1GB Pi 3) where Chromium's full process tree is competing with
  the server's own boot-time work (calendar sync, etc.) for headroom. Also stops
  Chromium's repeated (and pointless, for a kiosk) Google Cloud Messaging
  registration retries that were cluttering the logs.
- `pi-calendar.service` now waits on `systemd-time-wait-sync.service` (in addition
  to network-online) before starting. This matters most on hardware with no
  battery-backed real-time clock (a Pi 3 and earlier have none): after a hard power
  cycle — as opposed to a graceful reboot, which saves/restores an approximate time
  — the system clock can come up significantly wrong until NTP corrects it, which
  can disrupt anything timestamp-sensitive during boot (Tailscale auth, HTTPS
  certificate validation for calendar sync) and cascade into exactly the kind of
  resource contention that can starve Chromium of what it needs to finish starting.
  Safe no-op on any system where this particular systemd unit isn't present.
- **Note for existing installs**: the GPU/memory-trimming flags need the same manual
  autostart edit as previous kiosk-line fixes (installer won't overwrite an existing
  autostart file). The systemd time-sync dependency, however, *will* apply
  automatically — just re-run `install.sh` and say yes when it offers to update the
  existing service file; nothing else gets touched.

## 1.20.1
- Added `--start-hidden` to `unclutter-xfixes` (both the installer and the manual
  `kiosk` command). On a kiosk with no real mouse ever attached, `unclutter-xfixes`
  previously only started its hide timer after a genuine pointer motion event — with
  nothing to ever generate one, the cursor could sit visible indefinitely from boot.
  This hides it immediately instead, no motion required first.
  **Note for existing installs**: this only takes effect for a fresh install/reboot
  of the autostart file — an existing Pi already has the old cursor line baked into
  `~/.config/labwc/autostart` and won't pick this up from a normal code update alone.

## 1.20.0
- **Fixed a second, different cause of the white-screen-until-F5 boot issue** — this
  one specifically on WiFi-connected slave displays, and unrelated to the 1.19.0 boot
  race fix. `display.html` loaded Google Fonts via a render-blocking CSS `@import`,
  plus a non-deferred `<script>` for the QR code library — both from external CDNs.
  If the Pi's WiFi/DNS was still settling at the exact moment Chromium loaded (a
  separate, slower path than the trivial `localhost` connection the 1.19.0 fix waits
  on), the page would hang waiting on those external fetches and show nothing at all
  until they resolved — which could take a while, or effectively never, until a
  manual refresh happened to land after connectivity caught up. Fonts now load
  asynchronously (preload → swap to stylesheet once fetched, falling back to the
  system sans-serif font already declared for the page in the meantime) and the QR
  script is deferred, so first paint no longer depends on reaching either CDN at all.
  Applied the same fix in the control app (`app.html`) for consistency.
- No system dependencies, database schema, or systemd/kiosk configuration changed in
  this release — a normal update is sufficient, no SSH/manual steps needed.

## 1.19.0
- **Fixed the "white screen until you hit F5" boot issue.** The Chromium kiosk
  launch and the pi-calendar server start independently at boot with no
  coordination between them — it used to be a flat `sleep 8` guess before
  launching the browser. On any boot slower than that guess (SD card
  contention, an older Pi, heavy first-boot activity), Chromium would load
  before the server was actually listening, get a connection failure, and —
  since kiosk mode has no retry-on-failure — just sit there blank until
  someone manually refreshed. The "auto-refresh display" setting couldn't
  help either, since it's JavaScript running *inside* the page, and if the
  initial load fails there's no page for it to run in. Replaced the fixed
  sleep with a script that actually polls for the server to be ready before
  launching the browser. **Note for existing installs**: the installer
  deliberately never overwrites an existing kiosk autostart line, so this
  requires either re-running install.sh after removing the old kiosk line
  from `~/.config/labwc/autostart`, or editing that line by hand.
- **Fixed Gmail briefing emails failing with `connect ENETUNREACH`.** Node
  doesn't automatically fall back to IPv4 the way a browser does — if DNS
  handed back an IPv6 address for smtp.gmail.com and the network's outbound
  IPv6 was broken or partial (common on many home ISPs/routers), the
  connection just failed outright, before ever reaching the login step. This
  looked exactly like an app-password problem but had nothing to do with it.
  The mail transport now forces IPv4.
- Mail-sending errors (test send, scheduled briefing, feedback digest) are now
  translated into plain language instead of a raw Node error string — a
  parent seeing a failure will now be told directly whether it's an
  auth/app-password problem, a network problem, or a DNS problem, rather than
  a string like `connect ENETUNREACH 2607:f8b0:4023:2c03::6c:465`.

## 1.18.0
- Added a **METAR/TAF widget** (NOAA Aviation Weather Center — free, no key needed).
  Shows current conditions (temp/dewpoint, wind, visibility, altimeter, sky
  condition, present weather) plus a computed flight-category badge (VFR/MVFR/
  IFR/LIFR — not returned directly by the API, derived from visibility and cloud
  ceiling the same way a pilot reads a METAR at a glance), and the raw TAF forecast
  text with its valid period. Enter any 4-letter ICAO airport code.
- Fixed a real bug while building the above: NOAA's TAF `issueTime` field is a UTC
  timestamp with no timezone marker in the string — `new Date()` would otherwise
  silently misinterpret it as the server's local time.
- Added detection for a very common mistake when adding a Google Calendar: pasting
  the `calendar.google.com/calendar/u/0?cid=...` browser link (Google's "open this
  calendar" link) instead of the actual iCal feed URL. That link requires a Google
  login and returns a webpage, not calendar data — it used to fail with a generic
  "didn't look like a calendar file" error. Now caught before it's even submitted,
  with the specific fix (Settings → pick the calendar → "Secret address in iCal
  format", which ends in .ics).

## 1.17.0
- Added a way to **manually push an update to slave displays** instead of only
  relying on the automatic push that fires right after the host updates itself.
  Self-packages whatever code the host is currently running into a fresh zip on
  demand — no dependency on some earlier upload artifact still being around.
  Available from Settings → Software Update (push to all slaves, with a live
  "2 of 3 online slaves are behind" summary) and from the Displays tab (a per-screen
  ⬆️ button that only shows up next to a screen that's actually behind, for
  retrying just the one that missed the last push).
- **Fixed a real gap** while building the above: the previous auto-push-to-slaves
  mechanism only staged a copy of the update when you installed via direct zip
  upload — pulling the update from the central server never staged anything, so
  that path silently never propagated to slaves at all. Both paths now go through
  the same self-packaging step, so a push always fires regardless of how the host
  itself got updated.
- **Better proactive communication that an update is available**, checked once when
  the app opens and every 10 minutes after — not just when you happen to be looking
  at the right tab:
  - A banner when the central server has a newer release than the host.
  - A separate banner when one or more online slave screens are running an older
    version than the host.
  - Small notification dots on the Settings and Displays tabs that clear once
    visited and reappear on the next check if still relevant.
- New system dependency: the `zip` CLI (for creating archives — `unzip` was already
  required, this is its counterpart for building the push package). Added to
  install.sh; since an existing device won't re-run that script on a normal update,
  a missing `zip` now fails with a clear "run `sudo apt-get install -y zip`" message
  instead of a cryptic spawn error.

## 1.16.0
- **Fixed a real bug**: chore day-rollover used the UTC calendar date instead of the
  Pi's local date (`toISOString().slice(0,10)` converts to UTC first). Depending on
  the Pi's timezone offset, this made daily chores reset several hours before local
  midnight (US timezones) or stay stuck on "yesterday" for hours after midnight
  (timezones ahead of UTC) — exactly the "chores don't populate on schedule" symptom.
  Replaced with a shared local-date/local-time helper used everywhere "what day/time
  is it right now" matters (chores, the daily briefing scheduler, the feedback digest
  scheduler, which had the same latent bug).
- Added a manual **Timezone override** in Settings → Display (curated list + custom
  IANA name) so a family can fix this themselves if the Pi's own system clock/timezone
  is ever wrong — e.g. a fresh SD card defaulting to UTC — without needing SSH access.
- **Chores got substantially more robust:**
  - The allowance system (per-chore pay, flat weekly, payouts, bonuses/deductions,
    full ledger) was already fully built server-side but had no way to actually use
    it — the 💰 button called a function that didn't exist, and neither the kid nor
    chore editors exposed the fields. Built the missing UI end-to-end.
  - Chore notes and per-chore pay were already stored and returned by the API but
    never shown to the kid — now displayed on their chore list.
  - Bulk-assign: a chore's "Who?" can now target a specific combination of kids
    (tap-to-toggle pills), not just "Everyone" or exactly one kid.
  - Added daily streaks (🔥, shown on the kid's screen and the wall display chore
    chart), a parent-facing History view (7/30-day completion %, all-time total,
    4-week bar chart), and an optional savings goal with a progress bar.
  - Expanded the emoji picker (new Feelings, Weather, School, and Holiday categories)
    and added a "Recently Used" row; also fixed the search box, which was rendering
    undersized next to the Done button.
- **8 new widgets:** Countdown (with yearly-repeat for birthdays/anniversaries), Moon
  Phase (computed locally, no internet needed), Air Quality/Pollen/UV (Open-Meteo,
  reuses your Weather location), QR Code (WiFi join or plain text/URL), Timer
  (Start/Pause/Reset from the phone, since the wall display has no touch input),
  On This Day and Daily Quote (both free/keyless, refresh once a day), and Sports
  Scores (TheSportsDB free tier — shows the next scheduled game and last final score;
  true live in-play ticking needs their paid tier, so that's not included).
- Extended the Stocks widget to support crypto pairs (e.g. BTC-USD) with quick-add
  buttons for BTC/ETH/SOL/DOGE, a "crypto" tag, and adaptive decimal precision so
  low-value coins don't render as "$0.00".

## 1.15.9
- "Updates" (Manual/Automatic) now follows the host to every screen, like the beta
  channel already did, instead of each screen choosing independently. A screen shows
  a note that its main device controls this.
- Diagnosed a real cause of a stuck slave: a screen running a version from before the
  central server URL was hard-coded (pre-1.12.12) has no way to find the update server
  on its own — it needs one manual zip install to get current, after which auto-update
  and host push both work normally.

## 1.15.8
- Each screen in the Displays tab now shows the app version it's running, and flags
  it with a warning if it's behind the host's version — so you can immediately tell
  if a screen just hasn't picked up an update yet, instead of guessing.

## 1.15.7
- Fixed a real bug (not a Displays/Profiles regression, though it looked like one):
  after a remote screen finished syncing from the host, it never told its own display
  to redraw the layout. Layout edits were saving correctly and pulling down to the
  screen's database correctly, but the actual TV never got the signal to refresh —
  so it always showed a stale layout until a manual reload. This also affected the
  real-time "host is editing" fast-sync feature, which relied on the same code path.

## 1.15.6
- Fixed a real gap from combining Displays and Profiles: there was no direct way to
  jump from a screen or profile to editing its actual layout — you had to separately
  go to the Layout tab and manually pick the matching profile, which was easy to get
  wrong (editing the wrong profile looks exactly like "nothing updates on my screen").
  Added a 🎛️ button on both the screen row and the profile row that jumps straight to
  the Layout tab with the right profile already selected.

## 1.15.5
- Added a font-size control to the Chore Chart widget (it was the one text widget
  missing one). All text now scales together proportionally with the slider.
- Standing rule going forward: every widget with visible text gets a font-size control
  from the start; Photo remains the only exempt widget since it has no text.

## 1.15.4
- Fixed: per-screen Orientation, Rotate view, and Screensaver shows settings were
  saving correctly but never displayed back after leaving and returning to the
  Displays tab (they always reset to their defaults on screen). The GET endpoint
  that feeds the tab was missing those three fields; now included.

## 1.15.3
- Added bulk photo tagging: tap "Tag multiple" in the Photos tab, select several
  photos, and apply one tag to all of them at once (instead of tagging one at a time).
  Makes it fast to build a screensaver album, e.g. tag a batch "kids" for one screen.

## 1.15.2
- Each screen can now show its own subset of photos on its screensaver/Tab View. Tag
  photos in the Photos tab (tap the little tag icon), then in the Displays tab set a
  screen's "Screensaver shows" to that tag. Leave it on "All photos" for the previous
  shared behavior — nothing changes unless you set a tag.
- Fixed a dormant bug in the old feedback-digest scheduler (disabled since feedback
  moved to one-at-a-time) that had the same multi-device flaw the daily briefing had;
  it is now fully turned off rather than left running unused.

## 1.15.1
- Each physical screen can now set its own orientation and rotation, overriding the
  profile's — ideal for a TV mounted sideways. Leave on "Use profile's" to inherit.
  Found under each screen in the Displays tab.

## 1.15.0
- Combined the Displays and Profiles areas into one screen. Your physical screens are now
  the main list, each with an inline picker to choose the layout (profile) it shows.
  Profile, template, and saved-layout management is grouped into one collapsible
  "Layouts & profiles" section below (auto-opens when you only have one screen).

## 1.14.4
- Fixed daily briefing not sending on schedule after a second device was added: only
  the host now runs the briefing scheduler, and the last-sent marker is per-device so a
  screen can no longer suppress the host's send. (Manual send/preview was unaffected.)
- Added a Chores on/off switch (Settings - Features). On by default; turning it off hides
  the Chores tab for households that don't use it.

## 1.14.3
- The Feedback tab now shows new developer replies, and a Show past replies link lets
  you pull up earlier conversations any time (they are no longer hidden for good once read).
- Tidied how update release notes display so sentences no longer break mid-word.

## 1.14.2
- Fixed: devices that were already set up before the setup wizard existed no longer get
  prompted to choose host/display after updating. The wizard now appears only on a
  genuinely fresh, empty install.

## 1.14.1
- Improved the feedback reply box: it is now a full-width field with the Send button
  below it, instead of a cramped box beside the button.

## 1.14.0
- Feedback is now a two-way conversation: when the developer replies to something you
  sent, it appears in the Feedback tab and you can reply back — no email needed.
- New "Get beta updates" option (Settings → Software Update). Off by default; turn it
  on to receive early beta releases. On a multi-device setup the main device controls
  this and the screens follow.

## 1.13.1
- Connected screens (displays) now update in near-real-time while you arrange the layout
  on the host. The host signals when it's being actively edited and screens speed up
  their sync during that window, then relax back to the normal cadence when you stop.

## 1.13.0
- New first-run setup wizard: the first time you open the app on a device, it walks you
  through choosing whether it is your main device (host) or an additional screen, and—for
  a screen—entering your main device's address. Optional steps cover naming the device,
  location, and an app PIN. This is the proper way to add a new screen (a fresh screen
  has to be pointed at its host from its own app).
- Fixed a data-loss bug: when syncing, a blank value from the host can no longer overwrite
  a populated value on another device, so API keys and passwords are never wiped.
- Layout edits now save and push to the display automatically in real time — no need to
  tap Save (the button still works if you want it).

## 1.12.14
- Renamed "Screens" to "Displays" and "Display Profiles" to "Profiles" throughout the app.
- Template categories now start collapsed (including Holidays) for a tidier gallery.

## 1.12.13
- News source order is now World, then National, then Local, then Keyword — in both
  the Settings list and the daily email.
- Feedback: submit one idea at a time (removed the daily-digest email option).
- Multi-device: updating the host now always updates all connected screens to match,
  so every device runs the same version (removed the optional toggle).

## 1.12.12
- The update server and feedback server are now built in — every install
  automatically checks for updates and sends feedback to the central server with no
  setup. Removed the update-server URL field, the feedback central-server fields, and
  the guided server-install option from the UI (the manual app-zip installer remains).

## 1.12.11
- Guided server install no longer uses fragile multi-line terminal blocks: the app
  now writes the .env and systemd service file directly, leaving only a few simple
  one-line commands to finish. Prevents the paste-mangling that could half-apply the
  service configuration.

## 1.12.10
- Stocks widget: maximum font size raised from 24 to 64 for big, glanceable tickers.
- Guided server install is more robust: stops any previous server instance before
  starting (prevents stale processes holding the port), reuses existing secrets on
  re-run instead of generating mismatched new ones, and uses an environment file for
  the service so credentials load reliably.

## 1.12.9
- Guided central-server install from the app: drop the server zip and the app places
  the files, runs the install, and hands you the exact commands to finish.

## 1.12.8
- Central feedback: submissions can now be sent in real time to a central server, so
  feedback reaches the developer even when a device hasn't set up its own email.
  Configurable URL + key in Settings; blank = local + email only, unchanged behavior.

## 1.12.7
- Feedback emails now always go to the developer, regardless of who runs the app.

## 1.12.6
- Added a third weather source: National Weather Service (free, no key, US only).
  Choose your source in Settings; automatic fallback to Open-Meteo if one fails.

## 1.12.5
- Chore chart widget: choose which children appear on each display (defaults to all).
- Selectable screen auto-refresh (F5-style full reload) on an interval you pick.
- Added OpenWeatherMap as a selectable weather source (needs your API key).

## 1.12.4
- Feedback: attach a photo or screenshot to a bug report; it appears in the digest.

## 1.12.3
- Custom chore photos: upload your own picture for a chore.
- Global emoji picker for chore icons and kid avatars (full set, searchable).

## 1.12.2
- New "Home Hub" template: a family command center built around the chore chart.

## 1.12.1
- Four new display templates: Valentine's, Spring Garden, Summer Days, Modern Dark.

## 1.12.0
- New Chore Chart feature: kids check off chores on a tablet, parents manage chores
  and kids in the app, and a live chore-chart widget shows progress on the wall display.
