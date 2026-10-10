'use strict';
// Compresses the app's own static text files (scripts, styles, pages, catalogs) for visitors that accept it. Measured 2026-10-02: through remote access the control
// app took 6-7 s because the household's upload to Cloudflare carried everything uncompressed (about 1.3 MB, 310 KB as gzip, 270 KB as brotli). Compressing here
// shrinks that leg and also helps slow Wi-Fi.
// Deliberately narrow: only GET/HEAD for files under public/ with a text extension, never a range request, never the live-update (SSE) stream or any /api route
// (those do not go through here), never uploads or images. Each file is compressed ONCE per (path, modified time) and kept in memory, so a Pi 3 pays the CPU
// cost on first use only, and off the main thread (async zlib). Anything unexpected falls through to express.static, which serves the file as before.
// Covered by test/api/static-compress.test.js.
module.exports = function makeStaticCompress({ fs, path, zlib, root }) {
  const TYPES = {
    '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  };
  const MIN = 1024, MAX = 4 * 1024 * 1024, MAX_ENTRIES = 600;
  const cache = new Map();      // abs path -> { key, br, gz }  (key = size-mtime)
  const inflight = new Map();   // abs path + key -> Promise
  const rootAbs = path.resolve(root) + path.sep;

  const pStat = (p) => new Promise((res) => fs.stat(p, (e, s) => res(e ? null : s)));
  const pRead = (p) => new Promise((res) => fs.readFile(p, (e, b) => res(e ? null : b)));
  const gz = (b) => new Promise((res) => zlib.gzip(b, { level: 9 }, (e, o) => res(e ? null : o)));
  const br = (b) => new Promise((res) => zlib.brotliCompress(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }, (e, o) => res(e ? null : o)));

  async function load(abs, st) {
    const key = st.size + '-' + Math.floor(st.mtimeMs);
    const hit = cache.get(abs);
    if (hit && hit.key === key) return hit;
    const id = abs + '|' + key;
    if (inflight.has(id)) return inflight.get(id);
    const p = (async () => {
      const raw = await pRead(abs);
      if (!raw) return null;
      const [g, b] = await Promise.all([gz(raw), br(raw)]);
      if (!g || !b) return null;
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
      const entry = { key, gz: g, br: b };
      cache.set(abs, entry);
      return entry;
    })().finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  // Accept-Encoding -> 'br' | 'gzip' | '' (a coding with q=0 is refused; brotli is preferred when both are fine)
  function pick(ae) {
    const q = {};
    for (const part of String(ae).split(',')) {
      const bits = part.trim().toLowerCase().split(';');
      if (!bits[0]) continue;
      let v = 1;
      for (const p of bits.slice(1)) { const m = /^\s*q\s*=\s*([0-9.]+)/.exec(p); if (m) v = parseFloat(m[1]); }
      q[bits[0]] = v;
    }
    return (q.br || 0) > 0 ? 'br' : (q.gzip || 0) > 0 ? 'gzip' : '';
  }

  // Sends abs compressed if it can; resolves true when it answered, false when the caller should carry on (serve the file as before).
  async function trySend(req, res, abs, extraHeaders) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      const type = TYPES[path.extname(abs).toLowerCase()];
      if (!type) return false;
      res.vary('Accept-Encoding');                                   // plain and compressed copies must not be mixed up by a cache
      if (req.headers.range) return false;
      const enc = pick(String(req.headers['accept-encoding'] || ''));
      if (!enc) return false;
      const st = await pStat(abs);
      if (!st || !st.isFile() || st.size < MIN || st.size > MAX) return false;
      const entry = await load(abs, st);
      if (!entry) return false;
      const body = enc === 'br' ? entry.br : entry.gz;
      if (body.length >= st.size) return false;                      // not worth it
      const etag = 'W/"' + entry.key + '-' + enc + '"';
      const headers = { 'Content-Type': type, 'Content-Encoding': enc, 'ETag': etag, 'Last-Modified': st.mtime.toUTCString(), 'Cache-Control': 'public, max-age=0', ...(extraHeaders || {}) };
      const inm = req.headers['if-none-match'];
      const ims = req.headers['if-modified-since'];
      if ((inm && inm.split(/\s*,\s*/).includes(etag)) || (!inm && ims && Date.parse(ims) >= Math.floor(st.mtimeMs / 1000) * 1000)) { res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'], Vary: res.getHeader('Vary') }); res.end(); return true; }
      res.writeHead(200, { ...headers, 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    } catch { return false; }
  }

  // Express middleware in front of express.static for the public/ tree.
  function middleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.includes('\0') || !TYPES[path.extname(rel).toLowerCase()]) return next();
    const abs = path.resolve(path.join(root, rel));
    if (!abs.startsWith(rootAbs)) return next();
    trySend(req, res, abs).then((done) => { if (!done) next(); }, () => next());
  }

  return { middleware, trySend };
};
