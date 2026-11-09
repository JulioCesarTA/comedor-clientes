// Colores y estilos de la app (los mismos del portal web del comedor).
import 'package:flutter/material.dart';

class C {
  static const fondo = Color(0xFF0F172A);
  static const tarjeta = Color(0xFF1E293B);
  static const tarjeta2 = Color(0xFF0B1220);
  static const borde = Color(0xFF334155);
  static const texto = Color(0xFFE2E8F0);
  static const suave = Color(0xFF94A3B8);
  static const tenue = Color(0xFF64748B);
  static const naranja = Color(0xFFF97316);
  static const morado = Color(0xFF8B5CF6);
  static const cian = Color(0xFF06B6D4);
  static const verde = Color(0xFF10B981);
  static const rojo = Color(0xFFEF4444);
  static const ambar = Color(0xFFF59E0B);
}


ThemeData temaComedor() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: C.fondo,
    colorScheme: base.colorScheme.copyWith(
      primary: C.naranja, secondary: C.cian, surface: C.tarjeta, error: C.rojo,
    ),
    appBarTheme: const AppBarTheme(backgroundColor: C.fondo, foregroundColor: Colors.white, elevation: 0),
    cardTheme: CardThemeData(
      color: C.tarjeta,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: C.borde)),
      margin: const EdgeInsets.only(bottom: 14),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: C.tarjeta2,
      hintStyle: const TextStyle(color: C.tenue),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: C.borde)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: C.borde)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: C.naranja)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.naranja, foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
      ),
    ),
  );
}

/// Etiqueta en mayúsculas pequeñas que encabeza cada bloque.
class Etiqueta extends StatelessWidget {
  const Etiqueta(this.texto, {super.key, this.arriba = 0});
  final String texto;
  final double arriba;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: arriba, bottom: 6),
        child: Text(texto.toUpperCase(),
            style: const TextStyle(color: C.suave, fontSize: 11, letterSpacing: 0.8, fontWeight: FontWeight.w600)),
      );
}

/// Tarjeta con borde, el contenedor de toda la app.
class Tarjeta extends StatelessWidget {
  const Tarjeta({super.key, required this.hijos, this.titulo});
  final List<Widget> hijos;
  final String? titulo;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (titulo != null) Etiqueta(titulo!),
            ...hijos,
          ]),
        ),
      );
}

/// Chip de selección (filtros, turnos, ejemplos).
class ChipSel extends StatelessWidget {
  const ChipSel({super.key, required this.texto, required this.onTap, this.activo = false});
  final String texto;
  final VoidCallback onTap;
  final bool activo;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: activo ? C.morado.withValues(alpha: 0.25) : C.tarjeta2,
            border: Border.all(color: activo ? C.morado : C.borde),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(texto,
              style: TextStyle(color: activo ? const Color(0xFFDDD6FE) : C.suave, fontSize: 12,
                  fontWeight: activo ? FontWeight.w600 : FontWeight.normal)),
        ),
      );
}

/// Caja de aviso (error, advertencia o éxito).
class Aviso extends StatelessWidget {
  const Aviso(this.texto, {super.key, this.tipo = 'error'});
  final String texto;
  final String tipo; // error | ok | alerta

  @override
  Widget build(BuildContext context) {
    final color = tipo == 'ok' ? C.verde : tipo == 'alerta' ? C.ambar : C.rojo;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(texto, style: TextStyle(color: color, fontSize: 13)),
    );
  }
}
