// Identidad de una canción y guarda del último ejemplar.
//
// Vive fuera de `features/versions.js` por una razón concreta: es la lógica que
// decide si dos me gusta son «la misma canción», y de ella depende un botón que
// BORRA. Tiene que poder probarse sin navegador, sin token y sin gastar me gusta.
// Ver tests/versions-guard.test.mjs.

// Marcadores que hacen que sean OTRA canción (los preservamos en la clave):
// reprise, acoustic, live, remix, demo, instrumental, sped up, slowed, unplugged,
// piano version, orchestral, karaoke, extended, edit (a veces cambia). Podés
// tener el original y la versión live en likes sin que Fonoteca los agrupe.
const VERSION_MARKERS = /\b(reprise|acoustic|acústic[ao]|live|en vivo|remix|demo|instrumental|sped up|slowed|reverb|unplugged|piano version|orchestral|karaoke|extended|extended mix|edit|edición extendida|reworked|reimagined|rerecorded|re-?record|taylor'?s version)\b/i;
// Marcadores de EDICIÓN (los sacamos: es la misma grabación):
// remaster, deluxe, bonus, anniversary, mono, stereo, radio edit, album version,
// single version, y años sueltos (- 2011).
const EDITION_STRIP = /\s*[-–—:(\[]\s*(remaster(ed)?|deluxe|bonus track|anniversary|mono|stereo|radio edit|album version|single version|explicit|clean|from ".+"|from the [a-z ]+|expanded edition|expanded)\b.*$/i;
const YEAR_STRIP = /\s*[-–—]\s*(19|20)\d{2}\s*(remaster(ed)?|version|mix|edit)?\s*$/i;
const PAREN_YEAR = /\s*\((19|20)\d{2}\s*(remaster(ed)?|version|mix|edit)?\)\s*$/i;

function normalizeName(name) {
  if (!name) return '';
  let out = name.toLowerCase().trim();
  out = out.replace(EDITION_STRIP, '');
  out = out.replace(PAREN_YEAR, '');
  out = out.replace(YEAR_STRIP, '');
  // Marcadores de versión los preservo, pero afuera del paréntesis los mantengo
  // como sufijo canónico para no depender de puntuación.
  const versionTags = [];
  out = out.replace(/[\(\[]([^\)\]]+)[\)\]]/g, (_, inside) => {
    const m = inside.match(VERSION_MARKERS);
    if (m) { versionTags.push(m[0].toLowerCase()); return ''; }
    return ''; // otros paréntesis (featuring, prod. by, etc.) los tiramos igual
  });
  // También matcheo el marcador si vino sin paréntesis: "Song - Live"
  const dashMatch = out.match(new RegExp('\\s*[-–—]\\s*(' + VERSION_MARKERS.source.slice(2, -2) + ')\\s*$', 'i'));
  if (dashMatch) {
    versionTags.push(dashMatch[1].toLowerCase());
    out = out.replace(dashMatch[0], '');
  }
  out = out.replace(/\s+/g, ' ').trim();
  const tags = [...new Set(versionTags.map(t => t.replace(/\s+/g, '')))].sort();
  return tags.length ? `${out}#${tags.join(',')}` : out;
}

function normalizeKey(track) {
  const name = normalizeName(track.name);
  const artist = (track.artists?.[0]?.name || '').toLowerCase().trim();
  return `${artist}|||${name}`;
}

function esFantasma(track) {
  return !(track?.name || '').trim();
}

/**
 * GUARDA DURA: nunca borrar el último ejemplar.
 *
 * De los 539 me gusta que faltaban el 2026-08-28, 416 tenían otra versión viva
 * —ese es el trabajo del dedup y está bien— pero **123 no tenían ninguna**. Un
 * dedup que borra el último ejemplar no es un dedup: es una pérdida.
 *
 * El chequeo que ya existía en la vista (exigir que el cluster tenga al menos
 * una marcada con «quedarme») NO alcanza, porque razona por CLUSTER. Si dos
 * pistas distintas caen en el mismo cluster por un fallo de normalización
 * —exactamente lo que pasaba con los fantasmas antes de v=153, que normalizaban
 * todos a `|||` y parecían versiones del mismo tema— el cluster tiene su
 * marcada, el chequeo viejo pasa, y aun así se borra la única copia de una
 * canción que no tenía nada que ver.
 *
 * Este guarda razona por CANCIÓN: para cada pista que se va a borrar, después
 * del borrado tiene que quedar al menos una copia viva con su misma clave.
 *
 * Aborta el LOTE ENTERO a propósito — no «borra las que se puede»: si el
 * conjunto llegó hasta acá con una violación adentro, algo de lo que lo armó
 * está mal y hay que mirarlo, no absorberlo.
 *
 * Una pista sin metadatos no se puede proteger (no hay identidad que comparar),
 * así que tampoco se borra nunca.
 *
 * @param {Array<{track:object}>} toRemove  items que se van a borrar
 * @param {Map<string, Set<string>>} libraryByKey  clave → ids vivos, TODA la biblioteca
 * @returns {Array<{track:object, motivo:string}>}  vacío = se puede borrar
 */
export function guardaUltimoEjemplar(toRemove, libraryByKey) {
  const idsABorrar = new Set(toRemove.map(item => item.track.id));
  const violaciones = [];
  for (const item of toRemove) {
    const track = item.track;
    const key = normalizeKey(track);
    if (esFantasma(track) || !key || key === '|||') {
      violaciones.push({ track, motivo: 'sin metadatos, no hay identidad que comparar' });
      continue;
    }
    const copias = libraryByKey.get(key);
    if (!copias || copias.size === 0) {
      violaciones.push({ track, motivo: 'no figura en el análisis actual (re-analiza antes de borrar)' });
      continue;
    }
    const sobreviven = [...copias].filter(id => !idsABorrar.has(id));
    if (sobreviven.length === 0) {
      violaciones.push({ track, motivo: 'el borrado la dejaría sin ninguna copia viva' });
    }
  }
  return violaciones;
}

/** Arma el índice clave → ids vivos a partir de los likes crudos. */
export function indexarBiblioteca(likes) {
  const idx = new Map();
  for (const item of likes) {
    if (!item?.track?.id) continue;
    if (esFantasma(item.track)) continue;
    const key = normalizeKey(item.track);
    if (!idx.has(key)) idx.set(key, new Set());
    idx.get(key).add(item.track.id);
  }
  return idx;
}

export { normalizeName, normalizeKey, esFantasma, VERSION_MARKERS };
