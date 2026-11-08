// Ingreso: usuario y contraseña (la primera vez, con internet) o huella (también sin internet).
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { C, S } from '../componentes/tema';
import { ErrorAuth, crearClaveLocal, iniciarSesion, renovarSesion, verificarClaveLocal } from '../cuenta/auth';
import { estadoBiometria, pedirHuella } from '../cuenta/biometria';
import { guardar, leer } from '../cuenta/almacen';
import { limpiarUrl } from '../config';

export default function Login({ cfg, setCfg, perfilGuardado, bioActiva, onEntrar }) {
  const [usuario, setUsuario] = useState(perfilGuardado ? perfilGuardado.usuario : '');
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [servidor, setServidor] = useState(false);
  const [api, setApi] = useState(cfg.api);
  const [kc, setKc] = useState(cfg.keycloak);
  const [bio, setBio] = useState(null);
  const yaPidio = useRef(false);

  useEffect(() => { estadoBiometria().then(setBio); }, []);
  useEffect(() => {                                   // si ya registró su huella, la pide apenas abre la app
    if (bioActiva && perfilGuardado && !yaPidio.current) { yaPidio.current = true; setTimeout(conHuella, 350); }
  }, [bioActiva]);

  async function conClave() {
    if (!usuario.trim() || !clave) { setError('Escribe tu usuario y tu contraseña.'); return; }
    setError(''); setCargando(true);
    try {
      const s = await iniciarSesion(usuario, clave, cfg);
      await guardar('perfil', s.perfil);
      await guardar('refresh', s.refreshToken);
      await guardar('clave', await crearClaveLocal(usuario, clave));       // para poder ingresar sin internet la próxima vez
      onEntrar({ perfil: s.perfil, accessToken: s.accessToken, enLinea: true });
    } catch (e) {
      if (e instanceof ErrorAuth && e.tipo === 'red') {
        const local = await leer('clave');
        if (perfilGuardado && local && (await verificarClaveLocal(local, usuario, clave))) onEntrar({ perfil: perfilGuardado, accessToken: null, enLinea: false });
        else setError(perfilGuardado ? 'Sin conexión: la contraseña no coincide con la guardada en este teléfono.' : 'Sin conexión. El primer ingreso necesita internet para validar tu cuenta; después podrás entrar sin internet.');
      } else setError(e.message);
    } finally { setCargando(false); }
  }

  async function conHuella() {
    const est = await estadoBiometria();
    if (!est.registrada) { setError('Este teléfono no tiene huellas registradas. Regístrala en los ajustes del teléfono o ingresa con tu contraseña.'); return; }
    const r = await pedirHuella('Confirma tu identidad para ingresar a tus reportes');
    if (!r.ok) { if (r.error && !/cancel/i.test(r.error)) setError('No se reconoció la huella. Inténtalo otra vez o usa tu contraseña.'); return; }
    setError(''); setCargando(true);
    try {
      const refresh = await leer('refresh');
      try {
        const s = await renovarSesion(refresh, cfg);                       // con internet, renueva la sesión en segundo plano
        await guardar('refresh', s.refreshToken);
        await guardar('perfil', s.perfil);
        onEntrar({ perfil: s.perfil, accessToken: s.accessToken, enLinea: true });
      } catch (e) {
        if (e instanceof ErrorAuth && e.tipo === 'credenciales') { setError('Tu sesión guardada venció o tu cuenta cambió. Ingresa una vez con tu contraseña.'); return; }
        onEntrar({ perfil: perfilGuardado, accessToken: null, enLinea: false });   // sin internet: entra con lo guardado
      }
    } finally { setCargando(false); }
  }

  async function guardarServidor() {
    const nuevo = { ...cfg, api: limpiarUrl(api), keycloak: limpiarUrl(kc) };
    setCfg(nuevo); await guardar('cfg', nuevo); setServidor(false);
  }

  return (
    <KeyboardAvoidingView style={S.pantalla} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 70, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 26 }}>
          <View style={{ width: 66, height: 66, borderRadius: 18, backgroundColor: C.naranja, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>CU</Text>
          </View>
          <Text style={[S.titulo, { marginTop: 14 }]}>Comedor UAGRM</Text>
          <Text style={[S.subtitulo, { textAlign: 'center' }]}>Reportes inteligentes · funcionan sin internet</Text>
        </View>

        {bioActiva && perfilGuardado && (
          <TouchableOpacity onPress={conHuella} disabled={cargando} style={[S.tarjeta, { alignItems: 'center', paddingVertical: 20 }]}>
            <Text style={{ fontSize: 46 }}>🔐</Text>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, marginTop: 6 }}>Ingresar con {bio && bio.rostro && !bio.huella ? 'mi rostro' : 'mi huella'}</Text>
            <Text style={{ color: C.suave, fontSize: 12, marginTop: 3 }}>{perfilGuardado.nombre}</Text>
          </TouchableOpacity>
        )}

        <View style={S.tarjeta}>
          <Text style={S.etiqueta}>Usuario</Text>
          <TextInput style={S.input} value={usuario} onChangeText={setUsuario} autoCapitalize="none" autoCorrect={false} placeholder="tu usuario" placeholderTextColor={C.tenue} />
          <Text style={[S.etiqueta, { marginTop: 12 }]}>Contraseña</Text>
          <View style={S.fila}>
            <TextInput style={[S.input, { flex: 1 }]} value={clave} onChangeText={setClave} secureTextEntry={!ver} autoCapitalize="none" autoCorrect={false}
              placeholder="••••••••" placeholderTextColor={C.tenue} onSubmitEditing={conClave} returnKeyType="go" />
            <TouchableOpacity onPress={() => setVer(!ver)} style={{ paddingHorizontal: 12 }}><Text style={{ color: C.suave, fontSize: 12 }}>{ver ? 'Ocultar' : 'Ver'}</Text></TouchableOpacity>
          </View>
          <TouchableOpacity onPress={conClave} disabled={cargando} style={[S.boton, { marginTop: 16, opacity: cargando ? 0.6 : 1 }]}>
            {cargando ? <ActivityIndicator color="#fff" /> : <Text style={S.botonTxt}>Ingresar</Text>}
          </TouchableOpacity>
          {!!error && <Text style={S.error}>{error}</Text>}
          <Text style={{ color: C.tenue, fontSize: 11.5, marginTop: 12, lineHeight: 16 }}>
            La primera vez necesitas internet. Después podrás entrar sin conexión con tu contraseña{bioActiva ? ' o tu huella' : ''}, y registrar tu huella desde Ajustes.
          </Text>
        </View>

        <TouchableOpacity onPress={() => setServidor(!servidor)} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ color: C.suave, fontSize: 12 }}>{servidor ? 'Ocultar' : 'Servidor'} ▾</Text>
        </TouchableOpacity>
        {servidor && (
          <View style={S.tarjeta}>
            <Text style={S.etiqueta}>Servidor del comedor (datos)</Text>
            <TextInput style={S.input} value={api} onChangeText={setApi} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.0.10:8080" placeholderTextColor={C.tenue} />
            <Text style={[S.etiqueta, { marginTop: 12 }]}>Servidor de cuentas (ingreso)</Text>
            <TextInput style={S.input} value={kc} onChangeText={setKc} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://32.187.224.152:8085" placeholderTextColor={C.tenue} />
            <TouchableOpacity onPress={guardarServidor} style={[S.botonSec, { marginTop: 12 }]}><Text style={S.botonSecTxt}>Guardar direcciones</Text></TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
