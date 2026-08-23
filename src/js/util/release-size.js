// ¿Este lanzamiento es un single suelto o ya es un EP/álbum?
//
// Spotify **no tiene tipo «EP»**: `album_type` solo vale 'album', 'single' o
// 'compilation', y un EP de 5 temas viene marcado como 'single'. Así que el
// único dato con el que se puede separar es la cantidad de pistas.
//
// El umbral es **4**, y sale de `features/listened.js` (v=127, `releaseKind`),
// donde ya se usaba para partir «Sin registrar» entre álbumes/EPs y singles.
// Vivía suelto ahí adentro; acá queda uno solo para que las dos vistas no se
// vayan separando.
//
// ⚠️ **Si tocás este número, mirá los dos llamadores**: `features/listened.js`
// y el guardado de `features/discover-common.js`. Un lanzamiento de 4 pistas
// que en una vista es EP y en la otra es single se guarda en dos sitios
// distintos según por dónde entres, que es exactamente el tipo de
// incoherencia que este módulo existe para evitar.
export const EP_MIN_TRACKS = 4;

/** ¿Cuenta como EP o álbum (y no como single suelto)? */
export function esEPoAlbum(totalTracks) {
  return (Number(totalTracks) || 0) >= EP_MIN_TRACKS;
}
