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

/**
 * Las TRES divisiones de un lanzamiento (v=165): álbum, EP o single.
 *
 * Spotify da dos (`album_type`), y por eso hasta v=164 los chips de
 * #discover-artists eran «Todo / Solo álbumes / Solo singles»: el EP —que
 * Spotify marca como 'single'— quedaba mezclado entre los singles de una
 * pista, que son cientos. Ian encontró así un EP de Justin Bieber que no
 * habría visto nunca.
 *
 * El corte es el MISMO `EP_MIN_TRACKS` de arriba, no uno nuevo.
 *
 * ⚠️ Los recopilatorios cuentan como álbum: son un disco entero, y ponerlos en
 * su propia división habría hecho un cuarto chip para un puñado de fichas.
 *
 * @param {{type?: string, album_type?: string, total?: number, total_tracks?: number}} al
 * @returns {'album'|'ep'|'single'}
 */
export function releaseKind(al) {
  const tipo = al?.type || al?.album_type || '';
  if (tipo === 'album' || tipo === 'compilation') return 'album';
  const total = Number(al?.total ?? al?.total_tracks) || 0;
  return esEPoAlbum(total) ? 'ep' : 'single';
}
