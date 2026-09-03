import { spotifyFetch, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache, getAllLikedTracks } from '../api.js?v=194';
import { hasKey, setKey, hasUsername, getUsername, setUsername, getUserTopArtists, getSimilarArtists, getArtistTopTracks } from '../api/lastfm.js?v=194';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml, pageHeader } from '../ui/components.js?v=194';
import { showToast } from '../ui/toast.js?v=194';
import { getPreview } from '../api/preview-providers.js?v=194';
import { togglePreview, playingKey, isPlayingAudio } from '../ui/preview-player.js?v=194';
import { paintPlayingCard } from '../ui/track-card-row.js?v=194';
import { openTrackCard } from './track-card.js?v=194';
import { openAlbumCard } from './album-card.js?v=194';
import { limpiaParaQuery, titleMatches, artistMatches } from '../util/track-match.js?v=194';

// Iconos de las dos fichas. Los mismos trazos que usa la tarjeta compartida.
const ICONO_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>`;
const ICONO_PAUSA = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>`;
const ICONO_FICHA = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>`;
const ICONO_DISCO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/></svg>`;

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
  const panel = document.getElementById('recs-panel');
  const username = getUsername();
  panel.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Bajando tus top artistas de Last.fm...</div></div>`;

  try {
    const top = await getUserTopArtists(username, '6month', 30);
    if (top.length === 0) {
      panel.innerHTML = `<div class="card"><p>No hay scrobbles para ${escapeHtml(username)} en los últimos 6 meses. ¿Es correcto el usuario?</p></div>`;
      return;
    }

    const [likes] = await Promise.all([getAllLikedTracks(() => {}).catch(() => [])]);
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
      const pct = (processed / top.length) * 100;
      document.getElementById('recs-bar').style.width = `${pct}%`;
      document.getElementById('recs-progress-text').textContent = `${processed}/${top.length}`;
      await sleep(150);
    }

    recommendations = [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    renderRecommendations();
  } catch (e) {
    panel.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function renderRecommendations() {
  const panel = document.getElementById('recs-panel');
  if (recommendations.length === 0) {
    panel.innerHTML = `<div class="card"><p>No hay recomendaciones nuevas — parece que ya tienes a todos los similares de tus top artists.</p></div>`;
    return;
  }
  panel.innerHTML = `
    <div style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px">
      ${recommendations.length} artistas recomendados (filtrados los que ya tienes en likes). Click para ver top tracks.
    </div>
    <div class="smart-grid smart-grid-compact">
      ${recommendations.map((a, i) => `
        <button class="smart-card recs-artist-card" data-idx="${i}">
          <div class="smart-card-title" style="font-size:15px">${escapeHtml(a.name)}</div>
          <div class="smart-card-meta">${a.sources.length} match${a.sources.length > 1 ? 'es' : ''}</div>
        </button>
      `).join('')}
    </div>
  `;
  panel.querySelectorAll('.recs-artist-card').forEach(el => {
    el.onclick = () => pickArtist(recommendations[parseInt(el.dataset.idx)]);
  });
}

async function pickArtist(artist) {
  currentPick = artist;
  resolvedTracks = [];
  pickedUris.clear();

  const panel = document.getElementById('recs-panel');
  panel.innerHTML = `
    <div style="margin-bottom:12px">
      <button class="btn btn-secondary btn-sm" id="recs-back-btn">← Volver</button>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h2 style="margin-bottom:2px">${escapeHtml(artist.name)}</h2>
      <div style="color:var(--color-text-secondary);font-size:13px">
        Similar a: ${artist.sources.slice(0, 4).map(s => escapeHtml(s)).join(', ')}${artist.sources.length > 4 ? ` +${artist.sources.length - 4}` : ''}
      </div>
    </div>
    <div id="recs-tracks"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando top tracks...</div></div></div>
  `;
  document.getElementById('recs-back-btn').onclick = renderRecommendations;

  try {
    const topTracks = await getArtistTopTracks(artist.name, TOP_TRACKS_POR_ARTISTA);
    if (topTracks.length === 0) {
      document.getElementById('recs-tracks').innerHTML = `<div class="card"><p>Sin top tracks en Last.fm.</p></div>`;
      return;
    }
    await resolveTracksOnSpotify(topTracks);
  } catch (e) {
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
async function resolveTracksOnSpotify(topTracks) {
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
    tracksEl.querySelector('.empty-state div:last-child').textContent = `Buscando en Spotify (${i + 1}/${topTracks.length})...`;
    if (i < topTracks.length - 1) await sleep(PAUSA_ENTRE_BUSQUEDAS);
  }

  alreadyLikedInResolution = raw.filter(t => t.matched && likedUris.has(t.uri)).length;
  resolvedTracks = raw.filter(t => !(t.matched && likedUris.has(t.uri)));

  renderResolvedTracks();
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

function renderResolvedTracks() {
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
      ${resolvedTracks.map(filaHtml).join('')}
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
