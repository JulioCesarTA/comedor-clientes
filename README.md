# comedor-clientes

Todo lo que consume la API de los microservicios: gateways, frontends y la app móvil.

| Carpeta | Qué es | Tecnología |
|---|---|---|
| `gateway/api-gateway` | Punto de entrada REST único (valida el JWT de Keycloak y enruta a los 4 microservicios) | Node.js · Express |
| `gateway/graphql-gateway` | GraphQL solo para el back-office | Node.js · Apollo |
| `frontend/shell` | Host de Module Federation: sesión única y navegación | React · Vite |
| `frontend/backoffice-gestion` | Back-office (menú, inventario, caja, comensales, becas, agentes) | Angular |
| `frontend/portal-estudiante` | Portal del estudiante: menú, reservas, pago QR, beca | React · Vite (remote) |
| `frontend/inteligencia-negocio` | Dashboards, predicción y KPI | Next.js |
| `mobile/app-movil` | App móvil de reportes | React Native · Expo |

## Ejecutar

Los frontends y gateways se construyen desde [`comedor-infra`](https://github.com/JulioCesarTA/comedor-infra) con `docker compose`
(ver su README). Cada carpeta tiene su propio `Dockerfile`.

Las URL del servidor (API, Keycloak) se pasan como *build args* (`VITE_API_URL`, `VITE_KEYCLOAK_URL`, `NEXT_PUBLIC_*`); si no se pasan,
usan el mismo host desde el que se abre la página.

## CI

`.github/workflows/ci.yml` construye la imagen Docker de cada gateway y frontend.
