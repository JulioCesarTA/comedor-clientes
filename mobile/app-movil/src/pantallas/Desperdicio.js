// Desperdicio por foto: la IA (TensorFlow Lite) corre en el teléfono y estima qué % de la comida quedó en la bandeja, SIN internet.
// 1) «Referencia»: foto de la porción completa de un plato.  2) «Analizar»: foto de la bandeja devuelta.
// Los resultados y las fotos quedan guardados y se envían al servidor (fotos a S3 de AWS) cuando vuelve la conexión.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { C, S } from '../componentes/tema';
import { analizarBandeja, crearReferencia } from '../vision/analisis';
import { agregarBandeja, agregarReferencia, pendientes, referenciasUsables, sincronizar as sincronizarCola, uuid } from '../vision/cola';
import { cargarEstado, conservarFoto, depsReales, guardarEstado } from '../vision/almacenVision';
import { prepararFoto } from '../vision/imagen';
import { caracteristicas, modeloDisponible } from '../vision/modelo';

const TURNOS = ['DESAYUNO', 'ALMUERZO', 'CENA'];
const hoy = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const idPlato = (p) => { const t = String(p).trim(); return t.startsWith('plato-') ? t : `plato-${t}`; };
const nombrePlato = (p) => String(p).replace(/^plato-/, '');
const hora = (iso) => { try { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; } catch { return ''; } };

/** Platos de los últimos menús descargados, para elegirlos sin escribir. */
function platosSugeridos(datos) {
  const m = datos && datos.datasets && datos.datasets.menus;
  if (!m) return [];
  const ci = (n) => m.columnas.indexOf(n);
  const [f, t, p] = [ci('fecha'), ci('turno'), ci('plato')];
  if (f < 0 || t < 0 || p < 0) return [];
  const h = hoy();
  const filas = m.filas.filter((r) => r[f] && r[f] <= h).sort((a, b) => String(b[f]).localeCompare(String(a[f])));
  const vistos = new Set(), out = [];
  for (const r of filas) { const k = `${r[p]}|${r[t]}`; if (!vistos.has(k)) { vistos.add(k); out.push({ plato: r[p], turno: String(r[t]).toUpperCase() }); } if (out.length >= 10) break; }
  return out;
}

function Chip({ texto, activo, onPress }) {
  return <TouchableOpacity onPress={onPress} style={[S.chip, activo && S.chipOn]}><Text style={[S.chipTxt, activo && S.chipTxtOn]}>{texto}</Text></TouchableOpacity>;
}

export default function Desperdicio({ perfil, datos, enLinea, api, obtenerToken, onMenu, onPendientes }) {
  const [est, setEst] = useState(null);
  const [tab, setTab] = useState('analizar');
  const [refId, setRefId] = useState(null);
  const [plato, setPlato] = useState('');
  const [turno, setTurno] = useState('ALMUERZO');
  const [fecha, setFecha] = useState(hoy());
  const [cargando, setCargando] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [resultado, setResultado] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const estRef = useRef(null);
  estRef.current = est;

  const poner = useCallback(async (nuevo) => { setEst(nuevo); estRef.current = nuevo; await guardarEstado(nuevo); if (onPendientes) onPendientes(pendientes(nuevo)); }, [onPendientes]);

  useEffect(() => { cargarEstado().then((e) => { setEst(e); estRef.current = e; if (onPendientes) onPendientes(pendientes(e)); }); }, [onPendientes]);

  const sincronizar = useCallback(async (silencioso) => {
    if (!estRef.current || sincronizando) return;
    setSincronizando(true); if (!silencioso) { setError(''); setAviso(''); }
    try {
      const { estado, resumen } = await sincronizarCola(estRef.current, depsReales({ api, obtenerToken }));
      await poner(estado);
      if (resumen.sinRed) { if (!silencioso) setAviso('Sin conexión: tus resultados siguen guardados en el teléfono.'); }
      else if (resumen.errores.length) setError(resumen.errores.slice(0, 3).join('\n'));
      else if (!silencioso || resumen.bandejas || resumen.referencias) setAviso(`Sincronizado: ${resumen.referencias} referencia(s) y ${resumen.bandejas} bandeja(s) enviadas.`);
    } catch (e) { if (!silencioso) setError(e.message || String(e)); }
    finally { setSincronizando(false); }
  }, [api, obtenerToken, poner, sincronizando]);

  useEffect(() => { if (est && enLinea) sincronizar(true); }, [enLinea, !!est]); // eslint-disable-line react-hooks/exhaustive-deps

  const usables = est ? referenciasUsables(est) : [];
  const ref = usables.find((r) => r.id === refId) || null;
  useEffect(() => { if (est && !refId && usables.length) setRefId(usables[0].id); }, [est]); // eslint-disable-line react-hooks/exhaustive-deps

  async function tomarFoto(galeria) {
    const permiso = galeria ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) throw new Error(galeria ? 'Permite el acceso a tus fotos.' : 'Permite el uso de la cámara para fotografiar la bandeja.');
    const r = galeria
      ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 })
      : await ImagePicker.launchCameraAsync({ quality: 1 });
    return r.canceled || !r.assets || !r.assets.length ? null : r.assets[0].uri;
  }

  async function procesar(modo, galeria) {
    setError(''); setAviso(''); setResultado(null);
    try {
      if (!modeloDisponible()) throw new Error('La IA local necesita la app instalada con `expo run:android` (no funciona en Expo Go).');
      if (modo === 'ref' && !plato.trim()) throw new Error('Escribe o elige el plato de la referencia.');
      if (modo === 'ref' && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La fecha debe ser AAAA-MM-DD.');
      if (modo === 'bandeja' && !ref) throw new Error('Primero crea o elige una referencia (la foto de la porción completa).');
      const uri = await tomarFoto(galeria);
      if (!uri) return;
      setCargando('Analizando con la IA del teléfono…');
      await new Promise((r) => setTimeout(r, 30));                      // deja pintar el indicador
      const { rgba, uriFoto } = await prepararFoto(uri);
      const mapa = await caracteristicas(rgba);                         // TensorFlow Lite, sin internet
      const id = uuid();
      const foto = await conservarFoto(uriFoto, id);
      if (modo === 'ref') {
        const r = crearReferencia(rgba, mapa);
        const nuevo = agregarReferencia(estRef.current, { clienteId: id, platoId: idPlato(plato), fecha, turno, fRef: r.fRef, comida: r.comida, fondo: r.fondo, advertencia: r.advertencia, fotoUri: foto });
        await poner(nuevo);
        setRefId(id); setTab('analizar');
        setAviso(`Referencia guardada: ${nombrePlato(plato)} (${turno.toLowerCase()}). ${r.advertencia || 'Ya puedes analizar bandejas, también sin internet.'}`);
      } else {
        const r = analizarBandeja(rgba, mapa, ref);
        const nuevo = agregarBandeja(estRef.current, { clienteId: id, refId: ref.id, refEsLocal: !!ref.local && !ref.sincronizada, platoId: ref.platoId, fecha: ref.fecha, turno: ref.turno,
          restante: r.restante, comido: r.comido, confianza: r.confianza, fotoUri: foto });
        await poner(nuevo);
        setResultado({ ...r, foto, plato: ref.platoId });
      }
      if (enLinea) sincronizar(true);
    } catch (e) { setError(e.message || String(e)); }
    finally { setCargando(''); }
  }

  const sug = platosSugeridos(datos);
  const n = est ? pendientes(est) : 0;
  const color = (r) => (r <= 15 ? C.verde : r <= 30 ? C.ambar : C.rojo);

  return (
    <View style={S.pantalla}>
      <StatusBar style="light" />
      <View style={[S.fila, { paddingHorizontal: 12, paddingTop: 52, paddingBottom: 8 }]}>
        <TouchableOpacity onPress={onMenu} style={{ padding: 8, marginRight: 4 }}><Text style={{ fontSize: 26, color: '#fff' }}>☰</Text></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.titulo}>Desperdicio por foto</Text>
          <Text style={S.subtitulo} numberOfLines={1}>IA local · {modeloDisponible() ? 'TensorFlow Lite listo' : 'solo en la app instalada'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 6 }} keyboardShouldPersistTaps="handled">
        <View style={[S.fila, { marginBottom: 12, flexWrap: 'wrap' }]}>
          <Text style={{ color: C.suave, fontSize: 12 }}>{enLinea ? '🟢 En línea' : '🔴 Sin conexión'} · {n > 0 ? `${n} por enviar` : 'todo enviado'}{est && est.ultimaSync ? ` · últ. envío ${hora(est.ultimaSync)}` : ''}</Text>
          <TouchableOpacity onPress={() => sincronizar(false)} disabled={sincronizando || !enLinea} style={{ marginLeft: 10 }}>
            {sincronizando ? <ActivityIndicator size="small" color={C.cian} /> : <Text style={{ color: enLinea ? C.cian : C.tenue, fontSize: 12 }}>↻ Enviar ahora</Text>}
          </TouchableOpacity>
        </View>

        <View style={[S.fila, { marginBottom: 12 }]}>
          {[['analizar', '📷 Analizar bandeja'], ['ref', '🍽️ Referencia']].map(([k, t]) => (
            <TouchableOpacity key={k} onPress={() => { setTab(k); setError(''); setAviso(''); }} style={[S.botonSec, { flex: 1, marginRight: k === 'analizar' ? 8 : 0, borderColor: tab === k ? C.naranja : C.borde }]}>
              <Text style={[S.botonSecTxt, tab === k && { color: '#fff' }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'ref' && (
          <View style={S.tarjeta}>
            <Text style={S.etiqueta}>Foto de la porción completa</Text>
            <Text style={{ color: C.suave, fontSize: 12.5, marginBottom: 10 }}>Fotografía el plato recién servido, desde arriba y con buena luz. Con ella la IA aprende cómo se ve «100 % de comida».</Text>
            {sug.length > 0 && (<><Text style={[S.etiqueta, { marginTop: 4 }]}>Platos de los últimos menús</Text>
              <View style={S.envuelto}>{sug.map((s) => <Chip key={s.plato + s.turno} texto={`${s.plato} · ${s.turno.toLowerCase()}`} activo={plato === s.plato && turno === s.turno} onPress={() => { setPlato(s.plato); setTurno(s.turno); }} />)}</View></>)}
            <Text style={[S.etiqueta, { marginTop: 4 }]}>Plato</Text>
            <TextInput style={S.input} value={plato} onChangeText={setPlato} placeholder="Ej.: asado-de-res" placeholderTextColor={C.tenue} autoCapitalize="none" />
            <Text style={[S.etiqueta, { marginTop: 10 }]}>Turno</Text>
            <View style={S.envuelto}>{TURNOS.map((t) => <Chip key={t} texto={t.toLowerCase()} activo={turno === t} onPress={() => setTurno(t)} />)}</View>
            <Text style={[S.etiqueta, { marginTop: 4 }]}>Fecha</Text>
            <TextInput style={S.input} value={fecha} onChangeText={setFecha} placeholder="AAAA-MM-DD" placeholderTextColor={C.tenue} />
            <View style={[S.fila, { marginTop: 14 }]}>
              <TouchableOpacity onPress={() => procesar('ref', false)} disabled={!!cargando} style={[S.boton, { flex: 2, marginRight: 8, opacity: cargando ? 0.55 : 1 }]}><Text style={S.botonTxt}>Tomar foto</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => procesar('ref', true)} disabled={!!cargando} style={[S.botonSec, { flex: 1 }]}><Text style={S.botonSecTxt}>Galería</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {tab === 'analizar' && (
          <View style={S.tarjeta}>
            <Text style={S.etiqueta}>Referencia a comparar</Text>
            {usables.length === 0 ? (
              <Text style={{ color: C.suave, fontSize: 13 }}>Todavía no hay referencias. Ve a «Referencia» y fotografía una porción completa{enLinea ? ' (o actualiza para traer las del servidor)' : ''}.</Text>
            ) : (
              <View style={S.envuelto}>{usables.slice(0, 12).map((r) => <Chip key={r.id} texto={`${nombrePlato(r.platoId)} · ${String(r.turno).toLowerCase()} · ${r.fecha.slice(5)}${r.local && !r.sincronizada ? ' ⏳' : ''}`} activo={refId === r.id} onPress={() => setRefId(r.id)} />)}</View>
            )}
            <View style={[S.fila, { marginTop: 10 }]}>
              <TouchableOpacity onPress={() => procesar('bandeja', false)} disabled={!!cargando || !ref} style={[S.boton, { flex: 2, marginRight: 8, opacity: cargando || !ref ? 0.55 : 1 }]}><Text style={S.botonTxt}>Fotografiar bandeja</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => procesar('bandeja', true)} disabled={!!cargando || !ref} style={[S.botonSec, { flex: 1 }]}><Text style={S.botonSecTxt}>Galería</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {!!cargando && <View style={[S.tarjeta, S.fila]}><ActivityIndicator color={C.naranja} /><Text style={{ color: C.texto, marginLeft: 10 }}>{cargando}</Text></View>}
        {!!error && <Text style={S.error}>{error}</Text>}
        {!!aviso && <Text style={S.ok}>{aviso}</Text>}

        {resultado && (
          <View style={S.tarjeta}>
            <Text style={S.etiqueta}>Resultado · {nombrePlato(resultado.plato)}</Text>
            <View style={{ flexDirection: 'row' }}>
              {!!resultado.foto && <Image source={{ uri: resultado.foto }} style={{ width: 96, height: 96, borderRadius: 10, marginRight: 14 }} />}
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <Text style={{ color: color(resultado.restante), fontSize: 34, fontWeight: '800' }}>{resultado.restante}%</Text>
                <Text style={{ color: C.suave, fontSize: 12 }}>de la comida quedó en la bandeja</Text>
                <Text style={{ color: C.texto, fontSize: 13, marginTop: 4 }}>Se comió el {resultado.comido}%</Text>
              </View>
            </View>
            <View style={{ height: 8, backgroundColor: C.tarjeta2, borderRadius: 4, marginTop: 12, overflow: 'hidden' }}>
              <View style={{ width: `${Math.min(100, resultado.restante)}%`, height: 8, backgroundColor: color(resultado.restante) }} />
            </View>
            <Text style={{ color: C.tenue, fontSize: 11.5, marginTop: 8 }}>Confianza {Math.round(resultado.confianza * 100)} % · calculado en este teléfono, sin internet. {n > 0 ? 'Se enviará al servidor cuando haya conexión.' : 'Ya está en el servidor.'}</Text>
          </View>
        )}

        {est && est.bandejas.length > 0 && (
          <View style={S.tarjeta}>
            <Text style={S.etiqueta}>Últimas bandejas</Text>
            {est.bandejas.slice(0, 6).map((b) => (
              <View key={b.clienteId} style={[S.fila, { justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.borde }]}>
                <Text style={{ color: C.texto, fontSize: 13, flex: 1 }} numberOfLines={1}>{nombrePlato(b.platoId)} · {hora(b.creado)}</Text>
                <Text style={{ color: color(b.restante), fontWeight: '700', width: 56, textAlign: 'right' }}>{b.restante}%</Text>
                <Text style={{ width: 28, textAlign: 'right' }}>{b.enviada ? '✓' : b.rechazada ? '✕' : '⏳'}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}
