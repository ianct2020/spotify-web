# spotify-web — Notas técnicas

## Stack
- HTML + CSS + JS vanilla, sin frameworks
- Auth: Spotify Authorization Code Flow con PKCE
- Deploy: GitHub Pages
- Cache: localStorage con TTL 24h

## Decisiones de API (junio 2026 — post migración feb 2026)
- GET playlist items: `/playlists/{id}/items` (NO `/playlists/{id}/tracks` — da 403)
- POST/DELETE playlist items: `/playlists/{id}/items` (NO `/playlists/{id}/tracks`)
- playlist items response: `items[].item` (NO `items[].track`)
- saved tracks (GET /me/tracks) sigue usando `items[].track`
- Remove from library: `DELETE /me/library?uris=spotify:track:{id},...` (NO `DELETE /me/tracks` — da 403)
  - Máximo 40 URIs por request, usa query params (no body)
- Save to library: `PUT /me/library?uris=spotify:track:{id},...` — **por QUERY, igual que el DELETE** (verificado en vivo 2026-08-15: body `{ids}` y body `{uris}` dan 400 «Missing required field: uris»; el query da 200). Hasta v=142 `saveToLibrary()` mandaba `{ids}` en el body, así que «+ Biblioteca» de #discover-artists y #new-releases fallaba siempre. Chunks de 40, como el DELETE.
- **Guardar un ÁLBUM**: `PUT /me/library?uris=spotify:album:{id}` — **verificado en vivo 2026-08-18** con el ciclo completo sobre «Kind Of Blue» (`GET /me/albums` 33 → 34 → 33). `PUT /me/albums` da **403** en las DOS formas (body `{ids}` y query `?ids=`), y `GET /me/albums/contains?ids=` también da 403: para preguntar va `GET /me/library/contains?uris=spotify:album:{id}` → `[bool]`. `GET /me/albums` sí vive (lectura, paginado, con `added_at`). **La regla general**: `/me/library` es la ruta UNIFICADA post-migración y lo que cambia es el TIPO de la uri, no la ruta; las rutas por recurso (`/me/tracks`, `/me/albums`) quedaron para leer. Chunks de 40 como el resto. Ojo: **guardar el álbum NO likea sus pistas** y likear las pistas NO hace aparecer el disco en `/me/albums` — son dos escrituras distintas, y hasta v=147 la app tenía un solo botón («+ Biblioteca») que hacía lo segundo con nombre de lo primero. **Desde v=301 «Guardar single» usa este mismo `PUT`** (un single es un objeto álbum; `guardarLanzamiento()` de `features/discover-common.js` ya no decide por tamaño ni pide el tracklist): ⚠️ **con un lanzamiento de tipo `single` NO está verificado en vivo**, solo contra la Spotify simulada (`tests/banco/escrituras.html`, «F.3 bis»). Hasta v=300 un single iba a la playlist «fonoteca · sin escuchar».
- **`GET /me/playlists` trae también las que SEGUÍS, y las ajenas están 403 para leer sus items.** Medido en vivo el 2026-08-23: 97 playlists en total, 41 propias, 56 ajenas, y `GET /playlists/{id}/items` de una ajena devuelve 403 (8 de 8 probadas). Cualquier barrido que recorra playlists tiene que filtrar por `owner.id === me.id` ANTES de pedir items, o gasta una request condenada al catch por cada ajena. El filtro compartido es `getOwnPlaylists()` de `util/playlist-add.js` (lo usan #dedupe, el picker de «Añadir a playlists» y, desde v=153, #zombies — que hasta entonces escaneaba las 97 y no terminaba nunca). Medido en #zombies con las 42 propias: **431 s la primera pasada** (caches de items fríos, se baja cada playlist entera con 600 ms de sleep entre páginas) y **20,4 s la segunda**, validando por snapshot contra el cache de IDB. O sea que el cuello de botella que queda no es el filtro sino el primer barrido.
- **Likes sin NINGÚN metadato** (los ex «0000 · Unknown» de #versions, 6 en la biblioteca de Ian): `/me/tracks` los devuelve con `name`, `artists[0].name` y `album.name` en **cadena vacía**, `duration_ms: 0`, `is_playable: false`, sin tapa y `release_date: "0000"`. Verificado el 2026-08-23: **NO son archivos locales** —la uri es `spotify:track:…` normal, así que se pueden añadir a una playlist y de hecho se hizo— y `GET /me/library/contains` los da por guardados. El nombre **no se puede recuperar por ningún lado**: `oEmbed` devuelve `title: ""` y `GET /albums/{id}` devuelve un álbum de «Various Artists» con `name: ""`, `release_date: "0000"`, sin tapa y con sus 14 pistas igual de vacías. Ojo con agruparlos: cualquier normalización por nombre+artista los manda a todos a la misma clave y los hace parecer versiones del mismo tema (era el bug de #versions hasta v=153, donde «Borrar sobrantes» habría borrado likes sin relación entre sí).
- Create playlist: `POST /me/playlists` (NO `POST /users/{id}/playlists`)
- Rate limit 429: esperar mínimo 5 segundos, Retry-After header no visible por CORS
- Endpoints deprecados (403): Audio Features, Audio Analysis, Recommendations, Related Artists, Featured Playlists, Get Several Albums/Artists, Get Artist Top Tracks, Get New Releases, GET /users/{id}, GET /users/{id}/playlists
- **Get Track / Get Several Tracks** (`GET /tracks/{id}`, `GET /tracks?ids=`): **403 confirmado 2026-07-25** (probado en vivo con token válido). NO usar para resolver tapas/metadata. Para tapas usar **oEmbed** (`https://open.spotify.com/oembed?url=spotify:track:{id}` → `thumbnail_url`, público sin auth) — así se hornean en data/listening-history.json. Ver [[spotify-web-historial-reproduccion]].
- **`preview_url`** en el objeto track: **REMOVIDO en la migración feb 2026** (confirmado 2026-07-29 con `/me/tracks?limit=5` en vivo — el campo ni siquiera aparece en la respuesta). Para reproducir 30s de preview usar el **embed iframe oficial**: `<iframe src="https://open.spotify.com/embed/track/{id}" width="100%" height="80">` — funciona sin auth, tanto para free como Premium. Usado en features/skips.js.
- **Previews 30s vía iTunes Search API** (v=88, 2026-07-29): `api/itunes.js` — `https://itunes.apple.com/search` con **CORS abierto** (`access-control-allow-origin: *`), sin auth ni key. El preview m4a arranca en el estribillo y NO suma plays al historial de Spotify. Cache en localStorage (`itunes_preview_cache_v1`, 600 entradas). Player global único en `ui/preview-player.js` (pill flotante + hover-play + evento `previewchange`). El embed iframe queda solo como fallback si iTunes no tiene el tema.
- **Match de previews contra TODOS los artistas del track** (v=142): `util/track-match.js` acepta una lista de artistas y da por bueno el candidato si coincide **cualquiera** (los umbrales y la regla de títulos cortos NO se tocaron). Dos motivos, los dos reales en VULTURES 1, acreditado al alias «¥$» (= Kanye West + Ty Dolla $ign): (1) contra «¥$» no matchea nadie, porque iTunes/Deezer lo listan como "Kanye West & Ty Dolla $ign"; (2) **«¥$» normalizado queda en la cadena vacía** (`normText` tira todo lo que no sea `[a-z0-9 ]`), así que cuando el ALIAS viene del lado del candidato —Deezer lista las pistas así— tampoco hay comparación posible: para eso está la igualdad exacta del nombre crudo. Además se prueban hasta 2 búsquedas por track (`preferredQueryArtists` manda primero un nombre buscable: «Kanye West CARNIVAL», no «¥$ CARNIVAL»). Medido en la app: VULTURES 1 pasó de **0/13 pistas con audio** (13 embeds) a **13/13** (11 Deezer + 2 iTunes). Los callers tienen que pasar `artists: [...]` — `artist` suelto sigue andando.
- **`GET /playlists/{id}?fields=snapshot_id`**: CONFIRMADO vivo (2026-07-29). `getAllPlaylistItems` lo usa para cachear items en IDB (`playlist_items_{id}`) validando por snapshot: si no cambió, carga instantánea; si nosotros escribimos, `updatePlaylistItemsCache` actualiza en el lugar (add/removeTracksFromPlaylist devuelven el snapshot nuevo).
  - ⚠️ **VA RETRASADO respecto a nuestras propias escrituras** (medido 2026-08-13). Justo después de un POST devuelve el snapshot **anterior**. Aquella medición decía 5-10 s, pero **re-medido el 2026-08-16 seguía viejo 40 SEGUNDOS después del PUT**: el retraso **no tiene cota conocida**. `/items` es correcto al instante. Por eso: (1) para cachear tras escribir, usar el snapshot que devolvió el POST, **nunca re-leerlo** (re-leerlo guarda el snapshot viejo con los items nuevos y corrompe el cache); (2) **no confiar en el cache validado por snapshot de una playlist recién escrita** — dentro de esa ventana valida contra contenido que ya cambió. `util/playlist-add.js` lleva un `escritasEnEstaSesion` por esto: sin ello el chequeo de duplicados daba por repetida una canción que ya no estaba y no la añadía; (3) **para saber si tus posiciones siguen válidas, no preguntes el snapshot: preguntá por las posiciones** con un `GET /items?offset=minPos&limit=N` dirigido (~600 ms, lo mismo que costaba el snapshot, y encima detecta ediciones de otro cliente). Es lo que hace W-Three desde v=147.
- **Cache de items: parchear, no borrar (v=147).** `updatePlaylistItemsCache(id, null, null)` hace `idbDel`. Llamarlo "para invalidar" al final de un flujo que se repite deja el cache borrado para siempre, y la operación siguiente se come un refetch entero — era el bug del guardado de W-Three (41 s el segundo guardado de la sesión, 39,6 s de ellos en 31 páginas). `util/playlist-cache-patch.js` aplica al array cacheado el mismo diff que se le mandó a Spotify: `patchPlaylistItems(items, { addItems, addInsertPos, removeUris, moves })`, en ese orden, y se guarda con el snapshot de la ÚLTIMA escritura. `applyMoveToItems` replica la semántica de `PUT /items` (`insert_before` exclusivo, corregido solo si el destino está después del origen). Para los items nuevos, `buildCachedItem(track, album)` arma la forma de la API — los campos que los lectores consumen de verdad son `uri`/`id`/`name`, `album.name` + `artists[0].name` (`util/album-heard.js`) y `album.images` (`features/covers.js`). Tests en `tests/wthree-cache-patch.test.mjs`.
- **`GET /me/top/{artists|tracks}?time_range=short|medium|long_term`**: **CONFIRMADO vivo (2026-07-29, 200 con token real)**. Usado en el Wrapped lite para users sin Extended Streaming History (wrapped.js `renderLite`). Scope `user-top-read` ya pedido.
- **Stats.fm API** (`api.stats.fm/api/v1`, CORS abierto, sin key): usada en Por género. Más endpoints investigados en /home/ian/fonoteca/consumido/STATSFM-API-2026-07-29.md (per-track stats actuales posibles vía `/search/elastic` → id interno → `/users/{u}/streams/tracks/{id}/stats`).
- **`/me/library/contains?uris=…`** (post-migración): CONFIRMADO vivo (2026-07-28). Devuelve `[bool, ...]`. El clásico `/me/tracks/contains?ids=…` está 403. **El máximo son 40 uris por request** (re-verificado en vivo 2026-08-28 con token real: 40 → 200; **41, 42, 43, 44, 45, 48, 49, 50 y 60 → 400 «Too many uris requested»**; 100 ni llega, da **414** porque se pasa del largo de URL). Mismo tope para `spotify:track:` y para `spotify:album:` — el 41 falla igual en los dos. O sea que es el mismo 40 que ya usan el PUT y el DELETE de `/me/library`: **`/me/library` entero va de a 40**. Decía «chunks de 50» y era falso — con 50 el request fallaba **siempre**. Usado en features/versions.js para verificación de borrados y en `albumsInLibrary()`. **CORREGIDO el 2026-08-28**: el número vive ahora en una sola constante, `LIBRARY_URIS_POR_REQUEST` (api.js), que usan los seis puntos que pegan a `/me/library` (los dos `contains`, el PUT y el DELETE de pistas, y el PUT y el DELETE de álbumes). **Lo que estuvo roto y por qué importa**: hasta esa fecha los dos `contains` iban de a 50, o sea que **fallaban siempre**, y el único llamador (`versions.js`) atrapaba la excepción y la reportaba con `console.warn` — que la extensión de Chrome no captura. Resultado: **todo borrado de más de 40 versiones se dio por verificado sin haberse verificado**, con toast verde. Ese es el patrón a no repetir: una verificación con un `catch` que deja seguir el flujo es peor que no tener verificación, porque da la misma cara que un resultado limpio. Ahora `checkLibraryContains()` tira también si la respuesta no trae exactamente un booleano por id, y `versions.js` aborta con toast rojo en vez de degradar.
- DELETE playlist items: body `{ items: [{uri}] }` (NO `{ tracks: [...] }` → da 400 "No uris provided")
- Campo `popularity` en `/me/tracks`: **removido en la migración feb 2026**. Confirmado 2026-07-17 con 9548 tracks reales → 100% null. No usar más. Chart de popularidad sacado del Dashboard en v=41.
- **Búsqueda** (`/search?type=album|track|artist`, con filtros `artist:"..."`): CONFIRMADO vivo (se usa en Similar y en Álbum similar v=45).
- `GET /artists/{id}/albums`: **el limit máximo bajó a 10** (re-verificado en vivo 2026-08-11: `limit` 11..20 devuelven 400 "Invalid limit", `limit=10` devuelve 200 y pagina bien con `next`/`offset` — Taylor Swift, `total: 112`). Antes (2026-08-05) 20 andaba. Nunca mandar `market=from_token`. Usado en `#discover-artists` y `#new-releases`. **Cuota propia (medido 2026-09-16, v=225): 429 `QUOTA_EXCEEDED` después de exactamente 100 requests en ~33 s (~20 artistas), y sigue en 429 más de 23 minutos. Es SOLO ese endpoint**: en el mismo minuto `/artists/{id}`, `/albums/{id}/tracks`, `/search` y `/me` dan 200. `Retry-After` ilegible (solo se leen `cache-control` y `content-type`). `getArtistAlbumsConFuente()` (api.js, v=226) va sin reintentos; ante 429 pone el nativo en **pausa de 5 min que se dobla** (tope 60) y mientras tanto usa `/search?q=artist:"X"&type=album`; ante 400/403 lo abandona para la sesión y lo dice en pantalla. **La app corta `/search` en 40** (`SEARCH_MAX_PAGES = 4`, no es la API: medido 2026-09-18, sin tope llega al 77 % del nativo y el tope real es `limit + offset ≤ 1000`), y **`/search` tiene su propia cuota**: 429 `QUOTA_EXCEEDED` tras ~700 requests, y la comparte toda la app. Desde v=229 cada discografía vive en la **base sin caducidad** `discover_disco_base_v1_{id}` (unión por id de Spotify, nunca por `albumKey`; ver `util/disco-base.js`), con su fuente y si está cortada, y `#new-releases` avisa cuántas lo están. **Nada puede borrar la base**: «Actualizar» tira solo el caché de escaneo y «Limpiar caché» la conserva; si agregás otro camino que borre IndexedDB, conservá el prefijo `DISCO_BASE_PREFIX` **y, desde v=300, `LOCAL_HISTORY_PREFIX` (`local_`, en `history-keys.js`)**: el historial que el usuario importó (ver «La importación "solo el detalle"»). La lista de lo que se conserva es una sola, `util/limpiar-cache.js`. Se mueve entre máquinas con «Exportar base» / «Importar base». El diagnóstico de la sesión se lee desde la pestaña: `sessionStorage.fonoteca_artist_albums_diag` (o `artistAlbumsDiag` exportado). **Desde v=310 lo gastado de esta cuota (y de la de `/search`) se ve además en el pie del menú**, sin abrir la consola: ver «📏 La cuota a la vista (v=310)». ⚠️ Con el `_maxRetries: 0` del nativo, un 429 tira ANTES de `avisarRateLimit()`, así que **`esperas429` no recibe los 429 del nativo** (quedan en `cambios`); el pie sí los cuenta.
- `GET /albums/{id}/tracks?limit=50`: **CONFIRMADO vivo (2026-08-16, 200 con token real)**. Lo usan W-Three (tracklist del modal por álbum), `#discover-artists` / `#new-releases` (pista representativa para el preview y para «+ Biblioteca») y, desde v=144, la **ficha de álbum**: sin el tracklist completo el ♥ marcaba todas las filas por igual, porque la lista eran solo los likes de ese disco. Ojo con el `albumId`: casi ningún llamador de `openAlbumCard()` lo trae (el mosaico, el Dashboard y el Wrapped mandan nombre + artista), así que hay que resolverlo. **Desde v=219 eso lo hace `util/album-resolver.js` y nadie más** — ver su sección más abajo; antes vivía en `album-card.js` y tenía un gemelo con `limit=1` dentro de `wthree.js`. Si no se resuelve, la ficha degrada a la lista vieja (solo likes, todos con ♥) **y ahora lo DICE en pantalla**, en vez de por `console.warn`.

## Skips crónicos: el veredicto NO va en el pipeline (v=146)
`scripts/gen-stats.py` emite **dato crudo**, no decisiones:
`{id: [ok, skip, fwd_ms[], close_ms[], gid]}`. El motivo es que decidir si un
`fwdbtn` fue un skip de verdad pide saber **qué porcentaje de la pista** se
escuchó, y eso necesita el `duration_ms`, que solo está del lado del navegador
(viene de los likes). El veredicto se arma en `src/js/features/skips.js`, con
tres toggles encendidos por defecto (juntar versiones / next al final no es
skip / cerrar cuenta como escucha).

- `gid` agrupa los ids del **mismo tema** (single, álbum, remaster, remix).
  Se calcula en el pipeline **solo por peso**: mandar los 51.335 pares
  nombre+artista para agrupar en el browser llevaba el JSON a 6,3 MB.
- La identidad vive en `src/js/util/song-identity.js` (`songKey`) y está
  **portada a Python** en `gen-stats.py` (`song_key`). **Si tocás una, tocá la
  otra** o el import BYOH agrupa distinto que el historial horneado. Verificadas
  contra 3.853 pares reales del export: 0 discrepancias.
- El filtro de emisión es `total >= 1 **or** tiene cierres`. El `or` no es
  cosmético: un id que siempre terminó en `endplay`/`logout` tiene `total = 0`
  y se caía con todos sus cierres — 5.177 ids y 6.212 cierres, el 14 % de la
  señal del mecanismo 3, que al agrupar le suma `ok` a temas que sí son
  candidatos.
- Al bumpear `SKIP_STATS_VERSION`, `OWNER_PREV_KEYS.skip` va **vacía**: reciclar
  un JSON viejo deja los toggles sin datos y sin fallar, o sea en silencio.

## Tamaño de la playlist «w three» (medido 2026-08-16)
**3.011 pistas → 31 páginas de 100.** Un refetch entero (`getAllPlaylistItems`
con `useCache:false`) cuesta 31 × ~626 ms de request + 30 × 600 ms de `sleep`
entre páginas = **~37 s**. Es el paso más caro de todo W-Three con diferencia:
cualquier camino que lo dispare convierte un guardado de 3 s en uno de 40-60 s.
Ver la sección del guardado en `fonoteca-migracion/PENDIENTES.md`.

## El checkbox genérico le gana a `.keep-check` (v=153)
`src/css/components.css` define un `input[type="checkbox"]` custom de **19x19**
para toda la app. Su especificidad (0,1,1) **le gana a una clase suelta**
(0,1,0): el bloque `.keep-check` de #versions —24x24, verde, con su propio ✓—
perdía casi todo. Medido en vivo: la caja quedaba de **24x19** (el ancho salía
del `min-width`, que no tenía rival; el alto, del genérico) y el ✓ dibujado era
el genérico, con su `left: 6px` clavado para una caja de 19 → tilde corrido
hacia la izquierda. Por eso ahora esas reglas van con
`input[type="checkbox"].keep-check` y el `::after` con un nivel más, y el ✓ es
un SVG centrado con `inset: 0` + `background-position: center` en vez de una L
rotada con offsets a mano. **Si agregás otro checkbox custom por clase, acordate
de la especificidad del genérico**, y si le pisás el `::after` anulá también su
`width`/`height`/`border`/`transform` o `inset: 0` queda sobre-restringido.

## Un solo resolutor de id de álbum (v=219)

`src/js/util/album-resolver.js` es **EL** resolutor. Hasta v=218 había dos: el de
`features/album-card.js` (`limit=5`, `limpiaParaQuery`, comparaba el resultado) y
la búsqueda de adentro de `fetchAlbumTracks()` en `features/wthree.js`
(`limit=1`, `items[0]` a ciegas, sin limpiar el apóstrofo, sin comparar nada).
El que no verificaba era el que rompía: el tracklist del modal de W-Three salía
del primer resultado que Spotify quisiera devolver.

⚠️ **Si escribís el criterio dos veces, vuelve a divergir.** El caso es
didáctico: el resolutor bueno llevaba treinta líneas de comentario explicando
por qué el apóstrofo rompe la query y por qué hay que comparar después, y a diez
archivos de distancia vivía la copia que no había aprendido nada.

El criterio, entero: `limit=5` como mínimo (nunca 1), `limpiaParaQuery` aplicado
por el resolutor —no por el llamador, que es como `wthree.js` se lo olvidaba—, y
el candidato se acepta solo si el nombre normalizado es igual, el artista pedido
está de verdad entre los del álbum, y **no trae marcadores de versión que el
pedido no traía**.

### La regla de versión va al REVÉS que la de las pistas

`util/album-version-guard.js`. Es la **simétrica** de `versionesCompatibles()`
de `util/track-match.js`, a propósito:

| | pedido SIN versión |
|---|---|
| **pistas** (`versionesCompatibles`, v=185) | acepta cualquier versión del candidato |
| **álbumes** (`candidatoTraeVersionDeMas`, v=219) | **rechaza** al candidato con versión |

**No importes aquella función ni la inviertas con un flag.** Los dos asserts
están consecutivos en `tests/album-resolver.test.mjs` para que quien las
«unifique» rompa las dos juntas.

Hace falta porque **`normText` borra los paréntesis enteros**: «Harry's House» y
«Harry's House (Piano Version)» normalizan las dos a `harrys house`, así que la
igualdad de nombre no las distingue. La regla mira el nombre **crudo** del
candidato.

Vocabulario: `VERSION_MARKERS` de `util/versions-guard.js` (la lista más
completa del repo — ya trae «piano version», «instrumental» y «karaoke») más el
de tributo, que no existía: tribute, tributo, covers, cover version, made famous
by, performed by, in the style of, homenaje.

⚠️ **Esto NO afloja `albumKey`.** El cambio es a qué id apunta la clave, no la
clave. Cuatro asserts comprueban que American Football LP2/LP3, Crystal Castles
I/II y el ÷/=/+ de Ed Sheeran siguen separados.

⚠️ **Los fracasos no se memoizan.** Un `null` guardado en el memo se lee después
como «este álbum no existe» y se queda pegado hasta recargar: un rate limit o un
corte de red condenaba la ficha a degradar el resto de la sesión. El memo guarda
solo los éxitos, y `albumTracksCache` de W-Three ya no cachea `[]` cuando la
resolución falla.

⚠️ **Pasá el `albumId` si lo tenés.** `wthree.js` lo tiene a mano cuando el
álbum tiene picks (sale de `picksByAlbum`) y hasta v=218 no se lo pasaba a
`openAlbumCard`: la ficha se comía un `/search` entero (~590-780 ms) para
averiguar algo que el llamador ya sabía. `#discover-artists` sí lo pasaba
siempre, y por eso ese camino nunca estuvo roto.

## `.wt-play-btn` es de W-Three y de nadie más (v=219)
Dos módulos no pueden ser dueños de la misma clase. `album-card.js` pintaba su
botón con `class="wt-play-btn album-modal-like-play"` para heredar el look, y
eso lo metía dentro del `document.querySelectorAll('.wt-play-btn')` del listener
de `previewchange` de `wthree.js`. Las claves de ese listener son `wt:${id}` y
**nunca** matchean el `alb:${id}` de la ficha, así que cada evento del `<audio>`
—playing, pause, waiting, ended— le borraba el ⏸ a una pista que seguía sonando.

**El look se comparte en `main.css`; la identidad no.** Si otro módulo quiere
este botón, que copie el selector en la hoja, no la clase en el HTML. Y el
arreglo va en la propiedad, **nunca** en un `:not()` dentro del listener ajeno:
eso deja la clase compartida en pie, esperando al tercer módulo.

Revisados los diez listeners de `previewchange` del repo: los otros nueve están
acotados a su contenedor por id, o barren una clase de la que su módulo es dueño
único (`.dcard-play`, que solo pinta `discover-common.js`). Este era el único
choque.

## La ficha de álbum nunca pidió el tracklist (v=154)
`resolveAlbumId()` en `features/album-card.js` usa `limpiaParaQuery`, y el
`import` **faltaba**. Como la llamada vive dentro de un `try`, el
ReferenceError caía en el `catch` y salía por consola como
`[album-card] no pude resolver el álbum: limpiaParaQuery is not defined`:
un mensaje que se lee como «Spotify no encontró el disco». Resultado: el
tracklist completo de v=144 **no se pidió NUNCA** y la ficha se caía siempre al
camino degradado de v=142 — solo tus likes, todas las filas con el ♥ lleno, y
el contador diciendo «10 pistas» en vez de «9 de 17».
Medido en producción el 2026-08-23: 6 fichas abiertas → 6 warnings.
**La lección**: un `catch` que traduce cualquier excepción a un mensaje de
dominio («no encontré el álbum») esconde los errores de programación con el
disfraz de un resultado normal. Si el `try` envuelve más que la llamada de red,
el mensaje del catch tiene que incluir el error crudo — este lo incluía, y aun
así pasaron nueve versiones sin que nadie mirara la consola.

**Costo real de la ficha de álbum**, medido en vivo el 2026-08-23 (una vez
arreglado el import):
- El modal + el esqueleto: **1-2 ms**. Aparece entero (tapa, título, artista,
  stats, botones) en el mismo paso sincrónico.
- Las pistas de verdad: **750-1.220 ms** para un álbum frío — `/search` (~590-780 ms)
  para resolver el id + `/albums/{id}/tracks` (~460-500 ms). Con el id ya
  memoizado y los tracks en IDB baja a **60-90 ms**.
  ⚠️ **Corregido el 2026-09-29**: ningún tracklist de álbum vive en IndexedDB,
  ni el de esta ficha (se pide cada vez) ni el de W-Three (un `Map` en memoria,
  `albumTracksCache`, que se vacía al recargar). Comprobado sobre las 1.049
  claves de `kv`: no hay ningún prefijo de tracklist. Los 60-90 ms de arriba no
  pueden venir de ahí; no se volvieron a medir.
  **Y W-Three ya no resuelve por `/search` los álbumes sin picks** (v=258): el
  id sale del caché de me gusta (`util/album-id-local.js`).
- O sea que la espera real que tapa el esqueleto es **~1 segundo**, no 5. Lo de
  «5 segundos mostrando nada» que reportó Ian no es esta ficha: es el modal de
  álbum de `#listened` (otro código) o la vista entera de `#covers`, que con
  2.449 tapas tarda bastante más.

## Zona horaria: las fechas del historial NO se pasan a local (v=154 + v=231)

**Medio arreglo en v=154.** Récords decía «9 ene 2026» y Wrapped «8 ene 2026»
para el mismo récord. No era el pipeline: los dos leen `"2026-01-09"`.
`new Date("2026-01-09")` —la forma **date-only**— la parsea el estándar como
medianoche **UTC**, y `getDate()` la lee en local: en Argentina (UTC−3) cae a
las 21:00 del día 8. `records.js` no se lo comía porque parte el string a mano.

Aquel arreglo dejó escrito que el timestamp completo «es un INSTANTE y
convertirlo a local es lo correcto». **Esa premisa era falsa, y costó 27
versiones.** La baldosa «Primera play» del Wrapped 2026 decía **31 dic 2025**:
la primera play del año es `"2026-01-01T00:00:28Z"` y en UTC−3 se va al año
anterior. Con el dato del repo mentían también 2018, 2023 y 2025.

⚠️ **La regla, para CUALQUIER fecha que venga de `gen-stats.py` o de
`history-processor.js`, sea del largo que sea:**

**Se enseña el día que dice el dato, y no se mueve de zona nunca.** El pipeline
agrupa todo en **UTC** (`getUTCDate`/`getUTCHours`; `peak_day`, `days.from`, el
mapa de calor y las rachas son cadenas `YYYY-MM-DD` en UTC). Pasar `first_play`
a hora local le da a esa única fecha un criterio que no usa ninguna otra fecha
de la app, y el resultado es una baldosa de un año enseñando otro año.

- `fmtDia(iso)` de **`util/fecha.js`** es la única función para esto. Lee los
  10 primeros caracteres y no construye un `Date`. Vale para las dos formas.
- `fmtDiaCorto(iso)` sigue convirtiendo a local, y es correcto: lo usan los
  cuatro sitios que formatean **`added_at`** de los me gusta
  (`sin-clasificar.js`, `artist-card.js`, `zero-plays.js`, `search-likes.js`),
  que sí es un instante — el momento en que le diste al corazón.
- **No escribas un tercer formateador.** `wrapped.js` tenía su propia
  `fmtDate()` —copia de esta, con el mismo regex— y fue la copia la que mintió;
  se borró en v=231 y la vista importa `fmtDia`. `records.js fmtDayShort` y
  `track-card.js fmtDay` parten el string y reciben solo días sueltos: no
  tienen el bug, pero son ejemplares de lo mismo y el día que se toquen, que
  sea para borrarlos.
- Guarda: **`tests/fecha-dia-del-dato.test.mjs`**, contra el JSON real del repo
  y con `TZ` fijada a Buenos Aires (en una máquina en UTC el bug no se ve).

## `stats.totals` NO trae first_play ni last_play
`gen-stats.py` las emite **solo por año**. `totals` tiene `plays_valid`,
`plays_raw`, `min`, `days_active`, `longest_streak`, `unique_artists`,
`unique_albums`, `unique_tracks` y `skip_pct`, nada más. El rango global sale de
`stats.years`, que viene **ordenado ascendente** (`years[0].first_play` y
`years[last].last_play`). En `wrapped.js` los `stats.totals?.first_play ||
years[0].first_play` de siempre funcionaban por el fallback, así que la primera
versión de `daysCovered()` (v=154) leyó `totals.last_play`, dio `undefined`, y
se fue callada al camino «devolver el año entero»: el tile seguía diciendo «de
365» y había que mirarlo en vivo para darse cuenta. Arreglado en v=155.

## Los dos «artistas» que no coinciden (v=154)
El Dashboard decía 3.353 y «Por artista» 2.211. **No es un bug y no es historial
contra likes**: los dos cuentan los MISMOS likes.
- `dashboard.js computeStats()` cuenta **todos los artistas acreditados** de cada
  track (`t.artists.forEach`), o sea con colaboraciones y «feat.».
- `by-artist.js build()` agrupa por el **artista principal** (`t.artists[0].name`),
  o sea una canción = un artista.

Medido en vivo sobre el mismo cache de 9.254 likes el 2026-08-23:
**3.351 acreditados contra 2.215 principales**, 1.136 de diferencia — artistas
que en la biblioteca de Ian solo aparecen como invitados. (Las diferencias
chicas contra los números que reportó Ian son el filtro de `isJunkTrack` del
dashboard y el `if (!t?.uri) return` de by-artist.) Desde v=154 las etiquetas
dicen «Artistas acreditados» y «artistas principales», con el porqué en el
`title`.

## El shimmer del esqueleto y prefers-reduced-motion (v=155)
`ui/skeleton.js` + el bloque `.skel` de `components.css`. El brillo es un
`background-image` con `background-size: 200%` que se desplaza un 100 % (un
ciclo entero, loop sin costura — la misma cuenta que el shimmer del sidebar).

⚠️ El primer intento de atenuarlo bajo `prefers-reduced-motion` fue un keyframe
aparte que animaba **`background-color`**, y no se veía NADA: el
`background-image` mide el 200 % del ancho y va `no-repeat`, así que **tapa el
color de fondo entero**. Atenuar por color ahí es apagar la animación sin
enterarse — justo lo que v=141 dice que no hay que hacer, y encima en silencio.
Lo que se atenúa es el **gradiente** (menos contraste entre el brillo y el
gris), conservando el mismo keyframe de `background-position` a 6,4 s en vez de
1,6 s. Verificado en vivo: bajo reduced-motion el `background-position` va de
`100%` a `81,25%` en 1,2 s — se mueve.

Ian tiene `enable-animations=false` en GNOME, o sea que el camino atenuado es
**el suyo**, no el caso raro: cualquier `animation: none` que se escriba acá lo
ve él primero.

## El menú de Home no tenía vuelta atrás (v=154)
En Home el sidebar es parte del layout (va **sin** `body.sidebar-hidden`).
Cerrarlo ponía esa clase, y **lo único que la saca es `applyRouteSidebar`, que
corre en `hashchange`**. Con el hash ya en `#home` no había ningún hashchange
que disparar: ni el hamburguesa ni el logo «Fonoteca» (un `<a href="#home">`
apuntando al hash actual). Reproducido en producción el 2026-08-23 — el menú
volvía, pero como **overlay con backdrop** encima del contenido, y el
hamburguesa quedaba **tapado debajo** (x=72, dentro de los 240px del sidebar).
Para recuperar el menú acoplado había que irse a otra ruta y volver, o recargar.

Desde v=154 el hamburguesa tiene dos comportamientos: en **Home** acopla y
desacopla (nunca overlay); en el **resto** abre overlay como siempre. Y la ✕
—que es un botón de cerrar overlay— se esconde mientras el menú está acoplado:
```css
@media (min-width: 769px) { body:not(.sidebar-hidden) .sidebar-close { display: none } }
```
Va dentro del `min-width: 769px` **por el mismo motivo que la regla de v=101**:
en mobile el sidebar es SIEMPRE overlay y ahí la ✕ tiene que quedarse.

## Marcar la vista activa: `data-route`, no `.nav-link` (v=154)
`markActiveRoute()` en `router.js` recorre **`[data-route]`**, no `.nav-link`, y
corre en el `hashchange` — el `<aside>` se arma una vez en `app.js` y no se
repinta nunca. Cubre los nav-links, las `.home-card` de `HOME_SECTIONS` y el
header del sidebar (que lleva `data-route="home"`, porque Home se entra por el
logo y era la única ruta sin marcar — justo aquella en la que el menú está
siempre a la vista).

⚠️ Se llama **dos veces**: antes del handler y después. Las `.home-card` nacen
DENTRO del handler de Home, así que con una sola pasada Home no marcaba nada.
🟩 **Desde v=309 la segunda pasada pregunta por la vigencia** (`if (rutaVigente(gen))`):
si saliste a mitad de la carga, la ruta vieja ya no marca nada al terminar. Ver «El router
también pregunta por la vigencia (v=309)».

⚠️ `data-route` tiene que coincidir con el hash **exacto**. Hasta v=153 dos no
coincidían (`discoverartists` contra `#discover-artists`, `newreleases` contra
`#new-releases`) y esos dos links no se marcaban nunca. Si agregás una ruta,
copiá el hash tal cual.

## La primera escucha sale del pipeline, no del JSON de álbumes (v=157)
Las fichas de artista y de álbum muestran «primera vez» con la fecha entera. El
dato **no existía**: `gen-stats.py` emitía solo el AÑO (`artist_first_year`), y
la `date` de `history-listened-albums.json` es el primer día que el álbum cumplió
el umbral de «escuchado» (4 pistas o 25 min el mismo día), que es otra cosa.

Ahora el pipeline emite el día de la primera play **válida (≥30 s)**:
- `history-artist-tracks` **v2**: `totals[artista]` pasa de 5 a **6** campos, el
  último es `"YYYY-MM-DD"`.
- `history-track-plays` **v5**: cada entrada de `albums` pasa de 4 a **5** campos,
  el quinto es `"YYYY-MM-DD"`.
Los dos son **append**, así que un lector viejo que desestructure los primeros
campos sigue andando. `history-processor.js` (el import BYOH) hace lo mismo.
Las dos `OWNER_PREV_KEYS` van **vacías**: reciclar el JSON anterior dejaría la
ficha sin fecha y sin fallar, o sea en silencio.
**Desde v=308 (`history-artist-tracks` v3) `totals[artista]` tiene OCHO campos**: el 7.º es
el tema de entrada y el 8.º el día del segundo tema (ver «🚪 `#puertas`», abajo).

⚠️ **La fecha del álbum se resuelve por `coverId()`, no por `albumKey()`.** Es el
mismo motivo que los plays de v=140: el export parte los discos colaborativos en
varias claves y cada una tiene SU primera vez. VULTURES 1 da **10 feb 2024** como
«Kanye West» y **16 feb 2024** como «¥$». `lookupAlbumStats` devuelve el
**mínimo** de las claves que comparten tapa — verificado en producción: la ficha
dice 10 feb 2024.

**No se muestra «última vez» en las fichas de artista/álbum, a propósito**: el
export termina en julio, así que la última escucha registrada no es la última de
verdad. La ficha de canción sí la muestra, pero ahí el par primera/última se lee
como el rango del historial y estaba desde antes.

## «Sus álbumes» de la ficha de artista (v=157)
`util/artist-albums.js`. La lista sale del historial (`history-track-plays.json`,
campo `albums`), **no de `/artists/{id}/albums`**: ese pagina de a 10
post-migración, cuesta una ristra de requests por ficha y trae discos que nunca
sonaron.

Las tapas salen de dos fuentes locales, las dos ya descargadas:
`history-listened-albums.json` primero y, si falta, el **cache de likes**
(`album.images`). La segunda no es un lujo: la primera solo cubre los discos que
alguna vez cumplieron el umbral de «escuchado», y **los singles no lo cumplen
nunca** — 2 de los 7 álbumes de «¥$» salían con el placeholder ♪.

⚠️ El truco del layout: la columna es `position:absolute` dentro de su celda del
grid (`.ac-albums` relativa, `.ac-albums-inner` con `inset: 0`). Si estuviera en
el flujo normal, sus 26 tapas definirían la altura de la fila y el modal se iría
a 85vh **siempre**. Así la altura la fija la columna izquierda y la lista
scrollea adentro. Medido en producción con Kanye West: columna 375 px, contenido
3.774 px. Abajo de 900px el mismo markup pasa a horizontal (`flex-direction: row`
+ `overflow-x: auto`), verificado en un viewport de 696 px.

## Paleta de colores (v=157)
`ui/theme-panel.js` + el botón «Paleta» del footer del sidebar. Escribe las
variables de `theme.css` **inline en `:root`** (le gana a la hoja) y las guarda en
`localStorage['fonoteca_theme_v1']`. `applyStoredTheme()` se llama en `app.js`
ANTES de armar nada: si se llamara después del primer render, el tema elegido
entraría como un flash de la paleta vieja.

Se eligen **8** colores; el resto se **deriva**, y ahí está lo que importa:
- `--color-accent-hover/soft/tint/glow` salen del acento. Dejarlas fijas
  significa un tema ámbar con el halo violeta de las tarjetas seleccionadas
  (`--color-accent-tint` se usa en 15 sitios).
- `--color-surface-hover` se mezcla hacia el **texto**, no hacia el blanco: en un
  tema claro «más claro» no se ve y el hover desaparecía.

**El tema claro se probó en producción** (preset «Papel»): Dashboard con los
cinco charts, Récords, Wrapped, buscador, sidebar, modales y las tres fichas.
Los `box-shadow` y los backdrops son negros con alpha y sobre claro quedan bien.
Lo que NO acompaña al tema, y sigue legible igual: los ticks de los charts
(`#8888A0` hardcodeado en `dashboard.js` y en las fichas) y el tooltip del
mosaico (`rgba(20,20,28,.95)` con texto blanco, que trae su propio fondo).

## `--color-text-muted` pasa AA en los cuatro presets, y los temas ya guardados se migran (v=290)

La tanda 38 midió el muted contra `--color-surface` en **2,48 · 3,00 · 3,02 · 3,52**
(violeta, ámbar, aguamarina, papel) y AA pide 4,5:1; contra `--color-elevated` era peor
(2,27 · 2,73 · 2,73 · 2,98). Lo usan **116 reglas de CSS** (106 de `color`, 2 de `border-color`
—`.cluster-dismiss:hover` y `.skips-chip:hover`—, 1 de `background` —la perilla de
`.theme-switch-knob`—…) **y 173 estilos en línea de JS** (57 solo en `listened.js`).

| preset | viejo | nuevo | bg · surface · elevated |
|---|---|---|---|
| violeta | `#55556A` | `#858595` | 5,44 · 4,95 · 4,54 |
| ámbar | `#6B6353` | `#8E8678` | 5,49 · 4,96 · 4,50 |
| aguamarina | `#4E6A63` | `#748D86` | 5,44 · 5,00 · 4,52 |
| papel | `#8B85A0` | `#6D6880` | 4,90 · 5,33 · 4,51 |

El criterio: ≥ 4,5:1 contra los TRES fondos, el mismo tono (solo se mueve la luminosidad,
mezclando hacia `--color-text`, como `expandTheme()` con el hover), el más cercano al viejo
que cumpla, y por debajo de `--color-text-secondary`. **En Violeta el margen es mínimo** —
secondary da 5,71 · 5,20 · 4,77 — y los dos niveles quedan a 0,27 · 0,25 · 0,23 de contraste:
casi iguales. Se pagó igual (la tarea era llegar a 4,5 y nada más); unificarlos o inventar un
tercer tono es otra decisión. Vive en DOS sitios para Violeta, que tienen que quedar iguales
(`css/theme.css` y `ORIGINAL` de `ui/theme-panel.js`; lo vigila el test).

🔴 **`write()` guarda los OCHO colores y `applyStoredTheme()` los repinta tal cual**, así que
cambiar `PRESETS` no le cambia nada a quien ya eligió un preset. `migrarTemaGuardado()`
(`theme-panel.js`) migra **solo si los ocho colores guardados coinciden exactamente** (hex
sin distinguir mayúsculas) con los ocho VIEJOS de uno de los cuatro presets —hasta v=290, la tabla
`MUTED_ANTERIOR` (los siete colores de hoy más el muted de antes); desde v=291, `PALETAS_ANTERIORES`, ver abajo—. Un solo color distinto es
una paleta tocada a mano: no se toca, **diga lo que diga el campo `preset`**. Es lo único de
la tanda que escribe sobre un estado del usuario. Sigue siendo SINCRÓNICA. ⚠️ **Si alguna
vez se cambia OTRO color de un preset, hay que ampliar esa tabla a los ocho viejos enteros.**

`tests/tema-contraste.test.mjs` (89 en v=290; 161 desde v=291): la cuenta (WCAG 2.x) y las ramas de la migración —preset
intacto migra, un color distinto no, `preset: null` a mano no, sin tema no hace nada, hex en
minúsculas, guardado corrupto, siete de ocho colores, idempotencia—. Antes de él ninguna puerta
medía el contraste de los tokens del tema: `familia-color.test.mjs` mide las doce pastillas de
`#covers`, que son colores fijos.

### En Violeta el secundario sube a `#9494A9` (v=291)

Con el atenuado de v=290, en Violeta los dos niveles quedaron a **0,27 · 0,25 · 0,23** de
contraste: el mismo gris (en los otros tres presets, 1,13 a 1,75). Se **sube el secundario**, no
se baja el atenuado: legible gana sobre bonito, y el atenuado acaba de llegar a AA.

| Violeta | color | bg · surface · elevated | separación con el atenuado | hasta el texto `#F0F0F5` |
|---|---|---|---|---|
| secundario antes | `#8888A0` | 5,71 · 5,20 · 4,77 | 0,27 · 0,25 · 0,23 | 11,67 · 10,62 · 9,74 |
| secundario ahora | `#9494A9` | 6,65 · 6,05 · 5,55 | **1,21 · 1,10 · 1,01** | 10,74 · 9,77 · 8,96 |
| atenuado (no cambió) | `#858595` | 5,44 · 4,95 · 4,54 | — | — |

El criterio es el de v=290: el mismo tono (240°, violáceo), mezclado hacia `--color-text`, **el
más cercano al viejo que deja ≥ 1,0 de separación contra los tres fondos**. El margen contra
`--color-elevated` es mínimo (1,01): el paso anterior (`#9393A9`) no llega. Vive en los mismos
DOS sitios (`css/theme.css` y `ORIGINAL` de `ui/theme-panel.js`). Los otros tres presets no se
tocaron. ⚠️ Los `#8888A0` **hardcodeados** de los ticks de los charts (`dashboard.js`,
`artist-card.js`, `track-card.js`) NO siguen al tema y no se tocaron.

**v=293 (tanda 42): el secundario sube otra vez, a `#9898AD`.** El 1,01 contra `--color-elevated`
pasaba raspando: el criterio de v=291 era «el más cercano al viejo que deje ≥ 1,0» y se quedó en
el primer color que cumplía. `#9898AD` es el mismo tono (240°), sobre la misma recta de mezcla de
`#8888A0` hacia `--color-text`:

| Violeta | bg `#0A0A0F` · surface `#16161F` · elevated `#1E1E2A` | separación con el atenuado | hasta el texto `#F0F0F5` |
|---|---|---|---|
| secundario de v=291 `#9494A9` | 6,65 · 6,05 · 5,55 | 1,21 · 1,10 · **1,01** | 10,74 · 9,77 · 8,96 |
| secundario de v=293 `#9898AD` | 6,99 · 6,36 · 5,83 | 1,55 · 1,41 · **1,29** | 10,40 · 9,46 · 8,68 |

Mismos DOS sitios (`css/theme.css` y `ORIGINAL`). El piso general del test sigue en 1,0 (los otros
tres presets dan 1,13 y no se tocaron); **solo Violeta** lleva además un piso de 1,25 contra los
tres fondos. Los `#8888A0` hardcodeados de los charts siguen sin tocarse.

🔴 **La migración ya no es «el muted de antes»: son las paletas viejas ENTERAS**
(`PALETAS_ANTERIORES`, los ocho colores escritos a mano; `MUTED_ANTERIOR` ya no existe). Es la
advertencia que dejó v=290, cumplida. Violeta tiene **dos**: la de v=157-v=288 (atenuado
`#55556A`) y la de v=290 (atenuado `#858595`, secundario todavía `#8888A0`). Las dos terminan en
la de hoy **en una sola carga** —la migración no encadena pasos, va directo de cualquier paleta
vieja a la actual— y solo reescribe los colores que cambiaron. La regla no cambió: **los ocho
tienen que coincidir exacto**, o no se toca. Probado en el navegador el 11/10 con tres perfiles
(v=288, v=290 y uno con el borde tocado a mano, que no migró). ⚠️ **Al cambiar otro color de
cualquier preset: agregar a esa tabla la paleta de HOY, entera, antes de tocar `PRESETS`.**

🔴 **Desde v=293 Violeta tiene TRES paletas viejas**: a las dos de arriba se suma la de
v=291-v=292 (secundario `#9494A9`, atenuado `#858595`, `hasta: 292`). Las tres terminan en la de
hoy en una sola carga. Probado en el navegador el 11/10 con otros tres perfiles: la de v=290 y la
de v=291 migran a `#9898AD`; la de v=291 con el borde tocado a mano no migra y conserva su
`#9494A9`. La advertencia de arriba se cumplió otra vez, y sigue valiendo para el próximo cambio.

`tests/tema-contraste.test.mjs` pasó de 89 a 161: la separación ≥ 1,0 en los cuatro presets, el
secundario en AA y por debajo del texto, y los dos Violeta viejos. Visto fallar con `#8888A0`.
En v=293, 186: el piso de 1,25 de Violeta y el tercer Violeta viejo. Visto fallar con `#9494A9`
y sin la entrada `hasta: 292`.

## `.covers-chip.is-on`: el anillo en vez del blanco sobre el acento (v=290)

Toda pastilla elegida de `#covers` pintaba `color: white` sobre `background: var(--color-accent)`:
violeta 5,70 · **ámbar 2,84** · **aguamarina 1,89** · papel 7,10 — fallaba AA en dos de los
cuatro presets. Ahora `.covers-chip.is-on` conserva el fondo y el texto (`--color-surface` y
`--color-text`) y marca la selección con `border-color: var(--color-accent)` y
`box-shadow: 0 0 0 2px var(--color-accent)`, igual que las pastillas de color desde v=288.
Alcanza a TODA `.covers-chip.is-on`: las de año y el «Todos» de cada fila. `.covers-chip-color.is-on`
y `.covers-chip-sincolor.is-on` la pisan (misma especificidad, van después: **si se reordenan
dejan de pisarla**; lo vigila `tests/covers-chip-elegida.test.mjs`). El `:hover` de una elegida no
hace nada, igual que antes de este cambio. **Solo esta regla**: hay ~30 `color: white`/`#fff` más en
las hojas (inventario en `fonoteca-migracion/PENDIENTES.md`) que no se tocaron.

## PENDIENTES anotados en v=157
- ~~**La clave del tema no tiene prefijo por usuario.**~~ ✅ **Resuelto en
  v=159**: `prefKey()` en `storage.js`, aplicado a `fonoteca_theme_v1` y
  `fonoteca_anim_v1`, con migración del valor guardado. **Siguen sin prefijo las
  otras ~8 claves de preferencia** — ver la sección de arriba.
- **Los cuatro .txt gitignoreados de la raíz** (`RESUMEN-MAESTRO.txt`,
  `FONOTECA-funciones-y-pendientes.txt`, `FONOTECA-PROMPT-PARA-OTRA-IA.txt`,
  `NEXT-PROMPT.txt`) **NO se borran**: son doc viva y se actualizan cada tanda.
  `FONOTECA-funciones-y-pendientes.txt` es el único inventario de funciones,
  bugs abiertos y pendientes que existe. (En la tanda 8 se pidió borrarlos y
  después Ian retiró el pedido: seguí actualizándolos.)
- ~~**#covers congela el renderer** con 2.449 tapas (viene de la tanda 7).~~
  ✅ Cerrado en v=181 (2026-09-01) — **y REABIERTO el 2026-09-03**: el arreglo
  de v=181 metió un bucle de carga/descarga que dejaba la grilla vacía en Mini y
  Chico. ✅ **Cerrado de verdad en v=193/194**, ver la sección «El tope de
  `lazy-img` no puede blanquear lo que se está viendo». Tabla completa
  antes/después en `/home/ian/fonoteca/consumido/mediciones/MEDICION-COVERS-2026-09-03.txt`.
- **La playlist «fonoteca · sin escuchar» no existe en la cuenta de Ian**
  (verificado 2026-08-28 contra sus 39 propias). El criterio `sinescuchar` de
  v=165 la cruza igual y descarta 0 hasta que aparezca. Falta saber dónde
  fueron a parar los singles que Ian dice haber guardado desde la tanda 4.
- **El gate del arranque es una sola request a `/me`, y `/me` es lo que se
  rate-limitea.** El 2026-08-29, con `/me` en 429 `QUOTA_EXCEEDED`, `GET
  /albums/{id}/tracks` devolvía **200**: la app entera estaba caída con el resto
  de la API sana. Como el user id ya está en `fonoteca_last_user_id`, el
  arranque podría degradar a ese valor en vez de mostrar la pantalla de bloqueo.
- **Zapear de ruta rápido con los caches fríos dispara el crash-guard**:
  «Algo falló por detrás: Cannot set properties of null (setting 'onclick')».
  Es el render asíncrono de alguna vista terminando DESPUÉS de que el router ya
  cambió de ruta y escribiendo un `onclick` sobre un nodo que ya no está.
  Reproducido el 29/08 saltando entre 8 vistas pesadas cada 200 ms; con los
  caches calientes no aparece. No se identificó cuál de las vistas es.
- **El `<audio>` de `ui/preview-player.js` no tiene listener de `error`.** Una
  URL de preview muerta deja el pill diciendo «vía iTunes» sin sonar y sin
  avisar. Medido el 29/08 sobre las 59 URLs de `#skips`: 59/59 cargan, así que
  hoy no molesta — pero el día que moleste, el síntoma va a ser silencio y no
  un error.
- ~~**Queda flojo el match de un tema pedido SIN versión contra un candidato CON
  versión**~~ ✅ **Apretado en v=185 (2026-09-01)**. Medido ANTES de tocar
  código, con el mismo método de la tanda v=150 (100 tarjetas al azar de
  `#skips`, 100 de `#sin-clasificar`, secuencial y con pausa contra iTunes —
  no en paralelo, que en v=150 le hizo cortar a Apple y falseó la medición):

  | | itunes | deezer | embed |
  |---|---:|---:|---:|
  | `#skips` antes | 77 | 20 | 3 |
  | `#skips` después | 79 | 20 | **1** |
  | `#sin-clasificar` antes | 79 | 19 | 2 |
  | `#sin-clasificar` después | 79 | 19 | 2 |

  Dos cambios en `track-match.js`: `EDITION_TAIL` suma «from…» como cola de
  atribución a película/serie (no es una versión distinta, es ruido — se borra
  igual que "remaster"), y `versionesCompatibles()` deja de exigir que las dos
  colas de versión estén vacías: un pedido SIN versión ahora acepta cualquier
  versión del candidato. La dirección contraria no se tocó — pedir un remix
  sigue sin aceptar el original.

  **Los únicos dos cambios reales de los 200** fueron «Honest - From The
  Amazing Spider-Man 2 Soundtrack» (The Neighbourhood) y «Time - From the
  Motion Picture "Amsterdam"» (GIVĒON), los dos de embed a iTunes.
  **Verificados a mano contra lo que devolvió iTunes**: la misma canción, el
  mismo artista, sin ningún falso positivo. El resto de los 200 —incluidos
  los que ya resolvían por iTunes/Deezer antes del cambio— resolvió por el
  MISMO proveedor que antes, id por id: la vía nueva (`versionesCompatibles`)
  no desplazó ningún match existente por uno distinto. `preview_provider_map`
  sube a v5 porque la comparación cambió. 8 asserts nuevos en
  `tests/track-match-version.test.mjs` (26 en total). Ver la sección de v=167
  para el caso que dejó esto documentado originalmente.
- **`#new-releases` no tiene los chips de tipo** (Todo / Álbumes / EPs /
  Singles). Los de v=165 se pusieron solo en `#discover-artists`, que era donde
  el EP quedaba escondido; en Novedades no hay filtro por tipo y no esconde
  nada, pero las dos vistas ya no ofrecen lo mismo.

## Animaciones de entrada al scrollear (v=159)
`src/js/ui/reveal.js`. Un `IntersectionObserver` compartido, `unobserve` al
revelar, solo opacidad + `translateY(16px)` en 520 ms. Lo usan Dashboard (29
elementos) y Wrapped (26).

⚠️ **La regla dura: si algo falla, el contenido queda VISIBLE — y se garantiza
por ESTRUCTURA, no por cuidado.** El CSS **no oculta nada**: `.reveal-armed` es
la clase que esconde y la pone el JS en el mismo paso en que llama a `observe()`.
Si el módulo no se importa, tira al importarse, `IntersectionObserver` no existe
o `observe()` falla, la clase **nunca se agrega**. **Nunca escribas
`.algo { opacity: 0 }` en la hoja esperando una clase que puede no llegar**: ese
es exactamente el fallo que esta estructura evita. Probado en producción
rompiendo `observe()` a propósito: 26 fallos de armado y la vista intacta.

Al terminar la transición se **quitan** las clases y el `transition-delay`
inline. No es cosmético: `.reveal-in` y `.year-tile` tienen la misma
especificidad (0,1,0), así que una `.reveal-in` residual le ganaría por orden de
hoja a la transición propia del `:active`.

**Los charts se animan por el CONTENEDOR, ya instanciado.** Un contenedor en
`opacity: 0` **sigue midiendo**, así que Chart.js no se entera (verificado: los
7 canvas conservan 565/1202 px). Lo que sí lo rompe es instanciarlo dentro del
callback del observer o con el contenedor en `display: none`, donde mide 0. Por
eso `armRevealAll` va **después** de `buildCharts()`.

**Armá donde el elemento NACE.** `renderDashboard` arma lo que pinta, pero los 5
stat tiles del historial los escribe `hydrateHistorySection` después: hasta v=160
la sección entraba a medias (los charts animaban, los tiles aparecían de golpe).

**`releaseReveal(root)` antes de repintar**: un `IntersectionObserver` mantiene
referencia FUERTE a lo que observa, así que los nodos que se van con un
`innerHTML = …` no se liberan solos (caso: cambiar de año en el Wrapped).

El toggle vive en `ui/theme-panel.js` con tres estados (`auto` / `siempre` /
`nunca`) y **un cartel que dice cuándo está apagado porque el sistema pide
movimiento reducido** — sin él se lee como roto, igual que las barritas del
player de v=88. Por eso las reglas nuevas de `main.css` **no** llevan
`@media (prefers-reduced-motion)`: quién anima lo decide `animationsEnabled()`
en JS, porque el toggle puede forzar por encima del sistema. Los 10 bloques de
reduced-motion que ya existían **no se tocaron**.

## Los filtros de descubrir comparaban por título exacto (v=165)

`#discover-artists` y `#new-releases` dejaban pasar tres cosas distintas que
son el MISMO problema: el cruce se hacía por el título tal cual, y cualquier
agregado lo esquivaba.

**Medido en producción el 2026-08-28**, sobre los **1.097** que veía Ian (chip
«Todo», ventana «Últimos 5 años», 150 artistas escaneados). Quedan **948**:
un recorte del **13,6 %**, muy por debajo del 40 % que Ian puso como techo.

| criterio nuevo | se caen |
|---|---|
| `edicion` — otra edición de un disco tuyo | **1** (5 con la ventana en «Cualquier año») |
| `single` — el tope de pistas y la clave BASE | **30 más** de los que ya se caían |
| `repetido` — el mismo tema repetido en la lista | **118** (56 grupos) |
| `sinescuchar` — ya está en la playlist | **0**, ver abajo |

### `util/edition-suffix.js` — el agregado de edición
`baseDeEdicion(titulo)` devuelve el título sin su cola de edición (Deluxe,
Expanded, Bonus, Anniversary, Remastered, Complete Edition, 10th Anniversary…),
en las **tres** formas de escribirla: entre paréntesis o corchetes, detrás de un
guion, y **pegada sin separador** («Igor Deluxe», «Sombras Complete Edition»),
que es la que `albumKey` no cubría.

⚠️ **Esto NO es aflojar `albumKey`.** El trozo se saca solo si **TODAS** sus
palabras están en la lista (`NUCLEO` + `RELLENO` + año + ordinal) y al menos una
es del núcleo. Por eso `American Football (LP2)`, `Crystal Castles II`, `÷` y
`eternal sunshine (slightly deluxe and also live)` salen intactos: les sobra una
palabra que no está en la lista. La cola sin separador va con una lista **más
corta todavía**, porque sin delimitador una palabra ambigua se come parte del
nombre real (`Midnight Gold` → `Midnight`).

El criterio es **simétrico por construcción**: se le saca el agregado a los dos
lados y se comparan las bases, así que da igual si el deluxe es el candidato o
el que ya escuchaste. Y solo suma cuando la clave exacta NO alcanzó, para que el
contador del chip diga cuántos descarta ÉL y no los de al lado.

### El filtro de singles no estaba roto: miraba para otro lado
«Timeless (Remix)» de The Weeknd seguía apareciendo con el filtro encendido.
El índice **sí** tenía `timeless||the weeknd`; lo que fallaba era el tope:
`MAX_PISTAS_SINGLE = 2` y ese lanzamiento tiene **3 pistas** (verificado contra
el caché de escaneo real). Un filtro que no descarta nada se lee como roto y
estaba funcionando: el candidato ni siquiera llegaba a la comparación.

Dos cambios:
- el tope pasa a `< EP_MIN_TRACKS` (menos de 4), o sea el **mismo** umbral de
  `util/release-size.js`. Un número menos que inventar, y coherente con los
  chips «Álbumes / EPs / Singles»: lo que el chip llama single es exactamente
  lo que este criterio mira;
- el índice `temaEnAlbum` ya no se limita a los likes cuyo álbum figura en
  `history-listened-albums.json`. Ese JSON es un subset por umbral y **termina
  donde termina el export**, así que los temas de 2025-2026 —justo los que
  tienen remixes dando vueltas— no estaban. Ahora también entra el like que vive
  en un álbum de 4+ pistas: 5.823 → **7.494 temas**.

### `songKeysCandidatas` / `songKeyBase` (`util/song-identity.js`)
⚠️ **`songKey` NO se tocó**: está portada a Python en `scripts/gen-stats.py` y
verificada contra 3.853 pares. Lo nuevo es una capa ENCIMA, que solo usan los
filtros de descubrimiento.

`songKey` ya cubría «Tema (Remix)» (lo tira `normText` con los paréntesis) y
«Tema - X Remix» (lo tira `REMIX_TAIL`). Lo que no cubría es la tercera forma:
la cola **pegada sin separador** — «Timeless Sped Up», «Die For You Acoustic».

Devuelve **varias** claves y no una porque el nombre del remixero va DELANTE de
la palabra («Timeless DEVAULT Remix») y sin separador no hay forma de saber
dónde termina el título: se prueban también los prefijos más cortos. El recorte
se corta en **2 tokens**, para que «One More Time VIP» no pueda matchear un
«One» cualquiera — un falso positivo acá es SILENCIOSO y uno negativo es
visible, la misma asimetría de v=152.

### El mismo tema cuatro veces (`dedupPorTema`)
Agrupa por `songKeyBase` —que incluye el artista, así que dos artistas nunca se
fusionan— y deja un representante. **El representante es el lanzamiento MÁS
GRANDE**, no el primero: un álbum y su single pueden compartir título, y
quedarse con el que tiene más pistas garantiza que el disco no se pierda por
culpa de su propio adelanto. A igualdad de pistas gana el más viejo, que es el
criterio que ya usaba `dedupDisco`.

El caso real que lo justifica: **«Desire» de Calvin Harris son ONCE entradas**
en la lista (VIP Mix, Sub Focus Remix, Steve Aoki & Kaaze, Don Diablo, MEDUZA,
Acoustic, Cedric Gervais, Hannah Laing, Alok, Extended y el pack de 11).

Va **al final** y sobre lo que sobrevivió a los demás: es el único criterio que
no mira un lanzamiento sino la lista entera.

### Tres divisiones, no dos (`releaseKind`)
Spotify no tiene tipo «EP»: `album_type` solo vale album/single/compilation y un
EP de 6 temas viene marcado como 'single'. Los chips pasan a
**Todo / Álbumes / EPs / Singles**, con el mismo `EP_MIN_TRACKS = 4` de v=127.
Medido: **79 EPs** que estaban mezclados entre 882 singles.

⚠️ Y de paso: `processArtist` repartía lo no escuchado en `unheardAlbums`
(`type === 'album'`) y `unheardSingles` (`type === 'single'`). Los
**recopilatorios no caían en ninguna de las dos** y la vista no los mostraba
nunca, con ningún chip. Ahora se guarda también `unheard` entero; los dos campos
viejos siguen ahí porque el caché de escaneo de 7 días los tiene y no vale la
pena forzar un rescán de 150 artistas.

### La playlist «fonoteca · sin escuchar» NO EXISTE
🟩 **Desde v=301 la app ya no escribe en ella**: «Guardar single» va a la
biblioteca de álbumes, como «Guardar álbum» (ver «Guardar un ÁLBUM» en
«Decisiones de API»). El criterio `sinescuchar` la sigue leyendo por lo que ya
tenga; lo que haya ahí no se movió.

El criterio `sinescuchar` cruza contra los items de esa playlist —la que escribía
`guardarLanzamiento` para los lanzamientos de menos de 4 pistas hasta v=300—. Verificado en
vivo el 2026-08-28 contra las **39 playlists propias** de Ian: **no está**. Hay
seis `fonoteca · ocultos (…)` y ninguna `fonoteca · sin escuchar`. Por eso el
chip descarta 0. El código degrada en silencio y avisa por consola; el día que
la playlist exista, el filtro empieza a contar solo.

### La ficha de álbum de descubrir es la compartida
No había «una versión aparte»: `#discover-artists` ya llamaba a
`openAlbumCard()`. Lo que se veía distinto eran dos cosas:
1. `.album-modal-no-data` **no tenía NINGUNA regla de CSS** —se buscó en las
   tres hojas y no existía—, así que «Sin datos de escucha en tu historial» se
   pintaba con el cuerpo del modal y gritaba. En estas dos vistas lo hace
   SIEMPRE, porque ahí ningún álbum tiene datos por definición. Ahora es una
   línea de 12 px gris, la misma que «Primera vez»;
2. faltaban los botones de la vista. `openAlbumCard` acepta
   `acciones: [{label, title, onClick}]` y las pinta detrás de las dos de
   siempre. **Cada acción aprieta el botón real de la tarjeta**
   (`accionesDeLaTarjeta` en `discover-common.js`), así que el guardado, el
   likeo, el picker y los dos stores siguen viviendo en un solo sitio y la
   ficha no puede desincronizarse de la grilla.

### «Volver arriba» ya estaba y funciona
Se verificó en producción en **las dos** vistas: aparece pasadas dos pantallas
(~1.300 px) y la capa de abajo lo mantiene por encima de la barra de selección
(medido con una tarjeta marcada: el botón en y=583 y la actionbar en y=579, sin
solaparse). `installBackToTop()` descubre el scroller solo y acá el que scrollea
es el documento, así que no hacía falta enchufar nada. **Ojo al medir**: fijar
`scrollingElement.scrollTop` desde la consola NO lo dispara de forma fiable —
hay que scrollear con la rueda de verdad.

## Claves de preferencia por usuario (v=159)
`prefKey(base)` y `migratePrefKey(base)` en `src/js/storage.js`. Aplicado a
`fonoteca_theme_v1` y `fonoteca_anim_v1`; las otras ~8 preferencias siguen
globales.

⚠️ **El prefijo sale de `fonoteca_last_user_id`, NUNCA de `getCurrentUserId()`.**
El segundo es **async** (`api.js:829`, hace `GET /me` la primera vez) y
`applyStoredTheme()` corre **sincrónico** en `app.js:648`, antes del primer
frame: prefijar con un id async pinta la paleta de fábrica y salta a la elegida
un instante después, o sea **flash de tema**. `fonoteca_last_user_id` lo escribe
`getCurrentUserId()` de forma sincrónica en `api.js:848`.

⚠️ **Al prefijar una clave que ya está en uso, MIGRÁ el valor.** Leer la clave
prefijada sin mudar la vieja primero devuelve vacío y la preferencia se pierde
**sin fallar**. `migratePrefKey()` copia y borra, y solo migra si la prefijada
está vacía. Suite: `tests/pref-key.test.mjs`, 13 asserts.

## El cruce de #listened usaba dos claves distintas (v=164)
`groupItemsByAlbum()` (`features/listened-shared.js`) sacaba el artista de
`album.artists[0].name` —el del ÁLBUM— y `attachLikes()` (`features/listened.js`)
del artista principal **más frecuente entre las pistas likeadas**. Para un
recopilatorio, una banda sonora o un disco donde lo likeado son colaboraciones
los dos **no coinciden**, y `albumKey(nombre, artista)` daba claves distintas
para el mismo disco. Con otra **edición** ya registrada tampoco lo salvan las
otras dos redes del cruce: otra edición es otro id de álbum (falla
`registeredIds`) y otras pistas (falla `registeredUris`). Resultado: «Quizás
escuchaste y no registraste» ofrecía discos ya añadidos, al añadirlos quedaban
registrados **dos veces** y aparecían en «Duplicados» — o sea que **el bug de
cruce se leía como un bug de otra vista**. Desde v=164 los dos lados llevan
`artistAlts` (todos los artistas principales vistos) y se cruzan por cualquiera.
⚠️ `artistAlts` viaja como **array, no como Set**: `albums` se guarda en IDB con
`JSON.stringify` y un `Set` se serializa como `{}`. ⚠️ Y al cambiar la forma de
algo cacheado hay que bumpear la clave: `cacheKeyFor` pasó a
`listened_grouped_{id}_v2`, sin eso el caché de 24 h seguía con la clave vieja.
Suite: `tests/listened-cruce.test.mjs`, 10 asserts.

## Una fila `<label>` se marca desde cualquier hijo (v=164)
Las filas de ese modal son un `<label>` que **envuelve** el checkbox, así que un
click en cualquier descendiente lo tilda aunque el descendiente tenga su propio
handler. Para meter una acción que NO sea marcar —abrir la ficha de álbum— hace
falta **`preventDefault()` además de `stopPropagation()`**; solo con el segundo
la acción corre y el álbum queda marcado igual.

## «Borrar sobrantes» no puede borrar una marcada (v=164)
`computeRemovals()` (`features/versions.js`) decide `hasKeep` y filtra
`!keepIds.has(id)` **sobre el mismo objeto cluster**: un desajuste de índices
puede hacer que se procese el cluster equivocado, pero el que se procesa
**siempre conserva su propia marcada**. Comprobado por fuerza bruta con una
réplica de la máquina de índices en Node (con un DOM de mentira donde **solo lo
renderizado** aparece en `querySelectorAll`, como en el real) sobre los 253
clusters reales: **3.000 sesiones, 61.475 acciones, 13.863 ids, 0 incidencias**.
⚠️ Y lo que más importa: `analyze()` filtra con `g.length > 1`, así que **un like
sin otra versión NUNCA entra en `allClusters`** — las 15 pistas que
desaparecieron enteras el 26/08 eran todas singletons y esta vista no las podía
tocar. Cuando algo desaparece «entero», mirar primero si la vista sospechada lo
llegaba a mostrar.
**El botón sigue INHABILITADO** (`BORRADO_BLOQUEADO = true`): lo que hay es una
exculpación, no una identificación.

## El doble de borrado de #versions (v=164)
`localStorage['versions_dry_run'] = '1'` hace que «Borrar sobrantes» corra el
flujo entero —`computeRemovals`, confirmación, mutación de `allClusters`,
remapeo— sustituyendo la llamada a la API por un registrador
(`window.__versionsDryLog` + `versions_dry_run_log_v1`). Con el doble encendido
el botón se habilita aunque `BORRADO_BLOQUEADO` siga en `true`: **no hay ninguna
ruta a un DELETE**. Además hay un **guarda duro** antes de tocar la API que
aborta el borrado entero si una id marcada se coló en la lista.

## Las CINCO vistas que borran me gusta van por un solo helper (2026-08-29)
`#versions`, `#zombies`, `#zero-plays`, `#skips` y `#sin-clasificar` son las
únicas que borran me gusta. Hasta el 29/08 **sólo `#versions` verificaba algo**
—y su verificación fallaba en silencio (ver el bullet de `/me/library/contains`
más arriba)—, así que las otras cuatro llamaban a `removeLikedTracks()` y daban
el borrado por hecho sin preguntarle nada a Spotify.

La secuencia vive ahora una sola vez, en **`src/js/util/borrado-verificado.js`**:
registro previo (lo escribe `removeLikedTracks`, v=162) → DELETE → verificación
con `checkLibraryContains` → **tira** si no se pudo verificar, si alguna pista
sigue dentro, o si la respuesta viene corta. Las cinco vistas ya tenían la forma
correcta alrededor (un `catch` que pinta toast rojo y un camino de éxito
después), así que tirar basta para que no se diga «hecho» sin saberlo.

**La guarda del último ejemplar sólo aplica en `#versions`, y es a propósito.**
Es un invariante de DEDUPLICACIÓN: ahí borrás una versión *porque hay otra*, y
quedarse en cero copias es siempre un fallo (es lo que pasó con las 123). En las
otras cuatro el usuario borra la canción *porque no la quiere*: quedarse en cero
es el resultado pedido. En `#skips` sería directamente lo contrario de la
función de la vista, que expande a propósito a **todas** las versiones del tema
(`r.ids`) para que no sobreviva ninguna — si dejás una viva, el tema reaparece
con los mismos números.

Para que esa ausencia no vuelva a parecer un olvido, el parámetro `guarda` es
**obligatorio y sin valor por defecto**: o `'ultimo-ejemplar'` (y entonces exige
`items` + `libraryByKey`, y la corre de verdad, en la última instrucción antes
del DELETE) o `'ninguna'` (y entonces exige `motivoSinGuarda` por escrito). Una
vista nueva que borre me gusta no compila mentalmente sin decidir cuál de las
dos es. Tests: `tests/borrado-verificado.test.mjs` (19) y
`tests/versions-guard.test.mjs` (16), los dos sin navegador ni token.

## 🧩 `#versions`: la propuesta de edición (v=323)

La tanda 70, por un pedido de Ian del 16/10 («uno que haga automático con deluxes y yo solo confirme»). En muchos
grupos de «Versiones duplicadas» la única diferencia es el disco: el mismo tema en «X» y en «X (Deluxe Edition)».
Ahí la vista **propone** qué edición queda, cuál se borra y por qué. **Solo propone.**

- 🔴 **Hace falta «Analizar»**: la propuesta no aparece al entrar (`render()` no cambió; abrir sigue costando 0).
- 🔴 **Nada sale tildado**: `keepIds` arranca vacío en cada análisis. Cada grupo con propuesta lleva **su** botón
  «Aceptar propuesta», que tilda «quedarme» en la pista que queda **disparando el mismo `change` del checkbox** (el
  camino del clic a mano) y nada más. **No hay ningún «Aceptar todas»** ni nada que tilde varios grupos de un clic. El
  borrado es el de siempre: «Borrar sobrantes», su lista pieza por pieza, `borrarLikesVerificado` y `'ultimo-ejemplar'`.
- Arriba del listado, «N grupos solo cambian la edición del disco» (o «Ningún grupo es solo de edición.») y el
  interruptor «Ver solo los que tienen propuesta (N)». Los ocultos y los fantasmas no llevan propuesta. Clases propias
  (`.ver-propuesta…`, en `components.css`), el «por qué» en `--color-text-secondary`.

**La regla** (`util/deluxe-propuesta.js`, PURA; si un solo miembro no cumple, el grupo queda a mano):

- por nombres (`motivosPorNombre`, la parte que se midió): el mismo artista principal y el mismo título tras la
  limpieza MÍNIMA (`limpiarNombre`: NFC, minúsculas, espacios, apóstrofos tipográficos al recto; nada más: «X» y «X -
  2011 Remaster» no son el mismo); ningún título con marcador de versión (`VERSION_MARKERS` **importado** más la lista
  propia: remix, mix, en vivo, live, acústico/a, acoustic, remaster/ed/izado/a, radio edit, edit, demo, regrabación,
  re-recorded, sped up, slowed, reverb, nightcore, 8d, instrumental, karaoke, a cappella, version/versión, mono,
  stereo, bonus, session(s), unplugged, rework, reimagined, cover, commentary; palabra entera, sin mayúsculas ni
  acentos); los discos con nombres distintos, la misma `baseDeEdicion()` (exacta, no vacía) y al menos uno con
  `tieneAgregadoDeEdicion()` (las dos **importadas** de `util/edition-suffix.js`); y, **apretado por la medición**,
  ningún disco cuyo nombre diga otra grabación (`discoDeOtraGrabacion`: remaster, extended, regrabación, remezcla o
  «<alguien>'s Version»);
- lo que solo trae la API: ids de disco distintos; todos `album_type === 'album'` (el single contra el álbum NO
  entra); la duración, el más largo menos el más corto **≤ 2.000 ms**; el mismo `explicit`; el ISRC, si **todos** lo
  traen, igual (si falta en alguno, sigue sin él y la vista dice «ISRC: no está en tu caché»; nunca con ISRC
  distintos);
- queda la edición de **más `total_tracks`**, si es única (a igualdad, a mano); con tres o más, se borran las demás.

**El umbral, medido contra el export** (REAL, tanda 70, solo por nombres, sin red; con los nombres en
`fonoteca-migracion/deluxes/`): 3.796 grupos de dos uris o más, partidos por el `sha256` de la clave antes de mirar. La
mitad A marcó 47 con 4 falsos positivos (un remaster, un «Extended», dos versiones posesivas de otra persona): se apretó
la regla. La mitad B, que no se usó para apretarla, marcó 45 con **0 falsos positivos: la tasa puede ser hasta 3/45
(6,7 %)** (la regla del tres; nunca «tasa cero»). 🔴 **Es una COTA ALTA**: la regla de la app es la de nombres más ids,
`album_type`, duración, `explicit`, ISRC y el desempate por pistas, así que marca un subconjunto. **La medición no mide**
la duración, el `explicit`, el ISRC, el `album_type`, qué edición tiene más pistas (cuál propone conservar) ni los me
gusta que nunca sonaron (el export son escuchas, no me gusta).

`slimTrack` (`api.js`) ya guardaba todo lo que la regla lee (`album.id`, `album_type`, `total_tracks`, `explicit`,
`duration_ms`, `external_ids.isrc`): no hizo falta tocar la caché. ⚠️ La guía de migración de febrero de 2026 lista
`external_ids` como quitado y «reverted — see March 2026 changelog»: si vuelve a venir no está verificado; la regla
funciona igual sin él.

Guardas: `tests/deluxe-propuesta.test.mjs` (cada condición, un caso que pasa y uno que falla, con pistas inventadas),
`tests/versions-propuesta.test.mjs` (lectura estática: un solo `keepIds.add`, el del checkbox; «Aceptar propuesta» no
sale de su tarjeta; ningún «aceptar todas»; `render()` no calcula nada) y el banco `tests/banco/versiones-deluxe.html`
(en `prepush`, el vigésimo segundo). Las dos suites y el banco, vistos fallar contra v=322.

## El embed de previews: medido tarjeta por tarjeta (v=167)

Ian reportaba que en `#zero-plays` y en `#skips` «la mayoría» le abría el embed
de Spotify. En la tanda 3 se había medido **4-5 %** sobre una muestra al azar y
se dio por bueno. **Las dos cosas eran ciertas** y no se contradicen.

**Metodología** (la misma antes y después): las **60 primeras filas de cada
vista en el orden por defecto**, resueltas de a una con la llamada EXACTA que
hace el botón ▶ de cada vista (`onPlayClick`), y contando el `provider` que
devuelve `getPreview`. El arnés es `window.__filasZeroPlays` /
`window.__filasSkips` (v=166): la vista no exponía sus filas, y leerlas del DOM
no sirve porque la tarjeta muestra los artistas **ya unidos en un string** y la
cadena de proveedores necesita la lista.

| vista | iTunes | Deezer | embed | sin preview |
|---|---|---|---|---|
| `#skips` antes | 48 | 11 | 1 | 0 |
| `#skips` después | **49** | **11** | **0** | 0 |
| `#zero-plays` antes | 45 | 8 | 7 | 0 |
| `#zero-plays` después | **49** | **5** | **6** | 0 |

⚠️ **Los 7 embeds de `#zero-plays` no estaban repartidos: CINCO eran las cinco
primeras tarjetas.** O sea la primera pantalla entera. El orden por defecto de
la vista es **por fecha de like ascendente**, y los likes viejos que nunca
sonaron son justo remixes y ediciones «slowed / sped up / Lo-Fi» de 2018-2022
subidas por cuentas que ningún proveedor indexa. Esa es la reconciliación: la
muestra al azar de la tanda 3 medía el promedio de 659 filas y **el promedio no
es lo que Ian ve** — él ve la cabecera de la lista, que es el peor tramo por
construcción. Cuando algo «pasa siempre» y la métrica dice 4 %, mirar si la
métrica está muestreando donde el usuario mira.

⚠️ **`#skips` y `#zero-plays` NO piden el preview igual**: `#skips` **no manda
`spotifyId` a propósito** (su embed va inline en la tarjeta, no en el pill), así
que ahí `getPreview` devuelve `null` y el embed lo abre la vista. En
`#zero-plays` sí lo manda y el embed sale de la cadena. Las dos cosas cuentan
como «embed» al medir, pero son dos códigos distintos.

### Los tres sospechosos, uno por uno
1. **Que las vistas pasaran solo el primer artista** (el bug de la tanda 2):
   **descartado leyendo el código**. Las dos pasan la lista entera
   (`artistList` en `#zero-plays`, `r.track.artists` mapeado en `#skips`).
2. **Caché envenenado de v=149**: **real pero chico**. De los 18 veredictos
   `spotify-embed` que había en el caché de Ian, **3** eran anteriores al 19/08.
   Purgado igual (ver abajo), que era lo pedido.
3. **El apóstrofo**: **descartado midiendo**. Es un problema de la sintaxis
   `campo:"…"` del `/search` de Spotify, y iTunes y Deezer son búsqueda de texto
   libre. Probado en vivo contra las dos APIs el 2026-08-29: «Guns N' Roses
   Sweet Child O' Mine», «Sinéad O'Connor Nothing Compares 2 U» y «The Weeknd I
   Can't Feel My Face» devuelven lo mismo con apóstrofo y sin él.
   **Pero sí estaba en otro lado**: `#recs` y `#similar` mandaban el título
   crudo a `/search?q=track:"…"`, así que cualquier tema con apóstrofo caía en
   «sin match» — que se lee como «Spotify no lo tiene». Arreglado en las dos.

### Lo que sí estaba roto: la cola de versión (`util/track-match.js`)
«A Different Way - DEVAULT Remix» (DJ Snake) caía al embed **teniendo el tema
exacto en iTunes y en Deezer**:

```
pedido:    "A Different Way - DEVAULT Remix"              → "a different way devault remix"
candidato: "A Different Way (feat. Lauv) [DEVAULT Remix]" → "a different way"
similitud: 0,696   (el umbral es 0,86)                    → rechazado
```

La causa es una **asimetría de `normText`**: el corte de `feat.` se lleva **todo
hasta el final de la cadena**, así que al candidato le borra de paso el
`[DEVAULT Remix]` que va DETRÁS del `(feat. Lauv)`. El pedido, que escribe el
remix detrás de un guion, se lo queda. Los dos lados dicen lo mismo y quedan en
cadenas distintas.

No alcanza con reordenar los cortes: **Spotify escribe la versión detrás de un
guion y los proveedores entre corchetes**, así que hay que tratar las dos formas
como la misma cosa. Y no se puede simplemente borrar la cola en los dos lados:
ahí «Tema - X Remix» matchearía el «Tema» original y sonaría la canción
equivocada, que es justo lo que esta unidad existe para evitar. Por eso la
versión se compara **aparte**:

- `tituloBase(s)` — el título sin su cola de versión;
- `tokensDeVersion(s)` — lo que dice esa cola (`{devault, remix}`), mirando
  paréntesis, corchetes y cola detrás de guion, y **solo** si el trozo trae una
  palabra de versión (así `(feat. Lauv)` no cuenta y «Tema (feat. A)» sigue
  matcheando «Tema (feat. B)»);
- dos títulos matchean por esta vía solo si las bases coinciden **Y** los dos
  conjuntos de versión son compatibles: uno contenido en el otro, y **si uno
  está vacío el otro también**. Un pedido sin versión nunca acepta un remix y un
  remix nunca acepta el original.

⚠️ **El cambio es ADITIVO por estructura**: la vía nueva solo corre si la
comparación estricta de siempre ya falló, así que no puede romper ningún match
que antes funcionaba. Los umbrales y la regla de los títulos cortos son los
mismos, aplicados sobre la base (por eso «Tema - Slowed» no entra: la base
«tema» son 4 caracteres). Suite: `tests/track-match-version.test.mjs`, 18
asserts.

⚠️ **Lo que queda flojo, a propósito**: por el mismo corte de `feat.`, pedir
«A Different Way» a secas SÍ matchea «A Different Way (feat. Lauv) [DEVAULT
Remix]», y pedir «Burning Piles (Slowed)» matchea «Burning Piles». Es el
comportamiento de siempre —`normText` tira los paréntesis a propósito— y
apretarlo sacaría previews en vez de agregarlos. Anotado, no tocado.

### El caché de veredictos sube a v4
`preview_provider_map_v4`, y al cargarlo **borra las tres versiones anteriores**
(v1, v2 y v3 seguían enteras en el localStorage de Ian: **no caducan solas**).
Sube porque cambió la comparación de títulos y todo `spotify-embed` o `none`
guardado con la regla vieja puede ser un rechazo que hoy no se haría. Los caches
de URL de iTunes y de Deezer **no se tocan**: el proveedor que sirvió sigue
sirviendo.

### Lo que NO era: las URLs muertas
Se comprobó que las 59 URLs de audio de `#skips` cargan (`loadedmetadata` en un
`<audio>` de prueba): **59/59 ok**, ninguna caída. Vale saber que si alguna vez
fallan, **el síntoma NO es el embed sino silencio**: el `<audio>` de
`ui/preview-player.js` **no tiene listener de `error`**, así que una URL muerta
deja el pill diciendo «vía iTunes» sin sonar y sin avisar. Pendiente anotado.

### Medir con la pestaña de la extensión
La pestaña del grupo MCP corre **oculta**, y Chrome clampea los `setTimeout` de
una pestaña oculta a **uno por minuto**. Un bucle de medición con `await
sleep(300)` entre ítems avanza 1 ítem por minuto y parece colgado. Los
veredictos no cambian —el trabajo de red no se throttlea—, pero el bucle hay que
manejarlo **por tandas desde afuera**, sin sleeps encadenados. Es la otra cara
de [[fonoteca-pestana-extension-hidden]].

## #recs: preview y las dos fichas por fila (v=167)
`features/recommendations.js`. Las filas son un `<label>` que envuelve el
checkbox, así que **cualquier click en un descendiente lo tilda**: las tres
acciones nuevas van por un delegado que hace `preventDefault()` **además de**
`stopPropagation()` (v=164). Verificado en producción: con el ▶ y con las dos
fichas el checkbox no se mueve.

El botón de preview reusa `.sc-play` y `paintPlayingCard()` de la tarjeta
compartida. Para eso `paintPlayingCard` dejó de exigir `.sc-card` en su
selector y busca `[data-id="…"] .sc-play`: las vistas que sí usan la tarjeta no
notan nada (su `.sc-card` es la que lleva el `data-id`).

Los top tracks por artista pasan de **20 a 30** (`TOP_TRACKS_POR_ARTISTA`). Cada
uno cuesta una búsqueda en Spotify, así que la resolución va con **120 ms entre
búsquedas** — sin eso, 30 requests seguidas son un 429 esperando.

La resolución además **verifica** el candidato (`titleMatches` + `artistMatches`)
y pide `limit=5` en vez de 1: al limpiar el apóstrofo la query queda más laxa, y
la regla de `limpiaParaQuery` dice que el que llama tiene que comparar contra el
nombre real. Medido después del cambio: Sumo 20/20 con match, bleood 30/30.

## Nombres largos en las tarjetas de la grilla (v=167)
`.smart-card-title` (`#similar`, `#recs`, `#by-artist`, `#by-genre`,
`#rabbit-hole`). La tarjeta es un flex column con `align-items: center`, y ahí
el ancho del hijo es su `max-content`: se salía por los dos costados sin que
nadie lo clippeara. Ahora `min-width: 0` + `max-width: 100%` + `-webkit-line-clamp: 2`
(elipsis donde empezaría el tercer renglón) + `overflow-wrap: anywhere` para el
nombre de una sola palabra más ancho que la tarjeta. El `min-height` de dos
renglones es lo que iguala la altura **entre filas** (dentro de una fila ya la
igualaba el stretch del grid).

**Se descartó el marquee**, que ya existe (`ui/marquee.js`): su animación va
`none` bajo `prefers-reduced-motion`, y ese es **el camino de Ian** —tiene
`enable-animations=false` en GNOME—, así que el nombre quedaría cortado a secas
y sin elipsis, que es peor que ahora.

⚠️ **`minmax()` NO se puede anidar.** El primer intento fue
`repeat(auto-fill, minmax(140px, minmax(0, 1fr)))` y es **CSS inválido**: el
navegador descarta la declaración ENTERA y la grilla se cae a **una sola columna
a lo ancho de la página** (visto en producción en `#recs`, v=167 → arreglado en
v=168). La regla de «`minmax(0, 1fr)` y nunca `1fr` pelado» apunta al **mínimo
automático de una pista `1fr` que no tiene mínimo propio**; estas ya lo tienen
puesto a mano en 140px / 120px, así que el contenido no puede ensanchar la
columna y no hacía falta tocar nada. Lo que desbordaba estaba dentro de la
tarjeta.

## El presupuesto de alto del modal de W-Three ya no tiene excepción (v=170)
El botón «Añadir los N sugeridos» (`.wt-suggest-btn`) se sacó por decisión de
Ian: con que la meta de la cabecera diga cuántos hay, alcanza.

Lo importante es lo que costaba. Medido en la app el 2026-08-29, con el modal
fijado a **502 px** (que es `min(85vh, 620px)` en el viewport de 591 px de la
pantalla de Ian) y 20 pistas:

| | alto de la tracklist | contenido | ¿scroll? |
|---|---|---|---|
| con el botón (v=169) | **245 px** | 264 px | **sí** |
| sin el botón (v=170) | **285 px** | 264 px | no, sobran 21 px |

O sea que el botón costaba **exactamente 40 px** (33 de alto + 4 de margen +
gap) y esos 40 salían del presupuesto de la tracklist. El resultado era que un
álbum **con** sugerencias metía 20 pistas en 245 px y aparecía scroll, y el
mismo álbum **sin** sugerencias entraba justo: dos presupuestos distintos para
el mismo modal, según un botón que aparecía o no. Ahora hay uno solo.

Comprobado a 502 px con 10, 12, 20 y 27 pistas: las tres primeras entran sin
scroll y **27 desborda a propósito** (390 px de contenido), que es el diseño de
v=144 — con más de 20 el scroll vive DENTRO de la tracklist y el modal no crece.

⚠️ **Cómo medirlo sin la pantalla de Ian**: la pestaña del grupo MCP tiene el
viewport clavado (647 px en una ventana nueva) y `resize_window` no lo cambia,
así que el `85vh` de acá no es el de Ian. Se reproduce fijando
`modal.style.height = 591 * 0.85 + 'px'`, que es la restricción que importa.
⚠️ Y `getBoundingClientRect().height` del modal da **477** y no 502: la
animación de apertura le deja un `scale(.95)`. Para el presupuesto hay que mirar
`offsetHeight` y los `clientHeight` / `scrollHeight` de la tracklist, que son de
layout y no los toca el transform.

Los sugeridos se siguen viendo: `.wthree-track-suggested` pasó del **6 %** de
alpha —invisible— al **14 %** con una marca lateral de 2 px, que no gasta alto.

## El drag & drop del panel de orden (v=170)
Ian arrastraba la última fila al primer lugar, la soltaba y volvía sola.

**La zona de drop era cada FILA, no la lista.** Sin un `dragover` que llame a
`preventDefault()`, el navegador rechaza el drop y la fila vuelve a su sitio con
la animación de «acá no se puede». Todo lo que no fuera una fila era zona
muerta. Medido en la app con 3 picks y el panel abierto:

- **117 px de espacio vacío** debajo de la última fila — todo muerto;
- los 4 px de relleno de arriba y los huecos de 4 px entre filas — muertos;
- para insertar en la posición 0 había que acertarle a la **mitad de arriba de
  la primera fila: una franja de 17 px**. Eso es lo que Ian describía como
  «hay que hacerlo en dos pasos».

Ahora `dragover` / `drop` / `dragleave` viven en la **lista**, y el índice sale
de comparar el puntero con el CENTRO de cada fila. Comprobado con `dragover`
sintéticos: los seis puntos del panel —relleno de arriba, borde de la fila 0,
sus dos mitades, un hueco entre filas y el vacío del final— dan destino válido
(`defaultPrevented = true`) y el índice correcto.

⚠️ **El indicador de «va arriba de todo» caía fuera de la caja.** La línea verde
es un `::before` en `top: -3px` de la fila; sin relleno arriba, la primera fila
empieza justo en el borde del contenedor, así que los 3 px quedaban **enteros
por fuera** (medido: 0 de 3 px dentro; con `padding-top: 4px`, 3 de 3). Mientras
la lista no desborda Chrome los pinta igual, pegados al borde, pero en cuanto
hay más picks de los que entran el `overflow-y: auto` los clipea y el único
movimiento sin señal ninguna es justamente el que no andaba.

⚠️ **El drop nativo NO se puede disparar con un ratón sintético**: el navegador
solo arranca un arrastre real desde un gesto de usuario. Por eso la aritmética
se sacó a `util/reorder-drop.js` (`insercionPorPuntero`, `moverA`,
`indicadorPara`) y se verifica sin DOM: `tests/wthree-drop-index.test.mjs`, 22
asserts, con una pasada de fuerza bruta 5×6 que comprueba que la lista nunca
pierde ni duplica un elemento. Lo que queda en `wthree.js` es medir rectángulos.
Los ▲▼ siguen siendo la vía de respaldo y no se tocaron.

✅ **PROBADO POR IAN A MANO (2026-08-29): el arrastre anda bien.** Es la única
verificación que vale para esto —el drop nativo no se puede disparar desde acá—
así que queda cerrado. Si vuelve a fallar, lo primero es `tests/wthree-drop-index.test.mjs`
(la aritmética, sin DOM) y recién después los rectángulos de `wthree.js`.

## «Volver arriba» no animaba: `behavior: 'smooth'` y el movimiento reducido (v=170)
`ui/back-to-top.js` usaba `scrollTo({ top: 0, behavior: 'smooth' })` desde
v=141. **Chrome trata `prefers-reduced-motion: reduce` como una orden sobre el
scroll suave nativo y salta de golpe.** Ian tiene `enable-animations=false` en
GNOME, así que el camino sin animación era **siempre el suyo**.

Medido en la app el 2026-08-29: con `matchMedia('(prefers-reduced-motion:
reduce)').matches === true`, al llamar a `scrollTo({behavior:'smooth'})` desde
4000 px la **primera muestra, en t=0 ms, ya daba `scrollTop === 0`**. No hay
frames intermedios: es un salto.

Ahora el scroll se hace a mano con `requestAnimationFrame` (easeOutCubic,
420 ms) y quién anima lo decide **`animationsEnabled()`**, igual que las
animaciones de entrada de v=162: el media query no manda, porque el toggle de
tres estados del panel de paleta puede forzar por encima del sistema.
Verificadas las dos ramas en la app: con el toggle en «nunca» salta de una, y
con «siempre» —que es como lo tiene Ian— el scroll queda gobernado por frames.

Dos detalles que no son de adorno:
- **`evaluate()` sale temprano mientras hay animación en curso.** El botón se
  esconde al hacer clic, pero los `scroll` que dispara la propia animación
  volvían a encenderlo durante los 420 ms y lo apagaban al final. Con el salto
  de golpe ese parpadeo no existía porque no había frames intermedios.
- La rueda, el touch y el teclado **cancelan** la subida: si no, la animación le
  pelea el scroll al usuario hasta terminar.

## La vista activa SÍ se marcaba: lo que no se veía era el link (v=171)
`markActiveRoute()` funciona. Comprobadas **las 23 rutas una por una** en la app:
en todas queda exactamente un `[data-route].active` y es el correcto (los
`data-route` del `<aside>` y los `hash` de `HOME_SECTIONS` coinciden con las
rutas registradas — el desajuste de v=153 no volvió).

⚠️ **El problema era el scroll del menú.** `.sidebar-nav` tiene `overflow-y:
auto` y arranca siempre en `scrollTop: 0`. Medido con el menú abierto en
`#skips` (viewport 879): el `<nav>` mide **585 px de alto para 1076 px de
contenido**, y el link activo estaba en **y=1075, o sea 490 px por debajo del
final del menú**. Estaba marcado y era imposible verlo — y las vistas del final
de la lista (`#skips`, `#zeroplays`, `#versions`, `#sin-clasificar`) son
justamente las que Ian usa. En su pantalla, con 591 px de viewport, el nav es
todavía más corto y el problema es peor.

`mostrarActivoEnElMenu()` (router.js) mueve el `scrollTop` del `<nav>` para
dejar el activo centrado. ⚠️ **A mano y NO con `scrollIntoView()`**: ese
scrollea TODOS los ancestros scrolleables, incluido el documento, así que en una
vista larga te movería la lista de abajo del cursor por abrir el menú.
Verificado en las 20 rutas del `<aside>`: el activo queda dentro de la caja
visible del nav, que se mueve solo a 0, 271 o 491 según haga falta.

Y ya que se mira, se ve más: barra de 3 px (era 2), texto a 600 y el icono en
color de acento. El fondo sigue siendo el acento al 10 % de alpha.

## El crash al zapear de ruta era #skips (v=174, reproducido 2026-08-29)
«Cannot set properties of null (setting 'onclick')» zapeando rápido entre rutas
con los cachés fríos. Lo cazó la instrumentación de v=173 y lo nombró sola.

**La causa**: `analyze()` de `features/skips.js` espera a
`getBestAvailableLikes()`, que con el caché vacío se baja ~9.500 me gusta (185
requests, minutos). Al volver del `await` seguía adelante sin preguntar nada, y
`renderResults()` re-consultaba `#skips-content` — que en la ruta nueva ya no
existe.

⚠️ **El `teardown` que devuelve `render()` NO alcanza, y esto es lo importante**:
el router lo llama, pero **un `teardown` no puede interrumpir un `await` que ya
está en vuelo**. Sirve para soltar observers y timers, no para abortar trabajo
asíncrono. Hay que preguntar por la vigencia DESPUÉS de cada espera larga:
`generacionActual()` antes, `rutaVigente(gen)` después (los dos en `router.js`).

**Medido zapeando 40 veces con los cachés fríos**: 452 renders quedaron abiertos
después del cambio de ruta, en SEIS vistas — `#skips`, `#sin-clasificar`,
`#covers`, `#discover-artists`, `#wthree`, `#zeroplays`. El más viejo seguía
abierto **39 segundos** después de haber salido. Las livianas (`#versions`,
`#zombies`, `#listened`, `#dashboard`) no aparecen nunca. **Solo se arregló
`#skips`, que es la que crasheó**; las otras cinco tienen el mismo patrón y
todavía no la guarda.

Arreglado también, del mismo tipo: `track-card.js` ponía `previewBtn.onclick`
sin comprobar null, siendo la única de las tres vecinas sin guarda —
`routeteardown` cierra la pila de modales, así que una ficha abriéndose durante
un cambio de ruta se queda sin overlay.

**Cómo reproducirlo**: borrar IndexedDB y la Cache API (NO localStorage, ahí
están los tokens), recargar, zapear entre las seis vistas lentas con esperas de
40-300 ms, y después **parquear en `#home` y esperar** — el crash no es al
zapear, es cuando el render huérfano aterriza. Y ojo: **la extensión de Chrome
no captura `console.warn`**, hay que envolver `console.warn` en la página para
ver los avisos del router.

⚠️ **El `curl` del despliegue NO prueba que el navegador tenga la versión
nueva.** Mordió el 2026-08-29: `curl` devolvía `app.js?v=174` y la pestaña
seguía corriendo v=173, con los caches y la IndexedDB ya borrados.
⚠️ **La causa que se escribió entonces —«el service worker sirve `index.html` de
su propio cache»— estaba MAL** (corregido el 2026-09-29, v=257). El SW navega
red-primero, pero ese `fetch` pasa por la **caché HTTP del navegador**, y GitHub
Pages manda `cache-control: max-age=600` en `index.html`. Medido en Chrome contra
un servidor con esas cabeceras **y en producción**: tras un deploy, una
navegación normal muestra el index VIEJO con 0 peticiones al servidor
(`transferSize: 0`, `deliveryType: "cache"`), **con service worker o sin él**; F5
lo revalida. Para verificar de verdad en el navegador: recargar con **F5** o con
un query distinto (`index.html?frio=N`, URL nueva = otra clave de caché HTTP) y
leer `app.js?v=` desde dentro de la página. Desregistrar el SW y borrar la Cache
API **no hace falta para eso** (en v=257 un F5 sin desregistrar trajo la versión
nueva). **Confirmado en el deploy de v=258** (2026-09-29, pestaña de Ian):
navegación normal a los 17 s de publicar → v=257; otra pasados 10 min desde la
última descarga del index → v=258 sin F5 ni `?frio`, y el SW nuevo limpió solo la
Cache API vieja. O sea: **F5, `?frio=N` o esperar 10 min**; nada más. Lo que
nunca se toca es la IndexedDB. ⚠️ Y **Pages ignora el query**: `x.js?v=257`
devuelve el archivo ACTUAL, así que una pestaña vieja mezcla módulos nuevos con
viejos en vez de dar 404. El `curl` prueba que GitHub Pages publicó; no
prueba qué está ejecutando el cliente.

Aparte, desde v=257 el nombre de la caché del SW lleva la versión
(`fonoteca-sw-v<N>`, lo estampa `build.sh`) y su `activate` limpia las de los
despliegues anteriores: hasta v=256 valía siempre `fonoteca-sw-v1` y esa limpieza
no corrió nunca. Eso arregla la acumulación, **no** el `index.html` viejo de arriba.

**Tests y antes de pushear**: `npm test` corre las 39 suites de `tests/*.test.mjs`
(un proceso por suite, sale con 1 si alguna falla; `-- --orden=inverso|azar:N` y
`-- --paralelo` para cazar dependencias de orden) y `npm run prepush` comprueba,
sin modificar nada, sintaxis, tests, `docs/` al día, versiones parejas y que no
haya nada personal en el staging. **Desde v=316 la PUERTA 1 real de `calendario-dias` solo corre con
`FONOTECA_LEER_EXPORT=1`**: sin la variable, `npm test` no abre `my_spotify_data/` (ni lo mira); lo
vigila `tests/export-a-pedido.test.mjs`.

## `#covers` estuvo ROTA nueve versiones — `a.sources.has is not a function` (RESUELTO en v=176)
> ⚠️ **Corregido el 2026-08-30**: esta sección decía «PENDIENTE... sin
> arreglar, a la espera del OK de Ian». El fix está en el commit siguiente
> (`72914fc`, v=176, 80 minutos después del commit que escribió esta
> sección) — quedó desactualizada desde entonces. Verificado hoy contra
> `features/covers.js`: `sources` sigue siendo `Set` en todo el archivo, sin
> ninguna conversión a array.

Encontrado el 2026-08-29, roto **desde v=164** (nueve versiones, 27/08→29/08)
sin que nadie lo notara hasta el barrido de vistas. **No era intermitente: la
vista estaba muerta.** Comprobado entrando a `#covers` y dejándola renderizar
entera, sin zapear — pantalla de error, el mosaico no se pintaba nunca. Salía
por `guardRoute`, o sea que era un crash normal de la vista, no una escritura
tardía.

**Diagnóstico, con las dos rutas de construcción a la vista:**
- Los CUATRO productores tratan `sources` como `Set`: líneas 90 y 120
  (`new Set([...])`), 108 (`.add()`) y 155 (`for (const s of a.sources) prev.sources.add(s)`).
- El comentario del contrato, línea 58, decía literalmente «sources (Set)».
- Los DOS consumidores, 353 y 354, hacen `.has()` — o sea, quieren un `Set`.
- El ÚNICO sitio donde dejaba de serlo era la línea 165: `sources: [...a.sources]`.
- Esa línea existe por `years`, que en el mismo objeto **sí necesita** ser array:
  la línea 333 hace `flatMap(a => a.years)` y la 433 `a.years.some(...)`, y
  `.some()` no existe en `Set`. `sources` se había colado en la misma
  conversión.
- La lista **no se serializa nunca** (no pasa por IDB ni localStorage), así que
  no había ningún motivo para aplanarla a array.

**El arreglo: se sacó solo la conversión de `sources` en la línea 165**, se
dejó la de `years`. NO se tocaron 353/354: cambiarlas a `.includes()` habría
arreglado el síntoma dejando el contrato documentado mintiendo y a los cuatro
productores construyendo algo que nadie consume como tal.

`features/covers.js:165` construía el objeto con **`sources: [...a.sources]`**
—un array— y `covers.js:353-354` la consumían como **Set**
(`a.sources.has('wthree')`). Hoy las dos rutas coinciden: `sources` es `Set`
de punta a punta.

## Barrido de vistas vivas: `#debug` → «Barrer vistas» (v=178)
**Antes de cada deploy, correrlo.** Está en `#debug`, botón «Barrer vistas (N
rutas)». Entra a TODAS las rutas registradas, una por una, espera hasta 75 s por
cada una y comprueba que **pinta contenido** en `#main-content` — no el marcado
del menú, no que el módulo cargue. Deja la tabla en la misma vista y la guarda en
`localStorage['fonoteca_barrido_v1']`, así que volver a `#debug` muestra el
último barrido sin repetirlo (tarda minutos). Los estados son `PINTA`, `CRASH`,
`VACIA` y `COLGADA` (se pasó de los 75 s).

⚠️ **La lista sale de `rutasRegistradas()` (router.js), que devuelve las claves
del registro real.** No hay ningún array escrito a mano y ningún número que se
pueda quedar viejo: una ruta nueva entra al barrido por el solo hecho de
llamar a `registerRoute()`. Es exactamente lo que falló en v=171 — «las 23
rutas» ya eran 25, y las dos que faltaban en la cuenta eran `#new-releases` y
`#sin-clasificar`.

⚠️ **No se puede automatizar en headless ni meter en `tests/`**: haría falta el
token de Spotify de Ian, y sacarlo del navegador no es una opción. Por eso vive
dentro de la app, corriendo con la sesión real. Es un botón, no un test de CI.

⚠️ **Dejá la pestaña VISIBLE mientras corre.** Chrome clampea `setTimeout` en
pestañas ocultas, así que los sondeos de 500 ms se estiran: medido el 2026-08-30
en una pestaña de fondo, el tope de 75 s por vista tardó **119 s** en dispararse.
El resultado es correcto igual — solo tarda más y las vistas lentas pueden
marcarse `COLGADA` con menos margen del que parece.

**Probado de punta a punta el 2026-08-30 (v=178)**: 25 rutas, 24 `PINTA` + 1
`COLGADA` (`#sin-clasificar`, ver abajo), vuelve solo a `#debug` al terminar, y
al re-entrar muestra «24 de 25 pintan» sin repetir el barrido.

## Resultado del primer barrido (2026-08-30, v=177) — 25 rutas, no 23
Después de que `#covers` estuviera muerta nueve versiones, se comprobaron **las
25 rutas una por una, entrando y mirando que PINTEN**. Resultado completo en
`/home/ian/fonoteca/consumido/mediciones/BARRIDO-VISTAS-2026-08-30.txt`.

**24 pintan · 1 colgada · 0 rotas.** `#covers` era la única muerta.

Dos cosas que dejó el barrido:

**Son 25 rutas.** La cuenta de «las 23» de v=171 se quedó vieja: faltan
`#new-releases` y `#sin-clasificar`. Un barrido que se apoya en un número
escrito a mano deja fuera justo lo último que se añadió — el listado sale de
`registerRoute()` en `app.js`, no de la memoria.

**PENDIENTE: `#sin-clasificar` se cuelga para toda la sesión.** Con la familia
de endpoints de playlists en 429, la vista se queda con el spinner «Cruzando tus
likes con tus playlists…» **para siempre**: sin mensaje, sin error, sin toast, y
sin salida salvo recargar. Medido: **cero peticiones nuevas** en 15 s, y cero
peticiones **y cero logs** al salir y volver a la ruta — o sea que ni arranca.

La causa es el `if (scanning) return;` del principio de `load()`: el primer
`load()` se queda esperando una promesa que nunca se resuelve, nunca llega a su
`finally { scanning = false }`, y el lock queda puesto para el resto de la
sesión. Cada render posterior devuelve al instante y deja el spinner del render
nuevo. **No es una regresión de la vigencia de ruta de v=175**: esas guardas son
`return`, y un `return` ejecuta el `finally` y suelta el lock.

Comparar con `#listened` y `#wthree`, que en las MISMAS condiciones de 429
pintan una tarjeta de error: la vista renderiza y dice qué pasa. El arreglo
natural es un timeout en el cruce y soltar el lock pase lo que pase. Sin hacer.

## El tope de `lazy-img` no puede blanquear lo que se está viendo (v=193/194)

Regresión de v=181, en producción hasta v=192: `#covers` con celdas Mini o Chico
dejaba la grilla vacía, las tapas titilaban y no terminaba de cargar nunca.

`podar()` (`ui/lazy-img.js`) soltaba la `<img>` más vieja de la LRU **sin mirar
dónde estaba**, y `unload()` la volvía a observar en el observer de carga. Si esa
`<img>` seguía dentro de la zona de carga —lo normal apenas entran más de
`maxLoaded` (250) tapas en una pantalla, que a 28 px son **cientos**— el observer
la reportaba intersectando en el frame siguiente, se recargaba, el tope se pasaba
otra vez y volvía a podar. **Bucle cerrado, un ciclo entero por frame, para
siempre.** Medido en producción con el filtro 2020-2023 (429 tapas), sin tocar
nada: **1.253 cargas y 1.253 descargas POR FRAME** en Mini, 5.639 sin filtro.

**La regla, y es de estructura, no de cuidado: lo que está a la vista no se
poda.** `enVista` sale del propio observer de carga, que desde v=193 **sigue
observando después de cargar** (antes se desobservaba ahí y se re-observaba en
`unload()` — esa vuelta ERA el bucle). Si con esa regla no se llega al tope, **el
tope no se honra** y queda anotado en `sobreCupo`. Quedarse por encima del cupo
cuesta memoria; blanquear lo que el usuario está mirando cuesta la vista entera,
y entre los dos gana el primero.

⚠️ **Y la métrica que lo tapó**: v=181 midió `firstBatchMs` —el primer lote
sincrónico— y dio 3,7 ms. Ese número **seguía dando 3,8 ms con la vista rota**,
porque termina de tomarse antes de que el bucle arranque. Para una vista que
pinta de a lotes y carga en diferido, un número de arranque no describe nada:
hay que contar **ciclos de carga/descarga con la geometría quieta**, que tiene
que ser 0. Es la misma familia que la regla del `curl`: medir la capa
equivocada da la misma cara que un resultado limpio.

Tests: `tests/lazy-img-poda.test.mjs` (26 asserts, sin navegador, con un doble de
`IntersectionObserver` que cuenta ciclos en vez de medir tiempo — **contra el
módulo viejo desborda la pila**, que es el bucle en su forma sincrónica).

### La celda pide la tapa de SU tamaño (`tapaParaCelda`, util/cover-size.js)
Como consecuencia de lo de arriba, en Mini pueden quedar 656 tapas cargadas a la
vez. A 300×300 eso son 339 MB de bitmap decodificado — el pozo de memoria que
documenta `ui/lazy-img.js`. `tapaParaCelda(url, ladoCss)` pide la variante de 64
cuando `lado × devicePixelRatio <= 64`, y la de 300 si no. Medido: 2,5 KB por
tapa en vez de 25 KB, y el renderer queda en **322 MB** con las 2.451 celdas en
el DOM y 943 tapas cargadas.

⚠️ **El cambio de tamaño NO repinta**: `setItems` destruye los nodos y los nuevos
nacen sin `src`, o sea mosaico gris mientras bajan las tapas del tamaño nuevo —
la misma grilla vacía por otro camino (pisado y corregido dentro de esta misma
tanda). Se usa `lazy.cambiarFuente(img, url)`, que asigna el `src` **directo**
sobre la `<img>` ya pintada: el navegador sigue mostrando la tapa vieja hasta que
decodifica la nueva.

⚠️ **Y el `onerror` de `#covers` reintenta con la original antes de sacar la
celda.** El prefijo de tamaño del CDN es una convención **no documentada**: sin
el reintento, un cambio del lado de Spotify borraría álbumes del mosaico en
silencio. Una tapa que no carga es un hueco, nunca un álbum menos.

## Las tres vistas que faltaban de la vigencia de ruta (v=195)

`recommendations.js`, `sync.js` y `rabbit-hole.js` eran las tres que nunca
pasaron por `util/vigencia-ruta.js` — la lista de sospechosos que dejó anotada
el cierre de la investigación del crash de `#covers`/`album-card`. Ian lo vio en
producción **en `#recs`**: «Algo falló por detrás: Cannot set properties of null
(setting 'innerHTML')».

**Reproducido antes de tocar nada**, con un arnés headless que carga los módulos
reales de `src/` con los `import` desviados a dobles por **import map** (queda en
`/home/ian/fonoteca/consumido/mediciones/REPRO-VIGENCIA-2026-09-03/`: `node serve.mjs` y
`google-chrome --headless=new --virtual-time-budget=40000 --dump-dom
http://127.0.0.1:5599/repro.html`). No necesita token ni extensión: el zapeo se
simula subiendo la generación de ruta y reemplazando `#main-content`, que es
exactamente lo que hace `handleRoute()`.

| escenario | v=194 | v=195 |
|---|---|---|
| `#recs` · clic en un artista y salir mientras busca sus top tracks | `Cannot set properties of null (setting 'innerHTML')` | limpio |
| `#recs` · salir mientras resuelve los temas en Spotify | `Cannot set properties of null (setting 'innerHTML')` | limpio |
| `#recs` · salir mientras baja los similares | silencioso (lo come el `catch`) | limpio |
| `#rabbit` · clic en un artista y salir mientras busca sus top tracks | `Cannot set properties of null (setting 'innerHTML')` | limpio |
| `#sync` · salir mientras baja los likes | `Cannot set properties of null (setting 'onclick')` | limpio |

Y tres controles **sin** zapear (las tres vistas resuelven y pintan su lista):
pasan igual antes y después, o sea que la guarda no toca el camino normal.

**Lo que rompía en `#recs` es la mitad que el cierre de la investigación había
dado por inofensiva**: escribir sobre un nodo *capturado* que quedó desconectado
no tira —y por eso `panel.innerHTML` pasa desapercibido—, pero
`document.getElementById('recs-tracks').innerHTML` **vuelve a preguntar por el
id** y en la ruta nueva devuelve `null`. `pickArtist()` lo hace en las dos
ramas, la del `try` y la del `catch`, así que la del `catch` tira **sin nadie
que la agarre**: llega al `unhandledrejection` y de ahí al banner.

⚠️ **En `#sync` los tres crashes estaban TAPADOS por el `catch` de `analyze()`**,
que los convertía en un toast rojo con el mensaje del navegador —
«Cannot set properties of null (setting 'onclick')» como si fuera un error de
Spotify, y encima pintado sobre la ruta a la que te acabás de ir. Un `catch`
ancho no arregla una escritura tardía: la disfraza de error de dominio. Misma
familia que el `catch` de `resolveAlbumId` de v=154.

⚠️ **Y la trampa de este cambio**: `renderRecommendations` y `renderArtistGrid`
pasaron a recibir `ruta` con `= vigilarRuta()` por defecto (el idiom de
`showSetup`/`loadAndRender` en `wthree.js`), y las dos estaban enchufadas
**directo** como `onclick` — o sea que el primer argumento habría sido el
`Event` y `ruta.vigente` no existe. Van envueltas en una flecha. Si le ponés el
parámetro `ruta` a una función, mirá quién la usa de handler.

Los bucles cortan entre ítems, como `scanArtists()` de `#discover-artists`: las
30 búsquedas en Spotify de `#recs` (120 ms entre cada una), su barrido de
similares (150 ms), las 20 de `#rabbit` y los 8 artistas de `computeRelatedTags`
(200 ms). En `#sync`, en cambio, **la escritura en Spotify se termina igual** y
el toast la anuncia — lo único que se saltea es pintar el resumen.

## El router también pregunta por la vigencia (v=309)

`handleRoute()` (`router.js`) hacía `currentCleanup = await guardRoute(main, handler)` y
después la segunda pasada de `markActiveRoute(hash)` **sin preguntar si la ruta seguía
vigente**. La regla de v=174 («un teardown no interrumpe un `await`: preguntá por la vigencia
después») valía para las vistas y se le había escapado al propio router. Dos consecuencias,
las dos con una vista lenta de la que salís a mitad de la carga:

1. **La marca tardía — VISTA FALLAR y ARREGLADA.** Cuando el render viejo terminaba, la segunda
   pasada le ponía `active` a la tarjeta y al link de la ruta que ya habías dejado, y se lo
   sacaba a la que estabas mirando. La midió el banco `puertas` (tanda 56: 1 marca tardía; en
   la 57, `[data-route].active` = `puertas` dos veces estando en `#home`). Arreglo: **la segunda
   pasada solo si `rutaVigente(gen)`**. Vive en `handleRoute()` y en ningún otro lado (ni en
   `markActiveRoute`, ni en las vistas, ni con un `:not()`): es el único sitio que sabe qué
   generación terminó. Con la ruta vigente, todo igual que antes (Home sigue marcando su
   tarjeta: `tests/inicio-censo.test.mjs`, sin tocar).
2. **El teardown pisado — ARREGLADO en v=324 (tanda 71).** Con A lenta y B rápida: B dejaba
   `currentCleanup = teardownB`; A terminaba tarde y lo pisaba con `teardownA` (o con `null`). Al
   salir de B corría el de A y **el de B no corría nunca** (sus observers, timers, el aborto del
   escaneo de `#mapa`, el `releaseReveal`… quedaban vivos). Lo reprodujo la 57 en Node
   (`fonoteca-migracion/router-vigencia-repro-2026-10-15.mjs`). Arreglo, en `handleRoute()` y
   en ningún otro lado: después del `await guardRoute(…)`, **si `rutaVigente(gen)`, todo como
   antes** (`currentCleanup = lo que devolvió`); **si no, `currentCleanup` no se toca** y el
   teardown que devolvió la ruta vieja **se corre ahí mismo**, en un `try/catch` con el mismo
   `console.warn('[router] teardown:', e)`, **salvo que la vieja tenga el MISMO hash que la
   actual** (A → B → A, y el A viejo terminó tarde): ahí no se corre. 🔴 **El porqué del mismo
   hash**: hay teardowns de MÓDULO, no de cada render (`discover-artists.js`, `new-releases.js`,
   `skips.js`, `zero-plays.js`, `sin-clasificar.js` sueltan `list`/`lazyCovers`, que son
   variables del archivo): correr el del A viejo destruiría la lista del A nuevo, y el A nuevo ya
   lo llama al empezar su `render()`. Lo que se pierde es el teardown de un render viejo de cierre
   PROPIO de la misma ruta; hoy ninguno llega a devolverlo (las cinco async con cierre propio
   —`#mapa`, `#generos`, `#mapa-artistas`, `#covers`, `#mosaico`— no tienen un `await` entre su
   última guarda de vigencia y el `return`). La tabla de las 32 rutas (quién devuelve teardown, de
   qué es y si su `render()` lo llama al empezar) está en `fonoteca-migracion/PENDIENTES.md`
   (tanda 71). ⚠️ `#dashboard` tiene teardown de módulo y su `render()` no lo llama al empezar,
   pero es SINCRÓNICO: nunca termina tarde. Si algún día pasa a `async`, mirar esto.

Guarda de la 1: el banco `tests/banco/puertas.html` (PUERTA 6) exige 0 marcas tardías del router
y que lo único activo en el documento sea la ruta nueva; visto ponerse rojo sacándole la
condición a la segunda pasada.

Guardas de la 2 (v=324): `tests/router-teardown.test.mjs` (el `router.js` real en Node con rutas
INVENTADAS: A lenta → B → A termina → C; A → B → A2 con el viejo terminando durante A2 y después
de A2; la vieja sin teardown; la vieja con un teardown que tira; y la conservación. Rojo contra
v=323 en 7 asserts) y el banco `tests/banco/router-teardown.html` (en `prepush`, el vigésimo
tercero: la app ENTERA, `#puertas` con su `/me` retenida, `#mapa` buscando con una petición en
vuelo, `#home`: la petición en vuelo se aborta y el candado de la búsqueda queda libre — contra
v=323, 0 abortadas y el candado tomado —; y A → B → A con `#discover-artists`, de conservación,
visto fallar con una copia que corre también el del mismo hash). ⚠️ **«0 peticiones a MusicBrainz
después de salir» NO distingue el arreglo**: el bucle de `#mapa` ya pregunta por la vigencia antes
de cada petición; lo que el teardown perdido dejaba vivo era la petición EN VUELO y el candado.
⚠️ ~~**No arreglado, solo anotado**: si la ruta vieja TIRA después de que te fuiste, `guardRoute()`
le pinta la pantalla de error a `main`, encima de la vista vigente~~ → arreglado en v=325 (el punto 3).

3. **La pantalla de error de una ruta vieja ya no tapa la vigente — ARREGLADO en v=325 (tanda 72).**
   `guardRoute()` pinta en `container`, que es `#main-content`: el MISMO para todas las rutas. Con A
   lenta que TIRA después de que te fuiste a B, su `catch` le pintaba a B la pantalla de error de A
   (y con A terminando sin pintar mientras `main` tenía el esqueleto de B, «Esta página quedó
   vacía»). Arreglo: `guardRoute(container, handler, { vigente })`, y `handleRoute()` le pasa
   `{ vigente: () => rutaVigente(gen) }` (nada más cambió en el router). **Con la ruta NO vigente no
   se pinta nada** en `container`; el error va crudo a
   `console.warn('[crash-guard] la ruta vieja falló después de que saliste:', err)` y se devuelve lo
   de siempre: `null` si tiró, el cleanup si no (incluso si `main` quedó «en blanco»: el router de
   v=324 decide qué hacer con él). **Sin el tercer argumento, o con la ruta vigente, todo igual que
   antes.** `alFallar()`, `installCrashGuard()`, el banner y `pantallaDeError()` no se tocaron.
   La ruta REAL del banco es **`#records`**: hasta v=328 su `render()` esperaba `loadRecords()` (→
   `GET /me`) y después hacía `getElementById('records-content')` sin guarda de vigencia, así que si
   te ibas tiraba «Cannot set properties of null» (con la `/me` caída **o contestada bien**: no le
   hacía falta un fallo de red). Era un defecto de la vista (el arreglo de v=325 es del contenedor).
   🟩 **Arreglado en v=329 (tanda 75), en `#records` y en `#byartist`**: ver «`#records` y `#byartist`
   preguntan por la vigencia (v=329)», abajo. La tanda 72 leyó los 19 `render` async: solo `#records` y
   `#byartist` podían tirar después de un `await` (desde v=329, ninguno), y **ninguno de los 32 hace un `await` antes
   de escribir en `container`**, así que el segundo camino («quedó vacía» sobre la vigente) no se da
   con las rutas de hoy: lo cubre solo el test de Node. Guardas: `tests/guard-ruta-vieja.test.mjs`
   (el `router.js` y el `crash-guard.js` reales con rutas INVENTADAS; rojo contra v=324 en 9
   asserts) y el banco `tests/banco/guard-ruta-vieja.html` (en `prepush`, el vigésimo cuarto:
   `#records` con su `/me` retenida → `#home` → la `/me` se suelta con 500 y, aparte, bien; a los
   2 s `#main-content` sigue con `.home-grid` y sin `.crash-screen`. Contra v=324, la tarjeta «Se
   rompió algo al cargar esta página» / «Cannot set properties of null (setting 'innerHTML')»
   encima de `#home`. Y de conservación, `#records` con la `/me` caída sin salir: pinta lo suyo).
   ⚠️ La conservación «una ruta VIGENTE que tira → pantalla de error» no tiene caso real: ninguna de
   las 32 tira hoy estando vigente. La cubre el test de Node.

Ninguna de las tres cambia una petición: la tabla de costos no se toca.

### `#records` y `#byartist` preguntan por la vigencia (v=329)

La tanda 75, al tercer aviso. Las dos vistas hacían `document.getElementById(…)` después de un `await` sin preguntar si la
ruta seguía vigente: si salías mientras cargaban, `null.innerHTML` y la vista TIRABA (desde v=325 sin taparle la pantalla a
la ruta nueva, pero tiraba: el `console.warn('[crash-guard] la ruta vieja falló después de que saliste:', …)`). Arreglo, el
patrón de v=195: `const ruta = vigilarRuta()` al empezar `render()` y `if (!ruta.vigente()) return;` después de cada
`await` y antes de tocar el DOM. Los `await`, uno por uno:

- `records.js`: `loadRecords()` (después, `getElementById('records-content')`) e `isOwner()` de la rama sin récords (hasta
  v=328 iba DENTRO de la asignación `content.innerHTML = (await isOwner()) ? …`: si salías durante esa espera, pintaba
  en el nodo viejo; ahora se espera aparte y se pregunta).
- `by-artist.js`: `getBestAvailableLikes()` en `render()` (después, `renderStart()` o `build()`, los dos con
  `getElementById`) y `getAllLikedTracks()` en `loadLikes()`. ⚠️ `loadLikes` va enchufada directo como `onclick` del
  botón «Cargar likes»: la ruta se toma DENTRO de `loadLikes`, al hacer clic, y no por parámetro (el primer argumento
  sería el `Event`: la trampa de v=195). Si saliste a mitad de la descarga, lo bajado se guarda igual
  (`getAllLikedTracks`), el overlay se cierra (`prog.done()` / `hideProgress()`, que son globales) y la vista no escribe.
  Hasta v=328 ese camino no tiraba: `build()` tiraba y el `catch` de `loadLikes` se lo comía y escribía «Cannot set
  properties of null…» en el nodo viejo, desenganchado (la familia de `#sync` en v=195).
- **No se tocan** los `await` de `createPlaylistFromSelection()` (`promptPlaylistName`, `createPlaylist`,
  `addTracksToPlaylist`): después escriben en globales (overlay, toast) y en `renderGrid()`/`updateActionBar()`, que ya
  preguntan `if (!holder …) return`. La escritura en Spotify se termina igual y el toast la anuncia (la regla de `#sync`).

Ningún `catch` nuevo: si algo tira por otra razón con la ruta vigente, sigue llegando a `guardRoute`. 0 peticiones nuevas.

Guardas: `tests/vigencia-records-byartist.test.mjs` (los `records.js` y `by-artist.js` REALES en Node con los `import`
desviados a un doble, `tests/dobles/loader-vigencia-vistas.mjs` + `vigencia-vistas-doble.mjs`; las esperas se resuelven
DESPUÉS de subir la generación y reemplazar `#main-content`; datos inventados. Rojo contra v=328 en 7 asserts: cuatro
«Cannot set properties of null (setting 'innerHTML')» y tres escrituras en el nodo viejo) y el banco `guard-ruta-vieja`:
las puertas de A y B se dieron vuelta (hasta v=328 afirmaban que el aviso traía el error crudo de `#records`; ahora, **0**
avisos de ruta vieja, el render terminó sin tirar y 0 errores en la página) y dos casos nuevos, **D** `salir-byartist`
(60.000 me gusta INVENTADOS sembrados en IndexedDB con `?likes=`, para que la lectura tarde; se sale mientras lee) y **E**
`quedarse-byartist` (conservación: pinta sus 400 tarjetas). Como la vista ya no tira, el banco sabe que la vieja terminó
por un **espía** (`tests/banco/guard-ruta-vieja-espia.mjs`): el caso pone un import map que desvía
`/js/features/records.js` y `/js/features/by-artist.js` al espía, que importa el módulo REAL (el scope `/banco/` lo deja
pasar) y envuelve solo su `render` (anota fin y error, y re-tira el mismo error). Contra v=328, A, B y D rojas en 10 de 10
corridas (D con la lectura todavía en curso al salir en las 10); con v=329, 10 de 10 verdes, 43.382-44.275 ms de reloj
virtual (el presupuesto del banco sigue en 90 s).

## 📏 La cuota a la vista (v=310)

El pie del menú (`.sidebar-footer`, al final, debajo de «Cerrar sesión») enseña siempre, en todas las
rutas, dos renglones: lo gastado en ESTA pestaña de las dos cuotas de Spotify que la app ya choca.

- **Qué cuenta** (`util/cuota.js`, puro; `ui/cuota-pie.js` pinta): por cuota (`busqueda` = `/search`,
  `discografia` = `/artists/{id}/albums`), las peticiones que salieron a la red y volvieron con una
  respuesta (**un 429 también cuenta**: salió), los 429 con la hora del último, la pausa que puso `api.js`
  y, aparte, los pedidos que la pausa **cortó antes de salir** («cortada por la pausa»: no gastaron cuota,
  y por eso no suman a «peticiones»).
- **De dónde**: un solo punto, `spotifyFetch` (`cuotaDeEndpoint(endpoint)` decide la cuota), más la
  cortada de la guarda de `/search`, la cortada del nativo en `getArtistAlbumsConFuente` y las dos pausas.
  **No lee de `artistAlbumsDiag`** ni lo toca: el diag cuenta solo los 200 (`nativoRequests`) y su
  `esperas429` no ve los 429 del nativo (ver el bullet de `/artists/{id}/albums`); contar en
  `spotifyFetch` da la misma regla a las dos cuotas. El respaldo por `/search` de una discografía cuenta
  en **búsqueda**, que es la cuota que gasta. Contar no cambia ninguna espera, pausa, reintento ni ritmo,
  y no pide nada: la tabla de costos no se toca.
- **Por pestaña y por carga, a propósito** (como el diag): nace en cero en cada carga y se guarda en
  `sessionStorage.fonoteca_cuota_v1`. No alimenta nada de vuelta (la pausa sigue en memoria de `api.js`).
  La cuota es de la CUENTA: el `title` lo dice.
- 🔴 **El tope medido va en el `title`, nunca en el renglón** («Spotify cortó la búsqueda tras unas 700
  peticiones el 18/09/2026 …; es un número medido una vez, no un límite publicado»). «37 de 700» sería
  mentir con formato de dato. Lo vigila `tests/cuota.test.mjs` (lectura del cuerpo de `textoRenglon`).
- Se repinta con el evento `cuotachange` (sobre `window`), sin intervalo; el «hace N min» del último 429
  lleva UN `setInterval` de 60 s, solo mientras haya un 429. Contenedor `role="status"` +
  `aria-live="off"`; 12 px en `--color-text-secondary` (nunca el muted). Números con
  `toLocaleString('es-ES')` (12.345; las de cuatro cifras van sin separador: 1234).

**El alto del pie** (SEMBRADO, `fonoteca-migracion/driver-capturas-cuota-2026-10-16.mjs`, menú abierto,
en `#home`). El pie vive DENTRO del `<nav>` que scrollea (v=220), como último bloque: crecer alarga el
contenido del nav, no achica su caja, y **no se pierde ningún link** visible.

| | `.sidebar-footer` | bloque de la cuota | `<nav>` caja / contenido | links enteros sin scroll (de 27) |
|---|---|---|---|---|
| 1366×768, antes | 221 | — | 695 / 1.487 | 14 |
| 1366×768, sin peticiones | 302,2 | 69,2 | 695 / 1.568 | 14 |
| 1366×768, con un 429 en pausa | 319 | 86 | 695 / 1.585 | 14 |
| 390×844, antes | 221 | — | 771 / 1.487 | 16 |
| 390×844, sin peticiones | 302,2 | 69,2 | 771 / 1.568 | 16 |
| 390×844, con un 429 en pausa | 319 | 86 | 771 / 1.585 | 16 |

⚠️ El pie no entra sin scrollear el menú en ninguno de los dos, ni antes ni ahora: hay que bajar hasta el
final del menú para verlo. Guardas: `tests/cuota.test.mjs` (Node) y el banco `tests/banco/cuota.html` (en
`prepush`, el decimosexto), que vio el pie vacío contra v=309.

## 🎤 Letras (v=311)

La ficha de canción (`features/track-card.js`, la abren diez vistas) tiene un botón **«Letra»** en la fila de
«▶ Preview» y «Abrir en Spotify ↗». Al tocarlo le pide a **lrclib.net** la letra de ESE tema, la guarda y la
enseña en un bloque plegable debajo de la cabecera. Tres archivos:

| archivo | qué | probado en |
|---|---|---|
| `util/letras.js` | PURO (sin red, reloj, IndexedDB ni DOM): la URL, la clase de la respuesta, la verificación de nombres, las marcas de tiempo fuera, el aviso de duración, el registro que se guarda y el copy | `tests/letras.test.mjs` |
| `ui/letra-ficha.js` | la red, la caché y el bloque (`botonLetraHtml`, `bloqueLetraHtml`, `conectarLetra`); la ficha solo los llama | `tests/banco/letras.html` (en `prepush`, el decimoséptimo) |
| `main.css` | `.tc-letra`, `.tc-letra-texto`, `.tc-letra-aviso`, `.tc-letra-estado`, `.tc-letra-fuente`: clases propias, no reusa ninguna de otro módulo (v=219) | el banco (sección M) |

- 🔴 **Abrir la ficha NO le pide nada a lrclib** (la regla de v=261 aplicada a un tercero). Se pide al tocar
  «Letra», de a un tema. Nunca en lote, ni de fondo, ni «para precargar».
- **Una sola consulta**: `GET https://lrclib.net/api/get?artist_name=<artista principal>&track_name=<nombre tal cual>`.
  **Sin `album_name` ni `duration`**: es la consulta que midió la tanda 58, y con `duration` el servidor exige
  ±2 s, así que una diferencia mayor entre Spotify y lrclib daría 404 donde hoy hay letra (no medido; no se
  arriesga). **Ninguna cabecera propia** en el `fetch` (una no simple provoca una `OPTIONS` previa) y ningún
  token. CORS abierto (`access-control-allow-origin: *`) y `access-control-expose-headers: retry-after`
  (curl de la tanda 58): el `retry-after` se puede leer.
- **Lo que dice el servidor** (leído el 16/10/2026 en `github.com/tranxuanthang/lrclib`, rama `main`; la
  documentación es una SPA sin texto):
  - `server/src/routes/get_lyrics_by_metadata.rs`: `track_name` y `artist_name` obligatorios (no vacíos),
    `album_name` opcional, `duration` opcional y entre 1 y 3600. La respuesta trae `id`, `name`, `trackName`,
    `artistName`, `albumName`, `duration`, `instrumental`, `hasWordSync`, `plainLyrics`, `syncedLyrics` y
    `lyricsfile`. El error de carga es `OverloadedError` (`acquire_load_permit()`: el servidor se quedó sin
    permisos de carga): **es carga del servidor en ese momento, no un límite por cliente**. Que se convierta
    en un 503 con `retry-after: 1` está en `errors.rs`, que no se leyó: lo midió la tanda 58. Y el servidor
    **cachea también los 404** (`get_metadata_cache`, con un test `cached_miss_avoids_db_on_retry`): «Buscar
    de nuevo» enseguida puede devolver el mismo 404 de su caché.
  - `server/src/repositories/track_repository.rs`, `get_track_by_metadata`: `tracks.name_lower = ?` y
    `tracks.artist_name_lower = ?` (**igualdad**, en minúsculas); con `duration`, `tracks.duration >= dur - 2.0`
    y `<= dur + 2.0`; `ORDER BY tracks.id LIMIT 1` (el comentario dice «Prefer tracks with synced lyrics»,
    pero ordena por id: si hay varios con el mismo nombre, gana el más viejo).
- **La verificación, después de la respuesta**: el `trackName` que vuelve tiene que pasar `titleMatches` y el
  `artistName` `artistMatches` (cualquiera de los artistas de la ficha), **importadas** de `util/track-match.js`
  (la regla escrita dos veces diverge, v=219). Antes de `titleMatches` va una igualdad cruda (minúsculas,
  espacios colapsados): `normText` deja vacío un título en japonés y `titleMatches` diría que no a un título
  idéntico; la igualdad es la misma comparación que hace el servidor, más estricta que la de bigramas. Si no
  pasa, es «no hay letra» y **no se muestra** (un falso positivo es silencioso).
- **La duración avisa, no filtra**: si el tema es un me gusta, su `duration_ms` sale del caché de me gusta
  (`getBestAvailableLikes()`, 0 peticiones, como `irAlAlbum`). Más de **2 s** de diferencia (el margen del
  servidor) → la letra se muestra con «Puede ser de otra versión: esta dura 3:20 y la tuya 3:23.» encima. 2 s
  justos, sin aviso. Sin duración propia, sin aviso.
- 🔴 **No se sincroniza nada con la reproducción**: la app no sabe en qué segundo va Spotify (no pide permisos
  de reproducción) y el preview de 30 s es de iTunes o Deezer, que arranca en otro punto. Se muestra
  `plainLyrics`; si solo viene `syncedLyrics`, la misma sin las marcas (`[mm:ss]`, `[mm:ss.xx]`, una o varias al
  principio del renglón). Con `instrumental: true`, «Es instrumental.». Debajo, «Letra de lrclib.net» en el
  secundario.
- **La caché**: IndexedDB, `letras_v1_<trackId>` (**sin uid**: es dato público, como `mapa_area_v1_`), sin
  caducidad. Guarda **lo que contestó lrclib, recortado** (`id`, `trackName`, `artistName`, `duration`,
  `instrumental`, el texto que se muestra y la fecha) o `{ noHay: true, fecha }` para un 404; la decisión (qué
  mostrar, el aviso) se recalcula al pintar. Un 200 de otro artista también se guarda (es lo que contestó) y al
  pintar sigue siendo «no hay». Segunda apertura del mismo tema: **0 peticiones**. **«Limpiar caché» la BORRA**
  (no está en `CONSERVAR_PREFIJOS`: es re-pedible, una por tema) y `LO_QUE_SE_CONSERVA` no cambió. El cambio
  de usuario no la toca (no es de nadie).
- **Los errores, sin silencio y sin guardarlos**:
  - **404** → «lrclib no tiene la letra de este tema.», guardado como «no hay», con «Buscar de nuevo» (pide
    otra vez y pisa lo guardado).
  - **503** → **un** reintento automático, esperando `retry-after` (1 s si no viene o no se lee; tope 10 s). Si
    vuelve a fallar: «lrclib no contesta ahora. Prueba otra vez en un rato.» con «Reintentar». **Nada guardado.**
    Si la ficha se cerró durante la espera, el reintento no se pide.
  - **Corte de red, 429, otro 5xx, un 200 que no es JSON** → el mismo mensaje y «Reintentar», sin reintento
    automático y sin guardar nada.
  - El `try` de la red envuelve SOLO el `fetch`. El de afuera (caché, decisión, DOM) manda el error crudo a
    `console.warn` y el bloque dice «No se pudo enseñar la letra: algo falló en la app…», **nunca «no hay
    letra»** (v=154).
- **La ficha cerrada con la respuesta en vuelo**: después de cada `await` se pregunta si el bloque sigue en el
  documento (un teardown no corta un `await`, v=174): no se escribe en el DOM, y lo que llegó **sí** se guarda
  si es un éxito o un 404.
- ⚠️ **`.modal p` (0,1,1) le gana a una clase suelta** (0,1,0): los textos del bloque van con `.tc-letra`
  delante, si no salían a 14 px y con 20 px de margen de abajo (la familia de v=153).
- La fila de botones de la cabecera ganó `flex-wrap: wrap`: a 390 px, sin él, «▶ Preview» y «Abrir en
  Spotify ↗» ya desbordaban su columna (83 px de caja para 163 de contenido, medido en el banco); con el tercer
  botón se apilaban y la cabecera pasaba de 171,5 a 247,5 px de alto. A 1366 no cambia (78,5). **Desde v=312 la
  cabecera a 390 se reacomoda** (ver «La cabecera a 390 px y el dueño (v=312)», abajo).

**El modal, medido** (SEMBRADO: el banco `letras`, sección M, con quien NO es el dueño —el cuerpo es un
párrafo— y una letra inventada de 60 renglones; `.modal` tiene `max-height: 80vh` y, desde v=322, a 600 px o menos
`92vh`: hasta v=321 la regla del móvil iba antes en la hoja y perdía):

| | modal cerrado | con la letra abierta | caja / contenido de la letra | ¿el modal scrollea? |
|---|---|---|---|---|
| 1366×768 | 189,5 | 571,5 (tope 614,4) | 292 / 1.255 | no: entra |
| 390×844 | 230 | 507,1 (tope **776,5**) | 169 / 1.255 | no: entra |

⚠️ La fila de 390 se re-midió en la tanda 68 (v=322, el banco `letras`, sección M). Hasta v=321 decía «354 · 631,1 (tope
675,2)»: el 354 y el 631,1 eran de v=311 (la cabecera de v=312 ya los había bajado a 230 y 507,1, y nadie actualizó esta
tabla); el tope pasa de 675,2 a 776,5 porque el `max-height: 92vh` del celular ya no lo pisa la regla general `.modal`.

El alto máximo de la letra es `min(300px, 38vh)` y, por debajo de 520 px, `min(170px, 20vh)` (la primera
versión, `min(300px, 36vh)` en los dos y con el margen de `.modal p` todavía encima, a 390 scrolleaba: 842 de
contenido en 673).

### La cabecera a 390 px y el dueño (v=312)

**Medido con el dueño** (tanda 60; SEMBRADO: `letras-caso.html?uid=owner` siembra en las claves del dueño un
historial INVENTADO, `historialDuenio()` de `letras-datos.mjs`, y un `Chart` de mentira que llena la caja de 200 px:
Chart.js viene de jsDelivr y el banco no sale a la red). Sin stats.fm (el banco no tiene usuario de stats.fm): con
él, el cuerpo del dueño suma el renglón de «Stats.fm hoy» (~45 px) debajo de la curva. Alto del modal · si scrollea
(`scrollHeight`/`clientHeight`) · cabecera · renglones de la fila de botones · artista (`scrollWidth`/`clientWidth`)
· la caja de la letra (del aviso a «Letra de lrclib.net») dentro del área visible del modal, con su scroll en 0:

| v=311 (antes) | cerrada | con la letra abierta | cabecera | botones | artista | caja de la letra |
|---|---|---|---|---|---|---|
| no dueño 1366×768 | 189,5 | 571,5 (tope 614,4), entra | 78,5 | 1 | entero 340/340 | 133,5 → 475,5 de 570 |
| no dueño 390×844 | 354 | 631,1 (tope 675,2), entra | 247,5 | **3** | **cortado** 114/83 | 290,5 → 527,6 de 629 |
| dueño 1366×768 | 443,5 | 614,4, **scrollea** 824/612 | 78,5 | 1 | entero 330/330 | 133,5 → 475,5 de 612 |
| dueño 390×844 | 675,2, **scrollea** 715/673 | 675,2, **scrollea** 992/673 | **286** | **3** | **cortado** 114/73 | 329 → 566,1 de 673 |

| v=312 (después) | cerrada | con la letra abierta | cabecera | botones | artista | caja de la letra |
|---|---|---|---|---|---|---|
| no dueño 1366×768 | 189,5 | 571,5, entra | 78,5 | 1 | entero 340/340 | 133,5 → 475,5 de 570 |
| no dueño 390×844 | 230 | 507,1, entra | **123,5** | 1 | entero 247/247 | 166,5 → 403,6 de 505 |
| dueño 1366×768 | 443,5 | 614,4, scrollea 824/612 | 78,5 | 1 | entero 330/330 | 133,5 → 475,5 de 612 |
| dueño 390×844 | 554,5, entra | **776,5**, scrollea 890/**774** | **184** (123,5 cerrada) | 2 | entero 237/237 | 227 → 464,1 de **774** |

⚠️ Las dos filas de 390 de esta tabla se re-midieron en la tanda 68 (v=322, banco `letras`, sección M). Cambió solo la del
dueño con la letra abierta: hasta v=321 decía «675,2, scrollea 890/673 … de 673». El modal llega ahora a su tope de 776,5
(92vh de 844) en vez de 675,2 (80vh) porque el `max-height: 92vh` del celular ya no lo pisa la regla general `.modal`; el
contenido (890) no cambió, así que sigue scrolleando, con 101 px más de caja. La del no dueño no cambió (507,1 entra con los
dos topes). La tabla de v=311 (antes), de arriba, es historia y no se tocó.

- **La caja de la letra entera ya quedaba a la vista al abrirla, en los cuatro casos** (va justo debajo de la
  cabecera y las stats van después): el alto de `.tc-letra-texto` no se tocó.
- 🔴 **Con el dueño el modal SCROLLEA con la letra abierta**, a 1366 y a 390: la curva y las stats quedan debajo.
  **Se acepta, a propósito** (no se achica la curva, no se pliegan las stats, no se mueve la letra); anotado en
  `PENDIENTES.md` con los números.
- **La cabecera**: hasta v=311 eran estilos inline. Pasó a clases (`.tc-cabecera`, `.tc-cabecera-texto`,
  `.tc-titulo`, `.tc-botones`, `.tc-tapa`, `.tc-ir-album`, `.tc-cerrar`) con los MISMOS valores en el escritorio
  (78,5 a 1366, dueño o no). Por debajo de **520 px** (el corte de `.tc-letra-texto`) es una grilla: el título al
  lado de la tapa, «Ir al álbum» y ✕; el artista debajo, a todo lo que queda de ancho; la fila de botones debajo de
  todo, a lo ancho del modal. La columna del texto se vuelve `display: contents`: **el orden del DOM no cambia**, ni
  los botones ni sus textos.
- ⚠️ Con el dueño a 390, al abrir la letra aparece la barra de scroll del modal, el ancho baja y la fila de botones
  pasa a 2 renglones (la cabecera, de 123,5 a 184). En las capturas (`--hide-scrollbars`) no se ve: 123,5.
- La regla `.modal { max-height: 92vh }` del móvil sigue perdiendo contra la base (80vh): no se tocó. ⚠️ **Arreglado en v=322**
  (ver «Las reglas de `@media` que nadie aplicaba (v=322)», abajo).

Guardas: la sección M del banco `letras` mide los cuatro casos, cerrada y abierta, y afirma la caja de la letra a
la vista (los cuatro), la cabecera a 390 (≤ 2 renglones de botones, el artista entero, < 247,5 px) y la de 1366 en
78,5. Contra v=311 dio rojo en lo de 390; una copia sin la regla de 520 px, también. Capturas sembradas:
`fonoteca-migracion/driver-capturas-ficha-2026-10-16.mjs`.

**Costo**: ver la nota debajo de la tabla de «💰 Cuánto cuesta abrir cada vista». Abrir la ficha cuesta lo
mismo que antes (0 a lrclib, 0 a Spotify más); tocar «Letra», 1 (2 con el reintento del 503); la segunda vez, 0.
Comprobado contra el servicio de verdad el 16/10 con 5 temas (6 peticiones, 0 errores de CORS; el detalle, en
el repo privado).

Guardas: `tests/letras.test.mjs` (78) y el banco `tests/banco/letras.html` + `letras-caso.html` +
`letras-datos.mjs` (Spotify y lrclib simulados, letras INVENTADAS): abrir = 0 a lrclib; tocar = 1 y 0 la
segunda vez; el 404 guardado y «Buscar de nuevo»; 503+200 y 503+503 sin guardar; otro artista no se muestra;
el aviso a 3 s y no a 1 s; cerrar en vuelo sin escribir en el DOM; el modal a 1366×768 y 390×844. Las cuatro
puertas vistas fallar en una copia (guardar ante un 503, sacar la verificación, pedir al abrir, no leer la
caché). `letras-caso.html?foto=violeta|nohay|papel` es el instrumento de las capturas sembradas (conductor en
`fonoteca-migracion/driver-capturas-letras-2026-10-16.mjs`).

## Las reglas de `@media` que nadie aplicaba (v=322)

La tanda 68. Una declaración dentro de un `@media` tiene la MISMA especificidad que la misma regla fuera de él: si la regla
general viene **después** en la cascada, gana siempre y la del `@media` no se aplica nunca, en ningún ancho. Pasaba con dos
reglas, las dos de `main.css` y las dos del celular:

| la regla del `@media` | qué la pisaba | lo que no se aplicaba |
|---|---|---|
| `.blayer-right { align-items: stretch; margin-left: 0 }` en `@media (max-width: 768px)` | la general `.blayer-right { align-items: flex-end; margin-left: auto }`, que iba después | los widgets de la capa de abajo estirados a lo ancho |
| `.modal { max-height: 92vh; border-radius: … 0 0 }` en `@media (max-width: 600px)` | la general `.modal` (`max-height: 80vh`, `border-radius: var(--radius-xl)`), que iba después | el modal al 92vh y con las esquinas de abajo rectas |

Las contó `fonoteca-migracion/css/detector-media-pisada-2026-10-20.mjs` con las hojas **en el orden de carga de
`index.html`** (`theme.css`, `components.css`, `main.css`): **4 declaraciones en 2 reglas** (en otro orden el número es otro).
**El arreglo fue por ORDEN**: cada bloque `@media` quedó después de la regla general que lo pisaba, entero y sin cambiar una
declaración (en la capa se movieron las dos reglas generales antes del bloque; en el modal, el bloque después de `.modal`).
**Ni `!important` ni más especificidad.** Medido (SEMBRADO, Chrome headless, `mobile: false`; conductor
`fonoteca-migracion/css/driver-media-t68-2026-10-20.mjs`): a 390×844, `.modal` pasa de `max-height` 675,2 px y `border-radius`
20 px a 776,48 px y `10px 10px 0 0`, y `.blayer-right` de `align-items: flex-end` a `stretch` (`margin-left` computado, 0 en los
dos: el ancho del toast ya era 360 de 360); a 1366×591 las cuatro propiedades y las capturas, idénticas (`cmp`). **Solo se ve
en el celular.** Guarda: `tests/css-media-pisada.test.mjs` (lee los `<link rel="stylesheet">` de `src/index.html`, comprueba que
`callback.html` carga lo mismo y afirma 0; rojo contra v=321 con las 4). `tests/css-clases-duplicadas.test.mjs` cita las líneas
nuevas de `.blayer-right` (`main.css:791 y :799`).

## 🏷️ Las etiquetas de género, permanentes (v=312)

La vista de géneros (la tanda 61) necesita las etiquetas de TODOS los artistas del historial. Hasta v=311 vivían en
**un blob de `localStorage`**, `lastfm_artist_tags_cache` (`{ [artista en minúsculas]: { tags: [{name, count}], at } }`),
y `getCachedTags()` las daba por inexistentes **pasados 30 días** (`TAGS_CACHE_TTL_MS`, al leer: las vencidas seguían
en el blob). Lo de hace un mes se volvía a pedir y una vista de 2.000 artistas no terminaba nunca de estar completa.

| archivo | qué | probado en |
|---|---|---|
| `util/generos-artista.js` | PURO (sin imports): la clave, la mezcla (`mezclarEtiquetas`), la decisión (`decidirEtiquetas`) y el almacén con la IndexedDB, el blob y el reloj inyectados (`crearAlmacenGeneros`) | `tests/generos-artista.test.mjs` |
| `api/lastfm.js` | arma el almacén con `idb.js` y el blob; `cargarEtiquetas(uid)`, `getCachedTags`, `setCachedTags`, `mergeCachedTags`, `contarEtiquetasGuardadas`, `exportarEtiquetas`, `importarEtiquetas` | ídem (con `idb.js` doblado) |
| `features/by-genre.js`, `features/listened.js`, `api.js` | cargan el `Map` y leen de él (nadie lee el blob crudo) | el banco `tests/banco/generos-cache.html` (en `prepush`, el decimoctavo) |

- **La clave**: IndexedDB, **una por artista**, `generos_artista_v1_<uid>_<nombre en minúsculas>`. El uid va en la
  clave (la lista de artistas es dato de escucha: la misma razón que `mapa_artista_v1_`) **y dentro del valor**
  («abc» es prefijo de «abc_x»: al leer el rango de «abc» aparecen los de «abc_x» y se descartan por el uid). El
  nombre es `toLowerCase()` **tal cual**, sin normalizar más: la clave que ya escribió el blob y la que leen todos.
  **Sin caducidad.** En `CONSERVAR_PREFIJOS`, y `LO_QUE_SE_CONSERVA` suma «las etiquetas de género que ya buscaste».
  El cambio de usuario no las borra (van por uid). El «Reset + Login» (`localStorage.clear()`) ya no se las lleva.
- 🔴 **Se guarda lo que contestó CADA fuente, por separado, y se decide al leer** (el molde del mapa):
  `{ uid, nombre, fuentes: { lastfm, musicbrainz, statsfm, migrado } }`, cada una `null` (no se pidió) o
  `{ tags: [{name, count}], fecha }` (`tags: []` = «pregunté y no hay»). `getCachedTags` devuelve la mezcla de las
  fuentes en el orden en que se escribieron (por `fecha`; a igualdad, `migrado`, `lastfm`, `musicbrainz`,
  `statsfm`), o `null` si ninguna contestó.
- **Una sola función de mezcla**: la de `mergeCachedTags` de v=311, sin cambiar una coma, sacada a
  `mezclarEtiquetas` (minúsculas, una vez cada nombre, gana el `count` mayor, uno nuevo sin `count` vale 100). La
  importa `lastfm.js`; no hay una segunda copia (v=219). El test lo afirma de conservación: las mismas mezclas dan
  lo mismo que en v=311.
- ⚠️ **Cada fuente guarda su ÚLTIMA respuesta.** Volver a pedirle a Last.fm reemplaza lo de Last.fm y nada más
  (hasta v=311 `setCachedTags` pisaba la entrada entera, lo de MusicBrainz y stats.fm incluido); dos
  sincronizaciones de stats.fm ya no se suman, la segunda reemplaza. Las firmas no cambiaron: `setCachedTags` y
  `mergeCachedTags` suman un **tercer argumento opcional**, la fuente (sin él, Last.fm y stats.fm, que eran quienes
  las llamaban así); los dos de MusicBrainz de `by-genre.js` la pasan.
- **El `Map` en memoria**: los lectores siguen siendo sincrónicos. `cargarEtiquetas(uid)` trae **una vez** todo el
  prefijo del uid con `idbEntriesEnRango` (no `idbEntriesByPrefix`, que recorre la base entera). La llaman
  `renderStartScreen()` de `#genre`, `loadAlbums()` de `#listened` y, por las suyas, `exportarEtiquetas` /
  `importarEtiquetas`. Una escritura cambia el `Map` al instante y va a IndexedDB; **si la escritura falla, el `Map`
  vuelve a lo que había** (solo si nadie escribió encima mientras tanto) y se avisa por consola.
- **La migración del blob, sin perder nada**: la primera vez, se lee el blob y CADA entrada —**también las de más de
  30 días**— se escribe como registro con `fuentes.migrado = { tags, fecha: at }` (el blob no dice de qué fuente vino
  cada etiqueta: no se inventa). **El blob NO se borra** (si hay que volver atrás, sigue ahí). Todo va en **una sola
  transacción** (`idbSetVarios`, nueva en `idb.js`) junto con la marca `generos_artista_migrado_v1`
  (`{ uid, fecha, entradas }`, también en `CONSERVAR_CLAVES`). **La marca decide**, no que falten claves: una
  migración que falló no escribió nada y se reintenta en la carga siguiente; una que salió no se repite, aunque el
  usuario no tuviera ninguna etiqueta. ⚠️ **La marca es una por navegador**: con dos usuarios, el blob va al primero
  que abre `#genre` o `#listened` (no hay forma de saber de quién era; anotado en `PENDIENTES.md`).
- **Exportar e importar, el formato de siempre**: `tags.entries` = `{ nombre: { tags, at } }` con `tags` = la
  decisión y `at` = la fecha más nueva de sus fuentes, así un archivo de v=312 se importa en v=311 y al revés.
  `importAllData` escribe lo importado como `fuentes.migrado` (todo, también lo vencido), en una transacción.
  `exportAllData` sin uid sale sin etiquetas (y lo avisa). `importTagsCache` de `lastfm.js` **no lo usa nadie**
  (grep del 16/10) y se dejó como estaba: es lo único que todavía escribe el blob.
- ⚠️ **El `[]` de MusicBrainz ahora es para siempre.** `api/musicbrainz.js` busca con `limit=1` a ciegas y guarda
  `[]` cuando no encuentra al artista; antes caducaba a los 30 días, ahora no. Como va por fuente, una tanda futura
  puede volver a pedirle solo a MusicBrainz. Anotado en `PENDIENTES.md`. El `count >= 5` de Last.fm tampoco se tocó.
- **El costo: `#genre` pasó de 0 a 1 `/me`** al abrirse (su `getCurrentUserId()` estaba solo en `handleExport()`);
  medido en el banco. `#listened` ya pagaba el suyo (el de `isOwner()`, memoizado): **no suma** (leído del código).
  **0 peticiones nuevas** a Last.fm, MusicBrainz y stats.fm: qué se pide, cuándo y a qué ritmo no cambió.

🔴 **Para la tanda 61: «el universo de la vista de géneros son los artistas del HISTORIAL (`universo()` de
`mapa-paises.js`, ≥ 10 min), no los de los me gusta, que es lo que recorre `#genre` hoy».** (Hecho en v=313: ver «🔎 `#generos`», abajo.)

Guardas: `tests/generos-artista.test.mjs` (lo vencido se lee —rojo contra v=311—, la mezcla conservada, las fuentes
separadas, la migración, el uid, exportar/importar, la escritura que falla y la lectura estática) y el banco
`generos-cache` (A: abrir con un blob de hace 40 días → 0 a los terceros, cuenta como cacheado y la clave nueva está;
B: «Limpiar caché» la conserva; C: recargar sin el blob da lo mismo; D: abrir = 2 `/me` y nada más). Las cuatro
puertas vistas fallar en una copia: el TTL de vuelta, sin el prefijo en `CONSERVAR_PREFIJOS`, migrar solo lo
fresco, la clave sin uid.

## ⛔ Cada despliegue, su propio `?v=` — dos contenidos no pueden compartir versión
Pisado el 2026-09-03. El arreglo del cambio de variante salió como un **segundo
commit encima de v=193 sin bumpear**, así que `covers.js?v=193` pasó a servir dos
contenidos distintos y el navegador se quedó con el primero. Se detectó midiendo:
al pasar de Medio a Grande `__coversPerf.t0` seguía moviéndose, o sea que
repintaba — el camino viejo, con el arreglo ya desplegado.

⚠️ **Y la comprobación que lo tapaba**: un `fetch()` del módulo con cache-buster
devolvía los bytes NUEVOS. Eso prueba lo que sirve GitHub Pages, **no lo que la
página importó al arrancar**. Es la regla del `curl` en otra forma. Para saber
qué corre de verdad hay que preguntarle a un EFECTO del código nuevo (acá:
«¿repintó o no?»), no al servidor.

## 🔁 Tapas: `gen-stats.py` NO las hornea, hay que hornearlas aparte (2026-09-04)
`load_album_images()` **solo hace lookup** contra el índice de
`src/data/listening-history.json`, que está congelado en el **2026-07-25** y
**no se puede regenerar** (el horneador original no existe y no está en git).
Todo álbum que entre con un export posterior sale con **`img: null`** — eran 91,
82 de ellos de 2026, y se veían como ♪ en `#wthree`.

`scripts/bake-covers.py` resuelve **solo las que faltan** por
`open.spotify.com/oembed`, usando la URI del track **más escuchado** de cada
álbum (estas filas no traen `albumId`; el horneado original tampoco lo usó), y
las escribe en `src/data/covers-extra.json`. `gen-stats.py` lo mergea **solo
donde la clave no existía**.

⚠️ **`listening-history.json` NO SE TOCA NUNCA.** Es el único de los tres JSON
que es irreemplazable —los otros dos son salida de `gen-stats.py`— y lleva
correcciones hechas a mano sobre el dato que no están en ningún script («Birds
In The Trap Sing McKnight», v=151). `bake-covers.py` lo abre en modo lectura y
nada más; el `if k in idx: continue` del merge es lo que impide pisarlas.
Al terminar, comprobar que su `sha256` no se movió.

⚠️ **Si cambian `history-listened-albums.json` o `history-stats.json`, subí
`LISTENED_VERSION` / `STATS_VERSION` en `src/js/history-keys.js` y dejá sus
`OWNER_PREV_KEYS` VACÍAS**. Esa versión es el cache-buster de la URL **y** la
clave de IndexedDB: sin el bump el navegador sirve el JSON viejo del caché **sin
fallar y sin avisar**, y con las `PREV` pobladas el fallback migra justo el
archivo que el bump venía a reemplazar.

El procedimiento completo con el próximo export (los DOS `gen-stats.py`, y qué
verificar) está en `fonoteca-migracion/CONTEXTO-TECNICO.md`, sección «Con cada
export nuevo: hornear las tapas que falten».

## Los ocultos: la uri va GUARDADA con la clave (v=205)
`util/hidden-sync.js` reconcilia el caché local con una playlist de Spotify por
unión, y para re-subir una clave necesita la **uri** de la pista que la
representa. Hasta v=204 esa uri vivía en un `Map` **en memoria** que nacía vacío
en cada carga: una clave huérfana que nadie volviera a tocar **no se podía subir
nunca**, se quedaba en un `pendingNoUri` que tampoco se guardaba, y el día que
ese navegador perdiera sus datos el oculto desaparecía **sin dejar rastro**.

Desde v=205 la uri se persiste en `${lsKey}_uris`, y hay tres formas de
conseguirla, en este orden: la guardada, la **deducida de la clave** cuando la
clave ES el id de la pista (`uriDeTrackId`, para #skips / #zero-plays /
#sin-clasificar) y la **buscada y confirmada** (`util/hidden-recover.js`, para
las claves de álbum y de artista).

Las reglas que hay que respetar al tocar ese archivo:

- **Un oculto que no se puede sincronizar NUNCA se descarta.** Ante la duda,
  gana lo que preserve el dato: se anota en `ocultos_sin_uri_v1`, se avisa, y se
  queda donde está.
- **Un candidato solo vale si su clave RECALCULADA coincide exacto.** Subir un
  «parecido» deja en la playlist una pista que al releerla da otra clave: el
  oculto sigue perdido y encima la playlist queda sucia.
- **Antes de escribir en la playlist, se borra el caché de items; nunca se
  parchea** (v=299). `antesDeEscribir()` borra `ocultos_items_v1_<id>` antes de
  cada una de las cuatro escrituras (`pushMissing`, `fijarVarios`, `toggle`,
  `clear`), y antes y no después para que una escritura que tira no deje un
  caché que la contradiga. El porqué es el caso C4 de
  `tests/ocultos-cache.test.mjs`: caché `{A}`, la otra compu agrega Y, acá se
  oculta Z. El snapshot que devuelve el POST ya incluye a Y; parchear `{A}` con
  Z y sellarlo con ese snapshot deja a Y afuera hasta que la playlist vuelva a
  cambiar. Es lo contrario de W-Three («parchear, no borrar», v=147), y es a
  propósito: allá la playlist la escribe solo esta app.
  **El contador (v=300):** `escriturasDe(playlistId)` lleva, por playlist y para
  todo el módulo, `empezadas` y `enVuelo` (de `antesDeEscribir()` a
  `despuesDeEscribir()`, que va en un `finally`); `sync()` no guarda lo que bajó
  si al empezar o al terminar la bajada había una escritura en vuelo, o si empezó
  alguna mientras bajaba. Hasta v=299 contaba solo las empezadas y por almacén:
  no veía un POST que ya estaba en vuelo (caso C9 de `tests/ocultos-cache.test.mjs`).
  ⚠️ Dos pestañas no se ven entre sí: cada una tiene su módulo.
- **Cambiar de usuario borra `ocultos_items_v1_` (v=300).** El bloque de
  `getCurrentUserId()` (`api.js`) que ya borraba `history_`, `playlist_items_` y
  el top de Stats.fm suma `idbDelByPrefix(OCULTOS_ITEMS_PREFIX)`: son las
  canciones de las playlists de ocultos de la otra persona. Nadie las lee con
  otro usuario (la clave va por id de playlist), pero hasta v=299 se quedaban en
  su navegador. ⚠️ El prefijo vive en `util/ocultos-items-clave.js` (sin
  imports) y `hidden-sync.js` lo re-exporta: `api.js` no puede importar
  `hidden-sync.js` sin el ciclo `api.js → hidden-sync.js → playlist-add.js →
  api.js`, que revienta al cargar (`playlist-add.js` llama a
  `onPlaylistsInvalidated()` antes de que `api.js` cree su `Set`). Lo vigila
  `tests/likes-cache-policy.test.mjs`.
- **Nada en silencio.** Cada montón (la playlist perdió algo / nunca subió /
  no se puede representar) lleva `console.warn`, toast y línea en
  `ocultos_incidencias_v1`. Ese registro es la versión de `likes_borrados_log_v1`
  para ocultos, y existe porque de «La La La» no quedó **ninguna** huella.
- **Y `console.warn` no alcanza**: la extensión de Chrome no lo captura (v=163).
  Por eso está `#debug` → «Salud de los ocultos», que compara las seis playlists
  contra el navegador y nombra cada huérfana con su motivo. Si agregás un aviso
  nuevo a este mecanismo, que se pueda mirar desde ahí.

## `findPlaylist()`: «no existe» y «no pude preguntar» NO son lo mismo (v=287)

`util/hidden-sync.js`. Hasta v=286 el camino del id guardado de la playlist
espejo tenía **un solo `catch` para todos los fallos** y el `olvidarId(lsKey)`
colgaba **FUERA del `try`**: se ejecutaba tanto si Spotify contestaba «esa
playlist no es tuya» como si no contestaba nada.

**Lo que eso costaba, y no es el atajo.** Sin id, la playlist se rebusca **por
nombre**; si por nombre no aparece —la lista vino del caché de 24 h, o Ian la
renombró en Spotify y entonces el nombre no la encuentra NUNCA y el id era el
único vínculo—, `findPlaylist()` devolvía `null`, que es la señal que autoriza a
`ensurePlaylist()` a **CREAR**. O sea: **un corte de red podía terminar en una
playlist espejo DUPLICADA en la cuenta real**, con los ocultos repartidos entre
las dos y la mitad invisible desde la app. Y las playlists **no se pueden borrar
por API** post-migración, así que eso se limpia a mano.

🟥 **Ya había pasado la mitad**: el 08/10, con el driver cortando
`api.spotify.com`, abrir `#skips` y `#zeroplays` borró los dos
`fonoteca_hidden_pl_*` de una copia del perfil. Los ocultos sobrevivieron; el id
no. Lo que no se vio entonces es que la otra mitad del camino llega a `POST`.

### La frontera, que ya existía y nadie miraba

No hizo falta cambiar cómo se guarda el id —**ninguna migración**—: la
información para distinguir los dos casos ya viajaba en el error.

| el fallo | qué tira `api.js` | ¿confirma? |
|---|---|:---:|
| 404 | `err.status = 404` (`api.js:125-131`) | **sí** |
| la respuesta dice que no es tuya | no tira: contesta | **sí** |
| corte de red | `Error` PELADO, sin `status` (`api.js:84`) | no |
| 5xx agotado | `Error` PELADO, sin `status` (`api.js:107`) | no |
| 403 / 429 / 401 | `err.status` = ese código | **no** |

⚠️ **Solo el 404 confirma.** En particular **403 NO**: post-migración un 403 es
la respuesta normal de media docena de endpoints retirados (ver «Decisiones de
API»), así que leerlo como «la playlist no existe» es justo el error que esto
viene a evitar.

### Las tres reglas que quedan

1. **Un fallo sin respuesta NUNCA borra el id guardado.** Se conserva y se
   avisa. Es el único atajo a la playlist espejo y lo único que la ata cuando el
   nombre ya no coincide.
2. **`null` significa «confirmo que no existe»**, y es lo único que habilita a
   crear. Si el id quedó sin comprobar y por nombre tampoco aparece,
   `findPlaylist()` **tira** (`err.ocultosIndeterminado = true`) en vez de
   devolver `null`. `ensurePlaylist()` reintenta una relectura fresca y, si
   sigue sin saber, propaga: **no crea**.
3. **Un id guardado sin comprobar no se pisa** con el que salga del nombre. Las
   dos playlists son reales y para esa sesión da igual cuál se use; lo que no da
   igual es dejar escrito un puntero nuevo apoyado en que el viejo «no contestó».

Arriba de `ensurePlaylist()` nada tira: `ready()` sigue sin lanzar nunca (la
vista anda con el caché local), `toggle()`/`fijarVarios()` reportan la clave en
`fallidas` **con el motivo**, y `auditar()` lo deja en `fila.error`, que es lo
que enseña `#debug` → «Salud de los ocultos».

⚠️ **Coste**: en el camino de fallo `ensurePlaylist()` vuelve a sondear el id
guardado (antes no, porque ya lo había borrado). Es **+1 petición solo cuando
algo ya está fallando**; en el camino feliz no cambia nada.

🟥 **Lo que NO se hizo, a propósito**: un «no pude preguntar» **no** escribe en
`ocultos_incidencias_v1`. Ese registro tiene 100 huecos y una red que parpadea
los llenaría echando las pérdidas reales, que es para lo que existe. Queda en
`console.warn` y en la fila de `#debug`.

**Guardas**: `tests/hidden-sync-id-playlist.test.mjs` (36 asserts, los tres
casos; comprobado que da **17 fallos** contra el módulo de v=286) y, en la app
real con el driver, `fonoteca-migracion/driver-cdp-ocultos-sin-red-2026-10-08.mjs`.
⚠️ Y de paso se arregló el doble: `tests/dobles/api-doble.mjs` tiraba
`new Error('404 Not Found')` **sin `status`**, o sea que fingía un 404 que el
código nuevo leería como «no pude preguntar». Un doble que no respeta el
contrato del servicio es exactamente lo que su propia cabecera documenta que no
hay que hacer.

## La clave de descubrir: las dos direcciones, juntas (v=210/v=211)

✅ **El agujero hermano del de la uri, CERRADO.** `#discover-artists` escribía la
clave con el artista **que estás explorando** y `keyOfTrack` la releía con el
`artists[0]` **de la pista**. En colaboraciones, soundtracks y discos de remixes
no coinciden («CARNIVAL Pack» es de **¥$**, no de Kanye West) y esa clave no se
podía reconciliar por ningún camino. Eran 7 de 189.

Las dos direcciones viven ahora **en un archivo propio, `util/discover-key.js`**,
y las dos van por **el artista que FIRMA el álbum**: es el único dato que las dos
puntas tienen y que no depende de por dónde llegaste al disco. Si alguna vez hay
que tocar una, la otra está tres líneas más abajo — que es el punto del archivo.

⚠️ **NO es la convención de `#wthree`**, que va por el artista de la PISTA en las
dos direcciones (su índice de álbumes se arma desde las pistas de la playlist de
picks). Las dos son consistentes consigo mismas; lo que no puede pasar es
mezclarlas dentro de una misma vista. Por eso `recuperarUriDeAlbumKey` lleva
`porFirmaDelAlbum` y `#wthree` sigue con el default.

**Las siete no estaban rotas por la misma mitad, y eso decidió el arreglo**: seis
rompían al ESCRIBIR y «USB002 Remixes» rompía al LEER, porque ninguna de sus 50
pistas tiene a Fred again.. como `artists[0]`. Tocar solo `cardKey` habría dejado
esa séptima igual de rota.

⚠️ **Cambiar cómo se escribe una clave SIN migrar es una regresión, no un
arreglo**: los álbumes marcados con la forma vieja vuelven a la lista como si
nunca se hubieran tocado. Hay dos migraciones y hacen falta las dos:
- `migrarClavesViejas` (la vista), que necesita que el álbum aparezca en la
  discografía escaneada del artista;
- **el saneo por uri de `sync()`** (v=211), que no necesita ninguna tarjeta: si
  una clave local no está en la playlist pero su uri sí —y ahí dentro
  reconstruye otra clave—, la clave está vieja y se renombra. Es la prueba más
  dura de que dos claves son el mismo disco, porque una pista pertenece a un
  álbum y a uno solo, y no cuesta ni una petición.

⚠️ **El saneo por uri no es un lujo: sin él la playlist acumula duplicados sin
fin.** v=210 salió sin él y `reconciliar` leía esas claves como «la playlist
perdió un oculto del que conozco la uri»: **4 pistas duplicadas en la playlist de
descubrir, una más por cada sync**, hasta que lo cazó la verificación en la app.
Al cambiar cómo se lee una clave, preguntarse siempre qué pasa con las claves
que YA están escritas de la otra forma.

⚠️ **Y el renombrado es LOCAL a propósito.** Un `toggle` de la clave vieja haría
un `removeTracksFromPlaylist` con la uri que tuviera guardada — que es la misma
que representa a la clave nueva: se llevaría por delante justo el oculto que
venía a salvar. La uri se hereda y la pista no se mueve.

**Medido en la app real, con el ritual del SW** (2026-09-08): las huérfanas de
`#discover-artists` pasan de **7 a 1**, y de las 7 hay **6 con uri y viajando**.
La que queda es `3vil reflection||osamason`: el disco está firmado por
Glokk40Spaz y **ya no aparece en la discografía de Osamason**, así que ninguna
tarjeta la puede migrar y no tiene uri con la que sanearla. Queda anotada, con
su motivo a la vista en `#debug` — que es la regla: un oculto que no se puede
sincronizar nunca se descarta.

## Ninguna apertura de vista gasta cuota (v=261)
`#new-releases` y `#discover-artists` **no escanean al abrirse ni al cambiar el chip de
umbral de likes**, ni solas ni preguntando: se pintan con el caché del escaneo y lo que
falta se pide con «Elegir más artistas para escanear…». Los únicos caminos que piden
discografías son actos explícitos con su cartel: ese botón, «Actualizar» y «Base…».
`tests/sin-escaneo-automatico.test.mjs` lee el fuente y falla si un `render()` o un chip
vuelve a llamar a `scanArtists()`. ⚠️ **No toques la cola** (`util/cola-escaneo.js`,
`colaAutomatica`) «porque parece un bug»: v=259 lo hizo y gastó cuota de Ian sin preguntar.
Si ves algo raro ahí, anótalo en `PENDIENTES.md`. Un artista cuyo escaneo falló queda
marcado con el día (`util/escaneo-fallos.js`); un acto explícito lo reintenta igual.

## La vista pinta lo guardado, con el caché del escaneo vencido (v=262)
El caché del escaneo (`discover_scan_*`, 7 días) es la MARCA de «cuándo miré si salió algo nuevo»,
no los datos: las discografías viven en la base (`discover_disco_base_v1_*`, sin caducidad). Las dos
vistas de descubrir leen la marca CRUDA (`leerEscaneoGuardado`: sin `idbGetCached`, que borra lo
vencido al leerlo y se llevaba la fecha) y pintan desde la base con `restaurarDesdeLaBase` (0
peticiones, `leerBase`). Tres estados (`util/frescura-escaneo.js`): al día, **vencida** (se pinta lo
guardado y una línea con su botón dice cuándo fue la última comprobación y que puede faltar lo
reciente) y sin base. ⚠️ `saveScanCache` no adelanta la fecha mientras la vista muestre lo guardado
(`crearMarcasDeFrescura`): un escaneo PARCIAL la rejuvenecería y la próxima apertura diría «al día»
con 350 artistas sin mirar. No metas en ese camino nada que llame a `getArtistIdCached` o a
`getArtistDiscoCached`: pueden ir a `/search`. `tests/frescura-escaneo.test.mjs` lo vigila.

## El modal de W-Three reparte el ancho a favor de las pistas (v=264)
`.wt-modal` mide 1140 px (antes 920) y `.wt-body` es `minmax(0, 1fr) 280px`: el panel «Orden dentro del
álbum» —una lista de COMO MUCHO tres ítems— tiene ancho fijo y las pistas se llevan lo que sobra
(nombre de pista de 74 a 262 px, medido en el DOM con 4SZNZ y «BLING BØI EP 2»). ⚠️ **Con 240 px el
corte se MUDABA al panel de orden** (2 de 3 nombres con «…»): por eso 280 px y los nombres del orden en
dos renglones (`.wt-col-right .wthree-order-name`, solo dentro del modal). ⚠️ **#wthree NO usa
`.modal-picker`/`.picker-scroll`**: tiene su propia `.wt-modal` (flex column + overflow hidden, cabecera
y pie fijos); no se unificaron. El subtítulo de las tarjetas (`.wthree-album-artist`) va en
`--color-text-secondary` y **sin `opacity`** (antes muted + `opacity: .6` en las filas `is-weak`:
2,27:1 y 1,60:1; ahora 4,77:1 en Violeta). `tests/wthree-ancho-modal.test.mjs` lee la hoja y vigila las
dos decisiones.

## Tipografía de las tarjetas de #wthree (v=266)
Nombre del álbum a **12 px** (era 9: quedaba MÁS CHICO que su subtítulo de 10), etiquetas de los contadores
(`.wthree-stat-l`) a **10 px** (eran 7,5; en el `@media` de 600 px siguen en 9 a propósito: a 420 px «✅ completos»
con 10 px sobra 0,4 px). Las columnas son `repeat(5, …)` a mano y no se movieron. Las filas `is-weak` ya no dicen
«escuchado en 2026 · fuera del top 1000» en el renglón: solo el año, y el texto entero va al `title` de la fila
(`tituloFila` en `renderAlbumRow`; las filas normales no llevan `title`). Medido en el DOM de la copia, 1366 px:
alto de fila 24,9 → 28,2; tarjetas enteras a 591 px de alto 45 → 40; nombres cortados de 60: 3 → 5; subtítulos
cortados: 48 → 0. ⚠️ **40 es el piso**: la fila siguiente no entra y cualquier pixel más de alto de fila
(o de los contadores) baja ese número. `tests/wthree-ancho-modal.test.mjs` vigila el tamaño y el renglón.

## ⛔ NUNCA `git add -A` ni `git add .` — archivo por archivo
**Este repo es PÚBLICO.** El 2026-07-28 se filtraron datos personales y hubo que
hacer `filter-branch` + force push. Desde entonces la regla es `git add` **con
los archivos nombrados uno a uno**, siempre, sin excepción y sin importar lo
inocente que parezca el cambio.

La regla vivía solo en `fonoteca-migracion/PROMPT-INICIAL.md`, que **no se
autocarga**: el 2026-08-29 se usó `git add -A` en ocho commits seguidos sin que
nadie la viera (auditados después: no hubo filtración, pero la regla existe para
no depender de auditar después). Por eso está copiada acá, que sí se carga solo
al trabajar en este repo. Ver el porqué en `fonoteca-migracion/CONTEXTO-TECNICO.md`,
«una regla que no está donde se lee, no existe».

Deploy completo: poner el `?v=` nuevo en **los OCHO `?v=` de `src/`** —los 4 de
`src/index.html` y los 4 de `src/callback.html`— →

⚠️ **Hasta v=286 acá decía que «los otros tres `?v=` de `src/index.html` pueden
quedar atrasados», y eso era el bug de A.2 (v=287).** Es cierto que `build.sh`
reescribe el `?v=` de todo el HTML de `docs/` desde v=235 (y el nombre de caché
de `sw.js` desde v=257), así que **producción sale bien**. Pero el fuente queda
mintiendo, y nadie lo ve porque lo que se mira es producción: las tres hojas de
`src/index.html` llevaban **29 versiones** de atraso (`?v=257`) y los cuatro
recursos de `src/callback.html`, **261** (`?v=25`). Ahora lo vigila el punto
**4b** de `npm run prepush`, que falla con cualquier `?v=` de `src/` por detrás
del de `app.js` y lo nombra con archivo y línea. →
`bash build.sh` → `npm test` → `git add` archivo por archivo → `npm run prepush`
→ commit → push. **`npm run deploy` está desactivado a propósito** (v=258: hacía
`git add docs/`). Y **el `curl` no verifica el
despliegue**: ver la regla del service worker en `CONTEXTO-TECNICO.md`.
**Un arreglo encima de un despliegue lleva su propio `?v=`**, aunque sean dos
líneas: ver la sección de arriba.

## Copy de la interfaz: castellano de España `[v=190-192]`

Los textos que ve el usuario van en **castellano peninsular**, formas de «tú».
Los **comentarios del código NO** — esos siguen en rioplatense, que es la voz de
quien escribe. El pase de v=190 cambió 191 sitios de copy y dejó los ~142 de
comentarios intactos a propósito.

Reglas al escribir copy nuevo:

- «solo» **sin tilde**, siempre.
- Nada de voseo: «tienes», no «tenés»; «puedes», no «podés»; «aquí», no «acá».
- Ojo con los imperativos con pronombre pegado: «cárgala», no «cargala».
- Léxico: «escribir» y no «tipear», «al instante» y no «al toque», «navegador» y
  no «browser», «caché» (femenino) y no «cache» cuando es prosa — pero **no
  renombrar identificadores**, que ahí `cache` es código.
- Formateo de números: **`toLocaleString('es-ES')` explícito**. Sin el locale se
  usa el del NAVEGADOR (es-AR en las máquinas de Ian) y salen «9.357» y «9357»
  en la misma pantalla. En español los números de cuatro cifras van sin
  separador de millares.

⚠️ **Trampa de un reemplazo masivo, ya pisada una vez**: «pedí» puede ser
primera persona («yo pedí 3 ids»), que en España se dice igual. Convertirlo a
«pide» rompe la frase — lo cazó `tests/borrado-verificado.test.mjs`. Mismo caso
con «creé», «borré», «encontré», «marqué». Revisar el diff, no confiar en el
`sed`.

## «días de música»: el punto y la coma (v=287)

El mismo dato, con el mismo copy, formateado de dos maneras **en la misma
pantalla del Dashboard**: `556h · 23.2 días de música` en el tile de los me
gusta (`dashboard.js`, `renderDashboard`) y `4455h · 185,6 días de música` en el
del historial (`hydrateHistorySection`), tres tiles más abajo. v=282 arregló el
segundo y dejó el primero.

**Se unificó a la COMA**, que es lo que corresponde: el copy visible es
castellano de España (ver «Copy de la interfaz»), y ahí el separador decimal es
la coma. `toFixed(1)` da «23.2» con el punto del inglés y **no falla nunca** —el
número que imprime es correcto—, así que esto solo se ve mirando la pantalla.
Va con `toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })`,
con el locale **explícito**: sin él se usa el del navegador, que en las máquinas
de Ian es `es-AR`, o sea que el bug se ve en su Chrome y no en una máquina en
inglés.

⚠️ **Había una TERCERA copia**, y viva: `fmtDays()` de `features/wrapped.js`
(`«398.4 días equivalentes»`), que pintan los dos héroes de `#wrapped`.
Arreglada en el mismo commit — es el mismo dato con el mismo copy.

🟥 **Lo que queda abierto, anotado en `PENDIENTES.md` y NO hecho acá:**
- **`Skips 64.1%`**, en la MISMA fila de tiles (`dashboard.js`, `${t.skip_pct}%`
  crudo del JSON). Mismo defecto, otra magnitud. Y `#wrapped` ya lo pinta con
  coma (`fmtPct` de `wrapped-apertura.js`), así que las dos vistas enseñan el
  mismo porcentaje de dos formas.
- **Cuatro formateadores decimales privados, ninguno compartido**:
  `records.js fmtNum()`, `mosaico.js fmt1()`, `app.js fmtMB()` y el
  `toFixed(dec).replace('.', ',')` de `wrapped-apertura.js` —que además clava la
  coma a mano en vez de pedirle el separador al locale—. Es la misma forma que
  tenía `fmtDate()` cuando v=231 lo borró: **la copia fue la que mintió**.
  Centralizarlos toca cuatro features y es su propio encargo.

**Guarda**: `tests/dias-coma-decimal.test.mjs` (9 asserts). Afirma los tres
sitios, comprueba que `Intl` tiene ICU de verdad —si no, la suite no significa
nada— y lleva una regla ancha que caza cualquier `toFixed()` pegado a la palabra
«días», que es la forma que tenían las tres. Comprobado que se pone roja.

## `util/mb-pais.js`: la regla del país (v=302, arreglada en v=303)

Para el mapamundi de escucha (todavía no existe: esto es la fase 1, medir). Spotify
no da el país de un artista; MusicBrainz sí, y la búsqueda `/ws/2/artist/?query=…`
lo trae en la misma respuesta (`country`, `area`), sin el lookup. `util/mb-pais.js`
es un módulo hoja, **sin imports y sin red**: recibe respuestas ya bajadas y decide.
**Desde v=304 lo importa `util/mapa-paises.js`** (la vista `#mapa`, ver abajo) y
lo usa la medición, que vive en `fonoteca-migracion/mapa/`: una sola regla, no una
copia (el resolutor de álbumes de v=219). El comentario de cabecera de `mb-pais.js`
decía «hoy no lo importa nadie» hasta v=305 (quedó viejo en v=304); **se corrigió en
v=306**, y es lo único que cambió en ese archivo: la consulta (`queryArtista`) sigue
siendo `artist:"…"` — ver «Los nombres y el ritmo (v=306)», más abajo.

**v=307: la consulta de siempre NO cambió** (`queryArtista()` byte a byte, y sus dos asserts
del caso 9 de `tests/mb-pais.test.mjs` tampoco). Se SUMA una segunda,
`queryArtistaConAlias()` = `artist:"…" OR alias:"…"` (mismas comillas y escapes, caso 15), que
`#mapa` pide **solo como respaldo**, cuando la de siempre no trae a nadie que se llame así. La
regla (`clasificar`, `comoCoincide`) no se tocó: con lo que traiga el respaldo se clasifica
igual. Ver «El alias de respaldo y el rango (v=307)», más abajo.

`clasificar(nombre, artistasMB, idsDeGrabacion)` da una de cinco clases, comparando
por **igualdad** de `name`, `sort-name` o algún alias después de `normalizarNombre`
(nunca por `score` ni por parecido):

| clase | cuándo | país |
|---|---|---|
| `sin-candidato` | ninguno se llama igual | ninguno |
| `unico` | uno solo | el suyo, si lo tiene |
| `varios-mismo-pais` | varios, y **TODOS** traen `country`, el mismo (v=303) | ese |
| `desempatado` | varios sin eso (países distintos, o alguno sin país) y la búsqueda de la grabación nombra a uno solo | el de ese |
| `ambiguo` | varios sin eso y la grabación no desempata | ninguno |

🔴 **Nunca se adivina**: lo que no se puede atribuir con certeza queda sin país. Un
país equivocado se ve igual que uno correcto. Y `unico` no quiere decir «correcto»
(puede ser un homónimo); `corroborado()` mide eso, no cambia la clase.

🔴 **`varios-mismo-pais` exige país en TODOS los coincidentes (v=303).** Hasta v=302
bastaba con que «todos los que tienen `country` tengan el mismo», y la medición
encontró el caso que eso rompe: el artista de verdad **sin** `country` (su área es
una subdivisión) y dos homónimos de otro país con `country`. Salía el país de los
homónimos, y como esa clase no pide la grabación, nada lo corroboraba. **El
homónimo sin país puede ser el de verdad.** Ahora, si alguno no trae `country`, va
por la grabación como cualquier otro caso de varios (`necesitaGrabacion: true`).

⚠️ **No usa `normText`** (`util/track-match.js`): tira todo lo que no sea
`[a-z0-9 ]` y «¥$» le queda en la cadena vacía (v=142). `normalizarNombre` es NFKD,
sin diacríticos, **los apóstrofos `’` (U+2019), `‘` (U+2018) y `ʼ` (U+02BC) pasados
al recto `'`** (v=303: MusicBrainz escribe muchos nombres con el tipográfico y el
nombre pedido viene con el recto), minúsculas y espacios colapsados, nada más. El
resto de la puntuación no se toca. Lo vigila el caso 7 de `tests/mb-pais.test.mjs`
(visto ponerse rojo con `normText`) y el 12 (visto rojo sin el reemplazo).

### El país que sale del área (v=303)

MusicBrainz **no manda `country` cuando el área es una subdivisión o una ciudad**.
La búsqueda trae del área su `id`, `type` y `name`, **pero ningún código ISO**. El
lookup `/ws/2/area/<id>?inc=area-rels` trae las relaciones «part of»: el padre va
con `direction: "backward"` (las «forward» son los hijos) y el área del padre viene
**con su `type` y sus códigos ISO**. O sea que se sube de a un lookup por salto.

- 🔴 **Nada de tablas de nombres de áreas o de países**, escritas o bajadas: es una
  regla escrita dos veces. El país sale de lo que contesta MusicBrainz, o no sale.
- La **decisión** vive acá, pura: `paisDeArea(areaId, areas)` recibe las respuestas
  de área ya bajadas (Map u objeto, por id) y sube hasta un área `type: "Country"`
  con **un único** `iso-3166-1-codes` de dos letras. **Dos padres, cadena cortada,
  más de `TOPE_SALTOS_AREA` (3) saltos o un país sin código único → sin país.** Si
  falta bajar un área, lo dice (`falta`) y la red la pone quien llama.
- `completarConArea(resultado, areas)` se lo aplica a un `unico` o `desempatado` sin
  `country`; no cambia la clase ni el `mbid`, y marca **`paisDe: 'area'`** (contra
  `'country'`) para poder contarlos aparte. `clasificar` devuelve además `areaId`.
- **El costo es por ÁREA DISTINTA, no por artista**: un área se pide una vez y sirve
  para todos los artistas que la traen. Quien haga la red guarda cada respuesta y
  no la vuelve a pedir.
- Un país que sale del área **necesita la misma corroboración** (la búsqueda de la
  grabación) que uno que vino en `country`.

`api/musicbrainz.js` y `by-genre.js` **no se tocaron**: siguen con su `limit=1` a
ciegas (anotado en `fonoteca-migracion/PENDIENTES.md`).

## 🗺️ `#mapa`: tus países (v=304)

La fase 2 del mapa: una LISTA, no un dibujo (el mapamundi llegó en v=305, sobre esta
misma ruta: ver «El mundo (v=305)», abajo). Tus países ordenados por minutos, con cuántos artistas tiene cada uno, y
un bloque de cobertura que dice cuánto se sabe y cuánto no. Ruta `#mapa`, menú
General, detrás de «Calendario», icono propio (`ICONS.mapa`, un globo); la cabecera
dice «Tus países». La medición vive en `fonoteca-migracion/mapa/`.

Tres archivos, para que lo que importa se pruebe sin navegador:

| archivo | qué | probado en |
|---|---|---|
| `util/mapa-paises.js` | PURO: el universo (≥ 10 min, por minutos y a igualdad por nombre con comparación simple), el próximo pedido de cada artista, los países y las cinco filas | `tests/mapa-paises.test.mjs` |
| `util/mapa-escaneo.js` | el bucle, con la red, el reloj, el guardado y el candado INYECTADOS | `tests/mapa-escaneo.test.mjs` (MusicBrainz y reloj de mentira) |
| `features/mapa.js` | la vista: enchufa `fetch`, IndexedDB, `navigator.locks` y `setTimeout`, y pinta | `tests/banco/mapa.html` (en `prepush`) |

Las decisiones, y por qué:

- 🔴 **Abrir la vista NO escanea** (la regla de v=261, aplicada a MusicBrainz). Abrir
  cuesta el `/me` de `loadOne()` y **0** peticiones a MusicBrainz: pinta la caché. El
  escaneo arranca solo con el botón («Buscar países», «Seguir», «Parar»). Son miles de
  peticiones y más de una hora; nadie puede gastarlas por abrir una pantalla.
- 🔴 **La regla es `util/mb-pais.js`, importada y sin tocar.** «Tiene país» es la
  definición **estricta** de las tandas 50 y 51: `unico` CORROBORADO por la grabación,
  `varios-mismo-pais`, o `desempatado` con país (de `country` o del área). Un `unico` con
  país sin corroborar va a su propia fila, «sin confirmar», y no suma a ningún país: un
  homónimo se ve igual que el de verdad.
- 🔴 **Los desconocidos NO se reparten** entre los países, ni en proporción ni de ninguna
  forma, y el % de cada país es del TOTAL del historial (también los de < 10 min), no del
  total con país. Repartir haría que un 70 % conocido se leyera como un 100 %.
- **Las cinco filas** (con país · sin país · sin confirmar · sin buscar todavía · menos
  de 10 min) suman **exactamente** el total: se cuentan en décimas de minuto, enteros.
- 🔴 **La caché guarda lo que CONTESTÓ MusicBrainz, recortado, no la decisión.** Por
  artista: los candidatos con lo que lee `clasificar` (id, name, sort-name, los nombres
  de los alias, country, area con id/name/type, disambiguation), los ids de la
  grabación (o `null`: no se pidió; `[]` es «pregunté y no hay») con el título buscado,
  y la fecha. Por área: `type`, `iso-3166-1-codes` y las «part of» hacia el padre
  (`backward`; las `forward` son los hijos y la regla no las lee). La decisión se
  recalcula al pintar (pura, gratis): si la regla cambia, la caché sigue sirviendo sin
  repetir una petición. Y por eso el progreso se guarda a medias (una búsqueda sin su
  grabación) sin marca de «terminado»: `proximoPaso()` deduce lo que falta.
- **Las claves**: `mapa_artista_v1_<uid>_<nombre>` lleva el uid porque la lista de
  artistas es dato de escucha (el uid va también DENTRO del valor: «abc» es prefijo de
  «abc_x»); `mapa_area_v1_<id>` no, porque un área es dato público y se comparte. Sin
  caducidad. Las dos están en `CONSERVAR_PREFIJOS` (`util/limpiar-cache.js`) y en
  `LO_QUE_SE_CONSERVA`: «Limpiar caché» no se puede llevar horas de escaneo. **El cambio
  de usuario no las borra**, y no hace falta: el bloque de `getCurrentUserId()`
  (`api.js`) borra `history_`, `playlist_items_`, los ocultos y Stats.fm; las de artista
  no se cruzan entre usuarios (van por uid) y las de área no son de nadie.
- **El ritmo** (lo que midieron la 50 y la 51; el ajuste fino es de otra tanda): una
  petición por vez y **1.200 ms como mínimo entre comienzos**. Un 503, 429, 5xx o corte
  de red es de MusicBrainz: se espera **10 s** y se reintenta **el mismo pedido**, luego
  20, 40, 80 y de ahí 80 fijos; nunca se guarda y nunca salta al artista (la regla de
  `util/cache-solo-exitos.js`, escrita a mano porque acá hay tres salidas: guardar,
  reintentar o soltar al artista). **8 fallos seguidos sin un 200** → se pausa solo
  («MusicBrainz no contesta ahora…»), sin descartar nada. Un 4xx que no es 429 es del
  artista: «no se pudo consultar» en la sesión, sin guardar, y se sigue. Cada respuesta
  buena se guarda ANTES de la petición siguiente, y un área se pide una sola vez en toda
  la vida de la caché.
- **Las URLs son las de la medición de la 51** (búsqueda `limit=10`; grabación del tema
  con más minutos, `limpiarTitulo`, `limit=25`; área `inc=area-rels`) y en el mismo
  orden: lo que mida la app se puede comparar con aquello.
- **Sin ninguna cabecera propia en el `fetch`**: una cabecera no simple provoca una
  `OPTIONS` previa por pedido (el doble contra MusicBrainz), y el `User-Agent` no se puede
  fijar desde `fetch` en Chrome.
- **Una sola búsqueda a la vez en el navegador**: `navigator.locks.request('fonoteca-mapa-escaneo',
  { ifAvailable: true }, …)`. Si otra pestaña lo tiene, esta no escanea y lo dice; con
  el candado en la mano se relee la caché (lo que resolvió la otra no se vuelve a pedir).
- **Al salir de la ruta el escaneo para**: el `teardown` aborta la señal y el bucle
  pregunta por la vigencia después de cada `await` (un teardown no corta un `await`,
  v=174). Ninguna escritura al DOM después de salir.
- ⚠️ **Las esperas no van encadenadas** (Chrome espacia los `setTimeout` encadenados de una
  pestaña oculta hasta uno por minuto): antes de cada `fetch` hay como mucho UNA espera.
  🟥 **Pero la pestaña oculta NO está verificada**: en headless no se puede comprobar. La
  pantalla pide dejarla a la vista y enseña el ritmo medido (peticiones por minuto de los
  últimos 3 minutos) para que, si se frena, se vea. La estimación de lo que falta usa lo
  medido, nunca un número fijo (el cartel de `#genre`, que NO se tocó, calcula 1,1 s por
  artista y son dos). Hasta v=305 eran los totales **de la sesión**; desde v=306, lo
  ACUMULADO entre cargas y por lo alto (ver «Los nombres y el ritmo (v=306)»).
- Se repinta a lo sumo una vez por frame (`requestAnimationFrame` con un `setTimeout` de
  respaldo, porque rAF no corre en una pestaña oculta ni en headless con `--dump-dom`) y
  solo las secciones que cambiaron (los botones van en la suya: si no, «Parar» se
  recrearía en cada petición). Los `<details>` abiertos siguen abiertos al repintar.
- `idb.js` suma `idbEntriesEnRango(prefijo)`: lee solo el rango de claves del prefijo. El
  `idbEntriesByPrefix` de siempre recorre con cursor la base entera, me gusta y base de
  colores incluidos (megas), y abrir `#mapa` lee una clave por artista.
- Los nombres de los países salen de `Intl.DisplayNames(['es-ES'], { type: 'region' })`:
  ninguna tabla. Sin banderas, sin colores por país, sin animaciones nuevas.

El banco (`tests/banco/mapa.html` + `mapa-caso.html` + `mapa-datos.mjs`, historial y
MusicBrainz INVENTADOS, el MusicBrainz vive en la madre para sobrevivir a la recarga de un
iframe) afirma: abrir = 0 MusicBrainz y 1 `/me`; el primer país sale con el primer artista;
con 503 en un patrón fijo termina igual y nadie queda sin país por un 503; recargar a mitad
y «Seguir» no repite nada contestado; salir para (0 peticiones en 30 s de reloj) sin
errores; dos iframes: uno busca y el otro lo dice; las cinco filas = la cuenta a mano;
«Limpiar caché» conserva las dos claves. `mapa-caso.html?foto=1` es el instrumento de la
captura sembrada y de la medida del repintado (con `&artistas=N`), con un conductor
externo y sin reloj virtual.

### El mundo (v=305)

La fase 3: un mapamundi en SVG dentro de la MISMA vista, entre «Cuánto se sabe» (que sigue
primero) y «La búsqueda». No cambia qué se busca, cómo, ni la regla del país: cambia lo que
se ve. Cuatro archivos:

| archivo | qué | probado en |
|---|---|---|
| `scripts/generar-mundo.mjs` | el generador (Node, sin dependencias) | `tests/mundo-geometria.test.mjs` (la proyección) |
| `util/mundo-110m.js` | GENERADO y commiteado: `ANCHO`, `ALTO`, `VIEWBOX` y `FORMAS = [{ iso, d }]` | `tests/mundo-geometria.test.mjs` |
| `util/mapa-mundo.js` | PURO: el tono de cada país, los que no tienen forma, la línea de detalle, la leyenda | `tests/mapa-mundo.test.mjs` |
| `features/mapa.js` | carga la geometría, arma el SVG una vez y aplica los tonos | `tests/banco/mapa.html` (seis puertas más) |

Lo decidido, y por qué:

- **La geometría se genera una vez y se commitea; la app no baja nada.** Fuente: Natural Earth,
  «Admin 0 – Countries» 1:110m, **v5.1.2**, **dominio público**
  (`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson`,
  `sha256 6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`, 838.726 bytes, 177
  países). **Para regenerarla**: bajar ese archivo a una carpeta `tmp-*/` (la tapa el
  `.gitignore`; el GeoJSON NO se commitea) y `node scripts/generar-mundo.mjs <ruta>`. El
  generador comprueba el sha256 y **para** si no coincide: otra versión es otro mapa.
- **Va en `src/js/util/`, no en `src/data/`**: así `build.sh` le estampa el `?v=` al
  `import()` (un módulo de datos viejo servido de la caché no falla, miente), y `src/data/`
  es el horneado del historial. Pesa ~73 KB (tope que se puso: 150 KB).
- **Se carga solo al abrir `#mapa`**, con `import('../util/mundo-110m.js')` al principio de
  `render()`, en paralelo con el historial: abrir la app no lo baja. 🔴 **La lista nunca
  depende del dibujo**: si el `import()` falla, la sección dice en una línea que no se pudo
  cargar el dibujo y que la lista está completa, y todo lo demás sigue.
- 🔴 **El código del país sale de `ISO_A2_EH`, nunca de `ISO_A2`.** En ese archivo `ISO_A2`
  trae `-99` en Francia, Noruega y Kosovo, y `CN-TW` en Taiwán (visto al hacer fallar la puerta
  del generador). Los que dan `-99` también en `ISO_A2_EH` (Northern Cyprus y Somaliland) se
  escriben con `iso: null`: se dibujan en gris, sin código y sin poder elegirse. **Ninguna tabla
  de corrección a mano.**
- **La Antártida (`AQ`) afuera**: ocupa el fondo del dibujo y nadie hace música ahí. Es la
  única exclusión (176 formas: 174 con código y 2 sin). El `viewBox` sigue siendo el del mundo
  entero, con el (0°, 0°) en el centro: abajo queda una franja vacía, a propósito.
- **Proyección Equal Earth** (Šavrič, Patterson y Jenny, 2018). Conserva las áreas: en un mapa
  pintado por cantidad, Mercator o la equirrectangular agrandan Canadá, Rusia y Groenlandia y
  un color pesa más de lo que vale. Constantes A1 = 1,340264, A2 = −0,081106, A3 = 0,000893,
  A4 = 0,003796 y M = √3/2: **confirmadas contra el código de `equalEarthRaw` de d3-geo** (leído
  de una copia local; la tanda 53 no tenía red para el artículo). Dan ±2,7066 × ±1,3174, y el
  test lo afirma. `viewBox` de 1000 × 486,7.
- **Coordenadas a 1 decimal y en comandos relativos** (`M x y l dx dy … z`). El redondeo va
  sobre las ABSOLUTAS (en décimas, enteras) y los relativos son restas de enteros: no se
  acumula error. Un anillo que el redondeo deja en menos de 3 puntos se omite (pasa con una
  islita de Corea del Norte; el país conserva su forma principal). Relleno `evenodd`: los
  huecos (Lesoto dentro de Sudáfrica) salen bien sin depender del sentido de los anillos.
- **Los cinco cortes son FIJOS**, sobre TODO el historial (el mismo % de la lista): tono 5
  desde el 10 %, 4 desde el 3 %, 3 desde el 1 %, 2 desde el 0,3 % y 1 por encima de 0. No son
  cuantiles ni dependen del máximo: la leyenda se lee en palabras («10 % o más») y un país no
  cambia de color porque otro creció. La cuenta es con enteros (`tonoDe`: décimas × 1000 contra
  total × el corte en décimas de punto). ⚠️ En el borde, la lista redondea a un decimal: un país
  con el 9,99 % va en el tono 4 y la línea de detalle dice «10,0 %».
- 🔴 **Un país sin minutos asignados va «sin datos», aunque tenga artistas sin confirmar**: lo
  «sin confirmar» y lo «sin país» no se pintan en ningún país, igual que en la lista.
  `mapa-mundo.js` solo lee `mapa.paises`; nunca `sinPais` ni `filas`.
- **Lo que no se ve**: un país con minutos sin forma a esta escala (Malta, Singapur, Hong Kong,
  Mónaco, Andorra, Baréin, Barbados…) o con `-99` va en «No se ven en el mapa: …», con su
  nombre de `Intl.DisplayNames`. **Nunca desaparece de la lista**: sigue arriba, con sus minutos.
- **Los colores salen del tema, ninguno escrito a mano.** Los cinco tonos son
  `color-mix(in srgb, var(--color-accent) P%, var(--color-surface))` con P = 33 · 50 · 67 · 83 ·
  100 (`--mm-t1`…`--mm-t5` en `.mapa-mundo`); «sin datos» es `--color-elevated`; los bordes,
  `--color-border`; el texto de la leyenda, el detalle y «no se ven», `--color-text-secondary`
  (nunca el muted). Las proporciones se eligieron para que en Violeta —el preset con menos
  distancia entre «sin datos» y el acento (2,89:1 en total)— los pasos queden parejos. El 1,2:1
  de piso lo puso el encargo de la tanda 53, no es un estándar. Contraste WCAG 2.x (todos
  opacos: no hay alfa que componer), «sin datos»/1 y cada tono con el siguiente:

  | preset | sin datos/1 · 1/2 · 2/3 · 3/4 · 4/5 | contra la tarjeta: sin datos · 1 · 2 · 3 · 4 · 5 |
  |---|---|---|
  | violeta | 1,23 · 1,23 · 1,24 · 1,23 · 1,24 | 1,09 · 1,35 · 1,65 · 2,06 · 2,54 · 3,15 |
  | ámbar | 1,58 · 1,42 · 1,41 · 1,35 · 1,34 | 1,10 · 1,74 · 2,47 · 3,47 · 4,68 · 6,28 |
  | aguamarina | 1,91 · 1,54 · 1,49 · 1,40 · 1,38 | 1,11 · 2,12 · 3,26 · 4,87 · 6,83 · 9,43 |
  | papel | 1,51 · 1,40 · 1,44 · 1,42 · 1,40 | 1,18 · 1,78 · 2,50 · 3,59 · 5,08 · 7,10 |

  Los cinco van en orden en los cuatro (del más parecido a la tarjeta al más fuerte). Lo
  recalcula `tests/mapa-mundo.test.mjs` leyendo las proporciones de la hoja y los colores de
  `PRESETS`: si alguien cambia una proporción o un preset, la tabla se vuelve a medir sola.
  ⚠️ Un tema hecho a mano con el acento muy parecido a la superficie puede no llegar: no se
  vigila (son los colores del usuario).
- **Tocar el mapa escribe en la LÍNEA DE DETALLE, debajo**, no en una caja flotante (en el
  móvil, el dedo la tapa): nombre, minutos, % y artistas; un país sin datos, «sin datos». Con el
  dedo, el `pointerleave` llega al soltar, así que solo el ratón limpia la línea al salir.
  **Clic en un país con datos → su fila de la lista se abre (`<details open>`) y se lleva a la
  vista** (`scrollIntoView`, sin animación); sin datos, solo la línea.
- **Accesibilidad por la lista**: el SVG va con `role="img"` y un `aria-label` («Mapa de tus
  países: N países con minutos», N = los de la lista). **Los países NO son focusables** (serían
  174 paradas de tabulador): la versión accesible del mapa es la lista de países, que ya existe.
- **Mientras busca, sin rehacer el SVG**: el SVG se arma una vez por render y cada repintado (el
  mismo, a lo sumo uno por frame) solo cambia el `data-tono` de los países que cambiaron. Al
  armarse usa la última cuenta del repintado (`st.ultimoMapa`) y no vuelve a llamar a
  `armarMapa`. Medido en el banco con 2.302 artistas sintéticos (Chrome headless, sin reloj
  virtual): ver `fonoteca-migracion/CONTEXTO-TECNICO.md`.
- Sin animaciones nuevas, sin banderas, sin zoom ni arrastre, ninguna librería de mapas.

El banco suma seis puertas (con un artista INVENTADO en Malta y otro con pocos minutos en
Uruguay): al abrir con la caché vacía el SVG está y todo va «sin datos» (0 MusicBrainz, 1
`/me`); al final cada país pintado tiene el tono de la cuenta a mano y los pintados son los de
la lista menos los sin forma; Malta está en la lista y en «No se ven»; clic en un país pintado
abre su fila; con el primer artista resuelto ya hay un país pintado; 0 errores.

### Los nombres y el ritmo (v=306)

La fase 4. No cambia lo que se ve (el mundo, los tonos, la leyenda, la lista): cambia cómo se
calcula la estimación de «lo que falta». **La búsqueda del artista NO cambió**, y eso también es
un resultado. ⚠️ **Desde v=307 hay dos cosas de esta parte que ya no valen tal cual**: la consulta
por alias SÍ se pide, pero como respaldo y no como reemplazo, y la estimación es un rango, no un
número por lo alto. Ver «El alias de respaldo y el rango (v=307)», abajo; lo de acá queda como el
porqué.

**La consulta: medida, probada y revertida.** Hay artistas que se quedan `sin-candidato` aunque
están en MusicBrainz, porque `artist:"…"` **no mira los alias ni el sort-name**: un artista que
cambió de nombre y conserva el viejo como alias, o uno que MusicBrainz escribe con otra
puntuación y tiene la de Spotify como sort-name o alias. `comoCoincide()` ya acepta un alias igual
desde v=302 (lo afirma, como conservación, el caso 14 de `tests/mb-pais.test.mjs`, con un artista
inventado): lo que falla es **la consulta**, no la comparación. Lo midió la tanda 54
(`fonoteca-migracion/mapa/medir-nombres-2026-10-15.mjs` y su JSON):

- `artist:"n" OR alias:"n"` encuentra a los renombrados, pero a un nombre corto y común le quita
  los coincidentes de los 10 primeros (los que salen por nombre Y por alias suman las dos partes y
  se adelantan).
- `artist:"n" OR (alias:"n" AND NOT artist:"n")` (los que salen por nombre puntúan como antes)
  encuentra a los renombrados y conserva ese caso, **pero sobre los 200 de la muestra le quitó el
  país a un artista que lo tenía** (con un apóstrofo en el nombre: con la consulta nueva dejó de
  aparecer en los 10 primeros; el control con la consulta vieja, el mismo día, sí lo encontraba), y
  pasó a varios `unico` a `desempatado` (el mismo país, pero una grabación más por artista). **Por
  la regla de siempre —un país perdido o equivocado se ve igual que uno correcto— se revirtió.** El
  intento entero queda en `fonoteca-migracion/mapa/` (parche y medición) para la tanda que lo
  retome. (v=307 lo retomó: la consulta `artist:"n" OR alias:"n"`, pero **solo detrás** de una
  búsqueda de siempre que no encontró a nadie. El problema era reemplazar, no la consulta.)
- Los que **no arregla ninguna consulta** sin aflojar la igualdad, y no se hace: un nombre que
  MusicBrainz escribe con otro carácter (una letra griega donde Spotify pone `/\`) y sin el de Spotify
  como alias, y uno al que Spotify le agrega un punto final que MusicBrainz no tiene ni como alias.
  Y los que **no están en MusicBrainz** (0 resultados por nombre y por alias): eso no se arregla con
  una consulta. Ninguna tabla de nombres escrita a mano, ninguna corrección por `score`.

**La estimación de lo que falta** (`estimarLoQueFalta`, `util/mapa-escaneo.js`):

- 🔴 **Se ACUMULA entre cargas.** Hasta v=305 usaba los totales de la SESIÓN, y una recarga la ponía
  en cero: la sesión nueva arrancaba sin 503 y prometía menos de la mitad. Ahora lo medido
  (peticiones, 503, artistas, y la suma de la duración de cada artista y de sus cuadrados) vive en
  `mapa_ritmo_v1_<uid>` (`claveRitmo()` de `util/mapa-paises.js`), se guarda en cada respuesta y en
  cada artista resuelto, y la vista lo lee al abrir: recargar o volver sigue desde ahí, y la línea
  se enseña también con la búsqueda a medias, antes de apretar «Seguir». La duración de un artista
  es el tiempo de búsqueda activa desde el anterior (o desde el clic): nunca el que la página estuvo
  quieta. Con el uid también dentro del valor, como la del artista.
- **«Limpiar caché» la BORRA, a propósito** (no está en `CONSERVAR_PREFIJOS`): es una medición, no un
  dato; sin ella la pantalla dice «se estimará cuando se hayan buscado N artistas», que es lo
  correcto, y rehacerla son unos pocos artistas. El cambio de usuario no la toca: va por uid.
- 🔴 **Por lo alto, nunca al centro.** La duración de cada artista varía mucho (un 503 son 10 s de
  espera, y vienen en ráfagas), así que se enseña el extremo alto de lo que pueden sumar los que
  faltan: `media·p + 2·σ·√(p + p²/n)` (p = los que faltan, n = los medidos; es el intervalo de
  predicción de una SUMA: el `p²/n` es lo que no se sabe de la media y el `p`, lo que varía cada
  uno), **redondeado hacia arriba** al minuto. Texto: «Quedan ~N peticiones: unas 3 horas y 50 min,
  calculado por lo alto con el ritmo medido.» (Hasta v=306: desde v=307 esto es la cota alta de un
  rango, con una racha de 503 entera sumada; el texto cambió. Ver abajo.)
- **Nada con menos de 5 artistas medidos** (`MIN_ARTISTAS_ESTIMAR`): con dos o tres duraciones la σ
  no dice nada (un arranque tranquilo da σ≈0).
- El criterio con el que se eligió (lo puso el encargo, **no es un estándar**): desde la primera
  lectura con número, lo enseñado no queda por debajo del 90 % de lo que faltaba de verdad, en
  ninguna lectura. Comprobado REPRODUCIENDO la línea de tiempo de una corrida real ya medida
  (`fonoteca-migracion/mapa/reproducir-estimacion-2026-10-15.mjs`: la función vieja falla, la nueva
  no) y con líneas de tiempo inventadas en `tests/mapa-escaneo.test.mjs` (503 repartidos, una
  recarga a mitad, un arranque sin 503).
- ⚠️ **Lo que no arregla**: un cambio de humor de MusicBrainz (un día con 3 % de 503 y otro con 16 %)
  no lo ve lo medido antes; y si la búsqueda arranca en un tramo tranquilo largo, el primer número
  sale bajo hasta que llega la primera ráfaga. El ritmo, la espera tras un 503, la pausa de 8 y el
  candado **no se tocaron**.

El banco suma dos puertas: cerrar a mitad y volver (otro documento) y la estimación sigue desde lo
acumulado sin apretar nada (no vuelve a «se estimará…» ni baja a la mitad), y «Limpiar caché» borra
`mapa_ritmo_v1_` y conserva los artistas y las áreas.

### El alias de respaldo y el rango (v=307)

La fase 5. El mundo, los tonos, la leyenda, la lista y la cobertura no cambian. Cambian dos cosas:
**cuándo** se le pregunta a MusicBrainz por un alias, y **cómo se enseña** lo que falta.

**El alias, como RESPALDO, nunca como reemplazo.** La búsqueda de siempre (`artist:"…"`,
`queryArtista()`/`urlBusqueda()`) queda **byte a byte igual**. Si da `sin-candidato` (nadie con ese
nombre), `proximoPaso()` pide `{tipo: 'respaldo'}`: **una petición más**, `artist:"…" OR alias:"…"`
con `limit=10` (`queryArtistaConAlias()`/`urlBusquedaConAlias()`), por el mismo bucle, al mismo ritmo y
con el mismo botón. Con su respuesta se clasifica con la **MISMA** regla (`clasificar`, igualdad de
`comoCoincide`), la grabación va con el nombre que pidió el usuario y un `unico` se corrobora igual.
Nada de `score`, de parecido ni de tablas de nombres.

- **Por qué respaldo y no reemplazo.** El caso, inventado: «Faro Viejo» sale `unico`, con su país y
  corroborado, con la búsqueda de siempre; con la consulta por alias puesta EN LUGAR de esa, los que
  salen por nombre y por alias se adelantan y «Faro Viejo» queda fuera de los 10 primeros: pierde el
  país. Es lo que encontró la tanda 54 con un artista de verdad, y por eso lo revirtió. Detrás de un
  `sin-candidato` eso no puede pasar: no hay ningún país que perder.
- 🔴 **La garantía, por construcción**: con `unico`, `varios-mismo-pais`, `desempatado` o `ambiguo`
  en la de siempre, el respaldo **no se pide** y, si el registro lo trajera, **no se lee**. Un artista
  que hoy tiene país, «sin confirmar» o `ambiguo` no puede cambiar por esto. La vigilan
  `tests/mapa-paises.test.mjs` (sección 10: las cuatro clases, con un respaldo que traería a otro) y
  las cuatro puertas vistas fallar (pedirlo siempre, no pedirlo nunca, usarlo también con `ambiguo`,
  volver a pedir la búsqueda entera para un registro viejo).
- **La caché** guarda lo que contestó, recortado como los candidatos: el registro de
  `mapa_artista_v1_<uid>_<nombre>` suma `respaldo` (`null` = no se pidió, `[]` = se pidió y no trajo
  nada) y `respaldoConsultado`. **El prefijo de la clave NO cambió**: cambiarlo dejaría inalcanzable
  lo que ya se buscó. La decisión se sigue recalculando al pintar.
- **Los registros viejos** (v=304-306, sin el campo): uno `sin-candidato` pide **solo** el respaldo,
  nunca la búsqueda otra vez, y mientras tanto cuenta en «Sin buscar todavía» (le falta un paso, como
  a uno a medias). Nada se pide al abrir la vista (la regla de v=261): se pide con «Seguir». Los demás
  registros no se tocan.
- `proximoPaso()` devuelve además `porRespaldo` (para contarlos al medir). «Limpiar caché» sigue
  conservando `mapa_artista_v1_` y `mapa_area_v1_`. El ritmo, la espera tras un 503, la pausa de 8 y el
  candado no se tocaron.

**La estimación, como un RANGO** (`estimarLoQueFalta` → `minutosBajo`/`minutosAlto`;
`textoLoQueFalta`, en `util/mapa-escaneo.js` para poder probar el texto en Node):

- **Cota baja** = `media·p`, hacia abajo (como mínimo 1): lo que tarda si no vienen más 503 de los que
  ya venían.
- **Cota alta** = lo de v=306 (`media·p + Z·σ·√(p + p²/n)`, Z = 2) **más una racha entera**, hacia
  arriba. 🔴 **La racha sale de las constantes, no está escrita**: `RACHA_MS` = la suma de las
  esperas que hace `escanear()` entre el primer fallo y el que dispara la pausa, con `ESPERAS_MS` y
  `FALLOS_PARA_PAUSAR` (hoy 10 + 20 + 40 + 80 + 80 + 80 + 80 s = 390 s: el octavo fallo seguido ya no
  espera, pausa). Si cambia una de las dos, cambia la racha (una puerta lo vio fallar con la racha a
  mano). El 1,2 s del ritmo no se suma: la espera de antes de un reintento es la mayor de las dos.
- **Por qué**: ninguna cota hecha solo con la dispersión de lo ya medido ve venir una racha que
  todavía no pasó, y en los últimos artistas una sola racha es más larga que todo lo que falta (la
  tanda 54 lo encontró reproduciendo su propia corrida: subir la z no lo cubría sin inflar el escaneo
  entero). `Z_ESTIMACION` (2) y `MIN_ARTISTAS_ESTIMAR` (5) no cambiaron, ni el acumulado ni su clave.
- **La condición** (la puso el encargo, es la que promete un rango): desde la primera lectura que
  enseña un rango, **la cota alta no queda NUNCA por debajo del tiempo real que faltaba**. La baja sí
  puede. Comprobada reproduciendo las corridas de las tandas 53 y 54
  (`fonoteca-migracion/mapa/reproducir-estimacion-rango-2026-10-15.mjs`: la función de v=306 falla con
  la de la 54, la de v=307 no) y con líneas de tiempo inventadas en `tests/mapa-escaneo.test.mjs` (la
  forma del problema: un tramo tranquilo largo y una racha al final). ⚠️ No prueba dos rachas seguidas
  en un tramo final corto, ni la pestaña oculta. Y en el tramo final el rango es ancho a propósito
  (la cota alta lleva siempre la racha entera).
- **Texto**: «Quedan ~N peticiones: entre 3 horas y 27 min y 5 horas y 13 min, según cuántos 503 dé
  MusicBrainz.» (si las dos cotas dan el mismo texto, una sola). «Lo que falta se estimará cuando…»
  no cambió.

El banco suma cuatro puertas: un artista inventado renombrado sale con país por el respaldo (pedido
una vez); uno `unico` no lo pide nunca; un registro viejo sembrado pide solo el respaldo al «Seguir»;
y la estimación es un rango también tras recargar.

## 🚪 `#puertas`: puertas de entrada (v=308)

Para cada artista que escuchaste **10 minutos o más**: por qué tema entraste (la primera
reproducción válida), si ese tema **sigue siendo tu top** de ese artista y **cuántos días**
tardaste en escuchar un segundo tema suyo. Ruta `#puertas`, menú General, detrás de «Mapa»,
icono propio (`ICONS.puertas`, una puerta entreabierta: no había ninguno libre que sirviera);
la tarjeta de inicio y la cabecera dicen «Puertas de entrada». Pedido por Ian el 10/10.

| archivo | qué | probado en |
|---|---|---|
| `util/puertas-entrada.js` | PURO: el universo (`universo()` de `mapa-paises.js`, IMPORTADO), «sigue siendo el top», los días y sus textos; desde v=328, el resumen (`resumenPuertas`), el filtro (`filtrarPuertas`, `cuentasPuertas`, `FILTROS`) y la barrita (`anchoBarra`, `maxDias`, `textoMediana`) | `tests/puertas-entrada.test.mjs` |
| `features/puertas.js` | la vista: `loadArtistTracks()`, el candado, el resumen, los chips y la tabla de a 100 | `tests/banco/puertas.html` (en `prepush`) |
| `scripts/gen-stats.py` + `history-processor.js` | los dos campos nuevos de `totals` | `tests/puertas-pipeline.test.mjs` |

**El dato: el pipeline emite CRUDO y el navegador decide** (la regla de v=146).
`history-artist-tracks` sube a **v3** y `totals[a]` suma dos campos al final (append: los seis de
antes no se mueven ni cambian de valor):

- **`[6]` = `[nombre, trackId]` del TEMA DE ENTRADA**: la primera reproducción **válida** del artista
  —con `spotify_track_uri`, sin basura (`is_junk_track`/`isJunkTrack`), `ms_played ≥ 30 s`—, o sea la
  MISMA que fija `[5]`. Se llena en el MISMO sitio del bucle que `artist_first_day`/`artistFirstDay`:
  no puede haber dos definiciones de «primera». `trackId` sin el prefijo `spotify:track:`.
- **`[7]` = `"YYYY-MM-DD"` (UTC) o `null`**: el día de la primera reproducción válida de un tema
  **DISTINTO**. «Distinto» es **otro `song_key`/`songKey`**, no otro id: un remaster o la versión del
  álbum del mismo single NO es un segundo tema. `null` si nunca sonó otro. `[7] ≥ [5]` siempre.
- 🔴 **El desempate**: si dos reproducciones válidas del mismo artista tienen el **mismo `ts`**, gana
  la de **menor `trackId`** (orden de cadena), escrito igual en los dos lenguajes. El orden de
  llegada depende del orden de los archivos y del sort, y un dato nuevo no se deja al azar. No cambia
  `[5]` (el día es el mismo con cualquier desempate).
- El día de la entrada **no** se emite otra vez: es `[5]`.
- 🔴 **Versión, los tres sitios a la vez** (`gen-stats.py`, `history-processor.js`, `history-keys.js`:
  2 → 3) y **`OWNER_PREV_KEYS.artistTracks` VACÍA** (ya lo estaba): el v2 PASA el `sanityCheck`
  (`d => !!d.artists`) y migrarlo pintaría la vista sin los campos, sin fallar y sin avisar (v=157, v=208).
- **Un BYOH importado antes de v=308** tiene su `artistTracks` en `local_<uid>_history_artistTracks`
  **sin** `[6]` ni `[7]` (esa clave no lleva versión). `armarPuertas()` lo detecta (`totals` de menos
  de ocho campos) y la vista dice «Para ver esto, vuelve a importar tu historial», con el botón de
  importar; ni una lista vacía ni una con huecos.
- **Lo que se publica**: `history-artist-tracks.json` está en Pages y en un repo público. Ya publicaba,
  por artista, plays, minutos, la curva por año, el día de la primera escucha y los seis temas top; lo
  nuevo (cuál fue el primero y el día del segundo) es la misma clase de dato, por artista, sin la
  granularidad del diario por día de `#calendario`.

**La vista decide:**

- 🔴 El universo es **`universo()` importado**, no copiado (una regla escrita dos veces diverge, v=219).
  Las filas van en su orden; sin ranking ni ordenar por otra columna (desde v=328, con un filtro: abajo).
- 🔴 **«¿Sigue siendo tu top?»** compara por **`songKey`** el tema de entrada con el **primero de
  `artists[a]`** (el top de la ficha de artista: más plays, a igualdad más minutos). «Sí», o «No:
  ahora «X»» con el top de hoy.
- 🔴 **Los días** entre `[5]` y `[7]` se cuentan sobre las cadenas `YYYY-MM-DD` con `Date.UTC` de las
  partes, nunca con la hora local; el día se enseña con **`fmtDia()`**. 0 → «el mismo día», `null` →
  «solo un tema», si no «N días» (`toLocaleString('es-ES')`).
- **«Sí» / «Ahora: «X»» (v=328; hasta v=327, «Sí» / «No: ahora «X»»)**: «Sí» es una pastilla (`.puertas-pastilla`)
  con el ANILLO del acento y el texto en `--color-text` sobre `--color-surface`: el molde de `.covers-chip.is-on`
  (v=290), **nunca blanco sobre el acento**. Cuando cambió, texto en el secundario: «Ahora: «X»».
- **Paginada**: 100 filas y «Mostrar 100 más» (miles de filas de golpe es mucho DOM). A 600 px o menos
  la tabla se apila: cada fila son DOS renglones (artista y tema de entrada; «¿sigue?» y «hasta el
  segundo tema»), con la etiqueta de cada celda encima (`data-et`).
- 🔴 **El candado es el de `#records`** («pide los DATOS primero»), no el de `#covers`: con BYOH la
  vista se abre con los datos del amigo; sin datos, el cartel de bloqueo de siempre.
- **Abrir cuesta 1 `/me`** (el de `loadOne()`) y 0 de lo demás. Vigencia de ruta después de cada
  `await` (v=195). **Filtrar y «Mostrar 100 más» cuestan 0** (medido en el banco, v=328).

**El embellecimiento (v=328, tanda 74)**. Pedido de Ian del 22/10: «se podría embellecer un poco no? osea está bien que son
datos nada más». **Los datos no cambiaron: cambió cómo se ven.** Todo sale de las MISMAS filas de `armarPuertas()`.

- **El resumen de arriba**, tres tarjetas (`.puertas-resumen`) calculadas por `resumenPuertas(filas)` (pura):
  «**N** de **M** artistas siguen teniendo su tema de entrada como el más escuchado» (`sigue === true`), «**N** te ganaron el
  mismo día: el segundo tema sonó el mismo día que el primero» (`dias === 0`) y «**N días**: la mediana hasta el segundo
  tema (de los K que lo tienen)». 🔴 **La mediana es SOLO de los que tienen segundo tema** (`dias !== null`): un «solo un
  tema» no es un cero. Con N par, el promedio de los dos del medio (`textoMediana`: «2,5 días», con la coma de es-ES); sin
  ninguno, «—». Los números a 30 px en `--color-text`; las etiquetas en `--color-text-secondary` (nunca el muted). **Con el
  JSON del repo** (REAL, contado el 22/10 sin nombres): **2.302** artistas, **1.043** siguen, **603** el mismo día, **343**
  solo un tema, **mediana 40 días** (de 1.959), máximo 2.817.
- **Cada fila con jerarquía**: el artista a 15 px y 700 (protagonista); el tema con la fecha DEBAJO, más chica; la pastilla
  o «Ahora: «X»»; y en «Hasta el segundo tema», el texto de siempre y debajo una **barrita** (`.puertas-barra`, 4 px, hasta
  160 px de ancho) del acento sobre `--color-elevated`, con `aria-hidden="true"` (el número ya está escrito), de ancho
  **`log1p(días) / log1p(máximo)`** (`anchoBarra`): con una escala lineal el que tardó años aplasta a todos contra el cero.
  No sale en «solo un tema»; «el mismo día» es la pista vacía. 🔴 **La escala es la de TODAS las filas** (`maxDias(filas)`),
  no la del filtro: una barrita no cambia de largo por apretar un chip.
- **El filtro de tres chips** (`.puertas-chip`): Todos / Siguen siendo su top / Cambiaron, cada uno con su cuenta
  (`cuentasPuertas`); el elegido con el anillo del acento y `aria-pressed`. Una fila con `sigue: null` solo sale en «Todos».
  🔴 **Filtrar va ANTES de paginar**: elegir un chip vuelve a la primera página DE LO FILTRADO, «Mostrar 100 más» sigue
  sobre lo filtrado y el pie dice «N de M artistas» con M = los del filtro; el orden sigue siendo el de `universo()`. Un
  filtro sin filas: «Ningún artista en este filtro.».
- A 600 px o menos, la fila apilada de siempre (dos renglones), con la pastilla y la barrita; el resumen en una columna,
  con el número a la izquierda de su etiqueta.
- Clases propias `.puertas-…` (`tests/css-clases-duplicadas.test.mjs`, verde); sin animaciones nuevas; las fechas siguen
  con `fmtDia`.

Medido en el banco (SEMBRADO, datos INVENTADOS), contraste peor de la pastilla, las etiquetas del resumen, los chips, sus
cuentas, el día y «Ahora: …» (WCAG 2.x, el fondo compuesto capa por capa): **violeta 6,36 · ámbar 6,20 · aguamarina 6,27 ·
papel 6,51**. A 1366×591 y 390×844, nada desborda.
- 🔴 **SIN marca de «puede ser de antes de tu historial».** Las entradas de la primera semana del export
  podrían ser artistas que ya escuchabas de antes, pero **Ian dijo el 15/10/2026 que antes de 2018 no usaba
  esta cuenta**, así que se toman como reales. ⚠️ **Es una premisa de Ian, no un dato medido**: el
  export no dice cuándo se creó la cuenta. Si algún dato la contradice, la vista tiene que cambiar
  (anotado en `PENDIENTES.md`, igual que un amigo, que sí podría tener la cuenta más vieja que su export).

Un ejemplo, INVENTADO: «Banda Inventada» sonó por primera vez con «Tema Uno» un 30 de enero (`[5]`),
el single y su remaster son el mismo tema, y el 2 de febrero sonó «Tema Dos» (`[7]`). Fila: «Tema
Uno · 30 ene» · si su top de hoy es «Tema Uno - Remastered», «Sí»; si es «Tema Dos», «Ahora: «Tema
Dos»» (hasta v=327, «No: ahora «Tema Dos»») · «3 días».

**Lo que quedó AFUERA, y por qué:**
- 🔴 **El ranking de «los temas que te abrieron más artistas»** (colaboraciones): **el export trae UN
  artista por reproducción** (`master_metadata_album_artist_name`). Una colaboración no abre tres
  artistas en el dato: abre uno. No se puede hacer bien y no se hace a medias.
- 🔴 **«Artistas de un solo tema de entrada que después explotaron»**: no está definido qué es
  «explotar», y no se define a ojo.
- La ficha de artista no muestra el tema de entrada (otro encargo, si Ian lo quiere). El detalle por
  día de IndexedDB no se usa (depende de que Ian lo cargue a mano).

Guardas: `tests/puertas-pipeline.test.mjs` (los dos pipelines sobre las mismas reproducciones
inventadas, la sección UTC también con `TZ` de Buenos Aires, la versión en los tres sitios y la
conservación de los seis campos viejos); `tests/puertas-entrada.test.mjs` (la cuenta de la vista,
con `TZ` de Buenos Aires; desde v=328, el resumen con N par e impar, sin los de «solo un tema», sin
ningún segundo tema, el filtro con su cuenta y la barrita; rojo contra v=327); el banco
`tests/banco/puertas.html` + `puertas-caso.html` + `puertas-datos.mjs` (la app ENTERA en nueve
iframes; `puertas-caso.html?uid=owner&foto=1[&tema=papel]` es el instrumento de la captura sembrada, y
`window.__ponerTema(id)` aplica un preset). v=328 suma las puertas 8 (el resumen = la cuenta a mano:
7 de 10, 1, 2,5 días), 9 (cada chip a su cuenta, y con 260 artistas mezclados «Mostrar 100 más» sobre
lo filtrado: 100 → 173; filtrar = 0 peticiones), 10 (el contraste en los cuatro presets) y 11 (sin
desborde a 1366×591 y 390×844); contra v=327, rojas desde la 2 (el «No: ahora») y la 8. Capturas:
`fonoteca-migracion/driver-capturas-puertas-t74-2026-10-22.mjs`. `scripts/verificar-rehorneado.py` suma `--permitir-en ARCHIVO
REGEX` para el rehorneado de un JSON que TIENE que cambiar. Medición y paridad sobre el export real
en `fonoteca-migracion` (`medicion-puertas-*-2026-10-15.*`).

## 🔎 `#generos`: buscar los géneros de tu historial (v=313) y enseñarlos (v=314)

La primera mitad de la vista de géneros (tanda 61): el escaneo que llena el almacén de la tanda 60 con las etiquetas
de Last.fm de **todos los artistas del historial**, con su botón, como «Buscar países» del mapa. Ruta `#generos`, menú
General, detrás de «Puertas de entrada», icono propio (`ICONS.generos`, dos etiquetas superpuestas: la «tags» de Lucide;
la de `#genre` es una sola etiqueta), tarjeta de inicio y cabecera «Tus géneros». 🔴 **Enseña dos secciones y nada
más**: «Cuánto se sabe» y «La búsqueda». **Ningún género, ningún top, ningún porcentaje por género, ninguna lista de
etiquetas**: eso es la tanda 62, con la regla que salga de la medición (ver «Last.fm, medido (tanda 61)», abajo).
`#genre` (la vista vieja, sobre los me gusta) no se tocó. ⚠️ **Desde v=314 enseña tres secciones** («Cuánto se sabe»
con cinco filas, «Tus 10 géneros» y «La búsqueda», que no cambió): ver «Los géneros (v=314)», más abajo. Lo de esta
parte sigue valiendo para el escaneo, que no se tocó.

| archivo | qué | probado en |
|---|---|---|
| `util/generos-escaneo.js` | el bucle (`escanearGeneros`), con la red, el reloj, el guardado y el candado INYECTADOS; `yaBuscado`, `clasificar`, `urlEtiquetas`, `armarCobertura`, `conCandado` (el suyo), `claveRitmo`, `textoLoQueFalta` | `tests/generos-escaneo.test.mjs` (Last.fm, reloj y artistas de mentira, con el almacén de verdad) |
| `util/generos-artista.js` | suma `filtrarEtiquetasLastfm` (el `count >= 5`, sacado de `getArtistTopTags` sin cambiar una coma), `registro(nombre)` en el almacén y un cuarto argumento opcional de `guardar` (campos de más para el registro de esa fuente) | ídem y `tests/generos-artista.test.mjs` (sin tocar) |
| `api/lastfm.js` | `getArtistTopTags` importa el filtro; `setCachedTags(nombre, tags, fuente, extra)`; `registroEtiquetas(nombre)` | ídem |
| `features/generos.js` | la vista: enchufa `fetch`, IndexedDB, `navigator.locks` y `setTimeout`, y pinta | `tests/banco/generos-escaneo.html` (en `prepush`, el decimonoveno) |

- **El universo es `universo()` de `mapa-paises.js`, importado** (≥ 10 min, por minutos): los artistas del HISTORIAL,
  no los de los me gusta. Solo se leen `totals[a][1]` y los nombres: un historial importado antes de v=308 sirve igual.
- 🔴 **El candado es el de `#records`/`#mapa`/`#puertas`** («pide los datos primero»): con BYOH se abre con los datos
  del amigo; sin datos, el cartel de bloqueo de siempre, **sin botón de buscar**.
- 🔴 **Abrir la vista NO le pide nada a Last.fm** (la regla de v=261). Abrir cuesta el `/me` de `loadOne()`;
  `cargarEtiquetas(await getCurrentUserId())` va por el memo. El escaneo arranca **solo** con el botón («Buscar
  géneros», «Seguir», «Parar»).
- 🔴 **Si `cargarEtiquetas()` falla, la vista LO DICE y no ofrece buscar.** Con el almacén sin cargar `guardar()` no
  escribe, y enseñar «0 con etiquetas» sería un resultado de dominio tapando un error de la app (v=154). El error
  crudo va a `console.warn` y no se pinta ninguna fila. ⚠️ El `catch` ancho de `renderStartScreen` de `#genre` sigue
  como estaba (anotado en `PENDIENTES.md`); no se copió.
- 🔴 **«Ya buscado»** (`yaBuscado`, una sola función pura): `fuentes.lastfm` no es `null` (aunque sea `tags: []`), **o**
  `fuentes.migrado` trae **al menos una** etiqueta. Si no, se le pide a Last.fm. Un `migrado` con `[]` se vuelve a
  pedir: pudo ser el `[]` de MusicBrainz de un `limit=1` a ciegas (el blob viejo no decía de qué fuente era) y no se
  sabe. `musicbrainz` y `statsfm` solos no cuentan. Lo que ya trajo `#genre` desde Last.fm cuenta y no se vuelve a pedir.
- **La consulta es la de `getArtistTopTags`**: `artist.gettoptags` + `autocorrect=1`, la key de `getKey()`,
  `format=json`, **sin ninguna cabecera propia**. El filtro (`count >= 5`) es **una sola función**,
  `filtrarEtiquetasLastfm`, importada por los dos (v=219). Lo que devuelve `getArtistTopTags` no cambió (el test lo
  afirma de conservación).
- **Se guarda con `setCachedTags(nombre, tags, 'lastfm', { artista })`**: `artista` es el nombre que devolvió Last.fm
  (`toptags['@attr'].artist`), un campo opcional del registro de esa fuente. 🔴 **La decisión (`getCachedTags`,
  `decidirEtiquetas`) NO lo lee**: es para que la 62 decida si un autocorrect que cambió el nombre vale. Un registro sin
  ese campo (los de `#genre`) se lee igual.
- **Qué se guarda y qué no** (`clasificar`: si el cuerpo trae `error`, manda el código, sea cual sea el status):
  - un 200 con `toptags` → sus etiquetas filtradas (puede ser `[]`);
  - **«no encontrado» (error 6, que Last.fm manda con HTTP 200) → `tags: []`**: es una respuesta definitiva;
  - 🔴 **un 29 (cuota), un 5xx, un 429, un corte de red, los temporales 8/11/16 o un 200 sin `toptags` NO se guardan
    nunca**: se espera y se reintenta el MISMO artista con `esperaTrasFallo` del mapa (10, 20, 40, 80 y 80 fijos), y
    `FALLOS_PARA_PAUSAR` (8) seguidos sin una respuesta pausan solos («Last.fm no contesta ahora…»);
  - **un 10 o un 26 (la key) paran TODO**, sin guardar esa respuesta: «La clave de Last.fm no funciona (código N)…».
    ⚠️ **Sin link**: en la app no hay dónde cargar una key propia (los campos de `#genre` y `#similar` solo salen sin
    ninguna key, y con la del código siempre hay una); anotado en `PENDIENTES.md`;
  - cualquier otro código o 4xx es del artista: «no se pudo consultar» en la sesión, sin guardar, y se sigue.
  - Si la IndexedDB no escribe (`guardar` da `false`), el escaneo para (`no-guarda`): seguir sería gastar peticiones.
- **El ritmo**: una petición por vez y **1.000 ms como mínimo entre comienzos** (`INTERVALO_MS`). Las condiciones de
  la API no dan un número y la medición de la tanda 61 no vio ni un error a ese ritmo: nada obliga a ir más lento, y
  no se va más rápido (lo puso el encargo). **Retomable**: cada respuesta buena se guarda ANTES de la siguiente.
- **Una sola búsqueda a la vez**: `navigator.locks` con `fonoteca-generos-escaneo` (no el del mapa: son dos fuentes).
  `conCandado` del mapa tiene el nombre fijo adentro, así que este módulo tiene el suyo (las mismas seis líneas). Con
  el candado en la mano se relee lo guardado: el `Map` del almacén de esta pestaña no ve lo que escribió otra.
- **Al salir de la ruta el escaneo para**: el `teardown` aborta la señal (eso corta la petición en vuelo; sin él, una
  colgada queda viva con el candado tomado) y el bucle pregunta por la vigencia después de cada `await` (v=174).
  Ninguna escritura al DOM después de salir. Las esperas no van encadenadas: antes de cada `fetch`, como mucho una.
- **Importado de `mapa-escaneo.js` tal cual**: `esperaTrasFallo`, `FALLOS_PARA_PAUSAR`, `peticionesPorMinuto`,
  `ritmoVacio`/`ritmoDesde`/`sumarPeticion`/`sumarArtista`, `estimarLoQueFalta`, `MIN_ARTISTAS_ESTIMAR` y
  `duracionCorta`. **No** se importan, y por qué: `escanear()` (es de MusicBrainz), `conCandado` (el nombre fijo) y
  `textoLoQueFalta` (dice «503 dé MusicBrainz»; el de acá dice «fallos dé Last.fm» con la misma `duracionCorta`).
  Como las esperas y la pausa son las mismas, **la racha que suma la cota alta (`RACHA_MS`, 390 s) es la misma que
  hace este bucle**. Ningún archivo del mapa cambió y su banco sigue en verde.
- **La estimación**: la del mapa, como un rango, con lo ACUMULADO en **`generos_ritmo_v1_<uid>`** (uid en la clave y
  dentro del valor). **«Limpiar caché» lo BORRA** (no está en `CONSERVAR_PREFIJOS`: es una medición); las etiquetas
  (`generos_artista_v1_`) se conservan, como desde v=312. Con menos de 5 artistas medidos, «se estimará cuando…».
- **«Cuánto se sabe»** (`armarCobertura`; ⚠️ **cinco filas desde v=314**, ver abajo): cuatro filas que **suman exactamente** los minutos de todo el historial (en
  décimas, enteras): con etiquetas (alguna fuente con al menos una: también lo de `#genre` y lo migrado) · Last.fm
  dice que no tiene (buscado y vacío) · sin buscar todavía · menos de 10 min; cada una con artistas y minutos
  (`toLocaleString('es-ES')`). Un artista con etiquetas SOLO de MusicBrainz o stats.fm va en «con etiquetas» y el
  escaneo igual lo pide (no está «ya buscado» en Last.fm).
- Repintado a lo sumo una vez por frame (rAF con un `setTimeout` de respaldo), solo las secciones que cambiaron, los
  botones en la suya. Las piezas de texto y la tabla son las del mapa (`.mapa-h2`, `.mapa-filas`, `.mapa-num`…, que
  son presentación); el contenedor `.generos` es suyo. Secundario en `--color-text-secondary`; sin animaciones nuevas.
- 🔴 **Lo que NO hacía en v=313** (desde v=314 enseña los géneros y lee el `artista`: ver abajo): ningún género, ningún top, ningún porcentaje por género; no le pregunta nada a MusicBrainz ni
  a stats.fm; no completa con otra fuente lo que Last.fm no tiene; no usa el `artista` del autocorrect para nada.
- **El costo**: abrir = **1 `/me`** (+1 del arranque) y **0 a Last.fm**; «Buscar géneros»/«Seguir» = **1 petición por
  artista** del universo sin buscar (más los reintentos), a 1 s, **0 a Spotify** (ver la tabla de costos).
- ⚠️ **La pestaña oculta NO está verificada** (como en `#mapa`): la pantalla pide dejarla a la vista y enseña el ritmo.

Guardas: `tests/generos-escaneo.test.mjs` (55: «ya buscado», qué se guarda y qué no, los reintentos con
`esperaTrasFallo`, la pausa, la key, el ritmo, retomable, las cuatro filas a mano, el filtro único y la conservación
de `getArtistTopTags`; rojo contra v=312) y el banco `tests/banco/generos-escaneo.html` + `-caso.html` + `-datos.mjs`
(historial, etiquetas y Last.fm INVENTADOS; el Last.fm vive en la madre): A abrir = 0 a Last.fm en 5 s de reloj y 1
`/me`, también al volver y tras recargar; B pide exactamente los que faltan (con el migrado vacío), una respuesta
definitiva por artista, y las filas a mano; C con 29 y 503 en un patrón fijo termina sin guardar ningún fallo; D
recargar a mitad no repite nada; E salir aborta la petición en vuelo y deja 0 en 30 s; F dos iframes; G «Limpiar caché»;
H la IndexedDB rota → lo dice y sin botón; I a 390 px no desborda. Las cuatro puertas vistas fallar en una copia
(abrir arranca, «ya buscado» ignorado, la cuota guardada como `[]`, el teardown sin abortar). `generos-escaneo-caso.html?foto=1`
es el instrumento de las capturas sembradas (conductor en `fonoteca-migracion/driver-capturas-generos-2026-10-17.mjs`).

### Last.fm, medido (tanda 61)

Medido el 17/10/2026 desde Node, con la consulta de la app, sobre una muestra de 51 artistas del historial (la regla y
el detalle, con los nombres, en `fonoteca-migracion/generos/`; acá no va ninguno). REAL.

- **Lo que dicen las condiciones** (`https://www.last.fm/api/tos`, cláusula 4.4, textual): «Rate Limit: Last.fm sets
  and enforces limits on use of the API to prevent abuse and ensure reliability of service (e.g. limiting the number of
  API requests that you may make or the number of users you may serve), in our sole discretion.» **No dan un número**
  (ni por segundo, ni por IP, ni promediado). La 4.3.4 pide «implement suitable caching in accordance with the HTTP
  headers» y pone un tope de 100 MB de datos guardados («Reasonable Usage Cap»).
- **Los códigos** (`https://www.last.fm/api/errorcodes` y `https://www.last.fm/api/show/artist.getTopTags`): 6
  «Invalid parameters», 8 «Operation failed … Please try again», 10 «Invalid API key», 11 «Service Offline … Try again
  later», 16 «temporary error … Please try again», 26 «Suspended API key», 29 «Rate limit exceeded - Your IP has made
  too many requests in a short period». **«No encontrado» llega como HTTP 200 con `{"error": 6, "message": "The artist
  you supplied could not be found"}`** (medido con un nombre inventado).
- **El ritmo y la red**: 51 de 51 en 200 a una por segundo (60,75 por minuto), 0 errores, 0 reintentos; latencia
  198 / 233 / 281 / 474 ms (mín. / mediana / p90 / máx.). **`access-control-allow-origin: *` en todas**: el navegador
  puede pedir.
- **La forma de las etiquetas**: **como mucho 10 por artista**, con la primera en `count` 100; el `count >= 5`
  dejó afuera 176 de las 427 que vinieron (se quedan 251: 4,9 por artista). 50 de 51 con al menos una ≥ 5 (el que no, sin ninguna: 200 con `tag: []`).
  Al leerlas de a una (una LECTURA de la sesión, no un dato medido): en 12 de los 50 la primera **no es un género**
  (un país o una ciudad, «dj», un instrumento, basura como un número de fax o un lote de un programa); aparecen
  nacionalidades en minúscula y mayúscula y como país («canadian»/«canada», «spain»/«spanish»), décadas («80s»),
  «female vocalists», etiquetas personales («5 stars», «my ladies»), el nombre de OTRO artista o de un grupo, y
  sinónimos que la mezcla no junta («hip-hop»/«hip hop», «drum and bass»/«dnb»/«drum n bass»). «seen live» no salió.
- **El autocorrect**: en 9 de 51 el nombre devuelto difiere del pedido; 8 son solo mayúsculas y 1 es **otro nombre**
  (y sus etiquetas, las de otro artista). Por eso se guarda `artista`, y la decisión todavía no lo lee.
- **La proyección (no es una medición del escaneo entero)**: a 1 s por artista, el universo entero (2.302 artistas
  con ≥ 10 min el 17/10) son unos 38 min sin ningún fallo, ~45 min con una racha entera; menos los que ya estén
  guardados en el navegador de quien busque.

### Los géneros (v=314)

La segunda mitad (tanda 62): **qué se enseña** con lo que el escaneo de la 61 ya guarda. El escaneo no cambió
(`escanearGeneros`, `yaBuscado`, `clasificar`, `urlEtiquetas`, el ritmo, las esperas, la pausa, el candado, el teardown y
la estimación, byte a byte: `tests/generos-regla.test.mjs` compara el `sha256` del texto de cada función con el de v=313).
Tampoco `decidirEtiquetas`, `mezclarEtiquetas`, `leer`, `filtrarEtiquetasLastfm` ni el almacén.

| archivo | qué | probado en |
|---|---|---|
| `util/generos-regla.js` | PURO, sin red: `NO_ES_GENERO`, `PATRONES_NO_GENERO`, `SINONIMOS`, `esGenero`, `canonico`, `generosDeArtista` (los géneros de un artista y por qué no tiene) y `armarGeneros` (por género: minutos, artistas, %) | `tests/generos-regla.test.mjs` |
| `util/generos-escaneo.js` | `armarCobertura` cambia EN EL LUGAR: cinco filas, decidiendo con `generosDeArtista` (`pendientes` sale igual que en v=313, de `yaBuscado`) | ídem y `tests/generos-escaneo.test.mjs` (los dos asserts de las filas, de cuatro a cinco) |
| `features/generos.js` | «Tus 10 géneros», «Ver todos (N)» y los artistas de cada género de a 100 | `tests/banco/generos.html` (en `prepush`, el vigésimo) |

Las decisiones, y por qué:

- 🔴 **Qué es un género sale de lo que midió Last.fm, no de la primera etiqueta.** En la 61, en 12 de 50 artistas la
  primera no era un género. Cuentan **todas** las etiquetas que ya pasan el `count >= 5` de siempre, **menos** las de
  `NO_ES_GENERO` (escrita a mano, en minúsculas) y las que cazan los `PATRONES_NO_GENERO`, pasadas por `SINONIMOS` a
  una forma canónica y **sin repetir** (un artista con «hip-hop» y «hip hop» cuenta una vez, en «hip hop»). **Ningún otro
  corte de `count`** («solo las de 50 o más» sería un número inventado).
- 🔴 **Las listas las escribió la sesión LEYENDO las etiquetas de a una**, nunca un modelo de lenguaje, nada bajado ni
  generado. Cada entrada dice de dónde sale: `[61: n · 62A: n · 62B: n]` (en cuántos artistas de cada muestra) o
  `[como X]` (no se vio y se agregó por ser de la misma clase que X: las **sospechosas**, 27).
- 🔴 **Qué hay en la lista y qué no** (el repo es público): solo lo **genérico**: países, gentilicios, ciudades y
  regiones, instrumentos y cómo suena («piano», «acoustic», «instrumental»), quién canta («female vocalists»), etiquetas
  personales, oficios y formatos («seen live», «dj», «producer», «podcast»…). Las décadas, las notas («5 stars»), las
  listas personales («my …»), la basura con `_`, con cuatro dígitos seguidos o de cinco palabras o más van como
  **patrones**, cada uno con su fuente y sin el texto que lo motivó. **Los nombres propios (otro artista, un grupo, un
  colectivo, un programa) NO se escriben y se quedan contando como género**: es un defecto conocido. ⚠️ El encargo decía
  que son géneros de uno o dos artistas que no llegan al top: **en la mitad B de la medición uno llegó al puesto 10 del
  top de la muestra** (de un solo artista con muchos minutos). En el historial entero no está medido. Y ninguna regla
  del tipo «si se llama como un artista de tu historial no es un género»: hay artistas que se llaman como un género.
- **Los sinónimos son variantes de ESCRITURA del mismo nombre** (`hip-hop`/`hip hop` → `hip hop`, como lo escribe la
  RAE; `dnb`/`drum n bass` → `drum and bass`; `synth pop` → `synthpop`; `rhythm and blues`/`r&b` → `rnb`; y seis
  más). Nada de agrupar subgéneros en un padre: `rap` y `hip hop`, `trap` y `hip hop`, `house` y `dance` siguen aparte.
- 🔴 **Los minutos NO se reparten**: cada artista suma sus minutos ENTEROS a CADA uno de sus géneros (repartir por el
  `count` sería inventarse pesos), y el % de un género es sobre **todo el historial** (también los de menos de 10 min),
  como el mapa. **Los porcentajes suman más de 100**, y la pantalla lo dice en una línea. Los «sin buscar todavía» no
  están en ningún género y no se reparten; con la búsqueda a medias, otra línea lo dice.
- 🔴 **El autocorrect que devuelve OTRO artista no cuenta.** Si `fuentes.lastfm.artista` existe y, con
  **`normalizarNombre` importado de `util/mb-pais.js`** (una sola; `tests/mb-pais.test.mjs` suma `generos-regla.js` a
  los que la importan), no es el nombre pedido, lo de Last.fm de ese artista no se usa (se decide sobre una copia con
  `lastfm: null`) y va a «Last.fm dice que no tiene». Lo de otras fuentes sigue valiendo. Sin `artista` (lo de `#genre`,
  lo migrado), como siempre. En la medición de la 62, 3 de 196 devolvieron otro artista (16 de 19 cambios eran solo mayúsculas).
  🟩 **Desde v=316 (tanda 65) «el mismo» lo decide UNA regla, `mismoArtistaAutocorregido(pedido, devuelto)`
  (`util/autocorrect-lastfm.js`), que comparte con el horneado del mapa de artistas.** Sin `devuelto` o igual según
  `normalizarNombre`: el mismo. Si no, el mismo **solo si** las dos **claves de escritura** son iguales y no vacías:
  `normalizarNombre` → cada `$` a `s` → cada `&` a ` and ` → fuera todo lo que no sea letra, número o espacio
  (`/[^\p{L}\p{N} ]/gu`) → fuera un `the ` del principio → espacios colapsados. **Nada más**: ni tablas de nombres, ni
  distancia de edición, ni `score`, ni el `mbid`. Es una regla de escritura del mismo nombre, como `SINONIMOS`: un
  autocorrect que cambia el NOMBRE («Los X» → «X», un dúo por su nombre corto, una sigla por otra) **sigue descartado**,
  aunque sea el mismo artista (el precio de no aceptar a ciegas; los que se pierden, con sus minutos, en `PENDIENTES.md`).
  Sobre los 42 autocorrects a otro nombre del escaneo de la 64: **17 aceptados y 25 descartados**; entre los aceptados,
  el 4.º artista más escuchado, que con la regla vieja iba a «no tiene» y ahora tiene sus 6 géneros (REAL, sin red, sobre
  el registro guardado). ⚠️ La regla no sabe si dos artistas que se escriben igual son el mismo: los dudosos de la
  lectura están en `PENDIENTES.md`. ⚠️ Y no arregla el «+»: Last.fm devuelve «A + B» como «A   B» (tres espacios) y con
  0 similares y 0 etiquetas; aceptarlo no le da nada propio. `generos-regla.js` ya no importa `normalizarNombre` (la usa
  a través de la regla; `tests/mb-pais.test.mjs` cuenta `autocorrect-lastfm.js` en su lugar). La decisión se recalcula
  al pintar: no hace falta volver a pedir nada (el registro guardado ya trae el `artista`).
- ⚠️ **De qué fuentes salen las etiquetas**: de `decidirEtiquetas` de siempre (todas las fuentes del registro, mezcladas):
  lo mismo que lee `#genre`. **Eso incluye lo que `#genre` trajo de MusicBrainz con su `limit=1` a ciegas y lo migrado de
  fuente desconocida**: defecto conocido (en `PENDIENTES.md`), no se arregló.
- ⚠️ **Un import circular a propósito**: `generos-regla.js` importa `yaBuscado` de `generos-escaneo.js` (para «no tiene»
  contra «sin buscar»: una sola función decide «ya buscado») y `generos-escaneo.js` importa `generosDeArtista` de
  `generos-regla.js` (para «Cuánto se sabe»). Es seguro porque ninguno usa lo del otro al cargarse.

- 🟩 **Una etiqueta igual al nombre del PROPIO artista no es un género (v=320, tanda 67)**: `esNombreDelArtista(etiqueta,
  nombre)` (`claveEscritura` de `util/autocorrect-lastfm.js` IMPORTADA: igual y no vacía; «contiene» no alcanza); en
  `generosDeArtista` cuenta como una de `NO_ES_GENERO` (con el nombre del historial o, si no viene, `reg.nombre`). **Solo el
  propio**: contra otros artistas del historial no se compara (un género que también es nombre de banda). Medido (REAL, los
  nombres en `fonoteca-migracion/generos/`): sobre la muestra de **diseño** (61 + 62, 247 artistas, la que se leyó para
  proponerla) 9 aciertos y 0 falsos; sobre una muestra **nueva** de 200 (índices `8 + 11·j`, sin los de la 61 y la 62, huella
  `8cf968d8…`) **9 aciertos, 0 falsos positivos**, y ningún artista pasa a «sin género» (los 9 tienen otros). Con 0 falsos en
  200 la tasa puede ser hasta 3/200 = 1,5 % (la regla del tres): 0 no es nunca. **`#genre` no la usa**: `generosDeArtista` y
  `armarGeneros` los importan solo `util/generos-escaneo.js` y `features/generos.js`. Solo se nota en artistas con etiquetas
  guardadas.

**Medido, en dos mitades** (REAL; la medición, con los nombres, en `fonoteca-migracion/generos/`; acá no va ninguno). Una
segunda muestra de Last.fm de 196 artistas del universo (índices `5 + 11·j` sin los de la 61), partida en A (98) y B
(98). Las listas se escribieron con la 61 + A (**versión 1**) y se midieron sobre B, que no se usó para escribirlas:
**a la versión 1 se le escapaban en B 34 etiquetas que la sesión lee como no-género, en 29 artistas y 3.729,6 min de los
10.289,4 de B** (22 genéricas —ciudades, países, gentilicios, «composer», «podcast», adjetivos— y 12 nombres propios o
basura que no se pueden escribir), y un sinónimo que el mapeo no juntaba (`neo soul`/`neo-soul`, 1 artista). **La
versión 2 (la del código) suma las 22 genéricas y el sinónimo; sobre ella no hay medición fuera de muestra.** El top 10
de B con la v2 sigue teniendo un nombre propio en el puesto 10.

**Las cinco filas de «Cuánto se sabe»** (suman exactamente el total, en décimas): con géneros · con etiquetas, pero
ninguna de género (para que esos minutos no se mezclen con «no tiene») · Last.fm dice que no tiene (incluye el
autocorrect a otro) · sin buscar todavía · menos de 10 min.

**La vista**: debajo de «Cuánto se sabe», «Tus 10 géneros» (nombre, minutos, % con un decimal `es-ES` y artistas), la
línea de que los % suman más de 100 (en `--color-text-secondary`), y «Ver todos (N)» si hay más de 10 (un `<details>`;
la lista se pinta solo abierta). Cada género es un `<details>` de verdad (foco y teclado): al abrirlo, sus artistas
por minutos, de a 100 con «Mostrar 100 más» (como `#puertas`). **Mientras la búsqueda avanza, cada género es el MISMO
`<li>`**: el repintado (el de la 61, una vez por frame) solo le cambia el resumen, sus artistas si está abierto y, si
hace falta, el sitio; lo abierto sigue abierto y con su foco. Sin ningún género, una línea («Tus géneros saldrán aquí a
medida que avance la búsqueda.»; con la búsqueda terminada y ninguno, «Ninguno de los artistas buscados tiene una
etiqueta de género.») y nada más. Las piezas son las de la lista de países (`.mapa-lista`, `.mapa-pais`…); lo suyo es
«Ver todos» y el pie (`.generos-todos`, `.generos-pie`). Sin colores por género, sin gráfico, sin animaciones. La
tarjeta de inicio: «Los géneros que más escuchas, según las etiquetas de Last.fm.» (61 caracteres).

**El costo**: abrir, igual que en v=313 (1 `/me` + el del arranque, 0 a Last.fm); **desplegar un género, «Ver todos» y
«Mostrar 100 más» = 0 peticiones** a cualquier host (medido en el banco).

Guardas: `tests/generos-regla.test.mjs` (82: `esGenero`, `canonico`, el autocorrect, que los minutos no se reparten y el %
es de todo el historial, las cinco filas a mano, `pendientes` de conservación, la lectura estática de lo que no se toca,
`normalizarNombre` una sola y la fuente de cada entrada; rojo contra v=313) y el banco `tests/banco/generos.html` +
`-caso.html` + `-datos.mjs` (historial, etiquetas y Last.fm INVENTADOS): F sin géneros, una línea; A abrir = 0 a Last.fm
y 1 `/me`, también al volver y tras recargar, y desplegar los 13 géneros y «Ver todos» = 0 peticiones; B el top 10 y la
lista entera a mano; C las cinco filas; G a 1366 y 390 nada desborda; D buscando, el género abierto es el mismo elemento
tras tres respuestas; E «Mostrar 100 más» con 130. Las seis puertas vistas fallar en una copia (la primera etiqueta,
repartir minutos, sin la lista, sin el autocorrect, «sin género» sumado a «no tiene», desplegar pide a la red).
`generos-caso.html?foto=1` es el instrumento de las capturas sembradas (conductor en
`fonoteca-migracion/driver-capturas-generos-t62-2026-10-17.mjs`).

## 🕸️ `#mapa-artistas`: el mapa de artistas (v=315)

Los ~2.300 artistas de tu historial (`universo()`: ≥ 10 min) acomodados en un plano por parecido, según los «similares»
de Last.fm, con el tamaño de cada uno según sus minutos: continentes, islas y puentes. Ruta `#mapa-artistas`, menú
General, detrás de «Tus géneros», icono propio (`ICONS.mapaartistas`, tres nodos unidos: la «share-2» de Lucide),
tarjeta de inicio y cabecera «Mapa de artistas» («Tus artistas acomodados por parecido, según Last.fm.», 52 caracteres).
Pedido por Ian; lo midió la tanda 63 y lo hizo la 64.

| archivo | qué | probado en |
|---|---|---|
| `scripts/hornear-similares.mjs` | el escaneo (`escanear`, con red, retomable, con tope) y el horneado (`hornear`, sin red: las aristas y el layout de `d3-force` en Node) | la tanda 64, contra Last.fm de verdad (ver abajo) |
| `src/data/history-artist-similares.json` | HORNEADO: `{ version, fuente, fecha, limit, nombres, pos: [x0, y0, …], aristas: [i, j, match, mutua, …] }`, compacto | `tests/mapa-artistas.test.mjs` (sección 9: la forma, y que no lleva minutos) |
| `util/mapa-artistas.js` | PURO: leer el JSON, los vecinos por `match`, el toque, el pan y el zoom con sus topes, qué nombres se dibujan, el buscador | `tests/mapa-artistas.test.mjs` |
| `features/mapa-artistas.js` | la vista: el `<canvas>`, los eventos (puntero, rueda, pellizco, botones) y el panel | `tests/banco/mapa-artistas.html` (en `prepush`, el vigésimo primero) |
| `history-keys.js` / `features/history-data.js` | `SIMILARES_VERSION = 2` (v=316; era 1), `OWNER_KEYS.similares`, `loadArtistSimilares()` con `OWNER_PREV_KEYS.similares` VACÍA | `tests/likes-cache-policy.test.mjs` (ocho claves del owner, con la v2) |
| `util/autocorrect-lastfm.js` (v=316) | PURO: `mismoArtistaAutocorregido` y `claveEscritura`, la regla del autocorrect que comparte con `#generos` | `tests/autocorrect-lastfm.test.mjs` |

**Lo que no se reabre** (lo midió la 63 y lo decidió el encargo de la 64):

- 🔴 **El layout se calcula UNA vez, en Node, y se hornea.** El navegador no corre ninguna simulación ni carga d3: lee
  posiciones. Acomodar 2.302 nodos con `d3-force` son 5,2-5,5 s a velocidad normal y 30-41 s con la CPU seis veces más
  lenta (SINTÉTICO, la 63): en la netbook no se puede pagar al abrir. `index.html` no ganó ningún `<script>`.
- 🔴 **Cada frame dibuja los puntos, los nombres de los grandes y, como mucho, las líneas del artista ELEGIDO.** Sin
  elegido, 0 líneas. Un frame con todas las líneas del grafo eran 270 ms (3,2 s a ×6, con frames sueltos de 41 s); sin
  líneas, 8 y 49 ms (SINTÉTICO, la 63). Nada de «las fuertes», «las de los más escuchados» ni una capa precalculada
  (rehacerla en cada zoom cuesta lo mismo). El banco lo vigila con `window.__mapaArtistasDibujo` (puerta B, vista fallar
  con una copia que dibuja todas: «se dibujaron 60141»).
- **Se repinta solo cuando algo cambió**, a lo sumo una vez por frame (rAF con un `setTimeout` de 100 ms de respaldo:
  rAF no corre en una pestaña oculta ni en headless con `--dump-dom`). Quieto, 0 frames (puerta D, vista fallar con una
  copia que repinta en bucle: 70 frames en 5 s).
- 🔴 **El JSON horneado no lleva minutos, plays ni radios**: los minutos salen de `history-artist-tracks.json`
  (`totals[nombre][1]`), que la vista ya carga, y el radio se calcula al leer (`2 + 18·√(minutos / máximo)`, el MISMO del
  layout: `forceCollide` acomodó con él). Lo nuevo que se publica son los pares de artistas de tu historial que Last.fm
  da por parecidos, su `match` y dónde cae cada uno; los nombres ya eran públicos en `history-artist-tracks.json`, y los
  pares se reproducen con esa lista y la API pública. Las respuestas crudas (con los similares que NO están en tu
  historial) viven solo en `fonoteca-migracion/mapa-artistas/`.
- **Las condiciones de Last.fm** (`https://www.last.fm/api/tos`, 3.1, 4.1, 4.2 y 4.3.4) dan licencia para publicar sus
  datos sin fines comerciales, con crédito y por debajo de 100 MB: la vista lleva «Parecidos según Last.fm» con su enlace.
  ⚠️ El botón «powered by AudioScrobbler» de la 2.7 no está (anotado en `PENDIENTES.md`, para toda la app).
- 🔴 **Los amigos (BYOH) no tienen mapa.** El horneado es del historial de Ian; `gen-stats.py` y el import no lo producen.
  Con historial y sin mapa, la vista dice «El mapa todavía no existe para tu historial.» y nada más. El escaneo en el
  navegador para ellos es otro encargo.

**El horneado** (`node scripts/hornear-similares.mjs escanear <avance.jsonl>` y después `… hornear <avance.jsonl>
<d3.min.js>`):

- La consulta: `artist.getsimilar`, **`limit=250`** (con el `limit=50` de la app la media dentro del historial baja de 52
  a 15 y los aislados suben de 9 a 16 de 200: medido por la 63), `autocorrect=1`, `format=json`, la key leída del fuente
  y nunca escrita, sin ninguna cabecera propia, de a una y 1.000 ms como mínimo entre comienzos.
- Definitivo = lo de `clasificar` de `generos-escaneo.js` con `similarartists` en lugar de `toptags`: un 200 con
  `similarartists` (aunque traiga 0) y el error 6. Un 29, un 5xx, un 429, un corte de red (o 30 s), los temporales
  8/11/16 o un 200 sin `similarartists` se reintentan con el mismo artista tras `esperaTrasFallo` del mapa; 8 seguidos
  paran. Un 10 o un 26 paran todo. Retomable (una línea por petición en el avance, escrita apenas termina) y con tope.
- **«Está en tu historial»** es la regla de la 63: igualdad de `normalizarNombre` entre el similar y un nombre del
  universo, sin el propio artista; si dos nombres del universo normalizan igual, gana el primero. **El autocorrect
  (v=316)**: si devolvió otro nombre, decide `mismoArtistaAutocorregido` (la regla de `#generos`, ver «🔎 `#generos`»).
  **Aceptado** (la misma escritura): aporta sus salientes **y su `devuelto` normalizado es una segunda clave suya** al
  buscar los similares de los demás (los otros lo nombran como lo escribe Last.fm), salvo que esa clave ya sea de otro
  artista del universo: gana el del universo. **Descartado** (otro nombre): sin salientes y sin segunda clave, como en
  v=315; recibe las de los demás si lo nombran con el nombre del historial. Sin dirección: el par existe si uno apunta al otro; su peso es el MAYOR `match` de las dos direcciones, en
  entero de 0 a 1.000, y `mutua` dice si están las dos. **Ningún corte de `match` ni de grado.**
- El layout: `d3@7.9.0` (bajado una vez, verificado por sha256, cargado con `vm`; NO está en `package.json`), las
  fuerzas de la 63 sin tocar (`forceLink`, `forceManyBody`, `forceCenter`, `forceCollide(r)`, todo lo demás por defecto,
  el `randomLcg(1)` de d3), 300 ticks a mano, posiciones a 1 decimal. Determinista: dos corridas, el mismo sha256.
  🔴 **Desde v=316 a la simulación entra SOLO el componente conexo más grande**; los demás («los sueltos») van en una
  franja debajo, sin simulación (`colocarSueltos`, ver «Los sueltos, los nombres y el radio (v=316)», abajo).
- Solo se hornea con al menos el 95 % del universo con respuesta definitiva. Tope de 3 MB (si lo pasa, cada artista
  conserva sus 40 aristas de mayor `match`).
- ⚠️ **Con un export nuevo** el universo cambia: hay que volver a escanear (el avance es retomable, pero los índices
  son los del universo de ESE momento: `hornear` para si el nombre de un índice no coincide) y subir
  `SIMILARES_VERSION` con `OWNER_PREV_KEYS.similares` vacía.
- `src/data/README.md` NO lo menciona: el encargo exigía que los diez archivos de `src/data/` quedaran byte a byte, y el
  README es uno de ellos (anotado en `PENDIENTES.md`).

**Lo que dio el escaneo** (tanda 64, REAL; el detalle, con los nombres, en `fonoteca-migracion/mapa-artistas/`; acá no va
ninguno): 2.302 de 2.302 con respuesta definitiva, **2.305 peticiones** (2.302 `getsimilar` + 3 `gettoptags`), todas 200, un
error 6, 0 reintentos, CORS `*` en todas; 39,2 min escaneando en dos sesiones, a 58,7 por minuto (el ritmo es el de nuestro
sleep). **77.420 pares** sin dirección (la 63 proyectaba 60.013-120.026), el 51,5 % mutuos; grado sin dirección mediana 65,
p90 128, máx. 236; grado SALIENTE medio 51,9 (la muestra de la 63: 52,14). **77 aislados** (grado 0), con el 2,4 % de los
minutos. 42 artistas con el autocorrect a otro nombre (no aportan salientes). Layout en Node ≈12 s, dos corridas con el mismo
sha256. El JSON pesa **1,17 MB** (sin recorte). ⚠️ Eso es la v1 (v=315). La v2 (v=316), rehorneada sin red con la regla
del autocorrect y los sueltos aparte: ver «Los sueltos, los nombres y el radio (v=316)», abajo.

**La vista**:

- Un `<canvas>` con todos los artistas como círculos, arrancando con todo el mapa a la vista (los sueltos incluidos,
  en su franja). **Nombres** (v=316): de más minutos a menos, como mucho 60 por frame, solo de círculos con el centro
  dentro del lienzo y sin pisarse (gana el de más minutos); **sin umbral de radio** (hasta v=315 pedían 12 px y a
  «todo el mapa» no salía ninguno). El radio en pantalla es `max(r · escala, 1 + 4·√(minutos / máximo))` px: ver abajo.
- Pan arrastrando (pointer events, también el dedo), zoom con la rueda (al puntero), con dos dedos y con «+», «−» y
  «Ver todo»; entre «todo el mapa» y 40 veces eso. `touch-action: none` en el lienzo: dentro, el dedo mueve el mapa; la
  página se scrollea tocando fuera (el lienzo mide `clamp(300px, 62vh, 720px)`).
- **Tocar** elige el círculo de borde más cercano si el punto cae dentro de su radio en pantalla (el mismo que se
  dibuja, con su piso) más 4 px; el fondo lo suelta. Con un elegido: sus líneas, sus parecidos en el acento y el resto atenuado.
- **El panel**, debajo: el nombre, sus minutos (`es-ES`), «N artistas parecidos en tu historial» y la lista por `match`
  de mayor a menor (a igualdad, por minutos), de a 50 con «Mostrar 50 más»; cada uno, un botón que lo elige y lo
  encuadra (v=318; hasta v=317, lo centraba).
  «Ver ficha» abre `openArtistCard({ name })` (lo que cueste la ficha es de la ficha).
- **El buscador**: igualdad de `normalizarNombre` o, si no, el primero cuyo nombre normalizado empiece igual; sin
  resultados, «No está en tu mapa.». `normalizarNombre` y no `normText` (que deja «¥$» vacío): `tests/mb-pais.test.mjs`
  suma `mapa-artistas.js` a los que la importan (cuatro).
- Una línea con cuántos artistas no tienen ningún parecido en tu historial, y «Parecidos según Last.fm» con su enlace.
- **Colores del tema**, ninguno escrito a mano, leídos con `getComputedStyle` en cada frame (y `themechange` pide uno):
  los puntos con `--color-accent` (el elegido y sus parecidos) y una mezcla del acento con `--color-surface` para el resto
  (60 % del acento sin elegido, 22 % con uno); las líneas con `--color-text-secondary`; los nombres con `--color-text` y
  un borde de `--color-bg`. Sin animaciones.
- Accesible por el buscador y el panel (HTML, foco y teclado); el `<canvas>` es `role="img"` con su `aria-label` («Mapa
  de tus artistas: N artistas, M parecidos»). Elegir desde el panel o el buscador lleva el foco al nombre.
- El `teardown` suelta los listeners, el `ResizeObserver`, el rAF y el respaldo pendientes; `pintar()` además pregunta
  por la vigencia de la ruta. Clases propias (`.artmapa-…` desde v=317; hasta v=316, `.mapa-artistas-…`, y dos chocaban
  con las de `#mapa`/`#generos` y les ganaban; lo vigila `tests/css-clases-duplicadas.test.mjs`), sin reusar las de otro módulo.

**El costo**: abrir = **1 `/me`** (+1 del arranque) y **0 a Last.fm y a cualquier CDN** (los dos JSON salen del propio
Pages); tocar, arrastrar, hacer zoom, buscar y «Mostrar 50 más» = **0**. Medido en el banco.

Guardas: `tests/mapa-artistas.test.mjs` (lo puro con un grafo inventado de cinco artistas, la lectura estática de que
la vista no carga d3 ni simula, y la forma del JSON horneado; rojo contra v=314: el módulo no existía) y el banco
`tests/banco/mapa-artistas.html` + `-caso.html` + `-datos.mjs` (un grafo INVENTADO de 2.302 artistas y 60.141 pares, la
densidad medida): A abrir = 1 `/me` y 0 de lo demás, también al volver; B sin elegido 0 líneas y con uno su grado; C
tocar elige, el panel en el orden esperado, el fondo suelta; D arrastrar, rueda, botones, buscar y «Mostrar 50 más» = 0
peticiones y quieto 5 s = 0 frames; E el amigo sin mapa, la línea y 0 puntos; F a 1366 y 390 nada desborda; G salir a
mitad, 0 escrituras y 0 frames, y salir con un frame pendiente, 0 frames después del teardown. B y D vistas fallar en
una copia. **v=316**: el grafo inventado suma una pareja (dos de los nueve aislados, con un solo par entre ellos: 60.142
pares, siete aislados) y los sueltos colocados como franja; y la puerta **H**: a «Ver todo», TODOS los puntos dentro del
lienzo (con el radio que se dibuja) y al menos un nombre, el del artista de más minutos (vista fallar contra v=315:
«salieron 0»). `mapa-artistas-caso.html?modo=foto&uid=owner&datos=real|inventado[&tema=papel]` es el instrumento de las
capturas y de la medición de frames (conductor en `fonoteca-migracion/mapa-artistas/driver-mapa-artistas-2026-10-18.mjs`;
el de v=316, `driver-mapa-artistas-t65-2026-10-18.mjs`). 🟩 **Arreglado en la tanda 66: los 38 `tests/banco/*.html` llevan
la `<meta name="viewport">` de `src/index.html`** (hasta la 65 no la tenían, y con `mobile: true` Chrome los maquetaba a
~980 px: el «390» de la 64 era un lienzo de 874×720); con la meta, 390 es 390 con `mobile: true` o `false`.

### Los sueltos, los nombres y el radio (v=316)

La tanda 65. Al abrir v=315 el mapa era una mancha oscura en el medio, sin un solo nombre, por tres causas que se arreglan
juntas: (1) **los aislados formaban un anillo** lejos de todo (`forceManyBody` los empuja y ningún enlace los retiene): el
plano medía **6.212,8 × 6.150,7** unidades para un grafo que entra en bastante menos; (2) **con cualquier encuadre no salía
ningún nombre**: pedían 12 px de radio y a «todo el mapa» el más grande medía unos pocos px; (3) **el 4.º artista más
escuchado estaba aislado** por el autocorrect (Last.fm lo escribe con «$», su respuesta se descartaba y los demás lo
nombraban así: tampoco recibía). La (3) es la regla del autocorrect (ver «🔎 `#generos`»); las otras dos, esto:

- **Los sueltos, fuera de la simulación** (`colocarSueltos` y `componentes`, puras, en `scripts/hornear-similares.mjs`).
  Entra a `d3-force` solo el componente conexo más grande, con las fuerzas de siempre sin tocar. Los demás —aislados y
  componentes chicos— van en una **grilla debajo**: primero los componentes de más de uno (de más grande a más chico, y
  adentro en el orden de `universo()`, así quedan juntos), después los aislados en el orden de `universo()`; celda de
  **48** unidades (más que el diámetro del más grande, 40); columnas = `floor(ancho del componente grande / 48)`, como
  mínimo 1; la primera fila con su centro **96** por debajo del borde inferior del componente grande (contando radios),
  alineada a su borde izquierdo; a 1 decimal. Lo prueba `tests/mapa-artistas.test.mjs` (secciones 10 y 11, con un grafo
  inventado y un d3 de mentira que cuenta cuántos nodos simula).
- 🔴 **Los nombres no dependen del radio**: de más minutos a menos, como mucho 60, solo con el centro dentro del lienzo y
  sin pisarse (gana el de más minutos). Así el más escuchado que se vea siempre tiene nombre. `RADIO_NOMBRE_PX` no existe
  más. Siguen en `--color-text`, con el borde de `--color-bg`, sin animación.
- **El radio en pantalla tiene un piso**: `max(r · escala, 1 + 4·√(minutos / máximo))` px (`radioEnPantalla`, el mismo
  para dibujar, para el anillo del elegido y para tocar). De cerca manda el plano (el horneado acomodó con `r`); de lejos,
  el piso, que mantiene el orden de tamaños (el más grande, 5 px; el más chico, ~1,2). **Es una decisión de diseño, no una
  medida.**
- Elegir (desde el mapa, el panel o el buscador) **centra pero no cambia la escala**, como en v=315. ⚠️ **Desde v=318 el
  buscador y el panel ENCUADRAN** (ver «El encuadre del elegido (v=318)», abajo); tocar el lienzo sigue sin moverse.

**El rehorneado** (REAL, **0 peticiones**: del archivo de avance de la 64, con el mismo d3; dos corridas, el mismo
sha256 de posiciones y de archivo, ~14,6 s cada una; `bwrap --unshare-net` para probar que no sale a la red): **78.455
pares** (v1: 77.420), 40.372 mutuos (v1: 39.845); **63 aislados** con 2.439,7 min (v1: 77 con 6.120,8) y **dos parejas**
fuera del componente grande (67 sueltos en total); de los 42 autocorrects a otro nombre, 17 aceptados y 25 descartados
(ninguna segunda clave pisada); el 4.º más escuchado pasa de grado 0 a **175**. El plano: **3.571,7 × 4.090,4** (el
componente grande, 3.571,7 × 3.987,8). El JSON pesa 1.185.500 bytes (v1: 1.171.258).

**A «Ver todo»** (SEMBRADO, el JSON real servido en local, Chrome headless, la letra de reserva: Google Fonts cortado):

| | lienzo | escala | nombres | de los 10 más escuchados, con nombre | puntos fuera del lienzo |
|---|---|---|---|---|---|
| 1366×768 | 1.198 × 476 | 0,1105 | 60 | 7 (1, 3, 5, 6, 7, 8, 9) | 0 de 2.302 |
| 390×844 | 368 × 523 | 0,0963 | 49 | 6 (1, 3, 5, 6, 7, 9) | 0 de 2.302 |

Los que no tienen nombre se pisan con uno de más minutos: los grandes están juntos. El detalle (y los frames) en
`fonoteca-migracion/mapa-artistas/`.

**Los frames** (SINTÉTICO: CPU ×1 y ×6 de esta máquina, no la netbook; el método de la 64, 60 frames sin elegido y 60 con
el de más grado, tres corridas; la carga de la máquina estaba por encima de 1,0): dibujar hasta 60 nombres por frame
cuesta. A ×6 y 1366, mediana **35–36 ms** sin elegido y 34–38 con elegido (la 64, sin nombres: 21–22). **Decidido de
antemano: si pasaba de 100 ms, `MAX_NOMBRES` bajaba a 30. No pasó: queda en 60.**

⚠️ **Visto en las capturas, sin arreglar** (en `PENDIENTES.md`): un nombre con el centro dentro pero la caja fuera se
corta en el borde del lienzo; y dos cajas pueden quedar pegadas (no se pisan, pero sin aire). El elegido sin prioridad
para su nombre se arregló en v=318 (abajo).

### El encuadre del elegido y las clases propias (v=317 y v=318)

La tanda 66. Dos cosas, en dos versiones:

**`.artmapa-*` es de esta vista y de nadie más (v=317).** Hasta v=316 la vista usaba `.mapa-artistas-…`, y dos de esas
clases (`.mapa-artistas` y `.mapa-artistas-lista`) eran también de `#mapa` y `#generos` (la línea de conteo de «Cuánto se
sabe» y las listas de artistas de cada país y de cada género). Las reglas nuevas iban después en `main.css` y les ganaban:
desde v=315, en `#mapa` la línea de conteo salía en **cuatro renglones apilados (100 px)** y en `#generos` en **dos (44
px)**, y las listas perdían sus rellenos; en `#mapa-artistas` la lista de parecidos salía en una columna. Es la regla de
`.wt-play-btn` (v=219) rota otra vez, y nadie la vio. Ahora todas las clases de la vista son `.artmapa-…` (`.artmapa`,
`.artmapa-lienzo`, `.artmapa-lista`…); **la ruta, el `data-route`, los `data-mapa-artistas`, el id `mapa-artistas-content`,
`window.__mapaArtistasDibujo` y los nombres de archivo NO cambiaron**, y `#mapa`/`#generos` no se tocaron. Guardas:
`tests/css-clases-duplicadas.test.mjs` (una clase suelta, una sola regla de nivel superior en `src/css/*.css`; las 10
duplicadas de antes, partidas a propósito, en una lista de exclusión con su nombre, una por una, y en `PENDIENTES.md`) y
la puerta **K** de los bancos `mapa`, `generos` y `mapa-artistas` (vistas fallar contra v=316).

**El encuadre (v=318).** Al elegir desde el **buscador** o un **botón del panel** (`data-elegir`), `encuadrarElegido`
(`util/mapa-artistas.js`, pura) deja al elegido en el centro del lienzo con la **mayor escala que deja a sus 30 primeros
parecidos** (en el orden del panel) **con el punto entero dentro** (el radio que se dibuja, con su piso) y **24 px de
margen** por lado. Pasa por `limitarEscala` (nunca menos que «Ver todo» ni más de 40 veces eso): si ni a «Ver todo» entran,
queda esa escala, centrada, y `entraron` dice cuántos. Grado 0: como `centrarEn` (centra y conserva la escala). **Tocar el
lienzo NO encuadra**: elige sin moverse (quien explora con el dedo no se queda sin piso). Sin animación.
`ENCUADRE_PARECIDOS = 30` y `MARGEN_ENCUADRE_PX = 24` son **decisiones de diseño, no medidas**: con todos los parecidos, un
artista de grado 175 se encuadra casi como «Ver todo». ⚠️ El encuadre solo ACERCA: si los 30 entran centrados a «Ver
todo», también entraban con v=317; lo que cambia es la escala (el elegido deja de ser un punto de 5 px entre 2.302).
`centrarEn` sigue: lo usa `encuadrarElegido`.

**El nombre del elegido con prioridad (v=318)**: si hay un elegido y su círculo está entero dentro del lienzo, su nombre
sale primero y les gana el lugar a los demás (cuenta en el tope de 60); si no, va en su turno, como cualquiera.

Medido (SEMBRADO, el JSON real, Chrome headless con `mobile: false`, la letra de reserva), eligiendo desde «Ver todo»:

| | v=317: escala · 30 primeros dentro · todos dentro · nombre | v=318: escala (veces «Ver todo») · 30 primeros · todos · nombre |
|---|---|---|
| Travis Scott (grado 175), buscador, 1366×768 | 0,1105 · 30/30 · 175/175 · no | 0,9382 (8,49) · 30/30 · 157/175 · sí |
| Travis Scott, buscador, 390×844 | 0,0963 · 30/30 · 174/175 · no | 0,5868 (6,09) · 30/30 · 162/175 · sí |
| el más escuchado (grado 211), panel, 1366×768 | 0,1105 · 30/30 · 211/211 · sí | 0,6367 (5,76) · 30/30 · 210/211 · sí |
| el más escuchado, panel, 390×844 | 0,0963 · 30/30 · 211/211 · sí | 0,1760 (1,83) · 30/30 · 210/211 · sí |

Guardas: `tests/mapa-artistas.test.mjs` (secciones 5 y 12: el centro, los 30 dentro con el margen y que es la MAYOR escala,
grado 0, el caso que no entra con `entraron`, el tope de 40, el nombre del elegido; rojo contra v=317) y la puerta **I** del
banco `mapa-artistas` (desde «Ver todo» buscar a uno de grado ≥ 30 acerca con sus 30 dentro, también desde un zoom de 20
veces, el nombre sale y 0 peticiones; vista fallar contra v=317: «acerca (1.00 veces)»).

### El mapa en la pantalla de Ian (v=319)

La tanda 67. Todas las mediciones del mapa hasta la 66 eran a **1366×768**, y la ventana de Ian mide **1366 × 591** de alto
útil (ver «El presupuesto de alto del modal de W-Three», v=170). Ahí el lienzo de `clamp(300px, 62vh, 720px)` medía **366
px**. Cuatro reglas, todas puras en `util/mapa-artistas.js` (la vista solo mide y llama):

1. **El alto del lienzo al alto disponible**: `altoDelLienzo(altoVentana, topLienzo, anchoVentana)`. Por debajo de **769
   px** de ancho, `null` y manda el CSS de siempre (**a 390 no cambia nada**: 368×523). Si no,
   `max(hoy, min(720, altoVentana − topLienzo − 16))` redondeado, con `hoy = min(720, max(300, 0,62 · altoVentana))`:
   **nunca más bajo que antes ni más de 720**. `topLienzo` es la posición del lienzo en la PÁGINA (scroll en 0). La vista
   lo mide al abrir y en el `resize` de la VENTANA (`ajustarAlto`), **nunca en el `ResizeObserver` del lienzo** (cambiar
   el alto lo dispara: sería un bucle; medido, 0 cambios de alto y 0 frames en 5 s quieto). El CSS no cambió: es el
   respaldo. ⚠️ El `top` se mide una vez al abrir: si la cabecera cambiara de alto después (la letra que llega tarde), el
   lienzo no se reajusta hasta un `resize`.
2. **Nombres enteros**: si el centro del círculo está dentro pero la caja se sale por un borde, la caja se **corre hacia
   adentro** hasta quedar a **2 px** (`BORDE_NOMBRE_PX`), en x y en y; la colisión se calcula con la caja ya corrida y
   `nombresVisibles` devuelve el centro de la caja corrida (la vista pinta ahí). Si la caja no entra ni con 2 px a cada
   lado, se queda centrada.
3. **Aire**: dos cajas se pisan si quedan a menos de **3 px** (`AIRE_NOMBRE_PX`; hasta v=318, solo si se superponían).
4. **Los sueltos, fuera del cupo**: `leerMapa` agrega `principal` (`Uint8Array`, 1 en el componente conexo más grande por
   `vecinos`; a igualdad de tamaño, el del índice más chico). Un suelto **no lleva nombre**, salvo el elegido.

El **16**, el **3** y el **2** son decisiones de diseño, no medidas.

**A 1366×591** (SEMBRADO, el JSON real, Chrome headless con `mobile: false`, la letra de reserva; conductor
`fonoteca-migracion/mapa-artistas/driver-mapa-artistas-t67-2026-10-20.mjs`, que comprobó que el `top` del lienzo es **173**
en `mapa-artistas-caso.html` y en la app, `index.html#mapa-artistas`):

| 1366×591 | lienzo | escala | nombres | de los 10 más escuchados, con nombre | cajas cortadas | pares a < 3 px | nombres de sueltos |
|---|---|---|---|---|---|---|---|
| «Ver todo», v=318 | 1.198 × 366 | 0,0836 | 44 | 5 (1, 3, 5, 6, 9) | 0 | 27 | 6 |
| «Ver todo», v=319 | 1.198 × 402 | 0,0924 | **34** | 5 (1, 3, 5, 6, 9) | 0 | 0 | 0 |
| Travis Scott desde el buscador, v=318 | 1.198 × 366 | 0,6971 | 60 | 7 | 4 | 11 | 0 |
| Travis Scott desde el buscador, v=319 | 1.198 × 402 | 0,7760 | 60 | 7 | 0 | 0 | 0 |

⚠️ **A «Ver todo» salen MENOS nombres (44 → 34)**: el aire de 3 px deja afuera a los que antes quedaban pegados. Decidido de
antemano: no se revierte; está en `PENDIENTES.md`. La escala sube un 10,5 % (lo que da el alto: 366 → 402). A 1366×768:
1.198×476 → 1.198×579, 0,1105 → 0,1357, 60 nombres los dos, 7 de 10 los dos. A 390×844: alto y escala iguales (368×523,
0,0963); nombres 49 → 35 y de los 10, 6 → 5. Frames (SINTÉTICO, esta máquina, 1366×591, el método de la 65): mediana a ×6
**30,8–33,2 ms** sin elegido y 30,4–32,2 con el de más grado (tope decidido: 100). La rueda sobre el título mueve la página
(`scrollY` 0 → 76) y sobre el lienzo hace zoom sin moverla. **0 peticiones nuevas**: la tabla de costos no cambia.

Guardas: `tests/mapa-artistas.test.mjs` (sección 13, y tres fixtures de la 5 con un par para que no sean sueltos; rojo
contra v=318) y el banco: la puerta **J** (un marco de 1366×591: el lienzo mide más que antes y su borde de abajo entra
con el scroll en 0; uno de 390×844, lo mismo que antes; ninguna caja de nombre fuera; vista fallar contra v=318: «366
contra 366.4») y la puerta **I apretada** (una `ESTRELLA` inventada con 30 parecidos a entre 6 y 20 unidades: tiene que
acercar al menos 3 veces; vista fallar contra v=317: «1.00 veces»; con v=319, 40,00). El grafo del banco pasa a 60.170 pares.

### Los nombres en la pantalla de Ian (v=321)

La tanda 68. Tres reglas, puras en `util/mapa-artistas.js` (la vista solo mide y llama). **La colocación del nombre NO
cambió**: sigue centrado en su círculo (corrido solo para no salirse del borde), con 3 px de aire, 12 px de letra y el tope
de 60.

1. **Los sueltos, con el cupo que sobra.** `nombresVisibles` coloca primero a los del componente grande (`principal[i] ===
   1`) en el orden de siempre, y **recién después**, si quedó cupo, a los sueltos, en el orden del universo y con la misma
   colisión, aire y borde. **Un suelto nunca desplaza a uno del componente grande**: esa lista sale idéntica con sueltos y
   sin ellos. El elegido sigue primero, sea suelto o no. (La regla de v=319 —«un suelto no lleva nombre»— tenía sentido a
   1366×768, donde se llena el cupo de 60; a 1366×591 salen 34 de 60 y sacarles el nombre no le liberaba lugar a nadie.)
2. **Los botones de zoom ocupan lugar.** `nombresVisibles(…, elegido, ocupadas = [])`: cajas `{ x0, x1, y0, y1 }` en
   coordenadas del lienzo; un nombre cuya caja, con el aire, toque una no sale. La vista pasa la caja de `.artmapa-zoom`,
   medida en `medirLienzo` cuando cambia el tamaño, **nunca en cada frame**.
3. **`nombresAjenos(mapa, v, etiquetas)`**: cuántos nombres son **ajenos**. Para cada nombre, el centro de su caja (ya
   corrida: donde se pinta) y `d(j) = hypot(cx − sxⱼ, cy − syⱼ) − radioEnPantalla(mapa, j, escala)`; es ajeno si **algún**
   otro artista `j ≠ i` tiene `d(j) < d(i)`. Un nombre ajeno **miente** sobre qué punto nombra. Cuesta `N` por nombre: la
   usan el test, el banco y el conductor, **la vista no**.

🔴 **La caída de 44 a 34 nombres a «Ver todo» en 1366×591 es el precio de no tener nombres pegados.** Sobre el mismo lienzo
de 402 px, las reglas de v=318 dan 48: de los 14 que faltan, 6 son sueltos (los devuelve la regla 1) y 8 se pierden por el
aire. Se midieron cuatro variantes para recuperarlos y **las cuatro quedaron descartadas** (SEMBRADO, la `nombresVisibles`
real, el JSON real e Inter 600 12px; las midió quien escribió el encargo de la 68, no esta tanda):

| «Ver todo», SEMBRADO | 1366×591: nombres · de los 10 · ajenos | 390: nombres · de los 10 · ajenos |
|---|---|---|
| v=319/v=320 | 34 · 5 · **0** | 35 · 5 · **1** |
| aire 2 | 38 · 5 · 0 | 39 · 5 · 1 |
| fuente 11 | 40 · 5 · 0 | 42 · 5 · 1 |
| fuente 10 | 44 · 5 · 0 | 46 · 6 · 1 |
| el nombre corrido al costado del punto | 48 · 7 · **33** | 50 · 7 · **31** |

Aire y fuente no ganan ni uno de los 10 más escuchados y achican la letra o vuelven a juntar nombres; el nombre corrido gana
dos de los 10 porque **miente** (33 ajenos de 48). A «Ver todo», en la pantalla de Ian, 5 de 10 es el techo sin mentir.

**Los sueltos son 67: 63 aislados y 2 parejas** («63» era el número de los aislados). Con el buscador se encuentra, se
encuadra, sale el nombre y se elige tocando a cada uno de los 67 (lo comprobó el encargo de la 68 con la función real; la
puerta **L** lo vigila con el grafo inventado).

Medido (SEMBRADO, el JSON real, Chrome headless con `mobile: false`, **Inter instalada en la máquina**: Google Fonts
cortado, pero `document.fonts.check('600 12px Inter')` da `true`; conductor
`fonoteca-migracion/mapa-artistas/driver-mapa-artistas-t68-2026-10-20.mjs`):

| «Ver todo» | nombres v=320 → v=321 | de los 10 | sueltos con nombre | desplazados por un suelto | ajenos | tocan los botones |
|---|---|---|---|---|---|---|
| 1366×591 | 34 → **40** | 5 → 5 | 0 → 6 | 0 | 0 → 0 | 0 → 0 |
| 1366×768 | 60 → 60 | 7 → 7 | 0 → 0 | 0 | 0 → 0 | 0 → 0 |
| 390×844 | 35 → 40 | 5 → 5 | 0 → 5 | 0 | 1 → 2 | 0 → 0 |
| Travis Scott (buscador), 390×844 | 60 → 60 | 6 → 6 | 0 → 0 | 0 | 3 → 4 | **1 → 0** |

Decidido de antemano: la regla 1 entraba si a 1366×591 salían al menos 40 con 0 ajenos y a 1366×768 seguían 60 con 0
desplazados. Entró. Frames (SINTÉTICO, esta máquina, 1366×591, el método de la 65): mediana a ×6 **32,4–36,9 ms** sin elegido
y 31,7–34,3 con el de más grado (tope decidido: 100). **0 peticiones nuevas**: la tabla de costos no cambia.

Guardas: `tests/mapa-artistas.test.mjs` (sección 14, y los asserts de los sueltos de la 5 y la 13 reescritos con su porqué;
rojo contra v=320) y tres puertas del banco: **L** (los siete aislados y la pareja del grafo inventado: el buscador los
encuentra, los centra, su nombre sale y tocarlos los elige; **de conservación**: contra v=320 también da verde), **M** (a
390×844 con la `ESTRELLA` elegida desde el buscador, ninguna caja de nombre toca `.artmapa-zoom`; con el grafo de manchas no
fallaba contra v=320, así que el grafo suma un artista inventado, `DEBAJO_DE_LOS_BOTONES`, a (+12,7, −33,2) de la estrella,
que cae justo ahí; vista fallar contra v=320: «tocan 1 de 14») y **N** (a «Ver todo» en 1366×591, 0 ajenos; **de
conservación**). El grafo del banco pasa a 2.303 artistas y 60.171 pares (los 60.170 de antes no cambian: el azar sigue
siendo el de los 2.302).

## 🖼️ La postal del año (v=326, rediseñada en v=327)

En «Wrapped», con un año elegido, el botón **«Descargar postal (PNG)»** (debajo de `.wrapped-hero-sub`) dibuja una imagen
de **1080×1350** con ese año y la baja como **`fonoteca-<año>.png`**. Pedido de Ian del 16/10, textual: «pngs para exportar,
con metricas o cosas interesantes». 🔴 **Que sea UNA POSTAL POR AÑO, en «Wrapped», fue NUESTRA lectura del pedido, no lo dijo
él**: `years[]` de `history-stats.json` ya trae todo para los 9 años y los 5 primeros discos de cada año tienen tapa (45 de 45,
contado sobre el JSON del repo el 21/10 y otra vez el 22/10). La postal de un artista (no hay foto en ningún JSON), la de un
disco (solo el día del umbral) y la de «de siempre» quedan para cuando Ian las pida. **La v=326 está en producción desde el
22/10 (12:41:15); la v=327 (el rediseño) la despliega la tanda 75.**

| archivo | qué | probado en |
|---|---|---|
| `util/postal-anio.js` | PURO (sin DOM, red ni lienzo): los textos, el recorte y los dos renglones (`partir`) con la medida INYECTADA, la posición de cada cosa, el degradé con su contraste (`degradadoPostal`) y el aviso del final | `tests/postal-anio.test.mjs` (171) |
| `features/wrapped-postal.js` | lee los colores, espera la letra, baja las tapas con `conTapa`, dibuja (el degradé, las tapas con las esquinas redondeadas), `toBlob('image/png')`, `descargarBlob`; deja `window.__postalDibujo` para el banco | `tests/banco/postal.html` (en `prepush`, el vigésimo quinto) |
| `features/wrapped.js` | el botón y nada más: lo pide con `import()` **al apretar** (no cambió en v=327) | ídem |
| `main.css` | `.wrapped-postal-btn`, clase propia (la regla de `.wt-play-btn`, v=219; no cambió en v=327) | ídem (puerta H) y `tests/css-clases-duplicadas.test.mjs` |
| `scripts/dev-server.mjs` | (v=327) sirve `/image/ab67616d00001e02<24 hex>` con CORS y 404 para cualquier otro prefijo: SOLO para el banco (puerta J); `src/` no lo pide nunca | la puerta J |

**Qué lleva**: el año, grande; el rango («del 15 ago 2018 al 31 dic 2018»); los minutos del año como **número héroe**; una
**franja** con las reproducciones, los días con música, la racha más larga («47 días» · «la racha más larga») y el día pico
(«9 mar 2025» · «día pico · 11h 8m»); el **artista 1** destacado (su nombre en hasta dos renglones, sus minutos y una barra
entera) y del 2 al 5 con puesto, nombre, minutos y una barra contra los del primero; el **disco 1** con su tapa de 380 px y, al
lado, su nombre (hasta dos renglones) y su artista; los discos 2 a 5 con tapas de 117 px en fila, cada nombre en hasta dos
renglones; y abajo, «Fonoteca · <año>». **Nada más.**

**Qué cambió en v=327, y por qué** (pedido de Ian del 22/10: «la postal podría ser más linda»): la de v=326 se leía como una
planilla —tres cajas de `--color-surface` iguales, una arriba de otra, todo con el mismo peso— y los nombres de disco quedaban
mutilados en casillas de 160 px de un renglón («Disco Inventa…» cuatro veces en la postal de ejemplo).

- **Jerarquía**: lo primero que se lee es el año y los minutos (156 px), sobre el degradé; el resto de los números baja a la
  franja de datos chicos (38 px y su etiqueta a 21), medida: cada casilla mide lo que su valor o su etiqueta, y lo que sobra
  va a los huecos, con una línea del acento en el medio de cada uno. **Sin cajas** (`fondos` vacío): separan el espacio y los
  tamaños. El año y los minutos tienen una caja de 0,95× (dígitos, «h» y «m»: nada baja de la línea); el resto, 1,25×.
- 🔴 **Los nombres en hasta DOS renglones** (`partir(texto, max, medir, renglones = 2)`): si entra en uno, tal cual; si no, el
  primer renglón lleva las palabras que entran y el resto sigue abajo; el último se recorta con «…» (`recortar`) si no entra;
  si ni la primera palabra entra, se parte por caracteres; y si lo que sigue no entra de ninguna forma (ni el «…»), el recorte
  de un renglón (nunca un nombre cortado sin avisar). Los discos 2 a 5 nunca más anchos que su tapa; el disco 1 y el artista
  1 tienen la columna. Probado en Node (barrido con dos medidas) y en el banco (puerta D: «Disco Inventado N» entero).
- **El disco 1 es la imagen de la postal**: 380 px, **dibujada desde la variante de 300** (×1,27: algo menos nítida que una de
  640; se eligió la de 300 para que los 5 pedidos sean a la misma variante). Esquinas redondeadas (14 y 8 px).

**El degradé**: la franja de arriba (y 0 a 500) va con un degradé vertical **del tema**: el acento mezclado con `--color-bg`
(sin el `#4c1d95` escrito a mano del `.wrapped-hero`), con tres paradas: la mezcla entera arriba, el 40 % de ella a 0,55 y el
fondo abajo. `degradadoPostal(plan, colores)` arranca con `MEZCLA_MAX = 0,6` y la **BAJA** de a un centésimo hasta que cada
texto que va encima tenga, **contra el punto PEOR del degradé detrás de su caja** (renglón por renglón, en el centro del
píxel, interpolado en sRGB y redondeado a 8 bits como lo pinta el lienzo), al menos `PISO_CONTRASTE = 4,6` (AA pide 4,5: el
resto es margen); si ni con el fondo liso pasa (un tema hecho a mano con el texto ilegible), queda en 0. Sobre el degradé va
**solo `--color-text`** (el secundario no llega sobre el acento en Papel). La cuenta es la de WCAG 2.x de
`tests/tema-contraste.test.mjs`; el test la rehace por su lado (su propia interpolación) y compara con la del módulo.
**Medido** (contraste peor sobre el degradé, con la mezcla de 0,6 en los cuatro): **violeta 10,18 · ámbar 6,71 · aguamarina
5,01 · papel 6,39**, y lo mismo contra los PÍXELES del PNG en el banco (puerta E, leídos en x = 2, donde no hay nada dibujado
encima). El contraste peor de toda la postal (también el ♪ sobre `--color-elevated` y el secundario sobre el fondo): 5,83 ·
5,64 · 5,01 · 5,99.

- 🔴 **Los saltos NO van**, ni el porcentaje ni la palabra: antes del 15/10/2022 el export no los anotaba igual (ver «La
  definición de salto»), y una imagen que circula sola no puede llevar el aviso. El test lo afirma («skip», «salt», «%»).
- 🔴 **Las fechas con `fmtDia`** (el día que dice el dato, sin `Date`): la primera escucha de 2026 es `2026-01-01T00:00:28Z`
  y con hora local la postal diría «del 31 dic 2025» (el bug de v=231). **Los minutos con el `fmtMinutes` de `wrapped.js`**,
  pasados por contexto como a la apertura: no hay un segundo formateador. Números con `toLocaleString('es-ES')`.
- **El recorte**: cada texto tiene el ancho de su caja y se corta con «…» **midiendo con la letra ya puesta**
  (`measureText`), nunca por cantidad de caracteres; sin dejar un espacio colgando y sin partir un emoji. Con menos de 5
  artistas o discos salen los que hay (los discos chicos, desde la izquierda); un nombre vacío sale «—».
- **La letra**: antes de medir, `document.fonts.load` de los pesos que usa (400, 600 y 700) con un tope de 3 s; si no carga,
  la de reserva, sin avisar (no es un error).
- **Los colores, ninguno escrito a mano**, leídos con `getComputedStyle` al apretar y normalizados a `#rrggbb` con un lienzo:
  fondo `--color-bg`, el degradé (acento + fondo), la casilla del ♪ `--color-elevated`, texto `--color-text` y el secundario
  `--color-text-secondary` (**nunca el muted**); el acento solo en lo que no es texto (las líneas de la franja y las barras).
  El botón, sobre el degradé del hero: blanco sobre el acento oscurecido un 45 % (en el peor punto, el acento puro: 11,82 ·
  7,62 · 5,64 · 13,34).

**Las tapas, por `conTapa()` de `covers-wallpaper.js`, IMPORTADO y no copiado**, con `coverVariant(url, 300)`. 🔴 **Contado el
22/10 sobre el JSON del repo (sin red)**: las 45 `img` de los 5 primeros discos de los 9 años tienen la forma del CDN
(`/image/ab67616d…`), conservan el host (34 de `image-cdn-ak.spotifycdn.com`, 11 de `image-cdn-fa`), y **ya traen el prefijo
`ab67616d00001e02`, el de 300**: `coverVariant(img, 300)` no cambia **ninguna** (0 de 45). La postal pide la URL tal cual está
en el JSON. 🔴 **Por qué no puede manchar el lienzo, leído del código**: con `mode: 'cors'`, una respuesta sin
`access-control-allow-origin` **rechaza el `fetch`** (no llega ningún blob) y `conTapa` devuelve `false`; el bitmap que sale
del blob de un `fetch` CORS no mancha. No hay camino que dibuje una imagen opaca.

🟩 **El CORS del CDN para la variante de 300 ESTÁ MEDIDO, el 26/09/2026** (corregido en la tanda 75). La fuente:
**`fonoteca-migracion/RESUMEN-CORS-TAPAS-2026-09-26.md`, sección «## 2. La prueba de CORS»**. Lo que se midió:
**en la pestaña de Ian, con el origen real** (`https://ianct2020.github.io`) y sobre portadas de 300 px tal como están
guardadas, `fetch(url, { mode: 'cors' })` → `blob` → `createImageBitmap` → `getImageData` anduvo en 3 de 3 de 300 (más 20
de 64), y un `<img crossOrigin="anonymous">` de 300 → `getImageData(0, 0, 300, 300)` también; **con `curl`** (HEAD, sobre la
de 64): `access-control-allow-origin: *` en los tres hosts (`image-cdn-ak`, `image-cdn-fa`, `i.scdn.co`), **incondicional**
(igual con `Origin` y sin él en los dos `image-cdn`; `i.scdn.co` se midió solo con `Origin`) y **sin `Vary`**, así que el `force-cache` de `conTapa()` no se envenena con las `<img>` sin
CORS que la tarjeta del año pinta con esas mismas URLs (eso es razonamiento sobre las cabeceras: el escenario en sí no se
probó). **Lo que sigue sin medir de verdad**: el camino exacto de la postal (`conTapa` con `cache: 'force-cache'` + el
`toBlob` del lienzo) contra el CDN real. La medición tiene semanas, es n=3 en la de 300 (con `cache: 'no-store'`), y nada
obliga a Spotify a mantener el `*`. **El primer clic de Ian es la confirmación punta a punta.** 🔴 **La historia, para que
no se repita**: v=326 lo daba por medido citando el mosaico (que pide la de 64) y v=327 lo dio por no medido; **las dos
veces sin buscar este archivo**. Antes de afirmar algo sobre el CDN de tapas, se busca en `fonoteca-migracion` con
`grep -ril cors`.

Si el CDN dejara de mandar el CORS, la postal sale igual con los 5 discos con ♪ y el aviso «5 tapas no se pudieron bajar…». **La guarda de
antemano**: si `toBlob` devuelve `null` o tira, la postal se vuelve a dibujar SIN tapas **en un lienzo nuevo** (uno manchado no
se limpia pintando encima: la marca es del lienzo) y se descarga igual, con «La postal salió sin tapas: …». **Una tapa que no
baja** (404, sin CORS, la red) es una casilla de `--color-elevated` con un ♪ (a 0,4 del lado); el aviso dice cuántas faltaron.

**Las dos guardas del botón**: dos clics rápidos = **una** postal (se deshabilita y dice «Generando…» en el mismo paso del
clic, y `postalEnCurso` frena el que se cuele); y **salir de la ruta mientras genera** aborta las tapas en vuelo
(`routeteardown` → `AbortController`) y, con la ruta ya no vigente (v=174), **no se descarga nada y no se escribe en el DOM**
(ni el toast, ni el botón, ni el `<a>` de la descarga). `postalEnCurso` guarda la vigencia de la ruta que la pidió: al volver a
«Wrapped» el botón nace habilitado.

**El costo**: abrir «Wrapped», **igual que antes** (1 `/me` + el del arranque; 0 del módulo de la postal); apretar, **0 a
Spotify** y **como mucho 5 al CDN de imágenes** (que no es cuota de nadie), más los dos módulos de la app la primera vez. Ver la
fila `↳` de `#wrapped` en la tabla de costos. v=327 no cambió ninguna petición.

Guardas: `tests/postal-anio.test.mjs` (con `TZ` de Buenos Aires y años INVENTADOS: el rango, los números, sin saltos, el
recorte, los dos renglones —uno que la v=326 cortaba entra entero, uno larguísimo lleva el «…» en el segundo—, menos de 5,
ninguna caja fuera ni pisada, sin cajas de fondo, el contraste contra el punto peor del degradé en los cuatro presets, que el
degradé existe —mezcla ≥ 0,3— y es solo acento + fondo, un tema hecho a mano donde la mezcla baja, la tapa del disco 1 ≥ 360,
la variante de 300, las 45 tapas del JSON del repo contadas sin nombres, y el aviso; rojo contra v=326 en 38 asserts) y el
banco `tests/banco/postal.html` + `-caso.html` + `-datos.mjs` (la app ENTERA, historial INVENTADO; las tapas buenas de 2025
son `data:` URL fabricadas en el banco, la 404 la da el servidor del banco, la «ajena» es `atardecer-prueba.png` pedida desde
`localhost` sin CORS, y las de 2023 tienen la forma del CDN): A abrir sin el módulo; B un PNG de 1080×1350 decodificado, 5
tapas, 0 Spotify, 0 CDN, los textos nuevos y el disco 1 grande; C la 404 y la ajena → el PNG sale igual, las dos casillas con
♪ y el aviso dice «2»; D el recorte y los dos renglones; E los colores y el degradé contra los píxeles; F dos clics; G salir con
una tapa retenida; H sin desborde a 1366×591 y 390×844; I `toBlob` con un `SecurityError` forzado → sin tapas y el aviso; **J
(v=327) las tapas con la forma del CDN**: los 5 pedidos a la de 300, a otro origen, con CORS y 200, las 5 dibujadas (un píxel
de cada una) y 0 pedidos a otro prefijo (el servidor contesta 404 a cualquier otro). **Contra v=326: B, D y E rojas; A, C, F,
G, H, I y J verdes** (J es de conservación: la v=326 también pedía la de 300). 10 de 10 corridas. ⚠️ El banco ancla la
decodificación del PNG en la madre: sin `anclar()` el reloj virtual saltaba al toast de 30 s y una puerta gastaba 478 s.
`postal-caso.html?modo=foto[&tema=papel][&datos=largos|chico]` es el instrumento de las postales de ejemplo (conductor en
`fonoteca-migracion/driver-capturas-postal-t74-2026-10-22.mjs`; el de la 73, para las capturas de la tarjeta). ⚠️ **Ninguna
postal se hizo con el JSON real** (necesitaría el CDN real) y ninguna se commiteó.

## Client ID
0c8c92ad128e4b89be7097c6b8082797

## Scopes usados
user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-top-read user-read-recently-played user-follow-read user-follow-modify

⚠️ `user-follow-modify` se añadió en v=268 y **no lo tienen las sesiones
anteriores**: el `scope` que devuelve el refresh es el de la concesión vieja.
Comprobado el 03/10 en una copia del perfil real: `sp_granted_scopes` existía ya
y **venía sin `user-follow-modify`**. Por eso `#follow-artists` enseña «Dar
permiso en Spotify» y deja el botón de guardar apagado hasta reconectar.

## Redirect URIs
- Dev: http://127.0.0.1:5500/callback.html
- Prod: https://ianct2020.github.io/spotify-web/callback.html

---

## PALETA DE COLORES — ELEGIR UNA

### Opción A: "Electric Violet"
- Acento primario: `#7C3AED` (violeta eléctrico)
- Acento hover: `#6D28D9`
- Acento suave (backgrounds): `#7C3AED1A` (10% opacity)
- Fondo principal: `#0A0A0F`
- Fondo card/surface: `#16161F`
- Fondo elevado: `#1E1E2A`
- Texto principal: `#F0F0F5`
- Texto secundario: `#8888A0`
- Borde: `#2A2A3A`
- Vibe: nocturno, premium, elegante. Como un dashboard de control.

### Opción B: "Acid Orange"
- Acento primario: `#FF6B2C`
- Acento hover: `#E85A1E`
- Acento suave: `#FF6B2C1A`
- Fondo principal: `#0C0A08`
- Fondo card/surface: `#1A1714`
- Fondo elevado: `#242018`
- Texto principal: `#F5F0E8`
- Texto secundario: `#A09880`
- Borde: `#332E25`
- Vibe: cálido, energético, distinto a cualquier app de música. Contraste fuerte.

### Opción C: "Saturated Cyan"
- Acento primario: `#06D6A0`
- Acento hover: `#05B888`
- Acento suave: `#06D6A01A`
- Fondo principal: `#080F0D`
- Fondo card/surface: `#0F1A17`
- Fondo elevado: `#152420`
- Texto principal: `#E8F5F0`
- Texto secundario: `#80A098`
- Borde: `#1E3530`
- Vibe: matrix meets mint, tech-forward, fresco. Diferente al verde Spotify (más aguamarina/turquesa).

---

## Tipografía
- Inter (Google Fonts) — sans-serif moderna, excelente legibilidad
- Weights: 400 (body), 500 (medium), 600 (semibold), 700 (bold)

## Build
- Dev: `npm run dev` (python http.server en :5500)
- Build: `npm run build` (copia src/ a docs/)

## Crear playlists privadas — NO SE PUEDE (verificado 2026-08-09)
`POST /me/playlists` **ignora el campo `public`**: se creó
`fonoteca · ocultos (skips)` con `{public: false}` y quedó `public: true`.
`PUT /playlists/{id}` con `{public:false}` devuelve **200 sin efecto**.
No hay forma de crear ni convertir una playlist a privada por API
post-migración. Si una feature necesita privacidad, el usuario tiene que
pasarla a privada a mano desde la app de Spotify.

## Ocultar un ARTISTA, en cinco vistas y con un solo almacén (v=276, 2026-10-06; la quinta, #new-releases, v=278)

`#similar`, `#discover-artists` y `#follow-artists` no dejaban ocultar artistas
(puntos 10, 12 y 13 del feedback de Ian del 04/10). Ahora las tres lo hacen, y
`#recs` —que ya lo hacía desde v=205— pasó a usar la misma pieza.

**NINGÚN SÉPTIMO ALMACÉN, y la decisión está medida.** La pregunta no era «cómo
oculto un artista» sino «dónde vive», porque cada almacén re-pagina su playlist
entera en cada sesión de página (`useCache:false`). La respuesta: **`recs_ocultos`
ya ES un almacén de artistas** —clave = nombre en minúsculas, con su playlist
espejo y su `recuperarUriDeArtistaKey`—, así que se mudó de `recommendations.js` a
`features/artistas-ocultos.js` y lo comparten las cinco (cuatro en v=276, `#new-releases` en v=278). Un séptimo habría
costado **lo mismo al abrir** (`1 /playlists/{id}` + `ceil(Ha/100)`) **más** una
playlist nueva en la cuenta, y encima habría dejado que un artista oculto en
`#similar` siguiera saliendo en `#recs` — el mismo bug que `discover-common.js`
evita compartiendo `hiddenAlbums` entre las dos de descubrir.

⚠️ **El `lsKey` y el `playlistName` no se tocaron, y no es un detalle.** Ian tenía
**12 artistas ocultos** el 06/10. Cambiarle la clave no los borraría: los dejaría
**inalcanzables** —la vista preguntaría por una clave que nadie escribió— y eso
pasa sin una sola excepción en consola. Por el mismo motivo la clave sigue siendo
`name.toLowerCase()` **sin normalizar** (sin colapsar espacios, sin sacar
acentos), aunque no sea la mejor clave: es la que escribieron esos 12.
`tests/artistas-ocultos.test.mjs` lo afirma byte a byte.

**El costo:** `#similar` **sigue en 0** al abrirse (el `ready()` va dentro de
`pickSourceArtist`, detrás del acto del usuario, como el de `#recs` va dentro de
`run()`); `#discover-artists` **+2** (43 → 45) y `#follow-artists` **+2** (9 → 11).

**La uri representativa sale GRATIS en dos de las tres.** Una playlist solo guarda
pistas y un artista no es una pista, así que hace falta una pista suya de
representante. `#follow-artists` y `#discover-artists` arman su lista **desde los
me gusta**, o sea que ya tienen ids de pistas de ese artista en memoria:
`artistasDeBases()` devuelve el `repTrackId` que antes calculaba y tiraba, y
`#discover-artists` lo saca de `state.likesByArtist`. Sin eso, podar los 183 de
`#follow-artists` costaría **183 `/search`**. En `#similar` no hay forma —un
similar de Last.fm es por definición alguien que NO está en tus likes— y ahí se
paga 1 `/search` por ocultamiento, como `#recs` desde v=205.

⚠️ **`recuperarUriDeArtistaKey` devuelve `{ uri, motivo, definitivo, reglas }`, no
una cadena.** El almacén desenvuelve las dos formas, pero **solo dentro de
`sync()`**: en el camino de `toggle()` hay que hacerlo en quien llama. Pasarle el
objeto entero guardaría un objeto donde va un `spotify:track:…` y el oculto se
subiría roto sin que nada se queje — `toggle` no valida la forma. El banco lo caza.

### El control: un botón ⋮ VISIBLE, y FUERA de la barra de `#discover-artists`

El click derecho **no** se reemplazó (Ian lo propuso): es el que trae copiar,
abrir en pestaña nueva e inspeccionar, y un gesto que no se ve no se descubre
solo. El botón se ve siempre; el click derecho sobre la fila abre el mismo menú
como propina. El icono es `iconoPuntosVertical` (⋮) y **no** reusa `iconoPuntos`
(···), que ya significa «buscando preview» y vive dentro del botón de play — en
`#similar` los dos conviven a centímetros.

⚠️ **El botón «Artistas ocultos N» NO va en `.disco-controls`, y está medido.**
Mide **143 px** con el contador en una cifra y **159 px con tres** («Artistas
ocultos 183», el techo plausible). Medido en `tests/banco/ocultar-artista.html`
el 06/10, bisecando el ancho de `main`:

| | con el botón DENTRO de `.disco-controls` |
|---|---|
| contador de 1 cifra (143 px) | dos filas por debajo de **1.317 px** |
| contador de 3 cifras (159 px) | dos filas por debajo de **1.366 px** |

O sea que a **1.356 px** —el ancho real de `main` en la pantalla de 1.366 de Ian,
medido el 03/10— la barra pasaba a **DOS FILAS**. Sin el botón: una. Concuerda con
lo que ya decía la sección de `#follow-artists`: esa barra tenía 18 px de margen.

Así que el control vive en **su propia línea** (`.disco-linea-artistas`), un
bloque aparte que no compite con nada, y sale vacía cuando no hay ningún artista
oculto. El banco afirma que la barra tiene las **mismas filas** antes y después
del control y con el contador en 183, así que un botón nuevo ahí vuelve a fallar.

### La quinta vista: `#new-releases` (v=278, 2026-10-07)

Se reusó la pieza SIN tocarla: `alternarArtistaOculto`, `claveDeArtista`,
`artistaEstaOculto`, `botonMenuArtistaHtml` y `conectarMenuArtista` siguen con
**una sola definición** y `tests/artistas-ocultos.test.mjs` cuenta cinco vistas.

- **No hay cabecera de artista**: la grilla es plana, una tarjeta por lanzamiento.
  El ⋮ va **en cada tarjeta, al lado del nombre del artista**, y `renderAlbumCard`
  recibe el botón ya hecho por la vista (`menuArtistaHtml`, opt-in: `#discover-artists`
  no lo pasa y su tarjeta no cambia). El click derecho solo abre el menú sobre esa
  línea (`.dcard-artista-fila`), nunca sobre la tapa.
- **El control NO está en `.disco-controls`** (quedó con 69 px libres el 05/10 y el
  botón mide 143/159): va en `.disco-linea-artistas`, igual que en
  `#discover-artists`, y sale vacío con 0 ocultos. El banco
  `ocultar-artista-novedades` afirma que la barra tiene las mismas filas y la
  misma altura antes y después, a 1.351 y a 1.356 px.
- **Modo «Artistas ocultos»** (`state.mode === 'artistas'`): invierte el filtro y es
  desde donde se devuelve. Los modos son excluyentes con «Ocultos» (álbumes).
- **Costo: +2** peticiones al abrir (`1 /playlists/{id}` + `ceil(Ha/100)`), medido
  contra una Spotify simulada con la forma de Ian: 5 → 7. La fila de la tabla lo dice.

### Lo que NO se hizo

- ~~**`#new-releases` no poda artistas.**~~ **Hecho en v=278 (07/10):** es la quinta
  vista de la misma pieza y costó los **+2** peticiones al abrir que decía acá
  (ver la tabla de costos). Ocultar un álbum **y** ocultar un artista valen ya en
  las dos vistas de descubrir.
- **El `useCache:false` sigue tal cual** (ver más arriba). Lo que costaría tocarlo
  está medido, pero es su propio encargo.

## El orden de `#covers`: «Más nuevas primero» y los sin fecha al final (v=278, 2026-10-07)

`util/orden-tapas.js` (puro, testeable en Node) tiene el orden de la vista; `covers.js` ya
no tiene `sortList`. Cuatro órdenes: `date-asc` (defecto), `date-desc`, `min-desc`,
`artist-asc`.

- ⚠️ **La fecha de una tapa es la de su PRIMERA ESCUCHA**, no la de lanzamiento (sale de
  `history-listened-albums.json`). Un álbum que solo viene de «w three» y nunca se escuchó
  entero **no tiene fecha** (`date: ''`).
- ⚠️ **Los sin fecha van al final en los DOS órdenes** (decisión de Ian, 07/10): un álbum sin
  fecha es desconocido, no el más nuevo. Hasta v=278 quedaban al final en ascendente **por
  accidente** (`x.date || '9999'`), así que invertir el comparador habría puesto lo
  desconocido arriba de todo. Se separan, se ordenan los que tienen fecha y se pegan al final.
- El descendente es el ascendente **dado vuelta** (empates incluidos), no un comparador
  invertido: con dos álbumes del mismo día, el invertido los deja en el orden de entrada.
- `util/release-date.js` no se tocó ni sirve acá: compara `.release` de lanzamientos.
- Banco `covers-orden` (en `prepush`) y `tests/orden-tapas.test.mjs`. 🟥 **Cuántos álbumes
  reales no tienen fecha NO está medido** (ver `RESUMEN-CERRAR-C2-2026-10-07.md`).

## Seguir artistas en Spotify (v=268, 2026-10-03)

`#follow-artists`, en el menú Descubrir, trabaja sobre las discografías guardadas
(en esta tanda: 351), ordenadas por likes locales. Seguir NO cambia los datos de
Novedades ni Sin escuchar: el beneficio es en Spotify. La vista lo dice.

- `/me/following/contains` y `PUT /me/following` están retirados para Development
  Mode. Se usan `GET /me/library/contains?uris=spotify:artist:…` y
  `PUT /me/library?uris=spotify:artist:…`, de a **40**, con la constante compartida.
  351 necesitan **9 consultas**, no 7. `GET /me/following?type=artist&limit=50`
  sigue vigente: se usó para obtener el censo completo con el presupuesto de esta tanda.
- Lectura actual contrastada en vivo: 40 booleanos, todos coincidentes con la lista
  completa de seguidos. Escritura: **solo simulada**, la prueba real le toca a Ian.
  La guía oficial incluye `spotify:artist` en el ejemplo de escritura aunque la
  referencia de `save-library-items` lo omite: inconsistencia documentada, no prueba real.
- Hace falta `user-follow-modify`: auth lo pide y guarda los scopes concedidos en
  `sp_granted_scopes`. Para sesiones anteriores se ofrece reconectar; no se sigue
  automáticamente a nadie. El permiso no se concede por código.
- Los controles «Los primeros N / Marcar / Ninguno» se comparten desde
  `discover-common.js`. Abrir deja todo sin marcar, confirmar muestra la cantidad,
  y los lotes confirmados se retiran de la lista sin recargar. Fallo parcial:
  conservar éxitos, dejar pendientes y mostrar el error; sin reintentos automáticos.
- Referencias: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
  y https://developer.spotify.com/documentation/web-api/reference/check-library-contains

### Por qué es una vista propia y no un botón en la barra de `#discover-artists`

Medido el 03/10 sobre el DOM real (copia del perfil, 1366×768, `.disco-controls`
con sus ocho hijos y `gap: 10px`):

| | ancho que necesita la barra | debajo de ese ancho de ventana pasa a dos filas |
|---|---:|---:|
| hoy | **1.100 px** | **1.214 px** |
| con un botón «Seguir artistas…» más (**134 px** + 10 de hueco) | **1.234 px** | **1.348 px** |

En la pantalla de 1.366 px quedarían **18 px** de margen: una etiqueta un poco
más larga, un paso de zoom o un contador más y rompe. ⚠️ El «~1.190 px» que se
venía diciendo era aproximado; el número medido es **1.214**. La barra lateral
**no quita ancho** (va por encima, `main` mide 1.356 con ella abierta o cerrada).

## 📅 `#calendario`: el detalle por día, y por qué es PRIVADO (v=289, 2026-10-10)

Cada día del historial, coloreado por los minutos que sonaron, con un panel por
día que dice qué escuchaste. Ruta `calendario`, sección General, detrás de
«Récords».

### Un solo calendario: `ui/calendario-anual.js`

El dibujo tipo GitHub era `visualCalendario()`, **privada** de
`features/wrapped-apertura.js` (el paso «Días con música» de la apertura del
Wrapped). Ahora vive en `src/js/ui/calendario-anual.js` y lo usan las DOS
vistas. No se copió: en este repo hay un resolutor de álbum que se escribió dos
veces y divergió (v=219) y un `fmtDate()` que se copió y fue la copia la que
mintió durante 27 versiones (v=231).

⚠️ **SIN OPCIONES, `calendarioAnual()` emite EXACTAMENTE el marcado de v=288**,
clases `.wr-ap-*` incluidas. Eso no es pereza de nomenclatura: es lo que hace
comprobable que la apertura no cambió. Las referencias de
`tests/fixtures/calendario-apertura-{2025,2018}.html` se generaron **con el
código viejo, antes de tocar nada**, sobre el `history-stats.json` real.
**La referencia NO se regenera nunca con el código nuevo**: si
`tests/calendario-anual.test.mjs` se pone rojo, se arregla el código. Regenerar
el fixture convierte la puerta en un sello de goma.

⚠️ **Desde v=290 ya no es «EXACTAMENTE» para un tramo que no arranca un día 1** (el rótulo
del primer mes). Hasta v=289 una etiqueta de mes solo salía donde caía el día 1, así que
2018 (arranca el 15/08) no rotulaba agosto, su primera columna. Ahora el mes de `D.from`
se rotula en la columna 0 si hay **al menos 2 columnas** (`MIN_COLS_PRIMER_MES`) hasta la
siguiente etiqueta; por debajo no, porque el mes visible tiene menos de dos semanas y su
rótulo se pisaría con el siguiente. **Medido a 1.366 px con Inter cargada**: agosto termina
en x=313,2 y septiembre empieza en x=361,7, o sea 48,5 px de aire, y no se pisan. A
**340 px** de ancho de contenedor (un móvil), con columnas de 13,3 px, quedan a **0,5 px**:
se rozan pero no se pisan. Es el límite; con un mínimo de 1 columna ya se pisarían. Cambia
el Wrapped de 2018 y de ningún otro año: los que arrancan un día 1 (2019–2026) siguen
idénticos byte a byte a v=289 (`tests/fixtures/calendario-apertura-hashes.json`) y 2018,
quitándole la etiqueta nueva, es la referencia de la 38 (`tests/calendario-anual.test.mjs`,
sección 7). **Por eso 2018 salió del byte a byte de la sección 1**: el fixture no se tocó.

⚠️ **`#calendario` NO redefine ninguna regla de `.wr-ap-*` desde su hoja.** Pide
`claseContenedor: 'cal-anual'` y todo lo suyo cuelga de esa clase. Es la regla
de `.wt-play-btn` (v=219): el look se comparte en `main.css`, la identidad no.
Una regla `.wr-ap-cal i { … }` escrita para la vista nueva le cambiaría el
dibujo al Wrapped.

Los formateadores siguen llegando por `ctx` (`fmtDia` de `util/fecha.js`,
`fmtMinutes` de `wrapped.js`): importarlos ahí dentro sería reintroducir el bug
de las fechas por la puerta de atrás.

### El dato nuevo: `days`, el octavo payload, y NO se hornea

🔴 **`src/data/history-days.json` NO EXISTE Y NO SE BUSCA, a propósito.** Todo
lo que viva en `src/data/` se publica en GitHub Pages **y en un repo PÚBLICO**, y
esto es el diario de escucha de Ian día por día con los temas de cada día.
`scripts/gen-stats.py` **no se tocó** y no emite nada nuevo.

El dato vive solo en `localKey(uid, 'days')` en IndexedDB, por `loadDays()`
(`features/history-data.js`), que pasa por `loadOne()` y respeta el candado del
owner igual que los otros siete. Sin dato local devuelve `null` y la vista lo
dice.

Lo produce `crearAcumuladorDeDias()` (`history-processor.js`), una función
**propia e incremental**: `agregarArchivo(arr)` recibe **un archivo por vez**, lo
acumula y lo suelta, y `cerrar()` arma el payload. Comparte con el pipeline las
tres reglas que tienen que ser las mismas o los minutos no cuadran:

1. la deduplicación (`` `${ts}|${uri}|${ms_played || 0}` ``, con el `Set`
   **compartido entre archivos**, porque los `_N` del export se solapan);
2. el descarte de lo que no tiene `spotify_track_uri` (episodios, audiolibros) y
   de la basura funcional (`isJunkTrack`);
3. la agrupación por día **en UTC**.

El orden de los temas dentro del día sale del `ts` **mínimo** de cada uno, así
que **no hace falta el `sort` global** de `processStreamingHistory()`. Y esa
función la usa por dentro para producir `days` en el import de un amigo: **una
sola implementación**. Los otros siete payloads no cambian ni un byte
(`tests/calendario-dias.test.mjs`).

**Medido sobre el export real de Ian** (19 archivos `Streaming_History_Audio_*`,
158,3 MB, en Node, 2026-10-10): **1.950 días con detalle**, **46.260 temas** en
el diccionario, 100.400 filas (día, tema), **4,05 MB** serializado, **2,7 s** y
**369 MB de RSS** máximo. Contra el `history-stats.json` que horneó el Python:
`plays_raw` 212.491 ✓, `plays_valid` 104.147 ✓, `skip_pct` 64,1 ✓,
`days_active` 1.856 ✓, y **2.935 días comparados día por día con 0 diferencias**.

### 🟩 La definición de salto: UNA sola desde v=291 (hasta v=290 eran dos y se llamaban igual)

Un salto es

```
r.skipped === true   ||   (r.reason_end === 'fwdbtn' && ms_played < 30 s)
```

contado sobre las reproducciones **crudas** (todas las deduplicadas con uri), **antes** del
corte de 30 s. Es la cuenta de `totals.skip_pct` (64,1 hasta v=294; **64,2 desde v=295**, ver
más abajo), la de `days[].saltos` del `#calendario` y, **desde v=291, también la de
`years[].skip_pct`**: `round(skips / max(1, plays_raw) * 100, 1)` con los dos contadores del año,
que `years[]` lleva al final (`plays_raw`, `skips`) —desde v=295 el divisor es
`plays_raw − plays_junk`—. Σ de los años = el total, exacto, y la suma de los
días de cada año da el porcentaje de ese año, exacto, los nueve.

**Lo que había hasta v=290**: `years[].skip_pct` era `yb.skipped / (yb.plays + yb.skipped)`,
con `yb.skipped` contando `fwdbtn || skipped` **después** del `if ms < MIN_MS: continue` (se
perdía los saltos cortos, que son la mayoría) y el divisor sumando los saltos dos veces.
Daba **9,3 · 6,1 · 16,5 · 11,2 · 35,5 · 34,7 · 26,8 · 25,2 · 21,9** (2018-2026) donde hay
**10,6 · 7,2 · 35,8 · 27,2 · 60,0 · 74,9 · 71,8 · 66,7 · 58,4**. Ninguna puerta lo miraba, y
el paso «dentro de todo» del Wrapped decía en los nueve años «este año aguantas mucho más».

⚠️ **Vive en DOS sitios que tienen que quedar iguales**: `scripts/gen-stats.py`
(`year_raw` / `year_skips`, al lado de `total_skipped`) y `src/js/history-processor.js`
(`yearRaw` / `yearSkips`). Paridad medida el 11/10 sobre el export real: los nueve años
idénticos en `skip_pct`, `plays_raw` y `skips`.

🟩 **Desde v=295 numerador y divisor filtran lo mismo** (tanda 43). Hasta v=294 **el divisor
contaba la basura funcional y el numerador no**: `total_plays = len(plays)` y `year_raw` cuentan
antes de `is_junk_track` y los saltos después, así que esas reproducciones (sonidos que no son
música) sumaban abajo y nunca arriba. Eran 227 de 212.491 (0 · 0 · 0 · 19 · 5 · 2 · 74 · 49 · 78
de 2018 a 2026; 31 de ellas saltadas) y v=291 lo dejó anotado sin tocarlo porque era del
planificador. Ahora:

```
years[].skip_pct = round(skips / max(1, plays_raw − plays_junk) × 100, 1)
totals.skip_pct  = round(total_skipped / max(1, total_plays − total_junk) × 100, 1)
```

- `plays_junk` es un contador nuevo, por año y en `totals`, que sube **en el mismo sitio en que
  la basura se saltea** (dentro del `if is_junk_track(…)` / `if (isJunkTrack(…))`, justo antes
  del `continue`) y en ningún otro. Va **al final** (append) de cada `years[]` (detrás de
  `skips`) y de `totals`. Σ de los años = el total (227).
- ⚠️ **`plays_raw` NO cambió**: sigue siendo «las crudas» (212.491), que es lo que se enseña en
  pantalla («de 212.491 crudas») y lo que suman las crudas por día de `#calendario`. **El
  calendario no se tocó**: su «N saltadas de M» sigue contando la basura en M, y por eso los
  tests que comparan los días contra el JSON lo hacen como `saltos / (crudas − plays_junk)`.
- Lo que se movió: el total **64,1 → 64,2** (64,086 → 64,154) y **cinco años**: 2021
  27,2 → 27,3 · 2022 60,0 → 60,1 · 2024 71,8 → 71,9 · 2025 66,7 → 66,8 · 2026 58,4 → 58,5.
  2018, 2019, 2020 (sin basura) y 2023 (2 de 34.315) se quedan. Ninguna rama del paso «dentro
  de todo» cambió.
- Versiones, las tres a la vez: `STATS_VERSION` 4 → **5** en `gen-stats.py` y en
  `history-processor.js`, 5 → **6** en `history-keys.js`; `OWNER_PREV_KEYS.stats` sigue vacía.
- Rehorneado con la copia y `verificar-rehorneado.py` (18 rutas distintas, las 18 esperadas; los
  otros seis JSON, idénticos). Paridad Python/JS sobre el export real: los nueve años y el total
  idénticos en `skip_pct`, `plays_raw`, `skips` y `plays_junk`.
- ⚠️ La referencia `tests/fixtures/dentro-de-todo-v291.json` trae los porcentajes de antes y **no
  se regeneró**: `tests/corte-saltos.test.mjs` compara contra ella después de reemplazar
  exactamente los porcentajes movidos, con la tabla viejo→nuevo escrita en el test.

🔴 **Los años anteriores al 15/10/2022 salen bajos por el INSTRUMENTO.** El export trae
`skipped: false` (no vacío) en todas las reproducciones anteriores a esa fecha —el primer
`true` es del `2022-10-15T01:06:42Z`—, así que hasta entonces un salto solo se ve si fue con
el botón y antes de los 30 s. De 2023 en adelante `skipped: true` cubre todo lo anterior y
además los saltos de más de 30 s (9.206 en 2023). O sea que 7,2 (2019) contra 74,9 (2023) **no
es solo un cambio de costumbre**. El número de cada año es correcto para lo que el export
registra; lo que no se puede es leerlo como una serie homogénea. Anotado en `PENDIENTES.md`.

🟩 **Desde v=295 el TOTAL dice que mezcla dos formas de contar** (tanda 43). `totals.skip_pct`
suma años sin el campo `skipped` con años que lo tienen. **El número no se recalcula sobre menos
años** (se llama total): se avisa donde se muestra. La frase es `AVISO_MEZCLA` de
`util/corte-saltos.js` («mezcla dos formas de contar»), la misma de la pista del tile «Skips» del
año del corte, y **ningún sitio la escribe a mano** (lo vigila `tests/corte-saltos.test.mjs`,
sección 5). Los tres sitios que muestran el total:

| sitio | qué quedó | por qué |
|---|---|---|
| Dashboard, tile del historial | valor «64,2% skips», etiqueta «mezcla dos formas de contar» | la etiqueta va en un renglón con `nowrap` + elipsis (170 px a 1.366, 155 a 390): «Skips · mezcla dos formas de contar» mide 188,9 y se cortaba; la frase sola, 151,2 |
| Wrapped, paso «dentro de todo», 2023-2026 | «…contra el 64,2% histórico, que mezcla dos formas de contar.» (las tres ramas). 🟩 **Desde v=296 ya no compara contra el total**: ver «la línea base», abajo. El aviso queda solo en el camino de reserva | pegada a la mención del total; 2018-2022 no nombran el total y no la llevan |
| Wrapped «de siempre», tile «Plays válidas» | 🟩 **desde v=296 (tanda 44)**: «de 212.491 crudas · 64,2% skips · mezcla dos formas de contar». En v=295 quedó **SIN CAMBIO** | la pista admite 220 px en un renglón; «de 212.491 crudas · 64,2% skips» ya mide 183,5 y la frase 165: con las tres cosas el tile y su fila crecen de 160,1 a 168,2 px. Los textos que entran tiran las crudas o la palabra «skips». No se tocó el CSS. **v=296**: el planificador levantó la regla del alto para este tile; a 1.366 su fila crece a 168,2 y la de ARRIBA baja de 161,3 a 153,2 (el disco ocupa las dos filas: la grilla sigue en 349,4); a 390, 3 renglones, tile 102, grilla +16,2 |

🟩 **La LÍNEA BASE (v=296, tanda 44): los años con el campo se comparan contra esos años, no
contra el total.** El paso «dentro de todo» de 2023-2026 decía «74,9% contra el 64,2% histórico»: un
año bien medido contra un promedio que incluye cinco años (2018-2022) sin el campo, que lo bajan, así
que la frase **exageraba** cuánto se corta de más. Ahora compara contra `lineaBaseSaltos(years)`
(`util/corte-saltos.js`, la que sabe qué años tienen el campo):

```
base = round1( Σ skips / Σ (plays_raw − plays_junk) × 100 )   sobre los años con anioSinCampoSkipped(year) === false
```

- Es la misma cuenta que `totals.skip_pct` restringida a esos años (incluye el año que se mira, como
  el total). **No es el promedio de los porcentajes**: los años no pesan lo mismo (2026 es medio año);
  el promedio daría 68,0 y la base es **68,5** (119.278 / 174.241 = 68,456). Sin sacar la basura
  daría 68,4: el divisor de hasta v=294.
- **Se calcula en el navegador** con `skips`, `plays_raw` y `plays_junk` de `years[]`: no se
  rehornea nada y ningún JSON cambió.
- Texto: «…74,9% contra el 68,5% de 2023 a 2026, los años en que Spotify ya anotaba los saltos.» Sin
  `AVISO_MEZCLA` (ya no mezcla nada). `desde`/`hasta` salen del dato. La frase «de cada 10» dice «En
  esos años cortas N…» y con la base sale en 2026 (7 contra 6). Ramas, umbral y nombres, iguales.
- Si `lineaBaseSaltos()` da `null` (menos de dos años con el campo, o un BYOH sin `plays_junk` /
  `skips`), el paso queda **exactamente** como en v=295: contra el total, con el aviso.
- Guardas: `tests/corte-saltos.test.mjs` secciones 2 (tabla de reemplazos sobre la referencia de
  v=291, que no se regenera) y 6, y el «de cada 10» de `tests/skip-por-anio.test.mjs` sección 4.

**Versiones, las tres a la vez** (misma lógica que el `gid`): `STATS_VERSION` 3 → 4 en
`gen-stats.py` (el sello del JSON), 2 → 4 en `history-processor.js` (el BYOH; estaba
desfasado) y 4 → 5 en `history-keys.js` (la clave de IndexedDB y el `?v=` del JSON), con
`OWNER_PREV_KEYS.stats` **vacía**. Un BYOH ya importado conserva el número viejo en su
IndexedDB hasta reimportar (anotado, no migrado).

**El copy que nació del número malo** (`pasoDentroDeTodo`, `wrapped-apertura.js`): la rama del
medio dice «aguantas más» (sin «mucho»: entra con 3 puntos) y «En todo tu historial cortas N de
cada 10 canciones; este año, M» en vez de «Antes cortabas…; ahora…» —el total incluye el año
que se mira— y solo cuando N ≠ M. El umbral de 3 puntos no se tocó.

**Antes de hornear, la copia; después, `python3 scripts/verificar-rehorneado.py --respaldo …`**
(sale con código ≠ 0; probado en rojo contra un horneado de ceros). `gen-stats.py` sin el
export sigue imprimiendo «OK» y escribiendo ceros.

Guardas: `tests/skip-por-anio.test.mjs` (103; 135 desde v=295) y
`tests/calendario-dias.test.mjs` (73; 76 desde v=295), que hasta v=290 afirmaba **las dos**
fórmulas y ahora afirma que coinciden.

### La importación «solo el detalle» (para el owner)

⚠️ **El owner no puede pasar por `saveMyHistory()`.** Escribe las ocho claves
`local_{uid}_history_*`, y `loadOne()` las consulta **antes** que los JSON
horneados del repo: a Ian le pisaría las siete vistas de historial con datos
recalculados en el navegador, sin las correcciones a mano de los JSON («Birds In
The Trap Sing McKnight», v=151) ni las tapas de `bake-covers.py`. Y pasaría sin
fallar.

Por eso `importarSoloElDetalle()` (`features/import-history.js`) **no corre
`processStreamingHistory()`**, lee archivo por archivo y guarda **una sola
clave** por `guardarSoloDias()`. Lo ofrece el panel del día cuando no hay
detalle.

🟩 **Y desde v=298 (tanda 46) es un candado, no una advertencia.** Hasta v=297
ningún paso del camino lo impedía: `openImportHistory()` abría el selector para
cualquiera, `handleFiles()` procesaba sin mirar el uid y `saveMyHistory()`
escribía sin preguntar. La regla vive **una sola vez**, en
`motivoSinImportCompleto()` (`features/history-data.js`, exportada): devuelve
`'owner'` si `/me` es `HISTORY_OWNER_ID`, `'identidad'` si la identidad está sin
confirmar (`/me` caído, el id viene de `fonoteca_last_user_id`) y `null` si se
puede. No suma ningún `/me` (va por el memo de `getCurrentUserId()`). **Tres
capas, y las tres llaman a esa función** (ninguna compara contra
`HISTORY_OWNER_ID` por su cuenta; en `src/js/` hay 3 comparaciones: `isOwner()`,
`loadOne()` y la guarda):

1. `saveMyHistory()` **tira** antes de la primera escritura
   (`err.importDelOwner = true` para el owner, `err.identidadSinConfirmar = true`
   sin identidad): no se escribe ninguna de las ocho claves. Es la que importa.
2. `handleFiles()` pregunta **antes** de leer, descomprimir o procesar nada, y
   si dice que no reabre la explicación: no se gastan los ~5 s para terminar
   rechazado.
3. `openImportHistory()` enseña la explicación («Tu historial ya está en la
   app») dentro del mismo modal, **sin** zona de arrastre, **sin**
   `<input type="file">` y **sin** «Borrarlo» —`clearMyHistory()` se llevaría
   también `local_<owner>_history_days`—. Sin identidad, el cartel de
   `identityLockedMessage('La importación')`, sin copy nuevo.

🟩 **Y desde v=309 (tanda 57) el candado tiene CUATRO puntos**: las tres capas del import
y **`clearMyHistory()`**, que llama a la misma `motivoSinImportCompleto()` antes del primer
`idbDel` y tira con `errorImportBloqueado()` (mismas marcas). Hasta v=308 no preguntaba nada:
con el owner se llevaba `local_<owner>_history_days` (lo único que guarda «solo el detalle», y
que se rehace solo volviendo a pasar el ZIP; ningún botón llegaba ahí porque la capa 3 esconde
«Borrarlo», o sea una puerta sin cerradura detrás de una pared), y sin uid volvía en silencio,
así que «Borrarlo» anunciaba «Historial local borrado» sin haber borrado nada. Ahora sin uid
también tira, y el handler de `#ih-clear` lo atrapa: toast rojo, sin cerrar el modal y sin
recargar. Las comparaciones contra `HISTORY_OWNER_ID` en `src/js/` siguen siendo **3**.
⚠️ **Consecuencia, a propósito: el owner no tiene ninguna forma de borrar su detalle por día
desde la app** (anotado en `PENDIENTES.md`; si lo quiere, es otro encargo). Para un amigo con
identidad confirmada no cambió nada. Guardas en `tests/import-guarda-owner.test.mjs` (owner,
identidad, sin uid, el amigo como conservación, la lectura estática y el handler REAL de
`#ih-clear` con la guarda en contra). ⚠️ Ese último caso **no está en el banco**: ahí el memo de
`getCurrentUserId()` (`api.js`) no se puede vaciar sin tocar producción, así que la guarda no
puede cambiar de opinión con el modal abierto; en Node el doble no memoiza.

**Las cuatro puertas** que llegan a `openImportHistory()`: el botón «Mi
historial» (`app.js`, `my-history-btn`), `window.__openImportHistory`, el
delegado de `[data-open-import]` de `bindOwnerLockedButtons()` (el «Ya tengo mi
ZIP» de `ownerLockedMessage()`) y el botón «Importar mi historial entero» del
panel de un día sin detalle de `#calendario` — que, además, **ya no se pinta**
cuando la guarda dice que no (`calendario.js`, `importCompletoBloqueado`); «Cargar
el detalle por día desde tu export» queda igual. La identidad sin confirmar
también bloquea: el id guardado puede ser el del owner, y con `/me` caído
`saveMyHistory()` no podría guardar de todos modos.

La importación «solo el detalle» (`guardarSoloDias()`) **no pasa por la guarda**
y sigue igual para el owner y para cualquiera.

🟩 **«Limpiar caché» conserva las claves `local_*` desde v=300 (tanda 48).** Hasta
v=299 el botón se llevaba al owner `local_<owner>_history_days` —el detalle por
día, lo único que guarda esta importación— y a un amigo las ocho claves de su
ZIP, o sea todo su historial; rehacer cualquiera de las dos pide volver a pasar
el ZIP, y el toast decía que se conservaban los likes y las dos bases sin nombrar
el historial. No es caché: es dato que el usuario subió y que no se puede volver
a bajar. `CONSERVAR_PREFIJOS` (`util/limpiar-cache.js`) suma `LOCAL_HISTORY_PREFIX`
(`history-keys.js`, lo usa `localKey()`); es `local_` a secas porque el uid va en
el medio de la clave, y `localKey()` es el único sitio de `src/js/` que arma
claves así. Para borrarlo queda el «Borrarlo» del modal (`clearMyHistory()`).
Y una puerta de lectura estática en `tests/import-guarda-owner.test.mjs`:
`idbSetCached(localKey(` con un tipo que no sea `'days'` aparece SOLO dentro de
`saveMyHistory()`. Guardas:
`tests/import-guarda-owner.test.mjs` (Node, dobles; mira las escrituras del doble
de IndexedDB) y el banco `tests/banco/import-guarda.html` (la app entera en tres
iframes: owner, id de prueba y `/me` caído; en `prepush`).

⚠️ **Cede el hilo con `MessageChannel`, no con `setTimeout`**: Chrome estrangula
`setTimeout` a **uno por minuto** en una pestaña oculta, así que 19 archivos con
`setTimeout(0)` entre cada uno tardarían 19 minutos y parecerían colgados.

🟩 **El import COMPLETO ya no congela el cartel (v=297, tanda 45).** Hasta v=296
el `onProgress` de `handleFiles()` era `async` con un `await` que nadie esperaba
y `processStreamingHistory()` corría sincrónica de punta a punta: medido en
Chrome headless con el export real de Ian, **una sola long task de ~3,7 s** y el
cartel quieto. Ahora:

- `processStreamingHistory()` es **`async` y cede ella misma**: recibe `ceder`
  (una función que devuelve una promesa) y `presupuestoMs` (**50** por
  defecto); en cada punto de control llama a `onProgress` —sincrónico, solo
  pinta— y, si pasaron 50 ms, hace `await ceder()`. Sin `ceder` no cede nunca
  (así la usan los tests y Node). **Una sola implementación**: ni copia
  sincrónica, ni Web Worker, ni algoritmo nuevo; el `plays.sort` sigue siendo
  una llamada.
- `handleFiles()` le pasa **`ceder: cederElHilo`**, la de arriba: un solo
  `MessageChannel` para los dos caminos del import (el otro `new MessageChannel`
  de `src/` es el del mosaico, `util/mosaico.js`, y no tiene que ver).
- Puntos de control: después de cada archivo en la deduplicación y en el
  acumulador de días, cada `progressStep` del bucle de agregados (arriba de la
  iteración, para que los `continue` no lo salteen) y entre los bloques del
  armado posterior, más cada 500 vueltas dentro de `skipStats` y
  `artistTracks` (eran ~640 ms seguidos, `skipStats` solo ~260).
- **La salida es idéntica byte a byte**: los ocho payloads, sin
  `generated_at`, dan el mismo `sha256` antes y después sobre el export real
  (y con `ceder` de 50 y de 0 ms). Lo vigila `tests/import-cede.test.mjs`.
- Medido en headless (dato real, máquina headless, dos corridas por lado): el
  hueco más largo entre frames pasa de 3.683–3.817 ms a 233–250 ms (y ~117 ms
  dentro del procesamiento: el mayor cruza al arranque de `saveMyHistory()`),
  de 5 a 58–59 frames, el cartel cambia en 36–39 frames en vez de 1, y la
  duración pasa de 3.575–3.699 ms a 3.863–3.870 ms (~1,06×).

⚠️ **NO verificado: la pestaña oculta.** `MessageChannel` no se estrangula, pero
en headless no se puede comprobar; queda sin dar por bueno. Y el `setTimeout`
de 60 ms que `handleFiles()` espera antes de procesar (para que se pinte el
overlay) sigue ahí: no estaba en el alcance. La lectura de archivos, la
descompresión del ZIP y `saveMyHistory()` no se tocaron.

### El contraste del selector de año: anillo, no blanco sobre el acento

🔴 **No reusa `.covers-chip`, y es deliberado.** Su `.is-on` pinta
`color: white` sobre `background: var(--color-accent)` y da **violeta 5,70 ·
ámbar 2,84 ✘ · aguamarina 1,89 ✘ · papel 7,10**: falla AA en dos de los cuatro
presets desde hace versiones (anotado en `PENDIENTES.md`). `.cal-anio.is-on` usa
un **anillo** (`box-shadow` del acento) con el texto en `--color-text`:
**15,91 · 14,82 · 13,63 · 12,92**, medido el 10/10 con las transiciones
terminadas.

Y el pie y los textos de pista van en `--color-text-secondary` y **no** en
`--color-text-muted`: el muted da **2,48 · 3,00 · 3,02 · 3,52**, o sea que falla
AA en los cuatro. La jerarquía la hace el tamaño, no el color. ⚠️ El resto de la
app usa muted para los textos de pista y arrastra el mismo problema: anotado, no
tocado.

### ⚠️ Medir contraste: componer el ALFA, o el número es inventado

Pisado en esta tanda. `.cal-anio.is-on` tiene `background: var(--color-accent-tint)`
—el acento al 10 %— y leer sus tres primeros números como si fuera opaco daba
**2,50 en ámbar y 1,68 en aguamarina**: un defecto de accesibilidad que **no
existe**. Compuesto de verdad sobre el fondo da 14,82 y 13,63. Hay que componer
capa por capa hasta una opaca, y también el alfa (y la `opacity`) del texto.
Es la misma familia que la medición a mitad de transición del 09/10.

### 🔴 La CUARTA trampa de la captura: `setDeviceMetricsOverride` la congela

Pisada en esta tanda y es la peor de las cuatro, porque la captura **sale bien**.
El conductor llamaba a `Emulation.setDeviceMetricsOverride` antes de cada
captura (para estirar el viewport al alto del recorte) y
`clearDeviceMetricsOverride` después. Con eso, dos estados **visiblemente
distintos** —el día pico con su anillo blanco y sin él— daban PNG **byte a byte
idénticos**: 11.383 B los dos. Comprobado que la diferencia existía: el
`box-shadow` computado era `rgb(240,240,245) 0 0 0 2px, …` en uno y `none` en el
otro, con la celda en x=676 y=311, dentro del recorte. Sin el override, los
mismos dos estados dan 12.959 B y 11.925 B y `cmp` los separa.

**La regla: el viewport se fija UNA sola vez, al arrancar, con alto de sobra, y
no se vuelve a tocar durante la corrida.** Y antes de disparar se comprueba que
el recorte entre en el viewport y que `scrollY === 0`; si no, se para en vez de
capturar algo dudoso. Las otras tres trampas (el `IntersectionObserver` que
`captureBeyondViewport` no dispara, el `clip` en coordenadas de página y la
guarda de animaciones que no puede ser global) siguen valiendo y están en
`fonoteca-migracion/CONTEXTO-TECNICO.md`.

### Las guardas

| qué | dónde | corre en |
|---|---|---|
| la apertura del Wrapped no cambió, byte a byte (2025; 2018 salvo su rótulo nuevo; 2019–2026 por hash) | `tests/calendario-anual.test.mjs` (77) | `npm test` |
| los minutos cuadran día por día + los saltos (año por año, una sola definición) | `tests/calendario-dias.test.mjs` (73) | `npm test` |
| los años suman el total · diez reproducciones contadas a mano · el copy de «dentro de todo» | `tests/skip-por-anio.test.mjs` (103) | `npm test` |
| abrir no gasta · la playlist cuesta 2 y 3 | `tests/banco/calendario.html` | `npm run prepush` |
| al owner el panel sin detalle no le ofrece el import completo (v=298) | `tests/banco/import-guarda.html` | `npm run prepush` |

El instrumento de las capturas es `tests/banco/calendario-fotos.html` y **no va
en `prepush`**: espera a un conductor externo, como `mosaico.html` sin `auto=1`.
El conductor vive en el repo privado
(`fonoteca-migracion/driver-capturas-calendario-2026-10-10.mjs`).

## 💰 Cuánto cuesta abrir cada vista (2026-10-06)

Esta tabla **no existía** hasta hoy, y los cuatro encargos anteriores la daban por
hecha: por eso los presupuestos se venían estimando a ojo y se pasaron cuatro
veces (48 peticiones de un tope de 12, el 04/10). Construida **leyendo el
código, 0 peticiones**. Cada fila dice de qué capa sale su número.

⚠️ **«Abrirse» es lo que dispara `render()` solo**, sin tocar nada. Lo que cuesta
un botón («Analizar», «Elegir más artistas…», «Actualizar») NO está acá: esa es
otra tabla y nadie la pidió todavía.

### Las constantes que mandan

| símbolo | qué es | valor de la cuenta de Ian | capa |
|---|---|---:|---|
| `L` | me gusta | **9.548** → `ceil(L/50)` = **191** págs. | medida 2026-07-17 |
| `P` | playlists que devuelve `/me/playlists` | **97** (42 propias) → `ceil(P/50)` = **2** | medida 2026-08-23 |
| `W` | pistas de «w three» | **3.011** → `ceil(W/100)` = **31** págs. | medida 2026-08-16 |
| `T` | pistas de la playlist espejo («anothertwo») | **~9.000** → **~90** págs. | medida (CLAUDE.md) |
| `A` | discografías en `discover_disco_base_v1_*` | **351** → `ceil(A/40)` = **9** | medida 2026-10-03 |

`paginateAll` corta con `!data.next`, así que son **exactamente `ceil(n/limit)`**
peticiones, sin página vacía de más. `/me/tracks` y `/me/playlists` van de a 50;
`/playlists/{id}/items` de a 100; `/me/library*` de a **40**
(`LIBRARY_URIS_POR_REQUEST`).

**Frío vs. caliente.** «Caliente» = mismo navegador, cachés puestos. Los tres
cachés que deciden casi todo:

- **Likes** (`idb`, **sin caducidad**): con el caché puesto, `getAllLikedTracks()`
  son **0** peticiones.
- **Playlists** (`localStorage`, TTL 24 h): `getAllUserPlaylists()` → **0**.
- **Items de playlist** (`idb`, validado por `snapshot_id`): `getAllPlaylistItems()`
  en caliente es **1** petición (`/playlists/{id}?fields=snapshot_id`), no 0.

⚠️ **`getBestAvailableLikes()` es 0 peticiones SIEMPRE.** Su defecto es
`allowFetch: false` y **nadie en todo el repo pasa `true`** (verificado con grep
el 06/10). Si el caché está frío devuelve `source: 'empty'` y la vista pinta un
cartel. Ésa es la razón de que la mitad de la tabla esté en 0 y la que hace que
el costo NO escale con el tamaño de la biblioteca en esas vistas.

### ⚠️ `#dashboard` NO es 0 peticiones (medido 2026-10-07)

La fila de la tabla decía **0 en frío y 0 en caliente** y estaba marcada «leída del
código». Medido en el navegador con la red cortada y los topes en cero, `#dashboard`
dispara dos cosas que esa lectura no vio:

1. **Un `/v1/me` de más.** Arrancar la app en `#home` cuesta **1** —el gate de
   `testConnection()` en `app.js:257`, que es lo que dice la nota del arranque—, pero
   arrancar en `#dashboard` cuesta **2**: el segundo lo pide `getCurrentUserId()`
   (`api.js:1050`), al que llega `loadOne()` de `history-data.js` para resolver si el
   user es el owner antes de servir el historial. Sale 11 ms después del primero, en la
   misma ráfaga de arranque. Los dos GET se contaron uno por uno en ocho cargas: **2 por
   carga, siempre**, contra **1 por carga** en `#home`.
2. **Las peticiones de playlist NO son de abrir la vista y NO salen de donde se dijo.**
   Corregido el 07/10 **leyendo el código**, que es lo que la medición anterior no hizo:

   - 🟥 **No es `refreshLastSyncLabel()`** (`dashboard.js:238`, la que `render()` llama en
     la línea 103). Esa función cuesta **0**: `getLikesCacheTimestamp()` (`api.js:725`)
     solo mira IDB y `localStorage`, y `getBestAvailableLikes()` (`api.js:687`) tiene
     `allowFetch = false` por defecto, así que devuelve el caché o `source: 'empty'` y
     **no sale a la red por ningún camino**. La atribución del 07/10 era equivocada.
   - 🟩 **Es `hydrateListenedAlbumsCard()`** (`dashboard.js:1241`), que llama a
     `getAllPlaylistItems(P)` (`api.js:996`). Y **no corre al abrir la vista**: la llama
     `renderDashboard()` en la línea 829, o sea **después de pulsar «Usar los de la
     caché»** (`loadData()`). Abrir `#dashboard` y quedarse ahí cuesta **0 playlists**.

   La fórmula, del código: **1** en caliente —el `GET /playlists/{P}?fields=snapshot_id`
   que valida el caché de IDB y devuelve los items guardados— y **1 + ceil(n/100)** en
   frío, con **n** = pistas de la playlist de álbumes escuchados. El 07/10, n = **2.509**
   (la playlist de escuchados de Ian), o sea **27** en frío y **1** en caliente.

⚠️ **De dónde salía el «no se sabe el número»**: de contar **preflight OPTIONS** con la
red cortada (6 y 3 en una apertura), que se reintentan y traen reintentos adentro. Con el
código delante el número sí se sabe, y además la pregunta estaba mal puesta: esas
peticiones no son de abrir la vista.

### ⚠️ `#wrapped` tampoco es 0 peticiones (medido 2026-10-07)

La fila decía **0 en frío y 0 en caliente**, «leída del código». Medido con la red cortada
y `/v1/me` contestado por el driver: **2 GET `/v1/me` por carga**, más un preflight
OPTIONS. Es **el mismo par que `#dashboard`** y por la misma razón — el gate de
`testConnection()` (`app.js:257`) y el `getCurrentUserId()` (`api.js:1050`) al que llega
`loadOne()` de `history-data.js` para resolver si el user es el owner antes de servir el
historial. **Cualquier vista que sirva el historial del owner paga ese segundo `/me`**, y
eso es `#wrapped`, `#records`, `#zeroplays` y `#skips`: sus filas en **0** siguen sin
medir y hay motivo para dudar de las cuatro.

La moraleja es la de siempre y se repite: **«leída del código» no es una medición.** La
fila sobrevivió así desde que se armó la tabla.

### Las 24 vistas del menú

> ⚠️ **CÓMO LEER ESTA TABLA — la capa de cada fila no es decorativa.**
>
> La tabla **se construyó LEYENDO CÓDIGO**, no midiendo, y **se va corrigiendo a
> medida que cada fila se mide en vivo**. Las dos cosas que eso implica:
>
> - **«leída del código» NO es una medición.** Es una predicción, y ya falló
>   **tres veces**: `#home` decía 3 `/v1/me` y es **1** (06/10), `#dashboard`
>   decía **0/0** y es **2** `/me` (07/10), y `#wrapped` decía **0** y también
>   es **2** (07/10). Las tres fallaron hacia ARRIBA o hacia ABAJO sin avisar.
>   Una fila sin medir es una hipótesis con formato de dato.
> - **La columna «capa» dice cuál es cuál**: `leída del código` o
>   `medida el <fecha>`. Al medir una fila **se cambia la capa en el mismo
>   commit**, y si el número no coincide con lo que decía, se deja dicho qué
>   decía antes — las filas `↳` de abajo son eso.
>
> ⚠️ **«En frío / en caliente» es ABRIR LA VISTA**, no usarla. Lo que cuesta un
> clic dentro de la vista va en una fila `↳` aparte y **no se suma al tope** de
> un encargo que solo abre la vista. Confundirlos fue el error de la fila de
> `#dashboard`.

> 🔴 **LA CONVENCIÓN DEL `/me`, que es de donde salieron las tres filas malas
> (auditoría del 08/10, leída del código, 0 peticiones).** Hay **dos** `/me` por
> carga de página y la tabla los mezclaba:
>
> 1. **El del arranque**, 1 y solo 1: `app.js:257` (`testConnection()`) hace un
>    `fetch` CRUDO a `https://api.spotify.com/v1/me`. Se paga una vez por carga,
>    la pida la vista que sea.
> 2. **El de la vista**, 0 o 1: la primera vista que necesite el *id* llama a
>    `getCurrentUserId()` (`api.js:1048`), que hace su propio `spotifyFetch('/me')`
>    y lo memoiza en `_cachedUserId` (`api.js:1046`). De ahí en adelante, 0.
>
> **Por qué el primero no cubre al segundo:** el del arranque va por `fetch` crudo
> y su respuesta la consume `init()` (`app.js:380-382`, `showApp(profile)`); **nadie
> siembra `_cachedUserId` con ella**. El memo solo se calienta desde dentro de
> `getCurrentUserId()`. Son dos caminos que nunca se tocan.
>
> **Y sí, hay una caché que debería taparlo y no lo hace** — dos, de hecho:
> `localStorage['fonoteca_perfil_v1']` (`app.js:122`, el perfil entero, lo escribe
> `guardarPerfil()`) y `localStorage['fonoteca_last_user_id']` (`api.js:1095`), que
> **`getCurrentUserId()` escribe pero nunca lee en el camino feliz**: solo lo lee
> `resolvedUserId()` (`history-data.js`) y solo cuando `/me` ya falló. O sea que el
> id está en disco y se vuelve a pedir igual.
>
> **A partir de acá la columna «en frío» NO incluye el `/me` del arranque.** Se suma
> aparte, una vez. Las filas medidas en vivo que lo incluían quedan con el desglose
> a la vista.

| vista | en frío (sin el `/me` del arranque) | en caliente | endpoints que dispara | de qué depende | capa |
|---|---:|---:|---|---|---|
| **General** | | | | | |
| `#dashboard` | **1 `/me`** (+1 del arranque = **2** medidos) | ídem | `getCurrentUserId()` de `loadOne()`, vía `loadHistoryStats()` en `render()` | **fijo**, no escala con la biblioteca | **medida en vivo el 2026-10-07** · desglose **leído del código el 2026-10-08** |
| ↳ **al pulsar «Usar los de la caché»**: **1 + ceil(n/100)** = **27** | — | **1** | `1 /playlists/{P}?fields=snapshot_id` + págs. de `/playlists/{P}/items` | **n** = pistas de la playlist de álbumes escuchados (**2.509** el 07/10) | **leída del código 2026-10-07** |
| ↳ lo que decía antes (**0/0**, y después **1 `/me` + 1 `/playlists` + 1 `/items`**) era FALSO | | | | | ver la nota de abajo |
| `#wrapped` | **1 `/me`** (+1 del arranque = **2** medidos) | ídem | `getCurrentUserId()` de `loadOne()`, vía `loadHistoryStats()` en `render()` | **fijo** | **medida en vivo el 2026-10-07** · desglose **leído del código el 2026-10-08** |
| ↳ lo que decía antes (**0/0**) era FALSO: es el MISMO par que `#dashboard` | | | | | ver la nota de abajo |
| ↳ sin historial (`renderLite`) | **2** | **2** | 2 × `/me/top/{artists,tracks}` | fijo | leída del código |
| ↳ **al apretar «Descargar postal (PNG)»** (v=326): **0 a Spotify**, **≤ 5 al CDN de imágenes** | — | ídem | `conTapa()` de las 5 tapas del año (la variante de 300), más `wrapped-postal.js` y `util/postal-anio.js` del propio Pages la primera vez; abrir «Wrapped» no cambia (0 del módulo) | nº de discos del año con tapa (5 de 5 en los 9 años, 21/10) | **medida en el banco el 2026-10-21** (`tests/banco/postal.html`, tapas inventadas: 5 pedidos, 0 a la simulada, 0 hosts de CDN). En vivo, no |
| `#records` | **1 `/me`** (+1 del arranque = **2**) | ídem | `render()` → `loadRecords()` (`records.js:50`) → `loadOne` → `ensureFreshMem` → `resolvedUserId` → `getCurrentUserId` | **fijo** | 🔴 **corregida el 2026-10-08, leída del código.** Decía **0/0** y es la MISMA pieza que `#dashboard` y `#wrapped` |
| `#calendario` | **1 `/me`** (+1 del arranque = **2**) | ídem | `render()` → `loadHistoryStats()` + `loadDays()` → `loadOne` → `getCurrentUserId` (memoizado: los dos comparten el `/me`, es 1 y no 2) | **fijo**, no escala con nada | **medida en la Spotify simulada el 2026-10-10** (`tests/banco/calendario.html`): abrir = **1** petición y es `/me`; cambiar de año y abrir y cerrar el detalle de un día = **0 más**; **0** lecturas que no sean `/me`, 0 rutas sin simular, 0 hosts externos. En vivo, no |
| ↳ **al pulsar «Crear playlist con este día»**: **1 + ceil(N/100)** POST | — | ídem | `POST /me/playlists` + `POST /playlists/{id}/items` de a 100 | **N** = temas del día | **medida en la Spotify simulada el 2026-10-10**: **2** con 30 temas y **3** con 150, exactas y todas POST, **0 GET** |
| `#mapa` (v=304) | **1 `/me`** (+1 del arranque = **2**) · **0 MusicBrainz** | ídem | `render()` → `loadArtistTracks()` → `loadOne` → `getCurrentUserId` (el `getCurrentUserId()` de la vista va por el memo: 0 más); la caché del mapa sale de IndexedDB | **fijo**, no escala con nada | **medida en el banco el 2026-10-14** (`tests/banco/mapa.html`, Spotify y MusicBrainz simulados): abrir = 1 `/me` y 0 a MusicBrainz, también al volver y tras recargar. En vivo, no. Desde v=305 abrir baja además el módulo del mundo (`util/mundo-110m.js`, ~73 KB, del mismo origen: no es cuota de nadie); el banco lo vuelve a afirmar con el mundo puesto |
| ↳ **al pulsar «Buscar países» / «Seguir»**: **1 búsqueda por artista + la grabación si hace falta + 1 por cada área nueva**, de a una y a 1,2 s como mínimo, **0 a Spotify** | — | lo ya guardado: **0** | `musicbrainz.org/ws/2/artist/`, `/recording/`, `/area/<id>` | nº de artistas con ≥ 10 min sin buscar todavía | **medida en el banco** (12 artistas inventados: 23 peticiones sin fallos) y con tope en vivo contra MusicBrainz (ver `fonoteca-migracion/mapa/`) |
| `#puertas` (v=308) | **1 `/me`** (+1 del arranque = **2**) | ídem | `render()` → `loadArtistTracks()` → `loadOne` → `getCurrentUserId`; «Mostrar 100 más» = **0** | **fijo**, no escala con nada | **medida en el banco el 2026-10-15** (`tests/banco/puertas.html`, Spotify simulada): abrir = 1 `/me` y 0 de lo demás, también con un amigo; 0 rutas sin simular, 0 hosts externos desde que se abre. Con el conductor de capturas (la app servida en local, `/me` contestado ahí): 2 `/me` en la carga, el del arranque y el de la vista. En vivo, no |
| `#generos` (v=313; los géneros, v=314) | **1 `/me`** (+1 del arranque = **2**) · **0 Last.fm** | ídem | `render()` → `loadArtistTracks()` → `loadOne` → `getCurrentUserId`; `cargarEtiquetas(await getCurrentUserId())` va por el memo (0 más); las etiquetas y el ritmo salen de IndexedDB | **fijo**, no escala con nada | **medida en el banco el 2026-10-17** (`tests/banco/generos-escaneo.html`, Spotify y Last.fm simulados): abrir = 1 `/me` además del del arranque y 0 a Last.fm en 5 s de reloj, también al volver y tras recargar; 0 rutas sin simular, 0 hosts externos. **v=314, el mismo costo**, medido en `tests/banco/generos.html` (también tras recargar). En vivo, no |
| ↳ **al desplegar un género, «Ver todos» o «Mostrar 100 más»** (v=314): **0** | — | **0** | ninguno: todo sale de lo guardado | — | **medida en el banco el 2026-10-17** (`tests/banco/generos.html`): 0 `fetch` a cualquier host |
| ↳ **al pulsar «Buscar géneros» / «Seguir»**: **1 `artist.gettoptags` por artista** con ≥ 10 min que Last.fm no contestó todavía (más los reintentos de los fallos), de a una y a 1 s como mínimo, **0 a Spotify** | — | lo ya buscado: **0** | `ws.audioscrobbler.com/2.0/?method=artist.gettoptags&autocorrect=1` | nº de artistas del universo sin buscar | **medida en el banco el 2026-10-17** (10 artistas inventados: 10 respuestas definitivas, una por artista, más los reintentos de 3 errores 29 y 1 503) y, la consulta, en vivo con 51 artistas desde Node (tanda 61) |
| `#mapa-artistas` (v=315) | **1 `/me`** (+1 del arranque = **2**) · **0 Last.fm** · **0 CDN** | ídem | `render()` → `loadArtistTracks()` + `loadArtistSimilares()` → `loadOne` → `getCurrentUserId` (memoizado: las dos comparten el `/me`); los dos JSON salen del propio Pages (`data/`) o de IndexedDB | **fijo**, no escala con nada | **medida en el banco el 2026-10-18** (`tests/banco/mapa-artistas.html`, Spotify simulada, grafo inventado): abrir = 1 `/me` además del del arranque y 0 de lo demás, también al volver (0 `/me` más); 0 rutas sin simular, 0 hosts externos. En vivo, no |
| ↳ **al tocar, arrastrar, hacer zoom, buscar o «Mostrar 50 más»** (v=315): **0** | — | **0** | ninguno: todo sale de lo cargado | — | **medida en el banco el 2026-10-18**: 0 peticiones a cualquier host. «Ver ficha» abre la ficha de artista y cuesta lo que cueste la ficha |
| `#covers` | **1 `/me` + 1 + ceil(W/100)** = **33** | **2** | `isOwner()`/`loadListenedAlbums()` → `getCurrentUserId` · + 1 `/playlists/{id}?fields=snapshot_id` + págs. de `/playlists/{id}/items` | nº de pistas de «w three» | 🔴 **corregida el 2026-10-08, leída del código.** Decía **32** y se le olvidaba el `/me` propio |
| `#mosaico` | **0** | **0** | **ninguno, a propósito** | — | **medida en vivo el 2026-10-06**: 10 mosaicos generados (hasta 43.200 celdas), **0 peticiones y 0 cortadas** con los topes de la API en CERO. Lo que sí sale a la red es el CDN de imágenes, que no gasta cuota |
| `#search` | **0** | **0** | — | — | leída del código · **`/me` repasado el 2026-10-08**: su `render()` no llega a `getCurrentUserId()` |
| `#listened` | **26** `/items` + 3 `/me` | **0** | snapshot + págs. de `/items` | pistas de la playlist elegida | **medida en vivo el 2026-10-04** (caché vencido) |
| ↳ lo que predice el código | 1 + ceil(n/100) | **0** (caché propio en IDB) | ídem | ídem | leída del código |
| **Crear** | | | | | |
| `#smart` | **ceil(L/50)** = **191** | **0** | `/me/tracks` paginado | **nº de me gusta** | leída del código · **`/me` repasado el 2026-10-08**: su `render()` no llega a `getCurrentUserId()` |
| `#byartist` | **0** | **0** | — | — | leída del código · **`/me` repasado el 2026-10-08**: su `render()` no llega a `getCurrentUserId()` |
| `#wthree` | **45** `/playlists/{id}/items` | **~15** | snapshot + págs. de «w three» + **la playlist de ocultos entera** | pistas de la playlist **y nº de ocultos** | **medida en vivo el 2026-10-04** |
| ↳ y el código lo explica | 1 + ceil(W/100) **+ 2 + ceil(H/100)** | ídem | `31` de «w three» + **14 de ocultos** = los 45 medidos | ídem | leída del código |
| `#genre` | **1 `/me`** (+1 del arranque = **2**) | ídem | `renderStartScreen()` → `cargarEtiquetas(await getCurrentUserId())` (v=312: las etiquetas viven en IndexedDB por usuario) | **fijo** | **medida en el banco el 2026-10-16** (`tests/banco/generos-cache.html`, Spotify, Last.fm, MusicBrainz y stats.fm simulados): abrir = 2 `GET /me` (el del arranque y el de la vista) y nada más; contra el `src/` de v=311, 1. **0** a los tres terceros. En vivo, no |
| ↳ lo que decía antes: **0/0**, «confirmada el 2026-10-08: su `getCurrentUserId()` está en `handleExport()` (`:252`), que cuelga de un botón» | | | era cierto hasta v=311 | | |
| **Descubrir** | | | | | |
| `#similar` | **0** | **0** | — (la búsqueda es un acto explícito) | — | ✅ **confirmada el 2026-10-08**: `artistasOcultos.ready()` está en `pickSourceArtist` (`:177`, declarada en `:161`), que cuelga de un clic — no de `render()` |
| ↳ y SIGUE en 0 con ocultar artistas (v=276) | **0** | **0** | el `ready()` del almacén de artistas va dentro de `pickSourceArtist`, no de `render()` | — | leída del código |
| `#rabbit` | **0** | **0** | — | — | leída del código · **`/me` repasado el 2026-10-08**: su `render()` no llega a `getCurrentUserId()` |
| `#recs` | **0** | **0** | — | — | ✅ **confirmada el 2026-10-08**: `hiddenArtists.ready()` está en `run()` (`:265`, declarada en `:187`), que cuelga de `#recs-run-btn` |
| `#discover-artists` | **32 + 2 + ceil(Hd/100)** = **43** | ídem que el frío menos «w three» | «w three» **+ la playlist de ocultos («descubrir»)** | pistas de «w three» **y nº de ocultos** | leída del código · **`/me` repasado el 2026-10-08**: `hiddenAlbums.ready()` (`:314`) SÍ está en el camino de `render()` (`:202`) y paga **1 `/me` propio**, ya contado en el «+2»; `artistasOcultos.ready()` (`:386`) reusa el memo y suma 0 |
| ↳ **+2 desde v=276** (ocultar artistas) → **45** | **45** | ídem | **+ la playlist de ocultos («recomendados»)**: `1 /playlists/{id}` + `ceil(Ha/100)` | nº de artistas ocultos (**12** el 06/10) | leída del código |
| ↳ 🟩 **los ocultos, medidos (v=299)**: frío **15**, caliente **3** (v=298: 15 y **13**) | **3** | **15** | frío: 1 `/me` + 1 `/playlists/{desc}` + **9** págs. + 1 `/playlists/{art}` + **1** pág. + `/me/albums` + `/me/playlists`. Caliente: 1 `/me` + los dos `GET /playlists/{id}`, **0** págs. | si la playlist cambió (snapshot nuevo) o el caché venció (24 h), esa playlist se baja entera | **medida en el banco el 2026-10-13** (`tests/banco/ocultos-cache.html`, Spotify simulada con **900 + 12** ocultos, ids guardados; el «antes» es el mismo banco contra el `src/` de v=298). **Sin «w three»** (no configurada en el banco): sus `1 + ceil(W/100)` van aparte y no cambiaron. Sin el `/me` del arranque |
| `#follow-artists` | **1 `/me` + ceil(A/40)** = **10** | **1** | **`artistasOcultos.ready()` está DENTRO de `render()`** (`follow-artists.js:175`, `render` en `:17`) → `getCurrentUserId` · + `/me/library/contains?uris=spotify:artist:…` | **nº de discografías en la base** | 🔴 **corregida el 2026-10-08, leída del código.** Decía **9** y se le olvidaba el `/me` propio |
| ↳ **+2 desde v=276** (ocultar artistas) → **11** | **2** | **+ la playlist de ocultos («recomendados»)** | ídem que arriba | nº de artistas ocultos | leída del código |
| `#new-releases` | **12** `/items` + **5** `/me` | **1** | snapshot + págs. de `/items` de «w three» | pistas de «w three» | **medida en vivo el 2026-09-30** |
| ↳ lo que predice el código | 1 + ceil(W/100) = **32** **+ 2 + ceil(Hd/100)** | ídem | «w three» + ocultos («descubrir»), el MISMO store que `#discover-artists` | ídem | leída del código |
| ↳ **+2 desde v=278** (ocultar artistas) → **45** | **45** | ídem | **+ la playlist de ocultos («recomendados»)**: `1 /playlists/{id}` + `ceil(Ha/100)`; el `/me` ya lo pagó `hiddenAlbums` | nº de artistas ocultos (**12** el 06/10) | **medida el 2026-10-07 contra una Spotify simulada** con la forma de Ian (ids de playlist guardados, 12 dentro): 5 → 7 peticiones, **+2 exactos**. En vivo, no |
| ↳ 🟩 **los ocultos, medidos (v=299)**: frío **13**, caliente **3** (v=298: 13 y **13**) | **3** | **13** | ídem que `#discover-artists`, sin `/me/albums` ni `/me/playlists` (en el banco ya los había pagado otra carga) | ídem | **medida en el banco el 2026-10-13**, igual que la fila de `#discover-artists`. Abierta **después** de `#discover-artists` en la misma carga suma **0**, en v=298 y en v=299 (los almacenes comparten el `ready()`) |
| **Limpieza** | | | | | |
| `#sync` | **~285** | **2** | `ceil(L/50)` + `ceil(P/50)` + 1 `/items?limit=1` + 1 snapshot + `ceil(T/100)` | me gusta **y** pistas de la espejo | leída del código · **`/me` repasado el 2026-10-08**: su `render()` no llega a `getCurrentUserId()` |
| `#dedupe` | **ceil(P/50) + 1** = **3** | **0–1** | `/me/playlists` + 1 `/me` | nº de playlists | leída del código · **`/me` repasado el 2026-10-08**: el `getCurrentUserId()` de `dedupe.js:22` está en `loadAndShowGrid()`, que cuelga de `render()`. **El 1 `/me` que la fila ya contaba es el propio**, y está bien |
| `#zombies` | **0** | **0** | — (todo detrás de «Analizar») | — | leída del código · **`/me` repasado el 2026-10-08**: su `render()` no llega a `getCurrentUserId()` |
| `#versions` | **0** | **0** | — (detrás de «Analizar») | — | leída del código · **`/me` repasado el 2026-10-08**: su `render()` no llega a `getCurrentUserId()` · 🟩 **medida en el banco el 2026-10-20** (`tests/banco/versiones-deluxe.html`, Spotify simulada): abrir = **0** peticiones, con v=322 y con v=323 |
| ↳ **al pulsar «Analizar»** (v=323, con la propuesta de edición): **ceil(L/50)** págs. de `/me/tracks` en frío, **0** con la caché de me gusta | — | **0** | `/me/tracks` paginado (lo de siempre); la propuesta es una cuenta pura sobre lo ya bajado | nº de me gusta | **medida en el banco el 2026-10-20**: 54 me gusta inventados → **2** `GET /me/tracks`, las MISMAS que con v=322; 0 escrituras. «Aceptar propuesta» = **0** |
| `#zeroplays` | **2 + ceil(Hz/100)** | ídem | **1 `/me` propio** + 1 `/playlists/{id}` + la playlist de ocultos («sin plays») | **nº de ocultos de esta vista** | ✅ **confirmada el 2026-10-08, leída del código**: `render()` → `analyze()` → `Promise.all([getBestAvailableLikes(), loadTrackPlays()])` + `hiddenTracks.ready()`. Los dos caminos llegan al `/me`, pero **comparten el memo**: es 1, no 2. La fila ya estaba bien |
| `#sin-clasificar` | **1 + ceil(P/50) + Σ(1 + ceil(Tᵢ/100)) + ocultos** ≈ **170+** | **2** (dentro de las 24 h del cruce) · **4** si además venció la lista de playlists | caliente: 1 `/me` propio + 1 `/playlists/{id}` del almacén de ocultos («sin clasificar»; 0 págs. con su caché de items al día) · + `ceil(P/50)` = 2 de `/me/playlists` **solo** si su caché de `localStorage` (24 h, otro reloj que el del cruce) venció | nº de playlists propias **y** su tamaño (en frío) · en caliente, **qué caché venció** | 🔴 **corregida el 2026-10-15, leída del código (no medida).** `load()` (`sin-clasificar.js:219`): `getBestAvailableLikes()` = 0; `hidden.ready()` (`:247`) y `getCurrentUserId()` (`:249`) comparten el memo (1 `/me`); `getAllUserPlaylists()` (`:251`) va ANTES de mirar el cruce y tiene su propio TTL de 24 h (`CACHE_TTL_MIN`, `api.js:32`); el cruce es `idbGetCached(CROSS_KEY)` (`:273`) con `CROSS_TTL_MIN = 24 * 60` (`:45`): dentro de las 24 h y con las mismas playlists a cruzar, **no se baja ninguna playlist**. Sin el `/me` del arranque |
| ↳ lo que decía antes: **~45** en caliente | | | lo que cuesta **fuera** de las 24 h, no dentro: el cruce vencido re-valida cada playlist | | leída del código (hasta el 2026-10-15) |
| ↳ **caliente, con el cruce VENCIDO (más de 24 h)**: **2 + (0–2) + N** ≈ **36–38** | | | lo de arriba + `scanPlaylists()`: **1** `/playlists/{id}?fields=snapshot_id` por cada playlist a cruzar (**N ≈ 34** = 42 propias − 2 excluidas de fábrica, «anothertwo» y «w three» − 6 de ocultos), más **todas las páginas** de cada una cuyo snapshot cambió | nº de playlists a cruzar y cuáles cambiaron | **leída del código el 2026-10-15**, no medida. N sale del censo del 08/10 (42 propias, 6 de ocultos) y de `DEFAULT_EXCLUDED_NAMES`: si Ian excluyó o creó otras, N es otro |
| ↳ **al pulsar «Actualizar»** (en la misma carga): **(0–2) + N** ≈ **34–36** | | | borra el cruce (`idbDel(CROSS_KEY)`, `:630`) y repite `load({ force: true })`: el `/me` y el almacén de ocultos ya están en memoria (0); `/me/playlists` 0 o 2 según su caché; y el escaneo de arriba | ídem | **leída del código el 2026-10-15**, no medida |
| `#skips` | **2 + ceil(Hk/100)** | ídem | **1 `/me` propio** + 1 `/playlists/{id}` + la playlist de ocultos («skips») | **nº de ocultos de esta vista** | ✅ **confirmada el 2026-10-08, leída del código**: `render()` → `analyze()` → `Promise.all([getBestAvailableLikes(), loadSkipStats()])` + `hiddenTracks.ready()`, mismo memo. La fila ya estaba bien |

**La ficha de canción (v=311, no es una vista del menú: la abren diez)**: abrirla cuesta lo de siempre y
**0 a lrclib.net**. Tocar «Letra» = **1** `GET lrclib.net/api/get` (**2** si el primero es un 503: el único
reintento automático), **0** a Spotify; la segunda vez del mismo tema, **0** (sale de `letras_v1_<trackId>`).
Medido en el banco `letras` (lrclib simulado) y, con 5 temas, contra el de verdad. Ver «🎤 Letras (v=311)».

**Arrancar la app: 1 `/v1/me`** — *medido dos veces en producción el 07/10, y
confirmado leyendo el código el 07/10*. **Es 1 a secas**: ni 3 que se deduplican
ni 3 de los que dos salen más tarde.

🟥 **Hasta hoy esta línea decía 3, y las tres razones que daba eran falsas.**
Corregido leyendo el camino entero de `init()`:

| lo que decía | qué pasa de verdad |
|---|---|
| `init()` dispara 1 (`testConnection()`) | ✅ cierto, y es la única. `app.js:257` hace un `fetch` crudo a `https://api.spotify.com/v1/me` |
| «otra es `getCurrentUserId()`» | 🟥 **no está en el camino de arranque.** `init()` reusa el perfil de esa misma respuesta (`await res.json()` → `showApp(profile)`); no la vuelve a pedir |
| «otra es el perfil, que la primera vista pide vía `isOwner()`» | 🟥 **doblemente falso.** (a) La primera vista es `#home` (`router.js`: `hash.slice(1) \|\| 'home'`) y `renderHome()` es HTML puro, **0 peticiones**. (b) `isOwner()` no pide el perfil: llama a `getCurrentUserId()`, que quiere el **id**, no el perfil |

⚠️ **Y `getUserProfile()` (`api.js:1042`), que sería el tercer `/me`, NO LA LLAMA
NADIE.** Está exportada y no tiene un solo llamador en todo el repo —src, docs,
tests y bancos— (verificado con grep el 07/10). Es código muerto, y es
probablemente de donde salió el 3.

**Dónde aparece el segundo `/me`, que existe pero no es del arranque.** La
primera vista que necesite el id del usuario llama a `getCurrentUserId()`, que
hace su propio `GET /me` y lo **memoiza** en `_cachedUserId` (`api.js:1046`). O
sea:

- arrancar y quedarse en `#home` → **1** y nada más;
- arrancar y entrar a una vista que pregunte quién sos (`#covers`, `#wthree`,
  `#listened`, cualquier almacén de ocultos…) → **2 en total**, y de ahí en
  adelante **ningún `/me` más en esa carga de página**, por la memoización.

Por eso la medición del 07/10 dio 1: se comprobó que la app arranca y que el
inicio pinta sus 24 tarjetas, que es exactamente el caso de `#home`.

**0 escrituras en la cuenta en las 24.** Ninguna apertura hace `PUT`, `POST` ni
`DELETE`: lo verifica `tests/sin-escaneo-automatico.test.mjs` para las dos de
descubrir, y para el resto la escritura siempre cuelga de un botón con cartel.

### ⚠️ Los dos costos escondidos — acá se fue el presupuesto del 04/10

**1. `buildAlbumHeardIndex()`** (`util/album-heard.js`). Parece local y **pega a
`getAllPlaylistItems(«w three»)`**. Es lo ÚNICO que gastan `#discover-artists` y
`#new-releases` al abrirse — ni una petición de discografías, que es lo que
arregló v=261. Tiene memo de módulo (`cache`), así que **la segunda vista de
descubrir de la misma carga de página sale gratis**: abrir las dos cuesta lo que
una.

**2. `hiddenStore.ready()`** (`util/hidden-sync.js`), y éste es el que explica el
desborde de 48 de 12. Al abrir `#wthree` (y `#skips`, `#zeroplays`,
`#sin-clasificar`) se dispara una vez por sesión de página y cuesta:

```
1 /me  +  1 /playlists/{id}?fields=id,name,owner(id)  +  ceil(H/100) /items
```

🟩 **Desde v=299 eso es en FRÍO.** En caliente (snapshot igual y caché de menos
de 24 h) el almacén cuesta **`1 /playlists/{id}`** y ninguna página: pasa de
`1 + ceil(H/100)` a `1` (más el `/me`, si es el primero de la carga). Medido en
el banco solo para `#discover-artists` y `#new-releases` (ver sus filas). Para
`#wthree`, `#skips`, `#zeroplays` y `#sin-clasificar` es **leído del código**: la
pieza es la misma, pero esas cuatro vistas no se midieron.

🟥 **Corrección del 06/10: `#recs` NO estaba en esa lista y acá decía que sí.**
Su `hiddenArtists.ready()` vive dentro de `run()` —la función del botón «Buscar
recomendaciones»—, no de `render()`, así que **abrir `#recs` cuesta 0**, como ya
decía su fila de la tabla. Las dos mitades de este documento se contradecían y la
fila era la que tenía razón. Y de paso dejó el patrón que v=276 copió: **el
`ready()` de un almacén va detrás del acto del usuario**, y así una vista que
cuesta 0 sigue costando 0 aunque gane ocultos. Es lo que mantiene `#similar` en 0.

⚠️ **El `/me` es 1 solo por sesión de página, no uno por almacén**:
`getCurrentUserId()` está memoizado. Así que el PRIMER almacén de una carga paga
`1 + 1 + ceil(H/100)` y cada almacén siguiente paga `1 + ceil(H/100)`. Es por eso
que sumarle a `#discover-artists` el almacén de artistas cuesta **+2** y no +3:
el `/me` ya lo pagó `hiddenAlbums`.

🟩 **Ese último ya no re-pagina en cada carga (v=299).** Hasta v=298 `sync()`
iba con `useCache: false` y bajaba la playlist de ocultos ENTERA en cada sesión
de página, en frío y en caliente. El `useCache: false` sigue (la reconciliación
necesita el estado real: una clave local que falta en lo bajado se re-sube, y una
lista vieja se ve como **pistas duplicadas en la cuenta**), pero ahora solo se
llama cuando hace falta. Las reglas viven en `util/hidden-sync.js` («El caché de
los items de la playlist espejo»):

- **El snapshot sale gratis**: `findPlaylist()` le suma `snapshot_id` a los
  `fields` del `GET /playlists/{id guardado}` que ya hacía. **Ese es el único
  snapshot que vale.** Si la playlist se encontró por nombre no hay snapshot: se
  baja entera y no se guarda. Nunca el de `getAllUserPlaylists()` (24 h en
  localStorage: un snapshot de ayer validaría items de ayer).
- **Caché propio**, `ocultos_items_v1_<playlistId>` = `{ snapshot, items,
  guardadoEn }`. No la clave de items de `getAllPlaylistItems` ni
  `updatePlaylistItemsCache()`: esa la escriben `#sin-clasificar` y los barridos
  para las mismas playlists, y dos dueños de una clave terminan contestando
  distinto. «Limpiar caché» lo borra (no está en `CONSERVAR_PREFIJOS`; el `local_` de
  v=300 no lo cubre), y desde v=300 también el cambio de usuario.
- **Antes de cada escritura se BORRA** (las cuatro de `hidden-sync.js`). Ver la
  regla en «Los ocultos: la uri va GUARDADA con la clave». Un `sync()` que
  estaba bajando cuando arrancó una escritura no guarda lo que bajó.
- **Vence a las 24 h** aunque el snapshot coincida: el snapshot va retrasado
  tras una escritura, sin cota conocida.
- **`auditar()` (`#debug` → «Salud de los ocultos») no cambió**: sigue con
  `useCache: false` y no lee ni escribe el caché.

**El precio que se acepta:** si la otra compu oculta algo y este navegador carga
mientras Spotify todavía devuelve el snapshot viejo, ese oculto aparece en la
carga siguiente en que el snapshot avance, o a las 24 h como mucho. No se pierde:
llega tarde. Hasta v=298 llegaba al instante.

**Lo que NO arregla:** si en la otra compu **devolvés** un oculto, este
navegador lo sigue teniendo en local y en el `sync()` siguiente lo vuelve a
subir (`perdidas`). Pasaba igual con `useCache: false`: es la unión.
`tests/ocultos-cache.test.mjs` (C7) afirma que con el caché hace exactamente las
mismas peticiones que v=298 en ese caso.

⚠️ Hay un QUINTO escritor que no pasa por acá: `#zombies` puede sacar pistas de
cualquier playlist propia, incluidas estas (`features/zombies.js`). No borra el
caché, y no hace falta para no duplicar: su DELETE mueve el snapshot, la carga
siguiente baja la lista y pasa lo mismo que en v=298 (la pista sigue en local y
se re-sube, por la unión); si el snapshot todavía no avanzó, el caché tiene una
pista de más que también está en local, así que no se re-sube nada hasta que
avance.

Guardas: `tests/ocultos-cache.test.mjs` (C1-C8 y la lectura estática; el doble de
la API tiene snapshot-contador, retraso y «otro dispositivo») y el banco
`tests/banco/ocultos-cache.html` (en `prepush`).

⚠️ **Hay SEIS almacenes de ocultos y cada uno tiene su PROPIA playlist.**
No se comparten: **cada vista paga el suyo**. Censo completo, leído del código y
medido en el navegador de Ian el **06/10** (`localStorage`, solo lectura):

| `lsKey` | vista(s) | la clave es | playlist (id) | ocultos | `ready()` en frío |
|---|---|---|---|---:|---:|
| `discover_ocultos` | `#discover-artists`, `#new-releases` | **álbum** (`cardKey`) | `… (descubrir)` `6WqWZy4GVLnsirTTZdRePF` | **900** | 2 + 9 = **11** |
| `recs_ocultos` | `#recs` y, desde v=276, `#similar` · `#discover-artists` · `#follow-artists`; desde v=278 también `#new-releases` | **nombre de ARTISTA en minúsculas** | `… (recomendados)` `6mOmj0KG72NmSluJCEx1Uf` | **12** | 2 + 1 = **3** |
| `wthree_hidden_albums` | `#wthree` | **álbum** (`albumKey`) | `… (álbumes)` `22e2RS9m2FYXajjDM3v7W9` | 17 | **3** |
| `skips_hidden_tracks` | `#skips` | **id de pista** | `… (skips)` `7rJDSnMWX5ag5NWxsG7Y3B` | 88 | **3** |
| `zeroplays_hidden_tracks` | `#zeroplays` | **id de pista** | `… (sin plays)` `6hviqLfTsqOpyWtod2Eg0P` | 25 | **3** |
| `sin_clasificar_ocultas` | `#sin-clasificar` | **id de pista** | `… (sin clasificar)` `2zP8yXCfWmelwsOoYm8REz` | 0 | **2** |

Y los dos que **no** son de éstos, para que nadie los cuente como séptimo ni
octavo: `discover_escuchados` (**178**, `createLocalStore`, **0 peticiones**, solo
navegador) y `listened_unreg_dismissed` (**78**, un `Set` crudo en
`features/listened.js`, no pasa por `hidden-sync.js`). Los dos de descubrir sí
comparten `hiddenAlbums`, así que entre `#discover-artists` y `#new-releases`
solo paga la primera de la sesión de página. Los `H` de la tabla son el nº de
ocultos **de ese almacén**, no un total: los **78 de `listened_unreg_dismissed`**
viven aparte y ni siquiera usan `hidden-sync.js` (es un `Set` crudo en
`features/listened.js`).

🟥 **Y el «439 de novedades» era un número viejo: son 900.** Censado en el
navegador de Ian el **06/10**, leyendo `localStorage`: `discover_ocultos` tiene
**900 claves** (899 con uri), que es el almacén que comparten
`#discover-artists` y `#new-releases`. O sea `Hd = 900` → `ceil(899/100) = 9`
páginas, no 5. Quien presupueste esas dos vistas tiene que usar **9**.

🟥 **Y ésta fue mi propia corrección a mitad de camino**: `#skips` y `#zeroplays`
los tenía anotados en **0** por usar sólo `getBestAvailableLikes()`, y no lo son
— `hiddenTracks.ready()` va en el mismo `Promise.all` que los likes. Leer los
`import` de una vista NO alcanza para costearla: hay que leer el cuerpo de
`render()`, y éste es exactamente el error que produce un presupuesto de 12.

🟩 **Con esto, la fila medida de `#wthree` CUADRA con el código**: los **45**
`/items` del 04/10 son **31 de «w three»** (3.011 pistas) **+ 14 de la playlist
de ocultos**, exactamente como anotó `PENDIENTES.md` ese día («más las de
ocultos»). No hay misterio ni número viejo: la cuenta cierra.

⚠️ **La que NO cuadra es `#new-releases`: midió 12 `/items` y el código predice
32.** Lo más probable es que ese día el caché de «w three» estuviera parcialmente
puesto, pero **no se verificó y no se va a inventar**: para presupuestar
`#new-releases` usá **32**, el número leído, que es el techo.

### El ranking, para presupuestar

**Las tres más caras de abrir** (en frío), y las tres por la MISMA razón —su
`render()` arranca el análisis solo, sin que nadie apriete nada:

1. `#sync` ≈ **285** — `#sync` lo dice en un comentario: «`render()` la dispara sola».
2. `#sin-clasificar` ≈ **170+** — las 42 playlists propias, una por una.
3. `#smart` = **191** — `ceil(L/50)`, la biblioteca entera.

**Las tres más baratas**, y las **12 vistas que cuestan 0 en frío Y en caliente**:
`#dashboard`, `#wrapped` (con historial), `#records`, `#mosaico`, `#search`,
`#byartist`, `#genre`, `#similar`, `#rabbit`, `#recs`, `#zombies`, `#versions`.
Lo son porque dejan el trabajo detrás de un botón, o porque leen con
`getBestAvailableLikes()`. Entre ellas, las **gratis de verdad** —0 peticiones y
sin depender de ningún caché remoto— son **`#mosaico`** (documentado: no pega a
`api.spotify.com` ni una vez), **`#search`** y **`#byartist`**.

⚠️ **Lo caro no es el tamaño de la biblioteca: es quién dispara el análisis.**
`#zombies` y `#versions` recorren lo mismo que `#sync` y cuestan **0** al abrirse,
porque esperan que aprietes «Analizar».


## 🤝 Qué anda sin los datos de Ian — censo para compartir la app (2026-10-06)

Para la pregunta de Ian: *«si le paso la app a un amigo, qué le funciona».*
Censo **leído del código, 0 peticiones**. Nadie cambió de comportamiento acá.

### Los cinco insumos

| insumo | qué es | cómo lo consigue un amigo |
|---|---|---|
| **login** | el OAuth de Spotify | entra y listo |
| **caché de likes** | `idb`, sin caducidad | abrir `#dashboard` y «Cargar desde Spotify» (`ceil(L/50)` peticiones, una vez) |
| **historial extendido** | los `data/history-*.json` | **NO los hereda** (ver abajo): tiene que subir su propio ZIP por «Mi historial» |
| **playlist «listened albums»** | la elige a mano | `#listened` → «Cambiar playlist» |
| **playlist «w three»** | la elige a mano | `#wthree` → setup |

⚠️ **El historial horneado es de Ian y está cerrado con llave.** `isOwner()`
compara contra `HISTORY_OWNER_ID`, y el candado está en `loadOne()`
(`features/history-data.js`), **donde se entregan los datos, no donde se dibuja
el cartel** — arreglarlo solo en `isOwner()` no cerraba nada (v=190). Un amigo
**no ve ni un dato de escucha de Ian**, y eso es deliberado.

🟩 **Pero BYOH funciona para cualquiera.** Sube su *Extended Streaming History*
(ZIP) y `processStreamingHistory()` le produce **los siete** juegos de datos
(`stats`, `plays`, `listened`, `skip`, `detail`, `records`, `artistTracks`),
guardados en `localKey(uid, …)` — su IDB, su navegador, nada sale de su compu.
O sea que las vistas de historial **no están rotas para él: están vacías hasta
que importe.**

### 🖼️ De dónde salen las 5.715 portadas de `mosaico_colores_v1` (censo del 2026-10-07)

M.4 del encargo del 07/10, para la pregunta de Ian: *«¿un amigo puede armar su
propio mosaico?»*. **Censo: no se cambió ni una línea.** Leído de
`armarCatalogo()` (`features/mosaico-colores.js`) y cotejado en el navegador de
Ian contra la base guardada. **0 peticiones a `api.spotify.com`**; el censo de
IndexedDB dio el MISMO SHA-256 antes y después (`17ef5bb6…`, 1.055 claves).

**El catálogo tiene DOS patas, y solo dos:**

| pata | de dónde sale | filas | `coverId` únicos |
|---|---|---:|---:|
| **álbumes escuchados** | `loadListenedAlbums()` → `data/history-listened-albums.json` | **2.492** | **2.475** |
| **me gusta** | `getBestAvailableLikes()` → el caché `all_liked_tracks` | **9.176** | **4.739** (6 sin tapa) |
| | en las dos a la vez | | **1.498** |
| | **unión** | | **5.716** |

🟥 **NO entran las discografías escaneadas.** `discover_disco_base_v1_*` (353 en
el navegador de Ian) no se lee en ningún punto de `armarCatalogo()`. Tampoco
«w three»: está descartado a propósito, porque pedir esa playlist costaría
peticiones a la API y el mosaico vale **0**. Y no se pasa por el `buildList()` de
`covers.js`, que contesta otra pregunta (qué ÁLBUMES pintar, fusionando por
nombre antes que por imagen).

**«Única» es por `coverId`** (`util/album-key.js`): los 24 hex del final de la
URL de la tapa, o sea el hash de la imagen. Dos álbumes distintos con la misma
portada son UNA tesela, que para un mosaico es lo correcto.

#### El 5.715 contra el 5.716, y el 2.543 que no es de aquí

- **5.716 − 5.715 = 1.** La que falta es `lostrushi — REAL DILLA`
  (`8c4a0027…`), **un me gusta del 05/10**: la base se construyó el **27/09** y
  no se ha vuelto a pasar. Es el único `added_at` posterior a esa fecha en el
  caché de likes, y la base es reanudable — una tanda más en `#debug` la deja en
  5.716. `fallidas` está en **0**: no falló nada, sencillamente llegó después.
- 🟥 **Los «2.543 álbumes escuchados» NO son de esta vista.** Ése es el total de
  **`#covers`** (historial ∪ «w three», fusionado por nombre de álbum: 2.469 + 74
  sin fecha, medido en M.5 el 07/10). Lo que el mosaico come del historial son
  **2.492 filas → 2.475 tapas únicas**. Los dos números describen cosas
  distintas y no hay que cuadrarlos.

#### La prueba empírica: el host de cada portada parte el catálogo en dos

La base guarda de qué host bajó cada miniatura, y el reparto **coincide exacto**
con las dos patas, sin que nadie lo haya programado así:

| host | portadas | qué es |
|---|---:|---|
| `image-cdn-ak.spotifycdn.com` | 1.997 | las URL que trae el JSON del historial |
| `image-cdn-fa.spotifycdn.com` | 478 | ídem · **1.997 + 478 = 2.475 = la pata «escuchadas»** |
| `i.scdn.co` | 3.240 | las URL que devuelve la API en vivo · **= 3.241 solo-likes − la que falta** |

Las 1.498 compartidas caen del lado de `image-cdn-*` porque `armarCatalogo()`
recorre **primero** el historial y `anotar()` conserva la primera URL que vio.

#### Qué ve alguien que solo tiene login

🟥 **Nada: el catálogo le da CERO portadas**, y las dos patas se le caen por
motivos distintos.

1. **El historial no lo hereda.** `loadListenedAlbums()` pasa por `loadOne()`,
   que con `uid !== HISTORY_OWNER_ID` y sin BYOH hace `return null` **antes** de
   mirar ningún dato. Es el candado de v=190, y es deliberado.
2. **El caché de likes nace vacío.** `getBestAvailableLikes()` tiene
   `allowFetch: false` por defecto y **nadie en el repo pasa `true`**: en frío
   devuelve `{ items: [], source: 'empty' }` sin pedir nada.

Así que `#mosaico` le enseña **«Todavía no hay base de colores»** y los controles
ni se muestran (`features/mosaico.js`, la guarda de `reg.ids?.length`).

**Lo que sí puede hacer, en dos pasos y sin trampa:**

- **Cargar sus likes** (`#dashboard` → «Cargar desde Spotify», `ceil(L/50)`
  peticiones, una vez) y **construir la base en `#debug`** → «Base de colores del
  mosaico». Ese botón **no tiene candado de owner**, y lo que baja va al CDN de
  imágenes, que no gasta cuota. Su mosaico sale hecho **solo con las tapas de sus
  me gusta**.
  ⚠️ `#debug` **no está en el menú**: hay que escribir el hash en la URL.
- **Sumar la pata de escuchados** importando su propio ZIP de *Extended Streaming
  History* («Mi historial» → `openImportHistory`). `loadOne()` busca
  `localKey(uid, 'listened')` **para cualquier usuario** antes de preguntar por el
  owner, así que con BYOH el mosaico de un amigo gana sus álbumes escuchados.
  🟩 Es, de hecho, la única vista de las dos de tapas que BYOH sí abre: `#covers`
  y `#wthree` quedan bloqueadas igual (ver los dos candados, más abajo).

🟩 **Respuesta corta para Ian: sí, un amigo puede armar su propio mosaico, y le
cuesta una carga de likes.** Lo que no puede es usar las tuyas.

### Las 24 vistas, por lo que necesitan

| vista | con solo login | necesita además | sin eso, qué pasa | capa |
|---|:---:|---|---|---|
| `#dashboard` | ✅ | — | anda entero; es la puerta para cargar los likes | leída del código |
| `#smart` | ✅ | — | anda (se baja los likes solo) | leída del código |
| `#sync` | ✅ | — | anda | leída del código |
| `#dedupe` | ✅ | — | anda | leída del código |
| `#zombies` | ✅ | — | anda | leída del código |
| `#versions` | ✅ | — | anda | leída del código |
| `#sin-clasificar` | ✅ | — | anda | leída del código |
| `#mosaico` | — | **base de colores** (`mosaico_colores_v1`), y antes **el caché de likes**: sin él el catálogo da **0 portadas** (ver el censo de arriba) | «Todavía no hay base de colores»; se construye en `#debug` (que no está en el menú), sin cuota de Spotify | leída del código **y medida el 2026-10-07** |
| `#search` | — | caché de likes | cartel: «No hay likes cacheados» + link al Dashboard | leída del código |
| `#byartist` | — | caché de likes | cartel con botón de carga | leída del código |
| `#genre` | — | caché de likes · stats.fm opcional | cartel | leída del código |
| `#similar` | — | **API key de Last.fm** | pide la key en un input | leída del código |
| `#rabbit` | — | **API key de Last.fm** | pide la key | leída del código |
| `#recs` | — | **API key de Last.fm** + caché de likes | pide la key | leída del código |
| `#discover-artists` | — | base de discografías (escaneo propio) | pinta vacío + «Elegir más artistas…» | leída del código |
| `#new-releases` | — | base de discografías | ídem | leída del código |
| `#follow-artists` | — | base + caché de likes + scope `user-follow-modify` | «No hay discografías guardadas en este navegador» | leída del código |
| `#listened` | — | **playlist «listened albums»** elegida | pantalla de «no configurada» con selector | leída del código |
| `#wthree` | — | **ser Ian** (candado por adelantado) + playlist «w three» | bloqueada SIEMPRE: ⚠️ **BYOH no la abre** (ver abajo) | leída del código |
| `#covers` | — | **ser Ian** (candado por adelantado) | bloqueada SIEMPRE: ⚠️ **BYOH no la abre** (ver abajo) | leída del código |
| `#wrapped` | — | **historial**; sin él cae a `renderLite` (2 × `/me/top`) | Wrapped lite, más pobre pero anda | leída del código |
| `#records` | — | **historial** | cartel de bloqueo | leída del código |
| `#calendario` | — | **historial** (`years[].days`) para la grilla · el **detalle por día** para el panel | cartel de bloqueo, el mismo de `#records` con su botón de importar. Con BYOH la grilla sale de SU `stats` y el detalle lo obtiene solo (`saveMyHistory()` guarda `days`). El owner carga el detalle con la importación «solo el detalle»; sin él, el panel enseña los minutos del día y ofrece cargarlo | **leída del código y probada en el banco el 2026-10-10** |
| `#mapa` (v=304) | — | **historial** (`artistTracks`) · y buscar los países en MusicBrainz (un botón, sin cuota de Spotify) | cartel de bloqueo, el mismo de `#records` (candado de «pide los datos primero»: BYOH la abre), **sin botón de buscar**. Con datos, la lista sale vacía hasta apretar «Buscar países» | **leída del código y probada en el banco el 2026-10-14** (solo el owner; el amigo, leída) |
| `#puertas` (v=308) | — | **historial** (`artistTracks` **v3**: con el tema de entrada) | cartel de bloqueo, el mismo de `#records` (BYOH la abre con SUS datos). Con un historial importado antes de v=308 (sin el tema de entrada): «Para ver esto, vuelve a importar tu historial», con el botón de importar y 0 filas | **medida en el banco el 2026-10-15** (`tests/banco/puertas.html`: el owner, un amigo con su v3, uno con un historial viejo y uno sin datos) |
| `#generos` (v=313; los géneros, v=314) | — | **historial** (`artistTracks`, cualquier versión: solo lee los minutos y los nombres) · y buscar en Last.fm (un botón, sin cuota de Spotify, con la key del código) | cartel de bloqueo, el mismo de `#records` (BYOH la abre con SUS datos), **sin botón de buscar**. Con datos, las cinco filas, «Tus 10 géneros» (vacío, con una línea, hasta que la búsqueda traiga alguno) y «Buscar géneros». Si no se pueden leer las etiquetas guardadas, lo dice y no ofrece buscar | **medida en el banco el 2026-10-17** (solo el owner; el amigo, leída del código) |
| `#mapa-artistas` (v=315) | — | **historial** (`artistTracks`) **y el mapa horneado**, que es SOLO del owner (`history-artist-similares.json`: ni `gen-stats.py` ni el import BYOH lo producen) | sin historial, el cartel de bloqueo de `#records`; **con historial y sin mapa (un amigo con su BYOH), una línea: «El mapa todavía no existe para tu historial.»** y nada más | **medida en el banco el 2026-10-18** (el owner, un amigo con historial y sin mapa, uno sin nada) |
| `#zeroplays` | — | **historial** (`plays`) · stats.fm opcional | cartel de bloqueo | leída del código |
| `#skips` | — | **historial** (`skip`, versión ≥ 4) · stats.fm opcional | cartel de bloqueo | leída del código |

### ⚠️ Dos candados distintos, y la diferencia es la respuesta a la pregunta

Las seis vistas de historial **no se cierran todas igual**, y mezclarlas daba una
respuesta falsa:

| forma del candado | vistas | ¿BYOH la abre? |
|---|---|:---:|
| **pide los DATOS primero**, y recién si vienen vacíos pregunta por el owner | `#wrapped`, `#records`, `#zeroplays`, `#skips` (y `#mapa`, v=304, y `#puertas`, v=308) | **sí** |
| **`isOwner()` por adelantado**, antes de tocar un solo dato, y `return` | `#covers`, `#wthree` | **NO** |

En `#covers` (`covers.js:323`) y `#wthree` (`wthree.js:223`) lo primero que hace
`render()` es `const propio = await isOwner(); if (!propio) { … return; }`. El
amigo ve la tarjeta de bloqueo **aunque haya importado su ZIP entero**, porque la
vista nunca llega a preguntar si hay datos. No es un bug declarado en ninguna
parte: es el candado de v=190 aplicado un paso más arriba que en las otras cuatro.
**Si Ian quiere que un amigo use «Mis tapas» o W-Three, hay que mover esas dos
guardas de `isOwner()` a «¿hay datos?», como las otras cuatro.** No se tocó nada:
esta tanda es un censo.

### El resumen que Ian pidió

- **7 de 24 andan con solo el login**: `#dashboard`, `#smart`, `#sync`, `#dedupe`,
  `#zombies`, `#versions`, `#sin-clasificar`. Ninguna «sin determinar».
- **3 más** con un paso de un minuto (cargar los likes): `#search`, `#byartist`, `#genre`.
- **1** con un paso que no gasta cuota de Spotify: `#mosaico` (base de colores en `#debug`).
- **4 se abren con BYOH**: `#wrapped`, `#records`, `#zeroplays`, `#skips`
  — y `#wrapped` da algo (`renderLite`, 2 × `/me/top`) incluso sin nada.
- **2 NO se abren con nada**: `#covers` y `#wthree`, por el candado de arriba.
- **3 esperan una key de Last.fm** (`#similar`, `#rabbit`, `#recs`), gratis y ajena a Spotify.
- **1 espera que elija una playlist**: `#listened`.
- **3 esperan que escanee artistas** (`#discover-artists`, `#new-releases`,
  `#follow-artists`), que es lo único que le cuesta cuota de verdad.

🟩 **Ninguna vista se rompe sin los datos de Ian: las 24 degradan con un cartel
que dice qué falta.** Eso no es casualidad, es la regla que v=190 y v=178 dejaron
escrita, y conviene no aflojarla. 🟥 Pero «no se rompe» no es «se puede usar»:
para `#covers` y `#wthree` el cartel es el techo.

