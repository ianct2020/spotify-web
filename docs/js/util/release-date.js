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

// Los dos desempates, con el LECTOR de cada forma (paso 6 del plan de
// normalizadores, v=272). Hasta v=271 este comparador y las líneas 688-692 de
// `features/new-releases.js` restaban el mismo `releaseTs` y se diferenciaban en
// el desempate. La diferencia es deliberada y no se puede borrar: una ordena
// DENTRO de un artista (y ahí el artista es constante, así que desempatar por él
// no ordenaría nada) y la otra ENTRE artistas.
//
// ⚠️ Y no difieren SOLO en el desempate, que es lo que parecía: difieren también
// en la FORMA del item, así que el parámetro tiene que traer su lector.
// `#discover-artists` ordena lanzamientos pelados (`{ release, name }`);
// `#new-releases` ordena pares `{ al, artist }`, con el lanzamiento envuelto.
const LECTORES = {
  // `#discover-artists`: el item ES el lanzamiento y desempata su nombre.
  album: { release: it => it?.release, nombre: it => it?.name },
  // `#new-releases`: el item envuelve el lanzamiento y desempata el ARTISTA.
  artista: { release: it => it?.al?.release, nombre: it => it?.artist?.name },
};

/**
 * Comparador de lanzamientos: el más nuevo primero. A igual fecha, alfabético
 * por nombre, para que el orden no dependa de en qué orden llegaron a la base.
 *
 * `desempate: 'album'` (el de por defecto) ordena lanzamientos `{ release, name }`
 * y desempata por el nombre del álbum — es `#discover-artists`, que ordena
 * DENTRO de un artista. `desempate: 'artista'` ordena pares `{ al, artist }` y
 * desempata por el nombre del artista — es `#new-releases`, que ordena ENTRE
 * artistas.
 *
 * ⚠️ El valor por defecto es `'album'` a propósito: así `.sort(masNuevoPrimero)`
 * —como lo llama `#discover-artists` y como lo llama el banco— sigue siendo
 * exactamente el comparador de v=271, sin envolverlo en una flecha.
 *
 * ⚠️ Es un criterio de PINTADO. Las discografías se guardan en la base y en el
 * caché de escaneo en el orden en que llegaron, y hay que dejarlas así:
 * `tieneOrdenNativo()` de `discover-common.js` deduce de ese orden si una
 * discografía guardada salió del endpoint nativo o de `/search`. Se ordena una
 * COPIA, nunca lo guardado.
 */
export function masNuevoPrimero(x, y, { desempate = 'album' } = {}) {
  const leer = LECTORES[desempate];
  // Un desempate mal escrito leería `undefined` de los dos lados y devolvería 0
  // siempre: o sea una lista en el orden de llegada, sin fallar y sin avisar.
  if (!leer) throw new Error(`masNuevoPrimero: desempate desconocido «${desempate}»`);
  const dt = releaseTs(leer.release(y)) - releaseTs(leer.release(x));
  if (dt !== 0) return dt;
  return (leer.nombre(x) || '').localeCompare(leer.nombre(y) || '', 'es');
}
