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

### 1.84.0-beta.1 — push local events out to iCloud + Google Calendar

**iCloud (CalDAV):**
- [ ] `[AV]` "Find my calendars" lists real calendars; a wrong app-specific
      password gives a clear error, not a hang (verified live on the host
      Pi against Jon's real Apple ID)
- [ ] `[AV]` Create all-day / timed / multi-day → correct on the iCloud
      calendar (dates, times, exclusive end); edit updates in place, no
      second copy; delete removes it; a bad password never blocks/delays
      the local save (all verified live against the real "Family" calendar)
- [ ] Subscribe to that same iCloud calendar as a feed → pushed events do
      NOT show up as duplicates on the display (UID filter confirmed by
      inspection; a full feed round-trip not run)

**Google (OAuth authorization-code flow via the mothership; picker removed in beta.4):**
- [ ] `[AV]` Prereq met: mothership OAuth relay live, client is a "Web
      application" with the redirect URI registered
- [ ] `[AV]` Connect flow → "Connected as <email>"; deny → "Access was not
      granted", not a hang (verified live on the host Pi)
- [ ] `[AV]` Create / timed / multi-day / edit-in-place / delete /
      non-blocking, against the real Google primary calendar — all pass
      live. Google applied the Pi's tz → correct offset.
- [ ] Optional: set a non-primary Calendar ID and confirm events land there
- [ ] Disconnect actually stops pushes and clears the connection
- [ ] Subscribe to that Google calendar as a feed → pushed events do NOT
      duplicate (the one thing local testing couldn't confirm — if they DO,
      the UID regex in parseICS needs a fix)
- [ ] Leave it connected a day+ → pushes still work after the access token
      would have expired (auto-refresh)
- [ ] Re-check the whole thing on a fresh / second-household account

**Multi-device:**
- [ ] With a host + a slave display, creating an event on the slave still
      pushes to iCloud/Google once, from the host, not twice

### 1.84.0-beta.5 — add events from the wall display

**Long-press to add (typed):**
- [ ] `[AV]` The save path works: `POST /api/events` from the device
      creates the row with the right fields; `DELETE` removes it (verified
      on Pi 110)
- [ ] Long-press a day on a month-view calendar widget → the add-event
      sheet opens with that date filled in
- [ ] A short tap does nothing; tapping an event still opens its detail; a
      horizontal swipe still changes month
- [ ] Long-press works on the postit/decorated calendar styles too
- [ ] All-day / timed (no tz shift) / multi-day events save and show right
- [ ] End date before start, or end time before start → inline error,
      nothing saved
- [ ] On a slave display the event saves via the host and pushes once
- [ ] Cancel / tap outside / ✕ all close the sheet with nothing saved

**Handwriting (only if turned on + a MyScript key is set):**
- [ ] `[AV]` Settings save the keys; the app/HMAC keys are extracted as
      UUIDs so a pasted "* " bullet can't break auth; `handwriting_ready`
      only true when both are set (verified via API on Pi 110)
- [ ] `[AV]` `POST /api/handwriting/recognize` does a real MyScript round
      trip and returns text ("m" for a test zig-zag); the HMAC secret never
      leaves the server
- [ ] With handwriting off (or no key), the ✍️ button does NOT appear
- [ ] ✍️ opens a stroke pad; print a word + "Use this" drops recognised
      text into the title (still editable); "Clear" empties the pad
- [ ] "Back to typing" returns to the field with the ink discarded
- [ ] Nothing recognised → a readable message, not a hang; typing still works

### 1.84.0-beta.8 — per-event calendar picker + delete from the display

**"Add to" picker:**
- [ ] `[AV]` `/api/event-targets` returns local + each configured iCloud
      calendar + Google, with the right default; `target_calendar:"local"`
      creates an event that pushes nowhere (verified on Pi 110)
- [ ] Settings → iCloud → "Find my calendars" now keeps ALL discovered
      calendars; the dropdown lists them all, one is the default
- [ ] Long-press → the sheet's "Add to" row shows: This device only / each
      iCloud calendar / Google (only the configured ones); hidden entirely
      if only local is configured
- [ ] Pick a specific iCloud calendar → event lands on THAT one, not the
      default
- [ ] Pick "Google" → lands on Google, not iCloud, even if iCloud push is on
- [ ] Editing that event later targets the same remote calendar (no
      duplicate on the default)
- [ ] An explicitly-picked calendar still works with that provider's global
      push toggle off

**Delete from the display:**
- [ ] Tap a Piazza HQ event → Delete button shows; tap an ical-feed event →
      no Delete button
- [ ] Delete confirms; cancelling does nothing
- [ ] After confirm: gone from the display, and from iCloud/Google if it
      was pushed there
- [ ] On a slave display, delete proxies to the host and propagates once

### 1.84.0-beta.9 — Home Assistant cover + lock control

- [ ] `[AV]` Server rejects a wrong-domain action ("unlock" on a light →
      400 "only valid for lock entities"); nothing regressed in the
      HA_ACTIONS map (verified on Pi 110)
- [ ] Entity Status widget on a `cover.` entity shows ▲ / ■ / ▼ + an
      Open/Closed line (not read-only text); the buttons move the real
      cover; the line updates
- [ ] A `lock.` entity shows a Lock/Unlock button that reflects and changes
      the real state
- [ ] Same inside a Smart Home Dashboard widget (Grid, plus Card/List/
      Tap-card embed the same controls)
- [ ] Nothing regressed for lights / switches / fans / climate / scenes

### 1.84.0-beta.10 — Home Assistant light dimming

- [ ] `[AV]` `set_brightness` rejected server-side for a non-light entity
      and an out-of-range percent (verified on Pi 110)
- [ ] Entity Status on a dimmable light that's ON shows a brightness slider
      under the switch; the line reads e.g. "60%"
- [ ] Dragging + releasing changes the real brightness; the % updates
- [ ] A non-dimmable / off light shows just the switch
- [ ] Same in a dashboard grid tile

### 1.84.0-beta.11 — Home Assistant media_player control

- [ ] `[AV]` Server rejects media actions / `volume_set` on a
      non-media_player entity and an out-of-range volume (verified on Pi 110)
- [ ] Entity Status on a media_player shows ⏮ / ▶-⏸ / ⏭, the track title
      (when playing), and a volume slider
- [ ] Play/pause toggles playback; glyph + line follow. Next / previous
      change track. Volume slider changes the real volume.
- [ ] An idle/off player still shows the transport row, no error
- [ ] Works in a dashboard grid tile

### 1.84.0-beta.12 — Home Assistant fan speed

- [ ] `[AV]` `set_fan_speed` rejected for a non-fan entity / bad percent
      (verified on Pi 110)
- [ ] Entity Status on a variable-speed fan that's ON shows a speed slider;
      line shows e.g. "40%"; dragging changes the real speed
- [ ] A fan with no variable speed (or off) shows just the switch

### 1.84.0-beta.13 — phone-app Favorites cards for cover / lock / media

- [ ] Favorites tab → + Add a Card → HA section shows "Garage / Blind /
      Cover", "Lock", "Media Player" alongside the existing cards
- [ ] Adding one shows an entity picker filtered to that domain only
- [ ] Cover card ▲/■/▼ move the real cover; the state label updates
- [ ] Lock card button reflects and flips the real lock
- [ ] Media card previous / play-pause / next work; glyph follows state
- [ ] Two cards of the same type both work independently (the beta.14
      scoped-wiring fix — was: only the first responded)
- [ ] A card whose entity vanished shows "not found — remove this card",
      doesn't break the tab

### 1.84.0-beta.15 — Home Assistant light colour

- [ ] `[AV]` `set_color_temp` / `set_color` rejected for a non-light
      entity, out-of-range kelvin, malformed rgb (verified on Pi 110)
- [ ] A tunable-white light that's ON shows a warm↔cool slider (gradient
      track); dragging sets the colour temperature in HA
- [ ] A colour light shows preset swatches; tapping one sets that colour
- [ ] A plain on/off or brightness-only light shows neither

### 1.84.0-beta.16 — Home Assistant sensor sparklines

- [ ] `[AV]` `/api/ha/history` returns `{points:[{t,v}]}` for a real
      sensor, caps at ~100 points, is cached (repeat is instant), clamps
      hours to 1-168 (verified on Pi 110)
- [ ] Entity Status on a numeric sensor shows a small filled trend line
      under the value within a second or two
- [ ] The line's shape roughly matches HA's own 24h history — best checked
      on a sensor that changes often (a battery sensor barely moves)
- [ ] A text/enum sensor (or non-sensor entity) shows no sparkline
- [ ] No console errors if HA history is empty for an entity

### 1.84.0-beta.17 — Home Assistant condition alerts

- [ ] `[SYN]` Full cycle with a synthetic always-true rule on the host:
      rule saves (sanitised, capped), fires within ~2 min, shows in the
      active list with the friendly name + message, dismiss clears it,
      deleting rules cleans up. Slave proxy of the active list works.
- [ ] Settings → HA → Alerts: + Add alert shows the entity picker + is/
      above/below + value + dwell + message; the list summary line reads right
- [ ] The enable checkbox and ✕ delete each persist immediately
- [ ] Make a rule true → within ~2 min a **red banner appears on the
      display** (the visual part)
- [ ] Dismissing the banner clears it; it does NOT reappear while the
      condition stays true; when the condition goes false→true again it
      fires once more
- [ ] With a dwell of ~3 minutes, a brief real-world blip does NOT fire it
- [ ] Deleting all rules clears any banner within a minute

### 1.84.0-beta.18 — phone push for alerts (server 1.33.19)

- [ ] `[AV]` Server 1.33.19 live: `/api/push/vapid-public` returns a key;
      `/notify-sw.js` serves as JS; `/notify-setup?license=` returns the
      page with the licence prefilled and no CSP blocking its inline
      script; `/api/push/relay` rejects an unknown licence (403) and
      accepts the real one (`sent:0` with no subscribers);
      `/api/push/customer/subscribe` rejects a bad licence (403) / bad body
      (400) — all verified against piazzahq.com
- [ ] `[AV]` Device side: `/api/phone-alerts` returns the toggle state +
      the setup URL with the real licence; `/api/notifications/active` and
      `/dismiss` work; a fired HA alert flows through the notification
      channel with `kind:"ha-alert"` (verified on the host Pi)
- [ ] Settings → HA: "Also send alerts to my phone" toggle saves; "Enable
      on this phone" opens the notify-setup page
- [ ] On that page: allow notifications → "this phone will now get alerts"
- [ ] Fire a test alert → display banner shows **and** the phone gets a
      push; tapping it opens the app
- [ ] "Turn off on this phone" stops that phone getting them
- [ ] With the phone toggle OFF, an alert still banners on the display but
      no push is sent
- [ ] A slave display still shows the banner (proxies /api/notifications/active)

### 1.84.0-beta.19 — notification delivery preferences

- [ ] `[AV]` `GET/PUT /api/notif-prefs` round-trips a per-kind
      {screen,phone} map, defaults both true for an unknown/absent kind;
      `PUT /api/ha-alerts` now also stores per-rule `screen`/`phone`
      (default true) (to verify on the host)
- [ ] Settings → HA → "Notification delivery": one row ("Home Assistant
      alerts") with 📺 Screen / 📱 Phone checkboxes that save on toggle
- [ ] Uncheck 📺 for the kind → a firing alert does NOT banner on the
      display (but still pushes to phone if 📱 + phone alerts on)
- [ ] Uncheck 📱 for the kind → fires on screen, no phone push
- [ ] Each alert rule row has its own 📺 / 📱 toggles that persist
- [ ] A rule with 📺 off / 📱 on → phone-only; 📺 on / 📱 off → display-only
- [ ] Per-kind and per-rule both must allow a channel for it to be used
      (they AND together)

### 1.84.0-beta.20 — Settings: calendar + handwriting under Data Sources

- [ ] Settings → Data Sources now contains: Weather, Travel Time, Calendar
      Sync, Push to iCloud Calendar, Push to Google Calendar, Handwriting
      input, Todoist, Home Assistant, Stocks, News
- [ ] None of those four appear as their own top-level Settings entries any more
- [ ] Advanced no longer lists Calendar Sync
- [ ] Each moved section still opens, its controls still save, Settings
      search still finds them

### 1.84.0-beta.21 — alert banner rotation + state dropdown

- [ ] On a display with a rotation set (Settings → Display, or the screen's
      own rotation): a firing alert banner appears on the correct visual
      edge and reads upright, not glued to the physical top
- [ ] With no rotation, the banner is unchanged (top edge)
- [ ] Settings → HA → Alerts → + Add alert: with "state is", the value is a
      dropdown of that entity's likely states + its current state
- [ ] Switching op to above/below turns the value into a number field
- [ ] Picking "Other…" reveals a free-text field; that value is what saves
- [ ] An entity with no known common states (odd sensor) falls back to a
      text field, no crash
- [ ] `[AV]` server still stores whatever string it's given for `value`
      (dropdown is UI-only; evaluator unchanged)

### 1.84.0-beta.22 — Settings don't jump to top; alert picker shows names only

- [ ] In Settings, open Data Sources → Home Assistant → Alerts. Toggle a
      rule's 📺/📱/enable → the section stays open, scroll doesn't jump
- [ ] Add or delete an alert → list updates, still parked in the same
      section (not collapsed to the top)
- [ ] Save iCloud / Google / Handwriting settings → same: stays put
- [ ] Google connect / disconnect → returns to the same open section
- [ ] The add-alert entity dropdown shows just friendly names (no
      "(sensor.xxx)" suffix); the right entity_id is still what gets saved
- [ ] Two entities with the same friendly name are still both pickable
      (order preserved)

### 1.84.0-beta.23 — demo mode foundation

All of this is behind `DEMO_MODE=1` — a **normal build must be unchanged**,
so the first check is the important one.

- [ ] `[AV]` Normal build (no `DEMO_MODE`): `/api/version` has no `demo`
      field / `demo:false`; every Settings section present; no demo strip
      on the display; text write paths store input verbatim (length +
      profanity pass is a no-op) — verified by reading the guards
- [ ] `[SYN]` `DEMO_MODE=1`: non-GET requests to `/api/ha*`, `/api/todoist*`,
      `/api/caldav*`, `/api/google*`, `/api/handwriting*`,
      `/api/briefing-settings`, `/api/phone-alerts`, `/api/push*`,
      `/api/feeds*`, `/api/photos*`, `/api/update*`, `/api/backup`,
      `/api/restore`, `/api/custom-theme`, `/api/voice-token*`,
      `/api/sync*`, `/api/setup*` all return 403 `{error:"Not available
      in the demo."}`; GETs of the same still work
- [ ] `[SYN]` `DEMO_MODE=1`: `PUT /api/settings` silently ignores `app_pin`,
      `device_role`, `update_server_url`, `auto_push_updates`, anything
      ending `_token`/`_pass`/`_key`/`_secret`/`_url`; cosmetic keys
      (`theme`, `show_weather`, …) still save
- [ ] `[SYN]` `DEMO_MODE=1`: creating an event / to-do / shopping item /
      chore / reminder with a >max-length title or a swear → stored value
      is truncated and the word masked with `*`
- [ ] `DEMO_MODE=1` on a real display: bottom strip reads "Demo · resets
      in m:ss" and counts down; at 0 a full-screen "Demo finished" curtain
      appears; "Get your own →" opens piazzahq.com
- [ ] `DEMO_MODE=1` with no `DEMO_LEASE_ENDS`: strip shows "Demo" with no
      timer and never throws the curtain
- [ ] `DEMO_MODE=1` in the phone app: Settings is missing Home Assistant,
      Todoist, Calendar Sync, both calendar-push sections, Handwriting,
      Voice Control, Daily Briefing, Security, Feedback & Ideas,
      Multi-Device, Version & License, Backup, Update Backups, Custom Theme;
      Weather / Stocks / News / Display / App Preferences still there
- [ ] `DEMO_MODE=1`: background jobs don't run — no update check, no
      briefing email, no HA alert evaluation, no external calendar push,
      no phone-push relay (check the log is quiet)

### 1.84.0-beta.24 — demo pool broker glue

Only active when `DEMO_BROKER_URL` + `DEMO_INSTANCE` are set (the pool's
systemd unit sets them). A normal build and a standalone `DEMO_MODE=1`
instance are unchanged.

- [ ] `[SYN]` With broker + instance wired: loading `/` or `/app` with no
      `demo_token` cookie, or a bogus one, 302s to `<broker>/demo`; with a
      valid lease cookie it serves the page (verified locally against the
      1.33.22 broker in port mode)
- [ ] `[SYN]` After the lease expires, the next page load 302s back to
      `/demo` (≤10s slop from the gate's positive-result cache)
- [ ] `[SYN]` Broker unreachable → the gate fails **open** (page still
      serves) rather than locking the visitor out
- [ ] On a real leased instance: the display + app heartbeat
      `<broker>/demo/heartbeat` every 45s; an active tab's countdown keeps
      extending; closing the tab lets the slot free on the broker's idle
      timer
- [ ] `/api/version` on a wired instance includes `demoBrokerUrl` +
      `demoInstance`; on an unwired one it does not

### 1.84.0-beta.25 — demo display polish (corner pill, scan-to-control, tour)

Needs `_server` 1.33.24 (broker `?scan=1`). Demo-only.

- [ ] On a real leased instance: the demo chrome is a small pill in the
      **top-right** corner (countdown + "Get your own →" + a QR), not a
      full-width bottom bar — nothing along the bottom edge is covered
- [ ] `[SYN]` `GET /demo-qr-1.svg` (and `-2`) serves an SVG; it encodes
      `https://d1.piazzahq.com/app?scan=1`
- [ ] Scan the pill's QR with a phone → lands in the **same** demo
      instance's control app (not a new lease); works while the wall's
      lease is live
- [ ] `[SYN]` `/app?scan=1` when the instance is **not** currently leased →
      302 to `<broker>/demo` (verified locally: leased→200+`demo_scan`
      cookie, free→302, cookie reload rides the lease then bounces on
      expiry)
- [ ] When the wall's lease ends, the scanned phone also gets bounced to
      `/demo` on its next navigation
- [ ] First demo load shows the guided-tour overlay (long-press / tap /
      scan / resets); "Start exploring" dismisses it and it doesn't return
      on reload (localStorage `demoTourSeen`)
- [ ] A normal (non-demo) build shows none of this

### 1.84.0-beta.26 — demo fixes from live testing (needs _server 1.33.25)

- [ ] `[SYN]` Demo: move/resize a widget on the display → it saves, no
      "couldn't save" toast (a fresh screen adopts the seeded profile)
- [ ] Demo on a laptop/tablet: dragging a widget to the right edge does NOT
      navigate back
- [ ] Live Edit: tap a calendar event → widget selects, event detail does
      NOT open; tap a chore-chart row → selects, chore does NOT toggle
- [ ] `[SYN]` The countdown decreases smoothly to 0:00 (does not jump back
      to ~1:30) — verified locally: broker `endsAt` is now stable across
      heartbeats
- [ ] At 0:00 the display shows "That's the demo" then redirects to
      piazzahq.com; a phone that scanned the wall QR also returns to
      piazzahq.com
- [ ] `[SYN]` Broker: a lease with no heartbeat for `DEMO_IDLE_MS` is swept
      as abandoned (verified locally); an active tab still gets its full
      `DEMO_LEASE_MS`
- [ ] `/api/version` includes `demoScan:true` when reached with a
      `demo_scan` cookie, absent otherwise

### 1.84.0-beta.27 — drag-stick fix, demo layout switcher, demo weather

- [ ] In Live Edit, drag a widget a long way in one continuous motion — it
      follows the pointer the whole time and does NOT stop/drop after ~8s
      or a short distance (was: the edit-mode refresh rebuilt the canvas
      mid-drag)
- [ ] Same for resizing a widget by a handle
- [ ] `[SYN]` `renderLayout()` is a no-op while `_dragState`/`_resizeState`
      is set and runs once on drag/resize end
- [ ] Demo: the wall shows a bottom switcher bar with "Home Hub",
      "Command Center", "Daily Digest"; tapping one switches the layout;
      switching back and forth doesn't lose anything
- [ ] `[SYN]` Demo `/api/screen-config` returns `floating_switcher_enabled:
      true` + a preset per `displays` row; non-demo is unchanged
- [ ] Demo: the weather widget shows real conditions for Chicago (not
      blank / "set a location")

### 1.84.0-beta.30 — demo edit-pencil nudge

- [ ] Fresh demo (clear site data): after the tour's "Start exploring", a
      blue bubble appears bottom-right pointing at the ✏️ pencil, which is
      now visible; tapping the pencil (or ~8s) dismisses the bubble and it
      doesn't return on reload
- [ ] The tour's first bullet mentions the pencil
- [ ] Non-demo build: no bubble, pencil behaves as before (tap-to-reveal)

### 1.84.0-beta.31 — slave HA widget state after a tap

- [ ] On a **slave** display (e.g. 110): tap a cover/lock/light/media
      control in an Entity Status widget → the widget reflects the new
      real HA state within ~1–2s and does NOT briefly snap back to the old
      state
- [ ] Toggling the same entity directly in HA still shows on the slave
      widget within ~15s (the normal poll), unchanged
- [ ] Host display behaviour unchanged

### 1.84.0-beta.32 — Live Edit freeze fix

- [ ] In "Open to Edit in New Tab", drag/resize widgets around, tap HA
      controls, wait — all widgets keep updating (HA tiles reflect real
      state within ~15s); nothing freezes on a stale value
- [ ] `[SYN]` A drag whose element is removed mid-gesture no longer wedges
      `_dragState` — `renderLayout()` clears a stale/detached drag state and
      resumes; a `window` pointerup/cancel also ends any drag
- [ ] Normal on-wall Live Edit (drag, resize, done) still works; the
      beta.27 "drag doesn't stick after ~8s" fix still holds

### 1.84.0-beta.33 — optimistic HA controls

- [ ] Tap a light/switch toggle -> pill flips immediately; real light
      follows; widget stays correct (no flicker back)
- [ ] Tap Lock / Unlock -> state line changes at once; ~1-2s later it
      reflects HA's real value; a lock needing a code snaps back to Locked
      with a "rejected" message
- [ ] Open/Close a cover -> Open/Closed shows right away, settles to the
      real state within ~2s
- [ ] Brightness / volume / colour-temp slider -> release applies
      instantly, no snap-back on success
- [ ] Play/pause a media_player -> glyph + label flip immediately
- [ ] Scene/script trigger still just shows "done" (no fake state)
- [ ] [SYN] optimistic write is seq-bumped so an in-flight poll can't undo
      it; a failed action calls the confirm read to correct

### 1.84.0-beta.34 — faster HA refresh

- [ ] Change a light/lock/etc directly in the HA app -> the wall widget
      catches up within ~5s (was ~15s)
- [ ] With a busy Smart Home Dashboard (many entities), the display stays
      responsive and the household HA isn't visibly hammered
- [ ] Live Edit: HA tiles update within ~4s

### 1.84.0-beta.35 — no flash-back on HA controls

- [ ] Tap a light/switch toggle -> flips and STAYS flipped (no flash to
      new state then back to old); settles to HA's real value within ~1-3s
- [ ] Lock/Unlock -> state changes and holds; reflects real HA state within
      a few seconds; no snap-back mid-way
- [ ] Cover open/close -> same, holds the commanded state up to ~6s while
      the cover actually moves
- [ ] If HA rejects the action, it DOES snap back promptly (+ message)
- [ ] A change made directly in HA still shows on the wall within ~5s

### 1.84.0-beta.36 — lock/cover hold-until-confirmed

- [ ] Unlock a slow lock -> shows Unlocked immediately and STAYS there (no
      flash to Locked); settles to HA's confirmed value when the lock
      reports back, no wrong-state blink in between
- [ ] Lock it again -> same
- [ ] Open/close a slow cover -> holds the commanded state up to ~20s while
      it moves; no flash-back
- [ ] If a lock jams -> the "jammed" state shows promptly (hold releases on
      any non-old value), not hidden behind the optimistic guess
- [ ] Toggles/lights still snap and hold cleanly (5s cap)

### 1.84.0-beta.37 — lock hold-until-target + sparkline persistence

- [ ] Unlock/lock a slow lock -> shows the commanded state and holds it
      steady until HA confirms exactly that state; no blink to
      "unlocking"/old value in between; a jam shows "jammed" promptly
- [ ] The sensor sparkline on an Entity Status widget stays visible after
      the widget re-renders (HA poll, ~8s) -- not only while resizing it
- [ ] Sparkline still updates its shape over time (cache TTL ~10min)

### 1.84.0-beta.38 — lock hold minimum duration

- [ ] Unlock a slow lock -> "Unlocked" appears and holds ROCK STEADY for
      ~5s (no blink to Locked at all), then reflects HA's confirmed state
- [ ] Same for Lock, and for cover open/close
- [ ] A lock that jams -> "jammed" still shows promptly (error/terminal
      states bypass the minimum hold)
- [ ] A toggle/light -> instant, ~1.2s minimum hold, no perceptible delay

### 1.84.0-beta.39 — deleted alert rule clears its banner

- [ ] Create an always-true HA alert -> banner appears. Delete that rule ->
      the banner clears within a few seconds (was: stuck until restart)
- [ ] Editing the rule list so one rule is removed clears only that one's
      banner, others stay

### 1.84.0-beta.40 — "Hide from display" for feed events

Backend was already in place (`hidden_events` table, `/api/hidden-events`
routes, `/api/events` filter, slave sync, app Manage-events restore). This
build only adds the display-side entry point.

- [ ] `[AV]` `POST /api/hidden-events` (occurrence) drops just that date
      from `/api/events`; `DELETE` restores it exactly; pre-existing hidden
      rows untouched (round-trip verified on Pi 87 host)
- [ ] Tap a feed (subscribed-calendar) event on the wall → detail popup
      shows "Hide from display"; a recurring one also shows
      `Hide every "<title>"`; a Piazza HQ event still shows "Delete event"
      and NO hide button
- [ ] "Hide from display" → confirm → the event disappears from the
      calendar widget within a poll; cancel does nothing
- [ ] `Hide every "<title>"` on a recurring feed event → every occurrence
      goes, not just the tapped date
- [ ] A hidden event stays hidden across a feed re-sync (does not come back)
- [ ] Restore it from the phone app (Manage events) → it reappears on the
      display
- [ ] On a slave display: hiding proxies to the host and the event
      disappears on both host and slave
- [ ] Not scoped to edit mode — works on a normal (non-edit) wall tap, same
      as the existing detail popup

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
