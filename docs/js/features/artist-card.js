// Ficha de artista: modal simétrico al de canción — minutos totales, plays,
// primer/último año, top tracks del artista, hover-play, y plays actuales
// vía Stats.fm si aplica. Se abre desde cualquier feature con openArtistCard({ name }).

import { loadHistoryStats, loadArtistTracks, isOwner } from './history-data.js?v=180';
import { escapeHtml } from '../ui/components.js?v=180';
import { getPreview } from '../api/preview-providers.js?v=180';
import { togglePreview, playingKey, attachHover } from '../ui/preview-player.js?v=180';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js?v=180';
import { openTrackCard } from './track-card.js?v=180';
import { spotifyFetch, getBestAvailableLikes } from '../api.js?v=180';
import { openModal, closeTop } from '../ui/modal-stack.js?v=180';
import { firstArtistName, artistNames, resolveArtistName, looksLikeArtistChain } from '../util/artist-name.js?v=180';
import { coverUrl } from '../util/cover-size.js?v=180';
import { getArtistLikePreview } from '../util/artist-preview.js?v=180';
import { skelCardBody, skelTrackRows, skelBox } from '../ui/skeleton.js?v=180';
import { fmtDia, fmtDiaCorto } from '../util/fecha.js?v=180';
import { albumsDeArtista } from '../util/artist-albums.js?v=180';
import { openAlbumCard } from './album-card.js?v=180';

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
    const img = coverUrl(pick?.images, 'grande');
    cache[key] = { u: img, t: Date.now() };
    saveImgCache(cache);
    return img;
  } catch {
    return null;
  }
}

let chart = null;

// El índice está keyeado por el nombre exacto que trae el historial. La ficha
// casi siempre llega con ese mismo nombre, pero si viene de otra fuente (likes,
// Stats.fm) puede diferir en mayúsculas. Índice lowercase perezoso, una vez.
let _artistCI = null;
function resolveArtistKey(artistTracks, name) {
  if (!artistTracks?.artists || !name) return null;
  if (_artistCI?.src !== artistTracks) {
    const map = new Map();
    for (const k of Object.keys(artistTracks.artists)) map.set(k.toLowerCase(), k);
    _artistCI = { src: artistTracks, map };
  }
  return _artistCI.map.get(name.toLowerCase()) || null;
}

// ── Índice de artistas conocidos (v=150) ────────────────────────────────────
//
// Lo usa la guarda de `util/artist-name.js` para decidir si «Tyler, The
// Creator» es UN artista o dos pegados. Se llena solo, sin pedir nada: se
// alimenta del índice del historial en cuanto alguien lo carga (que es lo
// primero que hace cualquier ficha de artista). Mientras esté vacío la guarda
// se queda con el primer segmento, que es el comportamiento seguro.
//
// Es sincrónico A PROPÓSITO: `openTrackCard` lo consulta al pintar la cabecera,
// antes de cualquier await, y no puede quedarse esperando un JSON de 1,3 MB.
const _conocidos = new Set();

export function knownArtist(name) {
  return !!name && _conocidos.has(String(name).toLowerCase());
}

function sembrarConocidos(artistTracks) {
  if (!artistTracks?.artists) return;
  for (const k of Object.keys(artistTracks.artists)) _conocidos.add(k.toLowerCase());
}

// ⚠️ NO se siembra al importar el módulo. `loadArtistTracks()` baja un JSON de
// 1,3 MB y este módulo lo importa media app, así que hacerlo en el nivel
// superior le costaría esa descarga a CUALQUIER ruta, incluida Home y los
// usuarios que no son el dueño del historial. Se siembra donde ya se carga por
// otro motivo (abajo, en openArtistCard) y, si hace falta antes, la guarda lo
// pide ella misma.

function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  // Redondear PRIMERO y después partir en h/m. Al revés, 419,6 min daba
  // "6h 60m" (floor 6 + round(59,6) = 60) en vez de "7h 0m".
  const total = Math.round(min);
  if (total >= 60) return `${Math.floor(total / 60).toLocaleString('es-AR')}h ${total % 60}m`;
  return `${total}m`;
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

async function openArtistCard(entrada) {
  // entrada: { name } o { artists: [...] } — todo lo demás sale del historial.
  if (!entrada) return;

  // ── La guarda de la puerta (v=150) ──
  //
  // Hasta v=149 esto aceptaba cualquier string como nombre de artista, y la
  // ficha de álbum le pasaba la CADENA DE ARTISTAS UNIDA del track. Como el
  // historial se cruza por igualdad exacta de nombre, la ficha de «A$AP Rocky,
  // Imogen Heap, Clams Casino» salía con «No aparece en tu historial», gráfico
  // vacío y «0 likes» — para el segundo artista más escuchado de Ian.
  //
  // El origen se arregló abajo (openArtistLikesModal ya no une la lista), pero
  // la normalización vive acá para que ningún llamador futuro pueda volver a
  // meterla. Si el nombre entero es un artista conocido se respeta tal cual:
  // es lo que salva a «Tyler, The Creator».
  const desdeLista = (entrada.artists || []).map(firstArtistName).filter(Boolean)[0];
  const crudo = desdeLista || firstArtistName(entrada.name);
  if (!crudo) return;

  // Solo cuando huele a cadena esperamos el índice. En el camino normal (un
  // nombre sin comas) esto no agrega ni un tick: la ficha abre igual de rápido.
  if (looksLikeArtistChain(crudo) && !knownArtist(crudo)) {
    await loadArtistTracks().then(sembrarConocidos).catch(() => { /* seguimos sin índice */ });
  }

  const nombre = resolveArtistName(crudo, knownArtist);
  if (nombre !== crudo) {
    console.warn(`[artist-card] llegó una cadena de artistas («${crudo}»); abro «${nombre}»`);
  }
  const a = { ...entrada, name: nombre };

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
    <div class="modal card-modal ac-modal" style="max-width:820px;width:min(820px,94vw)">
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
      <div class="ac-body-scroll" id="ac-body">${skelCardBody({ tiles: 4, lines: 0 })}${skelBox({ w: '100%', h: 150, radius: 10, mb: 18 })}${skelTrackRows(6)}</div>
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
      return await getArtistLikePreview(a.name);
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
  // Día exacto de la primera play válida (v=157). Sale del 6º campo de
  // `totals` de history-artist-tracks v2; con un JSON viejo queda null y el
  // tile vuelve a mostrar el año a secas.
  let firstDay = null;
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

  // FUENTE PRINCIPAL (v=126): índice del historial COMPLETO por artista.
  //
  // Antes esto salía de la unión de los top_tracks anuales (top 40 por año) y,
  // como relleno, de top_tracks_all_time (top 60 global). Los dos son tops
  // recortados: un artista chico no entra en ninguno. "prettifun", con 89 plays
  // y 3h 34m, mostraba UN solo track ("Light") porque era el único que se había
  // colado en un top anual. history-artist-tracks.json indexa todo artista con
  // al menos una play válida, así que acá ya vienen los 6 reales.
  const artistTracks = await loadArtistTracks();
  // Acá ya está pago: aprovechamos para sembrar el índice de nombres conocidos
  // que usa la guarda de la cadena de artistas.
  sembrarConocidos(artistTracks);
  const histKey = artistTracks?.artists?.[a.name] ? a.name : resolveArtistKey(artistTracks, a.name);
  const fromHistory = histKey ? artistTracks.artists[histKey] : null;

  // Totales del índice: mandan sobre los tops, que recortan a 40/60 artistas.
  const histTotals = histKey ? artistTracks.totals?.[histKey] : null;
  if (histTotals) {
    const [hPlays, hMin, hFirst, hLast, hCurve, hFirstDay] = histTotals;
    totalPlays = hPlays || totalPlays;
    totalMin = hMin || totalMin;
    firstYear = hFirst || firstYear;
    lastYear = hLast || lastYear;
    firstDay = hFirstDay || firstDay;
    // La curva del índice cubre TODOS los años del artista. La que se armó
    // arriba con los tops anuales se queda en cero para cualquiera que no
    // entre en el top 40 de su año, y dejaba la ficha sin gráfico.
    if (hCurve?.length) {
      const byYear = new Map(hCurve.map(([yy, mm, pp]) => [yy, { min: mm, plays: pp }]));
      yearsWithArtist.length = 0;
      for (const y of stats.years) {
        const hit = byYear.get(y.year);
        yearsWithArtist.push({ year: y.year, min: hit?.min || 0, plays: hit?.plays || 0 });
      }
    }
  }

  if (fromHistory?.length) {
    trackAcum.clear();
    for (const [name, plays, min, id] of fromHistory) {
      trackAcum.set(name, { name, min: min || 0, plays: plays || 0, uri: id ? `spotify:track:${id}` : null });
    }
  } else {
    // Fallback 1: top_tracks_all_time (top 60 global). Solo sirve para artistas
    // grandes, pero es lo único disponible si no hay índice por artista.
    for (const t of (stats.top_tracks_all_time || [])) {
      if (t.artist !== a.name) continue;
      if (trackAcum.has(t.name)) continue;
      trackAcum.set(t.name, { name: t.name, min: t.min || 0, plays: t.plays || 0, uri: t.uri });
    }
  }
  const topTracks = [...trackAcum.values()].sort((a, b) => b.plays - a.plays).slice(0, 5);

  // El corte por "no está en ningún top" se hace DESPUÉS de mirar el historial
  // completo: un artista puede no entrar en ningún top y aun así tener plays.
  if (!totalPlays && !allTime && !topTracks.length) {
    body.innerHTML = `<p style="color:var(--color-text-secondary);font-size:13px;margin:0">No aparece en tu historial (o no está en los tops de ningún año). Igual podés escucharlo en Spotify y ver el preview arriba.</p>`;
    return;
  }

  const hasChart = yearsWithArtist.some(y => y.min > 0);
  body.innerHTML = `
    <div class="ac-layout">
    <div class="ac-main">
    <div class="tc-stats ac-stats">
      <div class="tc-stat"><div class="tc-stat-v">${fmtMinutes(totalMin)}</div><div class="tc-stat-l">minutos totales</div></div>
      <div class="tc-stat"><div class="tc-stat-v">${totalPlays.toLocaleString('es-AR')}</div><div class="tc-stat-l">plays</div></div>
      <div class="tc-stat" title="${firstDay ? 'El primer día que lo escuchaste al menos 30 segundos' : ''}"><div class="tc-stat-v${firstDay ? ' tc-stat-v-fecha' : ''}">${firstDay ? escapeHtml(fmtDia(firstDay)) : (firstYear || '—')}</div><div class="tc-stat-l">${firstDay ? 'primera vez' : 'primer año'}</div></div>
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
    </div>
    <aside class="ac-albums" id="ac-albums" hidden>
      <div class="ac-albums-inner">
        <div class="ac-col-title ac-albums-title">Sus álbumes</div>
        <div class="ac-albums-scroll" id="ac-albums-scroll"></div>
      </div>
    </aside>
    </div>
  `;

  // Columna de álbumes escuchados (v=157). Va después del innerHTML y sin
  // await: la ficha ya está pintada y esto solo rellena la columna, que nace
  // `hidden` para no dejar un hueco si el artista no tiene ninguno.
  fillAlbumes(overlay, a.name);

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

// ── Columna de álbumes del artista (v=157) ──────────────────────────────────
//
// Un carrusel VERTICAL angosto al costado, del ancho de una tapa. Tiene su
// propio scroll y NO estira el modal: la columna es `position:absolute` dentro
// de su celda del grid, así que la altura la fija el contenido de la izquierda
// (stats + chart + top tracks) y la lista scrollea adentro de eso. Si en cambio
// creciera con sus 40 tapas, el modal se iría a 85vh siempre y quedaría
// desparejo, que es justo lo que había que evitar.
//
// Debajo de 900px el CSS lo pasa a horizontal (misma lista, scroll en x).
async function fillAlbumes(overlay, nombre) {
  const aside = overlay.querySelector('#ac-albums');
  const holder = overlay.querySelector('#ac-albums-scroll');
  if (!aside || !holder) return;
  let albums = [];
  try {
    albums = await albumsDeArtista(nombre);
  } catch (e) {
    console.warn('[artist-card] álbumes:', e.message);
    return;
  }
  if (!albums.length) return;

  aside.hidden = false;
  aside.querySelector('.ac-albums-title').textContent = `Sus álbumes (${albums.length})`;
  holder.innerHTML = albums.map((al, i) => `
    <button type="button" class="ac-album" data-i="${i}" title="${escapeHtml(al.name)} — ${al.plays.toLocaleString('es-ES')} plays">
      ${al.img
        ? `<img class="ac-album-cover" src="${escapeHtml(al.img)}" alt="" loading="lazy">`
        : `<div class="ac-album-cover ac-album-cover-empty">♪</div>`}
      <div class="ac-album-name">${escapeHtml(al.name)}</div>
      <div class="ac-album-meta">${al.plays.toLocaleString('es-ES')} plays</div>
    </button>
  `).join('');

  holder.querySelectorAll('.ac-album').forEach(el => {
    el.onclick = () => {
      const al = albums[+el.dataset.i];
      if (al) openAlbumCard({ name: al.name, artist: al.artist, img: al.img, plays: al.plays, min: al.min });
    };
  });
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
          ${skelTrackRows(8)}
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
        // `.pick-cover` mide 44 px: la chica alcanza y sobra.
        const img = coverUrl(t.album?.images, 'chica') || '';
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
            <div style="font-size:11px;color:var(--color-text-muted);flex-shrink:0;text-align:right">${escapeHtml(fmtDiaCorto(it.added_at))}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  scroll.querySelectorAll('.al-row').forEach(row => {
    const idx = +row.dataset.i;
    const it = filtered[idx];
    const t = it.track;
    // ⚠️ Acá nacía la cadena unida (v=150). `artist: […].join(', ')` metía
    // «A$AP Rocky, Imogen Heap, Clams Casino» en la ficha de canción, de ahí
    // pasaba a la de álbum y de ahí a `openArtistCard`, que cruza el historial
    // por igualdad exacta de nombre. Ahora va la LISTA, que es lo que la ficha
    // sabe pintar como enlaces separados.
    const img = coverUrl(t.album?.images, 'grande') || '';
    row.onclick = () => openTrackCard({
      id: t.id,
      name: t.name,
      artists: artistNames(t),
      album: t.album?.name,
      img,
    });
    attachHover(row, `al-hover:${t.id}`, async () => {
      return await getPreview({
        name: t.name || '',
        artists: artistNames(t),
        artist: artistName,
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
    return await getArtistLikePreview(name);
  });
}

export { openArtistCard, attachArtistCard };
