# HANDOFF — spotify-web

> **Si sos un Claude nuevo entrando al proyecto: leé este archivo entero antes de hacer cualquier cosa. Después leé `CLAUDE.md` para las notas técnicas de la API de Spotify.**

---

## Usuario

- **Ian**, 19 años, full-stack dev, Mar del Plata.
- Habla **español rioplatense (voseo)**, técnico, directo. Respondele igual.
- Tiene ~9500 canciones likeadas en Spotify y quiere herramientas para administrar su biblioteca.
- App hosteada en GitHub Pages: https://ianct2020.github.io/spotify-web/

## Reglas duras (palabras del user, no las rompas)

1. **NUNCA escribas archivos con heredocs en bash (`cat > archivo << EOF`).** Usá siempre Edit/Write. Esto rompió todo en intentos anteriores.
2. **NUNCA inventes endpoints o features de la Spotify API sin verificar.** Si dudás, decile y buscamos juntos.
3. **NUNCA hardcodees el Client Secret en el frontend.** Usamos PKCE para eso.
4. **Si te trabás con un bug y no salís en 3 intentos, parate y mostrale.** No gastes media hora en círculos.
5. Trabajá en español rioplatense, técnico, directo.

## Stack

- HTML + CSS + JS vanilla (sin frameworks)
- Auth: Spotify Authorization Code Flow con PKCE
- Cache: localStorage con TTL (60 min para likes/playlists, 24h default)
- Routing: hash-based SPA (`#dashboard`, `#sync`, etc.)
- Charts: Chart.js (CDN)
- Deploy: GitHub Pages desde `/docs` (build copia `src/` a `docs/`)
- Cache busting de assets: `?v=N` en `index.html` y `callback.html` — bumpear cada vez que se sube código

## Comandos

```bash
npm run dev    # dev server :5500
npm run build  # copia src/ → docs/
```

## Credenciales Spotify

- Client ID: `0c8c92ad128e4b89be7097c6b8082797` (dev mode, cap 25 usuarios)
- Redirect URIs:
  - Dev: `http://127.0.0.1:5500/callback.html`
  - Prod: `https://ianct2020.github.io/spotify-web/callback.html`

---

## Decisiones de API (post-migración Feb 2026, críticas)

Endpoints deprecados que dan 403 — **NO los uses**:
- `/playlists/{id}/tracks` → usá `/playlists/{id}/items`
- `DELETE /me/tracks` → usá `DELETE /me/library?uris=spotify:track:{id},...` (max **40 URIs**, query params, no body)
- `PUT /me/tracks` → usá `PUT /me/library`
- `POST /users/{id}/playlists` → usá `POST /me/playlists`
- Audio Features, Recommendations, Featured Playlists, Related Artists, Get Several Albums/Artists, GET /users/{id}

Otros gotchas:
- Body de `DELETE /playlists/{id}/items` usa `{items: [{uri:...}]}`, **NO** `{tracks: [...]}`
- Response de `/playlists/{id}/items`: usar `items[].item`, no `items[].track` (en `/me/tracks` sigue siendo `items[].track`)
- Rate limit 429: esperar mín 5s, **Retry-After no visible por CORS** (CORS también esconde los headers de response)
- Paginación: **NO uses `data.next`** — Spotify mete `locale=en-US,en;q=0.9,es;q=0.8` con semicolons que rompen el CORS preflight. Construí URLs manualmente con offset/limit.
- localStorage quota ~5MB: usamos `slimTrack()` y `slimPlaylist()` en `api.js` para reducir cada track de ~5KB a ~500B antes de cachear.

Endpoints confirmados en uso:
- `POST /me/playlists` → `createPlaylist(name)` en api.js
- `DELETE /playlists/{id}/followers` → `unfollowPlaylist(id)` — así se "borra" una playlist propia (unfollow del owner). Spotify guarda backup ~90 días en spotify.com/account/recover-playlists.

Límites reales:
- **Playlists**: máx **10.000 tracks**. Spotify no fuerza corte hacia atrás (playlists viejas pueden tener +), pero no aceptan nuevos add.
- **Liked Songs**: **sin límite** (Spotify quitó el cap de 10k en 2020).

## Scopes

`user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-top-read user-read-recently-played user-follow-read`

---

## Arquitectura del código

```
src/
├── index.html, callback.html        ← cache bust ?v=N
├── css/{theme,main,components}.css
├── js/
│   ├── app.js                       ← bootstrap, routing, sidebar
│   ├── auth.js                      ← PKCE, token refresh con dedupe
│   ├── api.js                       ← spotifyFetch, paginateAll, TEST_MODE
│   ├── storage.js                   ← localStorage con TTL + quota handling
│   ├── router.js                    ← hash routing
│   ├── ui/components.js             ← renderTrackRow, modals, progress
│   ├── ui/toast.js
│   └── features/
│       ├── sync.js                  ← Sync Mirror (likes ↔ playlist espejo)
│       ├── dedupe.js                ← duplicados (URI repetido dentro de UNA playlist)
│       ├── versions.js              ← versiones (mismo nombre+artista en distintos álbumes)
│       ├── zombies.js               ← tracks eliminados del catálogo
│       ├── dashboard.js             ← stats y charts
│       ├── duplicate-albums.js      ← Álbumes repetidos (nueva)
│       └── orphans.js               ← DESACTIVADO (archivo queda, no se enrutea)
```

## MODO PRUEBA (TEST_MODE)

Definido en `src/js/api.js` arriba de todo. Cuando `true`:
- `getAllLikedTracks`: carga solo `TEST_MAX_LIKES = 2500` (en vez de los 9500). Cada vez que cache se renueva, agarra **offset random** entre 0 y (total − 2500), para no analizar siempre las mismas. Excepción: si pasás `{ randomize: false }`, arranca de offset 0 (las más recientes). Sync Mirror usa esto.
- `getAllPlaylistItems`: capa cada playlist a `TEST_MAX_PLAYLIST_ITEMS = 200`.
- Badge naranja "MODO PRUEBA — 25% de datos" en el sidebar.

**Cuando todo esté probado y andando**: en `api.js` cambiar `const TEST_MODE = true;` a `false`, build + push. Listo.

---

## Estado actual de features

| Feature | Estado | Notas |
|---|---|---|
| Auth/Login PKCE | ✅ Funcionando | Refresh dedupe + auto-relogin si refresh falla |
| **Versiones** | ✅ **Probada con borrado real** | User borró 26 versiones (9520→9494). Checkbox = "quedarme con esta", se borran las del mismo cluster no marcadas |
| **Zombis** | ✅ Funcionando | Checkbox para marcar individualmente + "Marcar todos", fade out 15s top-to-bottom (stagger 80ms) después de borrar. Separado en Likes vs por-playlist |
| **Dedupe** | 🧪 Rediseñado, a probar | Ahora: grid visual de playlists (cover + nombre + N tracks) → click en una → analiza esa sola → muestra grupos con contador de copias + posiciones → botón "Quitar N copias extra" que usa `removePlaylistItemsAtPositions` (preserva la primera aparición usando `positions` en el DELETE) |
| **Álbumes repetidos** | 🆕 Nueva feature | Detecta álbumes con 2+ tracks distintos dentro de UNA playlist (ideal para "listened albums"). Grid visual → click playlist → grupos por álbum con cover + tracks con checkbox tipo Versiones (1 por álbum). "Quitar sobrantes" quita los no-marcados de los álbumes con selección. |
| **Sync Mirror** | 🧪 Rebuild feature agregada | Precheck usa `target.tracks.total` (real, no muestra). Si target llena (≥10k) → UI con 2 opciones: (A) Borrar y rehacer con mismo nombre, (B) Crear "another one N+1". Si target no existe → ofrece crearla. Rebuild bypasea TEST_MODE (`forceAll:true`) para llenar con los ~9.500 likes reales. Los modos "Solo agregar" y "Sincronizar" siguen ahí para la operación normal |
| **Dashboard** | ✅ Visualmente OK | User dijo "datos están buenos", pero pidió que sea más lindo. Pendiente prettify |
| Huérfanas | 🗑️ Eliminado | Escaneaba 9500 likes vs ~25k items de playlists, impracticable. Se sacó del menú/rutas. El archivo queda en `features/orphans.js` |

## Fix histórico clave (no repitas estos errores)

- **403 en mutaciones**: era la migración Feb 2026, ver sección API arriba
- **CORS en paginación**: data.next tenía locale con semicolons → URLs manuales con offset
- **localStorage QuotaExceeded**: 9500 tracks completos no entran en 5MB → slimTrack/slimPlaylist
- **Rate limit mid-pagination**: agregamos partial progress cache (guarda cada 10 páginas, reanuda)
- **Cluster delete con semántica invertida**: la versión vieja interpretaba checkbox como "borrar esta", confundió al user y borró la equivocada. Ahora checkbox = **mantener** esta, se borran las otras del cluster
- **JSON parse error en DELETE**: Spotify devuelve 200 OK con body vacío en algunas mutaciones → spotifyFetch lee como text y parsea solo si no está vacío
- **No refresh token available**: si refresh falla, `getValidToken` limpia tokens y reload → muestra login
- **Precheck 10k con muestra parcial**: en TEST_MODE la playlist se cargaba capada (200 items), y el precheck del límite comparaba con esa muestra, no con el total real → nunca disparaba. Fix: usar `target.tracks.total` (que viene en el objeto de `/me/playlists`), no `playlistItems.length`.
- **DELETE de duplicados exactos**: mandar `{items:[{uri}]}` borra **todas** las copias de esa URI. Para preservar la primera aparición hay que usar `{items:[{uri, positions:[N,M,...]}]}`. Función helper: `removePlaylistItemsAtPositions(id, [{uri, positions}])`. Fetchea `snapshot_id` primero y lo pasa en el body para evitar race conditions.
- **Tracks locales no aceptan add en playlists**: si un like es un archivo local (MP3 subido por el user), su URI es `spotify:local:...` y `POST /playlists/{id}/items` los rechaza silenciosamente o con 400. Al hacer rebuild de "another one" (9498 likes) quedaron 9485 en la nueva playlist — los 13 faltantes son tracks locales o con URI inválida. **No es bug del código**, es limitación de la API. Solo el cliente oficial de Spotify puede mover tracks locales entre playlists.

## Patrón "script one-shot en consola"

Para operaciones destructivas puntuales que NO justifican gastar tokens armando UI + build + deploy (por ejemplo: borrar una playlist saturada y rehacerla desde cero), es válido darle al user un script para pegar en la consola del browser (F12). El script usa el token de localStorage (`sp_access_token`) y hace fetches directos a la API. **Referencia funcional en el repo**: `scripts/rebuild-anothertwo.js` (usado en la sesión 2026-07-03 — ejemplo de patrón con auth por localStorage, paginación manual, rate limit backoff, y confirm nativo).

Reglas del patrón:
1. Confirmar con el user antes de darle el script (es destructivo).
2. Que el script tenga `confirm()` nativo antes de mutaciones.
3. Que no exponga el Client Secret (nunca lo hardcodees — usa el token del user).
4. Que loguee progreso paso a paso para que el user sepa qué pasa.
5. Después de que corra, actualizá HANDOFF con la operación hecha y su fecha.

---

## Próximos pasos (en orden, por confirmar con user)

**Testing pendiente cuando el user vuelva:**
1. **Dedupe** con la nueva UI — no se pudo testear en la sesión 2026-07-04 porque Spotify UI no deja duplicar tracks. El código es idéntico al de Álbumes repetidos (que sí funcionó), así que confianza alta pero sin verificar. Si querés testear, hay que inyectar duplicados vía API en consola.

**Cierre de Fase 1:**
2. **Flipear `TEST_MODE = false`** en `src/js/api.js:13`, bump cache, build, push. El user prefirió posponerlo para no gastar usage de Spotify en la sesión 2026-07-04.

**Feature bloqueada — Auto-clasificación por género:**

- El user lo pidió porque clasificar manualmente es su mayor pérdida de tiempo.
- Los géneros están en el objeto **artista** (`artist.genres: [...]`), no en el track.
- **PROBLEMA**: `GET /artists?ids=...` (Get Several Artists) está deprecated (403) post-migración feb 2026 según CLAUDE.md.
- `GET /artists/{id}` individual **no se testeó** — habría que probar en el debug panel primero. Si vive, 2000 artistas únicos = 2000 requests (con cache persistente por 30 días es tolerable la primera vez).
- Si no vive, la feature muere sin alternativa dentro de la API de Spotify. Habría que esperar a la Fase 2 con Last.fm.

**Fase 2 restante (features menores, elegir con el user):**

- Bulk add / Mover likes a playlist
- Álbumes para completar (playlist con >1 track de un álbum → mostrar tracks faltantes)
- Solapamiento entre playlists
- Keywords sospechosas / tracks <1s / artistas con 1 sola canción

**Salteadas explícitamente por el user:**

- ~~Backup/Export JSON+Import~~ — el user prefiere el workaround de crear una segunda cuenta de Spotify y usar Sync Mirror hacia una playlist compartida como backup. No gasta usage armar la feature.
- ~~Dashboard prettify~~ — el user dijo que los datos ya están bien.
- ~~Filtro por idioma en Smart Playlists~~ — no hay endpoint. ISRC country es lo más cerca pero ruidoso; el user decidió no hacerlo.

---

## Fase 3 — Descubrimiento con Last.fm (futuro)

El user quiere esta fase después de cerrar Fase 1 + 2. Se hace con Last.fm porque los endpoints de descubrimiento de Spotify (Related Artists, Recommendations, Featured Playlists) están todos deprecados post-feb 2026.

- ⬜ Obtener API key de Last.fm (gratis, sin verificación)
- ⬜ **Artistas similares** — reemplaza el Related Artists deprecado de Spotify. Endpoint: `artist.getSimilar`.
- ⬜ **Rabbit hole por género** — dado un género, navegar artistas y tracks encadenados. Endpoint: `tag.getTopArtists` + `artist.getTopTracks`.
- ⬜ **New releases de tus Followed Artists** — Spotify sí deja listar followed artists (`GET /me/following`) pero no sus releases nuevos. Last.fm no tiene calendario de releases; habría que combinar con MusicBrainz o el propio Spotify (`GET /artists/{id}/albums` si sigue vivo — hay que verificar).
- ⬜ **Recomendaciones basadas en scrobbles** — requiere que el user tenga cuenta de Last.fm scrobbleando desde Spotify. Endpoint: `user.getTopArtists` / `user.getTopTracks` + cruzar con similares.

Consideraciones técnicas:
- Last.fm API es REST + JSON, key en query param (sin OAuth por el read-only side).
- No hay CORS restrictions salvo browsers viejos.
- Rate limit: 5 req/s por API key, generoso.
- Cache local agresivo — artistas similares no cambian a menudo.

---

## Sesión 2026-07-04 (contexto para el próximo Claude)

Sesión doble (mañana + tarde). Salió mucho. Última acción del día: preparar handoff porque el user pasa a otra PC.

**Hecho de mañana:**
- ✅ Fix filtro de Dedupe y Álbumes repetidos: ahora usa `owner.id === currentUserId` (antes solo excluía "spotify"), agregado `getCurrentUserId()` cacheado en `api.js`.
- ✅ Fix cap TEST_MODE en `getAllPlaylistItems`: agregado `{ forceAll }` param.
- ✅ **Álbumes repetidos** testeado — user borró 14 duplicados en "listened albums".
- ✅ **Smart Playlists** implementado (features/smart.js): por año, por década, random N. User creó "Likes 80s" (51) y random 2000, OK.

**Hecho de tarde — Fase 3 arrancada con Last.fm** (user aprobó, sacó API key `cdd56ad523b6142afaeb4ae9fcad62b1`, username `i-an-iam`):

- ✅ **Artistas similares** (features/similar-artists.js): search Spotify → grid de similares de Last.fm → click uno → top tracks resueltos en Spotify → checkbox multi-select → crear playlist "Similar a X: Y". La primera versión tenía imagen placeholder feo y checkbox horrible, se refactorizó a UI limpia:
  - Search minimal (solo nombre + hasta 3 géneros del `artist.genres` de Spotify, sin followers, sin imagen)
  - Grid compacto (Last.fm no sirve imágenes de artista desde 2019, sin placeholder)
  - Checkbox custom violeta (`.pretty-check` en components.css)
- ✅ **Rabbit hole por género** (features/rabbit-hole.js): input + 18 chips sugeridos → top artistas del tag → click → top tracks → playlist.
- ✅ **Recomendaciones (scrobbles)** (features/recommendations.js): pide username, `user.gettopartists` últimos 6 meses (top 30), fetch similares de cada uno, agrega score `playcount * match`, filtra artistas que ya tenés y **también tracks individuales ya en likes** (fix del primer intento donde solo filtraba por artista).
- ✅ **Clasificar por género** (features/by-genre.js): la feature de "clasificación automática" que estuvo bloqueada — se resolvió usando Last.fm (`artist.gettoptags`) en lugar de Get Several Artists deprecado de Spotify. Fetchea top tags de cada artista único (~569 en TEST_MODE, ~2000 en real), throttle 200ms → cache persistente 30 días → grid de géneros con # de tracks → click → crea playlist "Género: X". User lo probó, 569 artistas procesados en ~2 min, dio 195 géneros con top: Hip-Hop 1063, Rap 985, Hip Hop 660, etc.
- ✅ **Related tags en Rabbit hole**: `tag.getSimilar` de Last.fm está roto (devuelve vacío desde ~2018). Fallback local: agarra top 8 artistas del tag, agrega sus top tags, muestra los que aparecen 2+ veces como "Géneros parecidos" en chips clickeables.
- ✅ **Scrollbar custom** (main.css): fino, thumb color border, hover accent.
- ✅ **API user management**: user preguntó, le expliqué que el cap Spotify Dev Mode es **25 usuarios** (no 5, otro chat le había dicho mal), el dueño no cuenta, se agregan por Settings → User Management con email exacto.

**Estado técnico:**
- Último commit: `033d47e` (fix rabbit+recs).
- Cache bust: `?v=25`.
- TEST_MODE: `true` (2500 likes).
- Cache de `artist.gettoptags` en localStorage key `lastfm_artist_tags_cache` (30d TTL).
- API key de Last.fm en localStorage `lastfm_api_key`. Username en `lastfm_username`.

**Sidebar actual:**
```
GENERAL     Dashboard
CREAR       Smart Playlists
DESCUBRIR   Artistas similares
            Rabbit hole
            Recomendaciones
            Por género
LIMPIEZA    Sync Mirror, Dedupe, Álbumes repetidos, Zombis, Versiones
```

**Pendiente (arranca por acá cuando vuelva):**
1. **Flip TEST_MODE = false** en `src/js/api.js:13`. User lo pospuso 2 veces por budget; su argumento "si anduvo en 2500 va a andar en 9500" es válido, solo agregar `~7 min` extra de carga inicial y verificar que no revienta `localStorage` (~2.85 MB estimados, entra en 5 MB con margen).
2. Con `TEST_MODE=false`: re-correr **Por género** para clasificar los 9500 reales (~7 min más para los ~2000 artistas restantes que no cachearon).
3. Cierre de Fase 1.

**Ideas Fase 4 (aún no propuestas al user, pero mencionadas de pasada):**
- Bio del artista via `artist.getInfo` (user dijo NO ahora)
- New releases via `/me/following` + album lookups (user dijo NO, prefiere el descubrimiento manual de Spotify los viernes)
- Feature "artistas en común" — dado un tag, mostrar cuáles de tus likes están en su top

---

## Sesión 2026-07-04 anterior (mañana)

(Ver sección de sesión doble arriba — todo se fusionó porque fue el mismo día.)

---

## Versión actual desplegada (actualizado 2026-07-15)

- Git: rama `main`, cambios sin commitear todavía
- Cache bust: **`?v=38`**
- **TEST_MODE eliminado por completo del código** (2026-07-11). Ver "Fase 4" abajo.
- Playlist espejo activa: `anothertwo`. Default de Sync Mirror en `src/js/features/sync.js:7`.
- **Last.fm + Stats.fm integrados**. Ver Fase 4 abajo.
- Spotify user ID de Ian: `orhs6wu5ykk7ql80u92ujn74o`
- Backup del user en el repo: `docs/data/user-orhs6wu5ykk7ql80u92ujn74o.json` (0 likes, 1503 tags al 2026-07-13).
- Cache TTL: **24 horas** (subido de 60 min el 2026-07-13 porque Ian se quedaba sin cache al salir y volver más tarde).

## Sesión 2026-07-03 (contexto para el próximo Claude)

**Se hizo:**
- Fix Sync 10k (`v=15`): precheck y 3 modos (sincronizar / solo agregar / vaciar y llenar). **Buggy en TEST_MODE porque comparaba muestra con total** (ver Fix histórico clave).
- Rebuild feature Sync (`v=16`): fix del precheck usando `target.tracks.total`, UI de "playlist llena" con opción de rehacer o crear "N+1", bypass TEST_MODE en rebuild.
- Migración manual (`v=17`): el user optó por hacer el rebuild vía **script one-shot en consola** (`scripts/rebuild-anothertwo.js`) en lugar de usar la UI. Se borró `another one` (11k) y se creó `anothertwo` (9485). El default del input se cambió a `anothertwo`.
- Dedupe rediseñado + Álbumes repetidos (`v=18`): grid visual con cover de playlists como selector, `removePlaylistItemsAtPositions` para preservar la primera aparición al deduplicar exacto.

**Se probó (por el user):**
- Sync analizar en `anothertwo` OK (mostraba muestra vs total real correctamente en `v=15`, warning naranja de TEST_MODE)
- Rebuild vía consola: OK (9485 tracks migrados)

**No se probó todavía (para arrancar mañana):**
- Dedupe con la nueva UI
- Álbumes repetidos con la playlist `listened albums` (esa es la que motivó la feature)
- Sync Mirror sobre `anothertwo` con "Solo agregar"

**Estado de tokens del user al cortar la sesión:** el user dijo "me queda poco usage" y el budget se le reseteaba tarde en el día. Cuando arranques mañana, no gastes tokens en re-derivar contexto: leé este archivo, chequeá git log (últimos 5 commits) y arranca con las tareas de "Próximos pasos".

---

## Reglas para mantener este archivo

**Cuando hagas un cambio:**
1. Actualizá la sección **Estado actual de features** si tocaste una feature
2. Actualizá **Versión actual desplegada** con el nuevo commit hash y `?v=N`
3. Si descubrís un nuevo gotcha de API → agregalo a **Fix histórico clave**
4. Si el user toma una decisión nueva → agregala a **Reglas duras** o **Próximos pasos**
5. Mantenelo conciso. No es un changelog — es un mapa para retomar.
6. Cuando cierres una sesión, agregá una entrada en **Sesión YYYY-MM-DD (contexto para el próximo Claude)** con qué se hizo, qué se probó y qué queda. Reemplazá la sesión anterior si el estado quedó reflejado en el resto del doc.
7. Si se corrió un script one-shot en la consola del user → dejá el archivo en `scratchpad/` y anotalo brevemente en Sesión + el patrón general está documentado arriba.

---

## Sesiones 2026-07-11 al 2026-07-13 — Fase 4 (contexto para el próximo Claude)

**Contexto:** en tres sesiones consecutivas (11-12-13 julio 2026) se cerró Fase 3 y se hizo toda la Fase 4. Al 13 de julio la app tiene features avanzadas pero Ian tuvo problemas con rate limit y cache que se explican abajo.

### Estado técnico

- **Commit**: `8c55c84` — v=37
- **TEST_MODE**: eliminado (ver más abajo)
- **Cache TTL**: 24 horas (era 60 min, se subió para que no se pierda al salir del sitio)
- **Backup del user en el repo**: `docs/data/user-orhs6wu5ykk7ql80u92ujn74o.json` (293 KB, tiene 0 likes + 1503 tags — Ian nunca terminó de cargar sus likes por rate limit)

### Fase 3 cerrada (finales 2026-07-11)

- ✅ Rippear TEST_MODE por completo. Se sacó `const TEST_MODE = true` de api.js, `isTestMode()`, badge "MODO PRUEBA — 25% de datos" del sidebar, warnings en sync.js. Ian confirmó "salió perfecto con datos reales (9506 likes, 2209 artistas únicos)".

### Fase 4 — 2026-07-12

- ✅ **NOISE_TAGS ampliado** en `by-genre.js`: filtra racism, misogyny, nazi, edgy, cool, chill, vibes, mood, nostalgia, legend, goat, king, queen, etc. (Ian vio "woman beater" en su listado — no era gracioso).
- ✅ **Multi-género** en Por género: cards actúan como toggle, barra fija abajo con contador de tracks únicos, botón "Crear playlist" con nombre concatenado `Género: Rock + Metal`. CSS: `.smart-card.selected` con border accent + checkmark en esquina, `.action-bar` sticky bottom.
- ✅ **Export/Import JSON del cache de tags** (después reemplazado por JSON unificado).
- ✅ **Stats.fm integrado** (`src/js/api/statsfm.js`): endpoints públicos sin API key. Ian: username `i.an.iam`, Spotify ID `orhs6wu5ykk7ql80u92ujn74o`. `getTopArtists(username, {range:'lifetime', limit:1000})` — 1 request devuelve top 1000 con géneros de Spotify por artista. **Mata el bottleneck** de Last.fm (7 min → 1 request para las 1000 más escuchadas). `mergeCachedTags` en `lastfm.js` combina Last.fm + Stats.fm sin pisarse. Géneros compuestos tipo `hip-hop/rap` se splitean.
- ✅ **Pantalla de bienvenida en Por género**: no auto-arranca, dos botones "Cargar mis likes" o "Importar cache primero".
- ✅ **Cache incremental de likes** (formato inicial, después unificado): botón "Exportar likes" / "Importar likes" en Dashboard. Import: 1 request `/me/tracks?limit=1` para leer total actual → si hay delta, trae solo los N nuevos (offset 0) → mergea al frente dedupeando por URI. Ignora borrados (Ian confirmó que si borra 1-2 no importa).
- ✅ DEFAULT_MAX_RETRIES en api.js: 3 → 5.

### Fase 4 continuación — 2026-07-13

**A. JSON unificado (v=34)**
- Nueva `exportAllData(userId)` / `importAllData(parsed)` en api.js — **un solo archivo `user-<spotifyId>.json`** con `{likes, tags, spotifyUserId}`.
- **Retrocompat** con formatos viejos (`spotify-tools-likes` / `spotify-tools-genres`).
- Dashboard: botones renombrados a "Exportar todo" / "Importar todo".
- Por género: los botones usan el mismo formato unificado.

**B. Auto-load desde GitHub según user (v=34)**
- Nueva `tryAutoLoadUserBackup(userId)` en api.js: hace `fetch('data/user-<safeId>.json')` en el mismo dominio de GitHub Pages.
- Si existe y no hay cache local reciente, carga y mergea con toast "Backup del repo cargado: N likes · M artistas con tags".
- `app.js` dispara post-login sin bloquear el render de la UI.
- `src/data/README.md` con instrucciones para crear el backup.
- `src/data/user-orhs6wu5ykk7ql80u92ujn74o.json` — backup de Ian ya commiteado.

**C. Sin clasificar en Por género (v=34)**
- Card con border warning dashed al final del grid con tracks cuyos artistas no tienen tags.
- Click crea playlist "Sin clasificar (N)" para clasificar manual.

**Fix popularidad (v=34, v=36)**
- Si `popularityBuckets` está todo en 0, el chart se reemplaza con mensaje explicativo. En v=36 se agregó **auto-diagnóstico**: `computeStats` cuenta cuántos tracks tienen `popularity == null` vs con valor. El mensaje ahora dice `X% de tracks (N) no tienen popularity`. Si es 100%, es la API (Spotify sacó el campo post-migración feb 2026). Si es <100%, es datos incompletos.

**Fix "Actualizar datos" full refresh (v=35)**
- Nueva `syncLikesIncremental()` en api.js: 1 request HEAD + delta.
- Dashboard "Actualizar datos" → usa incremental si hay cache, full si no.
- `importLikesData`: si archivo tiene 0 items → aborta con mensaje. Si delta > 1000 → salta el fetch y avisa que use "Actualizar datos".

**Fix cache TTL + throttle (v=36, v=37)**
- `CACHE_TTL_MIN`: 60 → **1440** (24h). Antes se le perdía el cache si salía y volvía en el día.
- Sleep entre requests paginados: **400 → 600ms**. Reduce chance de 429 en cargas grandes.
- `avgPopularity` ahora divide por `popularityCount` real (no `likes.length`) para no promediar en null.

### Testing bloqueado por rate limit (2026-07-13 noche)

Ian pasó todo el día con rate limit por intentar cargar los 9538 likes varias veces sin éxito. Cuando el rate limit pase (30-60 min desde el último 429), el orden de tareas es:

1. **Cargar likes UNA vez**: Dashboard → "Cargar desde Spotify" → esperar ~3-4 min con el throttle nuevo de 600ms.
2. **Exportar todo**: Dashboard → "Exportar todo" → se baja `user-orhs6wu5ykk7ql80u92ujn74o.json` con los 9538 likes + 1503 tags.
3. **Commitear al repo**: Ian pide ayuda para mover el archivo (`/home/ian/Descargas/user-orhs6wu5ykk7ql80u92ujn74o.json`) a `/home/ian/spotify-web/src/data/`, hacer build + commit + push.
4. Verificar que el auto-load funciona: recargar el sitio, chequear que toast dice "Backup cargado" y **NO** arranca a paginar de cero.
5. Testear Multi-género real, Sin clasificar, Sync Stats.fm.

### Bugs abiertos

- **Popularidad**: pendiente confirmar si el endpoint `/me/tracks` de Spotify sigue devolviendo `popularity`. El mensaje de v=36 va a mostrar el % exacto — con eso se decide si el bug es de la API (100% null) o de datos (parcial). Sin verificar aún porque Ian no logró cargar likes completos.
- **Rate limit sensibilidad**: aún con throttle 600ms, si Ian entra rápido varias veces, cae en 429. No hay más para reducir sin duplicar la duración de la carga.

### Cosas NO implementadas (ideas)

- Auto-sync incremental de likes al entrar al Dashboard: si hay export previo, chequear delta al vuelo. Hoy es manual (botón "Actualizar datos").
- Range switcher para Stats.fm (hoy hardcoded `lifetime`).
- Badges por tag mostrando source (Last.fm / Stats.fm). Baja prioridad.
- Recomendaciones híbridas: hoy solo usa Last.fm `user.gettopartists`. Podría usar Stats.fm también.

---

## Changelog reciente (últimos 5 cambios)

- `v=38` (uncommitted): fix export vacío (fallback a partial cache) + modal `promptPlaylistName` con contador 100 chars (fix "playlist name too long" con multi-género) + cap defensivo en `createPlaylist` + búsqueda y orden en Por género + ETA y botón "Detener" prominente en carga de likes + hint "última sync" en Dashboard + export CSV (dropdown JSON/CSV) + nueva feature "Por artista".
- `v=37` (8c55c84): data — backup de tags de Ian en repo + throttle paginación 400→600ms.
- `v=36` (183a57d): cache TTL 60min → 24h + diagnóstico automático de popularidad con % de nulls.
- `v=35` (8ec7e50): "Actualizar datos" hace incremental sync + aviso de archivo vacío en import.
- `v=34` (c2cb731): JSON unificado (likes + tags en un archivo) + auto-load desde GitHub según user + Sin clasificar en Por género + fix popularidad defensivo.
- `v=33` (c6ef5a8): Dashboard con pantalla de bienvenida + botón cancelar carga (AbortController).
- `v=32` (0a6493c): cache incremental de likes (export/import JSON) — ~190 requests → 2.
- `v=31` (3e1af93): pantalla de bienvenida en Por género + no re-cargar likes tras sync/import.
- `v=30` (a16f20c): integración Stats.fm — sin API key, un lifetime request trae top 1000 con géneros.
- `v=29` (7505c70): export/import JSON del cache de géneros.
- `v=28` (09c2c51): multi-género con toggle + NOISE_TAGS ampliado.
- `v=27` (1ad979a): TEST_MODE rippado completo — evita mostrar "25% de datos".
- `v=26` (2c93dd7): TEST_MODE off — carga los 9500 likes reales.
- `v=25` (033d47e): Rabbit hole related tags fallback (computeRelatedTags agrega top tags de top 8 artistas). Recomendaciones filtra tracks individuales ya-en-likes con stat "Ya en tus likes (ocultos)".
- `v=24` (6912ba8): Fase 3 completa — clasificación por género (by-genre.js con cache 30d en localStorage), recomendaciones basadas en scrobbles (recommendations.js), related tags en rabbit hole (roto por tag.getSimilar, luego reemplazado en v=25).
- `v=23` (d2521cf): search minimal (solo nombre + géneros de Spotify sin imagen ni followers), scrollbar custom global.
- `v=22` (1748570): Rabbit hole por género + polish UI de Similar (grid sin placeholder de imagen, checkbox pretty).
- `v=21` (9f57762): Fase 3.1 — Artistas similares vía Last.fm. Nuevo módulo `src/js/api/lastfm.js`. API key en localStorage.
- `v=20` (e56a2b1): Smart Playlists (por año/década/random N). Nueva sección "Crear" en sidebar.
- `v=19` (6fcd271): fix filtro por owner real (usando getCurrentUserId), fix cap TEST_MODE en getAllPlaylistItems con forceAll.
- `v=18` (0e62d53): Dedupe rediseñado (grid visual de playlists → seleccionar una → analizar) + nueva feature Álbumes repetidos. `slimPlaylist` guarda ahora `image` (URL de la cover chica). `renderPlaylistGrid`/`bindPlaylistGrid` en `ui/components.js` como componente compartido. Nueva `removePlaylistItemsAtPositions` en api.js (usa `positions` en el DELETE para preservar la primera aparición en Dedupe). Nueva ruta `#dupalbums` en app.js.
- `v=17` (adb81c0): default target "another one" → "anothertwo" (la vieja se borró vía script one-shot en consola)
- `v=16` (ae1297e): rebuild feature en Sync Mirror — usa `target.tracks.total` real para el precheck (fix bug del `v=15` donde la muestra de 200 hacía que el warning nunca dispare). Cuando target ≥10k → UI con "borrar y rehacer" o "crear another one N+1". Cuando no existe → ofrece crearla. Rebuild bypasea TEST_MODE (`getAllLikedTracks({ forceAll: true })`) para llenar con los 9500 reales. Agrega `unfollowPlaylist(id)` en api.js.
- `v=15` (e08234a): fix Sync 10k — precheck `newSize > 10000`, badge de warning en TEST_MODE, botón "Solo agregar", botón "Vaciar y llenar" (buggy: usaba la muestra en vez del total real)
- `v=14` (0aab889): checkbox lindo con gradient + animación pop del tilde
- `v=13` (525c90d): elimino Huérfanas, checkboxes en Zombis, sync mirror randomize:false
- `v=12` (1a94bd7): semántica invertida checkbox en Versiones (marcar = quedarme), fade out borradas
