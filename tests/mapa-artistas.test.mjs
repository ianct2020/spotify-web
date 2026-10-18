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
//   · los nombres: solo los círculos de 12 px o más en pantalla, como mucho 60, sin pisarse (gana el
//     de más minutos);
//   · el buscador usa `normalizarNombre` (`util/mb-pais.js`), no `normText`: un apóstrofo tipográfico
//     encuentra al recto, y «¥$» —que `normText` deja vacío— se encuentra;
//   · 🔴 el JSON horneado, si está, no lleva minutos ni plays (salen de `history-artist-tracks.json`);
//   · la vista no carga d3 ni corre ninguna simulación, e `index.html` no gana ningún script externo.
//
// 🔴 Todo es INVENTADO: los artistas, las posiciones, los pares y los minutos (el repo es público).
// Contra v=314 da rojo: `util/mapa-artistas.js` no existía.
//
// Correr con: node tests/mapa-artistas.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as M from '../src/js/util/mapa-artistas.js';

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
const n1 = M.nombresVisibles(mapa, V1, 400, 300, medir);
ok(igual(n1.map((e) => e.i), [0]), 'a escala 1, solo Aurora mide 12 px o más (20); Banda (11) no', JSON.stringify(n1));
const V2 = { escala: 2, base: 1, tx: 10, ty: 10 };
const n2 = M.nombresVisibles(mapa, V2, 400, 300, medir);
ok(igual(n2.map((e) => e.i), [0, 1, 2]), 'a escala 2: Aurora, Banda y Don’t Stop (≥ 12 px), «¥$» (11,2) no', JSON.stringify(n2.map((e) => e.i)));
ok(igual(M.nombresVisibles(mapa, { escala: 2, base: 1, tx: -1000, ty: -1000 }, 400, 300, medir), []), 'fuera de la pantalla no se dibuja ninguno');
// Dos grandes pegados: las cajas se pisan y gana el de más minutos.
const pegados = M.leerMapa({ nombres: ['Grande Uno', 'Grande Dos'], pos: [0, 0, 10, 0], aristas: [] }, { 'Grande Uno': [1, 900], 'Grande Dos': [1, 800] });
const np = M.nombresVisibles(pegados, { escala: 1, base: 1, tx: 100, ty: 100 }, 400, 300, () => 80);
ok(igual(np.map((e) => e.i), [0]), 'dos nombres que se pisan → solo el de más minutos');
const np2 = M.nombresVisibles(pegados, { escala: 1, base: 1, tx: 100, ty: 100 }, 400, 300, () => 8);
ok(np2.length === 2, 'si no se pisan, los dos');
// Cien grandes separados: como mucho 60, los de más minutos.
const cien = Array.from({ length: 100 }, (_, i) => `Inventado ${String(i).padStart(3, '0')}`);
const muchos = M.leerMapa({ nombres: cien, pos: cien.flatMap((_, i) => [(i % 10) * 100, Math.floor(i / 10) * 100]), aristas: [] },
  Object.fromEntries(cien.map((n, i) => [n, [1, 1000 - i]])));
const nm = M.nombresVisibles(muchos, { escala: 1, base: 1, tx: 30, ty: 30 }, 2000, 2000, () => 40);
ok(nm.length === M.MAX_NOMBRES && igual(nm.map((e) => e.i), Array.from({ length: 60 }, (_, i) => i)), `como mucho ${M.MAX_NOMBRES}, los de más minutos (vino ${nm.length})`);

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
  ok(!/minut|plays|\"ms\"|radio/i.test(texto.replace(/"nombres":\[.*?\],"pos"/s, '"pos"')), 'fuera de los nombres, ni minutos ni plays ni radios');
  ok(j.pos.length === 2 * j.nombres.length && j.aristas.length % 4 === 0, 'pos = 2 × nombres; aristas de a cuatro');
  let bien = true;
  for (let k = 0; k < j.aristas.length; k += 4) {
    const [i, jj, m, mu] = j.aristas.slice(k, k + 4);
    if (!(Number.isInteger(i) && Number.isInteger(jj) && i < jj && jj < j.nombres.length && m >= 0 && m <= 1000 && (mu === 0 || mu === 1))) { bien = false; break; }
  }
  ok(bien, 'cada par: i < j < N, match entre 0 y 1.000, mutua 0 o 1');
  ok(M.leerMapa(j, {}) !== null, 'y leerMapa lo lee');
} else {
  console.log('  · (no hay JSON horneado: se saltea)');
}

console.log(`\nOK mapa-artistas: ${pasaron} de ${pasaron + fallaron}`);
process.exit(fallaron ? 1 : 0);
