// Loader de `tests/escuchadas-caidas-92b.test.mjs` (tanda 108). Como
// `loader-catch-92b-wthree.mjs`, pero deja REALES `features/wthree.js`,
// `features/history-data.js` y `history-keys.js`. Sirve para `src/` y para una
// copia de `src/` de otro commit (mira el final de la ruta).
const AQUI = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const DOBLE = AQUI + '/tests/dobles/escuchadas-caidas-92b-doble.mjs';
const REALES = ['/js/features/wthree.js', '/js/features/history-data.js', '/js/history-keys.js'];
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.includes('/src/js/') && !REALES.some(x => r.url.endsWith(x))) {
    return { ...r, url: DOBLE, shortCircuit: true };
  }
  return r;
}
