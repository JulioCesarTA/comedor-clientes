// De la foto del teléfono a los píxeles que necesita la red: 224x224 (como el servidor) y una copia de 900 px para guardar/subir.
const jpeg = require('jpeg-js');
const { LADO } = require('./analisis');

/** base64 -> Uint8Array (sin depender de Buffer ni de atob, que no existen igual en todos los motores de JS). */
function base64ABytes(b64) {
  const tabla = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const limpio = String(b64).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((limpio.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < limpio.length; i += 4) {
    const a = tabla.indexOf(limpio[i]), b = tabla.indexOf(limpio[i + 1]);
    const c = i + 2 < limpio.length ? tabla.indexOf(limpio[i + 2]) : -1, d = i + 3 < limpio.length ? tabla.indexOf(limpio[i + 3]) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}

/** JPEG (base64) de 224x224 -> { rgba: Uint8Array(224*224*4) }. Lanza si no es de 224x224. */
function decodificarJpegBase64(b64) {
  const img = jpeg.decode(base64ABytes(b64), { useTArray: true, formatAsRGBA: true });
  if (img.width !== LADO || img.height !== LADO) throw new Error(`La foto preparada debe ser de ${LADO}x${LADO} (es ${img.width}x${img.height})`);
  return { rgba: img.data };
}

/** Prepara una foto (uri) con expo-image-manipulator. Devuelve { rgba, uriFoto }: píxeles para la red y copia de 900 px. */
async function prepararFoto(uri) {
  const M = require('expo-image-manipulator');                // se carga aquí: así las pruebas en Node no lo necesitan
  const chica = await M.manipulateAsync(uri, [{ resize: { width: LADO, height: LADO } }], { base64: true, format: M.SaveFormat.JPEG, compress: 1 });
  const grande = await M.manipulateAsync(uri, [{ resize: { width: 900 } }], { format: M.SaveFormat.JPEG, compress: 0.85 });
  return { ...decodificarJpegBase64(chica.base64), uriFoto: grande.uri };
}

module.exports = { base64ABytes, decodificarJpegBase64, prepararFoto };
