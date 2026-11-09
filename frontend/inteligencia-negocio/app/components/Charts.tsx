'use client';
// Piezas visuales comunes de los dashboards (las gráficas se dibujan con recharts en cada pantalla).

export function Card({ title, subtitle, children, className = '' }: any) {
  return (
    <div className={"bg-slate-800/50 border border-slate-700 rounded-xl p-5 " + className}>
      {title && <div className="mb-4">
        <h3 className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>}
      {children}
    </div>
  );
}

export function KPI({ label, value, delta, color = 'purple' }: any) {
  const g: any = {
    purple: 'from-purple-500 to-pink-500',
    cyan: 'from-cyan-500 to-blue-500',
    orange: 'from-orange-500 to-amber-500',
    emerald: 'from-emerald-500 to-teal-500',
    red: 'from-red-500 to-orange-500',
  };
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
      <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={"text-3xl font-bold bg-gradient-to-r " + g[color] + " bg-clip-text text-transparent mt-2"}>{value}</div>
      {delta && <div className="text-xs text-slate-500 mt-1">{delta}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string, subtitle?: string }) {
  return (
    <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur border-b border-slate-800 px-8 py-4 mb-6">
      <h1 className="text-xl font-bold text-white">{title}</h1>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
    </header>
  );
}
