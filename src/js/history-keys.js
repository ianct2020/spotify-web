// Claves del cache de historial del owner (repo → IndexedDB).
//
// Viven en un módulo propio, sin imports, por una razón concreta: las necesitan
// `features/history-data.js` (que las escribe y las lee) y `api.js` (que las
// BORRA cuando cambia el usuario del navegador), y `history-data.js` ya importa
// `api.js`. Ponerlas en cualquiera de los dos obligaría a un import circular.
//
// ⚠️ POR QUÉ IMPORTA QUE HAYA UNA SOLA LISTA. Hasta v=188, `api.js` tenía una
// copia escrita a mano de estos nombres, y se quedó vieja: decía
// `history_track_plays_v2` cuando la real ya era la v5, y `history_skip_stats_v1`
// cuando era la v2. Además nombraba `history_albums_v2`, que no existe, y se
// olvidaba de `history_artist_tracks_v2`.
//
// La consecuencia no era cosmética: el guarda multiusuario borraba claves
// inexistentes y DEJABA INTACTAS las de verdad, así que al entrar otra persona
// en el mismo navegador se encontraba con el historial de escuchas del owner
// —plays, skips, detalle por pista y artistas—. Es exactamente la mezcla de
// datos que aparece en PENDIENTES.md §2.
//
// Si se sube una versión, se sube ACÁ y los dos lados se enteran solos.
const STATS_VERSION = 3;   // v3: los 4 `img` que faltaban en `years[].top_albums` (horneado por scripts/bake-covers.py)
const PLAYS_VERSION = 5;   // v5: cada álbum de `albums` lleva además el día de la primera play válida
const LISTENED_VERSION = 3;  // v3: las 91 tapas que faltaban (ítem 11) — mismo contenido, campo `img` ya no nulo
const SKIP_VERSION = 2;    // v2: [ok, skip, fwd_ms, close_ms, gid] — el veredicto lo arma features/skips.js
const DETAIL_VERSION = 1;
const RECORDS_VERSION = 2;
const ARTIST_TRACKS_VERSION = 2;  // v2: `totals` lleva el día de la primera play válida del artista

const OWNER_KEYS = {
  stats: `history_stats_v${STATS_VERSION}`,
  plays: `history_track_plays_v${PLAYS_VERSION}`,
  listened: `history_listened_albums_v${LISTENED_VERSION}`,
  skip: `history_skip_stats_v${SKIP_VERSION}`,
  detail: `history_track_detail_v${DETAIL_VERSION}`,
  records: `history_records_v${RECORDS_VERSION}`,
  artistTracks: `history_artist_tracks_v${ARTIST_TRACKS_VERSION}`,
};

/** Todas las claves del owner, para el guarda multiusuario. */
const OWNER_KEY_LIST = Object.values(OWNER_KEYS);

export {
  OWNER_KEYS, OWNER_KEY_LIST,
  STATS_VERSION, PLAYS_VERSION, LISTENED_VERSION, SKIP_VERSION,
  DETAIL_VERSION, RECORDS_VERSION, ARTIST_TRACKS_VERSION,
};
