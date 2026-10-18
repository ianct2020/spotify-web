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
//
// ⚠️ Estos números solo arman la clave de IndexedDB y el `?v=` de la URL del
// JSON (`dataUrl` en `history-data.js`). NO son el campo `version` que viaja
// dentro de cada JSON: ese lo escribe `scripts/gen-stats.py` con constantes del
// mismo nombre, y son contadores distintos e independientes. Al 2026-09-23 van
// desfasados en uno en STATS (acá 4, JSON 3) y en LISTENED (acá 3, JSON 2):
// v=204 (a94e43a) subió solo los de acá, para forzar el refetch de las tapas
// nuevas. Ningún código lee el `version` de stats ni el de listened; el único
// lector de `.version` es el de skips.
const STATS_VERSION = 6;   // v6 (v=295): la basura funcional sale también del divisor de `skip_pct`, y `years[]` y `totals` ganan `plays_junk`. OJO: es otro contador que el `version` de DENTRO del JSON (5). v5 (v=291): `years[].skip_pct` con la definición de `totals.skip_pct`, más `plays_raw` y `skips` por año. OJO: es otro contador que el `version` de DENTRO del JSON (4). v4: `years[].days`
const PLAYS_VERSION = 5;   // v5: cada álbum de `albums` lleva además el día de la primera play válida
const LISTENED_VERSION = 3;  // v3: las 91 tapas que faltaban (ítem 11) — mismo contenido, campo `img` ya no nulo
const SKIP_VERSION = 4;    // v4: mismo formato que v3, pero el `gid` se recalculó con la cola de versión tras el guion (v=271): «X - Sped Up», «- Piano», «- reimagined», «- Raw Rhymes», «- Refix» y «- Music From …» vuelven a ser el mismo tema que su base
const DETAIL_VERSION = 1;
const RECORDS_VERSION = 3;  // v3: seis récords nuevos (día con más artistas, tema en más años, artista con más días, abandonado, crecimiento, racha de artista)
const SIMILARES_VERSION = 1;  // v1 (v=315, tanda 64): `history-artist-similares.json`, el mapa de artistas horneado por `scripts/hornear-similares.mjs` (los parecidos de Last.fm entre tus artistas y sus posiciones). No lo produce `gen-stats.py` ni el import BYOH: es solo del owner. `OWNER_PREV_KEYS.similares` VACÍA
const ARTIST_TRACKS_VERSION = 3;  // v3 (v=308): `totals` suma [6] el tema de entrada y [7] el día del segundo tema (`#puertas`). La lista de `OWNER_PREV_KEYS.artistTracks` sigue VACÍA: el v2 pasa el `sanityCheck` y migrarlo pintaría `#puertas` sin los campos. v2: `totals` lleva el día de la primera play válida del artista

const OWNER_KEYS = {
  stats: `history_stats_v${STATS_VERSION}`,
  plays: `history_track_plays_v${PLAYS_VERSION}`,
  listened: `history_listened_albums_v${LISTENED_VERSION}`,
  skip: `history_skip_stats_v${SKIP_VERSION}`,
  detail: `history_track_detail_v${DETAIL_VERSION}`,
  records: `history_records_v${RECORDS_VERSION}`,
  artistTracks: `history_artist_tracks_v${ARTIST_TRACKS_VERSION}`,
  similares: `history_artist_similares_v${SIMILARES_VERSION}`,
};

/** Todas las claves del owner, para el guarda multiusuario. */
const OWNER_KEY_LIST = Object.values(OWNER_KEYS);

// El historial que el usuario IMPORTÓ (BYOH, y el detalle por día del owner):
// `local_<uid>_history_<tipo>`, lo arma `localKey()` de `history-data.js`. Vive
// acá y no allá por lo mismo que las de arriba: `util/limpiar-cache.js` lo
// necesita para conservarlo (v=300), y `history-data.js` arrastra `api.js`.
// El uid va en el MEDIO de la clave, así que el prefijo que se puede comparar
// con `startsWith` es este y nada más largo. Al 2026-10-13 `localKey()` es el
// único sitio de `src/js/` que arma claves de IndexedDB que empiezan así.
const LOCAL_HISTORY_PREFIX = 'local_';

export {
  OWNER_KEYS, OWNER_KEY_LIST, LOCAL_HISTORY_PREFIX,
  STATS_VERSION, PLAYS_VERSION, LISTENED_VERSION, SKIP_VERSION,
  DETAIL_VERSION, RECORDS_VERSION, ARTIST_TRACKS_VERSION, SIMILARES_VERSION,
};
