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

import { normText } from './track-match.js';

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
