'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, KPI } from '../components/Charts';
import { API, fechaLocal, useVivo } from '../lib/vivo';
import { BarraVivo } from '../components/BarraVivo';

const tip = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };
const TURNO: Record<string, string> = { DESAYUNO: 'Desayuno', ALMUERZO: 'Almuerzo', CENA: 'Cena' };
const corto = (id: string) => id.replace('plato-', '');

export function PrediccionVivo() {
  const { data: d, error, hora, sinConexion, recargar } = useVivo<any>('/ml/regresion');
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPI label="Registros reales" value={d.muestras} delta={`${d.conDemanda} con reservas · plato × turno × día`} color="purple" />
            <KPI label="Error medio (MAE)" value={m.mae} delta={`Promedio ${m.maeBase} · mediana ${m.maeMediana} (referencias)`} color="cyan" />
            <KPI label="R²" value={m.r2 ?? '—'} delta={`Validación ${m.validacion}`} color="orange" />
            <KPI label="Calidad" value={m.confiable ? 'Confiable' : 'Pocos datos'} delta={m.confiable ? 'Supera al baseline' : 'Aún no supera al baseline (promedio/mediana)'} color={m.confiable ? 'emerald' : 'red'} />
          </div>

          {!m.confiable && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200 text-sm leading-relaxed">
              <b>Todavía hay pocos datos para una predicción confiable:</b> solo {d.conDemanda} de {d.muestras} registros tienen reservas, y el modelo aún no mejora a
              "predecir el promedio". Las cantidades sugeridas abajo son orientativas; mejoran solas con cada reserva nueva.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card title="Reservas reales vs. lo que el modelo habría predicho" subtitle="Total por día · cada día se predice sin haberlo visto (validación cruzada)" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={d.serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="fecha" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip contentStyle={tip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="real" name="Real" stroke="#f97316" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="predicha" name="Predicha" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Qué pesa más en la predicción" subtitle="Importancia de cada variable">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={d.importancias} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis type="number" stroke="#64748b" fontSize={10} />
                  <YAxis type="category" dataKey="variable" stroke="#94a3b8" fontSize={10} width={120} />
                  <Tooltip contentStyle={tip} />
                  <Bar dataKey="peso" fill="#06b6d4" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card title="Plan de cocina: cuánto preparar" subtitle={m.confiable ? "Menús ya publicados para los próximos días · cocinar = predicción + 10% (sin pasar el cupo)" : "Menús publicados para los próximos días · la cantidad a cocinar se habilita cuando el modelo sea confiable"}>
            {d.plan.length === 0 ? <div className="text-sm text-slate-500">No hay menús publicados para los próximos días.</div> : (
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800"><tr className="border-b border-slate-700 text-xs text-slate-400 uppercase">
                    <th className="text-left p-2">Fecha</th><th className="text-left p-2">Turno</th><th className="text-left p-2">Plato</th>
                    <th className="text-right p-2">Cupo</th><th className="text-right p-2">Apartadas hoy</th><th className="text-right p-2">Predicción</th><th className="text-right p-2">Cocinar</th>
                  </tr></thead>
                  <tbody>
                    {d.plan.map((p: any, i: number) => (
                      <tr key={i} className="border-b border-slate-800">
                        <td className="p-2 text-slate-300">{p.fecha}</td><td className="p-2 text-slate-400">{TURNO[p.turno]}</td><td className="p-2 text-white">{corto(p.platoId)}</td>
                        <td className="p-2 text-right text-slate-400">{p.cupo}</td><td className="p-2 text-right text-slate-300">{p.apartadas}</td>
                        <td className="p-2 text-right text-slate-300">{p.prediccion}</td><td className="p-2 text-right font-semibold text-cyan-400">{m.confiable ? p.sugerida : <span className="text-slate-600 font-normal" title="Se habilita cuando el modelo supere al baseline">—</span>}</td>
                      </tr>
                    ))}
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
