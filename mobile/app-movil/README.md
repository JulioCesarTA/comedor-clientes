# App móvil · Comedor UAGRM (IA dentro del teléfono)

React Native + Expo. **La IA corre en el teléfono, sin internet.** Menú lateral (☰) con:

- **Reportes:** escribes o dictas «quiero ver fecha, monto y estudiante de los pagos de noviembre, los mayores primero, en Excel». El intérprete de español local lo convierte en una consulta sobre los datos guardados en el teléfono y lo entrega en pantalla (tabla + gráfico), **PDF**, **Excel** o **CSV**. Voz sin internet con el reconocedor del propio teléfono (Android: descarga el español en Ajustes › Google › Voz).
- **Desperdicio por foto** (personal del comedor): fotografías la porción completa de un plato (referencia) y luego las bandejas devueltas; una red convolucional **TensorFlow Lite** (MobileNetV2, 80 KB, dentro de la app) estima qué % de la comida quedó. **Todo el análisis es local**; los resultados y las fotos se envían cuando hay red (fotos a un bucket **S3 de AWS**, sin duplicados aunque se reintente).
- **Ajustes:** cuenta, huella y direcciones del servidor.
- **Ingreso:** usuario y contraseña (cuentas del comedor, Keycloak) y **huella dactilar**. La primera vez necesita internet; después entra sin conexión.

Los datos de los reportes se descargan del servidor cuando hay conexión (`GET /reportes/snapshot`, por rol) y se guardan en el teléfono.

## Probar en el teléfono

```bash
cd mobile/app-movil
npm install --legacy-peer-deps
npm test                 # 36 pruebas (motor de reportes, cola de sincronización y paridad con el servidor); sin teléfono
```

**Con Expo Go** (rápido; sin dictado por voz): `npx expo start` y escanear el QR.

**Con la app instalada (development build). Es OBLIGATORIO para el dictado y para TensorFlow Lite (no corren en Expo Go):**

```bash
npx expo run:android     # teléfono por USB con depuración activada
```

En la pantalla de ingreso, **Servidor** permite fijar las direcciones:

| Qué | Valor por defecto | Para qué |
|---|---|---|
| Servidor del comedor | `https://44.228.1.64:8080` | gateway (EKS): datos de los reportes y «Desperdicio por foto» |
| Servidor de cuentas | `https://44.228.1.64:8085` | Keycloak: valida usuario y contraseña |

## Registrar la huella

1. Ingresa con tu usuario y contraseña (con internet).
2. La app pregunta «¿Entrar con tu huella?» → **Activar** → pon el dedo.
3. Si el teléfono no tiene huellas registradas, **Ajustes › Ingresar con huella** te lleva a los ajustes del teléfono para registrarla.
4. La próxima vez la app pide la huella apenas se abre, también sin internet.

## Desperdicio por foto: cómo funciona

```
foto 224x224 ──TFLite (MobileNetV2 hasta block_3_expand_relu)──▶ 56x56 zonas × 144 características (+ color)
referencia  = foto de la porción completa → separa COMIDA (más color y textura) del plato → 4 prototipos de cada tipo (k-means)
bandeja     = cada zona se clasifica por su prototipo más parecido → área de comida / área de la referencia = % que quedó
```

- `src/vision/analisis.js` es el mismo método del servidor (`ia-ml-service/.../vision.py`) en JS puro. `__tests__/paridad.test.js` comprueba que, con las mismas fotos, el teléfono da el mismo resultado que el servidor (en las fotos de prueba: 71,1 % ambos).
- El modelo se genera con `python herramientas/convertir_modelo.py` (necesita TensorFlow) y viaja en `assets/modelos/`. `python herramientas/generar_paridad.py` regenera los datos de la prueba de paridad.
- Sin internet todo funciona: se pueden crear referencias y analizar bandejas. Al volver la red (`src/vision/cola.js`): primero se bajan las referencias del servidor (`/ml/vision/paquete-movil`), luego se envían las referencias y las bandejas hechas en el teléfono. Cada registro lleva un id único: reenviar no duplica. La foto se sube directo a S3 con una URL temporal (`/ml/vision/subida`); el teléfono no lleva claves de AWS.
- Estimación por área visible: funciona mejor con fotos desde arriba, misma cámara y buena luz.

## Estructura

```
App.js                       arranque, sesión, menú lateral, descarga automática de datos
src/cuenta/                  Keycloak, huella (expo-local-authentication), almacenamiento seguro
src/componentes/Menu.js      menú lateral (☰) según el rol
src/reportes/                lenguaje.js (español -> consulta), motor.js, exportar.js, catalogo.js
src/vision/                  analisis.js (método), modelo.js (TFLite), imagen.js, cola.js (sync sin duplicados), almacenVision.js
src/pantallas/               Login, Reportes, Desperdicio, Ajustes
src/datos.js                 copia de los datos en el teléfono + detección de red
src/voz.js                   dictado en el teléfono (expo-speech-recognition)
src/archivos.js              PDF (expo-print), Excel (SheetJS), CSV y compartir
assets/modelos/              bandeja_mobilenetv2_b3.tflite (TensorFlow Lite)
herramientas/                convertir_modelo.py, generar_paridad.py
```
