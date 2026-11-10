// Dictado por voz en el navegador (Web Speech API). Por omisión Chrome y Edge lo procesan en la nube (necesita internet).
// Sin conexión se pide el reconocimiento DEL EQUIPO (`processLocally`, Chrome reciente con el paquete de español instalado);
// si el navegador no lo ofrece, se avisa y se escribe el pedido. El reporte en sí siempre se genera sin internet.
//
// Se escucha en modo continuo: el cuadro se va llenando mientras hablas y el pedido se manda recién cuando te quedas
// callado SILENCIO_MS (3 s). Las pausas cortas entre frases no lo mandan. Detener a mano deja el texto sin mandarlo.
const SR = (): any => (typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export const SILENCIO_MS = 3000;
export const vozDisponible = () => !!SR();

function mensajeErrorVoz(error: string): string {
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

export function crearDictado(cb: {
  onTexto: (t: string) => void;        // texto parcial, para ir llenando el cuadro
  onListo: (t: string) => void;        // terminaste de hablar (3 s de silencio): mandar
  onFin: () => void;
  onError: (m: string) => void;
}): Dictado | null {
  const Ctor = SR();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'es-BO';                // español de Bolivia; si no lo conoce, el navegador usa español genérico
  rec.interimResults = true;
  rec.continuous = true;             // no corta en la primera pausa
  rec.maxAlternatives = 1;

  let texto = '';
  let reloj: ReturnType<typeof setTimeout> | null = null;
  let activo = false;                // false si se detuvo a mano

  const limpiarReloj = () => { if (reloj) { clearTimeout(reloj); reloj = null; } };
  const porSilencio = () => { reloj = null; try { rec.stop(); } catch { /* ya detenido */ } };

  rec.onresult = (ev: any) => {
    // se rearma con todos los resultados de la sesión (finales y el parcial en curso)
    let t = '';
    for (let i = 0; i < ev.results.length; i++) t += ' ' + (ev.results[i][0]?.transcript || '');
    texto = t.replace(/\s+/g, ' ').trim();
    cb.onTexto(texto);
    limpiarReloj();
    reloj = setTimeout(porSilencio, SILENCIO_MS);  // cada palabra nueva reinicia la espera
  };
  rec.onerror = (ev: any) => { const m = mensajeErrorVoz(ev.error); if (m && !texto) cb.onError(m); };
  rec.onend = () => {
    // fin por 3 s de silencio, o el navegador cortó solo: si hay texto se manda. Detener a mano (activo=false) no manda.
    limpiarReloj();
    const enviar = activo && !!texto;
    activo = false;
    if (enviar) cb.onListo(texto);
    cb.onFin();
  };
  return {
    iniciar: () => {
      texto = ''; limpiarReloj();
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (!('processLocally' in rec)) { cb.onError('Este navegador dicta usando internet. Sin conexión, escribe tu pedido (el reporte sí funciona).'); cb.onFin(); return; }
        rec.processLocally = true;                                  // reconocimiento en el equipo
      }
      activo = true;
      rec.start();
    },
    // detener a mano: no se manda, el texto queda en el cuadro para corregirlo
    detener: () => { activo = false; limpiarReloj(); try { rec.stop(); } catch { /* ya detenido */ } },
  };
}
