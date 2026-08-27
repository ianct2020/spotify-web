// Los cinco filtros de #discover-artists y #new-releases, como TOGGLES (v=152).
//
// Por qué toggles y no filtros fijos: cada criterio recorta la lista por un
// motivo distinto, y sin verlos por separado es imposible saber cuál te está
// escondiendo algo. Es el mismo patrón que los tres toggles del veredicto de
// «Skips crónicos» (v=146): la app muestra el dato y el criterio, y el que
// decide es Ian.
//
// ⚠️ **Todos se aplican al PINTAR, no al traer.** Es deliberado: tocar un
// toggle tiene que repintar la lista sin volver a llamar a Spotify ni tirar
// ningún caché. Por eso el filtro por identidad de artista NO vive en
// `api.js` (donde se podría filtrar al descargar): ahí los álbumes ajenos
// entrarían igual al caché de IDB y apagar el toggle no los traería de vuelta.
//
// ⚠️ **Ninguno de estos criterios afloja el matching de nombres.** El de
// ediciones en vivo va con una LISTA EXPLÍCITA de sufijos sobre el título.
// Normalizar más agresivamente `albumKey` fusionaría American Football LP3/LP4,
// Crystal Castles I/II y Ed Sheeran ÷ vs =, que ya costó caro dos veces.

import { albumKey } from './album-key.js?v=162';
import { songKey } from './song-identity.js?v=162';
import { getSavedAlbums, getBestAvailableLikes } from '../api.js?v=162';
import { loadListenedAlbums } from '../features/history-data.js?v=162';

const LS_KEY = 'discover_filtros_v1';

// El orden es el de la topbar. `corto` es lo que se ve en el chip.
export const FILTROS = [
  {
    key: 'artista',
    corto: 'Solo del artista',
    ayuda: 'Descarta lanzamientos de OTRO artista que se llama igual. Hay dos ' +
           '«Steve Lacy» distintos en Spotify: el que escuchás y un saxofonista ' +
           'de jazz con 17 discos.',
  },
  {
    key: 'biblioteca',
    corto: 'Fuera los guardados',
    ayuda: 'Descarta los álbumes que ya tenés guardados en tu biblioteca, ' +
           'aunque todavía no los hayas puesto.',
  },
  {
    key: 'listened',
    corto: 'Fuera los escuchados',
    ayuda: 'Descarta los álbumes que figuran en tu historial de escuchas ' +
           '(el umbral de 4 pistas o 25 minutos en un mismo día).',
  },
  {
    key: 'vivo',
    corto: 'Fuera vivo y aniversario',
    ayuda: 'Descarta ediciones en directo y de aniversario. Los DELUXE se ' +
           'quedan: traen pistas nuevas.',
  },
  {
    key: 'single',
    corto: 'Fuera singles ya en un álbum',
    ayuda: 'Descarta el single de 1 o 2 pistas cuyo tema ya salió dentro de un ' +
           'álbum que escuchaste. Mismos temas, otro id.',
  },
];

const TODOS_ON = Object.fromEntries(FILTROS.map(f => [f.key, true]));

export function loadFiltros() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY));
    if (raw && typeof raw === 'object') return { ...TODOS_ON, ...raw };
  } catch { /* corrupto: todos encendidos */ }
  return { ...TODOS_ON };
}

export function saveFiltros(estado) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(estado)); } catch { /* lleno */ }
}

// ── Los sufijos de edición ─────────────────────────────────────────────────
//
// `EN_VIVO` se aplica al TÍTULO del lanzamiento, nunca a la clave canónica.
// `GANA_DELUXE` tiene prioridad y no es un detalle: Ariana Grande publicó
// «eternal sunshine (slightly deluxe and also live)», que dice «live» y es
// justamente un deluxe con pistas nuevas. Sin esta guarda se perdía.
const EN_VIVO = /\b(anniversary|aniversario|live|en vivo|en directo|unplugged|in concert|tour edition)\b/i;
const GANA_DELUXE = /\b(deluxe|expanded|bonus)\b/i;

export function esEnVivoOAniversario(nombre) {
  const s = String(nombre || '');
  if (GANA_DELUXE.test(s)) return false;
  return EN_VIVO.test(s);
}

// Cuántas pistas tiene que tener como mucho un single para que el criterio del
// tema repetido se le aplique.
//
// El criterio compara el NOMBRE del lanzamiento contra los temas que ya
// escuchaste, y eso da por sentado que el single se llama como su pista. En un
// single de 1 o 2 pistas es casi siempre cierto; en uno largo, no. Medido el
// 2026-08-22: sin el tope se descartan 181 singles, con el tope 163.
//
// Los 18 de diferencia se dejan pasar A PROPÓSITO, y el motivo es la asimetría
// de los errores: un falso positivo acá es SILENCIOSO —un lanzamiento que Ian
// nunca escuchó desaparece y nadie se entera—, y un falso negativo es VISIBLE
// —aparece un single de más y se oculta con un click—. Cuando un error se ve y
// el otro no, se elige el que se ve.
const MAX_PISTAS_SINGLE = 2;

// ── Contexto: lo que hay que traer una sola vez para poder filtrar ─────────
let ctxCache = null;

export function invalidateFilterContext() { ctxCache = null; }

export async function buildFilterContext({ force = false } = {}) {
  if (ctxCache && !force) return ctxCache;

  const guardados = new Set();
  const escuchados = new Set();
  const temaEnAlbum = new Map();   // songKey → nombre del álbum donde ya salió

  // 1) Biblioteca de álbumes guardados.
  try {
    for (const it of await getSavedAlbums()) {
      const alb = it?.album;
      if (alb?.name) guardados.add(albumKey(alb.name, alb.artists?.[0]?.name || ''));
    }
  } catch (e) {
    console.warn('[discover-filtros] no pude leer tu biblioteca de álbumes:', e.message);
  }

  // 2) history-listened-albums.json.
  try {
    const data = await loadListenedAlbums();
    for (const y of (data?.years || [])) {
      for (const al of (y.albums || [])) escuchados.add(albumKey(al.name, al.artist));
    }
  } catch { /* sin historial: el criterio no descarta nada */ }

  // 3) Temas que ya salieron dentro de un álbum escuchado. Sale de los likes,
  //    que traen el álbum de cada canción: es local y gratis. Pedirle a Spotify
  //    el tracklist de cada candidato serían cientos de llamadas.
  try {
    const res = await getBestAvailableLikes();
    for (const it of (res?.items || [])) {
      const t = it?.track;
      const alb = t?.album?.name;
      const art = t?.artists?.[0]?.name;
      if (!t?.name || !alb || !art) continue;
      const k = albumKey(alb, art);
      if (!escuchados.has(k)) continue;
      temaEnAlbum.set(songKey(t.name, art), alb);
    }
  } catch { /* sin likes: el criterio no descarta nada */ }

  ctxCache = { guardados, escuchados, temaEnAlbum };
  return ctxCache;
}

/**
 * ¿Por qué motivos se descarta este lanzamiento? Devuelve las claves de los
 * criterios que lo rechazan — TODAS, no la primera: los contadores de la
 * topbar cuentan por criterio, así que un álbum que cae por dos motivos suma
 * en los dos.
 *
 * @param {object} al        álbum slim (name, type, total, artists[])
 * @param {string} artista   nombre del artista pedido
 * @param {string} artistaId su id de Spotify
 * @param {object} ctx       de buildFilterContext()
 */
export function motivosDeDescarte(al, artista, artistaId, ctx) {
  const out = [];
  if (!al) return out;

  // C1 — identidad del artista.
  //
  // La regla: **si el lanzamiento trae ids de artista, decide el id y punto**.
  // El nombre solo entra cuando no hay ningún id.
  //
  // El bug que arregla (medido el 2026-08-22): el filtro de api.js era
  // `id === artistId || artistIsSame(nombre)`, un OR. Con dos artistas
  // llamados EXACTAMENTE «Steve Lacy», el id no coincidía pero el nombre sí,
  // y el OR metía los 17 discos del saxofonista de jazz. `artistIsSame` no
  // estaba fallando: los nombres son idénticos. Lo que estaba mal era el OR.
  const artistas = al.artists || [];
  const hayIds = artistas.some(a => !!a.id);
  if (hayIds && artistaId && !artistas.some(a => a.id === artistaId)) out.push('artista');

  const k = albumKey(al.name, artista);

  // C2 — ya está guardado en la biblioteca.
  if (ctx.guardados.has(k)) out.push('biblioteca');

  // C3 — ya figura en el historial de escuchas.
  if (ctx.escuchados.has(k)) out.push('listened');

  // C4 — edición en vivo o de aniversario (los deluxe se quedan).
  if (esEnVivoOAniversario(al.name)) out.push('vivo');

  // C5 — single corto cuyo tema ya salió dentro de un álbum escuchado.
  if (al.type === 'single' && (al.total || 1) <= MAX_PISTAS_SINGLE
      && ctx.temaEnAlbum.has(songKey(al.name, artista))) {
    out.push('single');
  }

  return out;
}

/**
 * Aplica los filtros encendidos a una lista de candidatos.
 *
 * @param {Array<{al:object, artista:string, artistaId:string}>} items
 * @returns {{visibles: Array, conteos: Object}} `conteos[key]` = cuántos
 *          descarta ESE criterio por su cuenta, esté encendido o no. Se cuenta
 *          siempre para poder mostrar el número al lado del toggle apagado.
 */
export function applyDiscoverFilters(items, ctx, estado) {
  const conteos = Object.fromEntries(FILTROS.map(f => [f.key, 0]));
  const visibles = [];
  for (const it of items) {
    const motivos = motivosDeDescarte(it.al, it.artista, it.artistaId, ctx);
    for (const m of motivos) conteos[m]++;
    if (!motivos.some(m => estado[m])) visibles.push(it);
  }
  return { visibles, conteos };
}
