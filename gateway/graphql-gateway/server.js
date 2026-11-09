// =====================================================================
// Gateway de Apollo Federation — único consumidor: el back-office Angular (SPEC §4).
// No tiene esquema ni lógica propios: compone los subgrafos del núcleo del negocio (menú/inventario,
// comensales/reservas y pagos) y reparte cada consulta entre ellos. Cuentas y agentes de IA van por REST.
// =====================================================================
const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { ApolloGateway, IntrospectAndCompose, RemoteGraphQLDataSource } = require('@apollo/gateway');

const PORT = Number(process.env.PORT || 4000);

const SUBGRAFOS = [
  { name: 'menu', url: `${process.env.MENU_URL || 'http://menu-inventario-service:8080'}/graphql` },
  { name: 'comensales', url: `${process.env.COMENSALES_URL || 'http://comensales-reservas-service:8080'}/graphql` },
  { name: 'pagos', url: `${process.env.PAGOS_URL || 'http://pagos-tickets-service:8080'}/graphql` },
];

// Cada subgrafo recibe el token de quien hizo la consulta.
class SubgrafoConToken extends RemoteGraphQLDataSource {
  willSendRequest({ request, context }) {
    if (context.auth) request.http.headers.set('authorization', context.auth);
  }
}

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({ subgraphs: SUBGRAFOS, pollIntervalInMs: 60000 }),
  buildService: ({ url }) => new SubgrafoConToken({ url }),
});

startStandaloneServer(new ApolloServer({ gateway, introspection: true }), {
  listen: { port: PORT },
  context: async ({ req }) => ({ auth: req.headers.authorization || '' }),
}).then(({ url }) => {
  console.log(`[graphql-gateway] supergrafo compuesto (${SUBGRAFOS.map((s) => s.name).join(', ')}) en ${url}`);
}).catch((e) => {
  // Sin un subgrafo no se puede componer: se sale para que Kubernetes reintente.
  console.error('[graphql-gateway] no se pudo componer el supergrafo:', e.message);
  process.exit(1);
});
