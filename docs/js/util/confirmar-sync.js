// Qué confirmación pide `#sync` antes de escribir (v=275).
//
// Hasta v=274 TODO «Sincronizar» pedía escribir la palabra SYNC, también cuando
// el análisis decía «se van a añadir N y quitar 0». La palabra existe porque
// esta vista BORRA tracks de una playlist; si no se borra nada, pedirla es
// fricción sin motivo (feedback de Ian del 04/10).
//
// La regla es una sola y vive acá, sin DOM, para que tenga test:
//
//   la confirmación por ESCRITURA se pide si y solo si hay tracks a QUITAR.
//
// ⚠️ Por qué es seguro colgarle la decisión al contador: `executeSync` quita
// EXACTAMENTE el array `toRemove` que recibe (`removeTracksFromPlaylist(id,
// toRemove)`, sin ninguna otra lista por el medio), y el modo «Solo añadir» ni
// siquiera lo recibe (le pasa `[]`). O sea que el número que se le enseña a Ian
// y lo que se manda al DELETE son el mismo array: no hay forma de que diga 0 y
// después borre. «Vaciar y llenar» es OTRA ruta, con su propia palabra
// (VACIAR), y no pasa por acá.
//
// Lo que el contador SÍ puede es quedarse corto en otro sentido: cuenta URIs
// distintas, y Spotify quita todas las apariciones de cada una, así que una
// playlist con un track repetido pierde más filas que el número. Con 0 no
// cambia nada (0 URIs → 0 filas), y con ≥1 ya se pide la palabra.

export const PALABRA_SYNC = 'SYNC';

/**
 * @param {{ modo?: 'full'|'add-only', aAnadir: number, aQuitar: number }} p
 * @returns {{ tipo: 'escritura'|'simple', quita: number, palabra?: string }}
 */
export function confirmacionDeSync({ modo = 'full', aAnadir, aQuitar }) {
  // «Solo añadir» no quita nunca, diga lo que diga el contador.
  const quita = modo === 'add-only' ? 0 : Math.max(0, aQuitar | 0);
  if (quita > 0) return { tipo: 'escritura', quita, palabra: PALABRA_SYNC };
  return { tipo: 'simple', quita: 0 };
}
