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

**Testing pendiente (arranca por acá cuando vuelva):**
1. **Dedupe** con la nueva UI — probar en una playlist chica primero. Grid con cover → click una → debería mostrar duplicados con "Nx" y posiciones → botón "Quitar N copias extra". Chequeá que la primera aparición **queda** y las otras se van (no todas).
2. **Álbumes repetidos** — probar en `listened albums`. Marcá 1 track por álbum (checkbox tipo Versiones — al marcar otro del mismo álbum se desmarca el primero) → "Quitar sobrantes".

**Features aún no implementadas** (el user las dejó agendadas):

3. **Smart playlists** — el user dijo "seguimos con smart playlist" antes de cortar la sesión. Ideas:
   - "Likes de {año}" basado en `added_at` de `/me/tracks`
   - "Década X" basado en `release_date` del álbum
   - "Random N tracks" (elegir un tamaño y crear playlist con selección aleatoria de likes)
   - UI: form → selector de criterio → preview → botón "Crear playlist"
   - Endpoints ya disponibles: `createPlaylist`, `addTracksToPlaylist`, `getAllLikedTracks({forceAll:true})`

4. **Backup/Export + Import** JSON — descarga estado completo (likes con added_at, playlists con nombre/descripción/tracks). Import: subís JSON, la app recrea. Ojo: `added_at` de likes **no** se puede setear al restaurar (API no lo permite); en el import se pierde la fecha original.

5. **Dashboard prettify** (cosmético — el user dijo que los datos ya están bien; bajo prioridad).

**Cierre de Fase 1:**

6. Cuando 1-5 estén listos, **flipear `TEST_MODE = false`** en `src/js/api.js:13`, bump cache, build, push.

7. Fase 2 restante (elegir con el user):
   - Bulk add / Mover likes a playlist
   - Álbumes para completar (playlist con >1 track de un álbum → mostrar tracks faltantes)
   - Solapamiento entre playlists
   - Keywords sospechosas / tracks <1s / artistas con 1 sola canción

## Ideas Fase 2 (las que el user marcó interés)

(Pendiente que confirme cuáles, las propuestas que se le mostraron son:)

- 🎯 **Acciones masivas**: Bulk add to playlist, Mover likes a playlist y quitar de likes, Backup/Export JSON+CSV
- 🔍 **Descubrimiento**: Álbumes para completar, Solapamiento entre playlists, Stats por artista
- 🎨 **Smart playlists**: Por año (basado en added_at), Random N tracks, Por década (release_date)
- 🧹 **Limpieza extra**: Tracks con keywords sospechosas (demo, instrumental, intro), Tracks de <1s, Artistas con 1 sola canción

---

## Versión actual desplegada

- Git: rama `main`, último commit `e45858c` (después de `0e62d53` "feat: dedupe visual grid + album dupes feature")
- Cache bust: `?v=18`
- TEST_MODE: `true` (2500 likes, 200 playlist items)
- **Playlist espejo activa**: `anothertwo` (9.485 tracks). La vieja `another one` (11k) se borró vía script one-shot en la consola el 2026-07-03. Diferencia entre 9498 likes y 9485 en playlist = ~13 tracks locales / sin URI válido que la API no acepta agregar a playlists.
- Default de Sync Mirror ya apunta a `anothertwo` (constante `TARGET_PLAYLIST_NAME` en `src/js/features/sync.js:7`).

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

## Changelog reciente (últimos 5 cambios)

- `v=18` (0e62d53): Dedupe rediseñado (grid visual de playlists → seleccionar una → analizar) + nueva feature Álbumes repetidos. `slimPlaylist` guarda ahora `image` (URL de la cover chica). `renderPlaylistGrid`/`bindPlaylistGrid` en `ui/components.js` como componente compartido. Nueva `removePlaylistItemsAtPositions` en api.js (usa `positions` en el DELETE para preservar la primera aparición en Dedupe). Nueva ruta `#dupalbums` en app.js.
- `v=17` (adb81c0): default target "another one" → "anothertwo" (la vieja se borró vía script one-shot en consola)
- `v=16` (ae1297e): rebuild feature en Sync Mirror — usa `target.tracks.total` real para el precheck (fix bug del `v=15` donde la muestra de 200 hacía que el warning nunca dispare). Cuando target ≥10k → UI con "borrar y rehacer" o "crear another one N+1". Cuando no existe → ofrece crearla. Rebuild bypasea TEST_MODE (`getAllLikedTracks({ forceAll: true })`) para llenar con los 9500 reales. Agrega `unfollowPlaylist(id)` en api.js.
- `v=15` (e08234a): fix Sync 10k — precheck `newSize > 10000`, badge de warning en TEST_MODE, botón "Solo agregar", botón "Vaciar y llenar" (buggy: usaba la muestra en vez del total real)
- `v=14` (0aab889): checkbox lindo con gradient + animación pop del tilde
- `v=13` (525c90d): elimino Huérfanas, checkboxes en Zombis, sync mirror randomize:false
- `v=12` (1a94bd7): semántica invertida checkbox en Versiones (marcar = quedarme), fade out borradas
