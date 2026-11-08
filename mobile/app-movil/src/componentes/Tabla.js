// Tabla del resultado: se desliza de lado, se ordena tocando el encabezado y muestra los totales.
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { C, S } from './tema';
import { fmtValor } from '../reportes/motor';
import { dmyIso } from '../reportes/fechas';

const texto = (v, c) => (v === null || v === undefined ? '—' : typeof v === 'number' ? fmtValor(v, c.fmt) : dmyIso(v));
const ancho = (c, filas) => Math.min(220, Math.max(78, c.label.length * 8 + 20, ...filas.slice(0, 40).map((f) => texto(f[c.key], c).length * 7.5 + 20)));
const PAGINA = 60;

export default function Tabla({ res }) {
  const [orden, setOrden] = useState(null);
  const [visibles, setVisibles] = useState(PAGINA);
  const filas = useMemo(() => {
    if (!orden) return res.filas;
    const c = res.columnas.find((x) => x.key === orden.k);
    return [...res.filas].sort((a, b) => {
      const x = a[orden.k], y = b[orden.k];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const r = c && c.tipo === 'numero' ? x - y : String(x).localeCompare(String(y), 'es');
      return orden.asc ? r : -r;
    });
  }, [res, orden]);
  const anchos = useMemo(() => res.columnas.map((c) => ancho(c, res.filas)), [res]);
  if (!res.filas.length) return <Text style={[S.texto, { color: C.suave, textAlign: 'center', paddingVertical: 24 }]}>No hay datos que cumplan estas condiciones. Prueba con otro período o quita algún filtro.</Text>;

  const celda = (c, j, contenido, extra = {}) => (
    <View key={c.key} style={{ width: anchos[j], paddingHorizontal: 8, paddingVertical: 9 }}>
      <Text numberOfLines={2} style={[{ color: C.texto, fontSize: 12.5, textAlign: c.tipo === 'numero' ? 'right' : 'left' }, extra]}>{contenido}</Text>
    </View>
  );

  return (
    <View style={{ borderWidth: 1, borderColor: C.borde, borderRadius: 10, overflow: 'hidden' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={{ flexDirection: 'row', backgroundColor: '#0b1220' }}>
            {res.columnas.map((c, j) => (
              <TouchableOpacity key={c.key} onPress={() => setOrden((o) => ({ k: c.key, asc: o && o.k === c.key ? !o.asc : true }))} style={{ width: anchos[j], paddingHorizontal: 8, paddingVertical: 10 }}>
                <Text numberOfLines={2} style={{ color: C.suave, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', textAlign: c.tipo === 'numero' ? 'right' : 'left' }}>
                  {c.label}{orden && orden.k === c.key ? (orden.asc ? ' ▲' : ' ▼') : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {filas.slice(0, visibles).map((f, i) => (
            <View key={i} style={{ flexDirection: 'row', backgroundColor: i % 2 ? '#162033' : 'transparent', borderTopWidth: 0.5, borderTopColor: C.borde }}>
              {res.columnas.map((c, j) => celda(c, j, texto(f[c.key], c)))}
            </View>
          ))}
          {res.totales && (
            <View style={{ flexDirection: 'row', backgroundColor: '#2a1a0c', borderTopWidth: 1.5, borderTopColor: C.naranja }}>
              {res.columnas.map((c, j) => celda(c, j, j === 0 ? 'TOTAL' : c.key in res.totales ? texto(res.totales[c.key], c) : '', { color: C.naranja, fontWeight: '700' }))}
            </View>
          )}
        </View>
      </ScrollView>
      {filas.length > visibles && (
        <TouchableOpacity onPress={() => setVisibles((v) => v + PAGINA)} style={{ padding: 11, alignItems: 'center', backgroundColor: '#0b1220' }}>
          <Text style={{ color: C.cian, fontSize: 13 }}>Mostrar más ({filas.length - visibles} restantes)</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
