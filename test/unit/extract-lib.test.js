'use strict';
// Self-test for the extraction helpers. A broken extractor would silently
// weaken every other unit test (it'd "pass" against stale or wrong source),
// so this checks it directly against small known snippets AND against the
// real files it's used on.
const fs = require('fs');
const path = require('path');
const { extractFunction, extractConst } = require('../lib/extract');
const { check, eq, ok, throws, report } = require('../lib/tap');

const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

(async () => {
  await check('extractFunction pulls a whole function body', () => {
    const s = `x\nfunction foo(a) {\n  if (a) { return {b:1}; }\n  return [1,2];\n}\ny`;
    eq(extractFunction(s, 'function foo('), 'function foo(a) {\n  if (a) { return {b:1}; }\n  return [1,2];\n}');
  });

  await check('extractFunction throws (not silently wrong) when the name is gone', () => {
    throws(() => extractFunction('nothing here', 'function missing('));
  });

  await check('extractFunction pulls the `async` keyword in even if the signature omits it', () => {
    const s = `x\nasync function go() { await y(); return 1; }\nz`;
    const out = extractFunction(s, 'function go(');
    ok(out.startsWith('async function go()'), `expected leading async, got: ${out.slice(0, 20)}`);
    ok(out.endsWith('}'));
  });

  await check('extractConst pulls an object literal with nested brackets', () => {
    const s = `const M = { a: [1, 2], b: { c: () => ({ d: 3 }) } };\nconst N = 9;`;
    eq(extractConst(s, 'M'), `const M = { a: [1, 2], b: { c: () => ({ d: 3 }) } };`);
  });

  await check('extractConst pulls a new Set([...]) initializer', () => {
    const s = `const S = new Set(['a', 'b', 'c']);\nmore`;
    eq(extractConst(s, 'S'), `const S = new Set(['a', 'b', 'c']);`);
  });

  await check('extractConst pulls a single-line regex literal', () => {
    const s = `const R = /\\b(foo|bar)\\w*/gi;\nnext`;
    eq(extractConst(s, 'R'), `const R = /\\b(foo|bar)\\w*/gi;`);
  });

  await check('extractConst throws when the const is gone', () => {
    throws(() => extractConst('const OTHER = 1;', 'GONE'));
  });

  // Against the real file — these must exist for the other unit tests to work.
  await check('the real HA guard consts are still extractable from server.js', () => {
    for (const n of ['HA_ACTIONS', 'DOMAIN_LOCKED_ACTIONS', 'HA_READ_ONLY_DOMAINS', 'HA_UNTARGETED_ACTIONS']) {
      const src = extractConst(SERVER, n);
      ok(src.startsWith(`const ${n} `), `extracted "${n}" should start with its declaration, got: ${src.slice(0, 40)}`);
    }
  });

  await check('demoCleanText is still extractable from server.js', () => {
    ok(extractFunction(SERVER, 'function demoCleanText(').includes('DEMO_BADWORDS'));
  });

  report();
})();
