// Ficha de artista: modal simétrico al de canción — minutos totales, plays,
// primer/último año, top tracks del artista, hover-play, y plays actuales
// vía Stats.fm si aplica. Se abre desde cualquier feature con openArtistCard({ name }).

import { loadHistoryStats, isOwner } from './history-data.js?v=116';
import { escapeHtml } from '../ui/components.js?v=116';
import { getPreview, getArtistTopPreview } from '../api/preview-providers.js?v=116';
import { togglePreview, playingKey, attachHover } from '../ui/preview-player.js?v=116';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js?v=116';
import { openTrackCard } from './track-card.js?v=116';
import { spotifyFetch, getBestAvailableLikes } from '../api.js?v=116';
import { openModal, closeTop } from '../ui/modal-stack.js?v=116';

// Cache de imágenes de artistas resueltas por Spotify search. TTL 30 días.
// Se persiste el hit y la falta (null) para no reintentar contra tracks
// desconocidos por Spotify.
const IMG_CACHE_KEY = 'spotify_artist_imgs_v1';
const IMG_CACHE_MAX = 400;
const IMG_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function loadImgCache() {
  try { return JSON.parse(localStorage.getItem(IMG_CACHE_KEY)) || {}; } catch { return {}; }
}
function saveImgCache(c) {
  const keys = Object.keys(c);
  if (keys.length > IMG_CACHE_MAX) for (const k of keys.slice(0, keys.length - IMG_CACHE_MAX)) delete c[k];
  try { localStorage.setItem(IMG_CACHE_KEY, JSON.stringify(c)); } catch { /* full */ }
}
// Lee sync del cache — sirve para pintar la foto en el primer frame del render
// (evita que aparezca el placeholder con la inicial antes de que resuelva la
// promesa async, que es lo que se veía al reabrir la ficha desde la pila).
function getArtistImageSync(name) {
  const cache = loadImgCache();
  const hit = cache[(name || '').toLowerCase()];
  if (hit && (Date.now() - hit.t) < IMG_TTL_MS) return hit.u || null;
  return null;
}
async function fetchArtistImage(name) {
  const key = name.toLowerCase();
  const cache = loadImgCache();
  const hit = cache[key];
  if (hit && (Date.now() - hit.t) < IMG_TTL_MS) return hit.u;
  try {
    const data = await spotifyFetch(`/search?q=${encodeURIComponent(`artist:"${name}"`)}&type=artist&limit=3`);
    const artists = data?.artists?.items || [];
    // Match exacto por nombre normalizado, preferido; si no, el primer resultado
    const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const na = norm(name);
    const exact = artists.find(a => norm(a.name) === na);
    const pick = exact || artists[0];
    const img = pick?.images?.[1]?.url || pick?.images?.[0]?.url || null;
    cache[key] = { u: img, t: Date.now() };
    saveImgCache(cache);
    return img;
  } catch {
    return null;
  }
}

let chart = null;

function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) return `${Math.floor(min / 60).toLocaleString('es-AR')}h ${Math.round(min % 60)}m`;
  return `${Math.round(min)}m`;
}

function onModalClose() {
  if (chart) { chart.destroy(); chart = null; }
}

// Cuando este modal vuelve a ser el top de la pila (recupera visibility),
// Chart.js necesita una re-medición: mientras estuvo hidden puede haber
// perdido el ancho del contenedor y quedar con canvas 0×0.
function onModalReveal() {
  if (chart) requestAnimationFrame(() => { try { chart.resize(); } catch { /* noop */ } });
}

document.addEventListener('previewchange', (e) => {
  const btn = document.getElementById('ac-preview');
  if (btn && !(e.detail.key || '').startsWith('ac:') && btn.textContent !== 'Sin preview') {
    btn.textContent = '▶ Preview';
  }
});

async function openArtistCard(a) {
  // a: { name } — todo lo demás lo derivamos del historial.
  if (!a || !a.name) return;

  // Foto cacheada 30d: si la tenemos, la inyectamos en el markup inicial para
  // que no aparezca el placeholder ni por un frame al reabrir la ficha.
  const cachedImg = getArtistImageSync(a.name);
  const avatarInner = cachedImg
    ? `<img src="${cachedImg}" alt="" style="width:100%;height:100%;object-fit:cover">`
    : escapeHtml((a.name[0] || '?').toUpperCase());

  const overlay = openModal({
    id: `artist-card:${a.name}`,
    onClose: onModalClose,
    onReveal: onModalReveal,
    html: `
    <div class="modal card-modal ac-modal" style="max-width:720px;width:min(720px,94vw)">
      <div class="ac-head">
        <div id="ac-avatar" class="ac-avatar" style="background:var(--color-accent-soft);color:var(--color-accent);font-weight:700">${avatarInner}</div>
        <div class="ac-title">
          <h3>${escapeHtml(a.name)}</h3>
          <div class="ac-sub">Artista</div>
        </div>
        <div class="ac-head-actions">
          <button class="btn btn-secondary btn-sm" id="ac-preview">▶ Preview</button>
          <a class="btn btn-secondary btn-sm" href="https://open.spotify.com/search/${encodeURIComponent(a.name)}/artists" target="_blank" rel="noopener">↗ Spotify</a>
          <button class="btn btn-secondary btn-sm" id="ac-mis-likes" type="button">Mis likes</button>
          <button class="btn btn-secondary btn-sm card-modal-close" data-close-modal title="Cerrar">✕</button>
        </div>
      </div>
      <div class="ac-body-scroll" id="ac-body"><div style="text-align:center;padding:24px"><div class="spinner"></div></div></div>
    </div>
  `,
  });
  overlay.querySelector('#ac-mis-likes').onclick = () => openArtistLikesModal(a.name);

  // Si no había cache, resolvemos async y pintamos apenas llega
  if (!cachedImg) {
    fetchArtistImage(a.name).then(url => {
      const av = overlay.querySelector('#ac-avatar');
      if (!av || !url) return;
      av.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">`;
    });
  }

  const previewBtn = overlay.querySelector('#ac-preview');
  previewBtn.onclick = async () => {
    const res = await togglePreview(`ac:${a.name}`, async () => {
      return await getArtistTopPreview(a.name);
    });
    previewBtn.textContent = res === true ? '⏹ Parar' : '▶ Preview';
    if (res === null) previewBtn.textContent = 'Sin preview';
  };
  if (playingKey() === `ac:${a.name}`) previewBtn.textContent = '⏹ Parar';

  const body = overlay.querySelector('#ac-body');
  const owner = await isOwner();
  if (!owner) {
    body.innerHTML = `<p style="color:var(--color-text-secondary);font-size:13px;margin:0">La historia de reproducción es del dueño de esta instancia — solo el preview y los links están disponibles.</p>`;
    return;
  }

  const stats = await loadHistoryStats();
  if (!stats) { body.innerHTML = ''; return; }

  // Datos del artista: recorro years para armar la curva por año + acumular tops.
  const yearsWithArtist = [];
  const trackAcum = new Map();  // key = nombre → { name, min, plays }
  let firstYear = null, lastYear = null;
  let totalMin = 0, totalPlays = 0;
  for (const y of stats.years) {
    const ta = (y.top_artists || []).find(x => x.name === a.name);
    if (!ta) { yearsWithArtist.push({ year: y.year, min: 0, plays: 0 }); continue; }
    yearsWithArtist.push({ year: y.year, min: ta.min, plays: ta.plays });
    if (firstYear == null) firstYear = y.year;
    lastYear = y.year;
    totalMin += ta.min;
    totalPlays += ta.plays;
    for (const t of (y.top_tracks || [])) {
      if (t.artist !== a.name) continue;
      const prev = trackAcum.get(t.name) || { name: t.name, min: 0, plays: 0, uri: t.uri };
      prev.min += t.min;
      prev.plays += t.plays;
      trackAcum.set(t.name, prev);
    }
  }

  // Si el artista tampoco está en top_artists_all_time, no tenemos datos concretos
  const allTime = (stats.top_artists_all_time || []).find(x => x.name === a.name);
  if (allTime) {
    totalMin = allTime.min || totalMin;
    totalPlays = allTime.plays || totalPlays;
    firstYear = firstYear || allTime.first_year;
  }

  if (!totalPlays && !allTime) {
    body.innerHTML = `<p style="color:var(--color-text-secondary);font-size:13px;margin:0">No aparece en tu historial (o no está en los tops de ningún año). Igual podés escucharlo en Spotify y ver el preview arriba.</p>`;
    return;
  }

  // Completo trackAcum con top_tracks_all_time del artista (tiene más profundidad
   // que la unión de tops anuales). Esto arregla que Bad Bunny mostrara solo 2.
  for (const t of (stats.top_tracks_all_time || [])) {
    if (t.artist !== a.name) continue;
    if (trackAcum.has(t.name)) continue;
    trackAcum.set(t.name, { name: t.name, min: t.min || 0, plays: t.plays || 0, uri: t.uri });
  }
  const topTracks = [...trackAcum.values()].sort((a, b) => b.plays - a.plays).slice(0, 5);

  const hasChart = yearsWithArtist.some(y => y.min > 0);
  body.innerHTML = `
    <div class="tc-stats ac-stats">
      <div class="tc-stat"><div class="tc-stat-v">${fmtMinutes(totalMin)}</div><div class="tc-stat-l">minutos totales</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${totalPlays.toLocaleString('es-AR')}</div><div class="tc-stat-l">plays</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${firstYear || '—'}</div><div class="tc-stat-l">primer año</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${lastYear || '—'}</div><div class="tc-stat-l">último año</div></div>
    </div>
    <div class="ac-cols">
      ${hasChart ? `
        <div class="ac-col-chart">
          <div class="ac-col-title">Minutos escuchados por año</div>
          <div class="chart-box" style="height:180px"><canvas id="ac-chart"></canvas></div>
        </div>
      ` : ''}
      <div class="ac-col-tracks">
        <div class="ac-col-title">Tus 5 tracks más escuchados</div>
        <div id="ac-top-tracks" style="display:flex;flex-direction:column;gap:6px">
          ${topTracks.length ? topTracks.map((t, i) => `
            <div class="wrapped-top-row tc-clickable" data-uri="${t.uri || ''}" data-name="${escapeHtml(t.name)}">
              <span class="wrapped-top-rank">${i + 1}</span>
              <div class="wrapped-top-info">
                <div class="wrapped-top-name">${escapeHtml(t.name)}</div>
              </div>
              <span class="wrapped-top-meta">${fmtMinutes(t.min)} · ${t.plays} plays</span>
            </div>
          `).join('') : `<div style="color:var(--color-text-muted);font-size:12px;padding:8px 4px">Sin tracks puntuales en tu historial anual — buscando en Stats.fm…</div>`}
        </div>
      </div>
    </div>
    <div id="ac-statsfm"></div>
  `;

  // Click en un top track → ficha de canción
  body.querySelectorAll('.wrapped-top-row').forEach(el => {
    const uri = el.dataset.uri;
    if (!uri) return;
    const id = uri.split(':').pop();
    el.onclick = () => openTrackCard({ id, name: el.dataset.name, artist: a.name });
  });

  // Chart de años (solo años con datos). Doble rAF para que el browser haga
  // layout de todo el modal antes de que Chart.js mida el contenedor — si lo
  // instanciamos justo después de innerHTML, el .chart-box todavía no tiene
  // ancho medido dentro del modal (flex+overflow del overlay) y Chart.js se
  // engancha al 0 y queda para siempre así (v=107 modal-stack).
  if (yearsWithArtist.some(y => y.min > 0)) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const canvas = overlay.querySelector('#ac-chart');
      if (!canvas) return;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#7C3AED';
      chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: yearsWithArtist.map(y => y.year),
          datasets: [{ data: yearsWithArtist.map(y => y.min), backgroundColor: accent, borderRadius: 3 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'nearest', intersect: false, axis: 'x' },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => `${Math.round(ctx.parsed.y)} min` } },
          },
          scales: {
            x: { ticks: { color: '#8888A0', font: { family: 'Inter', size: 11 } }, grid: { display: false } },
            y: {
              beginAtZero: true,
              ticks: { color: '#8888A0', font: { family: 'Inter', size: 10 } },
              grid: { color: 'rgba(136,136,160,0.12)' },
            },
          },
        },
      });
    }));
  }

  // Stats.fm actual (si está en el top-1000 lifetime)
  if (hasUsername()) fillStatsfmArtist(a.name, topTracks.length === 0);
}

async function fillStatsfmArtist(name, fillEmptyTracks = false) {
  const holder = document.getElementById('ac-statsfm');
  const tracksHolder = fillEmptyTracks ? document.getElementById('ac-top-tracks') : null;
  if (!holder && !tracksHolder) return;
  try {
    const top = await loadTopLifetime();
    if (!top) {
      if (tracksHolder) tracksHolder.innerHTML = `<div style="color:var(--color-text-muted);font-size:12px;padding:8px 4px">Sin tracks puntuales en tu historial anual.</div>`;
      return;
    }
    // Sumar streams y juntar tracks del artista en el top-1000
    let plays = 0, ms = 0, tracks = 0;
    const artistTracks = [];
    for (const e of top.map.values()) {
      if (e.artist !== name) continue;
      plays += e.streams;
      ms += e.playedMs;
      tracks++;
      artistTracks.push(e);
    }
    if (holder && plays) {
      holder.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-top:14px;padding:8px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm,6px);font-size:12.5px;color:var(--color-text-secondary)">
          <strong style="color:var(--color-text)">Stats.fm hoy:</strong>
          ${plays.toLocaleString('es-AR')} plays · ${Math.round(ms / 60000).toLocaleString('es-AR')}m
          <span style="color:var(--color-text-muted)">(${tracks} track${tracks === 1 ? '' : 's'} en tu top-1000)</span>
        </div>`;
    }
    if (tracksHolder) {
      const top5 = artistTracks.sort((a, b) => b.streams - a.streams).slice(0, 5);
      if (top5.length) {
        tracksHolder.innerHTML = top5.map((t, i) => {
          const min = Math.round(t.playedMs / 60000);
          const id = t.sid || '';
          return `
            <div class="wrapped-top-row${id ? ' tc-clickable' : ''}" data-uri="${id ? 'spotify:track:' + id : ''}" data-name="${escapeHtml(t.name || '')}">
              <span class="wrapped-top-rank">${i + 1}</span>
              <div class="wrapped-top-info">
                <div class="wrapped-top-name">${escapeHtml(t.name || '(sin nombre)')}</div>
                <div class="wrapped-top-artist" style="font-size:10px;color:var(--color-text-muted)">Stats.fm</div>
              </div>
              <span class="wrapped-top-meta">${min.toLocaleString('es-AR')}m · ${t.streams} plays</span>
            </div>`;
        }).join('');
        tracksHolder.querySelectorAll('[data-uri]').forEach(el => {
          const uri = el.dataset.uri;
          if (!uri) return;
          const id = uri.split(':').pop();
          el.onclick = () => openTrackCard({ id, name: el.dataset.name, artist: name });
        });
      } else {
        tracksHolder.innerHTML = `<div style="color:var(--color-text-muted);font-size:12px;padding:8px 4px">Sin tracks puntuales en tu top-1000 tampoco.</div>`;
      }
    }
  } catch { /* silencioso */ }
}

// Modal de "Mis likes del artista" — apilado encima de la ficha de artista.
// Filtra el cache de likes en IDB por nombre de artista normalizado y muestra
// las canciones con tapa chica, álbum y fecha de like.
// Click en una fila → ficha canción encima (tercer nivel de la pila).
const normName = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

function fmtLikeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function openArtistLikesModal(artistName) {
  const overlay = openModal({
    id: `artist-likes:${artistName}`,
    html: `
      <div class="modal modal-picker" style="max-width:560px;width:min(560px,94vw)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
          <div>
            <h2 style="margin:0 0 2px;font-size:17px">Mis likes de ${escapeHtml(artistName)}</h2>
            <div id="al-count" style="font-size:12px;color:var(--color-text-muted)">Cargando…</div>
          </div>
          <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar">✕</button>
        </div>
        <div class="picker-scroll" id="al-scroll">
          <div style="text-align:center;padding:32px"><div class="spinner"></div></div>
        </div>
      </div>
    `,
  });

  const scroll = overlay.querySelector('#al-scroll');
  const countEl = overlay.querySelector('#al-count');

  let likes;
  try {
    const res = await getBestAvailableLikes();
    likes = res.items || [];
  } catch (e) {
    scroll.innerHTML = `<p style="color:var(--color-text-secondary);padding:16px;text-align:center">No pude leer tus likes: ${escapeHtml(e.message)}</p>`;
    return;
  }

  if (!likes.length) {
    countEl.textContent = '';
    scroll.innerHTML = `<p style="color:var(--color-text-secondary);padding:16px;text-align:center">Todavía no bajaste tus likes. Andá al Dashboard y apretá "Actualizar" para sincronizarlos.</p>`;
    return;
  }

  const target = normName(artistName);
  const filtered = likes.filter(it => {
    const t = it.track;
    if (!t) return false;
    const artists = t.artists || [];
    return artists.some(x => normName(x.name) === target);
  });

  if (!filtered.length) {
    countEl.textContent = '0 likes';
    scroll.innerHTML = `<p style="color:var(--color-text-secondary);padding:24px 16px;text-align:center">No tenés likes de ${escapeHtml(artistName)}. Todavía.</p>`;
    return;
  }

  // Ordenados por fecha de like descendente (más recientes primero)
  filtered.sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));

  countEl.textContent = `${filtered.length} like${filtered.length === 1 ? '' : 's'}`;
  scroll.innerHTML = `
    <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm);overflow:hidden">
      ${filtered.map((it, i) => {
        const t = it.track;
        const img = t.album?.images?.[2]?.url || t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '';
        const album = t.album?.name || '';
        return `
          <div class="pick-row al-row" data-i="${i}"
               style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--color-border);cursor:pointer">
            ${img
              ? `<img src="${img}" loading="lazy" class="pick-cover" alt="">`
              : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted)">♪</div>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name || '(sin nombre)')}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(album)}</div>
            </div>
            <div style="font-size:11px;color:var(--color-text-muted);flex-shrink:0;text-align:right">${escapeHtml(fmtLikeDate(it.added_at))}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  scroll.querySelectorAll('.al-row').forEach(row => {
    const idx = +row.dataset.i;
    const it = filtered[idx];
    const t = it.track;
    const img = t.album?.images?.[2]?.url || t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '';
    row.onclick = () => openTrackCard({
      id: t.id,
      name: t.name,
      artist: (t.artists || []).map(x => x.name).join(', '),
      album: t.album?.name,
      img,
    });
    attachHover(row, `al-hover:${t.id}`, async () => {
      return await getPreview({
        name: t.name || '',
        artist: (t.artists?.[0]?.name) || artistName,
        spotifyId: t.id,
      });
    });
  });
}

// Azúcar: enganchar hover-play + click-ficha en un elemento cualquiera que
// representa un artista. Devuelve el listener por si querés desengancharlo.
function attachArtistCard(el, name) {
  el.classList.add('tc-clickable');
  el.title = 'Preview al apoyar el mouse · click para ver la ficha';
  el.onclick = () => openArtistCard({ name });
  attachHover(el, `ac-hover:${name}`, async () => {
    return await getArtistTopPreview(name);
  });
}

export { openArtistCard, attachArtistCard };
