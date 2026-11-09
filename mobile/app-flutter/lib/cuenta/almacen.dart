// Almacenamiento seguro del teléfono (Android Keystore): perfil, token de refresco, huella y configuración.
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _opciones = AndroidOptions(encryptedSharedPreferences: true);
const _s = FlutterSecureStorage(aOptions: _opciones);

const _claves = {
  'perfil': 'perfil',
  'refresh': 'refresh_token',
  'bio': 'bio_activa',
  'clave': 'clave_local',
  'cfg': 'config_servidor',
  'historial': 'historial',
};

String _k(String k) => _claves[k] ?? k;

Future<dynamic> leer(String k, [dynamic defecto]) async {
  try {
    final v = await _s.read(key: _k(k));
    return v == null ? defecto : jsonDecode(v);
  } catch (_) {
    return defecto;
  }
}

Future<void> guardar(String k, dynamic v) async {
  try {
    await _s.write(key: _k(k), value: jsonEncode(v));
  } catch (_) {/* el teléfono no dejó escribir: se sigue sin recordar */}
}

Future<void> borrar(String k) async {
  try {
    await _s.delete(key: _k(k));
  } catch (_) {/* nada que borrar */}
}
