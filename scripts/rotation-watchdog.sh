#!/bin/bash
#
# rotation-watchdog.sh
#
# WHY THIS EXISTS:
# labwc (the Wayland compositor Raspberry Pi OS uses) has a known limitation where
# a monitor's screen transform/rotation gets silently reset to "normal" (landscape)
# whenever the monitor's HDMI output disconnects and reconnects — which is exactly
# what most monitors/TVs do internally when their own auto-sleep/power-saving kicks
# in, even with screen blanking disabled on the Pi side. This is a labwc/wlroots
# limitation, not a bug in the calendar app — the app correctly reflects whatever
# orientation the screen reports, but if the OS-level rotation setting gets wiped,
# the screen reports back to landscape and the app (correctly) follows along.
#
# This script periodically reapplies your saved rotation, so even if the monitor's
# sleep cycle resets it, it gets fixed automatically within a few minutes rather
# than staying wrong until the next manual fix or reboot.
#
# SETUP — three things needed:
#
# 1. Edit OUTPUT and ROTATION below to match your actual display.
#    Find your output name by running (over SSH, with the kiosk running):
#      WAYLAND_DISPLAY=wayland-0 wlr-randr
#    It'll be something like "HDMI-A-1". Your rotation is whatever you originally
#    set up — common values: normal, 90, 180, 270 (or left/right/inverted on some
#    labwc versions — run `wlr-randr --help` if `90`/`270` don't take).
#
# 2. Make this script executable:
#      chmod +x ~/piazzahq/scripts/rotation-watchdog.sh
#
# 3. Run it continuously via systemd (recommended) — see rotation-watchdog.service
#    in this same folder for a ready-to-use unit file, or add it to your labwc
#    autostart file (~/.config/labwc/autostart) as a backgrounded loop:
#      @/home/jlauty/piazzahq/scripts/rotation-watchdog.sh &
#
# This is a best-effort fix, not a guarantee — exactly how reliably this works
# depends on your specific monitor's sleep/wake behavior with the HDMI signal.
# Combine with disabling the monitor's own auto-sleep in its on-screen menu
# (the more common culprit) for the most reliable result.

OUTPUT="HDMI-A-1"      # <-- change to your actual output name
ROTATION="normal"      # <-- change to your actual rotation: normal | 90 | 180 | 270
CHECK_INTERVAL_SECONDS=60

# labwc needs to know which Wayland display to talk to when run outside an
# interactive session (e.g. from systemd) — wayland-0 is the default for the
# first/only session, which is the normal case for a single-kiosk-screen Pi.
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

while true; do
  current=$(wlr-randr 2>/dev/null | awk -v out="$OUTPUT" '
    $0 ~ out { found=1 }
    found && /Transform:/ { print $2; exit }
  ')

  if [ "$current" != "$ROTATION" ] && [ -n "$current" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Rotation drifted (was: $current, want: $ROTATION) — reapplying"
    wlr-randr --output "$OUTPUT" --transform "$ROTATION"
  fi

  sleep "$CHECK_INTERVAL_SECONDS"
done
