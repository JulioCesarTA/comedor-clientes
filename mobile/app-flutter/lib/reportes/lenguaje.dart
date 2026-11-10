// Lenguaje natural (español) -> consulta estructurada. Todo corre en el teléfono: sin internet y sin servicios externos.
// Es un puerto línea a línea de lenguaje.js (navegador) y lenguaje.py (servidor); test/reportes_paridad_test.dart
// comprueba que los tres dan exactamente lo mismo.
//
// Entiende: qué datos, qué columnas ver, filtros ("mayores a 5", "turno almuerzo", "sin beca"), fechas ("noviembre",
// "del 1 al 15 de octubre", "últimos 30 días", "2025", "primer trimestre"), agrupaciones ("por mes", "por turno"),
// medidas ("total", "promedio", "cuántos"), rankings ("los 10 mayores"), orden ("ascendente") y la salida ("en PDF",
// "Excel"). Sigue la conversación ("ahora por mes", "solo de almuerzo") y corrige errores de tipeo.
import 'dart:convert';
import 'dart:math' as m;

import 'catalogo.dart';
import 'fechas.dart' as f;
import 'motor.dart' as mo;
import 'texto.dart';

class NoEntendido implements Exception {
  NoEntendido(this.mensaje);
  final String mensaje;
  @override
  String toString() => mensaje;
}

typedef Mapa = Map<String, dynamic>;

const _meses = {
  'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8, 'septiembre': 9,
  'setiembre': 9, 'sept': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12,
};
final _mesAlt = ordenEstable(_meses.keys, (String a, String b) => b.length - a.length).join('|');
const _numeros = {
  'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11, 'doce': 12,
  'quince': 15, 'veinte': 20, 'treinta': 30, 'cuarenta': 40, 'cincuenta': 50, 'cien': 100, 'ciento': 100,
};
const _dias = {'lunes': 0, 'martes': 1, 'miercoles': 2, 'jueves': 3, 'viernes': 4, 'sabado': 5, 'domingo': 6};
const _tiempo = {
  'dia': 'dia', 'dias': 'dia', 'diario': 'dia', 'diaria': 'dia', 'diariamente': 'dia', 'semana': 'semana', 'semanas': 'semana',
  'semanal': 'semana', 'semanalmente': 'semana', 'mes': 'mes', 'meses': 'mes', 'mensual': 'mes', 'mensualmente': 'mes',
  'trimestre': 'trimestre', 'trimestres': 'trimestre', 'trimestral': 'trimestre', 'anio': 'anio', 'anios': 'anio', 'ano': 'anio',
  'anos': 'anio', 'anual': 'anio', 'anualmente': 'anio', 'dia de la semana': 'dia_semana', 'dias de la semana': 'dia_semana',
};
const _colNum = {'pagos': 'monto', 'estudiantes': 'reservas', 'becas': 'uso', 'menus': 'apartadas', 'insumos': 'stock', 'desperdicio': 'restante', 'reservas': null};
final _formatos = <(String, RegExp)>[
  ('pdf', RegExp(r'\bpdf\b')),
  ('excel', RegExp(r'\b(excel|xlsx|xls|hoja de calculo|planilla|spreadsheet)\b')),
  ('pantalla', RegExp(r'\b(en pantalla|por pantalla|en la pantalla|aqui)\b')),
];
const _sinPalabra = {'media': 'beca'}; // valores ambiguos: solo cuentan junto a esta palabra
// «los que vinieron / comieron / asistieron al comedor»: raciones servidas (reservas consumidas), no la asistencia del personal
final _vinieron = RegExp(r'\b(vinieron|vino al comedor|asistieron|asistio al comedor|comieron|almorzaron|cenaron|desayunaron|entraron al comedor|fueron al comedor|pasaron por el comedor|se sirvieron|retiraron (?:su|sus) racion(?:es)?)\b');
final _delPersonal = RegExp(r'\b(personal|empleados?|trabajadores?|cocineros?|marcas?|marcaron|marcacion\w*)\b');
const _diaRel = 'hoy|ayer|anteayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo';
const _numPalabra = {'un': 1, 'una': 1, 'uno': 1};

// ----------------------------- utilidades -----------------------------

Match? _busca(RegExp re, String s, [int pos = 0]) => re.allMatches(s, pos).firstOrNull;
List<int> _spanDe(Match x) => [x.start, x.end];
String _blank(String t, int a, int b) => t.substring(0, a) + ' ' * (b - a) + t.substring(b);
bool _truthy(Object? v) => v != null && v != '' && v != false && !(v is num && (v == 0 || v.isNaN));

String norm(Object? texto) {
  var t = quitarAcentos(js(texto).toLowerCase());
  t = t.replaceAll(RegExp(r'[^a-z0-9/\-.,%$ ]'), ' ');
  t = t.replaceAllMapped(RegExp(r'[.,]'), (x) {
    final s = x.input, i = x.start;
    final antes = i > 0 ? s[i - 1] : '', desp = i + 1 < s.length ? s[i + 1] : '';
    return RegExp(r'\d').hasMatch(antes) && RegExp(r'\d').hasMatch(desp) ? x[0]! : ' ';
  });
  t = t.replaceAll(RegExp(r'\s+'), ' ').trim();
  return t.split(' ').map((w) => _numeros.containsKey(w) ? '${_numeros[w]}' : w).join(' ');
}

String _splitCamel(String n) => n.replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (x) => '${x[1]} ${x[2]}');
RegExp _reFrase(String fr) => RegExp(r'\b' + escapar(fr) + r'(?:s|es)?\b');

List<String> frases(Map c) {
  final fs = <String>{
    norm(_splitCamel(c['nombre'] as String)),
    norm((c['etiqueta'] as String).replaceAll(RegExp(r'\(.*?\)'), '')),
    ...(c['sinonimos'] as List).map(norm),
  }..remove('');
  return ordenEstable(fs, (String a, String b) => b.length - a.length);
}

List<Map<String, dynamic>> _columnas(String dsId) => ((Catalogo.datasets[dsId]['columnas']) as List).cast<Map<String, dynamic>>();

// ----------------------------- corrección de tipeos -----------------------------

/// Errores entre dos palabras; cambiar de lugar dos letras seguidas ("ocutbre") cuenta como UN error.
int _distancia(String a, String b) {
  final d = List.generate(a.length + 1, (i) => [i, ...List.filled(b.length, 0)]);
  for (var j = 1; j <= b.length; j++) {
    d[0][j] = j;
  }
  for (var i = 1; i <= a.length; i++) {
    for (var j = 1; j <= b.length; j++) {
      d[i][j] = m.min(m.min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
        d[i][j] = m.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

const _parecidoMinimo = 0.85; // una palabra de 7 letras con un error (0.857) ya se corrige

List<String> _construirVocab() {
  final v = <String>{
    ..._meses.keys, ..._numeros.keys, ..._tiempo.keys, ..._dias.keys,
    'ascendente', 'descendente', 'promedio', 'mayores', 'menores', 'ordenado', 'ordenados', 'agrupado', 'desperdicio', 'cuantos', 'cuantas',
    'cantidad', 'reporte', 'mostrar', 'ultimos', 'ultimas', 'trimestre', 'semestre', 'bolivianos', 'estudiantes', 'reservas', 'raciones',
    'pagos', 'becas', 'menus', 'insumos', 'total', 'maximo', 'minimo', 'ayer',
    // valores que la gente escribe (estados, métodos, turnos, tipos): sin ellos "canseladas" no se corrige
    'cancelada', 'canceladas', 'confirmada', 'confirmadas', 'consumida', 'consumidas', 'pendiente', 'pendientes',
    'cobrado', 'cobrados', 'devuelto', 'devueltos', 'fallido', 'fallidos', 'efectivo', 'tarjeta',
    'almuerzo', 'desayuno', 'completa', 'parcial',
  };
  for (final ds in Catalogo.datasets.values) {
    for (final s in ds['sinonimos'] as List) {
      norm(s).split(' ').forEach(v.add);
    }
    for (final c in (ds['columnas'] as List).cast<Map<String, dynamic>>()) {
      for (final fr in frases(c)) {
        fr.split(' ').forEach(v.add);
      }
    }
  }
  return v.where((w) => w.length >= 4).toList()..sort();
}

List<String>? _vocab;
Set<String> _vocabSet = {};
int _vocabVersion = -1;
List<String> _vocabulario() {
  if (_vocab == null || _vocabVersion != Catalogo.version) {
    _vocab = _construirVocab();
    _vocabSet = _vocab!.toSet();
    _vocabVersion = Catalogo.version;
  }
  return _vocab!;
}

bool _enVocab(String w) {
  _vocabulario();
  return _vocabSet.contains(w);
}

String corregirTipeos(String t) {
  final soloLetras = RegExp(r'^[a-z]+$');
  return t.split(' ').map((w) {
    if (w.length < 6 || !soloLetras.hasMatch(w) || _enVocab(w)) return w;
    String? mejor;
    var mejorR = _parecidoMinimo;
    for (final v in _vocabulario()) {
      if ((v.length - w.length).abs() > 2) continue;
      var pre = 0;
      final lim = m.min(v.length, w.length);
      while (pre < lim && v[pre] == w[pre]) {
        pre++;
      }
      if (pre >= lim - 2) continue; // solo cambia el final (reservados/reservadas): es otra palabra válida, no un error
      final r = 1 - _distancia(w, v) / m.max(w.length, v.length);
      if (r >= mejorR) {
        mejor = v;
        mejorR = r;
      }
    }
    return mejor ?? w;
  }).join(' ');
}

// ----------------------------- fechas -----------------------------

double _numero(String s) {
  s = s.replaceAll(RegExp('[  ]'), '');
  return RegExp(r'^\d{1,3}(\.\d{3})+$').hasMatch(s) ? double.parse(s.replaceAll('.', '')) : (double.tryParse(s.replaceFirst(',', '.')) ?? double.nan);
}

Mapa _rango(DateTime? desde, DateTime? hasta, String etiqueta) =>
    {'desde': desde != null ? f.iso(desde) : null, 'hasta': hasta != null ? f.iso(hasta) : null, 'etiqueta': etiqueta};

int _anioDe(int mes, int? anio, DateTime hoy) =>
    (anio != null && anio != 0) ? anio : (f.fecha(hoy.year, mes, 1).compareTo(hoy) <= 0 ? hoy.year : hoy.year - 1);
(DateTime, DateTime) _mesRango(int y, int mm) => (f.fecha(y, mm, 1), f.finMes(y, mm));

DateTime _fechaTexto(String d, String mes, String? y, DateTime hoy) {
  final mm = _meses[mes]!;
  final anio = _anioDe(mm, y != null ? int.parse(y) : null, hoy); // sin año: el del mes más reciente que ya empezó
  return f.fecha(anio, mm, m.min(int.parse(d), f.diasEnMes(anio, mm)));
}

/// hoy, ayer, anteayer o el último lunes/martes/... que ya pasó (o hoy)
DateTime _diaRelativo(String w, DateTime hoy) {
  if (w == 'hoy' || w == 'la fecha' || w == 'ahora') return hoy;
  if (w == 'ayer') return f.sumarDias(hoy, -1);
  if (w == 'anteayer') return f.sumarDias(hoy, -2);
  final d = f.sumarDias(f.lunesDe(hoy), _dias[w]!);
  return d.isAfter(hoy) ? f.sumarDias(d, -7) : d;
}

Mapa _ultimos(int n, String unidad, DateTime hoy) {
  final dias = n * (unidad.startsWith('dia') ? 1 : unidad.startsWith('semana') ? 7 : unidad.startsWith('mes') ? 30 : 365);
  return _rango(f.sumarDias(hoy, dias > 1 ? -(dias - 1) : 0), hoy, 'los últimos $n ${n != 1 ? unidad : unidad.replaceFirst(RegExp(r's$'), '')}');
}

Mapa _proximos(int n, String unidad, DateTime hoy) {
  final dias = n * (unidad.startsWith('dia') ? 1 : unidad.startsWith('semana') ? 7 : 30);
  return _rango(hoy, f.sumarDias(hoy, dias), 'los próximos $n $unidad');
}

DateTime _minF(Iterable<DateTime> l) => l.reduce((a, b) => b.isBefore(a) ? b : a);
DateTime _maxF(Iterable<DateTime> l) => l.reduce((a, b) => b.isAfter(a) ? b : a);

(Mapa?, String) parseFechas(String t, DateTime hoy) {
  // «semana del 2 de noviembre»: esa semana, de lunes a domingo
  var x = _busca(RegExp(r'\bsemana del? (\d{1,2}) (?:de )?(' + _mesAlt + r')(?: (?:de|del) (\d{4}))?\b'), t);
  if (x != null) {
    final a = f.lunesDe(_fechaTexto(x[1]!, x[2]!, x[3], hoy)), b = f.sumarDias(a, 6);
    return (_rango(a, b, 'la semana del ${f.dmy(a)} al ${f.dmy(b)}'), _blank(t, x.start, x.end));
  }
  // «de anteayer a hoy», «desde el lunes hasta hoy», «entre ayer y hoy»
  x = _busca(RegExp(r'\b(?:desde|entre|de|del)(?: el)? (' + _diaRel + r') (?:a|al|hasta|y)(?: el)? (' + _diaRel + r'|la fecha|ahora)\b'), t);
  if (x != null) {
    var a = _diaRelativo(x[1]!, hoy), b = _diaRelativo(x[2]!, hoy);
    if (a.isAfter(b)) {
      final tmp = a;
      a = b;
      b = tmp;
    }
    return (_rango(a, b, 'del ${f.dmy(a)} al ${f.dmy(b)}'), _blank(t, x.start, x.end));
  }
  // «desde ayer», «desde el lunes»: hasta hoy
  x = _busca(RegExp(r'\b(?:desde|a partir de)(?: el)? (' + _diaRel + r')\b'), t);
  if (x != null) {
    final a = _diaRelativo(x[1]!, hoy);
    return (_rango(a, hoy, 'desde el ${f.dmy(a)}'), _blank(t, x.start, x.end));
  }
  // «hace 3 días» (ese día) · «desde hace 2 semanas», «hace un mes» (desde entonces hasta hoy)
  x = _busca(RegExp(r'\b(desde )?hace (\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta) (dias?|semanas?|mes|meses)\b'), t);
  if (x != null) {
    final n = int.tryParse(x[2]!) ?? _numPalabra[x[2]] ?? _numeros[x[2]]!;
    final unidad = x[3]!;
    final dias = n * (unidad.startsWith('dia') ? 1 : unidad.startsWith('semana') ? 7 : 30);
    final a = f.sumarDias(hoy, -dias);
    final r = x[1] != null || !unidad.startsWith('dia') ? _rango(a, hoy, 'desde el ${f.dmy(a)}') : _rango(a, a, 'el ${f.dmy(a)}');
    return (r, _blank(t, x.start, x.end));
  }
  x = _busca(RegExp(r'\b(?:del?|entre)(?: el)? (\d{1,2}) (?:al?|y)(?: el)? (\d{1,2}) (?:de )?(' + _mesAlt + r')(?: (?:de|del) (\d{4}))?\b'), t);
  if (x != null) {
    var a = _fechaTexto(x[1]!, x[3]!, x[4], hoy), b = _fechaTexto(x[2]!, x[3]!, x[4], hoy);
    if (a.isAfter(b)) {
      final tmp = a;
      a = b;
      b = tmp;
    }
    return (_rango(a, b, 'del ${f.dmy(a)} al ${f.dmy(b)}'), _blank(t, x.start, x.end));
  }
  // fechas explícitas
  final cand = <(int, int, DateTime)>[];
  for (final y in RegExp(r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b').allMatches(t)) {
    cand.add((y.start, y.end, f.fecha(int.parse(y[1]!), int.parse(y[2]!), int.parse(y[3]!))));
  }
  for (final y in RegExp(r'\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b').allMatches(t)) {
    final anio = int.parse(y[3]!) + (y[3]!.length == 2 ? 2000 : 0);
    cand.add((y.start, y.end, f.fecha(anio, int.parse(y[2]!), int.parse(y[1]!))));
  }
  for (final y in RegExp(r'\b(\d{1,2}) (?:de )?(' + _mesAlt + r')(?: (?:de|del) (\d{4}))?\b').allMatches(t)) {
    cand.add((y.start, y.end, _fechaTexto(y[1]!, y[2]!, y[3], hoy)));
  }
  if (cand.isNotEmpty) {
    final ord = ordenEstable(cand, (a, b) => a.$1 - b.$1);
    var restos = t;
    for (final c in ord) {
      restos = _blank(restos, c.$1, c.$2);
    }
    final ds = ord.map((c) => c.$3).toList();
    if (ds.length >= 2) {
      final a = _minF(ds), b = _maxF(ds);
      return (_rango(a, b, 'del ${f.dmy(a)} al ${f.dmy(b)}'), restos);
    }
    // «del 1 de noviembre a la fecha», «desde el 5/10 hasta hoy»
    final tras = RegExp(r'^\s*(?:a|al|hasta)(?: el dia de)? (?:la fecha|hoy|ahora)\b').firstMatch(t.substring(ord[0].$2));
    if (tras != null) return (_rango(ds[0], hoy, 'desde el ${f.dmy(ds[0])}'), _blank(restos, ord[0].$2, ord[0].$2 + tras.end));
    final desdeIdx = m.max(0, ord[0].$1 - 22);
    final antes = t.substring(desdeIdx, ord[0].$1);
    if (RegExp(r'(desde|a partir de|despues de)(?: el)? $').hasMatch(antes)) return (_rango(ds[0], hoy, 'desde el ${f.dmy(ds[0])}'), restos);
    if (RegExp(r'(hasta|antes de)(?: el)? $').hasMatch(antes)) return (_rango(null, ds[0], 'hasta el ${f.dmy(ds[0])}'), restos);
    return (_rango(ds[0], ds[0], 'el ${f.dmy(ds[0])}'), restos);
  }
  // relativas
  final lunes = f.lunesDe(hoy);
  final mp = hoy.month == 1 ? (hoy.year - 1, 12) : (hoy.year, hoy.month - 1);
  final reglas = <(RegExp, Mapa? Function(Match))>[
    (RegExp(r'\bhoy\b'), (_) => _rango(hoy, hoy, 'hoy (${f.dmy(hoy)})')),
    (RegExp(r'\banteayer\b'), (_) => _rango(f.sumarDias(hoy, -2), f.sumarDias(hoy, -2), 'anteayer')),
    (RegExp(r'\bayer\b'), (_) => _rango(f.sumarDias(hoy, -1), f.sumarDias(hoy, -1), 'ayer (${f.dmy(f.sumarDias(hoy, -1))})')),
    (RegExp(r'\b(?:semana pasada|semana anterior)\b'), (_) => _rango(f.sumarDias(lunes, -7), f.sumarDias(lunes, -1), 'la semana pasada')),
    (RegExp(r'\b(?:esta semana|semana actual|en lo que va de la semana)\b'), (_) => _rango(lunes, hoy, 'esta semana')),
    (RegExp(r'\b(?:de la semana|la semana)\b'), (_) => RegExp(r'dias? de la semana').hasMatch(t) ? null : _rango(lunes, hoy, 'esta semana')),
    (
      RegExp(r'\b(?:mes pasado|mes anterior)\b'),
      (_) {
        final r = _mesRango(mp.$1, mp.$2);
        return _rango(r.$1, r.$2, 'el mes pasado (${f.mesesN[mp.$2 - 1]})');
      }
    ),
    (RegExp(r'\b(?:este mes|mes actual|en lo que va del mes)\b'), (_) => _rango(f.fecha(hoy.year, hoy.month, 1), hoy, 'este mes (${f.mesesN[hoy.month - 1]})')),
    (
      RegExp(r'\b(?:anio pasado|ano pasado|anio anterior|ano anterior)\b'),
      (_) => _rango(f.fecha(hoy.year - 1, 1, 1), f.fecha(hoy.year - 1, 12, 31), 'el año ${hoy.year - 1}')
    ),
    (
      RegExp(r'\b(?:este anio|este ano|anio actual|ano actual|en lo que va del anio|en lo que va del ano)\b'),
      (_) => _rango(f.fecha(hoy.year, 1, 1), hoy, 'este año (${hoy.year})')
    ),
    (RegExp(r'\bultim[oa]s? (\d+) (dias?|semanas?|meses|mes|anios?|anos?)\b'), (y) => _ultimos(int.parse(y[1]!), y[2]!, hoy)),
    (RegExp(r'\bultima semana\b'), (_) => _ultimos(7, 'dias', hoy)),
    (RegExp(r'\bultimo mes\b'), (_) => _ultimos(30, 'dias', hoy)),
    (RegExp(r'\b(?:ultimo anio|ultimo ano)\b'), (_) => _ultimos(365, 'dias', hoy)),
    (RegExp(r'\bproxim[oa]s? (\d+) (dias?|semanas?|meses|mes)\b'), (y) => _proximos(int.parse(y[1]!), y[2]!, hoy)),
    (RegExp(r'\bproxima semana\b'), (_) => _proximos(7, 'dias', hoy)),
    (RegExp(r'\bproximo mes\b'), (_) => _proximos(30, 'dias', hoy)),
  ];
  for (final (re, fn) in reglas) {
    final y = _busca(re, t);
    final r = y != null ? fn(y) : null;
    if (r != null) return (r, _blank(t, y!.start, y.end));
  }
  x = _busca(RegExp(r'\b(primer|1er|segundo|2do|tercer|3er|cuarto|4to|ultimo) (trimestre|semestre)(?: (?:de|del) (\d{4}))?\b'), t);
  if (x != null) {
    var n = const {'primer': 1, '1er': 1, 'segundo': 2, '2do': 2, 'tercer': 3, '3er': 3, 'cuarto': 4, '4to': 4, 'ultimo': 4}[x[1]]!;
    final y = x[3] != null ? int.parse(x[3]!) : hoy.year;
    DateTime a, b;
    if (x[2] == 'trimestre') {
      a = f.fecha(y, 3 * n - 2, 1);
      b = f.finMes(y, 3 * n);
    } else {
      n = m.min(n, 2);
      a = f.fecha(y, 6 * n - 5, 1);
      b = f.finMes(y, 6 * n);
    }
    return (_rango(a, b, '${x[1]} ${x[2]} de $y'), _blank(t, x.start, x.end));
  }
  x = _busca(RegExp(r'\b(?:este trimestre|trimestre actual)\b'), t);
  if (x != null) {
    final q = (hoy.month - 1) ~/ 3;
    return (_rango(f.fecha(hoy.year, 3 * q + 1, 1), hoy, 'este trimestre'), _blank(t, x.start, x.end));
  }
  // meses
  final ms = RegExp(r'\b(' + _mesAlt + r')\b(?: (?:de|del) (\d{4})| (\d{4})\b)?').allMatches(t).toList();
  if (ms.isNotEmpty) {
    final rs = <(DateTime, DateTime)>[];
    var restos = t;
    for (final y in ms) {
      final mes = _meses[y[1]]!;
      final an = int.tryParse(y[2] ?? y[3] ?? '');
      rs.add(_mesRango(_anioDe(mes, an, hoy), mes));
      restos = _blank(restos, y.start, y.end);
    }
    final a = _minF(rs.map((r) => r.$1)), b = _maxF(rs.map((r) => r.$2));
    final et = a.year == b.year && a.month == b.month
        ? '${f.mesesN[a.month - 1]} de ${a.year}'
        : '${f.mesesN[a.month - 1]} ${a.year} a ${f.mesesN[b.month - 1]} ${b.year}';
    return (_rango(a, b, et), restos);
  }
  // años
  final anios = <(int, int, int)>[];
  for (final y in RegExp(r'\b(20\d{2})\b').allMatches(t)) {
    final antes = t.substring(m.max(0, y.start - 16), y.start);
    if (RegExp(r'(anios?|anos?|en|del|de|durante|desde|hasta|entre|y|al|a)\s+(el\s+)?(anio\s+|ano\s+)?$').hasMatch(antes)) {
      anios.add((y.start, y.end, int.parse(y[1]!)));
    }
  }
  if (anios.isNotEmpty) {
    var restos = t;
    for (final a in anios) {
      restos = _blank(restos, a.$1, a.$2);
    }
    final ys = anios.map((a) => a.$3).toList();
    final antes = t.substring(m.max(0, anios[0].$1 - 16), anios[0].$1);
    if (ys.length >= 2) {
      return (_rango(f.fecha(ys.reduce(m.min), 1, 1), f.fecha(ys.reduce(m.max), 12, 31), '${ys.reduce(m.min)} a ${ys.reduce(m.max)}'), restos);
    }
    if (RegExp(r'desde(?: el)?(?: anio| ano)? $').hasMatch(antes)) return (_rango(f.fecha(ys[0], 1, 1), hoy, 'desde ${ys[0]}'), restos);
    if (RegExp(r'hasta(?: el)?(?: anio| ano)? $').hasMatch(antes)) return (_rango(null, f.fecha(ys[0], 12, 31), 'hasta ${ys[0]}'), restos);
    return (_rango(f.fecha(ys[0], 1, 1), f.fecha(ys[0], 12, 31), 'el año ${ys[0]}'), restos);
  }
  return (null, t);
}

// ----------------------------- columnas y valores -----------------------------

typedef Mencion = (int, int, String);

List<Mencion> menciones(String t, String dsId, [List<String>? tipos]) {
  final pares = <(String, String)>[];
  for (final c in _columnas(dsId)) {
    if (tipos != null && !tipos.contains(c['tipo'])) continue;
    for (final fr in frases(c)) {
      pares.add((fr, c['nombre'] as String));
    }
  }
  final ord = ordenEstable(pares, (a, b) => b.$1.length - a.$1.length);
  var work = t;
  final out = <Mencion>[];
  for (final (fr, nombre) in ord) {
    final re = _reFrase(fr);
    var pos = 0;
    while (pos <= work.length) {
      final x = _busca(re, work, pos);
      if (x == null) break;
      out.add((x.start, x.end, nombre));
      work = _blank(work, x.start, x.end);
      pos = x.end > x.start ? x.end : x.end + 1;
    }
  }
  return ordenEstable(out, (a, b) => a.$1 - b.$1);
}

String? colPorRaiz(String dsId, String palabra) {
  final sin = palabra.replaceFirst(RegExp(r'(es|s)$'), '');
  final raiz = sin.length >= 5 ? sin.substring(0, 5) : sin;
  if (raiz.length < 4) return null;
  for (final c in _columnas(dsId)) {
    if (frases(c).any((fr) => fr.startsWith(raiz) || fr.split(' ').any((w) => w.startsWith(raiz)))) return c['nombre'] as String;
  }
  return null;
}

List<String> _numCols(String dsId) => [for (final c in _columnas(dsId)) if (c['tipo'] == 'numero') c['nombre'] as String];

String? _cercana(int pos, List<Mencion> ments, List<String> validas) {
  final c = ordenEstable([for (final x in ments) if (validas.contains(x.$3)) ((x.$1 - pos).abs(), x.$3)], (a, b) => a.$1 - b.$1);
  return c.isNotEmpty ? c.first.$2 : null;
}

RegExp _reValor(String v) => RegExp(v.length > 3 && RegExp(r'[oa]$').hasMatch(v)
    ? r'\b' + escapar(v.substring(0, v.length - 1)) + r'(?:o|a|os|as)\b'
    : r'\b' + escapar(v) + r'(?:s|es)?\b');
bool _tieneToken(String t, String tk) => RegExp(r'\b' + escapar(tk) + r'\b').hasMatch(t);

/// Filtros por valores que existen en los datos: "almuerzo", "cobrado", "beca completa", nombres de estudiantes.
({List<Mapa> filtros, List<List<int>> spans}) valores(String t, String dsId, List<mo.Fila>? rows, [String modo = 'resto']) {
  final filtros = <Mapa>[];
  final spans = <List<int>>[];
  if (rows == null) return (filtros: filtros, spans: spans);
  for (final c in _columnas(dsId)) {
    final tipo = c['tipo'];
    if (tipo != 'categoria' && tipo != 'texto') continue;
    final esNombre = tipo == 'texto' && c['nombre'] != 'insumo';
    if ((modo == 'nombres') != esNombre) continue;
    final nombre = c['nombre'] as String;
    final unicos = <String>{for (final r in rows) if (r[nombre] != null) js(r[nombre])}.toList();
    if (unicos.isEmpty || unicos.length > 600) continue;
    final hallados = <(int, String, bool)>[];
    final todosTokens = unicos.map((v) => norm(v).split(' ').where((x) => x.length >= 3).toList()).toList();
    for (var idx = 0; idx < unicos.length; idx++) {
      final v = unicos[idx];
      final nv = norm(v);
      if (esNombre) {
        // nombres de personas
        final toks = todosTokens[idx];
        void marcar(List<String> tks) {
          for (final tk in tks) {
            for (final x in RegExp(r'\b' + escapar(tk) + r'\b').allMatches(t)) {
              spans.add([x.start, x.start + tk.length]);
            }
          }
        }

        if (toks.length >= 2) {
          final usados = toks.where((tk) => _tieneToken(t, tk)).toList();
          if (usados.length >= 2) {
            hallados.add((t.indexOf(toks[0]), v, false));
            marcar(usados);
          }
        } else if (toks.length == 1 && toks[0].length >= 4 && !_enVocab(toks[0]) && _tieneToken(t, toks[0])) {
          hallados.add((t.indexOf(toks[0]), v, false));
          marcar(toks);
        }
        continue;
      }
      final variantes = <String>{nv};
      if (nv.contains('/')) { // "QR / tarjeta": también vale "qr" o "tarjeta" sola
        nv.split('/').map((x) => x.trim()).where((x) => x.length >= 2).forEach(variantes.add);
      }
      for (final va in variantes) {
        if (va.length < (va == nv ? 3 : 2) || (_sinPalabra.containsKey(va) && !t.contains(_sinPalabra[va]!))) continue;
        final x = _busca(_reValor(va), t);
        if (x != null) {
          final antes = t.substring(m.max(0, x.start - 14), x.start);
          hallados.add((x.start, v, RegExp(r'\b(sin|excepto|salvo|menos|no|excluyendo)\s+(?:los |las |el |la )?$').hasMatch(antes)));
          break;
        }
      }
    }
    // un apellido o nombre que identifica a una sola persona vale; si varias comparten el token, solo cuenta el nombre completo
    final pos = hallados.where((h) => !h.$3).map((h) => h.$2).toList();
    final neg = hallados.where((h) => h.$3).map((h) => h.$2).toList();
    if (pos.isNotEmpty) filtros.add({'col': nombre, 'op': pos.length == 1 ? '=' : 'en', 'valor': pos.length == 1 ? pos[0] : pos});
    if (neg.isNotEmpty) filtros.add({'col': nombre, 'op': neg.length == 1 ? '!=' : 'no_en', 'valor': neg.length == 1 ? neg[0] : neg});
  }
  return (filtros: filtros, spans: spans);
}

/// Expresiones del negocio que equivalen a filtros: "stock bajo", "sin beca", "por vencer", "inactivos"...
({List<Mapa> filtros, List<Mapa> orden}) frasesEspeciales(String t, String dsId) {
  final filtros = <Mapa>[];
  final orden = <Mapa>[];
  bool r(String p) => RegExp(p).hasMatch(t);
  if (dsId == 'insumos') {
    if (r(r'\b(stock bajo|bajo stock|agotad\w+|por reponer|escasos?|faltan?|faltantes)\b')) filtros.add({'col': 'estado', 'op': '=', 'valor': 'Bajo'});
    if (r(r'\bvencid\w+\b')) {
      filtros.add({'col': 'diasParaVencer', 'op': '<', 'valor': 0});
    } else if (r(r'\b(por vencer|proximos? a vencer|a punto de vencer)\b') && !r(r'\bdias\b')) {
      filtros.add({'col': 'diasParaVencer', 'op': 'entre', 'valor': [0, 7]});
      orden.add({'col': 'vence', 'dir': 'asc'});
    }
  }
  if (dsId == 'estudiantes') {
    if (r(r'\bsin beca\b')) {
      filtros.add({'col': 'beca', 'op': '=', 'valor': 'Sin beca'});
    } else if (r(r'\b(con beca|becad[oa]s?|becari[oa]s?)\b')) {
      filtros.add({'col': 'beca', 'op': '!=', 'valor': 'Sin beca'});
    }
    if (r(r'\b(sin reservas|no reservaron|nunca reservaron)\b')) filtros.add({'col': 'reservas', 'op': '=', 'valor': 0});
  }
  if (dsId == 'reservas' && _vinieron.hasMatch(t)) filtros.add({'col': 'estado', 'op': '=', 'valor': 'Consumida'});
  if (dsId == 'becas') {
    if (r(r'\b(inactiv\w+|sin usar|sin uso|no (?:la )?(?:usan|usaron|usa)|desaprovechad\w+)\b')) filtros.add({'col': 'usadas', 'op': '=', 'valor': 0});
    if (r(r'\b(no vigentes?|vencidas?|expiradas?)\b')) {
      filtros.add({'col': 'vigente', 'op': '=', 'valor': 'No'});
    } else if (r(r'\b(vigentes?|activas?|activos?)\b')) {
      filtros.add({'col': 'vigente', 'op': '=', 'valor': 'Sí'});
    }
  }
  return (filtros: filtros, orden: orden);
}

// ----------------------------- detección del conjunto de datos -----------------------------

({String? id, double score, List<(String, double)> ranking}) detectarDataset(String t) {
  if (_vinieron.hasMatch(t) && !_delPersonal.hasMatch(t)) return (id: 'reservas', score: 5.0, ranking: [('reservas', 5.0)]);
  final compartidas = <String, int>{};
  for (final ds in Catalogo.datasets.values) {
    for (final c in (ds['columnas'] as List)) {
      compartidas[c['nombre'] as String] = (compartidas[c['nombre']] ?? 0) + 1;
    }
  }
  final puntaje = <String, double>{};
  for (final e in Catalogo.datasets.entries) {
    final ds = e.value as Map<String, dynamic>;
    var s = 0.0;
    final usadas = <String>{};
    final sins = (ds['sinonimos'] as List).cast<String>();
    for (var i = 0; i < sins.length; i++) {
      final syn = sins[i];
      final fam = norm(syn).replaceFirst(RegExp(r'(es|s)$'), '');
      if (!usadas.contains(fam) && _reFrase(norm(syn)).hasMatch(t)) {
        s += i < 3 ? 3 : 2;
        usadas.add(fam);
        if (RegExp(r'\b(?:de|del)(?: los| las| el| la)? ' + escapar(norm(syn))).hasMatch(t)) s += 2; // "de los pagos": ahí está el tema
      }
    }
    for (final r in (ds['raices'] as List?) ?? []) {
      if (RegExp(r'\b' + (r as String) + r'\w*').hasMatch(t)) s += 3;
    }
    for (final c in (ds['columnas'] as List).cast<Map<String, dynamic>>()) {
      if (frases(c).any((fr) => _reFrase(fr).hasMatch(t))) s += (compartidas[c['nombre']] ?? 0) > 1 ? 0.5 : 1.5;
    }
    puntaje[e.key] = s;
  }
  final orden = ordenEstable(puntaje.entries, (a, b) => b.value.compareTo(a.value)).map((e) => (e.key, e.value)).toList();
  final mejor = orden[0].$1, s = orden[0].$2;
  final top = orden.take(3).toList();
  if (s >= 1.5) return (id: mejor, score: s, ranking: top);
  // respaldo: parecido de palabras (TF-IDF simplificado)
  final docs = [
    for (final d in Catalogo.datasets.values) norm('${d['etiqueta']} ${d['descripcion']} ${d['palabras_clave']}').split(' ')
  ];
  final df = <String, int>{};
  for (final d in docs) {
    for (final w in d.toSet()) {
      df[w] = (df[w] ?? 0) + 1;
    }
  }
  double idf(String w) => m.log((1 + docs.length) / (1 + (df[w] ?? 0))) + 1;
  Map<String, double> vec(List<String> ws) {
    final v = <String, double>{};
    for (final w in ws) {
      v[w] = (v[w] ?? 0) + idf(w);
    }
    return v;
  }

  double coseno(Map<String, double> a, Map<String, double> b) {
    double p = 0, na = 0, nb = 0;
    for (final k in a.keys) {
      na += a[k]! * a[k]!;
      if (b[k] != null && b[k] != 0) p += a[k]! * b[k]!;
    }
    for (final k in b.keys) {
      nb += b[k]! * b[k]!;
    }
    return na != 0 && nb != 0 ? p / m.sqrt(na * nb) : 0;
  }

  final q = vec(t.split(' ').where((w) => w.length > 2).toList());
  final sims = docs.map((d) => coseno(q, vec(d))).toList();
  final i = sims.indexOf(sims.reduce(m.max));
  if (sims[i] >= 0.12) return (id: Catalogo.datasets.keys.elementAt(i), score: sims[i] * 10, ranking: top);
  return (id: null, score: s, ranking: top);
}

// ----------------------------- lectura de una petición -----------------------------

final _patronesComp = <(RegExp, String)>[
  (RegExp(r'\b(?:mayor(?:es)?|superior(?:es)?|mas|por encima|superen|supera|excedan?)\s+(?:de|a|que|del)?\s*(?:bs\.? ?|\$)?(\d+(?:[.,]\d+)?)\b(?! (?:mayores|menores))'), '>'),
  (RegExp(r'\b(?:al menos|como minimo|minimo de|no menos de|a partir de)\s+(?:bs\.? ?)?(\d+(?:[.,]\d+)?)\b'), '>='),
  (RegExp(r'\b(?:menor(?:es)?|inferior(?:es)?|menos|por debajo)\s+(?:de|a|que|del)\s*(?:bs\.? ?|\$)?(\d+(?:[.,]\d+)?)\b'), '<'),
  (RegExp(r'\b(?:como maximo|maximo de|a lo sumo|no mas de)\s+(?:bs\.? ?)?(\d+(?:[.,]\d+)?)\b'), '<='),
  (RegExp(r'\b(?:igual a|exactamente|justo)\s+(?:bs\.? ?)?(\d+(?:[.,]\d+)?)\b'), '='),
  (RegExp(r'\bde (\d+(?:[.,]\d+)?) (?:bs|bolivianos)\b'), '='),
];

Mapa _leer(String t0, String dsId, List<mo.Fila>? rows, DateTime hoy) {
  final ds = Catalogo.datasets[dsId] as Map<String, dynamic>;
  final dsFecha = ds['fecha'] as String?;
  final dsDefecto = (ds['defecto'] as List).cast<String>();
  var t = t0;
  final p = <String, dynamic>{};
  for (final (nombre, re) in _formatos) {
    final x = re.firstMatch(t);
    if (x != null) {
      p['salida'] = nombre;
      t = _blank(t, x.start, x.end);
      break;
    }
  }
  final nombres = valores(t, dsId, rows, 'nombres'); // "admin julio" es una persona, no el mes de julio
  for (final s in nombres.spans) {
    t = _blank(t, s[0], s[1]);
  }
  final (fe, t1) = parseFechas(t, hoy);
  t = t1;
  if (fe != null) p['fecha'] = fe;
  if (RegExp(r'\b(todas las fechas|sin fecha|todo el historial|todo el tiempo|historico)\b').hasMatch(t)) p['quitar_fecha'] = true;

  String? direccion;
  for (final (re, d) in [
    (RegExp(r'\bde mayor a menor\b'), 'desc'),
    (RegExp(r'\bde menor a mayor\b'), 'asc'),
    (RegExp(r'\b(descendente|descendentemente|decreciente|de z a a)\b'), 'desc'),
    (RegExp(r'\b(ascendente|ascendentemente|creciente|de a a z)\b'), 'asc'),
  ]) {
    final x = re.firstMatch(t);
    if (x != null) {
      direccion = d;
      t = _blank(t, x.start, x.end);
      break;
    }
  }

  // comparaciones numéricas ("mayores a 5" no es "los mayores")
  final mentsNum = menciones(t, dsId, ['numero']);
  final filtros = <Mapa>[];
  final consumidos = <(List<int>, String, Object)>[];
  var x = RegExp(r'\bentre (?:bs\.? ?)?(\d+(?:[.,]\d+)?) y (?:bs\.? ?)?(\d+(?:[.,]\d+)?)\b').firstMatch(t);
  if (x != null) consumidos.add((_spanDe(x), 'entre', [_numero(x[1]!), _numero(x[2]!)]));
  for (final (re, op) in _patronesComp) {
    for (final y in re.allMatches(t)) {
      final a = y.start;
      if (consumidos.any((c) => a >= c.$1[0] && a < c.$1[1])) continue;
      consumidos.add((_spanDe(y), op, _numero(y[1]!)));
    }
  }
  final consOrd = ordenEstable(consumidos, (a, b) => a.$1[0] - b.$1[0]);
  final numCols = _numCols(dsId);
  for (final (sp, op, val) in consOrd) {
    final a = sp[0], b = sp[1];
    final col = _cercana(a, mentsNum, numCols) ?? _colNum[dsId] ?? (numCols.isNotEmpty ? numCols[0] : null);
    final antes = t.substring(m.max(0, a - 30), a);
    final post = RegExp(r'\b(con|que tengan|que sumen|que superen|cuyo|cuyos|donde el|total|promedio|cantidad)\b').hasMatch(antes) && col != null;
    if (col != null) filtros.add({'col': col, 'op': op, 'valor': val, if (post) 'post': true});
    t = _blank(t, a, b);
  }

  final esp = frasesEspeciales(t, dsId);
  filtros.addAll(esp.filtros);
  filtros.addAll(nombres.filtros);
  filtros.addAll(valores(t, dsId, rows).filtros);
  final dias = <int>[];
  for (final e in _dias.entries) {
    if (RegExp(r'\b(?:los |solo los |solo )?' + e.key + r's?\b').hasMatch(t)) dias.add(e.value);
  }
  if (dias.isNotEmpty && dsFecha != null) filtros.add({'col': dsFecha, 'op': 'dia_semana', 'valor': (dias.toSet().toList()..sort())});

  // orden explícito: "ordenado por X ascendente"
  var orden = <Mapa>[];
  int? limite;
  x = RegExp(r'\b(?:ordenad[oa]s?|ordena(?:r|lo|los|las)?|orden|clasificad[oa]s?)\s+(?:de forma |en forma )?(?:por|segun)\s+(.+)').firstMatch(t);
  if (x != null) {
    final resto = x[1]!;
    final cols = menciones(resto, dsId).map((e) => e.$3).toList();
    if (RegExp(r'\b(total|cantidad|suma|promedio)\b').hasMatch(resto) && cols.isEmpty) cols.add('__medida__');
    orden = [for (final c in cols.take(3)) {'col': c, 'dir': direccion ?? 'asc'}];
    t = _blank(t, x.start, x.end);
  } else {
    x = RegExp(r'\bpor\s+(.+?)\s+(?:de forma\s+)?(asc|desc)\w*').firstMatch(t);
    if (x != null) {
      final cols = menciones(x[1]!, dsId).map((e) => e.$3).toList();
      if (cols.isNotEmpty) {
        orden = [{'col': cols[0], 'dir': x[2] == 'desc' ? 'desc' : 'asc'}];
        t = _blank(t, x.start, x.end);
      }
    }
  }
  if (orden.isEmpty) orden = [for (final o in esp.orden) {...o}];

  // rankings: "los 10 mayores", "los 5 más pedidos", "el mayor"
  final tEnt = t; // antes de borrar el ranking: ahí aparece la entidad ("los 5 platos más...")
  String? rankCol;
  var hubo = false;
  final ranking = <(RegExp, String, int)>[
    (RegExp(r'\b(?:los |las )?(?:top |ranking )?(\d+)(?: \w+){0,2}? (?:mayor(?:es)?|mejor(?:es)?|principal(?:es)?|mas altos?|mas caros?|maximos?)\b'), 'desc', 0),
    (RegExp(r'\b(?:los |las )?(\d+)(?: \w+){0,2}? (?:menor(?:es)?|peor(?:es)?|mas bajos?|mas baratos?|minimos?)\b'), 'asc', 0),
    (RegExp(r'\b(?:los |las )?(\d+)(?: \w+){0,2}? (?:con |que )?mas (\w+)'), 'desc', 2),
    (RegExp(r'\b(?:los |las )?(\d+)(?: \w+){0,2}? (?:con |que )?menos (\w+)'), 'asc', 2),
    (RegExp(r'\b(?:los |las )?(?:top|ranking) (\d+)\b'), 'desc', 0),
    (RegExp(r'\b(?:los |las )?(\d+) primer[oa]s\b|\bprimer[oa]s (\d+)\b'), 'first', 0),
    (RegExp(r'\b(?:los |las )?(\d+) ultim[oa]s\b'), 'last', 0),
  ];
  for (final (re, d, g) in ranking) {
    x = re.firstMatch(t);
    if (x == null) continue;
    String? numTxt;
    for (var i = 1; i <= x.groupCount; i++) {
      final gi = x[i];
      if (gi != null && RegExp(r'^\d+$').hasMatch(gi)) {
        numTxt = gi;
        break;
      }
    }
    limite = int.parse(numTxt!);
    hubo = true;
    if (d == 'desc' || d == 'asc') {
      direccion ??= d;
      if (g != 0) rankCol = colPorRaiz(dsId, x[g]!);
    } else if (d == 'last' && dsFecha != null && orden.isEmpty) {
      orden = [{'col': dsFecha, 'dir': 'desc'}];
    }
    t = _blank(t, x.start, x.end);
    break;
  }
  if (!hubo) {
    x = RegExp(r'\bel (mayor|mejor|maximo|mas alto|mas caro|menor|peor|minimo|mas bajo|mas barato)\b').firstMatch(t);
    if (x != null) {
      limite = 1;
      hubo = true;
      direccion ??= const ['mayor', 'mejor', 'maximo', 'mas alto', 'mas caro'].contains(x[1]) ? 'desc' : 'asc';
      t = _blank(t, x.start, x.end);
    }
  }
  if (!hubo) {
    for (final (re, d) in [
      (RegExp(r'\b(?:los |las )?(?:mayor(?:es)?|mas altos?|mas caros?|mejores)\b'), 'desc'),
      (RegExp(r'\b(?:los |las )?(?:menor(?:es)?|mas bajos?|mas baratos?|peores)\b'), 'asc'),
    ]) {
      x = re.firstMatch(t);
      if (x != null) {
        direccion ??= d;
        t = _blank(t, x.start, x.end);
        break;
      }
    }
    x = RegExp(r'\b(?:con )?(mas|menos) (\w+)(?: (\w+))?\b').firstMatch(t);
    final cr = x == null ? null : ((x[3] != null ? colPorRaiz(dsId, x[3]!) : null) ?? colPorRaiz(dsId, x[2]!));
    if (cr != null) {
      rankCol = cr;
      direccion ??= x![1] == 'mas' ? 'desc' : 'asc';
      t = _blank(t, x!.start, x.end);
    }
  }
  if (limite == null) {
    x = RegExp(r'\b(?:solo |maximo |hasta |limitar a |limite de )?(\d+) (?:registros|filas|resultados|renglones)\b|\b(?:limite|limitar a) (\d+)\b').firstMatch(t);
    if (x != null) {
      limite = int.parse(x[1] ?? x[2]!);
      t = _blank(t, x.start, x.end);
    }
  }

  // agrupación
  final agrupar = <Mapa>[];
  x = RegExp(r'\b(?:agrupad[oa]s?|agrupa(?:r|do)?|desglosad[oa]s?|separad[oa]s?|segmentad[oa]s?)?\s*(?:por|segun|cada)\s+(?:cada\s+)?(dia de la semana|dias de la semana|dia|dias|semana|semanas|mes|meses|trimestre|trimestres|anio|anios|ano|anos)\b').firstMatch(t);
  if (x != null && dsFecha != null) {
    agrupar.add({'col': dsFecha, 'por': _tiempo[x[1]]});
    t = _blank(t, x.start, x.end);
  }
  for (final y in RegExp(r'\b(mensual(?:mente)?|diari[oa](?:mente)?|semanal(?:mente)?|anual(?:mente)?|trimestral)\b').allMatches(t).toList()) {
    if (agrupar.isEmpty && dsFecha != null) agrupar.add({'col': dsFecha, 'por': _tiempo[y[1]]});
    t = _blank(t, y.start, y.end);
  }
  for (final y in RegExp(r'\b(?:de |para )?cada\s+(\w+)').allMatches(t).toList()) {
    if (_tiempo[y[1]] != null && agrupar.isEmpty && dsFecha != null) {
      agrupar.add({'col': dsFecha, 'por': _tiempo[y[1]]});
      t = _blank(t, y.start, y.end);
    }
  }
  for (final y in RegExp(r'\b(?:agrupad[oa]s?\s+por|desglosad[oa]s?\s+por|por|para cada|de cada|segun|cada)\s+(?:cada\s+)?([a-z ]{3,40})').allMatches(t).toList()) {
    final ments = menciones(y[1]!, dsId);
    if (ments.isEmpty) continue;
    final mm = ments[0];
    final c = Catalogo.columna(dsId, mm.$3)!;
    if ((c['tipo'] == 'categoria' || c['tipo'] == 'texto') && !agrupar.any((g) => g['col'] == mm.$3)) {
      agrupar.add({'col': mm.$3});
    } else if (c['tipo'] == 'fecha' && agrupar.isEmpty) {
      agrupar.add({'col': mm.$3, 'por': 'dia'});
    }
  }

  // medidas
  var medidas = <Mapa>[];
  final cuantos = RegExp(r'\b(cuant[oa]s?|cantidad|numero de|conteo|contar|cuenta)\b').hasMatch(t);
  for (final (re, fn) in [
    (RegExp(r'\b(promedio|media|promedi\w+)\b'), 'avg'),
    (RegExp(r'\b(maximo|pico|valor mas alto)\b'), 'max'),
    (RegExp(r'\b(minimo|valor mas bajo)\b'), 'min'),
    (RegExp(r'\b(suma|sumatoria|sumar|total|totales|acumulado|recaud\w+|ingres\w+|cobrad\w+ en total|gastad\w+)\b'), 'sum'),
  ]) {
    x = re.firstMatch(t);
    if (x == null) continue;
    final col = _cercana(x.start, menciones(t, dsId, ['numero']), numCols) ?? _colNum[dsId];
    if (fn == 'sum' && col == null) {
      medidas.add({'fn': 'count'});
    } else if (col != null) {
      medidas.add({'fn': fn, 'col': col});
    }
    break;
  }
  if (cuantos && !medidas.any((e) => e['fn'] == 'count')) {
    if (medidas.isEmpty || RegExp(r'\b(cuant[oa]s?|cantidad de|numero de)\b').hasMatch(t)) medidas.add({'fn': 'count'});
  }
  if (RegExp(r'\b(distint[oa]s|diferentes|unic[oa]s)\b').hasMatch(t) && cuantos) {
    final ments = menciones(t, dsId, ['texto', 'categoria']);
    if (ments.isNotEmpty) medidas = [{'fn': 'nunique', 'col': ments[0].$3}];
  }

  // ranking sobre una entidad: "los 5 platos más reservados" => agrupar por plato
  if ((hubo || rankCol != null) && agrupar.isEmpty) {
    // solo un ranking explícito ("los 5 platos más..."), no un simple "descendente"
    final subj = (ds['sinonimos'] as List).map(norm).toSet();
    for (final ment in menciones(tEnt, dsId, ['categoria', 'texto'])) {
      final n = ment.$3;
      final fr = frases(Catalogo.columna(dsId, n)!);
      final esSujeto = fr.any(subj.contains) && !const ['reservas', 'pagos', 'menus', 'desperdicio'].contains(dsId);
      if (!esSujeto && !(dsId == 'estudiantes' && const ['nombre', 'matricula', 'email', 'telefono'].contains(n))) {
        agrupar.add({'col': n});
        break;
      }
    }
  }
  if (agrupar.isNotEmpty && medidas.isEmpty && rankCol != null && Catalogo.columna(dsId, rankCol)!['tipo'] == 'numero') {
    medidas = [{'fn': Catalogo.columna(dsId, rankCol)!['fmt'] == 'porcentaje' ? 'avg' : 'sum', 'col': rankCol}];
  }

  // orden por defecto de un ranking
  if (direccion != null && orden.isEmpty) {
    if (agrupar.isNotEmpty || medidas.isNotEmpty) {
      orden = [{'col': '__medida__', 'dir': direccion}];
    } else {
      final col = rankCol ?? _colNum[dsId];
      if (col != null) orden = [{'col': col, 'dir': direccion}];
    }
  } else if (direccion != null && orden.isNotEmpty) {
    for (final o in orden) {
      if (o['dir'] == 'asc' && direccion != 'asc') o['dir'] = direccion;
    }
  }

  // columnas visibles (solo si no se agrupa)
  final pide = RegExp(r'\b(ver|mostrar|muestra|muestrame|mostrame|dame|listar|lista|listame|columnas|campos|atributos|incluye|incluir)\b').hasMatch(t0);
  String base(String w) => w.replaceFirst(RegExp(r'(es|s)$'), '');
  final tema = (ds['sinonimos'] as List).map((e) => base(norm(e))).toSet();
  final tFinal = t;
  final cols = <String>[];
  for (final ment in menciones(tFinal, dsId)) {
    if (tema.contains(base(tFinal.substring(ment.$1, ment.$2)))) continue;
    if (!cols.contains(ment.$3)) cols.add(ment.$3);
  }
  if (pide && cols.isNotEmpty && agrupar.isEmpty && medidas.isEmpty) {
    final solo = RegExp(r'\b(solo|solamente|unicamente)\b').hasMatch(t0);
    p['columnas'] = cols.length >= 2 || solo ? cols : dsDefecto.contains(cols[0]) ? dsDefecto : [...dsDefecto, ...cols];
  }
  p.addAll({'filtros': filtros, 'agrupar': agrupar, 'medidas': medidas, 'orden': orden, 'limite': limite, 'direccion': direccion});
  return p;
}

// ----------------------------- interpretación completa -----------------------------

Mapa _resolverMedidaOrden(Mapa spec) {
  final orden = (spec['orden'] as List?) ?? [];
  if (!orden.any((o) => o['col'] == '__medida__')) return spec;
  Map? med = ((spec['medidas'] as List?) ?? []).isNotEmpty ? (spec['medidas'] as List)[0] as Map : null;
  if (med == null && ((spec['agrupar'] as List?) ?? []).isNotEmpty) {
    final d = Catalogo.datasets[spec['dataset']]['medida'] as List;
    med = d.isNotEmpty ? (d[0][1] != null ? {'fn': d[0][0], 'col': d[0][1]} : {'fn': d[0][0]}) : {'fn': 'count'};
  }
  if (med != null) {
    final key = mo.medidaInfo(spec['dataset'] as String, med)['key'];
    for (final o in orden) {
      if (o['col'] == '__medida__') o['col'] = key;
    }
  } else {
    spec['orden'] = orden.where((o) => o['col'] != '__medida__').toList();
  }
  return spec;
}

// «quita la columna estado», «saca el método», «sin la columna estudiante», «agrega la matrícula»
final _quitarCol = RegExp(
    r'^(?:y |ahora |pero |tambien )?(?:quita(?:le|r)?|saca(?:le|r)?|elimina(?:le|r)?|borra(?:le|r)?|oculta(?:le|r)?|remueve|no (?:quiero ver|quiero|muestres|pongas)|sin)\b(.*)$');
final _agregarCol = RegExp(r'^(?:y |ahora |pero |tambien )?(?:agrega(?:le|r)?|anade(?:le)?|pon(?:le|er)?|incluye|muestra(?:me)? tambien|quiero ver tambien)\b(.*)$');

/// Quita o agrega columnas al reporte anterior. null si el pedido no es eso (p. ej. «sin beca» es un filtro).
Mapa? _editarColumnas(String t, Map previa) {
  if (((previa['agrupar'] as List?) ?? []).isNotEmpty || ((previa['medidas'] as List?) ?? []).isNotEmpty) return null;
  if (RegExp(r'\bfiltros?\b').hasMatch(t)) return null;
  final quitar = _quitarCol.firstMatch(t);
  final agregar = quitar == null ? _agregarCol.firstMatch(t) : null;
  final x = quitar ?? agregar;
  if (x == null) return null;
  if (RegExp(r'^(?:(?:y|ahora|pero|tambien) )?sin\b').hasMatch(t) && !RegExp(r'\bcolumnas?\b').hasMatch(t)) return null;
  final nombres = <String>[];
  for (final mm in menciones(x[1]!, previa['dataset'] as String)) {
    if (!nombres.contains(mm.$3)) nombres.add(mm.$3);
  }
  if (nombres.isEmpty) return null;
  final ds = Catalogo.datasets[previa['dataset']];
  var cols = List<String>.from((previa['columnas'] as List?) ?? (ds['defecto'] as List));
  if (quitar != null) {
    cols = cols.where((c) => !nombres.contains(c)).toList();
  } else {
    for (final n in nombres) {
      if (!cols.contains(n)) cols.add(n);
    }
  }
  if (cols.isEmpty) throw NoEntendido('El reporte tiene que quedar con al menos una columna.');
  final spec = jsonDecode(jsonEncode(previa)) as Mapa;
  spec['columnas'] = [for (final c in (ds['columnas'] as List)) if (cols.contains(c['nombre'])) c['nombre'] as String]; // orden del catálogo
  for (final (nombre, re) in _formatos) {
    if (re.hasMatch(t)) {
      spec['salida'] = nombre;
      break;
    }
  }
  return spec;
}

bool _esRefinamiento(String t) => RegExp(
        r'^(ahora|ademas|tambien|y |pero|mejor|solo|solamente|quitale|quita|agregale|agrega|ponle|pon |cambialo|cambia|ordenalo|ordena|filtralo|filtra|agrupalo|agrupa|muestrame tambien|que sea|en vez|en lugar)')
    .hasMatch(t);
bool _mismaClase(Object? op) => const ['=', 'en', '!=', 'no_en'].contains(op);

/// Frase que le dice a la persona cómo se interpretó su pedido.
String entendido(Map spec) {
  final dsId = spec['dataset'] as String;
  final ds = Catalogo.datasets[dsId];
  final partes = ['Quieres ver ${(ds['etiqueta'] as String).toLowerCase()}'];
  final medidas = (spec['medidas'] as List?) ?? [];
  if (medidas.isNotEmpty) {
    partes.add('calculando ${medidas.map((e) => (mo.medidaInfo(dsId, e as Map)['label'] as String).toLowerCase()).join(' y ')}');
  } else if (spec['columnas'] != null) {
    partes.add('con ${(spec['columnas'] as List).map((c) => (Catalogo.columna(dsId, c as String)!['etiqueta'] as String).toLowerCase()).join(', ')}');
  }
  final cond = mo.describir(spec);
  if (cond.isNotEmpty) partes.add('(${cond.join('; ')})');
  const salidas = {'pantalla': 'en pantalla', 'pdf': 'en PDF', 'excel': 'en Excel'};
  final salida = salidas[(spec['salida'] as String?) ?? 'pantalla'] ?? 'en pantalla';
  return '${partes.join(' ')}, $salida.';
}

/// texto -> { spec, entendi, notas, confianza, continuacion, alternativas }.
/// `previa` es la consulta anterior para continuar la conversación; `tablas` los datos {dataset: {columnas, filas}}.
Mapa interpretar(String texto, {Map? previa, DateTime? hoy, Map<String, dynamic>? tablas}) {
  hoy ??= f.hoyLocal();
  final t0 = corregirTipeos(norm(texto));
  if (t0.isEmpty) throw NoEntendido('Escribe o di qué reporte quieres.');
  if (RegExp(r'\b(nuevo reporte|otro reporte|desde cero|empezar de nuevo|reiniciar)\b').hasMatch(t0)) previa = null;
  final editado = previa != null && Catalogo.datasets.containsKey(previa['dataset']) ? _editarColumnas(t0, previa) : null;
  if (editado != null) {
    return {'spec': editado, 'entendi': entendido(editado), 'notas': <String>[], 'confianza': 1, 'continuacion': true, 'alternativas': <String>[]};
  }
  final det = detectarDataset(t0);
  var dsId = det.id;
  var refina = false;
  if (previa != null &&
      Catalogo.datasets.containsKey(previa['dataset']) &&
      (dsId == null || det.score < 1.5 || (dsId == previa['dataset'] && _esRefinamiento(t0)))) {
    dsId = previa['dataset'] as String;
    refina = true;
  }
  if (dsId == null) {
    throw NoEntendido('No entendí qué datos quieres ver. Prueba con: «pagos de noviembre por mes», «estudiantes con beca» o «insumos con stock bajo».');
  }
  final rows = tablas != null && tablas[dsId] != null ? mo.aObjetos(tablas[dsId] as Map<String, dynamic>) : null;
  final p = _leer(t0, dsId, rows, hoy);

  final Mapa spec = refina
      ? (jsonDecode(jsonEncode(previa)) as Mapa)
      : {'dataset': dsId, 'columnas': null, 'fecha': null, 'filtros': <Mapa>[], 'agrupar': <Mapa>[], 'medidas': <Mapa>[], 'orden': <Mapa>[], 'limite': null, 'salida': 'pantalla'};
  spec['dataset'] = dsId;
  if (RegExp(r'\b(sin filtros|quita(?:le)? los filtros|borra los filtros)\b').hasMatch(t0)) spec['filtros'] = <Mapa>[];
  if (RegExp(r'\b(sin agrupar|quita(?:le)? la agrupacion|en detalle|sin agrupacion)\b').hasMatch(t0)) {
    spec['agrupar'] = <Mapa>[];
    spec['medidas'] = <Mapa>[];
  }
  if (RegExp(r'\bsin limite\b|\btodos los registros\b').hasMatch(t0)) spec['limite'] = null;
  if (p['quitar_fecha'] == true) spec['fecha'] = null;
  if (p['fecha'] != null) spec['fecha'] = p['fecha'];
  var filtrosSpec = (spec['filtros'] as List).cast<Mapa>().toList();
  for (final fl in (p['filtros'] as List).cast<Mapa>()) {
    // un filtro nuevo reemplaza al anterior de esa columna
    filtrosSpec = filtrosSpec.where((x) => !(x['col'] == fl['col'] && _mismaClase(x['op']) == _mismaClase(fl['op']))).toList();
    filtrosSpec.add(fl);
  }
  spec['filtros'] = filtrosSpec;
  if ((p['agrupar'] as List).isNotEmpty) spec['agrupar'] = p['agrupar'];
  if ((p['medidas'] as List).isNotEmpty) spec['medidas'] = p['medidas'];
  if ((p['orden'] as List).isNotEmpty) {
    spec['orden'] = p['orden'];
  } else if (p['direccion'] != null && ((spec['agrupar'] as List).isNotEmpty || (spec['medidas'] as List).isNotEmpty)) {
    spec['orden'] = [{'col': '__medida__', 'dir': p['direccion']}];
  }
  if (_truthy(p['limite'])) spec['limite'] = p['limite'];
  if (p['salida'] != null) {
    spec['salida'] = p['salida'];
  } else if (!refina) {
    spec['salida'] = 'pantalla';
  }
  if (p['columnas'] != null) spec['columnas'] = p['columnas'];
  if ((spec['agrupar'] as List).isNotEmpty || (spec['medidas'] as List).isNotEmpty) spec['columnas'] = null;
  _resolverMedidaOrden(spec);

  final notas = <String>[];
  final dsFecha = Catalogo.datasets[dsId]['fecha'];
  if (spec['fecha'] == null && dsFecha != null) notas.add('No indicaste un período: se consideran todos los registros.');
  if ((p['agrupar'] as List).any((g) => g['por'] != null) && dsFecha == null) notas.add('Estos datos no tienen fechas para agrupar por tiempo.');
  return {
    'spec': spec,
    'entendi': entendido(spec),
    'notas': notas,
    'confianza': jsRound(m.min(1.0, (refina ? 3 : det.score) / 4) * 100) / 100,
    'continuacion': refina,
    'alternativas': [for (final r in det.ranking.skip(1)) if (r.$2 >= 1.5) r.$1],
  };
}
