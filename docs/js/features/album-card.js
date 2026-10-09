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

import { escapeHtml, confirmModal } from '../ui/components.js?v=287';
import { showToast } from '../ui/toast.js?v=287';
import { openArtistCard, knownArtist } from './artist-card.js?v=287';
import { openModal, closeTop } from '../ui/modal-stack.js?v=287';
import { getBestAvailableLikes, getAlbumTracks, anadirLikes } from '../api.js?v=287';
import { albumKey, coverId } from '../util/album-key.js?v=287';
import { artistMatches } from '../util/track-match.js?v=287';
// `limpiaParaQuery` ya no se importa acá: desde v=219 la aplica el resolutor,
// que es quien arma la query. Es a propósito — cuando la limpieza era tarea del
// llamador, `wthree.js` se olvidaba del apóstrofo y nadie se enteraba. El
// antecedente: hasta v=153 el import FALTABA en este archivo y cada ficha
// tiraba un ReferenceError que el catch convertía en «no pude resolver el
// álbum», o sea un error de programación con cara de resultado normal.
import { resolveAlbumId } from '../util/album-resolver.js?v=287';
import { indiceIdsDeAlbum, idLocalDelAlbum } from '../util/album-id-local.js?v=287';
import { pedirYCachear } from '../util/cache-solo-exitos.js?v=287';
import { skelTracklist } from '../ui/skeleton.js?v=287';
import { firstArtistName, resolveArtistName } from '../util/artist-name.js?v=287';
import { coverUrl } from '../util/cover-size.js?v=287';
import { lookupAlbumStats } from '../util/album-stats.js?v=287';
import { fmtDia } from '../util/fecha.js?v=287';
import { getPreview } from '../api/preview-providers.js?v=287';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=287';
import { openTrackCard } from './track-card.js?v=287';
import { iconoPlay, iconoPausa, iconoPuntos } from '../ui/icons.js?v=287';

// Mismo corazón que la tracklist de W-Three (features/wthree.js).
const HEART_SVG = `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.5 12c-2 4.4-9.5 9-9.5 9z"/></svg>`;
// El mismo trazo, hueco: "esta pista del disco NO está en tus me gusta".
// «Sin preview» dicho con todas las letras (v=150): el «—» de antes se leía
// como un botón roto, no como una respuesta.
const SIN_PREVIEW_HTML = '<span class="sin-preview-txt">Sin preview</span>';
const HEART_OUTLINE_SVG = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.5 12c-2 4.4-9.5 9-9.5 9z"/></svg>`;

// Cada módulo pinta SOLO sus propios botones (v=219).
//
// Hasta v=218 la ficha marcaba su ▶ con `class="wt-play-btn album-modal-like-play"`
// para heredar el look, y el efecto no era estético: `features/wthree.js` tiene
// un listener de `previewchange` a nivel `document` que recorre TODOS los
// `.wt-play-btn` y les pone ▶ salvo a los que matcheen `wt:${playId}`. La clave
// de esta ficha es `alb:${id}`, así que NINGÚN botón de acá matcheaba nunca y
// cada evento del <audio> —playing, pause, waiting, ended— le borraba el ⏸ a la
// ficha abierta mientras la pista seguía sonando.
//
// El arreglo es de propiedad, no una excepción en el listener ajeno: la ficha
// tiene su clase, W-Three tiene la suya, el look se comparte en la hoja de
// estilos y cada uno escucha lo suyo. Agregarle un `:not()` al listener de
// W-Three habría dejado la clase compartida en pie, esperando al tercer módulo.
//
// El `btn.disabled` se respeta igual que en W-Three: una fila que ya dijo «Sin
// preview» no vuelve a ▶.
document.addEventListener('previewchange', (e) => {
  const key = e.detail?.key || '';
  document.querySelectorAll('.album-modal-like-play').forEach(btn => {
    if (btn.disabled) return;
    btn.innerHTML = (key === `alb:${btn.dataset.playId}`) ? iconoPausa(10) : iconoPlay(10);
  });
});

// Cache del último set de likes en memoria (evita re-fetch del cache al
// abrir varias fichas seguidas dentro de la misma sesión).
//
// ⚠️ Un vacío NO se memoiza (v=256). Hasta v=255 el `catch` hacía
// `_likesMemo = []`, y `[]` es **truthy**: el `if (_likesMemo)` de la línea de
// arriba lo daba por bueno y todas las fichas de la sesión quedaban sin
// corazones. Y no hacía falta ningún fallo para envenenarlo: alcanzaba con
// abrir una ficha ANTES de la primera sincronización.
//
// El criterio no es «está vacío» sino el `source` que ya devuelve la API
// (`api.js:663-665`), que es la única cosa que distingue las dos preguntas:
//   `source: 'full'`  → contestó con la caché → es un resultado.
//   `source: 'empty'` → la caché todavía no está → NO es un resultado.
// Es el mismo pozo que tapaba los corazones de W-Three, y la misma regla que
// `features/covers.js:245` y `util/artist-preview.js:66`, dicha con el campo
// que la API ya trae en vez de con el tamaño del array.
let _likesMemo = null;
// El índice albumKey → id de Spotify, memoizado. Ver util/album-id-local.js.
// Con esto abrir una ficha sin `albumId` (Wrapped, mosaico, Dashboard...) sale
// GRATIS si el álbum tiene al menos una pista en tus me gusta, en vez de gastar
// un `/search` por el resolutor.
let _idsMemo = null;
async function loadAlbumIdsMemo() {
  if (_idsMemo) return _idsMemo;
  const likes = await loadLikesMemo();
  _idsMemo = indiceIdsDeAlbum(likes);
  return _idsMemo;
}
async function loadLikesMemo() {
  if (_likesMemo) return _likesMemo;
  const res = await pedirYCachear({
    pedir: () => getBestAvailableLikes(),
    esResultado: r => r?.source === 'full',
    guardar: r => { _likesMemo = Array.isArray(r.items) ? r.items : []; },
    siFalla: { items: [], source: 'empty' },
    alFallar: e => console.warn('[album-card] no pude leer los me gusta:', e.message),
  });
  if (_likesMemo) return _likesMemo;
  return Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
}

// ¿Sabemos de verdad qué hay en me gusta? (v=267)
//
// `loadLikesMemo()` devuelve `[]` en dos situaciones que NO son la misma: la
// caché está y este disco no tiene ninguna pista likeada, o la caché todavía
// no está. Hasta v=266 la ficha las pintaba IGUAL —todos los corazones huecos
// y «no tienes ninguna en tus me gusta»— y eso era tolerable mientras el ♥
// fuera un adorno. Con «Añadir a me gusta» ya no lo es: el sentido de la vista
// es repasar las que FALTAN, y repasar contra una pizarra en blanco no es
// repasar, es volver a empezar.
//
// ⚠️ No se arregla bajando la biblioteca. Eso es exactamente lo que cerró
// v=255: `getBestAvailableLikes()` no va a la red por defecto, acá se la llama
// sin `allowFetch`, y así se queda. Se arregla DICIÉNDOLO en pantalla.
//
// El criterio es el mismo de v=256 y por el mismo motivo: `_likesMemo` solo se
// escribe cuando `pedirYCachear` dio por bueno el `source: 'full'`, así que
// «no es null» es «la caché contestó», no «el array tiene algo».
function likesConocidos() { return _likesMemo !== null; }

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
// El problema real es el `albumId`: casi ningún llamador lo trae — el mosaico,
// el Dashboard y el Wrapped mandan nombre + artista y nada más. Resolverlo es
// trabajo de `util/album-resolver.js`: EL resolutor, el único del repo desde
// v=219. Antes vivía acá, y tenía un gemelo peor dentro de `wthree.js` que
// agarraba `items[0]` a ciegas. Todo el criterio vive allá —el `limit=5`, el
// apóstrofo, la comparación contra el nombre real, el artista de verdad entre
// los del álbum y el rechazo del candidato que trae versión de más— junto con
// el memo, que desde v=219 guarda SOLO los éxitos.

// Clave "misma canción aunque sea otra edición": el id no sirve para cruzar un
// like del deluxe contra el tracklist del original. Es la misma normalización
// que usa la tracklist de W-Three (features/wthree.js).
function trackNameKey(name) {
  return (name || '').toLowerCase().replace(/\s*[([].*?[)\]]/g, '').trim();
}

// Devuelve `{ tracks, motivo }`. El `motivo` NO es decorativo: es lo único que
// separa «este disco no se pudo identificar» de «este disco no tiene pistas», y
// desde v=219 se pinta en la ficha. Antes salía por `console.warn`, que la
// extensión de Chrome no captura: el fallo era invisible salvo que alguien
// abriera las DevTools a mano, y así estuvo nueve versiones.
async function loadAlbumTracklist(a) {
  // El id se busca PRIMERO en local (v=263). Casi ningún llamador de esta ficha
  // trae `albumId` (el mosaico, el Dashboard y el Wrapped mandan nombre +
  // artista) y hasta v=262 todos iban directo a `resolveAlbumId()`, o sea a
  // `/search`, la cuota cara de la cuenta (429 en el request 697). Es el
  // mismo arreglo que #wthree recibió en v=258, con el mismo módulo:
  // `util/album-id-local.js`.
  let albumId = a.albumId || a.id || null;
  if (!albumId) {
    try { albumId = idLocalDelAlbum(a, await loadAlbumIdsMemo()); } catch { /* ignora */ }
  }
  let motivo = null;
  if (!albumId) ({ id: albumId, motivo } = await resolveAlbumId(a, { esArtistaConocido: knownArtist }));
  if (!albumId) return { tracks: [], motivo: motivo || 'no se pudo identificar el álbum' };
  try {
    const items = await getAlbumTracks(albumId, { limit: 50 });
    const tracks = (items || [])
      .filter(t => t && t.name)
      .map(t => ({
        id: t.id || null,
        name: t.name,
        artists: artistsOf(t, {}),
        trackNumber: t.track_number || 0,
        disc: t.disc_number || 1,
      }))
      .sort((x, y) => (x.disc - y.disc) || (x.trackNumber - y.trackNumber));
    return { tracks, motivo: null };
  } catch (e) {
    return { tracks: [], motivo: `el tracklist no cargó (${e.message})` };
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
  const { tracks: tracklist, motivo: motivoFallo } = await loadAlbumTracklist(a);

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

  // ⚠️ Con la caché de me gusta fría NO se sabe nada: ver `likesConocidos()`.
  // El contador y los corazones tienen que decir eso y no «ninguna».
  const conocidos = likesConocidos();
  const nLiked = matched.filter(t => t.liked).length;
  const total = completo ? matched.length : (a.totalTracks || null);
  const countLine = !conocidos
    ? (total
      ? `No sé cuáles de las ${total.toLocaleString('es-ES')} pistas tienes en me gusta`
      : 'No sé qué pistas tienes en me gusta')
    : total
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
  // ⚠️ El fallo de resolución se VE (v=219). Hasta v=218 salía por
  // `console.warn`, que la extensión de Chrome no captura: el usuario veía una
  // ficha que decía «10 pistas» en vez de «10 de 17», sin nada que indicara que
  // faltaba el tracklist. Un fallo que solo se cuenta a la consola es un fallo
  // que no se cuenta. El motivo técnico va en el `title` para no ensuciar la
  // línea, pero queda a un hover de distancia.
  const avisoHtml = !completo && motivoFallo
    ? `<div class="album-modal-aviso" role="status" title="${escapeHtml(motivoFallo)}">No se ha podido identificar este álbum en Spotify: se muestran solo tus me gusta.</div>`
    : '';

  // El aviso de la caché fría. Es el que convierte «ninguna» en «no lo sé», y
  // dice CÓMO se arregla —sincronizar, que cuesta una petición si el
  // incremental acierta— en vez de arreglarlo solo a 190 peticiones de Ian.
  const avisoLikesHtml = conocidos
    ? ''
    : `<div class="album-modal-aviso" role="status">Tus me gusta no están cargados en este navegador, así que no sé cuáles de estas pistas ya tienes. Sincronízalos para verlo; puedes añadir igualmente, y lo que ya estuviera no se duplica.</div>`;

  // La celda del corazón, en sus cuatro casos (v=267). Era un `<span>` pasivo y
  // ahora, cuando la pista NO está en me gusta y tiene id, es un BOTÓN que la
  // marca. Las que ya están siguen siendo un span: quitar likes no es trabajo
  // de esta ficha —lo hace #wthree, con su verificación (v=258)— y un corazón
  // que quita en un sitio y añade en otro es la clase de botón que borra algo
  // sin querer.
  const celdaCorazon = (t) => {
    if (t.liked) {
      return `<span class="album-modal-like-heart" title="Está en tus me gusta" aria-label="En tus me gusta">${HEART_SVG}</span>`;
    }
    if (!t.id) {
      // Sin id no hay nada que mandarle a Spotify. Se dice, en vez de ofrecer
      // un botón que no puede funcionar.
      return `<span class="album-modal-like-heart is-off" title="Sin id de Spotify: no puedo añadirla" aria-label="Sin id">${HEART_OUTLINE_SVG}</span>`;
    }
    const tit = conocidos
      ? 'No está en tus me gusta · haz clic para marcarla y añadirla'
      : 'Haz clic para marcarla y añadirla · no sé si ya la tienes';
    return `<button type="button" class="album-modal-like-add" data-add-id="${escapeHtml(t.id)}"
            aria-pressed="false" title="${tit}" aria-label="Marcar para añadir a me gusta">${HEART_OUTLINE_SVG}</button>`;
  };

  holder.innerHTML = `
    <div class="album-modal-likes-head">
      <div class="album-modal-likes-title">${escapeHtml(countLine)}</div>
    </div>
    ${avisoHtml}
    ${avisoLikesHtml}
    ${matched.length === 0 ? '' : `
      <div class="album-modal-likes-list">
        ${matched.map(t => `
          <div class="album-modal-like-row${t.liked || !conocidos ? '' : ' album-modal-like-row-off'}" data-tid="${escapeHtml(t.id || '')}">
            ${celdaCorazon(t)}
            <span class="album-modal-like-num">${t.trackNumber || ''}</span>
            <span class="album-modal-like-name">${escapeHtml(t.name)}</span>
            <button type="button" class="album-modal-like-play" data-play-id="${escapeHtml(t.id || '')}" data-play-name="${escapeHtml(t.name)}" title="Preview 30s" aria-label="Preview">${iconoPlay(10)}</button>
          </div>
        `).join('')}
      </div>
    `}
    ${!matched.some(t => t.id && !t.liked) ? '' : `
      <div class="album-modal-anadir is-vacia" id="alb-anadir-barra">
        <button type="button" class="btn btn-secondary btn-sm" id="alb-anadir-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primary btn-sm" id="alb-anadir-confirmar">Añadir a me gusta</button>
      </div>
    `}
  `;

  wireAnadirLikes(holder, matched, a, { conocidos, completo });

  // Click en una fila → ficha de canción apilada.
  holder.querySelectorAll('.album-modal-like-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // El ▶ y el ♥ de marcar tienen su propio handler: desde la fila no se
      // abre la ficha de canción al apretarlos.
      if (e.target.closest('.album-modal-like-play')) return;
      if (e.target.closest('.album-modal-like-add')) return;
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
      btn.innerHTML = playingKey() === `alb:${id}` ? iconoPausa(10) : iconoPlay(10);
    };
    setLabel();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.innerHTML = iconoPuntos(10);
      const res = await togglePreview(`alb:${id}`, async () => {
        return await getPreview({ name, artists: t?.artists, artist: a.artist, spotifyId: id });
      });
      if (res === true) btn.innerHTML = iconoPausa(10);
      // Sin preview: LO DICE. Hasta v=149 esto ponía un «—» pelado y gris, que
      // desde la fila se lee como «a esta canción le falta el ▶» — fue el
      // reporte de Ian sobre «Love$ick (feat. A$AP Rocky)».
      else if (res === null) { btn.innerHTML = SIN_PREVIEW_HTML; btn.classList.add('sin-preview'); btn.title = 'Sin preview en iTunes ni en Deezer'; btn.disabled = true; }
      else btn.innerHTML = iconoPlay(10);
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

// ── Marcar varias y confirmar al final (v=267) ──────────────────────────────
//
// Es el ESPEJO de `wireQuitarLikes()` de `features/wthree.js` (v=258), y a
// propósito: añadir a me gusta escribe en la cuenta de Spotify de Ian, así que
// no puede ser un toggle instantáneo por fila. Se marcan las que quiera, el
// cartel dice CUÁNTAS son, y se confirman en UNA sola acción. Cancelar no
// escribe nada.
//
// El caso de uso que lo pide, en palabras de Ian: escuchó un disco entero, no
// le puso like a ninguna, y quiere repasarlas para elegir cuáles van. O sea
// que lo normal son varias de una vez, no una.
//
// ⚠️ UNA sola petición, no una por pista. La ruta es `PUT /me/library?uris=` y
// el lote son 40 uris —lo sabe `api.js` y nadie más, ver `anadirLikes()`—, así
// que un disco entero entra en una. El «Añadir pistas a mis likes» de
// `#new-releases` y `#discover-common` dice en su comentario «una por una»: eso
// describe el efecto (quedan canciones sueltas entre los likes, no el álbum
// guardado), no el número de peticiones, que ahí también van en lotes de 40.
function wireAnadirLikes(holder, matched, a, { conocidos, completo }) {
  const barra = holder.querySelector('#alb-anadir-barra');
  const btnOk = holder.querySelector('#alb-anadir-confirmar');
  const btnNo = holder.querySelector('#alb-anadir-cancelar');
  // Guardas de null como las del resto del archivo: `routeteardown` cierra la
  // pila de modales y una ficha a medio hidratar se queda sin nodos.
  if (!barra || !btnOk || !btnNo) return;

  const marcadas = new Set();

  // ⚠️ La barra RESERVA su sitio desde el principio y solo se vuelve invisible
  // (`is-vacia` → `visibility: hidden`), nunca `display: none`.
  //
  // Con `hidden` la barra entraba y salía del layout, el modal crecía ~45 px y,
  // como está centrado en vertical, TODAS las filas saltaban hacia arriba al
  // marcar la primera. O sea: marcabas una, la lista se movía, y el segundo
  // clic caía en OTRA pista. En una función que escribe en la cuenta de Spotify
  // de Ian, marcar la canción equivocada es exactamente el fallo que importa.
  // Reproducido en la copia del perfil: tres clics seguidos sobre coordenadas
  // medidas con la ficha abierta terminaron cerrando el modal, porque el
  // tercero ya caía fuera.
  //
  // Por eso la barra tampoco se pinta cuando el disco no tiene ninguna pista
  // marcable (todas en me gusta o sin id): ahí no puede aparecer nunca y su
  // hueco sería un hueco a secas.
  const pintarBarra = () => {
    const n = marcadas.size;
    barra.classList.toggle('is-vacia', n === 0);
    btnOk.disabled = false;
    btnOk.textContent = n === 1 ? 'Añadir 1 a me gusta' : `Añadir ${n.toLocaleString('es-ES')} a me gusta`;
  };

  const pintarFila = (btn, on) => {
    // ⚠️ El corazón LLENO significa una sola cosa: «esta ya está en tus me
    // gusta». Una marcada se enciende en el color de acento pero se queda
    // HUECA, porque todavía no es tuya. El primer intento la llenaba y en la
    // captura una fila marcada y una ya tuya se leían igual: el único rastro
    // era la marca lateral de 2 px. Si el relleno dice dos cosas distintas, no
    // dice ninguna — y acá la diferencia es «ya la tienes» contra «se la vas a
    // mandar a Spotify».
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-marcada', on);
    btn.title = on
      ? 'Marcada para añadir a me gusta · haz clic para desmarcarla'
      : (conocidos
        ? 'No está en tus me gusta · haz clic para marcarla y añadirla'
        : 'Haz clic para marcarla y añadirla · no sé si ya la tienes');
    btn.closest('.album-modal-like-row')?.classList.toggle('album-modal-like-row-marcada', on);
  };

  const desmarcarTodas = () => {
    holder.querySelectorAll('.album-modal-like-add').forEach(btn => {
      if (marcadas.has(btn.dataset.addId)) pintarFila(btn, false);
    });
    marcadas.clear();
    pintarBarra();
  };

  holder.querySelectorAll('.album-modal-like-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.addId;
      if (!id) return;
      if (marcadas.has(id)) marcadas.delete(id); else marcadas.add(id);
      pintarFila(btn, marcadas.has(id));
      pintarBarra();
    });
  });

  btnNo.onclick = (e) => { e.preventDefault(); e.stopPropagation(); desmarcarTodas(); };

  btnOk.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const filas = matched.filter(t => t.id && marcadas.has(t.id));
    const n = filas.length;
    if (!n) return;

    // Dice qué va a pasar ANTES de pasar, con el número a la vista. El modo en
    // que Ian se enteró la otra vez de que un disco le había metido 12
    // canciones sueltas en los me gusta fue DESPUÉS (ver `#new-releases`).
    const detalle = n === 1
      ? `«${escapeHtml(filas[0].name)}»`
      : `${n.toLocaleString('es-ES')} pistas de «${escapeHtml(a.name)}»`;
    const dudaHtml = conocidos
      ? ''
      : ' Tus me gusta no están cargados, así que puede que alguna ya estuviera: añadirla de nuevo no la duplica.';
    const ok = await confirmModal(
      'Añadir a tus me gusta',
      `Vas a añadir <strong>${detalle}</strong> a tus me gusta en Spotify. Esto NO guarda el álbum: te deja ` +
      'las canciones sueltas entre tus likes, y para deshacerlo hay que quitarles el corazón a mano.' + dudaHtml,
      n === 1 ? 'Añadir la pista' : `Añadir las ${n.toLocaleString('es-ES')}`,
    );
    if (!ok) return;

    btnOk.disabled = true;
    btnOk.textContent = 'Añadiendo…';
    const entradas = filas.map(t => ({
      added_at: new Date().toISOString(),
      // La forma de la caché de me gusta, con el álbum adentro: sin `album`
      // las vistas que agrupan likes por disco lo verían como un huérfano.
      // `a.img` es la tapa que ya está pintada en esta misma ficha.
      track: {
        id: t.id,
        uri: `spotify:track:${t.id}`,
        name: t.name,
        track_number: t.trackNumber || undefined,
        artists: (t.artists && t.artists.length ? t.artists : [t.artist || a.artist || ''])
          .filter(Boolean).map(nombre => ({ id: null, name: nombre })),
        album: {
          id: a.albumId || a.id || null,
          name: a.name,
          images: a.img ? [{ url: a.img }] : [],
        },
      },
    }));
    try {
      await anadirLikes(entradas, { origen: 'ficha de álbum' });
    } catch (err) {
      showToast('No se pudieron añadir a me gusta: ' + err.message, 'error');
      pintarBarra();
      return;
    }
    showToast(
      n === 1
        ? `«${filas[0].name}» ya está en tus me gusta`
        : `${n.toLocaleString('es-ES')} pistas añadidas a tus me gusta`,
      'success',
    );

    // La ficha lo refleja al instante, sin recargar y sin pedir nada: la fila
    // pasa a corazón lleno y pierde su botón, igual que #wthree al revés.
    for (const t of filas) {
      t.liked = true;
      marcadas.delete(t.id);
      const btn = holder.querySelector(`.album-modal-like-add[data-add-id="${t.id}"]`);
      const fila = btn?.closest('.album-modal-like-row');
      fila?.classList.remove('album-modal-like-row-marcada', 'album-modal-like-row-off');
      const span = document.createElement('span');
      span.className = 'album-modal-like-heart';
      span.title = 'Está en tus me gusta';
      span.setAttribute('aria-label', 'En tus me gusta');
      span.innerHTML = HEART_SVG;
      btn?.replaceWith(span);
    }
    pintarBarra();

    // El contador de arriba. Después de añadir SÍ se sabe algo de este disco
    // —estas pistas— aunque la caché siguiera fría, así que el renglón pasa a
    // contar lo que se acaba de hacer en vez de seguir diciendo «no sé».
    const nLikedAhora = matched.filter(t => t.liked).length;
    const totalAhora = completo ? matched.length : (a.totalTracks || null);
    const titulo = holder.querySelector('.album-modal-likes-title');
    if (titulo) {
      titulo.textContent = totalAhora
        ? `${nLikedAhora} de ${totalAhora} pista${totalAhora === 1 ? '' : 's'} en tus me gusta`
        : `${nLikedAhora} pista${nLikedAhora === 1 ? '' : 's'} en tus me gusta`;
    }

    // ⚠️ El memo del módulo queda VIEJO: `anadirLikes` ya metió las pistas en
    // la caché de IndexedDB, pero `_likesMemo` es la copia en memoria que leyó
    // esta sesión. Sin esto, abrir otra ficha del mismo disco volvería a
    // pintar los corazones huecos. Se tira para que la próxima lo relea de la
    // caché —GRATIS, `getBestAvailableLikes()` no va a la red— en vez de
    // parchearlo a mano, que es lo que vuelve a divergir en tres meses.
    _likesMemo = null;
    _idsMemo = null;
  };

  pintarBarra();
}

// Reset del cache al cambiar de user u otro invalidador (no lo enganchamos
// automáticamente — es cheap re-armarlo la próxima vez).
export function _clearAlbumCardLikesCache() { _likesMemo = null; }
