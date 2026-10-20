// tests/mapa-artistas.test.mjs — lo puro de `#mapa-artistas` (v=315, tanda 64)
//
// `util/mapa-artistas.js` lee el JSON horneado (`history-artist-similares.json`, compacto: nombres,
// posiciones y pares con su `match`) y resuelve todo lo que la vista hace sin red ni DOM: los
// vecinos de un artista ordenados por `match`, el punto tocado (pantalla → plano → el círculo más
// cercano), la transformación de pan y zoom con sus topes, qué nombres se dibujan y el buscador.
//
// Lo que se vigila, y por qué:
//   · los vecinos van de mayor a menor `match` y, a igualdad, en el orden del universo: es el orden
//     del panel, y con el `match` en enteros los empates son comunes;
//   · un JSON con otra forma da `null`, nunca un mapa vacío (la vista lo dice);
//   · el toque vale dentro del círculo más 4 px, y no más; entre dos, gana el más cercano;
//   · el zoom no baja de «todo el mapa» ni sube de 40 veces eso, y deja quieto el punto del puntero;
//   · los nombres (v=316): de más minutos a menos, como mucho 60, solo con el centro en el lienzo y sin
//     pisarse (gana el de más minutos); SIN el umbral de 12 px de radio de v=315, así el más escuchado
//     que se vea siempre tiene nombre;
//   · el radio en pantalla (v=316): `max(r · escala, 1 + 4·√(minutos / máximo))`, el mismo para dibujar
//     y para tocar: de lejos se sigue viendo el orden de tamaños;
//   · el horneado (v=316): solo el componente grande se simula y los sueltos van en una franja debajo
//     (`componentes`, `colocarSueltos`, `acomodar` con un d3 de mentira), y la regla del autocorrect en
//     `armarAristas` (un aceptado aporta salientes y una segunda clave; un descartado, nada);
//   · el nombre del elegido (v=318), si su círculo está entero en el lienzo, sale primero y gana el lugar;
//   · el encuadre del elegido (v=318): `encuadrarElegido` lo deja en el centro con la mayor escala que deja a sus
//     30 primeros parecidos con el punto entero dentro y 24 px de margen; grado 0, como `centrarEn`; si no
//     entran ni a «Ver todo», esa escala y `entraron` lo dice; nunca más de 40 veces «Ver todo»;
//   · (v=319) el alto del lienzo al alto disponible (`altoDelLienzo`, nunca menos que el CSS de hoy ni más de 720, y
//     a menos de 769 px de ancho no se toca); una caja de nombre que se sale por un borde se corre adentro hasta
//     quedar a 2 px; dos cajas a menos de 3 px se pisan; y un suelto (fuera del componente más grande,
//     `principal`) no lleva nombre salvo que sea el elegido;
//   · el buscador usa `normalizarNombre` (`util/mb-pais.js`), no `normText`: un apóstrofo tipográfico
//     encuentra al recto, y «¥$» —que `normText` deja vacío— se encuentra;
//   · 🔴 el JSON horneado, si está, no lleva minutos ni plays (salen de `history-artist-tracks.json`);
//   · la vista no carga d3 ni corre ninguna simulación, e `index.html` no gana ningún script externo.
//
// 🔴 Todo es INVENTADO: los artistas, las posiciones, los pares y los minutos (el repo es público).
// Contra v=314 da rojo: `util/mapa-artistas.js` no existía. Contra v=315, las secciones 5, 5b, 10 y 11:
// los nombres pedían 12 px, no había piso ni `colocarSueltos`, y el autocorrect se descartaba entero.
// Contra v=317, la sección 12: `encuadrarElegido` no existía. Contra v=318, la sección 13 (y los cambios de la 5,
// abajo): no había `altoDelLienzo`, ni corrimiento, ni aire, ni `principal`.
//
// Correr con: node tests/mapa-artistas.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as M from '../src/js/util/mapa-artistas.js';
const H = await import('../scripts/hornear-similares.mjs').catch((e) => { console.log(`  (no se pudo importar el horneado: ${e.message})`); return {}; });

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cerca = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ── El grafo inventado ──────────────────────────────────────────────────────
// Cinco artistas en las esquinas de un cuadrado de 100 y uno en el medio. Minutos 1000, 250, 100,
// 40 y 10 → radios 20, 11, 7,69…, 5,6 y 3,8 (2 + 18·√(m/1000)). «¥$» no tiene ningún par.
const NOMBRES = ['Aurora Lenta', 'Banda Inventada', 'Don’t Stop', '¥$', 'Cometa Azul'];
const TOTALS = {
  'Aurora Lenta': [1, 1000], 'Banda Inventada': [1, 250], 'Don’t Stop': [1, 100], '¥$': [1, 40], 'Cometa Azul': [1, 10],
};
const JSON5 = {
  version: 1, nombres: NOMBRES,
  pos: [0, 0, 100, 0, 0, 100, 100, 100, 50, 50],
  aristas: [0, 1, 800, 1, 0, 2, 300, 0, 0, 4, 800, 0, 1, 4, 500, 1],
};
const mapa = M.leerMapa(JSON5, TOTALS);

console.log('1. leer el JSON compacto');
ok(mapa && mapa.N === 5 && mapa.aristas === 4, 'cinco artistas y cuatro pares');
ok(igual([...mapa.minutos], [1000, 250, 100, 40, 10]), 'los minutos salen de totals[nombre][1]');
ok(cerca(mapa.r[0], 20) && cerca(mapa.r[1], 11) && cerca(mapa.r[3], 2 + 18 * Math.sqrt(0.04)), 'el radio es 2 + 18·√(minutos / máximo), el del horneado');
ok(mapa.aislados === 1 && mapa.minutosAislados === 40, `aislados: 1 («¥$»), con 40 min (vino ${mapa.aislados}, ${mapa.minutosAislados})`);
const sinMinutos = M.leerMapa(JSON5, {});
ok(sinMinutos && sinMinutos.minutos.every((m) => m === 0) && sinMinutos.r.every((r) => r === M.RADIO_MIN), 'sin minutos (otro historial): radio mínimo, sin dividir por cero');
ok(M.leerMapa({ ...JSON5, pos: [0, 0] }, TOTALS) === null, 'pos de otro largo → null');
ok(M.leerMapa({ ...JSON5, aristas: [1, 0, 500, 0] }, TOTALS) === null, 'un par con i ≥ j → null');
ok(M.leerMapa({ ...JSON5, aristas: [0, 9, 500, 0] }, TOTALS) === null, 'un par fuera del universo → null');
ok(M.leerMapa({ ...JSON5, aristas: [0, 1, 500] }, TOTALS) === null, 'aristas que no son de a cuatro → null');
ok(M.leerMapa(null, TOTALS) === null && M.leerMapa({ nombres: NOMBRES }, TOTALS) === null, 'sin la forma → null');

console.log('2. los vecinos, por match de mayor a menor');
ok(igual(mapa.vecinos[0].map((v) => [v.j, v.match, v.mutua]), [[1, 800, true], [4, 800, false], [2, 300, false]]),
  'Aurora: Banda (800) y Cometa (800) empatan → en el orden del universo; después Don’t Stop (300)', JSON.stringify(mapa.vecinos[0]));
ok(igual(mapa.vecinos[4].map((v) => v.j), [0, 1]), 'Cometa: Aurora (800) antes que Banda (500)');
ok(mapa.vecinos[3].length === 0, '«¥$», ninguno');
ok(mapa.vecinos.reduce((s, l) => s + l.length, 0) === 2 * mapa.aristas, 'cada par aparece en los dos artistas (sin dirección)');

console.log('3. la vista: todo el mapa, el zoom y sus topes');
const v0 = M.vistaTodo(mapa, 400, 300);
const [xa, ya] = M.planoAPantalla(v0, mapa.limites.minX, mapa.limites.minY);
const [xb, yb] = M.planoAPantalla(v0, mapa.limites.maxX, mapa.limites.maxY);
ok(v0.escala === v0.base, 'arranca en «todo el mapa»');
ok(xa >= M.MARGEN_VISTA_PX - 1e-6 && yb <= 300 - M.MARGEN_VISTA_PX + 1e-6 && ya >= 0 && xb <= 400, `todo el mapa entra en 400×300 (${xa.toFixed(1)},${ya.toFixed(1)} → ${xb.toFixed(1)},${yb.toFixed(1)})`);
ok(cerca((xa + xb) / 2, 200, 1e-6) && cerca((ya + yb) / 2, 150, 1e-6), 'y centrado');
const lejos = M.zoomEn(v0, 1e6, 123, 45);
ok(cerca(lejos.escala, v0.base * M.ZOOM_MAX), `el zoom no pasa de ${M.ZOOM_MAX} veces «todo el mapa»`);
const atras = M.zoomEn(lejos, 1e-6, 10, 10);
ok(cerca(atras.escala, v0.base), 'ni baja de «todo el mapa»');
const zp = M.zoomEn(v0, 2, 123, 45);
const p0 = M.pantallaAPlano(v0, 123, 45), p1 = M.pantallaAPlano(zp, 123, 45);
ok(cerca(p0[0], p1[0], 1e-9) && cerca(p0[1], p1[1], 1e-9) && cerca(zp.escala, v0.escala * 2), 'el zoom deja quieto el punto que está bajo el puntero');
const mv = M.mover(v0, 30, -7);
ok(cerca(mv.tx, v0.tx + 30) && cerca(mv.ty, v0.ty - 7) && mv.escala === v0.escala, 'arrastrar mueve lo mismo que el dedo');
const ce = M.centrarEn(zp, mapa, 3, 400, 300);
const [cx, cy] = M.planoAPantalla(ce, mapa.x[3], mapa.y[3]);
ok(cerca(cx, 200) && cerca(cy, 150) && ce.escala === zp.escala, 'centrar deja al artista en el medio, con el mismo zoom');

console.log('4. el toque');
const V1 = { escala: 1, base: 1, tx: 50, ty: 50 };   // pantalla = plano + 50
ok(M.tocar(mapa, V1, 50, 50) === 0, 'en el centro de Aurora → Aurora');
ok(M.tocar(mapa, V1, 50 + 20 + 4, 50) === 0, 'a 4 px del borde (radio 20) → todavía Aurora');
ok(M.tocar(mapa, V1, 50 + 20 + 4.5, 50) === -1, 'a 4,5 px → nadie');
ok(M.tocar(mapa, V1, 50 + 75, 50 + 25) === -1, 'el fondo → nadie (suelta al elegido)');
ok(M.tocar(mapa, V1, 50 + 100, 50 + 100) === 3, 'en «¥$» → «¥$»');
// Entre Aurora (r 20, en 0,0) y Cometa (r 3,8, en 50,50): un punto a 22 px del centro de Aurora en
// la diagonal está a 2 px de su borde y lejos de Cometa.
ok(M.tocar(mapa, V1, 50 + 22 / Math.SQRT2, 50 + 22 / Math.SQRT2) === 0, 'entre dos, el de borde más cercano');
const V4 = { escala: 4, base: 1, tx: 0, ty: 0 };
ok(M.tocar(mapa, V4, 200, 200 + 3.8 * 4 + 3) === 4, 'con zoom, el radio que cuenta es el de pantalla (3,8 × 4 + 3 px → Cometa)');

console.log('5. los nombres');
const medir = (s) => s.length * 7;
ok(!('RADIO_NOMBRE_PX' in M), 'ya no hay umbral de radio para los nombres (RADIO_NOMBRE_PX se fue)');
const n1 = M.nombresVisibles(mapa, V1, 400, 300, medir);
// v=319: «¥$» no tiene ningún par, así que es un SUELTO (fuera del componente más grande) y ya no lleva nombre.
// Hasta v=318 este assert esperaba los cinco; lo que se vigila sigue igual: Banda (11 px) sale sin umbral de radio.
ok(igual(n1.map((e) => e.i), [0, 1, 2, 4]), 'a escala 1, los cuatro del componente grande (no se pisan), de más minutos a menos: también Banda (11), que antes no llegaba a 12 px; «¥$», suelto, no (v=319)', JSON.stringify(n1.map((e) => e.i)));
// Muy de lejos (escala 0,01): los cinco caen casi en el mismo punto y se pisan. Gana el de más minutos.
const lejos2 = { escala: 0.01, base: 0.01, tx: 200, ty: 150 };
const nl = M.nombresVisibles(mapa, lejos2, 400, 300, medir);
ok(igual(nl.map((e) => e.i), [0]), 'muy de lejos se pisan todos y queda uno: el de más minutos, que siempre tiene nombre', JSON.stringify(nl.map((e) => e.i)));
ok(igual(M.nombresVisibles(mapa, { escala: 2, base: 1, tx: -1000, ty: -1000 }, 400, 300, medir), []), 'fuera de la pantalla no se dibuja ninguno');
// Aurora con el centro 5 px a la izquierda del lienzo: su círculo (r 20) asoma, pero el nombre no sale.
const nb = M.nombresVisibles(mapa, { escala: 1, base: 1, tx: -5, ty: 50 }, 400, 300, medir);
ok(!nb.some((e) => e.i === 0) && nb.some((e) => e.i === 1), 'un círculo con el centro fuera del lienzo no lleva nombre (aunque asome); los de dentro sí');
// Dos grandes pegados: las cajas se pisan y gana el de más minutos.
// v=319: con un par entre los dos (sin él, «Grande Dos» sería un suelto y no llevaría nombre).
const pegados = M.leerMapa({ nombres: ['Grande Uno', 'Grande Dos'], pos: [0, 0, 10, 0], aristas: [0, 1, 500, 1] }, { 'Grande Uno': [1, 900], 'Grande Dos': [1, 800] });
const np = M.nombresVisibles(pegados, { escala: 1, base: 1, tx: 100, ty: 100 }, 400, 300, () => 80);
ok(igual(np.map((e) => e.i), [0]), 'dos nombres que se pisan → solo el de más minutos');
// v=319: cajas de 6 px a 10 de distancia dejan 4 px de aire (con 8, como hasta v=318, dejaban 2: ahora se pisan).
const np2 = M.nombresVisibles(pegados, { escala: 1, base: 1, tx: 100, ty: 100 }, 400, 300, () => 6);
ok(np2.length === 2, 'si no se pisan, los dos');
// Cien grandes separados: como mucho 60, los de más minutos.
const cien = Array.from({ length: 100 }, (_, i) => `Inventado ${String(i).padStart(3, '0')}`);
// v=319: una cadena de pares (0-1, 1-2…), así los cien son un solo componente y ninguno es suelto.
const muchos = M.leerMapa({ nombres: cien, pos: cien.flatMap((_, i) => [(i % 10) * 100, Math.floor(i / 10) * 100]), aristas: cien.slice(1).flatMap((_, i) => [i, i + 1, 500, 1]) },
  Object.fromEntries(cien.map((n, i) => [n, [1, 1000 - i]])));
const nm = M.nombresVisibles(muchos, { escala: 1, base: 1, tx: 30, ty: 30 }, 2000, 2000, () => 40);
ok(nm.length === M.MAX_NOMBRES && igual(nm.map((e) => e.i), Array.from({ length: 60 }, (_, i) => i)), `como mucho ${M.MAX_NOMBRES}, los de más minutos (vino ${nm.length})`);

// El elegido, con prioridad (v=318): pegado al de más minutos, su nombre sale y el del otro no.
const conElegido = M.nombresVisibles(pegados, { escala: 1, base: 1, tx: 100, ty: 100 }, 400, 300, () => 80, 1);
ok(igual(conElegido.map((e) => e.i), [1]), `con «Grande Dos» elegido, sale su nombre y les gana el lugar (vino ${JSON.stringify(conElegido.map((e) => e.i))})`);
ok(igual(M.nombresVisibles(pegados, { escala: 1, base: 1, tx: 100, ty: 100 }, 400, 300, () => 80, -1).map((e) => e.i), [0]), 'sin elegido, como siempre: el de más minutos');
// Con el círculo cortado por el borde (el centro dentro, el círculo no entero), no se adelanta: va en su turno.
// «Grande Uno» en x = 5 y «Grande Dos» (r ≈ 19) en x = 15: se pisan y gana el de más minutos.
const asoma = M.nombresVisibles(pegados, { escala: 1, base: 1, tx: 5, ty: 100 }, 400, 300, () => 80, 1);
ok(igual(asoma.map((e) => e.i), [0]), `si su círculo no está entero dentro, no se adelanta (vino ${JSON.stringify(asoma.map((e) => e.i))})`);
// Y no pierde su turno: con «Grande Uno» fuera del lienzo, el nombre de «Grande Dos» (cortado) sale igual.
const turno = M.nombresVisibles(pegados, { escala: 1, base: 1, tx: -5, ty: 100 }, 400, 300, () => 80, 1);
ok(igual(turno.map((e) => e.i), [1]), `y si no se adelanta, no pierde su turno (vino ${JSON.stringify(turno.map((e) => e.i))})`);
const nmE = M.nombresVisibles(muchos, { escala: 1, base: 1, tx: 30, ty: 30 }, 2000, 2000, () => 40, 99);
ok(nmE.length === M.MAX_NOMBRES && nmE[0].i === 99 && !nmE.some((e) => e.i === 59), 'el del elegido cuenta en el tope: sale primero y deja afuera al 60.º');

console.log('5b. el radio en pantalla, con su piso');
ok(M.PISO_RADIO_MIN_PX === 1 && M.PISO_RADIO_EXTRA_PX === 4, 'el piso es 1 + 4·√(minutos / máximo) px');
ok(cerca(mapa.piso[0], 5) && cerca(mapa.piso[4], 1 + 4 * Math.sqrt(0.01)), 'el piso de cada uno (Aurora 5, Cometa 1,4)');
ok(cerca(M.radioEnPantalla(mapa, 0, 2), 40) && cerca(M.radioEnPantalla(mapa, 4, 2), 7.6), 'de cerca manda el plano: r · escala');
ok(cerca(M.radioEnPantalla(mapa, 0, 0.01), 5) && cerca(M.radioEnPantalla(mapa, 3, 0.01), 1 + 4 * 0.2), 'de lejos manda el piso');
const radiosLejos = [0, 1, 2, 3, 4].map((i) => M.radioEnPantalla(mapa, i, 0.01));
ok(radiosLejos.every((r, k) => k === 0 || r < radiosLejos[k - 1]), `de lejos se mantiene el orden de tamaños (${radiosLejos.map((r) => r.toFixed(2)).join(' > ')})`);
const VL = { escala: 0.01, base: 0.01, tx: 50, ty: 50 };
ok(M.tocar(mapa, VL, 50 + 5 + 4, 50) === 0 && M.tocar(mapa, VL, 50 + 5 + 4.5, 50) === -1, 'el toque usa el mismo radio: el piso (5) + 4 px, y no más');
ok(cerca(sinMinutos.piso[0], M.PISO_RADIO_MIN_PX), 'sin minutos, el piso es el mínimo, sin dividir por cero');

console.log('6. el buscador');
ok(M.buscar(mapa, 'aurora lenta') === 0 && M.buscar(mapa, '  AURORA   Lenta ') === 0, 'igualdad de normalizarNombre: mayúsculas y espacios no cuentan');
ok(M.buscar(mapa, "Don't Stop") === 2, 'el apóstrofo recto encuentra al tipográfico (’)');
ok(M.buscar(mapa, "don'") === 2, 'y como principio del nombre');
ok(M.buscar(mapa, '¥$') === 3, '«¥$», que normText dejaría vacío, se encuentra');
ok(M.buscar(mapa, 'c') === 4, 'si no hay igual, el primero que empieza igual (Cometa)');
ok(M.buscar(mapa, 'banda inventada') === 1, 'Banda');
ok(M.buscar(mapa, 'zzz') === -1 && M.buscar(mapa, '') === -1 && M.buscar(mapa, '   ') === -1, 'nada, vacío o espacios → -1');
const prefIgual = M.leerMapa({ nombres: ['Luz Larga', 'Luz'], pos: [0, 0, 10, 10], aristas: [] }, { 'Luz Larga': [1, 50], Luz: [1, 20] });
ok(M.buscar(prefIgual, 'luz') === 1, 'la igualdad le gana al «empieza igual» aunque venga después en el universo');

console.log('7. los colores');
ok(igual(M.leerRgb('rgb(124, 58, 237)'), [124, 58, 237]) && igual(M.leerRgb('rgba(1, 2, 3, 0.5)'), [1, 2, 3]) && M.leerRgb('nada') === null, 'leerRgb');
ok(igual(M.mezclar([200, 100, 0], [0, 100, 200], 0.25), [50, 100, 150]), 'mezclar');

console.log('8. lo que la vista NO hace (lectura estática)');
const vista = readFileSync(join(raiz, 'src/js/features/mapa-artistas.js'), 'utf8');
const puro = readFileSync(join(raiz, 'src/js/util/mapa-artistas.js'), 'utf8');
const codigo = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
ok(!/d3|forceSimulation|forceLink/.test(codigo(vista) + codigo(puro)), 'ni d3 ni ninguna simulación en la vista ni en lo puro');
ok(!/\bfetch\s*\(/.test(codigo(vista) + codigo(puro)), 'ningún fetch propio: los datos llegan por loadOne()');
ok(/for \(const n of mapa\.vecinos\[sel\]\)/.test(vista) && !/\.aristas\b.*lineTo|for[^\n]*json\.aristas/.test(codigo(vista)),
  'las líneas se recorren sobre los vecinos del elegido, no sobre los pares del grafo');
const html = readFileSync(join(raiz, 'src/index.html'), 'utf8');
const externos = [...html.matchAll(/<script[^>]*src="(https?:[^"]+)"/g)].map((m) => m[1]);
ok(externos.every((u) => !/d3|force/i.test(u)), `index.html no carga d3 (scripts externos: ${externos.join(', ') || 'ninguno'})`);

console.log('9. el JSON horneado no lleva minutos');
const ruta = join(raiz, 'src/data/history-artist-similares.json');
if (existsSync(ruta)) {
  const texto = readFileSync(ruta, 'utf8');
  const j = JSON.parse(texto);
  ok(igual(Object.keys(j), ['version', 'fuente', 'fecha', 'limit', 'nombres', 'pos', 'aristas']), `las claves son las de la forma acordada: ${Object.keys(j).join(', ')}`);
  ok(j.version === 2, `es la v2 (v=316: el autocorrect y los sueltos), y vino ${j.version}`);
  ok(!/minut|plays|\"ms\"|radio/i.test(texto.replace(/"nombres":\[.*?\],"pos"/s, '"pos"')), 'fuera de los nombres, ni minutos ni plays ni radios');
  ok(j.pos.length === 2 * j.nombres.length && j.aristas.length % 4 === 0, 'pos = 2 × nombres; aristas de a cuatro');
  let bien = true;
  for (let k = 0; k < j.aristas.length; k += 4) {
    const [i, jj, m, mu] = j.aristas.slice(k, k + 4);
    if (!(Number.isInteger(i) && Number.isInteger(jj) && i < jj && jj < j.nombres.length && m >= 0 && m <= 1000 && (mu === 0 || mu === 1))) { bien = false; break; }
  }
  ok(bien, 'cada par: i < j < N, match entre 0 y 1.000, mutua 0 o 1');
  ok(M.leerMapa(j, {}) !== null, 'y leerMapa lo lee');
  // v=316: los aislados van en la franja de abajo, en una grilla de 48, y por debajo de todo lo conectado.
  const g = new Array(j.nombres.length).fill(0);
  for (let k = 0; k < j.aristas.length; k += 4) { g[j.aristas[k]]++; g[j.aristas[k + 1]]++; }
  const ys = (f) => j.nombres.map((_, i) => i).filter(f).map((i) => j.pos[2 * i + 1]);
  const ysAislados = ys((i) => g[i] === 0), ysConectados = ys((i) => g[i] >= 3);
  ok(ysAislados.length > 0 && Math.min(...ysAislados) > Math.max(...ysConectados) + 20, `los aislados (${ysAislados.length}) quedan por debajo de todo el grafo`);
  const x0 = Math.min(...j.nombres.map((_, i) => i).filter((i) => g[i] === 0).map((i) => j.pos[2 * i]));
  ok(j.nombres.map((_, i) => i).filter((i) => g[i] === 0).every((i) => Number.isInteger(Math.round((j.pos[2 * i] - x0) * 10) / 10 / 48) && Number.isInteger(Math.round((j.pos[2 * i + 1] - ysAislados[0]) * 10) / 10 / 48)), 'y en una grilla de 48');
} else {
  console.log('  · (no hay JSON horneado: se saltea)');
}

console.log('10. el horneado: los sueltos en una franja (`componentes`, `colocarSueltos`, `acomodar`)');
if (typeof H.componentes === 'function' && typeof H.colocarSueltos === 'function' && typeof H.acomodar === 'function') {
  // Un grafo INVENTADO de 9: un componente de cuatro (0-1-2-3), uno de tres (5-6-7), uno de dos (4-8) y nada más.
  const L = [[0, 1], [1, 2], [2, 3], [5, 6], [6, 7], [4, 8]].map(([i, j]) => ({ i, j }));
  const comps = H.componentes(9, L);
  ok(igual(comps, [[0, 1, 2, 3], [5, 6, 7], [4, 8]]), `componentes de más grande a más chico (${JSON.stringify(comps)})`);
  const conAislados = H.componentes(12, L);
  ok(igual(conAislados.slice(3), [[9], [10], [11]]), 'los aislados al final, en el orden del universo');
  ok(igual(H.componentes(4, [{ i: 2, j: 3 }, { i: 0, j: 1 }]), [[0, 1], [2, 3]]), 'a igualdad de tamaño, el que tiene el primer índice menor');
  const caja = { minX: -100, maxX: 100, minY: -50, maxY: 50 };   // 200 de ancho → floor(200/48) = 4 columnas
  const s1 = H.colocarSueltos(caja, conAislados.slice(1));
  ok(igual(s1.map((e) => e[0]), [5, 6, 7, 4, 8, 9, 10, 11]), `el orden: el de tres, el de dos (juntos) y los aislados (${s1.map((e) => e[0]).join(',')})`);
  ok(igual(s1.map((e) => [e[1], e[2]]), [[-76, 146], [-28, 146], [20, 146], [68, 146], [-76, 194], [-28, 194], [20, 194], [68, 194]]),
    'celdas de 48, cuatro columnas, la primera fila a 96 del borde inferior y alineada al borde izquierdo');
  ok(s1.every(([, x, y]) => !(x >= caja.minX && x <= caja.maxX && y >= caja.minY && y <= caja.maxY)), 'nadie queda dentro de la caja del componente grande');
  ok(igual(H.colocarSueltos({ minX: 0, maxX: 10, minY: 0, maxY: 0 }, [[1], [2]]).map((e) => [e[1], e[2]]), [[24, 96], [24, 144]]), 'más angosto que una celda: una columna (como mínimo 1)');
  ok(H.CELDA_SUELTOS === 48 && H.SEPARACION_SUELTOS === 96, 'celda 48, separación 96');
  // `acomodar` con un d3 de MENTIRA: cuenta cuántos nodos le pasan y los deja en una fila.
  let simulados = null, links = null;
  const d3Falso = {
    forceSimulation: (nodos) => { simulados = nodos.length; const sim = { force: () => sim, stop: () => sim, tick: () => nodos.forEach((n, k) => { n.x = k * 10; n.y = 0; }) }; return sim; },
    forceLink: (l) => { links = l; return {}; }, forceManyBody: () => ({}), forceCenter: () => ({}), forceCollide: () => ({}),
  };
  const u = Array.from({ length: 12 }, (_, i) => ({ nombre: `Inventado ${i}`, minutos: 1000 - i }));
  const pos = H.acomodar(d3Falso, u, L);
  ok(simulados === 4 && links.length === 3 && links.every((l) => l.source < 4 && l.target < 4), `a la simulación entra solo el componente grande (${simulados} nodos, ${links.length} enlaces, en índices locales)`);
  ok(pos.length === 24 && pos[0] === 0 && pos[2] === 10 && pos[6] === 30, 'el grande queda donde lo dejó la simulación');
  const maxYGrande = Math.max(...[0, 1, 2, 3].map((i) => pos[2 * i + 1] + 2 + 18 * Math.sqrt(u[i].minutos / 1000)));
  ok([4, 5, 6, 7, 8, 9, 10, 11].every((i) => pos[2 * i + 1] >= maxYGrande + 96 - 1e-9), 'y los sueltos, debajo, a 96 o más de su borde inferior');
  const lectura = [5, 6, 7, 4, 8, 9, 10, 11].map((i) => pos[2 * i + 1] * 1e6 + pos[2 * i]);
  ok(lectura.every((v, k) => k === 0 || v > lectura[k - 1]), 'en orden de lectura: el de tres, el de dos y los aislados (acá, una sola columna: el grande mide 70 de ancho)');
} else ok(false, 'componentes, colocarSueltos y acomodar existen en el horneado');

console.log('11. el horneado: el autocorrect en `armarAristas`');
if (typeof H.armarAristas === 'function') {
  // INVENTADO: «Gemas Fríos» vuelve como «Gema$ Fríos» (la misma escritura: aceptado); «Los Faroles», como
  // «Faroles» (otro nombre: descartado); «Coral» vuelve como «Ola» (que YA es del universo: no se pisa).
  const u = ['Gemas Fríos', 'Banda Inventada', 'Los Faroles', 'Coral', 'Ola'].map((nombre, i) => ({ nombre, minutos: 100 - i }));
  const sim = (name, match) => ({ name, match, mbid: '' });
  const resp = new Map([
    [0, { pedido: 'Gemas Fríos', devuelto: 'Gema$ Fríos', similares: [sim('Banda Inventada', 0.9)] }],
    [1, { pedido: 'Banda Inventada', devuelto: 'Banda Inventada', similares: [sim('Gema$ Fríos', 0.8), sim('Faroles', 0.7), sim('Ola', 0.3)] }],
    [2, { pedido: 'Los Faroles', devuelto: 'Faroles', similares: [sim('Banda Inventada', 0.6)] }],
    [3, { pedido: 'Coral', devuelto: 'Ola', similares: [sim('Banda Inventada', 0.5)] }],
    [4, { pedido: 'Ola', devuelto: null, similares: [] }],
  ]);
  const r = H.armarAristas(u, resp);
  const pares = [...r.pares.values()].map((e) => [e.i, e.j, e.match, e.ab && e.ba ? 1 : 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  ok(igual(r.aceptados, [0]) && igual(r.descartados, [2, 3]), `aceptados [0], descartados [2, 3] (${JSON.stringify([r.aceptados, r.descartados])})`);
  ok(igual(pares, [[0, 1, 900, 1], [1, 4, 300, 0]]),
    `el aceptado aporta su saliente y recibe por su segunda clave («Gema$ Fríos» → 0): par mutuo; «Faroles» no apunta a nadie; los descartados no aportan (${JSON.stringify(pares)})`);
  ok(r.pisadas.length === 0, 'un descartado no reclama segunda clave');
  // Una segunda clave que ya es de otro del universo: gana el del universo.
  const u2 = ['Gemas Fríos', 'Gema$ Fríos', 'Banda Inventada'].map((nombre, i) => ({ nombre, minutos: 100 - i }));
  const r2 = H.armarAristas(u2, new Map([[0, { pedido: 'Gemas Fríos', devuelto: 'Gema$ Fríos', similares: [] }], [2, { pedido: 'Banda Inventada', devuelto: null, similares: [sim('Gema$ Fríos', 0.5)] }]]));
  ok(igual(r2.pisadas, [{ indice: 0, de: 1 }]) && igual([...r2.pares.values()].map((e) => [e.i, e.j]), [[1, 2]]), 'si la segunda clave ya es de otro artista del universo, gana el del universo');
} else ok(false, 'armarAristas existe en el horneado');

console.log('12. el encuadre del elegido (v=318)');
if (typeof M.encuadrarElegido === 'function') {
  // INVENTADO: una estrella. El 0 (1.000 min) en (0, 0) con 40 parecidos: los 30 primeros (por `match`, de
  // mayor a menor) en un anillo de radios crecientes, de 20 a 165, y los 10 últimos lejos, a 1.200. Dos
  // aislados en (±3.000, ±3.000) hacen que «Ver todo» quede muy lejos. Y dos pares chicos, aparte:
  // «Borde» (40) en una esquina con su único parecido en la otra, y «Pegado» (41) con el suyo a 1 unidad.
  const N = 46, pos = new Array(2 * N).fill(0), aristas = [], nombres = [], totals = {};
  for (let k = 1; k <= 40; k++) {
    const ang = k * 2.399963, d = k <= 30 ? 15 + k * 5 : 1200;
    pos[2 * k] = +(d * Math.cos(ang)).toFixed(1); pos[2 * k + 1] = +(d * Math.sin(ang)).toFixed(1);
    aristas.push(0, k, 1000 - k, 0);
  }
  const fijar = (i, x, y) => { pos[2 * i] = x; pos[2 * i + 1] = y; };
  fijar(40, 3000, 3000);   // «Borde»: el último del anillo lejano se reemplaza (sigue siendo vecino del 0)
  fijar(42, -3000, -3000); fijar(43, 3000, -3000); fijar(44, 500, 500); fijar(45, 501, 500);
  aristas.push(40, 42, 900, 0, 44, 45, 900, 0);
  for (let i = 0; i < N; i++) { nombres.push(`Inventado ${i}`); totals[`Inventado ${i}`] = [1, i === 0 ? 1000 : 10]; }
  const est = M.leerMapa({ nombres, pos, aristas }, totals);
  const W = 400, H2 = 300, todo = M.vistaTodo(est, W, H2);
  const dentro = (v, j, m = M.MARGEN_ENCUADRE_PX) => {
    const [sx, sy] = M.planoAPantalla(v, est.x[j], est.y[j]), rp = M.radioEnPantalla(est, j, v.escala), e = 1e-6;
    return sx - rp >= m - e && sx + rp <= W - m + e && sy - rp >= m - e && sy + rp <= H2 - m + e;
  };
  const primeros = est.vecinos[0].slice(0, M.ENCUADRE_PARECIDOS).map((n) => n.j);
  ok(M.ENCUADRE_PARECIDOS === 30 && M.MARGEN_ENCUADRE_PX === 24, 'los 30 parecidos y los 24 px de margen');
  ok(igual(primeros, [...Array(30).keys()].map((k) => k + 1)), 'los 30 primeros son los del orden del panel (match de mayor a menor)');

  const e0 = M.encuadrarElegido(todo, est, 0, W, H2);
  const [cx0, cy0] = M.planoAPantalla(e0, est.x[0], est.y[0]);
  ok(cerca(cx0, W / 2) && cerca(cy0, H2 / 2), `el elegido queda en el centro del lienzo (${cx0.toFixed(2)}, ${cy0.toFixed(2)})`);
  ok(primeros.every((j) => dentro(e0, j)) && e0.entraron === 30, `sus 30 primeros parecidos, con el punto entero dentro y 24 px de margen (entraron ${e0.entraron})`);
  ok(e0.escala > todo.base * 2, `y acerca: ${(e0.escala / todo.base).toFixed(2)} veces «Ver todo»`);
  const mas = M.centrarEn({ ...e0, escala: e0.escala * 1.01 }, est, 0, W, H2);
  ok(!primeros.every((j) => dentro(mas, j)), 'es la MAYOR escala que los deja dentro: un 1 % más y alguno se sale');
  ok(!dentro(e0, 31, 0), 'el 31.º (lejos) no cuenta: queda fuera y no achica la escala');
  ok(e0.base === todo.base, 'conserva el piso del zoom («Ver todo»)');

  const desdeZoom = M.encuadrarElegido(M.zoomEn(todo, 7, 10, 10), est, 0, W, H2);
  ok(cerca(desdeZoom.escala, e0.escala) && cerca(desdeZoom.tx, e0.tx) && cerca(desdeZoom.ty, e0.ty), 'no depende del zoom que había antes');

  const g0 = M.encuadrarElegido(M.zoomEn(todo, 3, 50, 50), est, 43, W, H2);
  const c0 = M.centrarEn(M.zoomEn(todo, 3, 50, 50), est, 43, W, H2);
  ok(est.vecinos[43].length === 0 && igual(g0, c0), 'grado 0: lo mismo que centrarEn (centra y conserva la escala)');

  const borde = M.encuadrarElegido(todo, est, 42, W, H2);
  const [bx, by] = M.planoAPantalla(borde, est.x[42], est.y[42]);
  ok(cerca(borde.escala, todo.base) && cerca(bx, W / 2) && cerca(by, H2 / 2), 'si ni a «Ver todo» entran, queda la escala de «Ver todo», centrada en el elegido');
  ok(borde.entraron === 0 && borde.entraron < est.vecinos[42].length, `y lo dice: entraron ${borde.entraron} de ${est.vecinos[42].length}`);

  const pegado = M.encuadrarElegido(todo, est, 44, W, H2);
  ok(cerca(pegado.escala, todo.base * M.ZOOM_MAX), `no pasa de ${M.ZOOM_MAX} veces «Ver todo» (${(pegado.escala / todo.base).toFixed(2)})`);
  ok(pegado.entraron === 1, 'y con el tope, el parecido pegado entra');
} else ok(false, 'encuadrarElegido existe en util/mapa-artistas.js');

console.log('13. el mapa en la pantalla de Ian (v=319)');
if (typeof M.altoDelLienzo === 'function') {
  // `altoDelLienzo(altoVentana, topLienzo, anchoVentana)`: el de hoy es min(720, max(300, 0,62 · alto)).
  ok(M.altoDelLienzo(844, 195, 390) === null, 'a 390 de ancho, null: manda el CSS de hoy');
  ok(M.altoDelLienzo(591, 173, 768) === null && M.altoDelLienzo(591, 173, 769) === 402, 'el corte es 769 px de ancho: 768 → null, 769 → se calcula');
  ok(M.altoDelLienzo(591, 173, 1366) === 402, `1366×591 con el lienzo en 173 → 591 − 173 − 16 = 402 (vino ${M.altoDelLienzo(591, 173, 1366)})`);
  ok(M.altoDelLienzo(768, 173, 1366) === 579, `1366×768 con el lienzo en 173 → 579 (vino ${M.altoDelLienzo(768, 173, 1366)})`);
  ok(M.altoDelLienzo(591, 5000, 1366) === 366 && M.altoDelLienzo(768, 5000, 1366) === 476, 'con un top enorme, el de hoy (0,62 · alto, redondeado): nunca menos');
  ok(M.altoDelLienzo(400, 5000, 1366) === 300, 'y con una ventana baja, el piso de 300 de hoy');
  ok(M.altoDelLienzo(2000, 173, 1366) === 720, 'con una ventana de 2.000, 720: nunca más');
  ok(M.AIRE_ABAJO_LIENZO_PX === 16, 'el aire de abajo es 16');
} else ok(false, 'altoDelLienzo existe en util/mapa-artistas.js');

try {
// Las cajas. Un mapa INVENTADO de un solo componente (una cadena de pares), en pantalla = plano.
const cadena = (n, pos, min) => M.leerMapa({ nombres: n, pos, aristas: n.slice(1).flatMap((_, i) => [i, i + 1, 500, 1]) },
  Object.fromEntries(n.map((x, i) => [x, [1, min[i]]])));
const V0 = { escala: 1, base: 1, tx: 0, ty: 0 };
// «Banda Inventada» con el centro a 10 px del borde derecho de un lienzo de 400 y una caja de 80: se sale 30 px.
const borde = cadena(['Banda Inventada', 'Cometa Azul'], [390, 150, 100, 150], [100, 50]);
const nbd = M.nombresVisibles(borde, V0, 400, 300, () => 80);
const cb = nbd.find((e) => e.i === 0);
ok(cb && cerca(cb.x + 40, 400 - 2) && cerca(cb.y, 150), `una caja que se sale por la derecha se corre adentro y queda a 2 px del borde (su borde derecho en ${cb ? (cb.x + 40).toFixed(1) : '—'})`);
// Arriba y a la izquierda, lo mismo.
const esquina = cadena(['Aurora Lenta', 'Cometa Azul'], [3, 1, 200, 150], [100, 50]);
const ce1 = M.nombresVisibles(esquina, V0, 400, 300, () => 60).find((e) => e.i === 0);
ok(ce1 && cerca(ce1.x - 30, 2) && cerca(ce1.y - M.ALTO_NOMBRE_PX / 2, 2), `y por la izquierda y por arriba, también a 2 px (caja desde ${ce1 ? (ce1.x - 30).toFixed(1) : '—'}, ${ce1 ? (ce1.y - 7).toFixed(1) : '—'})`);
// Más ancha que el lienzo: se queda centrada en el círculo.
const ancha = M.nombresVisibles(borde, { escala: 1, base: 1, tx: -190, ty: 0 }, 400, 300, () => 600).find((e) => e.i === 0);
ok(ancha && cerca(ancha.x, 200), `una caja más ancha que el lienzo se queda centrada (x = ${ancha?.x})`);
// La colisión, con la caja ya corrida: «Banda» en x = 399 (caja 359…439, corrida a 318…398) y «Cometa» en x = 314
// (caja 274…354). Sin correr, 5 px de hueco y salen las dos; corrida, se pisan y gana la de más minutos.
const dosBorde = cadena(['Banda Inventada', 'Cometa Azul'], [399, 100, 314, 100], [100, 50]);
const ndb = M.nombresVisibles(dosBorde, V0, 400, 300, () => 80);
ok(igual(ndb.map((e) => e.i), [0]), `la colisión se calcula con la caja ya corrida: el segundo, corrido, se pisa y no sale (${JSON.stringify(ndb.map((e) => e.i))})`);
// El aire: cajas de 40 de ancho con centros a 42 (2 px de hueco) y a 44 (4 px).
const a2 = cadena(['Aurora Lenta', 'Cometa Azul'], [100, 100, 142, 100], [100, 50]);
const a4 = cadena(['Aurora Lenta', 'Cometa Azul'], [100, 100, 144, 100], [100, 50]);
ok(M.AIRE_NOMBRE_PX === 3, 'el aire entre cajas es 3 px');
ok(igual(M.nombresVisibles(a2, V0, 400, 300, () => 40).map((e) => e.i), [0]), 'dos cajas a 2 px: la segunda no sale');
ok(igual(M.nombresVisibles(a4, V0, 400, 300, () => 40).map((e) => e.i), [0, 1]), 'a 4 px, salen las dos');
// También en vertical: 14 de alto, centros a 16 (2 px) y a 18 (4 px).
const v2 = cadena(['Aurora Lenta', 'Cometa Azul'], [100, 100, 100, 116], [100, 50]);
const v4 = cadena(['Aurora Lenta', 'Cometa Azul'], [100, 100, 100, 118], [100, 50]);
ok(M.nombresVisibles(v2, V0, 400, 300, () => 40).length === 1 && M.nombresVisibles(v4, V0, 400, 300, () => 40).length === 2, 'y en vertical: a 2 px una, a 4 px las dos');

// `principal` y los sueltos: un componente de 5 (0-4), una pareja (5-6) y un aislado (7).
const nombresP = ['Faro Viejo', 'Gemas Fríos', 'Los Faroles', 'Coral', 'Ola', 'Pareja Uno', 'Pareja Dos', 'Isla Sola'];
const minP = [100, 90, 80, 70, 60, 5000, 4000, 3000];   // los sueltos con MUCHOS minutos
const gp = M.leerMapa({ nombres: nombresP, pos: nombresP.flatMap((_, i) => [i * 100, 50]), aristas: [0, 1, 500, 1, 1, 2, 500, 1, 2, 3, 500, 1, 3, 4, 500, 1, 5, 6, 500, 1] },
  Object.fromEntries(nombresP.map((n, i) => [n, [1, minP[i]]])));
ok(gp.principal instanceof Uint8Array && igual([...gp.principal], [1, 1, 1, 1, 1, 0, 0, 0]), `principal: 1 en el componente de 5, 0 en la pareja y el aislado (${gp.principal ? [...gp.principal].join('') : '—'})`);
const empate = M.leerMapa({ nombres: ['A1', 'A2', 'B1', 'B2'], pos: [0, 0, 1, 0, 2, 0, 3, 0], aristas: [0, 1, 500, 1, 2, 3, 500, 1] }, {});
ok(igual([...empate.principal], [1, 1, 0, 0]), 'a igualdad de tamaño, el que contiene al índice más chico');
const np8 = M.nombresVisibles(gp, { escala: 1, base: 1, tx: 30, ty: 50 }, 1000, 200, () => 30);
ok(igual(np8.map((e) => e.i), [0, 1, 2, 3, 4]), `un suelto con muchos minutos no lleva nombre (salieron ${JSON.stringify(np8.map((e) => e.i))})`);
const np8e = M.nombresVisibles(gp, { escala: 1, base: 1, tx: 30, ty: 50 }, 1000, 200, () => 30, 6);
ok(np8e.some((e) => e.i === 6) && !np8e.some((e) => e.i === 5 || e.i === 7), 'si es el elegido, sí (y los demás sueltos, no)');
} catch (e) { ok(false, 'la sección 13 corre', e.stack); }

console.log(`\nOK mapa-artistas: ${pasaron} de ${pasaron + fallaron}`);
process.exit(fallaron ? 1 : 0);
