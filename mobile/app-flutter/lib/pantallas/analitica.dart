// Agrupación de platos (K-Means): la misma vista del BI web, en el teléfono.
// Con internet pide al servidor (/ml/agrupar-platos) y guarda una copia en el teléfono;
// sin internet muestra esa copia («Sin conexión · últimos datos de las HH:MM»).
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

import '../datos/api.dart';
import '../tema.dart';

const _coloresGrupo = [C.verde, C.cian, C.naranja, C.morado, C.rojo];

String _corto(String id) => id.replaceFirst('plato-', '');
Color _colorGrupo(int cluster) => _coloresGrupo[cluster % _coloresGrupo.length];
String _hhmm(DateTime d) => '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

Color _colorAccion(String accion) => accion == 'Mantener' ? C.verde : accion.startsWith('Retirar') ? C.rojo : C.ambar;

// ----------------------------- copia local (para que funcione sin internet) -----------------------------

Future<File> _archivoCopia(String clave) async =>
    File('${(await getApplicationDocumentsDirectory()).path}/analitica_$clave.json');

Future<void> _guardarCopia(String clave, Map<String, dynamic> datos) async {
  try {
    await (await _archivoCopia(clave)).writeAsString(jsonEncode({'hora': DateTime.now().toIso8601String(), 'datos': datos}));
  } catch (_) {/* sin espacio: se sigue sin copia */}
}

Future<({Map<String, dynamic> datos, DateTime hora})?> _leerCopia(String clave) async {
  try {
    final f = await _archivoCopia(clave);
    if (!await f.exists()) return null;
    final j = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
    return (datos: Map<String, dynamic>.from(j['datos'] as Map), hora: DateTime.parse(j['hora'] as String));
  } catch (_) {
    return null;
  }
}

/// Pide `ruta` al servidor; si no hay red, devuelve la última copia guardada.
Future<({Map<String, dynamic>? datos, DateTime? hora, bool sinConexion, String error})> _cargar(
    Api api, String ruta, String clave) async {
  try {
    final d = Map<String, dynamic>.from(await api.get(ruta) as Map);
    await _guardarCopia(clave, d);
    return (datos: d, hora: DateTime.now(), sinConexion: false, error: '');
  } on ErrorApi catch (e) {
    final copia = await _leerCopia(clave);
    if (copia != null) return (datos: copia.datos, hora: copia.hora, sinConexion: true, error: '');
    return (datos: null, hora: null, sinConexion: e.sinRed, error: e.mensaje);
  }
}

/// Chip «En vivo / Sin conexión» que encabeza la pantalla.
class _BarraVivo extends StatelessWidget {
  const _BarraVivo({required this.hora, required this.sinConexion});
  final DateTime? hora;
  final bool sinConexion;

  @override
  Widget build(BuildContext context) {
    final color = sinConexion ? C.ambar : C.verde;
    final texto = hora == null
        ? 'Cargando…'
        : sinConexion
            ? 'Sin conexión · últimos datos de las ${_hhmm(hora!)}'
            : 'En vivo · actualizado ${_hhmm(hora!)}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(texto, style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600)),
    );
  }
}

// ======================================================================
//                         AGRUPACIÓN DE PLATOS
// ======================================================================

class AgrupacionPantalla extends StatefulWidget {
  const AgrupacionPantalla({super.key, required this.api, required this.enLinea, required this.onMenu});
  final Api api;
  final bool enLinea;
  final VoidCallback onMenu;

  @override
  State<AgrupacionPantalla> createState() => _AgrupacionPantallaState();
}

class _AgrupacionPantallaState extends State<AgrupacionPantalla> {
  Map<String, dynamic>? _d;
  DateTime? _hora;
  bool _sinConexion = false;
  String _error = '';
  Timer? _vivo;

  @override
  void initState() {
    super.initState();
    _refrescar();
    _vivo = Timer.periodic(const Duration(seconds: 20), (_) => widget.enLinea ? _refrescar(silencioso: true) : null);
  }

  @override
  void dispose() {
    _vivo?.cancel();
    super.dispose();
  }

  Future<void> _refrescar({bool silencioso = false}) async {
    final r = await _cargar(widget.api, '/ml/agrupar-platos', 'agrupacion');
    if (!mounted) return;
    setState(() {
      if (r.datos != null) {
        _d = r.datos;
        _hora = r.hora;
        _sinConexion = r.sinConexion;
        _error = '';
      } else if (!silencioso) {
        _error = r.error;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.menu), onPressed: widget.onMenu),
        title: const Text('Agrupación de platos'),
        titleTextStyle: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _refrescar)],
      ),
      body: RefreshIndicator(
        color: C.naranja,
        onRefresh: _refrescar,
        child: d == null
            ? ListView(padding: const EdgeInsets.all(16), children: [
                Text(_error.isEmpty ? 'Agrupando platos…' : _error, style: const TextStyle(color: C.suave)),
              ])
            : _contenido(d),
      ),
    );
  }

  Widget _contenido(Map<String, dynamic> d) {
    if (d['suficiente'] != true) {
      return ListView(padding: const EdgeInsets.all(16), children: [
        _BarraVivo(hora: _hora, sinConexion: _sinConexion),
        Aviso('${d['mensaje'] ?? 'Aún no hay datos suficientes.'}', tipo: 'alerta'),
      ]);
    }
    final puntos = List<Map<String, dynamic>>.from((d['puntos'] as List? ?? []).map((p) => Map<String, dynamic>.from(p)));
    final grupos = List<Map<String, dynamic>>.from((d['grupos'] as List? ?? []).map((g) => Map<String, dynamic>.from(g)))
      ..sort((a, b) => ((b['puntaje'] as num?) ?? 0).compareTo((a['puntaje'] as num?) ?? 0));
    final conDesperdicio = puntos.where((p) => p['desperdicio'] != null).toList()
      ..sort((a, b) => (b['desperdicio'] as num).compareTo(a['desperdicio'] as num));
    final porAceptacion = [...puntos]..sort((a, b) => (b['aceptacion'] as num).compareTo(a['aceptacion'] as num));

    return ListView(padding: const EdgeInsets.all(16), children: [
      Wrap(spacing: 8, runSpacing: 8, children: [_BarraVivo(hora: _hora, sinConexion: _sinConexion)]),
      const SizedBox(height: 6),
      const Padding(
        padding: EdgeInsets.only(bottom: 10),
        child: Text('Se vuelve a agrupar cuando cambian las reservas o llegan fotos de bandejas',
            style: TextStyle(color: C.tenue, fontSize: 11.5)),
      ),
      if (d['nota'] != null) Aviso('${d['nota']}', tipo: 'alerta'),
      Tarjeta(titulo: 'Mapa de platos', hijos: [
        const Text('Horizontal: % del cupo que se reserva · Vertical: raciones por servicio · Tamaño: veces servido',
            style: TextStyle(color: C.tenue, fontSize: 11)),
        const SizedBox(height: 8),
        Wrap(spacing: 10, runSpacing: 4, children: [
          for (final g in grupos)
            _Leyenda(color: _colorGrupo((g['id'] as num).toInt()), texto: 'Grupo ${(g['id'] as num).toInt() + 1}: ${g['accion']}'),
        ]),
        const SizedBox(height: 10),
        SizedBox(height: 230, child: CustomPaint(size: Size.infinite, painter: _MapaPainter(puntos))),
      ]),
      Tarjeta(titulo: 'Qué hacer con cada grupo', hijos: [
        for (final g in grupos) _tarjetaGrupo(g),
      ]),
      if (conDesperdicio.isNotEmpty)
        Tarjeta(titulo: 'Desperdicio por plato (meta ≤ 15%)', hijos: [
          for (final p in conDesperdicio)
            _barra(
              _corto('${p['plato']}'),
              (p['desperdicio'] as num).toDouble() / 100,
              (p['desperdicio'] as num) <= 15 ? C.verde : (p['desperdicio'] as num) <= 30 ? C.ambar : C.rojo,
            ),
        ]),
      Tarjeta(titulo: 'Platos por grupo · decisión sugerida', hijos: [
        for (final p in porAceptacion) _filaPlato(p),
      ]),
      const SizedBox(height: 24),
    ]);
  }

  Widget _tarjetaGrupo(Map<String, dynamic> g) {
    final id = (g['id'] as num).toInt();
    final accion = '${g['accion']}';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: C.tarjeta2,
        border: Border.all(color: C.borde),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(width: 10, height: 10, decoration: BoxDecoration(color: _colorGrupo(id), shape: BoxShape.circle)),
          const SizedBox(width: 8),
          Expanded(
              child: Text('Grupo ${id + 1} · ${g['tam']} platos',
                  style: const TextStyle(color: Colors.white, fontSize: 13.5, fontWeight: FontWeight.w600))),
          _Chip(accion, _colorAccion(accion)),
        ]),
        const SizedBox(height: 6),
        Text('${g['detalle'] ?? ''}', style: const TextStyle(color: C.suave, fontSize: 12)),
        const SizedBox(height: 4),
        Text(
            'Aceptación ${((g['aceptacion'] as num) * 100).toStringAsFixed(0)}% · demanda media ${(g['demandaMedia'] as num).toStringAsFixed(1)}'
            '${g['desperdicio'] != null ? ' · desperdicio ${(g['desperdicio'] as num).toStringAsFixed(0)}%' : ''}',
            style: const TextStyle(color: C.tenue, fontSize: 11)),
      ]),
    );
  }

  Widget _filaPlato(Map<String, dynamic> p) {
    final accion = '${p['accion']}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(children: [
        Container(
            width: 9, height: 9,
            decoration: BoxDecoration(color: _colorGrupo((p['cluster'] as num).toInt()), shape: BoxShape.circle)),
        const SizedBox(width: 8),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(_corto('${p['plato']}'), style: const TextStyle(color: Colors.white, fontSize: 13.5)),
            Text(
                '${((p['aceptacion'] as num) * 100).toStringAsFixed(0)}% aceptación · '
                '${(p['demandaMedia'] as num).toStringAsFixed(1)} raciones · ${p['veces']} veces'
                '${p['desperdicio'] != null ? ' · ${(p['desperdicio'] as num).toStringAsFixed(0)}% desperdicio' : ''}',
                style: const TextStyle(color: C.tenue, fontSize: 10.5)),
          ]),
        ),
        _Chip(accion, _colorAccion(accion)),
      ]),
    );
  }
}

// ----------------------------- piezas de la pantalla -----------------------------

class _Chip extends StatelessWidget {
  const _Chip(this.texto, this.color);
  final String texto;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          border: Border.all(color: color.withValues(alpha: 0.45)),
          borderRadius: BorderRadius.circular(7),
        ),
        child: Text(texto, style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w600)),
      );
}

class _Leyenda extends StatelessWidget {
  const _Leyenda({required this.color, required this.texto});
  final Color color;
  final String texto;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 9, height: 9, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 5),
        Text(texto, style: const TextStyle(color: C.suave, fontSize: 11)),
      ]);
}

/// Barra horizontal con etiqueta y porcentaje (desperdicio por plato).
Widget _barra(String etiqueta, double fraccion, Color color) {
  final pct = (fraccion * 100).clamp(0, 100);
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(children: [
      SizedBox(
          width: 118,
          child: Text(etiqueta, style: const TextStyle(color: C.suave, fontSize: 11.5), overflow: TextOverflow.ellipsis)),
      Expanded(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(5),
          child: Stack(children: [
            Container(height: 12, color: C.tarjeta2),
            FractionallySizedBox(
                widthFactor: (pct / 100).clamp(0.0, 1.0),
                child: Container(height: 12, color: color.withValues(alpha: 0.85))),
          ]),
        ),
      ),
      SizedBox(
          width: 40,
          child: Text('${pct.toStringAsFixed(0)}%',
              textAlign: TextAlign.right, style: const TextStyle(color: C.texto, fontSize: 11.5))),
    ]),
  );
}

/// Mapa de platos: aceptación (x) vs. demanda media (y), color del grupo y tamaño por veces servido.
class _MapaPainter extends CustomPainter {
  _MapaPainter(this.puntos);
  final List<Map<String, dynamic>> puntos;

  @override
  void paint(Canvas canvas, Size size) {
    const margenIzq = 30.0, margenAbajo = 26.0;
    final area = Rect.fromLTWH(margenIzq, 6, size.width - margenIzq - 8, size.height - margenAbajo - 10);
    final rejilla = Paint()..color = const Color(0xFF1E293B)..strokeWidth = 1;
    double maxY = 5;
    var maxVeces = 1;
    for (final p in puntos) {
      maxY = math.max(maxY, (p['demandaMedia'] as num).toDouble());
      maxVeces = math.max(maxVeces, (p['veces'] as num? ?? 1).toInt());
    }
    maxY = (maxY / 10).ceil() * 10.0;

    final estiloEje = TextStyle(color: C.tenue.withValues(alpha: 0.9), fontSize: 9);
    for (var i = 0; i <= 4; i++) {
      final y = area.bottom - area.height * i / 4;
      canvas.drawLine(Offset(area.left, y), Offset(area.right, y), rejilla);
      final tp = TextPainter(
          text: TextSpan(text: (maxY * i / 4).round().toString(), style: estiloEje),
          textDirection: TextDirection.ltr)
        ..layout();
      tp.paint(canvas, Offset(area.left - tp.width - 4, y - tp.height / 2));
    }
    for (var i = 0; i <= 4; i++) {
      final x = area.left + area.width * i / 4;
      final tp = TextPainter(text: TextSpan(text: '${i * 25}%', style: estiloEje), textDirection: TextDirection.ltr)
        ..layout();
      tp.paint(canvas, Offset(x - tp.width / 2, area.bottom + 4));
    }
    final tpTitulo = TextPainter(
        text: TextSpan(text: 'Aceptación (% del cupo reservado)', style: estiloEje), textDirection: TextDirection.ltr)
      ..layout();
    tpTitulo.paint(canvas, Offset(area.center.dx - tpTitulo.width / 2, size.height - tpTitulo.height));

    for (final p in puntos) {
      final x = area.left + area.width * ((p['aceptacion'] as num).toDouble()).clamp(0.0, 1.0);
      final y = area.bottom - area.height * ((p['demandaMedia'] as num).toDouble() / maxY).clamp(0.0, 1.0);
      final radio = 4 + 6 * math.sqrt((p['veces'] as num? ?? 1).toInt() / maxVeces);
      final color = _colorGrupo((p['cluster'] as num? ?? 0).toInt());
      canvas.drawCircle(Offset(x, y), radio, Paint()..color = color.withValues(alpha: 0.75));
      canvas.drawCircle(Offset(x, y), radio, Paint()..color = const Color(0xFF0F172A)..style = PaintingStyle.stroke..strokeWidth = 1);
    }
  }

  @override
  bool shouldRepaint(_MapaPainter old) => old.puntos != puntos;
}
