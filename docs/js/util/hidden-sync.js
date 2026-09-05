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
// por qué ocultarlo en #sin-clasificar. Hoy son seis.
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
} from '../api.js?v=207';
import { prefKey, migratePrefKey } from '../storage.js?v=207';
import { invalidateOwnPlaylists } from './playlist-add.js?v=207';
import { showToast } from '../ui/toast.js?v=207';

const PLAYLIST_DESC = 'Lista interna de Fonoteca: lo que ocultaste en esta vista. Si la borras, se pierden los ocultos.';

// ── Claves de preferencia por usuario (v=183) ───────────────────────────────
//
// `lsKey` (el caché LOCAL de qué está oculto — no el id de playlist, que ya
// viene prefijado desde v=163 con `idKeyFor`) vivía en una clave global: dos
// cuentas en el mismo navegador se pisaban la lista de ocultos entre sí.
//
// ⚠️ No se puede resolver el prefijo al CREAR el store (`createHiddenStore` /
// `createLocalStore` corren al importar el módulo, mucho antes de que
// `fonoteca_last_user_id` exista). Por eso `keys` se carga PEREZOSO, recién en
// el primer acceso real — para ese momento la app ya arrancó y el id está.
function loadLocal(key) {
  migratePrefKey(key);
  try {
    const arr = JSON.parse(localStorage.getItem(prefKey(key)) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function saveLocal(key, set) {
  try { localStorage.setItem(prefKey(key), JSON.stringify([...set])); } catch { /* lleno */ }
}

// ── Las uris PERSISTEN (v=205) ──────────────────────────────────────────────
//
// Hasta v=204 el mapa clave→uri era un `Map` en memoria y nada más: nacía vacío
// en cada carga de página y solo se llenaba cuando algo tocaba esa clave en la
// sesión —al ocultarla, o al leerla de los items reales de la playlist—.
//
// Eso dejaba un hueco por el que un oculto se podía perder ENTERO y en
// silencio. Si una clave estaba en el caché local pero no en la playlist (por
// ejemplo porque el ocultamiento original no llegó a resolver la uri, o porque
// alguien sacó la pista de la playlist desde la app de Spotify), la sesión que
// todavía la tenía no podía re-subirla: no sabía con qué uri representarla, y
// como esa pista ya no era candidata en ninguna vista, nadie se la iba a
// recordar nunca. La clave quedaba dando vueltas en `pendingNoUri` para siempre
// —sin subir y sin avisar— y el día que ese navegador perdiera su caché el
// oculto desaparecía sin dejar rastro en ningún lado.
//
// No había ninguna razón para que el mapa fuera volátil: el `Set` de claves ya
// se guardaba al lado, en la misma clave de localStorage y en el mismo momento.
// Guardar la uri junto a la clave es lo que le permite a `sync()` reconstruir
// la playlist sin depender de que alguien toque la pista en esta sesión.
//
// Va en una clave APARTE (`${lsKey}_uris`) en vez de cambiarle la forma al
// array de claves: el array lo leen y lo escriben las otras máquinas de Ian con
// versiones distintas de la app, y un cambio de formato ahí es exactamente el
// tipo de migración que puede tirar el dato al piso. Sumar una clave nueva no
// puede romper a nadie: quien no la conozca la ignora.
const URIS_SUFIJO = '_uris';

function urisKeyFor(lsKey) {
  return `${lsKey}${URIS_SUFIJO}`;
}

function loadUris(lsKey) {
  const base = urisKeyFor(lsKey);
  migratePrefKey(base);
  try {
    const obj = JSON.parse(localStorage.getItem(prefKey(base)) || '{}');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return new Map();
    return new Map(Object.entries(obj).filter(([, v]) => typeof v === 'string' && v));
  } catch { return new Map(); }
}

function saveUris(lsKey, map) {
  try {
    localStorage.setItem(prefKey(urisKeyFor(lsKey)), JSON.stringify(Object.fromEntries(map)));
  } catch { /* lleno */ }
}

// ── El registro de incidencias (v=205) ──────────────────────────────────────
//
// Mismo criterio que `likes_borrados_log_v1` de v=162: si el mecanismo puede
// perder algo, que quede escrito ANTES y que se pueda leer después. Ese
// registro es solo para BORRADOS de me gusta; los ocultos no tenían ninguno, y
// por eso de «La La La» (Naughty Boy / Sam Smith) no quedó ni una línea.
//
// Se guardan las últimas 100 incidencias, las más nuevas primero.
const LOG_KEY = 'ocultos_incidencias_v1';
const LOG_MAX = 100;

function anotarIncidencia(entrada) {
  try {
    const k = prefKey(LOG_KEY);
    const prev = JSON.parse(localStorage.getItem(k) || '[]');
    const arr = Array.isArray(prev) ? prev : [];
    arr.unshift({ fecha: new Date().toISOString(), ...entrada });
    localStorage.setItem(k, JSON.stringify(arr.slice(0, LOG_MAX)));
  } catch { /* lleno o sin localStorage: el console.warn ya salió igual */ }
}

export function leerIncidencias() {
  try {
    const arr = JSON.parse(localStorage.getItem(prefKey(LOG_KEY)) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ── Las claves que no se pueden representar, entre sesiones (v=205) ─────────
//
// `pendingNoUri` era un `Set` en memoria, o sea que la cuenta de «cuántas están
// atascadas» se reseteaba en cada carga y no había forma de ver que el problema
// venía de hace días. Ahora se guarda: clave → { desde, intentos, ultimoIntento }.
//
// Sirve para dos cosas: para avisar con números reales, y para no gastar una
// búsqueda por clave irrecuperable en CADA carga de página (ver `REINTENTO_MS`).
const SIN_URI_KEY = 'ocultos_sin_uri_v1';
const REINTENTO_MS = 24 * 60 * 60 * 1000;
// Tope de búsquedas de recuperación por sync. Cada una son 1-2 requests, y hay
// que dejar sitio a lo que la vista está pidiendo de verdad.
const MAX_RECUPERACIONES_POR_SYNC = 10;
const PAUSA_ENTRE_BUSQUEDAS = 150;

function leerSinUri() {
  try {
    const obj = JSON.parse(localStorage.getItem(prefKey(SIN_URI_KEY)) || '{}');
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  } catch { return {}; }
}

function guardarSinUri(obj) {
  try { localStorage.setItem(prefKey(SIN_URI_KEY), JSON.stringify(obj)); } catch { /* lleno */ }
}

export function leerSinUriPorStore() {
  const todo = leerSinUri();
  const out = {};
  for (const [id, v] of Object.entries(todo)) {
    const i = id.indexOf('::');
    if (i < 0) continue;
    const store = id.slice(0, i);
    (out[store] ||= []).push({ key: id.slice(i + 2), ...v });
  }
  return out;
}

function normName(s) {
  return (s || '').trim().toLowerCase();
}

// ── El registro de stores, para poder auditarlos todos juntos (v=205) ────────
//
// `#debug` → «Salud de los ocultos» necesita preguntarle a los seis a la vez, y
// nadie tenía la lista: cada vista creaba el suyo y se lo quedaba. Los seis
// módulos de features los importa `app.js` de forma ansiosa, así que para
// cuando se entra a `#debug` están todos registrados.
//
// ⚠️ Y esto existe porque el `console.warn` NO alcanza: la extensión de Chrome
// solo captura INFO/LOG (v=163), o sea que el aviso más importante de este
// archivo es justo el que no se puede leer desde fuera del navegador. Un
// mecanismo que puede perder datos tiene que poder mirarse desde la app.
const REGISTRO = [];

/**
 * Compara, store por store, el caché local contra la playlist de verdad.
 * No escribe nada: es una foto para mirar.
 */
export async function auditarOcultos() {
  const out = [];
  for (const s of REGISTRO) out.push(await s.auditar());
  return out;
}

const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;

/**
 * Para los stores cuya CLAVE ES el id de la pista (`#skips`, `#zero-plays`,
 * `#sin-clasificar`), la uri no hay que recordarla: se deduce. Es gratis, es
 * exacta y no depende de ninguna sesión anterior.
 *
 * El chequeo del formato no es decorativo: si mañana alguien le cambia la clave
 * a uno de esos stores, esto tiene que devolver null y que la clave caiga por
 * el camino de «no se puede representar, aviso», no fabricar una uri inventada.
 */
export function uriDeTrackId(key) {
  return TRACK_ID_RE.test(String(key || '')) ? `spotify:track:${key}` : null;
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
 * nada: son las que haría falta subir a la playlist en esa migración. Y por eso
 * desde v=205 también las PERSISTE: si el día de la migración el mapa está
 * vacío, la migración empieza con el mismo agujero que se acaba de tapar.
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
  let keys = null;   // perezoso — ver el comentario de `loadLocal`
  let uriByKey = null;
  function ensureKeys() { if (!keys) keys = loadLocal(lsKey); return keys; }
  function ensureUris() { if (!uriByKey) uriByKey = loadUris(lsKey); return uriByKey; }

  return {
    has(key) { return ensureKeys().has(key); },
    get size() { return ensureKeys().size; },
    values() { return [...ensureKeys()]; },
    // Siempre true: no hay nada remoto con lo que reconciliar, así que la vista
    // nunca tiene que esperar ni repintar por este store.
    get synced() { return true; },
    remember(key, uri) {
      if (!key || !uri) return;
      ensureUris();
      if (uriByKey.has(key)) return;
      uriByKey.set(key, uri);
      saveUris(lsKey, uriByKey);
    },
    /** No-op resuelto, para poder llamarlo igual que al store sincronizado. */
    ready() { return Promise.resolve(); },
    toggle(key, uri) {
      ensureKeys();
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
      ensureKeys();
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

/**
 * @param {object} opts
 * @param {string} opts.lsKey
 * @param {string} opts.playlistName
 * @param {(track:object)=>string|null} opts.keyOfTrack
 * @param {string} opts.label
 * @param {(key:string)=>string|null} [opts.uriFromKey]
 *        Deduce la uri de la propia clave, sin red. Para los stores cuya clave
 *        es el id de la pista: `uriDeTrackId`.
 * @param {(key:string)=>Promise<string|null>} [opts.recoverUri]
 *        Último recurso para las claves cuya uri no se puede deducir (álbumes,
 *        artistas): la busca y la CONFIRMA recalculando la clave. Devuelve null
 *        si no la puede confirmar — ver `util/hidden-recover.js`.
 */
export function createHiddenStore({ lsKey, playlistName, keyOfTrack, label, uriFromKey, recoverUri }) {
  let keys = null;   // perezoso — ver el comentario de `loadLocal`
  let uriByKey = null;   // clave → uri de la pista que la representa (persistido)
  let playlistId = null;
  let syncPromise = null;
  let synced = false;
  function ensureKeys() { if (!keys) keys = loadLocal(lsKey); return keys; }
  function ensureUris() { if (!uriByKey) uriByKey = loadUris(lsKey); return uriByKey; }

  // Claves que están en local pero todavía no subieron (sin uri conocida). No se
  // pierden NUNCA: se reintenta subirlas en cada sync, se anotan en disco
  // (`ocultos_sin_uri_v1`) y se avisan. Lo que no se hace jamás es descartarlas.
  const pendingNoUri = new Set();
  // Un aviso por tipo y por sesión: `sync()` corre en cada entrada a la vista y
  // tres toasts iguales seguidos son ruido, no información.
  const avisados = new Set();

  function avisar(mensaje, tipo) {
    if (avisados.has(tipo)) return;
    avisados.add(tipo);
    try { showToast(mensaje, tipo); } catch { /* sin DOM (tests) */ }
  }

  /** La uri con la que se puede representar `key`, sin tocar la red. */
  function uriDe(key) {
    const guardada = ensureUris().get(key);
    if (guardada) return guardada;
    const deducida = uriFromKey ? uriFromKey(key) : null;
    return deducida || null;
  }

  function recordarUri(key, uri) {
    if (!key || !uri) return false;
    ensureUris();
    if (uriByKey.get(key) === uri) return false;
    uriByKey.set(key, uri);
    return true;
  }

  function marcarSinUri(claves) {
    if (!claves.length) return;
    const reg = leerSinUri();
    const ahora = Date.now();
    for (const k of claves) {
      pendingNoUri.add(k);
      const id = `${lsKey}::${k}`;
      reg[id] = reg[id] || { desde: new Date(ahora).toISOString(), intentos: 0, ultimoIntento: null };
    }
    guardarSinUri(reg);
  }

  function olvidarSinUri(claves) {
    const reg = leerSinUri();
    let tocado = false;
    for (const k of claves) {
      pendingNoUri.delete(k);
      const id = `${lsKey}::${k}`;
      if (id in reg) { delete reg[id]; tocado = true; }
    }
    if (tocado) guardarSinUri(reg);
  }

  function tocaReintentar(key) {
    const r = leerSinUri()[`${lsKey}::${key}`];
    if (!r || !r.ultimoIntento) return true;
    return Date.now() - Date.parse(r.ultimoIntento) > REINTENTO_MS;
  }

  function anotarIntento(key) {
    const reg = leerSinUri();
    const id = `${lsKey}::${key}`;
    const prev = reg[id] || { desde: new Date().toISOString(), intentos: 0 };
    reg[id] = { ...prev, intentos: (prev.intentos || 0) + 1, ultimoIntento: new Date().toISOString() };
    guardarSinUri(reg);
  }

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
   *
   * Y desde v=205 la unión además CUENTA: lo que está solo en local se separa
   * en tres montones —lo que la playlist perdió, lo que nunca llegó a subir y
   * lo que no se puede representar— y cada uno se avisa por su nombre. Antes
   * los tres caían en el mismo silencio.
   */
  async function sync() {
    ensureKeys();
    ensureUris();
    // Foto de lo que YA sabíamos antes de mirar la playlist. Es lo que permite
    // distinguir «esto estuvo en la playlist y ya no está» de «esto nunca
    // llegó a subir»: sin la foto, después de re-aprender las uris de los items
    // remotos los dos casos son indistinguibles.
    const sabidasAlEmpezar = new Set(uriByKey.keys());
    const existing = await findPlaylist();

    if (!existing) {
      // Sin playlist: si no hay nada local tampoco, no creamos nada todavía.
      if (keys.size === 0) { synced = true; return; }
      playlistId = await ensurePlaylist();
      await reconciliar([...keys], sabidasAlEmpezar);
      synced = true;
      return;
    }

    playlistId = existing.id;
    const items = await getAllPlaylistItems(playlistId, null, { useCache: false });

    const remote = new Set();
    let sinClave = 0;
    for (const it of items) {
      const t = it?.item || it?.track;
      if (!t) continue;
      const k = keyOfTrack(t);
      if (!k) { sinClave++; continue; }
      remote.add(k);
      const uri = t.uri || (t.id ? `spotify:track:${t.id}` : null);
      if (uri) recordarUri(k, uri);
    }
    if (sinClave) {
      // Una pista en la playlist de la que no sale ninguna clave es un oculto
      // que la app no puede ver. No se toca (borrarla sería descartar dato),
      // pero tiene que decirlo.
      console.warn(`[ocultos:${label}] ${sinClave} pista(s) de «${playlistName}» no dan ninguna clave: están en la playlist pero la vista no las ve como ocultas. No toco nada.`);
    }

    const onlyLocal = [...keys].filter(k => !remote.has(k));

    // La unión es el estado nuevo.
    for (const k of remote) keys.add(k);
    saveLocal(lsKey, keys);
    // Las claves que sí están en la playlist ya no son «pendientes».
    olvidarSinUri([...remote]);
    saveUris(lsKey, uriByKey);

    if (onlyLocal.length) {
      await reconciliar(onlyLocal, sabidasAlEmpezar);
    }
    synced = true;
    console.info(`[ocultos:${label}] ${keys.size} ocultos (${remote.size} de la playlist, ${onlyLocal.length} solo en este navegador)`);
  }

  /**
   * Qué hacer con las claves que están en local y NO en la playlist.
   *
   * Regla dura: de acá no sale ninguna clave descartada. O sube, o queda
   * anotada y avisada. Ante la duda gana lo que preserve el dato.
   */
  async function reconciliar(onlyLocal, sabidasAlEmpezar) {
    // 1. Las que la playlist PERDIÓ: teníamos su uri guardada de antes, o sea
    //    que en algún momento estuvieron representadas, y hoy no están. Este es
    //    el caso de «La La La», el que hasta v=204 no dejaba ninguna huella.
    const perdidas = onlyLocal.filter(k => sabidasAlEmpezar.has(k) && uriDe(k));
    // 2. Las que nunca subieron pero se pueden representar ya (uri deducida de
    //    la clave, o aprendida en esta sesión al ocultarlas).
    const porSubir = onlyLocal.filter(k => !sabidasAlEmpezar.has(k) && uriDe(k));
    // 3. Las que no se pueden representar con lo que hay en el navegador.
    const sinUri = onlyLocal.filter(k => !uriDe(k));

    if (perdidas.length) {
      console.warn(
        `[ocultos:${label}] «${playlistName}» perdió ${perdidas.length} oculto(s) que este navegador sí tiene, ` +
        `y de los que ya conocía la uri. Los vuelvo a subir: ${perdidas.join(', ')}`
      );
      anotarIncidencia({ store: lsKey, label, tipo: 'resubida', claves: perdidas });
      avisar(
        perdidas.length === 1
          ? `«${label}»: un oculto había desaparecido de la playlist. Lo he vuelto a subir.`
          : `«${label}»: ${perdidas.length} ocultos habían desaparecido de la playlist. Los he vuelto a subir.`,
        'warning'
      );
    }

    // 4. Recuperación: buscar la uri de las que no la tienen y CONFIRMARLA.
    //    Solo para las claves que no son un id de pista —esas ya cayeron en
    //    `porSubir`— y con tope, que cada una cuesta 1-2 requests.
    const recuperadas = [];
    const irrecuperables = [];
    // El POR QUÉ de cada una que no se pudo. Sin esto el aviso dice «no puedo» y
    // se queda ahí, que es medio silencio: no se sabe si es un fallo de red, un
    // álbum que ya no existe o una clave que no se puede reconciliar nunca.
    const motivos = {};
    if (sinUri.length) {
      marcarSinUri(sinUri);
      let gastadas = 0;
      for (const k of sinUri) {
        if (!recoverUri) { motivos[k] = 'esta vista no sabe reconstruir uris'; irrecuperables.push(k); continue; }
        if (gastadas >= MAX_RECUPERACIONES_POR_SYNC) { motivos[k] = 'sin cupo de búsquedas en este sync, se reintenta en el próximo'; irrecuperables.push(k); continue; }
        if (!tocaReintentar(k)) { motivos[k] = 'ya se intentó hace menos de 24 h'; irrecuperables.push(k); continue; }
        gastadas++;
        anotarIntento(k);
        try {
          if (gastadas > 1) await new Promise(r => setTimeout(r, PAUSA_ENTRE_BUSQUEDAS));
          // `recoverUri` puede devolver `{ uri, motivo }` o una uri suelta.
          const res = await recoverUri(k);
          const uri = (res && typeof res === 'object') ? res.uri : res;
          if (uri) { recordarUri(k, uri); recuperadas.push(k); }
          else { motivos[k] = (res && typeof res === 'object' && res.motivo) || 'no se pudo confirmar ningún candidato'; irrecuperables.push(k); }
        } catch (e) {
          console.warn(`[ocultos:${label}] la búsqueda para recuperar «${k}» falló: ${e.message}`);
          motivos[k] = `la búsqueda falló: ${e.message}`;
          irrecuperables.push(k);
        }
      }
      if (recuperadas.length) {
        console.info(`[ocultos:${label}] uri recuperada y confirmada para ${recuperadas.length} clave(s): ${recuperadas.join(', ')}`);
        anotarIncidencia({ store: lsKey, label, tipo: 'recuperada', claves: recuperadas });
      }
    }

    const subir = [...perdidas, ...porSubir, ...recuperadas];
    if (subir.length) await pushMissing(subir);

    if (irrecuperables.length) {
      console.warn(
        `[ocultos:${label}] ${irrecuperables.length} oculto(s) siguen SIN poder representarse en la playlist: ` +
        `viven solo en este navegador y se perderían si borras sus datos. ` +
        `Quedan anotados en localStorage['${prefKey(SIN_URI_KEY)}'] y NO se descarta ninguno:\n` +
        irrecuperables.map(k => `  · ${k} — ${motivos[k] || 'sin motivo'}`).join('\n')
      );
      anotarIncidencia({ store: lsKey, label, tipo: 'sin-uri', claves: irrecuperables, motivos });
      avisar(
        irrecuperables.length === 1
          ? `«${label}»: un oculto vive solo en este navegador y no se ha podido subir a la playlist. Míralo en #debug → «Salud de los ocultos»: no se ha descartado.`
          : `«${label}»: ${irrecuperables.length} ocultos viven solo en este navegador y no se han podido subir a la playlist. Míralos en #debug → «Salud de los ocultos»: no se ha descartado ninguno.`,
        'warning'
      );
    }
  }

  /**
   * Sube a la playlist las claves que se puedan representar.
   *
   * ⚠️ Hasta v=204 esta función cortaba con `if (!uris.length) return;` ANTES de
   * loguear nada: si ninguna pendiente tenía uri no salía ni un `console.info`.
   * Y el `pendingNoUri.delete(k)` de abajo recorría la lista ENTERA cuando había
   * al menos una uri, así que borraba también las que no habían subido — la
   * única cuenta que existía de lo atascado se limpiaba sola.
   */
  async function pushMissing(list) {
    const uris = [];
    const subidas = [];
    const sin = [];
    for (const k of list) {
      const uri = uriDe(k);
      if (uri) { uris.push(uri); subidas.push(k); recordarUri(k, uri); }
      else sin.push(k);
    }
    if (sin.length) marcarSinUri(sin);

    if (!uris.length) {
      console.warn(`[ocultos:${label}] ninguna de las ${list.length} clave(s) pendientes tiene uri: no subo nada, y tampoco descarto nada.`);
      return;
    }

    await addTracksToPlaylist(await ensurePlaylist(), uris);
    olvidarSinUri(subidas);
    saveUris(lsKey, uriByKey);
    console.info(`[ocultos:${label}] subidas ${uris.length} pistas a ${playlistName}`);
  }

  /**
   * Foto del estado real: qué hay en local, qué hay en la playlist y qué
   * claves están en local y no en la playlist (las huérfanas). Solo lee.
   */
  async function auditar() {
    ensureKeys();
    ensureUris();
    const local = [...keys];
    const fila = {
      label, lsKey, playlistName,
      playlistId: leerIdGuardado(lsKey),
      local: local.length,
      items: 0, enPlaylist: 0, sinClave: 0,
      huerfanas: [], soloRemoto: [], sinUri: [],
      error: null,
    };
    try {
      const p = await findPlaylist();
      if (!p) { fila.playlistId = null; fila.huerfanas = local.slice(); }
      else {
        fila.playlistId = p.id;
        const items = await getAllPlaylistItems(p.id, null, { useCache: false });
        fila.items = items.length;
        const remote = new Set();
        for (const it of items) {
          const t = it?.item || it?.track;
          if (!t) continue;
          const k = keyOfTrack(t);
          if (!k) { fila.sinClave++; continue; }
          remote.add(k);
        }
        fila.enPlaylist = remote.size;
        fila.huerfanas = local.filter(k => !remote.has(k));
        fila.soloRemoto = [...remote].filter(k => !keys.has(k));
      }
    } catch (e) { fila.error = e.message; }
    fila.sinUri = fila.huerfanas.filter(k => !uriDe(k));
    return fila;
  }

  REGISTRO.push({ lsKey, label, auditar });

  return {
    /** Lectura instantánea desde el caché local. */
    has(key) { return ensureKeys().has(key); },
    get size() { return ensureKeys().size; },
    values() { return [...ensureKeys()]; },
    get synced() { return synced; },

    /** Registra la uri representativa de una clave (para poder subirla después). */
    remember(key, uri) {
      if (recordarUri(key, uri)) saveUris(lsKey, uriByKey);
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
      ensureKeys();
      ensureUris();
      const nowHidden = !keys.has(key);
      if (uri) recordarUri(key, uri);
      if (nowHidden) keys.add(key); else keys.delete(key);
      saveLocal(lsKey, keys);

      const trackUri = uriDe(key);
      // Al desocultar se olvida la uri: la clave ya no está en la lista, y
      // dejarla haría crecer el mapa sin techo. Si se vuelve a ocultar, la uri
      // llega otra vez por el `remember` del propio toggle.
      if (!nowHidden) { uriByKey.delete(key); olvidarSinUri([key]); }
      saveUris(lsKey, uriByKey);

      (async () => {
        if (!trackUri) {
          // Sin uri no hay forma de representarlo en la playlist: queda local.
          // Avisar ACÁ es lo más barato que hay — es el único momento en el que
          // se sabe de qué pista se trata y el usuario está mirando.
          if (nowHidden) {
            marcarSinUri([key]);
            console.warn(`[ocultos:${label}] «${key}» queda oculto SOLO en este navegador: no pude resolver una pista con la que representarlo en «${playlistName}».`);
            avisar(`«${label}»: esto se ha ocultado solo en este navegador, no en la playlist de Spotify.`, 'warning');
          }
          return;
        }
        const id = await ensurePlaylist();
        if (nowHidden) { await addTracksToPlaylist(id, [trackUri]); olvidarSinUri([key]); }
        else await removeTracksFromPlaylist(id, [trackUri]);
      })().catch(e => {
        console.warn(`[ocultos:${label}] no pude sincronizar «${key}»:`, e.message);
        if (nowHidden) marcarSinUri([key]);
        avisar(`«${label}»: no he podido sincronizar el cambio con Spotify (${e.message}). Sigue guardado en este navegador.`, 'warning');
      });

      return nowHidden;
    },

    /**
     * Vacía la lista, local y en la playlist.
     *
     * ⚠️ Las que no se puedan resolver quedan en la playlist y VUELVEN en el
     * próximo `sync()` por la unión. Eso no es un descuido: la alternativa es
     * borrar de la playlist algo que no sabemos identificar. Se avisa.
     */
    async clear() {
      ensureUris();
      const todas = [...ensureKeys()];
      const uris = [];
      const sinResolver = [];
      for (const k of todas) {
        const u = uriDe(k);
        if (u) uris.push(u); else sinResolver.push(k);
      }
      keys = new Set();
      saveLocal(lsKey, keys);
      uriByKey = new Map();
      saveUris(lsKey, uriByKey);
      olvidarSinUri(todas);
      anotarIncidencia({ store: lsKey, label, tipo: 'vaciada', claves: todas });

      if (uris.length) {
        const id = playlistId || await ensurePlaylist().catch(() => null);
        if (id) {
          await removeTracksFromPlaylist(id, uris).catch(e => console.warn(`[ocultos:${label}] clear:`, e.message));
        }
      }
      if (sinResolver.length) {
        console.warn(`[ocultos:${label}] al vaciar quedaron ${sinResolver.length} clave(s) sin uri: siguen en «${playlistName}» y van a volver en el próximo sync. ${sinResolver.join(', ')}`);
        avisar(`«${label}»: ${sinResolver.length} de los ocultos no se han podido quitar de la playlist de Spotify y volverán al sincronizar.`, 'warning');
      }
    },
  };
}
