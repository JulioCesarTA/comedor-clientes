// Desperdicio POR SECTOR (arroz, ensalada, guarnición, proteína, postre), igual que el servidor
// (ia-ml-service/app/domain/analitica/sectores.py). Una red pequeña, entrenada con fotos etiquetadas a mano, dice qué
// comida hay en cada zona; % de un sector = zonas en la bandeja / zonas en la foto llena; bandeja = promedio de sectores.
// Los pesos vienen en assets/modelos/modelo_sectores.json (dentro de la app: funciona sin internet). Dart puro.
import 'dart:math' as math;
import 'dart:typed_data';

import 'analisis.dart';

const clasesSector = ['fondo', 'arroz', 'ensalada', 'guarnicion', 'proteina', 'postre'];
const nombresPorDefecto = {'arroz': 'arroz', 'ensalada': 'ensalada', 'guarnicion': 'guarnición', 'proteina': 'carne', 'postre': 'postre'};
const minZonasSector = 40;

class Sector {
  Sector({required this.clase, required this.nombre, required this.restante});
  final String clase;
  final String nombre;
  final double restante;
  Map<String, dynamic> aJson() => {'clase': clase, 'nombre': nombre, 'restante': restante};
  static Sector deJson(Map<String, dynamic> j) =>
      Sector(clase: j['clase'], nombre: j['nombre'] ?? j['clase'], restante: (j['restante'] as num).toDouble());
}

class RedSectores {
  RedSectores(this.w1, this.b1, this.w2, this.b2, this.oculta, this.salida);
  final Float32List w1, b1, w2, b2;     // w1: entrada x oculta ; w2: oculta x salida (por filas)
  final int oculta, salida;
}

class ModeloSectores {
  ModeloSectores._(this.media, this.escala, this.redes, this.sesgoFondo);
  final Float32List media, escala;
  final List<RedSectores> redes;
  final double sesgoFondo;

  static Float32List _plano(List m) {
    final filas = m.cast<List>();
    final out = Float32List(filas.length * filas.first.length);
    var k = 0;
    for (final f in filas) {
      for (final x in f) {
        out[k++] = (x as num).toDouble();
      }
    }
    return out;
  }

  static Float32List _vec(List v) => Float32List.fromList(v.map((x) => (x as num).toDouble()).toList());

  factory ModeloSectores.deJson(Map<String, dynamic> j) {
    final redes = [
      for (final r in (j['redes'] as List).cast<Map>())
        RedSectores(_plano(r['W1']), _vec(r['b1']), _plano(r['W2']), _vec(r['b2']), (r['b1'] as List).length, (r['b2'] as List).length),
    ];
    return ModeloSectores._(_vec(j['media']), _vec(j['escala']), redes, ((j['sesgo_fondo'] ?? 1.0) as num).toDouble());
  }
}

/// Entrada de la red por zona: descriptor (147) + saturación + 4·textura.
Float32List entradaSectores(Descriptores r) {
  final n = dim + 2;
  final x = Float32List(zonas * n);
  for (var z = 0; z < zonas; z++) {
    for (var c = 0; c < dim; c++) {
      x[z * n + c] = r.d[z * dim + c];
    }
    x[z * n + dim] = r.sat[z];
    x[z * n + dim + 1] = 4.0 * r.tex[z];
  }
  return x;
}

/// Clase de cada zona (índice en clasesSector), con el mismo alisado 3x3 que el servidor.
Uint8List clasificarZonas(Float32List x, ModeloSectores m) {
  final n = m.media.length, k = clasesSector.length;
  final prob = Float64List(zonas * k);
  final z = Float32List(n);
  for (var i = 0; i < zonas; i++) {
    for (var c = 0; c < n; c++) {
      z[c] = (x[i * n + c] - m.media[c]) / m.escala[c];
    }
    for (final red in m.redes) {
      final h = Float64List(red.oculta);
      for (var o = 0; o < red.oculta; o++) {
        var s = red.b1[o].toDouble();
        for (var c = 0; c < n; c++) {
          s += z[c] * red.w1[c * red.oculta + o];
        }
        h[o] = s > 0 ? s : 0;
      }
      final out = Float64List(k);
      var mx = -double.infinity;
      for (var q = 0; q < k; q++) {
        var s = red.b2[q].toDouble();
        for (var o = 0; o < red.oculta; o++) {
          s += h[o] * red.w2[o * k + q];
        }
        out[q] = s;
        mx = math.max(mx, s);
      }
      var tot = 0.0;
      for (var q = 0; q < k; q++) {
        out[q] = math.exp(out[q] - mx);
        tot += out[q];
      }
      for (var q = 0; q < k; q++) {
        prob[i * k + q] += out[q] / tot / m.redes.length;
      }
    }
  }
  final pred = Uint8List(zonas);
  for (var i = 0; i < zonas; i++) {
    var mejor = 0;
    var vm = prob[i * k] * m.sesgoFondo;
    for (var q = 1; q < k; q++) {
      if (prob[i * k + q] > vm) { vm = prob[i * k + q]; mejor = q; }
    }
    pred[i] = mejor;
  }
  return moda(pred);
}

/// Cada zona toma la clase más votada de su vecindario 3x3 (bordes repetidos, como np.pad "edge").
Uint8List moda(Uint8List pred) {
  final k = clasesSector.length;
  final out = Uint8List(zonas);
  for (var y = 0; y < rej; y++) {
    for (var x = 0; x < rej; x++) {
      final votos = List<int>.filled(k, 0);
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          final yy = (y + dy).clamp(0, rej - 1), xx = (x + dx).clamp(0, rej - 1);
          votos[pred[yy * rej + xx]]++;
        }
      }
      var mejor = 0;
      for (var q = 1; q < k; q++) {
        if (votos[q] > votos[mejor]) mejor = q;
      }
      out[y * rej + x] = mejor;
    }
  }
  return out;
}

Map<String, int> conteo(Uint8List pred) {
  final c = {for (final s in clasesSector.skip(1)) s: 0};
  for (final p in pred) {
    if (p > 0) c[clasesSector[p]] = c[clasesSector[p]]! + 1;
  }
  return c;
}

/// Sectores que tiene la foto llena y cuántas zonas ocupa cada uno.
Map<String, int> sectoresReferencia(Uint8List pred) =>
    Map.fromEntries(conteo(pred).entries.where((e) => e.value >= minZonasSector));

/// ([sectores], promedio): % que quedó de cada sector que existía en la foto llena.
(List<Sector>, double) comparar(Map<String, int> zonasRef, Uint8List predBandeja, Map<String, String> nombres) {
  final ahora = conteo(predBandeja);
  final sectores = [
    for (final e in zonasRef.entries)
      if (e.value > 0)
        Sector(clase: e.key, nombre: nombres[e.key] ?? nombresPorDefecto[e.key] ?? e.key,
            restante: (math.min(100.0, 100.0 * (ahora[e.key] ?? 0) / e.value) * 10).round() / 10),
  ];
  final prom = sectores.isEmpty ? 0.0 : sectores.map((s) => s.restante).reduce((a, b) => a + b) / sectores.length;
  return (sectores, (prom * 10).round() / 10);
}
