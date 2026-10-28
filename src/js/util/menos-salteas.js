// «Las que menos te saltas» (`#menos-salteas`, tanda 90). PURO: sin red, sin
// IndexedDB, sin DOM. La vista (`features/menos-salteas.js`) solo pinta lo que sale
// de acá; lo prueba `tests/menos-salteas.test.mjs`.
//
// La regla, decidida antes de mirar el dato (tanda 90, «bueno hagamos ese entonces»
// de Ian, 25/10):
//   · un SALTO es la definición única de v=291 y una COMPLETA es una `trackdone` que
//     no es salto, las dos contadas desde el 15/10/2022 (antes el export trae
//     `skipped: false` en todas las filas). Las cuenta el pipeline y vienen en
//     `history-skip-stats` v5: `tracks[id][5]` = completas, `[6]` = saltos;
//   · «el mismo tema» es el `gid` (el `songKey` del pipeline), como `#skips`: se
//     suman todos los ids del grupo;
//   · el porcentaje es saltos / (completas + saltos);
//   · ENTRA el grupo con completas ≥ 10 y porcentaje ≤ la mitad de la línea base
//     (`lineaBaseSaltos()` de `corte-saltos.js`, IMPORTADA: 67,9 % con el export de
//     octubre de 2026).
//
// 🔴 La comparación es en ENTEROS: `2000 × saltos ≤ base×10 × (completas + saltos)`.
// En coma flotante, 14 / 125 × 100 da 11,200000000000001 y un 11,2 % justo se quedaría
// fuera de la mitad de una base de 22,4.

import { lineaBaseSaltos, PRIMER_SKIPPED_TRUE } from './corte-saltos.js';

export const MIN_COMPLETAS = 10;
export const POR_PAGINA = 25;
/** Cuántos campos trae `tracks[id]` desde v5. Uno de menos es un historial importado antes. */
export const CAMPOS_V5 = 7;

/** «15/10/2022», sacado del corte (nunca escrito a mano). */
export function corteTexto() {
  const [a, m, d] = PRIMER_SKIPPED_TRUE.split('-');
  return `${d}/${m}/${a}`;
}

/** true si algún `tracks[id]` no trae los dos campos de v5 (un BYOH viejo). */
export function faltanCampos(tracks) {
  for (const id in tracks || {}) {
    const v = tracks[id];
    if (!Array.isArray(v) || v.length < CAMPOS_V5) return true;
  }
  return false;
}

/** ¿Entra? Completas ≥ 10 y saltos / (completas + saltos) ≤ base / 2, en enteros. */
export function pasaLaVara(completas, saltos, basePct) {
  const total = completas + saltos;
  if (completas < MIN_COMPLETAS || total <= 0) return false;
  const base10 = Math.round(basePct * 10);
  return 2000 * saltos <= base10 * total;
}

/**
 * Agrupa `tracks` por `gid` y suma completas y saltos. Un id sin `gid` es su
 * propio grupo. Devuelve `[{ clave, ids, completas, saltos }]` con los ids
 * ordenados por reproducciones desde el corte (completas + saltos, de mayor a
 * menor) y, a igualdad, por id: el primero es el que representa al grupo.
 */
export function agruparPorGid(tracks) {
  const grupos = new Map();
  for (const id in tracks || {}) {
    const v = tracks[id];
    const gid = v[4];
    const clave = gid === undefined || gid === null ? `id:${id}` : `g${gid}`;
    let g = grupos.get(clave);
    if (!g) { g = { clave, ids: [], completas: 0, saltos: 0 }; grupos.set(clave, g); }
    g.ids.push(id);
    g.completas += Number(v[5]) || 0;
    g.saltos += Number(v[6]) || 0;
  }
  const repro = (id) => (Number(tracks[id][5]) || 0) + (Number(tracks[id][6]) || 0);
  for (const g of grupos.values()) g.ids.sort((a, b) => repro(b) - repro(a) || (a < b ? -1 : a > b ? 1 : 0));
  return [...grupos.values()];
}

/** Por porcentaje de menor a mayor y, a igualdad, por completas de mayor a menor (y por id, para que sea estable). */
export function ordenar(filas) {
  return filas.sort((a, b) =>
    a.saltos * (b.completas + b.saltos) - b.saltos * (a.completas + a.saltos)
    || b.completas - a.completas
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * La lista entera. `skip` es `history-skip-stats` y `years` el `years[]` de
 * `history-stats` (para la línea base).
 *   · `{ estado: 'sin-campos' }`: un historial importado antes de v5;
 *   · `{ estado: 'sin-base' }`: no hay dos años con los saltos anotados;
 *   · `{ estado: 'ok', base, filas }`, con `filas` ya ordenadas.
 */
export function armarMenosSalteas(skip, years) {
  const tracks = skip?.tracks || {};
  if (faltanCampos(tracks)) return { estado: 'sin-campos' };
  const base = lineaBaseSaltos(years);
  if (!base) return { estado: 'sin-base' };
  const filas = agruparPorGid(tracks)
    .filter((g) => pasaLaVara(g.completas, g.saltos, base.pct))
    .map((g) => ({ ...g, id: g.ids[0], pct: g.saltos / (g.completas + g.saltos) * 100 }));
  return { estado: 'ok', base, filas: ordenar(filas) };
}

// ── Los nombres ────────────────────────────────────────────────────────────
// El JSON de saltos no trae nombres (el `meta` se sacó por peso en v=146). Salen,
// en este orden, de lo que ya está en el navegador sin pedir nada:
//   1. la caché de me gusta (`getBestAvailableLikes()`, lo que usa `#skips`);
//   2. los seis temas top de cada artista de `history-artist-tracks`.
// Un grupo que no está en ninguna de las dos se enseña igual, en su sitio de la
// lista, con «Sin nombre en tus datos»: sacarlo cambiaría el ranking en silencio.

/** id → { nombre, artista, track } desde los me gusta (`items` de `getBestAvailableLikes()`). */
export function indiceDeLikes(items) {
  const m = new Map();
  for (const it of items || []) {
    const t = it?.track || it;
    const id = t?.id || (typeof t?.uri === 'string' ? t.uri.split(':').pop() : null);
    if (!id || m.has(id)) continue;
    const artistas = (t.artists || []).map((a) => a?.name || a).filter(Boolean);
    m.set(id, { nombre: t.name || '', artista: artistas.join(', '), track: t });
  }
  return m;
}

/** id → { nombre, artista } desde `history-artist-tracks` (`artists[a]` = [[título, plays, minutos, id], …]). */
export function indiceDeArtistTracks(artists) {
  const m = new Map();
  for (const artista in artists || {}) {
    for (const t of artists[artista] || []) {
      const id = t?.[3];
      if (typeof id === 'string' && !m.has(id)) m.set(id, { nombre: t[0] || '', artista });
    }
  }
  return m;
}

/**
 * Le pone nombre a una fila: el primer id del grupo (en el orden de `ids`) que
 * esté en los me gusta y, si ninguno, el primero que esté en artist-tracks.
 * Devuelve `{ nombre, artista, track, idNombre }`; sin nombre, `nombre: ''`.
 */
export function nombreDeFila(fila, likes, artistTracks) {
  for (const fuente of [likes, artistTracks]) {
    for (const id of fila.ids) {
      const n = fuente?.get(id);
      if (n && n.nombre) return { nombre: n.nombre, artista: n.artista || '', track: n.track || null, idNombre: id };
    }
  }
  return { nombre: '', artista: '', track: null, idNombre: fila.id };
}

// ── Los textos (es-ES) ─────────────────────────────────────────────────────

/** «28,6 %»: un decimal, coma de es-ES y espacio duro antes del signo. */
export function textoPct(pct) {
  return `${Number(pct).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** «N enteras, M saltadas», en singular cuando toca. */
export function textoCuentas(completas, saltos) {
  const n = (x) => Number(x).toLocaleString('es-ES');
  return `${n(completas)} ${completas === 1 ? 'entera' : 'enteras'}, ${n(saltos)} ${saltos === 1 ? 'saltada' : 'saltadas'}`;
}

/** El renglón de arriba. «N %» es tu promedio (la línea base), no su mitad. */
export function textoIntro(base) {
  return `Temas que escuchaste enteros al menos ${MIN_COMPLETAS} veces desde el ${corteTexto()} y que saltas como mucho la mitad que tu promedio (${textoPct(base.pct)}).`;
}
