// Doble de las dependencias de W-Three para `tests/escuchadas-caidas-92b.test.mjs`
// (tanda 108). Parte de `catch-92b-wthree-doble.mjs` (todo lo de la vista, datos
// INVENTADOS, cero red) y le suma lo que `history-data.js` REAL importa de
// `api.js`, `idb.js` y `ui/degraded-banner.js`. `loadListenedAlbums`,
// `loadHistoryStats` e `isOwner` NO se doblan acá: W-Three los toma del
// `history-data.js` real (el loader no lo desvía).
export * from './catch-92b-wthree-doble.mjs';

const s = () => globalThis.__T108_92B;
export async function getCurrentUserId() { return s().me; }
export async function idbGetCached() { return null; }
export async function idbGetCachedRaw() { return null; }
export async function idbSetCached() {}
export async function idbDel() {}
export function mostrarBannerDegradadoVista() {}
