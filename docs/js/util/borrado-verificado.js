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
//   4. Y, cuando corre la guarda del último ejemplar, se verifica contra
//      Spotify que las que SE QUEDAN siguen ahí. Ver `supervivientes`.
//   5. Si alguna verificación no se puede hacer, o se hace y no cuadra, TIRA.
//      No hay camino silencioso, no hay valor de retorno «a medias», no hay
//      `console.warn`. El llamador tiene un catch que pinta toast rojo, y como
//      esto tira, se salta su camino de éxito entero.
//
// ── Qué NO garantiza, y por qué ──────────────────────────────────────────────
//
// La guarda del último ejemplar NO se aplica en cuatro de las cinco vistas, y no
// es un olvido. Ver el parámetro `guarda` más abajo.

import { guardaUltimoEjemplar } from './versions-guard.js?v=203';

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
 * @param {Array|null} [opts.supervivientes]  las que SE QUEDAN: `{id, nombre,
 *   artista, grupo}`. Obligatorio —y no vacío— si guarda === 'ultimo-ejemplar';
 *   prohibido si guarda === 'ninguna'.
 *
 *   Va atado a la guarda a propósito, y no es un parámetro suelto más. La guarda
 *   AFIRMA que después del borrado queda una copia viva, y hasta el 2026-09-03
 *   esa afirmación no se comprobaba nunca: se apoyaba en `libraryByKey`, que es
 *   un índice en memoria armado en el análisis, o sea una FOTO. Entre la foto y
 *   el DELETE la marcada se puede haber ido —por otra vista de Fonoteca de las
 *   que borran con guarda «ninguna», por la app de Spotify, o porque el caché de
 *   likes ya venía viejo— y el grupo se queda en cero con el toast en verde.
 *
 *   Así que quien declara la guarda tiene que decir QUÉ tiene que sobrevivir, y
 *   esto lo comprueba contra Spotify después del borrado. Declarar la guarda y
 *   no pasar supervivientes tira, por lo mismo que tira no pasar `items`.
 * @param {Function|null} [opts.onProgress]  (fase, hechas, total) para la barra.
 *
 * @returns {Promise<{pedidos:number, salieron:number, supervivientes:number}>}
 * @throws  si no se pudo verificar, si alguna pista sigue en la biblioteca, o si
 *   alguna superviviente ya NO está. En este último caso el error lleva
 *   `err.supervivientesPerdidas` con nombre y grupo de cada una, para que el
 *   llamador pueda avisar con detalle y no solo con un número.
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
  supervivientes = null,
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
  if (guarda === 'ultimo-ejemplar' && (!Array.isArray(supervivientes) || supervivientes.length === 0)) {
    // Mismo criterio que arriba: la guarda promete que algo sobrevive, así que
    // hay que decir qué, o la promesa no se puede comprobar.
    throw new Error('borrarLikesVerificado: guarda «ultimo-ejemplar» exige «supervivientes» (las que se quedan)');
  }
  if (guarda === 'ninguna' && Array.isArray(supervivientes) && supervivientes.length) {
    // Ahí se borra PORQUE no se quiere la canción: no hay superviviente que
    // verificar, y aceptarlo en silencio sería fingir una garantía.
    throw new Error('borrarLikesVerificado: guarda «ninguna» no admite «supervivientes»');
  }
  const seQuedan = (supervivientes || []).filter(s => s && s.id);
  if (guarda === 'ultimo-ejemplar' && seQuedan.length !== supervivientes.length) {
    throw new Error('borrarLikesVerificado: hay supervivientes sin id, no se pueden verificar');
  }

  // Deduplicar acá y no más adelante: si la vista manda el mismo id dos veces
  // (en #skips pasa, porque expande a todas las versiones del tema y dos filas
  // pueden compartir una), el conteo «pedidas vs salidas» daría desfasado y la
  // verificación acusaría un fallo que no existe.
  const pedidos = [...new Set((ids || []).filter(Boolean))];
  if (pedidos.length === 0) return { pedidos: 0, salieron: 0 };

  // Una superviviente en la lista de borrado es una contradicción en los
  // términos, y es exactamente el susto del 26/08. `#versions` ya lo comprueba
  // por su cuenta, pero acá se afirma sobre las dos listas definitivas y para
  // las cinco vistas: si se cruzan, no se llama a nadie.
  const pedidosSet = new Set(pedidos);
  const cruzadas = seQuedan.filter(s => pedidosSet.has(s.id));
  if (cruzadas.length) {
    console.error(`[${origen}] ABORTADO: supervivientes dentro de la lista de borrado:`, cruzadas);
    throw new Error(
      `Borrado abortado: ${cruzadas.length} pista(s) marcadas para quedarse estaban en la lista de borrado `
      + `(${cruzadas.slice(0, 3).map(s => `«${s.nombre || s.id}»`).join('; ')}). No se tocó nada.`
    );
  }

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
      + `Comprueba a mano qué quedó: ${pedidos.length} pista(s) en juego, origen ${origen}.`
    );
  }

  const siguenDentro = pedidos.filter(id => contains.get(id) === true);
  if (siguenDentro.length > 0) {
    console.error(`[${origen}] ids que NO salieron:`, siguenDentro);
    throw new Error(
      `Verificación fallida: ${siguenDentro.length} de ${pedidos.length} pista(s) siguen en tu biblioteca. `
      + `El borrado quedó a medias — recarga y comprueba antes de volver a intentar.`
    );
  }

  // `checkLibraryContains` ya tira si le faltan respuestas, pero esto es lo
  // único que separa «verificado» de «creído», así que se afirma de nuevo acá:
  // una respuesta corta NO puede leerse como ausencia de pistas.
  if (contains.size !== pedidos.length) {
    throw new Error(
      `Verificación incompleta: pedí ${pedidos.length} ids y volvieron ${contains.size}. `
      + `El borrado se mandó; comprueba a mano (origen ${origen}).`
    );
  }

  // ── Lo que se quedó, ¿se quedó? (2026-09-03) ───────────────────────────────
  //
  // Hasta acá está probado que las marcadas para borrar SALIERON. Eso no dice
  // nada de la que se queda, y el toast verde se leía como si lo dijera. Esta
  // es la única comprobación de todo el flujo que mira la biblioteca real en
  // busca de algo que TIENE que estar; las demás buscan ausencias.
  //
  // Va DESPUÉS del borrado y contra Spotify, no contra el caché: el caché lo
  // acaba de tocar `removeLikedTracks` y, además, un caché viejo es una de las
  // formas de llegar hasta acá con una superviviente que ya no existía.
  if (seQuedan.length) {
    if (onProgress) onProgress('verificando-supervivientes', 0, seQuedan.length);
    const idsQueQuedan = [...new Set(seQuedan.map(s => s.id))];
    let vivas;
    try {
      vivas = await checkLibraryContains(idsQueQuedan);
    } catch (verr) {
      // No se puede dar por buena la operación: puede que la superviviente esté
      // y puede que no, y justamente eso es lo que había que saber.
      throw new Error(
        `Las ${pedidos.length} pista(s) sobrantes salieron bien, pero NO se pudo comprobar que `
        + `la(s) que se queda(n) siga(n) en tus me gusta (${verr.message}). Compruébalo a mano (origen ${origen}).`
      );
    }
    if (vivas.size !== idsQueQuedan.length) {
      throw new Error(
        `Comprobación incompleta de las que se quedan: pregunté por ${idsQueQuedan.length} y volvieron ${vivas.size}. `
        + `El borrado ya se mandó; compruébalo a mano (origen ${origen}).`
      );
    }
    const perdidas = seQuedan.filter(s => vivas.get(s.id) !== true);
    if (perdidas.length) {
      console.error(`[${origen}] SUPERVIVIENTES PERDIDAS:`, perdidas);
      const detalle = perdidas
        .map(s => `«${s.nombre || '(sin nombre)'}»${s.artista ? ` — ${s.artista}` : ''}${s.grupo ? ` (grupo: ${s.grupo})` : ''}`);
      const err = new Error(
        `Se borraron ${pedidos.length} pista(s), pero ${perdidas.length} de las que ibas a conservar YA NO ESTÁN `
        + `en tus me gusta: ${detalle.join(' · ')}. `
        + `No las quitó este borrado (nunca se mandaron a borrar): ya faltaban antes. Vuelve a añadirlas a mano.`
      );
      // Estructurado además del texto: el llamador avisa con nombre y grupo, y
      // no tiene que volver a parsear la frase para hacerlo.
      err.supervivientesPerdidas = perdidas;
      err.origen = origen;
      throw err;
    }
  }

  return { pedidos: pedidos.length, salieron: pedidos.length, supervivientes: seQuedan.length };
}

export const CONTAINS_URIS_MAX = CONTAINS_MAX;
