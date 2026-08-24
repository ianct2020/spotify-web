// Formateo de fechas que vienen del historial y de la API de Spotify.
//
// Hay DOS formas y no se leen igual (la regla completa está en CLAUDE.md,
// «Zona horaria: la fecha suelta se parsea en UTC»):
//
//   · "2026-01-09"            → un DÍA del calendario. `new Date(iso)` lo parsea
//                               como medianoche UTC y `getDate()` lo lee en
//                               local: en UTC−3 cae al 8. Un día para atrás,
//                               siempre. Se construye a mano en hora local.
//   · "2026-01-09T04:12:33Z"  → un INSTANTE. Ahí convertir a local ES lo
//                               correcto y no hay nada que arreglar (es el caso
//                               de `added_at` de los likes y de first/last_play).
//
// Este módulo distingue las dos con el mismo criterio que `wrapped.js` para que
// no haya que repetir el regex en cada feature.
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

/** «9 ene 2026». Cadena vacía si no hay fecha. */
export function fmtDia(iso) {
  if (SOLO_FECHA.test(iso || '')) {
    const [y, m, d] = iso.split('-');
    return `${+d} ${MESES[+m - 1]} ${y}`;
  }
  const d = toLocalDate(iso);
  return d ? `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** «09 ene 2026» (dos dígitos, es-ES). Cadena vacía si no hay fecha. */
export function fmtDiaCorto(iso) {
  const d = toLocalDate(iso);
  return d ? d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}
