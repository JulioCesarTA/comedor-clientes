'use client';
// Instala el service worker en cualquier pantalla y, con conexión, deja todas las pantallas guardadas para abrirlas sin internet.
import { useEffect } from 'react';

const PANTALLAS = ['/', '/kpi', '/reportes', '/prediccion', '/segmentacion', '/cnn'];

export default function RegistrarPwa() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (!navigator.onLine || window.location.pathname === '/login') return;
    let hecho = false;
    try { hecho = sessionStorage.getItem('bi.precarga') === '1'; sessionStorage.setItem('bi.precarga', '1'); } catch { /* sin almacenamiento */ }
    if (!hecho) navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ tipo: 'precargar', paginas: PANTALLAS }));
  }, []);
  return null;
}
