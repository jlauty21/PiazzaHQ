# Beta Verification Checklist

A running list of everything touched during the **current beta cycle** that
The developer should actually check on real hardware before this cycle gets promoted
to stable. Unlike `CHANGELOG.md` (what changed, for a developer) or
`HANDOFF.md` (why/how, for picking this project back up later), this file
exists purely to answer one question: **"is it safe to promote this beta to
stable yet?"**

**How this file works:**
- Every beta build adds a new dated section below, listing what that
  specific build touched and what's worth checking about it.
- Items accumulate across the whole cycle — nothing gets removed just
  because a later beta shipped.
- **Checking an item off happens in the app** (Settings → Advanced → Beta
  Checklist, tap an item), not by hand-editing `[ ]` to `[x]` in this file.
  Checked state lives in the app's own database
  (`beta_checklist_checked`), NOT in this file's own `[ ]`/`[x]` markers —
  those markers are cosmetic/ignored by the app entirely. This file
  should always be AUTHORED with every item as `[ ]`; don't hand-check
  items here, it won't do anything. (Why the split: this file is treated
  as code and gets wholesale-replaced by every update, same as
  `server.js`; a checkmark stored IN it would silently vanish on the very
  next beta. The database isn't part of what an update replaces, so
  checking survives updates correctly.)
- **On promotion to stable, this file gets wiped back to this same clean
  state** — a fresh cycle starts with an empty list, not a growing
  backlog carried forward from the last one. Anything still unchecked at
  promotion time either got promoted anyway (the developer's call, same as any
  other beta → stable decision) or should have been called out
  explicitly in that promotion's own summary. **Promotion also clears
  `beta_checklist_checked`** (`DELETE FROM beta_checklist_checked;`) so
  the next cycle's items don't inherit stale checkmarks from indices that

**Tags (2026-09-05 pass):** items are marked with what's already been
checked, so a promotion review can focus on the rest:
- `[AV]` — **already verified** by Claude (server-side: real API calls,
  guard rejections, migrations, endpoint shapes; or a synthetic
  end-to-end run). Re-check only if something feels off.
- `[SYN]` — verified, but only **synthetically** (e.g. an always-true
  alert rule, a 2-point sensor). The mechanism works; real-world behaviour
  still worth a look.
- *(no tag)* — **needs you on real hardware**: anything visual on the
  display, real touch/stylus, a real phone, or actuating a real HA device.


## Currently open

### 1.86.0-beta.2 — display no longer comes back blank after an update

- [ ] `[AV]` Normal reboot: widgets render as before (no regression when a
      fresh layout fetch succeeds).
- [ ] **The repro:** push a beta so a display self-updates and reloads while
      the server is restarting. It comes back **with its widgets**, not
      blank — either instantly (from the cached layout) or within ~10–120s
      (the hard-retry fills it in). No need to switch displays and back.
- [ ] A genuinely empty layout still shows empty (the cache never overwrites
      a good layout with nothing, and an intentional empty layout from the
      server clears the cached one).
- [ ] Switching the assigned display profile still loads the new layout
      promptly (cache is per-orientation, corrected on the next fetch).
- [ ] Preview (app Layout tab) unaffected — never reads/writes the layout
      cache.

### 1.86.0-beta.1 — feedback replies as a conversation view

- [ ] **On a phone:** Settings → Feedback & Ideas → tap a reply thread. It
      opens full-screen; messages are chat bubbles (yours right, developer
      left), scrolled to the newest.
- [ ] Tap the message box — the keyboard opens, the input bar sits right
      above it, the conversation stays put, and the page behind does **not**
      scroll. Type a multi-line message: the box grows, the view stays
      pinned to the bottom.
- [ ] Send a reply → it appears immediately as your bubble; the box clears;
      it actually reaches the developer (check the feedback digest).
- [ ] Back arrow closes it and returns to Settings with the thread list
      refreshed. No leftover scroll-lock on the page.
- [ ] The "developer replied" banner: with one new thread, tapping it opens
      that conversation directly (and clears the banner); with several, it
      still goes to the Feedback section list.
- [ ] Desktop: Ctrl/Cmd+Enter sends.

### 1.85.0-beta.1 — searchable HA entity picker

- [ ] Settings → Home Assistant → Alerts → + Add alert: the entity field is
      now a "Choose an entity…" button that opens a search sheet (type part
      of the name OR the entity id; optional area filter; current state
      shown under each). Picking one fills it in.
- [ ] The saved alert rows now show the entity id under the name/condition
      line — a mis-picked entity is visible without opening the rule
- [ ] Favorites → + Add a Card → any HA card: the picker search now matches
      on entity id too, and shows the id under each result
- [ ] `[AV]` The layout-widget entity picker (app + wall display) is
      unchanged in behaviour — it now shares the same code as the new one

### 1.85.0-beta.2 — read-only entity guard + preflight

- [ ] `[AV]` `POST /api/ha/call-action` with `turn_on`/`turn_off`/`toggle`/
      `trigger` aimed at a `sensor` / `binary_sensor` / `weather` / `sun` /
      `air_quality` / `zone` entity → 400 "read-only", before any HA call
      (verify on the host)
- [ ] A Light/Switch tile pointed at a sensor (mis-pick) now shows the
      error instead of silently doing nothing
- [ ] Other domains (light/switch/fan/etc.) still toggle normally
- [ ] `[AV]` dev only: `npm run preflight` checks the three version sites
      agree + the build mirror is in sync + `node --check`; `-- --fix`
      syncs the mirror. Not shipped to devices.

### 1.85.0-beta.3 — edit an HA alert rule in place

- [ ] Settings → Home Assistant → Alerts: each rule row has a ✎ button.
      Tapping it reopens the form pre-filled with that rule's entity,
      condition, value, dwell and message; the confirm button reads "Save
      changes"
- [ ] Saving updates the rule in place — its enabled / 📺 / 📱 state is kept,
      no duplicate row created
- [ ] Cancel leaves the rule untouched and returns to "+ Add alert"
- [ ] Editing the entity via the search sheet, then saving, re-evaluates
      against the new entity (banner reflects the new rule within ~2 min)

### 1.85.0-beta.4 — per-screen HA alert banner (position / size / style)

New `screens.alert_banner_position` / `_size` / `_style` columns; a fresh
migration should default every existing screen to top / m / solid (the
current look).

- [ ] `[AV]` `PUT /api/screens/:id` with `alert_banner_position` (top|bottom),
      `alert_banner_size` (s|m|l|xl), `alert_banner_style`
      (solid|strong|amber|bar|outline|toast) persists + is echoed back by
      `GET /api/screens` and `GET /api/screen-config`; a bad value clamps to
      the default (verify on the host)
- [ ] Devices → a screen → Screen Settings → Display shows a "Home Assistant
      alert banner" group with Position / Text size / Style dropdowns
      reflecting the saved values
- [ ] Fire a test alert, then change **Style** in the app → the banner on
      the wall restyles within a second (no reload), banner still dismissible
- [ ] Change **Text size** → text + padding + the ✕ button all scale together
- [ ] Change **Position** to Bottom → banner moves to the bottom edge;
      with a screen rotation set it's still the visual bottom and upright
- [ ] "Corner toast" style → a rounded card inset from the corner, not a
      full-width strip; top/bottom still respected
- [ ] Each display can hold a different setting (set two screens differently,
      fire the alert, confirm they render differently)
- [ ] A screen never given these settings shows the old look (solid red,
      top, medium)

### 1.85.0-beta.5 — banner: bigger + screen-relative + Center; app-side dismiss

- [ ] On a large / high-DPI screen, "Large" / "Extra large" / "Huge" now
      look genuinely large (sizes are vmin-based, not fixed px). "Small" on
      a tablet is still reasonable.
- [ ] `[AV]` `alert_banner_size` accepts `xxl`; `alert_banner_position`
      accepts `center` (bad values still clamp to `m` / `top`) — verify on
      the host
- [ ] Position → **Center (card)** → a firing alert shows as a centred card
      over a dimmed screen, not an edge strip; multiple alerts stack; the
      dim scrim doesn't block the rest of the UI once dismissed
- [ ] Center + each style still renders sensibly (style = colour/frame only;
      centre wins the geometry)
- [ ] `[AV]` app: `/api/notifications/active` filtered to `kind:"ha-alert"`
      drives a red banner at the top of the phone app; its ✕ POSTs
      `/api/notifications/dismiss` for each and the banner goes away
- [ ] Fire an alert → red banner appears in the app within ~60s (or on
      focus), on BOTH a host-connected app and a slave-connected one
- [ ] Dismiss from the app → the wall-display banner also clears (same
      server state); it does NOT re-fire while the condition stays true
- [ ] App banner appears even with phone push turned off / this phone not
      enrolled — it's independent of push

### 1.85.0-beta.6 — fleet-health telemetry (phase 1)

Device side only; the central server ignores the new params until its own
phase-2 change, so a normal build is functionally unchanged.

- [ ] `[AV]` Normal boot: no crash, `.last-crash` absent, `/api/version`
      unchanged. The 6h check-in still works (watch the log for the
      update-check line, or hit `/api/update-check`).
- [ ] `[AV]` `fetchUpdateInfo` adds `deployment` / `uptime` / `disk` and,
      when HA is configured, `ha=1|0` to the update-check URL. Confirm by
      pointing `update_server_url` at a request bin, or reading the outbound
      URL in a debug log line.
- [ ] Crash-marker round trip: kill the process with an uncaught error
      (or `kill -SEGV`? no — force an exception), confirm `.last-crash` is
      written in the data dir; restart; confirm the log says "Recovered
      from a crash …" and the file is gone after the next check-in.
- [ ] `ha` reflects reality: with HA configured and reachable → `ha=1`
      within ~2 min (checkHaAlerts poll); break the HA URL → next check-in
      sends `ha=0`; HA not configured at all → no `ha` param.
- [ ] `crash` is sent once, not repeated — a second check-in after a
      recovery carries no `crash` param.
- [ ] Windows + container builds: the consolidated crash handler still
      exits the process (systemd Restart / the Windows supervisor / auto-
      rollback all rely on that) — a forced uncaught error must not leave a
      zombie.

Server-side verified this pass (Pi 87 host / 110 slave, real HA):
- [x] `[AV]` state trims carry the right fields per domain (light:
      brightness+colorTempK+colorModes+rgbColor; media: volumeLevel+muted;
      sensor: numeric+unit; cover/lock: bare state)
- [x] `[AV]` wrong-domain action guard: unlock->light, set_brightness->
      cover, volume_set->lock all 400 before touching the device
- [x] `[AV]` /api/ha/history: ~100 points, {t,v}, 24h span, cached (~50ms
      repeat), hours clamps
- [x] `[AV]` condition alert full cycle: PUT (entityId shape) saves ->
      fires within ~6s -> shows in /api/ha-alerts/active + /api/
      notifications/active as kind ha-alert -> slave 110 sees it (proxied)
      -> dismiss clears it and holds (no re-fire while condition stays
      true) -> rule removal clears everything (with the beta.39 fix)
- [ ] MINOR/hardening: `toggle` on a sensor entity returns 200 (HA no-ops);
      not user-reachable (no toggle control on a sensor widget) but the
      server could reject it

### 1.85.0-beta.7 — family profiles + event owners

Server-side verified this pass (local temp DB): first profile forced
`is_manager=1`; second defaults 0; `PUT` partial keeps `pin` when the key is
omitted and clears it on `""`; can't demote or delete the last manager;
deleting a profile nulls `owner_profile_id` on its events; `owner_profile_id`
round-trips through `POST`/`GET /api/events`; `/api/sync/export` carries the
`profiles` table.

- [ ] `[AV]` Zero profiles: the app looks and behaves exactly as before — no
      header chip, no picker, the events list has no "… only" filter, the
      wall's add-event sheet has no "For" row.
- [ ] `[AV]` Create the first profile (Settings → Family profiles → Set up):
      it's marked *manager*; the header chip appears; a second profile is a
      non-manager by default.
- [ ] `[AV]` Preset seeding in the editor: **Basic** ticks off Photos/Layout/
      Devices + both features + lands on Calendar; **Intermediate** = all
      tabs, HA on, integrations off; **Advanced** = nothing hidden. Toggling
      any control flips the label to *Custom* and keeps the values.
- [ ] `[AV]` Switch to a Basic profile: Photos / Layout / Devices / Family
      Hub tabs gone; the Favorites "+ Add a Card" list has no Home Assistant
      section; Settings shows no Home Assistant / Todoist / iCloud push /
      Google push / Daily Briefing sections; the app opens on Calendar; the
      in-app HA alert banner stays hidden even with an alert firing. Switch
      to Advanced → everything returns.
- [ ] `[AV]` Gateway PIN: set one on profile A. From profile B, tap A in the
      switch sheet → PIN prompt; wrong/cancel stays on B; correct switches
      to A. Clear the PIN as a manager → switching in no longer prompts. No
      `/api` call starts failing (it's not an auth token).
- [ ] `[AV]` Non-manager: Settings → Family profiles shows only "Edit my
      profile"; the editor has no manager checkbox and lists no one else.
- [ ] Manager can edit another profile (name/colour/tabs/features/PIN) and
      toggle the manager flag; the last manager's checkbox can't be unticked.
- [ ] **Physical display:** add an event on the wall, tap **For → <name>**;
      the event block renders in that person's colour on every display (not
      its stored colour), and the event-detail card shows "For <name>".
      Change the owner in the app's event list — colour updates on the wall
      after sync.
- [ ] `[AV]` App events list: "<name> only" filter hides other people's
      events and is remembered per device; the owner name + colour dot show
      on each row.
- [ ] `[AV]` Slave sync: create/edit a profile on the host → within one sync
      cycle the slave's `/api/profiles` has it and its wall colour-codes
      correctly. Edit a profile *on the slave* → it proxies to the host and
      the host row updates.
- [ ] Cross-device: the active profile is per-device — setting it on a phone
      doesn't change what the kitchen tablet shows. Clearing site data on
      one device re-shows the picker there only.

### 1.85.0-beta.8 — event locations + snappier HA buttons

Server-side verified locally (unit + api): `LOCATION` parses from a VEVENT
(plain and with a `;LANGUAGE=` param), local-event `location` survives
create/list/partial-update, `/api/events` + `/api/events-manage` return it, a
feed's `show_location` flag defaults off and round-trips; HA `call-action` +
`call-group-action` return in <3.5s with `pending:true` against a 6s-slow fake
HA and the command still lands, a bad-domain action still 400s fast.

- [ ] `[AV]` Feed location, default off: add/keep a calendar feed with events
      that have a LOCATION; confirm nothing changes on the display until you
      tick Settings → Calendars → (edit feed) → "Show location on the display".
- [ ] `[AV]` With it on: the venue shows under the title in Agenda / Upcoming /
      Today (list + cards layouts) and on the event-detail card (📍). Turning
      it back off hides it again after the next sync.
- [ ] `[AV]` Per-feed independence: two feeds, only one with the toggle on —
      only that one's events show a location.
- [ ] **Physical display:** long-press a day → add-event sheet has a Location
      field; a saved location shows on the wall and in event-detail, and (if
      iCloud/Google push is on) lands on the pushed event.
- [ ] `[AV]` App events list shows 📍 location on local + opted-in-feed rows.
- [ ] **Real HA hardware:** tap a Favorites cover/lock/scene tile — the button
      un-greys within ~1.5s (not after the cover finishes travelling), the
      device still actuates, and the tile reconciles to the real state a
      moment later. Break the HA token → the tile still reports the error.
- [ ] `[AV]` A slow cover no longer produces a "❌ Could not move it" toast
      (was the 8s timeout firing mid-travel).

### 1.85.0-beta.9 — location shows in the Calendar widget + per-widget toggle

Fixes the beta.8 gap: locations reached the standalone Agenda/Upcoming/Today
widgets but NOT the Calendar widget's own agenda layout.

- [ ] With a feed's "Show location on the display" on (Settings → Calendars),
      a **Calendar widget set to Agenda layout** now shows 📍 location under
      the event, on the wall.
- [ ] Each of Calendar (Agenda) / Agenda / Upcoming / Today widgets has a
      **Show Location** toggle in its advanced settings, **checked by
      default**. Unchecking it hides location for just that widget; the feed
      setting and other widgets are unaffected.
- [ ] Grid (month/week) calendar layout: no location line in the day cells
      (by design — no room); tapping an event still shows it in the detail
      card.
- [ ] A widget with location off, then a feed toggled off entirely — no
      residual location text anywhere after the next sync.

### 1.85.0-beta.13 — orientation no longer flips on update

- [ ] `[AV]` A portrait display (Force Orientation = portrait, and/or a
      rotation set) stays portrait across a normal reboot.
- [ ] **The actual repro:** on a portrait display, push a beta so it
      self-updates and reloads while the server is restarting. It comes back
      **portrait**, not landscape. Repeat a few times — it was intermittent.
- [ ] A genuine orientation change still applies live: flip the screen's
      Force Orientation in the app → the display switches without a reboot
      (settings broadcast now also re-reads display-config).
- [ ] localStorage cleared on the device (or a brand-new screen) → first boot
      detects orientation as before; no regression when there's no cached
      value yet.
- [ ] Preview (app Layout tab / "Open in New Tab") is unaffected — it never
      reads or writes the cached orientation.
