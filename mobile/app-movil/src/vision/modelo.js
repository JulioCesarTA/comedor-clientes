// La red convolucional DENTRO del teléfono: TensorFlow Lite (react-native-fast-tflite) con MobileNetV2 recortado en
// block_3_expand_relu. Recibe la foto de 224x224 y devuelve el mapa 56x56x144. El archivo .tflite viaja dentro de la app
// (assets/modelos), por eso funciona sin internet. Requiere la app instalada con `expo run:android` (no corre en Expo Go).
const { entradaRed, ZONAS, CANAL } = require('./analisis');

let TFLite = null;
try { TFLite = require('react-native-fast-tflite'); } catch { TFLite = null; }

let promesa = null;

/** ¿Está disponible TensorFlow Lite en esta instalación de la app? (en Expo Go no). */
const modeloDisponible = () => !!(TFLite && TFLite.loadTensorflowModel);

function cargarModelo() {
  if (!modeloDisponible()) return Promise.reject(new Error('TensorFlow Lite necesita la app instalada con `expo run:android` (no funciona en Expo Go).'));
  if (!promesa) {
    promesa = TFLite.loadTensorflowModel(require('../../assets/modelos/bandeja_mobilenetv2_b3.tflite'))
      .catch((e) => { promesa = null; throw e; });
  }
  return promesa;
}

/** rgba 224x224 -> Float32Array(56*56*144), corriendo la CNN en el teléfono. */
async function caracteristicas(rgba) {
  const m = await cargarModelo();
  const salida = await m.run([entradaRed(rgba)]);
  const mapa = salida[0];
  if (!mapa || mapa.length !== ZONAS * CANAL) throw new Error(`El modelo devolvió ${mapa ? mapa.length : 0} números y se esperaban ${ZONAS * CANAL}`);
  return mapa;
}

module.exports = { modeloDisponible, cargarModelo, caracteristicas };
