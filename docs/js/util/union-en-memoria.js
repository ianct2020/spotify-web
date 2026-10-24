// La unión que hace la OTRA pestaña cuando llega una copia (diseñada en la tanda 81, entra en v=339, tanda 82). SIN
// IMPORTS, a propósito.
//
// Los almacenes de ocultos (`createHiddenStore`) y el de «ya escuchado» (`createLocalStore`), los dos en
// `util/hidden-sync.js`, leen su conjunto UNA vez por carga y lo guardan ENTERO desde la memoria. Hasta v=336, si otra
// pestaña importaba una copia y acá se tocaba un almacén ya cargado, se guardaba el conjunto VIEJO encima de lo
// importado (la 80 solo avisaba). Ahora, al llegar el mensaje de `util/canal-copia.js`, cada almacén ya cargado UNE a su
// memoria lo que lee ahora `localStorage`.
//
// 🔴 Por qué es exacto: el import nunca quita (el invariante de la 79). Lo que hay en `localStorage` después de él es lo
// de antes más lo agregado; la memoria es lo de antes más o menos lo que esta pestaña hizo después, y eso ya está en
// `localStorage` también (cada cambio se guarda antes del siguiente `await`: es la regla de `hidden-sync.js`, que
// `fijarVarios` no cumplía hasta v=339 y que vigila `tests/copia-cada-await.test.mjs`). Unir da memoria ∪ lo que agregó
// el import: no revive nada que esta pestaña haya quitado, salvo que el import lo haya vuelto a traer (el precio aceptado
// de «nunca borra»).
//
// 🔴 Solo AGREGA. Nunca saca nada de la memoria, nunca guarda, nunca sube nada a Spotify: lo que haya que subir lo sube el
// `sync()` de siempre, cuando le toque. Y MUTA el `Set` y el `Map` que le pasan (nunca devuelve otros): un `sync()` en
// vuelo que después guarda su `keys` guarda también lo agregado (ver `hidden-sync.js`).
//
// Lo vigilan `tests/copia-otra-pestana.test.mjs` y `tests/copia-cada-await.test.mjs`.

/**
 * El texto que la app LEERÍA de `base`: la prefijada (`prefKey(base)`) o, si no hay, la pelada. Sin `migratePrefKey`,
 * que escribe. `leer` es `localStorage.getItem`.
 */
export function leerConPrefijo(base, prefijada, leer) {
  const p = leer(prefijada);
  return p != null ? p : leer(base);
}

/** Suma a `set` cada cadena del array JSON `texto` que falte (como lo lee `loadLocal`). Devuelve cuántas agregó. */
export function unirConjuntoEnMemoria(set, texto) {
  let arr;
  try { arr = JSON.parse(texto || '[]'); } catch { return 0; }
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  for (const k of arr) if (typeof k === 'string' && !set.has(k)) { set.add(k); n++; }
  return n;
}

/**
 * Suma a `map` cada par del objeto JSON `texto` cuya clave falte (como lo lee `loadUris`: valores cadena no vacíos). Si
 * una clave está en los dos con otro valor, gana la de memoria. Devuelve cuántas agregó.
 */
export function unirMapaEnMemoria(map, texto) {
  let obj;
  try { obj = JSON.parse(texto || '{}'); } catch { return 0; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v && !map.has(k)) { map.set(k, v); n++; }
  return n;
}
