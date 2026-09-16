# #genre — auditoría de un grupo (v=222 + v=223)

Producción en **v=223**, verificado desde dentro de la pestaña después del
ritual del SW (1 SW desregistrado, `fonoteca-sw-v1` borrada, recarga con
`?v223b=1`). `app.js?v=223` + las tres hojas en v=223.

---

## Reconocimiento (las tres preguntas)

**¿Dónde vive el mapeo?** En `features/by-genre.js`, en dos variables de módulo
que sobreviven al render: `artistToTags` (Map artista → tags de Last.fm, como
mucho `TOP_TAGS_PER_ARTIST` y ya filtrados por `NOISE_TAGS`) y `genreMap`
(Map bucket → array de tracks). El reparto lo hace `buildGenreMap()`.

**¿Es reversible?** **Sí, del todo, y sin pedir nada a la red.** El grupo →
tracks está guardado literal (`genreMap`), y el tag concreto que metió a cada
track se recalcula con los mismos datos que ya están en memoria: son los tags
del artista cuyo bucket cae en ese grupo. No hizo falta guardar nada nuevo ni
tocar el clasificador.

⚠️ **El reparto mira SOLO al primer artista del track** (`track.artists[0]`).
La vista lo dice y marca los featurings con un `+N`, porque si no la auditoría
mentiría sobre el motivo.

**¿El toggle cambia el grupo?** **Sí.** `buildGenreMap` se bifurca según
`groupsMode` y el toggle rehace la vista entera. La auditoría lee las mismas
variables, así que lo respeta sola: verificado en la app con «Agrupar
parecidos» **apagado** → el grupo `trap` sale con 1.517 tracks, un solo chip
posible (`trap`) y la cabecera dice «con Agrupar parecidos apagado».

---

## La forma elegida: **modal**, y por qué

La grilla son ~98 tarjetas en `.smart-grid`: expandir una en el sitio empuja a
las otras 97 y te hace buscar de nuevo dónde estabas. Una ruta aparte pierde la
selección de tags, el filtro de búsqueda y el orden que ya tenías cargados, y
habría que inventarle navegación y vuelta; el modal se apila en `modal-stack` y
hereda Esc, backdrop, candado del body y botón de volver sin escribir nada.

---

## Qué se ve

Se entra por el enlace **«auditar»** en la meta de cada tarjeta (siempre
visible; el ✕ de ocultar sigue en hover porque es destructivo). El clic no
selecciona el grupo: se para antes.

- **Cabecera**: grupo, nº de tracks, nº de artistas y en qué modo del toggle.
- **Chips de tag con recuento** — la herramienta de auditoría de verdad. Se
  clican y filtran. Para Rock: `rock 1491 · indie rock 530 · alternative rock
  482 · classic rock 343 · … · rap rock 24`. Ese último ya señala el error sin
  abrir una canción.
- **Buscador** por artista o canción.
- **Lista** con nº, canción, artista (`+N` si hay featurings) y **los chips del
  género concreto que lo hizo entrar**, en el orden de popularidad de Last.fm.
- **Orden por motivos**: arriba los que entraron por **un solo tag**, que son
  los más frágiles; dentro de eso por artista, para que el error de un artista
  se vea como el bloque que es.

Estilo: chasis `.wt-modal` de W-Three y `.wthree-track-tag` para los chips, tal
cual. No se copió ningún número suyo a mano.

---

## Lo medido en la app real

| prueba | resultado |
|---|---|
| Rock | 2.042 tracks · 496 artistas · 45 chips de tag |
| Hip-Hop / Rap (el más grande) | 3.759 tracks · 626 artistas · **abre en 54,3 ms** |
| filas en el DOM al abrir | **60 de 3.759** |
| tras dos scrolls reales | 120 de 3.759, fila 77 a la vista |
| fondo con el modal abierto | `scrollY` 0, `body` en `fixed` — no se mueve |
| toggle apagado → grupo `trap` | 1.517 tracks, chip único `trap`, cabecera correcta |

### Dos honestidades sobre la verificación

⚠️ **El scroll incremental NO se puede medir por script en esta pestaña.** Corre
con `visibilityState: "hidden"`, así que `setTimeout` va clampeado a 1/min y el
`IntersectionObserver` no dispara con un `scrollTop` puesto a mano: dos
`Runtime.evaluate` murieron a los 45 s. Los 120 de 3.759 están medidos con
**rueda de verdad** desde el `computer` y una captura por tanda.

⚠️ **El `overscroll-behavior: contain` de v=223 se metió por una lectura
equivocada.** Vi el fondo en `y=1000` con el modal «abierto» y lo tomé por fuga
de la rueda; en realidad el modal ya se había cerrado — lo cerró la última línea
de un script que había dado timeout y siguió corriendo. Repetida la prueba
limpia, el fondo **no se movía** ni antes. El candado se queda igual porque es
la convención del repo (`.picker-scroll`, `.ac-albums-scroll`, `.sidebar-nav` de
v=221) y esta lista es la que más veces toca el borde, pero **no arregló ningún
fallo observado**.

---

## Lo que encontró la auditoría (material para la tanda siguiente)

**El culpable con nombre y apellido: el tag `rap rock`**, que está en la lista
de Rock de `genre-groups.js`. Mete **24 tracks** en Rock, y son de raperos:

| track | artista | el género que lo metió en Rock |
|---|---|---|
| ALMA DINAMITA | WOS | `rap rock` |
| ANDRÓMEDA | WOS | `rap rock` |
| BOUNCE WIT ME | Kenny Mason | `rap rock` |
| N. Michigan Gospel | 99 Neighbors | `rap rock` |
| Tontine | 99 Neighbors | `rap rock` |

Los 24 se reparten en 4 artistas: **WOS 14, Kenny Mason 5, ezcodylee 3,
99 Neighbors 2**. Ninguno tiene un segundo motivo: `rap rock` es el único tag
que los mete ahí, así que sacarlo de `GROUPS['Rock']` los devuelve enteros a
Hip-Hop / Rap sin arrastrar nada más.

**El segundo sospechoso, más flojo: `psychedelic` (97 tracks).** Trae Jungle
(16), Thundercat (9), Djo (7), Grimes… que no son rock, pero también trae Jimi
Hendrix y MGMT, que sí. Ese pide criterio, no un borrado.

---

## Archivos

| archivo | qué |
|---|---|
| `src/js/util/genre-reason.js` | **nuevo** — `bucketFor` (EL criterio de reparto), `reasonsFor`, `tallyReasons` |
| `src/js/features/genre-detail.js` | **nuevo** — el modal de auditoría |
| `src/js/features/by-genre.js` | `buildGenreMap` pasa a importar `bucketFor` en vez de repetirlo; enlace «auditar» en la tarjeta |
| `src/css/main.css` | estilos `.gd-*` y `.genre-audit-btn` |
| `tests/genre-reason.test.mjs` | **nuevo** — 22 asserts |

`buildGenreMap` tenía el criterio escrito a mano y ahora lo importa: mismo
comportamiento, pero ya no puede divergir de la explicación que da la
auditoría — que es exactamente lo que costó la tanda de v=219.

**No se tocó el clasificador.** Suite entera: 22 archivos, 0 fallos.
