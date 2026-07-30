// Ficha de artista: modal simétrico al de canción — minutos totales, plays,
// primer/último año, top tracks del artista, hover-play, y plays actuales
// vía Stats.fm si aplica. Se abre desde cualquier feature con openArtistCard({ name }).

import { loadHistoryStats, isOwner } from './history-data.js?v=101';
import { escapeHtml } from '../ui/components.js?v=101';
import { findArtistTopPreview } from '../api/itunes.js?v=101';
import { togglePreview, playingKey, attachHover } from '../ui/preview-player.js?v=101';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js?v=101';
import { openTrackCard } from './track-card.js?v=101';
import { spotifyFetch } from '../api.js?v=101';

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

function close() {
  if (chart) { chart.destroy(); chart = null; }
  document.getElementById('artist-card-overlay')?.remove();
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
  close();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'artist-card-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:640px;width:min(640px,92vw)">
      <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:14px">
        <div id="ac-avatar" style="width:64px;height:64px;border-radius:50%;background:var(--color-accent-soft);display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--color-accent);font-weight:700;flex-shrink:0;overflow:hidden">
          ${escapeHtml((a.name[0] || '?').toUpperCase())}
        </div>
        <div style="flex:1;min-width:0">
          <h3 style="margin:0 0 2px;font-size:18px;line-height:1.25">${escapeHtml(a.name)}</h3>
          <div style="color:var(--color-text-secondary);font-size:13px">Artista</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-secondary btn-sm" id="ac-preview">▶ Preview</button>
            <a class="btn btn-secondary btn-sm" href="https://open.spotify.com/search/${encodeURIComponent(a.name)}/artists" target="_blank" rel="noopener">Buscar en Spotify ↗</a>
            <a class="btn btn-secondary btn-sm" href="#byartist" id="ac-byartist">Mis likes de este artista</a>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" id="ac-close" title="Cerrar" style="flex-shrink:0">✕</button>
      </div>
      <div id="ac-body"><div style="text-align:center;padding:24px"><div class="spinner"></div></div></div>
    </div>
  `;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.body.appendChild(overlay);
  overlay.querySelector('#ac-close').onclick = close;
  overlay.querySelector('#ac-byartist').onclick = () => { close(); };

  // Carga la foto real del artista via Spotify search (async, sin bloquear el resto)
  fetchArtistImage(a.name).then(url => {
    const av = document.getElementById('ac-avatar');
    if (!av || !url) return;
    av.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">`;
  });

  const previewBtn = overlay.querySelector('#ac-preview');
  previewBtn.onclick = async () => {
    const res = await togglePreview(`ac:${a.name}`, async () => {
      const p = await findArtistTopPreview(a.name);
      return p && { url: p.url, label: `${p.track} — ${p.artist}` };
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

  const topTracks = [...trackAcum.values()].sort((a, b) => b.plays - a.plays).slice(0, 5);

  body.innerHTML = `
    <div class="tc-stats">
      <div class="tc-stat"><div class="tc-stat-v">${fmtMinutes(totalMin)}</div><div class="tc-stat-l">minutos totales</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${totalPlays.toLocaleString('es-AR')}</div><div class="tc-stat-l">plays</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${firstYear || '—'}</div><div class="tc-stat-l">primer año</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${lastYear || '—'}</div><div class="tc-stat-l">último año</div></div>
    </div>
    ${yearsWithArtist.some(y => y.min > 0) ? `
      <div style="font-size:12px;color:var(--color-text-muted);margin:12px 2px 6px">Minutos escuchados por año</div>
      <div class="chart-box" style="height:180px"><canvas id="ac-chart"></canvas></div>
    ` : ''}
    ${topTracks.length ? `
      <div style="font-size:12px;color:var(--color-text-muted);margin:16px 2px 6px">Tus 5 tracks más escuchados</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${topTracks.map((t, i) => `
          <div class="wrapped-top-row tc-clickable" data-uri="${t.uri || ''}" data-name="${escapeHtml(t.name)}">
            <span class="wrapped-top-rank">${i + 1}</span>
            <div class="wrapped-top-info">
              <div class="wrapped-top-name">${escapeHtml(t.name)}</div>
            </div>
            <span class="wrapped-top-meta">${fmtMinutes(t.min)} · ${t.plays} plays</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
    <div id="ac-statsfm"></div>
  `;

  // Click en un top track → ficha de canción
  body.querySelectorAll('.wrapped-top-row').forEach(el => {
    const uri = el.dataset.uri;
    if (!uri) return;
    const id = uri.split(':').pop();
    el.onclick = () => openTrackCard({ id, name: el.dataset.name, artist: a.name });
  });

  // Chart de años (solo años con datos)
  if (yearsWithArtist.some(y => y.min > 0)) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#7C3AED';
    chart = new Chart(document.getElementById('ac-chart'), {
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
  }

  // Stats.fm actual (si está en el top-1000 lifetime)
  if (hasUsername()) fillStatsfmArtist(a.name);
}

async function fillStatsfmArtist(name) {
  const holder = document.getElementById('ac-statsfm');
  if (!holder) return;
  try {
    const top = await loadTopLifetime();
    if (!top) return;
    // Sumar streams de todos los tracks del artista que estén en el top
    let plays = 0, ms = 0, tracks = 0;
    for (const e of top.map.values()) {
      if (e.artist === name) { plays += e.streams; ms += e.playedMs; tracks++; }
    }
    if (!plays) return;
    holder.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-top:14px;padding:8px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm,6px);font-size:12.5px;color:var(--color-text-secondary)">
        <strong style="color:var(--color-text)">Stats.fm hoy:</strong>
        ${plays.toLocaleString('es-AR')} plays · ${Math.round(ms / 60000).toLocaleString('es-AR')}m
        <span style="color:var(--color-text-muted)">(${tracks} track${tracks === 1 ? '' : 's'} en tu top-1000)</span>
      </div>`;
  } catch { /* silencioso */ }
}

// Azúcar: enganchar hover-play + click-ficha en un elemento cualquiera que
// represente un artista. Devuelve el listener por si querés desengancharlo.
function attachArtistCard(el, name) {
  el.classList.add('tc-clickable');
  el.title = 'Preview al apoyar el mouse · click para ver la ficha';
  el.onclick = () => openArtistCard({ name });
  attachHover(el, `ac-hover:${name}`, async () => {
    const p = await findArtistTopPreview(name);
    return p && { url: p.url, label: `${p.track} — ${p.artist}` };
  });
}

export { openArtistCard, attachArtistCard };
