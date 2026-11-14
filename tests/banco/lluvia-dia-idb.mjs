// ── La lectura del detalle por día, retenible (banco `lluvia-dia`, v=368, tanda 131) ─────────────
//
// La puerta E sale de `#lluvia` mientras el panel espera `loadDays()`, que es SOLO IndexedDB: no hay
// `/me` que retener (el id ya está memoizado). Como en `guard-ruta-vieja-idb.mjs`, el caso
// (`lluvia-dia-caso.html`) desvía `/js/idb.js` a este archivo por import map; el scope `/banco/` deja
// pasar el real, así que esto re-exporta el módulo REAL entero y cambia solo `idbGetCached`: con
// `__retenerDetalle()` armado, la PRÓXIMA lectura de `local_<uid>_history_days` queda esperando hasta
// `__soltarDetalle()`, y después lee de verdad. Todo lo demás pasa sin tocarlo. `src/` no se toca.

import { idbGetCached as leerDeVerdad } from '/js/idb.js';
export * from '/js/idb.js';

let retener = false;
let soltar = null;
window.__detalleRetenido = false;
window.__lecturasDetalle = 0;
window.__retenerDetalle = () => { retener = true; };
window.__soltarDetalle = () => { if (soltar) soltar(); };

export async function idbGetCached(key, ...resto) {
  if (typeof key === 'string' && key.endsWith('_history_days')) {
    window.__lecturasDetalle++;
    if (retener) {
      retener = false;
      window.__detalleRetenido = true;
      await new Promise((r) => { soltar = () => { soltar = null; r(); }; });
    }
  }
  return leerDeVerdad(key, ...resto);
}
