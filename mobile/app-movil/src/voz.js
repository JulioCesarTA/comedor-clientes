// Dictado en el teléfono, sin internet: usa el reconocedor de voz del propio dispositivo (en modo local).
// Android: necesita el idioma español descargado para uso sin conexión (Ajustes > Google > Voz). iOS: reconocimiento en el dispositivo.
// Requiere la app instalada con `expo run:android` (development build): en Expo Go el dictado no está disponible.
let SR = null;
try { SR = require('expo-speech-recognition'); } catch { SR = null; }

const modulo = SR && SR.ExpoSpeechRecognitionModule;
export const vozDisponible = () => !!modulo && !!modulo.isRecognitionAvailable && modulo.isRecognitionAvailable();

// Hook estable: si el módulo no existe (Expo Go) se convierte en un no-hacer-nada, siempre el mismo en toda la ejecución.
export const useEventoVoz = SR && SR.useSpeechRecognitionEvent ? SR.useSpeechRecognitionEvent : () => {};

const VOCABULARIO = ['reservas', 'pagos', 'estudiantes', 'becas', 'menús', 'insumos', 'desperdicio', 'monto', 'turno', 'plato', 'ascendente', 'descendente',
  'por mes', 'por semana', 'por día', 'noviembre', 'octubre', 'diciembre', 'en PDF', 'en Excel', 'los mayores', 'los menores', 'últimos treinta días', 'este mes', 'mes pasado'];

export async function iniciarDictado() {
  if (!modulo) throw new Error('El dictado necesita la app instalada con `expo run:android` (no funciona en Expo Go).');
  const permiso = await modulo.requestPermissionsAsync();
  if (!permiso.granted) throw new Error('Permite el uso del micrófono para dictar.');
  const local = modulo.supportsOnDeviceRecognition ? modulo.supportsOnDeviceRecognition() : false;
  modulo.start({
    lang: 'es-ES', interimResults: true, continuous: false, maxAlternatives: 1, contextualStrings: VOCABULARIO,
    requiresOnDeviceRecognition: local,            // sin internet cuando el teléfono lo soporta
    androidIntentOptions: { EXTRA_PREFER_OFFLINE: true },
  });
  return { local };
}

export const detenerDictado = () => { if (modulo) modulo.stop(); };
export const cancelarDictado = () => { if (modulo) modulo.abort(); };

export function mensajeErrorVoz(ev) {
  switch (ev && ev.error) {
    case 'language-not-supported': return 'Falta el idioma español sin conexión. Descárgalo en Ajustes > Aplicaciones > Google > Voz > Reconocimiento sin conexión.';
    case 'not-allowed': case 'service-not-allowed': return 'Permite el micrófono y el reconocimiento de voz para esta app.';
    case 'no-speech': case 'speech-timeout': return 'No se escuchó nada. Habla cerca del micrófono e inténtalo otra vez.';
    case 'audio-capture': return 'No pude usar el micrófono.';
    case 'network': return 'El reconocimiento de voz de este teléfono necesita internet. Descarga el español sin conexión en los ajustes de voz de Google.';
    case 'aborted': return '';
    default: return (ev && ev.message) || 'No pude entender el audio.';
  }
}
