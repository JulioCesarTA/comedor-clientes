// Service worker del shell (PWA): la plataforma abre SIN internet, con el portal incluido.
//  · Páginas: red primero; sin red, la copia guardada (React Router se encarga de la ruta).
//  · remoteEntry.js del portal: red primero, porque cambia en cada despliegue.
//  · Demás archivos (propios, del portal y de CDN): del caché, y se renuevan por detrás.
//  · La API y Keycloak NUNCA pasan por aquí. Backoffice y BI tienen su propio service worker.
const CACHE = 'shell-v1';

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await c.addAll(['/', '/index.html', '/manifest.webmanifest', '/iconos/icono-192.png', '/iconos/icono-512.png']);
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

async function redPrimero(req, respaldo) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (r.ok) await c.put(respaldo || req, r.clone());
    return r;
  } catch {
    return (await c.match(respaldo || req)) || Response.error();
  }
}

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
    if (propio) e.respondWith(redPrimero(req, '/index.html'));
    return;
  }
  if (url.pathname.endsWith('/remoteEntry.js')) { e.respondWith(redPrimero(req)); return; }
  if (propio || ['script', 'style', 'font', 'image'].includes(req.destination)) e.respondWith(delCacheYRenovar(req));
});
