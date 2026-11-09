// Cola de sincronización de «Desperdicio por foto»: todo lo que se hace sin internet (referencias y bandejas analizadas en el
// teléfono) queda guardado y se envía al volver la red, EN ORDEN, sin duplicar nada:
//   - cada registro lleva un id único generado aquí (clienteId); el servidor lo usa como llave y reenviar es inofensivo
//   - la foto se sube directo a S3 con una URL temporal que pide el servidor (el teléfono no lleva claves de AWS)
//   - primero las referencias, luego las bandejas (una bandeja puede depender de una referencia creada en el teléfono)
// Este archivo es lógica pura: se prueba en Node con un servidor falso (__tests__/vision.test.js).

const vacio = () => ({ paquete: null, locales: [], bandejas: [], ultimaSync: null });

function uuid() {
  try { return require('expo-crypto').randomUUID(); } catch { /* Node o sin expo-crypto */ }
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

const copia = (e) => JSON.parse(JSON.stringify(e));

/** Referencias que se pueden usar para analizar: las del servidor (paquete) y las hechas en el teléfono. */
function referenciasUsables(est) {
  const delServidor = ((est.paquete && est.paquete.referencias) || []).map((r) => ({ ...r, local: false }));
  const ids = new Set(delServidor.map((r) => r.id));
  const locales = est.locales.filter((r) => !(r.idServidor && ids.has(r.idServidor))).map((r) => ({
    id: r.clienteId, platoId: r.platoId, fecha: r.fecha, turno: r.turno, fRef: r.fRef, comida: r.comida, fondo: r.fondo, local: true, sincronizada: !!r.idServidor,
  }));
  return [...locales, ...delServidor].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

const pendientes = (est) => est.locales.filter((r) => !r.idServidor && !r.rechazada).length + est.bandejas.filter((b) => !b.enviada && !b.rechazada).length;

function agregarReferencia(est, r) {
  const n = copia(est);
  n.locales.unshift({ clienteId: r.clienteId || uuid(), idServidor: null, creado: new Date().toISOString(), ...r });
  return n;
}

function agregarBandeja(est, b) {
  const n = copia(est);
  n.bandejas.unshift({ clienteId: b.clienteId || uuid(), enviada: false, creado: new Date().toISOString(), ...b });
  return n;
}

// ----------------------------- sincronización -----------------------------

/**
 * deps.pedir(metodo, ruta, cuerpo) -> { estado, json }   (lanza Error con .red = true si no hay conexión)
 * deps.subirFoto(url, uri, encabezados) -> true si S3 aceptó la foto
 * Devuelve { estado, resumen } sin tocar el estado recibido.
 */
async function sincronizar(est, deps) {
  const n = copia(est);
  const resumen = { referencias: 0, bandejas: 0, errores: [], sinRed: false };
  const subirFoto = async (tipo, item) => {
    if (!item.fotoUri || item.fotoKey) return;
    try {
      const r = await deps.pedir('POST', '/ml/vision/subida', { tipo, cliente_id: item.clienteId, fecha: item.fecha });
      if (r.estado === 200 && (await deps.subirFoto(r.json.url, item.fotoUri, r.json.encabezados))) item.fotoKey = r.json.clave;
    } catch (e) { if (e.red) throw e; /* S3 no disponible: el resultado se envía igual, sin foto */ }
  };
  try {
    const p = await deps.pedir('GET', '/ml/vision/paquete-movil');
    if (p.estado === 200 && p.json && Array.isArray(p.json.referencias)) n.paquete = p.json;

    for (const r of n.locales.filter((x) => !x.idServidor && !x.rechazada)) {
      await subirFoto('ref', r);
      const res = await deps.pedir('POST', '/ml/vision/referencia-movil', {
        cliente_id: r.clienteId, plato_id: r.platoId, fecha: r.fecha, turno: r.turno, f_ref: r.fRef, comida: r.comida, fondo: r.fondo,
        foto_key: r.fotoKey || null, advertencia: r.advertencia || null });
      if (res.estado === 200) { r.idServidor = res.json.id; resumen.referencias++; }
      else if (res.estado === 400) { r.rechazada = true; r.error = (res.json && res.json.detail) || 'Rechazada por el servidor'; resumen.errores.push(`Referencia ${r.platoId}: ${r.error}`); }
      else resumen.errores.push(`Referencia ${r.platoId}: el servidor respondió ${res.estado}`);
    }

    for (const b of n.bandejas.filter((x) => !x.enviada && !x.rechazada)) {
      let refId = b.refId;
      if (b.refEsLocal) {
        const loc = n.locales.find((x) => x.clienteId === b.refId);
        if (!loc || loc.rechazada) { b.rechazada = true; b.error = 'Su referencia fue rechazada'; resumen.errores.push(`Bandeja de ${b.platoId}: ${b.error}`); continue; }
        if (!loc.idServidor) continue;                                  // su referencia aún no llegó: se intenta en la próxima sincronización
        refId = loc.idServidor;
      }
      await subirFoto('bandeja', b);
      const res = await deps.pedir('POST', '/ml/vision/bandeja-movil', {
        cliente_id: b.clienteId, ref_id: refId, restante: b.restante, confianza: b.confianza, foto_key: b.fotoKey || null });
      if (res.estado === 200) { b.enviada = true; b.idServidor = res.json.id; resumen.bandejas++; }
      else if (res.estado === 400) { b.rechazada = true; b.error = (res.json && res.json.detail) || 'Rechazada por el servidor'; resumen.errores.push(`Bandeja de ${b.platoId}: ${b.error}`); }
      else { b.error = (res.json && res.json.detail) || `El servidor respondió ${res.estado}`; resumen.errores.push(`Bandeja de ${b.platoId}: ${b.error}`); }
    }
    n.ultimaSync = new Date().toISOString();
  } catch (e) {
    if (e.red) resumen.sinRed = true; else resumen.errores.push(e.message || String(e));
  }
  return { estado: n, resumen };
}

module.exports = { vacio, uuid, referenciasUsables, pendientes, agregarReferencia, agregarBandeja, sincronizar };
