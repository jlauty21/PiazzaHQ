# Spec: a test environment for pre-ship verification

Status: **being built.**
- **Phase 1 (harness + Docker scaffolding): done.** `test/lib/{extract,tap,sandbox}.js`,
  `test/Dockerfile` + `docker-compose.yml` + `run.sh` + `run-tests.js`,
  `rotation-smoke-test.js` ported. Verified: same results on the host
  (`npm run test:local`) and in the container.
- **Phase 2 (unit layer): done.** 9 files under `test/unit/` — `parseICS`,
  `buildEventICS` + ICS helpers, the HA action guards, `predictHaState`,
  `demoCleanText`, `isBetaVersion`, `applyAlertBannerConfig`,
  `eventDetailKey`, + an extract-lib self-test. All green in the container.
- **Phase 3 (API layer): done.** `test/lib/{boot-server,fake-ha}.js`,
  `test/api/{crud,migrations,ha-alert-lifecycle}.test.js` — 20 assertions,
  green in the container. Wrinkle: the Playwright base image carries Node 22
  with no `better-sqlite3` prebuilt and no C toolchain — Dockerfile installs
  `build-essential` so the first `npm install --omit=dev` (into the named
  node_modules volume) compiles it (~3 min once).
- **Phase 4 (UI smoke): done.** `test/package.json` pins `@playwright/test`
  to the Dockerfile's image tag; `test/ui/playwright.config.js`,
  `test/ui/lib.js` (static-server fixture + CSS/JS extraction helpers),
  `test/ui/alert-banner.spec.js` (7 tests — banner CSS+JS mounted in a real
  browser: position/size/style computed styles, `center` scrim, the ✕
  dismiss path, multi-alert stacking), `test/ui/page-smoke.spec.js` (2 —
  display.html + app.html load with mocked APIs; core top-level globals
  must define — catches "threw on load"). `run-tests.js` runs the `ui`
  layer via Playwright's own runner.

**Full suite green in the container: 15 groups, ~22s warm.**
`npm test` (unit + api, ~25s, no browser) gates `publish-beta.sh`;
`npm run test:all` adds the UI layer; `npm run test:local` runs the unit
layer on the host with no Docker.

Decisions resolved: **#1** block the publish (yes — wired into
`publish-beta.sh`, `SKIP_TESTS=1` to bypass), **#2** build the UI layer now,
**#3** synthetic seed + a legacy-schema DB built in the migration test,
**#4** child-process boot (no `server.js` change), **#5** `npm install
--omit=dev` into the volume + `build-essential` (no prebuilt-binary hunt).

## What Jon asked for

> "Let's spec out this test environment for you."

Context: today every change — even a one-line guard — goes out as a beta to
the three real Pis (87 / 110 / 109) and is verified there over SSH with
`curl`. That works, but it's slow, it burns real hardware and a publish
cycle per iteration, and **nothing runs before the zip is built**. The
`preflight.js` script (syntax + version + mirror sync) and
`test/rotation-smoke-test.js` (one extracted-function regression) are the
only automated gates that exist.

Goal: layers that catch a bug **on the dev machine, before a beta ships**,
without pretending to replace Jon's hardware pass.

## The layers

| # | Layer | Runs | Gates a beta? | What it's for |
|---|---|---|---|---|
| 0 | **Preflight** (`preflight.js`) | dev, <1s, on the host | yes (already) | version sites agree, build mirror in sync, `node --check` |
| 1 | **Pure-function units** | Docker (Linux), ~seconds | yes | the isolatable logic in `server.js` / `display.html` / `app.html` |
| 2 | **API / integration** | Docker (Linux), ~10–20s | yes | real `server.js` against a throwaway DB + a fake Home Assistant |
| 3 | **Headless UI smoke** | Docker (Linux + Playwright), ~30–60s | no (on-demand) | rendering + interaction the units can't reach |
| 4 | **Real hardware** (BETA_CHECKLIST) | the 3 Pis | — | anything visual, touch/stylus, a real HA device, a real phone |

Layer 0 runs on the Windows host (it's just `node --check` + file compares).
Layers 1–3 run **inside one Docker container** (see §4) — Linux, matching
the Pis, so a platform-specific bug (`zip` vs `tar.exe`, path handling)
surfaces locally instead of only on a device.

Layers 0–2 become `npm test` and run automatically inside `publish-beta.sh`
**before** the upload — a failure blocks the publish. Layer 3 is
`npm run test:ui`, run when a change touches rendering. Layer 4 is
unchanged and stays Jon's.

## 1. Pure-function unit tests — `test/unit/`

Generalise what `rotation-smoke-test.js` already does: pull the **real,
current** source of a function straight out of its file by brace-matching
(never a hand-copied snapshot — it must break loudly if renamed), run it in
a `vm` sandbox with the minimum globals stubbed, assert against the exact
scenarios that motivated each guard.

**Shared harness** — `test/lib/`:
- `extract.js` — `extractFunction(fileText, signature)` (today's
  `extractFunctionSource`, moved here) plus `extractConst(fileText, name)`
  for the lookup tables (`HA_ACTIONS`, `DOMAIN_LOCKED_ACTIONS`,
  `HA_READ_ONLY_DOMAINS`, `BANNER_STYLES`, …).
- `tap.js` — ~30 lines: `test(name, fn)`, `eq`, `throws`, a runner that
  exits non-zero on any failure. No dependency.

**First targets** (highest risk / most pure):

| Function | File | Why |
|---|---|---|
| `parseICS` + `parseICSDate` | server.js | feed ingestion; the dedup regex; all-day vs timed vs multi-day date math; the `piazzahq-local-*` UID skip |
| `buildEventICS` + `escapeICSText` + `foldICSLine` | server.js | round-trip: build → `parseICS` → must come back equal AND be excluded by the dedup filter |
| HA action guards | server.js | `DOMAIN_LOCKED_ACTIONS` + `HA_READ_ONLY_DOMAINS` + `HA_UNTARGETED_ACTIONS` — the 400 matrix |
| alert condition eval | server.js | `op` (`eq`/`above`/`below`) × `value` × `dwellMin` — the core of `checkHaAlerts` |
| `demoCleanText` | server.js | length cap + profanity mask, and the `IS_DEMO` no-op |
| version helpers | server.js | `isBetaVersion`, `compareVersions` |
| `predictHaState` | display.html | every action → expected merged state; the `null` cases |
| `applyHaEntityState` / `_haOptimisticHold` | display.html | the hold window: min duration, terminal-state bypass, seq guard |
| `applyAlertBannerConfig` clamps | display.html | bad position/size/style → default |
| `eventDetailKey`, `filterHaEntitiesD` | display.html | key uniqueness; name + entity_id match |
| `feedbackThreadSignature`, alert-form `readValue` | app.html | |

**Fixtures** — `test/fixtures/`:
- `ics/` — real `.ics` bodies saved from actual feeds (Google, iCloud,
  Outlook, an all-day-heavy one, a recurring one), PII scrubbed. Per the
  "test against real artifacts" lesson: a synthetic fixture once hid a
  real `parseICS` bug.
- `ha-states.json` — a realistic `/api/states` dump (light with brightness
  + colour, a lock, a cover, a media_player, a numeric sensor, a
  binary_sensor).

## 2. API / integration tests — `test/api/`

Boot the **real** `server.js` and drive its real routes.

**Boot** — `test/lib/boot-server.js`:
- `server.js` currently calls `startServer()` unconditionally at the bottom
  and has no `module.exports`. Two options:
  1. **Child process** (recommended first): `spawn` node on `server.js`
     with `env: { DATA_DIR: <tempdir>, PORT: 0-then-read, … }`, wait for
     the `Piazza HQ running at` line, hand the caller the base URL, `kill`
     on teardown. Zero change to `server.js`.
  2. **In-process**: wrap the bottom as
     `if (require.main === module) startServer(); else module.exports = { app, startServer };`
     so a test can `require` it and mount on an ephemeral port. Faster, and
     lets a coverage tool see it, but touches the file. Do this later if
     child-process overhead becomes annoying.
- Every test gets a **fresh temp `DATA_DIR`** (empty → exercises the
  migration path) and, in a second run, a **copy of a realistic
  `calendar.db`** (exercises migrating real data). Torn down after.

**Fake Home Assistant** — `test/lib/fake-ha.js`: a ~60-line `http` server
that answers `/api/`, `/api/states`, `/api/states/:id` (from
`ha-states.json`, mutable), `/api/services/:domain/:service` (records the
call, updates the in-memory state), and the websocket area/registry lookup
if reachable-without-it isn't enough. The test seeds
`PUT /api/settings {ha_base_url, ha_token}` pointing at it.

**What to assert:**
- **Migrations**: clean boot on an empty DB and on the realistic DB — no
  throw, every expected column present afterwards.
- **CRUD round-trips**: events / todo-lists / chores / reminders /
  shopping / `ha-alerts` / `hidden-events` / `screens` — create, read
  back, update, delete, and the `demoCleanText` paths under `DEMO_MODE=1`.
- **Guards**: wrong-domain HA action → 400; read-only domain → 400; the
  `DEMO_BLOCK_PREFIXES` set → 403; a slave (`device_role=slave`) write is
  proxied, not applied locally.
- **`/api/screen-config`**: shape, and that `alert_banner_*` /
  `floating_switcher_*` round-trip through `PUT /api/screens/:id`, bad
  values clamped.
- **Alert lifecycle** against the fake HA: set a state → `PUT` an
  always-true rule → trigger the evaluator → `/api/ha-alerts/active` and
  `/api/notifications/active` show it → `POST /dismiss` clears it and it
  does not re-fire while the condition holds → removing the rule clears
  everything (the beta.39 path).
- **`buildSyncSnapshot` / `applySyncSnapshot`** round-trip (host → slave
  mirror) — a known bug-prone area per HANDOFF.

## 3. Headless UI smoke — `test/ui/`

Playwright driving the real `display.html` / `app.html` from a local static
server, `page.route()` mocking `/api/*`. **Viewport ≥ 1100×700 for
`display.html`** or `IS_PREVIEW` auto-detect disables edit mode and the
test silently exercises nothing (HANDOFF lesson). Real `PointerEvent`s
dispatched via `page.evaluate`, following `setPointerCapture` to the
element it was called on, not the visual start (HANDOFF lesson).

**Targets** (things layers 1–2 can't see):
- Alert banner: for each `position` × `size` × `style`, the right
  `data-*` attrs and no layout overflow; `center` shows the scrim and
  stacks; ✕ removes the row and calls `/api/notifications/dismiss`.
- App-side alert banner appears from the mocked `/api/notifications/active`
  and its ✕ dismisses.
- Live Edit: a long continuous drag doesn't drop after ~8s / a detached
  drag doesn't wedge `renderLayout` (the beta.27/beta.32 class).
- Entity picker search filters by name and id; the alert form's ✎ pre-fills.
- Event detail: Delete only for `source:'local'`, Hide only for feed.
- **First-load paths** — several past bugs only appeared on a genuinely
  fresh load with the new thing as the only enabled one; tests must cover
  that, not just "toggle it after the page settled".

## 4. Where it runs — one Docker container

Jon has Docker Desktop. Layers 1–3 run in a single container so nothing
(Node version, Playwright, Chromium, the Linux system libs, a Linux-native
`better-sqlite3`) has to be installed on the Windows host, and the run
environment matches the Pis.

**`test/Dockerfile`**
- FROM `mcr.microsoft.com/playwright:v<pinned>-jammy` — the Playwright
  team's image: Chromium/Firefox/WebKit + every `apt` dep, plus Node.
  Pin the tag to the `@playwright/test` version in `package.json`.
- `WORKDIR /work`. The repo is bind-mounted at run time, not `COPY`d, so
  edits on the host are seen immediately with no rebuild.

**`test/docker-compose.yml`**
- One service, `tests`. Bind-mounts the repo root read-write at `/work`.
- A **named volume** `piazzahq-test-node-modules` mounted at
  `/work/test/.node_modules_linux` holds the Linux-native install
  (`better-sqlite3` compiled for the container). The test entrypoint runs
  `npm ci --prefix test` into it on first use, then reuses it — adds ~1 min
  once, instant after. The host's own Windows `node_modules` is untouched.
- `ipc: host` and `--init` (Chromium in Docker needs both to avoid crashes
  / zombie procs).
- No network needed for layers 1–2; layer 3 is fully offline too
  (`page.route()` mocks everything).

**`test/run.sh`** — the entrypoint the npm scripts call:
`docker compose -f test/docker-compose.yml run --rm tests <layer>`.
On a machine with no Docker it prints a one-line install hint and exits 1.

`preflight.js` (layer 0) stays on the host — it's just file compares and
`node --check`, no reason to pay container startup for it.

## 5. Invocation

| Command | Runs | Where |
|---|---|---|
| `npm run preflight` | layer 0 | host |
| `npm test` | 0 (host) then 1 + 2 (container) — no browser; **called by `publish-beta.sh` before upload** | mixed |
| `npm run test:ui` | layer 3 | container |
| `npm run test:all` | 0 + 1 + 2 + 3 | mixed |
| `npm run test:shell` | interactive shell in the container, for writing/debugging tests | container |

`publish-beta.sh` gains, right after the mirror-sync check:
`npm test || { echo "tests failed — not publishing"; exit 1; }`. If Docker
isn't running, that's a hard stop (fixable with `--force` or by starting
Docker Desktop).

## Explicitly NOT in scope

- Replacing the BETA_CHECKLIST hardware pass. Anything on a physical
  display, real touch/stylus, actuating a real HA device, or a real phone
  push stays Layer 4.
- A CI service. This working copy is not a git repo; tests run locally and
  from `publish-beta.sh`. The container makes this painless to add later if
  it's ever put under git — the same `test/docker-compose.yml` is what a CI
  job would run, so `npm test` is already the entrypoint.
- Docker as a dev/run environment for the app itself. The container is
  test-only; `npm start` / `publish-beta.sh` stay exactly as they are.
- `_server` (the mothership) — same pattern would apply there later
  (`_server` already has an `unzip-and-grep` verification habit per
  HANDOFF), but this spec is the device app.

## Open decisions for Jon

1. **Block the publish on test failure?** Recommend **yes** — `npm test`
   fails → `publish-beta.sh` aborts. (You can still `--force` past it, or
   just start Docker Desktop.)
2. **Layer 3 (Playwright) in the first build, or defer?** Docker removes
   the setup cost, so the argument for deferring is weaker now — but it's
   still the layer most likely to be flaky/slow to maintain. Recommend:
   build the container + layers 1–2 first (Phases 1–3), add UI smoke
   (Phase 4) right after if the container's pulling its weight.
3. **Fixture DB**: scrub a copy of a real Pi's `calendar.db`, or hand-build
   a synthetic-but-realistic one with a seed script? Scrubbed-real is more
   honest; synthetic is safe to commit anywhere.
4. **Touch `server.js`** for a `require.main` guard (in-process boot), or
   stay child-process-only? Recommend child-process first — it needs no
   change to `server.js` and the container makes the spawn cheap.
5. **`better-sqlite3` in the container**: `npm ci` into a named volume on
   first run (spec's current plan, ~1 min once), or commit a
   `test/package.json` with a prebuilt-binary sqlite lib to skip the
   compile? Named volume is simpler; revisit if the first-run compile is
   annoying on your machine.

## Phases

1. **Container + harness + port the existing test.**
   `test/Dockerfile`, `test/docker-compose.yml`, `test/run.sh`;
   `test/lib/{extract,tap}.js`; rewrite `rotation-smoke-test.js` on top of
   them; `npm test` runs preflight then the `test/` tree in the container.
   ~one session.
2. **Unit layer.** The "first targets" table — one file per subject under
   `test/unit/`, real fixtures for `parseICS`/`buildEventICS`. Wire into
   `publish-beta.sh`. ~one session.
3. **API layer.** `boot-server.js` (child process) + `fake-ha.js` +
   `test/fixtures/`; the assertions in §2. ~one session.
4. **UI smoke** (if approved in decision 2). `test/ui/` + Playwright
   config against the same container image; the §3 targets. ~one session.
