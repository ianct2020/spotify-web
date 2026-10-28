// Carga las dos vistas reales y reemplaza sus dependencias por datos inventados.
const DOBLE = new URL('./vista-catch-t92a.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.includes('/src/js/') && !r.url.endsWith('/features/zero-plays.js') && !r.url.endsWith('/features/skips.js')) {
    return { url: DOBLE, shortCircuit: true };
  }
  return r;
}
