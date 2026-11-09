// La red convolucional DENTRO del teléfono: TensorFlow Lite (MobileNetV2 recortado en block_3_expand_relu).
// El archivo .tflite (80 KB) viaja dentro de la app, por eso el análisis funciona sin internet.
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';

import 'analisis.dart';

const _modelo = 'assets/modelos/bandeja_mobilenetv2_b3.tflite';

Interpreter? _interprete;

Future<Interpreter> cargarModelo() async {
  _interprete ??= await Interpreter.fromAsset(_modelo, options: InterpreterOptions()..threads = 2);
  return _interprete!;
}

Future<bool> modeloDisponible() async {
  try {
    await rootBundle.load(_modelo);
    return true;
  } catch (_) {
    return false;
  }
}

/// rgba 224x224 -> mapa 56x56x144 (Float32List), corriendo la CNN en el teléfono.
Future<Float32List> caracteristicas(Uint8List rgba) async {
  final m = await cargarModelo();
  final entrada = entradaRed(rgba).reshape([1, lado, lado, 3]);
  final salida = List.filled(zonas * canal, 0.0).reshape([1, rej, rej, canal]);
  m.run(entrada, salida);
  final out = Float32List(zonas * canal);
  var i = 0;
  for (final fila in salida[0]) {
    for (final col in fila) {
      for (final v in col) {
        out[i++] = (v as num).toDouble();
      }
    }
  }
  return out;
}

/// Foto del teléfono -> píxeles de 224x224 para la red, y una copia de 900 px para guardar y subir.
({Uint8List rgba, Uint8List jpegGrande}) prepararFoto(Uint8List bytes) {
  final original = img.decodeImage(bytes);
  if (original == null) throw ErrorVision('No pude leer la foto.');
  final chica = img.copyResize(original, width: lado, height: lado, interpolation: img.Interpolation.average);
  final rgba = Uint8List(lado * lado * 4);
  var i = 0;
  for (var y = 0; y < lado; y++) {
    for (var x = 0; x < lado; x++) {
      final p = chica.getPixel(x, y);
      rgba[i++] = p.r.toInt();
      rgba[i++] = p.g.toInt();
      rgba[i++] = p.b.toInt();
      rgba[i++] = 255;
    }
  }
  final grande = original.width > 900 ? img.copyResize(original, width: 900) : original;
  return (rgba: rgba, jpegGrande: img.encodeJpg(grande, quality: 85));
}
