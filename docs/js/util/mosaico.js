// El photomosaic: emparejar cada celda de una imagen con la portada más
// parecida, y decidir cuánto tinte lleva encima (v=250). Módulo PURO — no toca
// red, DOM ni IndexedDB —, así que se prueba en Node (`tests/mosaico.test.mjs`).
// La vista que lo usa es `features/mosaico.js`.
//
// ── Las tres decisiones que importan ────────────────────────────────────────
//
// 1. **Se compara en LAB, no en RGB.** Medido el 27/09 sobre esta misma base:
//    eligen un tile distinto en el 47 % de las celdas. Y la comparación es de
//    las NUEVE subceldas de la rejilla 3×3 contra las nueve del objetivo, no de
//    los colores medios: dos portadas con la misma media pueden no parecerse en
//    nada, y a nivel de celda el catálogo cubre mucho más color (ΔE mediano al
//    vecino más cercano 3,6 contra 8,1 por media; ver
//    `RESUMEN-MOSAICO-COLORES-2026-09-27.md` §3.4).
//
// 2. **La convención del promedio es la de `cover-color.js`: luz lineal.** El
//    objetivo pasa por `rejilla3x3Rect` del mismo módulo que calculó los tiles.
//    Si el objetivo se promediara en sRGB (que es lo que hace el canvas al
//    escalar) el mosaico entero se desplazaría ΔE 8,3.
//
// 3. **Repetición: sin tope global, con penalización por cercanía.** Con ~4.800
//    celdas y 5.715 portadas el promedio es una vez cada una, así que un tope
//    duro solo fuerza malos emparejamientos. Lo que molesta a la vista es la
//    misma portada dos veces pegada, y eso es local: se penaliza a las
//    candidatas usadas en el vecindario inmediato, y la penalización se mide en
//    las mismas unidades que la distancia (ΔE), así que es legible: «esta
//    portada tiene que ser ΔE 25 mejor que la siguiente para repetirse al lado».
//    **Y desde v=253 hay una segunda penalización, por USO TOTAL** (`PENAL_USO_DE`),
//    porque la local no alcanzaba: ver su comentario.

import { REJILLA, BYTES_POR_PORTADA, srgb8ALab, mediaDeRejilla, rejilla3x3Rect } from './cover-color.js?v=279';

const SUBCELDAS = REJILLA * REJILLA;   // 9

// Cuánto mejor tiene que ser una portada para repetirse pegada a sí misma,
// en ΔE. 25 es «un color claramente distinto»: por debajo de eso, antes que
// repetir se acepta la segunda mejor.
export const PENAL_DE = 25;
// Hasta qué distancia en celdas se considera «pegada». 2 son las 12 celdas
// ya colocadas alrededor (la fila de arriba entera y dos a la izquierda).
export const RADIO_REPETICION = 2;

// Cuánto encarece a una portada CADA vez que ya se usó, en ΔE, en TODO el
// mosaico (no solo al lado): la n-ésima repetición cuesta `n × ΔE²` de más, así
// que la celda siguiente de ese color baja a la segunda candidata, a la
// tercera, a la décima. 0 es el reparto de v=250/252.
//
// ⚠️ **No es lo mismo que subir `RADIO_REPETICION`, y la diferencia está
// medida** (28/09, imagen de prueba de 60×80 celdas, base real de 5.715
// portadas). El radio prohíbe repetir CERCA; con radio 2 y sin esto, una franja
// de 480 celdas de cielo plano se hace con **14 portadas** y las mismas ocho
// caen en una **retícula periódica** que se lee como un empapelado: no hay
// vecinas iguales (la métrica de repetición a 5×5 da 5,4 %) y aun así el patrón
// se ve. El motivo es que en una zona plana todas las celdas tienen la misma
// ganadora y la penalización local solo las obliga a turnarse entre un puñado.
//
// El valor por defecto sale de la curva de `RESUMEN-MOSAICO-VARIEDAD-2026-09-28.md`:
//
//   ΔE uso │ portadas │ ΔE del  │ ΔE FINAL │ tinte
//          │ distintas│ emparej.│ con tinte│ medio
//   ───────┼──────────┼─────────┼──────────┼──────
//        0 │      233 │   13,39 │     9,69 │ 26,3 %
//        1 │      271 │   13,67 │     9,79 │ 27,1 %
//        3 │      528 │   16,82 │    10,64 │ 34,9 %
//        6 │    1.123 │   20,42 │    11,95 │ 39,8 %
//       10 │    1.863 │   23,48 │    13,40 │ 41,6 %
//
// El codo NO está en «portadas distintas por ΔE del emparejado» —esa sube casi
// recta— sino en que **el tinte adaptativo se queda sin margen**: hasta ΔE 4 el
// tinte sube (26 % → 37 %) y recompra casi toda la pérdida; de 6 en adelante ya
// está casi al tope (40 % → 42 %) y cada portada nueva se paga entera en
// parecido. Por eso 3 por defecto, con el resto a un clic en la vista.
export const PENAL_USO_DE = 3;

// ── Cuántos resultados se guardan, y por qué ESOS números ───────────────────
//
// La vista acumula los mosaicos que se van generando. Un resultado VIVO —el que
// está arriba, con el deslizador del tinte funcionando— es carísimo: el lienzo y
// los bitmaps de sus portadas. Un resultado GUARDADO es solo su JPEG más una
// miniatura. Medido el 06/10 en la copia del perfil de Ian, con la base real de
// 5.715 portadas y la imagen canónica de 1.200×1.600:
//
//   rejilla       │ lienzo vivo │ bitmaps │ VIVO    │ JPEG (guardado) │ miniatura
//   ──────────────┼─────────────┼─────────┼─────────┼─────────────────┼──────────
//   Gruesa 60     │   44,2 MB   │ 12,4 MB │  57 MB  │    4,02 MB      │  139 KB
//   Normal 80     │   78,6 MB   │ 18,4 MB │  97 MB  │    7,15 MB      │  146 KB
//   Fina 120      │  176,9 MB   │ 30,5 MB │ 207 MB  │   16,06 MB      │  146 KB
//   Fina + Máxima │  176,9 MB   │ 48,6 MB │ 226 MB  │   16,05 MB      │  151 KB
//
// O sea: **guardar un resultado cuesta 14 veces menos que mantenerlo vivo.** Y
// eso es lo que decide el diseño: vivo hay UNO, los demás se congelan a JPEG.
//
// El RSS de todo el Chrome, muestreado desde /proc (`performance.memory` no ve
// ni los bitmaps ni el lienzo), confirma las dos cosas:
//
//   - **un lienzo entero de más = +168 MB de RSS**, medido tres veces seguidas
//     sobre el resultado de Fina (176,9 MB de backing). Dos resultados vivos no
//     entran: por eso no se guardan lienzos.
//   - **siete JPEG de 16 MB de más = +64 MB de RSS**, o sea que un blob cuesta
//     ~0,5 × sus bytes.
//   - **diez miniaturas de 768 px en `<img>` = +31 MB** al margen (la primera
//     dispara ~190 MB de andamio de Skia para reducir un lienzo de 44 MP, y ese
//     andamio no crece con las siguientes).
//
// De ahí los dos topes. Son DOS y no uno porque el peso de un resultado depende
// de la rejilla por un factor de cuatro: un tope de 6 a secas son 24 MB en
// Gruesa y 96 MB en Fina, y con una rejilla más fina todavía serían más.
//
//   - `TOPE_GUARDADOS = 6`: cinco anteriores más el vivo. Es lo que hace falta
//     para comparar variantes de una imagen y sigue siendo UN número que se
//     puede tener en la cabeza. En el peor caso medido son 6 × 16 MB = 96 MB de
//     datos ≈ 50 MB de RSS: **menos de un tercio de lo que cuesta un solo
//     lienzo vivo de más**, y menos que los +111 MB que ya cuesta generar uno en
//     Fina + Máxima en el navegador de Ian.
//   - `TOPE_BYTES_GUARDADOS = 120 MB`: el que manda si los JPEG son grandes.
//     Impide que una rejilla más fina convierta «6 resultados» en 180 MB sin que
//     nadie lo decida. En Gruesa no se activa nunca (6 × 4 MB = 24 MB).
//
// ⚠️ **Nada de esto va a IndexedDB, y es una decisión, no un olvido.** Seis
// mosaicos de Fina son 96 MB: casi siete veces la base de colores entera (14,6
// MB, que son las 5.715 portadas) y de lejos lo más grande que tendría la base
// del navegador de Ian. Y son datos DERIVADOS: la misma imagen con los mismos
// ajustes los vuelve a dar. Se guardan mientras la vista está abierta y se
// sueltan al salir, como ya hacía el único resultado que había.
export const TOPE_GUARDADOS = 6;
export const TOPE_BYTES_GUARDADOS = 120e6;

/**
 * Qué resultados sobreviven en la galería y cuáles se tiran, del más nuevo al
 * más viejo. `guardados` viene ordenado del más NUEVO al más viejo y cada uno
 * tiene `bytes`.
 *
 * ⚠️ **El más nuevo se queda siempre**, aunque él solo pase el tope de bytes: si
 * no, generar un mosaico enorme lo borraría a él mismo y la vista se quedaría
 * vacía justo después de haber trabajado un minuto. El tope de bytes recorta a
 * los ANTERIORES, que es de lo que protege.
 */
export function podarGaleria(guardados, { tope = TOPE_GUARDADOS, topeBytes = TOPE_BYTES_GUARDADOS } = {}) {
  const quedan = [], tirados = [];
  let bytes = 0;
  for (const g of guardados) {
    const esElNuevo = quedan.length === 0;
    if (!esElNuevo && (quedan.length >= tope || bytes + (g.bytes || 0) > topeBytes)) { tirados.push(g); continue; }
    quedan.push(g);
    bytes += g.bytes || 0;
  }
  return { quedan, tirados, bytes };
}

// ── El tamaño del lienzo de salida ──────────────────────────────────────────
//
// Dos topes, y de ellos sale el lado de celda de CADA rejilla.
//
// `LADO_CELDA_MAX` es 64 porque **es la variante que la caché de colores
// garantiza**: las 5.715 portadas se bajaron a 64 px para calcularles el color,
// así que ya están en la caché HTTP del navegador y el mosaico se compone sin
// pedir un byte nuevo. A 64 px la portada se dibuja 1:1, sin remuestrear.
//
// `LARGO_SALIDA_MAX` es lo que hace posible una rejilla MÁS FINA. Con el lado
// clavado en 64, pasar de 120 a 240 celdas multiplica por cuatro el área del
// lienzo: 11.520×15.360 px son 177 MP y **708 MB** de backing store, y además
// roza el tope de 16.384 px por lado de Chrome. Con el largo topado en 7.680 px
// las tres rejillas finas dan **el mismo lienzo** (120×64 = 160×48 = 240×32 =
// 7.680) y lo único que crece es de cuántas portadas está hecha la imagen, que
// es justo lo que se pidió. Medido el 06/10 en la copia del perfil, imagen de
// 1.200×1.600 y base real de 5.715 portadas:
//
//   rejilla │ celdas │  lienzo     │ backing │ JPEG 0,92 │ portadas distintas
//   ────────┼────────┼─────────────┼─────────┼───────────┼───────────────────
//      60   │  2.700 │ 2.880×3.840 │ 44,2 MB │  4,02 MB  │   755
//      80   │  4.800 │ 3.840×5.120 │ 78,6 MB │  7,15 MB  │ 1.123
//     120   │ 10.800 │ 5.760×7.680 │ 176,9 MB│ 16,06 MB  │ 1.860  (2.964 con «Máxima»)
//
// 7.680 px de largo son esos 176,9 MB, que es lo que la rejilla Fina **ya
// costaba** antes de esta tanda: las dos rejillas nuevas no suben el techo de
// memoria del lienzo ni un byte. Lo que suben es el TIEMPO del emparejado, que
// es lineal en celdas — y por eso existe `emparejarCediendo`.
export const LADO_CELDA_MAX = 64;
export const LARGO_SALIDA_MAX = 7680;

/** El lado de celda, en píxeles, que le toca a una rejilla de `n` celdas de lado largo. */
export function ladoDeCelda(n) {
  const celdas = Math.max(2, Math.round(n));
  return Math.max(8, Math.min(LADO_CELDA_MAX, Math.floor(LARGO_SALIDA_MAX / celdas)));
}

/**
 * Todo lo que define la salida para una imagen de `w`×`h` px y `n` celdas de
 * lado largo: la rejilla, el lado de celda y el lienzo en píxeles.
 *
 * Es la ÚNICA cuenta de «cuánto va a medir esto» que hay en el proyecto: la
 * vista la usa para la línea de estado y para crear el lienzo, así que lo que
 * anuncia y lo que crea no pueden separarse.
 */
export function salidaPara(w, h, n) {
  const { cols, filas } = grillaPara(w, h, n);
  const lado = ladoDeCelda(n);
  return { cols, filas, lado, celdas: cols * filas, ancho: cols * lado, alto: filas * lado };
}

// ── El objetivo ─────────────────────────────────────────────────────────────

/**
 * Cuántas celdas de cada lado para una imagen de `w`×`h` px, dado el número de
 * celdas del lado MÁS LARGO.
 *
 * Se ajusta la grilla a la imagen y no al revés: así no hay que recortar ni
 * deformar nada de lo que subió el usuario. Con una imagen 3:4 y 80 celdas de
 * lado largo salen las 60×80 que pidió Ian.
 */
export function grillaPara(w, h, celdasLadoLargo) {
  const n = Math.max(2, Math.round(celdasLadoLargo));
  if (w >= h) {
    return { cols: n, filas: Math.max(2, Math.round((n * h) / w)) };
  }
  return { filas: n, cols: Math.max(2, Math.round((n * w) / h)) };
}

/** Los bordes en píxeles de la celda `i` de `n` sobre un largo de `largo` px. */
const borde = (i, n, largo) => Math.round((i * largo) / n);

/**
 * La rejilla 3×3 de cada celda del objetivo, en un solo `Uint8Array` de
 * `cols × filas × 27` bytes (celdas por filas), más la media 1×1 de cada una
 * en `medias` (`cols × filas × 3`), que es el color del tinte.
 *
 * `rgba` es el `data` de un `ImageData` de `ancho`×`alto`. Cada celda necesita
 * al menos 3×3 px para que su rejilla tenga sentido: con menos, tira.
 */
export function rejillaDelObjetivo(rgba, ancho, alto, cols, filas) {
  if (Math.floor(ancho / cols) < REJILLA || Math.floor(alto / filas) < REJILLA) {
    throw new Error(`El objetivo es demasiado chico para esa grilla: ${ancho}×${alto} px para ${cols}×${filas} celdas (hacen falta ${REJILLA} px por lado y hay ${Math.floor(ancho / cols)}×${Math.floor(alto / filas)}).`);
  }
  const n = cols * filas;
  const datos = new Uint8Array(n * BYTES_POR_PORTADA);
  const medias = new Uint8Array(n * 3);
  for (let f = 0; f < filas; f++) {
    const y0 = borde(f, filas, alto), y1 = borde(f + 1, filas, alto);
    for (let c = 0; c < cols; c++) {
      const k = f * cols + c;
      rejilla3x3Rect(rgba, ancho, borde(c, cols, ancho), y0, borde(c + 1, cols, ancho), y1, datos, k * BYTES_POR_PORTADA);
      const m = mediaDeRejilla(datos, k * BYTES_POR_PORTADA);
      medias[k * 3] = m[0]; medias[k * 3 + 1] = m[1]; medias[k * 3 + 2] = m[2];
    }
  }
  return { datos, medias, cols, filas };
}

// ── Los tiles ───────────────────────────────────────────────────────────────

/**
 * Pasa a LAB los 27 bytes de cada portada: `Float32Array(n × 27)`, en el mismo
 * orden. Se hace UNA vez por sesión de mosaico (5.715 × 9 = 51.435
 * conversiones) y después el bucle de emparejado solo resta y multiplica.
 */
export function tilesALab(datos, n = datos.length / BYTES_POR_PORTADA) {
  const lab = new Float32Array(n * 27);
  for (let i = 0; i < n; i++) {
    const o = i * BYTES_POR_PORTADA;
    for (let c = 0; c < SUBCELDAS; c++) {
      const [l, a, b] = srgb8ALab(datos[o + c * 3], datos[o + c * 3 + 1], datos[o + c * 3 + 2]);
      const p = i * 27 + c * 3;
      lab[p] = l; lab[p + 1] = a; lab[p + 2] = b;
    }
  }
  return lab;
}

// ── El emparejado ───────────────────────────────────────────────────────────

/**
 * Para cada celda, la portada más parecida. Devuelve
 * `{ indice: Int32Array(nCeldas), de: Float32Array(nCeldas) }`, donde `de` es
 * el ΔE76 medio por subcelda del emparejamiento elegido (sin la penalización:
 * es la calidad de verdad de la celda, que es lo que gobierna el tinte).
 *
 * `onProgress(hechas, total)` se llama una vez por fila — con 5.715 candidatas
 * y 27 componentes, una fila de 60 celdas son 9,3 M multiplicaciones.
 */
export function emparejar({ objetivo, tilesLab, nTiles, penalDE = PENAL_DE, radio = RADIO_REPETICION, penalUsoDE = PENAL_USO_DE, onProgress, signal }) {
  const e = emparejadoNuevo({ objetivo, tilesLab, nTiles, penalDE, radio, penalUsoDE });
  const { cols, filas } = objetivo;
  while (e.fila < filas) {
    if (signal?.aborted) break;
    emparejarHasta(e, e.fila + 1);
    onProgress?.(e.fila * cols, cols * filas);
  }
  return { indice: e.indice, de: e.de };
}

/**
 * Lo mismo, pero **cediéndole el hilo al navegador** cada `msPorTanda` para que
 * la línea de progreso se pinte y «Detener» llegue a procesarse.
 *
 * ⚠️ **Por qué hace falta, y por qué recién ahora.** `emparejar()` es un bucle
 * síncrono: mientras corre, el hilo principal no procesa NADA, así que el texto
 * de progreso no se pinta y un clic en «Detener» no se entrega hasta que el
 * bucle termina — el `signal?.aborted` de cada fila no puede volverse `true`
 * porque el evento del clic está esperando en la cola. Con 10.800 celdas eso
 * eran ~14 s en el navegador de Ian: molesto y nada más. Con las rejillas nuevas
 * son 19.200 y 43.200 celdas, o sea del orden del minuto, y un minuto de
 * pestaña congelada con un botón de «Detener» que no hace nada no es una
 * función: es un cuelgue.
 *
 * Devuelve además `filasHechas`, que es cómo se sabe si se cortó a medias.
 */
export async function emparejarCediendo({
  objetivo, tilesLab, nTiles, penalDE = PENAL_DE, radio = RADIO_REPETICION, penalUsoDE = PENAL_USO_DE,
  onProgress, signal, msPorTanda = 60, ceder = cederAlNavegador, ahora = () => Date.now(),
}) {
  const e = emparejadoNuevo({ objetivo, tilesLab, nTiles, penalDE, radio, penalUsoDE });
  const { cols, filas } = objetivo;
  while (e.fila < filas) {
    if (signal?.aborted) break;
    const t0 = ahora();
    // Por TIEMPO y no por un número fijo de filas: una fila de 180 celdas contra
    // 5.715 portadas cuesta diez veces lo que una de 45, así que «cada 8 filas»
    // daría tandas de 5 ms en la rejilla gruesa y de medio segundo en la fina.
    do { emparejarHasta(e, e.fila + 1); } while (e.fila < filas && ahora() - t0 < msPorTanda);
    onProgress?.(e.fila * cols, cols * filas);
    await ceder();
  }
  return { indice: e.indice, de: e.de, filasHechas: e.fila };
}

/**
 * Cede el hilo de forma que el navegador lo retome **también con la pestaña
 * oculta**.
 *
 * ⚠️ **`setTimeout` no sirve acá, y no es teórico**: Chrome clampea los timers
 * de una pestaña de fondo a **uno por minuto**, y la pestaña de la extensión de
 * testeo corre oculta. Un emparejado de 60 tandas con `setTimeout(0)` tardaría
 * una hora en esa pestaña. Un `postMessage` de `MessageChannel` es una tarea de
 * la cola de macrotareas que ese clampeo no toca. Es la misma familia que la
 * regla del `requestAnimationFrame` que ya tienen escritas `covers-wallpaper.js`
 * y `features/mosaico.js`: en una pestaña de fondo, lo que depende del reloj o
 * del pintado no llega.
 */
export function cederAlNavegador() {
  if (typeof MessageChannel !== 'function') return new Promise(r => setTimeout(r, 0));
  return new Promise((res) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => { c.port1.close(); c.port2.close(); res(); };
    c.port2.postMessage(0);
  });
}

/**
 * El estado vivo de un emparejado, para poder seguirlo por tandas.
 *
 * Vive aparte del bucle a propósito: `emparejar()` y `emparejarCediendo()` son
 * dos formas de recorrer ESTE estado con `emparejarHasta()`, y el bucle interno
 * —el que cuesta `celdas × portadas × 27` multiplicaciones— está escrito **una
 * sola vez**. Dos copias del emparejado es exactamente el defecto que dejó el
 * resolutor duplicado de v=219.
 */
export function emparejadoNuevo({ objetivo, tilesLab, nTiles, penalDE = PENAL_DE, radio = RADIO_REPETICION, penalUsoDE = PENAL_USO_DE }) {
  const nCeldas = objetivo.cols * objetivo.filas;
  return {
    objetivo, tilesLab, nTiles, radio,
    indice: new Int32Array(nCeldas).fill(-1),
    de: new Float32Array(nCeldas),
    // Penalizaciones vivas, en ΔE² medio (las mismas unidades que la distancia).
    // Es un array de nTiles y no un Set porque se consulta en el bucle interno:
    // se escriben ~12 posiciones antes de cada celda y se limpian después.
    penal: new Float32Array(nTiles),
    penalMax: penalDE * penalDE,
    // Cuántas veces salió ya cada portada en TODO el mosaico. A diferencia de
    // `penal`, esto no se limpia nunca: es el reparto del catálogo.
    usos: new Int32Array(nTiles),
    penalUso: penalUsoDE * penalUsoDE,
    objLab: new Float32Array(27),
    fila: 0,
  };
}

/** Empareja las filas que falten de `e` hasta la `hasta` (sin incluirla). */
export function emparejarHasta(e, hasta) {
  const { objetivo, tilesLab, nTiles, radio, indice, de, penal, penalMax, usos, penalUso, objLab } = e;
  const { cols, filas, datos } = objetivo;
  const tope = Math.min(filas, hasta);
  for (let f = e.fila; f < tope; f++) {
    for (let c = 0; c < cols; c++) {
      const k = f * cols + c;
      const o = k * BYTES_POR_PORTADA;
      for (let s = 0; s < SUBCELDAS; s++) {
        const [l, a, b] = srgb8ALab(datos[o + s * 3], datos[o + s * 3 + 1], datos[o + s * 3 + 2]);
        objLab[s * 3] = l; objLab[s * 3 + 1] = a; objLab[s * 3 + 2] = b;
      }

      // Vecinos ya colocados: los de las filas de arriba (enteras, radio a los
      // lados) y los de la izquierda en esta fila.
      const tocados = [];
      for (let ff = Math.max(0, f - radio); ff <= f; ff++) {
        const hastaC = ff === f ? c - 1 : Math.min(cols - 1, c + radio);
        for (let cc = Math.max(0, c - radio); cc <= hastaC; cc++) {
          const i = indice[ff * cols + cc];
          if (i < 0) continue;
          const d = Math.max(Math.abs(ff - f), Math.abs(cc - c));
          // Decae con la distancia: pegada cuesta todo, a `radio` cuesta la
          // fracción que le toque. Varios vecinos con la misma portada suman.
          penal[i] += penalMax * (1 - (d - 1) / radio);
          tocados.push(i);
        }
      }

      let mejor = Infinity, mejorI = 0, mejorD = 0;
      for (let i = 0; i < nTiles; i++) {
        const p = i * 27;
        let s = 0;
        for (let j = 0; j < 27; j++) { const t = objLab[j] - tilesLab[p + j]; s += t * t; }
        const d = s / SUBCELDAS;
        const conPenal = d + penal[i] + penalUso * usos[i];
        if (conPenal < mejor) { mejor = conPenal; mejorI = i; mejorD = d; }
      }
      indice[k] = mejorI;
      de[k] = Math.sqrt(mejorD);
      usos[mejorI]++;
      for (const i of tocados) penal[i] = 0;
    }
  }
  e.fila = tope;
  return e;
}

// ── El tinte ────────────────────────────────────────────────────────────────
//
// Por qué no va plano por defecto. El informe de color del 27/09 midió el
// catálogo entero: **el 38 % de los colores de sRGB no tiene NINGUNA portada a
// ΔE 10 o menos**, y el 74 % tiene menos de cinco — pero el 26 % restante tiene
// cinco o más y no necesita tinte ninguno. Un tinte uniforme le tapa las
// portadas a esas celdas para salvar a las otras. Así que la fuerza del tinte
// sale del ΔE de CADA celda y el deslizador regula la escala.
//
// `DE_LIMPIO` y `DE_SUCIO` salen de ese informe: ΔE 4 es «acertó» (por debajo de
// la mediana de 8,1 por media y del 3,6 por celda) y ΔE 20 es la zona donde
// directamente no hay color (el 7,3 % de sRGB está a más de ΔE 20 de cualquier
// portada; el cian, a 25).
export const DE_LIMPIO = 4;
export const DE_SUCIO = 20;

/**
 * El alfa del tinte de cada celda, `Float32Array(nCeldas)`.
 *
 * - `modo: 'plano'` → `escala` en todas, que es el tinte clásico.
 * - `modo: 'adaptativo'` → `escala × w`, con `w` de 0 (ΔE ≤ 4) a 1 (ΔE ≥ 20).
 *
 * El mapa se **suaviza con una media 3×3** antes de devolverlo. Sin eso, dos
 * celdas vecinas con emparejamientos de calidad distinta reciben alfas muy
 * distintos y la frontera se ve como un escalón: el tinte deja de leerse como
 * niebla y empieza a leerse como manchas. El suavizado es sobre `w`, no sobre
 * el color, así que no mezcla colores de celdas distintas.
 */
export function mapaDeTinte({ de, cols, filas, escala, modo = 'adaptativo', suavizar = true, deLimpio = DE_LIMPIO, deSucio = DE_SUCIO }) {
  const n = cols * filas;
  const alfa = new Float32Array(n);
  if (escala <= 0) return alfa;
  if (modo === 'plano') { alfa.fill(escala); return alfa; }

  const w = new Float32Array(n);
  const rango = Math.max(1e-6, deSucio - deLimpio);
  for (let k = 0; k < n; k++) {
    w[k] = Math.max(0, Math.min(1, (de[k] - deLimpio) / rango));
  }
  if (!suavizar) {
    for (let k = 0; k < n; k++) alfa[k] = escala * w[k];
    return alfa;
  }
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < cols; c++) {
      let s = 0, m = 0;
      for (let ff = Math.max(0, f - 1); ff <= Math.min(filas - 1, f + 1); ff++) {
        for (let cc = Math.max(0, c - 1); cc <= Math.min(cols - 1, c + 1); cc++) { s += w[ff * cols + cc]; m++; }
      }
      alfa[f * cols + c] = escala * (s / m);
    }
  }
  return alfa;
}

// ── Diagnóstico ─────────────────────────────────────────────────────────────

/**
 * La TRAMA: qué porcentaje de celdas tiene su misma portada otra vez dentro de
 * la ventana de `radio` celdas a la redonda (5×5 con el radio en 2), y cuántas
 * portadas distintas hay de media en esa ventana.
 *
 * ⚠️ **Hacen falta las dos, y el 28/09 se midió por qué.** El porcentaje de
 * repetición puede dar 0 y la trama verse igual: lo que se ve en una zona plana
 * no es una portada repetida al lado, es un puñado de portadas turnándose en
 * una retícula. Esa la caza la segunda, comparándola con el techo — la ventana
 * media de una rejilla de 60×80 son 24,1 celdas, así que «9,8 distintas» es un
 * empapelado y «21,8» es ruido.
 */
export function trama({ indice, cols, filas, radio = RADIO_REPETICION }) {
  const n = cols * filas;
  const vistos = new Set();
  let conRepeticion = 0, sumaDistintas = 0, sumaVentana = 0;
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < cols; c++) {
      const yo = indice[f * cols + c];
      vistos.clear();
      let repe = false;
      for (let ff = Math.max(0, f - radio); ff <= Math.min(filas - 1, f + radio); ff++) {
        for (let cc = Math.max(0, c - radio); cc <= Math.min(cols - 1, c + radio); cc++) {
          const i = indice[ff * cols + cc];
          vistos.add(i);
          sumaVentana++;
          if (i === yo && !(ff === f && cc === c)) repe = true;
        }
      }
      if (repe) conRepeticion++;
      sumaDistintas += vistos.size;
    }
  }
  return {
    pctConRepeticion: (100 * conRepeticion) / n,
    distintasPorVentana: sumaDistintas / n,
    celdasPorVentana: sumaVentana / n,
  };
}

/** Repartos y repeticiones de un emparejamiento, para contarlo en pantalla. */
export function resumenDeEmparejado({ indice, de, cols, filas, radio = RADIO_REPETICION }) {
  const n = indice.length;
  const usos = new Map();
  for (const i of indice) usos.set(i, (usos.get(i) || 0) + 1);
  const ordenado = [...de].sort((a, b) => a - b);
  const pct = (p) => ordenado[Math.min(n - 1, Math.floor((p / 100) * n))];
  // Vecinas iguales: pares de celdas a distancia ≤ radio con la misma portada.
  let pegadas = 0;
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < cols; c++) {
      const i = indice[f * cols + c];
      for (let ff = f; ff <= Math.min(filas - 1, f + radio); ff++) {
        for (let cc = (ff === f ? c + 1 : Math.max(0, c - radio)); cc <= Math.min(cols - 1, c + radio); cc++) {
          if (indice[ff * cols + cc] === i) pegadas++;
        }
      }
    }
  }
  return {
    celdas: n,
    distintas: usos.size,
    masRepetida: Math.max(...usos.values()),
    pegadas,
    deMedio: [...de].reduce((a, b) => a + b, 0) / n,
    deMediana: pct(50),
    deP90: pct(90),
    bienEmparejadas: [...de].filter(d => d <= DE_LIMPIO).length,
    malEmparejadas: [...de].filter(d => d >= DE_SUCIO).length,
    ...trama({ indice, cols, filas, radio }),
  };
}
