// La copia completa (v=333, tanda 78): «Exportar todo», lo que la app guarda en el navegador y vale la pena sacar.
//
// PURO: sin red, sin DOM, sin IndexedDB y sin `localStorage`. Quien lo enchufa (`exportarCopiaCompleta()` en
// `api.js`) le pasa las claves y los valores YA LEÍDOS, el uid y el reloj; esto decide qué entra y arma el objeto.
// Así se prueba en Node (`tests/copia-completa.test.mjs`) con dobles, y la regla vive en un solo lugar.
//
// 🔴 SOLO LEE. Ni acá ni en el enchufe hay una sola escritura: ni `idbSet*`, ni `idbDel*`, ni `setItem`, ni
// `removeItem`, ni nada que las llame por debajo (`migratePrefKey`, `readLocalConfig`, `getBestAvailableLikes`,
// `cargarEtiquetas`, `idbGetCached` —que borra lo vencido al leerlo—). Lo vigila la lectura estática del test.
// El import llega con la 79; esto no lo prepara más que con el formato.
//
// 🔴 EL SECRETO, POR ESTRUCTURA: lo que sale es lo que el CENSO de abajo marca `entra: true`, y nada más. Una
// clave que no está en el censo NO sale (va a `_censo.sinCensar`, solo el nombre). Nunca «todo menos lo
// secreto». Y una segunda red en el enchufe: si el texto lleva el valor del token, del `refresh_token`, del
// `code_verifier` o de la key de Last.fm de este navegador, no se descarga (`contieneSecreto`).
//
// El formato (v3) es el v2 de `exportAllData` (`_format`, `likes`, `tags`, `_config`, `spotifyUserId`,
// `_exportedAt`, `_likesSource`) con `_version: 3` y campos que el `importAllData` de hoy ignora: `_leeme`,
// `navegador`, `_censo` y `_errores`. O sea que un v3 pasado por el import de hoy importa lo mismo que un v2.
//
// El censo entero, con el porqué de cada clase, está en `fonoteca-migracion/CENSO-NAVEGADOR-2026-10-22.md`.

import { crearAlmacenGeneros, prefijoGeneros, PREFIJO_GENEROS, CLAVE_MIGRADO } from './generos-artista.js?v=351';
import { LIKES_DE_OTRO_KEY, hayLikesDeOtro } from './likes-de-otro.js?v=351';

export const COPIA_VERSION = 3;
export const CENSO_VERSION = '2026-10-22';
export const LIKES_CLAVE = 'all_liked_tracks';
export const LIKES_LEGADO_LS = 'spc_all_liked_tracks';
export const ULTIMO_USUARIO = 'fonoteca_last_user_id';

// Las clases del censo. Las cinco del encargo de la 78 y dos que no encajan en ninguna (las preferencias y los
// registros), que entran: «ante la duda, entra», salvo que pueda ser secreta.
export const CLASES = {
  1: 'irrecuperable',          // solo vive acá y nada la rehace
  2: 'rehacible',              // se rehace, pero con el ZIP, con horas de terceros o con cuota de Spotify
  3: 'respaldada',             // tiene su playlist espejo en Spotify
  4: 'cache',                  // se vuelve a pedir sola
  5: 'secreto',                // NUNCA sale
  preferencia: 'preferencia',  // lo que el usuario eligió en una pantalla
  registro: 'registro',        // un historial de lo que pasó (incidencias, borrados, migraciones)
};

// Los seis almacenes de ocultos con playlist espejo (`createHiddenStore`, `util/hidden-sync.js`). Cada uno escribe
// tres claves de `localStorage`, todas con `prefKey()`: el conjunto (`lsKey`), las uris (`<lsKey>_uris`) y el id de
// la playlist (`fonoteca_hidden_pl_<lsKey>`).
const OCULTOS = [
  ['wthree_hidden_albums', 'features/wthree.js:166', 'álbumes ocultos de W-Three'],
  ['zeroplays_hidden_tracks', 'features/zero-plays.js:48', 'temas ocultos de «Sin plays»'],
  ['recs_ocultos', 'features/artistas-ocultos.js:56', 'artistas ocultos de las recomendaciones'],
  ['discover_ocultos', 'features/discover-common.js:1004', 'discos ocultos de Descubrir y Novedades'],
  ['sin_clasificar_ocultas', 'features/sin-clasificar.js:114', 'temas ocultos de «Sin clasificar»'],
  ['skips_hidden_tracks', 'features/skips.js:67', 'temas ocultos de #skips'],
];

// `porUsuario`: 'pref' = la clave va con `prefKey()` (`<base>__<uid>`, o `<base>` pelada sin uid todavía);
// 'clave' = el uid va dentro de la clave (el `deUsuario` da el prefijo del usuario de ahora); null = es del navegador.
// `donde`: 'idb' (la base `spotify-tools`, store `kv`), 'ls' (`localStorage`), 'ss' (`sessionStorage`), 'cache'
// (la Cache API del service worker). Solo 'idb' y 'ls' pueden entrar.
//
// `fusion` (v=334, la 79): qué hace «Importar todo» (`util/copia-importar.js`) cuando la clave YA está en el navegador y
// el archivo trae otra cosa. Si la clave falta, se escribe tal cual viene, sea cual sea. La forma de cada valor se leyó
// en su módulo dueño; la que no encajaba en su regla fue a «la tuya gana» (la tabla, con el porqué de cada una, está en
// `CLAUDE.md`, «Importar todo (v=334)»):
//   'conjunto'    un array JSON de cadenas o números: une, primero lo tuyo en su orden, después lo del archivo que falte
//   'mapa'        un objeto JSON clave → cadena: agrega las claves que faltan; si una está en los dos, gana la tuya
//   'registro'    una lista de entradas con fecha (`fechaCampo`): une por entrada exacta, las más nuevas primero, con el
//                 tope del dueño si se puede importar (`util/topes-registros.js`)
//   'discografia' la base de discografías: `fusionarBases()` de `disco-base.js` (unión por id de Spotify)
//   TUYA          todo lo demás: nada
// Las filas que no entran no llevan `fusion`.
const TUYA = 'la tuya gana';
const e =(donde, clave, clase, entra, quien, que, extra = {}) => ({ donde, clave, prefijo: false, porUsuario: null, clase, entra, quien, que, ...extra });
const p = (donde, clave, clase, entra, quien, que, extra = {}) => e(donde, clave, clase, entra, quien, que, { prefijo: true, ...extra });

export const CENSO = [
  // ── 🔴 SECRETOS: nunca salen ─────────────────────────────────────────────────────────────────
  e('ls', 'sp_access_token', 5, false, 'auth.js:146', 'el token de Spotify'),
  e('ls', 'sp_refresh_token', 5, false, 'auth.js:148', 'el refresh_token de Spotify'),
  e('ls', 'sp_token_expiry', 5, false, 'auth.js:151', 'cuándo vence el token'),
  e('ls', 'sp_code_verifier', 5, false, 'auth.js:49', 'el code_verifier del login (PKCE)'),
  e('ls', 'lastfm_api_key', 5, false, 'api/lastfm.js:41', 'la API key de Last.fm que el usuario escribió en el ⚙', { porUsuario: 'pref' }),

  // ── IndexedDB ────────────────────────────────────────────────────────────────────────────────
  // Los me gusta van en `likes` (como en el v2), no en `navegador`: la excepción de la clase 4.
  e('idb', 'all_liked_tracks', 4, false, 'api.js:468', 'los me gusta (van en `likes`, como en el v2)'),
  e('idb', 'all_liked_tracks_partial', 4, false, 'api.js:232', 'una descarga de me gusta a medias'),
  p('idb', 'discover_disco_base_v1_', 2, true, 'features/discover-common.js:97', 'la base de discografías, una por artista', { fusion: 'discografia' }),
  e('idb', 'mosaico_colores_v1', 2, true, 'features/mosaico-colores.js:289', 'la base de colores del mosaico', { fusion: TUYA }),
  p('idb', 'local_', 2, true, 'features/history-data.js:418-426, 449', 'el historial importado del ZIP y el detalle por día', { porUsuario: 'clave', deUsuario: (u) => `local_${u}_history_`, fusion: TUYA }),
  p('idb', 'mapa_artista_v1_', 2, true, 'features/mapa.js:226', 'el país de cada artista (MusicBrainz)', { porUsuario: 'clave', deUsuario: (u) => `mapa_artista_v1_${u}_`, fusion: TUYA }),
  p('idb', 'mapa_area_v1_', 2, true, 'features/mapa.js:227', 'cada área de MusicBrainz y su país', { fusion: TUYA }),
  p('idb', PREFIJO_GENEROS, 2, true, 'util/generos-artista.js:137, 174, 212', 'las etiquetas de género por artista, por fuente', { porUsuario: 'clave', deUsuario: (u) => prefijoGeneros(u), fusion: TUYA }),
  e('idb', CLAVE_MIGRADO, 'registro', true, 'util/generos-artista.js:137', 'la marca de que el blob viejo de etiquetas ya se migró', { fusion: TUYA }),
  p('idb', 'mapa_ritmo_v1_', 4, false, 'features/mapa.js:220', 'el ritmo medido del escaneo del mapa (una medición)', { porUsuario: 'clave', deUsuario: (u) => `mapa_ritmo_v1_${u}` }),
  p('idb', 'generos_ritmo_v1_', 4, false, 'features/generos.js:212', 'el ritmo medido del escaneo de géneros (una medición)', { porUsuario: 'clave', deUsuario: (u) => `generos_ritmo_v1_${u}` }),
  p('idb', 'letras_v1_', 4, false, 'ui/letra-ficha.js:93', 'las letras de lrclib, una por tema'),
  p('idb', 'history_', 4, false, 'features/history-data.js:303, 320', 'el historial horneado del owner (sale de los JSON del repo)'),
  p('idb', 'playlist_items_', 4, false, 'api.js:1032, 1043', 'el contenido de cada playlist'),
  p('idb', 'ocultos_items_v1_', 4, false, 'util/hidden-sync.js:338', 'el contenido de las playlists de ocultos'),
  e('idb', 'saved_albums_v1', 4, false, 'api.js:1494', 'los álbumes guardados'),
  p('idb', 'listened_grouped_', 4, false, 'features/listened.js:277, 317', 'la playlist «listened albums» agrupada'),
  e('idb', 'sin_clasificar_cross_v1', 4, false, 'features/sin-clasificar.js:286, 986', 'el cruce de «Sin clasificar»'),
  p('idb', 'discover_artist_id_', 4, false, 'features/discover-common.js:45, 54', 'el id de Spotify de cada artista'),
  p('idb', 'discover_scan_', 4, false, 'features/discover-common.js:900', 'el último escaneo de Descubrir y Novedades (7 días)'),
  p('idb', 'discover_artist_disco_v2_', 4, false, '(heredada: ya nadie la escribe; la lee la migración, discover-common.js:190)', 'la discografía de antes de la base (v≤228)'),
  p('idb', 'discover_artist_disco_fuente_', 4, false, '(heredada: discover-common.js:191)', 'de dónde salió esa discografía vieja'),
  p('idb', 'statsfm_top_lifetime_v1', 4, false, 'api/statsfm.js:179', 'el top de siempre de stats.fm'),

  // ── localStorage: lo que no se rehace ────────────────────────────────────────────────────────
  e('ls', 'discover_escuchados', 1, true, 'util/hidden-sync.js:57 (createLocalStore, discover-common.js:1022)', 'los discos marcados como «ya escuchado» en Descubrir', { porUsuario: 'pref', fusion: 'conjunto' }),
  e('ls', 'discover_escuchados_uris', 1, true, 'util/hidden-sync.js:104', 'la uri de cada «ya escuchado»', { porUsuario: 'pref', fusion: 'mapa' }),
  e('ls', 'listened_unreg_dismissed', 1, true, 'features/listened.js:43, 1180', 'los álbumes quitados de «Quizás escuchaste y no registraste»', { porUsuario: 'pref', fusion: 'conjunto' }),
  e('ls', 'listened_dupes_dismissed', 1, true, 'features/listened.js:52', 'los grupos marcados «no es duplicado» en #listened', { porUsuario: 'pref', fusion: 'conjunto' }),
  e('ls', 'listened_history_dismissed', 1, true, 'features/listened.js:65, 1562', 'los álbumes del historial quitados en #listened', { porUsuario: 'pref', fusion: 'conjunto' }),
  e('ls', 'versions_dismissed', 1, true, 'features/versions.js:129', 'los grupos descartados en #versions', { porUsuario: 'pref', fusion: 'conjunto' }),
  e('ls', 'genre_hidden_tags', 1, true, 'features/by-genre.js:93', 'los géneros ocultos en «Por género»', { porUsuario: 'pref', fusion: 'conjunto' }),
  e('ls', 'discoverart_elegidos', 1, true, 'util/cola-escaneo.js:31 (discover-artists.js:499)', 'los artistas elegidos a mano para escanear en Descubrir', { porUsuario: 'pref', fusion: 'conjunto' }),
  e('ls', 'newrel_elegidos', 1, true, 'util/cola-escaneo.js:31 (new-releases.js)', 'los artistas elegidos a mano para escanear en Novedades', { porUsuario: 'pref', fusion: 'conjunto' }),
  e('ls', 'likes_borrados_log_v1', 1, true, 'api.js:1304', 'los últimos 20 borrados de me gusta (para volver a darles me gusta)', { porUsuario: 'pref', fusion: 'registro', fechaCampo: 'fecha' }),
  e('ls', 'versions_supervivientes_perdidas_v1', 1, true, 'features/versions.js:846', 'las últimas 20 veces que #versions perdió la que se quedaba', { porUsuario: 'pref', fusion: 'registro', fechaCampo: 'fecha' }),

  // ── localStorage: los ocultos con playlist espejo (clase 3) ─────────────────────────────────
  ...OCULTOS.flatMap(([k, quien, que]) => [
    e('ls', k, 3, true, `util/hidden-sync.js:57 (${quien})`, que, { porUsuario: 'pref', fusion: 'conjunto' }),
    e('ls', `${k}_uris`, 3, true, 'util/hidden-sync.js:104', `la uri de cada uno (${que})`, { porUsuario: 'pref', fusion: 'mapa' }),
    e('ls', `fonoteca_hidden_pl_${k}`, 3, true, 'util/hidden-sync.js:266', `el id de la playlist espejo (${que})`, { porUsuario: 'pref', fusion: TUYA }),
  ]),
  e('ls', 'ocultos_sin_uri_v1', 3, true, 'util/hidden-sync.js:172', 'los ocultos que no tienen uri (no están en ninguna playlist)', { porUsuario: 'pref', fusion: TUYA }),
  e('ls', 'ocultos_incidencias_v1', 'registro', true, 'util/hidden-sync.js:125', 'las últimas 100 incidencias de los ocultos', { porUsuario: 'pref', fusion: 'registro', fechaCampo: 'fecha' }),
  // (v=335) La marca de los ocultos que llegaron con «Importar todo» (`util/ocultos-desde-copia.js`): un registro DE PASO,
  // que sale cuando suben. No entra: exportarla haría que un import la reviviera. Clase 4 y no «registro» (los registros
  // entran todos): perderla no pierde nada, solo cambia el texto de un aviso.
  e('ls', 'ocultos_desde_copia_v1', 4, false, 'api.js (alTerminarImport) · util/hidden-sync.js', 'qué ocultos llegaron con «Importar todo» y todavía no subieron', { porUsuario: 'pref' }),

  // ── localStorage: lo rehacible (clase 2) ─────────────────────────────────────────────────────
  e('ls', 'lastfm_artist_tags_cache', 2, true, 'api/lastfm.js:162 (heredado ≤ v=311)', 'el blob viejo de etiquetas, de antes de IndexedDB', { fusion: TUYA }),

  // ── localStorage: preferencias ───────────────────────────────────────────────────────────────
  // Las siete de `CONFIG_LOCAL_KEYS` (api.js) van, además, en `_config`, como en el v2.
  ...[
    ['listened_albums_playlist_id', 'features/listened-shared.js:45', 'la playlist «listened albums» elegida'],
    ['listened_albums_playlist_name', 'features/listened-shared.js:46', 'su nombre'],
    ['lastfm_username', 'api/lastfm.js:59', 'el usuario de Last.fm (público; ya va en `_config` del v2)'],
    ['statsfm_username', 'api/statsfm.js:16', 'el usuario de stats.fm (público; ya va en `_config` del v2)'],
    ['genre_sort_mode', 'features/by-genre.js:83', 'el orden de «Por género»'],
    ['genre_groups_mode', 'features/by-genre.js:679', 'los grupos de «Por género»'],
    ['artist_sort_mode', 'features/by-artist.js:17', 'el orden de «Por artista»'],
    ['fonoteca_theme_v1', 'ui/theme-panel.js:168', 'el tema de colores'],
    ['fonoteca_anim_v1', 'ui/reveal.js:99', 'las animaciones'],
    ['fonoteca_calendario_anio_v1', 'features/calendario.js:127', 'el año abierto en #calendario'],
    ['listened_sort_mode', 'features/listened.js:198', 'el orden de #listened'],
    ['listened_unreg_type_v1', 'features/listened.js:493', 'el filtro por tipo de «no registraste»'],
    ['listened_queue_playlist_id', 'features/listened.js:1368', 'la playlist «para cuando termine»'],
    ['listened_queue_playlist_name', 'features/listened.js:1369', 'su nombre'],
    ['wthree_playlist_id', 'features/wthree.js:288', 'la playlist «w three» elegida'],
    ['wthree_playlist_name', 'features/wthree.js:289', 'su nombre'],
    ['covers_cell_size', 'features/covers.js:48', 'el tamaño de las tapas'],
    ['covers_sort_mode', 'features/covers.js:53', 'el orden de las tapas'],
    ['covers_years_selected_v2', 'features/covers.js:62', 'los años elegidos en #covers'],
    ['covers_colors_selected_v1', 'features/covers.js:83', 'los colores elegidos en #covers'],
    ['sin_clasificar_excluidas', 'features/sin-clasificar.js:132', 'las playlists excluidas de «Sin clasificar»'],
    ['sin_clasificar_orden', 'features/sin-clasificar.js:619', 'el orden de «Sin clasificar»'],
    ['discover_filtros_v1', 'util/discover-filters.js:142', 'los filtros de Descubrir'],
    ['discoverart_filter_kind', 'features/discover-artists.js:471, new-releases.js:520', 'el tipo de lanzamiento elegido'],
    ['discoverart_filter_years', 'features/discover-artists.js:477', 'los años elegidos en Descubrir'],
    ['discoverart_loaded_more', '(heredada: solo se lee, discover-artists.js:106)', 'cuántos artistas cargar en Descubrir'],
    ['newrel_min_likes', 'features/new-releases.js:494', 'el mínimo de me gusta de Novedades'],
    ['newrel_months', 'features/new-releases.js:512', 'los meses de Novedades'],
    ['newrel_orden', 'features/new-releases.js:530', 'el orden de Novedades'],
    ['newrel_loaded_more', '(heredada: solo se lee, new-releases.js:163)', 'cuántos artistas cargar en Novedades'],
    ['zeroplays_use_statsfm', 'features/zero-plays.js:377', 'usar stats.fm en «Sin plays»'],
    ['skips_use_statsfm', 'features/skips.js:642', 'usar stats.fm en #skips'],
    ['skips_group_ids', 'features/skips.js:633', 'un arreglo activado en #skips'],
    ['skips_nearfull_fwd', 'features/skips.js:633', 'un arreglo activado en #skips'],
    ['skips_close_ok', 'features/skips.js:633', 'un arreglo activado en #skips'],
  ].map(([k, quien, que]) => e('ls', k, 'preferencia', true, quien, que, { porUsuario: 'pref', fusion: TUYA })),
  e('ls', 'versions_dry_run', 'preferencia', true, '(se pone a mano; versions.js:79 solo la lee)', 'el modo ensayo de #versions', { fusion: TUYA }),

  // ── localStorage: registros ──────────────────────────────────────────────────────────────────
  e('ls', 'discoverart_fallos', 'registro', true, 'util/escaneo-fallos.js:39', 'los escaneos que fallaron en Descubrir, con el día', { porUsuario: 'pref', fusion: TUYA }),
  e('ls', 'newrel_fallos', 'registro', true, 'util/escaneo-fallos.js:39', 'los escaneos que fallaron en Novedades, con el día', { porUsuario: 'pref', fusion: TUYA }),
  e('ls', 'versions_dry_run_log_v1', 'registro', true, 'features/versions.js:101', 'los últimos 20 ensayos de #versions', { fusion: 'registro', fechaCampo: 'fecha' }),
  e('ls', 'fonoteca_crash_log_v1', 'registro', true, 'ui/crash-guard.js:89', 'los últimos fallos de la app', { fusion: TUYA }),
  e('ls', 'fonoteca_barrido_v1', 'registro', true, 'app.js:962', 'el informe del último barrido de claves', { fusion: TUYA }),
  e('ls', 'disco_base_migracion_v1', 'registro', true, 'features/discover-common.js:239', 'el informe de la migración a la base de discografías', { fusion: TUYA }),

  // ── localStorage: caché ──────────────────────────────────────────────────────────────────────
  e('ls', ULTIMO_USUARIO, 4, false, 'api.js:1120', 'el último uid (va en `spotifyUserId`)'),
  // (v=345) La marca de que la caché de me gusta es de la cuenta anterior: de ESTE navegador, no del usuario. No entra:
  // en otro navegador escondería unos me gusta que sí son tuyos.
  e('ls', LIKES_DE_OTRO_KEY, 4, false, 'api.js (revisarCambioDeUsuario, borrarLikesDeOtro)', 'que la caché de me gusta es de otra cuenta y falta borrarla'),
  e('ls', 'fonoteca_perfil_v1', 4, false, 'app.js:133', 'el perfil de Spotify del último arranque'),
  e('ls', 'sp_granted_scopes', 4, false, 'auth.js:145', 'los permisos que dio el login (se rehacen al entrar)'),
  p('ls', 'spc_', 4, false, 'storage.js:53 (cacheSet: api.js:234, 611)', 'la caché de 24 h (playlists; y los me gusta de antes de v=86)'),
  e('ls', 'spotify_artist_imgs_v1', 4, false, 'features/artist-card.js:36', 'las fotos de los artistas'),
  e('ls', 'itunes_preview_cache_v3', 4, false, 'api/itunes.js:36', 'los previews de iTunes'),
  p('ls', 'preview_provider_map_v', 4, false, 'api/preview-providers.js:67', 'de dónde sale el preview de cada tema (v5 y las viejas)'),
  e('ls', 'deezer_preview_url_cache_v3', 4, false, 'api/preview-providers.js:96', 'los previews de Deezer'),
  e('ls', 'statsfm_track_ids_v1', 4, false, 'api/statsfm.js:72', 'los ids de stats.fm de cada tema'),

  // ── sessionStorage y Cache API: no entran nunca (se van solas) ───────────────────────────────
  e('ss', 'fonoteca_cuota_v1', 4, false, 'util/cuota.js:135', 'lo gastado de las cuotas de Spotify en esta pestaña'),
  e('ss', 'fonoteca_mosaico_diag', 4, false, 'features/mosaico-colores.js:361', 'el diagnóstico del último armado del mosaico'),
  e('ss', 'fonoteca_artist_albums_diag', 4, false, 'api.js:1583', 'el diagnóstico de `/artists/{id}/albums`'),
  p('cache', 'fonoteca-sw-', 4, false, 'sw.js:81, 99', 'los archivos de la app que guarda el service worker'),
];

// ── Qué entrada del censo le toca a una clave ──────────────────────────────────────────────────
// Para `localStorage` con `prefKey`: la base pelada (de antes de saber el uid) o `<base>__<uid>`. Una con el uid de
// OTRO usuario de este navegador se reconoce (no es un hueco del censo) pero no es de esta copia.
export function entradaDe(donde, clave, censo = CENSO) {
  for (const c of censo) {
    if (c.donde !== donde) continue;
    if (c.prefijo ? clave.startsWith(c.clave) : (clave === c.clave || (c.porUsuario === 'pref' && clave.startsWith(c.clave + '__')))) return c;
  }
  return null;
}

// ¿Es de este usuario? (solo tiene sentido para las del censo). Exportada para «Importar todo» (v=334), que decide
// con la MISMA regla qué claves del archivo son del usuario.
export function esDelUsuario(c, clave, uid, uidPref) {
  if (c.porUsuario === 'pref') return clave === c.clave || (!!uidPref && clave === `${c.clave}__${uidPref}`);
  if (c.porUsuario === 'clave') return !!uid && clave.startsWith(c.deUsuario(uid));
  return true;
}

// El uid dentro del VALOR, donde lo hay (mapa_artista_v1_ y generos_artista_v1_ lo llevan: «abc» es prefijo de
// «abc_x», y el rango de uno trae las del otro).
export const uidDelValor = (v) => (v && typeof v === 'object' ? (v.uid ?? v.value?.uid) : undefined);

/**
 * Elige las claves que salen. `idb` y `ls` son `{ clave: valor }` YA LEÍDOS. Devuelve
 * `{ idb, ls, clases, fuera, deOtro, sinCensar }`: lo que entra, la clase de cada una, cuántas no entran por su clase,
 * cuántas son de otro usuario y los NOMBRES de las que el censo no conoce (no salen).
 */
export function elegir({ idb = {}, ls = {}, uid = null, censo = CENSO }) {
  const uidPref = ls[ULTIMO_USUARIO] || null;   // lo que usa `prefKey()`
  const out = { idb: {}, ls: {}, clases: { idb: {}, localStorage: {} }, fuera: 0, deOtro: 0, sinCensar: [] };
  for (const [donde, src, dst, clasesDst] of [['idb', idb, out.idb, out.clases.idb], ['ls', ls, out.ls, out.clases.localStorage]]) {
    for (const k of Object.keys(src).sort()) {
      const c = entradaDe(donde, k, censo);
      if (!c) { out.sinCensar.push(`${donde}:${k}`); continue; }
      if (!c.entra) { out.fuera++; continue; }
      const u = uidDelValor(src[k]);
      if (!esDelUsuario(c, k, uid, uidPref) || (c.porUsuario === 'clave' && u !== undefined && u !== uid)) { out.deOtro++; continue; }
      dst[k] = src[k];
      clasesDst[k] = c.clase;
    }
  }
  return out;
}

// Los me gusta, como `leerLikesCacheados()` (api.js): el de IndexedDB si es una lista con algo, si no el heredado de
// `localStorage` (pre-v=86), si no ninguno. Sin descargar nada (el `allowFetch: false` del v2).
// (v=345) Con la marca (`util/likes-de-otro.js`), ninguno: la caché es de la cuenta anterior y la copia va firmada con
// la de ahora. No reintenta el borrado: la copia no escribe nada.
function likesDe(idb, ls) {
  if (hayLikesDeOtro(ls)) return { items: [], source: 'empty' };
  const full = idb[LIKES_CLAVE]?.value;
  if (Array.isArray(full) && full.length > 0) return { items: full, source: 'full' };
  try {
    const legado = JSON.parse(ls[LIKES_LEGADO_LS] ?? 'null')?.value;
    if (Array.isArray(legado) && legado.length > 0) return { items: legado, source: 'full' };
  } catch { /* un legado roto es como no tenerlo */ }
  return { items: [], source: 'empty' };
}

// `_config`, como `readLocalConfig()` (api.js) pero SIN mudar nada: `migratePrefKey()` copia la pelada a la
// prefijada solo si la prefijada está vacía, así que el valor que leería es la prefijada o, si no hay, la pelada.
function configDe(ls, configKeys) {
  const u = ls[ULTIMO_USUARIO] || '';
  const cfg = {};
  for (const k of configKeys) {
    const v = (u ? ls[`${k}__${u}`] : undefined) ?? ls[k];
    if (v != null) cfg[k] = v;
  }
  return cfg;
}

// `tags.entries`, como `exportarEtiquetas()` (api/lastfm.js): el MISMO almacén (`crearAlmacenGeneros`), pero con
// lectores en memoria y escritores que no hacen nada. Si el blob viejo no se migró todavía, el almacén lo mezcla
// igual que en el v2 (allí además lo escribiría; acá no).
async function etiquetasDe(idb, ls, uid, ahora) {
  if (!uid) return {};
  const pre = prefijoGeneros(uid);
  const almacen = crearAlmacenGeneros({
    leerRango: async () => Object.entries(idb).filter(([k]) => k.startsWith(pre)),
    escribir: async () => {},
    escribirVarios: async () => {},
    leerMarca: async () => idb[CLAVE_MIGRADO] ?? null,
    leerBlob: () => { try { return JSON.parse(ls.lastfm_artist_tags_cache || '{}') || {}; } catch { return {}; } },
    ahora: () => ahora.getTime(),
    avisar: () => {},
  });
  await almacen.cargar(uid);
  return almacen.exportar();
}

// En castellano de España: es lo que lee quien abra el archivo sin la app.
export const LEEME = {
  'qué es': 'Copia de seguridad de lo que Fonoteca guarda en tu navegador. Es JSON plano: se puede abrir con cualquier editor de texto. No lleva tu sesión de Spotify (ni el token ni nada que sirva para entrar en tu cuenta).',
  'cómo se vuelve a cargar': '⚙ del Dashboard → “Importar todo”. Solo agrega lo que falta y une las listas: nunca borra ni cambia lo que ya tienes.',
  _format: 'Siempre «spotify-tools-data». Los mismos campos del «Exportar JSON» de siempre (versión 2), con _version 3.',
  _exportedAt: 'Cuándo se hizo la copia (UTC).',
  spotifyUserId: 'Tu usuario de Spotify, el de la sesión con la que se hizo la copia.',
  likes: 'Tus me gusta, como los guarda la app (clave «all_liked_tracks» de IndexedDB).',
  tags: 'Las etiquetas de género de cada artista, ya decididas (de las claves «generos_artista_v1_…» de IndexedDB).',
  _config: 'Siete preferencias de localStorage: la playlist «listened albums», tus usuarios de Last.fm y stats.fm, y los órdenes de «Por género» y «Por artista».',
  navegador: 'Todo lo demás que vale la pena guardar, tal cual está en el navegador: «idb» son las claves de IndexedDB (base «spotify-tools») con su valor, y «localStorage» las de localStorage con su texto. Lo que la app vuelve a pedir sola (cachés) no está.',
  'navegador.idb': 'La base de discografías («discover_disco_base_v1_<artista>»), la base de colores del mosaico («mosaico_colores_v1»), el historial que importaste («local_<usuario>_history_<tipo>», incluido el detalle por día), los países del mapa («mapa_artista_v1_…» y «mapa_area_v1_…») y las etiquetas de género con lo que contestó cada fuente («generos_artista_v1_…»).',
  'navegador.localStorage': 'Lo que solo vive aquí (los discos que marcaste como ya escuchados, lo que quitaste de las listas de #listened y de #versions, los géneros ocultos, los artistas que elegiste a mano para escanear, los últimos me gusta borrados), los seis almacenes de ocultos con su playlist espejo, tus preferencias y algunos registros. Las claves que terminan en «__<usuario>» son tuyas; las demás, de antes de que la app supiera tu usuario.',
  'valores binarios': 'Un valor {"__tipo": "Uint8Array", "base64": "…"} es un bloque de bytes (los colores del mosaico) en base64. {"__tipo": "Map"} y {"__tipo": "Set"} llevan sus entradas en «entradas».',
  _censo: 'De qué tipo es cada clave exportada: «irrecuperable» (solo vive aquí), «rehacible» (se rehace con tu ZIP, con horas de consultas o con cuota de Spotify), «respaldada» (tiene su playlist en Spotify), «preferencia» o «registro». «sinCensar» son nombres de claves que esta versión no conoce y que por eso no se han copiado.',
  _errores: 'Las claves que no se pudieron leer. Si la lista no está vacía, la copia NO está completa.',
};

// JSON con los binarios a la vista: un `Uint8Array` con `JSON.stringify` sale como `{"0":…,"1":…}` (cuatro veces
// más grande y sin el tipo). La base de colores del mosaico guarda dos.
function aBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function reemplazo(_k, v) {
  if (v instanceof ArrayBuffer) return { __tipo: 'ArrayBuffer', base64: aBase64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) return { __tipo: v.constructor.name, base64: aBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (v instanceof Map) return { __tipo: 'Map', entradas: [...v] };
  if (v instanceof Set) return { __tipo: 'Set', entradas: [...v] };
  return v;
}
export const serializar = (copia) => JSON.stringify(copia, reemplazo);

/**
 * Arma la copia. `idb` y `ls`: `{ clave: valor }` de TODO lo leído; `errores`: `[{ donde, clave, error }]` de lo que
 * no se pudo leer; `uid`: el de la sesión (o null); `configKeys`: `CONFIG_LOCAL_KEYS`; `ahora`: un `Date`.
 */
export async function armarCopia({ idb = {}, ls = {}, errores = [], uid = null, configKeys = [], ahora = new Date(), censo = CENSO }) {
  const { items, source } = likesDe(idb, ls);
  const elegido = elegir({ idb, ls, uid, censo });
  return {
    _format: 'spotify-tools-data',
    _version: COPIA_VERSION,
    _exportedAt: ahora.toISOString(),
    spotifyUserId: uid || null,
    _likesSource: source,
    likes: { totalAtExport: items.length, items },
    tags: { entries: await etiquetasDe(idb, ls, uid, ahora) },
    _config: configDe(ls, configKeys),
    _leeme: LEEME,
    navegador: { idb: elegido.idb, localStorage: elegido.ls },
    _censo: { version: CENSO_VERSION, clases: elegido.clases, fuera: elegido.fuera, deOtroUsuario: elegido.deOtro, sinCensar: elegido.sinCensar },
    _errores: errores.map(({ donde, clave, error }) => ({ donde, clave, error: String(error) })),
  };
}

// La segunda red: ¿el texto lleva algún secreto de este navegador? `ls` es el `localStorage` leído. Devuelve los
// NOMBRES de las claves cuyo valor aparece (nunca el valor). Un valor de menos de 8 caracteres no se busca: no hay
// token tan corto y daría falsos positivos.
export function contieneSecreto(texto, ls, censo = CENSO) {
  const hallados = [];
  for (const [k, v] of Object.entries(ls)) {
    const c = entradaDe('ls', k, censo);
    if (c?.clase !== 5 || typeof v !== 'string' || v.length < 8) continue;
    if (texto.includes(v)) hallados.push(k);
  }
  return hallados;
}

/**
 * Lee el navegador con funciones inyectadas, SOLO de lectura. Primero todo IndexedDB de una (un cursor): si eso
 * tira, clave por clave, para poder nombrar la que falla (va a `errores`; nunca un archivo que parece completo y no
 * lo es). `localStorage`, clave por clave.
 *   idbTodo()      → [[clave, valor], …]
 *   idbClaves()    → [clave, …]
 *   idbLeer(clave) → valor
 *   lsClaves()     → [clave, …]
 *   lsLeer(clave)  → texto
 */
export async function leerNavegador({ idbTodo, idbClaves, idbLeer, lsClaves, lsLeer }) {
  const idb = {}, ls = {}, errores = [];
  try {
    for (const [k, v] of await idbTodo()) idb[k] = v;
  } catch (e0) {
    let claves = [];
    try { claves = await idbClaves(); } catch (e) { errores.push({ donde: 'idb', clave: '*', error: e?.message || e }); }
    for (const k of claves) {
      if (typeof k !== 'string') continue;
      try { idb[k] = await idbLeer(k); } catch (e) { errores.push({ donde: 'idb', clave: k, error: e?.message || e }); }
    }
    if (!claves.length && !errores.length) errores.push({ donde: 'idb', clave: '*', error: e0?.message || e0 });
  }
  let claves = [];
  try { claves = lsClaves(); } catch (e) { errores.push({ donde: 'localStorage', clave: '*', error: e?.message || e }); }
  for (const k of claves) {
    try { const v = lsLeer(k); if (v != null) ls[k] = v; } catch (e) { errores.push({ donde: 'localStorage', clave: k, error: e?.message || e }); }
  }
  return { idb, ls, errores };
}

/** El nombre del archivo, con la fecha LOCAL: `fonoteca-copia-AAAA-MM-DD.json`. */
export function nombreArchivo(ahora = new Date()) {
  const d = (n) => String(n).padStart(2, '0');
  return `fonoteca-copia-${ahora.getFullYear()}-${d(ahora.getMonth() + 1)}-${d(ahora.getDate())}.json`;
}
