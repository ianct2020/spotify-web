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

import { prefKey } from '../storage.js?v=268';

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
 * ⚠️ Esto dice QUÉ artistas quiere la vista, no cuántos hay que escanear al
 * abrirla: eso es `colaAutomatica()`, abajo.
 */
export function artistasBuscados(elegibles, loadedMore, elegidos = new Set()) {
  const n = Math.max(0, Math.min(loadedMore, elegibles.length));
  const out = elegibles.slice(0, n);
  for (let i = n; i < elegibles.length; i++) {
    if (elegidos.has(elegibles[i].nameLower)) out.push(elegibles[i]);
  }
  return out;
}

/**
 * La cola de `scanArtists()` cuando no le llega una lista explícita. Desde v=261
 * ya no la pide ninguna apertura de vista ni el chip de umbral (no escanean);
 * la usa «Actualizar», con todo en `scanned: false`. Hasta v=260 era la de las
 * puertas AUTOMÁTICAS (abrir la vista, el chip de umbral): la
 * misma cuenta que v=258, `objetivo - escaneados`, tomada de los buscados que
 * faltan. `escaneados` son TODOS los elegibles ya escaneados, estén donde estén.
 *
 * ⚠️ No la cambies por «todos los buscados sin escanear». Parece más correcta y
 * lo pagó producción el 30/09 (v=259): Ian tenía 350 escaneados con objetivo 350,
 * uno de ellos fuera de los 350 primeros, y un hueco adentro (un artista que
 * había fallado). La cuenta vieja daba 0 y no pedía nada; la de conjunto encoló
 * el hueco al abrir la vista y gastó 2 peticiones del nativo (429 en la segunda)
 * y 4 de `/search`, sin preguntar, porque 5 está por debajo del aviso. Un hueco
 * que falló una vez vuelve a costar en CADA apertura. Lo que se elige a mano va
 * por la cola explícita del selector, no por acá.
 */
export function colaAutomatica(buscados, escaneados) {
  return buscados.filter(a => !a.scanned).slice(0, Math.max(0, buscados.length - escaneados));
}
