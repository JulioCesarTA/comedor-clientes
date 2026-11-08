// Huella dactilar (o rostro) del teléfono: sirve para registrar el ingreso rápido y para entrar sin escribir la contraseña.
import { Linking, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export async function estadoBiometria() {
  try {
    const hardware = await LocalAuthentication.hasHardwareAsync();
    const registrada = hardware ? await LocalAuthentication.isEnrolledAsync() : false;
    const tipos = hardware ? await LocalAuthentication.supportedAuthenticationTypesAsync() : [];
    return {
      hardware, registrada,
      huella: tipos.includes(LocalAuthentication.AuthenticationType.FINGERPRINT),
      rostro: tipos.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION),
    };
  } catch { return { hardware: false, registrada: false, huella: false, rostro: false }; }
}

export async function pedirHuella(mensaje) {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: mensaje, cancelLabel: 'Cancelar', disableDeviceFallback: true, requireConfirmation: false });
    return r.success ? { ok: true } : { ok: false, error: r.error };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

/** Lleva al usuario a registrar su huella en los ajustes del teléfono. */
export async function abrirAjustesDeHuella() {
  try {
    if (Platform.OS === 'android') await Linking.sendIntent('android.settings.SECURITY_SETTINGS');
    else await Linking.openSettings();
  } catch { await Linking.openSettings(); }
}

export const nombreBiometria = (e) => (e.huella ? 'tu huella' : e.rostro ? 'tu rostro' : 'tu huella');
