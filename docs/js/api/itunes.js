// Previews de 30s vía iTunes Search API. CORS abierto, sin auth, sin API key.
// El preview es un m4a servido por Apple que arranca en el estribillo — y como
// no pasa por Spotify, NO suma plays en tu historial de reproducción.
// (preview_url de Spotify murió en la migración feb 2026; el embed iframe
// queda como fallback para lo que iTunes no tenga.)

import { pickBestMatch, artistMatches, artistList, preferredQueryArtists } from '../util/track-match.js?v=178';

// v3: la key sube de v2 porque hasta v=141 se comparaba contra UN solo artista
// (el del álbum). En los discos acreditados a un alias —«¥$» = Kanye West + Ty
// Dolla $ign— eso daba miss siempre, y los misses de esta sesión + los hits
// equivocados de antes no sirven para nada con la regla nueva.
const LS_KEY = 'itunes_preview_cache_v3';
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

// Cuántas búsquedas distintas se aceptan por track. Con dos alcanza para el
// caso real (el alias primero, un humano después) sin multiplicar las llamadas
// a Apple en un álbum entero.
const MAX_QUERIES = 2;

// Preview de un track puntual. Devuelve { url, artist, track } o null si no está.
// Solo devuelve el resultado si TÍTULO Y ARTISTA coinciden (util/track-match.js).
// Si iTunes trae otra canción del mismo artista, es un miss: preferimos "sin
// preview" antes que reproducir un tema equivocado.
//
// `artist` puede ser un nombre o la lista entera de artistas del track. Con
// varios: el candidato vale si coincide con CUALQUIERA (la comparación en sí
// no se relajó), y si la primera búsqueda no da nada se reintenta con el
// siguiente nombre — «¥$ CARNIVAL» no devuelve nada útil en iTunes, «Kanye
// West CARNIVAL» sí.
async function findTrackPreview(artist, track) {
  const artists = artistList(artist);
  const c = loadCache();
  const key = `t:${artists.map(norm).filter(Boolean).join('/')}|${norm(track)}`;
  if (c.has(key)) { const h = c.get(key); return { url: h.u, artist: h.a, track: h.t }; }
  if (misses.has(key)) return null;

  const queries = preferredQueryArtists(artists).slice(0, MAX_QUERIES);
  if (!queries.length) queries.push('');

  for (const q of queries) {
    let results;
    try {
      results = await search(`${q} ${track}`.trim(), 8);
    } catch (e) {
      // Red caída o rate limit de Apple. NO es "este tema no está": si se
      // devolviera null, el que llama lo cachearía como resultado. Se lanza
      // marcado para que la cadena de proveedores pueda distinguir las dos
      // cosas (ver `getPreview` en api/preview-providers.js).
      const err = new Error(`iTunes no respondió: ${e.message}`);
      err.proveedorCaido = true;
      throw err;
    }
    const hit = pickBestMatch(
      { name: track, artists },
      results.filter(r => r.previewUrl),
      r => ({ name: r.trackName, artist: r.artistName }),
    );
    if (!hit) continue;

    c.set(key, { u: hit.previewUrl, a: hit.artistName, t: hit.trackName });
    saveCache();
    return { url: hit.previewUrl, artist: hit.artistName, track: hit.trackName };
  }

  misses.add(key);
  return null;
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
  const hit = results.find(r => r.previewUrl && artistMatches(artist, r.artistName));
  if (!hit) { misses.add(key); return null; }

  c.set(key, { u: hit.previewUrl, a: hit.artistName, t: hit.trackName });
  saveCache();
  return { url: hit.previewUrl, artist: hit.artistName, track: hit.trackName };
}

export { findTrackPreview, findArtistTopPreview };
