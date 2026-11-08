// Lectura del token de Keycloak (JWT) para saber quién es el usuario y qué rol tiene. Sin librerías: funciona en el teléfono sin internet.
const ROLES = ['administrador', 'nutricionista', 'cocina_almacen', 'servicio_caja', 'estudiante'];
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64aTexto(b64) {
  const limpio = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = [];
  for (let i = 0; i < limpio.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => (i + k < limpio.length ? ABC.indexOf(limpio[i + k]) : 0));
    const v = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3];
    bytes.push((v >> 16) & 255);
    if (i + 2 < limpio.length) bytes.push((v >> 8) & 255);
    if (i + 3 < limpio.length) bytes.push(v & 255);
  }
  return decodeURIComponent(bytes.map((b) => '%' + b.toString(16).padStart(2, '0')).join(''));   // UTF-8 (nombres con tildes)
}

function decodificarJwt(token) {
  return JSON.parse(base64aTexto(String(token).split('.')[1]));
}

function perfilDeToken(token) {
  const p = decodificarJwt(token);
  const roles = ((p.realm_access && p.realm_access.roles) || []).filter((r) => ROLES.includes(r));
  return {
    usuario: p.preferred_username || '', nombre: p.name || p.preferred_username || '', email: p.email || '',
    roles, rol: ROLES.find((r) => roles.includes(r)) || 'estudiante',
  };
}

module.exports = { decodificarJwt, perfilDeToken, base64aTexto };
