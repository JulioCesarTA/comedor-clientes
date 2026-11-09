// Ingreso: usuario y contraseña (Keycloak) o patrón del teléfono. La primera vez necesita internet; después entra sin conexión.
import 'package:flutter/material.dart';

import '../config.dart';
import '../cuenta/almacen.dart';
import '../cuenta/auth.dart';
import '../cuenta/bloqueo.dart';
import '../tema.dart';

class Login extends StatefulWidget {
  const Login({super.key, required this.cfg, required this.onCfg, required this.perfilGuardado,
    required this.bioActiva, required this.onEntrar});

  final Config cfg;
  final ValueChanged<Config> onCfg;
  final Perfil? perfilGuardado;
  final bool bioActiva;
  final void Function(Perfil perfil, String token, String? refresh, bool enLinea) onEntrar;

  @override
  State<Login> createState() => _LoginState();
}

class _LoginState extends State<Login> {
  final _usuario = TextEditingController();
  final _clave = TextEditingController();
  final _api = TextEditingController();
  final _kc = TextEditingController();
  bool _cargando = false;
  bool _verServidor = false;
  String _error = '';
  String _aviso = '';

  @override
  void initState() {
    super.initState();
    _usuario.text = widget.perfilGuardado?.usuario ?? '';
    _api.text = widget.cfg.api;
    _kc.text = widget.cfg.keycloak;
    if (widget.bioActiva && widget.perfilGuardado != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _conPatron());
    }
  }

  @override
  void dispose() {
    _usuario.dispose(); _clave.dispose(); _api.dispose(); _kc.dispose();
    super.dispose();
  }

  Future<void> _conPatron() async {
    final p = widget.perfilGuardado;
    if (p == null) return;
    final r = await pedirBloqueo('Confirma tu patrón para entrar al comedor');
    if (!mounted) return;
    if (!r.ok) {
      if (!r.cancelado) setState(() => _error = '${r.motivo} Entra con tu contraseña.');
      return;
    }
    final refresh = await leer('refresh');
    String? token;
    try {
      if (refresh is String) {
        final s = await renovarSesion(refresh, widget.cfg);
        await guardar('refresh', s.refreshToken);
        token = s.accessToken;
      }
    } catch (_) {/* sin internet: se entra igual, con los datos guardados */}
    if (mounted) widget.onEntrar(p, token ?? '', refresh is String ? refresh : null, token != null);
  }

  Future<void> _entrar() async {
    final usuario = _usuario.text.trim(), clave = _clave.text;
    if (usuario.isEmpty || clave.isEmpty) {
      setState(() => _error = 'Escribe tu usuario y tu contraseña.');
      return;
    }
    setState(() { _cargando = true; _error = ''; _aviso = ''; });
    final cfg = widget.cfg.copiaCon(api: _api.text, keycloak: _kc.text);
    widget.onCfg(cfg);
    await guardar('cfg', cfg.aJson());
    try {
      final s = await iniciarSesion(usuario, clave, cfg);
      await guardar('perfil', s.perfil.aJson());
      await guardar('refresh', s.refreshToken);
      await recordarClave(usuario, clave);
      if (mounted) widget.onEntrar(s.perfil, s.accessToken, s.refreshToken, true);
    } on ErrorAuth catch (e) {
      // sin internet: se acepta la contraseña contra la copia guardada en el teléfono
      if (e.tipo == 'red' && await verificarClaveLocal(usuario, clave)) {
        final g = await leer('perfil');
        if (g is Map && mounted) {
          widget.onEntrar(Perfil.deJson(Map<String, dynamic>.from(g)), '', await leer('refresh'), false);
          return;
        }
      }
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(22),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const SizedBox(height: 40),
            Center(
              child: Container(
                width: 76, height: 76,
                decoration: BoxDecoration(color: C.naranja, borderRadius: BorderRadius.circular(18)),
                child: const Center(child: Text('CU', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800))),
              ),
            ),
            const SizedBox(height: 16),
            const Center(child: Text('Comedor Universitario', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold))),
            const Center(child: Text('UAGRM', style: TextStyle(color: C.suave, fontSize: 14))),
            const SizedBox(height: 28),
            const Etiqueta('Usuario'),
            TextField(controller: _usuario, autocorrect: false, textInputAction: TextInputAction.next,
                decoration: const InputDecoration(hintText: 'estudiante.demo')),
            const Etiqueta('Contraseña', arriba: 14),
            TextField(controller: _clave, obscureText: true, onSubmitted: (_) => _entrar(),
                decoration: const InputDecoration(hintText: '••••••')),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: _cargando ? null : _entrar,
              child: _cargando
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Ingresar'),
            ),
            if (widget.bioActiva && widget.perfilGuardado != null)
              TextButton.icon(onPressed: _conPatron, icon: const Icon(Icons.pattern, color: C.cian),
                  label: const Text('Entrar con mi patrón', style: TextStyle(color: C.cian))),
            if (_error.isNotEmpty) Aviso(_error),
            if (_aviso.isNotEmpty) Aviso(_aviso, tipo: 'ok'),
            const SizedBox(height: 18),
            TextButton(
              onPressed: () => setState(() => _verServidor = !_verServidor),
              child: Text(_verServidor ? 'Ocultar servidor' : 'Servidor', style: const TextStyle(color: C.tenue, fontSize: 13)),
            ),
            if (_verServidor) ...[
              const Etiqueta('Servidor del comedor'),
              TextField(controller: _api, autocorrect: false, keyboardType: TextInputType.url),
              const Etiqueta('Servidor de cuentas', arriba: 12),
              TextField(controller: _kc, autocorrect: false, keyboardType: TextInputType.url),
              const SizedBox(height: 8),
              const Text('Cámbialos solo si el comedor te dio otras direcciones.',
                  style: TextStyle(color: C.tenue, fontSize: 11.5)),
            ],
          ]),
        ),
      ),
    );
  }
}
