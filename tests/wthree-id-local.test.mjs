// tests/wthree-id-local.test.mjs — los álbumes «Sin picks» de #wthree abren sin
// `/search`, y las filas del tracklist añaden a playlist y quitan de me gusta
// (v=258).
//
// El bug (medido el 29/09 con clic real sobre producción, v=257): los álbumes
// sin picks no traen `albumId`, así que el modal lo resolvía por `/search`, la
// cuota cara de la cuenta. Con esa cuota agotada: 12 s de «Cargando…», 6
// intentos de `/search`, «No pude cargar las pistas» a secas —el motivo del
// resolutor se tiraba en la desestructuración— y nunca un `/albums/{id}/tracks`.
// El id estaba en local: en el caché de me gusta, que la vista ya lee.
//
// Corre con: node tests/wthree-id-local.test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indiceIdsDeAlbum, idLocalDelAlbum } from '../src/js/util/album-id-local.js';
import { albumKey } from '../src/js/util/album-key.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const like = (albumName, albumId, artista, id = Math.random().toString(36).slice(2)) =>
  ({ track: { id, name: 'x', artists: [{ name: artista }], album: { id: albumId, name: albumName } } });

// ── 1. El índice ──────────────────────────────────────────────────────────────
console.log('\nindiceIdsDeAlbum');
{
  const idx = indiceIdsDeAlbum([like('4SZNZ', 'A1', 'bl4cko'), like('4SZNZ', 'A1', 'bl4cko')]);
  ok(idx.get(albumKey('4SZNZ', 'bl4cko')) === 'A1', 'un álbum con likes da su id');
  ok(idx.size === 1, 'una entrada por clave');
}
{
  const idx = indiceIdsDeAlbum([like('Disco', 'DELUXE', 'X'), like('Disco', 'NORMAL', 'X'), like('Disco', 'NORMAL', 'X')]);
  ok(idx.get(albumKey('Disco', 'X')) === 'NORMAL', 'dos ediciones con likes: gana la de MÁS pistas likeadas');
  const empate = indiceIdsDeAlbum([like('Disco', 'PRIMERO', 'X'), like('Disco', 'SEGUNDO', 'X')]);
  ok(empate.get(albumKey('Disco', 'X')) === 'PRIMERO', 'a igualdad, el primero que apareció (determinista)');
}
{
  // La clave es la de W-Three: artista de la PISTA. VULTURES 1 lo firma ¥$,
  // pero la lista de Ian lo cruza como «kanye west» porque así viene la pista.
  const idx = indiceIdsDeAlbum([like('VULTURES 1', 'V1', 'Kanye West')]);
  ok(idx.get(albumKey('VULTURES 1', 'Kanye West')) === 'V1', 'la clave sale del artists[0] de la pista, como el resto de #wthree');
}
{
  const idx = indiceIdsDeAlbum([
    { track: { id: 't', artists: [{ name: 'X' }], album: { name: 'Sin id' } } },
    { track: null }, null, {},
  ]);
  ok(idx.size === 0, 'pistas sin album.id, nulas o vacías no rompen ni inventan nada');
  ok(indiceIdsDeAlbum(undefined).size === 0, 'sin likes, índice vacío');
}

console.log('\nidLocalDelAlbum');
{
  const idx = indiceIdsDeAlbum([like('Air', 'DE_LIKES', 'Air')]);
  ok(idLocalDelAlbum({ name: 'Air', artist: 'Air', albumId: 'DE_PICKS' }, idx) === 'DE_PICKS',
    'si el álbum trae albumId (de la playlist de picks), ese manda');
  ok(idLocalDelAlbum({ name: 'Air', artist: 'Air' }, idx) === 'DE_LIKES', 'si no, el de los me gusta');
  ok(idLocalDelAlbum({ name: 'Otro', artist: 'Air' }, idx) === null, 'si no está en ningún lado, null (y ahí sí va el resolutor)');
  ok(idLocalDelAlbum({ name: 'Air', artist: 'Air' }, undefined) === null, 'sin índice (caché de likes fría), null sin tirar');
}

// ── 2. El cableado de wthree.js ───────────────────────────────────────────────
console.log('\nfetchAlbumTracks mira en local ANTES de ir a /search');
const src = readFileSync(join(RAIZ, 'src/js/features/wthree.js'), 'utf8');
const ini = src.indexOf('async function fetchAlbumTracks(');
const fin = src.indexOf('\n}\n', ini);
ok(ini >= 0 && fin > ini, 'fetchAlbumTracks existe (guarda del recorte)');
const cuerpo = src.slice(ini, fin);
const codigo = cuerpo.replace(/\/\/.*$/gm, '');
const pLocal = codigo.indexOf('idLocalDelAlbum(');
const pResolver = codigo.indexOf('resolveAlbumId(');
// ⚠️ Las dos posiciones tienen que EXISTIR antes de compararlas: con una en -1
// el `<` pasa con el bug puesto (lo que le pasó a likes-cache-policy en v=255).
ok(pLocal >= 0, 'usa idLocalDelAlbum');
ok(pResolver >= 0, 'y conserva el resolutor como último recurso');
ok(pLocal >= 0 && pResolver >= 0 && pLocal < pResolver, 'el id local se mira ANTES que el resolutor');
ok(/if\s*\(\s*!albumId\s*\)\s*\(\s*\{\s*id:\s*albumId\s*,\s*motivo\s*\}\s*=\s*await resolveAlbumId\(/.test(codigo),
  'el resolutor (o sea /search) corre SOLO si no hubo id local');
ok(!/const\s*\{\s*id:\s*albumId\s*\}\s*=\s*await resolveAlbumId/.test(codigo),
  'el motivo del resolutor ya no se tira en la desestructuración');
ok(/ensureLikedIndex\(\)/.test(codigo), 'el índice sale de ensureLikedIndex (caché local, sin descargar likes)');
ok(/liked\.albumIds/.test(codigo), 'y usa su albumIds');
ok(/albumIds\s*=\s*indiceIdsDeAlbum\(items\)/.test(src), 'ensureLikedIndex arma albumIds con indiceIdsDeAlbum');

console.log('\nel modal enseña el motivo');
ok(/const\s*\{\s*tracks\s*,\s*motivo\s*\}\s*=\s*await fetchAlbumTracks\(a\)/.test(src), 'el modal recibe tracks Y motivo');
ok(/No pude cargar las pistas del álbum: \$\{escapeHtml\(motivo/.test(src), 'y lo pinta en pantalla, escapado');

// ── 3. Tarea B: picker compartido y quitar de me gusta en lote ────────────────
console.log('\nañadir a playlist: el picker compartido, no uno nuevo');
ok(/import\s*\{\s*openPlaylistPicker\s*\}\s*from\s*'\.\.\/ui\/playlist-picker\.js'/.test(src), 'importa openPlaylistPicker de ui/playlist-picker.js');
ok(!/sc-pl-list|pp-list|pp-confirm/.test(src), 'wthree.js no arma el markup de un picker propio');
ok(/filter\(p\s*=>\s*p\.id\s*!==\s*playlistId\)/.test(src), 'la playlist de picks no se ofrece (los picks entran por «Guardar cambios»)');
ok(/addUrisToPlaylists\(\[t\.uri\]/.test(src), 'escribe por addUrisToPlaylists (duplicados y caché de items incluidos)');
ok(/marcarAnadida\(btn,\s*t,\s*res\)/.test(src), 'y la fila refleja dónde quedó');

console.log('\nquitar de me gusta: marcar, confirmar con el número, borrar verificado');
const wq = src.slice(src.indexOf('function wireQuitarLikes('), src.indexOf('// Devuelve `{ tracks, motivo }`.'));
ok(wq.length > 200, 'wireQuitarLikes existe (guarda del recorte)');
const pConf = wq.indexOf('await confirmModal(');
const pBorrar = wq.indexOf('await borrarLikesVerificado(');
ok(pConf >= 0 && pBorrar >= 0 && pConf < pBorrar, 'confirmModal ANTES del borrado, y el borrado solo tras él');
ok(/if\s*\(!ok\)\s*return;/.test(wq), 'cancelar no borra nada');
ok(/\$\{n\}\s*canciones/.test(wq) && /Quitar las \$\{n\}/.test(wq), 'el cartel y el botón llevan el número de temas');
ok(!/removeLikedTracks\(/.test(src), 'nadie llama a removeLikedTracks a pelo: va por borrarLikesVerificado, que verifica');
ok(/guarda:\s*'ninguna'/.test(wq) && /motivoSinGuarda:\s*'[^']{20,}'/.test(wq), 'declara la guarda y su motivo por escrito');
ok(/marcadas\.has\(id\)\)\s*marcadas\.delete\(id\);\s*else\s*marcadas\.add\(id\)/.test(wq),
  'el corazón solo MARCA (en memoria); no hay ninguna llamada de red en su handler');
const cc = src.slice(src.indexOf('function celdaCorazon('), src.indexOf('function wireAnadirAPlaylist('));
ok(/if\s*\(t\.likedById\)/.test(cc), 'solo es botón si el like es de ESTE id (no el de otra versión cruzada por nombre)');
ok(/likedById:\s*liked\.ids\.has\(t\.id\)/.test(src), 'y likedById sale del índice por id, no del de nombres');

console.log(`\n  ${pasaron} asserts OK, ${fallaron} fallos`);
process.exit(fallaron ? 1 : 0);
