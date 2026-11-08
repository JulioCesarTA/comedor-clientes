'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const sections = [
  { label: 'MODELOS DE IA', items: [
    { href: '/prediccion', label: 'Predicción de demanda' },
    { href: '/kpi', label: 'KPI' },
    { href: '/segmentacion', label: 'Agrupación de platos' },
    { href: '/cnn', label: 'Desperdicio por foto' },
    { href: '/reportes', label: 'Reportes con IA (texto y voz)' },
  ]},
];

export default function Sidebar({ user, roles }: { user: string, roles: string[] }) {
  const pathname = usePathname();
  return (
    <aside className="w-72 bg-slate-950 border-r border-slate-800 min-h-screen sticky top-0 flex flex-col">
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold tracking-tight">CU</span>
          </div>
          <div>
            <div className="font-semibold text-white tracking-tight">Analítica</div>
            <div className="text-xs text-slate-400">Inteligencia operativa</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-5 overflow-auto">
        {sections.map(s => (
          <div key={s.label}>
            <div className="text-[10px] font-semibold text-slate-500 px-3 mb-1 tracking-wider">{s.label}</div>
            <div className="space-y-0.5">
              {s.items.map(i => (
                <Link key={i.href} href={i.href}
                  className={"block px-3 py-2 rounded-lg transition " +
                    (pathname === i.href ? "bg-slate-800 text-white border-l-2 border-orange-500" : "text-slate-400 hover:bg-slate-800/60 hover:text-white")}>
                  <span className="text-sm">{i.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-800/60 rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-slate-700 to-slate-600 rounded-full flex items-center justify-center text-sm font-semibold text-white">{user[0]?.toUpperCase()}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{user}</div>
              <div className="text-xs text-slate-400">{(() => { const r = roles.filter(x => !x.startsWith('default-') && !x.startsWith('offline') && !x.startsWith('uma')); return r.find(x => x === 'administrador') || r[0] || 'Usuario'; })()}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
