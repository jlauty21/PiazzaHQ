#!/usr/bin/env bash
#
# wait-for-server-and-launch-kiosk.sh — waits for the Piazza HQ server to
# actually be accepting connections before launching the Chromium kiosk.
#
# Why this exists: the desktop session's autostart and the piazzahq.service
# systemd unit start independently, with no ordering between them. This used
# to be a fixed "sleep 8 && launch chromium" — a guess. On a slower boot (SD
# card contention, an older Pi, or heavy first-boot activity) that guess can
# be wrong: Chromium loads before the server is listening, gets a connection
# failure, and — since --kiosk mode has no retry-on-failure — just sits on a
# blank/white screen with nothing to trigger a reload, until someone
# physically walks over and hits F5. This polls for the server to actually
# be ready instead of guessing a fixed delay.

set -uo pipefail

URL="${PI_CALENDAR_URL:-http://localhost:3000}"
MAX_WAIT_SECS="${PI_CALENDAR_KIOSK_MAX_WAIT:-90}"

waited=0
until curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; do
  sleep 1
  waited=$((waited + 1))
  if [[ $waited -ge $MAX_WAIT_SECS ]]; then
    # Give up waiting and launch anyway after a reasonable cap, rather than
    # leaving the display stuck with no browser at all if the server is
    # genuinely broken — at least this way there's something on screen, and
    # it'll self-heal on its own once the server does come up (Piazza HQ
    # polls for live updates once loaded).
    break
  fi
done

# Nudge the mouse pointer once, a few seconds after Chromium launches. This is a
# pragmatic workaround, not a root-cause fix: on this compositor/browser
# combination, the cursor only reliably hides after it receives a genuine motion
# event, regardless of --start-hidden or CSS cursor:none — confirmed by direct,
# repeated testing rather than assumed. xdotool's synthetic move (via XWayland,
# which is present alongside labwc) is enough to trigger the same hide-after-idle
# behavior a real mouse touch would. Runs in the background so it doesn't delay
# the exec below; harmless no-op if xdotool isn't installed.
#
# Confirmed by direct testing that earlier attempts were failing SILENTLY on
# "Can't open display: (null)" — a background script launched from the session
# autostart doesn't reliably inherit DISPLAY the way an interactive SSH shell
# does, and stderr was being thrown away, hiding the failure entirely. It was
# never a distance/timing problem; xdotool never ran successfully even once.
# :0 is standard for XWayland on a single-session Pi kiosk (confirmed via the
# running Xwayland process on real hardware); override via XDOTOOL_DISPLAY if
# a particular setup ever differs.
if command -v xdotool >/dev/null 2>&1; then
  ( sleep 6
    export DISPLAY="${XDOTOOL_DISPLAY:-:0}"
    xdotool mousemove_relative -- 200 0 >/tmp/piazzahq-xdotool.log 2>&1
    sleep 0.5
    xdotool mousemove_relative -- -200 0 >>/tmp/piazzahq-xdotool.log 2>&1
  ) &
  disown 2>/dev/null || true
fi

exec "$@"
