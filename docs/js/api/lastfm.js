import { prefKey, migratePrefKey } from '../storage.js?v=326';
import { idbGet, idbSet, idbSetVarios, idbEntriesEnRango } from '../idb.js?v=326';
import { crearAlmacenGeneros, CLAVE_MIGRADO, filtrarEtiquetasLastfm } from '../util/generos-artista.js?v=326';

const LASTFM_KEY_STORAGE = 'lastfm_api_key';
const LASTFM_USER_STORAGE = 'lastfm_username';
const BASE = 'https://ws.audioscrobbler.com/2.0/';

// API key de Last.fm por defecto, horneada en el código A PROPÓSITO.
//
// ESTE REPO ES PÚBLICO y esta key está expuesta a la vista de cualquiera. Es
// deliberado:
//   - es de SOLO LECTURA: con ella no se puede escribir nada en Last.fm (no
//     hay secret ni sesión de usuario; todos los métodos que usamos —
//     artist.getsimilar, artist.gettoptags, tag.gettopartists,
//     user.gettopartists— son públicos y de consulta);
//   - no está atada a ninguna cuenta con datos privados;
//   - sin ella, la key había que cargarla A MANO EN CADA MÁQUINA Y EN CADA
//     ORIGEN, porque vivía solo en localStorage, que es por origen: la que
//     estaba puesta en GitHub Pages no existía en http://127.0.0.1:5500, y por
//     eso #genre nunca se había podido probar en dev.
//
// Si alguien la quema (Last.fm la revoca por abuso, o empieza a devolver
// errores de cuota), hay que REGENERARLA en https://www.last.fm/api/accounts y
// reemplazar esta constante. Nada más: el ⚙ del Dashboard permite pisarla
// localmente mientras tanto.
const DEFAULT_API_KEY = 'c4568320e1c617eecff919d37a540574';

/** La key que se usa: la propia del usuario si la cargó, si no la del código. */
function getKey() {
  migratePrefKey(LASTFM_KEY_STORAGE);
  return localStorage.getItem(prefKey(LASTFM_KEY_STORAGE)) || DEFAULT_API_KEY || null;
}

/** true si se está usando la del código y no una cargada a mano. */
function isDefaultKey() {
  return !localStorage.getItem(prefKey(LASTFM_KEY_STORAGE)) && !!DEFAULT_API_KEY;
}

function setKey(k) {
  localStorage.setItem(prefKey(LASTFM_KEY_STORAGE), k.trim());
}

/** Borra la key propia: se vuelve a la del código. */
function clearKey() {
  localStorage.removeItem(prefKey(LASTFM_KEY_STORAGE));
}

function hasKey() {
  return !!getKey();
}

function getUsername() {
  migratePrefKey(LASTFM_USER_STORAGE);
  return localStorage.getItem(prefKey(LASTFM_USER_STORAGE));
}

function setUsername(u) {
  localStorage.setItem(prefKey(LASTFM_USER_STORAGE), u.trim());
}

function hasUsername() {
  return !!getUsername();
}

async function lastfmFetch(method, params = {}) {
  const key = getKey();
  if (!key) throw new Error('Last.fm API key no configurada');
  const qs = new URLSearchParams({
    method,
    api_key: key,
    format: 'json',
    ...params,
  });
  const res = await fetch(`${BASE}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message}`);
  if (!res.ok) throw new Error(`Last.fm ${res.status}`);
  return data;
}

async function getSimilarArtists(artistName, limit = 50) {
  const data = await lastfmFetch('artist.getsimilar', { artist: artistName, limit });
  const list = data.similarartists?.artist || [];
  return list.map(a => ({
    name: a.name,
    match: parseFloat(a.match) || 0,
    mbid: a.mbid,
    url: a.url,
    image: (a.image || []).find(i => i.size === 'medium')?.['#text'] || null,
  }));
}

async function getArtistTopTracks(artistName, limit = 20) {
  const data = await lastfmFetch('artist.gettoptracks', { artist: artistName, limit });
  const list = data.toptracks?.track || [];
  return list.map(t => ({
    name: t.name,
    artist: t.artist?.name || artistName,
    playcount: parseInt(t.playcount) || 0,
    listeners: parseInt(t.listeners) || 0,
  }));
}

async function getTopArtistsByTag(tag, limit = 50) {
  const data = await lastfmFetch('tag.gettopartists', { tag, limit });
  const list = data.topartists?.artist || [];
  return list.map(a => ({
    name: a.name,
    mbid: a.mbid,
    url: a.url,
    image: (a.image || []).find(i => i.size === 'medium')?.['#text'] || null,
  }));
}

async function getArtistTopTags(artistName) {
  const data = await lastfmFetch('artist.gettoptags', { artist: artistName, autocorrect: 1 });
  const list = data.toptags?.tag || [];
  // v=313: la regla del `count >= 5` vive en `util/generos-artista.js` (la usa también el
  // escaneo de `#generos`); lo que devuelve esta función no cambió.
  return filtrarEtiquetasLastfm(list);
}

async function getSimilarTags(tag) {
  const data = await lastfmFetch('tag.getsimilar', { tag });
  const list = data.similartags?.tag || [];
  return list.map(t => ({ name: t.name, url: t.url }));
}

async function getUserTopArtists(username, period = '6month', limit = 30) {
  const data = await lastfmFetch('user.gettopartists', { user: username, period, limit });
  const list = data.topartists?.artist || [];
  return list.map(a => ({
    name: a.name,
    playcount: parseInt(a.playcount) || 0,
    rank: parseInt(a['@attr']?.rank) || 0,
  }));
}

// ── Las etiquetas de género por artista (v=312, tanda 60) ─────────────────────
//
// Hasta v=311: un blob en `localStorage` con TTL de 30 días al leer. Ahora: IndexedDB,
// una clave por artista y por usuario, sin caducidad, lo que contestó cada fuente por
// separado y la decisión al leer (ver `util/generos-artista.js`). Los lectores siguen
// siendo sincrónicos: `cargarEtiquetas(uid)` trae una vez todo el prefijo del usuario
// a un `Map` y `getCachedTags`/`setCachedTags`/`mergeCachedTags` trabajan sobre él.
//
// El blob viejo NO se borra (si hay que volver atrás, sigue ahí): se lee una sola vez,
// para migrarlo, y nada más lo escribe salvo `importTagsCache` (que no usa nadie).
const TAGS_CACHE_KEY = 'lastfm_artist_tags_cache';

function loadTagsCache() {
  try {
    return JSON.parse(localStorage.getItem(TAGS_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveTagsCache(cache) {
  try {
    localStorage.setItem(TAGS_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('No se pudo guardar caché de etiquetas:', e.message);
  }
}

const etiquetas = crearAlmacenGeneros({
  leerRango: idbEntriesEnRango,
  escribir: idbSet,
  escribirVarios: idbSetVarios,
  leerMarca: () => idbGet(CLAVE_MIGRADO),
  leerBlob: loadTagsCache,
});

// Hay que llamarla (con el uid de `getCurrentUserId()`) antes de leer o escribir.
// La segunda vez, con el mismo uid, no lee nada.
function cargarEtiquetas(uid) {
  return etiquetas.cargar(uid);
}

function getCachedTags(artistName) {
  return etiquetas.leer(artistName);
}

// La fuente es el tercer argumento (v=312); sin él, Last.fm, que es quien llamaba a
// esta función para guardar su respuesta entera. Devuelve la promesa de la escritura.
// v=313: un cuarto argumento opcional, campos de más para el registro de esa fuente (el
// escaneo de `#generos` guarda ahí el `artista` que devolvió Last.fm).
function setCachedTags(artistName, tags, fuente = 'lastfm', extra = null) {
  return etiquetas.guardar(artistName, tags, fuente, extra);
}

// v=313: lo que contestó cada fuente por ese artista, sin decidir nada (o `null`).
function registroEtiquetas(artistName) {
  return etiquetas.registro(artistName);
}

// Hasta v=311 mezclaba DENTRO de la entrada; desde v=312 guarda lo que contestó la
// fuente y la mezcla se hace al leer (`decidirEtiquetas`). Sin fuente, stats.fm, que
// es quien la llama sin decir nada más.
function mergeCachedTags(artistName, incomingTags, fuente = 'statsfm') {
  return etiquetas.guardar(artistName, incomingTags, fuente);
}

// Cuántos artistas tienen etiquetas guardadas (alguna fuente contestó, aunque sea `[]`).
function contarEtiquetasGuardadas() {
  return etiquetas.contar();
}

// El `tags.entries` del archivo de `exportAllData`, con el formato de siempre.
async function exportarEtiquetas(uid) {
  await etiquetas.cargar(uid);
  return etiquetas.exportar();
}

async function importarEtiquetas(uid, entries) {
  await etiquetas.cargar(uid);
  return etiquetas.importar(entries);
}

function importTagsCache(parsed, { mode = 'merge' } = {}) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido: no es JSON.');
  const entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : parsed;
  const incoming = Object.entries(entries).filter(([k, v]) =>
    typeof k === 'string' && v && Array.isArray(v.tags)
  );
  if (incoming.length === 0) throw new Error('No se encontraron entradas válidas en el archivo.');

  const current = mode === 'replace' ? {} : loadTagsCache();
  let added = 0;
  let updated = 0;
  const now = Date.now();
  for (const [key, entry] of incoming) {
    const at = typeof entry.at === 'number' ? entry.at : now;
    const tags = entry.tags.filter(t => t && typeof t.name === 'string');
    if (current[key]) updated++;
    else added++;
    current[key] = { tags, at };
  }
  saveTagsCache(current);
  return { added, updated, total: incoming.length };
}

export {
  getKey,
  isDefaultKey,
  setKey,
  clearKey,
  hasKey,
  getUsername,
  setUsername,
  hasUsername,
  lastfmFetch,
  getSimilarArtists,
  getArtistTopTracks,
  getTopArtistsByTag,
  getArtistTopTags,
  getSimilarTags,
  getUserTopArtists,
  getCachedTags,
  setCachedTags,
  mergeCachedTags,
  importTagsCache,
  cargarEtiquetas,
  registroEtiquetas,
  contarEtiquetasGuardadas,
  exportarEtiquetas,
  importarEtiquetas,
};
