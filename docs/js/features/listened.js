import { getAllPlaylistItems, getBestAvailableLikes, addTracksToPlaylist, removeTracksFromPlaylist, getAllUserPlaylists } from '../api.js?v=192';
import { esEPoAlbum } from '../util/release-size.js?v=192';
import { idbGetCached, idbSetCached, idbGetTimestamp } from '../idb.js?v=192';
import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js?v=192';
import { showToast } from '../ui/toast.js?v=192';
import { isJunkTrack } from '../util/junk.js?v=192';
import { openModal, closeTop } from '../ui/modal-stack.js?v=192';
import { getListenedPlaylist, groupItemsByAlbum, openListenedAlbumsPicker, albumKey, baseName, norm } from './listened-shared.js?v=192';
import { openAlbumCard } from './album-card.js?v=192';
import { prefKey, migratePrefKey } from '../storage.js?v=192';

const SORT_KEY = 'listened_sort_mode';
const VALID_SORTS = new Set(['recent', 'year-desc', 'year-asc', 'artist-asc', 'likes-desc', 'name-asc']);
const CACHE_TTL_MIN = 24 * 60; // refresca la playlist agrupada solo si pasó más de un día
// v=164: `_v2` porque los álbumes agrupados llevan ahora `artistAlts`, y sin él
// el cruce de «Quizás escuchaste y no registraste» seguiría corriendo con la
// clave vieja hasta que el caché caducara solo.
const cacheKeyFor = id => `listened_grouped_${id}_v2`;
let unregMin = 4; // mín. de canciones en likes para sugerir un álbum como "quizás escuchado sin registrar" (ajustable)
const DISMISS_KEY = 'listened_unreg_dismissed'; // álbumes que el usuario ocultó de "sin registrar"
const DUP_DISMISS_KEY = 'listened_dupes_dismissed'; // grupos que el usuario marcó "no es duplicado"
const QUEUE_PID_KEY = 'listened_queue_playlist_id';   // playlist "para cuando termine los actuales"
const QUEUE_PNAME_KEY = 'listened_queue_playlist_name';
const HISTORY_DISMISS_KEY = 'listened_history_dismissed'; // álbumes del historial ocultados
const HISTORY_VERSION = 2; // subir cuando regenero data/listening-history.json (v2 = con tapas horneadas)
const HISTORY_CACHE_KEY = `history_albums_v${HISTORY_VERSION}`;

let likesByKey = null; // Map albumKey -> { id, ids:Set, name, artist, year, image, tracks:[{name,artists,uri}] }
let historyAlbums = null; // array de { a, ar, u, dt, min, y1, img } del historial de reproducción (data/ committeado)
let historyMin = 5; // mín. de tracks distintos escuchados para sugerir desde el historial
let lastTotalTracks = 0; // para rebuild optimista sin re-bajar la playlist de Spotify
let lastTs = null;

// Álbumes que Ian marcó "no me interesa" para que no vuelvan a aparecer en "sin registrar".
function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(prefKey(DISMISS_KEY)) || '[]')); } catch { return new Set(); }
}
function dismissUnreg(key) {
  const s = getDismissed();
  s.add(key);
  localStorage.setItem(prefKey(DISMISS_KEY), JSON.stringify([...s]));
}
// Idem para grupos de "duplicados" marcados como "no es duplicado" (ej: LP3/II/Vol. son distintos).
function getDismissedDupes() {
  try { return new Set(JSON.parse(localStorage.getItem(prefKey(DUP_DISMISS_KEY)) || '[]')); } catch { return new Set(); }
}
function dismissDupe(key) {
  const s = getDismissedDupes();
  s.add(key);
  localStorage.setItem(prefKey(DUP_DISMISS_KEY), JSON.stringify([...s]));
}
function clearDismissedDupes() {
  localStorage.removeItem(prefKey(DUP_DISMISS_KEY));
}

// Idem para álbumes del historial de reproducción ocultados.
function getDismissedHistory() {
  try { return new Set(JSON.parse(localStorage.getItem(prefKey(HISTORY_DISMISS_KEY)) || '[]')); } catch { return new Set(); }
}
function dismissHistory(key) {
  const s = getDismissedHistory();
  s.add(key);
  localStorage.setItem(prefKey(HISTORY_DISMISS_KEY), JSON.stringify([...s]));
}
// Baja el JSON agregado del historial (una vez), lo cachea en IndexedDB.
// Solo lo bajamos si el user logueado es el dueño (Ian): son sus datos personales.
async function loadHistoryData() {
  if (historyAlbums) return historyAlbums;
  const { isOwner } = await import('./history-data.js');
  if (!(await isOwner())) { historyAlbums = []; return historyAlbums; }
  try {
    const cached = await idbGetCached(HISTORY_CACHE_KEY);
    if (Array.isArray(cached)) { historyAlbums = cached; return historyAlbums; }
  } catch { /* ignora */ }
  try {
    const url = new URL(`../../data/listening-history.json?v=${HISTORY_VERSION}`, import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = await res.json();
    historyAlbums = Array.isArray(doc.albums) ? doc.albums : [];
    try { await idbSetCached(HISTORY_CACHE_KEY, historyAlbums, 30 * 24 * 60); } catch { /* ignora */ }
  } catch (e) {
    console.warn('No se pudo cargar el historial:', e.message);
    historyAlbums = [];
  }
  return historyAlbums;
}

// trackId a partir de una uri "spotify:track:XXXX".
function trackIdOf(uri) {
  return (uri || '').startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : null;
}

// Álbumes que ESCUCHASTE (según el historial: N+ tracks distintos con ≥30s) y NO están registrados.
function computeHistoryUnregistered(min = historyMin) {
  if (!historyAlbums) return [];
  const dismissed = getDismissedHistory();
  const regKeys = new Set(albums.map(a => albumKey(a.name, a.artist)));
  const regUris = new Set();
  for (const a of albums) for (const t of a.tracks) if (t.uri) regUris.add(t.uri);
  const out = [];
  for (const h of historyAlbums) {
    if (h.dt < min) continue; // el JSON viene ordenado por dt desc → podríamos cortar, pero es barato
    const k = albumKey(h.a, h.ar);
    if (dismissed.has(k)) continue;
    if (regKeys.has(k)) continue;
    if (h.u && regUris.has(h.u)) continue;
    out.push({ ...h, key: k });
  }
  out.sort((a, b) => b.dt - a.dt || b.min - a.min);
  return out;
}
// Álbumes con MÁS de un track en la playlist (querés 1 track por álbum). Ordenados por cantidad.
// Cuenta álbumes por género, usando el cache de tags Last.fm (llenado por la feature "Por género").
// Para cada álbum tomamos el top tag del artista principal. Devuelve top N géneros con lista.
function loadArtistTagsCache() {
  try { return JSON.parse(localStorage.getItem('lastfm_artist_tags_cache') || '{}'); }
  catch { return {}; }
}

function topTagOf(cache, artist) {
  if (!artist) return null;
  const entry = cache[artist.toLowerCase()];
  const tags = entry?.tags || [];
  if (!tags.length) return null;
  const sorted = [...tags].sort((a, b) => (b.count || 0) - (a.count || 0));
  const t = sorted[0];
  if (!t?.name) return null;
  return t.name.toLowerCase();
}

function computeGenreDistribution(topN = 15) {
  const cache = loadArtistTagsCache();
  const buckets = new Map();
  let uncached = 0;
  for (const a of albums) {
    const tag = topTagOf(cache, a.artist);
    if (!tag) { uncached++; continue; }
    if (!buckets.has(tag)) buckets.set(tag, []);
    buckets.get(tag).push(a);
  }
  const list = [...buckets.entries()].map(([g, arr]) => ({ genre: g, count: arr.length, albums: arr }));
  list.sort((a, b) => b.count - a.count);
  return { top: list.slice(0, topN), total: list.length, uncached, cached: albums.length - uncached };
}

// Cuenta álbumes registrados por año, usando `addedAt` (cuándo se agregó el primer track del álbum a la playlist).
// Devuelve [{year:'2025', count:N, albums:[...]}, ...] ordenado del más nuevo al más viejo.
// Los álbumes sin addedAt se agrupan en '—' (fallback, no debería pasar en tracks bajados con added_at).
function computeYearCounts() {
  const buckets = new Map();
  for (const a of albums) {
    const y = a.addedAt ? String(new Date(a.addedAt).getFullYear()) : '—';
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y).push(a);
  }
  const out = [...buckets.entries()].map(([year, list]) => ({ year, count: list.length, albums: list }));
  out.sort((a, b) => (a.year === '—' ? 1 : b.year === '—' ? -1 : b.year.localeCompare(a.year)));
  return out;
}

function computeRepeatedAlbums() {
  return albums.filter(a => a.tracks.length > 1).sort((x, y) => y.tracks.length - x.tracks.length);
}
// Actualiza los números de los botones del header sin tener que recargar todo.
function refreshHeaderCounts() {
  const u = document.getElementById('listened-unreg-btn');
  if (u) u.textContent = `🎧 Sin registrar (${computeUnregistered().length})`;
  const d = document.getElementById('listened-dupes-btn');
  if (d) d.textContent = `💿 Duplicados (${computeEditionDupes().length})`;
  const h = document.getElementById('listened-history-btn');
  if (h) h.textContent = `📊 Del historial (${computeHistoryUnregistered().length})`;
  const rp = document.getElementById('listened-repeated-btn');
  if (rp) rp.textContent = `🎵 Repetidos (${computeRepeatedAlbums().length})`;
}
function getSortMode() {
  const v = localStorage.getItem(prefKey(SORT_KEY));
  return VALID_SORTS.has(v) ? v : 'recent';
}
function setSortMode(v) {
  if (VALID_SORTS.has(v)) localStorage.setItem(prefKey(SORT_KEY), v);
}

let albums = [];
let filterText = '';
let playlistInfo = null;

export async function render(container) {
  migratePrefKey(SORT_KEY);
  migratePrefKey(DISMISS_KEY);
  migratePrefKey(DUP_DISMISS_KEY);
  migratePrefKey(HISTORY_DISMISS_KEY);
  migratePrefKey(QUEUE_PID_KEY);
  migratePrefKey(QUEUE_PNAME_KEY);
  migratePrefKey(UNREG_TYPE_KEY);
  albums = [];
  filterText = '';

  container.innerHTML = `
    ${pageHeader({ title: 'Álbumes escuchados' })}
    <div id="listened-content">
      <div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Leyendo configuración...</div></div>
    </div>
  `;

  playlistInfo = getListenedPlaylist();
  if (!playlistInfo) {
    renderNotConfigured();
    return;
  }
  loadAlbums();
}

function renderNotConfigured() {
  const content = document.getElementById('listened-content');
  content.innerHTML = `
    <div class="card" style="max-width:560px">
      <h3 style="margin-bottom:8px">Todavía no configuraste tu playlist</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">
        Elige la playlist que usas como registro de álbumes escuchados. La app la va a agrupar por álbum.
        También puedes configurarla desde la stat card del Dashboard.
      </p>
      <button class="btn btn-primary" id="listened-config-btn">Elegir playlist</button>
    </div>
  `;
  document.getElementById('listened-config-btn').onclick = () => openListenedAlbumsPicker({
    onSelect: () => { playlistInfo = getListenedPlaylist(); loadAlbums(); },
    onClear: () => { playlistInfo = null; renderNotConfigured(); },
  });
}

async function loadAlbums({ force = false } = {}) {
  const content = document.getElementById('listened-content');
  const key = cacheKeyFor(playlistInfo.id);
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">${force ? 'Actualizando' : 'Cargando'} "${escapeHtml(playlistInfo.name)}"...</div></div>`;

  try {
    let totalTracks;
    let cached = null;
    if (!force) {
      try { cached = await idbGetCached(key); } catch { /* ignora */ }
    }

    if (cached && Array.isArray(cached.albums)) {
      albums = cached.albums;
      totalTracks = cached.totalTracks ?? albums.reduce((n, a) => n + a.tracks.length, 0);
    } else {
      const items = await getAllPlaylistItems(playlistInfo.id);
      albums = groupItemsByAlbum(items);
      totalTracks = items.length;
      if (albums.length > 0) {
        try { await idbSetCached(key, { albums, totalTracks }, CACHE_TTL_MIN); } catch (e) { console.warn('cache listened:', e.message); }
      }
    }

    if (albums.length === 0) {
      content.innerHTML = `
        <div class="card" style="max-width:560px">
          <p style="margin-bottom:12px">La playlist <strong>${escapeHtml(playlistInfo.name)}</strong> no tiene tracks con álbum reconocible (${totalTracks.toLocaleString('es-ES')} items).</p>
          <button class="btn btn-secondary" id="listened-change-btn">Cambiar playlist</button>
        </div>
      `;
      document.getElementById('listened-change-btn').onclick = () => openListenedAlbumsPicker({
        onSelect: () => { playlistInfo = getListenedPlaylist(); loadAlbums(); },
        onClear: () => { playlistInfo = null; renderNotConfigured(); },
      });
      return;
    }

    await attachLikes(albums);
    try { await loadHistoryData(); } catch { /* no fatal */ }
    let ts = null;
    try { ts = await idbGetTimestamp(key); } catch { /* ignora */ }
    buildUI(totalTracks, ts);
  } catch (e) {
    content.innerHTML = `
      <div class="card" style="max-width:560px">
        <p style="color:var(--color-error);margin-bottom:6px">Error: ${escapeHtml(e.message)}</p>
        <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">
          Suele ser un bache de conexión o un límite temporal de Spotify. Prueba de nuevo.
        </p>
        <button class="btn btn-primary" id="listened-retry-btn">Reintentar</button>
      </div>
    `;
    document.getElementById('listened-retry-btn').onclick = () => loadAlbums({ force: true });
  }
}

// Rebuild INSTANTÁNEO del estado local (sin spinner ni re-bajar de Spotify) + reguardar cache.
async function persistAndRebuild(totalTracks) {
  lastTotalTracks = totalTracks;
  try { await idbSetCached(cacheKeyFor(playlistInfo.id), { albums, totalTracks }, CACHE_TTL_MIN); } catch { /* ignora */ }
  buildUI(totalTracks, lastTs);
}

// Agrega álbumes al estado local al toque (después Spotify ya los tiene; al 'Actualizar' se reconcilia).
async function addAlbumsLocally(entries) {
  const existing = new Set(albums.map(a => a.id));
  let added = 0;
  for (const e of entries) {
    const id = e.id || (e.uri ? `local:${e.uri}` : null);
    if (!id || existing.has(id)) continue;
    existing.add(id);
    const a = {
      id,
      name: e.name || '(sin nombre)',
      artist: e.artist || '',
      // Los alternativos viajan con el álbum: si no, hasta la próxima
      // relectura de la playlist el cruce volvería a la clave única.
      artistAlts: [...(e.artistAlts || [])],
      year: e.year || '',
      image: e.image || e.cover || null,
      cover: e.cover || e.image || null,
      url: (typeof id === 'string' && !id.includes(':')) ? `https://open.spotify.com/album/${id}` : null,
      tracks: [{ name: '', artists: e.artist || '', uri: e.uri || null }],
      addedAt: Date.now(),
    };
    a.likes = likesByKey?.get(albumKey(a.name, a.artist))?.tracks || [];
    albums.push(a);
    added++;
  }
  await persistAndRebuild(lastTotalTracks + added);
  return added;
}

// Saca del estado local los álbumes indicados (objetos de `albums`), al toque.
async function removeAlbumEntriesLocally(albumObjs) {
  const rm = new Set(albumObjs);
  let removedTracks = 0;
  albums = albums.filter(a => { if (rm.has(a)) { removedTracks += a.tracks.length; return false; } return true; });
  await persistAndRebuild(Math.max(0, lastTotalTracks - removedTracks));
}

// Cruza cada álbum con tus Liked Songs. El conteo tiene que ser EXACTO:
//  1) agrupamos por album.id (un lanzamiento real) — NO por artista, porque dentro de un
//     mismo álbum el artista principal del track cambia con los feats (ej "$ome $exy $ong$ 4 U"),
//     y eso partía el conteo en pedazos.
//  2) después fusionamos deluxe + normal (misma obra) por albumKey, deduplicando por nombre
//     de canción para no contar dos veces el mismo tema.
async function attachLikes(albumList) {
  likesByKey = new Map();
  let items = [];
  try {
    ({ items } = await getBestAvailableLikes());
  } catch (e) {
    console.warn('No se pudieron cargar likes para el cruce:', e.message);
    for (const a of albumList) a.likes = [];
    return;
  }

  // 1) Una entrada por lanzamiento físico (album.id) con TODOS sus tracks likeados.
  const byId = new Map();
  for (const it of items) {
    const t = it.track;
    if (!t?.album?.id) continue;
    if (isJunkTrack(t.name, t.artists?.[0]?.name)) continue;  // v=126
    let e = byId.get(t.album.id);
    if (!e) {
      const imgs = t.album.images || [];
      e = {
        id: t.album.id,
        name: t.album.name || '',
        year: (t.album.release_date || '').slice(0, 4),
        image: imgs.length ? imgs[imgs.length - 1].url : null,
        albumType: t.album.album_type || null,
        totalTracks: t.album.total_tracks || 0,
        tracks: [],
        artistCount: new Map(),
      };
      byId.set(e.id, e);
    }
    e.tracks.push({ name: t.name || '', artists: (t.artists || []).map(a => a.name).join(', '), uri: t.uri || (t.id ? `spotify:track:${t.id}` : null) });
    const pa = t.artists?.[0]?.name || '';
    e.artistCount.set(pa, (e.artistCount.get(pa) || 0) + 1);
  }
  // Artista representativo del álbum = el principal más frecuente entre sus tracks.
  for (const e of byId.values()) {
    let best = '', bestN = -1;
    for (const [name, n] of e.artistCount) if (n > bestN) { best = name; bestN = n; }
    e.artist = best;
    delete e.artistCount;
  }

  // 2) Fusionar lanzamientos que son la misma obra (deluxe + normal → uno), dedup por nombre.
  for (const e of byId.values()) {
    const k = albumKey(e.name, e.artist);
    let m = likesByKey.get(k);
    if (!m) {
      m = { id: e.id, ids: new Set([e.id]), name: e.name, artist: e.artist, year: e.year, image: e.image, albumType: e.albumType, totalTracks: e.totalTracks, tracks: [], artistAlts: new Set(), _repCount: e.tracks.length, _seen: new Set() };
      likesByKey.set(k, m);
    } else {
      m.ids.add(e.id);
      // El lanzamiento con más tracks manda como representativo (suele ser el deluxe/completo).
      if (e.tracks.length > m._repCount) { m.name = e.name; m.artist = e.artist; m.image = e.image || m.image; m.year = e.year || m.year; m.id = e.id; m.albumType = e.albumType; m.totalTracks = e.totalTracks; m._repCount = e.tracks.length; }
    }
    if (e.artist) m.artistAlts.add(e.artist);
    for (const t of e.tracks) {
      const nk = norm(t.name);
      if (m._seen.has(nk)) continue;
      m._seen.add(nk);
      m.tracks.push(t);
      // El primer artista acreditado de cada pista también sirve para cruzar
      // contra el registro: ver el comentario de `artistAlts` en
      // listened-shared.js.
      const primero = String(t.artists || '').split(',')[0].trim();
      if (primero) m.artistAlts.add(primero);
    }
  }
  for (const m of likesByKey.values()) { delete m._repCount; delete m._seen; }

  for (const a of albumList) {
    a.likes = likesByKey.get(albumKey(a.name, a.artist))?.tracks || [];
  }
}

// ── Tipo de lanzamiento (v=127) ──────────────────────────────────────────────
//
// La lista de "sin registrar" mostraba ~2.500 entradas y la enorme mayoría eran
// singles con UN solo like: encontrar un álbum de verdad ahí adentro era
// imposible. Ahora se puede filtrar por tipo.
//
// El dato sale de `album.album_type` de /me/tracks ('album' | 'single' |
// 'compilation'). Spotify no tiene un tipo "EP": los publica como 'single'.
// Por eso un 'single' de 4+ pistas lo contamos como EP y va al grupo de
// álbumes, que es lo que Ian espera ver ahí.
//
// Si album_type viniera vacío (caché vieja de antes del bump a _v2, o un
// lanzamiento raro), caemos a la cantidad de pistas: ≤3 = single.
const UNREG_TYPE_KEY = 'listened_unreg_type_v1';
const VALID_UNREG_TYPES = new Set(['all', 'albums', 'singles']);

// Cascada de señales, de la más fiable a la más pobre:
//   1) album_type de la API. 'single' con 4+ pistas lo tratamos como EP.
//   2) sin album_type pero con total_tracks: ≤3 pistas = single.
//   3) sin ninguno de los dos: la cantidad de canciones que Ian tiene EN LIKES
//      de ese lanzamiento. Es un proxy pobre pero es lo único que queda, y no
//      es descabellado: de un single no se pueden tener 4 likes distintos.
//
// El caso 3 no es teórico. El backup de likes que vive en el repo
// (src/data/user-*.json, el que usa la app cuando no hay sesión ni caché) se
// generó con el slimTrack viejo y NO tiene album_type ni total_tracks. Con
// sesión iniciada los likes vienen de la API y estamos en el caso 1.
// El umbral de EP (4 pistas) vive en util/release-size.js: lo comparte con el
// guardado de #discover-artists / #new-releases, que decide con él si un
// lanzamiento va a la biblioteca o a la playlist de singles.
function releaseKind(e) {
  const t = e?.albumType;
  if (t === 'album' || t === 'compilation') return 'albums';
  if (t === 'single') return esEPoAlbum(e.totalTracks) ? 'albums' : 'singles';
  if (e?.totalTracks) return esEPoAlbum(e.totalTracks) ? 'albums' : 'singles';
  return esEPoAlbum(e?.tracks?.length) ? 'albums' : 'singles';
}

// ¿Estamos adivinando el tipo? Sirve para avisarlo en la interfaz en vez de
// presentar un conteo dudoso como si fuera exacto.
function typeIsGuessed() {
  if (!likesByKey) return false;
  let total = 0, conTipo = 0;
  for (const e of likesByKey.values()) { total++; if (e.albumType) conTipo++; }
  return total > 0 && conTipo / total < 0.5;
}

function getUnregType() {
  const v = localStorage.getItem(prefKey(UNREG_TYPE_KEY));
  return VALID_UNREG_TYPES.has(v) ? v : 'albums';   // default: solo álbumes y EPs
}
function setUnregType(v) {
  if (VALID_UNREG_TYPES.has(v)) localStorage.setItem(prefKey(UNREG_TYPE_KEY), v);
}

// Álbumes de los que tenés muchas canciones en likes pero NO están en tu registro.
// Heurística de "probablemente lo escuchaste completo y no lo agregaste".
// `type` filtra por tipo de lanzamiento: 'all' | 'albums' | 'singles'.
function computeUnregistered(min = unregMin, type = 'all') {
  if (!likesByKey) return [];
  // Excluimos un álbum de las sugerencias si YA está registrado, por lo que sea:
  //  - albumKey (nombre-sin-edición|artista) → matchea deluxe vs normal;
  //  - id de álbum exacto (cualquiera de sus ediciones);
  //  - o si CUALQUIER track suyo ya está en la playlist (a prueba de nombres raros
  //    tipo "$ome $exy $ong$ 4 U", donde el nombre/artista no matchean pero el track sí).
  //  - o si lo ocultaste a mano.
  //  - y, desde v=164, por CUALQUIER combinación de nombre-sin-edición con
  //    cualquiera de los artistas principales vistos a cada lado: el `artist`
  //    del registro sale del álbum y el de los likes sale de las pistas, así
  //    que para un mismo disco no tienen por qué coincidir (ver `artistAlts`).
  const dismissed = getDismissed();
  const registeredKeys = new Set();
  for (const a of albums) {
    registeredKeys.add(albumKey(a.name, a.artist));
    for (const alt of (a.artistAlts || [])) registeredKeys.add(albumKey(a.name, alt));
  }
  const registeredIds = new Set(albums.map(a => a.id));
  const registeredUris = new Set();
  for (const a of albums) for (const t of a.tracks) if (t.uri) registeredUris.add(t.uri);
  const out = [];
  for (const [k, e] of likesByKey) {
    if (dismissed.has(k)) continue;
    if (registeredKeys.has(k)) continue;
    if (clavesDe(e).some(kk => registeredKeys.has(kk))) continue;
    if ([...e.ids].some(id => registeredIds.has(id))) continue;
    if (e.tracks.some(t => t.uri && registeredUris.has(t.uri))) continue;
    if (e.tracks.length < min) continue;
    const kind = releaseKind(e);
    if (type !== 'all' && kind !== type) continue;
    out.push({ ...e, key: k, kind });
  }
  out.sort((a, b) => b.tracks.length - a.tracks.length);
  return out;
}

// Todas las claves bajo las que un lanzamiento de los likes puede estar
// registrado: su nombre con cada uno de los artistas principales que se le
// vieron.
function clavesDe(e) {
  return [...(e.artistAlts || [])].map(a => albumKey(e.name, a));
}

// ── Diagnóstico del cruce (v=164) ────────────────────────────────────────────
// Mide, sobre lo que la vista ofrece HOY, cuántos ya están registrados y por
// qué señal se los pilla. Sirve para no discutir de memoria si el cruce falla.
// Se llama desde la consola: `await window.__unregDiag()`.
if (typeof window !== 'undefined') {
  window.__unregDiag = () => {
    if (!likesByKey) return 'Abre #listened y espera a que cargue.';
    const registeredKeys = new Set();
    const soloArtistaDelAlbum = new Set();
    for (const a of albums) {
      soloArtistaDelAlbum.add(albumKey(a.name, a.artist));
      registeredKeys.add(albumKey(a.name, a.artist));
      for (const alt of (a.artistAlts || [])) registeredKeys.add(albumKey(a.name, alt));
    }
    const registeredIds = new Set(albums.map(a => a.id));
    const registeredUris = new Set();
    for (const a of albums) for (const t of a.tracks) if (t.uri) registeredUris.add(t.uri);

    const dismissed = getDismissed();
    const ofrecidosAntes = [];
    for (const [k, e] of likesByKey) {
      if (dismissed.has(k)) continue;
      if (soloArtistaDelAlbum.has(k)) continue;
      if ([...e.ids].some(id => registeredIds.has(id))) continue;
      if (e.tracks.some(t => t.uri && registeredUris.has(t.uri))) continue;
      if (e.tracks.length < unregMin) continue;
      const kind = releaseKind(e);
      if (kind !== getUnregType() && getUnregType() !== 'all') continue;
      ofrecidosAntes.push({ ...e, key: k, kind });
    }
    const rescatados = ofrecidosAntes.filter(e => clavesDe(e).some(kk => registeredKeys.has(kk)));
    return {
      registradosEnLaPlaylist: albums.length,
      umbral: unregMin,
      tipo: getUnregType(),
      ofrecidosConElCruceViejo: ofrecidosAntes.length,
      yaRegistradosQueSeColaban: rescatados.length,
      ofrecidosAhora: ofrecidosAntes.length - rescatados.length,
      ejemplos: rescatados.slice(0, 20).map(e => ({
        album: e.name,
        artistaEnLikes: e.artist,
        clavesDeLikes: clavesDe(e),
        registradoComo: albums.filter(a => clavesDe(e).some(kk => (a.artistAlts || []).concat([a.artist]).some(x => albumKey(a.name, x) === kk)))
          .map(a => `${a.name} — ${a.artist} (${a.id})`),
      })),
    };
  };
}

// Un álbum es "edición" (deluxe/remaster/etc) si sacarle las marcas cambia el nombre.
function isEdition(name) {
  return norm(name) !== norm(baseName(name));
}


// Álbumes registrados que aparecen en 2+ ediciones (ej: la normal Y la deluxe).
// Devuelve grupos [{ keeper, remove:[...] }] donde 'remove' son las ediciones sobrantes.
// Regla: si hay una versión normal, esa se queda; si son todas ediciones, se queda la de más tracks.
function computeEditionDupes() {
  const dismissed = getDismissedDupes();
  const byKey = new Map();
  for (const a of albums) {
    const k = albumKey(a.name, a.artist);
    let arr = byKey.get(k);
    if (!arr) { arr = []; byKey.set(k, arr); }
    arr.push(a);
  }
  const groups = [];
  for (const [k, arr] of byKey) {
    if (arr.length < 2) continue;
    if (dismissed.has(k)) continue; // Ian dijo "esto no es duplicado", no lo mostramos más.
    const normals = arr.filter(a => !isEdition(a.name));
    let keeper;
    if (normals.length) keeper = normals.slice().sort((a, b) => b.tracks.length - a.tracks.length)[0];
    else keeper = arr.slice().sort((a, b) => b.tracks.length - a.tracks.length)[0];
    const remove = arr.filter(a => a !== keeper);
    groups.push({ key: k, keeper, remove });
  }
  groups.sort((g1, g2) => g1.keeper.artist.localeCompare(g2.keeper.artist));
  return groups;
}

function buildUI(totalTracks, ts) {
  lastTotalTracks = totalTracks;
  lastTs = ts;
  const content = document.getElementById('listened-content');
  const mode = getSortMode();
  const totalLikes = albums.reduce((n, a) => n + (a.likes?.length || 0), 0);
  const unregistered = computeUnregistered();
  const dupes = computeEditionDupes();

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:14px">
        <strong>${albums.length.toLocaleString('es-ES')}</strong> álbumes · <strong>${totalTracks.toLocaleString('es-ES')}</strong> tracks${totalLikes ? ` · <span style="color:var(--color-accent)">♥ ${totalLikes.toLocaleString('es-ES')} en tus likes</span>` : ''} en <strong>${escapeHtml(playlistInfo.name)}</strong>
        ${ts ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">Actualizado ${timeAgo(ts)}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="listened-unreg-btn" title="Álbumes con varias canciones tuyas en likes que no están en tu registro (ajustas el mínimo adentro)">🎧 Sin registrar (${unregistered.length})</button>
        <button class="btn btn-secondary btn-sm" id="listened-dupes-btn" title="Álbumes registrados dos veces (deluxe Y normal): sacas la sobrante y queda una sola versión">💿 Duplicados (${dupes.length})</button>
        <button class="btn btn-secondary btn-sm" id="listened-repeated-btn" title="Álbumes con varios tracks en la playlist: dejas 1 track por álbum y sacas los demás">🎵 Repetidos (${computeRepeatedAlbums().length})</button>
        <button class="btn btn-secondary btn-sm" id="listened-history-btn" title="Álbumes que ESCUCHASTE de verdad (según tu historial de reproducción) y no tienes registrados">📊 Del historial (${computeHistoryUnregistered().length})</button>
        <button class="btn btn-secondary btn-sm" id="listened-queue-btn" title="Saca de tu playlist-cola (ej: para cuando termine los actuales) los álbumes que ya escuchaste">🎯 Limpiar cola</button>
        <button class="btn btn-secondary btn-sm" id="listened-refresh-btn" title="Vuelve a leer la playlist desde Spotify (si no, se refresca solo una vez por día)">Actualizar</button>
        <button class="btn btn-secondary btn-sm" id="listened-change-btn">Cambiar playlist</button>
      </div>
    </div>

    ${(() => {
      const years = computeYearCounts();
      if (years.length === 0) return '';
      return `
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <h3 style="margin:0;font-size:15px">Por año</h3>
            <span style="font-size:12px;color:var(--color-text-muted)">Cuándo agregaste cada álbum al registro · click para ver la lista</span>
          </div>
          <div style="display:grid;grid-template-columns:${years.length <= 12 ? `repeat(${years.length}, minmax(0, 1fr))` : 'repeat(auto-fit, minmax(110px, 1fr))'};gap:10px">
            ${years.map(y => `
              <button class="year-tile" data-year="${escapeHtml(y.year)}" style="background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:10px 12px;text-align:left;cursor:pointer;transition:border-color .15s,transform .05s;min-width:0">
                <div style="font-size:19px;font-weight:700;color:var(--color-text);line-height:1.1">${y.count.toLocaleString('es-ES')}</div>
                <div style="font-size:11px;color:var(--color-text-muted);margin-top:3px">${escapeHtml(y.year)}</div>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    })()}

    ${(() => {
      const gd = computeGenreDistribution(15);
      if (!gd.top.length) return '';
      return `
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <h3 style="margin:0;font-size:15px">Por género</h3>
            <span style="font-size:12px;color:var(--color-text-muted)">
              Género principal del artista (Last.fm) · ${gd.cached.toLocaleString('es-ES')} clasificados${gd.uncached ? ` · ${gd.uncached.toLocaleString('es-ES')} sin clasificar` : ''}
            </span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${gd.top.map(g => `
              <button class="genre-tile" data-genre="${escapeHtml(g.genre)}" style="background:var(--color-elevated);border:1px solid var(--color-border);border-radius:999px;padding:6px 14px;cursor:pointer;font-size:13px;color:var(--color-text);transition:border-color .15s">
                ${escapeHtml(g.genre)} <span style="color:var(--color-text-muted);font-size:12px">· ${g.count}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    })()}

    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px;position:relative">
        <input type="text" id="listened-search" placeholder="Buscar álbum o artista..."
               style="width:100%;padding:9px 34px 9px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px">
        <button id="listened-search-clear" title="Limpiar"
                style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--color-text-muted);font-size:18px;cursor:pointer;padding:4px 8px;display:none">×</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--color-text-muted);margin-right:4px">Ordenar por:</span>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'recent' ? 'sort-active' : ''}" data-sort="recent" title="Añadidos más recientemente a la playlist">Recientes</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'year-desc' ? 'sort-active' : ''}" data-sort="year-desc" title="Año de salida, más nuevos arriba">Año ↓</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'year-asc' ? 'sort-active' : ''}" data-sort="year-asc" title="Año de salida, más viejos arriba">Año ↑</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'artist-asc' ? 'sort-active' : ''}" data-sort="artist-asc" title="Artista alfabético">Artista</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'likes-desc' ? 'sort-active' : ''}" data-sort="likes-desc" title="Ordena por cuántas canciones de cada álbum tienes en tus Liked Songs">Más likeados ♥</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'name-asc' ? 'sort-active' : ''}" data-sort="name-asc" title="Nombre del álbum alfabético">A-Z</button>
      </div>
    </div>

    <div id="listened-summary" style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px"></div>
    <div id="listened-grid-holder"></div>
  `;

  document.getElementById('listened-refresh-btn').onclick = () => loadAlbums({ force: true });

  const unregBtn = document.getElementById('listened-unreg-btn');
  if (unregBtn) unregBtn.onclick = () => openUnregistered();

  const historyBtn = document.getElementById('listened-history-btn');
  if (historyBtn) historyBtn.onclick = () => openHistory();

  const queueBtn = document.getElementById('listened-queue-btn');
  if (queueBtn) queueBtn.onclick = () => openQueueCleaner();

  const dupesBtn = document.getElementById('listened-dupes-btn');
  if (dupesBtn) dupesBtn.onclick = () => openDupes();

  const repeatedBtn = document.getElementById('listened-repeated-btn');
  if (repeatedBtn) repeatedBtn.onclick = () => openRepeated();

  document.getElementById('listened-change-btn').onclick = () => openListenedAlbumsPicker({
    onSelect: () => { playlistInfo = getListenedPlaylist(); loadAlbums(); },
    onClear: () => { playlistInfo = null; renderNotConfigured(); },
  });

  const searchInput = document.getElementById('listened-search');
  const clearBtn = document.getElementById('listened-search-clear');
  searchInput.addEventListener('input', () => {
    filterText = searchInput.value.trim().toLowerCase();
    clearBtn.style.display = filterText ? 'block' : 'none';
    renderGrid();
  });
  clearBtn.onclick = () => {
    searchInput.value = '';
    filterText = '';
    clearBtn.style.display = 'none';
    renderGrid();
    searchInput.focus();
  };
  content.querySelectorAll('.year-tile').forEach(tile => {
    tile.onclick = () => openYearAlbums(tile.dataset.year);
  });
  content.querySelectorAll('.genre-tile').forEach(tile => {
    tile.onclick = () => openGenreAlbums(tile.dataset.genre);
  });
  content.querySelectorAll('.sort-btn').forEach(btn => {
    btn.onclick = () => {
      // Reapretar el orden activo lo deselecciona y vuelve al default (Recientes).
      const newMode = btn.classList.contains('sort-active') ? 'recent' : btn.dataset.sort;
      setSortMode(newMode);
      content.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('sort-active', b.dataset.sort === newMode));
      renderGrid();
    };
  });

  renderGrid();
}

function sortAlbums(list) {
  const mode = getSortMode();
  const copy = [...list];
  if (mode === 'year-desc') copy.sort((a, b) => (b.year || '0').localeCompare(a.year || '0'));
  else if (mode === 'year-asc') copy.sort((a, b) => (a.year || '9999').localeCompare(b.year || '9999'));
  else if (mode === 'artist-asc') copy.sort((a, b) => a.artist.localeCompare(b.artist));
  else if (mode === 'likes-desc') copy.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0) || b.tracks.length - a.tracks.length);
  else if (mode === 'name-asc') copy.sort((a, b) => a.name.localeCompare(b.name));
  else copy.sort((a, b) => b.addedAt - a.addedAt); // recent
  return copy;
}

function timeAgo(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.round(hrs / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

function renderGrid() {
  const holder = document.getElementById('listened-grid-holder');
  const summary = document.getElementById('listened-summary');
  if (!holder || !summary) return;

  const filtered = filterText
    ? albums.filter(a => a.name.toLowerCase().includes(filterText) || a.artist.toLowerCase().includes(filterText))
    : albums;
  const sorted = sortAlbums(filtered);

  if (filterText) {
    summary.textContent = `${sorted.length} de ${albums.length} álbumes coinciden con "${filterText}"`;
  } else {
    summary.textContent = `${albums.length} álbumes únicos. Click en uno para ver los tracks que tienes de él.`;
  }

  if (sorted.length === 0) {
    holder.innerHTML = `<div class="card"><p>Ningún álbum coincide con "${escapeHtml(filterText)}".</p></div>`;
    return;
  }

  holder.innerHTML = `
    <div class="playlist-grid">
      ${sorted.map(a => `
        <button class="playlist-card" data-id="${a.id}">
          <div class="playlist-card-cover">
            ${a.cover ? `<img src="${a.cover}" loading="lazy" alt="">` : `<div class="playlist-card-cover-placeholder">♪</div>`}
          </div>
          <div class="playlist-card-name">${escapeHtml(a.name)}</div>
          <div class="playlist-card-meta">${escapeHtml(a.artist)}${a.year ? ` · ${a.year}` : ''}</div>
          <div class="playlist-card-meta" style="color:var(--color-text-muted)">${a.tracks.length} en la playlist${a.likes?.length ? ` · <span style="color:var(--color-accent)">♥ ${a.likes.length}</span>` : ''}</div>
        </button>
      `).join('')}
    </div>
  `;

  holder.querySelectorAll('.playlist-card').forEach(el => {
    el.onclick = () => openAlbumDetail(el.dataset.id);
  });
}

function openAlbumDetail(albumId) {
  const album = albums.find(a => a.id === albumId);
  if (!album) return;

  const overlay = openModal({
    id: `listened-album:${album.id}`,
    html: `
    <div class="modal" style="max-width:520px">
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
        ${album.cover ? `<img src="${album.cover}" style="width:72px;height:72px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:72px;height:72px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
        <div style="min-width:0">
          <h2 style="margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(album.name)}</h2>
          <div style="color:var(--color-text-secondary);font-size:14px">${escapeHtml(album.artist)}${album.year ? ` · ${album.year}` : ''}</div>
          <div style="color:var(--color-text-muted);font-size:12px;margin-top:2px">${album.tracks.length} track${album.tracks.length === 1 ? '' : 's'} tuyos en la playlist</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px">En la playlist (${album.tracks.length})</div>
      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
        ${album.tracks.map((t, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
            <span style="width:22px;text-align:center;color:var(--color-text-muted);font-size:12px;flex-shrink:0">${i + 1}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.artists)}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="font-size:12px;color:var(--color-accent);margin:16px 0 6px">♥ De este álbum en tus Liked Songs (${album.likes?.length || 0})</div>
      ${album.likes?.length ? `
      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
        ${album.likes.map((t, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
            <span style="width:22px;text-align:center;color:var(--color-accent);font-size:12px;flex-shrink:0">♥</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.artists)}</div>
            </div>
          </div>
        `).join('')}
      </div>` : `<div style="color:var(--color-text-muted);font-size:13px">No tienes canciones de este álbum en tus likes.</div>`}
      <div class="modal-actions" style="margin-top:16px">
        ${album.url ? `<a class="btn btn-secondary" href="${album.url}" target="_blank" rel="noopener">Ver álbum en Spotify</a>` : ''}
        <button class="btn btn-primary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });
}

// Modal con álbumes que tenés muy likeados pero no figuran en tu playlist de registro.
// Umbral ajustable en vivo (3/4/5/6/8 canciones en likes).
function openYearAlbums(year) {
  const bucket = computeYearCounts().find(y => y.year === year);
  if (!bucket) return;
  const list = [...bucket.albums].sort((a, b) => b.addedAt - a.addedAt); // más recientes arriba
  const fmt = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const overlay = openModal({
    id: `listened-year:${year}`,
    html: `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">Álbumes escuchados en ${escapeHtml(year)}</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px">
        ${bucket.count.toLocaleString('es-ES')} álbum${bucket.count === 1 ? '' : 'es'} registrado${bucket.count === 1 ? '' : 's'} en <strong>${escapeHtml(playlistInfo.name)}</strong> durante ${escapeHtml(year)}.
      </p>
      <div class="picker-scroll">
        <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm)">
          ${list.map(a => {
            const url = a.id && !String(a.id).includes(':') ? `https://open.spotify.com/album/${a.id}` : (a.url || null);
            return `
              <div class="pick-row" style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
                ${a.cover || a.image ? `<img src="${a.cover || a.image}" loading="lazy" class="pick-cover">` : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px">♪</div>`}
                <div style="flex:1;min-width:0">
                  <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
                  <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.artist)}${a.year ? ` · ${escapeHtml(a.year)}` : ''}</div>
                </div>
                <span style="font-size:11px;color:var(--color-text-muted);flex-shrink:0">${escapeHtml(fmt(a.addedAt))}</span>
                ${url ? `<a href="${url}" target="_blank" rel="noopener" title="Abrir en Spotify" style="color:var(--color-text-muted);font-size:15px;flex-shrink:0;text-decoration:none">↗</a>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });
}

function openGenreAlbums(genre) {
  const gd = computeGenreDistribution(999);
  const bucket = gd.top.find(g => g.genre === genre);
  if (!bucket) return;
  const list = [...bucket.albums].sort((a, b) => b.addedAt - a.addedAt);
  const overlay = openModal({
    id: `listened-genre:${genre}`,
    html: `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">Género: ${escapeHtml(genre)}</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px">
        ${bucket.count.toLocaleString('es-ES')} álbum${bucket.count === 1 ? '' : 'es'} cuyo artista principal tiene este género en Last.fm.
      </p>
      <div class="picker-scroll">
        <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm)">
          ${list.map(a => {
            const url = a.id && !String(a.id).includes(':') ? `https://open.spotify.com/album/${a.id}` : (a.url || null);
            return `
              <div class="pick-row" style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
                ${a.cover || a.image ? `<img src="${a.cover || a.image}" loading="lazy" class="pick-cover">` : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px">♪</div>`}
                <div style="flex:1;min-width:0">
                  <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
                  <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.artist)}${a.year ? ` · ${escapeHtml(a.year)}` : ''}</div>
                </div>
                ${url ? `<a href="${url}" target="_blank" rel="noopener" title="Abrir en Spotify" style="color:var(--color-text-muted);font-size:15px;flex-shrink:0;text-decoration:none">↗</a>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });
}

function openUnregistered() {
  const overlay = openModal({
    id: 'listened-unregistered',
    html: `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">🎧 Quizás escuchaste y no registraste</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px">
        Álbumes que no están en <strong>${escapeHtml(playlistInfo.name)}</strong> pero de los que tienes varias canciones en Liked Songs.
        Muchos likes de un mismo álbum suele indicar que lo escuchaste bastante. (Deluxe y normal cuentan como uno solo.)
      </p>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;flex-shrink:0">
        <span style="font-size:12px;color:var(--color-text-muted)">Tipo:</span>
        <span id="unreg-type-chips" style="display:flex;gap:6px;flex-wrap:wrap"></span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap;flex-shrink:0">
        <span style="font-size:12px;color:var(--color-text-muted)">Mínimo de canciones en likes:</span>
        ${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button class="btn ${n === unregMin ? 'btn-primary' : 'btn-secondary'} btn-sm unreg-th" data-th="${n}">${n}+</button>`).join('')}
      </div>
      <div id="unreg-selall" style="flex-shrink:0;margin-bottom:6px"></div>
      <div id="unreg-list" class="picker-scroll"></div>
      <div id="unreg-hidden-note" style="font-size:12px;color:var(--color-text-muted);margin-top:8px;flex-shrink:0"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-primary" id="unreg-add" disabled>Añadir a escuchados (0)</button>
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });

  const addBtn = overlay.querySelector('#unreg-add');
  let unregRendered = [];
  const updateAddBtn = () => {
    const n = overlay.querySelectorAll('.unreg-cb:checked').length;
    addBtn.textContent = `Añadir a escuchados (${n})`;
    addBtn.disabled = n === 0;
  };

  let unregType = getUnregType();

  // Los chips llevan el conteo por tipo con el umbral actual, así que se
  // recalculan cada vez que cambia el mínimo o se oculta un álbum.
  const renderTypeChips = () => {
    const all = computeUnregistered(unregMin, 'all');
    const nAlbums = all.filter(e => e.kind === 'albums').length;
    const nSingles = all.length - nAlbums;
    const opts = [
      ['all', `Todos (${all.length.toLocaleString('es-ES')})`],
      ['albums', `Álbumes y EPs (${nAlbums.toLocaleString('es-ES')})`],
      ['singles', `Singles (${nSingles.toLocaleString('es-ES')})`],
    ];
    const holder = overlay.querySelector('#unreg-type-chips');
    if (!holder) return;
    holder.innerHTML = opts.map(([v, label]) =>
      `<button class="btn ${v === unregType ? 'btn-primary' : 'btn-secondary'} btn-sm unreg-type" data-type="${v}">${label}</button>`
    ).join('') + (typeIsGuessed()
      ? `<span title="Los likes cargados no traen el tipo de lanzamiento; se deduce de cuántas canciones tienes de cada uno. Inicia sesión para que el tipo venga de Spotify." style="font-size:11px;color:var(--color-text-muted);align-self:center">tipo estimado</span>`
      : '');
    holder.querySelectorAll('.unreg-type').forEach(btn => {
      btn.onclick = () => {
        unregType = btn.dataset.type;
        setUnregType(unregType);
        renderList();
      };
    });
  };

  const renderList = () => {
    // Guardamos qué estaba tildado para no perder la selección al ocultar/re-renderizar.
    const prevChecked = new Set([...overlay.querySelectorAll('.unreg-cb:checked')].map(cb => cb.dataset.uri).filter(Boolean));
    renderTypeChips();
    const list = computeUnregistered(unregMin, unregType);
    unregRendered = list;
    const holder = overlay.querySelector('#unreg-list');
    const selall = overlay.querySelector('#unreg-selall');
    if (list.length === 0) {
      selall.innerHTML = '';
      const queTipo = unregType === 'albums' ? 'álbumes ni EPs' : unregType === 'singles' ? 'singles' : 'álbumes';
      holder.innerHTML = `<div style="color:var(--color-text-muted);font-size:13px;padding:8px 0">No hay ${queTipo} con ${unregMin}+ canciones en likes fuera de tu registro.</div>`;
      updateHiddenNote();
      updateAddBtn();
      return;
    }
    // "Seleccionar todos" fijo arriba (fuera del scroll) para no tener que subir a buscarlo.
    selall.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-muted);cursor:pointer">
        <input type="checkbox" id="unreg-all"> Seleccionar todos (${list.length} álbumes)
      </label>`;
    holder.innerHTML = `
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm)">
        ${list.map(e => {
          const url = e.id ? `https://open.spotify.com/album/${e.id}` : null;
          const uri = e.tracks.find(t => t.uri)?.uri || '';
          return `
          <label class="pick-row" style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--color-border);cursor:${uri ? 'pointer' : 'default'}">
            <input type="checkbox" class="unreg-cb" data-uri="${uri}" data-key="${e.key}" ${uri ? '' : 'disabled'} ${uri && prevChecked.has(uri) ? 'checked' : ''}>
            ${e.image ? `<img src="${e.image}" loading="lazy" class="pick-cover unreg-open" data-key="${e.key}" title="Ver la ficha del álbum" style="cursor:pointer">` : `<div class="pick-cover unreg-open" data-key="${e.key}" title="Ver la ficha del álbum" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px;cursor:pointer">♪</div>`}
            <div class="unreg-open" data-key="${e.key}" title="Ver la ficha del álbum" style="flex:1;min-width:0;cursor:pointer">
              <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.artist)}${e.year ? ` · ${e.year}` : ''}</div>
            </div>
            <span class="pick-pill" style="color:var(--color-accent)">♥ ${e.tracks.length}</span>
            ${url ? `<a href="${url}" target="_blank" rel="noopener" title="Abrir en Spotify" style="color:var(--color-text-muted);font-size:15px;flex-shrink:0;text-decoration:none">↗</a>` : ''}
            <button class="unreg-hide pick-x" data-key="${e.key}" title="No me interesa, ocultar">✕</button>
          </label>`;
        }).join('')}
      </div>
    `;
    holder.querySelectorAll('.unreg-cb').forEach(cb => cb.addEventListener('change', updateAddBtn));
    // ── Abrir la ficha de álbum desde la lista (v=164) ──────────────────────
    //
    // Hasta ahora solo se podía marcar a ciegas: la fila daba nombre, artista y
    // cuántos likes, y nada más. La tapa y el bloque de texto abren la ficha;
    // el checkbox sigue siendo el que selecciona.
    //
    // ⚠️ La fila es un `<label>` que envuelve el checkbox, así que un click en
    // cualquier hijo lo tilda. Por eso va `preventDefault()` además de
    // `stopPropagation()`: sin el primero, abrir la ficha marcaría el álbum de
    // paso, que es justo lo contrario de «ver qué es antes de decidir».
    holder.querySelectorAll('.unreg-open').forEach(el => {
      el.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const e = unregRendered.find(x => x.key === el.dataset.key);
        if (!e) return;
        openAlbumCard({
          name: e.name,
          artist: e.artist,
          img: e.image,
          albumId: e.id,
          totalTracks: e.totalTracks,
          plays: 0,
          min: 0,
        });
      });
    });
    holder.querySelectorAll('.unreg-hide').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        dismissUnreg(btn.dataset.key);
        refreshHeaderCounts();
        renderList();
      });
    });
    const allCb = overlay.querySelector('#unreg-all');
    if (allCb) allCb.addEventListener('change', () => {
      holder.querySelectorAll('.unreg-cb:not(:disabled)').forEach(cb => { cb.checked = allCb.checked; });
      updateAddBtn();
    });
    updateHiddenNote();
    updateAddBtn();
  };

  const updateHiddenNote = () => {
    const note = overlay.querySelector('#unreg-hidden-note');
    if (!note) return;
    const n = getDismissed().size;
    note.innerHTML = n
      ? `${n} oculto${n === 1 ? '' : 's'} · <a href="#" id="unreg-show-hidden" style="color:var(--color-accent)">ver ocultos</a>`
      : '';
    const showLink = note.querySelector('#unreg-show-hidden');
    if (showLink) showLink.onclick = ev => {
      ev.preventDefault();
      openHiddenManager({
        title: '🎧 Ocultos de sin registrar',
        keys: [...getDismissed()],
        lookup: k => {
          const e = likesByKey?.get(k);
          return e ? { name: e.name, artist: e.artist, extra: `♥ ${e.tracks.length}` } : null;
        },
        onRestore: k => { const s = getDismissed(); s.delete(k); localStorage.setItem(prefKey(DISMISS_KEY), JSON.stringify([...s])); },
        onChange: () => { refreshHeaderCounts(); renderList(); },
      });
    };
  };
  renderList();

  overlay.querySelectorAll('.unreg-th').forEach(btn => {
    btn.onclick = () => {
      unregMin = parseInt(btn.dataset.th);
      overlay.querySelectorAll('.unreg-th').forEach(b => {
        const active = b === btn;
        b.classList.toggle('btn-primary', active);
        b.classList.toggle('btn-secondary', !active);
      });
      renderList();
    };
  });

  const close = () => closeTop();

  addBtn.onclick = async () => {
    const checkedKeys = new Set([...overlay.querySelectorAll('.unreg-cb:checked')].map(cb => cb.dataset.key));
    const picked = unregRendered.filter(e => checkedKeys.has(e.key));
    const uris = picked.map(e => e.tracks.find(t => t.uri)?.uri).filter(Boolean);
    if (uris.length === 0) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Agregando...';
    try {
      await addTracksToPlaylist(playlistInfo.id, uris);      // sin confirmación (pedido de Ian)
      showToast(`${uris.length} álbum${uris.length === 1 ? '' : 'es'} añadido${uris.length === 1 ? '' : 's'} a escuchados`, 'success');
      close();
      // Update local instantáneo (sin re-bajar la playlist ni mostrar "Actualizando").
      await addAlbumsLocally(picked.map(e => ({
        id: e.id, name: e.name, artist: e.artist, year: e.year, image: e.image,
        artistAlts: [...(e.artistAlts || [])],
        uri: e.tracks.find(t => t.uri)?.uri,
      })));
    } catch (err) {
      showToast('Error al añadir: ' + err.message, 'error');
      addBtn.disabled = false;
      updateAddBtn();
    }
  };
}

// Modal de álbumes registrados por duplicado (2+ ediciones). Se marca para sacar la
// sobrante y dejar una sola (por defecto se queda la normal / la de más tracks).
function openDupes() {
  const cover = (a, size = 34) => a.cover
    ? `<img src="${a.cover}" loading="lazy" style="width:${size}px;height:${size}px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0">`
    : `<div style="width:${size}px;height:${size}px;background:var(--color-elevated);border-radius:var(--radius-sm);flex-shrink:0"></div>`;

  const overlay = openModal({
    id: 'listened-dupes',
    html: `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">💿 Duplicados por edición</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px;flex-shrink:0">
        Álbumes que tienes registrados <strong>dos veces</strong> en <strong>${escapeHtml(playlistInfo.name)}</strong> (deluxe Y normal, etc.).
        Ya marqué la sobrante para sacar (queda la normal / la de más tracks). Si alguno <strong>no</strong> es duplicado (LP3, II, Vol. 2…), toca la ✕ para ignorarlo.
      </p>
      <div id="dup-scroll" class="picker-scroll" style="border:1px solid var(--color-border);border-radius:var(--radius-sm)"></div>
      <div id="dup-hidden-note" style="font-size:12px;color:var(--color-text-muted);margin-top:8px;flex-shrink:0"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-danger" id="dup-del">Sacar seleccionados (0)</button>
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });

  const delBtn = overlay.querySelector('#dup-del');
  const scroll = overlay.querySelector('#dup-scroll');
  const updateDelBtn = () => {
    const n = overlay.querySelectorAll('.dup-cb:checked').length;
    delBtn.textContent = `Sacar seleccionados (${n})`;
    delBtn.disabled = n === 0;
  };

  const updateHiddenNote = () => {
    const note = overlay.querySelector('#dup-hidden-note');
    const n = getDismissedDupes().size;
    note.innerHTML = n
      ? `${n} marcado${n === 1 ? '' : 's'} como "no es duplicado" · <a href="#" id="dup-show-hidden" style="color:var(--color-accent)">volver a mostrar</a>`
      : '';
    const link = note.querySelector('#dup-show-hidden');
    if (link) link.onclick = ev => { ev.preventDefault(); clearDismissedDupes(); refreshHeaderCounts(); render(); };
  };

  const render = () => {
    const prevChecked = new Set([...overlay.querySelectorAll('.dup-cb:checked')].map(cb => cb.dataset.uris));
    const groups = computeEditionDupes();
    if (groups.length === 0) {
      scroll.innerHTML = `<div style="color:var(--color-text-muted);font-size:13px;padding:12px">No hay álbumes duplicados por edición. 👌</div>`;
      updateHiddenNote();
      updateDelBtn();
      return;
    }
    scroll.innerHTML = groups.map(g => {
      const base = baseName(g.keeper.name).trim() || g.keeper.name;
      const keepRow = `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;opacity:0.7">
          <span style="width:19px;text-align:center;color:var(--color-accent);flex-shrink:0">✓</span>
          ${cover(g.keeper)}
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(g.keeper.name)}</div>
            <div style="font-size:12px;color:var(--color-accent)">se queda</div>
          </div>
        </div>`;
      const removeRows = g.remove.map(a => {
        const uris = (a.tracks || []).map(t => t.uri).filter(Boolean).join(',');
        const checked = uris && (prevChecked.size === 0 || prevChecked.has(uris)) ? 'checked' : '';
        return `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:${uris ? 'pointer' : 'default'}">
          <input type="checkbox" class="dup-cb" data-uris="${uris}" data-albid="${a.id}" ${uris ? checked : 'disabled'}>
          ${cover(a)}
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
            <div style="font-size:12px;color:var(--color-error)">sacar${a.url ? ` · <a href="${a.url}" target="_blank" rel="noopener" style="color:var(--color-accent)">abrir</a>` : ''}</div>
          </div>
        </label>`;
      }).join('');
      return `
        <div style="border-bottom:1px solid var(--color-border)">
          <div style="display:flex;align-items:center;gap:6px;padding:9px 12px 2px">
            <div style="flex:1;min-width:0;font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(g.keeper.artist)} — ${escapeHtml(base)}</div>
            <button class="dup-hide" data-key="${g.key}" title="No es duplicado, ignorar" style="background:transparent;border:none;color:var(--color-text-muted);font-size:15px;cursor:pointer;padding:2px 6px;flex-shrink:0;line-height:1;border-radius:var(--radius-sm)">✕</button>
          </div>
          ${keepRow}
          ${removeRows}
        </div>`;
    }).join('');

    scroll.querySelectorAll('.dup-cb').forEach(cb => cb.addEventListener('change', updateDelBtn));
    scroll.querySelectorAll('.dup-hide').forEach(btn => {
      btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--color-error)'; btn.style.background = 'var(--color-elevated)'; });
      btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--color-text-muted)'; btn.style.background = 'transparent'; });
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        dismissDupe(btn.dataset.key);
        refreshHeaderCounts();
        render();
      });
    });
    updateHiddenNote();
    updateDelBtn();
  };
  render();

  const close = () => closeTop();

  delBtn.onclick = async () => {
    const selected = [...overlay.querySelectorAll('.dup-cb:checked')];
    const uris = selected.flatMap(cb => (cb.dataset.uris || '').split(',').filter(Boolean));
    const selIds = new Set(selected.map(cb => cb.dataset.albid));
    if (uris.length === 0) return;
    const ok = await confirmModal(
      'Sacar ediciones duplicadas',
      `Se van a <strong>sacar ${selected.length} edición${selected.length === 1 ? '' : 'es'}</strong> de tu playlist "${escapeHtml(playlistInfo.name)}", dejando una versión de cada álbum. Esto modifica tu playlist en Spotify. ¿Seguro?`,
      'Sacar'
    );
    if (!ok) return;
    delBtn.disabled = true;
    delBtn.textContent = 'Sacando...';
    try {
      await removeTracksFromPlaylist(playlistInfo.id, uris);
      showToast(`${selected.length} edición${selected.length === 1 ? '' : 'es'} sacada${selected.length === 1 ? '' : 's'}`, 'success');
      close();
      // Update local instantáneo (sin re-bajar la playlist).
      await removeAlbumEntriesLocally(albums.filter(a => selIds.has(a.id)));
    } catch (err) {
      showToast('Error al sacar: ' + err.message, 'error');
      delBtn.disabled = false;
      updateDelBtn();
    }
  };
}

// ── Cola "para cuando termine los actuales" ────────────────────────────────
// Saca de una playlist-cola los álbumes que YA están en tu registro de escuchados,
// así al elegir qué escuchar no te aparecen repetidos.
function getQueuePlaylist() {
  const id = localStorage.getItem(prefKey(QUEUE_PID_KEY));
  return id ? { id, name: localStorage.getItem(prefKey(QUEUE_PNAME_KEY)) || 'Cola' } : null;
}
function setQueuePlaylist(id, name) {
  localStorage.setItem(prefKey(QUEUE_PID_KEY), id);
  localStorage.setItem(prefKey(QUEUE_PNAME_KEY), name);
}

function openQueueCleaner() {
  const overlay = openModal({
    id: 'queue-cleaner',
    html: `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">🎯 Sacar de la cola lo ya escuchado</h2>
      <p id="queue-sub" style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px;flex-shrink:0"></p>
      <div id="queue-body" class="picker-scroll" style="border:1px solid var(--color-border);border-radius:var(--radius-sm)"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-danger" id="queue-del" style="display:none" disabled>Sacar de la cola (0)</button>
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });
  const body = overlay.querySelector('#queue-body');
  const sub = overlay.querySelector('#queue-sub');
  const delBtn = overlay.querySelector('#queue-del');
  const close = () => closeTop();

  const q = getQueuePlaylist();
  if (q) loadQueue(q); else renderPicker();

  async function renderPicker() {
    delBtn.style.display = 'none';
    sub.textContent = 'Elige tu playlist-cola (ej: "para cuando termine los actuales").';
    body.innerHTML = `<div style="padding:16px;text-align:center"><div class="spinner spinner-lg"></div></div>`;
    let pls;
    try { pls = await getAllUserPlaylists(); }
    catch (e) { body.innerHTML = `<div style="padding:16px;color:var(--color-error)">Error: ${escapeHtml(e.message)}</div>`; return; }
    body.innerHTML = `
      <input type="text" id="queue-search" placeholder="Buscar playlist..." autocomplete="off"
             style="width:calc(100% - 24px);margin:12px;padding:9px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px">
      <div id="queue-pls"></div>`;
    const plsEl = body.querySelector('#queue-pls');
    const draw = (f) => {
      const ff = (f || '').toLowerCase();
      plsEl.innerHTML = pls.filter(p => !ff || p.name.toLowerCase().includes(ff)).slice(0, 200).map(p => `
        <div class="queue-pl" data-id="${p.id}" data-name="${escapeHtml(p.name)}"
             style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-top:1px solid var(--color-border)">
          ${p.image ? `<img src="${p.image}" style="width:34px;height:34px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:34px;height:34px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
          <div style="flex:1;min-width:0"><div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</div>
          <div style="font-size:12px;color:var(--color-text-muted)">${(p.tracks?.total ?? '?').toLocaleString('es-ES')} tracks</div></div>
        </div>`).join('') || `<div style="padding:16px;color:var(--color-text-muted);font-size:13px">Sin resultados</div>`;
      plsEl.querySelectorAll('.queue-pl').forEach(el => {
        el.onmouseenter = () => { el.style.background = 'var(--color-surface)'; };
        el.onmouseleave = () => { el.style.background = 'transparent'; };
        el.onclick = () => { setQueuePlaylist(el.dataset.id, el.dataset.name); loadQueue(getQueuePlaylist()); };
      });
    };
    draw('');
    body.querySelector('#queue-search').oninput = (e) => draw(e.target.value.trim());
  }

  async function loadQueue(qp) {
    sub.innerHTML = `Cola: <strong>${escapeHtml(qp.name)}</strong> · <a href="#" id="queue-change" style="color:var(--color-accent)">cambiar</a>`;
    body.querySelector && (body.innerHTML = `<div style="padding:16px;text-align:center"><div class="spinner spinner-lg"></div><div style="margin-top:10px;font-size:13px;color:var(--color-text-muted)">Leyendo "${escapeHtml(qp.name)}"...</div></div>`);
    overlay.querySelector('#queue-change').onclick = (e) => { e.preventDefault(); renderPicker(); };
    let items;
    try { items = await getAllPlaylistItems(qp.id); }
    catch (e) { body.innerHTML = `<div style="padding:16px;color:var(--color-error)">Error: ${escapeHtml(e.message)}</div>`; return; }
    const qAlbums = groupItemsByAlbum(items);

    const regKeys = new Set(albums.map(a => albumKey(a.name, a.artist)));
    const regIds = new Set(albums.map(a => a.id));
    const regUris = new Set();
    for (const a of albums) for (const t of a.tracks) if (t.uri) regUris.add(t.uri);

    const cand = qAlbums.filter(a =>
      regKeys.has(albumKey(a.name, a.artist)) ||
      regIds.has(a.id) ||
      a.tracks.some(t => t.uri && regUris.has(t.uri))
    );

    if (cand.length === 0) {
      delBtn.style.display = 'none';
      body.innerHTML = `<div style="padding:16px;color:var(--color-text-muted);font-size:13px">Ningún álbum de la cola figura ya en tus escuchados. 👌 (${qAlbums.length} álbumes en la cola)</div>`;
      return;
    }
    body.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-muted);padding:10px 12px;border-bottom:1px solid var(--color-border);cursor:pointer">
        <input type="checkbox" id="queue-all" checked> Seleccionar todos (${cand.length})
      </label>
      ${cand.map(a => {
        const uris = (a.tracks || []).map(t => t.uri).filter(Boolean).join(',');
        return `
        <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border);cursor:${uris ? 'pointer' : 'default'}">
          <input type="checkbox" class="queue-cb" data-uris="${uris}" ${uris ? 'checked' : 'disabled'}>
          ${a.cover ? `<img src="${a.cover}" loading="lazy" style="width:38px;height:38px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:38px;height:38px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
            <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.artist)}${a.year ? ` · ${a.year}` : ''} · ya escuchado</div>
          </div>
          <span style="color:var(--color-text-muted);font-size:12px;flex-shrink:0">${a.tracks.length} track${a.tracks.length === 1 ? '' : 's'}</span>
        </label>`;
      }).join('')}
    `;
    delBtn.style.display = '';
    const update = () => {
      const n = overlay.querySelectorAll('.queue-cb:checked').length;
      delBtn.textContent = `Sacar de la cola (${n})`;
      delBtn.disabled = n === 0;
    };
    overlay.querySelectorAll('.queue-cb').forEach(cb => cb.addEventListener('change', update));
    const allCb = overlay.querySelector('#queue-all');
    allCb.addEventListener('change', () => {
      overlay.querySelectorAll('.queue-cb:not(:disabled)').forEach(cb => { cb.checked = allCb.checked; });
      update();
    });
    update();

    delBtn.onclick = async () => {
      const uris = [...overlay.querySelectorAll('.queue-cb:checked')].flatMap(cb => (cb.dataset.uris || '').split(',').filter(Boolean));
      const nAlb = overlay.querySelectorAll('.queue-cb:checked').length;
      if (uris.length === 0) return;
      const ok = await confirmModal(
        'Sacar de la cola',
        `Se van a <strong>sacar ${nAlb} álbum${nAlb === 1 ? '' : 'es'}</strong> (${uris.length} tracks) de tu playlist "${escapeHtml(qp.name)}", porque ya están en tus escuchados. Esto modifica esa playlist en Spotify. ¿Seguro?`,
        'Sacar'
      );
      if (!ok) return;
      delBtn.disabled = true;
      delBtn.textContent = 'Sacando...';
      try {
        await removeTracksFromPlaylist(qp.id, uris);
        showToast(`${nAlb} álbum${nAlb === 1 ? '' : 'es'} sacado${nAlb === 1 ? '' : 's'} de la cola`, 'success');
        await new Promise(r => setTimeout(r, 900));
        loadQueue(qp);
      } catch (err) {
        showToast('Error al sacar: ' + err.message, 'error');
        delBtn.disabled = false;
        update();
      }
    };
  }
}

// Modal: álbumes que ESCUCHASTE según tu historial de reproducción (N+ tracks distintos con ≥30s)
// y que no están en tu registro. Umbral ajustable. Podés agregarlos u ocultarlos.
function openHistory() {
  if (!historyAlbums || historyAlbums.length === 0) {
    showToast('No se pudo cargar el historial de reproducción.', 'error');
    return;
  }
  const overlay = openModal({
    id: 'listened-history-unreg',
    html: `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">📊 Escuchaste (según tu historial) y no registraste</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px;flex-shrink:0">
        De tu historial de reproducción real: álbumes de los que escuchaste varios temas distintos (≥30s cada uno) pero no están en <strong>${escapeHtml(playlistInfo.name)}</strong>.
      </p>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;flex-shrink:0">
        <span style="font-size:12px;color:var(--color-text-muted)">Mín. de temas distintos escuchados:</span>
        ${[3, 4, 5, 6, 8, 10, 12].map(n => `<button class="btn ${n === historyMin ? 'btn-primary' : 'btn-secondary'} btn-sm hist-th" data-th="${n}">${n}+</button>`).join('')}
      </div>
      <div id="hist-selall" style="flex-shrink:0;margin-bottom:6px"></div>
      <div id="hist-list" class="picker-scroll"></div>
      <div id="hist-hidden-note" style="font-size:12px;color:var(--color-text-muted);margin-top:8px;flex-shrink:0"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-primary" id="hist-add" disabled>Añadir a escuchados (0)</button>
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });

  const addBtn = overlay.querySelector('#hist-add');
  let histRendered = [];
  const updateAddBtn = () => {
    const n = overlay.querySelectorAll('.hist-cb:checked').length;
    addBtn.textContent = `Añadir a escuchados (${n})`;
    addBtn.disabled = n === 0;
  };
  const updateHiddenNote = () => {
    const note = overlay.querySelector('#hist-hidden-note');
    const n = getDismissedHistory().size;
    note.innerHTML = n
      ? `${n} oculto${n === 1 ? '' : 's'} · <a href="#" id="hist-show-hidden" style="color:var(--color-accent)">ver ocultos</a>`
      : '';
    const link = note.querySelector('#hist-show-hidden');
    if (link) link.onclick = ev => {
      ev.preventDefault();
      openHiddenManager({
        title: '📊 Ocultos del historial',
        keys: [...getDismissedHistory()],
        lookup: k => {
          const h = historyAlbums.find(x => albumKey(x.a, x.ar) === k);
          return h ? { name: h.a, artist: h.ar, extra: `${h.dt} temas · ${h.min.toLocaleString('es-ES')} min` } : null;
        },
        onRestore: k => { const s = getDismissedHistory(); s.delete(k); localStorage.setItem(prefKey(HISTORY_DISMISS_KEY), JSON.stringify([...s])); },
        onChange: () => { refreshHeaderCounts(); renderList(); },
      });
    };
  };

  const renderList = () => {
    const prevChecked = new Set([...overlay.querySelectorAll('.hist-cb:checked')].map(cb => cb.dataset.uri).filter(Boolean));
    const list = computeHistoryUnregistered(historyMin);
    histRendered = list;
    const holder = overlay.querySelector('#hist-list');
    const selall = overlay.querySelector('#hist-selall');
    if (list.length === 0) {
      selall.innerHTML = '';
      holder.innerHTML = `<div style="color:var(--color-text-muted);font-size:13px;padding:8px 0">No hay álbumes con ${historyMin}+ temas escuchados fuera de tu registro.</div>`;
      updateHiddenNote();
      updateAddBtn();
      return;
    }
    selall.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-muted);cursor:pointer">
        <input type="checkbox" id="hist-all"> Seleccionar todos (${list.length} álbumes)
      </label>`;
    holder.innerHTML = `
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);overflow:hidden">
        ${list.map((h, i) => {
          const uri = h.u || '';
          const tid = trackIdOf(uri);
          const img = h.img || likesByKey?.get(h.key)?.image || null;
          const url = tid ? `https://open.spotify.com/track/${tid}` : null;
          return `
          <label class="pick-row" style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--color-border);cursor:${uri ? 'pointer' : 'default'}">
            <input type="checkbox" class="hist-cb" data-uri="${uri}" data-key="${h.key}" ${uri ? '' : 'disabled'} ${uri && prevChecked.has(uri) ? 'checked' : ''}>
            <span style="width:20px;text-align:right;font-size:12px;color:var(--color-text-muted);flex-shrink:0;font-variant-numeric:tabular-nums">${i + 1}</span>
            ${img ? `<img src="${img}" loading="lazy" class="pick-cover">` : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px">♪</div>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(h.a)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(h.ar)}${h.y1 ? ` · ${h.y1}` : ''}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0">
              <span class="pick-pill">🎵 ${h.dt}</span>
              <span style="color:var(--color-text-muted);font-size:11px;font-variant-numeric:tabular-nums">${h.min.toLocaleString('es-ES')} min</span>
            </div>
            ${url ? `<a href="${url}" target="_blank" rel="noopener" title="Abrir en Spotify" style="color:var(--color-text-muted);font-size:15px;flex-shrink:0;text-decoration:none">↗</a>` : ''}
            <button class="hist-hide pick-x" data-key="${h.key}" title="No me interesa, ocultar">✕</button>
          </label>`;
        }).join('')}
      </div>
    `;
    holder.querySelectorAll('.hist-cb').forEach(cb => cb.addEventListener('change', updateAddBtn));
    holder.querySelectorAll('.hist-hide').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        dismissHistory(btn.dataset.key);
        refreshHeaderCounts();
        renderList();
      });
    });
    const allCb = overlay.querySelector('#hist-all');
    if (allCb) allCb.addEventListener('change', () => {
      holder.querySelectorAll('.hist-cb:not(:disabled)').forEach(cb => { cb.checked = allCb.checked; });
      updateAddBtn();
    });
    updateHiddenNote();
    updateAddBtn();
  };
  renderList();

  overlay.querySelectorAll('.hist-th').forEach(btn => {
    btn.onclick = () => {
      historyMin = parseInt(btn.dataset.th);
      overlay.querySelectorAll('.hist-th').forEach(b => {
        const active = b === btn;
        b.classList.toggle('btn-primary', active);
        b.classList.toggle('btn-secondary', !active);
      });
      renderList();
    };
  });

  const close = () => closeTop();

  addBtn.onclick = async () => {
    const checkedKeys = new Set([...overlay.querySelectorAll('.hist-cb:checked')].map(cb => cb.dataset.key));
    const picked = histRendered.filter(h => checkedKeys.has(h.key));
    const uris = picked.map(h => h.u).filter(Boolean);
    if (uris.length === 0) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Agregando...';
    try {
      await addTracksToPlaylist(playlistInfo.id, uris);
      showToast(`${uris.length} álbum${uris.length === 1 ? '' : 'es'} añadido${uris.length === 1 ? '' : 's'} a escuchados`, 'success');
      close();
      await addAlbumsLocally(picked.map(h => ({
        id: null, name: h.a, artist: h.ar, year: h.y1 ? String(h.y1) : '',
        image: h.img || likesByKey?.get(h.key)?.image || null, uri: h.u,
      })));
    } catch (err) {
      showToast('Error al añadir: ' + err.message, 'error');
      addBtn.disabled = false;
      updateAddBtn();
    }
  };
}

// Mini-modal reutilizable para ver/restaurar los álbumes ocultados de una lista.
// keys: array de albumKeys ocultados; lookup(key)->{name,artist,extra}|null; onRestore(key) desmarca; onChange() refresca el modal padre.
function openHiddenManager({ title, keys, lookup, onRestore, onChange }) {
  const overlay = openModal({
    id: `listened-hidden-mgr:${title}`,
    html: `
    <div class="modal modal-picker" style="max-width:460px">
      <h2 style="margin-bottom:8px">${escapeHtml(title)}</h2>
      <div id="hm-list" class="picker-scroll" style="border:1px solid var(--color-border);border-radius:var(--radius-sm)"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });
  const listEl = overlay.querySelector('#hm-list');

  const render = () => {
    const items = keys.map(k => ({ k, info: lookup(k) })).filter(x => x.info);
    if (items.length === 0) {
      listEl.innerHTML = `<div style="padding:14px;color:var(--color-text-muted);font-size:13px">No hay ocultos.</div>`;
      return;
    }
    listEl.innerHTML = items.map(({ k, info }) => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(info.name)}</div>
          <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(info.artist)}${info.extra ? ` · ${escapeHtml(info.extra)}` : ''}</div>
        </div>
        <button class="btn btn-secondary btn-sm hm-restore" data-key="${k}">Restaurar</button>
      </div>`).join('');
    listEl.querySelectorAll('.hm-restore').forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.key;
        onRestore(k);
        keys = keys.filter(x => x !== k);
        onChange?.();
        render();
      };
    });
  };
  render();
}

// Modal: álbumes con varios tracks en la playlist → dejar 1 por álbum, sacar los sobrantes.
// (Antes era "Álbumes repetidos" en el sidebar; ahora vive acá dentro.)
function openRepeated() {
  const cover = (a) => a.cover
    ? `<img src="${a.cover}" loading="lazy" class="pick-cover">`
    : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px">♪</div>`;

  const overlay = openModal({
    id: 'listened-repeated',
    html: `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">🎵 Álbumes repetidos (varios tracks)</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px;flex-shrink:0">
        Álbumes de los que tienes <strong>más de un track</strong> en <strong>${escapeHtml(playlistInfo.name)}</strong>. Para tener <strong>1 track por álbum</strong>, dejo el primero y saco el resto.
      </p>
      <div id="rep-selall" style="flex-shrink:0;margin-bottom:6px"></div>
      <div id="rep-list" class="picker-scroll"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-danger" id="rep-del" disabled>Dejar 1 por álbum (0)</button>
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });
  const delBtn = overlay.querySelector('#rep-del');
  const close = () => closeTop();

  const update = () => {
    const checked = [...overlay.querySelectorAll('.rep-cb:checked')];
    const extra = checked.reduce((n, cb) => n + (parseInt(cb.dataset.extra) || 0), 0);
    delBtn.textContent = `Dejar 1 por álbum (sacar ${extra})`;
    delBtn.disabled = extra === 0;
  };

  const render = () => {
    const list = computeRepeatedAlbums();
    const holder = overlay.querySelector('#rep-list');
    const selall = overlay.querySelector('#rep-selall');
    if (list.length === 0) {
      selall.innerHTML = '';
      holder.innerHTML = `<div style="color:var(--color-text-muted);font-size:13px;padding:12px">Ningún álbum tiene más de un track. 👌 Ya tienes 1 por álbum.</div>`;
      update();
      return;
    }
    selall.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-muted);cursor:pointer">
        <input type="checkbox" id="rep-all" checked> Seleccionar todos (${list.length} álbumes)
      </label>`;
    holder.innerHTML = `
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);overflow:hidden">
        ${list.map(a => `
          <label class="pick-row" style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--color-border);cursor:pointer">
            <input type="checkbox" class="rep-cb" data-albid="${a.id}" data-extra="${a.tracks.length - 1}" checked>
            ${cover(a)}
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.artist)}${a.year ? ` · ${a.year}` : ''}</div>
            </div>
            <span class="pick-pill">${a.tracks.length} → 1</span>
          </label>`).join('')}
      </div>`;
    holder.querySelectorAll('.rep-cb').forEach(cb => cb.addEventListener('change', update));
    const allCb = overlay.querySelector('#rep-all');
    if (allCb) allCb.addEventListener('change', () => {
      holder.querySelectorAll('.rep-cb').forEach(cb => { cb.checked = allCb.checked; });
      update();
    });
    update();
  };
  render();

  delBtn.onclick = async () => {
    const checked = [...overlay.querySelectorAll('.rep-cb:checked')];
    const ids = new Set(checked.map(cb => cb.dataset.albid));
    const selectedAlbums = albums.filter(a => ids.has(a.id) && a.tracks.length > 1);
    const uris = selectedAlbums.flatMap(a => a.tracks.slice(1).map(t => t.uri).filter(Boolean));
    if (uris.length === 0) return;
    const ok = await confirmModal(
      'Dejar 1 track por álbum',
      `Se van a <strong>sacar ${uris.length} tracks sobrantes</strong> de ${selectedAlbums.length} álbum${selectedAlbums.length === 1 ? '' : 'es'} en "${escapeHtml(playlistInfo.name)}", dejando 1 track por álbum. Esto modifica tu playlist en Spotify. ¿Seguro?`,
      'Sacar'
    );
    if (!ok) return;
    delBtn.disabled = true;
    delBtn.textContent = 'Sacando...';
    try {
      await removeTracksFromPlaylist(playlistInfo.id, uris);
      showToast(`${uris.length} tracks sobrantes sacados`, 'success');
      close();
      let removed = 0;
      for (const a of selectedAlbums) { removed += a.tracks.length - 1; a.tracks = [a.tracks[0]]; }
      await persistAndRebuild(Math.max(0, lastTotalTracks - removed));
    } catch (err) {
      showToast('Error al sacar: ' + err.message, 'error');
      delBtn.disabled = false;
      update();
    }
  };
}
