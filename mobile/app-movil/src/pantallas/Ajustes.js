// Ajustes: cuenta, huella (registrar / quitar), datos descargados, servidor y cierre de sesión.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { C, S } from '../componentes/tema';
import { ETIQUETA_ROL } from '../cuenta/auth';
import { abrirAjustesDeHuella, estadoBiometria, nombreBiometria, pedirHuella } from '../cuenta/biometria';
import { guardar } from '../cuenta/almacen';
import { limpiarUrl } from '../config';
import { resumenDatos } from '../datos';

const fechaHora = (iso) => { try { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } catch { return '—'; } };

export default function Ajustes({ visible, onCerrar, perfil, bioActiva, setBioActiva, cfg, setCfg, datos, sincronizando, onSincronizar, onBorrarDatos, onSalir }) {
  const [bio, setBio] = useState(null);
  const [msg, setMsg] = useState('');
  const [api, setApi] = useState(cfg.api);
  const [kc, setKc] = useState(cfg.keycloak);
  const r = resumenDatos(datos);

  useEffect(() => { if (visible) { estadoBiometria().then(setBio); setMsg(''); setApi(cfg.api); setKc(cfg.keycloak); } }, [visible]);

  async function alternarHuella(v) {
    setMsg('');
    if (!v) { await guardar('bio', false); setBioActiva(false); return; }
    const est = await estadoBiometria();
    setBio(est);
    if (!est.hardware) { setMsg('Este teléfono no tiene sensor de huella ni de rostro.'); return; }
    if (!est.registrada) { setMsg('Primero registra una huella en los ajustes del teléfono y vuelve aquí.'); return; }
    const res = await pedirHuella(`Pon ${nombreBiometria(est)} para activar el ingreso rápido`);
    if (!res.ok) { setMsg('No se pudo confirmar tu huella. No se activó.'); return; }
    await guardar('bio', true);
    setBioActiva(true);
    setMsg('Listo: desde ahora entras a tus reportes con tu huella, incluso sin internet.');
  }

  async function guardarServidor() {
    const nuevo = { ...cfg, api: limpiarUrl(api), keycloak: limpiarUrl(kc) };
    setCfg(nuevo); await guardar('cfg', nuevo); setMsg('Direcciones guardadas.');
  }

  const confirmarSalir = (olvidarHuella) => Alert.alert(olvidarHuella ? 'Cerrar sesión y olvidar mi huella' : 'Cerrar sesión',
    olvidarHuella ? 'Se borrará de este teléfono tu ingreso con huella y tu sesión guardada.' : 'Podrás volver a entrar con tu huella o tu contraseña.',
    [{ text: 'Cancelar', style: 'cancel' }, { text: 'Cerrar sesión', style: 'destructive', onPress: () => onSalir(olvidarHuella) }]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCerrar}>
      <View style={S.pantalla}>
        <View style={[S.fila, { justifyContent: 'space-between', padding: 18, paddingTop: 50 }]}>
          <Text style={S.titulo}>Ajustes</Text>
          <TouchableOpacity onPress={onCerrar}><Text style={{ color: C.cian, fontSize: 15, fontWeight: '600' }}>Listo</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 0 }}>
          <View style={S.tarjeta}>
            <Text style={S.etiqueta}>Cuenta</Text>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{perfil.nombre}</Text>
            <Text style={S.subtitulo}>{perfil.usuario} · {ETIQUETA_ROL[perfil.rol] || perfil.rol}</Text>
          </View>

          <View style={S.tarjeta}>
            <View style={[S.fila, { justifyContent: 'space-between' }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Ingresar con huella</Text>
                <Text style={[S.subtitulo, { fontSize: 12 }]}>Entra sin escribir la contraseña, también sin internet.</Text>
              </View>
              <Switch value={bioActiva} onValueChange={alternarHuella} trackColor={{ true: C.naranja, false: C.borde }} thumbColor="#fff" />
            </View>
            {bio && bio.hardware && !bio.registrada && (
              <TouchableOpacity onPress={abrirAjustesDeHuella} style={[S.botonSec, { marginTop: 12 }]}>
                <Text style={S.botonSecTxt}>Registrar mi huella en el teléfono</Text>
              </TouchableOpacity>
            )}
            {bio && !bio.hardware && <Text style={S.aviso}>Este teléfono no tiene sensor de huella ni de rostro.</Text>}
            {!!msg && <Text style={msg.startsWith('Listo') || msg.startsWith('Direcciones') ? S.ok : S.aviso}>{msg}</Text>}
          </View>

          <View style={S.tarjeta}>
            <Text style={S.etiqueta}>Datos en este teléfono</Text>
            {r ? (
              <Text style={S.texto}>{r.registros.toLocaleString('es-BO')} registros de {r.conjuntos} conjuntos{'\n'}
                <Text style={{ color: C.suave }}>Descargados el {fechaHora(r.descargado)}</Text></Text>
            ) : <Text style={[S.texto, { color: C.suave }]}>Todavía no se descargó nada.</Text>}
            <View style={[S.fila, { marginTop: 12 }]}>
              <TouchableOpacity onPress={onSincronizar} disabled={sincronizando} style={[S.botonSec, { flex: 1, marginRight: 8 }]}>
                {sincronizando ? <ActivityIndicator color={C.cian} /> : <Text style={S.botonSecTxt}>Actualizar datos</Text>}
              </TouchableOpacity>
              {r && <TouchableOpacity onPress={() => Alert.alert('Borrar datos', 'Se borrarán los datos descargados. Necesitarás conexión para volver a descargarlos.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Borrar', style: 'destructive', onPress: onBorrarDatos }])} style={S.botonSec}>
                <Text style={[S.botonSecTxt, { color: '#fca5a5' }]}>Borrar</Text>
              </TouchableOpacity>}
            </View>
          </View>

          <View style={S.tarjeta}>
            <Text style={S.etiqueta}>Servidor del comedor (datos)</Text>
            <TextInput style={S.input} value={api} onChangeText={setApi} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Text style={[S.etiqueta, { marginTop: 12 }]}>Servidor de cuentas (ingreso)</Text>
            <TextInput style={S.input} value={kc} onChangeText={setKc} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <TouchableOpacity onPress={guardarServidor} style={[S.botonSec, { marginTop: 12 }]}><Text style={S.botonSecTxt}>Guardar direcciones</Text></TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => confirmarSalir(false)} style={[S.botonSec, { marginBottom: 10 }]}><Text style={S.botonSecTxt}>Cerrar sesión</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => confirmarSalir(true)} style={S.botonSec}><Text style={[S.botonSecTxt, { color: '#fca5a5' }]}>Cerrar sesión y olvidar mi huella</Text></TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}
