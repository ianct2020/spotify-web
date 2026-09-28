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

import { REJILLA, BYTES_POR_PORTADA, srgb8ALab, mediaDeRejilla, rejilla3x3Rect } from './cover-color.js';

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
  const { cols, filas, datos } = objetivo;
  const nCeldas = cols * filas;
  const indice = new Int32Array(nCeldas).fill(-1);
  const de = new Float32Array(nCeldas);
  // Penalizaciones vivas, en ΔE² medio (las mismas unidades que la distancia).
  // Es un array de nTiles y no un Set porque se consulta en el bucle interno:
  // se escriben ~12 posiciones antes de cada celda y se limpian después.
  const penal = new Float32Array(nTiles);
  const penalMax = penalDE * penalDE;
  // Cuántas veces salió ya cada portada en TODO el mosaico. A diferencia de
  // `penal`, esto no se limpia nunca: es el reparto del catálogo.
  const usos = new Int32Array(nTiles);
  const penalUso = penalUsoDE * penalUsoDE;
  const objLab = new Float32Array(27);

  for (let f = 0; f < filas; f++) {
    if (signal?.aborted) break;
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
    onProgress?.((f + 1) * cols, nCeldas);
  }
  return { indice, de };
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
