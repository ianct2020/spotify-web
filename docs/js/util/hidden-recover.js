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
//
// Por eso devuelven `{ uri, motivo }` y no una uri suelta: cuando no se puede,
// el POR QUÉ es la mitad útil de la respuesta. Medido en los ocultos reales de
// Ian el 2026-09-05, los dos motivos que aparecen de verdad son «el álbum no
// existe con ese nombre» y «existe, pero su artista principal no es el que puso
// la clave» — el segundo es un agujero aparte, anotado en `PENDIENTES.md`.

import { spotifyFetch } from '../api.js?v=207';
import { albumKey } from './album-key.js?v=207';
import { limpiaParaQuery } from './track-match.js?v=207';

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
 * dar la misma clave con SU artista principal, que es lo que `keyOfTrack` va a
 * leer de la playlist: `t.album.name` + `t.artists[0].name`.
 *
 * ⚠️ Por eso se piden las 50 pistas y se recorren todas, no las primeras. En un
 * disco con colaboraciones las primeras pistas pueden estar acreditadas a otro
 * artista y la única que sirve estar en la mitad: con `limit=5` «Michael: Songs
 * From The Motion Picture» daba un fallo que parecía «el álbum no existe».
 *
 * Se busca dos veces: con el filtro de artista y, si no aparece nada, solo por
 * nombre. Aflojar la QUERY no afloja nada, porque el candidato se acepta o se
 * rechaza por la clave recalculada, no por cómo se lo encontró.
 *
 * @returns {Promise<{uri: string|null, motivo: string|null}>}
 */
export async function recuperarUriDeAlbumKey(key) {
  const partes = partirClaveDeAlbum(key);
  if (!partes) return { uri: null, motivo: 'la clave no tiene forma de álbum' };

  const queries = [];
  if (partes.artist) queries.push(`album:"${limpiaParaQuery(partes.name)}" artist:"${limpiaParaQuery(partes.artist)}"`);
  queries.push(`album:"${limpiaParaQuery(partes.name)}"`);

  const vistos = new Set();
  const otrosArtistas = new Set();
  const sinRepresentante = new Set();
  let algunCandidato = false;

  for (const q of queries) {
    const r = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=10`);
    for (const al of (r?.albums?.items || [])) {
      if (!al?.id || vistos.has(al.id)) continue;
      vistos.add(al.id);
      algunCandidato = true;

      const artistaAlbum = al?.artists?.[0]?.name || '';
      if (albumKey(al.name || '', artistaAlbum) !== key) {
        // Mismo disco, otro artista principal: el dato que hace falta para
        // entender por qué esta clave no se puede reconciliar nunca.
        if (albumKey(al.name || '', partes.artist) === key) otrosArtistas.add(artistaAlbum);
        continue;
      }

      const tr = await spotifyFetch(`/albums/${al.id}/tracks?limit=50`);
      for (const t of (tr?.items || [])) {
        if (!t?.uri) continue;
        if (albumKey(al.name || '', t.artists?.[0]?.name || '') !== key) continue;
        return { uri: t.uri, motivo: null };
      }
      // Subcaso distinto: la clave del ÁLBUM coincide, pero ninguna de sus
      // pistas está acreditada al mismo artista principal (un disco de remixes
      // firmado por otros). No es «otro artista»: es que no hay ninguna pista
      // que sirva de representante. «USB002 Remixes» de Fred again.., medido.
      sinRepresentante.add(artistaAlbum);
    }
    if (vistos.size) break;
  }

  if (sinRepresentante.size) {
    return {
      uri: null,
      motivo: `el álbum es el correcto, pero ninguna de sus pistas está acreditada a «${[...sinRepresentante].join(' / ')}» como artista principal: no hay ninguna que sirva de representante`,
    };
  }
  if (otrosArtistas.size) {
    return {
      uri: null,
      motivo: `el álbum existe pero su artista principal en Spotify es ${[...otrosArtistas].join(' / ')}, no «${partes.artist}»: al releer la playlist daría otra clave`,
    };
  }
  return { uri: null, motivo: algunCandidato ? 'ningún candidato da la misma clave' : 'Spotify no devuelve ningún álbum con ese nombre' };
}

/**
 * Uri de una pista representativa del artista que corresponde a `key` (el
 * nombre del artista en minúsculas).
 *
 * El filtro es el mismo que ya usa `features/recommendations.js` al ocultar:
 * el `artists[0]` del candidato tiene que ser ESTE artista, porque si no
 * `keyOfTrack` reconstruiría otro nombre al sincronizar.
 *
 * @returns {Promise<{uri: string|null, motivo: string|null}>}
 */
export async function recuperarUriDeArtistaKey(key) {
  const nombre = String(key || '').trim();
  if (!nombre) return { uri: null, motivo: 'la clave está vacía' };

  const q = `artist:"${limpiaParaQuery(nombre)}"`;
  const r = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=20`);
  const items = r?.tracks?.items || [];

  for (const t of items) {
    if (!t?.uri) continue;
    if ((t.artists?.[0]?.name || '').toLowerCase() !== key) continue;
    return { uri: t.uri, motivo: null };
  }
  return {
    uri: null,
    motivo: items.length
      ? 'ninguna de las pistas encontradas tiene a ese artista como principal'
      : 'Spotify no devuelve ninguna pista de ese artista',
  };
}
