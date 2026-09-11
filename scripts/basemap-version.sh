#!/usr/bin/env bash
# Pinned world basemap for the Flight Map widget. Referenced by install.sh and
# the Dockerfile for optional pre-staging; the server (ensureBasemap() in
# server.js) also downloads it on first Flight Map use if it isn't staged, so
# a code-only in-app update self-heals. Keep BASEMAP_* here in step with the
# same consts in server.js on a bump.
#
# It's world-atlas@2's countries-50m.json — Natural Earth 1:50m land + country
# borders, public domain — served from jsDelivr's npm mirror (stable,
# version-pinned). ensureBasemap() accepts it raw OR gzipped and verifies the
# sha256 either way.
#
# To refresh: bump the @N pin, re-download, recompute both sha256s:
#   curl -sL https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json -o m.json
#   sha256sum m.json ; gzip -9 -c m.json | sha256sum

BASEMAP_VERSION="world-atlas@2/countries-50m"
BASEMAP_URL="https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json"
BASEMAP_PATH_NAME="flightmap-basemap.json"   # under the app's DATA_DIR

# sha256 of the file after gunzip (what the server stores), and of a gzip -9
# of it (the alternate form a mirror might serve).
BASEMAP_SHA256_RAW="04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394"
BASEMAP_SHA256_GZ="b0cc4fba25b956b5797bdda6b5276cfa5aac427ba3274e7c3e9eb8a50de4bf0f"
BASEMAP_RAW_BYTES="756420"

# Optional second layer: US state borders (us-atlas@3's states-10m.json —
# public domain, US Census; geographic lon/lat coords). Drawn under the
# country outlines when the Flight Map widget's "state lines" option is on.
STATES_URL="https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"
STATES_SHA256="d76b391ccfa8bff601d51e3e3da5d43a89fa46cd5caca72ce731b383be5596d0"
STATES_BYTES="114554"
