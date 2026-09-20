// Lógica común entre #discover-artists ("Sin escuchar de tus artistas") y
// #new-releases ("Novedades de tus artistas"). Ambas features:
//   - toman los artistas top de tus likes
//   - traen la discografía completa vía Spotify API (cacheada 30d en IDB)
//   - la cruzan con el índice unificado de álbumes escuchados
//     (util/album-heard.js: historial completo + likes + listened + w-three)
//   - permiten "+ Biblioteca" y "Crear playlist con lo elegido"

import { idbGet, idbGetCached, idbSetCached, idbDel, idbEntriesByPrefix } from '../idb.js';
import { getArtistAlbumsConFuente, buscarDiscografiaPorNombre, searchArtistByName, getAlbumTracks, saveToLibrary, saveAlbumsToLibrary, createPlaylist, addTracksToPlaylist } from '../api.js';
import { albumKey } from '../util/album-key.js';
import { cardKey, cardKeyLegacy, albumCreditName, keyOfPlaylistTrack } from '../util/discover-key.js';
import { escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';
import { openPlaylistPicker } from '../ui/playlist-picker.js';
import { getOwnPlaylists, addUrisToPlaylists, toastAddResult } from '../util/playlist-add.js';
import { openArtistCard } from './artist-card.js';
import { openAlbumCard } from './album-card.js';
import { createHiddenStore, createLocalStore } from '../util/hidden-sync.js';
import { recuperarUriDeAlbumKey } from '../util/hidden-recover.js';
import { getPreview } from '../api/preview-providers.js';
import { togglePreview, playingKey, attachHover } from '../ui/preview-player.js';
import { coverUrl } from '../util/cover-size.js';
import { FILTROS as FILTROS_DEF, saveFiltros } from '../util/discover-filters.js';
import { esEPoAlbum } from '../util/release-size.js';
import {
  DISCO_BASE_PREFIX, PRESUPUESTO_REFRESCO, RECIENTE_MAX_PAGINAS,
  crearBase, sumarCompleta, sumarReciente, tocaReciente, rangoReciente,
  fusionarBases, armarExportacion, leerImportacion,
} from '../util/disco-base.js';

const DISCO_TTL_MIN = 30 * 24 * 60;       // 30 días
const ARTIST_ID_TTL_MIN = 60 * 24 * 60;   // 60 días — los ids no cambian

export async function getArtistIdCached(nameLower, displayName, seedId) {
  const key = `discover_artist_id_${nameLower}`;
  if (seedId) {
    try { await idbSetCached(key, seedId, ARTIST_ID_TTL_MIN); } catch { /* ignora */ }
    return seedId;
  }
  try {
    const cached = await idbGetCached(key);
    if (cached) return cached;
  } catch { /* ignora */ }
  const found = await searchArtistByName(displayName);
  if (!found?.id) return null;
  try { await idbSetCached(key, found.id, ARTIST_ID_TTL_MIN); } catch { /* ignora */ }
  return found.id;
}

// ── La discografía de un artista: base permanente (v=229) ──────────────────
//
// Hasta v=228 vivía en `discover_artist_disco_v2_{id}` con 30 días de TTL, y
// `idbGetCached` la borraba al leerla vencida: lo conseguido se volvía a pagar
// cada mes con una cuota de 100 requests. Desde v=229 vive en
// `discover_disco_base_v1_{id}` SIN caducidad, como UNIÓN por id de todo lo
// visto (ver `util/disco-base.js`), y lo reciente se mira aparte con un
// `/search` `year:` cada 30 días.
//
// La clave es COMPARTIDA por #new-releases y #discover-artists, igual que la
// vieja: esta función es la única puerta de las dos.
//
// `ronda` (de `nuevaRondaDeRefresco`) decide si se mira lo reciente y con qué
// presupuesto. Sin ronda no se refresca nada: se sirve la base.

const DISCO_V2_PREFIX = 'discover_artist_disco_v2_';

function slimDe(al) {
  return {
    id: al.id,
    name: al.name,
    type: al.album_type,          // 'album' | 'single' | 'compilation'
    img: coverUrl(al.images, 'grande'),
    release: al.release_date || '',
    total: al.total_tracks || 0,
    artists: (al.artists || []).map(a => ({ id: a.id, name: a.name })),
  };
}

async function leerBase(artistId) {
  try {
    const w = await idbGet(`${DISCO_BASE_PREFIX}${artistId}`);
    const b = w?.value;
    return b && Array.isArray(b.items) ? b : null;
  } catch { return null; }
}

async function guardarBase(artistId, base) {
  // `ttl` null = sin caducidad (idb.js).
  await idbSetCached(`${DISCO_BASE_PREFIX}${artistId}`, base, null);
  _estadoDisco.set(artistId, { fuente: base.fuente, cortada: !!base.cortada, estimada: !!base.estimada });
}

/**
 * Una ronda de escaneo: cuánto puede gastar en mirar lo reciente. Cada vista
 * crea una por escaneo; «Actualizar» la crea con `forzar`.
 */
export function nuevaRondaDeRefresco({ forzar = false } = {}) {
  return {
    forzar,
    presupuesto: PRESUPUESTO_REFRESCO,
    gastado: 0,
    refrescados: 0,
    nuevos: 0,
    pendientes: 0,      // les tocaba y no entraron en el presupuesto
    fallos: 0,
    parada: null,       // motivo si se dejó de refrescar en esta ronda (p. ej. 429)
  };
}

async function refrescarReciente(artistId, artistName, base, ronda) {
  if (!ronda || !tocaReciente(base, { forzar: ronda.forzar })) return base;
  if (ronda.parada || ronda.gastado >= ronda.presupuesto) { ronda.pendientes++; return base; }
  const year = rangoReciente(base);
  try {
    const r = await buscarDiscografiaPorNombre(artistId, artistName, { year, maxPages: RECIENTE_MAX_PAGINAS });
    ronda.gastado += r.paginas || 1;
    const nueva = sumarReciente(base, r.items.map(slimDe), { year });
    const agregados = nueva.items.length - base.items.length;
    ronda.refrescados++;
    ronda.nuevos += agregados;
    await guardarBase(artistId, nueva);
    return nueva;
  } catch (e) {
    ronda.fallos++;
    ronda.gastado++;
    // Un 429 de /search es la cuota de TODA la app: se deja de refrescar en
    // esta ronda. La base se sigue sirviendo igual — nada se pierde.
    if (e.status === 429 || /rate limit/i.test(e.message)) ronda.parada = `Spotify limitó la búsqueda (${e.message})`;
    console.info(`[disco-base] no se pudo mirar lo reciente de «${artistName}»: ${e.message}`);
    return base;
  }
}

export async function getArtistDiscoCached(artistId, artistName, ronda = null) {
  await migrarDiscografiasViejas();
  let base = await leerBase(artistId);
  if (base) {
    base = await refrescarReciente(artistId, artistName, base, ronda);
    return base.items;
  }
  // Sin base: la discografía entera, como siempre. Sin limit explícito: api.js
  // sabe cuál es el máximo que acepta Spotify hoy (10 desde 2026-08-11) y
  // pagina hasta el final igual.
  const { items, fuente, cortada } = await getArtistAlbumsConFuente(artistId, artistName, { includeSingles: true });
  const slim = items.map(slimDe);
  // Una discografía VACÍA no se guarda (la v1 guardó vacías 30 días cuando el
  // endpoint fallaba y se siguieron sirviendo con el fetch ya arreglado).
  if (slim.length) {
    try { await guardarBase(artistId, crearBase(slim, { fuente, cortada })); } catch { /* ignora */ }
  }
  return slim;
}

// ── Migración a la base: sin un solo request (v=229) ────────────────────────
//
// Las discografías de antes de v=229 (`discover_artist_disco_v2_{id}`, 30 días)
// pasan a la base la primera vez que se abre cualquiera de las dos vistas. Se
// leen CRUDAS, sin mirar `expiry`: si alguna ya venció y nadie la leyó todavía,
// se rescata igual. Se suma además la copia que guardan los dos cachés de
// escaneo (7 días), que puede tener lanzamientos que la otra no. Las claves
// viejas NO se borran: caducan solas, y hasta entonces son una copia de más.
//
// La fuente: si hay `discover_artist_disco_fuente_{id}` (v=226) se usa tal cual;
// si no, se estima como hasta ahora (orden del nativo), y queda `estimada`.
// La hora de la base es el `storedAt` de la vieja, no «ahora»: así lo reciente
// se refresca escalonado (hoy son tres tandas: 03/09, 15/09 y 16/09) y no las
// 300 el mismo día.
const MIGRACION_LOG_KEY = 'disco_base_migracion_v1';
let _migracion = null;

export function migrarDiscografiasViejas() {
  if (!_migracion) _migracion = hacerMigracion().catch(e => {
    console.warn('[disco-base] la migración falló:', e);
    _migracion = null;   // no se memoiza un fracaso: la próxima entrada lo reintenta
    return { error: e.message };
  });
  return _migracion;
}

async function hacerMigracion() {
  const [viejas, fuentes, bases, scanNR, scanDA] = await Promise.all([
    idbEntriesByPrefix(DISCO_V2_PREFIX),
    idbEntriesByPrefix(FUENTE_PREFIX),
    idbEntriesByPrefix(DISCO_BASE_PREFIX),
    idbGet('discover_scan_new_releases'),
    idbGet('discover_scan_discover_artists'),
  ]);
  const yaBase = new Set(bases.map(([k]) => k.slice(DISCO_BASE_PREFIX.length)));
  const fuentePorId = new Map(fuentes.map(([k, w]) => [k.slice(FUENTE_PREFIX.length), w?.value]));
  const copias = new Map();   // id → [items de los cachés de escaneo]
  for (const w of [scanNR, scanDA]) {
    for (const a of (w?.value?.artists || [])) {
      if (!a?.id || !Array.isArray(a.disco) || !a.disco.length) continue;
      if (!copias.has(a.id)) copias.set(a.id, []);
      copias.get(a.id).push(...a.disco);
    }
  }
  const informe = { t: Date.now(), viejas: viejas.length, yaEstaban: 0, migradas: 0, lanzamientos: 0, sumadosDeEscaneo: 0, vacias: 0 };
  const ids = new Set([...viejas.map(([k]) => k.slice(DISCO_V2_PREFIX.length)), ...copias.keys()]);
  const porId = new Map(viejas.map(([k, w]) => [k.slice(DISCO_V2_PREFIX.length), w]));
  for (const id of ids) {
    if (yaBase.has(id)) { informe.yaEstaban++; continue; }
    const w = porId.get(id);
    const items = Array.isArray(w?.value) ? w.value : [];
    const t = w?.storedAt || copias.has(id) && (scanNR?.storedAt || scanDA?.storedAt) || Date.now();
    const meta = fuentePorId.get(id);
    const ref = items.length ? items : (copias.get(id) || []);
    if (!ref.length) { informe.vacias++; continue; }
    let fuente, cortada, estimada;
    if (meta && meta.fuente) {
      ({ fuente } = meta); cortada = !!meta.cortada; estimada = false;
    } else {
      // La misma estimación que hacía `estadoDiscografia` hasta v=228.
      const nativo = ref.length > 40 || tieneOrdenNativo(ref);
      fuente = nativo ? 'nativo' : 'busqueda';
      cortada = nativo ? ref.length >= 200 : ref.length >= 40;
      estimada = true;
    }
    let base = crearBase(ref, { fuente, cortada, estimada, t, via: 'migracion' });
    const extra = copias.get(id) || [];
    if (extra.length) {
      const antes = base.items.length;
      base = sumarReciente(base, extra, { t });   // `t` viejo: no cuenta como refresco
      base.historial = base.historial.slice(0, 1);
      informe.sumadosDeEscaneo += base.items.length - antes;
    }
    await guardarBase(id, base);
    informe.migradas++;
    informe.lanzamientos += base.items.length;
  }
  try { localStorage.setItem(MIGRACION_LOG_KEY, JSON.stringify(informe)); } catch { /* lleno */ }
  if (informe.migradas) console.info(`[disco-base] migradas ${informe.migradas} discografías a la base (${informe.lanzamientos} lanzamientos, ${informe.sumadosDeEscaneo} sumados de los cachés de escaneo), 0 requests`);
  return informe;
}

// ── Exportar / importar la base (v=229) ─────────────────────────────────────
// El mismo patrón que «Exportar cache» / «Importar cache» de #genre: un JSON
// que se baja con un <a download> y se sube con un <input type=file>. La base
// vive en la IndexedDB de UN navegador y Ian trabaja en dos máquinas.
//
// Importar es UNIÓN, nunca reemplazo: por artista, `fusionarBases` junta lo de
// este navegador con lo del archivo. Importar dos veces el mismo archivo no
// cambia nada; importar uno viejo no borra nada nuevo.

export async function exportarBase() {
  await migrarDiscografiasViejas();
  const bases = {};
  for (const [k, w] of await idbEntriesByPrefix(DISCO_BASE_PREFIX)) {
    const b = w?.value;
    if (b && Array.isArray(b.items)) bases[k.slice(DISCO_BASE_PREFIX.length)] = b;
  }
  return armarExportacion(bases);
}

export async function importarBase(parsed) {
  const leido = leerImportacion(parsed);
  if (!leido.ok) throw new Error(leido.error);
  await migrarDiscografiasViejas();
  const r = { nuevas: 0, ampliadas: 0, iguales: 0, lanzamientosNuevos: 0, descartadas: leido.descartadas };
  for (const [id, suya] of Object.entries(leido.bases)) {
    const mia = await leerBase(id);
    if (!mia) {
      await guardarBase(id, suya);
      r.nuevas++;
      r.lanzamientosNuevos += suya.items.length;
      continue;
    }
    const junta = fusionarBases(mia, suya);
    const suma = junta.items.length - mia.items.length;
    if (suma > 0 || junta.cortada !== mia.cortada || junta.recienteAt !== mia.recienteAt) {
      await guardarBase(id, junta);
      if (suma > 0) { r.ampliadas++; r.lanzamientosNuevos += suma; } else r.iguales++;
    } else r.iguales++;
  }
  // Los cachés de escaneo (7 días) guardan su propia copia de cada discografía:
  // sin tirarlos, lo importado no se vería hasta que caduquen. Se tiran SOLO
  // ellos; la base no se toca.
  for (const k of ['discover_scan_new_releases', 'discover_scan_discover_artists']) {
    try { await idbDel(k); } catch { /* ignora */ }
  }
  return r;
}

/** Botones de la base para la topbar de una vista (`pfx` = prefijo de ids). */
export function botonesBaseHtml(pfx) {
  return `
    <button class="btn btn-secondary btn-sm" id="${pfx}-base-export" title="Baja un JSON con la base de discografías de este navegador, para llevarla a otra máquina. La comparten «Sin escuchar» y «Novedades».">Exportar base</button>
    <button class="btn btn-secondary btn-sm" id="${pfx}-base-import" title="Suma a la base de este navegador la de otro. No borra nada: junta las dos.">Importar base</button>
    <input type="file" id="${pfx}-base-input" accept="application/json,.json" hidden>`;
}

/** Engancha los botones. `alImportar` se llama después de importar, para repintar. */
export function conectarBotonesBase(content, pfx, alImportar) {
  const exp = content.querySelector(`#${pfx}-base-export`);
  const imp = content.querySelector(`#${pfx}-base-import`);
  const input = content.querySelector(`#${pfx}-base-input`);
  if (exp) exp.onclick = async () => {
    exp.disabled = true;
    try {
      const data = await exportarBase();
      if (!data.artistas) { showToast('La base de discografías está vacía: no hay nada que exportar.', 'error'); return; }
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fonoteca-discografias-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Exportada la base: ${data.artistas.toLocaleString('es-ES')} artistas, ${data.lanzamientos.toLocaleString('es-ES')} lanzamientos.`, 'success');
    } catch (e) {
      showToast('No se ha podido exportar la base: ' + e.message, 'error');
    } finally { exp.disabled = false; }
  };
  if (imp && input) {
    imp.onclick = () => input.click();
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      imp.disabled = true;
      try {
        const r = await importarBase(JSON.parse(await file.text()));
        const partes = [];
        if (r.nuevas) partes.push(`${r.nuevas.toLocaleString('es-ES')} artistas nuevos`);
        if (r.ampliadas) partes.push(`${r.ampliadas.toLocaleString('es-ES')} ampliados`);
        partes.push(`${r.lanzamientosNuevos.toLocaleString('es-ES')} lanzamientos sumados`);
        if (r.descartadas) partes.push(`${r.descartadas} entradas mal formadas descartadas`);
        showToast(`Base importada: ${partes.join(' · ')}.`, r.descartadas ? 'warning' : 'success');
        if (alImportar) await alImportar(r);
      } catch (err) {
        showToast('No se ha podido importar la base: ' + err.message, 'error');
      } finally { imp.disabled = false; }
    };
  }
}

/** El toast de cierre de una ronda de «Actualizar». */
export function avisarRonda(ronda) {
  if (!ronda) return;
  const partes = [`Novedades revisadas en ${ronda.refrescados.toLocaleString('es-ES')} artistas`];
  if (ronda.nuevos) partes.push(`${ronda.nuevos.toLocaleString('es-ES')} lanzamientos nuevos`);
  let msg = partes.join(' · ') + '.';
  if (ronda.parada) msg += ` Se paró antes: ${ronda.parada}.`;
  if (ronda.pendientes) msg += ` Quedan ${ronda.pendientes.toLocaleString('es-ES')} para la próxima: se reparten para no agotar la búsqueda de Spotify.`;
  showToast(msg, ronda.parada ? 'warning' : 'success');
}

// ── ¿La discografía cacheada está entera? (v=226) ───────────────────────────
// Hasta v=225 no se guardaba de dónde salía, y 215 de 250 habían entrado por
// /search, que corta en 40 por relevancia (o sea: faltan justo los viejos).
const FUENTE_PREFIX = 'discover_artist_disco_fuente_';
const _estadoDisco = new Map();

// Orden del nativo: primero los `album`, después los `single`, cada bloque por
// fecha descendente. /search ordena por relevancia. Validado el 2026-09-16
// contra el diagnóstico de v=225: de 300 discografías, las 55 con este orden
// son exactamente las 35 + 20 que el diagnóstico contó por el nativo.
//
// Las fechas se comparan como RANGOS: «2019» es cualquier día de 2019. Con
// `releaseTs` (que pone «2019» el 15 de junio) Prince, Bee Gees, Charly García
// y Pharrell salían como /search en v=226 — «2019-03» seguido de «2019» parecía
// desordenado.
function rangoDeFecha(release) {
  const s = release || '';
  const y = parseInt(s.slice(0, 4), 10);
  if (!Number.isFinite(y)) return [0, Infinity];
  const m = parseInt(s.slice(5, 7), 10);
  const d = parseInt(s.slice(8, 10), 10);
  return [Date.UTC(y, m ? m - 1 : 0, d || 1), Date.UTC(y, m ? m - 1 : 11, d || 28)];
}
function tieneOrdenNativo(disco) {
  let fase = 'album';
  let prevHasta = Infinity;
  for (const al of disco) {
    const t = al.type === 'album' ? 'album' : 'single';
    if (t !== fase) {
      if (fase === 'album' && t === 'single') { fase = 'single'; prevHasta = Infinity; }
      else return false;
    }
    const [desde, hasta] = rangoDeFecha(al.release);
    if (desde > prevHasta) return false;
    prevHasta = hasta;
  }
  return true;
}

/**
 * { fuente: 'nativo'|'busqueda', cortada, estimada } o null si no hay caché.
 * `estimada` = discografía de antes de v=226, sin fuente guardada: se deduce
 * del orden, y «cortada» es solo el caso seguro (/search con 40 exactos). Una
 * de /search con 37 puede estar cortada igual, así que ahí es un PISO.
 */
export async function estadoDiscografia(artistId) {
  if (!artistId) return null;
  if (_estadoDisco.has(artistId)) return _estadoDisco.get(artistId);
  let estado = null;
  try {
    // Desde v=229 la fuente vive en la base; lo de abajo es para lo que todavía
    // no se migró (no debería quedar nada después de la primera entrada).
    const base = await leerBase(artistId);
    if (base) {
      estado = { fuente: base.fuente, cortada: !!base.cortada, estimada: !!base.estimada };
      _estadoDisco.set(artistId, estado);
      return estado;
    }
    const meta = await idbGetCached(`${FUENTE_PREFIX}${artistId}`);
    if (meta && meta.fuente) {
      estado = { fuente: meta.fuente, cortada: !!meta.cortada, estimada: false };
    } else {
      const raw = await idbGetCached(`discover_artist_disco_v2_${artistId}`);
      if (Array.isArray(raw) && raw.length) {
        // Más de 40 no puede venir de /search, que corta ahí.
        const nativo = raw.length > 40 || tieneOrdenNativo(raw);
        estado = {
          fuente: nativo ? 'nativo' : 'busqueda',
          cortada: nativo ? raw.length >= 200 : raw.length >= 40,
          estimada: true,
        };
      }
    }
  } catch { /* ignora */ }
  if (estado) _estadoDisco.set(artistId, estado);
  return estado;
}

// ── Cache del escaneo COMPLETO (no solo de la discografía por artista) ──
// Sin esto, entrar a la vista dispara 150 escaneos cada vez. Guardamos el
// resultado ya cruzado con TTL de 7 días; el botón "Actualizar" lo tira (y
// solo a él: la base de discografías no se toca, ver `clearScanCache`).

const SCAN_TTL_MIN = 7 * 24 * 60;   // 7 días

export async function loadScanCache(viewKey) {
  try {
    const data = await idbGetCached(`discover_scan_${viewKey}`);
    return data && Array.isArray(data.artists) ? data : null;
  } catch { return null; }
}

export async function saveScanCache(viewKey, artists) {
  try {
    await idbSetCached(`discover_scan_${viewKey}`, { ts: Date.now(), artists }, SCAN_TTL_MIN);
  } catch { /* ignora */ }
}

// ⚠️ Desde v=229 tira SOLO el caché del escaneo, NUNCA las discografías.
// Hasta v=228 «Actualizar» borraba también `discover_artist_disco_v2_{id}` de
// cada artista escaneado: un click volvía a pedir las 300 enteras, que con la
// cuota de 100 del nativo metía ~280 por `/search` cortadas en 40. Ahora lo
// fresco lo trae la ronda forzada (`nuevaRondaDeRefresco({ forzar: true })`),
// que mira solo lo reciente y con presupuesto. Ya no recibe la lista de ids, a
// propósito: no hay nada por artista que borrar.
export async function clearScanCache(viewKey) {
  try { await idbDel(`discover_scan_${viewKey}`); } catch { /* ignora */ }
}

// "hace 3 días" / "hoy" para el sub-texto del botón Actualizar.
export function agoLabel(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

export function yearOf(release) {
  const y = parseInt((release || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

export function releaseTs(release) {
  // "YYYY", "YYYY-MM", "YYYY-MM-DD" → ms epoch (UTC, día 15 si falta día)
  const s = release || '';
  const y = parseInt(s.slice(0, 4), 10);
  if (!Number.isFinite(y)) return 0;
  const m = parseInt(s.slice(5, 7), 10) || 6;
  const d = parseInt(s.slice(8, 10), 10) || 15;
  return Date.UTC(y, m - 1, d);
}

// Deduplica ediciones del mismo álbum (deluxe, remaster, etc). Nos quedamos
// con la primera edición (release date más antiguo).
export function dedupDisco(disco) {
  const map = new Map();
  for (const al of disco) {
    const artistName = al.artists?.[0]?.name || '';
    const k = albumKey(al.name, artistName);
    const prev = map.get(k);
    if (!prev) { map.set(k, al); continue; }
    const prevY = yearOf(prev.release);
    const curY = yearOf(al.release);
    if (curY && (!prevY || curY < prevY)) map.set(k, al);
    else if (curY === prevY && !prev.img && al.img) map.set(k, al);
  }
  return [...map.values()];
}

// ── Los dos estados de una tarjeta de descubrimiento ────────────────────────
//
// Son cosas DISTINTAS y se guardan separadas a propósito:
//
//   escuchado → "ya lo evalué". Lo puse, le di una vuelta, no necesito que me
//               lo vuelvan a ofrecer. Es una afirmación sobre lo que hice.
//   oculto    → "no me interesa". No lo escuché ni pienso hacerlo. Es una
//               afirmación sobre lo que quiero ver.
//
// Mezclarlos perdería información: si mañana Ian quiere revisar "¿qué marqué
// como escuchado?" no puede hacerlo desde una lista que también tiene los que
// descartó de plano.
//
// Fuente de verdad de los OCULTOS: una playlist de Spotify, igual que en
// #skips, #sin-clasificar y W-Three (util/hidden-sync.js, reconciliación por
// unión). La clave es un álbum, no una pista, así que —como en W-Three— se
// guarda una pista representativa y al leer se reconstruye `albumKey` desde su
// álbum.
//
// Una sola playlist para las dos vistas y no una por vista: #discover-artists y
// #new-releases muestran el MISMO objeto (un álbum de tus artistas que no
// escuchaste), solo que filtrado por criterios distintos. Ocultar un disco en
// Novedades y que te lo siga ofreciendo Sin escuchar sería un bug, no una
// separación útil.
export const hiddenAlbums = createHiddenStore({
  lsKey: 'discover_ocultos',
  playlistName: 'fonoteca · ocultos (descubrir)',
  label: 'descubrir',
  // Las dos direcciones de la clave viven juntas en `util/discover-key.js`:
  // si no dan lo mismo, el oculto no se puede reconciliar por ningún camino.
  keyOfTrack: keyOfPlaylistTrack,
  // La clave es un álbum normalizado: la uri no se deduce, se busca y se
  // confirma recalculando la clave (v=205). `porFirmaDelAlbum` porque acá la
  // clave de vuelta sale del álbum y no de la pista (v=210) — ver el comentario
  // de `keyOfTrack` de arriba y el de `util/hidden-recover.js`.
  recoverUri: (key) => recuperarUriDeAlbumKey(key, { porFirmaDelAlbum: true }),
});

// "Escuchado" alcanza con localStorage, pero con la MISMA forma que el store
// sincronizado (ver createLocalStore): el día que se quiera compartir entre
// máquinas, se cambia la llamada y nada más.
export const heardAlbums = createLocalStore({
  lsKey: 'discover_escuchados',
  label: 'descubrir-escuchados',
});

// `cardKey`, `cardKeyLegacy`, `albumCreditName` y `keyOfPlaylistTrack` viven en
// `util/discover-key.js` — las dos direcciones de la clave juntas, que es la
// única forma de que no se vuelvan a separar (v=210). Se re-exportan porque las
// dos vistas ya las importaban de acá.
export { cardKey, cardKeyLegacy, albumCreditName, keyOfPlaylistTrack };

/**
 * Pasa a la clave nueva los ocultos y los escuchados que se escribieron con la
 * vieja (v=210).
 *
 * Sin esto el arreglo de `cardKey` sería una regresión, no un arreglo: los
 * álbumes marcados con la clave vieja volverían a la lista como si nunca se
 * hubieran tocado, y la clave vieja quedaría en `localStorage` para siempre,
 * huérfana, sin que ninguna vista la pueda alcanzar.
 *
 * Solo mira los álbumes cuya firma NO coincide con el artista explorado — en la
 * medición del 05/09 eran 7 de 189 — así que en la práctica no recorre nada:
 * las dos claves son idénticas y se sale en la primera comparación.
 *
 * Es local y sincrónico: `renameKey` no toca la playlist. Lo que reconcilia con
 * Spotify es el `sync()` de después, que ahora sí puede resolver estas claves
 * porque el `recoverUri` de arriba acepta cualquier pista del álbum correcto.
 *
 * @param {Array<{al: object, artistName: string}>} tarjetas
 * @returns {{ocultos: number, escuchados: number}}
 */
export function migrarClavesDeArtista(artist) {
  return migrarClavesViejas((artist?.disco || []).map(al => ({ al, artistName: artist.name })));
}

export function migrarClavesViejas(tarjetas) {
  let ocultos = 0;
  let escuchados = 0;
  const vistas = new Set();
  for (const { al, artistName } of tarjetas) {
    if (!al?.name || !artistName) continue;
    const vieja = cardKeyLegacy(al, artistName);
    const nueva = cardKey(al, artistName);
    if (vieja === nueva) continue;          // el caso normal: nada que migrar
    const marca = `${vieja}»${nueva}`;
    if (vistas.has(marca)) continue;        // el mismo disco en dos artistas
    vistas.add(marca);
    if (hiddenAlbums.renameKey(vieja, nueva)) ocultos++;
    if (heardAlbums.renameKey(vieja, nueva)) escuchados++;
  }
  if (ocultos || escuchados) {
    console.info(`[discover] claves migradas a la firma del álbum (v=210): ${ocultos} oculto(s), ${escuchados} escuchado(s).`);
  }
  return { ocultos, escuchados };
}

// El índice de escuchados de util/album-heard.js manda igual que antes; encima
// se suma lo que Ian resolvió a mano —«Escuchado», «Guardar álbum», «Añadir
// pistas a mis likes»—, que persiste entre sesiones en `heardAlbums`.
export function albumIsUnheard(al, artistName, heardSet) {
  // Dos espacios de claves distintos, a propósito (v=210). `heardSet` lo arma
  // `util/album-heard.js` con el artista de las PISTAS (likes, W-Three,
  // historial), así que se consulta con la clave de siempre — cambiarlo movería
  // lo que la vista considera «escuchado» para todo el mundo, y eso es otra
  // tanda. `heardAlbums` es el store de esta vista y desde v=210 va por la
  // firma del álbum, igual que `hiddenAlbums`.
  return !heardSet.has(cardKeyLegacy(al, artistName)) && !heardAlbums.has(cardKey(al, artistName));
}

// ── Preview de un álbum ──────────────────────────────────────────────────────
//
// La cadena de proveedores (api/preview-providers.js) busca CANCIONES, y acá lo
// que hay son álbumes que —por definición de la vista— no están en tus likes,
// así que no hay ninguna pista conocida de la que tirar. Se resuelve una pista
// representativa con `GET /albums/{id}/tracks` (la primera del disco) y se
// memoiza por álbum: el hover puede pasar diez veces por la misma tarjeta y es
// una sola llamada.
//
// Si ese endpoint cae (no está confirmado vivo post-migración, ver CLAUDE.md),
// se prueba con el nombre del álbum como si fuera el de la canción: en los
// singles —que son la mitad de esta vista— acierta casi siempre.
const trackMemo = new Map();   // albumId → { name, artists, uri } | null

export async function representativeTrack(al, artistName) {
  try {
    return await resolverPistaRepresentativa(al, artistName);
  } catch (e) {
    console.warn(`[discover] tracklist de «${al?.name}»:`, e.message);
    return null;
  }
}

// La misma resolución, pero que LANZA si la red falla. La usa el lote de
// ocultar, que tiene que poder decir por qué no pudo con un álbum.
//
// ⚠️ Hasta v=227 un fallo (un 429, un corte) se memoizaba como `null` para toda
// la sesión: ese álbum quedaba «sin pista» hasta recargar, y ocultarlo lo dejaba
// solo en este navegador. Ahora se memoiza solo lo que Spotify contestó.
async function resolverPistaRepresentativa(al, artistName) {
  if (!al?.id) return null;
  if (trackMemo.has(al.id)) return trackMemo.get(al.id);
  let out = null;
  const tracks = await getAlbumTracks(al.id, { limit: 50 });
  const t = tracks.find(x => x?.name) || null;
  if (t) {
    out = {
      name: t.name,
      artists: (t.artists || []).map(a => a?.name).filter(Boolean),
      uri: t.uri || (t.id ? `spotify:track:${t.id}` : null),
    };
  }
  if (out && !out.artists.length) out.artists = [artistName].filter(Boolean);
  trackMemo.set(al.id, out);
  return out;
}

/**
 * Getter para el player global. Sin `spotifyId` a propósito: el embed de
 * Spotify no puede autoarrancar en un iframe cross-origin, así que como preview
 * de una tarjeta no sirve — o hay audio de iTunes/Deezer, o no suena.
 */
export async function getAlbumPreview(al, artistName) {
  const rep = await representativeTrack(al, artistName);
  const nombre = rep?.name || al.name;
  const artistas = rep?.artists?.length ? rep.artists : [artistName].filter(Boolean);
  return await getPreview({ name: nombre, artists: artistas });
}

/** La uri con la que se representa el álbum en la playlist de ocultos. */
export async function albumRepresentativeUri(al, artistName) {
  const rep = await representativeTrack(al, artistName);
  return rep?.uri || null;
}

// Crea la playlist "Descubrir · YYYY-MM-DD" con los álbumes seleccionados.
// callback opcional para setear el estado del botón.
export async function createDiscoverPlaylist(albumIds, findAlbumById, { label = 'Descubrir' } = {}) {
  const allTrackUris = [];
  for (const albumId of albumIds) {
    const tracks = await getAlbumTracks(albumId);
    tracks.forEach(t => { if (t.uri) allTrackUris.push(t.uri); });
  }
  if (!allTrackUris.length) throw new Error('los álbumes seleccionados no tienen pistas');

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const name = `${label} · ${dateStr}`;
  const desc = `${albumIds.length} álbumes/singles de tus artistas favoritos que aún no escuchaste. Generado por Fonoteca.`;
  const created = await createPlaylist(name, desc, false);

  for (let i = 0; i < allTrackUris.length; i += 100) {
    const chunk = allTrackUris.slice(i, i + 100);
    await addTracksToPlaylist(created.id, chunk);
  }
  return { name, tracks: allTrackUris.length };
}

// ── Tarjeta compartida de lanzamiento (#new-releases y #discover-artists) ──
// Las dos vistas pintan lo mismo: tapa grande, nombre, artista, fecha, tipo,
// nº de pistas, checkbox y los dos botones de acción. Un solo componente para
// que no se separen otra vez.

// "2026-07-11" a partir de "YYYY", "YYYY-MM" o "YYYY-MM-DD".
export function fmtRelease(release) {
  const s = release || '';
  if (s.length >= 10) return s.slice(0, 10);
  if (s.length >= 7) return `${s}-01`;
  const y = yearOf(s);
  return y ? String(y) : '—';
}

const PLAY_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const DOTS_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
// «Sin preview» dicho con todas las letras (v=150): el «—» de antes se leía
// como un botón roto, no como una respuesta.
const SIN_PREVIEW_HTML = '<span class="sin-preview-txt">Sin preview</span>';
const OJO_TACHADO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const OJO_ABIERTO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

/** La key del player global para una tarjeta. Una sola, para las dos vistas. */
export function previewKeyOf(albumId) {
  return `dc:${albumId}`;
}

// Cuando el player cambia de canción (o para), los ▶/⏸ de TODAS las tarjetas
// pintadas se ponen al día solos. Va acá y no en cada vista justamente porque
// las dos usan la misma tarjeta.
document.addEventListener('previewchange', (e) => {
  const key = e.detail?.key || '';
  document.querySelectorAll('.dcard-play').forEach(btn => {
    if (btn.disabled) return;
    btn.innerHTML = (key === previewKeyOf(btn.dataset.previewAlbum)) ? PAUSE_SVG : PLAY_SVG;
    btn.classList.toggle('is-playing', key === previewKeyOf(btn.dataset.previewAlbum));
  });
});

/**
 * La tapa va con `data-src` y NO con `src` (v=144): las dos vistas pintan por
 * lotes y las tapas las asigna `ui/lazy-img.js` contra el scroller de verdad.
 * El `loading="lazy"` nativo no alcanzaba — resuelve contra el viewport del
 * documento y disparaba las tapas de todo el lote de golpe. El `width`/`height`
 * explícito es obligatorio: sin él, al DESCARGAR una tapa fuera de vista el
 * hueco se cerraría y el scroll pegaría un salto.
 *
 * Quien pinte estas tarjetas TIENE que llamar a `lazy.observe(nodos)` sobre lo
 * recién insertado, o las tapas nunca cargan.
 *
 * @param {object} al  álbum slim (id, name, type, img, release, total)
 * @param {string} artistName
 * @param {object} [opts]
 * @param {string} [opts.checkClass]
 * @param {boolean} [opts.selected]
 * @param {boolean} [opts.showHeard]  muestra «Escuchado» (solo #discover-artists)
 * @param {boolean} [opts.hiddenMode] la tarjeta se está viendo en la lista de
 *                                    ocultos: el ojo la devuelve en vez de ocultarla
 */
export function renderAlbumCard(al, artistName, {
  checkClass = 'dcard-check', selected = false, showHeard = false, hiddenMode = false,
} = {}) {
  const tipo = al.type === 'single' ? 'single' : (al.type === 'compilation' ? 'recopilatorio' : 'álbum');
  // El botón dice a dónde va DE VERDAD. Un single suelto no se guarda en la
  // biblioteca: va a la playlist «fonoteca · sin escuchar» (ver
  // `guardarLanzamiento`). La lección de v=147 fue exactamente esta — el botón
  // «+ Biblioteca» no estaba roto, mentía el nombre.
  const esDisco = esEPoAlbum(al.total);
  const guardarLabel = esDisco ? 'Guardar álbum' : 'Guardar single';
  const guardarTitle = esDisco
    ? 'Guardar el disco entero en tu biblioteca de álbumes'
    : `Añadir sus pistas a la playlist «${PLAYLIST_SINGLES}» — un single suelto ensucia la biblioteca de álbumes`;
  const id = escapeHtml(al.id);
  const artista = escapeHtml(artistName);
  const sonando = playingKey() === previewKeyOf(al.id);
  return `
    <div class="dcard${selected ? ' is-sel' : ''}" data-id="${id}" data-artist="${artista}">
      <label class="dcard-check-wrap" title="Seleccionar">
        <input type="checkbox" class="${checkClass}" data-id="${id}"${selected ? ' checked' : ''} aria-label="Seleccionar ${escapeHtml(al.name)}">
      </label>
      <div class="dcard-top">
        <div class="dcard-cover-wrap" data-hover-album="${id}">
          <button type="button" class="dcard-cover" data-open-album="${id}" data-open-artist="${artista}" title="Ver ficha del álbum">
            ${al.img
              ? `<img data-src="${escapeHtml(al.img)}" alt="" width="104" height="104" class="dcard-img">`
              : `<span class="dcard-img dcard-img-empty">♪</span>`}
          </button>
          <button type="button" class="dcard-play${sonando ? ' is-playing' : ''}" data-preview-album="${id}"
                  title="Preview de 30 s — no suma reproducciones" aria-label="Preview">${sonando ? PAUSE_SVG : PLAY_SVG}</button>
        </div>
        <div class="dcard-info">
          <button type="button" class="dcard-name" data-open-album="${id}" data-open-artist="${artista}">${escapeHtml(al.name)}</button>
          <button type="button" class="dcard-artist" data-open-artist-card="${artista}">${artista}</button>
          <div class="dcard-meta">${escapeHtml(fmtRelease(al.release))} · ${tipo}</div>
          <div class="dcard-meta">${al.total ? `${al.total} pista${al.total === 1 ? '' : 's'}` : 'pistas: sin dato'}</div>
        </div>
      </div>
      <div class="dcard-actions">
        <button class="btn btn-secondary btn-sm" data-save-album="${id}" data-save-artist="${artista}" title="${escapeHtml(guardarTitle)}">${escapeHtml(guardarLabel)}</button>
        <button class="btn btn-secondary btn-sm" data-liketracks-album="${id}" data-save-artist="${artista}" title="Darle al corazón a cada pista del disco, una por una">Añadir pistas a mis likes</button>
        <button class="btn btn-secondary btn-sm" data-addpl-album="${id}" title="Añadir todas las pistas a una o varias playlists">Añadir a playlist…</button>
        ${showHeard ? `<button class="btn btn-secondary btn-sm" data-heard-album="${id}" title="Ya lo escuchaste y lo evaluaste: deja de aparecer">Escuchado</button>` : ''}
        <button class="btn btn-secondary btn-sm dcard-hide" data-hide-album="${id}"
                title="${hiddenMode ? 'Devolver a la lista' : 'No me interesa: no volver a mostrarlo (no toca tu biblioteca)'}"
                aria-label="${hiddenMode ? 'Devolver' : 'Ocultar'}">${hiddenMode ? OJO_ABIERTO : OJO_TACHADO}</button>
      </div>
    </div>
  `;
}

// Los botones de la tarjeta, convertidos en acciones para la ficha de álbum.
// El `label` sale del botón real cuando lo tiene (así «Guardar álbum» y
// «Guardar single» siguen diciendo a dónde va cada cosa de verdad); el del ojo
// se pone acá porque en la tarjeta es un icono sin texto.
const ACCIONES_TARJETA = [
  { sel: '[data-save-album]' },
  { sel: '[data-liketracks-album]' },
  { sel: '[data-addpl-album]' },
  { sel: '[data-heard-album]' },
  { sel: '.dcard-hide', label: 'Ocultar' },
];

function accionesDeLaTarjeta(tarjeta) {
  if (!tarjeta) return [];
  const out = [];
  for (const { sel, label } of ACCIONES_TARJETA) {
    const b = tarjeta.querySelector(sel);
    if (!b) continue;   // «Escuchado» solo existe en #discover-artists
    out.push({
      label: label || (b.textContent || '').trim(),
      title: b.title,
      // Cerrar primero: casi todas estas acciones sacan el álbum de la lista
      // que hay detrás, y además «Añadir a playlist…» abre SU propio modal.
      onClick: ({ cerrar }) => { cerrar(); b.click(); },
    });
  }
  return out;
}

// Cablea una grilla ya pintada con renderAlbumCard. Las dos vistas usan los
// mismos data-attributes, así que el wiring también es uno solo.
export function wireAlbumCards(list, findAlbumById, {
  checkClass, selection, onSave, onLikeTracks, onChange, afterAdd, onHeard, onHide,
}) {
  // ── Preview: botón ▶ y hover sobre la tapa ──
  // El getter es el mismo en los dos caminos; `hoverIn` (dentro de attachHover)
  // trae el debounce de 400 ms, así que barrer la grilla con el mouse no
  // dispara ninguna búsqueda ni ninguna llamada a /albums/{id}/tracks.
  list.querySelectorAll('[data-preview-album]').forEach(btn => {
    const al = findAlbumById(btn.dataset.previewAlbum);
    const artista = btn.closest('.dcard')?.dataset.artist || '';
    if (!al) return;
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const previo = btn.innerHTML;
      btn.innerHTML = DOTS_SVG;
      const res = await togglePreview(previewKeyOf(al.id), () => getAlbumPreview(al, artista));
      if (res === true) btn.innerHTML = PAUSE_SVG;
      else if (res === null) {
        btn.innerHTML = SIN_PREVIEW_HTML;
        btn.classList.add('sin-preview');
        btn.title = 'Sin preview en iTunes ni en Deezer';
        btn.disabled = true;
        showToast(`Sin preview disponible de «${al.name}»`, 'info');
      } else btn.innerHTML = previo === DOTS_SVG ? PLAY_SVG : previo;
    };
  });
  list.querySelectorAll('[data-hover-album]').forEach(wrap => {
    const al = findAlbumById(wrap.dataset.hoverAlbum);
    const artista = wrap.closest('.dcard')?.dataset.artist || '';
    if (!al) return;
    attachHover(wrap, previewKeyOf(al.id), () => getAlbumPreview(al, artista));
  });

  if (onHeard) {
    list.querySelectorAll('[data-heard-album]').forEach(btn => {
      btn.onclick = () => onHeard(btn.dataset.heardAlbum, btn.closest('.dcard')?.dataset.artist || '', btn);
    });
  }
  list.querySelectorAll('[data-hide-album]').forEach(btn => {
    btn.onclick = () => onHide?.(btn.dataset.hideAlbum, btn.closest('.dcard')?.dataset.artist || '', btn);
  });

  list.querySelectorAll('[data-open-artist-card]').forEach(btn => {
    btn.onclick = () => openArtistCard({ name: btn.dataset.openArtistCard });
  });
  // La ficha es LA MISMA del resto de la app (features/album-card.js), con los
  // botones de esta vista encima (v=165). Y esos botones no reimplementan nada:
  // cada uno **aprieta el de la tarjeta**, así que el guardado, el likeo, el
  // picker de playlists y los dos stores siguen viviendo en un solo sitio y no
  // hay forma de que la ficha y la grilla se desincronicen.
  list.querySelectorAll('[data-open-album]').forEach(btn => {
    btn.onclick = () => {
      const al = findAlbumById(btn.dataset.openAlbum);
      if (!al) return;
      const tarjeta = btn.closest('.dcard');
      openAlbumCard({
        name: al.name, artist: btn.dataset.openArtist, img: al.img,
        plays: 0, min: 0, albumId: al.id, totalTracks: al.total,
        acciones: accionesDeLaTarjeta(tarjeta),
      });
    };
  });
  list.querySelectorAll('[data-save-album]').forEach(btn => {
    btn.onclick = () => onSave(btn.dataset.saveAlbum, btn.dataset.saveArtist, btn);
  });
  list.querySelectorAll('[data-liketracks-album]').forEach(btn => {
    btn.onclick = () => onLikeTracks?.(btn.dataset.liketracksAlbum, btn.dataset.saveArtist, btn);
  });
  list.querySelectorAll('[data-addpl-album]').forEach(btn => {
    btn.onclick = async () => {
      const texto = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Abriendo…';
      try {
        await addAlbumsToPlaylists([btn.dataset.addplAlbum], findAlbumById, { onDone: afterAdd });
      } catch (e) {
        showToast('No se pudieron cargar tus playlists: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = texto;
      }
    };
  });
  list.querySelectorAll(`.${checkClass}`).forEach(cb => {
    cb.checked = selection.has(cb.dataset.id);
    cb.onchange = () => {
      if (cb.checked) selection.add(cb.dataset.id);
      else selection.delete(cb.dataset.id);
      cb.closest('.dcard')?.classList.toggle('is-sel', cb.checked);
      onChange();
    };
  });
}

// ── Acciones de los dos estados, compartidas por las dos vistas ─────────────

/**
 * Marca/desmarca "ya lo evalué". Es instantáneo: solo localStorage.
 * @returns {boolean} true si quedó marcado como escuchado
 */
export function toggleHeardAlbum(al, artistName) {
  return heardAlbums.toggle(cardKey(al, artistName), null);
}

/**
 * Oculta/devuelve un álbum. Antes de tocar el store resuelve la pista
 * representativa, que es lo que se sube a la playlist de Spotify: sin uri el
 * ocultamiento queda solo local y no viaja a la otra máquina, que es
 * exactamente el problema que la playlist vino a resolver.
 *
 * La resolución está memoizada por álbum, así que si el usuario ya escuchó el
 * preview de esa tarjeta no cuesta ninguna llamada.
 *
 * @returns {Promise<boolean>} true si quedó oculto
 */
export async function toggleHiddenAlbum(al, artistName) {
  const key = cardKey(al, artistName);
  let uri = null;
  try {
    uri = await albumRepresentativeUri(al, artistName);
  } catch { /* sin uri: el store avisa, la anota y la intenta recuperar en el sync */ }
  return hiddenAlbums.toggle(key, uri);
}

// ── «Ocultar» / «Devolver» de la barra de selección (v=228) ─────────────────
//
// Compartido por las dos vistas. La acción es EXPLÍCITA, no un toggle: en el
// modo «Ocultos» un lote mezclado con `toggle` devolvería unos y ocultaría
// otros. El botón dice «Ocultar» en la lista y «Devolver a la lista» en el modo
// «Ocultos», y en los dos casos lo que ya está como se pide no se toca.
//
// Coste de ocultar N: hasta N `GET /albums/{id}/tracks` (0 por cada álbum al
// que ya se le dio ▶, está memoizado) + 1 POST por cada 100 a la playlist.
// Devolver no pide pistas: la uri ya está guardada con el oculto.

/**
 * @param {Array<{al: object, artistName: string}>} entradas
 * @param {boolean} ocultar
 * @param {{onProgress?: (p: {fase: 'pistas'|'playlist', hechos?: number, total?: number}) => void}} [opts]
 * @returns {Promise<{hechas: Array, yaEstaban: Array, fallidas: Array<{al, artistName, motivo}>}>}
 */
export async function fijarOcultosDeAlbumes(entradas, ocultar, { onProgress } = {}) {
  // Dos tarjetas pueden dar la misma clave (el mismo disco en dos artistas):
  // se opera una vez por clave y el resultado vuelve a todas sus tarjetas.
  const porClave = new Map();
  for (const e of entradas) {
    const key = cardKey(e.al, e.artistName);
    if (!porClave.has(key)) porClave.set(key, []);
    porClave.get(key).push(e);
  }
  await hiddenAlbums.ready();

  const paraStore = [];
  const motivoDe = new Map();   // clave → por qué no se intentó
  const aResolver = [...porClave.keys()].filter(k => hiddenAlbums.has(k) !== ocultar);
  let cortado = null;
  if (ocultar) {
    let i = 0;
    for (const key of aResolver) {
      onProgress?.({ fase: 'pistas', hechos: i, total: aResolver.length });
      i++;
      if (cortado) { motivoDe.set(key, cortado); continue; }
      const { al, artistName } = porClave.get(key)[0];
      try {
        const rep = await resolverPistaRepresentativa(al, artistName);
        if (rep?.uri) paraStore.push({ key, uri: rep.uri });
        else motivoDe.set(key, 'Spotify no devuelve ninguna pista de este lanzamiento');
      } catch (e) {
        motivoDe.set(key, `no he podido leer sus pistas: ${e.message}`);
        // Un 429 aquí es la cuota, no un álbum raro: seguir sería esperar
        // minutos por cada uno para acabar igual. Los que quedan se dicen.
        if (e.status === 429 || /\b429\b|rate limit/i.test(e.message)) {
          cortado = 'no lo he intentado: Spotify ha cortado por exceso de peticiones (429). Vuelve a probar en un rato';
        }
      }
    }
    onProgress?.({ fase: 'pistas', hechos: aResolver.length, total: aResolver.length });
  } else {
    for (const key of aResolver) paraStore.push({ key });
  }

  onProgress?.({ fase: 'playlist' });
  // Las que ya están como se pide también van al store: así el recuento de
  // «ya lo estaban» sale de un solo sitio.
  const yaDeAntes = [...porClave.keys()].filter(k => hiddenAlbums.has(k) === ocultar).map(key => ({ key }));
  const res = await hiddenAlbums.fijarVarios([...yaDeAntes, ...paraStore], ocultar);

  const expandir = (claves) => claves.flatMap(k => porClave.get(k) || []);
  const fallidas = [
    ...[...motivoDe].map(([key, motivo]) => ({ key, motivo })),
    ...res.fallidas,
  ].flatMap(({ key, motivo }) => (porClave.get(key) || []).map(e => ({ ...e, motivo })));
  return { hechas: expandir(res.hechas), yaEstaban: expandir(res.yaEstaban), fallidas };
}

/**
 * Cablea el botón «Ocultar»/«Devolver» de la barra de una vista. `prefix` es el
 * de sus ids (`newrel`, `disco`): la barra tiene `#{prefix}-sel-hide` y
 * `#{prefix}-lote-fallos`.
 *
 * Lo que falla queda SELECCIONADO y listado con su motivo debajo de la barra:
 * volver a pulsar el botón reintenta justo esos.
 */
export function wireLoteOcultos(content, { prefix, selection, findEntrada, isHiddenMode, onFin }) {
  const btn = content.querySelector(`#${prefix}-sel-hide`);
  const caja = content.querySelector(`#${prefix}-lote-fallos`);
  if (!btn) return;
  btn.onclick = async () => {
    const ids = [...selection];
    if (!ids.length) return;
    const ocultar = !isHiddenMode();
    const botones = [...content.querySelectorAll(`#${prefix}-actionbar button`)];
    const texto = btn.textContent;
    botones.forEach(b => { b.disabled = true; });
    if (caja) { caja.hidden = true; caja.innerHTML = ''; }

    const entradas = [];
    const perdidas = [];
    for (const id of ids) {
      const e = findEntrada(id);
      if (e) entradas.push(e);
      else perdidas.push({ al: { id, name: id }, artistName: '', motivo: 'ya no está en la discografía escaneada' });
    }

    let res;
    try {
      res = await fijarOcultosDeAlbumes(entradas, ocultar, {
        onProgress: (p) => {
          btn.textContent = p.fase === 'pistas'
            ? `Buscando pistas ${p.hechos}/${p.total}…`
            : (ocultar ? 'Guardando en la playlist…' : 'Quitando de la playlist…');
        },
      });
    } catch (e) {
      // No debería pasar (todo lo de dentro se recoge como fallida), pero si
      // pasa la selección se queda tal cual y se dice.
      showToast(`No se ha podido ${ocultar ? 'ocultar' : 'devolver'} la selección: ${e.message}`, 'error');
      botones.forEach(b => { b.disabled = false; });
      btn.textContent = texto;
      return;
    }
    const fallidas = [...res.fallidas, ...perdidas];

    selection.clear();
    for (const f of fallidas) selection.add(f.al.id);

    const n = res.hechas.length;
    const partes = [];
    if (n) partes.push(ocultar
      ? `${n} ${n === 1 ? 'oculto' : 'ocultos'} — no vuelven a aparecer`
      : `${n} ${n === 1 ? 'devuelto' : 'devueltos'} a la lista`);
    if (res.yaEstaban.length) partes.push(`${res.yaEstaban.length} ya lo ${res.yaEstaban.length === 1 ? 'estaba' : 'estaban'}`);
    if (partes.length) showToast(partes.join(' · '), fallidas.length ? 'info' : 'success');
    if (fallidas.length) {
      showToast(
        `${fallidas.length} de ${ids.length} no se ${fallidas.length === 1 ? 'ha' : 'han'} podido ${ocultar ? 'ocultar' : 'devolver'}. ` +
        `Siguen seleccionados y el motivo está en la barra.`,
        'warning',
      );
      if (caja) {
        caja.innerHTML = `
          <div class="disco-lote-fallos-titulo">No se ${fallidas.length === 1 ? 'ha' : 'han'} podido ${ocultar ? 'ocultar' : 'devolver'} (${fallidas.length}). Vuelve a pulsar «${escapeHtml(texto)}» para reintentarlo:</div>
          <ul>${fallidas.map(f => `<li><strong>${escapeHtml(f.al.name || '')}</strong>${f.artistName ? ` · ${escapeHtml(f.artistName)}` : ''} — ${escapeHtml(f.motivo)}</li>`).join('')}</ul>`;
        caja.hidden = false;
      }
    }

    botones.forEach(b => { b.disabled = false; });
    btn.textContent = texto;
    onFin?.();
  };
}

// Abre el modal multi-selección y añade TODAS las pistas de los álbumes
// indicados a cada playlist marcada. Compartido por las dos vistas.
export async function addAlbumsToPlaylists(albumIds, findAlbumById, { onDone } = {}) {
  const playlists = await getOwnPlaylists();
  const nombres = albumIds.map(id => findAlbumById(id)?.name).filter(Boolean);
  const subtitulo = albumIds.length === 1
    ? (nombres[0] || '')
    : `${albumIds.length} lanzamientos: ${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? '…' : ''}`;

  openPlaylistPicker({
    id: 'disco-add-pl',
    title: albumIds.length === 1 ? 'Añadir a playlists' : 'Añadir la selección a playlists',
    subtitle: subtitulo,
    playlists,
    onReload: () => getOwnPlaylists({ force: true }),
    onConfirm: async (elegidas, { setStatus } = {}) => {
      const uris = [];
      const namesByUri = new Map();
      for (const albumId of albumIds) {
        const tracks = await getAlbumTracks(albumId);
        tracks.forEach(t => {
          if (!t.uri) return;
          uris.push(t.uri);
          if (t.name) namesByUri.set(t.uri, t.name);
        });
      }
      if (!uris.length) throw new Error('los lanzamientos elegidos no tienen pistas');
      const res = await addUrisToPlaylists(uris, elegidas, { namesByUri, onStatus: setStatus });
      // Muchos «lanzamientos» son singles de una sola pista: sin esto el toast
      // decía "1 pistas … se añadieron".
      const pistas = `${uris.length} pista${uris.length === 1 ? '' : 's'}`;
      toastAddResult(res, {
        what: albumIds.length === 1
          ? `${pistas} de «${nombres[0] || 'el lanzamiento'}»`
          : `${pistas} de ${albumIds.length} lanzamientos`,
        plural: uris.length !== 1,
      });
      // Si no entró en ninguna playlist, el toast de arriba ya lo contó: no hay
      // nada que refrescar en la vista.
      if (!res.ok.length && !res.skipped.length) return;
      if (onDone) onDone();
    },
  });
}

// Las DOS cosas distintas que se pueden hacer con un álbum, cada una con su
// nombre. Hasta v=147 había un solo botón —«+ Biblioteca»— que llamaba a
// `saveAlbumTracksToLibrary`: Ian lo apretó esperando guardar el disco y le
// entraron sus 12 pistas sueltas en los me gusta. El botón no estaba roto, el
// nombre mentía.

/** Guarda el ÁLBUM como unidad. No toca los me gusta de las pistas. */
export async function saveAlbumToLibrary(albumId) {
  if (!albumId) throw new Error('álbum sin id');
  await saveAlbumsToLibrary([albumId]);
  return albumId;
}

// ── Guardar un lanzamiento: la biblioteca no es para todo (v=152) ──────────
//
// Un single suelto guardado como «álbum» ensucia la biblioteca: entre discos
// de verdad aparecen decenas de fichas de una pista. Así que el destino
// depende del tamaño:
//
//   < 4 pistas  → single suelto  → a la playlist «fonoteca · sin escuchar»
//   ≥ 4 pistas  → EP o álbum     → a la biblioteca, como hasta ahora
//
// El umbral sale de `util/release-size.js`, que es el MISMO que ya usaba
// `features/listened.js` desde v=127 para partir «Sin registrar». El encargo
// de esta tanda decía «menos de 5 / 5 o más», pero se respeta el criterio que
// ya estaba: con 5 un EP de 4 pistas iría a la playlist en una vista y
// contaría como EP en la otra.
//
// ⚠️ La playlist se crea PÚBLICA y no hay forma de evitarlo: `POST
// /me/playlists` ignora el campo `public` post-migración (verificado 2026-08-09,
// ver CLAUDE.md). Hay que pasarla a privada a mano desde la app de Spotify,
// como las otras cinco de fonoteca. Por eso el toast lo dice.
export const PLAYLIST_SINGLES = 'fonoteca · sin escuchar';

let _plSinglesId = null;

/** Busca la playlist de singles y la crea si no está. Memoizada por sesión. */
export async function ensureSinglesPlaylist() {
  if (_plSinglesId) return { id: _plSinglesId, creada: false };
  const propias = await getOwnPlaylists();
  const ya = propias.find(p => (p.name || '').trim() === PLAYLIST_SINGLES);
  if (ya) { _plSinglesId = ya.id; return { id: ya.id, creada: false }; }
  const creada = await createPlaylist(
    PLAYLIST_SINGLES,
    'Singles de tus artistas que todavía no escuchaste. Generada por Fonoteca.',
    false,
  );
  _plSinglesId = creada.id;
  // La lista de playlists propias quedó vieja: sin esto, el próximo
  // `ensureSinglesPlaylist` de la sesión no la encontraría y crearía otra.
  await getOwnPlaylists({ force: true });
  return { id: creada.id, creada: true };
}

/**
 * Guarda un lanzamiento donde corresponda según su tamaño.
 * @returns {Promise<{destino:'biblioteca'|'playlist', pistas?:number, yaEstaban?:number, playlistCreada?:boolean}>}
 */
export async function guardarLanzamiento(al) {
  if (!al?.id) throw new Error('lanzamiento sin id');

  const total = al.total || (await getAlbumTracks(al.id)).length;
  if (esEPoAlbum(total)) {
    await saveAlbumsToLibrary([al.id]);
    return { destino: 'biblioteca' };
  }

  const tracks = await getAlbumTracks(al.id);
  const uris = tracks.map(t => t.uri).filter(Boolean);
  if (!uris.length) throw new Error('el lanzamiento no tiene pistas');
  const namesByUri = new Map(tracks.filter(t => t.uri && t.name).map(t => [t.uri, t.name]));

  const { id, creada } = await ensureSinglesPlaylist();
  // `addUrisToPlaylists` es el de util/playlist-add.js: ya mira los items de la
  // playlist antes de escribir y descarta las uris repetidas, así que añadir
  // dos veces el mismo single no lo duplica.
  const res = await addUrisToPlaylists(uris, [{ id, name: PLAYLIST_SINGLES }], { namesByUri });
  if (res.failed?.length) throw new Error(res.failed[0]?.message || 'no se pudo añadir a la playlist');
  // La forma que devuelve util/playlist-add.js: `detail[]` trae `added` y `dup`
  // de las que SÍ se escribieron, y `skipped[]` son las playlists en las que ya
  // estaba todo (ahí no hubo POST y no hay entrada en `detail`).
  const añadidas = (res.detail || []).reduce((n, d) => n + (d.added || 0), 0);
  const yaEstaban = (res.detail || []).reduce((n, d) => n + (d.dup || 0), 0)
    + (res.skipped || []).reduce((n, sk) => n + (sk.uris?.length || 0), 0);
  return { destino: 'playlist', pistas: añadidas, yaEstaban, playlistCreada: creada };
}

/** Likea UNA POR UNA todas las pistas del álbum. No guarda el álbum. */
export async function saveAlbumTracksToLibrary(albumId) {
  const tracks = await getAlbumTracks(albumId);
  const ids = tracks.map(t => t.id).filter(Boolean);
  if (!ids.length) throw new Error('el álbum no tiene pistas');
  await saveToLibrary(ids);
  return ids;
}

/**
 * Cuántas pistas tiene el álbum, para poder DECIRLO antes de likearlas.
 * Usa el dato que ya trae la tarjeta si lo hay; si no, lo pregunta.
 */
export async function albumTrackCount(al) {
  if (al?.total) return al.total;
  try { return (await getAlbumTracks(al.id)).length; } catch { return 0; }
}

/**
 * Un álbum guardado (o con todas sus pistas likeadas) ya está resuelto: tiene
 * que dejar de aparecer en «Sin escuchar» y en «Novedades», y tiene que
 * seguir sin aparecer después de recargar. `markAlbumHeard` solo tocaba el
 * índice EN MEMORIA, así que la tarjeta volvía en la siguiente sesión — que es
 * lo que más confundía.
 */
export function markAlbumResolved(al, artistName) {
  return heardAlbums.add(cardKey(al, artistName), null);
}

// ── Los filtros como chips de la topbar (v=152, siete desde v=165) ──────────────────────
//
// Comparten módulo porque las dos vistas muestran el MISMO objeto (un
// lanzamiento de tus artistas que no escuchaste) y tienen que filtrarlo igual.
// La lógica vive en util/discover-filters.js; acá solo está el HTML y el
// cableado, que también es uno solo.

/**
 * Los chips, con el conteo de lo que descarta cada criterio al lado.
 * El número se muestra SIEMPRE, esté el filtro encendido o apagado: apagado
 * dice cuántos está dejando entrar, y encendido cuántos está sacando.
 */
export function renderFiltroChips(estado, conteos) {
  return `
    <div class="disco-filtros" id="disco-filtros" role="group" aria-label="Filtros de la lista">
      ${FILTROS_DEF.map(f => `
        <button type="button" class="disco-filtro ${estado[f.key] ? 'is-on' : ''}"
                data-filtro="${f.key}" aria-pressed="${!!estado[f.key]}" title="${escapeHtml(f.ayuda)}">
          <svg class="disco-filtro-ico" viewBox="0 0 24 24" width="15" height="15" fill="none"
               stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">${f.icono}</svg>
          <span class="disco-filtro-txt">${escapeHtml(f.corto)}</span>
          <span class="disco-filtro-n">${(conteos?.[f.key] ?? 0).toLocaleString('es-ES')}</span>
        </button>
      `).join('')}
    </div>
  `;
}

/** Cablea los chips. `onChange(key, nuevoEstado)` repinta la lista. */
export function wireFiltroChips(root, estado, onChange) {
  root.querySelector('#disco-filtros')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filtro]');
    if (!btn) return;
    const k = btn.dataset.filtro;
    estado[k] = !estado[k];
    saveFiltros(estado);
    btn.classList.toggle('is-on', estado[k]);
    btn.setAttribute('aria-pressed', String(!!estado[k]));
    onChange(k, estado);
  });
}
