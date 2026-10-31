// Igual que el de la 92A, con likes, historial y dueño configurables (T104.1). Carga las dos vistas reales y reemplaza sus dependencias por datos inventados.
const DOBLE = new URL('./vista-t104.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.includes('/src/js/') && !r.url.endsWith('/features/zero-plays.js') && !r.url.endsWith('/features/skips.js')) {
    return { url: DOBLE, shortCircuit: true };
  }
  return r;
}
