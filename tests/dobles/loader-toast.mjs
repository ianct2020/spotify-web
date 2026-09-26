// `ui/toast.js` importa `./bottom-layer.js`, que reparte la capa de abajo de la
// pantalla y necesita el DOM y el CSS reales. Lo que se prueba acá es el techo
// de toasts y su retiro, no el posicionamiento, así que ese único import se
// cambia por un doble mínimo. `toast.js` en sí corre entero, sin tocar.
const MAPA = { '/src/js/ui/bottom-layer.js': '/tests/dobles/bottom-layer-doble.mjs' };

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.endsWith(real)) return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
  }
  return r;
}
