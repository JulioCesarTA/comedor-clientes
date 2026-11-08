// Direcciones de los servidores. Se pueden cambiar desde la pantalla de ingreso (Servidor) sin reinstalar la app.
import Constants from 'expo-constants';

const extra = (Constants.expoConfig && Constants.expoConfig.extra) || {};

export const PREDETERMINADO = {
  api: extra.apiUrl || 'http://32.187.224.152:8080',        // gateway del comedor (clúster EKS)
  keycloak: extra.keycloakUrl || 'http://32.187.224.152:8085', // cuentas y roles
  realm: 'comedor-uagrm',
  clientId: 'app-movil',
};

export const limpiarUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
