// tests/familia-color.test.mjs — las familias de color de #covers (v=288)
//
// Hay tres cosas que vigilar acá, y la primera es la que ya se rompió una vez:
//
// 1. 🔴 **Que las fronteras sigan siendo de LCh y no de HSL.** El primer
//    intento de v=288 las escribió con ángulos de HSL y metía el rojo puro en
//    naranjas y el azul puro en violetas. Los asserts de «colores de
//    referencia» son exactamente ese caso: si alguien «corrige» las fronteras
//    para que el rojo caiga en 0°, se ponen rojos.
// 2. **Que el contraste de las doce pastillas siga en AA.** Se recalcula acá,
//    no se cree la tabla del comentario.
// 3. **Que «sin color» no sea una familia de color** y que nada lo pierda.

import {
  FAMILIAS, SIN_COLOR, SIN_COLOR_NOMBRE, IDS_FAMILIA,
  familiaDeLch, familiaDeRgb,
  CROMA_NEUTRO, L_NEGRO, L_BLANCO, MARRON_L_MAX, MARRON_C_MAX,
} from '../src/js/util/familia-color.js';
import { SRGB_A_LINEAL, srgb8ALab, labALch } from '../src/js/util/cover-color.js';

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

console.log('La lista de familias');
eq(FAMILIAS.length, 12, 'doce familias de color');
eq(FAMILIAS.map(f => f.id), [
  'rojos', 'naranjas', 'amarillos', 'verdes', 'aguas', 'azules',
  'violetas', 'rosas', 'marrones', 'grises', 'blancos', 'negros',
], 'los doce ids, en el orden en que se pintan las pastillas');
ok(new Set(FAMILIAS.map(f => f.id)).size === 12, 'sin ids repetidos');
ok(FAMILIAS.every(f => /^#[0-9A-F]{6}$/.test(f.color)), 'las doce traen su color propio en hex');
ok(FAMILIAS.every(f => /^#[0-9A-F]{6}$/.test(f.texto)), 'y el color de su texto');
// ⚠️ «grises» y «blancos» van SEPARADAS a propósito. El encargo del 09/10 las
// listaba juntas («grises y blancos, y negros»), y se partieron por dos
// motivos: una pastilla tiene que pintarse con SU color y «grises y blancos» no
// tiene uno, y juntas se llevaban el 32,7 % de las 2.469 contra 23,2 % + 9,5 %.
ok(FAMILIAS.some(f => f.id === 'grises') && FAMILIAS.some(f => f.id === 'blancos'),
  'grises y blancos son dos pastillas, no una');

console.log('\n«Sin color» no es una familia de color');
eq(SIN_COLOR, 'sincolor', 'el id del cajón de las desconocidas');
eq(SIN_COLOR_NOMBRE, 'Sin color', 'y su rótulo, en castellano');
ok(!FAMILIAS.some(f => f.id === SIN_COLOR), 'no está entre las familias con color');
eq(IDS_FAMILIA.length, 13, 'los ids válidos son las doce más el cajón');
ok(IDS_FAMILIA.includes(SIN_COLOR), 'y el cajón está entre los válidos');

console.log('\nEl neutro: sin tono no hay familia de tono');
eq(familiaDeLch(50, 0, 0), 'grises', 'croma 0 a media luz es gris');
eq(familiaDeLch(10, 0, 0), 'negros', 'croma 0 y oscuro es negro');
eq(familiaDeLch(95, 0, 0), 'blancos', 'croma 0 y claro es blanco');
eq(familiaDeLch(L_NEGRO - 0.1, 0, 200), 'negros', `justo por debajo de L* ${L_NEGRO} es negro`);
eq(familiaDeLch(L_NEGRO, 0, 200), 'grises', `y justo en L* ${L_NEGRO} ya es gris`);
eq(familiaDeLch(L_BLANCO - 0.1, 0, 200), 'grises', `justo por debajo de L* ${L_BLANCO} es gris`);
eq(familiaDeLch(L_BLANCO, 0, 200), 'blancos', `y justo en L* ${L_BLANCO} ya es blanco`);
// El umbral de croma es 6 y NO 12, y eso es una medición: con 12, el 61 % de
// las 2.469 tapas reales quedaba sin tono y «grises» se llevaba el 38 % solo.
eq(CROMA_NEUTRO, 6, 'el croma neutro es 6 (neutro perceptual, croma Munsell /1)');
eq(familiaDeLch(50, CROMA_NEUTRO - 0.1, 40), 'grises', 'por debajo del croma neutro manda la luz');
ok(familiaDeLch(50, CROMA_NEUTRO, 40) !== 'grises', 'y justo en el umbral ya manda el tono');

console.log('\n🔴 Colores de referencia: las fronteras son de LCh, NO de HSL');
// Si alguien reescribe las fronteras con ángulos de HSL, estos cuatro caen.
eq(familiaDeRgb(255, 0, 0), 'rojos', 'rojo puro rgb(255,0,0) → rojos (está en h 40°, no en 0°)');
eq(familiaDeRgb(194, 1, 1), 'rojos', 'el rojo rgb(194,1,1) de una tapa real → rojos (con fronteras de HSL daba naranjas)');
eq(familiaDeRgb(0, 0, 255), 'azules', 'azul puro rgb(0,0,255) → azules (está en h 306°, no en 240°)');
eq(familiaDeRgb(31, 50, 184), 'azules', 'el azul rgb(31,50,184) de una tapa real → azules (con fronteras de HSL daba violetas)');
// Y el resto del abanico.
eq(familiaDeRgb(220, 20, 60), 'rojos', 'carmesí → rojos');
eq(familiaDeRgb(255, 165, 0), 'naranjas', 'naranja → naranjas');
eq(familiaDeRgb(210, 105, 30), 'naranjas', 'chocolate → naranjas');
eq(familiaDeRgb(255, 215, 0), 'amarillos', 'oro → amarillos');
eq(familiaDeRgb(255, 255, 0), 'amarillos', 'amarillo → amarillos');
eq(familiaDeRgb(0, 128, 0), 'verdes', 'verde → verdes');
eq(familiaDeRgb(0, 255, 0), 'verdes', 'lima → verdes');
eq(familiaDeRgb(64, 224, 208), 'aguas', 'turquesa → aguas');
eq(familiaDeRgb(0, 255, 255), 'aguas', 'cian → aguas');
eq(familiaDeRgb(135, 206, 235), 'azules', 'azul cielo → azules');
eq(familiaDeRgb(138, 43, 226), 'violetas', 'violeta → violetas');
eq(familiaDeRgb(128, 0, 128), 'violetas', 'púrpura → violetas');
eq(familiaDeRgb(255, 192, 203), 'rosas', 'rosa → rosas');
eq(familiaDeRgb(255, 20, 147), 'rosas', 'rosa fuerte → rosas');
eq(familiaDeRgb(165, 42, 42), 'marrones', 'marrón → marrones');
eq(familiaDeRgb(160, 82, 45), 'marrones', 'siena → marrones');
eq(familiaDeRgb(128, 128, 128), 'grises', 'gris → grises');
eq(familiaDeRgb(255, 255, 255), 'blancos', 'blanco → blancos');
eq(familiaDeRgb(0, 0, 0), 'negros', 'negro → negros');
// Las dos fronteras difusas, aceptadas a propósito y afirmadas para que un
// cambio futuro sea deliberado y no un accidente.
eq(familiaDeRgb(255, 0, 255), 'violetas', 'magenta → violetas (mismo tono que púrpura: 328,2°; ningún corte por tono los separa)');
eq(familiaDeRgb(210, 180, 140), 'naranjas', 'tostado → naranjas (es un marrón claro y le falla el techo de L*)');

console.log('\nLos marrones son un recorte DENTRO del cálido');
eq(MARRON_L_MAX, 55, 'techo de luminosidad del marrón');
eq(MARRON_C_MAX, 60, 'techo de croma del marrón');
eq(familiaDeLch(40, 40, 40), 'marrones', 'cálido, oscuro y apagado → marrón');
eq(familiaDeLch(70, 40, 40), 'rojos', 'el MISMO tono y croma, pero claro → rojo');
eq(familiaDeLch(40, 80, 40), 'rojos', 'el MISMO tono y luz, pero vivo → rojo');
eq(familiaDeLch(40, 40, 15), 'rosas', 'fuera del tramo cálido (h 15°) no hay marrón posible');
eq(familiaDeLch(40, 40, 100), 'amarillos', 'ni en h 100°, pasado el tramo cálido');

console.log('\nEntradas que no son un color');
for (const mala of [[NaN, 10, 10], [50, NaN, 10], [50, 10, NaN], [undefined, 1, 1]]) {
  eq(familiaDeLch(...mala), SIN_COLOR, `${JSON.stringify(mala)} → «sin color», no una familia inventada`);
}
eq(familiaDeLch(50, 20, 370), familiaDeLch(50, 20, 10), 'un tono de 370° se normaliza a 10°');
eq(familiaDeLch(50, 20, -20), familiaDeLch(50, 20, 340), 'y uno de −20° a 340°');

console.log('\nContraste de las doce pastillas (WCAG 2.1) — recalculado, no copiado');
// ⚠️ Fondo y texto son los dos valores FIJOS, así que este ratio es el MISMO
// en los cuatro presets de paleta: no hay una variable de tema en el medio que
// lo pueda mover. Por eso se comprueba una sola vez y vale para los cuatro.
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function luminancia([r, g, b]) {
  const L = SRGB_A_LINEAL;
  return 0.2126 * L[r] + 0.7152 * L[g] + 0.0722 * L[b];
}
function ratio(a, b) {
  const l1 = luminancia(a), l2 = luminancia(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
let peor = Infinity, peorFam = '';
for (const f of FAMILIAS) {
  const r = ratio(hex(f.color), hex(f.texto));
  if (r < peor) { peor = r; peorFam = f.id; }
  ok(r >= 4.5, `${f.nombre.padEnd(10)} ${f.color} sobre ${f.texto}: ${r.toFixed(2)}:1 ≥ 4,5 (AA)`);
}
ok(peor >= 4.5, `la peor de las doce es ${peorFam} con ${peor.toFixed(2)}:1, y pasa AA`);
// Control del propio medidor: si midiera mal, los asserts de arriba no valen.
ok(Math.abs(ratio(hex('#FFFFFF'), hex('#000000')) - 21) < 0.01,
  'el medidor da 21:1 para blanco sobre negro (control)');

console.log('\nEl reparto de las 2.469 tapas reales de Ian (medido el 09/10)');
// No se recalcula desde las tapas —haría falta la red—, pero sí se afirma que
// ninguna familia se queda sin su cajón y que el reparto medido suma. Si
// alguien mueve una frontera, lo que cambia es este comentario y hay que
// volver a medir: el número está en `util/familia-color.js`.
const REPARTO = {
  rojos: 89, naranjas: 172, amarillos: 188, verdes: 52, aguas: 26, azules: 255,
  violetas: 60, rosas: 158, marrones: 525, grises: 572, blancos: 234, negros: 138,
};
eq(Object.keys(REPARTO).sort(), FAMILIAS.map(f => f.id).sort(), 'el reparto medido cubre las doce familias');
eq(Object.values(REPARTO).reduce((a, b) => a + b, 0), 2469, 'y suma las 2.469 tapas');
ok(Object.values(REPARTO).every(n => n > 0), 'ninguna familia quedó vacía con los datos reales');
const mayor = Math.max(...Object.values(REPARTO));
ok(mayor / 2469 < 0.35, `la familia más grande se lleva ${(100 * mayor / 2469).toFixed(1)} %, por debajo del 35 % que Ian puso como techo`);

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} familia-color: ${pasaron} de ${pasaron + fallaron}`);
if (fallaron) process.exit(1);
