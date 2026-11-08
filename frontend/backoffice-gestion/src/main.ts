import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { provideHttpClient, HttpClient } from '@angular/common/http';
import { Component, OnInit, OnDestroy, signal, inject, AfterViewInit, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, DecimalPipe, JsonPipe } from '@angular/common';

const API_URL = (typeof window !== 'undefined' && (window as any).__API_URL__) || `${window.location.protocol}//${window.location.hostname}:8080`;
const KC_URL = (typeof window !== 'undefined' && (window as any).__KC_URL__) || `${window.location.protocol}//${window.location.hostname}:8085`;

// =================== ALMACENAMIENTO LOCAL Y AGENTE SIN CONEXIÓN ===================
const LS = {
  get<T>(k: string, def: T): T { try { const v = localStorage.getItem('cu.' + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k: string, v: any) { try { localStorage.setItem('cu.' + k, JSON.stringify(v)); } catch {} },
};

type Cargado<T> = { data: T; origen: 'red' | 'local'; fecha: string };

// Intenta la red; si no hay conexión usa la última copia guardada.
async function cargarConCache<T>(path: string, clave: string): Promise<Cargado<T> | null> {
  try {
    if (!navigator.onLine) throw new Error('offline');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${API_URL}${path}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const fecha = new Date().toISOString();
    LS.set(clave, { data, fecha });
    return { data, origen: 'red', fecha };
  } catch {
    const c = LS.get<any>(clave, null);
    return c ? { data: c.data, origen: 'local', fecha: c.fecha } : null;
  }
}

// =================== AGENTES SIN CONEXIÓN (en el navegador) ===================
// Mismas reglas que los agentes del servidor, ejecutadas sobre un paquete de datos guardado
// (insumos, demanda calculada por el modelo y datos del monitor). Sin internet y sin servidor.
type Paquete = {
  generado: string; insumos: any[]; demanda: Record<string, Record<string, number>>;
  constantes: any; monitor: { desperdicio: any[]; asistencia: any[]; costo: any[] };
};

function authHeaders(): Record<string, string> {
  const t = sessionStorage.getItem('kc_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Llamada con tiempo límite: si el servidor no responde se trata como "sin conexión".
async function llamar(path: string, init: RequestInit = {}, ms = 6000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${API_URL}${path}`, {
      ...init, signal: ctl.signal, headers: { 'content-type': 'application/json', ...authHeaders(), ...(init.headers || {}) },
    });
    if (!r.ok) {
      const err: any = new Error(String(r.status));
      try { err.detalle = (await r.json()).detail; } catch {}
      throw err;
    }
    return await r.json();
  } finally { clearTimeout(t); }
}

// Guarda el paquete cada vez que hay conexión; sin conexión usa el último guardado.
async function cargarPaquete(): Promise<{ data: Paquete; origen: 'red' | 'local' } | null> {
  try {
    const data = await llamar('/agentes/paquete-offline', {}, 15000);
    LS.set('paquete', data);
    return { data, origen: 'red' };
  } catch {
    const c = LS.get<Paquete | null>('paquete', null);
    return c ? { data: c, origen: 'local' } : null;
  }
}

const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pyNum = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));   // igual que Python: 4 -> "4.0"
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diasHasta = (iso: string, hoy: Date) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
};
const stockDe = (i: any) => (i.lotes || []).reduce((s: number, l: any) => s + (l.cantidad?.valor || 0), 0);

function lotesPorVencer(insumos: any[], dias: number, hoy: Date) {
  const out: any[] = [];
  for (const i of insumos) for (const l of (i.lotes || [])) {
    const f = l.vencimiento?.fecha || l.vence; if (!f) continue;
    const d = diasHasta(String(f), hoy);
    if (d <= dias) out.push({ insumoId: i.id, nombre: i.nombre, cantidad: l.cantidad?.valor, unidad: i.unidad, vence: String(f).slice(0, 10), diasRestantes: d });
  }
  return out.sort((a, b) => a.diasRestantes - b.diasRestantes);
}

function inventarioOffline(p: Paquete) {
  const c = p.constantes, hoy = new Date();
  const enRiesgo: any[] = [], ordenes: any[] = []; let total = 0;
  for (const i of p.insumos) {
    const actual = stockDe(i), minimo = Number(i.stockMinimo || 0);
    if (actual > minimo) continue;
    const nombre = String(i.nombre || '').toUpperCase();
    const cantidad = Math.max(1, Math.ceil(2 * minimo - actual));
    const precio = c.precioBs[nombre] ?? 10;
    total += cantidad * precio;
    enRiesgo.push({ id: i.id, nombre, stockActual: actual, stockMinimo: minimo, unidad: i.unidad });
    ordenes.push({ insumoId: i.id, nombre, cantidadSugerida: cantidad, unidad: i.unidad, precioUnitarioBs: precio,
      subtotalBs: Math.round(cantidad * precio * 100) / 100, proveedorSugerido: c.proveedor[nombre] || 'A definir', estado: 'BORRADOR' });
  }
  const porVencer = lotesPorVencer(p.insumos, c.diasVencimiento, hoy);
  const escalar = enRiesgo.length >= 3 || porVencer.some(l => l.diasRestantes <= 2) || total > 1500;
  const requiereAviso = enRiesgo.length > 0 || porVencer.length > 0;
  const severidad = escalar ? 'ALTA' : requiereAviso ? 'MEDIA' : 'BAJA';
  const lineas = [`Inventario: alerta ${severidad}.`];
  if (enRiesgo.length) lineas.push('Stock bajo: ' + enRiesgo.map(i => `${i.nombre} (${fmtN(i.stockActual)} ${i.unidad}, mínimo ${fmtN(i.stockMinimo)})`).join('; ') + '.');
  if (porVencer.length) lineas.push('Por vencer: ' + porVencer.map(l => `${l.nombre} ${fmtN(l.cantidad || 0)} ${l.unidad} vence ${l.vence} (${l.diasRestantes} días)`).join('; ') + '.');
  if (ordenes.length) lineas.push('Orden de compra sugerida (borrador): ' + ordenes.map(o => `${o.nombre} ${o.cantidadSugerida} ${o.unidad}`).join('; ') + `. Total ${pyNum(Math.round(total * 100) / 100)} Bs.`);
  lineas.push('¿Apruebas esta orden de compra?');
  return {
    agente: 'inventario-compras', severidad, insumosEnRiesgo: enRiesgo, lotesPorVencer: porVencer, ordenesBorrador: ordenes,
    totalBorradorBs: Math.round(total * 100) / 100, requiereAviso, mensajeAdmin: lineas.join('\n'),
    claveAlerta: 'ins:' + enRiesgo.map(i => String(i.id)).sort().join(',') + ';lotes:' + porVencer.map(l => `${l.insumoId}@${l.vence}`).sort().join(','),
  };
}

function menuOffline(p: Paquete) {
  const c = p.constantes, hoy = new Date();
  const wd = (hoy.getDay() + 6) % 7;                              // lunes = 0, igual que el servidor
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + (((7 - wd) % 7) || 7));
  const porVencer = new Set(lotesPorVencer(p.insumos, 10, hoy).map(l => String(l.nombre || '').toUpperCase()));
  const prioridad = Object.keys(c.recetario)
    .map(id => [id, (c.recetario[id].insumos as string[]).filter(i => porVencer.has(i)).length] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const propuesta: any[] = []; let slot = 0;
  for (let d = 0; d < 5; d++) {
    const dia = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + d), fecha = isoLocal(dia);
    for (const turno of ['DESAYUNO', 'ALMUERZO', 'CENA']) {
      for (let k = 0; k < 2; k++) {
        const [platoId, usa] = prioridad[(slot + k) % prioridad.length], receta = c.recetario[platoId];
        const cumple = turno !== 'ALMUERZO' || !receta.nutri
          || Object.entries(c.reqNutriAlmuerzo).every(([n, v]) => (receta.nutri[n] || 0) >= (v as number));
        propuesta.push({
          fecha, diaSemana: c.diasSemana[(dia.getDay() + 6) % 7], turno, platoId,
          racionesSugeridas: p.demanda[platoId]?.[fecha] ?? 100, aprovechaInsumosPorVencer: usa,
          cumpleRequisitosNutricionales: cumple, nutrientes: receta.nutri || {}, insumosRequeridos: receta.insumos || [],
        });
      }
      slot += 2;
    }
  }
  return { agente: 'planificador-menu', semanaInicio: isoLocal(inicio), propuesta, requiere_confirmacion_humana: true };
}

function textoMenu(r: any): string {
  const T: Record<string, string> = { DESAYUNO: 'Desayuno', ALMUERZO: 'Almuerzo', CENA: 'Cena' };
  const D = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const dias: Record<string, Record<string, string[]>> = {};
  for (const it of r.propuesta) ((dias[it.fecha] ??= {})[it.turno] ??= []).push(it.platoId.replace('plato-', ''));
  const lineas = [`Menú propuesto para la semana del ${r.semanaInicio}:`];
  for (const f of Object.keys(dias).sort()) {
    const [y, m, d] = f.split('-').map(Number), dt = new Date(y, m - 1, d);
    lineas.push(`${D[(dt.getDay() + 6) % 7]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} — ` +
      Object.entries(dias[f]).map(([t, pl]) => `${T[t]}: ${pl.join(', ')}`).join(' · '));
  }
  const ahorro = r.propuesta.filter((i: any) => i.aprovechaInsumosPorVencer).length;
  const sinNutri = r.propuesta.filter((i: any) => i.turno === 'ALMUERZO' && !i.cumpleRequisitosNutricionales).length;
  if (ahorro) lineas.push(`${ahorro} platos aprovechan insumos por vencer.`);
  if (sinNutri) lineas.push(`Atención: ${sinNutri} almuerzos no llegan al mínimo nutricional.`);
  lineas.push('Las raciones salen del modelo predictivo. ¿Publico este menú?');
  return lineas.join('\n');
}

function monitorOffline(p: Paquete) {
  const c = p.constantes, m = p.monitor, hoy = isoLocal(new Date());
  const hallazgos: any[] = [], kpis: Record<string, number> = {};
  const desp = m.desperdicio.filter(d => (d.pct || 0) > c.umbralDesperdicio * 100);
  kpis.platosConDesperdicioAlto = desp.length;
  for (const d of desp) hallazgos.push({ tipo: 'desperdicio', severidad: d.pct > 40 ? 'ALTA' : 'MEDIA',
    mensaje: `Plato '${d.plato_id}' con ${d.pct}% de desperdicio`, recomendacion: 'Reducir porción servida 15% o rotar del menú 2 semanas' });
  if (m.asistencia.length) {
    const serie = m.asistencia.map(a => a.total || 0), prom = serie.reduce((s, x) => s + x, 0) / serie.length, ult = serie[serie.length - 1];
    kpis.asistenciaPromedio14d = Math.trunc(prom); kpis.asistenciaUltimoDia = Math.trunc(ult);
    if (prom > 0 && (prom - ult) / prom > c.umbralCaidaAsistencia) hallazgos.push({ tipo: 'asistencia', severidad: 'ALTA',
      mensaje: `Caída de asistencia: ${ult} vs promedio ${Math.trunc(prom)} (-${Math.trunc((prom - ult) / prom * 100)}%)`,
      recomendacion: 'Revisar si hubo evento académico (paro/examen) o rotar menú' });
  }
  const caros = m.costo.filter(x => (x.costoBs || 0) > c.presupuestoBsRacion);
  kpis.racionesSobrepresupuesto = caros.length;
  for (const x of caros) hallazgos.push({ tipo: 'costo', severidad: 'MEDIA',
    mensaje: `Plato '${x.plato_id || '?'}' costó ${x.costoBs} Bs (> ${c.presupuestoBsRacion} Bs objetivo)`,
    recomendacion: 'Negociar insumo con proveedor o cambiar proteína por alternativa económica' });
  const alta = hallazgos.some(h => h.severidad === 'ALTA');
  const resumenEjecutivo = `Resumen del ${hoy}: ${hallazgos.length} hallazgo(s). ` +
    (alta ? 'Hay alertas de severidad ALTA — se recomienda revisar hoy mismo.' : hallazgos.length ? 'Hay alertas MEDIAS para revisar esta semana.' : 'Todo en rango normal, sin alertas.');
  return { agente: 'monitor-comedor', fecha: hoy, kpis, hallazgos, resumenEjecutivo };
}

// Propuestas creadas o decididas sin conexión: esperan aquí hasta poder sincronizarse.
type PropuestaLocal = { id: string; tipo: 'menu' | 'compra' | 'info'; clave: string; titulo: string; resumen: string; payload: any;
  estado: string; creado: number; local: true; decision?: 'aprobar' | 'rechazar'; resultado?: string };
const propuestasLocales = () => LS.get<PropuestaLocal[]>('propuestas.local', []);

// =================== LOGIN ===================
@Component({
  standalone: true, selector: 'app-login', imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <div class="w-full max-w-md p-10 bg-slate-800/60 backdrop-blur rounded-2xl shadow-2xl border border-slate-700">
        <div class="text-center mb-10">
          <div class="w-16 h-16 mx-auto bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl flex items-center justify-center mb-4">
            <span class="text-white text-2xl font-bold tracking-tight">CU</span>
          </div>
          <h1 class="text-3xl font-bold text-white tracking-tight">Gestión operativa</h1>
          <p class="text-slate-400 mt-2 text-sm">Panel administrativo</p>
        </div>
        <form (ngSubmit)="login()" class="space-y-4">
          <div>
            <label class="block text-xs text-slate-400 uppercase mb-2 font-medium tracking-wider">Usuario</label>
            <input [(ngModel)]="username" name="username" required
              class="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-lg focus:outline-none focus:border-orange-500" />
          </div>
          <div>
            <label class="block text-xs text-slate-400 uppercase mb-2 font-medium tracking-wider">Contraseña</label>
            <input [(ngModel)]="password" name="password" type="password" required
              class="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-lg focus:outline-none focus:border-orange-500" />
          </div>
          <button type="submit" [disabled]="loading"
            class="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-600 hover:brightness-110 text-white font-semibold rounded-xl transition disabled:opacity-50">
            {{ loading ? 'Verificando…' : 'Ingresar' }}
          </button>
        </form>
        <p *ngIf="error" class="text-red-400 text-xs mt-4 text-center">{{ error }}</p>
      </div>
    </div>
  `,
})
class LoginComponent {
  username = ''; password = ''; loading = false; error = '';
  async login() {
    this.loading = true; this.error = '';
    try {
      const body = new URLSearchParams({ grant_type: 'password', client_id: 'backoffice-gestion', username: this.username, password: this.password });
      const r = await fetch(`${KC_URL}/realms/comedor-uagrm/protocol/openid-connect/token`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
      });
      if (!r.ok) throw new Error('Credenciales inválidas');
      const data = await r.json();
      sessionStorage.setItem('kc_token', data.access_token);
      sessionStorage.setItem('kc_user', this.username);
      sessionStorage.setItem('kc_roles', JSON.stringify((JSON.parse(atob(data.access_token.split('.')[1]))).realm_access?.roles || []));
      window.location.href = '/menus';
    } catch (e: any) { this.error = e.message; }
    finally { this.loading = false; }
  }
}

// =================== MENÚ + INVENTARIO ===================
@Component({
  standalone: true, selector: 'app-menus', imports: [CommonModule, DecimalPipe, FormsModule],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <section class="bg-slate-800/40 border border-slate-700 rounded-2xl flex flex-col h-[calc(100vh-190px)] min-h-[420px]">
        <header class="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-700/70">
          <div>
            <h3 class="text-sm text-white uppercase font-semibold tracking-wider">Menús de la semana</h3>
            <p class="text-xs text-slate-400 mt-0.5">{{ dias().length }} {{ dias().length === 1 ? 'día publicado' : 'días publicados' }}</p>
          </div>
          <select [(ngModel)]="turno" (change)="load()" class="px-3 py-1.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm focus:outline-none focus:border-cyan-500">
            <option>DESAYUNO</option><option>ALMUERZO</option><option>CENA</option>
          </select>
        </header>
        <div class="flex-1 overflow-auto p-4 space-y-3">
          <div *ngIf="dias().length === 0" class="text-center text-slate-500 text-sm py-10">Sin menús publicados para este turno.</div>
          <article *ngFor="let d of dias()" class="bg-slate-900/50 rounded-xl border border-slate-800 p-4">
            <div class="flex justify-between items-center mb-3">
              <span class="font-semibold text-white">{{ d.fecha }}</span>
              <span class="px-2 py-0.5 bg-slate-700/60 text-slate-300 text-xs rounded">{{ d.turno }}</span>
            </div>
            <div class="space-y-3">
              <div *ngFor="let p of d.platos">
                <div class="flex justify-between items-center gap-3">
                  <div class="min-w-0">
                    <div class="text-white text-sm font-medium truncate">{{ p.id }}</div>
                    <div class="text-xs text-slate-400">{{ p.disponibles }} de {{ p.cupo }} disponibles</div>
                  </div>
                  <span [class]="statusColor(p)" class="shrink-0 text-xs font-medium px-2 py-1 rounded">{{ statusLabel(p) }}</span>
                </div>
                <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
                  <div [class]="barColor(p)" class="h-full rounded-full" [style.width.%]="pct(p)"></div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section class="bg-slate-800/40 border border-slate-700 rounded-2xl flex flex-col h-[calc(100vh-190px)] min-h-[420px]">
        <header class="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-700/70">
          <div>
            <h3 class="text-sm text-white uppercase font-semibold tracking-wider">Inventario de insumos</h3>
            <p class="text-xs text-slate-400 mt-0.5">{{ insumos().length }} insumos registrados</p>
          </div>
          <span *ngIf="stockBajo().length" class="text-xs px-2.5 py-1 rounded border bg-red-500/15 text-red-400 border-red-500/40 font-medium">
            {{ stockBajo().length }} en alerta
          </span>
        </header>
        <div class="flex-1 overflow-auto px-6">
          <div *ngFor="let i of insumosOrdenados()" class="flex items-center justify-between gap-4 py-3.5 border-b border-slate-700/50 last:border-0">
            <div class="min-w-0 flex-1">
              <div class="text-white text-sm font-medium">{{ i.nombre }}</div>
              <div class="text-xs text-slate-400">{{ stockTotal(i) | number:'1.0-1' }} {{ i.unidad }} · mínimo {{ i.stockMinimo }}</div>
              <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
                <div [class]="stockTotal(i) > i.stockMinimo ? 'bg-emerald-500' : 'bg-red-500'" class="h-full rounded-full" [style.width.%]="stockPct(i)"></div>
              </div>
            </div>
            <span [class]="stockTotal(i) > i.stockMinimo ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' : 'bg-red-500/15 text-red-400 border-red-500/40'" class="shrink-0 text-xs px-2.5 py-1 rounded border font-medium">
              {{ stockTotal(i) > i.stockMinimo ? 'En rango' : 'Bajo' }}
            </span>
          </div>
        </div>
      </section>
    </div>
  `,
})
class MenusComponent implements OnInit {
  http = inject(HttpClient);
  turno = 'ALMUERZO';
  menus = signal<any[]>([]);
  insumos = signal<any[]>([]);
  stockBajo = signal<any[]>([]);
  // Un bloque por día: se fusionan los menús repetidos y se ordena por fecha.
  dias = computed(() => {
    const mapa = new Map<string, { fecha: string; turno: string; platos: Map<string, any> }>();
    for (const m of this.menus()) {
      const d = mapa.get(m.fecha) || { fecha: m.fecha, turno: m.turno, platos: new Map() };
      for (const p of this.toPorciones(m.porciones)) {
        const previo = d.platos.get(p.id);
        if (!previo || p.disponibles > previo.disponibles) d.platos.set(p.id, p);
      }
      mapa.set(m.fecha, d);
    }
    return [...mapa.values()]
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map(d => ({ fecha: d.fecha, turno: d.turno, platos: [...d.platos.values()] }));
  });
  insumosOrdenados = computed(() => [...this.insumos()].sort((a, b) =>
    Number(this.stockTotal(a) > a.stockMinimo) - Number(this.stockTotal(b) > b.stockMinimo)));
  ngOnInit() { this.load(); }
  load() {
    this.http.get<any[]>(`${API_URL}/menus/semana/${this.turno}`).subscribe(r => this.menus.set(r));
    cargarConCache<any[]>('/insumos', 'insumos').then(c => {
      if (!c) return;
      this.insumos.set(c.data);
      this.stockBajo.set(c.data.filter((i: any) => this.stockTotal(i) <= i.stockMinimo));
    });
  }
  toPorciones(p: any) { return Object.entries(p || {}).map(([id, v]: any) => ({ id, ...v })); }
  stockTotal(i: any) { return (i.lotes || []).reduce((s: number, l: any) => s + (l.cantidad?.valor || 0), 0); }
  statusColor(p: any) {
    const r = p.disponibles / p.cupo;
    return r > 0.5 ? 'bg-emerald-500/15 text-emerald-400' : r > 0.2 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400';
  }
  statusLabel(p: any) {
    const r = p.disponibles / p.cupo;
    return r > 0.5 ? 'Disponible' : r > 0.2 ? 'Limitado' : 'Crítico';
  }
  pct(p: any) { return p.cupo ? Math.max(0, Math.min(100, (p.disponibles / p.cupo) * 100)) : 0; }
  barColor(p: any) { const r = p.disponibles / p.cupo; return r > 0.5 ? 'bg-emerald-500' : r > 0.2 ? 'bg-amber-500' : 'bg-red-500'; }
  // Barra: stock actual frente a 3x el mínimo (tope visual).
  stockPct(i: any) { return Math.max(4, Math.min(100, (this.stockTotal(i) / ((i.stockMinimo || 1) * 3)) * 100)); }
}

// =================== ESTUDIANTES Y BECAS ===================
@Component({
  standalone: true, selector: 'app-admin-estudiantes', imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <!-- KPI superior -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <div class="text-xs text-slate-400 uppercase tracking-wider">Total estudiantes</div>
          <div class="text-3xl font-semibold text-white mt-2">{{ estudiantes().length }}</div>
        </div>
        <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <div class="text-xs text-slate-400 uppercase tracking-wider">Con beca activa</div>
          <div class="text-3xl font-semibold text-emerald-400 mt-2">{{ conBeca() }}</div>
        </div>
        <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <div class="text-xs text-slate-400 uppercase tracking-wider">Sin beca</div>
          <div class="text-3xl font-semibold text-slate-300 mt-2">{{ estudiantes().length - conBeca() }}</div>
        </div>
        <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <div class="text-xs text-slate-400 uppercase tracking-wider">Nuevos este mes</div>
          <div class="text-3xl font-semibold text-white mt-2">{{ nuevosMes() }}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- TABLA -->
        <div class="lg:col-span-2 bg-slate-800/40 border border-slate-700 rounded-xl p-6">
          <div class="flex justify-between items-center mb-5">
            <h3 class="text-sm text-slate-300 uppercase font-semibold tracking-wider">Usuarios <span class="text-xs text-slate-500 font-normal normal-case">({{ filtered().length }})</span></h3>
            <input [(ngModel)]="filtro" placeholder="Buscar por nombre, usuario, rol o email"
              class="px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm w-72 focus:outline-none focus:border-orange-500" />
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-xs text-slate-500 uppercase border-b border-slate-700">
                <tr>
                  <th class="text-left py-2 px-3 font-medium">Usuario / matrícula</th>
                  <th class="text-left py-2 px-3 font-medium">Nombre</th>
                  <th class="text-left py-2 px-3 font-medium">Correo</th>
                  <th class="text-left py-2 px-3 font-medium">Rol</th>
                  <th class="text-left py-2 px-3 font-medium">Beca</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let f of filtered()" (click)="f.est && elegir(f.est)"
                    [class]="(f.est && seleccionado()?.id === f.est.id) ? 'bg-orange-500/10' : 'hover:bg-slate-800/60'"
                    [style.cursor]="f.est ? 'pointer' : 'default'"
                    class="border-b border-slate-800/50 transition">
                  <td class="py-3 px-3 text-slate-300 font-mono text-xs">{{ f.usuario }}</td>
                  <td class="py-3 px-3 text-white">{{ f.nombre }}</td>
                  <td class="py-3 px-3 text-slate-400 text-xs">{{ f.email }}</td>
                  <td class="py-3 px-3">
                    <span *ngFor="let r of f.roles" [class]="rolColor(r)" class="text-xs px-2 py-0.5 rounded border mr-1 capitalize">{{ r }}</span>
                    <span *ngIf="f.sinCuenta" class="text-[10px] text-slate-500" title="Está en el padrón pero aún no tiene cuenta de acceso">sin cuenta</span>
                  </td>
                  <td class="py-3 px-3">
                    <span *ngIf="f.est && becaMap()[f.est.id]" class="text-xs px-2 py-0.5 bg-emerald-500/15 text-emerald-400 rounded border border-emerald-500/40">{{ becaMap()[f.est.id].tipo }}</span>
                    <span *ngIf="!(f.est && becaMap()[f.est.id])" class="text-xs text-slate-500">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div *ngIf="filtered().length === 0" class="text-center py-10 text-slate-500 text-sm">
              Sin resultados para «{{ filtro }}»
            </div>
          </div>
        </div>

        <!-- PANEL LATERAL -->
        <div class="space-y-6">
          <!-- Alta -->
          <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-6">
            <h3 class="text-sm text-slate-300 uppercase mb-4 font-semibold tracking-wider">Alta de usuario</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Rol</label>
                <select [(ngModel)]="nuevoRol" class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
                  <option value="estudiante">Estudiante</option>
                  <option value="cocinero">Cocinero</option>
                  <option value="administrador">Administrador</option>
                </select>
              </div>
              <div *ngIf="nuevoRol === 'estudiante'">
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Matrícula universitaria (será su usuario)</label>
                <input [(ngModel)]="nuevoRegistro" placeholder="212345678"
                  class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
              </div>
              <div *ngIf="nuevoRol !== 'estudiante'">
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Usuario</label>
                <input [(ngModel)]="nuevoUsuario" placeholder="cocina.central" autocomplete="off"
                  class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Nombre completo</label>
                <input [(ngModel)]="nuevoNombre" placeholder="Juan Pérez Rodríguez"
                  class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Correo institucional</label>
                <input [(ngModel)]="nuevoEmail" placeholder="jperez@uagrm.edu.bo" type="email"
                  class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Teléfono</label>
                <input [(ngModel)]="nuevoTel" placeholder="+591 70000000"
                  class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Contraseña (mín. 8 caracteres)</label>
                <div class="flex gap-2">
                  <input [(ngModel)]="nuevaPassword" [type]="verPassword ? 'text' : 'password'" autocomplete="new-password"
                    class="flex-1 min-w-0 px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
                  <button type="button" (click)="verPassword = !verPassword"
                    class="px-3 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg">{{ verPassword ? 'Ocultar' : 'Ver' }}</button>
                  <button type="button" (click)="generarPassword()"
                    class="px-3 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg">Generar</button>
                </div>
              </div>
              <button (click)="crear()" [disabled]="!puedeCrear() || creando"
                class="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg font-semibold text-sm disabled:opacity-40 hover:brightness-110 transition">
                {{ creando ? 'Creando…' : 'Crear usuario' }}
              </button>
            </div>
          </div>

          <!-- Beca -->
          <div *ngIf="seleccionado()" class="bg-slate-800/40 border border-slate-700 rounded-xl p-6">
            <h3 class="text-sm text-slate-300 uppercase mb-2 font-semibold tracking-wider">Asignación de beca</h3>
            <p class="text-xs text-slate-400 mb-4">Estudiante: <span class="text-white">{{ seleccionado().nombre }}</span></p>

            <div *ngIf="becaActual()" class="mb-4 bg-emerald-500/10 border border-emerald-500/40 rounded-lg p-3">
              <div class="text-xs text-emerald-400 uppercase tracking-wider">Beca activa</div>
              <div class="text-sm text-white font-semibold mt-1">Modalidad: {{ becaActual().tipo }}</div>
              <div class="text-xs text-slate-300 mt-1">Consumidas: {{ becaActual().racionesUsadasMes }} / {{ becaActual().cupoRacionesMes }} en el mes</div>
            </div>

            <div class="space-y-3">
              <div>
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Modalidad</label>
                <select [(ngModel)]="nuevoTipoBeca" class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
                  <option value="completa">Completa — 60 raciones mensuales</option>
                  <option value="media">Media — 30 raciones mensuales</option>
                  <option value="parcial">Parcial — 15 raciones mensuales</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Vigencia en meses</label>
                <input [(ngModel)]="nuevoMesesVig" type="number" min="1" max="12"
                  class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
              </div>
              <button (click)="asignarBeca()" class="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg font-semibold text-sm hover:brightness-110 transition">
                Asignar beca
              </button>
            </div>
          </div>
        </div>
      </div>

      <div *ngIf="toast()" class="fixed top-6 right-6 px-5 py-3 rounded-xl shadow-2xl z-50"
        [class]="toast().kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'">{{ toast().msg }}</div>
    </div>
  `,
})
class AdminEstudiantesComponent implements OnInit {
  http = inject(HttpClient);
  estudiantes = signal<any[]>([]);
  usuarios = signal<any[]>([]);
  seleccionado = signal<any>(null);
  becaActual = signal<any>(null);
  becaMap = signal<Record<string, any>>({});
  filtro = '';
  nuevoRegistro = ''; nuevoNombre = ''; nuevoEmail = ''; nuevoTel = '';
  nuevoRol: 'estudiante'|'cocinero'|'administrador' = 'estudiante';
  nuevoUsuario = ''; nuevaPassword = ''; verPassword = false; creando = false;
  nuevoTipoBeca: 'completa'|'media'|'parcial' = 'completa';
  nuevoMesesVig = 12;
  toast = signal<any>(null);

  conBeca = computed(() => Object.keys(this.becaMap()).length);
  nuevosMes = computed(() => this.estudiantes().length);  // placeholder; sin fechas de alta en backend aún

  ngOnInit() { this.load(); }

  load() {
    this.http.get<any[]>(`${API_URL}/usuarios`).subscribe({ next: r => this.usuarios.set(r || []), error: () => this.usuarios.set([]) });
    this.http.get<any[]>(`${API_URL}/estudiantes`).subscribe({
      next: r => {
        const lista = r || [];
        this.estudiantes.set(lista);
        // Cargar becas en paralelo para pintar la columna
        const map: Record<string, any> = {};
        let left = lista.length;
        if (left === 0) { this.becaMap.set({}); return; }
        for (const e of lista) {
          this.http.get<any>(`${API_URL}/estudiantes/${e.id}/beca`).subscribe({
            next: (b: any) => { if (b?.tieneBeca) map[e.id] = b; left--; if (left === 0) this.becaMap.set({ ...map }); },
            error: () => { left--; if (left === 0) this.becaMap.set({ ...map }); }
          });
        }
      },
      error: () => this.estudiantes.set([])
    });
  }

  // Una fila por cuenta (Keycloak) + estudiantes del padrón que aún no tienen cuenta.
  filas = computed(() => {
    const est = new Map(this.estudiantes().map((e: any) => [e.registroUniv, e]));
    const vistos = new Set<string>();
    const filas: any[] = this.usuarios().map((u: any) => {
      const e = est.get(u.username) || null;
      vistos.add(u.username);
      return { usuario: u.username, nombre: e?.nombre || u.nombre, email: e?.email || u.email, roles: u.roles, est: e, sinCuenta: false };
    });
    for (const e of this.estudiantes()) {
      if (!vistos.has(e.registroUniv)) filas.push({ usuario: e.registroUniv, nombre: e.nombre, email: e.email, roles: ['estudiante'], est: e, sinCuenta: true });
    }
    const orden = (f: any) => (f.roles.includes('administrador') ? 0 : f.roles.includes('cocinero') ? 1 : 2);
    return filas.sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre));
  });

  rolColor(r: string) {
    return r === 'administrador' ? 'bg-orange-500/15 text-orange-400 border-orange-500/40'
      : r === 'cocinero' ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/40'
      : r === 'estudiante' ? 'bg-slate-500/15 text-slate-300 border-slate-500/40'
      : 'bg-violet-500/15 text-violet-300 border-violet-500/40';
  }

  filtered() {
    const q = this.filtro.toLowerCase().trim();
    if (!q) return this.filas();
    return this.filas().filter((f: any) =>
      (f.nombre + ' ' + f.usuario + ' ' + (f.email || '') + ' ' + f.roles.join(' ')).toLowerCase().includes(q)
    );
  }

  elegir(e: any) {
    this.seleccionado.set(e);
    const b = this.becaMap()[e.id];
    this.becaActual.set(b || null);
    if (!b) {
      this.http.get(`${API_URL}/estudiantes/${e.id}/beca`).subscribe({
        next: (res: any) => this.becaActual.set(res?.tieneBeca ? res : null),
      });
    }
  }

  notif(msg: string, kind: 'ok'|'err' = 'ok') {
    this.toast.set({ msg, kind });
    setTimeout(() => this.toast.set(null), 4000);
  }

  puedeCrear() {
    const id = this.nuevoRol === 'estudiante' ? this.nuevoRegistro : this.nuevoUsuario;
    return !!id.trim() && !!this.nuevoNombre.trim() && this.nuevaPassword.length >= 8;
  }

  generarPassword() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const r = crypto.getRandomValues(new Uint32Array(12));
    this.nuevaPassword = Array.from(r, n => abc[n % abc.length]).join('');
    this.verPassword = true;
  }

  crear() {
    this.creando = true;
    const rol = this.nuevoRol;
    const usuario = rol === 'estudiante' ? this.nuevoRegistro.trim() : this.nuevoUsuario.trim();
    this.http.post(`${API_URL}/usuarios`, {
      rol,
      registroUniv: this.nuevoRegistro.trim(),
      username: this.nuevoUsuario.trim(),
      nombre: this.nuevoNombre.trim(),
      email: this.nuevoEmail.trim(),
      telefono: this.nuevoTel,
      password: this.nuevaPassword,
    }).subscribe({
      next: () => {
        this.creando = false;
        this.notif(`Usuario «${usuario}» creado (${rol}). Contraseña: ${this.verPassword ? this.nuevaPassword : 'la ingresada'}`);
        this.nuevoRegistro=''; this.nuevoUsuario=''; this.nuevoNombre=''; this.nuevoEmail=''; this.nuevoTel=''; this.nuevaPassword=''; this.verPassword = false;
        this.load();
      },
      error: e => { this.creando = false; this.notif('Error: ' + (e.error?.error || e.error?.message || e.message), 'err'); }
    });
  }

  asignarBeca() {
    const est = this.seleccionado();
    if (!est) return;
    this.http.post(`${API_URL}/estudiantes/${est.id}/beca`, { tipo: this.nuevoTipoBeca, mesesVigencia: this.nuevoMesesVig }).subscribe({
      next: () => { this.notif(`Beca ${this.nuevoTipoBeca} asignada a ${est.nombre}`); this.elegir(est); this.load(); },
      error: e => this.notif('Error: ' + (e.error?.message || e.message), 'err')
    });
  }
}

// =================== PUBLICAR MENÚ + RECIBIR INSUMOS ===================
@Component({
  standalone: true, selector: 'app-admin-operacion', imports: [CommonModule, FormsModule],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-6">
        <h3 class="text-sm text-slate-300 uppercase mb-5 font-semibold tracking-wider">Publicación de menú</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Fecha</label>
            <input type="date" [(ngModel)]="menuFecha" class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Turno</label>
            <select [(ngModel)]="menuTurno" class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
              <option>DESAYUNO</option><option>ALMUERZO</option><option>CENA</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Platos a ofrecer</label>
            <div class="space-y-2">
              <div *ngFor="let p of menuPlatos; let i = index" class="flex gap-2">
                <input [(ngModel)]="p.id" placeholder="Identificador del plato (ej. ensalada-cesar)" class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded text-sm" />
                <input [(ngModel)]="p.cupo" type="number" min="1" placeholder="Cupo" class="w-24 px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded text-sm" />
                <button (click)="quitarPlato(i)" class="px-3 bg-slate-700 text-slate-300 rounded hover:bg-red-500/40">×</button>
              </div>
              <button (click)="agregarPlato()" class="w-full py-2 border border-dashed border-slate-700 text-slate-400 rounded text-xs hover:bg-slate-800">+ Agregar otro plato</button>
            </div>
          </div>
          <button (click)="publicarMenu()" [disabled]="!menuFecha || menuPlatos.length === 0"
            class="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg font-semibold text-sm disabled:opacity-40 hover:brightness-110 transition">
            Publicar menú
          </button>
        </div>
      </div>

      <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-6">
        <h3 class="text-sm text-slate-300 uppercase mb-5 font-semibold tracking-wider">Recepción de insumos</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Insumo</label>
            <select [(ngModel)]="insSel" class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
              <option value="">— Seleccionar —</option>
              <option *ngFor="let i of insumos()" [value]="i.id">{{ i.nombre }} ({{ i.unidad }})</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Cantidad recibida</label>
            <input [(ngModel)]="loteCant" type="number" min="0.1" step="0.1" placeholder="0.0"
              class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Proveedor</label>
            <input [(ngModel)]="loteProv" placeholder="Nombre del proveedor"
              class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-[11px] text-slate-500 uppercase mb-1 tracking-wider">Fecha de vencimiento</label>
            <input [(ngModel)]="loteVence" type="date" class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
          </div>
          <button (click)="recibirLote()" [disabled]="!insSel || !loteCant"
            class="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg font-semibold text-sm disabled:opacity-40 hover:brightness-110 transition">
            Registrar recepción
          </button>

          <div class="pt-5 border-t border-slate-700">
            <h4 class="text-xs text-slate-400 uppercase mb-3 font-semibold tracking-wider">Alta de nuevo insumo</h4>
            <input [(ngModel)]="insNuevoNombre" placeholder="Nombre del insumo"
              class="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm mb-2" />
            <div class="grid grid-cols-2 gap-2 mb-2">
              <input [(ngModel)]="insNuevaUnidad" placeholder="Unidad (kg, l, un.)"
                class="px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
              <input [(ngModel)]="insNuevoMin" type="number" placeholder="Stock mínimo"
                class="px-3 py-2.5 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
            </div>
            <button (click)="crearInsumo()" [disabled]="!insNuevoNombre || !insNuevaUnidad"
              class="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs disabled:opacity-40 transition">
              Crear insumo
            </button>
          </div>
        </div>
      </div>
    </div>
    <div *ngIf="toast()" class="fixed top-6 right-6 px-5 py-3 rounded-xl shadow-2xl z-50"
      [class]="toast().kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'">{{ toast().msg }}</div>
  `,
})
class AdminOperacionComponent implements OnInit {
  http = inject(HttpClient);
  menuFecha = new Date().toISOString().slice(0, 10);
  menuTurno = 'ALMUERZO';
  menuPlatos: { id: string; cupo: number }[] = [{ id: '', cupo: 50 }];
  insumos = signal<any[]>([]);
  insSel = ''; loteCant: number | null = null; loteProv = ''; loteVence = '';
  insNuevoNombre = ''; insNuevaUnidad = 'kg'; insNuevoMin = 5;
  toast = signal<any>(null);
  ngOnInit() { this.load(); }
  load() { this.http.get<any[]>(`${API_URL}/insumos`).subscribe({ next: r => this.insumos.set(r || []), error: () => this.insumos.set([]) }); }
  notif(msg: string, kind: 'ok'|'err' = 'ok') { this.toast.set({ msg, kind }); setTimeout(() => this.toast.set(null), 4000); }
  agregarPlato() { this.menuPlatos.push({ id: '', cupo: 50 }); }
  quitarPlato(i: number) { this.menuPlatos.splice(i, 1); }
  publicarMenu() {
    const platos = this.menuPlatos.filter(p => p.id).map(p => ({ platoId: p.id, cupo: Number(p.cupo) }));
    if (platos.length === 0) return this.notif('Debe agregar al menos un plato', 'err');
    this.http.post(`${API_URL}/menus`, { fecha: this.menuFecha, turno: this.menuTurno, platos }).subscribe({
      next: () => { this.notif('Menú publicado'); this.menuPlatos = [{ id: '', cupo: 50 }]; },
      error: e => this.notif('Error: ' + (e.error?.message || e.message), 'err')
    });
  }
  recibirLote() {
    const loteId = 'lote-' + Date.now();
    const insumo = this.insumos().find(i => i.id === this.insSel);
    const unidad = insumo?.unidad || 'kg';
    this.http.post(`${API_URL}/insumos/lotes`, {
      insumoId: this.insSel, loteId, cantidad: Number(this.loteCant), unidad,
      vence: this.loteVence || new Date(Date.now()+30*24*3600*1000).toISOString().slice(0,10)
    }).subscribe({
      next: () => { this.notif('Lote registrado'); this.loteCant = null; this.loteProv = ''; this.load(); },
      error: e => this.notif('Error: ' + (e.error?.message || e.message), 'err')
    });
  }
  crearInsumo() {
    const id = this.insNuevoNombre.toUpperCase().replace(/\s+/g, '_');
    this.http.post(`${API_URL}/insumos`, { id, nombre: this.insNuevoNombre, unidad: this.insNuevaUnidad, stockMinimo: Number(this.insNuevoMin) }).subscribe({
      next: () => { this.notif('Insumo creado'); this.insNuevoNombre = ''; this.load(); },
      error: e => this.notif('Error: ' + (e.error?.message || e.message), 'err')
    });
  }
}

// =================== CAJA / QR ===================
@Component({
  standalone: true, selector: 'app-caja', imports: [CommonModule, FormsModule, JsonPipe],
  template: `
    <div class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <div class="text-xs text-slate-400 uppercase tracking-wider">Validadas hoy</div>
          <div class="text-3xl font-semibold text-emerald-400 mt-2">{{ contador() }}</div>
        </div>
        <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <div class="text-xs text-slate-400 uppercase tracking-wider">Rechazadas</div>
          <div class="text-3xl font-semibold text-red-400 mt-2">{{ rechazadas() }}</div>
        </div>
        <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
          <div class="text-xs text-slate-400 uppercase tracking-wider">Modo</div>
          <div class="text-lg font-medium text-white mt-2">Línea de atención</div>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-6">
          <h3 class="text-sm text-slate-300 uppercase mb-4 font-semibold tracking-wider">Escaneo con cámara</h3>
          <div class="flex gap-2 mb-4">
            <button (click)="startCamera()" [disabled]="scanning()"
              class="flex-1 py-3 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-semibold rounded-lg disabled:opacity-50 hover:brightness-110 transition">
              Iniciar cámara
            </button>
            <button (click)="stopCamera()" [disabled]="!scanning()"
              class="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg disabled:opacity-50 transition">
              Detener
            </button>
          </div>
          <div id="qr-reader" class="rounded-lg overflow-hidden bg-slate-900"></div>
        </div>
        <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-6">
          <h3 class="text-sm text-slate-300 uppercase mb-4 font-semibold tracking-wider">Validación manual</h3>
          <input [(ngModel)]="qr" placeholder="Token del QR del estudiante"
            class="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-lg focus:outline-none focus:border-orange-500 mb-3" />
          <button (click)="validar()" [disabled]="!qr"
            class="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-semibold rounded-lg disabled:opacity-50 hover:brightness-110 transition">
            Validar
          </button>
          <div *ngIf="resultado()" class="mt-4 p-4 rounded-lg border"
            [class]="resultado().ok ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-red-500/10 border-red-500/40'">
            <div class="font-semibold text-white">{{ resultado().ok ? 'Ingreso autorizado' : (resultado().motivo || 'Validación rechazada') }}</div>
            <div *ngIf="resultado().reservaId" class="text-xs text-slate-400 mt-1">Reserva: {{ resultado().reservaId }}</div>
          </div>
        </div>
      </div>
    </div>
  `,
})
class CajaComponent implements OnInit, AfterViewInit {
  http = inject(HttpClient);
  qr = '';
  scanning = signal(false);
  resultado = signal<any>(null);
  contador = signal(0);
  rechazadas = signal(0);
  html5QrCode: any;
  ngOnInit() {}
  ngAfterViewInit() {
    if (!(window as any).Html5Qrcode) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
      document.head.appendChild(s);
    }
  }
  startCamera() {
    const H = (window as any).Html5Qrcode;
    if (!H) { alert('Librería cargando, intente nuevamente en 2 segundos'); return; }
    this.html5QrCode = new H('qr-reader');
    this.html5QrCode.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, (decoded: string) => {
      this.qr = decoded; this.validar(); this.stopCamera();
    }, () => {}).then(() => this.scanning.set(true)).catch((e: any) => alert('Cámara no disponible: ' + e));
  }
  stopCamera() { if (this.html5QrCode) { this.html5QrCode.stop(); this.scanning.set(false); } }
  validar() {
    this.http.post(`${API_URL}/ingreso/validar-qr`, { qr: this.qr }).subscribe({
      next: (r: any) => {
        this.resultado.set(r);
        if (r.ok) this.contador.update(c => c + 1); else this.rechazadas.update(c => c + 1);
      },
      error: e => this.resultado.set({ ok: false, motivo: e.message })
    });
  }
}

// =================== AGENTES ===================
@Component({
  standalone: true, selector: 'app-agentes', imports: [CommonModule, FormsModule, JsonPipe],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3 text-xs">
      <span [class]="servidor() ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' : 'bg-amber-500/15 text-amber-400 border-amber-500/40'"
            class="px-2.5 py-1 rounded border font-medium">
        {{ servidor() ? 'Conectado al servidor' : 'Sin conexión: los agentes corren en este navegador' }}
      </span>
      <span *ngIf="tg() as t" [class]="t.configurado && t.vinculado ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' : 'bg-amber-500/15 text-amber-400 border-amber-500/40'"
            class="px-2.5 py-1 rounded border font-medium">
        {{ !t.configurado ? 'Telegram sin configurar' : !t.vinculado ? 'Telegram: ningún administrador vinculado (escribe /start al bot)' : 'Telegram conectado · ' + t.administradores + ' administrador(es)' }}
      </span>
      <span *ngIf="tg()?.mensajesEnCola" class="text-amber-400">{{ tg().mensajesEnCola }} mensaje(s) esperando internet; saldrán solos</span>
      <span *ngIf="porSincronizar() > 0" class="text-amber-400">{{ porSincronizar() }} propuesta(s) guardada(s) aquí; se enviarán a Telegram al volver la conexión</span>
      <span *ngIf="paquete() as q" class="text-slate-500">Datos guardados para trabajar sin conexión: {{ q.generado }}</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div *ngFor="let a of agentes" class="bg-slate-800/40 border border-slate-700 rounded-xl p-6 hover:border-orange-500/40 transition">
        <div class="mb-4">
          <h4 class="font-semibold text-white">{{ a.titulo }}</h4>
          <p class="text-sm text-slate-400 mt-2 leading-relaxed">{{ a.desc }}</p>
          <p class="text-xs text-emerald-400 mt-2">Funciona sin internet</p>
        </div>
        <button (click)="correr(a.name)" [disabled]="loading() === a.name"
          class="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-medium rounded-lg disabled:opacity-50 hover:brightness-110 transition">
          {{ loading() === a.name ? 'Ejecutando…' : 'Ejecutar' }}
        </button>
        <div *ngIf="mensajes()[a.name]" class="mt-4 text-sm text-amber-300">{{ mensajes()[a.name] }}</div>
        <div *ngIf="a.name === 'monitor-comedor' && resultados()[a.name] as r" class="mt-4 space-y-2 text-sm">
          <div class="text-slate-300">{{ r.resumenEjecutivo }}</div>
          <div *ngFor="let h of r.hallazgos" class="py-1 border-b border-slate-800 text-slate-300">
            <span [class]="h.severidad === 'ALTA' ? 'text-red-400' : 'text-amber-400'" class="text-xs font-semibold mr-1">{{ h.severidad }}</span>{{ h.mensaje }}
          </div>
        </div>

        <div *ngIf="borrador()[a.name] as b" class="mt-5 pt-4 border-t border-slate-700/70 space-y-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-xs text-slate-400 uppercase tracking-wider">Ejecución automática</span>
            <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" [(ngModel)]="b.activo" class="accent-orange-500"> {{ b.activo ? 'Activa' : 'Pausada' }}
            </label>
          </div>
          <select [(ngModel)]="b.modo" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
            <option value="cada">Cada cierto tiempo</option>
            <option value="diario">Todos los días a una hora</option>
            <option value="semanal">Días de la semana a una hora</option>
          </select>
          <div *ngIf="b.modo === 'cada'" class="flex gap-2">
            <input type="number" min="1" [(ngModel)]="b.valor" class="w-24 px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm" />
            <select [(ngModel)]="b.unidad" class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
              <option [ngValue]="1">minutos</option><option [ngValue]="60">horas</option><option [ngValue]="1440">días</option>
            </select>
          </div>
          <div *ngIf="b.modo !== 'cada'" class="flex items-center gap-2">
            <span class="text-xs text-slate-400">Hora</span>
            <select [ngModel]="b.hora.slice(0, 2)" (ngModelChange)="b.hora = $event + ':' + b.hora.slice(3, 5)"
              class="px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
              <option *ngFor="let h of horas" [value]="h">{{ h }}</option>
            </select>
            <span class="text-slate-400">:</span>
            <select [ngModel]="b.hora.slice(3, 5)" (ngModelChange)="b.hora = b.hora.slice(0, 2) + ':' + $event"
              class="px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-lg text-sm">
              <option *ngFor="let m of minutos" [value]="m">{{ m }}</option>
            </select>
            <span class="text-xs text-slate-500">(24 h)</span>
          </div>
          <div *ngIf="b.modo === 'semanal'" class="flex flex-wrap gap-1.5">
            <button type="button" *ngFor="let d of diasSemana; let i = index" (click)="alternarDia(b, i)"
              [class]="b.dias.includes(i) ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-300'"
              class="w-9 h-9 rounded-lg text-xs font-medium">{{ d }}</button>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-slate-500">{{ proximaTexto(a.name) }}</span>
            <button (click)="guardarHorario(a.name)" [disabled]="guardandoH() === a.name || !servidor()"
              class="px-4 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-medium">
              {{ guardandoH() === a.name ? 'Guardando…' : 'Guardar horario' }}
            </button>
          </div>
          <div *ngIf="msgH()[a.name]" class="text-xs" [class]="msgH()[a.name].startsWith('Guardado') ? 'text-emerald-400' : 'text-amber-300'">{{ msgH()[a.name] }}</div>
        </div>
      </div>
    </div>

    <section class="mt-8 bg-slate-800/40 border border-slate-700 rounded-2xl">
      <header class="px-6 py-4 border-b border-slate-700/70">
        <h3 class="text-sm text-white uppercase font-semibold tracking-wider">Propuestas para tu aprobación</h3>
        <p class="text-xs text-slate-400 mt-0.5">También te llegan a Telegram con botones Aprobar / Rechazar. Aprobar ejecuta la acción.</p>
      </header>
      <div class="p-4 space-y-3">
        <div *ngIf="propuestas().length === 0" class="text-center text-slate-500 text-sm py-8">Todavía no hay propuestas. Ejecuta un agente.</div>
        <article *ngFor="let p of propuestas()" class="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-white font-medium text-sm">{{ p.titulo }}</div>
              <div class="text-[11px] text-slate-500 mt-0.5">{{ p.creado * 1000 | date:'dd/MM HH:mm' }} · {{ p.tipo === 'menu' ? 'Menú' : p.tipo === 'compra' ? 'Compra' : 'Informe' }}
                <span *ngIf="p.local" class="text-amber-400"> · guardada en este navegador</span></div>
            </div>
            <span [class]="estadoColor(p.estado)" class="shrink-0 text-xs px-2.5 py-1 rounded border font-medium">{{ p.estado }}</span>
          </div>
          <pre class="mt-3 text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{{ p.resumen }}</pre>
          <div *ngIf="p.resultado" class="mt-2 text-xs text-slate-400">{{ p.resultado }}</div>
          <div *ngIf="p.estado === 'PENDIENTE'" class="mt-3 flex gap-2">
            <button (click)="resolver(p, true)" [disabled]="resolviendo() === p.id"
              class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium">Aprobar</button>
            <button (click)="resolver(p, false)" [disabled]="resolviendo() === p.id"
              class="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded-lg">Rechazar</button>
          </div>
        </article>
      </div>
    </section>
  `,
})
class AgentesComponent implements OnInit, OnDestroy {
  loading = signal<string | null>(null);
  resultados = signal<Record<string, any>>({});
  mensajes = signal<Record<string, string>>({});
  propuestas = signal<any[]>([]);
  tg = signal<any>(null);
  servidor = signal(true);
  paquete = signal<{ generado: string } | null>(LS.get<any>('paquete', null));
  porSincronizar = signal(0);
  resolviendo = signal<string | null>(null);
  // Programación editable de cada agente
  diasSemana = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));      // 00–23: siempre 24 h
  minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  horarios = signal<Record<string, any>>({});
  borrador = signal<Record<string, any>>({});
  guardandoH = signal<string | null>(null);
  msgH = signal<Record<string, string>>({});
  private timer?: any;
  private ultimoPaquete = 0;
  agentes = [
    { name: 'monitor-comedor', titulo: 'Monitor del comedor', desc: 'Monitorea el servicio y te avisa por Telegram: caídas de asistencia, platos con alto desperdicio y costo por ración fuera de presupuesto.' },
    { name: 'planificador-menu', titulo: 'Planificador de menú', desc: 'Propone el menú de la próxima semana priorizando stock, insumos por vencer y requisitos nutricionales, con las raciones del modelo predictivo. Si lo apruebas, se publica.' },
    { name: 'inventario-compras', titulo: 'Inventario y compras', desc: 'Detecta stock bajo y lotes por vencer y prepara la orden de compra. Si la apruebas, queda lista para pedir a los proveedores.' },
  ];

  ngOnInit() {
    this.refrescar();
    this.timer = setInterval(() => this.refrescar(), 5000);
    window.addEventListener('online', this.alVolver);
  }
  ngOnDestroy() { clearInterval(this.timer); window.removeEventListener('online', this.alVolver); }
  private alVolver = () => this.refrescar();

  private aBorrador(h: any) {
    const m = h.cadaMin, unidad = m % 1440 === 0 ? 1440 : m % 60 === 0 ? 60 : 1;
    return { activo: h.activo, modo: h.modo, valor: m / unidad, unidad, hora: h.hora, dias: [...h.dias] };
  }

  private async cargarHorarios() {
    const h = await llamar('/agentes/horarios');
    this.horarios.set(h);
    this.borrador.update(b => {
      const nuevo = { ...b };
      for (const n of Object.keys(h)) if (!nuevo[n]) nuevo[n] = this.aBorrador(h[n].horario);   // no pisa lo que se está editando
      return nuevo;
    });
  }

  alternarDia(b: any, i: number) { b.dias = b.dias.includes(i) ? b.dias.filter((d: number) => d !== i) : [...b.dias, i].sort(); }

  proximaTexto(n: string) {
    const h = this.horarios()[n];
    if (!h) return '';
    if (!h.horario.activo) return 'Pausada: no se ejecuta sola';
    const f = (s: string | null) => s ? new Date(s).toLocaleString('es-BO', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
    return `Próxima: ${f(h.proxima)} · Última: ${f(h.ultima)}`;
  }

  async guardarHorario(n: string) {
    const b = this.borrador()[n];
    this.guardandoH.set(n);
    try {
      const r = await llamar(`/agentes/horarios/${n}`, { method: 'PUT', body: JSON.stringify({
        activo: b.activo, modo: b.modo, cadaMin: Math.round(Number(b.valor) * Number(b.unidad)), hora: b.hora, dias: b.dias }) }, 10000);
      this.horarios.update(x => ({ ...x, [n]: r }));
      this.borrador.update(x => ({ ...x, [n]: this.aBorrador(r.horario) }));
      this.msgH.update(x => ({ ...x, [n]: 'Guardado. ' + (r.horario.activo ? 'Se ejecutará solo según este horario.' : 'Quedó pausada.') }));
    } catch (e: any) {
      let detalle = 'No se pudo guardar. Revisa los datos.';
      try { detalle = e?.detalle || detalle; } catch {}
      this.msgH.update(x => ({ ...x, [n]: detalle }));
    } finally { this.guardandoH.set(null); }
  }

  private contar() { this.porSincronizar.set(propuestasLocales().length + LS.get<any[]>('decisiones', []).length); }

  async refrescar() {
    try {
      const [lista, tg] = await Promise.all([llamar('/agentes/propuestas'), llamar('/agentes/telegram')]);
      this.servidor.set(true); this.tg.set(tg);
      this.cargarHorarios().catch(() => {});
      LS.set('propuestas.servidor', lista);
      if (await this.sincronizar()) { this.propuestas.set(this.mezclar(await llamar('/agentes/propuestas'))); }
      else this.propuestas.set(this.mezclar(lista));
      if (Date.now() - this.ultimoPaquete > 10 * 60 * 1000) {      // deja datos frescos para trabajar sin conexión
        this.ultimoPaquete = Date.now();
        cargarPaquete().then(q => q && this.paquete.set({ generado: q.data.generado }));
        cargarConCache<any[]>('/insumos', 'insumos');
      }
    } catch {
      this.servidor.set(false);
      this.propuestas.set(this.mezclar(LS.get<any[]>('propuestas.servidor', [])));
    }
    this.contar();
  }

  // Lo creado o decidido sin conexión se envía al servidor (que avisa a Telegram y ejecuta lo aprobado).
  private async sincronizar(): Promise<boolean> {
    const locales = propuestasLocales(), decisiones = LS.get<any[]>('decisiones', []);
    if (!locales.length && !decisiones.length) return false;
    if (locales.length) {
      await llamar('/agentes/propuestas/sincronizar', { method: 'POST', body: JSON.stringify(locales.map(p =>
        ({ tipo: p.tipo, clave: p.clave, titulo: p.titulo, resumen: p.resumen, payload: p.payload, decision: p.decision ?? null }))) }, 20000);
      LS.set('propuestas.local', []);
    }
    for (const d of decisiones) {
      try { await llamar(`/agentes/propuestas/${d.id}/${d.aprobar ? 'aprobar' : 'rechazar'}`, { method: 'POST', body: '{}' }, 20000); } catch {}
    }
    LS.set('decisiones', []);
    return true;
  }

  private mezclar(servidor: any[]): any[] {
    const dec = LS.get<any[]>('decisiones', []);
    const deServidor = servidor.map(p => {
      const d = dec.find(x => x.id === p.id);
      return d && p.estado === 'PENDIENTE'
        ? { ...p, estado: d.aprobar ? 'APROBADA' : 'RECHAZADA', resultado: 'Decidida sin conexión: se aplicará al volver la conexión.' } : p;
    });
    return [...propuestasLocales(), ...deServidor];
  }

  estadoColor(e: string) {
    return e === 'PENDIENTE' ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
      : e === 'EJECUTADA' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
      : e === 'ERROR' ? 'bg-red-500/15 text-red-400 border-red-500/40'
      : e === 'APROBADA' ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/40'
      : 'bg-slate-500/15 text-slate-300 border-slate-500/40';
  }

  async resolver(p: any, aprobar: boolean) {
    this.resolviendo.set(p.id);
    try {
      if (p.local) {
        LS.set('propuestas.local', propuestasLocales().map(x => x.id === p.id ? { ...x, decision: aprobar ? 'aprobar' : 'rechazar',
          estado: aprobar ? 'APROBADA' : 'RECHAZADA', resultado: 'Decidida sin conexión: se aplicará al volver la conexión.' } : x));
      } else {
        try { await llamar(`/agentes/propuestas/${p.id}/${aprobar ? 'aprobar' : 'rechazar'}`, { method: 'POST', body: '{}' }, 20000); }
        catch { LS.set('decisiones', [...LS.get<any[]>('decisiones', []), { id: p.id, aprobar }]); }
      }
    } finally { this.resolviendo.set(null); }
    await this.refrescar();
  }

  async correr(name: string) {
    this.loading.set(name);
    this.mensajes.update(x => ({ ...x, [name]: '' }));
    try {
      let r: any, offline = false;
      try {
        r = await llamar(`/agentes/${name}`, { method: 'POST', body: JSON.stringify({ objetivo: 'Reporte operativo', contexto: {} }) }, 60000);
      } catch {
        offline = true;
        const q = await cargarPaquete();
        if (!q) {
          this.mensajes.update(x => ({ ...x, [name]: 'Sin conexión y sin datos guardados. Abre este módulo una vez con conexión.' }));
          return;
        }
        r = this.correrLocal(name, q.data);
      }
      if (name === 'monitor-comedor') this.resultados.update(x => ({ ...x, [name]: r }));
      const hay = r.propuestaMenu || r.propuestaCompra || r.propuestaLocal || r.aviso;
      this.mensajes.update(x => ({ ...x, [name]: name === 'monitor-comedor' ? (offline ? 'Sin conexión: corrió en este navegador con datos guardados.' : '')
        : !hay ? 'Inventario en orden: no hay nada que reponer ni por vencer.'
        : offline ? 'Sin conexión: el agente corrió en este navegador con datos guardados. La propuesta saldrá a Telegram al volver la conexión.'
        : 'Propuesta creada: revísala abajo o en Telegram.' }));
      await this.refrescar();
    } finally { this.loading.set(null); }
  }

  // Misma lógica que el servidor, sobre el paquete guardado.
  private correrLocal(name: string, q: Paquete): any {
    const crear = (tipo: PropuestaLocal['tipo'], clave: string, titulo: string, resumen: string, payload: any) => {
      const lista = propuestasLocales();
      if (!lista.some(p => p.clave === clave && p.estado === 'PENDIENTE')) {
        lista.unshift({ id: 'local-' + Date.now(), tipo, clave, titulo, resumen, payload, creado: Date.now() / 1000, local: true,
          estado: tipo === 'info' ? 'INFORMATIVA' : 'PENDIENTE' });
        LS.set('propuestas.local', lista);
      }
      return true;
    };
    if (name === 'inventario-compras') {
      const r: any = inventarioOffline(q);
      if (r.requiereAviso && r.ordenesBorrador.length)
        r.propuestaLocal = crear('compra', r.claveAlerta, `Orden de compra (${r.severidad}): ${r.ordenesBorrador.length} insumos, ${r.totalBorradorBs} Bs`, r.mensajeAdmin, r);
      return r;
    }
    if (name === 'planificador-menu') {
      const r: any = menuOffline(q);
      r.propuestaLocal = crear('menu', `menu:${r.semanaInicio}`, `Menú de la semana del ${r.semanaInicio}`, textoMenu(r), r);
      return r;
    }
    const r: any = monitorOffline(q);
    if (r.hallazgos.length) {
      const texto = [`Monitor del comedor — ${r.resumenEjecutivo}`, ...r.hallazgos.slice(0, 12).map((h: any) => `[${h.severidad}] ${h.mensaje} → ${h.recomendacion}`)].join('\n');
      let h = 0; for (const c of r.hallazgos.map((x: any) => x.mensaje).join('|')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      r.aviso = crear('info', 'mon:off' + h.toString(16), 'Informe del monitor', texto, {});
    }
    return r;
  }
}

// =================== LAYOUT ===================
@Component({
  standalone: true, selector: 'app-root', imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  template: `
    <div *ngIf="!loggedIn()" class="min-h-screen">
      <ng-container *ngIf="embedded; else noemb">
        <div class="flex items-center justify-center h-screen text-slate-400">Autenticando sesión…</div>
      </ng-container>
      <ng-template #noemb>
        <ng-container *ngIf="path === '/login'; else redir"></ng-container>
        <router-outlet />
        <ng-template #redir>{{ redirect() }}</ng-template>
      </ng-template>
    </div>
    <div *ngIf="loggedIn()" class="min-h-screen flex bg-slate-900 text-white">
      <aside *ngIf="!embedded" class="w-64 bg-slate-950 border-r border-slate-800 min-h-screen flex flex-col">
        <div class="p-6 border-b border-slate-800">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg flex items-center justify-center">
              <span class="text-white text-xs font-bold tracking-tight">CU</span>
            </div>
            <div>
              <div class="font-semibold text-white tracking-tight">Gestión operativa</div>
              <div class="text-xs text-slate-400">Panel administrativo</div>
            </div>
          </div>
        </div>
        <nav class="flex-1 p-4 space-y-1 overflow-auto">
          <div *ngIf="verMenus || verCaja" class="text-[10px] font-semibold text-slate-500 px-3 py-2 tracking-wider uppercase">Operación</div>
          <a *ngIf="verMenus" routerLink="/menus" routerLinkActive="bg-slate-800 text-white border-l-2 border-orange-500"
            class="block px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition text-sm font-medium">
            Menús e inventario
          </a>
          <a *ngIf="verCaja" routerLink="/caja" routerLinkActive="bg-slate-800 text-white border-l-2 border-orange-500"
            class="block px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition text-sm font-medium">
            Caja — validación de QR
          </a>

          <div *ngIf="verAdminEstudiantes || verAdminOperacion" class="text-[10px] font-semibold text-slate-500 px-3 py-2 mt-2 tracking-wider uppercase">Administración</div>
          <a *ngIf="verAdminEstudiantes" routerLink="/admin/estudiantes" routerLinkActive="bg-slate-800 text-white border-l-2 border-orange-500"
            class="block px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition text-sm font-medium">
            Estudiantes y becas
          </a>
          <a *ngIf="verAdminOperacion" routerLink="/admin/operacion" routerLinkActive="bg-slate-800 text-white border-l-2 border-orange-500"
            class="block px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition text-sm font-medium">
            Publicación de menú y recepciones
          </a>

          <ng-container *ngIf="verAgentes">
            <div class="text-[10px] font-semibold text-slate-500 px-3 py-2 mt-2 tracking-wider uppercase">Inteligencia</div>
            <a routerLink="/agentes" routerLinkActive="bg-slate-800 text-white border-l-2 border-orange-500"
              class="block px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition text-sm font-medium">
              Agentes inteligentes
            </a>
          </ng-container>
        </nav>
        <div class="p-4 border-t border-slate-800">
          <div class="bg-slate-800/60 rounded-lg p-3 mb-2">
            <div class="text-xs text-slate-400 uppercase tracking-wider">Sesión</div>
            <div class="text-sm text-white font-medium mt-1">{{ user }}</div>
            <div class="text-xs text-slate-500 mt-0.5">{{ rolLabel }}</div>
          </div>
          <button (click)="logout()" class="w-full py-2 text-slate-400 hover:text-red-400 text-xs transition">Cerrar sesión</button>
        </div>
      </aside>
      <main class="flex-1">
        <header *ngIf="!embedded" class="sticky top-0 z-10 bg-slate-900/80 backdrop-blur border-b border-slate-800 px-8 py-4">
          <h1 class="text-xl font-semibold text-white tracking-tight">Panel de gestión</h1>
        </header>
        <nav *ngIf="embedded" class="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 px-6 flex gap-1 overflow-x-auto">
          <a *ngIf="verMenus" routerLink="/menus" routerLinkActive="text-white border-orange-500" class="px-4 py-3 text-sm text-slate-400 hover:text-white border-b-2 border-transparent whitespace-nowrap">Menús e inventario</a>
          <a *ngIf="verCaja" routerLink="/caja" routerLinkActive="text-white border-orange-500" class="px-4 py-3 text-sm text-slate-400 hover:text-white border-b-2 border-transparent whitespace-nowrap">Caja</a>
          <a *ngIf="verAdminEstudiantes" routerLink="/admin/estudiantes" routerLinkActive="text-white border-orange-500" class="px-4 py-3 text-sm text-slate-400 hover:text-white border-b-2 border-transparent whitespace-nowrap">Estudiantes y becas</a>
          <a *ngIf="verAdminOperacion" routerLink="/admin/operacion" routerLinkActive="text-white border-orange-500" class="px-4 py-3 text-sm text-slate-400 hover:text-white border-b-2 border-transparent whitespace-nowrap">Publicación y recepciones</a>
          <a *ngIf="verAgentes" routerLink="/agentes" routerLinkActive="text-white border-orange-500" class="px-4 py-3 text-sm text-slate-400 hover:text-white border-b-2 border-transparent whitespace-nowrap">Agentes</a>
        </nav>
        <div [class]="embedded ? 'p-6' : 'p-8'">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
})
class AppComponent {
  path = window.location.pathname;
  embedded = new URLSearchParams(window.location.search).get('embedded') === '1' || window.parent !== window;
  loggedIn() { return !!sessionStorage.getItem('kc_token'); }
  user = sessionStorage.getItem('kc_user') || '';
  rawRoles = (JSON.parse(sessionStorage.getItem('kc_roles') || '[]') as string[])
    .filter(r => !r.startsWith('default-') && !r.startsWith('offline') && !r.startsWith('uma'));
  esAdmin = this.rawRoles.some(r => r === 'administrador' || r.toLowerCase().includes('admin'));
  esCocinero = this.rawRoles.some(r => r.toLowerCase().includes('cocinero') || r === 'cocina_almacen');
  esCaja = this.rawRoles.some(r => r.toLowerCase().includes('caja'));
  rolLabel = this.esAdmin ? 'Administrador' : this.esCocinero ? 'Cocinero' : this.esCaja ? 'Caja' : (this.rawRoles[0] || 'Usuario');
  verMenus = this.esAdmin || this.esCocinero;
  verCaja = this.esAdmin || this.esCaja;
  verAdminEstudiantes = this.esAdmin;
  verAdminOperacion = this.esAdmin || this.esCocinero;
  verAgentes = this.esAdmin;
  redirect() { if (window.location.pathname !== '/login') window.location.href = '/login'; return ''; }
  logout() { sessionStorage.clear(); window.location.href = '/login'; }
}

// SSO cross-microfrontend
// Si estamos embebidos, esperamos el token por postMessage ANTES de bootstrapear Angular.
// Así nunca se muestra el login en los iframes.
function esperarSSOEmbebido(timeoutMs = 5000): Promise<void> {
  const embedded = new URLSearchParams(window.location.search).get('embedded') === '1' || window.parent !== window;
  if (!embedded) return Promise.resolve();
  if (sessionStorage.getItem('kc_token')) return Promise.resolve();

  return new Promise(resolve => {
    const guardar = (token: string) => {
      sessionStorage.setItem('kc_token', token);
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        sessionStorage.setItem('kc_user', payload.preferred_username || '');
        sessionStorage.setItem('kc_roles', JSON.stringify(payload.realm_access?.roles || []));
      } catch {}
    };
    const handler = (ev: MessageEvent) => {
      if (ev.data?.type === 'SSO_TOKEN' && ev.data?.token) {
        guardar(ev.data.token);
        window.removeEventListener('message', handler);
        clearTimeout(to);
        resolve();
      }
    };
    window.addEventListener('message', handler);
    try { window.parent.postMessage({ type: 'MF_READY' }, '*'); } catch {}
    // Reintentar cada 400ms (por si el shell no tenía el token aún)
    const retry = setInterval(() => { try { window.parent.postMessage({ type: 'MF_READY' }, '*'); } catch {} }, 400);
    const to = setTimeout(() => {
      clearInterval(retry);
      window.removeEventListener('message', handler);
      resolve();
    }, timeoutMs);
    // Al recibir token, limpio retry
    const stopRetry = (ev: MessageEvent) => {
      if (ev.data?.type === 'SSO_TOKEN') { clearInterval(retry); window.removeEventListener('message', stopRetry); }
    };
    window.addEventListener('message', stopRetry);
  });
}

// Handler permanente para refresh de token mientras la sesión está viva.
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.data?.type === 'SSO_TOKEN' && ev.data?.token) {
    sessionStorage.setItem('kc_token', ev.data.token);
    try {
      const payload = JSON.parse(atob(ev.data.token.split('.')[1]));
      sessionStorage.setItem('kc_user', payload.preferred_username || '');
      sessionStorage.setItem('kc_roles', JSON.stringify(payload.realm_access?.roles || []));
    } catch {}
  }
});

esperarSSOEmbebido().then(() => {
  bootstrapApplication(AppComponent, {
    providers: [
      provideRouter([
        { path: '', redirectTo: 'menus', pathMatch: 'full' },
        { path: 'login', component: LoginComponent },
        { path: 'menus', component: MenusComponent },
        { path: 'caja', component: CajaComponent },
        { path: 'agentes', component: AgentesComponent },
        { path: 'admin/estudiantes', component: AdminEstudiantesComponent },
        { path: 'admin/operacion', component: AdminOperacionComponent },
      ]),
      provideHttpClient(),
    ],
  });
});
