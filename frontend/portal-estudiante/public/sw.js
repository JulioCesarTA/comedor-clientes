// Service worker del portal cuando se abre solo, sin el shell (PWA).
//  · Páginas: red primero; sin red, la copia guardada.
//  · Archivos (propios y de CDN): del caché, y se renuevan por detrás.
//  · La API NUNCA pasa por aquí: los datos sin conexión los guarda la app en IndexedDB.
const CACHE = 'portal-v2';

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(['/', '/index.html', '/manifest.json', '/iconos/icono-192.png', '/iconos/icono-512.png']);
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// La página avisa qué archivos cargó antes de que este service worker tomara el control.
self.addEventListener('message', (e) => {
  if (e.data?.tipo !== 'guardar') return;
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(e.data.urls.map(async (u) => {
    try {
      if (await c.match(u)) return;
      const r = await fetch(u, { mode: 'cors' }).catch(() => fetch(u, { mode: 'no-cors' }));
      if (r.ok || r.type === 'opaque') await c.put(u, r);
    } catch { /* se guardará al usarse */ }
  }))));
});

async function delCacheYRenovar(req) {
  const c = await caches.open(CACHE);
  const guardada = await c.match(req);
  const red = fetch(req).then((r) => {
    if (r.ok || r.type === 'opaque') c.put(req, r.clone());
    return r;
  }).catch(() => guardada || Response.error());
  return guardada || red;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const propio = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    if (propio) {
      e.respondWith(fetch(req).then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put('/index.html', copia)); }
        return r;
      }).catch(async () => (await caches.match('/index.html')) || Response.error()));
    }
    return;
  }
  if (propio || ['script', 'style', 'font', 'image'].includes(req.destination)) e.respondWith(delCacheYRenovar(req));
});
