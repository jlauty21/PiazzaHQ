#!/usr/bin/env bash
#
# Piazza HQ — installer / updater
# ----------------------------------
# Safe to run on a fresh Pi OR re-run on an existing install. It:
#   • installs only what's missing (Node 20+, unzip, unclutter)
#   • never overwrites your data (database, uploaded photos, session secret)
#   • never clobbers an existing kiosk autostart — it only adds its line if absent
#   • sets up (but won't silently replace) the systemd service
#
# Usage (from the folder containing this script and the project files):
#   bash install.sh
#
# Or to unpack from a zip first, see the README "Automated install" section.

set -euo pipefail

# ── Pretty output ─────────────────────────────────────────────────────────────
BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; BLU=$'\033[36m'; RST=$'\033[0m'
say()  { echo "${BLU}${BOLD}==>${RST} $*"; }
ok()   { echo "  ${GRN}✓${RST} $*"; }
skip() { echo "  ${DIM}• $* (already done, skipping)${RST}"; }
warn() { echo "  ${YLW}!${RST} $*"; }
err()  { echo "${RED}${BOLD}error:${RST} $*" >&2; }

# ── Preconditions ─────────────────────────────────────────────────────────────
if [[ $EUID -eq 0 ]]; then
  err "Run this as your normal user (e.g. 'pi'), NOT as root/sudo."
  err "The script will call sudo itself only where needed."
  exit 1
fi

# Where the project lives. The script assumes it's being run from inside the
# project directory (where server.js + package.json are). If not found here,
# we look in the common spots.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="$(id -un)"
RUN_HOME="$HOME"

find_project_dir() {
  if [[ -f "$SCRIPT_DIR/server.js" && -f "$SCRIPT_DIR/package.json" ]]; then
    echo "$SCRIPT_DIR"; return 0
  fi
  for d in "$RUN_HOME/piazzahq" "$SCRIPT_DIR/piazzahq"; do
    if [[ -f "$d/server.js" ]]; then echo "$d"; return 0; fi
  done
  return 1
}

# Fresh-Pi convenience: if the project isn't unpacked yet but a piazzahq.zip
# is sitting next to this script (or on the boot partition from imaging), unpack
# it into the home folder first. Never overwrites an existing unpacked install.
maybe_unzip_project() {
  if find_project_dir >/dev/null 2>&1; then return 0; fi
  local zip=""
  for candidate in "$SCRIPT_DIR/piazzahq.zip" "$RUN_HOME/piazzahq.zip" "/boot/firmware/piazzahq.zip" "/boot/piazzahq.zip"; do
    [[ -f "$candidate" ]] && { zip="$candidate"; break; }
  done
  if [[ -n "$zip" ]]; then
    say "Unpacking project from ${zip}"
    command -v unzip >/dev/null 2>&1 || { sudo apt-get update -y && sudo apt-get install -y unzip; }
    # -n = don't overwrite existing files. This path only runs on a FRESH Pi
    # (no project found yet), so there's nothing to conflict with. The zip is
    # code-only — it never contains your database, photos, or session secret —
    # so updates (done by unzipping new code over an existing install before
    # re-running this script) are also safe for your data.
    unzip -n -q "$zip" -d "$RUN_HOME"
    ok "Unpacked to ${RUN_HOME}"
  fi
}

say "Piazza HQ installer"
echo "    User:  ${BOLD}${RUN_USER}${RST}"
echo "    Home:  ${RUN_HOME}"

maybe_unzip_project
PROJECT_DIR="$(find_project_dir || true)"
if [[ -z "${PROJECT_DIR:-}" ]]; then
  err "Couldn't find the project (server.js). Run this script from inside the"
  err "piazzahq folder, or place this script next to server.js."
  exit 1
fi
echo "    App:   ${PROJECT_DIR}"
echo

# ── 0. Enable SSH ────────────────────────────────────────────────────────────
# Done first, before anything else that could fail or need attention — so even
# if this run is happening at the Pi directly (monitor+keyboard, not SSH) and
# something later goes wrong, remote access for troubleshooting is already
# available rather than requiring another physical-access trip. Idempotent:
# skipped entirely if SSH is already enabled, whether that was done by this
# script on a previous run, via Raspberry Pi Imager's advanced options at
# flash time, or by hand.
say "Checking SSH"
if systemctl is-enabled ssh >/dev/null 2>&1 || systemctl is-active ssh >/dev/null 2>&1; then
  skip "SSH is already enabled"
elif command -v raspi-config >/dev/null 2>&1; then
  # raspi-config's nonint interface uses an inverted boolean here: 0 = enable.
  if sudo raspi-config nonint do_ssh 0 >/dev/null 2>&1; then
    ok "SSH enabled (via raspi-config)"
  else
    warn "raspi-config couldn't enable SSH — trying systemctl directly."
    sudo systemctl enable --now ssh >/dev/null 2>&1 \
      && ok "SSH enabled (via systemctl)" \
      || warn "Couldn't enable SSH automatically. Enable it manually: sudo raspi-config → Interface Options → SSH."
  fi
else
  # No raspi-config (unlikely on Raspberry Pi OS, but this project doesn't
  # strictly require it) — go straight to the generic systemd path.
  sudo systemctl enable --now ssh >/dev/null 2>&1 \
    && ok "SSH enabled (via systemctl)" \
    || warn "Couldn't enable SSH automatically. Enable it manually: sudo systemctl enable --now ssh"
fi
echo

# ── 1. System packages (apt) ──────────────────────────────────────────────────
say "Checking system packages"
APT_UPDATED=0
ensure_apt_pkg() {
  local pkg="$1"
  if dpkg -s "$pkg" >/dev/null 2>&1; then
    skip "$pkg"
  else
    if [[ $APT_UPDATED -eq 0 ]]; then
      say "Updating apt package lists (first install only)…"
      sudo apt-get update -y
      APT_UPDATED=1
    fi
    say "Installing $pkg…"
    sudo apt-get install -y "$pkg"
    ok "$pkg installed"
  fi
}
ensure_apt_pkg unzip
ensure_apt_pkg zip
ensure_apt_pkg curl
ensure_apt_pkg xdotool
ensure_apt_pkg cec-utils
# Color emoji font — without this, emoji in event titles, widgets, and the UI render
# as empty boxes ("tofu") on Raspberry Pi OS, which ships no color emoji font by default.
ensure_apt_pkg fonts-noto-color-emoji
# Refresh the font cache so Chromium picks up the new emoji font without a reboot.
command -v fc-cache >/dev/null 2>&1 && fc-cache -f >/dev/null 2>&1 || true
# Note: the cursor-hiding tool (unclutter / unclutter-xfixes) is installed later,
# in the session-detection step, because which one works depends on X11 vs Wayland.
echo

# ── 2. Node.js 20+ ────────────────────────────────────────────────────────────
say "Checking Node.js"
need_node=1
if command -v node >/dev/null 2>&1; then
  current_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "$current_major" -ge 20 ]]; then
    skip "Node.js $(node -v) (>= 20)"
    need_node=0
  else
    warn "Node.js $(node -v) is older than v20 — upgrading."
  fi
fi
if [[ $need_node -eq 1 ]]; then
  say "Installing Node.js 20 (NodeSource)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
fi
echo

# ── 3. npm dependencies ───────────────────────────────────────────────────────
say "Installing app dependencies (npm)"
cd "$PROJECT_DIR"
# npm install is idempotent; it no-ops when node_modules is already satisfied.
# better-sqlite3 compiles a native module here, which can take a few minutes the
# first time on a Pi — that's expected.
if [[ -d node_modules ]]; then
  echo "  ${DIM}node_modules exists — running npm install to sync any changes…${RST}"
fi
npm install --no-fund --no-audit
ok "Dependencies ready"
echo

# ── 4. Data safety check ──────────────────────────────────────────────────────
# This script never deletes or overwrites these. We just report what we found so
# the user knows their data is intact across a re-run/update.
say "Checking existing user data (left untouched)"
[[ -f "$PROJECT_DIR/calendar.db" ]]            && ok "Database found — preserved"            || echo "  ${DIM}• No database yet — will be created on first run${RST}"
[[ -d "$PROJECT_DIR/public/uploads" ]]         && ok "Uploaded photos found — preserved"     || echo "  ${DIM}• No uploads folder yet — created on first run${RST}"
[[ -f "$PROJECT_DIR/.session-secret" ]]        && ok "Session secret found — preserved"      || echo "  ${DIM}• No session secret yet — created on first run${RST}"
echo

# ── 5. systemd service (auto-start on boot) ───────────────────────────────────
say "Setting up the background service"
SERVICE_PATH="/etc/systemd/system/piazzahq.service"
NODE_BIN="$(command -v node)"
render_service() {
  cat <<EOF
[Unit]
Description=Piazza HQ Server
After=network-online.target
Wants=network-online.target systemd-time-wait-sync.service
# Requests a clock-sync check (systemd-time-wait-sync.service) via Wants=, but
# deliberately does NOT put it in After= — that would make our own service's
# startup block until it fully completes, and on a network with slow/flaky NTP
# (unrelated to anything about this Pi specifically — just real-world network
# conditions), that wait could stretch out indefinitely, turning "protect
# against a wrong boot-time clock" into "the server might not start for a
# long time," which is a worse problem than the one this was meant to solve.
# Wants= alone still nudges the sync to happen without our service waiting on it.


[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}
install_service=1
if [[ -f "$SERVICE_PATH" ]]; then
  # Compare; only rewrite if the user explicitly allows it (don't clobber silently).
  if diff -q <(render_service) "$SERVICE_PATH" >/dev/null 2>&1; then
    skip "service already up to date"
    install_service=0
  else
    warn "An existing piazzahq.service differs from what this installer would write."
    read -r -p "  Overwrite it with the standard service file? [y/N] " ans </dev/tty || ans="n"
    [[ "${ans,,}" == "y" ]] || { install_service=0; warn "Keeping your existing service file."; }
  fi
fi
if [[ $install_service -eq 1 ]]; then
  render_service | sudo tee "$SERVICE_PATH" >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable piazzahq >/dev/null 2>&1 || true
  ok "Service installed and enabled"
fi
# (Re)start it so we're running the current code.
sudo systemctl restart piazzahq
sleep 1
if systemctl is-active --quiet piazzahq; then
  ok "Service is running"
else
  warn "Service did not report active — check: journalctl -u piazzahq -e"
fi
echo

# ── 6. Detect the display session (X11 vs Wayland) ────────────────────────────
# This determines how to hide the mouse cursor — the single most version-specific
# part of a Pi kiosk. Classic `unclutter` ONLY works on X11; on Wayland (the
# Bookworm/Trixie default via labwc/wayfire) it runs but silently does nothing.
say "Detecting display session for cursor handling"
SESSION_TYPE="unknown"
# Ask systemd-logind directly what type the REAL graphical session (seat0) is
# running — this is ground truth, doesn't depend on which shell we're typing
# commands from (this installer is almost always run over SSH, where
# XDG_SESSION_TYPE is just "tty" — the SSH session's own type, telling us
# nothing about the actual display), and doesn't depend on raspi-config's
# internal nonint function names, which turned out NOT to be stable across OS
# versions (a Trixie image encountered during development had no `get_wayland`
# function at all, silently breaking that check on every single run).
if command -v loginctl >/dev/null 2>&1; then
  # seat0 typically has MORE than one session — a tty console (Type=tty) in
  # addition to the real graphical one — confirmed by direct testing, and the
  # console session isn't reliably the last one, so grabbing just the first
  # seat0 match (as an earlier version of this check did) can land on the
  # wrong session entirely. Loop through all of them and use the first one
  # whose type is actually x11 or wayland.
  for gui_session_id in $(loginctl list-sessions --no-legend 2>/dev/null | awk '$0 ~ /seat0/ {print $1}'); do
    gui_type="$(loginctl show-session "$gui_session_id" -p Type --value 2>/dev/null)"
    if [[ "$gui_type" == "x11" || "$gui_type" == "wayland" ]]; then
      SESSION_TYPE="$gui_type"
      break
    fi
  done
fi
# Fall back to session env vars — only trustworthy if we're actually running
# INSIDE the graphical session itself (e.g. a terminal opened on the kiosk
# desktop, not SSH).
if [[ "$SESSION_TYPE" == "unknown" ]]; then
  if [[ "${XDG_SESSION_TYPE:-}" == "x11" || "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    SESSION_TYPE="$XDG_SESSION_TYPE"
  elif [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    SESSION_TYPE="wayland"
  elif [[ -n "${DISPLAY:-}" ]]; then
    SESSION_TYPE="x11"
  fi
fi
# Next-to-last resort: ask raspi-config, if its nonint function for this
# happens to exist on this particular OS image (not guaranteed — see above).
if [[ "$SESSION_TYPE" == "unknown" ]] && command -v raspi-config >/dev/null 2>&1; then
  wl="$(sudo raspi-config nonint get_wayland 2>/dev/null || echo '')"
  case "$wl" in
    W1*|*X11*) SESSION_TYPE="x11" ;;
    W2*|W3*|*ayl*|*abwc*) SESSION_TYPE="wayland" ;;
  esac
fi
# True last resort, and an unreliable one: presence of a labwc/wayfire config
# directory. Unreliable specifically because switching an EXISTING install
# between Wayland and X11 leaves the old compositor's config directory sitting
# on disk — its mere presence doesn't mean it's still the active session. Only
# used if nothing more authoritative was available at all, and flagged loudly
# since it can be wrong.
if [[ "$SESSION_TYPE" == "unknown" ]]; then
  if [[ -d "$RUN_HOME/.config/labwc" || -f "$RUN_HOME/.config/wayfire.ini" ]]; then
    SESSION_TYPE="wayland"
    warn "Session type guessed from a leftover labwc/wayfire config directory — this can be wrong if you've switched sessions before. Double-check the result below."
  fi
fi
echo "    Session: ${BOLD}${SESSION_TYPE}${RST}"

# CURSOR_METHOD: how we'll hide the cursor for this session.
#   x11      -> classic unclutter (reliable)
#   xfixes   -> unclutter-xfixes (Wayland; works on many but not all builds)
#   manual   -> couldn't determine; we'll print guidance instead of failing silently
CURSOR_METHOD=""
CURSOR_AUTOSTART_LINE=""
if [[ "$SESSION_TYPE" == "x11" ]]; then
  ensure_apt_pkg unclutter
  CURSOR_METHOD="x11"
  CURSOR_AUTOSTART_LINE="unclutter -idle 0.1 -root &"
  ok "X11 session — classic unclutter will hide the cursor."
elif [[ "$SESSION_TYPE" == "wayland" ]]; then
  # On Wayland, prefer unclutter-xfixes if it's installable. It uses the XFIXES
  # extension via XWayland and works on many Pi builds (not guaranteed on all).
  if sudo apt-get install -y unclutter-xfixes >/dev/null 2>&1 && command -v unclutter-xfixes >/dev/null 2>&1; then
    CURSOR_METHOD="xfixes"
    # --start-hidden matters specifically for a kiosk with no real mouse attached:
    # without it, unclutter-xfixes only starts its hide timer after the FIRST real
    # pointer motion event — with no physical mouse ever generating one, the cursor
    # can sit visible indefinitely from boot. --start-hidden hides it immediately,
    # no motion required first.
    CURSOR_AUTOSTART_LINE="unclutter-xfixes --timeout 1 --hide-on-touch --start-hidden &"
    ok "Wayland session — installed unclutter-xfixes to hide the cursor."
    warn "If the cursor still shows after reboot, your Wayland build may not honor it."
    warn "The guaranteed fix is to switch the session to X11: see the note at the end."
  else
    CURSOR_METHOD="manual"
    warn "Wayland session, and no no-compile cursor-hider is available on this build."
  fi
else
  CURSOR_METHOD="manual"
  warn "Couldn't determine the session type (are you on SSH only?)."
fi
echo

# ── 7. Kiosk autostart (never clobbers an existing file) ──────────────────────
say "Configuring the kiosk display autostart"
KIOSK_URL="http://localhost:3000?nopreview"
# ?nopreview is explicit and deterministic — without it, the page guesses "preview
# mode" (used for the in-app layout-editor preview, on a phone/tablet) from viewport
# size alone, and a smaller or portrait-oriented real display can trip that same
# guess. Preview mode disables the cursor-hiding CSS rule among other things, which
# looks exactly like a cursor/unclutter problem but has nothing to do with it.

# Detect the Chromium binary name. On Raspberry Pi OS Bookworm/Trixie it's
# `chromium`; on older/other systems it's `chromium-browser`. Hardcoding the wrong
# one makes the kiosk silently never launch (you boot to the desktop instead), so
# we resolve it here and fail loudly if neither exists.
CHROMIUM_BIN=""
for c in chromium-browser chromium; do
  if command -v "$c" >/dev/null 2>&1; then CHROMIUM_BIN="$c"; break; fi
done
if [[ -z "$CHROMIUM_BIN" ]]; then
  warn "No Chromium found (looked for 'chromium' and 'chromium-browser')."
  warn "Installing chromium…"
  ensure_apt_pkg chromium || ensure_apt_pkg chromium-browser || true
  for c in chromium-browser chromium; do
    if command -v "$c" >/dev/null 2>&1; then CHROMIUM_BIN="$c"; break; fi
  done
fi
if [[ -n "$CHROMIUM_BIN" ]]; then
  ok "Using browser: ${CHROMIUM_BIN}"
else
  warn "Could not find or install Chromium — the kiosk line will use 'chromium' and you may need to fix it."
  CHROMIUM_BIN="chromium"
fi

# Set piazzahq.com as the homepage/new-tab page for a REGULAR (non-kiosk)
# Chromium window someone opens on this Pi — e.g. while troubleshooting, or
# just poking around the desktop. Deliberately does NOT touch the kiosk
# display itself: that always launches with an explicit URL on its own
# command line (see KIOSK_CMD below), which takes priority over any
# homepage/new-tab policy regardless, so this can't interfere with it.
# A Chromium policy file (not editing the live Preferences JSON, which is
# fragile — Chromium rewrites that file itself and a mid-edit conflict can
# corrupt it) is the standard, supported way to set this system-wide. The
# managed-policy directory's exact path depends on which Chromium package
# is actually installed, same as the binary name itself above.
CHROMIUM_POLICY_DIR="/etc/${CHROMIUM_BIN}/policies/managed"
if sudo mkdir -p "$CHROMIUM_POLICY_DIR" 2>/dev/null; then
  sudo tee "$CHROMIUM_POLICY_DIR/piazzahq-homepage.json" >/dev/null <<'POLICYEOF'
{
  "HomepageLocation": "https://piazzahq.com",
  "HomepageIsNewTabPage": false,
  "NewTabPageLocation": "https://piazzahq.com"
}
POLICYEOF
  ok "Set piazzahq.com as the homepage for a regular (non-kiosk) browser window."
else
  warn "Could not set the browser homepage (no permission to write ${CHROMIUM_POLICY_DIR}) — not fatal, just cosmetic."
fi

KIOSK_CMD="${CHROMIUM_BIN} --kiosk --disable-gpu --disable-extensions --disable-component-update --disable-background-networking --disable-sync --disable-features=Translate --renderer-process-limit=1 --noerrdialogs --disable-infobars --disable-restore-session-state --check-for-update-interval=31536000 --password-store=basic ${KIOSK_URL}"
# --password-store=basic: without this, Chromium tries to encrypt its saved-
# password store using a key held in the OS's keyring (GNOME Keyring via
# libsecret on Raspberry Pi OS) — and on an auto-login kiosk there's no login
# password for the OS to unlock that keyring WITH, so Chromium pops up its own
# "Unlock Keyring" dialog on every single boot, asking for a password that was
# never set and that this kiosk has no UI path to answer. This flag skips the
# OS keyring entirely in favor of Chromium's own local (still encrypted, just
# not keyring-backed) storage — no keyring interaction, no prompt, ever.
# --disable-gpu: some Pi/driver combos (VideoCore IV on a Pi 3 and earlier,
# specifically — it has no ES 3.0 support at all) fail to create a GLES 3.0
# context, which cascades into real instability — the network service
# crashing and restarting, child processes self-terminating after a "15
# seconds with no connection" timeout — and the end result is a page that
# never successfully paints, i.e. a white screen that persists indefinitely.
# Software rendering is plenty for a mostly-static, periodically-refreshing
# dashboard.
# --disable-extensions/--disable-component-update/--disable-background-
# networking/--disable-sync/--disable-features=Translate: trims subsystems
# this kiosk never needs (extension GC, background update checks, Google
# Cloud Messaging registration retries, sync, translate) — meaningful memory
# and CPU savings on a low-RAM Pi (e.g. a Pi 3 B+ with 1GB total) where
# Chromium's full process tree is competing for headroom right at boot,
# alongside the server's own initial calendar-sync work.
# --renderer-process-limit=1: this kiosk only ever shows one page in one
# "tab" — no reason to let Chromium reserve capacity for more.

# Detect the desktop session: labwc (Bookworm default) vs wayfire vs X11/LXDE.
LABWC_DIR="$RUN_HOME/.config/labwc"
WAYFIRE_INI="$RUN_HOME/.config/wayfire.ini"
# lxsession reads its autostart file from ~/.config/lxsession/<session-name>/
# autostart — the session name isn't a safe constant to assume. Confirmed by
# direct testing: an older/common convention uses "LXDE-pi", but this exact
# Trixie image actually runs a session named "rpd-x" (per both the running
# `lxsession -s rpd-x` process and lightdm.conf's user-session= setting) —
# hardcoding "LXDE-pi" silently wrote a perfectly correct, perfectly useless
# file that lxsession never once looked at. Read the real name from lightdm's
# own config instead of guessing, falling back to the older name only if that
# lookup comes up empty (e.g. a non-lightdm setup).
LXSESSION_NAME="LXDE-pi"
if [[ -f /etc/lightdm/lightdm.conf ]]; then
  detected_session="$(grep -oP '^\s*user-session\s*=\s*\K.*' /etc/lightdm/lightdm.conf 2>/dev/null | head -1 | tr -d '[:space:]')"
  [[ -n "$detected_session" ]] && LXSESSION_NAME="$detected_session"
fi
LXDE_AUTOSTART="$RUN_HOME/.config/lxsession/${LXSESSION_NAME}/autostart"
configured_kiosk=0

add_line_if_absent() {
  # $1 = file, $2 = line, $3 = grep-match to test presence
  local file="$1" line="$2" match="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  # The -- is deliberate and load-bearing: without it, a $match starting with
  # "--" (e.g. "--kiosk", used elsewhere in this script) gets parsed by grep as
  # an unrecognized OPTION rather than a search pattern — grep then errors out,
  # which this if/else reads as "not found," so the line gets appended again on
  # every single re-run instead of being recognized as already present.
  if grep -qF -- "$match" "$file" 2>/dev/null; then
    skip "autostart already references this ($(basename "$file"))"
  else
    printf '%s\n' "$line" >> "$file"
    ok "Added to $(basename "$file"): ${DIM}${line}${RST}"
  fi
}

if [[ "$SESSION_TYPE" == "x11" ]]; then
  # Restore any system-default autostart lines (like @lxpanel and
  # @pcmanfm --desktop) that are missing from the personal one. A personal
  # ~/.config/lxsession/<name>/autostart, once it exists, is used INSTEAD OF
  # (not merged with) the system-wide default at
  # /etc/xdg/lxsession/<name>/autostart — which is where the normal desktop
  # panel/wallpaper startup normally lives. Creating a fresh personal file
  # with only the kiosk-specific lines below (as this script used to do)
  # silently replaced that entirely — confirmed on real hardware: no lxpanel,
  # no pcmanfm, anywhere, leaving nothing to draw a desktop behind the kiosk
  # once it's toggled off (looks exactly like "kiosk off did nothing," a
  # black screen, even though it worked correctly).
  # Line-by-line via the same idempotent add_line_if_absent() this script
  # already uses everywhere else — not a one-time "seed if empty" — so this
  # also repairs an install that already hit this bug before this fix
  # existed (a personal file with kiosk-only content, missing the
  # desktop-shell lines), not just brand-new ones. Safe to re-run: a line
  # already present, from either source, is never duplicated.
  SYSTEM_LXDE_AUTOSTART="/etc/xdg/lxsession/${LXSESSION_NAME}/autostart"
  # A genuinely fresh Pi, especially one SSHed into and set up very soon after
  # first boot, can still be finishing its OWN first-boot package setup at the
  # exact moment this runs — confirmed on real hardware: this system file
  # didn't exist yet on a fresh install run shortly after flashing, silently
  # skipping this entire restoration with no warning at all (the file just
  # not being there yet looked identical to "nothing to restore"). A short
  # retry catches that window; the file is a static package artifact once
  # actually installed, not something that changes further after that.
  _sysauto_tries=0
  while [[ ! -f "$SYSTEM_LXDE_AUTOSTART" && $_sysauto_tries -lt 10 ]]; do
    sleep 2
    _sysauto_tries=$((_sysauto_tries + 1))
  done
  if [[ -f "$SYSTEM_LXDE_AUTOSTART" ]]; then
    while IFS= read -r sys_line; do
      [[ -z "$sys_line" ]] && continue
      add_line_if_absent "$LXDE_AUTOSTART" "$sys_line" "$sys_line"
    done < "$SYSTEM_LXDE_AUTOSTART"
  else
    warn "Couldn't find $SYSTEM_LXDE_AUTOSTART after waiting — the desktop"
    warn "panel/wallpaper may be missing if you ever toggle the kiosk off"
    warn "(Ctrl+Alt+K), showing black instead. If that happens, re-run this"
    warn "script once the desktop has fully finished its own first-boot setup."
  fi
  # LXDE-pi's autostart is NOT a shell script — each line is a single command,
  # prefixed with @ (LXSession itself manages backgrounding/restart-on-crash,
  # so no trailing "&" and no ";"-chained commands). This used to be missed
  # entirely: the old check below only tested "does ~/.config/labwc exist" —
  # switching an existing install from Wayland to X11 via raspi-config leaves
  # that directory sitting on disk, so a re-run kept silently writing to the
  # now-inert labwc autostart file instead of the one X11 actually reads.
  add_line_if_absent "$LXDE_AUTOSTART" "@xset s off" "xset s off"
  add_line_if_absent "$LXDE_AUTOSTART" "@xset -dpms" "xset -dpms"
  add_line_if_absent "$LXDE_AUTOSTART" "@xset s noblank" "xset s noblank"
  if [[ -n "$CURSOR_AUTOSTART_LINE" ]]; then
    add_line_if_absent "$LXDE_AUTOSTART" "@${CURSOR_AUTOSTART_LINE%% &}" "unclutter"
  fi
  add_line_if_absent "$LXDE_AUTOSTART" \
    "@${PROJECT_DIR}/scripts/wait-for-server-and-launch-kiosk.sh ${KIOSK_CMD}" "--kiosk"
  configured_kiosk=1
elif [[ -d "$LABWC_DIR" || ! -f "$WAYFIRE_INI" ]]; then
  # labwc autostart is a shell script of background commands.
  # Disable screen blanking / DPMS power-saving so the display never sleeps.
  # On X11 these xset calls do the work; on Wayland they harmlessly no-op and the
  # in-app Screen Wake Lock (in display.html) keeps the screen awake instead.
  add_line_if_absent "$LABWC_DIR/autostart" \
    "xset s off -dpms; xset s noblank" "xset s off"
  # Only add a cursor-hider line if we have one that actually works here.
  if [[ -n "$CURSOR_AUTOSTART_LINE" ]]; then
    add_line_if_absent "$LABWC_DIR/autostart" "$CURSOR_AUTOSTART_LINE" "unclutter"
  fi
  # Match on "--kiosk" (binary-agnostic) so we detect an existing kiosk line whether
  # it used chromium or chromium-browser. Waits for the server to actually be
  # accepting connections before launching Chromium — a fixed sleep here used to
  # cause a white-screen-until-F5 on any boot slower than the guessed delay (see
  # scripts/wait-for-server-and-launch-kiosk.sh for the full story).
  add_line_if_absent "$LABWC_DIR/autostart" \
    "${PROJECT_DIR}/scripts/wait-for-server-and-launch-kiosk.sh ${KIOSK_CMD} &" "--kiosk"
  configured_kiosk=1
fi
if [[ "$SESSION_TYPE" != "x11" && -f "$WAYFIRE_INI" ]]; then
  if grep -qF "ced --kiosk" "$WAYFIRE_INI" 2>/dev/null || grep -qF "chromium" "$WAYFIRE_INI" 2>/dev/null; then
    skip "wayfire.ini already has a kiosk entry"
  else
    warn "Detected wayfire.ini. Add this under its [autostart] section manually:"
    echo "      kiosk = ${PROJECT_DIR}/scripts/wait-for-server-and-launch-kiosk.sh ${KIOSK_CMD}"
    [[ -n "$CURSOR_AUTOSTART_LINE" ]] && echo "      cursor = ${CURSOR_AUTOSTART_LINE%% &}"
  fi
  configured_kiosk=1
fi
if [[ $configured_kiosk -eq 0 ]]; then
  warn "Couldn't detect labwc or wayfire. Add this to your desktop's autostart:"
  echo "      ${PROJECT_DIR}/scripts/wait-for-server-and-launch-kiosk.sh ${KIOSK_CMD}"
fi
echo

# ── 8. Kiosk control command ──────────────────────────────────────────────────
# Installs the `kiosk` helper to /usr/local/bin so you can type `kiosk off`,
# `kiosk on`, or `kiosk toggle` from anywhere to drop in/out of the fullscreen
# display for maintenance — no racing an auto-relaunching browser.
say "Installing the 'kiosk' control command"
if [[ -f "$PROJECT_DIR/scripts/kiosk" ]]; then
  sudo install -m 0755 "$PROJECT_DIR/scripts/kiosk" /usr/local/bin/kiosk
  ok "Installed — run: kiosk off | on | toggle | restart | status"
else
  warn "scripts/kiosk not found in the project; skipping."
fi
echo

# ── 8b. Keyboard shortcut for kiosk toggle (Ctrl+Alt+K) ────────────────────────
# Binds Ctrl+Alt+K to `kiosk toggle` in whichever window manager's config so
# there's a single keypress instead of needing SSH. Written for BOTH labwc and
# openbox regardless of the CURRENTLY detected session — same reasoning as the
# autostart files below: this Pi might switch to X11 later in this very run
# (step 10), and writing both now means whichever session is actually active
# after the single reboot at the end already has the shortcut ready, with no
# separate re-run needed. Idempotent — safe to run on every install/update.
#
# NOT Super+K (what earlier versions of this installer used): confirmed on real
# hardware that the Raspberry Pi desktop panel grabs the Super key by itself as
# a "tap to open the Pi menu" gesture, independent of whatever else is pressed
# with it — so Super+K actually arrived as two separate events (Super opens the
# menu, K lands a beat later as a search keystroke inside it) rather than one
# combined chord reaching openbox/labwc's own keybind handler. Ctrl+Alt has no
# such conflict.
say "Setting up a keyboard shortcut (Ctrl+Alt+K) for kiosk toggle"
bind_kiosk_key() {
  local rc_file="$1" system_default="$2" keybind_xml="$3" key_match="$4"
  if [[ ! -f "$rc_file" ]]; then
    if [[ -f "$system_default" ]]; then
      mkdir -p "$(dirname "$rc_file")"
      cp "$system_default" "$rc_file"
    else
      return 1  # no config to personalize and no system default to seed from
    fi
  fi
  # Match on THIS specific key combo, not just "any kiosk toggle binding
  # exists" — otherwise a Pi already carrying the old Super+K binding from an
  # earlier version of this installer would look "already done" and never get
  # the new Ctrl+Alt+K one added alongside it on a re-run.
  if grep -qF -- "$key_match" "$rc_file" 2>/dev/null; then
    return 0  # this exact combo is already bound — nothing to do
  fi
  if ! grep -q '</keyboard>' "$rc_file" 2>/dev/null; then
    return 1  # no <keyboard> section to insert into; don't guess
  fi
  # Insert right before the closing </keyboard> tag.
  local tmp; tmp="$(mktemp)"
  awk -v kb="$keybind_xml" '{ if ($0 ~ /<\/keyboard>/) print kb; print }' "$rc_file" > "$tmp" && mv "$tmp" "$rc_file"
}

LABWC_RC="$RUN_HOME/.config/labwc/rc.xml"
if bind_kiosk_key "$LABWC_RC" "/etc/xdg/labwc/rc.xml" \
     '    <keybind key="C-A-k"><action name="Execute" command="kiosk toggle" /></keybind>' \
     'key="C-A-k"'; then
  ok "labwc: Ctrl+Alt+K → kiosk toggle ($LABWC_RC)"
else
  warn "labwc: couldn't set up the shortcut automatically (no config to personalize). See README for the manual steps."
fi

# The personal openbox config's filename has genuinely changed between
# Raspberry Pi OS releases — older images use lxde-pi-rc.xml, current
# "Raspberry Pi Desktop"-branded ones use rpd-rc.xml. Rather than hardcode
# either (guaranteed to eventually be wrong again on some image), resolve it
# the same way the OS itself does: if openbox is already running (the normal
# case — this installer is usually run from a desktop session, or over SSH
# into one that's already logged in), its own --config-file argument is the
# single most authoritative answer for exactly this system. Otherwise, check
# which system-wide default under /etc/xdg/openbox/ actually exists.
resolve_openbox_basename() {
  local running_cfg
  running_cfg="$(pgrep -a openbox 2>/dev/null | grep -oP -- '--config-file \K\S+' | head -n1)"
  if [[ -n "$running_cfg" ]]; then
    basename "$running_cfg"
    return 0
  fi
  local name
  for name in rpd-rc.xml lxde-pi-rc.xml rc.xml; do
    [[ -f "/etc/xdg/openbox/$name" ]] && { echo "$name"; return 0; }
  done
  echo "rpd-rc.xml"  # last-resort guess — current Raspberry Pi OS naming
}
OPENBOX_BASENAME="$(resolve_openbox_basename)"
OPENBOX_RC="$RUN_HOME/.config/openbox/${OPENBOX_BASENAME}"
if bind_kiosk_key "$OPENBOX_RC" "/etc/xdg/openbox/${OPENBOX_BASENAME}" \
     '    <keybind key="C-A-k"><action name="Execute"><command>kiosk toggle</command></action></keybind>' \
     'key="C-A-k"'; then
  ok "openbox (X11): Ctrl+Alt+K → kiosk toggle ($OPENBOX_RC)"
else
  warn "openbox: couldn't set up the shortcut automatically (no config to personalize). See README for the manual steps."
fi
echo "  ${DIM}Takes effect after the reboot at the end of this install (or right away if you"
echo "  reconfigure/reload your window manager yourself).${RST}"
echo

# ── 9. Optional remote access (Tailscale) ─────────────────────────────────────
# Lets the control app be reached from anywhere (not just home WiFi) over a
# private network. Fully optional and can also be run later, standalone, via
# setup-remote-access.sh. We delegate to that script so there's one source of
# truth and the "set it up later" path is identical to setting it up now.
REMOTE_SCRIPT="$PROJECT_DIR/setup-remote-access.sh"
if [[ -f "$REMOTE_SCRIPT" ]]; then
  say "Remote access (optional)"
  echo "  Want to reach the control app from ${BOLD}anywhere${RST}, not just home WiFi?"
  echo "  This sets up Tailscale — a private network, nothing exposed publicly."
  echo "  ${DIM}You can also skip now and run it later:  bash setup-remote-access.sh${RST}"
  echo
  read -r -p "  Configure remote access now? [y/N] " want_remote </dev/tty || want_remote="n"
  if [[ "${want_remote,,}" == "y" ]]; then
    # Delegate to the standalone script with --yes (it skips its own intro prompt
    # since we just asked). It runs on the real terminal so the interactive
    # Tailscale login link works normally.
    echo
    bash "$REMOTE_SCRIPT" --yes </dev/tty || warn "Remote access setup didn't finish; you can re-run: bash setup-remote-access.sh"
  else
    echo "  ${DIM}Skipped. Set it up anytime with:  bash setup-remote-access.sh${RST}"
  fi
  echo
fi

# ── 10. Offer to switch to X11 (moved to the very end, deliberately) ──────────
# This used to be offered early, right after session detection — but switching
# only takes effect after a reboot (raspi-config just sets next-boot config; the
# CURRENTLY running session doesn't change), so accepting it early meant exiting
# immediately with almost nothing installed yet and being told to reboot AND
# re-run the whole installer from scratch. Asking here instead — after
# everything (Node, the app, systemd, kiosk autostart for the CURRENT session)
# is already fully installed and working — means accepting costs nothing extra:
# we also write the X11-specific autostart file right now (reusing the same
# add_line_if_absent/LXDE_AUTOSTART/KIOSK_CMD from the earlier autostart step),
# so BOTH the Wayland and X11 autostart files are ready before the single reboot
# at the end, whichever session actually comes up.
#
# Across real testing, Wayland/labwc has been the source of nearly every
# hard-to-diagnose kiosk issue: cursor-hiding tools that silently do nothing on
# some builds, GPU/EGL driver incompatibilities cascading into real Chromium
# instability, and XWayland-vs-native-Wayland input/rendering mismatches that
# simply don't exist under X11. Only offered if raspi-config itself is present
# and the current session is actually Wayland — nothing to switch otherwise.
if [[ "$SESSION_TYPE" == "wayland" ]] && command -v raspi-config >/dev/null 2>&1; then
  say "Optional: switch to X11"
  warn "This Pi is running Wayland. Real-world testing has found this to be the"
  warn "single biggest source of hard-to-diagnose kiosk problems — cursor-hiding"
  warn "that silently does nothing, GPU driver incompatibilities, and input/"
  warn "rendering mismatches that simply don't exist under X11."
  read -r -p "  Switch this Pi to X11 now (recommended, needs a reboot)? [Y/n] " switch_ans </dev/tty || switch_ans="n"
  if [[ "${switch_ans,,}" != "n" ]]; then
    if sudo raspi-config nonint do_wayland W1 >/dev/null 2>&1; then
      ok "Switched to X11 (takes effect on the next reboot, along with everything else)."
      # Re-detect the session name FRESH, right now, rather than trusting
      # LXSESSION_NAME from earlier in this run (computed while still on
      # Wayland) — if the switch itself changes lightdm.conf's user-session
      # value, that earlier value is now stale, and reusing it would silently
      # write the autostart entry to the wrong session's folder. Confirmed as
      # a real issue via direct testing: X11 was active after reboot, but the
      # kiosk never launched, because of exactly this.
      fresh_session="LXDE-pi"
      if [[ -f /etc/lightdm/lightdm.conf ]]; then
        detected_fresh="$(grep -oP '^\s*user-session\s*=\s*\K.*' /etc/lightdm/lightdm.conf 2>/dev/null | head -1 | tr -d '[:space:]')"
        [[ -n "$detected_fresh" ]] && fresh_session="$detected_fresh"
      fi
      # Belt and suspenders: write to every DISTINCT candidate name we have —
      # the originally-detected one, the freshly re-read one, and the classic
      # "LXDE-pi" fallback — rather than betting everything on exactly one
      # being correct. Harmless if a candidate turns out unused: an autostart
      # file sitting in an irrelevant session folder simply never gets read.
      ensure_apt_pkg unclutter
      declare -A written_sessions=()
      for candidate in "$LXSESSION_NAME" "$fresh_session" "LXDE-pi"; do
        [[ -n "${written_sessions[$candidate]:-}" ]] && continue
        written_sessions["$candidate"]=1
        target_autostart="$RUN_HOME/.config/lxsession/${candidate}/autostart"
        add_line_if_absent "$target_autostart" "@xset s off" "xset s off"
        add_line_if_absent "$target_autostart" "@xset -dpms" "xset -dpms"
        add_line_if_absent "$target_autostart" "@xset s noblank" "xset s noblank"
        add_line_if_absent "$target_autostart" "@unclutter -idle 0.1 -root" "unclutter"
        add_line_if_absent "$target_autostart" \
          "@${PROJECT_DIR}/scripts/wait-for-server-and-launch-kiosk.sh ${KIOSK_CMD}" "--kiosk"
      done
      ok "Kiosk autostart written for session name(s): ${!written_sessions[*]}"
      CURSOR_METHOD="x11"  # reflects reality after the switch, for the cursor note near the end
      SWITCHED_TO_X11=1
    else
      # Confirmed by direct testing: some OS images don't have this raspi-config
      # function at all (silently fails rather than erroring loudly), so fall back
      # to walking through the interactive menu instead of leaving them stuck.
      warn "Couldn't switch automatically (this image's raspi-config may not"
      warn "support the non-interactive option). Do it manually instead:"
      echo "      sudo raspi-config   →  6 Advanced Options  →  Wayland  →  W1 X11  →  reboot"
      echo "  Then re-run this installer; it'll detect X11 and use classic unclutter."
    fi
  fi
  echo
fi

# ── Done ──────────────────────────────────────────────────────────────────────
IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "${GRN}Install complete.${RST}"
echo
echo "  Display (this Pi):   ${KIOSK_URL}"
echo "  Control app (local): http://${IP_ADDR:-<this-pi-ip>}:3000/app   ${DIM}(same WiFi only)${RST}"
# Remote (Tailscale) address — ALWAYS shown, in one of three states, rather than
# silently disappearing when it's not connected (that silence is exactly what
# made a real install look like Tailscale "only gave a local IP": it had in fact
# not finished connecting, and the line just vanished instead of saying so).
if ! command -v tailscale >/dev/null 2>&1; then
  echo "  Control app (remote):${DIM}not set up${RST}   ${DIM}run: bash setup-remote-access.sh${RST}"
elif tailscale status >/dev/null 2>&1 && TS_IP="$(tailscale ip -4 2>/dev/null | head -n1)" && [[ -n "$TS_IP" ]]; then
  echo "  Control app (remote):http://${TS_IP}:3000/app   ${DIM}(from anywhere, via Tailscale)${RST}"
else
  warn "Control app (remote): Tailscale is installed but NOT connected yet."
  echo "                          Run: ${BOLD}sudo tailscale up${RST}   (opens a login link — sign in on any device)"
  echo "                          Then re-check with:  tailscale status"
fi
echo
if [[ "${SWITCHED_TO_X11:-0}" -eq 1 ]]; then
  echo "  The display will appear after a reboot — the same one that also"
  echo "  finishes switching this Pi to X11."
else
  echo "  The display will appear after a reboot."
fi
echo

# Surface the cursor situation clearly, including the guaranteed fix if our
# session-aware method might not stick (this is the exact thing that bit you
# before — unclutter silently doing nothing on Wayland).
if [[ "$CURSOR_METHOD" == "manual" || "$CURSOR_METHOD" == "xfixes" ]]; then
  echo "  ${YLW}${BOLD}About the mouse cursor:${RST}"
  if [[ "$CURSOR_METHOD" == "xfixes" ]]; then
    echo "  Installed unclutter-xfixes for your Wayland session. If the cursor STILL"
    echo "  shows after rebooting, your build doesn't honor it — use the sure fix below."
  else
    echo "  Couldn't set up automatic cursor-hiding for this session."
  fi
  echo "  ${BOLD}Guaranteed fix — switch the desktop to X11, where cursor-hiding always works:${RST}"
  echo "      sudo raspi-config    →  6 Advanced Options  →  Wayland  →  W1 X11  →  reboot"
  echo "  Then re-run this installer; it will detect X11 and use classic unclutter."
  echo
fi
echo "  Useful commands:"
echo "      kiosk off                             # drop to the desktop for maintenance"
echo "      kiosk on                              # bring the fullscreen display back"
echo "      kiosk toggle                          # flip between the two"
echo "      bash setup-remote-access.sh           # add remote access (or --status to check)"
echo "      sudo systemctl status piazzahq     # is the server running?"
echo "      journalctl -u piazzahq -f          # live logs"
echo "      sudo systemctl restart piazzahq    # restart after changes"
echo

# ── Reboot ──────────────────────────────────────────────────────────────────
# Genuinely automatic, not just described as such: defaults to yes with a 15s
# timeout, so this actually happens on its own if nobody's at the terminal to
# respond (e.g. someone started this over SSH and stepped away) — matching
# what the setup guide on the website actually tells people to expect, rather
# than leaving a real "run this yourself" step so easy to miss it might as
# well not exist. Still a real choice, not forced: answering "n" in time skips
# it entirely.
read -t 15 -r -p "  Reboot now to launch the display? [Y/n] " reboot_ans </dev/tty || reboot_ans="y"
echo
if [[ "${reboot_ans,,}" == "n" ]]; then
  echo "  Skipped. Reboot whenever you're ready: ${BOLD}sudo reboot${RST}"
else
  say "Rebooting…"
  sudo reboot
fi
