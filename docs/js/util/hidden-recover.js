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

// ── Motivos definitivos y motivos transitorios (v=252) ──────────────────────
//
// `hidden-sync.js` reintenta cada clave sin uri una vez por día. Para algunas eso
// no tiene ningún sentido: `3vil reflection||osamason` es un disco que en Spotify
// firma Glokk40Spaz, así que la clave no se va a poder reconciliar nunca por este
// camino. Hasta v=251 se buscaba igual y, peor, se avisaba igual: **20 de las 41
// incidencias del registro de Ian (48,8 %) eran esa única clave**, y Ian se comía
// su toast cada vez que abría la vista. El gasto era despreciable (menos de 1
// request por día, medido); el ruido no, porque empuja fuera del registro —que
// guarda 100— a las incidencias que sí importan.
//
// EL CRITERIO, en una línea: es **definitivo** cuando Spotify ya contestó, trajo
// candidatos, y lo que los descalifica es un dato de SU catálogo que no depende
// de nosotros ni de la red — la acreditación del artista. Buscar mañana da lo
// mismo.
//
// Es **transitorio** todo lo demás, y a propósito: 0 resultados (el catálogo de
// Spotify crece), un error de red, un 429. **Ante la duda, transitorio.**
// Reintentar de más cuesta ~1 request por día; congelar de más es un oculto que
// se queda callado para siempre, que es justo lo que este archivo existe para
// evitar.
//
// ⚠️ El veredicto vale SOLO para las reglas de ESTE archivo. Si cambian —una
// query nueva, un control nuevo, otro `limit`— hay que subir `REGLAS_VERSION`:
// si no, las claves ya congeladas no se vuelven a mirar nunca y un arreglo que
// las destrabaría no llega a probarse. **Ya pasó**: «USB002 Remixes» de Fred
// again.. estuvo atascado en «ninguna de sus pistas está acreditada a…» y lo
// destrabó un cambio de CÓDIGO (`porFirmaDelAlbum`, v=210), no un cambio de
// Spotify. Con la congelación y sin este número, ese arreglo no habría servido.
export const REGLAS_VERSION = 1;

import { spotifyFetch } from '../api.js?v=252';
import { albumKey } from './album-key.js?v=252';
import { limpiaParaQuery } from './track-match.js?v=252';

/**
 * ⚠️ `porFirmaDelAlbum` (v=210). Los dos stores de álbumes NO leen la playlist
 * igual, así que tampoco pueden aceptar el mismo representante:
 *
 *   - `#wthree` reconstruye la clave con el `artists[0]` de la PISTA (su índice
 *     de álbumes se arma igual, desde las pistas de la playlist de picks), así
 *     que la pista representativa tiene que estar acreditada a ese artista.
 *   - `#discover-artists` la reconstruye desde el ÁLBUM (`t.album.artists[0]`,
 *     v=210), que es lo mismo con lo que la escribe: ahí cualquier pista del
 *     álbum correcto sirve, y por eso «USB002 Remixes» —cuyas 50 pistas están
 *     acreditadas a otros— pasa a tener representante.
 *
 * El default es el comportamiento de siempre, el de `#wthree`.
 */

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
export async function recuperarUriDeAlbumKey(key, { porFirmaDelAlbum = false } = {}) {
  const partes = partirClaveDeAlbum(key);
  // Definitivo: una clave mal formada no se arregla esperando.
  if (!partes) return { uri: null, motivo: 'la clave no tiene forma de álbum', definitivo: true, reglas: REGLAS_VERSION };

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
        // Con `porFirmaDelAlbum` la clave de vuelta sale del ÁLBUM, no de la
        // pista: si el álbum ya coincidió, CUALQUIERA de sus pistas sirve de
        // representante. Sin la opción hace falta que la pista misma dé la
        // clave, que es lo que lee el `keyOfTrack` de `#wthree`.
        if (!porFirmaDelAlbum && albumKey(al.name || '', t.artists?.[0]?.name || '') !== key) continue;
        return { uri: t.uri, motivo: null, definitivo: false };
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
      // Acreditación de Spotify: mañana da lo mismo. (Lo que SÍ lo destrabó una
      // vez fue código nuestro, y para eso está `REGLAS_VERSION`.)
      definitivo: true,
      reglas: REGLAS_VERSION,
    };
  }
  if (otrosArtistas.size) {
    return {
      uri: null,
      motivo: `el álbum existe pero su artista principal en Spotify es ${[...otrosArtistas].join(' / ')}, no «${partes.artist}»: al releer la playlist daría otra clave`,
      // El caso `3vil reflection||osamason`. Acreditación de Spotify: definitivo.
      definitivo: true,
      reglas: REGLAS_VERSION,
    };
  }
  // Los dos transitorios de esta función: acá lo que no cuadra es el NOMBRE, no
  // la acreditación, y el catálogo de Spotify crece. Se sigue reintentando.
  return {
    uri: null,
    motivo: algunCandidato ? 'ningún candidato da la misma clave' : 'Spotify no devuelve ningún álbum con ese nombre',
    definitivo: false,
  };
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
  if (!nombre) return { uri: null, motivo: 'la clave está vacía', definitivo: true, reglas: REGLAS_VERSION };

  const q = `artist:"${limpiaParaQuery(nombre)}"`;
  // ⚠️ `limit=10`, no 20: el máximo de `/search` bajó a 10 en la migración de
  // agosto de 2026 (`CONTEXTO-TECNICO.md`), y con 20 la respuesta es
  // «Spotify 400: Invalid limit». Esta función nació en v=205, un mes después
  // del tope, o sea que NUNCA recuperó nada: toda clave de `#recs` sin uri
  // moría en un 400 que encima parecía un fallo pasajero de red. Medido en los
  // ocultos de Ian el 27/09: 3 de las 4 incidencias de `travi$ scott` eran ese
  // 400. El test no lo cazaba porque el doble de `api.js` no validaba el
  // `limit`; ahora sí (`tests/dobles/api-doble.mjs`).
  const r = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=10`);
  const items = r?.tracks?.items || [];

  for (const t of items) {
    if (!t?.uri) continue;
    if ((t.artists?.[0]?.name || '').toLowerCase() !== key) continue;
    return { uri: t.uri, motivo: null, definitivo: false };
  }
  return {
    uri: null,
    motivo: items.length
      ? 'ninguna de las pistas encontradas tiene a ese artista como principal'
      : 'Spotify no devuelve ninguna pista de ese artista',
    // `travi$ scott`: Spotify trajo 7 pistas y las 7 dicen «Travis Scott». La
    // clave la escribió Last.fm con el `$` y se relee con el nombre de Spotify,
    // así que no coinciden nunca. Definitivo. Con 0 items, en cambio, es que
    // Spotify no trajo nada: transitorio.
    definitivo: items.length > 0,
    reglas: REGLAS_VERSION,
  };
}
