// Generador de reportes: pídelo por texto o por voz; la IA corre en el teléfono, con los datos descargados, sin internet.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { C, S } from '../componentes/tema';
import Grafico from '../componentes/Grafico';
import Tabla from '../componentes/Tabla';
import { ETIQUETA_ROL } from '../cuenta/auth';
import { guardar, leer } from '../cuenta/almacen';
import { exportarReporte } from '../archivos';
import { DATASETS, columna } from '../reportes/catalogo';
import { interpretar } from '../reportes/lenguaje';
import { ejecutar, medidaInfo } from '../reportes/motor';
import { cancelarDictado, detenerDictado, iniciarDictado, mensajeErrorVoz, useEventoVoz, vozDisponible } from '../voz';

const FORMATOS = [['pantalla', 'Pantalla'], ['pdf', 'PDF'], ['excel', 'Excel'], ['csv', 'CSV']];
const EJEMPLOS = ['Total cobrado por mes en Excel', 'Los 5 platos más reservados de este mes', 'Pagos mayores a 5 bolivianos de noviembre ordenados por monto descendente en PDF',
  'Reservas de almuerzo por semana de los últimos 30 días', 'Estudiantes sin beca ordenados por nombre', 'Insumos con stock bajo', 'Promedio de desperdicio por plato'];
const POR = [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']];
const fechaHora = (iso) => { try { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; } catch { return ''; } };

function Chip({ texto, activo, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[S.chip, activo && S.chipOn]}>
      <Text style={[S.chipTxt, activo && S.chipTxtOn]}>{texto}</Text>
    </TouchableOpacity>
  );
}

export default function Reportes({ perfil, datos, enLinea, sincronizando, errorSync, onSincronizar, onAjustes }) {
  const [texto, setTexto] = useState('');
  const [formato, setFormato] = useState('pantalla');
  const [spec, setSpec] = useState(null);
  const [entendi, setEntendi] = useState('');
  const [notas, setNotas] = useState([]);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [historial, setHistorial] = useState([]);
  const scroll = useRef(null);

  useEffect(() => { leer('historial', []).then(setHistorial); }, []);
  const recordar = async (t) => { const h = [t, ...historial.filter((x) => x !== t)].slice(0, 8); setHistorial(h); await guardar('historial', h); };

  // ----------------------------- generar -----------------------------

  const generar = (t, { continuar = true, fmt } = {}) => {
    const q = (t === undefined ? texto : t).trim();
    if (!q) return;
    Keyboard.dismiss(); setError(''); setAviso(''); setCargando(true);
    setTimeout(async () => {                           // deja pintar el indicador antes de calcular
      try {
        if (!datos) throw new Error('Todavía no hay datos en este teléfono. Conéctate a la red del comedor y toca «Actualizar datos».');
        const i = interpretar(q, { previa: continuar ? spec : null, tablas: datos.datasets });
        const r = ejecutar(i.spec, datos.datasets);
        setSpec(i.spec); setEntendi(i.entendi); setNotas(i.notas); setRes(r);
        const f = fmt || (i.spec.salida !== 'pantalla' ? i.spec.salida : formato);
        setFormato(f);
        recordar(q);
        if (f !== 'pantalla') await bajar(r, f);
        else setTimeout(() => scroll.current && scroll.current.scrollTo({ y: 330, animated: true }), 120);
      } catch (e) { setError(e.message || String(e)); }
      finally { setCargando(false); }
    }, 40);
  };

  const bajar = async (r, f) => {
    setAviso(`Generando ${f === 'excel' ? 'Excel' : f.toUpperCase()}…`);
    try { await exportarReporte(r, f); setAviso(`Listo: ${f === 'excel' ? 'Excel' : f.toUpperCase()} generado en el teléfono.`); }
    catch (e) { setAviso(''); setError('No pude generar el archivo: ' + (e.message || e)); }
  };

  const aplicar = (nuevo) => {            // ajustes rápidos sobre la consulta actual
    try { const r = ejecutar(nuevo, datos.datasets); setSpec(nuevo); setRes(r); setError(''); } catch (e) { setError(e.message || String(e)); }
  };

  // ----------------------------- voz -----------------------------

  useEventoVoz('result', (ev) => {
    const t = ev.results && ev.results[0] && ev.results[0].transcript;
    if (!t) return;
    setTexto(t);
    if (ev.isFinal) { setEscuchando(false); generar(t); }
  });
  useEventoVoz('end', () => setEscuchando(false));
  useEventoVoz('error', (ev) => { setEscuchando(false); const m = mensajeErrorVoz(ev); if (m) setError(m); });

  const alternarMic = async () => {
    setError('');
    if (escuchando) { detenerDictado(); return; }
    try { await iniciarDictado(); setEscuchando(true); } catch (e) { setError(e.message || String(e)); }
  };
  useEffect(() => () => { try { cancelarDictado(); } catch { /* sin dictado */ } }, []);

  // ----------------------------- piezas -----------------------------

  const ds = spec ? DATASETS[spec.dataset] : null;
  const agrupado = !!(spec && (spec.agrupar || []).length);
  const ordenar = (dir) => {
    const col = agrupado || (spec.medidas || []).length
      ? medidaInfo(spec.dataset, (spec.medidas || [])[0] || { fn: 'count' }).key
      : ds.columnas.find((c) => c.tipo === 'numero') && ds.columnas.find((c) => c.tipo === 'numero').nombre;
    if (col) aplicar({ ...spec, orden: [{ col, dir }] });
  };

  const estadoDatos = datos
    ? `${enLinea ? '🟢 En línea' : '🔴 Sin conexión'} · datos del ${fechaHora(datos.descargado)}`
    : `${enLinea ? '🟢 En línea' : '🔴 Sin conexión'} · todavía no hay datos descargados`;

  return (
    <KeyboardAvoidingView style={S.pantalla} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={[S.fila, { justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 52, paddingBottom: 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={S.titulo}>Reportes</Text>
          <Text style={S.subtitulo} numberOfLines={1}>{perfil.nombre} · {ETIQUETA_ROL[perfil.rol] || perfil.rol}</Text>
        </View>
        <TouchableOpacity onPress={onAjustes} style={{ padding: 8 }}><Text style={{ fontSize: 24 }}>⚙️</Text></TouchableOpacity>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ padding: 18, paddingTop: 6 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={onSincronizar} disabled={sincronizando} style={[S.fila, { marginBottom: 12, flexWrap: 'wrap' }]}>
          <Text style={{ color: C.suave, fontSize: 12 }}>{estadoDatos}</Text>
          {sincronizando ? <ActivityIndicator size="small" color={C.cian} style={{ marginLeft: 8 }} /> : <Text style={{ color: C.cian, fontSize: 12, marginLeft: 8 }}>↻ Actualizar</Text>}
        </TouchableOpacity>
        {!!errorSync && <Text style={[S.aviso, { marginBottom: 10 }]}>{errorSync}</Text>}

        {/* Pedido */}
        <View style={S.tarjeta}>
          <Text style={S.etiqueta}>Pide tu reporte</Text>
          {spec && (
            <View style={{ backgroundColor: 'rgba(6,182,212,0.1)', borderColor: 'rgba(6,182,212,0.35)', borderWidth: 1, borderRadius: 10, padding: 9, marginBottom: 10 }}>
              <Text style={{ color: '#a5f3fc', fontSize: 12 }}>Continúas el reporte anterior: di «ahora por mes», «solo de almuerzo», «en Excel»…</Text>
              <TouchableOpacity onPress={() => { setSpec(null); setRes(null); setEntendi(''); setNotas([]); setAviso(''); }}><Text style={{ color: C.cian, fontSize: 12, fontWeight: '700', marginTop: 4 }}>Nuevo reporte</Text></TouchableOpacity>
            </View>
          )}
          <View style={{ flexDirection: 'row' }}>
            <TextInput style={[S.input, { flex: 1, minHeight: 84, textAlignVertical: 'top' }]} value={texto} onChangeText={setTexto} multiline
              placeholder="Ej.: quiero ver fecha, monto y estudiante de los pagos de noviembre, los mayores primero, en Excel" placeholderTextColor={C.tenue} />
            <TouchableOpacity onPress={alternarMic} style={{ width: 74, marginLeft: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: escuchando ? C.rojo : C.tarjeta2, borderWidth: 1, borderColor: escuchando ? C.rojo : C.borde }}>
              <Text style={{ fontSize: 26 }}>{escuchando ? '■' : '🎤'}</Text>
              <Text style={{ color: '#fff', fontSize: 10.5, marginTop: 2 }}>{escuchando ? 'Escuchando…' : 'Dictar'}</Text>
            </TouchableOpacity>
          </View>
          {!vozDisponible() && <Text style={{ color: C.tenue, fontSize: 11, marginTop: 6 }}>El dictado funciona en la app instalada (no en Expo Go). Mientras tanto, escribe tu pedido.</Text>}

          <Text style={[S.etiqueta, { marginTop: 14 }]}>Ver en</Text>
          <View style={S.envuelto}>{FORMATOS.map(([k, n]) => <Chip key={k} texto={n} activo={formato === k} onPress={() => setFormato(k)} />)}</View>
          <TouchableOpacity onPress={() => generar(undefined, { fmt: formato })} disabled={cargando || !texto.trim()} style={[S.boton, { marginTop: 4, opacity: cargando || !texto.trim() ? 0.55 : 1 }]}>
            {cargando ? <ActivityIndicator color="#fff" /> : <Text style={S.botonTxt}>Generar reporte</Text>}
          </TouchableOpacity>
          {!!error && <Text style={S.error}>{error}</Text>}
          {!!aviso && <Text style={S.ok}>{aviso}</Text>}
          {historial.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Text style={S.etiqueta}>Recientes</Text>
              <View style={S.envuelto}>{historial.map((h) => <TouchableOpacity key={h} style={S.chip} onPress={() => { setTexto(h); generar(h, { continuar: false }); }}><Text style={S.chipTxt} numberOfLines={1}>{h.length > 34 ? h.slice(0, 33) + '…' : h}</Text></TouchableOpacity>)}</View>
            </View>
          )}
        </View>

        {res && spec && (
          <>
            <View style={S.tarjeta}>
              <Text style={S.etiqueta}>Así lo entendí</Text>
              <Text style={{ color: '#fff', fontSize: 14, lineHeight: 20 }}>{entendi}</Text>
              {notas.map((n, i) => <Text key={i} style={S.aviso}>• {n}</Text>)}
              <View style={[S.envuelto, { marginTop: 10 }]}>
                {(spec.filtros || []).map((f, i) => (
                  <TouchableOpacity key={i} style={S.chip} onPress={() => aplicar({ ...spec, filtros: spec.filtros.filter((_, k) => k !== i) })}>
                    <Text style={S.chipTxt}>{(columna(spec.dataset, f.col) || { etiqueta: f.col }).etiqueta} {f.op === 'dia_semana' ? 'ciertos días' : f.op} {Array.isArray(f.valor) ? f.valor.join('–') : String(f.valor)}  ✕</Text>
                  </TouchableOpacity>
                ))}
                {spec.fecha && <TouchableOpacity style={S.chip} onPress={() => aplicar({ ...spec, fecha: null })}><Text style={S.chipTxt}>Período: {spec.fecha.etiqueta}  ✕</Text></TouchableOpacity>}
              </View>
              <Text style={[S.etiqueta, { marginTop: 8 }]}>Agrupar</Text>
              <View style={S.envuelto}>
                <Chip texto="Sin agrupar" activo={!agrupado} onPress={() => aplicar({ ...spec, agrupar: [], medidas: [], columnas: null, orden: [] })} />
                {ds.fecha && POR.map(([k, n]) => <Chip key={k} texto={n} activo={agrupado && spec.agrupar[0].por === k} onPress={() => aplicar({ ...spec, agrupar: [{ col: ds.fecha, por: k }], columnas: null, orden: [] })} />)}
                {ds.columnas.filter((c) => c.tipo === 'categoria').map((c) => <Chip key={c.nombre} texto={c.etiqueta} activo={agrupado && spec.agrupar[0].col === c.nombre && !spec.agrupar[0].por} onPress={() => aplicar({ ...spec, agrupar: [{ col: c.nombre }], columnas: null, orden: [] })} />)}
              </View>
              <Text style={[S.etiqueta, { marginTop: 4 }]}>Orden y cantidad</Text>
              <View style={S.envuelto}>
                <Chip texto="↓ Mayor a menor" activo={!!(spec.orden || []).find((o) => o.dir === 'desc')} onPress={() => ordenar('desc')} />
                <Chip texto="↑ Menor a mayor" activo={!!(spec.orden || []).find((o) => o.dir === 'asc')} onPress={() => ordenar('asc')} />
                {[5, 10, 20].map((n) => <Chip key={n} texto={`Primeros ${n}`} activo={spec.limite === n} onPress={() => aplicar({ ...spec, limite: n })} />)}
                <Chip texto="Todos" activo={!spec.limite} onPress={() => aplicar({ ...spec, limite: null })} />
              </View>
            </View>

            <View style={S.tarjeta}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{res.titulo}</Text>
              <Text style={[S.subtitulo, { marginBottom: 8 }]}>{res.datasetEtiqueta} · {res.generado}</Text>
              {res.resumen.map((l, i) => <Text key={i} style={[S.texto, { fontSize: 13 }]}>{l}</Text>)}
              <View style={[S.fila, { marginVertical: 12 }]}>
                {[['pdf', 'PDF'], ['excel', 'Excel'], ['csv', 'CSV']].map(([k, n]) => (
                  <TouchableOpacity key={k} onPress={() => bajar(res, k)} style={[S.botonSec, { flex: 1, marginRight: k === 'csv' ? 0 : 8 }]}><Text style={S.botonSecTxt}>⬇ {n}</Text></TouchableOpacity>
                ))}
              </View>
              <Grafico res={res} />
              <Tabla res={res} />
            </View>
          </>
        )}

        {!res && (
          <>
            <View style={S.tarjeta}>
              <Text style={S.etiqueta}>Pruébalo</Text>
              <View style={S.envuelto}>{EJEMPLOS.map((e) => <TouchableOpacity key={e} style={S.chip} onPress={() => { setTexto(e); generar(e, { continuar: false }); }}><Text style={S.chipTxt}>{e.length > 46 ? e.slice(0, 45) + '…' : e}</Text></TouchableOpacity>)}</View>
            </View>
            <View style={S.tarjeta}>
              <Text style={S.etiqueta}>¿Qué puedo pedir?</Text>
              {Object.entries(DATASETS).filter(([id]) => !datos || datos.datasets[id]).map(([id, d]) => (
                <View key={id} style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{d.etiqueta}</Text>
                  <Text style={{ color: C.suave, fontSize: 12, marginBottom: 4 }}>{d.descripcion}</Text>
                  <Text style={{ color: C.tenue, fontSize: 11.5 }}>{d.columnas.map((c) => c.etiqueta).join(' · ')}</Text>
                  {d.ejemplos.slice(0, 2).map((e) => <TouchableOpacity key={e} onPress={() => { setTexto(e); generar(e, { continuar: false }); }}><Text style={{ color: C.cian, fontSize: 12.5, marginTop: 3 }}>› {e}</Text></TouchableOpacity>)}
                </View>
              ))}
              <Text style={{ color: C.tenue, fontSize: 11.5, lineHeight: 16 }}>
                Puedes combinar períodos (noviembre, últimos 30 días, del 1 al 15 de octubre, 2025), filtros (mayores a 5, solo almuerzo, sin beca), agrupaciones (por día, semana, mes, año, turno, plato),
                cálculos (total, promedio, cuántos), rankings (los 10 mayores), orden (ascendente, descendente) y formato (pantalla, PDF, Excel, CSV).
              </Text>
            </View>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
