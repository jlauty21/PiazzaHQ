'use strict';
// METAR/TAF (NOAA Aviation Weather): airport weather by ICAO code.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/data-feeds-offline.test.js.
module.exports = function registerMetar({ app, fetchJsonWithUA }) {
  // https://aviationweather.gov/api/data — public, keyless, but asks for a custom
  // User-Agent and reasonable rate limiting, both already satisfied by
  // fetchJsonWithUA() and the per-station cache below.
  const metarTafCache = new Map(); // icao -> { fetchedAt, data }
  const METAR_TAF_CACHE_MS = 10 * 60 * 1000;

  // Standard US flight-category rule, derived from ceiling (lowest broken/overcast
  // layer, or vertical visibility) and surface visibility — not returned directly by
  // the API, so computed here the same way pilots read a METAR at a glance.
  function flightCategory(visibSM, ceilingFt) {
    if (visibSM == null && ceilingFt == null) return null;
    const vis = visibSM == null ? Infinity : visibSM;
    const ceil = ceilingFt == null ? Infinity : ceilingFt;
    if (vis < 1 || ceil < 500) return 'LIFR';
    if (vis < 3 || ceil < 1000) return 'IFR';
    if (vis <= 5 || ceil <= 3000) return 'MVFR';
    return 'VFR';
  }
  // The API returns visibility as either a plain number (miles) or a string like
  // "10+" (at-or-above threshold) — normalize both to a number.
  function parseVisib(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace('+', ''));
    return Number.isFinite(n) ? n : null;
  }
  function lowestCeiling(clouds) {
    if (!Array.isArray(clouds)) return null;
    const layers = clouds.filter(c => c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV').map(c => c.base).filter(b => b != null);
    return layers.length ? Math.min(...layers) : null;
  }
  function skyConditionText(clouds) {
    if (!Array.isArray(clouds) || !clouds.length) return 'Sky data unavailable';
    if (clouds.length === 1 && (clouds[0].cover === 'CLR' || clouds[0].cover === 'SKC')) return 'Clear';
    const names = { FEW: 'Few', SCT: 'Scattered', BKN: 'Broken', OVC: 'Overcast', VV: 'Vertical Visibility' };
    return clouds
      .filter(c => c.cover !== 'CLR' && c.cover !== 'SKC')
      .map(c => `${names[c.cover] || c.cover}${c.base != null ? ' ' + c.base.toLocaleString() + 'ft' : ''}`)
      .join(', ') || 'Clear';
  }
  app.get('/api/metar-taf', async (req, res) => {
    const icao = String(req.query.icao || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(icao)) return res.status(400).json({ error: 'Enter a valid 4-letter ICAO airport code (e.g. KJFK).' });

    const cached = metarTafCache.get(icao);
    if (cached && (Date.now() - cached.fetchedAt) < METAR_TAF_CACHE_MS) {
      return res.json(cached.data);
    }
    try {
      const [metarRaw, tafRaw] = await Promise.all([
        fetchJsonWithUA(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`).catch(() => []),
        fetchJsonWithUA(`https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`).catch(() => []),
      ]);
      const m = Array.isArray(metarRaw) ? metarRaw[0] : null;
      const t = Array.isArray(tafRaw) ? tafRaw[0] : null;
      if (!m && !t) {
        return res.status(404).json({ error: `No data found for "${icao}" — check the ICAO code (it's usually 4 letters, e.g. KJFK, not the 3-letter airport code like JFK).` });
      }

      let metar = null;
      if (m) {
        const visib = parseVisib(m.visib);
        const ceiling = lowestCeiling(m.clouds);
        metar = {
          stationId: m.icaoId, name: m.name || icao,
          obsTime: m.obsTime ? m.obsTime * 1000 : null, // -> ms epoch for the client
          tempC: m.temp ?? null, dewpC: m.dewp ?? null,
          windDir: m.wdir ?? null, windSpeedKt: m.wspd ?? null, windGustKt: m.wgst ?? null,
          visibSM: visib,
          altimInHg: (m.altim != null) ? Math.round((m.altim / 33.8639) * 100) / 100 : null, // API gives hPa
          wx: m.wxString || null,
          sky: skyConditionText(m.clouds),
          flightCategory: flightCategory(visib, ceiling),
          raw: m.rawOb || null,
        };
      }
      let taf = null;
      if (t) {
        // issueTime is a "YYYY-MM-DD HH:MM:SS" string with no timezone marker, but is
        // always UTC — must explicitly mark it as such or Date() would (wrongly)
        // interpret it as the server's local time.
        const issuedMs = t.issueTime ? new Date(String(t.issueTime).replace(' ', 'T') + 'Z').getTime() : null;
        taf = {
          validFrom: t.validTimeFrom ? t.validTimeFrom * 1000 : null,
          validTo: t.validTimeTo ? t.validTimeTo * 1000 : null,
          issued: Number.isFinite(issuedMs) ? issuedMs : null,
          raw: t.rawTAF || null,
        };
      }
      const payload = { icao, name: (m && m.name) || (t && t.name) || icao, metar, taf };
      metarTafCache.set(icao, { fetchedAt: Date.now(), data: payload });
      res.json(payload);
    } catch (e) {
      if (cached) return res.json({ ...cached.data, stale: true });
      res.status(500).json({ error: 'Could not reach the Aviation Weather Center — ' + e.message });
    }
  });
};
