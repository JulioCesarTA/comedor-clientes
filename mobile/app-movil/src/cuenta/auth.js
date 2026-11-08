// Ingreso con usuario y contraseña (Keycloak). La primera vez necesita internet; después también funciona sin conexión:
// con la huella, o con la contraseña verificada contra una copia protegida guardada en el teléfono.
import * as Crypto from 'expo-crypto';
import { decodificarJwt, perfilDeToken } from './jwt';

export { decodificarJwt, perfilDeToken };

export class ErrorAuth extends Error {
  constructor(tipo, mensaje) { super(mensaje); this.tipo = tipo; }       // tipo: credenciales | red | servidor
}

export const ETIQUETA_ROL = { administrador: 'Administrador', nutricionista: 'Nutricionista', cocina_almacen: 'Cocina y almacén', servicio_caja: 'Caja', estudiante: 'Estudiante' };

// ----------------------------- Keycloak -----------------------------

async function pedirToken(cfg, datos, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${cfg.keycloak}/realms/${cfg.realm}/protocol/openid-connect/token`, {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: Object.entries({ client_id: cfg.clientId, scope: 'openid', ...datos }).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'),
    });
    if (r.status === 400 || r.status === 401) {
      const j = await r.json().catch(() => ({}));
      throw new ErrorAuth('credenciales', j.error === 'invalid_grant' && datos.grant_type === 'refresh_token' ? 'La sesión guardada venció.' : 'Usuario o contraseña incorrectos.');
    }
    if (!r.ok) throw new ErrorAuth('servidor', `El servidor de cuentas respondió ${r.status}.`);
    return await r.json();
  } catch (e) {
    if (e instanceof ErrorAuth) throw e;
    throw new ErrorAuth('red', 'No hay conexión con el servidor de cuentas.');
  } finally { clearTimeout(t); }
}

export async function iniciarSesion(usuario, clave, cfg) {
  const j = await pedirToken(cfg, { grant_type: 'password', username: usuario.trim(), password: clave });
  return { accessToken: j.access_token, refreshToken: j.refresh_token, perfil: perfilDeToken(j.access_token) };
}

export async function renovarSesion(refreshToken, cfg) {
  const j = await pedirToken(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, 10000);
  return { accessToken: j.access_token, refreshToken: j.refresh_token, perfil: perfilDeToken(j.access_token) };
}

// ----------------------------- contraseña local (para ingresar sin internet) -----------------------------

const VUELTAS = 2500;
async function derivar(clave, sal) {
  let h = `${sal}:${clave}`;
  for (let i = 0; i < VUELTAS; i++) h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${i}${h}`);
  return h;
}

export async function crearClaveLocal(usuario, clave) {
  const sal = Array.from(await Crypto.getRandomBytesAsync(16)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { usuario: usuario.trim().toLowerCase(), sal, hash: await derivar(clave, sal) };
}

export async function verificarClaveLocal(guardada, usuario, clave) {
  if (!guardada || guardada.usuario !== usuario.trim().toLowerCase()) return false;
  return (await derivar(clave, guardada.sal)) === guardada.hash;
}
