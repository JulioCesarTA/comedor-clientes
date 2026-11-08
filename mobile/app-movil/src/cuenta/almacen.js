// Almacenamiento seguro del teléfono (Keychain / Keystore): perfil, ingreso con huella y datos de la sesión.
import * as SecureStore from 'expo-secure-store';

const CLAVES = { perfil: 'perfil', refresh: 'refresh_token', bio: 'bio_activa', clave: 'clave_local', cfg: 'config_servidor', historial: 'historial' };

export async function leer(k, defecto = null) {
  try {
    const v = await SecureStore.getItemAsync(CLAVES[k]);
    return v === null ? defecto : JSON.parse(v);
  } catch { return defecto; }
}
export async function guardar(k, v) { await SecureStore.setItemAsync(CLAVES[k], JSON.stringify(v)); }
export async function borrar(k) { try { await SecureStore.deleteItemAsync(CLAVES[k]); } catch { /* nada que borrar */ } }
