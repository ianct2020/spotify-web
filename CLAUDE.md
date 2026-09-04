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
- **Stats.fm API** (`api.stats.fm/api/v1`, CORS abierto, sin key): usada en Por género. Más endpoints investigados en /home/ian/STATSFM-API-2026-07-29.md (per-track stats actuales posibles vía `/search/elastic` → id interno → `/users/{u}/streams/tracks/{id}/stats`).
- **`/me/library/contains?uris=…`** (post-migración): CONFIRMADO vivo (2026-07-28). Devuelve `[bool, ...]`. El clásico `/me/tracks/contains?ids=…` está 403. **El máximo son 40 uris por request** (re-verificado en vivo 2026-08-28 con token real: 40 → 200; **41, 42, 43, 44, 45, 48, 49, 50 y 60 → 400 «Too many uris requested»**; 100 ni llega, da **414** porque se pasa del largo de URL). Mismo tope para `spotify:track:` y para `spotify:album:` — el 41 falla igual en los dos. O sea que es el mismo 40 que ya usan el PUT y el DELETE de `/me/library`: **`/me/library` entero va de a 40**. Decía «chunks de 50» y era falso — con 50 el request fallaba **siempre**. Usado en features/versions.js para verificación de borrados y en `albumsInLibrary()`. **CORREGIDO el 2026-08-28**: el número vive ahora en una sola constante, `LIBRARY_URIS_POR_REQUEST` (api.js), que usan los seis puntos que pegan a `/me/library` (los dos `contains`, el PUT y el DELETE de pistas, y el PUT y el DELETE de álbumes). **Lo que estuvo roto y por qué importa**: hasta esa fecha los dos `contains` iban de a 50, o sea que **fallaban siempre**, y el único llamador (`versions.js`) atrapaba la excepción y la reportaba con `console.warn` — que la extensión de Chrome no captura. Resultado: **todo borrado de más de 40 versiones se dio por verificado sin haberse verificado**, con toast verde. Ese es el patrón a no repetir: una verificación con un `catch` que deja seguir el flujo es peor que no tener verificación, porque da la misma cara que un resultado limpio. Ahora `checkLibraryContains()` tira también si la respuesta no trae exactamente un booleano por id, y `versions.js` aborta con toast rojo en vez de degradar.
- DELETE playlist items: body `{ items: [{uri}] }` (NO `{ tracks: [...] }` → da 400 "No uris provided")
- Campo `popularity` en `/me/tracks`: **removido en la migración feb 2026**. Confirmado 2026-07-17 con 9548 tracks reales → 100% null. No usar más. Chart de popularidad sacado del Dashboard en v=41.
- **Búsqueda** (`/search?type=album|track|artist`, con filtros `artist:"..."`): CONFIRMADO vivo (se usa en Similar y en Álbum similar v=45).
- `GET /artists/{id}/albums`: **el limit máximo bajó a 10** (re-verificado en vivo 2026-08-11: `limit` 11..20 devuelven 400 "Invalid limit", `limit=10` devuelve 200 y pagina bien con `next`/`offset` — Taylor Swift, `total: 112`). Antes (2026-08-05) 20 andaba. Nunca mandar `market=from_token`. Usado en `#discover-artists` y `#new-releases`. `getArtistAlbums()` (api.js) capea con `ARTIST_ALBUMS_MAX_LIMIT = 10` y cae a `/search?q=artist:"X"&type=album` si el nativo devuelve 400 o 403. **Ojo**: cuando el limit hardcodeado se queda viejo el nativo falla siempre y todo pasa en silencio por el fallback de `/search`, que es más lento y trae artistas ajenos — si ves `[api] getArtistAlbums: … fallback a /search` en consola, re-probá el limit.
- `GET /albums/{id}/tracks?limit=50`: **CONFIRMADO vivo (2026-08-16, 200 con token real)**. Lo usan W-Three (tracklist del modal por álbum), `#discover-artists` / `#new-releases` (pista representativa para el preview y para «+ Biblioteca») y, desde v=144, la **ficha de álbum**: sin el tracklist completo el ♥ marcaba todas las filas por igual, porque la lista eran solo los likes de ese disco. Ojo con el `albumId`: casi ningún llamador de `openAlbumCard()` lo trae (el mosaico, el Dashboard y el Wrapped mandan nombre + artista), así que `album-card.js` lo resuelve con `/search?q=album:"…" artist:"…"&type=album&limit=1` y memoiza por `albumKey`. Sigue envuelto en try/catch: si el endpoint cae, la ficha degrada a la lista vieja (solo likes, todos con ♥).

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
- O sea que la espera real que tapa el esqueleto es **~1 segundo**, no 5. Lo de
  «5 segundos mostrando nada» que reportó Ian no es esta ficha: es el modal de
  álbum de `#listened` (otro código) o la vista entera de `#covers`, que con
  2.449 tapas tarda bastante más.

## Zona horaria: la fecha suelta se parsea en UTC (v=154)
Récords decía «9 ene 2026» y Wrapped «8 ene 2026» **para el mismo récord**. No
era el pipeline: los dos leen `"2026-01-09"`, verificado contra
`history-records.json` y `history-stats.json` en producción.

`new Date("2026-01-09")` — la forma **date-only** — la parsea el estándar como
medianoche **UTC**. `getDate()` después la lee en hora **local**, y en Argentina
(UTC−3) esa medianoche cae a las 21:00 del día 8. Un día para atrás, siempre,
para cualquier offset negativo. `records.js` no se lo comía porque parte el
string a mano (`fmtDayShort`) y nunca construye un `Date`.

⚠️ La regla, para cualquier fecha que venga de `gen-stats.py`:
- `"2026-01-09"` es un **DÍA del calendario**. Se parte, o se le pega
  `T12:00:00` (lo que hace `records.js fmtDay`). **Nunca** `new Date(iso)` pelado.
- `"2026-01-09T04:12:33Z"` es un **INSTANTE**. Ahí `new Date()` y la conversión
  a local es lo correcto (es lo que hacen `first_play` / `last_play`).

`wrapped.js` distingue las dos formas con `SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/`.

**Los cuatro sitios que quedaban señalados NO tenían el bug** (revisados en
v=157): `sin-clasificar.js`, `artist-card.js`, `zero-plays.js` y
`search-likes.js` formateaban `added_at` de los likes, que es un **INSTANTE**
(`"2024-05-01T12:33:00Z"`), y para un instante `new Date(iso)` + hora local es
justamente lo correcto. Lo que sí estaba mal era menor: dos usaban `es-AR` y dos
`es-ES` para la misma fecha. Los cuatro pasaron igual al helper compartido
`util/fecha.js` (`fmtDia` / `fmtDiaCorto`), que aplica el criterio de Wrapped a
las dos formas — así el próximo llamador no tiene que acordarse de la regla.

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
  antes/después en `/home/ian/MEDICION-COVERS-2026-09-03.txt`.
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
seguía corriendo v=173, con los caches y la IndexedDB ya borrados. El culpable
es el **service worker** (`fonoteca-sw-v1`), que sirve `index.html` de su propio
cache y se re-registra en cada carga. Para verificar de verdad en el navegador:
`navigator.serviceWorker.getRegistrations()` → `unregister()` en todas, borrar
`caches`, y recargar **con un query distinto** (`index.html?frio=1`). El `curl`
prueba que GitHub Pages publicó; no prueba qué está ejecutando el cliente.

## `#covers` estuvo ROTA nueve versiones — `a.sources.has is not a function` (RESUELTO en v=176)
> ⚠️ **Corregido el 2026-08-30**: esta sección decía «PENDIENTE... sin
> arreglar, a la espera del OK de Ian». El fix está en el commit siguiente
> (`14f3f9d`, v=176, 80 minutos después del commit que escribió esta
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
`/home/ian/BARRIDO-VISTAS-2026-08-30.txt`.

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
`/home/ian/REPRO-VIGENCIA-2026-09-03/`: `node serve.mjs` y
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

Deploy completo: bumpear los **cuatro** `?v=` de `src/index.html` → `bash build.sh`
→ `git add` archivo por archivo → commit → push. Y **el `curl` no verifica el
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
user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-top-read user-read-recently-played user-follow-read

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
