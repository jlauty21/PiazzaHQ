'use strict';
// Weather providers: Open-Meteo (default), OpenWeatherMap and the US National Weather Service, normalised to one shape, plus the weather-code descriptions and the email temperature helpers.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/weather-extras.test.js and test/unit/weather-pure.test.js.
module.exports = function registerWeatherProviders({ fetchWithTimeout, getSetting }) {
  // Short WMO weather-code descriptions for the email (display.html has its own copy).
  const WMO_DESC = {
    0:'Clear', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
    45:'Fog', 48:'Rime fog', 51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
    56:'Freezing drizzle', 57:'Freezing drizzle', 61:'Light rain', 63:'Rain', 65:'Heavy rain',
    66:'Freezing rain', 67:'Freezing rain', 71:'Light snow', 73:'Snow', 75:'Heavy snow',
    77:'Snow grains', 80:'Light showers', 81:'Showers', 82:'Heavy showers',
    85:'Snow showers', 86:'Snow showers', 95:'Thunderstorm', 96:'Thunderstorm', 99:'Thunderstorm',
  };

  // Weather is always fetched and cached in Fahrenheit — Fahrenheit/Celsius is
  // a display-time choice everywhere it's shown, including here in the daily
  // briefing email, so this mirrors display.html's own formatTemp() exactly
  // rather than re-fetching from Open-Meteo per unit. Returns a bare "NN°"
  // (no unit letter) to match the email's existing styling, which states the
  // unit once at the headline rather than repeating it on every value.
  function emailFormatTemp(fahrenheit) {
    if (fahrenheit == null || isNaN(fahrenheit)) return '--';
    const unit = getSetting('weather_unit');
    const val = unit === 'celsius' ? (fahrenheit - 32) * 5 / 9 : fahrenheit;
    return `${Math.round(val)}°`;
  }
  function emailTempUnitLabel() {
    return getSetting('weather_unit') === 'celsius' ? 'C' : 'F';
  }
  // PIAZZA_OPENMETEO_URL overrides the base (tests only; unset in prod).
  const OPENMETEO_BASE = process.env.PIAZZA_OPENMETEO_URL || 'https://api.open-meteo.com';
  async function getWeather(lat, lon) {
    // apparent_temperature/relative_humidity_2m/wind_gusts_10m ride the same
    // current/hourly call as everything else — no extra request. UV index
    // isn't a valid `current` variable on this API, only `hourly`/`daily`;
    // reconcileWeatherToday() below picks the closest-to-now hourly value
    // into current.uv_index so every provider ends up with the same shape.
    const url = `${OPENMETEO_BASE}/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,apparent_temperature,relative_humidity_2m,is_day` +
      `&hourly=temperature_2m,weather_code,precipitation_probability,apparent_temperature,uv_index,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=16&timezone=auto`;
    // See fetchWithTimeout's comment above for why this matters — a stalled
    // (not outright failed) request would otherwise hang forever with no
    // error, same bug class, same fix.
    const res = await fetchWithTimeout(url, { timeoutMs: 10000, timeoutMessage: 'Timed out fetching Open-Meteo weather' });
    try { return await res.json(); }
    catch { throw new Error('Failed to parse weather data'); }
  }

  // Maps an OpenWeatherMap condition id (https://openweathermap.org/weather-conditions)
  // to the WMO weather code our icons/descriptions use, so OWM data renders identically
  // to Open-Meteo data downstream.
  function owmToWmo(id) {
    if (id >= 200 && id < 300) return 95;            // thunderstorm
    if (id >= 300 && id < 400) return 51;            // drizzle
    if (id >= 500 && id < 505) return 61;            // rain
    if (id === 511) return 67;                       // freezing rain
    if (id >= 520 && id < 532) return 80;            // rain showers
    if (id >= 600 && id < 700) return 71;            // snow
    if (id >= 700 && id < 800) return 45;            // atmosphere (fog/mist)
    if (id === 800) return 0;                        // clear
    if (id === 801) return 1;                        // mainly clear
    if (id === 802) return 2;                        // partly cloudy
    if (id >= 803) return 3;                         // overcast
    return 3;
  }
  // Fetches from OpenWeatherMap (One Call 3.0) and normalizes to the Open-Meteo shape
  // the rest of the app expects. Requires the user's own API key.
  async function getWeatherOWM(lat, lon, apiKey) {
    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}` +
      `&units=imperial&exclude=minutely,alerts&appid=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(url, { timeoutMs: 10000, timeoutMessage: 'Timed out fetching OpenWeatherMap weather' });
    let j;
    try { j = await res.json(); }
    catch { throw new Error('Failed to parse OpenWeatherMap data'); }
    if (j.cod && String(j.cod) !== '200') throw new Error(j.message || 'OpenWeatherMap error');
    const cur = j.current || {};
    const hours = (j.hourly || []).slice(0, 48);
    const days = (j.daily || []).slice(0, 16);
    const iso = t => new Date(t * 1000).toISOString().slice(0, 16);
    const isoDate = t => new Date(t * 1000).toISOString().slice(0, 10);
    return {
      current: {
        temperature_2m: cur.temp,
        weather_code: owmToWmo(cur.weather?.[0]?.id ?? 800),
        wind_speed_10m: cur.wind_speed,
        wind_gusts_10m: cur.wind_gust,
        apparent_temperature: cur.feels_like,
        relative_humidity_2m: cur.humidity,
        uv_index: cur.uvi,
        is_day: (cur.dt >= cur.sunrise && cur.dt < cur.sunset) ? 1 : 0,
      },
      hourly: {
        time: hours.map(h => iso(h.dt)),
        temperature_2m: hours.map(h => h.temp),
        weather_code: hours.map(h => owmToWmo(h.weather?.[0]?.id ?? 800)),
        precipitation_probability: hours.map(h => Math.round((h.pop || 0) * 100)),
        apparent_temperature: hours.map(h => h.feels_like),
        uv_index: hours.map(h => h.uvi),
        is_day: hours.map(h => (h.dt >= (j.current?.sunrise||0) && h.dt < (j.current?.sunset||0)) ? 1 : 0),
      },
      daily: {
        time: days.map(d => isoDate(d.dt)),
        weather_code: days.map(d => owmToWmo(d.weather?.[0]?.id ?? 800)),
        temperature_2m_max: days.map(d => d.temp?.max),
        temperature_2m_min: days.map(d => d.temp?.min),
        precipitation_probability_max: days.map(d => Math.round((d.pop || 0) * 100)),
        sunrise: days.map(d => iso(d.sunrise)),
        sunset: days.map(d => iso(d.sunset)),
      },
      _provider: 'openweathermap',
    };
  }

  // Provider-aware weather fetch used by both the API and the email briefing, so they
  // Maps a National Weather Service short forecast text (e.g. "Partly Sunny",
  // "Chance Showers And Thunderstorms") to our WMO code. NWS uses prose, not codes,
  // so we keyword-match — ordered from most to least specific.
  function nwsTextToWmo(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('thunder')) return 95;
    if (t.includes('freezing')) return 67;
    if (t.includes('sleet') || t.includes('ice')) return 67;
    if (t.includes('snow') || t.includes('flurr') || t.includes('blizzard')) return 71;
    if (t.includes('showers') || t.includes('rain shower')) return 80;
    if (t.includes('rain') || t.includes('drizzle')) return 61;
    if (t.includes('fog') || t.includes('haze') || t.includes('mist')) return 45;
    if (t.includes('partly') || t.includes('mostly sunny') || t.includes('mostly clear')) return 2;
    if (t.includes('mostly cloudy') || t.includes('considerable cloud')) return 3;
    if (t.includes('cloud')) return 3;
    if (t.includes('sunny') || t.includes('clear') || t.includes('fair')) return 0;
    return 2;
  }
  // Small JSON GET helper that sends the User-Agent NWS requires.
  // Real, confirmed bug fixed here: without an explicit timeout, a request
  // that stalls (NWS's servers momentarily hanging, a network blip — anything
  // short of an outright connection error) never resolves AND never rejects.
  // No error, no console output, nothing — https.get()'s own 'error' event
  // only fires for actual connection failures, not for a server that accepted
  // the connection and then just never finishes responding. That leaves every
  // weather widget across every device permanently stuck on "Loading
  // weather…" until the server process itself is restarted, since nothing
  // ever times out to let the normal per-poll retry take over.
  // fetch() follows redirects on its own, so this no longer needs to recurse.
  async function httpGetJSON(url, timeoutMs = 10000) {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'PiazzaHQ/1.0 (family calendar display)', 'Accept': 'application/geo+json' },
      timeoutMs,
    });
    try { return await res.json(); }
    catch { throw new Error('Bad JSON from ' + url); }
  }
  // Fetches from the US National Weather Service (weather.gov) and normalizes to the
  // Open-Meteo shape. Keyless, but US-only. Two-step: points -> gridpoint forecast.
  async function getWeatherNWS(lat, lon) {
    const pts = await httpGetJSON(`https://api.weather.gov/points/${(+lat).toFixed(4)},${(+lon).toFixed(4)}`);
    const props = pts && pts.properties;
    if (!props || !props.forecast) throw new Error('NWS: no forecast for this location (US-only)');

    const [daily, hourly] = await Promise.all([
      httpGetJSON(props.forecast),
      httpGetJSON(props.forecastHourly).catch(() => null),
    ]);
    const periods = (daily.properties && daily.properties.periods) || [];
    if (!periods.length) throw new Error('NWS: empty forecast');

    // Current conditions: first hourly period if available, else first daily period.
    const hp = hourly && hourly.properties && hourly.properties.periods || [];
    const nowP = hp[0] || periods[0];
    const current = {
      temperature_2m: nowP.temperature,
      weather_code: nwsTextToWmo(nowP.shortForecast),
      wind_speed_10m: parseInt((nowP.windSpeed || '0').replace(/[^0-9]/g, '')) || 0,
      is_day: nowP.isDaytime ? 1 : 0,
    };
    // Hourly arrays (next 48h) for the hourly widget.
    const hSlice = hp.slice(0, 48);
    const hourlyOut = {
      time: hSlice.map(p => (p.startTime || '').slice(0, 16)),
      temperature_2m: hSlice.map(p => p.temperature),
      weather_code: hSlice.map(p => nwsTextToWmo(p.shortForecast)),
      precipitation_probability: hSlice.map(p => (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value) || 0),
      is_day: hSlice.map(p => p.isDaytime ? 1 : 0),
    };
    // Daily: NWS splits into day & night periods. Fold into per-date hi/lo.
    const byDate = {};
    for (const p of periods) {
      const date = (p.startTime || '').slice(0, 10);
      if (!byDate[date]) byDate[date] = { code: nwsTextToWmo(p.shortForecast), hi: null, lo: null, pop: 0 };
      const temp = p.temperature;
      if (p.isDaytime) { byDate[date].hi = temp; byDate[date].code = nwsTextToWmo(p.shortForecast); }
      else { byDate[date].lo = temp; }
      const pop = (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value) || 0;
      if (pop > byDate[date].pop) byDate[date].pop = pop;
    }
    const dates = Object.keys(byDate).sort();
    // Today's bucket is the one date where hi or lo can legitimately be missing
    // — not because the data doesn't exist, but because NWS periods are
    // forward-looking from "now": once "Today" has elapsed, only "Tonight"
    // remains for today's date (hi stays null); early in the morning, before
    // "Tonight" has arrived yet, only "Today" exists (lo stays null). The
    // naive fallback above (used for every other, fully-populated future date)
    // collapses hi and lo to that single remaining value, contradicting the
    // live current reading — e.g. showing today's high as tonight's 75° low
    // while current conditions read 96°. Correct today's bucket using the
    // current reading itself, which is real evidence of at least that
    // temperature having actually occurred today.
    const todayDate = dates[0];
    if (todayDate && byDate[todayDate]) {
      const t = byDate[todayDate];
      if (t.hi == null && t.lo != null) t.hi = Math.max(t.lo, current.temperature_2m);
      else if (t.lo == null && t.hi != null) t.lo = Math.min(t.hi, current.temperature_2m);
    }
    const dailyOut = {
      time: dates,
      weather_code: dates.map(d => byDate[d].code),
      temperature_2m_max: dates.map(d => byDate[d].hi != null ? byDate[d].hi : byDate[d].lo),
      temperature_2m_min: dates.map(d => byDate[d].lo != null ? byDate[d].lo : byDate[d].hi),
      precipitation_probability_max: dates.map(d => byDate[d].pop),
      sunrise: dates.map(() => ''), // NWS doesn't provide sunrise/sunset here
      sunset: dates.map(() => ''),
    };
    return { current, hourly: hourlyOut, daily: dailyOut, _provider: 'nws' };
  }
  return { WMO_DESC, emailFormatTemp, emailTempUnitLabel, getWeather, getWeatherOWM, httpGetJSON, getWeatherNWS };
};
