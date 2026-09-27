// tests/cover-color.test.mjs — la rejilla de color de una portada (v=248)
//
// Lo que más importa proteger es la CONVENCIÓN: las medias van en luz lineal.
// Medido el 26/09 sobre 20 portadas, promediar en sRGB o en lineal mueve el
// color medio ΔE 8,3; si algún día alguien «simplifica» la media a sRGB, el
// caso del damero de abajo falla (daría 128 en vez de 188). La imagen objetivo
// del mosaico tiene que pasar por esta misma función.

import {
  rejilla3x3, mediaDeRejilla, srgb8ALab, labALch, linealASrgb8, SRGB_A_LINEAL,
  BYTES_POR_PORTADA, MOSAICO_COLORES_KEY,
} from '../src/js/util/cover-color.js';

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
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;

// Imagen RGBA de w×h pintada por una función (x, y) → [r, g, b].
function imagen(w, h, f) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = f(x, y); const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return d;
}

console.log('Forma de lo guardado');
eq(BYTES_POR_PORTADA, 27, '27 bytes por portada (9 celdas × RGB)');
eq(MOSAICO_COLORES_KEY, 'mosaico_colores_v1', 'una sola clave, versionada');
ok(!MOSAICO_COLORES_KEY.startsWith('discover_'), 'y lejos de las claves de discografías');

console.log('\nIda y vuelta sRGB ↔ lineal');
let idaVuelta = true;
for (let i = 0; i < 256; i++) if (linealASrgb8(SRGB_A_LINEAL[i]) !== i) idaVuelta = false;
ok(idaVuelta, 'los 256 valores vuelven a sí mismos');

console.log('\nUna portada lisa');
const lisa = rejilla3x3(imagen(64, 64, () => [200, 40, 90]), 64, 64);
eq([...lisa], Array(9).fill([200, 40, 90]).flat(), 'las nueve celdas salen del mismo color');
eq(mediaDeRejilla(lisa), [200, 40, 90], 'y su media también');

console.log('\nLA CONVENCIÓN: media en luz lineal');
const damero = rejilla3x3(imagen(64, 64, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0])), 64, 64);
// Mitad blanco, mitad negro: en lineal la media es 0,5 → 188 en sRGB. En sRGB
// directo sería 127,5.
ok([...damero].every(v => cerca(v, 188, 1)), `damero blanco/negro → 188 en cada canal (no 128): dio ${damero[0]}`);

console.log('\nCada celda es su tercio (64 px → cortes en 21 y 43)');
const cortes = rejilla3x3(imagen(64, 64, (x, y) => [x < 21 ? 255 : x < 43 ? 128 : 0, y < 21 ? 255 : y < 43 ? 128 : 0, 7]), 64, 64);
const celda = (i) => [...cortes.slice(i * 3, i * 3 + 3)];
eq(celda(0), [255, 255, 7], 'arriba a la izquierda');
eq(celda(4), [128, 128, 7], 'el centro');
eq(celda(8), [0, 0, 7], 'abajo a la derecha');
eq(celda(2), [0, 255, 7], 'arriba a la derecha: las celdas van por filas');

console.log('\nUna portada que no mide 64 px');
const rara = rejilla3x3(imagen(300, 300, (x) => (x < 100 ? [255, 0, 0] : [0, 0, 255])), 300, 300);
eq([...rara.slice(0, 3)], [255, 0, 0], '300 px: la primera columna es roja');
eq([...rara.slice(3, 6)], [0, 0, 255], 'y la segunda azul');

console.log('\nEntradas inválidas lanzan, no devuelven basura');
let lanzo = false;
try { rejilla3x3(new Uint8ClampedArray(8), 64, 64); } catch { lanzo = true; }
ok(lanzo, 'buffer demasiado corto');

console.log('\nsRGB → LAB (D65)');
const [L0] = srgb8ALab(0, 0, 0);
const [L1, a1, b1] = srgb8ALab(255, 255, 255);
ok(cerca(L0, 0, 0.01), 'negro: L* 0');
ok(cerca(L1, 100, 0.01) && cerca(a1, 0, 0.01) && cerca(b1, 0, 0.01), 'blanco: L* 100, a* b* 0');
const rojo = srgb8ALab(255, 0, 0);
ok(cerca(rojo[0], 53.24, 0.05) && cerca(rojo[1], 80.09, 0.05) && cerca(rojo[2], 67.20, 0.05), `rojo sRGB: 53,24 / 80,09 / 67,20 (dio ${rojo.map(v => v.toFixed(2))})`);
const [, C, h] = labALch(rojo);
ok(cerca(C, 104.55, 0.05) && cerca(h, 40.0, 0.1), `y en LCh: C* 104,55, h 40° (dio ${C.toFixed(2)}, ${h.toFixed(1)})`);
const gris = labALch(srgb8ALab(119, 119, 119));
ok(gris[1] < 0.01, 'un gris tiene croma 0');

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} cover-color: ${pasaron} de ${pasaron + fallaron}`);
if (fallaron) process.exit(1);
