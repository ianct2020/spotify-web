// Loader para `tests/biblioteca-lectura.test.mjs` (v=364, tanda 127): carga el `api.js` y el `util/discover-filters.js` REALES en
// Node. `src/js/idb.js` va por `idb-otra-cuenta-doble.mjs` (el de la tanda 98: ordena las operaciones como IndexedDB y anota lecturas,
// escrituras y borrados) y `ui/toast.js` por el de siempre. Las otras tres fuentes de `buildFilterContext()` que no son la biblioteca
// (`util/playlist-add.js`, `features/history-data.js` y `util/album-heard.js`) van por `t127-doble.mjs`: no son lo que se prueba y
// arrastran medio árbol. El test importa `api.js?caso=N` para tener el módulo frío en cada caso; el `?` viaja al doble de filtros
// (`discover-filters.js?caso=N` importa `../api.js`, que es el MISMO módulo para todos los casos de filtros: por eso esos casos
// vacían la caché a mano).

const MAPA = {
  '/src/js/idb.js': '/tests/dobles/idb-otra-cuenta-doble.mjs',
  '/src/js/ui/toast.js': '/tests/dobles/toast-doble.mjs',
  '/src/js/util/playlist-add.js': '/tests/dobles/t127-doble.mjs',
  '/src/js/features/history-data.js': '/tests/dobles/t127-doble.mjs',
  '/src/js/util/album-heard.js': '/tests/dobles/t127-doble.mjs',
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.split('?')[0].endsWith(real)) return { ...r, url: r.url.split('?')[0].replace(real, doble), shortCircuit: true };
  }
  return r;
}
