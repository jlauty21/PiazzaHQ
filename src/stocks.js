'use strict';
// Stocks and indices quotes.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by (network).
module.exports = function registerStocks({ fetchWithTimeout, app, db }) {
  // Stooq's quote endpoint accepts comma-separated symbols in a single request and
  // Stock/index quotes via Finnhub (https://finnhub.io) — free tier, 60 requests/min,
  // no credit card required. Requires the user's own API key (Settings > Stocks),
  // since Finnhub is per-account rather than fully anonymous.
  //
  // Switched from Stooq in mid-2026 after Stooq's quote endpoint started returning
  // "page does not exist" for programmatic requests — Stooq disabled automated/CAPTCHA-free
  // access back in Dec 2020 and was never a reliable foundation.
  //
  // Briefly tried Finnhub with index-tracking ETFs (DIA/QQQ/SPY) as a stand-in for the
  // real indices, since free tiers don't offer raw index data — but the ETF share price
  // doesn't resemble the real index value (e.g. DIA trades around $515, not "51,564"),
  // which looked broken even though the percent-change was a reasonable approximation.
  //
  // Now using Yahoo Finance's unofficial chart endpoint instead, which DOES return the
  // real index values (^DJI, ^IXIC, ^GSPC) for free with no API key or signup at all.
  // This is genuinely unofficial — Yahoo doesn't publish or support it, reverse-engineered
  // by the community, and it CAN change or break without notice (it already has at least
  // once, per public module changelogs). Accepting that risk in exchange for real numbers
  // and zero setup. If Yahoo breaks this again in the future, that's the next thing to fix.
  let stockCache = { quotes: [], fetchedAt: 0, cacheKey: '' };
  const STOCK_CACHE_MS = 5 * 60 * 1000; // 5 minutes — markets move faster than news, but no need for real-time on a wall display

  const STOCK_INDICES = [
    { symbol: '^DJI',  label: 'Dow Jones' },
    { symbol: '^IXIC', label: 'Nasdaq' },
    { symbol: '^GSPC', label: 'S&P 500' },
  ];

  // Yahoo's endpoint rejects non-browser User-Agents, so this uses its own fetch
  // (rather than the shared fetchUrl helper, which sends a generic UA fine for
  // every other source we talk to) to avoid touching code other features depend on.
  // Real bug fixed here in the same pass as the fetch() migration: this never
  // had a timeout at all (unlike every other fetcher in this file) — a stalled
  // Yahoo connection hung the stocks widget forever instead of just failing.
  // Redirects are handled by fetch() itself now too.
  async function fetchYahooUrl(urlStr) {
    const res = await fetchWithTimeout(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      timeoutMs: 10000,
      timeoutMessage: 'Timed out fetching from Yahoo Finance',
    });
    const body = await res.text();
    return { status: res.status, body };
  }

  async function fetchYahooQuote(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const { status, body } = await fetchYahooUrl(url);
    if (status !== 200) {
      throw new Error(`Yahoo Finance returned an error (HTTP ${status}) — it may be temporarily unavailable.`);
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error('Yahoo Finance returned an unexpected response — the unofficial endpoint may have changed.');
    }
    const result = data?.chart?.result?.[0];
    if (!result || !result.meta || typeof result.meta.regularMarketPrice !== 'number') {
      return null; // unrecognized symbol or no data for it
    }
    const close = result.meta.regularMarketPrice;
    const prevClose = result.meta.chartPreviousClose ?? result.meta.previousClose;
    const change = (typeof prevClose === 'number') ? close - prevClose : null;
    const changePct = (typeof prevClose === 'number' && prevClose !== 0) ? (change / prevClose) * 100 : null;
    return { close, open: prevClose ?? null, change, changePct };
  }

  // customTickers: the UNION of every Stock widget's own `stockTickers` list,
  // passed in per-request from the client (see fetchStocks() in display.html/
  // app.html) — tracking individual tickers moved from being one device-wide
  // Data Sources setting to a per-widget Stock widget setting in v1.77.77, so
  // there's no longer a single "the" ticker list to read from the DB. `null`
  // means the request didn't specify any (an older, not-yet-updated client),
  // in which case we fall back to the old DB value so that client doesn't
  // regress to seeing zero custom tickers mid-rollout across a multi-device
  // household.
  // The union of every Stock widget's own `stockTickers` across every display's
  // layout (both orientations) — used by the Daily Briefing email, which has no
  // single widget to ask (it's one device-wide digest, not tied to a display).
  // Falls back to the legacy DB-wide list only if genuinely no widget anywhere
  // defines its own list yet (pre-migration, or no Stock widget in use at all).
  function getAllStockTickersFromLayouts() {
    const rows = db.prepare(`SELECT widgets FROM layouts`).all();
    const set = new Set();
    let sawAnyStockWidget = false;
    for (const row of rows) {
      let widgets;
      try { widgets = JSON.parse(row.widgets); } catch { continue; }
      if (!Array.isArray(widgets)) continue;
      for (const w of widgets) {
        if (w && w.type === 'stocks') {
          sawAnyStockWidget = true;
          (Array.isArray(w.stockTickers) ? w.stockTickers : []).forEach(t => {
            if (t) set.add(String(t).trim().toUpperCase());
          });
        }
      }
    }
    if (!sawAnyStockWidget) return null; // no Stock widget anywhere yet — let getStocks() fall back to the legacy DB value
    return [...set];
  }

  async function getStocks(customTickers) {
    if (customTickers === null) {
      const row = db.prepare(`SELECT value FROM settings WHERE key = 'stock_tickers'`).get();
      customTickers = (row?.value || '').split(',').map(t => t.trim()).filter(Boolean);
    }
    // Indices the user has unchecked (e.g. "^DJI") are excluded entirely.
    const disabledRow = db.prepare(`SELECT value FROM settings WHERE key = 'stock_indices_disabled'`).get();
    const disabled = new Set((disabledRow?.value || '').split(',').map(t => t.trim()).filter(Boolean));
    const activeIndices = STOCK_INDICES.filter(i => !disabled.has(i.symbol));

    const now = Date.now();
    const cacheKey = customTickers.join(',') + '|' + [...disabled].sort().join(',');
    if (stockCache.quotes.length && stockCache.cacheKey === cacheKey && (now - stockCache.fetchedAt) < STOCK_CACHE_MS) {
      return { quotes: stockCache.quotes, cached: true };
    }

    const allSymbols = [
      ...activeIndices.map(i => ({ symbol: i.symbol, label: i.label, isIndex: true })),
      ...customTickers.map(t => {
        const symbol = t.toUpperCase();
        // Yahoo's crypto pairs are always "COIN-USD" (or -EUR etc.) — no equity ticker
        // uses a hyphen, so this is a reliable way to tell them apart for display styling.
        const isCrypto = /^[A-Z0-9]+-[A-Z]{3}$/.test(symbol);
        return { symbol, label: symbol.replace(/-[A-Z]{3}$/, ''), isIndex: false, isCrypto };
      }),
    ];

    try {
      // One request per symbol — Yahoo's chart endpoint doesn't offer a bulk-quote
      // call on the unofficial surface, but this is a handful of symbols refreshed
      // every 5 minutes, nowhere near anything that would trigger rate limiting.
      const quotes = [];
      for (const { symbol, label, isIndex, isCrypto } of allSymbols) {
        const q = await fetchYahooQuote(symbol);
        if (q) quotes.push({ ...q, symbol, label, isIndex, isCrypto: !!isCrypto });
      }
      if (!quotes.length) throw new Error('No quotes returned from Yahoo Finance — it may be temporarily unavailable.');
      stockCache = { quotes, fetchedAt: now, cacheKey };
      return { quotes, cached: false };
    } catch (e) {
      if (stockCache.quotes.length) {
        return { quotes: stockCache.quotes, cached: true, stale: true };
      }
      throw e;
    }
  }

  app.get('/api/stocks', async (req, res) => {
    try {
      // req.query.tickers, when present (even as ''), means the client already
      // knows per-widget tickers and is telling us the union explicitly — only
      // fall back to the legacy DB-wide list when the param is missing entirely.
      const customTickers = (req.query.tickers !== undefined)
        ? req.query.tickers.split(',').map(t => t.trim()).filter(Boolean)
        : null;
      res.json(await getStocks(customTickers));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Server-side mirror of reminderOccursOnDate() in display.html/app.html —
  // same two schedule types, same logic, kept in sync deliberately rather
  // than shared via a module, matching how this codebase already keeps
  // date-formatting helpers duplicated per file rather than centralized.
  // Needed here specifically for the Daily Briefing email, which has no
  // browser/client context to call into.
  return { getStocks, getAllStockTickersFromLayouts };
};
