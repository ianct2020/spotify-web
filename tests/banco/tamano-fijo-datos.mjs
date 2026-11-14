// Los datos del banco `tamano-fijo` (tanda 130, v=367). TODO INVENTADO: el repo es público.
//
//   · un usuario que NO es el owner, con un historial local (BYOH) sembrado en IndexedDB, para que `#skips` y
//     `#zeroplays` pinten su grilla sin pedir nada a la red: los me gusta (`all_liked_tracks`), los saltos
//     (`local_<uid>_history_skip`, formato v4) y las reproducciones (`local_<uid>_history_plays`);
//   · las tarjetas mezclan nombre corto y largo, con y sin `.sc-meta-sub` (sin disco y sin fecha) y, en `#zeroplays`,
//     con y sin la etiqueta de plays cortas. Son 100 por vista: la lista incremental pinta de a 80, así que la segunda
//     tanda llega al bajar. Las tarjetas «peores» (etiqueta + segunda línea + nombre largo) van TAMBIÉN en la segunda
//     tanda: el alto no puede depender de qué tanda ya está pintada;
//   · los tres nombres del pill (≈ 15, ≈ 30 y ≈ 70 caracteres).

export const UID = 't130-banco-uid';
export const N = 100;
const L = (n, f) => Array.from({ length: n }, (_, i) => f(i));
export const id22 = (i, p = 'x') => (p + String(i).padStart(21, '0')).slice(0, 22);
const envolver = (value) => ({ value, storedAt: 1_760_000_000_000, expiry: null });

export const NOMBRES_PILL = {
  corto: 'Tema corto t130',                                                          // 15
  medio: 'Un tema inventado para la t130',                                           // 30
  largo: 'Un nombre de tema inventado larguísimo para la t130 que no entra nunca', // 70
};

const LARGO = (i) => `Un nombre de tema inventado larguísimo que no entra en la tarjeta ${i}`;
// El patrón de cada tarjeta: nombre largo una de cada dos, sin segunda línea una de cada tres, con etiqueta (solo
// `#zeroplays`) una de cada cuatro. Así hay de todo en las primeras doce y en cada tanda.
export const rasgos = (i) => ({ largo: i % 2 === 1, sinSub: i % 3 === 2, etiqueta: i % 4 === 1 });

function pista(vista, i) {
  const r = rasgos(i);
  const id = id22(i, vista === 'skips' ? 's' : 'z');
  return {
    id, uri: `spotify:track:${id}`,
    name: r.largo ? LARGO(i) : `Tema ${i}`,
    artists: [{ id: id22(i % 7, 'a'), name: `Banda inventada ${i % 7}` }],
    album: { id: id22(i, 'b'), name: r.sinSub ? '' : `Disco inventado ${i}`, images: [] },
    duration_ms: 200_000,
  };
}

/** Los me gusta: 100 de `#skips` y 100 de `#zeroplays`, con fecha (sin fecha en los que no llevan segunda línea). */
export function likes() {
  const out = [];
  for (const vista of ['skips', 'zero']) {
    for (let i = 0; i < N; i++) {
      const t = pista(vista, i);
      // `#zeroplays` ordena por fecha de like ascendente: la fecha sube con `i`, así que el orden es el de `i`.
      const fecha = rasgos(i).sinSub ? null : new Date(Date.UTC(2020, 0, 1 + i)).toISOString();
      out.push({ added_at: fecha, track: t });
    }
  }
  return out;
}

/** Los saltos (v4): `[ok, skip, fwd_ms[], close_ms[], gid]`. 1 de 10 bien = 90 %; los de `#zeroplays` no están. */
export function saltos() {
  const tracks = {};
  for (let i = 0; i < N; i++) tracks[id22(i, 's')] = [1, 9, L(9, () => 5_000), [], undefined];
  return { version: 4, tracks };
}

/** Las reproducciones: los de `#skips` sonaron (10 plays); los de `#zeroplays`, nunca, o solo plays cortas. */
export function reproducciones() {
  const tracks = {};
  for (let i = 0; i < N; i++) tracks[id22(i, 's')] = [10, 2000];
  for (let i = 0; i < N; i++) if (rasgos(i).etiqueta) tracks[id22(i, 'z')] = [1 + (i % 3), 12, 'p'];
  return { version: 6, tracks, albums: [] };
}

export function sembrado() {
  return [
    ['all_liked_tracks', envolver(likes())],
    [`local_${UID}_history_skip`, envolver(saltos())],
    [`local_${UID}_history_plays`, envolver(reproducciones())],
  ];
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
