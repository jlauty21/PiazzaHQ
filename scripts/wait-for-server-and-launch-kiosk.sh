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
# Also keep a history that SURVIVES reboots (the log above lives in /tmp and is wiped each boot): one line per event,
# tagged with the first 8 characters of the kernel's boot id so boots can be told apart, capped at ~400 lines. This is
# what makes "it happened on some boot last week" answerable.
HIST="${PI_CALENDAR_KIOSK_HISTORY:-${XDG_STATE_HOME:-$HOME/.local/state}/piazzahq/kiosk-launch-history.log}"
BOOTID="$(cut -c1-8 /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)"
log() {
  printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null || true
  { mkdir -p "$(dirname "$HIST")" && printf '%s [%s] %s\n' "$(date '+%F %T')" "$BOOTID" "$*" >>"$HIST"; } 2>/dev/null || true
}
# Trim once per launch: keep the newest 300 lines once it passes 400.
{ [ "$(wc -l <"$HIST" 2>/dev/null || echo 0)" -gt 400 ] && tail -n 300 "$HIST" >"$HIST.tmp" && mv "$HIST.tmp" "$HIST"; } 2>/dev/null || true
POLL="${PI_CALENDAR_POLL_INTERVAL:-1}"
# Seconds since boot, for measuring how long something has taken. NOT the wall clock: a Pi has no battery-backed
# clock, so the date can jump by minutes or hours the moment the network gives it the real time - which made
# "120 seconds since launch" true a minute after boot (seen on a real Pi: "2409s after launch" at +1 min). The
# uptime counter never steps. Falls back to the wall clock only where /proc/uptime does not exist.
now_secs() {
  local up
  if read -r up _ <"${PI_CALENDAR_UPTIME_FILE:-/proc/uptime}" 2>/dev/null && [[ -n "$up" ]]; then echo "${up%%.*}"; else date +%s; fi
}
log "kiosk launcher started; server answered after ${waited}s (cap ${MAX_WAIT_SECS}s)"
log "session: type=${XDG_SESSION_TYPE:-?} DISPLAY=${DISPLAY:-unset} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset} chromium-package=$( (dpkg-query -W -f='${Version}' chromium 2>/dev/null || dpkg-query -W -f='${Version}' chromium-browser 2>/dev/null) | cut -c1-24)"

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
  LAUNCH_EPOCH="$(now_secs)"
  ( sleep "${PI_CALENDAR_GUARD_FIRST_DELAY:-5}"
    export DISPLAY="${DISPLAY:-${XDOTOOL_DISPLAY:-:0}}"
    WINDOW_WAIT="${PI_CALENDAR_GUARD_WINDOW_WAIT:-120}"
    elapsed() { echo $(( $(now_secs) - LAUNCH_EPOCH )); }

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
        if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
          log "fullscreen guard: no X11 browser window to check (a native Wayland browser can't be checked from here - that is normal, not a problem)"
        else
          log "fullscreen guard: no browser window appeared within ${WINDOW_WAIT}s of launch"
        fi
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

# Paint watchdog. The steps above make sure the browser window exists and is fullscreen, but a window can be
# perfectly sized and still show nothing: the page never loaded, or never got a frame onto the screen. That is
# the "stays white at boot, fine after a reload" report. The display page tells this device's server once it has
# really drawn a frame (POST /api/display/painted, see display.html); this checks that the count moved after
# launch. If it has not after PI_CALENDAR_PAINT_FIRST seconds (default 210: a healthy Pi 3B+ takes ~105s to draw, a Pi 3B more), it
# reloads the page (F5), up to PI_CALENDAR_PAINT_ATTEMPTS times, PI_CALENDAR_PAINT_STEP seconds apart. If a
# window can't be reached to press F5 (native Wayland browser, xdotool missing), it restarts the browser once
# per boot instead. Every step goes to the launch log, including "the page drew N seconds after launch" on a
# healthy boot. Does nothing if the server has no display-state endpoint. Off with PI_CALENDAR_PAINT_WATCHDOG=0.
#
# The cause found on real hardware (Chromium 154 on a Pi 3B+): on a busy boot a browser helper process is too slow
# to start, the browser restarts its network helper, and the FIRST page load - already in flight - is lost. The tab
# is then left on an empty about:blank for good. So before the slower checks above, this looks through the browser's
# local debug port (scripts/kiosk-devtools.js) at what the tab actually holds, and if it is still empty
# PI_CALENDAR_BLANK_AFTER seconds (default 45) after launch it tells the browser to load the page. That needs no
# window and works on Wayland, where keyboard tools can't reach the browser. The launcher adds the debug port
# (loopback only) to the browser command if the autostart line predates it.
if [[ "${PI_CALENDAR_PAINT_WATCHDOG:-1}" != "0" ]] && command -v curl >/dev/null 2>&1; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  NODE_BIN="$(command -v node || true)"
  DISPLAY_URL=""; for a in "$@"; do case "$a" in http://*|https://*) DISPLAY_URL="$a" ;; esac; done
  DISPLAY_URL="${DISPLAY_URL:-${URL%%\?*}?nopreview}"
  devtools() { [[ -n "$NODE_BIN" && -f "$SCRIPT_DIR/kiosk-devtools.js" ]] || return 9; PI_CALENDAR_DISPLAY_URL="$DISPLAY_URL" "$NODE_BIN" "$SCRIPT_DIR/kiosk-devtools.js" "$@" 2>/dev/null; }
  BASE_URL="${URL%%\?*}"; BASE_URL="${BASE_URL%/}"
  STATE_URL="${PI_CALENDAR_STATE_URL:-$BASE_URL/api/display/state}"
  state_json() { curl -fsS --max-time 3 "$STATE_URL" 2>/dev/null; }
  field() { printf '%s' "$1" | grep -o "\"$2\":[^,}]*" | head -1 | cut -d: -f2- | tr -d '" '; }
  S0="$(state_json || true)"
  B0_ID="$(field "$S0" boot_id)"; B0_N="$(field "$S0" painted_count)"; B0_N="${B0_N:-0}"
  if [[ -z "$B0_ID" ]]; then
    log "paint watchdog: this server does not report display state - not watching"
  else
    ( PAINT_T0="$(now_secs)"
      PAINT_FIRST="${PI_CALENDAR_PAINT_FIRST:-210}"
      PAINT_STEP="${PI_CALENDAR_PAINT_STEP:-90}"
      PAINT_ATTEMPTS="${PI_CALENDAR_PAINT_ATTEMPTS:-2}"
      PAINT_POLL="${PI_CALENDAR_PAINT_POLL:-3}"
      RESTART_FLAG="${PI_CALENDAR_PAINT_FLAG:-/tmp/piazzahq-paint-restart}"
      paint_elapsed() { echo $(( $(now_secs) - PAINT_T0 )); }
      painted_since_launch() {
        local j id n
        j="$(state_json)" || return 2
        id="$(field "$j" boot_id)"; n="$(field "$j" painted_count)"
        [[ -z "$id" ]] && return 2
        n="${n:-0}"
        # A restarted server has a new boot_id and a fresh count: any paint at all is a paint since launch.
        [[ "$id" != "$B0_ID" ]] && { [[ "$n" -gt 0 ]]; return; }
        [[ "$n" -gt "$B0_N" ]]
      }
      wait_for_paint() {   # $1 = seconds to wait
        local stop=$(( $(paint_elapsed) + $1 ))
        while [[ $(paint_elapsed) -lt $stop ]]; do
          painted_since_launch && return 0
          sleep "$PAINT_POLL"
        done
        painted_since_launch
      }
      first_browser_window() {
        local w g WIDTH HEIGHT
        for w in $(xdotool search --onlyvisible --class 'chromium|Chromium' 2>/dev/null); do
          WIDTH=0; HEIGHT=0
          g="$(xdotool getwindowgeometry --shell "$w" 2>/dev/null)" || continue
          eval "$g"
          if [[ "${WIDTH:-0}" -ge 200 && "${HEIGHT:-0}" -ge 200 ]]; then echo "$w"; return 0; fi
        done
        return 1
      }
      reload_page() {
        export DISPLAY="${DISPLAY:-${XDOTOOL_DISPLAY:-:0}}"
        local w=""
        if devtools navigate "$DISPLAY_URL" >/dev/null; then
          log "display: told the browser to load the page again (through its debug port)"
          return 0
        fi
        if command -v xdotool >/dev/null 2>&1; then
          w="$(first_browser_window)" || w=""
          if [[ -n "$w" ]]; then
            xdotool windowfocus "$w" >/dev/null 2>&1
            sleep "${PI_CALENDAR_PAINT_FOCUS_WAIT:-0.3}"
            if xdotool key --clearmodifiers F5 >/dev/null 2>&1; then
              log "display: pressed F5 in the browser window"
              return 0
            fi
          fi
        fi
        if [[ ! -e "$RESTART_FLAG" ]]; then
          : >"$RESTART_FLAG" 2>/dev/null
          log "display: could not press F5 (no browser window reachable) - restarting the browser once"
          # Run the restart in its OWN session, never as a child of this watchdog. The watchdog is a descendant of the
          # browser (this script turns into the browser with exec), and `kiosk restart` refuses to kill its own ancestors:
          # run from here it spared the main browser process, tore down its helpers, and left a dead browser that was
          # never relaunched (seen on a real Pi after a restart on Wayland: no browser left running).
          # A new session is NOT enough: `kiosk` decides who to spare by walking parent processes, and a child of this
          # watchdog still has the browser as an ancestor. The extra ( ... & ) makes a helper that exits at once, so the
          # restart is orphaned and its parent is the system, not the browser.
          if command -v setsid >/dev/null 2>&1; then
            ( setsid "$SCRIPT_DIR/kiosk" restart >/dev/null 2>&1 </dev/null & )
          else
            ( nohup "$SCRIPT_DIR/kiosk" restart >/dev/null 2>&1 </dev/null & )
          fi
          return 0
        fi
        log "display: cannot reload the page from here (already restarted the browser once this boot)"
        return 1
      }

      BLANK_AFTER="${PI_CALENDAR_BLANK_AFTER:-45}"; BLANK_STEP="${PI_CALENDAR_BLANK_STEP:-30}"; BLANK_TRIES="${PI_CALENDAR_BLANK_TRIES:-3}"
      blank_tries=0; next_blank_check="$BLANK_AFTER"
      first_phase() {
        local st
        while [[ $(paint_elapsed) -lt $PAINT_FIRST ]]; do
          painted_since_launch && return 0
          if [[ $blank_tries -lt $BLANK_TRIES && $(paint_elapsed) -ge $next_blank_check ]]; then
            next_blank_check=$(( $(paint_elapsed) + BLANK_STEP ))
            st="$(devtools status)" || st=""
            case "$st" in
              blank*)
                blank_tries=$((blank_tries + 1))
                log "display: the browser tab is still empty $(paint_elapsed)s after launch (the page load was lost while the Pi was busy starting) - loading it now (try ${blank_tries} of ${BLANK_TRIES})"
                devtools navigate "$DISPLAY_URL" >/dev/null ;;
            esac
          fi
          sleep "$PAINT_POLL"
        done
        painted_since_launch
      }
      if first_phase; then
        log "display: page drew $(paint_elapsed)s after launch"
        exit 0
      fi
      for attempt in $(seq 1 "$PAINT_ATTEMPTS"); do
        log "display: page has not reported drawing $(paint_elapsed)s after launch - reloading it (attempt ${attempt} of ${PAINT_ATTEMPTS})"
        reload_page || break
        if wait_for_paint "$PAINT_STEP"; then
          log "display: page drew $(paint_elapsed)s after launch, after reload attempt ${attempt}"
          exit 0
        fi
      done
      log "display: page still has not reported drawing - leaving it alone (run scripts/kiosk-diagnose.sh and send the output)"
    ) >/dev/null 2>&1 &
    disown 2>/dev/null || true
  fi
fi

# Give the browser its local debug port if the command (an older autostart line) does not have one. Loopback only.
case "${1##*/}" in
  chromium*|chrome*|google-chrome*)
    if [[ " $* " != *" --remote-debugging-port"* ]]; then set -- "$@" "--remote-debugging-port=${PI_CALENDAR_DEBUG_PORT:-9222}"; fi ;;
esac
# Only a Wayland display and no X display (no Xwayland): newer Chromium defaults to X11 and refuses to start.
case "${1##*/}" in
  chromium*|chrome*|google-chrome*)
    if [[ -n "${WAYLAND_DISPLAY:-}" && -z "${DISPLAY:-}" && " $* " != *" --ozone-platform"* ]]; then set -- "$@" "--ozone-platform=wayland"; fi ;;
esac
# Wayland desktop that ALSO has Xwayland (labwc does): run the browser through Xwayland, as these Pis behaved before newer
# Chromium started defaulting to native Wayland. Everything here - hiding the mouse pointer (the page's cursor:none only
# takes effect after a real pointer movement that a wall display never gets, and the pointer hiders/nudges only reach X
# clients), the fullscreen guard and the F5 reload - works on an X client and cannot reach a native Wayland window.
# Opt out with PI_CALENDAR_NATIVE_WAYLAND=1 (or by passing your own --ozone-platform).
case "${1##*/}" in
  chromium*|chrome*|google-chrome*)
    if [[ -n "${WAYLAND_DISPLAY:-}" && -n "${DISPLAY:-}" && "${PI_CALENDAR_NATIVE_WAYLAND:-0}" != "1" && " $* " != *" --ozone-platform"* ]]; then set -- "$@" "--ozone-platform=x11"; fi ;;
esac

log "launching: $1"
exec "$@"
