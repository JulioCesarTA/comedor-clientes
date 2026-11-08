'use client';
// error.tsx — error boundary auto por ruta (exclusivo Next.js )
export default function Error({ error, reset }: { error: Error, reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-8 max-w-lg">
        <div className="text-5xl mb-4">️</div>
        <h2 className="text-xl font-bold text-red-400">Error en el servidor</h2>
        <p className="text-slate-400 mt-2 text-sm">{error.message}</p>
        <button onClick={reset} className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg font-medium">Reintentar</button>
      </div>
    </div>
  );
}
