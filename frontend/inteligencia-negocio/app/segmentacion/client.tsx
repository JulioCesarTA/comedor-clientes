'use client';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { Card, KPI } from '../components/Charts';
import { useVivo } from '../lib/vivo';
import { BarraVivo } from '../components/BarraVivo';

const COLORES = ['#10b981', '#06b6d4', '#f97316', '#8b5cf6', '#ef4444'];
const ACCION: Record<string, string> = {
  'Mantener': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  'Ajustar': 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  'Retirar o rediseñar': 'bg-red-500/15 text-red-400 border-red-500/40',
};
const VARIABLE: Record<string, string> = { aceptacion: 'Aceptación', demandaMedia: 'Demanda media', desperdicio: 'Desperdicio' };
const corto = (id: string) => id.replace('plato-', '');
const tip = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };

export function AgrupacionVivo() {
  const { data: d, error, hora, sinConexion, recargar } = useVivo<any>('/ml/agrupar-platos', 10000);
  if (!d) return <div className="px-8 py-10 text-slate-400">{error ? `No se pudo contactar al servidor (${error}). Reintentando…` : 'Agrupando platos…'}</div>;
  if (!d.suficiente) return (
    <div className="px-8 space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <BarraVivo hora={hora} sinConexion={sinConexion} recargar={recargar} registros={d.registros} minimo={d.minimoRegistros} />
      </div>
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-200 text-sm">{d.mensaje}</div>
    </div>
  );

  const colorDe = (cluster: number) => COLORES[cluster % COLORES.length];
  const puntos = d.puntos.map((p: any) => ({ ...p, nombre: corto(p.plato), x: +(p.aceptacion * 100).toFixed(1), y: +p.demandaMedia.toFixed(1) }));
  const gruposOrden = [...d.grupos].sort((a: any, b: any) => b.puntaje - a.puntaje);
  const conDesperdicio = puntos.filter((p: any) => p.desperdicio != null).sort((a: any, b: any) => b.desperdicio - a.desperdicio);

  return (
    <div className="px-8 pb-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <BarraVivo hora={hora} sinConexion={sinConexion} recargar={recargar} registros={d.registros} minimo={d.minimoRegistros} />
        <span className="text-slate-500">Se vuelve a agrupar cuando cambian las reservas o llegan fotos de bandejas</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Platos agrupados" value={d.platos} delta={`${d.registros.toLocaleString('es-BO')} veces servidos en total`} color="purple" />
        <KPI label="Grupos (K-Means)" value={d.k} delta="Elegido por índice de silueta" color="cyan" />
        <KPI label="Silueta" value={d.silueta ?? '—'} delta="Cuanto más cerca de 1, más separados" color="orange" />
        <KPI label="Variables" value={d.variables.length} delta={d.variables.map((v: string) => VARIABLE[v] ?? v).join(' · ')} color="emerald" />
      </div>
      {d.nota && <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-slate-300 text-sm">{d.nota} El costo por ración no está registrado en el sistema, por eso no se usa.</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Mapa de platos" subtitle="Horizontal: % del cupo que se reserva · Vertical: raciones por vez que se sirve · Tamaño: veces servido" className="lg:col-span-2">
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 mb-1">
            {gruposOrden.map((g: any) => (
              <span key={g.id} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: colorDe(g.id) }} />Grupo {g.id + 1}: {g.accion}</span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 16, right: 30, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" dataKey="x" name="Aceptación" unit="%" stroke="#64748b" fontSize={10} domain={[0, 100]} label={{ value: 'Aceptación (% del cupo reservado)', position: 'bottom', fill: '#94a3b8', fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="Demanda media" stroke="#64748b" fontSize={10} label={{ value: 'raciones / servicio', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }} />
              <ZAxis type="number" dataKey="veces" range={[60, 400]} name="Veces servido" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={tip}
                content={({ payload }: any) => payload?.[0] ? (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200">
                    <div className="font-semibold text-white">{payload[0].payload.nombre}</div>
                    <div>Aceptación: {payload[0].payload.x}% · demanda media: {payload[0].payload.y} raciones</div>
                    <div>Servido {payload[0].payload.veces} veces</div>
                    {payload[0].payload.desperdicio != null && <div>Desperdicio: {payload[0].payload.desperdicio.toFixed(0)}% queda en la bandeja</div>}
                    <div className="mt-1">{payload[0].payload.accion}</div>
                  </div>) : null} />
              <Scatter data={puntos} fillOpacity={0.85}>
                {puntos.map((p: any) => <Cell key={p.plato} fill={colorDe(p.cluster)} stroke="#0f172a" />)}
                <LabelList dataKey="nombre" position="top" offset={8} style={{ fill: '#cbd5e1', fontSize: 10 }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Qué hacer con cada grupo" subtitle={d.usaDesperdicio ? 'Según aceptación, demanda y desperdicio real' : 'Según la aceptación real de los platos'}>
          <div className="space-y-3">
            {gruposOrden.map((g: any) => (
              <div key={g.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm text-white"><span className="w-3 h-3 rounded-full" style={{ background: colorDe(g.id) }} />Grupo {g.id + 1} · {g.tam} platos</span>
                  <span className={'text-xs px-2 py-0.5 rounded border font-medium ' + (ACCION[g.accion] ?? ACCION['Ajustar'])}>{g.accion}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1.5">{g.detalle}</div>
                <div className="text-[11px] text-slate-500 mt-1">Aceptación {(g.aceptacion * 100).toFixed(0)}% · demanda media {g.demandaMedia.toFixed(1)}{g.desperdicio != null ? ` · desperdicio ${g.desperdicio.toFixed(0)}%` : ''}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {conDesperdicio.length > 0 && (
        <Card title="Desperdicio por plato" subtitle="% de la porción que queda en la bandeja, medido con las fotos analizadas por la IA de visión (meta ≤ 15%)">
          <ResponsiveContainer width="100%" height={Math.max(160, 26 * conDesperdicio.length + 30)}>
            <BarChart data={conDesperdicio} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={10} unit="%" />
              <YAxis type="category" dataKey="nombre" stroke="#94a3b8" fontSize={11} width={130} />
              <Tooltip contentStyle={tip} formatter={(v: any) => [`${Number(v).toFixed(0)}% queda en la bandeja`, 'Desperdicio']} />
              <Bar dataKey="desperdicio" radius={[0, 6, 6, 0]} label={{ position: 'right', fill: '#94a3b8', fontSize: 10, formatter: (v: any) => `${Number(v).toFixed(0)}%` }}>
                {conDesperdicio.map((p: any) => <Cell key={p.plato} fill={p.desperdicio <= 15 ? '#10b981' : p.desperdicio <= 30 ? '#f59e0b' : '#ef4444'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title="Platos por grupo" subtitle="Cada plato con su decisión sugerida">
        <div className="overflow-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-800"><tr className="border-b border-slate-700 text-xs text-slate-400 uppercase">
              <th className="text-left p-2">Plato</th><th className="text-right p-2">Veces servido</th><th className="text-right p-2">Aceptación</th>
              <th className="text-right p-2">Demanda media</th><th className="text-right p-2">Desperdicio</th><th className="text-left p-2">Decisión</th>
            </tr></thead>
            <tbody>
              {[...d.puntos].sort((a: any, b: any) => b.aceptacion - a.aceptacion).map((p: any) => (
                <tr key={p.plato} className="border-b border-slate-800">
                  <td className="p-2 text-white"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: colorDe(p.cluster) }} />{corto(p.plato)}</td>
                  <td className="p-2 text-right text-slate-400">{p.veces}</td>
                  <td className="p-2 text-right text-slate-300">{(p.aceptacion * 100).toFixed(0)}%</td>
                  <td className="p-2 text-right text-slate-300">{p.demandaMedia.toFixed(1)}</td>
                  <td className="p-2 text-right text-slate-400">{p.desperdicio != null ? p.desperdicio.toFixed(0) + '%' : '—'}</td>
                  <td className="p-2"><span className={'text-xs px-2 py-0.5 rounded border ' + (ACCION[p.accion] ?? ACCION['Ajustar'])}>{p.accion}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
