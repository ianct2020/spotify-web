// Recuperar la uri representativa de una clave de ocultos que se quedó sin ella.
//
// Contexto (v=205): `util/hidden-sync.js` necesita una uri para poder subir una
// clave a la playlist de ocultos. Para tres de los seis stores la clave YA ES el
// id de la pista (`#skips`, `#zero-plays`, `#sin-clasificar`), así que la uri
// sale de la clave sin pedirle nada a nadie. Para los otros tres no:
//
//   - `#wthree` y `#discover-artists` guardan `albumKey(nombre, artista)`
//   - `#recommendations` guarda el nombre del artista en minúsculas
//
// Esas claves son NORMALIZADAS (sin acentos, sin sufijos de edición, "&"→"and"),
// o sea que la clave no se puede des-normalizar de vuelta al nombre real. Lo que
// sí se puede es BUSCARLA y comprobar: se busca por el texto de la clave, se le
// recalcula la clave a cada candidato con la MISMA función que usa `keyOfTrack`
// al leer la playlist, y solo se acepta el que da exactamente la misma clave.
//
// ⚠️ Esa comprobación es el punto entero de este archivo. Un candidato "parecido"
// subiría a la playlist una pista que, al releerla, reconstruiría OTRA clave: el
// oculto seguiría perdido y encima la playlist quedaría sucia. Acá, o coincide
// exacto, o se devuelve null y el que llama tiene que avisar — nunca adivinar.

import { spotifyFetch } from '../api.js?v=205';
import { albumKey } from './album-key.js?v=205';
import { limpiaParaQuery } from './track-match.js?v=205';

/** Las claves de álbum son `nombre||artista` (ver `util/album-key.js`). */
function partirClaveDeAlbum(key) {
  const i = String(key || '').indexOf('||');
  if (i < 0) return null;
  const name = key.slice(0, i).trim();
  const artist = key.slice(i + 2).trim();
  if (!name) return null;
  return { name, artist };
}

/**
 * Uri de una pista representativa del álbum que corresponde a `key`.
 *
 * Dos pasos: `/search` para dar con el álbum (verificando la clave) y
 * `/albums/{id}/tracks` para sacar una pista suya. La pista tiene que volver a
 * dar la misma clave con el artista del ÁLBUM, que es lo que `keyOfTrack` va a
 * leer de la playlist: `t.album.name` + `t.artists[0].name`.
 *
 * @returns {Promise<string|null>} uri, o null si no se puede confirmar
 */
export async function recuperarUriDeAlbumKey(key) {
  const partes = partirClaveDeAlbum(key);
  if (!partes) return null;

  const q = partes.artist
    ? `album:"${limpiaParaQuery(partes.name)}" artist:"${limpiaParaQuery(partes.artist)}"`
    : `album:"${limpiaParaQuery(partes.name)}"`;

  const r = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=10`);
  const candidatos = r?.albums?.items || [];

  for (const al of candidatos) {
    const artistaAlbum = al?.artists?.[0]?.name || '';
    if (!al?.id || albumKey(al.name || '', artistaAlbum) !== key) continue;

    const tr = await spotifyFetch(`/albums/${al.id}/tracks?limit=5`);
    for (const t of (tr?.items || [])) {
      // La pista de la playlist trae el álbum embebido; acá viene suelto, así
      // que se comprueba con los datos con los que se va a releer.
      if (!t?.uri) continue;
      if (albumKey(al.name || '', t.artists?.[0]?.name || artistaAlbum) !== key) continue;
      return t.uri;
    }
  }
  return null;
}

/**
 * Uri de una pista representativa del artista que corresponde a `key` (el
 * nombre del artista en minúsculas).
 *
 * El filtro es el mismo que ya usa `features/recommendations.js` al ocultar:
 * el `artists[0]` del candidato tiene que ser ESTE artista, porque si no
 * `keyOfTrack` reconstruiría otro nombre al sincronizar.
 *
 * @returns {Promise<string|null>} uri, o null si no se puede confirmar
 */
export async function recuperarUriDeArtistaKey(key) {
  const nombre = String(key || '').trim();
  if (!nombre) return null;

  const q = `artist:"${limpiaParaQuery(nombre)}"`;
  const r = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=20`);

  for (const t of (r?.tracks?.items || [])) {
    if (!t?.uri) continue;
    if ((t.artists?.[0]?.name || '').toLowerCase() !== key) continue;
    return t.uri;
  }
  return null;
}
