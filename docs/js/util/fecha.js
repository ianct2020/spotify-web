// Formateo de fechas que vienen del historial y de la API de Spotify.
//
// Hay DOS formas, y la diferencia NO es de zona horaria: es de qué pregunta
// contesta cada dato.
//
//   · "2026-01-09"            → un DÍA del calendario, ya decidido.
//   · "2026-01-09T04:12:33Z"  → un INSTANTE.
//
// `new Date(iso)` parsea las dos como UTC, y `getDate()` las lee en local: en
// UTC−3 las dos se caen un día para atrás si la hora es de madrugada. El día
// suelto se cae SIEMPRE (medianoche UTC = 21:00 del día anterior). Ese medio
// arreglo es el de v=154.
//
// La mitad que faltaba (2026-09-20): los timestamps del historial —`first_play`,
// `last_play`, `first` de álbum y de artista— NO son instantes que haya que
// enseñar en la hora de nadie. Son **el día que el pipeline registró**, y ese
// pipeline trabaja entero en UTC: `history-processor.js` saca el día con
// `getUTCDate`/`getUTCHours`, y `peak_day`, `days.from`, el mapa de calor y las
// rachas son cadenas YYYY-MM-DD en UTC. Pasar `first_play` a hora local le da
// a esa única fecha un criterio que no usa ninguna otra de la app.
//
// Se vio en la baldosa «Primera play» del Wrapped: la primera play de 2026 es
// `"2026-01-01T00:00:28Z"` —28 segundos después de medianoche— y la baldosa
// del año 2026 decía **31 dic 2025**. Un año entero de diferencia, sin que
// fallara nada.
//
// De ahí las dos funciones, que contestan dos preguntas distintas:
//
//   · `fmtDia`      → **el día que dice el dato**, sin moverlo de zona. Es lo
//                     que quiere todo lo que sale del historial.
//   · `fmtDiaCorto` → el instante en TU hora. Es lo que quiere `added_at` de
//                     los me gusta: el momento en que le diste al corazón.
//
// Guarda: `tests/fecha-dia-del-dato.test.mjs`.
export const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * `Date` en hora LOCAL para cualquiera de las dos formas. null si no parsea.
 * @param {string} iso
 */
export function toLocalDate(iso) {
  if (!iso) return null;
  if (SOLO_FECHA.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

/**
 * «9 ene 2026» — el día que dice el dato, para las dos formas y sin moverlo de
 * zona. Nunca construye un `Date`: leer el string es lo único que no se cae.
 * Cadena vacía si no hay fecha.
 */
export function fmtDia(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d || !MESES[+m - 1]) return String(iso);
  return `${+d} ${MESES[+m - 1]} ${y}`;
}

/**
 * «09 ene 2026» (dos dígitos, es-ES) del INSTANTE, en tu hora local. Solo para
 * `added_at` de los me gusta, que sí es un instante. Para cualquier fecha del
 * historial va `fmtDia`. Cadena vacía si no hay fecha.
 */
export function fmtDiaCorto(iso) {
  const d = toLocalDate(iso);
  return d ? d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}
