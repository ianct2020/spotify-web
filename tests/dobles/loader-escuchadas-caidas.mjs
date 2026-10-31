// Loader de `tests/escuchadas-caidas-94a.test.mjs` (tanda 108). Mismo mecanismo
// que `loader-guarda.mjs`: desvía `api.js`, `idb.js` y `ui/degraded-banner.js` a
// un doble. Compara por el FINAL de la ruta, así sirve igual para `src/` y para
// una copia de `src/` de otro commit (los rojos de la tanda se corren contra una
// copia de 87a6d2b).
const MAPA = {
  '/js/api.js': '/tests/dobles/escuchadas-caidas-doble.mjs',
  '/js/idb.js': '/tests/dobles/escuchadas-caidas-doble.mjs',
  '/js/ui/degraded-banner.js': '/tests/dobles/escuchadas-caidas-doble.mjs',
};
const DOBLES = new URL('../..', import.meta.url).href.replace(/\/$/, '');

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.endsWith(real)) return { ...r, url: DOBLES + doble, shortCircuit: true };
  }
  return r;
}
