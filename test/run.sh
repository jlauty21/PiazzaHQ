#!/usr/bin/env bash
# Runs a test layer inside the container from test/docker-compose.yml.
#
#   test/run.sh unit          — pure-function unit tests
#   test/run.sh api           — API / integration tests (Phase 3)
#   test/run.sh ui            — headless UI smoke (Phase 4)
#   test/run.sh unit api      — several layers in one container start
#   test/run.sh all           — every layer (default)
#   test/run.sh shell         — interactive bash in the container
#
# `npm test` calls this; a non-zero exit blocks `publish-beta.sh`.
set -euo pipefail
cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
  echo "" >&2
  echo "Docker isn't running. Start Docker Desktop, then re-run." >&2
  echo "(To publish a beta without tests: publish-beta.sh --force)" >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml)

# --build so a Dockerfile change is always picked up (fast when the layers
# are cached).
if [ "${1:-all}" = "shell" ]; then
  exec "${COMPOSE[@]}" run --rm --build --entrypoint bash tests
fi

LAYERS=("$@")
[ ${#LAYERS[@]} -eq 0 ] && LAYERS=(all)
exec "${COMPOSE[@]}" run --rm --build tests node test/run-tests.js "${LAYERS[@]}"
