'use strict';
// In-container dispatcher.
//
//   node test/run-tests.js unit
//   node test/run-tests.js unit api
//   node test/run-tests.js all        (default: unit + api + ui)
//
// unit / api: each `*.test.js` under test/<layer>/ runs in its own Node
// process (one crash doesn't take the rest down). The legacy
// rotation-smoke-test.js runs as part of `unit`.
// ui: Playwright's own runner over test/ui/*.spec.js.
const { readdirSync, readFileSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const HERE = __dirname;
const REPO = path.join(HERE, '..');
const ALL = ['unit', 'api', 'ui'];

let layers = process.argv.slice(2).filter(Boolean);
if (!layers.length || layers.includes('all')) layers = ALL.slice();
for (const l of layers) {
  if (!ALL.includes(l)) { console.error(`unknown layer: ${l} (use ${ALL.join(' | ')} | all)`); process.exit(2); }
}

function haveModule(name) {
  try { require.resolve(name, { paths: [REPO] }); return true; } catch { return false; }
}
function npmInstall(args, label) {
  console.log(`Installing ${label} into the container (one time)…\n`);
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', ...args], { cwd: REPO, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\nnpm install failed — cannot run without ${label}.`); process.exit(1); }
}

// The api layer boots the real server.js (needs express, better-sqlite3, …).
if (layers.includes('api') && !haveModule('express')) {
  npmInstall(['--omit=dev'], 'app runtime deps');
}
// The ui layer needs Playwright's test runner. Pin to test/package.json's
// version, which MUST match the Dockerfile's playwright image tag so it uses
// the browsers already in the image.
if (layers.includes('ui') && !haveModule('@playwright/test')) {
  const pw = JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8')).devDependencies['@playwright/test'];
  npmInstall(['--no-save', '--prefix', REPO, `@playwright/test@${pw}`], `@playwright/test@${pw}`);
}

let failed = 0;

// unit + api: plain-node test files.
const nodeFiles = [];
if (layers.includes('unit')) nodeFiles.push(path.join(HERE, 'rotation-smoke-test.js'));
for (const l of layers) {
  if (l === 'ui') continue;
  let entries = [];
  try { entries = readdirSync(path.join(HERE, l)); } catch { /* dir may not exist yet */ }
  for (const e of entries.sort()) if (e.endsWith('.test.js')) nodeFiles.push(path.join(HERE, l, e));
}
for (const f of nodeFiles) {
  console.log(`\n──▶ ${path.relative(REPO, f).replace(/\\/g, '/')}`);
  const r = spawnSync(process.execPath, [f], { stdio: 'inherit', cwd: REPO });
  if (r.status !== 0) failed++;
}

// ui: Playwright runner.
if (layers.includes('ui')) {
  console.log('\n──▶ test/ui (Playwright)');
  const r = spawnSync('npx', ['playwright', 'test', '--config', path.join(HERE, 'ui', 'playwright.config.js')],
    { cwd: REPO, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

const ran = nodeFiles.length + (layers.includes('ui') ? 1 : 0);
console.log(`\n${failed ? `✗ ${failed} of ${ran} test group(s) FAILED` : `✓ ${ran} test group(s) passed`}`);
process.exit(failed ? 1 : 0);
