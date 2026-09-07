# Test runner for the Piazza HQ device app.
#
# Base is Playwright's own image so the headless UI layer (test/ui, Phase 4)
# needs no extra setup — it already carries Chromium/Firefox/WebKit and every
# system lib they need. It also gives the unit + API layers a Linux userland
# matching the Raspberry Pis (dev machine is Windows), so a platform-specific
# bug surfaces here instead of only on a device.
#
# Pin this tag to the @playwright/test version in test/package.json once the
# UI layer exists. jammy = Ubuntu 22.04; this tag currently carries Node 22.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

# better-sqlite3 (a native addon) has no prebuilt binary for the base image's
# Node, so `npm install` compiles it from source — which needs a C toolchain
# the Playwright image doesn't ship. build-essential + python3 cover node-gyp.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Nothing is COPYed in — the repo is bind-mounted at /work by
# docker-compose.yml at run time, so a source edit on the host is picked up
# with no image rebuild. The API/UI layers `npm install --omit=dev` into a
# named node_modules volume on first run (run-tests.js); the unit layer needs
# only Node built-ins.
