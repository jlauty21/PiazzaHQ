#!/usr/bin/env node
// Regression test for the layout-rotation incident (v1.83.3 -> v1.83.4): a
// schedule-driven rotation silently overwrote a real display's own layout
// with a rotation target's content. Root cause and full writeup live in
// HANDOFF.md; the fix was a guard in saveLayoutNow() -- the single choke
// point every layout save funnels through -- that refuses to persist while
// state.layout is a schedule-driven override.
//
// It runs the REAL, CURRENT saveLayoutNow() pulled straight out of
// public/display.html (via test/lib/extract.js -- brace-matched, never a
// hand-copied snapshot) in an isolated vm sandbox against the exact
// conditions of the incident, so a future change that reintroduces this
// class of bug -- from ANY calling path -- fails a test instead of shipping.
//
// Run via `npm test` (which runs it in the Docker container, see test/run.sh)
// or directly: `node test/rotation-smoke-test.js`.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./lib/extract');
const { check, report } = require('./lib/tap');

const DISPLAY_HTML_PATH = path.join(__dirname, '..', 'public', 'display.html');

function makeSandbox(overrides) {
  const calls = { fetch: [] };
  const sandbox = {
    console,
    fetch: async (url, opts) => { calls.fetch.push({ url, opts }); return { ok: true }; },
    encodeURIComponent,
    JSON,
    Date,
    showDisplayToast: () => {},
    DISPLAY_SLUG: 'real-display',
    currentOrientation: 'landscape',
    _scheduleOverrideActive: false,
    _lastLocalLayoutSaveAt: 0,
    state: { layout: [{ id: 'w1', type: 'calendar' }] },
    ...overrides,
  };
  vm.createContext(sandbox);
  return { sandbox, calls };
}

async function run() {
  const html = fs.readFileSync(DISPLAY_HTML_PATH, 'utf8');
  const src = extractFunction(html, 'async function saveLayoutNow()');

  const scenario = (name, overrides, assertFn) => check(name, async () => {
    const { sandbox, calls } = makeSandbox(overrides);
    vm.runInContext(`${src}\nglobalThis.__run = saveLayoutNow;`, sandbox);
    await sandbox.__run();
    assertFn(calls);
  });

  // The actual incident: state.layout holds a rotation TARGET's widgets
  // (schedule-engine-triggered), not this display's own content. Must not
  // persist under any circumstance, regardless of which code path got here.
  await scenario(
    'blocks the save while a schedule-driven rotation override is active',
    { _scheduleOverrideActive: true },
    (calls) => { if (calls.fetch.length !== 0) throw new Error(`expected 0 fetch calls, got ${calls.fetch.length}`); }
  );

  // Sanity check in the other direction -- a fix that goes too far and
  // blocks saving ENTIRELY would pass the test above for the wrong reason.
  await scenario(
    'saves normally when there is no rotation override in effect',
    { _scheduleOverrideActive: false },
    (calls) => {
      if (calls.fetch.length !== 1) throw new Error(`expected exactly 1 fetch call, got ${calls.fetch.length}`);
      const { url, opts } = calls.fetch[0];
      if (!url.includes('display=real-display')) throw new Error(`expected the real display's slug in the URL, got: ${url}`);
      if (opts.method !== 'PUT') throw new Error(`expected a PUT, got: ${opts.method}`);
    }
  );

  // Pre-existing guard, same function, same choke point -- covered here too
  // since a refactor of one guard could plausibly break the other.
  await scenario(
    'blocks the save when no display slug is set',
    { DISPLAY_SLUG: '' },
    (calls) => { if (calls.fetch.length !== 0) throw new Error(`expected 0 fetch calls, got ${calls.fetch.length}`); }
  );

  report();
}

run().catch(e => { console.error('Smoke test crashed:', e); process.exit(1); });
