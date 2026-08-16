// Parche en el lugar del cache de items de una playlist (v=147).
//
// Antes, después de cada guardado de W-Three se hacía
// `updatePlaylistItemsCache(id, null, null)`, que BORRA el cache. Como el
// `GET ?fields=snapshot_id` va retrasado respecto a nuestras propias escrituras
// (medido: seguía dando el snapshot viejo 40 s después del PUT), el guardado
// siguiente no podía confiar en nada y se comía un refetch entero de la
// playlist: 31 páginas × ~626 ms + 30 sleeps de 600 ms ≈ 39 s.
//
// Acá aplicamos al array cacheado exactamente el mismo diff que le mandamos a
// Spotify, y el caller lo guarda con el snapshot que devolvió la ÚLTIMA
// escritura — nunca releyéndolo, que es el error que corrompe el cache
// (snapshot viejo + items nuevos).
//
// Todo puro y sin IO para poder testearlo: tests/wthree-cache-patch.test.mjs.

// Un movimiento de `PUT /playlists/{id}/items`, con la semántica de Spotify:
// `range_start` e `insert_before` son índices sobre el array ANTES de sacar el
// bloque, y `insert_before` es exclusivo. Es la misma que simula
// `reorderPicksMinimal`, replicada acá sobre los items completos.
export function applyMoveToItems(items, { range_start, insert_before, range_length = 1 }) {
  const out = items.slice();
  if (range_start < 0 || range_start + range_length > out.length) return out;
  const moved = out.splice(range_start, range_length);
  // Al sacar el bloque, todo lo que estaba después de `range_start` corrió
  // `range_length` lugares hacia atrás; el destino hay que corregirlo solo si
  // estaba después del origen.
  const target = insert_before > range_start
    ? insert_before - range_length
    : insert_before;
  out.splice(target, 0, ...moved);
  return out;
}

// Aplica el diff completo de un guardado al array cacheado, en el mismo orden
// en el que se lo mandamos a Spotify: add → remove → reorders.
//
// - `addItems`: items YA en forma de la API (`{ item: {...} }`), insertados en
//   `addInsertPos` (o al final si es null), igual que hace `addTracksToPlaylist`.
// - `removeUris`: se borran TODAS las instancias, igual que el DELETE por URI.
// - `moves`: la secuencia exacta de PUT que emitió `reorderPicksMinimal`.
export function patchPlaylistItems(items, {
  addItems = [], addInsertPos = null, removeUris = [], moves = [],
} = {}) {
  let out = items.slice();

  if (addItems.length) {
    const at = addInsertPos != null
      ? Math.max(0, Math.min(addInsertPos, out.length))
      : out.length;
    out.splice(at, 0, ...addItems);
  }

  if (removeUris.length) {
    const dead = new Set(removeUris);
    out = out.filter(it => !dead.has((it?.item || it?.track)?.uri));
  }

  for (const m of moves) out = applyMoveToItems(out, m);

  return out;
}

// Item sintético con la forma que devuelve `GET /playlists/{id}/items`, armado
// con lo que ya tenemos en el modal: la pista viene de
// `GET /albums/{id}/tracks` (trae name, artists, duration_ms, track_number pero
// NO el objeto `album`) y el álbum, de la tarjeta que abrió el modal.
//
// Los campos son los que consumen de verdad los lectores del cache:
// `uri`/`id`/`name` (wthree, sync, dedupe, zombies), `album.name` +
// `artists[0].name` (util/album-heard.js) y `album.images` (features/covers.js).
export function buildCachedItem(track, album) {
  return {
    item: {
      id: track.id,
      uri: track.uri,
      name: track.name,
      duration_ms: track.duration_ms ?? null,
      track_number: track.track_number ?? null,
      artists: track.artists?.length
        ? track.artists
        : (album?.artist ? [{ name: album.artist }] : []),
      album: {
        id: album?.albumId ?? null,
        name: album?.name ?? '',
        images: album?.img ? [{ url: album.img }] : [],
      },
    },
  };
}
