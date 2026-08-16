// Test del parche en el lugar del cache de items (v=147). Es lo que reemplaza
// al `updatePlaylistItemsCache(id, null, null)` que borraba el cache y hacía que
// el guardado siguiente se comiera un refetch entero de 39 s.
//
// Correr con: node tests/wthree-cache-patch.test.mjs

import { applyMoveToItems, patchPlaylistItems, buildCachedItem } from '../src/js/util/playlist-cache-patch.js';

let passed = 0, failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n    esperado: ${e}\n    obtenido: ${a}`); failed++; }
}

// Item con la forma de la API: { item: { uri, ... } }
const it = n => ({ item: { id: n, uri: `spotify:track:${n}`, name: n } });
const names = arr => arr.map(x => x.item.name);

// ── applyMoveToItems: la semántica de PUT /playlists/{id}/items ─────────
// `range_start` e `insert_before` son índices sobre el array ANTES de sacar el
// bloque, e `insert_before` es exclusivo.
console.log('\napplyMoveToItems — semántica de Spotify');
{
  const base = ['A', 'B', 'C', 'D', 'E'].map(it);

  eq(names(applyMoveToItems(base, { range_start: 3, insert_before: 1 })),
    ['A', 'D', 'B', 'C', 'E'],
    'subir: D (3) antes de 1');

  eq(names(applyMoveToItems(base, { range_start: 1, insert_before: 4 })),
    ['A', 'C', 'D', 'B', 'E'],
    'bajar: B (1) antes de 4');

  eq(names(applyMoveToItems(base, { range_start: 2, insert_before: 2 })),
    ['A', 'B', 'C', 'D', 'E'],
    'moverse a su propio lugar no cambia nada');

  eq(names(applyMoveToItems(base, { range_start: 0, insert_before: 5 })),
    ['B', 'C', 'D', 'E', 'A'],
    'mover el primero al final');

  eq(names(applyMoveToItems(base, { range_start: 1, insert_before: 4, range_length: 2 })),
    ['A', 'D', 'B', 'C', 'E'],
    'bloque de 2: B,C antes de 4');

  eq(names(applyMoveToItems(base, { range_start: 9, insert_before: 1 })),
    ['A', 'B', 'C', 'D', 'E'],
    'range_start fuera de rango: devuelve igual, no rompe');
}

// ── El caso Donda, exactamente el que se midió en producción ────────────
// Playlist real: 73 Jesus Lord · 74 Jonah · 75 «24». El guardado #1 mueve «24»
// arriba de «Jonah» (PUT 75 → antes de 74) y el #2 lo devuelve
// (PUT 75 → antes de 74 otra vez, porque ahora en 75 está Jonah).
console.log('\ncaso Donda — los dos guardados medidos en producción');
{
  const playlist = [];
  for (let i = 0; i < 73; i++) playlist.push(it(`relleno${i}`));
  playlist.push(it('Jesus Lord'), it('Jonah'), it('24'), it('Ghost Town'));

  const save1 = patchPlaylistItems(playlist, {
    moves: [{ range_start: 75, insert_before: 74, range_length: 1 }],
  });
  eq(names(save1).slice(73, 77), ['Jesus Lord', '24', 'Jonah', 'Ghost Town'],
    'guardado #1: «24» queda arriba de «Jonah»');

  const save2 = patchPlaylistItems(save1, {
    moves: [{ range_start: 75, insert_before: 74, range_length: 1 }],
  });
  eq(names(save2).slice(73, 77), ['Jesus Lord', 'Jonah', '24', 'Ghost Town'],
    'guardado #2: vuelve al orden original');
  eq(save2.length, playlist.length, 'el largo de la playlist no se mueve');
  eq(names(save2), names(playlist), 'la playlist entera queda idéntica a la de partida');
}

// ── add / remove ───────────────────────────────────────────────────────
console.log('\nadd y remove');
{
  const base = ['A', 'B', 'C'].map(it);

  eq(names(patchPlaylistItems(base, { addItems: [it('X')], addInsertPos: 1 })),
    ['A', 'X', 'B', 'C'], 'add en addInsertPos');

  eq(names(patchPlaylistItems(base, { addItems: [it('X')], addInsertPos: null })),
    ['A', 'B', 'C', 'X'], 'add sin posición: al final');

  eq(names(patchPlaylistItems(base, { addItems: [it('X')], addInsertPos: 99 })),
    ['A', 'B', 'C', 'X'], 'addInsertPos más allá del final: clampea');

  eq(names(patchPlaylistItems(base, { removeUris: ['spotify:track:B'] })),
    ['A', 'C'], 'remove por URI');

  eq(names(patchPlaylistItems(base, { removeUris: ['spotify:track:Z'] })),
    ['A', 'B', 'C'], 'remove de algo que no está: no cambia nada');
}

// ── El orden importa: add → remove → moves, igual que se lo mandamos a la API ──
console.log('\norden de aplicación (add → remove → reorder)');
{
  const base = ['A', 'B', 'C'].map(it);
  // Add X en 3 (al final), sacar B, y después mover X (que quedó en 2) al frente.
  const out = patchPlaylistItems(base, {
    addItems: [it('X')], addInsertPos: 3,
    removeUris: ['spotify:track:B'],
    moves: [{ range_start: 2, insert_before: 0, range_length: 1 }],
  });
  eq(names(out), ['X', 'A', 'C'], 'add, remove y reorder encadenados');
}

// ── El array de entrada no se toca (importa: es el cache vivo en memoria) ──
console.log('\ninmutabilidad');
{
  const base = ['A', 'B', 'C'].map(it);
  patchPlaylistItems(base, {
    addItems: [it('X')], addInsertPos: 0,
    removeUris: ['spotify:track:B'],
    moves: [{ range_start: 0, insert_before: 2 }],
  });
  eq(names(base), ['A', 'B', 'C'], 'el array original queda intacto');
}

// ── buildCachedItem: la forma que consumen los lectores del cache ───────
console.log('\nbuildCachedItem');
{
  const track = {
    id: '68RhNM', uri: 'spotify:track:68RhNM', name: '24',
    duration_ms: 200000, track_number: 22, artists: [{ name: 'Kanye West' }],
  };
  const album = { name: 'Donda', artist: 'Kanye West', albumId: 'alb1', img: 'http://x/y.jpg' };
  const built = buildCachedItem(track, album);

  eq(built.item.uri, 'spotify:track:68RhNM', 'uri (lo que usa wthree/sync/dedupe)');
  eq(built.item.album.name, 'Donda', 'album.name (lo que usa util/album-heard.js)');
  eq(built.item.artists[0].name, 'Kanye West', 'artists[0].name (album-heard)');
  eq(built.item.album.images, [{ url: 'http://x/y.jpg' }], 'album.images (features/covers.js)');

  // Pista pelada (solo lo que trae orderedPicks): no debe romper.
  const pelado = buildCachedItem(
    { id: 'z', uri: 'spotify:track:z', name: 'Z' },
    { name: 'Donda', artist: 'Kanye West', albumId: null, img: null },
  );
  eq(pelado.item.artists, [{ name: 'Kanye West' }], 'sin artists: cae al artista del álbum');
  eq(pelado.item.album.images, [], 'sin tapa: images vacío, no undefined');
  eq(pelado.item.duration_ms, null, 'sin duración: null explícito');
}

console.log(`\n${passed} pasaron · ${failed} fallaron\n`);
process.exit(failed ? 1 : 0);
