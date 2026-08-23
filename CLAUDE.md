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
- **`/me/library/contains?uris=…`** (post-migración): CONFIRMADO vivo (2026-07-28). Devuelve `[bool, ...]`. El clásico `/me/tracks/contains?ids=…` está 403. Chunks de 50. Usado en features/versions.js para verificación de borrados.
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
