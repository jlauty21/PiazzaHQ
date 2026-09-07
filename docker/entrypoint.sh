#!/bin/sh
set -e

# /data may be a bind mount owned by some other host uid. Make sure the
# unprivileged `node` user (uid 1000) can write to it, then drop to it.
# For a named volume this is a cheap no-op (already node-owned from the
# image). If the container is already running unprivileged (USER override),
# just exec straight through.
DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DIR"
  chown node:node "$DIR" 2>/dev/null || true
  # Only recurse if the top-level owner is wrong — avoids a slow chmod of a
  # huge existing dataset on every start.
  if [ "$(stat -c '%u' "$DIR" 2>/dev/null || echo 0)" != "1000" ]; then
    chown -R node:node "$DIR" 2>/dev/null || true
  fi
  exec gosu node "$@"
fi

exec "$@"
