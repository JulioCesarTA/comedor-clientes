// Guarda la cola de «Desperdicio por foto» en el teléfono y habla con el servidor. Es la parte que usa el teléfono de verdad
// (archivos, red, S3); la lógica de la cola está en cola.js.
import * as FileSystem from 'expo-file-system';
import { vacio } from './cola';

const archivo = () => FileSystem.documentDirectory + 'vision.json';
const carpetaFotos = () => FileSystem.documentDirectory + 'fotos-bandejas/';

export async function cargarEstado() {
  try {
    const info = await FileSystem.getInfoAsync(archivo());
    if (!info.exists) return vacio();
    return { ...vacio(), ...JSON.parse(await FileSystem.readAsStringAsync(archivo())) };
  } catch { return vacio(); }
}

export async function guardarEstado(est) {
  try { await FileSystem.writeAsStringAsync(archivo(), JSON.stringify(est)); } catch { /* sin espacio: se reintenta en la próxima acción */ }
}

export async function borrarEstado() {
  try { await FileSystem.deleteAsync(archivo(), { idempotent: true }); await FileSystem.deleteAsync(carpetaFotos(), { idempotent: true }); } catch { /* nada */ }
}

/** Copia la foto a una carpeta que Android no limpia (la caché sí se limpia) y devuelve su nueva ruta. */
export async function conservarFoto(uri, id) {
  try {
    await FileSystem.makeDirectoryAsync(carpetaFotos(), { intermediates: true });
    const destino = `${carpetaFotos()}${id}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: destino });
    return destino;
  } catch { return uri; }
}

/** Funciones de red para sincronizar(): `obtenerToken` renueva la sesión si hace falta. */
export function depsReales({ api, obtenerToken, ms = 30000 }) {
  return {
    async pedir(metodo, ruta, cuerpo) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try {
        const token = obtenerToken ? await obtenerToken() : null;
        const r = await fetch(`${api}${ruta}`, {
          method: metodo, signal: ctl.signal,
          headers: { ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        });
        let json = null;
        try { json = await r.json(); } catch { /* sin cuerpo */ }
        return { estado: r.status, json };
      } catch (e) {
        const err = new Error('Sin conexión con el servidor del comedor.');
        err.red = true;
        throw err;
      } finally { clearTimeout(t); }
    },
    async subirFoto(url, uri, encabezados) {
      try {
        const r = await FileSystem.uploadAsync(url, uri, { httpMethod: 'PUT', headers: encabezados, uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT });
        return r.status >= 200 && r.status < 300;
      } catch (e) {
        const err = new Error('Sin conexión al subir la foto.');
        err.red = true;
        throw err;
      }
    },
  };
}
