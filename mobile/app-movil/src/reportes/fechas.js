// Fechas como Date en UTC a medianoche: sin sorpresas de zona horaria al sumar días o comparar.
const MESES_N = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_N = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const fecha = (y, m, d) => new Date(Date.UTC(y, m - 1, d));          // m: 1..12
const hoyLocal = () => { const n = new Date(); return fecha(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
const iso = (d) => d.toISOString().slice(0, 10);
const desdeIso = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return fecha(y, m, d); };
const sumarDias = (d, n) => new Date(d.getTime() + n * 86400000);
const diasEnMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const diaSemana = (d) => (d.getUTCDay() + 6) % 7;                    // lunes = 0
const lunesDe = (d) => sumarDias(d, -diaSemana(d));
const finMes = (y, m) => fecha(y, m, diasEnMes(y, m));
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const dmyIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(String(s)); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ' ' + m[4] : ''}` : String(s); };

module.exports = { MESES_N, DIAS_N, fecha, hoyLocal, iso, desdeIso, sumarDias, diasEnMes, diaSemana, lunesDe, finMes, dmy, dmyIso };
