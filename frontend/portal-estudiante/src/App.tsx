// Componente REMOTO del Portal estudiante.
// Exportado via Module Federation para que el shell lo importe.
// Lee el token Keycloak desde el shell (localStorage o window global).
import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import * as tf from '@tensorflow/tfjs';

const API = (import.meta as any).env?.VITE_API_URL || `http://${window.location.hostname}:8080`;

type Turno = 'DESAYUNO' | 'ALMUERZO' | 'CENA';

function hashVec(txt: string, dim = 64): number[] {
  const v = new Array(dim).fill(0);
  txt.toLowerCase().split(/\s+/).forEach(t => {
    let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    v[h % dim] += 1;
  });
  return v;
}
function tfSim(a: number[], b: number[]): number {
  return tf.tidy(() => {
    const ta = tf.tensor1d(a), tb = tf.tensor1d(b);
    const dot = ta.mul(tb).sum().arraySync() as number;
    const na = ta.norm().arraySync() as number, nb = tb.norm().arraySync() as number;
    return na * nb > 0 ? dot / (na * nb) : 0;
  });
}

// Obtiene el username y token del shell (SSO)
function useSSO() {
  const [user, setUser] = useState('');
  const [token, setToken] = useState('');
  useEffect(() => {
    const t = (window as any).__KEYCLOAK_TOKEN__ || localStorage.getItem('kc_token') || '';
    setToken(t);
    try {
      const payload = JSON.parse(atob(t.split('.')[1]));
      setUser(payload.preferred_username || 'estudiante');
    } catch { setUser('estudiante'); }
    if (t) axios.defaults.headers.common['Authorization'] = `Bearer ${t}`;
  }, []);
  return { user, token };
}

type Tab = 'menu' | 'reservas' | 'perfil';

type Reserva = {
  plato: string; fecha: string; turno: string;
  reservaId: string; status: string;
  metodo?: string; monto?: number;
  stripeUrl?: string; qrDataUri?: string; stripeRef?: string; payQr?: string;
  pagadaAt?: string; createdAt: string;
};

const STORAGE_KEY = (u: string) => `portal.reservas.${u || 'anon'}`;

export default function App() {
  const { user } = useSSO();
  const [turno, setTurno] = useState<Turno>('ALMUERZO');
  const [menus, setMenus] = useState<any[]>([]);
  const [beca, setBeca] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('menu');
  const [reserva, setReserva] = useState<any>(null);
  const [historial, setHistorial] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [toast, setToast] = useState<{ msg: string, kind: 'ok' | 'err' } | null>(null);
  const [pagoOk, setPagoOk] = useState<Reserva | null>(null);

  // Rehidratar historial desde localStorage al cambiar user
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY(user));
      if (raw) setHistorial(JSON.parse(raw));
    } catch {}
  }, [user]);

  // Persistir cada cambio
  useEffect(() => {
    if (user) try { localStorage.setItem(STORAGE_KEY(user), JSON.stringify(historial)); } catch {}
  }, [user, historial]);

  useEffect(() => { axios.get(`${API}/menus/semana/${turno}`).then(r => setMenus(r.data)).catch(() => {}); }, [turno]);
  useEffect(() => { if (user) axios.get(`${API}/estudiantes/${user}/beca`).then(r => setBeca(r.data)).catch(() => {}); }, [user]);

  // Un solo bloque por día: se fusionan los menús repetidos y se ordena por fecha.
  const dias = useMemo(() => {
    const mapa = new Map<string, { fecha: string; turno: string; platos: Map<string, any> }>();
    for (const m of menus) {
      const d = mapa.get(m.fecha) || { fecha: m.fecha, turno: m.turno, platos: new Map() };
      for (const [id, p] of Object.entries<any>(m.porciones || {})) {
        const previo = d.platos.get(id);
        if (!previo || p.disponibles > previo.disponibles) {
          d.platos.set(id, { id, menuId: m.id, cupo: p.cupo, disponibles: p.disponibles });
        }
      }
      mapa.set(m.fecha, d);
    }
    const qv = busqueda ? hashVec(busqueda) : null;
    return [...mapa.values()]
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map(d => {
        const platos = [...d.platos.values()];
        if (qv) platos.sort((x, y) =>
          tfSim(hashVec(y.id.replace(/[-_]/g, ' ')), qv) - tfSim(hashVec(x.id.replace(/[-_]/g, ' ')), qv));
        return { fecha: d.fecha, turno: d.turno, platos };
      });
  }, [busqueda, menus]);

  const reservaDelDia = (fecha: string) =>
    historial.find(h => h.fecha === fecha && h.status !== 'CANCELADA');

  const notif = (msg: string, kind: 'ok' | 'err') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 4000); };

  const reservar = async (menuId: string, platoId: string, fecha: string, t: string) => {
    const previa = reservaDelDia(fecha);
    if (previa) {
      if (previa.status === 'PENDIENTE_PAGO' && previa.stripeUrl) {
        setReserva({ reservaId: previa.reservaId, stripe: { paymentUrl: previa.stripeUrl, qrDataUri: previa.qrDataUri, gatewayRef: previa.stripeRef } });
      } else {
        notif('Ya tenés una reserva para ese día', 'err');
      }
      return;
    }
    setLoading(platoId);
    try {
      const idem = `portal-${user}-${fecha}-${platoId}`;
      const metodo = beca?.cubreHoy ? 'beca' : 'qr_bancario';
      const r = await axios.post(`${API}/sagas/reservar-y-pagar`, {
        estudiante_id: user, menu_id: menuId, plato_id: platoId, fecha, turno: t, metodo_pago: metodo, monto: 10, idempotency_key: idem,
      });
      const pendiente = r.data.status === 'PENDING_PAYMENT';
      const nueva: Reserva = {
        plato: platoId, fecha, turno: t, reservaId: r.data.reservaId,
        status: pendiente ? 'PENDIENTE_PAGO' : 'PAGADA',
        metodo, monto: metodo === 'beca' ? 0 : 10,
        stripeUrl: r.data.stripe?.paymentUrl,
        stripeRef: r.data.stripe?.gatewayRef,
        qrDataUri: r.data.stripe?.qrDataUri,
        payQr: r.data.qr ? r.data.qr.split('::')[1] : undefined,
        pagadaAt: pendiente ? undefined : new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      setHistorial(h => [nueva, ...h]);
      if (pendiente) {
        setReserva(r.data);
      } else {
        setPagoOk({ ...nueva, qrDataUri: nueva.payQr });
      }
    } catch (e: any) {
      notif(e.response?.data?.detail || e.message, 'err');
    } finally { setLoading(null); }
  };

  const [verificando, setVerificando] = useState(false);
  const [cargandoFactura, setCargandoFactura] = useState<string | null>(null);

  // Abre la factura/recibo de Stripe de una reserva ya pagada.
  const verFactura = async (r: Reserva) => {
    if (!r.stripeRef) return;
    setCargandoFactura(r.reservaId);
    try {
      const res = await axios.get(`${API}/pagos/recibo/${r.stripeRef}`);
      if (res.data?.url) window.open(res.data.url, '_blank', 'noopener');
      else notif(res.data?.error || 'La factura todavía no está disponible', 'err');
    } catch (e: any) {
      notif(e.response?.data?.error || 'No se pudo obtener la factura', 'err');
    } finally { setCargandoFactura(null); }
  };

  // La reserva solo se confirma cuando el pago está acreditado.
  const confirmarPago = async () => {
    const ref = reserva?.stripe?.gatewayRef;
    if (!reserva?.reservaId || !ref) { notif('No se encontró la referencia del pago', 'err'); return; }
    setVerificando(true);
    try {
      const r = await axios.post(`${API}/sagas/confirmar-pago`, { reserva_id: reserva.reservaId, referencia: ref });
      if (r.data?.confirmada) {
        const now = new Date().toISOString();
        const qr = r.data.qr ? String(r.data.qr).split('::')[1] : undefined;
        const base = historial.find(x => x.reservaId === reserva.reservaId);
        setHistorial(h => h.map(x => x.reservaId === reserva.reservaId
          ? { ...x, status: 'PAGADA', pagadaAt: now, payQr: qr || x.payQr } : x));
        if (base) setPagoOk({ ...base, status: 'PAGADA', pagadaAt: now, qrDataUri: qr || base.payQr });
        setReserva(null);
      } else {
        notif('El pago todavía no figura como acreditado. Completalo y volvé a verificar.', 'err');
      }
    } catch (e: any) {
      notif(e.response?.data?.detail || 'No se pudo verificar el pago', 'err');
    } finally {
      setVerificando(false);
    }
  };

  const tabs: { id: Tab, label: string }[] = [
    { id: 'menu', label: 'Menú' },
    { id: 'reservas', label: 'Mis reservas' },
    { id: 'perfil', label: 'Perfil' },
  ];

  return (
    <div className="p-6 text-slate-100">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Portal estudiantil</h1>
              <p className="text-sm text-slate-400 mt-1">Sesión de <span className="text-white font-medium">{user}</span></p>
            </div>
            {beca?.tieneBeca && (
              <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/40 rounded-lg">
                <div className="text-xs text-emerald-400 uppercase tracking-wider">Beca activa</div>
                <div className="text-sm text-white font-semibold">{beca.tipo} · {beca.racionesUsadasMes}/{beca.cupoRacionesMes} raciones</div>
              </div>
            )}
          </div>
        </header>

        <nav className="flex gap-1 border-b border-slate-800 mb-6">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={"px-4 py-3 text-sm font-medium transition " +
                (tab === t.id ? "border-b-2 border-cyan-500 text-white" : "text-slate-400 hover:text-white")}>
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'menu' && (
          <>
            <div className="flex gap-3 mb-5">
              <div className="relative flex-1">
                
                <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar plato"
                  className="w-full pl-4 pr-3 py-2.5 bg-slate-800 border border-slate-700 text-white rounded-lg" />
              </div>
              <select value={turno} onChange={e => setTurno(e.target.value as Turno)}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 text-white rounded-lg">
                <option>DESAYUNO</option><option>ALMUERZO</option><option>CENA</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {dias.length === 0 && <div className="col-span-full text-center py-10 text-slate-500">Sin menús publicados.</div>}
              {dias.map(d => {
                const previa = reservaDelDia(d.fecha);
                return (
                  <div key={d.fecha} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
                    <div className="flex justify-between items-center mb-1">
                      <b className="text-white">{d.fecha}</b>
                      <span className="px-2 py-0.5 bg-slate-700 text-xs text-slate-300 rounded">{d.turno}</span>
                    </div>
                    {previa ? (
                      <div className="mb-2 text-xs rounded-lg px-3 py-2 bg-emerald-500/10 border border-emerald-500/40 text-emerald-300">
                        {previa.status === 'PAGADA' ? 'Reservaste' : 'Reserva pendiente de pago:'} <b>{previa.plato}</b>
                      </div>
                    ) : (
                      <div className="mb-2 text-xs text-slate-500">Elegí un plato. Se permite una reserva por día.</div>
                    )}
                    {d.platos.map(p => {
                      const pct = (p.disponibles / p.cupo) * 100;
                      const esLaReservada = previa?.plato === p.id;
                      const bloqueado = !!previa && !esLaReservada;
                      return (
                        <div key={p.id} className="border-t border-slate-700 pt-3 mt-3">
                          <div className="flex justify-between items-center mb-2">
                            <div>
                              <div className="text-white text-sm font-medium">{p.id}</div>
                              <div className="text-xs text-slate-400">{p.disponibles}/{p.cupo} disponibles</div>
                            </div>
                            <button onClick={() => reservar(p.menuId, p.id, d.fecha, d.turno)}
                              disabled={!p.disponibles || loading === p.id || bloqueado || (esLaReservada && previa?.status === 'PAGADA')}
                              className={"px-4 py-1.5 rounded-lg text-sm font-medium " +
                                (bloqueado || !p.disponibles || (esLaReservada && previa?.status === 'PAGADA')
                                  ? "bg-slate-700 text-slate-500" : "bg-gradient-to-r from-orange-500 to-amber-600 text-white")}>
                              {loading === p.id ? '…'
                                : esLaReservada ? (previa?.status === 'PAGADA' ? 'Reservado' : 'Continuar pago')
                                : !p.disponibles ? 'Agotado' : 'Reservar'}
                            </button>
                          </div>
                          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-orange-500 to-amber-600" style={{ width: pct + '%' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'reservas' && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-white font-bold">Mis reservas <span className="text-xs text-slate-500 font-normal">({historial.length})</span></h3>
              <button onClick={() => { if (confirm('¿Borrar todo el historial local?')) { setHistorial([]); localStorage.removeItem(STORAGE_KEY(user)); } }}
                className="text-xs text-slate-500 hover:text-red-400">Limpiar</button>
            </div>
            {historial.length === 0 ? <div className="text-center py-8 text-slate-500">Sin reservas. Reservá en Menú.</div> :
              <div className="space-y-2">
                {historial.map((r, i) => {
                  const esPagada = r.status === 'PAGADA';
                  return (
                    <div key={r.reservaId || i} className="bg-slate-900/50 rounded-lg p-4 flex justify-between items-center">
                      <div className="flex-1">
                        <div className="text-white font-medium">{r.plato}</div>
                        <div className="text-xs text-slate-400">{r.fecha} · {r.turno} · {r.metodo || 'qr_bancario'} · Bs {r.monto || 10}</div>
                        <code className="text-[10px] text-slate-500 block mt-1">#{r.reservaId?.slice(0, 16)}</code>
                      </div>
                      <div className="text-right ml-3">
                        <span className={"text-xs px-2.5 py-1 rounded-full font-mono " + (esPagada ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400')}>
                          {esPagada ? 'Pagada' : 'Pendiente'}
                        </span>
                        {r.pagadaAt && <div className="text-[10px] text-slate-500 mt-1">pagada {new Date(r.pagadaAt).toLocaleString()}</div>}
                        {esPagada && r.stripeRef && (
                          <button onClick={() => verFactura(r)} disabled={cargandoFactura === r.reservaId}
                            className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 text-white font-medium">
                            {cargandoFactura === r.reservaId ? 'Abriendo…' : 'Ver factura Stripe'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>}
          </div>
        )}

        {tab === 'perfil' && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-cyan-500 rounded-full flex items-center justify-center text-2xl font-bold text-white">{user[0]?.toUpperCase()}</div>
              <div>
                <h2 className="text-xl font-bold text-white">{user}</h2>
                <div className="text-xs text-emerald-400">SSO Keycloak OIDC</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="bg-slate-900/50 rounded-lg p-3"><div className="text-xs text-slate-400">Microfrontend</div><div className="text-sm text-cyan-400 font-mono">React remote</div></div>
              <div className="bg-slate-900/50 rounded-lg p-3"><div className="text-xs text-slate-400">IA local</div><div className="text-sm text-cyan-400 font-mono">TF.js activo</div></div>
            </div>
          </div>
        )}

        {reserva?.stripe?.paymentUrl && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-2xl p-8 max-w-md w-full border border-slate-700 shadow-2xl">
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h3 className="text-white font-bold text-lg">Pago con tarjeta</h3>
                  <p className="text-xs text-slate-400 mt-1">Reserva #{reserva.reservaId?.slice(0, 10)}…</p>
                </div>
                <button onClick={() => setReserva(null)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
              </div>
              <div className="bg-slate-900/60 rounded-xl p-4 mb-4">
                <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Monto</span><span className="text-white font-bold">Bs 10</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">Método</span><span className="text-white text-xs">Tarjeta de crédito o débito</span></div>
              </div>
              <a href={reserva.stripe.paymentUrl} target="_blank" rel="noreferrer"
                className="block py-3 bg-gradient-to-r from-orange-500 to-cyan-500 text-white font-semibold rounded-lg text-center mb-3 hover:scale-[1.02] transition">
                Pagar ahora →
              </a>
              {reserva.stripe.qrDataUri && (
                <div className="text-center mb-3">
                  <div className="text-[10px] text-slate-500 uppercase mb-2">o escaneá el QR</div>
                  <img src={reserva.stripe.qrDataUri} alt="QR" className="max-w-[180px] mx-auto bg-white p-2 rounded-lg" />
                </div>
              )}
              <button onClick={confirmarPago} disabled={verificando}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2">
                {verificando ? 'Consultando pago…' : 'Verificar pago'}
              </button>
              <p className="text-[11px] text-slate-500 text-center mt-2">Tu reserva se confirma cuando el pago queda acreditado.</p>
            </div>
          </div>
        )}

        {pagoOk && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setPagoOk(null)}>
            <div className="bg-slate-800 rounded-2xl p-8 max-w-md w-full border border-emerald-500/50 shadow-2xl text-center animate-in" onClick={e => e.stopPropagation()}>
              <div className="w-20 h-20 mx-auto bg-emerald-500 rounded-full flex items-center justify-center text-5xl mb-4">✓</div>
              <h3 className="text-2xl font-bold text-white mb-2">¡Pago exitoso!</h3>
              <p className="text-slate-400 text-sm mb-5">Tu reserva está confirmada</p>
              <div className="bg-slate-900/60 rounded-xl p-4 mb-5 text-left">
                <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Plato</span><span className="text-white font-medium">{pagoOk.plato}</span></div>
                <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Fecha</span><span className="text-white">{pagoOk.fecha} · {pagoOk.turno}</span></div>
                <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Monto</span><span className="text-emerald-400 font-bold">Bs {pagoOk.monto || 10}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">Reserva</span><code className="text-cyan-400 text-xs">{pagoOk.reservaId?.slice(0, 12)}…</code></div>
              </div>
              {pagoOk.qrDataUri && (
                <div className="mb-4">
                  <div className="text-[10px] text-slate-500 uppercase mb-2">Mostrá este QR en caja</div>
                  <img src={pagoOk.qrDataUri} alt="QR reserva" className="max-w-[160px] mx-auto bg-white p-2 rounded-lg" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { setPagoOk(null); setTab('reservas'); }}
                  className="py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm">Ver mis reservas</button>
                <button onClick={() => setPagoOk(null)}
                  className="py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white rounded-lg text-sm font-semibold">Listo</button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className={"fixed top-6 right-6 px-5 py-3 rounded-xl shadow-2xl z-50 " + (toast.kind === 'ok' ? "bg-emerald-500" : "bg-red-500")}>{toast.msg}</div>
        )}
      </div>
    </div>
  );
}
