// Exportación del resultado de un reporte a PDF (vía HTML) y Excel, en el navegador.
// El reporte ya viene calculado por la IA local (motor.js): aquí solo se le da formato de archivo.
const { fmtValor } = require('./motor');
const { dmyIso } = require('./fechas');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
