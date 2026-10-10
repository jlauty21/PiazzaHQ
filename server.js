const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { Readable } = require('stream');
const { URL } = require('url');
const fs = require('fs');
// Updates from before 1.88 copy a FIXED list of files that does not include src/ (the folder most of this server now lives in), so a release built on it
// could not start on them ("Cannot find module './src/i18n-server.js'"; seen on seven customer Pis after 1.92.0). Releases therefore also carry a copy at
// scripts/_src - scripts/ IS on that old list - and when src/ is missing it is put in place here, before anything needs it. Harmless once src/ exists.
try {
  const _srcDir = path.join(__dirname, 'src'), _srcCopy = path.join(__dirname, 'scripts', '_src');
  if (!fs.existsSync(_srcDir) && fs.existsSync(_srcCopy)) { fs.cpSync(_srcCopy, _srcDir, { recursive: true }); console.log('Restored src/ from scripts/_src (update from an older version).'); }
} catch (e) { console.error('Could not restore src/ from scripts/_src: ' + e.message); }
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
// TV control drivers (CEC/Roku/Samsung). Wrapped defensively — a device that
// hasn't updated node_modules yet (e.g. mid-rollout, before the npm-install fix
// applies) shouldn't crash the whole server over a feature nobody's using yet.
let tvDrivers = { DRIVERS: {} };
try { tvDrivers = require('./tv-control'); }
catch (e) { console.error('TV control module failed to load (TV control will be unavailable): ' + e.message); }
// Home Assistant control, MQTT direction — same defensive load as tv-control
// just above. mqttBridge itself defensively no-ops if the `mqtt` package
// isn't installed (Windows self-update can't fetch a new dependency; see
// mqtt-bridge.js's own header comment), so this require failing outright
// would only ever mean the FILE itself is missing, not the package inside it.
let mqttBridge = null;
try { mqttBridge = require('./mqtt-bridge'); }
catch (e) { console.error('MQTT bridge module failed to load (MQTT control will be unavailable): ' + e.message); }

// ── Shared outbound HTTP client (fetch() + AbortController) ──────────────────
// Every internet-facing fetcher in this file used to hand-roll its own
// http.get()/https.get() with req.setTimeout()+req.destroy() as its only
// cancellation path. That combination has a real failure mode a self-hosted
// user diagnosed directly (support email, 2026-09-16): a connection that
// stalls AFTER response headers/some body arrives doesn't always unstick
// cleanly on req.destroy() the way it does with curl or fetch()'s own
// AbortController — they saw response activity around 9s but still hit the
// 20s req.setTimeout() ceiling, while curl and fetch() against the identical
// URL completed normally. AbortController-driven cancellation is the fix
// curl and fetch() both already benefit from; every helper below gets the
// same benefit from one place instead of N slightly-different hand-rolled
// copies (and, as a bonus, fetch() auto-decompresses gzip/br responses, so
// several of those copies no longer need their own zlib handling either).
//
// family:4 pins outbound connections to IPv4 — Node's legacy http/https
// modules don't reliably fall back off a broken/partial IPv6 path the way a
// browser's Happy Eyeballs does (a household with broken IPv6 got outright
// unreachable errors; contact-form inquiry #6, 2026-09-12), which is why so
// many call sites already forced it by hand. fetch() has no direct `family`
// option — it takes a `dispatcher` (an undici Agent) instead.
let _ipv4Dispatcher = null;
try {
  const { Agent } = require('undici');
  _ipv4Dispatcher = new Agent({ connect: { family: 4 } });
} catch (e) {
  // Same defensive-require shape as tv-control just above: a device
  // mid-update (code already swapped, but the best-effort `npm install` for
  // this new dependency — server.js:13841 — skipped or failed because it
  // was offline right then) must still boot on its existing node_modules,
  // not crash-loop waiting on a network that might not come back before
  // someone notices. Every fetch below still gets the real fix
  // (AbortController-based cancellation) — it just loses the explicit IPv4
  // pin until the next successful update. Windows never runs that
  // npm-install step at all (server.js:13839's comment explains why), so
  // its build vendors node_modules/undici directly instead.
  console.error('undici unavailable — outbound fetch() will use its default dispatcher (no forced IPv4): ' + e.message);
}
// Low-level: fetch() with a hard timeout via AbortController, and the IPv4
// pin above when available. timeoutMessage lets a caller keep its own
// specific wording (e.g. "Timed out looking up ...") instead of a generic one.
function fetchWithTimeout(url, { method = 'GET', headers, body, timeoutMs = 10000, timeoutMessage } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage || `Timed out after ${timeoutMs}ms: ${url}`)), timeoutMs);
  const opts = { method, headers, body, signal: controller.signal };
  if (_ipv4Dispatcher) opts.dispatcher = _ipv4Dispatcher;
  return fetch(url, opts).finally(() => clearTimeout(timer));
}

const { execFile, execFileSync, spawn } = require('child_process');
const os = require('os');
// Windows has no process supervisor (systemd with Restart=always) to bring us
// back after a self-update or a crash — the bundled launcher just starts node
// once. The self-update machinery further down branches on this in three
// places: zip extraction (no `unzip` binary on Windows), the npm path (bundled
// next to node.exe, not on PATH), and how the process comes back after a code
// swap (supervisedWindowsRestart() instead of a bare process.exit()). The
// Raspberry Pi / Linux path is left exactly as it was.
const IS_WIN = process.platform === 'win32';
// Running inside a container (Docker et al.). In that case the code lives on
// an immutable image layer, so the in-app self-update — which swaps files on
// disk and restarts — is the wrong model: updating means pulling a newer
// image and recreating the container. The update *check* still runs (so the
// UI can say a new version exists, and the license check-in keeps working —
// they share the same request), but the download/swap/restart is refused
// with a "pull the image" message. `/.dockerenv` is present in Docker
// containers; PIAZZA_CONTAINER=1 is set by this project's own image and
// covers Podman/containerd/etc.
const IS_CONTAINER = (() => {
  try { if (fs.existsSync('/.dockerenv')) return true; } catch {}
  return process.env.PIAZZA_CONTAINER === '1';
})();
const DEPLOYMENT = IS_CONTAINER ? 'container' : (IS_WIN ? 'windows' : 'pi');
// Assigned in startServer() at the very bottom of this file. Held at module
// scope so supervisedWindowsRestart() can stop the listener — freeing the
// port — before it spawns the replacement process.
let httpServer = null;

// ── Fatal-error handling + crash marker (all platforms) ──────────────────────
// One place that enforces "an uncaught error exits the process" — systemd
// Restart, the Windows supervisor, and autoRollbackGuard all depend on that.
// It also drops a `.last-crash` file (read + cleared on the next boot, then
// reported on the following fleet check-in) so a crash that happened while
// the device was offline still gets seen centrally.
function fatalCrash(err, kind) {
  const msg = (err && (err.stack || err.message)) || String(err);
  try { console.error(`FATAL (${kind}):`, msg); } catch {}
  try {
    const dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
    fs.writeFileSync(path.join(dir, '.last-crash'),
      Date.now() + '\t' + String(msg).replace(/\s+/g, ' ').trim().slice(0, 300));
  } catch {}
  process.exit(1);
}
process.on('uncaughtException', (e) => fatalCrash(e, 'uncaughtException'));
process.on('unhandledRejection', (r) => fatalCrash(
  r instanceof Error ? r : new Error('Unhandled rejection: ' + require('util').format(r)), 'unhandledRejection'));

// ── Windows: log to a file, and make crashes visible ─────────────────────────
// On the Pi, `journalctl -u piazzahq` captures stdout/stderr and an uncaught
// error prints there before the process exits. On Windows the server runs via
// a hidden `wscript` launcher with no console attached at all — every
// console.* line, and any crash, currently goes nowhere. This tees console
// output to logs/server.log (next to the app, survives self-updates since
// `logs/` isn't in UPDATE_CODE_ITEMS) with simple size-based rotation, and
// routes uncaught errors through the same path before exiting. Entirely
// Windows-only — the Pi keeps journald and its existing crash behaviour,
// untouched.
if (IS_WIN) {
  try {
    const nodeUtil = require('util');
    const LOG_DIR = path.join(__dirname, 'logs');
    const LOG_FILE = path.join(LOG_DIR, 'server.log');
    const LOG_MAX_BYTES = 5 * 1024 * 1024;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Rotate once at startup if the current log is already large.
    try {
      if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
        fs.rmSync(LOG_FILE + '.1', { force: true });
        fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      }
    } catch {}
    let sinceRotationCheck = 0;
    const writeLine = (level, args) => {
      try {
        const line = `${new Date().toISOString()}  ${level}  ${nodeUtil.format(...args)}\n`;
        fs.appendFileSync(LOG_FILE, line);
        if (++sinceRotationCheck >= 200) {
          sinceRotationCheck = 0;
          if (fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
            fs.rmSync(LOG_FILE + '.1', { force: true });
            fs.renameSync(LOG_FILE, LOG_FILE + '.1');
          }
        }
      } catch {}
    };
    for (const [name, level] of [['log', 'INFO'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR'], ['debug', 'DEBUG']]) {
      const orig = console[name].bind(console);
      console[name] = (...args) => { writeLine(level, args); orig(...args); };
    }
    // uncaughtException / unhandledRejection are handled once, globally, by
    // fatalCrash() above (registered before this block) — which console.error's
    // through this same tee and then exits. Nothing platform-specific needed
    // here any more.
    console.log(`File logging active -> ${LOG_FILE}`);
  } catch (e) {
    // Never let logging setup stop the server from starting.
    try { console.error('Windows file-logging setup failed (continuing without it):', e.message); } catch {}
  }
}
// Home Assistant's area/entity/device registries are ONLY exposed over its
// WebSocket API, not the REST API the rest of this integration otherwise
// uses (see haWsRequest() near /api/ha/areas for why). Wrapped defensively
// for the same reason as tv-control.js above: an existing install that
// hasn't run npm install since this shipped shouldn't lose the rest of
// Home Assistant (or the whole server) over one new feature.
let WebSocketClient = null;
try { WebSocketClient = require('ws'); }
catch (e) { console.error('ws module failed to load (Home Assistant area lookup will be unavailable): ' + e.message); }
// Only needed for the Alexa skill integration below — required lazily
// (inside a try/catch, not at top-level) so a device that never sets up
// Alexa doesn't hard-fail on startup if these packages haven't been
// installed yet (e.g. right after a git pull, before npm install has run).
let Alexa = null, ExpressAdapter = null;
try {
  Alexa = require('ask-sdk-core');
  ExpressAdapter = require('ask-sdk-express-adapter').ExpressAdapter;
} catch { /* Alexa integration simply won't be mounted — see below */ }

// Returns the Pi's reachable addresses for the control app: its LAN IP and, if
// present, its Tailscale IP (100.x). Used by the on-screen control-URL badge so it
// shows an address other devices can actually use (not "localhost").
function getReachableAddresses() {
  const result = { lan: null, tailscale: null };
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Tailscale hands out 100.64.0.0/10 (CGNAT range) on a "tailscale" iface.
      if (/^100\./.test(a.address) || /tailscale|tun/i.test(name)) {
        if (!result.tailscale) result.tailscale = a.address;
      } else if (!result.lan) {
        result.lan = a.address; // first real LAN address wins
      }
    }
  }
  return result;
}

// ── Auto-rollback guard (runs before any app code) ────────────────────────────
// After a self-update we leave a `.update-pending` marker. A healthy boot clears
// it a few seconds after listening. If the NEW code crashes on startup, systemd
// keeps restarting us and the marker survives — each restart bumps its attempt
// count. Once we've failed enough times, restore the newest rolling backup so
// the Pi self-heals to the last working version. This block uses only fs/path
// and never throws, so it can't itself break boot.
(function autoRollbackGuard() {
  try {
    const dir = __dirname;
    const pendingFlag = path.join(dir, '.update-pending');
    // Literal path, not the UPDATE_BACKUPS_ROLLING_DIR const declared further
    // down this file — this IIFE runs at module-load time, before that
    // later const exists yet, same reason the single-backup version this
    // replaced also used a literal path here instead of a shared constant.
    const rollingDir = path.join(dir, '.update-backups-rolling');
    if (!fs.existsSync(pendingFlag)) return;
    let attempts = 0;
    try { attempts = parseInt(fs.readFileSync(pendingFlag, 'utf8'), 10) || 0; } catch {}
    attempts += 1;
    // Allow a couple of boots for a slow-but-healthy start before giving up.
    // On Linux/Pi, systemd restarts a crashed boot immediately, so three
    // attempts is a small window that clears in seconds. On Windows nothing
    // auto-restarts a crash — each attempt here is a deliberate relaunch (the
    // post-update supervisor, or the user reopening the app), so the threshold
    // is one lower to reach rollback without needing three separate launches.
    // (process.platform, not IS_WIN — this IIFE deliberately avoids the
    // later-declared consts so nothing about load order can break boot.)
    const maxBootAttempts = process.platform === 'win32' ? 2 : 3;
    if (attempts < maxBootAttempts) {
      try { fs.writeFileSync(pendingFlag, String(attempts)); } catch {}
      return;
    }
    // Too many failed boots — roll back to the MOST RECENT rolling backup.
    // Folder names are timestamp-prefixed and sort correctly as plain
    // strings, so the last one alphabetically is the newest.
    if (fs.existsSync(rollingDir)) {
      const entries = fs.readdirSync(rollingDir).sort();
      const latest = entries[entries.length - 1];
      if (latest) {
        const backupDir = path.join(rollingDir, latest);
        const restore = (name) => {
          const from = path.join(backupDir, name), to = path.join(dir, name);
          if (!fs.existsSync(from)) return;
          try {
            if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
            fs.cpSync(from, to, { recursive: true });
          } catch (e) { console.error('Rollback restore error for', name, e.message); }
        };
        // Restore the code files we may have swapped (never user data).
        for (const name of ['server.js', 'templates.js', 'public', 'package.json', 'scripts']) restore(name);
        console.error(`Update failed to boot — rolled back to the previous version (${latest}).`);
      }
    }
    // Clear the pending marker either way so we don't loop. Unlike the
    // single-backup version this replaced, the rolling backup used here is
    // NOT deleted afterward — rolling backups are now a retained history
    // (up to ROLLING_BACKUP_LIMIT), not a single-use rollback artifact.
    // Pruning happens on the next successful update instead, same as any
    // other rolling backup.
    try { fs.unlinkSync(pendingFlag); } catch {}
  } catch (e) {
    // Never let the guard itself stop the app from starting.
    try { console.error('Rollback guard error:', e.message); } catch {}
  }
})();

const { getTemplateSummaries, getTemplate, materializeWidgets } = require('./templates');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Demo mode ──────────────────────────────────────────────────────────────
// A locked-down build for the public "try it" pool (see the mothership's
// DEMO-POOL-SPEC.md). When on, the app has NO outbound capability: no
// licensing/update-check, no Home Assistant / Todoist / calendar push /
// briefing email / handwriting / phone push, no photo uploads, no shell or
// TV control, no PIN, no multi-device pairing. Weather/news/stocks/travel
// (free, keyless, already cached) stay on — they're part of the experience.
// The instance is leased for a few minutes then its data dir is wiped back
// to a seed; DEMO_LEASE_ENDS (epoch ms, set per lease by the broker) drives
// the on-screen countdown.
const IS_DEMO = process.env.DEMO_MODE === '1';
const DEMO_LEASE_ENDS = Number(process.env.DEMO_LEASE_ENDS) || 0;
// Set by the pool's systemd unit (see _server/demo-pool/). When both are
// present the instance validates each page load's lease cookie against the
// broker and bounces a lapsed visitor back to /demo; the front-end also
// heartbeats the broker to hold an active lease open.
const DEMO_BROKER_URL = IS_DEMO ? (process.env.DEMO_BROKER_URL || '').replace(/\/$/, '') : '';
const DEMO_INSTANCE = IS_DEMO ? (Number(process.env.DEMO_INSTANCE) || 0) : 0;
function demoBlock(res) { return res.status(403).json({ error: 'Not available in the demo.' }); }
// Trim + de-fang free text a visitor can type that later renders on the
// display or in the app. The render side already HTML-escapes; this is the
// content pass (length + a small profanity wordlist).
const DEMO_BADWORDS = /\b(fuck|shit|cunt|nigger|faggot|bitch|asshole|dick|piss|slut|whore|retard|bastard)\w*/gi;
function demoCleanText(s, max = 200) {
  if (!IS_DEMO || s == null) return s;
  return String(s).slice(0, max).replace(DEMO_BADWORDS, m => '*'.repeat(m.length));
}

// ── Persistent-state location ───────────────────────────────────────────────
// By default every piece of mutable state (the database, uploaded photos,
// the session secret, this device's stable id) lives right next to the code,
// which is fine on a Pi or a Windows install. In a container the code dir is
// an immutable image layer, so anything written there is lost on the next
// `docker pull` + recreate. Setting DATA_DIR relocates all of that to one
// directory, meant to be a mounted volume. Unset = the original layout,
// byte-for-byte — Pi and Windows are unaffected.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
if (DATA_DIR) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {} }
function dataPath(name) { return path.join(DATA_DIR || __dirname, name); }
const DB_PATH = dataPath('calendar.db');

// If the previous run crashed, fatalCrash() left a `.last-crash` marker.
// Read it once here, delete it, and stash it so the next fleet check-in
// (fetchUpdateInfo) can report it — then it's cleared. So a crash that
// happened while the device was offline is still reported once it's back.
let _lastCrash = null; // { at: epochMs, reason: string } | null
try {
  const cf = dataPath('.last-crash');
  if (fs.existsSync(cf)) {
    const raw = fs.readFileSync(cf, 'utf8').trim();
    fs.unlinkSync(cf);
    const tab = raw.indexOf('\t');
    if (tab > 0) {
      _lastCrash = { at: Number(raw.slice(0, tab)) || Date.now(), reason: raw.slice(tab + 1).slice(0, 300) };
      console.log(`Recovered from a crash at ${new Date(_lastCrash.at).toISOString()}: ${_lastCrash.reason}`);
    }
  }
} catch {}

// ── Database setup ──────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
// Actually enables WAL mode — a real, pre-existing gap found while
// investigating reported slowness across Live Edit: journal_mode was never
// set anywhere in this file, despite comments and the wal_checkpoint calls
// further down (buildBackupZip and its own duplicate) assuming WAL was
// already active. It never was — this has been running SQLite's DEFAULT
// rollback journal mode this whole time, which takes an EXCLUSIVE lock on
// the entire database file for the duration of any write, blocking every
// concurrent read until that write finishes. WAL mode lets readers and a
// writer proceed concurrently instead, which matters a great deal here:
// Live Edit alone can trigger several near-simultaneous reads (displays,
// saved layouts, widget data) while a save is also in flight, and this
// session's schedule-rule testing in particular generated a lot of rapid,
// successive writes. Set once, immediately after opening the connection —
// this is a per-database-file setting SQLite persists on disk, so it only
// needs to be requested here, not repeated before every query.
db.pragma('journal_mode = WAL');
// Periodic PASSIVE checkpoint — SQLite auto-checkpoints WAL mode on its own
// once the WAL file crosses roughly 1000 pages (~4MB), but that's a
// best-effort threshold, not a guarantee under sustained write load. PASSIVE
// specifically never blocks a concurrent reader or writer to force its way
// through — it just checkpoints whatever it safely can right now — so this
// is safe to run on a fixed timer regardless of how busy the database is at
// that moment, unlike the TRUNCATE checkpoints used before a backup copy
// elsewhere in this file, which need exclusivity and are intentionally rare.
setInterval(() => { try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {} }, 5 * 60 * 1000); // every 5 minutes

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    icon           TEXT    NOT NULL DEFAULT '📌',
    schedule_type  TEXT    NOT NULL,   -- 'weekly' | 'interval'
    schedule_config TEXT   NOT NULL,   -- JSON: {daysOfWeek:[2]} for weekly, {startDate:'YYYY-MM-DD',intervalDays:14} for interval
    active         INTEGER DEFAULT 1,
    created_at     TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT    NOT NULL,
    date      TEXT    NOT NULL,  -- YYYY-MM-DD (start date)
    end_date  TEXT,              -- YYYY-MM-DD, null = single-day event
    start_time TEXT,             -- HH:MM (null = all-day)
    end_time  TEXT,              -- HH:MM
    color     TEXT    DEFAULT '#4A90D9',
    notes     TEXT    DEFAULT '',
    location  TEXT    DEFAULT '',
    created_at TEXT   DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS ical_feeds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    url        TEXT    NOT NULL UNIQUE,
    color      TEXT    DEFAULT '#a78bfa',
    color_timed INTEGER DEFAULT 1,   -- 1 = also color-code timed (non-all-day) events with this calendar's color
    show_location INTEGER DEFAULT 0, -- 1 = show each event's LOCATION under its title on the displays
    last_synced TEXT,
    enabled    INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS ical_events (
    uid        TEXT    NOT NULL,  -- original event UID; recurring events share this across all their occurrences
    feed_id    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    date       TEXT    NOT NULL,  -- start date (this specific occurrence, for recurring events)
    end_date   TEXT,              -- end date (multi-day spans), null = single-day
    start_time TEXT,
    end_time   TEXT,
    notes      TEXT    DEFAULT '',
    location   TEXT    DEFAULT '',
    PRIMARY KEY (uid, feed_id, date),
    FOREIGN KEY (feed_id) REFERENCES ical_feeds(id) ON DELETE CASCADE
  );

  -- Events the user has chosen to hide from all displays. Scope:
  --   'occurrence' = hide just one date of an event (date column set)
  --   'series'     = hide an event and ALL its (future) occurrences (date NULL)
  -- event_key identifies the event: 'ical:<uid>' or 'local:<id>'.
  CREATE TABLE IF NOT EXISTS hidden_events (
    event_key  TEXT NOT NULL,
    scope      TEXT NOT NULL DEFAULT 'occurrence',
    date       TEXT,                 -- the specific occurrence date when scope='occurrence'
    title      TEXT DEFAULT '',      -- remembered for the manage-list UI
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (event_key, date)
  );

  -- User-submitted feedback / bug reports / feature ideas. Emailed to the product
  -- owner as a once-daily digest (only if there are unsent items). 'sent' flips to
  -- 1 once included in a digest so it isn't reported twice.
  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL DEFAULT 'feedback',  -- 'bug' | 'feature' | 'feedback'
    message    TEXT NOT NULL,
    device_name TEXT DEFAULT '',
    app_version TEXT DEFAULT '',
    image      TEXT DEFAULT '',                    -- optional uploaded screenshot filename
    sent       INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT    NOT NULL,
    label      TEXT    DEFAULT '',
    tags       TEXT    DEFAULT '',   -- comma-separated tags, e.g. "family,kids" — lets a
                                      -- screen's screensaver show just a subset of the pool
    sort_order INTEGER DEFAULT 0,
    active     INTEGER DEFAULT 1,   -- 1 = included in the slideshow/background cycle, 0 = uploaded but skipped
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photo_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS displays (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    slug       TEXT    NOT NULL UNIQUE,  -- URL-friendly id, e.g. "kitchen" — used as ?display=kitchen
    sort_order INTEGER DEFAULT 0,
    force_orientation TEXT DEFAULT 'auto',  -- 'auto' | 'landscape' | 'portrait' — which layout to render regardless of screen size
    rotation   INTEGER DEFAULT 0,           -- 0 | 90 | 180 | 270 — CSS rotation applied in-browser, no OS rotation needed
    theme      TEXT    DEFAULT ''            -- '' = none; otherwise a template theme id (july4, christmas, …) driving background + decorations
    -- Calendars, photos, integrations, and other settings stay global/shared across
    -- every display on purpose — only the widget layout differs per display.
  );

  CREATE TABLE IF NOT EXISTS layouts (
    display_id  INTEGER NOT NULL,
    orientation TEXT NOT NULL,        -- 'landscape' | 'portrait'
    widgets     TEXT NOT NULL,        -- JSON array of widget objects
    PRIMARY KEY (display_id, orientation)
  );

  -- User-saved layout presets ("Layout Library"). Each row is a complete snapshot
  -- of a look: both orientations' widget arrays plus the theme/background. These
  -- are NOT tied to any display — they can be applied to an existing display or
  -- used to spin up a new one, the user's choice at apply time.
  CREATE TABLE IF NOT EXISTS saved_layouts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    widgets_landscape   TEXT NOT NULL,   -- JSON array
    widgets_portrait    TEXT NOT NULL,   -- JSON array
    theme               TEXT DEFAULT '',
    created_at          TEXT DEFAULT (datetime('now'))
  );

  -- Physical screens (one row per Pi/kiosk). A screen registers itself with a
  -- stable device_id generated once on the display and kept in its localStorage
  -- (so it survives reboots). The app can then assign each screen a display
  -- profile and switch it live. assigned_display_slug remembers the choice across
  -- reboots; last_seen drives the online/offline indicator.
  CREATE TABLE IF NOT EXISTS screens (
    device_id             TEXT PRIMARY KEY,    -- stable per-device id from the display's localStorage
    name                  TEXT DEFAULT '',     -- user-given name; '' until they name it
    assigned_display_slug TEXT DEFAULT '',     -- which profile this screen should show ('' = default)
    info_corner           TEXT DEFAULT '',     -- '' = hidden; else 'tl'|'tr'|'bl'|'br' corner to show the control-URL overlay
    -- Per-SCREEN overrides. Orientation/rotation follow the physical screen (e.g. a TV
    -- mounted sideways), overriding the profile's own setting. '' / -1 = inherit from profile.
    screen_orientation    TEXT DEFAULT '',     -- '' = inherit | 'auto' | 'landscape' | 'portrait'
    screen_rotation       INTEGER DEFAULT -1,  -- -1 = inherit | 0 | 90 | 180 | 270
    -- Per-SCREEN screensaver filter: which photo tag this screen's screensaver/blank
    -- view cycles through. '' = show the full shared pool (default, unchanged behavior).
    -- Every photo file already syncs to every device locally, so this is a pure local
    -- filter — no networking needed to resolve it.
    screensaver_tag       TEXT DEFAULT '',
    -- Remote "ambient" display mode for this screen, toggled from the app rather
    -- than needing someone to press Tab on the physical device: '' = normal
    -- layout | 'photo' = just the background photo, no widgets | 'photo_datetime'
    -- = photo with a clock/date overlay. Reuses the existing blanked-view photo
    -- rendering underneath.
    ambient_mode          TEXT DEFAULT '',
    -- When set, this screen's screensaver/ambient-photo mode shows just THIS one
    -- photo (no cycling), overriding screensaver_tag entirely. Empty = tag-based
    -- slideshow instead (or all photos, if the tag is also empty).
    screensaver_photo_id  INTEGER,
    -- Where to place the clock/date in "Photo + time" mode, ONLY used as a
    -- fallback when this screen's real layout has no existing Clock/Date widget
    -- to match position against (see buildAmbientLayout in display.html).
    ambient_clock_corner  TEXT DEFAULT 'bl',
    -- How the photo fills the screen in Photo only / Photo + time mode: 'cover'
    -- (fill, crop to fit — default) | 'width' (show full width, may letterbox
    -- top/bottom) | 'height' (show full height, may letterbox sides).
    ambient_photo_fit     TEXT DEFAULT 'cover',
    -- Ambient mode's own slideshow settings — deliberately independent of a
    -- placed Photo widget's settings, since ambient mode (Photo only /
    -- Photo + time) doesn't require one to exist at all. interval is seconds,
    -- 0/empty = use the global setting (Photos tab).
    ambient_fade_transition TEXT DEFAULT '1',
    ambient_fade_duration   TEXT DEFAULT '2',
    ambient_photo_interval  TEXT DEFAULT '',
    ambient_blur_bg         TEXT DEFAULT '1',
    -- Multiplier for the size of a theme's animated particle effects (fireworks,
    -- snow, leaves, etc. — see applyTheme() in display.html), on top of the
    -- automatic --ui-scale sizing already applied for the screen's actual
    -- resolution. 1 = default. Exists because auto-scaling alone doesn't cover
    -- every physical setup — e.g. a big TV viewed from far away wants bigger
    -- effects than its resolution alone would suggest.
    fx_scale                TEXT DEFAULT '1',
    -- Multiplier for HOW MANY particles a theme's animated effect spawns —
    -- separate from fx_scale, which controls how big each one is. Lets one
    -- person have the occasional heart float by on Valentine's while another
    -- wants a lot of them, without changing anything else about the effect.
    fx_density              TEXT DEFAULT '1',
    -- TV power/input control for this screen's physically-connected TV. type is
    -- '' (off/unconfigured) | 'cec' | 'roku' | 'samsung'. ip is only needed for
    -- roku/samsung (network control); cec goes out over the existing HDMI cable,
    -- no address needed. samsung_token is issued by the TV after one-time
    -- pairing and reused for every future command after that.
    tv_control_type       TEXT DEFAULT '',
    tv_ip                 TEXT DEFAULT '',
    tv_samsung_token      TEXT DEFAULT '',
    -- Deprecated — replaced by the tv_schedule_slots table below, which
    -- supports any number of on/off times instead of exactly one of each.
    -- Left in place (unused) rather than dropped, since older SQLite versions
    -- handle ALTER TABLE DROP COLUMN inconsistently; migrateTvScheduleSlots()
    -- moves any existing values into the new table once, at startup.
    tv_schedule_on        TEXT DEFAULT '',
    tv_schedule_off       TEXT DEFAULT '',
    tv_schedule_last_on   TEXT DEFAULT '',
    tv_schedule_last_off  TEXT DEFAULT '',
    -- The app version this screen last reported at check-in. Lets the host spot a
    -- stale remote slave at a glance (e.g. after a fix ships, before that screen updates).
    screen_version        TEXT DEFAULT '',
    -- Floating Layout Switcher (screen-level, independent of any per-layout
    -- Layout Switcher widget) — an always-present button overlaid on top of
    -- whatever layout is currently active, so switching to a saved layout
    -- that itself has no switcher widget on it never becomes a dead end.
    -- Configured once per screen rather than needing to be placed and kept
    -- in sync across every layout by hand. floating_switcher_presets is a
    -- JSON array of saved_layout ids, same shape as a switcher widget's own
    -- switcherPresetIds — offers are independent per screen, so two screens
    -- sharing the same underlying layout can each offer different targets.
    floating_switcher_enabled  INTEGER DEFAULT 0,
    floating_switcher_presets  TEXT DEFAULT '[]',
    -- Optional scheduled auto-switching for the floating switcher — JSON
    -- array of {time: "HH:MM", daysOfWeek: [0-6], target: {type, id}}.
    -- Same target shape as floating_switcher_presets' own entries; a
    -- schedule rule doesn't need its target to also be in the manual
    -- presets list (they're independent — a rule can auto-switch to
    -- something with no corresponding tap-to-switch button, though
    -- usually you'd want both). Checked client-side, not server-side —
    -- see prefetchSwitcherPresets()/the schedule-check interval in
    -- display.html for why (needs live access to editModeActive and the
    -- pre-fetch cache, neither of which exist server-side).
    floating_switcher_schedule TEXT DEFAULT '[]',
    -- Appearance/position — a compact bar centered along one of the four
    -- screen edges rather than a free-floating icon anywhere on screen,
    -- specifically so it can never land on top of an existing widget: a
    -- widget's own position comes from the person's own layout design, but
    -- a screen only has four edges, and placing the bar flush against one
    -- (rather than spanning it) keeps it clear of most widget content even
    -- for a widget positioned near that edge.
    floating_switcher_edge     TEXT DEFAULT 'bottom',   -- 'top'|'bottom'|'left'|'right'
    floating_switcher_icon     TEXT DEFAULT '🔀',
    floating_switcher_color    TEXT DEFAULT '#0a0e1a',
    -- 'circles' (default): the original always-visible cluster of round
    -- icon buttons, centered along the chosen edge. 'bar': a thin strip
    -- spanning the FULL edge instead — different geometry entirely, not
    -- just a restyle, hence its own column rather than folding into edge.
    floating_switcher_style    TEXT DEFAULT 'circles',  -- 'circles'|'bar'
    -- Only meaningful when style='bar'. 'icons' matches circles' own
    -- icon-or-initial-letter buttons, just square instead of round.
    -- 'names' shows the actual target name instead — full text on
    -- top/bottom (bar just widens with the text), but on left/right the
    -- text ROTATES (writing-mode: vertical-rl + 180deg) rather than the
    -- bar widening, so it stays exactly as thin as icon mode on every
    -- edge — the reason 'bar' is worth having as a distinct style at all
    -- is to hug the edge tightly, and a mode that defeats that on two of
    -- its four edges would undercut the whole point of choosing it.
    floating_switcher_bar_mode TEXT DEFAULT 'icons',    -- 'icons'|'names'
    -- 'always' (default, original behavior, unchanged): visible the whole
    -- time, exactly as it's always worked. 'tap': hidden until the screen
    -- is tapped, same tap-to-reveal fade already used for the Live Editing
    -- pencil icon and the "Back to App" link (showEditIconBriefly()) —
    -- reuses that exact mechanism rather than a new one, same tap, same
    -- 4-second window, one thing to keep consistent instead of two.
    floating_switcher_reveal   TEXT DEFAULT 'always',   -- 'always'|'tap'
    -- HA condition-alert banner, per screen (rendered by pollHaAlerts() in
    -- display.html). Position is the LOGICAL edge — it rotates with the
    -- layout, so 'top' is the top of the content regardless of screen
    -- rotation. Size scales text + padding + the dismiss button together.
    alert_banner_position TEXT DEFAULT 'top',    -- 'top'|'bottom'|'center'
    alert_banner_size     TEXT DEFAULT 'm',      -- 's'|'m'|'l'|'xl'|'xxl' (screen-relative)
    alert_banner_style    TEXT DEFAULT 'solid',  -- see BANNER_STYLES in display.html
    last_seen             INTEGER DEFAULT 0,   -- epoch ms of last registration/heartbeat
    created_at            TEXT DEFAULT (datetime('now'))
  );

  -- Any number of on/off time slots per screen (replaces the old single
  -- on-time/off-time pair, which had no way to add a second slot or genuinely
  -- clear one once set). last_fired is a same-day guard so a scheduler check
  -- that happens to run more than once in the same minute can't double-fire —
  -- matters a lot for Samsung specifically, since its power command is a
  -- TOGGLE: a double-fire would turn the TV right back off a few seconds after
  -- turning it on.
  CREATE TABLE IF NOT EXISTS tv_schedule_slots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL,
    time        TEXT NOT NULL,        -- "HH:MM", 24hr
    action      TEXT NOT NULL,        -- 'on' | 'off'
    last_fired  TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS briefing_recipients (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT    NOT NULL,
    email   TEXT    NOT NULL,
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
    -- Deliberately one row per person (not a comma list) so per-recipient
    -- settings/content can be added later without a schema change.
  );

  -- ── Chore chart ──────────────────────────────────────────────────────────────
  -- kids: one row per child. display_mode picks how the kid's tablet view shows
  -- chores (pictures for pre-readers, words, or both).
  CREATE TABLE IF NOT EXISTS kids (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    color             TEXT DEFAULT '#4A90D9',
    avatar            TEXT DEFAULT '🙂',        -- emoji avatar shown on name-picker + chart
    display_mode      TEXT DEFAULT 'both',      -- 'pictures' | 'words' | 'both'
    sort_order        INTEGER DEFAULT 0,
    allowance_enabled INTEGER DEFAULT 0,
    allowance_mode    TEXT DEFAULT 'per_chore', -- 'per_chore' | 'weekly_flat'
    weekly_rate       REAL DEFAULT 0,           -- used when allowance_mode = 'weekly_flat'
    savings_goal_name   TEXT DEFAULT '',         -- optional, e.g. "Lego set"
    savings_goal_amount REAL DEFAULT 0,          -- target $ amount for the goal above
    created_at        TEXT DEFAULT (datetime('now'))
  );

  -- chores: a chore DEFINITION (the recurring rule), not a single day's instance.
  -- assignee is either a kid id (as text) or 'all'. recurrence mirrors the event
  -- engine: freq daily/weekly + byday list, or a one-time on_date.
  CREATE TABLE IF NOT EXISTS chores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    icon         TEXT DEFAULT '✅',        -- emoji/icon shown for picture mode
    assignee     TEXT DEFAULT 'all',       -- 'all' or a kids.id as text
    freq         TEXT DEFAULT 'daily',     -- 'daily' | 'weekly' | 'once'
    byday        TEXT DEFAULT '',          -- for weekly: 'MO,WE,FR' (empty = every day of week)
    on_date      TEXT DEFAULT '',          -- for once: 'YYYY-MM-DD'
    at_time      TEXT DEFAULT '',          -- optional 'HH:MM' (ordering / "not yet" hint)
    carryover    INTEGER DEFAULT 0,        -- 1 = unfinished rolls to next day as overdue
    celebrate    INTEGER DEFAULT 1,        -- 1 = celebration feedback when completed
    pay_amount   REAL DEFAULT 0,           -- $ earned per completed instance (per_chore allowance)
    notes        TEXT DEFAULT '',          -- optional short instructions, shown to the kid
    photo_required INTEGER DEFAULT 0,      -- 1 = kid must attach a photo before marking done
    bonus        INTEGER DEFAULT 0,        -- 1 = shared extra-credit pool, not auto-assigned
    active       INTEGER DEFAULT 1,
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- chore_instances: a specific chore for a specific kid on a specific date, with
  -- its done state. Created lazily by the scheduler/expander; checking off updates
  -- the row. (chore_id, kid_id, date) is unique.
  CREATE TABLE IF NOT EXISTS chore_instances (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chore_id     INTEGER NOT NULL,
    kid_id       INTEGER NOT NULL,
    date         TEXT NOT NULL,            -- 'YYYY-MM-DD' the chore is due
    done         INTEGER DEFAULT 0,
    completed_at TEXT DEFAULT '',
    pay_amount   REAL DEFAULT 0,           -- snapshot of chore.pay_amount when this instance
                                            -- was created, so a later rate change doesn't
                                            -- rewrite history already earned
    proof_photo  TEXT DEFAULT '',          -- uploaded filename, if the chore requires one
    UNIQUE(chore_id, kid_id, date)
  );

  -- allowance_ledger: every credit/debit to a kid's allowance balance. Chore completions,
  -- weekly flat credits, payouts (parent hands over cash), and manual adjustments (bonus/
  -- deduction) all land here as one row each — the kid's balance is just SUM(amount).
  -- Keeping a ledger (instead of a single running total column) means the history is
  -- auditable and a toggle-off can cleanly reverse exactly the row it created.
  CREATE TABLE IF NOT EXISTS allowance_ledger (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id            INTEGER NOT NULL,
    date              TEXT NOT NULL,        -- local YYYY-MM-DD this entry is dated
    type              TEXT NOT NULL,        -- 'chore' | 'weekly' | 'payout' | 'adjustment'
    amount            REAL NOT NULL,        -- +credit / -debit
    note              TEXT DEFAULT '',
    chore_instance_id INTEGER,              -- set for type='chore' (dedupe + clean reversal)
    period            TEXT DEFAULT '',      -- set for type='weekly', e.g. '2026-W28' (dedupe)
    created_at        TEXT DEFAULT (datetime('now'))
  );

  -- stickers: a reward/praise mark for a kid on a given day. Deliberately separate
  -- from allowance_ledger — a sticker is pure encouragement (no $ amount), and a
  -- family can use stickers with or without allowance turned on at all. Awarded
  -- one of two ways, chosen globally via the sticker_award_mode setting:
  --   'auto'   — a sticker is granted automatically when a chore with celebrate=1
  --              is marked done, one row per completed instance (see the toggle
  --              endpoint). chore_instance_id is set, letting an un-check cleanly
  --              delete exactly the row it created, the same dedupe-by-delete
  --              pattern allowance_ledger already uses for chore credits.
  --   'manual' — a parent taps "Give a sticker" in the app for any reason (not
  --              tied to a specific chore). chore_instance_id is NULL.
  -- A kid can rack up several stickers in one day (one per completed chore, plus
  -- any manual ones) — the calendar widget badge only cares whether the count for
  -- that kid/day is > 0, not the exact number.
  CREATE TABLE IF NOT EXISTS stickers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id            INTEGER NOT NULL,
    date              TEXT NOT NULL,        -- local YYYY-MM-DD this sticker is dated
    sticker_type       TEXT DEFAULT 'star',  -- reserved for future sticker art/style variety
    note              TEXT DEFAULT '',      -- optional, shown on manual awards
    chore_instance_id INTEGER,              -- set only for auto-awarded stickers (dedupe + clean reversal)
    created_at        TEXT DEFAULT (datetime('now'))
  );

  -- rewards: a parent-defined prize a kid can redeem stickers for (e.g. "Ice cream
  -- trip" for 10 stars). assignee mirrors chores' own field exactly — 'all' or a
  -- specific kids.id (or comma-separated list) — so a family can offer some
  -- rewards to everyone and others scoped to one kid (an older kid's bigger-ticket
  -- goal vs. a shared little one). Redeeming a reward is tracked in
  -- sticker_redemptions below, not by mutating anything here — a reward definition
  -- can be edited or deleted later without disturbing history already redeemed
  -- against it (see reward_title/star_cost snapshotting on that table).
  CREATE TABLE IF NOT EXISTS rewards (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    icon         TEXT DEFAULT '🎁',
    star_cost    INTEGER NOT NULL DEFAULT 10,
    assignee     TEXT DEFAULT 'all',
    active       INTEGER DEFAULT 1,
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- sticker_redemptions: a kid "spending" stars on a reward. A kid's sticker
  -- balance is COUNT(stickers) − SUM(sticker_redemptions.star_cost), the exact
  -- same append-only-ledger shape allowance_ledger already uses for money instead
  -- of stars — never a mutable running-total column, so undoing a mistaken
  -- redemption (see the DELETE endpoint) is a clean, exact reversal, not a guess.
  -- reward_title/star_cost are snapshotted at redemption time so a later edit or
  -- deletion of the reward itself doesn't rewrite history already redeemed.
  CREATE TABLE IF NOT EXISTS sticker_redemptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id       INTEGER NOT NULL,
    reward_id    INTEGER,
    reward_title TEXT NOT NULL,
    star_cost    INTEGER NOT NULL,
    date         TEXT NOT NULL,
    note         TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- favorite_cards: the parent app's Favorites tab (the new landing tab, ahead
  -- of Calendar) — a personally-curated set of quick-action and at-a-glance
  -- cards, picked from a fixed catalog of card TYPES via a "+" picker in the
  -- app, not user-authored content. One shared list for the household (same
  -- trust/scope as everything else in this app — no per-user accounts), not
  -- per-browser localStorage, so it looks the same on every device the app is
  -- opened from. 'config' is a JSON blob whose shape depends on 'type' (e.g.
  -- a kid-shortcut card's config is {"kid_id":3, "sheet":"stickers"}) — kept
  -- freeform per-type rather than a rigid column set, since the card catalog
  -- is expected to grow.
  CREATE TABLE IF NOT EXISTS favorite_cards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    config     TEXT DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Which BETA_CHECKLIST.md items are checked off, stored SEPARATELY from
  -- the file itself on purpose. BETA_CHECKLIST.md is treated as code by
  -- the update installer (in codeItems, same as server.js/public/) and
  -- gets wholesale-replaced on every update — a checkmark written directly
  -- into the file would silently vanish the moment the next beta lands,
  -- which is exactly the bug this table exists to avoid. item_index is the
  -- same stable, 0-based "Nth checklist line in the file, top to bottom"
  -- identifier the toggle endpoint and renderer already agree on; a row's
  -- mere existence here means "checked" (no boolean column needed — absence
  -- means unchecked, same append-only-implies-state economy as other
  -- tables in this file). Survives updates naturally because the SQLite
  -- database file itself is user data, never touched by the code-file
  -- replacement that resets BETA_CHECKLIST.md's own content each build.
  CREATE TABLE IF NOT EXISTS beta_checklist_checked (
    item_index INTEGER PRIMARY KEY
  );

  -- Saved custom themes: named snapshots of a background + up to 3 decorations,
  -- separate from the "live" working slots (custom_theme_bg / custom_theme_deco1-3
  -- in the settings table). The live slots stay a mutable scratch area exactly
  -- like before; saving copies the live files into their own independent files
  -- here so later edits to the live slots can never silently corrupt a saved
  -- theme, and loading a saved theme copies its files back into the live slots
  -- (also copies, not shared references, for the same reason in reverse).
  CREATE TABLE IF NOT EXISTS custom_themes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    bg_file        TEXT DEFAULT '',
    deco1_file     TEXT DEFAULT '', deco1_behavior TEXT DEFAULT 'random',
    deco2_file     TEXT DEFAULT '', deco2_behavior TEXT DEFAULT 'random',
    deco3_file     TEXT DEFAULT '', deco3_behavior TEXT DEFAULT 'random',
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  );

  -- Built-in to-do lists — a simple, fully local alternative to the Todoist-backed
  -- Tasks widget, for anyone who doesn't want to connect an external account.
  -- Deliberately separate from the Tasks widget rather than retrofitted into it:
  -- that widget's whole data model (projectId, Todoist API calls) is Todoist-
  -- specific, and blending two totally different data sources into one widget
  -- type would be more confusing than having two clearly distinct ones.
  CREATE TABLE IF NOT EXISTS todo_lists (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS todo_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id      INTEGER NOT NULL,
    text         TEXT NOT NULL,
    done         INTEGER DEFAULT 0,
    completed_at TEXT DEFAULT '',
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- Shopping lists: one or more named lists (regular grocery vs Costco, etc.),
  -- same idea as to-do lists above. Every install starts with one default list
  -- (seeded by the migration below) so existing single-list setups keep working
  -- untouched. shopping_items.list_id is added by that same migration for
  -- databases that predate lists.
  -- "Buy" links (see /api/shopping-list) are built client-side, no backend
  -- involvement — just a store-search URL with the item text as the query.
  CREATE TABLE IF NOT EXISTS shopping_lists (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS shopping_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    text         TEXT NOT NULL,
    done         INTEGER DEFAULT 0,
    completed_at TEXT DEFAULT '',
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- Session tokens: was an in-memory-only Map before this, which meant every
  -- restart wiped it — and every self-update restarts the process. So a
  -- perfectly healthy update silently logged everyone out, every time,
  -- with no indication why (surfaced as "v?"/"unknown" on the Settings
  -- version display, but affected every authenticated request equally).
  -- The token itself was already safe to persist: it's HMAC-signed with a
  -- secret that's ALREADY written to .session-secret and survives restarts
  -- (see SESSION_SECRET above), so a persisted expiry is just closing the
  -- other half of a persistence story that was already half-built.
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  -- Remote-access login gate (see "Remote access: household login gate" in
  -- server.js). One row = a remote password is set (scrypt hash); no row = the
  -- gate does not exist and nothing about auth changes. Sessions store only a
  -- sha256 of the cookie token, so a leaked DB/backup can't be replayed. Both
  -- tables are per-device on purpose and are NOT part of the sync snapshot.
  CREATE TABLE IF NOT EXISTS remote_auth (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS remote_sessions (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );
  -- Every remote sign-in attempt that reached the password check (not the ones the
  -- rate limiter turned away), newest 200 kept - shown in Settings -> Security so a
  -- guess-run or a stranger's successful sign-in is visible.
  CREATE TABLE IF NOT EXISTS remote_login_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    ok         INTEGER NOT NULL,
    country    TEXT
  );

  -- Family member profiles: a per-person view configuration for the companion
  -- app (app.html). This is a persona picker, NOT authentication — no passwords,
  -- no account creation. It sits alongside the single household App PIN
  -- (app_pin setting), which still gates getting into the app at all; a profile
  -- only personalizes what you see once you're in. Zero rows here = the app
  -- behaves exactly as it did before this table existed. The active profile is
  -- chosen per-device in localStorage and is never stored server-side.
  --   hidden_tabs: JSON array of tab ids the profile doesn't see
  --                (favorites/calendars/settings are never hideable)
  --   features:    JSON object, e.g. {"ha":false,"integrations":false};
  --                an absent key means "allowed"
  --   pin:         optional gateway PIN — prompted only when switching INTO this
  --                profile; gates nothing else and makes no privacy promise
  --   preset:      cosmetic label only (basic|intermediate|advanced|custom)
  CREATE TABLE IF NOT EXISTS profiles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    color        TEXT DEFAULT '#4A90D9',
    avatar       TEXT DEFAULT '',
    is_manager   INTEGER DEFAULT 0,
    landing_tab  TEXT DEFAULT 'favorites',
    hidden_tabs  TEXT DEFAULT '[]',
    features     TEXT DEFAULT '{}',
    pin          TEXT DEFAULT '',
    preset       TEXT DEFAULT 'advanced',
    sort         INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- Family message board: short notes household members leave for each other,
  -- shown on the wall (the "messageboard" widget) and managed from the app's
  -- Family Hub. A whiteboard corner, not a chat — no threads or replies.
  --   author_profile_id: nullable link to profiles.id (the app fills it from
  --     the active profile); a deleted profile just nulls it out and the note
  --     falls back to its stored color/author string.
  --   pinned notes sort first and are exempt from the auto-clear sweep
  --     (settings.messageboard_autoclear_days).
  CREATE TABLE IF NOT EXISTS messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    text              TEXT NOT NULL,
    author            TEXT DEFAULT '',
    author_profile_id INTEGER,
    color             TEXT DEFAULT '#4A90D9',
    pinned            INTEGER DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now'))
  );

  -- Cameras for the "camera" layout widget. A managed object (not free text in
  -- the widget) specifically so stream URLs — which routinely embed
  -- rtsp://user:pass@host — never land in the layout JSON that every browser
  -- downloads. A widget stores only camId. The local go2rtc process ingests
  -- each row's url once and repackages it for the browser; GET /api/cameras
  -- redacts url entirely (see that route). Syncs host->slave like ha_token
  -- (a slave runs its own go2rtc).
  --   kind: 'url' = url is an rtsp/rtsps/http-mjpeg/onvif source
  --         'ha'  = url is 'ha:<entity_id>'; server.js resolves the real
  --                 stream from Home Assistant at config-generation time
  CREATE TABLE IF NOT EXISTS cameras (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'url',
    url         TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- Weekly meal plan: one planned meal per (date, slot) — slot is
  -- 'breakfast' | 'lunch' | 'dinner' (which slots the household uses is the
  -- settings.mealplan_slots list; default just 'dinner'). The "mealplan"
  -- widget + the Family Hub "Meals" sub-tab. An unplanned slot simply has no
  -- row. A nightly sweep drops rows outside a sane date window. Syncs
  -- host->slave like messages/cameras. (Migration from the old date-only PK
  -- shape is right after the schema block.)
  CREATE TABLE IF NOT EXISTS meals (
    date       TEXT NOT NULL,
    slot       TEXT NOT NULL DEFAULT 'dinner',
    title      TEXT NOT NULL,
    notes      TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (date, slot)
  );

  -- Flight Map widget: live ADS-B aircraft tracking. Two moving parts:
  --   flight_watch  - saved "subjects" the widget can follow. profile_id NULL
  --                   = a household watch (added from the widget); non-null =
  --                   an entry in that person's "My Flights" list. kind is
  --                   'callsign' | 'reg' | 'hex'. Optional active_from/_to
  --                   (YYYY-MM-DD) so "tomorrow's DAL456" auto-activates then
  --                   expires. Syncs host->slave like messages/cameras.
  --   flight_positions - a short rolling breadcrumb per aircraft, so the widget
  --                   can draw a trail and hold a "last seen" point through a
  --                   coverage gap. NOT synced: every device runs its own poll
  --                   loop against the public ADS-B API (same as each running
  --                   its own go2rtc), so each accumulates its own trail. A
  --                   nightly-ish sweep keeps it to ~a few hours.
  CREATE TABLE IF NOT EXISTS flight_watch (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  INTEGER,
    kind        TEXT NOT NULL DEFAULT 'callsign',
    value       TEXT NOT NULL,
    label       TEXT DEFAULT '',
    active_from TEXT,
    active_to   TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS flight_positions (
    hex        TEXT NOT NULL,
    ts         INTEGER NOT NULL,
    lat        REAL NOT NULL,
    lon        REAL NOT NULL,
    alt_ft     INTEGER,
    gs_kts     REAL,
    track      REAL,
    callsign   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_flight_positions_hex_ts ON flight_positions (hex, ts);
`);

// ── Migrations for databases created before end_date support was added ───────
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}
if (!columnExists('events', 'end_date')) {
  db.exec(`ALTER TABLE events ADD COLUMN end_date TEXT`);
  console.log('Migrated: added end_date column to events');
}
// Multiple shopping lists. Existing single-list databases: every existing item
// lands on list 1, which is seeded as the default "Shopping List" — nothing an
// existing install sees changes until a second list is actually created.
if (!columnExists('shopping_items', 'list_id')) {
  db.exec(`ALTER TABLE shopping_items ADD COLUMN list_id INTEGER DEFAULT 1`);
  console.log('Migrated: added list_id column to shopping_items');
}
if (!db.prepare(`SELECT 1 FROM shopping_lists LIMIT 1`).get()) {
  db.prepare(`INSERT INTO shopping_lists (id, name, sort_order) VALUES (1, 'Shopping List', 0)`).run();
}
db.prepare(`UPDATE shopping_items SET list_id = 1 WHERE list_id IS NULL`).run();
// CalDAV push bookkeeping — see the "CalDAV (push local events out to iCloud)"
// section. caldav_url is the deterministic remote object URL an edit re-PUTs to
// and a delete DELETEs; caldav_push_error being non-null flags a row for the
// retry sweep.
// To-Do lists can be linked to a Todoist project or a Google Tasks list (src/todo-lists.js keeps a local mirror, items remember their remote id).
if (!columnExists('todo_lists', 'source'))     { db.exec(`ALTER TABLE todo_lists ADD COLUMN source TEXT DEFAULT ''`);     console.log('Migrated: added source column to todo_lists'); }
if (!columnExists('todo_lists', 'remote_id'))  { db.exec(`ALTER TABLE todo_lists ADD COLUMN remote_id TEXT DEFAULT ''`);  console.log('Migrated: added remote_id column to todo_lists'); }
if (!columnExists('todo_items', 'remote_id'))  { db.exec(`ALTER TABLE todo_items ADD COLUMN remote_id TEXT DEFAULT ''`);  console.log('Migrated: added remote_id column to todo_items'); }
if (!columnExists('events', 'caldav_uid'))       { db.exec(`ALTER TABLE events ADD COLUMN caldav_uid TEXT`);       console.log('Migrated: added caldav_uid column to events'); }
if (!columnExists('events', 'caldav_url'))       { db.exec(`ALTER TABLE events ADD COLUMN caldav_url TEXT`);       console.log('Migrated: added caldav_url column to events'); }
if (!columnExists('events', 'caldav_pushed_at')) { db.exec(`ALTER TABLE events ADD COLUMN caldav_pushed_at TEXT`); console.log('Migrated: added caldav_pushed_at column to events'); }
if (!columnExists('events', 'caldav_push_error')){ db.exec(`ALTER TABLE events ADD COLUMN caldav_push_error TEXT`);console.log('Migrated: added caldav_push_error column to events'); }
if (!columnExists('events', 'google_event_id'))  { db.exec(`ALTER TABLE events ADD COLUMN google_event_id TEXT`);  console.log('Migrated: added google_event_id column to events'); }
if (!columnExists('events', 'google_pushed_at')) { db.exec(`ALTER TABLE events ADD COLUMN google_pushed_at TEXT`); console.log('Migrated: added google_pushed_at column to events'); }
if (!columnExists('events', 'google_push_error')){ db.exec(`ALTER TABLE events ADD COLUMN google_push_error TEXT`);console.log('Migrated: added google_push_error column to events'); }
// Per-event push destination chosen at creation on the calendar widget.
// NULL = legacy default (push to the configured iCloud calendar if enabled
// + Google if enabled). 'local' = don't push anywhere. 'google' = Google
// only. 'caldav:<calendarUrl>' = that one iCloud calendar only.
if (!columnExists('events', 'target_calendar')) { db.exec(`ALTER TABLE events ADD COLUMN target_calendar TEXT`); console.log('Migrated: added target_calendar column to events'); }
// Family member profiles: which profile "owns" a locally-created event. NULL =
// unassigned (the pre-profiles default, and what an event falls back to if its
// owning profile is later deleted). Used for per-person colour-coding on the
// wall display and the "Mine only" filter in the app.
if (!columnExists('events', 'owner_profile_id')) { db.exec(`ALTER TABLE events ADD COLUMN owner_profile_id INTEGER`); console.log('Migrated: added owner_profile_id column to events'); }
// Event location (venue/address). For local events it's whatever was typed on
// the add-event sheet; for feed events it's the iCal LOCATION field. Shown on
// the displays only when the feed opts in (ical_feeds.show_location) — see the
// migration for that flag below, after the ical_events table rebuild.
if (!columnExists('events', 'location')) { db.exec(`ALTER TABLE events ADD COLUMN location TEXT DEFAULT ''`); console.log('Migrated: added location column to events'); }
if (!columnExists('ical_events', 'end_date')) {
  db.exec(`ALTER TABLE ical_events ADD COLUMN end_date TEXT`);
  console.log('Migrated: added end_date column to ical_events');
}
if (!columnExists('ical_feeds', 'color_timed')) {
  db.exec(`ALTER TABLE ical_feeds ADD COLUMN color_timed INTEGER DEFAULT 1`);
  console.log('Migrated: added color_timed column to ical_feeds');
}
if (!columnExists('ical_feeds', 'color_opacity')) {
  // 0-100 (a percentage, matching how the slider itself is authored/read —
  // stored this way rather than 0.0-1.0 so there's never a unit mismatch
  // to remember between the DB, the API, and the UI's own range input).
  // Applies to just this feed's COLOR wherever it renders (calendar-grid
  // dots/pills, Agenda/Upcoming/Today background tints) — never to event
  // TEXT, which always stays fully opaque/readable regardless of this
  // setting. See feedColorWithOpacity() in display.html for the one place
  // that actually applies it.
  db.exec(`ALTER TABLE ical_feeds ADD COLUMN color_opacity INTEGER DEFAULT 100`);
  console.log('Migrated: added color_opacity column to ical_feeds');
}
if (!columnExists('ical_feeds', 'use_global_opacity')) {
  // Three-tier opacity resolution, most-specific wins:
  //   1. A specific WIDGET's own override for this feed (widget.feedOpacityOverride)
  //   2. This feed's own color_opacity — but ONLY if use_global_opacity=0 (this feed
  //      opted OUT of the master default via its own "Use global default" checkbox)
  //   3. feed_default_opacity — the master slider at the top of Calendar Feeds,
  //      applied to every feed that hasn't opted out (the common case, hence
  //      defaulting to 1/on: a brand new feed follows the master slider until
  //      someone deliberately gives it its own value)
  // Resolved server-side (see the events queries below) into a single already-
  // correct color_opacity on each event, so the client only ever has to reason
  // about tier 1 — it never needs to know tiers 2/3 exist at all.
  db.exec(`ALTER TABLE ical_feeds ADD COLUMN use_global_opacity INTEGER DEFAULT 1`);
  console.log('Migrated: added use_global_opacity column to ical_feeds');
}
if (!columnExists('displays', 'force_orientation')) {
  db.exec(`ALTER TABLE displays ADD COLUMN force_orientation TEXT DEFAULT 'auto'`);
  console.log('Migrated: added force_orientation column to displays');
}
if (!columnExists('reminders', 'icon_type')) {
  // 'emoji' (default, unchanged behavior) | 'text' | 'image'. The existing
  // `icon` column keeps double duty as the emoji OR the text-label string —
  // both are just "a short string to show," no need for a separate column.
  // `icon_image` (below) is the only genuinely new piece of data: an
  // uploaded image is a filename, not something that fits in `icon`.
  db.exec(`ALTER TABLE reminders ADD COLUMN icon_type TEXT DEFAULT 'emoji'`);
  console.log('Migrated: added icon_type column to reminders');
}
if (!columnExists('reminders', 'icon_image')) {
  // Filename only (relative to UPLOAD_DIR, same as photos — reminder icon
  // uploads reuse that exact directory and multer instance rather than a
  // separate mechanism, see POST /api/reminders/icon-image). A bare
  // filename, not a full path, keeps it portable across a restore/migrate
  // to a different install path — matches how every other upload here
  // is stored.
  db.exec(`ALTER TABLE reminders ADD COLUMN icon_image TEXT`);
  console.log('Migrated: added icon_image column to reminders');
}
if (!columnExists('displays', 'rotation')) {
  db.exec(`ALTER TABLE displays ADD COLUMN rotation INTEGER DEFAULT 0`);
  console.log('Migrated: added rotation column to displays');
}
if (!columnExists('screens', 'screen_orientation')) {
  db.exec(`ALTER TABLE screens ADD COLUMN screen_orientation TEXT DEFAULT ''`);
  console.log('Migrated: added screen_orientation column to screens');
}
if (!columnExists('screens', 'screen_rotation')) {
  db.exec(`ALTER TABLE screens ADD COLUMN screen_rotation INTEGER DEFAULT -1`);
  console.log('Migrated: added screen_rotation column to screens');
}
if (!columnExists('screens', 'screensaver_tag')) {
  db.exec(`ALTER TABLE screens ADD COLUMN screensaver_tag TEXT DEFAULT ''`);
  console.log('Migrated: added screensaver_tag column to screens');
}
if (!columnExists('screens', 'ambient_mode')) {
  db.exec(`ALTER TABLE screens ADD COLUMN ambient_mode TEXT DEFAULT ''`);
  console.log('Migrated: added ambient_mode column to screens');
}
if (!columnExists('screens', 'screensaver_photo_id')) {
  db.exec(`ALTER TABLE screens ADD COLUMN screensaver_photo_id INTEGER`);
  console.log('Migrated: added screensaver_photo_id column to screens');
}
if (!columnExists('screens', 'ambient_clock_corner')) {
  db.exec(`ALTER TABLE screens ADD COLUMN ambient_clock_corner TEXT DEFAULT 'bl'`);
  console.log('Migrated: added ambient_clock_corner column to screens');
}
if (!columnExists('screens', 'ambient_photo_fit')) {
  db.exec(`ALTER TABLE screens ADD COLUMN ambient_photo_fit TEXT DEFAULT 'cover'`);
  console.log('Migrated: added ambient_photo_fit column to screens');
}
if (!columnExists('screens', 'ambient_fade_transition')) {
  db.exec(`ALTER TABLE screens ADD COLUMN ambient_fade_transition TEXT DEFAULT '1'`);
  db.exec(`ALTER TABLE screens ADD COLUMN ambient_photo_interval TEXT DEFAULT ''`);
  console.log('Migrated: added ambient slideshow columns to screens');
}
if (!columnExists('screens', 'ambient_blur_bg')) {
  db.exec(`ALTER TABLE screens ADD COLUMN ambient_blur_bg TEXT DEFAULT '1'`);
  console.log('Migrated: added ambient_blur_bg column to screens');
}
if (!columnExists('screens', 'ambient_fade_duration')) {
  db.exec(`ALTER TABLE screens ADD COLUMN ambient_fade_duration TEXT DEFAULT '2'`);
  console.log('Migrated: added ambient_fade_duration column to screens');
}
if (!columnExists('screens', 'fx_scale')) {
  db.exec(`ALTER TABLE screens ADD COLUMN fx_scale TEXT DEFAULT '1'`);
  console.log('Migrated: added fx_scale column to screens');
}
if (!columnExists('screens', 'fx_density')) {
  db.exec(`ALTER TABLE screens ADD COLUMN fx_density TEXT DEFAULT '1'`);
  console.log('Migrated: added fx_density column to screens');
}
if (!columnExists('screens', 'tv_control_type')) {
  db.exec(`ALTER TABLE screens ADD COLUMN tv_control_type TEXT DEFAULT ''`);
  db.exec(`ALTER TABLE screens ADD COLUMN tv_ip TEXT DEFAULT ''`);
  db.exec(`ALTER TABLE screens ADD COLUMN tv_samsung_token TEXT DEFAULT ''`);
  console.log('Migrated: added TV control columns to screens');
}
if (!columnExists('screens', 'tv_schedule_on')) {
  db.exec(`ALTER TABLE screens ADD COLUMN tv_schedule_on TEXT DEFAULT ''`);
  db.exec(`ALTER TABLE screens ADD COLUMN tv_schedule_off TEXT DEFAULT ''`);
  db.exec(`ALTER TABLE screens ADD COLUMN tv_schedule_last_on TEXT DEFAULT ''`);
  db.exec(`ALTER TABLE screens ADD COLUMN tv_schedule_last_off TEXT DEFAULT ''`);
  console.log('Migrated: added TV schedule columns to screens');
}
// One-time data move: existing single on-time/off-time values (the old, fixed
// two-field schedule) become rows in the new, unlimited-slots table. Guarded by
// a settings flag rather than columnExists(), since this moves DATA, not schema.
if (!db.prepare(`SELECT value FROM settings WHERE key = 'tv_schedule_slots_migrated'`).get()) {
  const screensWithOldSchedule = db.prepare(
    `SELECT device_id, tv_schedule_on, tv_schedule_off FROM screens WHERE tv_schedule_on != '' OR tv_schedule_off != ''`
  ).all();
  for (const s of screensWithOldSchedule) {
    if (s.tv_schedule_on) {
      db.prepare(`INSERT INTO tv_schedule_slots (device_id, time, action) VALUES (?, ?, 'on')`).run(s.device_id, s.tv_schedule_on);
    }
    if (s.tv_schedule_off) {
      db.prepare(`INSERT INTO tv_schedule_slots (device_id, time, action) VALUES (?, ?, 'off')`).run(s.device_id, s.tv_schedule_off);
    }
  }
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('tv_schedule_slots_migrated', '1')`).run();
  if (screensWithOldSchedule.length) console.log(`Migrated: moved TV schedule times for ${screensWithOldSchedule.length} screen(s) into tv_schedule_slots`);
}
if (!columnExists('screens', 'screen_version')) {
  db.exec(`ALTER TABLE screens ADD COLUMN screen_version TEXT DEFAULT ''`);
  console.log('Migrated: added screen_version column to screens');
}
// Floating Layout Switcher — screen-level, see the fresh-install schema's own
// comment above for the full explanation.
if (!columnExists('screens', 'floating_switcher_enabled')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_enabled INTEGER DEFAULT 0`);
  console.log('Migrated: added floating_switcher_enabled column to screens');
}
if (!columnExists('screens', 'floating_switcher_presets')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_presets TEXT DEFAULT '[]'`);
  console.log('Migrated: added floating_switcher_presets column to screens');
}
if (!columnExists('screens', 'floating_switcher_schedule')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_schedule TEXT DEFAULT '[]'`);
  console.log('Migrated: added floating_switcher_schedule column to screens');
}
if (!columnExists('screens', 'floating_switcher_edge')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_edge TEXT DEFAULT 'bottom'`);
  console.log('Migrated: added floating_switcher_edge column to screens');
}
if (!columnExists('screens', 'floating_switcher_icon')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_icon TEXT DEFAULT '🔀'`);
  console.log('Migrated: added floating_switcher_icon column to screens');
}
if (!columnExists('screens', 'floating_switcher_color')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_color TEXT DEFAULT '#0a0e1a'`);
  console.log('Migrated: added floating_switcher_color column to screens');
}
if (!columnExists('screens', 'floating_switcher_style')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_style TEXT DEFAULT 'circles'`);
  console.log('Migrated: added floating_switcher_style column to screens');
}
if (!columnExists('screens', 'floating_switcher_bar_mode')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_bar_mode TEXT DEFAULT 'icons'`);
  console.log('Migrated: added floating_switcher_bar_mode column to screens');
}
if (!columnExists('screens', 'floating_switcher_reveal')) {
  db.exec(`ALTER TABLE screens ADD COLUMN floating_switcher_reveal TEXT DEFAULT 'always'`);
  console.log('Migrated: added floating_switcher_reveal column to screens');
}
if (!columnExists('screens', 'alert_banner_position')) {
  db.exec(`ALTER TABLE screens ADD COLUMN alert_banner_position TEXT DEFAULT 'top'`);
  console.log('Migrated: added alert_banner_position column to screens');
}
if (!columnExists('screens', 'alert_banner_size')) {
  db.exec(`ALTER TABLE screens ADD COLUMN alert_banner_size TEXT DEFAULT 'm'`);
  console.log('Migrated: added alert_banner_size column to screens');
}
if (!columnExists('screens', 'alert_banner_style')) {
  db.exec(`ALTER TABLE screens ADD COLUMN alert_banner_style TEXT DEFAULT 'solid'`);
  console.log('Migrated: added alert_banner_style column to screens');
}
if (!columnExists('photos', 'tags')) {
  db.exec(`ALTER TABLE photos ADD COLUMN tags TEXT DEFAULT ''`);
  console.log('Migrated: added tags column to photos');
}
if (!columnExists('displays', 'theme')) {
  db.exec(`ALTER TABLE displays ADD COLUMN theme TEXT DEFAULT ''`);
  console.log('Migrated: added theme column to displays');
}
if (!columnExists('displays', 'font_family')) {
  db.exec(`ALTER TABLE displays ADD COLUMN font_family TEXT DEFAULT ''`);
  console.log('Migrated: added font_family column to displays');
}
if (!columnExists('photos', 'active')) {
  db.exec(`ALTER TABLE photos ADD COLUMN active INTEGER DEFAULT 1`);
  console.log('Migrated: added active column to photos');
}
if (!columnExists('photos', 'source')) {
  db.exec(`ALTER TABLE photos ADD COLUMN source TEXT DEFAULT 'upload'`);
  console.log('Migrated: added source column to photos');
}
if (!columnExists('photos', 'ext_guid')) {
  db.exec(`ALTER TABLE photos ADD COLUMN ext_guid TEXT`);
  console.log('Migrated: added ext_guid column to photos');
}
// screens table may predate the info_corner column (added with the control-URL overlay).
if (!columnExists('screens', 'info_corner')) {
  db.exec(`ALTER TABLE screens ADD COLUMN info_corner TEXT DEFAULT ''`);
  console.log('Migrated: added info_corner column to screens');
}
// Multi-device: a host tracks remote (slave) screens that register over the network.
if (!columnExists('screens', 'is_remote')) {
  db.exec(`ALTER TABLE screens ADD COLUMN is_remote INTEGER DEFAULT 0`);
  console.log('Migrated: added is_remote column to screens');
}
if (!columnExists('screens', 'remote_addr')) {
  db.exec(`ALTER TABLE screens ADD COLUMN remote_addr TEXT DEFAULT ''`);
  console.log('Migrated: added remote_addr column to screens');
}
if (!columnExists('feedback', 'image')) {
  db.exec(`ALTER TABLE feedback ADD COLUMN image TEXT DEFAULT ''`);
  console.log('Migrated: added image column to feedback');
}
// Allowance: kids gain allowance settings, chores gain a pay rate + optional notes,
// chore_instances snapshot the rate they were created with.
if (!columnExists('kids', 'allowance_enabled')) {
  db.exec(`ALTER TABLE kids ADD COLUMN allowance_enabled INTEGER DEFAULT 0`);
  console.log('Migrated: added allowance_enabled column to kids');
}
if (!columnExists('kids', 'allowance_mode')) {
  db.exec(`ALTER TABLE kids ADD COLUMN allowance_mode TEXT DEFAULT 'per_chore'`);
  console.log('Migrated: added allowance_mode column to kids');
}
if (!columnExists('kids', 'weekly_rate')) {
  db.exec(`ALTER TABLE kids ADD COLUMN weekly_rate REAL DEFAULT 0`);
  console.log('Migrated: added weekly_rate column to kids');
}
// Savings goal: an optional thing the kid is saving allowance toward (e.g. "$20 for
// a Lego set"). Purely a display/motivation feature — doesn't restrict payouts.
if (!columnExists('kids', 'savings_goal_name')) {
  db.exec(`ALTER TABLE kids ADD COLUMN savings_goal_name TEXT DEFAULT ''`);
  console.log('Migrated: added savings_goal_name column to kids');
}
if (!columnExists('kids', 'savings_goal_amount')) {
  db.exec(`ALTER TABLE kids ADD COLUMN savings_goal_amount REAL DEFAULT 0`);
  console.log('Migrated: added savings_goal_amount column to kids');
}
// Sticker style: how this kid's sticker badge looks wherever stickers are shown
// (calendar widget cells, the chore chart widget, kids.html). 'star' = a colored
// star (kid.color) with the kid's first initial inside — the default, and the
// only style that stays legible/distinguishable at small badge sizes without
// relying on emoji rendering. 'avatar' reuses the kid's existing picker avatar
// emoji. 'custom' uses a separate, independently-chosen emoji (sticker_emoji) —
// kept separate from avatar so a kid can have e.g. a fox 🦊 as their name-picker
// avatar but a trophy 🏆 as their sticker, without one choice overwriting the other.
if (!columnExists('kids', 'sticker_style')) {
  db.exec(`ALTER TABLE kids ADD COLUMN sticker_style TEXT DEFAULT 'star'`);
  console.log('Migrated: added sticker_style column to kids');
}
if (!columnExists('kids', 'sticker_emoji')) {
  db.exec(`ALTER TABLE kids ADD COLUMN sticker_emoji TEXT DEFAULT ''`);
  console.log('Migrated: added sticker_emoji column to kids');
}
if (!columnExists('chores', 'pay_amount')) {
  db.exec(`ALTER TABLE chores ADD COLUMN pay_amount REAL DEFAULT 0`);
  console.log('Migrated: added pay_amount column to chores');
}
if (!columnExists('chores', 'notes')) {
  db.exec(`ALTER TABLE chores ADD COLUMN notes TEXT DEFAULT ''`);
  console.log('Migrated: added notes column to chores');
}
// "Take turns" chores: with rotate on, the people in 'assignee' are a cycle and ONE of them gets the chore each day it applies, moving to
// the next person each time. rotate_start = the kid id that has it on rotate_anchor (a YYYY-MM-DD day); every other date is worked out
// from those two (see choreRotationKidId), so nothing is stored per day and nothing has to "advance".
if (!columnExists('chores', 'rotate')) {
  db.exec(`ALTER TABLE chores ADD COLUMN rotate INTEGER DEFAULT 0`);
  db.exec(`ALTER TABLE chores ADD COLUMN rotate_start INTEGER DEFAULT 0`);
  db.exec(`ALTER TABLE chores ADD COLUMN rotate_anchor TEXT DEFAULT ''`);
  console.log('Migrated: added rotate / rotate_start / rotate_anchor columns to chores');
}
if (!columnExists('chore_instances', 'pay_amount')) {
  db.exec(`ALTER TABLE chore_instances ADD COLUMN pay_amount REAL DEFAULT 0`);
  console.log('Migrated: added pay_amount column to chore_instances');
}
// Photo proof of completion: an optional per-chore requirement (parent sets when
// creating/editing the chore). When on, the kid must attach a photo before the
// instance can be marked done — see the toggle endpoint below, which enforces
// this at the API layer too (not just the UI), since kids.html is unauthenticated
// on the LAN and a determined kid could otherwise call the API directly.
if (!columnExists('chores', 'photo_required')) {
  db.exec(`ALTER TABLE chores ADD COLUMN photo_required INTEGER DEFAULT 0`);
  console.log('Migrated: added photo_required column to chores');
}
// A one-day "Reassign to..." moves the row to another kid; remembering who it came from lets the daily build skip that kid for that day (otherwise it re-created their copy).
if (!columnExists('chore_instances', 'reassigned_from')) {
  db.exec(`ALTER TABLE chore_instances ADD COLUMN reassigned_from INTEGER`);
  console.log('Migrated: added reassigned_from column to chore_instances');
}
if (!columnExists('chore_instances', 'proof_photo')) {
  db.exec(`ALTER TABLE chore_instances ADD COLUMN proof_photo TEXT DEFAULT ''`);
  console.log('Migrated: added proof_photo column to chore_instances');
}
// Bonus/extra-credit chores: NOT auto-assigned to specific kids like a normal
// chore (see materializeChoreInstances, which skips these entirely) — instead
// they sit in a shared pool any kid can claim for the day. Once claimed by one
// kid, that instance's normal (chore_id, date) uniqueness — enforced explicitly
// in the claim endpoint, not by the table constraint, since the table's UNIQUE
// is (chore_id, kid_id, date) and doesn't by itself stop two different kids
// from claiming the same bonus chore on the same day — keeps it out of the pool
// for everyone else that day.
if (!columnExists('chores', 'bonus')) {
  db.exec(`ALTER TABLE chores ADD COLUMN bonus INTEGER DEFAULT 0`);
  console.log('Migrated: added bonus column to chores');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS allowance_ledger (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id            INTEGER NOT NULL,
    date              TEXT NOT NULL,
    type              TEXT NOT NULL,
    amount            REAL NOT NULL,
    note              TEXT DEFAULT '',
    chore_instance_id INTEGER,
    period            TEXT DEFAULT '',
    created_at        TEXT DEFAULT (datetime('now'))
  );
`);

// Migrate ical_events from PRIMARY KEY (uid, feed_id) to (uid, feed_id, date) — needed
// so recurring events (RRULE) can store one row per occurrence instead of just one
// row total. Detected via SQLite's internal schema text rather than a marker column,
// since the change is to the PRIMARY KEY itself, not a new column.
(() => {
  const tableSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ical_events'`).get();
  const needsMigration = tableSql && /PRIMARY KEY\s*\(\s*uid\s*,\s*feed_id\s*\)/i.test(tableSql.sql);
  if (needsMigration) {
    const oldRows = db.prepare(`SELECT * FROM ical_events`).all();
    db.exec(`ALTER TABLE ical_events RENAME TO ical_events_old`);
    db.exec(`
      CREATE TABLE ical_events (
        uid        TEXT    NOT NULL,
        feed_id    INTEGER NOT NULL,
        title      TEXT    NOT NULL,
        date       TEXT    NOT NULL,
        end_date   TEXT,
        start_time TEXT,
        end_time   TEXT,
        notes      TEXT    DEFAULT '',
        location   TEXT    DEFAULT '',
        PRIMARY KEY (uid, feed_id, date),
        FOREIGN KEY (feed_id) REFERENCES ical_feeds(id) ON DELETE CASCADE
      );
    `);
    const reinsert = db.prepare(`
      INSERT OR REPLACE INTO ical_events (uid, feed_id, title, date, end_date, start_time, end_time, notes, location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of oldRows) {
      reinsert.run(r.uid, r.feed_id, r.title, r.date, r.end_date, r.start_time, r.end_time, r.notes, r.location || '');
    }
    db.exec(`DROP TABLE ical_events_old`);
    console.log(`Migrated: ical_events now supports multiple occurrences per event (${oldRows.length} existing row(s) preserved)`);
  }
})();

// Calendar event locations (feature request: show the venue on the calendar,
// e.g. which rink a kids' game is at). Added here, after any ical_events table
// rebuild above, so the column survives that rebuild. show_location is a
// per-feed opt-in (default off) so upgrading doesn't suddenly add a line of
// text under every event on every display.
if (!columnExists('ical_events', 'location')) { db.exec(`ALTER TABLE ical_events ADD COLUMN location TEXT DEFAULT ''`); console.log('Migrated: added location column to ical_events'); }
if (!columnExists('ical_feeds', 'show_location')) { db.exec(`ALTER TABLE ical_feeds ADD COLUMN show_location INTEGER DEFAULT 0`); console.log('Migrated: added show_location column to ical_feeds'); }

// Meal plan went from one row per date to one row per (date, slot). Rebuild
// the old table, mapping every existing row to the 'dinner' slot. (SQLite
// can't just ADD COLUMN into a primary key.)
if (columnExists('meals', 'date') && !columnExists('meals', 'slot')) {
  db.exec(`
    ALTER TABLE meals RENAME TO meals_old;
    CREATE TABLE meals (
      date       TEXT NOT NULL,
      slot       TEXT NOT NULL DEFAULT 'dinner',
      title      TEXT NOT NULL,
      notes      TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (date, slot)
    );
    INSERT INTO meals (date, slot, title, notes, updated_at)
      SELECT date, 'dinner', title, notes, updated_at FROM meals_old;
    DROP TABLE meals_old;
  `);
  console.log('Migrated: meals table now keyed by (date, slot)');
}

// Migrate the old single-recipient briefing_recipient setting (pre-multi-recipient
// support) into the new briefing_recipients table, then remove the stale key.
(() => {
  const oldRecipient = db.prepare(`SELECT value FROM settings WHERE key = 'briefing_recipient'`).get();
  if (oldRecipient?.value) {
    const exists = db.prepare(`SELECT id FROM briefing_recipients WHERE email = ?`).get(oldRecipient.value);
    if (!exists) {
      db.prepare(`INSERT INTO briefing_recipients (name, email, enabled, sort_order) VALUES (?, ?, 1, 0)`)
        .run('', oldRecipient.value);
      console.log(`Migrated: moved briefing_recipient (${oldRecipient.value}) into briefing_recipients table`);
    }
    db.prepare(`DELETE FROM settings WHERE key = 'briefing_recipient'`).run();
  }
})();

// Migrate the old single-display layouts table (PRIMARY KEY orientation) into the
// new per-display structure (PRIMARY KEY display_id+orientation). Pre-multi-display
// installs had no displays table at all and one layout row per orientation; this
// creates a "Main Display" profile and reattaches those existing layouts to it.
(() => {
  const layoutCols = db.prepare(`PRAGMA table_info(layouts)`).all();
  const hasDisplayId = layoutCols.some(c => c.name === 'display_id');
  if (layoutCols.length && !hasDisplayId) {
    const oldLayouts = db.prepare(`SELECT orientation, widgets FROM layouts`).all();
    db.exec(`ALTER TABLE layouts RENAME TO layouts_old`);
    db.exec(`
      CREATE TABLE layouts (
        display_id  INTEGER NOT NULL,
        orientation TEXT NOT NULL,
        widgets     TEXT NOT NULL,
        PRIMARY KEY (display_id, orientation)
      );
    `);
    let mainDisplay = db.prepare(`SELECT id FROM displays WHERE slug = 'main'`).get();
    if (!mainDisplay) {
      const result = db.prepare(`INSERT INTO displays (name, slug, sort_order) VALUES ('Main Display', 'main', 0)`).run();
      mainDisplay = { id: result.lastInsertRowid };
    }
    const insertLayout = db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, ?, ?)`);
    for (const row of oldLayouts) {
      insertLayout.run(mainDisplay.id, row.orientation, row.widgets);
    }
    db.exec(`DROP TABLE layouts_old`);
    console.log(`Migrated: moved ${oldLayouts.length} layout(s) into new per-display structure under "Main Display"`);
  }
})();

// Ensure at least one display profile always exists, so a fresh install (or one
// that's never had any layouts table at all) still has somewhere for the default
// landscape/portrait layouts to attach to.
if (db.prepare(`SELECT COUNT(*) as c FROM displays`).get().c === 0) {
  db.prepare(`INSERT INTO displays (name, slug, sort_order) VALUES ('Main Display', 'main', 0)`).run();
  console.log('Created default "Main Display" profile');
}


// Default settings
const defaultSettings = {
  display_name: 'Home',
  weather_lat: '',
  weather_lon: '',
  weather_zip: '',
  weather_provider: 'open-meteo',  // 'open-meteo' (default, keyless) | 'openweathermap'
  weather_api_key: '',             // user's own API key (required for openweathermap)
  weather_refresh_min: '15',      // how often the display re-fetches weather (5–60 min)
  travel_provider: 'osrm',        // 'osrm' (default, keyless, no live traffic) | 'google' (needs an API key, traffic-aware)
  travel_api_key: '',              // user's own Google Maps API key (required for the google provider)
  shopping_store: 'walmart',       // which store the shopping list's "Buy" links search: walmart | target | kroger | amazon
  display_res_w: '',              // real TV resolution reported by the Pi (for accurate previews)
  display_res_h: '',
  display_refresh_min: '360',     // full page auto-reload interval in minutes (0 = off). Like pressing F5. Default 6 hours
                                  // since 1.92.0-beta.31 (was Off): a kiosk that runs for weeks should re-issue its page load now
                                  // and then. The display waits for a quiet moment and for the server to answer before reloading.
  force_real_display: '0',        // per-device override: treat this screen as a real display even
                                   // if its CSS viewport (window.innerWidth/innerHeight) looks
                                   // phone/tablet-sized — needed on setups where OS-level display
                                   // scaling shrinks the CSS viewport well below the physical screen
                                   // size (e.g. an unusual scaling factor on a touchscreen monitor),
                                   // which the auto-detection can't tell apart from an actual small
                                   // device on viewport numbers alone. Off by default; only needed
                                   // when the auto-detected preview mode is wrong for a real screen.
  weather_location_auto: '',    // city/state label derived automatically from the last ZIP lookup
  weather_location_manual: '',  // user override — takes priority over the auto label when set
  weather_unit: 'fahrenheit',   // device-wide default — 'fahrenheit' or 'celsius'; a widget can
                                 // override this individually (see wxUnit on the widget itself),
                                 // same override pattern already used for location (wxLat/wxLon)
  theme: 'dark',
  show_weather: '1',
  app_pin: '',  // empty = no PIN required
  remote_access_require_auth: '0', // '1' = LAN devices must sign in with the remote password too (needs one to be set); the kiosk on the box itself never does
  todoist_token: '',  // empty = Todoist widget disabled
  ha_base_url: '',    // Home Assistant base URL, e.g. http://homeassistant.local:8123 — empty = integration disabled
  ha_token: '',        // Home Assistant Long-Lived Access Token (Profile -> Security -> Long-Lived Access Tokens)
  ical_sync_minutes: '30',  // how often iCal feeds auto-refresh
  stock_tickers: '',  // LEGACY — was the one global ticker list before v1.77.77 moved ticker
                       // tracking to be per-widget (w.stockTickers). Kept only so
                       // migrateLegacyStockTickers() can seed existing widgets once; no longer
                       // written to by any UI. Safe to ignore/remove in a future cleanup pass
                       // once confident no device still needs the migration.
  stock_indices_disabled: '',  // comma-separated index symbols to hide, e.g. "^DJI" — still global/device-wide by design (Data Sources), since which indices exist at all isn't a per-widget question the way custom tickers are.
  widget_text_color: '#e8edf5',  // global default text color for all widgets (per-widget override available in Layout editor)

  // News sources. Three independent sources, each toggleable, each with its own
  // "priority" flag (priority sources get guaranteed reserved slots so they can't
  // be crowded out). Defaults preserve the old behavior: National only.
  news_national_enabled: '1',
  news_national_priority: '0',
  news_world_enabled: '0',
  news_world_priority: '0',
  news_local_enabled: '0',
  news_local_priority: '0',
  news_local_location: '',          // city/region, e.g. "Columbus" or "Columbus, OH"
  news_keywords_enabled: '0',
  news_keywords_priority: '0',
  news_keywords: '',                // comma-separated terms; each becomes its own labeled group

  // Daily briefing email
  briefing_enabled: '0',          // 0/1
  briefing_time: '07:00',         // HH:MM, 24hr, in the timezone setting above
  briefing_provider: 'gmail',     // 'gmail' for now; other SMTP providers can be added later
  briefing_email_user: '',        // sending account address
  briefing_email_pass: '',        // app password (Gmail) or SMTP password
  briefing_last_sent: '',         // ISO date of last successful send, prevents duplicate sends same day
  briefing_todoist_project_ids: '', // comma-separated Todoist project IDs to include in the email; empty = all projects
  briefing_task_scope: 'all',     // 'all' = every task regardless of due date; 'today' = only tasks due today (or overdue)
  // Daily email content options
  briefing_weather_format: 'summary', // 'summary' = morning/afternoon/night blocks; 'hourly' = compact hourly strip
  briefing_include_news: '1',     // include news section in the email
  briefing_news_per_section: '3', // max articles per news section (World/National/Local/keyword)
  briefing_include_stocks: '0',   // include a previous-day stocks summary
  briefing_include_reminders: '1', // include today's due reminders (trash day, etc.) — on by default, same tier as Events/Tasks rather than opt-in like Stocks/News
  // iCloud Calendar push (CalDAV) — write local events out to Apple Calendar.
  // Same credential model as the briefing Gmail app-password above: an Apple
  // ID + an app-specific password from appleid.apple.com. Household-wide (NOT
  // in LOCAL_ONLY_SETTINGS), though only the host ever actually pushes.
  icloud_push_enabled: '0',       // 0/1 — master switch for pushing new local events
  icloud_username: '',            // Apple ID
  icloud_app_password: '',        // app-specific password (never echoed back by the API)
  icloud_calendar_url: '',        // the DEFAULT calendar collection's CalDAV URL
  icloud_calendar_name: '',       // that calendar's display name — cosmetic, for the "Connected to: X" line
  icloud_calendars_json: '',      // JSON [{url,name}] of every discovered writable calendar, for the per-event picker
  // iCloud shared-album photo sync — paste a public shared-album link and the
  // server polls its web feed, downloading photos into the same pool as
  // uploads (tagged 'icloud', source='icloud'). No OAuth. Host-only.
  icloud_album_url: '',            // the https://www.icloud.com/sharedalbum/#... link ('' = disabled)
  icloud_album_ctag: '',           // streamCtag from the last sync — lets a poll no-op when nothing changed
  icloud_album_last_sync: '',      // ISO timestamp of the last successful sync
  icloud_album_last_error: '',     // last sync error message ('' = ok)
  icloud_album_sync_minutes: '60', // poll interval (albums change less often than calendars)
  icloud_album_max: '300',         // cap on how many of the album's photos to keep (newest first)
  icloud_album_max_px: '2160',     // don't download a derivative taller than this (SD-card guard)
  // Google Calendar push (OAuth device flow). client_id/secret are ONE shared
  // OAuth client for all households — read from env first (see getGoogleConfig),
  // these settings are the fallback. The tokens are per-household, obtained via
  // the device flow, and never echoed back by the API.
  google_push_enabled: '0',
  google_oauth_client_id: '',
  google_oauth_client_secret: '',
  google_refresh_token: '',       // long-lived; presence == "connected"
  google_access_token: '',        // short-lived cache
  google_access_token_expiry: '', // epoch ms
  google_account_email: '',       // cosmetic — "Connected as X"
  google_calendar_id: '',         // which calendar to push into (e.g. an email, or a calendar id)
  google_calendar_name: '',       // cosmetic
  // Handwriting-to-text for the display's "long-press a day to add an event"
  // sheet. Optional. The MyScript keys are ONE shared account for all
  // households (same model as the Google client); the HMAC key is a shared
  // secret and is only ever used server-side by /api/handwriting/recognize —
  // it is never echoed back by the API or sent to a browser.
  ha_alerts_json: '',             // JSON [{id,entityId,name,op,value,dwellMin,message,enabled}] — condition alerts
  phone_alerts_enabled: '0',      // 0/1 — relay notifications to the household's phones via the mothership
  notif_prefs_json: '',           // JSON { <kind>: {screen:bool, phone:bool} } — per-kind delivery matrix
  severe_weather_alerts_enabled: '0', // 0/1 — poll NWS for active alerts at the household's weather location
  severe_weather_min_severity: 'Moderate', // Extreme|Severe|Moderate|Minor — NWS severity floor to notify on
  severe_weather_muted_events: '[]',   // JSON array of NWS event types that never alert (e.g. "Flood Warning")
  severe_weather_snoozed_events: '{}', // JSON { eventType: untilMs } — quiet until then
  severe_weather_seen: '{}',           // internal: warnings already notified, so an update isn't treated as new
  severe_weather_event_history: '{}',  // internal: event types seen near here lately, for the Settings list
  severe_weather_event_severity: '{}', // internal: the severity NWS last gave each of those types, so Settings can show which fall below the minimum
  handwriting_enabled: '0',       // 0/1 — show the ✍️ button on the add-event sheet
  myscript_app_key: '',           // MyScript application key
  myscript_hmac_key: '',          // MyScript HMAC key (server-side only, never echoed)
  // Feedback digest — emails submitted feedback/bugs/ideas to the product owner
  // once daily, only if there are unsent submissions. Reuses the briefing email
  // account (briefing_email_user/pass + provider) to actually send.
  feedback_enabled: '1',          // default ON so the developer reliably receives reports
  feedback_time: '08:00',         // HH:MM local
  feedback_last_sent: '',
  // Central feedback intake (the mothership). When a URL is set, each submission is
  // ALSO POSTed there in real time so feedback reaches the developer even if this
  // device never set up its own email. Empty = feature off (local + email only).
  feedback_central_url: '',       // e.g. https://host.tailnet.ts.net  (no trailing /api path)
  feedback_central_key: '',       // shared secret matching the server's FEEDBACK_INTAKE_SECRET
  // Software updates (pull from the central server / "mothership").
  update_server_url: 'https://piazzahq.com',

  // ── Multi-device (host / slave) ──────────────────────────────────────────────
  // device_role: 'host' (default — the source of truth) or 'slave' (mirrors a host's
  //   shared content read-only, while keeping its own local layout/orientation).
  // A slave stores the host's reachable addresses; it prefers the Tailscale address
  // when present (works on any network) and falls back to the LAN IP.
  device_role:        'host',
  host_lan_address:   '',         // e.g. 192.168.1.50  (host's LAN IP, optional port)
  host_ts_address:    '',         // e.g. 100.115.65.87 (host's Tailscale IP) — preferred when set
  host_port:          '3000',     // port the host serves on (usually 3000)
  setup_complete:     '',         // '' until the first-run wizard finishes on this device
  chores_enabled:     '1',        // show the Chores tab + chore features (on by default)
  sticker_award_mode: 'manual',   // 'manual' (parent taps to award) or 'auto' (granted when a
                                   // celebrate=1 chore is completed) — parent's choice, see stickers table
  shopping_enabled:   '0',        // show the Shopping tab + widget (off by default, same as todo_enabled)
  reminders_enabled:  '1',        // show the Reminders tab in Family Hub (on by default, same as chores_enabled — new feature, but useful the moment even one reminder exists)
  messageboard_enabled: '0',      // show the Message Board (Family Hub "Board" sub-tab + the widget) — off by default, opt-in like todo/shopping
  messageboard_autoclear_days: '14', // notes older than this (and not pinned) are swept; '0' = never
  mealplan_enabled:   '0',        // show the Meal Plan (Family Hub "Meals" sub-tab + the widget) — off by default, opt-in like the board
  mealplan_slots:     'dinner',   // which meal slots the household plans — comma list of breakfast,lunch,dinner (order-insensitive; 'dinner' = the original one-per-day behaviour)
  go2rtc_port:        '1984',     // localhost port the managed go2rtc media process binds to (camera widget)
  camera_service_autostart: '1',  // '0' = never launch the go2rtc process even when a camera widget exists (hard off switch)
  flightmap_enabled:  '0',        // show the Flight Map widget in the palette — off by default, opt-in like the camera
  flightmap_source:   '',         // base URL of the ADS-B API; '' = the first built-in (airplanes.live), then adsb.lol / adsb.fi as fallbacks
  flightmap_poll_seconds: '12',   // how often the server re-polls the ADS-B API per distinct query (clamped to >= 8)
  flightmap_trail_minutes: '30',  // how much breadcrumb trail to keep/show per aircraft
  flightmap_ua_contact: '',       // optional email/URL appended to the courtesy User-Agent the ADS-B APIs ask for
  sync_interval_min:  '5',        // how often a slave pulls fresh data from the host
  last_sync_at:       '',         // ISO timestamp of the last successful sync (slave only)
  last_sync_status:   '',         // 'ok' | 'error: <msg>' — surfaced in the app
  auto_push_updates:  '1',        // host: after a healthy self-update, push the same zip to slaves
  update_schedule_mode: 'immediate', // 'immediate' (default) or 'scheduled' — see periodicUpdateCheck()
                                   // and scheduleNextDailyUpdateInstall() below for how each is handled
  update_schedule_time: '03:00',  // 'HH:MM' 24-hour, LOCAL time — only used when update_schedule_mode
                                   // is 'scheduled'; the daily time a pending update actually installs
  week_start_day:     '0',        // '0' = Sunday, '1' = Monday — affects grid-based calendar views
  feed_default_opacity: '100',    // master opacity (0-100) applied to any feed that hasn't opted out
                                   // via its own use_global_opacity=0 — see ical_feeds' own column
                                   // comment below for the full three-tier resolution (this ->
                                   // per-feed -> per-widget override, most-specific wins).
  text_shadow:        'off',      // 'off' | 'soft' | 'strong' — a drop shadow behind every widget's text so clocks, dates and weather stay readable over photos
  time_format:        '12',       // '12' or '24' — affects the clock widget and any time-of-day text
  ampm_case:          'lower',    // 'lower' or 'upper' — casing for am/pm in 12-hour time (clock + any
                                   // widget showing a time-of-day); the standalone widgets can override
                                   // per-instance the same way clockTimeFormat/dateFormat already do
  date_format:        'us_long',  // 'us_long'|'intl_long'|'iso'|'us_short'|'intl_short'|'us_ordinal'|'intl_ordinal' — default for any
                                   // widget showing a date; the standalone Date widget can override per-instance
  tour_completed:     '',         // '' until the spotlight tour has run once on this device (host only)
  checklist_done:     '',         // comma-separated ids of completed getting-started checklist items
  checklist_dismissed: '',        // '1' once the getting-started card has been dismissed
};
for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

// One-time: the display's auto-refresh used to default to Off, and the Settings screen saves every field on the
// page whenever anything on it is saved, so an installed device holding "0" almost always holds the old default,
// not a choice (nobody opted out of a feature this obscure on purpose). Move those to the new 6-hour default once;
// after this runs, whatever someone sets - including Off - is left alone. Guarded by a flag like the migration above.
if (!db.prepare(`SELECT value FROM settings WHERE key = 'display_refresh_default_migrated'`).get()) {
  const moved = db.prepare(`UPDATE settings SET value = '360' WHERE key = 'display_refresh_min' AND (value = '0' OR value = '')`).run().changes;
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('display_refresh_default_migrated', '1')`).run();
  if (moved) console.log('Migrated: display auto-refresh moved from Off to the 6-hour default');
}

// Detect a device id that was copied over from a DIFFERENT physical machine
// (e.g. manually copying the whole project directory to bootstrap a second
// Pi, rather than a fresh install/setup wizard) and regenerate it in that
// case — found live: two physically different Pis ended up presenting the
// IDENTICAL device id to the central server, because one had been
// bootstrapped by copying files from the other well before the setup
// wizard/install flow existed. The central server literally couldn't tell
// them apart: every check-in from either device silently overwrote the
// same single shared activation record, flipping its role back and forth
// depending on whichever device happened to check in most recently.
// /etc/machine-id is the actual fix, not just a workaround for this one
// case: it's a Debian/Raspberry Pi OS-level identifier generated fresh by
// the OS itself on that machine's first boot, entirely separate from
// anything in this app's own files — so unlike screen_device_id_cache
// itself, it can't get carried along by copying calendar.db (or the whole
// project folder) between two already-provisioned machines. Runs on every
// boot, not just at install time, so it self-heals even if this happens
// again in some way nobody's thought of yet.
function currentMachineId() {
  try { return fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch { return ''; }
}
{
  const machineId = currentMachineId();
  const stored = db.prepare(`SELECT value FROM settings WHERE key = 'device_machine_id_cache'`).get();
  if (machineId && stored && stored.value && stored.value !== machineId) {
    db.prepare(`DELETE FROM settings WHERE key = 'screen_device_id_cache'`).run();
    console.log("This database's device id belonged to a different physical machine — regenerating a fresh one for this device.");
  }
  if (machineId) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('device_machine_id_cache', ?)`).run(machineId);
  }
}

// A real, persistent, unique-per-install device ID for update check-ins — this is
// what fetchUpdateInfo() below actually sends as `device`. Deliberately NOT part of
// the defaultSettings loop above, since that seeds the same static value everywhere;
// this needs a freshly generated one per install instead. INSERT OR IGNORE means
// this only ever takes effect the very first time — every run after that keeps
// whatever ID already exists (or was just cleared above, if this database turned
// out to belong to a different physical machine). (Fixes a real bug: every install
// was previously sending the same hardcoded literal 'pi' as its device ID, making
// per-device check-in data meaningless — installs indistinguishably overwrote each
// other.)
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('screen_device_id_cache', ?)`).run(crypto.randomUUID());

// One-time migration for devices that existed BEFORE the first-run wizard was added.
// Such a device has setup_complete = '' but is clearly already in use, so it should
// NOT be shown the wizard. If we detect any sign of prior configuration/content, mark
// setup as complete so the wizard only ever appears on a genuinely fresh install.
try {
  const sc = db.prepare(`SELECT value FROM settings WHERE key = 'setup_complete'`).get();
  if (!sc || !sc.value) {
    const count = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
    // Deliberately does NOT include `layouts` here — that table gets a default
    // layout auto-seeded by seedDefaultLayoutsForDisplay() below on every single
    // server startup for any existing display, completely independent of any
    // real user action (the display needs SOMETHING to show even before setup).
    // Including it here was a real, confirmed bug: on a fresh install, the
    // server starts once during install.sh (seeding the default layout for the
    // first time), then again after the installer's own final reboot — and on
    // that SECOND startup, this check would see layouts > 0 (from the first
    // startup's auto-seed) and incorrectly conclude "this device already has
    // history," marking setup_complete='1' before the user ever loaded the
    // page. The wizard — including the required email step — would then never
    // trigger on what was genuinely a brand new install.
    const hasHistory =
      count(`SELECT COUNT(*) n FROM events`) > 0 ||
      count(`SELECT COUNT(*) n FROM ical_feeds`) > 0 ||
      count(`SELECT COUNT(*) n FROM photos`) > 0 ||
      count(`SELECT COUNT(*) n FROM saved_layouts`) > 0 ||
      count(`SELECT COUNT(*) n FROM kids`) > 0;
    // Also treat a device that already declared itself a slave as configured.
    const roleRow = db.prepare(`SELECT value FROM settings WHERE key = 'device_role'`).get();
    const isConfiguredSlave = roleRow && roleRow.value === 'slave';
    if (hasHistory || isConfiguredSlave) {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('setup_complete', '1')`).run();
    }
  }
} catch (e) {
  console.error('setup_complete migration check failed (non-fatal):', e.message);
}

// Default photo settings
const defaultPhotoSettings = {
  placement:        'fullscreen',   // fullscreen | left | right
  brightness:       '40',           // 0–100 (overlay opacity inverted, darkens photo for readability)
  opacity:          '100',          // 0–100 (transparency of the photo itself)
  slideshow:        '0',            // 0 = off, 1 = on
  slideshow_interval: '30',         // seconds between slides
  // Tab/blank view: what shows when someone presses Tab on the display (hides all
  // widgets). 'slideshow' = cycle the selected photos, 'single' = one chosen photo,
  // 'black' = blank black screen.
  blank_mode:       'slideshow',    // slideshow | single | black
  blank_photo_id:   '',             // photo id for 'single' mode
};
for (const [key, value] of Object.entries(defaultPhotoSettings)) {
  db.prepare(`INSERT OR IGNORE INTO photo_settings (key, value) VALUES (?, ?)`).run(key, value);
}

// Default layouts (positions in % of 100-unit grid) — applied to any display that
// doesn't already have a saved layout for a given orientation (existing displays
// keep whatever they've customized; only missing orientations get seeded).
const defaultLandscape = JSON.stringify([
  { id:'w1', type:'clock',    x:2,  y:2,  w:30, h:9  },
  { id:'w2', type:'date',     x:2,  y:11, w:30, h:5  },
  { id:'w3', type:'weather',  x:66, y:2,  w:32, h:14 },
  { id:'w4', type:'minical',  x:2,  y:18, w:96, h:80, calView:'month' },
]);
const defaultPortrait = JSON.stringify([
  { id:'w1', type:'clock',    x:2,  y:1,  w:55, h:8  },
  { id:'w2', type:'weather',  x:59, y:1,  w:39, h:8  },
  { id:'w3', type:'date',     x:2,  y:10, w:96, h:4  },
  { id:'w4', type:'minical',  x:2,  y:15, w:96, h:83, calView:'month' },
]);

function seedDefaultLayoutsForDisplay(displayId) {
  db.prepare(`INSERT OR IGNORE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`)
    .run(displayId, defaultLandscape);
  db.prepare(`INSERT OR IGNORE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`)
    .run(displayId, defaultPortrait);
}

for (const d of db.prepare(`SELECT id FROM displays`).all()) {
  seedDefaultLayoutsForDisplay(d.id);
}

// ── Photo upload dir ──────────────────────────────────────────────────────────
// Default: public/uploads, served for free by the blanket express.static on
// public/ below. With DATA_DIR set, uploads move out of the code tree
// entirely (onto the volume) and get their own /uploads static mount. Files
// are referenced by "/uploads/..." URLs either way, so nothing downstream
// changes. UPLOADS_INSIDE_PUBLIC is what the code-swap paths check to decide
// whether uploads need preserving across a public/ wipe (they don't, once
// they're on the volume).
const UPLOADS_INSIDE_PUBLIC = !DATA_DIR;
const UPLOAD_DIR = DATA_DIR ? path.join(DATA_DIR, 'uploads') : path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `photo_${Date.now()}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(null, false);
  }
});

// ── Custom theme uploads (background + up to 3 decorations) ──────────────────
// Decorations are restricted to PNG specifically — transparency is what makes
// a "floating decoration" actually read as one; a JPEG would show as a solid
// rectangle drifting across the screen, not a cutout image.
const CUSTOM_THEME_DIR = path.join(UPLOAD_DIR, 'custom-theme');
if (!fs.existsSync(CUSTOM_THEME_DIR)) fs.mkdirSync(CUSTOM_THEME_DIR, { recursive: true });
// Resolves a stored "/uploads/..." url path to a real file under UPLOAD_DIR
// (which may or may not be inside public/). Used by the custom-theme file
// cleanup helpers, which only ever deal with "/uploads/custom-theme/..." urls.
function uploadFilePath(urlPath) {
  return path.join(UPLOAD_DIR, String(urlPath || '').replace(/^\/?uploads\//, '').replace(/^\//, ''));
}
const customThemeStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CUSTOM_THEME_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const prefix = req.path.includes('/background') ? 'bg' : `deco${req.params.slot}`;
    cb(null, `${prefix}_${Date.now()}${ext}`);
  }
});
const uploadCustomBg = multer({
  storage: customThemeStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(null, false);
  }
});
const uploadCustomDeco = multer({
  storage: customThemeStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // decorations are small overlay images, not full backgrounds
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') return cb(null, true);
    cb(null, false);
  }
});

// ── Self-update machinery ─────────────────────────────────────────────────────
// Lets the user drop a new piazzahq.zip in the app; the server validates it,
// backs up the current install, swaps in the new code (never touching user data),
// and restarts via systemd. A startup health-marker enables auto-rollback if the
// new version fails to boot. See /api/update.
const APP_VERSION = (() => {
  try { return require('./package.json').version || '0.0.0'; } catch { return '0.0.0'; }
})();

// ── Built-in central server ───────────────────────────────────────────────────
// The update + feedback server is now baked in, so every install phones home to it
// automatically with no per-device configuration. These supersede the old
// update_server_url / feedback_central_* settings (which still exist in code but are
// no longer surfaced in the UI). To repoint everything, change these constants.
// PIAZZA_CENTRAL_SERVER_URL is for tests only (unset in every real deployment): a throwaway instance left running for
// minutes would otherwise phone the production server at its first update check and show up in the real fleet list.
const CENTRAL_SERVER_URL  = process.env.PIAZZA_CENTRAL_SERVER_URL || 'https://piazzahq.com';
const CENTRAL_FEEDBACK_KEY = '6_vThChEqBztAfahwsNglL9O';
// Resolvers prefer the hard-coded value but fall back to a setting if one is set
// (lets an advanced user still override via the API if ever needed).
function resolveUpdateServerUrl() {
  return (CENTRAL_SERVER_URL || getSetting('update_server_url') || '').trim().replace(/\/$/, '');
}
function resolveFeedbackUrl() {
  return (CENTRAL_SERVER_URL || getSetting('feedback_central_url') || '').trim().replace(/\/$/, '');
}
function resolveFeedbackKey() {
  return (CENTRAL_FEEDBACK_KEY || getSetting('feedback_central_key') || '').trim();
}
// In-memory cache for the "Support the Project" links — these change rarely
// (an admin pasting a link in once), so there's no reason to hit the central
// server on every single Settings tab open. A stale cached value (up to 6h
// old) is harmless here; failing the fetch entirely and showing nothing
// would be the worse outcome, so a fetch error falls back to whatever's
// cached rather than clearing it.
let _supportLinksCache = { data: null, at: 0 };
const SUPPORT_LINKS_TTL_MS = 6 * 60 * 60 * 1000;
async function fetchSupportLinks() {
  const now = Date.now();
  if (_supportLinksCache.data && (now - _supportLinksCache.at) < SUPPORT_LINKS_TTL_MS) {
    return _supportLinksCache.data;
  }
  const serverUrl = resolveUpdateServerUrl();
  if (!serverUrl) return _supportLinksCache.data || { stripeUrl: '', paypalUrl: '' };
  try {
    const res = await fetchWithTimeout(serverUrl + '/api/v1/support-links', { timeoutMs: 8000 });
    const parsed = await res.json();
    _supportLinksCache = { data: parsed, at: now };
    return parsed;
  } catch {
    return _supportLinksCache.data || { stripeUrl: '', paypalUrl: '' };
  }
}
const UPDATE_TMP   = path.join(__dirname, '.update-tmp');     // staging for the uploaded zip
// Two backup pools, replacing the old single .update-backup folder:
// - ROLLING: a snapshot taken before every update, newest 10 kept — lets a
//   person roll back further than just "the one before this," not just
//   auto-rollback on a failed boot.
// - MONTHLY: a snapshot of the newly-installed code, taken only for the
//   first STABLE release applied in a given calendar month (kept
//   indefinitely) — a long beta cycle can span multiple months without
//   ever producing one, which is intentional; betas aren't meant to be a
//   durable historical marker the way a stable release is.
// Folder names are `<sortable-timestamp>__v<version>` (rolling) or
// `<YYYY-MM>__v<version>` (monthly) — the timestamp/month prefix is what
// pruning and "which is newest" sort on; the version suffix is only for a
// human reading the folder listing.
const UPDATE_BACKUPS_ROLLING_DIR = path.join(__dirname, '.update-backups-rolling');
const UPDATE_BACKUPS_MONTHLY_DIR = path.join(__dirname, '.update-backups-monthly');
const ROLLING_BACKUP_LIMIT = 10;
const PENDING_FLAG = path.join(__dirname, '.update-pending'); // exists between swap and successful boot
const RESTORE_SAFETY_BACKUP = dataPath('.pre-restore-backup'); // snapshot of data just before a Restore Backup, same "back up before swap" idea as the code backups above, just for data instead of code — kept with the data (DATA_DIR) since data-restore runs even where code self-update doesn't (e.g. containers)
// Same file list every code backup/restore/swap operates on — server.js,
// the whole public/ tree (app.html, display.html, assets), package.json,
// etc. Centralized here (previously redeclared inline inside
// installFromZip) so the auto-rollback guard, the manual restore endpoint,
// and the zip-download endpoint below all agree on exactly what "the code"
// means, rather than each maintaining their own copy that could drift.
// 'src' is where server.js's code is being split out into modules. It is listed HERE, ahead of any code living in it, on purpose: an
// update is applied by the OLD version's code, which only copies the items in ITS list. A release that needs src/ but follows one whose list
// lacks 'src' would install server.js without its modules and fail to boot (the rollback guard would then undo it, leaving that device stuck on
// the old version). So this entry must be in a release that every device has installed BEFORE the first release that contains src/.
// Items that are not in the update zip are skipped by every loop below, so listing it while src/ does not exist yet changes nothing.
const UPDATE_CODE_ITEMS = ['server.js', 'templates.js', 'tv-control.js', 'mqtt-bridge.js', 'src', 'public', 'package.json', 'scripts',
                   'install.sh', 'setup-remote-access.sh', 'hide-cursor.sh', 'README.md', 'BETA_CHECKLIST.md',
                   'LICENSE']; // legal terms — unlike CHANGELOG.md/HANDOFF.md (dev-facing docs, no
                               // stakes either way), an installed device should actually receive
                               // updated license terms, not keep whatever it shipped with forever.
// Resolves the Windows zip tool: System32\tar.exe, which is bsdtar
// (libarchive) — it both reads AND writes .zip. Resolved by its explicit
// System32 path on purpose: a bare `tar` on PATH can be GNU tar (Git for
// Windows, MSYS2, Cygwin all ship one), which cannot handle a zip at all.
// Falls back to bare `tar` only if the System32 copy isn't there
// (pre-1803 Windows, a stripped image).
function winTarBin() {
  const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sysTar) ? sysTar : 'tar';
}
// Cross-platform zip extraction, used by installFromZip() below. Raspberry Pi
// OS always has the `unzip` binary; Windows never does, but bsdtar reads
// .zip natively — `tar -xf archive.zip -C dest` is the direct equivalent of
// `unzip -o -q archive.zip -d dest`. Throws on failure either way, so the
// caller's existing try/catch around it still does its job.
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (IS_WIN) {
    execFileSync(winTarBin(), ['-xf', zipPath, '-C', destDir], { timeout: 120000 });
  } else {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { timeout: 120000 });
  }
}
// Cross-platform zip CREATION — counterpart to extractZip(). `entry` is a
// path relative to `cwd`, archived recursively (a folder, matching
// `zip -r`'s behaviour). Pi: the `zip` binary. Windows: bsdtar with `-a`,
// which picks the zip container from the .zip extension on `zipPath`.
function makeZip(zipPath, cwd, entry) {
  if (IS_WIN) {
    execFileSync(winTarBin(), ['-a', '-cf', zipPath, entry], { cwd, timeout: 120000 });
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, entry], { cwd, timeout: 120000 });
  }
}
// Throws a clear, actionable error if this platform's zip-creation tool
// isn't available — replaces the inline `which zip` prechecks the zip-
// building routes/functions used to each carry their own copy of.
function assertZipToolAvailable() {
  if (IS_WIN) {
    try { execFileSync(winTarBin(), ['--version'], { timeout: 5000 }); }
    catch { throw new Error('No zip tool found — this Windows build needs tar.exe in System32 (present on Windows 10 1803+ and Windows 11).'); }
    return;
  }
  try { execFileSync('which', ['zip'], { timeout: 5000 }); }
  catch { throw new Error('The "zip" command isn\'t installed on this Pi yet. Run "sudo apt-get install -y zip" once (or re-run install.sh), then try again.'); }
}
// Copies the CURRENT contents of every UPDATE_CODE_ITEMS entry into destDir
// — used for both the rolling backup (current/pre-update code, for
// rollback) and the monthly backup (newly-installed code, for history).
// Best-effort per item, matching the original inline version this replaced
// — one unreadable file shouldn't abort backing up everything else.
function backupCurrentCodeInto(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of UPDATE_CODE_ITEMS) {
    const from = path.join(__dirname, name);
    if (fs.existsSync(from)) {
      try { fs.cpSync(from, path.join(destDir, name), { recursive: true }); } catch {}
    }
  }
}
// Folder names sort correctly as plain strings (ISO-ish timestamp prefix),
// so "oldest first" is just an alphabetical sort — no need to parse dates
// back out of the folder name.
function pruneRollingBackups() {
  if (!fs.existsSync(UPDATE_BACKUPS_ROLLING_DIR)) return;
  const entries = fs.readdirSync(UPDATE_BACKUPS_ROLLING_DIR).sort();
  const excess = entries.length - ROLLING_BACKUP_LIMIT;
  for (let i = 0; i < excess; i++) {
    try { fs.rmSync(path.join(UPDATE_BACKUPS_ROLLING_DIR, entries[i]), { recursive: true, force: true }); } catch {}
  }
}
const backupRestoreUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(UPDATE_TMP, { recursive: true }); cb(null, UPDATE_TMP); },
    filename: (req, file, cb) => cb(null, 'restore.zip'),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — years of photos can add up
  fileFilter: (req, file, cb) => {
    const ok = /zip/.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.zip');
    cb(null, !!ok);
  },
});
const updateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(UPDATE_TMP, { recursive: true }); cb(null, UPDATE_TMP); },
    filename: (req, file, cb) => cb(null, 'upload.zip'),
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB — plenty for the code bundle
  fileFilter: (req, file, cb) => {
    const ok = /zip/.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.zip');
    cb(null, !!ok);
  }
});

// Guided central-server install: the server files are dropped next to the app (a
// sibling dir the same user owns, so no root needed). The privileged steps
// (systemd, Funnel) are returned as a copy-paste block for the operator to run.
const SERVER_INSTALL_DIR = path.resolve(__dirname, '..', 'piazzahq-server');
const serverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(UPDATE_TMP, { recursive: true }); cb(null, UPDATE_TMP); },
    filename: (req, file, cb) => cb(null, 'server-upload.zip'),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /zip/.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.zip');
    cb(null, !!ok);
  }
});

// ── Remote access: household login gate (Phase 0) ────────────────────────────
// Prerequisite for exposing this app on a public URL (Cloudflare tunnel, see
// the remote-access spec). Today's auth (the App PIN, x-session-token header)
// assumes the network is trusted; a public URL needs a real login. Design:
//
//  * Opt-in and inert by default: the gate only exists once a "remote
//    password" has been set (remote_auth table). No password = nothing here
//    changes anything for anyone, including requests that look remote.
//  * It only gates requests that LOOK remote: a non-private source address,
//    or any reverse-proxy header (cloudflared always adds cf-connecting-ip /
//    x-forwarded-for). LAN, loopback (the kiosk) and Tailscale (100.64/10)
//    sources pass straight through, exactly as before. A header can only make
//    a request look MORE remote, never less, so spoofing it just adds a login.
//  * A remote password is a separate credential from the App PIN (a 4-digit
//    PIN is far too weak for the open internet). A valid remote session
//    satisfies the PIN check too, so remote users log in once, not twice.
//  * Session cookie (HttpOnly, SameSite=Lax, Secure over https), 30 days,
//    server-side table so it is revocable; only a sha256 of the token is
//    stored. Password: scrypt with a per-password salt, async so a login
//    attempt never blocks the event loop.
//  * Even WITH a valid remote session, some things stay LAN-only: camera
//    media (also off the tunnel for Cloudflare's ToS), code updates/installs,
//    backups (a full DB download), and the kiosk-exit button.
//  * Per-device on purpose (LOCAL_ONLY): credentials and sessions never sync
//    to mirrors.
const REMOTE_COOKIE = 'phq_remote';
const REMOTE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REMOTE_PW_MIN = 10;
const REMOTE_PW_MAX = 128;
const REMOTE_PROXY_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'true-client-ip'];

function stripV4Mapped(addr) { return String(addr || '').replace(/^::ffff:/i, ''); }
function isPrivateAddress(addr) {
  const a = stripV4Mapped(addr).toLowerCase();
  if (a === '::1' || a === 'localhost') return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const o1 = +m[1], o2 = +m[2];
    return o1 === 127 || o1 === 10 ||
      (o1 === 172 && o2 >= 16 && o2 <= 31) ||
      (o1 === 192 && o2 === 168) ||
      (o1 === 169 && o2 === 254) ||   // link-local
      (o1 === 100 && o2 >= 64 && o2 <= 127); // CGNAT range Tailscale uses
  }
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true;     // fc00::/7 unique-local (incl. Tailscale's fd7a:…)
  if (/^fe[89ab][0-9a-f]:/.test(a)) return true;     // fe80::/10 link-local
  return false;
}
function hasProxyHeaders(req) { return REMOTE_PROXY_HEADERS.some((h) => req.headers[h] !== undefined); }
function requestIsRemote(req) { return !isPrivateAddress(req.socket.remoteAddress) || hasProxyHeaders(req) || requestHostIsTunnel(req); }
// The kiosk browser on the device itself (and a plain `curl localhost`): a
// loopback source with no proxy headers. Never asked to log in, even when
// "always require" is on for the rest of the LAN.
function requestIsDirectLoopback(req) {
  const a = stripV4Mapped(req.socket.remoteAddress);
  return (a === '::1' || /^127\./.test(a)) && !hasProxyHeaders(req);
}
function remoteClientIp(req) {
  const sock = stripV4Mapped(req.socket.remoteAddress);
  // Forwarding headers are only believable when the connection came from a
  // proxy on this box or network (cloudflared runs on the device). A connection
  // straight from a public address can put anything it likes in them, which
  // would let a guesser rotate the header to dodge the per-address lockout.
  if (!isPrivateAddress(sock)) return sock.slice(0, 64);
  return String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || sock || '').trim().slice(0, 64);
}

// Cached "is a remote password set" so the gate costs nothing on every static
// request when the feature is unused.
let _remoteAuthConfigured = null;
function remoteAuthConfigured() {
  if (_remoteAuthConfigured === null) {
    try { _remoteAuthConfigured = !!db.prepare(`SELECT 1 FROM remote_auth WHERE id = 1`).get(); }
    catch { _remoteAuthConfigured = false; }
  }
  return _remoteAuthConfigured;
}
function remoteAuthHash() {
  const row = db.prepare(`SELECT password_hash FROM remote_auth WHERE id = 1`).get();
  return row ? row.password_hash : null;
}

function remoteGateEnabled(req) {
  if (IS_DEMO) return false;               // the demo is deliberately open
  if (!remoteAuthConfigured()) return false;
  if (requestIsRemote(req)) return true;
  // Optional stricter mode: require the login from LAN devices too (not from
  // the kiosk on the box itself).
  return getSetting('remote_access_require_auth') === '1' && !requestIsDirectLoopback(req);
}

const scryptAsync = (pw, salt, len, opts) => new Promise((resolve, reject) => crypto.scrypt(pw, salt, len, opts, (e, k) => e ? reject(e) : resolve(k)));
async function hashRemotePassword(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = await scryptAsync(pw, salt, 64, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyRemotePassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB, keyB] = String(stored || '').split('$');
    if (alg !== 'scrypt') return false;
    const key = Buffer.from(keyB, 'base64');
    const test = await scryptAsync(pw, Buffer.from(saltB, 'base64'), key.length, { N: +N, r: +r, p: +p });
    return test.length === key.length && crypto.timingSafeEqual(test, key);
  } catch { return false; }
}

// Same attempt/window/lockout shape as the PIN login limiter, as a factory so
// remote logins get their own buckets (a flood of remote guesses must not lock
// the family out of the PIN screen on the couch, or vice versa).
function makeRateLimiter({ maxAttempts, windowMs, lockoutMs }) {
  const buckets = new Map();
  return {
    check(key) {
      const now = Date.now();
      if (buckets.size > 2000) for (const [k, v] of buckets) if (now - v.firstAttempt > windowMs && now >= v.lockedUntil) buckets.delete(k);
      const e = buckets.get(key);
      if (e && e.lockedUntil && now < e.lockedUntil) return { allowed: false, retryAfterMs: e.lockedUntil - now };
      if (!e || now - e.firstAttempt > windowMs) { buckets.set(key, { count: 1, firstAttempt: now, lockedUntil: 0 }); return { allowed: true }; }
      e.count++;
      if (e.count > maxAttempts) { e.lockedUntil = now + lockoutMs; return { allowed: false, retryAfterMs: lockoutMs }; }
      return { allowed: true };
    },
    reset(key) { buckets.delete(key); },
  };
}
const remoteLoginLimiter = makeRateLimiter({ maxAttempts: 5, windowMs: 10 * 60 * 1000, lockoutMs: 15 * 60 * 1000 });
// Backstop against a guessing run spread over many source addresses.
const remoteGlobalLimiter = makeRateLimiter({ maxAttempts: 60, windowMs: 60 * 60 * 1000, lockoutMs: 5 * 60 * 1000 });

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}
function requestIsHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https' ||
    String(req.headers['cf-visitor'] || '').includes('https');
}
function setRemoteCookie(req, res, token, maxAgeMs) {
  const parts = [`${REMOTE_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (requestIsHttps(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
function createRemoteSession(req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare(`DELETE FROM remote_sessions WHERE expires_at < ?`).run(now);
  db.prepare(`INSERT INTO remote_sessions (id, created_at, expires_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sha256hex(token), now, now + REMOTE_SESSION_TTL_MS, now, remoteClientIp(req), String(req.headers['user-agent'] || '').slice(0, 200));
  return token;
}
function findRemoteSession(req) {
  const tok = readCookie(req, REMOTE_COOKIE);
  if (!tok || tok.length > 200) return null;
  const id = sha256hex(tok);
  const now = Date.now();
  const row = db.prepare(`SELECT id, last_seen FROM remote_sessions WHERE id = ? AND expires_at > ?`).get(id, now);
  if (row && now - row.last_seen > 5 * 60 * 1000) {
    db.prepare(`UPDATE remote_sessions SET last_seen = ? WHERE id = ?`).run(now, id);
  }
  return row || null;
}

// Paths that stay unavailable from a remote origin even with a valid session.
// What a signed-in REMOTE session may not read or change: stored credentials. Reads come back with the
// value replaced by dots (so the app still knows "something is set"); a dots value sent back is never
// written; and credential settings cannot be written remotely at all - manage those at home.
const REMOTE_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022';
const REMOTE_SECRET_KEY_RE = /(pass(word|wd)?|token|secret|hmac|api[_-]?key|_key$|^key$|^app_pin|_pin$|pin_previous|credential|private)/i;
function remoteMaskString(v) {
  return v
    .replace(/^([a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+):[^\/\s@]+@/i, '$1:' + REMOTE_MASK + '@')                                  // rtsp://user:PASSWORD@host
    .replace(/([?&](?:token|key|secret|pass(?:word)?|auth|sig|signature|apikey|api_key|access_token)=)[^&#\s]+/ig, '$1' + REMOTE_MASK);   // ...?token=SECRET
}
function remoteMaskDeep(v, key, flatSettings, depth = 0) {
  if (depth > 8) return v;
  if (typeof v === 'string') {
    if (v && key && (REMOTE_SECRET_KEY_RE.test(key) || (flatSettings && SENSITIVE_SETTING_RE.test(key)))) return REMOTE_MASK;
    return remoteMaskString(v);
  }
  if (Array.isArray(v)) return v.map((x) => remoteMaskDeep(x, key, flatSettings, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = remoteMaskDeep(x, k, flatSettings, depth + 1);
    return o;
  }
  return v;
}
function remoteHardenIo(req, res) {
  const p = req.path.toLowerCase().replace(/\/+$/, '');
  const origJson = res.json.bind(res);
  res.json = (body) => origJson(remoteMaskDeep(body, '', p === '/api/settings'));
  const b = req.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    for (const k of Object.keys(b)) {
      if (typeof b[k] === 'string' && b[k].includes(REMOTE_MASK)) delete b[k];                       // never write the placeholder over a real value
      else if (p === '/api/settings' && req.method !== 'GET' && SENSITIVE_SETTING_RE.test(k)) delete b[k];   // no credential changes remotely (incl. the App PIN)
    }
  }
}
// Routes that operate real things in the house (Home Assistant actions, TV power). A remote sign-in may only
// use them when someone at home has switched that on.
function remoteControlPath(req) {
  if (req.method !== 'POST') return false;
  const p = req.path.toLowerCase().replace(/\/+$/, '');
  return p === '/api/ha/call-action' || p === '/api/ha/call-group-action' || p === '/api/mqtt/test' || /^\/api\/screens\/[^/]+\/tv\/[^/]+$/.test(p);
}
function remoteBlockedPath(req) {
  // Express matches routes case-insensitively and ignores a trailing slash, so
  // the check has to as well — otherwise "/API/backup/download/" walks around it.
  // Any HTTP method: none of these has a legitimate remote use.
  const p = req.path.toLowerCase().replace(/\/+$/, '');
  if (/^\/api\/camera\/\d+\/(frame\.jpeg|ws)$/.test(p)) return true;   // camera media stays off the tunnel
  if (p === '/api/remote-access' || p.startsWith('/api/remote-access/')) return true;   // turning the tunnel on/off is a home-network action
  if (p.startsWith('/api/backup/')) return true;
  if (p.startsWith('/api/sync/')) return true;                          // /api/sync/export is the whole database incl. every stored credential (the mirror's feed)
  if (p.startsWith('/api/voice-token/') || p.startsWith('/api/automation-token/')) return true;   // minting a new control credential
  if (p === '/api/license-devices' || p.startsWith('/api/license-devices/')) return true;          // listing / removing this account's devices                        // download = a full copy of the database; restore = overwrite it
  if (['/api/update', '/api/update-from-server', '/api/install-server', '/api/kiosk/exit'].includes(p)) return true;
  if (/^\/api\/update-backups\/[^/]+\/[^/]+\/(download|restore)$/.test(p)) return true;
  return false;
}
// Endpoints that authenticate THEMSELVES with their own secret (Siri Shortcuts
// token, Alexa request signature, Home Assistant bearer token) and so must
// reach their own check from a remote origin without a browser cookie. Keep in
// sync with the exemptions at the top of requireAuth(); each still fails
// closed there if its own secret is wrong.
function remoteSelfAuthenticatingPath(req) {
  const p = req.path, m = req.method;
  if ((m === 'GET' || m === 'POST') && p === '/api/voice/add-item') return true;
  if (m === 'POST' && p === '/api/alexa') return true;
  if (/^Bearer /.test(req.headers.authorization || '') && (
    (m === 'POST' && (/^\/api\/screens\/[^/]+\/tv\/[^/]+$/.test(p) || /^\/api\/saved-layouts\/[^/]+\/apply$/.test(p))) ||
    (m === 'GET' && /^\/api\/automation\/(screens|displays|saved-layouts)$/.test(p)))) return true;
  return false;
}

function safeNextPath(n) {
  n = String(n || '');
  return /^\/(?!\/)[^\\\r\n]*$/.test(n) && n.length < 500 && !n.startsWith('/login') ? n : '/app';
}
function sendRemoteLoginPage(req, res) {
  res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Type': 'text/html; charset=utf-8' });
  const next = safeNextPath(req.query.next);
  if (remoteAuthConfigured() && findRemoteSession(req)) return res.redirect(next);
  const configured = remoteAuthConfigured();
  const rawName = String(getSetting('display_name') || '').replace(/[<>&"]/g, '').trim();
  const name = !rawName || /^home$/i.test(rawName) ? 'Piazza HQ' : rawName;
  res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Sign in</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0e17;color:#e8edf5;font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:20px}
main{width:100%;max-width:360px;text-align:center}
h1{font-size:22px;margin:14px 0 4px;font-weight:600}
p{margin:0 0 22px;color:#8b98b3;font-size:14px}
form{display:flex;flex-direction:column;gap:12px}
input{width:100%;padding:14px;border-radius:10px;border:1px solid #2a3550;background:#141b2b;color:#e8edf5;font-size:16px}
input:focus{outline:2px solid #4a90d9;border-color:#4a90d9}
button{padding:14px;border:0;border-radius:10px;background:#4a90d9;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
#err{min-height:20px;color:#ff8585;font-size:14px}
.lock{font-size:40px}
</style></head><body><main>
<div class="lock" aria-hidden="true">&#128274;</div>
<h1>${name}</h1>
<p>${configured ? 'Enter your household password to continue.' : 'Remote sign-in has not been set up on this device.'}</p>
${configured ? `<form id="f" autocomplete="on">
<input id="pw" type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus>
<button id="go" type="submit">Sign in</button>
<div id="err" role="alert"></div>
</form>` : ''}
</main>
<script>
(function () {
  var f = document.getElementById('f');
  if (!f) return;
  var next = ${JSON.stringify(next).replace(/</g, '\\u003c')};
  var err = document.getElementById('err'), go = document.getElementById('go'), pw = document.getElementById('pw');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    go.disabled = true;
    fetch('/api/remote-auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw.value })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok) { window.location.replace(next); return; }
        err.textContent = (x.j && x.j.error) || 'Sign-in failed.';
        go.disabled = false; pw.select();
      })
      .catch(function () { err.textContent = 'Could not reach the device. Check your connection.'; go.disabled = false; });
  });
})();
</script></body></html>`);
}

// ── Remote sign-in email alerts (optional, off by default) ───────────────────
// Sent through the same mail account the Daily Briefing uses. Modes: off / new (a device we have not seen
// sign in, plus lockouts) / all (every sign-in, plus lockouts). "Device" = a fingerprint of the browser's
// user-agent, so a phone whose address changes on cellular is still the same device. Turning the option
// on can only be done from the home network; sending never blocks or fails a sign-in.
const ALERT_LOCKOUT_GAP_MS = 30 * 60 * 1000;
const _alertLast = new Map();      // fingerprint -> last alert time (all-mode throttle)
let _alertLockoutAt = 0;
function alertMode() { const m = getSetting('remote_alert_mode'); return m === 'new' || m === 'all' ? m : 'off'; }
function uaFingerprint(ua) { return sha256hex(String(ua || '').toLowerCase()).slice(0, 16); }
function knownDevices() { try { const a = JSON.parse(getSetting('remote_known_devices') || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
function rememberDevice(fp) { const a = knownDevices(); if (!a.includes(fp)) { a.push(fp); setSetting('remote_known_devices', JSON.stringify(a.slice(-60))); } }
function describeUserAgent(ua) {
  const u = String(ua || '');
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '';
  const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\/|CriOS/.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' \u00b7 ') || 'Unknown device';
}
function alertSenderReady() { const m = getEmailSettings(); return !!(m.briefing_email_user && m.briefing_email_pass); }
function validAlertEmail(e) { return typeof e === 'string' && e.length <= 200 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e.trim()); }
async function sendRemoteAlertMail({ subject, text }) {
  const to = getSetting('remote_alert_email');
  if (!validAlertEmail(to)) throw new Error('No alert address is set.');
  if (process.env.PIAZZA_MAIL_CAPTURE_DIR) {          // tests: record the message instead of sending it
    if (process.env.PIAZZA_MAIL_CAPTURE_FAIL === '1') throw new Error('simulated mail failure');
    fs.mkdirSync(process.env.PIAZZA_MAIL_CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PIAZZA_MAIL_CAPTURE_DIR, Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.json'), JSON.stringify({ to, subject, text }));
    return;
  }
  const m = getEmailSettings();
  if (!m.briefing_email_user || !m.briefing_email_pass) throw new Error('The sending email account is not set up (Settings \u2192 Daily Briefing).');
  if (!m.briefing_provider) m.briefing_provider = 'gmail';
  await buildMailTransporter(m).sendMail({ from: `"Piazza HQ" <${m.briefing_email_user}>`, to: to.trim(), subject, text });
}
function recordAlertResult(err) {
  if (err) { setSetting('remote_alert_last_error', friendlyMailError(err)); console.error('remote sign-in alert failed:', err.message); }
  else { setSetting('remote_alert_last_error', ''); setSetting('remote_alert_last_sent', String(Date.now())); }
}
const { forLanguage: mailLanguage } = require('./src/i18n-server.js');
const alertT = () => mailLanguage(getSetting('ui_language') || 'en');
function alertWhereLine(req) {
  const ip = remoteClientIp(req), cc = String(req.headers['cf-ipcountry'] || '').toUpperCase().slice(0, 2);
  return `${ip || alertT()('unknown address')}${cc && cc !== 'XX' ? ' (' + cc + ')' : ''}`;
}
const ALERT_FOOTER = 'If this was you, there is nothing to do. If it was not, open Piazza HQ on your home network, go to Settings \u2192 Security \u2192 Remote access login and change the remote password: that signs every remote device out.';
const alertWhen = (T) => (T.english ? new Date().toString() : new Date().toLocaleString(T.locale, { dateStyle: 'full', timeStyle: 'short' }));
function maybeAlertSignIn(req) {
  try {
    const mode = alertMode();
    if (mode === 'off') return;
    const fp = uaFingerprint(req.headers['user-agent']);
    const isNew = !knownDevices().includes(fp);
    if (isNew) rememberDevice(fp);
    if (mode === 'new' && !isNew) return;
    const gap = process.env.PIAZZA_ALERT_THROTTLE_MS !== undefined ? Number(process.env.PIAZZA_ALERT_THROTTLE_MS) : 60 * 1000;
    if (!isNew && Date.now() - (_alertLast.get(fp) || 0) < gap) return;
    _alertLast.set(fp, Date.now());
    const host = getSetting('remote_access_address');
    const T = alertT();
    sendRemoteAlertMail({
      subject: isNew ? T('New device signed in to your Piazza HQ') : T('Sign-in to your Piazza HQ'),
      text: [
        isNew ? T('A device we have not seen before just signed in to your Piazza HQ remotely.') : T('Someone just signed in to your Piazza HQ remotely.'), '',
        '  ' + T('When:') + '   ' + alertWhen(T),
        '  ' + T('Device:') + ' ' + describeUserAgent(req.headers['user-agent']) + (isNew ? '  (' + T('new') + ')' : ''),
        '  ' + T('From:') + '   ' + alertWhereLine(req),
        host ? '  ' + T('Address:') + ' ' + host : '', '', T(ALERT_FOOTER), '',
      ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'),
    }).then(() => recordAlertResult(null), (e) => recordAlertResult(e));
  } catch (e) { console.error('remote sign-in alert:', e.message); }
}
function maybeAlertLockout(req) {
  try {
    if (alertMode() === 'off') return;
    if (Date.now() - _alertLockoutAt < ALERT_LOCKOUT_GAP_MS) return;
    _alertLockoutAt = Date.now();
    const T = alertT();
    sendRemoteAlertMail({
      subject: T('Someone is guessing your Piazza HQ password'),
      text: [T('Someone entered the wrong remote password several times in a row and was locked out. Nothing was opened.'), '',
        '  ' + T('When:') + ' ' + alertWhen(T),
        '  ' + T('From:') + ' ' + alertWhereLine(req),
        '  ' + T('Device:') + ' ' + describeUserAgent(req.headers['user-agent']), '',
        T('They are blocked for a while automatically. If you have shared your address widely or want to be extra careful, you can change the remote password (Settings \u2192 Security \u2192 Remote access login) or give the address back and get a new one.'), ''].join('\n'),
    }).then(() => recordAlertResult(null), (e) => recordAlertResult(e));
  } catch (e) { console.error('remote lockout alert:', e.message); }
}
function alertsStatus() {
  return {
    mode: alertMode(), email: getSetting('remote_alert_email') || '',
    sender_ready: alertSenderReady() || !!process.env.PIAZZA_MAIL_CAPTURE_DIR,
    default_email: (() => { try { const r = getBriefingRecipients(true)[0]; return r ? r.email : ''; } catch { return ''; } })(),
    last_sent: Number(getSetting('remote_alert_last_sent')) || null, last_error: getSetting('remote_alert_last_error') || '',
  };
}

function logRemoteLogin(req, ok) {
  try {
    db.prepare(`INSERT INTO remote_login_events (at, ip, user_agent, ok, country) VALUES (?, ?, ?, ?, ?)`)
      .run(Date.now(), remoteClientIp(req), String(req.headers['user-agent'] || '').slice(0, 200), ok ? 1 : 0, String(req.headers['cf-ipcountry'] || '').slice(0, 4));
    db.prepare(`DELETE FROM remote_login_events WHERE id <= (SELECT MAX(id) FROM remote_login_events) - 200`).run();
  } catch (e) { console.error('remote login log:', e.message); }
}
async function handleRemoteLogin(req, res) {
  if (!remoteAuthConfigured()) return res.status(404).json({ error: 'Remote sign-in has not been set up on this device.' });
  if (!req.is('application/json')) return res.status(415).json({ error: 'Send the password as JSON.' });
  const ip = remoteClientIp(req);
  const g = remoteGlobalLimiter.check('global');
  const rl = remoteLoginLimiter.check(ip);
  if (!g.allowed || !rl.allowed) {
    const ms = Math.max(g.allowed ? 0 : g.retryAfterMs, rl.allowed ? 0 : rl.retryAfterMs);
    const minutes = Math.ceil(ms / 60000);
    maybeAlertLockout(req);
    res.set('Retry-After', String(Math.ceil(ms / 1000)));
    return res.status(429).json({ error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
  }
  const pw = req.body && req.body.password;
  const ok = typeof pw === 'string' && pw.length > 0 && pw.length <= REMOTE_PW_MAX && await verifyRemotePassword(pw, remoteAuthHash());
  logRemoteLogin(req, ok);
  if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
  remoteLoginLimiter.reset(ip);
  maybeAlertSignIn(req);
  setRemoteCookie(req, res, createRemoteSession(req), REMOTE_SESSION_TTL_MS);
  res.json({ ok: true });
}
function handleRemoteLogout(req, res) {
  const tok = readCookie(req, REMOTE_COOKIE);
  if (tok) { try { db.prepare(`DELETE FROM remote_sessions WHERE id = ?`).run(sha256hex(tok)); } catch {} }
  setRemoteCookie(req, res, '', 0);
  res.json({ ok: true });
}
function handleRemoteStatus(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({
    configured: remoteAuthConfigured(),
    remote: requestIsRemote(req),
    authenticated: remoteAuthConfigured() ? !!findRemoteSession(req) : false,
    always_require: getSetting('remote_access_require_auth') === '1',
  });
}

function mirrorKeyMatches(req) {
  const presented = req.headers['x-mirror-license'];
  const mine = getSetting('update_license_key');
  if (typeof presented !== 'string' || !presented || !mine) return false;
  const a = Buffer.from(presented), b = Buffer.from(String(mine));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function remoteGate(req, res, next) {
  const p = req.path;
  try {
    // Reached through this device's own tunnel address but no remote password exists (it was
    // removed, or a restored backup carried the address): the login gate below would be inert,
    // so answer nothing rather than the whole app.
    if (requestHostIsTunnel(req) && !remoteAuthConfigured()) {
      return res.status(503).type('text/plain').send('Remote access is not set up on this device.');
    }
    if (req.method === 'GET' && p === '/login') return sendRemoteLoginPage(req, res);
    if (req.method === 'POST' && p === '/api/remote-auth/login') {
      return handleRemoteLogin(req, res).catch((e) => { console.error('remote login error:', e.message); if (!res.headersSent) res.status(500).json({ error: 'Sign-in failed.' }); });
    }
    if (req.method === 'POST' && p === '/api/remote-auth/logout') return handleRemoteLogout(req, res);
    if (req.method === 'GET' && p === '/api/remote-auth/status') return handleRemoteStatus(req, res);
    if (!remoteGateEnabled(req)) return next();
    // A mirror of this household syncing with us has no human to type a password. It presents the household
    // key it already sends on every host call; on the home network / Tailscale that is enough to get past the
    // "also ask on home Wi-Fi" login (the App PIN still applies as before). Never honoured from the internet.
    if (!requestIsRemote(req) && mirrorKeyMatches(req)) return next();

    if (findRemoteSession(req)) {
      // Only for requests that really come from outside: a home/Tailscale device that signed in
      // because "also ask on home Wi-Fi" is on is still on the home network and keeps these.
      if (requestIsRemote(req) && remoteBlockedPath(req)) return res.status(403).json({ error: 'This is only available on your home network.', code: 'LOCAL_ONLY' });
      if (requestIsRemote(req) && remoteControlPath(req) && getSetting('remote_access_allow_control') !== '1') {
        return res.status(403).json({ error: 'Controlling smart-home devices and TVs from outside is turned off. Turn it on at home in Settings \u2192 Security \u2192 Remote access link.', code: 'REMOTE_CONTROL_OFF' });
      }
      if (requestIsRemote(req)) remoteHardenIo(req, res);
      req.remoteAuthed = true;
      return next();
    }
    if (remoteSelfAuthenticatingPath(req)) return next();
    if (req.method === 'GET' && p === '/api/version') return next(); // liveness / version only
    // Not signed in. Browsers navigating to a page get the login screen;
    // everything else (API calls, assets) gets a 401 the app can act on.
    if ((req.method === 'GET' || req.method === 'HEAD') && !p.startsWith('/api/') && String(req.headers.accept || '').includes('text/html')) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    return res.status(401).json({ error: 'Sign in required.', code: 'REMOTE_AUTH_REQUIRED' });
  } catch (e) {
    console.error('remote gate error:', e.message);
    // Fail closed: if the gate itself breaks, a remote-looking request must not slip through.
    if (requestIsRemote(req)) return res.status(500).json({ error: 'Sign-in check failed.' });
    return next();
  }
}

// ── Middleware ───────────────────────────────────────────────────────────────
// Skips JSON body-parsing for /api/alexa specifically — ask-sdk-express-adapter
// needs to read that request's raw, unparsed body itself to verify Alexa's
// request signature (computed over the exact raw bytes sent); if express.json()
// consumes the stream first, there's nothing left for it to verify against and
// every legitimate Alexa request would fail signature verification, not just
// forged ones. Every other route keeps normal JSON parsing, unaffected.
app.use((req, res, next) => {
  if (req.path === '/api/alexa') return next();
  express.json()(req, res, next);
});
// Remote login gate: must run before express.static and every route below.
app.use(remoteGate);
// Serve uploaded files explicitly from UPLOAD_DIR. When DATA_DIR is unset
// this is the same directory the blanket public/ mount below already covers
// (harmless overlap); when it's set, this is the only thing serving
// "/uploads/...", since those files no longer live under public/.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
// Text files under public/ go out compressed for visitors that accept it (src/static-compress.js); everything else, and anything it declines, is served below as before.
const staticCompress = require('./src/static-compress.js')({ fs, path, zlib, root: path.join(__dirname, 'public') });
app.use(staticCompress.middleware);
app.use(express.static(path.join(__dirname, 'public')));
// Slave read-only guard — must run before any shared-content route (defined below).
// Defined in the multi-device section further down; referenced here by hoisted name.
app.use((req, res, next) => slaveWriteGuard(req, res, next));

// Demo-mode route fence. GETs pass (reads are the whole point of a demo);
// mutating requests under an outbound-capable or destructive prefix are
// refused. Individual functions/intervals get their own IS_DEMO guards too
// (defense in depth) — this just closes the HTTP surface in one place.
if (IS_DEMO) {
  const DEMO_BLOCK_PREFIXES = [
    '/api/ha', '/api/ha-alerts', '/api/todoist', '/api/caldav', '/api/google',
    '/api/handwriting', '/api/briefing-settings', '/api/phone-alerts', '/api/push',
    '/api/photos', '/api/photo-album', '/api/reminders/icon-image', '/api/feeds',
    '/api/update', '/api/update-from-server', '/api/install-server',
    '/api/custom-theme', '/api/backup', '/api/restore',
    '/api/voice-token', '/api/sync', '/api/setup',
    '/api/cameras', // a shared demo instance must not spin up go2rtc against arbitrary RTSP
    '/api/flightmap', '/api/flight-watch', // a shared demo must not poll an outside ADS-B API on a lessee's behalf
  ];
  const demoAllowExact = new Set(['/api/notif-prefs', '/api/settings']); // local-only writes, harmless
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (demoAllowExact.has(req.path)) return next();
    if (DEMO_BLOCK_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) return demoBlock(res);
    next();
  });
}

// ── Live push (Server-Sent Events) ────────────────────────────────────────────
// Lets the display update instantly when the control app saves changes, instead
// of waiting on its polling interval. One-way: server -> display only.
// Each connection records which display profile it belongs to (?display=kitchen),
// so a layout change on one display doesn't trigger an unnecessary refresh on others.
const sseClients = new Set(); // each entry: { res, displayId }

app.get('/api/live', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('retry: 3000\n\n');

  const display = resolveDisplay(req.query.display);
  // A screen passes its stable device id so the server can target live commands
  // (e.g. "switch to profile X") to this specific screen. Registering here also
  // marks the screen online for the Screens manager.
  const screenId = req.query.screen ? String(req.query.screen) : null;
  if (screenId) {
    const now = Date.now();
    const existing = db.prepare(`SELECT device_id FROM screens WHERE device_id = ?`).get(screenId);
    if (existing) {
      db.prepare(`UPDATE screens SET last_seen = ? WHERE device_id = ?`).run(now, screenId);
    } else {
      db.prepare(`INSERT INTO screens (device_id, name, last_seen) VALUES (?, ?, ?)`).run(screenId, previewScreenName(screenId), now);
    }
    broadcastUpdate('screens'); // tell the app a screen came online / list changed
  }
  const client = { res, displayId: display ? display.id : null, screenId };
  sseClients.add(client);

  // TCP keepalive so the OS itself eventually notices and tears down a
  // connection whose peer vanished without a clean FIN/RST — a phone that
  // drops off Wi-Fi mid-range or roams between APs, the common real-world
  // case. Without this, such a socket can sit open indefinitely with
  // nothing at the OS level ever telling Node it's gone. This bounds that
  // to the kernel's own keepalive timeout (not instant, but finite —
  // "eventually reclaimed" beats "never," which is what the app-level
  // backpressure check just below exists to catch faster anyway).
  try { req.socket.setKeepAlive(true, 15000); } catch {}

  // Heartbeat keeps the connection alive through proxies/timeouts (e.g. Cloudflare
  // Tunnel, Tailscale). Each tick also refreshes the screen's last_seen: as long as
  // the connection is alive, the write succeeds and the screen stays "online". This
  // fixes screens showing offline despite a working connection — previously
  // last_seen was only set once at connect time and then went stale.
  //
  // Real leak, found live: `sseClients` only ever shrank via req.on('close')
  // below — a write failure here cleared this OWN interval (stopping the
  // pings) but never removed `client` from the Set, so a connection that
  // died in a way 'close' never fired for (see the keepalive comment above)
  // stayed in `sseClients` forever, each one holding an open socket/fd.
  // Every device with the app or display open keeps one of these connections
  // going indefinitely, so on a household with several phones roaming in and
  // out of range over "a while," this was a slow, unbounded leak toward
  // eventually exhausting the process's file descriptors — at which point
  // NEW incoming connections (the web interface, from any device) start
  // failing, while everything already running (including this server's own
  // short-lived outbound update-check requests) keeps working, since those
  // don't need the exhausted capacity. A reboot "fixing it" (fresh process,
  // empty Set) was the tell.
  const heartbeat = setInterval(() => {
    try {
      // res.write() returns false when Node's own send buffer is backed up
      // — for a 12-byte ping written every 25s, that only happens when the
      // OS isn't actually draining data to the peer at all (silence, not an
      // error) — exactly the "gone dark, no FIN/RST" case the keepalive
      // above is also aimed at, caught here much faster than waiting on the
      // kernel's own keepalive timeout. One slow tick is normal network
      // jitter; three in a row (~75s of confirmed non-delivery) means
      // nobody's actually receiving these anymore.
      const delivered = res.write(': ping\n\n');
      client.stalledTicks = delivered ? 0 : (client.stalledTicks || 0) + 1;
      if (screenId) {
        db.prepare(`UPDATE screens SET last_seen = ? WHERE device_id = ?`).run(Date.now(), screenId);
      }
      if (client.stalledTicks >= 3) {
        clearInterval(heartbeat);
        sseClients.delete(client);
        try { req.socket.destroy(); } catch {} // force 'close' to fire so nothing else is left dangling
      }
    } catch {
      // The clean, fast path: a write that throws outright (ECONNRESET,
      // etc.) — fixed to actually remove `client` from sseClients now,
      // not just stop pinging it (see this block's own comment above).
      clearInterval(heartbeat);
      sseClients.delete(client);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
    if (client.screenId) broadcastUpdate('screens'); // a screen went offline
  });
});

// Broadcasts a change notification to connected displays.
// `topic` tells the display *what* changed so it only re-fetches what's needed:
// 'events' | 'settings' | 'photos' | 'photo-settings' | 'layout' | 'tasks' | 'feeds' | 'displays'
// `displayId` (optional) scopes the broadcast to just that display — used for 'layout'
// changes, since those are display-specific. Omit it for global changes (events, settings, etc.)
// that every display should refresh on.
// Bumped whenever shared content changes on a host, so slaves can detect changes
// cheaply (a tiny ping) and pull immediately instead of waiting for their timer.
let HOST_DATA_VERSION = Date.now();
// When the host is actively being edited (e.g. dragging widgets in the Layout tab),
// we set this to a near-future timestamp. While "now" is before it, slaves poll fast
// so edits appear in near-real-time; once it lapses, they relax to the normal cadence.
let HOST_EDITING_UNTIL = 0;
function markHostEditing(ms = 8000) { HOST_EDITING_UNTIL = Date.now() + ms; }
// 'screens' is included so that assigning a profile to a remote slave bumps the
// version — the slave's watcher then re-syncs (and re-registers, learning its new
// assigned profile) within seconds instead of waiting for the slow timer.
const SHARED_TOPICS = new Set(['events', 'photos', 'settings', 'photo-settings', 'feeds', 'displays', 'layout', 'screens', 'chores', 'todos', 'shopping', 'favorites', 'reminders', 'profiles', 'messages', 'cameras', 'meals', 'flight_watch']);

function broadcastUpdate(topic, displayId) {
  if (SHARED_TOPICS.has(topic)) HOST_DATA_VERSION = Date.now();
  const payload = `data: ${JSON.stringify({ topic, at: Date.now() })}\n\n`;
  for (const client of sseClients) {
    if (displayId !== undefined && client.displayId !== displayId) continue;
    try { client.res.write(payload); } catch { sseClients.delete(client); }
  }
}

// Sends a direct command to one specific screen (by its device id) over SSE.
// Used to tell a screen to switch to a different display profile live. Returns
// true if at least one connected client for that screen received it.
function sendScreenCommand(screenId, command, data = {}) {
  const payload = `data: ${JSON.stringify({ topic: 'screen-command', screenId, command, ...data, at: Date.now() })}\n\n`;
  let delivered = false;
  for (const client of sseClients) {
    if (client.screenId !== screenId) continue;
    try { client.res.write(payload); delivered = true; } catch { sseClients.delete(client); }
  }
  return delivered;
}

// A screen is considered "online" if seen within this window.
const SCREEN_ONLINE_MS = 95 * 1000; // tolerant of a missed 30s check-in / 25s heartbeat

// ── PIN Auth ─────────────────────────────────────────────────────────────────
// In-memory session store. Maps token -> expiresAt (a timestamp, not a
// setTimeout delay) — the real bug this fixes: Node's setTimeout takes a
// 32-bit signed integer, max ~24.8 days. A 30-day delay (2,592,000,000ms)
// silently overflows that and gets clamped to 1ms instead of erroring —
// confirmed live via a real TimeoutOverflowWarning in this app's own logs,
// meaning every session token was actually expiring 1 millisecond after
// being issued, not 30 days later. Storing an expiry TIMESTAMP and checking
// it at validation time (plus an hourly sweep to actually remove expired
// entries, so this Map doesn't grow forever) avoids the 32-bit setTimeout
// limit entirely, rather than just picking a smaller number that happens to
// fit — the correct pattern for any expiry longer than ~24 days in Node.
const SESSIONS = new Map();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Hydrate from disk on boot — this is the actual fix: previously SESSIONS
// started empty on every restart (including every self-update), silently
// logging everyone out. Prune already-expired rows in the same pass rather
// than loading them just to have the hourly sweep remove them a moment
// later. Wrapped defensively: a fresh/corrupt sessions table shouldn't ever
// block boot over what's ultimately a convenience feature (staying logged
// in), the same reasoning as every other best-effort block in this file.
try {
  const now = Date.now();
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(now);
  for (const row of db.prepare(`SELECT token, expires_at FROM sessions`).all()) {
    SESSIONS.set(row.token, row.expires_at);
  }
} catch (e) { console.error('Session restore failed (starting with no sessions):', e.message); }
const sessionUpsertStmt = db.prepare(`INSERT INTO sessions (token, expires_at) VALUES (?, ?)
  ON CONFLICT(token) DO UPDATE SET expires_at = excluded.expires_at`);
const sessionDeleteStmt = db.prepare(`DELETE FROM sessions WHERE token = ?`);
setInterval(() => {
  const now = Date.now();
  for (const [token, expiresAt] of SESSIONS) {
    if (now > expiresAt) SESSIONS.delete(token);
  }
  // Mirror the sweep to disk too, so the table doesn't grow stale rows
  // forever between restarts (same reasoning as the in-memory sweep this
  // was already doing).
  try { db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(now); } catch {}
}, 60 * 60 * 1000); // hourly sweep — expired tokens already fail validation immediately regardless (see validToken()), this just reclaims the memory
const SESSION_SECRET = (() => {
  // Persist a secret across restarts so tokens survive a restart
  const secretFile = dataPath('.session-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, s);
  return s;
})();

// A stable per-DEVICE id, persisted on the Pi itself (not in the browser). This is
// the canonical identity of this physical screen. Persisting it server-side means
// it survives browser-cache wipes, kiosk URL changes (localhost vs 127.0.0.1 vs
// LAN IP), and app updates — fixing the bug where an update made the Pi register as
// a brand-new screen. The display adopts this id instead of minting its own.
const DEVICE_ID = (() => {
  const idFile = dataPath('.device-id');
  // Read existing id if present.
  try {
    if (fs.existsSync(idFile)) {
      const v = fs.readFileSync(idFile, 'utf8').trim();
      if (v) return v;
    }
  } catch (e) {
    console.error('DEVICE_ID: could not read .device-id:', e.message);
  }
  // Generate a new one and persist it. Verify the write actually landed — a silent
  // write failure here is what would cause a *new* id (and thus a "new screen") on
  // every restart/update, so we confirm and warn loudly if it didn't stick.
  const id = 'scr_' + crypto.randomBytes(6).toString('hex');
  try {
    fs.writeFileSync(idFile, id);
    const back = fs.readFileSync(idFile, 'utf8').trim();
    if (back !== id) {
      console.error('DEVICE_ID: .device-id did not persist correctly — screens may duplicate on restart.');
    } else {
      console.log('DEVICE_ID: created new stable device id', id);
    }
  } catch (e) {
    console.error('DEVICE_ID: FAILED to write .device-id (' + e.message + '). '
      + 'This will cause a new screen to appear on each restart until fixed — check folder permissions.');
  }
  return id;
})();

function makeToken() {
  const token = crypto.randomBytes(24).toString('hex');
  const sig    = crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
  return `${token}.${sig}`;
}

function validToken(t) {
  if (!t) return false;
  const [token, sig] = t.split('.');
  if (!token || !sig) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return false;
  const expiresAt = SESSIONS.get(token);
  return !!expiresAt && Date.now() < expiresAt;
}

function getPin() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'app_pin'`).get();
  return row?.value || null; // null = no PIN set, open access
}

// Simple in-memory rate limiter for PIN login attempts — same shape as
// piazzahq-server's own admin-login limiter (checkRateLimit there), ported
// here since this endpoint had none at all: a short numeric PIN with no
// lockout is guessable quickly by anything scripted. In-memory is fine for
// the same reason it's fine on the central server: single long-running
// process, a restart clearing the slate is an acceptable tradeoff.
const loginRateLimitBuckets = new Map();
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginRateLimitBuckets.get(ip);
  const { maxAttempts, windowMs, lockoutMs } = { maxAttempts: 5, windowMs: 10 * 60 * 1000, lockoutMs: 15 * 60 * 1000 };
  if (entry && entry.lockedUntil && now < entry.lockedUntil) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now };
  }
  if (!entry || now - entry.firstAttempt > windowMs) {
    loginRateLimitBuckets.set(ip, { count: 1, firstAttempt: now, lockedUntil: 0 });
    return { allowed: true };
  }
  entry.count++;
  if (entry.count > maxAttempts) {
    entry.lockedUntil = now + lockoutMs;
    return { allowed: false, retryAfterMs: lockoutMs };
  }
  return { allowed: true };
}
function resetLoginRateLimit(ip) { loginRateLimitBuckets.delete(ip); }

// Routes that stay auth-gated even when no PIN is configured at all — unlike
// everything else /api, which is intentionally open with no PIN set (this is
// a single-household device; that's a reasonable default for most of it).
// /api/update (the raw arbitrary-zip-upload-and-install endpoint) used to be
// listed here too, on the reasoning that code execution is a different risk
// class than a settings change. In practice that made it the ONE thing on
// the device stricter than everything else once no PIN was set — and it
// directly broke host-to-mirror instant push updates (which POST to this
// exact endpoint) even from the device's own legitimate host, since a
// mirror with no PIN configured (which now correctly follows the host's own
// PIN state — see the sync fix a few versions back) refused ALL incoming
// pushes unconditionally, correct credentials or not. Removed at the
// person's explicit request after this tradeoff was laid out clearly: with
// no PIN set, this endpoint is now reachable by anyone on the network, same
// as every other endpoint already is once no PIN exists — not a new
// exposure, just no longer a stricter special case than the rest of the app.
const ALWAYS_AUTH_ROUTES = [
  { method: 'POST', path: '/api/install-server' },
];

// Constant-time bearer-token compare — shared by every automation entry
// point that authenticates itself this way (voice/add-item's own inline
// version predates this and is left as-is; this is for anything added
// after it, so the pattern isn't hand-copied a third time). Rejects a
// length mismatch without a fast exit, same reasoning as voice/add-item's
// own comment on this: a wrong-length guess shouldn't measurably return
// faster than a right-length one, even though the token's entropy already
// makes real timing-based brute force impractical.
function timingSafeTokenMatch(presented, configured) {
  const presentedBuf = Buffer.from(presented);
  const configuredBuf = Buffer.from(configured);
  if (presentedBuf.length !== configuredBuf.length) {
    crypto.timingSafeEqual(configuredBuf, configuredBuf); // dummy same-length compare
    return false;
  }
  return crypto.timingSafeEqual(presentedBuf, configuredBuf);
}

// Diagnostic for "the PIN screen appeared": one line per PIN-related event that a person could see as a PIN
// prompt - a 401 from requireAuth, a PIN login, the auth check from a remote/tunnel request. Never logs a
// PIN or a token. 401s are throttled so a page that fires many requests writes one line.
let _authDiagAt = 0;
function authDiag(req, what, always) {
  try {
    if (!always) { if (Date.now() - _authDiagAt < 5000) return; _authDiagAt = Date.now(); }
    console.warn(`[auth] ${what} ${req.method} ${String(req.originalUrl || '').split('?')[0]} pin_set=${!!getPin()} remote=${requestIsRemote(req)} remote_session=${!!req.remoteAuthed} host=${String(req.headers.host || '').slice(0, 60)}`);
  } catch {}
}
// Middleware: protect /app and /api/* (but NOT / display or /api/events GET for display polling)
function requireAuth(req, res, next) {
  // Already proven by the remote login gate (a signed-in remote session) —
  // one login, not the remote password AND the PIN.
  if (req.remoteAuthed) return next();
  const pin = getPin();
  // Real, foundational bug fixed here: this middleware is only ever reached
  // via `app.use('/api', (req,res,next) => { ...; requireAuth(req,res,next); })`
  // — and Express strips the mount prefix from req.path for the ENTIRE
  // duration that middleware layer is executing, including this synchronous
  // nested call. So req.path here has actually been '/settings', not
  // '/api/settings', this whole time — every comparison below
  // (ALWAYS_AUTH_ROUTES, publicRoutes, the voice/Alexa exemptions) was
  // written expecting the full '/api/...' path and has never actually
  // matched anything, on any device that has a PIN set. It stayed
  // completely invisible until now because every one of those checks
  // exists specifically to grant access WITHOUT a valid session token —
  // app.html always sends one once logged in, so its requests never
  // depended on these checks working; only token-less callers (the
  // always-public wall display, and unauthenticated automation like
  // Shortcuts/Alexa) ever exercised this code path, and this is the first
  // time anyone tested display.html itself against a PIN-protected device.
  // req.baseUrl holds exactly the prefix Express stripped ('/api'), so
  // reconstructing the true original path is a one-line fix, used for
  // every comparison in this function from here down.
  const fullPath = req.baseUrl + req.path;
  // Exact match, not startsWith — ALWAYS_AUTH_ROUTES only ever needed to
  // list precise, non-parameterized paths, and prefix matching here was a
  // real bug: '/api/update-from-server' (fetches a specific, already-
  // validated release from the trusted central server — no upload
  // involved) starts with the literal string '/api/update' and was
  // silently inheriting the restriction meant only for the raw manual
  // arbitrary-zip-upload fallback below, a completely different risk
  // profile. publicRoutes elsewhere deliberately still uses prefix
  // matching (for legitimate parameterized sub-paths like
  // /api/todo-lists/:id/items) — this fix is scoped to just this list.
  const isAlwaysAuth = ALWAYS_AUTH_ROUTES.some(r => req.method === r.method && fullPath === r.path);
  if (isAlwaysAuth) {
    if (!pin) {
      return res.status(403).json({ error: 'Set a PIN in Settings before using this — this endpoint stays locked until a PIN exists, even though most of the app is open by default without one.' });
    }
    // The x-host-pin / grace-period checks below are a generic fallback for
    // any always-auth route reached by an unattended server-to-server call
    // rather than an interactive session — not written with any one
    // specific route in mind. (/api/update, the original reason this
    // existed, no longer reaches this code path at all — see
    // ALWAYS_AUTH_ROUTES' own comment for why.)
    const hostPinHeader = req.headers['x-host-pin'];
    if (hostPinHeader !== undefined && hostPinHeader === pin) return next();
    // Grace period: also accept the PIN's value from just before its last
    // change (set, changed, or removed) — see the PUT /api/settings handler
    // for where this gets recorded. Without this, a mirror still on the old
    // value the instant the PIN changes would be permanently locked out of
    // ever catching up: its own stored PIN is also its credential to
    // authenticate the very sync request that would tell it the new value.
    // Requires hostPinHeader to have actually been SENT (checked above,
    // !== undefined) rather than just omitted — every client now always
    // sends this header, even empty, specifically so "omitted entirely"
    // can never be mistaken for "deliberately presenting an empty PIN,"
    // which would otherwise let ANY caller that simply leaves the header
    // off match a household that's never once changed its PIN (leaving
    // app_pin_previous unset and effectively empty).
    if (hostPinHeader !== undefined) {
      const prevRow = db.prepare(`SELECT value FROM settings WHERE key = 'app_pin_previous'`).get();
      if (prevRow && hostPinHeader === prevRow.value) return next();
    }
    const token = req.headers['x-session-token'] || req.query._token;
    if (validToken(token)) return next();
    authDiag(req, '401 AUTH_REQUIRED (always-auth route)');
    return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  }
  // Voice/Shortcuts and Alexa routes authenticate themselves — Shortcuts via
  // its own long-lived bearer token (see /api/voice/add-item below), Alexa
  // via its own request signature (see /api/alexa below) — rather than a PIN
  // session, since neither an automation nor Amazon's servers can do an
  // interactive PIN login. Deliberately narrow: these are the ONLY routes
  // this bypass applies to, and each route still rejects anything that
  // fails its own check, so this isn't "open," just authenticated
  // differently per route.
  // /api/voice/add-item now accepts GET too (a single URL is much simpler
  // for Shortcuts to build than separate Headers/Body panels — see that
  // route's own comment), so both methods need the exemption, not just POST.
  if ((req.method === 'GET' || req.method === 'POST') && fullPath === '/api/voice/add-item') return next();
  if (req.method === 'POST' && fullPath === '/api/alexa') return next();
  // Home Assistant (or any automation) controlling a small, explicit set of
  // device-control routes with its own bearer token — same "authenticates
  // itself instead of a PIN session" idea as Alexa/Shortcuts just above, but
  // these two routes are DUAL-USE (the in-app UI calls them too, under a
  // normal PIN session — Devices tab TV controls, the Layout Switcher
  // widget), so this can't just blindly exempt-and-trust like Alexa does.
  // The token is verified right here: only a VALID one bypasses the PIN. No
  // token, a wrong token, or none generated yet all fall through to the
  // exact same PIN-session logic below as before this existed — zero
  // behavior change for the in-app UI either way.
  const AUTOMATION_CONTROL_ROUTES = [
    { method: 'POST', re: /^\/api\/screens\/[^/]+\/tv\/[^/]+$/ },
    { method: 'POST', re: /^\/api\/saved-layouts\/[^/]+\/apply$/ },
    // Read-only discovery for the same token — lets an external client (the
    // Home Assistant custom integration's config flow, or a curious curl)
    // find valid screen/display/layout ids on its own instead of requiring
    // them typed in by hand, the way the rest_command YAML door still does.
    { method: 'GET', re: /^\/api\/automation\/screens$/ },
    { method: 'GET', re: /^\/api\/automation\/displays$/ },
    { method: 'GET', re: /^\/api\/automation\/saved-layouts$/ },
  ];
  if (AUTOMATION_CONTROL_ROUTES.some(r => req.method === r.method && r.re.test(fullPath))) {
    const configuredToken = getSetting('automation_token');
    const authHeader = req.headers['authorization'] || '';
    const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (configuredToken && presented && timingSafeTokenMatch(presented, configuredToken)) return next();
  }
  if (!pin) return next(); // PIN not configured — open

  // Display page reads these without auth
  const publicRoutes = [
    { method: 'GET', path: '/api/events' },
    { method: 'GET', path: '/api/settings' },
    { method: 'GET', path: '/api/weather' },
    { method: 'GET', path: '/api/photo-settings' },
    { method: 'GET', path: '/api/photos' },
    { method: 'GET', path: '/api/feeds' },
    { method: 'GET', path: '/api/layouts' },
    { method: 'GET', path: '/api/geocode' },
    { method: 'GET', path: '/api/place-search' },
    { method: 'GET', path: '/api/todoist' },
    { method: 'GET', path: '/api/live' },
    { method: 'GET', path: '/api/news' },
    { method: 'GET', path: '/api/stocks' },
    // The kiosk's "I drew a frame" signal and the launcher's read of it. Loopback-only inside the handlers.
    { method: 'POST', path: '/api/display/painted' },
    { method: 'GET', path: '/api/display/state' },

    // Widget-data endpoints display.html calls directly (same never-
    // authenticated context as everything else on this list) — found while
    // investigating a specific METAR/TAF "Unauthorized" report by checking
    // every such endpoint display.html actually calls, not just the one
    // that got reported. All four were missing, so Sports and Travel Time
    // widgets, and screen-resolution detection, were likely silently
    // broken too on any device with a PIN set, just not yet noticed/
    // reported. None return anything sensitive — LAN addresses and
    // resolution (screen-config), or plain proxied responses from free
    // external APIs with no credentials in the response body.
    { method: 'GET', path: '/api/metar-taf' },
    { method: 'GET', path: '/api/sports' },
    { method: 'GET', path: '/api/travel-time' },
    { method: 'GET', path: '/api/screen-config' },
    // The actual save for Live Editing (drag/resize a widget directly on
    // the wall, or via the Layout tab's Live Edit panel) — display.html's
    // saveLayoutNow() PUTs here with a plain, unauthenticated fetch(),
    // since the whole point of Live Editing is working with no login at
    // all (same "physical/local access IS the trust boundary" design as
    // everything else on this list). Without this, the drag looked like
    // it worked (immediate local state update) but silently 401'd on
    // save on any device with a PIN set — meaning it never actually
    // persisted anywhere, on ANY screen, including the one being edited.
    { method: 'PUT', path: '/api/layouts' },

    // /hub and /kids (hub.html, kids.html) — same "physical/local access IS
    // the trust boundary" design already established by Live Editing on the
    // wall display itself. Neither page has ever had a login screen of its
    // own — that's deliberate, not an oversight (kids shouldn't need the
    // parent PIN to check off their own chores) — which means a PIN gate on
    // their backing endpoints was never actually reachable from either page
    // to begin with. Every request from them has been silently 401ing on
    // any device with a PIN set, with nothing shown but empty lists. Scoped
    // to exactly the endpoints these two pages call (verified against both
    // files directly, not guessed); every other tab and Settings itself is
    // completely unaffected and still requires the PIN exactly as before.
    // NOTE: hub.html also PUTs a few keys to /api/settings (the smarthome
    // entity picker, shopping-store selector, one plain toggle) — that's
    // deliberately NOT included here, since /api/settings PUT is a much
    // broader, shared surface used by the main authenticated app too;
    // widening it wasn't part of what was asked, and is worth its own
    // separate decision rather than folding it into this fix.
    { method: 'GET', path: '/api/todo-lists' },
    { method: 'POST', path: '/api/todo-lists' },
    { method: 'PUT', path: '/api/todo-lists' },
    { method: 'DELETE', path: '/api/todo-lists' },
    { method: 'PUT', path: '/api/todo-items' },
    { method: 'DELETE', path: '/api/todo-items' },
    { method: 'GET', path: '/api/shopping-lists' },
    { method: 'POST', path: '/api/shopping-lists' },
    { method: 'PUT', path: '/api/shopping-lists' },
    { method: 'DELETE', path: '/api/shopping-lists' },
    { method: 'GET', path: '/api/shopping-list' },
    { method: 'POST', path: '/api/shopping-list' },
    { method: 'PUT', path: '/api/shopping-items' },
    { method: 'DELETE', path: '/api/shopping-items' },
    { method: 'GET', path: '/api/kids' },
    { method: 'POST', path: '/api/kids' },
    { method: 'PUT', path: '/api/kids' },
    { method: 'DELETE', path: '/api/kids' },
    { method: 'GET', path: '/api/chores' },
    { method: 'POST', path: '/api/chores' },
    { method: 'PUT', path: '/api/chores' },
    { method: 'DELETE', path: '/api/chores' },
    { method: 'GET', path: '/api/chore-chart' },
    { method: 'PUT', path: '/api/chore-instances' },
    { method: 'POST', path: '/api/chore-instances' },
    // Read-only: kids.html shows the kid's own sticker board. Awarding (POST) and
    // revoking (DELETE) stay parent-only/authenticated — not listed here.
    { method: 'GET', path: '/api/stickers' },
    { method: 'GET', path: '/api/radar-frames' },
    // Read-only: kids.html shows available/affordable rewards. Redeeming (POST)
    // and managing rewards (POST/PUT/DELETE on /api/rewards itself) stay
    // parent-only/authenticated — not listed here.
    { method: 'GET', path: '/api/rewards' },
    { method: 'GET', path: '/api/sticker-redemptions' },
    { method: 'GET', path: '/api/ha/entities' },
    { method: 'GET', path: '/api/ha/state' },
    { method: 'POST', path: '/api/ha/call-action' },
    { method: 'POST', path: '/api/ha/call-group-action' },
    // Windows full-screen kiosk "Exit full-screen" button (display.html,
    // ?kiosk=1). No login on the wall display by design (same trust boundary
    // as Live Editing above); the route itself is Windows-only + localhost-
    // only and does nothing but close the local kiosk browser.
    { method: 'POST', path: '/api/kiosk/exit' },

    // Found doing the same systematic check the METAR/TAF fix above called
    // for ("every such endpoint... not just the one reported") — this time
    // triggered by a real report that the Daily Quote widget showed
    // "Unauthorized" on a PIN-protected device. Grepped every literal
    // fetch('/api/...') call in display.html against this list: these were
    // ALL missing too, meaning Air Quality, Cameras (including adding/
    // editing one in Live Edit), Displays lookup, event push-target choice,
    // Flight Watch/Flight Map, Home Assistant areas, Handwriting input,
    // hiding a calendar event, the Message Board, the alert-banner
    // notifications, On This Day, family Profiles (per-person event
    // colour), Reminders, Saved Layouts, and even the running-version check
    // itself were all likely silently broken on any device with a PIN set —
    // same "physical/local access IS the trust boundary" design as
    // everything else on this list, just never actually reachable.
    { method: 'GET', path: '/api/daily-quote' },
    { method: 'GET', path: '/api/version' },
    { method: 'GET', path: '/api/air-quality' },
    { method: 'GET', path: '/api/camera/service' },
    { method: 'GET', path: '/api/cameras' },
    { method: 'POST', path: '/api/cameras' },
    { method: 'PUT', path: '/api/cameras' },
    { method: 'DELETE', path: '/api/cameras' },
    { method: 'GET', path: '/api/displays' },
    { method: 'GET', path: '/api/event-targets' },
    { method: 'GET', path: '/api/flight-watch' },
    { method: 'GET', path: '/api/flightmap/basemap' },   // prefix also covers .../basemap.json
    { method: 'GET', path: '/api/flightmap/state' },      // prefix also covers .../state?<key>
    { method: 'GET', path: '/api/flightmap/states' },     // prefix also covers .../states.json
    { method: 'GET', path: '/api/ha/areas' },
    { method: 'GET', path: '/api/handwriting-settings' },
    { method: 'POST', path: '/api/handwriting/recognize' },
    { method: 'POST', path: '/api/hidden-events' },
    { method: 'GET', path: '/api/messages' },
    { method: 'POST', path: '/api/messages' },
    { method: 'PUT', path: '/api/messages' },
    { method: 'DELETE', path: '/api/messages' },
    { method: 'GET', path: '/api/notifications/active' },
    { method: 'POST', path: '/api/notifications/dismiss' },
    { method: 'GET', path: '/api/on-this-day' },
    { method: 'GET', path: '/api/profiles' },
    { method: 'GET', path: '/api/reminders' },
    { method: 'POST', path: '/api/reminders' },   // prefix also covers POST .../reminders/icon-image
    { method: 'PUT', path: '/api/reminders' },
    { method: 'DELETE', path: '/api/reminders' },
    { method: 'GET', path: '/api/saved-layouts' },

    // Missed by the sweeps above and only found by loading display.html against a
    // PIN-protected instance: with a PIN set these three returned 401 to the
    // (login-less) wall display, so it fell back to default orientation/rotation/
    // theme, showed an empty meal plan, and stopped checking in. Same "physical/
    // local access IS the trust boundary" design as everything else on this list;
    // screen-checkin still goes through the device-limit check in its handler.
    { method: 'GET', path: '/api/display-config' },
    { method: 'GET', path: '/api/meals' },
    { method: 'POST', path: '/api/screen-checkin' },
  ];
  const isPublic = publicRoutes.some(r =>
    req.method === r.method && fullPath.startsWith(r.path)
  );
  if (isPublic) return next();

  // A mirror device syncing with this one as its host sends its own local
  // copy of this PIN as a dedicated header (see proxyJSONToHost()/the
  // fetch helpers on the slave side) — there's no human present to do an
  // interactive PIN-screen login during an unattended periodic sync, so a
  // session token isn't the right mechanism here. Plain equality, matching
  // how /api/auth/login itself already compares the PIN elsewhere in this
  // file — not a new, inconsistent security posture for this value.
  const hostPinHeader = req.headers['x-host-pin'];
  if (hostPinHeader !== undefined && hostPinHeader === pin) return next();
  // Grace period: also accept the PIN's value from just before its last
  // change — see the ALWAYS_AUTH_ROUTES block above for the full
  // explanation (same logic, just reached from a different branch of this
  // function for non-always-auth routes).
  if (hostPinHeader !== undefined) {
    const prevRow = db.prepare(`SELECT value FROM settings WHERE key = 'app_pin_previous'`).get();
    if (prevRow && hostPinHeader === prevRow.value) return next();
  }

  const token = req.headers['x-session-token'] || req.query._token;
  if (validToken(token)) return next();
  authDiag(req, '401 AUTH_REQUIRED');
  res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
}

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const pin = getPin();
  authDiag(req, 'PIN login attempt', true);
  if (!pin) return res.json({ ok: true, token: null }); // no PIN configured
  const ip = clientIp(req);
  const rl = checkLoginRateLimit(ip);
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterMs / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
  }
  if (req.body.pin !== pin) {
    return res.status(403).json({ error: 'Incorrect PIN' });
  }
  resetLoginRateLimit(ip);
  const token = makeToken();
  // Expire sessions after 30 days — stored as a timestamp checked in
  // validToken(), not a setTimeout delay. See SESSIONS' own comment above
  // for why: a 30-day setTimeout delay overflows Node's 32-bit limit and
  // silently gets clamped to 1ms, which is the actual bug this replaces.
  SESSIONS.set(token.split('.')[0], Date.now() + SESSION_TTL_MS);
  try { sessionUpsertStmt.run(token.split('.')[0], Date.now() + SESSION_TTL_MS); } catch (e) { console.error('Session persist failed (session will not survive a restart):', e.message); }
  res.json({ ok: true, token });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) {
    SESSIONS.delete(token.split('.')[0]);
    try { sessionDeleteStmt.run(token.split('.')[0]); } catch {}
  }
  res.json({ ok: true });
});

// GET /api/auth/status
app.get('/api/auth/status', (req, res) => {
  const pin = getPin();
  const token = req.headers['x-session-token'];
  const authenticated = !pin || !!req.remoteAuthed || validToken(token);
  if (requestIsRemote(req) || !authenticated) authDiag(req, `auth status -> pin_set=${!!pin} authenticated=${authenticated}`, true);
  res.json({ pin_set: !!pin, authenticated });
});

// Apply auth to all /api routes except auth itself
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  requireAuth(req, res, next);
});

// ── Display "painted" signal ─────────────────────────────────────────────────
// This code lives in src/display-painted.js. It runs here, at the same place in the file as before.
require('./src/display-painted.js')({ crypto, app });

// ── Remote access: Cloudflare tunnel (Phase 1) ───────────────────────────────
// One switch on the HOST device (Settings -> Remote Access) that gives the
// household a private web address (like brave-otter-4821.piazzahq.com) reaching
// this app from anywhere, through a Cloudflare tunnel run by `cloudflared` on
// this box. No port forwarding, no static IP.
//
//  * Pairs with the Phase 0 login gate: a tunnel is REFUSED (and stopped)
//    unless a remote password is set, because without one the gate is inert and
//    the whole app would be public. A request whose Host header is the tunnel
//    address is treated as remote even without proxy headers, and while no
//    password exists it is answered with a 503 instead of the app.
//  * Host only. A mirror reaches the household through the host's tunnel.
//  * The Piazza HQ server (mothership) creates the tunnel + DNS name; this
//    device only asks for it (POST /api/v1/tunnel/provision, idempotent) and
//    keeps the run token locally (redacted from settings reads, never synced,
//    handed to cloudflared through its environment, not the command line).
//  * cloudflared is a pinned, sha256-verified download (like go2rtc), started
//    late and at the lowest CPU priority so it can never delay a boot, and
//    restarted with backoff if it dies.
//  * Opt-in and default off. Nothing here runs until someone turns it on.
const CLOUDFLARED_VERSION = '2026.9.3';
const CLOUDFLARED_SHA256 = {
  'cloudflared-linux-amd64': '77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2',
  'cloudflared-linux-arm64': 'aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d',
  'cloudflared-linux-armhf': 'a714b1bee87e71ce7260555b30722ce711d12aaa0fee5a8aadc767ee6b816a14',
  'cloudflared-linux-arm': '967dc371a3fedbf09e881c13ee7ba317155ebc336cbd4afb756b46fc6785e5af',
  'cloudflared-windows-amd64.exe': 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2',
};
// process.arch/platform -> release asset (null = no build we pin for this platform).
// Node reports 'arm' for both ARMv6 (Pi Zero/1) and ARMv7 (Pi 2/3 on a 32-bit OS).
function cloudflaredAssetName(platform = process.platform, arch = process.arch, armVersion = process.config && process.config.variables && process.config.variables.arm_version) {
  if (platform === 'linux') {
    if (arch === 'x64') return 'cloudflared-linux-amd64';
    if (arch === 'arm64') return 'cloudflared-linux-arm64';
    if (arch === 'arm') return String(armVersion) === '6' ? 'cloudflared-linux-arm' : 'cloudflared-linux-armhf';
    return null;
  }
  if (platform === 'win32' && arch === 'x64') return 'cloudflared-windows-amd64.exe';
  return null;
}
const CLOUDFLARED_BIN_OVERRIDE = process.env.PIAZZA_CLOUDFLARED_BIN || '';   // tests: a stand-in binary, no download
// Where the downloaded helper is kept. Normally next to the app. In a container the app folder can be read-only
// (hardened `read_only: true` setups - found by testing, the download then failed with EROFS) and is thrown away on
// every image update (so the 40 MB helper was re-downloaded each time); the data volume is the one place that is both
// writable and persistent.
function cloudflaredBinPathFor(isWin, isContainer, dataDir, appDir) {
  return path.join(isContainer && dataDir ? dataDir : appDir, 'bin', isWin ? 'cloudflared.exe' : 'cloudflared');
}
const CLOUDFLARED_BIN_PATH = CLOUDFLARED_BIN_OVERRIDE || cloudflaredBinPathFor(IS_WIN, IS_CONTAINER, DATA_DIR, __dirname);
function cloudflaredBinReady() { try { return fs.existsSync(CLOUDFLARED_BIN_PATH); } catch { return false; } }

const RA = {
  child: null, starting: false, stopRequested: false, restartTID: null,
  backoff: 5000, fastFails: 0, startedAt: 0, connections: 0, everConnected: false,
  lastError: '', downloading: false, downloadPromise: null, bringUp: null,
  availableAt: 0, available: null, disconnectedSince: 0, reconcileTimer: null,
  // Which cloudflared connIndex values are currently registered — see raHandleLine()'s comment for why
  // this replaced a simple up/down counter (a real connection loss, e.g. the server deleting the tunnel
  // out from under a running cloudflared, was invisible to that counter and left status permanently
  // stuck on "connected"). RA.connections is kept as liveConnIndexes.size for everything that reads it.
  liveConnIndexes: new Set(),
};
let _raHostLc = '';   // lower-cased tunnel address, cached so the per-request check costs nothing
let _raHostLoaded = false;   // loaded on first use: settings helpers are defined further down the file
function raLoadHost() { _raHostLc = String(getSetting('remote_access_address') || '').trim().toLowerCase(); _raHostLoaded = true; }
function raMode() { return getSetting('remote_access_mode') === '1'; }
// True when the request came in through this device's own tunnel address.
function requestHostIsTunnel(req) {
  if (!_raHostLoaded) raLoadHost();
  if (!_raHostLc) return false;
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return h === _raHostLc;
}
class RaError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

// Why this device can or can't run a tunnel right now: { ok:true } or { ok:false, code, message }.
function raEligibility() {
  if (IS_DEMO) return { ok: false, code: 'DEMO', message: 'Not available in the demo.' };
  if (isSlave()) return { ok: false, code: 'NOT_HOST', message: 'Set up remote access on your main (host) device. A mirror screen reaches the household through the host.' };
  if (!remoteAuthConfigured()) return { ok: false, code: 'NEEDS_PASSWORD', message: 'Set a remote password first (Settings → Security). Without one, anyone with the link could open your calendar.' };
  if (!resolveUpdateServerUrl()) return { ok: false, code: 'NO_SERVER', message: 'This device has no Piazza HQ server address configured.' };
  if (!getSetting('update_license_key')) return { ok: false, code: 'NO_KEY', message: 'Enter this device’s key in Settings first — remote access needs it to set up your address.' };
  if (!getSetting('screen_device_id_cache')) return { ok: false, code: 'NO_DEVICE', message: 'This device has not checked in with the Piazza HQ server yet. Try again in a few minutes.' };
  if (!cloudflaredAssetName() && !CLOUDFLARED_BIN_OVERRIDE) return { ok: false, code: 'UNSUPPORTED', message: 'Remote access is not available on this kind of device yet.' };
  return { ok: true };
}

const RA_ERROR_TEXT = {
  DISABLED: 'Remote access is not switched on for Piazza HQ yet. It is coming soon — nothing was changed.',
  NOT_CONFIGURED: 'Remote access is not available right now. Please try again later.',
  NOT_HOST: 'Only your household’s main (host) device can turn on remote access.',
  NOT_ELIGIBLE: 'Remote access is not available for this account.',
  NO_LICENSE: 'This device’s key was not recognised. Check it in Settings.',
  LICENSE_CAP: 'This account already has the maximum number of remote-access addresses.',
  CAPACITY: 'Remote access is busy right now. Please try again later.',
  RATE_LIMIT: 'Too many requests. Please try again in a few minutes.',
  CF_ERROR: 'The address could not be set up just now. Please try again in a minute.',
  CF_UNREACHABLE: 'The address could not be set up just now. Please try again in a minute.',
  RENAME_LIMIT: 'You have changed this address a few times today. Try again tomorrow.',
  NO_TUNNEL: 'Turn on remote access first.',
  NAME_TAKEN: 'Could not find a free address with that name. Try a different one.',
};
async function raMothership(method, apiPath, body, timeoutMs = 30000) {
  const serverUrl = String(process.env.PIAZZA_TUNNEL_SERVER_URL || resolveUpdateServerUrl()).replace(/\/$/, '');   // env override: tests point this at a fake server
  const key = getSetting('update_license_key');
  let r;
  try {
    r = await fetchWithTimeout(serverUrl + apiPath, {
      method, timeoutMs,
      headers: Object.assign({ 'x-license-key': key }, body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new RaError(502, 'UNREACHABLE', 'Could not reach the Piazza HQ server. Check this device’s internet connection and try again.');
  }
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, json };
}
// Ask the server for this device's tunnel (creates it the first time, otherwise
// returns the same address with a fresh run token) and remember the result.
async function raProvision() {
  const device = getSetting('screen_device_id_cache');
  const r = await raMothership('POST', '/api/v1/tunnel/provision', { device, port: parseInt(PORT, 10) || 3000 });
  const j = r.json || {};
  if (!r.ok || !j.ok || !j.hostname || !j.tunnel_token) {
    throw new RaError(r.status >= 400 ? r.status : 502, j.code || 'ERROR', RA_ERROR_TEXT[j.code] || j.error || 'Could not set up remote access.');
  }
  setSetting('remote_access_address', String(j.hostname).toLowerCase());
  setSetting('remote_access_tunnel_token', String(j.tunnel_token));
  setSetting('remote_access_device_id', device);
  raLoadHost();
  return { hostname: String(j.hostname).toLowerCase(), url: j.url || ('https://' + j.hostname) };
}

async function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
// Make sure the cloudflared binary exists (pinned release, sha256-verified). Shared
// between concurrent callers. Returns true when ready; throws RaError otherwise.
// Why fetching/saving the helper failed, in words that point at the real cause. Every failure used to be reported as
// "check this device's internet connection", which sent people looking in the wrong place when the real problem was a
// read-only or full disk.
function raDownloadFailureMessage(e) {
  const code = e && e.code;
  const text = String((e && e.message) || '');
  if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM' || /EROFS|EACCES|EPERM/.test(text)) return 'Could not save the remote-access helper: the folder it needs to write to is read-only or not writable (on Docker, the data volume must be writable). It will retry.';
  if (code === 'ENOSPC' || /ENOSPC/.test(text)) return 'Could not save the remote-access helper: this device is out of disk space. It will retry.';
  if (/sha256 mismatch/.test(text)) return 'The remote-access helper that was downloaded did not pass its safety check, so it was not used. It will retry.';
  return 'Could not download the remote-access helper. Check this device’s internet connection; it will retry.';
}
async function raEnsureBinary() {
  if (cloudflaredBinReady()) return true;
  if (RA.downloadPromise) return RA.downloadPromise;
  const asset = cloudflaredAssetName();
  const sha = asset && CLOUDFLARED_SHA256[asset];
  if (!asset || !sha) throw new RaError(400, 'UNSUPPORTED', 'Remote access is not available on this kind of device yet.');
  RA.downloadPromise = (async () => {
    RA.downloading = true;
    const binDir = path.dirname(CLOUDFLARED_BIN_PATH);
    const tmp = path.join(binDir, `.cloudflared.download.${process.pid}`);
    try {
      fs.mkdirSync(binDir, { recursive: true });
      console.log(`[remote-access] downloading cloudflared ${CLOUDFLARED_VERSION} (${asset})…`);
      await downloadFile(`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset}`, tmp, 180000);
      const got = await sha256File(tmp);
      if (got !== sha) throw new Error(`sha256 mismatch (expected ${sha}, got ${got})`);
      fs.renameSync(tmp, CLOUDFLARED_BIN_PATH);
      if (!IS_WIN) { try { fs.chmodSync(CLOUDFLARED_BIN_PATH, 0o755); } catch {} }
      console.log('[remote-access] cloudflared ready');
      return true;
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      console.error('[remote-access] cloudflared download failed: ' + e.message);
      throw new RaError(502, 'DOWNLOAD_FAILED', raDownloadFailureMessage(e));
    } finally { RA.downloading = false; }
  })().finally(() => { RA.downloadPromise = null; });
  return RA.downloadPromise;
}

// A connection that goes away cleanly logs "Unregistered tunnel connection" — but one the SERVER kills out
// from under a running cloudflared (exactly what the admin kill switch does, confirmed live 2026-10-02 on
// 87: the tunnel/DNS were genuinely deleted, yet cloudflared kept running and retrying forever) instead logs
// "Connection terminated" or a failed "Register tunnel error" for that connIndex, neither of which the old
// code recognized as "this connection is gone." A plain up/down counter that only ever decremented on the
// clean message got stuck at its last positive value forever in that case — and since raStatus() reports
// "connected" purely from that counter being above zero, and raReconcile()'s self-healing check refuses to
// even ask the mothership while it's above zero, BOTH the status the app shows and the automatic "this was
// switched off" recovery were broken by the same stuck value. Tracking actual live connIndexes in a set
// fixes both: any of the three ways a given connIndex can stop being live removes it, in any order, however
// many times a message repeats (a Set absorbs duplicates; `delete` on an absent member is a no-op) — so the
// count only reflects connections that are still actually registered.
function raHandleLine(line) {
  const m = line.match(/connIndex=(\d+)/);
  const idx = m ? m[1] : null;
  if (/Registered tunnel connection/.test(line) && !/Unregistered/.test(line)) {
    if (idx !== null) RA.liveConnIndexes.add(idx); else RA.connections++;   // no connIndex in the line (e.g. a test double): fall back to a bare increment
    RA.connections = RA.liveConnIndexes.size || RA.connections;
    RA.disconnectedSince = 0; RA.everConnected = true; RA.fastFails = 0; RA.backoff = 5000; RA.lastError = '';
    console.log('[cloudflared] ' + line.slice(0, 240));
  } else if (/Unregistered tunnel connection/.test(line) || /Connection terminated/.test(line) || /Register tunnel error/.test(line)) {
    if (idx !== null) RA.liveConnIndexes.delete(idx);
    RA.connections = RA.liveConnIndexes.size;
    if (RA.connections === 0 && !RA.disconnectedSince) RA.disconnectedSince = Date.now();
    if (/ ERR /.test(line)) RA.lastError = line.replace(/^\S+\s+ERR\s+/, '').slice(0, 200);
    console.log('[cloudflared] ' + line.slice(0, 240));
  }
  else if (/ ERR /.test(line)) { RA.lastError = line.replace(/^\S+\s+ERR\s+/, '').slice(0, 200); console.log('[cloudflared] ' + line.slice(0, 240)); }
  else if (/ WRN /.test(line) || /Starting tunnel/.test(line)) { console.log('[cloudflared] ' + line.slice(0, 240)); }
}
function raScheduleRestart(delayMs) {
  if (RA.restartTID) clearTimeout(RA.restartTID);
  RA.restartTID = setTimeout(() => { RA.restartTID = null; raBringUp('restart').catch(() => {}); }, delayMs);
}
function raSpawn(token) {
  let cmd = CLOUDFLARED_BIN_PATH;
  let args = ['tunnel', '--no-autoupdate', '--loglevel', 'info', 'run'];
  // Lowest CPU priority: a tunnel must never compete with the display for a Pi 3's CPU.
  if (CLOUDFLARED_BIN_OVERRIDE.endsWith('.js')) { args = [CLOUDFLARED_BIN_OVERRIDE].concat(args); cmd = process.execPath; }   // tests: a Node script standing in for the binary
  else if (!IS_WIN && fs.existsSync('/usr/bin/nice')) { args = ['-n', '19', cmd].concat(args); cmd = '/usr/bin/nice'; }
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { TUNNEL_TOKEN: token }) });
  RA.child = child; RA.starting = true; RA.stopRequested = false; RA.connections = 0; RA.liveConnIndexes.clear(); RA.everConnected = false; RA.startedAt = Date.now(); RA.disconnectedSince = Date.now();
  let buf = '';
  const onData = (b) => { buf += b; let i; while ((i = buf.indexOf('\n')) >= 0) { raHandleLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } if (buf.length > 4000) buf = ''; };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('error', (e) => { RA.lastError = 'Could not start the remote-access helper: ' + e.message; console.error('[remote-access] ' + RA.lastError); });
  child.on('spawn', () => { RA.starting = false; console.log(`[remote-access] cloudflared started (pid ${child.pid}) for ${getSetting('remote_access_address') || ''}`); });
  child.on('exit', (code, sig) => {
    console.log(`[remote-access] cloudflared exited (code ${code}${sig ? ', signal ' + sig : ''})`);
    const ranMs = Date.now() - RA.startedAt;
    RA.child = null; RA.starting = false; RA.connections = 0; RA.liveConnIndexes.clear();
    if (RA.exitResolve) { const r = RA.exitResolve; RA.exitResolve = null; RA.exited = null; r(); }
    if (RA.stopRequested) { RA.stopRequested = false; return; }
    if (!raMode()) return;
    if (ranMs < 20000 && !RA.everConnected) RA.fastFails++;
    RA.backoff = Math.min(RA.backoff * 2, 5 * 60 * 1000);
    raScheduleRestart(RA.backoff);
  });
}
function raStop(reason) {
  if (RA.restartTID) { clearTimeout(RA.restartTID); RA.restartTID = null; }
  const c = RA.child;
  if (!c) return;
  console.log('[remote-access] stopping (' + (reason || 'requested') + ')');
  RA.stopRequested = true;
  RA.exited = new Promise((r) => { RA.exitResolve = r; });   // lets a quick "turn it back on" wait for this process to be gone
  try { c.kill(); } catch {}
}
// The server has switched remote access off (kill switch), removed this address, or no longer allows this
// device: stop, forget the address and token, and leave a note in Settings saying why.
function raTurnOffBecause(message) {
  console.warn('[remote-access] switching off: ' + message);
  setSetting('remote_access_mode', '0'); setSetting('remote_access_address', ''); setSetting('remote_access_tunnel_token', ''); setSetting('remote_access_device_id', '');
  setSetting('remote_access_notice', message);
  raLoadHost(); raStop('server switched it off'); RA.lastError = ''; RA.disconnectedSince = 0; RA.available = null;
}
const RA_SERVER_SAID_NO = new Set(['DISABLED', 'NOT_ELIGIBLE', 'NO_LICENSE', 'NOT_HOST']);
// While the tunnel is not connected for a while, ask the server whether it should even exist. A tunnel the
// server has removed makes cloudflared retry forever; this is what turns that into a clear "switched off".
async function raReconcile() {
  if (!raMode() || RA.bringUp || RA.downloading) return;
  if (RA.connections > 0) return;
  const grace = Number(process.env.PIAZZA_RA_DISCONNECT_GRACE_MS) || 3 * 60 * 1000;
  if (!RA.disconnectedSince || Date.now() - RA.disconnectedSince < grace) return;
  if (!raEligibility().ok) return;
  try {
    const r = await raMothership('GET', '/api/v1/tunnel/status?device=' + encodeURIComponent(getSetting('screen_device_id_cache')), undefined, 8000);
    if (r.ok && r.json && r.json.enabled === false) raTurnOffBecause('Remote access was switched off by Piazza HQ. Nothing on your home network changed.');
    else if (r.ok && r.json && r.json.provisioned === false) raTurnOffBecause('Your remote-access address was removed. You can turn it on again to get a new one.');
    else if (!r.ok && RA_SERVER_SAID_NO.has(r.json && r.json.code)) raTurnOffBecause(RA_ERROR_TEXT[r.json.code] || 'Remote access is not available for this device.');
  } catch { /* server unreachable: keep trying the tunnel we have */ }
}
// Get the tunnel running: eligibility -> binary -> (refresh the run token if there's
// none or the last few starts failed at once) -> spawn. Never throws to callers
// that ignore the result; problems land in RA.lastError for the status card.
function raBringUp(why) {
  if (RA.bringUp) return RA.bringUp;
  RA.bringUp = (async () => {
    try {
      if (RA.child && RA.stopRequested && RA.exited) await Promise.race([RA.exited, new Promise((r) => setTimeout(r, 5000))]);   // a stop is still finishing
      if (!raMode() || RA.child) return;
      const el = raEligibility();
      if (!el.ok) { RA.lastError = el.message; return; }
      if (getSetting('remote_access_device_id') && getSetting('remote_access_device_id') !== getSetting('screen_device_id_cache')) {
        // A restored backup or cloned card carries the old device's tunnel; running it here would split the
        // household's traffic between two boxes. Drop it; turning remote access on again makes a fresh one.
        console.warn('[remote-access] tunnel belongs to a different device id — switching remote access off here');
        setSetting('remote_access_mode', '0'); setSetting('remote_access_address', ''); setSetting('remote_access_tunnel_token', ''); setSetting('remote_access_device_id', ''); raLoadHost();
        RA.lastError = '';
        return;
      }
      await raEnsureBinary();
      if (!getSetting('remote_access_tunnel_token') || RA.fastFails >= 3) {
        try { await raProvision(); RA.fastFails = 0; }
        catch (e) {
          if (RA_SERVER_SAID_NO.has(e.code)) { raTurnOffBecause(e.message); return; }
          if (!getSetting('remote_access_tunnel_token')) throw e; /* otherwise keep trying the token we have */
        }
      }
      raSpawn(getSetting('remote_access_tunnel_token'));
      RA.lastError = '';
    } catch (e) {
      RA.lastError = e.message || String(e);
      console.error('[remote-access] ' + (why || 'start') + ' failed: ' + RA.lastError);
      if (raMode()) raScheduleRestart(Math.min(RA.backoff = Math.min(RA.backoff * 2, 5 * 60 * 1000), 5 * 60 * 1000));
    }
  })().finally(() => { RA.bringUp = null; });   // cleared after the assignment below, even if the body finishes without awaiting
  return RA.bringUp;
}

async function raServerAvailable() {
  if (RA.available !== null && Date.now() - RA.availableAt < 60000) return RA.available;
  try {
    const r = await raMothership('GET', '/api/v1/tunnel/status?device=' + encodeURIComponent(getSetting('screen_device_id_cache')), undefined, 4000);
    RA.available = r.ok ? !!(r.json && r.json.enabled) : (RA.available === null ? null : RA.available);
  } catch { /* leave as is */ }
  RA.availableAt = Date.now();
  return RA.available;
}
async function raStatus() {
  const el = raEligibility();
  const on = raMode();
  let state = 'off';
  if (on) {
    if (!el.ok) state = 'blocked';
    else if (RA.downloading) state = 'downloading';
    else if (RA.child && RA.connections > 0) state = 'connected';
    else if (RA.child || RA.starting || RA.bringUp) state = 'connecting';
    else if (RA.lastError) state = 'error';
    else state = 'connecting';
  }
  const hostname = getSetting('remote_access_address') || '';
  const canAsk = !isSlave() && el.code !== 'NO_KEY' && el.code !== 'NO_SERVER' && el.code !== 'NO_DEVICE' && !IS_DEMO;
  return {
    enabled: on, state,
    eligible: el.ok, blocked_reason: el.ok ? null : el.code, message: el.ok ? '' : el.message,
    hostname, url: hostname ? 'https://' + hostname : '', app_url: hostname ? 'https://' + hostname + '/app' : '',   // the control app; the bare address is the wall-display view
    connections: RA.connections, last_error: on ? (RA.lastError || '') : '',
    is_host: !isSlave(), password_set: remoteAuthConfigured(), allow_control: getSetting('remote_access_allow_control') === '1',
    notice: on ? '' : (getSetting('remote_access_notice') || ''),
    available: canAsk ? await raServerAvailable() : null,
    supported: !!cloudflaredAssetName() || !!CLOUDFLARED_BIN_OVERRIDE,
  };
}

app.get('/api/remote-access/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await raStatus()); } catch (e) { res.status(500).json({ error: 'Could not read remote access status.' }); }
});
app.post('/api/remote-access/enable', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const el = raEligibility();
    if (!el.ok) return res.status(400).json({ error: el.message, code: el.code });
    await raProvision();                       // quick; errors here are reported straight back
    setSetting('remote_access_mode', '1'); setSetting('remote_access_notice', '');
    RA.lastError = ''; RA.fastFails = 0; RA.backoff = 5000; RA.disconnectedSince = Date.now();
    raBringUp('enable').catch(() => {});      // binary download + start continue in the background
    res.json(await raStatus());
  } catch (e) {
    if (e instanceof RaError) return res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message, code: e.code });
    console.error('[remote-access] enable error:', e.message);
    res.status(500).json({ error: 'Could not turn on remote access.' });
  }
});
// Email alerts for remote sign-ins. Home-network only (a remote visitor must not be able to switch the
// alerts off, or point them at their own inbox).
app.get('/api/remote-access/alerts', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(alertsStatus()); });
app.post('/api/remote-access/alerts', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const b = req.body || {};
  const mode = b.mode === 'new' || b.mode === 'all' ? b.mode : 'off';
  const email = String(b.email == null ? getSetting('remote_alert_email') : b.email).trim();
  if (mode !== 'off') {
    if (!validAlertEmail(email)) return res.status(400).json({ error: 'Enter the email address the alerts should go to.', code: 'BAD_EMAIL' });
    if (!alertsStatus().sender_ready) return res.status(400).json({ error: 'Set up the sending email account first (Settings \u2192 Daily Briefing), then come back.', code: 'NO_SENDER' });
  }
  const wasOff = alertMode() === 'off';
  if (validAlertEmail(email)) setSetting('remote_alert_email', email);
  setSetting('remote_alert_mode', mode);
  if (mode !== 'off' && wasOff) {
    // Devices signed in right now are ones you know about: don't email about them later.
    try { for (const r of db.prepare(`SELECT user_agent FROM remote_sessions WHERE expires_at > ?`).all(Date.now())) rememberDevice(uaFingerprint(r.user_agent)); } catch {}
  }
  res.json(alertsStatus());
});
app.post('/api/remote-access/alerts/test', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const T = alertT();
    await sendRemoteAlertMail({ subject: T('Test alert from Piazza HQ'), text: T('This is a test. If you can read this, sign-in alerts will reach you here.') + '\n\n' + T('You will get an email like this when someone signs in to your Piazza HQ from outside your home (depending on the option you chose).') + '\n' });
    recordAlertResult(null);
    res.json({ ok: true, ...alertsStatus() });
  } catch (e) {
    recordAlertResult(e);
    res.status(502).json({ error: friendlyMailError(e), code: 'MAIL_FAILED' });
  }
});
// Whether a remote sign-in may operate real devices (smart-home actions, TV power). Off unless someone at home
// turns it on - and it can only be changed from the home network (this whole path is LAN-only, see remoteBlockedPath).
app.post('/api/remote-access/control', (req, res) => {
  res.set('Cache-Control', 'no-store');
  setSetting('remote_access_allow_control', req.body && req.body.allow === true ? '1' : '0');
  raStatus().then((st) => res.json(st)).catch(() => res.status(500).json({ error: 'Could not save that.' }));
});
// Change the words in the address. The server adds a random 4-digit suffix and keeps the tunnel (and this
// device's run token) as they are; only the public name moves.
app.post('/api/remote-access/rename', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const el = raEligibility();
    if (!el.ok) return res.status(400).json({ error: el.message, code: el.code });
    if (!raMode() || !getSetting('remote_access_address')) return res.status(400).json({ error: RA_ERROR_TEXT.NO_TUNNEL, code: 'NO_TUNNEL' });
    const r = await raMothership('POST', '/api/v1/tunnel/rename', { device: getSetting('screen_device_id_cache'), name: String((req.body && req.body.name) || '') });
    if (r.status === 404 && !(r.json && r.json.code)) return res.status(503).json({ error: 'Changing the address is not available yet.', code: 'UNAVAILABLE' });
    const j = r.json || {};
    if (!r.ok || !j.ok || !j.hostname) return res.status(r.status >= 400 ? r.status : 502).json({ error: j.code === 'BAD_NAME' ? j.error : (RA_ERROR_TEXT[j.code] || j.error || 'Could not change the address.'), code: j.code || 'ERROR' });
    setSetting('remote_access_address', String(j.hostname).toLowerCase()); raLoadHost();
    res.json(await raStatus());
  } catch (e) {
    if (e instanceof RaError) return res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message, code: e.code });
    console.error('[remote-access] rename error:', e.message);
    res.status(500).json({ error: 'Could not change the address.' });
  }
});
// Turn it off. By default the address is kept (so turning it back on gives the same link);
// { release: true } also gives the address back to the server.
app.post('/api/remote-access/disable', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    setSetting('remote_access_mode', '0');
    raStop('disabled by user');
    RA.lastError = '';
    if (req.body && req.body.release === true && getSetting('remote_access_address')) {
      try {
        const r = await raMothership('POST', '/api/v1/tunnel/revoke', { device: getSetting('screen_device_id_cache') });
        // 502 = the server will finish removing it itself; either way it is no longer ours.
        if (!r.ok && r.status !== 502) return res.status(r.status).json({ error: RA_ERROR_TEXT[r.json && r.json.code] || (r.json && r.json.error) || 'Could not release the address.', code: r.json && r.json.code });
      } catch (e) {
        if (e instanceof RaError) return res.status(502).json({ error: e.message + ' The tunnel is off, but the address was kept. Try again later.', code: e.code });
        throw e;
      }
      setSetting('remote_access_address', ''); setSetting('remote_access_tunnel_token', ''); setSetting('remote_access_device_id', ''); raLoadHost();
    }
    res.json(await raStatus());
  } catch (e) {
    console.error('[remote-access] disable error:', e.message);
    res.status(500).json({ error: 'Could not turn off remote access.' });
  }
});


// Start late so it never competes with the display for the first paint, then keep
// it healthy: the periodic check restarts a tunnel that died while the backoff
// timer was lost (e.g. a failed start that left nothing scheduled).
setTimeout(() => { if (raMode()) raBringUp('boot').catch(() => {}); }, Number(process.env.PIAZZA_RA_BOOT_DELAY_MS) || 60 * 1000);
setInterval(() => { if (raMode() && !RA.child && !RA.bringUp && !RA.restartTID) raBringUp('watchdog').catch(() => {}); }, 30 * 60 * 1000);
setInterval(() => { raReconcile().catch(() => {}); }, Number(process.env.PIAZZA_RA_RECONCILE_MS) || 2 * 60 * 1000);

// ── Remote access: manage the remote password + sessions ─────────────────────
// (Login / logout / status are handled up in remoteGate(), before any of the
// other auth.) These sit behind the normal /api auth, so changing them needs
// the App PIN session if a PIN is set. Setting the FIRST password is only
// allowed from the home network; changing or removing it from a remote
// session additionally needs the current password.
// The remote password is the only lock on a public address, so refuse the passwords that guess-runs
// try first. Not a complexity ritual: length and unpredictability are what matter, which is why a
// few unrelated words ("maple river lantern quiet") passes and "Password123!" does not.
const COMMON_PASSWORDS = new Set(['password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'letmein', 'letmein123', 'welcome', 'welcome1', 'welcome123',
  'qwerty', 'qwerty123', 'qwertyuiop', 'qwertyuiop1', 'qazwsxedc', '1qaz2wsx', '1q2w3e4r', '1q2w3e4r5t', 'zxcvbnm', 'asdfghjkl', 'asdfghjkl1', 'iloveyou', 'iloveyou1', 'iloveyou123', 'admin', 'admin123', 'administrator',
  '1234567890', '12345678901', '0123456789', '9876543210', '0987654321', '1234512345', '1122334455', '1111111111', '0000000000', 'abcdefghij', 'abcd1234', 'abc123456', 'abcdefg123',
  'monkey', 'dragon', 'football', 'baseball', 'basketball', 'superman', 'batman', 'starwars', 'trustno1', 'sunshine', 'princess', 'master', 'mustang', 'shadow', 'michael', 'jennifer', 'jordan23', 'pokemon',
  'changeme', 'changeme123', 'secret', 'secret123', 'default', 'test1234', 'testing123', 'guest', 'guest123', 'login', 'login123', 'hello123', 'hellohello', 'freedom', 'whatever', 'computer', 'internet',
  'raspberry', 'raspberrypi', 'piazza', 'piazzahq', 'piazza123', 'piazzahq123', 'calendar', 'calendar123', 'family', 'family123', 'mycalendar', 'mypassword', 'mypassword1', 'newpassword', 'newpassword1',
  'summer2024', 'summer2025', 'summer2026', 'winter2025', 'winter2026', 'spring2026', 'autumn2026', 'fall2026', 'january2026', 'september2026', 'october2026']);
const PASSWORD_BAD_PARTS = ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'iloveyou', 'admin', 'abc123', '123456', '654321', '111111', '000000', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'trustno1', 'changeme', 'piazza'];
const PASSWORD_RUN_SOURCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function remotePasswordWeakness(pw) {
  const lower = pw.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, '');
  const why = 'That password is too easy to guess. Use a few unrelated words, like "maple river lantern quiet", or something longer.';
  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(compact)) return why;
  if (new Set(pw).size < 5) return why;                                       // aaaaaaaaaa, abababababab
  if (compact.length >= 6 && PASSWORD_RUN_SOURCES.some((src) => src.includes(compact) || src.split('').reverse().join('').includes(compact))) return why;   // 1234567890, qwertyuiop
  if (/^\d+$/.test(pw) && pw.length < 16) return why;                         // digits only
  if (pw.length < 16 && PASSWORD_BAD_PARTS.some((p) => compact.includes(p))) return why;   // Password2026!, Piazza12345
  return null;
}
function remoteAuthValidNewPassword(pw) {
  if (typeof pw !== 'string') return 'Enter a password.';
  if (pw.length < REMOTE_PW_MIN) return `Use at least ${REMOTE_PW_MIN} characters — a short phrase of a few words works well.`;
  if (pw.length > REMOTE_PW_MAX) return `Keep it under ${REMOTE_PW_MAX} characters.`;
  return remotePasswordWeakness(pw);
}
async function remoteCurrentPasswordOk(req) {
  const cur = req.body && req.body.current_password;
  return typeof cur === 'string' && cur.length > 0 && cur.length <= REMOTE_PW_MAX && await verifyRemotePassword(cur, remoteAuthHash());
}

app.put('/api/remote-auth/password', async (req, res) => {
  try {
    const bad = remoteAuthValidNewPassword(req.body && req.body.password);
    if (bad) return res.status(400).json({ error: bad });
    const configured = remoteAuthConfigured();
    if (requestIsRemote(req)) {
      if (!configured) return res.status(403).json({ error: 'Set the first remote password while you are on your home network.' });
      const lim = remoteLoginLimiter.check('pw:' + remoteClientIp(req));
      if (!lim.allowed) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      if (!await remoteCurrentPasswordOk(req)) return res.status(403).json({ error: 'Current password is incorrect.' });
    }
    const hash = await hashRemotePassword(req.body.password);
    db.prepare(`INSERT OR REPLACE INTO remote_auth (id, password_hash, updated_at) VALUES (1, ?, ?)`).run(hash, Date.now());
    _remoteAuthConfigured = true;
    // A new password signs every device out, including this one — then a
    // remote caller is signed straight back in so changing it isn't a lockout.
    db.prepare(`DELETE FROM remote_sessions`).run();
    if (requestIsRemote(req)) setRemoteCookie(req, res, createRemoteSession(req), REMOTE_SESSION_TTL_MS);
    res.json({ ok: true, configured: true });
  } catch (e) {
    console.error('remote password set error:', e.message);
    res.status(500).json({ error: 'Could not save the password.' });
  }
});

app.delete('/api/remote-auth/password', async (req, res) => {
  try {
    if (requestIsRemote(req) && remoteAuthConfigured()) {
      const lim = remoteLoginLimiter.check('pw:' + remoteClientIp(req));
      if (!lim.allowed) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      if (!await remoteCurrentPasswordOk(req)) return res.status(403).json({ error: 'Current password is incorrect.' });
    }
    db.prepare(`DELETE FROM remote_auth`).run();
    db.prepare(`DELETE FROM remote_sessions`).run();
    _remoteAuthConfigured = false;
    // No password = no login gate, so a live tunnel would expose the app. Stop it and switch it off.
    let tunnelStopped = false;
    if (raMode()) { setSetting('remote_access_mode', '0'); raStop('remote password removed'); tunnelStopped = true; }
    res.json({ ok: true, configured: false, remote_access_stopped: tunnelStopped });
  } catch (e) {
    console.error('remote password remove error:', e.message);
    res.status(500).json({ error: 'Could not remove the password.' });
  }
});

app.get('/api/remote-auth/events', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const seen = Number(getSetting('remote_events_seen_at')) || 0;
  const events = db.prepare(`SELECT id, at, ip, user_agent, ok, country FROM remote_login_events ORDER BY id DESC LIMIT 30`).all();
  const cnt = (ok) => db.prepare(`SELECT COUNT(*) AS n FROM remote_login_events WHERE ok = ? AND at > ?`).get(ok, seen).n;
  res.json({ events, new_success: cnt(1), new_failed: cnt(0) });
});
app.post('/api/remote-auth/events/seen', (req, res) => {
  setSetting('remote_events_seen_at', String(Date.now()));
  res.json({ ok: true });
});
app.get('/api/remote-auth/sessions', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const mine = req.remoteAuthed ? sha256hex(readCookie(req, REMOTE_COOKIE) || '') : null;
  const rows = db.prepare(`SELECT id, created_at, last_seen, expires_at, ip, user_agent FROM remote_sessions WHERE expires_at > ? ORDER BY last_seen DESC`).all(Date.now());
  res.json(rows.map((r) => ({ id: r.id, created_at: r.created_at, last_seen: r.last_seen, expires_at: r.expires_at, ip: r.ip, user_agent: r.user_agent, current: r.id === mine })));
});
app.delete('/api/remote-auth/sessions', (req, res) => {
  const r = db.prepare(`DELETE FROM remote_sessions`).run();
  res.json({ ok: true, revoked: r.changes });
});
app.delete('/api/remote-auth/sessions/:id', (req, res) => {
  const r = db.prepare(`DELETE FROM remote_sessions WHERE id = ?`).run(String(req.params.id));
  res.json({ ok: true, revoked: r.changes });
});


// ── Events API ───────────────────────────────────────────────────────────────

// GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD
// ── Chore chart API ───────────────────────────────────────────────────────────
// This code lives in src/chore-engine.js. It runs here, at the same place in the file as before.
const { materializeChoreInstances, getKidChores, getKidStreak, getKidStickerBalance } = require('./src/chore-engine.js')({ db, localDateStr });

// ── The family's clock (what day and time is it?) ────────────────────
// IMPORTANT: "what day/time is it right now, for this family" should ALWAYS go
// through appNow()/localDateStr()/localHHMM() below — never raw `new Date()`
// getters or toISOString(). Two related bugs live here:
//   1. toISOString() converts to UTC first, silently rolling the calendar day over
//      hours early or late relative to local midnight depending on timezone offset
//      (daily chores resetting before local midnight in US timezones, etc.)
//   2. Even the OS-local getters (getFullYear/getHours/...) are only right if the
//      Pi's own system clock/timezone is configured correctly. A settings key
//      'timezone_override' (IANA name like 'America/Chicago') lets a family fix
//      this themselves from the Settings tab without touching the Pi, if the OS
//      timezone is ever wrong or a fresh SD card image reverts to UTC.
// This same setting is also read by getLocalTimezone() (below, near the ICS
// parser) to convert UTC-marked calendar feed times — one Settings control
// governs both "what day is it" logic and calendar sync, rather than two
// separate timezone keys.
function getTimezoneOverride() {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'timezone_override'`).get();
    return (row && row.value) ? row.value.trim() : '';
  } catch { return ''; }
}
function appNow() {
  const now = new Date();
  const tz = getTimezoneOverride();
  if (!tz) {
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), min: now.getMinutes() };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t) => parts.find(p => p.type === t).value;
    return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), h: Number(get('hour')), min: Number(get('minute')) };
  } catch (e) {
    // Bad/unsupported IANA name saved somehow — fall back to OS local rather than crash.
    console.error('Invalid timezone_override, falling back to OS local time:', tz, e.message);
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), min: now.getMinutes() };
  }
}
function localDateStr() {
  const { y, m, d } = appNow();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function localHHMM() {
  const { h, min } = appNow();
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
function choreToday() { return localDateStr(); }

// ── Kids ──────────────────────────────────────────────────
// This code lives in src/kids.js. It runs here, at the same place in the file as before.
require('./src/kids.js')({ app, db, broadcastUpdate });

// ── Built-in To-Do Lists (fully local, no external account needed) ───────────
// This code lives in src/todo-lists.js. It runs here, at the same place in the file as before.
// The Todoist / Google Tasks modules are created further down, so the to-do lists read them through this holder (filled in right after they exist).
const linkedProviders = { todoist: null, gtasks: null };
require('./src/todo-lists.js')({ app, db, demoCleanText, broadcastUpdate, linkedProviders });

// ── Shopping list ────────────────────────────────────────────────────────────
// This code lives in src/shopping.js. It runs here, at the same place in the file as before.
const { defaultShoppingListId } = require('./src/shopping.js')({ app, db, demoCleanText, broadcastUpdate });

// ── Voice control (Siri Shortcuts / similar) ──────────────────────────────────
// This code lives in src/voice-token.js. It runs here, at the same place in the file as before.
require('./src/voice-token.js')({ crypto, app, db });

// ── Home Assistant control (reverse direction): automation token ───────────
// This code lives in src/automation-token.js. It runs here, at the same place in the file as before.
require('./src/automation-token.js')({ crypto, app, db });

// ── Home Assistant control (reverse direction): MQTT ────────────────────────
// This code lives in src/mqtt-routes.js. It runs here, at the same place in the file as before.
require('./src/mqtt-routes.js')({ crypto, mqttBridge, app, getSetting: (k) => getSetting(k) });

// ── Voice add-item (Siri Shortcuts; also used by the Alexa skill) ──────────────────
// This code lives in src/voice-add-item.js. It runs here, at the same place in the file as before.
const { addVoiceItem } = require('./src/voice-add-item.js')({ crypto, app, db, broadcastUpdate, getSetting: (k) => getSetting(k), defaultShoppingListId });

// ── Voice control: Alexa skill ────────────────────────────────────────────────
// This code lives in src/alexa.js. It runs here, at the same place in the file as before.
require('./src/alexa.js')({ Alexa, ExpressAdapter, app, addVoiceItem });

// ── Chores API (definitions, a kid's day, the chart, ticking off) ────────────────────
// This code lives in src/chores.js. It runs here, at the same place in the file as before.
require('./src/chores.js')({ app, demoCleanText, db, upload, broadcastUpdate, getKidChores, getKidStreak, getKidStickerBalance, localDateStr, choreToday, ensureWeeklyAllowanceCredited: (...a) => ensureWeeklyAllowanceCredited(...a) });

// ── Stickers ──────────────────────────────────────────────────────────────────
// The routes live in src/stickers.js. They are registered here, at the same place in the file as before.
require('./src/stickers')({ app, db, choreToday, broadcastUpdate, getKidStickerBalance });

// ── Rewards ───────────────────────────────────────────────────────────────────
// This code lives in src/rewards.js. It runs here, at the same place in the file as before.
require('./src/rewards.js')({ app, db, broadcastUpdate, getKidStickerBalance, localDateStr });

// ── Favorites tab ────────────────────────────────────────────────────────────
// This code lives in src/favorites.js. It runs here, at the same place in the file as before.
require('./src/favorites.js')({ app, db, broadcastUpdate });

// ── Reassign a chore for one day ──────────────────────────────
// This code lives in src/chore-reassign.js. It runs here, at the same place in the file as before.
require('./src/chore-reassign.js')({ app, db, broadcastUpdate });

// ── Bonus / extra-credit chores ──────────────────────────────────────────────
// This code lives in src/bonus-chores.js. It runs here, at the same place in the file as before.
require('./src/bonus-chores.js')({ app, db, broadcastUpdate, choreToday });

// ── Allowance ──────────────────────────────────────────────────────────────────
// This code lives in src/allowance.js. It runs here, at the same place in the file as before.
const { ensureWeeklyAllowanceCredited } = require('./src/allowance.js')({ app, db, isSlave: () => isSlave(), localDateStr, broadcastUpdate, getKidStreak });

// ── Reminders (generic rotation reminders — trash/recycling day and
// This code lives in src/reminders.js. It runs here, at the same place in the file as before.
require('./src/reminders.js')({ path, fs, app, demoCleanText, db, UPLOAD_DIR, upload, broadcastUpdate });

// ── Calendar events API ──────────────────────────────────────
// This code lives in src/events-api.js. It runs here, at the same place in the file as before.
const { coerceOwnerProfileId } = require('./src/events-api.js')({ app, demoCleanText, db, broadcastUpdate, pushLocalEventToCalDAV: (...a) => pushLocalEventToCalDAV(...a), deleteEventFromCalDAV: (...a) => deleteEventFromCalDAV(...a), pushLocalEventToGoogle: (...a) => pushLocalEventToGoogle(...a), deleteEventFromGoogle: (...a) => deleteEventFromGoogle(...a) });

// ── Hidden events (show/hide individual events on the displays) ───────────────
// This code lives in src/hidden-events.js. It runs here, at the same place in the file as before.
require('./src/hidden-events.js')({ app, db, broadcastUpdate });

// ── User feedback / bug / feature submissions ─────────────────────────────────
// This code lives in src/feedback.js. It runs here, at the same place in the file as before.
require('./src/feedback.js')({ URL, path, fs, fetchWithTimeout, app, db, UPLOAD_DIR, upload, APP_VERSION, resolveFeedbackUrl, resolveFeedbackKey, DEVICE_ID, getSetting: (k) => getSetting(k), updateSetting });

// ── Family member profiles ───────────────────────────────────────────────────
// This code lives in src/profiles.js. It runs here, at the same place in the file as before.
require('./src/profiles.js')({ crypto, app, db, makeRateLimiter, broadcastUpdate, clientIp });

// ── Family message board ─────────────────────────────────────────────────────
// This code lives in src/messageboard.js. It runs here, at the same place in the file as before.
require('./src/messageboard.js')({ app, db, isSlave: () => isSlave(), getSetting: (k) => getSetting(k), demoCleanText, coerceOwnerProfileId, broadcastUpdate });

// ── Meal plan API ────────────────────────────────────────────────────────────
// This code lives in src/mealplan.js. It runs here, at the same place in the file as before.
require('./src/mealplan.js')({ app, db, isSlave: () => isSlave(), demoCleanText, broadcastUpdate });

// ── Shared file download helper (core: stays in server.js) ─────────────────────────
// Stream a URL (following redirects) to a file. No auth headers — this only
// ever fetches a pinned GitHub release asset.
// fetch() follows redirects on its own, so the manual redirect-recursion this
// used to need is gone along with the raw http.get() call.
async function downloadFile(url, destPath, timeoutMs = 60000) {
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'PiazzaHQ/1.0' }, timeoutMs, timeoutMessage: 'timeout' });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const out = fs.createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    Readable.fromWeb(res.body).pipe(out);
    out.on('finish', () => out.close(() => resolve()));
    out.on('error', reject);
  });
}

// ── Camera streaming (managed go2rtc) ─────────────────────────────────────────
// This code lives in src/camera.js. It runs here, at the same place in the file as before.
const { stopCameraService, reloadCameraService, attachCameraWsProxy, ensureGo2rtcBinary, getGo2rtcProc } = require('./src/camera.js')({ path, http, fs, crypto, IS_WIN, WebSocketClient, app, demoCleanText, dataPath, db, extractZip, requestIsRemote, remoteGateEnabled, findRemoteSession, broadcastUpdate, downloadFile, getSetting: (k) => getSetting(k), haWsRequest: (...a) => haWsRequest(...a), URL, spawn });

// ── Flight Map (live ADS-B aircraft tracking) ────────────────────────────────
// This code lives in src/flightmap.js. It runs here, at the same place in the file as before.
const { startFlightPolling, ensureStatesBasemap, flightmapWanted, ensureBasemap } = require('./src/flightmap.js')({ path, zlib, fs, crypto, fetchWithTimeout, app, dataPath, db, APP_VERSION, broadcastUpdate, downloadFile, getSetting: (k) => getSetting(k), URL, coerceOwnerProfileId });

// ── Settings API ─────────────────────────────────────────────────────────────

// Setting keys that hold a credential, a PIN, a private URL or personal
// contact info. Matched on the key name; see GET /api/settings below.
const SENSITIVE_SETTING_RE = /(^app_pin|_pin$|_pin_previous$|token|password|_pass$|secret|hmac|_key$|^license_key$|_url$|email|username|_user$)/i;

// What a settings WRITE answers with: the saved settings minus anything secret-shaped. Callers only ever look at a few plain keys (setup_complete, an error), and
// echoing the whole table back put every stored credential into logs, terminals and proxies on each save (printed in clear in a terminal on 2026-10-08).
function settingsWriteReply(rows) {
  const out = {};
  for (const r of rows) if (!SENSITIVE_SETTING_RE.test(r.key)) out[r.key] = r.value;
  return out;
}

// True when this request would have passed requireAuth() on its own merits
// (no PIN configured, a mirror presenting the host PIN, or a live session) —
// as opposed to being let through only because the route is public.
function settingsReadIsAuthed(req) {
  const pin = getPin();
  if (!pin) return true;
  const hostPin = req.headers['x-host-pin'];
  if (hostPin !== undefined) {
    if (hostPin === pin) return true;
    const prev = db.prepare(`SELECT value FROM settings WHERE key = 'app_pin_previous'`).get();
    if (prev && prev.value && hostPin === prev.value) return true;
  }
  // validToken() throws on a malformed token (timingSafeEqual length check);
  // on this public route that just means "not authenticated", not an error.
  try { return validToken(req.headers['x-session-token'] || req.query._token); } catch { return false; }
}

// GET /api/settings
app.get('/api/settings', (req, res) => {
  // Deliberately no-store: this endpoint is read immediately after writes in
  // several places (e.g. the Family Hub's feature toggles re-reading right
  // after a PUT to decide which tabs to show) — without this header, nothing
  // stops a browser from serving a cached pre-write response to that
  // follow-up read, since a plain res.json() has no caching directive of its
  // own either way. Confirmed this was a real, live bug: a toggle's checkbox
  // state updated (that's a local DOM change, no round-trip needed) but the
  // tab visibility it depends on stayed stale until a second toggle attempt.
  res.set('Cache-Control', 'no-store');
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // This route is on requireAuth()'s publicRoutes list (the wall display,
  // /hub and /kids read it with no login), so with a PIN set it answers
  // ANYONE who can reach the port — and it used to return the whole settings
  // table, including app_pin itself and every stored credential. Callers
  // that can't prove they hold the PIN get the same response minus anything
  // secret-shaped. Redaction is by name pattern rather than an allowlist so a
  // newly added display setting never silently goes missing on the wall.
  if (!settingsReadIsAuthed(req)) {
    for (const k of Object.keys(settings)) {
      if (SENSITIVE_SETTING_RE.test(k)) delete settings[k];
    }
  }
  res.json(settings);
});

// PUT /api/settings
app.put('/api/settings', (req, res) => {
  if (IS_DEMO) {
    // A demo tenant can tweak cosmetic prefs but must not touch anything that
    // (a) could lock out the next lessee, (b) points the box at an outside
    // service or a different update/host origin, or (c) carries a credential.
    // Silently drop those keys rather than 403 — the demo Settings UI hides
    // these sections anyway, so a soft no-op on the rest of the save is
    // friendlier than a hard failure.
    const demoSettingBlocked = (k) =>
      k === 'app_pin' || k === 'app_pin_previous' || k === 'current_pin_confirm' ||
      k === 'device_role' || k === 'host_url' || k === 'update_server_url' ||
      k === 'auto_push_updates' || k === 'update_schedule_mode' || k === 'update_schedule_time' ||
      k === 'license_key' || k === 'voice_token' ||
      /(_token|_pass|_password|_key|_secret|_url|_hmac)$/.test(k);
    for (const k of Object.keys(req.body)) {
      if (demoSettingBlocked(k)) delete req.body[k];
    }
  }
  // The tunnel's on/off, address and run token are owned by the /api/remote-access routes; a generic
  // settings save must not be able to switch a tunnel on, or point it somewhere else.
  for (const k of Object.keys(req.body)) {
    if ((/^remote_access_/.test(k) && k !== 'remote_access_require_auth') || /^remote_(alert_|known_devices)/.test(k)) delete req.body[k];
  }
  // Removing an existing PIN requires re-confirming the CURRENT one first —
  // an active session alone isn't enough for this specific, high-consequence
  // action. A stale or hijacked session could otherwise silently disable PIN
  // protection with lasting effect, long after that temporary access is
  // gone. Enforced here, not just in the app's own confirm prompt, since a
  // client-side-only check wouldn't stop a scripted request that skips it
  // entirely. Only gates the specific transition from a real PIN to none —
  // setting a PIN for the first time, or changing an existing one to a
  // different value, is unaffected.
  if ('app_pin' in req.body && String(req.body.app_pin) === '') {
    const cur = db.prepare(`SELECT value FROM settings WHERE key = 'app_pin'`).get();
    const curVal = cur ? cur.value : '';
    if (curVal !== '') {
      const confirmPin = (req.body.current_pin_confirm || '').toString();
      if (confirmPin !== curVal) {
        return res.status(400).json({ error: 'Incorrect PIN — enter the current PIN to confirm removing it.' });
      }
    }
  }
  // Changing the household LANGUAGE also moves the two settings that carry a language's conventions (24-hour clock, date order) - but only while they
  // still hold the shipped defaults, so a choice someone made on purpose is never overwritten. Going back to English undoes exactly what this did.
  if ('ui_language' in req.body) {
    const cur = getSetting('ui_language') || 'en', next = String(req.body.ui_language || 'en');
    if (next !== cur) {
      const tf = getSetting('time_format'), df = getSetting('date_format'), ws = getSetting('week_start_day');
      const applied = (getSetting('i18n_defaults_applied') || '').split(',').filter(Boolean);   // which of 'time' / 'week' this moved (so only those are undone)
      if (next !== 'en') {
        if (!('time_format' in req.body) && tf === '12') { req.body.time_format = '24'; if (!applied.includes('time')) applied.push('time'); }
        if (!('week_start_day' in req.body) && ws === '0') { req.body.week_start_day = '1'; if (!applied.includes('week')) applied.push('week'); }
        if (!('date_format' in req.body) && df === 'us_long') req.body.date_format = 'locale';
        req.body.i18n_defaults_applied = applied.join(',');
      } else {
        if (!('date_format' in req.body) && df === 'locale') req.body.date_format = 'us_long';
        if (!('time_format' in req.body) && tf === '24' && applied.includes('time')) req.body.time_format = '12';
        if (!('week_start_day' in req.body) && ws === '1' && applied.includes('week')) req.body.week_start_day = '0';
        req.body.i18n_defaults_applied = '';
      }
    }
  }
  const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  const updateMany = db.transaction((pairs) => {
    for (const [key, value] of pairs) {
      if (key === 'current_pin_confirm') continue; // not a real setting — only used for the check above
      // Remember the PIN's previous value across a change (set, changed, or
      // removed) — see the grace-period check in requireAuth() and the
      // ALWAYS_AUTH_ROUTES block below for why: a mirror's own stored copy
      // of the PIN is also its credential to authenticate the very sync
      // request that would tell it about a NEW value, so the instant the
      // PIN actually changes, a mirror still on the old one would otherwise
      // be permanently locked out of ever catching up — the same
      // chicken-and-egg problem whether the PIN was set, changed to a
      // different value, or removed then re-added. One generation of grace
      // (not indefinite) is enough: the mirror authenticates with its
      // stale value exactly once, pulls the new one down via the normal
      // sync it just proved itself for, and is caught up from then on.
      if (key === 'app_pin') {
        const cur = db.prepare(`SELECT value FROM settings WHERE key = 'app_pin'`).get();
        const curVal = cur ? cur.value : '';
        if (curVal !== String(value)) upsert.run('app_pin_previous', curVal);
      }
      upsert.run(key, String(value));
    }
  });
  updateMany(Object.entries(req.body));
  // Re-arm the scheduled-install timer immediately if either setting it
  // depends on changed — otherwise a mode switch or a new time wouldn't
  // take effect until the device next restarts, silently leaving the OLD
  // schedule (or lack of one) running in the background regardless of what
  // Settings now shows.
  if ('update_schedule_mode' in req.body || 'update_schedule_time' in req.body) {
    scheduleNextDailyUpdateInstall();
  }
  // The go2rtc port or the camera on/off switch changing needs the media
  // process rewritten/restarted (or stopped) to match.
  if ('go2rtc_port' in req.body || 'camera_service_autostart' in req.body) {
    try { reloadCameraService(); } catch {}
  }
  // Flight Map: enabling it (or changing the source/interval) should take
  // effect now — re-arm the poll loop and pre-fetch the basemap.
  if ('flightmap_enabled' in req.body || 'flightmap_source' in req.body || 'flightmap_poll_seconds' in req.body) {
    try { startFlightPolling(); } catch {}
    try { if (flightmapWanted()) { ensureBasemap().catch(() => {}); ensureStatesBasemap().catch(() => {}); } } catch {}
  }
  // MQTT (Home Assistant control): any broker-connection field changing
  // should reconnect now with the new values, not wait for a restart —
  // startMqttBridgeIfConfigured() tears down any existing connection first
  // (see mqtt-bridge.js's stop()), so this is safe to call repeatedly.
  if ('mqtt_enabled' in req.body || 'mqtt_broker_url' in req.body || 'mqtt_username' in req.body ||
      'mqtt_password' in req.body || 'mqtt_discovery_prefix' in req.body) {
    try { startMqttBridgeIfConfigured(); } catch (e) { console.error('[mqtt-bridge] restart:', e.message); }
  }
  // Severe weather alerts: turning it on (or changing location/severity)
  // should show up now, not up to 10 minutes from now — same fast-recheck
  // pattern PUT /api/ha-alerts already uses for its own condition alerts.
  if ('severe_weather_alerts_enabled' in req.body || 'severe_weather_min_severity' in req.body ||
      'weather_lat' in req.body || 'weather_lon' in req.body) {
    setTimeout(checkWeatherAlerts, 500);
  }
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  broadcastUpdate('settings');
  // 'feed_default_opacity' is baked into each event's color_opacity server-side
  // (see resolveEventOpacity()), not read live off state.settings by the client.
  // The 'settings' topic above doesn't trigger a fetchEvents() on the display
  // (it fires for many unrelated settings changes and would be wasteful if it
  // did), so without this, a master-opacity change would silently sit until
  // the 5-minute polling fallback caught up — unlike the per-feed (tier 2) and
  // per-widget (tier 1) sliders, which already broadcast 'events' on save via
  // PUT /api/feeds/:id and feel instant. This closes that gap.
  if ('feed_default_opacity' in req.body) {
    broadcastUpdate('events');
    // broadcastUpdate() above only reaches THIS device's own connected SSE
    // clients — on a multi-screen setup, a slave display is running its own
    // separate server.js and only learns about this change by polling this
    // (the host's) /api/sync/ping. That poll normally runs every 15s (SLOW),
    // dropping to 1.5s (FAST) only while markHostEditing() has marked the
    // host as actively being edited — previously only PUT /api/layouts/:orientation
    // did this, so a master-opacity change reached a slave's own display up
    // to 15s later than a layout change would, even though HOST_DATA_VERSION
    // (and therefore the slave's "something changed, pull now" detection)
    // was already bumped correctly regardless. Same fix applied to
    // PUT /api/feeds/:id below, for tier 2.
    markHostEditing();
  }
  res.json(settingsWriteReply(rows));
});

// ════════════════════════════════════════════════════════════════════════════
// MULTI-DEVICE (HOST / SLAVE) — Path C: designated host, slaves mirror its shared
// content read-only and cache it locally, keeping their own layout. Manual
// promotion: flip a slave's role to 'host' and it serves its last-synced data.
// ════════════════════════════════════════════════════════════════════════════

// Small fetch helpers over http/https for slave→host sync (host is reached over the
// LAN or Tailscale, so plain http). Time-limited so a dead host fails fast.
// If the host has its own PIN, this device's local copy of it (Settings →
// Multi-Device, or entered during setup) is attached on every one of these
// requests — see requireAuth()'s own handling of the same header for why a
// raw PIN header, not a session token, is the right mechanism for
// unattended server-to-server sync.
function _httpGet(url, timeoutMs, asBuffer) {
  return new Promise((resolve, reject) => {
    let lib = http;
    try { lib = new URL(url).protocol === 'https:' ? https : http; } catch {}
    const headers = { 'User-Agent': 'PiazzaHQ-Sync/1.0' };
    const hostPin = getSetting('app_pin'); // a slave's own PIN IS the household PIN — see setup wizard, which saves the host's PIN directly as this device's app_pin, not a separate value
    headers['x-host-pin'] = hostPin || ''; // always sent, even empty — see requireAuth()'s grace-period comment for why an omitted header can't safely mean the same thing as a deliberately empty one
    headers['x-mirror-license'] = getSetting('update_license_key') || '';   // lets the host recognise this mirror without a browser login
    // This device's own license key — the host checks this against its own
    // in /api/sync/export before handing over a settings snapshot (which
    // includes the license key itself, among everything else). Without
    // this, the only thing gating who could register as a mirror and
    // inherit a household's full settings/license was the host's own PIN —
    // and a host with no PIN configured meant literally anyone reachable
    // on the network (e.g. the same Tailscale tailnet) could set up a
    // mirror pointed at it and walk away with everything, no license or
    // email verification of any kind required.
    headers['x-mirror-license'] = getSetting('update_license_key') || '';
    const req = lib.get(url, { headers }, (resp) => {
      if (resp.statusCode && resp.statusCode >= 400) {
        // Read the body before rejecting — an error response almost always
        // has a real, human-readable message in it (like license_mismatch's
        // own explanation of exactly what's wrong and how to fix it), and
        // discarding it in favor of a bare 'HTTP 403' left no way for that
        // message to ever actually reach the person via setSyncStatus.
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          let message = 'HTTP ' + resp.statusCode;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (parsed && parsed.message) message = parsed.message;
            else if (parsed && parsed.error) message = parsed.error;
          } catch {} // body wasn't JSON (or wasn't parseable) — fall back to the bare status
          reject(new Error(message));
        });
        return;
      }
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (asBuffer) return resolve(buf);
        try { resolve(JSON.parse(buf.toString('utf8'))); }
        catch (e) { reject(new Error('bad JSON from host')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, () => { req.destroy(new Error('timeout')); });
  });
}
const fetchJSON = (url, timeoutMs) => _httpGet(url, timeoutMs, false);
const fetchBuffer = (url, timeoutMs) => _httpGet(url, timeoutMs, true);

// POST helper (no body) for endpoints that require POST, like /api/screen-checkin.
function fetchJSONPost(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const headers = { 'User-Agent': 'PiazzaHQ-Sync/1.0', 'Content-Length': 0 };
    const hostPin = getSetting('app_pin'); // a slave's own PIN IS the household PIN — see setup wizard, which saves the host's PIN directly as this device's app_pin, not a separate value
    headers['x-host-pin'] = hostPin || ''; // always sent, even empty — see requireAuth()'s grace-period comment for why an omitted header can't safely mean the same thing as a deliberately empty one
    headers['x-mirror-license'] = getSetting('update_license_key') || '';   // lets the host recognise this mirror without a browser login
    const req = lib.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST',
      headers,
    }, (resp) => {
      if (resp.statusCode && resp.statusCode >= 400) { resp.resume(); return reject(new Error('HTTP ' + resp.statusCode)); }
      const chunks = []; resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('bad JSON from host')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}


// Settings that are LOCAL to each device and must NEVER be overwritten by a sync.
// Everything else in `settings` is shared content (calendars, weather, news, etc.)
// and flows host → slave. The role/host-address/identity/update keys stay per-device.
const LOCAL_ONLY_SETTINGS = new Set([
  'device_role', 'host_lan_address', 'host_ts_address', 'host_port', 'setup_complete',
  'wifi_powersave_status', 'wifi_powersave_off', 'kiosk_link_status', 'kiosk_link_fix', // what THIS box's Wi-Fi / `kiosk` command housekeeping did (and its opt-outs) - a mirror must not show or inherit the host's
  'remote_access_require_auth', // per-device: whether THIS box demands the remote login from LAN devices
  'remote_alert_mode', 'remote_alert_email', 'remote_known_devices', 'remote_alert_last_sent', 'remote_alert_last_error',   // this box's own alert choices - never synced
  'remote_access_allow_control', 'remote_access_notice', // this box's own remote-access choices - never synced
  'remote_events_seen_at', // per-device: when THIS box's owner last looked at the remote sign-in activity
  'remote_access_mode', 'remote_access_address', 'remote_access_tunnel_token', 'remote_access_device_id', // this box's own tunnel - never synced to a mirror
  'tour_completed',      // per-device: whether THIS screen's spotlight tour has run
  'checklist_done', 'checklist_dismissed',  // per-device: getting-started checklist state
  'sync_interval_min', 'last_sync_at', 'last_sync_status',
  'briefing_last_sent',  // per-device: the host tracks its own send; never sync this
                         // or a slave's value could suppress the host's daily send
  'display_res_w', 'display_res_h', 'display_refresh_min',
  'severe_weather_seen', 'severe_weather_event_history', 'severe_weather_event_severity',   // this box's own alert bookkeeping - meaningless on a mirror
  'force_real_display', // per-device: one screen's scaling quirk shouldn't force another's preview detection
  'update_server_url', 'auto_push_updates',
  'app_pin_previous',    // this host's own recent PIN history — meaningless on a
                          // slave, and syncing it would interfere with the grace-
                          // period logic, which is specifically about THIS host's
                          // own last change, not whatever a slave last had
  'theme',              // visual theme can differ per screen
  'assigned_display_slug_remote', // profile the host assigned to this slave
  'display_name',       // each device keeps its own name
  'license_status_cache', 'trial_until_cache', 'limits_cache', 'host_conflict_cache', // each screen
                         // refreshes its own copy on the same schedule
  'no_license_since',    // genuinely per-device — each screen (host or mirror)
                          // independently checks in with its own key and tracks
                          // its own grace-period countdown; display.html reads
                          // and enforces on this locally on a mirror too, so
                          // syncing a host's value in would be actively wrong,
                          // not just redundant
  'device_machine_id_cache', // per-device by definition — syncing this would defeat
                              // the whole point of using it to detect a copied database
  'screen_device_id_cache', // THE critical one, found live: this being absent from this
                             // list meant it was synced host -> slave on every regular
                             // cycle, silently overwriting whatever unique id a mirror
                             // had with the host's own id — every single sync, forever,
                             // re-breaking any manual fix within minutes. Central-server
                             // identity for a mirror has to be able to differ from its
                             // host's; syncing it is the opposite of what this value is
                             // even for.
  'update_license_key', // ANOTHER real one, found live the same way: a mirror is
                         // supposed to hold its OWN independently-verified license key
                         // (checkMirrorLicense() above requires it to match the host's
                         // before sync is even allowed at all) — this being absent from
                         // this list meant a mirror's correctly-typed key kept getting
                         // silently overwritten by whatever the host had stored, every
                         // sync cycle (default every 5 minutes), even when the host's
                         // own value was itself wrong. Looked like "saving doesn't
                         // work" from the person's side — it saved fine every time,
                         // sync just kept quietly reverting it minutes later.
]);

// Tables that are LOCAL per device (this screen's own identity/presence) — never
// synced. Display PROFILES and their layouts ARE shared so a slave can render the
// profile the host assigns it (the host fully controls what each screen shows).
const LOCAL_ONLY_TABLES = new Set(['screens', 'feedback']);

const getSetting = (k) => {
  const r = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k);
  return r ? r.value : (defaultSettings[k] ?? '');
};
const isSlave = () => getSetting('device_role') === 'slave';

// Build the host's reachable base URL from a slave's stored addresses, preferring
// the Tailscale address (works on any network) and falling back to the LAN IP.
function hostBaseURL() {
  const ts = (getSetting('host_ts_address') || '').trim();
  const lan = (getSetting('host_lan_address') || '').trim();
  const port = (getSetting('host_port') || '3000').trim();
  const pick = ts || lan;
  if (!pick) return '';
  // Allow the user to include a port already; otherwise append ours.
  const hasPort = /:\d+$/.test(pick);
  return `http://${pick}${hasPort ? '' : ':' + port}`;
}

// The shareable data snapshot — everything a slave needs to mirror the host AND to
// take over as host later. Photos' binary files are synced separately (see below);
// here we send their metadata rows.
function buildSyncSnapshot() {
  const tableRows = (t) => db.prepare(`SELECT * FROM ${t}`).all();
  const sharedSettings = db.prepare(`SELECT key, value FROM settings`).all()
    .filter(r => !LOCAL_ONLY_SETTINGS.has(r.key));
  return {
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    settings: sharedSettings,
    photoSettings: tableRows('photo_settings'),
    tables: {
      events: tableRows('events'),
      reminders: tableRows('reminders'),
      ical_feeds: tableRows('ical_feeds'),
      ical_events: tableRows('ical_events'),
      hidden_events: tableRows('hidden_events'),
      photos: tableRows('photos'),
      saved_layouts: tableRows('saved_layouts'),
      briefing_recipients: tableRows('briefing_recipients'),
      displays: tableRows('displays'),
      layouts: tableRows('layouts'),
      kids: tableRows('kids'),
      chores: tableRows('chores'),
      chore_instances: tableRows('chore_instances'),
      allowance_ledger: tableRows('allowance_ledger'),
      todo_lists: tableRows('todo_lists'),
      todo_items: tableRows('todo_items'),
      // Shopping lists + items. Neither was in the snapshot before, so a Shopping
      // widget on a mirror had nothing to show. Guarded with `if (T.x)` on the
      // receiving side, so a mirror on an older version simply ignores these.
      shopping_lists: tableRows('shopping_lists'),
      shopping_items: tableRows('shopping_items'),
      // Added in 1.80.1 — a mirror's calendar widget could have "Show Sticker
      // Badges" checked (the widget config lives in `layouts`, which DID sync)
      // and still show nothing, because the sticker data itself never made it
      // into the snapshot. Same oversight shape as the earlier todo_lists/
      // todo_items gap noted above: a widget shipped, but the specific table(s)
      // backing it were never added here. Rewards and redemptions are included
      // alongside stickers for the same reason — a mirror showing "Ask for a
      // reward" progress with no reward catalog or redemption history would be
      // the identical bug one tab over.
      stickers: tableRows('stickers'),
      rewards: tableRows('rewards'),
      sticker_redemptions: tableRows('sticker_redemptions'),
      // Family member profiles — a mirror needs these to colour-code local
      // events by owner (owner_profile_id rides along in `events` above).
      profiles: tableRows('profiles'),
      messages: tableRows('messages'),
      cameras: tableRows('cameras'),
      meals: tableRows('meals'),
      // Saved flight subjects (incl. per-profile "My Flights"). flight_positions
      // is deliberately NOT synced — each device polls the ADS-B API itself and
      // builds its own trail, same as each device running its own go2rtc.
      flight_watch: tableRows('flight_watch'),
    },
  };
}

// HOST endpoint: a tiny, cheap "has anything changed?" probe. Slaves poll this
// frequently and only do a full sync when the version advances.
app.get('/api/sync/ping', (req, res) => {
  if (isSlave()) return res.status(409).json({ error: 'slave' });
  res.json({ dataVersion: HOST_DATA_VERSION, version: APP_VERSION, editing: Date.now() < HOST_EDITING_UNTIL });
});

// HOST endpoint: a slave fetches this to mirror the host. Read-only, no auth beyond
// Shared by every host-facing sync endpoint (settings export, photo listing,
// and any future one) — a single source of truth for this check specifically
// because having it duplicated per-route is exactly how /api/sync/photos
// ended up with zero verification in the first place while /api/sync/export
// had it: two copies of the same logic drifted apart. Returns a response
// object to send (403) if rejected, or null if the caller should proceed.
function checkMirrorLicense(req) {
  const hostLicense = getSetting('update_license_key');
  if (!hostLicense) return null; // nothing configured to protect
  const presented = req.headers['x-mirror-license'];
  if (presented === hostLicense) return null;
  return {
    error: 'license_mismatch',
    message: 'This device\'s license key doesn\'t match this household\'s — enter the correct license key in Settings → Version & License to sync as a Mirror.',
  };
}

app.get('/api/sync/export', (req, res) => {
  if (isSlave()) return res.status(409).json({ error: 'This device is a slave, not a host.' });
  // A host with no license configured has nothing worth protecting here —
  // sync proceeds as before. A host WITH a license requires the requesting
  // mirror to present the exact same one; without this, the only thing
  // gating who could register as a mirror and inherit a household's full
  // settings/license was this host's own PIN, and a host with no PIN set
  // meant literally anyone reachable on the network could do it with zero
  // license or email verification at all.
  const licenseError = checkMirrorLicense(req);
  if (licenseError) return res.status(403).json(licenseError);
  try {
    res.json(buildSyncSnapshot());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// HOST endpoint: list photo filenames so a slave can fetch any it's missing.
app.get('/api/sync/photos', (req, res) => {
  if (isSlave()) return res.status(409).json({ error: 'This device is a slave.' });
  // Same check as /api/sync/export above — this was the confirmed gap: a
  // mirror with a wrong/missing license key was still able to pull the full
  // photo listing (and, from there, the actual photo files themselves) from
  // this endpoint even after export was properly locked down, since this
  // route had no verification of its own at all.
  const licenseError = checkMirrorLicense(req);
  if (licenseError) return res.status(403).json(licenseError);
  const rows = db.prepare(`SELECT filename FROM photos`).all();
  const files = rows.map(r => r.filename).filter(Boolean);
  // Chore icons may be uploaded images (stored as "img:<filename>"); include those
  // so a kid's tablet pointed at a slave shows the picture, not a broken image.
  const choreIcons = db.prepare(`SELECT icon FROM chores WHERE icon LIKE 'img:%'`).all();
  for (const c of choreIcons) {
    const fn = c.icon.slice(4);
    if (fn) files.push(fn);
  }
  // Reminder icons (uploaded images, icon_type='image') — same reasoning as
  // chore icons just above: without this, a mirror would have the DB row
  // (icon_image references a filename) but never the actual file, showing a
  // broken image instead of the picture.
  const reminderIcons = db.prepare(`SELECT icon_image FROM reminders WHERE icon_type = 'image' AND icon_image IS NOT NULL`).all();
  for (const r of reminderIcons) {
    if (r.icon_image) files.push(r.icon_image);
  }
  res.json({ files });
});

// Apply a fetched snapshot into THIS device's database (slave side). Replaces the
// shared tables and shared settings wholesale; leaves all LOCAL_ONLY_* untouched.
const applySyncSnapshot = db.transaction((snap) => {
  // Shared settings (skip anything local). IMPORTANT: a blank/empty value coming from
  // the host must NEVER overwrite a populated local value. This protects credentials
  // and API keys (weather key, Todoist token, SMTP password, etc.) from being wiped if
  // the host happens to have them empty — the data-loss bug that motivated this guard.
  // app_pin is the one deliberate exception: going from set to empty there IS the
  // legitimate, intended action of removing the household PIN (not accidental data
  // loss the way a blanked-out API key would be), so blocking it here would silently
  // defeat the whole point of syncing app_pin in the first place.
  const NEVER_BLOCK_EMPTY_SYNC = new Set(['app_pin']);
  const upSet = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  const getCur = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  for (const { key, value } of snap.settings || []) {
    if (LOCAL_ONLY_SETTINGS.has(key)) continue;
    const incoming = (value ?? '').toString();
    if (incoming.trim() === '' && !NEVER_BLOCK_EMPTY_SYNC.has(key)) {
      // Don't let an empty incoming value clobber a non-empty existing one.
      const cur = getCur.get(key);
      if (cur && (cur.value ?? '').toString().trim() !== '') continue;
    }
    upSet.run(key, incoming);
  }
  // Photo settings (shared).
  if (Array.isArray(snap.photoSettings)) {
    const upPS = db.prepare(`INSERT OR REPLACE INTO photo_settings (key, value) VALUES (?, ?)`);
    for (const { key, value } of snap.photoSettings) upPS.run(key, String(value ?? ''));
  }
  // Shared tables: clear then repopulate from the host's rows.
  const T = snap.tables || {};
  const replaceTable = (name, rows) => {
    if (!Array.isArray(rows)) return;
    db.prepare(`DELETE FROM ${name}`).run();
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const ph = cols.map(() => '?').join(',');
    const ins = db.prepare(`INSERT INTO ${name} (${cols.join(',')}) VALUES (${ph})`);
    for (const row of rows) ins.run(...cols.map(c => row[c]));
  };
  replaceTable('events', T.events);
  replaceTable('reminders', T.reminders);
  replaceTable('ical_feeds', T.ical_feeds);
  replaceTable('ical_events', T.ical_events);
  replaceTable('hidden_events', T.hidden_events);
  replaceTable('photos', T.photos);
  replaceTable('saved_layouts', T.saved_layouts);
  replaceTable('briefing_recipients', T.briefing_recipients);
  replaceTable('displays', T.displays);
  replaceTable('layouts', T.layouts);
  if (T.kids) replaceTable('kids', T.kids);
  if (T.chores) replaceTable('chores', T.chores);
  if (T.chore_instances) replaceTable('chore_instances', T.chore_instances);
  if (T.allowance_ledger) replaceTable('allowance_ledger', T.allowance_ledger);
  // Added after the fact — a To-Do widget placed on a slave's assigned layout
  // was always empty, since list/item data never made it into the sync at all.
  if (T.todo_lists) replaceTable('todo_lists', T.todo_lists);
  if (T.todo_items) replaceTable('todo_items', T.todo_items);
  if (T.shopping_lists) replaceTable('shopping_lists', T.shopping_lists);
  if (T.shopping_items) replaceTable('shopping_items', T.shopping_items);
  // See buildSyncSnapshot()'s matching comment — these three were missing
  // entirely, so a mirror's sticker badges, reward catalog, and redemption
  // history/balances all silently stayed empty regardless of layout settings.
  if (T.stickers) replaceTable('stickers', T.stickers);
  if (T.rewards) replaceTable('rewards', T.rewards);
  if (T.sticker_redemptions) replaceTable('sticker_redemptions', T.sticker_redemptions);
  if (T.profiles) replaceTable('profiles', T.profiles);
  if (T.messages) replaceTable('messages', T.messages);
  if (T.cameras) replaceTable('cameras', T.cameras);
  if (T.meals) replaceTable('meals', T.meals);
  if (T.flight_watch) replaceTable('flight_watch', T.flight_watch);
});

// Pull any photo image files this slave is missing, so cached photos actually
// render offline, AND remove any local file that's no longer referenced by the
// host at all (a photo deleted on the host previously just stayed on every
// slave's disk forever — a slow storage leak on Pi SD cards over time).
// Best-effort throughout: failures here don't fail the whole sync.
async function syncPhotoFiles(base) {
  try {
    const list = await fetchJSON(`${base}/api/sync/photos`, 4000);
    const want = new Set(list.files || []);
    const uploadsDir = UPLOAD_DIR;
    fs.mkdirSync(uploadsDir, { recursive: true });
    for (const fn of want) {
      const dest = path.join(uploadsDir, fn);
      if (fs.existsSync(dest)) continue;            // already have it
      if (fn.includes('/') || fn.includes('..')) continue; // safety
      try {
        const buf = await fetchBuffer(`${base}/uploads/${encodeURIComponent(fn)}`, 8000);
        if (buf && buf.length) fs.writeFileSync(dest, buf);
      } catch { /* skip this file, try others */ }
    }
    // Remove local files the host no longer references at all.
    try {
      const existing = fs.readdirSync(uploadsDir);
      for (const fn of existing) {
        if (fn.startsWith('.')) continue; // never touch dotfiles (e.g. .gitkeep)
        if (want.has(fn)) continue;
        const full = path.join(uploadsDir, fn);
        try { if (fs.statSync(full).isFile()) fs.unlinkSync(full); } catch { /* skip */ }
      }
    } catch { /* directory listing failed; leave files as-is */ }
  } catch { /* photo list unreachable; keep whatever we have cached */ }
}

// One sync pass (slave side): fetch the host snapshot, apply it, pull new photos.
let _syncing = false;
// Real bug this fixes: runSyncOnce() is called right after any edit gets
// proxied to the host (see proxyWriteToHost/proxySettingsWrite above), to
// pull that change back down to this slave immediately rather than waiting
// for the next periodic tick. But if a periodic background sync happened
// to already be mid-flight at that exact moment — having started fetching
// /api/sync/export from the host BEFORE this edit reached it — the old
// guard below just silently returned (`if (_syncing) return`), leaving
// this edit's own request for a fresh pull entirely dropped. The
// in-progress sync then finishes a moment later with a snapshot that
// predates the edit, applies it, and broadcasts — which looks exactly like
// the edit reverting a couple seconds after it visibly applied. Nothing
// else was requesting a resync until the next scheduled interval (up to
// several minutes away), so the "revert" would actually stick.
// _syncQueued turns that silent drop into a guaranteed follow-up: a call
// that arrives mid-flight sets the flag instead of returning early, and
// the in-progress run checks it in its `finally` and immediately re-runs
// once, this time genuinely fetching a snapshot that includes the edit.
let _syncQueued = false;
// The DATA portion of a sync only — fetch the host's snapshot and apply it
// (settings/events/layouts/photos-table-rows/etc., all fast: one network
// round-trip + an in-process SQLite transaction). Deliberately excludes
// syncPhotoFiles() (copying actual photo BINARIES, which can genuinely take
// seconds to minutes on a big library) and registerWithHost() (presence
// heartbeat) — neither affects whether layout/event/settings DATA reads
// back correctly on this device, which is the specific thing a write that's
// waiting on this needs. Returns true on success, false on failure (and
// records the failure via setSyncStatus either way) — never throws, same
// contract as runSyncOnce() itself, so callers don't need their own
// try/catch.
//
// Concurrency: deliberately NOT deduplicated — every call does its own
// independent fetch. A beta.8 version piggybacked concurrent calls onto
// whichever fetch was already in flight, reasoning that repeated full
// resyncs from the beta.7-era duplicate-listener bug were wasteful, real
// load. True, but it introduced a worse, genuinely wrong bug: this
// function's caller — proxyWriteToHost(), on every write a slave makes —
// needs a GUARANTEE that what it awaits reflects the write that JUST
// happened. scheduleChangeWatch() polls the host as often as every 1.5s
// during active editing and independently calls into this same sync path;
// if THAT background fetch had already started (querying the host)
// BEFORE this device's own write reached the host, and a write's own call
// landed while it was still in flight, piggybacking handed back a
// "success" built from a snapshot that predated the very write it was
// supposed to be confirming — confirmed and reproduced: a Copy & Replace
// reporting a clean, warning-free "success," yet the display still
// showing the pre-edit layout even after a hard reload immediately
// afterward, because the local database genuinely didn't have the new
// data yet. Correctness has to come first here — an occasional redundant
// fetch during heavy concurrent activity is real but minor cost; a false
// "it worked" is not.
async function syncDataOnly() {
  if (!isSlave()) return true;
  const base = hostBaseURL();
  if (!base) { setSyncStatus('error: no host address set'); return false; }
  try {
    const snap = await fetchJSON(`${base}/api/sync/export`, 8000);
    if (snap && snap.error) throw new Error(snap.error);
    applySyncSnapshot(snap);
    setSyncStatus('ok');
    broadcastUpdate('settings'); broadcastUpdate('events'); broadcastUpdate('reminders'); broadcastUpdate('photos'); broadcastUpdate('layout'); broadcastUpdate('cameras');
    // The cameras table may have changed — regenerate this slave's own go2rtc
    // config and (re)start/stop its media process to match.
    try { reloadCameraService(); } catch {}
    return true;
  } catch (e) {
    setSyncStatus('error: ' + String(e.message || e).slice(0, 120));
    return false;
  }
}

// Full sync: data (above) plus the slower stuff — actual photo file
// transfers and the host presence/profile heartbeat. This is what the
// periodic background timer runs; a write that's waiting to respond calls
// syncDataOnly() directly instead (see proxyWriteToHost()) so it isn't
// blocked on photo transfers that have nothing to do with the write it's
// confirming.
async function runSyncOnce() {
  if (!isSlave()) return;
  if (_syncing) { _syncQueued = true; return; }
  const base = hostBaseURL();
  if (!base) { setSyncStatus('error: no host address set'); return; }
  _syncing = true;
  try {
    const ok = await syncDataOnly();
    if (!ok) return; // syncDataOnly() already recorded the failure status
    await syncPhotoFiles(base);
    await registerWithHost(base);  // also refreshes presence + assigned profile
  } catch (e) {
    setSyncStatus('error: ' + String(e.message || e).slice(0, 120));
  } finally {
    _syncing = false;
    if (_syncQueued) {
      _syncQueued = false;
      runSyncOnce().catch(() => {}); // guaranteed fresh follow-up, not awaited — same fire-and-forget style as every other caller of this function
    }
  }
}

// Register/heartbeat this slave WITH the host: keeps it "online" in the host's
// Displays tab and learns the profile the host assigned us. This is LIGHT (one quick
// POST) and runs on a fast timer independent of the heavy data sync, so presence
// stays current and host profile changes apply within ~30s.
async function registerWithHost(base) {
  base = base || hostBaseURL();
  if (!base || !isSlave()) return;
  try {
    const myId = encodeURIComponent(DEVICE_ID);
    // Prefer the name the user actually gave THIS screen (its own screens-table row,
    // keyed by this Pi's canonical id) over the generic display_name default, so the
    // host shows the same name the slave calls itself (e.g. "Mirror", not "Home").
    let localName = '';
    try {
      const row = db.prepare(`SELECT name FROM screens WHERE device_id = ?`).get(DEVICE_ID);
      if (row && row.name) localName = row.name;
    } catch {}
    const myName = encodeURIComponent(localName || getSetting('display_name') || 'Screen');
    const addrs = getReachableAddresses();
    const myAddr = encodeURIComponent((addrs.tailscale || addrs.lan || '') + ':' + PORT);
    const reg = await fetchJSONPost(
      `${base}/api/screen-checkin?screen=${myId}&remote=1&name=${myName}&addr=${myAddr}&version=${encodeURIComponent(APP_VERSION)}`, 5000
    );
    if (reg && typeof reg.assigned_display_slug === 'string') {
      const cur = getSetting('assigned_display_slug_remote');
      if (cur !== reg.assigned_display_slug) {
        db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('assigned_display_slug_remote', ?)`)
          .run(reg.assigned_display_slug);
        // Keep the slave's OWN screens-table row in sync with the host's assignment,
        // so the slave's app shows the same profile the host shows (they mirror).
        // Without this, the slave's app keeps displaying a stale local value while the
        // TV correctly follows the host — the disagreement we saw before.
        try {
          db.prepare(`UPDATE screens SET assigned_display_slug = ? WHERE device_id = ?`)
            .run(reg.assigned_display_slug, DEVICE_ID);
          broadcastUpdate('screens');
        } catch {}
        broadcastUpdate('settings'); // slave display re-resolves its profile live
        // Also fire the SAME reliable command the app uses for a local screen: tell
        // THIS slave's own connected display to switch profiles (a clean reload with
        // ?display=slug). The host's switch-profile command can't reach a remote
        // slave's display (it's on the slave's SSE, not the host's), so the slave
        // must issue it locally. This is the path the local profile box already uses.
        try { sendScreenCommand(DEVICE_ID, 'switch-profile', { display: reg.assigned_display_slug }); } catch {}
        console.log(`Host assigned this screen profile: "${reg.assigned_display_slug}" — switching display.`);
      }
    }
    // Sync the REST of this screen's config — ambient mode, screensaver source,
    // TV control, corner, orientation, etc. Previously the check-in response only
    // ever carried assigned_display_slug, so every OTHER per-screen setting
    // changed via the app silently never reached a remote slave's own local
    // database at all: it stayed on the host's copy only. This went unnoticed
    // because most testing exercised the host's own screen directly, where the
    // host's database change already IS the local database, no sync needed.
    if (reg && reg.config) {
      const c = reg.config;
      const before = db.prepare(`SELECT * FROM screens WHERE device_id = ?`).get(DEVICE_ID) || {};
      const changed = (k) => (before[k] ?? '') !== (c[k] ?? '');
      const ambientChanged = changed('ambient_mode');
      const cornerChanged = changed('ambient_clock_corner');
      const fitChanged = changed('ambient_photo_fit');
      const tagChanged = changed('screensaver_tag');
      const photoIdChanged = changed('screensaver_photo_id');
      const orientationChanged = changed('screen_orientation') || changed('screen_rotation');
      const infoCornerChanged = changed('info_corner');
      const anyChanged = ambientChanged || cornerChanged || fitChanged || tagChanged || photoIdChanged
        || orientationChanged || infoCornerChanged || changed('tv_control_type') || changed('tv_ip')
        || changed('tv_schedule_on') || changed('tv_schedule_off');
      if (anyChanged) {
        db.prepare(`UPDATE screens SET
            info_corner = ?, screen_orientation = ?, screen_rotation = ?,
            screensaver_tag = ?, screensaver_photo_id = ?, ambient_mode = ?,
            ambient_clock_corner = ?, ambient_photo_fit = ?,
            tv_control_type = ?, tv_ip = ?, tv_schedule_on = ?, tv_schedule_off = ?
          WHERE device_id = ?`)
          .run(c.info_corner, c.screen_orientation, c.screen_rotation, c.screensaver_tag,
               c.screensaver_photo_id, c.ambient_mode, c.ambient_clock_corner, c.ambient_photo_fit,
               c.tv_control_type, c.tv_ip, c.tv_schedule_on, c.tv_schedule_off, DEVICE_ID);
        broadcastUpdate('screens');
        // Fire the same LIVE commands the host's own PUT handler already issues for
        // these exact fields — reused here rather than duplicated, so a remote
        // slave's display updates instantly instead of waiting for its next reload.
        if (orientationChanged) sendScreenCommand(DEVICE_ID, 'reload', {});
        if (tagChanged || photoIdChanged || cornerChanged || fitChanged) {
          sendScreenCommand(DEVICE_ID, 'refresh-photos', {});
        }
        if (ambientChanged) sendScreenCommand(DEVICE_ID, 'set-ambient-mode', { mode: c.ambient_mode || '' });
        if (infoCornerChanged) sendScreenCommand(DEVICE_ID, 'set-info-corner', { corner: c.info_corner || '' });
        console.log('Host updated this screen\'s config — synced locally.');
      }
    }
  } catch (e) {
    // A 401 here means the host actively rejected this screen's PIN — wrong,
    // blank, or stale after the household PIN changed on the host. That's a
    // fundamentally different failure than "host briefly unreachable": it
    // will fail identically on every single retry forever until someone
    // fixes it, so it deserves a visible status and a log line, not the
    // same silent shrug a transient network blip gets below.
    if (/^HTTP 401/.test(String(e.message))) {
      console.error(`registerWithHost: host rejected this screen's PIN (401) — check Settings → Security → App PIN matches the host's PIN.`);
      setSyncStatus(`error: host rejected this screen's PIN — check Settings → Security → App PIN`);
    }
    /* any other failure: host briefly unreachable; the heartbeat will retry in 30s */
  }
}
function setSyncStatus(status) {
  const up = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  up.run('last_sync_status', status);
  if (status === 'ok') up.run('last_sync_at', new Date().toISOString());
}

// Slave sync scheduler — re-reads the interval each tick so changes take effect
// without a restart. Hosts do nothing here.
let _syncTimer = null;
function scheduleSync() {
  if (_syncTimer) clearTimeout(_syncTimer);
  const tick = async () => {
    if (isSlave()) await runSyncOnce();
    const mins = Math.max(1, Math.min(60, parseInt(getSetting('sync_interval_min')) || 5));
    _syncTimer = setTimeout(tick, mins * 60_000);
  };
  // First pass shortly after boot so a slave populates quickly.
  _syncTimer = setTimeout(tick, 3000);
}
scheduleSync();

// Fast change-watcher: in addition to the periodic full sync above, a slave polls
// the host's cheap /sync/ping every ~15s and pulls immediately when the host's data
// version advances. This makes host edits (layout saves, content changes) appear on
// slaves within seconds instead of waiting for the slow timer.
let _lastSeenHostVersion = 0;
let _watchTimer = null;
function scheduleChangeWatch() {
  if (_watchTimer) clearTimeout(_watchTimer);
  const SLOW = 15_000, FAST = 1500; // normal cadence vs. active-editing cadence
  let nextDelay = SLOW;
  const tick = async () => {
    nextDelay = SLOW;
    try {
      if (isSlave()) {
        const base = hostBaseURL();
        if (base) {
          const ping = await fetchJSON(`${base}/api/sync/ping`, 4000);
          if (ping && ping.dataVersion && ping.dataVersion !== _lastSeenHostVersion) {
            _lastSeenHostVersion = ping.dataVersion;
            await runSyncOnce();
          }
          // While the host is actively being edited (e.g. someone arranging the
          // layout), poll quickly so changes mirror in near-real-time. Relax to the
          // normal interval as soon as editing stops.
          if (ping && ping.editing) nextDelay = FAST;
        }
      }
    } catch { /* host unreachable; the slow timer + cache keep us going */ }
    _watchTimer = setTimeout(tick, nextDelay);
  };
  _watchTimer = setTimeout(tick, 8000);
}
scheduleChangeWatch();

// Fast presence heartbeat: a slave re-registers with its host every 30s, independent
// of the heavy data sync. This keeps it reliably "online" in the host's Displays tab
// (fixing the offline flicker) and means a profile change from the host applies
// within ~30s even if a full sync isn't due.
let _hbTimer = null;
function scheduleHostHeartbeat() {
  if (_hbTimer) clearTimeout(_hbTimer);
  const tick = async () => {
    if (isSlave()) await registerWithHost();
    _hbTimer = setTimeout(tick, 30_000);
  };
  _hbTimer = setTimeout(tick, 5000);
}
scheduleHostHeartbeat();

// Manual endpoints for the control app.
app.post('/api/sync/now', async (req, res) => {
  if (!isSlave()) return res.status(409).json({ error: 'Only a slave can sync.' });
  await runSyncOnce();
  res.json({ status: getSetting('last_sync_status'), at: getSetting('last_sync_at') });
});

// Test connectivity to the configured host without applying anything.
app.get('/api/sync/test', async (req, res) => {
  const base = hostBaseURL();
  if (!base) return res.json({ ok: false, error: 'No host address set.' });
  try {
    const snap = await fetchJSON(`${base}/api/sync/export`, 6000);
    if (snap && snap.error) return res.json({ ok: false, error: snap.error, via: base });
    res.json({ ok: true, via: base, hostVersion: snap.version, photos: (snap.tables?.photos||[]).length });
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e), via: base });
  }
});

// Promote this device to host (manual failover). Stops syncing; it now serves its
// own last-cached data as the source of truth. Other slaves must be re-pointed here.
app.post('/api/sync/promote', (req, res) => {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('device_role', 'host')`).run();
  setSyncStatus('promoted to host');
  broadcastUpdate('settings');
  res.json({ ok: true, role: 'host' });
});

// Edit-from-any-device: on a slave, writes to shared content/layout are PROXIED to
// the host (the source of truth) instead of being rejected. The host applies the
// change, then normal sync brings it back down to this slave. This lets you open
// ANY device's app and edit everything — the slave just forwards to the host.
// (Registered early — see the app.use near express.json — so it runs before routes.)
function slaveWriteGuard(req, res, next) {
  if (!isSlave()) return next();
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const p = req.path;
  // The /assign route (set a screen's profile) must reach the HOST so the assignment
  // is recorded there and mirrors back to all apps — even when done from the slave's
  // app. Presence/identity routes (checkin, config) stay local.
  if (/^\/api\/screens\/[^/]+\/assign$/.test(p)) return proxyWriteToHost(req, res);
  // These are genuinely LOCAL to this device — never proxy them to the host.
  const localOnly = p.startsWith('/api/sync/') ||
                    p.startsWith('/api/screen') ||      // presence check-in / config
                    p.startsWith('/api/tv-schedule') || // real bug found live: PUT/DELETE here
                    // live at /api/tv-schedule/:id, NOT under /api/screens/, so this was
                    // falling through to proxyWriteToHost() below despite TV schedule
                    // slots being per-device local data (same reasoning as TV control
                    // itself — see runTvAction's own comment on why this can't be proxied).
                    // On a slave this meant editing/deleting a schedule slot silently hit
                    // the HOST's copy instead of this device's own — which never has a
                    // matching row (slots are created locally via /api/screens/:id/tv-
                    // schedule, correctly covered by the /api/screen prefix above), so the
                    // host's delete/update always affected 0 rows while still reporting
                    // {ok:true}. Reproduced live on a real slave; a clean non-slave
                    // instance never showed it since the guard no-ops entirely there.
                    p === '/api/update' ||              // receive host-pushed update
                    p === '/api/update-from-server' ||   // this device pulling+installing its own update
                    p === '/api/install-server' ||       // installs the mothership onto THIS device's filesystem
                    p === '/api/backup/restore' ||       // restores DATA onto this device's own calendar.db
                    p === '/api/kiosk/exit' ||            // already self-guards to 127.0.0.1 only — proxying it
                    // to the host meant the host saw the slave's real network IP instead of
                    // loopback and correctly rejected it, so the Windows kiosk-exit button
                    // silently failed on any slave. All four found the same way as the
                    // tv-schedule bug above: each acts on THIS device's own filesystem/process
                    // (installs/restores CODE or DATA here, or closes the browser running
                    // here) — proxying any of them to the host means either the WRONG
                    // device gets updated/restored/closed, or (with no host reachable, as
                    // confirmed live) it just fails outright with "No host configured to
                    // forward this edit to" instead of doing anything at all.
                    /^\/api\/update-backups\/[^/]+\/[^/]+\/restore$/.test(p) || // same — restores CODE from THIS device's own backup dir
                    p.startsWith('/api/auth') ||        // local login/PIN
                    p.startsWith('/api/remote-auth') || // this device's own remote password/sessions — never proxied to the host
                    p.startsWith('/api/display/') ||    // this device's own kiosk browser reporting that it drew (must not be forwarded to the host)
                    p.startsWith('/api/remote-access') || // this device's own tunnel - a mirror must answer "use your host" itself, not switch the HOST's tunnel on
                    // This device's OWN license key, not the host's — unlike most proxied
                    // writes, a mirror legitimately holds its own independently-verified
                    // license key (see LOCAL_ONLY_SETTINGS' own comment on
                    // update_license_key) and can have its own "other devices on this
                    // license" to browse/revoke — proxying to the host would act on the
                    // HOST's license instead of whichever one this device actually presents.
                    p.startsWith('/api/license-devices');
  if (localOnly) return next();
  // Settings writes are split: device-local keys stay here; shared keys proxy to host.
  if (p.startsWith('/api/settings')) return proxySettingsWrite(req, res, next);
  // HA control actions proxy to the host (it owns the HA connection), but the
  // state read-back stays LOCAL to this slave — so after a proxied action,
  // drop this device's own cached state for the touched entities. Without
  // this, the client's post-action confirm fetch (which hits THIS server's
  // /api/ha/state) serves the pre-action value and the widget appears to
  // snap back / not reflect the change. Real report: HA widgets on a slave
  // display mismatching the actual device state after a tap.
  if (p === '/api/ha/call-action' || p === '/api/ha/call-group-action') {
    const b = req.body || {};
    const ids = [];
    if (b.entityId) ids.push(b.entityId);
    if (Array.isArray(b.entityIds)) ids.push(...b.entityIds);
    if (ids.length) res.on('finish', () => { for (const id of ids) haStateCache.delete(id); });
    return proxyWriteToHost(req, res);
  }
  // Everything else that writes shared content/layout is proxied to the host.
  return proxyWriteToHost(req, res);
}

// Settings PUT on a slave: apply only the LOCAL keys here; forward any SHARED keys
// to the host so they become the new source of truth.
async function proxySettingsWrite(req, res, next) {
  const body = req.body || {};
  const localKeys = {}, sharedKeys = {};
  for (const [k, v] of Object.entries(body)) {
    if (LOCAL_ONLY_SETTINGS.has(k)) localKeys[k] = v; else sharedKeys[k] = v;
  }
  // Apply local keys to this device immediately.
  if (Object.keys(localKeys).length) {
    const up = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    for (const [k, v] of Object.entries(localKeys)) up.run(k, String(v));
    broadcastUpdate('settings');
  }
  // Forward shared keys to the host, then sync so they reflect back locally.
  if (Object.keys(sharedKeys).length) {
    try {
      await proxyJSONToHost('PUT', '/api/settings', sharedKeys);
      runSyncOnce().catch(()=>{});
    } catch (e) {
      return res.status(502).json({ error: 'Could not reach host to save: ' + e.message });
    }
  }
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  res.json(settingsWriteReply(rows));
}

// Generic proxy of a write request to the host. Handles JSON bodies and multipart
// (file uploads) by streaming the raw request. Returns the host's response verbatim
// (plus a syncWarning field if the local sync-back below fails — see its comment).
function proxyWriteToHost(req, res) {
  const base = hostBaseURL();
  if (!base) return res.status(502).json({ error: 'No host configured to forward this edit to.' });
  // For JSON content we already parsed the body; re-serialize and forward.
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    return proxyJSONToHost(req.method, req.originalUrl, req.body)
      .then(async out => {
        // AWAITED, not fire-and-forget — confirmed real bug (a layout Copy
        // & Replace reporting success while the display kept showing the
        // pre-edit widgets indefinitely, even after a full reload). This
        // device's own local tables are what every subsequent GET on THIS
        // device reads from — completely independent of the host, and
        // reads are NEVER proxied (see the routing above) — so they won't
        // reflect this write until the sync-back actually finishes.
        // Previously the client got the host's {ok:true} the instant the
        // HOST accepted the write, long before this slave's own copy had
        // caught up, with nothing to ever tell it that gap existed.
        // syncDataOnly() specifically, not the full runSyncOnce() — this
        // response shouldn't be held up by photo file transfers that have
        // nothing to do with whether the layout/event/settings DATA this
        // write just changed reads back correctly.
        const synced = await syncDataOnly();
        if (!synced) {
          const status = getSetting('last_sync_status') || '';
          // The write itself is still safe — the host already has it,
          // and that's the source of truth — but THIS device hasn't
          // caught up, so anything read back from it right now (the app,
          // the physical display, both reading this same local copy) is
          // still stale. Surfaced honestly instead of a false "it worked."
          return res.status(out.status).json({ ...out.json, syncWarning: 'Saved to the host, but this device couldn\u2019t sync the change back to itself yet: ' + status.slice(6).trim() });
        }
        res.status(out.status).json(out.json);
      })
      .catch(e => res.status(502).json({ error: 'Host unreachable: ' + e.message }));
  }
  // For multipart/other (e.g. photo upload), stream the raw bytes through.
  try {
    let u = new URL(base + req.originalUrl);
    const lib = u.protocol === 'https:' ? https : http;
    // Same host-PIN attachment as proxyJSONToHost()/the fetch helpers above —
    // this branch builds its own request headers separately (spreading the
    // original inbound request's headers to preserve multipart boundaries
    // etc.), so it needed the same fix applied here too rather than being
    // covered by fixing the shared helpers alone.
    const headers = { ...req.headers, host: u.host };
    const hostPin = getSetting('app_pin'); // a slave's own PIN IS the household PIN — see setup wizard, which saves the host's PIN directly as this device's app_pin, not a separate value
    headers['x-host-pin'] = hostPin || ''; // always sent, even empty — see requireAuth()'s grace-period comment for why an omitted header can't safely mean the same thing as a deliberately empty one
    headers['x-mirror-license'] = getSetting('update_license_key') || '';   // lets the host recognise this mirror without a browser login
    const preq = lib.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method,
      headers,
    }, (presp) => {
      res.status(presp.statusCode || 502);
      const chunks = [];
      presp.on('data', c => chunks.push(c));
      presp.on('end', async () => {
        // Same await-before-responding fix as the JSON branch above, same
        // reasoning — a photo upload (the main thing that lands here)
        // wouldn't show up on this device until its own sync caught up
        // either. No syncWarning injection here, unlike the JSON branch:
        // this response isn't reliably JSON (could be an image, or an
        // empty body from a pure pass-through), so there's no safe place
        // to attach one without risking corrupting a non-JSON payload.
        await runSyncOnce();
        const buf = Buffer.concat(chunks);
        const rct = presp.headers['content-type'] || '';
        if (rct.includes('application/json')) { try { return res.json(JSON.parse(buf.toString())); } catch {} }
        res.send(buf);
      });
    });
    preq.on('error', e => res.status(502).json({ error: 'Host unreachable: ' + e.message }));
    preq.setTimeout(20000, () => preq.destroy(new Error('timeout')));
    req.pipe(preq);
  } catch (e) {
    res.status(502).json({ error: 'Proxy error: ' + e.message });
  }
}

// POST/PUT a JSON body to the host; resolves {status, json}.
function proxyJSONToHost(method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const base = hostBaseURL();
    if (!base) return reject(new Error('no host'));
    let u; try { u = new URL(base + urlPath); } catch (e) { return reject(e); }
    const payload = Buffer.from(JSON.stringify(bodyObj || {}));
    const lib = u.protocol === 'https:' ? https : http;
    // If the host has its own PIN, this device's own local copy of it
    // (entered during setup or in Settings → Multi-Device) is sent as a
    // dedicated header — see requireAuth()'s own handling of this header
    // for why a raw PIN header, not a session token, is the right
    // mechanism here: this is server-to-server sync with no human present
    // to do an interactive login, and no session to keep alive between
    // periodic syncs.
    const headers = { 'Content-Type': 'application/json', 'Content-Length': payload.length };
    const hostPin = getSetting('app_pin'); // a slave's own PIN IS the household PIN — see setup wizard, which saves the host's PIN directly as this device's app_pin, not a separate value
    headers['x-host-pin'] = hostPin || ''; // always sent, even empty — see requireAuth()'s grace-period comment for why an omitted header can't safely mean the same thing as a deliberately empty one
    headers['x-mirror-license'] = getSetting('update_license_key') || '';   // lets the host recognise this mirror without a browser login
    const r = lib.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers,
    }, (resp) => {
      const chunks = []; resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        let json = {}; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
        resolve({ status: resp.statusCode || 200, json });
      });
    });
    r.on('error', reject);
    r.setTimeout(15000, () => r.destroy(new Error('timeout')));
    r.write(payload); r.end();
  });
}

// ── Geocoding — zip code to lat/lon (nominatim, free, no key) ────────────────
// This code lives in src/geocoding.js. It runs here, at the same place in the file as before.
require('./src/geocoding.js')({ fetchWithTimeout, app, db, geocodeAddress: (...a) => geocodeAddress(...a) });

// ── Weather proxy (Open-Meteo, free, no API key) ─────────────────────────────
// This code lives in src/weather-providers.js. It runs here, at the same place in the file as before.
const { WMO_DESC, emailFormatTemp, emailTempUnitLabel, getWeather, getWeatherOWM, httpGetJSON, getWeatherNWS } = require('./src/weather-providers.js')({ fetchWithTimeout, getSetting });

// ── Sunrise/sunset-based day/night, shared across all providers ─────────────
// This code lives in src/weather-resolve.js. It runs here, at the same place in the file as before.
const { reconcileWeatherToday, getWeatherResolved } = require('./src/weather-resolve.js')({ RA, getSetting, getWeather, getWeatherOWM, getWeatherNWS });

// ── Weather Radar (RainViewer, free, no API key — see radar widget) ─────────
// This code lives in src/weather-radar.js. It runs here, at the same place in the file as before.
require('./src/weather-radar.js')({ path, fetchWithTimeout, app, db, getWeatherResolved });

// ── Air Quality / Pollen / UV proxy (Open-Meteo, free, no API key) ───────────
// This code lives in src/air-quality.js. It runs here, at the same place in the file as before.
require('./src/air-quality.js')({ fetchWithTimeout, app, db });

// ── Travel Time widget ────────────────────────────────────────────────────────
// This code lives in src/travel-time.js. It runs here, at the same place in the file as before.
const { geocodeAddress } = require('./src/travel-time.js')({ fetchWithTimeout, app, getSetting: (k) => getSetting(k) });

// ── On This Day proxy (Wikipedia REST API, free, no key) ─────────────────────
// This code lives in src/on-this-day.js. It runs here, at the same place in the file as before.
const { fetchJsonWithUA } = require('./src/on-this-day.js')({ fetchWithTimeout, app, appNow, localDateStr });

// ── Daily Quote proxy (ZenQuotes, free, no key) ───────────────────────────────
// This code lives in src/daily-quote.js. It runs here, at the same place in the file as before.
require('./src/daily-quote.js')({ app, localDateStr, fetchJsonWithUA });

// ── Sports Scores proxy (TheSportsDB, free tier via shared test key "3") ─────
// This code lives in src/sports.js. It runs here, at the same place in the file as before.
require('./src/sports.js')({ app, fetchJsonWithUA });

// ── METAR/TAF proxy (NOAA Aviation Weather Center, free, no key) ─────────────
// This code lives in src/metar.js. It runs here, at the same place in the file as before.
require('./src/metar.js')({ app, fetchJsonWithUA });

// ── iCal feeds API ────────────────────────────────────────────────────────────
// This code lives in src/ical-feeds.js. It runs here, at the same place in the file as before.
require('./src/ical-feeds.js')({ app, db, markHostEditing, broadcastUpdate, isGoogleFeedUrl: (...a) => isGoogleFeedUrl(...a), googleFeedUrlValid: (...a) => googleFeedUrlValid(...a), isIcloudFeedUrl: (...a) => isIcloudFeedUrl(...a), icloudFeedUrlValid: (...a) => icloudFeedUrlValid(...a), syncFeed: (...a) => syncFeed(...a) });

// ── Shared HTTPS request helper (core: stays in server.js) ─────────────────────────
// Shared low-level HTTP helper. Node's `https` doesn't follow redirects and
// these need non-GET methods (PROPFIND/PUT/DELETE) with request bodies, so
// this can't reuse httpGetJSON() — but it stays in the same raw-`https` style
// as the Home Assistant request helper rather than adding an HTTP dependency.
// iCloud CalDAV always 301s caldav.icloud.com to a per-account host, so
// redirect-following is load-bearing; Google's endpoints don't redirect but
// it's harmless there.
function httpsRequest(url, method, { body = null, headers = {}, auth = null, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, redirectsLeft) => {
      let target;
      try { target = new URL(currentUrl); } catch { return reject(new Error('Invalid CalDAV URL: ' + currentUrl)); }
      const reqHeaders = { ...headers };
      if (auth) reqHeaders['Authorization'] = 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64');
      const bodyBuf = body != null ? Buffer.from(body, 'utf8') : null;
      if (bodyBuf) reqHeaders['Content-Length'] = bodyBuf.length;
      // PIAZZA_TEST_ALLOW_HTTP=1 lets a test point this at a plain-http fake server; in every real deployment it is unset and
      // this client stays https-only.
      const lib = (process.env.PIAZZA_TEST_ALLOW_HTTP === '1' && target.protocol === 'http:') ? http : https;
      const req = lib.request({
        family: 4,
        hostname: target.hostname,
        port: target.port || (lib === http ? 80 : 443),
        path: target.pathname + target.search,
        method,
        headers: reqHeaders,
        // No connection pooling. These are all low-frequency best-effort
        // calls (CalDAV/Google push, handwriting recognition); a fresh
        // connection each time is cheap and avoids a whole class of bug
        // where a pooled keep-alive socket goes bad in the long-running
        // process and later requests reuse it and get a garbled/non-200
        // response. Seen live: failed MyScript auth attempts left a
        // poisoned socket; every subsequent recognize 502'd until restart.
        agent: false,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          // CalDAV clients re-issue the SAME method + body against the
          // redirect target (iCloud always 301s caldav.icloud.com to a
          // per-account pNN-caldav.icloud.com host) — this is expected here
          // even though it diverges from strict 301-becomes-GET semantics.
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
            let nextUrl;
            try { nextUrl = new URL(res.headers.location, currentUrl); } catch { return reject(new Error('iCloud sent a redirect that could not be read.')); }
            // A request carrying the Apple ID + app password must never follow a redirect off icloud.com.
            if (auth && !icloudHostOk(nextUrl)) return reject(new Error('iCloud redirected somewhere unexpected, so your password was not sent there.'));
            return attempt(nextUrl.toString(), redirectsLeft - 1);
          }
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data, finalUrl: currentUrl });
        });
      });
      req.on('error', (err) => reject(new Error(`Could not reach iCloud: ${err.message}`)));
      req.setTimeout(15000, () => req.destroy(new Error('CalDAV request timed out')));
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    };
    attempt(url, maxRedirects);
  });
}

// ── iCal parser ───────────────────────────────────────────────────────────────
// This code lives in src/calendar-sync.js. It runs here, at the same place in the file as before.
const { fetchUrl, getLocalTimezone, utcToLocalParts, parseICSDate, decodeICSText, parseICS, expandRecurrence, isGoogleFeedUrl, googleFeedUrlValid, isIcloudFeedUrl, icloudHostOk, icloudFeedUrlValid, syncFeed, discoverCalDAVCalendars, stripXmlNsPrefixes, getCaldavConfig, caldavUidFor, buildEventICS, setEventCaldavFields, pushLocalEventToCalDAV, deleteEventFromCalDAV, GOOGLE_TOKEN_URL, GOOGLE_SCOPE, getGoogleConfig, googleClientConfigured, setGoogleDisconnected, formEncode, googleGetAccountEmail, getGoogleAccessToken, googleApi, pushLocalEventToGoogle, deleteEventFromGoogle, RECURRENCE_WINDOW_PAST_DAYS, RECURRENCE_WINDOW_FUTURE_DAYS } = require('./src/calendar-sync.js')({ URL, fetchWithTimeout, IS_DEMO, db, broadcastUpdate, getTimezoneOverride, getSetting, isSlave, httpsRequest, setSetting });

// ── Home Assistant condition alerts ────────────────────────────────────────
// This code lives in src/ha-alerts.js. It runs here, at the same place in the file as before.
const { getHaAlerts, _haAlertRuntime, _haActiveAlerts, checkHaAlerts } = require('./src/ha-alerts.js')({ IS_DEMO, getSetting, isSlave, haRequest: (...a) => haRequest(...a), raiseNotification: (...a) => raiseNotification(...a), clearNotification: (...a) => clearNotification(...a) });

// ── Constants shared by the notification center and the severe-weather alerts ──────────────
// Declared here (rather than in the severe-weather section below, where they are used) because the notification center needs them as it is wired in.
const _activeWeatherAlertIds = new Set();   // notification keys (one per warning, however many updates it gets) currently showing
const WX_KIND = 'weather-alert';

// ── Notification center — on-screen banner + optional phone relay ─────────
// This code lives in src/notifications.js. It runs here, at the same place in the file as before.
const { _activeNotifications, raiseNotification, clearNotification } = require('./src/notifications.js')({ fs, app, IS_DEMO, resolveUpdateServerUrl, fetchJSON, getSetting, isSlave, hostBaseURL, httpsRequest, _haAlertRuntime, _haActiveAlerts, _activeWeatherAlertIds, WX_KIND, wxDismissThread: (...a) => wxDismissThread(...a), setSetting });

// ── Severe weather alerts (NWS, free, keyless, US-only) ─────────────────────
// This code lives in src/weather-alerts.js. It runs here, at the same place in the file as before.
const { wxDismissThread, checkWeatherAlerts } = require('./src/weather-alerts.js')({ app, IS_DEMO, fetchJSON, getSetting, isSlave, hostBaseURL, _activeWeatherAlertIds, WX_KIND, setSetting, httpGetJSON, _activeNotifications, raiseNotification, clearNotification });

// ── Phone alert switches ────────────────────────────────────────
// This code lives in src/phone-alerts.js. It runs here, at the same place in the file as before.
require('./src/phone-alerts.js')({ app, resolveUpdateServerUrl, getSetting, setSetting });

// ── Home Assistant alert rules (routes) ──────────────────────────────
// This code lives in src/ha-alert-routes.js. It runs here, at the same place in the file as before.
require('./src/ha-alert-routes.js')({ crypto, app, fetchJSON, isSlave, hostBaseURL, setSetting, getHaAlerts, _haAlertRuntime, _haActiveAlerts, checkHaAlerts, clearNotification });

// ── License cache and the periodic update check (core: stays in server.js) ──────────
// Persists the license/trial/limits info from an update-check response locally,
// so the browser app can read current status (for the trial-ending notice and
// limit enforcement) without needing its own network round-trip to the central
// server on every page load. Purely a local cache of what the server told us —
// LOCAL_ONLY, never synced to a slave screen, since each screen refreshes its
// own copy independently on the same schedule.
// A license is genuinely valid while 'active' (paid) or 'free' (a signup —
// unconditionally full-access, no expiry, exactly like 'active') — or, for a
// license created before that free/active split existed, the older 'trial'
// status with a real, still-future expiry (every one of those got a concrete
// access_through date stamped at creation, never open-ended). 'none',
// 'past_due', 'canceled', or a legacy trial whose date has passed are all
// equally "no valid license" for this purpose.
function isLicenseValid(status, trialUntil) {
  if (status === 'active' || status === 'free') return true;
  if (status === 'trial' && trialUntil) {
    const d = new Date(trialUntil);
    return !isNaN(d) && d > new Date();
  }
  return false;
}

function storeLicenseInfo(info) {
  if (!info) return;
  const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  upsert.run('license_status_cache', info.licenseStatus || '');
  upsert.run('trial_until_cache', info.trialUntil || '');
  upsert.run('limits_cache', info.limits ? JSON.stringify(info.limits) : '');
  // Present only when THIS device just collided with a different,
  // already-recognized host on the same license key — surfaced to Settings
  // as a popup rather than anything being silently decided by the
  // mothership. Cleared (empty string) whenever a check-in comes back
  // without one, so a resolved conflict correctly stops showing the popup
  // on the very next check-in rather than needing something else to clear it.
  upsert.run('host_conflict_cache', info.hostConflict ? JSON.stringify(info.hostConflict) : '');
  // Tracks WHEN this device first became license-less — a stable timestamp
  // set once and left alone, not recalculated on every check-in, so the
  // grace-period countdown is actually stable rather than perpetually
  // resetting to "just now" every ~6h. Cleared the moment a valid license
  // is detected again, whether that's a genuinely new one or the same one
  // recovering (e.g. a lapsed payment getting fixed).
  //
  // STARTING a grace period is host-only: a mirror has no independent
  // licensing responsibility of its own, it just syncs whatever the
  // host has, so it shouldn't begin its own countdown. But CLEARING one
  // must NOT be host-only — this is genuinely per-device state
  // (`no_license_since` is in LOCAL_ONLY_SETTINGS, deliberately never
  // synced host -> mirror), and a mirror independently checks in with its
  // OWN key and gets its OWN license_status_cache set from the result
  // (both upserts above already run unconditionally, regardless of role).
  // Found live: with the ENTIRE block previously gated to hosts only, a
  // mirror that ever set its own no_license_since (e.g. before its key was
  // configured) could NEVER clear it again through any path that
  // exists — its own check-ins skipped the clearing branch entirely, and
  // sync can't help either since the field never syncs by design. The
  // account status correctly flips to Active, right next to a permanently
  // stuck "license required, N days left" warning underneath it that
  // nothing could ever resolve short of editing the database directly.
  const valid = isLicenseValid(info.licenseStatus, info.trialUntil);
  const already = getSetting('no_license_since');
  if (valid) {
    if (already) upsert.run('no_license_since', '');
  } else if (!already && updateSetting('device_role', 'host') !== 'slave') {
    upsert.run('no_license_since', String(Date.now()));
  }
}

// On-demand refresh of the license/trial/limits cache above, WITHOUT the
// auto-update-download side effect periodicUpdateCheck() also does — this
// exists specifically so saving a new license key can immediately reflect
// the account's real status instead of waiting for the next scheduled
// check-in (first run ~90s after boot, then every 6 hours). Before this,
// entering a key that genuinely upgraded the account from trial to active
// would still get blocked by limits_cache holding the stale pre-upgrade
// value for up to 6 hours — the save itself worked fine, but nothing told
// the cache anything had changed.
app.post('/api/refresh-license', async (req, res) => {
  try {
    const info = await fetchUpdateInfo();
    storeLicenseInfo(info);
    res.json({
      ok: true,
      licenseStatus: info.licenseStatus || '',
      trialUntil: info.trialUntil || '',
      limits: info.limits || null,
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the update server to refresh license status: ' + e.message });
  }
});

// Runs on a schedule regardless of update mode — refreshes the license/trial
// cache above every time (so the trial-ending notice stays accurate even for
// someone who rarely opens Settings). Installing what it finds depends on
// update_schedule_mode: 'immediate' (default) installs right here, same as
// before there was a choice at all; 'scheduled' just logs what's available
// and leaves the actual install to scheduleNextDailyUpdateInstall() below,
// which fires precisely at the chosen daily time rather than whenever this
// 6-hourly check happens to land. We check a few minutes after boot and
// then every 6 hours either way, since license/trial info should stay
// fresh regardless of how updates themselves get installed.
async function periodicUpdateCheck() {
  if (IS_DEMO) return;
  let info;
  try {
    info = await fetchUpdateInfo();
  } catch (e) {
    console.log('Periodic update check skipped:', e.message);
    return;
  }
  storeLicenseInfo(info); // license check-in — happens regardless of platform
  try {
    if (info && info.updateAvailable && info.downloadUrl) {
      if (IS_CONTAINER) {
        console.log(`Update available: ${APP_VERSION} -> ${info.latestVersion}. Pull the latest image and recreate the container to apply it.`);
        return;
      }
      if (updateSetting('update_schedule_mode', 'immediate') === 'scheduled') {
        console.log(`Auto-update: ${APP_VERSION} -> ${info.latestVersion} available, deferring to the scheduled install time (${updateSetting('update_schedule_time', '03:00')}).`);
        return;
      }
      console.log(`Auto-update: ${APP_VERSION} -> ${info.latestVersion}; downloading.`);
      await downloadAndInstallUpdate(info);
    }
  } catch (e) {
    console.log('Auto-update check skipped:', e.message);
  }
}
setTimeout(periodicUpdateCheck, 90 * 1000);            // ~90s after boot
setInterval(periodicUpdateCheck, 6 * 60 * 60 * 1000);  // every 6 hours

// Shared by periodicUpdateCheck() (immediate mode) and the scheduled-time
// timer below (scheduled mode) — download+install reusing the same
// no-op-response trick, since neither call site has a real HTTP client
// waiting on a response the way the manual /api/update-from-server route
// does.
async function downloadAndInstallUpdate(info) {
  fs.mkdirSync(UPDATE_TMP, { recursive: true });
  const zipPath = path.join(UPDATE_TMP, 'pulled.zip');
  await downloadToFile(info.downloadUrl, zipPath);
  const noopRes = { json: () => {}, status: () => ({ json: () => {} }) };
  installFromZip(zipPath, noopRes);
}

// Scheduled-mode install timer: arms a precise setTimeout for the next
// occurrence of update_schedule_time (today if it hasn't passed yet,
// otherwise tomorrow) rather than relying on periodicUpdateCheck()'s
// 6-hour cadence to happen to land on the right minute — a device that
// boots at, say, 2pm would otherwise only ever check at 2pm/8pm/2am/8am,
// never actually landing on a 3am target. When the timer fires, it does
// its OWN fresh fetchUpdateInfo() (not whatever periodicUpdateCheck() last
// saw, which could be hours stale) and installs only if something is
// actually available, then re-arms itself for the following day. A no-op
// if the current mode is 'immediate' — that path installs the moment
// periodicUpdateCheck() finds something, there's nothing to wait for.
let _dailyUpdateInstallTimer = null;
function scheduleNextDailyUpdateInstall() {
  if (_dailyUpdateInstallTimer) { clearTimeout(_dailyUpdateInstallTimer); _dailyUpdateInstallTimer = null; }
  if (IS_CONTAINER) return; // no in-app install path in a container — see CONTAINER_UPDATE_MSG
  if (updateSetting('update_schedule_mode', 'immediate') !== 'scheduled') return;
  const timeStr = updateSetting('update_schedule_time', '03:00');
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  const [hh, mm] = m ? [Number(m[1]), Number(m[2])] : [3, 0]; // malformed setting — fall back rather than crash the timer chain
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1); // today's time already passed — tomorrow instead
  const msUntil = next.getTime() - now.getTime();
  console.log(`Scheduled update install armed for ${next.toISOString()} (in ${Math.round(msUntil / 60000)} min).`);
  _dailyUpdateInstallTimer = setTimeout(async () => {
    try {
      const info = await fetchUpdateInfo();
      storeLicenseInfo(info);
      if (info && info.updateAvailable && info.downloadUrl) {
        console.log(`Scheduled auto-update: ${APP_VERSION} -> ${info.latestVersion}; downloading.`);
        await downloadAndInstallUpdate(info);
        // installFromZip() above calls process.exit(0) a moment after a
        // successful install — this process is going away regardless, so
        // no need to re-arm below; the next boot calls
        // scheduleNextDailyUpdateInstall() fresh on its own (see the
        // bottom of this file).
        return;
      }
    } catch (e) {
      console.log('Scheduled update check skipped:', e.message);
    }
    // Nothing was available (or the check failed) — still here, so re-arm
    // for tomorrow ourselves rather than waiting on the next 6-hour
    // periodicUpdateCheck() to notice the timer's gone quiet.
    scheduleNextDailyUpdateInstall();
  }, msUntil);
}
scheduleNextDailyUpdateInstall(); // arm at boot — no-op if mode is 'immediate'

// ── iCloud shared-album photo sync ───────────────────────────────────────────
// This code lives in src/shared-album.js. It runs here, at the same place in the file as before.
const { scheduleIcloudAlbumSync } = require('./src/shared-album.js')({ path, fs, fetchWithTimeout, app, db, UPLOAD_DIR, broadcastUpdate, downloadFile, getSetting: (k) => getSetting(k), isSlave: () => isSlave(), setSetting, URL });

// ── Photos API ────────────────────────────────────────────────────────────────

// GET /api/photos — list all photos
app.get('/api/photos', (req, res) => {
  const photos = db.prepare(`SELECT * FROM photos ORDER BY sort_order ASC, id ASC`).all();
  res.json(photos);
});

// POST /api/photos — upload a new photo
// ── Setting writer ─────────────────────────────────────────────
// Used all over the server (and by several modules in src/), so it stays here rather than inside the custom-theme code it used to sit in.
function setSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
}

// ── Wi-Fi power saving off (Pi only) ──
// This code lives in src/wifi-power.js. It runs here, after setSetting(); it only starts a timer and adds no routes.
require('./src/wifi-power.js')({ fs, path, os, execFile, DEPLOYMENT, IS_DEMO, getSetting: (k) => getSetting(k), setSetting });

// ── The `kiosk` command: repair a stale root-owned copy (Pi only) ──
// This code lives in src/kiosk-link.js. It runs here, after setSetting(); it only starts a timer and adds no routes.
require('./src/kiosk-link.js')({ fs, path, os, execFile, projectDir: __dirname, DEPLOYMENT, IS_DEMO, getSetting: (k) => getSetting(k), setSetting });

// ── Custom theme: background + up to 3 decorations ────────────────────────────
// This code lives in src/custom-theme-slots.js. It runs here, at the same place in the file as before.
const { removeCustomThemeFile, copyCustomThemeFile } = require('./src/custom-theme-slots.js')({ path, fs, app, CUSTOM_THEME_DIR, uploadFilePath, uploadCustomBg, uploadCustomDeco, broadcastUpdate, setSetting, updateSetting });

// ── Saved custom theme library ────────────────────────────────────────────────
// This code lives in src/custom-themes.js. It runs here, at the same place in the file as before.
require('./src/custom-themes.js')({ fs, app, db, uploadFilePath, broadcastUpdate, getSetting: (k) => getSetting(k), removeCustomThemeFile, copyCustomThemeFile, setSetting });

// ── Photo library routes ──────────────────────────────
// This code lives in src/photos.js. It runs here, at the same place in the file as before.
require('./src/photos.js')({ path, fs, app, db, UPLOAD_DIR, upload, broadcastUpdate });

// ── Displays API ──────────────────────────────────────────────────────────────
// This code lives in src/displays.js. It runs here, at the same place in the file as before.
const { resolveDisplay, slugify, previewScreenName } = require('./src/displays.js')({ app, db, seedDefaultLayoutsForDisplay, broadcastUpdate, updateSetting });

// ── Templates ─────────────────────────────────────────────────────────────────
// This code lives in src/templates-api.js. It runs here, at the same place in the file as before.
require('./src/templates-api.js')({ app, db, broadcastUpdate, slugify, getTemplateSummaries, getTemplate, materializeWidgets });

// ── Layout Library (user-saved presets) ──────────────────────────────────────
// This code lives in src/layout-library.js. It runs here, at the same place in the file as before.
const { applySavedLayoutToDisplay } = require('./src/layout-library.js')({ app, db, broadcastUpdate, resolveDisplay, slugify });

// ── Screens manager ───────────────────────────────────────────────────────────
// This code lives in src/screens.js. It runs here, at the same place in the file as before.
require('./src/screens.js')({ getReachableAddresses, app, PORT, IS_DEMO, db, broadcastUpdate, sendScreenCommand, SCREEN_ONLINE_MS, DEVICE_ID, getSetting, isSlave, resolveDisplay, previewScreenName, updateSetting });

// ── Layout API ────────────────────────────────────────────────────────────────
// This code lives in src/layout-api.js. It runs here, at the same place in the file as before.
require('./src/layout-api.js')({ app, db, markHostEditing, broadcastUpdate, reloadCameraService, resolveDisplay, updateSetting });

// ── Todoist proxy — uses personal API token ───────────────────────────────────
// This code lives in src/todoist.js. It runs here, at the same place in the file as before.
// Google Tasks plugs into the Todoist routes below, so it is registered first (src/google-tasks.js).
const gtasks = require('./src/google-tasks.js')({ crypto, app, broadcastUpdate, resolveUpdateServerUrl, getSetting: (k) => getSetting(k), setSetting, httpsRequest, GOOGLE_TOKEN_URL, getGoogleConfig, formEncode, googleGetAccountEmail });
const todoistApi = require('./src/todoist.js')({ path, fetchWithTimeout, app, db, gtasks });
const { todoistGet } = todoistApi;
linkedProviders.todoist = todoistApi; linkedProviders.gtasks = gtasks;

// ── Home Assistant (Tier 1: read-only Entity Status widget) ──────────────────
// This code lives in src/ha-core.js. It runs here, at the same place in the file as before.
const { haRequest, haRequestWith, getHaHealth } = require('./src/ha-core.js')({ URL, path, http, fetchWithTimeout, os, app, PORT, getSetting, execFileSync });

// ── Home Assistant Areas (WebSocket-only) ───────────────────────────────────
// This code lives in src/ha-areas.js. It runs here, at the same place in the file as before.
const { haWsRequest, haStateCache } = require('./src/ha-areas.js')({ URL, WebSocketClient, app, getSetting, haRequest });

// ── Home Assistant Tier 2: controlling devices, not just reading them ──────
// This code lives in src/ha-actions.js. It runs here, at the same place in the file as before.
require('./src/ha-actions.js')({ app, getSetting, haRequestWith, haStateCache });

// ── News (Google News RSS — no key required) ──────────────────────────────────
// This code lives in src/news.js. It runs here, at the same place in the file as before.
const { getNews, parseNewsRSS } = require('./src/news.js')({ app, db, fetchUrl });

// ── Stocks (Stooq — no key required) ──────────────────────────────────────────
// This code lives in src/stocks.js. It runs here, at the same place in the file as before.
const { getStocks, getAllStockTickersFromLayouts } = require('./src/stocks.js')({ fetchWithTimeout, app, db });

// ── Reminder recurrence engine ──────────────────────────────────────────────
// This code lives in src/reminder-recurrence.js. It runs here, at the same place in the file as before.
const { reminderOccursOnDateServer } = require('./src/reminder-recurrence.js')({});

// ── Daily Briefing email ───────────────────────────────────────────────────────
// This code lives in src/briefing.js. It runs here, at the same place in the file as before.
const { getEmailSettings, getBriefingRecipients, buildMailTransporter, friendlyMailError, assembleBriefingContent, renderBriefingHTML, renderBriefingText, sendBriefing, checkBriefingSchedule, checkFeedbackSchedule } = require('./src/briefing.js')({ path, fs, crypto, nodemailer, PORT, getReachableAddresses, app, IS_DEMO, db, UPLOAD_DIR, localDateStr, localHHMM, isSlave, checkTvSchedules, WMO_DESC, emailFormatTemp, emailTempUnitLabel, getWeatherResolved, fetchUrl, todoistGet, getNews, parseNewsRSS, getStocks, getAllStockTickersFromLayouts, reminderOccursOnDateServer });

// ── iCloud CalDAV push settings ─────────────────────────────────────────────
// This code lives in src/caldav-settings.js. It runs here, at the same place in the file as before.
require('./src/caldav-settings.js')({ app, db, getSetting, discoverCalDAVCalendars, getCaldavConfig, getGoogleConfig, googleClientConfigured });

// ── Handwriting-to-text (optional, for the display's add-event sheet) ───────
// This code lives in src/handwriting.js. It runs here, at the same place in the file as before.
require('./src/handwriting.js')({ crypto, app, db, getSetting: (k) => getSetting(k), httpsRequest });

// ── Google settings (calendar push switches and client details) ───────────────────────
// This code lives in src/google-settings.js. It runs here, at the same place in the file as before.
require('./src/google-settings.js')({ app, db, getSetting, googleClientConfigured, setGoogleDisconnected, setSetting });

// ── Google Photos (Photos Picker) as a photo source ──
// This code lives in src/google-photos.js. It runs here, before the Google connect routes (it only adds /api/google-photos/* routes).
require('./src/google-photos.js')({ crypto, path, fs, app, db, UPLOAD_DIR, broadcastUpdate, fetchWithTimeout, resolveUpdateServerUrl, getSetting: (k) => getSetting(k), setSetting, httpsRequest, GOOGLE_TOKEN_URL, getGoogleConfig, formEncode, googleGetAccountEmail, isSlave: () => isSlave() });

// ── Google connect: authorization-code flow relayed through the mothership ──
// This code lives in src/google-connect.js. It runs here, at the same place in the file as before.
require('./src/google-connect.js')({ crypto, app, resolveUpdateServerUrl, getSetting, httpsRequest, GOOGLE_TOKEN_URL, GOOGLE_SCOPE, getGoogleConfig, formEncode, googleGetAccountEmail, setSetting });

// ── Briefing recipients (name + email, one row per person) ───────────────────
// This code lives in src/briefing-recipients.js. It runs here, at the same place in the file as before.
require('./src/briefing-recipients.js')({ app, db, getEmailSettings, getBriefingRecipients, buildMailTransporter, friendlyMailError, assembleBriefingContent, renderBriefingHTML, renderBriefingText, sendBriefing });

// ── Page routes ───────────────────────────────────────────────────────────────

// ── Self-update API ───────────────────────────────────────────────────────────

// Current running version (shown in the app's Update section).
app.get('/api/version', (req, res) => {
  // `deployment` lets the Settings UI show the right update guidance —
  // 'container' can't self-update (pull a new image instead); 'windows'/'pi'
  // self-update normally.
  // `demoScan` = this caller reached the instance via the wall-QR "scan"
  // path (no lease of its own). The front-end uses it to poll the broker
  // for "is this instance still leased" instead of trying to heartbeat.
  const demoScan = IS_DEMO && DEMO_BROKER_URL && /(?:^|;\s*)demo_scan=1/.test(req.headers.cookie || '');
  res.json({
    version: APP_VERSION, isBeta: isBetaVersion(), deployment: DEPLOYMENT,
    demo: IS_DEMO, demoLeaseEndsAt: IS_DEMO ? DEMO_LEASE_ENDS : 0,
    demoBrokerUrl: DEMO_BROKER_URL || undefined, demoInstance: DEMO_INSTANCE || undefined,
    demoScan: demoScan || undefined,
  });
});

// Windows full-screen kiosk escape hatch. launcher.vbs opens the wall
// display as a Chromium `--kiosk` window (no chrome, no tab bar, Alt+F4
// easy to miss or disabled on a touchscreen); display.html shows a small
// "Exit full-screen" button (?kiosk=1) that POSTs here. All this does is
// kill the local kiosk browser process — the one launched with
// `--user-data-dir=<app>\kiosk-profile`, matched on that in its command
// line so unrelated Chrome/Edge windows are untouched. Windows-only and
// loopback-only: there's no scenario where a remote client should be able
// to close someone's wall display, and the whole mechanism is
// Windows-kiosk-specific anyway. No-op (404) everywhere else.
app.post('/api/kiosk/exit', (req, res) => {
  if (!IS_WIN) return res.status(404).json({ error: 'Not found' });
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip !== '127.0.0.1' && ip !== '::1') {
    return res.status(403).json({ error: 'Local access only' });
  }
  const ps = [
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" |",
    "  Where-Object { $_.CommandLine -and $_.CommandLine -like '*kiosk-profile*' } |",
    "  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }",
  ].join(' ');
  const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  execFile(psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 10000 }, (err) => {
    if (err) {
      console.error('kiosk exit: failed to stop kiosk browser:', (err && err.message) || err);
      return res.status(500).json({ error: 'Could not close the kiosk browser.' });
    }
    console.log('kiosk exit: closed kiosk browser on request from the wall display.');
    res.json({ ok: true });
  });
});

// Proxies the central server's public support-links endpoint (see
// fetchSupportLinks() above for the caching/fallback behavior) — the
// browser can't call piazzahq.com directly here, same CORS reasoning as
// every other central-server call in this file. Always returns a 200 with
// both fields present (empty string for whichever isn't configured) rather
// than erroring, since the frontend just hides buttons for empty values —
// there's no real "failure" state worth surfacing to the user for this.
app.get('/api/support-links', async (req, res) => {
  const links = await fetchSupportLinks();
  res.json({ stripeUrl: links.stripeUrl || '', paypalUrl: links.paypalUrl || '' });
});

// True only when this device is actually running a beta-suffixed version
// (x.y.z-beta.N) — same version-string convention documented in
// TURNOVER.md for the mothership. Used to gate the entire Beta Checklist
// feature (both endpoints below, and the Settings section that calls
// them) to testers only. A stable build should behave as if this feature
// doesn't exist at all, not just have it hidden in the UI — someone
// hitting these endpoints directly on a stable install should get the
// same "not found" a real 404 would, not a working QA tool real end
// users were never meant to see.
function isBetaVersion() {
  return /-beta\.\d+$/.test(APP_VERSION);
}

// Serves BETA_CHECKLIST.md's raw content — the running, cumulative
// pre-stable QA list (see the file's own header for what it's for and how
// it's maintained). Protected like the rest of the app's own settings/admin
// surface, not public — this is dev-facing, not something a kid's page or
// the Family Hub has any reason to read. Read fresh from disk on every
// request (not cached) since it's expected to change on every beta build.
// Serves BETA_CHECKLIST.md's raw content, PLUS which items are checked —
// content comes fresh from the file (whatever this build's zip shipped, so
// [ ]/[x] markers in the file source itself are ignored entirely; author it
// as always-unchecked), checked state comes from beta_checklist_checked
// (see that table's own schema comment for why the split exists). The
// client merges the two at render time rather than the server pre-injecting
// [x] into the content string, so the client's own item-numbering logic
// (which has to agree with the toggle endpoint below on what "index N"
// means) stays the single source of truth for how indices are assigned.
app.get('/api/beta-checklist', (req, res) => {
  if (!isBetaVersion()) return res.status(404).json({ error: 'Not available on this build.' });
  const filePath = path.join(__dirname, 'BETA_CHECKLIST.md');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const checkedIndices = db.prepare(`SELECT item_index FROM beta_checklist_checked`).all().map(r => r.item_index);
    res.json({ content, checkedIndices });
  } catch (e) {
    res.status(404).json({ error: 'BETA_CHECKLIST.md isn\'t on this device yet — it should appear after your next update.' });
  }
});

// Toggles ONE checklist item's checked state, identified by its 0-based
// position among every "- [ ]"/"- [x]" line in the file, top to bottom —
// index N means the Nth such line, regardless of which ## section it's
// under or how many plain "- " bullets or continuation lines of wrapped
// text surround it. This has to match the client's own numbering exactly
// (see renderChecklistMarkdown()'s comment in app.html for why).
//
// Writes to beta_checklist_checked, NOT the file — an earlier version of
// this endpoint edited BETA_CHECKLIST.md's own [ ]/[x] marker directly,
// which seemed fine until the very next beta update silently wiped every
// checked item back to unchecked, because the file is code and gets
// wholesale-replaced on update. This version's checkmark survives that
// exact scenario, since the database isn't part of what an update
// replaces.
app.put('/api/beta-checklist/toggle', (req, res) => {
  if (!isBetaVersion()) return res.status(404).json({ error: 'Not available on this build.' });
  const targetIndex = parseInt(req.body.index);
  if (!Number.isFinite(targetIndex) || targetIndex < 0) return res.status(400).json({ error: 'index is required' });
  const already = db.prepare(`SELECT 1 FROM beta_checklist_checked WHERE item_index = ?`).get(targetIndex);
  if (already) db.prepare(`DELETE FROM beta_checklist_checked WHERE item_index = ?`).run(targetIndex);
  else db.prepare(`INSERT INTO beta_checklist_checked (item_index) VALUES (?)`).run(targetIndex);
  res.json({ ok: true, checked: !already });
});

// ── Post-swap restart, platform-aware ────────────────────────────────────────
// After code is swapped in (a normal update, or a manual backup restore), the
// process has to restart to run it. On Linux/Pi we just exit — systemd
// (Restart=always) brings us straight back, and autoRollbackGuard() at the top
// of this file handles a bad boot by counting failed restarts. Windows has
// neither a supervisor nor those repeated restarts to lean on, so it supervises
// the handoff itself: stop listening, spawn the replacement, watch it actually
// come up on the new version, and if it doesn't (crash on boot, or never
// answers) restore the pre-swap backup and relaunch from that — a fully
// automatic rollback with no user action, the same end state Linux reaches via
// autoRollbackGuard(), just driven from here instead.
function spawnDetachedSelf() {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    detached: true, stdio: 'ignore', cwd: __dirname, windowsHide: true,
  });
  return child;
}
function supervisedWindowsRestart(rollbackDir, targetVersion) {
  // Free the listening socket first. Without this the replacement can't bind,
  // AND our own health poll below would just be answered by THIS (old-version)
  // process — it would never see targetVersion and would roll back a perfectly
  // good update. close() releases the listening port immediately while letting
  // any in-flight response (the {ok:true} we just sent the update caller)
  // finish draining; process.exit() at handoff/rollback drops whatever's left.
  // Deliberately NOT closeAllConnections() here — it would race that in-flight
  // response and truncate it, and it isn't needed for the child to bind.
  try { if (httpServer) httpServer.close(); } catch {}
  // Stop our go2rtc child so the replacement process can re-bind its port.
  try { stopCameraService('server restart'); } catch {}
  try { raStop('server restart'); } catch {}

  setTimeout(() => {
    let child = null;
    let decided = false;

    const handoff = () => {
      if (decided) return; decided = true;
      console.log('Update: replacement process is live on the new version — handing off.');
      try { child && child.unref(); } catch {}
      process.exit(0);
    };
    const rollback = (why) => {
      if (decided) return; decided = true;
      console.error(`Update: ${why} — rolling back automatically.`);
      try { child && child.kill(); } catch {}
      try {
        for (const name of UPDATE_CODE_ITEMS) {
          const from = path.join(rollbackDir, name), to = path.join(__dirname, name);
          if (!fs.existsSync(from)) continue;
          if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
          fs.cpSync(from, to, { recursive: true });
        }
        console.error('Update: pre-update code restored.');
      } catch (e) {
        console.error('Update: rollback restore FAILED — ' + e.message);
      }
      try { fs.unlinkSync(PENDING_FLAG); } catch {}
      try { spawnDetachedSelf().unref(); } catch (e) { console.error('Update: relaunch after rollback failed — ' + e.message); }
      process.exit(1);
    };

    // spawnDetachedSelf() throwing SYNCHRONOUSLY here (rare — the 'error'
    // event below already handles the far more common case: the child
    // process itself failing to launch AFTER spawn() has already returned)
    // would otherwise be an uncaught exception right in the middle of an
    // update-apply restart — after the new code is already swapped in but
    // before it's ever launched or verified. Same class of crash found (and
    // fixed) in the backup download routes' unguarded fs.rmSync; guarded the
    // same way this exact function's other two call sites already are.
    try {
      child = spawnDetachedSelf();
    } catch (e) {
      return rollback(`could not launch replacement process (${e.message})`);
    }

    // A replacement that crashes during boot exits before it ever binds —
    // catch that immediately rather than waiting out the health-poll deadline.
    child.on('exit', (code) => rollback(`replacement process exited early (code ${code})`));
    child.on('error', (e) => rollback(`could not launch replacement process (${e.message})`));

    // Positive signal: the new version actually answering on the port.
    const deadline = Date.now() + 45000;
    const poll = () => {
      if (decided) return;
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/version', timeout: 2000 }, (r) => {
        let body = '';
        r.on('data', d => { body += d; });
        r.on('end', () => {
          if (decided) return;
          let v = null; try { v = JSON.parse(body).version; } catch {}
          if (v === targetVersion) handoff();
          else if (Date.now() < deadline) setTimeout(poll, 1500);
          else rollback('replacement never reported the new version');
        });
      });
      req.on('error', () => { if (!decided) (Date.now() < deadline ? setTimeout(poll, 1500) : rollback('replacement process not reachable')); });
      req.on('timeout', () => { req.destroy(); });
    };
    setTimeout(poll, 2500); // give the child a moment to bind before the first check
  }, 600); // small gap for close() to actually release the socket
}
// Called from installFromZip() and the manual backup-restore route once new
// code is staged. `targetVersion` is what the replacement should report on
// success; `rollbackDir` holds the code to restore if it doesn't.
function restartToApply(logLabel, targetVersion, rollbackDir) {
  console.log(`${logLabel}; restarting.`);
  if (IS_WIN) supervisedWindowsRestart(rollbackDir, targetVersion);
  else process.exit(0); // systemd (Restart=always) brings us back on Linux/Pi
}
// Plain platform-aware restart for a change that ISN'T a code swap — a
// data/backup restore, say. There's no code version to health-check or roll
// back to, so Windows just stops listening, relaunches itself, and exits
// (same net effect systemd gives on Linux). If the restored data is bad
// enough to stop boot, recovery is the documented manual path via the
// .pre-restore-backup folder, exactly as it already is on the Pi.
function restartPlain(logLabel) {
  console.log(`${logLabel}; restarting.`);
  try { stopCameraService('server restart'); } catch {}
  try { raStop('server restart'); } catch {}
  if (!IS_WIN) { process.exit(0); return; }
  try { if (httpServer) httpServer.close(); } catch {}
  setTimeout(() => {
    try { spawnDetachedSelf().unref(); } catch (e) { console.error('Relaunch failed — ' + e.message); }
    process.exit(0);
  }, 800);
}

// A wait-for-server wrapper (scripts/wait-for-server-and-launch-kiosk.sh) was
// added to fix a boot-time white-screen race — Chromium launching before the
// server was accepting connections — but it only ever gets WIRED into a
// user's actual autostart file by a full install.sh run. A routine self-
// update syncs the wrapper SCRIPT itself just fine ('scripts' is in
// UPDATE_CODE_ITEMS), but never touches autostart, so a device that was
// already running when the wrapper shipped can stay stuck on its old,
// unwrapped kiosk line indefinitely. This repairs that in place on every
// self-update, without re-running any of install.sh's heavier detection
// (session type, cursor tool, Chromium binary — no apt-get here, ever, and
// no interactivity): it only looks for an existing "--kiosk" line that
// isn't already wrapped, and rewrites just that line, preserving whatever
// binary/flags/URL the user already had. Never touches wayfire.ini —
// install.sh itself never auto-writes that one either (INI editing needs a
// human), so a wayfire user's line, if stale, stays a manual fix.
// Name of an admin-created systemd unit that already launches the kiosk
// browser (e.g. a hand-made pi-kiosk.service), or null. If one exists, a boot
// line that is currently DEAD must be left dead: repairing it would make the
// browser start twice on the next reboot - once from the unit, once from the
// autostart file. Wrapping a line that already works is unaffected.
function findSystemdKioskUnit(dir = '/etc/systemd/system') {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.service')) continue;
      let text = '';
      try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
      if (/^\s*ExecStart=.*chromium.*--kiosk/m.test(text)) return f;
    }
  } catch {}
  return null;
}

// Pure text transform for ONE autostart file (kept free of fs/os so it can be
// unit-tested by itself). Two repairs, both keyed on a line that launches the
// kiosk ("--kiosk"):
//   1. unwrapped   -> wrap it in the wait-for-server script (the original fix);
//   2. wrapped, but the wrapper path it names no longer exists -> repoint it at
//      the current wrapper. A line that merely CONTAINS the wrapper's filename
//      used to count as fixed, so a Pi whose project folder was renamed or moved
//      (an old "pi-calendar" install is the real-world case) kept a boot line
//      pointing at nothing forever: the kiosk never launched on reboot and no
//      update ever noticed. A wrapper path that exists but differs from ours is
//      left alone - that may be someone's deliberate second checkout.
// pathExists is injected (fs.existsSync in production).
// opts.repairDeadPaths === false skips repair 2 (see findSystemdKioskUnit).
function rewriteKioskAutostartText(original, style, waitScript, pathExists, opts) {
  const repairDead = !opts || opts.repairDeadPaths !== false;
  const WRAPPER = 'wait-for-server-and-launch-kiosk.sh';
  const wrapperPathRe = /\/[^\s"'`]*wait-for-server-and-launch-kiosk\.sh/g;
  let changed = false;
  const rewritten = original.split('\n').map((line) => {
    if (!line.includes('--kiosk')) return line;
    if (line.includes(WRAPPER)) {
      let fixed = line;
      for (const p of new Set(line.match(wrapperPathRe) || [])) {
        if (repairDead && p !== waitScript && !pathExists(p)) fixed = fixed.split(p).join(waitScript);
      }
      if (fixed !== line) changed = true;
      return fixed;
    }
    changed = true;
    if (style === 'lxsession') {
      // "@chromium --kiosk ... url" -> "@<waitScript> chromium --kiosk ... url"
      return `@${waitScript} ${line.replace(/^@/, '')}`;
    }
    // labwc: a shell script of background commands - the line may end in
    // " &"; keep that at the very end so it still backgrounds correctly.
    const hadTrailingBg = /\s*&\s*$/.test(line);
    const body = line.replace(/\s*&\s*$/, '');
    return `${waitScript} ${body}${hadTrailingBg ? ' &' : ''}`;
  });
  return { text: rewritten.join('\n'), changed };
}

function refreshKioskAutostartLine() {
  const home = os.homedir();
  const waitScript = path.join(__dirname, 'scripts', 'wait-for-server-and-launch-kiosk.sh');
  if (!fs.existsSync(waitScript)) return;

  // lxsession's autostart lives under a session-name subdirectory that isn't
  // a safe constant to assume (confirmed on real hardware — see install.sh's
  // own comment on this) — read the real name the same way it does, falling
  // back to the same default.
  let lxsessionName = 'LXDE-pi';
  try {
    const lightdmConf = fs.readFileSync('/etc/lightdm/lightdm.conf', 'utf8');
    const m = lightdmConf.match(/^\s*user-session\s*=\s*(\S+)/m);
    if (m) lxsessionName = m[1].trim();
  } catch {}

  const candidates = [
    { file: path.join(home, '.config', 'labwc', 'autostart'), style: 'shell' },
    { file: path.join(home, '.config', 'lxsession', lxsessionName, 'autostart'), style: 'lxsession' },
  ];
  // The session lightdm names is not always the one that ends up running (a Pi
  // switched between X11 and Wayland keeps every session's file; a real Pi 3B+
  // had four). Repair each one that exists so the fix can't miss the live one.
  try {
    const lxRoot = path.join(home, '.config', 'lxsession');
    for (const d of fs.readdirSync(lxRoot)) {
      const file = path.join(lxRoot, d, 'autostart');
      if (!candidates.some((c) => c.file === file) && fs.existsSync(file)) candidates.push({ file, style: 'lxsession' });
    }
  } catch {}

  const otherLauncher = findSystemdKioskUnit();
  if (otherLauncher) console.log(`Update: ${otherLauncher} already launches the kiosk - leaving any dead autostart wrapper path alone so the browser does not start twice.`);
  for (const { file, style } of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const original = fs.readFileSync(file, 'utf8');
      const { text, changed } = rewriteKioskAutostartText(original, style, waitScript, fs.existsSync, { repairDeadPaths: !otherLauncher });
      if (!changed) continue;
      fs.writeFileSync(file + '.piazzahq-preupdate-bak', original);
      fs.writeFileSync(file, text);
      console.log(`Update: repaired kiosk autostart line in ${file} (backup: ${path.basename(file)}.piazzahq-preupdate-bak)`);
    } catch (e) {
      console.error(`Update: kiosk autostart refresh failed for ${file} (continuing anyway) — ${e.message}`);
    }
  }
}

// Shared installer: given a staged zip on disk, validate it, back up the current
// code, swap in the new code (preserving user data), then restart (see
// restartToApply() — systemd on Linux, a supervised handoff on Windows).
// Used by BOTH the central-server pull and the hidden drop-zip fallback, so the
// safety logic lives in exactly one place. Sends the HTTP response on `res`.
const CONTAINER_UPDATE_MSG = 'This instance runs in a container. Update by pulling the latest image and recreating the container (e.g. `docker compose pull && docker compose up -d`) — the in-app updater can\'t swap code on an immutable image layer.';
function installFromZip(zipPath, res) {
  if (IS_CONTAINER) return res.status(409).json({ error: CONTAINER_UPDATE_MSG });
  const extractDir = path.join(UPDATE_TMP, 'extracted');
  const cleanup = () => { try { fs.rmSync(UPDATE_TMP, { recursive: true, force: true }); } catch {} };
  const fail = (msg) => { cleanup(); return res.status(400).json({ error: msg }); };

  try {
    // 1. Unpack to a staging folder.
    fs.rmSync(extractDir, { recursive: true, force: true });
    try {
      extractZip(zipPath, extractDir);
    } catch (e) {
      return fail('Could not unzip the update. The file may be incomplete or corrupt.');
    }

    // 2. Locate the project root inside the zip (we wrap in a top-level
    //    "piazzahq/" folder, but tolerate a flat zip too).
    let src = extractDir;
    const nested = path.join(extractDir, 'piazzahq');
    if (fs.existsSync(path.join(nested, 'server.js'))) src = nested;
    if (!fs.existsSync(path.join(src, 'server.js')) || !fs.existsSync(path.join(src, 'package.json'))) {
      return fail('That zip does not look like a Piazza HQ build (no server.js/package.json found).');
    }

    // 3. Validate the new server.js actually parses (compile-check, no run).
    try {
      execFileSync(process.execPath, ['--check', path.join(src, 'server.js')], { timeout: 30000 });
    } catch (e) {
      return fail('The new server.js failed a syntax check — update rejected to protect your install.');
    }

    let newVersion = 'unknown';
    try { newVersion = require(path.join(src, 'package.json')).version || 'unknown'; } catch {}

    // 4. Back up current code (NOT user data) into the rolling pool, for
    //    both auto-rollback (autoRollbackGuard reads the newest entry) and
    //    manual restore/download of any of the last ROLLING_BACKUP_LIMIT.
    //    Timestamp-prefixed folder name so plain alphabetical sort = time
    //    order, matching pruneRollingBackups()' own assumption.
    const rollingTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rollingDest = path.join(UPDATE_BACKUPS_ROLLING_DIR, `${rollingTimestamp}__v${APP_VERSION}`);
    backupCurrentCodeInto(rollingDest);
    pruneRollingBackups();

    // 5. Swap in new code, preserving user data (calendar.db, uploads,
    //    .session-secret are never in the zip). When uploads live under
    //    public/ (the default), the public/ wipe below would take them out,
    //    so they're backed up and restored around it. With DATA_DIR set,
    //    uploads live on the volume, outside public/ — nothing special needed.
    const copyItem = (name) => {
      const from = path.join(src, name), to = path.join(__dirname, name);
      if (!fs.existsSync(from)) return;
      if (name === 'public' && UPLOADS_INSIDE_PUBLIC) {
        const uploadsBackup = path.join(UPDATE_TMP, 'uploads-keep');
        const liveUploads = UPLOAD_DIR;
        if (fs.existsSync(liveUploads)) fs.cpSync(liveUploads, uploadsBackup, { recursive: true });
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(from, to, { recursive: true });
        if (fs.existsSync(uploadsBackup)) {
          fs.rmSync(path.join(to, 'uploads'), { recursive: true, force: true });
          fs.cpSync(uploadsBackup, path.join(to, 'uploads'), { recursive: true });
        }
      } else {
        if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(from, to, { recursive: true });
      }
    };
    for (const name of UPDATE_CODE_ITEMS) copyItem(name);

    // 5b. Best-effort npm install, in case this update added a new dependency
    // (package.json just got swapped in above, but node_modules wasn't touched).
    // Without this, a normal zip update could break the server outright the
    // moment it requires a package that was never installed — this update flow
    // previously never ran npm install at all, unlike the central server's own
    // self-update path, which already does this defensively. Doesn't block or
    // fail the update if it can't run (e.g. no internet) — most updates don't
    // add a dependency at all, so this should be a fast no-op most of the time.
    //
    // Skipped entirely on Windows. The bundled build ships a complete,
    // pinned node_modules produced at build time; it has no compiler, so it
    // can't build a native dependency at runtime regardless; and every
    // optional dependency this server loads (tv-control, ws, ask-sdk) is
    // already behind a defensive try/require that degrades gracefully if it's
    // absent. Running `npm install` here bought nothing on Windows and — with
    // no `npm` on PATH and the process's event loop blocked synchronously for
    // the duration — risked stalling the whole update for minutes on a slow
    // or offline machine. A future update that genuinely needs a new pure-JS
    // dependency has to bundle it into the build, not fetch it on-device.
    if (!IS_WIN) {
      try {
        execFileSync('npm', ['install', '--omit=dev'], { cwd: __dirname, timeout: 180000, stdio: 'pipe' });
      } catch (e) {
        console.error('Update: npm install failed (continuing anyway) — ' + (e.stderr ? e.stderr.toString().slice(-300) : e.message));
      }
    }

    // 5b2. Best-effort kiosk-autostart repair — see refreshKioskAutostartLine()
    // above for why. Pi only: Windows and containers have no kiosk-autostart
    // concept at all, so DEPLOYMENT === 'pi' (not just !IS_WIN) is the right gate.
    if (DEPLOYMENT === 'pi') {
      try {
        refreshKioskAutostartLine();
      } catch (e) {
        console.error('Update: kiosk autostart refresh failed (continuing anyway) — ' + e.message);
      }
    }

    // 5c. Monthly historical snapshot — of the NEWLY-installed code (__dirname
    // now holds it, post-swap), unlike the rolling backup above which captures
    // the OLD pre-update state. Stable releases only (no "-beta." in the
    // version string) — a long beta cycle can span multiple months without
    // ever producing one, which is intentional. Only the first stable release
    // in a given calendar month creates one; later ones that month don't.
    try {
      const isStableRelease = !/-beta\./i.test(newVersion);
      if (isStableRelease) {
        fs.mkdirSync(UPDATE_BACKUPS_MONTHLY_DIR, { recursive: true });
        const yyyyMM = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
        const alreadyHasThisMonth = fs.readdirSync(UPDATE_BACKUPS_MONTHLY_DIR).some(f => f.startsWith(yyyyMM + '__'));
        if (!alreadyHasThisMonth) {
          backupCurrentCodeInto(path.join(UPDATE_BACKUPS_MONTHLY_DIR, `${yyyyMM}__v${newVersion}`));
        }
      }
    } catch (e) {
      // Never let a monthly-snapshot failure block the update itself.
      console.error('Monthly backup snapshot failed (continuing anyway) — ' + e.message);
    }

    // 6. Mark pending (enables auto-rollback) and restart.
    fs.writeFileSync(PENDING_FLAG, '0');
    cleanup();
    res.json({ ok: true, from: APP_VERSION, to: newVersion,
      message: 'Update staged. Restarting now — the app will reconnect in a few seconds.' });
    setTimeout(() => {
      restartToApply(`Applying update ${APP_VERSION} -> ${newVersion}`, newVersion, rollingDest);
    }, 700);
  } catch (e) {
    return fail('Update failed: ' + e.message);
  }
}

// ── Update backup management (list / download / manual restore) ───────────────
// Everything below operates on the two retained backup pools installFromZip()
// populates above — ROLLING (last 10 updates) and MONTHLY (one per calendar
// month, stable releases only). The automatic "3 failed boots" rollback in
// autoRollbackGuard() always uses the newest rolling one and needs none of
// this; these endpoints exist so a person can see what's retained, pull any
// of them back down as a zip, or manually restore to one on purpose (not
// just as an automatic crash-recovery reaction).
function backupDirFor(type) {
  return type === 'monthly' ? UPDATE_BACKUPS_MONTHLY_DIR : UPDATE_BACKUPS_ROLLING_DIR;
}
// Folder names are '<timestamp-or-YYYY-MM>__v<version>' — split back apart
// for display rather than showing the raw folder name in the UI.
function parseBackupFolderName(name) {
  const idx = name.indexOf('__v');
  if (idx === -1) return { label: name, version: 'unknown' };
  return { label: name.slice(0, idx), version: name.slice(idx + 3) };
}
// Folder names are server-generated (timestamp/version), never expected to
// contain path separators or '..' — reject anything that does rather than
// trusting a client-supplied :name to be well-formed before it's joined
// into a filesystem path.
function isSafeBackupName(name) {
  return typeof name === 'string' && name.length > 0 && !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

// GET /api/update-backups — lists every retained code backup (rolling +
// monthly), newest first within each group, for the Advanced Settings UI.
app.get('/api/update-backups', (req, res) => {
  const listDir = (dir, type) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).sort().reverse().map(name => {
      const { label, version } = parseBackupFolderName(name);
      let createdAt = null;
      try { createdAt = fs.statSync(path.join(dir, name)).birthtime.toISOString(); } catch {}
      return { type, name, label, version, createdAt };
    });
  };
  res.json({
    rolling: listDir(UPDATE_BACKUPS_ROLLING_DIR, 'rolling'),
    monthly: listDir(UPDATE_BACKUPS_MONTHLY_DIR, 'monthly'),
    currentVersion: APP_VERSION,
  });
});

// GET /api/update-backups/:type/:name/download — zips a specific backup in
// the exact same format installFromZip() expects to receive back (wrapped
// in a top-level "piazzahq/" folder) — the same zip shape as any other
// delivered build, so a downloaded backup can be re-uploaded through the
// normal Update flow if ever needed, not just kept as a passive archive.
app.get('/api/update-backups/:type/:name/download', (req, res) => {
  const { type, name } = req.params;
  if (type !== 'rolling' && type !== 'monthly') return res.status(400).json({ error: "type must be 'rolling' or 'monthly'" });
  if (!isSafeBackupName(name)) return res.status(400).json({ error: 'Invalid backup name.' });
  const srcDir = path.join(backupDirFor(type), name);
  if (!fs.existsSync(srcDir)) return res.status(404).json({ error: 'Backup not found.' });
  try { assertZipToolAvailable(); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  try {
    const stageRoot = path.join(UPDATE_TMP, 'backup-zip-stage');
    const stageDir = path.join(stageRoot, 'piazzahq');
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });
    for (const item of fs.readdirSync(srcDir)) {
      fs.cpSync(path.join(srcDir, item), path.join(stageDir, item), { recursive: true });
    }
    const { label, version } = parseBackupFolderName(name);
    const zipName = `piazzahq-v${version}-${type}-${label}.zip`;
    const zipPath = path.join(stageRoot, zipName);
    try { fs.unlinkSync(zipPath); } catch {}
    makeZip(zipName, stageRoot, 'piazzahq');
    res.download(zipPath, zipName, (err) => {
      if (err) console.error('Backup zip download error:', err.message);
      // Same crash found and fixed at /api/backup/download above: this runs
      // in res.download()'s async callback, outside this route's own
      // try/catch — an unguarded fs.rmSync failure here (e.g. Windows'
      // known ENOTEMPTY-on-a-just-emptied-directory quirk) is an uncaught
      // exception that takes down the whole process, not just this request.
      try {
        fs.rmSync(stageRoot, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error('Backup zip staging cleanup failed (non-fatal, stray folder may remain):', cleanupErr.message);
      }
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/update-backups/:type/:name/restore — manually restores a
// specific backup on purpose, not just the automatic "3 failed boots"
// rollback (which always uses the newest rolling one and never any older
// or monthly backup). Same restart-and-recover mechanism as a normal
// update: validate, back up what's currently running first (restoring an
// old backup is itself a code change and deserves the same rollback
// safety net a normal update gets, not an exception to it), swap, mark
// pending, restart.
app.post('/api/update-backups/:type/:name/restore', (req, res) => {
  if (IS_CONTAINER) return res.status(409).json({ error: CONTAINER_UPDATE_MSG }); // this restores CODE — data restore (/api/backup/restore) still works
  const { type, name } = req.params;
  if (type !== 'rolling' && type !== 'monthly') return res.status(400).json({ error: "type must be 'rolling' or 'monthly'" });
  if (!isSafeBackupName(name)) return res.status(400).json({ error: 'Invalid backup name.' });
  const srcDir = path.join(backupDirFor(type), name);
  if (!fs.existsSync(srcDir)) return res.status(404).json({ error: 'Backup not found.' });
  const srcServerJs = path.join(srcDir, 'server.js');
  if (fs.existsSync(srcServerJs)) {
    try {
      execFileSync(process.execPath, ['--check', srcServerJs], { timeout: 30000 });
    } catch (e) {
      return res.status(400).json({ error: 'That backup\'s server.js failed a syntax check — restore rejected to protect your install.' });
    }
  }
  try {
    const rollingTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const preRestoreBackup = path.join(UPDATE_BACKUPS_ROLLING_DIR, `${rollingTimestamp}__v${APP_VERSION}`);
    backupCurrentCodeInto(preRestoreBackup);
    pruneRollingBackups();
    for (const item of UPDATE_CODE_ITEMS) {
      const from = path.join(srcDir, item), to = path.join(__dirname, item);
      if (!fs.existsSync(from)) continue;
      if (item === 'public' && UPLOADS_INSIDE_PUBLIC) {
        const uploadsBackup = path.join(UPDATE_TMP, 'uploads-keep-restore');
        const liveUploads = UPLOAD_DIR;
        if (fs.existsSync(liveUploads)) fs.cpSync(liveUploads, uploadsBackup, { recursive: true });
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(from, to, { recursive: true });
        if (fs.existsSync(uploadsBackup)) {
          fs.rmSync(path.join(to, 'uploads'), { recursive: true, force: true });
          fs.cpSync(uploadsBackup, path.join(to, 'uploads'), { recursive: true });
        }
      } else {
        if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(from, to, { recursive: true });
      }
    }
    const { version } = parseBackupFolderName(name);
    fs.writeFileSync(PENDING_FLAG, '0');
    res.json({ ok: true, from: APP_VERSION, to: version,
      message: 'Restoring — restarting now, the app will reconnect in a few seconds.' });
    setTimeout(() => {
      restartToApply(`Manually restoring backup ${name} (v${version})`, version, preRestoreBackup);
    }, 700);
  } catch (e) {
    res.status(500).json({ error: 'Restore failed: ' + e.message });
  }
});

// Helper: read an update setting with a sane default.
function updateSetting(key, dflt) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return (row && row.value !== undefined && row.value !== '') ? row.value : dflt;
}

// Ask the central server whether a newer version exists for this device's channel.
// Returns the mothership's JSON (updateAvailable, latestVersion, notes, downloadUrl…).
function fetchUpdateInfo() {
  return new Promise((resolve, reject) => {
    const serverUrl = resolveUpdateServerUrl();
    if (!serverUrl) return reject(new Error('No update server configured.'));
    // Always 'stable' — there is no beta-channel toggle in this app anymore (removed
    // along with the rest of the manual update controls). Deliberately hardcoded
    // rather than read from the update_channel setting: a device that had beta
    // switched on before that toggle was removed would otherwise be permanently
    // stuck reporting 'beta' forever, with no UI left to change it back.
    const channel = 'stable';
    const deviceId = updateSetting('screen_device_id_cache', '') || 'pi';
    const role = updateSetting('device_role', 'host'); // matches the app's own default
    const licenseKey = updateSetting('update_license_key', '');
    // The person's own chosen name for this screen (e.g. "Kitchen", "Home") —
    // sent so the central admin panel can show a real label per device instead
    // of only an opaque device-id hash, which is unreadable at a glance and
    // gives no way to tell devices apart or match one to what's physically
    // sitting on a counter somewhere.
    const deviceName = updateSetting('display_name', '');
    const u = new URL(serverUrl + '/api/v1/update-check');
    u.searchParams.set('current', APP_VERSION);
    u.searchParams.set('channel', channel);
    u.searchParams.set('device', deviceId);
    u.searchParams.set('role', role);
    if (deviceName) u.searchParams.set('name', deviceName);
    // ── Fleet-health telemetry (see FLEET-OBSERVABILITY-SPEC.md) ──
    // Generic device-health fields, deliberately not phrased around
    // "update-check" — a future faster health-ping sends the same set.
    u.searchParams.set('deployment', DEPLOYMENT);            // pi | windows | container
    u.searchParams.set('uptime', String(Math.round(process.uptime()))); // seconds; resets each check-in => crash-looping
    if (getHaHealth()) u.searchParams.set('ha', getHaHealth().ok ? '1' : '0');   // omitted = never talked to HA
    try {
      const st = fs.statfsSync(DATA_DIR || __dirname);
      u.searchParams.set('disk', String(Math.round(st.bfree * st.bsize / 1048576))); // free MB on the data volume
    } catch { /* statfsSync unsupported here — skip */ }
    if (_lastCrash) {
      u.searchParams.set('crash', `${Math.round(_lastCrash.at / 1000)}:${_lastCrash.reason}`.slice(0, 320));
    }
    const mod = u.protocol === 'https:' ? https : http;
    const reqOpts = { timeout: 10000, headers: licenseKey ? { 'x-license-key': licenseKey } : {} };
    const req = mod.get(u.toString(), reqOpts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        // Real gap, found live: this used to parse+resolve ANY response that
        // happened to be valid JSON, with no status-code check at all —
        // registerTrialLicense() right below already gets this right
        // (`r.statusCode >= 200 && r.statusCode < 300`), this just never
        // matched it. An error body like {"error":"..."} parses fine and has
        // no licenseStatus field, so isLicenseValid(undefined, undefined)
        // silently returned false — a transient server-side hiccup (a rate
        // limit, a brief 5xx) would get treated exactly like "you have no
        // license" and start the grace-period countdown for real. Rejecting
        // here instead routes it through periodicUpdateCheck()'s existing
        // catch, which already correctly leaves no_license_since untouched
        // on any failure to reach the server at all.
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return reject(new Error(`Update server returned HTTP ${r.statusCode}.`));
        }
        try {
          const parsed = JSON.parse(data);
          _lastCrash = null; // reported — don't repeat it on the next check-in
          resolve(parsed);
        } catch (e) { reject(new Error('Bad response from update server.')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Update server timed out.')); });
  });
}

// POST an email to the central server's trial-signup endpoint, server-to-server —
// this deliberately never runs in the browser (which would hit CORS, since it's a
// cross-origin request the central server doesn't allow from arbitrary pages).
// Returns the mothership's JSON ({ licenseKey }).
// Also sends this device's own ID, so the central server can tell "a genuinely
// different device already claims this email's host slot" apart from "this is
// the same device re-running setup" — without it, every duplicate-email
// registration would look identical from the server's side.
function registerTrialLicense(email, extra = {}) {
  return new Promise((resolve, reject) => {
    const serverUrl = resolveUpdateServerUrl();
    if (!serverUrl) return reject(new Error('No update server configured.'));
    const u = new URL(serverUrl + '/api/trial/signup');
    const mod = u.protocol === 'https:' ? https : http;
    const deviceId = updateSetting('screen_device_id_cache', '') || '';
    // The household language, so the welcome email with the key is written in it (the central server falls back to English for anything it doesn't know).
    // The optional "how did you hear about us" answer rides along (a short code, plus a few words for "somewhere else"); the central server validates it.
    const heard = (extra && typeof extra.heardFrom === 'string' && extra.heardFrom) ? { heardFrom: extra.heardFrom.slice(0, 20), heardFromOther: String(extra.heardFromOther || '').slice(0, 100) } : {};
    const body = JSON.stringify({ email, deviceId, lang: updateSetting('ui_language', 'en'), ...heard });
    const reqOpts = {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = mod.request(u, reqOpts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (r.statusCode >= 200 && r.statusCode < 300) resolve(parsed);
          else if (r.statusCode === 409 && parsed.error === 'host_conflict') {
            // A structured, expected conflict — not a generic failure.
            // Carried as a property on the Error (rather than resolving
            // normally with an error field) so the existing try/catch in
            // registerAndFinish() still routes it through one path, while
            // still being distinguishable from a real failure once caught.
            const err = new Error(parsed.message || 'Another device is already the host for this email.');
            err.hostConflict = true;
            err.otherHostDeviceId = parsed.otherHostDeviceId;
            err.otherHostLastSeen = parsed.otherHostLastSeen;
            reject(err);
          }
          else reject(new Error(parsed.error || `Registration failed (${r.statusCode}).`));
        } catch (e) { reject(new Error('Bad response from update server.')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Update server timed out.')); });
    req.write(body);
    req.end();
  });
}

// Tells the mothership how a host-conflict popup (Settings) was resolved —
// 'claim' (this device becomes the recognized host), 'slave' (this device is
// actually a second screen for the same household — becomes a genuine
// Multi-Device slave of the OTHER device instead of independently claiming
// the license), or 'trial' (this device opts out of the license entirely,
// running independently on the free tier). Mirrors registerTrialLicense()'s
// request mechanics exactly.
function resolveHostConflictOnServer(deviceId, action) {
  return new Promise((resolve, reject) => {
    const serverUrl = resolveUpdateServerUrl();
    if (!serverUrl) return reject(new Error('No update server configured.'));
    const licenseKey = updateSetting('update_license_key', '');
    if (!licenseKey) return reject(new Error('No license key configured on this device.'));
    const u = new URL(serverUrl + '/api/v1/resolve-host-conflict');
    const mod = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify({ deviceId, action });
    const reqOpts = {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-license-key': licenseKey },
    };
    const req = mod.request(u, reqOpts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (r.statusCode >= 200 && r.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error || `Resolution failed (${r.statusCode}).`));
        } catch (e) { reject(new Error('Bad response from update server.')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Update server timed out.')); });
    req.write(body);
    req.end();
  });
}

// Download a URL to a file on disk (follows the mothership's download endpoint).
function downloadToFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(fileUrl);
    const mod = u.protocol === 'https:' ? https : http;
    const doGet = (urlStr, redirects) => {
      const req = mod.get(urlStr, { timeout: 60000 }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects < 5) {
          r.resume();
          return doGet(new URL(r.headers.location, urlStr).toString(), redirects + 1);
        }
        if (r.statusCode !== 200) { r.resume(); return reject(new Error('Download failed (HTTP ' + r.statusCode + ').')); }
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const out = fs.createWriteStream(destPath);
        r.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Download timed out.')); });
    };
    doGet(fileUrl, 0);
  });
}

// USER-FACING: called once from the first-run setup wizard (host device only) to
// register a real license via the central server, using just an email — no
// payment, same as the marketing site's free-trial signup. Stores the returned
// key the same way a manually-entered one would be, so it's immediately used by
// fetchUpdateInfo() on the very next check.
// Validates a license key against the central server, for the mirror setup
// wizard's own upfront feedback — separate from (and in addition to) the
// actual enforcement in /api/sync/export's checkMirrorLicense(), which is
// what genuinely gates sync. This just lets the wizard say "we don't
// recognize that key" immediately, rather than only discovering a mismatch
// later when the first background sync silently fails.
app.post('/api/validate-license', async (req, res) => {
  const key = (req.body && req.body.licenseKey || '').trim();
  if (!key) return res.json({ valid: false });
  const serverUrl = resolveUpdateServerUrl();
  if (!serverUrl) return res.json({ valid: null }); // no server configured — can't check either way
  try {
    const result = await fetchJSON(`${serverUrl}/api/v1/license-check?license=${encodeURIComponent(key)}`, 6000);
    res.json({ valid: !!(result && result.valid) });
  } catch {
    // Unreachable central server — fail OPEN (unverified, not invalid).
    // Blocking mirror setup entirely over a transient network hiccup during
    // initial setup would be worse than letting it proceed; the host-side
    // check in /api/sync/export still catches a genuinely wrong key at the
    // first actual sync attempt regardless.
    res.json({ valid: null });
  }
});

app.post('/api/register-trial', async (req, res) => {
  const email = (req.body && req.body.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  try {
    const result = await registerTrialLicense(email, { heardFrom: req.body && req.body.heardFrom, heardFromOther: req.body && req.body.heardFromOther });
    if (result.licenseKey) {
      // Brand-new signup — key comes back directly, same as always. No
      // prior owner to protect for a fresh trial.
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('update_license_key', ?)`).run(result.licenseKey);
      return res.json({ ok: true, licenseKey: result.licenseKey });
    }
    if (result.emailed) {
      // Existing email — the mothership emailed the real key instead of
      // returning it here. This endpoint has no PIN to gate it during
      // initial setup (none is configured yet), so it's just as reachable
      // as the marketing site's own signup form was — returning an
      // EXISTING license's key directly here would be the exact same
      // vulnerability that got fixed there, just reached through a
      // different door. Nothing to save locally yet; the wizard tells the
      // person to check their email and paste the key in themselves.
      return res.json({ ok: true, emailed: true });
    }
    throw new Error('No license key returned.');
  } catch (e) {
    if (e.hostConflict) {
      // Forwarded as its own recognizable shape (not just a message string)
      // so the wizard's front-end can offer a real choice UI instead of
      // showing this as a plain error — see registerAndFinish() in app.html.
      return res.status(409).json({
        error: 'host_conflict',
        message: e.message,
        otherHostDeviceId: e.otherHostDeviceId,
        otherHostLastSeen: e.otherHostLastSeen,
      });
    }
    res.status(502).json({ error: e.message || 'Could not reach the update server.' });
  }
});

// USER-FACING: resolves a host-conflict popup shown in Settings. Handles the
// LOCAL side effects for each action, then tells the mothership which one
// was chosen so it can update (or leave alone) the recognized host on its
// side. Either way, clears this device's own host_conflict_cache so the
// popup stops showing immediately, rather than needing to wait for the next
// scheduled check-in to notice the conflict was already resolved.
app.post('/api/resolve-host-conflict', async (req, res) => {
  const action = (req.body && req.body.action || '').toString().trim();
  if (!['claim', 'slave', 'trial'].includes(action)) {
    return res.status(400).json({ error: `Unknown action "${action}".` });
  }
  const deviceId = updateSetting('screen_device_id_cache', '') || 'pi';
  try {
    await resolveHostConflictOnServer(deviceId, action);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not reach the update server.' });
  }
  // Local side effects, only after the mothership confirmed the resolution.
  if (action === 'slave') {
    // This device is actually a second screen for the same household —
    // becomes a genuine Multi-Device slave. Deliberately does NOT try to
    // guess/auto-fill the other host's address (the conflict info only ever
    // had its device id, not a reachable address) — Multi-Device settings is
    // where that actually belongs, same as setting it up from scratch.
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('device_role', 'slave')`).run();
  } else if (action === 'trial') {
    // Opts this device out of the license entirely — clearing the key means
    // the very next check-in simply won't present one at all.
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('update_license_key', '')`).run();
  }
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('host_conflict_cache', '')`).run();
  res.json({ ok: true });
});

// USER-FACING: Multi-Device settings' "Other devices on this license" list —
// proactively browsing every device the mothership has ever seen present
// this license's key (not just an active conflict popup — retired hardware
// shows up here too), and a way to remove one directly, without waiting on
// the emailed host-claim link or the developer's help. Real feedback
// (#31/#32): someone moved hosts and had no way to see or clear out the old
// device themselves. Proxies to the mothership's own device-facing,
// license-key-authenticated routes — same credential every check-in already
// presents, nothing new to configure.
app.get('/api/license-devices', async (req, res) => {
  const serverUrl = resolveUpdateServerUrl();
  const licenseKey = getSetting('update_license_key') || '';
  if (!serverUrl) return res.status(400).json({ error: 'No update server configured.' });
  if (!licenseKey) return res.status(400).json({ error: 'No license key configured on this device.' });
  try {
    const r = await fetchWithTimeout(`${serverUrl}/api/v1/license-devices`, {
      headers: { 'x-license-key': licenseKey },
      timeoutMs: 10000,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json(body);
    // The app has no other way to know this device's own id (it's a server-
    // side identity concept the phone app never otherwise needs) — included
    // here so the Multi-Device UI can label "this device" and hide the
    // remove button on its own row, matching the same rule enforced below.
    res.json({ ...body, ownDeviceId: updateSetting('screen_device_id_cache', '') || '' });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the update server: ' + e.message });
  }
});
app.post('/api/license-devices/:deviceId/revoke', async (req, res) => {
  const serverUrl = resolveUpdateServerUrl();
  const licenseKey = getSetting('update_license_key') || '';
  if (!serverUrl) return res.status(400).json({ error: 'No update server configured.' });
  if (!licenseKey) return res.status(400).json({ error: 'No license key configured on this device.' });
  // The UI shouldn't offer this for the device's own row at all, but enforce
  // it here too rather than trusting the client alone — removing yourself
  // would just re-register on the next check-in anyway, so this is purely
  // about not letting a stray/scripted call confuse someone.
  const ownId = updateSetting('screen_device_id_cache', '') || '';
  if (req.params.deviceId === ownId) {
    return res.status(400).json({ error: "That's this device's own entry — nothing to remove." });
  }
  try {
    const r = await fetchWithTimeout(`${serverUrl}/api/v1/license-devices/${encodeURIComponent(req.params.deviceId)}/revoke`, {
      method: 'POST',
      headers: { 'x-license-key': licenseKey },
      timeoutMs: 10000,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json(body);
    res.json(body);
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the update server: ' + e.message });
  }
});

// USER-FACING: is there an update available from the central server?
app.get('/api/update-check', async (req, res) => {
  try {
    const info = await fetchUpdateInfo();
    res.json({ ...info, currentVersion: APP_VERSION });
  } catch (e) {
    res.json({ updateAvailable: false, currentVersion: APP_VERSION, error: e.message });
  }
});

// USER-FACING: pull the latest release from the central server and install it.
app.post('/api/update-from-server', async (req, res) => {
  if (IS_CONTAINER) return res.status(409).json({ error: CONTAINER_UPDATE_MSG });
  try {
    const info = await fetchUpdateInfo();
    if (!info.updateAvailable || !info.downloadUrl) {
      console.error('Manual update install failed: no update available (checked, none found or no downloadUrl).');
      return res.status(400).json({ error: 'No update is available to install.' });
    }
    fs.mkdirSync(UPDATE_TMP, { recursive: true });
    const zipPath = path.join(UPDATE_TMP, 'pulled.zip');
    await downloadToFile(info.downloadUrl, zipPath);
    // Hand off to the shared installer (validates, backs up, swaps, restarts).
    installFromZip(zipPath, res);
  } catch (e) {
    console.error('Manual update install failed:', e.message);
    res.status(500).json({ error: 'Could not fetch the update: ' + e.message });
  }
});

// MANUAL FALLBACK (Advanced): direct drop-zip upload. Originally paired with
// an "Advanced: install a zip manually" drop-zone in app.html — that UI no
// longer exists (nothing in app.html/display.html/hub.html calls this route
// at all), so as of this comment it's only reachable by someone hand-crafting
// a request (curl, etc.), not from anywhere in the app itself. Still useful
// as a manual escape hatch when the central server is unreachable, which is
// presumably why it was never actually deleted despite the original
// "TODO(before public launch): remove this" — but that's a real decision to
// make explicitly (keep as an intentional CLI-only fallback, or actually
// remove it now that launch has long since happened), not something to leave
// unresolved indefinitely. Now requires a PIN unconditionally regardless of
// whether one's otherwise configured (see ALWAYS_AUTH_ROUTES above) — a bad
// actor on the network can no longer reach this even on a PIN-less device.
app.post('/api/update', updateUpload.single('package'), async (req, res) => {
  if (IS_CONTAINER) return res.status(409).json({ error: CONTAINER_UPDATE_MSG });
  if (!req.file) return res.status(400).json({ error: 'No .zip uploaded (field name must be "package").' });
  const zipPath = path.join(UPDATE_TMP, 'upload.zip');
  installFromZip(zipPath, res);
});

// GUIDED CENTRAL-SERVER INSTALL (Advanced): drop the piazzahq-server zip in the
// app, and we (1) unzip it to a sibling folder this user owns, (2) run npm install,
// (3) generate a feedback secret, and (4) return the exact sudo commands to finish
// (systemd service + Tailscale Funnel) for the operator to paste into a terminal.
// We do NOT run the privileged steps ourselves — the app runs unprivileged by design.
app.post('/api/install-server', serverUpload.single('package'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No .zip uploaded (field name must be "package").' });
  const zipPath = path.join(UPDATE_TMP, 'server-upload.zip');
  const tmpExtract = path.join(UPDATE_TMP, 'server-extracted');
  try {
    fs.rmSync(tmpExtract, { recursive: true, force: true });
    fs.mkdirSync(tmpExtract, { recursive: true });
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmpExtract], { timeout: 60000 });

    // The zip may contain either piazzahq-server/* or the files at the root.
    let src = tmpExtract;
    if (fs.existsSync(path.join(tmpExtract, 'piazzahq-server', 'server.js'))) {
      src = path.join(tmpExtract, 'piazzahq-server');
    }
    if (!fs.existsSync(path.join(src, 'server.js')) || !fs.existsSync(path.join(src, 'store.js'))) {
      throw new Error('That zip does not look like the central server (server.js/store.js missing).');
    }

    // Move into place (sibling of the app dir). Preserve existing data/ if present.
    fs.mkdirSync(SERVER_INSTALL_DIR, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === 'data' || entry === 'releases' || entry === 'feedback-images' || entry === 'node_modules') continue;
      const from = path.join(src, entry);
      const to = path.join(SERVER_INSTALL_DIR, entry);
      fs.rmSync(to, { recursive: true, force: true });
      fs.cpSync(from, to, { recursive: true });
    }

    // Best-effort npm install (no root needed). If it fails (e.g. offline), we tell
    // the operator to run it manually — the rest of the guidance still applies.
    let npmOk = false, npmMsg = '';
    try {
      execFileSync('npm', ['install', '--omit=dev'], { cwd: SERVER_INSTALL_DIR, timeout: 180000, stdio: 'pipe' });
      npmOk = true;
    } catch (e) {
      npmMsg = (e.stderr ? e.stderr.toString() : e.message).slice(-400);
    }

    // Generate a feedback secret + a suggested admin password (operator can change).
    // Reuse existing secrets if the server was installed before, so re-running the
    // installer doesn't create a password mismatch with an already-configured
    // service. We look for a previously saved .install-secrets.json next to the
    // server; if absent, generate fresh ones and save them.
    const crypto = require('crypto');
    const secretsFile = path.join(SERVER_INSTALL_DIR, '.install-secrets.json');
    let feedbackSecret, adminPassword;
    try {
      if (fs.existsSync(secretsFile)) {
        const prev = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
        feedbackSecret = prev.feedbackSecret;
        adminPassword = prev.adminPassword;
      }
    } catch { /* fall through to fresh generation */ }
    if (!feedbackSecret || !adminPassword) {
      feedbackSecret = crypto.randomBytes(18).toString('base64url');
      adminPassword  = crypto.randomBytes(12).toString('base64url');
      try { fs.writeFileSync(secretsFile, JSON.stringify({ feedbackSecret, adminPassword }), { mode: 0o600 }); } catch {}
    }
    const reused = fs.existsSync(secretsFile);
    const user = require('os').userInfo().username;

    // Write the .env file ourselves (we own this directory — no root needed). This
    // is what made manual setup fragile before: pasting a heredoc into a terminal
    // could drop the closing marker. By writing the file here, the operator only
    // needs to COPY it into place with a simple one-line command.
    const envContents =
`PORT=4000
ADMIN_PASSWORD=${adminPassword}
FEEDBACK_INTAKE_SECRET=${feedbackSecret}
`;
    try { fs.writeFileSync(path.join(SERVER_INSTALL_DIR, '.env'), envContents, { mode: 0o600 }); } catch {}

    // Write a ready-made systemd unit file into the install dir. The operator just
    // copies it to /etc/systemd/system with one command — no heredoc to mangle.
    const unitContents =
`[Unit]
Description=Piazza HQ Central Server
After=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${SERVER_INSTALL_DIR}
EnvironmentFile=${SERVER_INSTALL_DIR}/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
    const unitPath = path.join(SERVER_INSTALL_DIR, 'piazzahq-server.service');
    try { fs.writeFileSync(unitPath, unitContents); } catch {}

    // Clean up the staging area.
    fs.rmSync(tmpExtract, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });

    res.json({
      ok: true,
      installDir: SERVER_INSTALL_DIR,
      npmInstalled: npmOk,
      npmError: npmOk ? '' : npmMsg,
      feedbackSecret,
      adminPassword,
      reusedSecrets: reused,
      user,
      // The app already wrote .env and piazzahq-server.service into the install
      // dir. These are simple ONE-LINE commands (no heredocs) to finish — safe to
      // paste together or one at a time.
      finishCommands:
`sudo systemctl stop piazzahq-server 2>/dev/null; sudo pkill -f "node server.js" 2>/dev/null; sleep 1
sudo cp ${unitPath} /etc/systemd/system/piazzahq-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now piazzahq-server
sudo tailscale funnel --bg 4000
sudo tailscale funnel status`,
    });
  } catch (e) {
    try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch {}
    res.status(400).json({ error: 'Server install failed: ' + e.message });
  }
});


// Explicit no-store on every core page — these are actively-developed,
// frequently-updated files, and a browser silently serving a stale cached
// copy indefinitely (rather than the version this server actually has) is
// exactly the kind of thing that looks identical to a real bug from the
// outside, while being invisible to any diagnostic logging added to the
// app itself, since that logging is inside the very file that's stale.
function sendCorePage(req, res, filePath) {
  res.set('Cache-Control', 'no-store');
  staticCompress.trySend(req, res, filePath, { 'Cache-Control': 'no-store' }).then((done) => { if (!done && !res.headersSent) res.sendFile(filePath); }, () => { if (!res.headersSent) res.sendFile(filePath); });
}

// Demo lease gate — only active when the pool broker wired this instance up
// (DEMO_BROKER_URL + DEMO_INSTANCE). On each core-page load, ask the broker
// whether the visitor's demo_token cookie still owns a live lease on THIS
// instance; if not, bounce them to /demo to get a fresh one (or the "busy"
// page). Server-to-server, so no CORS. Result cached ~10s per token so a
// burst of asset-less reloads doesn't fan out to the broker. Fails OPEN on a
// broker blip — a transient network error must not lock a paying-attention
// visitor out mid-session; the lease still expires server-side either way.
const _demoLeaseCache = new Map(); // key -> { at }
async function demoLeaseGate(req, res, next) {
  if (!IS_DEMO || !DEMO_BROKER_URL || !DEMO_INSTANCE) return next();
  const cookies = req.headers.cookie || '';
  const tokM = cookies.match(/(?:^|;\s*)demo_token=([^;]+)/);
  const token = tokM ? tokM[1] : '';
  // "scan" mode: a phone that scanned the wall display's QR (…/app?scan=1).
  // It has no lease of its own — it rides whatever lease is currently active
  // on THIS instance, and is bounced when that ends, same as the wall. A
  // `demo_scan` cookie keeps it working across reloads.
  const scan = req.query.scan === '1' || /(?:^|;\s*)demo_scan=1/.test(cookies);
  const bounce = () => res.redirect(302, `${DEMO_BROKER_URL}/demo`);
  if (!token && !scan) return bounce();

  const key = token ? `t:${token}` : `s:${DEMO_INSTANCE}`;
  const grant = () => {
    // Host-only cookie — set and read only on this instance's own subdomain
    // (d<n>.piazzahq.com), never the bare domain, so no Domain= attribute.
    if (scan && !token && !/(?:^|;\s*)demo_scan=1/.test(cookies)) {
      res.set('Set-Cookie', `demo_scan=1; Path=/; Secure; SameSite=Lax; Max-Age=1800`);
    }
    next();
  };
  // Only a positive result is cached — a "not ok" is cheap to re-check and
  // caching it would keep bouncing a visitor for 10s if the broker blipped.
  const cached = _demoLeaseCache.get(key);
  if (cached && Date.now() - cached.at < 10_000) return grant();
  try {
    const qs = token
      ? `token=${encodeURIComponent(token)}&n=${DEMO_INSTANCE}`
      : `scan=1&n=${DEMO_INSTANCE}`;
    const r = await fetch(`${DEMO_BROKER_URL}/demo/lease-ok?${qs}`, {
      headers: { cookie: cookies }, redirect: 'manual',
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return bounce();
    _demoLeaseCache.set(key, { at: Date.now() });
    if (_demoLeaseCache.size > 200) _demoLeaseCache.clear();
    return grant();
  } catch (e) {
    console.log('demo lease gate: broker unreachable, failing open —', e.message);
    return grant();
  }
}
app.get('/', demoLeaseGate, (req, res) => sendCorePage(req, res, path.join(__dirname, 'public', 'display.html')));
app.get('/app', demoLeaseGate, (req, res) => sendCorePage(req, res, path.join(__dirname, 'public', 'app.html')));
app.get(['/kids', '/chores'], demoLeaseGate, (req, res) => sendCorePage(req, res, path.join(__dirname, 'public', 'kids.html')));
app.get('/hub', demoLeaseGate, (req, res) => sendCorePage(req, res, path.join(__dirname, 'public', 'hub.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
// A thin wrapper around app.listen. `httpServer` is captured at module scope
// so supervisedWindowsRestart() (Windows only) can stop the listener before
// spawning a replacement.
//
// On Linux/Pi this is exactly the old bare `app.listen(PORT, '0.0.0.0', cb)`:
// no 'error' listener is attached, so a listen failure stays an uncaught
// exception and systemd's restart is the only recovery, unchanged from
// before this wrapper existed.
//
// On Windows only, an 'error' listener rides out a transient EADDRINUSE —
// which is the norm right after a self-update, when the outgoing process is
// still releasing the port and there's no systemd to restart into.
// Boots (or reboots, e.g. right after a relevant settings change) the MQTT
// bridge — a thin call-through to mqtt-bridge.js with the small context it
// needs injected, so that module itself never touches `db` or the
// device-control functions directly (see its own header comment for why).
// No-ops entirely on a mirror: the host already owns every screen's TV
// control and layout-apply logic (runTvAction proxies to the right Pi
// itself, same as always), so a mirror opening its own second, competing
// connection to the same broker would just be redundant, not additive.
function startMqttBridgeIfConfigured() {
  if (!mqttBridge || isSlave()) return;
  mqttBridge.start({
    db, getSetting,
    runTvAction, applySavedLayoutToDisplay,
    deviceId: DEVICE_ID,
    appVersion: APP_VERSION,
    log: (msg) => console.log(msg),
  });
}

function startServer(attempt = 0) {
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    try { attachCameraWsProxy(httpServer); } catch (e) { console.error('camera ws proxy:', e.message); }
    // Bring the camera media service up if a layout already uses a camera
    // widget (a reboot, or a fresh slave that just synced one in). Deferred a
    // beat so it never delays the "running at" line / first requests.
    setTimeout(() => { try { reloadCameraService(); } catch {} }, 2500);
    // Flight Map: start the ADS-B poll loop and pre-fetch the basemap if the
    // widget is enabled / in use. Deferred for the same reason as the camera.
    setTimeout(() => {
      try { startFlightPolling(); } catch (e) { console.error('[flightmap] start:', e.message); }
      try { if (flightmapWanted()) { ensureBasemap().catch(() => {}); ensureStatesBasemap().catch(() => {}); } } catch {}
    }, 3000);
    // MQTT (Home Assistant control): deferred the same beat as the other
    // optional subsystems above, so a broker connection attempt never
    // delays the "running at" line / first requests either.
    setTimeout(() => { try { startMqttBridgeIfConfigured(); } catch (e) { console.error('[mqtt-bridge] start:', e.message); } }, 3500);
    console.log(`Piazza HQ running at http://localhost:${PORT}`);
    console.log(`  Display : http://localhost:${PORT}/`);
    console.log(`  Control : http://localhost:${PORT}/app`);
    console.log(`  Version : ${APP_VERSION}`);
    // We booted successfully. If an update was pending, it's now confirmed good —
    // clear the marker after a short grace period (long enough to be sure we
    // stay up). The rolling backup taken before this update is deliberately
    // NOT deleted here anymore — it's retained history now (pruned down to
    // ROLLING_BACKUP_LIMIT on the next update, not discarded the moment this
    // one is confirmed healthy).
    if (fs.existsSync(PENDING_FLAG)) {
      setTimeout(() => {
        try {
          fs.unlinkSync(PENDING_FLAG);
          console.log('Update confirmed healthy.');
        } catch (e) { console.error('Post-update cleanup error:', e.message); }
        // Host-first auto-push: now that WE are confirmed healthy on the new version,
        // push the same code to each online slave so the whole fleet ends up matching.
        // (If a slave happens to be offline right now, the Displays tab's manual
        // "Push Update" button covers catching it up later.)
        pushUpdateToSlaves().catch(e => console.error('Auto-push error:', e.message));
      }, 8000);
    }
  });
  if (IS_WIN) {
    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempt < 30) {
        if (attempt === 0) console.log(`Port ${PORT} is busy — waiting for it to free up…`);
        setTimeout(() => startServer(attempt + 1), 500);
      } else {
        console.error(`Could not start Piazza HQ on port ${PORT}: ${err.message}`);
        process.exit(1);
      }
    });
  }
}
startServer();

// Best-effort: don't leave the go2rtc child orphaned when we exit. On
// Linux/systemd the service cgroup already sweeps it up; this covers a plain
// `node server.js`, Windows, and Ctrl-C.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { try { stopCameraService('shutdown'); } catch {} try { raStop('shutdown'); } catch {} process.exit(0); });
}
process.on('exit', () => { if (getGo2rtcProc()) { try { getGo2rtcProc().kill(); } catch {} } if (RA.child) { try { RA.child.kill(); } catch {} } });

// Builds a fresh update zip from the code CURRENTLY RUNNING on this device — used
// both for the automatic "push to slaves right after a healthy host update" flow
// and for a manually-triggered push. Packaging on demand (rather than relying on
// some previously-stashed upload) means a push always sends exactly what this host
// is running right now, regardless of how the host itself got updated (direct zip
// upload, pulled from the central server, etc. — previously only the direct-upload
// path stashed a copy, so a push after a central-server pull silently never fired).
// ── Full Backup ────────────────────────────────────────────────────────────
// A downloadable snapshot of EVERYTHING on THIS device — the raw database file
// (every event, layout, chore, allowance history, setting, PIN, etc.) plus
// every uploaded photo. Deliberately NOT the same thing as the sync export
// used for slave devices, which excludes local-only settings on purpose and
// was never meant to be a full backup — this is the actual calendar.db file
// itself, so nothing is missed. To restore: stop the service, replace
// calendar.db and the public/uploads folder with the ones from the backup,
// then start the service again.
function buildBackupZip() {
  assertZipToolAvailable();

  // Flush any pending WAL-mode writes into the main database file first — a
  // plain copy of calendar.db while WAL mode is active could otherwise miss
  // very recent changes still sitting in the separate -wal file.
  db.pragma('wal_checkpoint(TRUNCATE)');

  const dateStr = new Date().toISOString().slice(0, 10);
  const stageRoot = path.join(UPDATE_TMP, 'backup-stage');
  const folderName = `piazzahq-backup-${dateStr}`;
  const stageDir = path.join(stageRoot, folderName);
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  fs.copyFileSync(DB_PATH, path.join(stageDir, 'calendar.db'));
  if (fs.existsSync(UPLOAD_DIR)) {
    fs.cpSync(UPLOAD_DIR, path.join(stageDir, 'uploads'), { recursive: true });
  }
  fs.writeFileSync(path.join(stageDir, 'backup-info.json'), JSON.stringify({
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    deviceRole: isSlave() ? 'slave' : 'host',
    note: 'To restore: stop the piazzahq service, replace calendar.db and the public/uploads folder with the ones in this backup, then start the service again.',
  }, null, 2));

  const zipName = `${folderName}.zip`;
  const zipPath = path.join(stageRoot, zipName);
  try { fs.unlinkSync(zipPath); } catch {}
  makeZip(zipName, stageRoot, folderName);
  return { zipPath, zipName };
}

app.get('/api/backup/download', (req, res) => {
  try {
    const { zipPath, zipName } = buildBackupZip();
    res.download(zipPath, zipName, (err) => {
      if (err) console.error('Backup download error:', err.message);
      // Clean up the staging area after the download completes (or fails) —
      // best-effort, not worth failing the request over. That intent wasn't
      // actually enforced: this runs inside res.download()'s async callback,
      // outside this route's own try/catch above, so an exception here was
      // an UNCAUGHT exception that crashed the whole process rather than a
      // handled 500. Confirmed live, not hypothetical: fs.rmSync's own
      // ENOTEMPTY on Windows (antivirus/file-handle timing can make a
      // just-emptied directory briefly non-removable, a known Windows rmSync
      // quirk) took down an entire running instance just from downloading a
      // backup. Wrapped so a cleanup failure actually stays best-effort.
      try {
        fs.rmSync(path.join(UPDATE_TMP, 'backup-stage'), { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error('Backup staging cleanup failed (non-fatal, stray folder may remain):', cleanupErr.message);
      }
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Restores a backup zip previously produced by /api/backup/download — this is
// the "critical feature" that was missing: without it, the only way to get a
// backup's data back into a running install was to SSH in and manually stop
// the service, replace calendar.db and public/uploads by hand, and restart.
// Follows the same validate → safety-back-up → swap → restart pattern
// installFromZip() already uses for code updates, just applied to data.
app.post('/api/backup/restore', backupRestoreUpload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No backup .zip uploaded.' });
  const zipPath = req.file.path;
  const extractDir = path.join(UPDATE_TMP, 'restore-extracted');
  const cleanup = () => { try { fs.rmSync(UPDATE_TMP, { recursive: true, force: true }); } catch {} };
  const fail = (msg) => { cleanup(); return res.status(400).json({ error: msg }); };

  try {
    // 1. Unpack to a staging folder.
    fs.rmSync(extractDir, { recursive: true, force: true });
    try {
      extractZip(zipPath, extractDir);
    } catch (e) {
      return fail('Could not unzip the backup. The file may be incomplete or corrupt.');
    }

    // 2. Locate calendar.db inside the zip — our own backups wrap it in a
    //    "piazzahq-backup-YYYY-MM-DD/" folder, but tolerate a flat zip too
    //    (e.g. someone re-zipped just calendar.db + uploads themselves).
    let src = extractDir;
    const topEntries = fs.readdirSync(extractDir);
    const nestedFolder = topEntries.find(e => {
      const full = path.join(extractDir, e);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'calendar.db'));
    });
    if (nestedFolder) src = path.join(extractDir, nestedFolder);
    const newDbPath = path.join(src, 'calendar.db');
    if (!fs.existsSync(newDbPath)) {
      return fail('That zip does not look like a Piazza HQ backup — no calendar.db found inside it.');
    }

    // 3. Sanity-check it's actually a SQLite file before trusting it. Cheap
    //    (16-byte header read), catches an obviously wrong/corrupt file
    //    before it ever touches the live database.
    const header = Buffer.alloc(16);
    const fd = fs.openSync(newDbPath, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
      return fail("That file doesn't look like a valid Piazza HQ database — restore cancelled to protect your current data.");
    }

    // 4. Safety copy of what's currently live, BEFORE touching anything —
    //    same reasoning as the rolling code-backup pool for updates. Kept (not
    //    cleaned up) so a bad restore can be undone by hand over SSH if
    //    something is genuinely wrong with the uploaded backup.
    fs.rmSync(RESTORE_SAFETY_BACKUP, { recursive: true, force: true });
    fs.mkdirSync(RESTORE_SAFETY_BACKUP, { recursive: true });
    db.pragma('wal_checkpoint(TRUNCATE)'); // flush WAL before copying, same as buildBackupZip()
    fs.copyFileSync(DB_PATH, path.join(RESTORE_SAFETY_BACKUP, 'calendar.db'));
    const liveUploads = UPLOAD_DIR;
    if (fs.existsSync(liveUploads)) fs.cpSync(liveUploads, path.join(RESTORE_SAFETY_BACKUP, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(RESTORE_SAFETY_BACKUP, 'restored-over-at.txt'),
      `This is what was live immediately before a Restore Backup was applied, at ${new Date().toISOString()}.\n` +
      `To undo: stop the service, copy calendar.db (and uploads/, if present) from this folder back into the app folder, then start the service again.\n`);

    // 5. Swap in the restored data. The still-running process keeps working
    //    off its already-open handle to the OLD calendar.db — overwriting
    //    the file on disk here doesn't affect what THIS process has open, the
    //    same principle installFromZip() already relies on for code files.
    //    The fresh process after the restart below is what actually opens
    //    the new file.
    fs.copyFileSync(newDbPath, DB_PATH);
    const backupUploads = path.join(src, 'uploads');
    if (fs.existsSync(backupUploads)) {
      fs.rmSync(liveUploads, { recursive: true, force: true });
      fs.cpSync(backupUploads, liveUploads, { recursive: true });
    }

    cleanup();
    res.json({
      ok: true,
      message: 'Backup restored. Restarting now — the app will reconnect in a few seconds with your restored data.',
    });
    setTimeout(() => {
      restartPlain('Backup restored; restarting to load it');
    }, 700);
  } catch (e) {
    return fail('Restore failed: ' + e.message);
  }
});

function buildSelfUpdateZip() {
  // `zip` on a Pi is a dependency added when push-to-slaves shipped; an
  // install that updated in-app (rather than re-running install.sh) may not
  // have it. On Windows the tool is bsdtar. assertZipToolAvailable() gives a
  // clear, actionable message either way instead of a cryptic ENOENT.
  assertZipToolAvailable();

  const stageRoot = path.join(UPDATE_TMP, 'self-push-stage');
  const stageDir = path.join(stageRoot, 'piazzahq');
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  // Same file list installFromZip() expects/backs up — now sharing the
  // actual constant (UPDATE_CODE_ITEMS) instead of a separately maintained
  // copy, so "keep these in sync" is structurally guaranteed rather than
  // just a comment someone has to remember.
  for (const name of UPDATE_CODE_ITEMS) {
    const from = path.join(__dirname, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(stageDir, name), { recursive: true });
  }
  // Uploads are per-device user content (photos, chore icons) — never push these;
  // the receiving slave's installFromZip() preserves its own uploads regardless, so
  // including them here would only waste bandwidth and time.
  fs.rmSync(path.join(stageDir, 'public', 'uploads'), { recursive: true, force: true });
  const zipPath = path.join(UPDATE_TMP, 'self-push.zip');
  try { fs.unlinkSync(zipPath); } catch {}
  makeZip(zipPath, stageRoot, 'piazzahq');
  fs.rmSync(stageRoot, { recursive: true, force: true });
  return zipPath;
}

// After a healthy host update, push the freshly-packaged running code to every
// online remote slave. Each slave runs its OWN validate→backup→swap→restart with
// auto-rollback, so a bad push can't brick a slave. Best-effort and sequential to
// avoid a thundering herd.
async function pushUpdateToSlaves(targetDeviceIds = null) {
  if (isSlave()) return { ok: false, error: 'This device is a slave, not a host.' };
  const now = Date.now();
  let slaves = db.prepare(`SELECT * FROM screens WHERE is_remote = 1`).all()
    .filter(s => (now - (s.last_seen || 0)) < SCREEN_ONLINE_MS && s.remote_addr);
  if (targetDeviceIds) slaves = slaves.filter(s => targetDeviceIds.includes(s.device_id));
  if (!slaves.length) return { ok: true, results: [], note: 'No online slave screens to push to.' };

  let zipPath;
  try { zipPath = buildSelfUpdateZip(); }
  catch (e) { return { ok: false, error: 'Could not package the update: ' + e.message }; }
  const zipBuf = fs.readFileSync(zipPath);

  const results = [];
  for (const s of slaves) {
    const addr = s.remote_addr.includes(':') ? s.remote_addr : `${s.remote_addr}:${PORT}`;
    try {
      await postZip(`http://${addr}/api/update`, zipBuf);
      console.log(`Push: sent update to ${s.name || s.device_id} (${addr}).`);
      results.push({ deviceId: s.device_id, name: s.name || s.device_id, ok: true });
    } catch (e) {
      console.error(`Push: failed for ${s.name || s.device_id} (${addr}): ${e.message}`);
      results.push({ deviceId: s.device_id, name: s.name || s.device_id, ok: false, error: e.message });
    }
  }
  try { fs.unlinkSync(zipPath); } catch {}
  return { ok: true, version: APP_VERSION, results };
}

// USER-FACING: manually (re)push the currently-running version to some or all
// online remote slaves. Independent of the host's own update flow — useful when a
// slave was offline during the last auto-push, or a previous push silently failed,
// or you just want to force the whole fleet back in sync right now.
app.post('/api/push-to-slaves', async (req, res) => {
  if (isSlave()) return res.status(409).json({ error: 'This device is a slave, not a host — only a host can push updates.' });
  const targetIds = Array.isArray(req.body && req.body.deviceIds) && req.body.deviceIds.length ? req.body.deviceIds : null;
  const result = await pushUpdateToSlaves(targetIds);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});

// Minimal multipart POST of a zip buffer to a slave's /api/update (field "package").
// Small POST-JSON-get-JSON helper, used to proxy a TV command to whichever
// slave's own server actually owns the target screen.
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(e); }
    const data = Buffer.from(JSON.stringify(body || {}));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      timeout: 30000,
    }, (resp) => {
      const chunks = []; resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {}
        if (resp.statusCode && resp.statusCode < 400) resolve(parsed);
        else reject(new Error(parsed.error || `HTTP ${resp.statusCode}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out.')); });
    req.write(data); req.end();
  });
}

// Runs a TV control action for a given screen — LOCALLY if this server is the
// one that screen belongs to, otherwise proxied to that screen's own server
// directly (same reasoning as pushUpdateToSlaves: TV control has to physically
// run on the Pi actually connected to that TV — CEC needs the real HDMI cable,
// Roku/Samsung need to be on the same LAN as the TV — a different Pi entirely
// can't do it on another device's behalf). action: 'power-on' | 'power-off' |
// 'input' | 'pair'. extra: e.g. { input: 'HDMI1' }.
async function runTvAction(deviceId, action, extra = {}) {
  const screen = db.prepare(`SELECT * FROM screens WHERE device_id = ?`).get(deviceId);
  if (!screen) throw new Error('Screen not found.');

  if (deviceId !== DEVICE_ID && screen.is_remote) {
    if (!screen.remote_addr) throw new Error('This screen is offline or unreachable.');
    const addr = screen.remote_addr.includes(':') ? screen.remote_addr : `${screen.remote_addr}:${PORT}`;
    return postJson(`http://${addr}/api/screens/${encodeURIComponent(deviceId)}/tv/${action}`, extra);
  }

  const driver = tvDrivers.DRIVERS[screen.tv_control_type];
  if (!driver) throw new Error(`No TV control configured for this screen (or "${screen.tv_control_type}" isn't recognized).`);
  if (action === 'power-on') return driver.powerOn(screen);
  if (action === 'power-off') return driver.powerOff(screen);
  if (action === 'input') return driver.setInput(screen, extra.input);
  if (action === 'pair') {
    if (!driver.pair) throw new Error(`${screen.tv_control_type} doesn't need pairing.`);
    const result = await driver.pair(screen);
    if (result && result.token) {
      db.prepare(`UPDATE screens SET tv_samsung_token = ? WHERE device_id = ?`).run(result.token, deviceId);
    }
    return result;
  }
  throw new Error('Unknown TV action.');
}

app.post('/api/screens/:deviceId/tv/:action', async (req, res) => {
  try {
    const result = await runTvAction(req.params.deviceId, req.params.action, req.body || {});
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// TV schedule slots — any number of on/off times per screen, replacing the old
// fixed single-on/single-off fields (which had no way to add a second slot, or
// to genuinely clear one once set — this fixes both).
const isHHMM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
app.get('/api/screens/:deviceId/tv-schedule', (req, res) => {
  const slots = db.prepare(`SELECT id, time, action FROM tv_schedule_slots WHERE device_id = ? ORDER BY time`).all(req.params.deviceId);
  res.json(slots);
});
app.post('/api/screens/:deviceId/tv-schedule', (req, res) => {
  const { time, action } = req.body || {};
  if (!isHHMM(time)) return res.status(400).json({ error: 'Time must be in HH:MM format.' });
  if (action !== 'on' && action !== 'off') return res.status(400).json({ error: 'Action must be "on" or "off".' });
  const screen = db.prepare(`SELECT device_id FROM screens WHERE device_id = ?`).get(req.params.deviceId);
  if (!screen) return res.status(404).json({ error: 'Screen not found.' });
  const info = db.prepare(`INSERT INTO tv_schedule_slots (device_id, time, action) VALUES (?, ?, ?)`)
    .run(req.params.deviceId, time, action);
  res.json({ id: info.lastInsertRowid, time, action });
});
app.put('/api/tv-schedule/:id', (req, res) => {
  const slot = db.prepare(`SELECT * FROM tv_schedule_slots WHERE id = ?`).get(req.params.id);
  if (!slot) return res.status(404).json({ error: 'Time slot not found.' });
  const { time, action } = req.body || {};
  if (time !== undefined) {
    if (!isHHMM(time)) return res.status(400).json({ error: 'Time must be in HH:MM format.' });
    db.prepare(`UPDATE tv_schedule_slots SET time = ?, last_fired = '' WHERE id = ?`).run(time, req.params.id);
  }
  if (action !== undefined) {
    if (action !== 'on' && action !== 'off') return res.status(400).json({ error: 'Action must be "on" or "off".' });
    db.prepare(`UPDATE tv_schedule_slots SET action = ?, last_fired = '' WHERE id = ?`).run(action, req.params.id);
  }
  res.json({ ok: true });
});
app.delete('/api/tv-schedule/:id', (req, res) => {
  // Report what actually happened rather than a blind {ok:true} — this is
  // exactly how the slaveWriteGuard misrouting bug above went unnoticed: a
  // delete that matched nothing (wrong device, already gone, or silently
  // proxied to the wrong host) still claimed success with no way to tell.
  const info = db.prepare(`DELETE FROM tv_schedule_slots WHERE id = ?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Time slot not found.' });
  res.json({ ok: true });
});

// Daily on/off schedule — only the host runs this (same reasoning as the daily
// briefing: a slave running it too would race the host and could double-fire).
// runTvAction's own routing correctly reaches whichever Pi/TV each screen
// actually needs, whether that's this host itself or a remote slave.
function checkTvSchedules() {
  if (isSlave()) return;
  if (!tvDrivers.DRIVERS || !Object.keys(tvDrivers.DRIVERS).length) return; // module failed to load
  const nowHHMM = localHHMM();
  const today = localDateStr();
  const dueSlots = db.prepare(
    `SELECT s.* FROM tv_schedule_slots s
     JOIN screens sc ON sc.device_id = s.device_id
     WHERE sc.tv_control_type != '' AND s.time = ? AND s.last_fired != ?`
  ).all(nowHHMM, today);
  for (const slot of dueSlots) {
    db.prepare(`UPDATE tv_schedule_slots SET last_fired = ? WHERE id = ?`).run(today, slot.id);
    const screen = db.prepare(`SELECT name FROM screens WHERE device_id = ?`).get(slot.device_id);
    const label = (screen && screen.name) || slot.device_id;
    const action = slot.action === 'on' ? 'power-on' : 'power-off';
    runTvAction(slot.device_id, action)
      .then(() => console.log(`TV schedule: ${slot.action === 'on' ? 'powered on' : 'powered off'} "${label}" (${slot.time})`))
      .catch(e => console.error(`TV schedule: ${action} failed for "${label}" (${slot.time}): ${e.message}`));
  }
}

function postZip(url, buf) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(e); }
    const boundary = '----pical' + crypto.randomBytes(8).toString('hex');
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="package"; filename="update.zip"\r\n` +
      `Content-Type: application/zip\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, buf, tail]);
    const lib = u.protocol === 'https:' ? https : http;
    // Real bug fixed here: this never sent any authentication at all — on a
    // slave with a PIN set, its /api/update route (deliberately the most
    // locked-down endpoint in the app, since it installs code) would reject
    // this outright, meaning host→slave push updates simply never worked
    // once PINs entered the picture. Since a slave's own PIN IS the
    // household's shared PIN (not a separate value — see requireAuth()'s
    // own comment on this), the host can just send its OWN PIN here; it's
    // guaranteed to be the same credential the slave itself expects.
    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    };
    const hostPin = getSetting('app_pin');
    headers['x-host-pin'] = hostPin || ''; // always sent, even empty — see requireAuth()'s grace-period comment for why an omitted header can't safely mean the same thing as a deliberately empty one
    headers['x-mirror-license'] = getSetting('update_license_key') || '';   // lets the host recognise this mirror without a browser login
    const req = lib.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers,
    }, (resp) => {
      const chunks = []; resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        if (resp.statusCode && resp.statusCode < 400) resolve(true);
        else reject(new Error('HTTP ' + resp.statusCode));
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.write(body); req.end();
  });
}
