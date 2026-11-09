// Ingreso con el patrón del teléfono: se usa la pantalla de bloqueo de Android (el patrón, PIN o clave que la persona
// ya tiene configurado). Nunca muestra el lector de huellas: solo pide el patrón.
import 'package:flutter/services.dart';

class ResultadoBloqueo {
  const ResultadoBloqueo.ok() : ok = true, cancelado = false, motivo = null;
  const ResultadoBloqueo.cancelado() : ok = false, cancelado = true, motivo = null;
  const ResultadoBloqueo.falla(this.motivo) : ok = false, cancelado = false;

  final bool ok;
  final bool cancelado;      // la persona cerró la pantalla: no es un error
  final String? motivo;
}

const _puente = MethodChannel('comedor/sistema');

/// ¿El teléfono tiene un bloqueo de pantalla (patrón, PIN o clave) configurado?
Future<bool> bloqueoDisponible() async {
  try {
    return await _puente.invokeMethod<bool>('hayBloqueo') ?? false;
  } catch (_) {
    return false;
  }
}

/// Muestra la pantalla del patrón. Nunca lanza: devuelve ok, cancelado o el motivo exacto.
Future<ResultadoBloqueo> pedirBloqueo(String razon) async {
  try {
    final r = await _puente.invokeMethod<String>('pedirBloqueo', {'titulo': 'Comedor UAGRM', 'razon': razon});
    switch (r) {
      case 'ok':
        return const ResultadoBloqueo.ok();
      case 'cancelado':
        return const ResultadoBloqueo.cancelado();
      case 'sin_bloqueo':
        return const ResultadoBloqueo.falla('Tu teléfono no tiene un patrón o PIN configurado. Actívalo en Ajustes > Seguridad.');
      case 'en_curso':
        return const ResultadoBloqueo.falla('Ya hay una verificación en curso.');
      default:
        return ResultadoBloqueo.falla('No pude mostrar la pantalla del patrón ($r).');
    }
  } catch (e) {
    return ResultadoBloqueo.falla('No pude usar el patrón del teléfono: $e');
  }
}
