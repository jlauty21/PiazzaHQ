'use strict';
// Pull the exact, current source of a top-level function out of a source
// file (server.js / public/*.html) by brace-matching from its declaration.
//
// Deliberately NOT a hand-copied snapshot: if the function is renamed or
// restructured, this throws loudly ("not found" / "unbalanced") rather than
// silently testing a stale copy. That property is the whole point — see
// test/rotation-smoke-test.js's header for the incident that motivated it.

function extractFunction(src, signature) {
  let start = src.indexOf(signature);
  if (start === -1) {
    throw new Error(`extractFunction: "${signature}" not found — renamed or restructured?`);
  }
  // If the declaration is `async function foo(` but the caller passed
  // `function foo(`, pull the `async` in too — otherwise the extracted body
  // has `await` in a non-async function and won't parse.
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const open = src.indexOf('{', start);
  if (open === -1) throw new Error(`extractFunction: no "{" after "${signature}"`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`extractFunction: unbalanced braces extracting "${signature}" — extraction is broken, not the source`);
}

// Pull a top-level `const NAME = <initializer>` out of a source file as a
// string of executable source. Handles object / array / `new Set([...])` /
// `new Map([...])` initializers (bracket-matched on the FIRST bracket type
// seen, so nested brackets of other kinds don't confuse it) and single-line
// regex literals. Same caveat as extractFunction: a bracket or brace inside
// a string literal in the initializer would break it — none of the current
// targets have that.
function extractConst(src, name) {
  const decl = new RegExp(`(^|\\n)\\s*const\\s+${name}\\s*=`);
  const m = decl.exec(src);
  if (!m) throw new Error(`extractConst: "const ${name} =" not found — renamed?`);
  const start = m.index + (m[1] ? 1 : 0); // skip the captured leading newline
  let i = m.index + m[0].length;
  while (i < src.length && ' \t'.includes(src[i])) i++;

  if (src[i] === '/') {
    // regex literal — take the rest of the line
    let j = src.indexOf('\n', i);
    if (j === -1) j = src.length;
    return src.slice(start, j).replace(/;?\s*$/, ';');
  }

  while (i < src.length && !'{[('.includes(src[i])) i++;
  if (i >= src.length) throw new Error(`extractConst: no initializer bracket for "${name}"`);
  const openCh = src[i];
  const closeCh = { '{': '}', '[': ']', '(': ')' }[openCh];
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1).replace(/;?\s*$/, ';');
    }
  }
  throw new Error(`extractConst: unbalanced "${openCh}" for "${name}"`);
}

module.exports = { extractFunction, extractConst };
