// Copia de los datos del comedor dentro del teléfono: con ella los reportes se generan SIN internet.
// Se descarga cuando hay conexión con el servidor del comedor y se guarda en un archivo del teléfono.
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';

const archivo = () => FileSystem.documentDirectory + 'datos-comedor.json';

/** { generado, descargado, datasets: { pagos: { columnas, filas }, ... } } o null si todavía no se descargó nada. */
export async function cargarLocal() {
  try {
    const info = await FileSystem.getInfoAsync(archivo());
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(archivo()));
  } catch { return null; }
}

export async function borrarLocal() {
  try { await FileSystem.deleteAsync(archivo(), { idempotent: true }); } catch { /* nada */ }
}

/** Descarga la copia de datos permitida para el rol y la guarda. Lanza un Error con un mensaje claro si no se puede. */
export async function descargar({ api, token, rol, ms = 25000 }) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${api}/reportes/snapshot?rol=${encodeURIComponent(rol)}`, {
      signal: ctl.signal, headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.status === 401 || r.status === 403) throw new Error('El servidor no aceptó tu sesión. Vuelve a ingresar con tu contraseña.');
    if (!r.ok) throw new Error(`El servidor respondió ${r.status}.`);
    const j = await r.json();
    if (!j || !j.datasets) throw new Error('El servidor devolvió datos que no entiendo.');
    const guardado = { ...j, descargado: new Date().toISOString() };
    await FileSystem.writeAsStringAsync(archivo(), JSON.stringify(guardado));
    return guardado;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El servidor del comedor no respondió. ¿Estás en la misma red Wi-Fi que la computadora?');
    if (/Network request failed|Failed to fetch/i.test(String(e.message))) throw new Error('No hay conexión con el servidor del comedor. Revisa la dirección en «Servidor» y que estés en la misma red Wi-Fi.');
    throw e;
  } finally { clearTimeout(t); }
}

export const hayRed = async () => { try { const e = await NetInfo.fetch(); return !!e.isConnected; } catch { return false; } };

/** Avisa cada vez que cambia la conexión (true = hay red). Devuelve la función para dejar de escuchar. */
export function alCambiarRed(cb) {
  return NetInfo.addEventListener((e) => cb(!!e.isConnected));
}

export function resumenDatos(snapshot) {
  if (!snapshot) return null;
  const n = Object.values(snapshot.datasets).reduce((s, d) => s + d.filas.length, 0);
  return { registros: n, conjuntos: Object.keys(snapshot.datasets).length, generado: snapshot.generado, descargado: snapshot.descargado };
}
