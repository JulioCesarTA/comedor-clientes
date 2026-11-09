// Llamadas al comedor: reportes (el motor vive en el servidor) y «desperdicio por foto» (el análisis es local).
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

class ErrorApi implements Exception {
  ErrorApi(this.mensaje, {this.sinRed = false, this.estado = 0});
  final String mensaje;
  final bool sinRed;
  final int estado;
  @override
  String toString() => mensaje;
}

class Api {
  Api(this.cfg, this.obtenerToken);
  final Config cfg;
  final Future<String?> Function() obtenerToken;

  Future<Map<String, String>> _cabeceras({bool json = true}) async {
    final t = await obtenerToken();
    final cab = <String, String>{};
    if (json) cab['content-type'] = 'application/json; charset=utf-8';
    if (t != null && t.isNotEmpty) cab['authorization'] = 'Bearer $t';
    return cab;
  }

  /// Solo es «sin conexión» lo que de verdad lo es (sin red, tiempo agotado, certificado). Cualquier otro error
  /// se dice tal cual: antes un error cualquiera aparecía como «sin conexión» y escondía la causa real.
  Never _fallo(Object e) {
    if (e is ErrorApi) throw e;
    if (e is SocketException || e is TimeoutException || e is http.ClientException) {
      throw ErrorApi('Sin conexión con el servidor del comedor.', sinRed: true);
    }
    if (e is HandshakeException || e is TlsException) {
      throw ErrorApi('No pude establecer una conexión segura con el servidor (certificado).');
    }
    throw ErrorApi('Error inesperado al hablar con el servidor: $e');
  }

  dynamic _cuerpo(http.Response r) {
    dynamic j;
    if (r.body.isNotEmpty) {
      try {
        j = jsonDecode(utf8.decode(r.bodyBytes));
      } on FormatException {
        j = null;                         // no era JSON (p. ej. una página de error del servidor)
      }
    }
    if (r.statusCode >= 300) {
      // El motivo real va en «message» (Nest) o «detail» (FastAPI); «error» solo trae el nombre genérico («Conflict»).
      Object? det = j is Map ? (j['message'] ?? j['detail']) : null;
      if (det is List) det = det.join(' ');
      if (det is! String || det.isEmpty) det = null;
      throw ErrorApi(det as String? ?? 'El servidor respondió ${r.statusCode}.', estado: r.statusCode);
    }
    if (j == null && r.body.isNotEmpty) {
      throw ErrorApi('El servidor respondió algo que no entiendo (¿esa función no está disponible?).', estado: r.statusCode);
    }
    return j;
  }

  Future<dynamic> get(String ruta, {Duration espera = const Duration(seconds: 30)}) async {
    try {
      return _cuerpo(await http.get(Uri.parse('${cfg.api}$ruta'), headers: await _cabeceras(json: false)).timeout(espera));
    } catch (e) {
      _fallo(e);
    }
  }

  Future<dynamic> post(String ruta, Map<String, dynamic> cuerpo, {Duration espera = const Duration(seconds: 90)}) async {
    try {
      return _cuerpo(await http
          .post(Uri.parse('${cfg.api}$ruta'), headers: await _cabeceras(), body: utf8.encode(jsonEncode(cuerpo)))
          .timeout(espera));
    } catch (e) {
      _fallo(e);
    }
  }

  // ----------------------------- reportes -----------------------------

  // Los reportes se calculan EN el teléfono (lib/reportes/): del servidor solo se baja la copia de datos
  // (GET /reportes/snapshot, ver IaLocal.actualizar). No hay llamadas de «consulta» al servidor.

  // ----------------------------- desperdicio por foto -----------------------------

  Future<Map<String, dynamic>> paqueteVision() async => Map<String, dynamic>.from(await get('/ml/vision/paquete-movil'));

  Future<Map<String, dynamic>> urlSubida(String tipo, String clienteId, String fecha) async =>
      Map<String, dynamic>.from(await post('/ml/vision/subida', {'tipo': tipo, 'cliente_id': clienteId, 'fecha': fecha}));

  Future<Map<String, dynamic>> enviarReferencia(Map<String, dynamic> datos) async =>
      Map<String, dynamic>.from(await post('/ml/vision/referencia-movil', datos));

  Future<Map<String, dynamic>> enviarBandeja(Map<String, dynamic> datos) async =>
      Map<String, dynamic>.from(await post('/ml/vision/bandeja-movil', datos));

  /// Sube la foto directo a S3 con la URL temporal que dio el servidor (el teléfono no lleva claves de AWS).
  Future<bool> subirFoto(String url, File foto, Map<String, dynamic> encabezados) async {
    try {
      final r = await http.put(Uri.parse(url),
          headers: {for (final e in encabezados.entries) e.key: '${e.value}'},
          body: await foto.readAsBytes()).timeout(const Duration(seconds: 90));
      return r.statusCode >= 200 && r.statusCode < 300;
    } catch (_) {
      throw ErrorApi('Sin conexión al subir la foto.', sinRed: true);
    }
  }
}

Future<bool> hayRed() async {
  try {
    final r = await Connectivity().checkConnectivity();
    return !r.contains(ConnectivityResult.none);
  } catch (_) {
    return true;
  }
}

Stream<bool> cambiosDeRed() =>
    Connectivity().onConnectivityChanged.map((r) => !r.contains(ConnectivityResult.none));
