// Datos de los reportes: el servidor entrega una copia (snapshot) por rol y el navegador la guarda (IndexedDB),
// así los reportes se pueden generar también SIN conexión, igual que en la app móvil.
import { API } from '../vivo';

const DB = 'bi-reportes';
const STORE = 'kv';

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

export async function leerGuardado<T = any>(clave: string): Promise<T | null> {
  try {
    const db = await abrir();
    return await new Promise((ok) => {
      const q = db.transaction(STORE).objectStore(STORE).get(clave);
      q.onsuccess = () => ok((q.result as T) ?? null);
      q.onerror = () => ok(null);
    });
  } catch { return null; }
}

export async function guardar(clave: string, valor: unknown): Promise<void> {
  try {
    const db = await abrir();
    await new Promise<void>((ok) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(valor, clave);
      t.oncomplete = () => ok();
      t.onerror = () => ok();
    });
  } catch { /* navegador sin almacenamiento: los reportes siguen funcionando con datos en memoria */ }
}

function token(): string {
  const m = document.cookie.match(/(?:^|;\s*)kc_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export function rolesDelToken(): string[] {
  try {
    const t = token();
    if (!t) return [];
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (p.realm_access?.roles || []).filter((r: string) => !r.startsWith('default-') && !r.startsWith('offline') && !r.startsWith('uma'));
  } catch { return []; }
}

export type Snapshot = { descargado: string; generado: string; datasets: Record<string, { columnas: string[]; filas: any[][] }>; errores: Record<string, string> };

/** Baja la copia de datos permitida para el rol del usuario y la guarda para usarla sin conexión. */
export async function descargarSnapshot(): Promise<Snapshot> {
  const roles = rolesDelToken();
  const t = token();
  const r = await fetch(`${API}/reportes/snapshot${roles.length ? `?rol=${encodeURIComponent(roles.join(','))}` : ''}`, {
    cache: 'no-store', headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
  const s = await r.json();
  const snap: Snapshot = { ...s, descargado: new Date().toISOString() };
  await guardar('snapshot', snap);
  return snap;
}
