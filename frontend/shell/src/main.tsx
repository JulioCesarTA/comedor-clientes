import React, { Suspense, useEffect, useState, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom';
import { keycloak, KC_URL } from './keycloak';

const BI_URL = import.meta.env.VITE_BI_URL || 'http://localhost:3003';
const BACKOFFICE_URL = import.meta.env.VITE_BACKOFFICE_URL || 'http://localhost:3001';

// Portal se carga via Module Federation (host → remote).
// @ts-expect-error federated module
const RemotePortal = lazy(() => import('portal/App').catch((e) => {
  console.error('[Module Federation] portal remote error:', e);
  return { default: () => <RemoteFallback name="Portal estudiantil" /> };
}));

function RemoteFallback({ name }: { name: string }) {
  return (
    <div className="p-12 text-center">
      <h2 className="text-xl font-semibold text-white">{name} no disponible en este momento</h2>
      <p className="text-slate-400 text-sm mt-2">Recargá la página en unos segundos.</p>
    </div>
  );
}

// ¿Se puede llegar a Keycloak? navigator.onLine no alcanza: hay wifi sin internet, y sin Keycloak el login deja la app.
async function hayKeycloak(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    await fetch(`${KC_URL}/realms/comedor-uagrm/.well-known/openid-configuration`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return true;
  } catch { return false; }
}

function datosDelToken(token: string): { user: string; roles: string[] } | null {
  try {
    const t = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      user: t.preferred_username || '',
      roles: (t.realm_access?.roles || []).filter((r: string) => !r.startsWith('default-') && !r.startsWith('offline') && !r.startsWith('uma')),
    };
  } catch { return null; }
}

// La sesión guardada se borra siempre: es la que permite entrar sin conexión.
function cerrarSesion() {
  localStorage.removeItem('kc_token');
  document.cookie = 'kc_token=; path=/; max-age=0';
  if (keycloak.authenticated) keycloak.logout({ redirectUri: window.location.origin });
  else window.location.reload();
}

function LoginScreen({ sinRed }: { sinRed: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md p-10 bg-slate-800/60 backdrop-blur rounded-2xl border border-slate-700 shadow-2xl">
        <div className="text-center mb-10">
          <div className="w-16 h-16 mx-auto bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl flex items-center justify-center mb-4">
            <span className="text-white text-2xl font-bold tracking-tight">CU</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Comedor Universitario</h1>
          <p className="text-slate-400 mt-2 text-sm">Plataforma de gestión integral</p>
        </div>
        {sinRed && (
          <p className="text-sm text-amber-300 text-center mb-4">Sin conexión. Para ingresar por primera vez en este equipo necesitas internet.</p>
        )}
        <button disabled={sinRed} onClick={() => keycloak.login({ redirectUri: window.location.origin + '/' })}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-semibold rounded-xl shadow-lg hover:brightness-110 transition disabled:opacity-50">
          Ingresar al sistema
        </button>
        <p className="text-xs text-slate-500 text-center mt-6">
          Sesión segura · Autenticación unificada
        </p>
      </div>
    </div>
  );
}

// Catálogo de módulos y sus sub-vistas. El sidebar los expande como carpetas.
type Modulo = {
  key: string;
  base: string;
  label: string;
  roles: ('admin' | 'cocinero' | 'caja' | 'nutri' | 'estudiante')[];
};

const MODULOS: Modulo[] = [
  {
    key: 'portal', base: '/portal', label: 'Portal estudiantil',
    roles: ['admin', 'estudiante'],
  },
  {
    key: 'backoffice', base: '/backoffice', label: 'Gestión operativa',
    roles: ['admin', 'cocinero', 'caja', 'nutri'],
  },
  {
    key: 'bi', base: '/bi', label: 'Analítica e inteligencia',
    roles: ['admin', 'nutri'],
  },
];

function rolesParaAcceso(roles: string[]): string[] {
  const low = roles.map(r => r.toLowerCase());
  const out: string[] = [];
  if (low.some(r => r === 'administrador' || r.includes('admin'))) out.push('admin');
  if (low.some(r => r.includes('cocin'))) out.push('cocinero');
  if (low.some(r => r.includes('caja'))) out.push('caja');
  if (low.some(r => r.includes('nutri'))) out.push('nutri');
  if (low.some(r => r === 'estudiante' || r.includes('estudiante'))) out.push('estudiante');
  if (out.length === 0) out.push('estudiante');  // default fallback
  return out;
}

function Sidebar({ user, roles }: { user: string; roles: string[] }) {
  const accesos = rolesParaAcceso(roles);
  const modulosVisibles = MODULOS.filter(m => m.roles.some(r => accesos.includes(r)));
  const rolLabel = accesos.includes('admin') ? 'Administrador'
    : accesos.includes('cocinero') ? 'Cocinero'
    : accesos.includes('caja') ? 'Caja'
    : accesos.includes('nutri') ? 'Nutricionista'
    : 'Estudiante';

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 min-h-screen sticky top-0 flex flex-col">
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold tracking-tight">CU</span>
          </div>
          <div>
            <div className="font-semibold text-white tracking-tight">Comedor Universitario</div>
            <div className="text-xs text-slate-400">Plataforma de gestión</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3">
        <div className="text-[10px] font-semibold text-slate-500 px-3 mb-3 tracking-wider uppercase">Módulos</div>
        <div className="space-y-1">
          {modulosVisibles.map(m => (
            <NavLink key={m.key} to={m.base}
              className={({ isActive }) =>
                "block px-3 py-3 rounded-lg transition text-sm font-medium " +
                (isActive ? "bg-slate-800 text-white border-l-2 border-orange-500"
                          : "text-slate-400 hover:bg-slate-800/60 hover:text-white")}>
              {m.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-800/60 rounded-lg p-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-slate-700 to-slate-600 rounded-full flex items-center justify-center text-sm font-semibold text-white">
              {(user[0] || 'U').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{user}</div>
              <div className="text-xs text-slate-400">{rolLabel}</div>
            </div>
          </div>
        </div>
        <button onClick={cerrarSesion}
          className="w-full py-2 text-xs text-slate-400 hover:text-red-400 transition">
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

function HomePage({ user, roles }: { user: string; roles: string[] }) {
  const nav = useNavigate();
  const accesos = rolesParaAcceso(roles);
  const modulos = MODULOS.filter(m => m.roles.some(r => accesos.includes(r)));
  const descr: Record<string, string> = {
    portal: 'Consulta de menú, reservas y pagos.',
    backoffice: 'Menús, inventario, caja, estudiantes y becas.',
    bi: 'Dashboards y modelos de IA: predicción, agrupación de platos y desperdicio por foto.',
  };
  const rolLabel = accesos.includes('admin') ? 'Administrador'
    : accesos.includes('cocinero') ? 'Cocinero'
    : accesos.includes('caja') ? 'Caja'
    : accesos.includes('nutri') ? 'Nutricionista'
    : 'Estudiante';

  return (
    <div className="p-12">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-semibold text-white tracking-tight mb-2">Bienvenido, {user}</h1>
        <p className="text-slate-400 mb-10">Rol activo: <span className="text-white font-medium">{rolLabel}</span></p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {modulos.map(m => (
            <button key={m.key} onClick={() => nav(m.base)}
              className="group bg-slate-800/50 hover:bg-slate-800 border border-slate-700 hover:border-orange-500 rounded-xl p-6 text-left transition">
              <h3 className="font-semibold text-white text-lg">{m.label}</h3>
              <p className="text-sm text-slate-400 mt-2">{descr[m.key]}</p>
              <div className="mt-6 text-xs text-orange-400 group-hover:text-orange-300">Abrir módulo →</div>
            </button>
          ))}
        </div>
        {modulos.length === 0 && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-6 text-amber-300">
            Su usuario no tiene módulos asignados. Contacte al administrador.
          </div>
        )}
      </div>
    </div>
  );
}

// Iframe que:
// - Envía token SSO al microfrontend embebido
// - Replica el path /backoffice/XXX dentro del iframe (ej → /XXX)
// - Agrega ?embedded=1 para que el microfrontend oculte su sidebar interno
function MicrofrontendIframe({ baseUrl, token, title }: { baseUrl: string; token: string; title: string }) {
  const url = `${baseUrl}/?embedded=1`;
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const sendToken = () => iframeRef.current?.contentWindow?.postMessage({ type: 'SSO_TOKEN', token }, '*');
    const t = setTimeout(sendToken, 800);
    const handler = (e: MessageEvent) => { if (e.data?.type === 'MF_READY') sendToken(); };
    window.addEventListener('message', handler);
    return () => { clearTimeout(t); window.removeEventListener('message', handler); };
  }, [token]);

  return <iframe ref={iframeRef} src={url} className="w-full h-screen border-0 block" title={title} />;
}

// Con conexión, carga una vez por sesión los módulos permitidos: instalan su service worker y luego abren sin internet.
function PrecargaOffline({ roles }: { roles: string[] }) {
  const [marcos, setMarcos] = useState<string[]>([]);
  useEffect(() => {
    if (!navigator.onLine || sessionStorage.getItem('shell.precarga')) return;
    sessionStorage.setItem('shell.precarga', '1');
    const accesos = rolesParaAcceso(roles);
    const puede = (key: string) => MODULOS.find(m => m.key === key)!.roles.some(r => accesos.includes(r));
    const espera = setTimeout(() => {
      // @ts-expect-error federated module
      if (puede('portal')) import('portal/App').catch(() => {});
      setMarcos([...(puede('backoffice') ? [BACKOFFICE_URL] : []), ...(puede('bi') ? [BI_URL] : [])]);
    }, 3000);
    const fin = setTimeout(() => setMarcos([]), 45000);
    return () => { clearTimeout(espera); clearTimeout(fin); };
  }, [roles]);
  return <>{marcos.map(u => <iframe key={u} src={u} title="Precarga" aria-hidden="true" tabIndex={-1} style={{ display: 'none' }} />)}</>;
}

function App() {
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState(false);
  const [user, setUser] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [token, setToken] = useState('');
  const [sinKeycloak, setSinKeycloak] = useState(false);
  const [enLinea, setEnLinea] = useState(navigator.onLine);

  useEffect(() => {
    hayKeycloak().then(hay => {
      if (!hay) {                     // sin conexión se entra con la última sesión guardada en este equipo
        const guardado = localStorage.getItem('kc_token') || '';
        const datos = datosDelToken(guardado);
        setSinKeycloak(true);
        if (datos) { setUser(datos.user); setRoles(datos.roles); setToken(guardado); setAuth(true); }
        setReady(true);
        return;
      }
      return keycloak.init({ onLoad: 'check-sso', checkLoginIframe: false, pkceMethod: 'S256' })
        .then(a => {
          setReady(true); setAuth(a);
          const datos = a ? datosDelToken(keycloak.token || '') : null;
          if (datos) {
            setUser(datos.user);
            setRoles(datos.roles);
            setToken(keycloak.token || '');
            localStorage.setItem('kc_token', keycloak.token || '');
            document.cookie = `kc_token=${keycloak.token}; path=/`;
            (window as any).__KEYCLOAK_TOKEN__ = keycloak.token;
          }
        }).catch(e => { setReady(true); console.error('kc init', e); });
    });

    const i = setInterval(() => {
      if (keycloak.authenticated) {
        keycloak.updateToken(70).then(() => {
          localStorage.setItem('kc_token', keycloak.token || '');
          setToken(keycloak.token || '');
        }).catch(() => hayKeycloak().then(hay => { if (hay) cerrarSesion(); }));   // sin red no se cierra la sesión
      }
    }, 60000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const alCaer = () => setEnLinea(false);
    // Si se entró sin conexión, al volver la red se recarga para renovar la sesión con Keycloak.
    const alVolver = () => { setEnLinea(true); if (sinKeycloak) window.location.reload(); };
    window.addEventListener('offline', alCaer);
    window.addEventListener('online', alVolver);
    return () => { window.removeEventListener('offline', alCaer); window.removeEventListener('online', alVolver); };
  }, [sinKeycloak]);

  if (!ready) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Cargando…</div>;
  if (!auth) return <LoginScreen sinRed={sinKeycloak} />;

  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-slate-900">
        <Sidebar user={user} roles={roles} />
        {!sinKeycloak && <PrecargaOffline roles={roles} />}
        <main className="flex-1 overflow-auto">
          {(!enLinea || sinKeycloak) && (
            <div className="px-4 py-2 bg-amber-500/15 border-b border-amber-500/40 text-amber-300 text-xs">
              Sin conexión: trabajas con los últimos datos guardados en este equipo.
            </div>
          )}
          <Suspense fallback={<div className="p-12 text-slate-400">Cargando módulo…</div>}>
            <Routes>
              <Route path="/" element={<HomePage user={user} roles={roles} />} />
              <Route path="/portal/*" element={<RemotePortal />} />
              <Route path="/backoffice/*" element={<MicrofrontendIframe baseUrl={BACKOFFICE_URL} token={token} title="Gestión operativa" />} />
              <Route path="/bi/*" element={<MicrofrontendIframe baseUrl={BI_URL} token={token} title="Analítica" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.ready.then((r) => {
      const urls = performance.getEntriesByType('resource')
        .filter((e) => ['script', 'link', 'css', 'img'].includes((e as PerformanceResourceTiming).initiatorType))
        .map((e) => e.name);
      r.active?.postMessage({ tipo: 'guardar', urls });
    });
  });
}
