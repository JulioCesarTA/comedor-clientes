'use client';
// Reportes por texto o por voz. El pedido en español se manda al backend (POST /reportes/consulta), que lo interpreta,
// lo ejecuta contra los datos de tu rol y devuelve tabla, gráfico y resumen. Aquí solo se pinta y se exporta.
// El motor es el MISMO para el portal, este panel y la app móvil: vive una sola vez, en ia-ml-service.
import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../components/Charts';
import { API } from '../lib/vivo';
import { aCsv, aHtml, aXlsxBase64, dmyIso, fmtValor, nombreArchivo } from '../lib/reportes/exportar';
import { guardar, leerGuardado, token } from '../lib/reportes/datos';
import { crearDictado, vozDisponible, Dictado } from '../lib/reportes/voz';

const FORMATOS: [string, string][] = [['pantalla', 'Pantalla'], ['pdf', 'PDF'], ['excel', 'Excel'], ['csv', 'CSV']];
const POR: [string, string][] = [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']];
const PALETA = ['#f97316', '#06b6d4', '#8b5cf6', '#10b981', '#ef4444', '#eab308'];
const MAX_FILAS_TABLA = 300;

type Columna = { key: string; label: string; tipo: string; fmt?: string };
type Reporte = {
  titulo: string; dataset: string; datasetEtiqueta: string; modo: string;
  columnas: Columna[]; filas: any[]; totales: Record<string, number> | null;
  grafico: { tipo: string; x: string; y: string[]; etiquetas: Record<string, string> } | null;
  resumen: string[]; condiciones: string[]; notas: string[];
  registrosAnalizados: number; totalFilas: number; mostradas: number; generado: string;
  spec: any; entendi: string; confianza?: number;
};
type DatasetAyuda = { id: string; etiqueta: string; descripcion: string; columnas: Columna[]; ejemplos: string[] };

function Chip({ texto, activo, onClick }: { texto: string; activo?: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={'px-3 py-1 rounded-full text-xs border transition ' + (activo ? 'bg-orange-500/20 border-orange-500 text-orange-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500')}>{texto}</button>;
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportar(res: Reporte, formato: string) {
  if (formato === 'csv') return descargar(new Blob([aCsv(res)], { type: 'text/csv;charset=utf-8' }), nombreArchivo(res.titulo, 'csv'));
  if (formato === 'excel') {
    const XLSX: any = await import('xlsx');
    const b64 = aXlsxBase64(res, XLSX.default || XLSX);
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return descargar(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo(res.titulo, 'xlsx'));
  }
  if (formato === 'pdf') {                       // se arma como HTML y se imprime: en el diálogo se elige «Guardar como PDF»
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.srcdoc = aHtml(res);
    f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 60000); };
  }
}

async function pedir(ruta: string, cuerpo: any) {
  const t = token();
  const r = await fetch(`${API}/reportes/${ruta}`, {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.detail || `El servidor respondió ${r.status}`);
  return j as Reporte;
}

function Grafica({ res }: { res: Reporte }) {
  const g = res.grafico;
  if (!g || !res.filas.length || res.filas.length > 40) return null;
  const datos = res.filas.map((f: any) => ({ x: String(f[g.x] ?? ''), ...Object.fromEntries(g.y.map((k: string) => [k, Number(f[k]) || 0])) }));
  const eje = { stroke: '#64748b', fontSize: 11 };
  const tip = { contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 } };
  return (
    <div className="h-72 mb-4">
      <ResponsiveContainer width="100%" height="100%">
        {g.tipo === 'torta' ? (
          <PieChart>
            <Pie data={datos} dataKey={g.y[0]} nameKey="x" outerRadius="80%" label>{datos.map((_: any, i: number) => <Cell key={i} fill={PALETA[(i + 2) % 6]} />)}</Pie>
            <Tooltip {...tip} /><Legend />
          </PieChart>
        ) : g.tipo === 'lineas' ? (
          <LineChart data={datos}><CartesianGrid stroke="#1e293b" /><XAxis dataKey="x" {...eje} /><YAxis {...eje} /><Tooltip {...tip} /><Legend />
            {g.y.map((k: string, i: number) => <Line key={k} type="monotone" dataKey={k} name={g.etiquetas[k] || k} stroke={PALETA[i % 2]} strokeWidth={2.5} dot={{ r: 3 }} />)}</LineChart>
        ) : (
          <BarChart data={datos}><CartesianGrid stroke="#1e293b" /><XAxis dataKey="x" {...eje} /><YAxis {...eje} /><Tooltip {...tip} /><Legend />
            {g.y.map((k: string, i: number) => <Bar key={k} dataKey={k} name={g.etiquetas[k] || k} fill={PALETA[i % 2]} radius={[3, 3, 0, 0]} />)}</BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function Tabla({ res }: { res: Reporte }) {
  const celda = (v: any, c: Columna) => (v === null || v === undefined ? '—' : typeof v === 'number' ? fmtValor(v, c.fmt) : dmyIso(v));
  if (!res.filas.length) return <p className="text-slate-400 text-sm">No hay datos que cumplan estas condiciones.</p>;
  return (
    <div className="overflow-auto max-h-[28rem] rounded-lg border border-slate-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-800 text-slate-200">
          <tr>{res.columnas.map(c => <th key={c.key} className={'px-3 py-2 font-semibold whitespace-nowrap ' + (c.tipo === 'numero' ? 'text-right' : 'text-left')}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {res.filas.slice(0, MAX_FILAS_TABLA).map((f: any, i: number) => (
            <tr key={i} className="border-t border-slate-800 odd:bg-slate-900/40">
              {res.columnas.map(c => <td key={c.key} className={'px-3 py-1.5 whitespace-nowrap ' + (c.tipo === 'numero' ? 'text-right tabular-nums' : '')}>{celda(f[c.key], c)}</td>)}
            </tr>
          ))}
          {res.totales && (
            <tr className="border-t-2 border-slate-600 bg-orange-500/10 font-semibold">
              {res.columnas.map((c, j) => <td key={c.key} className={'px-3 py-2 ' + (c.tipo === 'numero' ? 'text-right tabular-nums' : '')}>{j === 0 ? 'TOTAL' : c.key in res.totales! ? celda(res.totales![c.key], c) : ''}</td>)}
            </tr>
          )}
        </tbody>
      </table>
      {res.filas.length > MAX_FILAS_TABLA && <div className="p-2 text-xs text-slate-400 bg-slate-900">Se muestran las primeras {MAX_FILAS_TABLA} de {res.filas.length.toLocaleString('es-BO')} filas; el PDF, Excel y CSV incluyen todas.</div>}
    </div>
  );
}

export function ReportesIA() {
  const [texto, setTexto] = useState('');
  const [formato, setFormato] = useState('pantalla');
  const [res, setRes] = useState<Reporte | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [historial, setHistorial] = useState<string[]>([]);
  const [ayuda, setAyuda] = useState<DatasetAyuda[]>([]);
  const [hayVoz, setHayVoz] = useState(false);
  const [sinConexion, setSinConexion] = useState(false);
  const dictado = useRef<Dictado | null>(null);
  const generarRef = useRef<(t: string) => void>(() => {});

  useEffect(() => {
    setHayVoz(vozDisponible());
    leerGuardado<string[]>('historial').then(h => h && setHistorial(h));
    leerGuardado<Reporte>('ultimo').then(r => r && setRes(r));            // lo último visto, por si el servidor no responde
    fetch(`${API}/reportes/catalogo`, { cache: 'no-store', headers: token() ? { Authorization: `Bearer ${token()}` } : {} })
      .then(r => r.json()).then(j => setAyuda(j.datasets || [])).catch(() => {});
  }, []);

  const recordar = (t: string) => { const h = [t, ...historial.filter(x => x !== t)].slice(0, 8); setHistorial(h); guardar('historial', h); };

  const bajar = async (r: Reporte, f: string) => {
    setAviso(`Generando ${f === 'excel' ? 'Excel' : f.toUpperCase()}…`);
    try { await exportar(r, f); setAviso(f === 'pdf' ? 'Se abrió la impresión: elige «Guardar como PDF».' : `Listo: ${f === 'excel' ? 'Excel' : 'CSV'} descargado.`); }
    catch (e: any) { setAviso(''); setError('No pude generar el archivo: ' + (e.message || e)); }
  };

  const generar = (t?: string, opc: { continuar?: boolean; fmt?: string } = {}) => {
    const q = (t === undefined ? texto : t).trim();
    if (!q) return;
    setError(''); setAviso(''); setCargando(true);
    pedir('consulta', { texto: q, previa: opc.continuar === false ? null : res?.spec })
      .then(async r => {
        setRes(r); setSinConexion(false); guardar('ultimo', r); recordar(q);
        const f = opc.fmt || (r.spec?.salida && r.spec.salida !== 'pantalla' ? r.spec.salida : formato);
        setFormato(f);
        if (f !== 'pantalla') await bajar(r, f);
      })
      .catch(e => { setError(e.message || String(e)); setSinConexion(!navigator.onLine); })
      .finally(() => setCargando(false));
  };
  generarRef.current = (t: string) => generar(t);

  // Los ajustes rápidos reejecutan la misma consulta en el servidor, con el spec cambiado
  const aplicar = (nuevo: any) => {
    setCargando(true); setError('');
    pedir('ejecutar', { spec: nuevo })
      .then(r => { setRes({ ...r, entendi: res?.entendi || '' }); guardar('ultimo', r); })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setCargando(false));
  };

  const alternarMic = () => {
    setError('');
    if (escuchando) { dictado.current?.detener(); return; }
    if (!dictado.current) {
      dictado.current = crearDictado({
        onTexto: (t, final) => { setTexto(t); if (final) generarRef.current(t); },
        onFin: () => setEscuchando(false),
        onError: m => { setEscuchando(false); setError(m); },
      });
    }
    try { dictado.current?.iniciar(); setEscuchando(true); } catch { setEscuchando(false); }
  };

  const spec = res?.spec;
  const agrupado = !!(spec?.agrupar?.length);
  const ds = ayuda.find(a => a.id === res?.dataset);
  const colFecha = ds?.columnas.find(c => c.tipo === 'fecha')?.key;
  const ejemplos = ayuda.flatMap(a => a.ejemplos).slice(0, 7);

  return (
    <div className="px-8 pb-10 space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={'px-2.5 py-1 rounded border font-medium ' + (sinConexion ? 'bg-amber-500/10 border-amber-500/40 text-amber-400' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400')}>
          {sinConexion ? 'Sin conexión · se muestra el último reporte' : 'Conectado al servidor'}
        </span>
        <span className="text-slate-500">El pedido lo interpreta el servidor y solo consulta los datos que tu rol permite.</span>
      </div>

      <Card title="Pide tu reporte" subtitle="Escríbelo o dilo con el micrófono, en español normal">
        {res && (
          <div className="mb-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-200">
            Continúas el reporte anterior: di «ahora por mes», «solo de almuerzo», «en Excel»…{' '}
            <button className="font-bold text-cyan-300 underline" onClick={() => { setRes(null); setAviso(''); }}>Nuevo reporte</button>
          </div>
        )}
        <div className="flex gap-3">
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generar(undefined, { fmt: formato }); } }}
            placeholder="Ej.: quiero ver fecha, monto y estudiante de los pagos de noviembre, los mayores primero, en Excel"
            className="flex-1 px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-lg focus:outline-none focus:border-orange-500 resize-none" />
          <button onClick={alternarMic} disabled={!hayVoz} title={hayVoz ? 'Dictar' : 'Este navegador no permite dictado: usa Chrome o Edge'}
            className={'w-24 rounded-lg border flex flex-col items-center justify-center text-white disabled:opacity-40 ' + (escuchando ? 'bg-red-500 border-red-500' : 'bg-slate-800 border-slate-700 hover:border-slate-500')}>
            <span className="text-2xl">{escuchando ? '■' : '🎤'}</span>
            <span className="text-[11px] mt-0.5">{escuchando ? 'Escuchando…' : 'Dictar'}</span>
          </button>
        </div>
        {!hayVoz && <p className="text-xs text-slate-500 mt-2">El dictado necesita Chrome o Edge. Mientras tanto, escribe tu pedido.</p>}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="text-xs text-slate-400 mr-1">Ver en</span>
          {FORMATOS.map(([k, n]) => <Chip key={k} texto={n} activo={formato === k} onClick={() => setFormato(k)} />)}
          <button onClick={() => generar(undefined, { fmt: formato })} disabled={cargando || !texto.trim()}
            className="ml-auto px-5 py-2 rounded-lg font-semibold text-white bg-gradient-to-r from-orange-500 to-amber-600 disabled:opacity-50">
            {cargando ? 'Calculando…' : 'Generar reporte'}
          </button>
        </div>
        {error && <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>}
        {aviso && <div className="mt-3 text-sm text-emerald-400">{aviso}</div>}
        {historial.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-slate-400 mb-1">Recientes</div>
            <div className="flex flex-wrap gap-2">{historial.map(h => <Chip key={h} texto={h.length > 48 ? h.slice(0, 47) + '…' : h} onClick={() => { setTexto(h); generar(h, { continuar: false }); }} />)}</div>
          </div>
        )}
      </Card>

      {res && (
        <>
          <Card title="Así lo entendí">
            <p className="text-white text-sm mb-2">{res.entendi}</p>
            {res.notas?.map((n, i) => <p key={i} className="text-amber-300 text-xs">• {n}</p>)}
            <div className="flex flex-wrap gap-2 mt-3">
              {(spec?.filtros || []).map((f: any, i: number) => (
                <Chip key={i} onClick={() => aplicar({ ...spec, filtros: spec.filtros.filter((_: any, k: number) => k !== i) })}
                  texto={`${f.col} ${f.op} ${Array.isArray(f.valor) ? f.valor.join('–') : String(f.valor)}  ✕`} />
              ))}
              {spec?.fecha && <Chip onClick={() => aplicar({ ...spec, fecha: null })} texto={`Período: ${spec.fecha.etiqueta}  ✕`} />}
            </div>
            <div className="text-xs text-slate-400 mt-3 mb-1">Agrupar</div>
            <div className="flex flex-wrap gap-2">
              <Chip texto="Sin agrupar" activo={!agrupado} onClick={() => aplicar({ ...spec, agrupar: [], medidas: [], columnas: null, orden: [] })} />
              {colFecha && POR.map(([k, n]) => <Chip key={k} texto={n} activo={agrupado && spec.agrupar[0].por === k} onClick={() => aplicar({ ...spec, agrupar: [{ col: colFecha, por: k }], columnas: null, orden: [] })} />)}
              {(ds?.columnas || []).filter(c => c.tipo === 'categoria').map(c => <Chip key={c.key} texto={c.label} activo={agrupado && spec.agrupar[0].col === c.key && !spec.agrupar[0].por} onClick={() => aplicar({ ...spec, agrupar: [{ col: c.key }], columnas: null, orden: [] })} />)}
            </div>
            <div className="text-xs text-slate-400 mt-3 mb-1">Cantidad</div>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 20].map(n => <Chip key={n} texto={`Primeros ${n}`} activo={spec?.limite === n} onClick={() => aplicar({ ...spec, limite: n })} />)}
              <Chip texto="Todos" activo={!spec?.limite} onClick={() => aplicar({ ...spec, limite: null })} />
            </div>
          </Card>

          <Card title={res.titulo} subtitle={`${res.datasetEtiqueta} · ${res.generado}`}>
            {res.resumen.map((l, i) => <p key={i} className="text-sm text-slate-300">{l}</p>)}
            <div className="flex gap-2 my-4">
              {[['pdf', 'PDF'], ['excel', 'Excel'], ['csv', 'CSV']].map(([k, n]) => (
                <button key={k} onClick={() => bajar(res, k)} className="px-4 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-sm text-slate-100 hover:border-orange-500">⬇ {n}</button>
              ))}
            </div>
            <Grafica res={res} />
            <Tabla res={res} />
          </Card>
        </>
      )}

      {!res && (
        <>
          <Card title="Pruébalo">
            <div className="flex flex-wrap gap-2">{ejemplos.map(e => <Chip key={e} texto={e.length > 60 ? e.slice(0, 59) + '…' : e} onClick={() => { setTexto(e); generar(e, { continuar: false }); }} />)}</div>
          </Card>
          <Card title="¿Qué puedo pedir?">
            {ayuda.map(d => (
              <div key={d.id} className="mb-4">
                <div className="text-white font-semibold text-sm">{d.etiqueta}</div>
                <div className="text-slate-400 text-xs mb-1">{d.descripcion}</div>
                <div className="text-slate-500 text-xs">{d.columnas.map(c => c.label).join(' · ')}</div>
                {d.ejemplos.slice(0, 2).map(e => <button key={e} className="block text-cyan-300 text-xs mt-1 text-left" onClick={() => { setTexto(e); generar(e, { continuar: false }); }}>› {e}</button>)}
              </div>
            ))}
            <p className="text-slate-500 text-xs leading-relaxed">
              Puedes combinar períodos (noviembre, últimos 30 días, del 1 al 15 de octubre, 2025), filtros (mayores a 5, solo almuerzo, sin beca), agrupaciones (por día, semana, mes, año, turno, plato),
              cálculos (total, promedio, cuántos), rankings (los 10 mayores), orden (ascendente, descendente) y formato (pantalla, PDF, Excel, CSV).
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
