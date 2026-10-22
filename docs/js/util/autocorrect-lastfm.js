// El autocorrect de Last.fm (v=316, tanda 65): UNA regla para decidir si el nombre que Last.fm
// devolvió con `autocorrect=1` es el MISMO artista que el pedido. La usan los dos que piden con
// autocorrect: `generosDeArtista()` (`util/generos-regla.js`, las etiquetas de `#generos`) y el
// horneado del mapa de artistas (`scripts/hornear-similares.mjs`, los parecidos).
//
// Hasta v=315 los dos descartaban todo autocorrect que cambiara el nombre según `normalizarNombre`,
// y eso dejaba afuera a artistas que Last.fm solo escribe distinto: «Travis Scott» → «Travi$ Scott»
// perdía sus géneros y quedaba aislado en el mapa (tanda 64).
//
// 🔴 Es una regla de ESCRITURA del mismo nombre, como `SINONIMOS` de `generos-regla.js`, y nada más:
// ni tablas de nombres, ni distancia de edición, ni `score`, ni el `mbid`. Un autocorrect que cambia
// el NOMBRE («Los X» → «X», «A & B» → otro dúo, una sigla por otra) sigue descartado, aunque sea el
// mismo artista: es el precio de no aceptar a ciegas. Módulo puro: sin red, sin DOM.
//
// Lo prueba `tests/autocorrect-lastfm.test.mjs`, con nombres inventados.

import { normalizarNombre } from './mb-pais.js?v=325';

/**
 * La clave de escritura de un nombre, en este orden: `normalizarNombre` (el de `mb-pais.js`, no
 * `normText`), cada `$` a `s`, cada `&` a ` and `, fuera todo lo que no sea letra, número o
 * espacio, fuera un `the ` del principio, y los espacios colapsados.
 */
export function claveEscritura(s) {
  return normalizarNombre(s)
    .replace(/\$/g, 's')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/^the /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿El `devuelto` del autocorrect es el mismo artista que el `pedido`? Sin `devuelto`, o igual según
 * `normalizarNombre`, no hubo cambio que juzgar: `true`. Si no, `true` solo si las dos claves de
 * escritura son iguales y no vacías.
 */
export function mismoArtistaAutocorregido(pedido, devuelto) {
  if (devuelto == null || normalizarNombre(devuelto) === normalizarNombre(pedido)) return true;
  const a = claveEscritura(pedido), b = claveEscritura(devuelto);
  return a !== '' && a === b;
}
