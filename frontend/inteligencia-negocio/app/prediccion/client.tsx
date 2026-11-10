'use client';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../components/Charts';
import { API, fechaLocal, useVivo } from '../lib/vivo';
import { BarraVivo } from '../components/BarraVivo';

const tip = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };
const TURNO: Record<string, string> = { DESAYUNO: 'Desayuno', ALMUERZO: 'Almuerzo', CENA: 'Cena' };
const ORDEN_TURNO: Record<string, number> = { DESAYUNO: 0, ALMUERZO: 1, CENA: 2 };
const corto = (id: string) => id.replace('plato-', '');

// Rango que se muestra en la curva real vs. predicha (la serie trae un punto por día de todo el historial)
const RANGOS = [{ k: '3m', dias: 91, etiqueta: '3 meses' }, { k: '6m', dias: 182, etiqueta: '6 meses' },
                { k: '12m', dias: 365, etiqueta: '1 año' }, { k: 'todo', dias: 0, etiqueta: 'Todo' }];

const lunesDe = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ddmm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const ddmmaa = (iso: string) => ddmm(iso) + '/' + iso.slice(2, 4);

/** Suma los días de la serie por semana (lunes a sábado): con ~2 años de datos, un punto por día no se lee. */
function porSemana(serie: { fecha: string; real: number; predicha: number }[], dias: number) {
  const desde = dias ? serie[serie.length - 1]?.fecha && (() => { const d = new Date(serie[serie.length - 1].fecha + 'T00:00:00'); d.setDate(d.getDate() - dias); return d.toISOString().slice(0, 10); })() : '';
  const acum = new Map<string, { semana: string; real: number; predicha: number; dias: number }>();
  for (const p of serie) {
    if (desde && p.fecha < desde) continue;
    const s = lunesDe(p.fecha);
    const a = acum.get(s) ?? { semana: s, real: 0, predicha: 0, dias: 0 };
    a.real += p.real; a.predicha += p.predicha; a.dias += 1;
    acum.set(s, a);
  }
  return [...acum.values()].map(a => ({ ...a, predicha: Math.round(a.predicha) }));
}

export function PrediccionVivo() {
  const { data: d, error, hora, sinConexion, recargar } = useVivo<any>('/ml/regresion');
  const [rango, setRango] = useState('6m');
  const semanas = useMemo(() => porSemana(d?.serie ?? [], RANGOS.find(r => r.k === rango)?.dias ?? 0), [d?.serie, rango]);
  const plan = useMemo(() => [...(d?.plan ?? [])].sort((a: any, b: any) =>
    a.fecha.localeCompare(b.fecha) || ORDEN_TURNO[a.turno] - ORDEN_TURNO[b.turno] || a.platoId.localeCompare(b.platoId)), [d?.plan]);
  if (!d) return <div className="px-8 py-10 text-slate-400">{error ? `No se pudo contactar al servidor (${error}). Reintentando…` : 'Entrenando con los datos reales…'}</div>;
  const m = d.metricas;

  return (
    <div className="px-8 pb-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <BarraVivo hora={hora} sinConexion={sinConexion} recargar={recargar} registros={d.muestras} minimo={d.minimo} />
        <span className={'px-2.5 py-1 rounded border font-medium ' + (d.fuenteOk ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-red-500/10 border-red-500/40 text-red-400')}>
          {d.fuenteOk ? 'Datos reales del comedor' : 'Sin respuesta del servicio de menús: usando los últimos datos'}
        </span>
        <span className={'px-2.5 py-1 rounded border font-medium ' + (d.climaDisponible ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-amber-500/10 border-amber-500/40 text-amber-400')}>
          {d.climaDisponible ? 'Clima conectado' : 'Clima no disponible (sin internet): el modelo trabaja sin ese dato'}
        </span>
        <span className="text-slate-500">Se reentrena sola cuando cambian las reservas · última fecha con datos: {d.ultimaFecha ?? '—'}</span>
      </div>

      {!d.suficiente && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-200 text-sm">{d.mensaje}</div>
      )}

      {d.suficiente && (
        <>
          {!m.confiable && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200 text-sm leading-relaxed">
              <b>Todavía hay pocos datos para una predicción confiable:</b> solo {d.conDemanda} de {d.muestras} registros tienen reservas, y el modelo aún no mejora a
              "predecir el promedio". Las cantidades sugeridas abajo son orientativas; mejoran solas con cada reserva nueva.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card title="Reservas reales vs. lo que el modelo habría predicho" subtitle="Raciones por semana · cada día se predice sin haberlo visto (validación cruzada)" className="lg:col-span-2">
              <div className="flex justify-end gap-1 mb-2">
                {RANGOS.map(r => (
                  <button key={r.k} onClick={() => setRango(r.k)}
                    className={'px-2.5 py-1 rounded text-xs border ' + (rango === r.k ? 'bg-purple-500/20 border-purple-500/60 text-purple-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200')}>
                    {r.etiqueta}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={semanas} margin={{ left: 0, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="semana" stroke="#64748b" fontSize={10} tickFormatter={ddmmaa} minTickGap={28} />
                  <YAxis stroke="#64748b" fontSize={10} width={44} />
                  <Tooltip contentStyle={tip} labelFormatter={(v: any) => `Semana del ${ddmmaa(String(v))}`}
                    formatter={(v: any, n: any) => [`${v} raciones`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="real" name="Real" stroke="#f97316" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="predicha" name="Predicha" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Qué pesa más en la predicción" subtitle="Importancia de cada variable (suman 1)">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={d.importancias} layout="vertical" margin={{ left: 8, right: 36 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={10} domain={[0, 'dataMax']} tickFormatter={(v: any) => `${Math.round(v * 100)}%`} />
                  <YAxis type="category" dataKey="variable" stroke="#94a3b8" fontSize={11} width={132} />
                  <Tooltip contentStyle={tip} formatter={(v: any) => [`${(v * 100).toFixed(1)}%`, 'Peso']} />
                  <Bar dataKey="peso" fill="#06b6d4" radius={[0, 6, 6, 0]} label={{ position: 'right', fill: '#94a3b8', fontSize: 10, formatter: (v: any) => `${Math.round(v * 100)}%` }} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card title="Plan de cocina: cuánto preparar" subtitle={m.confiable ? "Menús ya publicados para los próximos días · cocinar = predicción + 10% (sin pasar el cupo)" : "Menús publicados para los próximos días · la cantidad a cocinar se habilita cuando el modelo sea confiable"}>
            {plan.length === 0 ? <div className="text-sm text-slate-500">No hay menús publicados para los próximos días.</div> : (
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800"><tr className="border-b border-slate-700 text-xs text-slate-400 uppercase">
                    <th className="text-left p-2">Fecha</th><th className="text-left p-2">Turno</th><th className="text-left p-2">Plato</th>
                    <th className="text-right p-2">Cupo</th><th className="text-right p-2">Apartadas hoy</th><th className="text-right p-2">Predicción</th><th className="text-right p-2">Ocupación prevista</th><th className="text-right p-2">Cocinar</th>
                  </tr></thead>
                  <tbody>
                    {plan.map((p: any, i: number) => {
                      const ocup = p.cupo > 0 ? Math.min(100, Math.round(100 * p.prediccion / p.cupo)) : 0;
                      return (
                        <tr key={i} className="border-b border-slate-800">
                          <td className="p-2 text-slate-300">{p.fecha}</td><td className="p-2 text-slate-400">{TURNO[p.turno]}</td><td className="p-2 text-white">{corto(p.platoId)}</td>
                          <td className="p-2 text-right text-slate-400">{p.cupo}</td><td className="p-2 text-right text-slate-300">{p.apartadas}</td>
                          <td className="p-2 text-right text-slate-300">{Math.round(p.prediccion)}</td>
                          <td className="p-2 text-right"><span className={ocup >= 90 ? 'text-amber-400' : 'text-slate-400'}>{ocup}%</span></td>
                          <td className="p-2 text-right font-semibold text-cyan-400">{m.confiable ? p.sugerida : <span className="text-slate-600 font-normal" title="Se habilita cuando el modelo supere al baseline">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Predictor platos={d.platos ?? []} />
    </div>
  );
}

function Predictor({ platos }: { platos: string[] }) {
  const manana = fechaLocal(1);
  const [plato, setPlato] = useState('');
  const [fecha, setFecha] = useState(manana);
  const [turno, setTurno] = useState('ALMUERZO');
  const [res, setRes] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const predecir = async () => {
    setCargando(true);
    try {
      const r = await fetch(`${API}/ml/demanda`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fecha, plato_id: plato || platos[0] || 'plato', turno }) });
      setRes(await r.json());
    } finally { setCargando(false); }
  };
  return (
    <Card title="Predictor" subtitle="Cuántas raciones se pedirán de un plato en un día y turno">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div><label className="block text-xs text-slate-400 mb-1">Plato</label>
          <select value={plato} onChange={e => setPlato(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
            {platos.map(p => <option key={p} value={p}>{corto(p)}</option>)}
          </select></div>
        <div><label className="block text-xs text-slate-400 mb-1">Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" /></div>
        <div><label className="block text-xs text-slate-400 mb-1">Turno</label>
          <select value={turno} onChange={e => setTurno(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
            {Object.entries(TURNO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <button onClick={predecir} disabled={cargando} className="py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg disabled:opacity-50">
          {cargando ? 'Calculando…' : 'Predecir'}
        </button>
      </div>
      {res && (
        <div className="mt-4 bg-slate-900 rounded-lg p-4 flex flex-wrap items-center gap-6">
          <div><div className="text-xs text-slate-400 uppercase">Raciones estimadas</div><div className="text-3xl font-bold text-cyan-400">{res.racionesEstimadas}</div></div>
          <div className="text-xs text-slate-400 space-y-0.5">
            <div>Día: {res.diaSemana}{res.esFeriado ? ' · feriado' : ''}{res.enPeriodoExamenes ? ' · exámenes' : ''}{res.enVacaciones ? ' · vacaciones' : ''}</div>
            <div>Temperatura: {res.temperatura != null ? `${res.temperatura} °C` : 'no disponible'}</div>
            <div>{res.entrenado ? `Modelo entrenado con ${res.muestras} registros reales` : 'Aún no hay datos suficientes: se usa el promedio observado'}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
