// Asistencia del personal: marcar entrada y salida desde el celular, con la ubicación.
// La app solo manda las coordenadas; QUIÉN cuenta como presente lo decide el servidor comparando con el comedor.
// Solo se pide la ubicación al tocar el botón: no hay seguimiento, ni en segundo plano.
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../cuenta/auth.dart';
import '../datos/api.dart';
import '../tema.dart';

String _hora(String? iso) {
  if (iso == null) return '';
  try {
    final d = DateTime.parse(iso).toLocal();
    String p(int n) => n.toString().padLeft(2, '0');
    return '${p(d.day)}/${p(d.month)} ${p(d.hour)}:${p(d.minute)}';
  } catch (_) {
    return '';
  }
}

class AsistenciaPantalla extends StatefulWidget {
  const AsistenciaPantalla({super.key, required this.perfil, required this.api, required this.enLinea, required this.onMenu});
  final Perfil perfil;
  final Api api;
  final bool enLinea;
  final VoidCallback onMenu;

  @override
  State<AsistenciaPantalla> createState() => _AsistenciaPantallaState();
}

class _AsistenciaPantallaState extends State<AsistenciaPantalla> {
  Map<String, dynamic>? _estado;      // {presente, desde, marcas[]}
  Map<String, dynamic>? _lugar;       // {lat, lon, radioM}
  bool _cargando = false;
  String _error = '';
  String _aviso = '';
  String _paso = '';

  @override
  void initState() {
    super.initState();
    _refrescar();
  }

  Future<void> _refrescar() async {
    try {
      final e = await widget.api.get('/asistencia/${widget.perfil.usuario}');
      final l = await widget.api.get('/asistencia/lugar');
      if (mounted) setState(() { _estado = Map<String, dynamic>.from(e); _lugar = Map<String, dynamic>.from(l); });
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.sinRed ? 'Sin conexión: para marcar necesitas red.' : e.mensaje);
    }
  }

  /// Pide la ubicación solo en este momento. Devuelve null y deja el motivo en `_error` si no se puede.
  Future<Position?> _ubicacion() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      setState(() => _error = 'Enciende la ubicación del teléfono para marcar.');
      return null;
    }
    var permiso = await Geolocator.checkPermission();
    if (permiso == LocationPermission.denied) permiso = await Geolocator.requestPermission();
    if (permiso == LocationPermission.denied) {
      setState(() => _error = 'Necesito el permiso de ubicación para registrar dónde marcas.');
      return null;
    }
    if (permiso == LocationPermission.deniedForever) {
      setState(() => _error = 'El permiso de ubicación está bloqueado. Actívalo en los ajustes del teléfono.');
      return null;
    }
    try {
      setState(() => _paso = 'Buscando tu ubicación por GPS…');
      // `best` fuerza el GPS del teléfono (satélites), no solo WiFi y antenas.
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 35)),
      );
    } catch (_) {
      // Bajo techo el GPS a veces no fija a tiempo: se reintenta aceptando WiFi y antenas.
      try {
        setState(() => _paso = 'El GPS tarda; probando con la red…');
        return await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 20)),
        );
      } catch (_) {
        final ultima = await Geolocator.getLastKnownPosition();
        if (ultima == null) {
          setState(() => _error = 'No pude leer tu ubicación. Asegúrate de tener el GPS encendido e inténtalo otra vez.');
        }
        return ultima;
      }
    }
  }

  Future<void> _marcar(String tipo) async {
    setState(() { _cargando = true; _error = ''; _aviso = ''; });
    try {
      final p = await _ubicacion();
      if (p == null) return;
      setState(() => _paso = 'Registrando la marca…');
      final r = await widget.api.post('/asistencia/marcar', {
        'usuario': widget.perfil.usuario,
        'rol': widget.perfil.rol,
        'tipo': tipo,
        'lat': p.latitude,
        'lon': p.longitude,
        'simulada': p.isMocked,
        'marcadaEn': DateTime.now().toUtc().toIso8601String(),
      });
      await _refrescar();
      if (!mounted) return;
      // Fuera del radio el servidor NO la registra y responde con el motivo (cae en el catch de abajo)
      final precision = p.accuracy.round();
      setState(() => _aviso = '${tipo == 'entrada' ? 'Entrada' : 'Salida'} registrada a ${r['distanciaM']} m del comedor '
          '(GPS con ±$precision m de precisión).');
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.sinRed ? 'Sin conexión: para marcar necesitas red.' : e.mensaje);
    } finally {
      if (mounted) setState(() { _cargando = false; _paso = ''; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final est = _estado;
    final presente = est?['presente'] == true;
    final marcas = List<Map<String, dynamic>>.from((est?['marcas'] as List?)?.map((m) => Map<String, dynamic>.from(m)) ?? []);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.menu), onPressed: widget.onMenu),
        title: const Text('Mi asistencia'),
        titleTextStyle: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _refrescar)],
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Tarjeta(hijos: [
          Row(children: [
            Container(
              width: 52, height: 52,
              decoration: BoxDecoration(
                color: (presente ? C.verde : C.tenue).withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(presente ? Icons.work_history : Icons.work_off_outlined,
                  color: presente ? C.verde : C.tenue, size: 26),
            ),
            const SizedBox(width: 14),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(presente ? 'En turno' : 'Fuera de turno',
                  style: TextStyle(color: presente ? C.verde : C.texto, fontSize: 18, fontWeight: FontWeight.bold)),
              Text(presente ? 'Desde las ${_hora(est?['desde'])}' : 'Marca tu entrada al llegar',
                  style: const TextStyle(color: C.suave, fontSize: 12.5)),
            ])),
          ]),
          const SizedBox(height: 16),
          if (_cargando)
            Row(children: [
              const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: C.naranja)),
              const SizedBox(width: 10),
              Text(_paso, style: const TextStyle(color: C.texto)),
            ])
          else
            Row(children: [
              Expanded(child: FilledButton.icon(
                onPressed: presente ? null : () => _marcar('entrada'),
                icon: const Icon(Icons.login),
                label: const Text('Marcar entrada'),
              )),
              const SizedBox(width: 10),
              Expanded(child: OutlinedButton.icon(
                onPressed: presente ? () => _marcar('salida') : null,
                icon: const Icon(Icons.logout),
                label: const Text('Marcar salida'),
              )),
            ]),
          if (_error.isNotEmpty) Aviso(_error),
          if (_aviso.isNotEmpty) Aviso(_aviso, tipo: 'ok'),
        ]),

        Tarjeta(titulo: 'Cómo se registra', hijos: [
          Text(
            'Al tocar el botón se toma tu ubicación una sola vez y se envía con la marca. '
            'El servidor calcula la distancia al comedor${_lugar != null ? ' y solo la registra si estás dentro de ${_lugar!['radioM']} m' : ''}; '
            'fuera de ese radio la marca no se guarda. '
            'La app no te sigue ni usa la ubicación en segundo plano.',
            style: const TextStyle(color: C.suave, fontSize: 12.5, height: 1.5),
          ),
        ]),

        if (marcas.isNotEmpty)
          Tarjeta(titulo: 'Tus últimas marcas', hijos: [
            for (final m in marcas.take(10))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(children: [
                  Icon(m['tipo'] == 'entrada' ? Icons.login : Icons.logout,
                      size: 16, color: m['tipo'] == 'entrada' ? C.verde : C.suave),
                  const SizedBox(width: 10),
                  Expanded(child: Text('${m['tipo'] == 'entrada' ? 'Entrada' : 'Salida'} · ${_hora(m['marcadaEn'])}',
                      style: const TextStyle(color: C.texto, fontSize: 13))),
                  Text('${m['distanciaM']} m',
                      style: TextStyle(color: m['dentro'] == true ? C.tenue : C.ambar, fontSize: 12)),
                  if (m['simulada'] == true)
                    const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.warning_amber, size: 15, color: C.ambar)),
                ]),
              ),
          ]),
        const SizedBox(height: 30),
      ]),
    );
  }
}
