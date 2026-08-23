import { getAllLikedTracks, removeLikedTracks, checkLibraryContains } from '../api.js?v=155';
import { showProgress, hideProgress, progressController, isCancelled, typeConfirmModal, renderTrackRow, escapeHtml, pageHeader } from '../ui/components.js?v=155';
import { showToast } from '../ui/toast.js?v=155';
import { openModal, closeTop } from '../ui/modal-stack.js?v=155';
import { coverUrl } from '../util/cover-size.js?v=155';
import { openPlaylistPicker } from '../ui/playlist-picker.js?v=155';
import { getOwnPlaylists, addUrisToPlaylists, toastAddResult } from '../util/playlist-add.js?v=155';

const keepIds = new Set();
// Persiste los cluster idx que ya resolviste (batchDelete). Sobrevive a "Ver más"
// y a re-renders del listado — así podés ver de dónde seguir la sesión.
const resolvedClusterIdxs = new Set();
// Clusters que Ian ocultó ("no es duplicado"). Persistido en localStorage por clave
// del cluster (no por idx, así sobrevive a re-analizar).
const DISMISS_KEY = 'versions_dismissed';
function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
}
function saveDismissed(s) {
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...s]));
}
let allClusters = [];
// Las pistas fantasma (ver `esFantasma`) salen del listado de clusters y van a
// su propia tarjeta: no son versiones de nada.
let fantasmas = [];
// 6.3: el toggle deja trabajar solo sobre lo que falta sin perder lo resuelto.
let ocultarResueltas = false;
// Snapshot de metadata por cluster key (para poder mostrar ocultos con tapa aunque
// hayan salido del listado tras un análisis nuevo).
const clusterMetaCache = new Map();
const SHOWN_STEP = 50;
let shownCount = SHOWN_STEP;

export function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Versiones Duplicadas' })}
    <div class="feature-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary" id="versions-analyze-btn">Analizar</button>
      <button class="btn btn-secondary" id="versions-refresh-btn" title="Vuelve a bajar tus likes desde Spotify (usalo si borraste versiones y todavía aparecen)">↻ Re-analizar (bajar likes de nuevo)</button>
      <button class="btn btn-secondary" id="versions-hidden-btn" style="margin-left:auto">Ver ocultos <span id="versions-hidden-count" style="color:var(--color-text-muted)"></span></button>
    </div>
    <div id="versions-results"></div>
  `;

  document.getElementById('versions-analyze-btn').onclick = () => analyze(false);
  document.getElementById('versions-refresh-btn').onclick = () => analyze(true);
  document.getElementById('versions-hidden-btn').onclick = openHiddenManager;
  updateHiddenCount();
}

// Marcadores que hacen que sean OTRA canción (los preservamos en la clave):
// reprise, acoustic, live, remix, demo, instrumental, sped up, slowed, unplugged,
// piano version, orchestral, karaoke, extended, edit (a veces cambia). Podés
// tener el original y la versión live en likes sin que Fonoteca los agrupe.
const VERSION_MARKERS = /\b(reprise|acoustic|acústic[ao]|live|en vivo|remix|demo|instrumental|sped up|slowed|reverb|unplugged|piano version|orchestral|karaoke|extended|extended mix|edit|edición extendida|reworked|reimagined|rerecorded|re-?record|taylor'?s version)\b/i;
// Marcadores de EDICIÓN (los sacamos: es la misma grabación):
// remaster, deluxe, bonus, anniversary, mono, stereo, radio edit, album version,
// single version, y años sueltos (- 2011).
const EDITION_STRIP = /\s*[-–—:(\[]\s*(remaster(ed)?|deluxe|bonus track|anniversary|mono|stereo|radio edit|album version|single version|explicit|clean|from ".+"|from the [a-z ]+|expanded edition|expanded)\b.*$/i;
const YEAR_STRIP = /\s*[-–—]\s*(19|20)\d{2}\s*(remaster(ed)?|version|mix|edit)?\s*$/i;
const PAREN_YEAR = /\s*\((19|20)\d{2}\s*(remaster(ed)?|version|mix|edit)?\)\s*$/i;

function normalizeName(name) {
  if (!name) return '';
  let out = name.toLowerCase().trim();
  out = out.replace(EDITION_STRIP, '');
  out = out.replace(PAREN_YEAR, '');
  out = out.replace(YEAR_STRIP, '');
  // Marcadores de versión los preservo, pero afuera del paréntesis los mantengo
  // como sufijo canónico para no depender de puntuación.
  const versionTags = [];
  out = out.replace(/[\(\[]([^\)\]]+)[\)\]]/g, (_, inside) => {
    const m = inside.match(VERSION_MARKERS);
    if (m) { versionTags.push(m[0].toLowerCase()); return ''; }
    return ''; // otros paréntesis (featuring, prod. by, etc.) los tiramos igual
  });
  // También matcheo el marcador si vino sin paréntesis: "Song - Live"
  const dashMatch = out.match(new RegExp('\\s*[-–—]\\s*(' + VERSION_MARKERS.source.slice(2, -2) + ')\\s*$', 'i'));
  if (dashMatch) {
    versionTags.push(dashMatch[1].toLowerCase());
    out = out.replace(dashMatch[0], '');
  }
  out = out.replace(/\s+/g, ' ').trim();
  const tags = [...new Set(versionTags.map(t => t.replace(/\s+/g, '')))].sort();
  return tags.length ? `${out}#${tags.join(',')}` : out;
}

function normalizeKey(track) {
  const name = normalizeName(track.name);
  const artist = (track.artists?.[0]?.name || '').toLowerCase().trim();
  return `${artist}|||${name}`;
}

// ── Pistas fantasma: likes sin NINGÚN metadato (v=153) ───────────────────────
//
// Seis likes llegan de `/me/tracks` con `name`, `artists[0].name` y
// `album.name` en cadena vacía, `duration_ms: 0`, `is_playable: false`, sin
// tapa y con `release_date: "0000"`. La vista los agrupaba como si fueran
// versiones de una misma canción —todas normalizan a la clave `|||`— y les
// ponía el badge «mismo álbum», que era doblemente falso: ni son la misma
// canción ni el álbum significa nada. Marcar una y darle a «Borrar sobrantes»
// habría borrado cinco likes SIN RELACIÓN entre sí. Por eso salen del listado
// de clusters y van a su propia tarjeta, sin checkbox y sin borrado.
//
// Qué son, verificado en vivo el 2026-08-23:
//   - la uri es `spotify:track:…` NORMAL, no `spotify:local:…` — o sea que la
//     API SÍ los acepta en una playlist (de ahí el botón);
//   - `GET /me/library/contains` devuelve `true` para los seis: están de
//     verdad en la biblioteca, no es basura del cache;
//   - el nombre no se puede recuperar por ningún lado: `oEmbed` devuelve
//     `title: ""`, y `GET /albums/{id}` devuelve un álbum de «Various Artists»
//     con `name: ""`, `release_date: "0000"`, sin tapa y con sus 14 pistas
//     igual de vacías. No hay metadato que rescatar, ni acá ni en Spotify.
//
// Así que la vista no promete un nombre que no existe: dice qué son y deja
// mandarlos a una playlist para poder mirarlos desde la app de Spotify.
function esFantasma(track) {
  return !(track?.name || '').trim();
}

// Clave para persistencia de ocultos: sobrevive a re-análisis porque no depende
// del idx dinámico ni de la duración.
function clusterKey(cluster) {
  if (!cluster.length) return '';
  return normalizeKey(cluster[0].track);
}

function formatDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

// Analiza el cluster para encontrar duplicados EXACTOS dentro (mismo álbum, misma
// duración): son track IDs distintos que apuntan al mismo master. Devuelve
// Map<trackId, string> con el motivo para mostrar como badge.
function detectExactDupes(cluster) {
  const flags = new Map();
  const byAlbum = new Map();
  cluster.forEach(item => {
    const t = item.track;
    const albumId = t.album?.id || t.album?.name || '?';
    const dur = Math.round((t.duration_ms || 0) / 1000);
    const k = `${albumId}|${dur}`;
    if (!byAlbum.has(k)) byAlbum.set(k, []);
    byAlbum.get(k).push(t.id);
  });
  byAlbum.forEach(ids => {
    if (ids.length > 1) ids.forEach(id => flags.set(id, 'mismo álbum'));
  });
  return flags;
}

async function analyze(force = false) {
  const results = document.getElementById('versions-results');
  const btn = document.getElementById('versions-analyze-btn');
  btn.disabled = true;
  keepIds.clear();
  // Empezar el análisis desde cero también limpia lo "resuelto" — es un nuevo run.
  resolvedClusterIdxs.clear();

  try {
    const msg = force ? 'Re-bajando Liked Songs desde Spotify...' : 'Cargando Liked Songs...';
    const prog = progressController(msg);
    const likes = await getAllLikedTracks(({ loaded, total }) => {
      prog.update(loaded, total);
    }, { force, signal: prog.signal });
    prog.done();

    // Los fantasmas se apartan ANTES de agrupar: si entran al Map todos caen en
    // la misma clave (`|||`) y salen como un cluster de versiones que no son.
    fantasmas = likes.filter(item => item.track?.id && esFantasma(item.track));
    const fantasmaIds = new Set(fantasmas.map(item => item.track.id));

    const groups = new Map();
    likes.forEach(item => {
      if (!item.track?.id) return;
      if (fantasmaIds.has(item.track.id)) return;
      const key = normalizeKey(item.track);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const dismissed = getDismissed();
    // Guardo snapshot de metadata para el modal de ocultos (aunque después Ian
    // desdismisse un cluster que salió del análisis actual).
    groups.forEach((cluster, key) => {
      if (cluster.length > 1) {
        const t = cluster[0].track;
        clusterMetaCache.set(key, {
          name: t.name,
          artist: t.artists?.map(a => a.name).join(', ') || 'Unknown',
          cover: coverUrl(t.album?.images, 'grande'),
          count: cluster.length,
        });
      }
    });

    const clusters = [...groups.entries()]
      .filter(([k, g]) => g.length > 1 && !dismissed.has(k))
      .map(([, g]) => g)
      .sort((a, b) => b.length - a.length);

    allClusters = clusters;
    updateHiddenCount();

    if (clusters.length === 0) {
      results.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-success">Sin duplicados</span>
            <span>No se encontraron versiones duplicadas en tus likes${dismissed.size ? ` (${dismissed.size} oculto${dismissed.size === 1 ? '' : 's'})` : ''}.</span>
          </div>
        </div>
        ${renderFantasmas()}
      `;
      bindFantasmas();
      return;
    }

    const totalDupes = clusters.reduce((s, c) => s + c.length - 1, 0);

    results.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value">${clusters.length}</div>
          <div class="stat-label">Grupos con versiones</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-warning)">${totalDupes}</div>
          <div class="stat-label">Posibles sobrantes</div>
        </div>
      </div>

      <div id="batch-actions" style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
        <div style="line-height:1.4">
          <div><strong id="batch-keep-count">0</strong> versión(es) marcada(s) para quedarse</div>
          <div style="font-size:12px;color:var(--color-text-secondary)"><strong id="batch-delete-count">0</strong> sobrante(s) van a borrarse</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <label id="versions-hide-resolved-wrap" class="versions-filter" hidden>
            <input type="checkbox" id="versions-hide-resolved">
            <span>Ocultar las ya resueltas <span id="versions-resolved-count"></span></span>
          </label>
          <button class="btn btn-secondary btn-sm" id="batch-clear-btn" disabled>Limpiar</button>
          <button class="btn btn-danger" id="batch-delete-btn" disabled>Borrar sobrantes</button>
        </div>
      </div>

      ${renderFantasmas()}

      <div id="versions-clusters" class="versions-grid"></div>
    `;

    bindFantasmas();
    shownCount = SHOWN_STEP;
    ocultarResueltas = false;
    renderClusterList();

    const toggle = document.getElementById('versions-hide-resolved');
    if (toggle) toggle.onchange = () => {
      ocultarResueltas = toggle.checked;
      renderClusterList();
    };

    document.getElementById('batch-clear-btn').onclick = () => {
      keepIds.clear();
      results.querySelectorAll('.keep-check').forEach(b => { b.checked = false; });
      updateBatchBar();
    };

    document.getElementById('batch-delete-btn').onclick = batchDelete;

  } catch (e) {
    hideProgress();
    if (isCancelled(e)) {
      showToast('Carga detenida — lo que se bajó quedó guardado', 'warning');
    } else {
      showToast(e.message, 'error');
      console.error(e);
    }
  } finally {
    btn.disabled = false;
  }
}

function renderClusterList() {
  const holder = document.getElementById('versions-clusters');
  if (!holder) return;
  // El idx que viaja al DOM es la posición REAL en allClusters: `computeRemovals`
  // y el ✕ de ocultar lo usan para indexar el array. Con el filtro de resueltas
  // encendido la posición visible ya no coincide, así que se lleva en el par.
  const visibles = allClusters
    .map((cluster, idx) => ({ cluster, idx }))
    .filter(({ idx }) => !(ocultarResueltas && resolvedClusterIdxs.has(idx)));
  const shown = visibles.slice(0, shownCount);
  const rest = visibles.length - shown.length;
  holder.innerHTML = `
    ${shown.map(({ cluster, idx }) => renderCluster(cluster, idx)).join('')}
    ${rest > 0 ? `<div class="versions-more-wrap"><button class="btn btn-secondary" id="versions-more-btn">Ver ${Math.min(SHOWN_STEP, rest)} grupos más (${rest} restantes)</button></div>` : ''}
    ${visibles.length === 0 ? `<div class="versions-more-wrap" style="color:var(--color-text-muted)">Resolviste los ${allClusters.length} grupos. Desmarcá el filtro para volver a verlos.</div>` : ''}
  `;
  updateResolvedFilter();
  holder.querySelectorAll('.keep-check').forEach(box => {
    box.addEventListener('change', () => {
      if (box.checked) keepIds.add(box.dataset.trackId);
      else keepIds.delete(box.dataset.trackId);
      updateBatchBar();
    });
  });
  holder.querySelectorAll('.cluster-dismiss').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.clusterIdx);
      const cluster = allClusters[idx];
      if (!cluster) return;
      const s = getDismissed();
      s.add(clusterKey(cluster));
      saveDismissed(s);
      // Saco de la lista in-place y re-render sin re-analizar todo.
      cluster.forEach(item => keepIds.delete(item.track.id));
      allClusters.splice(idx, 1);
      // El splice corre una posición a todos los de la derecha: sin remapear,
      // «resuelto» se le pegaba al cluster de al lado (y el filtro de 6.3
      // escondía el equivocado).
      const remapeados = [...resolvedClusterIdxs].map(i => (i > idx ? i - 1 : i));
      resolvedClusterIdxs.clear();
      remapeados.forEach(i => resolvedClusterIdxs.add(i));
      renderClusterList();
      updateBatchBar();
      updateHiddenCount();
      updateSummaryCounts();
    };
  });
  const moreBtn = document.getElementById('versions-more-btn');
  if (moreBtn) moreBtn.onclick = () => { shownCount += SHOWN_STEP; renderClusterList(); };
}

// Muestra el toggle solo cuando hay algo que ocultar, y le pone el número al lado.
function updateResolvedFilter() {
  const wrap = document.getElementById('versions-hide-resolved-wrap');
  if (!wrap) return;
  const n = [...resolvedClusterIdxs].filter(i => i < allClusters.length).length;
  wrap.hidden = n === 0;
  const label = document.getElementById('versions-resolved-count');
  if (label) label.textContent = `(${n})`;
}

// ── Tarjeta de pistas fantasma ───────────────────────────────────────────────
// Sin checkbox y sin borrado: ver el comentario de `esFantasma`.
function renderFantasmas() {
  if (!fantasmas.length) return '';
  const n = fantasmas.length;
  return `
    <div class="card" id="versions-ghosts" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <h3 style="margin:0">${n} pista${n === 1 ? '' : 's'} sin metadatos</h3>
        <span class="badge badge-secondary">no son versiones duplicadas</span>
      </div>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:12px">
        Están en tus me gusta y Spotify las reconoce, pero devuelve el título, el artista
        y el álbum vacíos: no hay nombre que mostrar, ni acá ni en la propia Spotify.
        No tienen relación entre sí, así que no se pueden borrar como sobrantes desde acá.
        Mandalas a una playlist para poder verlas desde la app de Spotify, o quitalas de tus
        me gusta una por una desde ahí.
      </p>
      <div class="results-list" style="margin-bottom:12px">
        ${fantasmas.map(item => {
          const t = item.track;
          const alta = (item.added_at || '').slice(0, 10);
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--color-border)">
              <div style="width:44px;height:44px;border-radius:var(--radius-sm);background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:18px;flex-shrink:0">?</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:14px">Pista sin metadatos</div>
                <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  ${escapeHtml(t.id)}${alta ? ` · en tus me gusta desde el ${escapeHtml(alta)}` : ''}
                </div>
              </div>
              <a class="btn btn-secondary btn-sm" style="flex-shrink:0" target="_blank" rel="noopener"
                 href="https://open.spotify.com/track/${encodeURIComponent(t.id)}">Abrir en Spotify</a>
            </div>`;
        }).join('')}
      </div>
      <button class="btn btn-secondary" id="versions-ghosts-playlist">Mandar ${n === 1 ? 'la pista' : `las ${n}`} a una playlist…</button>
    </div>
  `;
}

function bindFantasmas() {
  const btn = document.getElementById('versions-ghosts-playlist');
  if (btn) btn.onclick = () => mandarFantasmasAPlaylist(btn);
}

// Reusa el picker y el `addUrisToPlaylists` compartidos, igual que
// #sin-clasificar y #new-releases: chequeo de duplicados y parcheo del cache
// incluidos. La uri es `spotify:track:…` normal, así que la API las acepta.
async function mandarFantasmasAPlaylist(btn) {
  const uris = fantasmas.map(item => item.track?.uri).filter(Boolean);
  if (!uris.length) return;
  btn.disabled = true;
  try {
    const playlists = await getOwnPlaylists();
    const n = uris.length;
    openPlaylistPicker({
      id: 'versions-ghosts-pl',
      title: 'Mandar las pistas sin metadatos a playlists',
      subtitle: `${n} pista${n === 1 ? '' : 's'} sin título ni artista`,
      playlists,
      onReload: () => getOwnPlaylists({ force: true }),
      onConfirm: async (elegidas, { setStatus } = {}) => {
        const res = await addUrisToPlaylists(uris, elegidas, { onStatus: setStatus });
        toastAddResult(res, {
          what: `${n} pista${n === 1 ? '' : 's'} sin metadatos`,
          plural: n !== 1,
        });
      },
    });
  } catch (e) {
    showToast('No se pudieron cargar tus playlists: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function updateSummaryCounts() {
  const summary = document.querySelector('.results-summary');
  if (!summary) return;
  const values = summary.querySelectorAll('.stat-value');
  const totalDupes = allClusters.reduce((s, c) => s + c.length - 1, 0);
  if (values[0]) values[0].textContent = allClusters.length;
  if (values[1]) values[1].textContent = totalDupes;
}

function computeRemovals() {
  const toRemove = [];
  document.querySelectorAll('.cluster-group').forEach(clusterEl => {
    const idx = parseInt(clusterEl.dataset.clusterIdx);
    const cluster = allClusters[idx];
    if (!cluster) return;
    const hasKeep = cluster.some(item => keepIds.has(item.track.id));
    if (!hasKeep) return;
    cluster.forEach(item => {
      if (!keepIds.has(item.track.id)) toRemove.push(item.track.id);
    });
  });
  return toRemove;
}

function updateBatchBar() {
  const kc = document.getElementById('batch-keep-count');
  if (!kc) return;
  kc.textContent = keepIds.size;
  const toRemoveCount = computeRemovals().length;
  document.getElementById('batch-delete-count').textContent = toRemoveCount;
  document.getElementById('batch-delete-btn').disabled = toRemoveCount === 0;
  document.getElementById('batch-clear-btn').disabled = keepIds.size === 0;
}

async function batchDelete() {
  const toRemoveIds = computeRemovals();
  if (toRemoveIds.length === 0) return;

  const ok = await typeConfirmModal(
    'Borrar versiones sobrantes',
    `Vas a <strong>mantener</strong> las ${keepIds.size} versión(es) marcadas en verde y <strong>borrar</strong> las otras ${toRemoveIds.length} de tus Liked Songs.`,
    'BORRAR'
  );
  if (!ok) return;

  try {
    showProgress('Borrando sobrantes...', 0, toRemoveIds.length);
    await removeLikedTracks(toRemoveIds);
    // Verificación contra Spotify: chequeo si los ids que borré siguen en la
    // biblioteca. Post-migración feb 2026 el que vive es /me/library/contains
    // con URIs (verificado en vivo 2026-07-28). No falla si el endpoint muere
    // en el futuro — el toast simplemente omite el resumen.
    let verifyLine = '';
    try {
      showProgress('Verificando con Spotify...', 0, toRemoveIds.length);
      const contains = await checkLibraryContains(toRemoveIds);
      const stillIn = toRemoveIds.filter(id => contains.get(id) === true);
      if (stillIn.length === 0) {
        verifyLine = ` · ✓ verificado: ${toRemoveIds.length} de ${toRemoveIds.length} salieron`;
      } else {
        verifyLine = ` · ⚠ ${stillIn.length} de ${toRemoveIds.length} siguen en tu biblioteca — revisá`;
        console.warn('Versiones: ids que no salieron:', stillIn);
      }
    } catch (verr) {
      console.warn('Versiones: verificación falló, sigo igual:', verr.message);
    }
    hideProgress();
    showToast(`${toRemoveIds.length} versión(es) eliminada(s)${verifyLine}`, 'success');

    const toRemoveSet = new Set(toRemoveIds);
    // Mutar allClusters: dejar solo lo que se quedó. Así "Ver más" o cualquier re-render
    // muestra el cluster con la version keeper solamente + badge "guardada".
    allClusters.forEach((cluster, idx) => {
      const hadKeep = cluster.some(item => keepIds.has(item.track.id));
      if (!hadKeep) return;
      const kept = cluster.filter(item => !toRemoveSet.has(item.track.id));
      allClusters[idx] = kept;
      resolvedClusterIdxs.add(idx);
    });

    keepIds.clear();
    renderClusterList();
    updateBatchBar();
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}

function renderCluster(cluster, idx) {
  if (!cluster.length) return '';
  const firstTrack = cluster[0].track;
  const artistName = firstTrack.artists?.map(a => a.name).join(', ') || 'Unknown';
  const isResolved = resolvedClusterIdxs.has(idx);
  const headerBadge = isResolved
    ? `<span class="badge badge-success">✓ guardada</span>`
    : `<span class="badge badge-warning">${cluster.length} versiones</span>`;
  const headerPrefix = isResolved ? '✓ ' : '';
  const exactDupes = detectExactDupes(cluster);

  return `
    <div class="cluster-group ${isResolved ? 'cluster-resolved' : ''}" data-cluster-idx="${idx}">
      <div class="cluster-header">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${headerPrefix}${escapeHtml(firstTrack.name)} — ${escapeHtml(artistName)}</span>
        ${headerBadge}
        ${isResolved ? '' : `<button class="cluster-dismiss" data-cluster-idx="${idx}" title="Ocultar: no es duplicado">✕</button>`}
      </div>
      <div style="padding:8px">
        ${cluster.map(item => {
          const t = item.track;
          const albumInfo = t.album ? `${t.album.name} (${t.album.release_date?.slice(0, 4) || '?'})` : '';
          const dur = formatDuration(t.duration_ms);
          const durBadge = dur ? `<span class="badge badge-secondary" style="margin-left:auto;flex-shrink:0">${dur}</span>` : '';
          const dupeFlag = exactDupes.get(t.id);
          const dupeBadge = dupeFlag ? `<span class="badge badge-warning" style="flex-shrink:0" title="Este ID aparece con otro ID en tu biblioteca apuntando al mismo álbum/duración — son masters diferentes del mismo tema">⚠ ${escapeHtml(dupeFlag)}</span>` : '';
          const checkbox = `
            <label class="keep-check-wrap" title="Marcar esta versión para quedártela">
              <input type="checkbox" class="keep-check" data-track-id="${t.id}" ${keepIds.has(t.id) ? 'checked' : ''}>
              <span class="keep-check-label">quedarme</span>
            </label>
          `;
          const row = renderTrackRow(t, `
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
              <span style="font-size:12px;color:var(--color-text-secondary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(albumInfo)}</span>
              ${dupeBadge}
              ${durBadge}
            </div>
          `);
          return `<div class="version-row" data-track-id="${t.id}" style="display:flex;align-items:center;border-bottom:1px solid var(--color-border)">${checkbox}<div style="flex:1;min-width:0">${row}</div></div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function updateHiddenCount() {
  const el = document.getElementById('versions-hidden-count');
  if (!el) return;
  const n = getDismissed().size;
  el.textContent = n ? `(${n})` : '';
}

function openHiddenManager() {
  const dismissed = getDismissed();
  const keys = [...dismissed];

  const overlay = openModal({
    id: 'versions-hidden-modal',
    html: `
    <div class="modal modal-picker" style="max-width:520px">
      <h2 style="margin-bottom:4px">Clusters ocultos</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px">Cluster(s) que marcaste como "no es duplicado". Podés restaurarlos y van a aparecer en el próximo Analizar.</p>
      <div id="hm-list" class="picker-scroll" style="border:1px solid var(--color-border);border-radius:var(--radius-sm)"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-secondary" id="hm-restore-all" ${keys.length === 0 ? 'disabled' : ''}>Restaurar todos</button>
        <button class="btn btn-secondary" data-close-modal>Cerrar</button>
      </div>
    </div>
  `,
  });
  const listEl = overlay.querySelector('#hm-list');

  const restoreOne = (k) => {
    const s = getDismissed();
    s.delete(k);
    saveDismissed(s);
    updateHiddenCount();
  };

  const render = () => {
    const items = keys.map(k => ({ k, info: clusterMetaCache.get(k) }));
    if (items.length === 0) {
      listEl.innerHTML = `<div style="padding:14px;color:var(--color-text-muted);font-size:13px">No hay ocultos.</div>`;
      overlay.querySelector('#hm-restore-all').disabled = true;
      return;
    }
    listEl.innerHTML = items.map(({ k, info }) => {
      const name = info?.name || k.split('|||')[1] || k;
      const artist = info?.artist || k.split('|||')[0] || '';
      const cover = info?.cover
        ? `<img src="${info.cover}" loading="lazy" style="width:44px;height:44px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0">`
        : `<div style="width:44px;height:44px;border-radius:var(--radius-sm);background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px;flex-shrink:0">♪</div>`;
      const extra = info?.count ? ` · ${info.count} versiones` : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
          ${cover}
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</div>
            <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(artist)}${extra}</div>
          </div>
          <button class="btn btn-secondary btn-sm hm-restore" data-key="${escapeHtml(k)}">Restaurar</button>
        </div>`;
    }).join('');
    listEl.querySelectorAll('.hm-restore').forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.key;
        restoreOne(k);
        keys.splice(keys.indexOf(k), 1);
        render();
      };
    });
    overlay.querySelector('#hm-restore-all').disabled = false;
  };
  overlay.querySelector('#hm-restore-all').onclick = () => {
    keys.forEach(restoreOne);
    keys.length = 0;
    render();
  };
  render();
}
