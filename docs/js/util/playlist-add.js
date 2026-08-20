// Añadir pistas a VARIAS playlists de una vez, compartido por #sin-clasificar,
// #new-releases y #discover-artists.
//
// Reglas:
//   - antes de escribir se miran los items de las playlists ELEGIDAS y se
//     descartan las uris que ya están: añadir dos veces la misma canción no la
//     deja repetida. Si en una playlist ya estaba todo, no se hace el POST;
//   - un solo POST por playlist elegida (addTracksToPlaylist ya trocea de a 100
//     si hacen falta varias llamadas para la misma playlist);
//   - si una playlist falla, las demás siguen: el resultado dice a cuáles se
//     añadió, en cuáles ya estaba y cuáles fallaron;
//   - el caché de items de cada playlist se parchea en el sitio cuando se puede,
//     para que el próximo escaneo de #sin-clasificar no la re-descargue entera.

import {
  getAllUserPlaylists, getCurrentUserId,
  addTracksToPlaylist, updatePlaylistItemsCache,
  getAllPlaylistItems,
  onPlaylistsInvalidated,
} from '../api.js?v=150';
import { showToast } from '../ui/toast.js?v=150';

// Playlists propias (las ajenas no se pueden escribir). Se memoiza en el módulo
// porque las tres vistas piden lo mismo y getAllUserPlaylists ya cachea aparte.
//
// El memo se tira solo en dos casos:
//   1. cuando creamos una playlist nosotros — api.js avisa por
//      onPlaylistsInvalidated (ver la suscripción al final del archivo);
//   2. al minuto, por si la creaste en la app de Spotify y no acá. Este caso
//      NO lo cubre el aviso de api.js, así que la re-lectura tiene que saltarse
//      también el cache de getAllUserPlaylists (24 h) o traería lo mismo de
//      antes: por eso `force`. Son 2-4 requests y solo al abrir el modal.
const OWN_TTL_MS = 60 * 1000;
let _own = null;
let _ownAt = 0;

export async function getOwnPlaylists({ force = false } = {}) {
  const vencido = Date.now() - _ownAt > OWN_TTL_MS;
  if (_own && !force && !vencido) return _own;
  const refrescar = force || (_own != null && vencido);
  const [me, todas] = await Promise.all([
    getCurrentUserId(),
    getAllUserPlaylists(null, { force: refrescar }),
  ]);
  // OJO: acá NO se filtran las playlists de ocultos. Hay llamadores que
  // necesitan la lista completa —«Playlists ignoradas» de #sin-clasificar deja
  // elegir cualquiera—. Sacarlas de los DESTINOS se hace en el picker
  // compartido (ui/playlist-picker.js), que es el único lugar donde la lista
  // significa «dónde puedo añadir esto».
  _own = todas.filter(p => p.owner?.id === me);
  _ownAt = Date.now();
  return _own;
}

export function invalidateOwnPlaylists() {
  _own = null;
  _ownAt = 0;
}

// Un POST /me/playlists nuestro (desde cualquier vista, incluidas las playlists
// de ocultos de util/hidden-sync.js) pasa por invalidatePlaylistsCache en
// api.js, que dispara esto. Sin ello, crear una playlist con la app abierta no
// la hacía aparecer en el modal hasta recargar la página.
onPlaylistsInvalidated(invalidateOwnPlaylists);

// ── Duplicados ───────────────────────────────────────────────────────────────

function uriDeItem(it) {
  const t = it?.item || it?.track || it;
  if (!t) return null;
  return t.uri || (t.id ? `spotify:track:${t.id}` : null);
}

// ⚠️ GET /playlists/{id}?fields=snapshot_id VA RETRASADO respecto a nuestras
// propias escrituras. Medido en vivo el 2026-08-13 sobre una playlist de prueba:
// justo después de un POST el GET todavía devuelve el snapshot ANTERIOR, y tarda
// entre 5 y 10 s en ponerse al día (el contenido de /items, en cambio, es
// correcto al instante). Ese desfase es la explicación del gotcha que estaba
// anotado en PENDIENTES desde v=129 como "el snapshot del POST no siempre
// coincide con el que reporta la playlist después".
//
// Consecuencia para el chequeo de duplicados: dentro de esa ventana el cache
// valida contra un snapshot que ya no describe el contenido, así que podríamos
// leer una lista vieja y dar por duplicada una canción que ya no está — y no
// añadirla. Un falso duplicado es peor que el duplicado que venimos a evitar
// (falla en silencio), así que en las playlists donde escribimos nosotros en
// esta sesión se lee siempre fresco.
const escritasEnEstaSesion = new Set();

async function itemsActuales(playlistId) {
  const fiable = !escritasEnEstaSesion.has(playlistId);
  return getAllPlaylistItems(playlistId, null, { useCache: fiable });
}

// Después de escribir se cachea con el snapshot que devolvió el POST, que es el
// que el GET acaba reportando cuando se pone al día. Re-leerlo acá no serviría:
// devolvería el snapshot viejo junto a los items nuevos, que es justamente la
// combinación que corrompe el cache.
async function cachearTrasEscribir(playlistId, itemsPrevios, appendItems, snapshot) {
  escritasEnEstaSesion.add(playlistId);
  try {
    if (snapshot && Array.isArray(itemsPrevios) && appendItems && appendItems.length) {
      const items = itemsPrevios.concat(appendItems.map(it => ({ item: it })));
      await updatePlaylistItemsCache(playlistId, items, snapshot);
      return;
    }
  } catch { /* caemos a invalidar */ }
  // Sin appendItems no podemos reconstruir los items nuevos con sus campos
  // reales; inventarlos rompería a quien lea el cache. Mejor invalidar.
  await updatePlaylistItemsCache(playlistId, null, null);
}

/**
 * Devuelve:
 *   ok      [playlist]                    — se añadió al menos una uri
 *   failed  [{ playlist, message }]
 *   skipped [{ playlist, uris, names }]   — ya estaba TODO: no se hizo POST
 *   dupes   [{ playlist, uris, names }]   — lo que se filtró (incluye skipped)
 *   detail  [{ playlist, added, dupNames }] — cuántas entraron de verdad en cada
 *           playlist. El toast lo necesita: con duplicados de por medio, el
 *           total que pide el caller ya no es lo que se escribió.
 *
 * `namesByUri` es opcional y solo sirve para que el toast pueda decir QUÉ
 * canción ya estaba. `onStatus` recibe texto para la etiqueta del botón.
 */
export async function addUrisToPlaylists(uris, playlists, {
  appendItems = null, namesByUri = null, onStatus = null,
} = {}) {
  const limpias = [...new Set((uris || []).filter(Boolean))];
  if (!limpias.length) throw new Error('no hay ninguna pista con URI de Spotify');

  const nombreDe = (uri) => {
    if (!namesByUri) return null;
    return namesByUri instanceof Map ? namesByUri.get(uri) : namesByUri[uri];
  };

  const ok = [];
  const failed = [];
  const skipped = [];
  const dupes = [];
  const detail = [];

  for (const pl of playlists) {
    try {
      if (onStatus) onStatus(`Comprobando «${pl.name}»…`);
      let previos = null;
      let yaEstan = new Set();
      try {
        previos = await itemsActuales(pl.id);
        yaEstan = new Set(previos.map(uriDeItem).filter(Boolean));
      } catch (e) {
        // Sin la lista no podemos filtrar. Añadimos igual (el comportamiento de
        // antes) en vez de bloquear al usuario por un fallo de lectura.
        console.warn(`[playlist-add] no pude leer «${pl.name}» para comprobar duplicados:`, e.message);
      }

      const repetidas = limpias.filter(u => yaEstan.has(u));
      const nuevas = limpias.filter(u => !yaEstan.has(u));

      if (repetidas.length) {
        dupes.push({ playlist: pl, uris: repetidas, names: repetidas.map(nombreDe).filter(Boolean) });
      }

      if (!nuevas.length) {
        // Todo estaba ya: ni un POST.
        skipped.push({ playlist: pl, uris: repetidas, names: repetidas.map(nombreDe).filter(Boolean) });
        continue;
      }

      if (onStatus) onStatus(`Añadiendo a «${pl.name}»…`);
      const snapshot = await addTracksToPlaylist(pl.id, nuevas);

      // appendItems viene alineado con las uris de entrada, no con `nuevas`:
      // hay que filtrarlo por las que realmente se escribieron.
      const setNuevas = new Set(nuevas);
      const aAñadir = appendItems
        ? appendItems.filter(it => it?.uri && setNuevas.has(it.uri))
        : null;
      await cachearTrasEscribir(pl.id, previos, aAñadir, snapshot);
      ok.push(pl);
      detail.push({
        playlist: pl,
        added: nuevas.length,
        dup: repetidas.length,
        dupNames: repetidas.map(nombreDe).filter(Boolean),
      });
    } catch (e) {
      console.warn(`[playlist-add] «${pl.name}»:`, e.message);
      failed.push({ playlist: pl, message: e.message });
    }
  }
  return { ok, failed, skipped, dupes, detail };
}

export function listaNombres(nombres) {
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// «CANNIBALISM! ya estaba en hype drivin», «3 canciones ya estaban en hype
// drivin». Con más de dos nombres se pasa al conteo para que el toast no se
// vaya de largo.
function sujetoDuplicados(uris, names) {
  const n = uris.length;
  return (names && names.length === n && n <= 2)
    ? listaNombres(names.map(x => `«${x}»`))
    : `${n} canción${n === 1 ? '' : 'es'}`;
}

// Devuelve UNA frase. Si en todas las playlists sobraron exactamente las mismas
// canciones —el caso normal cuando eliges varias playlists de una vez— se
// nombran una sola vez y se juntan los destinos, en vez de repetir la lista
// entera por cada playlist.
function fraseDuplicados(entradas) {
  const clave = e => [...e.uris].sort().join('|');
  const iguales = entradas.every(e => clave(e) === clave(entradas[0]));
  if (iguales) {
    const { uris, names } = entradas[0];
    const verbo = uris.length === 1 ? 'ya estaba' : 'ya estaban';
    return `${sujetoDuplicados(uris, names)} ${verbo} en ${listaNombres(entradas.map(e => e.playlist.name))}`;
  }
  return listaNombres(entradas.map(({ playlist, uris, names }) =>
    `${sujetoDuplicados(uris, names)} ${uris.length === 1 ? 'ya estaba' : 'ya estaban'} en ${playlist.name}`));
}

// `what` es el sujeto ya compuesto: «CANNIBALISM!», «3 canciones», «12 pistas de
// "Donda"». `plural` decide entre "se añadió" y "se añadieron".
export function toastAddResult({ ok, failed, skipped = [], dupes = [], detail = [] }, { what, plural = false } = {}) {
  const verbo = plural ? 'se añadieron' : 'se añadió';

  // Nada que hacer: estaba todo en todas las playlists elegidas.
  if (!ok.length && !failed.length && skipped.length) {
    showToast(`${fraseDuplicados(skipped)}. No se añadió nada.`, 'warning');
    return;
  }

  if (!ok.length) {
    const detalle = failed[0]?.message ? ` (${failed[0].message})` : '';
    showToast(`${what}: no se pudo añadir a ninguna playlist${detalle}`, 'error');
    return;
  }

  // Con duplicados de por medio, `what` (el total que eligió el usuario) ya no
  // es lo que se escribió: hay que contar por playlist o el toast miente
  // diciendo "2 canciones se añadieron" cuando solo entró una.
  const hayDupes = detail.some(d => d.dup > 0);
  let cuerpo;
  if (hayDupes) {
    const partes = detail.map(({ playlist, added, dup, dupNames }) => {
      const base = `${added} añadida${added === 1 ? '' : 's'} a ${playlist.name}`;
      if (!dup) return base;
      const yaEstaban = (dupNames.length === dup && dup <= 2)
        ? `${listaNombres(dupNames.map(n => `«${n}»`))} ${dup === 1 ? 'ya estaba' : 'ya estaban'}`
        : `${dup} ya ${dup === 1 ? 'estaba' : 'estaban'}`;
      return `${base} (${yaEstaban})`;
    });
    cuerpo = `${what}: ${listaNombres(partes)}`;
  } else {
    cuerpo = `${what} ${verbo} a ${listaNombres(ok.map(p => p.name))}`;
  }

  // Las que quedaron fuera del todo (ni un POST) se nombran aparte.
  const nada = skipped.length ? `. ${fraseDuplicados(skipped)}` : '';

  if (!failed.length) {
    showToast(`${cuerpo}${nada}`, hayDupes || skipped.length ? 'warning' : 'success');
    return;
  }
  const fallidas = listaNombres(failed.map(f => f.playlist.name));
  showToast(`${cuerpo}${nada}. Falló en ${fallidas}: ${failed[0].message}`, 'warning');
}
