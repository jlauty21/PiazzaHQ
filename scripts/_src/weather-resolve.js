'use strict';
// Weather resolution: sunrise / sunset and day-night for any provider, today's high / low reconciled across polls, and the cached 'resolved' weather every other part of the server asks for.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/weather-extras.test.js and test/unit/weather-pure.test.js.
module.exports = function registerWeatherResolve({ RA, getSetting, getWeather, getWeatherOWM, getWeatherNWS }) {
  // Open-Meteo and OpenWeatherMap each report their own is_day, computed from
  // their own real astronomical data — generally trustworthy. NWS has no
  // sunrise/sunset of its own at all and derives is_day from whichever forecast
  // period's text happens to be "current", which is exactly the same
  // elapsed-period lag that caused the hi/lo bug above. Rather than have three
  // different trust boundaries for the same day/night fact (one of which has a
  // known bug), compute it ourselves the same way for every provider, so the
  // icon can never disagree with an actual sunset regardless of source.
  // Standard sunrise/sunset equation (Almanac for Computers, 1990).
  //
  // CORRECTED: an earlier version of this comment claimed the UTC-day-boundary
  // effect below was "imperceptible, off by less than a day" — that was wrong,
  // and understated a real, serious bug. For any longitude west of Greenwich
  // (i.e. the entire US), local evening sunset genuinely lands on the
  // FOLLOWING UTC calendar day. The raw algorithm returns just an hour-of-day
  // in [0,24) with no indication of which UTC date that belongs to, so a plain
  // `base + sunsetUT` anchored to the same UTC day as sunrise placed sunset
  // BEFORE sunrise numerically — making `is_day` false for essentially the
  // entire actual daytime, every single day, for any US location. Not a rare
  // edge case; this was the actual cause of the moon-during-daylight bug,
  // which had never actually been exercised before beta.7 (a separate crash
  // in trackTodayExtreme was throwing first every time, so this line never
  // even ran until that crash was fixed). Verified now with a continuous
  // 72-hour sweep across multiple longitudes/hemispheres (Denver, Tokyo,
  // London, Sydney) — exactly one flip to day and one to night per real 24h
  // period, everywhere tested.
  function computeSunTimes(lat, lon, when) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const dayOfYear = Math.floor((when.getTime() - Date.UTC(when.getUTCFullYear(), 0, 0)) / 86400000);
    const lngHour = lon / 15;
    function calc(isSunrise) {
      const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
      const M = (0.9856 * t) - 3.289;
      let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
      L = ((L % 360) + 360) % 360;
      let RA = deg * Math.atan(0.91764 * Math.tan(L * rad));
      RA = ((RA % 360) + 360) % 360;
      RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;
      const sinDec = 0.39782 * Math.sin(L * rad);
      const cosDec = Math.cos(Math.asin(sinDec));
      const cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));
      if (cosH > 1 || cosH < -1) return null; // sun never rises/sets today at this latitude (polar)
      let H = isSunrise ? 360 - deg * Math.acos(cosH) : deg * Math.acos(cosH);
      H /= 15;
      return (((H + RA - (0.06571 * t) - 6.622) - lngHour) % 24 + 24) % 24; // hour-of-day, UTC, in [0,24)
    }
    const sunriseUT = calc(true), sunsetUT = calc(false);
    if (sunriseUT == null || sunsetUT == null) return null;
    const base = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
    // If sunset's hour-of-day comes out numerically earlier than sunrise's, that's
    // the wraparound signature described above — it actually belongs to the
    // following UTC calendar day. Push it forward a day to correct it.
    const sunsetDayOffset = (sunsetUT < sunriseUT) ? 1 : 0;
    return {
      sunrise: new Date(base + sunriseUT * 3600000),
      sunset: new Date(base + (sunsetDayOffset * 24 + sunsetUT) * 3600000),
    };
  }
  function isDaytimeAt(lat, lon, when) {
    const sun = computeSunTimes(lat, lon, when);
    // Polar day/night edge case (sun never rises or sets): fall back to a
    // plain clock-hour guess rather than returning nothing.
    if (!sun) return when.getUTCHours() >= 6 && when.getUTCHours() < 19 ? 1 : 0;
    return (when >= sun.sunrise && when < sun.sunset) ? 1 : 0;
  }

  // Tracks the actual peak/trough current-conditions reading seen *today* per
  // location. Used as the fallback whenever a provider is missing today's
  // forecasted high/low (NWS, once a period has elapsed — see above) instead
  // of the instantaneous current reading. Using the instant reading was the
  // bug: as the evening cools off, current keeps dropping, so a "today's high"
  // recomputed fresh from current on every poll ticks down right along with
  // it. The running peak only ever moves toward the true high actually
  // reached, and only resets when the calendar date changes. In-memory only —
  // a server restart just starts re-accumulating from that point, which is a
  // fine tradeoff since this is purely a fallback value, never the primary
  // forecasted number.
  const _todayExtremes = new Map(); // "YYYY-MM-DD|lat|lon" -> { hi, lo }
  function trackTodayExtreme(lat, lon, temp) {
    if (temp == null) return null;
    const dateKey = new Date().toISOString().slice(0, 10);
    // Defensive coercion here too, not just at getWeatherResolved's entry
    // point — this is exactly the mistake that caused the beta.4 bug
    // (called with a string lat/lon, .toFixed() threw). Cheap insurance
    // against a future caller making the same assumption mistake again.
    const key = `${dateKey}|${(+lat).toFixed(2)}|${(+lon).toFixed(2)}`;
    for (const k of _todayExtremes.keys()) if (!k.startsWith(dateKey)) _todayExtremes.delete(k); // drop stale days
    let e = _todayExtremes.get(key);
    if (!e) { e = { hi: temp, lo: temp }; _todayExtremes.set(key, e); }
    else { if (temp > e.hi) e.hi = temp; if (temp < e.lo) e.lo = temp; }
    return e;
  }

  // Runs on every provider's normalized output before it reaches the rest of
  // the app, so both reported bugs are corrected regardless of which provider
  // is active:
  //   1. Today's hi/lo can never sit below/above the peak/trough actually
  //      observed today — backstops the NWS elapsed-period bug fixed above
  //      (using the tracked peak rather than the instant reading, so it
  //      doesn't tick down as the evening cools), and guards the same class
  //      of issue for Open-Meteo/OpenWeatherMap even without a confirmed bug
  //      there, since it's a cheap, safe invariant to enforce regardless of
  //      source.
  //   2. is_day is recomputed from real sunrise/sunset for this exact moment,
  //      not trusted from the provider — the actual fix for NWS's moon-during-
  //      daylight bug. This intentionally overrides Open-Meteo/OWM's own
  //      (already-accurate) is_day too, trading their minute-or-two-better
  //      precision for one shared, already-debugged code path instead of three
  //      separate ones.
  function reconcileWeatherToday(w, lat, lon) {
    if (!w) return w;
    if (w.current && w.current.temperature_2m != null) {
      const ext = trackTodayExtreme(lat, lon, w.current.temperature_2m);
      if (ext && w.daily && w.daily.temperature_2m_max && w.daily.temperature_2m_max.length) {
        if (w.daily.temperature_2m_max[0] != null && ext.hi > w.daily.temperature_2m_max[0]) w.daily.temperature_2m_max[0] = ext.hi;
        if (w.daily.temperature_2m_min[0] != null && ext.lo < w.daily.temperature_2m_min[0]) w.daily.temperature_2m_min[0] = ext.lo;
      }
    }
    if (w.current) w.current.is_day = isDaytimeAt(lat, lon, new Date());
    // UV index isn't a valid Open-Meteo `current` variable (only hourly/daily),
    // so current.uv_index arrives empty from getWeather() — fill it from the
    // hourly series' closest-to-now value. No-op for OWM (already set from
    // cur.uvi) and for NWS (doesn't report UV at all — stays absent, same as
    // NWS's already-blank sunrise/sunset).
    if (w.current && w.current.uv_index == null && w.hourly && Array.isArray(w.hourly.uv_index) && Array.isArray(w.hourly.time)) {
      const now = Date.now();
      let idx = 0;
      for (let i = 0; i < w.hourly.time.length; i++) {
        if (new Date(w.hourly.time[i]).getTime() <= now) idx = i; else break;
      }
      const uv = w.hourly.uv_index[idx];
      if (uv != null) w.current.uv_index = uv;
    }
    return w;
  }

  // always agree on the source. Falls back to keyless Open-Meteo on any failure.
  //
  // Cached in memory, same pattern as getRadarFrames() just below — a real
  // report (2026-09-13) that weather "took a while to load" traced back to
  // there being NO caching at all here: every single call, from any widget,
  // on any device, on every page load or periodic refresh, triggered a brand
  // new outbound round-trip fetching 16 days of hourly+daily data, even
  // though forecast data doesn't meaningfully change minute to minute and the
  // client's own fastest refresh interval is 5 minutes anyway. Keyed on
  // rounded lat/lon (not the raw floats) so two callers for "the same place"
  // reliably share one cache entry instead of missing on float noise.
  const _weatherCache = new Map(); // "lat,lon" -> { data, at }
  const WEATHER_CACHE_MS = 5 * 60 * 1000;
  async function getWeatherResolved(lat, lon) {
    // lat/lon arrive as strings from every real caller (Express req.query,
    // the SQLite settings fallback) — coerced to real numbers once here so
    // every downstream function can rely on that without each having to
    // defensively re-coerce itself. getWeatherNWS() already knew to guard
    // against this (`(+lat).toFixed(4)`); reconcileWeatherToday()'s
    // trackTodayExtreme() did NOT, and its plain `lat.toFixed(2)` threw
    // immediately on a string — a real, confirmed bug that silently broke
    // weather for every widget (see beta.6 HANDOFF entry for the full
    // failure chain).
    lat = Number(lat);
    lon = Number(lon);
    const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = _weatherCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < WEATHER_CACHE_MS) return cached.data;

    const provider = getSetting('weather_provider') || 'open-meteo';
    const apiKey = getSetting('weather_api_key') || '';
    let w;
    if (provider === 'openweathermap' && apiKey) {
      try { w = await getWeatherOWM(lat, lon, apiKey); }
      catch (e) { console.warn('OWM failed, using Open-Meteo:', e.message); w = await getWeather(lat, lon); }
    } else if (provider === 'nws') {
      try { w = await getWeatherNWS(lat, lon); }
      catch (e) { console.warn('NWS failed, using Open-Meteo:', e.message); w = await getWeather(lat, lon); }
    } else {
      w = await getWeather(lat, lon);
    }
    const resolved = reconcileWeatherToday(w, lat, lon);
    _weatherCache.set(cacheKey, { data: resolved, at: Date.now() });
    return resolved;
  }
  return { reconcileWeatherToday, getWeatherResolved };
};
