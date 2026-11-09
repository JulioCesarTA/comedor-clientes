// Pruebas de «Desperdicio por foto»: análisis de la bandeja, lectura de la foto y cola de sincronización (sin teléfono ni red).
const test = require('node:test');
const assert = require('node:assert/strict');
const jpeg = require('jpeg-js');
const A = require('../src/vision/analisis');
const Cola = require('../src/vision/cola');
const { base64ABytes, decodificarJpegBase64 } = require('../src/vision/imagen');

// ----------------------------- imagen sintética + "mapa de la red" falso -----------------------------
const { LADO, REJ, CANAL, ZONAS } = A;

function foto(comidaZonas) {
  // plato gris liso con manchas de comida coloridas y con textura en las zonas pedidas
  const rgba = new Uint8Array(LADO * LADO * 4);
  for (let y = 0; y < LADO; y++) for (let x = 0; x < LADO; x++) {
    const z = Math.floor(y / 4) * REJ + Math.floor(x / 4), p = (y * LADO + x) * 4;
    if (comidaZonas.has(z)) {
      const ruido = ((x * 7 + y * 13) % 5) * 12;
      rgba[p] = 200 - ruido; rgba[p + 1] = 90 + ruido; rgba[p + 2] = 40;
    } else { rgba[p] = rgba[p + 1] = rgba[p + 2] = 225; }
    rgba[p + 3] = 255;
  }
  return rgba;
}

function mapa(comidaZonas) {                       // la "CNN": características distintas para comida y plato
  const m = new Float32Array(ZONAS * CANAL);
  for (let z = 0; z < ZONAS; z++) for (let c = 0; c < CANAL; c++) {
    const base = comidaZonas.has(z) ? (c % 3 === 0 ? 1 : 0.1) : (c % 3 === 1 ? 1 : 0.1);
    m[z * CANAL + c] = base + (((z * 31 + c * 17) % 11) / 11) * 0.05;
  }
  return m;
}

const bloque = (y0, x0, h, w) => { const s = new Set(); for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) s.add(y * REJ + x); return s; };

test('referencia y bandeja: lo que queda se mide contra la porción completa', () => {
  const completa = bloque(10, 10, 30, 30);                       // 900 zonas de comida
  const ref = A.crearReferencia(foto(completa), mapa(completa));
  assert.equal(ref.comida.length, 4); assert.equal(ref.fondo.length, 4); assert.equal(ref.comida[0].length, A.DIM);
  assert.ok(Math.abs(ref.fRef - 900 / ZONAS) < 0.03, `fRef ${ref.fRef}`);

  const mitad = bloque(10, 10, 30, 15);                          // se comió la mitad
  const r = A.analizarBandeja(foto(mitad), mapa(mitad), ref);
  assert.ok(Math.abs(r.restante - 50) < 6, `restante ${r.restante}`);
  assert.ok(Math.abs(r.restante + r.comido - 100) < 0.11);
  assert.ok(r.confianza > 0.5 && r.confianza <= 1);

  const vacia = new Set();                                       // plato limpio
  assert.ok(A.analizarBandeja(foto(vacia), mapa(vacia), ref).restante < 3);
  assert.ok(Math.abs(A.analizarBandeja(foto(completa), mapa(completa), ref).restante - 100) < 3);   // sin tocar
});

test('referencia: foto sin comida distinguible -> error claro, no un número inventado', () => {
  const nada = new Set();
  assert.throws(() => A.crearReferencia(foto(nada), mapa(nada)), /comida|foto/i);
});

test('los datos de entrada se validan', () => {
  assert.throws(() => A.descriptores(new Uint8Array(10), new Float32Array(ZONAS * CANAL)), /224/);
  assert.throws(() => A.descriptores(new Uint8Array(LADO * LADO * 4), new Float32Array(10)), /mapa/);
  const e = A.entradaRed(foto(new Set()));
  assert.equal(e.length, LADO * LADO * 3); assert.ok(e.every((v) => v >= -1 && v <= 1));
});

test('k-means es repetible (misma semilla, mismos prototipos)', () => {
  const n = 200, X = new Float64Array(n * A.DIM).map((_, i) => ((i * 2654435761) % 1000) / 1000);
  assert.deepEqual(A.prototipos(X, n, 4, 7), A.prototipos(X, n, 4, 7));
});

// ----------------------------- imagen -----------------------------

test('JPEG de 224x224 -> píxeles RGBA; otro tamaño se rechaza', () => {
  const datos = Buffer.alloc(LADO * LADO * 4, 255);
  for (let i = 0; i < LADO * LADO; i++) { datos[i * 4] = i % 256; datos[i * 4 + 1] = 100; datos[i * 4 + 2] = 50; }
  const b64 = jpeg.encode({ data: datos, width: LADO, height: LADO }, 95).data.toString('base64');
  assert.deepEqual([...base64ABytes(b64)], [...Buffer.from(b64, 'base64')]);
  assert.equal(decodificarJpegBase64(b64).rgba.length, LADO * LADO * 4);
  const chica = jpeg.encode({ data: Buffer.alloc(16 * 16 * 4, 255), width: 16, height: 16 }, 90).data.toString('base64');
  assert.throws(() => decodificarJpegBase64(chica), /224x224/);
});

// ----------------------------- cola de sincronización -----------------------------

function servidorFalso({ caeRed = false, rechazaRef = false, fallaS3 = false } = {}) {
  const s = { refs: new Map(), bandejas: new Map(), llamadas: [], fotos: [], caeRed };
  s.deps = {
    async pedir(metodo, ruta, cuerpo) {
      s.llamadas.push(`${metodo} ${ruta}`);
      if (s.caeRed) { const e = new Error('sin red'); e.red = true; throw e; }
      if (ruta === '/ml/vision/paquete-movil') return { estado: 200, json: { dim: A.DIM, referencias: [{ id: 'srv1', platoId: 'plato-asado', fecha: '2026-11-01', turno: 'ALMUERZO', fRef: 0.4, comida: [[0]], fondo: [[1]] }] } };
      if (ruta === '/ml/vision/subida') return fallaS3 ? { estado: 503, json: { detail: 'S3 no configurado' } } : { estado: 200, json: { url: `https://s3/x/${cuerpo.cliente_id}`, clave: `${cuerpo.tipo === 'ref' ? 'referencias' : 'bandejas'}/2026/11/${cuerpo.cliente_id}.jpg`, encabezados: {} } };
      if (ruta === '/ml/vision/referencia-movil') {
        if (rechazaRef) return { estado: 400, json: { detail: 'prototipos inválidos' } };
        if (!s.refs.has(cuerpo.cliente_id)) s.refs.set(cuerpo.cliente_id, { id: 'r' + s.refs.size, ...cuerpo });
        return { estado: 200, json: { id: s.refs.get(cuerpo.cliente_id).id } };
      }
      if (ruta === '/ml/vision/bandeja-movil') {
        const ok = [...s.refs.values()].some((r) => r.id === cuerpo.ref_id) || cuerpo.ref_id === 'srv1';
        if (!ok) return { estado: 404, json: { detail: 'La referencia no existe' } };
        if (!s.bandejas.has(cuerpo.cliente_id)) s.bandejas.set(cuerpo.cliente_id, { id: 'b' + s.bandejas.size, ...cuerpo });
        return { estado: 200, json: { id: s.bandejas.get(cuerpo.cliente_id).id } };
      }
      return { estado: 404, json: null };
    },
    async subirFoto(url) { s.fotos.push(url); return true; },
  };
  return s;
}

const refLocal = { clienteId: 'ref-local-0001', platoId: 'plato-locro', fecha: '2026-11-08', turno: 'ALMUERZO', fRef: 0.35, comida: [[0.1]], fondo: [[0.9]], fotoUri: 'file:///r.jpg' };
const bandejaDe = (refId, refEsLocal, n) => ({ clienteId: `ban-local-000${n}`, refId, refEsLocal, platoId: 'plato-locro', fecha: '2026-11-08', turno: 'ALMUERZO', restante: 20 + n, comido: 80 - n, confianza: 0.8, fotoUri: `file:///b${n}.jpg` });

test('cola: sin conexión nada se pierde; con conexión sale todo en orden y sin duplicar', async () => {
  let est = Cola.agregarReferencia(Cola.vacio(), refLocal);
  est = Cola.agregarBandeja(est, bandejaDe('ref-local-0001', true, 1));
  est = Cola.agregarBandeja(est, bandejaDe('ref-local-0001', true, 2));
  assert.equal(Cola.pendientes(est), 3);

  const caido = servidorFalso({ caeRed: true });
  const sinRed = await Cola.sincronizar(est, caido.deps);
  assert.equal(sinRed.resumen.sinRed, true);
  assert.equal(Cola.pendientes(sinRed.estado), 3, 'sin red no se pierde ni se marca nada');

  const srv = servidorFalso();
  const r1 = await Cola.sincronizar(sinRed.estado, srv.deps);
  assert.deepEqual([r1.resumen.referencias, r1.resumen.bandejas, r1.resumen.errores.length], [1, 2, 0]);
  assert.equal(Cola.pendientes(r1.estado), 0);
  assert.equal(srv.refs.size, 1); assert.equal(srv.bandejas.size, 2);
  const idRef = [...srv.refs.values()][0].id;
  assert.ok([...srv.bandejas.values()].every((b) => b.ref_id === idRef), 'la bandeja apunta al id de servidor de su referencia local');
  assert.equal(srv.fotos.length, 3);
  const orden = srv.llamadas.filter((l) => l.startsWith('POST') && l.includes('-movil'));
  assert.equal(orden[0], 'POST /ml/vision/referencia-movil', 'la referencia va antes que las bandejas');

  const antes = srv.llamadas.length;
  const r2 = await Cola.sincronizar(r1.estado, srv.deps);                   // sincronizar de nuevo: nada nuevo que enviar
  assert.deepEqual([r2.resumen.referencias, r2.resumen.bandejas], [0, 0]);
  assert.equal(srv.refs.size, 1); assert.equal(srv.bandejas.size, 2);
  assert.equal(srv.llamadas.slice(antes).filter((l) => l.startsWith('POST')).length, 0, 'no se vuelve a enviar nada');
});

test('cola: un reintento tras perder la respuesta no duplica (el servidor reconoce el clienteId)', async () => {
  const srv = servidorFalso();
  const est = Cola.agregarBandeja(Cola.vacio(), bandejaDe('srv1', false, 7));
  await Cola.sincronizar(est, srv.deps);
  await Cola.sincronizar(est, srv.deps);                                    // el teléfono no llegó a guardar «enviada»: reintenta con el mismo estado
  assert.equal(srv.bandejas.size, 1);
});

test('cola: referencia rechazada no se reintenta para siempre y arrastra a sus bandejas', async () => {
  let est = Cola.agregarReferencia(Cola.vacio(), refLocal);
  est = Cola.agregarBandeja(est, bandejaDe('ref-local-0001', true, 1));
  const srv = servidorFalso({ rechazaRef: true });
  const r = await Cola.sincronizar(est, srv.deps);
  assert.equal(r.estado.locales[0].rechazada, true);
  assert.equal(r.estado.bandejas[0].rechazada, true, 'la bandeja de una referencia rechazada también se descarta');
  assert.equal(r.resumen.errores.length, 2, 'ambas razones se informan al usuario');
  assert.equal(Cola.pendientes(r.estado), 0);
  const antes = srv.llamadas.length;
  await Cola.sincronizar(r.estado, srv.deps);
  assert.equal(srv.llamadas.slice(antes).filter((l) => l.startsWith('POST')).length, 0, 'no se reintenta lo rechazado');
});

test('cola: si S3 falla el resultado igual se envía (sin foto)', async () => {
  const srv = servidorFalso({ fallaS3: true });
  const r = await Cola.sincronizar(Cola.agregarBandeja(Cola.vacio(), bandejaDe('srv1', false, 3)), srv.deps);
  assert.equal(r.resumen.bandejas, 1);
  assert.equal([...srv.bandejas.values()][0].foto_key, null);
  assert.equal(srv.fotos.length, 0);
});

test('cola: las referencias del servidor llegan en el paquete y se mezclan con las del teléfono', async () => {
  let est = Cola.agregarReferencia(Cola.vacio(), refLocal);
  const r = await Cola.sincronizar(est, servidorFalso().deps);
  const usables = Cola.referenciasUsables(r.estado);
  assert.ok(usables.some((x) => x.id === 'srv1' && !x.local));
  assert.ok(usables.some((x) => x.platoId === 'plato-locro'));
  assert.equal(usables[0].fecha >= usables[usables.length - 1].fecha, true, 'las más nuevas primero');
});
