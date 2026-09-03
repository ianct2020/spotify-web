// Lógica común entre #discover-artists ("Sin escuchar de tus artistas") y
// #new-releases ("Novedades de tus artistas"). Ambas features:
//   - toman los artistas top de tus likes
//   - traen la discografía completa vía Spotify API (cacheada 30d en IDB)
//   - la cruzan con el índice unificado de álbumes escuchados
//     (util/album-heard.js: historial completo + likes + listened + w-three)
//   - permiten "+ Biblioteca" y "Crear playlist con lo elegido"

import { idbGetCached, idbSetCached, idbDel } from '../idb.js?v=191';
import { getArtistAlbums, searchArtistByName, getAlbumTracks, saveToLibrary, saveAlbumsToLibrary, createPlaylist, addTracksToPlaylist } from '../api.js?v=191';
import { albumKey } from '../util/album-key.js?v=191';
import { escapeHtml } from '../ui/components.js?v=191';
import { showToast } from '../ui/toast.js?v=191';
import { openPlaylistPicker } from '../ui/playlist-picker.js?v=191';
import { getOwnPlaylists, addUrisToPlaylists, toastAddResult } from '../util/playlist-add.js?v=191';
import { openArtistCard } from './artist-card.js?v=191';
import { openAlbumCard } from './album-card.js?v=191';
import { createHiddenStore, createLocalStore } from '../util/hidden-sync.js?v=191';
import { getPreview } from '../api/preview-providers.js?v=191';
import { togglePreview, playingKey, attachHover } from '../ui/preview-player.js?v=191';
import { coverUrl } from '../util/cover-size.js?v=191';
import { FILTROS as FILTROS_DEF, saveFiltros } from '../util/discover-filters.js?v=191';
import { esEPoAlbum } from '../util/release-size.js?v=191';

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
    img: coverUrl(al.images, 'grande'),
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

// ── Los dos estados de una tarjeta de descubrimiento ────────────────────────
//
// Son cosas DISTINTAS y se guardan separadas a propósito:
//
//   escuchado → "ya lo evalué". Lo puse, le di una vuelta, no necesito que me
//               lo vuelvan a ofrecer. Es una afirmación sobre lo que hice.
//   oculto    → "no me interesa". No lo escuché ni pienso hacerlo. Es una
//               afirmación sobre lo que quiero ver.
//
// Mezclarlos perdería información: si mañana Ian quiere revisar "¿qué marqué
// como escuchado?" no puede hacerlo desde una lista que también tiene los que
// descartó de plano.
//
// Fuente de verdad de los OCULTOS: una playlist de Spotify, igual que en
// #skips, #sin-clasificar y W-Three (util/hidden-sync.js, reconciliación por
// unión). La clave es un álbum, no una pista, así que —como en W-Three— se
// guarda una pista representativa y al leer se reconstruye `albumKey` desde su
// álbum.
//
// Una sola playlist para las dos vistas y no una por vista: #discover-artists y
// #new-releases muestran el MISMO objeto (un álbum de tus artistas que no
// escuchaste), solo que filtrado por criterios distintos. Ocultar un disco en
// Novedades y que te lo siga ofreciendo Sin escuchar sería un bug, no una
// separación útil.
export const hiddenAlbums = createHiddenStore({
  lsKey: 'discover_ocultos',
  playlistName: 'fonoteca · ocultos (descubrir)',
  label: 'descubrir',
  keyOfTrack: (t) => {
    const albumName = t?.album?.name;
    if (!albumName) return null;
    return albumKey(albumName, t.artists?.[0]?.name || '');
  },
});

// "Escuchado" alcanza con localStorage, pero con la MISMA forma que el store
// sincronizado (ver createLocalStore): el día que se quiera compartir entre
// máquinas, se cambia la llamada y nada más.
export const heardAlbums = createLocalStore({
  lsKey: 'discover_escuchados',
  label: 'descubrir-escuchados',
});

/** La clave con la que se identifica una tarjeta en los dos stores. */
export function cardKey(al, artistName) {
  return albumKey(al.name, artistName);
}

// El índice de escuchados de util/album-heard.js manda igual que antes; encima
// se suma lo que Ian resolvió a mano —«Escuchado», «Guardar álbum», «Añadir
// pistas a mis likes»—, que persiste entre sesiones en `heardAlbums`.
export function albumIsUnheard(al, artistName, heardSet) {
  const k = albumKey(al.name, artistName);
  return !heardSet.has(k) && !heardAlbums.has(k);
}

// ── Preview de un álbum ──────────────────────────────────────────────────────
//
// La cadena de proveedores (api/preview-providers.js) busca CANCIONES, y acá lo
// que hay son álbumes que —por definición de la vista— no están en tus likes,
// así que no hay ninguna pista conocida de la que tirar. Se resuelve una pista
// representativa con `GET /albums/{id}/tracks` (la primera del disco) y se
// memoiza por álbum: el hover puede pasar diez veces por la misma tarjeta y es
// una sola llamada.
//
// Si ese endpoint cae (no está confirmado vivo post-migración, ver CLAUDE.md),
// se prueba con el nombre del álbum como si fuera el de la canción: en los
// singles —que son la mitad de esta vista— acierta casi siempre.
const trackMemo = new Map();   // albumId → { name, artists, uri } | null

export async function representativeTrack(al, artistName) {
  if (!al?.id) return null;
  if (trackMemo.has(al.id)) return trackMemo.get(al.id);
  let out = null;
  try {
    const tracks = await getAlbumTracks(al.id, { limit: 50 });
    const t = tracks.find(x => x?.name) || null;
    if (t) {
      out = {
        name: t.name,
        artists: (t.artists || []).map(a => a?.name).filter(Boolean),
        uri: t.uri || (t.id ? `spotify:track:${t.id}` : null),
      };
    }
  } catch (e) {
    console.warn(`[discover] tracklist de «${al.name}»:`, e.message);
  }
  if (out && !out.artists.length) out.artists = [artistName].filter(Boolean);
  trackMemo.set(al.id, out);
  return out;
}

/**
 * Getter para el player global. Sin `spotifyId` a propósito: el embed de
 * Spotify no puede autoarrancar en un iframe cross-origin, así que como preview
 * de una tarjeta no sirve — o hay audio de iTunes/Deezer, o no suena.
 */
export async function getAlbumPreview(al, artistName) {
  const rep = await representativeTrack(al, artistName);
  const nombre = rep?.name || al.name;
  const artistas = rep?.artists?.length ? rep.artists : [artistName].filter(Boolean);
  return await getPreview({ name: nombre, artists: artistas });
}

/** La uri con la que se representa el álbum en la playlist de ocultos. */
export async function albumRepresentativeUri(al, artistName) {
  const rep = await representativeTrack(al, artistName);
  return rep?.uri || null;
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

const PLAY_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const DOTS_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
// «Sin preview» dicho con todas las letras (v=150): el «—» de antes se leía
// como un botón roto, no como una respuesta.
const SIN_PREVIEW_HTML = '<span class="sin-preview-txt">Sin preview</span>';
const OJO_TACHADO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const OJO_ABIERTO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

/** La key del player global para una tarjeta. Una sola, para las dos vistas. */
export function previewKeyOf(albumId) {
  return `dc:${albumId}`;
}

// Cuando el player cambia de canción (o para), los ▶/⏸ de TODAS las tarjetas
// pintadas se ponen al día solos. Va acá y no en cada vista justamente porque
// las dos usan la misma tarjeta.
document.addEventListener('previewchange', (e) => {
  const key = e.detail?.key || '';
  document.querySelectorAll('.dcard-play').forEach(btn => {
    if (btn.disabled) return;
    btn.innerHTML = (key === previewKeyOf(btn.dataset.previewAlbum)) ? PAUSE_SVG : PLAY_SVG;
    btn.classList.toggle('is-playing', key === previewKeyOf(btn.dataset.previewAlbum));
  });
});

/**
 * La tapa va con `data-src` y NO con `src` (v=144): las dos vistas pintan por
 * lotes y las tapas las asigna `ui/lazy-img.js` contra el scroller de verdad.
 * El `loading="lazy"` nativo no alcanzaba — resuelve contra el viewport del
 * documento y disparaba las tapas de todo el lote de golpe. El `width`/`height`
 * explícito es obligatorio: sin él, al DESCARGAR una tapa fuera de vista el
 * hueco se cerraría y el scroll pegaría un salto.
 *
 * Quien pinte estas tarjetas TIENE que llamar a `lazy.observe(nodos)` sobre lo
 * recién insertado, o las tapas nunca cargan.
 *
 * @param {object} al  álbum slim (id, name, type, img, release, total)
 * @param {string} artistName
 * @param {object} [opts]
 * @param {string} [opts.checkClass]
 * @param {boolean} [opts.selected]
 * @param {boolean} [opts.showHeard]  muestra «Escuchado» (solo #discover-artists)
 * @param {boolean} [opts.hiddenMode] la tarjeta se está viendo en la lista de
 *                                    ocultos: el ojo la devuelve en vez de ocultarla
 */
export function renderAlbumCard(al, artistName, {
  checkClass = 'dcard-check', selected = false, showHeard = false, hiddenMode = false,
} = {}) {
  const tipo = al.type === 'single' ? 'single' : (al.type === 'compilation' ? 'recopilatorio' : 'álbum');
  // El botón dice a dónde va DE VERDAD. Un single suelto no se guarda en la
  // biblioteca: va a la playlist «fonoteca · sin escuchar» (ver
  // `guardarLanzamiento`). La lección de v=147 fue exactamente esta — el botón
  // «+ Biblioteca» no estaba roto, mentía el nombre.
  const esDisco = esEPoAlbum(al.total);
  const guardarLabel = esDisco ? 'Guardar álbum' : 'Guardar single';
  const guardarTitle = esDisco
    ? 'Guardar el disco entero en tu biblioteca de álbumes'
    : `Añadir sus pistas a la playlist «${PLAYLIST_SINGLES}» — un single suelto ensucia la biblioteca de álbumes`;
  const id = escapeHtml(al.id);
  const artista = escapeHtml(artistName);
  const sonando = playingKey() === previewKeyOf(al.id);
  return `
    <div class="dcard${selected ? ' is-sel' : ''}" data-id="${id}" data-artist="${artista}">
      <label class="dcard-check-wrap" title="Seleccionar">
        <input type="checkbox" class="${checkClass}" data-id="${id}"${selected ? ' checked' : ''} aria-label="Seleccionar ${escapeHtml(al.name)}">
      </label>
      <div class="dcard-top">
        <div class="dcard-cover-wrap" data-hover-album="${id}">
          <button type="button" class="dcard-cover" data-open-album="${id}" data-open-artist="${artista}" title="Ver ficha del álbum">
            ${al.img
              ? `<img data-src="${escapeHtml(al.img)}" alt="" width="104" height="104" class="dcard-img">`
              : `<span class="dcard-img dcard-img-empty">♪</span>`}
          </button>
          <button type="button" class="dcard-play${sonando ? ' is-playing' : ''}" data-preview-album="${id}"
                  title="Preview de 30 s — no suma reproducciones" aria-label="Preview">${sonando ? PAUSE_SVG : PLAY_SVG}</button>
        </div>
        <div class="dcard-info">
          <button type="button" class="dcard-name" data-open-album="${id}" data-open-artist="${artista}">${escapeHtml(al.name)}</button>
          <button type="button" class="dcard-artist" data-open-artist-card="${artista}">${artista}</button>
          <div class="dcard-meta">${escapeHtml(fmtRelease(al.release))} · ${tipo}</div>
          <div class="dcard-meta">${al.total ? `${al.total} pista${al.total === 1 ? '' : 's'}` : 'pistas: sin dato'}</div>
        </div>
      </div>
      <div class="dcard-actions">
        <button class="btn btn-secondary btn-sm" data-save-album="${id}" data-save-artist="${artista}" title="${escapeHtml(guardarTitle)}">${escapeHtml(guardarLabel)}</button>
        <button class="btn btn-secondary btn-sm" data-liketracks-album="${id}" data-save-artist="${artista}" title="Darle al corazón a cada pista del disco, una por una">Añadir pistas a mis likes</button>
        <button class="btn btn-secondary btn-sm" data-addpl-album="${id}" title="Añadir todas las pistas a una o varias playlists">Añadir a playlist…</button>
        ${showHeard ? `<button class="btn btn-secondary btn-sm" data-heard-album="${id}" title="Ya lo escuchaste y lo evaluaste: deja de aparecer">Escuchado</button>` : ''}
        <button class="btn btn-secondary btn-sm dcard-hide" data-hide-album="${id}"
                title="${hiddenMode ? 'Devolver a la lista' : 'No me interesa: no volver a mostrarlo (no toca tu biblioteca)'}"
                aria-label="${hiddenMode ? 'Devolver' : 'Ocultar'}">${hiddenMode ? OJO_ABIERTO : OJO_TACHADO}</button>
      </div>
    </div>
  `;
}

// Los botones de la tarjeta, convertidos en acciones para la ficha de álbum.
// El `label` sale del botón real cuando lo tiene (así «Guardar álbum» y
// «Guardar single» siguen diciendo a dónde va cada cosa de verdad); el del ojo
// se pone acá porque en la tarjeta es un icono sin texto.
const ACCIONES_TARJETA = [
  { sel: '[data-save-album]' },
  { sel: '[data-liketracks-album]' },
  { sel: '[data-addpl-album]' },
  { sel: '[data-heard-album]' },
  { sel: '.dcard-hide', label: 'Ocultar' },
];

function accionesDeLaTarjeta(tarjeta) {
  if (!tarjeta) return [];
  const out = [];
  for (const { sel, label } of ACCIONES_TARJETA) {
    const b = tarjeta.querySelector(sel);
    if (!b) continue;   // «Escuchado» solo existe en #discover-artists
    out.push({
      label: label || (b.textContent || '').trim(),
      title: b.title,
      // Cerrar primero: casi todas estas acciones sacan el álbum de la lista
      // que hay detrás, y además «Añadir a playlist…» abre SU propio modal.
      onClick: ({ cerrar }) => { cerrar(); b.click(); },
    });
  }
  return out;
}

// Cablea una grilla ya pintada con renderAlbumCard. Las dos vistas usan los
// mismos data-attributes, así que el wiring también es uno solo.
export function wireAlbumCards(list, findAlbumById, {
  checkClass, selection, onSave, onLikeTracks, onChange, afterAdd, onHeard, onHide,
}) {
  // ── Preview: botón ▶ y hover sobre la tapa ──
  // El getter es el mismo en los dos caminos; `hoverIn` (dentro de attachHover)
  // trae el debounce de 400 ms, así que barrer la grilla con el mouse no
  // dispara ninguna búsqueda ni ninguna llamada a /albums/{id}/tracks.
  list.querySelectorAll('[data-preview-album]').forEach(btn => {
    const al = findAlbumById(btn.dataset.previewAlbum);
    const artista = btn.closest('.dcard')?.dataset.artist || '';
    if (!al) return;
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const previo = btn.innerHTML;
      btn.innerHTML = DOTS_SVG;
      const res = await togglePreview(previewKeyOf(al.id), () => getAlbumPreview(al, artista));
      if (res === true) btn.innerHTML = PAUSE_SVG;
      else if (res === null) {
        btn.innerHTML = SIN_PREVIEW_HTML;
        btn.classList.add('sin-preview');
        btn.title = 'Sin preview en iTunes ni en Deezer';
        btn.disabled = true;
        showToast(`Sin preview disponible de «${al.name}»`, 'info');
      } else btn.innerHTML = previo === DOTS_SVG ? PLAY_SVG : previo;
    };
  });
  list.querySelectorAll('[data-hover-album]').forEach(wrap => {
    const al = findAlbumById(wrap.dataset.hoverAlbum);
    const artista = wrap.closest('.dcard')?.dataset.artist || '';
    if (!al) return;
    attachHover(wrap, previewKeyOf(al.id), () => getAlbumPreview(al, artista));
  });

  if (onHeard) {
    list.querySelectorAll('[data-heard-album]').forEach(btn => {
      btn.onclick = () => onHeard(btn.dataset.heardAlbum, btn.closest('.dcard')?.dataset.artist || '', btn);
    });
  }
  list.querySelectorAll('[data-hide-album]').forEach(btn => {
    btn.onclick = () => onHide?.(btn.dataset.hideAlbum, btn.closest('.dcard')?.dataset.artist || '', btn);
  });

  list.querySelectorAll('[data-open-artist-card]').forEach(btn => {
    btn.onclick = () => openArtistCard({ name: btn.dataset.openArtistCard });
  });
  // La ficha es LA MISMA del resto de la app (features/album-card.js), con los
  // botones de esta vista encima (v=165). Y esos botones no reimplementan nada:
  // cada uno **aprieta el de la tarjeta**, así que el guardado, el likeo, el
  // picker de playlists y los dos stores siguen viviendo en un solo sitio y no
  // hay forma de que la ficha y la grilla se desincronicen.
  list.querySelectorAll('[data-open-album]').forEach(btn => {
    btn.onclick = () => {
      const al = findAlbumById(btn.dataset.openAlbum);
      if (!al) return;
      const tarjeta = btn.closest('.dcard');
      openAlbumCard({
        name: al.name, artist: btn.dataset.openArtist, img: al.img,
        plays: 0, min: 0, albumId: al.id, totalTracks: al.total,
        acciones: accionesDeLaTarjeta(tarjeta),
      });
    };
  });
  list.querySelectorAll('[data-save-album]').forEach(btn => {
    btn.onclick = () => onSave(btn.dataset.saveAlbum, btn.dataset.saveArtist, btn);
  });
  list.querySelectorAll('[data-liketracks-album]').forEach(btn => {
    btn.onclick = () => onLikeTracks?.(btn.dataset.liketracksAlbum, btn.dataset.saveArtist, btn);
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

// ── Acciones de los dos estados, compartidas por las dos vistas ─────────────

/**
 * Marca/desmarca "ya lo evalué". Es instantáneo: solo localStorage.
 * @returns {boolean} true si quedó marcado como escuchado
 */
export function toggleHeardAlbum(al, artistName) {
  return heardAlbums.toggle(cardKey(al, artistName), null);
}

/**
 * Oculta/devuelve un álbum. Antes de tocar el store resuelve la pista
 * representativa, que es lo que se sube a la playlist de Spotify: sin uri el
 * ocultamiento queda solo local y no viaja a la otra máquina, que es
 * exactamente el problema que la playlist vino a resolver.
 *
 * La resolución está memoizada por álbum, así que si el usuario ya escuchó el
 * preview de esa tarjeta no cuesta ninguna llamada.
 *
 * @returns {Promise<boolean>} true si quedó oculto
 */
export async function toggleHiddenAlbum(al, artistName) {
  const key = cardKey(al, artistName);
  let uri = null;
  try {
    uri = await albumRepresentativeUri(al, artistName);
  } catch { /* sin uri: queda local, el store lo reintenta en cada sync */ }
  return hiddenAlbums.toggle(key, uri);
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
      // Si no entró en ninguna playlist, el toast de arriba ya lo contó: no hay
      // nada que refrescar en la vista.
      if (!res.ok.length && !res.skipped.length) return;
      if (onDone) onDone();
    },
  });
}

// Las DOS cosas distintas que se pueden hacer con un álbum, cada una con su
// nombre. Hasta v=147 había un solo botón —«+ Biblioteca»— que llamaba a
// `saveAlbumTracksToLibrary`: Ian lo apretó esperando guardar el disco y le
// entraron sus 12 pistas sueltas en los me gusta. El botón no estaba roto, el
// nombre mentía.

/** Guarda el ÁLBUM como unidad. No toca los me gusta de las pistas. */
export async function saveAlbumToLibrary(albumId) {
  if (!albumId) throw new Error('álbum sin id');
  await saveAlbumsToLibrary([albumId]);
  return albumId;
}

// ── Guardar un lanzamiento: la biblioteca no es para todo (v=152) ──────────
//
// Un single suelto guardado como «álbum» ensucia la biblioteca: entre discos
// de verdad aparecen decenas de fichas de una pista. Así que el destino
// depende del tamaño:
//
//   < 4 pistas  → single suelto  → a la playlist «fonoteca · sin escuchar»
//   ≥ 4 pistas  → EP o álbum     → a la biblioteca, como hasta ahora
//
// El umbral sale de `util/release-size.js`, que es el MISMO que ya usaba
// `features/listened.js` desde v=127 para partir «Sin registrar». El encargo
// de esta tanda decía «menos de 5 / 5 o más», pero se respeta el criterio que
// ya estaba: con 5 un EP de 4 pistas iría a la playlist en una vista y
// contaría como EP en la otra.
//
// ⚠️ La playlist se crea PÚBLICA y no hay forma de evitarlo: `POST
// /me/playlists` ignora el campo `public` post-migración (verificado 2026-08-09,
// ver CLAUDE.md). Hay que pasarla a privada a mano desde la app de Spotify,
// como las otras cinco de fonoteca. Por eso el toast lo dice.
export const PLAYLIST_SINGLES = 'fonoteca · sin escuchar';

let _plSinglesId = null;

/** Busca la playlist de singles y la crea si no está. Memoizada por sesión. */
export async function ensureSinglesPlaylist() {
  if (_plSinglesId) return { id: _plSinglesId, creada: false };
  const propias = await getOwnPlaylists();
  const ya = propias.find(p => (p.name || '').trim() === PLAYLIST_SINGLES);
  if (ya) { _plSinglesId = ya.id; return { id: ya.id, creada: false }; }
  const creada = await createPlaylist(
    PLAYLIST_SINGLES,
    'Singles de tus artistas que todavía no escuchaste. Generada por Fonoteca.',
    false,
  );
  _plSinglesId = creada.id;
  // La lista de playlists propias quedó vieja: sin esto, el próximo
  // `ensureSinglesPlaylist` de la sesión no la encontraría y crearía otra.
  await getOwnPlaylists({ force: true });
  return { id: creada.id, creada: true };
}

/**
 * Guarda un lanzamiento donde corresponda según su tamaño.
 * @returns {Promise<{destino:'biblioteca'|'playlist', pistas?:number, yaEstaban?:number, playlistCreada?:boolean}>}
 */
export async function guardarLanzamiento(al) {
  if (!al?.id) throw new Error('lanzamiento sin id');

  const total = al.total || (await getAlbumTracks(al.id)).length;
  if (esEPoAlbum(total)) {
    await saveAlbumsToLibrary([al.id]);
    return { destino: 'biblioteca' };
  }

  const tracks = await getAlbumTracks(al.id);
  const uris = tracks.map(t => t.uri).filter(Boolean);
  if (!uris.length) throw new Error('el lanzamiento no tiene pistas');
  const namesByUri = new Map(tracks.filter(t => t.uri && t.name).map(t => [t.uri, t.name]));

  const { id, creada } = await ensureSinglesPlaylist();
  // `addUrisToPlaylists` es el de util/playlist-add.js: ya mira los items de la
  // playlist antes de escribir y descarta las uris repetidas, así que añadir
  // dos veces el mismo single no lo duplica.
  const res = await addUrisToPlaylists(uris, [{ id, name: PLAYLIST_SINGLES }], { namesByUri });
  if (res.failed?.length) throw new Error(res.failed[0]?.message || 'no se pudo añadir a la playlist');
  // La forma que devuelve util/playlist-add.js: `detail[]` trae `added` y `dup`
  // de las que SÍ se escribieron, y `skipped[]` son las playlists en las que ya
  // estaba todo (ahí no hubo POST y no hay entrada en `detail`).
  const añadidas = (res.detail || []).reduce((n, d) => n + (d.added || 0), 0);
  const yaEstaban = (res.detail || []).reduce((n, d) => n + (d.dup || 0), 0)
    + (res.skipped || []).reduce((n, sk) => n + (sk.uris?.length || 0), 0);
  return { destino: 'playlist', pistas: añadidas, yaEstaban, playlistCreada: creada };
}

/** Likea UNA POR UNA todas las pistas del álbum. No guarda el álbum. */
export async function saveAlbumTracksToLibrary(albumId) {
  const tracks = await getAlbumTracks(albumId);
  const ids = tracks.map(t => t.id).filter(Boolean);
  if (!ids.length) throw new Error('el álbum no tiene pistas');
  await saveToLibrary(ids);
  return ids;
}

/**
 * Cuántas pistas tiene el álbum, para poder DECIRLO antes de likearlas.
 * Usa el dato que ya trae la tarjeta si lo hay; si no, lo pregunta.
 */
export async function albumTrackCount(al) {
  if (al?.total) return al.total;
  try { return (await getAlbumTracks(al.id)).length; } catch { return 0; }
}

/**
 * Un álbum guardado (o con todas sus pistas likeadas) ya está resuelto: tiene
 * que dejar de aparecer en «Sin escuchar» y en «Novedades», y tiene que
 * seguir sin aparecer después de recargar. `markAlbumHeard` solo tocaba el
 * índice EN MEMORIA, así que la tarjeta volvía en la siguiente sesión — que es
 * lo que más confundía.
 */
export function markAlbumResolved(al, artistName) {
  return heardAlbums.add(cardKey(al, artistName), null);
}

// ── Los filtros como chips de la topbar (v=152, siete desde v=165) ──────────────────────
//
// Comparten módulo porque las dos vistas muestran el MISMO objeto (un
// lanzamiento de tus artistas que no escuchaste) y tienen que filtrarlo igual.
// La lógica vive en util/discover-filters.js; acá solo está el HTML y el
// cableado, que también es uno solo.

/**
 * Los chips, con el conteo de lo que descarta cada criterio al lado.
 * El número se muestra SIEMPRE, esté el filtro encendido o apagado: apagado
 * dice cuántos está dejando entrar, y encendido cuántos está sacando.
 */
export function renderFiltroChips(estado, conteos) {
  return `
    <div class="disco-filtros" id="disco-filtros" role="group" aria-label="Filtros de la lista">
      ${FILTROS_DEF.map(f => `
        <button type="button" class="disco-filtro ${estado[f.key] ? 'is-on' : ''}"
                data-filtro="${f.key}" aria-pressed="${!!estado[f.key]}" title="${escapeHtml(f.ayuda)}">
          <span class="disco-filtro-txt">${escapeHtml(f.corto)}</span>
          <span class="disco-filtro-n">${(conteos?.[f.key] ?? 0).toLocaleString('es-ES')}</span>
        </button>
      `).join('')}
    </div>
  `;
}

/** Cablea los chips. `onChange(key, nuevoEstado)` repinta la lista. */
export function wireFiltroChips(root, estado, onChange) {
  root.querySelector('#disco-filtros')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filtro]');
    if (!btn) return;
    const k = btn.dataset.filtro;
    estado[k] = !estado[k];
    saveFiltros(estado);
    btn.classList.toggle('is-on', estado[k]);
    btn.setAttribute('aria-pressed', String(!!estado[k]));
    onChange(k, estado);
  });
}
