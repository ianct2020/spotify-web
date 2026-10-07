// Suite «el mosaico se acumula y se puede hacer más fino» (v=277).
//
// Las dos decisiones de esta tanda, y lo que protege cada assert:
//
// 1. **No se pierde el mosaico anterior.** Antes, generar uno destruía el que
//    había (`soltarSalida()` al principio de `componer()`) y no quedaba nada. Lo
//    que lo hace posible es que un resultado GUARDADO cuesta 14 veces menos que
//    uno VIVO: vivo son el lienzo (44 a 177 MB) más los bitmaps de sus portadas
//    (12 a 49 MB); guardado es su JPEG (4 a 16 MB) y una miniatura (146 KB). Las
//    dos cifras están medidas el 06/10 en la copia del perfil y la tabla vive al
//    lado de los topes, en `util/mosaico.js`.
// 2. **Una rejilla más fina no puede hacer crecer el lienzo.** Con el lado de
//    celda clavado en 64, 240 celdas de lado largo daban 11.520×15.360 px = 177
//    MP y **708 MB** de backing store. `ladoDeCelda()` topa el largo en 7.680 px,
//    así que de 120 en adelante las tres rejillas dan el MISMO lienzo y lo único
//    que crece es de cuántas portadas está hecha la imagen.
//
// Lo que NO puede probar: el pixel. Una vista no se monta en Node. El dibujo con
// celdas de 48 px lo cubre `tests/banco/mosaico.html` (segunda pasada del modo
// auto) y el de 32 px con portadas de verdad, la copia del perfil.
//
// Correr con: node tests/mosaico-galeria.test.mjs

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  ladoDeCelda, salidaPara, grillaPara, podarGaleria, TOPE_GUARDADOS, TOPE_BYTES_GUARDADOS,
  LADO_CELDA_MAX, LARGO_SALIDA_MAX, rejillaDelObjetivo, tilesALab, emparejar, emparejarCediendo,
} from '../src/js/util/mosaico.js';
import { BYTES_POR_PORTADA } from '../src/js/util/cover-color.js';

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`); };

const vista = readFileSync(new URL('../src/js/features/mosaico.js', import.meta.url), 'utf8');
const lienzo = readFileSync(new URL('../src/js/features/mosaico-lienzo.js', import.meta.url), 'utf8');
const banco = readFileSync(new URL('banco/mosaico.html', import.meta.url), 'utf8');

// ── A. el lado de celda y el tamaño del lienzo ────────────────────────────────
console.log('\nA. el lado de celda sale de topar el lienzo, no de una constante');

eq(LADO_CELDA_MAX, 64, 'la celda no pasa de 64 px, que es el tamaño con el que se bajó la base de colores');
eq(LARGO_SALIDA_MAX, 7680, 'y el lado largo del lienzo no pasa de 7.680 px');
for (const [celdas, lado] of [[60, 64], [80, 64], [120, 64], [160, 48], [240, 32]])
  eq(ladoDeCelda(celdas), lado, `con ${celdas} celdas de lado largo la celda mide ${lado} px`);

// Lo que esto compra: las tres rejillas finas dan EL MISMO lienzo.
const finas = [120, 160, 240].map(g => salidaPara(1200, 1600, g));
eq(finas.map(s => `${s.ancho}×${s.alto}`), ['5760×7680', '5760×7680', '5760×7680'],
  'de «Fina» en adelante el lienzo ya no crece: las tres dan 5.760×7.680 px');
ok(finas[2].celdas === 4 * finas[0].celdas,
  `y la más fina tiene cuatro veces las celdas de «Fina» (${finas[2].celdas} contra ${finas[0].celdas})`);
ok(finas.every(s => Math.max(s.ancho, s.alto) <= LARGO_SALIDA_MAX),
  'ninguna pasa el tope del lado largo');

// El contrafáctico, que es el motivo del tope: con la celda clavada en 64.
const sinTope = { ancho: finas[2].cols * 64, alto: finas[2].filas * 64 };
ok(sinTope.ancho * sinTope.alto * 4 > 700e6,
  `con la celda clavada en 64, la rejilla más fina pediría ${Math.round(sinTope.ancho * sinTope.alto * 4 / 1e6)} MB de lienzo`);
ok(sinTope.alto > 15000, `y ${sinTope.alto} px de alto, rozando el tope de 16.384 px de Chrome`);

// Ni el lado ni la rejilla se separan: `salidaPara` es la única cuenta.
for (const [w, h, g] of [[1200, 1600, 80], [1600, 1200, 120], [1000, 1000, 240], [800, 600, 60]]) {
  const s = salidaPara(w, h, g), r = grillaPara(w, h, g);
  eq([s.cols, s.filas], [r.cols, r.filas], `salidaPara(${w},${h},${g}) usa la misma rejilla que grillaPara`);
  eq([s.ancho, s.alto], [r.cols * s.lado, r.filas * s.lado], `y el lienzo es la rejilla por el lado (${w}×${h}, ${g})`);
  eq(s.celdas, r.cols * r.filas, `y las celdas son el producto (${w}×${h}, ${g})`);
}
eq(ladoDeCelda(1), ladoDeCelda(2), 'una rejilla imposible se trata como la mínima (2), no da un lado raro');
ok(ladoDeCelda(5000) >= 8, 'y una rejilla absurda sigue dando una celda dibujable, no 0 ni negativa');

// ── B. cuántos resultados se guardan ─────────────────────────────────────────
console.log('\nB. la galería: dos topes, y el más nuevo nunca se tira');

eq(TOPE_GUARDADOS, 6, 'se guardan 6 resultados');
eq(TOPE_BYTES_GUARDADOS, 120e6, 'o 120 MB, lo que llegue primero');

const g = (id, mb) => ({ id, bytes: mb * 1e6 });
const ids = (r) => r.quedan.map(x => x.id);

// El tope por CANTIDAD manda cuando los JPEG son chicos (Gruesa: 4 MB).
eq(ids(podarGaleria([1, 2, 3, 4, 5, 6, 7, 8].map(i => g(i, 4)))), [1, 2, 3, 4, 5, 6],
  'con ocho de 4 MB quedan los seis más nuevos');
eq(podarGaleria([1, 2, 3, 4, 5, 6, 7, 8].map(i => g(i, 4))).tirados.map(x => x.id), [7, 8],
  'y los dos más viejos se dan por tirados, para poder soltar sus object URL');

// El tope por BYTES manda cuando son grandes. 6 × 16 MB = 96 MB entran; 6 × 25 no.
eq(ids(podarGaleria([1, 2, 3, 4, 5, 6].map(i => g(i, 16)))), [1, 2, 3, 4, 5, 6],
  'seis de Fina (16 MB) entran: son 96 MB de 120');
eq(ids(podarGaleria([1, 2, 3, 4, 5, 6].map(i => g(i, 25)))), [1, 2, 3, 4],
  'seis de 25 MB no: el tope de bytes corta en cuatro');
ok(podarGaleria([1, 2, 3, 4, 5, 6].map(i => g(i, 25))).bytes <= TOPE_BYTES_GUARDADOS,
  'y lo que queda cabe en el presupuesto');

// ⚠️ El más nuevo se queda SIEMPRE, aunque él solo pase el tope.
eq(ids(podarGaleria([g('nuevo', 300), g('viejo', 4)])), ['nuevo'],
  'un resultado que solo él pasa el tope no se borra a sí mismo');
eq(ids(podarGaleria([])), [], 'una galería vacía no rompe');
eq(ids(podarGaleria([g('solo', 4)])), ['solo'], 'y con uno queda uno');
// El orden es el de entrada (más nuevo primero) y no se reordena por tamaño.
eq(ids(podarGaleria([g('a', 1), g('b', 50), g('c', 1)])), ['a', 'b', 'c'], 'el orden no se toca');

// ── C. el emparejado por tandas da LO MISMO que el de un tirón ────────────────
console.log('\nC. emparejarCediendo: mismo resultado, pero se puede detener');

const w = 90, h = 120;
const rgba = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4;
  rgba[i] = (x * 5) % 256; rgba[i + 1] = (y * 7) % 256; rgba[i + 2] = (x + y) % 256; rgba[i + 3] = 255;
}
const nT = 30, datos = new Uint8Array(nT * BYTES_POR_PORTADA);
for (let i = 0; i < nT; i++) for (let c = 0; c < 9; c++) {
  const o = i * BYTES_POR_PORTADA + c * 3;
  datos[o] = (i * 9) % 256; datos[o + 1] = (i * 23) % 256; datos[o + 2] = (i * 41) % 256;
}
const rej = salidaPara(w, h, 20);
const objetivo = rejillaDelObjetivo(rgba, w, h, rej.cols, rej.filas);
const tilesLab = tilesALab(datos, nT);
const deUnTiron = emparejar({ objetivo, tilesLab, nTiles: nT });
const porTandas = await emparejarCediendo({ objetivo, tilesLab, nTiles: nT, msPorTanda: 0 });
eq([...porTandas.indice], [...deUnTiron.indice], 'la portada de cada celda es la misma que de un tirón');
eq([...porTandas.de], [...deUnTiron.de], 'y el ΔE de cada celda también');
eq(porTandas.filasHechas, rej.filas, 'y termina todas las filas');

// Que «Detener» DETENGA: el síncrono no puede, porque el clic espera en la cola.
const ctrl = new AbortController();
let cedidas = 0;
const cortado = await emparejarCediendo({
  objetivo, tilesLab, nTiles: nT, msPorTanda: 0, signal: ctrl.signal,
  ceder: async () => { if (++cedidas === 2) ctrl.abort(); },
});
ok(cortado.filasHechas > 0 && cortado.filasHechas < rej.filas,
  `abortar a mitad corta: hizo ${cortado.filasHechas} de ${rej.filas} filas`);
ok(cedidas >= 2, `y cedió el hilo ${cedidas} veces, que es lo que permite que el aborto llegue`);
// El progreso se avisa por tanda, no una sola vez al final.
let avisos = 0;
await emparejarCediendo({ objetivo, tilesLab, nTiles: nT, msPorTanda: 0, onProgress: () => avisos++ });
ok(avisos > 1, `el progreso se avisa ${avisos} veces: la línea de estado puede moverse`);

// ── D. lo que la vista tiene que seguir haciendo ─────────────────────────────
console.log('\nD. la vista: cinco rejillas, el anterior se congela, y nada queda colgado');

const grillas = [...vista.matchAll(/\{ n: (\d+), etiqueta: '([^']+)'/g)].slice(0, 5);
eq(grillas.map(m => Number(m[1])), [60, 80, 120, 160, 240], 'la vista ofrece cinco rejillas');
ok(/const GRILLA_DEFECTO = 80;/.test(vista), 'y la de arranque sigue siendo 80');
ok(!/\$\{g\.etiqueta\} · \$\{g\.n\}/.test(vista),
  'la etiqueta del botón NO lleva el número: con cinco opciones la barra se partía en dos filas');
ok(/data-grilla="\$\{g\.n\}" title=/.test(vista), 'el número exacto vive en el title');

ok(!/\bLADO_CELDA\b/.test(vista), 'la vista ya no tiene un lado de celda fijo');
ok(/ladoCelda: lado/.test(vista), 'le pasa al pincel el lado que calculó salidaPara');
ok(/salidaPara\(pixelesObjetivo\.ancho, pixelesObjetivo\.alto, ladoLargo\)/.test(vista),
  'y el lienzo se crea con esa misma cuenta, no con otra');
ok(/await emparejarCediendo\(/.test(vista) && !/\bemparejar\(\{/.test(vista),
  'empareja cediendo el hilo, no de un tirón');

// El congelado: antes de soltar, y en ese orden.
const iCongela = vista.indexOf('await congelarUltimo()');
const iSuelta = vista.indexOf('soltarSalida();', iCongela);
ok(iCongela > 0 && iSuelta > iCongela,
  'componer() congela el resultado anterior ANTES de soltarlo: es el bug que abre la tanda');
ok(/podarGaleria\(guardados\)/.test(vista), 'y aplica los topes medidos en vez de acumular sin fin');
ok(/for \(const t of tirados\) if \(t\.url\) URL\.revokeObjectURL\(t\.url\)/.test(vista),
  'lo que se tira suelta su object URL (no se liberan solos)');
ok(/for \(const g of guardados\) if \(g\.url\) URL\.revokeObjectURL\(g\.url\)/.test(vista),
  'y al salir de la vista se sueltan todos');
ok(/m\.width = m\.height = 0;/.test(vista), 'el lienzo de la miniatura también se pone a 0×0');
ok(/const CALIDAD_JPEG = 0\.92;/.test(vista)
  && (vista.match(/toBlob\(r?e?s?, 'image\/jpeg', CALIDAD_JPEG\)/g) || []).length >= 2,
  'lo que se guarda y lo que se descarga son el MISMO JPEG: una sola calidad, usada en los dos sitios');
ok(/ultimo\.tinte = tinte; ultimo\.modo = modo;/.test(vista),
  'el tinte de la ficha es el que se está pintando, no el que había al generar (el deslizador repinta sin regenerar)');
ok(/yaGuardado\(ultimo\)/.test(vista), '«Guardar esta» no deja el mismo mosaico dos veces');
ok(/id="mos-guardar"/.test(vista), 'y existe el botón que lo guarda sin regenerar');
ok(/PX_MINIMOS_POR_CELDA/.test(vista) && /demasiado chica para la rejilla/.test(vista),
  'si la imagen no da para la rejilla se dice antes de generar, no con un toast al final');

// ── E. el pincel remuestrea cuando la celda es más chica que la miniatura ────
console.log('\nE. el pincel: con celdas de menos de 64 px hay que remuestrear');

ok(/export const LADO_NATIVO_TAPA = 64;/.test(lienzo), 'el pincel sabe a qué tamaño se bajó la miniatura');
ok(!/imageSmoothingEnabled = false;/.test(lienzo),
  'y ya no apaga el suavizado a secas: a 64→32 sin suavizar se tiran tres de cada cuatro píxeles');
ok(/const nativo = ladoCelda === ladoNativo;/.test(lienzo) && /ctx\.imageSmoothingEnabled = !nativo;/.test(lienzo),
  'lo apaga SOLO cuando la celda mide lo que la miniatura');

// ── F. el banco cubre el camino nuevo ────────────────────────────────────────
console.log('\nF. el banco dibuja de verdad con la celda más chica');

ok(/const LARGO_FINO = 160;/.test(banco), 'el modo auto hace una segunda pasada con rejilla fina');
ok(/fino\.lado < 64/.test(banco), 'y comprueba que esa pasada usa una celda más chica que la miniatura');
ok(/\{ 160: 48, 240: 32 \}/.test(banco),
  'con una tabla propia como oráculo, no con ladoDeCelda (si no, una mutación pasaría la puerta)');
ok(!/const LADO_CELDA = 64;/.test(banco), 'y el banco ya no tiene el 64 clavado');

console.log(`\nmosaico-galeria: ${n} asserts OK`);
