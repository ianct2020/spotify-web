// Fecha de un lanzamiento y el orden «más nuevo primero» de las vistas de
// descubrir (v=246).
//
// `releaseTs` vivía en `features/discover-common.js`, que arrastra el DOM y no se
// puede importar en Node: se movió acá para que el criterio tenga test, y
// `discover-common.js` lo re-exporta, así que `#new-releases` sigue importándolo
// de donde siempre.

/**
 * "YYYY", "YYYY-MM", "YYYY-MM-DD" → ms epoch (UTC; mes 6 y día 15 si faltan).
 * Sin año legible da 0, o sea que un lanzamiento sin fecha cae al final del
 * orden «más nuevo primero».
 */
export function releaseTs(release) {
  const s = release || '';
  const y = parseInt(s.slice(0, 4), 10);
  if (!Number.isFinite(y)) return 0;
  const m = parseInt(s.slice(5, 7), 10) || 6;
  const d = parseInt(s.slice(8, 10), 10) || 15;
  return Date.UTC(y, m - 1, d);
}

/**
 * Comparador de lanzamientos (`{ release, name }`): el más nuevo primero. A
 * igual fecha, alfabético por nombre, para que el orden no dependa de en qué
 * orden llegaron a la base.
 *
 * ⚠️ Es un criterio de PINTADO. Las discografías se guardan en la base y en el
 * caché de escaneo en el orden en que llegaron, y hay que dejarlas así:
 * `tieneOrdenNativo()` de `discover-common.js` deduce de ese orden si una
 * discografía guardada salió del endpoint nativo o de `/search`. Se ordena una
 * COPIA, nunca lo guardado.
 */
export function masNuevoPrimero(x, y) {
  const dt = releaseTs(y?.release) - releaseTs(x?.release);
  if (dt !== 0) return dt;
  return (x?.name || '').localeCompare(y?.name || '', 'es');
}
