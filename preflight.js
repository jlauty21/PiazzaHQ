#!/usr/bin/env node
// Pre-build sanity check. Run before cutting any build (beta or stable):
//
//   npm run preflight
//
// Catches the mistakes that otherwise only surface after a zip is already
// published: a version bumped in one file but not the others, and the
// windows/build-input/app mirror drifting out of sync with the real source
// (a server.js / public/*.html change that wasn't copied across).
//
// Exits non-zero on any failure so it can gate a script. `--fix` copies the
// mirror files from source instead of just reporting the drift.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const MIRROR = path.join('windows', 'build-input', 'app');
const FIX = process.argv.includes('--fix');

// Files that must be byte-identical between the repo root and the build
// mirror. Matches what publish-beta.sh checks, plus templates.js /
// tv-control.js (both shipped in the flat zip and bundled by the installer).
const MIRRORED = [
  'server.js',
  'templates.js',
  'tv-control.js',
  path.join('public', 'app.html'),
  path.join('public', 'display.html'),
  path.join('public', 'kids.html'),
  path.join('public', 'hub.html'),
];

let failures = 0;
let fixed = 0;
const fail = (msg) => { console.error('  ✗ ' + msg); failures++; };
const ok = (msg) => console.log('  ✓ ' + msg);

// ── 1. Versions agree across all three declaration sites ───────────────────
console.log('Version consistency');
const rootPkg = require(path.join(ROOT, 'package.json'));
const mirrorPkgPath = path.join(ROOT, MIRROR, 'package.json');
const mirrorPkg = JSON.parse(fs.readFileSync(mirrorPkgPath, 'utf8'));
const issPath = path.join(ROOT, 'windows', 'piazzahq.iss');
const iss = fs.readFileSync(issPath, 'utf8');
const issMatch = iss.match(/#define\s+MyAppVersion\s+"([^"]+)"/);
const issVer = issMatch ? issMatch[1] : null;

const V = rootPkg.version;
if (!V) fail('root package.json has no version');
else ok(`root package.json: ${V}`);

if (mirrorPkg.version === V) ok(`${MIRROR}/package.json: ${mirrorPkg.version}`);
else fail(`${MIRROR}/package.json is ${mirrorPkg.version}, expected ${V}`);

if (!issVer) fail('windows/piazzahq.iss: no #define MyAppVersion found');
else if (issVer === V) ok(`windows/piazzahq.iss MyAppVersion: ${issVer}`);
else fail(`windows/piazzahq.iss MyAppVersion is ${issVer}, expected ${V}`);

// ── 2. Build mirror is in sync with source ────────────────────────────────
console.log('Build mirror sync (' + MIRROR + ')');
for (const rel of MIRRORED) {
  const src = path.join(ROOT, rel);
  const mir = path.join(ROOT, MIRROR, rel);
  if (!fs.existsSync(src)) { fail(`source missing: ${rel}`); continue; }
  if (!fs.existsSync(mir)) {
    if (FIX) { fs.mkdirSync(path.dirname(mir), { recursive: true }); fs.copyFileSync(src, mir); fixed++; ok(`${rel} — created in mirror`); }
    else fail(`mirror missing: ${MIRROR}/${rel}`);
    continue;
  }
  const same = Buffer.compare(fs.readFileSync(src), fs.readFileSync(mir)) === 0;
  if (same) { ok(`${rel}`); continue; }
  if (FIX) { fs.copyFileSync(src, mir); fixed++; ok(`${rel} — synced from source`); }
  else fail(`${rel} differs from ${MIRROR}/${rel} (run: npm run preflight -- --fix)`);
}

// ── 3. server.js parses ──────────────────────────────────────────────────
console.log('Syntax');
for (const f of ['server.js', 'templates.js', 'tv-control.js']) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); ok(`${f} parses`); }
  catch (e) { fail(`${f}: ${String(e.stderr || e.message).trim().split('\n')[0]}`); }
}

// ── verdict ──────────────────────────────────────────────────────────────
console.log('');
if (fixed) console.log(`${fixed} mirror file(s) synced.`);
if (failures) { console.error(`preflight: ${failures} problem(s) — fix before building.`); process.exit(1); }
console.log(`preflight: all clear (v${V}).`);
