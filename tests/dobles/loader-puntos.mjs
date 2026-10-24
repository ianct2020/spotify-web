// Loader de la fuerza bruta de la tanda 82 (`tests/copia-cada-await.test.mjs`): el de `loader.mjs`, con `api.js` e
// `idb.js` cambiados por los dobles que tienen puntos de espera (`api-doble-puntos.mjs`, `idb-ocultos-doble-puntos.mjs`).

const MAPA = {
  '/src/js/api.js': '/tests/dobles/api-doble-puntos.mjs',
  '/src/js/util/playlist-add.js': '/tests/dobles/playlist-add-doble.mjs',
  '/src/js/ui/toast.js': '/tests/dobles/toast-doble.mjs',
  '/src/js/idb.js': '/tests/dobles/idb-ocultos-doble-puntos.mjs',
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.endsWith(real)) {
      return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
    }
  }
  return r;
}
