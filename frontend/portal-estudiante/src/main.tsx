// Entry standalone del Portal (cuando se accede directamente, no desde el shell)
// Si se consume desde el shell, el shell importa ./App directamente via Module Federation.
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
