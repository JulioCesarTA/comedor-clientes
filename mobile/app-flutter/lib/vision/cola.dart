// Cola de «Desperdicio por foto»: lo que se hace sin internet queda guardado y se envía al volver la red, EN ORDEN
// y sin duplicar nada (cada registro lleva un id propio que el servidor usa como llave).
// Primero las referencias y luego las bandejas, porque una bandeja puede depender de una referencia hecha aquí.
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:path_provider/path_provider.dart';

import '../datos/api.dart';
import 'analisis.dart';
import 'sectores.dart';

String nuevoId() {
  final r = Random.secure();
  String h(int n) => List.generate(n, (_) => r.nextInt(16).toRadixString(16)).join();
  return '${h(8)}-${h(4)}-4${h(3)}-a${h(3)}-${h(12)}';
}

class RefLocal {
  RefLocal({required this.clienteId, required this.platoId, required this.fecha, required this.turno,
    required this.fRef, required this.comida, required this.fondo, this.advertencia, this.fotoRuta,
    this.fotoKey, this.idServidor, this.rechazada = false, this.error, this.sectores, String? creado})
      : creado = creado ?? DateTime.now().toIso8601String();

  final String clienteId;
  final String platoId;
  final String fecha;
  final String turno;
  final double fRef;
  final List<List<double>> comida;
  final List<List<double>> fondo;
  final String? advertencia;
  final Map<String, dynamic>? sectores;   // {"zonas": {sector: n}, "nombres": {sector: nombre}}
  String? fotoRuta;
  String? fotoKey;
  String? idServidor;
  bool rechazada;
  String? error;
  final String creado;

  bool get pendiente => idServidor == null && !rechazada;

  Map<String, dynamic> aJson() => {
        'clienteId': clienteId, 'platoId': platoId, 'fecha': fecha, 'turno': turno, 'fRef': fRef,
        'comida': comida, 'fondo': fondo, 'advertencia': advertencia, 'fotoRuta': fotoRuta,
        'fotoKey': fotoKey, 'idServidor': idServidor, 'rechazada': rechazada, 'error': error, 'creado': creado,
        'sectores': sectores,
      };

  static RefLocal deJson(Map<String, dynamic> j) => RefLocal(
        clienteId: j['clienteId'], platoId: j['platoId'], fecha: j['fecha'], turno: j['turno'],
        fRef: (j['fRef'] as num).toDouble(),
        comida: (j['comida'] as List).map((f) => (f as List).map((x) => (x as num).toDouble()).toList()).toList(),
        fondo: (j['fondo'] as List).map((f) => (f as List).map((x) => (x as num).toDouble()).toList()).toList(),
        advertencia: j['advertencia'], fotoRuta: j['fotoRuta'], fotoKey: j['fotoKey'],
        idServidor: j['idServidor'], rechazada: j['rechazada'] ?? false, error: j['error'], creado: j['creado'],
        sectores: j['sectores'] == null ? null : Map<String, dynamic>.from(j['sectores']),
      );
}

class BandejaLocal {
  BandejaLocal({required this.clienteId, required this.refId, required this.refEsLocal, required this.platoId,
    required this.fecha, required this.turno, required this.restante, required this.comido, required this.confianza,
    this.fotoRuta, this.fotoKey, this.enviada = false, this.idServidor, this.rechazada = false, this.error,
    this.sectores = const [], String? creado})
      : creado = creado ?? DateTime.now().toIso8601String();

  final String clienteId;
  final String refId;
  final bool refEsLocal;
  final String platoId;
  final String fecha;
  final String turno;
  final double restante;
  final double comido;
  final double confianza;
  final List<Sector> sectores;
  String? fotoRuta;
  String? fotoKey;
  bool enviada;
  String? idServidor;
  bool rechazada;
  String? error;
  final String creado;

  bool get pendiente => !enviada && !rechazada;

  Map<String, dynamic> aJson() => {
        'clienteId': clienteId, 'refId': refId, 'refEsLocal': refEsLocal, 'platoId': platoId, 'fecha': fecha,
        'turno': turno, 'restante': restante, 'comido': comido, 'confianza': confianza, 'fotoRuta': fotoRuta,
        'fotoKey': fotoKey, 'enviada': enviada, 'idServidor': idServidor, 'rechazada': rechazada, 'error': error, 'creado': creado,
        'sectores': sectores.map((s) => s.aJson()).toList(),
      };

  static BandejaLocal deJson(Map<String, dynamic> j) => BandejaLocal(
        clienteId: j['clienteId'], refId: j['refId'], refEsLocal: j['refEsLocal'] ?? false, platoId: j['platoId'],
        fecha: j['fecha'], turno: j['turno'], restante: (j['restante'] as num).toDouble(),
        comido: (j['comido'] as num).toDouble(), confianza: (j['confianza'] as num).toDouble(),
        fotoRuta: j['fotoRuta'], fotoKey: j['fotoKey'], enviada: j['enviada'] ?? false, idServidor: j['idServidor'],
        rechazada: j['rechazada'] ?? false, error: j['error'], creado: j['creado'],
        sectores: ((j['sectores'] as List?) ?? []).map((s) => Sector.deJson(Map<String, dynamic>.from(s))).toList(),
      );
}

/// Una referencia que se puede usar para analizar: del servidor o hecha en este teléfono.
class RefUsable {
  RefUsable({required this.id, required this.platoId, required this.fecha, required this.turno, required this.fRef,
    required this.comida, required this.fondo, required this.local, required this.sincronizada, this.sectores});
  final String id;
  final String platoId;
  final String fecha;
  final String turno;
  final double fRef;
  final List<List<double>> comida;
  final List<List<double>> fondo;
  final bool local;
  final bool sincronizada;
  final Map<String, dynamic>? sectores;

  /// La referencia lista para analizar (con sus sectores si los tiene).
  Referencia comoReferencia() {
    final z = sectores?['zonas'] as Map?, n = sectores?['nombres'] as Map?;
    return Referencia(comida: comida, fondo: fondo, fRef: fRef,
        zonasSectores: z?.map((k, v) => MapEntry('$k', (v as num).toInt())),
        nombresSectores: n?.map((k, v) => MapEntry('$k', '$v')));
  }
}

class ResumenSync {
  ResumenSync({this.referencias = 0, this.bandejas = 0, this.sinRed = false, List<String>? errores})
      : errores = errores ?? [];
  int referencias;
  int bandejas;
  bool sinRed;
  final List<String> errores;
}

class EstadoVision {
  EstadoVision({this.paquete, List<RefLocal>? locales, List<BandejaLocal>? bandejas, this.ultimaSync})
      : locales = locales ?? [],
        bandejas = bandejas ?? [];

  Map<String, dynamic>? paquete;          // referencias que vinieron del servidor
  List<RefLocal> locales;
  List<BandejaLocal> bandejas;
  String? ultimaSync;

  int get pendientes => locales.where((r) => r.pendiente).length + bandejas.where((b) => b.pendiente).length;

  List<RefUsable> get usables {
    final delServidor = ((paquete?['referencias'] as List?) ?? []).map((r) => RefUsable(
          id: r['id'], platoId: r['platoId'], fecha: r['fecha'], turno: r['turno'],
          fRef: (r['fRef'] as num).toDouble(),
          comida: (r['comida'] as List).map((f) => (f as List).map((x) => (x as num).toDouble()).toList()).toList(),
          fondo: (r['fondo'] as List).map((f) => (f as List).map((x) => (x as num).toDouble()).toList()).toList(),
          local: false, sincronizada: true,
          sectores: r['sectores'] == null ? null : Map<String, dynamic>.from(r['sectores']),
        )).toList();
    final ids = delServidor.map((r) => r.id).toSet();
    final mias = locales
        .where((r) => !(r.idServidor != null && ids.contains(r.idServidor)) && !r.rechazada)
        .map((r) => RefUsable(id: r.clienteId, platoId: r.platoId, fecha: r.fecha, turno: r.turno, fRef: r.fRef,
            comida: r.comida, fondo: r.fondo, local: true, sincronizada: r.idServidor != null, sectores: r.sectores))
        .toList();
    final todas = [...mias, ...delServidor];
    todas.sort((a, b) => b.fecha.compareTo(a.fecha));
    return todas;
  }

  Map<String, dynamic> aJson() => {
        'paquete': paquete,
        'locales': locales.map((r) => r.aJson()).toList(),
        'bandejas': bandejas.map((b) => b.aJson()).toList(),
        'ultimaSync': ultimaSync,
      };

  static EstadoVision deJson(Map<String, dynamic> j) => EstadoVision(
        paquete: j['paquete'] == null ? null : Map<String, dynamic>.from(j['paquete']),
        locales: ((j['locales'] as List?) ?? []).map((x) => RefLocal.deJson(Map<String, dynamic>.from(x))).toList(),
        bandejas: ((j['bandejas'] as List?) ?? []).map((x) => BandejaLocal.deJson(Map<String, dynamic>.from(x))).toList(),
        ultimaSync: j['ultimaSync'],
      );
}

// ----------------------------- guardado en el teléfono -----------------------------

Future<File> _archivo() async => File('${(await getApplicationDocumentsDirectory()).path}/vision.json');

Future<Directory> carpetaFotos() async {
  final d = Directory('${(await getApplicationDocumentsDirectory()).path}/fotos-bandejas');
  if (!await d.exists()) await d.create(recursive: true);
  return d;
}

Future<EstadoVision> cargarEstado() async {
  try {
    final f = await _archivo();
    if (!await f.exists()) return EstadoVision();
    return EstadoVision.deJson(jsonDecode(await f.readAsString()));
  } catch (_) {
    return EstadoVision();
  }
}

Future<void> guardarEstado(EstadoVision e) async {
  try {
    await (await _archivo()).writeAsString(jsonEncode(e.aJson()));
  } catch (_) {/* sin espacio: se reintenta en la próxima acción */}
}

Future<void> borrarEstado() async {
  try {
    final f = await _archivo();
    if (await f.exists()) await f.delete();
    final c = await carpetaFotos();
    if (await c.exists()) await c.delete(recursive: true);
  } catch (_) {/* nada */}
}

Future<File> guardarFoto(Uint8ListLike bytes, String id) async {
  final f = File('${(await carpetaFotos()).path}/$id.jpg');
  await f.writeAsBytes(bytes);
  return f;
}

typedef Uint8ListLike = List<int>;

// ----------------------------- sincronización -----------------------------

/// Envía lo pendiente y trae las referencias del servidor. No lanza: devuelve el resumen de lo que pasó.
Future<ResumenSync> sincronizar(EstadoVision est, Api api) async {
  final res = ResumenSync();
  Future<void> subirFoto(String tipo, String clienteId, String fecha, String? ruta, void Function(String) ponerKey) async {
    if (ruta == null) return;
    final f = File(ruta);
    if (!await f.exists()) return;
    try {
      final s = await api.urlSubida(tipo, clienteId, fecha);
      if (await api.subirFoto(s['url'], f, Map<String, dynamic>.from(s['encabezados'] ?? {}))) {
        ponerKey(s['clave']);
      }
    } on ErrorApi catch (e) {
      if (e.sinRed) rethrow;                 // sin red: se corta aquí y se reintenta luego
      // S3 no disponible: el resultado se envía igual, sin foto
    }
  }

  try {
    final p = await api.paqueteVision();
    if (p['referencias'] is List) est.paquete = p;

    for (final r in est.locales.where((x) => x.pendiente).toList()) {
      if (r.fotoKey == null) {
        await subirFoto('ref', r.clienteId, r.fecha, r.fotoRuta, (k) => r.fotoKey = k);
      }
      try {
        final out = await api.enviarReferencia({
          'cliente_id': r.clienteId, 'plato_id': r.platoId, 'fecha': r.fecha, 'turno': r.turno,
          'f_ref': r.fRef, 'comida': r.comida, 'fondo': r.fondo, 'foto_key': r.fotoKey, 'advertencia': r.advertencia,
          'sectores': r.sectores,
        });
        r.idServidor = out['id'];
        res.referencias++;
      } on ErrorApi catch (e) {
        if (e.sinRed) rethrow;
        if (e.estado == 400) {
          r.rechazada = true;
          r.error = e.mensaje;
          res.errores.add('Referencia ${r.platoId}: ${e.mensaje}');
        } else {
          res.errores.add('Referencia ${r.platoId}: ${e.mensaje}');
        }
      }
    }

    for (final b in est.bandejas.where((x) => x.pendiente).toList()) {
      var refId = b.refId;
      if (b.refEsLocal) {
        final loc = est.locales.where((x) => x.clienteId == b.refId).firstOrNull;
        if (loc == null || loc.rechazada) {
          b.rechazada = true;
          b.error = 'Su referencia fue rechazada';
          res.errores.add('Bandeja de ${b.platoId}: ${b.error}');
          continue;
        }
        if (loc.idServidor == null) continue;      // su referencia aún no llegó: se intenta en la próxima
        refId = loc.idServidor!;
      }
      if (b.fotoKey == null) {
        await subirFoto('bandeja', b.clienteId, b.fecha, b.fotoRuta, (k) => b.fotoKey = k);
      }
      try {
        final out = await api.enviarBandeja({
          'cliente_id': b.clienteId, 'ref_id': refId, 'restante': b.restante, 'confianza': b.confianza, 'foto_key': b.fotoKey,
          if (b.sectores.isNotEmpty) 'sectores': b.sectores.map((s) => s.aJson()).toList(),
        });
        b.enviada = true;
        b.idServidor = out['id'];
        res.bandejas++;
      } on ErrorApi catch (e) {
        if (e.sinRed) rethrow;
        if (e.estado == 400) {
          b.rechazada = true;
          b.error = e.mensaje;
        }
        res.errores.add('Bandeja de ${b.platoId}: ${e.mensaje}');
      }
    }
    est.ultimaSync = DateTime.now().toIso8601String();
  } on ErrorApi catch (e) {
    if (e.sinRed) {
      res.sinRed = true;
    } else {
      res.errores.add(e.mensaje);
    }
  }
  return res;
}
