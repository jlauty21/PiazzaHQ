'use strict';
// Weather route and radar: GET /api/weather (resolved weather for the saved or given location) and the RainViewer radar frames.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/weather-extras.test.js.
module.exports = function registerWeatherRadar({ path, fetchWithTimeout, app, db, getWeatherResolved }) {
  // RainViewer's own weather-maps.json is tiny (a frame list, not imagery) but
  // we still proxy it server-side rather than having the display fetch it
  // directly, for the same reason /api/weather and /api/air-quality are
  // proxied: keeps the display's outbound dependency list to "this server"
  // only, and lets the server apply its own short cache/retry behavior later
  // if RainViewer has a bad moment. The actual tile IMAGES (many, especially
  // while animating) are NOT proxied — those load directly from RainViewer's
  // tile CDN in the browser via Leaflet, same as any other tile-based map;
  // proxying binary tile traffic through this server would add real bandwidth
  // and CPU cost for no real benefit, and every other tile-map integration
  // (including RainViewer's own official examples) fetches tiles client-side.
  let radarFramesCache = null;
  let radarFramesCacheAt = 0;
  async function getRadarFrames() {
    const now = Date.now();
    if (radarFramesCache && (now - radarFramesCacheAt) < 2 * 60 * 1000) {
      return radarFramesCache;
    }
    const res = await fetchWithTimeout('https://api.rainviewer.com/public/weather-maps.json', {
      timeoutMs: 10000,
      timeoutMessage: 'Timed out fetching RainViewer radar frames',
    });
    let parsed;
    try { parsed = await res.json(); }
    catch { throw new Error('Failed to parse RainViewer data'); }
    // 'past' is up to the last 2 hours of OBSERVED radar (10-min steps)
    // — that 2-hour window is RainViewer's own hard ceiling for this
    // free tier, not a limit set here. 'nowcast', when present, is a
    // short-term (roughly 30–60 min) EXTRAPOLATION forward from now,
    // not a full weather-model forecast — tagged separately so the
    // client can label it differently if it wants to, rather than
    // presenting it as equally-measured data.
    const past = (parsed.radar && parsed.radar.past) || [];
    const nowcast = (parsed.radar && parsed.radar.nowcast) || [];
    const frames = [
      ...past.map(f => ({ time: f.time, path: f.path, kind: 'observed' })),
      ...nowcast.map(f => ({ time: f.time, path: f.path, kind: 'forecast' })),
    ];
    const result = { host: parsed.host, frames };
    radarFramesCache = result;
    radarFramesCacheAt = now;
    return result;
  }
  app.get('/api/radar-frames', async (req, res) => {
    try {
      const data = await getRadarFrames();
      if (!data.frames.length) return res.status(502).json({ error: 'No radar frames available right now' });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/weather', async (req, res) => {
    // Accept lat/lon directly or look up from saved settings
    let lat = req.query.lat;
    let lon = req.query.lon;
    if (!lat || !lon) {
      const latRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lat'`).get();
      const lonRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lon'`).get();
      lat = latRow?.value; lon = lonRow?.value;
    }
    if (!lat || !lon) return res.status(400).json({ error: 'No location set — enter a ZIP code in Settings' });
    try {
      res.json(await getWeatherResolved(lat, lon));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
