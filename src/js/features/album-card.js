// Ficha de álbum: modal chico con tapa, nombre, artista, plays/min totales,
// y botones para saltar a la ficha del artista o abrir el álbum en Spotify.
// Se dispara desde openAlbumCard({ name, artist, plays, min, img }).

import { escapeHtml } from '../ui/components.js';
import { openArtistCard } from './artist-card.js';

function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) return `${Math.floor(min / 60).toLocaleString('es-AR')}h ${Math.round(min % 60)}m`;
  return `${Math.round(min)}m`;
}

function close() {
  document.getElementById('album-card-overlay')?.remove();
}

export function openAlbumCard(a) {
  if (!a || !a.name) return;
  close();

  const spotifyQuery = encodeURIComponent(`${a.name} ${a.artist || ''}`.trim());
  const spotifyUrl = `https://open.spotify.com/search/${spotifyQuery}`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'album-card-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:460px;width:min(460px,92vw);padding:22px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:8px">
        <div style="font-size:11px;color:var(--color-text-muted);letter-spacing:0.06em;text-transform:uppercase">Ficha de álbum</div>
        <button class="btn btn-ghost btn-sm" id="alb-close" style="padding:4px 10px">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px">
        ${a.img
          ? `<img src="${a.img}" alt="" style="width:180px;height:180px;max-width:60vw;max-height:60vw;border-radius:8px;object-fit:cover;box-shadow:0 6px 20px rgba(0,0,0,0.45)">`
          : `<div style="width:180px;height:180px;max-width:60vw;max-height:60vw;border-radius:8px;background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:44px">♪</div>`
        }
        <div style="font-size:19px;font-weight:700;line-height:1.2;color:var(--color-text);word-break:break-word">${escapeHtml(a.name)}</div>
        <button class="alb-artist-link" id="alb-artist" style="background:none;border:none;color:var(--color-accent);font-size:14px;cursor:pointer;padding:0;text-align:center">${escapeHtml(a.artist || '')}</button>
      </div>
      <div class="tc-stats" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px">
        <div style="background:var(--color-elevated);border:1px solid var(--color-border);border-radius:8px;padding:10px 12px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:var(--color-accent);font-variant-numeric:tabular-nums">${fmtMinutes(a.min)}</div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:2px">tiempo escuchado</div>
        </div>
        <div style="background:var(--color-elevated);border:1px solid var(--color-border);border-radius:8px;padding:10px 12px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:var(--color-accent);font-variant-numeric:tabular-nums">${(a.plays || 0).toLocaleString('es-AR')}</div>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:2px">plays</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="alb-go-artist" style="flex:1;min-width:140px">Ver ficha del artista</button>
        <a class="btn btn-secondary btn-sm" id="alb-spotify" href="${spotifyUrl}" target="_blank" rel="noopener" style="flex:1;min-width:140px;text-align:center">Buscar en Spotify</a>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.getElementById('alb-close').onclick = close;
  document.getElementById('alb-artist').onclick = () => {
    close();
    if (a.artist) openArtistCard({ name: a.artist });
  };
  document.getElementById('alb-go-artist').onclick = () => {
    close();
    if (a.artist) openArtistCard({ name: a.artist });
  };
}

// Cierre con ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('album-card-overlay')) close();
});
