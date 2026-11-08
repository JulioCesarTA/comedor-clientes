'use client';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, PolarAngleAxis,
  RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useVivo } from '../lib/vivo';
import { BarraVivo } from '../components/BarraVivo';

const tip = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 };
const eje = { fill: '#94a3b8', fontSize: 11 };
const malla = '#1e293b';

const ESTADO: Record<string, { texto: string; badge: string; color: string }> = {
  ok: { texto: 'En meta', badge: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400', color: '#10b981' },
  alerta: { texto: 'Atención', badge: 'bg-amber-500/10 border-amber-500/40 text-amber-400', color: '#f59e0b' },
  critico: { texto: 'Crítico', badge: 'bg-red-500/10 border-red-500/40 text-red-400', color: '#ef4444' },
  sin_datos: { texto: 'Sin datos', badge: 'bg-slate-700/40 border-slate-600 text-slate-400', color: '#64748b' },
};
const COLOR_RESERVA: Record<string, string> = { Confirmada: '#10b981', Pendiente: '#f59e0b', Cancelada: '#ef4444' };

// ----------------------------- un gráfico distinto para cada indicador -----------------------------

function Gauge({ valor, color }: { valor: number; color: string }) {
  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ v: Math.min(100, valor) }]} startAngle={210} endAngle={-30}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="v" cornerRadius={12} fill={color} background={{ fill: '#1e293b' }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-3xl font-bold text-white">{valor}%</span>
      </div>
    </div>
  );
}

function GOcupacion({ k, color }: any) {
  const g = k.grafico;
  return (
    <div className="grid grid-cols-5 gap-2 h-full">
      <div className="col-span-2"><Gauge valor={k.valor} color={color} /></div>
      <div className="col-span-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={g.porDia} margin={{ top: 8, right: 4, left: -22, bottom: 0 }} barGap={-14}>
            <CartesianGrid stroke={malla} vertical={false} />
            <XAxis dataKey="dia" tick={eje} interval={1} angle={-35} textAnchor="end" height={42} />
            <YAxis tick={eje} />
            <Tooltip contentStyle={tip} cursor={{ fill: '#ffffff08' }} />
            <Bar dataKey="cupo" name="Cupo ofrecido" fill="#334155" radius={[4, 4, 0, 0]} barSize={14} />
            <Bar dataKey="reservadas" name="Reservadas" fill={color} radius={[4, 4, 0, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function GIngresos({ k }: any) {
  const g = k.grafico;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={g.porDia} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={malla} vertical={false} />
        <XAxis dataKey="dia" tick={eje} interval={1} angle={-35} textAnchor="end" height={42} />
        <YAxis yAxisId="d" tick={eje} />
        <YAxis yAxisId="a" orientation="right" tick={eje} />
        <Tooltip contentStyle={tip} cursor={{ fill: '#ffffff08' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="d" dataKey="monto" name="Cobrado del día (Bs)" fill="#06b6d4" radius={[4, 4, 0, 0]} />
        <Line yAxisId="a" dataKey="acumulado" name="Acumulado (Bs)" stroke="#a855f7" strokeWidth={2.5} dot={false} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function GVolumen({ k }: any) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={k.grafico.comparativo} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
        <CartesianGrid stroke={malla} vertical={false} />
        <XAxis dataKey="dia" tick={eje} />
        <YAxis tick={eje} allowDecimals={false} />
        <Tooltip contentStyle={tip} cursor={{ fill: '#ffffff08' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="anterior" name="Semana anterior" fill="#475569" radius={[4, 4, 0, 0]} />
        <Bar dataKey="actual" name="Esta semana" fill="#f97316" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function GCancelacion({ k }: any) {
  const total = k.grafico.estados.reduce((s: number, e: any) => s + e.cantidad, 0);
  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={k.grafico.estados} dataKey="cantidad" nameKey="estado" innerRadius="58%" outerRadius="85%" paddingAngle={3} stroke="none">
            {k.grafico.estados.map((e: any) => <Cell key={e.estado} fill={COLOR_RESERVA[e.estado] ?? '#64748b'} />)}
          </Pie>
          <Tooltip contentStyle={tip} />
          <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle" />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-y-0 left-0 w-[52%] flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-bold text-white">{total}</span>
        <span className="text-[11px] text-slate-400">reservas</span>
      </div>
    </div>
  );
}

function GBecas({ k, color }: any) {
  return (
    <div className="grid grid-cols-5 gap-2 h-full">
      <div className="col-span-2"><Gauge valor={k.valor} color={color} /></div>
      <div className="col-span-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={k.grafico.becarios} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={malla} horizontal={false} />
            <XAxis type="number" tick={eje} allowDecimals={false} />
            <YAxis type="category" dataKey="nombre" tick={eje} width={92} />
            <Tooltip contentStyle={tip} cursor={{ fill: '#ffffff08' }} />
            <Bar dataKey="usadas" name="Raciones usadas" stackId="a" fill="#14b8a6" />
            <Bar dataKey="libres" name="Cupo libre" stackId="a" fill="#334155" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function GDesperdicio({ k }: any) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={k.grafico.platos} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={malla} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={eje} unit="%" />
        <YAxis type="category" dataKey="plato" tick={eje} width={110} />
        <Tooltip contentStyle={tip} cursor={{ fill: '#ffffff08' }} formatter={(v: any) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="comido" name="Se comió" stackId="a" fill="#10b981" />
        <Bar dataKey="restante" name="Quedó en la bandeja" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function GInsumos({ k }: any) {
  // Semáforo de vencimiento: cuanto más corta la barra, más urgente.
  const datos = k.grafico.items.filter((i: any) => i.dias !== null).map((i: any) => ({ ...i, v: Math.max(0, Math.min(30, i.dias)) }));
  const color = (d: number) => (d <= 3 ? '#ef4444' : d <= 7 ? '#f59e0b' : '#10b981');
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={malla} horizontal={false} />
        <XAxis type="number" domain={[0, 30]} tick={eje} unit=" d" />
        <YAxis type="category" dataKey="insumo" tick={eje} width={92} />
        <Tooltip contentStyle={tip} cursor={{ fill: '#ffffff08' }}
          formatter={(_: any, __: any, p: any) => [`vence en ${p.payload.dias} días · stock ${p.payload.stock} ${p.payload.unidad ?? ''}${p.payload.bajo ? ' (BAJO)' : ''}`, p.payload.insumo]} />
        <Bar dataKey="v" radius={[0, 6, 6, 0]} label={{ position: 'right', fill: '#cbd5e1', fontSize: 11, formatter: (v: any) => `${v} d` }}>
          {datos.map((i: any) => <Cell key={i.insumo} fill={i.bajo ? '#dc2626' : color(i.dias)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const GRAFICOS: Record<string, (p: any) => JSX.Element> = {
  ocupacion: GOcupacion, ingresos: GIngresos, volumen: GVolumen, cancelacion: GCancelacion,
  becas: GBecas, desperdicio: GDesperdicio, insumos: GInsumos,
};

// ----------------------------- tarjeta -----------------------------

function Tarjeta({ k }: { k: any }) {
  const e = ESTADO[k.estado] ?? ESTADO.sin_datos;
  const hayDatos = k.valor !== null && k.valor !== undefined;
  const Grafico = GRAFICOS[k.id];
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{k.nombre}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-white">{hayDatos ? k.valor : '—'}</span>
            <span className="text-xs text-slate-400">{k.unidad}</span>
          </div>
        </div>
        <span className={'px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ' + e.badge}>{e.texto}</span>
      </div>
      <p className="text-xs text-slate-400 mt-1">{k.detalle}</p>
      <div className="h-60 mt-3">
        {hayDatos && Grafico
          ? <Grafico k={k} color={e.color} />
          : <div className="h-full flex items-center justify-center text-xs text-slate-600 border border-dashed border-slate-700 rounded-lg">Sin datos para graficar todavía</div>}
      </div>
      <div className="text-[11px] text-slate-500 mt-3 border-t border-slate-700/60 pt-2">Meta: {k.meta}</div>
    </div>
  );
}

export function KpisVivo() {
  const { data: d, error, hora, sinConexion, recargar } = useVivo<any>('/ml/kpis', 15000);
  if (!d) return <div className="px-8 py-10 text-slate-400">{error ? `No se pudo contactar al servidor (${error}). Reintentando…` : 'Calculando indicadores con los datos reales…'}</div>;
  return (
    <div className="px-8 pb-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <BarraVivo hora={hora} sinConexion={sinConexion} recargar={recargar} registros={d.registros?.total} minimo={d.registros?.minimo ? d.registros.minimo * 3 : null} />
        {d.registros && <span className="text-slate-500">{d.registros.menus.toLocaleString('es-BO')} menús · {d.registros.reservas.toLocaleString('es-BO')} reservas · {d.registros.pagos.toLocaleString('es-BO')} pagos (mín. {d.registros.minimo.toLocaleString('es-BO')} de cada uno)</span>}
        <span className="text-slate-500">Se recalculan solos con reservas, pagos, becas, menús, insumos y fotos de bandejas.</span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {d.kpis.map((k: any, i: number) => <Tarjeta key={k.id + i} k={k} />)}
      </div>
    </div>
  );
}
