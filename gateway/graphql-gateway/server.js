// =====================================================================
// GraphQL Gateway — único consumidor: back-office Angular (SPEC §4).
// En vez de federation con subgrafos nativos (los microservicios son REST),
// aquí resolvemos vía axios contra sus endpoints REST.
// =====================================================================
const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const gql = require('graphql-tag');
const axios = require('axios');

const MENU = process.env.MENU_URL || 'http://menu-inventario-service:8080';
const COM = process.env.COMENSALES_URL || 'http://comensales-reservas-service:8080';
const PAG = process.env.PAGOS_URL || 'http://pagos-tickets-service:8080';
const PORT = Number(process.env.PORT || 4000);

const typeDefs = gql`
  type Porcion { platoId: String!, cupo: Int!, apartadas: Int!, disponibles: Int! }
  type Menu { id: ID!, fecha: String!, turno: String!, publicado: Boolean!, porciones: [Porcion!]! }
  type Insumo { id: ID!, nombre: String!, unidad: String!, stockMinimo: Float!, stockTotal: Float }
  type BecaInfo { tieneBeca: Boolean!, tipo: String, cupoRacionesMes: Int, racionesUsadasMes: Int, cubreHoy: Boolean }
  type Reserva { id: ID!, estudianteId: String!, estado: String! }
  type Pago { id: ID!, reservaId: String!, monto: Float!, metodo: String!, estado: String!, ticketId: String }

  type Query {
    menusSemana(turno: String!): [Menu!]!
    menu(id: ID!): Menu
    insumos: [Insumo!]!
    insumosStockBajo: [Insumo!]!
    beca(estudianteId: ID!): BecaInfo!
    pago(id: ID!): Pago
  }

  type Mutation {
    crearReserva(estudianteId: String!, menuId: String!, platoId: String!, fecha: String!, turno: String!): Reserva!
    confirmarReserva(id: ID!): Reserva!
    cobrarRacion(reservaId: String!, estudianteId: String!, monto: Float!, metodo: String!): Pago!
  }
`;

const map = (obj) => ({
  ...obj,
  porciones: obj.porciones
    ? Object.entries(obj.porciones).map(([platoId, p]) => ({ platoId, cupo: p.cupo, apartadas: p.apartadas, disponibles: p.disponibles }))
    : [],
});

const resolvers = {
  Query: {
    menusSemana: async (_p, { turno }) => (await axios.get(`${MENU}/menus/semana/${turno}`)).data.map(map),
    menu: async (_p, { id }) => map((await axios.get(`${MENU}/menus/${id}`)).data),
    insumos: async () => (await axios.get(`${MENU}/insumos`)).data,
    insumosStockBajo: async () => (await axios.get(`${MENU}/insumos/stock-bajo`)).data,
    beca: async (_p, { estudianteId }) => (await axios.get(`${COM}/estudiantes/${estudianteId}/beca`)).data,
    pago: async (_p, { id }) => (await axios.get(`${PAG}/pagos/${id}`)).data,
  },
  Mutation: {
    crearReserva: async (_p, args) => (await axios.post(`${COM}/reservas`, args)).data,
    confirmarReserva: async (_p, { id }) => (await axios.post(`${COM}/reservas/${id}/confirmar`)).data,
    cobrarRacion: async (_p, args) => (await axios.post(`${PAG}/pagos/cobrar`, args)).data,
  },
};

(async () => {
  const server = new ApolloServer({ typeDefs, resolvers, introspection: true });
  const { url } = await startStandaloneServer(server, { listen: { port: PORT } });
  console.log(`[graphql-gateway] 🚀 ${url}`);
})();
