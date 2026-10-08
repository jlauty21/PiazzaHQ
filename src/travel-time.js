'use strict';
// Travel time widget: address lookup (Nominatim) and driving/walking time (OSRM or Google).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/data-feeds-offline.test.js.
module.exports = function registerTravelTime({ fetchWithTimeout, app, getSetting }) {
  // Free-text address -> lat/lon, cached briefly since the same origin/destination
  // pair gets looked up on every refresh but rarely actually changes. Separate from
  // the ZIP-only /api/geocode above (which also writes the global weather location
  // as a side effect — this must NOT do that, it's resolving arbitrary addresses
  // for a specific widget, not setting the device's home location).
  const _geocodeCache = new Map(); // query -> { lat, lon, label, at }
  const GEOCODE_CACHE_MS = 24 * 60 * 60 * 1000; // 24h — addresses don't move
  // Override the geocoder base only in tests (PIAZZA_NOMINATIM_URL); unset everywhere real.
  const NOMINATIM_BASE = process.env.PIAZZA_NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
  // Real bug (contact-form inquiry #6 follow-up, 2026-09-12): a household on
  // a network with broken/partial outbound IPv6 couldn't get the new per-
  // widget place-name search to resolve anything — same class of bug as
  // fetchUrl()'s, just never applied here. Forces IPv4 and times out a
  // stalled connection instead of hanging forever.
  async function geocodeAddress(query) {
    const cached = _geocodeCache.get(query);
    if (cached && (Date.now() - cached.at) < GEOCODE_CACHE_MS) return cached;
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    // PIAZZA_GEOCODE_TIMEOUT_MS overrides the default (tests only; unset in
    // prod) — lets a test exercise a genuine timeout in well under a second.
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'PiazzaHQ/1.0' },
      timeoutMs: Number(process.env.PIAZZA_GEOCODE_TIMEOUT_MS) || 10000,
      timeoutMessage: `Timed out looking up "${query}"`,
    });
    let results;
    try { results = await res.json(); }
    catch { throw new Error('Failed to parse geocoding response'); }
    if (!results.length) throw new Error(`Could not find "${query}"`);
    const result = { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), label: results[0].display_name, at: Date.now() };
    _geocodeCache.set(query, result);
    return result;
  }
  // OSRM's public demo router — free, no key, no signup. Road-network typical
  // travel time; does NOT account for live traffic conditions.
  // Cached the same way getWeatherResolved() is, keyed on the route (not just
  // location — mode matters too, driving vs. walking are different routes).
  // The client polls this every 5 min, so a matching 5-min cache can't make a
  // response any staler than what it already shows — it just avoids hitting
  // OSRM/Google again for every device/tab asking about the same commute
  // inside that window.
  const _travelTimeCache = new Map(); // "olat,olon|dlat,dlon|mode|provider" -> { data, at }
  const TRAVEL_TIME_CACHE_MS = 5 * 60 * 1000;
  // Override only in tests (PIAZZA_OSRM_URL); unset everywhere real.
  const OSRM_BASE = process.env.PIAZZA_OSRM_URL || 'https://router.project-osrm.org';
  function travelCacheKey(origin, destination, mode, provider) {
    return `${origin.lat},${origin.lon}|${destination.lat},${destination.lon}|${mode}|${provider}`;
  }
  async function getOsrmDuration(origin, destination, mode) {
    const cacheKey = travelCacheKey(origin, destination, mode, 'osrm');
    const cached = _travelTimeCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < TRAVEL_TIME_CACHE_MS) return cached.data;
    const profile = mode === 'walking' ? 'foot' : mode === 'bicycling' ? 'bike' : 'driving';
    const url = `${OSRM_BASE}/route/v1/${profile}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;
    const res = await fetchWithTimeout(url, { timeoutMs: 10000, timeoutMessage: 'Timed out fetching a route from OSRM' });
    let parsed;
    try { parsed = await res.json(); }
    catch { throw new Error('Failed to parse routing response'); }
    const route = parsed.routes && parsed.routes[0];
    if (!route) throw new Error('No route found between those two addresses');
    const result = { durationMin: Math.round(route.duration / 60), distanceMiles: Math.round(route.distance / 1609.34 * 10) / 10, trafficAware: false };
    _travelTimeCache.set(cacheKey, { data: result, at: Date.now() });
    return result;
  }
  // Google's Distance Matrix API — needs the user's own key, but gives a
  // traffic-aware duration ("in current traffic") the same way Google Maps
  // itself would show for right now.
  async function getGoogleDuration(origin, destination, mode, apiKey) {
    const cacheKey = travelCacheKey(origin, destination, mode, 'google');
    const cached = _travelTimeCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < TRAVEL_TIME_CACHE_MS) return cached.data;
    const gMode = mode === 'walking' ? 'walking' : mode === 'bicycling' ? 'bicycling' : 'driving';
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lon}&destinations=${destination.lat},${destination.lon}` +
      `&mode=${gMode}&departure_time=now&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(url, { timeoutMs: 10000, timeoutMessage: 'Timed out fetching a route from Google' });
    let parsed;
    try { parsed = await res.json(); }
    catch { throw new Error('Failed to parse Google response'); }
    const el = parsed.rows && parsed.rows[0] && parsed.rows[0].elements && parsed.rows[0].elements[0];
    if (!el || el.status !== 'OK') throw new Error('Google could not find a route between those addresses');
    const seconds = (el.duration_in_traffic || el.duration).value;
    const result = { durationMin: Math.round(seconds / 60), distanceMiles: Math.round(el.distance.value / 1609.34 * 10) / 10, trafficAware: !!el.duration_in_traffic };
    _travelTimeCache.set(cacheKey, { data: result, at: Date.now() });
    return result;
  }
  app.get('/api/travel-time', async (req, res) => {
    const origin = (req.query.origin || '').trim();
    const destination = (req.query.destination || '').trim();
    const mode = req.query.mode || 'driving';
    if (!origin || !destination) return res.status(400).json({ error: 'Set an origin and destination in this widget\'s settings' });
    try {
      const [originGeo, destGeo] = await Promise.all([geocodeAddress(origin), geocodeAddress(destination)]);
      const provider = getSetting('travel_provider') || 'osrm';
      const apiKey = getSetting('travel_api_key') || '';
      const route = (provider === 'google' && apiKey)
        ? await getGoogleDuration(originGeo, destGeo, mode, apiKey)
        : await getOsrmDuration(originGeo, destGeo, mode);
      res.json({ ...route, originLabel: originGeo.label, destinationLabel: destGeo.label });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  return { geocodeAddress };
};
