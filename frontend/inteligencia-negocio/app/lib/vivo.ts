'use client';
// Datos en vivo: vuelve a pedir al servidor cada cierto tiempo para que el dashboard siempre muestre la realidad.
import { useEffect, useState } from 'react';

export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export function useVivo<T = any>(path: string, cadaMs = 8000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hora, setHora] = useState<Date | null>(null);
  useEffect(() => {
    let vivo = true;
    const pedir = async () => {
      try {
        const r = await fetch(`${API}${path}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        if (vivo) { setData(j); setError(null); setHora(new Date()); }
      } catch (e: any) { if (vivo) setError(e.message || 'sin conexión'); }
    };
    pedir();
    const t = setInterval(pedir, cadaMs);
    return () => { vivo = false; clearInterval(t); };
  }, [path, cadaMs]);
  return { data, error, hora };
}

export const hhmmss = (d: Date | null) => d ? d.toLocaleTimeString('es-BO', { hour12: false }) : '—';

// Fecha local (YYYY-MM-DD) con desplazamiento en días: toISOString() usa UTC y por las noches ya es "mañana".
export const fechaLocal = (dias = 0) => {
  const d = new Date(); d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
