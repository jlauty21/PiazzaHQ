#!/usr/bin/env bash
#
# hide-cursor — set up automatic mouse-cursor hiding for the Piazza HQ kiosk
# ----------------------------------------------------------------------------
# Use this if you installed the app without running the full install.sh and the
# mouse cursor is still showing on the display. It detects X11 vs Wayland and
# sets up the right tool, exactly like the full installer's cursor step.
#
#   bash hide-cursor.sh
#
# Safe to re-run.

set -uo pipefail
GRN=$'\033[32m'; YLW=$'\033[33m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RST=$'\033[0m'
say(){ echo "${BOLD}==>${RST} $*"; }
ok(){ echo "  ${GRN}✓${RST} $*"; }
warn(){ echo "  ${YLW}!${RST} $*"; }

RUN_HOME="$HOME"

# Detect session type (X11 vs Wayland) the same way install.sh does.
SESSION_TYPE="unknown"
if [[ "${XDG_SESSION_TYPE:-}" == "x11" || "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
  SESSION_TYPE="$XDG_SESSION_TYPE"
elif [[ -n "${WAYLAND_DISPLAY:-}" ]]; then SESSION_TYPE="wayland"
elif [[ -n "${DISPLAY:-}" ]]; then SESSION_TYPE="x11"
else
  if command -v raspi-config >/dev/null 2>&1; then
    wl="$(sudo raspi-config nonint get_wayland 2>/dev/null || echo '')"
    case "$wl" in W1*|*X11*) SESSION_TYPE="x11";; W2*|W3*) SESSION_TYPE="wayland";; esac
  fi
  [[ "$SESSION_TYPE" == "unknown" && ( -d "$RUN_HOME/.config/labwc" || -f "$RUN_HOME/.config/wayfire.ini" ) ]] && SESSION_TYPE="wayland"
fi
say "Detected session: ${BOLD}${SESSION_TYPE}${RST}"

CURSOR_LINE=""
if [[ "$SESSION_TYPE" == "x11" ]]; then
  sudo apt-get install -y unclutter >/dev/null 2>&1 || true
  CURSOR_LINE="unclutter -idle 0.1 -root &"
  ok "Installed classic unclutter (X11)."
elif [[ "$SESSION_TYPE" == "wayland" ]]; then
  if sudo apt-get install -y unclutter-xfixes >/dev/null 2>&1 && command -v unclutter-xfixes >/dev/null 2>&1; then
    CURSOR_LINE="unclutter-xfixes --timeout 1 --hide-on-touch &"
    ok "Installed unclutter-xfixes (Wayland)."
    warn "If the cursor still shows after reboot, your Wayland build may not honor it."
    warn "Guaranteed fix: sudo raspi-config -> Advanced -> Wayland -> W1 X11 -> reboot, then re-run this."
  else
    warn "No no-compile cursor-hider available for this Wayland build."
    warn "Guaranteed fix: switch to X11 via sudo raspi-config (Advanced -> Wayland -> W1 X11),"
    warn "reboot, then re-run this script."
    exit 0
  fi
else
  warn "Couldn't detect the session. Run this from the Pi's desktop, not pure SSH."
  exit 0
fi

# Add the cursor-hider to the labwc autostart (create if needed), without dupes.
LABWC_AUTOSTART="$RUN_HOME/.config/labwc/autostart"
mkdir -p "$(dirname "$LABWC_AUTOSTART")"; touch "$LABWC_AUTOSTART"
if grep -q "unclutter" "$LABWC_AUTOSTART" 2>/dev/null; then
  ok "Autostart already has a cursor-hider line."
else
  printf '%s\n' "$CURSOR_LINE" >> "$LABWC_AUTOSTART"
  ok "Added cursor-hider to ~/.config/labwc/autostart"
fi

# Start it now too, so you don't have to reboot to see the effect.
if [[ -n "$DISPLAY" || -n "${WAYLAND_DISPLAY:-}" ]]; then
  eval "${CURSOR_LINE%% &}" >/dev/null 2>&1 &
  ok "Started now — move the mouse and leave it; the pointer should vanish."
fi
echo
say "${GRN}Done.${RST} If anything's off, a reboot applies it cleanly."
