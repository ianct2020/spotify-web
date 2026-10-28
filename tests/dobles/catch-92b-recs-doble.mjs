// Todo INVENTADO. La suite controla las lecturas; no hay red ni almacenamiento.
const s = () => globalThis.__T92B_RECS;
export const spotifyFetch = async () => { throw Error('red prohibida'); };
export const createPlaylist = spotifyFetch, addTracksToPlaylist = spotifyFetch;
export const invalidatePlaylistsCache = () => {};
export const getAllLikedTracks = async () => {
  s().likesCalls++;
  if (s().likesError) throw Error(s().likesError);
  return s().likes;
};
export const hasKey = () => true, setKey = () => {};
export const hasUsername = () => true, getUsername = () => 'prueba-inventada', setUsername = () => {};
export const getUserTopArtists = async () => [{ name: 'Artista Inventado', playcount: 1 }];
export const getSimilarArtists = async () => { s().similaresCalls++; return []; };
export const getArtistTopTracks = async () => [];
export const showProgress = () => {}, hideProgress = () => {}, promptPlaylistName = () => {};
export const escapeHtml = x => String(x), pageHeader = () => '';
export const showToast = () => {}, getPreview = async () => null;
export const togglePreview = () => {}, playingKey = () => '', isPlayingAudio = () => false;
export const paintPlayingCard = () => {}, openTrackCard = () => {}, openAlbumCard = () => {};
export const limpiaParaQuery = x => x, titleMatches = () => false, artistMatches = () => false;
export const vigilarRuta = () => ({ vigente: () => true });
export const recuperarUriDeArtistaKey = async () => null;
export const artistasOcultos = { size: 0, ready: () => new Promise(() => {}) };
export const alternarArtistaOculto = async () => false, artistaEstaOculto = () => false;
export const iconoPlay = () => '', iconoPausa = () => '', iconoFicha = () => '';
export const iconoDisco = () => '', iconoOjo = () => '', iconoOjoTachado = () => '';
export const pedirYCachear = async () => null, CUALQUIER_RESPUESTA = () => true;
