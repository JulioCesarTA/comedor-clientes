// IA local de reportes: el intérprete (español -> consulta) y el motor (consulta -> tabla/gráfico) corren AQUÍ, en el
// navegador. Los datos y el catálogo se bajan del servidor una vez (/reportes/snapshot), se guardan en IndexedDB y desde
// ahí todo funciona sin internet. Es el mismo motor que el del servidor y el del teléfono (lo comprueba paridad.test.js).
import { guardar, leerGuardado, token } from './datos';
import { API } from '../vivo';
// @ts-ignore  módulos JS compartidos
import * as catalogo from './catalogo';
// @ts-ignore
import * as lenguaje from './lenguaje';
// @ts-ignore
import * as motor from './motor';

export type Snapshot = {
  generado: string;                 // cuándo el servidor armó la copia (hora del servidor)
  guardadoEn: number;               // cuándo se guardó en este navegador (ms)
  usuario: string;                  // de quién es: si entra otra persona en este navegador, no se reutiliza
  catalogo: Record<string, any>;
  datasets: Record<string, { columnas: string[]; filas: any[][] }>;
  errores?: Record<string, string>;
};

const VIGENCIA_MS = 15 * 60 * 1000;     // pasado este tiempo, si hay internet se baja una copia nueva al abrir
let actual: Snapshot | null = null;

export function usuarioActual(): string {
  try { return JSON.parse(atob(token().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).preferred_username || ''; } catch { return ''; }
}

function usar(s: Snapshot) {
  actual = s;
  catalogo.cargar(s.catalogo);
}

/** Copia guardada en este navegador (sin tocar la red). null si no hay o es de otra persona. */
export async function copiaGuardada(): Promise<Snapshot | null> {
  const s = await leerGuardado<Snapshot>('snapshot');
  if (!s || s.usuario !== usuarioActual()) return null;
  usar(s);
  return s;
}

/** Baja una copia nueva de los datos de tu rol. Lanza si no hay internet o el servidor falla. */
export async function actualizar(): Promise<Snapshot> {
  const t = token();
  const r = await fetch(`${API}/reportes/snapshot`, { cache: 'no-store', headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (r.status === 401 || r.status === 403) throw new Error('Tu sesión venció: vuelve a ingresar para actualizar los datos.');
  if (!r.ok) throw new Error(`El servidor respondió ${r.status}.`);
  const j = await r.json();
  if (!j?.catalogo || !j?.datasets) throw new Error('El servidor aún no envía el catálogo de reportes (se está actualizando). Intenta en unos minutos.');
  const s: Snapshot = { ...j, guardadoEn: Date.now(), usuario: usuarioActual() };
  await guardar('snapshot', s);
  usar(s);
  return s;
}

/** Deja listos los datos: usa la copia guardada y, si hay internet y está vieja, la renueva. Devuelve la que quedó en uso. */
export async function preparar(forzar = false): Promise<{ snap: Snapshot | null; aviso: string }> {
  const guardada = await copiaGuardada();
  const vieja = !guardada || Date.now() - guardada.guardadoEn > VIGENCIA_MS;
  if (!forzar && !vieja) return { snap: guardada, aviso: '' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { snap: guardada, aviso: guardada ? '' : 'Aún no hay datos en este navegador: conéctate una vez para descargarlos.' };
  try {
    return { snap: await actualizar(), aviso: '' };
  } catch (e: any) {
    return { snap: guardada, aviso: guardada ? '' : (e.message || String(e)) };
  }
}

export function snapshotActual(): Snapshot | null { return actual; }

/** Interpreta un pedido en español y lo ejecuta con los datos locales. */
export function consultar(texto: string, previa: any) {
  if (!actual) throw new Error('Aún no hay datos en este navegador: conéctate una vez para descargarlos.');
  const leido = lenguaje.interpretar(texto, { previa: previa || null, tablas: actual.datasets });
  const r = motor.ejecutar(leido.spec, actual.datasets);
  return { ...r, spec: leido.spec, entendi: leido.entendi, confianza: leido.confianza, notas: [...r.notas, ...leido.notas] };
}

/** Reejecuta un spec ya armado (ajustes rápidos de la pantalla). */
export function ejecutarSpec(spec: any) {
  if (!actual) throw new Error('Aún no hay datos en este navegador.');
  const r = motor.ejecutar(spec, actual.datasets);
  return { ...r, spec, entendi: lenguaje.entendido(spec) };
}

/** Ayuda de la pantalla (qué se puede pedir), sacada del catálogo local. */
export function ayuda() {
  return Object.entries(catalogo.DATASETS as Record<string, any>).map(([id, d]) => ({
    id, etiqueta: d.etiqueta, descripcion: d.descripcion, ejemplos: d.ejemplos || [],
    columnas: d.columnas.map((c: any) => ({ key: c.nombre, label: c.etiqueta, tipo: c.tipo, fmt: c.fmt })),
  }));
}

/** Para el cambio de usuario: borra la copia (datos de un rol no deben quedar para otro). */
export async function olvidar() { actual = null; await guardar('snapshot', null); }
