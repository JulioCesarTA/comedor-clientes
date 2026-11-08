// Genera el PDF, Excel o CSV dentro del teléfono y abre el menú de compartir (WhatsApp, correo, Drive, guardar...).
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { aCsv, aHtml, aXlsxBase64, nombreArchivo } from './reportes/exportar';

const TIPOS = {
  pdf: { ext: 'pdf', mime: 'application/pdf', uti: 'com.adobe.pdf' },
  excel: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', uti: 'org.openxmlformats.spreadsheetml.sheet' },
  csv: { ext: 'csv', mime: 'text/csv', uti: 'public.comma-separated-values-text' },
};

export async function exportarReporte(res, formato) {
  const tipo = TIPOS[formato];
  if (!tipo) throw new Error('Formato no soportado');
  const destino = FileSystem.cacheDirectory + nombreArchivo(res.titulo, tipo.ext);
  if (formato === 'csv') {
    await FileSystem.writeAsStringAsync(destino, aCsv(res), { encoding: FileSystem.EncodingType.UTF8 });
  } else if (formato === 'excel') {
    await FileSystem.writeAsStringAsync(destino, aXlsxBase64(res, XLSX), { encoding: FileSystem.EncodingType.Base64 });
  } else {
    const { uri } = await Print.printToFileAsync({ html: aHtml(res), width: 842, height: 595 });
    await FileSystem.moveAsync({ from: uri, to: destino });
  }
  if (!(await Sharing.isAvailableAsync())) return { uri: destino, compartido: false };
  await Sharing.shareAsync(destino, { mimeType: tipo.mime, UTI: tipo.uti, dialogTitle: res.titulo });
  return { uri: destino, compartido: true };
}
