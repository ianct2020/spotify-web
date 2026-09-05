import { spotifyFetch, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache, getAllLikedTracks } from '../api.js?v=205';
import { hasKey, setKey, hasUsername, getUsername, setUsername, getUserTopArtists, getSimilarArtists, getArtistTopTracks } from '../api/lastfm.js?v=205';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml, pageHeader } from '../ui/components.js?v=205';
import { showToast } from '../ui/toast.js?v=205';
import { getPreview } from '../api/preview-providers.js?v=205';
import { togglePreview, playingKey, isPlayingAudio } from '../ui/preview-player.js?v=205';
import { paintPlayingCard } from '../ui/track-card-row.js?v=205';
import { openTrackCard } from './track-card.js?v=205';
import { openAlbumCard } from './album-card.js?v=205';
import { limpiaParaQuery, titleMatches, artistMatches } from '../util/track-match.js?v=205';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=205';
import { createHiddenStore } from '../util/hidden-sync.js?v=205';
import { recuperarUriDeArtistaKey } from '../util/hidden-recover.js?v=205';

// Iconos de las dos fichas. Los mismos trazos que usa la tarjeta compartida.
const ICONO_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>`;
const ICONO_PAUSA = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>`;
const ICONO_FICHA = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>`;
const ICONO_DISCO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/></svg>`;
// Mismos trazos que el ojo de discover-common.js (v=165), acá con 14px para
// que entre en el botón redondo `.sc-hide` de las tarjetas de esta vista.
const ICONO_OJO_TACHADO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const ICONO_OJO_ABIERTO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

// Ocultar un artista recomendado: el MISMO mecanismo que discover-common.js
// usa para álbumes (hidden-sync.js — playlist privada + reconciliación por
// unión, ver PENDIENTES.md sobre el hueco de `uriByKey`). La clave es el
// artista, no una pista, así que se guarda una pista representativa suya y al
// leer se reconstruye el nombre desde el artista de esa pista — igual que
// W-Three reconstruye `albumKey` desde su pista representativa.
const hiddenArtists = createHiddenStore({
  lsKey: 'recs_ocultos',
  playlistName: 'fonoteca · ocultos (recomendados)',
  label: 'recomendados',
  keyOfTrack: (t) => {
    const n = t?.artists?.[0]?.name;
    return n ? n.toLowerCase() : null;
  },
  // La clave es el nombre del artista: la uri no se deduce, se busca una pista
  // suya y se confirma que su `artists[0]` sea ese artista (v=205).
  recoverUri: recuperarUriDeArtistaKey,
});

// Pista representativa por artista, para poder ocultarlo con una uri real sin
// tener que resolver sus tracks de nuevo si ya se hizo en esta sesión.
const artistUriMemo = new Map();   // nameLower → uri | null

async function representativeArtistUri(artist) {
  const k = artist.name.toLowerCase();
  if (artistUriMemo.has(k)) return artistUriMemo.get(k);
  // Camino rápido: si ya resolvimos sus tracks en esta sesión (el usuario
  // entró a este artista antes de ocultarlo), reusar el primer match en vez
  // de gastar otra vuelta a Last.fm + Spotify.
  if (currentPick === artist) {
    const rep = resolvedTracks.find(t => t.matched && (t.artistList || []).some(n => n.toLowerCase() === k));
    if (rep) { artistUriMemo.set(k, rep.uri); return rep.uri; }
  }
  let uri = null;
  try {
    const top = await getArtistTopTracks(artist.name, 5);
    for (const t of top) {
      const q = `track:"${limpiaParaQuery(t.name)}" artist:"${limpiaParaQuery(artist.name)}"`;
      const data = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=5`);
      const hit = (data.tracks?.items || []).find(c =>
        titleMatches(t.name, c.name)
        && artistMatches(artist.name, (c.artists || []).map(x => x.name).join(', '))
        // El artists[0] del candidato tiene que ser ESTE artista: si no,
        // `keyOfTrack` reconstruiría un nombre distinto al sincronizar.
        && (c.artists?.[0]?.name || '').toLowerCase() === k);
      if (hit) { uri = hit.uri; break; }
    }
  } catch (e) {
    console.warn(`[recs] no pude resolver una pista representativa de "${artist.name}":`, e.message);
  }
  artistUriMemo.set(k, uri);
  return uri;
}

/** @returns {Promise<boolean>} true si quedó oculto */
async function toggleHiddenArtist(artist) {
  const key = artist.name.toLowerCase();
  let uri = null;
  try { uri = await representativeArtistUri(artist); } catch { /* sin uri: el store avisa, la anota y la intenta recuperar en el sync */ }
  return hiddenArtists.toggle(key, uri);
}

// Cuántos top tracks se le piden a Last.fm por artista. Eran 20 hasta v=167.
// Cada uno cuesta una búsqueda en Spotify, así que subirlo sube el riesgo de
// 429 — por eso la resolución va con una pausa entre búsquedas.
const TOP_TRACKS_POR_ARTISTA = 30;
const PAUSA_ENTRE_BUSQUEDAS = 120;

let recommendations = [];
let currentPick = null;
let resolvedTracks = [];
let alreadyLikedInResolution = 0;
const pickedUris = new Set();
const likedUris = new Set();
// 'normal' = lo que queda por descubrir · 'hidden' = los que ocultaste.
let viewMode = 'normal';

export function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Recomendaciones (scrobbles)' })}
    <div id="recs-content"></div>
  `;

  if (!hasKey()) {
    renderKeySetup();
    return;
  }
  if (!hasUsername()) {
    renderUserSetup();
    return;
  }
  renderControls();
}

function renderKeySetup() {
  document.getElementById('recs-content').innerHTML = `
    <div class="card" style="max-width:480px">
      <h3 style="margin-bottom:8px">Configura tu Last.fm API key</h3>
      <input type="text" id="lastfm-key-input" placeholder="API key"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-family:monospace;font-size:14px;margin-bottom:12px">
      <button class="btn btn-primary" id="lastfm-key-save" style="width:100%">Guardar</button>
    </div>
  `;
  document.getElementById('lastfm-key-save').onclick = () => {
    const val = document.getElementById('lastfm-key-input').value.trim();
    if (val.length < 20) { showToast('Key inválida', 'error'); return; }
    setKey(val);
    renderUserSetup();
  };
}

function renderUserSetup() {
  document.getElementById('recs-content').innerHTML = `
    <div class="card" style="max-width:480px">
      <h3 style="margin-bottom:8px">Tu usuario de Last.fm</h3>
      <p style="color:var(--color-text-secondary);font-size:14px;margin-bottom:16px">
        El username que usas para scrobblear. Se guarda en tu navegador.
      </p>
      <input type="text" id="lastfm-user-input" placeholder="username" autocomplete="off"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px;margin-bottom:12px">
      <button class="btn btn-primary" id="lastfm-user-save" style="width:100%">Guardar</button>
    </div>
  `;
  document.getElementById('lastfm-user-save').onclick = () => {
    const val = document.getElementById('lastfm-user-input').value.trim();
    if (val.length < 1) { showToast('Username vacío', 'error'); return; }
    setUsername(val);
    renderControls();
  };
}

function renderControls() {
  document.getElementById('recs-content').innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:14px">Usuario: <strong>${escapeHtml(getUsername())}</strong></div>
        <div style="font-size:12px;color:var(--color-text-secondary)">Periodo: últimos 6 meses</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="recs-change-user">Cambiar usuario</button>
        <button class="btn btn-primary" id="recs-run-btn">Generar recomendaciones</button>
      </div>
    </div>
    <div id="recs-panel"></div>
  `;
  document.getElementById('recs-change-user').onclick = renderUserSetup;
  document.getElementById('recs-run-btn').onclick = run;
}

async function run() {
  // Las esperas de acá son largas de verdad: 30 top artistas de Last.fm, los
  // ~9.500 me gusta, y después una llamada de similares por artista con 150 ms
  // de pausa. Sobra tiempo para irse de la ruta. Ver util/vigencia-ruta.js.
  const ruta = vigilarRuta();
  const panel = document.getElementById('recs-panel');
  const username = getUsername();
  viewMode = 'normal';
  panel.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Bajando tus top artistas de Last.fm...</div></div>`;

  try {
    const top = await getUserTopArtists(username, '6month', 30);
    if (!ruta.vigente()) return;
    if (top.length === 0) {
      panel.innerHTML = `<div class="card"><p>No hay scrobbles para ${escapeHtml(username)} en los últimos 6 meses. ¿Es correcto el usuario?</p></div>`;
      return;
    }

    const [likes] = await Promise.all([getAllLikedTracks(() => {}).catch(() => [])]);
    if (!ruta.vigente()) return;
    const knownArtists = new Set();
    likedUris.clear();
    likes.forEach(i => {
      const n = i.track?.artists?.[0]?.name;
      if (n) knownArtists.add(n.toLowerCase());
      if (i.track?.uri) likedUris.add(i.track.uri);
    });

    panel.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:14px;margin-bottom:6px">Fetching similares para ${top.length} top artistas...</div>
        <div style="height:8px;background:var(--color-elevated);border-radius:4px;overflow:hidden">
          <div id="recs-bar" style="height:100%;background:var(--color-accent);width:0%;transition:width 0.2s"></div>
        </div>
        <div id="recs-progress-text" style="margin-top:6px;font-size:12px;color:var(--color-text-secondary)">0/${top.length}</div>
      </div>
    `;

    const scoreMap = new Map();
    let processed = 0;
    for (const src of top) {
      try {
        const similars = await getSimilarArtists(src.name, 15);
        for (const s of similars) {
          const key = s.name.toLowerCase();
          if (knownArtists.has(key)) continue;
          if (top.some(t => t.name.toLowerCase() === key)) continue;
          const score = (src.playcount || 1) * (s.match || 0);
          const prev = scoreMap.get(s.name) || { name: s.name, image: s.image, score: 0, sources: [] };
          prev.score += score;
          prev.sources.push(src.name);
          scoreMap.set(s.name, prev);
        }
      } catch {}
      processed++;
      // Corta entre artistas, igual que `scanArtists()` de `#discover-artists`:
      // seguir son 30 llamadas más a Last.fm para pintar una barra que ya no
      // está en el documento.
      if (!ruta.vigente()) return;
      const pct = (processed / top.length) * 100;
      document.getElementById('recs-bar').style.width = `${pct}%`;
      document.getElementById('recs-progress-text').textContent = `${processed}/${top.length}`;
      await sleep(150);
    }

    // Sin recortar a 50 acá: el recorte se aplica al RENDERIZAR (ver
    // renderRecommendations), después de sacar los ocultos — si se cortara
    // antes, ocultar uno de los 50 no lo reemplazaría por el 51.
    recommendations = [...scoreMap.values()].sort((a, b) => b.score - a.score);

    // Ocultos desde la playlist de Spotify. En segundo plano: la vista arranca
    // con el caché local y se repinta cuando llega la reconciliación (unión),
    // igual que hiddenAlbums en discover-common.js.
    hiddenArtists.ready().then(() => {
      if (!ruta.vigente()) return;
      renderRecommendations(ruta);
    }).catch(() => {});

    renderRecommendations(ruta);
  } catch (e) {
    if (!ruta.vigente()) return;
    panel.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function renderRecommendations(ruta = vigilarRuta()) {
  if (!ruta.vigente()) return;
  const panel = document.getElementById('recs-panel');
  if (recommendations.length === 0) {
    panel.innerHTML = `<div class="card"><p>No hay recomendaciones nuevas — parece que ya tienes a todos los similares de tus top artists.</p></div>`;
    return;
  }

  const pool = viewMode === 'hidden'
    ? recommendations.filter(a => hiddenArtists.has(a.name.toLowerCase()))
    : recommendations.filter(a => !hiddenArtists.has(a.name.toLowerCase()));
  const shown = pool.slice(0, 50);

  const hiddenToggleBtn = (hiddenArtists.size > 0 || viewMode === 'hidden')
    ? `<button class="btn btn-secondary btn-sm ${viewMode === 'hidden' ? 'sc-on' : ''}" id="recs-mode-hidden" title="Los que ocultaste. Se sincronizan con la playlist «fonoteca · ocultos (recomendados)».">Ocultos <span id="recs-hidden-n">${hiddenArtists.size}</span></button>`
    : '';

  if (shown.length === 0) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
        <div style="color:var(--color-text-secondary);font-size:14px">
          ${viewMode === 'hidden' ? 'No ocultaste ningún artista.' : 'No hay recomendaciones nuevas — parece que ya tienes a todos los similares de tus top artists.'}
        </div>
        ${hiddenToggleBtn}
      </div>
    `;
    document.getElementById('recs-mode-hidden')?.addEventListener('click', () => {
      viewMode = viewMode === 'hidden' ? 'normal' : 'hidden';
      renderRecommendations();
    });
    return;
  }

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">
      <div style="color:var(--color-text-secondary);font-size:14px">
        ${viewMode === 'hidden'
          ? `${shown.length} artista${shown.length === 1 ? '' : 's'} oculto${shown.length === 1 ? '' : 's'}.`
          : `${shown.length} artistas recomendados (filtrados los que ya tienes en likes). Click para ver top tracks.`}
      </div>
      ${hiddenToggleBtn}
    </div>
    <div class="smart-grid smart-grid-compact">
      ${shown.map((a, i) => renderArtistCard(a, i)).join('')}
    </div>
  `;
  panel.querySelectorAll('.recs-artist-pick').forEach(el => {
    el.onclick = () => pickArtist(shown[parseInt(el.dataset.idx)]);
  });
  panel.querySelectorAll('.recs-artist-hide').forEach(el => {
    el.onclick = async () => {
      const artist = shown[parseInt(el.dataset.idx)];
      if (!artist) return;
      el.disabled = true;
      try {
        const oculto = await toggleHiddenArtist(artist);
        showToast(oculto ? `«${artist.name}» oculto — no vuelve a aparecer` : `«${artist.name}» vuelve a la lista`, 'success');
      } catch (e) {
        showToast('No se pudo ocultar: ' + e.message, 'error');
      } finally {
        el.disabled = false;
      }
      renderRecommendations();
    };
  });
  document.getElementById('recs-mode-hidden')?.addEventListener('click', () => {
    viewMode = viewMode === 'hidden' ? 'normal' : 'hidden';
    renderRecommendations();
  });
}

function renderArtistCard(a, i) {
  const hidden = hiddenArtists.has(a.name.toLowerCase());
  return `
    <div class="smart-card recs-artist-card">
      <button type="button" class="recs-artist-pick" data-idx="${i}" title="Ver top tracks">
        <div class="smart-card-title" style="font-size:15px">${escapeHtml(a.name)}</div>
        <div class="smart-card-meta">${a.sources.length} match${a.sources.length > 1 ? 'es' : ''}</div>
      </button>
      <button type="button" class="sc-btn sc-hide recs-artist-hide" data-idx="${i}"
              title="${hidden ? 'Devolver a la lista' : 'No te interesa: ocultar (no vuelve a aparecer)'}"
              aria-label="${hidden ? 'Devolver a la lista' : 'Ocultar'}">${hidden ? ICONO_OJO_ABIERTO : ICONO_OJO_TACHADO}</button>
    </div>
  `;
}

async function pickArtist(artist) {
  const ruta = vigilarRuta();
  currentPick = artist;
  resolvedTracks = [];
  pickedUris.clear();

  const panel = document.getElementById('recs-panel');
  const yaOculto = hiddenArtists.has(artist.name.toLowerCase());
  panel.innerHTML = `
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" id="recs-back-btn">← Volver</button>
      <button class="btn btn-secondary btn-sm" id="recs-hide-btn">${yaOculto ? 'Devolver a la lista' : 'Ocultar este artista'}</button>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h2 style="margin-bottom:2px">${escapeHtml(artist.name)}</h2>
      <div style="color:var(--color-text-secondary);font-size:13px">
        Similar a: ${artist.sources.slice(0, 4).map(s => escapeHtml(s)).join(', ')}${artist.sources.length > 4 ? ` +${artist.sources.length - 4}` : ''}
      </div>
    </div>
    <div id="recs-tracks"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando top tracks...</div></div></div>
  `;
  document.getElementById('recs-back-btn').onclick = () => renderRecommendations();
  document.getElementById('recs-hide-btn').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const oculto = await toggleHiddenArtist(artist);
      showToast(oculto ? `«${artist.name}» oculto — no vuelve a aparecer` : `«${artist.name}» vuelve a la lista`, 'success');
      btn.textContent = oculto ? 'Devolver a la lista' : 'Ocultar este artista';
    } catch (err) {
      showToast('No se pudo ocultar: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };

  try {
    const topTracks = await getArtistTopTracks(artist.name, TOP_TRACKS_POR_ARTISTA);
    if (!ruta.vigente()) return;
    if (topTracks.length === 0) {
      document.getElementById('recs-tracks').innerHTML = `<div class="card"><p>Sin top tracks en Last.fm.</p></div>`;
      return;
    }
    await resolveTracksOnSpotify(topTracks, ruta);
  } catch (e) {
    if (!ruta.vigente()) return;
    document.getElementById('recs-tracks').innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

// Resuelve cada top track de Last.fm contra Spotify.
//
// ⚠️ **El apóstrofo dentro de las comillas rompe la búsqueda de Spotify** (ver
// el bloque de `limpiaParaQuery` en `util/track-match.js`): `track:"Can't Feel
// My Face"` devuelve 0. Esta vista mandaba el título crudo, así que cualquier
// tema con apóstrofo caía en «sin match» — que se lee como «Spotify no lo
// tiene» y no como un bug. Ahora se limpia, y como la query queda MÁS LAXA el
// resultado se verifica contra el nombre real (`titleMatches` + `artistMatches`)
// antes de darlo por bueno: sin esa verificación, aflojar la query es lo que
// traía a Nick Drake buscando Drake (v=124). Por eso también `limit=5` y no 1:
// con la query laxa el primer resultado puede no ser el que corresponde.
async function resolveTracksOnSpotify(topTracks, ruta = vigilarRuta()) {
  if (!ruta.vigente()) return;
  const tracksEl = document.getElementById('recs-tracks');
  tracksEl.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando en Spotify (0/${topTracks.length})...</div></div>`;

  const raw = [];
  for (let i = 0; i < topTracks.length; i++) {
    const t = topTracks[i];
    try {
      const q = `track:"${limpiaParaQuery(t.name)}" artist:"${limpiaParaQuery(t.artist)}"`;
      const data = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=5`);
      const hit = (data.tracks?.items || []).find(c =>
        titleMatches(t.name, c.name) && artistMatches(t.artist, (c.artists || []).map(a => a.name).join(', ')));
      if (hit) {
        const artistas = (hit.artists || []).map(a => a.name).filter(Boolean);
        raw.push({
          uri: hit.uri,
          trackId: hit.id,
          name: hit.name,
          artist: artistas.join(', '),
          // La lista entera, no el string unido: la cadena de proveedores acepta
          // el match si coincide CUALQUIER artista, y con el string unido no hay
          // más que un nombre imposible («A, B & C») contra el que comparar.
          artistList: artistas,
          album: hit.album?.name,
          albumId: hit.album?.id,
          image: hit.album?.images?.[hit.album.images.length - 1]?.url,
          imageBig: hit.album?.images?.[0]?.url,
          matched: true,
        });
      } else {
        raw.push({ uri: null, name: t.name, artist: t.artist, matched: false });
      }
    } catch {
      raw.push({ uri: null, name: t.name, artist: t.artist, matched: false });
    }
    // 30 búsquedas con 120 ms de pausa entre cada una: el corte va acá, antes
    // de tocar el contador, y no solo al final del bucle.
    if (!ruta.vigente()) return;
    tracksEl.querySelector('.empty-state div:last-child').textContent = `Buscando en Spotify (${i + 1}/${topTracks.length})...`;
    if (i < topTracks.length - 1) await sleep(PAUSA_ENTRE_BUSQUEDAS);
  }

  alreadyLikedInResolution = raw.filter(t => t.matched && likedUris.has(t.uri)).length;
  resolvedTracks = raw.filter(t => !(t.matched && likedUris.has(t.uri)));

  renderResolvedTracks(ruta);
}

function filaPorId(id) {
  return resolvedTracks.find(t => t.matched && t.trackId === id) || null;
}

// ── Preview ──────────────────────────────────────────────────────────────────
//
// La misma cadena de proveedores que el resto de la app (iTunes → Deezer →
// embed de Spotify). Se pasa `spotifyId` porque acá el embed es un fallback
// aceptable: la fila no tiene sitio para un iframe inline como el de `#skips`.
async function onPlayClick(r) {
  const res = await togglePreview(`rec:${r.trackId}`, () => getPreview({
    name: r.name,
    artists: r.artistList,
    spotifyId: r.trackId || undefined,
  }));
  if (res === null) showToast(`Sin preview disponible de «${r.name}»`, 'info');
}

document.addEventListener('previewchange', (e) => {
  paintPlayingCard(document.getElementById('recs-tracks'), 'rec', e.detail);
});

// Una fila es un `<label>` que ENVUELVE el checkbox, así que un click en
// cualquier descendiente lo tilda aunque el descendiente tenga su propio
// handler. Para las acciones que NO son marcar hace falta `preventDefault()`
// ADEMÁS de `stopPropagation()`: solo con el segundo la acción corre igual y de
// paso queda la canción marcada (v=164).
function accionesDeFila(tracksEl) {
  tracksEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn || !tracksEl.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const fila = e.target.closest('[data-id]');
    const r = fila && filaPorId(fila.dataset.id);
    if (!r) return;
    if (btn.dataset.accion === 'play') { onPlayClick(r); return; }
    if (btn.dataset.accion === 'ficha') {
      openTrackCard({ id: r.trackId, name: r.name, artists: r.artistList, album: r.album, img: r.imageBig || r.image });
      return;
    }
    if (btn.dataset.accion === 'album') {
      openAlbumCard({ name: r.album, artist: r.artistList?.[0] || r.artist, albumId: r.albumId, img: r.imageBig || r.image });
    }
  });
}

function filaHtml(t) {
  if (!t.matched) {
    return `
      <div class="pretty-check-row" style="opacity:0.5">
        <div style="width:40px;height:40px;background:var(--color-elevated);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--color-text-muted)">?</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px">${escapeHtml(t.name)}</div>
          <div style="font-size:12px;color:var(--color-text-muted)">${escapeHtml(t.artist)} — sin match</div>
        </div>
      </div>`;
  }
  const sonando = playingKey() === `rec:${t.trackId}`;
  const pausa = sonando && isPlayingAudio();
  return `
    <label class="pretty-check-row" data-id="${escapeHtml(t.trackId)}">
      <input type="checkbox" class="pretty-check recs-track-check" data-uri="${t.uri}" checked>
      <span class="pretty-check-box"></span>
      ${t.image
        ? `<img src="${t.image}" style="width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover">`
        : `<div style="width:40px;height:40px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</div>
        <div style="font-size:12px;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.artist)}${t.album ? ` · ${escapeHtml(t.album)}` : ''}</div>
      </div>
      <div class="recs-row-actions">
        <button type="button" class="sc-btn sc-play${sonando ? ' playing' : ''}" data-accion="play"
                title="${pausa ? 'Parar el preview' : 'Preview de 30 s — no suma reproducciones'}"
                aria-label="${pausa ? 'Parar preview' : 'Preview'}">${pausa ? ICONO_PAUSA : ICONO_PLAY}</button>
        <button type="button" class="sc-btn" data-accion="ficha" title="Ver la ficha del tema" aria-label="Ficha del tema">${ICONO_FICHA}</button>
        ${t.album ? `<button type="button" class="sc-btn" data-accion="album" title="Ver la ficha del álbum" aria-label="Ficha del álbum">${ICONO_DISCO}</button>` : ''}
      </div>
    </label>`;
}

function renderResolvedTracks(ruta = vigilarRuta()) {
  if (!ruta.vigente()) return;
  const tracksEl = document.getElementById('recs-tracks');
  const matched = resolvedTracks.filter(t => t.matched);
  matched.forEach(t => pickedUris.add(t.uri));

  tracksEl.innerHTML = `
    <div class="results-summary">
      <div class="stat-card">
        <div class="stat-value">${matched.length}</div>
        <div class="stat-label">Nuevos en Spotify</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--color-text-muted)">${alreadyLikedInResolution}</div>
        <div class="stat-label">Ya en tus likes (ocultos)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--color-text-muted)">${resolvedTracks.length - matched.length}</div>
        <div class="stat-label">Sin match</div>
      </div>
    </div>
    ${matched.length === 0 ? `
      <div class="card" style="margin-bottom:16px"><p>Todos los top tracks de este artista ya están en tus likes. Vuelve y prueba con otro.</p></div>
    ` : ''}

    <div style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
      <div style="font-size:13px;color:var(--color-text-secondary)">
        <strong id="recs-picked-count">${pickedUris.size}</strong> tracks seleccionados
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="recs-clear-btn">Deseleccionar todo</button>
        <button class="btn btn-primary" id="recs-create-btn">Crear playlist</button>
      </div>
    </div>

    <div class="card">
      <div class="tracks-grid">
        ${resolvedTracks.map(filaHtml).join('')}
      </div>
    </div>
  `;

  accionesDeFila(tracksEl);

  tracksEl.querySelectorAll('.recs-track-check').forEach(box => {
    box.onchange = () => {
      if (box.checked) pickedUris.add(box.dataset.uri);
      else pickedUris.delete(box.dataset.uri);
      document.getElementById('recs-picked-count').textContent = pickedUris.size;
    };
  });
  document.getElementById('recs-clear-btn').onclick = () => {
    pickedUris.clear();
    tracksEl.querySelectorAll('.recs-track-check').forEach(b => { b.checked = false; });
    document.getElementById('recs-picked-count').textContent = 0;
  };
  document.getElementById('recs-create-btn').onclick = createPlaylistFromPicks;
}

async function createPlaylistFromPicks() {
  if (pickedUris.size === 0) {
    showToast('No seleccionaste nada', 'error');
    return;
  }
  const uris = [...pickedUris];
  const suggested = `Discover: ${currentPick.name}`;
  const name = await promptPlaylistName(suggested, { trackCount: uris.length });
  if (!name) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, `Recomendado desde tus scrobbles`, false);
    showProgress('Agregando tracks...', 0, uris.length);
    await addTracksToPlaylist(playlist.id, uris);
    invalidatePlaylistsCache();
    hideProgress();
    showToast(`"${name}" creada`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
