// Ficha de álbum: modal chico con tapa, nombre, artista, plays/min totales,
// y botones para saltar a la ficha del artista o abrir el álbum en Spotify.
// Se dispara desde openAlbumCard({ name, artist, plays, min, img }).
//
// v=117: nueva sección "N de M pistas en tus me gusta" con la lista de likes
// que caen dentro de ese álbum (matcheados por album id si viene, si no por
// nombre + artista normalizados con util/album-key.js). Cada fila abre la
// ficha de canción y tiene botón ▶ de preview.
//
// v=142: ficha a dos columnas (pistas | tapa + escucha), corazón de "está en
// tus me gusta" en cada fila y previews que prueban contra TODOS los artistas
// del track.

import { escapeHtml } from '../ui/components.js?v=191';
import { openArtistCard, knownArtist } from './artist-card.js?v=191';
import { openModal, closeTop } from '../ui/modal-stack.js?v=191';
import { getBestAvailableLikes, getAlbumTracks, spotifyFetch } from '../api.js?v=191';
import { albumKey, coverId } from '../util/album-key.js?v=191';
// ⚠️ `limpiaParaQuery` FALTABA acá hasta v=153 y el síntoma era mudo: la usa
// `resolveAlbumId` en el `try`, así que cada ficha tiraba un ReferenceError que
// el catch convertía en «no pude resolver el álbum», la ficha se caía al camino
// degradado de v=142 (solo tus likes, todos con el ♥ lleno) y el tracklist
// completo de v=144 no se pedía NUNCA. Verificado en producción el 2026-08-23:
// 6 fichas abiertas, 6 warnings «limpiaParaQuery is not defined» en consola.
import { artistMatches, normText, limpiaParaQuery } from '../util/track-match.js?v=191';
import { skelTracklist } from '../ui/skeleton.js?v=191';
import { firstArtistName, artistNames, resolveArtistName } from '../util/artist-name.js?v=191';
import { coverUrl } from '../util/cover-size.js?v=191';
import { lookupAlbumStats } from '../util/album-stats.js?v=191';
import { fmtDia } from '../util/fecha.js?v=191';
import { getPreview } from '../api/preview-providers.js?v=191';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=191';
import { openTrackCard } from './track-card.js?v=191';

const PLAY_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const DOTS_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
// Mismo corazón que la tracklist de W-Three (features/wthree.js).
const HEART_SVG = `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.5 12c-2 4.4-9.5 9-9.5 9z"/></svg>`;
// El mismo trazo, hueco: "esta pista del disco NO está en tus me gusta".
// «Sin preview» dicho con todas las letras (v=150): el «—» de antes se leía
// como un botón roto, no como una respuesta.
const SIN_PREVIEW_HTML = '<span class="sin-preview-txt">Sin preview</span>';
const HEART_OUTLINE_SVG = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.5 12c-2 4.4-9.5 9-9.5 9z"/></svg>`;

// Cache del último set de likes en memoria (evita re-fetch del cache al
// abrir varias fichas seguidas dentro de la misma sesión).
let _likesMemo = null;
async function loadLikesMemo() {
  if (_likesMemo) return _likesMemo;
  try {
    const res = await getBestAvailableLikes();
    _likesMemo = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
  } catch { _likesMemo = []; }
  return _likesMemo;
}

function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) return `${Math.floor(min / 60).toLocaleString('es-ES')}h ${Math.round(min % 60)}m`;
  return `${Math.round(min)}m`;
}

// Nombres de todos los artistas de un track (del track y, si hace falta, del
// álbum). Es lo que necesita la cadena de previews para no depender de que el
// primero sea el "buscable".
function artistsOf(t, alb) {
  const out = [];
  const seen = new Set();
  for (const x of [...(t?.artists || []), ...(alb?.artists || [])]) {
    const n = x?.name || (typeof x === 'string' ? x : '');
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

// Del cache de likes, devuelve las canciones que pertenecen a este álbum.
// Tres criterios, de más fuerte a más flojo:
//   1. album.id, si el llamador lo trajo.
//   2. coverId() de la tapa — el hash de la imagen es la identidad real del
//      disco (util/album-key.js) y es lo que ya usa el mosaico.
//   3. albumKey() exacto, y si no, mismo nombre de álbum + algún artista en
//      común. Este último es el que rescata los discos colaborativos: el
//      mosaico puede llamarlo «Kanye West» y los likes decir «¥$», y sin él la
//      ficha aparecía sin ninguna pista.
function likesInAlbum(likes, a) {
  if (!Array.isArray(likes) || likes.length === 0) return [];
  const targetKey = albumKey(a.name, a.artist);
  const targetNameKey = albumKey(a.name, '');
  const targetAlbumId = a.albumId || a.id || null;
  const targetCover = coverId(a.img);
  const out = [];
  const seen = new Set();
  for (const it of likes) {
    const t = it?.track || it;
    if (!t || !t.name) continue;
    const alb = t.album || {};
    const artistas = artistsOf(t, alb);
    const artistName = artistas[0] || '';
    const matchById = targetAlbumId && alb.id && alb.id === targetAlbumId;
    const matchByCover = !matchById && targetCover
      && (alb.images || []).some(im => coverId(im?.url) === targetCover);
    const mismoNombre = albumKey(alb.name || '', '') === targetNameKey;
    const matchByKey = !matchById && !matchByCover
      && (albumKey(alb.name || '', artistName) === targetKey
        || (mismoNombre && (!a.artist || artistMatches(artistas, a.artist))));
    if (!matchById && !matchByCover && !matchByKey) continue;
    if (t.id && seen.has(t.id)) continue;
    if (t.id) seen.add(t.id);
    out.push({
      id: t.id || null,
      name: t.name,
      artist: artistName,
      artists: artistas,
      album: alb.name || a.name,
      img: coverUrl(alb.images, 'grande'),
      trackNumber: t.track_number || 0,
    });
  }
  out.sort((x, y) => (x.trackNumber || 999) - (y.trackNumber || 999) || x.name.localeCompare(y.name, 'es'));
  return out;
}

// ── Tracklist completo del álbum (v=144) ────────────────────────────────────
//
// Hasta v=142 la lista de la ficha eran SOLO los likes de Ian de ese álbum, así
// que el ♥ salía lleno en todas las filas y no distinguía nada. Con el tracklist
// entero el corazón vuelve a significar algo: qué pistas del disco están en tus
// me gusta y cuáles no.
//
// `GET /albums/{id}/tracks?limit=50` está CONFIRMADO vivo post-migración (lo
// usan W-Three y #discover-artists). Igual va con degradación: si falla, la
// ficha vuelve a mostrar solo los likes, como antes.
//
// El problema real es el `albumId`: casi ningún llamador lo trae (el mosaico, el
// dashboard y el Wrapped mandan nombre + artista y nada más). Para esos se
// resuelve con /search, que sí está vivo, y se memoiza por clave de álbum: abrir
// la misma ficha diez veces es una sola búsqueda.
const _albumIdMemo = new Map();   // albumKey → id | null

// ⚠️ **El apóstrofo dentro de las comillas rompe la query de Spotify** (medido
// en vivo el 2026-08-19 contra la API real, con la sesión de Ian):
//
//   album:"Don't Be Dumb" artist:"A$AP Rocky"  →  0 resultados
//   album:"Dont Be Dumb"  artist:"A$AP Rocky"  →  2 resultados ✅
//
// No es cosa de este disco: afecta a **cualquier** álbum o artista con
// apóstrofo. El síntoma era mudo — `resolveAlbumId` devolvía null, la ficha se
// caía al camino degradado de v=142 y en vez de «10 de 15 pistas en tus me
// gusta» decía «10 pistas», sin que nada avisara.
//
// El arreglo: se **relaja la query** (fuera el apóstrofo) y se **aprieta la
// comparación** después, contra el nombre REAL. Es la lección de v=124 al
// derecho: aflojar el filtro de resultados es lo que traía a Nick Drake cuando
// se buscaba Drake, así que la comparación posterior no se toca — al contrario,
// antes no había ninguna (se agarraba `items[0]` a ciegas con `limit=1`).
// ⚠️ El apóstrofo se **BORRA**, no se cambia por un espacio. Medido contra la
// API real el 2026-08-19, y la diferencia es total:
//
//   album:"Don t Be Dumb"  →  0 resultados
//   album:"Dont Be Dumb"   →  2 resultados ✅
//   album:"1989 (Taylor s Version)"  →  1 resultado
//   album:"1989 (Taylors Version)"   →  3 resultados ✅
//
// O sea que Spotify indexa «don't» como el token `dont`, no como `don t`.
// Partirlo en dos palabras es otra forma de no encontrar nada.
// `limpiaParaQuery` vive en util/track-match.js: la misma regla la necesita
// `getArtistAlbums` en api.js para el fallback por /search.

async function resolveAlbumId(a) {
  const directo = a.albumId || a.id || null;
  if (directo) return directo;
  const artista = firstArtistName(resolveArtistName(a.artist || '', knownArtist));
  const k = albumKey(a.name, artista);
  if (_albumIdMemo.has(k)) return _albumIdMemo.get(k);
  let id = null;
  try {
    const q = `album:"${limpiaParaQuery(a.name)}" artist:"${limpiaParaQuery(artista)}"`;
    // limit=5, no 1: sacado el apóstrofo la búsqueda es más laxa, así que puede
    // devolver vecinos. El que decide es el filtro de abajo, no el orden.
    const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=5`);
    const items = res?.albums?.items || [];

    // Comparación contra el nombre REAL (con apóstrofo y todo). `normText` ya
    // tira la puntuación, así que «Don't Be Dumb» y «Dont Be Dumb» caen en la
    // misma clave sin aflojar nada más.
    // El apóstrofo se saca a los DOS lados antes de normalizar: `normText` lo
    // convierte en espacio, así que «Don't Be Dumb» daría «don t be dumb» y
    // «Dont Be Dumb» daría «dont be dumb» — distintos. Sacándolo primero, las
    // dos escrituras del mismo disco caen en la misma clave.
    const clave = (s) => normText(String(s || '').replace(/['‘’ʼ`´]/g, ''));
    const nombreOk = clave(a.name);
    const artistaOk = clave(artista);
    const elegido = items.find(it => {
      if (clave(it.name) !== nombreOk) return false;
      if (!artistaOk) return true;
      // El artista pedido tiene que estar de verdad entre los del álbum.
      return artistNames(it).some(n => clave(n) === artistaOk);
    }) || null;

    id = elegido?.id || null;
    if (!id && items.length) {
      console.warn(`[album-card] «${a.name}» — ${artista}: ${items.length} resultados y ninguno coincide; sigo sin tracklist`);
    }
  } catch (e) {
    console.warn('[album-card] no pude resolver el álbum:', e.message);
  }
  _albumIdMemo.set(k, id);
  return id;
}

// Clave "misma canción aunque sea otra edición": el id no sirve para cruzar un
// like del deluxe contra el tracklist del original. Es la misma normalización
// que usa la tracklist de W-Three (features/wthree.js).
function trackNameKey(name) {
  return (name || '').toLowerCase().replace(/\s*[([].*?[)\]]/g, '').trim();
}

async function loadAlbumTracklist(a) {
  const albumId = await resolveAlbumId(a);
  if (!albumId) return [];
  try {
    const items = await getAlbumTracks(albumId, { limit: 50 });
    return (items || [])
      .filter(t => t && t.name)
      .map(t => ({
        id: t.id || null,
        name: t.name,
        artists: artistsOf(t, {}),
        trackNumber: t.track_number || 0,
        disc: t.disc_number || 1,
      }))
      .sort((x, y) => (x.disc - y.disc) || (x.trackNumber - y.trackNumber));
  } catch (e) {
    console.warn('[album-card] tracklist:', e.message);
    return [];
  }
}

// La «primera vez» no lleva su gemela «última vez» a propósito: el export del
// Extended Streaming History termina en junio, así que la última escucha que
// podríamos mostrar es la última REGISTRADA, no la última de verdad. Un dato
// que engaña es peor que ninguno.
function primeraVezHtml(first) {
  if (!first) return '';
  return `
    <div class="album-modal-first" title="El primer día que escuchaste una pista de este disco al menos 30 segundos">
      Primera vez: <strong>${escapeHtml(fmtDia(first))}</strong>
    </div>`;
}

// Un disco sin datos de escucha no es una anomalía: en #discover-artists y
// #new-releases son TODOS, por definición de la vista. Hasta v=164 la frase
// salía en un `<div class="album-modal-no-data">` que no tenía **ninguna regla
// de CSS** —se buscó en las tres hojas y no existía—, así que se pintaba con el
// tamaño y el color del cuerpo del modal y quedaba gritando en el medio de la
// ficha. Ahora es una línea chica y gris, del tamaño de «Primera vez».
function statsHtml(a) {
  if (!(a.plays > 0 || a.min > 0)) {
    return `<div class="album-modal-no-data">Sin datos de escucha</div>${primeraVezHtml(a.first)}`;
  }
  return `
    <div class="album-modal-stats">
      <div class="album-modal-stat">
        <div class="album-modal-stat-v">${fmtMinutes(a.min)}</div>
        <div class="album-modal-stat-l">tiempo escuchado</div>
      </div>
      <div class="album-modal-stat">
        <div class="album-modal-stat-v">${(a.plays || 0).toLocaleString('es-ES')}</div>
        <div class="album-modal-stat-l">plays</div>
      </div>
    </div>
    ${primeraVezHtml(a.first)}`;
}

// ── Acciones extra (v=165) ─────────────────────────────────────────────────
//
// #discover-artists y #new-releases necesitan, dentro de la ficha, los mismos
// botones que la tarjeta de la grilla («Guardar álbum», «Añadir pistas a mis
// likes», «Añadir a playlist…», «Escuchado», «Ocultar»). Hasta v=164 esas dos
// vistas terminaban con una ficha aparte para poder tenerlos.
//
// La forma de meterlos SIN duplicar la ficha es este punto de extensión: el
// llamador pasa `acciones: [{ label, title, onClick }]` y se pintan detrás de
// las dos de siempre. La ficha no sabe qué hace cada una — y no tiene por qué.
// `onClick` recibe `{ cerrar }` para que la acción pueda bajar el modal (casi
// todas sacan el álbum de la lista que hay detrás).
// Caja PROPIA y no dentro de `.album-modal-actions`: en el layout de dos
// columnas esa caja es `flex-direction: column` con `.btn { width: 100% }`
// —correcto para sus dos botones—, y cinco más ahí adentro la convertían en una
// torre que dejaba «Ocultar» debajo del pliegue del modal.
function accionesHtml(acciones) {
  if (!acciones.length) return '';
  return `<div class="album-modal-acciones-extra">${acciones.map((acc, i) => `
    <button class="btn btn-secondary btn-sm" data-alb-accion="${i}"
            title="${escapeHtml(acc.title || acc.label)}">${escapeHtml(acc.label)}</button>
  `).join('')}</div>`;
}

export function openAlbumCard(entrada) {
  if (!entrada || !entrada.name) return;

  // El artista del álbum es UNO. Si llega la cadena unida de un track se parte
  // acá, igual que en las otras dos fichas (v=150).
  const artista = resolveArtistName(firstArtistName(entrada.artist || ''), knownArtist);
  const a = { ...entrada, artist: artista };
  const acciones = Array.isArray(entrada.acciones) ? entrada.acciones.filter(x => x && x.label) : [];

  const spotifyQuery = encodeURIComponent(`${a.name} ${artista}`.trim());
  const spotifyUrl = `https://open.spotify.com/search/${spotifyQuery}`;

  // ── El id del modal (v=150) ──
  //
  // Era `album-card:{nombre}||{artista}`, y con el artista crudo eso fabricaba
  // ids DISTINTOS para el mismo disco: «Don't Be Dumb||A$AP Rocky» y «Don't Be
  // Dumb||A$AP Rocky, Brent Faiyaz» convivían apilados en la misma pila
  // (reproducido en producción el 2026-08-19). Al revés también molestaba: dos
  // discos homónimos de artistas distintos compartían id y el dedup revelaba el
  // que no era, cerrando de paso todo lo que hubiera encima.
  //
  // Ahora manda el id de álbum de Spotify cuando el llamador lo trae, y si no,
  // la clave normalizada de nombre + PRIMER artista (`albumKey`, la misma que
  // ya usan el mosaico y `lookupAlbumStats`).
  const modalId = a.albumId || a.id
    ? `album-card:${a.albumId || a.id}`
    : `album-card:${albumKey(a.name, artista)}`;

  // Dos columnas (v=142): pistas a la izquierda, tapa + info de escucha a la
  // derecha. El orden del DOM es al revés (info primero) para que al plegarse
  // en una sola columna la tapa quede arriba; en escritorio las columnas se
  // reordenan con `order` en el CSS. El corte lo hace una media query, sin JS.
  const overlay = openModal({
    id: modalId,
    html: `
    <div class="modal card-modal album-modal" style="max-width:820px;width:min(820px,94vw)">
      <div class="card-modal-head-simple">
        <div class="card-modal-eyebrow">Ficha de álbum</div>
        <button class="btn btn-secondary btn-sm card-modal-close" data-close-modal>✕</button>
      </div>
      <div class="album-modal-cols">
        <div class="album-modal-col album-modal-col-info">
          <div class="album-modal-body">
            ${a.img
              ? `<img src="${a.img}" alt="" class="album-modal-cover">`
              : `<div class="album-modal-cover album-modal-cover-empty">♪</div>`
            }
            <div class="album-modal-name">${escapeHtml(a.name)}</div>
            <button class="album-modal-artist-link" id="alb-artist">${escapeHtml(a.artist || '')}</button>
          </div>
          <div id="alb-stats">${statsHtml(a)}</div>
          <div class="album-modal-actions">
            <button class="btn btn-primary btn-sm" id="alb-go-artist">Ver ficha del artista</button>
            <a class="btn btn-secondary btn-sm" id="alb-spotify" href="${spotifyUrl}" target="_blank" rel="noopener">Buscar en Spotify</a>
          </div>
          ${accionesHtml(acciones)}
        </div>
        <div class="album-modal-col album-modal-col-tracks">
          <div class="album-modal-likes" id="alb-likes">${skelTracklist(10)}</div>
        </div>
      </div>
    </div>
  `,
  });

  acciones.forEach((acc, i) => {
    const btn = overlay.querySelector(`[data-alb-accion="${i}"]`);
    if (btn) btn.onclick = () => acc.onClick?.({ cerrar: () => closeTop() });
  });

  // Guardas de null, como la de `[data-alb-accion]` de arriba: `routeteardown`
  // cierra la pila de modales, así que una ficha que se estaba abriendo cuando
  // cambió la ruta se queda sin overlay y esto tiraba «Cannot set properties of
  // null (setting 'onclick')». Mismo caso que `track-card.js` (v=174).
  const irAlArtista = () => { if (artista) openArtistCard({ name: artista }); };
  const elArtista = overlay.querySelector('#alb-artist');
  if (elArtista) elArtista.onclick = irAlArtista;
  const btnArtista = overlay.querySelector('#alb-go-artist');
  if (btnArtista) btnArtista.onclick = irAlArtista;

  // Los números SIEMPRE se recontrastan contra el historial, no solo cuando el
  // llamador no trajo ninguno. En v=140 la condición era "los dos en cero", y
  // eso dejaba pasar justo el caso que se veía: un llamador que trae los
  // minutos pero no las plays («20m · 0 plays»). `lookupAlbumStats` unifica por
  // `coverId()`, así que también junta los discos colaborativos que el export
  // parte en varias claves (VULTURES 1 como «¥$» y como «Kanye West»).
  //
  // Solo se pisa lo que el índice sabe de verdad: si devuelve ceros, se deja lo
  // que hubiera pasado el llamador.
  lookupAlbumStats(a).then(t => {
    if (!(t.plays > 0 || t.min > 0)) return;
    // La fecha SOLO la tiene el índice: si llegó, hay que repintar aunque los
    // números que trajo el llamador ya fueran los buenos.
    if (!t.first && t.plays <= (a.plays || 0) && t.min <= (a.min || 0)) return;
    const slot = overlay.querySelector('#alb-stats');
    if (slot) slot.innerHTML = statsHtml({ ...a, ...t });
  }).catch(err => console.warn('[album-card] stats:', err.message));

  // El esqueleto ya está pintado en el markup de arriba (mismo paso sincrónico
  // que el modal), así que la ficha aparece ENTERA al instante: tapa, título,
  // artista, botones y diez filas grises con la forma de la tracklist. Lo único
  // que hace esta promesa es cambiar el relleno.
  hydrateLikes(overlay, a).catch(err => {
    console.warn('[album-card] likes:', err.message);
    const holder = overlay.querySelector('#alb-likes');
    if (holder) holder.innerHTML = '';
  });
}

async function hydrateLikes(overlay, a) {
  const holder = overlay.querySelector('#alb-likes');
  if (!holder) return;
  const likes = await loadLikesMemo();
  const enLikes = likesInAlbum(likes, a);

  // Los likes salen de caché (o del memo del módulo); el tracklist es la única
  // ida a la red de esta función.
  const tracklist = await loadAlbumTracklist(a);

  // Índices de "está en tus me gusta": por id y por nombre normalizado, porque
  // un like puede venir de otra edición del disco y ahí el id no coincide.
  const likedIds = new Set(enLikes.map(t => t.id).filter(Boolean));
  const likedNames = new Set(enLikes.map(t => trackNameKey(t.name)));
  const likeByKey = new Map(enLikes.map(t => [trackNameKey(t.name), t]));

  // Con tracklist: se pintan TODAS las pistas del disco y el ♥ distingue.
  // Sin tracklist (endpoint caído, álbum no resuelto): se degrada a lo de
  // antes — solo los likes, todos con corazón.
  const completo = tracklist.length > 0;
  const matched = completo
    ? tracklist.map(t => {
      const k = trackNameKey(t.name);
      const like = likeByKey.get(k);
      return {
        id: t.id || like?.id || null,
        name: t.name,
        artist: t.artists[0] || like?.artist || a.artist || '',
        artists: t.artists.length ? t.artists : (like?.artists || []),
        album: a.name,
        img: like?.img || a.img || null,
        trackNumber: t.trackNumber,
        liked: (t.id && likedIds.has(t.id)) || likedNames.has(k),
      };
    })
    : enLikes.map(t => ({ ...t, liked: true }));

  const nLiked = matched.filter(t => t.liked).length;
  const total = completo ? matched.length : (a.totalTracks || null);
  const countLine = total
    ? `${nLiked} de ${total} pista${total === 1 ? '' : 's'} en tus me gusta`
    : nLiked > 0
      ? `${nLiked} pista${nLiked === 1 ? '' : 's'} en tus me gusta`
      : 'no tienes ninguna en tus me gusta';

  // El ♥ marca "está en tus me gusta", igual que en la tracklist de W-Three.
  // Antes ahí había un punto: era el NÚMERO DE PISTA, que nunca se llegó a ver
  // porque la caché de likes (`slimTrack` en api.js) no guardaba `track_number`
  // y el `·` era su relleno para el caso "no sé qué número es".
  //
  // Desde v=144 la lista es el TRACKLIST COMPLETO del disco, así que el corazón
  // separa de verdad: lleno en las que están en me gusta, hueco en las que no.
  // Cuando no se pudo traer el tracklist se cae a la lista vieja (solo likes) y
  // ahí sí van todas llenas, porque todas lo son.
  holder.innerHTML = `
    <div class="album-modal-likes-head">
      <div class="album-modal-likes-title">${escapeHtml(countLine)}</div>
    </div>
    ${matched.length === 0 ? '' : `
      <div class="album-modal-likes-list">
        ${matched.map(t => `
          <div class="album-modal-like-row${t.liked ? '' : ' album-modal-like-row-off'}" data-tid="${escapeHtml(t.id || '')}">
            <span class="album-modal-like-heart${t.liked ? '' : ' is-off'}" title="${t.liked ? 'Está en tus me gusta' : 'No está en tus me gusta'}" aria-label="${t.liked ? 'En tus me gusta' : 'Fuera de tus me gusta'}">${t.liked ? HEART_SVG : HEART_OUTLINE_SVG}</span>
            <span class="album-modal-like-num">${t.trackNumber || ''}</span>
            <span class="album-modal-like-name">${escapeHtml(t.name)}</span>
            <button type="button" class="wt-play-btn album-modal-like-play" data-play-id="${escapeHtml(t.id || '')}" data-play-name="${escapeHtml(t.name)}" title="Preview 30s" aria-label="Preview">${PLAY_SVG}</button>
          </div>
        `).join('')}
      </div>
    `}
  `;

  // Click en una fila → ficha de canción apilada.
  holder.querySelectorAll('.album-modal-like-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.album-modal-like-play')) return;
      const tid = row.dataset.tid;
      const t = matched.find(x => x.id === tid);
      if (!t) return;
      openTrackCard({ id: t.id, name: t.name, artist: t.artist, artists: t.artists, album: t.album, img: t.img, albumImg: a.img });
    });
  });

  // ▶ preview por fila. Van TODOS los artistas del track más el del álbum: si
  // solo mandáramos el del álbum, un disco acreditado a un alias («¥$») no
  // matchea en ningún proveedor y se cae entero al embed de Spotify, que en un
  // iframe cross-origin no puede autoarrancar.
  holder.querySelectorAll('.album-modal-like-play').forEach(btn => {
    const id = btn.dataset.playId;
    const name = btn.dataset.playName;
    const t = matched.find(x => x.id === id);
    const setLabel = () => {
      btn.innerHTML = playingKey() === `alb:${id}` ? PAUSE_SVG : PLAY_SVG;
    };
    setLabel();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.innerHTML = DOTS_SVG;
      const res = await togglePreview(`alb:${id}`, async () => {
        return await getPreview({ name, artists: t?.artists, artist: a.artist, spotifyId: id });
      });
      if (res === true) btn.innerHTML = PAUSE_SVG;
      // Sin preview: LO DICE. Hasta v=149 esto ponía un «—» pelado y gris, que
      // desde la fila se lee como «a esta canción le falta el ▶» — fue el
      // reporte de Ian sobre «Love$ick (feat. A$AP Rocky)».
      else if (res === null) { btn.innerHTML = SIN_PREVIEW_HTML; btn.classList.add('sin-preview'); btn.title = 'Sin preview en iTunes ni en Deezer'; btn.disabled = true; }
      else btn.innerHTML = PLAY_SVG;
    });
  });

  // Medición del punto 1: resuelve la cadena de proveedores para todas las
  // pistas de la ficha abierta y cuenta cuántas quedan con audio de verdad
  // (iTunes/Deezer) y cuántas caen al embed de Spotify. Se corre a mano desde
  // la consola porque son N búsquedas de red: no se dispara al abrir la ficha.
  window.__auditAlbumPreviews = async () => {
    const filas = [];
    for (const t of matched) {
      const p = await getPreview({ name: t.name, artists: t.artists, artist: a.artist, spotifyId: t.id });
      filas.push({ pista: t.name, artistas: (t.artists || []).join(', '), proveedor: p?.provider || 'ninguno' });
    }
    const cuenta = filas.reduce((acc, f) => { acc[f.proveedor] = (acc[f.proveedor] || 0) + 1; return acc; }, {});
    console.table(filas);
    console.log(`[album-card] ${a.name} — ${filas.length} pistas:`, cuenta);
    return { album: a.name, total: filas.length, cuenta, filas };
  };
}

// Reset del cache al cambiar de user u otro invalidador (no lo enganchamos
// automáticamente — es cheap re-armarlo la próxima vez).
export function _clearAlbumCardLikesCache() { _likesMemo = null; }
