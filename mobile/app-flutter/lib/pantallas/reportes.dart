// Reportes por texto o por voz, con IA LOCAL: el pedido en español lo interpreta y lo ejecuta este mismo teléfono
// (lib/reportes/) contra una copia de los datos de tu rol guardada en el equipo. Por eso funciona SIN internet.
// Con red, la copia se renueva sola; aquí se muestra la tabla y se descarga en PDF o Excel.
// Dictado: el cuadro se llena mientras hablas y el pedido se manda recién tras 3 s de silencio (las pausas cortas no
// lo mandan: si el teléfono corta el reconocimiento antes, se vuelve a escuchar y se sigue sumando el texto).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../cuenta/auth.dart';
import '../datos/api.dart';
import '../reportes/exportar.dart';
import '../reportes/local.dart';
import '../tema.dart';

class Reportes extends StatefulWidget {
  const Reportes({super.key, required this.perfil, required this.api, required this.enLinea, required this.onMenu});
  final Perfil perfil;
  final Api api;
  final bool enLinea;
  final VoidCallback onMenu;

  @override
  State<Reportes> createState() => _ReportesState();
}

class _ReportesState extends State<Reportes> {
  final _texto = TextEditingController();
  final _voz = SpeechToText();
  Map<String, dynamic>? _res;
  List<dynamic> _ayuda = [];
  String _error = '';
  String _aviso = '';
  bool _cargando = false;
  bool _escuchando = false;
  bool _hayVoz = false;
  bool _bajando = false;
  Copia? _copia;                  // la copia de datos que usa la IA local
  String? _localeVoz;             // español disponible en el teléfono
  static const _silencioParaEnviar = Duration(seconds: 3);
  Timer? _silencio;               // corre desde la última palabra escuchada
  bool _dictando = false;         // el usuario sigue dictando (no tocó detener ni pasaron 3 s callado)
  String _frasesCerradas = '';    // lo que el reconocedor ya dio por terminado en tramos anteriores
  String _fraseActual = '';

  String get _textoDictado => '$_frasesCerradas $_fraseActual'.replaceAll(RegExp(r'\s+'), ' ').trim();

  @override
  void initState() {
    super.initState();
    _voz.initialize(onStatus: (s) {
      if ((s != 'done' && s != 'notListening') || !mounted) return;
      if (_dictando && (_silencio?.isActive ?? false)) {
        // el teléfono cortó en una pausa corta: se sigue escuchando y sumando
        Future.delayed(const Duration(milliseconds: 150), () {
          if (mounted && _dictando && !_voz.isListening) _escucharTramo();
        });
      } else if (_dictando && _textoDictado.isEmpty) {
        _dictando = false;
        setState(() => _escuchando = false);
      } else if (!_dictando) {
        setState(() => _escuchando = false);
      }
    }, onError: (e) {
      if (!mounted || (_dictando && _textoDictado.isNotEmpty)) return;   // con texto ya dictado se ignoran cortes
      _dictando = false;
      setState(() { _escuchando = false; _error = _mensajeVoz(e.errorMsg); });
    }).then((ok) async {
      if (!mounted) return;
      if (!ok) {                     // sin permiso de micrófono o sin reconocedor de voz en el teléfono
        setState(() => _hayVoz = false);
        return;
      }
      final ls = await _voz.locales();
      final es = ls.where((l) => l.localeId.toLowerCase().startsWith('es')).toList();
      final bo = es.where((l) => l.localeId.toLowerCase().replaceAll('-', '_') == 'es_bo').firstOrNull;
      setState(() { _hayVoz = true; _localeVoz = (bo ?? es.firstOrNull)?.localeId; });
    });
    _preparar(false);
  }

  @override
  void didUpdateWidget(covariant Reportes old) {
    super.didUpdateWidget(old);
    if (!old.enLinea && widget.enLinea) _preparar(false);        // volvió internet: se refresca la copia
  }

  /// Deja lista la copia de datos: la guardada en el teléfono y, si hay red y está vieja (o se pide), una nueva.
  Future<void> _preparar(bool forzar) async {
    setState(() => _bajando = true);
    final (copia, aviso) = await iaLocal.preparar(widget.api, widget.perfil.usuario, forzar: forzar, hayInternet: widget.enLinea);
    if (!mounted) return;
    setState(() {
      _bajando = false;
      if (copia != null) {
        _copia = copia;
        _ayuda = iaLocal.ayuda();
        if (_error.startsWith('Aún no hay datos')) _error = '';
      } else if (aviso.isNotEmpty) {
        _error = aviso;
      }
    });
  }

  String _mensajeVoz(String e) {
    if (e.contains('permission')) return 'Permite el micrófono para dictar (Ajustes del teléfono > Permisos).';
    if (e.contains('language')) {
      return 'Sin internet el dictado necesita el español instalado en el teléfono (Ajustes > Idioma > Reconocimiento de voz sin conexión). Mientras tanto, escribe tu pedido.';
    }
    if (e.contains('network')) return 'El dictado de este teléfono necesita internet. Sin conexión, escribe tu pedido: el reporte sí funciona.';
    if (e.contains('no_match') || e.contains('speech_timeout')) return 'No se escuchó nada. Habla cerca del micrófono e inténtalo otra vez.';
    if (e.contains('busy')) return 'El micrófono está ocupado por otra app. Ciérrala e inténtalo otra vez.';
    return 'No se pudo dictar ($e). Escribe tu pedido.';
  }

  @override
  void dispose() {
    _silencio?.cancel();
    _dictando = false;
    _voz.stop();
    _texto.dispose();
    super.dispose();
  }

  // El archivo se descarga solo si ESTE pedido lo nombra ("en pdf", "pasalo a excel"); seguir la conversación no lo repite
  static final _pideArchivo = RegExp(r'\b(pdf|excel|xlsx|xls|planilla|hoja de c[aá]lculo)\b', caseSensitive: false);

  Future<void> _generar(String? t, {bool continuar = true}) async {
    final q = (t ?? _texto.text).trim();
    if (q.isEmpty || _cargando) return;                 // no se manda dos veces mientras se calcula
    FocusScope.of(context).unfocus();
    setState(() { _cargando = true; _error = ''; _aviso = ''; });
    await Future.delayed(const Duration(milliseconds: 30));   // deja pintar el botón deshabilitado antes de calcular
    try {
      Map<String, dynamic>? anterior;        // la consulta anterior, para seguir la conversación
      if (continuar) anterior = _res?['spec'] as Map<String, dynamic>?;
      final r = iaLocal.consultar(q, anterior);        // se calcula aquí, sin red
      if (!mounted) return;
      setState(() { _res = r; _texto.text = q; });
      final salida = (r['spec']?['salida'] ?? 'pantalla') as String;
      if (salida != 'pantalla' && _pideArchivo.hasMatch(q)) await _exportar(salida);
    } catch (e) {
      if (mounted) setState(() => _error = mensajeError(e));
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  void _aplicar(Map<String, dynamic> spec) {
    setState(() => _error = '');
    try {
      final r = iaLocal.ejecutarSpec(spec);
      setState(() => _res = {...r, 'entendi': _res?['entendi'] ?? r['entendi']});
    } catch (e) {
      setState(() => _error = mensajeError(e));
    }
  }

  Future<void> _exportar(String formato) async {
    if (_res == null) return;
    setState(() => _aviso = 'Generando ${formato == 'excel' ? 'Excel' : 'PDF'}…');
    try {
      final donde = await descargarReporte(_res!, formato);
      if (mounted) setState(() => _aviso = 'Descargado en $donde');
    } catch (e) {
      if (mounted) setState(() { _aviso = ''; _error = 'No pude generar el archivo: $e'; });
    }
  }

  Future<void> _alternarMic() async {
    if (_escuchando) {                      // detener a mano: no se manda, el texto queda para corregirlo
      _dictando = false;
      _silencio?.cancel();
      await _voz.stop();
      setState(() => _escuchando = false);
      return;
    }
    _frasesCerradas = '';
    _fraseActual = '';
    _dictando = true;
    setState(() { _error = ''; _escuchando = true; });
    await _escucharTramo();
  }

  Future<void> _escucharTramo() async {
    await _voz.listen(
      // sin internet se pide el reconocimiento del propio teléfono (necesita el paquete de español instalado)
      listenOptions: SpeechListenOptions(partialResults: true, onDevice: !widget.enLinea, localeId: _localeVoz,
          listenMode: ListenMode.dictation, cancelOnError: false,
          listenFor: const Duration(minutes: 1), pauseFor: _silencioParaEnviar),
      onResult: (r) {
        if (!_dictando) return;
        _fraseActual = r.recognizedWords;
        if (r.finalResult) {               // el tramo terminó, pero se sigue esperando los 3 s de silencio
          _frasesCerradas = _textoDictado;
          _fraseActual = '';
        }
        setState(() => _texto.text = _textoDictado);
        if (r.recognizedWords.trim().isNotEmpty) {
          _silencio?.cancel();
          _silencio = Timer(_silencioParaEnviar, _terminoDeHablar);
        }
      },
    );
  }

  /// 3 s sin palabras nuevas: se deja de escuchar y se manda lo dictado.
  Future<void> _terminoDeHablar() async {
    if (!_dictando) return;
    _dictando = false;
    final t = _textoDictado;
    await _voz.stop();
    if (!mounted) return;
    setState(() => _escuchando = false);
    if (t.isNotEmpty) _generar(t);
  }

  @override
  Widget build(BuildContext context) {
    final res = _res;
    final spec = res?['spec'] as Map<String, dynamic>?;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.menu), onPressed: widget.onMenu),
        title: const Text('Reportes'),
        titleTextStyle: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(18),
          child: Padding(
            padding: const EdgeInsets.only(left: 56, bottom: 6),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('${widget.perfil.nombre} · ${etiquetaRol[widget.perfil.rol] ?? widget.perfil.rol}',
                  style: const TextStyle(color: C.suave, fontSize: 12), overflow: TextOverflow.ellipsis),
            ),
          ),
        ),
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [
          Icon(widget.enLinea ? Icons.cloud_done : Icons.cloud_off, size: 15, color: widget.enLinea ? C.verde : C.ambar),
          const SizedBox(width: 6),
          Expanded(child: Text(
            _copia == null
                ? (_bajando ? 'Descargando los datos para trabajar sin internet…' : 'Sin datos descargados todavía')
                : '${widget.enLinea ? 'En línea' : 'Sin internet'} · IA local · datos del ${_copia!.generado}',
            style: const TextStyle(color: C.suave, fontSize: 12))),
          TextButton.icon(
            onPressed: _bajando || !widget.enLinea ? null : () => _preparar(true),
            icon: _bajando
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.refresh, size: 16),
            label: const Text('Actualizar', style: TextStyle(fontSize: 12)),
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(0, 30)),
          ),
        ]),
        const SizedBox(height: 12),

        Tarjeta(titulo: 'Pide tu reporte', hijos: [
          if (res != null)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                color: C.cian.withValues(alpha: 0.1),
                border: Border.all(color: C.cian.withValues(alpha: 0.35)),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Continúas el reporte anterior: di «ahora por mes», «solo de almuerzo», «en Excel»…',
                    style: TextStyle(color: Color(0xFFA5F3FC), fontSize: 12)),
                GestureDetector(
                  onTap: () => setState(() { _res = null; _aviso = ''; }),
                  child: const Padding(padding: EdgeInsets.only(top: 4),
                      child: Text('Nuevo reporte', style: TextStyle(color: C.cian, fontSize: 12, fontWeight: FontWeight.bold))),
                ),
              ]),
            ),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: TextField(
                controller: _texto, maxLines: 3, minLines: 3, textInputAction: TextInputAction.done,
                readOnly: _escuchando || _cargando,
                onSubmitted: (_) => _escuchando ? null : _generar(null),
                decoration: const InputDecoration(hintText: 'Ej.: pagos de noviembre, los mayores primero, en pdf'),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 74, height: 84,
              child: FilledButton(
                onPressed: _hayVoz && !_cargando ? _alternarMic : null,
                style: FilledButton.styleFrom(backgroundColor: _escuchando ? C.rojo : C.tarjeta2, padding: EdgeInsets.zero),
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(_escuchando ? Icons.stop : Icons.mic, size: 26, color: Colors.white),
                  Text(_escuchando ? 'Escuchando' : 'Dictar', style: const TextStyle(fontSize: 10.5, color: Colors.white)),
                ]),
              ),
            ),
          ]),
          if (!_hayVoz)
            const Padding(padding: EdgeInsets.only(top: 6),
                child: Text('El dictado necesita permiso de micrófono. Mientras tanto, escribe tu pedido.',
                    style: TextStyle(color: C.tenue, fontSize: 11.5))),
          if (_escuchando)
            const Padding(padding: EdgeInsets.only(top: 6),
                child: Text('Habla tranquilo: se envía solo cuando te quedes callado 3 segundos. Toca ■ para parar sin enviar.',
                    style: TextStyle(color: C.rojo, fontSize: 11.5))),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _cargando || _escuchando ? null : () => _generar(null),
            child: _cargando
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Generar reporte'),
          ),
          if (_error.isNotEmpty) Aviso(_error),
          if (_aviso.isNotEmpty) Aviso(_aviso, tipo: 'ok'),
        ]),

        if (res != null) ...[
          Tarjeta(titulo: 'Así lo entendí', hijos: [
            Text('${res['entendi'] ?? ''}', style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.4)),
            for (final n in List<String>.from(res['notas'] ?? []))
              Padding(padding: const EdgeInsets.only(top: 4), child: Text('• $n', style: const TextStyle(color: C.ambar, fontSize: 12))),
            if (spec != null) ...[
              const Etiqueta('Agrupar', arriba: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                ChipSel(texto: 'Sin agrupar', activo: (spec['agrupar'] as List?)?.isEmpty ?? true,
                    onTap: () => _aplicar({...spec, 'agrupar': [], 'medidas': [], 'columnas': null, 'orden': []})),
                for (final p in const [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']])
                  if (_colFecha(res) != null)
                    ChipSel(
                      texto: p[1],
                      activo: ((spec['agrupar'] as List?) ?? []).isNotEmpty && spec['agrupar'][0]['por'] == p[0],
                      onTap: () => _aplicar({...spec, 'agrupar': [{'col': _colFecha(res), 'por': p[0]}], 'columnas': null, 'orden': []}),
                    ),
              ]),
              const Etiqueta('Cantidad', arriba: 10),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final n in const [5, 10, 20])
                  ChipSel(texto: 'Primeros $n', activo: spec['limite'] == n, onTap: () => _aplicar({...spec, 'limite': n})),
                ChipSel(texto: 'Todos', activo: spec['limite'] == null, onTap: () => _aplicar({...spec, 'limite': null})),
              ]),
            ],
          ]),

          Tarjeta(hijos: [
            Text('${res['titulo']}', style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            Text('${res['datasetEtiqueta']} · ${res['generado']}', style: const TextStyle(color: C.suave, fontSize: 12)),
            const SizedBox(height: 8),
            for (final l in List<String>.from(res['resumen'] ?? []))
              Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(l, style: const TextStyle(color: C.texto, fontSize: 13))),
            const SizedBox(height: 12),
            _Tabla(res: res),
          ]),
        ],

        const SizedBox(height: 30),
      ]),
    );
  }

  String? _colFecha(Map<String, dynamic> res) {
    final ds = _ayuda.where((d) => d['id'] == res['dataset']).firstOrNull;
    final c = List<dynamic>.from(ds?['columnas'] ?? []).where((c) => c['tipo'] == 'fecha').firstOrNull;
    return c?['nombre'];
  }
}

class _Tabla extends StatelessWidget {
  const _Tabla({required this.res});
  final Map<String, dynamic> res;

  @override
  Widget build(BuildContext context) {
    final cols = List<Map<String, dynamic>>.from((res['columnas'] as List).map((c) => Map<String, dynamic>.from(c)));
    final filas = List<Map<String, dynamic>>.from((res['filas'] as List).map((f) => Map<String, dynamic>.from(f)));
    if (filas.isEmpty) return const Text('No hay datos que cumplan estas condiciones.', style: TextStyle(color: C.suave));
    final mostrar = filas.take(120).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingRowColor: WidgetStateProperty.all(C.tarjeta2),
          columnSpacing: 18, headingRowHeight: 36, dataRowMinHeight: 32, dataRowMaxHeight: 40,
          columns: [for (final c in cols) DataColumn(label: Text('${c['label']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)))],
          rows: [
            for (final f in mostrar)
              DataRow(cells: [
                for (final c in cols)
                  DataCell(Text(celdaTexto(f[c['key']], c['fmt']), style: const TextStyle(fontSize: 12.5))),
              ]),
          ],
        ),
      ),
      if (filas.length > mostrar.length)
        Padding(padding: const EdgeInsets.only(top: 6),
            child: Text('Se muestran ${mostrar.length} de ${filas.length} filas; el PDF y el Excel las traen todas.',
                style: const TextStyle(color: C.tenue, fontSize: 11))),
    ]);
  }
}

