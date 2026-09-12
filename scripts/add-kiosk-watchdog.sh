#!/usr/bin/env bash
#
# add-kiosk-watchdog.sh — one-time retrofit for a Pi that was set up by an
# OLDER install.sh, before the kiosk watchdog existed (see
# ~/.claude/plans/patient-lantern-watch.md and the "8c. Kiosk watchdog"
# step in install.sh, which every FUTURE install/re-run already gets for
# free). Run this once, over SSH, on each existing Pi:
#
#   bash scripts/add-kiosk-watchdog.sh
#
# What it does (all idempotent — safe to re-run):
#   1. (Re)installs /usr/local/bin/kiosk from this checkout (picks up the
#      off/on sentinel + DISPLAY/XAUTHORITY auto-discovery + the new
#      --remote-debugging-port flag).
#   2. Patches the EXISTING kiosk autostart line (lxsession/labwc/wayfire —
#      whichever this Pi actually uses) to add the same debugging-port
#      flags, so a plain reboot (not just `kiosk restart`) also gets a
#      watchdog-visible kiosk. Does nothing if the line already has them.
#   3. Installs + enables the piazzahq-kiosk-watchdog systemd timer.
#   4. Restarts the kiosk now, so tonight's display picks up the new flags
#      immediately instead of waiting for the next reboot.
#
# Needs sudo — run it as the Pi's normal user (same as install.sh), NOT root.

set -uo pipefail

BOLD=$'\033[1m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
say()  { echo "${BOLD}==>${RST} $*"; }
ok()   { echo "  ${GRN}✓${RST} $*"; }
warn() { echo "  ${YLW}!${RST} $*"; }

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root/sudo — it calls sudo itself where needed." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$SCRIPT_DIR/server.js" ]]; then
  echo "Couldn't find the project root (no server.js next to scripts/). Run this from inside the piazzahq folder." >&2
  exit 1
fi
RUN_USER="$(id -un)"
RUN_HOME="$HOME"
KIOSK_DEBUG_PORT="${PIAZZA_KIOSK_DEBUG_PORT:-9222}"
DEBUG_FLAGS="--remote-debugging-port=${KIOSK_DEBUG_PORT} --remote-allow-origins=http://127.0.0.1:${KIOSK_DEBUG_PORT}"

say "Installing the updated kiosk control command"
sudo install -m 0755 "$SCRIPT_DIR/scripts/kiosk" /usr/local/bin/kiosk
ok "/usr/local/bin/kiosk updated (sentinel + DISPLAY auto-discovery + debug port)"

say "Patching the kiosk autostart line (so a plain reboot also gets the debug port)"
patched_any=0
for f in \
  "$RUN_HOME"/.config/lxsession/*/autostart \
  "$RUN_HOME"/.config/labwc/autostart
do
  [[ -f "$f" ]] || continue
  if grep -q -- '--kiosk' "$f" 2>/dev/null; then
    if grep -q -- '--remote-debugging-port' "$f" 2>/dev/null; then
      echo "  ${DIM}• $f already has it${RST}"
    else
      # Insert the flags right after "--kiosk" on the same line, wherever it
      # is. Delimiter is "|", not "/" — DEBUG_FLAGS contains "http://..." and
      # a "/"-delimited s/// would otherwise fail on its own replacement text.
      sed -i 's|--kiosk|--kiosk '"$DEBUG_FLAGS"'|' "$f"
      ok "Patched $f"
      patched_any=1
    fi
  fi
done
WAYFIRE_INI="$RUN_HOME/.config/wayfire.ini"
if [[ -f "$WAYFIRE_INI" ]] && grep -q -- '--kiosk' "$WAYFIRE_INI" 2>/dev/null; then
  if grep -q -- '--remote-debugging-port' "$WAYFIRE_INI" 2>/dev/null; then
    echo "  ${DIM}• $WAYFIRE_INI already has it${RST}"
  else
    warn "wayfire.ini has a kiosk line but this script won't edit it automatically (its format varies more)."
    warn "Add manually, right after --kiosk: $DEBUG_FLAGS"
  fi
fi
if [[ $patched_any -eq 0 ]]; then
  warn "No unpatched autostart file found — either already done, or this Pi's autostart lives somewhere this script doesn't check."
fi

say "Installing the kiosk watchdog (systemd timer, checks every ~3 min)"
NODE_BIN="$(command -v node)"
WATCHDOG_SERVICE_PATH="/etc/systemd/system/piazzahq-kiosk-watchdog.service"
WATCHDOG_TIMER_PATH="/etc/systemd/system/piazzahq-kiosk-watchdog.timer"
cat <<EOF | sudo tee "$WATCHDOG_SERVICE_PATH" >/dev/null
[Unit]
Description=Piazza HQ kiosk watchdog (one-shot check + recover)
After=piazzahq.service

[Service]
Type=oneshot
User=${RUN_USER}
Environment=PI_CALENDAR_URL=http://localhost:3000
Environment=PIAZZA_KIOSK_DEBUG_PORT=${KIOSK_DEBUG_PORT}
ExecStart=${NODE_BIN} ${SCRIPT_DIR}/scripts/kiosk-watchdog.js
EOF
cat <<EOF | sudo tee "$WATCHDOG_TIMER_PATH" >/dev/null
[Unit]
Description=Run the Piazza HQ kiosk watchdog every 3 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=3min
Unit=piazzahq-kiosk-watchdog.service

[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now piazzahq-kiosk-watchdog.timer >/dev/null 2>&1
ok "Watchdog installed and running"

say "Restarting the kiosk now to pick up the new flags"
kiosk restart
echo
echo "Done. This display now self-heals a frozen kiosk within ~3 minutes, and"
echo "you'll get a notification (Settings → Notification delivery) either way."
