// Utilidades de texto: sin acentos, minúsculas.
const ACENTOS = { 'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e', 'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
  'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u', 'ñ': 'n' };
const quitarAcentos = (s) => s.replace(/[áàäâéèëêíìïîóòöôúùüûñ]/g, (c) => ACENTOS[c]);
const normSimple = (t) => quitarAcentos(String(t).toLowerCase().trim());
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
module.exports = { quitarAcentos, normSimple, escapar };
