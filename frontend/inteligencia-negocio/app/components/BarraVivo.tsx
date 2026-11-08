'use client';
// Barra superior de cada tablero: estado en vivo / sin conexión, registros usados y el botón "Ejecutar ahora".
import { useState } from 'react';
import { API, hhmmss } from '../lib/vivo';

type Props = {
  hora: Date | null;
  sinConexion: boolean;
  recargar: () => void;
  registros?: number | null;
  minimo?: number | null;
};

export function BarraVivo({ hora, sinConexion, recargar, registros, minimo }: Props) {
  const [corriendo, setCorriendo] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);

  async function ejecutar() {
    setCorriendo(true); setMsg(null);
    try {
      const r = await fetch(`${API}/ml/reentrenar`, { method: 'POST' });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      setMsg({ ok: true, txt: `Listo en ${j.segundos}s · ${j.internet ? 'clima actualizado con internet' : 'sin internet: se usó el último clima guardado'}` });
      recargar();
    } catch {
      setMsg({ ok: false, txt: 'No hay conexión con el servidor: se muestran los últimos datos guardados en este equipo' });
    } finally { setCorriendo(false); }
  }

  const suficiente = registros == null || minimo == null || registros >= minimo;
  return (
    <>
      <span className={'px-2.5 py-1 rounded border font-medium ' + (sinConexion
        ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
        : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400')}>
        {sinConexion ? `Sin conexión · últimos datos de las ${hhmmss(hora)}` : `En vivo · actualizado ${hhmmss(hora)}`}
      </span>
      {registros != null && (
        <span className={'px-2.5 py-1 rounded border font-medium ' + (suficiente ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-amber-500/10 border-amber-500/40 text-amber-400')}>
          {registros.toLocaleString('es-BO')} registros{minimo != null ? ` (mínimo ${minimo.toLocaleString('es-BO')})` : ''}
        </span>
      )}
      <button onClick={ejecutar} disabled={corriendo}
        className="px-3 py-1 rounded-lg font-semibold text-white bg-gradient-to-r from-orange-500 to-amber-600 disabled:opacity-50">
        {corriendo ? 'Calculando…' : 'Ejecutar ahora'}
      </button>
      {msg && <span className={msg.ok ? 'text-emerald-400' : 'text-amber-400'}>{msg.txt}</span>}
    </>
  );
}
