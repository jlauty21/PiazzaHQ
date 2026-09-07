'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { test: base, expect } = require('@playwright/test');

const REPO = path.join(__dirname, '..', '..');
const PUBLIC = path.join(REPO, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Serve public/ the way server.js routes it: '/' -> display.html, '/app' ->
// app.html, etc. Every other path maps straight into public/.
function makeStaticServer() {
  return http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const route = { '/': 'display.html', '/app': 'app.html', '/kids': 'kids.html', '/chores': 'kids.html', '/hub': 'hub.html' }[p];
    const file = path.join(PUBLIC, route || p.replace(/^\/+/, ''));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('no'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}

// A `site` fixture: base URL of a running static server, torn down after.
const test = base.extend({
  site: async ({}, use) => {
    const server = makeStaticServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    await use(`http://127.0.0.1:${server.address().port}`);
    await new Promise((r) => server.close(r));
  },
});

// Pull a run of CSS out of a source file between two marker comments.
function cssBetween(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a + 1);
  if (a === -1 || b === -1) throw new Error(`cssBetween: markers not found (${startMarker} .. ${endMarker})`);
  return src.slice(a, b);
}

const readPublic = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

module.exports = { test, expect, cssBetween, readPublic, REPO, PUBLIC };
