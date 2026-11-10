// COPIA de mobile/app-movil/src/reportes/lenguaje.js (el motor de reportes es el mismo en la app móvil y en el BI web: si cambias uno, cambia el otro).
// Lenguaje natural (español) -> consulta estructurada. Todo local en el teléfono: sin internet y sin servicios externos.
//
// Entiende: qué datos (reservas, pagos, estudiantes, becas, menús, insumos, desperdicio), qué columnas ver, filtros
// ("mayores a 5", "turno almuerzo", "sin beca"), fechas ("noviembre", "del 1 al 15 de octubre", "últimos 30 días", "2025",
// "primer trimestre"), agrupaciones ("por mes", "por turno"), medidas ("total", "promedio", "cuántos"), rankings
// ("los 10 mayores", "los 5 más pedidos"), orden ("ascendente", "de mayor a menor") y la salida ("en pantalla", "PDF",
// "Excel"). También sigue la conversación ("ahora por mes", "solo de almuerzo") y corrige errores de tipeo.
const { DATASETS, columna, versionCatalogo } = require('./catalogo');
const F = require('./fechas');
const M = require('./motor');
const { quitarAcentos, escapar } = require('./texto');

class NoEntendido extends Error {}

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, sept: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const MES_ALT = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');
const NUMEROS = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, ciento: 100 };
const DIAS = { lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6 };
const TIEMPO = { dia: 'dia', dias: 'dia', diario: 'dia', diaria: 'dia', diariamente: 'dia', semana: 'semana', semanas: 'semana', semanal: 'semana', semanalmente: 'semana',
  mes: 'mes', meses: 'mes', mensual: 'mes', mensualmente: 'mes', trimestre: 'trimestre', trimestres: 'trimestre', trimestral: 'trimestre', anio: 'anio', anios: 'anio',
  ano: 'anio', anos: 'anio', anual: 'anio', anualmente: 'anio', 'dia de la semana': 'dia_semana', 'dias de la semana': 'dia_semana' };
const COL_NUM = { pagos: 'monto', estudiantes: 'reservas', becas: 'uso', menus: 'apartadas', insumos: 'stock', desperdicio: 'restante', reservas: null };
const FORMATOS = [['pdf', /\bpdf\b/], ['excel', /\b(excel|xlsx|xls|hoja de calculo|planilla|spreadsheet)\b/], ['pantalla', /\b(en pantalla|por pantalla|en la pantalla|aqui)\b/]];
const SIN_PALABRA = { media: 'beca' };
// «los que vinieron / comieron / asistieron al comedor»: raciones servidas (reservas consumidas), no la asistencia del personal
const VINIERON = /\b(vinieron|vino al comedor|asistieron|asistio al comedor|comieron|almorzaron|cenaron|desayunaron|entraron al comedor|fueron al comedor|pasaron por el comedor|se sirvieron|retiraron (?:su|sus) racion(?:es)?)\b/;
const DEL_PERSONAL = /\b(personal|empleados?|trabajadores?|cocineros?|marcas?|marcaron|marcacion\w*)\b/;
const DIA_REL = 'hoy|ayer|anteayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo';
const NUM_PALABRA = { un: 1, una: 1, uno: 1 };            // valores ambiguos: solo cuentan junto a esta palabra

// ----------------------------- texto -----------------------------

function norm(texto) {
  let t = quitarAcentos(String(texto).toLowerCase());
  t = t.replace(/[^a-z0-9/\-.,%$ ]/g, ' ');
  t = t.replace(/[.,]/g, (c, i, s) => (/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '') ? c : ' '));
  t = t.replace(/\s+/g, ' ').trim();
  return t.split(' ').map((w) => (NUMEROS[w] !== undefined ? String(NUMEROS[w]) : w)).join(' ');
}
const blank = (t, a, b) => t.slice(0, a) + ' '.repeat(b - a) + t.slice(b);
const spanDe = (m) => [m.index, m.index + m[0].length];
const splitCamel = (n) => n.replace(/([a-z])([A-Z])/g, '$1 $2');
const reFrase = (f) => new RegExp(`\\b${escapar(f)}(?:s|es)?\\b`);
const reFraseG = (f) => new RegExp(`\\b${escapar(f)}(?:s|es)?\\b`, 'g');

function frases(c) {
  const fs = new Set([norm(splitCamel(c.nombre)), norm(c.etiqueta.replace(/\(.*?\)/g, '')), ...c.sinonimos.map(norm)]);
  return [...fs].filter(Boolean).sort((a, b) => b.length - a.length);
}

// ----------------------------- corrección de tipeos -----------------------------

// Errores entre dos palabras; cambiar de lugar dos letras seguidas ("ocutbre") cuenta como UN error.
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

const PARECIDO_MINIMO = 0.85;   // una palabra de 7 letras con un error (0.857) ya se corrige

const construirVocab = () => {
  const v = new Set([...Object.keys(MESES), ...Object.keys(NUMEROS), ...Object.keys(TIEMPO), ...Object.keys(DIAS),
    'ascendente', 'descendente', 'promedio', 'mayores', 'menores', 'ordenado', 'ordenados', 'agrupado', 'desperdicio', 'cuantos', 'cuantas',
    'cantidad', 'reporte', 'mostrar', 'ultimos', 'ultimas', 'trimestre', 'semestre', 'bolivianos', 'estudiantes', 'reservas', 'raciones',
    'pagos', 'becas', 'menus', 'insumos', 'total', 'maximo', 'minimo', 'ayer',
    // valores que la gente escribe (estados, métodos, turnos, tipos): sin ellos "canseladas" no se corrige
    'cancelada', 'canceladas', 'confirmada', 'confirmadas', 'consumida', 'consumidas', 'pendiente', 'pendientes',
    'cobrado', 'cobrados', 'devuelto', 'devueltos', 'fallido', 'fallidos', 'efectivo', 'tarjeta',
    'almuerzo', 'desayuno', 'completa', 'parcial']);
  for (const ds of Object.values(DATASETS)) {
    ds.sinonimos.forEach((s) => norm(s).split(' ').forEach((w) => v.add(w)));
    ds.columnas.forEach((c) => frases(c).forEach((f) => f.split(' ').forEach((w) => v.add(w))));
  }
  return [...v].filter((w) => w.length >= 4).sort();
};
// El vocabulario depende del catálogo (que llega del servidor): se arma la primera vez y cada vez que el catálogo cambia.
let _vocab = null, _vocabVersion = -1;
const vocab = () => {
  if (_vocab === null || _vocabVersion !== versionCatalogo()) { _vocab = construirVocab(); _vocabVersion = versionCatalogo(); }
  return _vocab;
};

function corregirTipeos(t) {
  return t.split(' ').map((w) => {
    if (w.length < 6 || !/^[a-z]+$/.test(w) || vocab().includes(w)) return w;
    let mejor = null, mejorR = PARECIDO_MINIMO;
    for (const v of vocab()) {
      if (Math.abs(v.length - w.length) > 2) continue;
      let pre = 0;
      while (pre < Math.min(v.length, w.length) && v[pre] === w[pre]) pre++;
      if (pre >= Math.min(v.length, w.length) - 2) continue;      // solo cambia el final (reservados/reservadas): es otra palabra válida, no un error
      const r = 1 - distancia(w, v) / Math.max(w.length, v.length);
      if (r >= mejorR) { mejor = v; mejorR = r; }
    }
    return mejor || w;
  }).join(' ');
}

// ----------------------------- fechas -----------------------------

const numero = (s) => {
  s = s.replace(/ /g, '');
  return /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, '')) : Number(s.replace(',', '.'));
};
const rango = (desde, hasta, etiqueta) => ({ desde: desde ? F.iso(desde) : null, hasta: hasta ? F.iso(hasta) : null, etiqueta });
const anioDe = (mes, anio, hoy) => (anio || (F.fecha(hoy.getUTCFullYear(), mes, 1) <= hoy ? hoy.getUTCFullYear() : hoy.getUTCFullYear() - 1));
const mesRango = (y, m) => [F.fecha(y, m, 1), F.finMes(y, m)];
const todos = (re, t) => [...t.matchAll(new RegExp(re.source, 'g'))];

function fechaTexto(d, m, y, hoy) {
  const mes = MESES[m];
  const anio = anioDe(mes, y ? Number(y) : null, hoy);               // sin año: el del mes más reciente que ya empezó
  return F.fecha(anio, mes, Math.min(Number(d), F.diasEnMes(anio, mes)));
}

/** hoy, ayer, anteayer o el último lunes/martes/... que ya pasó (o hoy) */
function diaRelativo(w, hoy) {
  if (w === 'hoy' || w === 'la fecha' || w === 'ahora') return hoy;
  if (w === 'ayer') return F.sumarDias(hoy, -1);
  if (w === 'anteayer') return F.sumarDias(hoy, -2);
  const d = F.sumarDias(F.lunesDe(hoy), DIAS[w]);
  return d > hoy ? F.sumarDias(d, -7) : d;
}

function ultimos(n, unidad, hoy) {
  const dias = n * (unidad.startsWith('dia') ? 1 : unidad.startsWith('semana') ? 7 : unidad.startsWith('mes') ? 30 : 365);
  return rango(F.sumarDias(hoy, dias > 1 ? -(dias - 1) : 0), hoy, `los últimos ${n} ${n !== 1 ? unidad : unidad.replace(/s$/, '')}`);
}
function proximos(n, unidad, hoy) {
  const dias = n * (unidad.startsWith('dia') ? 1 : unidad.startsWith('semana') ? 7 : 30);
  return rango(hoy, F.sumarDias(hoy, dias), `los próximos ${n} ${unidad}`);
}

function parseFechas(t, hoy) {
  // «semana del 2 de noviembre»: esa semana, de lunes a domingo
  let m = new RegExp(`\\bsemana del? (\\d{1,2}) (?:de )?(${MES_ALT})(?: (?:de|del) (\\d{4}))?\\b`).exec(t);
  if (m) {
    const a = F.lunesDe(fechaTexto(m[1], m[2], m[3], hoy)), b = F.sumarDias(a, 6);
    return [rango(a, b, `la semana del ${F.dmy(a)} al ${F.dmy(b)}`), blank(t, ...spanDe(m))];
  }
  // «de anteayer a hoy», «desde el lunes hasta hoy», «entre ayer y hoy»
  m = new RegExp(`\\b(?:desde|entre|de|del)(?: el)? (${DIA_REL}) (?:a|al|hasta|y)(?: el)? (${DIA_REL}|la fecha|ahora)\\b`).exec(t);
  if (m) {
    let a = diaRelativo(m[1], hoy), b = diaRelativo(m[2], hoy);
    if (a > b) [a, b] = [b, a];
    return [rango(a, b, `del ${F.dmy(a)} al ${F.dmy(b)}`), blank(t, ...spanDe(m))];
  }
  // «desde ayer», «desde el lunes»: hasta hoy
  m = new RegExp(`\\b(?:desde|a partir de)(?: el)? (${DIA_REL})\\b`).exec(t);
  if (m) { const a = diaRelativo(m[1], hoy); return [rango(a, hoy, `desde el ${F.dmy(a)}`), blank(t, ...spanDe(m))]; }
  // «hace 3 días» (ese día) · «desde hace 2 semanas», «hace un mes» (desde entonces hasta hoy)
  m = /\b(desde )?hace (\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta) (dias?|semanas?|mes|meses)\b/.exec(t);
  if (m) {
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : (NUM_PALABRA[m[2]] || NUMEROS[m[2]]);
    const dias = n * (m[3].startsWith('dia') ? 1 : m[3].startsWith('semana') ? 7 : 30);
    const a = F.sumarDias(hoy, -dias);
    const r = m[1] || !m[3].startsWith('dia') ? rango(a, hoy, `desde el ${F.dmy(a)}`) : rango(a, a, `el ${F.dmy(a)}`);
    return [r, blank(t, ...spanDe(m))];
  }
  m = new RegExp(`\\b(?:del?|entre)(?: el)? (\\d{1,2}) (?:al?|y)(?: el)? (\\d{1,2}) (?:de )?(${MES_ALT})(?: (?:de|del) (\\d{4}))?\\b`).exec(t);
  if (m) {
    let a = fechaTexto(m[1], m[3], m[4], hoy), b = fechaTexto(m[2], m[3], m[4], hoy);
    if (a > b) [a, b] = [b, a];
    return [rango(a, b, `del ${F.dmy(a)} al ${F.dmy(b)}`), blank(t, ...spanDe(m))];
  }
  // fechas explícitas
  const cand = [];
  for (const x of todos(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, t)) { const d = F.fecha(+x[1], +x[2], +x[3]); if (!Number.isNaN(d.getTime())) cand.push([...spanDe(x), d]); }
  for (const x of todos(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/, t)) { const y = +x[3] + (x[3].length === 2 ? 2000 : 0); cand.push([...spanDe(x), F.fecha(y, +x[2], +x[1])]); }
  for (const x of todos(new RegExp(`\\b(\\d{1,2}) (?:de )?(${MES_ALT})(?: (?:de|del) (\\d{4}))?\\b`), t)) cand.push([...spanDe(x), fechaTexto(x[1], x[2], x[3], hoy)]);
  if (cand.length) {
    cand.sort((p, q) => p[0] - q[0]);
    let restos = t;
    cand.forEach(([a, b]) => { restos = blank(restos, a, b); });
    const ds = cand.map((c) => c[2]);
    if (ds.length >= 2) {
      const a = new Date(Math.min(...ds)), b = new Date(Math.max(...ds));
      return [rango(a, b, `del ${F.dmy(a)} al ${F.dmy(b)}`), restos];
    }
    // «del 1 de noviembre a la fecha», «desde el 5/10 hasta hoy»
    const tras = /^\s*(?:a|al|hasta)(?: el dia de)? (?:la fecha|hoy|ahora)\b/.exec(t.slice(cand[0][1]));
    if (tras) return [rango(ds[0], hoy, `desde el ${F.dmy(ds[0])}`), blank(restos, cand[0][1], cand[0][1] + tras[0].length)];
    const antes = t.slice(Math.max(0, cand[0][0] - 22), cand[0][0]);
    if (/(desde|a partir de|despues de)(?: el)? $/.test(antes)) return [rango(ds[0], hoy, `desde el ${F.dmy(ds[0])}`), restos];
    if (/(hasta|antes de)(?: el)? $/.test(antes)) return [rango(null, ds[0], `hasta el ${F.dmy(ds[0])}`), restos];
    return [rango(ds[0], ds[0], `el ${F.dmy(ds[0])}`), restos];
  }
  // relativas
  const lunes = F.lunesDe(hoy);
  const mp = hoy.getUTCMonth() === 0 ? [hoy.getUTCFullYear() - 1, 12] : [hoy.getUTCFullYear(), hoy.getUTCMonth()];
  const reglas = [
    [/\bhoy\b/, () => rango(hoy, hoy, `hoy (${F.dmy(hoy)})`)],
    [/\banteayer\b/, () => rango(F.sumarDias(hoy, -2), F.sumarDias(hoy, -2), 'anteayer')],
    [/\bayer\b/, () => rango(F.sumarDias(hoy, -1), F.sumarDias(hoy, -1), `ayer (${F.dmy(F.sumarDias(hoy, -1))})`)],
    [/\b(?:semana pasada|semana anterior)\b/, () => rango(F.sumarDias(lunes, -7), F.sumarDias(lunes, -1), 'la semana pasada')],
    [/\b(?:esta semana|semana actual|en lo que va de la semana)\b/, () => rango(lunes, hoy, 'esta semana')],
    [/\b(?:de la semana|la semana)\b/, () => (/dias? de la semana/.test(t) ? null : rango(lunes, hoy, 'esta semana'))],
    [/\b(?:mes pasado|mes anterior)\b/, () => rango(...mesRango(...mp), `el mes pasado (${F.MESES_N[mp[1] - 1]})`)],
    [/\b(?:este mes|mes actual|en lo que va del mes)\b/, () => rango(F.fecha(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 1), hoy, `este mes (${F.MESES_N[hoy.getUTCMonth()]})`)],
    [/\b(?:anio pasado|ano pasado|anio anterior|ano anterior)\b/, () => rango(F.fecha(hoy.getUTCFullYear() - 1, 1, 1), F.fecha(hoy.getUTCFullYear() - 1, 12, 31), `el año ${hoy.getUTCFullYear() - 1}`)],
    [/\b(?:este anio|este ano|anio actual|ano actual|en lo que va del anio|en lo que va del ano)\b/, () => rango(F.fecha(hoy.getUTCFullYear(), 1, 1), hoy, `este año (${hoy.getUTCFullYear()})`)],
    [/\bultim[oa]s? (\d+) (dias?|semanas?|meses|mes|anios?|anos?)\b/, (x) => ultimos(+x[1], x[2], hoy)],
    [/\bultima semana\b/, () => ultimos(7, 'dias', hoy)],
    [/\bultimo mes\b/, () => ultimos(30, 'dias', hoy)],
    [/\b(?:ultimo anio|ultimo ano)\b/, () => ultimos(365, 'dias', hoy)],
    [/\bproxim[oa]s? (\d+) (dias?|semanas?|meses|mes)\b/, (x) => proximos(+x[1], x[2], hoy)],
    [/\bproxima semana\b/, () => proximos(7, 'dias', hoy)],
    [/\bproximo mes\b/, () => proximos(30, 'dias', hoy)],
  ];
  for (const [re, f] of reglas) {
    const x = re.exec(t);
    const r = x ? f(x) : null;
    if (r) return [r, blank(t, ...spanDe(x))];
  }
  m = /\b(primer|1er|segundo|2do|tercer|3er|cuarto|4to|ultimo) (trimestre|semestre)(?: (?:de|del) (\d{4}))?\b/.exec(t);
  if (m) {
    let n = { primer: 1, '1er': 1, segundo: 2, '2do': 2, tercer: 3, '3er': 3, cuarto: 4, '4to': 4, ultimo: 4 }[m[1]];
    const y = m[3] ? +m[3] : hoy.getUTCFullYear();
    let a, b;
    if (m[2] === 'trimestre') { a = F.fecha(y, 3 * n - 2, 1); b = F.finMes(y, 3 * n); }
    else { n = Math.min(n, 2); a = F.fecha(y, 6 * n - 5, 1); b = F.finMes(y, 6 * n); }
    return [rango(a, b, `${m[1]} ${m[2]} de ${y}`), blank(t, ...spanDe(m))];
  }
  m = /\b(?:este trimestre|trimestre actual)\b/.exec(t);
  if (m) { const q = Math.floor(hoy.getUTCMonth() / 3); return [rango(F.fecha(hoy.getUTCFullYear(), 3 * q + 1, 1), hoy, 'este trimestre'), blank(t, ...spanDe(m))]; }
  // meses
  const ms = todos(new RegExp(`\\b(${MES_ALT})\\b(?: (?:de|del) (\\d{4})| (\\d{4})\\b)?`), t);
  if (ms.length) {
    const rs = [];
    let restos = t;
    for (const x of ms) {
      const mes = MESES[x[1]];
      rs.push(mesRango(anioDe(mes, +(x[2] || x[3] || 0) || null, hoy), mes));
      restos = blank(restos, ...spanDe(x));
    }
    const a = new Date(Math.min(...rs.map((r) => r[0]))), b = new Date(Math.max(...rs.map((r) => r[1])));
    const et = a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
      ? `${F.MESES_N[a.getUTCMonth()]} de ${a.getUTCFullYear()}`
      : `${F.MESES_N[a.getUTCMonth()]} ${a.getUTCFullYear()} a ${F.MESES_N[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
    return [rango(a, b, et), restos];
  }
  // años
  const anios = [];
  for (const x of todos(/\b(20\d{2})\b/, t)) {
    const antes = t.slice(Math.max(0, x.index - 16), x.index);
    if (/(anios?|anos?|en|del|de|durante|desde|hasta|entre|y|al|a)\s+(el\s+)?(anio\s+|ano\s+)?$/.test(antes)) anios.push([...spanDe(x), +x[1]]);
  }
  if (anios.length) {
    let restos = t;
    anios.forEach(([a, b]) => { restos = blank(restos, a, b); });
    const ys = anios.map((a) => a[2]);
    const antes = t.slice(Math.max(0, anios[0][0] - 16), anios[0][0]);
    if (ys.length >= 2) return [rango(F.fecha(Math.min(...ys), 1, 1), F.fecha(Math.max(...ys), 12, 31), `${Math.min(...ys)} a ${Math.max(...ys)}`), restos];
    if (/desde(?: el)?(?: anio| ano)? $/.test(antes)) return [rango(F.fecha(ys[0], 1, 1), hoy, `desde ${ys[0]}`), restos];
    if (/hasta(?: el)?(?: anio| ano)? $/.test(antes)) return [rango(null, F.fecha(ys[0], 12, 31), `hasta ${ys[0]}`), restos];
    return [rango(F.fecha(ys[0], 1, 1), F.fecha(ys[0], 12, 31), `el año ${ys[0]}`), restos];
  }
  return [null, t];
}

// ----------------------------- columnas y valores -----------------------------

function menciones(t, dsId, tipos) {
  const pares = [];
  for (const c of DATASETS[dsId].columnas) {
    if (tipos && !tipos.includes(c.tipo)) continue;
    frases(c).forEach((f) => pares.push([f, c.nombre]));
  }
  pares.sort((a, b) => b[0].length - a[0].length);
  let work = t;
  const out = [];
  for (const [f, nombre] of pares) {
    const re = reFraseG(f);
    let m;
    while ((m = re.exec(work))) {
      out.push([m.index, m.index + m[0].length, nombre]);
      work = blank(work, m.index, m.index + m[0].length);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function colPorRaiz(dsId, palabra) {
  const sin = palabra.replace(/(es|s)$/, '');
  const raiz = sin.length >= 5 ? sin.slice(0, 5) : sin;
  if (raiz.length < 4) return null;
  for (const c of DATASETS[dsId].columnas) {
    if (frases(c).some((f) => f.startsWith(raiz) || f.split(' ').some((w) => w.startsWith(raiz)))) return c.nombre;
  }
  return null;
}

const numCols = (dsId) => DATASETS[dsId].columnas.filter((c) => c.tipo === 'numero').map((c) => c.nombre);
const cercana = (pos, ments, validas) => {
  const c = ments.filter((m) => validas.includes(m[2])).map((m) => [Math.abs(m[0] - pos), m[2]]).sort((a, b) => a[0] - b[0]);
  return c.length ? c[0][1] : null;
};
const reValor = (v) => (/[oa]$/.test(v) && v.length > 3 ? new RegExp(`\\b${escapar(v.slice(0, -1))}(?:o|a|os|as)\\b`) : new RegExp(`\\b${escapar(v)}(?:s|es)?\\b`));
const tieneToken = (t, tk) => new RegExp(`\\b${escapar(tk)}\\b`).test(t);

/** Filtros por valores que existen en los datos: "almuerzo", "cobrado", "beca completa", nombres de estudiantes. */
function valores(t, dsId, rows, modo = 'resto') {
  const filtros = [], spans = [];
  if (!rows) return { filtros, spans };
  for (const c of DATASETS[dsId].columnas) {
    if (c.tipo !== 'categoria' && c.tipo !== 'texto') continue;
    const esNombre = c.tipo === 'texto' && c.nombre !== 'insumo';
    if ((modo === 'nombres') !== esNombre) continue;
    const unicos = [...new Set(rows.map((r) => r[c.nombre]).filter((v) => v !== null && v !== undefined).map(String))];
    if (!unicos.length || unicos.length > 600) continue;
    const hallados = [];
    const todosTokens = unicos.map((v) => norm(v).split(' ').filter((x) => x.length >= 3));
    unicos.forEach((v, idx) => {
      const nv = norm(v);
      if (c.tipo === 'texto' && c.nombre !== 'insumo') {              // nombres de personas
        const toks = todosTokens[idx];
        const marcar = (tks) => tks.forEach((tk) => { for (const x of t.matchAll(new RegExp('\\b' + escapar(tk) + '\\b', 'g'))) spans.push([x.index, x.index + tk.length]); });
        if (toks.length >= 2) {
          const usados = toks.filter((tk) => tieneToken(t, tk));
          if (usados.length >= 2) { hallados.push([t.indexOf(toks[0]), v, false]); marcar(usados); }
        } else if (toks.length === 1 && toks[0].length >= 4 && !vocab().includes(toks[0]) && tieneToken(t, toks[0])) { hallados.push([t.indexOf(toks[0]), v, false]); marcar(toks); }
        return;
      }
      const variantes = new Set([nv]);
      // "QR / tarjeta": también vale "qr" o "tarjeta" sola
      if (nv.includes('/')) nv.split('/').map((x) => x.trim()).filter((x) => x.length >= 2).forEach((x) => variantes.add(x));
      for (const va of variantes) {
        if (va.length < (va === nv ? 3 : 2) || (SIN_PALABRA[va] && !t.includes(SIN_PALABRA[va]))) continue;
        const m = reValor(va).exec(t);
        if (m) {
          const antes = t.slice(Math.max(0, m.index - 14), m.index);
          hallados.push([m.index, v, /\b(sin|excepto|salvo|menos|no|excluyendo)\s+(?:los |las |el |la )?$/.test(antes)]);
          break;
        }
      }
    });
    // un apellido o nombre que identifica a una sola persona vale; si varias comparten el token, solo cuenta el nombre completo
    const pos = hallados.filter((h) => !h[2]).map((h) => h[1]);
    const neg = hallados.filter((h) => h[2]).map((h) => h[1]);
    if (pos.length) filtros.push({ col: c.nombre, op: pos.length === 1 ? '=' : 'en', valor: pos.length === 1 ? pos[0] : pos });
    if (neg.length) filtros.push({ col: c.nombre, op: neg.length === 1 ? '!=' : 'no_en', valor: neg.length === 1 ? neg[0] : neg });
  }
  return { filtros, spans };
}

/** Expresiones del negocio que equivalen a filtros: "stock bajo", "sin beca", "por vencer", "inactivos"... */
function frasesEspeciales(t, dsId) {
  const filtros = [], orden = [];
  if (dsId === 'insumos') {
    if (/\b(stock bajo|bajo stock|agotad\w+|por reponer|escasos?|faltan?|faltantes)\b/.test(t)) filtros.push({ col: 'estado', op: '=', valor: 'Bajo' });
    if (/\bvencid\w+\b/.test(t)) filtros.push({ col: 'diasParaVencer', op: '<', valor: 0 });
    else if (/\b(por vencer|proximos? a vencer|a punto de vencer)\b/.test(t) && !/\bdias\b/.test(t)) {
      filtros.push({ col: 'diasParaVencer', op: 'entre', valor: [0, 7] });
      orden.push({ col: 'vence', dir: 'asc' });
    }
  }
  if (dsId === 'estudiantes') {
    if (/\bsin beca\b/.test(t)) filtros.push({ col: 'beca', op: '=', valor: 'Sin beca' });
    else if (/\b(con beca|becad[oa]s?|becari[oa]s?)\b/.test(t)) filtros.push({ col: 'beca', op: '!=', valor: 'Sin beca' });
    if (/\b(sin reservas|no reservaron|nunca reservaron)\b/.test(t)) filtros.push({ col: 'reservas', op: '=', valor: 0 });
  }
  if (dsId === 'reservas' && VINIERON.test(t)) filtros.push({ col: 'estado', op: '=', valor: 'Consumida' });
  if (dsId === 'becas') {
    if (/\b(inactiv\w+|sin usar|sin uso|no (?:la )?(?:usan|usaron|usa)|desaprovechad\w+)\b/.test(t)) filtros.push({ col: 'usadas', op: '=', valor: 0 });
    if (/\b(no vigentes?|vencidas?|expiradas?)\b/.test(t)) filtros.push({ col: 'vigente', op: '=', valor: 'No' });
    else if (/\b(vigentes?|activas?|activos?)\b/.test(t)) filtros.push({ col: 'vigente', op: '=', valor: 'Sí' });
  }
  return { filtros, orden };
}

// ----------------------------- detección del conjunto de datos -----------------------------

function detectarDataset(t) {
  if (VINIERON.test(t) && !DEL_PERSONAL.test(t)) return { id: 'reservas', score: 5, ranking: [['reservas', 5]] };
  const compartidas = {};
  for (const ds of Object.values(DATASETS)) for (const c of ds.columnas) compartidas[c.nombre] = (compartidas[c.nombre] || 0) + 1;
  const puntaje = {};
  for (const [id, ds] of Object.entries(DATASETS)) {
    let s = 0;
    const usadas = new Set();
    ds.sinonimos.forEach((syn, i) => {
      const fam = norm(syn).replace(/(es|s)$/, '');
      if (!usadas.has(fam) && reFrase(norm(syn)).test(t)) {
        s += i < 3 ? 3 : 2;
        usadas.add(fam);
        if (new RegExp('\\b(?:de|del)(?: los| las| el| la)? ' + escapar(norm(syn))).test(t)) s += 2;        // "de los pagos": ahí está el tema
      }
    });
    for (const r of ds.raices || []) if (new RegExp('\\b' + r + '\\w*').test(t)) s += 3;
    for (const c of ds.columnas) if (frases(c).some((f) => reFrase(f).test(t))) s += compartidas[c.nombre] > 1 ? 0.5 : 1.5;
    puntaje[id] = s;
  }
  const orden = Object.entries(puntaje).sort((a, b) => b[1] - a[1]);
  const [mejor, s] = orden[0];
  if (s >= 1.5) return { id: mejor, score: s, ranking: orden.slice(0, 3) };
  // respaldo: parecido de palabras (TF-IDF simplificado)
  const docs = Object.values(DATASETS).map((d) => norm(`${d.etiqueta} ${d.descripcion} ${d.palabras_clave}`).split(' '));
  const df = {};
  docs.forEach((d) => new Set(d).forEach((w) => { df[w] = (df[w] || 0) + 1; }));
  const idf = (w) => Math.log((1 + docs.length) / (1 + (df[w] || 0))) + 1;
  const vec = (ws) => { const v = {}; ws.forEach((w) => { v[w] = (v[w] || 0) + idf(w); }); return v; };
  const coseno = (a, b) => { let p = 0, na = 0, nb = 0; for (const k in a) { na += a[k] ** 2; if (b[k]) p += a[k] * b[k]; } for (const k in b) nb += b[k] ** 2; return na && nb ? p / Math.sqrt(na * nb) : 0; };
  const q = vec(t.split(' ').filter((w) => w.length > 2));
  const sims = docs.map((d) => coseno(q, vec(d)));
  const i = sims.indexOf(Math.max(...sims));
  if (sims[i] >= 0.12) return { id: Object.keys(DATASETS)[i], score: sims[i] * 10, ranking: orden.slice(0, 3) };
  return { id: null, score: s, ranking: orden.slice(0, 3) };
}

// ----------------------------- lectura de una petición -----------------------------

const patronesComp = [
  [/\b(?:mayor(?:es)?|superior(?:es)?|mas|por encima|superen|supera|excedan?)\s+(?:de|a|que|del)?\s*(?:bs\.? ?|\$)?(\d+(?:[.,]\d+)?)\b(?! (?:mayores|menores))/g, '>'],
  [/\b(?:al menos|como minimo|minimo de|no menos de|a partir de)\s+(?:bs\.? ?)?(\d+(?:[.,]\d+)?)\b/g, '>='],
  [/\b(?:menor(?:es)?|inferior(?:es)?|menos|por debajo)\s+(?:de|a|que|del)\s*(?:bs\.? ?|\$)?(\d+(?:[.,]\d+)?)\b/g, '<'],
  [/\b(?:como maximo|maximo de|a lo sumo|no mas de)\s+(?:bs\.? ?)?(\d+(?:[.,]\d+)?)\b/g, '<='],
  [/\b(?:igual a|exactamente|justo)\s+(?:bs\.? ?)?(\d+(?:[.,]\d+)?)\b/g, '='],
  [/\bde (\d+(?:[.,]\d+)?) (?:bs|bolivianos)\b/g, '='],
];

function leer(t0, dsId, rows, hoy) {
  const ds = DATASETS[dsId];
  let t = t0;
  const p = {};
  for (const [nombre, re] of FORMATOS) {
    const m = re.exec(t);
    if (m) { p.salida = nombre; t = blank(t, ...spanDe(m)); break; }
  }
  const nombres = valores(t, dsId, rows, 'nombres');            // "admin julio" es una persona, no el mes de julio
  nombres.spans.forEach(([a, b]) => { t = blank(t, a, b); });
  const [f, t1] = parseFechas(t, hoy);
  t = t1;
  if (f) p.fecha = f;
  if (/\b(todas las fechas|sin fecha|todo el historial|todo el tiempo|historico)\b/.test(t)) p.quitar_fecha = true;

  let direccion = null;
  for (const [re, d] of [[/\bde mayor a menor\b/, 'desc'], [/\bde menor a mayor\b/, 'asc'], [/\b(descendente|descendentemente|decreciente|de z a a)\b/, 'desc'], [/\b(ascendente|ascendentemente|creciente|de a a z)\b/, 'asc']]) {
    const m = re.exec(t);
    if (m) { direccion = d; t = blank(t, ...spanDe(m)); break; }
  }

  // comparaciones numéricas ("mayores a 5" no es "los mayores")
  const mentsNum = menciones(t, dsId, ['numero']);
  const filtros = [];
  const consumidos = [];
  let m = /\bentre (?:bs\.? ?)?(\d+(?:[.,]\d+)?) y (?:bs\.? ?)?(\d+(?:[.,]\d+)?)\b/.exec(t);
  if (m) consumidos.push([spanDe(m), 'entre', [numero(m[1]), numero(m[2])]]);
  for (const [re, op] of patronesComp) {
    for (const x of t.matchAll(new RegExp(re.source, 'g'))) {
      const [a] = spanDe(x);
      if (consumidos.some(([[s, e]]) => a >= s && a < e)) continue;
      consumidos.push([spanDe(x), op, numero(x[1])]);
    }
  }
  consumidos.sort((p, q) => p[0][0] - q[0][0]);
  for (const [[a, b], op, val] of consumidos) {
    const col = cercana(a, mentsNum, numCols(dsId)) || COL_NUM[dsId] || numCols(dsId)[0] || null;
    const antes = t.slice(Math.max(0, a - 30), a);
    const post = /\b(con|que tengan|que sumen|que superen|cuyo|cuyos|donde el|total|promedio|cantidad)\b/.test(antes) && col !== null;
    if (col) filtros.push({ col, op, valor: val, ...(post ? { post: true } : {}) });
    t = blank(t, a, b);
  }

  const esp = frasesEspeciales(t, dsId);
  filtros.push(...esp.filtros);
  filtros.push(...nombres.filtros, ...valores(t, dsId, rows).filtros);
  const dias = Object.entries(DIAS).filter(([d]) => new RegExp(`\\b(?:los |solo los |solo )?${d}s?\\b`).test(t)).map(([, i]) => i);
  if (dias.length && ds.fecha) filtros.push({ col: ds.fecha, op: 'dia_semana', valor: [...new Set(dias)].sort() });

  // orden explícito: "ordenado por X ascendente"
  let orden = [], limite = null;
  m = /\b(?:ordenad[oa]s?|ordena(?:r|lo|los|las)?|orden|clasificad[oa]s?)\s+(?:de forma |en forma )?(?:por|segun)\s+(.+)/.exec(t);
  if (m) {
    const resto = m[1];
    const cols = menciones(resto, dsId).map((x) => x[2]);
    if (/\b(total|cantidad|suma|promedio)\b/.test(resto) && !cols.length) cols.push('__medida__');
    orden = cols.slice(0, 3).map((c) => ({ col: c, dir: direccion || 'asc' }));
    t = blank(t, ...spanDe(m));
  } else {
    m = /\bpor\s+(.+?)\s+(?:de forma\s+)?(asc|desc)\w*/.exec(t);
    if (m) {
      const cols = menciones(m[1], dsId).map((x) => x[2]);
      if (cols.length) { orden = [{ col: cols[0], dir: m[2] === 'desc' ? 'desc' : 'asc' }]; t = blank(t, ...spanDe(m)); }
    }
  }
  if (!orden.length) orden = [...esp.orden];

  // rankings: "los 10 mayores", "los 5 más pedidos", "el mayor"
  const tEnt = t;                      // antes de borrar el ranking: ahí aparece la entidad ("los 5 platos más...")
  let rankCol = null, hubo = false;
  const ranking = [
    [/\b(?:los |las )?(?:top |ranking )?(\d+)(?: \w+){0,2}? (?:mayor(?:es)?|mejor(?:es)?|principal(?:es)?|mas altos?|mas caros?|maximos?)\b/, 'desc', 0],
    [/\b(?:los |las )?(\d+)(?: \w+){0,2}? (?:menor(?:es)?|peor(?:es)?|mas bajos?|mas baratos?|minimos?)\b/, 'asc', 0],
    [/\b(?:los |las )?(\d+)(?: \w+){0,2}? (?:con |que )?mas (\w+)/, 'desc', 2],
    [/\b(?:los |las )?(\d+)(?: \w+){0,2}? (?:con |que )?menos (\w+)/, 'asc', 2],
    [/\b(?:los |las )?(?:top|ranking) (\d+)\b/, 'desc', 0],
    [/\b(?:los |las )?(\d+) primer[oa]s\b|\bprimer[oa]s (\d+)\b/, 'first', 0],
    [/\b(?:los |las )?(\d+) ultim[oa]s\b/, 'last', 0],
  ];
  for (const [re, d, g] of ranking) {
    m = re.exec(t);
    if (!m) continue;
    limite = Number(m.slice(1).find((x) => x && /^\d+$/.test(x)));
    hubo = true;
    if (d === 'desc' || d === 'asc') { direccion = direccion || d; if (g) rankCol = colPorRaiz(dsId, m[g]); }
    else if (d === 'last' && ds.fecha && !orden.length) orden = [{ col: ds.fecha, dir: 'desc' }];
    t = blank(t, ...spanDe(m));
    break;
  }
  if (!hubo) {
    m = /\bel (mayor|mejor|maximo|mas alto|mas caro|menor|peor|minimo|mas bajo|mas barato)\b/.exec(t);
    if (m) { limite = 1; hubo = true; direccion = direccion || (['mayor', 'mejor', 'maximo', 'mas alto', 'mas caro'].includes(m[1]) ? 'desc' : 'asc'); t = blank(t, ...spanDe(m)); }
  }
  if (!hubo) {
    for (const [re, d] of [[/\b(?:los |las )?(?:mayor(?:es)?|mas altos?|mas caros?|mejores)\b/, 'desc'], [/\b(?:los |las )?(?:menor(?:es)?|mas bajos?|mas baratos?|peores)\b/, 'asc']]) {
      m = re.exec(t);
      if (m) { direccion = direccion || d; t = blank(t, ...spanDe(m)); break; }
    }
    m = /\b(?:con )?(mas|menos) (\w+)(?: (\w+))?\b/.exec(t);
    const cr = m && ((m[3] && colPorRaiz(dsId, m[3])) || colPorRaiz(dsId, m[2]));
    if (cr) { rankCol = cr; direccion = direccion || (m[1] === 'mas' ? 'desc' : 'asc'); t = blank(t, ...spanDe(m)); }
  }
  if (limite === null) {
    m = /\b(?:solo |maximo |hasta |limitar a |limite de )?(\d+) (?:registros|filas|resultados|renglones)\b|\b(?:limite|limitar a) (\d+)\b/.exec(t);
    if (m) { limite = Number(m[1] || m[2]); t = blank(t, ...spanDe(m)); }
  }

  // agrupación
  const agrupar = [];
  const patT = /\b(?:agrupad[oa]s?|agrupa(?:r|do)?|desglosad[oa]s?|separad[oa]s?|segmentad[oa]s?)?\s*(?:por|segun|cada)\s+(?:cada\s+)?(dia de la semana|dias de la semana|dia|dias|semana|semanas|mes|meses|trimestre|trimestres|anio|anios|ano|anos)\b/;
  m = patT.exec(t);
  if (m && ds.fecha) { agrupar.push({ col: ds.fecha, por: TIEMPO[m[1]] }); t = blank(t, ...spanDe(m)); }
  for (const x of [...t.matchAll(/\b(mensual(?:mente)?|diari[oa](?:mente)?|semanal(?:mente)?|anual(?:mente)?|trimestral)\b/g)]) {
    if (!agrupar.length && ds.fecha) agrupar.push({ col: ds.fecha, por: TIEMPO[x[1]] });
    t = blank(t, ...spanDe(x));
  }
  for (const x of [...t.matchAll(/\b(?:de |para )?cada\s+(\w+)/g)]) {
    if (TIEMPO[x[1]] && !agrupar.length && ds.fecha) { agrupar.push({ col: ds.fecha, por: TIEMPO[x[1]] }); t = blank(t, ...spanDe(x)); }
  }
  for (const x of [...t.matchAll(/\b(?:agrupad[oa]s?\s+por|desglosad[oa]s?\s+por|por|para cada|de cada|segun|cada)\s+(?:cada\s+)?([a-z ]{3,40})/g)]) {
    const mm = menciones(x[1], dsId)[0];
    if (!mm) continue;
    const c = columna(dsId, mm[2]);
    if ((c.tipo === 'categoria' || c.tipo === 'texto') && !agrupar.some((g) => g.col === mm[2])) agrupar.push({ col: mm[2] });
    else if (c.tipo === 'fecha' && !agrupar.length) agrupar.push({ col: mm[2], por: 'dia' });
  }

  // medidas
  let medidas = [];
  const cuantos = /\b(cuant[oa]s?|cantidad|numero de|conteo|contar|cuenta)\b/.test(t);
  for (const [re, fn] of [[/\b(promedio|media|promedi\w+)\b/, 'avg'], [/\b(maximo|pico|valor mas alto)\b/, 'max'], [/\b(minimo|valor mas bajo)\b/, 'min'],
    [/\b(suma|sumatoria|sumar|total|totales|acumulado|recaud\w+|ingres\w+|cobrad\w+ en total|gastad\w+)\b/, 'sum']]) {
    m = re.exec(t);
    if (!m) continue;
    const col = cercana(m.index, menciones(t, dsId, ['numero']), numCols(dsId)) || COL_NUM[dsId];
    if (fn === 'sum' && !col) medidas.push({ fn: 'count' });
    else if (col) medidas.push({ fn, col });
    break;
  }
  if (cuantos && !medidas.some((x) => x.fn === 'count')) {
    if (!medidas.length || /\b(cuant[oa]s?|cantidad de|numero de)\b/.test(t)) medidas.push({ fn: 'count' });
  }
  if (/\b(distint[oa]s|diferentes|unic[oa]s)\b/.test(t) && cuantos) {
    const c = (menciones(t, dsId, ['texto', 'categoria'])[0] || [])[2];
    if (c) medidas = [{ fn: 'nunique', col: c }];
  }

  // ranking sobre una entidad: "los 5 platos más reservados" => agrupar por plato
  if ((hubo || rankCol) && !agrupar.length) {              // solo un ranking explícito ("los 5 platos más..."), no un simple "descendente"
    const subj = new Set(ds.sinonimos.map(norm));
    for (const [, , n] of menciones(tEnt, dsId, ['categoria', 'texto'])) {
      const fr = frases(columna(dsId, n));
      const esSujeto = fr.some((x) => subj.has(x)) && !['reservas', 'pagos', 'menus', 'desperdicio'].includes(dsId);
      if (!esSujeto && !(dsId === 'estudiantes' && ['nombre', 'matricula', 'email', 'telefono'].includes(n))) { agrupar.push({ col: n }); break; }
    }
  }
  if (agrupar.length && !medidas.length && rankCol && columna(dsId, rankCol).tipo === 'numero') {
    medidas = [{ fn: columna(dsId, rankCol).fmt === 'porcentaje' ? 'avg' : 'sum', col: rankCol }];
  }

  // orden por defecto de un ranking
  if (direccion && !orden.length) {
    if (agrupar.length || medidas.length) orden = [{ col: '__medida__', dir: direccion }];
    else { const col = rankCol || COL_NUM[dsId]; if (col) orden = [{ col, dir: direccion }]; }
  } else if (direccion && orden.length) {
    orden.forEach((o) => { if (o.dir === 'asc' && direccion !== 'asc') o.dir = direccion; });
  }

  // columnas visibles (solo si no se agrupa)
  const pide = /\b(ver|mostrar|muestra|muestrame|mostrame|dame|listar|lista|listame|columnas|campos|atributos|incluye|incluir)\b/.test(t0);
  const base = (w) => w.replace(/(es|s)$/, '');
  const tema = new Set(ds.sinonimos.map((x) => base(norm(x))));
  const cols = [...new Set(menciones(t, dsId).filter(([a, b]) => !tema.has(base(t.slice(a, b)))).map((x) => x[2]))];
  if (pide && cols.length && !agrupar.length && !medidas.length) {
    const solo = /\b(solo|solamente|unicamente)\b/.test(t0);
    p.columnas = cols.length >= 2 || solo ? cols : ds.defecto.includes(cols[0]) ? ds.defecto : [...ds.defecto, ...cols];
  }
  Object.assign(p, { filtros, agrupar, medidas, orden, limite, direccion });
  return p;
}

// ----------------------------- interpretación completa -----------------------------

function resolverMedidaOrden(spec) {
  if (!(spec.orden || []).some((o) => o.col === '__medida__')) return spec;
  let med = (spec.medidas || [])[0];
  if (!med && (spec.agrupar || []).length) {
    const d = DATASETS[spec.dataset].medida;
    med = d.length ? (d[0][1] ? { fn: d[0][0], col: d[0][1] } : { fn: d[0][0] }) : { fn: 'count' };
  }
  if (med) { const key = M.medidaInfo(spec.dataset, med).key; spec.orden.forEach((o) => { if (o.col === '__medida__') o.col = key; }); }
  else spec.orden = spec.orden.filter((o) => o.col !== '__medida__');
  return spec;
}

// «quita la columna estado», «saca el método», «sin la columna estudiante», «agrega la matrícula»
const QUITAR_COL = /^(?:y |ahora |pero |tambien )?(?:quita(?:le|r)?|saca(?:le|r)?|elimina(?:le|r)?|borra(?:le|r)?|oculta(?:le|r)?|remueve|no (?:quiero ver|quiero|muestres|pongas)|sin)\b(.*)$/;
const AGREGAR_COL = /^(?:y |ahora |pero |tambien )?(?:agrega(?:le|r)?|anade(?:le)?|pon(?:le|er)?|incluye|muestra(?:me)? tambien|quiero ver tambien)\b(.*)$/;

/** Quita o agrega columnas al reporte anterior. null si el pedido no es eso (p. ej. «sin beca» es un filtro). */
function editarColumnas(t, previa) {
  if ((previa.agrupar || []).length || (previa.medidas || []).length) return null;   // un resumen agrupado tiene otras columnas
  if (/\bfiltros?\b/.test(t)) return null;
  const quitar = QUITAR_COL.exec(t), agregar = quitar ? null : AGREGAR_COL.exec(t);
  const m = quitar || agregar;
  if (!m) return null;
  if (/^(?:(?:y|ahora|pero|tambien) )?sin\b/.test(t) && !/\bcolumnas?\b/.test(t)) return null;
  const nombres = [...new Set(menciones(m[1], previa.dataset, null).map((x) => x[2]))];
  if (!nombres.length) return null;
  const ds = DATASETS[previa.dataset];
  let cols = [...(previa.columnas || ds.defecto)];
  if (quitar) cols = cols.filter((c) => !nombres.includes(c));
  else nombres.forEach((n) => { if (!cols.includes(n)) cols.push(n); });
  if (!cols.length) throw new NoEntendido('El reporte tiene que quedar con al menos una columna.');
  const spec = JSON.parse(JSON.stringify(previa));
  spec.columnas = ds.columnas.map((c) => c.nombre).filter((c) => cols.includes(c));      // en el orden del catálogo
  const fmt = FORMATOS.find(([, re]) => re.test(t));
  if (fmt) spec.salida = fmt[0];
  return spec;
}

const esRefinamiento = (t) => /^(ahora|ademas|tambien|y |pero|mejor|solo|solamente|quitale|quita|agregale|agrega|ponle|pon |cambialo|cambia|ordenalo|ordena|filtralo|filtra|agrupalo|agrupa|muestrame tambien|que sea|en vez|en lugar)/.test(t);
const mismaClase = (op) => ['=', 'en', '!=', 'no_en'].includes(op);

/** texto -> { spec, entendi, notas, confianza }. `previa` es la consulta anterior para continuar la conversación. */
function interpretar(texto, { previa = null, hoy = F.hoyLocal(), tablas = null } = {}) {
  const t0 = corregirTipeos(norm(texto));
  if (!t0) throw new NoEntendido('Escribe o di qué reporte quieres.');
  const reiniciar = /\b(nuevo reporte|otro reporte|desde cero|empezar de nuevo|reiniciar)\b/.test(t0);
  if (reiniciar) previa = null;
  const editado = previa && DATASETS[previa.dataset] ? editarColumnas(t0, previa) : null;
  if (editado) return { spec: editado, entendi: entendido(editado), notas: [], confianza: 1, continuacion: true, alternativas: [] };
  const det = detectarDataset(t0);
  let dsId = det.id, refina = false;
  if (previa && DATASETS[previa.dataset] && (dsId === null || det.score < 1.5 || (dsId === previa.dataset && esRefinamiento(t0)))) { dsId = previa.dataset; refina = true; }
  if (dsId === null) throw new NoEntendido('No entendí qué datos quieres ver. Prueba con: «pagos de noviembre por mes», «estudiantes con beca» o «insumos con stock bajo».');
  const rows = tablas && tablas[dsId] ? M.aObjetos(tablas[dsId]) : null;
  const p = leer(t0, dsId, rows, hoy);

  const spec = refina ? JSON.parse(JSON.stringify(previa)) : { dataset: dsId, columnas: null, fecha: null, filtros: [], agrupar: [], medidas: [], orden: [], limite: null, salida: 'pantalla' };
  spec.dataset = dsId;
  if (/\b(sin filtros|quita(?:le)? los filtros|borra los filtros)\b/.test(t0)) spec.filtros = [];
  if (/\b(sin agrupar|quita(?:le)? la agrupacion|en detalle|sin agrupacion)\b/.test(t0)) { spec.agrupar = []; spec.medidas = []; }
  if (/\bsin limite\b|\btodos los registros\b/.test(t0)) spec.limite = null;
  if (p.quitar_fecha) spec.fecha = null;
  if (p.fecha) spec.fecha = p.fecha;
  for (const f of p.filtros) {                                      // un filtro nuevo reemplaza al anterior de esa columna
    spec.filtros = spec.filtros.filter((x) => !(x.col === f.col && mismaClase(x.op) === mismaClase(f.op)));
    spec.filtros.push(f);
  }
  if (p.agrupar.length) spec.agrupar = p.agrupar;
  if (p.medidas.length) spec.medidas = p.medidas;
  if (p.orden.length) spec.orden = p.orden;
  else if (p.direccion && (spec.agrupar.length || spec.medidas.length)) spec.orden = [{ col: '__medida__', dir: p.direccion }];
  if (p.limite) spec.limite = p.limite;
  if (p.salida) spec.salida = p.salida; else if (!refina) spec.salida = 'pantalla';
  if (p.columnas) spec.columnas = p.columnas;
  if (spec.agrupar.length || spec.medidas.length) spec.columnas = null;
  resolverMedidaOrden(spec);

  const notas = [];
  if (!spec.fecha && DATASETS[dsId].fecha) notas.push('No indicaste un período: se consideran todos los registros.');
  if (p.agrupar.some((g) => g.por) && !DATASETS[dsId].fecha) notas.push('Estos datos no tienen fechas para agrupar por tiempo.');
  return { spec, entendi: entendido(spec), notas, confianza: Math.round(Math.min(1, (refina ? 3 : det.score) / 4) * 100) / 100,
    continuacion: refina, alternativas: det.ranking.slice(1).filter(([, s]) => s >= 1.5).map(([d]) => d) };
}

function entendido(spec) {
  const ds = DATASETS[spec.dataset];
  const partes = [`Quieres ver ${ds.etiqueta.toLowerCase()}`];
  if (spec.medidas && spec.medidas.length) partes.push('calculando ' + spec.medidas.map((m) => M.medidaInfo(spec.dataset, m).label.toLowerCase()).join(' y '));
  else if (spec.columnas) partes.push('con ' + spec.columnas.map((c) => columna(spec.dataset, c).etiqueta.toLowerCase()).join(', '));
  const cond = M.describir(spec);
  if (cond.length) partes.push('(' + cond.join('; ') + ')');
  const salida = { pantalla: 'en pantalla', pdf: 'en PDF', excel: 'en Excel' }[spec.salida || 'pantalla'] || 'en pantalla';
  return `${partes.join(' ')}, ${salida}.`;
}

module.exports = { interpretar, entendido };
