// Lógica común entre #discover-artists ("Sin escuchar de tus artistas") y
// #new-releases ("Novedades de tus artistas"). Ambas features:
//   - toman los artistas top de tus likes
//   - traen la discografía completa vía Spotify API (cacheada 30d en IDB)
//   - la cruzan con el índice unificado de álbumes escuchados
//     (util/album-heard.js: historial completo + likes + listened + w-three)
//   - permiten "+ Biblioteca" y "Crear playlist con lo elegido"

import { idbGetCached, idbSetCached, idbDel } from '../idb.js?v=140';
import { getArtistAlbums, searchArtistByName, getAlbumTracks, saveToLibrary, createPlaylist, addTracksToPlaylist } from '../api.js?v=140';
import { albumKey } from '../util/album-key.js?v=140';
import { escapeHtml } from '../ui/components.js?v=140';
import { showToast } from '../ui/toast.js?v=140';
import { openPlaylistPicker } from '../ui/playlist-picker.js?v=140';
import { getOwnPlaylists, addUrisToPlaylists, toastAddResult } from '../util/playlist-add.js?v=140';
import { openArtistCard } from './artist-card.js?v=140';
import { openAlbumCard } from './album-card.js?v=140';

const DISCO_TTL_MIN = 30 * 24 * 60;       // 30 días
const ARTIST_ID_TTL_MIN = 60 * 24 * 60;   // 60 días — los ids no cambian

export async function getArtistIdCached(nameLower, displayName, seedId) {
  const key = `discover_artist_id_${nameLower}`;
  if (seedId) {
    try { await idbSetCached(key, seedId, ARTIST_ID_TTL_MIN); } catch { /* ignora */ }
    return seedId;
  }
  try {
    const cached = await idbGetCached(key);
    if (cached) return cached;
  } catch { /* ignora */ }
  const found = await searchArtistByName(displayName);
  if (!found?.id) return null;
  try { await idbSetCached(key, found.id, ARTIST_ID_TTL_MIN); } catch { /* ignora */ }
  return found.id;
}

// v2 en la key: la v1 guardó discografías VACÍAS durante 30 días cuando el
// endpoint fallaba, y esas entradas vacías se seguían sirviendo aunque el
// fetch ya estuviera arreglado. Además ahora no cacheamos resultados vacíos.
export async function getArtistDiscoCached(artistId, artistName) {
  const key = `discover_artist_disco_v2_${artistId}`;
  try {
    const cached = await idbGetCached(key);
    if (Array.isArray(cached) && cached.length) return cached;
  } catch { /* ignora */ }
  // Sin limit explícito: api.js sabe cuál es el máximo que acepta Spotify hoy
  // (10 desde 2026-08-11) y pagina hasta el final igual.
  const items = await getArtistAlbums(artistId, artistName, { includeSingles: true });
  const slim = items.map(al => ({
    id: al.id,
    name: al.name,
    type: al.album_type,          // 'album' | 'single' | 'compilation'
    img: al.images?.[1]?.url || al.images?.[0]?.url || null,
    release: al.release_date || '',
    total: al.total_tracks || 0,
    artists: (al.artists || []).map(a => ({ id: a.id, name: a.name })),
  }));
  if (slim.length) {
    try { await idbSetCached(key, slim, DISCO_TTL_MIN); } catch { /* ignora */ }
  }
  return slim;
}

// ── Cache del escaneo COMPLETO (no solo de la discografía por artista) ──
// Sin esto, entrar a la vista dispara 150 escaneos cada vez. Guardamos el
// resultado ya cruzado con TTL de 7 días; el botón "Actualizar" lo tira.

const SCAN_TTL_MIN = 7 * 24 * 60;   // 7 días

export async function loadScanCache(viewKey) {
  try {
    const data = await idbGetCached(`discover_scan_${viewKey}`);
    return data && Array.isArray(data.artists) ? data : null;
  } catch { return null; }
}

export async function saveScanCache(viewKey, artists) {
  try {
    await idbSetCached(`discover_scan_${viewKey}`, { ts: Date.now(), artists }, SCAN_TTL_MIN);
  } catch { /* ignora */ }
}

export async function clearScanCache(viewKey, artistIds = []) {
  try { await idbDel(`discover_scan_${viewKey}`); } catch { /* ignora */ }
  // "Actualizar" tiene que traer datos frescos de verdad: también tiramos las
  // discografías cacheadas de los artistas ya escaneados.
  for (const id of artistIds) {
    if (!id) continue;
    try { await idbDel(`discover_artist_disco_v2_${id}`); } catch { /* ignora */ }
  }
}

// "hace 3 días" / "hoy" para el sub-texto del botón Actualizar.
export function agoLabel(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

export function yearOf(release) {
  const y = parseInt((release || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

export function releaseTs(release) {
  // "YYYY", "YYYY-MM", "YYYY-MM-DD" → ms epoch (UTC, día 15 si falta día)
  const s = release || '';
  const y = parseInt(s.slice(0, 4), 10);
  if (!Number.isFinite(y)) return 0;
  const m = parseInt(s.slice(5, 7), 10) || 6;
  const d = parseInt(s.slice(8, 10), 10) || 15;
  return Date.UTC(y, m - 1, d);
}

// Deduplica ediciones del mismo álbum (deluxe, remaster, etc). Nos quedamos
// con la primera edición (release date más antiguo).
export function dedupDisco(disco) {
  const map = new Map();
  for (const al of disco) {
    const artistName = al.artists?.[0]?.name || '';
    const k = albumKey(al.name, artistName);
    const prev = map.get(k);
    if (!prev) { map.set(k, al); continue; }
    const prevY = yearOf(prev.release);
    const curY = yearOf(al.release);
    if (curY && (!prevY || curY < prevY)) map.set(k, al);
    else if (curY === prevY && !prev.img && al.img) map.set(k, al);
  }
  return [...map.values()];
}

export function albumIsUnheard(al, artistName, heardSet) {
  const k = albumKey(al.name, artistName);
  return !heardSet.has(k);
}

// Crea la playlist "Descubrir · YYYY-MM-DD" con los álbumes seleccionados.
// callback opcional para setear el estado del botón.
export async function createDiscoverPlaylist(albumIds, findAlbumById, { label = 'Descubrir' } = {}) {
  const allTrackUris = [];
  for (const albumId of albumIds) {
    const tracks = await getAlbumTracks(albumId);
    tracks.forEach(t => { if (t.uri) allTrackUris.push(t.uri); });
  }
  if (!allTrackUris.length) throw new Error('los álbumes seleccionados no tienen pistas');

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const name = `${label} · ${dateStr}`;
  const desc = `${albumIds.length} álbumes/singles de tus artistas favoritos que aún no escuchaste. Generado por Fonoteca.`;
  const created = await createPlaylist(name, desc, false);

  for (let i = 0; i < allTrackUris.length; i += 100) {
    const chunk = allTrackUris.slice(i, i + 100);
    await addTracksToPlaylist(created.id, chunk);
  }
  return { name, tracks: allTrackUris.length };
}

// ── Tarjeta compartida de lanzamiento (#new-releases y #discover-artists) ──
// Las dos vistas pintan lo mismo: tapa grande, nombre, artista, fecha, tipo,
// nº de pistas, checkbox y los dos botones de acción. Un solo componente para
// que no se separen otra vez.

// "2026-07-11" a partir de "YYYY", "YYYY-MM" o "YYYY-MM-DD".
export function fmtRelease(release) {
  const s = release || '';
  if (s.length >= 10) return s.slice(0, 10);
  if (s.length >= 7) return `${s}-01`;
  const y = yearOf(s);
  return y ? String(y) : '—';
}

export function renderAlbumCard(al, artistName, { checkClass = 'dcard-check', selected = false } = {}) {
  const tipo = al.type === 'single' ? 'single' : (al.type === 'compilation' ? 'recopilatorio' : 'álbum');
  const id = escapeHtml(al.id);
  const artista = escapeHtml(artistName);
  return `
    <div class="dcard${selected ? ' is-sel' : ''}" data-id="${id}">
      <label class="dcard-check-wrap" title="Seleccionar">
        <input type="checkbox" class="${checkClass}" data-id="${id}"${selected ? ' checked' : ''} aria-label="Seleccionar ${escapeHtml(al.name)}">
      </label>
      <div class="dcard-top">
        <button type="button" class="dcard-cover" data-open-album="${id}" data-open-artist="${artista}" title="Ver ficha del álbum">
          ${al.img
            ? `<img src="${al.img}" alt="" loading="lazy" class="dcard-img">`
            : `<span class="dcard-img dcard-img-empty">♪</span>`}
        </button>
        <div class="dcard-info">
          <button type="button" class="dcard-name" data-open-album="${id}" data-open-artist="${artista}">${escapeHtml(al.name)}</button>
          <button type="button" class="dcard-artist" data-open-artist-card="${artista}">${artista}</button>
          <div class="dcard-meta">${escapeHtml(fmtRelease(al.release))} · ${tipo}</div>
          <div class="dcard-meta">${al.total ? `${al.total} pista${al.total === 1 ? '' : 's'}` : 'pistas: sin dato'}</div>
        </div>
      </div>
      <div class="dcard-actions">
        <button class="btn btn-secondary btn-sm" data-save-album="${id}" data-save-artist="${artista}" title="Guardar todas las pistas en tu biblioteca">+ Biblioteca</button>
        <button class="btn btn-secondary btn-sm" data-addpl-album="${id}" title="Añadir todas las pistas a una o varias playlists">Añadir a playlist…</button>
      </div>
    </div>
  `;
}

// Cablea una grilla ya pintada con renderAlbumCard. Las dos vistas usan los
// mismos data-attributes, así que el wiring también es uno solo.
export function wireAlbumCards(list, findAlbumById, { checkClass, selection, onSave, onChange, afterAdd }) {
  list.querySelectorAll('[data-open-artist-card]').forEach(btn => {
    btn.onclick = () => openArtistCard({ name: btn.dataset.openArtistCard });
  });
  list.querySelectorAll('[data-open-album]').forEach(btn => {
    btn.onclick = () => {
      const al = findAlbumById(btn.dataset.openAlbum);
      if (!al) return;
      openAlbumCard({ name: al.name, artist: btn.dataset.openArtist, img: al.img, plays: 0, min: 0, albumId: al.id, totalTracks: al.total });
    };
  });
  list.querySelectorAll('[data-save-album]').forEach(btn => {
    btn.onclick = () => onSave(btn.dataset.saveAlbum, btn.dataset.saveArtist, btn);
  });
  list.querySelectorAll('[data-addpl-album]').forEach(btn => {
    btn.onclick = async () => {
      const texto = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Abriendo…';
      try {
        await addAlbumsToPlaylists([btn.dataset.addplAlbum], findAlbumById, { onDone: afterAdd });
      } catch (e) {
        showToast('No se pudieron cargar tus playlists: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = texto;
      }
    };
  });
  list.querySelectorAll(`.${checkClass}`).forEach(cb => {
    cb.checked = selection.has(cb.dataset.id);
    cb.onchange = () => {
      if (cb.checked) selection.add(cb.dataset.id);
      else selection.delete(cb.dataset.id);
      cb.closest('.dcard')?.classList.toggle('is-sel', cb.checked);
      onChange();
    };
  });
}

// Abre el modal multi-selección y añade TODAS las pistas de los álbumes
// indicados a cada playlist marcada. Compartido por las dos vistas.
export async function addAlbumsToPlaylists(albumIds, findAlbumById, { onDone } = {}) {
  const playlists = await getOwnPlaylists();
  const nombres = albumIds.map(id => findAlbumById(id)?.name).filter(Boolean);
  const subtitulo = albumIds.length === 1
    ? (nombres[0] || '')
    : `${albumIds.length} lanzamientos: ${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? '…' : ''}`;

  openPlaylistPicker({
    id: 'disco-add-pl',
    title: albumIds.length === 1 ? 'Añadir a playlists' : 'Añadir la selección a playlists',
    subtitle: subtitulo,
    playlists,
    onReload: () => getOwnPlaylists({ force: true }),
    onConfirm: async (elegidas, { setStatus } = {}) => {
      const uris = [];
      const namesByUri = new Map();
      for (const albumId of albumIds) {
        const tracks = await getAlbumTracks(albumId);
        tracks.forEach(t => {
          if (!t.uri) return;
          uris.push(t.uri);
          if (t.name) namesByUri.set(t.uri, t.name);
        });
      }
      if (!uris.length) throw new Error('los lanzamientos elegidos no tienen pistas');
      const res = await addUrisToPlaylists(uris, elegidas, { namesByUri, onStatus: setStatus });
      // Muchos «lanzamientos» son singles de una sola pista: sin esto el toast
      // decía "1 pistas … se añadieron".
      const pistas = `${uris.length} pista${uris.length === 1 ? '' : 's'}`;
      toastAddResult(res, {
        what: albumIds.length === 1
          ? `${pistas} de «${nombres[0] || 'el lanzamiento'}»`
          : `${pistas} de ${albumIds.length} lanzamientos`,
        plural: uris.length !== 1,
      });
      // Si ya estaba todo, el modal se cierra igual: no es un fallo.
      if (!res.ok.length && !res.skipped.length) throw new Error('no se pudo añadir a ninguna playlist');
      if (onDone) onDone();
    },
  });
}

export async function saveAlbumTracksToLibrary(albumId) {
  const tracks = await getAlbumTracks(albumId);
  const ids = tracks.map(t => t.id).filter(Boolean);
  if (!ids.length) throw new Error('el álbum no tiene pistas');
  await saveToLibrary(ids);
  return ids;
}
