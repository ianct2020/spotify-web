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
| **Dedupe** | ⏳ No probado aún | Detecta URI repetido dentro de una sola playlist (distinto a Versiones) |
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

---

## Próximos pasos (en orden, por confirmar con user)

1. **Probar Sync Mirror** con los 3 modos nuevos (Solo agregar es el modo seguro en TEST_MODE)
2. **Probar Dedupe** end-to-end
3. **Dashboard prettify**
4. **Flipear `TEST_MODE = false`** en api.js (y commit), bumpear cache, build, push
5. **Pasar a Fase 2**

## Ideas Fase 2 (las que el user marcó interés)

(Pendiente que confirme cuáles, las propuestas que se le mostraron son:)

- 🎯 **Acciones masivas**: Bulk add to playlist, Mover likes a playlist y quitar de likes, Backup/Export JSON+CSV
- 🔍 **Descubrimiento**: Álbumes para completar, Solapamiento entre playlists, Stats por artista
- 🎨 **Smart playlists**: Por año (basado en added_at), Random N tracks, Por década (release_date)
- 🧹 **Limpieza extra**: Tracks con keywords sospechosas (demo, instrumental, intro), Tracks de <1s, Artistas con 1 sola canción

---

## Versión actual desplegada

- Git: rama `main`, próximo commit cambia target default a "anothertwo"
- Cache bust: `?v=17`
- TEST_MODE: `true` (2500 likes, 200 playlist items)
- **Playlist espejo activa**: `anothertwo` (9.485 tracks). La vieja `another one` (11k) se borró vía script one-shot en la consola el 2026-07-03. Diferencia entre 9498 likes y 9485 en playlist = ~13 tracks locales / sin URI válido que la API no acepta agregar a playlists.

---

## Reglas para mantener este archivo

**Cuando hagas un cambio:**
1. Actualizá la sección **Estado actual de features** si tocaste una feature
2. Actualizá **Versión actual desplegada** con el nuevo commit hash y `?v=N`
3. Si descubrís un nuevo gotcha de API → agregalo a **Fix histórico clave**
4. Si el user toma una decisión nueva → agregala a **Reglas duras** o **Próximos pasos**
5. Mantenelo conciso. No es un changelog — es un mapa para retomar.

---

## Changelog reciente (últimos 5 cambios)

- `v=17`: default target "another one" → "anothertwo" (la vieja se borró vía script one-shot en consola)
- `v=16` (ae1297e): rebuild feature en Sync Mirror — usa `target.tracks.total` real para el precheck (fix bug del `v=15` donde la muestra de 200 hacía que el warning nunca dispare). Cuando target ≥10k → UI con "borrar y rehacer" o "crear another one N+1". Cuando no existe → ofrece crearla. Rebuild bypasea TEST_MODE (`getAllLikedTracks({ forceAll: true })`) para llenar con los 9500 reales. Agrega `unfollowPlaylist(id)` en api.js.
- `v=15` (e08234a): fix Sync 10k — precheck `newSize > 10000`, badge de warning en TEST_MODE, botón "Solo agregar", botón "Vaciar y llenar" (buggy: usaba la muestra en vez del total real)
- `v=14` (0aab889): checkbox lindo con gradient + animación pop del tilde
- `v=13` (525c90d): elimino Huérfanas, checkboxes en Zombis, sync mirror randomize:false
- `v=12` (1a94bd7): semántica invertida checkbox en Versiones (marcar = quedarme), fade out borradas
