// Motor de consultas: ejecuta, dentro del teléfono, la consulta estructurada que arma el lenguaje natural.
// Es un puerto línea a línea de motor.js (navegador) y motor.py (servidor); test/reportes_paridad_test.dart comprueba
// que los tres dan exactamente lo mismo.
//
// Consulta (spec): dataset, columnas, fecha {col?,desde,hasta,etiqueta}, filtros [{col,op,valor,post?}],
// agrupar [{col,por?}], medidas [{fn,col?}], orden [{col,dir}], limite.
import 'dart:math' as m;

import 'catalogo.dart';
import 'fechas.dart' as f;
import 'texto.dart';

class ConsultaInvalida implements Exception {
  ConsultaInvalida(this.mensaje);
  final String mensaje;
  @override
  String toString() => mensaje;
}

typedef Fila = Map<String, dynamic>;

const _meses3 = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const porEtiqueta = {'dia': 'Día', 'semana': 'Semana', 'mes': 'Mes', 'trimestre': 'Trimestre', 'anio': 'Año', 'dia_semana': 'Día de la semana'};
const _fnEtiqueta = {'sum': 'Total de', 'avg': 'Promedio de', 'max': 'Máximo de', 'min': 'Mínimo de', 'nunique': 'Distintos de'};
const _fnBase = {'sum': 'total', 'avg': 'promedio', 'max': 'maximo', 'min': 'minimo', 'nunique': 'distintos'};

String _cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
double _num(Object? v) {
  if (v == null || v == '') return double.nan;
  if (v is num) return v.toDouble();
  return double.tryParse('$v'.trim()) ?? double.nan;
}

bool _truthy(Object? v) => v != null && v != '' && v != false && !(v is num && (v == 0 || v.isNaN));
bool _esVacio(Object? v) => v == null || (v is double && v.isNaN);
String _diez(Object? v) {
  final s = '$v';
  return s.length < 10 ? s : s.substring(0, 10);
}

Object? redondear(Object? v) => v is num && v.isFinite ? jsRound(v * 100) / 100 : v;

// ----------------------------- tabla -----------------------------

List<Fila> aObjetos(Map<String, dynamic> tabla) {
  final cols = (tabla['columnas'] as List).cast<String>();
  return [
    for (final fila in tabla['filas'] as List)
      {for (var i = 0; i < cols.length; i++) cols[i]: i < (fila as List).length ? fila[i] : null}
  ];
}

// ----------------------------- filtros -----------------------------

List<Fila> aplicarFiltro(List<Fila> rows, Map f0, String dataset) {
  final col = f0['col'] as String;
  final op = f0['op'] as String;
  final cat = Catalogo.columna(dataset, col);
  if (cat == null) throw ConsultaInvalida('La columna «$col» no existe en ${Catalogo.datasets[dataset]['etiqueta']}');
  final lista = f0['valor'] is List ? f0['valor'] as List : [f0['valor']];
  if (op == 'dia_semana') {
    return rows.where((r) => _truthy(r[col]) && lista.any((x) => x is num && x == f.diaSemana(f.desdeIso(r[col])))).toList();
  }
  Object? Function(Object?) leer;
  List<Object?> vals;
  if (cat['tipo'] == 'fecha') {
    leer = (v) => _truthy(v) ? _diez(v) : null;
    vals = lista.map(_diez).toList();
  } else if (cat['tipo'] == 'numero') {
    leer = _num;
    vals = lista.map(_num).toList();
  } else {
    leer = (v) => v == null ? null : normSimple(v);
    vals = lista.map(normSimple).toList();
  }
  int cmp(Object a, Object b) => a is num && b is num ? a.compareTo(b) : '$a'.compareTo('$b');
  bool ok(Object v) {
    if (v is double && v.isNaN) return false;
    switch (op) {
      case '=': return v == vals[0];
      case '!=': return v != vals[0];
      case '>': return cmp(v, vals[0]!) > 0;
      case '>=': return cmp(v, vals[0]!) >= 0;
      case '<': return cmp(v, vals[0]!) < 0;
      case '<=': return cmp(v, vals[0]!) <= 0;
      case 'entre':
        if (vals.any((x) => x is! num)) return false; // como en JS: Math.min de textos da NaN y nada cumple
        final nums = vals.cast<num>();
        return cmp(v, nums.reduce(m.min)) >= 0 && cmp(v, nums.reduce(m.max)) <= 0;
      case 'contiene': return js(v).contains(js(vals[0]));
      case 'en': return vals.contains(v);
      case 'no_en': return !vals.contains(v);
      default: throw ConsultaInvalida('Operador desconocido: $op');
    }
  }
  // los distintos de (!=, no_en) conservan también los vacíos, como esperaría una persona
  final neg = op == '!=' || op == 'no_en';
  return rows.where((r) {
    final v = leer(r[col]);
    return v == null ? neg : ok(v);
  }).toList();
}

List<Fila> rangoFecha(List<Fila> rows, Map fl, String dataset) {
  final c = (fl['col'] as String?) ?? (Catalogo.datasets[dataset]['fecha'] as String?);
  if (c == null) return rows;
  final desde = fl['desde'] as String?, hasta = fl['hasta'] as String?;
  return rows.where((r) {
    final v = _truthy(r[c]) ? _diez(r[c]) : null;
    return v != null && (desde == null || desde.isEmpty || v.compareTo(desde) >= 0) && (hasta == null || hasta.isEmpty || v.compareTo(hasta) <= 0);
  }).toList();
}

// ----------------------------- agrupación -----------------------------

class _Clave {
  _Clave(this.k, this.txt);
  final String k;
  final String txt;
}

_Clave _claveFecha(Object v, String por) {
  final d = f.desdeIso(v);
  final y = d.year, mo = d.month;
  switch (por) {
    case 'dia':
      return _Clave(f.iso(d), f.dmy(d));
    case 'semana':
      final l = f.lunesDe(d);
      return _Clave(f.iso(l), 'Sem. ${f.dmy(l).substring(0, 5)}');
    case 'mes':
      return _Clave('$y-${mo.toString().padLeft(2, '0')}', '${_meses3[mo - 1]} $y');
    case 'trimestre':
      final q = (mo / 3).ceil();
      return _Clave('$y-T$q', 'T$q $y');
    case 'anio':
      return _Clave('$y', '$y');
    case 'dia_semana':
      final i = f.diaSemana(d);
      return _Clave('$i', _cap(f.diasN[i]));
    default:
      throw ConsultaInvalida('No sé agrupar por «$por»');
  }
}

Map<String, dynamic> medidaInfo(String dataset, Map mm) {
  final fn = mm['fn'] as String;
  if (fn == 'count') return {'key': 'cantidad', 'label': 'Cantidad', 'fmt': 'entero'};
  final cat = Catalogo.columna(dataset, mm['col'] as String)!;
  var fmt = fn == 'nunique' ? 'entero' : cat['fmt'];
  if (fn == 'avg' && fmt == 'entero') fmt = 'decimal';
  return {'key': '${_fnBase[fn]}_${mm['col']}', 'label': '${_fnEtiqueta[fn]} ${(cat['etiqueta'] as String).toLowerCase()}', 'fmt': fmt};
}

Object? calcular(List<Fila> rows, Map mm) {
  final fn = mm['fn'];
  if (fn == 'count') return rows.length;
  if (fn == 'nunique') return rows.map((r) => r[mm['col']]).toSet().length;
  final v = rows.map((r) => _num(r[mm['col']])).where((x) => !x.isNaN).toList();
  if (v.isEmpty) return null;
  if (fn == 'sum') return v.fold<double>(0, (a, b) => a + b);
  if (fn == 'avg') return v.fold<double>(0, (a, b) => a + b) / v.length;
  if (fn == 'max') return v.reduce(m.max);
  return v.reduce(m.min);
}

class _Resultado {
  _Resultado(this.out, this.meta);
  final List<Fila> out;
  final List<Map<String, dynamic>> meta;
}

typedef _LeerClave = _Clave? Function(Fila);

_Resultado _agrupar(List<Fila> rows, Map spec, String dataset) {
  final meta = <Map<String, dynamic>>[];
  final leers = <_LeerClave>[];
  final nombres = <String>[];
  for (final g in spec['agrupar'] as List) {
    final col = g['col'] as String;
    final cat = Catalogo.columna(dataset, col)!;
    if (cat['tipo'] == 'fecha') {
      final por = (g['por'] as String?) ?? 'mes';
      meta.add({'key': por, 'label': porEtiqueta[por], 'tipo': 'texto', 'fmt': null});
      leers.add((r) => _truthy(r[col]) ? _claveFecha(r[col]!, por) : null);
      nombres.add(por);
    } else {
      meta.add({'key': col, 'label': cat['etiqueta'], 'tipo': 'texto', 'fmt': null});
      leers.add((r) {
        final v = r[col] == null ? '(sin dato)' : js(r[col]);
        return _Clave(v, v);
      });
      nombres.add(col);
    }
  }
  final grupos = <String, ({List<_Clave> ks, List<Fila> rows})>{};
  for (final r in rows) {
    final ks = leers.map((c) => c(r)).toList();
    if (ks.any((k) => k == null)) continue;
    final id = ks.map((k) => k!.k).join('\u0001');
    grupos.putIfAbsent(id, () => (ks: ks.cast<_Clave>(), rows: <Fila>[]));
    grupos[id]!.rows.add(r);
  }
  final medidas = spec['medidas'] as List;
  final infos = medidas.map((mm) => medidaInfo(dataset, mm as Map)).toList();
  final out = <Fila>[];
  for (final g in grupos.values) {
    final fila = <String, dynamic>{};
    for (var i = 0; i < nombres.length; i++) {
      fila[nombres[i]] = g.ks[i].txt;
      fila['__k$i'] = g.ks[i].k;
    }
    for (var i = 0; i < medidas.length; i++) {
      fila[infos[i]['key'] as String] = calcular(g.rows, medidas[i] as Map);
    }
    out.add(fila);
  }
  for (final i in infos) {
    meta.add({'key': i['key'], 'label': i['label'], 'tipo': 'numero', 'fmt': i['fmt']});
  }
  return _Resultado(out, meta);
}

_Resultado _totalGeneral(List<Fila> rows, Map spec, String dataset) {
  final fila = <String, dynamic>{'concepto': 'Total general'};
  final meta = <Map<String, dynamic>>[
    {'key': 'concepto', 'label': 'Concepto', 'tipo': 'texto', 'fmt': null}
  ];
  for (final mm in spec['medidas'] as List) {
    final i = medidaInfo(dataset, mm as Map);
    fila[i['key'] as String] = rows.isNotEmpty || mm['fn'] == 'count' ? calcular(rows, mm) : 0;
    meta.add({'key': i['key'], 'label': i['label'], 'tipo': 'numero', 'fmt': i['fmt']});
  }
  return _Resultado([fila], meta);
}

// ----------------------------- orden y salida -----------------------------

int comparar(Object? a, Object? b) {
  if (a == b) return 0;
  if (_esVacio(a)) return 1; // vacíos al final
  if (_esVacio(b)) return -1;
  if (a is num && b is num) return (a - b).sign.toInt();
  return '$a'.compareTo('$b') < 0 ? -1 : 1;
}

typedef Clave = ({Object? Function(Fila) leer, bool asc});

List<Fila> ordenar(List<Fila> rows, List<Clave> claves) {
  return ordenEstable<Fila>(rows, (x, y) {
    for (final c in claves) {
      final a = c.leer(x), b = c.leer(y);
      final v = comparar(a, b);
      final sinVacios = a == null || b == null;
      if (v != 0) return c.asc || sinVacios ? v : -v;
    }
    return 0;
  });
}

String? resolverSalida(String col, Map spec, List<Map<String, dynamic>> meta, String dataset) {
  final claves = meta.map((x) => x['key'] as String).toList();
  if (claves.contains(col)) return col;
  for (final med in (spec['medidas'] as List?) ?? []) {
    if (med['col'] == col) return medidaInfo(dataset, med as Map)['key'] as String;
  }
  for (final g in (spec['agrupar'] as List?) ?? []) {
    final por = (g['por'] as String?) ?? 'mes';
    if (g['col'] == col && claves.contains(por)) return por;
  }
  if (col == 'cantidad' || col == 'count') return claves.contains('cantidad') ? 'cantidad' : null;
  return null;
}

const _simb = {'=': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤'};

List<String> describir(Map spec) {
  final out = <String>[];
  final ds = spec['dataset'] as String;
  final fe = spec['fecha'] as Map?;
  if (fe != null) out.add('Período: ${_truthy(fe['etiqueta']) ? fe['etiqueta'] : '${fe['desde']} a ${fe['hasta']}'}');
  for (final fl in (spec['filtros'] as List?) ?? []) {
    final et = Catalogo.etiqueta(ds, fl['col'] as String);
    final v = fl['valor'];
    final op = fl['op'] as String;
    if (op == 'entre') {
      out.add('$et entre ${js(v[0])} y ${js(v[1])}');
    } else if (op == 'dia_semana') {
      out.add('Solo ${(v as List).map((d) => f.diasN[(d as num).toInt()]).join(', ')}');
    } else if (op == 'en' || op == 'no_en') {
      out.add('$et ${op == 'en' ? 'es' : 'no es'} ${(v as List).map(js).join(' o ')}');
    } else if (op == 'contiene') {
      out.add('$et contiene «${js(v)}»');
    } else {
      out.add('$et ${_simb[op] ?? op} ${js(v)}');
    }
  }
  for (final g in (spec['agrupar'] as List?) ?? []) {
    out.add('Agrupado por ${g['por'] != null ? porEtiqueta[g['por']]!.toLowerCase() : Catalogo.etiqueta(ds, g['col'] as String).toLowerCase()}');
  }
  for (final o in (spec['orden'] as List?) ?? []) {
    Map? med;
    for (final mm in (spec['medidas'] as List?) ?? []) {
      if (medidaInfo(ds, mm as Map)['key'] == o['col']) {
        med = mm;
        break;
      }
    }
    final nombre = med != null ? (medidaInfo(ds, med)['label'] as String).toLowerCase() : Catalogo.etiqueta(ds, o['col'] as String).toLowerCase();
    out.add('Orden: $nombre ${o['dir'] == 'desc' ? 'de mayor a menor' : 'de menor a mayor'}');
  }
  if (_truthy(spec['limite'])) out.add('Primeros ${js(spec['limite'])} resultados');
  return out;
}

String tituloAuto(Map spec) {
  final dsId = spec['dataset'] as String;
  var base = Catalogo.datasets[dsId]['etiqueta'] as String;
  final medidas = (spec['medidas'] as List?) ?? [];
  final agr = (spec['agrupar'] as List?) ?? [];
  if (medidas.isNotEmpty && agr.isEmpty) {
    base = 'Resumen de ${base.toLowerCase()}';
  } else if (agr.isNotEmpty) {
    final g = agr[0];
    base = '$base por ${g['por'] != null ? porEtiqueta[g['por']]!.toLowerCase() : Catalogo.etiqueta(dsId, g['col'] as String).toLowerCase()}';
  }
  final fe = spec['fecha'] as Map?;
  if (fe != null && _truthy(fe['etiqueta'])) base += ' · ${fe['etiqueta']}';
  return base;
}

/// Formato es-BO: miles con punto, decimales con coma.
String _n(num x, int d) {
  final neg = x < 0;
  final partes = x.abs().toStringAsFixed(d).split('.');
  final ent = partes[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => '.');
  return '${neg ? '-' : ''}$ent${d > 0 ? ',${partes[1]}' : ''}';
}

String fmtValor(Object? v, Object? fmt) {
  if (v == null || (v is double && v.isNaN)) return '—';
  if (v is num) {
    if (fmt == 'moneda') return 'Bs ${_n(v, 2)}';
    if (fmt == 'porcentaje') return '${_n(v, 1)}%';
    return v == v.truncate() ? _n(v, 0) : _n(v, 2);
  }
  return '$v';
}

Map<String, dynamic>? grafico(String modo, List<Map<String, dynamic>> meta, List agr, List<Fila> filas, List medidas) {
  if (modo != 'agrupado' || filas.isEmpty) return null;
  final ncl = agr.length;
  var x = meta[0]['key'] as String;
  final ys = meta.skip(ncl).take(2).map((e) => e['key'] as String).toList();
  final temporal = ncl == 1 && const ['dia', 'semana', 'mes', 'trimestre', 'anio'].contains(agr[0]['por']);
  String tipo;
  if (temporal) {
    tipo = filas.length > 2 ? 'lineas' : 'barras';
  } else if (ncl == 1 && filas.length <= 6 && ys.length == 1 && medidas.isNotEmpty && const ['sum', 'count'].contains(medidas[0]['fn'])) {
    tipo = 'torta';
  } else {
    tipo = 'barras';
  }
  if (ncl > 1) {
    x = '__etiqueta';
    for (final fi in filas) {
      fi[x] = meta.take(ncl).map((mm) => js(fi[mm['key']])).join(' · ');
    }
  }
  return {'tipo': tipo, 'x': x, 'y': ys, 'etiquetas': {for (final mm in meta.skip(ncl).take(2)) mm['key'] as String: mm['label']}};
}

List<String> resumenTexto(String modo, String dataset, int nFiltrado, int totalFilas, List<Map<String, dynamic>> meta, List<Fila> filas,
    Map<String, dynamic>? totales, List agr) {
  final ds = (Catalogo.datasets[dataset]['etiqueta'] as String).toLowerCase();
  if (nFiltrado == 0) return ['No hay datos que cumplan estas condiciones.'];
  final out = ['Se analizaron ${_n(nFiltrado, 0)} registros de $ds.'];
  if (modo == 'agrupado' && filas.isNotEmpty) {
    final mm = meta[agr.length];
    final k = mm['key'] as String;
    final vals = filas.where((r) => r[k] != null).toList();
    if (vals.isNotEmpty) {
      String etiq(Fila r) => meta.take(agr.length).map((x) => js(r[x['key']])).join(' · ');
      final mayor = vals.reduce((a, b) => _num(b[k]) > _num(a[k]) ? b : a);
      final menor = vals.reduce((a, b) => _num(b[k]) < _num(a[k]) ? b : a);
      out.add('${filas.length} grupos. Mayor ${(mm['label'] as String).toLowerCase()}: ${etiq(mayor)} (${fmtValor(mayor[k], mm['fmt'])}); menor: ${etiq(menor)} (${fmtValor(menor[k], mm['fmt'])}).');
    }
  }
  if (totales != null) {
    final por = {for (final mm in meta) mm['key'] as String: mm};
    out.add('Totales: ${totales.entries.map((e) => '${por[e.key]!['label']} ${fmtValor(e.value, por[e.key]!['fmt'])}').join('; ')}.');
  }
  if (totalFilas > filas.length) out.add('Mostrando ${filas.length} de $totalFilas resultados.');
  return out;
}

String _ahora() {
  String d2(int n) => n.toString().padLeft(2, '0');
  final d = DateTime.now();
  return '${d2(d.day)}/${d2(d.month)}/${d.year} ${d2(d.hour)}:${d2(d.minute)}';
}

double _suma(List<Fila> filas, String k) => filas.fold<double>(0, (s, r) => s + (_num(r[k]).isNaN ? 0 : _num(r[k])));

// ----------------------------- ejecución -----------------------------

/// Ejecuta una consulta sobre las tablas {dataset: {columnas, filas}}. Devuelve lo que pinta la pantalla.
Map<String, dynamic> ejecutar(Map spec, Map<String, dynamic> tablas) {
  final dataset = spec['dataset'] as String;
  if (!Catalogo.datasets.containsKey(dataset)) throw ConsultaInvalida('No sé qué datos consultar.');
  final ds = Catalogo.datasets[dataset] as Map<String, dynamic>;
  if (!tablas.containsKey(dataset)) {
    throw ConsultaInvalida('No tienes datos de ${(ds['etiqueta'] as String).toLowerCase()} en este teléfono (por tu rol o porque aún no se descargaron).');
  }
  var rows = aObjetos(tablas[dataset] as Map<String, dynamic>);
  if (spec['fecha'] != null) rows = rangoFecha(rows, spec['fecha'] as Map, dataset);
  final filtros = (spec['filtros'] as List?) ?? [];
  for (final fl in filtros) {
    if (fl['post'] != true) rows = aplicarFiltro(rows, fl as Map, dataset);
  }
  final nFiltrado = rows.length;

  var medidas = [...((spec['medidas'] as List?) ?? [])];
  final agr = (spec['agrupar'] as List?) ?? [];
  final notas = <String>[];
  Map sp = spec;
  if (agr.isNotEmpty && medidas.isEmpty) {
    final dm = ds['medida'] as List;
    medidas = dm.isNotEmpty
        ? [
            for (final p in dm) p[1] != null ? {'fn': p[0], 'col': p[1]} : {'fn': p[0]}
          ]
        : [
            {'fn': 'count'}
          ];
    sp = {...spec, 'medidas': medidas};
  }

  List<Fila> out;
  List<Map<String, dynamic>> meta;
  String modo;
  if (agr.isNotEmpty) {
    final r = _agrupar(rows, sp, dataset);
    out = r.out;
    meta = r.meta;
    modo = 'agrupado';
  } else if (medidas.isNotEmpty) {
    final r = _totalGeneral(rows, sp, dataset);
    out = r.out;
    meta = r.meta;
    modo = 'total';
  } else {
    final pedidas = (spec['columnas'] as List?) ?? (ds['defecto'] as List);
    final cols = pedidas.where((c) => Catalogo.columna(dataset, c as String) != null).toList();
    final usar = cols.isNotEmpty ? cols : ds['defecto'] as List;
    meta = [
      for (final c in usar)
        <String, dynamic>{
          'key': c,
          'label': Catalogo.columna(dataset, c as String)!['etiqueta'],
          'tipo': {'fecha': 'fecha', 'numero': 'numero'}[Catalogo.columna(dataset, c)!['tipo']] ?? 'texto',
          'fmt': Catalogo.columna(dataset, c)!['fmt'],
        }
    ];
    out = rows;
    modo = 'detalle';
  }

  if (modo != 'detalle') {
    for (final fl in filtros) {
      if (fl['post'] != true) continue;
      final k = resolverSalida(fl['col'] as String, sp, meta, dataset);
      if (k == null) continue;
      final x = _num(fl['valor']);
      out = out.where((r) {
        final v = r[k];
        if (v == null) return false;
        final n = _num(v);
        switch (fl['op']) {
          case '=':
            return n == x;
          case '!=':
            return n != x;
          case '>':
            return n > x;
          case '>=':
            return n >= x;
          case '<':
            return n < x;
          case '<=':
            return n <= x;
          case 'entre':
            return n >= _num(fl['valor'][0]) && n <= _num(fl['valor'][1]);
        }
        return false;
      }).toList();
    }
  }

  final claves = <Clave>[];
  for (final o in (spec['orden'] as List?) ?? []) {
    final oc = o['col'] as String;
    if (modo == 'detalle') {
      if (Catalogo.columna(dataset, oc) != null) {
        claves.add((leer: (r) => r[oc], asc: o['dir'] == 'asc'));
      } else {
        notas.add('No pude ordenar por «$oc».');
      }
      continue;
    }
    final k = resolverSalida(oc, sp, meta, dataset);
    if (k == null) {
      notas.add('No pude ordenar por «$oc» porque no está en el resultado.');
      continue;
    }
    final idx = modo == 'agrupado' ? meta.indexWhere((mm) => mm['key'] == k) : -1;
    final real = idx >= 0 && idx < agr.length ? '__k$idx' : k; // fechas: orden cronológico, no alfabético
    claves.add((leer: (r) => r[real], asc: o['dir'] == 'asc'));
  }
  if (claves.isNotEmpty) {
    out = ordenar(out, claves);
  } else if (modo == 'agrupado') {
    out = ordenar(out, [for (var i = 0; i < agr.length; i++) (leer: (Fila r) => r['__k$i'], asc: true)]);
  } else if (modo == 'detalle' && ds['fecha'] != null) {
    final fc = ds['fecha'] as String;
    out = ordenar(out, [(leer: (Fila r) => r[fc], asc: true)]);
  }

  final totalFilas = out.length;
  if (_truthy(spec['limite'])) out = out.take(_num(spec['limite']).toInt()).toList();
  final filas = [
    for (final r in out) <String, dynamic>{for (final mm in meta) mm['key'] as String: redondear(r[mm['key']])}
  ];

  Map<String, dynamic>? totales;
  if (modo == 'agrupado') {
    final t = <String, dynamic>{};
    final cols = meta.skip(agr.length).toList();
    for (var i = 0; i < cols.length; i++) {
      if (const ['sum', 'count'].contains(medidas[i]['fn'])) t[cols[i]['key'] as String] = redondear(_suma(filas, cols[i]['key'] as String));
    }
    totales = t.isNotEmpty ? t : null;
  } else if (modo == 'detalle') {
    final t = <String, dynamic>{};
    for (final mm in meta.where((x) => x['fmt'] == 'moneda')) {
      t[mm['key'] as String] = redondear(_suma(filas, mm['key'] as String));
    }
    totales = t.isNotEmpty ? t : null;
  }

  final graf = grafico(modo, meta, agr, filas, medidas);
  return {
    'titulo': _truthy(spec['titulo']) ? spec['titulo'] : tituloAuto(spec),
    'dataset': dataset,
    'datasetEtiqueta': ds['etiqueta'],
    'modo': modo,
    'columnas': meta,
    'filas': filas,
    'totales': totales,
    'grafico': graf,
    'resumen': resumenTexto(modo, dataset, nFiltrado, totalFilas, meta, filas, totales, agr),
    'condiciones': describir(spec),
    'notas': notas,
    'registrosAnalizados': nFiltrado,
    'totalFilas': totalFilas,
    'mostradas': filas.length,
    'generado': _ahora(),
  };
}
