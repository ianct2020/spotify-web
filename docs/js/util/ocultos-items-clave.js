// El prefijo del caché de items de las playlists de ocultos (v=299), en un
// módulo SIN imports.
//
// Lo usan dos: `util/hidden-sync.js`, que escribe, lee y borra
// `ocultos_items_v1_<playlistId>` (y lo re-exporta), y `api.js`, que lo borra
// cuando cambia el usuario del navegador (v=300). No puede vivir solo en
// `hidden-sync.js`: `api.js` importándolo arma el ciclo api.js → hidden-sync.js
// → playlist-add.js → api.js, y `playlist-add.js` llama a
// `onPlaylistsInvalidated()` al cargarse, antes de que `api.js` haya creado su
// `_playlistsInvalidationSubs` (el ciclo que `api.js` ya advierte). Es la
// misma razón por la que existe `history-keys.js`.
export const OCULTOS_ITEMS_PREFIX = 'ocultos_items_v1_';
