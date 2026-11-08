# App móvil · Reportes del Comedor UAGRM

React Native + Expo. **Solo hace una cosa: generar reportes con IA dentro del teléfono, sin internet**, pidiéndolos por texto o por voz.

- **Ingreso:** usuario y contraseña (cuentas del comedor, Keycloak) y **huella dactilar**. La primera vez necesita internet; después entra sin conexión con la contraseña o con la huella.
- **Reportes:** escribes o dictas «quiero ver fecha, monto y estudiante de los pagos de noviembre, los mayores primero, en Excel». La IA local lo interpreta, consulta los datos guardados en el teléfono y lo entrega en pantalla (tabla + gráfico), **PDF**, **Excel** o **CSV** (menú de compartir).
- **Sin internet de verdad:** el intérprete de español, el motor de consultas y los exportadores corren en el teléfono (`src/reportes`). Los datos se descargan del servidor del comedor cuando hay conexión (`GET /reportes/snapshot`) y se guardan en el teléfono.
- **Voz sin internet:** usa el reconocedor del propio teléfono en modo local (Android: descarga el español para uso sin conexión en Ajustes › Google › Voz).

## Probar en el teléfono

```bash
cd mobile/app-movil
npm install --legacy-peer-deps
npm test                 # 23 pruebas del motor (sin teléfono)
```

**Con Expo Go** (rápido; sin dictado por voz): `npx expo start` y escanear el QR.

**Con la app instalada (development build, recomendado: incluye el dictado):**

```bash
npx expo run:android     # teléfono por USB con depuración activada
```

En la pantalla de ingreso, **Servidor** permite fijar las direcciones:

| Qué | Valor por defecto | Para qué |
|---|---|---|
| Servidor del comedor | `http://32.187.224.152:8080` | gateway de la PC (misma red Wi-Fi): entrega los datos de los reportes |
| Servidor de cuentas | `http://32.187.224.152:8085` | Keycloak: valida usuario y contraseña |

## Registrar la huella

1. Ingresa con tu usuario y contraseña (con internet).
2. La app pregunta «¿Entrar con tu huella?» → **Activar** → pon el dedo.
3. Si el teléfono no tiene huellas registradas, **Ajustes › Ingresar con huella** te lleva a los ajustes del teléfono para registrarla.
4. La próxima vez la app pide la huella apenas se abre, también sin internet.

## Estructura

```
App.js                       arranque, sesión, descarga automática de datos
src/cuenta/                  Keycloak, huella (expo-local-authentication), almacenamiento seguro
src/reportes/                lenguaje.js (español -> consulta), motor.js, exportar.js, catalogo.js
src/pantallas/               Login, Reportes, Ajustes
src/datos.js                 copia de los datos en el teléfono + detección de red
src/voz.js                   dictado en el teléfono (expo-speech-recognition)
src/archivos.js              PDF (expo-print), Excel (SheetJS), CSV y compartir
```
