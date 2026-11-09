// Comedor Universitario UAGRM — app móvil (Flutter).
//   · Reportes por texto o por voz (el motor vive en el servidor: una sola implementación para todos los clientes)
//   · Desperdicio por foto con IA DENTRO del teléfono (TensorFlow Lite), funciona sin internet
// Ingreso con usuario y contraseña (Keycloak) o huella; menú lateral según el rol.
import 'dart:async';

import 'package:flutter/material.dart';

import 'config.dart';
import 'cuenta/almacen.dart';
import 'cuenta/auth.dart';
import 'cuenta/bloqueo.dart';
import 'datos/api.dart';
import 'notificaciones.dart';
import 'pantallas/ajustes.dart';
import 'pantallas/asistencia.dart';
import 'pantallas/desperdicio.dart';
import 'pantallas/login.dart';
import 'pantallas/reportes.dart';
import 'reportes/local.dart' show iaLocal;
import 'tema.dart';
import 'vision/cola.dart' show borrarEstado;

/// Para mostrar avisos sobre cualquier pantalla (los push que llegan con la app abierta).
final carteles = GlobalKey<ScaffoldMessengerState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Notificaciones.iniciar();
  runApp(const AppComedor());
}

/// Quién puede usar «Desperdicio por foto»: el personal del comedor (el estudiante no analiza bandejas).
const rolesVision = ['administrador', 'nutricionista', 'cocina_almacen', 'servicio_caja'];

/// Quién marca asistencia: administración y cocina.
const rolesAsistencia = ['administrador', 'cocina_almacen'];

class AppComedor extends StatelessWidget {
  const AppComedor({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Comedor UAGRM',
        debugShowCheckedModeBanner: false,
        scaffoldMessengerKey: carteles,
        theme: temaComedor(),
        home: const Raiz(),
      );
}

class Raiz extends StatefulWidget {
  const Raiz({super.key});

  @override
  State<Raiz> createState() => _RaizState();
}

class _RaizState extends State<Raiz> {
  Config _cfg = const Config();
  Perfil? _perfilGuardado;
  bool _bioActiva = false;
  bool _listo = false;

  Perfil? _perfil;
  String _token = '';
  bool _enLinea = true;
  String _pantalla = 'reportes';
  int _porEnviar = 0;
  StreamSubscription<bool>? _red;

  @override
  void initState() {
    super.initState();
    _arrancar();
    _red = cambiosDeRed().listen((c) => mounted ? setState(() => _enLinea = c) : null);
  }

  @override
  void dispose() {
    _red?.cancel();
    super.dispose();
  }

  Future<void> _arrancar() async {
    final cfg = await leer('cfg');
    final perfil = await leer('perfil');
    final bio = await leer('bio');
    final red = await hayRed();
    if (!mounted) return;
    setState(() {
      _cfg = Config.deJson(cfg is Map ? Map<String, dynamic>.from(cfg) : null);
      _perfilGuardado = perfil is Map ? Perfil.deJson(Map<String, dynamic>.from(perfil)) : null;
      _bioActiva = bio == true;
      _enLinea = red;
      _listo = true;
    });
  }

  /// Token vigente: el de acceso dura minutos, así que se renueva con el de refresco antes de hablar con el servidor.
  Future<String?> _obtenerToken() async {
    final refresh = await leer('refresh');
    if (refresh is String && refresh.isNotEmpty) {
      try {
        final s = await renovarSesion(refresh, _cfg);
        await guardar('refresh', s.refreshToken);
        if (mounted) setState(() => _token = s.accessToken);
        return s.accessToken;
      } catch (_) {/* sin internet o sesión vencida: se usa lo que haya */}
    }
    return _token.isEmpty ? null : _token;
  }

  Future<void> _ofrecerHuella() async {
    if (await leer('bio') != null) return;               // ya decidió antes
    if (!await bloqueoDisponible() || !mounted) return;
    final quiere = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        backgroundColor: C.tarjeta,
        title: const Text('¿Entrar con el patrón de tu teléfono?'),
        content: const Text('Es más rápido que escribir tu contraseña y funciona sin internet.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Ahora no')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Activar')),
        ],
      ),
    );
    if (quiere != true) {
      await guardar('bio', false);
      return;
    }
    final r = await pedirBloqueo('Confirma tu patrón para activar el ingreso rápido');
    if (r.ok) {
      await guardar('bio', true);
      if (mounted) setState(() => _bioActiva = true);
    } else if (!r.cancelado && mounted) {
      carteles.currentState?.showSnackBar(SnackBar(content: Text(r.motivo ?? 'No pude activar el ingreso con patrón.')));
    }
  }

  void _entrar(Perfil perfil, String token, String? refresh, bool enLinea) {
    setState(() {
      _perfil = perfil;
      _perfilGuardado = perfil;
      _token = token;
      _enLinea = enLinea || _enLinea;
      _pantalla = 'reportes';
    });
    Future.delayed(const Duration(milliseconds: 700), _ofrecerHuella);
    _activarPush(perfil);
  }

  /// Registra este teléfono para recibir avisos de esta cuenta (si algo falla, la app sigue igual).
  Future<void> _activarPush(Perfil perfil) async {
    final motivo = await Notificaciones.registrar(Api(_cfg, _obtenerToken), perfil);
    if (motivo != null && mounted) {
      carteles.currentState?.showSnackBar(SnackBar(content: Text(motivo), duration: const Duration(seconds: 6)));
    }
  }

  Future<void> _salir({bool olvidar = false}) async {
    await Notificaciones.darDeBaja(Api(_cfg, _obtenerToken));
    if (olvidar) {
      for (final k in ['bio', 'refresh', 'perfil', 'clave', 'historial']) {
        await borrar(k);
      }
      await borrarEstado();
      await iaLocal.olvidar();          // la copia de datos de reportes también se borra del teléfono
    }
    if (!mounted) return;
    setState(() {
      _perfil = null;
      _token = '';
      _porEnviar = 0;
      if (olvidar) { _perfilGuardado = null; _bioActiva = false; }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_listo) {
      return const Scaffold(body: Center(child: CircularProgressIndicator(color: C.naranja)));
    }
    final perfil = _perfil;
    if (perfil == null) {
      return Login(
        cfg: _cfg,
        onCfg: (c) => setState(() => _cfg = c),
        perfilGuardado: _perfilGuardado,
        bioActiva: _bioActiva,
        onEntrar: _entrar,
      );
    }
    final api = Api(_cfg, _obtenerToken);
    final puedeVision = perfil.tieneAlguno(rolesVision);
    final puedeAsistencia = perfil.tieneAlguno(rolesAsistencia);
    final verVision = _pantalla == 'desperdicio' && puedeVision;
    final verAsistencia = _pantalla == 'asistencia' && puedeAsistencia;
    return Scaffold(
      drawer: _Menu(
        perfil: perfil,
        pantalla: verVision ? 'desperdicio' : verAsistencia ? 'asistencia' : 'reportes',
        enLinea: _enLinea,
        pendientes: _porEnviar,
        puedeVision: puedeVision,
        puedeAsistencia: puedeAsistencia,
        onIr: (id) {
          Navigator.pop(context);
          if (id == 'ajustes') {
            Navigator.push(context, MaterialPageRoute(builder: (_) => Ajustes(
              perfil: perfil, cfg: _cfg, bioActiva: _bioActiva,
              onBio: (v) => setState(() => _bioActiva = v),
              onSalir: _salir,
            )));
          } else {
            setState(() => _pantalla = id);
          }
        },
      ),
      body: Builder(builder: (ctx) {
        abrir() => Scaffold.of(ctx).openDrawer();
        if (verVision) {
          return Desperdicio(api: api, enLinea: _enLinea, onMenu: abrir, onPendientes: (n) => setState(() => _porEnviar = n));
        }
        if (verAsistencia) {
          return AsistenciaPantalla(perfil: perfil, api: api, enLinea: _enLinea, onMenu: abrir);
        }
        return Reportes(perfil: perfil, api: api, enLinea: _enLinea, onMenu: abrir);
      }),
    );
  }
}

class _Menu extends StatelessWidget {
  const _Menu({required this.perfil, required this.pantalla, required this.enLinea, required this.pendientes,
    required this.puedeVision, required this.puedeAsistencia, required this.onIr});

  final Perfil perfil;
  final String pantalla;
  final bool enLinea;
  final int pendientes;
  final bool puedeVision;
  final bool puedeAsistencia;
  final ValueChanged<String> onIr;

  @override
  Widget build(BuildContext context) {
    final items = [
      ('reportes', Icons.insert_chart_outlined, 'Reportes', 'Por voz o texto'),
      if (puedeVision) ('desperdicio', Icons.photo_camera_outlined, 'Desperdicio por foto', 'IA local (TensorFlow Lite)'),
      if (puedeAsistencia) ('asistencia', Icons.how_to_reg_outlined, 'Mi asistencia', 'Marcar entrada y salida'),
      ('ajustes', Icons.settings_outlined, 'Ajustes', 'Cuenta, huella y servidor'),
    ];
    return Drawer(
      backgroundColor: C.tarjeta2,
      child: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 44, height: 44,
                decoration: BoxDecoration(color: C.naranja, borderRadius: BorderRadius.circular(10)),
                child: const Center(child: Text('CU', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800))),
              ),
              const SizedBox(height: 10),
              const Text('Comedor UAGRM', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
              Text('${perfil.nombre} · ${etiquetaRol[perfil.rol] ?? perfil.rol}',
                  style: const TextStyle(color: C.suave, fontSize: 12), overflow: TextOverflow.ellipsis),
              const SizedBox(height: 6),
              Text(enLinea ? '● En línea' : '● Sin conexión (la IA local sigue funcionando)',
                  style: TextStyle(color: enLinea ? C.verde : C.ambar, fontSize: 11)),
            ]),
          ),
          const Divider(color: C.borde, height: 1),
          for (final i in items)
            ListTile(
              leading: Icon(i.$2, color: pantalla == i.$1 ? C.naranja : C.suave),
              title: Text(i.$3, style: TextStyle(color: pantalla == i.$1 ? Colors.white : C.texto, fontWeight: FontWeight.w600, fontSize: 15)),
              subtitle: Text(i.$4, style: const TextStyle(color: C.tenue, fontSize: 11.5)),
              selected: pantalla == i.$1,
              selectedTileColor: C.naranja.withValues(alpha: 0.12),
              trailing: i.$1 == 'desperdicio' && pendientes > 0
                  ? Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(color: C.ambar, borderRadius: BorderRadius.circular(10)),
                      child: Text('$pendientes', style: const TextStyle(color: Colors.black, fontSize: 11, fontWeight: FontWeight.bold)))
                  : null,
              onTap: () => onIr(i.$1),
            ),
        ]),
      ),
    );
  }
}
