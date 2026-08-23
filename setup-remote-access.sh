#!/usr/bin/env bash
#
# setup-remote-access — add secure remote access to Piazza HQ via Tailscale
# ---------------------------------------------------------------------------
# Lets you reach the control app from anywhere (cellular, work, a friend's
# house) WITHOUT exposing anything to the public internet. Tailscale builds a
# private network that only your own devices can see.
#
# Safe to run during first install OR anytime later. Re-running is harmless.
#
#   bash setup-remote-access.sh           # interactive setup
#   bash setup-remote-access.sh --status  # show current remote-access status
#
# After this finishes on the Pi, install the Tailscale app on your phone/laptop
# (from the normal app store), sign in with the SAME account, and open the app at
# the address this script prints.

set -uo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'; BLU=$'\033[36m'; RST=$'\033[0m'
say()  { echo "${BLU}${BOLD}==>${RST} $*"; }
ok()   { echo "  ${GRN}✓${RST} $*"; }
warn() { echo "  ${YLW}!${RST} $*"; }
err()  { echo "${RED}${BOLD}error:${RST} $*" >&2; }

APP_PORT="${PI_CALENDAR_PORT:-3000}"

# ── Status mode ───────────────────────────────────────────────────────────────
show_status() {
  local lan_ip
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "$lan_ip" ]] && echo "  Local URL:    http://${lan_ip}:${APP_PORT}/app   (same WiFi only)"
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "Remote access: ${YLW}not installed${RST} (Tailscale is not present)."
    return 0
  fi
  if tailscale status >/dev/null 2>&1; then
    local ip host
    ip="$(tailscale ip -4 2>/dev/null | head -n1)"
    host="$(tailscale status --json 2>/dev/null | grep -oE '"DNSName":"[^"]+"' | head -n1 | sed -E 's/.*:"([^".]+)\..*/\1/')"
    echo "Remote access: ${GRN}active${RST}"
    [[ -n "$host" ]] && echo "  Friendly URL: http://${host}:${APP_PORT}/app   (if MagicDNS is on)"
    [[ -n "$ip"   ]] && echo "  IP URL:       http://${ip}:${APP_PORT}/app"
  else
    echo "Remote access: ${YLW}installed but not connected${RST}."
    echo "  Run: ${BOLD}sudo tailscale up${RST}  and follow the login link."
  fi
}

if [[ "${1:-}" == "--status" || "${1:-}" == "status" ]]; then
  show_status
  exit 0
fi

# When called from the installer (which already asked), skip the intro prompt.
ASSUME_YES=0
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && ASSUME_YES=1

# ── Intro ─────────────────────────────────────────────────────────────────────
say "Remote access setup (Tailscale)"
cat <<EOF
  This lets you open the control app from anywhere — not just home WiFi —
  over a private network only your devices can join. Nothing is exposed to
  the public internet.

  What to expect:
    1. This installs Tailscale on the Pi (automatic).
    2. It prints a login link. You open it once in any browser and sign in
       (Google / Microsoft / GitHub / email — no new password to create).
    3. On your phone/laptop, install the Tailscale app and sign in with the
       SAME account. After that, the app just works from anywhere.

EOF

if [[ $ASSUME_YES -eq 0 ]]; then
  read -r -p "  Set up remote access now? [y/N] " ans </dev/tty || ans="n"
  if [[ "${ans,,}" != "y" ]]; then
    echo "  Skipped. You can run this later with:  bash setup-remote-access.sh"
    exit 0
  fi
fi
echo

# ── 1. Install Tailscale (idempotent) ─────────────────────────────────────────
if command -v tailscale >/dev/null 2>&1; then
  ok "Tailscale already installed ($(tailscale version 2>/dev/null | head -n1))"
else
  say "Installing Tailscale (official one-line installer)…"
  # Tailscale's installer detects the distro/arch and sets up the service.
  if curl -fsSL https://tailscale.com/install.sh | sh; then
    ok "Tailscale installed"
  else
    err "Tailscale install failed. Check your internet connection and try again."
    exit 1
  fi
fi
echo

# ── 2. Bring it up (this is the one manual login moment) ──────────────────────
if tailscale status >/dev/null 2>&1; then
  ok "This Pi is already connected to a Tailscale network."
else
  say "Connecting this Pi to your Tailscale network"
  echo "  ${DIM}A login URL will appear below. Open it in any browser, sign in,"
  echo "  and authorize this Pi. Come back here when it says it's connected.${RST}"
  echo
  # --hostname gives the Pi a clean name for MagicDNS URLs.
  # --accept-dns=false avoids overriding the Pi's DNS (safer for a kiosk box).
  sudo tailscale up --hostname=picalendar --accept-dns=false || {
    err "tailscale up did not complete. You can retry with: sudo tailscale up"
    exit 1
  }
  ok "Connected"
fi
echo

# ── 3. Report the address(es) to use ──────────────────────────────────────────
say "Your remote access addresses"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  ${BOLD}Local (same WiFi):${RST}       http://${LAN_IP:-<this-pi-ip>}:${APP_PORT}/app"

# tailscale up can return before the IP is fully assigned/propagated — poll
# briefly rather than checking once immediately, which is what previously made
# a genuinely-successful connection look like it "only gave a local IP": the
# check ran a beat too early, came back empty, and (in the old install.sh logic
# this delegates from) just silently skipped the line instead of retrying or
# saying why.
TS_IP=""
for _ in 1 2 3 4 5; do
  TS_IP="$(tailscale ip -4 2>/dev/null | head -n1)"
  [[ -n "$TS_IP" ]] && break
  sleep 1
done
TS_HOST="$(tailscale status --json 2>/dev/null | grep -oE '"DNSName":"[^"]+"' | head -n1 | sed -E 's/.*:"([^".]+)\..*/\1/')"

if [[ -n "$TS_IP" ]]; then
  if [[ -n "$TS_HOST" ]]; then
    echo "  ${BOLD}Friendly (recommended):${RST}  http://${TS_HOST}:${APP_PORT}/app"
    echo "  ${DIM}(works once MagicDNS is enabled — see the tip below)${RST}"
  fi
  echo "  ${BOLD}Remote (Tailscale):${RST}      http://${TS_IP}:${APP_PORT}/app   ${DIM}(from anywhere)${RST}"
else
  warn "Tailscale reports connected, but hasn't handed out an IP yet."
  warn "This is usually just propagation delay — check again in a few seconds with:"
  warn "  tailscale ip -4"
  warn "If that stays empty for more than a minute, run: sudo tailscale up"
fi
echo
cat <<EOF
  ${BOLD}Next steps for each person who needs access:${RST}
    • Install the "Tailscale" app (Apple App Store / Google Play / desktop).
    • Sign in with the SAME account used above.
    • Open the address shown above. Add it to the home screen for an app-like icon.

  ${BOLD}Tip — friendlier URLs (one-time, optional):${RST}
    Turn on MagicDNS in the Tailscale admin console (login.tailscale.com →
    DNS → enable MagicDNS). Then the "http://picalendar:${APP_PORT}/app" address
    works for everyone, no IP needed.

  ${BOLD}To check status anytime:${RST}  bash setup-remote-access.sh --status
EOF
echo
ok "Remote access is set up."
