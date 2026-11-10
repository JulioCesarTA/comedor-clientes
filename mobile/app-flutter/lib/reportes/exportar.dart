// El reporte ya está calculado (IA local): aquí se le da formato de archivo (PDF o Excel) y se guarda en Descargas.
import 'dart:convert';

import 'package:archive/archive.dart';
import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'motor.dart' show fmtValor;

/// «2026-11-08 14:30» -> «08/11/2026 14:30»; si no es fecha, el texto tal cual.
String dmyIso(Object? s) {
  final t = '${s ?? ''}';
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?').firstMatch(t);
  return m == null ? t : '${m[3]}/${m[2]}/${m[1]}${m[4] != null ? ' ${m[4]}' : ''}';
}

/// Texto de una celda: números con el formato del motor (es-BO), fechas como dd/mm/aaaa.
String celdaTexto(Object? v, Object? fmt) => v is num || v == null ? fmtValor(v, fmt) : dmyIso(v);

String _nombreArchivo(String titulo, String ext) {
  final base = titulo.toLowerCase().replaceAll(RegExp(r'[^a-z0-9áéíóúñ ]'), '');
  final slug = base.replaceAll(RegExp(r'\s+'), '-').replaceAll(RegExp(r'-+'), '-');
  final d = DateTime.now();
  String p(int n) => n.toString().padLeft(2, '0');
  final corto = slug.length > 50 ? slug.substring(0, 50) : (slug.isEmpty ? 'reporte' : slug);
  return '$corto-${d.year}${p(d.month)}${p(d.day)}-${p(d.hour)}${p(d.minute)}.$ext';
}

List<Map<String, dynamic>> _lista(Object? l) => [for (final x in (l as List)) Map<String, dynamic>.from(x as Map)];

// ----------------------------- Excel (.xlsx armado a mano: zip + xml) -----------------------------

String _esc(Object? v) => '${v ?? ''}'
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

String _letraCol(int n) {
  var s = '';
  for (var x = n + 1; x > 0; x = (x - 1) ~/ 26) {
    s = String.fromCharCode(65 + (x - 1) % 26) + s;
  }
  return s;
}

List<int> aXlsx(Map<String, dynamic> res) {
  final cols = _lista(res['columnas']);
  final filas = _lista(res['filas']);
  final b = StringBuffer()
    ..write('<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');

  // Cada valor es una celda: los números van como número (Excel puede sumarlos), el resto como texto.
  void fila(int n, List<Object?> valores, {bool negrita = false}) {
    b.write('<row r="$n">');
    for (var i = 0; i < valores.length; i++) {
      final v = valores[i];
      final ref = '${_letraCol(i)}$n';
      if (v is num) {
        b.write('<c r="$ref" s="${negrita ? 1 : 0}"><v>$v</v></c>');
      } else {
        b.write('<c r="$ref" t="inlineStr" s="${negrita ? 1 : 0}"><is><t xml:space="preserve">${_esc(v == null ? '' : dmyIso(v))}</t></is></c>');
      }
    }
    b.write('</row>');
  }

  var n = 1;
  fila(n++, ['${res['titulo']}'], negrita: true);
  fila(n++, [List<String>.from(res['condiciones'] ?? []).join('; ')]);
  fila(n++, ['Generado el ${res['generado']} · ${filas.length} filas']);
  n++;
  fila(n++, [for (final c in cols) c['label']], negrita: true);
  for (final f in filas) {
    fila(n++, [for (final c in cols) f[c['key']]]);
  }
  final totales = res['totales'] as Map?;
  if (totales != null) {
    fila(n++, [for (var i = 0; i < cols.length; i++) i == 0 ? 'TOTAL' : totales[cols[i]['key']]], negrita: true);
  }
  b.write('</sheetData></worksheet>');

  final a = Archive();
  void poner(String nombre, String contenido) {
    final d = utf8.encode(contenido);
    a.addFile(ArchiveFile(nombre, d.length, d));
  }

  poner('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  poner('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  poner('xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      '<sheets><sheet name="Reporte" sheetId="1" r:id="rId1"/></sheets></workbook>');
  poner('xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  poner('xl/styles.xml',
      '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
      '<borders count="1"><border/></borders>'
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
      '<cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/></cellXfs></styleSheet>');
  poner('xl/worksheets/sheet1.xml', b.toString());
  return ZipEncoder().encode(a);
}

// ----------------------------- PDF -----------------------------

Future<List<int>> aPdf(Map<String, dynamic> res) async {
  final cols = _lista(res['columnas']);
  final filas = _lista(res['filas']);
  final doc = pw.Document();
  doc.addPage(pw.MultiPage(
    maxPages: 1000, // por defecto corta en 20 páginas y un reporte de un mes entero no entraba
    pageFormat: cols.length > 5 ? PdfPageFormat.a4.landscape : PdfPageFormat.a4,
    margin: const pw.EdgeInsets.all(28),
    build: (ctx) => [
      pw.Text('${res['titulo']}', style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold)),
      pw.Text('Comedor Universitario UAGRM · generado el ${res['generado']}',
          style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
      if ((res['condiciones'] as List?)?.isNotEmpty ?? false)
        pw.Text('Condiciones: ${List<String>.from(res['condiciones']).join('; ')}',
            style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
      pw.SizedBox(height: 8),
      for (final l in List<String>.from(res['resumen'] ?? [])) pw.Bullet(text: l, style: const pw.TextStyle(fontSize: 10)),
      pw.SizedBox(height: 10),
      pw.TableHelper.fromTextArray(
        headers: [for (final c in cols) '${c['label']}'],
        data: [
          for (final f in filas) [for (final c in cols) celdaTexto(f[c['key']], c['fmt'])],
          if (res['totales'] != null)
            [for (var i = 0; i < cols.length; i++) i == 0 ? 'TOTAL' : celdaTexto((res['totales'] as Map)[cols[i]['key']], cols[i]['fmt'])],
        ],
        headerStyle: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: PdfColors.white),
        headerDecoration: const pw.BoxDecoration(color: PdfColors.blueGrey800),
        cellStyle: const pw.TextStyle(fontSize: 8.5),
        cellAlignments: {for (var i = 0; i < cols.length; i++) i: cols[i]['tipo'] == 'numero' ? pw.Alignment.centerRight : pw.Alignment.centerLeft},
        oddRowDecoration: const pw.BoxDecoration(color: PdfColors.grey100),
      ),
    ],
  ));
  return doc.save();
}

// ----------------------------- descargar -----------------------------

const _sistema = MethodChannel('comedor/sistema');

/// Genera el PDF o el Excel, lo guarda en «Descargas» del teléfono y lo abre. Devuelve dónde quedó.
Future<String> descargarReporte(Map<String, dynamic> res, String formato) async {
  final excel = formato == 'excel';
  final bytes = excel ? aXlsx(res) : await aPdf(res);
  final donde = await _sistema.invokeMethod<String>('guardarDescarga', {
    'nombre': _nombreArchivo('${res['titulo']}', excel ? 'xlsx' : 'pdf'),
    'mime': excel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
    'bytes': Uint8List.fromList(bytes),
  });
  if (donde == null) throw Exception('el teléfono no dejó guardar el archivo');
  return donde;
}
