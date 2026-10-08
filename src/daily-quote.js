'use strict';
// Daily quote (ZenQuotes).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/data-feeds-offline.test.js.
module.exports = function registerDailyQuote({ app, localDateStr, fetchJsonWithUA }) {
  let dailyQuoteCache = { dateKey: null, data: null };
  app.get('/api/daily-quote', async (req, res) => {
    const dateKey = localDateStr();
    if (dailyQuoteCache.dateKey === dateKey && dailyQuoteCache.data) {
      return res.json(dailyQuoteCache.data);
    }
    try {
      const raw = await fetchJsonWithUA('https://zenquotes.io/api/today');
      const item = Array.isArray(raw) ? raw[0] : null;
      if (!item || !item.q) throw new Error('Unexpected response shape');
      const payload = { quote: item.q, author: item.a || 'Unknown' };
      dailyQuoteCache = { dateKey, data: payload };
      res.json(payload);
    } catch (e) {
      if (dailyQuoteCache.data) return res.json({ ...dailyQuoteCache.data, stale: true });
      res.status(500).json({ error: 'Could not reach quote service — ' + e.message });
    }
  });
};
