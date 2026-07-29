// Loader compartido de los agregados del Extended Streaming History.
// Ambos JSONs se generan con scripts/gen-stats.py y viven en src/data/.
//
// GUARD por owner: los JSONs son del dueño de la app (Ian). Si otra persona
// entra con su Spotify, los loaders devuelven null y las features muestran
// un mensaje explicando que este historial es de otro user. Evita mostrar
// los datos personales de Ian al resto de los usuarios.

import { idbGetCached, idbSetCached } from '../idb.js?v=88';
import { getCurrentUserId } from '../api.js?v=88';

const HISTORY_OWNER_ID = 'orhs6wu5ykk7ql80u92ujn74o';

async function isOwner() {
  try { return (await getCurrentUserId()) === HISTORY_OWNER_ID; }
  catch { return false; }
}

const STATS_VERSION = 2;
const PLAYS_VERSION = 2; // ahora incluye entries "partial" para tracks con solo plays <30s
const LISTENED_VERSION = 2;
const SKIP_VERSION = 1;
const STATS_KEY = `history_stats_v${STATS_VERSION}`;
const PLAYS_KEY = `history_track_plays_v${PLAYS_VERSION}`;
const LISTENED_KEY = `history_listened_albums_v${LISTENED_VERSION}`;
const SKIP_KEY = `history_skip_stats_v${SKIP_VERSION}`;
const TTL_MIN = 30 * 24 * 60;

let statsMem = null;
let playsMem = null;
let listenedMem = null;
let skipMem = null;

async function loadHistoryStats() {
  if (statsMem) return statsMem;
  if (!(await isOwner())) return null;
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
  if (!(await isOwner())) return null;
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
  if (!(await isOwner())) return null;
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

async function loadSkipStats() {
  if (skipMem) return skipMem;
  if (!(await isOwner())) return null;
  try {
    const cached = await idbGetCached(SKIP_KEY);
    if (cached && cached.tracks) { skipMem = cached; return skipMem; }
  } catch { /* ignora */ }
  try {
    const url = new URL(`../../data/history-skip-stats.json?v=${SKIP_VERSION}`, import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    skipMem = await res.json();
    try { await idbSetCached(SKIP_KEY, skipMem, TTL_MIN); } catch { /* ignora */ }
  } catch (e) {
    console.warn('No se pudo cargar history-skip-stats:', e.message);
    skipMem = null;
  }
  return skipMem;
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

// HTML listo para pegar en cualquier feature cuando la carga devuelve null
// porque el user logueado no es el dueño. Es la explicación estándar.
function ownerLockedMessage(featureName = 'esta vista') {
  return `<div class="card"><h3 style="margin-bottom:8px">Historial no disponible</h3>
    <p style="color:var(--color-text-secondary);margin:0">
      ${featureName} usa el <strong>Extended Streaming History</strong> del dueño de esta instancia de Fonoteca (Ian).
      Como estás logueado con otra cuenta, no se muestra su historial personal.
      Podés seguir usando el resto de las funciones que trabajan solo con tus likes (Sync Mirror, Dedupe, Versiones, Zombis, Buscar likes, Por artista, Por género, Smart Playlists, etc.).
    </p>
    <p style="color:var(--color-text-secondary);margin:12px 0 10px">
      ¿Querés esto con <strong>tus</strong> datos? Pedile tu historial a Spotify: en la ventana que se abre,
      bajá hasta <strong>«Descargar tus datos»</strong>, marcá <strong>Historial de reproducción ampliado</strong>
      y confirmá. Llega por mail en unos días (Spotify no deja automatizar ese click, hay que tocarlo a mano).
    </p>
    <button class="btn btn-secondary btn-sm" onclick="window.open('https://www.spotify.com/account/privacy/','sp_privacy','width='+Math.round(screen.width*0.67)+',height='+Math.round(screen.height*0.85)+',left='+Math.round(screen.width*0.16))">Abrir Privacidad de Spotify</button>
    </div>`;
}

export { loadHistoryStats, loadTrackPlays, loadListenedAlbums, loadSkipStats, playsFor, trackIdOf, isOwner, HISTORY_OWNER_ID, ownerLockedMessage };
