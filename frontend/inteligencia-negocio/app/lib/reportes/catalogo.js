'use strict';
// Catálogo de datos que el generador de reportes puede consultar. NO se escribe a mano: viaja dentro de la copia de
// datos que entrega el servidor (/reportes/snapshot), así el navegador y el servidor siempre hablan del mismo catálogo.
// `cargar()` llena el objeto compartido DATASETS (se modifica en el lugar para que todos los módulos lo vean).

const DATASETS = {};
let version = 0;

function cargar(catalogo) {
  for (const k of Object.keys(DATASETS)) delete DATASETS[k];
  Object.assign(DATASETS, catalogo || {});
  version++;
}

const columna = (dataset, nombre) => DATASETS[dataset].columnas.find((c) => c.nombre === nombre);
const etiqueta = (dataset, nombre) => {
  const c = columna(dataset, nombre);
  return c ? c.etiqueta : nombre;
};

module.exports = { DATASETS, columna, etiqueta, cargar, versionCatalogo: () => version };
