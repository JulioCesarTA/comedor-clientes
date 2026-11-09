// Fechas como DateTime UTC a medianoche: sin sorpresas de zona horaria al sumar días o comparar.
const mesesN = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const diasN = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

DateTime fecha(int y, int m, int d) => DateTime.utc(y, m, d); // m: 1..12 (los desbordes se normalizan, igual que Date.UTC)
DateTime hoyLocal() {
  final n = DateTime.now();
  return DateTime.utc(n.year, n.month, n.day);
}

String _dos(int n) => n.toString().padLeft(2, '0');
String iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${_dos(d.month)}-${_dos(d.day)}';
DateTime desdeIso(Object? s) {
  final p = '$s'.substring(0, '$s'.length < 10 ? '$s'.length : 10).split('-').map((x) => int.tryParse(x) ?? 0).toList();
  return fecha(p[0], p[1], p[2]);
}

DateTime sumarDias(DateTime d, int n) => d.add(Duration(days: n));
int diasEnMes(int y, int m) => DateTime.utc(y, m + 1, 0).day;
int diaSemana(DateTime d) => d.weekday - 1; // lunes = 0
DateTime lunesDe(DateTime d) => sumarDias(d, -diaSemana(d));
DateTime finMes(int y, int m) => fecha(y, m, diasEnMes(y, m));
String dmy(DateTime d) => '${_dos(d.day)}/${_dos(d.month)}/${d.year}';
