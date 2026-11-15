// Loader para `tests/recs-estilo.test.mjs` (v=369, tanda 132).
//
// Quedan REALES: `features/recommendations.js`, la resolución compartida (`util/resolver-tema.js`),
// el módulo puro (`util/recs-estilo.js`) y lo puro de lo que dependen (la regla de géneros, el
// escaneo, el almacén, el autocorrect, `track-match.js`, `storage.js`). `api/lastfm.js` queda REAL
// solo cuando el test lo importa con `?real` (la conservación de `getArtistTopTags`); importado por
// `recommendations.js`, va al doble. `src/js/idb.js` va al doble en memoria de la tanda 60. Todo lo
// demás de `src/js/` (también `api.js`) va a `t132-doble.mjs`.

const AQUI = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const REALES = [
  '/src/js/features/recommendations.js',
  '/src/js/util/recs-estilo.js',
  '/src/js/util/resolver-tema.js',
  '/src/js/util/track-match.js',
  '/src/js/util/generos-regla.js',
  '/src/js/util/generos-escaneo.js',
  '/src/js/util/generos-artista.js',
  '/src/js/util/autocorrect-lastfm.js',
  '/src/js/util/mb-pais.js',
  '/src/js/util/mapa-escaneo.js',
  '/src/js/util/mapa-paises.js',
  '/src/js/storage.js',
];

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  const [base, query = ''] = r.url.split('?');
  if (!base.includes('/src/js/')) return r;
  if (base.endsWith('/src/js/idb.js')) return { ...r, url: AQUI + '/tests/dobles/idb-generos-doble.mjs', shortCircuit: true };
  if (base.endsWith('/src/js/api/lastfm.js') && query.includes('real')) return r;
  if (REALES.some((x) => base.endsWith(x))) return r;
  return { ...r, url: AQUI + '/tests/dobles/t132-doble.mjs', shortCircuit: true };
}
