// Ajustes: con qué cuenta estás, ingreso con patrón, direcciones del servidor y cerrar sesión.
import 'package:flutter/material.dart';

import '../config.dart';
import '../cuenta/almacen.dart';
import '../cuenta/auth.dart';
import '../cuenta/bloqueo.dart';
import '../tema.dart';

class Ajustes extends StatefulWidget {
  const Ajustes({super.key, required this.perfil, required this.cfg, required this.bioActiva,
    required this.onBio, required this.onSalir});

  final Perfil perfil;
  final Config cfg;
  final bool bioActiva;
  final ValueChanged<bool> onBio;
  final Future<void> Function({bool olvidar}) onSalir;

  @override
  State<Ajustes> createState() => _AjustesState();
}

class _AjustesState extends State<Ajustes> {
  String _aviso = '';

  Future<void> _alternarPatron(bool v) async {
    if (!v) {
      await guardar('bio', false);
      widget.onBio(false);
      setState(() => _aviso = 'Ingreso con patrón desactivado.');
      return;
    }
    final r = await pedirBloqueo('Confirma tu patrón para activar el ingreso rápido');
    if (r.ok) {
      await guardar('bio', true);
      widget.onBio(true);
      setState(() => _aviso = 'Listo: ya puedes entrar con el patrón de tu teléfono, incluso sin internet.');
    } else if (!r.cancelado) {
      setState(() => _aviso = r.motivo ?? 'No pude activar el ingreso con patrón.');
    }
  }

  Future<void> _confirmarSalida() async {
    final r = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        backgroundColor: C.tarjeta,
        title: const Text('Cerrar sesión'),
        content: const Text('¿Quieres también borrar del teléfono tus datos guardados (ingreso con patrón, historial y fotos pendientes)?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, 'cancelar'), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(c, 'salir'), child: const Text('Solo salir')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: C.rojo),
            onPressed: () => Navigator.pop(c, 'borrar'),
            child: const Text('Salir y borrar'),
          ),
        ],
      ),
    );
    if (r == null || r == 'cancelar') return;
    await widget.onSalir(olvidar: r == 'borrar');
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ajustes')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Tarjeta(titulo: 'Tu cuenta', hijos: [
          Row(children: [
            CircleAvatar(radius: 24, backgroundColor: C.naranja,
                child: Text(widget.perfil.nombre.isNotEmpty ? widget.perfil.nombre[0].toUpperCase() : '?',
                    style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold))),
            const SizedBox(width: 14),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(widget.perfil.nombre, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
              Text(widget.perfil.usuario, style: const TextStyle(color: C.suave, fontSize: 12)),
              Text(widget.perfil.roles.map((r) => etiquetaRol[r] ?? r).join(' · '),
                  style: const TextStyle(color: C.cian, fontSize: 12)),
            ])),
          ]),
        ]),

        Tarjeta(titulo: 'Ingreso', hijos: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: widget.bioActiva,
            onChanged: _alternarPatron,
            activeThumbColor: C.naranja,
            title: const Text('Entrar con el patrón del teléfono', style: TextStyle(color: Colors.white, fontSize: 15)),
            subtitle: const Text('Usa el bloqueo de pantalla de tu teléfono; funciona sin internet', style: TextStyle(color: C.tenue, fontSize: 12)),
          ),
        ]),

        Tarjeta(titulo: 'Servidor', hijos: [
          _Dato('Comedor', widget.cfg.api),
          _Dato('Cuentas', widget.cfg.keycloak),
          const Padding(padding: EdgeInsets.only(top: 8),
              child: Text('Para cambiarlos, cierra sesión y tócalos en la pantalla de ingreso («Servidor»).',
                  style: TextStyle(color: C.tenue, fontSize: 11.5))),
        ]),

        Tarjeta(titulo: 'Cómo trabaja la app', hijos: [
          const Text('• Los reportes los arma el servidor del comedor, con los datos que tu rol permite.\n'
              '• «Desperdicio por foto» analiza la bandeja dentro del teléfono con TensorFlow Lite: funciona sin internet '
              'y se envía solo cuando vuelve la señal.',
              style: TextStyle(color: C.suave, fontSize: 12.5, height: 1.5)),
        ]),

        if (_aviso.isNotEmpty) Aviso(_aviso, tipo: 'ok'),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _confirmarSalida,
          style: OutlinedButton.styleFrom(foregroundColor: C.rojo, side: const BorderSide(color: C.rojo)),
          icon: const Icon(Icons.logout),
          label: const Text('Cerrar sesión'),
        ),
        const SizedBox(height: 30),
      ]),
    );
  }
}

class _Dato extends StatelessWidget {
  const _Dato(this.etiqueta, this.valor);
  final String etiqueta;
  final String valor;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 78, child: Text(etiqueta, style: const TextStyle(color: C.suave, fontSize: 12.5))),
          Expanded(child: Text(valor, style: const TextStyle(color: C.texto, fontSize: 12.5))),
        ]),
      );
}
