// Los datos del banco `skips-pill` (tanda 138, v=375). TODO INVENTADO: el repo es público.
//
//   · un usuario que NO es el owner, con un historial local (BYOH) sembrado en IndexedDB, para que `#skips` y `#zeroplays`
//     pinten su grilla sin pedir nada a la red (la misma forma que el banco `tamano-fijo`): los me gusta
//     (`all_liked_tracks`), los saltos (`local_<uid>_history_skip`, v4) y las reproducciones (`local_<uid>_history_plays`);
//   · tres temas en `#skips` (1 escucha y 9 saltos a los 5 s: 90 %) y tres en `#zeroplays` (nunca sonaron);
//   · iTunes (`itunesInventado`, por `rutaExterna`) tiene SOLO el primero de `#skips` («con preview»). El segundo («sin
//     preview») no está en iTunes, y Deezer va por JSONP: el resolutor del corredor lo corta, así que la cadena cae al embed
//     de Spotify (con `spotifyId`) o a `null` (sin él, como hasta v=374).

export const UID = 't138-banco-uid';
const id22 = (p, i) => (p + String(i).padStart(3, '0')).padEnd(22, 'x').slice(0, 22);
const envolver = (value) => ({ value, storedAt: 1_760_000_000_000, expiry: null });

export const CON_PREVIEW = { id: id22('skipsPillConPrev', 1), name: 'Tema con preview t138', artista: 'Banda inventada uno' };
export const SIN_PREVIEW = { id: id22('skipsPillSinPrev', 2), name: 'Tema sin preview t138', artista: 'Banda inventada dos' };
const TERCERO = { id: id22('skipsPillTercero', 3), name: 'Otro tema inventado de la t138 con un nombre largo', artista: 'Banda inventada tres' };
export const SKIPS = [CON_PREVIEW, SIN_PREVIEW, TERCERO];
export const ZERO = [1, 2, 3].map((i) => ({ id: id22('skipsPillZero', i), name: `Tema sin escuchar t138 ${i}`, artista: `Banda inventada cero ${i}` }));

function pista(t, i, conInvitada = false) {
  return {
    id: t.id, uri: `spotify:track:${t.id}`, name: t.name,
    artists: [{ id: id22('artPill', i), name: t.artista }, ...(conInvitada ? [{ id: id22('artPillInv', i), name: 'Invitada inventada' }] : [])],
    album: { id: id22('discoPill', i), name: `Disco inventado t138 ${i}`, images: [] },
    duration_ms: 200_000,
  };
}

export function likes() {
  return [
    ...SKIPS.map((t, i) => ({ added_at: new Date(Date.UTC(2021, 0, 1 + i)).toISOString(), track: pista(t, i, i === 2) })),
    ...ZERO.map((t, i) => ({ added_at: new Date(Date.UTC(2020, 0, 1 + i)).toISOString(), track: pista(t, 10 + i) })),
  ];
}

/** Los saltos (v4): `[ok, skip, fwd_ms[], close_ms[], gid]`. */
export function saltos() {
  const tracks = {};
  for (const t of SKIPS) tracks[t.id] = [1, 9, Array(9).fill(5_000), [], undefined];
  return { version: 4, tracks };
}

/** Las reproducciones: los de `#skips` sonaron; los de `#zeroplays`, nunca. */
export function reproducciones() {
  const tracks = {};
  for (const t of SKIPS) tracks[t.id] = [10, 2000];
  return { version: 6, tracks, albums: [] };
}

export function sembrado() {
  return [
    ['all_liked_tracks', envolver(likes())],
    [`local_${UID}_history_skip`, envolver(saltos())],
    [`local_${UID}_history_plays`, envolver(reproducciones())],
  ];
}

/** iTunes de mentira: solo «con preview». */
export function itunesInventado(url) {
  const termino = url.searchParams.get('term') || '';
  if (!termino.includes(CON_PREVIEW.name) || !termino.includes(CON_PREVIEW.artista)) return { results: [] };
  return { resultCount: 1, results: [{ kind: 'song', trackName: CON_PREVIEW.name, artistName: CON_PREVIEW.artista, collectionName: 'Disco inventado t138 0', previewUrl: '/banco/t138-inventado.m4a' }] };
}

// La IndexedDB de la app, a mano (sin la app): la misma forma que la de `idb.js`.
function abrir() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('spotify-tools', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function sembrarIdb(pares) {
  const db = await abrir();
  try {
    await new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite'); const s = t.objectStore('kv');
      s.clear();
      for (const [k, v] of pares) s.put(v, k);
      t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  } finally { db.close(); }
}
