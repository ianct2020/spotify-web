// Ficha de canción: modal con la historia completa de un track según el
// Extended Streaming History — curva de plays por mes, primera/última vez,
// días distintos, récord en un día — más preview iTunes y link a Spotify.
// Se abre desde cualquier feature con openTrackCard({ id, name, artist, album, img }).

import { loadTrackPlays, loadTrackDetail, isOwner } from './history-data.js?v=95';
import { escapeHtml } from '../ui/components.js?v=95';
import { findTrackPreview } from '../api/itunes.js?v=95';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=95';
import { hasUsername, findTrackId, getTrackCurrentStats } from '../api/statsfm.js?v=95';

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

function close() {
  if (chart) { chart.destroy(); chart = null; }
  document.getElementById('track-card-overlay')?.remove();
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
  close();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'track-card-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:640px;width:min(640px,92vw)">
      <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:14px">
        ${t.img
          ? `<img src="${t.img}" alt="" style="width:64px;height:64px;border-radius:8px;object-fit:cover;flex-shrink:0">`
          : `<div style="width:64px;height:64px;border-radius:8px;background:var(--color-elevated);display:flex;align-items:center;justify-content:center;font-size:26px;color:var(--color-text-muted);flex-shrink:0">♪</div>`}
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
        <button class="btn btn-secondary btn-sm" id="tc-close" title="Cerrar" style="flex-shrink:0">✕</button>
      </div>
      <div id="tc-body"><div style="text-align:center;padding:24px"><div class="spinner"></div></div></div>
    </div>
  `;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.body.appendChild(overlay);
  overlay.querySelector('#tc-close').onclick = close;

  const previewBtn = overlay.querySelector('#tc-preview');
  previewBtn.onclick = async () => {
    const res = await togglePreview(`tc:${t.id}`, async () => {
      const p = await findTrackPreview(t.artist || '', t.name || '');
      return p && { url: p.url, label: `${t.name} — ${t.artist || ''}` };
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
    chart = new Chart(document.getElementById('tc-chart'), {
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
  }
}

// Plays actuales según Stats.fm (que sigue trackeando después del export).
// Async y silencioso: si no hay username configurado o no encuentra el tema,
// no muestra nada. Funciona sin Plus.
async function fillStatsfmLine(t, exportPlays = null) {
  if (!hasUsername()) return;
  const holder = document.getElementById('tc-statsfm');
  if (!holder) return;
  holder.innerHTML = `<div style="font-size:12px;color:var(--color-text-muted);margin-top:10px">Consultando Stats.fm…</div>`;
  try {
    const id = await findTrackId(t.name || '', t.artist || '');
    const stats = id && await getTrackCurrentStats(id);
    if (!document.getElementById('tc-statsfm')) return; // cerraron la ficha
    // count 0 = Stats.fm no trackeó ese tema (o es otra versión): mejor no mostrar nada
    if (!stats || !stats.count) { holder.innerHTML = ''; return; }
    const min = Math.round(stats.durationMs / 60000);
    const delta = exportPlays != null && stats.count > exportPlays
      ? ` <span style="color:var(--color-accent)">(+${stats.count - exportPlays} desde el export)</span>`
      : '';
    holder.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm,6px);font-size:12.5px;color:var(--color-text-secondary)">
        <strong style="color:var(--color-text)">Stats.fm en vivo:</strong>
        ${stats.count.toLocaleString('es-AR')} plays · ${min.toLocaleString('es-AR')}m${delta}
        <span style="color:var(--color-text-muted);margin-left:auto" title="Stats.fm sigue trackeando tu Spotify después del export congelado">actualizado hoy</span>
      </div>`;
  } catch {
    const h = document.getElementById('tc-statsfm');
    if (h) h.innerHTML = '';
  }
}

export { openTrackCard };
