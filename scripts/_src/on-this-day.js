'use strict';
// On This Day (Wikipedia): the day's events, sampled, plus the shared fetchJsonWithUA helper.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/data-feeds-offline.test.js.
module.exports = function registerOnThisDay({ fetchWithTimeout, app, appNow, localDateStr }) {
  // Cached once per calendar day (local date) since the content is the same all day.
  let onThisDayCache = { dateKey: null, data: null };
  async function fetchJsonWithUA(url) {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'PiazzaHQApp/1.0 (self-hosted family wall display; contact via project repo)' },
      timeoutMs: 10000,
      timeoutMessage: 'Timed out fetching from Wikipedia',
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new Error('Failed to parse response'); }
  }
  // Picks n random items from an array without mutating it (Fisher-Yates partial shuffle).
  function sampleRandom(arr, n) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0 && copy.length - i <= n; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(-n).reverse();
  }
  app.get('/api/on-this-day', async (req, res) => {
    const dateKey = localDateStr();
    if (onThisDayCache.dateKey === dateKey && onThisDayCache.data) {
      return res.json(onThisDayCache.data);
    }
    const { m, d } = appNow();
    const mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
    try {
      const raw = await fetchJsonWithUA(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
      const events = Array.isArray(raw.events) ? raw.events : [];
      // Sample a handful at random each day (rather than always the same first N)
      // so a family glancing at this daily sees variety, not the identical facts
      // every year on the same date.
      const picked = sampleRandom(events.filter(e => e.text && e.year), 6)
        .sort((a, b) => a.year - b.year)
        .map(e => ({ year: e.year, text: e.text }));
      const payload = { month: m, day: d, events: picked };
      onThisDayCache = { dateKey, data: payload };
      res.json(payload);
    } catch (e) {
      if (onThisDayCache.data) return res.json({ ...onThisDayCache.data, stale: true });
      res.status(500).json({ error: 'Could not reach Wikipedia — ' + e.message });
    }
  });
  return { fetchJsonWithUA };
};
