// Service worker del back-office (PWA): la aplicación abre y funciona SIN internet.
//  · Al instalarse guarda la página y los archivos de la compilación (los saca del propio index.html).
//  · Páginas: red primero; sin red, la copia guardada (Angular se encarga de la ruta).
//  · Archivos de la app y librerías de CDN (Tailwind, fuentes, lector de QR): se sirven del caché y se renuevan por detrás.
//  · La API (/graphql en otro puerto) y Keycloak NUNCA pasan por aquí: los datos viven en IndexedDB y en la cola.
const CACHE = 'backoffice-v1';
const CDN = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  const base = ['/', '/index.html', '/manifest.webmanifest', '/iconos/icono-192.png', '/iconos/icono-512.png'];
  await c.addAll(base);
  try {                                   // los .js/.css con hash que pide el index.html
    const html = await (await fetch('/index.html', { cache: 'no-store' })).text();
    const archivos = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]).filter((u) => !u.startsWith('http'));
    await c.addAll(archivos.map((u) => (u.startsWith('/') ? u : '/' + u)));
  } catch { /* se guardarán al usarse */ }
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

async function delCacheYRenovar(req) {
  const c = await caches.open(CACHE);
  const guardada = await c.match(req);
  const red = fetch(req).then((r) => {
    if (r.ok || r.type === 'opaque') { const copia = r.clone(); c.put(req, copia); }
    return r;
  }).catch(() => guardada);
  return guardada || red;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put('/index.html', copia)); }
      return r;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  if (url.origin === self.location.origin || CDN.includes(url.hostname)) e.respondWith(delCacheYRenovar(req));
});
