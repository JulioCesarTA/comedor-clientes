'use client';
// Datos en vivo: vuelve a pedir al servidor cada cierto tiempo para que el dashboard siempre muestre la realidad.
import { useEffect, useState } from 'react';

export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Último resultado bueno de cada pantalla, guardado en el navegador: sin conexión se siguen viendo esos datos.
const CLAVE = (path: string) => `ml:cache:${path}`;
function leerCache<T>(path: string): { data: T; hora: Date } | null {
  try {
    const r = localStorage.getItem(CLAVE(path));
    if (!r) return null;
    const { d, t } = JSON.parse(r);
    return { data: d as T, hora: new Date(t) };
  } catch { return null; }
}
function guardarCache(path: string, d: unknown) {
  try { localStorage.setItem(CLAVE(path), JSON.stringify({ d, t: Date.now() })); } catch { /* sin espacio o bloqueado */ }
}

export function useVivo<T = any>(path: string, cadaMs = 8000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hora, setHora] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let vivo = true;
    const guardado = leerCache<T>(path);
    if (guardado) { setData(guardado.data); setHora(guardado.hora); }
    const pedir = async () => {
      try {
        const r = await fetch(`${API}${path}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        if (vivo) { setData(j); setError(null); setHora(new Date()); guardarCache(path, j); }
      } catch (e: any) { if (vivo) setError(e.message || 'sin conexión'); }
    };
    pedir();
    const t = setInterval(pedir, cadaMs);
    return () => { vivo = false; clearInterval(t); };
  }, [path, cadaMs, tick]);
  // `sinConexion`: el servidor no responde pero hay datos guardados que se están mostrando
  return { data, error, hora, sinConexion: !!error && !!data, recargar: () => setTick(t => t + 1) };
}

export const hhmmss = (d: Date | null) => d ? d.toLocaleTimeString('es-BO', { hour12: false }) : '—';

// Fecha local (YYYY-MM-DD) con desplazamiento en días: toISOString() usa UTC y por las noches ya es "mañana".
export const fechaLocal = (dias = 0) => {
  const d = new Date(); d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
