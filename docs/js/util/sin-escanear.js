// Lo que las vistas de descubrir dicen de los artistas SIN escanear (v=261).
//
// Hasta v=260 abrir la vista escaneaba sola lo que faltaba, así que «sin
// escanear» era un estado de paso: en unos segundos se llenaba. Desde v=261
// ningún camino automático pide discografías; lo que no está escaneado se queda
// así hasta que Ian lo pide con el selector. Y entonces un texto como «Nada por
// descubrir» o «No hay novedades sin escuchar» deja de ser verdad: puede haber
// cientos de artistas sin mirar, y una lista vacía con cara de respuesta buena
// es peor que decir que faltan.
//
// Solo texto, sin red. Las dos vistas usan esto; no lo copies en ninguna.

const nES = (x) => x.toLocaleString('es-ES');

/** Cuántos de estos artistas no están escaneados. */
export function contarSinEscanear(artistas) {
  let n = 0;
  for (const a of artistas) if (!a.scanned) n++;
  return n;
}

/** El trozo de la cabecera: « · 129 sin escanear», o nada si no falta ninguno. */
export function sufijoSinEscanear(n) {
  return n > 0 ? ` · ${nES(n)} sin escanear` : '';
}

/** La frase que se le pega a un mensaje de lista vacía cuando faltan artistas. */
export function notaSinEscanear(n) {
  if (!(n > 0)) return '';
  return ` Quedan ${nES(n)} ${n === 1 ? 'artista' : 'artistas'} sin escanear y sus lanzamientos no cuentan aquí: elígelos con «Elegir más artistas para escanear…» (abrir esa lista no cuesta nada).`;
}
