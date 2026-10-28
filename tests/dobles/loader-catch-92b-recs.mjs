// Sustituye solo las dependencias de Recomendaciones; el módulo bajo prueba es real.
const AQUI = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const DOBLE = AQUI + '/tests/dobles/catch-92b-recs-doble.mjs';
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.includes('/src/js/') && !r.url.endsWith('/features/recommendations.js')) {
    return { ...r, url: DOBLE, shortCircuit: true };
  }
  return r;
}
