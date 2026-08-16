// Nombre del artista a partir de lo que traen los likes (v=147).
//
// El patrón suelto `a.name || a` está mal y ya rompió cosas: hay al menos un
// like con `artists: [{ id: …, name: "" }]` —nombre vacío, no ausente— y ahí el
// `||` se cae al lado derecho y devuelve el OBJETO artista entero. En algunas
// vistas eso solo pinta `[object Object]`, pero en `#sin-clasificar` tiró abajo
// el orden «Por artista» (v=138).
//
// Vivía duplicado en features/skips.js; acá queda uno solo para que las tres
// vistas (skips, zero-plays, search-likes) se comporten igual.
export function firstArtistName(a) {
  const n = (a && typeof a === 'object') ? a.name : a;
  return typeof n === 'string' ? n : '';
}

// Los nombres de todos los artistas de un track, sin vacíos.
export function artistNames(track) {
  return (track?.artists || []).map(firstArtistName).filter(Boolean);
}
