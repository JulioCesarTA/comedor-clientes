// Comedor UAGRM — App móvil (React Native + Expo) con IA dentro del teléfono, sin internet:
//   · Reportes por texto o por voz   · Desperdicio por foto (TensorFlow Lite; fotos a S3 cuando hay red)
// Ingreso con usuario y contraseña (Keycloak) y con huella; menú lateral; los datos se descargan cuando hay conexión.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { C, S } from './src/componentes/tema';
import { PREDETERMINADO } from './src/config';
import { borrar, guardar, leer } from './src/cuenta/almacen';
import { renovarSesion } from './src/cuenta/auth';
import { estadoBiometria, nombreBiometria, pedirHuella } from './src/cuenta/biometria';
import { alCambiarRed, borrarLocal, cargarLocal, descargar, hayRed } from './src/datos';
import Menu, { puedeVerDesperdicio } from './src/componentes/Menu';
import Ajustes from './src/pantallas/Ajustes';
import Desperdicio from './src/pantallas/Desperdicio';
import Login from './src/pantallas/Login';
import Reportes from './src/pantallas/Reportes';
import { borrarEstado } from './src/vision/almacenVision';

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
  const [pantalla, setPantalla] = useState('reportes');   // reportes | desperdicio (el menú lateral cambia entre ellas)
  const [menu, setMenu] = useState(false);
  const [porEnviar, setPorEnviar] = useState(0);          // resultados de «Desperdicio por foto» aún sin enviar al servidor
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

  // Token vigente: el de acceso dura minutos, así que se renueva con el de refresco antes de hablar con el servidor
  const obtenerToken = useCallback(async () => {
    const s = sesionRef.current;
    if (!s) return null;
    let token = s.accessToken;
    const refresh = await leer('refresh');
    if (refresh) {
      try {
        const n = await renovarSesion(refresh, cfg);
        await guardar('refresh', n.refreshToken);
        token = n.accessToken;
        setSesion((x) => (x ? { ...x, accessToken: token } : x));
      } catch { /* sin internet o sesión vencida: se intenta igual con lo que hay */ }
    }
    return token;
  }, [cfg]);

  const sincronizar = useCallback(async () => {
    const s = sesionRef.current;
    if (!s) return;
    setSincronizando(true); setErrorSync('');
    try {
      const token = await obtenerToken();
      setDatos(await descargar({ api: cfg.api, token, rol: s.perfil.roles.join(',') || s.perfil.rol }));
    } catch (e) { setErrorSync(e.message || String(e)); }
    finally { setSincronizando(false); }
  }, [cfg, obtenerToken]);

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
    setAjustes(false); setMenu(false); setPantalla('reportes'); setSesion(null); setFase('login'); setErrorSync('');
    if (olvidarHuella) {
      await Promise.all(['bio', 'refresh', 'perfil', 'clave', 'historial'].map(borrar));
      await borrarLocal();
      await borrarEstado();
      setBioActiva(false); setPerfilGuardado(null); setDatos(null);
    }
  }

  if (fase === 'cargando') {
    return <View style={[S.pantalla, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator size="large" color={C.naranja} /></View>;
  }
  if (fase === 'login') {
    return <Login cfg={cfg} setCfg={setCfg} perfilGuardado={perfilGuardado} bioActiva={bioActiva} onEntrar={entrar} />;
  }
  const verDesperdicio = pantalla === 'desperdicio' && puedeVerDesperdicio(sesion.perfil);
  const ir = (id) => {
    setMenu(false);
    if (id === 'ajustes') setAjustes(true); else setPantalla(id);
  };
  return (
    <View style={S.pantalla}>
      {verDesperdicio
        ? <Desperdicio perfil={sesion.perfil} datos={datos} enLinea={enLinea} api={cfg.api} obtenerToken={obtenerToken}
            onMenu={() => setMenu(true)} onPendientes={setPorEnviar} />
        : <Reportes perfil={sesion.perfil} datos={datos} enLinea={enLinea} sincronizando={sincronizando} errorSync={errorSync}
            onSincronizar={sincronizar} onMenu={() => setMenu(true)} />}
      <Menu visible={menu} onCerrar={() => setMenu(false)} perfil={sesion.perfil} pantalla={verDesperdicio ? 'desperdicio' : 'reportes'}
        onIr={ir} enLinea={enLinea} pendientes={porEnviar} />
      <Ajustes visible={ajustes} onCerrar={() => setAjustes(false)} perfil={sesion.perfil} bioActiva={bioActiva} setBioActiva={setBioActiva}
        cfg={cfg} setCfg={setCfg} datos={datos} sincronizando={sincronizando} onSincronizar={sincronizar}
        onBorrarDatos={async () => { await borrarLocal(); setDatos(null); }} onSalir={salir} />
    </View>
  );
}
