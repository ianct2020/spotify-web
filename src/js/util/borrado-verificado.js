// Borrado de me gusta con verificación obligatoria (2026-08-29).
//
// ── Por qué existe este módulo ───────────────────────────────────────────────
//
// El 28/08 se descubrió que #versions daba por bueno todo borrado de más de 40
// pistas sin haber comprobado nada: `checkLibraryContains` iteraba de a 50 con
// el tope real en 40, tiraba en el primer chunk, y la excepción salía por un
// `console.warn` que la extensión de Chrome ni captura. El toast salía verde.
//
// Al arreglarlo apareció lo de fondo: de las CINCO vistas que borran me gusta
// (#versions, #zombies, #zero-plays, #skips, #sin-clasificar), sólo #versions
// verificaba algo. Las otras cuatro llamaban a `removeLikedTracks()` y daban el
// borrado por hecho. Y arreglarlo copiando el bloque de #versions cinco veces
// serían cinco sitios donde se puede volver a romper de a uno.
//
// Así que la secuencia vive acá, una sola vez, y las cinco vistas la llaman.
//
// ── Qué garantiza ────────────────────────────────────────────────────────────
//
//   1. Registro previo: lo escribe `removeLikedTracks()` (api.js) antes del
//      primer DELETE. No se toca desde acá — sólo hay que no saltárselo, y por
//      eso este helper NUNCA pega a `/me/library` por su cuenta.
//   2. El borrado se manda.
//   3. Se verifica contra Spotify que las pistas SALIERON de verdad.
//   4. Si la verificación no se puede hacer, o se hace y no cuadra, esto TIRA.
//      No hay camino silencioso, no hay valor de retorno «a medias», no hay
//      `console.warn`. El llamador tiene un catch que pinta toast rojo, y como
//      esto tira, se salta su camino de éxito entero.
//
// ── Qué NO garantiza, y por qué ──────────────────────────────────────────────
//
// La guarda del último ejemplar NO se aplica en cuatro de las cinco vistas, y no
// es un olvido. Ver el parámetro `guarda` más abajo.

import { guardaUltimoEjemplar } from './versions-guard.js';

// El único número: `/me/library/contains` admite 40 uris por request (medido en
// vivo el 2026-08-28: 40 → 200, 41 → 400, 100 → 414). api.js ya chunkea de a 40
// por dentro; esto es sólo para el texto de los mensajes.
const CONTAINS_MAX = 40;

/**
 * Borra me gusta y NO vuelve hasta haber comprobado que salieron.
 *
 * @param {string[]} ids  ids de pista a borrar.
 * @param {object} opts
 * @param {string} opts.origen  la vista, para el registro de borrados
 *   («#zombies», «#skips»…). Va tal cual al log de v=162.
 * @param {Array|null} opts.meta  metadata de las pistas para el registro, si la
 *   vista ya la tiene a mano. Si es null, `removeLikedTracks` la resuelve desde
 *   el caché de likes.
 * @param {Function} opts.removeLikedTracks  api.js. Inyectada, no importada:
 *   así este módulo se puede testear en node sin navegador ni token, que es la
 *   única forma de ejercitar el camino de fallo sin gastar me gusta de verdad.
 * @param {Function} opts.checkLibraryContains  api.js, ídem.
 * @param {'ultimo-ejemplar'|'ninguna'} opts.guarda  DECLARACIÓN OBLIGATORIA de
 *   si corre la guarda del último ejemplar. No tiene valor por defecto a
 *   propósito: quiero que cada vista que borre me gusta tenga que escribir cuál
 *   de las dos es, para que la ausencia de guarda sea una decisión visible en el
 *   código y no una omisión que nadie note en la revisión.
 *
 *   `'ultimo-ejemplar'` NO es un rótulo: exige `items` y `libraryByKey`, y
 *   corre `guardaUltimoEjemplar()` de verdad AQUÍ, en la última instrucción
 *   antes del DELETE. Que la declaración y la comprobación sean la misma cosa
 *   es el punto: si alguien declara la guarda y se olvida de pasar los datos,
 *   esto tira en vez de borrar sin guarda.
 *
 *   `'ninguna'` es la respuesta CORRECTA en cuatro de las cinco vistas, y exige
 *   `motivoSinGuarda`. La guarda dice «no borres la última copia viva de una
 *   canción», y eso es un invariante de DEDUPLICACIÓN: en #versions borrás una
 *   versión porque hay otra, así que quedarse en cero es siempre un fallo. En
 *   #zombies, #zero-plays, #skips y #sin-clasificar el usuario borra la canción
 *   PORQUE no la quiere: quedarse en cero copias es exactamente lo pedido.
 *   Forzarla ahí abortaría el 100% de las operaciones legítimas.
 * @param {string} [opts.motivoSinGuarda]  obligatorio si guarda === 'ninguna'.
 *   Queda en el registro y en el mensaje de error si algo se investiga después.
 * @param {Array|null} [opts.items]  los `{track}` a borrar. Obligatorio si
 *   guarda === 'ultimo-ejemplar'.
 * @param {Map|null} [opts.libraryByKey]  índice clave-de-canción → Set(ids) de
 *   la biblioteca entera (`indexarBiblioteca`). Obligatorio ídem.
 * @param {Function|null} [opts.onProgress]  (fase, hechas, total) para la barra.
 *
 * @returns {Promise<{pedidos:number, salieron:number}>}
 * @throws  si no se pudo verificar, o si alguna pista sigue en la biblioteca.
 */
export async function borrarLikesVerificado(ids, {
  origen,
  meta = null,
  removeLikedTracks,
  checkLibraryContains,
  guarda,
  motivoSinGuarda = '',
  items = null,
  libraryByKey = null,
  onProgress = null,
} = {}) {
  if (typeof removeLikedTracks !== 'function' || typeof checkLibraryContains !== 'function') {
    throw new Error('borrarLikesVerificado: faltan removeLikedTracks/checkLibraryContains');
  }
  if (guarda !== 'ultimo-ejemplar' && guarda !== 'ninguna') {
    throw new Error(
      `borrarLikesVerificado: hay que declarar «guarda» ('ultimo-ejemplar' o 'ninguna'), llegó ${JSON.stringify(guarda)}`
    );
  }
  if (guarda === 'ninguna' && !String(motivoSinGuarda).trim()) {
    throw new Error('borrarLikesVerificado: guarda «ninguna» exige motivoSinGuarda por escrito');
  }
  if (!origen) throw new Error('borrarLikesVerificado: falta «origen» para el registro del borrado');
  if (guarda === 'ultimo-ejemplar' && (!Array.isArray(items) || !(libraryByKey instanceof Map))) {
    // Declarar la guarda y no pasarle con qué comprobar es peor que no
    // declararla: deja el código con cara de protegido. Tira.
    throw new Error('borrarLikesVerificado: guarda «ultimo-ejemplar» exige items y libraryByKey');
  }

  // Deduplicar acá y no más adelante: si la vista manda el mismo id dos veces
  // (en #skips pasa, porque expande a todas las versiones del tema y dos filas
  // pueden compartir una), el conteo «pedidas vs salidas» daría desfasado y la
  // verificación acusaría un fallo que no existe.
  const pedidos = [...new Set((ids || []).filter(Boolean))];
  if (pedidos.length === 0) return { pedidos: 0, salieron: 0 };

  // Última instrucción antes del DELETE: ninguna pista puede quedar en cero
  // copias vivas. Corre acá, sobre la lista definitiva, y no sobre la que se
  // mostró en la confirmación — entre una y otra puede haber pasado cualquier
  // cosa.
  if (guarda === 'ultimo-ejemplar') {
    const sinGemelo = guardaUltimoEjemplar(items, libraryByKey);
    if (sinGemelo.length) {
      const nombres = sinGemelo.map(v => `«${v.track?.name || '(sin nombre)'}» (${v.motivo})`);
      console.error(`[${origen}] ABORTADO por la guarda del último ejemplar:`,
        sinGemelo.map(v => ({ id: v.track?.id, nombre: v.track?.name, motivo: v.motivo })));
      throw new Error(
        `Borrado abortado: ${sinGemelo.length} pista(s) se quedarían sin ninguna copia viva. `
        + `No se tocó nada. ${nombres.slice(0, 3).join('; ')}${nombres.length > 3 ? '…' : ''}`
      );
    }
  }

  if (onProgress) onProgress('borrando', 0, pedidos.length);
  // El registro previo (v=162) lo escribe removeLikedTracks antes del primer
  // DELETE. Pasa por acá sin tocarlo, a propósito.
  await removeLikedTracks(pedidos, { origen, meta });

  if (onProgress) onProgress('verificando', 0, pedidos.length);
  let contains;
  try {
    contains = await checkLibraryContains(pedidos);
  } catch (verr) {
    // El borrado YA SE MANDÓ. No se puede deshacer y no sabemos qué pasó: lo
    // único honesto es decirlo con el número de pistas en juego.
    throw new Error(
      `El borrado se mandó pero NO se pudo verificar (${verr.message}). `
      + `Comprobá a mano qué quedó: ${pedidos.length} pista(s) en juego, origen ${origen}.`
    );
  }

  const siguenDentro = pedidos.filter(id => contains.get(id) === true);
  if (siguenDentro.length > 0) {
    console.error(`[${origen}] ids que NO salieron:`, siguenDentro);
    throw new Error(
      `Verificación fallida: ${siguenDentro.length} de ${pedidos.length} pista(s) siguen en tu biblioteca. `
      + `El borrado quedó a medias — recargá y comprobá antes de volver a intentar.`
    );
  }

  // `checkLibraryContains` ya tira si le faltan respuestas, pero esto es lo
  // único que separa «verificado» de «creído», así que se afirma de nuevo acá:
  // una respuesta corta NO puede leerse como ausencia de pistas.
  if (contains.size !== pedidos.length) {
    throw new Error(
      `Verificación incompleta: pedí ${pedidos.length} ids y volvieron ${contains.size}. `
      + `El borrado se mandó; comprobá a mano (origen ${origen}).`
    );
  }

  return { pedidos: pedidos.length, salieron: pedidos.length };
}

export const CONTAINS_URIS_MAX = CONTAINS_MAX;
