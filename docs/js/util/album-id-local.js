// El id de Spotify de un álbum, sacado de los me gusta que ya están en local
// (v=258). Sin red.
//
// Por qué existe: en #wthree los álbumes «Sin picks» no traen `albumId` —sale
// de la playlist de picks, y justamente no tienen ninguno ahí—, así que abrir
// su modal pasaba por `resolveAlbumId()`, o sea por `/search`. Y `/search` es
// la cuota cara de la cuenta (429 en el request 697, horas de bloqueo). Medido
// el 29/09 con clic real sobre producción (v=257): 12 s de spinner, 6 intentos
// de `/search` y «No pude cargar las pistas», sin llegar nunca a
// `/albums/{id}/tracks`. Cada clic, además, gastaba seis peticiones más de la
// cuota que ya estaba agotada.
//
// El dato estaba en casa: la vista esconde por defecto los álbumes sin ningún
// me gusta, así que TODO álbum que se ve en la lista tiene al menos una pista
// en `all_liked_tracks`, y cada pista trae `album.id`. Los diez «Sin picks» de
// Ian daban exactamente un id cada uno.
//
// ⚠️ La clave es la de W-Three: `albumKey(nombre del álbum, artists[0] de la
// PISTA)`, la misma con la que `ensureLikedIndex()` arma `albumKeys` y con la
// que se cruza la lista. No es la de #discover-artists (firma del álbum): ver
// `util/discover-key.js`. Mezclarlas dentro de una vista rompe el cruce.

import { albumKey } from './album-key.js?v=285';

/**
 * @param {Array<{track?:object}>} items  el `items` de getBestAvailableLikes()
 * @returns {Map<string,string>} albumKey → id de Spotify
 *
 * Si una misma clave cae en varios ids (dos ediciones del disco con likes en
 * las dos), gana el id con MÁS pistas likeadas, y a igualdad el primero que
 * apareció. Cualquiera de los dos es un tracklist válido del álbum; el de más
 * likes es el que Ian escucha.
 */
export function indiceIdsDeAlbum(items) {
  const conteo = new Map(); // key → Map<id, n>
  for (const it of (items || [])) {
    const t = it?.track;
    const id = t?.album?.id;
    if (!id || !t.album.name) continue;
    const k = albumKey(t.album.name, t.artists?.[0]?.name || '');
    if (!conteo.has(k)) conteo.set(k, new Map());
    const porId = conteo.get(k);
    porId.set(id, (porId.get(id) || 0) + 1);
  }
  const indice = new Map();
  for (const [k, porId] of conteo) {
    let mejor = null, max = 0;
    for (const [id, n] of porId) if (n > max) { mejor = id; max = n; }
    indice.set(k, mejor);
  }
  return indice;
}

/**
 * El id que ya se sabe sin preguntarle a nadie: el que trae el álbum (sale de
 * la playlist de picks) o, si no, el de los me gusta. `null` si no hay.
 */
export function idLocalDelAlbum(a, indice) {
  if (a?.albumId) return a.albumId;
  if (!indice) return null;
  return indice.get(albumKey(a?.name, a?.artist)) || null;
}
