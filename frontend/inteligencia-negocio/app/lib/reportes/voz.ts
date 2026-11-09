// Dictado por voz en el navegador (Web Speech API). Por omisión Chrome y Edge lo procesan en la nube (necesita internet).
// Sin conexión se pide el reconocimiento DEL EQUIPO (`processLocally`, Chrome reciente con el paquete de español instalado);
// si el navegador no lo ofrece, se avisa y se escribe el pedido. El reporte en sí siempre se genera sin internet.
const SR = (): any => (typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export const vozDisponible = () => !!SR();

export function mensajeErrorVoz(error: string): string {
  switch (error) {
    case 'not-allowed': case 'service-not-allowed': return 'Permite el micrófono para esta página (candado de la barra de direcciones).';
    case 'no-speech': return 'No se escuchó nada. Habla cerca del micrófono e inténtalo otra vez.';
    case 'audio-capture': return 'No pude usar el micrófono.';
    case 'network': return 'El dictado del navegador necesita internet. Sin conexión, escribe tu pedido.';
    case 'language-not-supported': return 'Sin internet este navegador no tiene el paquete de voz en español instalado. Escribe tu pedido.';
    case 'aborted': return '';
    default: return 'No pude entender el audio.';
  }
}

export type Dictado = { iniciar: () => void; detener: () => void };

export function crearDictado(cb: { onTexto: (t: string, final: boolean) => void; onFin: () => void; onError: (m: string) => void }): Dictado | null {
  const Ctor = SR();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'es-BO';                // español de Bolivia; si no lo conoce, el navegador usa español genérico
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (ev: any) => {
    const r = ev.results[ev.results.length - 1];
    if (r && r[0]) cb.onTexto(r[0].transcript, !!r.isFinal);
  };
  rec.onerror = (ev: any) => { const m = mensajeErrorVoz(ev.error); if (m) cb.onError(m); };
  rec.onend = () => cb.onFin();
  return {
    iniciar: () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (!('processLocally' in rec)) { cb.onError('Este navegador dicta usando internet. Sin conexión, escribe tu pedido (el reporte sí funciona).'); cb.onFin(); return; }
        rec.processLocally = true;                                  // reconocimiento en el equipo
      }
      rec.start();
    },
    detener: () => rec.stop(),
  };
}
