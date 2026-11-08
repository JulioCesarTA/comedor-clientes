'use client';
// Embebido en el shell: sin sidebar propio, navegación por pestañas horizontales.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

const TABS = [
  { href: '/prediccion', label: 'Predicción' },
  { href: '/kpi', label: 'KPI' },
  { href: '/segmentacion', label: 'Agrupación de platos' },
  { href: '/cnn', label: 'Desperdicio por foto' },
];

export default function EmbedShell({
  user, roles, children,
}: { user: string; roles: string[]; children: React.ReactNode }) {
  const [embedded, setEmbedded] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setEmbedded(q.get('embedded') === '1' || window.parent !== window);
  }, []);

  if (embedded) {
    return (
      <div className="min-h-screen">
        <nav className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 px-6 flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <Link key={t.href} href={t.href}
              className={"px-4 py-3 text-sm whitespace-nowrap border-b-2 transition " +
                (pathname === t.href ? "text-white border-orange-500" : "text-slate-400 hover:text-white border-transparent")}>
              {t.label}
            </Link>
          ))}
        </nav>
        <main className="overflow-auto">{children}</main>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} roles={roles} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
