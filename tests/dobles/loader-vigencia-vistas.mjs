// Loader de `tests/vigencia-records-byartist.test.mjs` (v=329, tanda 75).
//
// `features/records.js` y `features/by-artist.js` importan la red, el DOM global, el reproductor, la
// ficha de artista y el almacén; nada de eso existe en Node, y no es lo que se prueba: lo que se
// prueba es qué hace cada vista al volver de un `await` después de que saliste. Todos esos módulos
// se cambian por UN doble (`vigencia-vistas-doble.mjs`); `util/vigencia-ruta.js` corre real y su
// `../router.js` también cae en el doble. Se compara por el final de la URL, así que sirve igual
// para el `src/` del repo y para una copia vieja (`BY_ARTIST=…` / `RECORDS=…`) con la misma forma.

const DOBLE = '/tests/dobles/vigencia-vistas-doble.mjs';
const REALES = [
  '/src/js/api.js',
  '/src/js/router.js',
  '/src/js/features/history-data.js',
  '/src/js/ui/components.js',
  '/src/js/ui/toast.js',
  '/src/js/util/artist-preview.js',
  '/src/js/api/preview-providers.js',
  '/src/js/ui/preview-player.js',
  '/src/js/features/artist-card.js',
  '/src/js/storage.js',
];
const AQUI = new URL('../..', import.meta.url).href.replace(/\/$/, '');

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const real of REALES) {
    if (r.url.endsWith(real)) return { ...r, url: AQUI + DOBLE, shortCircuit: true };
  }
  return r;
}
