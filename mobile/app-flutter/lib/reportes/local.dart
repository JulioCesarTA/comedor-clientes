// IA local de reportes: el intérprete (español -> consulta) y el motor (consulta -> tabla/gráfico) corren EN el teléfono.
// Los datos y el catálogo se bajan del servidor (/reportes/snapshot), se guardan en un archivo del teléfono y desde ahí
// todo funciona sin internet. Se renuevan solos cuando hay red y la copia tiene más de 15 minutos.
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../datos/api.dart';
import 'catalogo.dart';
import 'lenguaje.dart' as l;
import 'motor.dart' as m;

class Copia {
  Copia({required this.generado, required this.guardadoEn, required this.usuario, required this.catalogo, required this.datasets});
  final String generado; // cuándo el servidor armó la copia
  final DateTime guardadoEn; // cuándo se guardó en este teléfono
  final String usuario; // de quién es: si entra otra persona en este teléfono, no se reutiliza
  final Map<String, dynamic> catalogo;
  final Map<String, dynamic> datasets;

  Map<String, dynamic> aJson() => {
        'generado': generado, 'guardadoEn': guardadoEn.millisecondsSinceEpoch, 'usuario': usuario, 'catalogo': catalogo, 'datasets': datasets,
      };
  static Copia deJson(Map<String, dynamic> j) => Copia(
        generado: '${j['generado']}',
        guardadoEn: DateTime.fromMillisecondsSinceEpoch((j['guardadoEn'] as num).toInt()),
        usuario: '${j['usuario']}',
        catalogo: Map<String, dynamic>.from(j['catalogo'] as Map),
        datasets: Map<String, dynamic>.from(j['datasets'] as Map),
      );
}

class IaLocal {
  static const vigencia = Duration(minutes: 15);
  Copia? actual;

  Future<File> _archivo() async => File('${(await getApplicationDocumentsDirectory()).path}/reportes_copia.json');

  void _usar(Copia c) {
    actual = c;
    Catalogo.cargar(c.catalogo);
  }

  /// Copia guardada en el teléfono (sin tocar la red). null si no hay o es de otra persona.
  Future<Copia?> copiaGuardada(String usuario) async {
    try {
      final f = await _archivo();
      if (!await f.exists()) return null;
      final c = Copia.deJson(jsonDecode(await f.readAsString()) as Map<String, dynamic>);
      if (c.usuario != usuario) return null;
      _usar(c);
      return c;
    } catch (_) {
      return null; // archivo dañado: se vuelve a bajar
    }
  }

  /// Baja una copia nueva de los datos del rol. Lanza ErrorApi si no hay internet o el servidor falla.
  Future<Copia> actualizar(Api api, String usuario) async {
    final j = Map<String, dynamic>.from(await api.get('/reportes/snapshot', espera: const Duration(seconds: 120)) as Map);
    if (j['catalogo'] == null || j['datasets'] == null) {
      throw ErrorApi('El servidor aún no envía el catálogo de reportes (se está actualizando). Intenta en unos minutos.');
    }
    final c = Copia(
      generado: '${j['generado']}', guardadoEn: DateTime.now(), usuario: usuario,
      catalogo: Map<String, dynamic>.from(j['catalogo'] as Map), datasets: Map<String, dynamic>.from(j['datasets'] as Map),
    );
    try {
      await (await _archivo()).writeAsString(jsonEncode(c.aJson()), flush: true);
    } catch (_) {/* sin espacio: la copia sirve en esta sesión */}
    _usar(c);
    return c;
  }

  /// Deja listos los datos: usa la copia guardada y, si hay internet y está vieja (o se pide), la renueva.
  /// Devuelve la copia en uso y un aviso solo cuando no hay con qué trabajar.
  Future<(Copia?, String)> preparar(Api api, String usuario, {bool forzar = false, required bool hayInternet}) async {
    final guardada = actual != null && actual!.usuario == usuario ? actual : await copiaGuardada(usuario);
    final vieja = guardada == null || DateTime.now().difference(guardada.guardadoEn) > vigencia;
    if (!forzar && !vieja) return (guardada, '');
    if (!hayInternet) return (guardada, guardada == null ? 'Aún no hay datos en este teléfono: conéctate una vez para descargarlos.' : '');
    try {
      return (await actualizar(api, usuario), '');
    } on ErrorApi catch (e) {
      return (guardada, guardada == null ? e.mensaje : '');
    }
  }

  /// Interpreta un pedido en español y lo ejecuta con los datos locales.
  Map<String, dynamic> consultar(String texto, Map<String, dynamic>? previa) {
    final c = actual;
    if (c == null) throw l.NoEntendido('Aún no hay datos en este teléfono: conéctate una vez para descargarlos.');
    final leido = l.interpretar(texto, previa: previa, tablas: c.datasets);
    final r = m.ejecutar(leido['spec'] as Map, c.datasets);
    return {...r, 'spec': leido['spec'], 'entendi': leido['entendi'], 'confianza': leido['confianza'], 'notas': [...(r['notas'] as List), ...(leido['notas'] as List)]};
  }

  /// Reejecuta un spec ya armado (los botones de agrupar, limitar, quitar filtros…).
  Map<String, dynamic> ejecutarSpec(Map<String, dynamic> spec) {
    final c = actual;
    if (c == null) throw l.NoEntendido('Aún no hay datos en este teléfono.');
    return {...m.ejecutar(spec, c.datasets), 'spec': spec, 'entendi': l.entendido(spec)};
  }

  /// Qué se puede pedir (para la pantalla), sacado del catálogo local.
  List<dynamic> ayuda() => [for (final e in Catalogo.datasets.entries) {'id': e.key, ...Map<String, dynamic>.from(e.value as Map)}];

  /// Si entra otra persona en este teléfono, la copia de datos de la anterior se borra.
  Future<void> olvidar() async {
    actual = null;
    try {
      final f = await _archivo();
      if (await f.exists()) await f.delete();
    } catch (_) {/* nada que borrar */}
  }
}

/// Mensaje claro para los errores del motor (en vez de un «Exception: ...»).
String mensajeError(Object e) {
  if (e is l.NoEntendido) return e.mensaje;
  if (e is m.ConsultaInvalida) return e.mensaje;
  if (e is ErrorApi) return e.mensaje;
  return 'No pude armar el reporte: $e';
}

/// Una sola IA local para toda la app: la copia de datos queda en memoria entre pantallas.
final iaLocal = IaLocal();
