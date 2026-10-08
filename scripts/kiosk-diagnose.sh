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
# launch see. It also checks whether the web interface answers on this Pi's network address, how many
# connections the server has open, and the Wi-Fi state - for "stops loading from other devices" reports.

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
# What the display tab actually holds, asked through the browser's local debug port. "blank ... about:blank" = the tab
# never loaded the page (the white-screen-at-boot case); "page ... [Piazza HQ Display]" = it loaded.
DTOOL="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)/kiosk-devtools.js"
if command -v node >/dev/null 2>&1 && [ -f "$DTOOL" ]; then
  echo "display tab: $(node "$DTOOL" status 2>&1 | head -1)"
else
  echo "display tab: (not checked - needs node and scripts/kiosk-devtools.js)"
fi
MEMAV="$(free -m 2>/dev/null | awk '/^Mem/{print $7}')"; [ -n "$MEMAV" ] && echo "memory available: ${MEMAV} MB   (recent out-of-memory kills: $(dmesg 2>/dev/null | grep -ci -E 'out of memory|killed process'))"

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
[[ -f /tmp/piazzahq-kiosk-launch.log ]] && { echo "this boot's launch log (/tmp/piazzahq-kiosk-launch.log):"; tail -16 /tmp/piazzahq-kiosk-launch.log | sed 's/^/    /'; } || echo "launch log: none (the launcher has not run since this boot, or this is an older version)"
# The same events for the last several boots (survives reboots; each line is tagged [boot id]).
HISTF="${PI_CALENDAR_KIOSK_HISTORY:-${XDG_STATE_HOME:-$HOME/.local/state}/piazzahq/kiosk-launch-history.log}"
if [[ -f "$HISTF" ]]; then
  echo "earlier boots (from $HISTF, newest last):"
  tail -40 "$HISTF" | sed 's/^/    /'
fi

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
# "The web interface stops loading from other devices until I reboot" while the Pi's own screen keeps working: the screen
# talks to localhost, other devices come in over the network, so the two checks below separate "the server is stuck" from
# "the network path to this Pi is broken". Run this WHILE the problem is happening, before rebooting.
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "$LAN_IP" ]] && echo "app via this Pi's own network address ($LAN_IP:3000): $(curl -fsS --max-time 5 "http://$LAN_IP:3000/api/version" 2>/dev/null || echo 'NOT ANSWERING')"
echo "listening on port 3000: $(ss -ltn 2>/dev/null | awk '$4 ~ /:3000$/ {print $4}' | sort -u | tr '\n' ' ')"
MPID="$(systemctl show piazzahq -p MainPID --value 2>/dev/null)"
if [[ -n "$MPID" && "$MPID" != 0 && -d "/proc/$MPID/fd" ]]; then
  echo "server open files: $(ls "/proc/$MPID/fd" 2>/dev/null | wc -l) of $(awk '/Max open files/ {print $4}' "/proc/$MPID/limits" 2>/dev/null) allowed   (close to the limit = the server can no longer accept new connections)"
fi
echo "connections on port 3000 by state: $(ss -tan 2>/dev/null | awk '$4 ~ /:3000$/ {c[$1]++} END {for (s in c) printf "%s=%d ", s, c[s]}')"

section "Network"
for ifc in $(ls /sys/class/net 2>/dev/null | grep -E '^(wlan|eth|en)'); do
  echo "$ifc: $(cat "/sys/class/net/$ifc/operstate" 2>/dev/null)   $(ip -4 -o addr show "$ifc" 2>/dev/null | awk '{print $4}' | head -1)"
done
# Wi-Fi: signal from /proc/net/wireless and power saving from NetworkManager - neither needs an extra package
# (`iw` is not installed on Raspberry Pi OS by default; it is used too when it happens to be there).
for w in $(ls /sys/class/net 2>/dev/null | grep '^wlan'); do
  q="$(awk -v i="$w:" '$1==i {print "link quality " $3 "  signal " $4 " dBm  retries " $9}' /proc/net/wireless 2>/dev/null)"
  ps=""
  have iw && ps="$(iw dev "$w" get power_save 2>/dev/null | sed 's/^Power save: //')"
  if [[ -z "$ps" ]] && have nmcli; then
    con="$(nmcli -t -f NAME,TYPE connection show --active 2>/dev/null | awk -F: '$2 ~ /wireless/ {print $1; exit}')"
    [[ -n "$con" ]] && ps="NetworkManager setting '$(nmcli -g 802-11-wireless.powersave connection show "$con" 2>/dev/null)' (default = the driver's choice, which for the Pi's built-in Wi-Fi is ON)"
  fi
  echo "$w: ${q:-no signal info}   power saving: ${ps:-unknown}"
done
gw="$(ip route show default 2>/dev/null | awk '{print $3; exit}')"
[[ -n "$gw" ]] && echo "can reach the router ($gw): $(ping -c1 -W2 "$gw" >/dev/null 2>&1 && echo yes || echo NO)"
echo "recent network messages from the kernel:"
dmesg 2>/dev/null | grep -iE 'power save|brcmfmac.*(error|fail|timeout|reset|crash)|link is (up|down)|NETDEV WATCHDOG|wlan0: (deauth|disassoc)' | tail -6 | cut -c1-200 | sed 's/^/    /'

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
