// Direcciones de los servidores. Se cambian desde la pantalla de ingreso («Servidor») sin reinstalar la app.
class Config {
  const Config({
    this.api = 'https://44.228.1.64:8080',        // gateway del comedor (clúster EKS)
    this.keycloak = 'https://44.228.1.64:8085',   // cuentas y roles
    this.realm = 'comedor-uagrm',
    this.clientId = 'app-movil',
  });

  final String api;
  final String keycloak;
  final String realm;
  final String clientId;

  Config copiaCon({String? api, String? keycloak}) =>
      Config(api: limpiar(api ?? this.api), keycloak: limpiar(keycloak ?? this.keycloak), realm: realm, clientId: clientId);

  Map<String, dynamic> aJson() => {'api': api, 'keycloak': keycloak};

  static Config deJson(Map<String, dynamic>? j) => j == null
      ? const Config()
      : Config(api: limpiar(j['api'] ?? const Config().api), keycloak: limpiar(j['keycloak'] ?? const Config().keycloak));

  static String limpiar(String u) => u.trim().replaceAll(RegExp(r'/+$'), '');
}
