// Ingreso con usuario y contraseña (Keycloak). La primera vez necesita internet; después también funciona sin conexión:
// con la huella, o con la contraseña verificada contra una copia protegida guardada en el teléfono.
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import '../config.dart';
import 'almacen.dart';

const etiquetaRol = {
  'administrador': 'Administrador',
  'nutricionista': 'Nutricionista',
  'cocina_almacen': 'Cocina y almacén',
  'servicio_caja': 'Caja',
  'estudiante': 'Estudiante',
};

/// `tipo`: credenciales | red | servidor
class ErrorAuth implements Exception {
  ErrorAuth(this.tipo, this.mensaje);
  final String tipo;
  final String mensaje;
  @override
  String toString() => mensaje;
}

class Perfil {
  Perfil({required this.usuario, required this.nombre, required this.roles});
  final String usuario;
  final String nombre;
  final List<String> roles;

  String get rol => roles.isEmpty ? 'estudiante' : roles.first;
  bool tieneAlguno(List<String> cuales) => roles.any(cuales.contains);

  Map<String, dynamic> aJson() => {'usuario': usuario, 'nombre': nombre, 'roles': roles};
  static Perfil deJson(Map<String, dynamic> j) => Perfil(
        usuario: j['usuario'] ?? '',
        nombre: j['nombre'] ?? j['usuario'] ?? '',
        roles: (j['roles'] as List?)?.map((e) => '$e').toList() ?? const [],
      );
}

class Sesion {
  Sesion({required this.perfil, required this.accessToken, this.refreshToken});
  final Perfil perfil;
  final String accessToken;
  final String? refreshToken;
}

const _prioridad = ['administrador', 'nutricionista', 'cocina_almacen', 'servicio_caja', 'estudiante'];

Map<String, dynamic> decodificarJwt(String token) {
  final partes = token.split('.');
  if (partes.length < 2) throw const FormatException('token inválido');
  var p = partes[1].replaceAll('-', '+').replaceAll('_', '/');
  p = p.padRight(p.length + (4 - p.length % 4) % 4, '=');
  return jsonDecode(utf8.decode(base64.decode(p))) as Map<String, dynamic>;
}

Perfil perfilDeToken(String token) {
  final p = decodificarJwt(token);
  final crudos = ((p['realm_access']?['roles'] as List?) ?? const [])
      .map((e) => '$e')
      .where((r) => !r.startsWith('default-') && !r.startsWith('offline') && !r.startsWith('uma'))
      .toList();
  // el rol que manda primero, para que la app sepa qué mostrar
  crudos.sort((a, b) => (_prioridad.indexOf(a) < 0 ? 99 : _prioridad.indexOf(a))
      .compareTo(_prioridad.indexOf(b) < 0 ? 99 : _prioridad.indexOf(b)));
  return Perfil(
    usuario: p['preferred_username'] ?? '',
    nombre: p['name'] ?? p['preferred_username'] ?? '',
    roles: crudos,
  );
}

// ----------------------------- Keycloak -----------------------------

Future<Map<String, dynamic>> _pedirToken(Config cfg, Map<String, String> datos, {int ms = 15000}) async {
  try {
    final r = await http
        .post(Uri.parse('${cfg.keycloak}/realms/${cfg.realm}/protocol/openid-connect/token'),
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body: {'client_id': cfg.clientId, 'scope': 'openid', ...datos})
        .timeout(Duration(milliseconds: ms));
    if (r.statusCode == 400 || r.statusCode == 401) {
      final j = jsonDecode(r.body) as Map<String, dynamic>;
      throw ErrorAuth(
          'credenciales',
          j['error'] == 'invalid_grant' && datos['grant_type'] == 'refresh_token'
              ? 'La sesión guardada venció.'
              : 'Usuario o contraseña incorrectos.');
    }
    if (r.statusCode >= 300) throw ErrorAuth('servidor', 'El servidor de cuentas respondió ${r.statusCode}.');
    return jsonDecode(r.body) as Map<String, dynamic>;
  } on ErrorAuth {
    rethrow;
  } catch (_) {
    throw ErrorAuth('red', 'No hay conexión con el servidor de cuentas.');
  }
}

Future<Sesion> iniciarSesion(String usuario, String clave, Config cfg) async {
  final j = await _pedirToken(cfg, {'grant_type': 'password', 'username': usuario.trim(), 'password': clave});
  return Sesion(
      perfil: perfilDeToken(j['access_token']), accessToken: j['access_token'], refreshToken: j['refresh_token']);
}

Future<Sesion> renovarSesion(String refreshToken, Config cfg) async {
  final j = await _pedirToken(cfg, {'grant_type': 'refresh_token', 'refresh_token': refreshToken}, ms: 10000);
  return Sesion(
      perfil: perfilDeToken(j['access_token']), accessToken: j['access_token'], refreshToken: j['refresh_token']);
}

// ----------------------------- contraseña local (para ingresar sin internet) -----------------------------

const _vueltas = 2500;

String _derivar(String clave, String sal) {
  var h = '$sal:$clave';
  for (var i = 0; i < _vueltas; i++) {
    h = sha256.convert(utf8.encode(h)).toString();
  }
  return h;
}

/// Guarda una copia protegida de la contraseña para poder entrar luego sin internet.
Future<void> recordarClave(String usuario, String clave) async {
  final r = Random.secure();
  final sal = List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  await guardar('clave', {'usuario': usuario, 'sal': sal, 'hash': _derivar(clave, sal)});
}

/// `true` si la contraseña coincide con la copia guardada de ese usuario.
Future<bool> verificarClaveLocal(String usuario, String clave) async {
  final g = await leer('clave');
  if (g is! Map || g['usuario'] != usuario || g['sal'] == null) return false;
  return _derivar(clave, g['sal']) == g['hash'];
}
