// =====================================================================
// GraphQL Gateway — único consumidor: el back-office Angular (SPEC §4).
// El navegador llama a POST /graphql en el api-gateway (que valida el token) y llega aquí.
// Los microservicios son REST: cada resolver llama a su endpoint y devuelve el tipo GraphQL.
// =====================================================================
const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { GraphQLError, GraphQLScalarType, valueFromASTUntyped } = require('graphql');
const gql = require('graphql-tag');
const axios = require('axios');

const MENU = process.env.MENU_URL || 'http://menu-inventario-service:8080';
const COM = process.env.COMENSALES_URL || 'http://comensales-reservas-service:8080';
const IA = process.env.IA_URL || 'http://ia-ml-service:8080';
const API = process.env.API_GATEWAY_URL || 'http://api-gateway:8080';     // cuentas de Keycloak (/usuarios)
const PORT = Number(process.env.PORT || 4000);

const typeDefs = gql`
  "Objeto libre (resultados de los agentes de IA, horarios, propuestas)"
  scalar JSON

  type Porcion { platoId: String!, cupo: Int!, apartadas: Int!, disponibles: Int! }
  type Menu { id: ID!, fecha: String!, turno: String!, publicado: Boolean!, porciones: [Porcion!]! }

  type Lote { loteId: String!, cantidad: Float!, unidad: String, vence: String }
  type Insumo { id: ID!, nombre: String!, unidad: String!, stockMinimo: Float!, stockTotal: Float!, lotes: [Lote!]! }

  type Beca {
    tieneBeca: Boolean!, tipo: String, cupoRacionesMes: Int, racionesUsadasMes: Int, cubreHoy: Boolean,
    vigenteDesde: String, vigenteHasta: String
  }
  type Estudiante { id: ID!, registroUniv: String!, nombre: String!, email: String, telefono: String, beca: Beca! }
  type Usuario { username: String!, nombre: String, email: String, enabled: Boolean, roles: [String!]! }
  type ValidacionQr { ok: Boolean!, motivo: String, reservaId: String }

  type Query {
    menusSemana(turno: String!): [Menu!]!
    insumos: [Insumo!]!
    estudiantes: [Estudiante!]!
    beca(estudianteId: ID!): Beca!
    usuarios: [Usuario!]!
    propuestas: JSON!
    telegram: JSON!
    horarios: JSON!
    paqueteOffline: JSON!
  }

  input PlatoIn { platoId: String!, cupo: Int! }
  input UsuarioIn {
    rol: String!, registroUniv: String, username: String, nombre: String!, email: String, telefono: String, password: String!
  }

  type Mutation {
    publicarMenu(fecha: String!, turno: String!, platos: [PlatoIn!]!): JSON
    crearInsumo(id: ID!, nombre: String!, unidad: String!, stockMinimo: Float!): JSON
    registrarLote(insumoId: ID!, loteId: String!, cantidad: Float!, unidad: String!, vence: String!): JSON
    crearUsuario(datos: UsuarioIn!): JSON
    asignarBeca(estudianteId: ID!, tipo: String!, mesesVigencia: Int!): JSON
    validarQr(qr: String!): ValidacionQr!
    ejecutarAgente(agente: String!, objetivo: String!): JSON!
    decidirPropuesta(id: ID!, aprobar: Boolean!): JSON!
    sincronizarPropuestas(items: JSON!): JSON!
    guardarHorario(agente: String!, horario: JSON!): JSON!
  }
`;

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral: (ast, vars) => valueFromASTUntyped(ast, vars),
});

// Llama al microservicio con el token de quien pidió. Si falla, el motivo real llega al navegador.
async function rest(ctx, method, url, data, timeout = 30000) {
  try {
    const r = await axios({ method, url, data, timeout, headers: ctx.auth ? { Authorization: ctx.auth } : {} });
    return r.data;
  } catch (e) {
    const d = e.response?.data;
    const motivo = (d && (d.detail || d.message || d.error)) || e.message;
    throw new GraphQLError(Array.isArray(motivo) ? motivo.join(' ') : String(motivo),
      { extensions: { code: 'SERVICIO', status: e.response?.status || 503 } });
  }
}

const AGENTES = ['monitor-comedor', 'planificador-menu', 'inventario-compras'];

const resolvers = {
  JSON: JSONScalar,
  Menu: {
    porciones: (m) => Object.entries(m.porciones || {}).map(([platoId, p]) => ({ platoId, ...p })),
  },
  Insumo: {
    lotes: (i) => (i.lotes || []).map((l) => ({
      loteId: l.loteId, cantidad: l.cantidad?.valor ?? 0, unidad: l.cantidad?.unidad, vence: l.vencimiento?.fecha,
    })),
    stockTotal: (i) => (i.lotes || []).reduce((s, l) => s + (l.cantidad?.valor || 0), 0),
  },
  Estudiante: {
    beca: (e, _a, ctx) => rest(ctx, 'get', `${COM}/estudiantes/${e.id}/beca`).catch(() => ({ tieneBeca: false })),
  },
  Query: {
    menusSemana: (_p, { turno }, ctx) => rest(ctx, 'get', `${MENU}/menus/semana/${turno}`),
    insumos: (_p, _a, ctx) => rest(ctx, 'get', `${MENU}/insumos`),
    estudiantes: (_p, _a, ctx) => rest(ctx, 'get', `${COM}/estudiantes`),
    beca: (_p, { estudianteId }, ctx) => rest(ctx, 'get', `${COM}/estudiantes/${estudianteId}/beca`),
    usuarios: (_p, _a, ctx) => rest(ctx, 'get', `${API}/usuarios`),
    propuestas: (_p, _a, ctx) => rest(ctx, 'get', `${IA}/agentes/propuestas`),
    telegram: (_p, _a, ctx) => rest(ctx, 'get', `${IA}/agentes/telegram`),
    horarios: (_p, _a, ctx) => rest(ctx, 'get', `${IA}/agentes/horarios`),
    paqueteOffline: (_p, _a, ctx) => rest(ctx, 'get', `${IA}/agentes/paquete-offline`, undefined, 60000),
  },
  Mutation: {
    publicarMenu: (_p, args, ctx) => rest(ctx, 'post', `${MENU}/menus`, args),
    crearInsumo: (_p, args, ctx) => rest(ctx, 'post', `${MENU}/insumos`, args),
    registrarLote: (_p, args, ctx) => rest(ctx, 'post', `${MENU}/insumos/lotes`, args),
    crearUsuario: (_p, { datos }, ctx) => rest(ctx, 'post', `${API}/usuarios`, datos),
    asignarBeca: (_p, { estudianteId, tipo, mesesVigencia }, ctx) =>
      rest(ctx, 'post', `${COM}/estudiantes/${estudianteId}/beca`, { tipo, mesesVigencia }),
    validarQr: (_p, { qr }, ctx) => rest(ctx, 'post', `${COM}/ingreso/validar-qr`, { qr }),
    ejecutarAgente: (_p, { agente, objetivo }, ctx) => {
      if (!AGENTES.includes(agente)) throw new GraphQLError(`Agente desconocido: ${agente}`);
      return rest(ctx, 'post', `${IA}/agentes/${agente}`, { objetivo, contexto: {} }, 120000);
    },
    decidirPropuesta: (_p, { id, aprobar }, ctx) =>
      rest(ctx, 'post', `${IA}/agentes/propuestas/${id}/${aprobar ? 'aprobar' : 'rechazar'}`, {}, 60000),
    sincronizarPropuestas: (_p, { items }, ctx) => rest(ctx, 'post', `${IA}/agentes/propuestas/sincronizar`, items, 60000),
    guardarHorario: (_p, { agente, horario }, ctx) => {
      if (!AGENTES.includes(agente)) throw new GraphQLError(`Agente desconocido: ${agente}`);
      return rest(ctx, 'put', `${IA}/agentes/horarios/${agente}`, horario);
    },
  },
};

(async () => {
  const server = new ApolloServer({ typeDefs, resolvers, introspection: true });
  const { url } = await startStandaloneServer(server, {
    listen: { port: PORT },
    context: async ({ req }) => ({ auth: req.headers.authorization || '' }),
  });
  console.log(`[graphql-gateway] listo en ${url}`);
})();
