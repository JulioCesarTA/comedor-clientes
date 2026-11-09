// El teléfono (JS + modelo TFLite) debe calcular lo mismo que el servidor (Python + Keras) sobre las mismas fotos.
// Los datos salen de herramientas/generar_paridad.py, que corre el método real del servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const A = require('../src/vision/analisis');

const archivo = path.join(__dirname, 'datos', 'paridad.json');
const hay = fs.existsSync(archivo);
const D = hay ? JSON.parse(fs.readFileSync(archivo, 'utf8')) : null;

const crudo = (b64) => zlib.inflateSync(Buffer.from(b64, 'base64'));
function f16(buf) {                                          // float16 (little endian) -> Float32Array
  const out = new Float32Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) {
    const h = buf.readUInt16LE(i * 2), s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    out[i] = e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + m / 1024);
  }
  return out;
}
function entrada(x) {                                        // RGB (224*224*3) -> RGBA como entrega la decodificación del teléfono
  const px = crudo(x.px), rgba = new Uint8Array(A.LADO * A.LADO * 4);
  for (let i = 0; i < A.LADO * A.LADO; i++) { rgba[i * 4] = px[i * 3]; rgba[i * 4 + 1] = px[i * 3 + 1]; rgba[i * 4 + 2] = px[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  return { rgba, mapa: f16(crudo(x.mapa)) };
}

const opcion = { skip: hay ? false : 'falta __tests__/datos/paridad.json (genéralo con herramientas/generar_paridad.py)' };

test('descriptores de zona: iguales a los del servidor', opcion, () => {
  const { rgba, mapa } = entrada(D.ref);
  const { d, aspecto } = A.descriptores(rgba, mapa);
  const e = D.esperado;
  let peor = 0, peorAsp = 0;
  e.muestra.forEach((z, i) => {
    for (let c = 0; c < A.DIM; c++) peor = Math.max(peor, Math.abs(d[z * A.DIM + c] - e.descriptores[i][c]));
    peorAsp = Math.max(peorAsp, Math.abs(aspecto[z] - e.aspecto[i]));
  });
  assert.ok(peor < 0.01, `descriptor: diferencia máxima ${peor}`);
  assert.ok(peorAsp < 0.03, `aspecto de comida: diferencia máxima ${peorAsp}`);
});

test('referencia: separa la comida igual que el servidor', opcion, () => {
  const { rgba, mapa } = entrada(D.ref);
  const r = A.crearReferencia(rgba, mapa);
  assert.ok(Math.abs(r.fRef - D.esperado.fRef) < 0.02, `fRef teléfono ${r.fRef.toFixed(3)} vs servidor ${D.esperado.fRef.toFixed(3)}`);
});

test('bandeja: el % que queda coincide con el del servidor; el plato limpio da ~0', opcion, () => {
  const ref = entrada(D.ref), ban = entrada(D.bandeja), vacia = entrada(D.vacia);
  const referencia = A.crearReferencia(ref.rgba, ref.mapa);
  const r = A.analizarBandeja(ban.rgba, ban.mapa, referencia);
  assert.ok(Math.abs(r.restante - D.esperado.restante) < 6, `teléfono ${r.restante}% vs servidor ${D.esperado.restante.toFixed(1)}%`);
  assert.ok(Math.abs(r.confianza - D.esperado.confianza) < 0.1, `confianza ${r.confianza} vs ${D.esperado.confianza.toFixed(2)}`);
  const v = A.analizarBandeja(vacia.rgba, vacia.mapa, referencia);
  assert.ok(v.restante < 3 && D.esperado.restanteVacia < 3, `plato limpio: teléfono ${v.restante}% servidor ${D.esperado.restanteVacia}%`);
  assert.ok(r.restante > v.restante + 20, 'la bandeja con comida debe dar claramente más que el plato limpio');
  const sinTocar = A.analizarBandeja(ref.rgba, ref.mapa, referencia);
  assert.ok(Math.abs(sinTocar.restante - 100) < 3, `porción intacta: ${sinTocar.restante}%`);
});
