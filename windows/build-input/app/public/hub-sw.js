// Family Hub service worker — app-shell caching only. The goal is that the
// Hub's own UI (this shell: hub.html, the Chores page it embeds, icons, the
// manifest) loads instantly even on a flaky connection, not that any actual
// data works offline — chores and to-dos always need a live request, so
// /api/* is deliberately never touched here and always goes straight to the
// network.
//
// Bump this on any shell change so returning devices pick up the new files
// instead of a stale cached shell.
const CACHE_NAME = 'family-hub-shell-v2';
// Genuinely static — icons and the manifest don't change between app updates,
// so cache-first (instant, no network wait at all) has no real correctness
// downside for these.
const STATIC_SHELL_URLS = [
  '/manifest.json',
  '/icons/hub-192.png',
  '/icons/hub-512.png',
  '/icons/hub-512-maskable.png',
  '/icons/hub-apple-touch.png',
];
// /hub and /kids are the ACTIVE APPLICATION pages — their JS changes with
// every app update, same as anything else in the app. This used to be
// stale-while-revalidate here too, which was a real bug: that strategy
// ALWAYS answers the CURRENT load from whatever's already cached, and only
// fetches a fresh copy in the background for NEXT time — meaning a device
// that had cached an old, buggy version kept serving that exact old version
// forever, on every single load, regardless of how many times the app
// itself got updated server-side. Especially bad for the Hub specifically,
// since it's meant to be installed as a home-screen PWA, which rarely gets
// the kind of hard refresh that would otherwise paper over this. These now
// go network-first instead — try the network, and only fall back to
// whatever's cached if genuinely offline.
const NETWORK_FIRST_URLS = ['/hub', '/kids'];
const SHELL_URLS = [...STATIC_SHELL_URLS, ...NETWORK_FIRST_URLS];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls, the live SSE stream, or anything cross-origin —
  // those must always hit the network live.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;
  if (!SHELL_URLS.includes(url.pathname)) return;

  if (NETWORK_FIRST_URLS.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(event.request))) // offline -> best-effort fallback to whatever's cached
    );
    return;
  }

  // Stale-while-revalidate for the genuinely static assets only: answer
  // instantly from cache if we have it, and in the background fetch a fresh
  // copy for next time.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((res) => { if (res && res.ok) cache.put(event.request, res.clone()); return res; })
          .catch(() => cached); // offline and nothing cached yet -> whatever cached gives us (possibly undefined)
        return cached || networkFetch;
      })
    )
  );
});
