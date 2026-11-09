'use strict';
// El motor de reportes corre en el navegador (sin internet). Este test comprueba que da EXACTAMENTE lo mismo que el
// del servidor: repite ~40 consultas guardadas por herramientas/generar_paridad_reportes.py (ia-ml-service) y compara.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cargar } = require('./catalogo');
const L = require('./lenguaje');
const M = require('./motor');
const F = require('./fechas');

const ruta = path.join(__dirname, '..', '..', '..', '..', '..', 'pruebas-comunes', 'reportes-paridad.json');
const ref = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
cargar(ref.catalogo);
const hoy = F.desdeIso(ref.hoy);

let previa = null;
for (const caso of ref.casos) {
  test(`${caso.continuar ? '↳ ' : ''}${caso.texto}`, () => {
    const e = caso.esperado;
    let leido, r;
    try {
      leido = L.interpretar(caso.texto, { previa: caso.continuar ? previa : null, hoy, tablas: ref.datasets });
      r = M.ejecutar(leido.spec, ref.datasets);
    } catch (err) {
      previa = null;
      assert.ok(e.error, `el servidor sí respondió pero aquí falló: ${err.message}`);
      assert.equal(err.message, e.error);
      return;
    }
    previa = leido.spec;
    assert.ok(!e.error, `el servidor falló («${e.error}») y aquí no`);
    const mio = {
      dataset: r.dataset, modo: r.modo, titulo: r.titulo, entendi: leido.entendi, spec: leido.spec, confianza: leido.confianza,
      continuacion: leido.continuacion, columnas: r.columnas, filas: r.filas, totales: r.totales, grafico: r.grafico,
      resumen: r.resumen, condiciones: r.condiciones, notas: [...r.notas, ...leido.notas], registrosAnalizados: r.registrosAnalizados,
      totalFilas: r.totalFilas, mostradas: r.mostradas,
    };
    for (const k of Object.keys(e)) assert.deepEqual(JSON.parse(JSON.stringify(mio[k])), e[k], `difiere «${k}»`);
  });
}
