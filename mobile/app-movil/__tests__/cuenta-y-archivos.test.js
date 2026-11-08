// Lectura del token (ingreso) y generación real de los archivos Excel / PDF-HTML / CSV.
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { perfilDeToken } = require('../src/cuenta/jwt');
const { interpretar } = require('../src/reportes/lenguaje');
const { ejecutar } = require('../src/reportes/motor');
const { aXlsxBase64, aCsv, nombreArchivo } = require('../src/reportes/exportar');
const { DATASETS } = require('../src/reportes/catalogo');
const F = require('../src/reportes/fechas');

const jwt = (payload) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.firma`;
};

test('lee usuario, nombre con tildes y rol del token', () => {
  const p = perfilDeToken(jwt({ preferred_username: 'admin.julio', name: 'Julio Peña Ñandú', email: 'a@uagrm.edu.bo', realm_access: { roles: ['default-roles-comedor', 'estudiante', 'administrador'] } }));
  assert.equal(p.usuario, 'admin.julio');
  assert.equal(p.nombre, 'Julio Peña Ñandú');
  assert.equal(p.rol, 'administrador');
  assert.deepEqual(p.roles.sort(), ['administrador', 'estudiante']);
});

test('un token sin roles conocidos es estudiante', () => {
  assert.equal(perfilDeToken(jwt({ preferred_username: 'x', realm_access: { roles: ['offline_access'] } })).rol, 'estudiante');
});

const tabla = (id, objs) => ({ columnas: DATASETS[id].columnas.map((c) => c.nombre), filas: objs.map((o) => DATASETS[id].columnas.map((c) => (o[c.nombre] === undefined ? null : o[c.nombre]))) });
const TABLAS = { pagos: tabla('pagos', [
  { fecha: '2026-11-02', estudiante: 'luis', monto: 10, metodo: 'Beca', estado: 'Cobrado' },
  { fecha: '2026-11-04', estudiante: 'luis', monto: 12.5, metodo: 'Efectivo', estado: 'Cobrado' },
  { fecha: '2026-10-05', estudiante: 'ana', monto: 8, metodo: 'QR / tarjeta', estado: 'Cobrado' }]) };
const hoy = F.fecha(2026, 11, 6);

test('el Excel generado se puede abrir: títulos, datos, formatos y total con fórmula', () => {
  const r = ejecutar(interpretar('pagos ordenados por fecha en excel', { hoy, tablas: TABLAS }).spec, TABLAS);
  const libro = XLSX.read(aXlsxBase64(r, XLSX), { type: 'base64', cellDates: true, cellNF: true });
  assert.deepEqual(libro.SheetNames, ['Reporte', 'Consulta']);
  const ws = libro.Sheets.Reporte;
  assert.equal(ws.A1.v, r.titulo);
  assert.equal(ws.A5.v, 'Fecha');
  const datos = XLSX.utils.sheet_to_json(ws, { range: 4, header: 1 });
  assert.equal(datos.length, 5);                                   // encabezado + 3 filas + total
  assert.equal(datos[1][2], 8);                                    // ordenado por fecha: octubre primero
  assert.equal(datos[4][0], 'TOTAL');
  assert.equal(ws.C9.f, 'SUM(C6:C8)');
  assert.equal(ws.C6.z, '"Bs "#,##0.00');
});

test('el Excel agrupado incluye la hoja de la consulta y respeta los meses', () => {
  const r = ejecutar(interpretar('total por mes en excel', { hoy, tablas: TABLAS }).spec, TABLAS);
  const libro = XLSX.read(aXlsxBase64(r, XLSX), { type: 'base64' });
  const filas = XLSX.utils.sheet_to_json(libro.Sheets.Reporte, { range: 4, header: 1 });
  assert.deepEqual(filas.slice(1, 3).map((f) => f[0]), ['Oct 2026', 'Nov 2026']);
  assert.ok(XLSX.utils.sheet_to_json(libro.Sheets.Consulta, { header: 1 }).some((f) => f[0] === 'Datos'));
});

test('CSV con comillas y nombre de archivo limpio', () => {
  const r = ejecutar(interpretar('pagos', { hoy, tablas: TABLAS }).spec, TABLAS);
  const csv = aCsv(r);
  assert.ok(csv.includes('02/11/2026;luis;10;Beca;Cobrado'));
  assert.match(nombreArchivo('Pagos y recaudación · noviembre de 2026', 'pdf'), /^pagos-y-recaudacion-noviembre-de-2026-\d{8}-\d{4}\.pdf$/);
});
