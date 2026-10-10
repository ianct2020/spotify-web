// Vista "Mis tapas" (#covers): mosaico denso de las tapas que Ian escuchó

// de verdad (history-listened-albums.json) más las que tiene en su playlist
// "w three". Nada inferido — solo estas dos fuentes.
//
// v=116: dedup canónica compartida (util/album-key.js) que ignora
// diacríticos y sufijos "(Remastered)" etc. — antes álbumes iguales aparecían
// duplicados. Carga progresiva del primer viewport con fetchpriority=high + fade
// placeholder→img. Botón "Pantalla completa" (Fullscreen API) que oculta
// sidebar/header/toolbar y recalcula el lado.

import { loadListenedAlbums, isOwner, ownerLockedMessage } from './history-data.js';
import { isJunkTrack } from '../util/junk.js';
import { vigilarRuta } from '../util/vigencia-ruta.js';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js';
import { createLazyImages } from '../ui/lazy-img.js';
import { getAllPlaylistItems, getBestAvailableLikes } from '../api.js';
import { escapeHtml, pageHeader, showProgress, hideProgress } from '../ui/components.js';
import { showToast } from '../ui/toast.js';
import { openAlbumCard } from './album-card.js';
import { openArtistCard } from './artist-card.js';
import { albumKey, coverId, coverVariant } from '../util/album-key.js';
import { generarWallpaper, descargarBlob, WALLPAPER_PRESETS } from './covers-wallpaper.js';
import { buildAlbumStatsIndex } from '../util/album-stats.js';
import { sortList, ORDENES_TAPAS } from '../util/orden-tapas.js';
import { getPreview } from '../api/preview-providers.js';
import { hoverIn, hoverOut } from '../ui/preview-player.js';
import { coverUrl, tapaParaCelda } from '../util/cover-size.js';
import { prefKey, migratePrefKey } from '../storage.js';
import { leerColores, coloresAlVuelo } from './mosaico-colores.js';
import { mediaDeRejilla, BYTES_POR_PORTADA } from '../util/cover-color.js';
import { FAMILIAS, SIN_COLOR, SIN_COLOR_NOMBRE, familiaDeRgb } from '../util/familia-color.js';

const LS_KEY_SIZE = 'covers_cell_size';
const LS_KEY_SORT = 'covers_sort_mode';
const LS_KEY_YEARS = 'covers_years_selected_v2';
const LS_KEY_COLORS = 'covers_colors_selected_v1';
const LS_WTHREE_ID = 'wthree_playlist_id';

const VALID_SIZES = new Set(['28', '48', '64', '96']);
const VALID_SORTS = new Set(ORDENES_TAPAS);
const GRID_GAP = 2;

function getSize() {
  const v = localStorage.getItem(prefKey(LS_KEY_SIZE));
  return VALID_SIZES.has(v) ? v : '28';
}
function setSize(v) { if (VALID_SIZES.has(v)) localStorage.setItem(prefKey(LS_KEY_SIZE), v); }
function getSort() {
  const v = localStorage.getItem(prefKey(LS_KEY_SORT));
  return VALID_SORTS.has(v) ? v : 'date-asc';
}
function setSort(v) { if (VALID_SORTS.has(v)) localStorage.setItem(prefKey(LS_KEY_SORT), v); }
function getYearsSel() {
  try {
    const raw = JSON.parse(localStorage.getItem(prefKey(LS_KEY_YEARS)));
    if (Array.isArray(raw)) return new Set(raw.map(Number).filter(Number.isFinite));
  } catch { /* empty = todos */ }
  return new Set();
}
function setYearsSel(sel) {
  try { localStorage.setItem(prefKey(LS_KEY_YEARS), JSON.stringify([...sel])); } catch { /* full */ }
}

// ── El filtro por familia de color (v=288) ──────────────────────────────────
//
// Mismo contrato que el de año: un `Set` vacío significa «todas», y la
// selección es MÚLTIPLE (apretar «rojos» y «azules» enseña las dos). Los dos
// filtros se combinan con Y: año **y** color, como pidió el encargo.
//
// ⚠️ Se valida contra `IDS_FAMILIA`, no contra lo que haya en el localStorage:
// una familia renombrada dejaría basura guardada que filtraría a cero tapas sin
// que nada se queje. Lo que no se reconoce, se descarta.
const IDS_VALIDOS = new Set([...FAMILIAS.map(f => f.id), SIN_COLOR]);
function getColorsSel() {
  try {
    const raw = JSON.parse(localStorage.getItem(prefKey(LS_KEY_COLORS)));
    if (Array.isArray(raw)) return new Set(raw.filter(x => IDS_VALIDOS.has(x)));
  } catch { /* vacío = todas */ }
  return new Set();
}
function setColorsSel(sel) {
  try { localStorage.setItem(prefKey(LS_KEY_COLORS), JSON.stringify([...sel])); } catch { /* full */ }
}

// Aplana history-listened-albums.json y mergea la playlist W-Three (si hay).
// Devuelve la lista de álbumes únicos con: name, artist, img, date (primera
// escucha), plays y min REALES (del historial completo, ver util/album-stats.js),
// years y sources ('listened' / 'wthree').
//
// ⚠️ **Las dos son `Set` mientras se arma el mapa, pero SOLO `years` sale como
// array**: el `return` de abajo lo aplana porque el filtro por año necesita
// `.some()`. `sources` sale como `Set` y los consumidores le hacen `.has()`.
// Este comentario decía «Set» de las dos y era la única documentación del
// contrato: cuando en v=164 llegaron los consumidores con `.has()`, `sources`
// llevaba ya nueve versiones aplanada a array y la vista murió entera. Si tocás
// la forma de cualquiera de las dos, es acá donde hay que decirlo.
//
// `stats` es el índice albumKey → {plays, ms}. Puede venir vacío (BYOH con un
// JSON v3, o usuario sin historial): en ese caso plays y min quedan en 0 y la
// ficha muestra "sin datos de escucha", que es honesto. Los `min_that_day` de
// listened-albums NO se usan como número de minutos: son los del primer día que
// el álbum cumplió el umbral, no el total, y sumarlos entre entradas no
// significa nada (eso era el "20m" de VULTURES 1).
function buildList(data, wthreeItems, stats) {
  const map = new Map();

  for (const y of (data?.years || [])) {
    const yn = Number(y.year) || null;
    for (const a of (y.albums || [])) {
      const k = albumKey(a.name, a.artist);
      const prev = map.get(k);
      if (prev) {
        if ((a.date || '') && (!prev.date || a.date < prev.date)) prev.date = a.date;
        if (!prev.img && a.img) prev.img = a.img;
        if (yn) prev.years.add(yn);
      } else {
        const t = stats?.get(k);
        map.set(k, {
          name: a.name || '',
          artist: a.artist || '',
          img: a.img || '',
          date: a.date || '',
          // Del índice, no del min_that_day. Una sola vez por clave: el índice
          // ya trae el total del álbum, sumarlo por cada año lo multiplicaría.
          plays: t?.plays || 0,
          min: t ? t.ms / 60000 : 0,
          years: new Set(yn ? [yn] : []),
          sources: new Set(['listened']),
        });
      }
    }
  }

  if (Array.isArray(wthreeItems)) {
    for (const it of wthreeItems) {
      const t = it?.item || it?.track;
      if (!t || !t.album) continue;
      if (isJunkTrack(t.name, t.artists?.[0]?.name)) continue;  // v=126
      const albumName = t.album.name || '';
      const artistName = t.artists?.[0]?.name || '';
      if (!albumName) continue;
      const k = albumKey(albumName, artistName);
      const wImg = coverUrl(t.album.images, 'grande') || '';
      const prev = map.get(k);
      if (prev) {
        prev.sources.add('wthree');
        if (!prev.img && wImg) prev.img = wImg;
      } else {
        const t = stats?.get(k);
        map.set(k, {
          name: albumName,
          artist: artistName,
          img: wImg,
          date: '',
          plays: t?.plays || 0,
          min: t ? t.ms / 60000 : 0,
          years: new Set(),
          sources: new Set(['wthree']),
        });
      }
    }
  }

  // ── 2.º pase de dedup: por TAPA ──────────────────────────────────────────
  //
  // v=127. La clave canónica compara nombre+artista, y eso deja pasar el caso
  // más visible del mosaico: el mismo álbum acreditado a artistas distintos.
  // El export del historial guarda como "artist" el principal del track que
  // sonó, así que un disco colaborativo entra varias veces:
  //   "$ome $exy $ongs 4 U" / Drake   +   "$ome $exy $ongs 4 U" / PARTYNEXTDOOR
  //   "POMPEII // UTILITY" / Earl Sweatshirt  +  … / MIKE
  //   "East of Underground" aparecía CUATRO veces con 4 artistas distintos.
  // También junta singles que reusan el arte del álbum y recopilatorios con la
  // misma portada.
  //
  // Para una vista que es literalmente un collage de imágenes, "misma tapa" ES
  // "misma celda": si el hash de la imagen coincide, el píxel resultante es
  // idéntico y el usuario lo lee como repetido. Por eso acá deduplicamos por
  // coverId y no por nombre — es la señal que se corresponde con lo que se ve.
  const byCover = new Map();
  const out = [];
  for (const a of map.values()) {
    const cid = coverId(a.img);
    const prev = cid ? byCover.get(cid) : null;
    if (prev) {
      // Nos quedamos con la escucha más antigua y sumamos plays, minutos y años.
      // Acá es donde se junta el disco colaborativo partido en dos claves
      // (VULTURES 1 como «¥$» y como «Kanye West»): 109+39 plays y 271+102 min.
      prev.plays += a.plays;
      prev.min += a.min;
      if (a.date && (!prev.date || a.date < prev.date)) prev.date = a.date;
      for (const y of a.years) prev.years.add(y);
      for (const s of a.sources) prev.sources.add(s);
      continue;
    }
    if (cid) byCover.set(cid, a);
    out.push(a);
  }

  // `years` SÍ se aplana a array, y hace falta: la línea del filtro por año usa
  // `a.years.some(...)` y el desplegable `flatMap(a => a.years)`, y `.some()` no
  // existe en `Set`.
  //
  // `sources` NO se aplana, y esto es un arreglo (2026-08-29). Se coló en esta
  // misma conversión en v=115 y el 27/08 (v=164) llegaron los dos consumidores
  // que hacen `a.sources.has('wthree')`: desde entonces la vista entera moría
  // con «a.sources.has is not a function» y no pintaba el mosaico nunca.
  // Los cuatro productores lo construyen como `Set`, el contrato de arriba dice
  // `Set`, los dos consumidores quieren `Set`, y esta lista no se serializa en
  // ningún momento — no hay motivo para aplanarla.
  return out.map(a => ({
    ...a,
    years: [...a.years].sort((x, y) => x - y),
  }));
}

// ── El índice coverId → familia de color (v=288) ────────────────────────────
//
// 🟩 **La unión es por `coverId` y no hace falta inventar ninguna clave.** La
// base del mosaico (`mosaico_colores_v1`) está indexada por `coverId` —los 24
// hex finales de la URL, o sea el hash de la imagen— y el 2.º pase de dedup de
// `buildList()` (más arriba) también dedupica por `coverId`. Son la misma
// clave, por los dos lados.
//
// 🟩 **Y por eso el filtro cuesta 0 peticiones para casi todo.** Medido el
// 09/10 contra los datos reales: de las **2.469** celdas que `#covers` saca del
// historial, **las 2.469 están en la base** — inclusión total comprobada, 0
// fuera. El catálogo del mosaico mete el `coverId` de TODAS las filas de
// `history-listened-albums.json` (2.475 únicos) y las 2.469 son un subconjunto.
//
// ⚠️ **Lo que la base NO cubre es «w three».** `armarCatalogo()` lo excluye a
// propósito (pedir esa playlist cuesta cuota), así que un álbum que sólo venga
// de ahí está en la base sólo si su tapa cae además en los me gusta. Esos se
// calculan al vuelo desde el CDN —0 cuota de Spotify— MIENTRAS la grilla ya se
// está dibujando, nunca antes.
//
// 🔴 **La regla que manda sobre todo lo demás** (decisión de Ian, 09/10): una
// tapa cuyo color no se conoce —porque no está en la base y el cálculo al vuelo
// falló— **sigue apareciendo en «Todos»**, en el cajón «Sin color». NUNCA
// desaparece de la vista. «Una tapa que se esfuma al filtrar es peor que una
// mal clasificada.» Por eso `familiaDeTapa()` devuelve `SIN_COLOR` y no
// `null`: no hay ningún camino en el que una celda se quede sin cajón.

/**
 * Lee la base de colores y devuelve `Map<coverId, familiaId>`. Si la base no
 * existe (un usuario que nunca la construyó en `#debug`), devuelve un mapa
 * vacío y la vista entera sigue andando: todas las tapas caen en «Sin color» y
 * el filtro se esconde. No es un error.
 */
async function leerIndiceDeColor() {
  const mapa = new Map();
  let reg = null;
  try { reg = await leerColores(); }
  catch (e) { console.warn('[covers] no pude leer la base de colores:', e.message); return { mapa, reg: null }; }
  if (!reg?.ids?.length || !reg.datos) return { mapa, reg: null };
  for (let i = 0; i < reg.ids.length; i++) {
    const off = i * BYTES_POR_PORTADA;
    if (off + BYTES_POR_PORTADA > reg.datos.length) break;   // base truncada
    // La media 1×1 de la rejilla 3×3, que es lo que Ian decidió usar el 09/10
    // para decidir la familia. La 3×3 no se toca.
    const [r, g, b] = mediaDeRejilla(reg.datos, off);
    mapa.set(reg.ids[i], familiaDeRgb(r, g, b));
  }
  return { mapa, reg };
}

// ── Hover-play sobre el mosaico (v=142) ─────────────────────────────────────
//
// Al parar el mouse sobre una tapa suena una pista al azar de ESE álbum que
// esté en los me gusta de Ian. El delay lo pone `hoverIn` (400 ms por defecto,
// ui/preview-player.js): sin eso, barrer el mosaico dispararía cien búsquedas.
// Salir de la celda cancela el timer y, si ya había arrancado, corta el audio.
//
// El índice de likes por álbum se arma una sola vez, en el primer hover, y no
// al entrar a la vista: el mosaico ya carga 2.400 tapas y no vale la pena
// competir con eso por nada.
//
// Convive con `lazy-img.js` sin tocarlo: `#covers` no lo usa (pinta las tapas
// con `loading="lazy"` nativo, ver `cellHtml`), y aunque lo usara, el hover
// solo lee `currentList` y reproduce audio — no toca `src` ni `data-src` de
// ninguna <img>, que es lo único que la evicción mira.
let likesPorAlbum = null;
let likesPorAlbumPromise = null;

function indexarLikes(items) {
  // Dos claves por track: el hash de la tapa (identidad real del disco, la
  // misma que dedupea el mosaico) y albumKey(nombre, artista) de respaldo para
  // los likes cuya tapa no coincide con la del historial.
  const idx = new Map();
  const push = (k, v) => {
    if (!k) return;
    const arr = idx.get(k);
    if (arr) { if (!arr.some(x => x.id === v.id)) arr.push(v); }
    else idx.set(k, [v]);
  };
  for (const it of (items || [])) {
    const t = it?.track || it;
    if (!t || !t.name || !t.album) continue;
    if (isJunkTrack(t.name, t.artists?.[0]?.name)) continue;
    const artistas = (t.artists || []).map(x => x.name).filter(Boolean);
    const entry = { id: t.id, name: t.name, artists: artistas };
    for (const im of (t.album.images || [])) push(coverId(im?.url), entry);
    push(`k:${albumKey(t.album.name || '', artistas[0] || '')}`, entry);
  }
  return idx;
}

function ensureLikesPorAlbum() {
  if (likesPorAlbum) return Promise.resolve(likesPorAlbum);
  if (likesPorAlbumPromise) return likesPorAlbumPromise;
  likesPorAlbumPromise = (async () => {
    let idx = new Map();
    try {
      const res = await getBestAvailableLikes();
      idx = indexarLikes(res?.items || []);
      console.info(`[covers] hover-play: ${idx.size} claves de álbum con likes`);
    } catch (e) {
      console.warn('[covers] hover-play: no pude cargar los likes:', e.message);
    }
    // Un índice vacío NO se memoiza: si la caché de likes todavía no estaba, el
    // hover quedaría mudo para toda la sesión aunque los likes lleguen un
    // segundo después (el mismo pozo que tapaba los corazones de W-Three).
    if (idx.size === 0) { likesPorAlbumPromise = null; return idx; }
    likesPorAlbum = idx;
    return idx;
  })();
  return likesPorAlbumPromise;
}

// Una pista al azar de ese álbum que esté en los likes, o null.
async function pistaAlAzarDelAlbum(a) {
  const idx = await ensureLikesPorAlbum();
  const cid = coverId(a.img);
  const cands = (cid && idx.get(cid)) || idx.get(`k:${albumKey(a.name, a.artist)}`) || null;
  if (!cands || !cands.length) return null;
  return cands[Math.floor(Math.random() * cands.length)];
}

function fitCellSize(N, W, H, gap = GRID_GAP) {
  if (!N || W <= 0 || H <= 0) return 96;
  const wPlus = W + gap;
  const hPlus = H + gap;
  for (let s = 200; s >= 8; s--) {
    const cols = Math.floor(wPlus / (s + gap));
    const rows = Math.floor(hPlus / (s + gap));
    if (cols > 0 && rows > 0 && cols * rows >= N) return s;
  }
  return 8;
}

// Toda celda que llega acá tiene tapa: las que no la tienen se filtran antes de
// renderizar (v=127), así que no hay más cuadro-con-inicial en el collage.
//
// v=181: `data-src` en vez de `src`. Antes esto pintaba TODAS las celdas de
// una (2.451 <img>) con las primeras ~120 en `fetchpriority=high` sin lazy y
// el resto en `loading="lazy"` nativo — y el nativo no se salva acá tampoco:
// con celdas de 28px caben cientos por fila y el margen de precarga de Chrome
// las toma a casi todas por "cerca del viewport" igual, así que dispara
// cientos de descargas y decodificaciones de golpe. Medido en la app real el
// 2026-09-01, con la pestaña visible y 2.451 tapas: **21,5 s hasta el primer
// frame interactivo** y **24,6 s hasta que el mosaico terminaba de pintar**.
// Ver ui/lazy-img.js: ahora solo se pide `src` a lo que entra en el
// `rootMargin` real (200px), y lo que se aleja se suelta.

// `data-full` guarda la original: si la variante chica no existiera, el handler
// de `error` reintenta con esta antes de sacar la celda. Ver más abajo — la
// regla es que una tapa que no carga sea un hueco, nunca una celda menos.
function cellHtml(a, i, lado) {
  const src = tapaParaCelda(a.img, lado);
  const full = src === a.img ? '' : ` data-full="${escapeHtml(a.img)}"`;
  return `<button type="button" class="cover-cell" data-i="${i}"><img class="cover-img" data-src="${escapeHtml(src)}"${full} alt="" decoding="async"></button>`;
}

export async function render(container) {
  migratePrefKey(LS_KEY_SIZE);
  migratePrefKey(LS_KEY_SORT);
  migratePrefKey(LS_KEY_YEARS);
  migratePrefKey(LS_KEY_COLORS);
  container.innerHTML = `
    ${pageHeader({ title: 'Mis tapas' })}
    <div id="covers-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;
  const content = document.getElementById('covers-content');
  // Ver util/vigencia-ruta.js: esta vista quedaba renderizando hasta 37 s
  // después de que el usuario se hubiera ido.
  const ruta = vigilarRuta();

  const propio = await isOwner();
  if (!ruta.vigente()) return;
  if (!propio) {
    content.innerHTML = ownerLockedMessage('Mis tapas');
    return;
  }

  let data;
  try { data = await loadListenedAlbums(); }
  catch (e) {
    if (!ruta.vigente()) return;
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">No pude cargar tus álbumes escuchados: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  if (!ruta.vigente()) return;

  let wthreeItems = null;
  let wthreeFallo = null;
  migratePrefKey(LS_WTHREE_ID);   // por si #covers se visita antes que #wthree
  const wthreeId = localStorage.getItem(prefKey(LS_WTHREE_ID));
  if (wthreeId) {
    try { wthreeItems = await getAllPlaylistItems(wthreeId); }
    catch (e) {
      // Se sigue con el historial solo —el mosaico vale igual—, pero el fallo
      // se GUARDA para decirlo en el rótulo. Comprobado el 2026-08-29 con la
      // API rate-limiteada: la vista pintaba 376 álbumes y el rótulo decía
      // «Álbumes dados por escuchados», sin una palabra de que faltaba W-Three.
      // Un número más chico y una leyenda que suena completa: exactamente el
      // tipo de degradación silenciosa que nos costó las 123.
      wthreeFallo = e.message;
      console.warn('[covers] no pude cargar W-Three:', e.message);
    }
    if (!ruta.vigente()) return;
  }

  // v=127: las celdas sin tapa mostraban un cuadro gris con la inicial y
  // ensuciaban el collage. Fuera del mosaico y fuera del contador — el número
  // que se muestra es el de tapas que se ven de verdad.
  const stats = await buildAlbumStatsIndex();
  if (!ruta.vigente()) return;
  const built = buildList(data, wthreeItems, stats);
  const noCover = built.filter(a => !a.img);
  const allAlbums = built.filter(a => a.img);
  if (noCover.length) {
    console.log(`[covers] ${noCover.length} álbumes sin tapa excluidos del mosaico:`,
      noCover.map(a => `${a.name} — ${a.artist}`).join(' | '));
  }
  if (!allAlbums.length) {
    content.innerHTML = `<div class="card"><p>Todavía no hay álbumes en tu historial. Importa el ZIP de Extended Streaming History desde la barra lateral.</p></div>`;
    return;
  }

  const yearsAvailable = [...new Set(allAlbums.flatMap(a => a.years))].sort((x, y) => x - y);

  let size = getSize();
  let sort = getSort();
  let yearsSel = getYearsSel();
  let colorsSel = getColorsSel();
  let fitEnabled = false;
  let isFullscreen = false;

  // El índice de color. Se lee UNA vez por render y es un `Map` en memoria:
  // ninguna celda vuelve a mirar la IndexedDB.
  const { mapa: colorPorTapa, reg: regColores } = await leerIndiceDeColor();
  if (!ruta.vigente()) return;
  // La familia de un álbum. `SIN_COLOR` es un cajón de verdad, no un error.
  const familiaDeTapa = (a) => colorPorTapa.get(coverId(a.img)) || SIN_COLOR;
  // Las que habrá que calcular al vuelo: tienen tapa y no están en la base.
  const sinColorAlEmpezar = allAlbums.filter(a => !colorPorTapa.has(coverId(a.img)));
  const hayBaseDeColor = !!regColores;

  // ── De dónde salen las tapas (v=164) ────────────────────────────────────────
  //
  // El rótulo decía «Historial de escuchas + playlist w three», y eso se leía
  // como si el mosaico juntase el historial ENTERO. No lo junta: la fuente son
  // los álbumes que el pipeline da por escuchados —los que superaron el umbral
  // de un mismo día— más la playlist «w three». El umbral sale del propio JSON
  // (`criteria`), no de un número escrito a mano acá, para que el rótulo no se
  // quede viejo si el pipeline cambia de criterio.
  const crit = data?.criteria || {};
  const umbral = (crit.min_tracks_sameday && crit.min_min_sameday)
    ? `${crit.min_tracks_sameday}+ canciones o ${crit.min_min_sameday}+ minutos el mismo día`
    : 'los que superaron el umbral de un mismo día';

  // v=183: los tres subconteos («N están en W-Three», «N solo ahí», «N sin
  // tapa») salían de `allAlbums`/`noCover` SIN filtrar, mientras el número
  // grande de arriba sí respeta el filtro de año (se actualiza en
  // `renderGrid` desde `currentList.length`). Con un filtro puesto podían
  // superar al total mostrado — por eso `buildSourcesLine` recibe la lista YA
  // filtrada y hay que llamarla de nuevo cada vez que cambia el filtro.
  function buildSourcesLine(albumsList, noCoverList) {
    const deWthree = albumsList.filter(a => a.sources.has('wthree')).length;
    const soloWthree = albumsList.filter(a => a.sources.has('wthree') && !a.sources.has('listened')).length;
    const sinTapa = noCoverList.length ? ` · ${noCoverList.length} sin tapa, fuera del mosaico` : '';
    const avisoWthree = wthreeFallo
      ? ` · <strong style="color:var(--color-warning)">falta W-Three: ${escapeHtml(wthreeFallo)}</strong>`
      : '';
    return wthreeItems
      ? `Álbumes dados por escuchados (${escapeHtml(umbral)}) y la playlist «w three» · ${deWthree} están en W-Three, ${soloWthree} solo ahí${sinTapa}`
      : `Álbumes dados por escuchados (${escapeHtml(umbral)})${sinTapa}${avisoWthree}`;
  }

  // El filtro de año SOLO, sin el de color: es la base sobre la que se cuentan
  // las pastillas de color, para que cada una diga cuántas tapas enseñaría si
  // la apretaras AHORA (con el año puesto). Si se contara sobre la lista ya
  // filtrada por color, apretar «rojos» dejaría todas las demás en 0.
  function albumsPorAnio() {
    if (yearsSel.size === 0) return allAlbums;
    return allAlbums.filter(a => a.years.some(y => yearsSel.has(y)));
  }

  function pasaColor(a) {
    return colorsSel.size === 0 || colorsSel.has(familiaDeTapa(a));
  }

  function albumsFiltered() {
    return albumsPorAnio().filter(pasaColor);
  }

  // Cuántas tapas caen en cada familia, con el filtro de AÑO aplicado.
  // Devuelve `Map<familiaId, n>` con una entrada por familia existente.
  function cuentasDeColor() {
    const c = new Map();
    for (const a of albumsPorAnio()) {
      const f = familiaDeTapa(a);
      c.set(f, (c.get(f) || 0) + 1);
    }
    return c;
  }

  // Las pastillas de color. ⚠️ Una familia con 0 tapas NO se pinta: una
  // pastilla que filtra a nada es una promesa vacía, y con el filtro de año
  // puesto eso pasa a cada rato (el 09/10, «aguas» tiene 26 tapas en total, así
  // que casi cualquier año la deja en cero). La de «Sin color» sale sólo si hay
  // alguna, y va al final porque no es una familia de color.
  //
  // 🔴 **PERO UNA FAMILIA ELEGIDA SE PINTA SIEMPRE, aunque tenga 0.** Esto se
  // rompió y se cazó probándolo el 09/10: la selección se guarda en el
  // localStorage, así que al volver a la vista puede apuntar a una familia que
  // ahora está vacía —porque cambió el filtro de año, o porque el cálculo al
  // vuelo resolvió las que estaban en «Sin color»—. Con la regla de «0 no se
  // pinta», esa pastilla desaparecía **con el filtro todavía puesto**: el
  // mosaico quedaba VACÍO y no había ninguna pastilla encendida que apretar
  // para salir. Es la versión total del defecto que el encargo prohíbe — no se
  // esfumaba una tapa, se esfumaban todas, y sin decir por qué.
  function pastillasDeColorHtml() {
    const c = cuentasDeColor();
    const total = albumsPorAnio().length;
    const una = (id, nombre, estilo, extra = '') => {
      const n = c.get(id) || 0;
      if (!n && !colorsSel.has(id)) return '';
      const on = colorsSel.has(id) ? ' is-on' : '';
      return `<button type="button" class="covers-chip covers-chip-color${on}${extra}" data-color="${id}"${estilo}
        aria-pressed="${colorsSel.has(id)}" title="${escapeHtml(nombre)}: ${n.toLocaleString('es-ES')} tapas">${escapeHtml(nombre)} <span class="covers-chip-n">${n.toLocaleString('es-ES')}</span></button>`;
    };
    const todas = `<button type="button" class="covers-chip${colorsSel.size === 0 ? ' is-on' : ''}" data-color="all"
      aria-pressed="${colorsSel.size === 0}">Todos <span class="covers-chip-n">${total.toLocaleString('es-ES')}</span></button>`;
    const familias = FAMILIAS
      // El color propio de la pastilla va inline y no en la hoja: son doce
      // valores que vienen del módulo, no del tema. Es la única excepción a la
      // regla de «sólo variables de tema» del repo, y es por definición — una
      // pastilla que filtra «rojos» tiene que ser roja en los cuatro presets.
      .map(f => una(f.id, f.nombre, ` style="--chip-bg:${f.color};--chip-fg:${f.texto}"`))
      .join('');
    return todas + familias + una(SIN_COLOR, SIN_COLOR_NOMBRE, '', ' covers-chip-sincolor');
  }

  function noCoverFiltered() {
    if (yearsSel.size === 0) return noCover;
    return noCover.filter(a => a.years.some(y => yearsSel.has(y)));
  }

  const sourcesLine = `<span class="covers-summary-sub" id="covers-summary-sub">${buildSourcesLine(albumsFiltered(), noCoverFiltered())}</span>`;

  content.innerHTML = `
    <div class="covers-narrow-hint">Vista pensada para pantalla grande — mejor en escritorio.</div>
    <div class="covers-toolbar">
      <div class="covers-summary">
        <span id="covers-count">${allAlbums.length.toLocaleString('es-ES')}</span> álbumes
        ${sourcesLine}
      </div>
      <div class="covers-controls">
        <div class="covers-control-group" aria-label="Vista">
          <button type="button" class="covers-btn covers-fit-btn" id="covers-fit" title="Calcular el lado para que entren todas las tapas sin scroll">Ajustar</button>
          <button type="button" class="covers-btn" id="covers-fullscreen" title="Ver el mosaico a pantalla completa" aria-label="Pantalla completa">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
        </div>
        <div class="covers-control-group" role="radiogroup" aria-label="Tamaño de tapa">
          <button type="button" class="covers-btn ${size === '28' ? 'is-on' : ''}" data-size="28">Mini</button>
          <button type="button" class="covers-btn ${size === '48' ? 'is-on' : ''}" data-size="48">Chico</button>
          <button type="button" class="covers-btn ${size === '64' ? 'is-on' : ''}" data-size="64">Medio</button>
          <button type="button" class="covers-btn ${size === '96' ? 'is-on' : ''}" data-size="96">Grande</button>
        </div>
        <div class="covers-control-group covers-select-wrap">
          <select class="covers-select" id="covers-sort" aria-label="Ordenar por">
            <option value="date-asc" ${sort === 'date-asc' ? 'selected' : ''}>Más antiguas primero</option>
            <option value="date-desc" ${sort === 'date-desc' ? 'selected' : ''}>Más nuevas primero</option>
            <option value="min-desc" ${sort === 'min-desc' ? 'selected' : ''}>Más minutos primero</option>
            <option value="artist-asc" ${sort === 'artist-asc' ? 'selected' : ''}>Artista (A–Z)</option>
          </select>
        </div>
        <!-- v=151: los dos fondos DESCARGAN un archivo, y estaban mezclados con
             los controles de tamaño y orden, que solo cambian lo que se ve. Van
             al final, en su propio grupo separado y con la palabra «Descargar»
             delante — la etiqueta la lee el usuario, no hace falta el title. -->
        <div class="covers-control-group covers-dl-group" role="group" aria-label="Descargar el mosaico como fondo de pantalla">
          <span class="covers-dl-label" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Descargar
          </span>
          <button type="button" class="covers-btn" id="covers-wall-escritorio" title="Descarga un archivo PNG de 3840×2160 para usar de fondo de escritorio">Fondo 16:9</button>
          <button type="button" class="covers-btn" id="covers-wall-movil" title="Descarga un archivo PNG de 1440×3120 para usar de fondo de móvil">Fondo móvil</button>
        </div>
      </div>
    </div>
    <div class="covers-year-chips" id="covers-year-chips" role="group" aria-label="Filtrar por año">
      <button type="button" class="covers-chip ${yearsSel.size === 0 ? 'is-on' : ''}" data-year="all">Todos</button>
      ${yearsAvailable.map(y => `<button type="button" class="covers-chip ${yearsSel.has(y) ? 'is-on' : ''}" data-year="${y}">${y}</button>`).join('')}
    </div>
    <!-- v=288: la segunda fila, por familia de color. Misma idea que la de
         año y se combina con ella (año Y color). Sale sólo si hay base de
         colores: sin ella todas caerían en «Sin color» y la fila no diría
         nada. La base se construye en #debug → «Base de colores del mosaico»,
         y no gasta cuota de Spotify. -->
    ${hayBaseDeColor ? `<div class="covers-year-chips covers-color-chips" id="covers-color-chips" role="group" aria-label="Filtrar por color de la portada">${pastillasDeColorHtml()}</div>` : ''}
    <p class="covers-vacio" id="covers-vacio" style="display:none" role="status"></p>
    <div class="covers-grid-wrap" id="covers-grid-wrap">
      <div class="covers-grid" id="covers-grid" data-size="${size}" style="--cover-min:${size}px;--cover-gap:${GRID_GAP}px"></div>
    </div>
    <!-- v=151: el título y el artista son botones de verdad. Ver el bloque de
         "tooltip clickeable" más abajo para por qué el tooltip deja de seguir
         al cursor. El role="tooltip" se va: esto ya no es un tooltip pasivo.
         (Sin acentos graves aquí adentro: esto vive en un template literal.) -->
    <div class="covers-tooltip" id="covers-tooltip" aria-hidden="true">
      <button type="button" class="ct-name ct-link" title="Abrir la ficha del álbum"></button>
      <button type="button" class="ct-artist ct-link" title="Abrir la ficha del artista"></button>
      <div class="ct-year"></div>
    </div>
  `;

  const gridWrap = document.getElementById('covers-grid-wrap');
  const grid = document.getElementById('covers-grid');
  const tooltip = document.getElementById('covers-tooltip');
  const countEl = document.getElementById('covers-count');
  const chipsEl = document.getElementById('covers-year-chips');
  const fitBtn = document.getElementById('covers-fit');
  const fsBtn = document.getElementById('covers-fullscreen');

  let currentList = filterAndSort();

  function filterAndSort() {
    // Los dos filtros se combinan con Y: año **y** color (v=288).
    return sortList(albumsFiltered(), sort);
  }

  // Lista incremental + tapas lazy (v=181), mismo patrón que #skips y
  // #sin-clasificar (ui/incremental-list.js + ui/lazy-img.js).
  //
  // Lo que había antes (v=127, "persiana"): un lote de 100 celdas por frame
  // con requestAnimationFrame, pero las 2.451 <img> se pintaban TODAS —
  // ~120 en `fetchpriority=high` sin lazy y el resto en `loading="lazy"`
  // nativo. El nativo no salva nada acá: con celdas de 28px caben cientos por
  // fila y el margen de precarga de Chrome toma a casi todas por "cerca del
  // viewport" igual. Medido en la app real el 2026-09-01, con la pestaña
  // visible y 2.451 tapas reales (no las 1.044 que muestra el rótulo con un
  // filtro de año puesto — ver la nota de arriba): **21,5 s hasta el primer
  // frame interactivo, 24,6 s hasta que el mosaico terminaba de pintar**.
  //
  // Ahora el DOM se arma incrementalmente igual que en las otras vistas
  // pesadas, y las tapas piden `src` solo cuando entran al `rootMargin` real
  // (200px) — lo que se aleja se suelta (ver ui/lazy-img.js). El fade
  // placeholder→imagen ya no hace falta cablearlo a mano: `.cover-img[src]`
  // se anima solo por CSS (`main.css`, `.cover-img[src]:not(.is-loaded)`).
  const BATCH = 200;
  let list = null;
  let lazyCovers = null;
  // Qué variante de tapa (64 o 300) está pintada ahora mismo en el DOM. Cambiar
  // de tamaño solo toca el CSS, así que el repintado hay que pedirlo a mano —
  // y solo cuando la variante cambia de verdad (ver `sincronizarVariante`).
  let variantePintada = null;

  function varianteDe(lado) {
    return (lado || 0) * (globalThis.devicePixelRatio || 1) <= 64 ? 64 : 300;
  }

  function renderGrid({ preserveRendered = false } = {}) {
    const t0 = performance.now();
    const total = currentList.length;
    countEl.textContent = total.toLocaleString('es-ES');
    variantePintada = varianteDe(Number(size) || 28);

    // Si los filtros no dejan nada, DECIRLO. Un mosaico vacío y sin una palabra
    // se lee como una vista rota —es lo que pasaba el 09/10 con una selección
    // guardada que había quedado sin tapas—, y la regla de este repo es que
    // ninguna vista degrada en silencio. El aviso nombra los dos filtros, que
    // es lo que hace falta para saber cuál aflojar.
    const vacio = document.getElementById('covers-vacio');
    if (vacio) {
      const hayFiltro = yearsSel.size > 0 || colorsSel.size > 0;
      vacio.style.display = (total === 0 && hayFiltro) ? '' : 'none';
      if (total === 0 && hayFiltro) {
        const porAnio = yearsSel.size > 0 ? `año (${[...yearsSel].sort().join(', ')})` : '';
        const porColor = colorsSel.size > 0
          ? `color (${[...colorsSel].map(id => (FAMILIAS.find(f => f.id === id)?.nombre) || SIN_COLOR_NOMBRE).join(', ')})`
          : '';
        vacio.textContent = `Ninguna tapa cumple el filtro de ${[porAnio, porColor].filter(Boolean).join(' y ')}. Pulsa «Todos» para quitarlo.`;
      }
    }

    if (!list) {
      lazyCovers = createLazyImages({ root: scrollRootOf(grid), rootMargin: '200px' });
      window.__coversPerf = { batches: [], t0, firstBatchMs: 0 };
      list = createIncrementalList({
        container: grid,
        items: currentList,
        // Lee `size` en cada celda, no una vez: así un cambio de tamaño no
        // obliga a reconfigurar la lista incremental.
        renderItem: (a, i) => cellHtml(a, i, Number(size) || 28),
        batchSize: BATCH,
        rootMargin: '600px',
        onBatch: ({ rendered, total: t, added, ms }) => {
          if (!window.__coversPerf.firstBatchMs) {
            window.__coversPerf.firstBatchMs = performance.now() - window.__coversPerf.t0;
          }
          window.__coversPerf.batches.push({ added, rendered, total: t, ms: +ms.toFixed(1) });
          const nuevas = grid.querySelectorAll('.cover-cell:not([data-obs])');
          nuevas.forEach(c => c.setAttribute('data-obs', '1'));
          lazyCovers.observe(nuevas);
        },
      });
    } else {
      // setItems repinta el grid entero: los <img> viejos dejan de existir y
      // el observer de tapas tiene que soltarlos antes de que lleguen los
      // nuevos (mismo orden que en #skips).
      lazyCovers.reset();
      window.__coversPerf = { batches: [], t0, firstBatchMs: 0 };
      list.setItems(currentList, { preserveRendered });
    }
  }

  // Se cambió el lado de la celda. Si la variante de tapa que corresponde sigue
  // siendo la misma (28→48→64 en una pantalla 1×, las tres de 64), no hay nada
  // que hacer y alcanza con el CSS.
  //
  // Cuando SÍ cambia, se actualiza cada <img> EN EL SITIO y no se repinta la
  // grilla: `setItems` destruye los nodos y los nuevos nacen sin `src`, o sea
  // mosaico gris hasta que bajan las 429 tapas del tamaño nuevo. Asignando el
  // `src` sobre la <img> que ya está, el navegador sigue mostrando la tapa
  // vieja hasta que decodifica la nueva — el cambio no se nota.
  function sincronizarVariante() {
    const v = varianteDe(Number(size) || 28);
    if (!list || v === variantePintada) return;
    variantePintada = v;
    const lado = Number(size) || 28;
    grid.querySelectorAll('.cover-cell').forEach(cell => {
      const a = currentList[Number(cell.dataset.i)];
      const img = cell.querySelector('img.cover-img');
      if (!a || !img) return;
      const nueva = tapaParaCelda(a.img, lado);
      if (nueva === a.img) delete img.dataset.full;
      else img.dataset.full = a.img;
      lazyCovers.cambiarFuente(img, nueva);
    });
  }

  renderGrid();

  // ── Los colores que faltan, calculados al vuelo (v=288) ───────────────────
  //
  // ⚠️ **Va DESPUÉS de `renderGrid()`, y eso es el requisito, no un detalle.**
  // El encargo lo pide así: «calculá al vuelo lo que falte mientras las tapas
  // ya se están dibujando». La grilla no espera a esto ni un frame; cuando
  // termina, las pastillas se repintan con los números nuevos.
  //
  // ⚠️ **0 peticiones a `api.spotify.com`**: sale del CDN de imágenes (ver
  // `coloresAlVuelo` en `features/mosaico-colores.js`). Y **no escribe en la
  // base**: es de usar y tirar.
  //
  // 🔴 Las que fallen se quedan en «Sin color» y **siguen apareciendo en
  // «Todos»**. No se esconde ninguna.
  const colorCtrl = new AbortController();
  if (hayBaseDeColor && sinColorAlEmpezar.length) {
    const pendientes = sinColorAlEmpezar.map(a => ({ id: coverId(a.img), url64: coverVariant(a.img, 64) }));
    // Sin `await`: la vista ya está pintada y esto la alcanza cuando termine.
    coloresAlVuelo(pendientes, {
      signal: colorCtrl.signal,
      onCada: ({ id, rejilla }) => {
        const [r, g, b] = mediaDeRejilla(rejilla, 0);
        colorPorTapa.set(id, familiaDeRgb(r, g, b));
      },
    }).then((res) => {
      if (!ruta.vigente() || colorCtrl.signal.aborted) return;
      console.log(`[covers] colores al vuelo: ${res.hechas} resueltas, ${res.fallidas} sin color, ${(res.bytes / 1024).toFixed(0)} KB del CDN en ${res.ms} ms`);
      repintarPastillasDeColor();
      // Si hay un filtro de color puesto, la lista cambia: las que acaban de
      // ganar color pueden entrar o salir. Se repinta sólo en ese caso, para no
      // mover el mosaico por debajo del cursor sin motivo.
      if (colorsSel.size > 0) {
        currentList = filterAndSort();
        renderGrid();
        if (fitEnabled) applyFit();
      }
    }).catch((e) => console.warn('[covers] los colores al vuelo fallaron:', e.message));
  }

  function applyFit() {
    const rect = grid.getBoundingClientRect();
    const W = Math.floor(rect.width);
    const H = Math.max(200, Math.floor(window.innerHeight - rect.top - 12));
    const N = currentList.length;
    const s = fitCellSize(N, W, H, GRID_GAP);
    size = String(s);
    grid.dataset.size = size;
    grid.style.setProperty('--cover-min', `${s}px`);
    content.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('is-on', b.dataset.size === size));
    fitBtn.classList.add('is-on');
    sincronizarVariante();
    console.log(`[covers] ajustar: N=${N} W=${W} H=${H} → lado=${s}px (cols=${Math.floor((W+GRID_GAP)/(s+GRID_GAP))} rows=${Math.ceil(N/Math.floor((W+GRID_GAP)/(s+GRID_GAP)))})`);
  }

  fitBtn.addEventListener('click', () => {
    fitEnabled = true;
    applyFit();
  });

  // ── Wallpaper del mosaico (v=145) ─────────────────────────────────────────
  //
  // Se dibuja `currentList`, o sea EXACTAMENTE lo que hay en pantalla: el orden
  // elegido en el select y los años que estén filtrados. El wallpaper es una
  // foto del mosaico, no otra lista.
  //
  // El progreso va al pill de la capa de abajo (`minimized: true`) y no al
  // overlay que tapa todo: generar el fondo tarda un rato largo y no hay razón
  // para bloquear la app mientras tanto. Un click en el pill lo expande, y ahí
  // está el «Detener carga» que aborta de verdad — el `signal` corta los fetch
  // en vuelo y el bucle se sale entre lote y lote sin dibujar nada más.
  const wallBtns = [
    document.getElementById('covers-wall-escritorio'),
    document.getElementById('covers-wall-movil'),
  ];
  let wallCtrl = null;

  async function descargarFondo(preset) {
    if (wallCtrl) return;                        // ya hay uno en curso
    const cfg = WALLPAPER_PRESETS[preset];
    const ctrl = new AbortController();
    wallCtrl = ctrl;
    wallBtns.forEach(b => { b.disabled = true; });
    const etiqueta = `Armando el fondo ${cfg.w}×${cfg.h}…`;
    showProgress(etiqueta, 0, currentList.length, { onCancel: () => ctrl.abort(), minimized: true });
    try {
      const r = await generarWallpaper({
        lista: currentList,
        preset,
        signal: ctrl.signal,
        onProgress: (hechas, total) => showProgress(etiqueta, hechas, total),
      });
      if (!r) { showToast('Fondo cancelado.', 'info'); return; }
      const nombre = `fonoteca-tapas-${r.archivo}.jpg`;
      descargarBlob(r.blob, nombre);
      const fallidas = r.fallidas ? ` · ${r.fallidas} tapas no cargaron` : '';
      showToast(
        `${nombre} — ${r.cols}×${r.filas} tapas de ${r.lado}px, ${(r.blob.size / 1048576).toFixed(1)} MB${fallidas}`,
        'success'
      );
    } catch (e) {
      if (ctrl.signal.aborted) showToast('Fondo cancelado.', 'info');
      else {
        console.error('[wallpaper]', e);
        showToast(`No pude generar el fondo: ${e.message}`, 'error');
      }
    } finally {
      hideProgress();
      wallCtrl = null;
      wallBtns.forEach(b => { b.disabled = false; });
    }
  }

  wallBtns[0].addEventListener('click', () => descargarFondo('escritorio'));
  wallBtns[1].addEventListener('click', () => descargarFondo('movil'));

  content.querySelectorAll('[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      fitEnabled = false;
      fitBtn.classList.remove('is-on');
      size = btn.dataset.size;
      setSize(size);
      grid.dataset.size = size;
      grid.style.setProperty('--cover-min', `${size}px`);
      content.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('is-on', b === btn));
      sincronizarVariante();
    });
  });

  document.getElementById('covers-sort').addEventListener('change', (e) => {
    sort = e.target.value;
    setSort(sort);
    currentList = filterAndSort();
    renderGrid();
    if (fitEnabled) applyFit();
  });

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.covers-chip');
    if (!chip) return;
    const y = chip.dataset.year;
    if (y === 'all') {
      yearsSel = new Set();
    } else {
      const n = Number(y);
      if (yearsSel.has(n)) yearsSel.delete(n);
      else yearsSel.add(n);
    }
    setYearsSel(yearsSel);
    chipsEl.querySelectorAll('.covers-chip').forEach(c => {
      const cy = c.dataset.year;
      const on = cy === 'all' ? yearsSel.size === 0 : yearsSel.has(Number(cy));
      c.classList.toggle('is-on', on);
    });
    currentList = filterAndSort();
    renderGrid();
    if (fitEnabled) applyFit();
    const subEl = document.getElementById('covers-summary-sub');
    if (subEl) subEl.innerHTML = buildSourcesLine(albumsFiltered(), noCoverFiltered());
    // ⚠️ Las cuentas de las pastillas de color dependen del año, así que hay
    // que repintarlas acá. Sin esto, cambiar de año dejaba los números de color
    // del año anterior: un número viejo con cara de número bueno.
    repintarPastillasDeColor();
  });

  // Repinta la fila de color entera (cuentas incluidas). Se llama al cambiar el
  // año y cuando el cálculo al vuelo descubre colores nuevos.
  function repintarPastillasDeColor() {
    const el = document.getElementById('covers-color-chips');
    if (el) el.innerHTML = pastillasDeColorHtml();
  }

  const colorChipsEl = document.getElementById('covers-color-chips');
  // Delegado en el contenedor, no un listener por pastilla: la fila se repinta
  // entera cada vez que cambia el año o entra un color nuevo, y un listener por
  // botón se perdería en cada repintado.
  colorChipsEl?.addEventListener('click', (e) => {
    const chip = e.target.closest('.covers-chip');
    if (!chip) return;
    const id = chip.dataset.color;
    if (id === 'all') colorsSel = new Set();
    else if (colorsSel.has(id)) colorsSel.delete(id);
    else colorsSel.add(id);
    setColorsSel(colorsSel);
    repintarPastillasDeColor();
    currentList = filterAndSort();
    renderGrid();
    if (fitEnabled) applyFit();
    const subEl = document.getElementById('covers-summary-sub');
    if (subEl) subEl.innerHTML = buildSourcesLine(albumsFiltered(), noCoverFiltered());
  });

  let resizeTimer = null;
  const onResize = () => {
    if (!fitEnabled) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyFit, 120);
  };
  window.addEventListener('resize', onResize);

  // ── Fullscreen API ──
  // Entra a fullscreen sobre el grid-wrap. body.covers-fs oculta sidebar,
  // header y toolbar por CSS. Al entrar/salir recalculamos el tamaño para
  // aprovechar el viewport nuevo.
  function enterFullscreen() {
    if (!document.fullscreenEnabled) {
      console.warn('[covers] fullscreen no disponible');
      return;
    }
    gridWrap.requestFullscreen?.().catch(err => console.warn('[covers] fs error:', err.message));
  }
  function exitFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
  }
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) exitFullscreen();
    else enterFullscreen();
  });
  const onFullscreenChange = () => {
    isFullscreen = document.fullscreenElement === gridWrap;
    document.body.classList.toggle('covers-fs', isFullscreen);
    fsBtn.classList.toggle('is-on', isFullscreen);
    // Recalculo el tamaño para el nuevo viewport. Si el user tenía fit activo,
    // lo mantiene; si no, ajusto al fullscreen y al salir vuelvo al size guardado.
    if (fitEnabled) {
      setTimeout(applyFit, 60);
    } else if (isFullscreen) {
      const savedSize = size;
      setTimeout(() => {
        applyFit();
        fitEnabled = false;
        fitBtn.classList.remove('is-on');
        // Marco el size en el que quedó (no lo persisto, solo visual).
        content.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('is-on', b.dataset.size === size));
      }, 60);
      // Guardo el original en el botón para restaurar
      fsBtn.dataset.origSize = savedSize;
    } else {
      // Salimos: vuelvo al size que tenía antes
      const orig = fsBtn.dataset.origSize;
      if (orig && VALID_SIZES.has(orig)) {
        size = orig;
        grid.dataset.size = size;
        grid.style.setProperty('--cover-min', `${size}px`);
        content.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('is-on', b.dataset.size === size));
        delete fsBtn.dataset.origSize;
      }
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.cover-cell');
    if (!btn) return;
    const idx = +btn.dataset.i;
    const a = currentList[idx];
    if (!a) return;
    // El tooltip es `position: fixed` con z-index propio: si no se cierra acá,
    // queda flotando ENCIMA de la ficha que se acaba de abrir.
    hideTooltip();
    openAlbumCard({ name: a.name, artist: a.artist, img: a.img, plays: a.plays, min: a.min });
  });

  // Fade placeholder → imagen apenas carga (delegado en el grid: con miles de
  // celdas no se cuelga un listener por <img>). Sin esto igual se ve — el CSS
  // trae un fallback de 520ms (`.cover-img[src]:not(.is-loaded)`) — pero el
  // 'load' real es instantáneo cuando la tapa viene del caché HTTP.
  grid.addEventListener('load', (e) => {
    if (e.target?.classList?.contains('cover-img')) e.target.classList.add('is-loaded');
  }, true);

  // Si una tapa 404ea, sacamos la celda entera en vez de poner el cuadro con la
  // inicial: Ian quiere el collage sin huecos con letras (v=127).
  //
  // v=193: antes de sacarla, UN reintento con la URL original. Desde que la
  // celda pide la variante del tamaño que necesita (`tapaParaCelda`), un fallo
  // puede querer decir «esa variante no existe» y no «este álbum no tiene
  // tapa» — el prefijo del CDN es una convención no documentada. Sin el
  // reintento, un cambio del lado de Spotify borraría álbumes del mosaico en
  // silencio, que es exactamente lo que no queremos que pase nunca.
  grid.addEventListener('error', (e) => {
    const img = e.target;
    if (!img?.classList?.contains('cover-img')) return;
    const full = img.dataset.full;
    if (full && img.src !== full) {
      delete img.dataset.full;
      img.src = full;
      return;
    }
    img.closest('.cover-cell')?.remove();
  }, true);

  // ── Tooltip clickeable (v=151) ──────────────────────────────────────────
  //
  // Pedido: click en el título abre la ficha del álbum y click en el artista la
  // del artista, sin ir a buscarlo a Spotify a mano.
  //
  // Para eso hubo que cambiar DOS cosas del tooltip, y las dos son
  // consecuencia de lo mismo — un elemento no se puede clickear si huye del
  // cursor:
  //
  //   1. Tenía `pointer-events: none`. Ahora los acepta.
  //   2. Seguía al cursor en CADA `pointermove`. Ahora la posición se congela
  //      al entrar en una celda y no se vuelve a tocar hasta que se cambia de
  //      celda, así que hay un objetivo quieto al que llegar.
  //
  // Y no se pelea con el click de la celda, que era el riesgo: el tooltip es
  // hermano del grid, no descendiente. El handler de arriba está en `grid`, así
  // que un click adentro del tooltip no le llega nunca por burbujeo. Lo único
  // que hacía falta era que el tooltip no se cerrara al salir de la celda hacia
  // él: de eso se ocupa `tooltipHot`.
  let currentIdx = -1;
  let tooltipHot = false;   // el puntero está ENCIMA del tooltip

  let hideTimer = null;

  const hideTooltip = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
    tooltip.classList.remove('is-on');
    tooltip.setAttribute('aria-hidden', 'true');
    currentIdx = -1;
    hoverOut();
  };

  // El cierre va con un margen de gracia CANCELABLE, y no es un adorno: al
  // pasar de la celda al tooltip, `pointerleave` del grid dispara ANTES que
  // `pointerenter` del tooltip. Sin este margen, el tooltip se cierra en el
  // milisegundo exacto en que el usuario va a clickearlo, y el clic cae sobre
  // la celda de abajo — o sea, justo la pelea que había que evitar.
  const GRACIA_MS = 120;
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!tooltipHot) hideTooltip(); }, GRACIA_MS);
  };

  tooltip.addEventListener('pointerenter', () => {
    tooltipHot = true;
    clearTimeout(hideTimer);
    hideTimer = null;
  });
  tooltip.addEventListener('pointerleave', () => {
    tooltipHot = false;
    // Salir del tooltip cierra, salvo que se vuelva a una celda: el
    // `pointermove` del grid lo reabre en el mismo gesto.
    scheduleHide();
  });

  tooltip.querySelector('.ct-name').addEventListener('click', () => {
    const a = currentList[currentIdx];
    if (!a) return;
    hideTooltip();
    openAlbumCard({ name: a.name, artist: a.artist, img: a.img, plays: a.plays, min: a.min });
  });
  tooltip.querySelector('.ct-artist').addEventListener('click', () => {
    const a = currentList[currentIdx];
    if (!a?.artist) return;
    hideTooltip();
    // `openArtistCard` normaliza el nombre por su cuenta (la guarda de v=150),
    // así que acá no hay que partir nada.
    openArtistCard({ name: a.artist });
  });

  grid.addEventListener('pointermove', (e) => {
    // Con el puntero sobre el tooltip no se recalcula nada: si no, moverse
    // hacia él lo reposicionaría y se escaparía justo al ir a clickearlo.
    if (tooltipHot) return;
    const btn = e.target.closest('.cover-cell');
    if (!btn) {
      if (currentIdx !== -1) scheduleHide();
      return;
    }
    const idx = +btn.dataset.i;
    if (idx === currentIdx) return;   // misma celda: la posición queda congelada
    currentIdx = idx;
      const a = currentList[idx];
      if (!a) return;
      // Hover-play: `hoverIn` ya trae el debounce y cancela el anterior cuando
      // cambia la key, así que pasar de una tapa a otra no encola dos previews.
      // El getter corre recién después del delay: mover el mouse por encima no
      // dispara ninguna búsqueda.
      hoverIn(`cov:${coverId(a.img) || albumKey(a.name, a.artist)}`, async () => {
        const pista = await pistaAlAzarDelAlbum(a);
        if (!pista) return null;
        // Sin spotifyId a propósito: el embed no puede autoarrancar en un
        // iframe cross-origin, así que como hover no sirve para nada. Si no
        // hay audio de iTunes ni de Deezer, el hover se queda callado.
        return await getPreview({ name: pista.name, artists: pista.artists });
      });
    tooltip.querySelector('.ct-name').textContent = a.name || '—';
    tooltip.querySelector('.ct-artist').textContent = a.artist || '';
    const year = (a.date || '').slice(0, 4);
    const yEl = tooltip.querySelector('.ct-year');
    yEl.textContent = year || '';
    yEl.style.display = year ? '' : 'none';
    tooltip.classList.add('is-on');
    tooltip.setAttribute('aria-hidden', 'false');

    // Se ancla a la CELDA, pegado a su borde — no al cursor y sin hueco.
    //
    // El motivo es que si no, no se puede clickear: puesto en `cursor + 14px`,
    // el gesto de ir hacia él pasa por las celdas de al lado, cada una
    // reposiciona el tooltip a `cursor + 14` otra vez y el objetivo huye
    // manteniendo siempre la misma distancia. Pegado al borde de la celda, en
    // cambio, salir de la celda hacia él es entrar en él: no hay ninguna celda
    // intermedia que cruzar, que es justo lo que rompía el gesto.
    const r = btn.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let x = r.right;
    let y = r.top;
    if (x + tw + 4 > window.innerWidth) x = r.left - tw;   // se voltea al otro lado
    if (y + th + 4 > window.innerHeight) y = window.innerHeight - th - 4;
    tooltip.style.left = Math.max(4, x) + 'px';
    tooltip.style.top = Math.max(4, y) + 'px';
  });
  grid.addEventListener('pointerleave', () => {
    // Salir del grid hacia el tooltip NO cierra: el tooltip está fuera del
    // grid, así que este evento dispara justo al ir a clickearlo.
    if (tooltipHot) return;
    scheduleHide();
  });

  return () => {
    if (list) { list.destroy(); list = null; }
    if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
    hoverOut();                    // timer de hover-play pendiente, si lo había
    // Irse de la vista aborta el wallpaper: si no, sigue bajando tapas y
    // dibujando contra un canvas que ya no le sirve a nadie.
    wallCtrl?.abort();
    // Y aborta los colores al vuelo: si no, sigue bajando miniaturas del CDN
    // para pintar unas pastillas que ya no están en pantalla.
    colorCtrl.abort();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.body.classList.remove('covers-fs');
    clearTimeout(resizeTimer);
    tooltip.remove();
    if (document.fullscreenElement === gridWrap) document.exitFullscreen?.().catch(() => {});
  };
}
