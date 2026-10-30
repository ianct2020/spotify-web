// ── La lectura de los me gusta, retenible (banco `guard-ruta-vieja`, v=345, tanda 100) ─────────
//
// El caso D sale de `#byartist` mientras su `render()` espera `getBestAvailableLikes()`, que es SOLO
// IndexedDB: no hay `/me` que retener. Hasta la tanda 99 el banco apostaba a que la lectura de 60.000
// me gusta TARDARA: cambiaba el hash, esperaba ver el spinner y recién ahí salía. La lectura dura pocas
// vueltas de `esperarReal`, y a veces menos de una: el `render` terminaba antes de que la madre viera el
// spinner, esa espera no se cumplía nunca y el banco salía «ausente» al acabarse el reloj (medido en la
// tanda 100: 3 de 60 corridas con una sonda, las tres en esa espera y con el espía diciendo que el render
// ya había terminado; 1 de 20 y 1 de 10 sin sonda).
//
// Ahora se RETIENE, como la `/me` de A y B. El caso (`guard-ruta-vieja-caso.html`) desvía `/js/idb.js`
// a este archivo por import map; el scope `/banco/` deja pasar el real, así que esto re-exporta el
// módulo REAL entero y cambia solo `idbGetCachedRaw`: con `__retenerProximaLecturaLikes()` armado, la
// PRÓXIMA lectura de `all_liked_tracks` hecha mientras el `render` de `#byartist` está abierto (lo dice
// el espía) queda esperando hasta `__soltarLecturaLikes()`, y después lee de verdad. Todo lo demás pasa
// sin tocarlo. `src/` no se toca.

import { idbGetCachedRaw as leerDeVerdad } from '/js/idb.js';
export * from '/js/idb.js';

const CLAVE_LIKES = 'all_liked_tracks';
let retener = false;
let soltar = null;
window.__lecturaLikesRetenida = false;
window.__retenerProximaLecturaLikes = () => { retener = true; };
window.__soltarLecturaLikes = () => { if (soltar) soltar(); };

const renderByArtistAbierto = () => (window.__renders || []).some((r) => r.ruta === 'by-artist' && !r.fin);

export async function idbGetCachedRaw(key) {
  if (retener && key === CLAVE_LIKES && renderByArtistAbierto()) {
    retener = false;
    window.__lecturaLikesRetenida = true;
    await new Promise((r) => { soltar = () => { soltar = null; r(); }; });
  }
  return leerDeVerdad(key);
}
