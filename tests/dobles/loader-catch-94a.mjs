// En esta suite el módulo del mosaico es real; sus dependencias son inventadas.
const RAIZ = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const DOBLE = RAIZ + '/tests/dobles/catch-94a-doble.mjs';
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.includes('/src/js/') && !r.url.endsWith('/features/mosaico-colores.js')) {
    return { ...r, url: DOBLE, shortCircuit: true };
  }
  return r;
}
