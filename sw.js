// CAPS DI service worker: lets the app install and open offline.
// Pages and CAPS data: network first (so updates arrive), cached copy when offline.
// Plan generation (the Cloudflare Worker) is never cached.
const CACHE = 'capsdi-v11';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './data/caps-ehl.json',
  './data/pedagogy.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // plan requests (POST) always go to the network
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isIconFont = url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !isIconFont) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, {ignoreSearch: true}).then(hit => hit || caches.match('./index.html')))
  );
});
