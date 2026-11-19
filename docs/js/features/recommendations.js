import { spotifyFetch, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache, getAllLikedTracks, getCurrentUserId } from '../api.js?v=371';
import { hasKey, setKey, hasUsername, getUsername, setUsername, getUserTopArtists, getSimilarArtists, getArtistTopTracks, getKey, pedirLastfmCrudo, cargarEtiquetas, registroEtiquetas, setCachedTags } from '../api/lastfm.js?v=371';
import { urlEtiquetas } from '../util/generos-escaneo.js?v=371';
import { resolverTemaEnSpotify } from '../util/resolver-tema.js?v=371';
import {
  pedirEtiquetas, pendientesDeEtiquetas, agruparPorEstilo, textoSinEstilo, ARTISTAS_POR_ESTILO, TEXTO_SIN_ESTILOS, planDeLista, textoCoste, TITULO_COSTE,
  armarLista, textoCabecera, textoCorte, textoSinBuscar, nombreSugerido, descripcionPlaylist,
  TEMAS_MIN, TEMAS_MAX, TEMAS_DEFECTO,
} from '../util/recs-estilo.js?v=371';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml, pageHeader } from '../ui/components.js?v=371';
import { showToast } from '../ui/toast.js?v=371';
import { getPreview } from '../api/preview-providers.js?v=371';
import { togglePreview, playingKey, isPlayingAudio } from '../ui/preview-player.js?v=371';
import { paintPlayingCard } from '../ui/track-card-row.js?v=371';
import { openTrackCard } from './track-card.js?v=371';
import { openAlbumCard } from './album-card.js?v=371';
import { limpiaParaQuery, titleMatches, artistMatches } from '../util/track-match.js?v=371';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=371';
import { recuperarUriDeArtistaKey } from '../util/hidden-recover.js?v=371';
import {
  artistasOcultos as hiddenArtists,
  alternarArtistaOculto,
  artistaEstaOculto,
} from './artistas-ocultos.js?v=371';
import { iconoPlay, iconoPausa, iconoFicha, iconoDisco, iconoOjo, iconoOjoTachado } from '../ui/icons.js?v=371';
import { pedirYCachear, CUALQUIER_RESPUESTA } from '../util/cache-solo-exitos.js?v=371';

// Iconos de las dos fichas. Los mismos trazos que usa la tarjeta compartida.
// Mismos trazos que el ojo de discover-common.js (v=165), acá con 14px para
// que entre en el botón redondo `.sc-hide` de las tarjetas de esta vista.

// El almacén de artistas ocultos se MUDÓ a `features/artistas-ocultos.js` en
// v=276, sin cambiarle el `lsKey` ni el `playlistName`: desde ahí lo comparten
// esta vista, `#similar`, `#discover-artists` y `#follow-artists`, que son el
// mismo gesto («este artista no me interesa») en cuatro sitios. Acá se importa
// con el nombre de siempre para no reescribir el resto del archivo.

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
  // ⚠️ Un fallo NO se memoiza (v=256). Hasta v=255 el `catch` hacía
  // `artistUriMemo.set(k, null)`, así que un 429 o un corte de red dejaba a ese
  // artista sin uri para TODA la sesión: ocultarlo lo dejaba solo en este
  // navegador y `util/hidden-sync.js` lo anotaba como huérfano — justo lo que
  // la doc del 27/09 (B2) clasifica como **transitorio**, o sea lo contrario de
  // congelarlo.
  //
  // Un `null` que sí se memoiza es el de una pasada LIMPIA: Spotify contestó,
  // trajo candidatos y ninguno acredita a este artista como `artists[0]`. Eso
  // es «pregunté y no hay», es un resultado, y no repetirlo ahorra 5 búsquedas
  // por artista. Es el mismo criterio de `resolverPistaRepresentativa`
  // (`discover-common.js:796`, v=228) y la misma frontera que dicta B2: lo que
  // descalifica es la acreditación del artista, no la red.
  return await pedirYCachear({
    pedir: () => buscarUriRepresentativa(artist, k),
    esResultado: CUALQUIER_RESPUESTA,
    guardar: uri => artistUriMemo.set(k, uri),
    alFallar: e => console.warn(`[recs] no pude resolver una pista representativa de "${artist.name}":`, e.message),
  });
}

// La búsqueda sola, y TIRA si la red falla: es lo que le deja a
// `pedirYCachear` distinguir «fallé al preguntar» de «pregunté y no hay».
async function buscarUriRepresentativa(artist, k) {
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
    if (hit) return hit.uri;
  }
  return null;
}

/**
 * Ocultar/mostrar desde esta vista.
 *
 * La decisión de ocultar es de `alternarArtistaOculto` (una sola definición en
 * toda la app, `features/artistas-ocultos.js`). Lo único que aporta esta vista
 * es la uri representativa que ya tiene a mano: si el usuario entró a este
 * artista, su primer match resuelto sirve y no hay que buscar nada.
 *
 * @returns {Promise<boolean>} true si quedó oculto
 */
async function toggleHiddenArtist(artist) {
  let uriSugerida = null;
  try { uriSugerida = await representativeArtistUri(artist); } catch { /* sin uri: la compartida la busca, y si no hay el store avisa */ }
  return alternarArtistaOculto(artist, { uriSugerida });
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

    let likes;
    try {
      likes = await getAllLikedTracks(() => {});
    } catch (e) {
      console.warn('[recs] no pude leer tus me gusta:', e);
      if (!ruta.vigente()) return;
      panel.innerHTML = '<div class="card"><p style="color: var(--color-text-secondary)">No se han podido leer tus me gusta. No se han calculado recomendaciones.</p></div>';
      return;
    }
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
    // Orden: por cantidad de matches (sources.length), que es lo que la
    // tarjeta muestra y lo que Ian mira. A igualdad de matches, desempata el
    // `score` (afinidad de Last.fm ponderada por plays del artista fuente) —
    // ya estaba calculado, así que el desempate no es arbitrario: es la
    // fuerza real de esos mismos matches.
    recommendations = [...scoreMap.values()].sort((a, b) => b.sources.length - a.sources.length || b.score - a.score);

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
    ? recommendations.filter(a => artistaEstaOculto(a.name))
    : recommendations.filter(a => !artistaEstaOculto(a.name));
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
      ${viewMode === 'normal' && shown.length >= 2
        ? `<div class="recs-estilo-cabecera-botones"><button class="btn btn-secondary btn-sm" id="recs-estilo-btn" title="Agrupa estos ${shown.length} artistas por estilo según Last.fm, para armar una playlist de un estilo. Solo se piden las etiquetas que no están guardadas en este navegador.">Agrupar por estilo</button>${hiddenToggleBtn}</div>`
        : hiddenToggleBtn}
    </div>
    <div class="smart-grid smart-grid-compact">
      ${shown.map((a, i) => renderArtistCard(a, i)).join('')}
    </div>
  `;
  panel.querySelectorAll('.art-card-pick').forEach(el => {
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
  // Los MISMOS que la vista enseña (los primeros 50 no ocultos, en su orden).
  const estiloBtn = document.getElementById('recs-estilo-btn');
  if (estiloBtn) estiloBtn.onclick = () => agruparPorEstiloDe(shown.map(a => a.name));
}

function renderArtistCard(a, i) {
  const hidden = artistaEstaOculto(a.name);
  return `
    <div class="smart-card art-card-pick-wrap">
      <button type="button" class="art-card-pick" data-idx="${i}" title="Ver top tracks">
        <div class="smart-card-title" style="font-size:15px">${escapeHtml(a.name)}</div>
      </button>
      <div class="art-card-footer">
        <span class="smart-card-meta">${a.sources.length} match${a.sources.length > 1 ? 'es' : ''}</span>
        <button type="button" class="sc-btn sc-hide recs-artist-hide" data-idx="${i}"
                title="${hidden ? 'Devolver a la lista' : 'No te interesa: ocultar (no vuelve a aparecer)'}"
                aria-label="${hidden ? 'Devolver a la lista' : 'Ocultar'}">${hidden ? iconoOjo(14) : iconoOjoTachado(14)}</button>
      </div>
    </div>
  `;
}

async function pickArtist(artist) {
  const ruta = vigilarRuta();
  currentPick = artist;
  resolvedTracks = [];
  pickedUris.clear();

  const panel = document.getElementById('recs-panel');
  const yaOculto = artistaEstaOculto(artist.name);
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
    // v=369: la búsqueda y la verificación viven en `util/resolver-tema.js` (la comparte el camino
    // de un estilo). Este camino se queda como estaba: ⚠️ un ERROR (un 429, un corte) se sigue
    // pintando como «sin match», que se lee como «Spotify no lo tiene». Es un defecto conocido,
    // anotado en `PENDIENTES.md` («Tanda 132»), y se dejó así a propósito: arreglarlo es otra tanda.
    const r = await resolverTemaEnSpotify(t);
    raw.push(r.estado === 'encontrado' ? r.fila : { uri: null, name: t.name, artist: t.artist, matched: false });
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
                aria-label="${pausa ? 'Parar preview' : 'Preview'}">${pausa ? iconoPausa(14) : iconoPlay(14)}</button>
        <button type="button" class="sc-btn" data-accion="ficha" title="Ver la ficha del tema" aria-label="Ficha del tema">${iconoFicha(14)}</button>
        ${t.album ? `<button type="button" class="sc-btn" data-accion="album" title="Ver la ficha del álbum" aria-label="Ficha del álbum">${iconoDisco(14)}</button>` : ''}
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

    ${barraSeleccionHtml()}

    <div class="card">
      <div class="tracks-grid">
        ${resolvedTracks.map(filaHtml).join('')}
      </div>
    </div>
  `;

  accionesDeFila(tracksEl);
  cablearSeleccion(tracksEl, createPlaylistFromPicks);
}

// v=369: la barra de «N tracks seleccionados» y su cableado, sacados de `renderResolvedTracks` SIN
// cambiarlos, para que la lista de un estilo use los mismos.
function barraSeleccionHtml() {
  return `
    <div style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
      <div style="font-size:13px;color:var(--color-text-secondary)">
        <strong id="recs-picked-count">${pickedUris.size}</strong> tracks seleccionados
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="recs-clear-btn">Deseleccionar todo</button>
        <button class="btn btn-primary" id="recs-create-btn">Crear playlist</button>
      </div>
    </div>`;
}

function cablearSeleccion(tracksEl, crear) {
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
  document.getElementById('recs-create-btn').onclick = crear;
}

function createPlaylistFromPicks() {
  return crearPlaylistDeSeleccion(`Discover: ${currentPick.name}`, `Recomendado desde tus scrobbles`);
}

// v=369: el cuerpo de siempre de `createPlaylistFromPicks`, compartido con la lista de un estilo
// (que sugiere «Recomendados: <estilo>» y lo dice en la descripción). Solo con el botón y con el
// nombre confirmado en el modal. ⚠️ La playlist sale PÚBLICA aunque se pida `false`: la API ignora
// `public` (sección «Crear playlists privadas — NO SE PUEDE» de `CLAUDE.md`).
async function crearPlaylistDeSeleccion(suggested, descripcion) {
  if (pickedUris.size === 0) {
    showToast('No seleccionaste nada', 'error');
    return;
  }
  const uris = [...pickedUris];
  const name = await promptPlaylistName(suggested, { trackCount: uris.length });
  if (!name) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, descripcion, false);
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

// ── Playlists por estilo (v=369, tanda 132) ──────────────────────────────────
//
// «Agrupar por estilo» → las etiquetas de los recomendados a la vista (solo las que no están
// buscadas, de a una por segundo, en el almacén de `#generos`) → los estilos de 2 o más artistas →
// un estilo → «Armar la lista» (hasta 6 artistas × 10-15 temas) → «Crear playlist». La lógica es
// `util/recs-estilo.js` (puro); acá solo se pinta y se enchufa lo de verdad. Abrir `#recs` y
// «Generar recomendaciones» no cambiaron de costo: nada de esto corre sin su botón.

// La última agrupación: los nombres a la vista, los que Last.fm no contestó, si se paró, el estilo
// elegido y los temas por artista. «Volver a los estilos» repinta con esto: 0 peticiones.
let estiloCtx = null;

const relojReal = { ahora: () => Date.now(), esperar: (ms) => sleep(ms) };

function pintarFalloEstilo(texto, error = null) {
  const panel = document.getElementById('recs-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="card recs-estilo" data-recs-estilo="fallo">
      <p class="recs-estilo-nota">${escapeHtml(texto)}</p>
      ${error ? `<p class="recs-estilo-crudo">${escapeHtml(String(error?.message || error))}</p>` : ''}
      <button class="btn btn-secondary btn-sm" id="recs-estilo-volver">← Volver</button>
    </div>`;
  document.getElementById('recs-estilo-volver').onclick = () => renderRecommendations();
}

function pintarProgresoEtiquetas(hechos, total) {
  const relleno = document.getElementById('recs-estilo-relleno');
  const txt = document.getElementById('recs-estilo-progreso');
  if (relleno) relleno.style.width = total ? `${(hechos / total) * 100}%` : '100%';
  if (txt) {
    txt.textContent = total
      ? `${hechos} de ${total} artistas preguntados a Last.fm (uno por segundo).`
      : 'Todo estaba guardado: no hace falta preguntar nada.';
  }
}

async function agruparPorEstiloDe(nombres) {
  const ruta = vigilarRuta();
  const panel = document.getElementById('recs-panel');
  if (!panel) return;
  const parar = { pedido: false };
  panel.innerHTML = `
    <div class="card recs-estilo" data-recs-estilo="etiquetas">
      <div class="recs-estilo-fila">
        <div class="recs-estilo-titulo">Preguntando a Last.fm el estilo de tus recomendados…</div>
        <button class="btn btn-secondary btn-sm" id="recs-estilo-parar">Parar</button>
      </div>
      <div class="recs-estilo-barra"><div class="recs-estilo-barra-relleno" id="recs-estilo-relleno"></div></div>
      <div class="recs-estilo-nota" id="recs-estilo-progreso">Leyendo lo que ya está guardado…</div>
    </div>`;
  document.getElementById('recs-estilo-parar').onclick = (e) => {
    parar.pedido = true;
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Parando…';
  };

  // Lo ya guardado no se vuelve a pedir: el almacén de `#generos`, cargado una vez por usuario
  // (el `/me` va por el memo: si nadie lo pagó en esta carga, este es el único).
  try {
    const uid = await getCurrentUserId();
    if (!ruta.vigente()) return;
    await cargarEtiquetas(uid);
  } catch (e) {
    console.warn('[recs] no se pudieron leer las etiquetas guardadas:', e);
    if (!ruta.vigente()) return;
    pintarFalloEstilo('No se han podido leer las etiquetas de género que ya están guardadas en este navegador, así que no se ha agrupado nada (se volvería a pedir lo que ya está). Recarga la página para volver a intentarlo.', e);
    return;
  }
  if (!ruta.vigente()) return;
  pintarProgresoEtiquetas(0, pendientesDeEtiquetas(nombres, registroEtiquetas).length);

  const key = getKey();
  const r = await pedirEtiquetas({
    nombres,
    registro: registroEtiquetas,
    pedir: (n) => pedirLastfmCrudo(urlEtiquetas(n, key)),
    guardar: (n, tags, artista) => setCachedTags(n, tags, 'lastfm', artista === undefined ? null : { artista }),
    reloj: relojReal,
    seguir: () => ruta.vigente() && !parar.pedido,
    onPaso: ({ hechos, total }) => { if (ruta.vigente()) pintarProgresoEtiquetas(hechos, total); },
  });
  if (r.noContesto.length) {
    console.warn('[recs] Last.fm no contestó por estos artistas (no se guarda nada de ellos):',
      r.noContesto.map(x => `${x.nombre} (${x.codigo ?? x.status})`).join(' · '));
  }
  if (!ruta.vigente()) return;
  if (r.motivo === 'key') {
    pintarFalloEstilo(`Last.fm no acepta la clave de la API (error ${r.codigo}), así que se ha parado. Lo que ya había contestado se ha guardado.`);
    return;
  }
  if (r.motivo === 'no-guarda') {
    pintarFalloEstilo('No se ha podido guardar lo que contestó Last.fm en este navegador, así que se ha parado para no pedir de más.');
    return;
  }
  estiloCtx = {
    nombres,
    noContesto: new Set(r.noContesto.map(x => x.nombre)),
    parado: r.motivo === 'parado',
    estilos: [],
    estilo: null,
    temas: TEMAS_DEFECTO,
  };
  renderEstilos();
}

function renderEstilos() {
  const panel = document.getElementById('recs-panel');
  if (!panel || !estiloCtx) return;
  const { estilos, cuentas } = agruparPorEstilo(estiloCtx.nombres, registroEtiquetas, estiloCtx.noContesto);
  estiloCtx.estilos = estilos;
  if (estiloCtx.estilo && !estilos.some(e => e.estilo === estiloCtx.estilo)) estiloCtx.estilo = null;
  const sin = textoSinEstilo(cuentas);
  panel.innerHTML = `
    <div class="recs-estilo" data-recs-estilo="estilos" data-estilos="${estilos.length}">
      <div class="recs-estilo-fila"><button class="btn btn-secondary btn-sm" id="recs-estilo-volver">← Volver</button></div>
      ${estiloCtx.parado ? '<p class="recs-estilo-nota">Paraste antes de terminar: se agrupa con lo que ya había.</p>' : ''}
      ${estilos.length
        ? `<div class="recs-estilo-pastillas" role="group" aria-label="Estilos de tus recomendados">${estilos.map(e => `<button type="button" class="recs-estilo-pastilla${e.estilo === estiloCtx.estilo ? ' is-on' : ''}" data-estilo="${escapeHtml(e.estilo)}" aria-pressed="${e.estilo === estiloCtx.estilo}">${escapeHtml(e.estilo)} <span class="recs-estilo-cuenta">${e.artistas.length}</span></button>`).join('')}</div>`
        : `<p class="recs-estilo-vacio">${TEXTO_SIN_ESTILOS}</p>`}
      ${sin ? `<p class="recs-estilo-nota" data-recs-estilo-sin>${escapeHtml(sin)}</p>` : ''}
      <div id="recs-estilo-plan"></div>
    </div>`;
  document.getElementById('recs-estilo-volver').onclick = () => renderRecommendations();
  panel.querySelectorAll('.recs-estilo-pastilla').forEach(b => {
    b.onclick = () => { estiloCtx.estilo = b.dataset.estilo; renderEstilos(); };
  });
  if (estiloCtx.estilo) renderPlan();
}

// Elegir un estilo, el selector y «Volver»: 0 peticiones. Nada se busca solo.
function renderPlan() {
  const cont = document.getElementById('recs-estilo-plan');
  const e = estiloCtx?.estilos.find(x => x.estilo === estiloCtx.estilo);
  if (!cont || !e) return;
  const plan = planDeLista(e.artistas, estiloCtx.temas);
  const opciones = [];
  for (let n = TEMAS_MIN; n <= TEMAS_MAX; n++) opciones.push(`<option value="${n}"${n === plan.temas ? ' selected' : ''}>${n}</option>`);
  const fuera = e.artistas.length - plan.artistas.length;
  cont.innerHTML = `
    <div class="card recs-estilo-plan" data-recs-estilo="plan">
      <h3 class="recs-estilo-h">${escapeHtml(e.estilo)}</h3>
      <p class="recs-estilo-nota">${plan.artistas.map(n => escapeHtml(n)).join(', ')}${fuera > 0 ? ` (y ${fuera} más que no entran: el tope es ${ARTISTAS_POR_ESTILO} artistas)` : ''}.</p>
      <div class="recs-estilo-fila">
        <label class="recs-estilo-temas">Temas por artista <select id="recs-estilo-temas">${opciones.join('')}</select></label>
        <button class="btn btn-primary" id="recs-estilo-armar">Armar la lista</button>
      </div>
      <p class="recs-estilo-nota" id="recs-estilo-coste" title="${escapeHtml(TITULO_COSTE)}">${textoCoste(plan)}</p>
    </div>`;
  document.getElementById('recs-estilo-temas').onchange = (ev) => {
    estiloCtx.temas = +ev.target.value;
    document.getElementById('recs-estilo-coste').textContent = textoCoste(planDeLista(e.artistas, estiloCtx.temas));
  };
  document.getElementById('recs-estilo-armar').onclick = () => armarListaDe(e.estilo, planDeLista(e.artistas, estiloCtx.temas));
}

async function armarListaDe(estilo, plan) {
  const ruta = vigilarRuta();
  const panel = document.getElementById('recs-panel');
  if (!panel) return;
  const parar = { pedido: false };
  let volvio = false;
  currentPick = null;
  resolvedTracks = [];
  pickedUris.clear();
  panel.innerHTML = `
    <div class="recs-estilo" data-recs-estilo="lista">
      <div class="recs-estilo-fila">
        <button class="btn btn-secondary btn-sm" id="recs-estilo-volver">← Volver a los estilos</button>
        <button class="btn btn-secondary btn-sm" id="recs-estilo-parar">Parar</button>
      </div>
      <div class="card recs-estilo-cabecera">
        <h2 class="recs-estilo-h2">${escapeHtml(estilo)}</h2>
        <div class="recs-estilo-nota">${plan.artistas.length} artistas · ${plan.temas} temas por artista · ${textoCoste(plan)}</div>
      </div>
      <div id="recs-tracks"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px" id="recs-estilo-buscando">Buscando en Spotify (0 de ${plan.topeTotal})…</div></div></div>
    </div>`;
  document.getElementById('recs-estilo-volver').onclick = () => { volvio = true; renderEstilos(); };
  document.getElementById('recs-estilo-parar').onclick = (ev) => {
    parar.pedido = true;
    ev.currentTarget.disabled = true;
    ev.currentTarget.textContent = 'Parando…';
  };
  const viva = () => ruta.vigente() && !volvio;

  const r = await armarLista({
    plan,
    topTracks: (n) => getArtistTopTracks(n, TOP_TRACKS_POR_ARTISTA),
    // Sin reintentos: si `/search` falla, la lista se para (seguir sería gastar una cuota que ya
    // se acabó). El camino de un artista sigue con los de siempre.
    resolver: (t) => resolverTemaEnSpotify(t, { _maxRetries: 0 }),
    enMeGusta: (uri) => likedUris.has(uri),
    seguir: () => viva() && !parar.pedido,
    esperar: sleep,
    pausaMs: PAUSA_ENTRE_BUSQUEDAS,
    onPaso: ({ busquedas }) => {
      if (!viva()) return;
      const el = document.getElementById('recs-estilo-buscando');
      if (el) el.textContent = `Buscando en Spotify (${busquedas} de ${plan.topeTotal})…`;
    },
  });
  if (r.corte?.tipo === 'error') console.warn('[recs] Spotify dejó de contestar al armar la lista de un estilo:', r.corte.error);
  for (const a of r.artistas) {
    if (a.lastfmFallo) console.warn(`[recs] Last.fm no contestó los temas de «${a.nombre}»:`, a.lastfmFallo);
  }
  if (!viva()) return;
  renderListaEstilo(estilo, plan, r);
}

function renderListaEstilo(estilo, plan, r) {
  const tracksEl = document.getElementById('recs-tracks');
  if (!tracksEl) return;
  document.getElementById('recs-estilo-parar')?.remove();
  resolvedTracks = r.artistas.flatMap(a => a.temas);
  pickedUris.clear();
  resolvedTracks.forEach(t => pickedUris.add(t.uri));
  const aviso = r.corte ? `
    <div class="card recs-estilo-corte" data-recs-estilo-corte="${r.corte.tipo}">
      <p class="recs-estilo-nota">${escapeHtml(textoCorte(r.corte))}</p>
      ${r.corte.tipo === 'error' ? `<p class="recs-estilo-crudo">${escapeHtml(String(r.corte.error?.message || r.corte.error))}</p>` : ''}
      ${r.sinBuscar.length ? `<p class="recs-estilo-nota" data-recs-estilo-sin-buscar>${escapeHtml(textoSinBuscar(r.sinBuscar))}</p>` : ''}
    </div>` : '';
  tracksEl.innerHTML = `
    ${aviso}
    ${resolvedTracks.length ? barraSeleccionHtml() : '<div class="card" style="margin-bottom:16px"><p>No ha quedado ningún tema nuevo en esta lista.</p></div>'}
    ${r.artistas.map(a => `
      <section class="card recs-estilo-artista" data-artista="${escapeHtml(a.nombre)}">
        <h3 class="recs-estilo-h">${escapeHtml(a.nombre)}</h3>
        <p class="recs-estilo-nota recs-estilo-linea">${escapeHtml(textoCabecera(a, plan))}</p>
        ${a.temas.length ? `<div class="tracks-grid">${a.temas.map(filaHtml).join('')}</div>` : ''}
      </section>`).join('')}`;
  accionesDeFila(tracksEl);
  if (resolvedTracks.length) {
    cablearSeleccion(tracksEl, () => crearPlaylistDeSeleccion(nombreSugerido(estilo), descripcionPlaylist(estilo)));
  }
}
