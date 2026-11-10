'use strict';
// Pedidos "como los escribe la gente": sin tildes, con faltas, de a poco, como dictado, con relleno. El motor del navegador
// debe entender cada uno (sin error) y elegir el conjunto de datos correcto. Usa los datos de pruebas-comunes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cargar } = require('./catalogo');
const L = require('./lenguaje');
const M = require('./motor');
const F = require('./fechas');

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'pruebas-comunes', 'reportes-paridad.json'), 'utf-8'));
cargar(ref.catalogo);
const hoy = F.desdeIso(ref.hoy);

// [pedido, dataset esperado]
const CASOS = [
  // pagos / ingresos
  ['cuanto se cobro este mes', 'pagos'],
  ['plata que entro en octubre', 'pagos'],
  ['dame los pagos', 'pagos'],
  ['pagos x metodo', 'pagos'],
  ['quiero saber cuanto cobramos por mes este año en excel', 'pagos'],
  ['ingresos de la semana pasada', 'pagos'],
  ['los pagos mas grandes', 'pagos'],
  ['pagos con qr', 'pagos'],
  ['pagos devueltos', 'pagos'],
  ['total recaudado', 'pagos'],
  ['pagos en efectivo de hoy y ayer', 'pagos'],
  ['pagos de novienbre', 'pagos'],
  ['pagos de ocutbre ordenados del mayor al menor', 'pagos'],
  ['eh mostrame los pagos de los ultimos 15 dias porfa', 'pagos'],
  // reservas
  ['reservas de hoy', 'reservas'],
  ['cuantas reservas hubo ayer', 'reservas'],
  ['reservas por turno', 'reservas'],
  ['que plato se reservo mas', 'reservas'],
  ['reservas canseladas', 'reservas'],
  ['reservas de la cena de esta semana', 'reservas'],
  ['ranking de platos mas pedidos', 'menus'],          // total de porciones apartadas por plato: la misma respuesta
  ['reservas x dia', 'reservas'],
  ['cuantos reservaron el almuerzo el lunes', 'reservas'],
  ['top 3 estudiantes que mas reservan', 'estudiantes'], // estudiantes ordenados por su columna de reservas
  // estudiantes / becas
  ['lista de estudiantes', 'estudiantes'],
  ['estudiantes becados', 'estudiantes'],
  ['quienes tienen beca completa', 'becas'],
  ['becas que se estan usando poco', 'becas'],
  ['becarios', 'becas'],
  // menús / ocupación
  ['menus de la semana', 'menus'],
  ['ocupacion por plato', 'menus'],
  ['que menu se lleno mas', 'menus'],
  ['cupos libres de mañana', 'menus'],
  // insumos / desperdicio / asistencia
  ['que insumos faltan', 'insumos'],
  ['insumos a punto de vencer', 'insumos'],
  ['stock', 'insumos'],
  ['desperdicio por plato', 'desperdicio'],
  ['cuanta comida se tira', 'desperdicio'],
  ['plato con mas sobras', 'desperdicio'],
  ['asistencia del personal', 'asistencia'],
  ['quien marco entrada hoy', 'asistencia'],
  ['marcas sospechosas', 'asistencia'],
];

for (const [texto, ds] of CASOS) {
  test(texto, () => {
    let leido, r;
    try {
      leido = L.interpretar(texto, { previa: null, hoy, tablas: ref.datasets });
      r = M.ejecutar(leido.spec, ref.datasets);
    } catch (e) {
      assert.fail(`no lo entendió: ${e.message}`);
    }
    assert.equal(leido.spec.dataset, ds, `eligió «${leido.spec.dataset}» · entendí: ${leido.entendi}`);
    assert.ok(Array.isArray(r.filas));
  });
}

// Conversación de varios pasos sobre el mismo reporte, como se dicta
test('conversación: pagos -> por mes -> solo qr -> en excel -> los 3 mayores', () => {
  let previa = null;
  for (const t of ['pagos de este año', 'ahora agrupalo por mes', 'solo los de qr', 'pasamelo a excel', 'dejame solo los 3 mayores']) {
    const leido = L.interpretar(t, { previa, hoy, tablas: ref.datasets });
    M.ejecutar(leido.spec, ref.datasets);
    previa = leido.spec;
  }
  assert.equal(previa.dataset, 'pagos');
  assert.equal(previa.salida, 'excel');
});
