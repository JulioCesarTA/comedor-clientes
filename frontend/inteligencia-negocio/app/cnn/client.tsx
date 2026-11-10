'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, KPI } from '../components/Charts';
import { API, fechaLocal, hhmmss, useVivo } from '../lib/vivo';

const TURNO: Record<string, string> = { DESAYUNO: 'Desayuno', ALMUERZO: 'Almuerzo', CENA: 'Cena' };
const corto = (id: string) => id.replace('plato-', '');
const colorRestante = (v: number) => (v > 50 ? '#ef4444' : v > 25 ? '#f59e0b' : '#10b981');

// % que quedó de cada sector de la bandeja (arroz, ensalada, …); el total de la bandeja es el promedio de estos
function Sectores({ s, chico }: { s?: any[] | null; chico?: boolean }) {
  if (!s?.length) return null;
  return (
    <div className={chico ? 'mt-1 space-y-0.5 text-[10px]' : 'mt-3 space-y-1 text-xs'}>
      {s.map((x: any) => (
        <div key={x.clase} className="flex justify-between gap-2">
          <span className="text-slate-400 truncate first-letter:uppercase">{x.nombre}</span>
          <span className="font-semibold tabular-nums" style={{ color: colorRestante(x.restante) }}>{Math.round(x.restante)}%</span>
        </div>
      ))}
    </div>
  );
}

function Foto({ src, mascara }: { src: string; mascara?: number[][] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c || !mascara) return;
    const n = mascara.length; c.width = n; c.height = n;
    const g = c.getContext('2d')!; g.clearRect(0, 0, n, n); g.fillStyle = 'rgba(16,185,129,0.5)';
    mascara.forEach((fila, y) => fila.forEach((v, x) => { if (v) g.fillRect(x, y, 1, 1); }));
  }, [mascara]);
  return (
    <div className="relative inline-block max-w-full">
      <img src={src} alt="foto" className="block rounded-lg max-h-60 border border-slate-700" />
      {mascara && <canvas ref={ref} className="absolute inset-0 w-full h-full rounded-lg" style={{ imageRendering: 'pixelated' }} />}
    </div>
  );
}

export function DesperdicioVivo() {
  const platos = useVivo<any>('/ml/vision/platos', 15000).data;
  const refs = useVivo<any[]>('/ml/vision/referencias', 5000);
  const res = useVivo<any>('/ml/vision/resumen', 6000);

  const [fecha, setFecha] = useState(fechaLocal());
  const [turno, setTurno] = useState('ALMUERZO');
  const [plato, setPlato] = useState('');
  const [refSel, setRefSel] = useState('');
  const [refNueva, setRefNueva] = useState<any>(null);
  const [prevRef, setPrevRef] = useState('');
  const [analizadas, setAnalizadas] = useState<any[]>([]);
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');

  const opciones = (platos?.platos ?? []).filter((p: any) => p.turno === turno);
  useEffect(() => { if (!plato && opciones.length) setPlato(opciones[0].platoId); }, [opciones.length, turno]);
  useEffect(() => { if (!refSel && refs.data?.length) setRefSel(refs.data[0].id); }, [refs.data]);

  const subirReferencia = async (f: File) => {
    setError(''); setOcupado('ref'); setPrevRef(URL.createObjectURL(f));
    const fd = new FormData(); fd.append('file', f); fd.append('plato_id', plato || 'plato'); fd.append('fecha', fecha); fd.append('turno', turno);
    try {
      const r = await fetch(`${API}/ml/vision/referencia`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || r.status);
      setRefNueva(j); setRefSel(j.id);
    } catch (e: any) { setError(String(e.message)); setRefNueva(null); }
    finally { setOcupado(''); }
  };

  const subirBandejas = async (fs: FileList) => {
    if (!refSel) { setError('Primero sube la foto de referencia de la porción.'); return; }
    setError(''); setOcupado('band');
    for (const f of Array.from(fs)) {
      const fd = new FormData(); fd.append('file', f); fd.append('ref_id', refSel);
      try {
        const r = await fetch(`${API}/ml/vision/bandeja`, { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || r.status);
        setAnalizadas(a => [{ ...j, src: URL.createObjectURL(f) }, ...a]);
      } catch (e: any) { setError(String(e.message)); }
    }
    setOcupado('');
  };

  const d = res.data;
  const enLista = refs.data ?? [];
  const todas = refNueva && !enLista.some((r: any) => r.id === refNueva.id)
    ? [{ id: refNueva.id, plato_id: refNueva.platoId, turno: refNueva.turno, fecha: refNueva.fecha }, ...enLista] : enLista;   // aparece al instante
  const refActual = todas.find((r: any) => r.id === refSel);

  return (
    <div className="px-8 pb-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="px-2.5 py-1 rounded border bg-emerald-500/10 border-emerald-500/40 text-emerald-400 font-medium">En vivo · actualizado {hhmmss(res.hora)}</span>
        <span className="px-2.5 py-1 rounded border bg-slate-800 border-slate-700 text-slate-300">{d?.modelo ?? 'Cargando red…'} · funciona sin internet</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Fotos de referencia" value={d?.referencias ?? '—'} delta="Porciones completas registradas" color="purple" />
        <KPI label="Bandejas analizadas" value={d?.bandejas ?? '—'} delta="Comparadas con su referencia" color="cyan" />
        <KPI label="Sobrante medio" value={d?.restanteMedio != null ? d.restanteMedio + '%' : '—'} delta="De la porción de referencia" color="orange" />
        <KPI label="Comido medio" value={d?.restanteMedio != null ? (100 - d.restanteMedio).toFixed(1) + '%' : '—'} delta="Lo que sí se aprovechó" color="emerald" />
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-red-300 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Paso 1 · Foto de la porción de referencia" subtitle="Una foto de cómo se ve la porción completa, tal como sale de cocina. Las bandejas se comparan contra ella.">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div><label className="block text-[11px] text-slate-400 mb-1">Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="w-full px-2 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" /></div>
            <div><label className="block text-[11px] text-slate-400 mb-1">Turno</label>
              <select value={turno} onChange={e => { setTurno(e.target.value); setPlato(''); }} className="w-full px-2 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
                {Object.entries(TURNO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="block text-[11px] text-slate-400 mb-1">Plato</label>
              {opciones.length ? (
                <select value={plato} onChange={e => setPlato(e.target.value)} className="w-full px-2 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
                  {opciones.map((p: any) => <option key={p.platoId} value={p.platoId}>{corto(p.platoId)}</option>)}</select>
              ) : (
                <input value={plato} onChange={e => setPlato(e.target.value)} placeholder="plato-…" className="w-full px-2 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
              )}</div>
          </div>
          <label className="block">
            <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && subirReferencia(e.target.files[0])} />
            <span className="block w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-lg text-center cursor-pointer hover:brightness-110">
              {ocupado === 'ref' ? 'Analizando con TensorFlow…' : 'Subir foto de referencia'}
            </span>
          </label>
          {refNueva && (
            <div className="mt-4 space-y-2">
              <Foto src={prevRef} mascara={refNueva.mascara} />
              <div className="text-xs text-slate-400">En verde, lo que el modelo reconoció como comida. Referencia guardada: {corto(refNueva.platoId)} · {refNueva.fecha}.</div>
              {refNueva.sectores?.length > 0 && (
                <div className="text-xs text-slate-300">Sectores reconocidos: {refNueva.sectores.map((s: any) => s.nombre).join(', ')}.</div>
              )}
              {refNueva.advertencia && <div className="text-xs text-amber-300">{refNueva.advertencia}</div>}
            </div>
          )}
        </Card>

        <Card title="Paso 2 · Bandejas de los comensales" subtitle="Sube las fotos de las bandejas al terminar de comer: el modelo estima qué % se comió respecto a la referencia.">
          <label className="block text-[11px] text-slate-400 mb-1">Comparar contra la referencia</label>
          <select value={refSel} onChange={e => setRefSel(e.target.value)} className="w-full px-3 py-2 mb-3 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
            {!todas.length && <option value="">— sube primero una referencia —</option>}
            {todas.map((r: any) => <option key={r.id} value={r.id}>{corto(r.plato_id)} · {TURNO[r.turno]} · {r.fecha}</option>)}
          </select>
          {refActual && <div className="mb-3"><Foto src={`${API}/ml/vision/foto/ref/${refActual.id}`} /></div>}
          <label className="block">
            <input type="file" accept="image/*" multiple className="hidden" onChange={e => e.target.files && subirBandejas(e.target.files)} />
            <span className="block w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg text-center cursor-pointer hover:brightness-110">
              {ocupado === 'band' ? 'Analizando bandejas…' : 'Subir fotos de bandejas (una o varias)'}
            </span>
          </label>
        </Card>
      </div>

      {analizadas.length > 0 && (
        <Card title="Resultado de las últimas bandejas" subtitle="En verde, la comida que el modelo todavía ve en la bandeja">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {analizadas.map(a => (
              <div key={a.id} className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
                <Foto src={a.src} mascara={a.mascara} />
                <div className="mt-3 flex items-end justify-between">
                  <div><div className="text-xs text-slate-400">Se comió</div><div className="text-2xl font-bold text-emerald-400">{a.comidoPct}%</div></div>
                  <div className="text-right"><div className="text-xs text-slate-400">{a.sectores?.length ? 'Quedó (promedio)' : 'Quedó'}</div><div className="text-2xl font-bold" style={{ color: colorRestante(a.restantePct) }}>{a.restantePct}%</div></div>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden mt-2"><div className="h-full" style={{ width: `${a.restantePct}%`, background: colorRestante(a.restantePct) }} /></div>
                <Sectores s={a.sectores} />
                <div className="text-[11px] text-slate-500 mt-1.5">{corto(a.platoId)} · confianza {(a.confianza * 100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6">
        <Card title="Últimas fotos analizadas" subtitle="Se actualizan en vivo · lo que quedó de cada sector y el promedio">
          {!d?.recientes?.length ? <div className="text-sm text-slate-500 py-8 text-center">Sin fotos todavía.</div> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {d.recientes.map((r: any) => (
                <div key={r.id} className="bg-slate-900/50 rounded-lg p-1.5 border border-slate-800">
                  <img src={`${API}/ml/vision/foto/bandeja/${r.id}`} alt="bandeja" className="rounded-md h-24 w-full object-cover border border-slate-700" />
                  <div className="text-[10px] text-slate-500 truncate mt-1 text-center">{corto(r.platoId)}</div>
                  <Sectores s={r.sectores} chico />
                  <div className="text-xs font-semibold mt-1 text-center border-t border-slate-800 pt-1" style={{ color: colorRestante(r.restante) }}>
                    {r.sectores?.length ? 'promedio' : 'queda'} {r.restante}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
