'use strict';
// isBetaVersion() gates the whole beta/stable split — the in-app beta
// checklist, whether BETA_CHECKLIST.md is served, the "you're on a beta"
// affordances. It's one regex against APP_VERSION; this pins its edges.
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, report } = require('../lib/tap');

const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const src = extractFunction(SERVER, 'function isBetaVersion(');

const isBeta = (version) =>
  evalInSandbox([src], { APP_VERSION: version }, ['isBetaVersion']).isBetaVersion();

(async () => {
  await check('plain x.y.z is not a beta', () => {
    eq(isBeta('1.84.0'), false);
    eq(isBeta('2.0.0'), false);
    eq(isBeta('1.83.5'), false);
  });

  await check('x.y.z-beta.N is a beta', () => {
    eq(isBeta('1.84.0-beta.1'), true);
    eq(isBeta('1.84.0-beta.40'), true);
    eq(isBeta('1.85.0-beta.5'), true);
  });

  await check('a -beta suffix without a number is NOT matched', () => {
    eq(isBeta('1.84.0-beta'), false);
  });

  await check('anything after -beta.N breaks the match (must be end-anchored)', () => {
    eq(isBeta('1.84.0-beta.5-hotfix'), false);
    eq(isBeta('1.84.0-beta.5 '), false);
  });

  report();
})();
