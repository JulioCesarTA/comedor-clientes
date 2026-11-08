import { StyleSheet } from 'react-native';

export const C = {
  fondo: '#0f172a', tarjeta: '#1e293b', tarjeta2: '#0b1220', borde: '#334155', texto: '#e2e8f0', suave: '#94a3b8', tenue: '#64748b',
  naranja: '#f97316', morado: '#8b5cf6', cian: '#06b6d4', verde: '#10b981', rojo: '#ef4444', ambar: '#f59e0b',
};
export const PALETA = ['#f97316', '#06b6d4', '#8b5cf6', '#10b981', '#ef4444', '#eab308'];

export const S = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.fondo },
  tarjeta: { backgroundColor: C.tarjeta, borderColor: C.borde, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  titulo: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitulo: { color: C.suave, fontSize: 13, marginTop: 2 },
  etiqueta: { color: C.suave, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '600', marginBottom: 6 },
  texto: { color: C.texto, fontSize: 14, lineHeight: 20 },
  input: { backgroundColor: C.fondo, borderColor: C.borde, borderWidth: 1, borderRadius: 10, color: '#fff', paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  boton: { backgroundColor: C.naranja, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  botonTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  botonSec: { backgroundColor: C.tarjeta2, borderColor: C.borde, borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center' },
  botonSecTxt: { color: C.texto, fontWeight: '600', fontSize: 13 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: C.borde, backgroundColor: C.tarjeta2, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, marginBottom: 8 },
  chipOn: { backgroundColor: 'rgba(139,92,246,0.25)', borderColor: C.morado },
  chipTxt: { color: C.suave, fontSize: 12 },
  chipTxtOn: { color: '#ddd6fe', fontWeight: '600' },
  fila: { flexDirection: 'row', alignItems: 'center' },
  envuelto: { flexDirection: 'row', flexWrap: 'wrap' },
  error: { color: '#fca5a5', fontSize: 13, backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  aviso: { color: '#fcd34d', fontSize: 12, marginTop: 6 },
  ok: { color: '#6ee7b7', fontSize: 13, marginTop: 8 },
});
