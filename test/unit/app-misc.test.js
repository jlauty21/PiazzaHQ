'use strict';
// Small app.html helpers.
//  - feedbackThreadSignature(t): id + message count, so the "developer
//    replied" banner re-shows when a thread gains a reply but stays quiet
//    when nothing changed.
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, ok, report } = require('../lib/tap');

const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.html'), 'utf8');
const sig = evalInSandbox(
  [extractFunction(APP, 'function feedbackThreadSignature(')], {}, ['feedbackThreadSignature']
).feedbackThreadSignature;

(async () => {
  await check('signature is id:messageCount', () => {
    eq(sig({ id: 7, thread: [{}, {}, {}] }), '7:3');
    eq(sig({ id: 'abc', thread: [] }), 'abc:0');
  });

  await check('a missing thread array counts as 0', () => {
    eq(sig({ id: 1 }), '1:0');
  });

  await check('signature changes when a reply is added (banner re-shows), not otherwise', () => {
    const before = sig({ id: 5, thread: [{}, {}] });
    const same = sig({ id: 5, thread: [{}, {}] });
    const grown = sig({ id: 5, thread: [{}, {}, {}] });
    ok(before === same, 'unchanged thread -> same signature (banner stays quiet)');
    ok(before !== grown, 'new reply -> different signature (banner re-shows)');
  });

  report();
})();
