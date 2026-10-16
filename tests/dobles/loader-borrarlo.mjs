// Loader para la sección «Borrarlo» de `tests/import-guarda-owner.test.mjs` (v=309, tanda 57).
//
// Carga el `features/import-history.js` REAL para correr el handler de `#ih-clear` tal cual. Lo
// que se prueba es qué hace ese handler cuando `clearMyHistory()` tira (toast rojo, sin «Historial
// local borrado», sin cerrar y sin recargar), no el modal ni los toasts de verdad, que necesitan el
// DOM: esos tres imports van a dobles que apuntan. `history-data.js` sigue siendo el real (con los
// dobles de `loader-guarda.mjs` debajo), así que la guarda que corre es la de producción.
const MAPA = {
  '/src/js/ui/components.js': '/tests/dobles/components-borrarlo-doble.mjs',
  '/src/js/ui/toast.js': '/tests/dobles/toast-doble.mjs',
  '/src/js/ui/modal-stack.js': '/tests/dobles/modal-stack-borrarlo-doble.mjs',
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.endsWith(real)) return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
  }
  return r;
}
