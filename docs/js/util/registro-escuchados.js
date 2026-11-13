// «¿Este disco ya está en tu registro de escuchados?» — la regla, en UN solo sitio (v=366, tanda 129).
//
// La usan los dos cruces de `#listened` contra la playlist de escuchados:
//   · `computeUnregistered()` («🎧 Sin registrar», los me gusta que no están en el registro);
//   · «📚 Por escuchar» (los álbumes de tu biblioteca de Spotify que no están en el registro).
// Hasta v=365 la regla vivía escrita dentro de `computeUnregistered()`. Escribirla dos veces es como se rompió el resolutor de álbumes
// (v=219): la segunda copia no aprende lo que aprende la primera. Por eso las dos llaman a esto.
//
// PURA: no importa nada. La clave (`albumKey` de `features/listened-shared.js`) la pasa quien llama, para que este archivo cargue en
// Node sin arrastrar `api.js`.
//
// Las señales de «ya está registrado», cualquiera alcanza:
//   · la clave nombre-sin-edición|artista, con el artista del registro o cualquiera de sus `artistAlts` (v=164);
//   · el id de álbum exacto;
//   · cualquier pista suya que ya esté en la playlist (a prueba de nombres raros).
// Lo descartado a mano NO es una señal de registro: es de «Sin registrar» y lo mira ella.

/** El índice del registro (la playlist de escuchados ya agrupada por álbum). */
export function indiceDelRegistro(albums, claveDe) {
  const claves = new Set(), ids = new Set(), uris = new Set();
  for (const a of albums || []) {
    claves.add(claveDe(a.name, a.artist));
    for (const alt of (a.artistAlts || [])) claves.add(claveDe(a.name, alt));
    ids.add(a.id);
    for (const t of (a.tracks || [])) if (t.uri) uris.add(t.uri);
  }
  return { claves, ids, uris };
}

/** ¿Lo que se describe (claves, ids, uris) ya está en el registro? */
export function estaRegistrado(indice, { claves = [], ids = [], uris = [] } = {}) {
  return claves.some((k) => indice.claves.has(k))
    || ids.some((id) => indice.ids.has(id))
    || uris.some((u) => u && indice.uris.has(u));
}

/**
 * Los álbumes de la biblioteca (`getSavedAlbums()`: `[{ added_at, album }]`) que NO están en el registro, del guardado más nuevo al
 * más viejo. Señales: el id del álbum y la clave con CADA artista del álbum. Un id repetido cuenta una vez.
 * Devuelve `[{ addedAt, album }]` con el `album` tal cual vino.
 */
export function pendientesDeBiblioteca(items, indice, claveDe) {
  const vistos = new Set();
  const out = [];
  for (const it of items || []) {
    const album = it?.album;
    if (!album?.id || vistos.has(album.id)) continue;
    vistos.add(album.id);
    const claves = (album.artists || []).map((x) => x?.name).filter(Boolean).map((n) => claveDe(album.name, n));
    if (estaRegistrado(indice, { claves, ids: [album.id] })) continue;
    out.push({ addedAt: it.added_at || '', album });
  }
  out.sort((a, b) => (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0));
  return out;
}

/**
 * Lee la biblioteca con `leer` (`getSavedAlbums`) y devuelve `{ lista }` (lo pendiente) o `{ fallo }` (el error crudo). Nunca convierte
 * un fallo en una lista vacía: si `leer` tira, si no devuelve un array, o si trae elementos y NINGUNO con `album.id` (una lectura rota,
 * la misma regla que el chip «Solo los de tu biblioteca»), es `{ fallo }`. Una biblioteca vacía de verdad (`[]`) es `{ lista: [] }`.
 */
export async function leerPorEscuchar({ leer, indice, claveDe }) {
  let items;
  try {
    items = await leer();
  } catch (e) {
    return { fallo: e };
  }
  if (!Array.isArray(items)) return { fallo: new Error('La lectura de tu biblioteca no devolvió una lista.') };
  if (items.length > 0 && !items.some((it) => it?.album?.id)) {
    return { fallo: new Error(`La lectura de tu biblioteca trajo ${items.length} elementos y ninguno con id de álbum.`) };
  }
  return { lista: pendientesDeBiblioteca(items, indice, claveDe) };
}

export const TEXTO_FALLO_POR_ESCUCHAR = 'No se ha podido leer tu biblioteca de Spotify.';
export const TEXTO_NADA_POR_ESCUCHAR = 'No te queda ningún álbum de tu biblioteca por marcar.';

/** La línea de arriba del modal con `n` pendientes (n > 0). Con 0, `TEXTO_NADA_POR_ESCUCHAR`. */
export function cabeceraPorEscuchar(n) {
  if (!n) return TEXTO_NADA_POR_ESCUCHAR;
  const num = n.toLocaleString('es-ES');
  return n === 1
    ? `${num} álbum de tu biblioteca que todavía no has marcado como escuchado.`
    : `${num} álbumes de tu biblioteca que todavía no has marcado como escuchados.`;
}

/**
 * La pista con la que «Ya lo escuché» registra el disco (una, como los demás «añadir a escuchados»), en este orden:
 *   (a) `me-gusta`: una pista tuya de ese álbum en me gusta (`likesByKey`, el índice que arma `attachLikes()`): 0 peticiones;
 *   (b) `guardada`: la primera de `album.tracks.items` si `/me/albums` la trajo (lo que guardó `getSavedAlbums()`): 0 peticiones;
 *   (c) `tracklist`: la primera de `pedirPistas(album.id)` (`getAlbumTracks`): 1 GET.
 * Tira si ninguna da una uri. Devuelve `{ uri, fuente }`.
 */
export async function elegirPista(album, { likesByKey, claveDe, pedirPistas }) {
  if (likesByKey) {
    for (const e of likesByKey.values()) {
      if (e?.ids?.has?.(album.id)) {
        const uri = (e.tracks || []).find((t) => t?.uri)?.uri;
        if (uri) return { uri, fuente: 'me-gusta' };
      }
    }
    for (const a of (album.artists || [])) {
      const e = a?.name ? likesByKey.get(claveDe(album.name, a.name)) : null;
      const uri = (e?.tracks || []).find((t) => t?.uri)?.uri;
      if (uri) return { uri, fuente: 'me-gusta' };
    }
  }
  const guardada = (album?.tracks?.items || []).find((t) => t?.uri)?.uri;
  if (guardada) return { uri: guardada, fuente: 'guardada' };
  const pistas = await pedirPistas(album.id);
  const uri = (pistas || []).find((t) => t?.uri)?.uri;
  if (uri) return { uri, fuente: 'tracklist' };
  throw new Error(`Spotify no ha devuelto ninguna pista de «${album.name || 'este álbum'}».`);
}

/**
 * «Ya lo escuché»: elige la pista y la añade a la playlist de escuchados (1 POST). Devuelve `{ uri, fuente }` si salió bien y TIRA si
 * algo falló (sin pista, el POST, la red): quien llama no dice «añadido» sin esto.
 */
export async function marcarEscuchado(album, { playlistId, anadir, ...deps }) {
  const pista = await elegirPista(album, deps);
  await anadir(playlistId, [pista.uri]);
  return pista;
}
