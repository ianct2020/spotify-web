// «Fallé al preguntar» NO es un resultado, y no se guarda (v=256).
//
// Este archivo no inventa ninguna regla: la regla ya estaba escrita en el repo,
// cinco veces, en prosa, y se volvió a romper cinco veces igual. Los tres
// ejemplares que la tenían bien:
//
//   - `features/covers.js:245` — «Un índice vacío NO se memoiza: si la caché de
//     likes todavía no estaba, el hover quedaría mudo para toda la sesión
//     (el mismo pozo que tapaba los corazones de W-Three)».
//   - `util/artist-preview.js:33` — el mismo comentario, calcado.
//   - `features/discover-common.js:796` — «Hasta v=227 un fallo (un 429, un
//     corte) se memoizaba como `null` para toda la sesión. Ahora se memoiza
//     solo lo que Spotify contestó».
//
// Y los cinco sitios que la rompían, todos con la misma forma —el `catch`
// escribiendo en la caché del `try`—: `by-genre.js` (tags en `[]`, **30 días**),
// `album-card.js` (`_likesMemo = []`, y `[]` es truthy: toda la sesión),
// `recommendations.js` (`artistUriMemo.set(k, null)`), `wthree.js`
// (`albumTracksCache.set(key, [])`) y `artist-card.js` (foto `null`, **30
// días**, y con la query sin limpiar, así que el fallo ni parecía un fallo).
//
// ⚠️ Por qué un helper y no cinco parches: porque el arreglo de este bug es
// ESTRUCTURAL y no de cuidado. Lo que hace que se repita es que «preguntar»,
// «decidir si la respuesta cuenta» y «tragarse el error» viven en el mismo
// bloque, y ahí el camino corto es siempre escribir desde el `catch`. Acá el
// `try/catch` es de este archivo: el llamador no tiene un `catch` en el que
// escribir. El sexto llamador hereda el arreglo sin leer ningún comentario.
//
// ⚠️ La distinción que hay que hacer a mano, porque no se puede deducir:
//
//   «fallé al preguntar»  → no es un resultado, NUNCA se guarda.
//   «pregunté y no hay»   → SÍ es un resultado, y se puede guardar.
//
// Quién es cuál depende de la fuente, así que `esResultado` es **obligatorio y
// sin valor por defecto** — el mismo idiom que el parámetro `guarda` de
// `util/borrado-verificado.js`, y por el mismo motivo: un llamador nuevo no
// puede compilar mentalmente sin decidir cuál de las dos es su caso. Las dos
// formas de siempre están exportadas acá abajo con nombre, y si una fuente
// necesita otra (mirar un campo `source`, por ejemplo), se escribe en el sitio
// y se explica por qué.

/**
 * Vacío = «no hay contenido», para las colecciones que usa la app.
 * Un objeto cualquiera NO cuenta como vacío: acá no se adivina la forma de
 * nadie, y un `{}` puede ser una respuesta perfectamente buena.
 */
export function estaVacio(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  return false;
}

/**
 * Cualquier cosa que la fuente haya contestado cuenta como resultado, incluido
 * un vacío o un `null`. Es lo correcto cuando la fuente **tira** si no pudo
 * contestar: ahí el vacío solo puede querer decir «pregunté y no hay».
 * (Last.fm tira con `data.error`; Spotify tira por `spotifyFetch`.)
 */
export const CUALQUIER_RESPUESTA = () => true;

/**
 * Un vacío NO cuenta como resultado. Es lo correcto cuando la fuente puede
 * contestar «nada» sin que eso signifique «no hay nada»: la caché de me gusta
 * devuelve `[]` cuando **todavía no se cargó**, y memoizar eso es el pozo de
 * los corazones de W-Three.
 */
export const SOLO_CON_CONTENIDO = (v) => !estaVacio(v);

/**
 * Pregunta, y guarda SOLO si la respuesta es un resultado.
 *
 * @param {object}   o
 * @param {Function} o.pedir       Hace la pregunta. Si no pudo, TIRA — este
 *                                 helper es el único que atrapa.
 * @param {Function} o.esResultado `(valor) => boolean`. Obligatorio, sin
 *                                 defecto. `CUALQUIER_RESPUESTA` o
 *                                 `SOLO_CON_CONTENIDO`, o el criterio propio
 *                                 de la fuente, explicado en el sitio.
 * @param {Function} o.guardar     Escribe en la caché. Corre SOLO si
 *                                 `esResultado` dio true.
 * @param {*}        [o.siFalla]   Qué devolver si la pregunta falló. Por
 *                                 defecto `null`.
 * @param {Function} [o.alFallar]  Se llama con el error. Para avisar y contar;
 *                                 **no** para escribir en la caché.
 * @returns {Promise<*>} la respuesta, o `siFalla` si la pregunta falló.
 */
export async function pedirYCachear({ pedir, esResultado, guardar, siFalla = null, alFallar = null } = {}) {
  if (typeof pedir !== 'function') throw new TypeError('pedirYCachear: falta `pedir`');
  if (typeof guardar !== 'function') throw new TypeError('pedirYCachear: falta `guardar`');
  // Sin defecto a propósito: ver la cabecera.
  if (typeof esResultado !== 'function') {
    throw new TypeError('pedirYCachear: `esResultado` es obligatorio — CUALQUIER_RESPUESTA, SOLO_CON_CONTENIDO o el criterio de la fuente');
  }

  let valor;
  try {
    valor = await pedir();
  } catch (e) {
    // Acá está todo el asunto: la pregunta falló, así que no se escribe NADA.
    if (alFallar) alFallar(e);
    return siFalla;
  }

  // Contestó, pero lo que contestó no cuenta como resultado: tampoco se guarda,
  // y se devuelve igual para que el llamador pinte lo que tenga que pintar.
  if (!esResultado(valor)) return valor;

  guardar(valor);
  return valor;
}
