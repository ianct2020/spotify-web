// El doble de `idb.js` de los ocultos (`idb-ocultos-doble.mjs`), con un punto de espera antes y después de cada llamada
// (ver `puntos.mjs`).

import * as base from './idb-ocultos-doble.mjs';
import { punto } from './puntos.mjs';

const envolver = (nombre, fn) => async (...args) => {
  await punto(nombre, 'antes');
  const r = await fn(...args);
  await punto(nombre, 'despues');
  return r;
};

export const idbGetCached = envolver('idbGetCached', base.idbGetCached);
export const idbSetCached = envolver('idbSetCached', base.idbSetCached);
export const idbDel = envolver('idbDel', base.idbDel);
