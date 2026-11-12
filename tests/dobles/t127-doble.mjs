// Doble para `tests/biblioteca-lectura.test.mjs` (v=364, tanda 127). Reemplaza a `util/playlist-add.js`, `features/history-data.js`
// y `util/album-heard.js` SOLO para `util/discover-filters.js`, que de cada uno importa un nombre. Las tres fuentes contestan «no hay»:
// lo que el test mira de `buildFilterContext()` es la biblioteca de álbumes, que va por el `api.js` REAL.
export async function getOwnPlaylists() { return []; }
export async function loadListenedAlbums() { return null; }
export async function buildAlbumHeardIndex() { return { heardBases: new Set() }; }
