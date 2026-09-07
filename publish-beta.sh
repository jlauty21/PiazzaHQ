#!/usr/bin/env bash
# Build the current tree into a flat Pi zip, publish it to the mothership's
# BETA channel with the scoped beta-publish key, then push it to every beta
# device and verify each came back up on the new version.
#
# This does NOT bump the version — set package.json to the next x.y.z-beta.N
# first (and windows/build-input/app/package.json + windows/piazzahq.iss to
# match; sync the build mirror). The zip's package.json is the source of
# truth the mothership reads.
#
# Requires (env, e.g. a .env sourced before running; do not commit it):
#   BETA_PUBLISH_KEY   scoped key from the admin panel -> "Beta publish key"
#   MOTHERSHIP_URL     default https://piazzahq.com
#   BETA_HOSTS         space-separated user@host list of the beta devices to
#                      push to, e.g. "jlauty@100.106.21.110 jlauty@100.115.65.87"
#                      (falls back to TESTPI_SSH for a single host)
#   BETA_SSH_KEY       path to the ssh private key (or TESTPI_SSH_KEY)
#   BETA_APP_PORT      default 3000
#
# Each device must have no app PIN set (app_pin ''), so the localhost update
# trigger needs no auth. Devices auto-verify the download against the
# mothership's sha; the auto-rollback guard restores the prior version on a
# failed boot.
#
# Zip step shells out to WSL (matches how betas have been built on Windows);
# on Linux/macOS it uses `zip` directly.

set -euo pipefail
cd "$(dirname "$0")"

MOTHERSHIP_URL="${MOTHERSHIP_URL:-https://piazzahq.com}"
BETA_APP_PORT="${BETA_APP_PORT:-${TESTPI_APP_PORT:-3000}}"
BETA_HOSTS="${BETA_HOSTS:-${TESTPI_SSH:-}}"
BETA_SSH_KEY="${BETA_SSH_KEY:-${TESTPI_SSH_KEY:-}}"
: "${BETA_PUBLISH_KEY:?set BETA_PUBLISH_KEY}"
: "${BETA_HOSTS:?set BETA_HOSTS (space-separated user@host list) or TESTPI_SSH}"
: "${BETA_SSH_KEY:?set BETA_SSH_KEY or TESTPI_SSH_KEY}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

VERSION="$(node -p "require('./package.json').version" 2>/dev/null \
  || "windows/build-input/node/node.exe" -p "require('./package.json').version")"
case "$VERSION" in
  *-beta.*) : ;;
  *) echo "package.json version '$VERSION' is not x.y.z-beta.N — bump it first." >&2; exit 1 ;;
esac
say "Publishing $VERSION"

# 1. mirror + syntax sanity
MIRROR=windows/build-input/app
NODE_BIN="$(command -v node || true)"
[ -z "$NODE_BIN" ] && NODE_BIN="windows/build-input/node/node.exe"
for f in server.js public/app.html public/display.html; do
  if ! diff -q "$f" "$MIRROR/$f" >/dev/null 2>&1; then
    echo "Build mirror out of sync: $f differs from $MIRROR/$f — sync before publishing." >&2
    exit 1
  fi
done
# package.json legitimately differs (the mirror drops the "test" script); only
# the version must match.
MIRROR_VER="$("$NODE_BIN" -p "require('./$MIRROR/package.json').version")"
if [ "$MIRROR_VER" != "$VERSION" ]; then
  echo "Version mismatch: root package.json is $VERSION, $MIRROR/package.json is $MIRROR_VER." >&2
  exit 1
fi
"$NODE_BIN" --check server.js

# 1b. test gate — preflight + the unit & API layers in Docker (see
# TEST-ENV-SPEC.md). ~25s when the image + deps volume are warm. Skip with
# SKIP_TESTS=1 (or start Docker Desktop if it's just not running).
if [ "${SKIP_TESTS:-}" = "1" ]; then
  say "SKIP_TESTS=1 — skipping the test gate"
else
  say "Running tests (SKIP_TESTS=1 to bypass)"
  if ! bash test/run.sh unit api; then
    echo "Tests failed — not publishing. Fix them, or re-run with SKIP_TESTS=1 if you're sure." >&2
    exit 1
  fi
fi

# 2. build the flat zip
STAGE="$(mktemp -d)"
FLAT_FILES=(server.js templates.js tv-control.js package.json README.md \
  BETA_CHECKLIST.md CHANGELOG.md LICENSE install.sh hide-cursor.sh setup-remote-access.sh)
for f in "${FLAT_FILES[@]}"; do [ -e "$f" ] && cp "$f" "$STAGE/$f"; done
cp -r scripts "$STAGE/scripts"
cp -r public "$STAGE/public"
OUT="$PWD/piazzahq-$VERSION.zip"
rm -f "$OUT"
if command -v zip >/dev/null 2>&1; then
  ( cd "$STAGE" && zip -r -q -X "$OUT" . )
elif command -v wsl >/dev/null 2>&1; then
  STAGE_WSL="$(wsl wslpath -a "$STAGE")"
  OUT_WSL="$(wsl wslpath -a "$OUT")"
  MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash -lc "cd '$STAGE_WSL' && rm -f '$OUT_WSL' && zip -r -q -X '$OUT_WSL' ."
else
  echo "No 'zip' and no 'wsl' available to build the archive." >&2; exit 1
fi
rm -rf "$STAGE"
SHA="$("$NODE_BIN" -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$OUT")"
say "Built $(basename "$OUT")  sha256=$SHA"

# 3. release notes = this version's CHANGELOG section
NOTES="$(awk -v v="## $VERSION" '
  $0==v {grab=1; next}
  grab && /^## / {exit}
  grab {print}
' CHANGELOG.md)"
[ -z "$NOTES" ] && NOTES="(no CHANGELOG section for $VERSION)"

# 4. publish to the mothership beta channel
# Windows curl can't open an MSYS-style /c/... path — hand it a native path.
OUT_FORCURL="$OUT"
if command -v cygpath >/dev/null 2>&1; then OUT_FORCURL="$(cygpath -w "$OUT")"; fi
say "POST $MOTHERSHIP_URL/api/beta/publish"
RESP="$(curl -fsS -X POST "$MOTHERSHIP_URL/api/beta/publish" \
  -H "Authorization: Bearer $BETA_PUBLISH_KEY" \
  -F "package=@$OUT_FORCURL;type=application/zip" \
  -F "channel=beta" \
  --form-string "notes=$NOTES")"
echo "$RESP"
R_OK="$("$NODE_BIN" -pe "JSON.parse(process.argv[1]).ok === true" "$RESP" 2>/dev/null || true)"
R_VER="$("$NODE_BIN" -pe "JSON.parse(process.argv[1]).version || ''" "$RESP" 2>/dev/null || true)"
[ "$R_OK" = "true" ]     || { echo "Mothership did not return ok:true." >&2; exit 1; }
[ "$R_VER" = "$VERSION" ] || { echo "Mothership reported version '$R_VER', expected '$VERSION'." >&2; exit 1; }
# NB: the mothership strips CHANGELOG.md/HANDOFF.md and re-zips, so its stored
# sha256 will NOT match the local zip's — the device verifies the download
# against the mothership's own sha on install, which is the check that matters.
say "Published OK ($R_VER)."

# 5+6. push to each beta device and verify it comes back on the new version
SSH_OPTS=(-i "$BETA_SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
FAILED=""
for HOST in $BETA_HOSTS; do
  say "Updating $HOST"
  ssh "${SSH_OPTS[@]}" "$HOST" "curl -fsS -X POST http://localhost:$BETA_APP_PORT/api/update-from-server || true"
  hostok=0
  for i in $(seq 1 40); do
    sleep 3
    CUR="$(ssh "${SSH_OPTS[@]}" "$HOST" "curl -fsS http://localhost:$BETA_APP_PORT/api/version 2>/dev/null" \
          | "$NODE_BIN" -pe "try{JSON.parse(require('fs').readFileSync(0)).version||''}catch(e){''}" 2>/dev/null || true)"
    echo "  [$i] $HOST version=$CUR"
    [ "$CUR" = "$VERSION" ] && { hostok=1; break; }
  done
  if [ "$hostok" = 1 ]; then
    echo "  OK  $HOST -> $VERSION"
  else
    echo "  !!  $HOST did not reach $VERSION within ~2min"
    FAILED="$FAILED $HOST"
    ssh "${SSH_OPTS[@]}" "$HOST" "journalctl -u piazzahq --no-pager -n 40 2>/dev/null | grep -iE 'rolled back|update failed|Piazza HQ|listening' | tail -n 10 || true"
  fi
done

echo
if [ -z "$FAILED" ]; then
  say "DONE — $VERSION published and running on every beta device:"
  for HOST in $BETA_HOSTS; do echo "  $HOST"; done
else
  say "PUBLISHED, but these did not reach $VERSION:$FAILED"
  echo "A device that won't boot auto-rolls-back to the prior version on its own."
fi
echo
echo "Revert handle: admin panel -> Releases -> delete $VERSION (beta channel),"
echo "then re-trigger the affected device(s) or let auto-rollback handle a bad boot."
echo "Local zip kept at: $OUT"
