// El generador de reportes entiende español y calcula bien. Datos de prueba controlados; corre con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretar } = require('../src/reportes/lenguaje');
const { ejecutar, ConsultaInvalida } = require('../src/reportes/motor');
const { DATASETS } = require('../src/reportes/catalogo');
const { aCsv, aHtml } = require('../src/reportes/exportar');
const F = require('../src/reportes/fechas');

const HOY = F.fecha(2026, 11, 6);
const tabla = (dsId, objs) => ({ columnas: DATASETS[dsId].columnas.map((c) => c.nombre), filas: objs.map((o) => DATASETS[dsId].columnas.map((c) => (o[c.nombre] === undefined ? null : o[c.nombre]))) });

const TABLAS = {
  pagos: tabla('pagos', [
    { fecha: '2026-10-03', estudiante: 'ana', monto: 10, metodo: 'QR / tarjeta', estado: 'Cobrado', reserva: 'a' },
    { fecha: '2026-10-20', estudiante: 'ana', monto: 4, metodo: 'QR / tarjeta', estado: 'Cobrado', reserva: 'b' },
    { fecha: '2026-11-02', estudiante: 'luis', monto: 10, metodo: 'Beca', estado: 'Cobrado', reserva: 'c' },
    { fecha: '2026-11-02', estudiante: 'maria', monto: 6, metodo: 'QR / tarjeta', estado: 'Fallido', reserva: 'd' },
    { fecha: '2026-11-04', estudiante: 'luis', monto: 12, metodo: 'Efectivo', estado: 'Cobrado', reserva: 'e' },
    { fecha: '2026-11-05', estudiante: 'ana', monto: 8, metodo: 'QR / tarjeta', estado: 'Cobrado', reserva: 'f' },
    { fecha: '2025-12-01', estudiante: 'pedro', monto: 10, metodo: 'QR / tarjeta', estado: 'Cobrado', reserva: 'g' },
  ]),
  reservas: tabla('reservas', [
    { fecha: '2026-11-02', turno: 'Almuerzo', plato: 'pollo', estado: 'Confirmada', estudiante: 'Ana Rojas', matricula: '1' },
    { fecha: '2026-11-02', turno: 'Cena', plato: 'pollo', estado: 'Confirmada', estudiante: 'Luis Vaca', matricula: '2' },
    { fecha: '2026-11-03', turno: 'Almuerzo', plato: 'asado', estado: 'Pendiente', estudiante: 'Ana Rojas', matricula: '1' },
    { fecha: '2026-11-04', turno: 'Almuerzo', plato: 'pollo', estado: 'Confirmada', estudiante: 'Maria Suarez', matricula: '3' },
    { fecha: '2026-11-04', turno: 'Desayuno', plato: 'pan', estado: 'Cancelada', estudiante: 'Luis Vaca', matricula: '2' },
    { fecha: '2026-11-05', turno: 'Almuerzo', plato: 'asado', estado: 'Confirmada', estudiante: 'Ana Rojas', matricula: '1' },
    { fecha: '2026-10-15', turno: 'Almuerzo', plato: 'pollo', estado: 'Confirmada', estudiante: 'Pedro Peña', matricula: '7' },
  ]),
  estudiantes: tabla('estudiantes', [
    { matricula: '1', nombre: 'Ana Rojas', email: 'a@x', telefono: '', beca: 'Completa', reservas: 3, pagado: 22 },
    { matricula: '2', nombre: 'Luis Vaca', email: 'l@x', telefono: '', beca: 'Sin beca', reservas: 2, pagado: 22 },
    { matricula: '3', nombre: 'Maria Suarez', email: 'm@x', telefono: '', beca: 'Sin beca', reservas: 1, pagado: 6 },
  ]),
  insumos: tabla('insumos', [
    { insumo: 'Arroz', unidad: 'kg', stock: 50, minimo: 5, estado: 'En rango', lotes: 1, vence: '2026-11-09', diasParaVencer: 3 },
    { insumo: 'Sal', unidad: 'kg', stock: 0, minimo: 1, estado: 'Bajo', lotes: 1, vence: '2026-12-30', diasParaVencer: 54 },
    { insumo: 'Pollo', unidad: 'kg', stock: 20, minimo: 3, estado: 'En rango', lotes: 1, vence: '2026-11-20', diasParaVencer: 14 },
  ]),
  becas: tabla('becas', [{ estudiante: 'Ana Rojas', matricula: '1', tipo: 'Completa', cupoMensual: 60, usadas: 0, disponibles: 60, uso: 0, desde: '2026-11-01', hasta: '2026-12-01', vigente: 'Sí' }]),
  menus: tabla('menus', [{ fecha: '2026-11-03', turno: 'Almuerzo', plato: 'pollo', cupo: 50, apartadas: 10, disponibles: 40, ocupacion: 20 }]),
  desperdicio: tabla('desperdicio', [
    { fecha: '2026-11-03', turno: 'Almuerzo', plato: 'pollo', restante: 30, comido: 70, confianza: 80 },
    { fecha: '2026-11-04', turno: 'Almuerzo', plato: 'asado', restante: 60, comido: 40, confianza: 70 },
  ]),
};

const i = (texto, previa = null) => interpretar(texto, { previa, hoy: HOY, tablas: TABLAS });
const run = (texto, previa = null) => { const r = i(texto, previa); return [r.spec, ejecutar(r.spec, TABLAS)]; };

test('columnas, filtro, fecha, orden y formato', () => {
  const [s, r] = run('quiero ver fecha, monto y estudiante de los pagos de noviembre ordenados por monto descendente en excel');
  assert.equal(s.dataset, 'pagos');
  assert.equal(s.salida, 'excel');
  assert.deepEqual(s.columnas, ['fecha', 'monto', 'estudiante']);
  assert.equal(s.fecha.desde, '2026-11-01');
  assert.equal(s.fecha.hasta, '2026-11-30');
  assert.deepEqual(s.orden, [{ col: 'monto', dir: 'desc' }]);
  assert.deepEqual(r.filas.map((f) => f.monto), [12, 10, 8, 6]);
});

test('total cobrado por mes, en orden cronológico', () => {
  const [s, r] = run('total cobrado por mes');
  assert.deepEqual(s.agrupar, [{ col: 'fecha', por: 'mes' }]);
  assert.deepEqual(s.medidas[0], { fn: 'sum', col: 'monto' });
  const porMes = Object.fromEntries(r.filas.map((f) => [f.mes, f.total_monto]));
  assert.equal(porMes['Nov 2026'], 30);              // «cobrado» deja fuera el pago fallido de 6
  assert.equal(porMes['Oct 2026'], 14);
  assert.equal(r.grafico.tipo, 'lineas');
  assert.deepEqual(r.filas.map((f) => f.mes), ['Dic 2025', 'Oct 2026', 'Nov 2026']);
});

test('filtro numérico, período relativo y PDF', () => {
  const [s, r] = run('pagos mayores a 5 bolivianos de este mes en pdf');
  assert.equal(s.salida, 'pdf');
  assert.ok(s.filtros.some((f) => f.col === 'monto' && f.op === '>' && f.valor === 5));
  assert.equal(s.fecha.desde, '2026-11-01');
  assert.ok(r.filas.every((f) => f.monto > 5));
});

test('los N mayores y menores', () => {
  let [s, r] = run('los 3 pagos mayores');
  assert.equal(s.limite, 3);
  assert.deepEqual(s.orden[0], { col: 'monto', dir: 'desc' });
  assert.deepEqual(r.filas.map((f) => f.monto), [12, 10, 10]);
  [s, r] = run('los 2 pagos menores');
  assert.deepEqual(r.filas.map((f) => f.monto), [4, 6]);
});

test('ranking de una entidad agrupa solo', () => {
  const [s, r] = run('los 2 platos mas reservados');
  assert.equal(s.dataset, 'reservas');
  assert.deepEqual(s.agrupar, [{ col: 'plato' }]);
  assert.equal(s.limite, 2);
  assert.deepEqual(r.filas[0], { plato: 'pollo', cantidad: 4 });
});

test('conteo por turno y filtro por valor', () => {
  let [s] = run('cuantas raciones se reservaron por turno');
  assert.deepEqual(s.medidas, [{ fn: 'count' }]);
  assert.deepEqual(s.agrupar, [{ col: 'turno' }]);
  let r;
  [s, r] = run('reservas de almuerzo de noviembre');
  assert.ok(s.filtros.some((f) => f.col === 'turno' && f.op === '=' && f.valor === 'Almuerzo'));
  assert.equal(r.filas.length, 4);
});

test('negación de valores', () => {
  const [s, r] = run('reservas sin canceladas');
  assert.ok(s.filtros.some((f) => f.col === 'estado' && f.op === '!=' && f.valor === 'Cancelada'));
  assert.ok(r.filas.every((f) => f.estado !== 'Cancelada'));
});

test('frases del negocio', () => {
  let [, r] = run('insumos con stock bajo');
  assert.deepEqual(r.filas.map((f) => f.insumo), ['Sal']);
  let s;
  [s, r] = run('estudiantes sin beca');
  assert.equal(r.filas.length, 2);
  assert.ok(r.filas.every((f) => f.beca === 'Sin beca'));
  [s, r] = run('becarios inactivos');
  assert.equal(s.dataset, 'becas');
  assert.equal(r.filas.length, 1);
});

test('método de pago con la medida por defecto', () => {
  const [s, r] = run('recaudacion por metodo de pago en excel');
  assert.deepEqual(s.agrupar, [{ col: 'metodo' }]);
  assert.equal(s.salida, 'excel');
  assert.deepEqual(new Set(r.filas.map((f) => f.metodo)), new Set(['QR / tarjeta', 'Beca', 'Efectivo']));
});

test('promedio y año', () => {
  const [s, r] = run('promedio de monto por mes del 2026');
  assert.deepEqual(s.medidas, [{ fn: 'avg', col: 'monto' }]);
  assert.equal(s.fecha.desde, '2026-01-01');
  assert.equal(s.fecha.hasta, '2026-12-31');
  assert.deepEqual(r.filas.map((f) => f.mes), ['Oct 2026', 'Nov 2026']);
});

test('rangos de fechas', () => {
  const f = (t) => run(t)[0].fecha;
  assert.deepEqual([f('pagos del 1 al 15 de noviembre').desde, f('pagos del 1 al 15 de noviembre').hasta], ['2026-11-01', '2026-11-15']);
  assert.deepEqual([f('pagos desde el 02/11/2026 hasta el 04/11/2026').desde, f('pagos desde el 02/11/2026 hasta el 04/11/2026').hasta], ['2026-11-02', '2026-11-04']);
  assert.deepEqual([f('pagos entre 2025 y 2026').desde, f('pagos entre 2025 y 2026').hasta], ['2025-01-01', '2026-12-31']);
  assert.deepEqual([f('pagos de octubre a noviembre').desde, f('pagos de octubre a noviembre').hasta], ['2026-10-01', '2026-11-30']);
  assert.deepEqual([f('pagos de los ultimos 30 dias').desde, f('pagos de los ultimos 30 dias').hasta], ['2026-10-08', '2026-11-06']);
  assert.deepEqual([f('pagos del primer trimestre de 2026').desde, f('pagos del primer trimestre de 2026').hasta], ['2026-01-01', '2026-03-31']);
  assert.equal(f('pagos de diciembre').desde, '2025-12-01');                 // diciembre aún no llegó este año: es el de 2025
  assert.deepEqual([f('pagos del 5 de noviembre').desde, f('pagos del 5 de noviembre').hasta], ['2026-11-05', '2026-11-05']);
  assert.equal(f('pagos desde 2025').desde, '2025-01-01');
});

test('tolera errores de tipeo', () => {
  const [s] = run('pagos de novienbre ordenados por monto desendente');
  assert.equal(s.fecha.desde, '2026-11-01');
  assert.equal(s.orden[0].dir, 'desc');
});

test('continúa la conversación', () => {
  const a = i('reservas por turno');
  const b = i('ahora en pdf', a.spec);
  assert.ok(b.continuacion);
  assert.deepEqual(b.spec.agrupar, a.spec.agrupar);
  assert.equal(b.spec.salida, 'pdf');
  const c = i('solo de noviembre', b.spec);
  assert.equal(c.spec.fecha.desde, '2026-11-01');
  assert.equal(c.spec.salida, 'pdf');
  assert.ok(c.spec.agrupar.length);
  const d = i('ordenalo de mayor a menor', c.spec);
  assert.deepEqual(d.spec.orden[0], { col: 'cantidad', dir: 'desc' });
  const e = i('nuevo reporte de pagos', d.spec);
  assert.equal(e.spec.dataset, 'pagos');
  assert.equal(e.spec.agrupar.length, 0);
  assert.equal(e.spec.fecha, null);
});

test('un filtro nuevo reemplaza al anterior de la misma columna', () => {
  const a = i('reservas de almuerzo');
  const b = i('ahora solo de cena', a.spec);
  assert.deepEqual(b.spec.filtros.filter((f) => f.col === 'turno').map((f) => f.valor), ['Cena']);
});

test('nombres de personas', () => {
  const [s, r] = run('reservas de Ana Rojas');
  assert.ok(s.filtros.some((f) => f.col === 'estudiante' && f.valor === 'Ana Rojas'));
  assert.equal(r.filas.length, 3);
});

test('no entiende algo sin sentido', () => {
  assert.throws(() => i('quiero ver zxqv wuiop'), /No entend/);
});

test('sin datos para un rol: lo dice claro', () => {
  const sinPagos = { ...TABLAS };
  delete sinPagos.pagos;
  const { spec } = interpretar('pagos de noviembre', { hoy: HOY, tablas: TABLAS });
  assert.throws(() => ejecutar(spec, sinPagos), (e) => e instanceof ConsultaInvalida && /no tienes datos/i.test(e.message));
});

test('exporta CSV y HTML (base del PDF) con los datos', () => {
  const [, r] = run('total cobrado por mes');
  const csv = aCsv(r);
  assert.ok(csv.startsWith('﻿Mes;'));
  assert.ok(csv.includes('Nov 2026;30'));
  const html = aHtml(r);
  assert.ok(html.includes('<table') && html.includes('Nov 2026') && html.includes('<svg'));
  const [, det] = run('pagos de noviembre');
  assert.ok(aHtml(det).includes('TOTAL'));
});
