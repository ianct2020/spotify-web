// Loader para `tests/errores-que-dicen-hecho.test.mjs` (tanda 86).
//
// Carga dos módulos REALES: `features/history-data.js` («Borrarlo», `clearMyHistory()`) y
// `features/by-genre.js` (la pantalla de inicio de `#genre`). Lo que se prueba es qué dicen
// cuando algo falla por debajo, no la red, IndexedDB ni el DOM: todo eso va a dobles NUEVOS
// (los de las otras suites no se tocan). `storage.js`, `history-keys.js`, `util/genre-reason.js`
// y `util/cache-solo-exitos.js` siguen siendo los de verdad.
const MAPA = {
  '/src/js/api.js': '/tests/dobles/api-errores-hecho-doble.mjs',
  '/src/js/idb.js': '/tests/dobles/idb-borrado-falla-doble.mjs',
  '/src/js/ui/degraded-banner.js': '/tests/dobles/banner-doble.mjs',
  '/src/js/api/lastfm.js': '/tests/dobles/lastfm-genre-doble.mjs',
  '/src/js/api/statsfm.js': '/tests/dobles/vista-genre-doble.mjs',
  '/src/js/api/musicbrainz.js': '/tests/dobles/vista-genre-doble.mjs',
  '/src/js/ui/components.js': '/tests/dobles/vista-genre-doble.mjs',
  '/src/js/ui/toast.js': '/tests/dobles/vista-genre-doble.mjs',
  '/src/js/ui/modal-stack.js': '/tests/dobles/vista-genre-doble.mjs',
  '/src/js/features/genre-detail.js': '/tests/dobles/vista-genre-doble.mjs',
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.split('?')[0].endsWith(real)) return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
  }
  return r;
}
