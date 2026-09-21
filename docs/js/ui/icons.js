// Los iconos en línea de la app, en un solo sitio (v=233).
//
// POR QUÉ ESTE ARCHIVO EXISTE
//
// El ▶ estaba escrito **seis veces**, con el mismo `path` byte a byte y seis
// tamaños distintos; el ⏸, el ···, los dos ojos, la ⓘ y el disco, entre dos y
// cuatro veces cada uno. Ninguno de esos módulos se pisaba entre sí —cada uno
// tiene su propia clase CSS, verificado— así que **no es el caso de v=219**:
// aquello era una CLASE compartida y un listener ajeno reescribiendo un botón
// que no era suyo. Esto era código repetido y nada más.
//
// Pero el código repetido de un glifo falla de una forma propia y peor: **en
// silencio**. Si alguien retoca el ▶ en un archivo, las otras cinco vistas
// siguen pintando el viejo y no se rompe nada — simplemente los botones dejan
// de parecerse, y nadie lo nota hasta mirar dos vistas seguidas. No hay
// excepción, no hay test que salte, no hay consola.
//
// Y no es hipotético: ver la advertencia del ⏸ más abajo.
//
// ⚠️ SON FUNCIONES Y EL TAMAÑO VA POR PARÁMETRO, a propósito.
//
// Con constantes de tamaño fijo habría que exportar `PLAY_10`, `PLAY_12`,
// `PLAY_14` y `PLAY_15` — o sea, la misma duplicación con otro nombre y en un
// archivo más. La geometría vive acá una vez; el tamaño lo decide el que pinta,
// que es el que sabe en qué botón entra.
//
// ⚠️ NO METAS EL COLOR. Todo va en `currentColor` y lo hereda del botón, que es
// lo que hace que estos iconos sigan la paleta del usuario sin enterarse.
//
// Lo que NO vive acá: los ocho iconos de los chips de descubrir, que ya están
// centralizados en el campo `icono` de `util/discover-filters.js` (v=230) con
// su propio envoltorio. Mover aquello acá sería cambiar de sitio algo que ya
// está en un sitio solo.

/** Envoltorio relleno (▶, ⏸, ···, ♥): el glifo se pinta con `currentColor`. */
const relleno = (lado, cuerpo) =>
  `<svg viewBox="0 0 24 24" width="${lado}" height="${lado}" fill="currentColor" aria-hidden="true">${cuerpo}</svg>`;

/** Envoltorio de trazo (ojo, ⓘ, disco): mismo trazo de 1.8 en toda la app. */
const trazo = (lado, cuerpo, extra = ' stroke-linecap="round" stroke-linejoin="round"') =>
  `<svg viewBox="0 0 24 24" width="${lado}" height="${lado}" fill="none" stroke="currentColor" stroke-width="1.8"${extra} aria-hidden="true">${cuerpo}</svg>`;

/** ▶ — el triángulo de reproducir. */
export const iconoPlay = (lado) => relleno(lado, '<path d="M8 5v14l11-7z"/>');

// ⚠️ EL ⏸ TIENE DOS GEOMETRÍAS EN PRODUCCIÓN, Y NO ES UN DESCUIDO DE HOY: ya
// estaban las dos antes de esta tanda, repartidas tres y tres.
//
//   · `iconoPausa`     — dos rectángulos de 4 de ancho en x=6 y x=14 (hueco 4).
//     Lo usan la ficha de álbum, W-Three y las tarjetas de descubrir.
//   · `iconoPausaFina` — dos barras de 3.5 en x=7 y x=13.5 (hueco 3).
//     Lo usan la fila de canción compartida, #similar y #recs.
//
// **Son dos dibujos distintos**: más angostas y más juntas las segundas. En la
// app conviven, y según la vista el ⏸ se ve de una forma o de otra.
//
// Se dejan las dos, juntas y con esta nota, a propósito: unificarlas cambia el
// aspecto de tres vistas y esa es una decisión de Ian, no un arreglo. Lo que sí
// cambia es que ahora la decisión está a tres líneas de distancia y no a seis
// archivos — antes no se podía ni ver que había algo que decidir.
// Cuando se decida: borrar la que sobre y cambiar los tres llamadores.

/** ⏸ — pausa, la forma ancha (ficha de álbum, W-Three, descubrir). */
export const iconoPausa = (lado) =>
  relleno(lado, '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>');

/** ⏸ — pausa, la forma fina (fila de canción, #similar, #recs). Ver el aviso. */
export const iconoPausaFina = (lado) =>
  relleno(lado, '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>');

/** ··· — «estoy buscando el preview». Va en el mismo botón que el ▶. */
export const iconoPuntos = (lado) =>
  relleno(lado, '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>');

/** 👁 — ojo abierto: «esto está oculto, click para mostrarlo». */
export const iconoOjo = (lado) =>
  trazo(lado, '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');

/** 👁̸ — ojo tachado: «ocultar esto». */
export const iconoOjoTachado = (lado) =>
  trazo(lado, '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>');

/** ⓘ — abrir la ficha. */
export const iconoFicha = (lado) =>
  trazo(lado, '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/>');

/** ⊙ — abrir la ficha del álbum. Sin `linecap`/`linejoin`: son dos círculos. */
export const iconoDisco = (lado) =>
  trazo(lado, '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/>', '');
