'use client';
// Reportes por texto o por voz, con IA LOCAL: el pedido en español lo interpreta y lo ejecuta este mismo navegador
// (lib/reportes/local.ts) contra una copia de los datos de tu rol que se guarda en el equipo. Por eso funciona SIN
// internet. El motor es el mismo que el del servidor y el del teléfono (la paridad se comprueba con un test).
import { useEffect, useRef, useState } from 'react';
import { Card } from '../components/Charts';
import { aXlsxBase64, dmyIso, fmtValor, nombreArchivo } from '../lib/reportes/exportar';
import { guardar, leerGuardado } from '../lib/reportes/datos';
import { ayuda as ayudaLocal, consultar, preparar } from '../lib/reportes/local';
import { crearDictado, vozDisponible, Dictado, SILENCIO_MS } from '../lib/reportes/voz';

const MAX_FILAS_TABLA = 300;

type Columna = { key: string; label: string; tipo: string; fmt?: string };
type Reporte = {
  titulo: string; dataset: string; datasetEtiqueta: string; modo: string;
  columnas: Columna[]; filas: any[]; totales: Record<string, number> | null;
  grafico: { tipo: string; x: string; y: string[]; etiquetas: Record<string, string> } | null;
  resumen: string[]; condiciones: string[]; notas: string[];
  registrosAnalizados: number; totalFilas: number; mostradas: number; generado: string;
  spec: any; entendi: string; confianza?: number;
};
type DatasetAyuda = { id: string; etiqueta: string; descripcion: string; columnas: Columna[]; ejemplos: string[] };

function Chip({ texto, activo, onClick }: { texto: string; activo?: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={'px-3 py-1 rounded-full text-xs border transition ' + (activo ? 'bg-orange-500/20 border-orange-500 text-orange-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500')}>{texto}</button>;
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportar(res: Reporte, formato: string) {
  if (formato === 'excel') {
    const XLSX: any = await import('xlsx');
    const b64 = aXlsxBase64(res, XLSX.default || XLSX);
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return descargar(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo(res.titulo, 'xlsx'));
  }
  if (formato === 'pdf') return descargar(await aPdf(res), nombreArchivo(res.titulo, 'pdf'));
}

const celdaTexto = (v: any, c: Columna) => (v === null || v === undefined ? '-' : typeof v === 'number' ? fmtValor(v, c.fmt) : dmyIso(v));

/** El PDF se arma aquí mismo (jsPDF, también sin internet) y se descarga como archivo: todas las filas, en varias páginas. */
async function aPdf(res: Reporte): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: res.columnas.length > 5 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth() - 80;
  let y = 42;
  const parrafo = (txt: string, tam: number, gris: number, alto: number) => {
    doc.setFontSize(tam); doc.setTextColor(gris);
    const lineas = doc.splitTextToSize(txt, ancho);
    doc.text(lineas, 40, y);
    y += alto * lineas.length;
  };
  doc.setFont('helvetica', 'bold'); parrafo(res.titulo, 15, 20, 18);
  doc.setFont('helvetica', 'normal');
  parrafo(`Comedor Universitario UAGRM · generado el ${res.generado}`, 9, 110, 12);
  if (res.condiciones?.length) parrafo(`Condiciones: ${res.condiciones.join('; ')}`, 9, 110, 12);
  y += 4;
  for (const l of res.resumen) parrafo(`- ${l}`, 10, 40, 13);
  const body = res.filas.map((f: any) => res.columnas.map(c => celdaTexto(f[c.key], c)));
  if (res.totales) body.push(res.columnas.map((c, j) => (j === 0 ? 'TOTAL' : c.key in res.totales! ? celdaTexto(res.totales![c.key], c) : '')));
  if (!body.length) body.push(res.columnas.map((_, j) => (j === 0 ? 'No hay datos que cumplan estas condiciones.' : '')));
  autoTable(doc, {
    startY: y + 6, head: [res.columnas.map(c => c.label)], body, margin: { left: 40, right: 40 },
    styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [30, 41, 59] }, alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(res.columnas.map((c, i) => [i, { halign: c.tipo === 'numero' ? 'right' : 'left' }])),
  });
  return doc.output('blob');
}

// El archivo se descarga solo si ESTE pedido lo nombra ("en pdf", "pasalo a excel"); seguir la conversación no lo repite
const PIDE_ARCHIVO = /\b(pdf|excel|xlsx|xls|planilla|hoja de c[aá]lculo)\b/i;

function Tabla({ res }: { res: Reporte }) {
  const celda = celdaTexto;
  if (!res.filas.length) return <p className="text-slate-400 text-sm">No hay datos que cumplan estas condiciones.</p>;
  return (
    <div className="overflow-auto max-h-[28rem] rounded-lg border border-slate-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-800 text-slate-200">
          <tr>{res.columnas.map(c => <th key={c.key} className={'px-3 py-2 font-semibold whitespace-nowrap ' + (c.tipo === 'numero' ? 'text-right' : 'text-left')}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {res.filas.slice(0, MAX_FILAS_TABLA).map((f: any, i: number) => (
            <tr key={i} className="border-t border-slate-800 odd:bg-slate-900/40">
              {res.columnas.map(c => <td key={c.key} className={'px-3 py-1.5 whitespace-nowrap ' + (c.tipo === 'numero' ? 'text-right tabular-nums' : '')}>{celda(f[c.key], c)}</td>)}
            </tr>
          ))}
          {res.totales && (
            <tr className="border-t-2 border-slate-600 bg-orange-500/10 font-semibold">
              {res.columnas.map((c, j) => <td key={c.key} className={'px-3 py-2 ' + (c.tipo === 'numero' ? 'text-right tabular-nums' : '')}>{j === 0 ? 'TOTAL' : c.key in res.totales! ? celda(res.totales![c.key], c) : ''}</td>)}
            </tr>
          )}
        </tbody>
      </table>
      {res.filas.length > MAX_FILAS_TABLA && <div className="p-2 text-xs text-slate-400 bg-slate-900">Se muestran las primeras {MAX_FILAS_TABLA} de {res.filas.length.toLocaleString('es-BO')} filas; el PDF y el Excel incluyen todas.</div>}
    </div>
  );
}

export function ReportesIA() {
  const [texto, setTexto] = useState('');
  const [res, setRes] = useState<Reporte | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [historial, setHistorial] = useState<string[]>([]);
  const [ayuda, setAyuda] = useState<DatasetAyuda[]>([]);
  const [hayVoz, setHayVoz] = useState(false);
  const [sinConexion, setSinConexion] = useState(false);
  const [copia, setCopia] = useState('');            // «datos del 08/11 09:30»
  const [bajando, setBajando] = useState(false);
  const dictado = useRef<Dictado | null>(null);
  const generarRef = useRef<(t: string) => void>(() => {});

  useEffect(() => {
    setHayVoz(vozDisponible());
    leerGuardado<string[]>('historial').then(h => h && setHistorial(h));
    leerGuardado<Reporte>('ultimo').then(r => r && setRes(r));            // lo último visto
    const estado = () => setSinConexion(!navigator.onLine);
    estado();
    const alVolver = () => { estado(); iniciar(false); };                // al volver internet se refrescan los datos
    window.addEventListener('online', alVolver); window.addEventListener('offline', estado);
    iniciar(false);
    return () => { window.removeEventListener('online', alVolver); window.removeEventListener('offline', estado); };
  }, []);

  const iniciar = async (forzar: boolean) => {
    setBajando(true);
    const { snap, aviso: a } = await preparar(forzar);
    setBajando(false);
    if (snap) { setAyuda(ayudaLocal() as any); setCopia(snap.generado); setError(''); }
    else if (a) setError(a);
    if (forzar && a && snap) setError(a);
  };

  const recordar = (t: string) => { const h = [t, ...historial.filter(x => x !== t)].slice(0, 8); setHistorial(h); guardar('historial', h); };

  const bajar = async (r: Reporte, f: string) => {
    setAviso(`Generando ${f === 'excel' ? 'Excel' : f.toUpperCase()}…`);
    try { await exportar(r, f); setAviso(`Listo: ${f === 'pdf' ? 'PDF' : 'Excel'} descargado (${nombreArchivo(r.titulo, f === 'pdf' ? 'pdf' : 'xlsx')}).`); }
    catch (e: any) { setAviso(''); setError('No pude generar el archivo: ' + (e.message || e)); }
  };

  const enviando = useRef(false);
  const generar = async (t?: string, opc: { continuar?: boolean } = {}) => {
    const q = (t === undefined ? texto : t).trim();
    if (!q || enviando.current) return;                 // no se manda dos veces mientras se calcula
    enviando.current = true;
    setError(''); setAviso(''); setCargando(true);
    await new Promise(r => setTimeout(r, 30));          // deja pintar el botón deshabilitado antes de calcular
    try {
      const r = consultar(q, opc.continuar === false ? null : res?.spec) as Reporte;      // se calcula aquí, sin red
      setRes(r); guardar('ultimo', r); recordar(q);
      const salida = r.spec?.salida || 'pantalla';
      if (salida !== 'pantalla' && PIDE_ARCHIVO.test(q)) await bajar(r, salida);
    } catch (e: any) { setError(e.message || String(e)); }
    finally { setCargando(false); enviando.current = false; }
  };
  generarRef.current = (t: string) => { generar(t); };

  const alternarMic = () => {
    setError('');
    if (escuchando) { dictado.current?.detener(); return; }
    if (!dictado.current) {
      dictado.current = crearDictado({
        onTexto: t => setTexto(t),                                    // se va llenando mientras hablas
        onListo: t => { setEscuchando(false); generarRef.current(t); }, // se manda tras 3 s de silencio
        onFin: () => setEscuchando(false),
        onError: m => { setEscuchando(false); setError(m); },
      });
    }
    try { dictado.current?.iniciar(); setEscuchando(true); } catch { setEscuchando(false); }
  };

  const ejemplos = ayuda.flatMap(a => a.ejemplos).slice(0, 7);

  return (
    <div className="px-8 pb-10 space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={'px-2.5 py-1 rounded border font-medium ' + (sinConexion ? 'bg-amber-500/10 border-amber-500/40 text-amber-400' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400')}>
          {sinConexion ? 'Sin internet · los reportes siguen funcionando' : 'En línea'}
        </span>
        <span className="px-2.5 py-1 rounded border border-slate-700 text-slate-300">
          {copia ? `IA local · datos del ${copia}` : bajando ? 'Descargando datos…' : 'Sin datos descargados'}
        </span>
        <button disabled={bajando || sinConexion} onClick={() => iniciar(true)} className="px-2.5 py-1 rounded border border-slate-700 text-slate-200 hover:border-orange-500 disabled:opacity-40">
          {bajando ? 'Actualizando…' : '↻ Actualizar datos'}
        </button>
        <span className="text-slate-500">El pedido se interpreta y se calcula en este equipo con los datos que tu rol permite.</span>
      </div>

      <Card title="Pide tu reporte" subtitle="Escríbelo o dilo con el micrófono, en español normal">
        {res && (
          <div className="mb-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-200">
            Continúas el reporte anterior: di «ahora por mes», «solo de almuerzo», «en Excel»…{' '}
            <button className="font-bold text-cyan-300 underline" onClick={() => { setRes(null); setAviso(''); }}>Nuevo reporte</button>
          </div>
        )}
        <div className="flex gap-3">
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} readOnly={escuchando || cargando}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!escuchando) generar(); } }}
            placeholder="Ej.: pagos de noviembre, los mayores primero, en pdf"
            className="flex-1 px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-lg focus:outline-none focus:border-orange-500 resize-none" />
          <button onClick={alternarMic} disabled={!hayVoz || cargando} title={hayVoz ? 'Dictar' : 'Este navegador no permite dictado: usa Chrome o Edge'}
            className={'w-24 rounded-lg border flex flex-col items-center justify-center text-white disabled:opacity-40 ' + (escuchando ? 'bg-red-500 border-red-500' : 'bg-slate-800 border-slate-700 hover:border-slate-500')}>
            <span className="text-2xl">{escuchando ? '■' : '🎤'}</span>
            <span className="text-[11px] mt-0.5">{escuchando ? 'Escuchando…' : 'Dictar'}</span>
          </button>
        </div>
        {!hayVoz && <p className="text-xs text-slate-500 mt-2">El dictado necesita Chrome o Edge. Mientras tanto, escribe tu pedido.</p>}
        {escuchando && <p className="text-xs text-red-300 mt-2">Habla tranquilo: se envía solo cuando te quedes callado {SILENCIO_MS / 1000} segundos. Toca ■ para parar sin enviar.</p>}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="text-xs text-slate-500">Di «en pdf» o «en excel» y el archivo se descarga solo.</span>
          <button onClick={() => generar()} disabled={cargando || escuchando || !texto.trim()}
            className="ml-auto px-5 py-2 rounded-lg font-semibold text-white bg-gradient-to-r from-orange-500 to-amber-600 disabled:opacity-50">
            {cargando ? 'Calculando…' : 'Generar reporte'}
          </button>
        </div>
        {error && <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>}
        {aviso && <div className="mt-3 text-sm text-emerald-400">{aviso}</div>}
        {historial.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-slate-400 mb-1">Recientes</div>
            <div className="flex flex-wrap gap-2">{historial.map(h => <Chip key={h} texto={h.length > 48 ? h.slice(0, 47) + '…' : h} onClick={() => { setTexto(h); generar(h, { continuar: false }); }} />)}</div>
          </div>
        )}
      </Card>

      {res && (
        <>
          <Card title={res.titulo} subtitle={`${res.datasetEtiqueta} · ${res.generado}`}>
            {res.resumen.map((l, i) => <p key={i} className="text-sm text-slate-300">{l}</p>)}
            <div className="h-4" />
            <Tabla res={res} />
          </Card>
        </>
      )}

      {!res && (
        <>
          <Card title="Pruébalo">
            <div className="flex flex-wrap gap-2">{ejemplos.map(e => <Chip key={e} texto={e.length > 60 ? e.slice(0, 59) + '…' : e} onClick={() => { setTexto(e); generar(e, { continuar: false }); }} />)}</div>
          </Card>
          <Card title="¿Qué puedo pedir?">
            {ayuda.map(d => (
              <div key={d.id} className="mb-4">
                <div className="text-white font-semibold text-sm">{d.etiqueta}</div>
                <div className="text-slate-400 text-xs mb-1">{d.descripcion}</div>
                <div className="text-slate-500 text-xs">{d.columnas.map(c => c.label).join(' · ')}</div>
                {d.ejemplos.slice(0, 2).map(e => <button key={e} className="block text-cyan-300 text-xs mt-1 text-left" onClick={() => { setTexto(e); generar(e, { continuar: false }); }}>› {e}</button>)}
              </div>
            ))}
            <p className="text-slate-500 text-xs leading-relaxed">
              Puedes combinar períodos (noviembre, últimos 30 días, del 1 al 15 de octubre, 2025), filtros (mayores a 5, solo almuerzo, sin beca), agrupaciones (por día, semana, mes, año, turno, plato),
              cálculos (total, promedio, cuántos), rankings (los 10 mayores), orden (ascendente, descendente) y formato (pantalla, PDF o Excel).
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
