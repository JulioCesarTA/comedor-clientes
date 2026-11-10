// Componente REMOTO del Portal estudiante.
// Exportado via Module Federation para que el shell lo importe.
// Lee el token Keycloak desde el shell (localStorage o window global).
import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import * as tf from '@tensorflow/tfjs';

const API = (import.meta as any).env?.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;

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
  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => {
    const t = (window as any).__KEYCLOAK_TOKEN__ || localStorage.getItem('kc_token') || '';
    setToken(t);
    try {
      const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      setUser(payload.preferred_username || 'estudiante');
      setRoles(payload.realm_access?.roles || []);
    } catch { setUser('estudiante'); }
    if (t) axios.defaults.headers.common['Authorization'] = `Bearer ${t}`;
  }, []);
  return { user, token, roles };
}

type Lugar = { lat: number; lon: number; radioM: number; actualizadoPor: string | null; actualizadoEn: string | null };

/** Solo administrador: dónde está el comedor. Las marcas de asistencia por GPS solo valen dentro del radio. */
function UbicacionComedor({ avisar }: { avisar: (m: string, k: 'ok' | 'err') => void }) {
  const [lugar, setLugar] = useState<Lugar | null>(null);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [radio, setRadio] = useState('1000');
  const [guardando, setGuardando] = useState(false);
  const [buscando, setBuscando] = useState(false);

  const mostrar = (l: Lugar) => { setLugar(l); setLat(String(l.lat)); setLon(String(l.lon)); setRadio(String(l.radioM)); };
  useEffect(() => {
    axios.get<Lugar>(`${API}/asistencia/lugar`).then(r => mostrar(r.data)).catch(e => avisar(motivoError(e), 'err'));
  }, []);

  const aqui = () => {
    if (!window.isSecureContext) {         // los navegadores solo dan el GPS en https o localhost
      avisar('El navegador solo da la ubicación en páginas https: copia las coordenadas de Google Maps y escríbelas.', 'err'); return;
    }
    if (!navigator.geolocation) { avisar('Este navegador no da la ubicación.', 'err'); return; }
    setBuscando(true);
    navigator.geolocation.getCurrentPosition(
      p => { setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); setBuscando(false);
        avisar(`Ubicación tomada (±${Math.round(p.coords.accuracy)} m). Revisa y pulsa Guardar.`, 'ok'); },
      e => { setBuscando(false); avisar(e.code === 1 ? 'Permite la ubicación para esta página.' : 'No se pudo obtener la ubicación.', 'err'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const guardar = async () => {
    const la = Number(lat.replace(',', '.')), lo = Number(lon.replace(',', '.')), r = Number(radio);
    if (!Number.isFinite(la) || Math.abs(la) > 90 || !Number.isFinite(lo) || Math.abs(lo) > 180) {
      avisar('Latitud entre -90 y 90 y longitud entre -180 y 180 (ej.: -17.80497, -63.15052).', 'err'); return;
    }
    setGuardando(true);
    try {
      const { data } = await axios.put<Lugar>(`${API}/asistencia/lugar`, { lat: la, lon: lo, radioM: r });
      mostrar(data);
      avisar('Ubicación del comedor guardada: las marcas de asistencia se comparan con este punto.', 'ok');
    } catch (e: any) {
      avisar(e.response?.data?.message || motivoError(e), 'err');
    } finally { setGuardando(false); }
  };

  const campo = 'w-full px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm font-mono focus:outline-none focus:border-cyan-500';
  const cambiado = lugar && (String(lugar.lat) !== lat || String(lugar.lon) !== lon || String(lugar.radioM) !== radio);
  return (
    <div className="mt-5 bg-slate-900/50 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-white font-semibold">Ubicación del comedor <span className="ml-2 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-orange-500/20 text-orange-300">solo administrador</span></h3>
        {lugar && <a href={`https://www.google.com/maps?q=${lugar.lat},${lugar.lon}`} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300">Ver en el mapa ↗</a>}
      </div>
      <p className="text-xs text-slate-400 mb-4">
        La asistencia por GPS solo se registra si la persona está dentro del radio de este punto; fuera de él, no se marca.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block"><span className="block text-[11px] text-slate-400 mb-1">Latitud</span>
          <input value={lat} onChange={e => setLat(e.target.value)} inputMode="decimal" placeholder="-17.80497" className={campo} /></label>
        <label className="block"><span className="block text-[11px] text-slate-400 mb-1">Longitud</span>
          <input value={lon} onChange={e => setLon(e.target.value)} inputMode="decimal" placeholder="-63.15052" className={campo} /></label>
        <label className="block"><span className="block text-[11px] text-slate-400 mb-1">Radio (metros)</span>
          <input value={radio} onChange={e => setRadio(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="1000" className={campo} /></label>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={aqui} disabled={buscando || guardando}
          className="px-4 py-2 rounded-lg text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-100">
          {buscando ? 'Buscando…' : '📍 Usar mi ubicación actual'}
        </button>
        <button onClick={guardar} disabled={guardando || !lat || !lon || !radio || !cambiado}
          className="px-5 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-orange-500 to-amber-600 disabled:opacity-40 text-white">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {lugar && (
        <div className="text-[11px] text-slate-500 mt-3">
          Vigente: {lugar.lat}, {lugar.lon} · radio {lugar.radioM} m
          {lugar.actualizadoPor ? ` · fijada por ${lugar.actualizadoPor}${lugar.actualizadoEn ? ' el ' + new Date(lugar.actualizadoEn).toLocaleString('es-BO') : ''}` : ' · valor inicial (todavía no se guardó ninguna)'}
        </div>
      )}
    </div>
  );
}

type Tab = 'menu' | 'reservas' | 'perfil';

type ReservaSrv = { id: string; platoId: string; fecha: string; turno: string; estado: string; qr: string | null; creada: string };
type PagoSrv = { id: string; reservaId: string; monto: number; metodo: string; estado: string; ticketId: string | null; fecha: string };
type PagoOk = { plato: string; fecha: string; turno: string; monto: number; reservaId: string; qrDataUri?: string; beca?: boolean };

// Precio de una ración por turno (Bs)
const PRECIO: Record<string, number> = { DESAYUNO: 6, ALMUERZO: 12, CENA: 10 };
const METODO: Record<string, string> = { qr_bancario: 'QR / tarjeta', efectivo: 'Efectivo', beca: 'Beca comedor' };

// El pago por QR ya iniciado queda guardado para poder continuarlo (o verificarlo) aunque se recargue la página
const PEND_KEY = (u: string) => `portal.pagos-iniciados.${u || 'anon'}`;
const leerPend = (u: string): Record<string, any> => { try { return JSON.parse(localStorage.getItem(PEND_KEY(u)) || '{}'); } catch { return {}; } };
const guardarPend = (u: string, id: string, info: any) => {
  try { const p = leerPend(u); if (info) p[id] = { ...info, t: Date.now() }; else delete p[id]; localStorage.setItem(PEND_KEY(u), JSON.stringify(p)); } catch { /* sin almacenamiento */ }
};

// Copia local (IndexedDB) de lo último recibido: sin conexión la pantalla muestra eso.
const abrirCopias = () => new Promise<IDBDatabase>((ok, mal) => {
  const r = indexedDB.open('portal', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => mal(r.error);
});
const guardarCopia = (clave: string, valor: unknown) =>
  abrirCopias().then(db => { db.transaction('kv', 'readwrite').objectStore('kv').put(valor, clave); }).catch(() => {});
const leerCopia = <T,>(clave: string) => abrirCopias().then(db => new Promise<T | undefined>(ok => {
  const q = db.transaction('kv').objectStore('kv').get(clave);
  q.onsuccess = () => ok(q.result);
  q.onerror = () => ok(undefined);
})).catch(() => undefined);

/** Pide al servidor y guarda la copia. Sin red (o con el servidor caído) devuelve la última copia. */
async function conCopia<T>(clave: string, ruta: string, params?: Record<string, string>): Promise<T | undefined> {
  try {
    const { data } = await axios.get<T>(`${API}${ruta}`, { params });
    guardarCopia(clave, data);
    return data;
  } catch (e: any) {
    if (e.response && e.response.status < 502) throw e;
    return leerCopia<T>(clave);
  }
}

const TURNOS: Turno[] = ['DESAYUNO', 'ALMUERZO', 'CENA'];
const fechaIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function semanasDesdeHoy(): string[] {
  const lunes = new Date();
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
  const proxima = new Date(lunes);
  proxima.setDate(lunes.getDate() + 7);
  return [fechaIso(lunes), fechaIso(proxima)];
}
const menusDe = (t: Turno, inicio: string) => conCopia<any[]>(`menus.${t}.${inicio}`, `/menus/semana/${t}`, { inicio }).catch(() => undefined);

const motivoError = (e: any) => e.response?.data?.detail || (e.response ? e.message : 'Sin conexión: esta acción necesita internet.');

const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Factura / recibo de una ración pagada, lista para imprimir o guardar como PDF. */
function facturaHtml(usuario: string, f: { r: ReservaSrv; p: PagoSrv }): string {
  const numero = 'F-' + String(f.p.ticketId || f.p.id).slice(0, 8).toUpperCase();
  const monto = f.p.metodo === 'beca' ? 'Bs 0,00 (cubierto por beca)' : 'Bs ' + Number(f.p.monto).toFixed(2).replace('.', ',');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${numero}</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:36px;max-width:680px} h1{margin:0;font-size:22px;color:#1e293b} .sub{color:#64748b;font-size:12px;margin:3px 0 20px}
.num{float:right;text-align:right;font-size:12px;color:#475569} table{width:100%;border-collapse:collapse;margin-top:14px} th{background:#1e293b;color:#fff;text-align:left;padding:8px;font-size:12px}
td{padding:9px 8px;border-bottom:1px solid #e2e8f0;font-size:13px} .t{text-align:right}.total{font-size:19px;font-weight:bold;text-align:right;margin-top:16px}
.pie{margin-top:30px;color:#94a3b8;font-size:11px;text-align:center}</style></head><body>
<div class="num"><b>${numero}</b><br>${esc(new Date(f.p.fecha).toLocaleString('es-BO'))}</div>
<h1>Comedor Universitario UAGRM</h1><div class="sub">Factura / recibo de ración</div>
<div><b>Cliente:</b> ${esc(usuario)}</div>
<table><thead><tr><th>Detalle</th><th>Fecha del servicio</th><th>Turno</th><th class="t">Monto</th></tr></thead>
<tbody><tr><td>${esc(f.r.platoId)}</td><td>${esc(f.r.fecha)}</td><td>${esc(f.r.turno)}</td><td class="t">${esc(monto)}</td></tr></tbody></table>
<div class="total">Total: ${esc(monto)}</div>
<div style="margin-top:16px;font-size:12px;color:#475569">Método de pago: <b>${esc(METODO[f.p.metodo] || f.p.metodo)}</b> · Reserva ${esc(f.r.id)}</div>
<div class="pie">Documento generado por el portal del estudiante · Comedor Universitario UAGRM</div></body></html>`;
}

export default function App() {
  const { user, roles } = useSSO();
  const esAdmin = roles.includes('administrador');
  const [turno, setTurno] = useState<Turno>('ALMUERZO');
  const [menus, setMenus] = useState<any[]>([]);
  const [beca, setBeca] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('menu');
  const [reserva, setReserva] = useState<any>(null);
  const [reservas, setReservas] = useState<ReservaSrv[]>([]);
  const [pagos, setPagos] = useState<PagoSrv[]>([]);
  const [pagando, setPagando] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [factura, setFactura] = useState<{ r: ReservaSrv; p: PagoSrv } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [toast, setToast] = useState<{ msg: string, kind: 'ok' | 'err' } | null>(null);
  const [pagoOk, setPagoOk] = useState<PagoOk | null>(null);
  const [sinRed, setSinRed] = useState(!navigator.onLine);

  // Las reservas y los pagos salen del servidor (no del navegador): se ven igual desde cualquier dispositivo
  const cargarReservas = async () => {
    if (!user) return;
    try {
      const [r, p] = await Promise.all([
        conCopia<ReservaSrv[]>(`reservas.${user}`, `/estudiantes/${user}/reservas`),
        conCopia<PagoSrv[]>(`pagos.${user}`, '/pagos', { estudiante: user }),
      ]);
      if (r) setReservas(r);
      if (p) setPagos(p);
    } catch { /* el servidor rechazó la consulta: se conserva lo que ya se mostraba */ }
  };
  useEffect(() => { cargarReservas(); }, [user]);
  useEffect(() => { if (tab === 'reservas') cargarReservas(); }, [tab]);
  const recargarMenus = () => setRecarga(n => n + 1);

  // Semana actual y la siguiente, solo desde hoy en adelante (no tiene sentido reservar días pasados)
  useEffect(() => {
    let vigente = true;
    const hoy = fechaIso(new Date());
    Promise.all(semanasDesdeHoy().map(inicio => menusDe(turno, inicio)))
      .then(([a, b]) => { if (vigente) setMenus([...(a || []), ...(b || [])].filter(m => m.fecha >= hoy)); });
    return () => { vigente = false; };
  }, [turno, recarga]);
  useEffect(() => { if (user) conCopia<any>(`beca.${user}`, `/estudiantes/${user}/beca`).then(b => { if (b) setBeca(b); }).catch(() => {}); }, [user]);

  // Con conexión deja guardados también los otros turnos, para verlos después sin internet
  useEffect(() => {
    if (navigator.onLine) TURNOS.filter(t => t !== turno).forEach(t => semanasDesdeHoy().forEach(inicio => menusDe(t, inicio)));
  }, []);

  useEffect(() => {
    const alCaer = () => setSinRed(true);
    const alVolver = () => { setSinRed(false); setRecarga(n => n + 1); };
    window.addEventListener('offline', alCaer);
    window.addEventListener('online', alVolver);
    return () => { window.removeEventListener('offline', alCaer); window.removeEventListener('online', alVolver); };
  }, []);
  useEffect(() => { if (recarga > 0) cargarReservas(); }, [recarga]);

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

  // Se puede reservar más de una ración por día: aquí solo se listan las que ya tiene.
  const reservasDelDia = (fecha: string) =>
    reservas.filter(r => r.fecha === fecha && r.estado !== 'cancelada');

  const notif = (msg: string, kind: 'ok' | 'err') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 4000); };

  // Reservar NO cobra: la porción queda apartada y la persona paga después, desde «Mis reservas».
  // Con beca vigente que cubre la ración queda confirmada de una vez (sin costo).
  const reservar = async (menuId: string, platoId: string, fecha: string, t: string) => {
    setLoading(platoId);
    try {
      const idem = `portal-${user}-${fecha}-${platoId}-${Date.now()}`;  // una clave por intento: permite varias reservas del mismo plato
      const r = await axios.post(`${API}/sagas/reservar`, { estudiante_id: user, menu_id: menuId, plato_id: platoId, fecha, turno: t, idempotency_key: idem });
      if (r.data.status === 'COMPLETED') {
        setPagoOk({ plato: platoId, fecha, turno: t, monto: 0, beca: true, reservaId: r.data.reservaId, qrDataUri: r.data.qr ? String(r.data.qr).split('::')[1] : undefined });
        axios.get(`${API}/estudiantes/${user}/beca`).then(b => setBeca(b.data)).catch(() => {});
      } else {
        notif('Reserva creada. Págala cuando quieras en «Mis reservas».', 'ok');
      }
      recargarMenus();
    } catch (e: any) {
      notif(motivoError(e), 'err');
    } finally { setLoading(null); }
  };

  // Pagar una reserva pendiente (QR / tarjeta por Stripe). Si ya inició el pago, se continúa el mismo.
  const pagar = async (r: ReservaSrv) => {
    setPagando(r.id);
    try {
      const monto = PRECIO[r.turno] ?? 10;
      const previo = leerPend(user)[r.id];
      if (previo && Date.now() - previo.t < 20 * 3600 * 1000) { setReserva({ reservaId: r.id, stripe: previo, monto }); return; }
      const res = await axios.post(`${API}/sagas/pagar`, { reserva_id: r.id, estudiante_id: user, metodo_pago: 'qr_bancario', monto, idempotency_key: `pagar-${r.id}-${Date.now()}` });
      if (res.data.status === 'PENDING_PAYMENT') { guardarPend(user, r.id, res.data.stripe); setReserva({ reservaId: r.id, stripe: res.data.stripe, monto }); }
      else { setPagoOk({ plato: r.platoId, fecha: r.fecha, turno: r.turno, monto, reservaId: r.id, qrDataUri: res.data.qr ? String(res.data.qr).split('::')[1] : undefined }); cargarReservas(); }
    } catch (e: any) {
      notif(motivoError(e), 'err');
    } finally { setPagando(null); }
  };

  // Cancelar una reserva que todavía no se pagó: la porción vuelve al cupo
  const cancelarReserva = async (r: ReservaSrv) => {
    if (!confirm('¿Cancelar esta reserva? Tu porción se libera.')) return;
    setPagando(r.id);
    try {
      await axios.post(`${API}/sagas/cancelar-reserva`, { reserva_id: r.id });
      guardarPend(user, r.id, null);
      notif('Reserva cancelada', 'ok');
      recargarMenus();
    } catch (e: any) {
      notif(motivoError(e), 'err');
    } finally { setPagando(null); }
  };

  // El pago más reciente de la reserva
  const pagoDe = (r: ReservaSrv): PagoSrv | undefined =>
    pagos.filter(p => p.reservaId === r.id).sort((a, b) => a.fecha.localeCompare(b.fecha)).pop();
  const abrirFactura = (r: ReservaSrv) => {
    const p = pagoDe(r);
    if (!p) { notif('Todavía no hay factura para esta reserva', 'err'); return; }
    setFactura({ r, p });
  };
  const imprimirFactura = () => {                      // se abre el diálogo de impresión: elige «Guardar como PDF»
    if (!factura) return;
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.srcdoc = facturaHtml(user, factura);
    f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 60000); };
  };

  const [verificando, setVerificando] = useState(false);

  // La reserva solo se confirma cuando el pago está acreditado.
  const confirmarPago = async () => {
    const ref = reserva?.stripe?.gatewayRef;
    if (!reserva?.reservaId || !ref) { notif('No se encontró la referencia del pago', 'err'); return; }
    setVerificando(true);
    try {
      const r = await axios.post(`${API}/sagas/confirmar-pago`, { reserva_id: reserva.reservaId, referencia: ref });
      if (r.data?.confirmada) {
        const info = reservas.find(x => x.id === reserva.reservaId);
        const qr = r.data.qr ? String(r.data.qr).split('::')[1] : undefined;
        guardarPend(user, reserva.reservaId, null);
        setPagoOk({ plato: info?.platoId || '', fecha: info?.fecha || '', turno: info?.turno || '', monto: reserva.monto ?? PRECIO[info?.turno || ''] ?? 10, reservaId: reserva.reservaId, qrDataUri: qr });
        setReserva(null);
        cargarReservas();
      } else {
        notif('El pago todavía no figura como acreditado. Complétalo y vuelve a verificar.', 'err');
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
        {sinRed && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-sm">
            Sin conexión: ves los últimos datos guardados. Para reservar, pagar o cancelar necesitas internet.
          </div>
        )}
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
                  placeholder="Buscar ensala"
                  className="w-full pl-4 pr-3 py-2.5 bg-slate-800 border border-slate-700 text-white rounded-lg" />
              </div>
              <select value={turno} onChange={e => setTurno(e.target.value as Turno)}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 text-white rounded-lg">
                <option>DESAYUNO</option><option>ALMUERZO</option><option>CENA</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {dias.length === 0 && <div className="col-span-full text-center py-10 text-slate-500">{sinRed ? 'Todavía no hay una copia del menú en este equipo: ábrelo una vez con internet.' : 'Sin menús publicados.'}</div>}
              {dias.map(d => {
                const delDia = reservasDelDia(d.fecha);
                return (
                  <div key={d.fecha} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
                    <div className="flex justify-between items-center mb-1">
                      <b className="text-white">{d.fecha}</b>
                      <span className="px-2 py-0.5 bg-slate-700 text-xs text-slate-300 rounded">{d.turno}</span>
                    </div>
                    {delDia.length > 0 ? (
                      <div className="mb-2 text-xs rounded-lg px-3 py-2 bg-emerald-500/10 border border-emerald-500/40 text-emerald-300">
                        Tus reservas de este día ({delDia.length}):{' '}
                        {delDia.map((r, i) => (
                          <span key={r.id}>{i > 0 ? ', ' : ''}<b>{r.platoId}</b>{r.estado === 'pendiente' ? ' (pendiente de pago)' : ''}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="mb-2 text-xs text-slate-500">
                        {beca?.tieneBeca ? 'Con beca puedes reservar una ración por día, sin costo.' : 'Elige un plato. Puedes reservar varias raciones y pagar cada una después, en «Mis reservas».'}
                      </div>
                    )}
                    {d.platos.map(p => {
                      const pct = (p.disponibles / p.cupo) * 100;
                      const veces = delDia.filter(r => r.platoId === p.id).length;
                      const bloqueadoBeca = !!beca?.tieneBeca && delDia.length > 0;   // la beca cubre una ración por día
                      return (
                        <div key={p.id} className="border-t border-slate-700 pt-3 mt-3">
                          <div className="flex justify-between items-center mb-2">
                            <div>
                              <div className="text-white text-sm font-medium">{p.id}</div>
                              <div className="text-xs text-slate-400">{p.disponibles}/{p.cupo} disponibles</div>
                            </div>
                            <button onClick={() => reservar(p.menuId, p.id, d.fecha, d.turno)}
                              disabled={!p.disponibles || loading === p.id || bloqueadoBeca}
                              className={"px-4 py-1.5 rounded-lg text-sm font-medium " +
                                (!p.disponibles || bloqueadoBeca ? "bg-slate-700 text-slate-500" : "bg-gradient-to-r from-orange-500 to-amber-600 text-white")}>
                              {loading === p.id ? '…' : !p.disponibles ? 'Agotado' : bloqueadoBeca ? 'Ya reservaste hoy' : veces > 0 ? 'Reservar otro' : 'Reservar'}
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
              <h3 className="text-white font-bold">Mis reservas <span className="text-xs text-slate-500 font-normal">({reservas.length})</span></h3>
              <button onClick={cargarReservas} className="text-xs text-cyan-400 hover:text-cyan-300">↻ Actualizar</button>
            </div>
            {reservas.length === 0 ? <div className="text-center py-8 text-slate-500">Sin reservas. Reserva en Menú.</div> :
              <div className="space-y-2">
                {reservas.slice(0, 60).map(r => {
                  const pendiente = r.estado === 'pendiente';
                  const cancelada = r.estado === 'cancelada';
                  const pagada = r.estado === 'confirmada' || r.estado === 'consumida';
                  const p = pagada ? pagoDe(r) : undefined;
                  const monto = PRECIO[r.turno] ?? 10;
                  const etiqueta = pendiente ? 'Pendiente de pago' : r.estado === 'consumida' ? 'Servida' : pagada ? 'Pagada' : 'Cancelada';
                  return (
                    <div key={r.id} className={"bg-slate-900/50 rounded-lg p-4 flex justify-between items-center gap-3 " + (cancelada ? 'opacity-60' : '')}>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">{r.platoId}</div>
                        <div className="text-xs text-slate-400">{r.fecha} · {r.turno} · {pagada ? (p ? (p.metodo === 'beca' ? 'Beca (sin costo)' : `${METODO[p.metodo] || p.metodo} · Bs ${Number(p.monto).toFixed(2)}`) : 'Pagada') : `Bs ${monto}`}</div>
                        <code className="text-[10px] text-slate-500 block mt-1">#{r.id.slice(0, 16)}</code>
                      </div>
                      <div className="text-right">
                        <span className={"text-xs px-2.5 py-1 rounded-full font-mono " + (pagada ? 'bg-emerald-500/20 text-emerald-400' : pendiente ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-600/40 text-slate-400')}>{etiqueta}</span>
                        <div className="flex gap-2 justify-end mt-2 flex-wrap">
                          {pendiente && (
                            <>
                              <button onClick={() => pagar(r)} disabled={pagando === r.id}
                                className="text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 disabled:opacity-50 text-white font-medium">
                                {pagando === r.id ? '…' : `Pagar Bs ${monto}`}
                              </button>
                              <button onClick={() => cancelarReserva(r)} disabled={pagando === r.id}
                                className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200">Cancelar</button>
                            </>
                          )}
                          {pagada && r.qr && (
                            <button onClick={() => setPagoOk({ plato: r.platoId, fecha: r.fecha, turno: r.turno, monto: p?.monto ?? 0, beca: p?.metodo === 'beca', reservaId: r.id, qrDataUri: String(r.qr).split('::')[1] })}
                              className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200">Ver QR</button>
                          )}
                          {pagada && (
                            <button onClick={() => abrirFactura(r)} className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium">Ver factura</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {reservas.length > 60 && <div className="text-xs text-slate-500 text-center pt-2">Se muestran las 60 más recientes.</div>}
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
            {esAdmin && <UbicacionComedor avisar={notif} />}
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
                <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Monto</span><span className="text-white font-bold">Bs {reserva.monto ?? 10}</span></div>
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
              <h3 className="text-2xl font-bold text-white mb-2">{pagoOk.beca ? '¡Reserva confirmada!' : '¡Pago exitoso!'}</h3>
              <p className="text-slate-400 text-sm mb-5">{pagoOk.beca ? 'Cubierta por tu beca comedor' : 'Tu reserva está confirmada'}</p>
              <div className="bg-slate-900/60 rounded-xl p-4 mb-5 text-left">
                <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Plato</span><span className="text-white font-medium">{pagoOk.plato}</span></div>
                <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Fecha</span><span className="text-white">{pagoOk.fecha} · {pagoOk.turno}</span></div>
                <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">Monto</span><span className="text-emerald-400 font-bold">{pagoOk.beca ? 'Beca (sin costo)' : `Bs ${pagoOk.monto}`}</span></div>
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

        {factura && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setFactura(null)}>
            <div className="bg-white text-slate-900 rounded-2xl p-7 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-start mb-1">
                <div>
                  <div className="text-lg font-bold text-slate-800">Comedor Universitario UAGRM</div>
                  <div className="text-xs text-slate-500">Factura / recibo de ración</div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <b className="text-slate-800">F-{String(factura.p.ticketId || factura.p.id).slice(0, 8).toUpperCase()}</b><br />
                  {new Date(factura.p.fecha).toLocaleString('es-BO')}
                </div>
              </div>
              <div className="text-sm mt-4 mb-3"><b>Cliente:</b> {user}</div>
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-800 text-white text-xs"><th className="text-left p-2">Detalle</th><th className="text-left p-2">Servicio</th><th className="text-right p-2">Monto</th></tr></thead>
                <tbody><tr className="border-b border-slate-200">
                  <td className="p-2">{factura.r.platoId}</td>
                  <td className="p-2">{factura.r.fecha}<br /><span className="text-xs text-slate-500">{factura.r.turno}</span></td>
                  <td className="p-2 text-right">{factura.p.metodo === 'beca' ? 'Bs 0,00' : `Bs ${Number(factura.p.monto).toFixed(2).replace('.', ',')}`}</td>
                </tr></tbody>
              </table>
              <div className="text-right text-lg font-bold mt-3">Total: {factura.p.metodo === 'beca' ? 'Bs 0,00 (beca)' : `Bs ${Number(factura.p.monto).toFixed(2).replace('.', ',')}`}</div>
              <div className="text-xs text-slate-500 mt-3">Método de pago: <b>{METODO[factura.p.metodo] || factura.p.metodo}</b> · Reserva #{factura.r.id.slice(0, 12)}</div>
              <div className="grid grid-cols-2 gap-3 mt-5">
                <button onClick={() => setFactura(null)} className="py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-sm">Cerrar</button>
                <button onClick={imprimirFactura} className="py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg text-sm font-semibold">Imprimir / PDF</button>
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
