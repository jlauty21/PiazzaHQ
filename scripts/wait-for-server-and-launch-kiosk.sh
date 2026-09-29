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

# One line per boot in /tmp/piazzahq-kiosk-launch.log (cleared on reboot with
# /tmp): how long each wait took and what the fullscreen guard below did. A
# "white screen at boot" report used to come with nothing to look at; this is
# the first thing to ask an affected user for.
LOG="${PI_CALENDAR_KIOSK_LOG:-/tmp/piazzahq-kiosk-launch.log}"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null || true; }
POLL="${PI_CALENDAR_POLL_INTERVAL:-1}"
log "kiosk launcher started; server answered after ${waited}s (cap ${MAX_WAIT_SECS}s)"

# Wait for the DESKTOP too, not just the server. The session autostart runs this
# in parallel with the window manager and panel coming up; if Chromium's
# --kiosk window is created before the window manager exists, nothing applies
# the fullscreen request to it, and the window sits there blank/white at the
# wrong size until something forces a re-layout - pressing F11 does exactly
# that, which is what affected users report. Bounded, and a no-op wherever we
# can't tell (no display variables, tools missing): never worse than before.
DESKTOP_MAX_WAIT="${PI_CALENDAR_DESKTOP_MAX_WAIT:-20}"
desktop_ready() {
  if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    [[ -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/${WAYLAND_DISPLAY}" ]]
    return
  fi
  [[ -z "${DISPLAY:-}" ]] && return 0
  if command -v xprop >/dev/null 2>&1; then
    xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'
    return
  fi
  pgrep -x -u "$(id -u)" 'openbox|labwc|wayfire|xfwm4|mutter|marco|metacity|kwin_x11|lxsession' >/dev/null 2>&1
}
dwaited=0
until desktop_ready; do
  sleep "$POLL"
  dwaited=$((dwaited + 1))
  if [[ $dwaited -ge $DESKTOP_MAX_WAIT ]]; then
    log "desktop did not report ready within ${DESKTOP_MAX_WAIT}s - launching anyway"
    break
  fi
done
[[ $dwaited -lt $DESKTOP_MAX_WAIT ]] && log "desktop ready after ${dwaited}s"
# Let a just-started window manager finish taking over the screen.
[[ $dwaited -gt 0 ]] && sleep "${PI_CALENDAR_DESKTOP_SETTLE:-2}"

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

# Fullscreen guard (X11 only). Two phases, both logged:
#  1. WAIT for the browser window to exist. On a busy Pi 3 the window can take
#     30+ seconds after launch (measured: launcher at +0s, Chromium process at
#     +11s, window at ~+30s), so this waits up to PI_CALENDAR_GUARD_WINDOW_WAIT
#     seconds (default 120) instead of giving up early, and records how long the
#     window really took - the number a "white screen at boot" report needs.
#  2. CHECK it: if the window is NOT fullscreen and visibly smaller than the
#     screen - the "white until F11" state - press F11. Both conditions are
#     required, so a healthy fullscreen kiosk (or a window that already covers
#     the screen) is never touched; up to three looks, each verdict logged.
# Needs xdotool + xprop (xdotool is installed by install.sh); silently does
# nothing if either is missing or the window isn't an X11 one (a native Wayland
# Chromium isn't visible to them).
if command -v xdotool >/dev/null 2>&1; then
  # xprop (package x11-utils) is NOT installed on a stock Raspberry Pi OS. It only
  # tells us the window manager's "fullscreen" flag; without it the guard judges
  # by size alone (a window that covers the whole screen is fine), which is the
  # part that matters. Requiring it made the guard silently never run.
  HAVE_XPROP=0; command -v xprop >/dev/null 2>&1 && HAVE_XPROP=1
  LAUNCH_EPOCH="$(date +%s)"
  ( sleep "${PI_CALENDAR_GUARD_FIRST_DELAY:-5}"
    export DISPLAY="${DISPLAY:-${XDOTOOL_DISPLAY:-:0}}"
    WINDOW_WAIT="${PI_CALENDAR_GUARD_WINDOW_WAIT:-120}"
    elapsed() { echo $(( $(date +%s) - LAUNCH_EPOCH )); }

    # Sets W (window id) and WIDTH/HEIGHT for the first real browser window.
    find_window() {
      local w
      for w in $(xdotool search --onlyvisible --class 'chromium|Chromium' 2>/dev/null); do
        eval "$(xdotool getwindowgeometry --shell "$w" 2>/dev/null)" || continue
        # Skip tiny helper windows; only a real browser window counts.
        [[ "${WIDTH:-0}" -lt 200 || "${HEIGHT:-0}" -lt 200 ]] && continue
        W="$w"; return 0
      done
      return 1
    }

    # Phase 1: wait for the window.
    W=""
    until find_window; do
      if [[ $(elapsed) -ge $WINDOW_WAIT ]]; then
        log "fullscreen guard: no browser window appeared within ${WINDOW_WAIT}s of launch"
        exit 0
      fi
      sleep "${PI_CALENDAR_GUARD_POLL:-3}"
    done
    log "fullscreen guard: browser window appeared $(elapsed)s after launch (${WIDTH}x${HEIGHT})"

    # Phase 2: check it, up to three looks.
    for attempt in 1 2 3; do
      read -r SW SH < <(xdotool getdisplaygeometry 2>/dev/null) || true
      find_window || { log "fullscreen guard: the browser window went away"; exit 0; }
      if [[ $HAVE_XPROP -eq 1 ]] && xprop -id "$W" _NET_WM_STATE 2>/dev/null | grep -q '_NET_WM_STATE_FULLSCREEN'; then
        log "fullscreen guard: window is fullscreen, nothing to do (look ${attempt})"
        exit 0
      fi
      if [[ -z "${SW:-}" || -z "${SH:-}" ]]; then
        log "fullscreen guard: could not read the screen size, leaving the window alone"
        exit 0
      fi
      if [[ "$WIDTH" -ge "$SW" && "$HEIGHT" -ge "$SH" ]]; then
        log "fullscreen guard: window ${WIDTH}x${HEIGHT} already covers the ${SW}x${SH} screen, nothing to do (look ${attempt}$([[ $HAVE_XPROP -eq 0 ]] && echo '; judged by size, xprop not installed'))"
        exit 0
      fi
      xdotool key --window "$W" F11 2>/dev/null
      log "fullscreen guard: window ${WIDTH}x${HEIGHT} on a ${SW}x${SH} screen, not fullscreen - pressed F11 (look ${attempt})"
      sleep "${PI_CALENDAR_GUARD_INTERVAL:-4}"
    done
    log "fullscreen guard: still not fullscreen after three tries - giving up"
  ) >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi

log "launching: $1"
exec "$@"
