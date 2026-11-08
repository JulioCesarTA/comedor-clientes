// Comedor UAGRM — App móvil de reportes (React Native + Expo).
// Solo hace una cosa: generar reportes con IA dentro del teléfono, sin internet, por texto o por voz.
// Ingreso con usuario y contraseña (Keycloak) y con huella; los datos se descargan cuando hay conexión.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { C, S } from './src/componentes/tema';
import { PREDETERMINADO } from './src/config';
import { borrar, guardar, leer } from './src/cuenta/almacen';
import { renovarSesion } from './src/cuenta/auth';
import { estadoBiometria, nombreBiometria, pedirHuella } from './src/cuenta/biometria';
import { alCambiarRed, borrarLocal, cargarLocal, descargar, hayRed } from './src/datos';
import Ajustes from './src/pantallas/Ajustes';
import Login from './src/pantallas/Login';
import Reportes from './src/pantallas/Reportes';

export default function App() {
  const [fase, setFase] = useState('cargando');           // cargando | login | principal
  const [cfg, setCfg] = useState(PREDETERMINADO);
  const [perfilGuardado, setPerfilGuardado] = useState(null);
  const [bioActiva, setBioActiva] = useState(false);
  const [sesion, setSesion] = useState(null);             // { perfil, accessToken }
  const [datos, setDatos] = useState(null);
  const [enLinea, setEnLinea] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [errorSync, setErrorSync] = useState('');
  const [ajustes, setAjustes] = useState(false);
  const sesionRef = useRef(null);
  sesionRef.current = sesion;

  useEffect(() => {
    (async () => {
      const guardada = await leer('cfg');
      if (guardada) setCfg({ ...PREDETERMINADO, ...guardada });
      setPerfilGuardado(await leer('perfil'));
      setBioActiva((await leer('bio')) === true);
      setDatos(await cargarLocal());
      setEnLinea(await hayRed());
      setFase('login');
    })();
  }, []);

  // ----------------------------- datos -----------------------------

  const sincronizar = useCallback(async () => {
    const s = sesionRef.current;
    if (!s) return;
    setSincronizando(true); setErrorSync('');
    try {
      let token = s.accessToken;
      const refresh = await leer('refresh');
      if (refresh) {                                     // el token de acceso dura minutos: se renueva antes de pedir los datos
        try {
          const n = await renovarSesion(refresh, cfg);
          await guardar('refresh', n.refreshToken);
          token = n.accessToken;
          setSesion((x) => (x ? { ...x, accessToken: token } : x));
        } catch { /* sin internet o sesión vencida: se intenta igual con lo que hay */ }
      }
      setDatos(await descargar({ api: cfg.api, token, rol: s.perfil.roles.join(',') || s.perfil.rol }));
    } catch (e) { setErrorSync(e.message || String(e)); }
    finally { setSincronizando(false); }
  }, [cfg]);

  useEffect(() => {                                       // al entrar y cada vez que vuelve la conexión
    if (fase !== 'principal') return undefined;
    sincronizar();
    return alCambiarRed((c) => { setEnLinea(c); if (c) sincronizar(); });
  }, [fase, sincronizar]);

  // ----------------------------- huella -----------------------------

  async function activarHuella() {
    const est = await estadoBiometria();
    const r = await pedirHuella(`Pon ${nombreBiometria(est)} para activar el ingreso rápido`);
    if (!r.ok) { Alert.alert('No se activó', 'No se pudo confirmar tu huella. Puedes activarla después en Ajustes.'); return; }
    await guardar('bio', true);
    setBioActiva(true);
    Alert.alert('Listo', 'Desde ahora puedes entrar con tu huella, incluso sin internet.');
  }

  async function ofrecerHuella() {
    if ((await leer('bio')) !== null) return;             // ya decidió antes
    const est = await estadoBiometria();
    if (!est.hardware || !est.registrada) return;         // sin sensor o sin huellas: lo verá en Ajustes
    Alert.alert('¿Entrar con tu huella?', 'Regístrala para ingresar más rápido, incluso sin internet.', [
      { text: 'Ahora no', style: 'cancel', onPress: () => guardar('bio', false) },
      { text: 'Activar', onPress: activarHuella },
    ]);
  }

  // ----------------------------- sesión -----------------------------

  function entrar({ perfil, accessToken, enLinea: conRed }) {
    setPerfilGuardado(perfil);
    setSesion({ perfil, accessToken });
    setEnLinea(!!conRed || enLinea);
    setFase('principal');
    setTimeout(ofrecerHuella, 700);
  }

  async function salir(olvidarHuella) {
    setAjustes(false); setSesion(null); setFase('login'); setErrorSync('');
    if (olvidarHuella) {
      await Promise.all(['bio', 'refresh', 'perfil', 'clave', 'historial'].map(borrar));
      await borrarLocal();
      setBioActiva(false); setPerfilGuardado(null); setDatos(null);
    }
  }

  if (fase === 'cargando') {
    return <View style={[S.pantalla, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator size="large" color={C.naranja} /></View>;
  }
  if (fase === 'login') {
    return <Login cfg={cfg} setCfg={setCfg} perfilGuardado={perfilGuardado} bioActiva={bioActiva} onEntrar={entrar} />;
  }
  return (
    <View style={S.pantalla}>
      <Reportes perfil={sesion.perfil} datos={datos} enLinea={enLinea} sincronizando={sincronizando} errorSync={errorSync}
        onSincronizar={sincronizar} onAjustes={() => setAjustes(true)} />
      <Ajustes visible={ajustes} onCerrar={() => setAjustes(false)} perfil={sesion.perfil} bioActiva={bioActiva} setBioActiva={setBioActiva}
        cfg={cfg} setCfg={setCfg} datos={datos} sincronizando={sincronizando} onSincronizar={sincronizar}
        onBorrarDatos={async () => { await borrarLocal(); setDatos(null); }} onSalir={salir} />
    </View>
  );
}
