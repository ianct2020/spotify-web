// Doble de `util/playlist-add.js`: hidden-sync solo le pide invalidar el cache.
export function invalidateOwnPlaylists() { globalThis.__DOBLE.invalidada = true; }
