// El teléfono (Dart + modelo TFLite) debe calcular lo mismo que el servidor (Python + Keras) sobre las mismas fotos.
// Los datos salen de herramientas/generar_paridad.py, que corre el método real de ia-ml-service.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:comedor_movil/vision/analisis.dart';
import 'package:flutter_test/flutter_test.dart';

Uint8List _crudo(String b64) => Uint8List.fromList(ZLibDecoder().convert(base64.decode(b64)));

/// float16 (little endian) -> Float32List, como lo guarda el generador.
Float32List _f16(Uint8List buf) {
  final bd = ByteData.sublistView(buf);
  final out = Float32List(buf.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    final h = bd.getUint16(i * 2, Endian.little);
    final s = (h & 0x8000) != 0 ? -1.0 : 1.0;
    final e = (h >> 10) & 0x1f;
    final m = h & 0x3ff;
    if (e == 0) {
      out[i] = s * 0.00006103515625 * (m / 1024);
    } else if (e == 31) {
      out[i] = m == 0 ? s * double.infinity : double.nan;
    } else {
      var p = 1.0;
      for (var k = 0; k < (e - 15).abs(); k++) {
        p *= 2;
      }
      out[i] = s * (e - 15 >= 0 ? p : 1 / p) * (1 + m / 1024);
    }
  }
  return out;
}

({Uint8List rgba, Float32List mapa}) _entrada(Map<String, dynamic> x) {
  final px = _crudo(x['px']);
  final rgba = Uint8List(lado * lado * 4);
  for (var i = 0; i < lado * lado; i++) {
    rgba[i * 4] = px[i * 3];
    rgba[i * 4 + 1] = px[i * 3 + 1];
    rgba[i * 4 + 2] = px[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return (rgba: rgba, mapa: _f16(_crudo(x['mapa'])));
}

void main() {
  final archivo = File('test/datos/paridad.json');
  if (!archivo.existsSync()) {
    test('faltan los datos de paridad', () {}, skip: 'genera test/datos/paridad.json con herramientas/generar_paridad.py');
    return;
  }
  final d = jsonDecode(archivo.readAsStringSync()) as Map<String, dynamic>;
  final esperado = d['esperado'] as Map<String, dynamic>;

  test('descriptores de zona: iguales a los del servidor', () {
    final e = _entrada(d['ref']);
    final r = descriptores(e.rgba, e.mapa);
    final muestra = List<int>.from(esperado['muestra']);
    final refDesc = esperado['descriptores'] as List;
    final refAsp = esperado['aspecto'] as List;
    var peor = 0.0, peorAsp = 0.0;
    for (var i = 0; i < muestra.length; i++) {
      final z = muestra[i];
      for (var c = 0; c < dim; c++) {
        final x = (r.d[z * dim + c] - (refDesc[i][c] as num).toDouble()).abs();
        if (x > peor) peor = x;
      }
      final a = (r.aspecto[z] - (refAsp[i] as num).toDouble()).abs();
      if (a > peorAsp) peorAsp = a;
    }
    expect(peor, lessThan(0.01), reason: 'descriptor: diferencia máxima $peor');
    expect(peorAsp, lessThan(0.03), reason: 'aspecto de comida: diferencia máxima $peorAsp');
  });

  test('referencia: separa la comida igual que el servidor', () {
    final e = _entrada(d['ref']);
    final r = crearReferencia(e.rgba, e.mapa);
    final f = (esperado['fRef'] as num).toDouble();
    expect((r.fRef - f).abs(), lessThan(0.02), reason: 'fRef teléfono ${r.fRef} vs servidor $f');
  });

  test('bandeja: el % que queda coincide con el del servidor; el plato limpio da ~0', () {
    final ref = _entrada(d['ref']), ban = _entrada(d['bandeja']), vacia = _entrada(d['vacia']);
    final referencia = crearReferencia(ref.rgba, ref.mapa);
    final r = analizarBandeja(ban.rgba, ban.mapa, referencia);
    final servidor = (esperado['restante'] as num).toDouble();
    expect((r.restante - servidor).abs(), lessThan(6),
        reason: 'teléfono ${r.restante}% vs servidor $servidor%');
    final v = analizarBandeja(vacia.rgba, vacia.mapa, referencia);
    expect(v.restante, lessThan(3), reason: 'plato limpio: ${v.restante}%');
    expect(r.restante, greaterThan(v.restante + 20), reason: 'la bandeja con comida debe dar claramente más');
    final intacta = analizarBandeja(ref.rgba, ref.mapa, referencia);
    expect((intacta.restante - 100).abs(), lessThan(3), reason: 'porción intacta: ${intacta.restante}%');
  });

  test('k-means es repetible (misma semilla, mismos prototipos)', () {
    final n = 200;
    final x = Float64List(n * dim);
    for (var i = 0; i < x.length; i++) {
      x[i] = ((i * 2654435761) % 1000) / 1000;
    }
    expect(prototipos(x, n, 4, 7), equals(prototipos(x, n, 4, 7)));
  });

  test('los datos de entrada se validan', () {
    expect(() => descriptores(Uint8List(10), Float32List(zonas * canal)), throwsA(isA<ErrorVision>()));
    expect(() => descriptores(Uint8List(lado * lado * 4), Float32List(10)), throwsA(isA<ErrorVision>()));
    final e = entradaRed(Uint8List(lado * lado * 4));
    expect(e.length, lado * lado * 3);
    expect(e.every((v) => v >= -1 && v <= 1), isTrue);
  });
}
