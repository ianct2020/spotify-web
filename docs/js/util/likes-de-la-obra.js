// Tus me gusta de esta obra: UNA regla para la ficha de álbum y la tarjeta de #listened (v=371, tanda 134).
//
// El bug: Ian abría desde #listened la ficha de un disco, la ficha decía «0 de N pistas en tus me gusta» y la tarjeta del
// mismo disco decía «♥ K» con K > 0. Eran el mismo número calculado con DOS reglas:
//   · la ficha (`likesInAlbum` + `trackNameKey` de `features/album-card.js`) juntaba ediciones con `util/album-key.js`, que
//     saca «(Deluxe Edition)» pero no «Disco Deluxe», y cruzaba pistas por el nombre sin paréntesis, que no junta
//     «Tema - Remastered 2011» con «Tema»;
//   · la tarjeta (`attachLikes` de `features/listened.js`) juntaba con la `albumKey` de `listened-shared.js`, que borra
//     «deluxe»/«edition»/«version» en cualquier posición, y contaba nombres distintos con `norm`, que no junta un remaster.
//
// Esta es la única regla. Pura: sin red, sin DOM, sin IndexedDB. ⚠️ No escribas otra copia del cruce (la regla de v=219).
//
// QUÉ LIKES SON «DE ESTA OBRA». Los de este disco o de otra edición del mismo disco, por cualquiera de estas cinco:
//   1. el mismo id de álbum;
//   2. la misma tapa (`coverId`);
//   3. la misma `albumKey(nombre, artista principal)`;
//   4. la misma `albumKey(nombre, '')` y el artista del like entre los del disco (`artistMatches`), o el disco sin artista;
//   5. la misma `albumKey(baseDeEdicion(nombre), '')` de los dos lados y `artistMatches` (aquí el artista se exige siempre).
// Las cuatro primeras son las de la ficha hasta v=370; la quinta es la que junta «Disco Deluxe» con «Disco». `baseDeEdicion`
// solo saca colas cuyas palabras están TODAS en su lista: «(LP2)», «II» o «÷» siguen separados de sus hermanos.
//
// QUÉ PISTAS DEL TRACKLIST CUENTAN COMO «EN TUS ME GUSTA».
//   (a) su id está en tus me gusta; o
//   (b) es la MISMA CANCIÓN que un like de esta obra: la misma identidad (abajo).
//
// LA IDENTIDAD DE UNA CANCIÓN: `songKey(nombre, artista principal)` + los marcadores de `VERSION_MARKERS` del nombre CRUDO.
//   · `songKey` no se toca (está portada a Python en `gen-stats.py`). Junta «Tema - Remastered 2011», «Tema (Bonus Track)» y
//     «Tema»… pero también «Tema - Live» y «Tema - Acoustic» (las tiran `REMIX_TAIL` y la `EDITION_TAIL` de `normText`).
//   · Por eso va el marcador: `VERSION_MARKERS` (`util/versions-guard.js`) tiene remix, live, acoustic, en vivo, sped up,
//     slowed, instrumental, karaoke, taylor's version, extended… y NO tiene remaster, deluxe ni bonus. Dos nombres son la misma
//     canción si tienen la misma `songKey` y EL MISMO conjunto de marcadores: un remaster cuenta, un en vivo no.
//   · `tokensDeVersion` (`util/track-match.js`) no sirve aquí: cuenta «remaster» como versión.
//   · Con la misma identidad se deduplica la tarjeta y se calcula J, así que el invariante se cumple por construcción:
//       ♥ de la tarjeta = canciones distintas del tracklist que cuentan + J.
//
// No filtra `isJunkTrack`: si lo hiciera un lado y el otro no, las dos pantallas volverían a contar distinto.

import { albumKey, coverId } from './album-key.js?v=377';
import { baseDeEdicion } from './edition-suffix.js?v=377';
import { artistMatches } from './track-match.js?v=377';
import { songKey } from './song-identity.js?v=377';
import { VERSION_MARKERS } from './versions-guard.js?v=377';

const MARCADORES = new RegExp(VERSION_MARKERS.source, 'gi');

/** Los marcadores de versión del nombre crudo, en minúsculas, ordenados y sin repetir. */
export function marcadoresDeVersion(nombre) {
  const s = String(nombre || '').toLowerCase().replace(/[’‘]/g, "'");
  const vistos = new Set();
  for (const m of s.matchAll(MARCADORES)) vistos.add(m[0].replace(/\s+/g, ' '));
  return [...vistos].sort();
}

/** «La misma canción»: `songKey` con el artista principal, y sus marcadores de versión. */
export function identidadDeCancion(nombre, artista) {
  return `${songKey(nombre, artista)}#${marcadoresDeVersion(nombre).join('+')}`;
}

const nombreDeArtista = (x) => String(x?.name ?? x ?? '').trim();

/**
 * Los me gusta de la caché, ya con todo lo que la regla mira, e indexados. Se arma UNA vez por lista de likes.
 * `likes` es la forma de la caché (`[{ added_at, track }]`) o pistas sueltas.
 */
export function indexarLikes(likes) {
  const items = [];
  const ids = new Set();
  const porAlbumId = new Map(), porTapa = new Map(), porNombre = new Map(), porBase = new Map();
  const meter = (mapa, k, it) => { if (!k) return; let l = mapa.get(k); if (!l) mapa.set(k, (l = [])); l.push(it); };
  for (const entrada of Array.isArray(likes) ? likes : []) {
    const t = entrada?.track || entrada;
    if (!t || !t.name) continue;
    const alb = t.album || {};
    const artistas = [];
    const vistos = new Set();
    for (const x of [...(t.artists || []), ...(alb.artists || [])]) {
      const n = nombreDeArtista(x);
      if (!n || vistos.has(n.toLowerCase())) continue;
      vistos.add(n.toLowerCase());
      artistas.push(n);
    }
    const artista = artistas[0] || '';
    const it = {
      id: t.id || null,
      uri: t.uri || (t.id ? `spotify:track:${t.id}` : null),
      name: t.name,
      artist: artista,
      artists: artistas,
      // Solo los artistas de la PISTA, como los guardaba la tarjeta: «A, B».
      artistasDePista: (t.artists || []).map(nombreDeArtista).filter(Boolean).join(', '),
      album: alb.name || '',
      albumId: alb.id || null,
      images: Array.isArray(alb.images) ? alb.images : [],
      trackNumber: t.track_number || 0,
      identidad: identidadDeCancion(t.name, artista),
      _clave: albumKey(alb.name || '', artista),
    };
    items.push(it);
    if (it.id) ids.add(it.id);
    meter(porAlbumId, it.albumId, it);
    for (const im of it.images) meter(porTapa, coverId(im?.url), it);
    meter(porNombre, albumKey(it.album, ''), it);
    meter(porBase, albumKey(baseDeEdicion(it.album), ''), it);
  }
  return { items, ids, porAlbumId, porTapa, porNombre, porBase };
}

/**
 * Los likes de esta obra (este disco u otra edición del mismo disco), sin repetir la misma pista.
 * `a` es lo que reciben la ficha y la tarjeta: `{ name, artist, albumId | id, img }`.
 */
export function likesDeLaObra(indice, a) {
  if (!indice || !a) return [];
  const albumId = a.albumId || a.id || null;
  const tapa = coverId(a.img || a.cover || a.image);
  const clave = albumKey(a.name || '', a.artist || '');
  const conArtista = (it) => !!a.artist && artistMatches(it.artists, a.artist);
  const out = [];
  const vistos = new Set();
  const sumar = (it) => {
    const k = it.id || `${it.albumId}|${it.name}|${it.artist}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    out.push(it);
  };
  // 1 y 2: el mismo id de álbum, la misma tapa.
  for (const it of (albumId && indice.porAlbumId.get(albumId)) || []) sumar(it);
  for (const it of (tapa && indice.porTapa.get(tapa)) || []) sumar(it);
  // 3 y 4: el mismo nombre (la clave con el artista principal, o el nombre con un artista en común).
  for (const it of indice.porNombre.get(albumKey(a.name || '', '')) || []) {
    if (it._clave === clave || !a.artist || conArtista(it)) sumar(it);
  }
  // 5: otra edición del mismo disco, con el artista entre los del disco.
  for (const it of indice.porBase.get(albumKey(baseDeEdicion(a.name || ''), '')) || []) {
    if (conArtista(it)) sumar(it);
  }
  return out;
}

/**
 * Las canciones likeadas de esta obra, UNA por identidad (una canción likeada en dos ediciones cuenta una vez). Es lo que
 * cuenta la tarjeta, que no tiene el tracklist. De cada identidad se queda el like de ESTE disco si lo hay.
 */
export function cancionesDeLaObra(indice, a, obra = likesDeLaObra(indice, a)) {
  const albumId = a?.albumId || a?.id || null;
  const porIdentidad = new Map();
  for (const it of obra) {
    const ya = porIdentidad.get(it.identidad);
    if (!ya || (albumId && it.albumId === albumId && ya.albumId !== albumId)) porIdentidad.set(it.identidad, it);
  }
  return [...porIdentidad.values()];
}

/**
 * La ficha con su tracklist. `tracklist`: `[{ id, name, artists: [nombres] }]`, en orden.
 * Devuelve:
 *   · `pistas`: una por pista del tracklist, `{ cuenta: 'a' | 'b' | null, like }` (`like`, el que la hace contar por (b), o
 *     el de su id por (a));
 *   · `n`: cuántas pistas cuentan; `k`: cuántas cuentan SOLO por (b) («están en otra edición»);
 *   · `faltan`: las canciones likeadas de la obra (una por identidad) que no corresponden a ninguna pista del tracklist
 *     («este disco no las tiene»), y `j` = su número;
 *   · `obra`: los likes de la obra, con los que tienen el id de una pista de este tracklist sumados (son de este disco por
 *     definición, aunque el llamador no trajera `albumId`).
 */
export function cruzarConTracklist(indice, a, tracklist) {
  const lista = Array.isArray(tracklist) ? tracklist : [];
  const base = likesDeLaObra(indice, a);
  const idsDelTracklist = new Set(lista.map((t) => t?.id).filter(Boolean));
  const obra = [...base];
  const enObra = new Set(base.map((it) => it.id).filter(Boolean));
  for (const it of indice?.items || []) {
    if (it.id && idsDelTracklist.has(it.id) && !enObra.has(it.id)) { obra.push(it); enObra.add(it.id); }
  }
  const likePorId = new Map();
  for (const it of indice?.items || []) if (it.id && !likePorId.has(it.id)) likePorId.set(it.id, it);
  const likePorIdentidad = new Map();
  for (const it of obra) if (!likePorIdentidad.has(it.identidad)) likePorIdentidad.set(it.identidad, it);

  const identidadesQueCuentan = new Set();
  let n = 0, k = 0;
  const pistas = lista.map((t) => {
    const artista = nombreDeArtista((t?.artists || [])[0]) || a?.artist || '';
    const identidad = identidadDeCancion(t?.name, artista);
    const porA = t?.id && indice?.ids?.has(t.id);
    const likeB = likePorIdentidad.get(identidad) || null;
    const cuenta = porA ? 'a' : (likeB ? 'b' : null);
    if (cuenta) {
      n++;
      if (cuenta === 'b') k++;
      identidadesQueCuentan.add(identidad);
    }
    return { cuenta, identidad, like: porA ? likePorId.get(t.id) : likeB };
  });
  const faltan = cancionesDeLaObra(indice, a, obra).filter((it) => !identidadesQueCuentan.has(it.identidad));
  return { pistas, n, k, j: faltan.length, faltan, obra };
}

/**
 * La línea de debajo del contador, o '' si no hay nada que decir. Texto plano en es-ES.
 *   «K de ellas están en otra edición» · «y J más que este disco no tiene» · solo J: «J canciones que te gustan de este
 *   disco no están en esta edición». Con singular cuando toca.
 */
export function textoOtraEdicion(k, j) {
  const fmt = (x) => Number(x).toLocaleString('es-ES');
  const parteK = k > 0 ? (k === 1 ? '1 de ellas está en otra edición' : `${fmt(k)} de ellas están en otra edición`) : '';
  if (k > 0 && j > 0) return `${parteK} y ${fmt(j)} más que este disco no tiene`;
  if (k > 0) return parteK;
  if (j > 0) {
    return j === 1
      ? '1 canción que te gusta de este disco no está en esta edición'
      : `${fmt(j)} canciones que te gustan de este disco no están en esta edición`;
  }
  return '';
}
