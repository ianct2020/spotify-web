// Doble de `src/js/api.js` para `tests/errores-que-dicen-hecho.test.mjs` (tanda 86).
//
// Exporta lo que importan `history-data.js` y `by-genre.js`. Ninguna función pega a la red:
// las que la pantalla de inicio de `#genre` no tendría que llamar NUNCA anotan la llamada en
// `globalThis.__T86.llamadas`, para que el test vea si alguien las tocó. El estado vive en
// `globalThis.__T86`, que el test rearma antes de cada caso.
function t() {
  if (!globalThis.__T86) globalThis.__T86 = { me: null, meFalla: null, likes: [], llamadas: [] };
  return globalThis.__T86;
}
const anotar = (nombre) => { t().llamadas.push(nombre); };

// Como el de verdad: con `/me` caído TIRA, no devuelve `null`.
export async function getCurrentUserId() {
  if (t().meFalla) throw new Error(t().meFalla);
  return t().me;
}
export async function getBestAvailableLikes() { return { items: t().likes, source: 'doble' }; }

export async function getAllLikedTracks() { anotar('getAllLikedTracks'); return t().likes; }
export async function createPlaylist() { anotar('createPlaylist'); throw new Error('doble: sin red'); }
export async function addTracksToPlaylist() { anotar('addTracksToPlaylist'); throw new Error('doble: sin red'); }
export function invalidatePlaylistsCache() { anotar('invalidatePlaylistsCache'); }
export async function exportAllData() { anotar('exportAllData'); return {}; }
export async function importAllData() { anotar('importAllData'); return {}; }
export const TEXTOS_LIKES_SIN_IMPORTAR = {};
