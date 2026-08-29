import { getAllLikedTracks, removeLikedTracks, checkLibraryContains } from '../api.js?v=176';
import { borrarLikesVerificado } from '../util/borrado-verificado.js?v=176';
import { normalizeKey, esFantasma, guardaUltimoEjemplar, indexarBiblioteca } from '../util/versions-guard.js?v=176';
import { showProgress, hideProgress, progressController, isCancelled, typeConfirmModal, renderTrackRow, escapeHtml, pageHeader } from '../ui/components.js?v=176';
import { showToast } from '../ui/toast.js?v=176';
import { openModal, closeTop } from '../ui/modal-stack.js?v=176';
import { coverUrl } from '../util/cover-size.js?v=176';
import { openPlaylistPicker } from '../ui/playlist-picker.js?v=176';
import { getOwnPlaylists, addUrisToPlaylists, toastAddResult } from '../util/playlist-add.js?v=176';

// ── «Borrar sobrantes» REHABILITADO (2026-08-28) ─────────────────────────────
//
// Estuvo inhabilitado del 26/08 al 28/08. Historia corta de por qué, porque el
// motivo cambió dos veces y confundirlos lleva a conclusiones falsas:
//
//   1. Se bloqueó el 26/08 creyendo que un borrado se había llevado una versión
//      marcada con «quedarme». FALSO: las 15 pistas que faltaban eran
//      singletons, clusters de una sola versión que este botón no puede tocar.
//   2. Siguió bloqueado porque faltaban 123 me gusta sin ninguna copia viva.
//      Eso SÍ es real y es el daño que importa.
//
// QUÉ SE SABE Y QUÉ NO, al 2026-08-28. Se sabe por qué nadie se enteró: la
// verificación posterior al borrado NUNCA CORRIÓ en tandas de más de 40 pistas
// —`checkLibraryContains` iba de a 50 con el tope real en 40, tiraba en el
// primer chunk, y el llamador se lo comía en un `console.warn` que la extensión
// de Chrome ni captura—. Todo borrado grande se dio por bueno a ciegas.
//
// Pero eso explica el SILENCIO, no el BORRADO: la verificación corre después
// del DELETE y no puede borrar nada. Qué se llevó las 123 sigue sin
// identificarse. El candidato que mejor encaja son las pistas fantasma antes de
// v=153: normalizaban todas a la clave `|||`, caían en un mismo cluster, y la
// doc ya decía que ahí «Borrar sobrantes» habría borrado likes sin relación
// entre sí. Encaja con la fecha (la corrida fue anterior al 19/08) pero no está
// probado.
//
// POR QUÉ SE REHABILITA IGUAL. No porque la causa esté cerrada, sino porque las
// tres condiciones que la hacían peligrosa están puestas y probadas:
//
//   1. Chunks de 40 en `checkLibraryContains()` y `albumsInLibrary()`, con el
//      número en una sola constante (`LIBRARY_URIS_POR_REQUEST`, api.js).
//      Máximo medido en vivo el 2026-08-28: 40 pasa, 41 da 400.
//   2. La verificación ya no puede fallar en silencio. Si tira, o si alguna
//      pista sigue en la biblioteca, esto TIRA: toast rojo, sin toast verde,
//      sin marcar clusters como resueltos. No queda ni un `console.warn` en el
//      camino de un borrado.
//   3. Guarda dura del último ejemplar antes de cualquier DELETE
//      (`util/versions-guard.js`, 16 tests en tests/versions-guard.test.mjs):
//      si el borrado dejaría alguna canción en cero copias, se aborta el lote
//      entero y se dice cuál. Esto hace IMPOSIBLE repetir el daño de las 123
//      sea cual sea la causa que lo produjo, que es justamente lo que se quería.
//
// Si alguna de las tres se toca, volver a poner la constante en `true`.
const BORRADO_BLOQUEADO = false;
// Texto que se muestra si alguien vuelve a poner BORRADO_BLOQUEADO en true.
// Cambiarlo junto con la constante: tiene que decir POR QUÉ se re-bloqueó.
const MOTIVO_BLOQUEO = 'El borrado está bloqueado a mano en el código (BORRADO_BLOQUEADO).';

// ── Doble de borrado: reproducir el fallo sin tocar los me gusta (v=164) ─────
//
// El único camino que quedaba sin ejercitar era un SEGUNDO «Borrar sobrantes»
// dentro de la misma sesión, con `resolvedClusterIdxs` ya poblado por el
// primero, el filtro «Ocultar las ya resueltas» encendido y «Ver más» pulsado:
// ahí conviven las tres cosas que mueven índices (la mutación en el sitio de
// `allClusters[idx] = kept`, el filtro y la paginación). Ejercitarlo de verdad
// cuesta me gusta, así que el flujo entero —`computeRemovals`, la
// confirmación, la mutación de `allClusters` y el remapeo— corre igual, pero
// la llamada a la API se sustituye por un doble que SOLO REGISTRA los ids.
//
// Se enciende con `localStorage['versions_dry_run'] = '1'`. Con el doble
// encendido el botón se habilita aunque `BORRADO_BLOQUEADO` siga en `true`:
// desde acá no hay ninguna ruta a la API de borrado.
const DRY_RUN_KEY = 'versions_dry_run';
const DRY_LOG_KEY = 'versions_dry_run_log_v1';


function dryRunActivo() {
  try { return localStorage.getItem(DRY_RUN_KEY) === '1'; } catch { return false; }
}

// El doble. Devuelve la entrada registrada para que el llamador la muestre.
function borradoSimulado(ids, { meta = null } = {}) {
  const entrada = {
    fecha: new Date().toISOString(),
    simulacro: true,
    total: ids.length,
    ids,
    marcadas: [...keepIds],
    borradas: meta,
  };
  window.__versionsDryLog = window.__versionsDryLog || [];
  window.__versionsDryLog.push(entrada);
  try {
    const previo = JSON.parse(localStorage.getItem(DRY_LOG_KEY) || '[]');
    previo.unshift(entrada);
    localStorage.setItem(DRY_LOG_KEY, JSON.stringify(previo.slice(0, 20)));
  } catch { /* el registro es una red, no un requisito */ }
  console.log(`[versions][simulacro] NO se borró nada. ${ids.length} id(s):`, ids);
  return entrada;
}

// ── La regla que el 26/08 no se pudo comprobar ───────────────────────────────
//
// Una versión marcada con «quedarme» NO puede salir en la lista de borrado,
// pase lo que pase con los índices. `computeRemovals()` ya lo respeta por
// construcción, pero eso es un razonamiento sobre el código y lo que se perdió
// fueron me gusta: acá se comprueba sobre los ids concretos, justo antes de
// tocar nada. Si alguna vez se cruzan, el borrado se aborta entero.
function marcadasEnLaLista(ids) {
  return ids.filter(id => keepIds.has(id));
}

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
// Índice clave-de-canción → ids vivos, con TODA la biblioteca (no solo los
// clusters que se listan). Es la base del guarda del último ejemplar: para
// saber si borrar una versión deja la canción en cero hay que mirar todas sus
// copias, incluidas las de clusters ocultos o no renderizados.
let libraryByKey = new Map();
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
// `esFantasma` y la normalización viven ahora en util/versions-guard.js,
// junto al guarda que depende de ellas. Ver ese archivo y su test.

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

    // El índice se arma del Map completo, ANTES de filtrar por tamaño y por
    // ocultos: un cluster oculto sigue conteniendo copias vivas que cuentan
    // como gemelo.
    libraryByKey = indexarBiblioteca(likes);

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

    // ── Orden de la vista (v=164) ───────────────────────────────────────────
    //
    // Los dos totales («grupos con versiones» y «posibles sobrantes») vivían en
    // dos stat-cards grandes arriba de todo, y empujaban la barra de acciones y
    // el primer grupo fuera de la pantalla. Ahora van DENTRO de la cabecera
    // pegajosa, compactos: se leen igual, siguen a la vista al scrollear y
    // dejan sitio para más grupos.
    //
    // Y «pistas sin metadatos» pasa al FONDO: son 6 pistas que no son
    // versiones de nada, no se pueden borrar desde acá y no hay nada que
    // decidir con ellas. Estaban arriba del listado, o sea delante del trabajo
    // de verdad.
    results.innerHTML = `
      <div id="batch-actions" style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div class="versions-summary" style="display:flex;gap:16px;align-items:baseline;flex-wrap:wrap">
            <span><strong id="versions-count-groups" style="font-size:20px">${clusters.length}</strong> <span style="font-size:12px;color:var(--color-text-secondary)">grupos con versiones</span></span>
            <span><strong id="versions-count-dupes" style="font-size:20px;color:var(--color-warning)">${totalDupes}</strong> <span style="font-size:12px;color:var(--color-text-secondary)">posibles sobrantes</span></span>
          </div>
          <div style="line-height:1.4;padding-left:16px;border-left:1px solid var(--color-border)">
            <div><strong id="batch-keep-count">0</strong> versión(es) marcada(s) para quedarse</div>
            <div style="font-size:12px;color:var(--color-text-secondary)"><strong id="batch-delete-count">0</strong> sobrante(s) van a borrarse</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <label id="versions-hide-resolved-wrap" class="versions-filter" hidden>
            <input type="checkbox" id="versions-hide-resolved">
            <span>Ocultar las ya resueltas <span id="versions-resolved-count"></span></span>
          </label>
          <button class="btn btn-secondary btn-sm" id="batch-clear-btn" disabled>Limpiar</button>
          <button class="btn btn-danger" id="batch-delete-btn" disabled title="${BORRADO_BLOQUEADO ? escapeHtml(MOTIVO_BLOQUEO) : ''}">Borrar sobrantes</button>
        </div>
        ${BORRADO_BLOQUEADO ? `
        <div style="flex-basis:100%;display:flex;gap:8px;align-items:flex-start;background:var(--color-elevated);border:1px solid var(--color-warning);border-radius:var(--radius-sm);padding:10px 12px;font-size:13px;line-height:1.45">
          <span style="flex-shrink:0">⚠️</span>
          <div>
            <strong>«Borrar sobrantes» está inhabilitado.</strong>
            ${escapeHtml(MOTIVO_BLOQUEO)}
            Marcar versiones sirve para revisar los grupos, pero no se borra nada.
            Para quitar una versión suelta, hacerlo desde la aplicación de Spotify.
          </div>
        </div>` : ''}
      </div>

      <div id="versions-clusters" class="versions-grid"></div>

      ${renderFantasmas()}
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
      // ⚠️ El propio idx se DESCARTA, no se conserva: si el cluster que se
      // oculta estaba marcado como resuelto y se dejaba su índice, ese índice
      // pasaba a apuntar al vecino de la derecha, que quedaba marcado como
      // resuelto sin serlo — y con el filtro encendido desaparecía de la vista.
      const remapeados = [...resolvedClusterIdxs]
        .filter(i => i !== idx)
        .map(i => (i > idx ? i - 1 : i));
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
  const grupos = document.getElementById('versions-count-groups');
  if (!grupos) return;
  const totalDupes = allClusters.reduce((s, c) => s + c.length - 1, 0);
  grupos.textContent = allClusters.length;
  const dupes = document.getElementById('versions-count-dupes');
  if (dupes) dupes.textContent = totalDupes;
}

// Devuelve los ITEMS a borrar, no solo los ids: la confirmación tiene que poder
// listar nombre y artista de cada uno, y el registro local guardarlos.
function computeRemovals() {
  const toRemove = [];
  document.querySelectorAll('.cluster-group').forEach(clusterEl => {
    const idx = parseInt(clusterEl.dataset.clusterIdx);
    const cluster = allClusters[idx];
    if (!cluster) return;
    const hasKeep = cluster.some(item => keepIds.has(item.track.id));
    if (!hasKeep) return;
    cluster.forEach(item => {
      if (!keepIds.has(item.track.id)) toRemove.push(item);
    });
  });
  return toRemove;
}

function describirPista(track) {
  const artista = track.artists?.map(a => a.name).join(', ') || 'Artista desconocido';
  const album = track.album?.name || 'Sin álbum';
  return { id: track.id, nombre: track.name || '(sin nombre)', artista, album };
}

function updateBatchBar() {
  const kc = document.getElementById('batch-keep-count');
  if (!kc) return;
  kc.textContent = keepIds.size;
  const toRemoveCount = computeRemovals().length;
  document.getElementById('batch-delete-count').textContent = toRemoveCount;
  // Con el borrado bloqueado el botón no se habilita nunca, aunque haya marcas.
  // La excepción es el doble: ahí el flujo corre entero pero no llama a la API.
  document.getElementById('batch-delete-btn').disabled =
    (BORRADO_BLOQUEADO && !dryRunActivo()) || toRemoveCount === 0;
  document.getElementById('batch-clear-btn').disabled = keepIds.size === 0;
}

async function batchDelete() {
  const simulacro = dryRunActivo();
  if (BORRADO_BLOQUEADO && !simulacro) {
    showToast(MOTIVO_BLOQUEO, 'warning');
    return;
  }
  const toRemove = computeRemovals();
  if (toRemove.length === 0) return;
  const toRemoveIds = toRemove.map(item => item.track.id);
  const detalle = toRemove.map(item => describirPista(item.track));

  // La confirmación lista una por una lo que se va a borrar. Un número no deja
  // detectar que en la lista se coló una versión que se quería conservar, que es
  // exactamente lo que pasó el 26/08/2026.
  const lista = detalle.map(d => `
    <li style="margin-bottom:6px">
      <strong>${escapeHtml(d.nombre)}</strong> — ${escapeHtml(d.artista)}
      <div style="font-size:12px;color:var(--color-text-secondary)">${escapeHtml(d.album)}</div>
    </li>`).join('');
  const ok = await typeConfirmModal(
    simulacro ? 'Simulacro de borrado (no se toca nada)' : 'Borrar versiones sobrantes',
    `${simulacro ? '<div style="background:var(--color-elevated);border:1px solid var(--color-warning);border-radius:var(--radius-sm);padding:8px 10px;margin-bottom:10px">Modo <strong>simulacro</strong>: se registran los ids y no se borra ni un me gusta.</div>' : ''}
     Se mantienen las ${keepIds.size} versión(es) marcadas en verde.
     Se ${simulacro ? 'registrarían' : 'van a borrar de los me gusta'} estas ${toRemove.length}:
     <ul style="margin:10px 0 0;padding-left:20px;max-height:320px;overflow-y:auto">${lista}</ul>`,
    'BORRAR'
  );
  if (!ok) return;

  // El guarda va acá, sobre los ids concretos y con la lista ya cerrada: si una
  // marcada se coló, no se llama a nadie y se dice cuál.
  const coladas = marcadasEnLaLista(toRemoveIds);
  if (coladas.length) {
    const nombres = coladas.map(id => detalle.find(d => d.id === id)?.nombre || id);
    console.error('[versions] ABORTADO: hay marcadas en la lista de borrado:', coladas, nombres);
    showToast(`Borrado abortado: ${coladas.length} versión(es) marcada(s) con «quedarme» estaban en la lista (${nombres.join(', ')}). No se tocó nada.`, 'error');
    return;
  }

  // Guarda dura del último ejemplar, PRIMERA pasada. Corre también en
  // simulacro: es justo el camino que hay que poder ejercitar sin gastar me
  // gusta, y el simulacro no llega a `borrarLikesVerificado`. La segunda pasada
  // —la que de verdad protege el DELETE— la corre el helper.
  const sinGemelo = guardaUltimoEjemplar(toRemove, libraryByKey);
  if (sinGemelo.length) {
    const nombres = sinGemelo.map(v => `«${v.track.name || '(sin nombre)'}» (${v.motivo})`);
    console.error('[versions] ABORTADO por el guarda del último ejemplar:', sinGemelo.map(v => ({ id: v.track.id, nombre: v.track.name, motivo: v.motivo })));
    showToast(`Borrado abortado: ${sinGemelo.length} pista(s) se quedarían sin ninguna copia viva. No se tocó nada. ${nombres.slice(0, 3).join('; ')}${nombres.length > 3 ? '…' : ''}`, 'error');
    return;
  }

  try {
    const meta = detalle.map(d => ({ ...d, marcadasEnEsteBorrado: [...keepIds] }));
    let verifyLine = '';
    if (simulacro) {
      borradoSimulado(toRemoveIds, { meta });
    } else {
      // Borrado + verificación + guarda, en `util/borrado-verificado.js`: la
      // misma secuencia que usan las otras cuatro vistas que borran me gusta.
      // Vivía acá dentro, copiada, hasta el 29/08.
      //
      // Si la verificación no se puede hacer, o se hace y no cuadra, esto TIRA:
      // no sale el toast verde, no se marcan los clusters como resueltos y no
      // se limpian las marcas. El registro previo (v=162) lo sigue escribiendo
      // `removeLikedTracks` antes del primer DELETE.
      await borrarLikesVerificado(toRemoveIds, {
        origen: '#versions',
        meta,
        removeLikedTracks,
        checkLibraryContains,
        // La única de las cinco vistas donde la guarda SÍ aplica: esto es un
        // dedup, y borrar la última copia viva de una canción es, por
        // definición, un fallo. Es literalmente lo que pasó con las 123.
        guarda: 'ultimo-ejemplar',
        items: toRemove,
        libraryByKey,
        onProgress: (fase, hechas, total) => showProgress(
          fase === 'verificando' ? 'Verificando con Spotify...' : 'Borrando sobrantes...', hechas, total),
      });
      verifyLine = ` · ✓ verificado: ${toRemoveIds.length} de ${toRemoveIds.length} salieron`;
    }
    hideProgress();
    showToast(simulacro
      ? `Simulacro: ${toRemoveIds.length} versión(es) se habrían borrado. No se tocó ningún me gusta.`
      : `${toRemoveIds.length} versión(es) eliminada(s)${verifyLine}`, simulacro ? 'warning' : 'success');

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
