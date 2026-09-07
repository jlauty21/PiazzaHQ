'use strict';
// Minimal assertion harness — no dependencies. Each test file:
//
//   const { check, eq, ok, throws, report } = require('../lib/tap');
//   (async () => {
//     await check('does X', () => { ... eq(a, b) ... });
//     report();            // prints the tally, exits 1 if anything failed
//   })();
//
// `check`'s fn may be sync or async; a throw (or rejected promise) fails it.

const state = { pass: 0, fail: 0 };

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => { state.pass++; console.log(`  ok   ${name}`); },
      (e) => { state.fail++; console.log(`  FAIL ${name}\n       ${(e && e.message) || e}`); }
    );
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg || 'not equal'}\n       expected ${b}\n       got      ${a}`);
  }
}

function ok(value, msg) {
  if (!value) throw new Error(msg || `expected truthy, got ${JSON.stringify(value)}`);
}

function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg || 'expected the function to throw');
}

function report() {
  console.log(`\n  ${state.pass} passed, ${state.fail} failed`);
  if (state.fail) process.exit(1);
}

module.exports = { check, eq, ok, throws, report };
