// Exportación del resultado de un reporte a PDF (vía HTML) y Excel, en el navegador.
// El reporte ya viene calculado por la IA local (motor.js): aquí solo se le da formato de archivo.
const { fmtValor } = require('./motor');
const { dmyIso } = require('./fechas');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PALETA = ['#f97316', '#06b6d4', '#8b5cf6', '#10b981', '#ef4444', '#eab308'];

function nombreArchivo(titulo, ext) {
  const base = String(titulo).toLowerCase().normalize ? String(titulo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : String(titulo).toLowerCase();
  const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'reporte';
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${slug}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

const texto = (v, c) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return fmtValor(v, c.fmt);
  return dmyIso(v);
};

// ----------------------------- gráfico (SVG) -----------------------------

function svgGrafico(res) {
  const g = res.grafico;
  if (!g || !res.filas.length || res.filas.length > 40) return '';
  const W = 720, H = 230, L = 46, B = 52, T = 14, R = 12;
  const etq = res.filas.map((f) => String(f[g.x] ?? ''));
  const series = g.y.map((k) => res.filas.map((f) => Number(f[k]) || 0));
  const leyenda = g.y.map((k, i) => `<tspan fill="${PALETA[i % 2]}">■ ${esc(g.etiquetas[k] || k)}  </tspan>`).join('');
  if (g.tipo === 'torta') {
    const total = series[0].reduce((a, b) => a + b, 0) || 1;
    let ang = -Math.PI / 2;
    const cx = 130, cy = 115, r = 90;
    const trozos = series[0].map((v, i) => {
      const a2 = ang + (v / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang), x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const d = v / total >= 0.9999 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETA[(i + 2) % 6]}"/>`
        : `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${v / total > 0.5 ? 1 : 0} 1 ${x2},${y2} Z" fill="${PALETA[(i + 2) % 6]}"/>`;
      ang = a2;
      return d;
    }).join('');
    const leg = etq.map((e, i) => `<text x="260" y="${40 + i * 22}" font-size="12" fill="#334155"><tspan fill="${PALETA[(i + 2) % 6]}">■</tspan> ${esc(e)} (${series[0][i]})</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%">${trozos}${leg}</svg>`;
  }
  const max = Math.max(...series.flat(), 1);
  const iw = W - L - R, ih = H - T - B;
  const y = (v) => T + ih - (v / max) * ih;
  const ejes = [0, 0.25, 0.5, 0.75, 1].map((p) => `<line x1="${L}" x2="${W - R}" y1="${y(max * p)}" y2="${y(max * p)}" stroke="#e2e8f0"/><text x="${L - 6}" y="${y(max * p) + 3}" font-size="9" text-anchor="end" fill="#64748b">${Number((max * p).toFixed(1))}</text>`).join('');
  const paso = iw / etq.length;
  const marcas = etq.map((e, i) => {
    const x = L + paso * i + paso / 2;
    return `<text transform="translate(${x},${H - B + 12}) rotate(${etq.length > 6 ? -30 : 0})" font-size="9" text-anchor="${etq.length > 6 ? 'end' : 'middle'}" fill="#475569">${esc(e.slice(0, 14))}</text>`;
  }).join('');
  let cuerpo;
  if (g.tipo === 'lineas') {
    cuerpo = series.map((s, k) => {
      const pts = s.map((v, i) => `${L + paso * i + paso / 2},${y(v)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${PALETA[k % 2]}" stroke-width="2.5"/>` + s.map((v, i) => `<circle cx="${L + paso * i + paso / 2}" cy="${y(v)}" r="3" fill="${PALETA[k % 2]}"/>`).join('');
    }).join('');
  } else {
    const ancho = Math.min(36, (paso * 0.7) / series.length);
    cuerpo = series.map((s, k) => s.map((v, i) => `<rect x="${L + paso * i + paso / 2 - (ancho * series.length) / 2 + ancho * k}" y="${y(v)}" width="${ancho}" height="${T + ih - y(v)}" rx="2" fill="${PALETA[k % 2]}"/>`).join('')).join('');
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${ejes}${cuerpo}${marcas}<text x="${L}" y="${H - 4}" font-size="10">${leyenda}</text></svg>`;
}

// ----------------------------- PDF (HTML) -----------------------------

function aHtml(res) {
  const apaisado = res.columnas.length > 5;
  const cab = res.columnas.map((c) => `<th class="${c.tipo === 'numero' ? 'n' : ''}">${esc(c.label)}</th>`).join('');
  const filas = res.filas.map((f) => `<tr>${res.columnas.map((c) => `<td class="${c.tipo === 'numero' ? 'n' : ''}">${esc(texto(f[c.key], c))}</td>`).join('')}</tr>`).join('');
  const total = res.totales && res.filas.length
    ? `<tr class="t">${res.columnas.map((c, j) => `<td class="${c.tipo === 'numero' ? 'n' : ''}">${j === 0 ? 'TOTAL' : c.key in res.totales ? esc(texto(res.totales[c.key], c)) : ''}</td>`).join('')}</tr>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page { size: A4 ${apaisado ? 'landscape' : 'portrait'}; margin: 14mm; }
body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; font-size: 11px; }
h1 { font-size: 20px; margin: 0 0 2px; color: #1e293b; } .sub { color: #64748b; font-size: 10px; margin: 2px 0; }
.res { margin: 10px 0; font-size: 11px; } .res li { margin: 2px 0; }
table { border-collapse: collapse; width: 100%; margin-top: 10px; } th { background: #1e293b; color: #fff; padding: 6px 7px; text-align: left; font-size: 10px; }
td { padding: 5px 7px; border-bottom: 1px solid #e2e8f0; } tr:nth-child(even) td { background: #f8fafc; } .n { text-align: right; font-variant-numeric: tabular-nums; }
tr.t td { font-weight: bold; background: #fff7ed; border-top: 2px solid #1e293b; } .pie { margin-top: 14px; color: #94a3b8; font-size: 9px; text-align: center; }
</style></head><body>
<h1>${esc(res.titulo)}</h1>
<div class="sub">Comedor Universitario UAGRM · generado el ${esc(res.generado)}</div>
${res.condiciones.length ? `<div class="sub">Condiciones: ${esc(res.condiciones.join('; '))}</div>` : ''}
<ul class="res">${res.resumen.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
${svgGrafico(res)}
${res.filas.length ? `<table><thead><tr>${cab}</tr></thead><tbody>${filas}${total}</tbody></table>` : '<p>No hay datos que cumplan estas condiciones.</p>'}
<div class="pie">Comedor Universitario UAGRM · ${esc(res.titulo)}</div>
</body></html>`;
}

// ----------------------------- Excel -----------------------------

const FORMATO_XLSX = { moneda: '"Bs "#,##0.00', porcentaje: '0.0"%"', entero: '#,##0', decimal: '#,##0.00' };
const letra = (n) => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Devuelve el libro .xlsx en base64. `XLSX` es la librería SheetJS (se inyecta para poder probarlo fuera del teléfono). */
function aXlsxBase64(res, XLSX) {
  const cols = res.columnas;
  const aoa = [[res.titulo], [res.condiciones.length ? 'Condiciones: ' + res.condiciones.join('; ') : 'Sin filtros: todos los registros'], [`Generado el ${res.generado} · ${res.mostradas} filas`], [], cols.map((c) => c.label)];
  const CAB = aoa.length;
  for (const f of res.filas) aoa.push(cols.map((c) => { const v = f[c.key]; return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(v) ? new Date(v.replace(' ', 'T') + (v.length === 10 ? 'T00:00:00' : ':00')) : v; }));
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  res.filas.forEach((f, i) => cols.forEach((c, j) => {
    const cel = ws[letra(j) + (CAB + 1 + i)];
    if (!cel) return;
    if (cel.t === 'd') cel.z = String(f[c.key]).length > 10 ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
    else if (cel.t === 'n') cel.z = FORMATO_XLSX[c.fmt] || '#,##0.##';
  }));
  let ultima = CAB + res.filas.length;
  if (res.totales && res.filas.length) {
    ultima += 1;
    ws['A' + ultima] = { t: 's', v: 'TOTAL' };
    cols.forEach((c, j) => { if (c.key in res.totales) ws[letra(j) + ultima] = { t: 'n', f: `SUM(${letra(j)}${CAB + 1}:${letra(j)}${ultima - 1})`, v: res.totales[c.key], z: FORMATO_XLSX[c.fmt] || '#,##0.##' }; });
  }
  ws['!ref'] = `A1:${letra(cols.length - 1)}${Math.max(ultima, CAB)}`;
  ws['!cols'] = cols.map((c, j) => ({ wch: Math.min(48, Math.max(c.label.length + 4, ...res.filas.slice(0, 200).map((f) => String(texto(f[c.key], c)).length + 2))) }));
  if (res.filas.length) ws['!autofilter'] = { ref: `A${CAB}:${letra(cols.length - 1)}${CAB + res.filas.length}` };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  const info = XLSX.utils.aoa_to_sheet([['Reporte', res.titulo], ['Datos', res.datasetEtiqueta], ['Generado', res.generado], ['Registros analizados', res.registrosAnalizados],
    ...(res.condiciones.length ? res.condiciones : ['Sin condiciones']).map((c) => ['Condición', c])]);
  info['!cols'] = [{ wch: 24 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, info, 'Consulta');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

module.exports = { aHtml, aXlsxBase64, nombreArchivo, fmtValor, dmyIso };
