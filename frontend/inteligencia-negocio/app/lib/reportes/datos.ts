// Memoria del navegador para la pantalla de reportes: lo último consultado y las búsquedas recientes.
// La copia de datos para trabajar sin internet también se guarda aquí (ver local.ts).
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
  } catch { /* navegador sin almacenamiento: la pantalla funciona igual */ }
}

/** El token de Keycloak que dejó el login (el backend saca de ahí el rol y qué datos puede ver). */
export function token(): string {
  const m = document.cookie.match(/(?:^|;\s*)kc_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
