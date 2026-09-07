'use strict';
// demoCleanText(s, max) — used on every text write path when DEMO_MODE=1
// (event titles/notes, to-do items, chore titles, reminders, …). It caps
// length and masks a profanity list; it is a no-op when not in demo mode.
const fs = require('fs');
const path = require('path');
const { extractFunction, extractConst } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, report } = require('../lib/tap');

const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const pieces = [
  extractConst(SERVER, 'DEMO_BADWORDS'),
  extractFunction(SERVER, 'function demoCleanText('),
];

const demoOn = evalInSandbox(pieces, { IS_DEMO: true }, ['demoCleanText']).demoCleanText;
const demoOff = evalInSandbox(pieces, { IS_DEMO: false }, ['demoCleanText']).demoCleanText;

(async () => {
  await check('no-op when not in demo mode — returns input verbatim, uncapped', () => {
    const long = 'x'.repeat(500);
    eq(demoOff(long, 200), long);
    eq(demoOff('this is fucking long ' + 'y'.repeat(300), 50), 'this is fucking long ' + 'y'.repeat(300));
  });

  await check('passes null/undefined straight through in both modes', () => {
    eq(demoOn(null), null);
    eq(demoOn(undefined), undefined);
    eq(demoOff(null), null);
  });

  await check('caps length to `max` in demo mode', () => {
    eq(demoOn('abcdefghij', 4), 'abcd');
    eq(demoOn('hello world', 100), 'hello world');
  });

  await check('default cap is 200', () => {
    eq(demoOn('z'.repeat(300)).length, 200);
  });

  await check('masks a profanity with the same number of asterisks', () => {
    eq(demoOn('what the shit', 100), 'what the ****');
    eq(demoOn('bitchy comment', 100), '****** comment'); // \\w* eats the suffix
  });

  await check('masks multiple hits in one string', () => {
    eq(demoOn('shit and piss', 100), '**** and ****');
  });

  await check('leaves clean text alone', () => {
    eq(demoOn('Dentist appointment at 3pm', 100), 'Dentist appointment at 3pm');
  });

  await check('coerces non-strings before slicing (demo mode)', () => {
    eq(demoOn(12345, 3), '123');
  });

  report();
})();
