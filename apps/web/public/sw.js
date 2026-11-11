/* Service worker: one job — show a friendly offline page when a page navigation fails because there is no network.
 * It deliberately caches NOTHING else: signed-in pages, fees, results and API calls always come from the network, so one person's data can
 * never be served to another from a shared cache, and nothing goes stale. */
const OFFLINE = '/offline.html';
const CACHE = 'offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // everything that is not a page load goes straight to the network
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
