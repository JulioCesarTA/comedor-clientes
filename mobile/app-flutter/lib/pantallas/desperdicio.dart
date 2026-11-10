// Desperdicio por foto: la IA (TensorFlow Lite) corre DENTRO del teléfono y estima qué % de comida quedó, sin internet.
// 1) «Referencia»: foto de la porción completa.  2) «Analizar»: foto de la bandeja devuelta.
// Los resultados y las fotos se envían al servidor (fotos a S3 de AWS) cuando vuelve la conexión, sin duplicar nada.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../datos/api.dart';
import '../tema.dart';
import '../vision/analisis.dart';
import '../vision/cola.dart';
import '../vision/modelo.dart';

const _turnos = ['DESAYUNO', 'ALMUERZO', 'CENA'];

String _hoyIso() {
  final d = DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

String _nombrePlato(String p) => p.replaceFirst(RegExp(r'^plato-'), '');
String _idPlato(String p) => p.trim().startsWith('plato-') ? p.trim() : 'plato-${p.trim()}';

String _hora(String? iso) {
  if (iso == null) return '';
  try {
    final d = DateTime.parse(iso);
    String p(int n) => n.toString().padLeft(2, '0');
    return '${p(d.day)}/${p(d.month)} ${p(d.hour)}:${p(d.minute)}';
  } catch (_) {
    return '';
  }
}

class Desperdicio extends StatefulWidget {
  const Desperdicio({super.key, required this.api, required this.enLinea, required this.onMenu, required this.onPendientes});
  final Api api;
  final bool enLinea;
  final VoidCallback onMenu;
  final ValueChanged<int> onPendientes;

  @override
  State<Desperdicio> createState() => _DesperdicioState();
}

class _DesperdicioState extends State<Desperdicio> {
  EstadoVision? _est;
  final _plato = TextEditingController();
  String _turno = 'ALMUERZO';
  String _fecha = _hoyIso();
  String? _refId;
  String _tab = 'analizar';
  String _cargando = '';
  String _error = '';
  String _aviso = '';
  bool _sincronizando = false;
  bool _hayModelo = true;
  ResultadoBandeja? _resultado;
  String? _fotoResultado;
  String _platoResultado = '';

  @override
  void initState() {
    super.initState();
    modeloDisponible().then((v) => mounted ? setState(() => _hayModelo = v) : null);
    cargarEstado().then((e) {
      if (!mounted) return;
      setState(() {
        _est = e;
        _refId = e.usables.isNotEmpty ? e.usables.first.id : null;
      });
      widget.onPendientes(e.pendientes);
      if (widget.enLinea) _sincronizar(silencioso: true);
    });
  }

  @override
  void dispose() {
    _plato.dispose();
    super.dispose();
  }

  Future<void> _guardar() async {
    final e = _est;
    if (e == null) return;
    await guardarEstado(e);
    widget.onPendientes(e.pendientes);
    if (mounted) setState(() {});
  }

  Future<void> _sincronizar({bool silencioso = false}) async {
    final e = _est;
    if (e == null || _sincronizando) return;
    setState(() { _sincronizando = true; if (!silencioso) { _error = ''; _aviso = ''; } });
    final r = await sincronizar(e, widget.api);
    await _guardar();
    if (!mounted) return;
    setState(() {
      _sincronizando = false;
      _refId ??= e.usables.isNotEmpty ? e.usables.first.id : null;
      if (r.sinRed) {
        if (!silencioso) _aviso = 'Sin conexión: tus resultados siguen guardados en el teléfono.';
      } else if (r.errores.isNotEmpty) {
        _error = r.errores.take(3).join('\n');
      } else if (!silencioso || r.bandejas > 0 || r.referencias > 0) {
        _aviso = 'Sincronizado: ${r.referencias} referencia(s) y ${r.bandejas} bandeja(s) enviadas.';
      }
    });
  }

  Future<void> _procesar(String modo, {required bool galeria}) async {
    final est = _est;
    if (est == null) return;
    setState(() { _error = ''; _aviso = ''; _resultado = null; });
    final refs = est.usables;
    final ref = refs.where((r) => r.id == _refId).firstOrNull;
    try {
      if (!_hayModelo) throw ErrorVision('Falta el modelo de IA en esta instalación de la app.');
      if (modo == 'ref' && _plato.text.trim().isEmpty) throw ErrorVision('Escribe o elige el plato de la referencia.');
      if (modo == 'ref' && !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(_fecha)) throw ErrorVision('La fecha debe ser AAAA-MM-DD.');
      if (modo == 'bandeja' && ref == null) throw ErrorVision('Primero crea o elige una referencia (la foto de la porción completa).');

      final x = await ImagePicker().pickImage(
        source: galeria ? ImageSource.gallery : ImageSource.camera,
        imageQuality: 100, maxWidth: 1600,
      );
      if (x == null) return;
      setState(() => _cargando = 'Analizando con la IA del teléfono…');
      await Future<void>.delayed(const Duration(milliseconds: 30));

      final bytes = await x.readAsBytes();
      final prep = prepararFoto(bytes);
      final mapa = await caracteristicas(prep.rgba);           // TensorFlow Lite, sin internet
      final sectores = await cargarModeloSectores();            // red de sectores (arroz, ensalada, …), también local
      final id = nuevoId();
      final foto = await guardarFoto(prep.jpegGrande, id);

      if (modo == 'ref') {
        final r = crearReferencia(prep.rgba, mapa, modelo: sectores);
        est.locales.insert(0, RefLocal(
          clienteId: id, platoId: _idPlato(_plato.text), fecha: _fecha, turno: _turno,
          fRef: r.fRef, comida: r.comida, fondo: r.fondo, advertencia: r.advertencia, fotoRuta: foto.path,
          sectores: r.sectoresJson(),
        ));
        await _guardar();
        setState(() {
          _refId = id;
          _tab = 'analizar';
          _aviso = 'Referencia guardada: ${_nombrePlato(_plato.text)}. ${r.advertencia ?? 'Ya puedes analizar bandejas, también sin internet.'}';
        });
      } else {
        final r = analizarBandeja(prep.rgba, mapa, ref!.comoReferencia(), modelo: sectores);
        est.bandejas.insert(0, BandejaLocal(
          clienteId: id, refId: ref.id, refEsLocal: ref.local && !ref.sincronizada, platoId: ref.platoId,
          fecha: ref.fecha, turno: ref.turno, restante: r.restante, comido: r.comido, confianza: r.confianza,
          fotoRuta: foto.path, sectores: r.sectores,
        ));
        await _guardar();
        setState(() { _resultado = r; _fotoResultado = foto.path; _platoResultado = ref.platoId; });
      }
      if (widget.enLinea) _sincronizar(silencioso: true);
    } on ErrorVision catch (e) {
      setState(() => _error = e.mensaje);
    } catch (e) {
      setState(() => _error = 'No pude analizar la foto: $e');
    } finally {
      if (mounted) setState(() => _cargando = '');
    }
  }

  Color _color(double r) => r <= 15 ? C.verde : r <= 30 ? C.ambar : C.rojo;

  @override
  Widget build(BuildContext context) {
    final est = _est;
    final refs = est?.usables ?? [];
    final ref = refs.where((r) => r.id == _refId).firstOrNull;
    final pend = est?.pendientes ?? 0;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.menu), onPressed: widget.onMenu),
        title: const Text('Desperdicio por foto'),
        titleTextStyle: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
      ),
      body: est == null
          ? const Center(child: CircularProgressIndicator(color: C.naranja))
          : ListView(padding: const EdgeInsets.all(16), children: [
              Row(children: [
                Icon(widget.enLinea ? Icons.cloud_done : Icons.cloud_off, size: 15, color: widget.enLinea ? C.verde : C.ambar),
                const SizedBox(width: 6),
                Expanded(child: Text(
                  '${widget.enLinea ? 'En línea' : 'Sin conexión'} · ${pend > 0 ? '$pend por enviar' : 'todo enviado'}'
                  '${est.ultimaSync != null ? ' · últ. ${_hora(est.ultimaSync)}' : ''}',
                  style: const TextStyle(color: C.suave, fontSize: 12))),
                if (_sincronizando)
                  const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: C.cian))
                else
                  TextButton(onPressed: widget.enLinea ? () => _sincronizar() : null,
                      child: const Text('Enviar ahora', style: TextStyle(fontSize: 12))),
              ]),
              const SizedBox(height: 6),
              Text('La IA corre en este teléfono: analiza aunque no haya señal.',
                  style: TextStyle(color: _hayModelo ? C.tenue : C.rojo, fontSize: 11.5)),
              const SizedBox(height: 12),

              Row(children: [
                for (final t in const [['analizar', 'Analizar bandeja'], ['ref', 'Referencia']])
                  Expanded(child: Padding(
                    padding: EdgeInsets.only(right: t[0] == 'analizar' ? 8 : 0),
                    child: OutlinedButton(
                      onPressed: () => setState(() { _tab = t[0]; _error = ''; _aviso = ''; }),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide(color: _tab == t[0] ? C.naranja : C.borde),
                        foregroundColor: _tab == t[0] ? Colors.white : C.suave,
                      ),
                      child: Text(t[1], style: const TextStyle(fontSize: 13)),
                    ),
                  )),
              ]),
              const SizedBox(height: 12),

              if (_tab == 'ref')
                Tarjeta(titulo: 'Foto de la porción completa', hijos: [
                  const Text('Fotografía el plato recién servido, desde arriba y con buena luz. Con ella la IA aprende cómo se ve «100 % de comida».',
                      style: TextStyle(color: C.suave, fontSize: 12.5)),
                  const Etiqueta('Plato', arriba: 12),
                  TextField(controller: _plato, autocorrect: false,
                      decoration: const InputDecoration(hintText: 'Ej.: asado-de-res')),
                  const Etiqueta('Turno', arriba: 12),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    for (final t in _turnos)
                      ChipSel(texto: t.toLowerCase(), activo: _turno == t, onTap: () => setState(() => _turno = t)),
                  ]),
                  const Etiqueta('Fecha', arriba: 12),
                  TextFormField(initialValue: _fecha, onChanged: (v) => _fecha = v,
                      decoration: const InputDecoration(hintText: 'AAAA-MM-DD')),
                  const SizedBox(height: 14),
                  Row(children: [
                    Expanded(flex: 2, child: FilledButton.icon(
                      onPressed: _cargando.isEmpty ? () => _procesar('ref', galeria: false) : null,
                      icon: const Icon(Icons.photo_camera), label: const Text('Tomar foto'))),
                    const SizedBox(width: 8),
                    Expanded(child: OutlinedButton(
                      onPressed: _cargando.isEmpty ? () => _procesar('ref', galeria: true) : null,
                      child: const Text('Galería'))),
                  ]),
                ])
              else
                Tarjeta(titulo: 'Referencia a comparar', hijos: [
                  if (refs.isEmpty)
                    Text('Todavía no hay referencias. Ve a «Referencia» y fotografía una porción completa'
                        '${widget.enLinea ? ' (o toca «Enviar ahora» para traer las del servidor)' : ''}.',
                        style: const TextStyle(color: C.suave, fontSize: 13))
                  else
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final r in refs.take(12))
                        ChipSel(
                          texto: '${_nombrePlato(r.platoId)} · ${r.turno.toLowerCase()} · ${r.fecha.substring(5)}'
                              '${r.local && !r.sincronizada ? ' ⏳' : ''}',
                          activo: _refId == r.id,
                          onTap: () => setState(() => _refId = r.id),
                        ),
                    ]),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(flex: 2, child: FilledButton.icon(
                      onPressed: _cargando.isEmpty && ref != null ? () => _procesar('bandeja', galeria: false) : null,
                      icon: const Icon(Icons.photo_camera), label: const Text('Fotografiar'))),
                    const SizedBox(width: 8),
                    Expanded(child: OutlinedButton(
                      onPressed: _cargando.isEmpty && ref != null ? () => _procesar('bandeja', galeria: true) : null,
                      child: const Text('Galería'))),
                  ]),
                ]),

              if (_cargando.isNotEmpty)
                Tarjeta(hijos: [Row(children: [
                  const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: C.naranja)),
                  const SizedBox(width: 10),
                  Expanded(child: Text(_cargando, style: const TextStyle(color: C.texto))),
                ])]),
              if (_error.isNotEmpty) Aviso(_error),
              if (_aviso.isNotEmpty) Aviso(_aviso, tipo: 'ok'),

              if (_resultado != null)
                Tarjeta(titulo: 'Resultado · ${_nombrePlato(_platoResultado)}', hijos: [
                  Row(children: [
                    if (_fotoResultado != null)
                      ClipRRect(borderRadius: BorderRadius.circular(10),
                          child: Image.file(File(_fotoResultado!), width: 96, height: 96, fit: BoxFit.cover)),
                    const SizedBox(width: 14),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${_resultado!.restante}%',
                          style: TextStyle(color: _color(_resultado!.restante), fontSize: 34, fontWeight: FontWeight.w800)),
                      Text(_resultado!.sectores.isEmpty ? 'de la comida quedó en la bandeja' : 'quedó en promedio (de todos los sectores)',
                          style: const TextStyle(color: C.suave, fontSize: 12)),
                      Text('Se comió el ${_resultado!.comido}%', style: const TextStyle(color: C.texto, fontSize: 13)),
                    ])),
                  ]),
                  const SizedBox(height: 12),
                  for (final s in _resultado!.sectores)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(children: [
                        SizedBox(width: 92, child: Text(s.nombre[0].toUpperCase() + s.nombre.substring(1),
                            style: const TextStyle(color: C.texto, fontSize: 13), overflow: TextOverflow.ellipsis)),
                        Expanded(child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(value: (s.restante / 100).clamp(0, 1), minHeight: 7,
                              backgroundColor: C.tarjeta2, color: _color(s.restante)),
                        )),
                        SizedBox(width: 48, child: Text('${s.restante.round()}%', textAlign: TextAlign.right,
                            style: TextStyle(color: _color(s.restante), fontWeight: FontWeight.bold, fontSize: 13))),
                      ]),
                    ),
                  if (_resultado!.sectores.isEmpty)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: (_resultado!.restante / 100).clamp(0, 1), minHeight: 8,
                        backgroundColor: C.tarjeta2, color: _color(_resultado!.restante),
                      ),
                    ),
                  Padding(padding: const EdgeInsets.only(top: 8),
                      child: Text('Confianza ${(_resultado!.confianza * 100).round()} % · calculado en este teléfono, sin internet.'
                          '${pend > 0 ? ' Se enviará cuando haya conexión.' : ' Ya está en el servidor.'}',
                          style: const TextStyle(color: C.tenue, fontSize: 11.5))),
                ]),

              if (est.bandejas.isNotEmpty)
                Tarjeta(titulo: 'Últimas bandejas', hijos: [
                  for (final b in est.bandejas.take(6))
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(children: [
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${_nombrePlato(b.platoId)} · ${_hora(b.creado)}',
                              style: const TextStyle(color: C.texto, fontSize: 13), overflow: TextOverflow.ellipsis),
                          if (b.sectores.isNotEmpty)
                            Text(b.sectores.map((s) => '${s.nombre} ${s.restante.round()}%').join(' · '),
                                style: const TextStyle(color: C.tenue, fontSize: 11), overflow: TextOverflow.ellipsis),
                        ])),
                        Text('${b.restante}%', style: TextStyle(color: _color(b.restante), fontWeight: FontWeight.bold)),
                        const SizedBox(width: 8),
                        Icon(b.enviada ? Icons.check : b.rechazada ? Icons.close : Icons.schedule,
                            size: 15, color: b.enviada ? C.verde : b.rechazada ? C.rojo : C.ambar),
                      ]),
                    ),
                ]),
              const SizedBox(height: 30),
            ]),
    );
  }
}
