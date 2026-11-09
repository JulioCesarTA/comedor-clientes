// Service worker del panel de BI (PWA): todas las pantallas abren SIN internet.
//  · Archivos de la app (/_next/static): se guardan al verlos y se sirven desde el equipo.
//  · Páginas: red primero; si no hay internet, la última copia guardada.
//  · Con conexión, la app pide guardar todas las pantallas de una vez (mensaje «precargar»).
//  · Datos y API (otro origen o /api): nunca se tocan aquí (los datos viven en el navegador, no en este caché).
const CACHE = 'bi-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

// No se guardan redirecciones (p. ej. al login) ni errores: así nunca se sirve una pantalla equivocada.
const guardable = (r) => r.ok && !r.redirected && r.type === 'basic';

async function precargar(paginas) {
  const c = await caches.open(CACHE);
  const archivos = new Set();
  await Promise.all(paginas.map(async (p) => {
    try {
      const r = await fetch(p, { cache: 'no-store' });
      if (!guardable(r)) return;
      await c.put(p, r.clone());
      for (const m of (await r.text()).matchAll(/\/_next\/static\/[^"'\\\s]+\.(?:js|css|woff2)/g)) archivos.add(m[0]);
    } catch { /* sin conexión: se guardará al visitarla */ }
  }));
  await Promise.all([...archivos].map((a) => c.add(a).catch(() => {})));
}

self.addEventListener('message', (e) => {
  if (e.data?.tipo === 'precargar') e.waitUntil(precargar(e.data.paginas));
});

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

  // Lo que Next pide al cambiar de pantalla (?_rsc=) no es una página: sin red falla y Next navega a la página guardada.
  if (url.searchParams.has('_rsc')) return;

  e.respondWith(fetch(req).then((r) => {
    if (guardable(r)) { const copia = r.clone(); caches.open(CACHE).then((ca) => ca.put(url.pathname, copia)); }
    return r;
  }).catch(async () => {
    const opciones = { ignoreSearch: true, ignoreVary: true };      // ?embedded=1 no cambia la página
    return (await caches.match(url.pathname, opciones))
      || (req.mode === 'navigate' && await caches.match('/', opciones))
      || Response.error();
  }));
});
