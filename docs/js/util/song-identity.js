// Identidad de tema: ¿estos dos ids de Spotify son la MISMA canción?
//
// Spotify le da un id distinto al single, al del álbum, al remaster, al remix y
// al que tiene un invitado. "Skips crónicos" cruzaba likes contra el historial
// POR ID, así que los `trackdone` se acumulaban en un id y los skips en otro:
// «A Different Way» aparecía al 86 % (6 skips de 7) mirando solo el id de
// «(with Lauv)», cuando sumando el del DEVAULT Remix es 10 de 31 — 32 %.
//
// Decisión de Ian (2026-08-16): un remix ES el mismo tema, y lo mismo vale si
// participa alguien más. La idea de fondo es que en Liked Songs va a haber una
// sola versión de cada canción; esto es el paso previo.
//
// Reusa normText() de util/track-match.js (la normalización que ya existía para
// matchear previews) y le agrega UNA sola cosa: tirar la cola de remix/versión,
// que normText no toca — su EDITION_TAIL cubre "- 2011 Remaster" y "- Radio
// Edit" pero no "- DEVAULT Remix".
//
// ⚠️ scripts/gen-stats.py tiene el port exacto de esto (song_key). Los dos
// tienen que dar la misma clave o el historial importado a mano (BYOH)
// agruparía distinto que el horneado del repo.

import { normText } from './track-match.js?v=166';

// Cola de versión: "Tema - X Remix", "Tema - Sped Up Version", "Tema - Acoustic".
// Pide un guion separador, así que no se come un título que simplemente
// contenga la palabra ("Remix" a secas, o "Radio Mix Tape").
const REMIX_TAIL =
  /\s*[-–—]\s*.*\b(remix|version|edit|mix|rework|flip|bootleg|instrumental|acoustic)\b.*$/i;

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Clave estable "nombre||artista" para agrupar ids del mismo tema.
// Se aplana ANTES de cortar la cola para que "Versión" caiga igual que
// "Version" (la regex es ASCII).
export function songKey(name, artist) {
  const flat = stripDiacritics(name).toLowerCase();
  return `${normText(flat.replace(REMIX_TAIL, ''))}||${normText(artist)}`;
}

// ── Claves candidatas para cruzar el TÍTULO DE UN SINGLE contra temas ya
//    escuchados (v=165) ──────────────────────────────────────────────────────
//
// `songKey` cubre las dos formas normales de escribir una versión:
//   - entre paréntesis  → «Timeless (Remix)»      (las tira `normText`)
//   - detrás de un guion → «Timeless - DEVAULT Remix» (las tira `REMIX_TAIL`)
//
// Lo que NO cubre es la tercera, que es justo la que se le colaba a
// #discover-artists: el agregado pegado al final sin ningún separador —
// «Timeless Sped Up», «Not Like Us Slowed», «Die For You Acoustic». Sin guion
// ni paréntesis, `songKey` los deja enteros y no matchean con el tema del
// álbum.
//
// ⚠️ `songKey` NO se toca: está portada a Python en `scripts/gen-stats.py` y
// verificada contra 3.853 pares reales. Esto es una capa de ARRIBA, y solo la
// usa el cruce de los filtros de descubrimiento.
//
// Devuelve VARIAS claves y no una porque el nombre del remixero va delante de
// la palabra («Timeless DEVAULT Remix»): sin separador no hay forma de saber
// dónde termina el título, así que se prueban también los prefijos más cortos.
// El recorte se corta en 2 tokens: con uno solo, «One More Time VIP» podría
// matchear un «One» cualquiera del mismo artista, y un falso positivo acá es
// SILENCIOSO (desaparece un lanzamiento y nadie se entera).

// Palabras que pueden formar parte de la cola de versión.
const COLA = new Set([
  'remix', 'rmx', 'sped', 'up', 'slowed', 'reverb', 'nightcore',
  'acoustic', 'acustico', 'acustica', 'unplugged', 'live', 'vivo', 'directo',
  'edit', 'radio', 'extended', 'instrumental', 'acapella', 'cappella',
  'version', 'mix', 'rework', 'flip', 'bootleg', 'demo', 'reprise', 'vip',
  'club', 'dub', 'remaster', 'remastered', 'deluxe', 'mono', 'stereo',
  'clean', 'explicit', 'original', 'single', 'album', 'the', 'and', 'a', 'de',
  'en', 'y', 'x',
]);

// De esas, las que por sí solas dicen «esto es otra versión del mismo tema».
const COLA_NUCLEO = new Set([
  'remix', 'rmx', 'sped', 'slowed', 'reverb', 'nightcore', 'acoustic',
  'acustico', 'acustica', 'unplugged', 'edit', 'instrumental', 'acapella',
  'cappella', 'rework', 'flip', 'bootleg', 'reprise', 'vip', 'dub',
  'remaster', 'remastered', 'version', 'mix',
]);

// Las que llevan el nombre de quien la hizo DELANTE: «DEVAULT Remix».
const COLA_CON_AUTOR = new Set([
  'remix', 'rmx', 'mix', 'edit', 'version', 'rework', 'flip', 'bootleg', 'dub', 'vip',
]);

const MIN_TOKENS_BASE = 2;
const MAX_TOKENS_AUTOR = 2;

/**
 * Todas las claves con las que este título podría estar nombrando un tema que
 * ya existe. La primera es siempre `songKey(name, artist)` — o sea que un
 * llamador que solo mire la primera se comporta igual que antes.
 *
 * @returns {string[]} sin repetidos, de la más específica a la más corta
 */
export function songKeysCandidatas(name, artist) {
  const base = songKey(name, artist);
  const out = [base];
  const [titulo, art = ''] = base.split('||');
  let ts = titulo.split(' ').filter(Boolean);
  if (ts.length <= 1) return out;

  // 1) Sacar la cola de versión pegada al final.
  let nucleo = false;
  while (ts.length > 1 && COLA.has(ts[ts.length - 1])) {
    if (COLA_NUCLEO.has(ts[ts.length - 1])) nucleo = true;
    ts = ts.slice(0, -1);
  }
  if (!nucleo || !ts.length) return out;
  const push = (arr) => {
    const k = `${arr.join(' ')}||${art}`;
    if (!out.includes(k)) out.push(k);
  };
  push(ts);

  // 2) Y, si la palabra que cerraba era de las que llevan autor delante, los
  //    prefijos más cortos: el nombre del remixero está DENTRO del título.
  const cerraba = songKeyColaFinal(titulo);
  if (!cerraba) return out;
  for (let i = 1; i <= MAX_TOKENS_AUTOR && ts.length - i >= MIN_TOKENS_BASE; i++) {
    push(ts.slice(0, ts.length - i));
  }
  return out;
}

// La última palabra de cola que aparece al final del título, si es de las que
// llevan el nombre del autor delante.
function songKeyColaFinal(titulo) {
  const ts = titulo.split(' ').filter(Boolean);
  for (let i = ts.length - 1; i >= 0; i--) {
    if (!COLA.has(ts[i])) return false;
    if (COLA_CON_AUTOR.has(ts[i])) return true;
  }
  return false;
}

/**
 * La clave del tema BASE: `songKey` más la cola de versión pegada sin
 * separador. Es `songKeysCandidatas()[1]` cuando esa cola existe, y
 * `songKey()` cuando no. Sirve para AGRUPAR (una clave por tema), mientras que
 * `songKeysCandidatas` sirve para BUSCAR (varias claves, se prueban todas).
 */
export function songKeyBase(name, artist) {
  const cs = songKeysCandidatas(name, artist);
  return cs.length > 1 ? cs[1] : cs[0];
}
