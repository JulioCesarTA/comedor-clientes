// Motor de consultas: ejecuta, dentro del celular, la consulta estructurada que arma el lenguaje natural.
//
// Consulta:
//   dataset   reservas | pagos | estudiantes | becas | menus | insumos | desperdicio
//   columnas  columnas a mostrar (si no se agrupa)
//   fecha     { col?, desde, hasta, etiqueta }
//   filtros   [{ col, op, valor, post? }]   op: = != > >= < <= entre contiene en no_en dia_semana
//   agrupar   [{ col, por? }]               por (fechas): dia | semana | mes | trimestre | anio | dia_semana
//   medidas   [{ fn, col? }]                fn: count | sum | avg | max | min | nunique
//   orden     [{ col, dir }]                dir: asc | desc
//   limite    entero
const { DATASETS, columna, etiqueta } = require('./catalogo');
const F = require('./fechas');
const { normSimple } = require('./texto');

class ConsultaInvalida extends Error {}

const MESES3 = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const POR_ETIQUETA = { dia: 'Día', semana: 'Semana', mes: 'Mes', trimestre: 'Trimestre', anio: 'Año', dia_semana: 'Día de la semana' };
const FN_ETIQUETA = { sum: 'Total de', avg: 'Promedio de', max: 'Máximo de', min: 'Mínimo de', nunique: 'Distintos de' };
const FN_BASE = { sum: 'total', avg: 'promedio', max: 'maximo', min: 'minimo', nunique: 'distintos' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const redondear = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

// ----------------------------- tabla -----------------------------

function aObjetos(tabla) {
  return tabla.filas.map((f) => Object.fromEntries(tabla.columnas.map((c, i) => [c, f[i] === undefined ? null : f[i]])));
}

// ----------------------------- filtros -----------------------------

function aplicarFiltro(rows, f, dataset) {
  const cat = columna(dataset, f.col);
  if (!cat) throw new ConsultaInvalida(`La columna «${f.col}» no existe en ${DATASETS[dataset].etiqueta}`);
  const lista = Array.isArray(f.valor) ? f.valor : [f.valor];
  if (f.op === 'dia_semana') return rows.filter((r) => r[f.col] && lista.includes(F.diaSemana(F.desdeIso(r[f.col]))));
  let leer, vals;
  if (cat.tipo === 'fecha') { leer = (v) => (v ? String(v).slice(0, 10) : null); vals = lista.map((x) => String(x).slice(0, 10)); }
  else if (cat.tipo === 'numero') { leer = num; vals = lista.map(Number); }
  else { leer = (v) => (v === null || v === undefined ? null : normSimple(v)); vals = lista.map(normSimple); }
  const ok = (v) => {
    if (v === null || (typeof v === 'number' && Number.isNaN(v))) return false;
    switch (f.op) {
      case '=': return v === vals[0];
      case '!=': return v !== vals[0];
      case '>': return v > vals[0];
      case '>=': return v >= vals[0];
      case '<': return v < vals[0];
      case '<=': return v <= vals[0];
      case 'entre': return v >= Math.min(...vals) && v <= Math.max(...vals);
      case 'contiene': return String(v).includes(vals[0]);
      case 'en': return vals.includes(v);
      case 'no_en': return !vals.includes(v);
      default: throw new ConsultaInvalida(`Operador desconocido: ${f.op}`);
    }
  };
  // los distintos de (!=, no_en) conservan también los vacíos, como esperaría una persona
  const neg = f.op === '!=' || f.op === 'no_en';
  return rows.filter((r) => { const v = leer(r[f.col]); return v === null ? neg : ok(v); });
}

function rangoFecha(rows, f, dataset) {
  const c = f.col || DATASETS[dataset].fecha;
  if (!c) return rows;
  return rows.filter((r) => {
    const v = r[c] ? String(r[c]).slice(0, 10) : null;
    return v !== null && (!f.desde || v >= f.desde) && (!f.hasta || v <= f.hasta);
  });
}

// ----------------------------- agrupación -----------------------------

function claveFecha(v, por) {
  const d = F.desdeIso(v);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  switch (por) {
    case 'dia': return { k: F.iso(d), txt: F.dmy(d) };
    case 'semana': { const l = F.lunesDe(d); return { k: F.iso(l), txt: `Sem. ${F.dmy(l).slice(0, 5)}` }; }
    case 'mes': return { k: `${y}-${String(m).padStart(2, '0')}`, txt: `${MESES3[m - 1]} ${y}` };
    case 'trimestre': { const q = Math.ceil(m / 3); return { k: `${y}-T${q}`, txt: `T${q} ${y}` }; }
    case 'anio': return { k: String(y), txt: String(y) };
    case 'dia_semana': { const i = F.diaSemana(d); return { k: String(i), txt: cap(F.DIAS_N[i]) }; }
    default: throw new ConsultaInvalida(`No sé agrupar por «${por}»`);
  }
}

function medidaInfo(dataset, m) {
  if (m.fn === 'count') return { key: 'cantidad', label: 'Cantidad', fmt: 'entero' };
  const cat = columna(dataset, m.col);
  let fmt = m.fn === 'nunique' ? 'entero' : cat.fmt;
  if (m.fn === 'avg' && fmt === 'entero') fmt = 'decimal';
  return { key: `${FN_BASE[m.fn]}_${m.col}`, label: `${FN_ETIQUETA[m.fn]} ${cat.etiqueta.toLowerCase()}`, fmt };
}

function calcular(rows, m) {
  if (m.fn === 'count') return rows.length;
  if (m.fn === 'nunique') return new Set(rows.map((r) => r[m.col])).size;
  const v = rows.map((r) => num(r[m.col])).filter((x) => !Number.isNaN(x));
  if (!v.length) return null;
  if (m.fn === 'sum') return v.reduce((a, b) => a + b, 0);
  if (m.fn === 'avg') return v.reduce((a, b) => a + b, 0) / v.length;
  if (m.fn === 'max') return Math.max(...v);
  return Math.min(...v);
}

function agrupar(rows, spec, dataset) {
  const meta = [];
  const claves = spec.agrupar.map((g, i) => {
    const cat = columna(dataset, g.col);
    if (cat.tipo === 'fecha') {
      const por = g.por || 'mes';
      meta.push({ key: por, label: POR_ETIQUETA[por], tipo: 'texto', fmt: null });
      return { por, leer: (r) => (r[g.col] ? claveFecha(r[g.col], por) : null), nombre: por };
    }
    meta.push({ key: g.col, label: cat.etiqueta, tipo: 'texto', fmt: null });
    return { leer: (r) => { const v = r[g.col] === null || r[g.col] === undefined ? '(sin dato)' : String(r[g.col]); return { k: v, txt: v }; }, nombre: g.col };
  });
  const grupos = new Map();
  for (const r of rows) {
    const ks = claves.map((c) => c.leer(r));
    if (ks.some((k) => k === null)) continue;
    const id = ks.map((k) => k.k).join('\u0001');
    if (!grupos.has(id)) grupos.set(id, { ks, rows: [] });
    grupos.get(id).rows.push(r);
  }
  const infos = spec.medidas.map((m) => medidaInfo(dataset, m));
  const out = [];
  for (const g of grupos.values()) {
    const fila = {};
    claves.forEach((c, i) => { fila[c.nombre] = g.ks[i].txt; fila[`__k${i}`] = g.ks[i].k; });
    spec.medidas.forEach((m, i) => { fila[infos[i].key] = calcular(g.rows, m); });
    out.push(fila);
  }
  infos.forEach((i) => meta.push({ key: i.key, label: i.label, tipo: 'numero', fmt: i.fmt }));
  return { out, meta };
}

function totalGeneral(rows, spec, dataset) {
  const fila = { concepto: 'Total general' };
  const meta = [{ key: 'concepto', label: 'Concepto', tipo: 'texto', fmt: null }];
  for (const m of spec.medidas) {
    const i = medidaInfo(dataset, m);
    fila[i.key] = rows.length || m.fn === 'count' ? calcular(rows, m) : 0;
    meta.push({ key: i.key, label: i.label, tipo: 'numero', fmt: i.fmt });
  }
  return { out: [fila], meta };
}

// ----------------------------- orden y salida -----------------------------

function comparar(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || (typeof a === 'number' && Number.isNaN(a))) return 1;     // vacíos al final
  if (b === null || b === undefined || (typeof b === 'number' && Number.isNaN(b))) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function ordenar(rows, claves) {            // claves: [{ leer, asc }]; estable
  return rows.map((r, i) => [r, i]).sort((x, y) => {
    for (const c of claves) {
      const v = comparar(c.leer(x[0]), c.leer(y[0]));
      const sinVacios = c.leer(x[0]) === null || c.leer(y[0]) === null;
      if (v !== 0) return c.asc || sinVacios ? v : -v;
    }
    return x[1] - y[1];
  }).map((p) => p[0]);
}

function resolverSalida(col, spec, meta, dataset) {
  const claves = meta.map((m) => m.key);
  if (claves.includes(col)) return col;
  for (const med of spec.medidas || []) if (med.col === col) return medidaInfo(dataset, med).key;
  for (const g of spec.agrupar || []) if (g.col === col && claves.includes(g.por || 'mes')) return g.por || 'mes';
  if (col === 'cantidad' || col === 'count') return claves.includes('cantidad') ? 'cantidad' : null;
  return null;
}

const SIMB = { '=': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤' };

function describir(spec) {
  const out = [];
  if (spec.fecha) out.push('Período: ' + (spec.fecha.etiqueta || `${spec.fecha.desde} a ${spec.fecha.hasta}`));
  for (const f of spec.filtros || []) {
    const et = etiqueta(spec.dataset, f.col);
    const v = f.valor;
    if (f.op === 'entre') out.push(`${et} entre ${v[0]} y ${v[1]}`);
    else if (f.op === 'dia_semana') out.push('Solo ' + v.map((d) => F.DIAS_N[d]).join(', '));
    else if (f.op === 'en' || f.op === 'no_en') out.push(`${et} ${f.op === 'en' ? 'es' : 'no es'} ` + v.join(' o '));
    else if (f.op === 'contiene') out.push(`${et} contiene «${v}»`);
    else out.push(`${et} ${SIMB[f.op] || f.op} ${v}`);
  }
  for (const g of spec.agrupar || []) out.push('Agrupado por ' + (g.por ? POR_ETIQUETA[g.por].toLowerCase() : etiqueta(spec.dataset, g.col).toLowerCase()));
  for (const o of spec.orden || []) {
    const med = (spec.medidas || []).find((m) => medidaInfo(spec.dataset, m).key === o.col);
    const nombre = med ? medidaInfo(spec.dataset, med).label.toLowerCase() : etiqueta(spec.dataset, o.col).toLowerCase();
    out.push(`Orden: ${nombre} ${o.dir === 'desc' ? 'de mayor a menor' : 'de menor a mayor'}`);
  }
  if (spec.limite) out.push(`Primeros ${spec.limite} resultados`);
  return out;
}

function tituloAuto(spec) {
  const ds = DATASETS[spec.dataset];
  let base = ds.etiqueta;
  if (spec.medidas && spec.medidas.length && !(spec.agrupar && spec.agrupar.length)) base = `Resumen de ${ds.etiqueta.toLowerCase()}`;
  else if (spec.agrupar && spec.agrupar.length) {
    const g = spec.agrupar[0];
    base = `${ds.etiqueta} por ${g.por ? POR_ETIQUETA[g.por].toLowerCase() : etiqueta(spec.dataset, g.col).toLowerCase()}`;
  }
  if (spec.fecha && spec.fecha.etiqueta) base += ` · ${spec.fecha.etiqueta}`;
  return base;
}

function fmtValor(v, fmt) {
  if (v === null || v === undefined) return '—';
  const n = (x, d) => x.toLocaleString('es-BO', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (fmt === 'moneda') return `Bs ${n(v, 2)}`;
  if (fmt === 'porcentaje') return `${n(v, 1)}%`;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('es-BO') : n(v, 2);
  return String(v);
}

function grafico(modo, meta, agr, filas, medidas) {
  if (modo !== 'agrupado' || !filas.length) return null;
  const ncl = agr.length;
  let x = meta[0].key;
  const ys = meta.slice(ncl, ncl + 2).map((m) => m.key);
  const temporal = ncl === 1 && ['dia', 'semana', 'mes', 'trimestre', 'anio'].includes(agr[0].por);
  let tipo;
  if (temporal) tipo = filas.length > 2 ? 'lineas' : 'barras';
  else if (ncl === 1 && filas.length <= 6 && ys.length === 1 && medidas.length && ['sum', 'count'].includes(medidas[0].fn)) tipo = 'torta';
  else tipo = 'barras';
  if (ncl > 1) {
    x = '__etiqueta';
    filas.forEach((f) => { f[x] = meta.slice(0, ncl).map((m) => f[m.key]).join(' · '); });
  }
  return { tipo, x, y: ys, etiquetas: Object.fromEntries(meta.slice(ncl, ncl + 2).map((m) => [m.key, m.label])) };
}

function resumenTexto(modo, dataset, nFiltrado, totalFilas, meta, filas, totales, agr) {
  const ds = DATASETS[dataset].etiqueta.toLowerCase();
  if (nFiltrado === 0) return ['No hay datos que cumplan estas condiciones.'];
  const out = [`Se analizaron ${nFiltrado.toLocaleString('es-BO')} registros de ${ds}.`];
  if (modo === 'agrupado' && filas.length) {
    const m = meta[agr.length];
    const vals = filas.filter((r) => r[m.key] !== null && r[m.key] !== undefined);
    if (vals.length) {
      const etiq = (r) => meta.slice(0, agr.length).map((x) => r[x.key]).join(' · ');
      const mayor = vals.reduce((a, b) => (b[m.key] > a[m.key] ? b : a));
      const menor = vals.reduce((a, b) => (b[m.key] < a[m.key] ? b : a));
      out.push(`${filas.length} grupos. Mayor ${m.label.toLowerCase()}: ${etiq(mayor)} (${fmtValor(mayor[m.key], m.fmt)}); menor: ${etiq(menor)} (${fmtValor(menor[m.key], m.fmt)}).`);
    }
  }
  if (totales) {
    const por = Object.fromEntries(meta.map((m) => [m.key, m]));
    out.push('Totales: ' + Object.entries(totales).map(([k, v]) => `${por[k].label} ${fmtValor(v, por[k].fmt)}`).join('; ') + '.');
  }
  if (totalFilas > filas.length) out.push(`Mostrando ${filas.length} de ${totalFilas} resultados.`);
  return out;
}

const dos = (n) => String(n).padStart(2, '0');
const ahora = () => { const d = new Date(); return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`; };

// ----------------------------- ejecución -----------------------------

function ejecutar(spec, tablas) {
  const dataset = spec.dataset;
  if (!DATASETS[dataset]) throw new ConsultaInvalida('No sé qué datos consultar.');
  if (!tablas || !tablas[dataset]) throw new ConsultaInvalida(`No tienes datos de ${DATASETS[dataset].etiqueta.toLowerCase()} en este teléfono (por tu rol o porque aún no se descargaron).`);
  const ds = DATASETS[dataset];
  let rows = aObjetos(tablas[dataset]);
  if (spec.fecha) rows = rangoFecha(rows, spec.fecha, dataset);
  for (const f of spec.filtros || []) if (!f.post) rows = aplicarFiltro(rows, f, dataset);
  const nFiltrado = rows.length;

  let medidas = [...(spec.medidas || [])];
  const agr = spec.agrupar || [];
  const notas = [];
  let sp = spec;
  if (agr.length && !medidas.length) {
    medidas = ds.medida.length ? ds.medida.map(([fn, col]) => (col ? { fn, col } : { fn })) : [{ fn: 'count' }];
    sp = { ...spec, medidas };
  }

  let out, meta, modo;
  if (agr.length) { ({ out, meta } = agrupar(rows, sp, dataset)); modo = 'agrupado'; }
  else if (medidas.length) { ({ out, meta } = totalGeneral(rows, sp, dataset)); modo = 'total'; }
  else {
    const cols = (spec.columnas || ds.defecto).filter((c) => columna(dataset, c));
    const usar = cols.length ? cols : ds.defecto;
    meta = usar.map((c) => { const cat = columna(dataset, c); return { key: c, label: cat.etiqueta, tipo: { fecha: 'fecha', numero: 'numero' }[cat.tipo] || 'texto', fmt: cat.fmt }; });
    out = rows;
    modo = 'detalle';
  }

  if (modo !== 'detalle') {
    for (const f of spec.filtros || []) {
      if (!f.post) continue;
      const k = resolverSalida(f.col, sp, meta, dataset);
      if (!k) continue;
      const x = Number(f.valor);
      out = out.filter((r) => {
        const v = r[k];
        if (v === null || v === undefined) return false;
        return { '=': v === x, '!=': v !== x, '>': v > x, '>=': v >= x, '<': v < x, '<=': v <= x, entre: v >= Number(f.valor[0]) && v <= Number(f.valor[1]) }[f.op];
      });
    }
  }

  const claves = [];
  for (const o of spec.orden || []) {
    if (modo === 'detalle') {
      if (columna(dataset, o.col)) claves.push({ leer: (r) => (r[o.col] === undefined ? null : r[o.col]), asc: o.dir === 'asc' });
      else notas.push(`No pude ordenar por «${o.col}».`);
      continue;
    }
    const k = resolverSalida(o.col, sp, meta, dataset);
    if (!k) { notas.push(`No pude ordenar por «${o.col}» porque no está en el resultado.`); continue; }
    const idx = modo === 'agrupado' ? meta.findIndex((m) => m.key === k) : -1;
    const real = idx >= 0 && idx < agr.length ? `__k${idx}` : k;           // fechas: orden cronológico, no alfabético
    claves.push({ leer: (r) => (r[real] === undefined ? null : r[real]), asc: o.dir === 'asc' });
  }
  if (claves.length) out = ordenar(out, claves);
  else if (modo === 'agrupado') out = ordenar(out, agr.map((_, i) => ({ leer: (r) => r[`__k${i}`], asc: true })));
  else if (modo === 'detalle' && ds.fecha) out = ordenar(out, [{ leer: (r) => r[ds.fecha], asc: true }]);

  const totalFilas = out.length;
  if (spec.limite) out = out.slice(0, Number(spec.limite));
  const filas = out.map((r) => Object.fromEntries(meta.map((m) => [m.key, redondear(r[m.key] === undefined ? null : r[m.key])])));

  let totales = null;
  if (modo === 'agrupado') {
    const t = {};
    meta.slice(agr.length).forEach((m, i) => { if (['sum', 'count'].includes(medidas[i].fn)) t[m.key] = redondear(filas.reduce((s, r) => s + (Number(r[m.key]) || 0), 0)); });
    totales = Object.keys(t).length ? t : null;
  } else if (modo === 'detalle') {
    const t = {};
    meta.filter((m) => m.fmt === 'moneda').forEach((m) => { t[m.key] = redondear(filas.reduce((s, r) => s + (Number(r[m.key]) || 0), 0)); });
    totales = Object.keys(t).length ? t : null;
  }

  const graf = grafico(modo, meta, agr, filas, medidas);
  return {
    titulo: spec.titulo || tituloAuto(spec), dataset, datasetEtiqueta: ds.etiqueta, modo, columnas: meta, filas, totales, grafico: graf,
    resumen: resumenTexto(modo, dataset, nFiltrado, totalFilas, meta, filas, totales, agr), condiciones: describir(spec), notas,
    registrosAnalizados: nFiltrado, totalFilas, mostradas: filas.length, generado: ahora(),
  };
}

module.exports = { ejecutar, describir, tituloAuto, medidaInfo, fmtValor, ConsultaInvalida, POR_ETIQUETA, aObjetos };
