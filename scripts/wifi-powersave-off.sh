#!/usr/bin/env bash
#
# wifi-powersave-off.sh - turns Wi-Fi power saving off for the Wi-Fi profile this Pi is using (NetworkManager "powersave = disable").
#
# Why: with power saving on, a Pi's Wi-Fi radio can doze - it still looks connected and works outward, but nothing from other devices gets through
# (no control app, no ping, no SSH) until a reboot (feedback #39). The app does the same from its own side (src/wifi-power.js), but there NetworkManager
# often refuses the change (the background service is not in a desktop session) and `sudo` may ask for a password. This script runs from the desktop
# session at boot (started by wait-for-server-and-launch-kiosk.sh), where NetworkManager allows a user to change their own Wi-Fi settings.
#
# Best effort and safe to run repeatedly: changes nothing that is already off, never touches a wired Pi, never fails the caller.
# To keep power saving on instead:  touch ~/.piazzahq-keep-wifi-powersave
set -u
[[ -e "$HOME/.piazzahq-keep-wifi-powersave" ]] && exit 0
command -v nmcli >/dev/null 2>&1 || exit 0

nmcli -t -f NAME,TYPE connection show --active 2>/dev/null | while IFS= read -r line; do
  type="${line##*:}"
  name="${line%:*}"
  name="${name//\:/:}"                      # terse mode escapes ':' inside names
  [[ "$type" == "802-11-wireless" && -n "$name" ]] || continue
  cur="$(nmcli -g 802-11-wireless.powersave connection show "$name" 2>/dev/null)"
  case "$cur" in 2*|disable*) continue ;; esac
  if nmcli connection modify "$name" 802-11-wireless.powersave 2 2>/dev/null \
     || sudo -n nmcli connection modify "$name" 802-11-wireless.powersave 2 2>/dev/null; then
    # Also apply it to the connection that is up right now (no reconnect), so it holds from this boot on, not only after the next one. NetworkManager only
    # allows this from the desktop session, which is where this runs; failure is fine - the profile is saved and takes effect on the next connect.
    dev="$(nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null | awk -F: -v n="$name" '$1==n {print $2; exit}')"
    if [[ -n "$dev" ]] && nmcli device reapply "$dev" >/dev/null 2>&1; then
      echo "$(date '+%F %T') Wi-Fi power saving switched off for profile: $name (applied to the running connection on $dev)"
    else
      echo "$(date '+%F %T') Wi-Fi power saving switched off for profile: $name (takes effect the next time it connects)"
    fi
  else
    echo "$(date '+%F %T') could not switch Wi-Fi power saving off for profile: $name"
  fi
done
exit 0
