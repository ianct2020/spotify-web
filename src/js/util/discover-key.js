// La clave de una tarjeta de descubrimiento, en las DOS direcciones.
//
// `#discover-artists` y `#new-releases` guardan dos estados por álbum —oculto y
// escuchado— y el oculto viaja a una playlist privada de Spotify. Una playlist
// solo guarda pistas, así que de cada álbum se sube UNA pista representativa y
// al leerla hay que reconstruir la clave. Son dos funciones distintas, y por eso
// viven juntas en este archivo: **la única forma de que el mecanismo funcione es
// que las dos den exactamente la misma clave para el mismo disco.**
//
// ⚠️ Hasta v=209 no la daban, y ese es el fallo que este archivo existe para no
// repetir. `cardKey` usaba el artista de la TARJETA (el que estás explorando) y
// `keyOfPlaylistTrack` reconstruía con el `artists[0]` de la PISTA. En un disco
// normal los dos son el mismo y no se notaba nada; en una colaboración, un
// soundtrack o un disco de remixes no coinciden, y entonces ese ocultamiento
// **no se podía reconciliar por ningún camino**: se subía —o ni eso— y al
// releerlo daba otra clave, así que la vista no lo veía como oculto y la clave
// vieja se quedaba en el navegador para siempre. Medido en los ocultos reales
// de Ian el 2026-09-05: **7 de 189** (3,7 %).
//
// Desde v=210 las dos direcciones van por lo mismo: **el artista que FIRMA el
// álbum en Spotify**. Es el único dato que las dos puntas tienen y que no
// depende de por dónde llegaste al disco.
//
// ⚠️ NO es la convención de `#wthree`, que va por el artista de la pista en las
// dos direcciones (su índice de álbumes se arma desde las pistas de la playlist
// de picks). Las dos son consistentes consigo mismas; lo que no puede pasar es
// mezclarlas dentro de una misma vista, que es justo lo que pasaba acá.

import { albumKey } from './album-key.js';

/** El artista que firma el álbum en Spotify, o '' si el objeto no lo trae. */
export function albumCreditName(al) {
  return al?.artists?.[0]?.name || '';
}

/**
 * La clave con la que se identifica una tarjeta en los dos stores de la vista.
 *
 * `artistName` (el artista explorado) queda de RESERVA, solo para los álbumes
 * que llegan sin `artists`. Hoy no hay ninguno —`getArtistDiscoCached` lo
 * guarda desde v=121— pero la discografía se cachea 30 días y una entrada vieja
 * no puede cambiar de clave por debajo.
 */
export function cardKey(al, artistName) {
  return albumKey(al?.name || '', albumCreditName(al) || artistName || '');
}

/**
 * La clave como se escribía hasta v=209: con el artista explorado.
 * Solo la usa la migración. Ningún camino nuevo debe escribir con esta forma.
 */
export function cardKeyLegacy(al, artistName) {
  return albumKey(al?.name || '', artistName || '');
}

/**
 * La vuelta: la clave que reconstruye una pista de la playlist de ocultos.
 *
 * Sale de `t.album` —nombre y firma— y no de `t.artists`, que es lo que la
 * rompía. `album.artists` viene entero en los items de la playlist (no se piden
 * con `fields`); `t.artists[0]` queda de reserva por si algún día llegara un
 * item sin él, y en un álbum normal los dos son el mismo.
 */
export function keyOfPlaylistTrack(t) {
  const albumName = t?.album?.name;
  if (!albumName) return null;
  const firma = t.album?.artists?.[0]?.name || t.artists?.[0]?.name || '';
  return albumKey(albumName, firma);
}
