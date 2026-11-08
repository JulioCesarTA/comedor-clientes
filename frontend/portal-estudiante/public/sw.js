// Service worker PWA — cache-first para shell y assets, network-first para API
const CACHE = 'comedor-portal-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API: network-first con fallback a cache
  if (url.pathname.startsWith('/menus') || url.pathname.startsWith('/estudiantes') || url.pathname.startsWith('/sagas')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Shell: cache-first
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
