// Ocultos sincronizados entre sesiones y máquinas.
//
// Hasta v=129 las tres listas de ocultos (`skips_hidden_tracks`,
// `sin_clasificar_ocultas`, `wthree_hidden_albums`) vivían solo en
// localStorage: borrar el caché del navegador o entrar desde la otra compu
// significaba perder todo el trabajo de ocultar.
//
// Ahora la fuente de verdad es una playlist privada de Spotify por vista, donde
// cada cosa oculta es una pista de esa playlist. Se sincroniza sola entre
// dispositivos y no hace falta servidor. localStorage queda como caché local
// para que la vista pinte al instante sin esperar a la red.
//
// Son tres playlists separadas a propósito: una playlist solo guarda pistas, no
// sabe de qué vista viene cada ocultamiento, y ocultar algo en #skips no tiene
// por qué ocultarlo en #sin-clasificar.
//
// Para W-Three la clave es un álbum (`albumKey(name, artist)`), no una pista, así
// que se guarda una pista representativa del álbum y al leer se reconstruye la
// clave desde el álbum de esa pista.

import {
  getAllUserPlaylists,
  getAllPlaylistItems,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  createPlaylist,
  getCurrentUserId,
  spotifyFetch,
} from '../api.js?v=166';
import { prefKey } from '../storage.js?v=166';
import { invalidateOwnPlaylists } from './playlist-add.js?v=166';

const PLAYLIST_DESC = 'Lista interna de Fonoteca: lo que ocultaste en esta vista. Si la borrás, se pierden los ocultos.';

function loadLocal(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function saveLocal(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* lleno */ }
}

function normName(s) {
  return (s || '').trim().toLowerCase();
}

// ── Qué playlist es la nuestra: POR ID, no por nombre ────────────────────────
//
// Buscar por nombre y quedarse con la PRIMERA coincidencia es lo que dejó dos
// «fonoteca · ocultos (sin clasificar)» en la cuenta: la app leía la de 0 items
// y el oculto que vivía en la otra era invisible. El nombre NO es una clave
// —Spotify deja repetirlo— así que en cuanto sabemos el id lo guardamos y de
// ahí en más buscamos por id. El nombre queda solo como fallback de la primera
// vez, y como red por si el id guardado deja de existir.
//
// ⚠️ La clave va PREFIJADA POR USUARIO con `prefKey()` (v=159): dos cuentas en
// el mismo navegador tienen playlists distintas y el id de una no sirve para la
// otra. `prefKey` lee `fonoteca_last_user_id`, que `getCurrentUserId()` deja
// escrito de forma sincrónica, así que se llama SIEMPRE DESPUÉS de ese await —
// antes devolvería la clave pelada y guardaría el id sin dueño.
//
// No lleva `migratePrefKey()` a propósito: la clave nace prefijada en esta
// versión, no hay ningún valor viejo sin prefijo que mudar.
function idKeyFor(lsKey) {
  return prefKey(`fonoteca_hidden_pl_${lsKey}`);
}

function leerIdGuardado(lsKey) {
  try { return localStorage.getItem(idKeyFor(lsKey)) || null; } catch { return null; }
}

function guardarId(lsKey, id) {
  try { localStorage.setItem(idKeyFor(lsKey), id); } catch { /* lleno */ }
}

function olvidarId(lsKey) {
  try { localStorage.removeItem(idKeyFor(lsKey)); } catch { /* sin localStorage */ }
}

/**
 * @param {object} opts
 * @param {string} opts.lsKey          clave de localStorage (caché local)
 * @param {string} opts.playlistName   nombre exacto de la playlist privada
 * @param {(track:object)=>string|null} opts.keyOfTrack  clave a partir de una pista de la playlist
 * @param {string} opts.label          para los logs
 */
/**
 * Store SOLO local, con exactamente la misma superficie que `createHiddenStore`
 * (`has` / `size` / `values` / `synced` / `remember` / `ready` / `toggle` /
 * `clear`). Es para las listas que hoy no necesitan viajar entre máquinas —
 * "ya lo evalué" en #discover-artists — pero que mañana pueden querer hacerlo:
 * el día que se sincronicen, el cambio es reemplazar esta llamada por
 * `createHiddenStore` y darle un `playlistName`, sin tocar el que la usa.
 *
 * Por eso `remember(key, uri)` guarda las uris igual aunque acá no sirvan para
 * nada: son las que haría falta subir a la playlist en esa migración.
 *
 * @param {object} opts
 * @param {string} opts.lsKey  clave de localStorage
 * @param {string} opts.label  para los logs
 */
// Todas las playlists de ocultos se llaman «fonoteca · ocultos (algo)»:
// (sin clasificar), (skips), (descubrir) y (álbumes). Son almacenamiento
// interno de la app, no destinos: no tienen que aparecer en «Añadir a…».
export const HIDDEN_PLAYLIST_PREFIX = 'fonoteca · ocultos';

export function isHiddenPlaylistName(name) {
  return typeof name === 'string'
    && name.trim().toLowerCase().startsWith(HIDDEN_PLAYLIST_PREFIX);
}

export function createLocalStore({ lsKey, label }) {
  let keys = loadLocal(lsKey);
  const uriByKey = new Map();

  return {
    has(key) { return keys.has(key); },
    get size() { return keys.size; },
    values() { return [...keys]; },
    // Siempre true: no hay nada remoto con lo que reconciliar, así que la vista
    // nunca tiene que esperar ni repintar por este store.
    get synced() { return true; },
    remember(key, uri) {
      if (key && uri && !uriByKey.has(key)) uriByKey.set(key, uri);
    },
    /** No-op resuelto, para poder llamarlo igual que al store sincronizado. */
    ready() { return Promise.resolve(); },
    toggle(key, uri) {
      const ahora = !keys.has(key);
      if (uri) this.remember(key, uri);
      if (ahora) keys.add(key); else keys.delete(key);
      saveLocal(lsKey, keys);
      return ahora;
    },
    /**
     * Marca sin togglear. `toggle` sobre algo ya marcado lo DESMARCA, y hay
     * flujos que solo saben «esto pasó a estar resuelto» (guardar un álbum,
     * likear sus pistas) y no pueden depender de en qué estado estaba.
     * @returns {boolean} true si esta llamada lo agregó
     */
    add(key, uri) {
      if (!key) return false;
      if (uri) this.remember(key, uri);
      if (keys.has(key)) return false;
      keys.add(key);
      saveLocal(lsKey, keys);
      return true;
    },
    async clear() {
      keys = new Set();
      saveLocal(lsKey, keys);
      console.info(`[local:${label}] lista vaciada`);
    },
  };
}

export function createHiddenStore({ lsKey, playlistName, keyOfTrack, label }) {
  let keys = loadLocal(lsKey);
  const uriByKey = new Map();   // clave → uri de la pista que la representa
  let playlistId = null;
  let syncPromise = null;
  let synced = false;

  // Claves que están en local pero todavía no subieron (sin uri conocida). No se
  // pierden: se reintenta subirlas en cada sync.
  const pendingNoUri = new Set();

  /**
   * Total real de items de una playlist. `/me/playlists` NO lo trae fiable
   * desde la migración de la API (el objeto pasó a exponer `items`, no
   * `tracks`), así que se pide aparte. Es 1 request y solo se usa para
   * desempatar duplicadas, que es un caso raro.
   */
  async function totalDeItems(id) {
    try {
      const r = await spotifyFetch(`/playlists/${id}/items?limit=1`);
      return r?.total ?? 0;
    } catch { return 0; }
  }

  async function findPlaylist({ force = false } = {}) {
    // Primero el await del user id: deja `fonoteca_last_user_id` escrito, que es
    // de donde `prefKey()` saca el prefijo.
    const me = await getCurrentUserId();

    const guardado = leerIdGuardado(lsKey);
    if (guardado) {
      try {
        const p = await spotifyFetch(`/playlists/${guardado}?fields=id,name,owner(id)`);
        if (p?.id && p.owner?.id === me) return p;
        console.warn(`[ocultos:${label}] la playlist guardada ${guardado} ya no es tuya; vuelvo a buscarla por nombre`);
      } catch (e) {
        console.warn(`[ocultos:${label}] la playlist guardada ${guardado} no responde (${e.message}); vuelvo a buscarla por nombre`);
      }
      olvidarId(lsKey);
    }

    const playlists = await getAllUserPlaylists(null, { force });
    const target = normName(playlistName);
    // normName recorta: un nombre con espacios al final sigue coincidiendo.
    const candidatas = playlists.filter(p => p.owner?.id === me && normName(p.name) === target);
    if (!candidatas.length) return null;

    let elegida = candidatas[0];
    if (candidatas.length > 1) {
      const totales = await Promise.all(candidatas.map(p => totalDeItems(p.id)));
      let mejor = 0;
      totales.forEach((t, i) => { if (t > totales[mejor]) mejor = i; });
      elegida = candidatas[mejor];
      console.warn(
        `[ocultos:${label}] hay ${candidatas.length} playlists llamadas «${playlistName}»: ` +
        candidatas.map((p, i) => `${p.id} (${totales[i]} items)`).join(', ') +
        `. Uso la de MÁS items (${elegida.id}) y NO creo ninguna. Hay que fusionarlas a mano: ` +
        `lo que esté en las otras no se ve desde la app.`
      );
    }
    guardarId(lsKey, elegida.id);
    return elegida;
  }

  async function ensurePlaylist() {
    if (playlistId) return playlistId;
    const found = await findPlaylist();
    if (found) { playlistId = found.id; return playlistId; }

    // Antes de crear, releer FRESCO. El cache de `getAllUserPlaylists` dura
    // horas: una playlist creada hace un rato (en la otra compu, o a mano en la
    // app de Spotify) no está en la lista cacheada, y crearíamos una SEGUNDA con
    // el mismo nombre. Ese es exactamente el camino por el que aparecieron las
    // duplicadas, así que la relectura no es defensiva de más.
    invalidateOwnPlaylists();
    const otraVez = await findPlaylist({ force: true });
    if (otraVez) { playlistId = otraVez.id; return playlistId; }

    const created = await createPlaylist(playlistName, PLAYLIST_DESC, false);
    playlistId = created.id;
    guardarId(lsKey, created.id);
    console.info(`[ocultos:${label}] playlist creada: ${playlistName} (${playlistId})`);
    return playlistId;
  }

  /**
   * Reconcilia localStorage con la playlist. La unión gana: nada se pierde ni
   * cuando el navegador está vacío (llega todo de la playlist) ni cuando la
   * playlist todavía no existe (se sube lo que había local — la migración).
   */
  async function sync() {
    const existing = await findPlaylist();

    if (!existing) {
      // Sin playlist: si no hay nada local tampoco, no creamos nada todavía.
      if (keys.size === 0) { synced = true; return; }
      playlistId = await ensurePlaylist();
      await pushMissing([...keys]);
      synced = true;
      return;
    }

    playlistId = existing.id;
    const items = await getAllPlaylistItems(playlistId, null, { useCache: false });

    const remote = new Set();
    for (const it of items) {
      const t = it?.item || it?.track;
      if (!t) continue;
      const k = keyOfTrack(t);
      if (!k) continue;
      remote.add(k);
      const uri = t.uri || (t.id ? `spotify:track:${t.id}` : null);
      if (uri && !uriByKey.has(k)) uriByKey.set(k, uri);
    }

    const onlyLocal = [...keys].filter(k => !remote.has(k));

    // La unión es el estado nuevo.
    for (const k of remote) keys.add(k);
    saveLocal(lsKey, keys);

    if (onlyLocal.length) {
      await pushMissing(onlyLocal);
    }
    synced = true;
    console.info(`[ocultos:${label}] ${keys.size} ocultos (${remote.size} de la playlist, ${onlyLocal.length} subidos desde este navegador)`);
  }

  async function pushMissing(list) {
    const uris = [];
    for (const k of list) {
      const uri = uriByKey.get(k);
      if (uri) uris.push(uri);
      else pendingNoUri.add(k);
    }
    if (!uris.length) return;
    await addTracksToPlaylist(await ensurePlaylist(), uris);
    for (const k of list) pendingNoUri.delete(k);
    console.info(`[ocultos:${label}] subidas ${uris.length} pistas a ${playlistName}`);
  }

  return {
    /** Lectura instantánea desde el caché local. */
    has(key) { return keys.has(key); },
    get size() { return keys.size; },
    values() { return [...keys]; },
    get synced() { return synced; },

    /** Registra la uri representativa de una clave (para poder subirla después). */
    remember(key, uri) {
      if (key && uri && !uriByKey.has(key)) uriByKey.set(key, uri);
    },

    /**
     * Sincroniza con Spotify. Idempotente: llamarla muchas veces reutiliza la
     * misma promesa. Nunca lanza — si Spotify falla, la vista sigue andando con
     * el caché local.
     */
    ready() {
      if (!syncPromise) {
        syncPromise = sync().catch(e => {
          console.warn(`[ocultos:${label}] sync falló, sigo con el caché local:`, e.message);
          syncPromise = null;   // que se pueda reintentar
        });
      }
      return syncPromise;
    },

    /**
     * Oculta o desoculta. Actualiza local al instante (para que la UI responda)
     * y sincroniza la playlist en segundo plano.
     * @returns {boolean} true si quedó oculto
     */
    toggle(key, uri) {
      const nowHidden = !keys.has(key);
      if (uri) this.remember(key, uri);
      if (nowHidden) keys.add(key); else keys.delete(key);
      saveLocal(lsKey, keys);

      (async () => {
        const trackUri = uriByKey.get(key);
        if (!trackUri) {
          // Sin uri no hay forma de representarlo en la playlist: queda local.
          if (nowHidden) pendingNoUri.add(key);
          return;
        }
        const id = await ensurePlaylist();
        if (nowHidden) await addTracksToPlaylist(id, [trackUri]);
        else await removeTracksFromPlaylist(id, [trackUri]);
      })().catch(e => {
        console.warn(`[ocultos:${label}] no pude sincronizar «${key}»:`, e.message);
      });

      return nowHidden;
    },

    /** Vacía la lista, local y en la playlist. */
    async clear() {
      const uris = [...keys].map(k => uriByKey.get(k)).filter(Boolean);
      keys = new Set();
      saveLocal(lsKey, keys);
      if (uris.length && playlistId) {
        await removeTracksFromPlaylist(playlistId, uris).catch(e => console.warn(`[ocultos:${label}] clear:`, e.message));
      }
    },
  };
}
