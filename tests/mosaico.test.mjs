// tests/mosaico.test.mjs — el emparejado del photomosaic (v=250)
//
// Lo que protege, en orden de importancia:
//
// 1. **Que se compare en LAB y no en RGB.** El caso del par
//    «gris medio contra amarillo apagado» está construido para que RGB y LAB
//    elijan tiles DISTINTOS: si alguien «simplifica» la distancia a RGB, falla.
// 2. **Que la rejilla del objetivo salga de `cover-color.js`**, o sea en luz
//    lineal. El damero blanco/negro tiene que dar 188 en la celda, igual que en
//    `cover-color.test.mjs`: es el mismo guardián, del otro lado.
// 3. **Que la penalización por cercanía evite las vecinas iguales sin tope
//    global.** Con un catálogo de dos tiles casi iguales y un objetivo liso,
//    sin penalización sale el mismo tile en todas las celdas; con ella, no hay
//    dos pegadas.
// 4. **Que el tinte adaptativo no sea plano disfrazado**: una celda que empareja
//    bien recibe menos alfa que una que empareja mal, y el suavizado quita los
//    escalones en vez de aplanar el mapa.
// 5. **Que la penalización por USO reparta el catálogo** (v=253) y que siga
//    siendo una penalización y no un tope: con un solo tile decente, repetirlo
//    tiene que ganarle a un tile catastrófico por muchas veces que ya haya
//    salido.
//
// Corre sin navegador y sin token.
// Correr con: node tests/mosaico.test.mjs

import {
  grillaPara, rejillaDelObjetivo, tilesALab, emparejar, mapaDeTinte,
  resumenDeEmparejado, trama, PENAL_DE, RADIO_REPETICION, PENAL_USO_DE, DE_LIMPIO, DE_SUCIO,
} from '../src/js/util/mosaico.js';
import { BYTES_POR_PORTADA, srgb8ALab, mediaDeRejilla } from '../src/js/util/cover-color.js';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
function eq(a, b, nombre) {
  const bien = JSON.stringify(a) === JSON.stringify(b);
  if (!bien) console.log(`      esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
  ok(bien, nombre);
}

// Imagen RGBA de w×h pintada por (x, y) → [r, g, b].
function imagen(w, h, f) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = f(x, y); const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return d;
}
// Catálogo de tiles lisos a partir de una lista de colores.
function catalogo(colores) {
  const d = new Uint8Array(colores.length * BYTES_POR_PORTADA);
  colores.forEach(([r, g, b], i) => {
    for (let c = 0; c < 9; c++) { const o = i * BYTES_POR_PORTADA + c * 3; d[o] = r; d[o + 1] = g; d[o + 2] = b; }
  });
  return d;
}
const dist2RGB = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

console.log('La grilla se ajusta a la imagen, no la imagen a la grilla');
eq(grillaPara(1200, 1600, 80), { filas: 80, cols: 60 }, '1200×1600 con 80 de lado largo → 60×80, las que pidió Ian');
eq(grillaPara(1600, 1200, 80), { cols: 80, filas: 60 }, 'y en horizontal, 80×60');
eq(grillaPara(1000, 1000, 80), { cols: 80, filas: 80 }, 'cuadrada → cuadrada');
ok(grillaPara(4000, 100, 80).filas >= 2, 'una panorámica extrema no se queda en cero filas');

console.log('\nLA CONVENCIÓN: la rejilla del objetivo va en luz lineal');
// Una sola celda, damero blanco/negro: la media lineal es 188, la sRGB 128.
const dam = rejillaDelObjetivo(imagen(12, 12, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])), 12, 12, 2, 2);
ok([...dam.medias].every(v => Math.abs(v - 188) <= 2), `damero → media 188 y no 128 (dio ${dam.medias[0]})`);
ok(dam.datos.length === 4 * BYTES_POR_PORTADA, 'una rejilla de 27 bytes por celda');
eq([...mediaDeRejilla(dam.datos, 0)], [...dam.medias.slice(0, 3)], '`medias` es la media 1×1 de la rejilla guardada');

console.log('\nCada celda mira SU rectángulo de la imagen');
// Mitad izquierda roja, mitad derecha azul, 2×1 celdas.
const mitades = rejillaDelObjetivo(imagen(12, 6, (x) => (x < 6 ? [255, 0, 0] : [0, 0, 255])), 12, 6, 2, 1);
eq([...mitades.medias], [255, 0, 0, 0, 0, 255], 'la celda de la izquierda es roja y la de la derecha azul');
let tiro = false;
try { rejillaDelObjetivo(imagen(8, 8, () => [0, 0, 0]), 8, 8, 4, 4); } catch { tiro = true; }
ok(tiro, 'con menos de 3 px por celda tira en vez de inventar una rejilla');

console.log('\nSe compara en LAB, no en RGB');
// Objetivo: gris medio. Candidatos: uno más cerca en RGB, otro más cerca en LAB.
// A es un verde apagado y B un gris un poco más claro. En RGB A está más
// cerca del gris medio; a la vista —y en LAB— el parecido es el de B, de largo.
// Es exactamente el error que comete un mosaico comparado en RGB.
const OBJ = [128, 128, 128];
const A = [128, 150, 128], B = [150, 150, 150];
const dLabA = Math.hypot(...srgb8ALab(...OBJ).map((v, i) => v - srgb8ALab(...A)[i]));
const dLabB = Math.hypot(...srgb8ALab(...OBJ).map((v, i) => v - srgb8ALab(...B)[i]));
ok(dist2RGB(OBJ, A) < dist2RGB(OBJ, B), 'el par elegido: A está más cerca en RGB…');
ok(dLabB < dLabA, '…y B está más cerca en LAB');
{
  const datos = catalogo([A, B]);
  const objetivo = rejillaDelObjetivo(imagen(6, 6, () => OBJ), 6, 6, 2, 2);
  const { indice } = emparejar({ objetivo, tilesLab: tilesALab(datos, 2), nTiles: 2, penalDE: 0 });
  ok([...indice].every(i => i === 1), 'y el emparejado elige B, o sea que la distancia es en LAB');
}

console.log('\nLas NUEVE subceldas, no el color medio');
{
  // Dos tiles con la MISMA media (gris) y estructura opuesta; el objetivo tiene
  // la estructura del segundo. Con medias 1×1 serían indistinguibles.
  const d = new Uint8Array(2 * BYTES_POR_PORTADA);
  for (let c = 0; c < 9; c++) {
    const claro = c < 4;
    d[c * 3] = d[c * 3 + 1] = d[c * 3 + 2] = claro ? 230 : 60;                                  // tile 0
    d[27 + c * 3] = d[27 + c * 3 + 1] = d[27 + c * 3 + 2] = claro ? 60 : 230;                    // tile 1
  }
  const objetivo = rejillaDelObjetivo(imagen(9, 9, (x, y) => {
    const c = Math.floor(y / 3) * 3 + Math.floor(x / 3);
    const v = c < 4 ? 60 : 230;
    return [v, v, v];
  }), 9, 9, 1, 1);
  const { indice } = emparejar({ objetivo, tilesLab: tilesALab(d, 2), nTiles: 2, penalDE: 0 });
  eq(indice[0], 1, 'con dos tiles de media igual, gana el que coincide en estructura');
}

console.log('\nRepetición: sin tope global, con penalización por cercanía');
{
  // Objetivo liso y dos tiles casi iguales: sin penalización sale siempre el
  // mismo; con ella, ninguna vecina se repite.
  // Veinte tiles casi iguales. El vecindario de radio 2 tiene hasta 12 celdas
  // ya colocadas, así que con menos de trece tiles un tablero sin repeticiones
  // en el radio NO EXISTE y el test mediría lo imposible (ver el caso degradado
  // más abajo).
  const grises = Array.from({ length: 20 }, (_, i) => [126 + (i % 5) * 2, 128 + (i % 3) * 2, 130 - (i % 4) * 2]);
  const datos = catalogo(grises);
  const tl = tilesALab(datos, grises.length);
  const objetivo = rejillaDelObjetivo(imagen(18, 18, () => [130, 130, 130]), 18, 18, 6, 6);
  // ⚠️ Hay que apagar las DOS penalizaciones: desde v=253 `emparejar` trae
  // también la de uso, y con ella puesta este caso reparte y el assert de «un
  // solo tile» deja de medir lo que dice. Apagar una y llamarlo «sin
  // penalización» es exactamente el error que este test existe para no cometer.
  const sin = emparejar({ objetivo, tilesLab: tl, nTiles: grises.length, penalDE: 0, penalUsoDE: 0 });
  const rSin = resumenDeEmparejado({ indice: sin.indice, de: sin.de, cols: 6, filas: 6 });
  eq(rSin.distintas, 1, 'sin ninguna penalización se usa un solo tile en las 36 celdas');
  ok(rSin.pegadas > 0, 'y hay vecinas iguales');

  // Solo la de cercanía, para que este bloque siga midiendo ESA.
  const con = emparejar({ objetivo, tilesLab: tl, nTiles: grises.length, penalUsoDE: 0 });
  const rCon = resumenDeEmparejado({ indice: con.indice, de: con.de, cols: 6, filas: 6 });
  ok(rCon.distintas > 4, `con penalización entran muchos tiles (${rCon.distintas} de ${grises.length})…`);
  ok(rCon.masRepetida > 1, '…sin ningún tope global (el más usado se repite)');
  eq(rCon.pegadas, 0, `y ninguna celda repite portada en ${RADIO_REPETICION} celdas a la redonda, ni en diagonal`);

  // El caso degradado, a propósito: cuando NO hay tiles para cumplir el radio,
  // se elige el menos penalizado y se sigue. Un mosaico con repeticiones es
  // peor que uno sin ellas; uno que se niegue a existir es mucho peor.
  const pocos = catalogo([[130, 130, 130], [133, 131, 129]]);
  const apretado = emparejar({ objetivo, tilesLab: tilesALab(pocos, 2), nTiles: 2, penalUsoDE: 0 });
  const rAp = resumenDeEmparejado({ indice: apretado.indice, de: apretado.de, cols: 6, filas: 6 });
  eq(rAp.distintas, 2, 'con dos tiles para 36 celdas usa los dos…');
  ok(rAp.pegadas > 0, '…y acepta repetir en el radio en vez de no emparejar');
  ok(PENAL_DE > 0 && RADIO_REPETICION >= 1, 'los dos parámetros están a la vista y son ajustables');
}

console.log('\nEl `de` que devuelve el emparejado es la calidad REAL, sin la penalización');
{
  // Dos tiles: el gris exacto y otro a unos ΔE 9. El objetivo es el gris, así
  // que una celda se queda con el exacto y su vecina tiene que desviarse.
  const datos = catalogo([[130, 130, 130], [150, 150, 150]]);
  const objetivo = rejillaDelObjetivo(imagen(12, 12, () => [130, 130, 130]), 12, 12, 4, 4);
  const { indice, de } = emparejar({ objetivo, tilesLab: tilesALab(datos, 2), nTiles: 2 });
  const conExacto = [...indice].map((i, k) => [i, de[k]]).filter(([i]) => i === 0);
  const desviadas = [...indice].map((i, k) => [i, de[k]]).filter(([i]) => i === 1);
  ok(conExacto.every(([, d]) => d < 1), 'las celdas que se quedan con el tile exacto dan ΔE ~0');
  ok(desviadas.length > 0, 'y la penalización desvía a las vecinas');
  // Lo que importa: el ΔE que se informa es la distancia REAL al tile elegido
  // (~9), no la penalizada (que sería ≥ PENAL_DE). Si fuera la penalizada, el
  // tinte adaptativo se comería el mosaico entero.
  ok(desviadas.every(([, d]) => d > 5 && d < PENAL_DE), `las desviadas informan su ΔE de verdad (~9), no el penalizado (dio ${desviadas[0]?.[1].toFixed(1)})`);
}

console.log('\nLa penalización NO fuerza un emparejamiento catastrófico');
{
  // Mismo objetivo gris, pero el segundo tile es un rojo a ΔE ~60: repetir el
  // gris sale más barato que eso, así que la penalización se traga su coste y
  // no arruina el mosaico. Es lo que hace que no haya tope global.
  const datos = catalogo([[130, 130, 130], [200, 40, 40]]);
  const objetivo = rejillaDelObjetivo(imagen(12, 12, () => [130, 130, 130]), 12, 12, 4, 4);
  const { indice, de } = emparejar({ objetivo, tilesLab: tilesALab(datos, 2), nTiles: 2 });
  ok([...indice].every(i => i === 0), 'antes que un rojo a ΔE 60, se repite el gris');
  ok(Math.max(...de) < 1, 'y ninguna celda acaba con un ΔE grande');
}

console.log('\nEl tinte: adaptativo de verdad, no plano disfrazado');
{
  const cols = 4, filas = 1;
  const de = Float32Array.from([0, DE_LIMPIO, (DE_LIMPIO + DE_SUCIO) / 2, DE_SUCIO + 10]);
  const plano = mapaDeTinte({ de, cols, filas, escala: 0.5, modo: 'plano' });
  ok([...plano].every(v => v === 0.5), 'plano da el mismo alfa en las cuatro celdas');

  const ad = mapaDeTinte({ de, cols, filas, escala: 0.5, modo: 'adaptativo', suavizar: false });
  eq(ad[0], 0, 'una celda que empareja perfecto no lleva tinte');
  eq(ad[1], 0, `ni una que llega justo al umbral limpio (ΔE ${DE_LIMPIO})`);
  ok(Math.abs(ad[2] - 0.25) < 0.01, 'a mitad de camino, la mitad de la escala');
  ok(Math.abs(ad[3] - 0.5) < 1e-6, `pasado el umbral sucio (ΔE ${DE_SUCIO}), la escala entera y no más`);
  ok(ad[3] <= 0.5, 'el alfa nunca se pasa de la escala que pidió el usuario');

  const suave = mapaDeTinte({ de, cols, filas, escala: 0.5, modo: 'adaptativo' });
  ok(suave[1] > 0 && suave[1] < ad[2], 'suavizado: la celda limpia pegada a una sucia recibe algo, pero menos');
  eq(suave[0], 0, 'y una celda limpia rodeada de limpias sigue sin tinte');
  ok(suave[3] < ad[3], 'y la sucia baja un poco: el escalón entre vecinas se reparte');
  const media = (a) => [...a].reduce((x, y) => x + y, 0) / a.length;
  ok(Math.abs(media(suave) - media(ad)) < 0.06, 'el suavizado reparte el tinte, no lo sube ni lo baja en conjunto');

  eq([...mapaDeTinte({ de, cols, filas, escala: 0, modo: 'adaptativo' })], [0, 0, 0, 0], 'con el deslizador a 0 no hay tinte, en ningún modo');
}

console.log('\nEl resumen cuenta lo que dice contar');
{
  const cols = 3, filas = 2;
  const indice = Int32Array.from([0, 0, 1, 2, 2, 2]);
  const de = Float32Array.from([1, 2, 3, 4, 5, 30]);
  const r = resumenDeEmparejado({ indice, de, cols, filas, radio: 1 });
  eq(r.celdas, 6, 'celdas');
  eq(r.distintas, 3, 'portadas distintas');
  eq(r.masRepetida, 3, 'la más repetida');
  eq(r.malEmparejadas, 1, `celdas por encima de ΔE ${DE_SUCIO}`);
  ok(r.pegadas >= 3, 'y cuenta los pares de vecinas iguales');
}


console.log('\nLa penalización por USO reparta el catálogo, no solo el vecindario');
{
  // Doce tiles casi iguales para 100 celdas lisas. El vecindario de radio 2 se
  // cumple con unos pocos, así que la penalización LOCAL se conforma con
  // turnarse entre ellos: es exactamente el caso que produjo la retícula
  // periódica del cielo. La de uso es la que obliga a bajar por la lista.
  const grises = Array.from({ length: 12 }, (_, i) => [126 + i, 128 + (i % 3), 130 - (i % 4)]);
  const datos = catalogo(grises);
  const tl = tilesALab(datos, grises.length);
  const objetivo = rejillaDelObjetivo(imagen(30, 30, () => [130, 130, 130]), 30, 30, 10, 10);

  const soloLocal = emparejar({ objetivo, tilesLab: tl, nTiles: grises.length, penalUsoDE: 0 });
  const rLocal = resumenDeEmparejado({ indice: soloLocal.indice, de: soloLocal.de, cols: 10, filas: 10 });
  const conUso = emparejar({ objetivo, tilesLab: tl, nTiles: grises.length, penalUsoDE: PENAL_USO_DE });
  const rUso = resumenDeEmparejado({ indice: conUso.indice, de: conUso.de, cols: 10, filas: 10 });

  ok(rUso.distintas >= rLocal.distintas, `con la penalización por uso entran al menos tantos tiles (${rLocal.distintas} → ${rUso.distintas})`);
  ok(rUso.masRepetida < rLocal.masRepetida, `y el más repetido baja (${rLocal.masRepetida} → ${rUso.masRepetida})`);
  // Lo que de verdad se ve: cuántos tiles distintos hay en cada ventana de 5×5.
  ok(rUso.distintasPorVentana > rLocal.distintasPorVentana, `el vecindario de 5×5 se hace con más tiles distintos (${rLocal.distintasPorVentana.toFixed(1)} → ${rUso.distintasPorVentana.toFixed(1)} de ${rUso.celdasPorVentana.toFixed(1)})`);
  eq(rUso.pegadas, 0, 'y la penalización local sigue haciendo su trabajo: cero vecinas iguales');

  // El reparto es MONÓTONO: más penalización, nunca menos variedad.
  let previo = 0;
  for (const u of [0, 1, 3, 6, 10]) {
    const e = emparejar({ objetivo, tilesLab: tl, nTiles: grises.length, penalUsoDE: u });
    const d = resumenDeEmparejado({ indice: e.indice, de: e.de, cols: 10, filas: 10 }).distintas;
    ok(d >= previo, `uso ΔE ${u}: ${d} tiles distintos, no menos que el nivel anterior (${previo})`);
    previo = d;
  }
}

console.log('\nLa penalización por uso SIGUE siendo penalización, no tope');
{
  // Un gris exacto y un rojo a ΔE ~60, 36 celdas. Aunque el gris se haya usado
  // 35 veces, repetirlo tiene que salir más barato que poner el rojo: si esto
  // falla, alguien convirtió la penalización en un cupo y el mosaico se llena
  // de manchas para cumplir una cuota.
  const datos = catalogo([[130, 130, 130], [200, 40, 40]]);
  const objetivo = rejillaDelObjetivo(imagen(18, 18, () => [130, 130, 130]), 18, 18, 6, 6);
  const { indice } = emparejar({ objetivo, tilesLab: tilesALab(datos, 2), nTiles: 2, penalUsoDE: PENAL_USO_DE });
  ok([...indice].every(i => i === 0), `con la variedad en ${PENAL_USO_DE} se sigue repitiendo el gris antes que poner un rojo a ΔE 60`);
}

console.log('\nLa métrica de trama mide las dos cosas que hay que mirar');
{
  // Un empapelado perfecto de 2×2 tiles: NINGUNA vecina inmediata igual (el
  // mismo tile vuelve recién a distancia 2) y aun así es una retícula. Esto es
  // lo que el porcentaje de repetición solo, sin la cuenta de distintas por
  // ventana, no ve — y es el defecto real que se arregló en v=253.
  const cols = 8, filas = 8;
  const damero = new Int32Array(cols * filas);
  for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) damero[f * cols + c] = (f % 2) * 2 + (c % 2);
  const t = trama({ indice: damero, cols, filas, radio: 2 });
  ok(t.pctConRepeticion > 90, `el empapelado SÍ repite dentro de 5×5 (${t.pctConRepeticion.toFixed(0)} %)`);
  ok(t.distintasPorVentana <= 4.001, `y se hace con 4 tiles por ventana (${t.distintasPorVentana.toFixed(1)}) sobre ${t.celdasPorVentana.toFixed(1)} celdas`);

  // Todas distintas: el techo.
  const todas = Int32Array.from({ length: cols * filas }, (_, i) => i);
  const t2 = trama({ indice: todas, cols, filas, radio: 2 });
  eq(t2.pctConRepeticion, 0, 'con todas distintas no hay ninguna repetición');
  ok(Math.abs(t2.distintasPorVentana - t2.celdasPorVentana) < 1e-6, 'y las distintas por ventana llegan al techo, que es la ventana entera');
}

console.log(`\n${pasaron} bien, ${fallaron} mal`);
process.exit(fallaron ? 1 : 0);
