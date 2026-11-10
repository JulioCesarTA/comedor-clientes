// =====================================================================
// Comedor UAGRM — API Gateway REST.
// Valida JWT (Keycloak OIDC) y enruta a los 4 microservicios.
// =====================================================================
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const cors = require('cors');
const morgan = require('morgan');

const PORT = Number(process.env.PORT || 8080);
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const REALM = process.env.KEYCLOAK_REALM || 'comedor-uagrm';
const JWKS_URI = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/certs`;

const MENU_URL = process.env.MENU_URL || 'http://menu-inventario-service:8080';
const COMENSALES_URL = process.env.COMENSALES_URL || 'http://comensales-reservas-service:8080';
const PAGOS_URL = process.env.PAGOS_URL || 'http://pagos-tickets-service:8080';
const IA_URL = process.env.IA_URL || 'http://ia-ml-service:8080';
const GRAPHQL_URL = process.env.GRAPHQL_URL || 'http://graphql-gateway:4000';

const client = jwksClient({ jwksUri: JWKS_URI, cache: true, rateLimit: true });

function getKey(header, cb) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return cb(err);
    cb(null, key.getPublicKey());
  });
}

function requireAuth(req, res, next) {
  if (process.env.AUTH_DISABLED === 'true') return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no token' });
  jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'token inválido', detail: err.message });
    req.user = decoded;
    next();
  });
}

const app = express();
app.use(morgan('tiny'));
app.use(cors());

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'api-gateway' }));

// ---------------------------------------------------------------------
// Alta de usuarios (cuenta Keycloak + rol). Solo administradores.
// POST /usuarios { rol, username?, registroUniv?, nombre, email?, telefono?, password }
// rol: administrador | estudiante | cocinero (→ cocina_almacen)
// ---------------------------------------------------------------------
const ROLES_ALTA = { administrador: 'administrador', estudiante: 'estudiante', cocinero: 'cocina_almacen' };
const KC_ADMIN = process.env.KEYCLOAK_ADMIN || 'admin';
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';

async function kcAdmin(path, token, init = {}) {
  return fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

async function crearUsuario(req, res) {
  if (process.env.AUTH_DISABLED !== 'true') {
    const roles = req.user?.realm_access?.roles || [];
    if (!roles.includes('administrador')) return res.status(403).json({ error: 'Solo un administrador puede crear usuarios' });
  }
  const b = req.body || {};
  const rolKc = ROLES_ALTA[b.rol];
  if (!rolKc) return res.status(400).json({ error: 'Rol inválido (administrador, estudiante o cocinero)' });
  const username = String((b.rol === 'estudiante' ? b.registroUniv : b.username) || '').trim();
  const nombre = String(b.nombre || '').trim();
  if (!username || !nombre) return res.status(400).json({ error: 'Faltan usuario/matrícula y nombre' });
  if (!/^[\w.@-]{3,60}$/.test(username)) return res.status(400).json({ error: 'Usuario inválido (3-60 caracteres: letras, números, . _ - @)' });
  if (String(b.password || '').length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const email = String(b.email || '').trim() || `${username}@uagrm.edu.bo`;
  const [firstName, ...resto] = nombre.split(/\s+/);

  let token, userId;
  try {
    const t = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: KC_ADMIN, password: KC_ADMIN_PASSWORD }),
    });
    if (!t.ok) return res.status(502).json({ error: 'No se pudo autenticar con Keycloak (admin)' });
    token = (await t.json()).access_token;

    const c = await kcAdmin('/users', token, {
      method: 'POST',
      body: JSON.stringify({
        username, email, firstName, lastName: resto.join(' ') || firstName, enabled: true, emailVerified: true,
        credentials: [{ type: 'password', value: b.password, temporary: false }],
      }),
    });
    if (c.status === 409) return res.status(409).json({ error: `Ya existe un usuario o correo «${username}»` });
    if (!c.ok) return res.status(502).json({ error: 'Keycloak rechazó el alta', detail: await c.text() });
    userId = c.headers.get('location').split('/').pop();

    const r = await kcAdmin(`/roles/${rolKc}`, token);
    if (!r.ok) throw new Error(`El rol ${rolKc} no existe en Keycloak`);
    const m = await kcAdmin(`/users/${userId}/role-mappings/realm`, token, { method: 'POST', body: JSON.stringify([await r.json()]) });
    if (!m.ok) throw new Error('No se pudo asignar el rol');

    if (b.rol === 'estudiante') {
      const e = await fetch(`${COMENSALES_URL}/estudiantes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registroUniv: username, nombre, email, telefono: b.telefono }),
      });
      if (!e.ok) throw new Error('No se pudo registrar el estudiante');
    }
    res.status(201).json({ ok: true, username, rol: b.rol });
  } catch (err) {
    // Deshacer la cuenta para no dejar usuarios a medias.
    if (userId) await kcAdmin(`/users/${userId}`, token, { method: 'DELETE' }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
}
app.post('/usuarios', requireAuth, express.json(), crearUsuario);

// GET /usuarios → cuentas de Keycloak con su(s) rol(es): [{ username, nombre, email, enabled, roles[] }]
const ROL_ETIQUETA = { administrador: 'administrador', cocina_almacen: 'cocinero', estudiante: 'estudiante', servicio_caja: 'caja', nutricionista: 'nutricionista' };
app.get('/usuarios', requireAuth, async (req, res) => {
  if (process.env.AUTH_DISABLED !== 'true') {
    const roles = req.user?.realm_access?.roles || [];
    if (!roles.includes('administrador')) return res.status(403).json({ error: 'Solo un administrador puede listar usuarios' });
  }
  try {
    const t = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: KC_ADMIN, password: KC_ADMIN_PASSWORD }),
    });
    if (!t.ok) return res.status(502).json({ error: 'No se pudo autenticar con Keycloak (admin)' });
    const token = (await t.json()).access_token;
    const usuarios = await (await kcAdmin('/users?max=1000', token)).json();
    const rolesDe = new Map();
    for (const [kc, etiqueta] of Object.entries(ROL_ETIQUETA)) {
      const r = await kcAdmin(`/roles/${kc}/users?max=1000`, token);
      if (!r.ok) continue;
      for (const u of await r.json()) rolesDe.set(u.id, [...(rolesDe.get(u.id) || []), etiqueta]);
    }
    res.json(usuarios.map(u => ({
      username: u.username,
      nombre: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
      email: u.email || '', enabled: u.enabled, roles: rolesDe.get(u.id) || [],
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// En http-proxy-middleware v3 usamos pathFilter: así el request completo (/menus/semana/...)
// llega sin que express.use lo recorte y Spring Boot lo matchea bien.
// `onProxyReq` fija cabeceras en la petición YA saliente: mutar `req.headers` antes no basta,
// porque esta versión arma la petición al servicio por su cuenta y no siempre la recoge
// (se vio en vivo: el gateway nunca mandaba x-roles/x-usuario a /asistencia/lugar).
const proxyAll = (patterns, target, onProxyReq) => createProxyMiddleware({
  pathFilter: patterns,
  target,
  changeOrigin: true,
  on: onProxyReq ? { proxyReq: onProxyReq } : undefined,
});

/** Cabeceras con quién es y qué rol tiene, según el token verificado (el cliente no puede fijarlas). */
const conUsuarioYRoles = (proxyReq, req) => {
  if (!req.user) return;
  proxyReq.setHeader('x-roles', (req.user.realm_access?.roles || []).join(','));
  proxyReq.setHeader('x-usuario', req.user.preferred_username || '');
};

// Núcleo del negocio del back-office (SPEC §4): /graphql va al gateway federado, con el mismo control de token.
app.use(requireAuth, proxyAll(['/graphql'], GRAPHQL_URL));
app.use(requireAuth, proxyAll(['/menus/**', '/insumos/**'], MENU_URL));
// Asistencia: quién es y qué rol tiene salen del token (solo el administrador cambia la ubicación del comedor).
app.use(requireAuth, proxyAll(['/reservas/**', '/estudiantes/**', '/ingreso/**', '/asistencia/**'], COMENSALES_URL, conUsuarioYRoles));
app.use(requireAuth, proxyAll(['/pagos/**', '/facturas/**'], PAGOS_URL));
// El rol sale del token (no del cliente): el servicio de IA lo usa para decidir qué datos entrega a los reportes.
app.use(requireAuth, proxyAll(['/ml/**', '/agentes/**', '/reportes/**', '/sagas/**'], IA_URL, conUsuarioYRoles));

app.listen(PORT, () => console.log(`[api-gateway] listo en :${PORT}`));
