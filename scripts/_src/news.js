'use strict';
// News (Google News RSS, no key): the headline feed and its source selection.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by (network).
module.exports = function registerNews({ app, db, fetchUrl }) {
  // Cached in-memory since Google may rate-limit/block frequent polling; the display
  // only needs a refresh every 15-30 minutes anyway for a headline ticker. The cache
  // is keyed on the source configuration so changing sources refetches immediately.
  let newsCache = { items: [], fetchedAt: 0, key: '' };
  const NEWS_CACHE_MS = 15 * 60 * 1000; // 15 minutes
  const NEWS_LOCALE = 'hl=en-US&gl=US&ceid=US:en';

  function parseNewsRSS(xml) {
    const items = [];
    const itemBlocks = xml.split('<item>').slice(1);
    for (const block of itemBlocks) {
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      if (!titleMatch) continue;

      let title = titleMatch[1].trim();
      // Decode common XML/HTML entities and strip CDATA wrappers
      title = title.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
      title = title.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
                   .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

      let link = linkMatch ? linkMatch[1].trim() : '';
      link = link.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');

      // Google News RSS titles are usually "Headline - Source Name"; split it apart
      // since we already get the source separately and don't want it duplicated.
      let source = sourceMatch ? sourceMatch[1].trim() : '';
      if (!source && title.includes(' - ')) {
        const parts = title.split(' - ');
        source = parts[parts.length - 1].trim();
        title = parts.slice(0, -1).join(' - ').trim();
      }

      items.push({
        title,
        source,
        link,
        pubDate: pubDateMatch ? pubDateMatch[1].trim() : null,
      });
    }
    return items;
  }

  // Reads the configured news sources from settings and returns a list of
  // { url, label, priority } source descriptors to fetch.
  function getNewsSources() {
    const get = (k) => (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value ?? '');
    const on = (k) => get(k) === '1';
    const sources = [];

    if (on('news_world_enabled')) {
      // Google News "World" topic feed.
      sources.push({
        url: `https://news.google.com/rss/headlines/section/topic/WORLD?${NEWS_LOCALE}`,
        label: 'World',
        priority: on('news_world_priority'),
      });
    }

    if (on('news_national_enabled')) {
      sources.push({
        url: `https://news.google.com/rss?${NEWS_LOCALE}`,
        label: 'National',
        priority: on('news_national_priority'),
      });
    }

    if (on('news_local_enabled')) {
      const loc = get('news_local_location').trim();
      if (loc) {
        // Search feed is more reliable for arbitrary place names than the geo section feed.
        sources.push({
          url: `https://news.google.com/rss/search?q=${encodeURIComponent(loc)}&${NEWS_LOCALE}`,
          label: loc,
          priority: on('news_local_priority'),
        });
      }
    }

    if (on('news_keywords_enabled')) {
      const kw = get('news_keywords').trim();
      if (kw) {
        // Each comma-separated term becomes its own labeled group, labeled with the term itself.
        const priority = on('news_keywords_priority');
        for (const term of kw.split(',').map(t => t.trim()).filter(Boolean)) {
          sources.push({
            url: `https://news.google.com/rss/search?q=${encodeURIComponent(term)}&${NEWS_LOCALE}`,
            label: term,
            priority,
          });
        }
      }
    }

    return sources;
  }

  // Interleaves headlines from multiple sources, giving priority sources their
  // reserved slots first so they can't be crowded out, then filling the rest
  // round-robin from all sources. `limit` caps the total (a generous superset of
  // what any widget will display; the widget applies its own max).
  function assembleNews(perSource, limit) {
    const result = [];
    const seen = new Set();
    const pushUnique = (item) => {
      const k = item.link || item.title;
      if (seen.has(k)) return false;
      seen.add(k);
      result.push(item);
      return true;
    };

    // 1) Reserve slots for priority sources first. Give each priority source a fair
    //    guaranteed share of the limit before non-priority sources get any room.
    const priority = perSource.filter(s => s.priority && s.items.length);
    if (priority.length) {
      const reservePerSource = Math.max(1, Math.floor((limit * 0.6) / priority.length));
      for (const s of priority) {
        for (let i = 0; i < reservePerSource && i < s.items.length; i++) {
          if (result.length >= limit) break;
          pushUnique(s.items[i]);
        }
        s._taken = Math.min(reservePerSource, s.items.length);
      }
    }

    // 2) Fill remaining slots round-robin across ALL enabled sources (priority first
    //    in ordering, continuing past whatever was already reserved).
    const ordered = [...perSource].sort((a, b) => (b.priority === a.priority ? 0 : b.priority ? 1 : -1));
    let added = true;
    let round = 0;
    while (result.length < limit && added) {
      added = false;
      for (const s of ordered) {
        const start = s._taken || 0;
        const idx = start + round;
        if (idx < s.items.length) {
          if (pushUnique(s.items[idx])) added = true;
          if (result.length >= limit) break;
        }
      }
      round++;
    }
    return result;
  }

  async function getNews() {
    const now = Date.now();
    const sources = getNewsSources();

    // Fall back to National if somehow nothing is enabled, so the widget is never empty.
    if (!sources.length) {
      sources.push({ url: `https://news.google.com/rss?${NEWS_LOCALE}`, label: 'National', priority: false });
    }

    const cacheKey = JSON.stringify(sources.map(s => [s.url, s.label, s.priority]));
    if (newsCache.items.length && newsCache.key === cacheKey && (now - newsCache.fetchedAt) < NEWS_CACHE_MS) {
      return { items: newsCache.items, cached: true };
    }

    try {
      // Fetch all sources in parallel; tolerate individual source failures.
      const perSource = await Promise.all(sources.map(async (s) => {
        try {
          const xml = await fetchUrl(s.url);
          const items = parseNewsRSS(xml).slice(0, 15).map(it => ({ ...it, group: s.label }));
          return { ...s, items };
        } catch {
          return { ...s, items: [] };
        }
      }));

      const items = assembleNews(perSource, 25);
      if (!items.length) throw new Error('No headlines returned from any source');
      newsCache = { items, fetchedAt: now, key: cacheKey };
      return { items, cached: false };
    } catch (e) {
      if (newsCache.items.length) {
        return { items: newsCache.items, cached: true, stale: true };
      }
      throw e;
    }
  }

  app.get('/api/news', async (req, res) => {
    try {
      res.json(await getNews());
    } catch (e) {
      res.status(500).json({ error: 'Could not fetch news: ' + e.message });
    }
  });
  return { getNews, parseNewsRSS };
};
