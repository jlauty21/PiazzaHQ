'use strict';
// Air quality / pollen / UV (Open-Meteo, no key): the proxy route and its category helpers.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/data-feeds-offline.test.js.
module.exports = function registerAirQuality({ fetchWithTimeout, app, db }) {
  // Reuses the same lat/lon already saved for Weather — no separate location setup.
  // Override only in tests (PIAZZA_AIRQUALITY_URL); unset everywhere real —
  // same pattern as OPENMETEO_BASE/NOMINATIM_BASE above.
  const AIRQUALITY_BASE = process.env.PIAZZA_AIRQUALITY_URL || 'https://air-quality-api.open-meteo.com';
  // Cached the same way getWeatherResolved() is — the client only ever polls
  // this every 30 min (AQI/pollen/UV change slowly), so a 15-min server
  // cache can never make a response staler than what the client already
  // tolerates, while still cutting real, redundant upstream calls.
  const _airQualityCache = new Map(); // "lat,lon" -> { data, at }
  const AIR_QUALITY_CACHE_MS = 15 * 60 * 1000;
  async function getAirQuality(lat, lon) {
    const cacheKey = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
    const cached = _airQualityCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < AIR_QUALITY_CACHE_MS) return cached.data;
    const url = `${AIRQUALITY_BASE}/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=us_aqi,pm2_5,pm10,uv_index` +
      `&hourly=grass_pollen,birch_pollen,ragweed_pollen` +
      `&timezone=auto&forecast_days=1`;
    const res = await fetchWithTimeout(url, { timeoutMs: 10000, timeoutMessage: 'Timed out fetching air quality data' });
    let parsed;
    try { parsed = await res.json(); }
    catch { throw new Error('Failed to parse air quality data'); }
    _airQualityCache.set(cacheKey, { data: parsed, at: Date.now() });
    return parsed;
  }
  function aqiCategory(aqi) {
    if (aqi == null) return { label: 'Unknown', color: '#9aa6c0' };
    if (aqi <= 50)  return { label: 'Good', color: '#3ec97a' };
    if (aqi <= 100) return { label: 'Moderate', color: '#ffd454' };
    if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#f4845f' };
    if (aqi <= 200) return { label: 'Unhealthy', color: '#fb7185' };
    if (aqi <= 300) return { label: 'Very Unhealthy', color: '#a78bfa' };
    return { label: 'Hazardous', color: '#7c2d12' };
  }
  function uvCategory(uv) {
    if (uv == null) return { label: 'Unknown', color: '#9aa6c0' };
    if (uv < 3)  return { label: 'Low', color: '#3ec97a' };
    if (uv < 6)  return { label: 'Moderate', color: '#ffd454' };
    if (uv < 8)  return { label: 'High', color: '#f4845f' };
    if (uv < 11) return { label: 'Very High', color: '#fb7185' };
    return { label: 'Extreme', color: '#a78bfa' };
  }
  app.get('/api/air-quality', async (req, res) => {
    let lat = req.query.lat, lon = req.query.lon;
    if (!lat || !lon) {
      const latRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lat'`).get();
      const lonRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lon'`).get();
      lat = latRow?.value; lon = lonRow?.value;
    }
    if (!lat || !lon) return res.status(400).json({ error: 'No location set — enter a ZIP code in Settings → Weather' });
    try {
      const data = await getAirQuality(lat, lon);
      const cur = data.current || {};
      const aqi = (cur.us_aqi != null) ? Math.round(cur.us_aqi) : null;
      const uv = (cur.uv_index != null) ? Math.round(cur.uv_index * 10) / 10 : null;
      // Pollen is only ever populated by Open-Meteo for European locations on the free
      // tier — null/undefined elsewhere is expected, not a failure. Pick the hourly
      // slot matching the current local hour (timezone=auto means hourly.time is
      // already local, so this doesn't need the server's own timezone_override).
      let pollen = { grass: null, birch: null, ragweed: null };
      if (data.hourly && Array.isArray(data.hourly.time)) {
        const now = new Date();
        const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`;
        let idx = data.hourly.time.indexOf(nowKey);
        if (idx === -1) idx = 0;
        pollen = {
          grass: data.hourly.grass_pollen ? data.hourly.grass_pollen[idx] ?? null : null,
          birch: data.hourly.birch_pollen ? data.hourly.birch_pollen[idx] ?? null : null,
          ragweed: data.hourly.ragweed_pollen ? data.hourly.ragweed_pollen[idx] ?? null : null,
        };
      }
      res.json({
        aqi, aqiInfo: aqiCategory(aqi),
        pm2_5: cur.pm2_5 ?? null, pm10: cur.pm10 ?? null,
        uv, uvInfo: uvCategory(uv),
        pollen,
        updated: cur.time || null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
