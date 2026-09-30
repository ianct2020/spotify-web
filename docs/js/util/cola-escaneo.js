// Qué artistas QUIERE tener escaneados cada vista de descubrir (v=259).
//
// Hasta v=258 la respuesta era un número: «los primeros `loadedMore` de la
// lista ordenada por likes». «Cargar más artistas +50» subía ese número y no
// había forma de pedir tres artistas sueltos: se pagaban los 50 o ninguno.
//
// Ahora el selector deja elegir artistas de cualquier punto de la lista, así que
// la respuesta pasa a ser un CONJUNTO: los primeros `loadedMore` más los que Ian
// eligió a mano. Los elegidos se guardan porque el caché del escaneo dura 7 días
// y la base de discografías no caduca: sin esta lista, un artista elegido hoy
// desaparecería de la vista cuando venciera el caché, aunque su discografía siga
// guardada y volver a leerla cueste 0 o 1 petición.
//
// Todo local. Las dos vistas (#new-releases y #discover-artists) usan esto; no
// lo copies en ninguna de las dos.

import { prefKey } from '../storage.js?v=259';

/** Los `nameLower` que se eligieron a mano en el selector. */
export function leerElegidos(lsKey) {
  try {
    const v = JSON.parse(localStorage.getItem(prefKey(lsKey)) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
}

/** Suma estos artistas a los elegidos. No quita ninguno. */
export function sumarElegidos(lsKey, artistas) {
  const s = leerElegidos(lsKey);
  for (const a of artistas) if (a?.nameLower) s.add(a.nameLower);
  try { localStorage.setItem(prefKey(lsKey), JSON.stringify([...s])); } catch { /* sin localStorage */ }
  return s;
}

/**
 * Los artistas que la vista quiere tener escaneados, en el orden de `elegibles`
 * (que viene ordenado por likes): los primeros `loadedMore` y, detrás, los
 * elegidos a mano que estén más abajo. Un elegido que ya cae dentro de los
 * primeros no se repite.
 *
 * Es un conjunto y no un número a propósito: con la cuenta vieja
 * (`target - escaneados`) un artista elegido al fondo de la lista le quitaba el
 * sitio a uno de los primeros, que se quedaba sin escanear.
 */
export function artistasBuscados(elegibles, loadedMore, elegidos = new Set()) {
  const n = Math.max(0, Math.min(loadedMore, elegibles.length));
  const out = elegibles.slice(0, n);
  for (let i = n; i < elegibles.length; i++) {
    if (elegidos.has(elegibles[i].nameLower)) out.push(elegibles[i]);
  }
  return out;
}
