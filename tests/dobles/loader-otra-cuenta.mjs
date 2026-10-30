// Loader para `tests/me-gusta-de-otra-cuenta.test.mjs` (v=345, tanda 98): carga el `api.js` REAL en Node con
// `src/js/idb.js` cambiado por `idb-otra-cuenta-doble.mjs` (borrados que fallan o tardan, y la cola de IndexedDB) y
// `ui/toast.js` por el de siempre. El resto es el real, con un `localStorage` y un `fetch` de mentira que pone el test.
// El test importa `api.js?caso=N` para tener el memo de `getCurrentUserId()` frío en cada caso; el `?` no le cambia
// nada a esto (se compara la ruta sin la consulta).

const MAPA = {
  '/src/js/idb.js': '/tests/dobles/idb-otra-cuenta-doble.mjs',
  '/src/js/ui/toast.js': '/tests/dobles/toast-doble.mjs',
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.split('?')[0].endsWith(real)) return { ...r, url: r.url.split('?')[0].replace(real, doble), shortCircuit: true };
  }
  return r;
}
