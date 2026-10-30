// La marca «la caché de me gusta es de otra cuenta» (v=345, tanda 98).
//
// La caché de me gusta (`all_liked_tracks`, su parcial y la heredada `spc_all_liked_tracks`) NO lleva el uid en la
// clave. Cuando cambia la cuenta, `revisarCambioDeUsuario()` (`api.js`) escribe esta clave en `localStorage`, con el
// uid anterior como valor, ANTES del primer borrado, y la quita recién cuando los borrados salen. Mientras esté, los
// seis caminos que leen la caché hacen como si no hubiera nada (ver CLAUDE.md, «👤 Los me gusta del usuario anterior»).
//
// SIN imports, a propósito: lo importan `api.js` y `util/copia-completa.js`, que es puro. Una sola definición.

export const LIKES_DE_OTRO_KEY = 'fonoteca_likes_de_otro_v1';

/**
 * ¿La caché de me gusta es de otra cuenta? `ls` es el `localStorage` (por defecto) o un volcado `{ clave: texto }`
 * como el que arma `leerNavegador()` para «Exportar todo». Si leer tira, «no hay marca»: sin `localStorage` tampoco
 * se pudo escribir.
 */
export function hayLikesDeOtro(ls = globalThis.localStorage) {
  try {
    if (!ls) return false;
    const v = typeof ls.getItem === 'function' ? ls.getItem(LIKES_DE_OTRO_KEY) : ls[LIKES_DE_OTRO_KEY];
    return v != null;
  } catch {
    return false;
  }
}
