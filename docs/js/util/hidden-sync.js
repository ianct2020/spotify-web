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
} from '../api.js?v=131';

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

/**
 * @param {object} opts
 * @param {string} opts.lsKey          clave de localStorage (caché local)
 * @param {string} opts.playlistName   nombre exacto de la playlist privada
 * @param {(track:object)=>string|null} opts.keyOfTrack  clave a partir de una pista de la playlist
 * @param {string} opts.label          para los logs
 */
export function createHiddenStore({ lsKey, playlistName, keyOfTrack, label }) {
  let keys = loadLocal(lsKey);
  const uriByKey = new Map();   // clave → uri de la pista que la representa
  let playlistId = null;
  let syncPromise = null;
  let synced = false;

  // Claves que están en local pero todavía no subieron (sin uri conocida). No se
  // pierden: se reintenta subirlas en cada sync.
  const pendingNoUri = new Set();

  async function findPlaylist() {
    const [me, playlists] = await Promise.all([getCurrentUserId(), getAllUserPlaylists()]);
    const target = normName(playlistName);
    const mine = playlists.filter(p => p.owner?.id === me);
    return mine.find(p => normName(p.name) === target) || null;
  }

  async function ensurePlaylist() {
    if (playlistId) return playlistId;
    const found = await findPlaylist();
    if (found) { playlistId = found.id; return playlistId; }
    const created = await createPlaylist(playlistName, PLAYLIST_DESC, false);
    playlistId = created.id;
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
