// Loader para `tests/import-guarda-owner.test.mjs` (v=298).
//
// `features/history-data.js` importa `../api.js` (red), `../idb.js` (IndexedDB)
// y `../ui/degraded-banner.js` (DOM). Ninguno existe en Node y ninguno es lo que
// se prueba: lo que se prueba es la guarda del import y cuántas claves escribe.
// Mismo mecanismo que `loader.mjs`.

const MAPA = {
  '/src/js/api.js': '/tests/dobles/api-doble.mjs',
  '/src/js/idb.js': '/tests/dobles/idb-escrituras-doble.mjs',
  '/src/js/ui/degraded-banner.js': '/tests/dobles/banner-doble.mjs',
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.endsWith(real)) {
      return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
    }
  }
  return r;
}
