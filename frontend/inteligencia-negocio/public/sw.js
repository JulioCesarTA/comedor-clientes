// Service worker del panel de BI: deja la pantalla de Reportes disponible SIN internet.
//  · Archivos de la app (/_next/static): se guardan al verlos y se sirven desde el equipo.
//  · Páginas: red primero; si no hay internet, la última copia vista.
//  · Datos y API (otro origen o /api): nunca se tocan aquí (los datos del comedor viven en IndexedDB, no en este caché).
const CACHE = 'bi-reportes-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {                       // archivos con hash: inmutables
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((ca) => ca.put(req, copia)); }
      return r;
    })));
    return;
  }

  e.respondWith(fetch(req).then((r) => {
    // no se guardan redirecciones (p. ej. al login) ni errores: así nunca se sirve una pantalla equivocada
    if (r.ok && !r.redirected && r.type === 'basic') { const copia = r.clone(); caches.open(CACHE).then((ca) => ca.put(req, copia)); }
    return r;
  }).catch(() => caches.match(req).then((c) => c || Response.error())));
});
