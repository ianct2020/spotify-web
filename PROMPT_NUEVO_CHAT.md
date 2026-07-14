Hola, soy Ian. Estás retomando el proyecto **spotify-web** (una webapp que administra mi biblioteca de Spotify). Es continuación de un chat anterior que ya estaba muy largo.

## Lo primero que tenés que hacer

1. **Leé enteros estos archivos** antes de responder o tocar nada:
   - `/home/ian/spotify-web/HANDOFF.md` — estado del proyecto, features, historia, sesiones anteriores.
   - `/home/ian/spotify-web/CLAUDE.md` — notas técnicas de la API de Spotify (endpoints deprecados post-migración feb 2026, gotchas de CORS, etc.).
   - `/home/ian/.claude/projects/-home-ian/memory/spotify_web_next_queue.md` — cola de trabajo y pendientes.

2. **Confirmame en 3-4 líneas** que entendiste:
   - Cuál es el último commit deployado.
   - Qué features están implementadas.
   - Qué está pendiente.

3. **No arranques a codear** hasta que yo te confirme por dónde seguir.

## Reglas duras (no las rompas)

1. Nunca escribas archivos con heredocs en bash (`cat > archivo << EOF`). Usá siempre Edit/Write.
2. Nunca inventes endpoints o features de la Spotify API sin verificar. Si dudás, decíme y buscamos juntos.
3. Nunca hardcodees el Client Secret en el frontend. Usamos PKCE para eso.
4. Si te trabás con un bug y no salís en 3 intentos, parate y mostrame. No gastes media hora en círculos.
5. **Español rioplatense (voseo), técnico, directo.** Nada de "usted" ni saludos formales. Nada de "buenos días" si son las 2 de la tarde.

## Contexto rápido de mí

- Soy Ian, 19, dev full-stack, Mar del Plata.
- ~9500 canciones likeadas en Spotify.
- App en https://ianct2020.github.io/spotify-web/
- Cuenta Spotify user ID: `orhs6wu5ykk7ql80u92ujn74o`
- Deploy: GitHub Pages desde `/docs`. Build: `npm run build` (copia `src/` → `docs/`).
- Bump `?v=N` en `src/index.html` cada release.

## Estado al cierre de la última sesión (2026-07-13 noche)

- **Último commit**: `8c55c84` — `v=37`
- **Rate limit activo** — Ian intentó cargar sus 9538 likes varias veces y Spotify lo bloqueó. Tiene que esperar 30-60 min antes de reintentar.
- **Backup en el repo**: `docs/data/user-orhs6wu5ykk7ql80u92ujn74o.json` con 0 likes (nunca se cargó por rate limit) + 1503 tags de artistas.

## Lo primero que hay que hacer cuando arranquemos

1. Confirmame el estado del rate limit (yo te digo cuánto pasó).
2. Voy a intentar cargar los 9538 likes UNA vez desde Dashboard → "Cargar desde Spotify". Con el throttle nuevo de 600ms tarda ~3-4 min.
3. Cuando termine y aparezcan los gráficos:
   - Dashboard → "Exportar todo" → se baja `user-orhs6wu5ykk7ql80u92ujn74o.json` con los 9538 likes.
   - Yo te digo cuándo bajó el archivo. Vos lo movés desde `/home/ian/Descargas/user-orhs6wu5ykk7ql80u92ujn74o.json` a `/home/ian/spotify-web/src/data/`, hacés build + commit + push.
4. Verificamos que el auto-load funciona: recargamos, chequeamos que el toast diga "Backup cargado" y **no** empiece a paginar de cero.
5. **Después testeamos**:
   - Multi-género en Por género (seleccionar 2-3 géneros y crear playlist unificada).
   - Card "Sin clasificar" en Por género.
   - Sync desde Stats.fm.
   - Si el bug de popularidad sigue: mirar el mensaje que muestra el Dashboard (te dice el % exacto de tracks sin `popularity` — con eso decidimos si el bug es de la API o de datos).

## Cosas que NO hay que hacer

- No re-derivar contexto. Todo está en HANDOFF y memoria. Leelos primero.
- No agregar features nuevas sin que te lo pida.
- No cambiar CLAUDE.md salvo que descubras un endpoint nuevo o gotcha.
- No pushear código sin build previo (el HTML apunta a `?v=N` y si no bumpaste, GitHub Pages sirve la versión vieja del cache).
- No usar TEST_MODE (fue rippado por completo en v=27).

## Extras técnicos importantes

- **Cache TTL**: 24h para likes. Si Ian entra en el mismo día no re-carga.
- **Auto-load**: al login, la app hace `fetch('data/user-<spotifyId>.json')`. Si existe, mergea al cache local.
- **Formato único unificado**: `user-<id>.json` con `{likes, tags, spotifyUserId}`. Los formatos viejos `spotify-tools-likes` y `spotify-tools-genres` siguen siendo aceptados como import (retrocompat).
- **Stats.fm**: sin API key. Username en localStorage `statsfm_username` (mío es `i.an.iam`). 1 request lifetime trae top 1000 con géneros de Spotify.
- **Last.fm**: API key `cdd56ad523b6142afaeb4ae9fcad62b1` (mía, en localStorage). Username `i-an-iam`.

---

Cuando termines de leer los archivos y esté todo claro, decíme "listo, arranco" y ahí te digo por dónde.
