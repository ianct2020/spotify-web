# #new-releases — por qué se caía el catálogo de artista (v=225 + v=226 + v=227)

Producción en **v=227**, verificado desde dentro de la pestaña después del
ritual del SW (1 SW desregistrado, `fonoteca-sw-v1` borrada, solo `history_*`
de IndexedDB, recarga con `?v227check=1`). `app.js?v=227` y todos los módulos
en v=227. Detalle completo en `fonoteca-migracion/ULTIMO-CAMBIO.md`.

---

## A. La causa, medida: 429 por cuota

- **429**, cuerpo `reason: "QUOTA_EXCEEDED"`. Ningún 400 ni 403.
- Salta a los **100 requests exactos** al nativo, en ~33 s: **20 artistas**.
- **`Retry-After` ilegible**: el navegador solo deja leer `cache-control` y
  `content-type`.
- **Solo ese endpoint**: con él en 429, `/artists/{id}`, `/albums/{id}/tracks`,
  `/search` y `/me` daban 200. Y daba 429 para cualquier artista.
- **Dura más de 23 min** (18 sondas, todas 429). El final no se midió: la
  extensión de Chrome se desconectó antes de leer la última sonda.

Cómo se vio: v=225 guarda cada 429 y cada cambio de endpoint en
`sessionStorage.fonoteca_artist_albums_diag` (también exportado como
`artistAlbumsDiag`), en vez del `console.warn` que la extensión no lee.

## B. Pausa, no abandono

429 → nativo en **pausa de 5 min que se dobla** (tope 60) y mientras tanto
`/search`; un 200 la resetea. 400/403 → abandono para la sesión, **dicho en
pantalla**. Nativo sin reintentos. Verificado en vivo: pausa de 5 min, ningún
request al nativo durante la pausa, reintento de un request al vencer, pausa
doblada a 10 min. **Falta ver** la vuelta a 200 (la cuota no se levantó).

Elegí el camino del 429 porque es lo que dijo A: el endpoint no está muerto,
responde bien los primeros 100 requests de cada sesión.

## C. Aviso en `#new-releases`

> Discografía incompleta en al menos 94 de 300 artistas: Spotify no dejó pedir
> el catálogo entero y pueden faltar lanzamientos antiguos.

94 = 93 por `/search` con 40 exactos + 1 nativa en el tope de 200. «Al menos»
porque las discografías viejas no guardaban su fuente y 34 de `/search` con
35-39 pueden estar cortadas también. Desde v=226 cada discografía nueva guarda
`{fuente, cortada}` exacto. v=227 corrigió la estimación (fechas de solo año:
daba 96).

## D. Re-escanear las cortadas — plan, NO ejecutado

~**700 requests** las 94 (~850 con las 34 dudosas) = **7 cuotas**. 429
seguro. Plan: medir antes si pidiendo despacio se esquiva la cuota; re-escaneo
solo-nativo que reemplaza la caché solo si trae la discografía entera; tandas
de 90 requests por orden de likes; reanudable. No usar «Actualizar».

## De paso

- `newrel_loaded_more` quedó en **300** (el escaneo de A usó «+50»).
- Toast preexistente de ocultos de «descubrir» sin subir a la playlist: no
  investigado.
- `CLAUDE.md` y `CONTEXTO-TECNICO.md` decían que el fallback era ante 400/403
  y con `console.warn`: corregidos.
