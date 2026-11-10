// Análisis de la bandeja DENTRO del teléfono, sin internet. Es el mismo método que usa el servidor
// (ia-ml-service/app/services/analitica/vision.py), pero la red convolucional corre aquí con TensorFlow Lite.
//
//   foto 224x224  --TFLite (MobileNetV2 hasta block_3_expand_relu)-->  mapa 56x56 zonas x 144 características
//   + color medio de cada zona  =  descriptor de 147 números por zona
//   referencia (foto de la porción completa): separa zonas de COMIDA (más color y textura) de las de plato/bandeja
//   y guarda 4 "aspectos" típicos de cada tipo (prototipos, k-means)
//   bandeja: cada zona se clasifica por su prototipo más parecido; área de comida / área de la referencia = % restante
//
// Dart puro: se puede probar sin teléfono (test/analisis_test.dart).
import 'dart:math' as math;
import 'dart:typed_data';

import 'sectores.dart';

const rej = 56;                 // zonas por lado
const lado = 224;               // lado de la foto que entra a la red
const canal = 144;              // características por zona (capa block_3_expand_relu)
const dim = canal + 3;          // + color medio RGB
const pesoColor = 0.9;
const zonas = rej * rej;
const paso = lado ~/ rej;       // 4 píxeles por zona

class ErrorVision implements Exception {
  ErrorVision(this.mensaje);
  final String mensaje;
  @override
  String toString() => mensaje;
}

/// Referencia: los «aspectos» típicos de comida y de plato, y qué fracción de la foto era comida.
class Referencia {
  Referencia({required this.comida, required this.fondo, required this.fRef, this.advertencia, this.mascara,
    this.zonasSectores, this.nombresSectores});
  final List<List<double>> comida;
  final List<List<double>> fondo;
  final double fRef;
  final String? advertencia;
  final Uint8List? mascara;
  final Map<String, int>? zonasSectores;      // sector -> zonas que ocupa en la foto llena (null sin modelo de sectores)
  final Map<String, String>? nombresSectores; // sector -> cómo se llama en este plato («pollo», «naranja»…)

  Map<String, dynamic>? sectoresJson() =>
      zonasSectores == null ? null : {'zonas': zonasSectores, 'nombres': nombresSectores ?? nombresPorDefecto};
}

class ResultadoBandeja {
  ResultadoBandeja({required this.restante, required this.comido, required this.confianza, required this.mascara,
    this.sectores = const []});
  final double restante;        // con sectores: el promedio de los sectores
  final double comido;
  final double confianza;
  final Uint8List mascara;
  final List<Sector> sectores;
}

/// rgba (224*224*4) -> entrada de la red: Float32List(224*224*3) en [-1, 1], como MobileNetV2.
Float32List entradaRed(Uint8List rgba) {
  final out = Float32List(lado * lado * 3);
  for (var i = 0, j = 0; i < lado * lado; i++) {
    out[j++] = rgba[i * 4] / 127.5 - 1;
    out[j++] = rgba[i * 4 + 1] / 127.5 - 1;
    out[j++] = rgba[i * 4 + 2] / 127.5 - 1;
  }
  return out;
}

class Descriptores {
  Descriptores(this.d, this.aspecto, this.sat, this.tex);
  final Float32List d;          // zonas x dim
  final Float64List aspecto;    // «cara de comida» de cada zona
  final Float64List sat;        // saturación media cruda de cada zona (entrada de la red de sectores)
  final Float64List tex;        // textura cruda (desvío del gris) de cada zona
}

/// Descriptor de cada zona y su «aspecto de comida» (saturación + textura normalizadas).
Descriptores descriptores(Uint8List rgba, Float32List mapa) {
  if (rgba.length != lado * lado * 4) throw ErrorVision('La foto debe ser de ${lado}x$lado');
  if (mapa.length != zonas * canal) throw ErrorVision('El mapa de la red debe tener ${zonas * canal} números (tiene ${mapa.length})');
  final d = Float32List(zonas * dim);
  final sat = Float64List(zonas), tex = Float64List(zonas);
  final gris = Float64List(lado * lado);
  for (var p = 0; p < lado * lado; p++) {        // gris como PIL ("L")
    gris[p] = ((rgba[p * 4] * 19595 + rgba[p * 4 + 1] * 38470 + rgba[p * 4 + 2] * 7471 + 0x8000) >> 16).toDouble();
  }
  for (var zy = 0; zy < rej; zy++) {
    for (var zx = 0; zx < rej; zx++) {
      final z = zy * rej + zx;
      var norma = 0.0;
      for (var c = 0; c < canal; c++) {
        final v = mapa[z * canal + c];
        norma += v * v;
      }
      norma = math.sqrt(norma) + 1e-8;
      for (var c = 0; c < canal; c++) {
        d[z * dim + c] = mapa[z * canal + c] / norma;
      }
      var r = 0.0, g = 0.0, b = 0.0, s = 0.0, sg = 0.0, sg2 = 0.0;
      for (var dy = 0; dy < paso; dy++) {
        for (var dx = 0; dx < paso; dx++) {
          final p = (zy * paso + dy) * lado + (zx * paso + dx);
          final cr = rgba[p * 4], cg = rgba[p * 4 + 1], cb = rgba[p * 4 + 2];
          r += cr; g += cg; b += cb;
          final mx = math.max(cr, math.max(cg, cb)), mn = math.min(cr, math.min(cg, cb));
          s += mx == 0 ? 0 : ((255 * (mx - mn)) ~/ mx) / 255;        // saturación HSV como PIL (entera 0-255)
          sg += gris[p] / 255;
          sg2 += (gris[p] / 255) * (gris[p] / 255);
        }
      }
      final n = paso * paso;
      d[z * dim + canal] = pesoColor * r / n / 255;
      d[z * dim + canal + 1] = pesoColor * g / n / 255;
      d[z * dim + canal + 2] = pesoColor * b / n / 255;
      sat[z] = s / n;
      tex[z] = math.sqrt(math.max(0, sg2 / n - (sg / n) * (sg / n)));
    }
  }
  var ms = 0.0, mt = 0.0;
  for (var z = 0; z < zonas; z++) {
    ms = math.max(ms, sat[z]);
    mt = math.max(mt, tex[z]);
  }
  final aspecto = Float64List(zonas);
  for (var z = 0; z < zonas; z++) {
    aspecto[z] = sat[z] / (ms + 1e-8) + tex[z] / (mt + 1e-8);
  }
  return Descriptores(d, aspecto, sat, tex);
}

double _mediana(Float64List v) {
  final o = Float64List.fromList(v)..sort();
  final m = o.length >> 1;
  return o.length.isOdd ? o[m] : (o[m - 1] + o[m]) / 2;
}

/// Umbral que separa comida (más color y textura) de plato/bandeja, y qué tan clara es la separación (0-1).
(double, double) otsu(Float64List v) {
  var min = double.infinity, max = -double.infinity, suma = 0.0;
  for (final x in v) {
    if (x < min) min = x;
    if (x > max) max = x;
    suma += x;
  }
  final media = suma / v.length;
  var varianza = 0.0;
  for (final x in v) {
    varianza += (x - media) * (x - media);
  }
  final total = varianza / v.length + 1e-12;
  var mejor = -1.0, umbral = _mediana(v);
  for (var i = 1; i < 63; i++) {
    final t = min + (max - min) * i / 63;
    var na = 0, nb = 0;
    var sa = 0.0, sb = 0.0;
    for (final x in v) {
      if (x <= t) { na++; sa += x; } else { nb++; sb += x; }
    }
    if (na < 5 || nb < 5) continue;
    final w = (na * nb) / (v.length * v.length) * math.pow(sa / na - sb / nb, 2);
    if (w > mejor) { mejor = w.toDouble(); umbral = t; }
  }
  return (umbral, math.max(0, mejor) / total);
}

/// Quita zonas sueltas: una zona es comida si la mayoría de su vecindario 3x3 lo es.
Uint8List alisar(Uint8List mascara) {
  final out = Uint8List(zonas);
  int at(int y, int x) => mascara[math.min(rej - 1, math.max(0, y)) * rej + math.min(rej - 1, math.max(0, x))];
  for (var y = 0; y < rej; y++) {
    for (var x = 0; x < rej; x++) {
      var n = 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          n += at(y + dy, x + dx);
        }
      }
      out[y * rej + x] = n >= 5 ? 1 : 0;
    }
  }
  return out;
}

// ----------------------------- k-means (prototipos) -----------------------------

/// mulberry32: la misma secuencia en cualquier teléfono, para que el resultado no cambie entre ejecuciones.
double Function() _generador(int semilla) {
  var a = semilla & 0xFFFFFFFF;
  return () {
    a = (a + 0x6D2B79F5) & 0xFFFFFFFF;
    var t = a;
    t = (t ^ (t >>> 15)) * (t | 1) & 0xFFFFFFFF;
    t = (t ^ (t + ((t ^ (t >>> 7)) * (t | 61) & 0xFFFFFFFF))) & 0xFFFFFFFF;
    return ((t ^ (t >>> 14)) & 0xFFFFFFFF) / 4294967296;
  };
}

double _dist2(Float64List x, int i, Float64List c, int j) {
  var s = 0.0;
  for (var k = 0; k < dim; k++) {
    final t = x[i * dim + k] - c[j * dim + k];
    s += t * t;
  }
  return s;
}

({Float64List c, double inercia}) _kmeansUna(Float64List x, int n, int k, double Function() rnd) {
  final c = Float64List(k * dim);
  final primero = (rnd() * n).floor().clamp(0, n - 1);        // k-means++
  for (var i = 0; i < dim; i++) {
    c[i] = x[primero * dim + i];
  }
  final d2 = Float64List(n)..fillRange(0, n, double.infinity);
  for (var j = 1; j < k; j++) {
    var total = 0.0;
    for (var i = 0; i < n; i++) {
      d2[i] = math.min(d2[i], _dist2(x, i, c, j - 1));
      total += d2[i];
    }
    var objetivo = rnd() * total, elegido = n - 1;
    for (var i = 0; i < n; i++) {
      objetivo -= d2[i];
      if (objetivo <= 0) { elegido = i; break; }
    }
    for (var i = 0; i < dim; i++) {
      c[j * dim + i] = x[elegido * dim + i];
    }
  }
  final etiqueta = Int32List(n);
  var inercia = double.infinity;
  for (var iter = 0; iter < 60; iter++) {
    var cambios = 0;
    var nueva = 0.0;
    for (var i = 0; i < n; i++) {
      var mejor = 0;
      var md = double.infinity;
      for (var j = 0; j < k; j++) {
        final dd = _dist2(x, i, c, j);
        if (dd < md) { md = dd; mejor = j; }
      }
      if (etiqueta[i] != mejor || iter == 0) cambios++;
      etiqueta[i] = mejor;
      nueva += md;
    }
    final suma = Float64List(k * dim);
    final cuenta = Int32List(k);
    for (var i = 0; i < n; i++) {
      cuenta[etiqueta[i]]++;
      for (var cc = 0; cc < dim; cc++) {
        suma[etiqueta[i] * dim + cc] += x[i * dim + cc];
      }
    }
    for (var j = 0; j < k; j++) {
      if (cuenta[j] > 0) {
        for (var cc = 0; cc < dim; cc++) {
          c[j * dim + cc] = suma[j * dim + cc] / cuenta[j];
        }
      }
    }
    if ((inercia - nueva).abs() < 1e-6 * math.max(1, nueva) || cambios == 0) {
      inercia = nueva;
      break;
    }
    inercia = nueva;
  }
  return (c: c, inercia: inercia);
}

/// k centros de las zonas dadas (varios intentos, el de menor error).
List<List<double>> prototipos(Float64List x, int n, int k, [int semilla = 0]) {
  k = math.max(1, math.min(k, n));
  final rnd = _generador(semilla);
  ({Float64List c, double inercia})? mejor;
  for (var intento = 0; intento < 5; intento++) {
    final r = _kmeansUna(x, n, k, rnd);
    if (mejor == null || r.inercia < mejor.inercia) mejor = r;
  }
  return [for (var j = 0; j < k; j++) List<double>.from(mejor!.c.sublist(j * dim, (j + 1) * dim))];
}

// ----------------------------- clasificación -----------------------------

({Uint8List mascara, double confianza}) clasificar(Float32List d, List<List<double>> comida, List<List<double>> fondo) {
  final mascara = Uint8List(zonas);
  var conf = 0.0;
  double mas(int z, List<List<double>> protos) {
    var m = double.infinity;
    for (final p in protos) {
      var s = 0.0;
      for (var c = 0; c < dim; c++) {
        final t = d[z * dim + c] - p[c];
        s += t * t;
      }
      if (s < m) m = s;
    }
    return math.sqrt(m);
  }

  for (var z = 0; z < zonas; z++) {
    final dc = mas(z, comida), dg = mas(z, fondo);
    mascara[z] = dc < dg ? 1 : 0;
    conf += (dg - dc).abs() / (dg + dc + 1e-8);
  }
  return (mascara: mascara, confianza: conf / zonas);
}

int _suma(Uint8List m) {
  var s = 0;
  for (final x in m) {
    s += x;
  }
  return s;
}

({Float64List x, int n}) _tomar(Float32List d, Uint8List mask, int valor) {
  final idx = <int>[];
  for (var z = 0; z < zonas; z++) {
    if (mask[z] == valor) idx.add(z);
  }
  final x = Float64List(idx.length * dim);
  for (var i = 0; i < idx.length; i++) {
    for (var c = 0; c < dim; c++) {
      x[i * dim + c] = d[idx[i] * dim + c];
    }
  }
  return (x: x, n: idx.length);
}

/// Foto de la porción completa -> prototipos de comida y de fondo + fracción de la foto que es comida.
Referencia crearReferencia(Uint8List rgba, Float32List mapa, {ModeloSectores? modelo, Map<String, String>? nombres}) {
  final r = descriptores(rgba, mapa);
  final (umbral, claridad) = otsu(r.aspecto);
  final cruda = Uint8List(zonas);
  for (var z = 0; z < zonas; z++) {
    cruda[z] = r.aspecto[z] > umbral ? 1 : 0;
  }
  final comida0 = alisar(cruda);
  String? advertencia;
  if (claridad < 0.35) {
    advertencia = 'Hay poco contraste entre la comida y el plato: toma la foto desde arriba, con buena luz y la bandeja completa.';
  }
  final n1 = _suma(comida0);
  if (n1 < 8 || n1 / zonas > 0.9) {
    advertencia = 'No se distingue bien la comida en la foto de referencia: vuelve a tomarla más cerca y con mejor luz.';
  }
  if (n1 < 8 || zonas - n1 < 8) {
    throw ErrorVision(advertencia ?? 'No se distingue la comida en la foto: vuelve a tomarla.');
  }
  final a = _tomar(r.d, comida0, 1), b = _tomar(r.d, comida0, 0);
  final comida = prototipos(a.x, a.n, 4, 1), fondo = prototipos(b.x, b.n, 4, 2);
  final comida1 = mascaraComida(r.d, comida, fondo).mascara;   // misma regla que se usará con las bandejas
  if (modelo == null) {
    return Referencia(comida: comida, fondo: fondo, fRef: _suma(comida1) / zonas, advertencia: advertencia, mascara: comida1);
  }
  final clases = clasificarZonas(entradaSectores(r), modelo);   // arroz, ensalada, … de cada zona
  final mascara = Uint8List.fromList([for (final c in clases) c > 0 ? 1 : 0]);
  return Referencia(comida: comida, fondo: fondo, fRef: _suma(comida1) / zonas, advertencia: advertencia, mascara: mascara,
      zonasSectores: sectoresReferencia(clases), nombresSectores: {...nombresPorDefecto, ...?nombres});
}

/// Misma regla que el servidor: una zona es comida si se aleja del color de la bandeja al menos la mitad
/// de lo que se aleja la comida típica (así salsa, migas y grasa donde ya se comió no cuentan).
const factorUmbralColor = 0.5;

/// Color (RGB 0-1) de la bandeja: promedio del color de los prototipos de fondo (últimas 3 componentes).
List<double> colorBandeja(List<List<double>> fondo) {
  final c = [0.0, 0.0, 0.0];
  for (final p in fondo) {
    for (var i = 0; i < 3; i++) {
      c[i] += p[dim - 3 + i] / pesoColor / fondo.length;
    }
  }
  return c;
}

double _distColor(List<double> p, List<double> tray) {
  var s = 0.0;
  for (var i = 0; i < 3; i++) {
    final t = p[dim - 3 + i] / pesoColor - tray[i];
    s += t * t;
  }
  return math.sqrt(s);
}

/// Distancia de color mínima para no ser bandeja: la mitad de la mediana de la distancia de la comida típica.
double umbralColor(List<List<double>> comida, List<List<double>> fondo) {
  final tray = colorBandeja(fondo);
  final dists = [for (final p in comida) _distColor(p, tray)]..sort();
  final n = dists.length;
  final mediana = n.isOdd ? dists[n ~/ 2] : (dists[n ~/ 2 - 1] + dists[n ~/ 2]) / 2;
  return factorUmbralColor * mediana;
}

/// Zona = comida si su prototipo más parecido es de comida Y su color se aleja del de la bandeja.
/// Se usa igual en la referencia y en las bandejas (la foto llena contra sí misma da 100 %).
({Uint8List mascara, double confianza}) mascaraComida(Float32List d, List<List<double>> comida, List<List<double>> fondo) {
  final cl = clasificar(d, comida, fondo);
  final tray = colorBandeja(fondo), umbral = umbralColor(comida, fondo);
  for (var z = 0; z < zonas; z++) {
    if (cl.mascara[z] == 1) {
      var s = 0.0;
      for (var i = 0; i < 3; i++) {
        final t = d[z * dim + dim - 3 + i] / pesoColor - tray[i];
        s += t * t;
      }
      if (math.sqrt(s) <= umbral) cl.mascara[z] = 0;   // color de bandeja: no es comida
    }
  }
  return (mascara: alisar(cl.mascara), confianza: cl.confianza);
}

/// Foto de una bandeja + referencia -> % que quedó y % que se comió.
ResultadoBandeja analizarBandeja(Uint8List rgba, Float32List mapa, Referencia ref, {ModeloSectores? modelo}) {
  final desc = descriptores(rgba, mapa);
  final d = desc.d;
  final cl = mascaraComida(d, ref.comida, ref.fondo);
  var alisada = cl.mascara;
  var restante = ref.fRef > 0 ? math.min(100.0, 100.0 * (_suma(alisada) / zonas) / ref.fRef) : 0.0;
  var sectores = const <Sector>[];
  final zonasRef = ref.zonasSectores;
  if (modelo != null && zonasRef != null && zonasRef.isNotEmpty) {   // con sectores: % de cada uno y el promedio
    final clases = clasificarZonas(entradaSectores(desc), modelo);
    final (s, promedio) = comparar(zonasRef, clases, ref.nombresSectores ?? nombresPorDefecto);
    sectores = s;
    restante = promedio;
    alisada = Uint8List.fromList([for (final c in clases) c > 0 ? 1 : 0]);
  }
  final r1 = (restante * 10).round() / 10;
  return ResultadoBandeja(
    restante: r1,
    comido: ((100 - restante) * 10).round() / 10,
    confianza: (cl.confianza * 100).round() / 100,
    mascara: alisada,
    sectores: sectores,
  );
}
