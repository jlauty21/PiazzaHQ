'use strict';
const vm = require('vm');

// Run extracted source snippets in a fresh isolated context and hand back
// the context object. `parts` are strings of source (from extract.js);
// `globals` seeds free variables the snippet expects (IS_DEMO, a fake
// document, etc.); `exportNames` are `const`/`let` names to copy onto the
// context so the test can read them (a bare top-level `const` in a vm
// script is NOT otherwise visible as a context property — function
// declarations are).
function evalInSandbox(parts, globals = {}, exportNames = []) {
  const sandbox = {
    console, JSON, Date, RegExp, Math, Set, Map, WeakMap, WeakSet, Intl,
    Object, Array, String, Number, Boolean, Error, Promise, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout,
    ...globals,
  };
  vm.createContext(sandbox);
  let code = Array.isArray(parts) ? parts.join('\n\n') : parts;
  if (exportNames.length) {
    code += `\n;Object.assign(globalThis, { ${exportNames.join(', ')} });`;
  }
  vm.runInContext(code, sandbox, { filename: 'sandbox.js' });
  return sandbox;
}

module.exports = { evalInSandbox };
