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
- Create playlist: `POST /me/playlists` (NO `POST /users/{id}/playlists`)
- Rate limit 429: esperar mínimo 5 segundos, Retry-After header no visible por CORS
- Endpoints deprecados (403): Audio Features, Audio Analysis, Recommendations, Related Artists, Featured Playlists, Get Several Albums/Artists, Get Artist Top Tracks, Get New Releases, GET /users/{id}, GET /users/{id}/playlists
- **Get Track / Get Several Tracks** (`GET /tracks/{id}`, `GET /tracks?ids=`): **403 confirmado 2026-07-25** (probado en vivo con token válido). NO usar para resolver tapas/metadata. Para tapas usar **oEmbed** (`https://open.spotify.com/oembed?url=spotify:track:{id}` → `thumbnail_url`, público sin auth) — así se hornean en data/listening-history.json. Ver [[spotify-web-historial-reproduccion]].
- **`preview_url`** en el objeto track: **REMOVIDO en la migración feb 2026** (confirmado 2026-07-29 con `/me/tracks?limit=5` en vivo — el campo ni siquiera aparece en la respuesta). Para reproducir 30s de preview usar el **embed iframe oficial**: `<iframe src="https://open.spotify.com/embed/track/{id}" width="100%" height="80">` — funciona sin auth, tanto para free como Premium. Usado en features/skips.js.
- **Previews 30s vía iTunes Search API** (v=88, 2026-07-29): `api/itunes.js` — `https://itunes.apple.com/search` con **CORS abierto** (`access-control-allow-origin: *`), sin auth ni key. El preview m4a arranca en el estribillo y NO suma plays al historial de Spotify. Cache en localStorage (`itunes_preview_cache_v1`, 600 entradas). Player global único en `ui/preview-player.js` (pill flotante + hover-play + evento `previewchange`). El embed iframe queda solo como fallback si iTunes no tiene el tema.
- **Match de previews contra TODOS los artistas del track** (v=142): `util/track-match.js` acepta una lista de artistas y da por bueno el candidato si coincide **cualquiera** (los umbrales y la regla de títulos cortos NO se tocaron). Dos motivos, los dos reales en VULTURES 1, acreditado al alias «¥$» (= Kanye West + Ty Dolla $ign): (1) contra «¥$» no matchea nadie, porque iTunes/Deezer lo listan como "Kanye West & Ty Dolla $ign"; (2) **«¥$» normalizado queda en la cadena vacía** (`normText` tira todo lo que no sea `[a-z0-9 ]`), así que cuando el ALIAS viene del lado del candidato —Deezer lista las pistas así— tampoco hay comparación posible: para eso está la igualdad exacta del nombre crudo. Además se prueban hasta 2 búsquedas por track (`preferredQueryArtists` manda primero un nombre buscable: «Kanye West CARNIVAL», no «¥$ CARNIVAL»). Medido en la app: VULTURES 1 pasó de **0/13 pistas con audio** (13 embeds) a **13/13** (11 Deezer + 2 iTunes). Los callers tienen que pasar `artists: [...]` — `artist` suelto sigue andando.
- **`GET /playlists/{id}?fields=snapshot_id`**: CONFIRMADO vivo (2026-07-29). `getAllPlaylistItems` lo usa para cachear items en IDB (`playlist_items_{id}`) validando por snapshot: si no cambió, carga instantánea; si nosotros escribimos, `updatePlaylistItemsCache` actualiza en el lugar (add/removeTracksFromPlaylist devuelven el snapshot nuevo).
  - ⚠️ **VA RETRASADO respecto a nuestras propias escrituras** (medido 2026-08-13). Justo después de un POST devuelve el snapshot **anterior**, y tarda **5-10 s** en ponerse al día; `/items` es correcto al instante. Por eso: (1) para cachear tras escribir, usar el snapshot que devolvió el POST, **nunca re-leerlo** (re-leerlo guarda el snapshot viejo con los items nuevos y corrompe el cache); (2) **no confiar en el cache validado por snapshot de una playlist recién escrita** — dentro de esa ventana valida contra contenido que ya cambió. `util/playlist-add.js` lleva un `escritasEnEstaSesion` por esto: sin ello el chequeo de duplicados daba por repetida una canción que ya no estaba y no la añadía.
- **`GET /me/top/{artists|tracks}?time_range=short|medium|long_term`**: **CONFIRMADO vivo (2026-07-29, 200 con token real)**. Usado en el Wrapped lite para users sin Extended Streaming History (wrapped.js `renderLite`). Scope `user-top-read` ya pedido.
- **Stats.fm API** (`api.stats.fm/api/v1`, CORS abierto, sin key): usada en Por género. Más endpoints investigados en /home/ian/STATSFM-API-2026-07-29.md (per-track stats actuales posibles vía `/search/elastic` → id interno → `/users/{u}/streams/tracks/{id}/stats`).
- **`/me/library/contains?uris=…`** (post-migración): CONFIRMADO vivo (2026-07-28). Devuelve `[bool, ...]`. El clásico `/me/tracks/contains?ids=…` está 403. Chunks de 50. Usado en features/versions.js para verificación de borrados.
- DELETE playlist items: body `{ items: [{uri}] }` (NO `{ tracks: [...] }` → da 400 "No uris provided")
- Campo `popularity` en `/me/tracks`: **removido en la migración feb 2026**. Confirmado 2026-07-17 con 9548 tracks reales → 100% null. No usar más. Chart de popularidad sacado del Dashboard en v=41.
- **Búsqueda** (`/search?type=album|track|artist`, con filtros `artist:"..."`): CONFIRMADO vivo (se usa en Similar y en Álbum similar v=45).
- `GET /artists/{id}/albums`: **el limit máximo bajó a 10** (re-verificado en vivo 2026-08-11: `limit` 11..20 devuelven 400 "Invalid limit", `limit=10` devuelve 200 y pagina bien con `next`/`offset` — Taylor Swift, `total: 112`). Antes (2026-08-05) 20 andaba. Nunca mandar `market=from_token`. Usado en `#discover-artists` y `#new-releases`. `getArtistAlbums()` (api.js) capea con `ARTIST_ALBUMS_MAX_LIMIT = 10` y cae a `/search?q=artist:"X"&type=album` si el nativo devuelve 400 o 403. **Ojo**: cuando el limit hardcodeado se queda viejo el nativo falla siempre y todo pasa en silencio por el fallback de `/search`, que es más lento y trae artistas ajenos — si ves `[api] getArtistAlbums: … fallback a /search` en consola, re-probá el limit.
- `GET /albums/{id}/tracks`: usado best-effort en "Álbum similar" para el tracklist preview. Está envuelto en try/catch — si devuelve 403 la feature degrada sin romperse. No confirmado si sigue vivo.

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
