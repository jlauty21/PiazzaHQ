const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { URL } = require('url');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
// TV control drivers (CEC/Roku/Samsung). Wrapped defensively — a device that
// hasn't updated node_modules yet (e.g. mid-rollout, before the npm-install fix
// applies) shouldn't crash the whole server over a feature nobody's using yet.
let tvDrivers = { DRIVERS: {} };
try { tvDrivers = require('./tv-control'); }
catch (e) { console.error('TV control module failed to load (TV control will be unavailable): ' + e.message); }
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

  -- Shopping list: a single running list (unlike to-do lists above, which can be
  -- many) — matches how most families actually keep one shared grocery list.
  -- "Buy" links (see /api/shopping-list) are built client-side, no backend
  -- involvement — just a store-search URL with the item text as the query.
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
// CalDAV push bookkeeping — see the "CalDAV (push local events out to iCloud)"
// section. caldav_url is the deterministic remote object URL an edit re-PUTs to
// and a delete DELETEs; caldav_push_error being non-null flags a row for the
// retry sweep.
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
  display_refresh_min: '0',       // full page auto-reload interval in minutes (0 = off). Like pressing F5.
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
const CENTRAL_SERVER_URL  = 'https://piazzahq.com';
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
function fetchSupportLinks() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (_supportLinksCache.data && (now - _supportLinksCache.at) < SUPPORT_LINKS_TTL_MS) {
      return resolve(_supportLinksCache.data);
    }
    const serverUrl = resolveUpdateServerUrl();
    if (!serverUrl) return resolve(_supportLinksCache.data || { stripeUrl: '', paypalUrl: '' });
    const mod = serverUrl.startsWith('https:') ? https : http;
    const req = mod.get(serverUrl + '/api/v1/support-links', { timeout: 8000 }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          _supportLinksCache = { data: parsed, at: now };
          resolve(parsed);
        } catch (e) {
          resolve(_supportLinksCache.data || { stripeUrl: '', paypalUrl: '' });
        }
      });
    });
    req.on('error', () => resolve(_supportLinksCache.data || { stripeUrl: '', paypalUrl: '' }));
    req.on('timeout', () => { req.destroy(); resolve(_supportLinksCache.data || { stripeUrl: '', paypalUrl: '' }); });
  });
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
const UPDATE_CODE_ITEMS = ['server.js', 'templates.js', 'tv-control.js', 'public', 'package.json', 'scripts',
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
// Serve uploaded files explicitly from UPLOAD_DIR. When DATA_DIR is unset
// this is the same directory the blanket public/ mount below already covers
// (harmless overlap); when it's set, this is the only thing serving
// "/uploads/...", since those files no longer live under public/.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
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

  // Heartbeat keeps the connection alive through proxies/timeouts (e.g. Cloudflare
  // Tunnel, Tailscale). Each tick also refreshes the screen's last_seen: as long as
  // the connection is alive, the write succeeds and the screen stays "online". This
  // fixes screens showing offline despite a working connection — previously
  // last_seen was only set once at connect time and then went stale.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
      if (screenId) {
        db.prepare(`UPDATE screens SET last_seen = ? WHERE device_id = ?`).run(Date.now(), screenId);
      }
    } catch { clearInterval(heartbeat); }
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
const SHARED_TOPICS = new Set(['events', 'photos', 'settings', 'photo-settings', 'feeds', 'displays', 'layout', 'screens', 'chores', 'todos', 'favorites', 'reminders', 'profiles', 'messages', 'cameras', 'meals', 'flight_watch']);

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

// Middleware: protect /app and /api/* (but NOT / display or /api/events GET for display polling)
function requireAuth(req, res, next) {
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
  res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
}

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const pin = getPin();
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
  res.json({ pin_set: !!pin, authenticated: !pin || validToken(token) });
});

// Apply auth to all /api routes except auth itself
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  requireAuth(req, res, next);
});

// ── Events API ───────────────────────────────────────────────────────────────

// GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD
// ── Chore chart API ───────────────────────────────────────────────────────────
// A chore DEFINITION recurs; we expand it into per-kid, per-date instances on demand.
// Scheduling is intentionally simpler than full ICS: daily, weekly-by-weekday, or a
// one-time date.
function choreAppliesOn(chore, dateStr) {
  if (!chore.active) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (chore.freq === 'once') return (chore.on_date || '') === dateStr;
  if (chore.freq === 'daily') return true;
  if (chore.freq === 'weekly') {
    const codes = (chore.byday || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!codes.length) return true; // no specific days = every day
    const WD = ['SU','MO','TU','WE','TH','FR','SA'];
    return codes.includes(WD[d.getDay()]);
  }
  return false;
}
// Which kids a chore is for, on a given date. assignee is one of:
//   'all'              -> every kid
//   '3'                -> a single kid id (legacy/simple case)
//   '3,5,7'            -> a specific subset of kids (comma-separated ids)
function choreKidIds(chore) {
  if (chore.assignee === 'all') {
    return db.prepare(`SELECT id FROM kids ORDER BY sort_order, id`).all().map(r => r.id);
  }
  const ids = String(chore.assignee || '')
    .split(',').map(s => parseInt(s.trim())).filter(Number.isFinite);
  return ids;
}
// Ensures instance rows exist for a given date across all active chores, so the
// kid/parent/wall views all read consistent state. Also pulls forward unfinished
// carryover chores from previous days (marked overdue).
function materializeChoreInstances(dateStr) {
  const chores = db.prepare(`SELECT * FROM chores WHERE active = 1 AND bonus = 0`).all();
  const ins = db.prepare(`INSERT OR IGNORE INTO chore_instances (chore_id, kid_id, date, pay_amount) VALUES (?, ?, ?, ?)`);
  const tx = db.transaction(() => {
    for (const c of chores) {
      if (!choreAppliesOn(c, dateStr)) continue;
      for (const kidId of choreKidIds(c)) ins.run(c.id, kidId, dateStr, c.pay_amount || 0);
    }
  });
  tx();
}
// Returns a kid's chores for a date: today's applicable ones plus any carryover
// (unfinished, carryover=1, from an earlier date).
function getKidChores(kidId, dateStr) {
  materializeChoreInstances(dateStr);
  const rows = db.prepare(`
    SELECT ci.id as instance_id, ci.date, ci.done, ci.completed_at, ci.pay_amount, ci.proof_photo,
           c.id as chore_id, c.title, c.icon, c.celebrate, c.carryover, c.at_time, c.notes, c.photo_required
    FROM chore_instances ci
    JOIN chores c ON c.id = ci.chore_id
    WHERE ci.kid_id = ?
      AND ( ci.date = ?
            OR (ci.done = 0 AND c.carryover = 1 AND ci.date < ?) )
    ORDER BY (ci.date < ?) DESC, c.at_time = '' ASC, c.at_time ASC, c.sort_order, c.id
  `).all(kidId, dateStr, dateStr, dateStr);
  return rows.map(r => ({ ...r, overdue: r.date < dateStr && !r.done }));
}
// Current streak = consecutive days (walking backward from today) where every chore
// instance dated that day was completed. A day with zero instances (no chore applied,
// or the app simply wasn't running that day to materialize them) is skipped rather
// than breaking the streak — we only ever break on a day that demonstrably had
// chores left undone. Stops at the kid's created_at date so a new kid never inherits
// a phantom streak from before they existed.
function getKidStreak(kidId, todayStr = localDateStr()) {
  const kid = db.prepare(`SELECT created_at FROM kids WHERE id = ?`).get(kidId);
  if (!kid) return 0;
  const earliest = (kid.created_at || '').slice(0, 10) || todayStr;
  const [y, m, d] = todayStr.split('-').map(Number);
  let cursor = new Date(y, m - 1, d);
  let streak = 0, isFirstDay = true;
  for (let i = 0; i < 3650; i++) {
    const ds = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    if (ds < earliest) break;
    const rows = db.prepare(`SELECT done FROM chore_instances WHERE kid_id = ? AND date = ?`).all(kidId, ds);
    if (rows.length) {
      const allDone = rows.every(r => r.done);
      if (allDone) streak++;
      else if (!isFirstDay) break; // today being incomplete doesn't break the streak yet
    }
    isFirstDay = false;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
// Sticker balance = every sticker ever earned minus every star ever spent on a
// reward redemption. Same append-only-ledger math as allowance's SUM(amount) —
// no mutable running-total column anywhere, so it's always derivable and a
// redemption undo (see DELETE /api/sticker-redemptions/:id) is exact.
function getKidStickerBalance(kidId) {
  const earned = db.prepare(`SELECT COUNT(*) c FROM stickers WHERE kid_id = ?`).get(kidId).c;
  const spent = db.prepare(`SELECT COALESCE(SUM(star_cost),0) c FROM sticker_redemptions WHERE kid_id = ?`).get(kidId).c;
  return earned - spent;
}
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

// Kids CRUD
app.get('/api/kids', (req, res) => {
  res.json(db.prepare(`SELECT * FROM kids ORDER BY sort_order, id`).all());
});
app.post('/api/kids', (req, res) => {
  const { name, color, avatar, display_mode, allowance_enabled, allowance_mode, weekly_rate, savings_goal_name, savings_goal_amount, sticker_style, sticker_emoji } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const max = db.prepare(`SELECT MAX(sort_order) m FROM kids`).get().m || 0;
  const r = db.prepare(`INSERT INTO kids
    (name, color, avatar, display_mode, sort_order, allowance_enabled, allowance_mode, weekly_rate, savings_goal_name, savings_goal_amount, sticker_style, sticker_emoji)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      name.trim(), color || '#4A90D9', avatar || '🙂', display_mode || 'both', max + 1,
      allowance_enabled ? 1 : 0, allowance_mode || 'per_chore', Number(weekly_rate) || 0,
      (savings_goal_name || '').trim(), Number(savings_goal_amount) || 0,
      sticker_style || 'star', (sticker_emoji || '').trim());
  broadcastUpdate('chores');
  res.status(201).json(db.prepare(`SELECT * FROM kids WHERE id = ?`).get(r.lastInsertRowid));
});
app.put('/api/kids/:id', (req, res) => {
  const { name, color, avatar, display_mode, allowance_enabled, allowance_mode, weekly_rate, savings_goal_name, savings_goal_amount, sticker_style, sticker_emoji } = req.body;
  const k = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE kids SET name=?, color=?, avatar=?, display_mode=?,
              allowance_enabled=?, allowance_mode=?, weekly_rate=?,
              savings_goal_name=?, savings_goal_amount=?, sticker_style=?, sticker_emoji=? WHERE id=?`)
    .run(name ?? k.name, color ?? k.color, avatar ?? k.avatar, display_mode ?? k.display_mode,
         (allowance_enabled ?? k.allowance_enabled) ? 1 : 0,
         allowance_mode ?? k.allowance_mode,
         (weekly_rate !== undefined ? Number(weekly_rate) || 0 : k.weekly_rate),
         (savings_goal_name !== undefined ? (savings_goal_name || '').trim() : k.savings_goal_name),
         (savings_goal_amount !== undefined ? Number(savings_goal_amount) || 0 : k.savings_goal_amount),
         sticker_style ?? k.sticker_style,
         (sticker_emoji !== undefined ? (sticker_emoji || '').trim() : k.sticker_emoji),
         k.id);
  broadcastUpdate('chores');
  res.json(db.prepare(`SELECT * FROM kids WHERE id = ?`).get(k.id));
});
app.delete('/api/kids/:id', (req, res) => {
  db.prepare(`DELETE FROM kids WHERE id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM chore_instances WHERE kid_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM allowance_ledger WHERE kid_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM stickers WHERE kid_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM sticker_redemptions WHERE kid_id = ?`).run(req.params.id);
  broadcastUpdate('chores');
  res.json({ ok: true });
});

// ── Built-in To-Do Lists (fully local, no external account needed) ───────────
// Deliberately separate from the Todoist-backed Tasks widget — see the schema
// comment above todo_lists for why.
app.get('/api/todo-lists', (req, res) => {
  const lists = db.prepare(`
    SELECT tl.*,
      (SELECT COUNT(*) FROM todo_items ti WHERE ti.list_id = tl.id AND ti.done = 0) as itemCount
    FROM todo_lists tl ORDER BY tl.sort_order, tl.id
  `).all();
  res.json(lists);
});
app.post('/api/todo-lists', (req, res) => {
  const name = demoCleanText((req.body.name || '').trim(), 60);
  if (!name) return res.status(400).json({ error: 'A list name is required.' });
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM todo_lists`).get();
  const info = db.prepare(`INSERT INTO todo_lists (name, sort_order) VALUES (?, ?)`)
    .run(name, (maxOrder.m || 0) + 1);
  broadcastUpdate('todos');
  res.json({ id: info.lastInsertRowid, name, sort_order: (maxOrder.m || 0) + 1 });
});
app.put('/api/todo-lists/:id', (req, res) => {
  const list = db.prepare(`SELECT id FROM todo_lists WHERE id = ?`).get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found.' });
  if (req.body.name !== undefined) {
    const name = demoCleanText(String(req.body.name).trim(), 60);
    if (!name) return res.status(400).json({ error: 'A list name is required.' });
    db.prepare(`UPDATE todo_lists SET name = ? WHERE id = ?`).run(name, req.params.id);
  }
  if (req.body.sort_order !== undefined) {
    db.prepare(`UPDATE todo_lists SET sort_order = ? WHERE id = ?`).run(Number(req.body.sort_order) || 0, req.params.id);
  }
  broadcastUpdate('todos');
  res.json({ ok: true });
});
app.delete('/api/todo-lists/:id', (req, res) => {
  db.prepare(`DELETE FROM todo_items WHERE list_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM todo_lists WHERE id = ?`).run(req.params.id);
  broadcastUpdate('todos');
  res.json({ ok: true });
});

app.get('/api/todo-lists/:id/items', (req, res) => {
  const items = db.prepare(`SELECT * FROM todo_items WHERE list_id = ? ORDER BY done, sort_order, id`).all(req.params.id);
  res.json(items);
});
app.post('/api/todo-lists/:id/items', (req, res) => {
  const text = demoCleanText((req.body.text || '').trim(), 120);
  if (!text) return res.status(400).json({ error: 'Item text is required.' });
  const list = db.prepare(`SELECT id FROM todo_lists WHERE id = ?`).get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found.' });
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM todo_items WHERE list_id = ?`).get(req.params.id);
  const info = db.prepare(`INSERT INTO todo_items (list_id, text, sort_order) VALUES (?, ?, ?)`)
    .run(req.params.id, text, (maxOrder.m || 0) + 1);
  broadcastUpdate('todos');
  res.json({ id: info.lastInsertRowid, list_id: Number(req.params.id), text, done: 0 });
});
app.put('/api/todo-items/:id', (req, res) => {
  const item = db.prepare(`SELECT * FROM todo_items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (req.body.text !== undefined) {
    const text = demoCleanText(String(req.body.text).trim(), 120);
    if (!text) return res.status(400).json({ error: 'Item text is required.' });
    db.prepare(`UPDATE todo_items SET text = ? WHERE id = ?`).run(text, req.params.id);
  }
  if (req.body.done !== undefined) {
    const done = req.body.done ? 1 : 0;
    const completedAt = done ? new Date().toISOString() : '';
    db.prepare(`UPDATE todo_items SET done = ?, completed_at = ? WHERE id = ?`).run(done, completedAt, req.params.id);
  }
  if (req.body.sort_order !== undefined) {
    db.prepare(`UPDATE todo_items SET sort_order = ? WHERE id = ?`).run(Number(req.body.sort_order) || 0, req.params.id);
  }
  broadcastUpdate('todos');
  res.json({ ok: true });
});
app.delete('/api/todo-items/:id', (req, res) => {
  db.prepare(`DELETE FROM todo_items WHERE id = ?`).run(req.params.id);
  broadcastUpdate('todos');
  res.json({ ok: true });
});

// ── Shopping list ────────────────────────────────────────────────────────────
// Deliberately a single flat list (no separate lists table like to-dos above) —
// matches how most families keep one shared running grocery list, not several.
// "Buy" links to store search pages are built entirely client-side (see hub.html
// and the wall-display widget) from the item text — no product matching, no
// scraping, no API keys, just a plain search-URL per store.
app.get('/api/shopping-list', (req, res) => {
  res.json(db.prepare(`SELECT * FROM shopping_items ORDER BY done, sort_order, id`).all());
});
app.post('/api/shopping-list', (req, res) => {
  const text = demoCleanText((req.body.text || '').trim(), 120);
  if (!text) return res.status(400).json({ error: 'Item text is required.' });
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM shopping_items`).get();
  const info = db.prepare(`INSERT INTO shopping_items (text, sort_order) VALUES (?, ?)`)
    .run(text, (maxOrder.m || 0) + 1);
  broadcastUpdate('shopping');
  res.status(201).json({ id: info.lastInsertRowid, text, done: 0 });
});
app.put('/api/shopping-items/:id', (req, res) => {
  const item = db.prepare(`SELECT * FROM shopping_items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (req.body.text !== undefined) {
    const text = demoCleanText(String(req.body.text).trim(), 120);
    if (!text) return res.status(400).json({ error: 'Item text is required.' });
    db.prepare(`UPDATE shopping_items SET text = ? WHERE id = ?`).run(text, req.params.id);
  }
  if (req.body.done !== undefined) {
    const done = req.body.done ? 1 : 0;
    const completedAt = done ? new Date().toISOString() : '';
    db.prepare(`UPDATE shopping_items SET done = ?, completed_at = ? WHERE id = ?`).run(done, completedAt, req.params.id);
  }
  broadcastUpdate('shopping');
  res.json({ ok: true });
});
app.delete('/api/shopping-items/:id', (req, res) => {
  db.prepare(`DELETE FROM shopping_items WHERE id = ?`).run(req.params.id);
  broadcastUpdate('shopping');
  res.json({ ok: true });
});
// Clears every checked-off item at once — the "I put it all away" button.
app.post('/api/shopping-list/clear-done', (req, res) => {
  const r = db.prepare(`DELETE FROM shopping_items WHERE done = 1`).run();
  broadcastUpdate('shopping');
  res.json({ ok: true, removed: r.changes });
});

// ── Voice control (Siri Shortcuts / similar) ──────────────────────────────────
// A long-lived bearer token, generated server-side (never user-typed, unlike
// ha_token which comes from HA itself — this one needs to BE strong since
// nothing else vouches for it), stored as a normal setting so it round-trips
// through the existing GET/PUT /api/settings the same as everything else.
// Generation stays behind the normal requireAuth (PIN session, or open if no
// PIN — same as the rest of Settings) since minting a new credential is a
// sensitive action; USING it (the actual add-item route below) authenticates
// itself instead, since a voice automation can't do an interactive PIN login.
app.post('/api/voice-token/generate', (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('voice_token', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(token);
  res.json({ token });
});
app.delete('/api/voice-token', (req, res) => {
  db.prepare(`DELETE FROM settings WHERE key = 'voice_token'`).run();
  res.json({ ok: true });
});

// Strips natural command phrasing off the front and back of a spoken/typed
// voice input, so "add bananas to the shopping list" and "put paper towels
// on my list" both become just the actual item — "bananas", "paper towels"
// — rather than being stored verbatim. Answering the Shortcuts prompt with
// just the item name already worked fine before this and still does (no
// leading/trailing pattern to strip means the text passes through
// untouched) — this specifically targets the more natural full-sentence
// phrasing someone would reasonably expect a voice assistant to handle,
// since neither Siri Shortcuts' free-text dictation nor Alexa's custom slot
// values do that kind of extraction on their own.
// Deliberately simple pattern-matching, not real NLU — won't catch every
// possible phrasing (rare/unusual wording can still come through
// unstripped), but covers the common "add/put X to/on (the/my) ___ list"
// shapes without needing an actual language model for something this small.
function extractItemFromSpokenPhrase(raw) {
  let text = (raw || '').trim();
  if (!text) return text;
  text = text.replace(/^(please\s+)?(can you\s+)?(add|put|throw|include|get)\s+/i, '');
  text = text.replace(/\s+please\.?$/i, '');
  // The real target list is already decided by the `list` parameter, not by
  // whatever list name was actually spoken — so this doesn't need to match
  // a specific list name, just the general "to/on (the/my/our) ___ list"
  // shape at the end of the sentence. Stripping trailing "please" BEFORE
  // this, not after, matters — "add coffee to the list please" has "please"
  // sitting after "list", which would otherwise stop the list-phrase
  // pattern from anchoring to the actual end of the string.
  text = text.replace(/\s+(to|on|for)\s+(the\s+|my\s+|our\s+)?[\w\s]*?\blist\b\.?\s*$/i, '');
  text = text.trim().replace(/[.!?]+$/, '').trim();
  return text || raw.trim(); // never return empty if stripping happened to over-match
}

// Shared by both voice surfaces (Siri Shortcuts' REST endpoint below, and the
// Alexa skill handler further down) so the actual "where does this item go"
// logic exists exactly once. Returns { ok, list, id, text } on success, or
// { error, status } on failure — callers translate that into whatever shape
// their own protocol needs (plain JSON for Shortcuts, an Alexa speech
// response for Alexa), rather than this function knowing about either.
// list defaults to the shopping list; anything else is case-insensitively
// matched against existing To-Do list names — an unrecognized name is a real
// error, not a silent fallback to the wrong list.
function addVoiceItem(text, listName) {
  text = extractItemFromSpokenPhrase(text);
  if (!text) return { error: 'No item text provided.', status: 400 };
  listName = (listName || 'shopping').trim();

  if (listName.toLowerCase() === 'shopping') {
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM shopping_items`).get();
    const info = db.prepare(`INSERT INTO shopping_items (text, sort_order) VALUES (?, ?)`)
      .run(text, (maxOrder.m || 0) + 1);
    broadcastUpdate('shopping');
    return { ok: true, list: 'shopping', id: info.lastInsertRowid, text };
  }
  const list = db.prepare(`SELECT id FROM todo_lists WHERE LOWER(name) = LOWER(?)`).get(listName);
  if (!list) return { error: `No list named "${listName}".`, status: 404 };
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM todo_items WHERE list_id = ?`).get(list.id);
  const info = db.prepare(`INSERT INTO todo_items (list_id, text, sort_order) VALUES (?, ?, ?)`)
    .run(list.id, text, (maxOrder.m || 0) + 1);
  broadcastUpdate('todos');
  return { ok: true, list: listName, id: info.lastInsertRowid, text };
}

// GET/POST /api/voice/add-item — the actual Siri Shortcuts target. Deliberately
// narrow in what it can do (add an item, nothing else — no read, no delete,
// no settings access) even though it bypasses the PIN entirely, so a leaked
// token is a "someone can add junk to your shopping list" problem, not a
// "someone has the run of the app" problem.
//
// Accepts credentials/params two ways, checked in this order:
//   1. Query string (?token=...&text=...&list=...) — the recommended path.
//      A single URL Shortcuts can build with one field and one inline
//      variable insertion, instead of separately configuring Headers and a
//      JSON Request Body in a "Show More" panel, which is where the real
//      confusion happened in practice (see HANDOFF.md — a header ending up
//      with the token in the wrong box, and an entire JSON blob crammed
//      into a single body field, both directly caused by that older,
//      more "correct" but much more error-prone setup). No request logging
//      exists on this server (checked before adding this) that would write
//      a token-bearing URL to a persistent log file.
//   2. Authorization: Bearer header + JSON body — the original method,
//      left working for anyone who already built a Shortcut that way, or
//      who'd rather not have the token sitting in a URL for other reasons.
// Whichever path supplies a token, it's checked identically via
// timingSafeEqual against the configured voice_token.
function voiceAddItemHandler(req, res) {
  const configuredToken = getSetting('voice_token');
  if (!configuredToken) return res.status(403).json({ error: 'Voice control isn\'t set up yet — generate a token in Settings first.' });

  const authHeader = req.headers['authorization'] || '';
  const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const presented = req.query.token || headerToken;
  const presentedBuf = Buffer.from(presented);
  const configuredBuf = Buffer.from(configuredToken);
  const validLength = presentedBuf.length === configuredBuf.length;
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, so length is checked first — but still compare SOMETHING of the
  // same length as configuredToken even on a length mismatch, rather than
  // short-circuiting straight to "reject," so a wrong-length guess doesn't
  // return measurably faster than a right-length one. (Real discrepancy
  // found auditing this: `validLength && timingSafeEqual(...)` short-circuits
  // via `&&` and never calls timingSafeEqual at all on a length mismatch —
  // exactly the shortcut this comment says it avoids. Negligible practical
  // impact given the token's 192 bits of entropy makes any timing channel
  // irrelevant for brute-forcing, but the code should actually do what its
  // own comment claims.)
  let isValid;
  if (validLength) {
    isValid = crypto.timingSafeEqual(presentedBuf, configuredBuf);
  } else {
    crypto.timingSafeEqual(configuredBuf, configuredBuf); // dummy same-length compare, for constant-ish time
    isValid = false;
  }
  if (!isValid) return res.status(401).json({ error: 'Invalid token' });

  const text = req.query.text || (req.body && req.body.text);
  const list = req.query.list || (req.body && req.body.list);
  const result = addVoiceItem(text, list);
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  res.status(201).json(result);
}
app.get('/api/voice/add-item', voiceAddItemHandler);
app.post('/api/voice/add-item', voiceAddItemHandler);

// ── Voice control: Alexa skill ────────────────────────────────────────────────
// Same underlying addVoiceItem() as the Siri route above, but Alexa doesn't
// send a bearer token — its own request comes with a cryptographic signature
// (an X.509 cert chain + timestamp) that ask-sdk-express-adapter verifies
// automatically, which is why this is authenticated a third, different way
// from the previous two routes. Deliberately using the official SDK for this
// rather than hand-rolling signature verification: getting that subtly wrong
// (a cert-chain check that looks right but doesn't actually validate against
// Amazon's real CA) would be worse than not having it, and is exactly the
// kind of security code that shouldn't be reinvented per-project.
// ALEXA_SKILL_ID (from .env) must match the skill's real ID once created in
// the Alexa Developer Console — without it, requestInterceptors below still
// verifies the signature/timestamp, but skips confirming the request is
// actually FOR this skill specifically (which matters if this same public
// endpoint is ever guessed at by an unrelated skill's requests).
const ALEXA_SKILL_ID = process.env.ALEXA_SKILL_ID || '';
if (Alexa && ExpressAdapter) {
  const AddItemIntentHandler = {
    canHandle(handlerInput) {
      return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddItemIntent';
    },
    handle(handlerInput) {
      const slots = handlerInput.requestEnvelope.request.intent.slots || {};
      const itemName = slots.ItemName && slots.ItemName.value;
      const listName = (slots.ListName && slots.ListName.value) || 'shopping';
      if (!itemName) {
        return handlerInput.responseBuilder.speak("What should I add?").reprompt("What should I add?").getResponse();
      }
      const result = addVoiceItem(itemName, listName);
      const speech = result.error
        ? `Sorry, I couldn't do that — ${result.error}`
        : `Added ${itemName} to your ${result.list === 'shopping' ? 'shopping list' : result.list + ' list'}.`;
      return handlerInput.responseBuilder.speak(speech).getResponse();
    },
  };
  const LaunchRequestHandler = {
    canHandle(handlerInput) { return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest'; },
    handle(handlerInput) {
      return handlerInput.responseBuilder.speak("You can say, add milk to the shopping list.").reprompt("What should I add?").getResponse();
    },
  };
  const HelpIntentHandler = {
    canHandle(handlerInput) {
      return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
        && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
      return handlerInput.responseBuilder.speak("Say something like, add milk to the shopping list.").reprompt("What should I add?").getResponse();
    },
  };
  const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
      const name = Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(handlerInput.requestEnvelope);
      return name === 'AMAZON.CancelIntent' || name === 'AMAZON.StopIntent';
    },
    handle(handlerInput) { return handlerInput.responseBuilder.speak("Okay.").getResponse(); },
  };
  const SessionEndedRequestHandler = {
    canHandle(handlerInput) { return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest'; },
    handle(handlerInput) { return handlerInput.responseBuilder.getResponse(); },
  };
  const ErrorHandler = {
    canHandle() { return true; },
    handle(handlerInput, error) {
      console.error('Alexa skill error:', error && error.message);
      return handlerInput.responseBuilder.speak("Sorry, something went wrong.").getResponse();
    },
  };
  const skillBuilder = Alexa.SkillBuilders.custom()
    .addRequestHandlers(AddItemIntentHandler, LaunchRequestHandler, HelpIntentHandler, CancelAndStopIntentHandler, SessionEndedRequestHandler)
    .addErrorHandlers(ErrorHandler);
  if (ALEXA_SKILL_ID) skillBuilder.withSkillId(ALEXA_SKILL_ID);
  const alexaAdapter = new ExpressAdapter(skillBuilder.create(), true, true); // (skill, verifySignature, verifyTimestamp) — both left on
  // Mounted directly, not behind requireAuth: Alexa's own signature already
  // IS the authentication here, and requireAuth's PIN-session model has no
  // way to authenticate an Alexa request in the first place (no cookie, no
  // bearer token, no interactive login possible).
  app.post('/api/alexa', alexaAdapter.getRequestHandlers());
} else {
  app.post('/api/alexa', (req, res) => res.status(503).json({ error: 'Alexa integration isn\'t installed on this server — run npm install and restart.' }));
}

// Chores CRUD
app.get('/api/chores', (req, res) => {
  res.json(db.prepare(`SELECT * FROM chores ORDER BY sort_order, id`).all());
});
app.post('/api/chores', (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'Title required' });
  const max = db.prepare(`SELECT MAX(sort_order) m FROM chores`).get().m || 0;
  const r = db.prepare(`INSERT INTO chores
    (title, icon, assignee, freq, byday, on_date, at_time, carryover, celebrate, pay_amount, notes, photo_required, bonus, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      demoCleanText(b.title.trim(), 120), b.icon || '✅', String(b.assignee || 'all'),
      b.freq || 'daily', b.byday || '', b.on_date || '', b.at_time || '',
      b.carryover ? 1 : 0, (b.celebrate === false || b.celebrate === 0) ? 0 : 1,
      Number(b.pay_amount) || 0, demoCleanText((b.notes || '').trim(), 500),
      b.photo_required ? 1 : 0, b.bonus ? 1 : 0, max + 1);
  broadcastUpdate('chores');
  res.status(201).json(db.prepare(`SELECT * FROM chores WHERE id = ?`).get(r.lastInsertRowid));
});
app.put('/api/chores/:id', (req, res) => {
  const c = db.prepare(`SELECT * FROM chores WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`UPDATE chores SET title=?, icon=?, assignee=?, freq=?, byday=?, on_date=?, at_time=?,
              carryover=?, celebrate=?, pay_amount=?, notes=?, photo_required=?, bonus=?, active=? WHERE id=?`)
    .run(
      b.title !== undefined ? demoCleanText(b.title, 120) : c.title, b.icon ?? c.icon, String(b.assignee ?? c.assignee),
      b.freq ?? c.freq, b.byday ?? c.byday, b.on_date ?? c.on_date, b.at_time ?? c.at_time,
      (b.carryover ?? c.carryover) ? 1 : 0, (b.celebrate ?? c.celebrate) ? 1 : 0,
      (b.pay_amount !== undefined ? Number(b.pay_amount) || 0 : c.pay_amount),
      (b.notes !== undefined ? demoCleanText((b.notes || '').trim(), 500) : c.notes),
      (b.photo_required ?? c.photo_required) ? 1 : 0,
      (b.bonus ?? c.bonus) ? 1 : 0,
      (b.active ?? c.active) ? 1 : 0, c.id);
  broadcastUpdate('chores');
  res.json(db.prepare(`SELECT * FROM chores WHERE id = ?`).get(c.id));
});
app.delete('/api/chores/:id', (req, res) => {
  db.prepare(`DELETE FROM chores WHERE id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM chore_instances WHERE chore_id = ?`).run(req.params.id);
  broadcastUpdate('chores');
  res.json({ ok: true });
});

// Upload a custom picture for a chore. Reuses the photo upload pipeline (same
// /uploads dir, same slave sync). Returns an icon token "img:<filename>" the client
// stores in the chore's icon field.
app.post('/api/chore-image', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image (jpeg/png/webp/gif, ≤20MB)' });
  broadcastUpdate('chores'); // prompt slaves to pull the new file on next sync
  res.status(201).json({ icon: 'img:' + req.file.filename, filename: req.file.filename });
});

// Upload a "proof" photo for a completed chore instance — same upload pipeline
// as the chore icon above. Separate from the toggle endpoint on purpose: the kid
// takes/picks the photo first, THEN the client calls toggle(done:true), so a
// chore that requires a photo never gets marked done without one actually
// attached (the toggle endpoint below double-checks this server-side too).
app.post('/api/chore-instances/:id/proof', upload.single('photo'), (req, res) => {
  const inst = db.prepare(`SELECT * FROM chore_instances WHERE id = ?`).get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Unknown chore instance' });
  if (!req.file) return res.status(400).json({ error: 'No image (jpeg/png/webp/gif, ≤20MB)' });
  db.prepare(`UPDATE chore_instances SET proof_photo = ? WHERE id = ?`).run(req.file.filename, inst.id);
  broadcastUpdate('chores');
  res.status(201).json({ ok: true, filename: req.file.filename });
});

// A kid's chores for today (or ?date=YYYY-MM-DD)
app.get('/api/kids/:id/chores', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const date = req.query.date || choreToday();
  let balance = null;
  if (kid.allowance_enabled) {
    ensureWeeklyAllowanceCredited(); // lazy-credit so the goal progress bar stays current
    balance = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM allowance_ledger WHERE kid_id = ?`).get(kid.id).total;
  }
  res.json({ kid, date, chores: getKidChores(kid.id, date), streak: getKidStreak(kid.id, date), balance, stickerBalance: getKidStickerBalance(kid.id) });
});

// The whole chart for the wall display: every kid + their day's chores.
// 7-day (including today) completed/total count — the ranking stat for the
// wall-display leaderboard widget. Same "total=0 means nothing was due, not a
// miss" semantics as the /stats endpoint, just collapsed to two numbers instead
// of a daily breakdown since the widget only needs a single ranking figure.
function getKidWeeklyCompletion(kidId, todayStr) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const start = new Date(y, m - 1, d); start.setDate(start.getDate() - 6);
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const row = db.prepare(`SELECT COUNT(*) as total, SUM(done) as done FROM chore_instances WHERE kid_id = ? AND date >= ? AND date <= ?`)
    .get(kidId, startStr, todayStr);
  return { weeklyDone: row.done || 0, weeklyTotal: row.total || 0 };
}
app.get('/api/chore-chart', (req, res) => {
  const date = req.query.date || choreToday();
  const kids = db.prepare(`SELECT * FROM kids ORDER BY sort_order, id`).all();
  // The shared bonus / extra-credit pool for the day, so a chore-chart widget
  // can optionally surface it on the wall (claiming still happens in the app /
  // kid page). A claimed one carries who got it; unclaimed ones are up for
  // grabs. Same rows the per-kid /api/kids/:id/bonus-chores route reads.
  const claimRows = db.prepare(`
    SELECT ci.chore_id, k.name, k.avatar, k.color
    FROM chore_instances ci JOIN kids k ON k.id = ci.kid_id
    WHERE ci.date = ?`).all(date);
  const claimByChore = new Map(claimRows.map(r => [r.chore_id, r]));
  const bonusChores = db.prepare(
    `SELECT id, title, icon, pay_amount FROM chores WHERE active = 1 AND bonus = 1 ORDER BY sort_order, id`
  ).all().map(c => {
    const cl = claimByChore.get(c.id);
    return {
      id: c.id, title: c.title, icon: c.icon, pay_amount: c.pay_amount || 0,
      claimedBy: cl ? { name: cl.name, avatar: cl.avatar, color: cl.color } : null,
    };
  });
  res.json({
    date,
    bonusChores,
    kids: kids.map(k => ({
      ...k,
      chores: getKidChores(k.id, date),
      streak: getKidStreak(k.id, date),
      stickerBalance: getKidStickerBalance(k.id),
      ...getKidWeeklyCompletion(k.id, date),
    })),
  });
});

// Toggle / set a chore instance done state. Body: { done: true|false }.
// Kid page and parent app both use this; parents can re-open (done:false).
app.post('/api/chore-instances/:id/toggle', (req, res) => {
  const inst = db.prepare(`SELECT * FROM chore_instances WHERE id = ?`).get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Unknown chore instance' });
  const done = (typeof req.body.done === 'boolean') ? req.body.done : !inst.done;
  // Enforced here too, not just hidden/disabled in the UI — kids.html has no
  // login, so anyone on the LAN could otherwise call this endpoint directly and
  // skip a photo requirement the parent specifically set.
  if (done && !inst.proof_photo) {
    const chore = db.prepare(`SELECT photo_required FROM chores WHERE id = ?`).get(inst.chore_id);
    if (chore && chore.photo_required) {
      return res.status(400).json({ error: 'This chore needs a photo before it can be marked done.' });
    }
  }
  db.prepare(`UPDATE chore_instances SET done = ?, completed_at = ? WHERE id = ?`)
    .run(done ? 1 : 0, done ? new Date().toISOString() : '', inst.id);
  // Per-chore allowance: credit on completion, cleanly reverse if un-checked. Only
  // applies when the kid has allowance on and set to 'per_chore' — weekly_flat kids
  // aren't paid per instance, so a chore's pay_amount is simply ignored for them.
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(inst.kid_id);
  if (kid && kid.allowance_enabled && kid.allowance_mode === 'per_chore') {
    // Always clear any prior ledger row for this instance first — avoids double-credit
    // on repeated toggling and makes "un-check" a clean, exact reversal.
    db.prepare(`DELETE FROM allowance_ledger WHERE chore_instance_id = ? AND type = 'chore'`).run(inst.id);
    if (done && inst.pay_amount > 0) {
      db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, chore_instance_id) VALUES (?,?,?,?,?)`)
        .run(kid.id, inst.date, 'chore', inst.pay_amount, inst.id);
    }
  }
  // Auto-awarded stickers: only when the family has chosen 'auto' mode (default is
  // 'manual' — see sticker_award_mode). Reuses the chore's own celebrate flag as
  // the "this one's worth a sticker" signal rather than adding a second, separate
  // per-chore checkbox that would mean almost the same thing. Same delete-then-
  // insert dedupe shape as the allowance credit just above: always clear any prior
  // sticker tied to this instance first, so re-toggling never double-awards and
  // un-checking is a clean, exact reversal — not a silent leftover sticker.
  const choreFull = db.prepare(`SELECT celebrate FROM chores WHERE id = ?`).get(inst.chore_id);
  const stickerMode = db.prepare(`SELECT value FROM settings WHERE key = 'sticker_award_mode'`).get();
  if (stickerMode && stickerMode.value === 'auto' && choreFull && choreFull.celebrate) {
    db.prepare(`DELETE FROM stickers WHERE chore_instance_id = ?`).run(inst.id);
    if (done) {
      db.prepare(`INSERT INTO stickers (kid_id, date, chore_instance_id) VALUES (?,?,?)`)
        .run(inst.kid_id, inst.date, inst.id);
    }
  }
  broadcastUpdate('chores');
  res.json({ ok: true, done, celebrate: !!(choreFull && choreFull.celebrate) });
});

// ── Stickers ──────────────────────────────────────────────────────────────────
// GET /api/stickers?from=YYYY-MM-DD&to=YYYY-MM-DD&kid_id=3
// Range query (not just "today") because both the calendar widget (a month grid)
// and the kid's own sticker board (last few weeks) need a window, not a single day.
// kid_id is optional — omit it to get every kid's stickers in range (calendar
// widget's use case); pass it to scope to one kid (kids.html's use case).
app.get('/api/stickers', (req, res) => {
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  const kidId = req.query.kid_id ? parseInt(req.query.kid_id) : null;
  const rows = kidId
    ? db.prepare(`SELECT * FROM stickers WHERE date >= ? AND date <= ? AND kid_id = ? ORDER BY date, id`).all(from, to, kidId)
    : db.prepare(`SELECT * FROM stickers WHERE date >= ? AND date <= ? ORDER BY date, id`).all(from, to);
  res.json(rows);
});

// POST /api/stickers — manual award. Body: { kid_id, date?, note? }. date defaults
// to today. Available regardless of sticker_award_mode: 'manual' mode uses this as
// the ONLY way stickers happen; 'auto' mode still allows a parent to hand out an
// extra one for something outside the chore chart entirely (a kind word, good
// behavior at school, etc.) without that needing its own separate mechanism.
app.post('/api/stickers', (req, res) => {
  const kidId = parseInt(req.body.kid_id);
  if (!Number.isFinite(kidId)) return res.status(400).json({ error: 'kid_id required' });
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(kidId);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const date = (req.body.date || choreToday()).trim();
  const note = (req.body.note || '').trim();
  const r = db.prepare(`INSERT INTO stickers (kid_id, date, note) VALUES (?,?,?)`).run(kidId, date, note);
  broadcastUpdate('chores');
  res.status(201).json(db.prepare(`SELECT * FROM stickers WHERE id = ?`).get(r.lastInsertRowid));
});

// DELETE /api/stickers/:id — revoke one sticker (manual or auto). Parent-app only
// (not in the public-routes whitelist below), same trust boundary as editing any
// other chore-chart data — a kid on kids.html can view their stickers but not
// remove them.
app.delete('/api/stickers/:id', (req, res) => {
  db.prepare(`DELETE FROM stickers WHERE id = ?`).run(req.params.id);
  broadcastUpdate('chores');
  res.json({ ok: true });
});

// DELETE /api/stickers?kid_id=5 — clear ALL of a kid's stickers at once (a full
// reset to zero), for a manual correction rather than deleting one at a time.
// Deliberately kept on /api/stickers (not nested under /api/kids/:id/...) so
// it inherits the same protected trust boundary as the single-sticker DELETE
// above — /api/kids itself is public (kids.html/hub.html both manage kids
// without a login), and a route path merely nested under it would silently
// inherit that same public status via the whitelist's prefix match, which
// isn't the right boundary for a bulk-destructive action like this one.
// Deliberately does NOT touch sticker_redemptions — past redemptions keep
// their own history regardless (same "don't rewrite what already happened"
// reasoning as deleting a reward definition not touching redemptions made
// against it). That means clearing stickers can put a kid's balance
// temporarily negative if they'd already redeemed more than they now have on
// record — an intentional, visible signal that a correction happened, not
// silently hidden.
app.delete('/api/stickers', (req, res) => {
  const kidId = parseInt(req.query.kid_id);
  if (!Number.isFinite(kidId)) return res.status(400).json({ error: 'kid_id required' });
  const kid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(kidId);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const info = db.prepare(`DELETE FROM stickers WHERE kid_id = ?`).run(kid.id);
  broadcastUpdate('chores');
  res.json({ ok: true, cleared: info.changes, balance: getKidStickerBalance(kid.id) });
});

// GET a kid's sticker summary: running balance, recent stickers, recent
// redemptions. Mirrors GET /api/kids/:id/allowance's exact shape (balance +
// entries) — kids.html and app.html's stats sheet both read this the same way
// the allowance sheet already reads its own summary endpoint.
app.get('/api/kids/:id/stickers', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const balance = getKidStickerBalance(kid.id);
  const stickers = db.prepare(`SELECT * FROM stickers WHERE kid_id = ? ORDER BY date DESC, id DESC LIMIT 50`).all(kid.id);
  const redemptions = db.prepare(`SELECT * FROM sticker_redemptions WHERE kid_id = ? ORDER BY date DESC, id DESC LIMIT 50`).all(kid.id);
  res.json({ kid, balance, stickers, redemptions });
});

// GET /api/sticker-redemptions — every kid's redeemed rewards, most recent
// first, for the Family Hub's parent-facing "Redeemed Prizes" list (a single
// combined feed across kids, not one summary call per kid). Joins in the
// kid's name/avatar/color at read time rather than trusting the snapshot on
// each row for those fields — reward_title/star_cost ARE meant to be frozen
// snapshots (see the table's own schema comment), but a kid's name/avatar/
// color are live identity, not part of what was "redeemed."
app.get('/api/sticker-redemptions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT sr.*, k.name as kid_name, k.avatar as kid_avatar, k.color as kid_color
    FROM sticker_redemptions sr
    JOIN kids k ON k.id = sr.kid_id
    ORDER BY sr.date DESC, sr.id DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

// ── Rewards ───────────────────────────────────────────────────────────────────
// GET is public/read-only (kids.html shows what's available + affordable);
// create/edit/delete/redeem/undo all require the parent PIN like the rest of
// the chore chart's management surface.
app.get('/api/rewards', (req, res) => {
  res.json(db.prepare(`SELECT * FROM rewards ORDER BY sort_order, id`).all());
});
app.post('/api/rewards', (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title required' });
  const starCost = parseInt(req.body.star_cost);
  if (!Number.isFinite(starCost) || starCost <= 0) return res.status(400).json({ error: 'star_cost must be a positive number' });
  const max = db.prepare(`SELECT MAX(sort_order) m FROM rewards`).get().m || 0;
  const r = db.prepare(`INSERT INTO rewards (title, icon, star_cost, assignee, sort_order) VALUES (?,?,?,?,?)`)
    .run(title, (req.body.icon || '🎁').trim(), starCost, req.body.assignee || 'all', max + 1);
  broadcastUpdate('chores');
  res.status(201).json(db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(r.lastInsertRowid));
});
app.put('/api/rewards/:id', (req, res) => {
  const rw = db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(req.params.id);
  if (!rw) return res.status(404).json({ error: 'Not found' });
  const starCost = req.body.star_cost !== undefined ? parseInt(req.body.star_cost) : rw.star_cost;
  if (!Number.isFinite(starCost) || starCost <= 0) return res.status(400).json({ error: 'star_cost must be a positive number' });
  db.prepare(`UPDATE rewards SET title=?, icon=?, star_cost=?, assignee=?, active=? WHERE id=?`)
    .run((req.body.title ?? rw.title).trim(), (req.body.icon ?? rw.icon).trim(), starCost,
         req.body.assignee ?? rw.assignee, (req.body.active ?? rw.active) ? 1 : 0, rw.id);
  broadcastUpdate('chores');
  res.json(db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(rw.id));
});
app.delete('/api/rewards/:id', (req, res) => {
  // Deliberately does NOT touch sticker_redemptions — past redemptions keep
  // their own snapshotted reward_title/star_cost, so deleting the reward
  // definition doesn't erase or corrupt history of what was already redeemed.
  db.prepare(`DELETE FROM rewards WHERE id = ?`).run(req.params.id);
  broadcastUpdate('chores');
  res.json({ ok: true });
});

// POST /api/rewards/:id/redeem — body: { kid_id }. Parent confirms the kid has
// enough stars and records the spend; this is the moment the parent actually
// hands over the ice cream trip etc. Re-checks the balance server-side (not
// just trusting a greyed-out button in the UI) since kids.html is unauthenticated
// on the LAN — same reasoning as the photo-required check on chore completion.
app.post('/api/rewards/:id/redeem', (req, res) => {
  const reward = db.prepare(`SELECT * FROM rewards WHERE id = ?`).get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'Unknown reward' });
  const kidId = parseInt(req.body.kid_id);
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(kidId);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const balance = getKidStickerBalance(kidId);
  if (balance < reward.star_cost) {
    return res.status(400).json({ error: `Not enough stars — ${kid.name} has ${balance}, this costs ${reward.star_cost}.` });
  }
  db.prepare(`INSERT INTO sticker_redemptions (kid_id, reward_id, reward_title, star_cost, date) VALUES (?,?,?,?,?)`)
    .run(kidId, reward.id, reward.title, reward.star_cost, localDateStr());
  broadcastUpdate('chores');
  res.status(201).json({ ok: true, balance: getKidStickerBalance(kidId) });
});

// DELETE /api/sticker-redemptions/:id — undo a redemption recorded by mistake,
// giving the stars back. Symmetric with the rest of this ledger's reversibility
// (allowance payouts/adjustments and auto-award stickers are all cleanly
// reversible too) rather than a one-way spend with no way back.
app.delete('/api/sticker-redemptions/:id', (req, res) => {
  db.prepare(`DELETE FROM sticker_redemptions WHERE id = ?`).run(req.params.id);
  broadcastUpdate('chores');
  res.json({ ok: true });
});

// ── Favorites tab ────────────────────────────────────────────────────────────
// GET is the only one that needs to be fast/simple — config is returned
// pre-parsed from JSON so the client never touches raw JSON strings.
app.get('/api/favorite-cards', (req, res) => {
  const rows = db.prepare(`SELECT * FROM favorite_cards ORDER BY sort_order, id`).all();
  res.json(rows.map(r => {
    let config = {};
    try { config = JSON.parse(r.config || '{}'); } catch {}
    return { ...r, config };
  }));
});
app.post('/api/favorite-cards', (req, res) => {
  const type = (req.body.type || '').trim();
  if (!type) return res.status(400).json({ error: 'type is required' });
  const config = req.body.config && typeof req.body.config === 'object' ? req.body.config : {};
  const max = db.prepare(`SELECT MAX(sort_order) m FROM favorite_cards`).get().m || 0;
  const r = db.prepare(`INSERT INTO favorite_cards (type, config, sort_order) VALUES (?,?,?)`)
    .run(type, JSON.stringify(config), max + 1);
  broadcastUpdate('favorites');
  res.status(201).json({ id: r.lastInsertRowid, type, config, sort_order: max + 1 });
});
app.put('/api/favorite-cards/:id', (req, res) => {
  const card = db.prepare(`SELECT * FROM favorite_cards WHERE id = ?`).get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  const config = req.body.config !== undefined
    ? JSON.stringify(req.body.config && typeof req.body.config === 'object' ? req.body.config : {})
    : card.config;
  const sortOrder = req.body.sort_order !== undefined ? Number(req.body.sort_order) : card.sort_order;
  db.prepare(`UPDATE favorite_cards SET config = ?, sort_order = ? WHERE id = ?`).run(config, sortOrder, card.id);
  broadcastUpdate('favorites');
  res.json({ ok: true });
});
// Swap this card's sort_order with its immediate neighbor — a simpler,
// lower-risk reorder primitive than accepting a full reordered id list from
// the client (nothing to validate/reconcile against a race if two browsers
// reorder at once; each move is just one atomic swap).
app.post('/api/favorite-cards/:id/move', (req, res) => {
  const dir = req.body.direction === 'up' ? -1 : 1;
  const cards = db.prepare(`SELECT * FROM favorite_cards ORDER BY sort_order, id`).all();
  const idx = cards.findIndex(c => c.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= cards.length) return res.json({ ok: true }); // already at an edge — no-op, not an error
  const a = cards[idx], b = cards[swapIdx];
  const tx = db.transaction(() => {
    db.prepare(`UPDATE favorite_cards SET sort_order = ? WHERE id = ?`).run(b.sort_order, a.id);
    db.prepare(`UPDATE favorite_cards SET sort_order = ? WHERE id = ?`).run(a.sort_order, b.id);
  });
  tx();
  broadcastUpdate('favorites');
  res.json({ ok: true });
});
app.delete('/api/favorite-cards/:id', (req, res) => {
  db.prepare(`DELETE FROM favorite_cards WHERE id = ?`).run(req.params.id);
  broadcastUpdate('favorites');
  res.json({ ok: true });
});

// Reassign a single day's chore instance to a different kid — a one-off swap
// (sick kid, schedule change) that does NOT touch the chore's own recurring
// assignee rule. Only allowed while undone: a completed instance may already
// have an allowance ledger row tied to the original kid, and un-picking that
// apart cleanly isn't worth the complexity for what's meant to be a same-day,
// before-it's-done swap. Parent un-checks it first if they really need to move
// a completed one.
app.put('/api/chore-instances/:id/reassign', (req, res) => {
  const inst = db.prepare(`SELECT * FROM chore_instances WHERE id = ?`).get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Unknown chore instance' });
  if (inst.done) return res.status(400).json({ error: 'Un-check this chore before reassigning it.' });
  const newKidId = parseInt(req.body.kid_id);
  if (!Number.isFinite(newKidId)) return res.status(400).json({ error: 'kid_id required' });
  if (newKidId === inst.kid_id) return res.json({ ok: true }); // no-op
  const newKid = db.prepare(`SELECT id FROM kids WHERE id = ?`).get(newKidId);
  if (!newKid) return res.status(404).json({ error: 'Unknown kid' });
  const clash = db.prepare(`SELECT id FROM chore_instances WHERE chore_id = ? AND kid_id = ? AND date = ?`)
    .get(inst.chore_id, newKidId, inst.date);
  if (clash) return res.status(400).json({ error: 'That kid already has this chore today.' });
  db.prepare(`UPDATE chore_instances SET kid_id = ? WHERE id = ?`).run(newKidId, inst.id);
  broadcastUpdate('chores');
  res.json({ ok: true });
});

// ── Bonus / extra-credit chores ──────────────────────────────────────────────
// A shared pool (not pre-assigned to anyone — see materializeChoreInstances,
// which skips bonus chores) that any kid can claim for the day; whoever claims
// it first gets it and it's gone for everyone else. Claiming = doing it (no
// separate "claim then complete" step) since these are meant to be quick,
// opportunistic extra tasks.
app.get('/api/kids/:id/bonus-chores', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const date = req.query.date || choreToday();
  const claimedToday = new Set(
    db.prepare(`SELECT chore_id FROM chore_instances WHERE date = ?`).all(date).map(r => r.chore_id)
  );
  const bonusChores = db.prepare(`SELECT * FROM chores WHERE active = 1 AND bonus = 1 ORDER BY sort_order, id`).all()
    .filter(c => !claimedToday.has(c.id));
  res.json(bonusChores);
});
app.post('/api/kids/:id/claim-bonus/:choreId', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const chore = db.prepare(`SELECT * FROM chores WHERE id = ? AND bonus = 1 AND active = 1`).get(req.params.choreId);
  if (!chore) return res.status(404).json({ error: 'Unknown bonus chore' });
  const date = choreToday();
  // Whole-pool check (any kid), not the usual per-kid uniqueness — see schema note.
  const already = db.prepare(`SELECT id FROM chore_instances WHERE chore_id = ? AND date = ?`).get(chore.id, date);
  if (already) return res.status(400).json({ error: 'Someone already claimed this one today.' });
  const r = db.prepare(`INSERT INTO chore_instances (chore_id, kid_id, date, done, completed_at, pay_amount)
    VALUES (?, ?, ?, 1, ?, ?)`).run(chore.id, kid.id, date, new Date().toISOString(), chore.pay_amount || 0);
  if (kid.allowance_enabled && kid.allowance_mode === 'per_chore' && chore.pay_amount > 0) {
    db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, chore_instance_id) VALUES (?,?,?,?,?)`)
      .run(kid.id, date, 'chore', chore.pay_amount, r.lastInsertRowid);
  }
  broadcastUpdate('chores');
  res.status(201).json({ ok: true, celebrate: !!chore.celebrate });
});


// ── Allowance ──────────────────────────────────────────────────────────────────
// ISO week string like '2026-W28', used to dedupe the weekly flat credit so it's
// only ever granted once per calendar week no matter how often this is checked.
function isoWeekStr(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
// Credits this week's flat allowance for weekly_flat kids, if not already credited
// this week. Host-only, same reasoning as the briefing/feedback schedulers: a slave
// writing this locally would silently diverge from the host instead of syncing.
function ensureWeeklyAllowanceCredited() {
  if (isSlave()) return;
  const period = isoWeekStr();
  const kids = db.prepare(`SELECT * FROM kids WHERE allowance_enabled = 1 AND allowance_mode = 'weekly_flat' AND weekly_rate > 0`).all();
  for (const k of kids) {
    const already = db.prepare(`SELECT id FROM allowance_ledger WHERE kid_id = ? AND type = 'weekly' AND period = ?`).get(k.id, period);
    if (already) continue;
    db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, period, note) VALUES (?,?,?,?,?,?)`)
      .run(k.id, localDateStr(), 'weekly', k.weekly_rate, period, 'Weekly allowance');
  }
}
// GET a kid's completion history/stats for the parent's History view. ?days=N
// (default 30, capped at 180) controls how far back the daily breakdown goes.
// A day with total=0 means no chore was due that day (not a miss) — the UI should
// distinguish that from a day with total>0 and done<total.
app.get('/api/kids/:id/stats', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 180);
  const todayStr = localDateStr();
  const [y, m, d] = todayStr.split('-').map(Number);
  const dates = [];
  let cursor = new Date(y, m - 1, d);
  for (let i = 0; i < days; i++) {
    dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
    cursor.setDate(cursor.getDate() - 1);
  }
  dates.reverse(); // oldest first
  const rows = db.prepare(`SELECT date, done FROM chore_instances WHERE kid_id = ? AND date >= ? AND date <= ?`)
    .all(kid.id, dates[0], todayStr);
  const byDate = {};
  for (const r of rows) {
    if (!byDate[r.date]) byDate[r.date] = { total: 0, done: 0 };
    byDate[r.date].total++;
    if (r.done) byDate[r.date].done++;
  }
  const daily = dates.map(ds => ({ date: ds, total: (byDate[ds] || {}).total || 0, done: (byDate[ds] || {}).done || 0 }));
  const pctOverLastN = (n) => {
    const slice = daily.slice(-n);
    const total = slice.reduce((s, x) => s + x.total, 0);
    const done = slice.reduce((s, x) => s + x.done, 0);
    return total ? Math.round((done / total) * 100) : null; // null = no chores due in that window
  };
  const allTimeCompleted = db.prepare(`SELECT COUNT(*) c FROM chore_instances WHERE kid_id = ? AND done = 1`).get(kid.id).c;
  res.json({
    kid, days, daily,
    last7Pct: pctOverLastN(7),
    last30Pct: pctOverLastN(30),
    streak: getKidStreak(kid.id, todayStr),
    allTimeCompleted,
  });
});
// GET a kid's allowance summary: running balance + recent ledger entries.
app.get('/api/kids/:id/allowance', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  ensureWeeklyAllowanceCredited();
  const balance = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM allowance_ledger WHERE kid_id = ?`).get(kid.id).total;
  const entries = db.prepare(`SELECT * FROM allowance_ledger WHERE kid_id = ? ORDER BY id DESC LIMIT 50`).all(kid.id);
  res.json({ kid, balance, entries });
});
// Record a payout (parent hands over cash) — reduces the balance.
app.post('/api/kids/:id/allowance/payout', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Positive amount required' });
  db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, note) VALUES (?,?,?,?,?)`)
    .run(kid.id, localDateStr(), 'payout', -Math.abs(amount), (req.body.note || '').trim());
  broadcastUpdate('chores');
  const balance = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM allowance_ledger WHERE kid_id = ?`).get(kid.id).total;
  res.status(201).json({ ok: true, balance });
});
// Manual bonus (positive) or deduction (negative) — e.g. docking for a missed chore,
// or a one-off bonus that doesn't fit the per-chore/weekly model.
app.post('/api/kids/:id/allowance/adjust', (req, res) => {
  const kid = db.prepare(`SELECT * FROM kids WHERE id = ?`).get(req.params.id);
  if (!kid) return res.status(404).json({ error: 'Unknown kid' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Non-zero amount required' });
  db.prepare(`INSERT INTO allowance_ledger (kid_id, date, type, amount, note) VALUES (?,?,?,?,?)`)
    .run(kid.id, localDateStr(), 'adjustment', amount, (req.body.note || '').trim());
  broadcastUpdate('chores');
  const balance = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM allowance_ledger WHERE kid_id = ?`).get(kid.id).total;
  res.status(201).json({ ok: true, balance });
});

// ── Reminders (generic rotation reminders — trash/recycling day and
// anything else that recurs on a schedule but isn't a real calendar event:
// no title/notes/attendees, just a name+icon+schedule. Two schedule types
// cover the common cases without needing full RRULE complexity: 'weekly'
// (specific days of the week, e.g. trash is every Tuesday) and 'interval'
// (every N days from a reference date, e.g. recycling every 14 days
// starting from a known date). Household-shared data, same as events —
// participates in the host/slave sync snapshot below, not per-widget or
// per-display. ──────────────────────────────────────────────────────────
app.get('/api/reminders', (req, res) => {
  const rows = db.prepare(`SELECT * FROM reminders WHERE active = 1 ORDER BY id ASC`).all();
  res.json(rows.map(r => ({ ...r, schedule_config: JSON.parse(r.schedule_config) })));
});

// POST /api/reminders/icon-image — uploads a reminder icon image standalone,
// not tied to a specific reminder id, so it works identically whether the
// person is creating a brand new reminder or editing an existing one (the
// modal uploads on file-select, then includes the returned filename in the
// reminder's own create/save payload below). Reuses the same UPLOAD_DIR and
// `upload` multer instance as photos — no server-side resizing here, matching
// every other upload in this file (no image-processing library exists or is
// used anywhere; photos and custom-theme decorations are both stored at
// whatever size was uploaded and sized down at render time via CSS instead).
// A reminder icon renders at badge/chip scale everywhere it appears — see
// reminderIconHtml() in display.html for the CSS-based sizing.
app.post('/api/reminders/icon-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded (must be JPEG, PNG, WebP, or GIF).' });
  res.json({ ok: true, filename: req.file.filename });
});

// Validates a reminder's schedule_type/schedule_config shape — shared by
// POST and PUT below rather than duplicated, since the rules are identical
// for both. Returns an error string, or null if valid. Deliberately loose
// where a wrong value just means "won't match any date" rather than
// corrupting anything (e.g. an out-of-range weekday) — this exists to catch
// missing required fields and obviously malformed types, not to be a
// bulletproof schema validator.
function validateReminderSchedule(scheduleType, cfg) {
  cfg = cfg || {};
  if (!['weekly', 'interval', 'monthly', 'yearly'].includes(scheduleType)) {
    return "schedule_type must be 'weekly', 'interval', 'monthly', or 'yearly'";
  }
  if (scheduleType === 'weekly') {
    if (!Array.isArray(cfg.daysOfWeek) || !cfg.daysOfWeek.length) return 'Pick at least one day of the week';
  } else if (scheduleType === 'interval') {
    if (!cfg.startDate) return 'A start date is required';
    if (!Number.isInteger(cfg.intervalDays) || cfg.intervalDays < 1) return 'intervalDays must be a positive whole number';
  } else if (scheduleType === 'monthly') {
    if (!cfg.startDate) return 'A start date is required';
    if (cfg.monthlyMode === 'nthWeekday') {
      if (![1,2,3,4,-1].includes(cfg.nthWeek)) return 'nthWeek must be 1-4 or -1 (last)';
      if (!Number.isInteger(cfg.nthWeekday) || cfg.nthWeekday < 0 || cfg.nthWeekday > 6) return 'nthWeekday must be 0-6';
    } else {
      if (!Number.isInteger(cfg.dayOfMonth) || cfg.dayOfMonth < 1 || cfg.dayOfMonth > 31) return 'dayOfMonth must be 1-31';
    }
  } else if (scheduleType === 'yearly') {
    if (!cfg.startDate) return 'A start date is required';
    if (!Number.isInteger(cfg.yearlyMonth) || cfg.yearlyMonth < 1 || cfg.yearlyMonth > 12) return 'yearlyMonth must be 1-12';
    if (cfg.yearlyMode === 'nthWeekday') {
      if (![1,2,3,4,-1].includes(cfg.yearlyNthWeek)) return 'yearlyNthWeek must be 1-4 or -1 (last)';
      if (!Number.isInteger(cfg.yearlyNthWeekday) || cfg.yearlyNthWeekday < 0 || cfg.yearlyNthWeekday > 6) return 'yearlyNthWeekday must be 0-6';
    } else {
      if (!Number.isInteger(cfg.yearlyDay) || cfg.yearlyDay < 1 || cfg.yearlyDay > 31) return 'yearlyDay must be 1-31';
    }
  }
  if (cfg.endType && !['never', 'onDate', 'afterCount'].includes(cfg.endType)) {
    return "endType must be 'never', 'onDate', or 'afterCount'";
  }
  if (cfg.endType === 'onDate' && !cfg.endDate) return 'An end date is required when Ends is set to "On a date"';
  if (cfg.endType === 'afterCount' && (!Number.isInteger(cfg.endCount) || cfg.endCount < 1)) {
    return 'endCount must be a positive whole number when Ends is set to "After a number of times"';
  }
  return null;
}
app.post('/api/reminders', (req, res) => {
  const { name, icon, icon_type, icon_image, schedule_type, schedule_config } = req.body;
  if (!name || !schedule_type || !schedule_config) {
    return res.status(400).json({ error: 'name, schedule_type, and schedule_config are required' });
  }
  const scheduleError = validateReminderSchedule(schedule_type, schedule_config);
  if (scheduleError) return res.status(400).json({ error: scheduleError });
  const validIconType = ['emoji', 'text', 'image'].includes(icon_type) ? icon_type : 'emoji';
  const result = db.prepare(`
    INSERT INTO reminders (name, icon, icon_type, icon_image, schedule_type, schedule_config)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(demoCleanText(name, 120), icon || '📌', validIconType, validIconType === 'image' ? (icon_image || null) : null, schedule_type, JSON.stringify(schedule_config));
  const row = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(result.lastInsertRowid);
  broadcastUpdate('reminders');
  res.status(201).json({ ...row, schedule_config: JSON.parse(row.schedule_config) });
});

app.put('/api/reminders/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Reminder not found' });
  const { name, icon, icon_type, icon_image, schedule_type, schedule_config, active } = req.body;
  const newScheduleType = schedule_type ?? existing.schedule_type;
  const newScheduleConfig = schedule_config !== undefined ? schedule_config : JSON.parse(existing.schedule_config);
  const scheduleError = validateReminderSchedule(newScheduleType, newScheduleConfig);
  if (scheduleError) return res.status(400).json({ error: scheduleError });
  const newIconType = icon_type !== undefined
    ? (['emoji', 'text', 'image'].includes(icon_type) ? icon_type : 'emoji')
    : existing.icon_type;
  const newIconImage = newIconType === 'image' ? (icon_image ?? existing.icon_image) : null;
  // Clean up the old file whenever it's being replaced by a different one, or
  // dropped entirely because the type changed away from 'image' — same
  // pattern removeCustomThemeFile() already uses for decorations, just
  // inline here since this is the only place a reminder's own icon image
  // ever changes.
  if (existing.icon_image && existing.icon_image !== newIconImage) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, existing.icon_image)); } catch {}
  }
  db.prepare(`
    UPDATE reminders SET name=?, icon=?, icon_type=?, icon_image=?, schedule_type=?, schedule_config=?, active=?
    WHERE id=?
  `).run(
    name !== undefined ? demoCleanText(name, 120) : existing.name,
    icon ?? existing.icon,
    newIconType,
    newIconImage,
    newScheduleType,
    JSON.stringify(newScheduleConfig),
    active !== undefined ? (active ? 1 : 0) : existing.active,
    req.params.id
  );
  const row = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(req.params.id);
  broadcastUpdate('reminders');
  res.json({ ...row, schedule_config: JSON.parse(row.schedule_config) });
});

app.delete('/api/reminders/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Reminder not found' });
  if (existing.icon_image) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, existing.icon_image)); } catch {}
  }
  db.prepare(`DELETE FROM reminders WHERE id = ?`).run(req.params.id);
  broadcastUpdate('reminders');
  res.json({ ok: true });
});

// Resolves each iCal-sourced event's color_opacity to its EFFECTIVE value —
// the master default (feed_default_opacity) for any feed that hasn't opted
// out via its own use_global_opacity=0, or that feed's own color_opacity
// otherwise. Called once on every events response so the client
// (eventPillColor() in display.html) only ever has to reason about ONE
// already-correct opacity per event — it never needs to know this master-
// default/per-feed tier exists at all, same idea as eventPillColor() itself
// hiding the per-widget-override tier from every OTHER part of the app.
// Mutates events in place (this app's established convention — see
// mergeEvents() and friends) and strips use_global_opacity before
// returning, since it's an internal resolution detail the client has no
// use for once this has already run.
function resolveEventOpacity(events) {
  const masterRow = db.prepare(`SELECT value FROM settings WHERE key = 'feed_default_opacity'`).get();
  let master = masterRow ? parseInt(masterRow.value, 10) : 100;
  if (Number.isNaN(master)) master = 100;
  events.forEach(e => {
    if (e.source === 'ical' && e.use_global_opacity) e.color_opacity = master;
    delete e.use_global_opacity;
  });
  return events;
}

app.get('/api/events', (req, res) => {
  const { from, to } = req.query;

  // Local events — an event "overlaps" the [from, to] window if its span
  // (date .. end_date-or-date) intersects that window at all.
  let query = `SELECT *, 'local' as source FROM events`;
  const params = [];
  if (from && to) {
    query += ` WHERE date <= ? AND COALESCE(end_date, date) >= ?`;
    params.push(to, from);
  } else if (from) {
    query += ` WHERE COALESCE(end_date, date) >= ?`;
    params.push(from);
  }
  query += ` ORDER BY date ASC, start_time ASC`;
  const localEvents = db.prepare(query).all(...params);

  // iCal events (join with feed for color + enabled flag). The raw location and
  // the feed's show_location flag both go out; the display resolves visibility
  // (feed default -> per-widget master toggle -> per-widget-per-feed override),
  // exactly like the per-feed opacity override already works.
  let icalQuery = `
    SELECT ie.uid as id, ie.title, ie.date, ie.end_date, ie.start_time, ie.end_time, ie.notes,
           ie.location as location, f.show_location as show_location,
           f.id as feed_id, f.color, f.color_opacity, f.use_global_opacity, f.color_timed, f.name as feed_name, 'ical' as source
    FROM ical_events ie
    JOIN ical_feeds f ON f.id = ie.feed_id
    WHERE f.enabled = 1
  `;
  const icalParams = [];
  if (from && to) {
    icalQuery += ` AND ie.date <= ? AND COALESCE(ie.end_date, ie.date) >= ?`;
    icalParams.push(to, from);
  } else if (from) {
    icalQuery += ` AND COALESCE(ie.end_date, ie.date) >= ?`;
    icalParams.push(from);
  }
  icalQuery += ` ORDER BY ie.date ASC, ie.start_time ASC`;
  const icalEvents = db.prepare(icalQuery).all(...icalParams);

  // Merge and sort
  const all = resolveEventOpacity([...localEvents, ...icalEvents]).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!a.start_time) return -1;
    if (!b.start_time) return 1;
    return a.start_time < b.start_time ? -1 : 1;
  });

  // Drop anything the user has hidden. Series hides remove every occurrence of that
  // event key; occurrence hides remove only the matching date.
  const hidden = db.prepare(`SELECT event_key, scope, date FROM hidden_events`).all();
  if (hidden.length) {
    const seriesHidden = new Set(hidden.filter(h => h.scope === 'series').map(h => h.event_key));
    const occHidden = new Set(hidden.filter(h => h.scope !== 'series').map(h => `${h.event_key}|${h.date}`));
    const keyOf = (e) => e.source === 'ical' ? `ical:${e.id}` : `local:${e.id}`;
    const visible = all.filter(e => {
      const k = keyOf(e);
      if (seriesHidden.has(k)) return false;
      if (occHidden.has(`${k}|${e.date}`)) return false;
      return true;
    });
    return res.json(visible);
  }
  res.json(all);
});

// ── Hidden events (show/hide individual events on the displays) ───────────────
app.get('/api/hidden-events', (req, res) => {
  res.json(db.prepare(`SELECT * FROM hidden_events ORDER BY created_at DESC`).all());
});
app.post('/api/hidden-events', (req, res) => {
  const { event_key, scope, date, title } = req.body || {};
  if (!event_key) return res.status(400).json({ error: 'event_key required' });
  const sc = scope === 'series' ? 'series' : 'occurrence';
  // For a series hide, store a single row with date = '' (PK-safe sentinel) and
  // clear any per-occurrence hides for that key to avoid redundancy.
  if (sc === 'series') {
    db.prepare(`DELETE FROM hidden_events WHERE event_key = ?`).run(event_key);
    db.prepare(`INSERT OR REPLACE INTO hidden_events (event_key, scope, date, title) VALUES (?, 'series', '', ?)`)
      .run(event_key, title || '');
  } else {
    db.prepare(`INSERT OR REPLACE INTO hidden_events (event_key, scope, date, title) VALUES (?, 'occurrence', ?, ?)`)
      .run(event_key, date || '', title || '');
  }
  broadcastUpdate('events');
  res.json({ ok: true });
});
app.delete('/api/hidden-events', (req, res) => {
  // Unhide: remove by event_key (+ optional date for a single occurrence).
  const { event_key, date } = req.body || {};
  if (!event_key) return res.status(400).json({ error: 'event_key required' });
  if (date !== undefined && date !== null) {
    db.prepare(`DELETE FROM hidden_events WHERE event_key = ? AND date = ?`).run(event_key, date);
  } else {
    db.prepare(`DELETE FROM hidden_events WHERE event_key = ?`).run(event_key);
  }
  broadcastUpdate('events');
  res.json({ ok: true });
});

// ── User feedback / bug / feature submissions ─────────────────────────────────
// Stored locally and emailed to the product owner as a once-daily digest. The
// recipient + email creds are configured server-side (see feedback_* settings).
app.post('/api/feedback', upload.single('image'), (req, res) => {
  const { kind, message, device_name } = req.body || {};
  const msg = (message || '').trim();
  if (!msg) return res.status(400).json({ error: 'Message is required' });
  const k = ['bug','feature','feedback'].includes(kind) ? kind : 'feedback';
  const image = req.file ? req.file.filename : '';
  db.prepare(`INSERT INTO feedback (kind, message, device_name, app_version, image) VALUES (?,?,?,?,?)`)
    .run(k, msg.slice(0, 4000), (device_name || '').slice(0, 120), APP_VERSION, image);
  // Best-effort real-time forward to the central server (mothership). Never blocks
  // or fails the user's submission — local storage + email digest remain the
  // baseline; this is an additive delivery path.
  forwardFeedbackToCentral({ kind: k, message: msg, device_name, image }).catch(() => {});
  res.json({ ok: true });
});

// POSTs a feedback item to the configured central intake endpoint, if one is set.
// Does nothing (resolves) when no URL is configured, so the feature is fully
// optional and the app works identically with or without a central server. Uses a
// plain JSON body (image as base64) so there are no extra dependencies on the Pi.
async function forwardFeedbackToCentral({ kind, message, device_name, image }) {
  const base = resolveFeedbackUrl();
  if (!base) return; // feature off
  const key = resolveFeedbackKey();
  const target = new URL(`${base}/api/v1/feedback`);

  const payload = {
    kind, message,
    device_name: device_name || getSetting('display_name') || '',
    // NOT DEVICE_ID — this app has two separate, unrelated per-device
    // identifiers. DEVICE_ID (the scr_... file-based one) is used for
    // host/slave sync identity. screen_device_id_cache is the ID
    // fetchUpdateInfo() actually sends to /api/v1/update-check, which is
    // what the mothership records into licenseActivations. The mothership
    // resolves a feedback submitter's email by joining feedback.device_id
    // against licenseActivations.device_id — that only works if this sends
    // the SAME id update-check does. Sending DEVICE_ID here (as this
    // originally did) meant that join could essentially never match for any
    // real device, silently breaking email resolution for ~all submissions.
    device_id: updateSetting('screen_device_id_cache', '') || DEVICE_ID || '',
    app_version: APP_VERSION,
  };
  if (key) payload.key = key;
  if (image) {
    try {
      const imgPath = path.join(UPLOAD_DIR, image);
      if (fs.existsSync(imgPath)) {
        const ext = (path.extname(image).slice(1) || 'jpeg').toLowerCase();
        payload.image_base64 = `data:image/${ext};base64,` + fs.readFileSync(imgPath).toString('base64');
      }
    } catch { /* skip image on any read error */ }
  }
  const body = JSON.stringify(payload);
  const transport = target.protocol === 'https:' ? require('https') : require('http');

  await new Promise((resolve, reject) => {
    const r = transport.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(key ? { 'x-feedback-key': key } : {}),
      },
    }, (resp) => { resp.resume(); resp.on('end', resolve); });
    r.on('error', reject);
    r.setTimeout(8000, () => { r.destroy(new Error('central feedback timeout')); });
    r.write(body);
    r.end();
  });
}

// Small helper: make a JSON request to the central server (GET or POST), returning the
// parsed body. Used for the feedback reply thread. Resolves null on any failure so the
// UI degrades gracefully when the server is unreachable.
function centralRequest(method, pathAndQuery, bodyObj) {
  return new Promise((resolve) => {
    const base = resolveFeedbackUrl();
    if (!base) return resolve(null);
    const key = resolveFeedbackKey();
    let target;
    try { target = new URL(base + pathAndQuery); } catch { return resolve(null); }
    const transport = target.protocol === 'https:' ? require('https') : require('http');
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const r = transport.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method,
      headers: {
        'Accept': 'application/json',
        ...(key ? { 'x-feedback-key': key } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    r.on('error', () => resolve(null));
    r.setTimeout(8000, () => { r.destroy(); resolve(null); });
    if (body) r.write(body);
    r.end();
  });
}

// APP endpoint: fetch any developer replies to this device's feedback.
app.get('/api/feedback-replies', async (req, res) => {
  const key = resolveFeedbackKey();
  const allParam = (req.query.all === '1' || req.query.all === 'true') ? '&all=1' : '';
  const out = await centralRequest('GET',
    `/api/v1/feedback-replies?device=${encodeURIComponent(DEVICE_ID || '')}&key=${encodeURIComponent(key)}${allParam}`);
  res.json(out || { threads: [] });
});

// APP endpoint: user replies back on a thread.
app.post('/api/feedback-replies/:id', async (req, res) => {
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message required' });
  const out = await centralRequest('POST', `/api/v1/feedback-replies/${encodeURIComponent(req.params.id)}`,
    { text, device: DEVICE_ID || '', key: resolveFeedbackKey() });
  res.json(out || { error: 'Could not reach the server.' });
});

// APP endpoint: mark a thread's developer replies as seen.
app.post('/api/feedback-replies/:id/seen', async (req, res) => {
  await centralRequest('POST', `/api/v1/feedback-replies/${encodeURIComponent(req.params.id)}/seen`,
    { device: DEVICE_ID || '', key: resolveFeedbackKey() });
  res.json({ ok: true });
});
// each annotated with its hidden state and a stable key, so the Events tab can
// search and toggle visibility. Defaults to a forward-looking window.
app.get('/api/events-manage', (req, res) => {
  const _today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const from = req.query.from || _today;
  const to = req.query.to || (() => { const d = new Date(); d.setDate(d.getDate() + 365); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

  const localEvents = db.prepare(
    `SELECT *, 'local' as source FROM events WHERE date <= ? AND COALESCE(end_date, date) >= ? ORDER BY date ASC, start_time ASC`
  ).all(to, from);
  const icalEvents = db.prepare(`
    SELECT ie.uid as id, ie.title, ie.date, ie.end_date, ie.start_time, ie.end_time, ie.notes,
           ie.location as location, f.show_location as show_location,
           f.id as feed_id, f.color, f.color_opacity, f.use_global_opacity, f.name as feed_name, 'ical' as source
    FROM ical_events ie JOIN ical_feeds f ON f.id = ie.feed_id
    WHERE f.enabled = 1 AND ie.date <= ? AND COALESCE(ie.end_date, ie.date) >= ?
    ORDER BY ie.date ASC, ie.start_time ASC
  `).all(to, from);

  const hidden = db.prepare(`SELECT event_key, scope, date FROM hidden_events`).all();
  const seriesHidden = new Set(hidden.filter(h => h.scope === 'series').map(h => h.event_key));
  const occHidden = new Set(hidden.filter(h => h.scope !== 'series').map(h => `${h.event_key}|${h.date}`));

  const annotate = (e) => {
    const key = e.source === 'ical' ? `ical:${e.id}` : `local:${e.id}`;
    const isSeries = seriesHidden.has(key);
    const isOcc = occHidden.has(`${key}|${e.date}`);
    return { ...e, event_key: key, hidden_series: isSeries, hidden_occurrence: isOcc,
             // ical events can recur; local events are single (no series concept unless multi-day)
             recurring: e.source === 'ical' };
  };
  const all = resolveEventOpacity([...localEvents, ...icalEvents]).map(annotate).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!a.start_time) return -1;
    if (!b.start_time) return 1;
    return a.start_time < b.start_time ? -1 : 1;
  });
  res.json(all);
});

// POST /api/events
// Coerce a client-supplied owner_profile_id to a positive integer or null. Any
// junk (0, negative, non-numeric, absent) becomes null = unassigned — we don't
// verify the profile row exists here; a stale id just renders with the default
// colour, same as null, and a real orphan is cleaned up on profile delete.
function coerceOwnerProfileId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

app.post('/api/events', (req, res) => {
  let { title, date, end_date, start_time, end_time, color, notes, location, target_calendar, owner_profile_id } = req.body;
  if (!title || !date) {
    return res.status(400).json({ error: 'title and date are required' });
  }
  title = demoCleanText(title, 120);
  notes = demoCleanText(notes, 500);
  location = demoCleanText(location, 300);
  // Normalize: an end_date equal to or before the start date just means "single day"
  const normalizedEndDate = (end_date && end_date > date) ? end_date : null;
  // 'local' | 'google' | 'caldav:<url>' — where this one event should be
  // pushed. Anything unrecognized (or absent) is stored as NULL = the
  // legacy "push to whatever's enabled" default.
  const tc = (typeof target_calendar === 'string' && /^(local|google|caldav:.+)$/.test(target_calendar)) ? target_calendar : null;
  const ownerId = coerceOwnerProfileId(owner_profile_id);
  const result = db.prepare(`
    INSERT INTO events (title, date, end_date, start_time, end_time, color, notes, location, target_calendar, owner_profile_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, date, normalizedEndDate, start_time || null, end_time || null, color || '#4A90D9', notes || '', location || '', tc, ownerId);
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(result.lastInsertRowid);
  broadcastUpdate('events');
  res.status(201).json(event);
  pushLocalEventToCalDAV(event); // fire-and-forget; self-swallows all errors, no-ops if iCloud push isn't configured
  pushLocalEventToGoogle(event); // ditto for Google Calendar
});

// PUT /api/events/:id
app.put('/api/events/:id', (req, res) => {
  let { title, date, end_date, start_time, end_time, color, notes, location, owner_profile_id } = req.body;
  const existing = db.prepare(`SELECT * FROM events WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (title !== undefined) title = demoCleanText(title, 120);
  if (notes !== undefined) notes = demoCleanText(notes, 500);
  if (location !== undefined) location = demoCleanText(location, 300);

  const finalDate = date ?? existing.date;
  let finalEndDate = end_date !== undefined ? end_date : existing.end_date;
  if (finalEndDate && finalEndDate <= finalDate) finalEndDate = null;

  db.prepare(`
    UPDATE events SET title=?, date=?, end_date=?, start_time=?, end_time=?, color=?, notes=?, location=?, owner_profile_id=?
    WHERE id=?
  `).run(
    title ?? existing.title,
    finalDate,
    finalEndDate,
    start_time !== undefined ? start_time : existing.start_time,
    end_time   !== undefined ? end_time   : existing.end_time,
    color ?? existing.color,
    notes ?? existing.notes,
    location !== undefined ? location : existing.location,
    owner_profile_id !== undefined ? coerceOwnerProfileId(owner_profile_id) : existing.owner_profile_id,
    req.params.id
  );
  broadcastUpdate('events');
  const updated = db.prepare(`SELECT * FROM events WHERE id = ?`).get(req.params.id);
  res.json(updated);
  pushLocalEventToCalDAV(updated); // re-PUTs to the same deterministic remote URL — handles both edit and first-push-after-enabling
  pushLocalEventToGoogle(updated);
});

// DELETE /api/events/:id
app.delete('/api/events/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM events WHERE id = ?`).get(req.params.id); // read BEFORE delete — need caldav_url
  const result = db.prepare(`DELETE FROM events WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Event not found' });
  broadcastUpdate('events');
  res.json({ ok: true });
  if (existing) { deleteEventFromCalDAV(existing); deleteEventFromGoogle(existing); } // fire-and-forget; each no-ops if this event was never pushed there
});

// ── Family member profiles ───────────────────────────────────────────────────
// Persona picker for the companion app — NOT authentication. See the profiles
// table comment in the schema block. Zero rows = the app is unchanged. On a
// slave these mutating routes proxy to the host automatically (slaveWriteGuard
// doesn't allowlist /api/profiles as local-only).

// Only these tabs can be hidden — calendars/favorites/settings always stay.
const HIDEABLE_TABS = new Set(['photos', 'layout', 'displays', 'family']);
const PROFILE_FEATURE_KEYS = new Set(['ha', 'integrations']);
const PROFILE_PRESETS = new Set(['basic', 'intermediate', 'advanced', 'custom']);

// Normalise a client-supplied hidden_tabs value to a JSON string of a clean
// array (unknown / non-hideable ids dropped, deduped).
function cleanHiddenTabs(v) {
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { arr = []; } }
  if (!Array.isArray(arr)) arr = [];
  return JSON.stringify([...new Set(arr.filter(t => HIDEABLE_TABS.has(t)))]);
}
// Normalise features to a JSON string of an object with only known boolean keys.
function cleanFeatures(v) {
  let obj = v;
  if (typeof v === 'string') { try { obj = JSON.parse(v); } catch { obj = {}; } }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
  const out = {};
  for (const k of PROFILE_FEATURE_KEYS) { if (k in obj) out[k] = !!obj[k]; }
  return JSON.stringify(out);
}
function countManagers(exceptId) {
  const row = exceptId != null
    ? db.prepare(`SELECT COUNT(*) n FROM profiles WHERE is_manager = 1 AND id != ?`).get(exceptId)
    : db.prepare(`SELECT COUNT(*) n FROM profiles WHERE is_manager = 1`).get();
  return row.n;
}

// GET /api/profiles — rows verbatim; the client parses hidden_tabs / features.
app.get('/api/profiles', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(db.prepare(`SELECT * FROM profiles ORDER BY sort, id`).all());
});

// POST /api/profiles — the very first profile in a household is forced to be a
// manager, so a household can never lock itself out of profile management.
app.post('/api/profiles', (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').toString().trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const isFirst = db.prepare(`SELECT COUNT(*) n FROM profiles`).get().n === 0;
  const landing = HIDEABLE_TABS.has(b.landing_tab) || ['favorites', 'calendars', 'settings'].includes(b.landing_tab)
    ? b.landing_tab : 'favorites';
  const preset = PROFILE_PRESETS.has(b.preset) ? b.preset : 'custom';
  const result = db.prepare(`
    INSERT INTO profiles (name, color, avatar, is_manager, landing_tab, hidden_tabs, features, pin, preset, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    /^#[0-9a-fA-F]{3,8}$/.test(b.color || '') ? b.color : '#4A90D9',
    (b.avatar || '').toString().slice(0, 8),
    isFirst || b.is_manager ? 1 : 0,
    landing,
    cleanHiddenTabs(b.hidden_tabs),
    cleanFeatures(b.features),
    (b.pin || '').toString().replace(/\D/g, '').slice(0, 8),
    preset,
    Number.isInteger(b.sort) ? b.sort : 0
  );
  broadcastUpdate('profiles');
  res.status(201).json(db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(result.lastInsertRowid));
});

// PUT /api/profiles/:id — partial: only the keys present in the body change.
// pin: send "" to clear, omit to keep.
app.put('/api/profiles/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Profile not found' });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  const put = (col, val) => { sets.push(`${col}=?`); vals.push(val); };

  if (b.name !== undefined) {
    const n = (b.name || '').toString().trim().slice(0, 40);
    if (!n) return res.status(400).json({ error: 'name cannot be empty' });
    put('name', n);
  }
  if (b.color !== undefined && /^#[0-9a-fA-F]{3,8}$/.test(b.color || '')) put('color', b.color);
  if (b.avatar !== undefined) put('avatar', (b.avatar || '').toString().slice(0, 8));
  if (b.is_manager !== undefined) {
    const next = b.is_manager ? 1 : 0;
    // Never let the last manager demote themselves — the household would lose
    // all profile-management access.
    if (!next && existing.is_manager && countManagers(existing.id) === 0) {
      return res.status(400).json({ error: 'At least one profile must stay a manager.' });
    }
    put('is_manager', next);
  }
  if (b.landing_tab !== undefined) {
    const ok = HIDEABLE_TABS.has(b.landing_tab) || ['favorites', 'calendars', 'settings'].includes(b.landing_tab);
    put('landing_tab', ok ? b.landing_tab : 'favorites');
  }
  if (b.hidden_tabs !== undefined) put('hidden_tabs', cleanHiddenTabs(b.hidden_tabs));
  if (b.features !== undefined) put('features', cleanFeatures(b.features));
  if (b.pin !== undefined) put('pin', (b.pin || '').toString().replace(/\D/g, '').slice(0, 8));
  if (b.preset !== undefined) put('preset', PROFILE_PRESETS.has(b.preset) ? b.preset : 'custom');
  if (b.sort !== undefined && Number.isInteger(b.sort)) put('sort', b.sort);

  if (!sets.length) return res.json(existing);
  vals.push(existing.id);
  db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  broadcastUpdate('profiles');
  res.json(db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(existing.id));
});

// DELETE /api/profiles/:id — refuses to remove the last manager; orphaned
// events fall back to owner_profile_id = NULL (default colour).
app.delete('/api/profiles/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Profile not found' });
  if (existing.is_manager && countManagers(existing.id) === 0) {
    return res.status(400).json({ error: 'This is the only manager profile — make another profile a manager first.' });
  }
  db.prepare(`UPDATE events SET owner_profile_id = NULL WHERE owner_profile_id = ?`).run(existing.id);
  db.prepare(`UPDATE messages SET author_profile_id = NULL WHERE author_profile_id = ?`).run(existing.id);
  db.prepare(`DELETE FROM profiles WHERE id = ?`).run(existing.id);
  broadcastUpdate('profiles');
  broadcastUpdate('events');
  broadcastUpdate('messages');
  res.json({ ok: true });
});

// ── Family message board ─────────────────────────────────────────────────────
// Short notes shown on the wall (the "messageboard" widget) and managed from
// the app's Family Hub. See the `messages` table comment. Syncs host->slave
// like profiles/events; on a slave these mutating routes proxy to the host
// (not in slaveWriteGuard's local-only allowlist).

const MESSAGE_MAX_NOTES = 60; // cap the board; over this, the oldest UNPINNED note is dropped on insert
// Delete notes older than settings.messageboard_autoclear_days (pinned notes
// exempt; '0' = never). Cheap; runs at boot, on every GET /api/messages, and
// hourly. Host-only — a slave mirrors the host's table wholesale.
function sweepMessages() {
  if (isSlave()) return;
  const days = parseInt(getSetting('messageboard_autoclear_days'), 10);
  if (!Number.isFinite(days) || days <= 0) return;
  db.prepare(`DELETE FROM messages WHERE pinned = 0 AND created_at < datetime('now', ?)`).run(`-${days} days`);
}
try { sweepMessages(); } catch {}
setInterval(() => { try { sweepMessages(); } catch {} }, 60 * 60 * 1000);

app.get('/api/messages', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { sweepMessages(); } catch {}
  res.json(db.prepare(`SELECT * FROM messages ORDER BY pinned DESC, created_at DESC, id DESC`).all());
});

app.post('/api/messages', (req, res) => {
  const b = req.body || {};
  const text = demoCleanText((b.text || '').toString().slice(0, 280), 280).trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  const author = demoCleanText((b.author || '').toString().slice(0, 40), 40).trim();
  const color = /^#[0-9a-fA-F]{3,8}$/.test(b.color || '') ? b.color : '#4A90D9';
  const authorProfileId = coerceOwnerProfileId(b.author_profile_id);
  const result = db.prepare(
    `INSERT INTO messages (text, author, author_profile_id, color) VALUES (?, ?, ?, ?)`
  ).run(text, author, authorProfileId, color);
  // Trim to the cap — keep pinned + the newest, drop the rest.
  db.prepare(`
    DELETE FROM messages WHERE pinned = 0 AND id NOT IN (
      SELECT id FROM messages ORDER BY pinned DESC, created_at DESC, id DESC LIMIT ?
    )`).run(MESSAGE_MAX_NOTES);
  broadcastUpdate('messages');
  res.status(201).json(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(result.lastInsertRowid));
});

app.put('/api/messages/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Message not found' });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.pinned !== undefined) { sets.push('pinned=?'); vals.push(b.pinned ? 1 : 0); }
  if (b.text !== undefined) {
    const t = demoCleanText((b.text || '').toString().slice(0, 280), 280).trim();
    if (!t) return res.status(400).json({ error: 'text cannot be empty' });
    sets.push('text=?'); vals.push(t);
  }
  if (!sets.length) return res.json(existing);
  vals.push(existing.id);
  db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  broadcastUpdate('messages');
  res.json(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(existing.id));
});

app.delete('/api/messages/:id', (req, res) => {
  const r = db.prepare(`DELETE FROM messages WHERE id = ?`).run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Message not found' });
  broadcastUpdate('messages');
  res.json({ ok: true });
});

// ── Meal plan API ────────────────────────────────────────────────────────────
// One planned meal per (date, slot). slot is breakfast|lunch|dinner; which
// slots the household actually plans is settings.mealplan_slots (default just
// 'dinner'). An unplanned slot has no row. Shown on the wall (the "mealplan"
// widget) and managed from the app's Family Hub "Meals" sub-tab. Syncs
// host->slave like messages.
const MEAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
function sweepMeals() {
  if (isSlave()) return;
  db.prepare(`DELETE FROM meals WHERE date < date('now','-7 days') OR date > date('now','+120 days')`).run();
}
try { sweepMeals(); } catch {}
setInterval(() => { try { sweepMeals(); } catch {} }, 6 * 60 * 60 * 1000);

app.get('/api/meals', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { sweepMeals(); } catch {}
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const defFrom = iso(today);
  const defTo = (() => { const d = new Date(today); d.setDate(d.getDate() + 14); return iso(d); })();
  const from = MEAL_DATE_RE.test(req.query.from || '') ? req.query.from : defFrom;
  const to = MEAL_DATE_RE.test(req.query.to || '') ? req.query.to : defTo;
  // A stable slot order (breakfast -> lunch -> dinner) so the client doesn't
  // have to re-sort.
  res.json(db.prepare(`
    SELECT * FROM meals WHERE date BETWEEN ? AND ?
    ORDER BY date, CASE slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END
  `).all(from, to));
});

function upsertMeal(req, res, date, slot) {
  if (!MEAL_DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!MEAL_SLOTS.includes(slot)) return res.status(400).json({ error: 'slot must be breakfast, lunch or dinner' });
  const b = req.body || {};
  const title = demoCleanText((b.title || '').toString().slice(0, 80), 80).trim();
  const notes = demoCleanText((b.notes || '').toString().slice(0, 300), 300).trim();
  if (!title) {
    // Empty title = clear this slot.
    db.prepare(`DELETE FROM meals WHERE date = ? AND slot = ?`).run(date, slot);
    broadcastUpdate('meals');
    return res.json({ ok: true, cleared: true });
  }
  db.prepare(`
    INSERT INTO meals (date, slot, title, notes, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date, slot) DO UPDATE SET title = excluded.title, notes = excluded.notes, updated_at = excluded.updated_at
  `).run(date, slot, title, notes);
  broadcastUpdate('meals');
  res.json(db.prepare(`SELECT * FROM meals WHERE date = ? AND slot = ?`).get(date, slot));
}
// /api/meals/:date defaults to the dinner slot (back-compat with the
// pre-slots widget/app); /api/meals/:date/:slot is explicit.
app.put('/api/meals/:date/:slot', (req, res) => upsertMeal(req, res, req.params.date, req.params.slot));
app.put('/api/meals/:date', (req, res) => upsertMeal(req, res, req.params.date, 'dinner'));

function deleteMeal(req, res, date, slot) {
  if (!MEAL_DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!MEAL_SLOTS.includes(slot)) return res.status(400).json({ error: 'bad slot' });
  db.prepare(`DELETE FROM meals WHERE date = ? AND slot = ?`).run(date, slot);
  broadcastUpdate('meals');
  res.json({ ok: true });
}
app.delete('/api/meals/:date/:slot', (req, res) => deleteMeal(req, res, req.params.date, req.params.slot));
app.delete('/api/meals/:date', (req, res) => deleteMeal(req, res, req.params.date, 'dinner'));

// ── Camera streaming (managed go2rtc) ─────────────────────────────────────────
// The "camera" layout widget shows a live RTSP / ONVIF / Home Assistant camera
// on the wall. Browsers can't play RTSP, so a local go2rtc process ingests each
// camera once and repackages it (WebRTC / MSE / MJPEG) for the browser. go2rtc's
// own HTTP API binds to 127.0.0.1 and is NEVER exposed: the browser reaches
// exactly one thing — the WebSocket at /api/camera/:id/ws, reverse-proxied to
// go2rtc's /api/ws?src=cam_<id> (that single socket carries WebRTC signalling,
// MSE and MJPEG) — plus /api/camera/:id/frame.jpeg for a poster still. Stream
// URLs (which routinely embed rtsp://user:pass@host) live only in the cameras
// table and go2rtc.yaml on disk, never in an API response.

// The binary is bundled by install.sh (Pi), the Docker image, and the Windows
// installer. When an install updates code-only through the in-app updater the
// binary won't be there — ensureGo2rtcBinary() below downloads the pinned build
// on first camera use so it self-heals on every platform. Keep this version +
// the sha256 map in step with scripts/go2rtc-version.sh on a bump.
const GO2RTC_VERSION = 'v1.9.14';
const GO2RTC_SHA256 = {
  go2rtc_linux_amd64: '32d616af226bd731678ffde328b94cfb94e30339bfefc469cfb76323144615a6',
  go2rtc_linux_arm64: '359fabade8a7a51e81a55fe6df6b0ef81764a5e1d63179577534eaaa71904b50',
  go2rtc_linux_arm:   '4d7e1639af5a2722a28e864468fd8099b3c1682565446c798bf9e3b38fde12e4',
  go2rtc_linux_armv6: '4dc20370556b29f3a90f4c7a09dcd95472c8f74cca56d4d1fb91f32bdd15174c',
  go2rtc_linux_i386:  '12a114d19fc9fba1b3541cf7c6bb9b01896a6845f31285ec77269e2e7c613885',
  'go2rtc_win64.zip':     'dd4167d75cb04abe618855b7c71f8658bd009f60c1a71835d134d2c11c939907',
  'go2rtc_win_arm64.zip': '814be0f6d8669025c7bccdd1f026ffaf613abae5352239f4ec84de543b94594a',
  'go2rtc_win32.zip':     '6fafb817477f4d34e5edfd8bb3c547151dfc5c404bde41e274db146b17ed5c03',
  'go2rtc_mac_amd64.zip': '9b0b9a27a4dc3a5b8b93376e7e8fc2787c6af624a512842622be84aec0171c7a',
  'go2rtc_mac_arm64.zip': '919b78adc759d6b3883d1e1b2ac915ac0985bb903ff1897b4d228527bd64690c',
};
// process.arch/platform -> release asset name (or null for an arch with no build).
function go2rtcAssetName() {
  const a = process.arch, p = process.platform;
  if (p === 'linux') {
    if (a === 'x64') return 'go2rtc_linux_amd64';
    if (a === 'arm64') return 'go2rtc_linux_arm64';
    if (a === 'arm') return 'go2rtc_linux_arm';   // Node reports 'arm' for v6 and v7; the v7 build covers Pi 2+
    if (a === 'ia32') return 'go2rtc_linux_i386';
    return null;
  }
  if (p === 'win32') {
    if (a === 'x64') return 'go2rtc_win64.zip';
    if (a === 'arm64') return 'go2rtc_win_arm64.zip';
    if (a === 'ia32') return 'go2rtc_win32.zip';
    return null;
  }
  if (p === 'darwin') return a === 'arm64' ? 'go2rtc_mac_arm64.zip' : 'go2rtc_mac_amd64.zip';
  return null;
}

const GO2RTC_BIN_NAME = IS_WIN ? 'go2rtc.exe' : 'go2rtc';
const GO2RTC_BIN_PATH = path.join(__dirname, 'bin', GO2RTC_BIN_NAME);
function go2rtcBinReady() { try { return fs.existsSync(GO2RTC_BIN_PATH); } catch { return false; } }
const GO2RTC_CONFIG_PATH = dataPath('go2rtc.yaml');
const GO2RTC_WEBRTC_PORT = 8555; // fixed local UDP port for WebRTC media (single-box case)
function go2rtcPort() {
  const p = parseInt(getSetting('go2rtc_port'), 10);
  return Number.isFinite(p) && p > 0 && p < 65536 ? p : 1984;
}

const CAMERA_URL_SCHEMES = new Set(['rtsp', 'rtsps', 'rtmp', 'rtmps', 'http', 'https', 'onvif', 'hls']);
// Validate + normalise a camera source. Returns { ok, value } | { ok:false, error }.
// This is the whole SSRF story on the input side: the browser never causes a
// server-side fetch (it only talks to /api/camera/*), and the only URL the
// server hands onward is this one, to the local go2rtc — same trust class as
// ha_base_url / the SMTP host / an iCal feed URL. We don't allowlist hosts (it
// breaks legitimate NVRs on odd subnets), but we do bound the scheme and block
// the cloud metadata address, the one target that turns "fetch a URL" into a
// credential-theft primitive on a hosted box.
function validateCameraUrl(kind, raw) {
  const s = (raw || '').toString().trim();
  if (kind === 'ha') {
    return /^ha:camera\.[a-z0-9_]+$/.test(s)
      ? { ok: true, value: s }
      : { ok: false, error: 'Home Assistant cameras must be ha:camera.<entity_id>' };
  }
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'That is not a valid URL' }; }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (!CAMERA_URL_SCHEMES.has(scheme)) {
    return { ok: false, error: `Unsupported "${scheme}:" — use rtsp / rtsps / http / https / onvif / rtmp` };
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '169.254.169.254' || host === 'metadata.google.internal' || host === 'metadata') {
    return { ok: false, error: 'That address is not allowed' };
  }
  return { ok: true, value: s };
}

// ── go2rtc process management ──
let _go2rtc = null;              // the child process, or null
let _go2rtcRestartTID = null;
let _go2rtcBackoff = 1000;
let _go2rtcStarting = false;
let _go2rtcUnavailable = false;    // spawn failed for a non-arch reason
let _go2rtcUnsupportedArch = false; // no go2rtc build for this platform/arch — permanent
let _go2rtcDownloading = false;    // fetching the binary right now
let _go2rtcDownloadPromise = null; // in-flight download, so concurrent callers share it
let _go2rtcStopRequested = false;
let _go2rtcWantImmediateRespawn = false;
const _haStreamCache = new Map(); // entity_id -> { url, at }

// Stream a URL (following redirects) to a file. No auth headers — this only
// ever fetches a pinned GitHub release asset.
function downloadFile(url, destPath, timeoutMs = 60000, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 5) return reject(new Error('too many redirects'));
    let lib;
    try { lib = new URL(url).protocol === 'https:' ? https : http; } catch { return reject(new Error('bad url')); }
    const req = lib.get(url, { headers: { 'User-Agent': 'PiazzaHQ/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadFile(new URL(res.headers.location, url).toString(), destPath, timeoutMs, _redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

// Make sure bin/go2rtc exists — download + sha256-verify the pinned build for
// this platform if it doesn't. Self-swallowing; sets _go2rtcUnsupportedArch /
// _go2rtcUnavailable on a permanent / transient failure. Returns true once the
// binary is present and ready.
async function ensureGo2rtcBinary() {
  if (go2rtcBinReady()) return true;
  if (_go2rtcUnsupportedArch) return false;
  if (_go2rtcDownloadPromise) return _go2rtcDownloadPromise;
  const asset = go2rtcAssetName();
  const sha = asset && GO2RTC_SHA256[asset];
  if (!asset || !sha) {
    _go2rtcUnsupportedArch = true;
    console.error(`[go2rtc] no build for ${process.platform}/${process.arch} — the Camera widget is unavailable on this device`);
    return false;
  }
  _go2rtcDownloadPromise = (async () => {
    _go2rtcDownloading = true;
    const url = `https://github.com/AlexxIT/go2rtc/releases/download/${GO2RTC_VERSION}/${asset}`;
    const binDir = path.join(__dirname, 'bin');
    const tmp = path.join(binDir, `.go2rtc.download.${process.pid}`);
    try {
      fs.mkdirSync(binDir, { recursive: true });
      console.log(`[go2rtc] downloading ${GO2RTC_VERSION} (${asset})…`);
      await downloadFile(url, tmp, 120000);
      const got = crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex');
      if (got !== sha) throw new Error(`sha256 mismatch (expected ${sha}, got ${got})`);
      if (asset.endsWith('.zip')) {
        const exDir = path.join(binDir, '.go2rtc.extract');
        fs.rmSync(exDir, { recursive: true, force: true });
        extractZip(tmp, exDir);
        // the zip holds a single go2rtc / go2rtc.exe
        const found = fs.readdirSync(exDir).find((f) => f === GO2RTC_BIN_NAME) || fs.readdirSync(exDir)[0];
        fs.renameSync(path.join(exDir, found), GO2RTC_BIN_PATH);
        fs.rmSync(exDir, { recursive: true, force: true });
        fs.rmSync(tmp, { force: true });
      } else {
        fs.renameSync(tmp, GO2RTC_BIN_PATH);
      }
      if (!IS_WIN) { try { fs.chmodSync(GO2RTC_BIN_PATH, 0o755); } catch {} }
      _go2rtcUnavailable = false;
      console.log('[go2rtc] binary ready');
      return true;
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      _go2rtcUnavailable = true; // transient — a later reload retries
      console.error('[go2rtc] binary download failed (Camera widget unavailable for now): ' + e.message);
      return false;
    } finally {
      _go2rtcDownloading = false;
      _go2rtcDownloadPromise = null;
    }
  })();
  return _go2rtcDownloadPromise;
}

function anyLayoutHasCamera() {
  try {
    for (const r of db.prepare(`SELECT widgets FROM layouts`).all()) {
      const arr = JSON.parse(r.widgets || '[]');
      if (Array.isArray(arr) && arr.some(w => w && w.type === 'camera' && w.camId)) return true;
    }
  } catch {}
  return false;
}

function cameraServiceState() {
  if (getSetting('camera_service_autostart') === '0') return 'disabled';
  if (_go2rtcDownloading) return 'downloading';
  if (_go2rtcUnsupportedArch || _go2rtcUnavailable) return 'unavailable';
  if (_go2rtc) return 'running';
  if (anyLayoutHasCamera()) return 'starting';
  return 'stopped';
}

// Ask Home Assistant for a playable stream source for a camera entity. Prefers
// the WebSocket `camera/stream` command (yields an HA-proxied HLS URL whose
// token is in the path — no LLAT exposure). Cached ~5 min. null = unresolvable
// (the widget then shows "offline"; the user can add it as a direct RTSP URL).
async function resolveHaCameraSource(entityId) {
  const cached = _haStreamCache.get(entityId);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.url;
  const base = getSetting('ha_base_url'), token = getSetting('ha_token');
  if (!base || !token || !WebSocketClient) return null;
  let url = null;
  try {
    const r = await haWsRequest(base, token, [{ type: 'camera/stream', entity_id: entityId }]);
    const result = r && r['camera/stream'];
    if (result && result.url) {
      url = /^(https?|rtsps?):/.test(result.url)
        ? result.url
        : base.replace(/\/+$/, '') + result.url; // HA returns a relative /api/hls/... path
    }
  } catch {}
  _haStreamCache.set(entityId, { url, at: Date.now() });
  return url;
}

async function buildGo2rtcConfig() {
  const streams = {};
  for (const c of db.prepare(`SELECT * FROM cameras`).all()) {
    let src = c.url;
    if (c.kind === 'ha') {
      src = await resolveHaCameraSource(c.url.slice(3));
      if (!src) continue; // unresolvable — skip; widget shows offline
    }
    streams[`cam_${c.id}`] = src;
  }
  return streams;
}
function toGo2rtcYaml(streams) {
  const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = [
    'api:', `  listen: ${q('127.0.0.1:' + go2rtcPort())}`,
    'rtsp:', '  listen: ""',
    'webrtc:', `  listen: ":${GO2RTC_WEBRTC_PORT}"`, '  candidates:', `    - ${q('127.0.0.1:' + GO2RTC_WEBRTC_PORT)}`,
    'log:', '  level: "warn"',
    'streams:',
  ];
  for (const [k, v] of Object.entries(streams)) lines.push(`  ${k}: ${q(v)}`);
  return lines.join('\n') + '\n';
}

function _go2rtcLog(buf) {
  String(buf).split(/\r?\n/).filter(Boolean).forEach((l) => console.log('[go2rtc] ' + l));
}
function startCameraService() {
  if (_go2rtc || _go2rtcStarting) return;
  // Prefer the bundled/downloaded binary; fall back to a bare command in case
  // go2rtc is on PATH (a hand-rolled install).
  const bin = go2rtcBinReady() ? GO2RTC_BIN_PATH : GO2RTC_BIN_NAME;
  _go2rtcStarting = true;
  _go2rtcStopRequested = false;
  let child;
  try {
    child = spawn(bin, ['-config', GO2RTC_CONFIG_PATH], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    _go2rtcStarting = false; _go2rtcUnavailable = true;
    console.error('[go2rtc] could not start — camera widgets will show "unavailable": ' + e.message);
    return;
  }
  child.on('error', (e) => {
    _go2rtcStarting = false;
    if (e.code === 'ENOENT') { _go2rtcUnavailable = true; console.error('[go2rtc] binary not found — cameras unavailable on this device'); }
    else console.error('[go2rtc] process error: ' + e.message);
  });
  child.stdout.on('data', _go2rtcLog);
  child.stderr.on('data', _go2rtcLog);
  child.on('spawn', () => {
    _go2rtcStarting = false; _go2rtcUnavailable = false; _go2rtcBackoff = 1000;
    console.log(`[go2rtc] started (pid ${child.pid}, api 127.0.0.1:${go2rtcPort()})`);
  });
  child.on('exit', (code, sig) => {
    console.log(`[go2rtc] exited (code ${code}${sig ? ', signal ' + sig : ''})`);
    _go2rtc = null; _go2rtcStarting = false;
    if (_go2rtcStopRequested && !_go2rtcWantImmediateRespawn) { _go2rtcStopRequested = false; return; }
    const immediate = _go2rtcWantImmediateRespawn;
    _go2rtcWantImmediateRespawn = false; _go2rtcStopRequested = false;
    if (getSetting('camera_service_autostart') === '0' || !anyLayoutHasCamera()) return;
    const delay = immediate ? 200 : _go2rtcBackoff;
    if (!immediate) _go2rtcBackoff = Math.min(_go2rtcBackoff * 2, 15000);
    _go2rtcRestartTID = setTimeout(() => { _go2rtcRestartTID = null; startCameraService(); }, delay);
  });
  _go2rtc = child;
}
function stopCameraService(reason) {
  if (_go2rtcRestartTID) { clearTimeout(_go2rtcRestartTID); _go2rtcRestartTID = null; }
  if (!_go2rtc) return;
  console.log('[go2rtc] stopping (' + (reason || 'requested') + ')');
  _go2rtcStopRequested = true; _go2rtcWantImmediateRespawn = false;
  try { _go2rtc.kill(); } catch {}
}
// Rewrite the config and make go2rtc pick it up: kill + immediate respawn when
// it's running (go2rtc reads its config only at startup — no reliable partial
// reload), a fresh start when it wasn't. No-ops (and stops the service) when
// nothing needs a camera or the hard off-switch is set.
async function reloadCameraService() {
  try {
    if (getSetting('camera_service_autostart') === '0') { stopCameraService('service disabled'); return; }
    if (!anyLayoutHasCamera()) { stopCameraService('no camera widgets'); return; }
    let yaml;
    try { yaml = toGo2rtcYaml(await buildGo2rtcConfig()); }
    catch (e) { console.error('[go2rtc] config build failed: ' + e.message); return; }
    try { fs.writeFileSync(GO2RTC_CONFIG_PATH, yaml); }
    catch (e) { console.error('[go2rtc] config write failed: ' + e.message); return; }
    if (_go2rtc) {
      _go2rtcWantImmediateRespawn = true;
      try { _go2rtc.kill(); } catch {}
    } else {
      // Bundled by the installer / image; downloaded on demand otherwise so a
      // code-only in-app update still ends up with a working Camera widget.
      const ready = await ensureGo2rtcBinary();
      if (ready) startCameraService();
    }
  } catch (e) {
    console.error('[go2rtc] reload error: ' + e.message);
  }
}
// A camera widget exists but the service isn't up (typically a first-run
// binary download that failed while offline) — retry periodically so it
// self-heals once the network is back. Cheap: no-ops unless all conditions hold.
setInterval(() => {
  if (!_go2rtc && !_go2rtcStarting && !_go2rtcDownloading && !_go2rtcUnsupportedArch
      && getSetting('camera_service_autostart') !== '0' && anyLayoutHasCamera()) {
    reloadCameraService();
  }
}, 20 * 60 * 1000);
function go2rtcApi(method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: go2rtcPort(), path: pathname, method, timeout: 4000 },
      (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => {
        if (r.statusCode >= 400) return reject(new Error('go2rtc ' + r.statusCode));
        try { resolve(d ? JSON.parse(d) : null); } catch { resolve(null); }
      }); }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('go2rtc timeout')));
    req.end();
  });
}

// WebSocket reverse-proxy: /api/camera/:id/ws  <->  ws://127.0.0.1:<port>/api/ws?src=cam_<id>
let _camWss = null;
function attachCameraWsProxy(server) {
  if (!WebSocketClient || _camWss) return;
  const WSS = WebSocketClient.Server || WebSocketClient.WebSocketServer;
  if (!WSS) return;
  _camWss = new WSS({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return; }
    const m = pathname.match(/^\/api\/camera\/(\d+)\/ws$/);
    if (!m) return; // not ours — leave the socket for any other handler
    const id = parseInt(m[1], 10);
    if (!db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(id)) { socket.destroy(); return; }
    _camWss.handleUpgrade(req, socket, head, (client) => {
      let upstream;
      try { upstream = new WebSocketClient(`ws://127.0.0.1:${go2rtcPort()}/api/ws?src=cam_${id}`); }
      catch { try { client.close(); } catch {} return; }
      const closeBoth = () => { try { client.close(); } catch {} try { upstream.close(); } catch {} };
      upstream.on('open', () => {
        client.on('message', (d, isBinary) => { try { upstream.send(d, { binary: isBinary }); } catch {} });
        upstream.on('message', (d, isBinary) => { try { client.send(d, { binary: isBinary }); } catch {} });
      });
      upstream.on('error', closeBoth);
      upstream.on('close', closeBoth);
      client.on('error', closeBoth);
      client.on('close', closeBoth);
    });
  });
}

// ── Camera API ──
function redactCamera(c) {
  let host_hint = '';
  if (c.kind === 'ha') host_hint = c.url.slice(3);
  else { try { host_hint = new URL(c.url).host; } catch {} }
  return { id: c.id, name: c.name, kind: c.kind, url_set: !!c.url, host_hint, created_at: c.created_at };
}

app.get('/api/cameras', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(db.prepare(`SELECT * FROM cameras ORDER BY name COLLATE NOCASE, id`).all().map(redactCamera));
});

app.post('/api/cameras', (req, res) => {
  const b = req.body || {};
  const name = demoCleanText((b.name || '').toString().slice(0, 60), 60).trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const kind = b.kind === 'ha' ? 'ha' : 'url';
  const v = validateCameraUrl(kind, b.url);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const r = db.prepare(`INSERT INTO cameras (name, kind, url) VALUES (?, ?, ?)`).run(name, kind, v.value);
  broadcastUpdate('cameras');
  reloadCameraService();
  res.status(201).json(redactCamera(db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(r.lastInsertRowid)));
});

app.put('/api/cameras/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Camera not found' });
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.name !== undefined) {
    const name = demoCleanText((b.name || '').toString().slice(0, 60), 60).trim();
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    sets.push('name=?'); vals.push(name);
  }
  const kind = b.kind === 'ha' ? 'ha' : b.kind === 'url' ? 'url' : existing.kind;
  if (b.kind !== undefined) { sets.push('kind=?'); vals.push(kind); }
  const urlGiven = b.url !== undefined && (b.url || '').toString().trim() !== '';
  if (urlGiven) {
    const v = validateCameraUrl(kind, b.url);
    if (!v.ok) return res.status(400).json({ error: v.error });
    sets.push('url=?'); vals.push(v.value);
  } else if (kind !== existing.kind) {
    return res.status(400).json({ error: 'Changing the source type needs a new URL' });
  }
  if (!sets.length) return res.json(redactCamera(existing));
  vals.push(existing.id);
  db.prepare(`UPDATE cameras SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  broadcastUpdate('cameras');
  reloadCameraService();
  res.json(redactCamera(db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(existing.id)));
});

app.delete('/api/cameras/:id', (req, res) => {
  const r = db.prepare(`DELETE FROM cameras WHERE id = ?`).run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Camera not found' });
  broadcastUpdate('cameras');
  reloadCameraService();
  res.json({ ok: true });
});

app.get('/api/cameras/:id/test', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = parseInt(req.params.id, 10);
  if (!db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(id)) return res.status(404).json({ error: 'Camera not found' });
  const state = cameraServiceState();
  if (state === 'downloading') return res.json({ ok: false, error: 'Setting up the camera service — try again in a moment.' });
  if (state === 'unavailable') {
    return res.json({ ok: false, error: _go2rtcUnsupportedArch
      ? 'No camera service build for this device — run the server on Docker or Windows instead.'
      : "Couldn't set up the camera service (offline?). It will retry on its own." });
  }
  if (state === 'disabled') return res.json({ ok: false, error: 'The camera service is turned off in settings.' });
  try {
    const info = await go2rtcApi('GET', `/api/streams?src=cam_${id}`);
    const s = info && (info[`cam_${id}`] || info);
    const producers = s && s.producers;
    const online = Array.isArray(producers) && producers.some((p) => p && !p.error);
    res.json(online ? { ok: true } : { ok: false, error: 'The camera service could not connect to this stream yet.' });
  } catch {
    res.json({ ok: false, error: 'The camera service is not responding.' });
  }
});

app.get('/api/camera/service', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ state: cameraServiceState() });
});

// Poster / last-frame still (also what the widget shows dimmed while
// reconnecting). Proxied straight from go2rtc; never cached.
app.get('/api/camera/:id/frame.jpeg', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || !db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(id)) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  const up = http.request(
    { host: '127.0.0.1', port: go2rtcPort(), path: `/api/frame.jpeg?src=cam_${id}`, method: 'GET', timeout: 10000 },
    (r) => {
      if (r.statusCode >= 400) { res.sendStatus(502); r.resume(); return; }
      res.status(200);
      if (r.headers['content-type']) res.set('Content-Type', r.headers['content-type']);
      r.pipe(res);
    }
  );
  up.on('error', () => { if (!res.headersSent) res.sendStatus(502); });
  up.on('timeout', () => up.destroy());
  up.end();
});

// ── Flight Map (live ADS-B aircraft tracking) ────────────────────────────────
// The "flightmap" widget shows filtered aircraft moving on a self-drawn world
// map. Data comes from free community ADS-B APIs (airplanes.live, with
// adsb.lol / adsb.fi as fallbacks) — polled server-side on an interval,
// cached, and pushed to the widget via the normal SSE 'flightmap' topic. The
// browser only ever hits /api/flightmap/* on its own origin. Every device
// (host and each slave) runs its own poll loop, exactly like each runs its
// own go2rtc — so flight_positions (the breadcrumb trail) is per-device and
// not synced; only flight_watch (saved subjects) syncs host->slave.
//
// SSRF posture: outbound hosts are the configured source base (a settings
// field, same trust class as ha_base_url), the pinned ADS-B fallback hosts,
// and api.adsbdb.com for route/type enrichment. No user-supplied host ever
// reaches a fetch — only a callsign/hex is interpolated into a fixed URL.

const FLIGHT_BUILTIN_SOURCES = [
  'https://api.airplanes.live/v2',
  'https://api.adsb.lol/v2',
  'https://opendata.adsb.fi/api/v2',
];
function flightSources() {
  const custom = (getSetting('flightmap_source') || '').trim().replace(/\/+$/, '');
  const list = [];
  if (/^https?:\/\/[^\s/]+/i.test(custom)) list.push(custom);
  for (const s of FLIGHT_BUILTIN_SOURCES) if (!list.includes(s)) list.push(s);
  return list;
}
function flightUserAgent() {
  const contact = (getSetting('flightmap_ua_contact') || '').trim();
  return `PiazzaHQ/${APP_VERSION} (+https://piazzahq.com${contact ? '; ' + contact : ''})`;
}
function flightPollSeconds() {
  const n = parseInt(getSetting('flightmap_poll_seconds'), 10);
  return Number.isFinite(n) ? Math.max(8, Math.min(n, 120)) : 12;
}
function flightTrailMinutes() {
  const n = parseInt(getSetting('flightmap_trail_minutes'), 10);
  return Number.isFinite(n) ? Math.max(2, Math.min(n, 480)) : 30;
}
// A widget can ask for a longer trail than the household default via
// ?trailMin= on /state; clamp it here (both the seed window and the storage
// retention floor honour this).
function clampTrailMin(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(2, Math.min(n, 480)) : fallback;
}

// Normalise one readsb/tar1090 aircraft record to our shape.
function normalizeAircraft(ac) {
  if (!ac || typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return null;
  const onGround = ac.alt_baro === 'ground' || ac.alt_baro === 0;
  const altFt = ac.alt_baro === 'ground' ? 0
    : (typeof ac.alt_baro === 'number' ? ac.alt_baro
    : (typeof ac.alt_geom === 'number' ? ac.alt_geom : null));
  return {
    hex: String(ac.hex || '').trim().toLowerCase(),
    callsign: String(ac.flight || '').trim(),
    reg: String(ac.r || '').trim(),
    type: String(ac.t || '').trim(),
    lat: ac.lat, lon: ac.lon,
    altFt,
    gsKts: typeof ac.gs === 'number' ? ac.gs : null,
    trackDeg: typeof ac.track === 'number' ? ac.track : (typeof ac.true_heading === 'number' ? ac.true_heading : null),
    vertRateFpm: typeof ac.baro_rate === 'number' ? ac.baro_rate : (typeof ac.geom_rate === 'number' ? ac.geom_rate : null),
    squawk: String(ac.squawk || '').trim(),
    mil: !!((Number(ac.dbFlags) || 0) & 1), // readsb dbFlags bit 0 = military
    onGround,
  };
}

// A FlightQuery is one of:
//   {kind:'mil'} | {kind:'type', value} | {kind:'squawk', value}
//   {kind:'callsign', value} | {kind:'reg', value} | {kind:'hex', value}
//   {kind:'point', lat, lon, radiusNm}
function flightQueryPath(q) {
  const e = encodeURIComponent;
  switch (q.kind) {
    case 'mil': return '/mil';
    case 'type': return '/type/' + e(String(q.value || '').toUpperCase());
    case 'squawk': return '/squawk/' + e(String(q.value || '').replace(/\D/g, '').slice(0, 4));
    case 'callsign': return '/callsign/' + e(String(q.value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    case 'reg': return '/reg/' + e(String(q.value || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''));
    case 'hex': return '/hex/' + e(String(q.value || '').toLowerCase().replace(/[^0-9a-f,]/g, ''));
    case 'point': {
      const lat = Math.max(-90, Math.min(90, Number(q.lat) || 0));
      const lon = Math.max(-180, Math.min(180, Number(q.lon) || 0));
      const r = Math.max(1, Math.min(250, Math.round(Number(q.radiusNm) || 100)));
      return `/point/${lat}/${lon}/${r}`;
    }
    default: return null;
  }
}
function flightQueryKey(q) {
  if (!q || !q.kind) return '';
  if (q.kind === 'point') return `point:${Number(q.lat).toFixed(3)},${Number(q.lon).toFixed(3)},${Math.round(q.radiusNm)}`;
  return `${q.kind}:${String(q.value || '').toLowerCase()}`;
}
function flightQueryValid(q) { return !!(q && flightQueryPath(q)); }
// "B738, A320" / "b738 a320" -> ['B738','A320']. The ADS-B /type/ endpoint is
// one type per request, so a multi-type filter fans out to one query each and
// the results merge by hex in the /state route.
function flightTypeList(raw) {
  return String(raw || '').toUpperCase().split(/[\s,]+/).map(s => s.replace(/[^A-Z0-9]/g, '')).filter(Boolean).slice(0, 8);
}

function flightHttpJson(base, pathname, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(base + pathname); } catch { return reject(new Error('bad url')); }
    // https for the public APIs; http allowed too (same trust class as
    // ha_base_url — someone may point flightmap_source at a tar1090 box on
    // their own LAN). Scheme still bounded to the two.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('bad scheme'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { 'User-Agent': flightUserAgent(), 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 4_000_000) req.destroy(new Error('too big')); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad json')); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

// Try each source in order. The first that returns aircraft wins; a source
// that answers 200-but-empty is NOT trusted to be authoritative (a
// soft-rate-limited mirror looks exactly like "no matching aircraft"), so we
// keep going and take the first non-empty result, falling back to an empty
// 200 if that's genuinely all anyone has. Returns
// { aircraft:[...], source, degraded } — degraded=true only if every source
// errored (caller then keeps serving whatever it had).
async function flightFetch(q) {
  const pathname = flightQueryPath(q);
  if (!pathname) return { aircraft: [], source: null, degraded: true };
  let anyOk = false, emptySource = null;
  for (const base of flightSources()) {
    try {
      const json = await flightHttpJson(base, pathname);
      anyOk = true;
      const raw = Array.isArray(json && json.ac) ? json.ac : (Array.isArray(json && json.aircraft) ? json.aircraft : []);
      const aircraft = raw.map(normalizeAircraft).filter(a => a && a.hex);
      if (aircraft.length) return { aircraft, source: base, degraded: false };
      if (!emptySource) emptySource = base;
    } catch { /* try next source */ }
  }
  if (anyOk) return { aircraft: [], source: emptySource, degraded: false };
  return { aircraft: [], source: null, degraded: true };
}

// ── route / aircraft-type enrichment (adsbdb.com — free, no key) ──
// The ADS-B feeds carry position + callsign but not the origin/destination
// airports or a human aircraft-type name. adsbdb fills that in. Cached in
// memory (lost on restart, refetched — fine) and decorated onto the aircraft
// objects the /state route returns. Only ever fetches api.adsbdb.com over
// https; a fixed host, no user input in the URL beyond the callsign/hex.
const _flightRouteCache = new Map();    // callsign -> { route|null, at }
const _flightAcInfoCache = new Map();   // hex -> { info|null, at }
const _flightEnrichInflight = new Set();
const ROUTE_TTL = 2 * 60 * 60 * 1000;
const ACINFO_TTL = 24 * 60 * 60 * 1000;

// PIAZZA_ADSBDB_URL overrides the enrichment host (tests only; unset in prod).
const ADSBDB_BASE = process.env.PIAZZA_ADSBDB_URL || 'https://api.adsbdb.com';
function adsbdbGet(pathname) {
  return new Promise((resolve, reject) => {
    const u = new URL(ADSBDB_BASE + pathname);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u,
      { headers: { 'User-Agent': flightUserAgent(), 'Accept': 'application/json' } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(new Error('too big')); });
        res.on('end', () => {
          if (res.statusCode === 404) return resolve(null); // unknown callsign/hex
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          try { resolve(JSON.parse(body)); } catch { reject(new Error('bad json')); }
        });
      });
    req.on('error', reject);
    req.setTimeout(6000, () => req.destroy(new Error('timeout')));
  });
}
function _airport(a) {
  if (!a || typeof a !== 'object') return null;
  return {
    icao: a.icao_code || '', iata: a.iata_code || '',
    name: a.name || '', city: a.municipality || '',
    lat: typeof a.latitude === 'number' ? a.latitude : null,
    lon: typeof a.longitude === 'number' ? a.longitude : null,
  };
}
async function flightEnrichOne(callsign, hex) {
  const cs = (callsign || '').trim().toUpperCase();
  const hx = (hex || '').trim().toLowerCase();
  const now = Date.now();
  const needRoute = cs && !(_flightRouteCache.has(cs) && now - _flightRouteCache.get(cs).at < ROUTE_TTL);
  const needAc = hx && !(_flightAcInfoCache.has(hx) && now - _flightAcInfoCache.get(hx).at < ACINFO_TTL);
  if (!needRoute && !needAc) return;
  const inflightKey = cs + '|' + hx;
  if (_flightEnrichInflight.has(inflightKey)) return;
  _flightEnrichInflight.add(inflightKey);
  try {
    if (needRoute) {
      try {
        const j = await adsbdbGet('/v0/callsign/' + encodeURIComponent(cs));
        const fr = j && j.response && typeof j.response === 'object' ? j.response.flightroute : null;
        _flightRouteCache.set(cs, { at: now, route: fr ? { from: _airport(fr.origin), to: _airport(fr.destination), airline: (fr.airline && fr.airline.name) || '' } : null });
      } catch { _flightRouteCache.set(cs, { at: now, route: null }); }
    }
    if (needAc) {
      try {
        const j = await adsbdbGet('/v0/aircraft/' + encodeURIComponent(hx));
        const ac = j && j.response && typeof j.response === 'object' ? j.response.aircraft : null;
        _flightAcInfoCache.set(hx, { at: now, info: ac ? { typeName: ac.type || '', icaoType: ac.icao_type || '', manufacturer: ac.manufacturer || '', owner: ac.registered_owner || '' } : null });
      } catch { _flightAcInfoCache.set(hx, { at: now, info: null }); }
    }
  } finally {
    _flightEnrichInflight.delete(inflightKey);
  }
}
// Decorate an aircraft list with cached route/type info. When awaitSmall and
// the list is short (a followed flight / a small watch set), block briefly on
// the first uncached lookup so the very first render has the route; big
// filter lists enrich in the background and pick it up next poll.
async function enrichAircraft(list, awaitSmall) {
  if (!Array.isArray(list) || !list.length) return list;
  const small = list.length <= 4;
  const jobs = [];
  for (const a of list) {
    if (!a.callsign && !a.hex) continue;
    const p = flightEnrichOne(a.callsign, a.hex);
    if (awaitSmall && small) jobs.push(p); else p.catch(() => {});
  }
  if (jobs.length) { try { await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(r, 2500))]); } catch {} }
  for (const a of list) {
    const r = a.callsign && _flightRouteCache.get(a.callsign.trim().toUpperCase());
    const i = a.hex && _flightAcInfoCache.get(a.hex);
    if (r && r.route) a.route = r.route;
    if (i && i.info) { a.typeName = i.info.typeName; a.owner = i.info.owner; if (!a.type && i.info.icaoType) a.type = i.info.icaoType; }
  }
  return list;
}

// ── poll loop ──
const _flightState = new Map();   // queryKey -> { query, fetchedAt, source, aircraft, degraded }
const _flightBackoff = new Map(); // queryKey -> ms
let _flightPollTID = null;
let _flightPolling = false;

function activeFlightWatches(now) {
  const today = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
  return db.prepare(`SELECT * FROM flight_watch`).all().filter(r =>
    (!r.active_from || r.active_from <= today) && (!r.active_to || r.active_to >= today));
}
function watchToQuery(r) {
  const kind = r.kind === 'reg' ? 'reg' : (r.kind === 'hex' ? 'hex' : 'callsign');
  return { kind, value: r.value };
}
// The union of distinct queries across every flightmap widget on every layout
// plus every active flight_watch row. De-duped by key.
function activeFlightQueries() {
  const out = new Map();
  const add = (q) => { if (flightQueryValid(q)) out.set(flightQueryKey(q), q); };
  try {
    for (const row of db.prepare(`SELECT widgets FROM layouts`).all()) {
      let arr; try { arr = JSON.parse(row.widgets || '[]'); } catch { continue; }
      if (!Array.isArray(arr)) continue;
      for (const w of arr) {
        if (!w || w.type !== 'flightmap') continue;
        for (const q of widgetFlightQueries(w)) add(q);
      }
    }
  } catch {}
  try { for (const r of activeFlightWatches()) add(watchToQuery(r)); } catch {}
  return [...out.entries()].map(([key, query]) => ({ key, query }));
}
// The concrete queries a single widget needs, given its subject config.
function widgetFlightQueries(w) {
  const s = (w && w.fmSubject) || 'filter';
  if (s === 'flight') {
    const kind = w.fmFlightKind === 'reg' ? 'reg' : (w.fmFlightKind === 'hex' ? 'hex' : 'callsign');
    return w.fmFlightValue ? [{ kind, value: w.fmFlightValue }] : [];
  }
  if (s === 'watch') {
    const rows = activeFlightWatches().filter(r =>
      w.fmWatchProfileId == null ? true : String(r.profile_id) === String(w.fmWatchProfileId));
    return rows.map(watchToQuery);
  }
  // filter
  const f = (w && w.fmFilter) || {};
  if (f.mil) return [{ kind: 'mil' }];
  if (f.type) return flightTypeList(f.type).map(t => ({ kind: 'type', value: t }));
  if (f.squawk) return [{ kind: 'squawk', value: f.squawk }];
  if (f.radiusNm && (f.lat != null) && (f.lon != null))
    return [{ kind: 'point', lat: f.lat, lon: f.lon, radiusNm: f.radiusNm }];
  return [];
}

function recordFlightPositions(aircraft) {
  // No isSlave() guard: a slave is a real device with a display that polls the
  // ADS-B API itself, so it keeps its own local trail (flight_positions is not
  // synced). Same model as each device running its own go2rtc.
  const now = Math.floor(Date.now() / 1000);
  const ins = db.prepare(`INSERT INTO flight_positions (hex, ts, lat, lon, alt_ft, gs_kts, track, callsign) VALUES (?,?,?,?,?,?,?,?)`);
  const tx = db.transaction((list) => {
    for (const a of list) {
      if (!a.hex || typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
      ins.run(a.hex, now, a.lat, a.lon, a.altFt == null ? null : Math.round(a.altFt),
        a.gsKts == null ? null : a.gsKts, a.trackDeg == null ? null : a.trackDeg, a.callsign || null);
    }
  });
  try { tx(aircraft); } catch {}
}

async function flightPollTick() {
  if (_flightPolling) return;
  _flightPolling = true;
  try {
    const queries = activeFlightQueries();
    const keep = new Set(queries.map(q => q.key));
    for (const k of [..._flightState.keys()]) if (!keep.has(k)) _flightState.delete(k);
    if (!queries.length) return;
    let changed = false;
    for (const { key, query } of queries) {
      const bo = _flightBackoff.get(key) || 0;
      const prev = _flightState.get(key);
      if (bo && prev && Date.now() - prev.fetchedAt < bo) continue;
      const r = await flightFetch(query);
      if (r.degraded) {
        _flightBackoff.set(key, Math.min((bo || flightPollSeconds() * 1000) * 2, 5 * 60 * 1000));
        if (prev) prev.degraded = true;
        continue;
      }
      _flightBackoff.delete(key);
      _flightState.set(key, { query, fetchedAt: Date.now(), source: r.source, aircraft: r.aircraft, degraded: false });
      recordFlightPositions(r.aircraft);
      enrichAircraft(r.aircraft, false).catch(() => {}); // background: next /state call serves it
      changed = true;
    }
    if (changed) broadcastUpdate('flightmap');
  } catch (e) {
    console.error('[flightmap] poll error: ' + e.message);
  } finally {
    _flightPolling = false;
  }
}
function startFlightPolling() {
  if (_flightPollTID) clearInterval(_flightPollTID);
  const run = () => { flightPollTick().catch(() => {}); };
  _flightPollTID = setInterval(run, Math.max(4000, flightPollSeconds() * 1000));
  run();
}

// The longest trail any flightmap widget on any layout is asking for, so the
// sweep keeps enough history to satisfy it (a widget's fmTrailMin can exceed
// the household flightmap_trail_minutes default).
function maxWidgetTrailMinutes() {
  let m = 0;
  try {
    for (const r of db.prepare(`SELECT widgets FROM layouts`).all()) {
      let arr; try { arr = JSON.parse(r.widgets || '[]'); } catch { continue; }
      for (const w of (Array.isArray(arr) ? arr : [])) {
        if (w && w.type === 'flightmap' && Number.isFinite(+w.fmTrailMin)) m = Math.max(m, +w.fmTrailMin);
      }
    }
  } catch {}
  return m;
}
function sweepFlightPositions() {
  try {
    const keepMin = Math.min(Math.max(flightTrailMinutes(), maxWidgetTrailMinutes(), 180), 480);
    const cutoff = Math.floor(Date.now() / 1000) - keepMin * 60;
    db.prepare(`DELETE FROM flight_positions WHERE ts < ?`).run(cutoff);
    // per-hex row cap — enough for ~8h at a 12s poll
    db.prepare(`
      DELETE FROM flight_positions WHERE rowid IN (
        SELECT rowid FROM (
          SELECT rowid, ROW_NUMBER() OVER (PARTITION BY hex ORDER BY ts DESC) AS rn FROM flight_positions
        ) WHERE rn > 2600
      )`).run();
  } catch (e) { console.error('[flightmap] sweep error: ' + e.message); }
}
setInterval(() => { try { sweepFlightPositions(); } catch {} }, 30 * 60 * 1000);

function anyLayoutHasFlightMap() {
  try {
    for (const r of db.prepare(`SELECT widgets FROM layouts`).all()) {
      const arr = JSON.parse(r.widgets || '[]');
      if (Array.isArray(arr) && arr.some(w => w && w.type === 'flightmap')) return true;
    }
  } catch {}
  return false;
}

// ── world basemap (optional on-demand download, mirrors ensureGo2rtcBinary) ──
// It's world-atlas@2's countries-50m.json (Natural Earth 1:50m land + country
// borders — public domain), fetched once on first Flight Map use and
// sha256-verified. Pinned + hashed in scripts/basemap-version.sh; keep in
// step on a bump. Served from jsDelivr's npm mirror (stable, version-pinned);
// PIAZZA_BASEMAP_URL overrides it (tests point it at a local fixture; unset
// in every real deployment). ensureBasemap() accepts the file raw OR gzipped.
const BASEMAP_VERSION = 'world-atlas@2/countries-50m';
const BASEMAP_URL = process.env.PIAZZA_BASEMAP_URL
  || 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const BASEMAP_SHA256_GZ = 'b0cc4fba25b956b5797bdda6b5276cfa5aac427ba3274e7c3e9eb8a50de4bf0f';
const BASEMAP_SHA256_RAW = '04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394';
const BASEMAP_RAW_BYTES = 756420;
const BASEMAP_PATH = dataPath('flightmap-basemap.json');
let _basemapDownloading = false;
let _basemapDownloadPromise = null;
let _basemapUnavailable = false;
let _basemapNextRetryAt = 0; // don't re-hit the network on every poll after a failure

// Optional second layer: US state borders (us-atlas@3's states-10m.json —
// public domain, US Census). Same on-demand + sha256 pattern; drawn under
// the country outlines when the widget's "state lines" option is on.
const STATES_URL = process.env.PIAZZA_STATES_URL || 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const STATES_SHA256 = 'd76b391ccfa8bff601d51e3e3da5d43a89fa46cd5caca72ce731b383be5596d0';
const STATES_BYTES = 114554;
const STATES_PATH = dataPath('flightmap-states.json');
let _statesDownloading = false, _statesPromise = null, _statesUnavail = false, _statesRetryAt = 0;
function statesReady() { try { return fs.existsSync(STATES_PATH) && fs.statSync(STATES_PATH).size === STATES_BYTES; } catch { return false; } }
async function ensureStatesBasemap() {
  if (statesReady()) return true;
  if (_statesPromise) return _statesPromise;
  if (!flightmapWanted()) return false;
  if (_statesUnavail && Date.now() < _statesRetryAt) return false;
  _statesPromise = (async () => {
    _statesDownloading = true;
    const tmp = STATES_PATH + `.dl.${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(STATES_PATH), { recursive: true });
      await downloadFile(STATES_URL, tmp, 60000);
      let buf = fs.readFileSync(tmp);
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
      if (crypto.createHash('sha256').update(buf).digest('hex') !== STATES_SHA256) throw new Error('states sha256 mismatch');
      JSON.parse(buf);
      fs.writeFileSync(STATES_PATH, buf);
      _statesUnavail = false;
      console.log('[flightmap] state-lines basemap ready');
      return true;
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      _statesUnavail = true; _statesRetryAt = Date.now() + 60000;
      console.error('[flightmap] state-lines download failed: ' + e.message);
      return false;
    } finally { _statesDownloading = false; _statesPromise = null; }
  })();
  return _statesPromise;
}

function basemapReady() {
  try { return fs.existsSync(BASEMAP_PATH) && fs.statSync(BASEMAP_PATH).size === BASEMAP_RAW_BYTES; }
  catch { return false; }
}
function basemapState() {
  if (basemapReady()) return 'ready';
  if (_basemapDownloading) return 'downloading';
  if (_basemapUnavailable) return 'unavailable';
  return 'idle';
}
function flightmapWanted() {
  return getSetting('flightmap_enabled') === '1' || anyLayoutHasFlightMap();
}
async function ensureBasemap() {
  if (basemapReady()) return true;
  if (_basemapDownloadPromise) return _basemapDownloadPromise;
  if (!flightmapWanted()) return false;
  if (_basemapUnavailable && Date.now() < _basemapNextRetryAt) return false; // cooling off after a failure
  _basemapDownloadPromise = (async () => {
    _basemapDownloading = true;
    const tmp = BASEMAP_PATH + `.download.${process.pid}`;
    const tmpDl = tmp + '.dl';
    try {
      fs.mkdirSync(path.dirname(BASEMAP_PATH), { recursive: true });
      console.log(`[flightmap] downloading basemap (${BASEMAP_VERSION})…`);
      await downloadFile(BASEMAP_URL, tmpDl, 60000);
      let buf = fs.readFileSync(tmpDl);
      // The source may serve the file raw (jsDelivr) or gzipped (a mirror /
      // the test fixture). gzip magic is 1f 8b.
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        if (crypto.createHash('sha256').update(buf).digest('hex') !== BASEMAP_SHA256_GZ)
          throw new Error('basemap .gz sha256 mismatch');
        buf = zlib.gunzipSync(buf);
      }
      if (crypto.createHash('sha256').update(buf).digest('hex') !== BASEMAP_SHA256_RAW)
        throw new Error('basemap sha256 mismatch');
      JSON.parse(buf); // must be valid JSON
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, BASEMAP_PATH);
      fs.rmSync(tmpDl, { force: true });
      _basemapUnavailable = false;
      console.log('[flightmap] basemap ready');
      return true;
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      try { fs.rmSync(tmpDl, { force: true }); } catch {}
      _basemapUnavailable = true;
      _basemapNextRetryAt = Date.now() + 60000;
      console.error('[flightmap] basemap download failed (map unavailable for now): ' + e.message);
      return false;
    } finally {
      _basemapDownloading = false;
      _basemapDownloadPromise = null;
    }
  })();
  return _basemapDownloadPromise;
}
// Self-heal: a flight widget exists but the basemap never landed (offline at
// first use) — retry while it's wanted. Cheap no-op otherwise.
setInterval(() => {
  if (!basemapReady() && !_basemapDownloading && flightmapWanted()) ensureBasemap().catch(() => {});
  if (!statesReady() && !_statesDownloading && flightmapWanted()) ensureStatesBasemap().catch(() => {});
}, 20 * 60 * 1000);

// ── routes ──
function resolveSubjectQueries(qp) {
  const subject = qp.subject || 'filter';
  if (subject === 'flight') {
    const kind = qp.hex ? 'hex' : (qp.reg ? 'reg' : 'callsign');
    const value = qp.hex || qp.reg || qp.callsign || '';
    return value ? [{ kind, value }] : [];
  }
  if (subject === 'watch') {
    let rows = activeFlightWatches();
    if (qp.watchId) rows = rows.filter(r => String(r.id) === String(qp.watchId));
    else if (qp.profileId) rows = rows.filter(r => String(r.profile_id) === String(qp.profileId));
    return rows.map(watchToQuery);
  }
  // filter
  if (qp.mil === '1' || qp.mil === 'true') return [{ kind: 'mil' }];
  if (qp.type) return flightTypeList(qp.type).map(t => ({ kind: 'type', value: t }));
  if (qp.squawk) return [{ kind: 'squawk', value: qp.squawk }];
  if (qp.radiusNm && qp.lat && qp.lon)
    return [{ kind: 'point', lat: Number(qp.lat), lon: Number(qp.lon), radiusNm: Number(qp.radiusNm) }];
  return [];
}

app.get('/api/flightmap/state', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const queries = resolveSubjectQueries(req.query).filter(flightQueryValid);
  if (!queries.length) return res.json({ aircraft: [], fetchedAt: 0, source: null, degraded: false, trailSeed: {}, note: 'no subject configured' });
  const byHex = new Map();
  let fetchedAt = 0, source = null, degraded = false;
  const maxAge = flightPollSeconds() * 1000;
  for (const q of queries) {
    const key = flightQueryKey(q);
    let entry = _flightState.get(key);
    if (!entry || Date.now() - entry.fetchedAt > maxAge) {
      try {
        const r = await flightFetch(q);
        if (!r.degraded) {
          entry = { query: q, fetchedAt: Date.now(), source: r.source, aircraft: r.aircraft, degraded: false };
          _flightState.set(key, entry);
          recordFlightPositions(r.aircraft);
        } else if (!entry) {
          degraded = true;
          continue;
        } else {
          entry.degraded = true;
        }
      } catch { if (!entry) { degraded = true; continue; } }
    }
    if (!entry) continue;
    fetchedAt = Math.max(fetchedAt, entry.fetchedAt);
    source = source || entry.source;
    if (entry.degraded) degraded = true;
    for (const a of entry.aircraft) byHex.set(a.hex, a);
  }
  let aircraft = [...byHex.values()];
  // "military only" — drop civil aircraft that happen to share an ICAO type
  // (e.g. civil aircraft that happen to share an ICAO type with a military variant).
  if (req.query.milOnly === '1' || req.query.milOnly === 'true') aircraft = aircraft.filter(a => a.mil);
  // callsign-prefix filter — "all United / Delta / …" (ICAO prefixes like
  // UAL, DAL). The ADS-B feed has no operator query, so this filters a
  // point/area result down by callsign.
  const csPfx = String(req.query.callsignPrefix || '').toUpperCase().split(/[\s,]+/).map(s => s.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  if (csPfx.length) {
    aircraft = aircraft.filter(a => { const c = (a.callsign || '').toUpperCase(); return csPfx.some(p => c.startsWith(p)); });
  }
  // route / aircraft-type enrichment (adsbdb) — block briefly for a small
  // followed set so the first render has the route; big lists fill in later.
  try { await enrichAircraft(aircraft, true); } catch {}
  // trail seed: last N minutes of positions for each aircraft shown — the
  // widget's own fmTrailMin (?trailMin=) wins over the household default.
  const trailMin = clampTrailMin(req.query.trailMin, flightTrailMinutes());
  const since = Math.floor(Date.now() / 1000) - trailMin * 60;
  const trailSeed = {};
  const trailStmt = db.prepare(`SELECT ts, lat, lon, alt_ft FROM flight_positions WHERE hex = ? AND ts >= ? ORDER BY ts`);
  for (const a of aircraft) {
    const rows = trailStmt.all(a.hex, since);
    if (rows.length > 1) trailSeed[a.hex] = rows.map(r => [r.ts, r.lat, r.lon, r.alt_ft]);
  }
  res.json({ aircraft, fetchedAt, source, degraded, trailSeed });
});

app.get('/api/flightmap/trail/:hex', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const hex = String(req.params.hex || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 8);
  if (!hex) return res.json([]);
  const mins = clampTrailMin(req.query.minutes, flightTrailMinutes());
  const since = Math.floor(Date.now() / 1000) - mins * 60;
  res.json(db.prepare(`SELECT ts, lat, lon, alt_ft FROM flight_positions WHERE hex = ? AND ts >= ? ORDER BY ts`).all(hex, since));
});

app.get('/api/flightmap/basemap', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (flightmapWanted()) {
    if (!basemapReady() && !_basemapDownloading) ensureBasemap().catch(() => {});
    if (!statesReady() && !_statesDownloading) ensureStatesBasemap().catch(() => {});
  }
  res.json({ state: basemapState(), version: BASEMAP_VERSION, states: statesReady() });
});
app.get('/api/flightmap/basemap.json', (req, res) => {
  if (basemapReady()) {
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    return res.sendFile(BASEMAP_PATH);
  }
  if (flightmapWanted()) ensureBasemap().catch(() => {});
  res.status(503).json({ state: basemapState() });
});
app.get('/api/flightmap/states.json', (req, res) => {
  if (statesReady()) {
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    return res.sendFile(STATES_PATH);
  }
  if (flightmapWanted()) ensureStatesBasemap().catch(() => {});
  res.status(503).json({ ready: false });
});

// flight_watch CRUD. slaveWriteGuard proxies the mutating verbs to the host
// automatically (not in its local-only allowlist); GET is answered locally
// off the synced table.
app.get('/api/flight-watch', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(db.prepare(`SELECT * FROM flight_watch ORDER BY COALESCE(profile_id, -1), id`).all());
});
const FW_KINDS = new Set(['callsign', 'reg', 'hex']);
const FW_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function cleanWatchBody(b) {
  const kind = FW_KINDS.has(b.kind) ? b.kind : 'callsign';
  let value = String(b.value || '').trim().toUpperCase();
  if (kind === 'hex') value = value.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 8);
  else value = value.replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  const label = String(b.label || '').trim().slice(0, 60);
  const profileId = coerceOwnerProfileId(b.profile_id);
  const af = FW_DATE_RE.test(b.active_from || '') ? b.active_from : null;
  const at = FW_DATE_RE.test(b.active_to || '') ? b.active_to : null;
  return { kind, value, label, profileId, af, at };
}
app.post('/api/flight-watch', (req, res) => {
  const c = cleanWatchBody(req.body || {});
  if (!c.value) return res.status(400).json({ error: 'value is required (a callsign, registration or hex)' });
  const r = db.prepare(`INSERT INTO flight_watch (profile_id, kind, value, label, active_from, active_to) VALUES (?,?,?,?,?,?)`)
    .run(c.profileId, c.kind, c.value, c.label, c.af, c.at);
  broadcastUpdate('flight_watch');
  startFlightPolling(); // pick the new subject up now, not next tick
  res.status(201).json(db.prepare(`SELECT * FROM flight_watch WHERE id = ?`).get(r.lastInsertRowid));
});
app.put('/api/flight-watch/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM flight_watch WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const c = cleanWatchBody({ ...existing, ...req.body });
  if (!c.value) return res.status(400).json({ error: 'value cannot be empty' });
  db.prepare(`UPDATE flight_watch SET profile_id=?, kind=?, value=?, label=?, active_from=?, active_to=? WHERE id=?`)
    .run(c.profileId, c.kind, c.value, c.label, c.af, c.at, existing.id);
  broadcastUpdate('flight_watch');
  res.json(db.prepare(`SELECT * FROM flight_watch WHERE id = ?`).get(existing.id));
});
app.delete('/api/flight-watch/:id', (req, res) => {
  const r = db.prepare(`DELETE FROM flight_watch WHERE id = ?`).run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  broadcastUpdate('flight_watch');
  res.json({ ok: true });
});

// ── Settings API ─────────────────────────────────────────────────────────────

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
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
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
  'tour_completed',      // per-device: whether THIS screen's spotlight tour has run
  'checklist_done', 'checklist_dismissed',  // per-device: getting-started checklist state
  'sync_interval_min', 'last_sync_at', 'last_sync_status',
  'briefing_last_sent',  // per-device: the host tracks its own send; never sync this
                         // or a slave's value could suppress the host's daily send
  'display_res_w', 'display_res_h', 'display_refresh_min',
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
                    p.startsWith('/api/auth');          // local login/PIN
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
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
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
// US Postal abbreviations for the 50 states + DC, used to turn a full state name
// (as returned by Nominatim) into the compact "ST" people expect next to a city,
// e.g. "Columbus, OH" rather than "Columbus, Ohio".
const US_STATE_ABBR = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO',
  'Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID',
  'Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA',
  'Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS',
  'Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ',
  'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',
  'Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA',
  'West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','District of Columbia':'DC',
};

// Builds a clean location label from Nominatim's structured address breakdown
// (addressdetails=1) rather than string-splitting display_name, which varies in
// field count/order depending on how rural/urban the area is.
// US addresses: "City, ST" (state abbreviated), matching the original format.
// Non-US addresses: "City, Region, Country" when a state/region-level field is
// available, else "City, Country" — since a bare city or county name alone can
// be genuinely ambiguous worldwide (there are many towns sharing a name across
// countries) in a way "City, ST" already isn't for a US audience.
function buildLocationLabel(address) {
  if (!address) return '';
  const city = address.city || address.town || address.village || address.hamlet || address.county || '';
  const state = address.state || '';
  const country = address.country || '';
  const isUS = address.country_code === 'us';
  if (isUS) {
    const stateAbbr = US_STATE_ABBR[state] || state;
    if (city && stateAbbr) return `${city}, ${stateAbbr}`;
    return city || stateAbbr || '';
  }
  const parts = [city, state, country].filter(Boolean);
  // Avoid an awkward "City, City" when Nominatim's state-level field just
  // repeats the city/county name (common for city-states and some regions).
  return [...new Set(parts)].join(', ');
}

// Single Nominatim postal-code search, returning the parsed results array
// (empty if none). Shared by resolveGeoCandidates below.
function nominatimPostalSearch(zip, countryCode) {
  const countryParam = countryCode ? `&country=${countryCode}` : '';
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}${countryParam}&format=json&addressdetails=1&limit=1`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PiazzaHQ/1.0' } }, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse geocoding response')); }
      });
    }).on('error', reject);
  });
}

// Queries a US-scoped search and an unrestricted worldwide search in
// parallel and returns however many DISTINCT places they point to (1 or 2).
//
// A country=US-only restriction was the original bug (a UK postcode simply
// couldn't resolve at all). Removing the country filter entirely turned out
// to be its own regression: plenty of postal-code FORMATS overlap across
// countries — a plain 5-digit code exists in the US, but also in places
// like Lithuania or Germany — and Nominatim doesn't rank "your household's
// own country" any higher than any other match, so a real US ZIP like
// 67228 could resolve to Lithuania instead of Kansas.
//
// Rather than guessing which one the household actually meant (whether by
// hardcoding US-only again, or by trusting whichever the worldwide search
// ranks first), this returns both when they genuinely disagree, so the
// caller can ask instead of guess. When there's no real ambiguity — the
// worldwide search either agrees with the US result or comes up empty
// entirely, which is the common case for both an ordinary US ZIP and for a
// non-US postal code like a UK postcode (no US match to conflict with) —
// this quietly returns just the one real match, same as before.
async function resolveGeoCandidates(zip) {
  const [usResults, worldResults] = await Promise.all([
    nominatimPostalSearch(zip, 'US'),
    nominatimPostalSearch(zip, null),
  ]);
  const us = usResults[0] || null;
  const world = worldResults[0] || null;
  if (!us) return world ? [world] : [];
  if (!world) return [us];
  const sameLat = Math.abs(parseFloat(us.lat) - parseFloat(world.lat)) < 0.05;
  const sameLon = Math.abs(parseFloat(us.lon) - parseFloat(world.lon)) < 0.05;
  return (sameLat && sameLon) ? [us] : [us, world];
}

function geoResultToCandidate(r) {
  const label = buildLocationLabel(r.address) || r.display_name;
  return { lat: r.lat, lon: r.lon, display_name: r.display_name, label, location_label: label };
}

app.get('/api/geocode', async (req, res) => {
  const { zip } = req.query;
  // When save=0, geocode WITHOUT touching the global weather location. Used by the
  // per-widget location override so looking up a vacation-home ZIP doesn't change
  // the whole device's default location.
  const save = req.query.save !== '0';
  if (!zip) return res.status(400).json({ error: 'zip required' });

  let candidates;
  try { candidates = await resolveGeoCandidates(zip); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  if (!candidates.length) return res.status(404).json({ error: 'ZIP/postal code not found' });

  // Genuinely ambiguous (e.g. 67228 matching both Kansas and Lithuania) —
  // don't save anything yet, let the caller ask the person which one is
  // theirs and re-request with an explicit choice.
  if (candidates.length > 1) {
    return res.json({ ambiguous: true, candidates: candidates.map(geoResultToCandidate) });
  }

  const { lat, lon, display_name, address } = candidates[0];
  const locationLabel = buildLocationLabel(address);
  if (save) {
    const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      upsert.run('weather_lat', lat);
      upsert.run('weather_lon', lon);
      upsert.run('weather_zip', zip);
      upsert.run('weather_location_auto', locationLabel);
    })();
  }
  // Return both label keys so either caller style works.
  res.json({ lat, lon, display_name, location_label: locationLabel, label: locationLabel });
});

// Free-text place search (city / airport / landmark / ZIP) → lat/lon + label.
// Read-only: unlike /api/geocode this never touches the device's saved weather
// location. Used by widgets that let you centre a map on a searched place.
app.get('/api/place-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'A search term is required.' });
  try {
    const r = await geocodeAddress(q);
    res.json({ lat: r.lat, lon: r.lon, label: r.label });
  } catch (e) {
    res.status(404).json({ error: (e && e.message) || 'Place not found' });
  }
});

// ── Weather proxy (Open-Meteo, free, no API key) ─────────────────────────────
// Short WMO weather-code descriptions for the email (display.html has its own copy).
const WMO_DESC = {
  0:'Clear', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
  45:'Fog', 48:'Rime fog', 51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
  56:'Freezing drizzle', 57:'Freezing drizzle', 61:'Light rain', 63:'Rain', 65:'Heavy rain',
  66:'Freezing rain', 67:'Freezing rain', 71:'Light snow', 73:'Snow', 75:'Heavy snow',
  77:'Snow grains', 80:'Light showers', 81:'Showers', 82:'Heavy showers',
  85:'Snow showers', 86:'Snow showers', 95:'Thunderstorm', 96:'Thunderstorm', 99:'Thunderstorm',
};

// Weather is always fetched and cached in Fahrenheit — Fahrenheit/Celsius is
// a display-time choice everywhere it's shown, including here in the daily
// briefing email, so this mirrors display.html's own formatTemp() exactly
// rather than re-fetching from Open-Meteo per unit. Returns a bare "NN°"
// (no unit letter) to match the email's existing styling, which states the
// unit once at the headline rather than repeating it on every value.
function emailFormatTemp(fahrenheit) {
  if (fahrenheit == null || isNaN(fahrenheit)) return '--';
  const unit = getSetting('weather_unit');
  const val = unit === 'celsius' ? (fahrenheit - 32) * 5 / 9 : fahrenheit;
  return `${Math.round(val)}°`;
}
function emailTempUnitLabel() {
  return getSetting('weather_unit') === 'celsius' ? 'C' : 'F';
}
function getWeather(lat, lon) {
  return new Promise((resolve, reject) => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,is_day` +
      `&hourly=temperature_2m,weather_code,precipitation_probability,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=16&timezone=auto`;
    const req = https.get(url, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse weather data')); }
      });
    });
    req.on('error', reject);
    // See httpGetJSON's comment above for why this matters — a stalled
    // (not outright failed) request would otherwise hang forever with no
    // error, same bug class, same fix.
    req.setTimeout(10000, () => req.destroy(new Error('Timed out fetching Open-Meteo weather')));
  });
}

// Maps an OpenWeatherMap condition id (https://openweathermap.org/weather-conditions)
// to the WMO weather code our icons/descriptions use, so OWM data renders identically
// to Open-Meteo data downstream.
function owmToWmo(id) {
  if (id >= 200 && id < 300) return 95;            // thunderstorm
  if (id >= 300 && id < 400) return 51;            // drizzle
  if (id >= 500 && id < 505) return 61;            // rain
  if (id === 511) return 67;                       // freezing rain
  if (id >= 520 && id < 532) return 80;            // rain showers
  if (id >= 600 && id < 700) return 71;            // snow
  if (id >= 700 && id < 800) return 45;            // atmosphere (fog/mist)
  if (id === 800) return 0;                        // clear
  if (id === 801) return 1;                        // mainly clear
  if (id === 802) return 2;                        // partly cloudy
  if (id >= 803) return 3;                         // overcast
  return 3;
}
// Fetches from OpenWeatherMap (One Call 3.0) and normalizes to the Open-Meteo shape
// the rest of the app expects. Requires the user's own API key.
function getWeatherOWM(lat, lon, apiKey) {
  return new Promise((resolve, reject) => {
    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}` +
      `&units=imperial&exclude=minutely,alerts&appid=${encodeURIComponent(apiKey)}`;
    const req = https.get(url, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.cod && String(j.cod) !== '200') return reject(new Error(j.message || 'OpenWeatherMap error'));
          const cur = j.current || {};
          const hours = (j.hourly || []).slice(0, 48);
          const days = (j.daily || []).slice(0, 16);
          const iso = t => new Date(t * 1000).toISOString().slice(0, 16);
          const isoDate = t => new Date(t * 1000).toISOString().slice(0, 10);
          resolve({
            current: {
              temperature_2m: cur.temp,
              weather_code: owmToWmo(cur.weather?.[0]?.id ?? 800),
              wind_speed_10m: cur.wind_speed,
              is_day: (cur.dt >= cur.sunrise && cur.dt < cur.sunset) ? 1 : 0,
            },
            hourly: {
              time: hours.map(h => iso(h.dt)),
              temperature_2m: hours.map(h => h.temp),
              weather_code: hours.map(h => owmToWmo(h.weather?.[0]?.id ?? 800)),
              precipitation_probability: hours.map(h => Math.round((h.pop || 0) * 100)),
              is_day: hours.map(h => (h.dt >= (j.current?.sunrise||0) && h.dt < (j.current?.sunset||0)) ? 1 : 0),
            },
            daily: {
              time: days.map(d => isoDate(d.dt)),
              weather_code: days.map(d => owmToWmo(d.weather?.[0]?.id ?? 800)),
              temperature_2m_max: days.map(d => d.temp?.max),
              temperature_2m_min: days.map(d => d.temp?.min),
              precipitation_probability_max: days.map(d => Math.round((d.pop || 0) * 100)),
              sunrise: days.map(d => iso(d.sunrise)),
              sunset: days.map(d => iso(d.sunset)),
            },
            _provider: 'openweathermap',
          });
        } catch (e) { reject(new Error('Failed to parse OpenWeatherMap data')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Timed out fetching OpenWeatherMap weather')));
  });
}

// Provider-aware weather fetch used by both the API and the email briefing, so they
// Maps a National Weather Service short forecast text (e.g. "Partly Sunny",
// "Chance Showers And Thunderstorms") to our WMO code. NWS uses prose, not codes,
// so we keyword-match — ordered from most to least specific.
function nwsTextToWmo(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('thunder')) return 95;
  if (t.includes('freezing')) return 67;
  if (t.includes('sleet') || t.includes('ice')) return 67;
  if (t.includes('snow') || t.includes('flurr') || t.includes('blizzard')) return 71;
  if (t.includes('showers') || t.includes('rain shower')) return 80;
  if (t.includes('rain') || t.includes('drizzle')) return 61;
  if (t.includes('fog') || t.includes('haze') || t.includes('mist')) return 45;
  if (t.includes('partly') || t.includes('mostly sunny') || t.includes('mostly clear')) return 2;
  if (t.includes('mostly cloudy') || t.includes('considerable cloud')) return 3;
  if (t.includes('cloud')) return 3;
  if (t.includes('sunny') || t.includes('clear') || t.includes('fair')) return 0;
  return 2;
}
// Small JSON GET helper that sends the User-Agent NWS requires.
// Real, confirmed bug fixed here: without an explicit timeout, a request
// that stalls (NWS's servers momentarily hanging, a network blip — anything
// short of an outright connection error) never resolves AND never rejects.
// No error, no console output, nothing — https.get()'s own 'error' event
// only fires for actual connection failures, not for a server that accepted
// the connection and then just never finishes responding. That leaves every
// weather widget across every device permanently stuck on "Loading
// weather…" until the server process itself is restarted, since nothing
// ever times out to let the normal per-poll retry take over.
function httpGetJSON(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PiazzaHQ/1.0 (family calendar display)', 'Accept': 'application/geo+json' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return httpGetJSON(r.headers.location, timeoutMs).then(resolve, reject);
      }
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad JSON from ' + url)); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out after ${timeoutMs}ms: ${url}`)));
  });
}
// Fetches from the US National Weather Service (weather.gov) and normalizes to the
// Open-Meteo shape. Keyless, but US-only. Two-step: points -> gridpoint forecast.
async function getWeatherNWS(lat, lon) {
  const pts = await httpGetJSON(`https://api.weather.gov/points/${(+lat).toFixed(4)},${(+lon).toFixed(4)}`);
  const props = pts && pts.properties;
  if (!props || !props.forecast) throw new Error('NWS: no forecast for this location (US-only)');

  const [daily, hourly] = await Promise.all([
    httpGetJSON(props.forecast),
    httpGetJSON(props.forecastHourly).catch(() => null),
  ]);
  const periods = (daily.properties && daily.properties.periods) || [];
  if (!periods.length) throw new Error('NWS: empty forecast');

  // Current conditions: first hourly period if available, else first daily period.
  const hp = hourly && hourly.properties && hourly.properties.periods || [];
  const nowP = hp[0] || periods[0];
  const current = {
    temperature_2m: nowP.temperature,
    weather_code: nwsTextToWmo(nowP.shortForecast),
    wind_speed_10m: parseInt((nowP.windSpeed || '0').replace(/[^0-9]/g, '')) || 0,
    is_day: nowP.isDaytime ? 1 : 0,
  };
  // Hourly arrays (next 48h) for the hourly widget.
  const hSlice = hp.slice(0, 48);
  const hourlyOut = {
    time: hSlice.map(p => (p.startTime || '').slice(0, 16)),
    temperature_2m: hSlice.map(p => p.temperature),
    weather_code: hSlice.map(p => nwsTextToWmo(p.shortForecast)),
    precipitation_probability: hSlice.map(p => (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value) || 0),
    is_day: hSlice.map(p => p.isDaytime ? 1 : 0),
  };
  // Daily: NWS splits into day & night periods. Fold into per-date hi/lo.
  const byDate = {};
  for (const p of periods) {
    const date = (p.startTime || '').slice(0, 10);
    if (!byDate[date]) byDate[date] = { code: nwsTextToWmo(p.shortForecast), hi: null, lo: null, pop: 0 };
    const temp = p.temperature;
    if (p.isDaytime) { byDate[date].hi = temp; byDate[date].code = nwsTextToWmo(p.shortForecast); }
    else { byDate[date].lo = temp; }
    const pop = (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value) || 0;
    if (pop > byDate[date].pop) byDate[date].pop = pop;
  }
  const dates = Object.keys(byDate).sort();
  // Today's bucket is the one date where hi or lo can legitimately be missing
  // — not because the data doesn't exist, but because NWS periods are
  // forward-looking from "now": once "Today" has elapsed, only "Tonight"
  // remains for today's date (hi stays null); early in the morning, before
  // "Tonight" has arrived yet, only "Today" exists (lo stays null). The
  // naive fallback above (used for every other, fully-populated future date)
  // collapses hi and lo to that single remaining value, contradicting the
  // live current reading — e.g. showing today's high as tonight's 75° low
  // while current conditions read 96°. Correct today's bucket using the
  // current reading itself, which is real evidence of at least that
  // temperature having actually occurred today.
  const todayDate = dates[0];
  if (todayDate && byDate[todayDate]) {
    const t = byDate[todayDate];
    if (t.hi == null && t.lo != null) t.hi = Math.max(t.lo, current.temperature_2m);
    else if (t.lo == null && t.hi != null) t.lo = Math.min(t.hi, current.temperature_2m);
  }
  const dailyOut = {
    time: dates,
    weather_code: dates.map(d => byDate[d].code),
    temperature_2m_max: dates.map(d => byDate[d].hi != null ? byDate[d].hi : byDate[d].lo),
    temperature_2m_min: dates.map(d => byDate[d].lo != null ? byDate[d].lo : byDate[d].hi),
    precipitation_probability_max: dates.map(d => byDate[d].pop),
    sunrise: dates.map(() => ''), // NWS doesn't provide sunrise/sunset here
    sunset: dates.map(() => ''),
  };
  return { current, hourly: hourlyOut, daily: dailyOut, _provider: 'nws' };
}

// ── Sunrise/sunset-based day/night, shared across all providers ─────────────
// Open-Meteo and OpenWeatherMap each report their own is_day, computed from
// their own real astronomical data — generally trustworthy. NWS has no
// sunrise/sunset of its own at all and derives is_day from whichever forecast
// period's text happens to be "current", which is exactly the same
// elapsed-period lag that caused the hi/lo bug above. Rather than have three
// different trust boundaries for the same day/night fact (one of which has a
// known bug), compute it ourselves the same way for every provider, so the
// icon can never disagree with an actual sunset regardless of source.
// Standard sunrise/sunset equation (Almanac for Computers, 1990).
//
// CORRECTED: an earlier version of this comment claimed the UTC-day-boundary
// effect below was "imperceptible, off by less than a day" — that was wrong,
// and understated a real, serious bug. For any longitude west of Greenwich
// (i.e. the entire US), local evening sunset genuinely lands on the
// FOLLOWING UTC calendar day. The raw algorithm returns just an hour-of-day
// in [0,24) with no indication of which UTC date that belongs to, so a plain
// `base + sunsetUT` anchored to the same UTC day as sunrise placed sunset
// BEFORE sunrise numerically — making `is_day` false for essentially the
// entire actual daytime, every single day, for any US location. Not a rare
// edge case; this was the actual cause of the moon-during-daylight bug,
// which had never actually been exercised before beta.7 (a separate crash
// in trackTodayExtreme was throwing first every time, so this line never
// even ran until that crash was fixed). Verified now with a continuous
// 72-hour sweep across multiple longitudes/hemispheres (Denver, Tokyo,
// London, Sydney) — exactly one flip to day and one to night per real 24h
// period, everywhere tested.
function computeSunTimes(lat, lon, when) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const dayOfYear = Math.floor((when.getTime() - Date.UTC(when.getUTCFullYear(), 0, 0)) / 86400000);
  const lngHour = lon / 15;
  function calc(isSunrise) {
    const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const M = (0.9856 * t) - 3.289;
    let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
    L = ((L % 360) + 360) % 360;
    let RA = deg * Math.atan(0.91764 * Math.tan(L * rad));
    RA = ((RA % 360) + 360) % 360;
    RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null; // sun never rises/sets today at this latitude (polar)
    let H = isSunrise ? 360 - deg * Math.acos(cosH) : deg * Math.acos(cosH);
    H /= 15;
    return (((H + RA - (0.06571 * t) - 6.622) - lngHour) % 24 + 24) % 24; // hour-of-day, UTC, in [0,24)
  }
  const sunriseUT = calc(true), sunsetUT = calc(false);
  if (sunriseUT == null || sunsetUT == null) return null;
  const base = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
  // If sunset's hour-of-day comes out numerically earlier than sunrise's, that's
  // the wraparound signature described above — it actually belongs to the
  // following UTC calendar day. Push it forward a day to correct it.
  const sunsetDayOffset = (sunsetUT < sunriseUT) ? 1 : 0;
  return {
    sunrise: new Date(base + sunriseUT * 3600000),
    sunset: new Date(base + (sunsetDayOffset * 24 + sunsetUT) * 3600000),
  };
}
function isDaytimeAt(lat, lon, when) {
  const sun = computeSunTimes(lat, lon, when);
  // Polar day/night edge case (sun never rises or sets): fall back to a
  // plain clock-hour guess rather than returning nothing.
  if (!sun) return when.getUTCHours() >= 6 && when.getUTCHours() < 19 ? 1 : 0;
  return (when >= sun.sunrise && when < sun.sunset) ? 1 : 0;
}

// Tracks the actual peak/trough current-conditions reading seen *today* per
// location. Used as the fallback whenever a provider is missing today's
// forecasted high/low (NWS, once a period has elapsed — see above) instead
// of the instantaneous current reading. Using the instant reading was the
// bug: as the evening cools off, current keeps dropping, so a "today's high"
// recomputed fresh from current on every poll ticks down right along with
// it. The running peak only ever moves toward the true high actually
// reached, and only resets when the calendar date changes. In-memory only —
// a server restart just starts re-accumulating from that point, which is a
// fine tradeoff since this is purely a fallback value, never the primary
// forecasted number.
const _todayExtremes = new Map(); // "YYYY-MM-DD|lat|lon" -> { hi, lo }
function trackTodayExtreme(lat, lon, temp) {
  if (temp == null) return null;
  const dateKey = new Date().toISOString().slice(0, 10);
  // Defensive coercion here too, not just at getWeatherResolved's entry
  // point — this is exactly the mistake that caused the beta.4 bug
  // (called with a string lat/lon, .toFixed() threw). Cheap insurance
  // against a future caller making the same assumption mistake again.
  const key = `${dateKey}|${(+lat).toFixed(2)}|${(+lon).toFixed(2)}`;
  for (const k of _todayExtremes.keys()) if (!k.startsWith(dateKey)) _todayExtremes.delete(k); // drop stale days
  let e = _todayExtremes.get(key);
  if (!e) { e = { hi: temp, lo: temp }; _todayExtremes.set(key, e); }
  else { if (temp > e.hi) e.hi = temp; if (temp < e.lo) e.lo = temp; }
  return e;
}

// Runs on every provider's normalized output before it reaches the rest of
// the app, so both reported bugs are corrected regardless of which provider
// is active:
//   1. Today's hi/lo can never sit below/above the peak/trough actually
//      observed today — backstops the NWS elapsed-period bug fixed above
//      (using the tracked peak rather than the instant reading, so it
//      doesn't tick down as the evening cools), and guards the same class
//      of issue for Open-Meteo/OpenWeatherMap even without a confirmed bug
//      there, since it's a cheap, safe invariant to enforce regardless of
//      source.
//   2. is_day is recomputed from real sunrise/sunset for this exact moment,
//      not trusted from the provider — the actual fix for NWS's moon-during-
//      daylight bug. This intentionally overrides Open-Meteo/OWM's own
//      (already-accurate) is_day too, trading their minute-or-two-better
//      precision for one shared, already-debugged code path instead of three
//      separate ones.
function reconcileWeatherToday(w, lat, lon) {
  if (!w) return w;
  if (w.current && w.current.temperature_2m != null) {
    const ext = trackTodayExtreme(lat, lon, w.current.temperature_2m);
    if (ext && w.daily && w.daily.temperature_2m_max && w.daily.temperature_2m_max.length) {
      if (w.daily.temperature_2m_max[0] != null && ext.hi > w.daily.temperature_2m_max[0]) w.daily.temperature_2m_max[0] = ext.hi;
      if (w.daily.temperature_2m_min[0] != null && ext.lo < w.daily.temperature_2m_min[0]) w.daily.temperature_2m_min[0] = ext.lo;
    }
  }
  if (w.current) w.current.is_day = isDaytimeAt(lat, lon, new Date());
  return w;
}

// always agree on the source. Falls back to keyless Open-Meteo on any failure.
async function getWeatherResolved(lat, lon) {
  // lat/lon arrive as strings from every real caller (Express req.query,
  // the SQLite settings fallback) — coerced to real numbers once here so
  // every downstream function can rely on that without each having to
  // defensively re-coerce itself. getWeatherNWS() already knew to guard
  // against this (`(+lat).toFixed(4)`); reconcileWeatherToday()'s
  // trackTodayExtreme() did NOT, and its plain `lat.toFixed(2)` threw
  // immediately on a string — a real, confirmed bug that silently broke
  // weather for every widget (see beta.6 HANDOFF entry for the full
  // failure chain).
  lat = Number(lat);
  lon = Number(lon);
  const provider = getSetting('weather_provider') || 'open-meteo';
  const apiKey = getSetting('weather_api_key') || '';
  let w;
  if (provider === 'openweathermap' && apiKey) {
    try { w = await getWeatherOWM(lat, lon, apiKey); }
    catch (e) { console.warn('OWM failed, using Open-Meteo:', e.message); w = await getWeather(lat, lon); }
  } else if (provider === 'nws') {
    try { w = await getWeatherNWS(lat, lon); }
    catch (e) { console.warn('NWS failed, using Open-Meteo:', e.message); w = await getWeather(lat, lon); }
  } else {
    w = await getWeather(lat, lon);
  }
  return reconcileWeatherToday(w, lat, lon);
}

// ── Weather Radar (RainViewer, free, no API key — see radar widget) ─────────
// RainViewer's own weather-maps.json is tiny (a frame list, not imagery) but
// we still proxy it server-side rather than having the display fetch it
// directly, for the same reason /api/weather and /api/air-quality are
// proxied: keeps the display's outbound dependency list to "this server"
// only, and lets the server apply its own short cache/retry behavior later
// if RainViewer has a bad moment. The actual tile IMAGES (many, especially
// while animating) are NOT proxied — those load directly from RainViewer's
// tile CDN in the browser via Leaflet, same as any other tile-based map;
// proxying binary tile traffic through this server would add real bandwidth
// and CPU cost for no real benefit, and every other tile-map integration
// (including RainViewer's own official examples) fetches tiles client-side.
let radarFramesCache = null;
let radarFramesCacheAt = 0;
function getRadarFrames() {
  const now = Date.now();
  if (radarFramesCache && (now - radarFramesCacheAt) < 2 * 60 * 1000) {
    return Promise.resolve(radarFramesCache);
  }
  return new Promise((resolve, reject) => {
    https.get('https://api.rainviewer.com/public/weather-maps.json', (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // 'past' is up to the last 2 hours of OBSERVED radar (10-min steps)
          // — that 2-hour window is RainViewer's own hard ceiling for this
          // free tier, not a limit set here. 'nowcast', when present, is a
          // short-term (roughly 30–60 min) EXTRAPOLATION forward from now,
          // not a full weather-model forecast — tagged separately so the
          // client can label it differently if it wants to, rather than
          // presenting it as equally-measured data.
          const past = (parsed.radar && parsed.radar.past) || [];
          const nowcast = (parsed.radar && parsed.radar.nowcast) || [];
          const frames = [
            ...past.map(f => ({ time: f.time, path: f.path, kind: 'observed' })),
            ...nowcast.map(f => ({ time: f.time, path: f.path, kind: 'forecast' })),
          ];
          const result = { host: parsed.host, frames };
          radarFramesCache = result;
          radarFramesCacheAt = now;
          resolve(result);
        } catch { reject(new Error('Failed to parse RainViewer data')); }
      });
    }).on('error', reject);
  });
}
app.get('/api/radar-frames', async (req, res) => {
  try {
    const data = await getRadarFrames();
    if (!data.frames.length) return res.status(502).json({ error: 'No radar frames available right now' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/weather', async (req, res) => {
  // Accept lat/lon directly or look up from saved settings
  let lat = req.query.lat;
  let lon = req.query.lon;
  if (!lat || !lon) {
    const latRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lat'`).get();
    const lonRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lon'`).get();
    lat = latRow?.value; lon = lonRow?.value;
  }
  if (!lat || !lon) return res.status(400).json({ error: 'No location set — enter a ZIP code in Settings' });
  try {
    res.json(await getWeatherResolved(lat, lon));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Air Quality / Pollen / UV proxy (Open-Meteo, free, no API key) ───────────
// Reuses the same lat/lon already saved for Weather — no separate location setup.
function getAirQuality(lat, lon) {
  return new Promise((resolve, reject) => {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=us_aqi,pm2_5,pm10,uv_index` +
      `&hourly=grass_pollen,birch_pollen,ragweed_pollen` +
      `&timezone=auto&forecast_days=1`;
    https.get(url, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse air quality data')); }
      });
    }).on('error', reject);
  });
}
function aqiCategory(aqi) {
  if (aqi == null) return { label: 'Unknown', color: '#9aa6c0' };
  if (aqi <= 50)  return { label: 'Good', color: '#3ec97a' };
  if (aqi <= 100) return { label: 'Moderate', color: '#ffd454' };
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#f4845f' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#fb7185' };
  if (aqi <= 300) return { label: 'Very Unhealthy', color: '#a78bfa' };
  return { label: 'Hazardous', color: '#7c2d12' };
}
function uvCategory(uv) {
  if (uv == null) return { label: 'Unknown', color: '#9aa6c0' };
  if (uv < 3)  return { label: 'Low', color: '#3ec97a' };
  if (uv < 6)  return { label: 'Moderate', color: '#ffd454' };
  if (uv < 8)  return { label: 'High', color: '#f4845f' };
  if (uv < 11) return { label: 'Very High', color: '#fb7185' };
  return { label: 'Extreme', color: '#a78bfa' };
}
app.get('/api/air-quality', async (req, res) => {
  let lat = req.query.lat, lon = req.query.lon;
  if (!lat || !lon) {
    const latRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lat'`).get();
    const lonRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lon'`).get();
    lat = latRow?.value; lon = lonRow?.value;
  }
  if (!lat || !lon) return res.status(400).json({ error: 'No location set — enter a ZIP code in Settings → Weather' });
  try {
    const data = await getAirQuality(lat, lon);
    const cur = data.current || {};
    const aqi = (cur.us_aqi != null) ? Math.round(cur.us_aqi) : null;
    const uv = (cur.uv_index != null) ? Math.round(cur.uv_index * 10) / 10 : null;
    // Pollen is only ever populated by Open-Meteo for European locations on the free
    // tier — null/undefined elsewhere is expected, not a failure. Pick the hourly
    // slot matching the current local hour (timezone=auto means hourly.time is
    // already local, so this doesn't need the server's own timezone_override).
    let pollen = { grass: null, birch: null, ragweed: null };
    if (data.hourly && Array.isArray(data.hourly.time)) {
      const now = new Date();
      const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`;
      let idx = data.hourly.time.indexOf(nowKey);
      if (idx === -1) idx = 0;
      pollen = {
        grass: data.hourly.grass_pollen ? data.hourly.grass_pollen[idx] ?? null : null,
        birch: data.hourly.birch_pollen ? data.hourly.birch_pollen[idx] ?? null : null,
        ragweed: data.hourly.ragweed_pollen ? data.hourly.ragweed_pollen[idx] ?? null : null,
      };
    }
    res.json({
      aqi, aqiInfo: aqiCategory(aqi),
      pm2_5: cur.pm2_5 ?? null, pm10: cur.pm10 ?? null,
      uv, uvInfo: uvCategory(uv),
      pollen,
      updated: cur.time || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Travel Time widget ────────────────────────────────────────────────────────
// Free-text address -> lat/lon, cached briefly since the same origin/destination
// pair gets looked up on every refresh but rarely actually changes. Separate from
// the ZIP-only /api/geocode above (which also writes the global weather location
// as a side effect — this must NOT do that, it's resolving arbitrary addresses
// for a specific widget, not setting the device's home location).
const _geocodeCache = new Map(); // query -> { lat, lon, label, at }
const GEOCODE_CACHE_MS = 24 * 60 * 60 * 1000; // 24h — addresses don't move
// Override the geocoder base only in tests (PIAZZA_NOMINATIM_URL); unset everywhere real.
const NOMINATIM_BASE = process.env.PIAZZA_NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
function geocodeAddress(query) {
  const cached = _geocodeCache.get(query);
  if (cached && (Date.now() - cached.at) < GEOCODE_CACHE_MS) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    (url.startsWith('http://') ? http : https).get(url, { headers: { 'User-Agent': 'PiazzaHQ/1.0' } }, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (!results.length) return reject(new Error(`Could not find "${query}"`));
          const result = { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), label: results[0].display_name, at: Date.now() };
          _geocodeCache.set(query, result);
          resolve(result);
        } catch { reject(new Error('Failed to parse geocoding response')); }
      });
    }).on('error', reject);
  });
}
// OSRM's public demo router — free, no key, no signup. Road-network typical
// travel time; does NOT account for live traffic conditions.
function getOsrmDuration(origin, destination, mode) {
  const profile = mode === 'walking' ? 'foot' : mode === 'bicycling' ? 'bike' : 'driving';
  const url = `https://router.project-osrm.org/route/v1/${profile}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;
  return new Promise((resolve, reject) => {
    https.get(url, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const route = parsed.routes && parsed.routes[0];
          if (!route) return reject(new Error('No route found between those two addresses'));
          resolve({ durationMin: Math.round(route.duration / 60), distanceMiles: Math.round(route.distance / 1609.34 * 10) / 10, trafficAware: false });
        } catch { reject(new Error('Failed to parse routing response')); }
      });
    }).on('error', reject);
  });
}
// Google's Distance Matrix API — needs the user's own key, but gives a
// traffic-aware duration ("in current traffic") the same way Google Maps
// itself would show for right now.
function getGoogleDuration(origin, destination, mode, apiKey) {
  const gMode = mode === 'walking' ? 'walking' : mode === 'bicycling' ? 'bicycling' : 'driving';
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lon}&destinations=${destination.lat},${destination.lon}` +
    `&mode=${gMode}&departure_time=now&key=${encodeURIComponent(apiKey)}`;
  return new Promise((resolve, reject) => {
    https.get(url, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const el = parsed.rows && parsed.rows[0] && parsed.rows[0].elements && parsed.rows[0].elements[0];
          if (!el || el.status !== 'OK') return reject(new Error('Google could not find a route between those addresses'));
          const seconds = (el.duration_in_traffic || el.duration).value;
          resolve({ durationMin: Math.round(seconds / 60), distanceMiles: Math.round(el.distance.value / 1609.34 * 10) / 10, trafficAware: !!el.duration_in_traffic });
        } catch { reject(new Error('Failed to parse Google response')); }
      });
    }).on('error', reject);
  });
}
app.get('/api/travel-time', async (req, res) => {
  const origin = (req.query.origin || '').trim();
  const destination = (req.query.destination || '').trim();
  const mode = req.query.mode || 'driving';
  if (!origin || !destination) return res.status(400).json({ error: 'Set an origin and destination in this widget\'s settings' });
  try {
    const [originGeo, destGeo] = await Promise.all([geocodeAddress(origin), geocodeAddress(destination)]);
    const provider = getSetting('travel_provider') || 'osrm';
    const apiKey = getSetting('travel_api_key') || '';
    const route = (provider === 'google' && apiKey)
      ? await getGoogleDuration(originGeo, destGeo, mode, apiKey)
      : await getOsrmDuration(originGeo, destGeo, mode);
    res.json({ ...route, originLabel: originGeo.label, destinationLabel: destGeo.label });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── On This Day proxy (Wikipedia REST API, free, no key) ─────────────────────
// Cached once per calendar day (local date) since the content is the same all day.
let onThisDayCache = { dateKey: null, data: null };
function fetchJsonWithUA(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PiazzaHQApp/1.0 (self-hosted family wall display; contact via project repo)' } }, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        if (apiRes.statusCode !== 200) return reject(new Error(`HTTP ${apiRes.statusCode}`));
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Failed to parse response')); }
      });
    }).on('error', reject);
  });
}
// Picks n random items from an array without mutating it (Fisher-Yates partial shuffle).
function sampleRandom(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0 && copy.length - i <= n; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(-n).reverse();
}
app.get('/api/on-this-day', async (req, res) => {
  const dateKey = localDateStr();
  if (onThisDayCache.dateKey === dateKey && onThisDayCache.data) {
    return res.json(onThisDayCache.data);
  }
  const { m, d } = appNow();
  const mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
  try {
    const raw = await fetchJsonWithUA(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
    const events = Array.isArray(raw.events) ? raw.events : [];
    // Sample a handful at random each day (rather than always the same first N)
    // so a family glancing at this daily sees variety, not the identical facts
    // every year on the same date.
    const picked = sampleRandom(events.filter(e => e.text && e.year), 6)
      .sort((a, b) => a.year - b.year)
      .map(e => ({ year: e.year, text: e.text }));
    const payload = { month: m, day: d, events: picked };
    onThisDayCache = { dateKey, data: payload };
    res.json(payload);
  } catch (e) {
    if (onThisDayCache.data) return res.json({ ...onThisDayCache.data, stale: true });
    res.status(500).json({ error: 'Could not reach Wikipedia — ' + e.message });
  }
});

// ── Daily Quote proxy (ZenQuotes, free, no key) ───────────────────────────────
let dailyQuoteCache = { dateKey: null, data: null };
app.get('/api/daily-quote', async (req, res) => {
  const dateKey = localDateStr();
  if (dailyQuoteCache.dateKey === dateKey && dailyQuoteCache.data) {
    return res.json(dailyQuoteCache.data);
  }
  try {
    const raw = await fetchJsonWithUA('https://zenquotes.io/api/today');
    const item = Array.isArray(raw) ? raw[0] : null;
    if (!item || !item.q) throw new Error('Unexpected response shape');
    const payload = { quote: item.q, author: item.a || 'Unknown' };
    dailyQuoteCache = { dateKey, data: payload };
    res.json(payload);
  } catch (e) {
    if (dailyQuoteCache.data) return res.json({ ...dailyQuoteCache.data, stale: true });
    res.status(500).json({ error: 'Could not reach quote service — ' + e.message });
  }
});

// ── Sports Scores proxy (TheSportsDB, free tier via shared test key "3") ─────
// TheSportsDB's "3" key is their published free/test key intended for exactly
// this kind of personal, low-volume, non-commercial use (see thesportsdb.com/api.php).
// NOTE: true real-time in-play score ticking is a paid-tier feature on TheSportsDB;
// this only surfaces the next scheduled game and the most recent final score, which
// is what the free tier actually supports.
const SPORTSDB_KEY = '3';
// TheSportsDB's own search endpoint favors something closer to prefix/exact
// matching over a true substring search — "Packers" alone doesn't surface
// "Green Bay Packers" the way searching "Green Bay" does, even though it's
// the same team. Not something fixable by tweaking a query parameter, since
// the matching itself happens on their end, not ours. This is a practical
// middle ground: a lookup table of common nickname -> full team name for the
// major leagues (where fans would naturally just type the nickname), used to
// ALSO search the full name alongside whatever the raw query already finds —
// not a replacement for the direct query, since that still correctly
// handles anything typed in full already.
const SPORTS_NICKNAME_MAP = {
  // NFL
  cardinals: ['Arizona Cardinals'], falcons: ['Atlanta Falcons'], ravens: ['Baltimore Ravens'],
  bills: ['Buffalo Bills'], panthers: ['Carolina Panthers'], bears: ['Chicago Bears'],
  bengals: ['Cincinnati Bengals'], browns: ['Cleveland Browns'], cowboys: ['Dallas Cowboys'],
  broncos: ['Denver Broncos'], lions: ['Detroit Lions'], packers: ['Green Bay Packers'],
  texans: ['Houston Texans'], colts: ['Indianapolis Colts'], jaguars: ['Jacksonville Jaguars'],
  chiefs: ['Kansas City Chiefs'], raiders: ['Las Vegas Raiders'], chargers: ['Los Angeles Chargers'],
  rams: ['Los Angeles Rams'], dolphins: ['Miami Dolphins'], vikings: ['Minnesota Vikings'],
  patriots: ['New England Patriots'], saints: ['New Orleans Saints'],
  giants: ['New York Giants', 'San Francisco Giants'], jets: ['New York Jets'],
  eagles: ['Philadelphia Eagles'], steelers: ['Pittsburgh Steelers'],
  '49ers': ['San Francisco 49ers'], niners: ['San Francisco 49ers'], seahawks: ['Seattle Seahawks'],
  buccaneers: ['Tampa Bay Buccaneers'], bucs: ['Tampa Bay Buccaneers'], titans: ['Tennessee Titans'],
  commanders: ['Washington Commanders'],
  // NBA
  hawks: ['Atlanta Hawks'], celtics: ['Boston Celtics'], nets: ['Brooklyn Nets'],
  hornets: ['Charlotte Hornets'], bulls: ['Chicago Bulls'], cavaliers: ['Cleveland Cavaliers'],
  cavs: ['Cleveland Cavaliers'], mavericks: ['Dallas Mavericks'], mavs: ['Dallas Mavericks'],
  nuggets: ['Denver Nuggets'], pistons: ['Detroit Pistons'], warriors: ['Golden State Warriors'],
  rockets: ['Houston Rockets'], pacers: ['Indiana Pacers'], clippers: ['Los Angeles Clippers'],
  lakers: ['Los Angeles Lakers'], grizzlies: ['Memphis Grizzlies'], heat: ['Miami Heat'],
  bucks: ['Milwaukee Bucks'], timberwolves: ['Minnesota Timberwolves'], wolves: ['Minnesota Timberwolves'],
  pelicans: ['New Orleans Pelicans'], knicks: ['New York Knicks'], thunder: ['Oklahoma City Thunder'],
  magic: ['Orlando Magic'], '76ers': ['Philadelphia 76ers'], sixers: ['Philadelphia 76ers'],
  suns: ['Phoenix Suns'], blazers: ['Portland Trail Blazers'], kings: ['Sacramento Kings'],
  spurs: ['San Antonio Spurs'], raptors: ['Toronto Raptors'], jazz: ['Utah Jazz'],
  wizards: ['Washington Wizards'],
  // MLB (only nicknames not already covered above)
  diamondbacks: ['Arizona Diamondbacks'], dbacks: ['Arizona Diamondbacks'], braves: ['Atlanta Braves'],
  orioles: ['Baltimore Orioles'], redsox: ['Boston Red Sox'], cubs: ['Chicago Cubs'],
  whitesox: ['Chicago White Sox'], reds: ['Cincinnati Reds'], guardians: ['Cleveland Guardians'],
  rockies: ['Colorado Rockies'], tigers: ['Detroit Tigers'], astros: ['Houston Astros'],
  royals: ['Kansas City Royals'], angels: ['Los Angeles Angels'], dodgers: ['Los Angeles Dodgers'],
  marlins: ['Miami Marlins'], brewers: ['Milwaukee Brewers'], twins: ['Minnesota Twins'],
  mets: ['New York Mets'], yankees: ['New York Yankees'], athletics: ['Oakland Athletics'],
  phillies: ['Philadelphia Phillies'], pirates: ['Pittsburgh Pirates'], padres: ['San Diego Padres'],
  mariners: ['Seattle Mariners'], cardinalsmlb: ['St. Louis Cardinals'], rays: ['Tampa Bay Rays'],
  rangers: ['Texas Rangers', 'New York Rangers'], bluejays: ['Toronto Blue Jays'], nationals: ['Washington Nationals'],
  // NHL (only nicknames not already covered above)
  ducks: ['Anaheim Ducks'], coyotes: ['Arizona Coyotes'], sabres: ['Buffalo Sabres'],
  flames: ['Calgary Flames'], hurricanes: ['Carolina Hurricanes'], blackhawks: ['Chicago Blackhawks'],
  avalanche: ['Colorado Avalanche'], bluejackets: ['Columbus Blue Jackets'], stars: ['Dallas Stars'],
  redwings: ['Detroit Red Wings'], oilers: ['Edmonton Oilers'], panthersnhl: ['Florida Panthers'],
  wild: ['Minnesota Wild'], canadiens: ['Montreal Canadiens'], predators: ['Nashville Predators'],
  devils: ['New Jersey Devils'], islanders: ['New York Islanders'], senators: ['Ottawa Senators'],
  flyers: ['Philadelphia Flyers'], penguins: ['Pittsburgh Penguins'], sharks: ['San Jose Sharks'],
  kraken: ['Seattle Kraken'], blues: ['St. Louis Blues'], lightning: ['Tampa Bay Lightning'],
  mapleleafs: ['Toronto Maple Leafs'], canucks: ['Vancouver Canucks'], golden_knights: ['Vegas Golden Knights'],
  capitals: ['Washington Capitals'], jetsnhl: ['Winnipeg Jets'],
};

app.get('/api/sports/search-team', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ teams: [] });
  try {
    // Search the raw query as typed, PLUS the full name for any known nickname
    // match, merging and deduping by team id. Every search still runs
    // through TheSportsDB's own endpoint either way — this only ever adds
    // additional, more specific queries alongside it, never replaces it.
    const queries = [q];
    const nicknameKey = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SPORTS_NICKNAME_MAP[nicknameKey]) {
      for (const fullName of SPORTS_NICKNAME_MAP[nicknameKey]) {
        if (!queries.some(existing => existing.toLowerCase() === fullName.toLowerCase())) queries.push(fullName);
      }
    }
    const results = await Promise.all(queries.map(query =>
      fetchJsonWithUA(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/searchteams.php?t=${encodeURIComponent(query)}`)
        .catch(() => ({ teams: [] }))
    ));
    const seen = new Set();
    const teams = [];
    for (const raw of results) {
      for (const t of (raw.teams || [])) {
        if (seen.has(t.idTeam)) continue;
        seen.add(t.idTeam);
        teams.push({ id: t.idTeam, name: t.strTeam, badge: t.strTeamBadge || null, sport: t.strSport || '', league: t.strLeague || '' });
        if (teams.length >= 8) break;
      }
      if (teams.length >= 8) break;
    }
    res.json({ teams });
  } catch (e) {
    res.status(500).json({ error: 'Could not reach TheSportsDB — ' + e.message });
  }
});
// Cache per team id for a few minutes — schedule/final-score data doesn't need to be
// fetched on every single display poll.
const sportsTeamCache = new Map(); // teamId -> { fetchedAt, data }
const SPORTS_CACHE_MS = 10 * 60 * 1000;
app.get('/api/sports/team/:id', async (req, res) => {
  const id = req.params.id;
  const cached = sportsTeamCache.get(id);
  if (cached && (Date.now() - cached.fetchedAt) < SPORTS_CACHE_MS) {
    return res.json(cached.data);
  }
  try {
    const [nextRaw, lastRaw] = await Promise.all([
      fetchJsonWithUA(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsnext.php?id=${encodeURIComponent(id)}`).catch(() => null),
      fetchJsonWithUA(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventslast.php?id=${encodeURIComponent(id)}`).catch(() => null),
    ]);
    // TheSportsDB is inconsistent about the wrapper key across endpoints — check
    // both "events" and "results" defensively rather than assuming one.
    const nextEvents = (nextRaw && (nextRaw.events || nextRaw.results)) || [];
    const lastEvents = (lastRaw && (lastRaw.results || lastRaw.events)) || [];
    const mapEvent = (e) => e ? ({
      id: e.idEvent, name: e.strEvent, league: e.strLeague || '',
      home: e.strHomeTeam, away: e.strAwayTeam,
      homeScore: (e.intHomeScore != null) ? Number(e.intHomeScore) : null,
      awayScore: (e.intAwayScore != null) ? Number(e.intAwayScore) : null,
      date: e.dateEvent || '', time: e.strTime || '', venue: e.strVenue || '',
    }) : null;
    const payload = {
      nextEvent: mapEvent(nextEvents[0]),
      lastEvent: mapEvent(lastEvents[0]),
    };
    sportsTeamCache.set(id, { fetchedAt: Date.now(), data: payload });
    res.json(payload);
  } catch (e) {
    if (cached) return res.json({ ...cached.data, stale: true });
    res.status(500).json({ error: 'Could not reach TheSportsDB — ' + e.message });
  }
});

// ── METAR/TAF proxy (NOAA Aviation Weather Center, free, no key) ─────────────
// https://aviationweather.gov/api/data — public, keyless, but asks for a custom
// User-Agent and reasonable rate limiting, both already satisfied by
// fetchJsonWithUA() and the per-station cache below.
const metarTafCache = new Map(); // icao -> { fetchedAt, data }
const METAR_TAF_CACHE_MS = 10 * 60 * 1000;

// Standard US flight-category rule, derived from ceiling (lowest broken/overcast
// layer, or vertical visibility) and surface visibility — not returned directly by
// the API, so computed here the same way pilots read a METAR at a glance.
function flightCategory(visibSM, ceilingFt) {
  if (visibSM == null && ceilingFt == null) return null;
  const vis = visibSM == null ? Infinity : visibSM;
  const ceil = ceilingFt == null ? Infinity : ceilingFt;
  if (vis < 1 || ceil < 500) return 'LIFR';
  if (vis < 3 || ceil < 1000) return 'IFR';
  if (vis <= 5 || ceil <= 3000) return 'MVFR';
  return 'VFR';
}
// The API returns visibility as either a plain number (miles) or a string like
// "10+" (at-or-above threshold) — normalize both to a number.
function parseVisib(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace('+', ''));
  return Number.isFinite(n) ? n : null;
}
function lowestCeiling(clouds) {
  if (!Array.isArray(clouds)) return null;
  const layers = clouds.filter(c => c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV').map(c => c.base).filter(b => b != null);
  return layers.length ? Math.min(...layers) : null;
}
function skyConditionText(clouds) {
  if (!Array.isArray(clouds) || !clouds.length) return 'Sky data unavailable';
  if (clouds.length === 1 && (clouds[0].cover === 'CLR' || clouds[0].cover === 'SKC')) return 'Clear';
  const names = { FEW: 'Few', SCT: 'Scattered', BKN: 'Broken', OVC: 'Overcast', VV: 'Vertical Visibility' };
  return clouds
    .filter(c => c.cover !== 'CLR' && c.cover !== 'SKC')
    .map(c => `${names[c.cover] || c.cover}${c.base != null ? ' ' + c.base.toLocaleString() + 'ft' : ''}`)
    .join(', ') || 'Clear';
}
app.get('/api/metar-taf', async (req, res) => {
  const icao = String(req.query.icao || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(icao)) return res.status(400).json({ error: 'Enter a valid 4-letter ICAO airport code (e.g. KJFK).' });

  const cached = metarTafCache.get(icao);
  if (cached && (Date.now() - cached.fetchedAt) < METAR_TAF_CACHE_MS) {
    return res.json(cached.data);
  }
  try {
    const [metarRaw, tafRaw] = await Promise.all([
      fetchJsonWithUA(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`).catch(() => []),
      fetchJsonWithUA(`https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`).catch(() => []),
    ]);
    const m = Array.isArray(metarRaw) ? metarRaw[0] : null;
    const t = Array.isArray(tafRaw) ? tafRaw[0] : null;
    if (!m && !t) {
      return res.status(404).json({ error: `No data found for "${icao}" — check the ICAO code (it's usually 4 letters, e.g. KJFK, not the 3-letter airport code like JFK).` });
    }

    let metar = null;
    if (m) {
      const visib = parseVisib(m.visib);
      const ceiling = lowestCeiling(m.clouds);
      metar = {
        stationId: m.icaoId, name: m.name || icao,
        obsTime: m.obsTime ? m.obsTime * 1000 : null, // -> ms epoch for the client
        tempC: m.temp ?? null, dewpC: m.dewp ?? null,
        windDir: m.wdir ?? null, windSpeedKt: m.wspd ?? null, windGustKt: m.wgst ?? null,
        visibSM: visib,
        altimInHg: (m.altim != null) ? Math.round((m.altim / 33.8639) * 100) / 100 : null, // API gives hPa
        wx: m.wxString || null,
        sky: skyConditionText(m.clouds),
        flightCategory: flightCategory(visib, ceiling),
        raw: m.rawOb || null,
      };
    }
    let taf = null;
    if (t) {
      // issueTime is a "YYYY-MM-DD HH:MM:SS" string with no timezone marker, but is
      // always UTC — must explicitly mark it as such or Date() would (wrongly)
      // interpret it as the server's local time.
      const issuedMs = t.issueTime ? new Date(String(t.issueTime).replace(' ', 'T') + 'Z').getTime() : null;
      taf = {
        validFrom: t.validTimeFrom ? t.validTimeFrom * 1000 : null,
        validTo: t.validTimeTo ? t.validTimeTo * 1000 : null,
        issued: Number.isFinite(issuedMs) ? issuedMs : null,
        raw: t.rawTAF || null,
      };
    }
    const payload = { icao, name: (m && m.name) || (t && t.name) || icao, metar, taf };
    metarTafCache.set(icao, { fetchedAt: Date.now(), data: payload });
    res.json(payload);
  } catch (e) {
    if (cached) return res.json({ ...cached.data, stale: true });
    res.status(500).json({ error: 'Could not reach the Aviation Weather Center — ' + e.message });
  }
});

// ── iCal feeds API ────────────────────────────────────────────────────────────

// GET /api/feeds
app.get('/api/feeds', (req, res) => {
  const feeds = db.prepare(`SELECT * FROM ical_feeds ORDER BY id ASC`).all();
  const masterRow = db.prepare(`SELECT value FROM settings WHERE key = 'feed_default_opacity'`).get();
  let master = masterRow ? parseInt(masterRow.value, 10) : 100;
  if (Number.isNaN(master)) master = 100;
  // effective_opacity: what's ACTUALLY applied right now (the master default
  // if this feed hasn't opted out, its own color_opacity otherwise) — kept
  // alongside the raw color_opacity/use_global_opacity fields rather than
  // replacing them, since the Calendar Feeds edit UI needs the RAW state
  // (is the checkbox on, what's this feed's own stored slider value) while
  // the per-widget-override list (see populateFeedOpacityOverrideList() in
  // app.html) needs the resolved one, as the accurate starting point for
  // "here's what this feed currently looks like before you override it."
  res.json(feeds.map(f => ({ ...f, effective_opacity: f.use_global_opacity ? master : f.color_opacity })));
});

// POST /api/feeds
app.post('/api/feeds', async (req, res) => {
  const { name, url, color } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
  try {
    const result = db.prepare(
      `INSERT INTO ical_feeds (name, url, color) VALUES (?, ?, ?)`
    ).run(name, url, color || '#a78bfa');
    const feed = db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(result.lastInsertRowid);
    broadcastUpdate('feeds');
    // Sync immediately, but don't let a sync failure undo adding the feed —
    // the URL might just be transiently unreachable, and the person can retry
    // the sync later without having to re-add it from scratch. Instead, report
    // the sync outcome honestly so a failure is visible rather than silently
    // looking like a successful "0 events" sync.
    try {
      await syncFeed(feed);
      broadcastUpdate('events');
      res.status(201).json({ ...feed, sync_warning: null });
    } catch (syncErr) {
      res.status(201).json({ ...feed, sync_warning: syncErr.message });
    }
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Feed URL already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/feeds/:id
app.put('/api/feeds/:id', async (req, res) => {
  const { name, url, color, color_timed, show_location, color_opacity, use_global_opacity, enabled } = req.body;
  const feed = db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(req.params.id);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });

  const newUrl = (url !== undefined && url !== null && url.trim() !== '') ? url.trim() : feed.url;
  const urlChanged = newUrl !== feed.url;

  // Clamp defensively — this is a percentage a slider writes, but nothing
  // stops a malformed/out-of-range value arriving some other way, and an
  // opacity outside 0-100 would produce a nonsensical (or invalid) CSS
  // color wherever feedColorWithOpacity() applies it downstream.
  let newOpacity = feed.color_opacity;
  if (color_opacity !== undefined && color_opacity !== null) {
    const n = parseInt(color_opacity, 10);
    if (!Number.isNaN(n)) newOpacity = Math.max(0, Math.min(100, n));
  }

  try {
    db.prepare(`UPDATE ical_feeds SET name=?, url=?, color=?, color_timed=?, show_location=?, color_opacity=?, use_global_opacity=?, enabled=? WHERE id=?`)
      .run(
        name ?? feed.name,
        newUrl,
        color ?? feed.color,
        color_timed !== undefined ? (color_timed ? 1 : 0) : feed.color_timed,
        show_location !== undefined ? (show_location ? 1 : 0) : feed.show_location,
        newOpacity,
        use_global_opacity !== undefined ? (use_global_opacity ? 1 : 0) : feed.use_global_opacity,
        enabled !== undefined ? enabled : feed.enabled,
        req.params.id
      );
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Another calendar already uses that URL' });
    return res.status(500).json({ error: e.message });
  }

  const updated = db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(req.params.id);

  // If the URL changed, the existing events belong to the old calendar — clear them
  // and re-sync from the new URL. Report a sync warning rather than failing the whole
  // edit if the new URL can't be fetched (consistent with how adding a feed behaves).
  let sync_warning = null;
  if (urlChanged) {
    db.prepare(`DELETE FROM ical_events WHERE feed_id = ?`).run(req.params.id);
    try {
      await syncFeed(updated);
    } catch (syncErr) {
      sync_warning = syncErr.message;
    }
  }

  broadcastUpdate('feeds');
  broadcastUpdate('events');
  // Same reasoning as the master-opacity fix in PUT /api/settings above: this
  // broadcastUpdate() only reaches SSE clients on THIS device. A feed edit
  // (opacity, color, "use global default," etc.) previously didn't mark the
  // host as actively being edited, so a slave display picked it up on its
  // normal 15s poll rather than the 1.5s fast one layout saves already get.
  markHostEditing();
  res.json({ ...db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(req.params.id), sync_warning });
});

// DELETE /api/feeds/:id
app.delete('/api/feeds/:id', (req, res) => {
  db.prepare(`DELETE FROM ical_events WHERE feed_id = ?`).run(req.params.id);
  const result = db.prepare(`DELETE FROM ical_feeds WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Feed not found' });
  broadcastUpdate('feeds');
  broadcastUpdate('events');
  res.json({ ok: true });
});

// POST /api/feeds/:id/sync — manual sync trigger
app.post('/api/feeds/:id/sync', async (req, res) => {
  const feed = db.prepare(`SELECT * FROM ical_feeds WHERE id = ?`).get(req.params.id);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  try {
    const count = await syncFeed(feed);
    broadcastUpdate('events');
    res.json({ ok: true, events_imported: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── iCal parser ───────────────────────────────────────────────────────────────

function fetchUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    lib.get(urlStr, {
      headers: {
        'User-Agent': 'PiazzaHQ/1.0',
        // Some calendar hosts (e.g. iCloud) serve different/empty content to
        // requests that don't look like they're asking for calendar data —
        // an explicit Accept header makes this request look more like what a
        // real calendar client sends. We advertise the compression schemes we
        // can decode below; iCloud in particular always gzips its .ics feeds.
        'Accept': 'text/calendar, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Resolve relative redirect targets against the current URL
        const next = new URL(res.headers.location, urlStr).toString();
        res.resume(); // discard the redirect body so the socket frees up
        return resolve(fetchUrl(next));
      }

      // Collect the raw body as binary, since a compressed response is bytes,
      // not text — decoding to a string first would corrupt it.
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        // Transparently decompress based on what the server says it sent.
        // Node's https.get does NOT auto-decompress, so without this an
        // iCloud feed (always gzip) arrives as unreadable compressed bytes
        // and the parser sees no BEGIN:VCALENDAR.
        const encoding = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (encoding === 'gzip') buf = zlib.gunzipSync(buf);
          else if (encoding === 'deflate') buf = zlib.inflateSync(buf);
          else if (encoding === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch (e) {
          return reject(new Error(`Failed to decompress ${encoding} response: ${e.message}`));
        }
        const body = buf.toString('utf8');

        // Treat non-2xx as a real failure instead of silently parsing whatever
        // error page/body came back as "0 events found".
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(
            `Calendar server returned HTTP ${res.statusCode}${body ? ': ' + body.slice(0, 200) : ''}`
          ));
        }
        resolve(body);
      });
    }).on('error', reject);
  });
}

function parseICS(icsText, feedId, feedColor, timeZone) {
  const events = [];
  // Resolve the timezone once for the whole feed (used to localize UTC times).
  const tz = timeZone || getLocalTimezone();
  // Unfold lines (RFC 5545: lines ending in \r\n + space/tab are continuations)
  const unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n');
  const lines = unfolded.split('\n');

  let inEvent = false, current = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { inEvent = true; current = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') {
      inEvent = false;
      // Keep any VEVENT that has the essentials. Overrides (with a recurrenceId)
      // and cancellations are sorted out in the reconciliation step below.
      // Skip events this device pushed OUT itself (see the push section): if
      // the household also subscribes to the same iCloud/Google calendar as a
      // feed, its own pushed events would otherwise come back in as duplicate
      // 'ical:' rows alongside the original 'local:' ones. Both UID forms are
      // self-identifying — piazzahq-local-<id>@piazzahq.local for CalDAV, and
      // phqlocal<id>@google.com for events created with our deterministic id
      // through Google's API.
      if (current.uid && current.title && current.date
          && !/^piazzahq-local-\d+@piazzahq\.local$/.test(current.uid)
          && !/^phqlocal\d+@google\.com$/i.test(current.uid)) {
        events.push(current);
      }
      continue;
    }
    if (!inEvent) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key   = line.slice(0, colon).toUpperCase();
    const value = line.slice(colon + 1).trim();

    // UID
    if (key === 'UID') current.uid = value;

    // Summary (title) — may have params like SUMMARY;LANGUAGE=en:Title
    if (key.startsWith('SUMMARY')) current.title = decodeICSText(value);

    // Description
    if (key.startsWith('DESCRIPTION')) current.notes = decodeICSText(value).slice(0, 500);

    // Location (venue / address) — may carry params like LOCATION;LANGUAGE=en:...
    if (key.startsWith('LOCATION')) current.location = decodeICSText(value).slice(0, 300);

    // DTSTART — handles date-only (VALUE=DATE) and datetime
    if (key.startsWith('DTSTART')) {
      const parsed = parseICSDate(key, value, tz);
      if (parsed) { current.date = parsed.date; current.start_time = parsed.time; }
    }
    if (key.startsWith('DTEND')) {
      const parsed = parseICSDate(key, value, tz);
      if (parsed) {
        current.end_time = parsed.time;
        // RFC 5545: for all-day (VALUE=DATE) events, DTEND is exclusive —
        // a 3-day event Mon-Wed has DTEND of Thursday. Subtract a day so our
        // stored end_date reflects the actual last day the event occurs.
        if (!parsed.time) {
          const d = new Date(parsed.date + 'T00:00:00');
          d.setDate(d.getDate() - 1);
          current.end_date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        } else {
          current.end_date = parsed.date;
        }
      }
    }

    // RRULE — recurrence pattern, e.g. "FREQ=YEARLY" or "FREQ=WEEKLY;BYDAY=MO,WE,FR"
    if (key === 'RRULE') current.rrule = value;

    // RECURRENCE-ID — marks this VEVENT as an override of a SINGLE occurrence of a
    // recurring series (same UID). Its value is the ORIGINAL date/time of the
    // occurrence being replaced. Captured here; reconciled after parsing so the
    // original instance is suppressed and this modified one shown in its place.
    if (key.startsWith('RECURRENCE-ID')) {
      const parsed = parseICSDate(key, value, tz);
      if (parsed) current.recurrenceId = parsed.date;
    }

    // STATUS — CANCELLED means this (occurrence or event) should not be shown.
    if (key === 'STATUS') current.status = value.toUpperCase();

    // EXDATE — one or more cancelled occurrence dates. Can appear as multiple EXDATE
    // lines, and/or as a comma-separated list within a single line.
    if (key.startsWith('EXDATE')) {
      for (const part of value.split(',')) {
        const parsed = parseICSDate(key, part.trim(), tz);
        if (parsed) current.exdates.push(parsed.date);
      }
    }
  }
  return reconcileRecurrenceOverrides(events);
}

// Reconciles per-occurrence overrides (RECURRENCE-ID) against their master series.
// Calendar providers express "this one instance moved/changed/was cancelled" as a
// SEPARATE VEVENT sharing the series UID, with a RECURRENCE-ID naming the original
// occurrence. Without handling these you get duplicates (the original instance AND
// the override) or ghosts (a cancelled instance still showing).
//
// For each override we:
//   • add the original occurrence date to the master's EXDATEs, so expansion skips it
//   • if the override is CANCELLED, drop it entirely (occurrence simply removed)
//   • otherwise keep it as a standalone one-off at its new date/time
function reconcileRecurrenceOverrides(events) {
  // Index masters (recurring, no recurrenceId) by UID. A UID could in theory have
  // a non-recurring master too; we only need the recurring ones for suppression.
  const mastersByUid = new Map();
  for (const e of events) {
    if (!e.recurrenceId && e.rrule) mastersByUid.set(e.uid, e);
  }

  const result = [];
  for (const e of events) {
    // Drop any event/occurrence explicitly cancelled.
    if (e.status === 'CANCELLED') {
      // If it's a cancelled override, still suppress the original instance below.
      if (e.recurrenceId) {
        const master = mastersByUid.get(e.uid);
        if (master) master.exdates.push(e.recurrenceId);
      }
      continue;
    }

    if (e.recurrenceId) {
      // A modified single occurrence: suppress the original in the master series,
      // then keep this override as a standalone event at its new slot.
      const master = mastersByUid.get(e.uid);
      if (master) master.exdates.push(e.recurrenceId);
      // Strip recurrence fields so it's treated as a one-off (it has no RRULE anyway).
      const oneOff = { ...e };
      delete oneOff.rrule;
      result.push(oneOff);
      continue;
    }

    result.push(e);
  }
  return result;
}

// The display's configured IANA timezone (e.g. "America/Chicago"). Calendar times
// marked UTC (trailing Z) are converted into this zone so they land on the right
// day and clock time. Shares the same 'timezone_override' setting as appNow()
// (Settings tab -> Timezone) rather than a separate key, so one control governs
// both "what day is it" logic and calendar-feed UTC conversion. Falls back to
// the Pi's system zone, then Chicago, if the override is unset.
function getLocalTimezone() {
  const override = getTimezoneOverride();
  if (override) return override;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; }
  catch { return 'America/Chicago'; }
}

// Converts a UTC instant to {date:'YYYY-MM-DD', time:'HH:MM'} in the given IANA zone.
function utcToLocalParts(utcDate, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(utcDate)) parts[p.type] = p.value;
  let hour = parts.hour === '24' ? '00' : parts.hour; // some engines emit 24 for midnight
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

function parseICSDate(key, value, timeZone) {
  // All-day: DTSTART;VALUE=DATE:20240315 — no time, no zone conversion (it's a
  // floating calendar date by definition).
  if (key.includes('VALUE=DATE') || /^\d{8}$/.test(value)) {
    const d = value.replace(/\D/g, '').slice(0, 8);
    return { date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`, time: null };
  }
  // DateTime: 20240315T093000Z (UTC) or 20240315T093000 (local/floating)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (m) {
    const [, yy, mo, dd, hh, mi, , z] = m;
    // UTC (trailing Z): convert to the configured local zone so the day/time are
    // correct. Without this, e.g. a 03:00Z meeting showed a day late at 3am.
    if (z && timeZone) {
      const utc = new Date(Date.UTC(+yy, +mo - 1, +dd, +hh, +mi, 0));
      return utcToLocalParts(utc, timeZone);
    }
    // No Z: a "floating"/local time — take it as written (this is what the spec
    // intends for local-time values, and matches how most personal events read).
    return { date: `${yy}-${mo}-${dd}`, time: `${hh}:${mi}` };
  }
  return null;
}

function decodeICSText(s) {
  return s.replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// ── Recurring event expansion (RRULE) ─────────────────────────────────────────
// Supported: FREQ (DAILY/WEEKLY/MONTHLY/YEARLY), INTERVAL, COUNT, UNTIL,
// BYDAY (plain like "MO,WE,FR" and ordinal like "2MO"/"-1FR"), BYMONTH,
// BYMONTHDAY, BYSETPOS (e.g. "BYDAY=MO;BYSETPOS=3" = 3rd Monday — the form
// Outlook/Exchange and many corporate calendars emit), and EXDATE exclusions.
//
// Known limitations (rare in personal/family calendars, but worth knowing):
//   • BYWEEKNO / BYYEARDAY / BYHOUR / sub-daily FREQ (HOURLY/MINUTELY/SECONDLY)
//     aren't expanded — these essentially never appear on a wall calendar.
//   • INTERVAL for weekly is approximated by week parity from the start date
//     (no explicit WKST handling).
//   • VTIMEZONE blocks with named TZID offsets aren't parsed; UTC ("Z") times ARE
//     converted to the configured local zone, and floating local times are taken
//     as written. A TZID-with-custom-offset time is treated as floating (shown as
//     written), which is correct for same-zone calendars and off only if a feed
//     specifies a zone different from the display's.
//
// Handled: per-occurrence overrides (RECURRENCE-ID — moved/edited/cancelled single
// instances) and STATUS:CANCELLED, reconciled against their master series.
//
// Occurrences are bounded to a window around "now" (rather than expanding a
// "forever" yearly birthday out to infinity) so storage and sync time stay bounded.
const RECURRENCE_WINDOW_PAST_DAYS   = 366;       // ~1 year back, covers "this already happened" lookups
const RECURRENCE_WINDOW_FUTURE_DAYS = 366 * 2;    // ~2 years ahead, plenty for a wall calendar

const WEEKDAY_CODES = ['SU','MO','TU','WE','TH','FR','SA'];

function parseRRule(rruleStr) {
  const parts = {};
  for (const pair of rruleStr.split(';')) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) parts[k.toUpperCase()] = v;
  }
  return {
    freq: parts.FREQ,
    interval: parseInt(parts.INTERVAL) || 1,
    count: parts.COUNT ? parseInt(parts.COUNT) : null,
    until: parts.UNTIL ? parseICSDate('UNTIL', parts.UNTIL, getLocalTimezone())?.date : null,
    byday: parts.BYDAY ? parts.BYDAY.split(',') : null,       // e.g. ["MO","WE"] or ["1MO","-1FR"]
    bymonthday: parts.BYMONTHDAY ? parts.BYMONTHDAY.split(',').map(Number) : null,
    bymonth: parts.BYMONTH ? parts.BYMONTH.split(',').map(Number) : null,  // e.g. [11] for November — restricts which months occurrences land in
    bysetpos: parts.BYSETPOS ? parts.BYSETPOS.split(',').map(Number) : null,  // e.g. [3] = the 3rd match within each period; [-1] = the last. Outlook/Exchange emit "BYDAY=MO;BYSETPOS=3" for "3rd Monday".
  };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addMonths(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const totalMonths = (y * 12 + (m - 1)) + n;
  const targetYear  = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12; // 0-indexed
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(day, lastDayOfTargetMonth);
  return `${targetYear}-${String(targetMonth+1).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
}
function addYears(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const targetYear = y + n;
  const lastDayOfTargetMonth = new Date(targetYear, m, 0).getDate(); // m is already 1-indexed here, so month=m gives day-0 of month m = last day of month m
  const targetDay = Math.min(day, lastDayOfTargetMonth);
  return `${targetYear}-${String(m).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
}

// Expands a single recurring VEVENT into a list of { date, end_date } occurrences
// within the sync window. `base` is the parsed event (has .date, .end_date, .rrule, .exdates).
function expandRecurrence(base) {
  const rule = parseRRule(base.rrule);
  if (!rule.freq) return [{ date: base.date, end_date: base.end_date }]; // malformed RRULE — treat as one-off

  const today = new Date();
  const windowStart = addDays(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`, -RECURRENCE_WINDOW_PAST_DAYS);
  const windowEnd   = addDays(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`, RECURRENCE_WINDOW_FUTURE_DAYS);
  const hardStop    = rule.until && rule.until < windowEnd ? rule.until : windowEnd;
  const exdateSet   = new Set(base.exdates || []);

  // Span length (in days) stays constant across all occurrences for multi-day events
  const spanDays = base.end_date
    ? Math.round((new Date(base.end_date+'T00:00:00') - new Date(base.date+'T00:00:00')) / 86400000)
    : 0;

  const occurrences = [];
  let count = 0;
  const MAX_ITER = 3000; // safety valve against pathological/infinite-loop RRULEs
  let iter = 0;

  if (rule.freq === 'YEARLY' && !rule.byday) {
    let i = 0;
    while (iter++ < MAX_ITER) {
      const d = addYears(base.date, i * rule.interval); // always offset from the ORIGINAL date, not the previous occurrence — avoids clamp-drift (e.g. Feb 29 -> Feb 28 sticking permanently)
      if (d > hardStop) break;
      if (d >= windowStart && !exdateSet.has(d)) {
        occurrences.push({ date: d, end_date: spanDays ? addDays(d, spanDays) : null });
        count++;
      }
      if (rule.count && count >= rule.count) break;
      i++;
    }
  } else if (rule.freq === 'MONTHLY' && !rule.byday) {
    let i = 0;
    while (iter++ < MAX_ITER) {
      const d = addMonths(base.date, i * rule.interval); // same fix as above, for monthly (e.g. Jan 31 -> Feb 28 -> back to Mar 31, not stuck at 28)
      if (d > hardStop) break;
      if (d >= windowStart && !exdateSet.has(d)) {
        occurrences.push({ date: d, end_date: spanDays ? addDays(d, spanDays) : null });
        count++;
      }
      if (rule.count && count >= rule.count) break;
      i++;
    }
  } else if (rule.freq === 'WEEKLY' || (rule.freq === 'MONTHLY' && rule.byday) || (rule.freq === 'YEARLY' && rule.byday)) {
    // BYDAY-based patterns ("every Mon/Wed/Fri", "2nd Tuesday of the month", etc.)
    // Walk day-by-day through the window and test each candidate date against the rule —
    // simpler and more robust than computing offsets directly, at the cost of more iterations.
    // A WEEKLY rule with NO BYDAY (common from iCloud/Apple for simple weekly events)
    // implies "the same weekday as DTSTART". Without this, targetWeekdays was empty and
    // NOTHING matched — silently dropping the entire series.
    let effectiveByday = rule.byday;
    if (!effectiveByday && rule.freq === 'WEEKLY') {
      effectiveByday = [WEEKDAY_CODES[new Date(base.date + 'T00:00:00').getDay()]];
    }
    const targetWeekdays = (effectiveByday || []).map(code => {
      const m = code.match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
      return m ? { ord: m[1] ? parseInt(m[1]) : null, day: WEEKDAY_CODES.indexOf(m[2]) } : null;
    }).filter(Boolean);

    let d = base.date < windowStart ? windowStart : base.date;
    const scanEnd = hardStop < windowEnd ? hardStop : windowEnd;

    // BYSETPOS (e.g. "BYDAY=MO;BYSETPOS=3" = 3rd Monday) selects the Nth matching
    // day within each period rather than every match. We collect the raw weekday
    // matches first, then — if BYSETPOS is set — keep only the chosen position(s)
    // within each month. This is the format Outlook/Exchange use, and without it
    // "3rd Monday" was expanding to EVERY Monday.
    const useSetPos = rule.bysetpos && (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY');
    const candidatesByPeriod = {}; // 'YYYY-MM' -> [dateStr, ...] in chronological order

    while (d <= scanEnd && iter++ < MAX_ITER * 5) {
      const dd = new Date(d + 'T00:00:00');
      const weekday = dd.getDay();

      // BYMONTH restriction (e.g. Thanksgiving = FREQ=YEARLY;BYMONTH=11;BYDAY=4TH):
      // only months in the list are eligible. Without this, "4th Thursday" matched
      // in every month, producing ~12x too many (wrong) occurrences.
      const monthOk = !rule.bymonth || rule.bymonth.includes(dd.getMonth() + 1);

      const matchesDay = monthOk && targetWeekdays.some(t => {
        if (t.day !== weekday) return false;
        if (t.ord === null) return true; // no ordinal = every occurrence of this weekday
        // Ordinal (e.g. "2TU" = 2nd Tuesday, "-1FR" = last Friday of the month) only
        // applies for MONTHLY/YEARLY; figure out which occurrence-of-the-month this is.
        const dayOfMonth = dd.getDate();
        const occurrenceInMonth = Math.ceil(dayOfMonth / 7); // 1st, 2nd, 3rd... occurrence of this weekday in the month
        if (t.ord > 0) return occurrenceInMonth === t.ord;
        // Negative ordinal: count from the end of the month instead
        const lastDayOfMonth = new Date(dd.getFullYear(), dd.getMonth() + 1, 0).getDate();
        const occurrencesRemainingInMonth = Math.ceil((lastDayOfMonth - dayOfMonth + 1) / 7);
        return occurrencesRemainingInMonth === Math.abs(t.ord);
      });

      // INTERVAL for WEEKLY is approximated by week-count parity from the start date;
      // good enough for the "every other week" case without full WKST handling.
      // Real bug found here: subtracting two LOCAL-time Date objects (`dd` and a
      // fresh `new Date(base.date+'T00:00:00')`) loses or gains an hour across any
      // DST transition the span crosses, so the millisecond difference isn't a
      // clean multiple of a day — e.g. Jan 5 to Mar 9, 2026 (crossing the Mar 8
      // spring-forward) comes out to 62.958 days instead of exactly 63, and
      // Math.floor() of that turns an ODD week into an even one, matching a week
      // an every-2-weeks rule should have skipped. Confirmed live: an
      // INTERVAL=2;BYDAY=MO rule starting 2026-01-05 produced an extra occurrence
      // on 2026-03-09, one week early. Fixed the same way this file's own
      // isoWeekStr()/getKidStreak() already do date-only math elsewhere: build
      // both endpoints with Date.UTC() from their calendar Y/M/D instead of
      // parsing a local-time string — UTC has no DST, so the day count is exact
      // regardless of what the span crosses.
      const [baseY, baseM, baseD] = base.date.split('-').map(Number);
      const weeksSinceStart = Math.floor((Date.UTC(dd.getFullYear(), dd.getMonth(), dd.getDate()) - Date.UTC(baseY, baseM - 1, baseD)) / (7*86400000));
      const intervalOk = rule.freq !== 'WEEKLY' || rule.interval <= 1 || (weeksSinceStart % rule.interval === 0);

      if (matchesDay && intervalOk && d >= base.date) {
        if (useSetPos) {
          // Defer selection: bucket by month, choose the Nth after scanning.
          const periodKey = `${dd.getFullYear()}-${dd.getMonth()}`;
          (candidatesByPeriod[periodKey] ||= []).push(d);
        } else if (d >= windowStart && !exdateSet.has(d)) {
          occurrences.push({ date: d, end_date: spanDays ? addDays(d, spanDays) : null });
          count++;
          if (rule.count && count >= rule.count) break;
        }
      }
      d = addDays(d, 1);
    }

    // Apply BYSETPOS: from each month's ordered candidate list, keep only the
    // positions named (1-based; negatives count from the end, so -1 = last).
    if (useSetPos) {
      const periods = Object.keys(candidatesByPeriod).sort((a, b) => {
        const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
        return ay !== by ? ay - by : am - bm;
      });
      for (const key of periods) {
        const list = candidatesByPeriod[key];
        // Skip a month whose end falls past the scan window: its candidate list is
        // incomplete, so a negative BYSETPOS (-1 = "last") would wrongly pick a
        // mid-month day. Only apply BYSETPOS to fully-scanned months.
        const [py, pm] = key.split('-').map(Number); // pm is 0-indexed month
        const lastDayOfPeriod = `${py}-${String(pm+1).padStart(2,'0')}-${String(new Date(py, pm+1, 0).getDate()).padStart(2,'0')}`;
        if (lastDayOfPeriod > scanEnd) continue;
        for (const posRaw of rule.bysetpos) {
          const idx = posRaw > 0 ? posRaw - 1 : list.length + posRaw; // -1 => last
          const chosen = list[idx];
          if (chosen && chosen >= windowStart && !exdateSet.has(chosen)) {
            occurrences.push({ date: chosen, end_date: spanDays ? addDays(chosen, spanDays) : null });
            count++;
            if (rule.count && count >= rule.count) break;
          }
        }
        if (rule.count && count >= rule.count) break;
      }
      // BYSETPOS results were gathered per-month in order; ensure global sort.
      occurrences.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    }
  } else if (rule.freq === 'DAILY') {
    let d = base.date;
    while (d <= hardStop && iter++ < MAX_ITER) {
      if (d >= windowStart && !exdateSet.has(d)) {
        occurrences.push({ date: d, end_date: spanDays ? addDays(d, spanDays) : null });
        count++;
      }
      if (rule.count && count >= rule.count) break;
      d = addDays(d, rule.interval);
    }
  } else {
    // Unsupported FREQ (SECONDLY/MINUTELY/HOURLY essentially never appear for
    // all-day personal events) — fall back to just the single base occurrence.
    return [{ date: base.date, end_date: base.end_date }];
  }

  return occurrences.length ? occurrences : [{ date: base.date, end_date: base.end_date }];
}

async function syncFeed(feed) {
  const icsText = await fetchUrl(feed.url);

  // A real .ics response always starts with this — if it's missing, the host
  // likely returned something else entirely (an HTML error/login page, an
  // empty body, etc.) even with a 200 status, which silently produced "0
  // events synced" with no visible error before this check existed.
  if (!icsText || !icsText.includes('BEGIN:VCALENDAR')) {
    throw new Error(
      'Response did not look like a calendar file (no BEGIN:VCALENDAR found) — ' +
      'the server may be blocking this kind of automated request, or the URL may be wrong.'
    );
  }

  const parsedEvents = parseICS(icsText, feed.id, feed.color, getLocalTimezone());

  // Expand recurring events (RRULE) into one row per occurrence within the sync
  // window; non-recurring events pass through as a single occurrence unchanged.
  const occurrences = [];
  for (const e of parsedEvents) {
    if (e.rrule) {
      for (const occ of expandRecurrence(e)) {
        occurrences.push({ ...e, date: occ.date, end_date: occ.end_date });
      }
    } else {
      occurrences.push(e);
    }
  }

  // Replace all events for this feed
  const replace = db.transaction(() => {
    db.prepare(`DELETE FROM ical_events WHERE feed_id = ?`).run(feed.id);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO ical_events (uid, feed_id, title, date, end_date, start_time, end_time, notes, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of occurrences) {
      const endDate = (e.end_date && e.end_date > e.date) ? e.end_date : null;
      insert.run(e.uid, feed.id, e.title, e.date, endDate, e.start_time || null, e.end_time || null, e.notes || '', e.location || '');
    }
    db.prepare(`UPDATE ical_feeds SET last_synced = datetime('now') WHERE id = ?`).run(feed.id);
  });
  replace();
  console.log(`Synced feed "${feed.name}": ${parsedEvents.length} events (${occurrences.length} occurrences after expanding recurrences)`);
  return occurrences.length;
}

// Auto-sync all enabled feeds — interval is configurable in Settings (default 30 min)
async function syncAllFeeds() {
  const feeds = db.prepare(`SELECT * FROM ical_feeds WHERE enabled = 1`).all();
  for (const feed of feeds) {
    try { await syncFeed(feed); }
    catch (e) { console.error(`Feed sync failed for "${feed.name}":`, e.message); }
  }
  if (feeds.length) broadcastUpdate('events');
}

function getSyncIntervalMs() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'ical_sync_minutes'`).get();
  const minutes = parseInt(row?.value) || 30;
  return minutes * 60 * 1000;
}

function scheduleNextSync() {
  setTimeout(async () => {
    await syncAllFeeds();
    scheduleNextSync(); // reschedule using whatever the interval setting is *now*
  }, getSyncIntervalMs());
}
scheduleNextSync();
// Also sync on startup after a short delay
setTimeout(syncAllFeeds, 3000);

// ── Pushing local events out to external calendars (iCloud + Google) ────────
// Everything above about calendars is the PULL side: subscribe to a published
// .ics URL and display it, read-only. Everything below is the PUSH side: when
// someone creates a local event here, also write it to their real iCloud
// and/or Google calendar so it shows up in Apple Calendar / Google Calendar
// on their other devices. Both are opt-in per household, both best-effort — a
// push that fails NEVER blocks or fails the local event's own create/update/
// delete (the local copy is always the source of truth), it just gets
// recorded on the row and retried by a background sweep.
//
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
      const req = https.request({
        hostname: target.hostname,
        port: target.port || 443,
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
            return attempt(new URL(res.headers.location, currentUrl).toString(), redirectsLeft - 1);
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

// CalDAV servers vary which namespace prefix they put on DAV:/caldav: elements
// (d:, D:, cal:, or none) — strip the prefixes so one set of tag-matching
// regexes works regardless. Same hand-rolled approach as parseICS(); the
// responses here are flat and predictable enough that a full XML parser
// dependency isn't worth it.
function stripXmlNsPrefixes(xml) {
  return xml.replace(/<(\/?)[a-zA-Z0-9_.-]+:/g, '<$1');
}
function xmlFirstTag(xml, tag) {
  const m = stripXmlNsPrefixes(xml).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}
function xmlFirstHref(xml) {
  const m = stripXmlNsPrefixes(xml).match(/<href[^>]*>([^<]+)<\/href>/i);
  return m ? m[1].trim() : null;
}

const ICLOUD_CALDAV_ROOT = 'https://caldav.icloud.com/';

// RFC 6764 discovery against iCloud: principal -> calendar-home-set -> list of
// calendar collections that actually accept VEVENTs. Returns [{url, name}].
async function discoverCalDAVCalendars(username, password) {
  const auth = { user: username, pass: password };
  const xmlHeaders = { 'Content-Type': 'text/xml; charset=utf-8', 'Depth': '0' };

  // 1. current-user-principal (also resolves the per-account host via redirect)
  const principalReq = await httpsRequest(ICLOUD_CALDAV_ROOT, 'PROPFIND', {
    auth, headers: xmlHeaders,
    body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`,
  });
  if (principalReq.statusCode === 401) throw new Error('iCloud rejected the Apple ID or app-specific password.');
  if (principalReq.statusCode !== 207) throw new Error(`Unexpected response from iCloud (HTTP ${principalReq.statusCode}) while looking up the account.`);
  const origin = new URL(principalReq.finalUrl).origin;
  const principalHref = xmlFirstTag(principalReq.body, 'current-user-principal') && xmlFirstHref(xmlFirstTag(principalReq.body, 'current-user-principal'));
  if (!principalHref) throw new Error('Could not find the iCloud account principal in the response.');

  // 2. calendar-home-set
  const homeReq = await httpsRequest(new URL(principalHref, origin).toString(), 'PROPFIND', {
    auth, headers: xmlHeaders,
    body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><c:calendar-home-set/></prop></propfind>`,
  });
  if (homeReq.statusCode !== 207) throw new Error(`Unexpected response from iCloud (HTTP ${homeReq.statusCode}) while looking up the calendar home.`);
  const homeSetInner = xmlFirstTag(homeReq.body, 'calendar-home-set');
  const homeHref = homeSetInner && xmlFirstHref(homeSetInner);
  if (!homeHref) throw new Error('Could not find the iCloud calendar home in the response.');

  // 3. enumerate calendar collections (Depth: 1)
  const listReq = await httpsRequest(new URL(homeHref, origin).toString(), 'PROPFIND', {
    auth, headers: { ...xmlHeaders, 'Depth': '1' },
    body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><displayname/><resourcetype/><c:supported-calendar-component-set/></prop></propfind>`,
  });
  if (listReq.statusCode !== 207) throw new Error(`Unexpected response from iCloud (HTTP ${listReq.statusCode}) while listing calendars.`);

  // Parse the multistatus. Deliberately lenient — iCloud varies tag
  // attributes and namespace placement between accounts, and the failure
  // mode of being too strict (an EMPTY picker) is far worse than being too
  // loose (one stray non-event calendar in the list). So: keep any child
  // collection under the home whose resourcetype names "calendar", and
  // only drop one if its component set is present AND explicitly has no
  // VEVENT (a VTODO-only Reminders list). A parse miss on the component
  // set means "keep it", not "drop it".
  const stripped = stripXmlNsPrefixes(listReq.body);
  const normPath = (u) => { try { return new URL(u, origin).pathname.replace(/\/?$/, '/'); } catch { return String(u).replace(/\/?$/, '/'); } };
  const homePath = normPath(homeHref);
  const blocks = stripped.split(/<response[\s>]/i).slice(1);
  const seenHrefs = [];
  const calendars = [];
  for (const block of blocks) {
    const href = (block.match(/<href[^>]*>([^<]+)<\/href>/i) || [])[1];
    if (!href) continue;
    seenHrefs.push(href.trim());
    if (normPath(href.trim()) === homePath) continue;             // the calendar-home collection itself
    const rt = (block.match(/<resourcetype[\s>]([\s\S]*?)<\/resourcetype>/i) || [])[1] || '';
    if (!/<calendar[\s/>]/i.test(rt)) continue;                    // not a calendar collection (inbox/outbox/dropbox/etc.)
    const compSet = (block.match(/<supported-calendar-component-set[\s>]([\s\S]*?)<\/supported-calendar-component-set>/i) || [])[1];
    if (compSet && !/VEVENT/i.test(compSet)) continue;             // present and definitively event-less -> skip
    const nameMatch = block.match(/<displayname[^>]*>([^<]*)<\/displayname>/i);
    calendars.push({
      url: new URL(href.trim(), origin).toString(),
      name: (nameMatch && nameMatch[1].trim()) || href.trim(),
    });
  }
  if (!calendars.length) {
    console.error('CalDAV discovery found no calendars. Raw list body:\n' + listReq.body.slice(0, 4000));
    throw new Error(`Connected to iCloud, but couldn't match any calendars. Collections it returned: ${seenHrefs.slice(0, 20).join(', ') || '(none)'}`);
  }
  return calendars;
}

// ── Building the VEVENT to push ──────────────────────────────────────────────
function escapeICSText(s) {
  // Inverse of decodeICSText(): backslash FIRST, then the rest.
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
// RFC 5545: content lines must be folded at <=75 octets, continuations start
// with a single space. `notes` can run to 500 chars, well past that.
function foldICSLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 74) return line;
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (out.length ? 73 : 74), bytes.length);
    // Don't split a multi-byte UTF-8 sequence: back up while the next byte is a continuation byte (10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((out.length ? ' ' : '') + bytes.slice(start, end).toString('utf8'));
    start = end;
  }
  return out.join('\r\n');
}
function icsStamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function caldavUidFor(eventId) { return `piazzahq-local-${eventId}@piazzahq.local`; }

// Turns an `events` table row into a full VCALENDAR document for a PUT.
function buildEventICS(row) {
  const uid = caldavUidFor(row.id);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Piazza HQ//Local Event//EN', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${icsStamp()}`];

  if (!row.start_time) {
    // All-day. DTEND is exclusive per RFC 5545 — one day past the last day.
    const endExclusive = new Date((row.end_date || row.date) + 'T00:00:00');
    endExclusive.setDate(endExclusive.getDate() + 1);
    const endStr = `${endExclusive.getFullYear()}${String(endExclusive.getMonth() + 1).padStart(2, '0')}${String(endExclusive.getDate()).padStart(2, '0')}`;
    lines.push(`DTSTART;VALUE=DATE:${row.date.replace(/-/g, '')}`);
    lines.push(`DTEND;VALUE=DATE:${endStr}`);
  } else {
    // Timed. Floating local time (no Z, no TZID) — this app has one global
    // timezone and treats floating times as "take as written", matching
    // parseICSDate()'s own handling of the inbound side.
    const startD = (row.date || '').replace(/-/g, '');
    const startT = (row.start_time || '00:00').replace(/:/g, '') + '00';
    lines.push(`DTSTART:${startD}T${startT}`);
    if (row.end_time) {
      const endD = ((row.end_date || row.date) || '').replace(/-/g, '');
      const endT = row.end_time.replace(/:/g, '') + '00';
      lines.push(`DTEND:${endD}T${endT}`);
    }
  }

  lines.push(foldICSLine(`SUMMARY:${escapeICSText(row.title)}`));
  if (row.notes) lines.push(foldICSLine(`DESCRIPTION:${escapeICSText(row.notes)}`));
  if (row.location) lines.push(foldICSLine(`LOCATION:${escapeICSText(row.location)}`));
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ── Push / delete a single event ────────────────────────────────────────────
function getCaldavConfig() {
  return {
    enabled: getSetting('icloud_push_enabled') === '1',
    username: getSetting('icloud_username') || '',
    password: getSetting('icloud_app_password') || '',
    calendarUrl: getSetting('icloud_calendar_url') || '',
  };
}
function caldavObjectUrl(calendarUrl, eventId) {
  return calendarUrl.replace(/\/?$/, '/') + `piazzahq-local-${eventId}.ics`;
}
function setEventCaldavFields(id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  db.prepare(`UPDATE events SET ${cols.map(c => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...cols.map(c => fields[c]), id);
}

// Never throws to its caller — fire-and-forget from the /api/events handlers.
// Serves both "create" and "edit" (deterministic object URL => an edit is just
// a re-PUT to the same place). No-ops silently unless push is fully configured.
async function pushLocalEventToCalDAV(row) {
  if (IS_DEMO) return;
  try {
    const cfg = getCaldavConfig();
    if (!cfg.username || !cfg.password) return;
    const t = row.target_calendar || null;
    if (t === 'local' || t === 'google') return; // explicitly not an iCloud target
    // Which calendar: an explicit per-event choice wins (and overrides the
    // global enable toggle — the user picked it on purpose); otherwise fall
    // back to the configured default calendar, which does respect the toggle.
    let calendarUrl;
    if (t && t.startsWith('caldav:')) {
      calendarUrl = t.slice('caldav:'.length);
    } else {
      if (!cfg.enabled || !cfg.calendarUrl) return;
      calendarUrl = cfg.calendarUrl;
    }
    if (!calendarUrl) return;
    const objUrl = caldavObjectUrl(calendarUrl, row.id);
    const res = await httpsRequest(objUrl, 'PUT', {
      auth: { user: cfg.username, pass: cfg.password },
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      body: buildEventICS(row),
    });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      setEventCaldavFields(row.id, {
        caldav_uid: caldavUidFor(row.id),
        caldav_url: objUrl,
        caldav_pushed_at: new Date().toISOString(),
        caldav_push_error: null,
      });
    } else {
      setEventCaldavFields(row.id, { caldav_push_error: `HTTP ${res.statusCode}` });
      console.error(`CalDAV push failed for event ${row.id}: HTTP ${res.statusCode} ${res.body.slice(0, 200)}`);
    }
  } catch (e) {
    try { setEventCaldavFields(row.id, { caldav_push_error: e.message.slice(0, 300) }); } catch {}
    console.error(`CalDAV push failed for event ${row.id}:`, e.message);
  }
}

// Never throws. No-ops if the row was never pushed. Fired from the DELETE
// handler AFTER the local row is already gone, so it takes the pre-delete row.
async function deleteEventFromCalDAV(row) {
  if (IS_DEMO) return;
  try {
    if (!row || !row.caldav_url) return;
    const cfg = getCaldavConfig();
    if (!cfg.username || !cfg.password) return; // can't authenticate; leave the remote copy, nothing better to do
    const res = await httpsRequest(row.caldav_url, 'DELETE', {
      auth: { user: cfg.username, pass: cfg.password },
    });
    if (!((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 404)) {
      console.error(`CalDAV delete failed for event ${row.id}: HTTP ${res.statusCode}`);
    }
  } catch (e) {
    console.error(`CalDAV delete failed for event ${row.id}:`, e.message);
  }
}

// ── Google Calendar push ───────────────────────────────────────────────────
// Same shape as the CalDAV push above, but Google's a REST/JSON API behind
// OAuth instead of CalDAV+app-password. Connecting uses a standard
// authorization-code + PKCE flow, but relayed through the mothership: Google
// redirects to https://piazzahq.com/oauth/google/callback (a stable URL this
// wall-mounted box doesn't have), which stashes the auth code; this box polls
// for it and does the token exchange itself. (The device/"limited input" flow
// would need no redirect at all, but Google doesn't allow Calendar scopes
// through it — hence the relay.) See /api/google/connect-start below.
//
// client_id/client_secret are a SINGLE OAuth client shared across every
// household (owned by the project, not created per install). They're read
// from env first (GOOGLE_OAUTH_CLIENT_ID / _SECRET, e.g. via systemd
// EnvironmentFile) with a settings-row fallback so the mothership can push
// them down at provision time later without a code change. The secret and the
// PKCE verifier never leave this box — the mothership only ever sees a
// short-lived single-use auth code, useless without them.
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_CAL_API = 'https://www.googleapis.com/calendar/v3';
// calendar.events lets us insert/update/delete events on any calendar the
// user can access — but NOT list their calendars (that needs the broader
// calendar/calendar.readonly scope, which drags in a heavier OAuth
// verification). So we don't offer a picker: events go to `primary` by
// default, with an optional manual calendar-ID override. `openid email` is
// non-sensitive and just gives us the account address for the UI.
const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events';

function getGoogleConfig() {
  return {
    enabled: getSetting('google_push_enabled') === '1',
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || getSetting('google_oauth_client_id') || '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || getSetting('google_oauth_client_secret') || '',
    refreshToken: getSetting('google_refresh_token') || '',
    calendarId: getSetting('google_calendar_id') || '',
  };
}
function googleClientConfigured() {
  const c = getGoogleConfig();
  return !!(c.clientId && c.clientSecret);
}
function setGoogleDisconnected() {
  for (const k of ['google_refresh_token', 'google_access_token', 'google_access_token_expiry',
                   'google_account_email', 'google_calendar_id', 'google_calendar_name']) setSetting(k, '');
  setSetting('google_push_enabled', '0');
}

const formEncode = (obj) => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

// Returns a currently-valid access token, refreshing (and caching) if the
// stored one is missing or within 5 min of expiry. Throws if not connected.
async function getGoogleAccessToken() {
  const cfg = getGoogleConfig();
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('Google OAuth client is not configured on this server.');
  if (!cfg.refreshToken) throw new Error("Google Calendar isn't connected.");
  const cached = getSetting('google_access_token') || '';
  const expiry = Number(getSetting('google_access_token_expiry') || 0);
  if (cached && Date.now() < expiry - 5 * 60 * 1000) return cached;
  const res = await httpsRequest(GOOGLE_TOKEN_URL, 'POST', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken, grant_type: 'refresh_token' }),
  });
  let data = {}; try { data = JSON.parse(res.body || '{}'); } catch {}
  if (res.statusCode !== 200 || !data.access_token) {
    // A revoked/expired refresh token is permanent — reflect that in the UI
    // rather than failing every push forever against a dead credential.
    if (data.error === 'invalid_grant') setGoogleDisconnected();
    throw new Error('Google token refresh failed: ' + (data.error || `HTTP ${res.statusCode}`));
  }
  setSetting('google_access_token', data.access_token);
  setSetting('google_access_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
  return data.access_token;
}

async function googleApi(pathOrUrl, method, { token, body } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : GOOGLE_CAL_API + pathOrUrl;
  const res = await httpsRequest(url, method, {
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });
  let json = null; try { json = res.body ? JSON.parse(res.body) : null; } catch {}
  return { statusCode: res.statusCode, json, raw: res.body };
}

// The connected account's email, from the OpenID userinfo endpoint (the
// `openid email` scope). Cosmetic — for the "Connected as X" line. Best
// effort; returns '' if it fails.
async function googleGetAccountEmail(token) {
  try {
    const res = await httpsRequest(GOOGLE_USERINFO_URL, 'GET', { headers: { 'Authorization': `Bearer ${token}` } });
    const j = JSON.parse(res.body || '{}');
    return (res.statusCode === 200 && j.email) ? j.email : '';
  } catch { return ''; }
}

// Turns an `events` row into the JSON body Google's API wants. Mirrors
// buildEventICS()'s handling of all-day vs timed and exclusive end dates.
function googleEventBody(row) {
  const b = { id: `phqlocal${row.id}`, summary: row.title || '(no title)' };
  if (row.notes) b.description = row.notes;
  if (row.location) b.location = row.location;
  if (!row.start_time) {
    const endExclusive = new Date((row.end_date || row.date) + 'T00:00:00');
    endExclusive.setDate(endExclusive.getDate() + 1);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    b.start = { date: row.date };
    b.end = { date: iso(endExclusive) };
  } else {
    const tz = getLocalTimezone();
    b.start = { dateTime: `${row.date}T${row.start_time}:00`, timeZone: tz };
    b.end = { dateTime: `${row.end_date || row.date}T${(row.end_time || row.start_time)}:00`, timeZone: tz };
  }
  return b;
}

async function pushLocalEventToGoogle(row) {
  if (IS_DEMO) return;
  try {
    const cfg = getGoogleConfig();
    const t = row.target_calendar || null;
    if (t === 'local' || (t && t.startsWith('caldav:'))) return; // explicitly not a Google target
    // An explicit 'google' choice pushes even if the global toggle is off;
    // the default (no choice) still respects the toggle.
    if (t !== 'google' && !cfg.enabled) return;
    if (!cfg.refreshToken || !cfg.calendarId || !googleClientConfigured()) return;
    const token = await getGoogleAccessToken();
    const calId = encodeURIComponent(cfg.calendarId);
    const gid = `phqlocal${row.id}`;
    // Insert with our deterministic id; if it already exists (edit / retry),
    // Google 409s and we switch to a full update at that id — same
    // create-or-update shape as the CalDAV re-PUT.
    let res = await googleApi(`/calendars/${calId}/events`, 'POST', { token, body: googleEventBody(row) });
    if (res.statusCode === 409) {
      res = await googleApi(`/calendars/${calId}/events/${gid}`, 'PUT', { token, body: googleEventBody(row) });
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      setEventCaldavFields(row.id, { google_event_id: gid, google_pushed_at: new Date().toISOString(), google_push_error: null });
    } else {
      const msg = (res.json && res.json.error && res.json.error.message) || `HTTP ${res.statusCode}`;
      setEventCaldavFields(row.id, { google_push_error: String(msg).slice(0, 300) });
      console.error(`Google push failed for event ${row.id}: ${msg}`);
    }
  } catch (e) {
    try { setEventCaldavFields(row.id, { google_push_error: e.message.slice(0, 300) }); } catch {}
    console.error(`Google push failed for event ${row.id}:`, e.message);
  }
}

async function deleteEventFromGoogle(row) {
  if (IS_DEMO) return;
  try {
    if (!row || !row.google_event_id) return;
    const cfg = getGoogleConfig();
    if (!cfg.refreshToken || !googleClientConfigured()) return;
    const calId = encodeURIComponent(cfg.calendarId || 'primary');
    const token = await getGoogleAccessToken();
    const res = await googleApi(`/calendars/${calId}/events/${row.google_event_id}`, 'DELETE', { token });
    if (!((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 404 || res.statusCode === 410)) {
      console.error(`Google delete failed for event ${row.id}: HTTP ${res.statusCode}`);
    }
  } catch (e) {
    console.error(`Google delete failed for event ${row.id}:`, e.message);
  }
}

// One sweep, both targets. Host-only — a slave proxies its event writes to
// the host, so it never runs a push and has nothing to retry.
async function retryFailedExternalPushes() {
  if (IS_DEMO) return;
  if (isSlave()) return;
  // Gate only on having credentials, not on the enable toggle — a row can
  // carry an explicit per-event target that should push regardless. The
  // per-row push functions make the real decision.
  const caldav = getCaldavConfig();
  if (caldav.username && caldav.password) {
    for (const row of db.prepare(`SELECT * FROM events WHERE caldav_push_error IS NOT NULL`).all()) {
      await pushLocalEventToCalDAV(row);
    }
  }
  const google = getGoogleConfig();
  if (google.refreshToken && googleClientConfigured()) {
    for (const row of db.prepare(`SELECT * FROM events WHERE google_push_error IS NOT NULL`).all()) {
      await pushLocalEventToGoogle(row);
    }
  }
}
setInterval(retryFailedExternalPushes, 15 * 60 * 1000);

// ── Home Assistant condition alerts ────────────────────────────────────────
// A small rules engine: "if entity X's state is/above/below Y for N minutes,
// raise an alert." Alerts show as a banner on the display (which polls
// /api/ha-alerts/active). Fire-once semantics: an alert fires when the
// condition has held for its dwell time, and does NOT fire again until the
// condition first goes false (or the person dismisses it, which also waits
// for a false before it can re-fire). Host-only — a slave proxies its reads
// to the host and never runs this loop.
function getHaAlerts() {
  try { const a = JSON.parse(getSetting('ha_alerts_json') || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
const _haAlertRuntime = new Map();  // id -> { since, firing, dismissed }
const _haActiveAlerts = new Map();  // id -> { id, message, entityName, firedAt }

function evalHaAlertCondition(op, current, value) {
  if (op === 'eq') return String(current).toLowerCase() === String(value).toLowerCase();
  const n = parseFloat(current), v = parseFloat(value);
  if (!Number.isFinite(n) || !Number.isFinite(v)) return false;
  if (op === 'above') return n > v;
  if (op === 'below') return n < v;
  return false;
}

async function checkHaAlerts() {
  if (IS_DEMO) return;
  if (isSlave()) return;
  const base = getSetting('ha_base_url'), token = getSetting('ha_token');
  if (!base || !token) return;
  const alerts = getHaAlerts().filter(a => a && a.enabled && a.entityId && a.op);
  const liveIds = new Set(alerts.map(a => a.id));
  for (const id of [..._haAlertRuntime.keys()]) if (!liveIds.has(id)) {
    _haAlertRuntime.delete(id); _haActiveAlerts.delete(id); clearNotification(`ha-alert:${id}`);
  }
  for (const a of alerts) {
    let cur;
    try { cur = await haRequest(`/api/states/${encodeURIComponent(a.entityId)}`); }
    catch { continue; } // entity temporarily unreachable — leave state as-is
    const met = evalHaAlertCondition(a.op, cur.state, a.value);
    const rt = _haAlertRuntime.get(a.id) || { since: null, firing: false, dismissed: false };
    if (!met) {
      rt.since = null; rt.firing = false; rt.dismissed = false;
      _haActiveAlerts.delete(a.id);
      clearNotification(`ha-alert:${a.id}`);
    } else {
      if (rt.since == null) rt.since = Date.now();
      const held = (Date.now() - rt.since) >= (Number(a.dwellMin) || 0) * 60000;
      if (held && !rt.firing && !rt.dismissed) {
        rt.firing = true;
        const name = (cur.attributes && cur.attributes.friendly_name) || a.name || a.entityId;
        const opText = a.op === 'eq' ? `is "${a.value}"` : a.op === 'above' ? `above ${a.value}` : `below ${a.value}`;
        const message = (a.message && a.message.trim()) || `${name} ${opText}`;
        _haActiveAlerts.set(a.id, { id: a.id, message, entityName: name, firedAt: Date.now() });
        raiseNotification({ kind: 'ha-alert', key: `ha-alert:${a.id}`, title: 'Home Assistant', body: message,
          screen: a.screen !== false, phone: a.phone !== false });
      }
    }
    _haAlertRuntime.set(a.id, rt);
  }
}
setInterval(checkHaAlerts, 2 * 60 * 1000);
setTimeout(checkHaAlerts, 20 * 1000); // first pass shortly after boot

// ── Notification center — on-screen banner + optional phone relay ─────────
// One channel every producer (HA alerts today, more later) flows through.
// The display polls /api/notifications/active for the banner. If phone
// alerts are on, each NEW notification is also relayed to the household's
// phones through the mothership (the device serves plain HTTP on the LAN,
// which isn't a secure context, so it can't do Web Push itself).
const _activeNotifications = new Map(); // key -> { key, kind, title, body, url, firedAt }

// The notification kinds that exist. The delivery-preferences UI renders
// from this list; add a row here when a new producer is introduced.
const NOTIF_KINDS = [
  { id: 'ha-alert', label: 'Home Assistant alerts' },
];
function getNotifPrefs() {
  let stored = {};
  try { stored = JSON.parse(getSetting('notif_prefs_json') || '{}') || {}; } catch {}
  const out = {};
  for (const k of NOTIF_KINDS) {
    const p = stored[k.id] || {};
    out[k.id] = { screen: p.screen !== false, phone: p.phone !== false }; // default both on
  }
  return out;
}
function notifKindAllows(kind, channel) {
  const p = getNotifPrefs()[kind];
  if (!p) return true; // unknown kind — don't silently swallow it
  return p[channel] !== false;
}

// `screen` / `phone` are optional per-notification overrides (a producer,
// e.g. one HA alert rule, can force a channel off); the per-KIND preference
// gates on top of them, and phone also needs the global toggle + the relay.
function raiseNotification({ kind, key, title, body, url, screen, phone }) {
  kind = kind || 'info';
  key = key || `${kind}:${Date.now()}`;
  const toScreen = (screen !== false) && notifKindAllows(kind, 'screen');
  const toPhone  = (phone  !== false) && notifKindAllows(kind, 'phone');
  const wasNew = !_activeNotifications.has(key);
  if (toScreen) {
    _activeNotifications.set(key, {
      key, kind, title: title || 'Piazza HQ', body: body || '', url: url || '',
      firedAt: wasNew ? Date.now() : _activeNotifications.get(key).firedAt,
    });
  } else {
    _activeNotifications.delete(key); // screen delivery is off for this kind/rule
  }
  if (wasNew && toPhone) relayPushToPhones(title || 'Piazza HQ', body || '', url || '');
}
function clearNotification(key) { _activeNotifications.delete(key); }

async function relayPushToPhones(title, body, url) {
  try {
    if (IS_DEMO) return;
    if (getSetting('phone_alerts_enabled') !== '1' || isSlave()) return;
    const license = getSetting('update_license_key');
    const server = resolveUpdateServerUrl();
    if (!license || !server) return;
    await httpsRequest(`${server}/api/push/relay`, 'POST', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license, title, body, url }),
    });
  } catch { /* best-effort — a failed phone push never affects the on-screen one */ }
}

app.get('/api/notifications/active', async (req, res) => {
  if (isSlave()) {
    const base = hostBaseURL();
    if (base) { try { return res.json(await fetchJSON(`${base}/api/notifications/active`, 6000)); } catch { return res.json({ notifications: [] }); } }
    return res.json({ notifications: [] });
  }
  res.json({ notifications: [..._activeNotifications.values()].sort((a, b) => b.firedAt - a.firedAt) });
});
app.post('/api/notifications/dismiss', (req, res) => {
  const key = String((req.body && req.body.key) || '');
  clearNotification(key);
  const m = key.match(/^ha-alert:(.+)$/);
  if (m) {
    _haActiveAlerts.delete(m[1]);
    const rt = _haAlertRuntime.get(m[1]);
    if (rt) { rt.firing = false; rt.dismissed = true; _haAlertRuntime.set(m[1], rt); }
  }
  res.json({ ok: true });
});

app.get('/api/notif-prefs', (req, res) => {
  res.json({ kinds: NOTIF_KINDS, prefs: getNotifPrefs() });
});
app.put('/api/notif-prefs', (req, res) => {
  const incoming = (req.body && req.body.prefs) || {};
  const clean = {};
  for (const k of NOTIF_KINDS) {
    const p = incoming[k.id] || {};
    clean[k.id] = { screen: p.screen !== false, phone: p.phone !== false };
  }
  setSetting('notif_prefs_json', JSON.stringify(clean));
  res.json({ ok: true, prefs: clean });
});

app.get('/api/phone-alerts', (req, res) => {
  const license = getSetting('update_license_key') || '';
  const server = resolveUpdateServerUrl() || '';
  res.json({
    enabled: getSetting('phone_alerts_enabled') || '0',
    has_license: !!license,
    setup_url: (server && license) ? `${server}/notify-setup?license=${encodeURIComponent(license)}` : '',
  });
});
app.put('/api/phone-alerts', (req, res) => {
  if (req.body && req.body.enabled !== undefined) {
    setSetting('phone_alerts_enabled', String(req.body.enabled) === '1' ? '1' : '0');
  }
  res.json({ ok: true, enabled: getSetting('phone_alerts_enabled') || '0' });
});

app.get('/api/ha-alerts', (req, res) => {
  res.json({ alerts: getHaAlerts() });
});
app.put('/api/ha-alerts', (req, res) => {
  const raw = Array.isArray(req.body && req.body.alerts) ? req.body.alerts : null;
  if (!raw) return res.status(400).json({ error: 'Body must be { alerts: [...] }.' });
  const OPS = new Set(['eq', 'above', 'below']);
  const clean = raw.slice(0, 40).map(a => ({
    id: String(a.id || crypto.randomBytes(6).toString('hex')),
    entityId: String(a.entityId || '').slice(0, 200),
    name: String(a.name || '').slice(0, 120),
    op: OPS.has(a.op) ? a.op : 'eq',
    value: String(a.value == null ? '' : a.value).slice(0, 120),
    dwellMin: Math.max(0, Math.min(1440, Math.round(Number(a.dwellMin) || 0))),
    message: String(a.message || '').slice(0, 200),
    enabled: a.enabled !== false,
    screen: a.screen !== false,  // per-rule: show the banner on the display
    phone: a.phone !== false,    // per-rule: also relay to phones
  })).filter(a => a.entityId);
  setSetting('ha_alerts_json', JSON.stringify(clean));
  // Drop runtime/active for anything no longer present so a re-added rule
  // starts fresh rather than inheriting a stale "already firing" flag.
  const ids = new Set(clean.map(a => a.id));
  // Also clear the on-screen banner for a removed rule — the display polls
  // /api/notifications/active, and deleting the runtime entry here hides the
  // id from checkHaAlerts()'s own cleanup pass, so it must happen here or a
  // deleted alert's banner sticks until a server restart.
  for (const id of [..._haAlertRuntime.keys()]) if (!ids.has(id)) {
    _haAlertRuntime.delete(id); _haActiveAlerts.delete(id); clearNotification(`ha-alert:${id}`);
  }
  if (!isSlave()) setTimeout(checkHaAlerts, 500);
  res.json({ ok: true, alerts: clean });
});
app.get('/api/ha-alerts/active', async (req, res) => {
  // The evaluator only runs on the host, so a slave has no active alerts of
  // its own — proxy the read so a slave display shows the same banner.
  if (isSlave()) {
    const base = hostBaseURL();
    if (base) {
      try { return res.json(await fetchJSON(`${base}/api/ha-alerts/active`, 6000)); }
      catch { return res.json({ active: [] }); }
    }
    return res.json({ active: [] });
  }
  res.json({ active: [..._haActiveAlerts.values()].sort((a, b) => b.firedAt - a.firedAt) });
});
app.post('/api/ha-alerts/dismiss', (req, res) => {
  const id = String((req.body && req.body.id) || '');
  _haActiveAlerts.delete(id);
  const rt = _haAlertRuntime.get(id);
  if (rt) { rt.firing = false; rt.dismissed = true; _haAlertRuntime.set(id, rt); }
  res.json({ ok: true });
});

// Persists the license/trial/limits info from an update-check response locally,
// so the browser app can read current status (for the trial-ending notice and
// limit enforcement) without needing its own network round-trip to the central
// server on every page load. Purely a local cache of what the server told us —
// LOCAL_ONLY, never synced to a slave screen, since each screen refreshes its
// own copy independently on the same schedule.
// A license is only genuinely valid while 'active' (paid, no expiry while
// so), or 'trial' with a real, still-future expiry — every trial gets a
// concrete access_through date stamped at creation, never open-ended.
// 'none', 'past_due', 'canceled', or a trial whose date has passed are all
// equally "no valid license" for this purpose.
function isLicenseValid(status, trialUntil) {
  if (status === 'active') return true;
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
// A public iCloud shared album exposes an unauthenticated web feed (the same
// thing icloud.com renders for a shared-album link). We poll it like an iCal
// feed: paste a URL, the server downloads the photos into the same pool as
// uploads (source='icloud', tagged 'icloud'). Host-only; a broken album sync
// must never affect uploaded photos — errors just land in
// icloud_album_last_error. Highest-risk of the planned features (undocumented
// Apple endpoint) — keep every failure path graceful.
//
// PIAZZA_ICLOUD_HOST overrides the sharedstreams host (tests point it at a
// fake server; unset in every real deployment).

const SHARED_ALBUM_B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function parseSharedAlbumToken(url) {
  const s = String(url || '').trim();
  // Classic tokens are ~15 alphanumerics; newer "Copy Link" tokens are long
  // (60-120 chars) and contain '-' / '_' (base64url). Accept both shapes.
  let m = s.match(/icloud\.com\/sharedalbum\/#?([A-Za-z0-9._-]{8,240})/i);
  if (m) return m[1];
  m = s.match(/share\.icloud\.com\/photos\/([A-Za-z0-9._-]{8,240})/i);
  if (m) return m[1];
  return null;
}
function isSharedAlbumUrl(url) { return !!parseSharedAlbumToken(url); }
// First-guess partition host from the token. Correct for classic short tokens;
// modern long tokens derive to a low-numbered partition (p1/p2/…) that Apple
// no longer runs, so icloudStreamPost() falls back to a list of known-live
// partitions — whichever answers replies 330 + X-Apple-MMe-Host with the
// album's real home, which icloudStreamFollow() then chases.
function sharedAlbumBaseHost(token) {
  const seg = token[0] === 'A' ? token.slice(1, 3) : token.slice(1, 2);
  let n = 0;
  for (const ch of seg) { const d = SHARED_ALBUM_B62.indexOf(ch); if (d < 0) { n = 0; break; } n = n * 62 + d; }
  if (!Number.isFinite(n) || n < 1) n = 1;
  return `p${n}-sharedstreams.icloud.com`;
}
// Known-live sharedstreams partitions to bootstrap from when the derived guess
// doesn't resolve. Any of them will 330-redirect a valid token to its real
// partition; the list is just for resilience if one is down/renamed.
const ICLOUD_BOOTSTRAP_HOSTS = ['p23', 'p52', 'p97', 'p113', 'p143', 'p161', 'p192']
  .map(p => `${p}-sharedstreams.icloud.com`);
const _icloudTransient = (e) =>
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out|socket hang up|network|getaddrinfo/i
    .test(String((e && e.message) || e));
function icloudStreamRequest(url, bodyObj) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('bad iCloud url')); }
    const lib = u.protocol === 'http:' ? http : https;
    const payload = Buffer.from(JSON.stringify(bodyObj || {}), 'utf8');
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': payload.length,
        'User-Agent': 'PiazzaHQ/1.0', 'Origin': 'https://www.icloud.com', 'Accept': '*/*',
      },
      agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => { chunks.push(c); });
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch {}
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch {}
        resolve({ statusCode: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('iCloud request timed out')));
    req.write(payload); req.end();
  });
}
const _icloudRoot = (host) => /^https?:\/\//i.test(host) ? host.replace(/\/+$/, '') : 'https://' + host;
// One start host, chasing 330 + X-Apple-MMe-Host to the album's real partition.
async function icloudStreamFollow(host, token, endpoint, bodyObj) {
  for (let hop = 0; hop < 4; hop++) {
    const r = await icloudStreamRequest(`${_icloudRoot(host)}/${token}/sharedstreams/${endpoint}`, bodyObj);
    if (r.statusCode === 330 && r.headers['x-apple-mme-host']) { host = String(r.headers['x-apple-mme-host']); continue; }
    if (r.statusCode !== 200 || !r.json) throw new Error(`iCloud "${endpoint}" returned HTTP ${r.statusCode}`);
    return { host, json: r.json };
  }
  throw new Error(`iCloud "${endpoint}": too many partition redirects`);
}
async function icloudStreamPost(host, token, endpoint, bodyObj) {
  // Try the derived guess first; on a DNS/connection failure fall through to
  // the known-live partitions. A test host override never falls back to Apple.
  const extra = process.env.PIAZZA_ICLOUD_HOST ? [] : ICLOUD_BOOTSTRAP_HOSTS;
  const seen = new Set();
  const candidates = [host, ...extra].filter((h) => {
    const k = String(h || '').toLowerCase().replace(/^https?:\/\//, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let lastErr;
  for (const start of candidates) {
    try { return await icloudStreamFollow(start, token, endpoint, bodyObj); }
    catch (e) { lastErr = e; if (!_icloudTransient(e)) throw e; }
  }
  throw lastErr || new Error(`iCloud "${endpoint}": no reachable partition host`);
}
// Largest derivative no taller than capPx; else the smallest available.
function pickAlbumDerivative(derivatives, capPx) {
  const list = Object.values(derivatives || {})
    .map(d => ({ checksum: d && d.checksum, width: +(d && d.width) || 0, height: +(d && d.height) || 0, fileSize: +(d && d.fileSize) || 0 }))
    .filter(d => d.checksum);
  if (!list.length) return null;
  const under = list.filter(d => d.height && d.height <= capPx);
  return (under.length ? under.sort((a, b) => b.height - a.height) : list.sort((a, b) => a.height - b.height))[0];
}
function imageExtFromMagic(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null; // HEIC or anything a browser can't render — skip it
}

let _albumSyncing = false;
async function syncIcloudAlbum() {
  const out = { added: 0, removed: 0, skipped: 0 };
  if (isSlave()) return out;
  if (_albumSyncing) return { ...out, error: 'A sync is already running.' };
  const token = parseSharedAlbumToken(getSetting('icloud_album_url'));
  if (!token) return out;
  _albumSyncing = true;
  try {
    let host = process.env.PIAZZA_ICLOUD_HOST || sharedAlbumBaseHost(token);
    const ws = await icloudStreamPost(host, token, 'webstream', { streamCtag: null });
    host = ws.host;
    const stream = ws.json || {};
    const newCtag = stream.streamCtag ? String(stream.streamCtag) : '';
    const savedCtag = getSetting('icloud_album_ctag');

    let photos = Array.isArray(stream.photos) ? stream.photos.filter(p => p && p.photoGuid) : [];
    photos.sort((a, b) => String(b.dateCreated || '').localeCompare(String(a.dateCreated || '')));
    const maxN = Math.max(1, Math.min(2000, parseInt(getSetting('icloud_album_max'), 10) || 300));
    photos = photos.slice(0, maxN);
    const wantGuids = new Set(photos.map(p => p.photoGuid));

    // Removals first — a photo pulled from the album (or now past the cap)
    // gets deleted locally, regardless of the ctag.
    for (const row of db.prepare(`SELECT id, filename, ext_guid FROM photos WHERE source = 'icloud'`).all()) {
      if (!wantGuids.has(row.ext_guid)) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, row.filename)); } catch {}
        db.prepare(`DELETE FROM photos WHERE id = ?`).run(row.id);
        out.removed++;
      }
    }
    const haveGuids = new Set(db.prepare(`SELECT ext_guid FROM photos WHERE source = 'icloud'`).all().map(r => r.ext_guid));

    // Nothing changed and nothing missing → no-op poll.
    if (newCtag && newCtag === savedCtag && out.removed === 0 && [...wantGuids].every(g => haveGuids.has(g))) {
      setSetting('icloud_album_last_sync', new Date().toISOString());
      setSetting('icloud_album_last_error', '');
      return out;
    }

    const toAdd = photos.filter(p => !haveGuids.has(p.photoGuid));
    const capPx = Math.max(320, Math.min(4320, parseInt(getSetting('icloud_album_max_px'), 10) || 2160));
    for (let i = 0; i < toAdd.length; i += 20) {
      const batch = toAdd.slice(i, i + 20);
      const meta = new Map(); // checksum -> { guid, caption }
      const guids = [];
      for (const p of batch) {
        const d = pickAlbumDerivative(p.derivatives, capPx);
        if (!d) { out.skipped++; continue; }
        guids.push(p.photoGuid);
        meta.set(d.checksum, { guid: p.photoGuid, caption: String(p.caption || '').slice(0, 200) });
      }
      if (!guids.length) continue;
      const au = await icloudStreamPost(host, token, 'webasseturls', { photoGuids: guids });
      host = au.host;
      const items = (au.json && au.json.items) || {};
      for (const [checksum, m] of meta) {
        const it = items[checksum];
        if (!it || !it.url_location || !it.url_path) { out.skipped++; continue; }
        const assetUrl = (/^https?:\/\//i.test(it.url_location) ? it.url_location : 'https://' + it.url_location) + it.url_path;
        const safe = String(m.guid).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
        const tmp = path.join(UPLOAD_DIR, `.icloud.dl.${safe}.${process.pid}`);
        try {
          await downloadFile(assetUrl, tmp, 45000);
          const fd = fs.openSync(tmp, 'r');
          const hb = Buffer.alloc(16);
          fs.readSync(fd, hb, 0, 16, 0);
          fs.closeSync(fd);
          const ext = imageExtFromMagic(hb);
          if (!ext) { fs.unlinkSync(tmp); out.skipped++; continue; }
          const filename = `icloud_${safe}.${ext}`;
          fs.renameSync(tmp, path.join(UPLOAD_DIR, filename));
          const maxOrder = db.prepare(`SELECT MAX(sort_order) m FROM photos`).get().m || 0;
          db.prepare(`INSERT INTO photos (filename, label, tags, sort_order, source, ext_guid) VALUES (?,?,?,?,?,?)`)
            .run(filename, m.caption, 'icloud', maxOrder + 1, 'icloud', m.guid);
          out.added++;
        } catch (e) {
          try { fs.unlinkSync(tmp); } catch {}
          out.skipped++;
        }
      }
    }

    if (newCtag) setSetting('icloud_album_ctag', newCtag);
    setSetting('icloud_album_last_sync', new Date().toISOString());
    setSetting('icloud_album_last_error', '');
    if (out.added || out.removed) broadcastUpdate('photos');
    console.log(`[icloud-album] sync: +${out.added} -${out.removed} (${out.skipped} skipped)`);
    return out;
  } catch (e) {
    setSetting('icloud_album_last_error', String(e && e.message || e).slice(0, 300));
    console.error('[icloud-album] sync failed: ' + (e && e.message || e));
    return { ...out, error: String(e && e.message || e) };
  } finally {
    _albumSyncing = false;
  }
}
function icloudAlbumIntervalMs() {
  const m = parseInt(getSetting('icloud_album_sync_minutes'), 10);
  return Math.max(15, Number.isFinite(m) ? m : 60) * 60 * 1000;
}
function scheduleIcloudAlbumSync() {
  setTimeout(() => {
    (async () => { try { if (parseSharedAlbumToken(getSetting('icloud_album_url'))) await syncIcloudAlbum(); } catch {} })()
      .finally(scheduleIcloudAlbumSync);
  }, icloudAlbumIntervalMs());
}
scheduleIcloudAlbumSync();
setTimeout(() => { try { if (parseSharedAlbumToken(getSetting('icloud_album_url'))) syncIcloudAlbum().catch(() => {}); } catch {} }, 4500);

app.get('/api/photo-album', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    url: getSetting('icloud_album_url') || '',
    connected: !!parseSharedAlbumToken(getSetting('icloud_album_url')),
    last_sync: getSetting('icloud_album_last_sync') || '',
    last_error: getSetting('icloud_album_last_error') || '',
    count: db.prepare(`SELECT COUNT(*) n FROM photos WHERE source = 'icloud'`).get().n,
    syncing: _albumSyncing,
  });
});
app.put('/api/photo-album', (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  if (!url) return res.status(400).json({ error: 'A shared-album URL is required.' });
  if (!isSharedAlbumUrl(url)) {
    return res.status(400).json({ error: 'That doesn\'t look like an iCloud shared-album link (icloud.com/sharedalbum/#… or share.icloud.com/photos/…).' });
  }
  setSetting('icloud_album_url', url);
  setSetting('icloud_album_ctag', '');
  setSetting('icloud_album_last_error', '');
  broadcastUpdate('settings');
  syncIcloudAlbum().catch(() => {});
  res.json({ ok: true });
});
app.post('/api/photo-album/sync', async (req, res) => {
  if (!parseSharedAlbumToken(getSetting('icloud_album_url'))) return res.status(400).json({ error: 'No album connected.' });
  const r = await syncIcloudAlbum();
  res.json({ ok: !r.error, ...r });
});
app.delete('/api/photo-album', (req, res) => {
  const rows = db.prepare(`SELECT id, filename FROM photos WHERE source = 'icloud'`).all();
  for (const row of rows) { try { fs.unlinkSync(path.join(UPLOAD_DIR, row.filename)); } catch {} }
  db.prepare(`DELETE FROM photos WHERE source = 'icloud'`).run();
  for (const k of ['icloud_album_url', 'icloud_album_ctag', 'icloud_album_last_sync', 'icloud_album_last_error']) setSetting(k, '');
  broadcastUpdate('photos');
  broadcastUpdate('settings');
  res.json({ ok: true, removed: rows.length });
});

// ── Photos API ────────────────────────────────────────────────────────────────

// GET /api/photos — list all photos
app.get('/api/photos', (req, res) => {
  const photos = db.prepare(`SELECT * FROM photos ORDER BY sort_order ASC, id ASC`).all();
  res.json(photos);
});

// POST /api/photos — upload a new photo
// ── Custom theme: background + up to 3 decorations ────────────────────────────
// Deliberately global settings, not per-display — a display's "theme" picks
// among Piazza HQ's built-in themes PLUS whichever custom theme is currently
// loaded into these "live" slots below. See the custom_themes table above for
// the named, saved-snapshot side of this — these settings are just the mutable
// working copy that gets edited live and shown on displays set to "Custom".
// Old files are removed on replacement/removal so they don't silently
// accumulate on disk over time.
const VALID_DECO_BEHAVIORS = new Set(['top', 'bottom', 'left', 'right', 'random']);
function removeCustomThemeFile(settingKey) {
  const existing = updateSetting(settingKey, '');
  if (!existing) return;
  const filePath = uploadFilePath(existing);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* best-effort */ }
}
// Physically copies a custom-theme file (background or decoration) to a fresh,
// independent filename in the same directory — used any time a saved theme and
// the live working slots need to stop sharing a file, so editing one can never
// silently corrupt the other. urlPath is like "/uploads/custom-theme/bg_123.png";
// returns the new url path, or '' if there was nothing to copy.
function copyCustomThemeFile(urlPath, prefix) {
  if (!urlPath) return '';
  const srcPath = uploadFilePath(urlPath);
  if (!fs.existsSync(srcPath)) return '';
  const ext = path.extname(srcPath);
  const newName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const destPath = path.join(CUSTOM_THEME_DIR, newName);
  fs.copyFileSync(srcPath, destPath);
  return `/uploads/custom-theme/${newName}`;
}
function setSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
}

app.post('/api/custom-theme/background', uploadCustomBg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded (must be JPEG, PNG, or WebP).' });
  removeCustomThemeFile('custom_theme_bg');
  setSetting('custom_theme_bg', `/uploads/custom-theme/${req.file.filename}`);
  broadcastUpdate('displays');
  res.json({ ok: true, url: `/uploads/custom-theme/${req.file.filename}` });
});
app.delete('/api/custom-theme/background', (req, res) => {
  removeCustomThemeFile('custom_theme_bg');
  setSetting('custom_theme_bg', '');
  broadcastUpdate('displays');
  res.json({ ok: true });
});

app.post('/api/custom-theme/decoration/:slot', uploadCustomDeco.single('image'), (req, res) => {
  const slot = Number(req.params.slot);
  if (![1, 2, 3].includes(slot)) return res.status(400).json({ error: 'Slot must be 1, 2, or 3.' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded (must be PNG, for transparency).' });
  removeCustomThemeFile(`custom_theme_deco${slot}`);
  setSetting(`custom_theme_deco${slot}`, `/uploads/custom-theme/${req.file.filename}`);
  broadcastUpdate('displays');
  res.json({ ok: true, url: `/uploads/custom-theme/${req.file.filename}` });
});
app.delete('/api/custom-theme/decoration/:slot', (req, res) => {
  const slot = Number(req.params.slot);
  if (![1, 2, 3].includes(slot)) return res.status(400).json({ error: 'Slot must be 1, 2, or 3.' });
  removeCustomThemeFile(`custom_theme_deco${slot}`);
  setSetting(`custom_theme_deco${slot}`, '');
  broadcastUpdate('displays');
  res.json({ ok: true });
});
app.put('/api/custom-theme/decoration/:slot/behavior', (req, res) => {
  const slot = Number(req.params.slot);
  if (![1, 2, 3].includes(slot)) return res.status(400).json({ error: 'Slot must be 1, 2, or 3.' });
  const behavior = (req.body && req.body.behavior || '').trim();
  if (!VALID_DECO_BEHAVIORS.has(behavior)) return res.status(400).json({ error: 'Behavior must be top, bottom, left, right, or random.' });
  setSetting(`custom_theme_deco${slot}_behavior`, behavior);
  broadcastUpdate('displays');
  res.json({ ok: true });
});

// ── Saved custom theme library ────────────────────────────────────────────────
// List every saved theme (background/decorations already reflected in the live
// slots don't need re-fetching from this response — the client already has that).
app.get('/api/custom-themes', (req, res) => {
  res.json(db.prepare(`SELECT * FROM custom_themes ORDER BY updated_at DESC, id DESC`).all());
});
// Save the CURRENT live custom-theme slots as a new named theme. Copies the
// files rather than referencing the live ones, so later live edits can't
// corrupt this snapshot.
app.post('/api/custom-themes', (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  const live = {
    bg: getSetting('custom_theme_bg') || '',
    deco1: getSetting('custom_theme_deco1') || '', deco1b: getSetting('custom_theme_deco1_behavior') || 'random',
    deco2: getSetting('custom_theme_deco2') || '', deco2b: getSetting('custom_theme_deco2_behavior') || 'random',
    deco3: getSetting('custom_theme_deco3') || '', deco3b: getSetting('custom_theme_deco3_behavior') || 'random',
  };
  if (!live.bg && !live.deco1 && !live.deco2 && !live.deco3) {
    return res.status(400).json({ error: 'Build a custom theme first — upload a background or a decoration.' });
  }
  const bgFile = copyCustomThemeFile(live.bg, 'saved-bg');
  const deco1File = copyCustomThemeFile(live.deco1, 'saved-deco1');
  const deco2File = copyCustomThemeFile(live.deco2, 'saved-deco2');
  const deco3File = copyCustomThemeFile(live.deco3, 'saved-deco3');
  const r = db.prepare(`INSERT INTO custom_themes
    (name, bg_file, deco1_file, deco1_behavior, deco2_file, deco2_behavior, deco3_file, deco3_behavior)
    VALUES (?,?,?,?,?,?,?,?)`).run(name, bgFile, deco1File, live.deco1b, deco2File, live.deco2b, deco3File, live.deco3b);
  res.status(201).json(db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(r.lastInsertRowid));
});
// Rename a saved theme.
app.put('/api/custom-themes/:id', (req, res) => {
  const theme = db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found.' });
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  db.prepare(`UPDATE custom_themes SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, theme.id);
  res.json(db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(theme.id));
});
// Overwrite a saved theme's files with whatever is CURRENTLY in the live
// slots — "save my edits back to this theme" after loading + tweaking it.
app.post('/api/custom-themes/:id/update', (req, res) => {
  const theme = db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found.' });
  // Remove this theme's OWN old files (not the live ones) before replacing them.
  for (const f of [theme.bg_file, theme.deco1_file, theme.deco2_file, theme.deco3_file]) {
    if (!f) continue;
    const p = uploadFilePath(f);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
  const live = {
    bg: getSetting('custom_theme_bg') || '',
    deco1: getSetting('custom_theme_deco1') || '', deco1b: getSetting('custom_theme_deco1_behavior') || 'random',
    deco2: getSetting('custom_theme_deco2') || '', deco2b: getSetting('custom_theme_deco2_behavior') || 'random',
    deco3: getSetting('custom_theme_deco3') || '', deco3b: getSetting('custom_theme_deco3_behavior') || 'random',
  };
  const bgFile = copyCustomThemeFile(live.bg, 'saved-bg');
  const deco1File = copyCustomThemeFile(live.deco1, 'saved-deco1');
  const deco2File = copyCustomThemeFile(live.deco2, 'saved-deco2');
  const deco3File = copyCustomThemeFile(live.deco3, 'saved-deco3');
  db.prepare(`UPDATE custom_themes SET bg_file=?, deco1_file=?, deco1_behavior=?, deco2_file=?, deco2_behavior=?,
              deco3_file=?, deco3_behavior=?, updated_at=datetime('now') WHERE id=?`)
    .run(bgFile, deco1File, live.deco1b, deco2File, live.deco2b, deco3File, live.deco3b, theme.id);
  res.json(db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(theme.id));
});
// Load a saved theme INTO the live working slots — copies its files into the
// live slots (again, copies, so tweaking after loading doesn't touch the saved
// snapshot). Any display currently set to "Custom" picks this up immediately.
app.post('/api/custom-themes/:id/load', (req, res) => {
  const theme = db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found.' });
  removeCustomThemeFile('custom_theme_bg');
  removeCustomThemeFile('custom_theme_deco1');
  removeCustomThemeFile('custom_theme_deco2');
  removeCustomThemeFile('custom_theme_deco3');
  setSetting('custom_theme_bg', copyCustomThemeFile(theme.bg_file, 'bg'));
  setSetting('custom_theme_deco1', copyCustomThemeFile(theme.deco1_file, 'deco1'));
  setSetting('custom_theme_deco1_behavior', theme.deco1_behavior || 'random');
  setSetting('custom_theme_deco2', copyCustomThemeFile(theme.deco2_file, 'deco2'));
  setSetting('custom_theme_deco2_behavior', theme.deco2_behavior || 'random');
  setSetting('custom_theme_deco3', copyCustomThemeFile(theme.deco3_file, 'deco3'));
  setSetting('custom_theme_deco3_behavior', theme.deco3_behavior || 'random');
  broadcastUpdate('displays');
  res.json({ ok: true, loadedThemeId: theme.id, loadedThemeName: theme.name });
});
app.delete('/api/custom-themes/:id', (req, res) => {
  const theme = db.prepare(`SELECT * FROM custom_themes WHERE id = ?`).get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found.' });
  for (const f of [theme.bg_file, theme.deco1_file, theme.deco2_file, theme.deco3_file]) {
    if (!f) continue;
    const p = uploadFilePath(f);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
  db.prepare(`DELETE FROM custom_themes WHERE id = ?`).run(theme.id);
  res.json({ ok: true });
});

app.post('/api/photos', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const label = req.body.label || '';
  const tags = (req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean).join(',');
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM photos`).get().m || 0;
  const result = db.prepare(
    `INSERT INTO photos (filename, label, tags, sort_order) VALUES (?, ?, ?, ?)`
  ).run(req.file.filename, label, tags, maxOrder + 1);
  broadcastUpdate('photos');
  res.status(201).json(db.prepare(`SELECT * FROM photos WHERE id = ?`).get(result.lastInsertRowid));
});

// PUT /api/photos/:id — update label, tags, sort_order, or active (slideshow inclusion)
app.put('/api/photos/:id', (req, res) => {
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const { label, tags, sort_order, active } = req.body;
  const normTags = tags !== undefined
    ? String(tags).split(',').map(t => t.trim()).filter(Boolean).join(',')
    : photo.tags;
  db.prepare(`UPDATE photos SET label=?, tags=?, sort_order=?, active=? WHERE id=?`)
    .run(
      label ?? photo.label,
      normTags,
      sort_order ?? photo.sort_order,
      active !== undefined ? (active ? 1 : 0) : photo.active,
      req.params.id
    );
  broadcastUpdate('photos');
  res.json(db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.id));
});

// PUT /api/photos-active — bulk set which photos are in the slideshow at once.
// Body: { activeIds: [1,4,7] } — those become active, all others inactive.
app.put('/api/photos-active', (req, res) => {
  const ids = Array.isArray(req.body.activeIds) ? req.body.activeIds.map(Number) : null;
  if (!ids) return res.status(400).json({ error: 'activeIds array required' });
  const setActive = db.prepare(`UPDATE photos SET active = 1 WHERE id = ?`);
  const allInactive = db.prepare(`UPDATE photos SET active = 0`);
  db.transaction(() => {
    allInactive.run();
    for (const id of ids) setActive.run(id);
  })();
  broadcastUpdate('photos');
  res.json(db.prepare(`SELECT * FROM photos ORDER BY sort_order ASC, id ASC`).all());
});

// DELETE /api/photos/:id — delete photo + file
app.delete('/api/photos/:id', (req, res) => {
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const filePath = path.join(UPLOAD_DIR, photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare(`DELETE FROM photos WHERE id = ?`).run(req.params.id);
  broadcastUpdate('photos');
  res.json({ ok: true });
});

// GET /api/photo-settings
app.get('/api/photo-settings', (req, res) => {
  const rows = db.prepare(`SELECT key, value FROM photo_settings`).all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// PUT /api/photo-settings
app.put('/api/photo-settings', (req, res) => {
  const upsert = db.prepare(`INSERT OR REPLACE INTO photo_settings (key, value) VALUES (?, ?)`);
  const tx = db.transaction(pairs => { for (const [k, v] of pairs) upsert.run(k, String(v)); });
  tx(Object.entries(req.body));
  const rows = db.prepare(`SELECT key, value FROM photo_settings`).all();
  broadcastUpdate('photo-settings');
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// ── Displays API ──────────────────────────────────────────────────────────────
// Resolves a display from a slug (preferred, used in ?display=kitchen URLs) or
// falls back to the first display by sort_order — keeps things working for any
// screen/URL that doesn't specify a display at all (e.g. pre-multi-display bookmarks).
function resolveDisplay(slugOrId) {
  if (slugOrId) {
    const bySlug = db.prepare(`SELECT * FROM displays WHERE slug = ?`).get(slugOrId);
    if (bySlug) return bySlug;
    const byId = db.prepare(`SELECT * FROM displays WHERE id = ?`).get(slugOrId);
    if (byId) return byId;
  }
  return db.prepare(`SELECT * FROM displays ORDER BY sort_order ASC, id ASC LIMIT 1`).get();
}

function slugify(name) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'display';
  let slug = base, n = 1;
  while (db.prepare(`SELECT id FROM displays WHERE slug = ?`).get(slug)) {
    slug = `${base}-${++n}`;
  }
  return slug;
}

// Auto-names a preview screen identity (device_id starting with 'preview_')
// with a descriptive name derived from the display it's previewing, rather
// than leaving it to show as "Unnamed display" in the Devices tab —
// confirmed as a real point of confusion, not a hypothetical: these
// disposable, per-display identities (see SCREEN_ID's own comment in
// display.html for why they exist at all — a dedicated, never-colliding
// identity specifically for "Open to Edit in New Tab") were showing up
// indistinguishable from an unconfigured real device needing attention.
// Returns null for anything that isn't a preview-prefixed id, so callers
// can fall back to their own existing naming logic untouched.
function previewScreenName(screenId) {
  if (!screenId || !screenId.startsWith('preview_')) return null;
  const slug = screenId.slice('preview_'.length);
  // Exact match only — resolveDisplay() deliberately falls back to the
  // first display in the system when nothing matches, which would be
  // actively wrong here: misnaming this preview after a display it has
  // nothing to do with, rather than a generic fallback using the slug
  // itself.
  const display = db.prepare(`SELECT name FROM displays WHERE slug = ?`).get(slug);
  return `${display ? display.name : slug} (Live Edit)`;
}

// Periodically deletes preview screen identities that haven't checked in for
// longer than the configured threshold. Safe to delete outright, not just
// hide: these are inherently disposable, single-purpose identities (see
// previewScreenName()'s own comment for why they exist at all), and their
// own settings — schedule rules, switcher targets — are entirely isolated
// to that one specific preview session, stored per-device_id exactly like
// a real screen's own settings are, never touching any real, deployed
// screen's configuration. Confirmed directly, not assumed: both
// floating_switcher_presets and floating_switcher_schedule are saved via
// `UPDATE screens ... WHERE device_id = ?`, so deleting a stale preview_*
// row can never affect anything a real screen depends on.
// Threshold is configurable via the preview_screen_cleanup_days setting
// (an ordinary key on /api/settings, not a dedicated endpoint), by explicit
// request — ranges from a few days to a year, defaulting to 7, so
// infrequent but intentional re-use of the same preview doesn't lose it
// prematurely.
function cleanupStalePreviewScreens() {
  try {
    const days = Number(updateSetting('preview_screen_cleanup_days', '7')) || 7;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = db.prepare(`DELETE FROM screens WHERE device_id LIKE 'preview\\_%' ESCAPE '\\' AND last_seen < ?`).run(cutoff);
    if (result.changes > 0) broadcastUpdate('screens');
  } catch {}
}
setInterval(cleanupStalePreviewScreens, 6 * 60 * 60 * 1000); // every 6 hours — no need to check more often for a days-to-a-year-scale threshold
cleanupStalePreviewScreens(); // also run once at boot, so a long-stale entry doesn't have to wait for the first interval tick

app.get('/api/displays', (req, res) => {
  res.json(db.prepare(`SELECT * FROM displays ORDER BY sort_order ASC, id ASC`).all());
});

// GET /api/display-config?display=kitchen&device=scr_xxx — the resolved render config
// (orientation override + rotation). The physical SCREEN's own orientation/rotation, if
// set, takes precedence over the profile's — so a sideways-mounted TV stays portrait no
// matter which profile it shows. Unset ('' / -1) falls back to the profile's values.
app.get('/api/display-config', (req, res) => {
  const display = resolveDisplay(req.query.display);
  if (!display) return res.status(404).json({ error: 'No displays exist yet' });

  let force_orientation = display.force_orientation || 'auto';
  let rotation = display.rotation || 0;
  let screensaverTag = '';
  let screensaverPhotoId = null;
  let ambientMode = '';
  let ambientClockCorner = 'bl';
  let ambientPhotoFit = 'cover';
  let ambientFadeTransition = true;
  let ambientPhotoInterval = '';
  let ambientBlurBg = true;
  let ambientFadeDuration = '2';
  let fxScale = '1';
  let fxDensity = '1';

  const deviceId = (req.query.device || req.query.screen || '').toString();
  if (deviceId) {
    const scr = db.prepare(`SELECT screen_orientation, screen_rotation, screensaver_tag, screensaver_photo_id, ambient_mode, ambient_clock_corner, ambient_photo_fit, ambient_fade_transition, ambient_photo_interval, ambient_blur_bg, ambient_fade_duration, fx_scale, fx_density FROM screens WHERE device_id = ?`).get(deviceId);
    if (scr) {
      if (scr.screen_orientation && scr.screen_orientation !== '') force_orientation = scr.screen_orientation;
      if (typeof scr.screen_rotation === 'number' && scr.screen_rotation >= 0) rotation = scr.screen_rotation;
      screensaverTag = scr.screensaver_tag || '';
      screensaverPhotoId = scr.screensaver_photo_id || null;
      ambientMode = scr.ambient_mode || '';
      ambientClockCorner = scr.ambient_clock_corner || 'bl';
      ambientPhotoFit = scr.ambient_photo_fit || 'cover';
      ambientFadeTransition = scr.ambient_fade_transition !== '0';
      ambientPhotoInterval = scr.ambient_photo_interval || '';
      ambientBlurBg = scr.ambient_blur_bg !== '0';
      ambientFadeDuration = scr.ambient_fade_duration || '2';
      fxScale = scr.fx_scale || '1';
      fxDensity = scr.fx_density || '1';
    }
  }

  res.json({
    id: display.id,
    name: display.name,
    slug: display.slug,
    force_orientation,
    rotation,
    theme: display.theme || '',
    fontFamily: display.font_family || '',
    screensaverTag,
    screensaverPhotoId,
    ambientMode,
    ambientClockCorner,
    ambientPhotoFit,
    ambientFadeTransition,
    ambientPhotoInterval,
    ambientBlurBg,
    ambientFadeDuration,
    fxScale,
    fxDensity,
    customBg: updateSetting('custom_theme_bg', ''),
    customDeco1: updateSetting('custom_theme_deco1', ''),
    customDeco2: updateSetting('custom_theme_deco2', ''),
    customDeco3: updateSetting('custom_theme_deco3', ''),
    customDeco1Behavior: updateSetting('custom_theme_deco1_behavior', 'random'),
    customDeco2Behavior: updateSetting('custom_theme_deco2_behavior', 'random'),
    customDeco3Behavior: updateSetting('custom_theme_deco3_behavior', 'random'),
  });
});

app.post('/api/displays', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'A display name is required' });
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM displays`).get().m || 0;
  const slug = slugify(name);
  const result = db.prepare(`INSERT INTO displays (name, slug, sort_order) VALUES (?, ?, ?)`)
    .run(name.trim(), slug, maxOrder + 1);
  seedDefaultLayoutsForDisplay(result.lastInsertRowid);
  res.status(201).json(db.prepare(`SELECT * FROM displays WHERE id = ?`).get(result.lastInsertRowid));
});

app.put('/api/displays/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM displays WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Display not found' });
  const { name, force_orientation, rotation, theme, fontFamily } = req.body;
  // Slug is intentionally NOT changed on rename — the physical screen's bookmarked
  // URL (?display=old-slug) would otherwise silently break.
  const validOrientations = ['auto', 'landscape', 'portrait'];
  const validRotations = [0, 90, 180, 270];
  const newOrientation = (force_orientation !== undefined && validOrientations.includes(force_orientation))
    ? force_orientation : existing.force_orientation;
  const newRotation = (rotation !== undefined && validRotations.includes(Number(rotation)))
    ? Number(rotation) : existing.rotation;
  const newTheme = (theme !== undefined) ? String(theme) : existing.theme;
  const newFontFamily = (fontFamily !== undefined) ? String(fontFamily) : existing.font_family;
  db.prepare(`UPDATE displays SET name=?, force_orientation=?, rotation=?, theme=?, font_family=? WHERE id=?`).run(
    name !== undefined ? name.trim() : existing.name,
    newOrientation,
    newRotation,
    newTheme,
    newFontFamily,
    req.params.id
  );
  broadcastUpdate('displays');
  res.json(db.prepare(`SELECT * FROM displays WHERE id = ?`).get(req.params.id));
});

// ── Templates ─────────────────────────────────────────────────────────────────
// Ready-made themed starting points. Applying one creates a NEW display (the
// user's existing displays are never modified), seeds both orientation layouts
// from the template, and stamps the theme so the display renders the matching
// generated background + calendar decorations.

app.get('/api/templates', (req, res) => {
  res.json(getTemplateSummaries());
});

app.post('/api/templates/apply', (req, res) => {
  const { templateId, name } = req.body;
  const tpl = getTemplate(templateId);
  if (!tpl) return res.status(404).json({ error: 'Unknown template' });

  const displayName = (name && name.trim()) ? name.trim() : tpl.name;
  const slug = slugify(displayName);
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM displays`).get().m || 0;

  const landscape = JSON.stringify(materializeWidgets(tpl.landscape, tpl.calDecor));
  const portrait  = JSON.stringify(materializeWidgets(tpl.portrait,  tpl.calDecor));

  const tx = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO displays (name, slug, sort_order, theme) VALUES (?, ?, ?, ?)`
    ).run(displayName, slug, maxOrder + 1, tpl.id);
    const id = result.lastInsertRowid;
    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`).run(id, landscape);
    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`).run(id, portrait);
    return id;
  });
  const newId = tx();

  broadcastUpdate('displays');
  res.status(201).json(db.prepare(`SELECT * FROM displays WHERE id = ?`).get(newId));
});

// ── Layout Library (user-saved presets) ──────────────────────────────────────
// A saved layout is a complete snapshot (both orientations + theme), not tied to
// any display. It can be applied onto an existing display or used to create a new
// one — the user picks at apply time.

// Helper: create a new display from explicit layout JSON strings + theme.
function createDisplayFromLayouts(name, landscapeJson, portraitJson, theme) {
  const displayName = (name && name.trim()) ? name.trim() : 'Display';
  const slug = slugify(displayName);
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM displays`).get().m || 0;
  const tx = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO displays (name, slug, sort_order, theme) VALUES (?, ?, ?, ?)`
    ).run(displayName, slug, maxOrder + 1, theme || '');
    const id = result.lastInsertRowid;
    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`).run(id, landscapeJson);
    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`).run(id, portraitJson);
    return id;
  });
  return tx();
}

// Duplicate an existing display (its layouts + theme) into a new "… (copy)" profile.
app.post('/api/displays/:id/duplicate', (req, res) => {
  const src = db.prepare(`SELECT * FROM displays WHERE id = ?`).get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Display not found' });
  const land = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'landscape'`).get(src.id);
  const port = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'portrait'`).get(src.id);
  // Find a non-colliding name like "Kitchen (copy)", "Kitchen (copy 2)", …
  let base = `${src.name} (copy)`, name = base, n = 2;
  while (db.prepare(`SELECT id FROM displays WHERE name = ?`).get(name)) { name = `${src.name} (copy ${n++})`; }
  const newId = createDisplayFromLayouts(
    name,
    land?.widgets || '[]',
    port?.widgets || '[]',
    src.theme || ''
  );
  broadcastUpdate('displays');
  const created = db.prepare(`SELECT slug FROM displays WHERE id = ?`).get(newId);
  res.json({ ok: true, id: newId, name, slug: created?.slug });
});

app.get('/api/saved-layouts', (req, res) => {
  const rows = db.prepare(`SELECT id, name, theme, created_at FROM saved_layouts ORDER BY created_at DESC, id DESC`).all();
  res.json(rows);
});

// Full detail for ONE saved layout, including its widget data — the list
// endpoint above deliberately omits this to stay lightweight for a picker
// UI. Used by the Layout Switcher (widget and floating, display.html) to
// pre-fetch what a target preset actually contains, ahead of when someone
// taps to switch to it.
app.get('/api/saved-layouts/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM saved_layouts WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Saved layout not found' });
  res.json({
    id: row.id, name: row.name, theme: row.theme || '', created_at: row.created_at,
    widgets_landscape: JSON.parse(row.widgets_landscape || '[]'),
    widgets_portrait: JSON.parse(row.widgets_portrait || '[]'),
  });
});

// Save the CURRENT layout of a display (both orientations + its theme) as a preset.
app.post('/api/saved-layouts', (req, res) => {
  const { name, display } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'A name is required' });
  const disp = resolveDisplay(display);
  if (!disp) return res.status(404).json({ error: 'Display not found' });

  const land = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'landscape'`).get(disp.id);
  const port = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'portrait'`).get(disp.id);
  const landscape = land ? land.widgets : '[]';
  const portrait  = port ? port.widgets : '[]';

  const result = db.prepare(
    `INSERT INTO saved_layouts (name, widgets_landscape, widgets_portrait, theme) VALUES (?, ?, ?, ?)`
  ).run(name.trim(), landscape, portrait, disp.theme || '');
  res.status(201).json(db.prepare(`SELECT id, name, theme, created_at FROM saved_layouts WHERE id = ?`).get(result.lastInsertRowid));
});

// Apply a saved layout. mode='current' overwrites an existing display (its
// arrangement AND theme); mode='new' creates a fresh display from the preset.
app.post('/api/saved-layouts/:id/apply', (req, res) => {
  const preset = db.prepare(`SELECT * FROM saved_layouts WHERE id = ?`).get(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Saved layout not found' });
  const { mode, display, name } = req.body;

  if (mode === 'new') {
    const newId = createDisplayFromLayouts(
      name || preset.name, preset.widgets_landscape, preset.widgets_portrait, preset.theme
    );
    broadcastUpdate('displays');
    return res.status(201).json(db.prepare(`SELECT * FROM displays WHERE id = ?`).get(newId));
  }

  // mode === 'current' (default): overwrite the target display
  // Same hardening as PUT /api/layouts/:orientation, and for the identical
  // reason — resolveDisplay() falls back to "the first display in the
  // database" for ANY unresolved slug (empty, missing, or simply not
  // matching), which is fine for a read but means a write with a bad slug
  // silently overwrites some OTHER, unrelated display instead of failing.
  // This is the DESTINATION of an apply — getting it wrong here is exactly
  // the "layouts got swapped" failure mode this was built to rule out.
  if (!display) return res.status(400).json({ error: 'A target display slug is required.' });
  const disp = resolveDisplay(display);
  if (!disp || (disp.slug !== display && String(disp.id) !== String(display))) {
    return res.status(404).json({ error: 'Target display not found' });
  }
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`).run(disp.id, preset.widgets_landscape);
    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`).run(disp.id, preset.widgets_portrait);
    db.prepare(`UPDATE displays SET theme = ? WHERE id = ?`).run(preset.theme || '', disp.id);
  });
  tx();
  broadcastUpdate('displays');
  broadcastUpdate('layout', disp.id);
  res.json({ ok: true, display_id: disp.id });
});

// Full detail for ONE live display — both orientations' widgets + theme, in
// the same shape GET /api/saved-layouts/:id already returns for templates.
// Needed for the Layout Switcher to point at a live display directly, not
// just a saved template — the pre-fetch cache reads whichever endpoint
// matches the target's type but treats the result the same way either way.
app.get('/api/displays/:slug/full', (req, res) => {
  const disp = resolveDisplay(req.params.slug);
  if (!disp) return res.status(404).json({ error: 'Display not found' });
  const land = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'landscape'`).get(disp.id);
  const port = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'portrait'`).get(disp.id);
  res.json({
    slug: disp.slug, name: disp.name, theme: disp.theme || '',
    widgets_landscape: JSON.parse(land?.widgets || '[]'),
    widgets_portrait: JSON.parse(port?.widgets || '[]'),
  });
});

// Copies THIS display's current layout (both orientations + theme) onto
// another display — the live-display equivalent of
// POST /api/saved-layouts/:id/apply's mode:'current'. Used both by Layout
// Switcher (switching TO a live display copies that display's current
// arrangement onto the screen doing the switching) and available generally
// for the same "clone one display onto another" use a saved-layout preset
// already offers.
app.post('/api/displays/:slug/apply-to', (req, res) => {
  const source = resolveDisplay(req.params.slug);
  if (!source) return res.status(404).json({ error: 'Source display not found' });
  // Same hardening as the two endpoints above, same reason — this is the
  // DESTINATION of an apply (the display about to be overwritten), so an
  // unresolved slug falling back to "whichever display sorts first" here
  // is exactly the failure mode this whole pattern exists to rule out. The
  // SOURCE (req.params.slug, from the URL path) doesn't need this same
  // guard — an Express route param can't arrive empty the way a body field
  // can, and it was already checked as resolved above.
  const targetSlug = req.body && req.body.display;
  if (!targetSlug) return res.status(400).json({ error: 'A target display slug is required.' });
  const target = resolveDisplay(targetSlug);
  if (!target || (target.slug !== targetSlug && String(target.id) !== String(targetSlug))) {
    return res.status(404).json({ error: 'Target display not found' });
  }
  if (source.id === target.id) return res.status(400).json({ error: 'Source and target are the same display' });
  const land = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'landscape'`).get(source.id);
  const port = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = 'portrait'`).get(source.id);
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'landscape', ?)`).run(target.id, land?.widgets || '[]');
    db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, 'portrait', ?)`).run(target.id, port?.widgets || '[]');
    db.prepare(`UPDATE displays SET theme = ? WHERE id = ?`).run(source.theme || '', target.id);
  });
  tx();
  broadcastUpdate('displays');
  broadcastUpdate('layout', target.id);
  res.json({ ok: true, display_id: target.id });
});

app.delete('/api/saved-layouts/:id', (req, res) => {
  const result = db.prepare(`DELETE FROM saved_layouts WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Saved layout not found' });
  res.json({ ok: true });
});

// ── Screens manager ───────────────────────────────────────────────────────────
// Physical Pi screens register themselves (see /api/live and /api/screen-config).
// The app lists them, names them, and assigns each a display profile — switching
// it live over SSE.

// List all known screens with online status and resolved profile name.
app.get('/api/screens', (req, res) => {
  const now = Date.now();
  const rows = db.prepare(`SELECT * FROM screens ORDER BY created_at ASC`).all();
  const screens = rows.map(s => {
    const disp = s.assigned_display_slug ? resolveDisplay(s.assigned_display_slug) : null;
    return {
      device_id: s.device_id,
      name: s.name || '',
      assigned_display_slug: s.assigned_display_slug || '',
      assigned_display_name: disp ? disp.name : '',
      info_corner: s.info_corner || '',
      // Per-screen overrides — must be included here or the app's dropdowns can never
      // reflect a saved value and will always fall back to their defaults on redraw.
      screen_orientation: s.screen_orientation || '',
      screen_rotation: (s.screen_rotation === null || s.screen_rotation === undefined) ? -1 : s.screen_rotation,
      screensaver_tag: s.screensaver_tag || '',
      screensaver_photo_id: s.screensaver_photo_id || null,
      ambient_clock_corner: s.ambient_clock_corner || 'bl',
      ambient_photo_fit: s.ambient_photo_fit || 'cover',
      ambient_fade_transition: s.ambient_fade_transition !== '0',
      ambient_photo_interval: s.ambient_photo_interval || '',
      ambient_blur_bg: s.ambient_blur_bg !== '0',
      ambient_fade_duration: s.ambient_fade_duration || '2',
      fx_scale: s.fx_scale || '1',
      fx_density: s.fx_density || '1',
      tv_control_type: s.tv_control_type || '',
      tv_ip: s.tv_ip || '',
      tv_paired: !!s.tv_samsung_token,
      tv_schedule_slots: db.prepare(`SELECT id, time, action FROM tv_schedule_slots WHERE device_id = ? ORDER BY time`).all(s.device_id),
      ambient_mode: s.ambient_mode || '',
      screen_version: s.screen_version || '',
      floating_switcher_enabled: !!s.floating_switcher_enabled,
      floating_switcher_presets: (() => { try { return JSON.parse(s.floating_switcher_presets || '[]'); } catch { return []; } })(),
      floating_switcher_schedule: (() => { try { return JSON.parse(s.floating_switcher_schedule || '[]'); } catch { return []; } })(),
      floating_switcher_edge: s.floating_switcher_edge || 'bottom',
      floating_switcher_icon: s.floating_switcher_icon || '🔀',
      floating_switcher_color: s.floating_switcher_color || '#0a0e1a',
      floating_switcher_style: s.floating_switcher_style || 'circles',
      floating_switcher_bar_mode: s.floating_switcher_bar_mode || 'icons',
      floating_switcher_reveal: s.floating_switcher_reveal || 'always',
      alert_banner_position: s.alert_banner_position || 'top',
      alert_banner_size: s.alert_banner_size || 'm',
      alert_banner_style: s.alert_banner_style || 'solid',
      online: (now - (s.last_seen || 0)) < SCREEN_ONLINE_MS,
      last_seen: s.last_seen || 0,
      is_remote: !!s.is_remote,
    };
  });
  res.json(screens);
});

// Rename a screen (also used to set its name the first time).
app.put('/api/screens/:deviceId', (req, res) => {
  const { name, info_corner, screen_orientation, screen_rotation, screensaver_tag, screensaver_photo_id, ambient_mode, ambient_clock_corner, ambient_photo_fit, ambient_fade_transition, ambient_fade_duration, ambient_photo_interval, ambient_blur_bg, fx_scale, fx_density, tv_control_type, tv_ip, floating_switcher_enabled, floating_switcher_presets, floating_switcher_schedule, floating_switcher_edge, floating_switcher_icon, floating_switcher_color, floating_switcher_style, floating_switcher_bar_mode, floating_switcher_reveal, alert_banner_position, alert_banner_size, alert_banner_style } = req.body;
  const existing = db.prepare(`SELECT device_id FROM screens WHERE device_id = ?`).get(req.params.deviceId);
  if (!existing) return res.status(404).json({ error: 'Screen not found' });
  if (name !== undefined) {
    db.prepare(`UPDATE screens SET name = ? WHERE device_id = ?`).run(String(name).trim(), req.params.deviceId);
  }
  if (info_corner !== undefined) {
    const valid = ['', 'tl', 'tr', 'bl', 'br'];
    const corner = valid.includes(info_corner) ? info_corner : '';
    db.prepare(`UPDATE screens SET info_corner = ? WHERE device_id = ?`).run(corner, req.params.deviceId);
    // Push the change live so the overlay appears/moves without a reload.
    sendScreenCommand(req.params.deviceId, 'set-info-corner', { corner });
  }
  let orientationChanged = false;
  if (screen_orientation !== undefined) {
    const valid = ['', 'auto', 'landscape', 'portrait'];
    const o = valid.includes(screen_orientation) ? screen_orientation : '';
    db.prepare(`UPDATE screens SET screen_orientation = ? WHERE device_id = ?`).run(o, req.params.deviceId);
    orientationChanged = true;
  }
  if (screen_rotation !== undefined) {
    const valid = [-1, 0, 90, 180, 270];
    const r = valid.includes(Number(screen_rotation)) ? Number(screen_rotation) : -1;
    db.prepare(`UPDATE screens SET screen_rotation = ? WHERE device_id = ?`).run(r, req.params.deviceId);
    orientationChanged = true;
  }
  let screensaverChanged = false;
  if (screensaver_tag !== undefined) {
    db.prepare(`UPDATE screens SET screensaver_tag = ? WHERE device_id = ?`)
      .run(String(screensaver_tag || '').trim(), req.params.deviceId);
    screensaverChanged = true;
  }
  if (screensaver_photo_id !== undefined) {
    // Empty/null = go back to tag-based slideshow. Set = show just this one photo.
    const pid = (screensaver_photo_id === '' || screensaver_photo_id === null) ? null : Number(screensaver_photo_id);
    db.prepare(`UPDATE screens SET screensaver_photo_id = ? WHERE device_id = ?`).run(pid, req.params.deviceId);
    screensaverChanged = true;
  }
  if (ambient_mode !== undefined) {
    const valid = ['', 'photo', 'photo_datetime'];
    const m = valid.includes(ambient_mode) ? ambient_mode : '';
    db.prepare(`UPDATE screens SET ambient_mode = ? WHERE device_id = ?`).run(m, req.params.deviceId);
    // Instant, no reload needed — same lightweight live-command pattern as the
    // info-corner toggle above, since this is meant to be flipped casually
    // (e.g. "photo mode for tonight") without the display blinking through a
    // full page reload each time.
    sendScreenCommand(req.params.deviceId, 'set-ambient-mode', { mode: m });
  }
  if (ambient_clock_corner !== undefined) {
    const valid = ['tl', 'tr', 'bl', 'br'];
    const c = valid.includes(ambient_clock_corner) ? ambient_clock_corner : 'bl';
    db.prepare(`UPDATE screens SET ambient_clock_corner = ? WHERE device_id = ?`).run(c, req.params.deviceId);
    // Live-rebuilds the ambient layout if it's currently showing (see the
    // refresh-photos handler on the display side, reused here rather than
    // adding a near-identical third command for this one setting).
    sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
  }
  if (ambient_photo_fit !== undefined) {
    const valid = ['cover', 'width', 'height', 'auto'];
    const f = valid.includes(ambient_photo_fit) ? ambient_photo_fit : 'cover';
    db.prepare(`UPDATE screens SET ambient_photo_fit = ? WHERE device_id = ?`).run(f, req.params.deviceId);
    sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
  }
  if (ambient_fade_transition !== undefined) {
    db.prepare(`UPDATE screens SET ambient_fade_transition = ? WHERE device_id = ?`)
      .run(ambient_fade_transition ? '1' : '0', req.params.deviceId);
    sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
  }
  if (ambient_fade_duration !== undefined) {
    const d = parseFloat(ambient_fade_duration);
    if (!isNaN(d) && d >= 0.5 && d <= 10) {
      db.prepare(`UPDATE screens SET ambient_fade_duration = ? WHERE device_id = ?`).run(String(d), req.params.deviceId);
      sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
    }
  }
  if (ambient_photo_interval !== undefined) {
    const iv = String(ambient_photo_interval || '').trim();
    if (iv === '' || /^\d+$/.test(iv)) {
      db.prepare(`UPDATE screens SET ambient_photo_interval = ? WHERE device_id = ?`).run(iv, req.params.deviceId);
      sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
    }
  }
  if (ambient_blur_bg !== undefined) {
    db.prepare(`UPDATE screens SET ambient_blur_bg = ? WHERE device_id = ?`)
      .run(ambient_blur_bg ? '1' : '0', req.params.deviceId);
    sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
  }
  if (fx_scale !== undefined) {
    const f = parseFloat(fx_scale);
    if (!isNaN(f) && f >= 0.5 && f <= 3) {
      db.prepare(`UPDATE screens SET fx_scale = ? WHERE device_id = ?`).run(String(f), req.params.deviceId);
      broadcastUpdate('displays'); // triggers applyTheme() live on that screen, no full reload needed
    }
  }
  if (fx_density !== undefined) {
    const f = parseFloat(fx_density);
    if (!isNaN(f) && f >= 0 && f <= 3) {
      db.prepare(`UPDATE screens SET fx_density = ? WHERE device_id = ?`).run(String(f), req.params.deviceId);
      broadcastUpdate('displays');
    }
  }
  if (tv_control_type !== undefined) {
    const valid = ['', 'cec', 'hdmi-signal', 'roku', 'samsung'];
    const t = valid.includes(tv_control_type) ? tv_control_type : '';
    // Changing away from Samsung (or clearing control entirely) invalidates any
    // stored pairing token — it's meaningless for anything else.
    if (t !== 'samsung') {
      db.prepare(`UPDATE screens SET tv_control_type = ?, tv_samsung_token = '' WHERE device_id = ?`).run(t, req.params.deviceId);
    } else {
      db.prepare(`UPDATE screens SET tv_control_type = ? WHERE device_id = ?`).run(t, req.params.deviceId);
    }
  }
  if (tv_ip !== undefined) {
    // A changed IP means a different (or freshly-reset) device — the old
    // Samsung pairing token, if any, would be for whatever was at the old
    // address and needs to be re-paired.
    db.prepare(`UPDATE screens SET tv_ip = ?, tv_samsung_token = '' WHERE device_id = ?`)
      .run(String(tv_ip || '').trim(), req.params.deviceId);
  }
  // Orientation/rotation are read at page load, so reload the screen to apply them.
  if (orientationChanged) sendScreenCommand(req.params.deviceId, 'reload', {});
  // The screensaver filter is read live from cached state, so a lighter refresh works.
  if (screensaverChanged) sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
  if (floating_switcher_enabled !== undefined) {
    db.prepare(`UPDATE screens SET floating_switcher_enabled = ? WHERE device_id = ?`)
      .run(floating_switcher_enabled ? 1 : 0, req.params.deviceId);
  }
  if (floating_switcher_presets !== undefined) {
    // Accepts either shape: a bare number/numeric-string (legacy — always
    // meant a saved_layout id, kept working for anything already saved
    // during the beta before this expansion) or the newer
    // {type:'saved'|'display', id, icon} object (id is a saved_layout id
    // for 'saved', a display slug for 'display'; icon is an optional
    // per-target emoji/character the person picked, capped defensively the
    // same way the old single floating_switcher_icon field was). Never
    // trust the client's own 'type' framing without re-validating the
    // shape of 'id' matches it.
    const sanitizeIcon = (icon) => (typeof icon === 'string' && icon.trim()) ? icon.trim().slice(0, 8) : '';
    const targets = Array.isArray(floating_switcher_presets) ? floating_switcher_presets.map(t => {
      if (typeof t === 'number' || (typeof t === 'string' && /^\d+$/.test(t))) return { type: 'saved', id: Number(t) };
      if (t && t.type === 'saved' && Number.isInteger(Number(t.id))) return { type: 'saved', id: Number(t.id), icon: sanitizeIcon(t.icon) };
      if (t && t.type === 'display' && typeof t.id === 'string' && t.id) return { type: 'display', id: t.id, icon: sanitizeIcon(t.icon) };
      return null;
    }).filter(Boolean) : [];
    db.prepare(`UPDATE screens SET floating_switcher_presets = ? WHERE device_id = ?`)
      .run(JSON.stringify(targets), req.params.deviceId);
  }
  if (floating_switcher_schedule !== undefined) {
    // Each rule's ACTIVE mode is ONE OF: 'time' (needs time), 'interval'
    // (needs intervalValue/intervalUnit + target), or 'rotation' (needs
    // intervalValue/intervalUnit + targets, 2+). mode defaults to 'time'
    // for anything saved before 'interval'/'rotation' existed — those rows
    // have no mode field at all, and should keep meaning exactly what
    // they always meant.
    //
    // Every other field a rule might ALSO be carrying (from a mode it was
    // in before, but currently isn't) is preserved here if it's present
    // and independently valid, not discarded just because it isn't the
    // active mode's own field. Found from a real, reproducible incident,
    // not a hypothetical: the previous version of this validation only
    // ever returned the active mode's own fields — so switching a
    // rotation rule to "At a time" and saving permanently discarded its
    // targets array server-side; the client's own in-memory state still
    // remembered it until the next re-fetch, at which point switching
    // back to Rotate only recovered a single carried-forward target, not
    // the original list, looking exactly like "my settings didn't save."
    // Reuses the exact same target validation as floating_switcher_presets
    // above — a schedule rule's target follows the identical shape rules.
    const validTarget = (t) => {
      if (t && t.type === 'saved' && Number.isInteger(Number(t.id))) return { type: 'saved', id: Number(t.id) };
      if (t && t.type === 'display' && typeof t.id === 'string' && t.id) return { type: 'display', id: t.id };
      return null;
    };
    // Shared by both interval and rotation modes — same clamp-up-to-floor
    // reasoning either way (see interval's own inline comment below for
    // the full rationale): the check loop can't fire more precisely than
    // every 5s regardless of what shorter value was configured, so losing
    // an entire rule over too-fast a number would be a confusing surprise
    // rather than a helpful validation.
    const clampInterval = (value, unit) => {
      const msPerUnit = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
      const ms = Math.max(value * msPerUnit, 5000);
      return ms / msPerUnit;
    };
    const rules = Array.isArray(floating_switcher_schedule) ? floating_switcher_schedule.map(r => {
      if (!r) return null;
      const days = Array.isArray(r.daysOfWeek) ? [...new Set(r.daysOfWeek.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
      if (!days.length) return null;
      const mode = ['interval', 'rotation'].includes(r.mode) ? r.mode : 'time';
      // Every field validated independently of which mode is currently
      // active — carried through whenever it's present and valid, so a
      // mode this rule isn't in right now doesn't lose its own data.
      const target = validTarget(r.target); // null if absent/invalid — fine for dormant preservation, required only if this IS the active single-target mode
      const targets = Array.isArray(r.targets) ? r.targets.map(validTarget).filter(Boolean) : [];
      const time = (typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) ? r.time : null;
      const intervalValueRaw = Number(r.intervalValue);
      const hasValidInterval = Number.isFinite(intervalValueRaw) && intervalValueRaw > 0;
      const intervalUnit = ['seconds', 'minutes', 'hours'].includes(r.intervalUnit) ? r.intervalUnit : 'minutes';
      const intervalValue = hasValidInterval ? clampInterval(intervalValueRaw, intervalUnit) : null;
      // The active mode's own requirement is what can reject the WHOLE
      // rule — everything else above is preserved if valid, regardless.
      if (mode === 'rotation' && targets.length < 2) return null; // need at least 2 distinct, valid targets to rotate between at all
      if (mode === 'rotation' && !hasValidInterval) return null;
      if (mode === 'interval' && (!target || !hasValidInterval)) return null;
      if (mode === 'time' && (!target || !time)) return null;
      const out = { mode, daysOfWeek: days };
      if (target) out.target = target;
      if (targets.length) out.targets = targets;
      if (time) out.time = time;
      if (intervalValue !== null) { out.intervalValue = intervalValue; out.intervalUnit = intervalUnit; }
      // Explicit !== false, not a truthiness coercion — a rule with no
      // enabled field at all (anything saved before this feature existed)
      // should be treated as enabled, same as checkSchedules()'s own
      // client-side check does. Only writes the field at all when it's
      // actually false, keeping the common (enabled) case's stored shape
      // unchanged from before this feature existed.
      if (r.enabled === false) out.enabled = false;
      return out;
    }).filter(Boolean) : [];
    db.prepare(`UPDATE screens SET floating_switcher_schedule = ? WHERE device_id = ?`)
      .run(JSON.stringify(rules), req.params.deviceId);
  }
  if (floating_switcher_edge !== undefined) {
    const edge = ['top', 'bottom', 'left', 'right'].includes(floating_switcher_edge) ? floating_switcher_edge : 'bottom';
    db.prepare(`UPDATE screens SET floating_switcher_edge = ? WHERE device_id = ?`).run(edge, req.params.deviceId);
  }
  if (floating_switcher_icon !== undefined) {
    // A single emoji/character is the intent, but this doesn't strictly
    // enforce single-grapheme — just caps length defensively (an emoji
    // with modifiers/ZWJ sequences can be several UTF-16 code units) so an
    // unexpectedly long string can't get stored here.
    const icon = (typeof floating_switcher_icon === 'string' && floating_switcher_icon.trim()) ? floating_switcher_icon.trim().slice(0, 8) : '🔀';
    db.prepare(`UPDATE screens SET floating_switcher_icon = ? WHERE device_id = ?`).run(icon, req.params.deviceId);
  }
  if (floating_switcher_color !== undefined) {
    const color = (typeof floating_switcher_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(floating_switcher_color)) ? floating_switcher_color : '#0a0e1a';
    db.prepare(`UPDATE screens SET floating_switcher_color = ? WHERE device_id = ?`).run(color, req.params.deviceId);
  }
  if (floating_switcher_style !== undefined) {
    const style = ['circles', 'bar'].includes(floating_switcher_style) ? floating_switcher_style : 'circles';
    db.prepare(`UPDATE screens SET floating_switcher_style = ? WHERE device_id = ?`).run(style, req.params.deviceId);
  }
  if (floating_switcher_bar_mode !== undefined) {
    const barMode = ['icons', 'names'].includes(floating_switcher_bar_mode) ? floating_switcher_bar_mode : 'icons';
    db.prepare(`UPDATE screens SET floating_switcher_bar_mode = ? WHERE device_id = ?`).run(barMode, req.params.deviceId);
  }
  if (floating_switcher_reveal !== undefined) {
    const reveal = ['always', 'tap'].includes(floating_switcher_reveal) ? floating_switcher_reveal : 'always';
    db.prepare(`UPDATE screens SET floating_switcher_reveal = ? WHERE device_id = ?`).run(reveal, req.params.deviceId);
  }
  if (floating_switcher_enabled !== undefined || floating_switcher_presets !== undefined || floating_switcher_schedule !== undefined || floating_switcher_edge !== undefined || floating_switcher_icon !== undefined || floating_switcher_color !== undefined || floating_switcher_style !== undefined || floating_switcher_bar_mode !== undefined || floating_switcher_reveal !== undefined) {
    // Instant show/hide/reconfigure, no reload — same lightweight live-command
    // pattern as info_corner/ambient_mode above, since this is meant to be
    // toggled casually from the app while looking at the screen.
    sendScreenCommand(req.params.deviceId, 'refresh-floating-switcher', {});
  }
  if (alert_banner_position !== undefined) {
    const v = ['top', 'bottom', 'center'].includes(alert_banner_position) ? alert_banner_position : 'top';
    db.prepare(`UPDATE screens SET alert_banner_position = ? WHERE device_id = ?`).run(v, req.params.deviceId);
  }
  if (alert_banner_size !== undefined) {
    const v = ['s', 'm', 'l', 'xl', 'xxl'].includes(alert_banner_size) ? alert_banner_size : 'm';
    db.prepare(`UPDATE screens SET alert_banner_size = ? WHERE device_id = ?`).run(v, req.params.deviceId);
  }
  if (alert_banner_style !== undefined) {
    const v = ['solid', 'bar', 'toast', 'outline', 'amber', 'strong'].includes(alert_banner_style) ? alert_banner_style : 'solid';
    db.prepare(`UPDATE screens SET alert_banner_style = ? WHERE device_id = ?`).run(v, req.params.deviceId);
  }
  if (alert_banner_position !== undefined || alert_banner_size !== undefined || alert_banner_style !== undefined) {
    sendScreenCommand(req.params.deviceId, 'refresh-alert-banner', {});
  }
  broadcastUpdate('screens');
  res.json({ ok: true });
});

// Assign a display profile to a screen and switch it live. The assignment is
// remembered (survives reboot); the live command makes the change immediate.
app.post('/api/screens/:deviceId/assign', (req, res) => {
  const { display, selfInitiated } = req.body; // a display slug, or '' for the default
  const existing = db.prepare(`SELECT device_id FROM screens WHERE device_id = ?`).get(req.params.deviceId);
  if (!existing) return res.status(404).json({ error: 'Screen not found' });

  let slug = '';
  if (display) {
    const disp = resolveDisplay(display);
    if (!disp) return res.status(404).json({ error: 'Display profile not found' });
    slug = disp.slug;
  }
  db.prepare(`UPDATE screens SET assigned_display_slug = ? WHERE device_id = ?`).run(slug, req.params.deviceId);

  // Push the switch to the screen now (if it's connected) — UNLESS the
  // screen assigned itself (the Layout Switcher's own pointer-reassignment
  // persist step, see switchToLayoutTarget() in display.html). In that
  // case it's already showing the target's content live, applied locally
  // and instantly the moment it was tapped — pushing switch-profile back
  // to the same screen that just called this would only trigger a
  // redundant, visible reload of content it's already correctly
  // displaying. Screens management's normal usage (reassigning some OTHER
  // screen from the app) never sends this flag and gets the exact same
  // push-and-reload behavior as before.
  const delivered = selfInitiated ? false : sendScreenCommand(req.params.deviceId, 'switch-profile', { display: slug });
  broadcastUpdate('screens');
  res.json({ ok: true, delivered });
});

// Forget a screen (e.g. a Pi that's gone). It will re-register if it reconnects.
app.delete('/api/screens/:deviceId', (req, res) => {
  db.prepare(`DELETE FROM screens WHERE device_id = ?`).run(req.params.deviceId);
  broadcastUpdate('screens');
  res.json({ ok: true });
});

// Called by a screen on boot to learn which profile it should show. Also registers
// the screen if it's new and refreshes last_seen. Returns the assigned slug ('' =
// default display).
// Lightweight check-in: the display calls this on a timer as a backstop so a screen
// stays "online" even if its SSE connection is briefly dropped or throttled (common
// over remote/Tailscale or when a tab is backgrounded). Cheap and idempotent.
app.post('/api/screen-checkin', (req, res) => {
  const screenId = req.query.screen ? String(req.query.screen) : (req.body && req.body.screen);
  if (!screenId) return res.json({ ok: false });
  const now = Date.now();
  // A slave registering with its host marks itself remote and may send a friendly
  // default name + its reachable address (so the host could reach back if needed).
  const isRemote = req.query.remote === '1' ? 1 : 0;
  const remoteAddr = req.query.addr ? String(req.query.addr).slice(0, 100) : '';
  const defaultName = req.query.name ? String(req.query.name).slice(0, 60) : '';
  const reportedVersion = req.query.version ? String(req.query.version).slice(0, 20) : '';

  const existing = db.prepare(`SELECT device_id, name FROM screens WHERE device_id = ?`).get(screenId);

  // Enforce the device limit for non-active (trial/lapsed/unlicensed) accounts —
  // only blocks registering a genuinely NEW screen; a screen that's already
  // registered can always keep checking in, so this can't retroactively lock
  // someone out of a screen they had before a limit ever applied to them.
  if (!existing) {
    try {
      const limitsRaw = updateSetting('limits_cache', '');
      const limits = limitsRaw ? JSON.parse(limitsRaw) : null;
      if (limits && typeof limits.maxDevices === 'number') {
        const currentCount = db.prepare(`SELECT COUNT(*) AS n FROM screens`).get().n;
        if (currentCount >= limits.maxDevices) {
          return res.status(403).json({
            ok: false,
            error: `This trial/free account is limited to ${limits.maxDevices} screen${limits.maxDevices === 1 ? '' : 's'}. Activate a license to add more.`,
          });
        }
      }
    } catch { /* if the cache is missing/malformed, fail open rather than block a legitimate registration */ }
  }

  if (existing) {
    db.prepare(`UPDATE screens SET last_seen = ?, is_remote = ?, remote_addr = ?, screen_version = ? WHERE device_id = ?`)
      .run(now, isRemote, remoteAddr, reportedVersion, screenId);
    // For a REMOTE screen, the slave owns its own name — keep the host's copy in sync
    // when the slave sends a real name and it differs (fixes "Home" vs "Mirror" drift).
    if (isRemote && defaultName && defaultName !== existing.name) {
      db.prepare(`UPDATE screens SET name = ? WHERE device_id = ?`).run(defaultName, screenId);
      broadcastUpdate('screens');
    }
  } else {
    db.prepare(`INSERT INTO screens (device_id, name, last_seen, is_remote, remote_addr, screen_version) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(screenId, previewScreenName(screenId) || defaultName, now, isRemote, remoteAddr, reportedVersion);
    broadcastUpdate('screens');
  }
  // Physical resolution: only the device's OWN server should store its resolution
  // setting. A remote check-in must NOT overwrite the host's local display_res.
  const sw = parseInt(req.query.sw), sh = parseInt(req.query.sh);
  if (!isRemote && sw > 0 && sh > 0) {
    const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    upsert.run('display_res_w', String(sw));
    upsert.run('display_res_h', String(sh));
  }
  // Return this screen's full per-screen config (not just the assigned profile) —
  // a remote slave's own local database otherwise never learns about ANY setting
  // changed via the app (ambient mode, screensaver source, TV control, corner,
  // orientation...) since this check-in is the only sync channel a slave has back
  // to the host. Previously only assigned_display_slug came back here, which
  // meant every other per-screen setting silently never reached a slave's own
  // local database at all — invisible during earlier testing because that mostly
  // exercised the host's own screen, where no cross-device sync is needed.
  const full = db.prepare(`SELECT * FROM screens WHERE device_id = ?`).get(screenId);
  res.json({
    ok: true,
    assigned_display_slug: full ? (full.assigned_display_slug || '') : '',
    config: full ? {
      info_corner: full.info_corner || '',
      screen_orientation: full.screen_orientation || '',
      screen_rotation: (full.screen_rotation === null || full.screen_rotation === undefined) ? -1 : full.screen_rotation,
      screensaver_tag: full.screensaver_tag || '',
      screensaver_photo_id: full.screensaver_photo_id || null,
      ambient_mode: full.ambient_mode || '',
      ambient_clock_corner: full.ambient_clock_corner || 'bl',
      ambient_photo_fit: full.ambient_photo_fit || 'cover',
      tv_control_type: full.tv_control_type || '',
      tv_ip: full.tv_ip || '',
      tv_schedule_on: full.tv_schedule_on || '',
      tv_schedule_off: full.tv_schedule_off || '',
    } : null,
  });
});

// In demo mode every visitor's screen is fresh and unconfigured, so
// synthesize a "flip between layouts" switcher from the seeded profiles —
// this is the demo's layout picker. Returns null (no override) outside demo
// or if there's only one profile. Icons are a best-effort per-template map.
const DEMO_SWITCHER_ICONS = { 'home-hub': '🏠', 'summer-days': '☀️', 'aviation': '✈️', 'command-center': '🎛️', 'daily-digest': '📋', 'minimalist': '▫️', 'modern-dark': '🌙', 'photo-frame': '🖼️' };
function demoSwitcherOverride() {
  if (!IS_DEMO) return null;
  const rows = db.prepare(`SELECT slug FROM displays ORDER BY sort_order ASC, id ASC`).all();
  if (rows.length < 2) return null;
  return {
    floating_switcher_enabled: true,
    floating_switcher_presets: rows.map(r => ({ type: 'display', id: r.slug, icon: DEMO_SWITCHER_ICONS[r.slug] || '🖥️' })),
    floating_switcher_schedule: [],
    floating_switcher_edge: 'bottom',
    floating_switcher_icon: '🔀',
    floating_switcher_color: '#0a0e1a',
    floating_switcher_style: 'bar',
    floating_switcher_bar_mode: 'names',
    floating_switcher_reveal: 'always',
  };
}

app.get('/api/screen-config', (req, res) => {
  const screenId = req.query.screen ? String(req.query.screen) : null;
  const addrs = getReachableAddresses();
  const port = PORT;
  // The canonical, server-persisted identity of THIS Pi. The display adopts this
  // so it stays the same screen across cache wipes, URL changes, and updates.
  const canonicalId = DEVICE_ID;
  // Real TV resolution (reported by the Pi) so previews can render at true size.
  const resRow = db.prepare(`SELECT key, value FROM settings WHERE key IN ('display_res_w','display_res_h')`).all();
  const resMap = Object.fromEntries(resRow.map(r => [r.key, r.value]));
  const displayRes = (resMap.display_res_w && resMap.display_res_h)
    ? { w: parseInt(resMap.display_res_w), h: parseInt(resMap.display_res_h) } : null;
  if (!screenId) {
    // Even without a screen param, a SLAVE has exactly one identity, so it can still
    // report the profile the host assigned it. (A host with multiple screens needs
    // the id to disambiguate, so it still returns empty here.)
    if (isSlave()) {
      let slug = getSetting('assigned_display_slug_remote') || '';
      return res.json({ assigned_display_slug: slug, addresses: addrs, port, canonicalId, displayRes, role: 'slave' });
    }
    return res.json({ assigned_display_slug: '', addresses: addrs, port, canonicalId, displayRes });
  }
  const now = Date.now();

  // Self-heal: when a display registers under THIS Pi's canonical id, remove stray
  // UNNAMED screen rows. Those orphans are the leftovers from earlier identity
  // schemes (e.g. a localStorage id wiped by an update) — they're really this same
  // Pi showing up under a different id. We only ever delete unnamed rows, so any
  // screen the user deliberately named is always preserved.
  //
  // Explicitly excludes 'preview_*' rows — the dedicated, deterministic identity
  // the "Open to Edit in New Tab" context uses (see SCREEN_ID's own declaration in
  // display.html for the full reasoning: never sharing identity with a real screen
  // is the whole point of that mechanism). Without this exclusion, this sweep — which
  // runs every time the host's own real screen checks in, roughly every 20s for an
  // always-on kiosk — matches every preview_* row on all three of its own conditions
  // (unnamed, not remote, no remote address) and deletes it. The preview session's
  // own next poll then silently recreates it from scratch with schema defaults,
  // discarding whatever was just configured through it. Confirmed as a real,
  // reproducible incident: a screen-level setting (the floating switcher) enabled
  // through this context would get silently reset within roughly 20 seconds, on a
  // loop, with the person having no visible indication anything was being undone.
  if (screenId === canonicalId) {
    try {
      // Only sweep rows that are unmistakably LOCAL leftovers of THIS Pi: unnamed,
      // not flagged remote, with no remote address, AND not a deliberately-separate
      // preview identity. A remote slave is excluded by the first three conditions;
      // a preview session is excluded by the fourth. (Belt and suspenders — any one
      // condition would protect a given row; we require all four to be safe.)
      const orphans = db.prepare(
        `SELECT device_id FROM screens
           WHERE device_id != ?
             AND (name IS NULL OR name = '')
             AND COALESCE(is_remote,0) = 0
             AND COALESCE(remote_addr,'') = ''
             AND device_id NOT LIKE 'preview\_%' ESCAPE '\'`
      ).all(canonicalId);
      if (orphans.length) {
        db.prepare(
          `DELETE FROM screens
             WHERE device_id != ?
               AND (name IS NULL OR name = '')
               AND COALESCE(is_remote,0) = 0
               AND COALESCE(remote_addr,'') = ''
               AND device_id NOT LIKE 'preview\_%' ESCAPE '\'`
        ).run(canonicalId);
        broadcastUpdate('screens');
      }
    } catch (e) { /* non-fatal */ }
  }

  const existing = db.prepare(`SELECT * FROM screens WHERE device_id = ?`).get(screenId);
  // On a SLAVE, the profile is assigned by the HOST (synced into this setting). It
  // overrides any local screens-table value so the host has full control.
  const remoteSlug = isSlave() ? (getSetting('assigned_display_slug_remote') || '') : null;
  if (existing) {
    db.prepare(`UPDATE screens SET last_seen = ? WHERE device_id = ?`).run(now, screenId);
    // If the assigned profile no longer exists, fall back to default — but on a SLAVE
    // keep the host's assigned slug even if its profile row hasn't synced yet (the
    // display will resolve it once the next data sync lands the profile).
    let slug = (remoteSlug !== null ? remoteSlug : (existing.assigned_display_slug || ''));
    if (slug && remoteSlug === null && !resolveDisplay(slug)) slug = '';
    // Demo: every visitor's browser is a fresh, unassigned screen — point it
    // at the sole seeded profile so widget edits have a slug to save against
    // (without this the display refuses every layout save as "no display
    // selected"). Harmless outside demo; only fills an otherwise-empty slug.
    if (IS_DEMO && !slug) { const d0 = db.prepare(`SELECT slug FROM displays ORDER BY sort_order ASC, id ASC LIMIT 1`).get(); if (d0) slug = d0.slug; }
    let switcherPresets = [];
    try { switcherPresets = JSON.parse(existing.floating_switcher_presets || '[]'); } catch {}
    let switcherSchedule = [];
    try { switcherSchedule = JSON.parse(existing.floating_switcher_schedule || '[]'); } catch {}
    res.json({ assigned_display_slug: slug, named: !!existing.name, info_corner: existing.info_corner || '', addresses: addrs, port, canonicalId, displayRes,
      floating_switcher_enabled: !!existing.floating_switcher_enabled, floating_switcher_presets: switcherPresets, floating_switcher_schedule: switcherSchedule,
      floating_switcher_edge: existing.floating_switcher_edge || 'bottom', floating_switcher_icon: existing.floating_switcher_icon || '🔀', floating_switcher_color: existing.floating_switcher_color || '#0a0e1a',
      floating_switcher_style: existing.floating_switcher_style || 'circles', floating_switcher_bar_mode: existing.floating_switcher_bar_mode || 'icons',
      floating_switcher_reveal: existing.floating_switcher_reveal || 'always',
      alert_banner_position: existing.alert_banner_position || 'top', alert_banner_size: existing.alert_banner_size || 'm', alert_banner_style: existing.alert_banner_style || 'solid',
      ...(demoSwitcherOverride() || {}) });
  } else {
    db.prepare(`INSERT INTO screens (device_id, name, last_seen) VALUES (?, ?, ?)`).run(screenId, previewScreenName(screenId), now);
    broadcastUpdate('screens');
    let slug = (remoteSlug !== null ? remoteSlug : '');
    if (slug && remoteSlug === null && !resolveDisplay(slug)) slug = '';
    if (IS_DEMO && !slug) { const d0 = db.prepare(`SELECT slug FROM displays ORDER BY sort_order ASC, id ASC LIMIT 1`).get(); if (d0) slug = d0.slug; }
    res.json({ assigned_display_slug: slug, named: false, info_corner: '', addresses: addrs, port, canonicalId, displayRes,
      floating_switcher_enabled: false, floating_switcher_presets: [], floating_switcher_schedule: [],
      floating_switcher_edge: 'bottom', floating_switcher_icon: '🔀', floating_switcher_color: '#0a0e1a',
      floating_switcher_style: 'circles', floating_switcher_bar_mode: 'icons', floating_switcher_reveal: 'always',
      alert_banner_position: 'top', alert_banner_size: 'm', alert_banner_style: 'solid',
      ...(demoSwitcherOverride() || {}) });
  }
});

app.delete('/api/displays/:id', (req, res) => {
  const count = db.prepare(`SELECT COUNT(*) as c FROM displays`).get().c;
  if (count <= 1) return res.status(400).json({ error: 'At least one display must exist' });
  const result = db.prepare(`DELETE FROM displays WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Display not found' });
  db.prepare(`DELETE FROM layouts WHERE display_id = ?`).run(req.params.id);
  broadcastUpdate('displays');
  res.json({ ok: true });
});

// ── Layout API ────────────────────────────────────────────────────────────────
// Layouts are scoped per display. ?display=<slug-or-id> selects which one;
// omitting it falls back to the first display (keeps old bookmarked display
// URLs and the control app's default view working without changes).

// GET /api/layouts/:orientation?display=kitchen
app.get('/api/layouts/:orientation', (req, res) => {
  const display = resolveDisplay(req.query.display);
  if (!display) return res.status(404).json({ error: 'No displays exist yet' });
  const row = db.prepare(`SELECT * FROM layouts WHERE display_id = ? AND orientation = ?`)
    .get(display.id, req.params.orientation);
  if (!row) return res.status(404).json({ error: 'Layout not found' });
  res.json({ orientation: row.orientation, widgets: JSON.parse(row.widgets), display_id: display.id, display_name: display.name });
});

// PUT /api/layouts/:orientation?display=kitchen
app.put('/api/layouts/:orientation', (req, res) => {
  // A WRITE must never fall back to resolveDisplay()'s own "first display in
  // the database" default the way a read reasonably can — that default
  // exists so a read shows something sensible rather than erroring out, but
  // applied to a save it means any request that omits, mis-sends, or sends a
  // stale/typo'd 'display' silently overwrites some OTHER, unrelated, and
  // often arbitrary display's real content instead of failing loudly.
  // Confirmed as a real, reported incident: a display's own layout got
  // silently replaced with a completely different one's widgets, with no
  // error and no indication anything had gone wrong, while this fallback
  // landing on whichever display happens to sort first was never ruled out
  // as the mechanism. Checking resolveDisplay()'s return isn't enough on its
  // own — it returns a display in BOTH the "slug matched" and "nothing
  // matched, here's the fallback" cases, so the only way to tell them apart
  // is to verify the slug/id actually sent was actually what came back.
  const requested = req.query.display;
  if (!requested) return res.status(400).json({ error: 'A display slug is required to save a layout.' });
  const display = resolveDisplay(requested);
  if (!display || (display.slug !== requested && String(display.id) !== String(requested))) {
    return res.status(404).json({ error: 'That display could not be found.' });
  }
  const { widgets } = req.body;
  if (!Array.isArray(widgets)) return res.status(400).json({ error: 'widgets must be an array' });

  // Enforce the widget limit for non-active accounts — but only block genuinely
  // ADDING widgets beyond what this layout already had, same "never retroactively
  // lock someone out" principle as the device limit above. A layout that's
  // already over the limit (e.g. from before a limit applied, or after a
  // downgrade) can still be edited/rearranged — this only stops growing it further.
  try {
    const limitsRaw = updateSetting('limits_cache', '');
    const limits = limitsRaw ? JSON.parse(limitsRaw) : null;
    if (limits && typeof limits.maxWidgets === 'number') {
      const existingRow = db.prepare(`SELECT widgets FROM layouts WHERE display_id = ? AND orientation = ?`).get(display.id, req.params.orientation);
      const previousCount = existingRow ? (JSON.parse(existingRow.widgets || '[]').length || 0) : 0;
      if (widgets.length > limits.maxWidgets && widgets.length > previousCount) {
        return res.status(403).json({
          error: `This trial/free account is limited to ${limits.maxWidgets} widgets. Activate a license to add more.`,
        });
      }
    }
  } catch { /* if the cache is missing/malformed, fail open rather than block a legitimate save */ }

  db.prepare(`INSERT OR REPLACE INTO layouts (display_id, orientation, widgets) VALUES (?, ?, ?)`)
    .run(display.id, req.params.orientation, JSON.stringify(widgets));
  markHostEditing();           // frequent layout saves = active editing; slaves speed up
  broadcastUpdate('layout', display.id);
  // A camera widget may have just been added or removed anywhere in the fleet —
  // (re)start or stop the local go2rtc media process to match.
  reloadCameraService();
  res.json({ ok: true });
});

// ── Todoist proxy — uses personal API token ───────────────────────────────────
// Was read-only originally; now also supports completing a task (the one
// write this app needs — nothing else here creates/edits/deletes Todoist
// data). Note: Todoist deprecated the old REST v2 API (api.todoist.com/rest/v2/...).
// The current API lives under /api/v1/ and wraps list responses as { results: [...], next_cursor }.
function todoistGet(token, path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.todoist.com',
      path,
      headers: { 'Authorization': `Bearer ${token}` }
    }, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        if (apiRes.statusCode === 401 || apiRes.statusCode === 403) {
          return reject({ status: 401, message: 'Invalid Todoist token' });
        }
        if (apiRes.statusCode >= 400) {
          return reject({ status: 500, message: `Todoist returned status ${apiRes.statusCode}` });
        }
        try {
          const parsed = JSON.parse(data);
          // New API wraps results: { results: [...], next_cursor }. Treat bare arrays as already-unwrapped.
          resolve(Array.isArray(parsed) ? parsed : (parsed.results || []));
        } catch (e) {
          reject({ status: 500, message: 'Failed to parse Todoist response' });
        }
      });
    }).on('error', err => reject({ status: 500, message: err.message }));
  });
}

// POST helper for the one write operation this app makes to Todoist —
// completing a task. Same token/auth as todoistGet above, just a different
// HTTP method; a real request body was never needed for /close (Todoist's
// endpoint takes the task id from the URL path alone), so this stays a
// simple no-body POST rather than a more general "send any payload" helper.
function todoistPost(token, path) {
  return new Promise((resolve, reject) => {
    const apiReq = https.request({
      hostname: 'api.todoist.com',
      path,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Length': 0 },
    }, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        if (apiRes.statusCode === 401 || apiRes.statusCode === 403) {
          return reject({ status: 401, message: 'Invalid Todoist token' });
        }
        if (apiRes.statusCode >= 400) {
          return reject({ status: 500, message: `Todoist returned status ${apiRes.statusCode}` });
        }
        // A successful close returns 204 No Content — nothing to parse, and
        // trying to JSON.parse an empty body would throw for no reason.
        resolve(true);
      });
    });
    apiReq.on('error', err => reject({ status: 500, message: err.message }));
    apiReq.end();
  });
}

// GET /api/todoist/tasks?project_id=XXXX  (project_id optional — omit for all projects)
app.get('/api/todoist/tasks', async (req, res) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'todoist_token'`).get();
  const token = row?.value;
  if (!token) return res.status(400).json({ error: 'No Todoist token configured — add one in Settings' });

  let path = '/api/v1/tasks';
  if (req.query.project_id) path += `?project_id=${encodeURIComponent(req.query.project_id)}`;

  try {
    const tasks = await todoistGet(token, path);
    res.json(tasks);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/todoist/tasks/:id/close — marks a task complete on Todoist
// itself, not just locally. This app never shows completed tasks again
// once they're gone from Todoist's own "active tasks" list (there's no
// local record of them to reopen from here), which is the right behavior
// for a wall display — tapping a task off is meant to be the same as
// checking it off in the real Todoist app, not a display-only hide.
app.post('/api/todoist/tasks/:id/close', async (req, res) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'todoist_token'`).get();
  const token = row?.value;
  if (!token) return res.status(400).json({ error: 'No Todoist token configured — add one in Settings' });
  try {
    await todoistPost(token, `/api/v1/tasks/${encodeURIComponent(req.params.id)}/close`);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/todoist/projects — used to populate the project picker dropdown
app.get('/api/todoist/projects', async (req, res) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'todoist_token'`).get();
  const token = row?.value;
  if (!token) return res.status(400).json({ error: 'No Todoist token configured — add one in Settings' });

  try {
    const projects = await todoistGet(token, '/api/v1/projects');
    res.json(projects);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Home Assistant (Tier 1: read-only Entity Status widget) ──────────────────
// Same shape as the Todoist/Weather integrations above: the base URL + token live
// in settings and are used ONLY server-side — the browser/display never sees the
// token, only ever talks to these proxy endpoints. Unlike Todoist (a fixed
// hostname), Home Assistant is self-hosted at a URL the user provides, so the
// request helper parses it dynamically (same pattern as centralRequest() above)
// rather than assuming a hostname.
function haRequest(pathAndQuery) {
  return haRequestWith(getSetting('ha_base_url'), getSetting('ha_token'), pathAndQuery);
}
// Last outcome of a real HA REST interaction — powers the `ha` field in the
// fleet check-in (fetchUpdateInfo). null = this device has never talked to
// HA (either not configured, or configured but nothing's polled yet).
let _haHealth = null; // { ok: boolean, at: epochMs } | null
function haRequestWith(baseUrl, token, pathAndQuery, method = 'GET', body = null, opts = {}) {
  const configured = !!(baseUrl && token);
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 8000;
  const p = new Promise((resolve, reject) => {
    if (!baseUrl || !token) return reject({ status: 400, message: 'Home Assistant isn\'t configured yet — add a URL and token in Settings' });
    let target;
    try { target = new URL(baseUrl.replace(/\/+$/, '') + pathAndQuery); } catch { return reject({ status: 400, message: 'Invalid Home Assistant URL' }); }
    const transport = target.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
    if (bodyStr) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(bodyStr); }
    const r = transport.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method,
      headers,
    }, (apiRes) => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        if (apiRes.statusCode === 401 || apiRes.statusCode === 403) {
          return reject({ status: 401, message: 'Home Assistant rejected the token — check it\'s still valid' });
        }
        if (apiRes.statusCode === 404) {
          return reject({ status: 404, message: 'Entity not found' });
        }
        if (apiRes.statusCode >= 400) {
          return reject({ status: 502, message: `Home Assistant returned status ${apiRes.statusCode}` });
        }
        // A successful service call can return an empty body (204-shaped 200) or a
        // JSON array of the entities it affected — either is fine, only genuinely
        // malformed JSON (when a body was actually sent back) is an error.
        if (!data.trim()) return resolve(null);
        try { resolve(JSON.parse(data)); }
        catch (e) { reject({ status: 502, message: 'Could not parse Home Assistant\'s response' }); }
      });
    });
    r.on('error', (err) => reject({ status: 502, message: `Could not reach Home Assistant: ${err.message}` }));
    r.setTimeout(timeoutMs, () => r.destroy(new Error('Home Assistant request timed out')));
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
  // Only "HA is configured but we couldn't reach/authenticate it" is a health
  // signal — the not-configured reject above isn't. A token/permission error
  // (status 401) counts as unhealthy; so does any transport failure.
  if (!configured) return p;
  return p.then(
    (v) => { _haHealth = { ok: true, at: Date.now() }; return v; },
    (e) => { _haHealth = { ok: false, at: Date.now() }; throw e; }
  );
}

// GET /api/ha/discover — best-effort auto-detection of a Home Assistant
// instance on the local network, for the Settings "Detect automatically"
// button. Tries, in order: this machine itself (covers the common case of HA
// running in Docker on the same box as this server), the well-known mDNS
// hostname most home networks resolve automatically, this machine's own LAN
// subnet (a fast, concurrency-limited port-8123 sweep), and — if the
// `tailscale` CLI is present — every peer on this device's own tailnet,
// since Tailscale IPs aren't guessable by subnet-scanning the way a LAN is.
// Confirmed via HA's unauthenticated /manifest.json, which is a stable,
// public fingerprint (name: "Home Assistant") — no token needed to detect
// it, only to actually use it afterward.
function probeHaCandidate(hostname, port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname, port, path: '/manifest.json', timeout: 600 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && typeof parsed.name === 'string' && parsed.name.toLowerCase().includes('home assistant')) {
            resolve({ url: `http://${hostname}:${port}`, name: parsed.name });
          } else resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
// Runs a batch of candidate probes with a concurrency cap, since a full /24
// sweep is 254 hosts — doing them all at once would be an unnecessary burst
// of simultaneous connections for what's a one-tap, non-urgent action.
async function probeInBatches(candidates, concurrency = 24) {
  const found = [];
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(c => probeHaCandidate(c.hostname, c.port)));
    results.forEach(r => { if (r) found.push(r); });
  }
  return found;
}
function localIPv4Subnets() {
  // Returns { selfIps, subnetPrefixes } — every non-internal IPv4 this
  // machine has, and the /24 prefix of each, deduplicated. Multiple
  // interfaces (e.g. Wi-Fi + Ethernet, or a Tailscale interface which also
  // shows up here but is deliberately excluded from subnet-scanning — see
  // the Tailscale peer lookup below instead, since its /10 CGNAT range is
  // far too large to brute-force).
  const selfIps = [];
  const prefixes = new Set();
  Object.values(os.networkInterfaces()).flat().forEach(iface => {
    if (!iface || iface.internal || iface.family !== 'IPv4') return;
    if (iface.address.startsWith('100.')) return; // Tailscale CGNAT range — handled separately
    selfIps.push(iface.address);
    prefixes.add(iface.address.split('.').slice(0, 3).join('.'));
  });
  return { selfIps, prefixes: [...prefixes] };
}
function tailscalePeerIps() {
  // Best-effort only — silently returns [] if the `tailscale` CLI isn't
  // installed or the daemon isn't running, both totally normal (most
  // installs won't have it), rather than treating either as an error.
  try {
    const out = execFileSync('tailscale', ['status', '--json'], { timeout: 3000 }).toString();
    const status = JSON.parse(out);
    return Object.values(status.Peer || {})
      .map(p => (p.TailscaleIPs || [])[0])
      .filter(ip => ip && ip.includes('.'));
  } catch { return []; }
}
// This machine's OWN Tailscale IP (not a peer's) — used by the "Add a
// Display" flow so the generated URL/QR code works regardless of what
// network the NEW device is actually on, as long as it's also joined to
// the same tailnet. A LAN-only URL (this admin's own current
// window.location.origin) would only work if the new device happens to be
// on the same Wi-Fi — not a safe assumption for something like a Fire
// Stick that might get moved between rooms/networks.
function tailscaleSelfIp() {
  try {
    const out = execFileSync('tailscale', ['status', '--json'], { timeout: 3000 }).toString();
    const status = JSON.parse(out);
    const ips = (status.Self && status.Self.TailscaleIPs) || [];
    return ips.find(ip => ip.includes('.')) || null;
  } catch { return null; }
}
// GET /api/tailscale-status — powers the "Add a Display" section in the
// Devices tab: whether Tailscale is actually installed/running on THIS
// machine (not assumed), and its IP if so, so the UI can build a URL
// that'll actually work from a device on a different network, and can
// give an honest "not detected" message rather than a URL that silently
// won't work when the new device isn't on the same Wi-Fi.
app.get('/api/tailscale-status', (req, res) => {
  const ip = tailscaleSelfIp();
  res.json({ installed: !!ip, ip, port: PORT });
});
app.get('/api/ha/discover', async (req, res) => {
  try {
    const candidates = [
      { hostname: 'localhost', port: 8123 },
      { hostname: 'homeassistant.local', port: 8123 },
    ];
    const { prefixes } = localIPv4Subnets();
    prefixes.forEach(prefix => {
      for (let host = 1; host <= 254; host++) candidates.push({ hostname: `${prefix}.${host}`, port: 8123 });
    });
    tailscalePeerIps().forEach(ip => candidates.push({ hostname: ip, port: 8123 }));

    const found = await probeInBatches(candidates);
    found.forEach(f => { if (/^https?:\/\/100\./.test(f.url)) f.viaTailscale = true; });
    // Dedupe (the same instance can legitimately be found twice — e.g. via
    // both "localhost" and this machine's own LAN IP).
    const seen = new Set();
    const unique = found.filter(f => (seen.has(f.url) ? false : (seen.add(f.url), true)));
    res.json({ found: unique });
  } catch (e) {
    res.status(500).json({ found: [], error: e.message });
  }
});

// GET /api/ha/test — validates the configured URL+token, for a Settings "Test
// Connection" button. Accepts optional ?url=&token= to test values the person
// just typed but hasn't necessarily saved yet (same reasoning as the weather
// ZIP lookup's ?save=0 — testing shouldn't depend on the debounced auto-save
// having already fired by the time someone clicks the button). Falls back to
// the saved settings when neither is provided. HA's /api/ endpoint just
// confirms the API is up and the token is valid; it doesn't return anything
// the UI needs beyond that.
app.get('/api/ha/test', async (req, res) => {
  const urlOverride = req.query.url;
  const tokenOverride = req.query.token;
  try {
    if (urlOverride !== undefined || tokenOverride !== undefined) {
      await haRequestWith(urlOverride ?? getSetting('ha_base_url'), tokenOverride ?? getSetting('ha_token'), '/api/');
    } else {
      await haRequest('/api/');
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// GET /api/ha/entities — the FULL entity list, trimmed to just what a picker
// needs. Used interactively (opening the entity picker in Settings/widget
// config), never polled, so no caching here — unlike /api/ha/state/:id below,
// which display.html hits on a refresh timer and specifically needs caching to
// avoid hammering someone's Home Assistant instance from multiple displays.
app.get('/api/ha/entities', async (req, res) => {
  try {
    const all = await haRequest('/api/states');
    const trimmed = (Array.isArray(all) ? all : []).map(e => ({
      entity_id: e.entity_id,
      state: e.state,
      friendly_name: (e.attributes && e.attributes.friendly_name) || e.entity_id,
      unit: (e.attributes && e.attributes.unit_of_measurement) || '',
    })).sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
    res.json(trimmed);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Home Assistant Areas (WebSocket-only) ───────────────────────────────────
// HA's REST API (what haRequest()/haRequestWith() above use for everything
// else) has no endpoint for the area/entity/device registries — genuinely
// not there, confirmed against HA's own docs and a still-open community
// feature request for exactly this. The ONLY way to get "which area is
// entity X actually in" is HA's WebSocket API. This is a one-shot
// connection (auth, ask for what we need, close) rather than a persistent
// one — area assignments change rarely enough that the short cache below is
// far simpler than keeping a live socket open for the life of the process.
//
// Resolving an entity's EFFECTIVE area takes two lookups, not one: HA lets
// an entity either have its own direct area_id, OR inherit one from its
// device (most entities go this route — a device gets placed in a room, and
// every entity that device exposes inherits that placement unless
// individually overridden). Skipping the device fallback would leave most
// real installs showing almost nothing grouped, since a direct per-entity
// area_id is the less common case in practice.
function haWsRequest(baseUrl, token, commandTypes) {
  return new Promise((resolve, reject) => {
    if (!WebSocketClient) return reject({ status: 500, message: 'The "ws" module isn\'t installed on this device yet — apply the latest update, then try again.' });
    if (!baseUrl || !token) return reject({ status: 400, message: 'Home Assistant isn\'t configured yet — add a URL and token in Settings' });
    let wsUrl;
    try {
      const u = new URL(baseUrl.replace(/\/+$/, ''));
      wsUrl = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/api/websocket`;
    } catch { return reject({ status: 400, message: 'Invalid Home Assistant URL' }); }

    let sock;
    try { sock = new WebSocketClient(wsUrl); }
    catch (e) { return reject({ status: 502, message: `Could not reach Home Assistant: ${e.message}` }); }

    const results = {};
    const pending = new Map(); // request id -> command type, so a result can be routed back to the right key
    let nextId = 1;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { sock.terminate(); } catch {}
      reject({ status: 502, message: 'Home Assistant WebSocket request timed out' });
    }, 8000);
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch {}
      if (err) reject(err); else resolve(val);
    };
    sock.on('error', (err) => finish({ status: 502, message: `Could not reach Home Assistant: ${err.message}` }));
    sock.on('close', () => finish({ status: 502, message: 'Home Assistant closed the connection unexpectedly' }));
    sock.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'auth_required') {
        sock.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (msg.type === 'auth_invalid') {
        finish({ status: 401, message: 'Home Assistant rejected the token — check it\'s still valid' });
      } else if (msg.type === 'auth_ok') {
        commandTypes.forEach(type => {
          const id = nextId++;
          pending.set(id, type);
          sock.send(JSON.stringify({ id, type }));
        });
      } else if (msg.type === 'result' && pending.has(msg.id)) {
        const type = pending.get(msg.id);
        pending.delete(msg.id);
        // Best-effort per-command: a single registry query failing (unlikely,
        // but e.g. a permissions issue on an unusually locked-down token)
        // degrades that one piece to "nothing found" rather than failing the
        // whole areas feature outright.
        results[type] = msg.success ? msg.result : [];
        if (pending.size === 0) finish(null, results);
      }
    });
  });
}

// GET /api/ha/areas — real Home Assistant areas, plus which area each
// entity effectively belongs to (direct assignment, or inherited from its
// device). Cached for 5 minutes — area layout changes rarely, and every
// open of an entity picker shouldn't cost a fresh WebSocket round-trip.
let haAreasCache = null; // { data, fetchedAt }
const HA_AREAS_CACHE_MS = 5 * 60 * 1000;
app.get('/api/ha/areas', async (req, res) => {
  if (haAreasCache && (Date.now() - haAreasCache.fetchedAt) < HA_AREAS_CACHE_MS) {
    return res.json(haAreasCache.data);
  }
  try {
    const results = await haWsRequest(getSetting('ha_base_url'), getSetting('ha_token'), [
      'config/area_registry/list',
      'config/device_registry/list',
      'config/entity_registry/list',
    ]);
    const areas = (results['config/area_registry/list'] || [])
      .map(a => ({ id: a.area_id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const deviceArea = new Map(); // device_id -> area_id
    (results['config/device_registry/list'] || []).forEach(d => { if (d.area_id) deviceArea.set(d.id, d.area_id); });
    const entityAreas = {}; // entity_id -> area_id
    (results['config/entity_registry/list'] || []).forEach(e => {
      const areaId = e.area_id || (e.device_id ? deviceArea.get(e.device_id) : null);
      if (areaId) entityAreas[e.entity_id] = areaId;
    });
    const data = { areas, entityAreas };
    haAreasCache = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (e) {
    // Degrade gracefully rather than break the picker: an old HA version, a
    // locked-down token, or ws being unavailable (see WebSocketClient guard
    // above) all mean "no area data available," not "the picker is broken" —
    // the entity list itself still comes from the REST endpoint either way.
    res.status(e.status || 500).json({ error: e.message, areas: [], entityAreas: {} });
  }
});

// GET /api/ha/state/:entityId — one entity's current value, for the widget
// itself. Cached briefly (10s) since multiple displays (or multiple widgets
// showing the same entity) polling independently could otherwise add up to a
// lot of requests against someone's home server for data that barely changes
// that fast.
const haStateCache = new Map(); // entity_id -> { data, fetchedAt }
// 4s — short enough that a change made elsewhere (the HA app, an automation)
// shows on the wall within a few seconds, still long enough to absorb the
// overlap when several displays poll the same entity. Cleared outright after
// an action so a tap's confirm read is always live.
const HA_STATE_CACHE_MS = 4_000;
app.get('/api/ha/state/:entityId', async (req, res) => {
  const id = req.params.entityId;
  const cached = haStateCache.get(id);
  if (cached && (Date.now() - cached.fetchedAt) < HA_STATE_CACHE_MS) {
    return res.json(cached.data);
  }
  try {
    const e = await haRequest(`/api/states/${encodeURIComponent(id)}`);
    const attrs = e.attributes || {};
    const trimmed = {
      entity_id: e.entity_id,
      state: e.state,
      friendly_name: attrs.friendly_name || e.entity_id,
      unit: attrs.unit_of_measurement || '',
    };
    // Climate-specific extras, only included when actually present (a light
    // or switch entity simply won't have these fields, so this stays a no-op
    // trim for every domain except climate) — needed by the thermostat
    // stepper UI to know the current target, the live sensed temperature,
    // and the safe range/step to move it in. Never trust a client-supplied
    // range instead of what HA itself reports for this specific device.
    if (attrs.temperature !== undefined) trimmed.targetTemp = attrs.temperature;
    if (attrs.current_temperature !== undefined) trimmed.currentTemp = attrs.current_temperature;
    if (attrs.min_temp !== undefined) trimmed.minTemp = attrs.min_temp;
    if (attrs.max_temp !== undefined) trimmed.maxTemp = attrs.max_temp;
    if (attrs.target_temp_step !== undefined) trimmed.tempStep = attrs.target_temp_step;
    // Light brightness (0-255) for the dimmer slider — only present on a
    // dimmable light that's currently on, a no-op trim for everything else.
    if (attrs.brightness !== undefined && attrs.brightness !== null) trimmed.brightness = attrs.brightness;
    // Light colour: temp (kelvin) + range for the warm/cool slider, and the
    // supported modes so the client knows whether to offer temp / swatches.
    if (attrs.color_temp_kelvin !== undefined && attrs.color_temp_kelvin !== null) trimmed.colorTempK = attrs.color_temp_kelvin;
    if (attrs.min_color_temp_kelvin !== undefined) trimmed.minColorTempK = attrs.min_color_temp_kelvin;
    if (attrs.max_color_temp_kelvin !== undefined) trimmed.maxColorTempK = attrs.max_color_temp_kelvin;
    if (Array.isArray(attrs.supported_color_modes)) trimmed.colorModes = attrs.supported_color_modes;
    if (Array.isArray(attrs.rgb_color)) trimmed.rgbColor = attrs.rgb_color;
    // media_player extras for the transport + volume controls.
    if (attrs.media_title !== undefined && attrs.media_title !== null) trimmed.mediaTitle = String(attrs.media_title);
    if (attrs.volume_level !== undefined && attrs.volume_level !== null) trimmed.volumeLevel = attrs.volume_level;
    if (attrs.is_volume_muted !== undefined) trimmed.volumeMuted = !!attrs.is_volume_muted;
    // Fan speed (0-100) for the speed slider — only on a variable-speed fan.
    if (attrs.percentage !== undefined && attrs.percentage !== null) trimmed.fanPercentage = attrs.percentage;
    haStateCache.set(id, { data: trimmed, fetchedAt: Date.now() });
    res.json(trimmed);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Recent numeric history for one entity, for the Entity Status widget's
// sparkline. History is heavier than a state poll, so it's cached longer and
// downsampled server-side. Returns { points: [{t, v}] } (t = epoch ms).
const haHistoryCache = new Map(); // key `${id}|${hours}` -> { data, fetchedAt }
const HA_HISTORY_CACHE_MS = 5 * 60 * 1000;
app.get('/api/ha/history/:entityId', async (req, res) => {
  const id = req.params.entityId;
  let hours = parseInt(req.query.hours, 10);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) hours = 24;
  const key = `${id}|${hours}`;
  const cached = haHistoryCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < HA_HISTORY_CACHE_MS) return res.json(cached.data);
  try {
    const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const raw = await haRequest(`/api/history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(id)}&minimal_response&no_attributes&significant_changes_only`);
    const series = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : [];
    let points = [];
    for (const p of series) {
      const v = parseFloat(p.state);
      if (!Number.isFinite(v)) continue; // skip 'unavailable'/'unknown'/text
      const t = Date.parse(p.last_changed || p.last_updated || '');
      if (!Number.isFinite(t)) continue;
      points.push({ t, v });
    }
    // Downsample to at most ~100 points so the payload + the SVG stay small.
    const MAX = 100;
    if (points.length > MAX) {
      const step = points.length / MAX;
      const out = [];
      for (let i = 0; i < MAX; i++) out.push(points[Math.floor(i * step)]);
      out.push(points[points.length - 1]);
      points = out;
    }
    const data = { points, hours };
    haHistoryCache.set(key, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Home Assistant Tier 2: controlling devices, not just reading them ──────
// POST /api/ha/call-action — the client NEVER gets to specify an arbitrary HA
// domain/service. It sends only { entityId, action, ...extra }, where action
// is one of a small fixed whitelist decided right here — the actual HA
// service call (domain + service name) is derived server-side from that
// action plus the entity's own domain (parsed from its id, e.g. "light." in
// "light.living_room"), never trusted from the request. This is deliberately
// more conservative than just proxying whatever service name a client sends:
// a bug or a malicious request on the client side can only ever trigger one
// of these specific, known-safe actions, never an arbitrary HA service call.
const HA_ACTIONS = {
  // Generic on/off/toggle — HA's own domain-agnostic services, dispatch
  // correctly for light/switch/fan/etc. without needing per-domain handling.
  turn_on:  () => ({ domain: 'homeassistant', service: 'turn_on' }),
  turn_off: () => ({ domain: 'homeassistant', service: 'turn_off' }),
  toggle:   () => ({ domain: 'homeassistant', service: 'toggle' }),
  // Climate: HA has no generic "set_temperature", it's domain-specific.
  set_temperature: () => ({ domain: 'climate', service: 'set_temperature' }),
  // Scenes/scripts don't have a generic "trigger" service either — the actual
  // convention IS <domain>.turn_on for both, so the entity's own domain
  // (parsed below, not trusted from the client) decides which.
  trigger: (domain) => ({ domain, service: 'turn_on' }),
  // Covers (garage doors, blinds, shades) and locks — domain-specific
  // services, like set_temperature. The route below rejects these unless the
  // target entity is actually of the matching domain (see DOMAIN_LOCKED_ACTIONS).
  open_cover:  () => ({ domain: 'cover', service: 'open_cover' }),
  close_cover: () => ({ domain: 'cover', service: 'close_cover' }),
  stop_cover:  () => ({ domain: 'cover', service: 'stop_cover' }),
  lock:        () => ({ domain: 'lock', service: 'lock' }),
  unlock:      () => ({ domain: 'lock', service: 'unlock' }),
  // Dimming: light.turn_on carrying brightness_pct (added to the service
  // data in the route). Same create-or-adjust semantics HA uses.
  set_brightness: () => ({ domain: 'light', service: 'turn_on' }),
  // media_player transport + volume.
  media_play_pause:     () => ({ domain: 'media_player', service: 'media_play_pause' }),
  media_next_track:     () => ({ domain: 'media_player', service: 'media_next_track' }),
  media_previous_track: () => ({ domain: 'media_player', service: 'media_previous_track' }),
  volume_set:           () => ({ domain: 'media_player', service: 'volume_set' }),
  // Fan variable speed: fan.set_percentage carrying `percentage` (added in
  // the route from fan_pct).
  set_fan_speed:        () => ({ domain: 'fan', service: 'set_percentage' }),
  // Light colour: both are light.turn_on with a colour arg added in the route.
  set_color_temp:       () => ({ domain: 'light', service: 'turn_on' }),
  set_color:            () => ({ domain: 'light', service: 'turn_on' }),
};
// Actions that only make sense aimed at one specific entity domain — a guard
// so "unlock" can't be fired at a light, etc. (HA would just error, but this
// gives a clear message and never dispatches a nonsensical call).
const DOMAIN_LOCKED_ACTIONS = {
  open_cover: 'cover', close_cover: 'cover', stop_cover: 'cover',
  lock: 'lock', unlock: 'lock',
  set_brightness: 'light',
  media_play_pause: 'media_player', media_next_track: 'media_player',
  media_previous_track: 'media_player', volume_set: 'media_player',
  set_fan_speed: 'fan',
  set_color_temp: 'light', set_color: 'light',
};
// Read-only domains: no actionable service exists, so an on/off/toggle/trigger
// aimed at one means a mis-picked entity (a sensor dropped into a switch
// widget slot, say). HA silently no-ops the call and returns ok, which looks
// like it worked — reject it here so the mistake is visible instead.
const HA_READ_ONLY_DOMAINS = new Set(['sensor', 'binary_sensor', 'weather', 'sun', 'air_quality', 'zone']);
const HA_UNTARGETED_ACTIONS = new Set(['turn_on', 'turn_off', 'toggle', 'trigger']);

// Fire an HA service call without making the client wait for its full
// completion. HA's REST /api/services endpoint holds the HTTP response until
// the service action AND everything listening for the resulting state change
// have finished — for a cover that's the whole travel time, several seconds.
// HA's own UI doesn't feel this because it calls services over the websocket
// API, which returns as soon as the call is scheduled. This mirrors that: we
// wait a short window for a *fast* failure (bad token, unknown entity, HA
// unreachable — all resolve well under it), then answer the client
// optimistically and let the request finish in the background, logging only a
// genuine late failure. A generous ceiling still bounds the background request
// (covers the old 8s timeout being too short for a slow cover, without
// letting it hang forever).
const HA_ACTION_SOFT_ACK_MS = 1500;
const HA_ACTION_HARD_TIMEOUT_MS = 35000;
async function fireHaServiceCall(servicePath, body, onSettle) {
  const call = haRequestWith(
    getSetting('ha_base_url'), getSetting('ha_token'),
    servicePath, 'POST', body, { timeoutMs: HA_ACTION_HARD_TIMEOUT_MS },
  );
  let settled = null; // null = still running, 'ok' = done, Error-ish = failed
  call.then(
    () => { settled = 'ok'; try { onSettle(); } catch {} },
    (e) => { settled = e || new Error('failed'); console.warn(`HA ${servicePath} did not complete cleanly: ${(e && e.message) || e}`); },
  );
  await new Promise(r => setTimeout(r, HA_ACTION_SOFT_ACK_MS));
  if (settled && settled !== 'ok') {
    const err = new Error(settled.message || 'Home Assistant rejected the command');
    err.status = settled.status || 502;
    throw err;
  }
  // Drop the cached state now too, so the client's follow-up poll (~700ms
  // later) reads fresh rather than the stale pre-action value.
  try { onSettle(); } catch {}
  return { ok: true, pending: settled !== 'ok' };
}

app.post('/api/ha/call-action', async (req, res) => {
  const { entityId, action, temperature } = req.body || {};
  if (!entityId || typeof entityId !== 'string' || !entityId.includes('.')) {
    return res.status(400).json({ error: 'Missing or invalid entityId.' });
  }
  if (!Object.prototype.hasOwnProperty.call(HA_ACTIONS, action)) {
    return res.status(400).json({ error: `Unknown action "${action}".` });
  }
  const domain = entityId.split('.')[0];
  if (DOMAIN_LOCKED_ACTIONS[action] && domain !== DOMAIN_LOCKED_ACTIONS[action]) {
    return res.status(400).json({ error: `"${action}" is only valid for ${DOMAIN_LOCKED_ACTIONS[action]} entities.` });
  }
  if (HA_UNTARGETED_ACTIONS.has(action) && HA_READ_ONLY_DOMAINS.has(domain)) {
    return res.status(400).json({ error: `${domain} entities are read-only — no on/off/toggle control.` });
  }
  const { domain: svcDomain, service } = HA_ACTIONS[action](domain);
  const data = { entity_id: entityId };
  if (action === 'set_temperature') {
    const t = Number(temperature);
    if (!Number.isFinite(t)) return res.status(400).json({ error: 'set_temperature needs a numeric temperature.' });
    data.temperature = t;
  }
  if (action === 'set_brightness') {
    const p = Number(req.body && req.body.brightness_pct);
    if (!Number.isFinite(p) || p < 1 || p > 100) return res.status(400).json({ error: 'set_brightness needs brightness_pct between 1 and 100.' });
    data.brightness_pct = Math.round(p);
  }
  if (action === 'volume_set') {
    const v = Number(req.body && req.body.volume_pct);
    if (!Number.isFinite(v) || v < 0 || v > 100) return res.status(400).json({ error: 'volume_set needs volume_pct between 0 and 100.' });
    data.volume_level = Math.round(v) / 100;
  }
  if (action === 'set_fan_speed') {
    const p = Number(req.body && req.body.fan_pct);
    if (!Number.isFinite(p) || p < 1 || p > 100) return res.status(400).json({ error: 'set_fan_speed needs fan_pct between 1 and 100.' });
    data.percentage = Math.round(p);
  }
  if (action === 'set_color_temp') {
    const k = Number(req.body && req.body.kelvin);
    if (!Number.isFinite(k) || k < 1000 || k > 10000) return res.status(400).json({ error: 'set_color_temp needs kelvin between 1000 and 10000.' });
    data.color_temp_kelvin = Math.round(k);
  }
  if (action === 'set_color') {
    const parts = String((req.body && req.body.rgb) || '').split(',').map(n => parseInt(n, 10));
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n < 0 || n > 255)) {
      return res.status(400).json({ error: 'set_color needs rgb as "r,g,b" with each 0-255.' });
    }
    data.rgb_color = parts;
  }
  try {
    // Fire-and-forget: reply as soon as HA accepts the call (or a fast error
    // comes back), not after the cover/lock/etc. physically finishes. The
    // cache drop lets the next /api/ha/state/:entityId poll (a few seconds
    // out, not the full 10s window) reflect the real new state.
    const out = await fireHaServiceCall(`/api/services/${svcDomain}/${service}`, data, () => haStateCache.delete(entityId));
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/ha/call-group-action — for the Group Control widget (turn a
// whole set of entities on/off with one tap, e.g. "turn a whole floor
// off"). Deliberately a SEPARATE endpoint from call-action above rather than
// letting entityId also accept an array there: only turn_on/turn_off are
// allowed here, NOT toggle — HA's own toggle service, given multiple
// entity_ids, toggles each one independently based on its OWN current
// state, which is wrong for a group tile (a mixed on/off group would end up
// with the on ones turning off and the off ones turning on, the opposite of
// "one clear group action"). The client already has every member's current
// state loaded (it's rendering the tile from it), so it decides the target
// action itself — if anything in the group is on, send turn_off; only if
// everything is off does it send turn_on — and this endpoint just executes
// whichever one it's told, the same restrained "client decides, server
// only ever runs one of a few known-safe things" split already used by
// call-action above. One real HA service call with entity_id as an array,
// not N separate calls — turn_on/turn_off are HA's domain-agnostic
// dispatch services, so a group spanning light/switch/fan entities in one
// call is normal, supported usage, not a hack.
app.post('/api/ha/call-group-action', async (req, res) => {
  const { entityIds, action } = req.body || {};
  if (!Array.isArray(entityIds) || !entityIds.length || entityIds.some(id => typeof id !== 'string' || !id.includes('.'))) {
    return res.status(400).json({ error: 'entityIds must be a non-empty array of valid entity ids.' });
  }
  if (action !== 'turn_on' && action !== 'turn_off') {
    return res.status(400).json({ error: `Unsupported group action "${action}" — only turn_on/turn_off are allowed here.` });
  }
  try {
    // Same fire-and-forget treatment as call-action — a group turn_on/off
    // spanning several entities can take HA a moment to fully settle.
    const out = await fireHaServiceCall(`/api/services/homeassistant/${action}`, { entity_id: entityIds }, () => entityIds.forEach(id => haStateCache.delete(id)));
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── News (Google News RSS — no key required) ──────────────────────────────────
// Cached in-memory since Google may rate-limit/block frequent polling; the display
// only needs a refresh every 15-30 minutes anyway for a headline ticker. The cache
// is keyed on the source configuration so changing sources refetches immediately.
let newsCache = { items: [], fetchedAt: 0, key: '' };
const NEWS_CACHE_MS = 15 * 60 * 1000; // 15 minutes
const NEWS_LOCALE = 'hl=en-US&gl=US&ceid=US:en';

function parseNewsRSS(xml) {
  const items = [];
  const itemBlocks = xml.split('<item>').slice(1);
  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (!titleMatch) continue;

    let title = titleMatch[1].trim();
    // Decode common XML/HTML entities and strip CDATA wrappers
    title = title.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
    title = title.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
                 .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    let link = linkMatch ? linkMatch[1].trim() : '';
    link = link.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');

    // Google News RSS titles are usually "Headline - Source Name"; split it apart
    // since we already get the source separately and don't want it duplicated.
    let source = sourceMatch ? sourceMatch[1].trim() : '';
    if (!source && title.includes(' - ')) {
      const parts = title.split(' - ');
      source = parts[parts.length - 1].trim();
      title = parts.slice(0, -1).join(' - ').trim();
    }

    items.push({
      title,
      source,
      link,
      pubDate: pubDateMatch ? pubDateMatch[1].trim() : null,
    });
  }
  return items;
}

// Reads the configured news sources from settings and returns a list of
// { url, label, priority } source descriptors to fetch.
function getNewsSources() {
  const get = (k) => (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value ?? '');
  const on = (k) => get(k) === '1';
  const sources = [];

  if (on('news_world_enabled')) {
    // Google News "World" topic feed.
    sources.push({
      url: `https://news.google.com/rss/headlines/section/topic/WORLD?${NEWS_LOCALE}`,
      label: 'World',
      priority: on('news_world_priority'),
    });
  }

  if (on('news_national_enabled')) {
    sources.push({
      url: `https://news.google.com/rss?${NEWS_LOCALE}`,
      label: 'National',
      priority: on('news_national_priority'),
    });
  }

  if (on('news_local_enabled')) {
    const loc = get('news_local_location').trim();
    if (loc) {
      // Search feed is more reliable for arbitrary place names than the geo section feed.
      sources.push({
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(loc)}&${NEWS_LOCALE}`,
        label: loc,
        priority: on('news_local_priority'),
      });
    }
  }

  if (on('news_keywords_enabled')) {
    const kw = get('news_keywords').trim();
    if (kw) {
      // Each comma-separated term becomes its own labeled group, labeled with the term itself.
      const priority = on('news_keywords_priority');
      for (const term of kw.split(',').map(t => t.trim()).filter(Boolean)) {
        sources.push({
          url: `https://news.google.com/rss/search?q=${encodeURIComponent(term)}&${NEWS_LOCALE}`,
          label: term,
          priority,
        });
      }
    }
  }

  return sources;
}

// Interleaves headlines from multiple sources, giving priority sources their
// reserved slots first so they can't be crowded out, then filling the rest
// round-robin from all sources. `limit` caps the total (a generous superset of
// what any widget will display; the widget applies its own max).
function assembleNews(perSource, limit) {
  const result = [];
  const seen = new Set();
  const pushUnique = (item) => {
    const k = item.link || item.title;
    if (seen.has(k)) return false;
    seen.add(k);
    result.push(item);
    return true;
  };

  // 1) Reserve slots for priority sources first. Give each priority source a fair
  //    guaranteed share of the limit before non-priority sources get any room.
  const priority = perSource.filter(s => s.priority && s.items.length);
  if (priority.length) {
    const reservePerSource = Math.max(1, Math.floor((limit * 0.6) / priority.length));
    for (const s of priority) {
      for (let i = 0; i < reservePerSource && i < s.items.length; i++) {
        if (result.length >= limit) break;
        pushUnique(s.items[i]);
      }
      s._taken = Math.min(reservePerSource, s.items.length);
    }
  }

  // 2) Fill remaining slots round-robin across ALL enabled sources (priority first
  //    in ordering, continuing past whatever was already reserved).
  const ordered = [...perSource].sort((a, b) => (b.priority === a.priority ? 0 : b.priority ? 1 : -1));
  let added = true;
  let round = 0;
  while (result.length < limit && added) {
    added = false;
    for (const s of ordered) {
      const start = s._taken || 0;
      const idx = start + round;
      if (idx < s.items.length) {
        if (pushUnique(s.items[idx])) added = true;
        if (result.length >= limit) break;
      }
    }
    round++;
  }
  return result;
}

async function getNews() {
  const now = Date.now();
  const sources = getNewsSources();

  // Fall back to National if somehow nothing is enabled, so the widget is never empty.
  if (!sources.length) {
    sources.push({ url: `https://news.google.com/rss?${NEWS_LOCALE}`, label: 'National', priority: false });
  }

  const cacheKey = JSON.stringify(sources.map(s => [s.url, s.label, s.priority]));
  if (newsCache.items.length && newsCache.key === cacheKey && (now - newsCache.fetchedAt) < NEWS_CACHE_MS) {
    return { items: newsCache.items, cached: true };
  }

  try {
    // Fetch all sources in parallel; tolerate individual source failures.
    const perSource = await Promise.all(sources.map(async (s) => {
      try {
        const xml = await fetchUrl(s.url);
        const items = parseNewsRSS(xml).slice(0, 15).map(it => ({ ...it, group: s.label }));
        return { ...s, items };
      } catch {
        return { ...s, items: [] };
      }
    }));

    const items = assembleNews(perSource, 25);
    if (!items.length) throw new Error('No headlines returned from any source');
    newsCache = { items, fetchedAt: now, key: cacheKey };
    return { items, cached: false };
  } catch (e) {
    if (newsCache.items.length) {
      return { items: newsCache.items, cached: true, stale: true };
    }
    throw e;
  }
}

app.get('/api/news', async (req, res) => {
  try {
    res.json(await getNews());
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch news: ' + e.message });
  }
});

// ── Stocks (Stooq — no key required) ──────────────────────────────────────────
// Stooq's quote endpoint accepts comma-separated symbols in a single request and
// Stock/index quotes via Finnhub (https://finnhub.io) — free tier, 60 requests/min,
// no credit card required. Requires the user's own API key (Settings > Stocks),
// since Finnhub is per-account rather than fully anonymous.
//
// Switched from Stooq in mid-2026 after Stooq's quote endpoint started returning
// "page does not exist" for programmatic requests — Stooq disabled automated/CAPTCHA-free
// access back in Dec 2020 and was never a reliable foundation.
//
// Briefly tried Finnhub with index-tracking ETFs (DIA/QQQ/SPY) as a stand-in for the
// real indices, since free tiers don't offer raw index data — but the ETF share price
// doesn't resemble the real index value (e.g. DIA trades around $515, not "51,564"),
// which looked broken even though the percent-change was a reasonable approximation.
//
// Now using Yahoo Finance's unofficial chart endpoint instead, which DOES return the
// real index values (^DJI, ^IXIC, ^GSPC) for free with no API key or signup at all.
// This is genuinely unofficial — Yahoo doesn't publish or support it, reverse-engineered
// by the community, and it CAN change or break without notice (it already has at least
// once, per public module changelogs). Accepting that risk in exchange for real numbers
// and zero setup. If Yahoo breaks this again in the future, that's the next thing to fix.
let stockCache = { quotes: [], fetchedAt: 0, cacheKey: '' };
const STOCK_CACHE_MS = 5 * 60 * 1000; // 5 minutes — markets move faster than news, but no need for real-time on a wall display

const STOCK_INDICES = [
  { symbol: '^DJI',  label: 'Dow Jones' },
  { symbol: '^IXIC', label: 'Nasdaq' },
  { symbol: '^GSPC', label: 'S&P 500' },
];

// Yahoo's endpoint rejects non-browser User-Agents, so this uses its own fetch
// (rather than the shared fetchUrl helper, which sends a generic UA fine for
// every other source we talk to) to avoid touching code other features depend on.
function fetchYahooUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    lib.get(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchYahooUrl(res.headers.location));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const { status, body } = await fetchYahooUrl(url);
  if (status !== 200) {
    throw new Error(`Yahoo Finance returned an error (HTTP ${status}) — it may be temporarily unavailable.`);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('Yahoo Finance returned an unexpected response — the unofficial endpoint may have changed.');
  }
  const result = data?.chart?.result?.[0];
  if (!result || !result.meta || typeof result.meta.regularMarketPrice !== 'number') {
    return null; // unrecognized symbol or no data for it
  }
  const close = result.meta.regularMarketPrice;
  const prevClose = result.meta.chartPreviousClose ?? result.meta.previousClose;
  const change = (typeof prevClose === 'number') ? close - prevClose : null;
  const changePct = (typeof prevClose === 'number' && prevClose !== 0) ? (change / prevClose) * 100 : null;
  return { close, open: prevClose ?? null, change, changePct };
}

// customTickers: the UNION of every Stock widget's own `stockTickers` list,
// passed in per-request from the client (see fetchStocks() in display.html/
// app.html) — tracking individual tickers moved from being one device-wide
// Data Sources setting to a per-widget Stock widget setting in v1.77.77, so
// there's no longer a single "the" ticker list to read from the DB. `null`
// means the request didn't specify any (an older, not-yet-updated client),
// in which case we fall back to the old DB value so that client doesn't
// regress to seeing zero custom tickers mid-rollout across a multi-device
// household.
// The union of every Stock widget's own `stockTickers` across every display's
// layout (both orientations) — used by the Daily Briefing email, which has no
// single widget to ask (it's one device-wide digest, not tied to a display).
// Falls back to the legacy DB-wide list only if genuinely no widget anywhere
// defines its own list yet (pre-migration, or no Stock widget in use at all).
function getAllStockTickersFromLayouts() {
  const rows = db.prepare(`SELECT widgets FROM layouts`).all();
  const set = new Set();
  let sawAnyStockWidget = false;
  for (const row of rows) {
    let widgets;
    try { widgets = JSON.parse(row.widgets); } catch { continue; }
    if (!Array.isArray(widgets)) continue;
    for (const w of widgets) {
      if (w && w.type === 'stocks') {
        sawAnyStockWidget = true;
        (Array.isArray(w.stockTickers) ? w.stockTickers : []).forEach(t => {
          if (t) set.add(String(t).trim().toUpperCase());
        });
      }
    }
  }
  if (!sawAnyStockWidget) return null; // no Stock widget anywhere yet — let getStocks() fall back to the legacy DB value
  return [...set];
}

async function getStocks(customTickers) {
  if (customTickers === null) {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'stock_tickers'`).get();
    customTickers = (row?.value || '').split(',').map(t => t.trim()).filter(Boolean);
  }
  // Indices the user has unchecked (e.g. "^DJI") are excluded entirely.
  const disabledRow = db.prepare(`SELECT value FROM settings WHERE key = 'stock_indices_disabled'`).get();
  const disabled = new Set((disabledRow?.value || '').split(',').map(t => t.trim()).filter(Boolean));
  const activeIndices = STOCK_INDICES.filter(i => !disabled.has(i.symbol));

  const now = Date.now();
  const cacheKey = customTickers.join(',') + '|' + [...disabled].sort().join(',');
  if (stockCache.quotes.length && stockCache.cacheKey === cacheKey && (now - stockCache.fetchedAt) < STOCK_CACHE_MS) {
    return { quotes: stockCache.quotes, cached: true };
  }

  const allSymbols = [
    ...activeIndices.map(i => ({ symbol: i.symbol, label: i.label, isIndex: true })),
    ...customTickers.map(t => {
      const symbol = t.toUpperCase();
      // Yahoo's crypto pairs are always "COIN-USD" (or -EUR etc.) — no equity ticker
      // uses a hyphen, so this is a reliable way to tell them apart for display styling.
      const isCrypto = /^[A-Z0-9]+-[A-Z]{3}$/.test(symbol);
      return { symbol, label: symbol.replace(/-[A-Z]{3}$/, ''), isIndex: false, isCrypto };
    }),
  ];

  try {
    // One request per symbol — Yahoo's chart endpoint doesn't offer a bulk-quote
    // call on the unofficial surface, but this is a handful of symbols refreshed
    // every 5 minutes, nowhere near anything that would trigger rate limiting.
    const quotes = [];
    for (const { symbol, label, isIndex, isCrypto } of allSymbols) {
      const q = await fetchYahooQuote(symbol);
      if (q) quotes.push({ ...q, symbol, label, isIndex, isCrypto: !!isCrypto });
    }
    if (!quotes.length) throw new Error('No quotes returned from Yahoo Finance — it may be temporarily unavailable.');
    stockCache = { quotes, fetchedAt: now, cacheKey };
    return { quotes, cached: false };
  } catch (e) {
    if (stockCache.quotes.length) {
      return { quotes: stockCache.quotes, cached: true, stale: true };
    }
    throw e;
  }
}

app.get('/api/stocks', async (req, res) => {
  try {
    // req.query.tickers, when present (even as ''), means the client already
    // knows per-widget tickers and is telling us the union explicitly — only
    // fall back to the legacy DB-wide list when the param is missing entirely.
    const customTickers = (req.query.tickers !== undefined)
      ? req.query.tickers.split(',').map(t => t.trim()).filter(Boolean)
      : null;
    res.json(await getStocks(customTickers));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Server-side mirror of reminderOccursOnDate() in display.html/app.html —
// same two schedule types, same logic, kept in sync deliberately rather
// than shared via a module, matching how this codebase already keeps
// date-formatting helpers duplicated per file rather than centralized.
// Needed here specifically for the Daily Briefing email, which has no
// browser/client context to call into.
// ── Reminder recurrence engine ──────────────────────────────────────────────
// Modeled on iOS Calendar's custom-recurrence picker (Repeat → Custom),
// added on top of the original two-pattern system (weekly / interval) to
// also support monthly, yearly, and a universal end condition. Every new
// field is additive and optional — a reminder saved before this existed has
// none of them, and every branch below treats their absence as "no
// constraint," so old reminders keep behaving exactly as they always did.
//
// schedule_type: 'weekly' | 'interval' (daily) | 'monthly' | 'yearly'
// schedule_config, universal fields (all types):
//   startDate: 'YYYY-MM-DD' — anchor for interval counting and end conditions.
//     Always required going forward for anything besides plain weekly, but
//     optional/ignored for weekly's own day-of-week check (backward compat).
//   endType: 'never' (default) | 'onDate' | 'afterCount'
//   endDate: 'YYYY-MM-DD' — used when endType='onDate'
//   endCount: integer — used when endType='afterCount', counts pattern
//     matches from startDate up to and including the date being checked
// schedule_config, per schedule_type:
//   weekly:   daysOfWeek:[0-6,...], weekInterval:N (default 1, "every N weeks")
//   interval: intervalDays:N ("every N days" — the original/only pattern
//             this type ever had; kept under this name for backward compat
//             rather than renamed to something like 'daily')
//   monthly:  monthlyMode:'dayOfMonth'|'nthWeekday', monthInterval:N (default 1),
//             dayOfMonth:1-31 (dayOfMonth mode), nthWeek:1-4|-1 + nthWeekday:0-6
//             (nthWeekday mode, -1 = "last")
//   yearly:   yearlyMonth:1-12, yearInterval:N (default 1),
//             yearlyMode:'date'|'nthWeekday', yearlyDay:1-31 (date mode),
//             yearlyNthWeek:1-4|-1 + yearlyNthWeekday:0-6 (nthWeekday mode)
//
// A day-by-day scan is used for 'afterCount' rather than a closed-form
// occurrence-number formula — reminders are a small, low-frequency dataset
// (this runs against a handful of rows, not thousands), and a bounded scan
// is far less error-prone to get right across four different recurrence
// shapes than four separate closed-form counting formulas would be. Capped
// at 10 years so a malformed/missing startDate can't scan effectively
// forever.
const REMINDER_COUNT_SCAN_CAP_DAYS = 3650;

function reminderDaysBetween(a, b) { return Math.round((b - a) / 86400000); }
function reminderStartOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }
// nth: 1-4 for 1st-4th occurrence of that weekday in the month, -1 for the
// last. Returns null if that occurrence doesn't exist (e.g. a 5th Monday in
// a month that only has 4) — the caller treats null as "no match," not an
// error, since this can legitimately happen for `nth` in 1-4 depending on
// how the month falls.
function reminderNthWeekdayOfMonth(year, month0, weekday, nth) {
  if (nth === -1) {
    const last = new Date(year, month0 + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month0, last.getDate() - offset);
  }
  const first = new Date(year, month0, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const d = new Date(year, month0, day);
  return d.getMonth() === month0 ? d : null;
}
// Whether the recurrence PATTERN itself lands on this date — ignores the end
// condition entirely (reminderOccursOnDateServer, below, layers that on top).
// Kept as its own function because 'afterCount' needs to re-run this in a
// scan without recursively re-checking the end condition on every step.
function reminderMatchesPatternServer(reminder, d) {
  const cfg = reminder.schedule_config || {};
  const type = reminder.schedule_type;
  if (type === 'weekly') {
    if (!Array.isArray(cfg.daysOfWeek) || !cfg.daysOfWeek.includes(d.getDay())) return false;
    if (cfg.startDate) {
      const start = new Date(cfg.startDate + 'T00:00:00');
      if (d < start) return false;
      const interval = cfg.weekInterval || 1;
      if (interval > 1) {
        const weeks = reminderDaysBetween(reminderStartOfWeek(start), reminderStartOfWeek(d)) / 7;
        if (weeks % interval !== 0) return false;
      }
    }
    return true;
  }
  if (type === 'interval') {
    if (!cfg.startDate || !cfg.intervalDays) return false;
    const start = new Date(cfg.startDate + 'T00:00:00');
    const diff = reminderDaysBetween(start, d);
    return diff >= 0 && diff % cfg.intervalDays === 0;
  }
  if (type === 'monthly') {
    if (!cfg.startDate) return false;
    const start = new Date(cfg.startDate + 'T00:00:00');
    if (d < start) return false;
    const interval = cfg.monthInterval || 1;
    if (interval > 1) {
      const monthsDiff = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
      if (monthsDiff % interval !== 0) return false;
    }
    if (cfg.monthlyMode === 'nthWeekday') {
      const target = reminderNthWeekdayOfMonth(d.getFullYear(), d.getMonth(), cfg.nthWeekday, cfg.nthWeek);
      return !!target && target.getDate() === d.getDate();
    }
    return d.getDate() === cfg.dayOfMonth; // naturally skips months without that day (e.g. 31st in Feb)
  }
  if (type === 'yearly') {
    if (!cfg.startDate) return false;
    const start = new Date(cfg.startDate + 'T00:00:00');
    if (d < start) return false;
    if (d.getMonth() + 1 !== cfg.yearlyMonth) return false;
    const interval = cfg.yearInterval || 1;
    if (interval > 1) {
      const yearsDiff = d.getFullYear() - start.getFullYear();
      if (yearsDiff % interval !== 0) return false;
    }
    if (cfg.yearlyMode === 'nthWeekday') {
      const target = reminderNthWeekdayOfMonth(d.getFullYear(), d.getMonth(), cfg.yearlyNthWeekday, cfg.yearlyNthWeek);
      return !!target && target.getDate() === d.getDate();
    }
    return d.getDate() === cfg.yearlyDay;
  }
  return false;
}
function reminderOccursOnDateServer(reminder, dateStr) {
  const cfg = reminder.schedule_config || {};
  const d = new Date(dateStr + 'T00:00:00');
  if (!reminderMatchesPatternServer(reminder, d)) return false;
  const endType = cfg.endType || 'never';
  if (endType === 'onDate') {
    return !cfg.endDate || dateStr <= cfg.endDate;
  }
  if (endType === 'afterCount') {
    if (!cfg.endCount || !cfg.startDate) return true;
    const start = new Date(cfg.startDate + 'T00:00:00');
    let count = 0;
    for (let i = 0; i <= REMINDER_COUNT_SCAN_CAP_DAYS; i++) {
      const cur = new Date(start);
      cur.setDate(cur.getDate() + i);
      if (cur > d) break;
      if (reminderMatchesPatternServer(reminder, cur)) count++;
    }
    return count <= cfg.endCount;
  }
  return true;
}

// ── Daily Briefing email ───────────────────────────────────────────────────────
// Assembles today's events, tasks, news, and weather into one email, sent at a
// configured time each day. Gmail SMTP is the only provider wired up right now,
// but the transporter is built from a `provider` setting so adding others later
// (Outlook, Yahoo, custom SMTP) just means adding another case below — no rewrite.

function getEmailSettings() {
  const keys = ['briefing_enabled', 'briefing_time', 'briefing_provider',
                'briefing_email_user', 'briefing_email_pass', 'briefing_last_sent',
                'display_name', 'briefing_todoist_project_ids', 'briefing_task_scope',
                'briefing_weather_format', 'briefing_include_news', 'briefing_news_per_section',
                'briefing_include_stocks', 'briefing_include_reminders'];
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(()=>'?').join(',')})`).all(...keys);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function getBriefingRecipients(onlyEnabled = true) {
  const query = onlyEnabled
    ? `SELECT * FROM briefing_recipients WHERE enabled = 1 ORDER BY sort_order ASC, id ASC`
    : `SELECT * FROM briefing_recipients ORDER BY sort_order ASC, id ASC`;
  return db.prepare(query).all();
}

function greetingForTime(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function buildMailTransporter(s) {
  if (s.briefing_provider === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail', // shortcut for smtp.gmail.com:587 with STARTTLS
      auth: { user: s.briefing_email_user, pass: s.briefing_email_pass },
      // Force IPv4. Without this, Node's DNS resolution can hand back an IPv6
      // address for smtp.gmail.com, and on any network with partial/broken
      // outbound IPv6 (common — many home ISPs/routers are like this) the
      // connection fails outright with ENETUNREACH before ever reaching the
      // login step. Unlike a browser, Node doesn't automatically retry on IPv4
      // ("happy eyeballs") — it just fails. This looks exactly like an auth
      // problem at a glance (mail just won't send) but has nothing to do with
      // the app password; forcing IPv4 sidesteps it entirely.
      family: 4,
    });
  }
  // Future providers (Outlook, Yahoo, custom SMTP) would add cases here, e.g.:
  // if (s.briefing_provider === 'outlook') return nodemailer.createTransport({ service: 'hotmail', ... });
  throw new Error(`Unsupported email provider: ${s.briefing_provider}`);
}

// Translates a raw Node/nodemailer error into something a parent can actually act
// on, instead of a string like "connect ENETUNREACH 2607:f8b0:... - Local (:::0)"
// that reads exactly like a credentials problem but usually isn't one.
function friendlyMailError(e) {
  const code = e && e.code;
  const msg = String((e && e.message) || e || '');
  if (code === 'EAUTH' || /invalid login|username and password not accepted|BadCredentials/i.test(msg)) {
    return 'Gmail rejected the login — the app password is likely wrong, expired, or was revoked. Generate a fresh one at myaccount.google.com/apppasswords and re-enter it in Settings.';
  }
  if (code === 'ENETUNREACH') {
    return 'Could not reach Gmail\u2019s mail server over the network (this Pi may have broken/partial IPv6 connectivity). This is not an app-password problem.';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Could not resolve smtp.gmail.com — this Pi may not have working internet/DNS access right now.';
  }
  if (code === 'ECONNREFUSED') {
    return 'The connection to Gmail was refused — a firewall on this network may be blocking outbound mail (port 587).';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return 'The connection to Gmail timed out — check this Pi\u2019s internet connection.';
  }
  return msg; // fall back to the raw message for anything not specifically recognized
}

// Pulls together everything the briefing needs. Reuses the same data-fetching
// functions the API routes and display use, so the briefing always matches
// what's actually configured (calendars, Todoist project filters aren't applied
// here on purpose — the briefing intentionally shows ALL events/tasks for the day).
async function assembleBriefingContent() {
  const today = localDateStr();

  // Events happening today (span-aware, same logic as the calendar widgets)
  const events = db.prepare(`
    SELECT title, date, end_date, start_time, end_time, color, notes, 'local' as source
    FROM events
    WHERE date <= ? AND COALESCE(end_date, date) >= ?
    ORDER BY start_time ASC
  `).all(today, today);
  const icalEvents = db.prepare(`
    SELECT ie.title, ie.date, ie.end_date, ie.start_time, ie.end_time, ie.notes,
           f.name as feed_name, 'ical' as source
    FROM ical_events ie
    JOIN ical_feeds f ON f.id = ie.feed_id
    WHERE f.enabled = 1 AND ie.date <= ? AND COALESCE(ie.end_date, ie.date) >= ?
    ORDER BY ie.start_time ASC
  `).all(today, today);
  const allEvents = [...events, ...icalEvents].sort((a, b) => {
    if (!a.start_time) return -1;
    if (!b.start_time) return 1;
    return a.start_time < b.start_time ? -1 : 1;
  });

  // Tasks from Todoist — filtered to selected projects if configured, otherwise all
  // projects. Scope controls due-date filtering: 'all' (default) includes every task
  // regardless of due date; 'today' narrows to tasks due today or overdue.
  let tasks = [];
  let tasksError = null;
  const tokenRow = db.prepare(`SELECT value FROM settings WHERE key = 'todoist_token'`).get();
  const projectFilterRow = db.prepare(`SELECT value FROM settings WHERE key = 'briefing_todoist_project_ids'`).get();
  const projectFilterIds = (projectFilterRow?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const taskScopeRow = db.prepare(`SELECT value FROM settings WHERE key = 'briefing_task_scope'`).get();
  const taskScope = taskScopeRow?.value === 'today' ? 'today' : 'all';
  if (tokenRow?.value) {
    try {
      const result = await todoistGet(tokenRow.value, '/api/v1/tasks');
      tasks = result;
      if (taskScope === 'today') {
        tasks = tasks.filter(t => t.due && t.due.date <= today); // due today or overdue
      }
      if (projectFilterIds.length) {
        tasks = tasks.filter(t => projectFilterIds.includes(t.project_id));
      }
    } catch (e) {
      tasksError = e.message;
    }
  }

  // Email content options
  const getS = (k) => db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value;
  const includeNews = getS('briefing_include_news') !== '0';
  const perSection = Math.max(1, Math.min(15, parseInt(getS('briefing_news_per_section')) || 3));
  const includeStocks = getS('briefing_include_stocks') === '1';
  const includeReminders = getS('briefing_include_reminders') !== '0';
  const weatherFormat = getS('briefing_weather_format') === 'hourly' ? 'hourly' : 'summary';

  // Reminders due today — same shared schedule logic every other reminder
  // surface in the app reads from (see reminderOccursOnDateServer() above),
  // so the email can never disagree with the Reminders widget or the
  // calendar-grid badges about what's due.
  let dueReminders = [];
  if (includeReminders) {
    try {
      const allReminders = db.prepare(`SELECT * FROM reminders WHERE active = 1`).all()
        .map(r => ({ ...r, schedule_config: JSON.parse(r.schedule_config) }));
      dueReminders = allReminders.filter(r => reminderOccursOnDateServer(r, today));
    } catch { dueReminders = []; }
  }

  // News — grouped by section (World / National / Local / each keyword), capped at
  // the user's chosen max per section. Uses the same sources configured for the
  // display (Settings → News), so the email mirrors what's on the wall.
  let newsSections = [];
  let newsError = null;
  if (includeNews) {
    try {
      const result = await getNews();
      const items = result.items || [];
      // Preserve the order sections first appear, then cap each.
      const order = [];
      const byGroup = {};
      for (const it of items) {
        const g = it.group || 'News';
        if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
        if (byGroup[g].length < perSection) byGroup[g].push(it);
      }
      newsSections = order.map(g => ({ label: g, items: byGroup[g] }));
    } catch (e) {
      newsError = e.message;
    }
  }

  // Weather
  let weather = null;
  let weatherError = null;
  const latRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lat'`).get();
  const lonRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lon'`).get();
  if (latRow?.value && lonRow?.value) {
    try {
      weather = await getWeatherResolved(latRow.value, lonRow.value);
    } catch (e) {
      weatherError = e.message;
    }
  }

  // Stocks (previous-day close) — optional.
  let stocks = null;
  if (includeStocks) {
    try { const r = await getStocks(getAllStockTickersFromLayouts()); stocks = r.quotes || null; } catch { stocks = null; }
  }

  return { today, events: allEvents, tasks, tasksError, taskScope,
           newsSections, newsError, includeNews, weather, weatherError, weatherFormat,
           stocks, includeStocks, dueReminders, includeReminders };
}

// Fetches news for a specific scope override used only by the email. Reuses the
// existing Google News RSS plumbing with a scope-appropriate query/label.
async function getNewsForScope(scope) {
  const NEWS_LOCALE = 'hl=en-US&gl=US&ceid=US:en';
  let url, label;
  if (scope === 'world') {
    url = `https://news.google.com/rss/headlines/section/topic/WORLD?${NEWS_LOCALE}`; label = 'World';
  } else if (scope === 'national') {
    url = `https://news.google.com/rss/headlines/section/topic/NATION?${NEWS_LOCALE}`; label = 'National';
  } else if (scope === 'local') {
    const loc = (db.prepare(`SELECT value FROM settings WHERE key='news_local_location'`).get()?.value || '').trim();
    if (!loc) return [];
    url = `https://news.google.com/rss/search?q=${encodeURIComponent(loc)}&${NEWS_LOCALE}`; label = loc;
  } else if (scope === 'keywords') {
    const kw = (db.prepare(`SELECT value FROM settings WHERE key='news_keywords'`).get()?.value || '').trim();
    if (!kw) return [];
    url = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&${NEWS_LOCALE}`; label = kw;
  } else {
    url = `https://news.google.com/rss?${NEWS_LOCALE}`; label = 'Top Stories';
  }
  const xml = await fetchUrl(url);
  return parseNewsRSS(xml).slice(0, 10).map(it => ({ ...it, group: label }));
}

function fmtBriefingTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

function renderBriefingHTML(content, displayName, recipientName) {
  const dateLabel = new Date(content.today + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  const greeting = greetingForTime() + (recipientName ? `, ${recipientName}` : '');

  const eventsHtml = content.events.length ? content.events.map(e => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2a3142;width:90px;color:#8b93a7;font-size:13px;vertical-align:top">
        ${e.end_date && e.end_date > e.date ? 'All day' : (e.start_time ? fmtBriefingTime(e.start_time) : 'All day')}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #2a3142;font-size:14px;color:#e8edf5">
        ${e.title}${e.feed_name ? `<span style="color:#8b93a7;font-size:12px"> · ${e.feed_name}</span>` : ''}
      </td>
    </tr>`).join('') : `<tr><td style="padding:8px 0;color:#8b93a7;font-size:13px">Nothing on the calendar today.</td></tr>`;

  // Only rendered as a section at all when something's actually due (see the
  // template below) — unlike Events/Tasks, absence is the COMMON case here
  // (trash day is maybe once or twice a week), so an empty-state row every
  // single day would just be daily clutter rather than useful information.
  // Icon needs its own handling here rather than reusing reminderIconHtml()
  // (display.html-only, browser-side) — an email has no relative-URL base to
  // resolve "/uploads/..." against, and this same function also backs the
  // browser-rendered preview endpoint, so build an absolute URL once and use
  // it for both rather than special-casing email vs. preview.
  const briefingBaseUrl = (() => {
    const addrs = getReachableAddresses();
    return `http://${addrs.tailscale || addrs.lan || 'localhost'}:${PORT}`;
  })();
  const remindersHtml = content.dueReminders.map(r => {
    const iconHtml = r.icon_type === 'image' && r.icon_image
      ? `<img src="${briefingBaseUrl}/uploads/${encodeURIComponent(r.icon_image)}" alt="" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;border-radius:2px">`
      : (r.icon || '📌');
    return `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #2a3142;font-size:14px;color:#e8edf5">
        ${iconHtml} ${r.name}
      </td>
    </tr>`;
  }).join('');

  const fmtTaskDue = (t) => {
    if (!t.due || !t.due.date) return '';
    if (t.due.date < content.today) return ' <span style="color:#f87171;font-size:12px">(overdue)</span>';
    if (t.due.date === content.today) return ' <span style="color:#8b93a7;font-size:12px">(today)</span>';
    // Future due date — show it (only relevant when scope is "all")
    const d = new Date(t.due.date + 'T00:00:00');
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return ` <span style="color:#8b93a7;font-size:12px">(due ${label})</span>`;
  };
  const noTasksMsg = content.taskScope === 'today' ? 'No tasks due today. 🎉' : 'No tasks. 🎉';
  const tasksHtml = content.tasksError
    ? `<p style="color:#8b93a7;font-size:13px">Tasks unavailable: ${content.tasksError}</p>`
    : (content.tasks.length ? content.tasks.map(t => `
        <tr>
          <td style="padding:6px 0;border-bottom:1px solid #2a3142;font-size:14px;color:#e8edf5">
            • ${t.content}${fmtTaskDue(t)}
          </td>
        </tr>`).join('') : `<tr><td style="padding:6px 0;color:#8b93a7;font-size:13px">${noTasksMsg}</td></tr>`);

  // News, grouped into sections (World / National / Local / each keyword), each with
  // a heading and capped at the user's per-section max.
  const newsSectionsHtml = content.newsError
    ? `<p style="color:#8b93a7;font-size:13px">News unavailable: ${content.newsError}</p>`
    : (content.newsSections || []).map(section => {
        const rows = section.items.map(n => {
          const titleHtml = n.link
            ? `<a href="${n.link}" style="color:#e8edf5;text-decoration:none" target="_blank" rel="noopener">${n.title}</a>`
            : n.title;
          const publisher = n.source ? `<br><span style="color:#8b93a7;font-size:11px;text-transform:uppercase">${n.source}</span>` : '';
          return `<tr><td style="padding:6px 0;border-bottom:1px solid #2a3142;font-size:13px;color:#e8edf5">${titleHtml}${publisher}</td></tr>`;
        }).join('');
        return `
          <p style="margin:14px 0 6px;color:#7c5cff;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">${section.label}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
      }).join('');

  // Stocks rows (previous-day close). getStocks() returns an array of indices/tickers.
  const stocksHtml = (content.stocks && content.stocks.length)
    ? content.stocks.map(s => {
        const up = (s.change ?? 0) >= 0;
        const arrow = up ? '▲' : '▼';
        const color = up ? '#34c759' : '#ff5d5d';
        const chg = s.changePct != null ? `${up?'+':''}${s.changePct.toFixed(2)}%` : '';
        const price = s.close != null ? Math.round(s.close * 100) / 100 : null;
        return `<tr>
          <td style="padding:5px 0;border-bottom:1px solid #2a3142;font-size:13px;color:#e8edf5">${s.label || s.symbol}</td>
          <td style="padding:5px 0;border-bottom:1px solid #2a3142;font-size:13px;color:#e8edf5;text-align:right">${price != null ? price.toLocaleString() : '—'}</td>
          <td style="padding:5px 0 5px 12px;border-bottom:1px solid #2a3142;font-size:13px;color:${color};text-align:right;white-space:nowrap">${arrow} ${chg}</td>
        </tr>`;
      }).join('')
    : `<tr><td style="padding:5px 0;color:#8b93a7;font-size:13px">Markets data unavailable</td></tr>`;

  // Robust weather for the email. 'summary' groups the day's hourly forecast into
  // morning (6-12), afternoon (12-18), and evening/night (18-24); 'hourly' shows a
  // compact every-3-hours strip. Falls back to the simple high/low if hourly data
  // isn't present.
  let weatherHtml = '';
  if (content.weather) {
    const cur = content.weather.current;
    const todayMax = content.weather.daily.temperature_2m_max[0];
    const todayMin = content.weather.daily.temperature_2m_min[0];
    const fmt = content.weatherFormat || 'summary';
    const hourly = content.weather.hourly;
    const headline = `<p style="font-size:28px;font-weight:300;color:#e8edf5;margin:0">${emailFormatTemp(cur.temperature_2m)}${emailTempUnitLabel()}</p>
      <p style="font-size:13px;color:#8b93a7;margin:4px 0 10px">High ${emailFormatTemp(todayMax)} · Low ${emailFormatTemp(todayMin)}</p>`;

    let detail = '';
    if (hourly && hourly.time && hourly.temperature_2m) {
      // Build index map for today's hours (the API returns hourly from 00:00 today).
      const temps = hourly.temperature_2m, codes = hourly.weather_code || [], pops = hourly.precipitation_probability || [];
      const desc = (c) => (WMO_DESC[c] || '');
      if (fmt === 'hourly') {
        const cells = [];
        for (let h = 6; h <= 21; h += 3) {
          if (temps[h] == null) continue;
          const hr = h % 12 || 12, ap = h < 12 ? 'AM' : 'PM';
          const pop = pops[h] != null ? ` · ${pops[h]}%` : '';
          cells.push(`<tr>
            <td style="padding:3px 10px 3px 0;color:#8b93a7;font-size:13px;white-space:nowrap">${hr} ${ap}</td>
            <td style="padding:3px 0;color:#e8edf5;font-size:13px">${emailFormatTemp(temps[h])} &nbsp;${desc(codes[h])}<span style="color:#8b93a7">${pop}</span></td>
          </tr>`);
        }
        detail = `<table style="border-collapse:collapse;margin-top:2px">${cells.join('')}</table>`;
      } else {
        // summary: average each block
        const block = (a, b, label) => {
          const t = [], c = [], p = [];
          for (let h = a; h < b; h++) { if (temps[h] != null) { t.push(temps[h]); c.push(codes[h]); if (pops[h]!=null) p.push(pops[h]); } }
          if (!t.length) return '';
          const avg = t.reduce((x,y)=>x+y,0)/t.length; // raw average — emailFormatTemp() does the only rounding, after unit conversion
          // pick the "worst"/most-notable code in the block (highest code ~ more significant)
          const code = c.sort((x,y)=>y-x)[0];
          const maxPop = p.length ? Math.max(...p) : null;
          const popTxt = (maxPop != null && maxPop >= 20) ? ` · ${maxPop}% precip` : '';
          return `<tr>
            <td style="padding:4px 12px 4px 0;color:#8b93a7;font-size:13px;white-space:nowrap">${label}</td>
            <td style="padding:4px 0;color:#e8edf5;font-size:13px">${emailFormatTemp(avg)} &nbsp;${desc(code)}<span style="color:#8b93a7">${popTxt}</span></td>
          </tr>`;
        };
        detail = `<table style="border-collapse:collapse;margin-top:2px">
          ${block(6,12,'Morning')}${block(12,18,'Afternoon')}${block(18,24,'Evening')}
        </table>`;
      }
    }
    weatherHtml = headline + detail;
  } else if (content.weatherError) {
    weatherHtml = `<p style="color:#8b93a7;font-size:13px">Weather unavailable</p>`;
  } else {
    weatherHtml = `<p style="color:#8b93a7;font-size:13px">No location configured</p>`;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1320;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1320;padding:24px 0">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b29;border-radius:16px;overflow:hidden;border:1px solid #2a3142">

        <tr><td style="padding:28px 28px 20px;border-bottom:1px solid #2a3142">
          <p style="margin:0;color:#8b93a7;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase">
            ${displayName || 'Daily Briefing'}
          </p>
          <h1 style="margin:6px 0 0;color:#e8edf5;font-size:22px;font-weight:600">${greeting} 👋</h1>
          <p style="margin:4px 0 0;color:#8b93a7;font-size:14px">${dateLabel}</p>
        </td></tr>

        <tr><td style="padding:20px 28px 4px">
          ${weatherHtml}
        </td></tr>

        <tr><td style="padding:20px 28px 8px">
          <p style="margin:0 0 8px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">📅 Today's Events</p>
          <table width="100%" cellpadding="0" cellspacing="0">${eventsHtml}</table>
        </td></tr>

        ${content.includeReminders && content.dueReminders.length ? `<tr><td style="padding:20px 28px 8px">
          <p style="margin:0 0 8px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">🗑️ Reminders</p>
          <table width="100%" cellpadding="0" cellspacing="0">${remindersHtml}</table>
        </td></tr>` : ''}

        <tr><td style="padding:20px 28px 8px">
          <p style="margin:0 0 8px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">✅ ${content.taskScope === 'today' ? 'Tasks Due Today' : 'Tasks'}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${tasksHtml}</table>
        </td></tr>

        ${content.includeStocks && content.stocks ? `<tr><td style="padding:20px 28px 8px">
          <p style="margin:0 0 8px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">📈 Markets (prev. close)</p>
          <table width="100%" cellpadding="0" cellspacing="0">${stocksHtml}</table>
        </td></tr>` : ''}

        ${content.includeNews ? `<tr><td style="padding:20px 28px 28px">
          <p style="margin:0 0 4px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">📰 News</p>
          ${newsSectionsHtml}
        </td></tr>` : ''}

        <tr><td style="padding:16px 28px;background:#0f1320">
          <p style="margin:0;color:#5a6178;font-size:11px;text-align:center">Sent by your Piazza HQ</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderBriefingText(content, recipientName) {
  const dateLabel = new Date(content.today + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  const greeting = greetingForTime() + (recipientName ? `, ${recipientName}` : '');
  const lines = [`${greeting}! Here's your briefing for ${dateLabel}.`, ''];

  if (content.weather) {
    const cur = content.weather.current;
    lines.push(`WEATHER: ${emailFormatTemp(cur.temperature_2m)}${emailTempUnitLabel()} (High ${emailFormatTemp(content.weather.daily.temperature_2m_max[0])} / Low ${emailFormatTemp(content.weather.daily.temperature_2m_min[0])})`, '');
  }

  lines.push('EVENTS TODAY:');
  if (content.events.length) {
    content.events.forEach(e => {
      const time = e.end_date && e.end_date > e.date ? 'All day' : (e.start_time ? fmtBriefingTime(e.start_time) : 'All day');
      lines.push(`  ${time} — ${e.title}`);
    });
  } else {
    lines.push('  Nothing scheduled.');
  }

  lines.push('', content.taskScope === 'today' ? 'TASKS DUE TODAY:' : 'TASKS:');
  if (content.tasks.length) {
    content.tasks.forEach(t => {
      let suffix = '';
      if (t.due && t.due.date) {
        if (t.due.date < content.today) suffix = ' (overdue)';
        else if (t.due.date === content.today) suffix = ' (today)';
        else {
          const d = new Date(t.due.date + 'T00:00:00');
          suffix = ' (due ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ')';
        }
      }
      lines.push(`  • ${t.content}${suffix}`);
    });
  } else {
    lines.push(content.taskScope === 'today' ? '  Nothing due today.' : '  No tasks.');
  }

  lines.push('', 'NEWS:');
  if (content.newsSections && content.newsSections.length) {
    content.newsSections.forEach(section => {
      lines.push(`  ${section.label.toUpperCase()}:`);
      section.items.forEach(n => {
        lines.push(`    • ${n.title}${n.source ? ' (' + n.source + ')' : ''}`);
        if (n.link) lines.push(`      ${n.link}`);
      });
    });
  } else {
    lines.push('  Unavailable.');
  }

  return lines.join('\n');
}

// Sends the briefing to all enabled recipients, each as a separate personalized
// email (not one email with multiple To: addresses) — keeps the greeting genuinely
// personal and means one bad address doesn't block delivery to everyone else.
// Returns a per-recipient result list so the caller (scheduler or "Send Now") can
// report partial failures instead of an all-or-nothing outcome.
async function sendBriefing() {
  const s = getEmailSettings();
  const recipients = getBriefingRecipients(true);

  if (!recipients.length) {
    throw new Error('No recipients yet — add at least one name and email address in Settings.');
  }
  if (!s.briefing_email_user || !s.briefing_email_pass) {
    throw new Error('Email sending isn\'t fully configured yet — fill in the sender account and app password in Settings.');
  }

  const content = await assembleBriefingContent(); // same content for everyone (for now)
  const transporter = buildMailTransporter(s);
  const dateLabel = new Date(content.today + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const results = [];
  for (const r of recipients) {
    try {
      await transporter.sendMail({
        from: `"${s.display_name || 'Daily Briefing'}" <${s.briefing_email_user}>`,
        to: r.email,
        subject: `Your Daily Briefing — ${dateLabel}`,
        text: renderBriefingText(content, r.name),
        html: renderBriefingHTML(content, s.display_name, r.name),
      });
      results.push({ email: r.email, ok: true });
    } catch (e) {
      results.push({ email: r.email, ok: false, error: friendlyMailError(e) });
    }
  }

  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('briefing_last_sent', ?)`).run(content.today);
  return results;
}

// Checks once a minute whether it's time to send today's briefing. A minute-granularity
// poll (rather than computing a precise setTimeout delay) keeps this simple and immune
// to clock changes, DST, or the server being restarted mid-day.
function checkBriefingSchedule() {
  if (IS_DEMO) return;
  // A slave must never send the daily email — the host already does. Otherwise the
  // family gets duplicate briefings. The slave mirrors briefing SETTINGS via sync,
  // but only the host actually sends.
  if (isSlave()) return;
  const s = getEmailSettings();
  if (s.briefing_enabled !== '1') return;
  // Only the host sends the briefing. Slaves must never run it, or they'd race the
  // host and (via the shared last-sent flag) suppress the real send. This guard is
  // what was missing — adding a second device silently stopped scheduled briefings.
  if (isSlave()) return;

  const nowHHMM = localHHMM();
  const today = localDateStr();

  if (nowHHMM === (s.briefing_time || '07:00') && s.briefing_last_sent !== today) {
    sendBriefing()
      .then(results => {
        const okCount = results.filter(r => r.ok).length;
        console.log(`Daily briefing sent to ${okCount}/${results.length} recipients`);
      })
      .catch(e => console.error('Daily briefing failed to send:', e.message));
  }
}
setInterval(checkBriefingSchedule, 60 * 1000);
setInterval(checkTvSchedules, 60 * 1000);

// Sends a digest of unsent feedback to the product owner, then marks those rows
// sent. Returns the count sent (0 if nothing to send). Reuses the briefing email
// account for delivery.
// The feedback digest always goes to the developer (you), regardless of who is
// running the app — they're submitting bug reports/ideas that only you can act on.
// Hardcoded on purpose so end users can't redirect feedback to themselves.
const FEEDBACK_RECIPIENT = 'jlauty@gmail.com';

async function sendFeedbackDigest() {
  const keys = ['feedback_enabled','briefing_provider',
                'briefing_email_user','briefing_email_pass'];
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(()=>'?').join(',')})`).all(...keys);
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (s.feedback_enabled !== '1') return 0;

  const pending = db.prepare(`SELECT * FROM feedback WHERE sent = 0 ORDER BY created_at ASC`).all();
  if (!pending.length) return 0; // nothing to send → no email

  const transporter = buildMailTransporter({
    briefing_provider: s.briefing_provider,
    briefing_email_user: s.briefing_email_user,
    briefing_email_pass: s.briefing_email_pass,
  });

  const esc = (t) => String(t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const KIND_LABEL = { bug:'🐞 Bug', feature:'💡 Feature idea', feedback:'💬 Feedback' };
  const attachments = [];
  const items = pending.map(f => {
    let imgHtml = '';
    if (f.image) {
      const imgPath = path.join(UPLOAD_DIR, f.image);
      if (fs.existsSync(imgPath)) {
        const cid = 'fbimg' + f.id;
        attachments.push({ filename: f.image, path: imgPath, cid });
        imgHtml = `<div style="margin-top:10px"><img src="cid:${cid}" alt="attachment" style="max-width:100%;border-radius:8px;border:1px solid #e3e3e3"></div>`;
      }
    }
    return `
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="font-size:13px;color:#666;margin-bottom:6px">
        ${KIND_LABEL[f.kind] || '💬 Feedback'} · ${esc(f.created_at)} UTC${f.device_name ? ' · ' + esc(f.device_name) : ''}${f.app_version ? ' · v' + esc(f.app_version) : ''}
      </div>
      <div style="font-size:15px;color:#111;white-space:pre-wrap">${esc(f.message)}</div>
      ${imgHtml}
    </div>`;
  }).join('');
  const counts = pending.reduce((a,f)=>{a[f.kind]=(a[f.kind]||0)+1;return a;},{});
  const summary = Object.entries(counts).map(([k,n]) => `${n} ${k}${n>1?'s':''}`).join(' · ');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto">
    <h2 style="font-size:19px;color:#111">Piazza HQ — feedback digest</h2>
    <p style="color:#555;font-size:14px">${pending.length} new submission${pending.length>1?'s':''} · ${summary}</p>
    ${items}
  </div>`;

  await transporter.sendMail({
    from: s.briefing_email_user,
    to: FEEDBACK_RECIPIENT,
    subject: `Piazza HQ feedback — ${pending.length} new (${summary})`,
    html,
    attachments,
  });

  // Mark them sent so they aren't reported again.
  const ids = pending.map(f => f.id);
  db.prepare(`UPDATE feedback SET sent = 1 WHERE id IN (${ids.map(()=>'?').join(',')})`).run(...ids);
  return pending.length;
}

// Once-a-minute check, mirroring the briefing scheduler. Sends at feedback_time,
// at most once per day, and only when there's something to report.
function checkFeedbackSchedule() {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN ('feedback_enabled','feedback_time','feedback_last_sent')`).all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (s.feedback_enabled !== '1') return;
  const nowHHMM = localHHMM();
  const today = localDateStr();
  if (nowHHMM === (s.feedback_time || '08:00') && s.feedback_last_sent !== today) {
    // Record the attempt date regardless, so we don't retry every minute for an hour.
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('feedback_last_sent', ?)`).run(today);
    sendFeedbackDigest()
      .then(n => { if (n) console.log(`Feedback digest sent (${n} item(s))`); })
      .catch(e => console.error('Feedback digest failed:', e.message));
  }
}
// The feedback-digest email was replaced by one-at-a-time feedback (forwarded to the
// central server in real time) and its settings UI was hidden. This scheduler is now
// dormant on purpose: it also lacked a host-only guard and used a SHARED last-sent
// flag, the same bug that broke the daily briefing on a multi-device setup — so rather
// than patch code slated for removal, it's disabled outright. See "strip dead code"
// in project notes for cleanup once everything's proven.
// setInterval(checkFeedbackSchedule, 60 * 1000);

// PUT /api/briefing-settings — separate from /api/settings so the email password
// field doesn't get echoed back in every generic settings GET response.
app.put('/api/briefing-settings', (req, res) => {
  const allowed = ['briefing_enabled', 'briefing_time', 'briefing_provider',
                    'briefing_email_user', 'briefing_email_pass', 'briefing_todoist_project_ids',
                    'briefing_task_scope', 'briefing_weather_format', 'briefing_include_news',
                    'briefing_news_per_section', 'briefing_include_stocks', 'briefing_include_reminders'];
  const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  const tx = db.transaction(() => {
    for (const key of allowed) {
      if (req.body[key] !== undefined) upsert.run(key, String(req.body[key]));
    }
  });
  tx();
  res.json({ ok: true });
});

// GET /api/briefing-settings — password is masked, never sent back in full
app.get('/api/briefing-settings', (req, res) => {
  const s = getEmailSettings();
  res.json({
    briefing_enabled: s.briefing_enabled || '0',
    briefing_time: s.briefing_time || '07:00',
    briefing_provider: s.briefing_provider || 'gmail',
    briefing_email_user: s.briefing_email_user || '',
    briefing_email_pass_set: !!s.briefing_email_pass, // tells the UI a password exists, without exposing it
    briefing_last_sent: s.briefing_last_sent || '',
    briefing_todoist_project_ids: s.briefing_todoist_project_ids || '',
    briefing_task_scope: s.briefing_task_scope || 'all',
    briefing_weather_format: s.briefing_weather_format || 'summary',
    briefing_include_news: s.briefing_include_news || '1',
    briefing_news_per_section: s.briefing_news_per_section || '3',
    briefing_include_stocks: s.briefing_include_stocks || '0',
    briefing_include_reminders: s.briefing_include_reminders || '1',
  });
});

// ── iCloud CalDAV push settings ─────────────────────────────────────────────
// Same split as briefing-settings above (separate from /api/settings so the
// app-specific password never rides along in a generic settings GET).

// Tests UNSAVED credentials and returns the account's calendars for the
// picker. POST, not GET-with-query, specifically so a real Apple ID password
// doesn't end up in an access log or proxy the way a query string would.
app.post('/api/caldav/discover', async (req, res) => {
  const username = (req.body && req.body.username || '').trim();
  let password = (req.body && req.body.app_password || '').trim();
  // Blank password + already-saved one => test the saved credential (lets the
  // user re-run discovery to change calendars without re-typing the password).
  if (!password) password = getSetting('icloud_app_password') || '';
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Apple ID and app-specific password are both required.' });
  try {
    const calendars = await discoverCalDAVCalendars(username, password);
    res.json({ ok: true, calendars });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.put('/api/caldav-settings', (req, res) => {
  const allowed = ['icloud_push_enabled', 'icloud_username', 'icloud_calendar_url', 'icloud_calendar_name'];
  const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  const tx = db.transaction(() => {
    for (const key of allowed) {
      if (req.body[key] !== undefined) upsert.run(key, String(req.body[key]));
    }
    // Password only overwrites when the user actually typed a new one — blank means "keep existing".
    const newPass = (req.body.icloud_app_password || '').trim();
    if (newPass) upsert.run('icloud_app_password', newPass);
    // Full discovered calendar list, for the per-event picker on the widget.
    if (Array.isArray(req.body.icloud_calendars)) {
      const clean = req.body.icloud_calendars
        .filter(c => c && c.url && c.name)
        .map(c => ({ url: String(c.url), name: String(c.name) }));
      upsert.run('icloud_calendars_json', JSON.stringify(clean));
    }
  });
  tx();
  res.json({ ok: true });
});

function getIcloudCalendars() {
  try { const a = JSON.parse(getSetting('icloud_calendars_json') || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}

app.get('/api/caldav-settings', (req, res) => {
  res.json({
    icloud_push_enabled: getSetting('icloud_push_enabled') || '0',
    icloud_username: getSetting('icloud_username') || '',
    icloud_app_password_set: !!getSetting('icloud_app_password'),
    icloud_calendar_url: getSetting('icloud_calendar_url') || '',
    icloud_calendar_name: getSetting('icloud_calendar_name') || '',
    icloud_calendars: getIcloudCalendars(),
  });
});

// The list of places a new event can be sent, for the calendar widget's
// "Add to" picker. Only includes a target if it's actually usable right now.
// `id` is what gets stored on the event as `target_calendar`.
app.get('/api/event-targets', (req, res) => {
  const targets = [{ id: 'local', label: 'This device only' }];
  let dflt = 'local';
  const cd = getCaldavConfig();
  if (cd.enabled && cd.username && cd.password) {
    const list = getIcloudCalendars();
    const entries = list.length ? list : (cd.calendarUrl ? [{ url: cd.calendarUrl, name: getSetting('icloud_calendar_name') || 'iCloud' }] : []);
    for (const c of entries) targets.push({ id: `caldav:${c.url}`, label: `${c.name} (iCloud)` });
    if (cd.calendarUrl) dflt = `caldav:${cd.calendarUrl}`;
    else if (entries.length) dflt = `caldav:${entries[0].url}`;
  }
  const g = getGoogleConfig();
  if (g.enabled && g.refreshToken && g.calendarId && googleClientConfigured()) {
    const gname = getSetting('google_calendar_name') || getSetting('google_account_email') || 'Google';
    targets.push({ id: 'google', label: `${gname} (Google)` });
    if (dflt === 'local') dflt = 'google';
  }
  res.json({ targets, default: dflt });
});

// ── Handwriting-to-text (optional, for the display's add-event sheet) ───────
// MyScript keys are UUIDs. Pull the UUID out of whatever was pasted rather
// than storing it verbatim — a stray "* " bullet or quotes from a copy/paste
// otherwise sails through and MyScript just 401s with no hint why (seen live).
function cleanMyScriptKey(v) {
  const s = String(v == null ? '' : v);
  const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : s.trim();
}
app.put('/api/handwriting-settings', (req, res) => {
  const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  const tx = db.transaction(() => {
    if (req.body.handwriting_enabled !== undefined) upsert.run('handwriting_enabled', String(req.body.handwriting_enabled));
    if (req.body.myscript_app_key !== undefined) upsert.run('myscript_app_key', cleanMyScriptKey(req.body.myscript_app_key));
    // HMAC key only overwrites when a new one is actually typed — blank = keep.
    const newHmac = cleanMyScriptKey(req.body.myscript_hmac_key);
    if (newHmac) upsert.run('myscript_hmac_key', newHmac);
  });
  tx();
  res.json({ ok: true });
});

app.get('/api/handwriting-settings', (req, res) => {
  res.json({
    handwriting_enabled: getSetting('handwriting_enabled') || '0',
    myscript_app_key: getSetting('myscript_app_key') || '',
    myscript_hmac_key_set: !!getSetting('myscript_hmac_key'),
    // What the display actually needs to decide whether to show the ✍️ button.
    handwriting_ready: (getSetting('handwriting_enabled') === '1') && !!getSetting('myscript_app_key'),
  });
});

// Recognize a set of pen strokes. The browser sends raw strokes; the HMAC
// signing (a shared secret) happens here so that secret never ships to a
// display. Best-effort: any failure returns a clean error and the sheet just
// keeps the typed field.
app.post('/api/handwriting/recognize', async (req, res) => {
  try {
    if (getSetting('handwriting_enabled') !== '1') return res.status(400).json({ error: 'Handwriting input is turned off.' });
    const appKey = getSetting('myscript_app_key');
    const hmacKey = getSetting('myscript_hmac_key');
    if (!appKey || !hmacKey) return res.status(400).json({ error: 'MyScript keys are not configured.' });
    const strokes = Array.isArray(req.body && req.body.strokes) ? req.body.strokes : null;
    if (!strokes || !strokes.length) return res.status(400).json({ error: 'No strokes provided.' });
    // strokes: [ [ {x,y,t}, ... ], ... ]  ->  MyScript v4 batch shape
    const payload = {
      configuration: { lang: (req.body && req.body.lang) || 'en_US' },
      contentType: 'Text',
      strokeGroups: [{
        strokes: strokes.map(s => ({
          x: s.map(p => p.x), y: s.map(p => p.y), t: s.map(p => p.t),
          pointerType: 'PEN',
        })),
      }],
    };
    const body = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha512', appKey + hmacKey).update(body).digest('hex');
    // Accept MUST be a format MyScript actually produces — JIIX is its
    // structured JSON result (has `label` + `words[]`). Asking for plain
    // application/json gets a 406 "no suitable mime type".
    const r = await httpsRequest('https://cloud.myscript.com/api/v4.0/iink/batch', 'POST', {
      body,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/vnd.myscript.jiix', 'applicationKey': appKey, 'hmac': hmac },
    });
    if (r.statusCode !== 200) {
      console.error('MyScript recognize failed', r.statusCode, String(r.body).slice(0, 300));
      let detail = '';
      try { const e = JSON.parse(r.body || '{}'); detail = e.code || e.message || ''; } catch {}
      return res.status(502).json({ error: detail ? `MyScript: ${detail}` : 'Recognition service error.' });
    }
    let text = '';
    try { const j = JSON.parse(r.body || '{}'); text = j.label || (j.words || []).map(w => w.label).join(' '); } catch {}
    res.json({ text: (text || '').trim() });
  } catch (e) {
    console.error('handwriting recognize error', e && e.message);
    res.status(500).json({ error: 'Could not recognize handwriting.' });
  }
});

// ── Google Calendar push settings + OAuth device flow ───────────────────────
app.get('/api/google-settings', (req, res) => {
  res.json({
    google_push_enabled: getSetting('google_push_enabled') || '0',
    google_connected: !!getSetting('google_refresh_token'),
    google_client_configured: googleClientConfigured(),
    google_account_email: getSetting('google_account_email') || '',
    google_calendar_id: getSetting('google_calendar_id') || '',
    google_calendar_name: getSetting('google_calendar_name') || '',
  });
});

// Non-secret fields + optional client id/secret entry (for when they're not
// coming from env). Tokens are NEVER set through here — only the device flow
// writes them. push_enabled:'0' with disconnect:true fully unlinks the account.
app.put('/api/google-settings', (req, res) => {
  if (req.body.disconnect === true) { setGoogleDisconnected(); return res.json({ ok: true }); }
  const plain = ['google_push_enabled', 'google_calendar_id', 'google_calendar_name',
                 'google_oauth_client_id', 'google_oauth_client_secret'];
  const tx = db.transaction(() => {
    for (const key of plain) {
      if (req.body[key] !== undefined) setSetting(key, String(req.body[key]));
    }
  });
  tx();
  res.json({ ok: true });
});

// ── Google connect: authorization-code flow relayed through the mothership ──
// Google's device flow doesn't allow Calendar scopes, and this device has no
// stable public URL to be a redirect target. So: the consent redirect goes to
// https://piazzahq.com/oauth/google/callback, which just stashes the auth
// `code` keyed by an opaque `state`; this device polls for it and then
// exchanges the code for tokens DIRECTLY with Google, here, using the client
// secret + a PKCE verifier that never leave this box. The mothership only
// ever holds a short-lived single-use code, useless without those.
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const googleConnectPending = new Map(); // state -> { verifier, ts }
function googleRedirectUri() { return resolveUpdateServerUrl() + '/oauth/google/callback'; }

// Step 1: hand the UI a Google consent URL to open on a phone.
app.post('/api/google/connect-start', (req, res) => {
  const cfg = getGoogleConfig();
  if (!cfg.clientId) return res.status(400).json({ error: 'Google OAuth client ID is not configured.' });
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(64).toString('base64url'); // 86 chars, within the 43-128 PKCE range
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  // Prune anything stale, then remember this attempt's verifier.
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of googleConnectPending) if (v.ts < cutoff) googleConnectPending.delete(k);
  googleConnectPending.set(state, { verifier, ts: Date.now() });
  const authUrl = GOOGLE_AUTH_URL + '?' + formEncode({
    client_id: cfg.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  res.json({ auth_url: authUrl, state });
});

// Step 2: the UI polls this. It asks the mothership relay whether the callback
// has landed for this `state`; once it has, exchanges the code for tokens and
// returns the account's calendars for the picker.
app.post('/api/google/connect-poll', async (req, res) => {
  const cfg = getGoogleConfig();
  const state = (req.body && req.body.state || '').trim();
  if (!cfg.clientId || !cfg.clientSecret) return res.status(400).json({ status: 'error', error: 'Google OAuth client is not configured.' });
  const pending = googleConnectPending.get(state);
  if (!pending) return res.json({ status: 'error', error: 'This connection attempt expired — start again.' });
  try {
    const relayUrl = resolveUpdateServerUrl() + '/api/oauth/google/relay/' + encodeURIComponent(state);
    const rr = await httpsRequest(relayUrl, 'GET', {});
    const relay = JSON.parse(rr.body || '{}');
    if (relay.status === 'pending') return res.json({ status: 'pending' });
    if (relay.status === 'denied') { googleConnectPending.delete(state); return res.json({ status: 'denied' }); }
    if (relay.status !== 'ready' || !relay.code) { googleConnectPending.delete(state); return res.json({ status: 'error', error: relay.error || 'No authorization code came back.' }); }
    googleConnectPending.delete(state);
    // Exchange the code with Google directly.
    const tr = await httpsRequest(GOOGLE_TOKEN_URL, 'POST', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code: relay.code,
        code_verifier: pending.verifier,
        grant_type: 'authorization_code',
        redirect_uri: googleRedirectUri(),
      }),
    });
    const data = JSON.parse(tr.body || '{}');
    if (tr.statusCode !== 200 || !data.refresh_token) {
      return res.json({ status: 'error', error: data.error_description || data.error || `token exchange HTTP ${tr.statusCode}` });
    }
    setSetting('google_refresh_token', data.refresh_token);
    setSetting('google_access_token', data.access_token || '');
    setSetting('google_access_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
    const email = await googleGetAccountEmail(data.access_token);
    if (email) setSetting('google_account_email', email);
    // Default the target to the primary calendar unless one was already set.
    if (!getSetting('google_calendar_id')) {
      setSetting('google_calendar_id', 'primary');
      setSetting('google_calendar_name', email ? `${email} (primary)` : 'Primary calendar');
    }
    res.json({ status: 'connected', email });
  } catch (e) {
    res.status(502).json({ status: 'error', error: e.message });
  }
});

// ── Briefing recipients (name + email, one row per person) ───────────────────
app.get('/api/briefing-recipients', (req, res) => {
  res.json(getBriefingRecipients(false));
});

app.post('/api/briefing-recipients', (req, res) => {
  const { name, email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email address is required' });
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM briefing_recipients`).get().m || 0;
  const result = db.prepare(
    `INSERT INTO briefing_recipients (name, email, enabled, sort_order) VALUES (?, ?, 1, ?)`
  ).run((name || '').trim(), email.trim(), maxOrder + 1);
  res.status(201).json(db.prepare(`SELECT * FROM briefing_recipients WHERE id = ?`).get(result.lastInsertRowid));
});

app.put('/api/briefing-recipients/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM briefing_recipients WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Recipient not found' });
  const { name, email, enabled } = req.body;
  db.prepare(`UPDATE briefing_recipients SET name=?, email=?, enabled=? WHERE id=?`).run(
    name !== undefined ? name.trim() : existing.name,
    email !== undefined ? email.trim() : existing.email,
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    req.params.id
  );
  res.json(db.prepare(`SELECT * FROM briefing_recipients WHERE id = ?`).get(req.params.id));
});

app.delete('/api/briefing-recipients/:id', (req, res) => {
  const result = db.prepare(`DELETE FROM briefing_recipients WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Recipient not found' });
  res.json({ ok: true });
});

// GET /api/briefing-settings/preview — renders the HTML without sending, for in-app preview.
// Uses the first enabled recipient's name if available, otherwise a placeholder, so the
// preview reflects real personalization without requiring a recipient to already exist.
app.get('/api/briefing-settings/preview', async (req, res) => {
  try {
    const content = await assembleBriefingContent();
    const s = getEmailSettings();
    const recipients = getBriefingRecipients(true);
    const previewName = req.query.name || (recipients[0] && recipients[0].name) || 'there';
    const html = renderBriefingHTML(content, s.display_name, previewName);
    res.send(html);
  } catch (e) {
    res.status(500).send(`<p style="font-family:sans-serif;color:#c00;padding:20px">Preview failed: ${e.message}</p>`);
  }
});

// POST /api/briefing-settings/test — sends a real email to ONE address for setup verification,
// without affecting briefing_last_sent or touching the full recipient list.
app.post('/api/briefing-settings/test', async (req, res) => {
  const testEmail = req.body.email;
  if (!testEmail || !testEmail.includes('@')) return res.status(400).json({ error: 'Enter a valid email to send the test to' });
  try {
    const s = getEmailSettings();
    if (!s.briefing_email_user || !s.briefing_email_pass) {
      throw new Error('Fill in the sender account and app password first.');
    }
    const content = await assembleBriefingContent();
    const transporter = buildMailTransporter(s);
    const dateLabel = new Date(content.today + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    await transporter.sendMail({
      from: `"${s.display_name || 'Daily Briefing'}" <${s.briefing_email_user}>`,
      to: testEmail,
      subject: `[Test] Your Daily Briefing — ${dateLabel}`,
      text: renderBriefingText(content, req.body.name || 'there'),
      html: renderBriefingHTML(content, s.display_name, req.body.name || 'there'),
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: friendlyMailError(e) });
  }
});

// POST /api/briefing-settings/send-now — sends the real briefing to every enabled
// recipient immediately, outside the schedule. Returns per-recipient results.
app.post('/api/briefing-settings/send-now', async (req, res) => {
  try {
    const results = await sendBriefing();
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
  if (!IS_WIN) { process.exit(0); return; }
  try { if (httpServer) httpServer.close(); } catch {}
  setTimeout(() => {
    try { spawnDetachedSelf().unref(); } catch (e) { console.error('Relaunch failed — ' + e.message); }
    process.exit(0);
  }, 800);
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
    if (_haHealth) u.searchParams.set('ha', _haHealth.ok ? '1' : '0');   // omitted = never talked to HA
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
function registerTrialLicense(email) {
  return new Promise((resolve, reject) => {
    const serverUrl = resolveUpdateServerUrl();
    if (!serverUrl) return reject(new Error('No update server configured.'));
    const u = new URL(serverUrl + '/api/trial/signup');
    const mod = u.protocol === 'https:' ? https : http;
    const deviceId = updateSetting('screen_device_id_cache', '') || '';
    const body = JSON.stringify({ email, deviceId });
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
    const result = await registerTrialLicense(email);
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
function sendCorePage(res, filePath) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(filePath);
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
app.get('/', demoLeaseGate, (req, res) => sendCorePage(res, path.join(__dirname, 'public', 'display.html')));
app.get('/app', demoLeaseGate, (req, res) => sendCorePage(res, path.join(__dirname, 'public', 'app.html')));
app.get(['/kids', '/chores'], demoLeaseGate, (req, res) => sendCorePage(res, path.join(__dirname, 'public', 'kids.html')));
app.get('/hub', demoLeaseGate, (req, res) => sendCorePage(res, path.join(__dirname, 'public', 'hub.html')));

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
  process.on(sig, () => { try { stopCameraService('shutdown'); } catch {} process.exit(0); });
}
process.on('exit', () => { if (_go2rtc) { try { _go2rtc.kill(); } catch {} } });

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
