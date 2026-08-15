// Detección de "zombis": pistas que Spotify sacó del catálogo y siguen
// figurando en tus likes o en tus playlists.
//
// La regla vivía dentro de features/zombies.js repetida dos veces (una para
// likes, otra para items de playlist). Se extrajo acá para que la Smart
// Playlist pueda filtrarlos ANTES de escribir sin duplicar el criterio: una
// playlist de 500 aleatorias que incluye zombis se crea con huecos grises que
// no suenan.
//
// Qué mira, y por qué esas tres cosas:
//   - `!t`            → el item existe pero el track vino en null (el caso más
//                       común de "borrado del catálogo").
//   - `!t.id`         → local file o track sin identidad: tampoco se puede
//                       reproducir ni añadir a una playlist por uri.
//   - `is_playable === false` → Spotify lo marca explícitamente. Ojo con el
//                       `=== false`: el campo NO viene en todas las respuestas
//                       (solo con relinking/market), y `!t.is_playable` daría
//                       por zombi a todo lo demás.

/** @param {object|null} t objeto track de Spotify (o el slim de api.js) */
export function isZombieTrack(t) {
  return !t || !t.id || t.is_playable === false;
}

/** Igual, pero desde el item que envuelve al track (`{track}` o `{item}`). */
export function isZombieItem(item) {
  return isZombieTrack(item?.track || item?.item);
}
