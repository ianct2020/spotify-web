// Los filtros de #discover-artists y #new-releases, como TOGGLES (v=152).
// Eran cinco; desde v=165 son SIETE (se sumaron «edicion», «repetido» y
// «sinescuchar») y el de singles compara por tema BASE, no por título exacto.
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

import { albumKey } from './album-key.js';
import { songKey, songKeysCandidatas, songKeyBase } from './song-identity.js';
import { baseDeEdicion } from './edition-suffix.js';
import { EP_MIN_TRACKS } from './release-size.js';
import { getSavedAlbums, getBestAvailableLikes, getAllPlaylistItems } from '../api.js';
import { getOwnPlaylists } from './playlist-add.js';
import { loadListenedAlbums } from '../features/history-data.js';
import { prefKey, migratePrefKey } from '../storage.js';

const LS_KEY = 'discover_filtros_v1';

// El orden es el de la topbar. `corto` es lo que se ve en el chip.
export const FILTROS = [
  {
    key: 'artista',
    corto: 'Solo del artista',
    ayuda: 'Descarta lanzamientos de OTRO artista que se llama igual. Hay dos ' +
           '«Steve Lacy» distintos en Spotify: el que escuchas y un saxofonista ' +
           'de jazz con 17 discos.',
  },
  {
    key: 'biblioteca',
    corto: 'Fuera los guardados',
    ayuda: 'Descarta los álbumes que ya tienes guardados en tu biblioteca, ' +
           'aunque todavía no los hayas puesto.',
  },
  {
    key: 'listened',
    corto: 'Fuera los escuchados',
    ayuda: 'Descarta los álbumes que figuran en tu historial de escuchas ' +
           '(el umbral de 4 pistas o 25 minutos en un mismo día).',
  },
  {
    key: 'edicion',
    corto: 'Fuera otra edición de uno tuyo',
    ayuda: 'Descarta el lanzamiento cuyo título es el de un álbum que ya ' +
           'escuchaste (o que ya tienes guardado) MÁS un agregado: Deluxe, ' +
           'Expanded, Bonus, Anniversary, Remastered, Complete Edition… y al ' +
           'revés. Es el mismo disco con otra tapa.',
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
           'álbum que escuchaste. Mismos temas, otro id: compara el tema BASE, ' +
           'sin el «(Remix)», el «Sped Up» ni el «feat.».',
  },
  {
    key: 'repetido',
    corto: 'Fuera el mismo tema repetido',
    ayuda: 'El mismo tema puede aparecer cuatro veces con cuatro títulos ' +
           'distintos (remix, sped up, edit…). Deja UNO: el lanzamiento más ' +
           'grande, y a igualdad de pistas, el más viejo.',
  },
  {
    key: 'sinescuchar',
    corto: 'Fuera los que ya guardaste',
    ayuda: 'Descarta lo que ya pusiste en la playlist «fonoteca · sin ' +
           'escuchar». Si lo guardaste ahí, ya lo tienes resuelto.',
  },
];

// La playlist donde «Guardar single» deja los lanzamientos cortos. El nombre
// está duplicado a propósito: importarlo de features/discover-common.js haría
// que este módulo —que es de util/— dependiera de una feature, y la
// dependencia ya va al revés.
export const PLAYLIST_SIN_ESCUCHAR = 'fonoteca · sin escuchar';

const TODOS_ON = Object.fromEntries(FILTROS.map(f => [f.key, true]));

export function loadFiltros() {
  migratePrefKey(LS_KEY);
  try {
    const raw = JSON.parse(localStorage.getItem(prefKey(LS_KEY)));
    if (raw && typeof raw === 'object') return { ...TODOS_ON, ...raw };
  } catch { /* corrupto: todos encendidos */ }
  return { ...TODOS_ON };
}

export function saveFiltros(estado) {
  try { localStorage.setItem(prefKey(LS_KEY), JSON.stringify(estado)); } catch { /* lleno */ }
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

// Hasta cuántas pistas puede tener un lanzamiento para que el criterio del tema
// repetido se le aplique.
//
// El criterio compara el NOMBRE del lanzamiento contra los temas que ya
// escuchaste, y eso da por sentado que el lanzamiento se llama como su pista.
// En un single suelto es casi siempre cierto; en un EP, no — un EP se llama
// como el EP.
//
// Era 2, y ese 2 es el que dejaba pasar «Timeless (Remix)» de The Weeknd
// (verificado en producción el 2026-08-28: el lanzamiento tiene **3 pistas**,
// no 1). El criterio lo reconocía —«timeless||the weeknd» estaba en el índice—
// y el tope lo frenaba antes de mirarlo. O sea que el filtro no estaba roto:
// estaba mirando para otro lado.
//
// Ahora el corte es el MISMO `EP_MIN_TRACKS` de util/release-size.js: menos de
// 4 pistas es un single suelto, 4 o más ya es un EP y se respeta. Un número
// menos que inventar, y coherente con los chips «Álbumes / EPs / Singles» de
// v=165 — lo que el chip llama single es exactamente lo que este criterio mira.
//
// La asimetría de los errores que decía la nota vieja SIGUE VALIENDO y es la
// que justifica que el tope exista: un falso positivo acá es SILENCIOSO —un
// lanzamiento que Ian nunca escuchó desaparece y nadie se entera— y un falso
// negativo es VISIBLE. Por eso el tope sube a 3 y no desaparece.
//
// Medido en producción el 2026-08-28 sobre los 1.097 que veía Ian: con el tope
// en 3, la clave BASE y el índice de temas ampliado se caen **30 más**,
// revisados uno por uno (Timeless (Remix), Nonsense (Remix), Happier Than Ever
// (Edit), skinny dipping (Acoustic)… todos temas que ya tiene).

// ── Contexto: lo que hay que traer una sola vez para poder filtrar ─────────
let ctxCache = null;

export function invalidateFilterContext() { ctxCache = null; }

/** La clave del álbum SIN su agregado de edición. Ver util/edition-suffix.js. */
export function claveBaseDeEdicion(nombre, artista) {
  return albumKey(baseDeEdicion(nombre), artista);
}

export async function buildFilterContext({ force = false } = {}) {
  if (ctxCache && !force) return ctxCache;

  const guardados = new Set();
  const escuchados = new Set();
  // Las mismas dos, pero con el título SIN el agregado de edición. Van
  // aparte y no sustituyen a las de arriba: así el criterio «edicion» solo
  // dispara cuando la clave exacta NO alcanzó, y su contador dice cuántos
  // descarta ÉL y no los otros dos.
  const basesTuyas = new Set();
  const temaEnAlbum = new Map();   // songKey → nombre del álbum donde ya salió
  const enSinEscuchar = new Set(); // claves de álbum y de tema ya guardados

  // 1) Biblioteca de álbumes guardados.
  try {
    for (const it of await getSavedAlbums()) {
      const alb = it?.album;
      if (!alb?.name) continue;
      const art = alb.artists?.[0]?.name || '';
      guardados.add(albumKey(alb.name, art));
      basesTuyas.add(claveBaseDeEdicion(alb.name, art));
    }
  } catch (e) {
    console.warn('[discover-filtros] no pude leer tu biblioteca de álbumes:', e.message);
  }

  // 2) history-listened-albums.json.
  try {
    const data = await loadListenedAlbums();
    for (const y of (data?.years || [])) {
      for (const al of (y.albums || [])) {
        escuchados.add(albumKey(al.name, al.artist));
        basesTuyas.add(claveBaseDeEdicion(al.name, al.artist));
      }
    }
  } catch { /* sin historial: el criterio no descarta nada */ }

  // 3) Temas que ya salieron dentro de un álbum escuchado. Sale de los likes,
  //    que traen el álbum de cada canción: es local y gratis. Pedirle a Spotify
  //    el tracklist de cada candidato serían cientos de llamadas.
  //
  //    ⚠️ Hasta v=164 solo se indexaban los likes cuyo álbum estaba en
  //    `escuchados`, o sea en `history-listened-albums.json`, que es un SUBSET
  //    por umbral (4 pistas o 25 min el mismo día) y que además **termina donde
  //    termina el export**. Los temas de 2025 y 2026 —justo los que tienen
  //    remixes dando vueltas— no estaban ahí, así que «Timeless (Remix)» no
  //    tenía contra qué cruzarse. Ahora también entra el like que vive en un
  //    álbum de verdad (≥ 4 pistas): un tema likeado ES un tema conocido, y el
  //    álbum largo es lo que distingue «salió dentro de un álbum» de «salió
  //    como single».
  try {
    const res = await getBestAvailableLikes();
    for (const it of (res?.items || [])) {
      const t = it?.track;
      const alb = t?.album?.name;
      const art = t?.artists?.[0]?.name;
      if (!t?.name || !alb || !art) continue;
      const esAlbumLargo = (t.album?.total_tracks || 0) >= EP_MIN_TRACKS;
      if (!escuchados.has(albumKey(alb, art)) && !esAlbumLargo) continue;
      temaEnAlbum.set(songKey(t.name, art), alb);
    }
  } catch { /* sin likes: el criterio no descarta nada */ }

  // 4) La playlist «fonoteca · sin escuchar». Lo que Ian guardó ahí ya está
  //    resuelto: no tiene que volver a ofrecérsele. Se indexa por álbum Y por
  //    tema, porque ahí adentro hay PISTAS: de un single de una pista la clave
  //    útil es la del tema, y del EP guardado entero, la del álbum.
  try {
    const propias = await getOwnPlaylists();
    const pl = propias.find(p => (p.name || '').trim() === PLAYLIST_SIN_ESCUCHAR);
    if (pl) {
      const items = await getAllPlaylistItems(pl.id);
      for (const it of (items || [])) {
        const t = it?.item || it?.track || it;
        const art = t?.artists?.[0]?.name;
        if (!t?.name || !art) continue;
        enSinEscuchar.add(songKey(t.name, art));
        const alb = t.album?.name;
        if (alb) {
          enSinEscuchar.add(albumKey(alb, art));
          enSinEscuchar.add(claveBaseDeEdicion(alb, art));
        }
      }
    }
  } catch (e) {
    console.warn('[discover-filtros] no pude leer «' + PLAYLIST_SIN_ESCUCHAR + '»:', e.message);
  }

  ctxCache = { guardados, escuchados, basesTuyas, temaEnAlbum, enSinEscuchar };
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

  // C4 — el MISMO álbum con un agregado en el título (v=165).
  //
  // Solo cuando la clave exacta no alcanzó: si ya cayó por «biblioteca» o por
  // «listened», este criterio no tiene nada que aportar y sumarlo dos veces
  // ensuciaría los contadores. Ver util/edition-suffix.js: el agregado se saca
  // con una lista explícita, no aflojando `albumKey`.
  const kBase = claveBaseDeEdicion(al.name, artista);
  if (!out.includes('biblioteca') && !out.includes('listened') && ctx.basesTuyas?.has(kBase)) {
    out.push('edicion');
  }

  // C5 — edición en vivo o de aniversario (los deluxe se quedan).
  if (esEnVivoOAniversario(al.name)) out.push('vivo');

  // C6 — single corto cuyo tema ya salió dentro de un álbum escuchado.
  //
  // El cruce va por el tema BASE, no por el título: «Timeless (Remix)»,
  // «Timeless - DEVAULT Remix» y «Timeless Sped Up» tienen que dar todos con
  // «Timeless». De eso se ocupa `songKeysCandidatas` (util/song-identity.js).
  if (al.type === 'single' && (al.total || 1) < EP_MIN_TRACKS
      && songKeysCandidatas(al.name, artista).some(k => ctx.temaEnAlbum.has(k))) {
    out.push('single');
  }

  // C7 — ya está en la playlist «fonoteca · sin escuchar».
  if (ctx.enSinEscuchar?.size) {
    const enPl = ctx.enSinEscuchar.has(albumKey(al.name, artista))
      || ctx.enSinEscuchar.has(kBase)
      || songKeysCandidatas(al.name, artista).some(k => ctx.enSinEscuchar.has(k));
    if (enPl) out.push('sinescuchar');
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
  let visibles = [];
  for (const it of items) {
    const motivos = motivosDeDescarte(it.al, it.artista, it.artistaId, ctx);
    for (const m of motivos) conteos[m]++;
    if (!motivos.some(m => estado[m])) visibles.push(it);
  }
  // El dedupe va AL FINAL y sobre lo que sobrevivió: es el único criterio que
  // no mira un lanzamiento sino la lista entera, así que aplicarlo antes le
  // haría elegir representante entre candidatos que después se caen igual.
  const { unicos, repetidos } = dedupPorTema(visibles);
  conteos.repetido = repetidos;
  if (estado.repetido) visibles = unicos;
  return { visibles, conteos };
}

/**
 * El mismo tema, cuatro veces, con cuatro títulos distintos (v=165).
 *
 * Agrupa por identidad de tema —`songKeyBase`, que incluye el artista, así que
 * dos artistas distintos nunca se fusionan— y deja un representante por grupo.
 *
 * ⚠️ **El representante es el lanzamiento MÁS GRANDE**, no el primero de la
 * lista. Un álbum y un single pueden compartir título («Hurry Up Tomorrow» el
 * disco y «Hurry Up Tomorrow» el adelanto): quedarse con el que tiene más
 * pistas garantiza que nunca se pierda el disco por culpa de su propio single.
 * A igualdad de pistas gana el más viejo, que es el criterio que ya usa
 * `dedupDisco` para las ediciones.
 *
 * @returns {{unicos: Array, repetidos: number}}
 */
export function dedupPorTema(items) {
  const porTema = new Map();
  for (const it of items) {
    const k = songKeyBase(it.al?.name || '', it.artista || '');
    if (!k || k.startsWith('||')) { porTema.set(Symbol('sin-clave'), it); continue; }
    const prev = porTema.get(k);
    if (!prev) { porTema.set(k, it); continue; }
    if (mejorRepresentante(it.al, prev.al)) porTema.set(k, it);
  }
  const unicos = [...porTema.values()];
  return { unicos, repetidos: items.length - unicos.length };
}

// ¿`a` representa mejor al tema que `b`? Más pistas primero; a igualdad, el
// release más viejo.
function mejorRepresentante(a, b) {
  const ta = Number(a?.total) || 0;
  const tb = Number(b?.total) || 0;
  if (ta !== tb) return ta > tb;
  const ra = String(a?.release || '9999');
  const rb = String(b?.release || '9999');
  return ra < rb;
}
