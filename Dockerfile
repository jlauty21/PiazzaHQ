# syntax=docker/dockerfile:1
#
# Piazza HQ — the device app SERVER, containerised.
#
# This image runs server.js only. The wall display is any browser pointed at
# this container's <host>:3000 — a TV, a wall tablet, a mini-PC in kiosk
# mode. See docker/README.md for setup, and the `--network host` note there
# for LAN device discovery / Home Assistant by hostname / Tailscale.
#
# Persistent state (calendar.db, uploaded photos, the session secret, this
# instance's device id) lives in /data via DATA_DIR — mount a volume there
# or it's lost when you pull a new image. PIAZZA_CONTAINER=1 tells server.js
# it's in a container: the in-app self-update is disabled (you update by
# pulling a newer image), while the licence check-in and everything else
# work exactly as on a Pi.

# ── Stage 1: install dependencies ───────────────────────────────────────────
# Separate stage purely so the compiler toolchain below never ends up in the
# final image — better-sqlite3 (native module) ships prebuilt binaries for
# most platforms, but not reliably for every one (arm64/Raspberry Pi in
# particular is hit or miss release to release). Without a compiler here,
# `npm ci` would silently succeed on amd64 (prebuild found) and then fail
# on arm64 (no prebuild, nothing to build it with) — exactly the kind of gap
# that only shows up once someone actually tries this on a Pi. Installing
# python3/make/g++ here means `npm ci` succeeds either way: prebuilt binary
# if one exists, compiled from source in seconds if it doesn't — and none of
# that toolchain is present in the runtime stage below.
FROM node:20-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# package-lock.json's version field is kept in sync with package.json at
# release time so `npm ci` (which requires the two to agree) succeeds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ── Stage 2: the actual runtime image ───────────────────────────────────────
FROM node:20-bookworm-slim

# zip/unzip  — server.js shells out to them on Linux for "Download full
#              backup" and Restore Backup (the Windows build uses bsdtar).
# ca-certificates — outbound HTTPS to calendar feeds, weather, the mothership.
# curl       — the HEALTHCHECK below.
# gosu       — drop from root to the `node` user in the entrypoint, after
#              fixing /data ownership for bind mounts.
RUN apt-get update \
 && apt-get install -y --no-install-recommends zip unzip ca-certificates curl gosu \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PIAZZA_CONTAINER=1 \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app

# node_modules built in stage 1 (with its compiler toolchain); everything
# else copied fresh here (see .dockerignore for what's excluded — windows/,
# docs, the Pi install scripts, etc.).
COPY --from=build /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /data && chown -R node:node /app /data \
 && chmod +x /app/docker/entrypoint.sh

VOLUME ["/data"]
EXPOSE 3000

# /api/settings is public even on a PIN-protected instance, so it's a safe
# liveness probe. start-period covers the first-boot DB migrations.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/settings" >/dev/null || exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
