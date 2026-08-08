// Filtro de "basura" del historial: entradas que Spotify sirve como música pero
// no lo son (sonidos funcionales para sacar agua del altavoz, ruido de lluvia
// para dormir, frecuencias 432 Hz, tonos de prueba…).
//
// Historia: en v=93 esto eran 3 substrings en gen-stats.py que solo tapaban el
// "Sonido Para Sacar Agua Del Movil". v=126 lo amplía y lo saca a un módulo
// compartido para que TODAS las vistas filtren igual: wrapped, records,
// dashboard, covers, discover y listened.
//
// Este archivo tiene que quedar sincronizado con `EXCLUDED_ARTISTS` /
// `EXCLUDED_TRACK_SUBSTRINGS` de `scripts/gen-stats.py`. Los JSON del owner ya
// vienen filtrados desde el pipeline; esto es la red de contención en runtime
// (y lo que usa el historial BYOH procesado en el navegador).

// Artistas que solo publican sonidos funcionales — se van enteros.
// Comparación exacta sobre el nombre normalizado.
const EXCLUDED_ARTISTS = new Set([
  'nbeats',
  'miracle tones',
  'para dormir',
  'lluvia del bosque',
  '24h rain sounds',
  'naturaleza sonidos',
  'sonidos de truenos y lluvia',
  'estudio de sonidos de lluvia',
  'calmwaves',
  'musica instrumental para dormir',
]);

// Substrings sobre el nombre del track normalizado. Deliberadamente estrechos:
// "white noise" y "pink noise" a secas se probaron y pisaban canciones reales
// (Brent Faiyaz, Ella Vos, young friend, Francesca Wexler), así que quedaron fuera.
const EXCLUDED_TRACK_SUBSTRINGS = [
  'sonido para',                 // sacar agua / eliminar agua / enfriar el teléfono
  'sonidos para',
  'sonido de lluvia',
  'sonidos de lluvia',
  'sonidos de naturaleza',
  'lluvia de fondo para dormir',
  'fix my speakers',
  'water eject',
  'eject water',
  'remove water from',
  'som para remover agua',
  'ruido fuerte para molestar',
  'ruido blanco',
  'frecuencia de repelente',
  'frecuencias de repelente',
  'rain sounds',
  'rain soundscape',
  '432 hz',
  '432hz',
  '528 hz',
  '528hz',
  'theta waves',
  'binaural beat',
  'tono de prueba',
  'test tone',
];

// Minúsculas + sin tildes, para que "Teléfono" y "Telefono" caigan igual.
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ¿Esta entrada es basura funcional en vez de música?
function isJunkTrack(trackName, artistName) {
  if (artistName && EXCLUDED_ARTISTS.has(normalize(artistName))) return true;
  const t = normalize(trackName);
  if (!t) return false;
  return EXCLUDED_TRACK_SUBSTRINGS.some(sub => t.includes(sub));
}

// Helper para listas ya materializadas. `pick` saca {name, artist} del item.
function filterJunk(items, pick = (x) => x) {
  if (!Array.isArray(items)) return items;
  return items.filter(it => {
    const { name, artist } = pick(it) || {};
    return !isJunkTrack(name, artist);
  });
}

export { isJunkTrack, filterJunk, EXCLUDED_ARTISTS, EXCLUDED_TRACK_SUBSTRINGS };
