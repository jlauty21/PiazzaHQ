'use strict';
// Geocoding: zip code / place name to latitude and longitude (Nominatim).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api (geocode tests).
module.exports = function registerGeocoding({ fetchWithTimeout, app, db, geocodeAddress }) {
  // US Postal abbreviations for the 50 states + DC, used to turn a full state name
  // (as returned by Nominatim) into the compact "ST" people expect next to a city,
  // e.g. "Columbus, OH" rather than "Columbus, Ohio".
  const US_STATE_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO',
    'Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID',
    'Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA',
    'Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS',
    'Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ',
    'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
    'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',
    'Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA',
    'West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','District of Columbia':'DC',
  };

  // Builds a clean location label from Nominatim's structured address breakdown
  // (addressdetails=1) rather than string-splitting display_name, which varies in
  // field count/order depending on how rural/urban the area is.
  // US addresses: "City, ST" (state abbreviated), matching the original format.
  // Non-US addresses: "City, Region, Country" when a state/region-level field is
  // available, else "City, Country" — since a bare city or county name alone can
  // be genuinely ambiguous worldwide (there are many towns sharing a name across
  // countries) in a way "City, ST" already isn't for a US audience.
  function buildLocationLabel(address) {
    if (!address) return '';
    const city = address.city || address.town || address.village || address.hamlet || address.county || '';
    const state = address.state || '';
    const country = address.country || '';
    const isUS = address.country_code === 'us';
    if (isUS) {
      const stateAbbr = US_STATE_ABBR[state] || state;
      if (city && stateAbbr) return `${city}, ${stateAbbr}`;
      return city || stateAbbr || '';
    }
    const parts = [city, state, country].filter(Boolean);
    // Avoid an awkward "City, City" when Nominatim's state-level field just
    // repeats the city/county name (common for city-states and some regions).
    return [...new Set(parts)].join(', ');
  }

  // Single Nominatim postal-code search, returning the parsed results array
  // (empty if none). Shared by resolveGeoCandidates below.
  async function nominatimPostalSearch(zip, countryCode) {
    const countryParam = countryCode ? `&country=${countryCode}` : '';
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}${countryParam}&format=json&addressdetails=1&limit=1`;
    // family:4/timeout — same fix as geocodeAddress() just below, same host.
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'PiazzaHQ/1.0' },
      timeoutMs: 10000,
      timeoutMessage: `Timed out looking up postal code "${zip}"`,
    });
    try { return await res.json(); }
    catch { throw new Error('Failed to parse geocoding response'); }
  }

  // Queries a US-scoped search and an unrestricted worldwide search in
  // parallel and returns however many DISTINCT places they point to (1 or 2).
  //
  // A country=US-only restriction was the original bug (a UK postcode simply
  // couldn't resolve at all). Removing the country filter entirely turned out
  // to be its own regression: plenty of postal-code FORMATS overlap across
  // countries — a plain 5-digit code exists in the US, but also in places
  // like Lithuania or Germany — and Nominatim doesn't rank "your household's
  // own country" any higher than any other match, so a real US ZIP like
  // 67228 could resolve to Lithuania instead of Kansas.
  //
  // Rather than guessing which one the household actually meant (whether by
  // hardcoding US-only again, or by trusting whichever the worldwide search
  // ranks first), this returns both when they genuinely disagree, so the
  // caller can ask instead of guess. When there's no real ambiguity — the
  // worldwide search either agrees with the US result or comes up empty
  // entirely, which is the common case for both an ordinary US ZIP and for a
  // non-US postal code like a UK postcode (no US match to conflict with) —
  // this quietly returns just the one real match, same as before.
  async function resolveGeoCandidates(zip) {
    const [usResults, worldResults] = await Promise.all([
      nominatimPostalSearch(zip, 'US'),
      nominatimPostalSearch(zip, null),
    ]);
    const us = usResults[0] || null;
    const world = worldResults[0] || null;
    if (!us) return world ? [world] : [];
    if (!world) return [us];
    const sameLat = Math.abs(parseFloat(us.lat) - parseFloat(world.lat)) < 0.05;
    const sameLon = Math.abs(parseFloat(us.lon) - parseFloat(world.lon)) < 0.05;
    return (sameLat && sameLon) ? [us] : [us, world];
  }

  function geoResultToCandidate(r) {
    const label = buildLocationLabel(r.address) || r.display_name;
    return { lat: r.lat, lon: r.lon, display_name: r.display_name, label, location_label: label };
  }

  app.get('/api/geocode', async (req, res) => {
    const { zip } = req.query;
    // When save=0, geocode WITHOUT touching the global weather location. Used by the
    // per-widget location override so looking up a vacation-home ZIP doesn't change
    // the whole device's default location.
    const save = req.query.save !== '0';
    if (!zip) return res.status(400).json({ error: 'zip required' });

    let candidates;
    try { candidates = await resolveGeoCandidates(zip); }
    catch (e) { return res.status(500).json({ error: e.message }); }
    if (!candidates.length) return res.status(404).json({ error: 'ZIP/postal code not found' });

    // Genuinely ambiguous (e.g. 67228 matching both Kansas and Lithuania) —
    // don't save anything yet, let the caller ask the person which one is
    // theirs and re-request with an explicit choice.
    if (candidates.length > 1) {
      return res.json({ ambiguous: true, candidates: candidates.map(geoResultToCandidate) });
    }

    const { lat, lon, display_name, address } = candidates[0];
    const locationLabel = buildLocationLabel(address);
    if (save) {
      const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
      db.transaction(() => {
        upsert.run('weather_lat', lat);
        upsert.run('weather_lon', lon);
        upsert.run('weather_zip', zip);
        upsert.run('weather_location_auto', locationLabel);
      })();
    }
    // Return both label keys so either caller style works.
    res.json({ lat, lon, display_name, location_label: locationLabel, label: locationLabel });
  });

  // Free-text place search (city / airport / landmark / ZIP) → lat/lon + label.
  // Read-only: unlike /api/geocode this never touches the device's saved weather
  // location. Used by widgets that let you centre a map on a searched place.
  app.get('/api/place-search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.status(400).json({ error: 'A search term is required.' });
    try {
      const r = await geocodeAddress(q);
      res.json({ lat: r.lat, lon: r.lon, label: r.label });
    } catch (e) {
      res.status(404).json({ error: (e && e.message) || 'Place not found' });
    }
  });
};
