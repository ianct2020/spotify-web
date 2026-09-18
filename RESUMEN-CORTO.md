# #new-releases — cuánto cuesta de verdad la discografía histórica (2026-09-18, sin deploy)

Producción sigue en **v=227**. Esta tanda **no tocó código ni deployó**: tres
mediciones y una propuesta. El re-escaneo de las 94 (plan D) **no se ejecutó**.
Detalle completo en `fonoteca-migracion/ULTIMO-CAMBIO.md` (sección del 18/09).

---

## Lo que cambia el cuadro: `/search` también tiene cuota

Paginando `/search` a fondo sobre las 94 cortadas, a los **~700 requests en
~15 min** `/search` empezó a dar **429 `QUOTA_EXCEEDED`**, el mismo cuerpo que
el nativo. `/me` y `/artists/{id}` seguían en 200. **Más de 75 minutos**
bloqueado (sondas cada 5 min, todas 429). O sea que `/search` no es gratis:
tiene una cuota ~7 veces más grande que la del nativo, pero la tiene.

⚠️ **Mientras dure, la búsqueda de la app de Ian no anda** (ficha de álbum,
resolver de ids, fallback de discografías). La gasté yo midiendo.

## Medición 1 — `/search` pagina más hondo: sí, y no devuelve basura

- **Tope de offset HOY**: `limit + offset ≤ 1000`. `offset=990` da 200;
  `offset=1000` da 400 «Limit + Offset exceeds maximum of 1000».
- Con `artist:"X"` el tope no importa: **los resultados se acaban solos**
  antes (Lana Del Rey en 66, Maroon 5 en 77, RHCP en 49). Ninguno de los 56
  artistas medidos llegó a 1000.
- **Pasada la página 4 los resultados SIGUEN siendo del artista**: Lana 63 de
  66, Maroon 5 75 de 77, RHCP 49 de 49. El filtro no los tira.
- **La trampa de las «2 páginas vacías»** cortaría antes de tiempo solo en 3 de
  56 (Michael Jackson, Radiohead, The Beatles) y pierde 1-2 lanzamientos en
  cada uno. No importa.
- **Costo**: 11,3 requests por artista cortado de media, pero 51 de 56 en ≤5
  requests; los caros son nombres cortos con ruido (Bhavi 75, Duki 59). Las 94:
  ~700-1.000 requests.
- **Contra el nativo completo** (14 artistas pedidos enteros por el nativo):

  | | lanzamientos | de 2016-2021 |
  |---|---:|---:|
  | nativo (referencia) | 789 | 367 |
  | caché actual (`/search` 4 págs) | 449 (57 %) | 174 (47 %) |
  | **`/search` sin tope** | **604 (77 %)** | **257 (70 %)** |

  Lo que `/search` no encuentra son **casi todo singles** (180 de 185): remixes,
  villancicos, colaboraciones donde el artista va de invitado («Rain On Me (with
  Ariana Grande)»). **Los EPs de 4+ temas aparecieron todos** en los 3 artistas
  con datos completos (13 de 13; la caché actual tenía 7).
- **El nativo tampoco está entero**: Lana Del Rey reporta `total: 70`, devuelve
  62, y no trae **ninguno** de sus singles de 2025-2026, que `/search` sí
  encuentra.

## Medición 2 — la cuota del nativo

- **Sonda inicial**: 200 (13:58 UTC). La cuota del 16/09 ya se había levantado.
- **Es por CANTIDAD acumulada, no por ráfaga**: 23 requests sueltos entre 13:58
  y 14:03, después 77 seguidos → 429 **exactamente en el request 100** (14:06:49).
  Los 23 de 5-8 minutos antes contaron.
- **Duración**: sigue en 429 a los **81 min** (sonda cada 5 min). Ver
  `ULTIMO-CAMBIO.md` para el número final si llegó a levantarse. Lo que se sabe
  entre las dos sesiones: más de 81 min y menos de 41 h.
- **Ritmo lento (1 cada 2-3 s)**: **NO medido**, porque la cuota no se levantó.
  Ya está preparado (temporizador en un Web Worker, que en la pestaña oculta sí
  cumple los 2,5 s). Pero que 23 requests espaciados sumaran igual ya apunta a
  que no es por ritmo.
- **¿Las sondas alargan el bloqueo?** NO medido: hace falta que se levante una
  vez para tener con qué comparar.

## Medición 3 — conservar lo conseguido: viable

- Hoy no se conserva nada: `idbGetCached` **borra** la entrada al caducar (30
  días), y los dos botones «Actualizar» borran todas las discografías.
- La clave `discover_artist_disco_v2_{id}` **es compartida** por
  `#new-releases` y `#discover-artists`, igual que el botón que la borra.
- **Refrescar lo reciente es barato**: `/search` con `artist:"X" year:2025-2026`
  = **1 request** por artista (Maroon 5: 9 resultados, los 4 del nativo
  incluidos).
- Lo que rompe (álbum renombrado, reedición, borrado) no importa para una
  ventana de novedades; para `#discover-artists` un disco borrado queda como
  tarjeta fantasma. Aceptable.

## La propuesta: (c) una mezcla, en este orden

1. **Base permanente** (sin TTL) + refresco de lo reciente con `year:`, y
   «Actualizar» que refresca lo reciente sin borrar la base.
2. **Llenar la base UNA vez con `/search` sin tope**: ~700-1.000 requests, más de
   una cuota de `/search`: en **tres tandas** de ~300, separadas, para no dejar
   la app sin búsqueda. Cubre el 70 % de 2016-2021 y todos los EPs de
   la muestra.
3. **El nativo, de goteo**: completar con él lo que falte, en tandas de 90 por
   cuota, sumando (unión) y nunca reemplazando para abajo.

**El pedido de Ian (EPs de hace 5-10 años) SÍ se puede cumplir** con lo que
Spotify expone hoy: los dos endpoints los devuelven. Lo que no se puede es
pedirlos todos de golpe ni cada mes. Hace falta además abrir la ventana de
`#new-releases` a más de 24 meses (ya estaba pendiente).
