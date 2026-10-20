// La cuenta de `#puertas` (v=308, tanda 56): por qué tema entraste a cada
// artista, si sigue siendo tu top y cuánto tardaste en escuchar otro suyo.
//
// Módulo PURO: sin DOM, sin red, sin IndexedDB. Recibe `totals` y `artists` de
// `loadArtistTracks()` y arma una fila por artista.
//
// El pipeline emite el DATO CRUDO (la regla de v=146) y acá se decide:
//   · `totals[a][6]` = [nombre, trackId] del tema de entrada (la primera play
//     válida del artista; a igualdad de `ts`, el menor trackId) y `[5]` su día;
//   · `totals[a][7]` = el día de la primera play válida de OTRO tema (otro
//     `songKey`), o null si nunca sonó otro.
// Los dos pipelines (`gen-stats.py` y `history-processor.js`) los emiten igual:
// ver `tests/puertas-pipeline.test.mjs`.
//
// 🔴 El universo es `universo()` de `mapa-paises.js`, IMPORTADO y sin copiar (10
// minutos o más, por minutos y a igualdad por nombre): una regla escrita dos
// veces diverge (v=219).
//
// 🔴 «Sigue siendo el top» compara por `songKey` y no por id: un remaster o la
// versión del álbum de la entrada ES la entrada. El top es el primero de
// `artists[a]`, el mismo que enseña la ficha de artista (más plays; a igualdad,
// más minutos).
//
// 🔴 Los días se cuentan sobre las cadenas `YYYY-MM-DD` (días de calendario UTC,
// como todo el pipeline) con `Date.UTC` de las partes. Nunca con la hora local:
// `new Date("2020-03-10").getDate()` da 9 en Buenos Aires. El día se enseña con
// `fmtDia()`, ningún formateador nuevo.
//
// SIN marca de «puede ser de antes de tu historial» para las entradas de la
// primera semana del export: Ian dijo el 15/10/2026 que antes de 2018 no usaba
// esta cuenta. Es una premisa SUYA, no un dato medido (el export no dice cuándo
// se creó la cuenta). Ver `fonoteca-migracion/PENDIENTES.md`.

import { universo } from './mapa-paises.js?v=320';
import { songKey } from './song-identity.js?v=320';
import { fmtDia } from './fecha.js?v=320';

export const POR_PAGINA = 100;

/** Días de calendario entre dos `YYYY-MM-DD` (b − a), o null si falta alguno. */
export function diasEntre(a, b) {
  if (!a || !b) return null;
  const utc = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(b) - utc(a)) / 86400000);
}

/** «el mismo día» · «1 día» · «40 días» · «solo un tema» (null). Números en es-ES. */
export function textoHasta(dias) {
  if (dias === null || dias === undefined) return 'solo un tema';
  if (dias === 0) return 'el mismo día';
  return `${dias.toLocaleString('es-ES')} ${dias === 1 ? 'día' : 'días'}`;
}

/**
 * Las filas, en el orden de `universo()`. Si algún artista de `totals` no trae
 * el tema de entrada (un historial importado antes de v=308: `totals` de seis
 * campos), devuelve `{ sinEntrada: true, filas: null }` y la vista pide volver a
 * importar: ni una lista vacía ni una con huecos.
 *
 * @param {object} totals   `totals` de `loadArtistTracks()`
 * @param {object} artists  `artists` (los seis temas top de cada artista)
 * @returns {{ sinEntrada: boolean, filas: Array|null }}
 */
export function armarPuertas(totals, artists) {
  const todos = Object.values(totals || {});
  if (todos.some((t) => !Array.isArray(t) || t.length < 8)) return { sinEntrada: true, filas: null };
  const filas = universo(totals, artists).map(({ nombre, minutos }) => {
    const t = totals[nombre];
    const [tema, temaId] = Array.isArray(t[6]) ? t[6] : [null, null];
    const top = artists?.[nombre]?.[0]?.[0] ?? null;
    const sigue = top === null || tema === null ? null : songKey(tema, nombre) === songKey(top, nombre);
    const dias = diasEntre(t[5], t[7]);
    return {
      nombre, minutos, tema, temaId,
      dia: t[5], diaTexto: fmtDia(t[5]),
      sigue, top,
      dias, hasta: textoHasta(dias),
    };
  });
  return { sinEntrada: false, filas };
}
