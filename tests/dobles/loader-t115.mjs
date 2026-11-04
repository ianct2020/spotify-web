// Tanda 115: `ui/preview-player.js` REAL en Node. Sus vecinos (`components.js`, `toast.js`, `bottom-layer.js`
// y, desde v=357, `reveal.js`) arrastran el resto de la app, el DOM y el CSS reales; acá se cambian por un
// solo doble (`preview-t115-doble.mjs`) que exporta lo que el reproductor les pide. `icons.js` es puro y va
// el real. Vale para el árbol de trabajo y para la copia de 0be19f5d (`RAIZ_T115`): se compara el final de la URL.
const DOBLE = '/tests/dobles/preview-t115-doble.mjs';
const REALES = ['/src/js/ui/components.js', '/src/js/ui/toast.js', '/src/js/ui/bottom-layer.js', '/src/js/ui/reveal.js'];
const URL_DOBLE = new URL('./preview-t115-doble.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (REALES.some((real) => r.url.endsWith(real))) return { ...r, url: URL_DOBLE, shortCircuit: true };
  return r;
}
void DOBLE;
