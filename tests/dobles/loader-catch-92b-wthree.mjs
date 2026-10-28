// Sustituye las dependencias de W-Three; el módulo bajo prueba es real.
const AQUI = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const DOBLE = AQUI + '/tests/dobles/catch-92b-wthree-doble.mjs';
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.includes('/src/js/') && !r.url.endsWith('/features/wthree.js')) {
    return { ...r, url: DOBLE, shortCircuit: true };
  }
  return r;
}
