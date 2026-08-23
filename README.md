# Piazza HQ

A self-hosted always-on calendar display for Raspberry Pi, controlled from any browser or iPhone.

## What you get

- **Display** (`/`) — fullscreen clock, mini calendar, upcoming events, and weather. Runs in Chromium kiosk mode on your Pi's monitor.
- **Control app** (`/app`) — mobile-first web app for adding/editing events. Bookmark to iPhone home screen for a native-app feel.

---

## Setup on Raspberry Pi

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Copy project files

```bash
# Copy this folder to your Pi (via USB, scp, or git clone)
cd ~/piazzahq
npm install
```

### 3. Run the server

```bash
npm start
```

The server starts on port 3000. Open `http://localhost:3000` to see the display,
or `http://<pi-ip>:3000/app` from your phone.

### 4. Auto-start on boot (systemd)

```bash
sudo nano /etc/systemd/system/piazzahq.service
```

Paste this (replace `pi` with your username if different):

```ini
[Unit]
Description=Piazza HQ Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/piazzahq
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable piazzahq
sudo systemctl start piazzahq
```

### 5. Kiosk mode (display auto-launch)

Edit `~/.config/lxsession/LXDE-pi/autostart`:

```bash
nano ~/.config/lxsession/LXDE-pi/autostart
```

Add these lines:

```
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost:3000
```

Reboot and your display will launch automatically into fullscreen.

---

## Adding weather

1. Open `http://<pi-ip>:3000/app` on your phone
2. Go to **Settings** tab
3. Find your coordinates at maps.google.com (right-click → "What's here?")
4. Enter latitude and longitude → Save

Weather is provided free by [Open-Meteo](https://open-meteo.com/) — no API key needed.

---

## iPhone home screen app

1. Open Safari and go to `http://<pi-ip>:3000/app`
2. Tap the Share button → **Add to Home Screen**
3. It will appear as a full-screen app with no browser chrome

---

## Automated install (recommended for a new Pi)

Instead of running the setup steps by hand, use the included `install.sh`. It's
**safe to run on a fresh Pi or to re-run on an existing one** — it installs only
what's missing and never touches your data or existing configuration.

On the Pi (over SSH or in its terminal):

```bash
cd ~/piazzahq      # the folder with server.js (or wherever you unzipped it)
bash install.sh
```

If you're starting from just the zip (e.g. dropped on the boot partition during
imaging), put `install.sh` beside it and run it — it will unpack the project for
you. Then reboot to launch the kiosk display.

What the script does, and how it stays safe:

- **Node.js** — installs v20 only if Node is missing or older than v20; otherwise skips.
- **System packages** (`unzip`, `curl`) — installs only the ones not already present.
- **Mouse cursor hiding** — detects whether your Pi runs X11 or Wayland and sets up
  the right tool automatically (classic `unclutter` on X11, `unclutter-xfixes` on
  Wayland). If you're on a Wayland build where cursor-hiding can't be made to stick,
  the installer tells you the one guaranteed fix (switch to X11 via `raspi-config`)
  instead of silently leaving the cursor on screen.
- **Dependencies** — runs `npm install` (a no-op if already satisfied).
- **Your data** — the database (`calendar.db`), uploaded photos (`public/uploads/`),
  and session secret (`.session-secret`) are **never overwritten or deleted**. The
  project zip is code-only, so updating never risks your content.
- **systemd service** — installs and enables it; if a different one already exists,
  it **asks before replacing** rather than clobbering it.
- **Kiosk autostart** — only *adds* its launch line if not already present, so it
  won't overwrite an autostart file you've customized. Detects labwc vs wayfire.

To **update** later: unzip the new code over your existing `~/piazzahq` (your
data is untouched), then re-run `bash install.sh`.

---

## Remote access (use the app away from home)

By default the control app only works on your home WiFi. To reach it from anywhere
— cellular, work, a friend's house — Piazza HQ can set up **Tailscale**, which
builds a small private network that only your own devices can join. Nothing is
exposed to the public internet, so it's far safer than opening a port on your router.

The installer offers this as an optional step. You can also add it anytime later:

```bash
cd ~/piazzahq
bash setup-remote-access.sh
```

What happens:

1. It installs Tailscale on the Pi automatically.
2. It prints a **login link** — open it once in any browser and sign in
   (Google / Microsoft / GitHub / email; no new password to create). This is the
   only manual step.
3. On each phone or laptop that needs access, install the **Tailscale** app from the
   normal app store and sign in with the **same account**.

After that, open the address the script prints (e.g. `http://100.x.y.z:3000/app`)
from anywhere — it just works, with nothing to toggle each time.

**Friendlier URLs (optional, recommended):** turn on **MagicDNS** in the Tailscale
admin console (login.tailscale.com → DNS → enable MagicDNS). Then everyone can use
`http://picalendar:3000/app` instead of an IP.

**Check status anytime:**

```bash
bash setup-remote-access.sh --status
```

**A note on security:** because Tailscale keeps the app private (never publicly
exposed), the app's PIN is guarding against far less than it would on a public URL —
this is the safest of the remote-access options. The main thing to keep in mind is
that any device already on your Tailscale network can reach the app, so only add
devices/people you trust to that network.

---

## Updating the app (drop-in, no SSH)

Once Piazza HQ is installed, you can update it right from the control app — no
terminal needed:

1. Download the latest **piazzahq.zip**.
2. Open the control app → **Settings** → **Software Update**.
3. Drag the zip onto the drop zone (or tap to choose it).

The Pi validates the zip, backs up the current version, installs the new code, and
restarts itself. The app reconnects automatically and shows the new version number,
usually within 10–20 seconds.

**Your data is safe.** The update only swaps code files (`server.js`, `templates.js`,
`public/`, `package.json`, `scripts/`). Your calendars, photos (`public/uploads/`),
database (`calendar.db`), and session secret are never touched.

**Auto-rollback.** If the new version fails to start, the Pi automatically restores
the previous version after a few failed boots — so a bad update can't brick the
display. (This relies on the systemd service the installer sets up, which restarts
the app on exit. If you run the server by hand with `npm start` instead, the file
swap still happens but you'd restart it manually.)

**Note on dependencies.** The in-app updater swaps code, not npm packages. In the
rare case a release adds a new dependency, run `npm install` on the Pi once after
updating (the release notes will say so). Day-to-day updates don't need this.

The current version is always shown in Settings → Software Update.

---

## Controlling the kiosk display (`kiosk` command)

When the screen is in fullscreen kiosk mode, doing maintenance on the Pi itself is
awkward — you end up fighting the browser. The installer adds a `kiosk` command to
make this painless:

```bash
kiosk off       # hide the fullscreen display, drop to the desktop, restore the cursor
kiosk on        # bring the fullscreen display back
kiosk toggle    # flip between the two
kiosk restart   # cleanly relaunch the display
kiosk status    # is the kiosk currently running?
```

This controls the **browser only** — the Piazza HQ server keeps running, so when
you turn the kiosk back on it picks up right where it left off. While the kiosk is
off, the mouse cursor is restored so the desktop is usable.

**Keyboard shortcut: Ctrl+Alt+K.** The installer sets this up automatically —
it binds `kiosk toggle` in whichever window manager's config (labwc for
Wayland, openbox for X11; it writes both, since the install can switch you to
X11 partway through and you'd want it either way), so pressing Ctrl+Alt+K
drops you to the desktop, and pressing it again brings the display back.
Takes effect after the reboot at the end of installation.

Not Super+K, which earlier versions of this installer used — confirmed on
real hardware that the Raspberry Pi desktop panel grabs the Super key by
itself as a "tap to open the Pi menu" gesture, independent of whatever else
is pressed with it. Super+K would land as two separate events (the menu
opening, then K arriving a beat later as a search keystroke inside it)
rather than reaching the window manager as one combined shortcut. Ctrl+Alt
has no such conflict. If your install still only has the old Super+K
binding, re-running `install.sh` adds Ctrl+Alt+K alongside it without
touching the old one.

If it's ever missing entirely — a very old install from before this existed,
or the installer couldn't find a config file to personalize — here's the
manual version. Add to `~/.config/labwc/rc.xml` (Wayland) inside
`<keyboard>`:

```xml
<keybind key="C-A-k">           <!-- Ctrl+Alt+K -->
  <action name="Execute" command="kiosk toggle" />
</keybind>
```

Or, on X11, `~/.config/openbox/rpd-rc.xml` — inside `<keyboard>`, note openbox
needs the command as its own nested element, not an attribute. The exact
filename has changed across Raspberry Pi OS releases (current
"Raspberry Pi Desktop"-branded images use `rpd-rc.xml`; older ones use
`lxde-pi-rc.xml`) — if you're not sure which, check what your own openbox is
actually running with: `ps aux | grep openbox` shows its `--config-file`.

```xml
<keybind key="C-A-k">           <!-- Ctrl+Alt+K -->
  <action name="Execute"><command>kiosk toggle</command></action>
</keybind>
```

Then reload your window manager (or reboot).

---

## The mouse cursor won't hide

This is almost always an **X11 vs Wayland** issue. Classic `unclutter` only works
on X11; on Wayland (the default on Raspberry Pi OS Bookworm/Trixie) it runs but
does nothing — no error, cursor stays. The installer detects your session and
picks the right tool, but Wayland cursor-hiding isn't guaranteed on every build.

If the cursor is still showing:

1. **Check what session you're on:** `echo $XDG_SESSION_TYPE` (or look at the
   installer's "Session:" line). `x11` = unclutter should work; `wayland` = read on.
2. **The guaranteed fix — switch to X11:**
   ```
   sudo raspi-config
   ```
   Go to **6 Advanced Options → Wayland → W1 X11**, then reboot. Re-run
   `bash install.sh` — it will detect X11 and use classic `unclutter`, which is
   rock-solid. (Switching to X11 has no downside for a kiosk display, and also
   makes the older `wlr-randr`/`xdotool`-style tools work again if you need them.)
3. **Prefer to stay on Wayland?** The installer will have tried `unclutter-xfixes`.
   If that didn't stick, hiding the cursor on Wayland requires a compositor plugin
   that isn't in the Pi's package repos (it has to be compiled) — switching to X11
   is much simpler and is the recommended path for a kiosk.

---

## Find your Pi's IP address

```bash
hostname -I
```

Or check your router's connected devices page.

---

## Can't reach the app from your phone or laptop?

The server listens on all network interfaces (`0.0.0.0:3000`), so other devices on
the same network *should* reach it at `http://<pi-ip>:3000/app`. If they can't, work
through these in order:

1. **Use the Pi's LAN IP, not `localhost`.** `localhost`/`127.0.0.1` only works on the
   Pi itself. From another device you must use the address from `hostname -I`
   (e.g. `http://192.168.1.42:3000/app`).
2. **Confirm the server is actually running and listening:**
   ```bash
   sudo ss -tlnp | grep 3000
   ```
   You should see it bound to `0.0.0.0:3000` (or `*:3000`). If nothing shows, the
   server isn't running — start it with `npm start`.
3. **Check the firewall.** This is the most common cause. If `ufw` is active, port
   3000 is likely blocked:
   ```bash
   sudo ufw status
   sudo ufw allow 3000/tcp     # if ufw is active and 3000 isn't listed
   ```
4. **Same network?** Phone on cellular, or a "guest"/IoT Wi-Fi network that isolates
   clients, won't reach the Pi. Put both devices on the same LAN/Wi-Fi.
5. **Test from the Pi first:** `curl -I http://localhost:3000/app` should return
   `HTTP/1.1 200`. If that works but remote doesn't, it's a network/firewall issue,
   not the app.

---

## Display orientation & rotation (no OS rotation needed)

You can now control orientation entirely from the **Displays** tab in the app — no
`wlr-randr`, OS rotation, or the rotation-watchdog script required:

- **Force Orientation** — make a display always use its Landscape or Portrait layout
  regardless of the physical screen's reported dimensions (or leave it on Auto).
- **Rotate View** — spins the *entire* display 90/180/270° inside the browser. Use
  this when a screen is physically mounted sideways: design a Portrait layout, then
  rotate the view 90° so it fills a landscape panel turned on its side.

Because rotation happens in the browser, your Chromium kiosk can launch with no
special flags and the OS screen can stay in its default landscape orientation. Each
display profile remembers its own orientation + rotation, and changes apply to the
live screen instantly.

The old `scripts/rotation-watchdog.*` files are kept for anyone who still prefers
OS-level rotation, but are no longer needed for the in-app approach above.

---

## Project structure

```
piazzahq/
├── server.js          # Express server + SQLite + API
├── package.json
├── calendar.db        # Created automatically on first run
└── public/
    ├── display.html   # Always-on display (kiosk)
    └── app.html       # Mobile control app
```

## License

Proprietary — see [LICENSE](./LICENSE). Personal/organizational use on your
own hardware is fine, including modifying your own local copy. Redistributing
this software (original or modified) to anyone else isn't.
