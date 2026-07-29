// Previews de 30s vía iTunes Search API. CORS abierto, sin auth, sin API key.
// El preview es un m4a servido por Apple que arranca en el estribillo — y como
// no pasa por Spotify, NO suma plays en tu historial de reproducción.
// (preview_url de Spotify murió en la migración feb 2026; el embed iframe
// queda como fallback para lo que iTunes no tenga.)

const LS_KEY = 'itunes_preview_cache_v1';
const MAX_CACHE = 600;

let cache = null;      // Map clave → {u,a,t} (hit persistido)
let misses = null;     // Set en memoria: no persistimos misses por si Apple lo agrega después

function loadCache() {
  if (cache) return cache;
  misses = new Set();
  try {
    cache = new Map(Object.entries(JSON.parse(localStorage.getItem(LS_KEY)) || {}));
  } catch {
    cache = new Map();
  }
  return cache;
}

function saveCache() {
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch { /* storage lleno: el cache en memoria alcanza */ }
}

// Normaliza para comparar: sin acentos, sin (feat. X) ni [Remaster], solo alfanumérico
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function search(term, limit) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  return (await res.json()).results || [];
}

function matches(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// Preview de un track puntual. Devuelve { url, artist, track } o null si no está.
async function findTrackPreview(artist, track) {
  const c = loadCache();
  const key = `t:${norm(artist)}|${norm(track)}`;
  if (c.has(key)) { const h = c.get(key); return { url: h.u, artist: h.a, track: h.t }; }
  if (misses.has(key)) return null;

  let results;
  try {
    results = await search(`${artist} ${track}`, 5);
  } catch {
    return null; // red caída o rate limit: no cachear, reintentable
  }
  const na = norm(artist), nt = norm(track);
  const hit = results.find(r => r.previewUrl && matches(norm(r.artistName), na) && matches(norm(r.trackName), nt))
    || results.find(r => r.previewUrl && matches(norm(r.artistName), na));
  if (!hit) { misses.add(key); return null; }

  c.set(key, { u: hit.previewUrl, a: hit.artistName, t: hit.trackName });
  saveCache();
  return { url: hit.previewUrl, artist: hit.artistName, track: hit.trackName };
}

// Tema más popular de un artista (para hover-play sobre el nombre del artista).
// iTunes ordena por relevancia: buscando solo el artista, lo primero que
// devuelve con match de nombre es su hit.
async function findArtistTopPreview(artist) {
  const c = loadCache();
  const key = `a:${norm(artist)}`;
  if (c.has(key)) { const h = c.get(key); return { url: h.u, artist: h.a, track: h.t }; }
  if (misses.has(key)) return null;

  let results;
  try {
    results = await search(artist, 10);
  } catch {
    return null;
  }
  const na = norm(artist);
  const hit = results.find(r => r.previewUrl && matches(norm(r.artistName), na));
  if (!hit) { misses.add(key); return null; }

  c.set(key, { u: hit.previewUrl, a: hit.artistName, t: hit.trackName });
  saveCache();
  return { url: hit.previewUrl, artist: hit.artistName, track: hit.trackName };
}

export { findTrackPreview, findArtistTopPreview };
