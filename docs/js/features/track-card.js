// Ficha de canción: modal con la historia completa de un track según el
// Extended Streaming History — curva de plays por mes, primera/última vez,
// días distintos, récord en un día — más preview iTunes y link a Spotify.
// Se abre desde cualquier feature con openTrackCard({ id, name, artist, album, img }).

import { loadTrackPlays, loadTrackDetail, loadHistoryStats, isOwner } from './history-data.js?v=131';
import { escapeHtml } from '../ui/components.js?v=131';
import { getPreview } from '../api/preview-providers.js?v=131';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=131';
import { hasUsername, findTrackId, getTrackCurrentStats, loadTopLifetime } from '../api/statsfm.js?v=131';
import { openAlbumCard } from './album-card.js?v=131';
import { openModal, closeTop } from '../ui/modal-stack.js?v=131';
import { getBestAvailableLikes } from '../api.js?v=131';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

let chart = null;

function fmtDay(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${+d} ${MESES[+m - 1]} ${y}`;
}

function fmtMonth(ym) {
  const [y, m] = ym.split('-');
  return `${MESES[+m - 1]} ${y.slice(2)}`;
}

// Rellena los meses sin plays entre el primero y el último para que la curva
// muestre los silencios (que son la mitad de la historia de un tema).
function buildSeries(monthly) {
  const keys = Object.keys(monthly).sort();
  if (!keys.length) return { labels: [], data: [] };
  const labels = [];
  const data = [];
  let [y, m] = keys[0].split('-').map(Number);
  const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    const key = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
    labels.push(key);
    data.push(monthly[key] || 0);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return { labels, data };
}

function onModalClose() {
  if (chart) { chart.destroy(); chart = null; }
}

// Cuando este modal vuelve a ser top de la pila (otro se cerró encima),
// re-medir el chart — mientras estuvo con visibility:hidden puede haber
// perdido el ancho del contenedor.
function onModalReveal() {
  if (chart) requestAnimationFrame(() => { try { chart.resize(); } catch { /* noop */ } });
}

// Listener único a nivel módulo: si el preview de la ficha dejó de sonar
// (terminó o empezó otro), el botón vuelve a "▶ Preview".
document.addEventListener('previewchange', (e) => {
  const btn = document.getElementById('tc-preview');
  if (btn && !(e.detail.key || '').startsWith('tc:') && btn.textContent !== 'Sin preview') {
    btn.textContent = '▶ Preview';
  }
});

async function openTrackCard(t) {
  // t: { id, name, artist, album?, img? } — id es el track id de Spotify (sin prefijo)
  if (!t || !t.id) return;

  const overlay = openModal({
    id: `track-card:${t.id}`,
    onClose: onModalClose,
    onReveal: onModalReveal,
    html: `
    <div class="modal" style="max-width:640px;width:min(640px,92vw)">
      <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:14px">
        <div id="tc-cover" title="Ver ficha del álbum" style="width:64px;height:64px;border-radius:8px;background:var(--color-elevated);display:flex;align-items:center;justify-content:center;font-size:26px;color:var(--color-text-muted);flex-shrink:0;overflow:hidden;cursor:pointer">
          ${t.img
            ? `<img src="${t.img}" alt="" style="width:100%;height:100%;object-fit:cover">`
            : `♪`}
        </div>
        <div style="flex:1;min-width:0">
          <h3 style="margin:0 0 2px;font-size:18px;line-height:1.25">${escapeHtml(t.name || '(sin nombre)')}</h3>
          <div style="color:var(--color-text-secondary);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${escapeHtml(t.artist || '')}${t.album ? ` · ${escapeHtml(t.album)}` : ''}
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-secondary btn-sm" id="tc-preview">▶ Preview</button>
            <a class="btn btn-secondary btn-sm" href="https://open.spotify.com/track/${t.id}" target="_blank" rel="noopener">Abrir en Spotify ↗</a>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar" style="flex-shrink:0">✕</button>
      </div>
      <div id="tc-body"><div style="text-align:center;padding:24px"><div class="spinner"></div></div></div>
    </div>
  `,
  });

  // Click en la tapa → abrir ficha del álbum ENCIMA (no cierra la de canción,
  // así la flecha ← vuelve). Si el caller no pasó `album`, lo resolvemos:
  // 1) match por id en los likes cacheados; 2) top_albums_all_time filtrado
  // por artista si hay un único álbum. Si no se logra, no rompe.
  const cover = overlay.querySelector('#tc-cover');
  if (cover) {
    cover.onclick = async () => {
      let albumName = t.album || null;
      let albumInfo = { name: albumName, artist: t.artist, img: t.img };
      try {
        const stats = await loadHistoryStats().catch(() => null);
        if (albumName) {
          const found = (stats?.top_albums_all_time || []).find(
            a => a.name === albumName && a.artist === t.artist
          );
          if (found) {
            albumInfo = { name: found.name, artist: found.artist, img: found.img || t.img, plays: found.plays, min: found.min };
          }
        } else {
          const likes = await getBestAvailableLikes().catch(() => ({ items: [] }));
          const like = (likes.items || []).find(l => l.track?.id === t.id);
          if (like?.track?.album?.name) {
            const imgs = like.track.album.images || [];
            albumName = like.track.album.name;
            albumInfo = {
              name: albumName,
              artist: t.artist,
              img: imgs[1]?.url || imgs[0]?.url || imgs[2]?.url || t.img,
            };
          }
          if (!albumName && stats?.top_albums_all_time && t.artist) {
            const cands = stats.top_albums_all_time.filter(a => a.artist === t.artist);
            if (cands.length === 1) {
              albumInfo = { name: cands[0].name, artist: cands[0].artist, img: cands[0].img, plays: cands[0].plays, min: cands[0].min };
              albumName = cands[0].name;
            }
          }
        }
      } catch { /* noop */ }
      if (albumInfo.name) openAlbumCard(albumInfo);
    };
  }

  // Si el llamador no pasó tapa (típico de tracks del Wrapped/Récords, que vienen
  // solo con {name, artist, uri}), la traemos vía oEmbed — CORS abierto, sin auth.
  if (!t.img) fillCoverFromOembed(t.id);

  const previewBtn = overlay.querySelector('#tc-preview');
  previewBtn.onclick = async () => {
    const res = await togglePreview(`tc:${t.id}`, async () => {
      return await getPreview({ name: t.name || '', artist: t.artist || '', spotifyId: t.id });
    });
    previewBtn.textContent = res === true ? '⏹ Parar' : '▶ Preview';
    if (res === null) previewBtn.textContent = 'Sin preview';
  };
  if (playingKey() === `tc:${t.id}`) previewBtn.textContent = '⏹ Parar';

  const body = overlay.querySelector('#tc-body');
  const owner = await isOwner();
  if (!owner) {
    body.innerHTML = `<p style="color:var(--color-text-secondary);font-size:13px;margin:0">La historia de reproducción es del dueño de esta instancia — solo el preview y el link están disponibles.</p>`;
    return;
  }

  const [plays, detail] = await Promise.all([loadTrackPlays(), loadTrackDetail()]);
  const totals = plays?.tracks?.[t.id] || null;   // [plays, segundos] o [p, s, "p"]
  const det = detail?.tracks?.[t.id] || null;     // { m, f, l, d, x }

  if (!totals && !det) {
    body.innerHTML = `<p style="color:var(--color-text-secondary);font-size:13px;margin:0">Este tema no aparece en tu historial (o solo tuvo plays de menos de 30s). Nunca lo escuchaste entero desde 2018.</p>
      <div id="tc-statsfm"></div>`;
    fillStatsfmLine(t);
    return;
  }

  const totalPlays = totals ? totals[0] : 0;
  const totalMin = totals ? Math.round(totals[1] / 60) : 0;
  const partial = totals && totals[2] === 'p';

  body.innerHTML = `
    <div class="tc-stats">
      <div class="tc-stat"><div class="tc-stat-v">${totalPlays.toLocaleString('es-AR')}</div><div class="tc-stat-l">${partial ? 'plays cortas (<30s)' : 'plays válidas'}</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${totalMin.toLocaleString('es-AR')}m</div><div class="tc-stat-l">minutos totales</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${det ? det.d : '—'}</div><div class="tc-stat-l">días distintos</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${det ? det.x : '—'}</div><div class="tc-stat-l">récord en un día</div></div>
    </div>
    ${det ? `
      <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--color-text-muted);margin:10px 2px 6px">
        <span>Primera vez: <strong style="color:var(--color-text)">${fmtDay(det.f)}</strong></span>
        <span>Última vez: <strong style="color:var(--color-text)">${fmtDay(det.l)}</strong></span>
      </div>
      <div class="chart-box" style="height:200px"><canvas id="tc-chart"></canvas></div>
    ` : `
      <p style="color:var(--color-text-muted);font-size:12px;margin:10px 0 0">Curva mensual disponible solo para temas con 5+ plays.</p>
    `}
    <div id="tc-statsfm"></div>
  `;

  fillStatsfmLine(t, totals ? totals[0] : 0);

  if (det) {
    const { labels, data } = buildSeries(det.m);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#7C3AED';
    // Doble rAF: dejamos que el browser haga layout del modal antes de que
    // Chart.js mida el contenedor (ver artist-card.js para el detalle).
    requestAnimationFrame(() => requestAnimationFrame(() => {
    const canvas = overlay.querySelector('#tc-chart');
    if (!canvas) return;
    chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data, backgroundColor: accent, borderRadius: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => fmtMonth(items[0].label),
              label: ctx => `${ctx.parsed.y} play${ctx.parsed.y === 1 ? '' : 's'}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#8888A0', font: { family: 'Inter', size: 10 },
              maxRotation: 0, autoSkip: true, maxTicksLimit: 10,
              callback: function (val) {
                const l = this.getLabelForValue(val);
                return l && l.endsWith('-01') ? l.slice(0, 4) : '';
              },
            },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#8888A0', font: { family: 'Inter', size: 10 }, precision: 0 },
            grid: { color: 'rgba(136,136,160,0.12)' },
          },
        },
      },
    });
    }));
  }
}

// Plays actuales según Stats.fm. Estrategia doble:
// 1) Primero busco el spotifyId en el top-1000 lifetime (cache 24h) — esos
//    conteos INCLUYEN todo lo importado y son el número real actual.
// 2) Si el tema no está en el top-1000 (menos de ~17 plays), fallback al
//    per-track live (que solo trae lo trackeado post-conexión con Spotify,
//    sin lo importado — pero al menos algo).
// Silencioso si no hay username o ningún dato útil.
async function fillStatsfmLine(t, exportPlays = null) {
  if (!hasUsername()) return;
  const holder = document.getElementById('tc-statsfm');
  if (!holder) return;
  holder.innerHTML = `<div style="font-size:12px;color:var(--color-text-muted);margin-top:10px">Consultando Stats.fm…</div>`;
  try {
    // 1) Top lifetime cacheado (fuente autoritativa)
    const top = await loadTopLifetime().catch(() => null);
    const hit = top?.map.get(t.id);
    if (hit) {
      if (!document.getElementById('tc-statsfm')) return;
      const min = Math.round(hit.playedMs / 60000);
      const delta = exportPlays != null
        ? (hit.streams > exportPlays
            ? ` <span style="color:var(--color-accent)">(+${(hit.streams - exportPlays).toLocaleString('es-AR')} desde el export)</span>`
            : (hit.streams < exportPlays ? ` <span style="color:var(--color-text-muted)">(export tenía ${exportPlays})</span>` : ''))
        : '';
      holder.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm,6px);font-size:12.5px;color:var(--color-text-secondary)">
          <strong style="color:var(--color-text)">Stats.fm hoy:</strong>
          ${hit.streams.toLocaleString('es-AR')} plays · ${min.toLocaleString('es-AR')}m${delta}
          <span style="color:var(--color-text-muted);margin-left:auto" title="Total real actual según tu Top de todos los tiempos (incluye lo importado + lo trackeado en vivo)">total actual</span>
        </div>`;
      return;
    }

    // 2) Fallback per-track (solo lo trackeado post-conexión, sin import)
    const id = await findTrackId(t.name || '', t.artist || '');
    const stats = id && await getTrackCurrentStats(id);
    if (!document.getElementById('tc-statsfm')) return;
    if (!stats || !stats.count) {
      holder.innerHTML = top
        ? `<div style="font-size:11.5px;color:var(--color-text-muted);margin-top:10px">Menos de ${top.minStreams} plays totales según Stats.fm (fuera de tu top-${top.totalItems}).</div>`
        : '';
      return;
    }
    const min = Math.round(stats.durationMs / 60000);
    holder.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm,6px);font-size:12.5px;color:var(--color-text-secondary)">
        <strong style="color:var(--color-text)">Stats.fm en vivo:</strong>
        ${stats.count.toLocaleString('es-AR')} plays · ${min.toLocaleString('es-AR')}m
        <span style="color:var(--color-text-muted);margin-left:auto" title="Solo lo trackeado desde que conectaste Stats.fm (sin lo importado del export)">solo post-conexión</span>
      </div>`;
  } catch {
    const h = document.getElementById('tc-statsfm');
    if (h) h.innerHTML = '';
  }
}

// Fallback de tapa: oEmbed de Spotify devuelve thumbnail_url sin auth y CORS
// abierto (ver CLAUDE.md). Async y silencioso — si falla, queda el ♪.
async function fillCoverFromOembed(id) {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=spotify:track:${id}`);
    if (!res.ok) return;
    const data = await res.json();
    const url = data.thumbnail_url;
    const cover = document.getElementById('tc-cover');
    if (!url || !cover) return;
    cover.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">`;
  } catch { /* silencioso */ }
}

export { openTrackCard };
