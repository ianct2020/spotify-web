// Loader para `tests/generos-artista.test.mjs` (v=312): cambia `src/js/idb.js` por un
// doble en memoria. `lastfm.js` no tiene más dependencias que `storage.js` (que solo
// toca `localStorage`, y el test pone uno de mentira) y `util/generos-artista.js`.

const MAPA = { '/src/js/idb.js': '/tests/dobles/idb-generos-doble.mjs' };

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.split('?')[0].endsWith(real)) return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
  }
  return r;
}
