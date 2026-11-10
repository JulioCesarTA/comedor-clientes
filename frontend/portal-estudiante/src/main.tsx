// Entry standalone del Portal (cuando se accede directamente, no desde el shell)
// Si se consume desde el shell, el shell importa ./App directamente via Module Federation.
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);

// Service worker (PWA: abre sin internet). Este código puede correr DESPUÉS del evento «load» (carga diferida),
// y esperar ese evento nunca registraba nada: si la página ya cargó, se registra en el acto.
function registrarServiceWorker() {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.ready.then((r) => {
    const urls = performance.getEntriesByType('resource')
      .filter((e) => ['script', 'link', 'css', 'img'].includes((e as PerformanceResourceTiming).initiatorType))
      .map((e) => e.name);
    r.active?.postMessage({ tipo: 'guardar', urls });
  });
}
if ('serviceWorker' in navigator) {
  if (document.readyState === 'complete') registrarServiceWorker();
  else window.addEventListener('load', registrarServiceWorker);
}
