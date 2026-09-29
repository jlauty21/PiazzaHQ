#!/usr/bin/env bash
#
# kiosk-diagnose.sh - a READ-ONLY snapshot of how this Pi's display is set up.
#
#   bash ~/piazzahq/scripts/kiosk-diagnose.sh
#
# Run it over SSH and paste the output into a bug report. It changes nothing,
# needs no sudo, and prints no passwords or tokens. It answers the questions
# that decide almost every "white screen / no display after reboot" report:
# what hardware and desktop is this, how does the browser get launched at boot,
# does the launch line point at something that exists, and what did the last
# launch see.

set -uo pipefail
section() { printf '\n== %s ==\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

section "Hardware and OS"
echo "model:    $(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo unknown)"
echo "memory:   $(free -m 2>/dev/null | awk '/Mem:/ {print $2" MB total, "$7" MB available"}'), swap $(free -m 2>/dev/null | awk '/Swap:/ {print $2" MB"}')"
echo "os:       $( (. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}") )   kernel $(uname -r)   $(uname -m)"
echo "uptime:   $(uptime -p 2>/dev/null)"

section "Desktop session"
if pgrep -x -u "$(id -u)" 'labwc|wayfire' >/dev/null 2>&1; then
  stype="Wayland ($(pgrep -x -u "$(id -u)" 'labwc|wayfire' | head -1 | xargs -I{} ps -o comm= -p {}))"
elif pgrep -x Xorg >/dev/null 2>&1 && pgrep -x -u "$(id -u)" 'openbox|lxsession|xfwm4|mutter|marco' >/dev/null 2>&1; then
  stype="X11"
else
  stype="none - no desktop is logged in for this user"
fi
echo "session type:  $stype"
echo "display server / window manager running: $(pgrep -a -u "$(id -u)" -x 'Xorg|Xwayland|labwc|wayfire|openbox|lxsession|xfwm4|mutter' 2>/dev/null | awk '{print $2}' | sort -u | tr '\n' ' ')"
echo "login screen showing (lightdm greeter): $(pgrep -f 'lightdm-gtk-greeter|lightdm-greeter' >/dev/null 2>&1 && echo YES - the desktop is not logged in || echo no)"

section "Browser"
for b in chromium chromium-browser; do have "$b" && { echo "$($b --version 2>/dev/null | head -1)"; break; }; done
n="$(pgrep -fc -- '--kiosk' 2>/dev/null || true)"
echo "kiosk browser processes: ${n:-0}   (0 = not running; a healthy kiosk shows several, that is normal)"
main="$(pgrep -f -- '--kiosk' 2>/dev/null | head -1)"
[[ -n "$main" ]] && echo "main command line: $(tr '\0' ' ' < "/proc/$main/cmdline" 2>/dev/null | cut -c1-400)"
tops="$(ps -eo args 2>/dev/null | grep -E '(^|/)chromium(-browser)?( |$)' | grep -v -- '--type=' | grep -vc grep || true)"
echo "top-level browser processes: ${tops:-0}   (exactly 1 expected; 2 or more means two browsers are fighting for the screen)"

section "How the browser is launched at boot"
found=0
for f in "$HOME"/.config/labwc/autostart "$HOME"/.config/lxsession/*/autostart "$HOME"/.config/wayfire.ini; do
  [[ -f "$f" ]] || continue
  line="$(grep -n -- '--kiosk' "$f" 2>/dev/null | head -3)"
  [[ -z "$line" ]] && continue
  found=1
  echo "$f:"
  echo "$line" | cut -c1-300 | sed 's/^/    /'
  wrapper="$(echo "$line" | grep -oE '/[^[:space:]"]*wait-for-server-and-launch-kiosk\.sh' | head -1)"
  if [[ -n "$wrapper" ]]; then
    [[ -e "$wrapper" ]] && echo "    wrapper path exists: yes" || echo "    wrapper path exists: NO - this boot line points at a missing file, so the kiosk will not start after a reboot"
  else
    echo "    wrapper (waits for the server before launching): not used on this line"
  fi
done
[[ $found -eq 0 ]] && echo "no autostart file contains a kiosk line"
echo "systemd units that launch a browser:"; systemctl list-unit-files --no-legend 2>/dev/null | grep -iE 'kiosk|chromium' | sed 's/^/    /' || true
[[ -f /tmp/piazzahq-kiosk-launch.log ]] && { echo "last launch log (/tmp/piazzahq-kiosk-launch.log):"; tail -8 /tmp/piazzahq-kiosk-launch.log | sed 's/^/    /'; } || echo "launch log: none (the launcher has not run since this boot, or this is an older version)"

section "The 'kiosk' command"
kpath="$(command -v kiosk 2>/dev/null || true)"
if [[ -z "$kpath" ]]; then
  echo "no 'kiosk' command on this Pi's PATH (fine - you can use ~/piazzahq/scripts/kiosk directly)"
else
  mine="$(ls -d "$HOME"/piazzahq/scripts/kiosk 2>/dev/null | head -1)"
  echo "kiosk command: $kpath   ($( [[ -L "$kpath" ]] && echo "link to $(readlink -f "$kpath")" || echo 'a plain copy'))"
  if [[ -n "$mine" && ! -L "$kpath" ]] && ! cmp -s "$kpath" "$mine"; then
    echo "    THIS COPY IS OUT OF DATE - it does not match the one that ships with your version, so fixes to it never reach you."
    echo "    Fix (one time):  sudo ln -sfn $mine $kpath"
  elif [[ -n "$mine" && -L "$kpath" ]]; then
    echo "    up to date (it follows the project's copy)"
  fi
fi

section "The Piazza HQ server"
echo "app: $(curl -fsS --max-time 4 http://localhost:3000/api/version 2>/dev/null || echo 'NOT ANSWERING on localhost:3000')"
echo "service: $(systemctl is-active piazzahq 2>/dev/null)   started: $(systemctl show piazzahq -p ActiveEnterTimestamp --value 2>/dev/null)"

section "The browser window (X11 only)"
if have xdotool && have xprop && [[ -n "${DISPLAY:-}" ]]; then
  echo "screen: $(xdotool getdisplaygeometry 2>/dev/null)"
  for w in $(xdotool search --onlyvisible --class 'chromium|Chromium' 2>/dev/null); do
    g="$(xdotool getwindowgeometry --shell "$w" 2>/dev/null | tr '\n' ' ')"
    fs="$(xprop -id "$w" _NET_WM_STATE 2>/dev/null | grep -q FULLSCREEN && echo fullscreen || echo 'NOT fullscreen')"
    echo "window $w: $g -> $fs"
  done
else
  echo "not checked (needs an X11 desktop session and xdotool + xprop; run this from a terminal on the Pi's own desktop for this part)"
fi

section "Recent browser / graphics errors this boot"
journalctl -b --no-pager 2>/dev/null | grep -viE 'dbus|bus\.cc|object_proxy|google_apis|gcm|containerd' | grep -iE 'chromium.*(fatal|crash|SIGSEGV)|EGL_BAD|GLES.*(fail|error)|gpu.process.*(crash|exit|fail|lost)|vc4.*(error|fail|timeout)|out of memory|Killed process|oom-kill' | tail -8 | cut -c1-220 | sed 's/^/    /'
echo "(end)"
