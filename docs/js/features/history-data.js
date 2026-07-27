// Loader compartido de los agregados del Extended Streaming History.
// Ambos JSONs se generan con scripts/gen-stats.py y viven en src/data/.

import { idbGetCached, idbSetCached } from '../idb.js?v=75';

const STATS_VERSION = 2;
const PLAYS_VERSION = 2; // ahora incluye entries "partial" para tracks con solo plays <30s
const LISTENED_VERSION = 2;
const STATS_KEY = `history_stats_v${STATS_VERSION}`;
const PLAYS_KEY = `history_track_plays_v${PLAYS_VERSION}`;
const LISTENED_KEY = `history_listened_albums_v${LISTENED_VERSION}`;
const TTL_MIN = 30 * 24 * 60;

let statsMem = null;
let playsMem = null;
let listenedMem = null;

async function loadHistoryStats() {
  if (statsMem) return statsMem;
  try {
    const cached = await idbGetCached(STATS_KEY);
    if (cached && typeof cached === 'object') { statsMem = cached; return statsMem; }
  } catch { /* ignora */ }
  try {
    const url = new URL(`../../data/history-stats.json?v=${STATS_VERSION}`, import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    statsMem = await res.json();
    try { await idbSetCached(STATS_KEY, statsMem, TTL_MIN); } catch { /* ignora */ }
  } catch (e) {
    console.warn('No se pudo cargar history-stats:', e.message);
    statsMem = null;
  }
  return statsMem;
}

async function loadTrackPlays() {
  if (playsMem) return playsMem;
  try {
    const cached = await idbGetCached(PLAYS_KEY);
    if (cached && cached.tracks) { playsMem = cached; return playsMem; }
  } catch { /* ignora */ }
  try {
    const url = new URL(`../../data/history-track-plays.json?v=${PLAYS_VERSION}`, import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    playsMem = await res.json();
    try { await idbSetCached(PLAYS_KEY, playsMem, TTL_MIN); } catch { /* ignora */ }
  } catch (e) {
    console.warn('No se pudo cargar history-track-plays:', e.message);
    playsMem = null;
  }
  return playsMem;
}

async function loadListenedAlbums() {
  if (listenedMem) return listenedMem;
  try {
    const cached = await idbGetCached(LISTENED_KEY);
    if (cached && cached.years) { listenedMem = cached; return listenedMem; }
  } catch { /* ignora */ }
  try {
    const url = new URL(`../../data/history-listened-albums.json?v=${LISTENED_VERSION}`, import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    listenedMem = await res.json();
    try { await idbSetCached(LISTENED_KEY, listenedMem, TTL_MIN); } catch { /* ignora */ }
  } catch (e) {
    console.warn('No se pudo cargar history-listened-albums:', e.message);
    listenedMem = null;
  }
  return listenedMem;
}

function trackIdOf(uri) {
  return (uri || '').startsWith('spotify:track:') ? uri.slice(14) : null;
}

// Devuelve [plays, segundos] o [plays, segundos, "p"] (partial) o null.
function playsFor(uri, index) {
  if (!index || !index.tracks) return null;
  const id = trackIdOf(uri);
  if (!id) return null;
  return index.tracks[id] || null;
}

export { loadHistoryStats, loadTrackPlays, loadListenedAlbums, playsFor, trackIdOf };
