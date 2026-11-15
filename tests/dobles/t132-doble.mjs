// Doble de TODO lo que `features/recommendations.js` importa y no se prueba en
// `tests/recs-estilo.test.mjs` (v=369, tanda 132). Todo INVENTADO: ni red, ni Spotify, ni Last.fm.
// El estado va en `globalThis.__T132` (lo arma el test). `spotifyFetch` anota CADA llamada con
// sus argumentos tal cual (cuántos y cuáles) y contesta con `__T132.spotify(url, opciones)`.
// Exporta la UNIÓN de lo que importa `recommendations.js` en ce8098a y en v=369: así el mismo test
// carga las dos versiones.
const s = () => globalThis.__T132;

export async function spotifyFetch(...args) {
  s().llamadas.push(args);
  return s().spotify(...args);
}
export const createPlaylist = async () => { throw Error('doble t132: escritura prohibida'); };
export const addTracksToPlaylist = createPlaylist;
export const invalidatePlaylistsCache = () => {};
export const getAllLikedTracks = async () => s().likes;
export const getCurrentUserId = async () => 'uid-inventado-t132';

export const hasKey = () => true, setKey = () => {}, getKey = () => 'clave-inventada-t132';
export const hasUsername = () => true, getUsername = () => 'usuario-inventado-t132', setUsername = () => {};
export const getUserTopArtists = async () => [{ name: 'Fuente Inventada', playcount: 10 }];
export const getSimilarArtists = async () => [{ name: 'Recomendado Inventado', match: 1 }];
export const getArtistTopTracks = async (nombre) => s().topTracks(nombre);
export const pedirLastfmCrudo = async () => { throw Error('doble t132: red prohibida'); };
export const cargarEtiquetas = async () => {}, registroEtiquetas = () => null, setCachedTags = async () => true;

export const showProgress = () => {}, hideProgress = () => {}, promptPlaylistName = async () => null;
export const escapeHtml = (x) => String(x), pageHeader = () => '';
export const showToast = () => {}, getPreview = async () => null;
export const togglePreview = () => {}, playingKey = () => '', isPlayingAudio = () => false;
export const paintPlayingCard = () => {}, openTrackCard = () => {}, openAlbumCard = () => {};
export const vigilarRuta = () => ({ vigente: () => true });
export const recuperarUriDeArtistaKey = async () => null;
export const artistasOcultos = { size: 0, ready: () => new Promise(() => {}) };
export const alternarArtistaOculto = async () => false, artistaEstaOculto = () => false;
export const iconoPlay = () => '', iconoPausa = () => '', iconoFicha = () => '';
export const iconoDisco = () => '', iconoOjo = () => '', iconoOjoTachado = () => '';
export const pedirYCachear = async () => null, CUALQUIER_RESPUESTA = () => true;
