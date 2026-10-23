// Loader para `tests/copia-completa.test.mjs` (v=333): carga el `api.js` REAL en Node con `src/js/idb.js` cambiado por
// un doble en memoria que ANOTA cada escritura (`idb-copia-doble.mjs`) y `ui/toast.js` por el de siempre. El resto
// (`storage.js`, `auth.js`, `api/lastfm.js`, `util/*`) es el real, con un `localStorage` y un `fetch` de mentira que
// pone el test.

const MAPA = {
  '/src/js/idb.js': '/tests/dobles/idb-copia-doble.mjs',
  '/src/js/ui/toast.js': '/tests/dobles/toast-doble.mjs',
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.split('?')[0].endsWith(real)) return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
  }
  return r;
}
