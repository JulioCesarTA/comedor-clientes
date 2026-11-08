// loading.tsx — mostrado automáticamente mientras cargan Server Components (exclusivo Next.js)
export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto"></div>
        <p className="text-slate-400 mt-4 text-sm">Cargando datos del servidor…</p>
      </div>
    </div>
  );
}
