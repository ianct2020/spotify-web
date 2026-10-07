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
- **Guardar un ÁLBUM**: `PUT /me/library?uris=spotify:album:{id}` — **verificado en vivo 2026-08-18** con el ciclo completo sobre «Kind Of Blue» (`GET /me/albums` 33 → 34 → 33). `PUT /me/albums` da **403** en las DOS formas (body `{ids}` y query `?ids=`), y `GET /me/albums/contains?ids=` también da 403: para preguntar va `GET /me/library/contains?uris=spotify:album:{id}` → `[bool]`. `GET /me/albums` sí vive (lectura, paginado, con `added_at`). **La regla general**: `/me/library` es la ruta UNIFICADA post-migración y lo que cambia es el TIPO de la uri, no la ruta; las rutas por recurso (`/me/tracks`, `/me/albums`) quedaron para leer. Chunks de 40 como el resto. Ojo: **guardar el álbum NO likea sus pistas** y likear las pistas NO hace aparecer el disco en `/me/albums` — son dos escrituras distintas, y hasta v=147 la app tenía un solo botón («+ Biblioteca») que hacía lo segundo con nombre de lo primero.
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
- `GET /artists/{id}/albums`: **el limit máximo bajó a 10** (re-verificado en vivo 2026-08-11: `limit` 11..20 devuelven 400 "Invalid limit", `limit=10` devuelve 200 y pagina bien con `next`/`offset` — Taylor Swift, `total: 112`). Antes (2026-08-05) 20 andaba. Nunca mandar `market=from_token`. Usado en `#discover-artists` y `#new-releases`. **Cuota propia (medido 2026-09-16, v=225): 429 `QUOTA_EXCEEDED` después de exactamente 100 requests en ~33 s (~20 artistas), y sigue en 429 más de 23 minutos. Es SOLO ese endpoint**: en el mismo minuto `/artists/{id}`, `/albums/{id}/tracks`, `/search` y `/me` dan 200. `Retry-After` ilegible (solo se leen `cache-control` y `content-type`). `getArtistAlbumsConFuente()` (api.js, v=226) va sin reintentos; ante 429 pone el nativo en **pausa de 5 min que se dobla** (tope 60) y mientras tanto usa `/search?q=artist:"X"&type=album`; ante 400/403 lo abandona para la sesión y lo dice en pantalla. **La app corta `/search` en 40** (`SEARCH_MAX_PAGES = 4`, no es la API: medido 2026-09-18, sin tope llega al 77 % del nativo y el tope real es `limit + offset ≤ 1000`), y **`/search` tiene su propia cuota**: 429 `QUOTA_EXCEEDED` tras ~700 requests, y la comparte toda la app. Desde v=229 cada discografía vive en la **base sin caducidad** `discover_disco_base_v1_{id}` (unión por id de Spotify, nunca por `albumKey`; ver `util/disco-base.js`), con su fuente y si está cortada, y `#new-releases` avisa cuántas lo están. **Nada puede borrar la base**: «Actualizar» tira solo el caché de escaneo y «Limpiar caché» la conserva; si agregás otro camino que borre IndexedDB, conservá el prefijo `DISCO_BASE_PREFIX`. Se mueve entre máquinas con «Exportar base» / «Importar base». El diagnóstico de la sesión se lee desde la pestaña: `sessionStorage.fonoteca_artist_albums_diag` (o `artistAlbumsDiag` exportado).
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
El criterio `sinescuchar` cruza contra los items de esa playlist —la que escribe
`guardarLanzamiento` para los lanzamientos de menos de 4 pistas—. Verificado en
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
haya nada personal en el staging.

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
- **Nada en silencio.** Cada montón (la playlist perdió algo / nunca subió /
  no se puede representar) lleva `console.warn`, toast y línea en
  `ocultos_incidencias_v1`. Ese registro es la versión de `likes_borrados_log_v1`
  para ocultos, y existe porque de «La La La» no quedó **ninguna** huella.
- **Y `console.warn` no alcanza**: la extensión de Chrome no lo captura (v=163).
  Por eso está `#debug` → «Salud de los ocultos», que compara las seis playlists
  contra el navegador y nombra cada huérfana con su motivo. Si agregás un aviso
  nuevo a este mecanismo, que se pueda mirar desde ahí.

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

Deploy completo: bumpear **`app.js?v=`** de `src/index.html` (desde v=235
`build.sh` reescribe con ese número los demás `?v=`, las hojas incluidas, en
todas las páginas de `docs/`, y desde v=257 también el nombre de caché de
`sw.js`; los otros tres `?v=` de `src/index.html` pueden quedar atrasados) →
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

### Las 24 vistas del menú

| vista | en frío | en caliente | endpoints que dispara | de qué depende | capa |
|---|---:|---:|---|---|---|
| **General** | | | | | |
| `#dashboard` | **0** | **0** | — (stats.fm/Last.fm no son Spotify) | — | leída del código |
| `#wrapped` | **0** | **0** | — con historial | — | leída del código |
| ↳ sin historial (`renderLite`) | **2** | **2** | 2 × `/me/top/{artists,tracks}` | fijo | leída del código |
| `#records` | **0** | **0** | — | — | leída del código |
| `#covers` | **1 + ceil(W/100)** = **32** | **1** | 1 `/playlists/{id}?fields=snapshot_id` + págs. de `/playlists/{id}/items` | nº de pistas de «w three» | leída del código |
| `#mosaico` | **0** | **0** | **ninguno, a propósito** | — | **medida en vivo el 2026-10-06**: 10 mosaicos generados (hasta 43.200 celdas), **0 peticiones y 0 cortadas** con los topes de la API en CERO. Lo que sí sale a la red es el CDN de imágenes, que no gasta cuota |
| `#search` | **0** | **0** | — | — | leída del código |
| `#listened` | **26** `/items` + 3 `/me` | **0** | snapshot + págs. de `/items` | pistas de la playlist elegida | **medida en vivo el 2026-10-04** (caché vencido) |
| ↳ lo que predice el código | 1 + ceil(n/100) | **0** (caché propio en IDB) | ídem | ídem | leída del código |
| **Crear** | | | | | |
| `#smart` | **ceil(L/50)** = **191** | **0** | `/me/tracks` paginado | **nº de me gusta** | leída del código |
| `#byartist` | **0** | **0** | — | — | leída del código |
| `#wthree` | **45** `/playlists/{id}/items` | **~15** | snapshot + págs. de «w three» + **la playlist de ocultos entera** | pistas de la playlist **y nº de ocultos** | **medida en vivo el 2026-10-04** |
| ↳ y el código lo explica | 1 + ceil(W/100) **+ 2 + ceil(H/100)** | ídem | `31` de «w three» + **14 de ocultos** = los 45 medidos | ídem | leída del código |
| `#genre` | **0** | **0** | — (stats.fm no es Spotify) | — | leída del código |
| **Descubrir** | | | | | |
| `#similar` | **0** | **0** | — (la búsqueda es un acto explícito) | — | leída del código |
| ↳ y SIGUE en 0 con ocultar artistas (v=276) | **0** | **0** | el `ready()` del almacén de artistas va dentro de `pickSourceArtist`, no de `render()` | — | leída del código |
| `#rabbit` | **0** | **0** | — | — | leída del código |
| `#recs` | **0** | **0** | — | — | leída del código |
| `#discover-artists` | **32 + 2 + ceil(Hd/100)** = **43** | ídem que el frío menos «w three» | «w three» **+ la playlist de ocultos («descubrir»)** | pistas de «w three» **y nº de ocultos** | leída del código |
| ↳ **+2 desde v=276** (ocultar artistas) → **45** | **45** | ídem | **+ la playlist de ocultos («recomendados»)**: `1 /playlists/{id}` + `ceil(Ha/100)` | nº de artistas ocultos (**12** el 06/10) | leída del código |
| `#follow-artists` | **ceil(A/40)** = **9** | **0** | `/me/library/contains?uris=spotify:artist:…` | **nº de discografías en la base** | leída del código |
| ↳ **+2 desde v=276** (ocultar artistas) → **11** | **2** | **+ la playlist de ocultos («recomendados»)** | ídem que arriba | nº de artistas ocultos | leída del código |
| `#new-releases` | **12** `/items` + **5** `/me` | **1** | snapshot + págs. de `/items` de «w three» | pistas de «w three» | **medida en vivo el 2026-09-30** |
| ↳ lo que predice el código | 1 + ceil(W/100) = **32** **+ 2 + ceil(Hd/100)** | ídem | «w three» + ocultos («descubrir»), el MISMO store que `#discover-artists` | ídem | leída del código |
| ↳ **+2 desde v=278** (ocultar artistas) → **45** | **45** | ídem | **+ la playlist de ocultos («recomendados»)**: `1 /playlists/{id}` + `ceil(Ha/100)`; el `/me` ya lo pagó `hiddenAlbums` | nº de artistas ocultos (**12** el 06/10) | **medida el 2026-10-07 contra una Spotify simulada** con la forma de Ian (ids de playlist guardados, 12 dentro): 5 → 7 peticiones, **+2 exactos**. En vivo, no |
| **Limpieza** | | | | | |
| `#sync` | **~285** | **2** | `ceil(L/50)` + `ceil(P/50)` + 1 `/items?limit=1` + 1 snapshot + `ceil(T/100)` | me gusta **y** pistas de la espejo | leída del código |
| `#dedupe` | **ceil(P/50) + 1** = **3** | **0–1** | `/me/playlists` + 1 `/me` | nº de playlists | leída del código |
| `#zombies` | **0** | **0** | — (todo detrás de «Analizar») | — | leída del código |
| `#versions` | **0** | **0** | — (detrás de «Analizar») | — | leída del código |
| `#zeroplays` | **2 + ceil(Hz/100)** | ídem | 1 `/me` + 1 `/playlists/{id}` + la playlist de ocultos («sin plays») | **nº de ocultos de esta vista** | leída del código |
| `#sin-clasificar` | **1 + ceil(P/50) + Σ(1 + ceil(Tᵢ/100)) + ocultos** ≈ **170+** | **~45** | `/me` + `/me/playlists` + las **42 propias** una por una + su playlist de ocultos | nº de playlists propias **y** su tamaño | leída del código |
| `#skips` | **2 + ceil(Hk/100)** | ídem | 1 `/me` + 1 `/playlists/{id}` + la playlist de ocultos («skips») | **nº de ocultos de esta vista** | leída del código |

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

🟥 **Y ese último va con `useCache: false`**, así que **re-pagina la playlist de
ocultos ENTERA cada sesión de página, en frío y en caliente**: no mira el
`snapshot_id` y no deja caché. Es el único camino de apertura de toda la app que
no se abarata nunca. Si algún día hay que bajar el costo de `#wthree`, éste es
el sitio — pero **ojo: `useCache:false` está puesto a propósito**, porque la
reconciliación de ocultos necesita el estado real de la playlist, no uno
cacheado. No lo cambies sin leer esa sección.

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
| `#zeroplays` | — | **historial** (`plays`) · stats.fm opcional | cartel de bloqueo | leída del código |
| `#skips` | — | **historial** (`skip`, versión ≥ 4) · stats.fm opcional | cartel de bloqueo | leída del código |

### ⚠️ Dos candados distintos, y la diferencia es la respuesta a la pregunta

Las seis vistas de historial **no se cierran todas igual**, y mezclarlas daba una
respuesta falsa:

| forma del candado | vistas | ¿BYOH la abre? |
|---|---|:---:|
| **pide los DATOS primero**, y recién si vienen vacíos pregunta por el owner | `#wrapped`, `#records`, `#zeroplays`, `#skips` | **sí** |
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

