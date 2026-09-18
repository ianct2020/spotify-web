# #new-releases / #discover-artists — base de discografías sin caducidad (v=229, 2026-09-18)

Producción en **v=229**, verificado desde dentro de la pestaña (`app.js?v=229`,
92 módulos) tras el ritual del SW, **sin borrar la IndexedDB**. Commit `6c963ef`.
(v=228 la publicó otra sesión: «Ocultar» en lote.) Paso 1 de la propuesta (c);
**los pasos 2 y 3 no se ejecutaron**. Detalle en
`fonoteca-migracion/ULTIMO-CAMBIO.md`.

---

## Qué cambió

- **Base sin caducidad**: `discover_disco_base_v1_{id}`, compartida por las dos
  vistas. Lo reciente se mira con `/search` `year:` cada 30 días, 100 requests
  por ronda como mucho; un 429 para la ronda y se sigue sirviendo la base.
- **Unión por id de Spotify**, nunca por `albumKey`: no puede fusionar LP2/LP3,
  Crystal Castles I/II ni ÷/=/+. El nativo no reemplaza a `/search`: se suma.
  `dedupDisco` sigue agrupando ediciones al pintar, como antes.
- **Migración de las 300 que había**: 0 requests, 0 lanzamientos perdidos
  (10.359, comprobado artista por artista). Leídas en crudo aunque vencieran; las
  viejas no se borran. Refrescos escalonados en sus fechas originales.
- **Nada borra la base**: los dos «Actualizar» tiran solo el caché de escaneo, y
  «Limpiar caché» del menú (el tercer camino, que no estaba en el pedido) la
  conserva.
- **«Exportar base» / «Importar base»** en las dos vistas, con el patrón de
  `#genre`. Importar es unión e idempotente. Hoy: 2,66 MB.
- **`avisar()` de `hidden-sync.js`** deduplica por mensaje, no por tipo. Test
  que falla con el código viejo.

## Verificado en la app real

| | resultado |
|---|---|
| migración | 300 bases, 10.359 lanzamientos, 0 perdidos, 0 requests |
| «Actualizar» de `#discover-artists` | base 300/10.359 antes y después |
| «Actualizar» de `#new-releases` | base 300/10.359 antes y después |
| exportar → reimportar lo mismo | 300 iguales, 0 nuevos |
| archivo de `#genre` o de otra versión | rechazado con su motivo |

«Actualizar» se probó con `/search` todavía en 429 (más de 3 h después de
agotarse): no gastó cuota y ejercitó el corte por 429. «Limpiar caché» no se
clickeó (vacía todo lo demás); verificado leyendo el código.

## `3vil reflection` — propuesta, sin implementar

Son 11 de las 30 incidencias del registro, y se reintenta cada 24 h aunque su
motivo es definitivo (lo firma Glokk40Spaz). Propuesta: no reintentar los
motivos definitivos, avisar solo cuando cambia el estado, recordatorio semanal y
botón «Olvidar» en `#debug`.

## ⚠️ Ojo

Borrar la IndexedDB entera (el paso opcional del ritual del SW) **tira la base**.
Exportarla antes.
