// Utilidades de texto del motor de reportes (mismo comportamiento que texto.js del navegador y el servidor).

const _acentos = {
  'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e', 'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
  'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u', 'ñ': 'n',
};
final _reAcentos = RegExp('[áàäâéèëêíìïîóòöôúùüûñ]');

String quitarAcentos(String s) => s.replaceAllMapped(_reAcentos, (m) => _acentos[m[0]]!);
String normSimple(Object? t) => quitarAcentos(js(t).toLowerCase().trim());
String escapar(String s) => s.replaceAllMapped(RegExp(r'[.*+?^$(){}|\[\]\\]'), (m) => '\\${m[0]}');

/// Un valor como lo escribiría JavaScript: 5.0 -> «5», 2.5 -> «2.5», null -> «null».
String js(Object? v) {
  if (v is double && v.isFinite && v == v.truncateToDouble() && v.abs() < 1e21) return v.toInt().toString();
  return '$v';
}

/// Ordenación ESTABLE (List.sort de Dart no lo es; el motor depende de que los empates conserven el orden).
List<T> ordenEstable<T>(Iterable<T> items, int Function(T, T) cmp) {
  final l = [for (var i = 0; i < items.length; i++) (i, items.elementAt(i))];
  l.sort((a, b) {
    final c = cmp(a.$2, b.$2);
    return c != 0 ? c : a.$1 - b.$1;
  });
  return [for (final p in l) p.$2];
}

/// Math.round de JavaScript (los .5 suben; Dart redondea los .5 alejándose de cero).
double jsRound(double v) => (v + 0.5).floorToDouble();
