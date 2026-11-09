// Catálogo de datos que el generador de reportes puede consultar. NO se escribe a mano: viaja dentro de la copia de
// datos que entrega el servidor (/reportes/snapshot), así el teléfono y el servidor siempre hablan del mismo catálogo.

class Catalogo {
  static Map<String, dynamic> datasets = {};
  static int version = 0;

  static void cargar(Map<String, dynamic> cat) {
    datasets = cat;
    version++;
  }

  static Map<String, dynamic>? columna(String dataset, String nombre) {
    for (final c in datasets[dataset]['columnas'] as List) {
      if (c['nombre'] == nombre) return c as Map<String, dynamic>;
    }
    return null;
  }

  static String etiqueta(String dataset, String nombre) => (columna(dataset, nombre)?['etiqueta'] as String?) ?? nombre;
}
