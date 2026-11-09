// Notificaciones push (Firebase Cloud Messaging).
//   · Al iniciar sesión el teléfono pide permiso, obtiene su token y lo registra en el servidor para ese usuario.
//   · Con la app cerrada o en segundo plano, Android muestra el aviso solo.
//   · Con la app abierta se muestra como un cartel dentro de la pantalla.
//   · Al cerrar sesión el token se da de baja: ese teléfono deja de recibir los avisos de esa cuenta.
// Si Firebase no está disponible (por ejemplo, un teléfono sin Google Play Services) la app sigue funcionando sin push.
import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/services.dart';

import 'cuenta/auth.dart';
import 'datos/api.dart';
import 'firebase_options.dart';

class Notificaciones {
  static bool _listo = false;
  static String? _token;
  static StreamSubscription<String>? _renovacion;

  static const _puente = MethodChannel('comedor/sistema');

  /// Se llama una vez en main(). Nunca lanza: sin Firebase simplemente no hay push.
  static Future<void> iniciar() async {
    try {
      await Firebase.initializeApp(options: DefaultFirebaseOptions.android);
      FirebaseMessaging.onMessage.listen(_mostrarComoNotificacion);
      _listo = true;
    } catch (_) {
      _listo = false;
    }
  }

  /// Con la app abierta Android no muestra solo el aviso de Firebase: se pide como notificación del sistema
  /// (barra de estado y cartel emergente), igual que si la app estuviera cerrada.
  static Future<void> _mostrarComoNotificacion(RemoteMessage m) async {
    final n = m.notification;
    if (n == null) return;
    try {
      await _puente.invokeMethod('mostrar', {'titulo': n.title ?? 'Comedor UAGRM', 'cuerpo': n.body ?? ''});
    } catch (_) {/* sin puente nativo (pruebas): no hay nada que mostrar */}
  }

  /// Pide permiso (Android 13 lo exige), toma el token y lo registra para este usuario. Devuelve un texto si algo falló.
  static Future<String?> registrar(Api api, Perfil perfil) async {
    if (!_listo) return 'Las notificaciones no están disponibles en este teléfono.';
    try {
      final m = FirebaseMessaging.instance;
      final permiso = await m.requestPermission();
      if (permiso.authorizationStatus == AuthorizationStatus.denied) {
        return 'Las notificaciones están desactivadas para la app. Actívalas en los ajustes del teléfono.';
      }
      // getToken() figura como obsoleto en firebase_messaging 17, pero es el token clásico que acepta el envío
      // FCM v1 (`messages:send`) que usa el servidor. register()/onRegistered devuelven otro identificador (FID)
      // para un envío directo distinto. Se cambia cuando el servidor lo soporte y se pruebe en un teléfono.
      // ignore: deprecated_member_use
      final token = await m.getToken();
      if (token == null) return 'No pude obtener el identificador de este teléfono.';
      _token = token;
      await _enviarToken(api, perfil, token);
      await _renovacion?.cancel();
      // ignore: deprecated_member_use
      _renovacion = m.onTokenRefresh.listen((t) {         // Firebase rota el token de vez en cuando
        _token = t;
        _enviarToken(api, perfil, t).catchError((_) {});
      });
      return null;
    } on ErrorApi catch (e) {
      return e.sinRed ? 'Sin conexión: las notificaciones se activarán cuando haya red.' : e.mensaje;
    } catch (e) {
      return 'No pude activar las notificaciones: $e';
    }
  }

  static Future<void> _enviarToken(Api api, Perfil perfil, String token) =>
      api.post('/agentes/push/dispositivo', {'token': token, 'usuario': perfil.usuario, 'roles': perfil.roles, 'plataforma': 'android'});

  /// Al cerrar sesión: este teléfono deja de recibir los avisos de la cuenta. Es de mejor esfuerzo.
  static Future<void> darDeBaja(Api api) async {
    final t = _token;
    await _renovacion?.cancel();
    _renovacion = null;
    if (t == null) return;
    try {
      await api.post('/agentes/push/baja', {'token': t}, espera: const Duration(seconds: 10));
    } catch (_) {/* sin red: el servidor lo borra solo cuando Firebase lo rechace */}
    _token = null;
  }
}
