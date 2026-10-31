// Loader de `tests/fallo-lectura-historial.test.mjs` (tanda 109). El mismo mecanismo que
// `loader-escuchadas-caidas.mjs` (tanda 108): desvía `api.js`, `idb.js` y
// `ui/degraded-banner.js` a un doble. Compara por el FINAL de la ruta, así sirve igual para
// `src/` y para la copia de `src/` de 5f95c6c7 (los rojos de la tanda).
const MAPA = {
  '/js/api.js': '/tests/dobles/fallo-lectura-doble.mjs',
  '/js/idb.js': '/tests/dobles/fallo-lectura-doble.mjs',
  '/js/ui/degraded-banner.js': '/tests/dobles/fallo-lectura-doble.mjs',
};
const DOBLES = new URL('../..', import.meta.url).href.replace(/\/$/, '');

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.endsWith(real)) return { ...r, url: DOBLES + doble, shortCircuit: true };
  }
  return r;
}
