// Análisis de la bandeja DENTRO del teléfono, sin internet. Es el mismo método que usa el servidor
// (ia-ml-service/app/services/analitica/vision.py), pero la red convolucional corre aquí con TensorFlow Lite.
//
//   foto 224x224  --TFLite (MobileNetV2 hasta block_3_expand_relu)-->  mapa 56x56 zonas x 144 características
//   + color medio de cada zona  =  descriptor de 147 números por zona
//   referencia (foto de la porción completa): separa zonas de COMIDA (más color y textura) de las de plato/bandeja
//   y guarda 4 "aspectos" típicos de cada tipo (prototipos, k-means)
//   bandeja: cada zona se clasifica por su prototipo más parecido; el área de comida que queda / la de la referencia = % restante
//
// Funciones puras (sin React Native): se prueban en Node con los mismos números que produce el servidor.

const REJ = 56;                 // zonas por lado
const LADO = 224;               // lado de la foto que entra a la red
const CANAL = 144;              // características por zona (capa block_3_expand_relu)
const DIM = CANAL + 3;          // + color medio RGB
const PESO_COLOR = 0.9;
const ZONAS = REJ * REJ;
const PASO = LADO / REJ;        // 4 píxeles por zona

/** rgba (224*224*4) -> entrada de la red: Float32Array(224*224*3) con valores en [-1, 1] (como MobileNetV2). */
function entradaRed(rgba) {
  const out = new Float32Array(LADO * LADO * 3);
  for (let i = 0, j = 0; i < LADO * LADO; i++) {
    out[j++] = rgba[i * 4] / 127.5 - 1;
    out[j++] = rgba[i * 4 + 1] / 127.5 - 1;
    out[j++] = rgba[i * 4 + 2] / 127.5 - 1;
  }
  return out;
}

/** Descriptor de cada zona (ZONAS x DIM) y su "aspecto de comida" (saturación + textura normalizadas). */
function descriptores(rgba, mapa) {
  if (rgba.length !== LADO * LADO * 4) throw new Error(`La foto debe ser de ${LADO}x${LADO}`);
  if (mapa.length !== ZONAS * CANAL) throw new Error(`El mapa de la red debe tener ${ZONAS * CANAL} números (tiene ${mapa.length})`);
  const d = new Float32Array(ZONAS * DIM);
  const sat = new Float64Array(ZONAS), tex = new Float64Array(ZONAS);
  const gris = new Float64Array(LADO * LADO);
  for (let p = 0; p < LADO * LADO; p++) {                   // gris como PIL ("L"): (R*19595 + G*38470 + B*7471 + 0x8000) >> 16
    gris[p] = (rgba[p * 4] * 19595 + rgba[p * 4 + 1] * 38470 + rgba[p * 4 + 2] * 7471 + 0x8000) >> 16;
  }
  for (let zy = 0; zy < REJ; zy++) {
    for (let zx = 0; zx < REJ; zx++) {
      const z = zy * REJ + zx;
      let norma = 0;
      for (let c = 0; c < CANAL; c++) { const v = mapa[z * CANAL + c]; norma += v * v; }
      norma = Math.sqrt(norma) + 1e-8;
      for (let c = 0; c < CANAL; c++) d[z * DIM + c] = mapa[z * CANAL + c] / norma;
      let r = 0, g = 0, b = 0, s = 0, sg = 0, sg2 = 0;
      for (let dy = 0; dy < PASO; dy++) {
        for (let dx = 0; dx < PASO; dx++) {
          const p = (zy * PASO + dy) * LADO + (zx * PASO + dx);
          const R = rgba[p * 4], G = rgba[p * 4 + 1], B = rgba[p * 4 + 2];
          r += R; g += G; b += B;
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          s += mx === 0 ? 0 : Math.floor((255 * (mx - mn)) / mx) / 255;     // saturación HSV como PIL (entera 0-255)
          sg += gris[p] / 255; sg2 += (gris[p] / 255) ** 2;
        }
      }
      const n = PASO * PASO;
      d[z * DIM + CANAL] = (PESO_COLOR * r) / n / 255;
      d[z * DIM + CANAL + 1] = (PESO_COLOR * g) / n / 255;
      d[z * DIM + CANAL + 2] = (PESO_COLOR * b) / n / 255;
      sat[z] = s / n;
      tex[z] = Math.sqrt(Math.max(0, sg2 / n - (sg / n) ** 2));              // desviación estándar de la zona
    }
  }
  const aspecto = new Float64Array(ZONAS);
  const ms = Math.max(...sat) + 1e-8, mt = Math.max(...tex) + 1e-8;
  for (let z = 0; z < ZONAS; z++) aspecto[z] = sat[z] / ms + tex[z] / mt;
  return { d, aspecto };
}

const mediana = (v) => {
  const o = Float64Array.from(v).sort();
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/** Umbral que separa comida (más color y textura) de plato/bandeja, y qué tan clara es la separación (0-1). */
function otsu(v) {
  let min = Infinity, max = -Infinity, suma = 0;
  for (const x of v) { if (x < min) min = x; if (x > max) max = x; suma += x; }
  const media = suma / v.length;
  let varianza = 0;
  for (const x of v) varianza += (x - media) ** 2;
  const total = varianza / v.length + 1e-12;
  let mejor = -1, umbral = mediana(v);
  for (let i = 1; i < 63; i++) {
    const t = min + ((max - min) * i) / 63;
    let na = 0, nb = 0, sa = 0, sb = 0;
    for (const x of v) { if (x <= t) { na++; sa += x; } else { nb++; sb += x; } }
    if (na < 5 || nb < 5) continue;
    const w = ((na * nb) / v.length ** 2) * (sa / na - sb / nb) ** 2;
    if (w > mejor) { mejor = w; umbral = t; }
  }
  return [umbral, Math.max(0, mejor) / total];
}

/** Quita zonas sueltas: una zona es comida si la mayoría de su vecindario 3x3 lo es. */
function alisar(mascara) {
  const out = new Uint8Array(ZONAS);
  const at = (y, x) => mascara[Math.min(REJ - 1, Math.max(0, y)) * REJ + Math.min(REJ - 1, Math.max(0, x))];
  for (let y = 0; y < REJ; y++) {
    for (let x = 0; x < REJ; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += at(y + dy, x + dx);
      out[y * REJ + x] = n >= 5 ? 1 : 0;
    }
  }
  return out;
}

// ----------------------------- k-means (prototipos) -----------------------------

function generador(semilla) {                      // mulberry32: mismo resultado en cada teléfono
  let a = semilla >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const dist2 = (X, i, C, j) => { let s = 0; for (let k = 0; k < DIM; k++) { const t = X[i * DIM + k] - C[j * DIM + k]; s += t * t; } return s; };

function kmeansUna(X, n, k, rnd) {
  const C = new Float64Array(k * DIM);
  const primero = Math.floor(rnd() * n);                      // k-means++
  for (let c = 0; c < DIM; c++) C[c] = X[primero * DIM + c];
  const d2 = new Float64Array(n).fill(Infinity);
  for (let j = 1; j < k; j++) {
    let total = 0;
    for (let i = 0; i < n; i++) { d2[i] = Math.min(d2[i], dist2(X, i, C, j - 1)); total += d2[i]; }
    let objetivo = rnd() * total, elegido = n - 1;
    for (let i = 0; i < n; i++) { objetivo -= d2[i]; if (objetivo <= 0) { elegido = i; break; } }
    for (let c = 0; c < DIM; c++) C[j * DIM + c] = X[elegido * DIM + c];
  }
  const etiqueta = new Int32Array(n);
  let inercia = Infinity;
  for (let iter = 0; iter < 60; iter++) {
    let cambios = 0, nueva = 0;
    for (let i = 0; i < n; i++) {
      let mejor = 0, md = Infinity;
      for (let j = 0; j < k; j++) { const dd = dist2(X, i, C, j); if (dd < md) { md = dd; mejor = j; } }
      if (etiqueta[i] !== mejor || iter === 0) cambios++;
      etiqueta[i] = mejor; nueva += md;
    }
    const suma = new Float64Array(k * DIM), cuenta = new Int32Array(k);
    for (let i = 0; i < n; i++) { cuenta[etiqueta[i]]++; for (let c = 0; c < DIM; c++) suma[etiqueta[i] * DIM + c] += X[i * DIM + c]; }
    for (let j = 0; j < k; j++) if (cuenta[j]) for (let c = 0; c < DIM; c++) C[j * DIM + c] = suma[j * DIM + c] / cuenta[j];
    if (Math.abs(inercia - nueva) < 1e-6 * Math.max(1, nueva) || cambios === 0) { inercia = nueva; break; }
    inercia = nueva;
  }
  return { C, inercia };
}

/** Prototipos: k centros de las zonas dadas (varios intentos, el de menor error). Devuelve k vectores de DIM números. */
function prototipos(X, n, k, semilla = 0) {
  k = Math.max(1, Math.min(k, n));
  const rnd = generador(semilla);
  let mejor = null;
  for (let intento = 0; intento < 5; intento++) {
    const r = kmeansUna(X, n, k, rnd);
    if (!mejor || r.inercia < mejor.inercia) mejor = r;
  }
  return Array.from({ length: k }, (_, j) => Array.from(mejor.C.subarray(j * DIM, (j + 1) * DIM)));
}

// ----------------------------- clasificación -----------------------------

/** Cada zona es comida si su prototipo más parecido es de comida. -> { mascara, confianza 0-1 } */
function clasificar(d, comida, fondo) {
  const mascara = new Uint8Array(ZONAS);
  let conf = 0;
  const mas = (z, protos) => {
    let m = Infinity;
    for (const p of protos) { let s = 0; for (let c = 0; c < DIM; c++) { const t = d[z * DIM + c] - p[c]; s += t * t; } if (s < m) m = s; }
    return Math.sqrt(m);
  };
  for (let z = 0; z < ZONAS; z++) {
    const dc = mas(z, comida), dg = mas(z, fondo);
    mascara[z] = dc < dg ? 1 : 0;
    conf += Math.abs(dg - dc) / (dg + dc + 1e-8);
  }
  return { mascara, confianza: conf / ZONAS };
}

const suma = (m) => { let s = 0; for (let i = 0; i < m.length; i++) s += m[i]; return s; };

/** Foto de la porción completa -> prototipos de comida y de fondo + fracción de la foto que es comida. */
function crearReferencia(rgba, mapa) {
  const { d, aspecto } = descriptores(rgba, mapa);
  const [umbral, claridad] = otsu(aspecto);
  const cruda = new Uint8Array(ZONAS);
  for (let z = 0; z < ZONAS; z++) cruda[z] = aspecto[z] > umbral ? 1 : 0;
  const comida0 = alisar(cruda);
  let advertencia = null;
  if (claridad < 0.35) advertencia = 'Hay poco contraste entre la comida y el plato: toma la foto desde arriba, con buena luz y la bandeja completa.';
  const n1 = suma(comida0);
  if (n1 < 8 || n1 / ZONAS > 0.9) advertencia = 'No se distingue bien la comida en la foto de referencia: vuelve a tomarla más cerca y con mejor luz.';
  if (n1 < 8 || ZONAS - n1 < 8) throw new Error(advertencia || 'No se distingue la comida en la foto: vuelve a tomarla.');
  const tomar = (mask, valor) => { const idx = []; for (let z = 0; z < ZONAS; z++) if (mask[z] === valor) idx.push(z); const X = new Float64Array(idx.length * DIM); idx.forEach((z, i) => { for (let c = 0; c < DIM; c++) X[i * DIM + c] = d[z * DIM + c]; }); return { X, n: idx.length }; };
  const a = tomar(comida0, 1), b = tomar(comida0, 0);
  const comida = prototipos(a.X, a.n, 4, 1), fondo = prototipos(b.X, b.n, 4, 2);
  const { mascara } = clasificar(d, comida, fondo);            // misma regla que se usará con las bandejas
  const comida1 = alisar(mascara);
  return { comida, fondo, fRef: suma(comida1) / ZONAS, advertencia, mascara: comida1 };
}

/** Foto de una bandeja + referencia -> % que quedó y % que se comió. */
function analizarBandeja(rgba, mapa, ref) {
  const { d } = descriptores(rgba, mapa);
  const { mascara, confianza } = clasificar(d, ref.comida, ref.fondo);
  const alisada = alisar(mascara);
  const restante = ref.fRef > 0 ? Math.min(100, (100 * (suma(alisada) / ZONAS)) / ref.fRef) : 0;
  const r1 = Math.round(restante * 10) / 10;
  return { restante: r1, comido: Math.round((100 - restante) * 10) / 10, confianza: Math.round(confianza * 100) / 100, mascara: alisada };
}

module.exports = { REJ, LADO, CANAL, DIM, ZONAS, entradaRed, descriptores, otsu, alisar, prototipos, clasificar, crearReferencia, analizarBandeja };
