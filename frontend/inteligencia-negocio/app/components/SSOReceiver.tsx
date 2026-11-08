'use client';
// Recibe el token SSO del shell host via postMessage (cuando se embebe en iframe)
import { useEffect } from 'react';

export default function SSOReceiver() {
  useEffect(() => {
    if (window.parent === window) return;  // standalone, no shell
    window.parent.postMessage({ type: 'MF_READY' }, '*');
    const handler = (ev: MessageEvent) => {
      if (ev.data?.type === 'SSO_TOKEN' && ev.data?.token) {
        document.cookie = `kc_token=${ev.data.token}; path=/; SameSite=Lax`;
        localStorage.setItem('kc_token', ev.data.token);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
  return null;
}
