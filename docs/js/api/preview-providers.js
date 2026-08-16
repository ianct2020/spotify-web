// Cadena de proveedores de preview: iTunes → Deezer → Spotify embed.
// - iTunes Search: preview m4a 30s, CORS abierto, sin key. Cache en itunes.js.
// - Deezer: preview mp3 30s, público sin key, PERO NO tiene CORS abierto
//   (probado 2026-08-02: header access-control-allow-origin vacío). Usamos
//   JSONP (`callback=…`), que Deezer soporta oficialmente.
// - Spotify embed iframe: no es audio directo — es un iframe visual. Solo
//   si tenemos el spotifyId del track. Es fallback puro para no dejar el
//   "sin preview" cuando ni iTunes ni Deezer tienen nada.
//
// API: getPreview({ name, artist, spotifyId? }) → { url, provider, type, label }
//   con provider ∈ 'itunes' | 'deezer' | 'spotify-embed', type ∈ 'audio' | 'embed'.
// Devuelve null si ningún proveedor sirvió.
//
// Cache: guardamos QUÉ proveedor sirvió cada track (localStorage
// `preview_provider_map_v1`). En un miss, el proveedor negativo se re-intenta
// pasado el TTL. Los URLs de audio los cachea cada proveedor por su cuenta
// (itunes.js ya lo hace; Deezer usa el suyo interno más abajo).

import { findTrackPreview } from './itunes.js?v=145';
import { pickBestMatch, artistMatches, artistList, preferredQueryArtists } from '../util/track-match.js?v=145';

// v3: las keys suben porque hasta v=141 se comparaba contra UN solo artista (el
// del álbum) y en los discos con alias —«¥$»— eso cacheaba 'spotify-embed' o
// 'none' para el álbum entero. Con la regla nueva esas entradas son basura.
const PROVIDER_CACHE_KEY = 'preview_provider_map_v3';
const PROVIDER_CACHE_MAX = 800;
const NEG_TTL = 3 * 24 * 60 * 60 * 1000;      // 3 días para reintentar "sin preview"
const POS_TTL = 30 * 24 * 60 * 60 * 1000;     // 30 días para el proveedor ganador

const DEEZER_URL_CACHE_KEY = 'deezer_preview_url_cache_v3';
const DEEZER_URL_CACHE_MAX = 600;
// Las URLs de Deezer traen `hdnea=exp=…` con TTL de ~30d — dejamos 7d de
// margen y refetcheamos si se pasó.
const DEEZER_URL_TTL = 7 * 24 * 60 * 60 * 1000;

// ── Cache "qué proveedor sirvió" ──

let providerCache = null;
function loadProviderCache() {
  if (providerCache) return providerCache;
  try {
    providerCache = new Map(Object.entries(JSON.parse(localStorage.getItem(PROVIDER_CACHE_KEY)) || {}));
  } catch { providerCache = new Map(); }
  return providerCache;
}
function saveProviderCache() {
  while (providerCache.size > PROVIDER_CACHE_MAX) providerCache.delete(providerCache.keys().next().value);
  try { localStorage.setItem(PROVIDER_CACHE_KEY, JSON.stringify(Object.fromEntries(providerCache))); } catch { /* full */ }
}
function providerFor(key) {
  const c = loadProviderCache();
  const hit = c.get(key);
  if (!hit) return null;
  const age = Date.now() - (hit.t || 0);
  const ttl = hit.p === 'none' ? NEG_TTL : POS_TTL;
  if (age > ttl) { c.delete(key); return null; }
  return hit.p;
}
function setProvider(key, provider) {
  const c = loadProviderCache();
  c.set(key, { p: provider, t: Date.now() });
  saveProviderCache();
}

// ── Deezer: URL cache + JSONP search ──

let deezerCache = null;
function loadDeezerCache() {
  if (deezerCache) return deezerCache;
  try {
    deezerCache = new Map(Object.entries(JSON.parse(localStorage.getItem(DEEZER_URL_CACHE_KEY)) || {}));
  } catch { deezerCache = new Map(); }
  return deezerCache;
}
function saveDeezerCache() {
  while (deezerCache.size > DEEZER_URL_CACHE_MAX) deezerCache.delete(deezerCache.keys().next().value);
  try { localStorage.setItem(DEEZER_URL_CACHE_KEY, JSON.stringify(Object.fromEntries(deezerCache))); } catch { /* full */ }
}
function deezerCachedUrl(key) {
  const c = loadDeezerCache();
  const hit = c.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > DEEZER_URL_TTL) { c.delete(key); return null; }
  return hit;
}
function setDeezerCached(key, entry) {
  const c = loadDeezerCache();
  c.set(key, { ...entry, t: Date.now() });
  saveDeezerCache();
}

function deezerSearchJsonp(query, limit = 1) {
  return new Promise((resolve, reject) => {
    const cb = '_dz_cb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let done = false;
    const timeout = setTimeout(() => finish(new Error('deezer timeout'), null), 6000);
    function finish(err, data) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try { delete window[cb]; } catch { window[cb] = undefined; }
      script.remove();
      if (err) reject(err); else resolve(data);
    }
    window[cb] = (data) => finish(null, data);
    script.onerror = () => finish(new Error('deezer script error'), null);
    script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}&output=jsonp&callback=${cb}`;
    document.body.appendChild(script);
  });
}

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Igual que iTunes: el candidato tiene que coincidir en TÍTULO Y ARTISTA
// (util/track-match.js), y con varios artistas alcanza con que pase uno. Si no,
// devolvemos null y la cadena sigue de largo. Hasta 2 búsquedas: el alias del
// álbum («¥$») no encuentra nada en Deezer, el nombre real sí.
const DEEZER_MAX_QUERIES = 2;

async function tryDeezer(name, artist) {
  const artists = artistList(artist);
  const cacheKey = `d:${artists.map(norm).filter(Boolean).join('/')}|${norm(name)}`;
  const cached = deezerCachedUrl(cacheKey);
  if (cached) return { url: cached.u, artist: cached.a, track: cached.n };

  const queries = preferredQueryArtists(artists).slice(0, DEEZER_MAX_QUERIES);
  if (!queries.length) queries.push('');
  const fallbackArtist = artists[0] || '';

  for (const q of queries) {
    let data;
    try { data = await deezerSearchJsonp(`${q} ${name}`.trim(), 8); }
    catch { return null; }
    const items = (data?.data || []).filter(r => r.preview);
    const hit = pickBestMatch(
      { name, artists },
      items,
      r => ({ name: r.title, artist: r.artist?.name }),
    );
    if (!hit || !hit.preview) continue;
    setDeezerCached(cacheKey, { u: hit.preview, a: hit.artist?.name || fallbackArtist, n: hit.title || name });
    return { url: hit.preview, artist: hit.artist?.name || fallbackArtist, track: hit.title || name };
  }
  return null;
}

// ── Spotify embed iframe ──
// Es "visual only" — el iframe reproduce por su cuenta con su propio UI de
// Spotify. No es audio directo que podamos meter en <audio>. Lo devolvemos
// como type:'embed' y preview-player.js lo mete en el pill como iframe.
function spotifyEmbed(spotifyId, name, artist) {
  return {
    url: `https://open.spotify.com/embed/track/${spotifyId}`,
    provider: 'spotify-embed',
    type: 'embed',
    label: `${name || ''}${artist ? ' — ' + artist : ''}`,
    trackName: name,
    trackArtist: artist,
  };
}

// ── API pública ──

// getPreview({ name, artist, artists?, spotifyId? }) → resultado o null.
// `artist` puede ser un nombre o un array, y `artists` la lista entera del
// track (los dos se juntan). Con varios, el match vale si pasa CUALQUIERA:
// sin eso, un álbum acreditado a un alias («¥$») no matchea en ningún
// proveedor y se va entero al embed de Spotify, que no puede autoarrancar.
//
// Estrategia:
//   1. Si hay cache "provider": ir directo a ese proveedor (menos llamadas).
//   2. Si no: intentar iTunes → Deezer → embed. Guardar el ganador (o 'none').
async function getPreview({ name, artist, artists, spotifyId } = {}) {
  const lista = artistList({ artist, artists });
  if (!name || !lista.length) return null;
  const key = `p:${lista.map(norm).filter(Boolean).join('/')}|${norm(name)}${spotifyId ? '|' + spotifyId : ''}`;
  // El pill muestra SIEMPRE lo que pidió el usuario, nunca el título que
  // devolvió el proveedor: si alguna vez volvemos a servir algo distinto, se
  // nota al toque en vez de disimularse.
  const label = `${name} — ${lista[0]}`;

  const cached = providerFor(key);
  if (cached === 'none') return null;

  if (cached === 'itunes' || !cached) {
    const it = await findTrackPreview(lista, name);
    if (it) {
      setProvider(key, 'itunes');
      return { url: it.url, provider: 'itunes', type: 'audio', label, trackName: name, trackArtist: lista[0] };
    }
    if (cached === 'itunes') {
      // Estaba cacheado como iTunes pero ahora falla — dejamos que caigan
      // los siguientes proveedores y actualizamos el cache según ganen.
    }
  }

  if (cached === 'deezer' || !cached) {
    const dz = await tryDeezer(name, lista);
    if (dz) {
      setProvider(key, 'deezer');
      return { url: dz.url, provider: 'deezer', type: 'audio', label, trackName: name, trackArtist: lista[0] };
    }
  }

  if ((cached === 'spotify-embed' || !cached) && spotifyId) {
    setProvider(key, 'spotify-embed');
    return spotifyEmbed(spotifyId, name, lista[0]);
  }

  setProvider(key, 'none');
  return null;
}

// Preview del hit del artista (para hover-play sobre el nombre del artista):
// iTunes con búsqueda solo del artista suele devolver su tema más conocido.
// Fallback: la primera canción de la búsqueda en Deezer.
async function getArtistTopPreview(artist) {
  if (!artist) return null;
  const key = `a:${norm(artist)}`;
  const cached = providerFor(key);
  if (cached === 'none') return null;

  if (cached === 'itunes' || !cached) {
    const { findArtistTopPreview } = await import('./itunes.js');
    const it = await findArtistTopPreview(artist);
    if (it) {
      setProvider(key, 'itunes');
      return { url: it.url, provider: 'itunes', type: 'audio', label: `${it.track} — ${it.artist}`, trackName: it.track, trackArtist: it.artist };
    }
  }

  if (cached === 'deezer' || !cached) {
    try {
      const data = await deezerSearchJsonp(artist, 3);
      const hit = (data?.data || []).find(r => r.preview && artistMatches(artist, r.artist?.name));
      if (hit) {
        setProvider(key, 'deezer');
        return { url: hit.preview, provider: 'deezer', type: 'audio', label: `${hit.title} — ${hit.artist?.name}`, trackName: hit.title, trackArtist: hit.artist?.name };
      }
    } catch { /* noop */ }
  }

  setProvider(key, 'none');
  return null;
}

export { getPreview, getArtistTopPreview };
