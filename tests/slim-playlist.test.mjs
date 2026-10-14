// tests/slim-playlist.test.mjs — la lista de playlists conserva el `snapshot_id`
// de cada una si viene (v=300, tanda 48)
//
// `slimPlaylist()` (`api.js`) recorta cada playlist de `GET /me/playlists` antes
// de guardarla en `spc_all_user_playlists` (localStorage, 24 h). Desde v=300
// conserva `snapshot_id: p.snapshot_id ?? null`. **No hay ningún lector todavía**:
// la ganancia en esta versión es cero. Y que la API real lo devuelva en el
// objeto simplificado NO está verificado contra la Spotify de verdad.
//
// Lo que importa es el caso SIN el campo: tiene que quedar todo como en v=299,
// con `snapshot_id: null` y el resto del objeto idéntico byte a byte. La
// referencia `V299` de abajo es la salida del `slimPlaylist()` de v=299 (HEAD
// antes del cambio, corrido en una copia temporal el 13/10) para esas mismas
// entradas. No se regenera con el código nuevo.
//
// `api.js` importa medio navegador y no se puede importar en Node: la función
// se saca del fuente y se arma sola (no usa nada de afuera).
// `SLIM_FUENTE=<ruta>` corre la suite contra otro `api.js`.

import { readFileSync } from 'node:fs';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
function eq(a, b, nombre) {
  const bien = JSON.stringify(a) === JSON.stringify(b);
  if (!bien) console.log(`      esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
  ok(bien, nombre);
}

const ruta = process.env.SLIM_FUENTE || new URL('../src/js/api.js', import.meta.url);
const fuente = readFileSync(ruta, 'utf8');
function cuerpoDe(f, firma) {
  const i = f.indexOf(firma);
  if (i < 0) return null;
  const abre = f.indexOf('{', i + firma.length - 1);
  let prof = 0;
  for (let j = abre; j < f.length; j++) {
    if (f[j] === '{') prof++;
    else if (f[j] === '}') { prof--; if (prof === 0) return f.slice(i, j + 1); }
  }
  return null;
}
const src = cuerpoDe(fuente, 'function slimPlaylist(p) {');
ok(!!src, 'encuentra slimPlaylist() en api.js');
const slimPlaylist = new Function(`${src}; return slimPlaylist;`)();

// Dos playlists con la forma de `/me/playlists` post-migración (`items`, no `tracks`).
const conCampo = {
  id: 'pl1', name: 'fonoteca · prueba', snapshot_id: 'AAAAB2Fz1p0oX3l0m9k8jHgFdSaQwErT',
  owner: { id: 'u-prueba', display_name: 'Prueba', href: 'x', type: 'user' },
  items: { href: 'x', total: 42 }, public: false, collaborative: false,
  images: [{ url: 'https://i/640', height: 640 }, { url: 'https://i/300', height: 300 }, { url: 'https://i/60', height: 60 }],
  description: 'no se guarda', uri: 'spotify:playlist:pl1', external_urls: {},
};
const sinCampo = (() => { const { snapshot_id, ...resto } = conCampo; return resto; })();
const sinCampoTracks = { id: 'pl2', name: 'vieja', owner: { id: 'u2' }, tracks: { total: 3 }, public: true, collaborative: false, images: [] };

// La salida del slimPlaylist() de v=299 para `sinCampo` y `sinCampoTracks`.
const V299 = {
  sinCampo: { id: 'pl1', name: 'fonoteca · prueba', owner: { id: 'u-prueba', display_name: 'Prueba' }, tracks: { total: 42 }, public: false, collaborative: false, image: 'https://i/60' },
  sinCampoTracks: { id: 'pl2', name: 'vieja', owner: { id: 'u2' }, tracks: { total: 3 }, public: true, collaborative: false, image: null },
};

console.log('\nCon el campo');
eq(slimPlaylist(conCampo).snapshot_id, conCampo.snapshot_id, 'slimPlaylist() conserva el snapshot_id tal cual');

console.log('\nSin el campo: el camino de v=299, igual');
for (const [nombre, entrada] of [['sinCampo', sinCampo], ['sinCampoTracks', sinCampoTracks]]) {
  const out = slimPlaylist(entrada);
  console.log(`      ${nombre} → ${JSON.stringify(out)}`);
  ok('snapshot_id' in out && out.snapshot_id === null, `${nombre}: snapshot_id queda en null (no undefined, no falta)`);
  const { snapshot_id, ...resto } = out;
  eq(resto, V299[nombre], `${nombre}: el resto del objeto es idéntico al de v=299`);
  eq(JSON.stringify(resto), JSON.stringify(V299[nombre]), `${nombre}: y en el mismo orden de claves`);
}
eq(slimPlaylist(null), null, 'null sigue devolviendo null');

console.log('\nNingún lector nuevo');
const sinComentarios = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
ok((sinComentarios(src).match(/snapshot_id/g) || []).length === 2, 'slimPlaylist() nombra snapshot_id una vez (clave y valor: `snapshot_id: p.snapshot_id ?? null`)');

console.log(`\n${pasaron} asserts OK, ${fallaron} fallos`);
if (fallaron) process.exit(1);
