'use strict';
// Flight Map: live aircraft from the public ADS-B feeds, route / aircraft-type lookups, trails, the poll loop, the optional offline map downloads, and the flight-watch routes.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/flightmap.test.js.
module.exports = function registerFlightMap({ path, zlib, fs, crypto, fetchWithTimeout, app, dataPath, db, APP_VERSION, broadcastUpdate, downloadFile, getSetting, URL, coerceOwnerProfileId }) {
  // The "flightmap" widget shows filtered aircraft moving on a self-drawn world
  // map. Data comes from free community ADS-B APIs (airplanes.live, with
  // adsb.lol / adsb.fi as fallbacks) — polled server-side on an interval,
  // cached, and pushed to the widget via the normal SSE 'flightmap' topic. The
  // browser only ever hits /api/flightmap/* on its own origin. Every device
  // (host and each slave) runs its own poll loop, exactly like each runs its
  // own go2rtc — so flight_positions (the breadcrumb trail) is per-device and
  // not synced; only flight_watch (saved subjects) syncs host->slave.
  //
  // SSRF posture: outbound hosts are the configured source base (a settings
  // field, same trust class as ha_base_url), the pinned ADS-B fallback hosts,
  // and api.adsbdb.com for route/type enrichment. No user-supplied host ever
  // reaches a fetch — only a callsign/hex is interpolated into a fixed URL.

  const FLIGHT_BUILTIN_SOURCES = [
    'https://api.airplanes.live/v2',
    'https://api.adsb.lol/v2',
    'https://opendata.adsb.fi/api/v2',
  ];
  function flightSources() {
    const custom = (getSetting('flightmap_source') || '').trim().replace(/\/+$/, '');
    const list = [];
    if (/^https?:\/\/[^\s/]+/i.test(custom)) list.push(custom);
    for (const s of FLIGHT_BUILTIN_SOURCES) if (!list.includes(s)) list.push(s);
    return list;
  }
  function flightUserAgent() {
    const contact = (getSetting('flightmap_ua_contact') || '').trim();
    return `PiazzaHQ/${APP_VERSION} (+https://piazzahq.com${contact ? '; ' + contact : ''})`;
  }
  function flightPollSeconds() {
    const n = parseInt(getSetting('flightmap_poll_seconds'), 10);
    return Number.isFinite(n) ? Math.max(8, Math.min(n, 120)) : 12;
  }
  function flightTrailMinutes() {
    const n = parseInt(getSetting('flightmap_trail_minutes'), 10);
    return Number.isFinite(n) ? Math.max(2, Math.min(n, 480)) : 30;
  }
  // A widget can ask for a longer trail than the household default via
  // ?trailMin= on /state; clamp it here (both the seed window and the storage
  // retention floor honour this).
  function clampTrailMin(v, fallback) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(2, Math.min(n, 480)) : fallback;
  }

  // Normalise one readsb/tar1090 aircraft record to our shape.
  function normalizeAircraft(ac) {
    if (!ac || typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return null;
    const onGround = ac.alt_baro === 'ground' || ac.alt_baro === 0;
    const altFt = ac.alt_baro === 'ground' ? 0
      : (typeof ac.alt_baro === 'number' ? ac.alt_baro
      : (typeof ac.alt_geom === 'number' ? ac.alt_geom : null));
    return {
      hex: String(ac.hex || '').trim().toLowerCase(),
      callsign: String(ac.flight || '').trim(),
      reg: String(ac.r || '').trim(),
      type: String(ac.t || '').trim(),
      lat: ac.lat, lon: ac.lon,
      altFt,
      gsKts: typeof ac.gs === 'number' ? ac.gs : null,
      trackDeg: typeof ac.track === 'number' ? ac.track : (typeof ac.true_heading === 'number' ? ac.true_heading : null),
      vertRateFpm: typeof ac.baro_rate === 'number' ? ac.baro_rate : (typeof ac.geom_rate === 'number' ? ac.geom_rate : null),
      squawk: String(ac.squawk || '').trim(),
      mil: !!((Number(ac.dbFlags) || 0) & 1), // readsb dbFlags bit 0 = military
      onGround,
    };
  }

  // A FlightQuery is one of:
  //   {kind:'mil'} | {kind:'type', value} | {kind:'squawk', value}
  //   {kind:'callsign', value} | {kind:'reg', value} | {kind:'hex', value}
  //   {kind:'point', lat, lon, radiusNm}
  function flightQueryPath(q) {
    const e = encodeURIComponent;
    switch (q.kind) {
      case 'mil': return '/mil';
      case 'type': return '/type/' + e(String(q.value || '').toUpperCase());
      case 'squawk': return '/squawk/' + e(String(q.value || '').replace(/\D/g, '').slice(0, 4));
      case 'callsign': return '/callsign/' + e(String(q.value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
      case 'reg': return '/reg/' + e(String(q.value || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''));
      case 'hex': return '/hex/' + e(String(q.value || '').toLowerCase().replace(/[^0-9a-f,]/g, ''));
      case 'point': {
        const lat = Math.max(-90, Math.min(90, Number(q.lat) || 0));
        const lon = Math.max(-180, Math.min(180, Number(q.lon) || 0));
        const r = Math.max(1, Math.min(250, Math.round(Number(q.radiusNm) || 100)));
        return `/point/${lat}/${lon}/${r}`;
      }
      default: return null;
    }
  }
  function flightQueryKey(q) {
    if (!q || !q.kind) return '';
    if (q.kind === 'point') return `point:${Number(q.lat).toFixed(3)},${Number(q.lon).toFixed(3)},${Math.round(q.radiusNm)}`;
    return `${q.kind}:${String(q.value || '').toLowerCase()}`;
  }
  function flightQueryValid(q) { return !!(q && flightQueryPath(q)); }
  // "B738, A320" / "b738 a320" -> ['B738','A320']. The ADS-B /type/ endpoint is
  // one type per request, so a multi-type filter fans out to one query each and
  // the results merge by hex in the /state route.
  function flightTypeList(raw) {
    return String(raw || '').toUpperCase().split(/[\s,]+/).map(s => s.replace(/[^A-Z0-9]/g, '')).filter(Boolean).slice(0, 8);
  }

  async function flightHttpJson(base, pathname, timeoutMs = 8000) {
    let u;
    try { u = new URL(base + pathname); } catch { throw new Error('bad url'); }
    // https for the public APIs; http allowed too (same trust class as
    // ha_base_url — someone may point flightmap_source at a tar1090 box on
    // their own LAN). Scheme still bounded to the two.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad scheme');
    const res = await fetchWithTimeout(u, {
      headers: { 'User-Agent': flightUserAgent(), 'Accept': 'application/json' },
      timeoutMs,
      timeoutMessage: 'timeout',
    });
    if (res.status !== 200) throw new Error('HTTP ' + res.status);
    const body = await res.text();
    if (body.length > 4_000_000) throw new Error('too big');
    try { return JSON.parse(body); } catch { throw new Error('bad json'); }
  }

  // Try each source in order. The first that returns aircraft wins; a source
  // that answers 200-but-empty is NOT trusted to be authoritative (a
  // soft-rate-limited mirror looks exactly like "no matching aircraft"), so we
  // keep going and take the first non-empty result, falling back to an empty
  // 200 if that's genuinely all anyone has. Returns
  // { aircraft:[...], source, degraded } — degraded=true only if every source
  // errored (caller then keeps serving whatever it had).
  async function flightFetch(q) {
    const pathname = flightQueryPath(q);
    if (!pathname) return { aircraft: [], source: null, degraded: true };
    let anyOk = false, emptySource = null;
    for (const base of flightSources()) {
      try {
        const json = await flightHttpJson(base, pathname);
        anyOk = true;
        const raw = Array.isArray(json && json.ac) ? json.ac : (Array.isArray(json && json.aircraft) ? json.aircraft : []);
        const aircraft = raw.map(normalizeAircraft).filter(a => a && a.hex);
        if (aircraft.length) return { aircraft, source: base, degraded: false };
        if (!emptySource) emptySource = base;
      } catch { /* try next source */ }
    }
    if (anyOk) return { aircraft: [], source: emptySource, degraded: false };
    return { aircraft: [], source: null, degraded: true };
  }

  // ── route / aircraft-type enrichment (adsbdb.com — free, no key) ──
  // The ADS-B feeds carry position + callsign but not the origin/destination
  // airports or a human aircraft-type name. adsbdb fills that in. Cached in
  // memory (lost on restart, refetched — fine) and decorated onto the aircraft
  // objects the /state route returns. Only ever fetches api.adsbdb.com over
  // https; a fixed host, no user input in the URL beyond the callsign/hex.
  const _flightRouteCache = new Map();    // callsign -> { route|null, at }
  const _flightAcInfoCache = new Map();   // hex -> { info|null, at }
  const _flightEnrichInflight = new Set();
  const ROUTE_TTL = 2 * 60 * 60 * 1000;
  const ACINFO_TTL = 24 * 60 * 60 * 1000;

  // PIAZZA_ADSBDB_URL overrides the enrichment host (tests only; unset in prod).
  const ADSBDB_BASE = process.env.PIAZZA_ADSBDB_URL || 'https://api.adsbdb.com';
  async function adsbdbGet(pathname) {
    const u = new URL(ADSBDB_BASE + pathname);
    const res = await fetchWithTimeout(u, {
      headers: { 'User-Agent': flightUserAgent(), 'Accept': 'application/json' },
      timeoutMs: 6000,
      timeoutMessage: 'timeout',
    });
    if (res.status === 404) return null; // unknown callsign/hex
    if (res.status !== 200) throw new Error('HTTP ' + res.status);
    const body = await res.text();
    if (body.length > 200000) throw new Error('too big');
    try { return JSON.parse(body); } catch { throw new Error('bad json'); }
  }
  function _airport(a) {
    if (!a || typeof a !== 'object') return null;
    return {
      icao: a.icao_code || '', iata: a.iata_code || '',
      name: a.name || '', city: a.municipality || '',
      lat: typeof a.latitude === 'number' ? a.latitude : null,
      lon: typeof a.longitude === 'number' ? a.longitude : null,
    };
  }
  async function flightEnrichOne(callsign, hex) {
    const cs = (callsign || '').trim().toUpperCase();
    const hx = (hex || '').trim().toLowerCase();
    const now = Date.now();
    const needRoute = cs && !(_flightRouteCache.has(cs) && now - _flightRouteCache.get(cs).at < ROUTE_TTL);
    const needAc = hx && !(_flightAcInfoCache.has(hx) && now - _flightAcInfoCache.get(hx).at < ACINFO_TTL);
    if (!needRoute && !needAc) return;
    const inflightKey = cs + '|' + hx;
    if (_flightEnrichInflight.has(inflightKey)) return;
    _flightEnrichInflight.add(inflightKey);
    try {
      if (needRoute) {
        try {
          const j = await adsbdbGet('/v0/callsign/' + encodeURIComponent(cs));
          const fr = j && j.response && typeof j.response === 'object' ? j.response.flightroute : null;
          _flightRouteCache.set(cs, { at: now, route: fr ? { from: _airport(fr.origin), to: _airport(fr.destination), airline: (fr.airline && fr.airline.name) || '' } : null });
        } catch { _flightRouteCache.set(cs, { at: now, route: null }); }
      }
      if (needAc) {
        try {
          const j = await adsbdbGet('/v0/aircraft/' + encodeURIComponent(hx));
          const ac = j && j.response && typeof j.response === 'object' ? j.response.aircraft : null;
          _flightAcInfoCache.set(hx, { at: now, info: ac ? { typeName: ac.type || '', icaoType: ac.icao_type || '', manufacturer: ac.manufacturer || '', owner: ac.registered_owner || '' } : null });
        } catch { _flightAcInfoCache.set(hx, { at: now, info: null }); }
      }
    } finally {
      _flightEnrichInflight.delete(inflightKey);
    }
  }
  // Decorate an aircraft list with cached route/type info. When awaitSmall and
  // the list is short (a followed flight / a small watch set), block briefly on
  // the first uncached lookup so the very first render has the route; big
  // filter lists enrich in the background and pick it up next poll.
  async function enrichAircraft(list, awaitSmall) {
    if (!Array.isArray(list) || !list.length) return list;
    const small = list.length <= 4;
    const jobs = [];
    for (const a of list) {
      if (!a.callsign && !a.hex) continue;
      const p = flightEnrichOne(a.callsign, a.hex);
      if (awaitSmall && small) jobs.push(p); else p.catch(() => {});
    }
    if (jobs.length) { try { await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(r, 2500))]); } catch {} }
    for (const a of list) {
      const r = a.callsign && _flightRouteCache.get(a.callsign.trim().toUpperCase());
      const i = a.hex && _flightAcInfoCache.get(a.hex);
      if (r && r.route) a.route = r.route;
      if (i && i.info) { a.typeName = i.info.typeName; a.owner = i.info.owner; if (!a.type && i.info.icaoType) a.type = i.info.icaoType; }
    }
    return list;
  }

  // ── poll loop ──
  const _flightState = new Map();   // queryKey -> { query, fetchedAt, source, aircraft, degraded }
  const _flightBackoff = new Map(); // queryKey -> ms
  let _flightPollTID = null;
  let _flightPolling = false;

  function activeFlightWatches(now) {
    const today = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    return db.prepare(`SELECT * FROM flight_watch`).all().filter(r =>
      (!r.active_from || r.active_from <= today) && (!r.active_to || r.active_to >= today));
  }
  function watchToQuery(r) {
    const kind = r.kind === 'reg' ? 'reg' : (r.kind === 'hex' ? 'hex' : 'callsign');
    return { kind, value: r.value };
  }
  // The union of distinct queries across every flightmap widget on every layout
  // plus every active flight_watch row. De-duped by key.
  function activeFlightQueries() {
    const out = new Map();
    const add = (q) => { if (flightQueryValid(q)) out.set(flightQueryKey(q), q); };
    try {
      for (const row of db.prepare(`SELECT widgets FROM layouts`).all()) {
        let arr; try { arr = JSON.parse(row.widgets || '[]'); } catch { continue; }
        if (!Array.isArray(arr)) continue;
        for (const w of arr) {
          if (!w || w.type !== 'flightmap') continue;
          for (const q of widgetFlightQueries(w)) add(q);
        }
      }
    } catch {}
    try { for (const r of activeFlightWatches()) add(watchToQuery(r)); } catch {}
    return [...out.entries()].map(([key, query]) => ({ key, query }));
  }
  // The concrete queries a single widget needs, given its subject config.
  function widgetFlightQueries(w) {
    const s = (w && w.fmSubject) || 'filter';
    if (s === 'flight') {
      const kind = w.fmFlightKind === 'reg' ? 'reg' : (w.fmFlightKind === 'hex' ? 'hex' : 'callsign');
      return w.fmFlightValue ? [{ kind, value: w.fmFlightValue }] : [];
    }
    if (s === 'watch') {
      const rows = activeFlightWatches().filter(r =>
        w.fmWatchProfileId == null ? true : String(r.profile_id) === String(w.fmWatchProfileId));
      return rows.map(watchToQuery);
    }
    // filter
    const f = (w && w.fmFilter) || {};
    if (f.mil) return [{ kind: 'mil' }];
    if (f.type) return flightTypeList(f.type).map(t => ({ kind: 'type', value: t }));
    if (f.squawk) return [{ kind: 'squawk', value: f.squawk }];
    if (f.radiusNm && (f.lat != null) && (f.lon != null))
      return [{ kind: 'point', lat: f.lat, lon: f.lon, radiusNm: f.radiusNm }];
    return [];
  }

  function recordFlightPositions(aircraft) {
    // No isSlave() guard: a slave is a real device with a display that polls the
    // ADS-B API itself, so it keeps its own local trail (flight_positions is not
    // synced). Same model as each device running its own go2rtc.
    const now = Math.floor(Date.now() / 1000);
    const ins = db.prepare(`INSERT INTO flight_positions (hex, ts, lat, lon, alt_ft, gs_kts, track, callsign) VALUES (?,?,?,?,?,?,?,?)`);
    const tx = db.transaction((list) => {
      for (const a of list) {
        if (!a.hex || typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
        ins.run(a.hex, now, a.lat, a.lon, a.altFt == null ? null : Math.round(a.altFt),
          a.gsKts == null ? null : a.gsKts, a.trackDeg == null ? null : a.trackDeg, a.callsign || null);
      }
    });
    try { tx(aircraft); } catch {}
  }

  async function flightPollTick() {
    if (_flightPolling) return;
    _flightPolling = true;
    try {
      const queries = activeFlightQueries();
      const keep = new Set(queries.map(q => q.key));
      for (const k of [..._flightState.keys()]) if (!keep.has(k)) _flightState.delete(k);
      if (!queries.length) return;
      let changed = false;
      for (const { key, query } of queries) {
        const bo = _flightBackoff.get(key) || 0;
        const prev = _flightState.get(key);
        if (bo && prev && Date.now() - prev.fetchedAt < bo) continue;
        const r = await flightFetch(query);
        if (r.degraded) {
          _flightBackoff.set(key, Math.min((bo || flightPollSeconds() * 1000) * 2, 5 * 60 * 1000));
          if (prev) prev.degraded = true;
          continue;
        }
        _flightBackoff.delete(key);
        _flightState.set(key, { query, fetchedAt: Date.now(), source: r.source, aircraft: r.aircraft, degraded: false });
        recordFlightPositions(r.aircraft);
        enrichAircraft(r.aircraft, false).catch(() => {}); // background: next /state call serves it
        changed = true;
      }
      if (changed) broadcastUpdate('flightmap');
    } catch (e) {
      console.error('[flightmap] poll error: ' + e.message);
    } finally {
      _flightPolling = false;
    }
  }
  function startFlightPolling() {
    if (_flightPollTID) clearInterval(_flightPollTID);
    const run = () => { flightPollTick().catch(() => {}); };
    _flightPollTID = setInterval(run, Math.max(4000, flightPollSeconds() * 1000));
    run();
  }

  // The longest trail any flightmap widget on any layout is asking for, so the
  // sweep keeps enough history to satisfy it (a widget's fmTrailMin can exceed
  // the household flightmap_trail_minutes default).
  function maxWidgetTrailMinutes() {
    let m = 0;
    try {
      for (const r of db.prepare(`SELECT widgets FROM layouts`).all()) {
        let arr; try { arr = JSON.parse(r.widgets || '[]'); } catch { continue; }
        for (const w of (Array.isArray(arr) ? arr : [])) {
          if (w && w.type === 'flightmap' && Number.isFinite(+w.fmTrailMin)) m = Math.max(m, +w.fmTrailMin);
        }
      }
    } catch {}
    return m;
  }
  function sweepFlightPositions() {
    try {
      const keepMin = Math.min(Math.max(flightTrailMinutes(), maxWidgetTrailMinutes(), 180), 480);
      const cutoff = Math.floor(Date.now() / 1000) - keepMin * 60;
      db.prepare(`DELETE FROM flight_positions WHERE ts < ?`).run(cutoff);
      // per-hex row cap — enough for ~8h at a 12s poll
      db.prepare(`
      DELETE FROM flight_positions WHERE rowid IN (
        SELECT rowid FROM (
          SELECT rowid, ROW_NUMBER() OVER (PARTITION BY hex ORDER BY ts DESC) AS rn FROM flight_positions
        ) WHERE rn > 2600
      )`).run();
    } catch (e) { console.error('[flightmap] sweep error: ' + e.message); }
  }
  setInterval(() => { try { sweepFlightPositions(); } catch {} }, 30 * 60 * 1000);

  function anyLayoutHasFlightMap() {
    try {
      for (const r of db.prepare(`SELECT widgets FROM layouts`).all()) {
        const arr = JSON.parse(r.widgets || '[]');
        if (Array.isArray(arr) && arr.some(w => w && w.type === 'flightmap')) return true;
      }
    } catch {}
    return false;
  }

  // ── world basemap (optional on-demand download, mirrors ensureGo2rtcBinary) ──
  // It's world-atlas@2's countries-50m.json (Natural Earth 1:50m land + country
  // borders — public domain), fetched once on first Flight Map use and
  // sha256-verified. Pinned + hashed in scripts/basemap-version.sh; keep in
  // step on a bump. Served from jsDelivr's npm mirror (stable, version-pinned);
  // PIAZZA_BASEMAP_URL overrides it (tests point it at a local fixture; unset
  // in every real deployment). ensureBasemap() accepts the file raw OR gzipped.
  const BASEMAP_VERSION = 'world-atlas@2/countries-50m';
  const BASEMAP_URL = process.env.PIAZZA_BASEMAP_URL
    || 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
  const BASEMAP_SHA256_GZ = 'b0cc4fba25b956b5797bdda6b5276cfa5aac427ba3274e7c3e9eb8a50de4bf0f';
  const BASEMAP_SHA256_RAW = '04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394';
  const BASEMAP_RAW_BYTES = 756420;
  const BASEMAP_PATH = dataPath('flightmap-basemap.json');
  let _basemapDownloading = false;
  let _basemapDownloadPromise = null;
  let _basemapUnavailable = false;
  let _basemapNextRetryAt = 0; // don't re-hit the network on every poll after a failure

  // Optional second layer: US state borders (us-atlas@3's states-10m.json —
  // public domain, US Census). Same on-demand + sha256 pattern; drawn under
  // the country outlines when the widget's "state lines" option is on.
  const STATES_URL = process.env.PIAZZA_STATES_URL || 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
  const STATES_SHA256 = 'd76b391ccfa8bff601d51e3e3da5d43a89fa46cd5caca72ce731b383be5596d0';
  const STATES_BYTES = 114554;
  const STATES_PATH = dataPath('flightmap-states.json');
  let _statesDownloading = false, _statesPromise = null, _statesUnavail = false, _statesRetryAt = 0;
  function statesReady() { try { return fs.existsSync(STATES_PATH) && fs.statSync(STATES_PATH).size === STATES_BYTES; } catch { return false; } }
  async function ensureStatesBasemap() {
    if (statesReady()) return true;
    if (_statesPromise) return _statesPromise;
    if (!flightmapWanted()) return false;
    if (_statesUnavail && Date.now() < _statesRetryAt) return false;
    _statesPromise = (async () => {
      _statesDownloading = true;
      const tmp = STATES_PATH + `.dl.${process.pid}`;
      try {
        fs.mkdirSync(path.dirname(STATES_PATH), { recursive: true });
        await downloadFile(STATES_URL, tmp, 60000);
        let buf = fs.readFileSync(tmp);
        if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
        if (crypto.createHash('sha256').update(buf).digest('hex') !== STATES_SHA256) throw new Error('states sha256 mismatch');
        JSON.parse(buf);
        fs.writeFileSync(STATES_PATH, buf);
        _statesUnavail = false;
        console.log('[flightmap] state-lines basemap ready');
        return true;
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        _statesUnavail = true; _statesRetryAt = Date.now() + 60000;
        console.error('[flightmap] state-lines download failed: ' + e.message);
        return false;
      } finally { _statesDownloading = false; _statesPromise = null; }
    })();
    return _statesPromise;
  }

  function basemapReady() {
    try { return fs.existsSync(BASEMAP_PATH) && fs.statSync(BASEMAP_PATH).size === BASEMAP_RAW_BYTES; }
    catch { return false; }
  }
  function basemapState() {
    if (basemapReady()) return 'ready';
    if (_basemapDownloading) return 'downloading';
    if (_basemapUnavailable) return 'unavailable';
    return 'idle';
  }
  function flightmapWanted() {
    return getSetting('flightmap_enabled') === '1' || anyLayoutHasFlightMap();
  }
  async function ensureBasemap() {
    if (basemapReady()) return true;
    if (_basemapDownloadPromise) return _basemapDownloadPromise;
    if (!flightmapWanted()) return false;
    if (_basemapUnavailable && Date.now() < _basemapNextRetryAt) return false; // cooling off after a failure
    _basemapDownloadPromise = (async () => {
      _basemapDownloading = true;
      const tmp = BASEMAP_PATH + `.download.${process.pid}`;
      const tmpDl = tmp + '.dl';
      try {
        fs.mkdirSync(path.dirname(BASEMAP_PATH), { recursive: true });
        console.log(`[flightmap] downloading basemap (${BASEMAP_VERSION})…`);
        await downloadFile(BASEMAP_URL, tmpDl, 60000);
        let buf = fs.readFileSync(tmpDl);
        // The source may serve the file raw (jsDelivr) or gzipped (a mirror /
        // the test fixture). gzip magic is 1f 8b.
        if (buf[0] === 0x1f && buf[1] === 0x8b) {
          if (crypto.createHash('sha256').update(buf).digest('hex') !== BASEMAP_SHA256_GZ)
            throw new Error('basemap .gz sha256 mismatch');
          buf = zlib.gunzipSync(buf);
        }
        if (crypto.createHash('sha256').update(buf).digest('hex') !== BASEMAP_SHA256_RAW)
          throw new Error('basemap sha256 mismatch');
        JSON.parse(buf); // must be valid JSON
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, BASEMAP_PATH);
        fs.rmSync(tmpDl, { force: true });
        _basemapUnavailable = false;
        console.log('[flightmap] basemap ready');
        return true;
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        try { fs.rmSync(tmpDl, { force: true }); } catch {}
        _basemapUnavailable = true;
        _basemapNextRetryAt = Date.now() + 60000;
        console.error('[flightmap] basemap download failed (map unavailable for now): ' + e.message);
        return false;
      } finally {
        _basemapDownloading = false;
        _basemapDownloadPromise = null;
      }
    })();
    return _basemapDownloadPromise;
  }
  // Self-heal: a flight widget exists but the basemap never landed (offline at
  // first use) — retry while it's wanted. Cheap no-op otherwise.
  setInterval(() => {
    if (!basemapReady() && !_basemapDownloading && flightmapWanted()) ensureBasemap().catch(() => {});
    if (!statesReady() && !_statesDownloading && flightmapWanted()) ensureStatesBasemap().catch(() => {});
  }, 20 * 60 * 1000);

  // ── routes ──
  function resolveSubjectQueries(qp) {
    const subject = qp.subject || 'filter';
    if (subject === 'flight') {
      const kind = qp.hex ? 'hex' : (qp.reg ? 'reg' : 'callsign');
      const value = qp.hex || qp.reg || qp.callsign || '';
      return value ? [{ kind, value }] : [];
    }
    if (subject === 'watch') {
      let rows = activeFlightWatches();
      if (qp.watchId) rows = rows.filter(r => String(r.id) === String(qp.watchId));
      else if (qp.profileId) rows = rows.filter(r => String(r.profile_id) === String(qp.profileId));
      return rows.map(watchToQuery);
    }
    // filter
    if (qp.mil === '1' || qp.mil === 'true') return [{ kind: 'mil' }];
    if (qp.type) return flightTypeList(qp.type).map(t => ({ kind: 'type', value: t }));
    if (qp.squawk) return [{ kind: 'squawk', value: qp.squawk }];
    if (qp.radiusNm && qp.lat && qp.lon)
      return [{ kind: 'point', lat: Number(qp.lat), lon: Number(qp.lon), radiusNm: Number(qp.radiusNm) }];
    return [];
  }

  app.get('/api/flightmap/state', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const queries = resolveSubjectQueries(req.query).filter(flightQueryValid);
    if (!queries.length) return res.json({ aircraft: [], fetchedAt: 0, source: null, degraded: false, trailSeed: {}, note: 'no subject configured' });
    const byHex = new Map();
    let fetchedAt = 0, source = null, degraded = false;
    const maxAge = flightPollSeconds() * 1000;
    for (const q of queries) {
      const key = flightQueryKey(q);
      let entry = _flightState.get(key);
      if (!entry || Date.now() - entry.fetchedAt > maxAge) {
        try {
          const r = await flightFetch(q);
          if (!r.degraded) {
            entry = { query: q, fetchedAt: Date.now(), source: r.source, aircraft: r.aircraft, degraded: false };
            _flightState.set(key, entry);
            recordFlightPositions(r.aircraft);
          } else if (!entry) {
            degraded = true;
            continue;
          } else {
            entry.degraded = true;
          }
        } catch { if (!entry) { degraded = true; continue; } }
      }
      if (!entry) continue;
      fetchedAt = Math.max(fetchedAt, entry.fetchedAt);
      source = source || entry.source;
      if (entry.degraded) degraded = true;
      for (const a of entry.aircraft) byHex.set(a.hex, a);
    }
    let aircraft = [...byHex.values()];
    // "military only" — drop civil aircraft that happen to share an ICAO type
    // (e.g. civil aircraft that happen to share an ICAO type with a military variant).
    if (req.query.milOnly === '1' || req.query.milOnly === 'true') aircraft = aircraft.filter(a => a.mil);
    // callsign-prefix filter — "all United / Delta / …" (ICAO prefixes like
    // UAL, DAL). The ADS-B feed has no operator query, so this filters a
    // point/area result down by callsign.
    const csPfx = String(req.query.callsignPrefix || '').toUpperCase().split(/[\s,]+/).map(s => s.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
    if (csPfx.length) {
      aircraft = aircraft.filter(a => { const c = (a.callsign || '').toUpperCase(); return csPfx.some(p => c.startsWith(p)); });
    }
    // route / aircraft-type enrichment (adsbdb) — block briefly for a small
    // followed set so the first render has the route; big lists fill in later.
    try { await enrichAircraft(aircraft, true); } catch {}
    // trail seed: last N minutes of positions for each aircraft shown — the
    // widget's own fmTrailMin (?trailMin=) wins over the household default.
    const trailMin = clampTrailMin(req.query.trailMin, flightTrailMinutes());
    const since = Math.floor(Date.now() / 1000) - trailMin * 60;
    const trailSeed = {};
    const trailStmt = db.prepare(`SELECT ts, lat, lon, alt_ft FROM flight_positions WHERE hex = ? AND ts >= ? ORDER BY ts`);
    for (const a of aircraft) {
      const rows = trailStmt.all(a.hex, since);
      if (rows.length > 1) trailSeed[a.hex] = rows.map(r => [r.ts, r.lat, r.lon, r.alt_ft]);
    }
    res.json({ aircraft, fetchedAt, source, degraded, trailSeed });
  });

  app.get('/api/flightmap/trail/:hex', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const hex = String(req.params.hex || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 8);
    if (!hex) return res.json([]);
    const mins = clampTrailMin(req.query.minutes, flightTrailMinutes());
    const since = Math.floor(Date.now() / 1000) - mins * 60;
    res.json(db.prepare(`SELECT ts, lat, lon, alt_ft FROM flight_positions WHERE hex = ? AND ts >= ? ORDER BY ts`).all(hex, since));
  });

  app.get('/api/flightmap/basemap', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (flightmapWanted()) {
      if (!basemapReady() && !_basemapDownloading) ensureBasemap().catch(() => {});
      if (!statesReady() && !_statesDownloading) ensureStatesBasemap().catch(() => {});
    }
    res.json({ state: basemapState(), version: BASEMAP_VERSION, states: statesReady() });
  });
  app.get('/api/flightmap/basemap.json', (req, res) => {
    if (basemapReady()) {
      res.set('Cache-Control', 'public, max-age=604800, immutable');
      return res.sendFile(BASEMAP_PATH);
    }
    if (flightmapWanted()) ensureBasemap().catch(() => {});
    res.status(503).json({ state: basemapState() });
  });
  app.get('/api/flightmap/states.json', (req, res) => {
    if (statesReady()) {
      res.set('Cache-Control', 'public, max-age=604800, immutable');
      return res.sendFile(STATES_PATH);
    }
    if (flightmapWanted()) ensureStatesBasemap().catch(() => {});
    res.status(503).json({ ready: false });
  });

  // flight_watch CRUD. slaveWriteGuard proxies the mutating verbs to the host
  // automatically (not in its local-only allowlist); GET is answered locally
  // off the synced table.
  app.get('/api/flight-watch', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(db.prepare(`SELECT * FROM flight_watch ORDER BY COALESCE(profile_id, -1), id`).all());
  });
  const FW_KINDS = new Set(['callsign', 'reg', 'hex']);
  const FW_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function cleanWatchBody(b) {
    const kind = FW_KINDS.has(b.kind) ? b.kind : 'callsign';
    let value = String(b.value || '').trim().toUpperCase();
    if (kind === 'hex') value = value.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 8);
    else value = value.replace(/[^A-Z0-9-]/g, '').slice(0, 12);
    const label = String(b.label || '').trim().slice(0, 60);
    const profileId = coerceOwnerProfileId(b.profile_id);
    const af = FW_DATE_RE.test(b.active_from || '') ? b.active_from : null;
    const at = FW_DATE_RE.test(b.active_to || '') ? b.active_to : null;
    return { kind, value, label, profileId, af, at };
  }
  app.post('/api/flight-watch', (req, res) => {
    const c = cleanWatchBody(req.body || {});
    if (!c.value) return res.status(400).json({ error: 'value is required (a callsign, registration or hex)' });
    const r = db.prepare(`INSERT INTO flight_watch (profile_id, kind, value, label, active_from, active_to) VALUES (?,?,?,?,?,?)`)
      .run(c.profileId, c.kind, c.value, c.label, c.af, c.at);
    broadcastUpdate('flight_watch');
    startFlightPolling(); // pick the new subject up now, not next tick
    res.status(201).json(db.prepare(`SELECT * FROM flight_watch WHERE id = ?`).get(r.lastInsertRowid));
  });
  app.put('/api/flight-watch/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM flight_watch WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const c = cleanWatchBody({ ...existing, ...req.body });
    if (!c.value) return res.status(400).json({ error: 'value cannot be empty' });
    db.prepare(`UPDATE flight_watch SET profile_id=?, kind=?, value=?, label=?, active_from=?, active_to=? WHERE id=?`)
      .run(c.profileId, c.kind, c.value, c.label, c.af, c.at, existing.id);
    broadcastUpdate('flight_watch');
    res.json(db.prepare(`SELECT * FROM flight_watch WHERE id = ?`).get(existing.id));
  });
  app.delete('/api/flight-watch/:id', (req, res) => {
    const r = db.prepare(`DELETE FROM flight_watch WHERE id = ?`).run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    broadcastUpdate('flight_watch');
    res.json({ ok: true });
  });
  return { startFlightPolling, ensureStatesBasemap, flightmapWanted, ensureBasemap };
};
