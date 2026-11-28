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
// v=369 (tanda 132): lo que `recommendations.js` importa para «Agrupar por estilo». Este test no lo
// ejercita (no hay recomendaciones en sus casos): solo tienen que existir para que el módulo cargue.
export const getCurrentUserId = async () => 'uid-inventado', getKey = () => 'clave-inventada';
export const pedirLastfmCrudo = async () => { throw Error('red prohibida'); };
export const cargarEtiquetas = async () => {}, registroEtiquetas = () => null, setCachedTags = async () => true;
export const urlEtiquetas = () => 'about:blank', resolverTemaEnSpotify = async () => ({ estado: 'error', error: Error('red prohibida') });
export const pedirEtiquetas = async () => ({ motivo: 'completo', total: 0, pedidas: 0, guardados: [], noContesto: [] });
export const pendientesDeEtiquetas = () => [], agruparPorEstilo = () => ({ estilos: [], cuentas: {}, porArtista: new Map() });
export const textoSinEstilo = () => '', TEXTO_SIN_ESTILOS = '', ARTISTAS_POR_ESTILO = 6;
export const planDeLista = () => ({ artistas: [], temas: 12, topePorArtista: 15, topeTotal: 0 }), textoCoste = () => '', TITULO_COSTE = '';
export const armarLista = async () => ({ artistas: [], busquedas: 0, corte: null, sinBuscar: [] });
export const textoCabecera = () => '', textoCorte = () => '', textoSinBuscar = () => '';
export const textoSinResolver = () => '';   // tanda 141: lo importa `recommendations.js` desde v=378
export const nombreSugerido = () => '', descripcionPlaylist = () => '';
export const TEMAS_MIN = 10, TEMAS_MAX = 15, TEMAS_DEFECTO = 12;
