'use strict';
// iCloud shared-album photo sync: link parsing, the sync itself, the schedule, and the photo-album settings routes.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/photo-album.test.js and test/unit/photo-album.test.js.
module.exports = function registerSharedAlbum({ path, fs, fetchWithTimeout, app, db, UPLOAD_DIR, broadcastUpdate, downloadFile, getSetting, isSlave, setSetting, URL }) {
  // A public iCloud shared album exposes an unauthenticated web feed (the same
  // thing icloud.com renders for a shared-album link). We poll it like an iCal
  // feed: paste a URL, the server downloads the photos into the same pool as
  // uploads (source='icloud', tagged 'icloud'). Host-only; a broken album sync
  // must never affect uploaded photos — errors just land in
  // icloud_album_last_error. Highest-risk of the planned features (undocumented
  // Apple endpoint) — keep every failure path graceful.
  //
  // PIAZZA_ICLOUD_HOST overrides the sharedstreams host (tests point it at a
  // fake server; unset in every real deployment).

  const SHARED_ALBUM_B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function parseSharedAlbumToken(url) {
    const s = String(url || '').trim();
    // Classic tokens are ~15 alphanumerics; newer "Copy Link" tokens are long
    // (60-120 chars) and contain '-' / '_' (base64url). Accept both shapes.
    let m = s.match(/icloud\.com\/sharedalbum\/#?([A-Za-z0-9._-]{8,240})/i);
    if (m) return m[1];
    m = s.match(/share\.icloud\.com\/photos\/([A-Za-z0-9._-]{8,240})/i);
    if (m) return m[1];
    return null;
  }
  function isSharedAlbumUrl(url) { return !!parseSharedAlbumToken(url); }
  // First-guess partition host from the token. Correct for classic short tokens;
  // modern long tokens derive to a low-numbered partition (p1/p2/…) that Apple
  // no longer runs, so icloudStreamPost() falls back to a list of known-live
  // partitions — whichever answers replies 330 + X-Apple-MMe-Host with the
  // album's real home, which icloudStreamFollow() then chases.
  function sharedAlbumBaseHost(token) {
    const seg = token[0] === 'A' ? token.slice(1, 3) : token.slice(1, 2);
    let n = 0;
    for (const ch of seg) { const d = SHARED_ALBUM_B62.indexOf(ch); if (d < 0) { n = 0; break; } n = n * 62 + d; }
    if (!Number.isFinite(n) || n < 1) n = 1;
    return `p${n}-sharedstreams.icloud.com`;
  }
  // Known-live sharedstreams partitions to bootstrap from when the derived guess
  // doesn't resolve. Any of them will 330-redirect a valid token to its real
  // partition; the list is just for resilience if one is down/renamed.
  const ICLOUD_BOOTSTRAP_HOSTS = ['p23', 'p52', 'p97', 'p113', 'p143', 'p161', 'p192']
    .map(p => `${p}-sharedstreams.icloud.com`);
  const _icloudTransient = (e) =>
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out|socket hang up|network|getaddrinfo/i
      .test(String((e && e.message) || e));
  // 330 (Apple's own partition-redirect status, not a real HTTP redirect code)
  // and the x-apple-mme-host header it carries are read directly by the caller
  // (icloudStreamFollow) — fetch() doesn't treat 330 as something to auto-follow,
  // so that hop-chasing logic is untouched here.
  async function icloudStreamRequest(url, bodyObj) {
    let u; try { u = new URL(url); } catch { throw new Error('bad iCloud url'); }
    let res;
    try {
      res = await fetchWithTimeout(u, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'User-Agent': 'PiazzaHQ/1.0', 'Origin': 'https://www.icloud.com', 'Accept': '*/*',
        },
        body: JSON.stringify(bodyObj || {}),
        timeoutMs: 20000,
        timeoutMessage: 'iCloud request timed out',
      });
    } catch (e) {
      // Real bug, found live (2026-09-18): fetch() throws a generic "fetch
      // failed" with the actual DNS/connection reason nested in e.cause —
      // left as-is, _icloudTransient() below (which pattern-matches on
      // e.message) never recognized ENOTFOUND/etc. as transient, so it never
      // fell through to the bootstrap hosts. A MODERN "Copy Link" token's
      // first-guess partition host is *expected* not to resolve (see
      // sharedAlbumBaseHost()'s own comment) — that's supposed to be exactly
      // the transient case the fallback list exists for, but the generic
      // message silently defeated it, so every modern-token album failed
      // outright instead of trying the next host. Unwrap the real cause.
      const cause = e && e.cause;
      throw new Error(cause && cause.message ? cause.message : e.message);
    }
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { statusCode: res.status, headers: Object.fromEntries(res.headers.entries()), json };
  }
  const _icloudRoot = (host) => /^https?:\/\//i.test(host) ? host.replace(/\/+$/, '') : 'https://' + host;
  // One start host, chasing 330 + X-Apple-MMe-Host to the album's real partition.
  async function icloudStreamFollow(host, token, endpoint, bodyObj) {
    for (let hop = 0; hop < 4; hop++) {
      const r = await icloudStreamRequest(`${_icloudRoot(host)}/${token}/sharedstreams/${endpoint}`, bodyObj);
      if (r.statusCode === 330 && r.headers['x-apple-mme-host']) { host = String(r.headers['x-apple-mme-host']); continue; }
      if (r.statusCode !== 200 || !r.json) throw new Error(`iCloud "${endpoint}" returned HTTP ${r.statusCode}`);
      return { host, json: r.json };
    }
    throw new Error(`iCloud "${endpoint}": too many partition redirects`);
  }
  async function icloudStreamPost(host, token, endpoint, bodyObj) {
    // Try the derived guess first; on a DNS/connection failure fall through to
    // the known-live partitions. A test host override never falls back to Apple.
    const extra = process.env.PIAZZA_ICLOUD_HOST ? [] : ICLOUD_BOOTSTRAP_HOSTS;
    const seen = new Set();
    const candidates = [host, ...extra].filter((h) => {
      const k = String(h || '').toLowerCase().replace(/^https?:\/\//, '');
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    let lastErr;
    for (const start of candidates) {
      try { return await icloudStreamFollow(start, token, endpoint, bodyObj); }
      catch (e) { lastErr = e; if (!_icloudTransient(e)) throw e; }
    }
    throw lastErr || new Error(`iCloud "${endpoint}": no reachable partition host`);
  }
  // Largest derivative no taller than capPx; else the smallest available.
  function pickAlbumDerivative(derivatives, capPx) {
    const list = Object.values(derivatives || {})
      .map(d => ({ checksum: d && d.checksum, width: +(d && d.width) || 0, height: +(d && d.height) || 0, fileSize: +(d && d.fileSize) || 0 }))
      .filter(d => d.checksum);
    if (!list.length) return null;
    const under = list.filter(d => d.height && d.height <= capPx);
    return (under.length ? under.sort((a, b) => b.height - a.height) : list.sort((a, b) => a.height - b.height))[0];
  }
  function imageExtFromMagic(b) {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null; // HEIC or anything a browser can't render — skip it
  }

  let _albumSyncing = false;
  async function syncIcloudAlbum() {
    const out = { added: 0, removed: 0, skipped: 0 };
    if (isSlave()) return out;
    if (_albumSyncing) return { ...out, error: 'A sync is already running.' };
    const token = parseSharedAlbumToken(getSetting('icloud_album_url'));
    if (!token) return out;
    _albumSyncing = true;
    try {
      let host = process.env.PIAZZA_ICLOUD_HOST || sharedAlbumBaseHost(token);
      const ws = await icloudStreamPost(host, token, 'webstream', { streamCtag: null });
      host = ws.host;
      const stream = ws.json || {};
      const newCtag = stream.streamCtag ? String(stream.streamCtag) : '';
      const savedCtag = getSetting('icloud_album_ctag');

      let photos = Array.isArray(stream.photos) ? stream.photos.filter(p => p && p.photoGuid) : [];
      photos.sort((a, b) => String(b.dateCreated || '').localeCompare(String(a.dateCreated || '')));
      const maxN = Math.max(1, Math.min(2000, parseInt(getSetting('icloud_album_max'), 10) || 300));
      photos = photos.slice(0, maxN);
      const wantGuids = new Set(photos.map(p => p.photoGuid));

      // Removals first — a photo pulled from the album (or now past the cap)
      // gets deleted locally, regardless of the ctag.
      for (const row of db.prepare(`SELECT id, filename, ext_guid FROM photos WHERE source = 'icloud'`).all()) {
        if (!wantGuids.has(row.ext_guid)) {
          try { fs.unlinkSync(path.join(UPLOAD_DIR, row.filename)); } catch {}
          db.prepare(`DELETE FROM photos WHERE id = ?`).run(row.id);
          out.removed++;
        }
      }
      const haveGuids = new Set(db.prepare(`SELECT ext_guid FROM photos WHERE source = 'icloud'`).all().map(r => r.ext_guid));

      // Nothing changed and nothing missing → no-op poll.
      if (newCtag && newCtag === savedCtag && out.removed === 0 && [...wantGuids].every(g => haveGuids.has(g))) {
        setSetting('icloud_album_last_sync', new Date().toISOString());
        setSetting('icloud_album_last_error', '');
        return out;
      }

      const toAdd = photos.filter(p => !haveGuids.has(p.photoGuid));
      const capPx = Math.max(320, Math.min(4320, parseInt(getSetting('icloud_album_max_px'), 10) || 2160));
      for (let i = 0; i < toAdd.length; i += 20) {
        const batch = toAdd.slice(i, i + 20);
        const meta = new Map(); // checksum -> { guid, caption }
        const guids = [];
        for (const p of batch) {
          const d = pickAlbumDerivative(p.derivatives, capPx);
          if (!d) { out.skipped++; continue; }
          guids.push(p.photoGuid);
          meta.set(d.checksum, { guid: p.photoGuid, caption: String(p.caption || '').slice(0, 200) });
        }
        if (!guids.length) continue;
        const au = await icloudStreamPost(host, token, 'webasseturls', { photoGuids: guids });
        host = au.host;
        const items = (au.json && au.json.items) || {};
        for (const [checksum, m] of meta) {
          const it = items[checksum];
          if (!it || !it.url_location || !it.url_path) { out.skipped++; continue; }
          const assetUrl = (/^https?:\/\//i.test(it.url_location) ? it.url_location : 'https://' + it.url_location) + it.url_path;
          const safe = String(m.guid).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
          const tmp = path.join(UPLOAD_DIR, `.icloud.dl.${safe}.${process.pid}`);
          try {
            await downloadFile(assetUrl, tmp, 45000);
            const fd = fs.openSync(tmp, 'r');
            const hb = Buffer.alloc(16);
            fs.readSync(fd, hb, 0, 16, 0);
            fs.closeSync(fd);
            const ext = imageExtFromMagic(hb);
            if (!ext) { fs.unlinkSync(tmp); out.skipped++; continue; }
            const filename = `icloud_${safe}.${ext}`;
            fs.renameSync(tmp, path.join(UPLOAD_DIR, filename));
            const maxOrder = db.prepare(`SELECT MAX(sort_order) m FROM photos`).get().m || 0;
            db.prepare(`INSERT INTO photos (filename, label, tags, sort_order, source, ext_guid) VALUES (?,?,?,?,?,?)`)
              .run(filename, m.caption, 'icloud', maxOrder + 1, 'icloud', m.guid);
            out.added++;
          } catch (e) {
            try { fs.unlinkSync(tmp); } catch {}
            out.skipped++;
          }
        }
      }

      if (newCtag) setSetting('icloud_album_ctag', newCtag);
      setSetting('icloud_album_last_sync', new Date().toISOString());
      setSetting('icloud_album_last_error', '');
      if (out.added || out.removed) broadcastUpdate('photos');
      console.log(`[icloud-album] sync: +${out.added} -${out.removed} (${out.skipped} skipped)`);
      return out;
    } catch (e) {
      setSetting('icloud_album_last_error', String(e && e.message || e).slice(0, 300));
      console.error('[icloud-album] sync failed: ' + (e && e.message || e));
      return { ...out, error: String(e && e.message || e) };
    } finally {
      _albumSyncing = false;
    }
  }
  function icloudAlbumIntervalMs() {
    const m = parseInt(getSetting('icloud_album_sync_minutes'), 10);
    return Math.max(15, Number.isFinite(m) ? m : 60) * 60 * 1000;
  }
  function scheduleIcloudAlbumSync() {
    setTimeout(() => {
      (async () => { try { if (parseSharedAlbumToken(getSetting('icloud_album_url'))) await syncIcloudAlbum(); } catch {} })()
        .finally(scheduleIcloudAlbumSync);
    }, icloudAlbumIntervalMs());
  }
  scheduleIcloudAlbumSync();
  setTimeout(() => { try { if (parseSharedAlbumToken(getSetting('icloud_album_url'))) syncIcloudAlbum().catch(() => {}); } catch {} }, 4500);

  app.get('/api/photo-album', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      url: getSetting('icloud_album_url') || '',
      connected: !!parseSharedAlbumToken(getSetting('icloud_album_url')),
      last_sync: getSetting('icloud_album_last_sync') || '',
      last_error: getSetting('icloud_album_last_error') || '',
      count: db.prepare(`SELECT COUNT(*) n FROM photos WHERE source = 'icloud'`).get().n,
      syncing: _albumSyncing,
    });
  });
  app.put('/api/photo-album', (req, res) => {
    const url = String((req.body && req.body.url) || '').trim();
    if (!url) return res.status(400).json({ error: 'A shared-album URL is required.' });
    if (!isSharedAlbumUrl(url)) {
      return res.status(400).json({ error: 'That doesn\'t look like an iCloud shared-album link (icloud.com/sharedalbum/#… or share.icloud.com/photos/…).' });
    }
    setSetting('icloud_album_url', url);
    setSetting('icloud_album_ctag', '');
    setSetting('icloud_album_last_error', '');
    broadcastUpdate('settings');
    syncIcloudAlbum().catch(() => {});
    res.json({ ok: true });
  });
  app.post('/api/photo-album/sync', async (req, res) => {
    if (!parseSharedAlbumToken(getSetting('icloud_album_url'))) return res.status(400).json({ error: 'No album connected.' });
    const r = await syncIcloudAlbum();
    res.json({ ok: !r.error, ...r });
  });
  app.delete('/api/photo-album', (req, res) => {
    const rows = db.prepare(`SELECT id, filename FROM photos WHERE source = 'icloud'`).all();
    for (const row of rows) { try { fs.unlinkSync(path.join(UPLOAD_DIR, row.filename)); } catch {} }
    db.prepare(`DELETE FROM photos WHERE source = 'icloud'`).run();
    for (const k of ['icloud_album_url', 'icloud_album_ctag', 'icloud_album_last_sync', 'icloud_album_last_error']) setSetting(k, '');
    broadcastUpdate('photos');
    broadcastUpdate('settings');
    res.json({ ok: true, removed: rows.length });
  });
  return { scheduleIcloudAlbumSync };
};
