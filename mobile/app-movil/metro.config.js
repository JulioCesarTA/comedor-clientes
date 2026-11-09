// Metro (empaquetador de la app): el modelo de TensorFlow Lite viaja dentro de la app como archivo (assets/modelos/*.tflite).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('tflite');

module.exports = config;
