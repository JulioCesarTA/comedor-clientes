// Direcciones de los servidores. Se pueden cambiar desde la pantalla de ingreso (Servidor) sin reinstalar la app.
import Constants from 'expo-constants';

const extra = (Constants.expoConfig && Constants.expoConfig.extra) || {};

export const PREDETERMINADO = {
  api: extra.apiUrl || 'https://44.228.1.64:8080',        // gateway del comedor (clúster EKS)
  keycloak: extra.keycloakUrl || 'https://44.228.1.64:8085', // cuentas y roles
  realm: 'comedor-uagrm',
  clientId: 'app-movil',
};

export const limpiarUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
