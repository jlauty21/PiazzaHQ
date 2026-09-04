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

## Currently open (— beta cycle, beta.2 so far)

### beta.1 — Fixed feedback's device_id so the mothership's email lookup actually works
- [ ] Submit a piece of feedback from a real, licensed device running
      this build. On the mothership's admin panel, confirm the
      submitter's email now shows in the feedback item's meta line.
- [ ] Confirm this works for both a host and a mirror device.
- [ ] Confirm OLD feedback (submitted before this update) still shows
      no email, as expected — this fix is forward-only, not
      retroactive. If old feedback unexpectedly DOES show an email now,
      that's worth investigating rather than assuming it's a bonus win.

### beta.2 — Layout Switcher no longer destroys the display you switch away from
- [ ] Create two real, named displays (e.g. "Calendar" and "Chores"),
      each with distinct content. Assign a Layout Switcher widget or
      floating switcher with both as targets on a real screen (not
      Live Edit, not "Open to Edit in New Tab").
- [ ] Tap to switch Calendar → Chores → Calendar → Chores a few times
      in a row. Confirm BOTH displays' content is completely intact
      throughout — nothing gets silently overwritten, no matter how
      many times you toggle.
- [ ] Confirm the switch itself still feels instant — no visible
      reload or flash when tapping a button (this changed what
      persists in the background, not how switching feels).
- [ ] Reboot the device (or just restart the server) while pointed at
      "Chores" — confirm it comes back showing Chores, not Calendar or
      a blank default.
- [ ] Try this on a screen with NO display assigned yet, if you have
      one available — confirm tapping a switcher target now correctly
      assigns it (this used to be silently blocked).
- [ ] Confirm a saved-layout (template) target still behaves exactly
      as before — this is deliberately unchanged, still copy-based.
- [ ] Repeat the two-display toggle test on a MIRROR, not just the
      host.
- [ ] Confirm "Open to Edit in New Tab" and the small embedded
      thumbnail preview both still behave exactly as before —
      preview-only, nothing ever persists from either context.

### beta.3 — Windows self-update mechanism

Every code path in this release is Windows-only in effect — the Pi path is
byte-identical to beta.2. So this is really only checkable on the
experimental **Windows** build once a `.exe` is compiled and installed. The
one Pi item at the end is just a "confirm nothing regressed" smoke check.

- [ ] (Windows) Install the `.exe`, confirm the wizard completes, the
      Desktop shortcut launches the server hidden, and the browser opens to
      the app. — already confirmed working on real hardware once (Jon, the
      session this build came from); left here for a clean-machine retest.
- [ ] (Windows) Note the version it reports in Settings → Software Update.
      Publish a slightly newer test build to the mothership. Confirm the
      Windows install detects it, downloads it, extracts it (bsdtar), swaps
      the code, and comes back on the new version on its own — no manual
      restart, no double-clicking the shortcut again. **This is the main
      remaining unknown** — install/run is confirmed, the self-update
      round-trip on a real Windows install is not yet.
- [ ] (Windows) Confirm the update's HTTP response is a normal success (the
      banner/settings UI shows "updated", not a hang or a generic failure) —
      the restart must not cut the response off mid-flight.
- [ ] (Windows) Force a bad update: publish a build whose `server.js` throws
      on boot (or otherwise won't start). Confirm the Windows install rolls
      back to the previous version automatically and is reachable again,
      with no user action.
- [ ] (Windows) After a successful update, confirm `.update-pending` is gone
      and a rolling backup folder was written under the app directory.
- [ ] (Windows) Manual "Restore" of an older backup from Settings → Advanced
      → Update Backups behaves the same way (restarts, comes back on the
      restored version, or rolls forward if the restored code won't boot).
- [ ] (Windows) Full-data "Restore Backup" (Settings → Advanced) still
      extracts and restarts correctly.
- [ ] (Windows) `tv-control.js` TV power control is expected to fail with a
      clear error on Windows, not crash the server — confirm if you have a
      TV-control setup to test with.
- [ ] (Windows, known gap) "Download full backup" and host→slave "Push
      Update" still rely on the `zip` binary and are expected NOT to work
      from a Windows host yet — confirm they fail cleanly (clear message),
      don't hang or corrupt anything.
- [ ] (Pi) Smoke check only — the Pi path is unchanged from beta.2, but
      since `server.js` was refactored (helper functions, `startServer()`
      wrapper), confirm on a real Pi that a normal service restart / reboot
      boots cleanly and a normal self-update still applies and restarts via
      systemd exactly as before.

### beta.4 — dummy build (version bump only)

No code change from beta.3. This build exists purely to run the
self-update round-trip on a real installed Windows `.exe`.

- [ ] Publish `piazzahqupdatefixed.zip` (beta.4) to the mothership via
      `/admin` → Publish a Release.
- [ ] On the machine running the installed `PiazzaHQ-Setup-1.83.3-beta.3.exe`:
      restart the app (double-click the shortcut / relaunch) to trigger the
      ~90s-post-boot update check. Watch it detect beta.4, download, and
      apply on its own.
- [ ] Confirm Settings → Software Update (and `http://localhost:3000/api/version`)
      reports `1.83.3-beta.4` afterward, with no manual restart needed.
- [ ] Confirm a `.update-backups-rolling\...__v1.83.3-beta.3` folder was
      written under `%LocalAppData%\PiazzaHQ\app\`.
- [ ] Note roughly how long the whole thing took (Jon mentioned the Pi
      update "took much longer" — worth a baseline number for Windows).

### beta.5 — Windows zip creation, logging, install modes

All Windows-only in effect. The Pi item is a smoke check.

- [ ] (Windows) After updating to beta.5, confirm **Settings → Advanced →
      "Download full backup"** produces a real .zip you can open, with
      `calendar.db` + `backup-info.json` inside.
- [ ] (Windows) Download one of the retained code backups (Settings →
      Advanced → Update Backups → Download) — confirm it's a valid zip.
- [ ] (Windows) Confirm `%LocalAppData%\PiazzaHQ\app\logs\server.log`
      exists and is being written to (timestamps, boot lines). Leave it
      running a while; confirm it doesn't grow unbounded (rotates at 5 MB
      to `server.log.1`).
- [ ] (Windows) Fresh-install the new `.exe`. Confirm the wizard's
      "Select Additional Tasks" page shows the **"Set up this PC as a wall
      display"** checkbox.
- [ ] (Windows, control mode — box left unchecked) Confirm the Desktop
      shortcut opens **/app** in the default browser, windowed. No Startup
      shortcut created (`shell:startup` is empty of Piazza HQ).
- [ ] (Windows, wall-display mode — box checked) Confirm: Desktop shortcut
      opens **/** full-screen with no browser chrome; a **Startup** shortcut
      exists (`shell:startup`); signing out and back in brings the display
      up on its own.
- [ ] (Windows, wall-display) Alt+F4 out of the kiosk, double-click the
      Desktop shortcut again — confirm it comes back full-screen (not
      windowed) and doesn't start a second server.
- [ ] (Windows, wall-display) Known v1 limitations to just be aware of:
      the mouse cursor stays visible when idle, and the PC's normal
      display-sleep / lock-screen still applies. Flag if either is a
      real problem in practice.
- [ ] (Windows) Uninstall — confirm `{app}\kiosk-profile` is removed but
      `calendar.db`, `public\uploads`, and `logs\` are left behind.
- [ ] (Pi) Smoke check: `server.js` was refactored again (makeZip helpers,
      the logging block is skipped entirely off-Windows). Confirm a normal
      Pi restart + a normal self-update still work exactly as before.

### beta.6 — DATA_DIR + container detection (Docker groundwork)

Both default to off. The Pi/Windows checks confirm nothing regressed;
the DATA_DIR / container checks need a Linux box (or Docker) to exercise
properly and mostly belong to Phase 3 when there's an actual image.

- [ ] (Pi/Windows) Smoke check with **neither** `DATA_DIR` nor
      `PIAZZA_CONTAINER` set: normal boot, `calendar.db` + `public/uploads`
      where they've always been, self-update still works, photos still
      upload and display.
- [ ] (any Linux box) Run with `DATA_DIR=/some/path` on a **fresh** setup:
      confirm `calendar.db`, `uploads/`, `.session-secret`, `.device-id`
      all land in that dir; the app dir stays clean; photos upload and are
      served at `/uploads/...`; a custom-theme background upload lands under
      `DATA_DIR/uploads/custom-theme/`.
- [ ] (any Linux box) With `PIAZZA_CONTAINER=1`: `GET /api/version` reports
      `"deployment":"container"`; the Software Update section of Settings
      shows the "pull a new image" note and hides the timing controls;
      `POST /api/update-from-server` returns 409; **"Download full backup"
      still works**.
- [ ] (any) Confirm the license check-in still happens in container mode —
      after a while, `license_status_cache` in settings should be populated
      the same as on a Pi (the check-in rides the same request as the
      update check, which is NOT disabled — only the download/swap is).

### beta.7 — Docker packaging files (no runtime change)

`server.js`/`public/` are byte-for-byte beta.6, so the Pi/Windows checks
are just "nothing broke by adding files". The rest can't be checked without
Docker and mostly happens on the first real image build.

- [ ] (Pi/Windows) Nothing regressed — normal boot + a self-update still
      work. (The tree gained `Dockerfile`, `docker/`, `.github/`,
      `package-lock.json`, `.gitignore`, `.dockerignore` — all inert here.)
- [ ] (has Docker) `docker build -t piazzahq-test .` succeeds; `docker run
      --rm -p 3000:3000 -v pzt:/data -e PIAZZA_CONTAINER=1 piazzahq-test`
      comes up, `/app` loads, `/api/version` shows `"deployment":"container"`.
- [ ] (has Docker) Data survives an image rebuild: add an event, `docker
      compose pull`-equivalent (rebuild), `up -d`, confirm the event's
      still there (i.e. `/data` volume works).
- [ ] (has Docker, host net) With `network_mode: host`, confirm Home
      Assistant by `.local` hostname and LAN device discovery work (they
      won't on the default bridge — that's expected).
- [ ] (first stable release after this) The `.github/workflows/
      docker-publish.yml` run in GitHub Actions succeeds and pushes
      `ghcr.io/jlauty21/piazzahq:latest` + `:<version>`. Then make the GHCR
      package **public** (one-time, in its package settings).
- [ ] (if beta images are enabled) A beta release pushes `:beta` +
      `:<version>-beta.N`, and `:latest` is untouched.

### beta.8 — Windows app icon (installer-only)

- [ ] (Windows) Install the new `.exe`. The Setup wizard window, the
      Desktop shortcut, the Start Menu entry, and the Add/Remove Programs
      entry all show the brass Piazza HQ calendar mark (not the green
      Node.js hexagon). Check it looks right at small sizes in the taskbar.
- [ ] (Windows, wall-display mode) The Startup shortcut also has the new
      icon.
- [ ] (Pi) Nothing to check — no Pi-facing change (`server.js` byte-for-byte
      beta.7).

### beta.9 — installer force-stops the running server (installer-only)

- [ ] (Windows, upgrade over a running install) Install beta.9+ **while the
      server is running** (wall-display mode, or just after launching from
      the Desktop shortcut). Setup completes with no "DeleteFile failed;
      code 5" error; the new version is live afterward.
- [ ] (Windows) A normal first-time install (nothing running) is unchanged —
      no new prompts, no visible PowerShell window.
- [ ] (Windows) Uninstall while running also succeeds (the same stop runs
      from `InitializeUninstall`).
- [ ] (Windows) An unrelated Node app running from elsewhere on the machine
      is **not** killed by installing/uninstalling Piazza HQ.
- [ ] (Pi) Nothing to check — installer-only, `server.js` byte-for-byte
      beta.8.

### beta.10 — Windows wall-display "Exit full-screen" button

- [ ] (Windows, wall-display mode) Launch the kiosk. Tap the screen once —
      the ⤢ **Exit full-screen** button appears top-right alongside the
      Live Editing pencil, and both fade out again after ~4s. Tapping the
      screen again while they're shown dismisses them immediately.
- [ ] (Windows, wall-display mode) Tap **Exit full-screen** — the kiosk
      Chrome/Edge window closes. The server keeps running (relaunch from the
      Desktop shortcut brings the wall display straight back).
- [ ] (Windows, control-device mode / plain browser) Open `/` **without**
      `?kiosk=1` — the button never appears, tap-to-reveal shows only the
      pencil as before.
- [ ] (Windows) With a normal Chrome window ALSO open (not the kiosk
      profile), hitting Exit full-screen closes only the kiosk window, not
      the other one.
- [ ] (any non-Windows: Pi) `curl -X POST http://localhost:3000/api/kiosk/exit`
      returns **404**. The wall display shows no exit button (no `?kiosk=1`
      in its URL). Nothing else changed.
- [ ] (any) `POST /api/kiosk/exit` from a non-loopback address returns 403.

### beta.11 — Pi kiosk auto-launch fix (executable bits + session detection)

- [ ] (any zip built for this or a future beta) Extract it and confirm every
      `.sh` file — `install.sh` at the root, everything in `scripts/` — has
      its executable bit set (`ls -la`, look for the `x`'s). If not, the zip
      wasn't built through WSL and this whole fix regresses silently again.
- [ ] (fresh Pi, X11 session) Fresh-flash, run the installer, reboot with
      **no manual intervention** — the kiosk should come up automatically.
      Confirm `journalctl -b | grep -i chromium` shows an automatic launch
      early in boot, not just a manual one.
- [ ] (fresh Pi, Wayland/labwc session, if you have a Pi model that
      defaults there) Same check — confirm the CORRECT autostart file
      (`~/.config/labwc/autostart` this time, not lxsession) got the kiosk
      line, and it launches automatically.
- [ ] (existing Pi, self-update from beta.10 or earlier) After the
      self-update completes, confirm `scripts/wait-for-server-and-launch-
      kiosk.sh` is executable again even though the OLD, already-installed
      copy might have lost the bit — the self-update swap should bring in
      a version that already has it set correctly this time.
- [ ] (Windows) Nothing to check — this fix never touches
      `windows/build-input/app/`; `server.js`/`public/` are byte-for-byte
      beta.10.

### beta.12 — Docker arm64 image fix (CI-only, no Pi/Windows change)

- [ ] (has Docker + a real arm64 box, e.g. a Pi 4/5) `docker pull
      ghcr.io/jlauty21/piazzahq:beta` then `docker run` — should come up
      clean with no "exec format error" and no platform-mismatch warning.
      (Already verified once this cycle on a real Pi 3 — this item is about
      confirming it stays fixed on a future republish, not discovering it
      fresh.)
- [ ] (Pi/Windows) Nothing to check — `server.js`/`public/`/`install.sh`
      are byte-for-byte beta.11. This version bump is CI-workflow-only.
