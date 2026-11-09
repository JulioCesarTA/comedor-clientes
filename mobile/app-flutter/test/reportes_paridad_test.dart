// El motor de reportes corre en el teléfono (sin internet). Este test comprueba que da EXACTAMENTE lo mismo que el del
// servidor (Python) y el del navegador (JS): repite ~40 consultas guardadas por ia-ml-service/herramientas/generar_paridad_reportes.py.
import 'dart:convert';
import 'dart:io';

import 'package:comedor_movil/reportes/catalogo.dart';
import 'package:comedor_movil/reportes/fechas.dart' as f;
import 'package:comedor_movil/reportes/lenguaje.dart' as l;
import 'package:comedor_movil/reportes/motor.dart' as m;
import 'package:flutter_test/flutter_test.dart';

/// Igualdad "de JSON": 5 y 5.0 son lo mismo (JavaScript y Python no distinguen entero de decimal al comparar).
String? difiere(Object? a, Object? b, [String ruta = '']) {
  if (a is num && b is num) return a == b ? null : '$ruta: $a != $b';
  if (a is List && b is List) {
    if (a.length != b.length) return '$ruta: largo ${a.length} != ${b.length}';
    for (var i = 0; i < a.length; i++) {
      final d = difiere(a[i], b[i], '$ruta[$i]');
      if (d != null) return d;
    }
    return null;
  }
  if (a is Map && b is Map) {
    final ka = a.keys.toSet(), kb = b.keys.toSet();
    if (!(ka.length == kb.length && ka.containsAll(kb))) return '$ruta: claves ${ka.difference(kb)} / ${kb.difference(ka)}';
    for (final k in ka) {
      final d = difiere(a[k], b[k], '$ruta.$k');
      if (d != null) return d;
    }
    return null;
  }
  return a == b ? null : '$ruta: «$a» != «$b»';
}

void main() {
  final ref = jsonDecode(File('../../pruebas-comunes/reportes-paridad.json').readAsStringSync()) as Map<String, dynamic>;
  Catalogo.cargar(Map<String, dynamic>.from(ref['catalogo'] as Map));
  final datasets = Map<String, dynamic>.from(ref['datasets'] as Map);
  final hoy = f.desdeIso(ref['hoy']);

  Map<String, dynamic>? previa;
  for (final caso in (ref['casos'] as List).cast<Map<String, dynamic>>()) {
    final texto = caso['texto'] as String;
    final continuar = caso['continuar'] == true;
    test('${continuar ? '↳ ' : ''}$texto', () {
      final e = Map<String, dynamic>.from(caso['esperado'] as Map);
      Map<String, dynamic> leido;
      Map<String, dynamic> r;
      try {
        leido = l.interpretar(texto, previa: continuar ? previa : null, hoy: hoy, tablas: datasets);
        r = m.ejecutar(leido['spec'] as Map, datasets);
      } on l.NoEntendido catch (err) {
        previa = null;
        expect(e.containsKey('error'), true, reason: 'el servidor sí respondió pero aquí falló: $err');
        expect(err.mensaje, e['error']);
        return;
      } on m.ConsultaInvalida catch (err) {
        previa = null;
        expect(e.containsKey('error'), true, reason: 'el servidor sí respondió pero aquí falló: $err');
        expect(err.mensaje, e['error']);
        return;
      }
      previa = Map<String, dynamic>.from(leido['spec'] as Map);
      expect(e.containsKey('error'), false, reason: 'el servidor falló («${e['error']}») y aquí no');
      final mio = <String, dynamic>{
        'dataset': r['dataset'], 'modo': r['modo'], 'titulo': r['titulo'], 'entendi': leido['entendi'], 'spec': leido['spec'],
        'confianza': leido['confianza'], 'continuacion': leido['continuacion'], 'columnas': r['columnas'], 'filas': r['filas'],
        'totales': r['totales'], 'grafico': r['grafico'], 'resumen': r['resumen'], 'condiciones': r['condiciones'],
        'notas': [...(r['notas'] as List), ...(leido['notas'] as List)], 'registrosAnalizados': r['registrosAnalizados'],
        'totalFilas': r['totalFilas'], 'mostradas': r['mostradas'],
      };
      for (final k in e.keys) {
        // pasar por JSON deja `mio` con los mismos tipos que `e` (null, listas, mapas)
        final d = difiere(jsonDecode(jsonEncode(mio[k])), e[k], k);
        expect(d, isNull, reason: 'difiere «$k» en «$texto»');
      }
    });
  }
}
