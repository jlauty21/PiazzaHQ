'use strict';
// Feeds server.js a DATA_DIR whose calendar.db has an OLD-shape `screens`
// table (only the columns that existed several versions back) plus a row,
// then boots. Every `if (!columnExists('screens', X)) ALTER TABLE ... ADD X`
// migration must run without error, the pre-existing row's data must
// survive, and the newly-added columns must read back at their defaults.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bootServer, api } = require('../lib/boot-server');
const { check, eq, ok, report } = require('../lib/tap');

let Database;
try { Database = require('better-sqlite3'); }
catch { console.error('better-sqlite3 not available — run this via the api layer (test/run.sh api)'); process.exit(1); }

function makeLegacyDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phq-legacy-'));
  const file = path.join(dir, 'calendar.db');
  const db = new Database(file);
  // Deliberately minimal — a known subset of what `screens` looked like long
  // before alert_banner_*, floating_switcher_*, ambient_*, tv_*, fx_* etc.
  db.exec(`
    CREATE TABLE screens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE,
      name TEXT DEFAULT '',
      assigned_display_slug TEXT DEFAULT '',
      last_seen INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.prepare(`INSERT INTO screens (device_id, name, assigned_display_slug, last_seen) VALUES (?, ?, ?, ?)`)
    .run('legacy-screen-1', 'Kitchen TV', '', Date.now());
  db.close();
  return { file, dir };
}

(async () => {
  const legacy = makeLegacyDb();
  const srv = await bootServer({ seedDbPath: legacy.file });

  try {
    await check('server boots against the legacy DB — all screens migrations ran', () => {
      ok(/Piazza HQ running at/.test(srv.output()), srv.output());
    });

    await check('the pre-existing screen row survived the migration', async () => {
      const r = await api(srv.base, 'GET', '/api/screens');
      eq(r.status, 200);
      const row = r.json.find(s => s.device_id === 'legacy-screen-1');
      ok(row, 'legacy-screen-1 still present');
      eq(row.name, 'Kitchen TV');
    });

    await check('columns added by later migrations now read at their defaults', async () => {
      const r = await api(srv.base, 'GET', '/api/screens');
      const row = r.json.find(s => s.device_id === 'legacy-screen-1');
      eq(row.alert_banner_position, 'top');
      eq(row.alert_banner_size, 'm');
      eq(row.alert_banner_style, 'solid');
      eq(row.floating_switcher_reveal, 'always');
    });

    await check('/api/screen-config for the migrated screen returns the new fields', async () => {
      const r = await api(srv.base, 'GET', '/api/screen-config?screen=legacy-screen-1');
      eq(r.status, 200);
      eq(r.json.alert_banner_position, 'top');
      eq(r.json.alert_banner_style, 'solid');
    });
  } finally {
    await srv.stop();
    try { fs.rmSync(legacy.dir, { recursive: true, force: true }); } catch {}
  }

  report();
})();
