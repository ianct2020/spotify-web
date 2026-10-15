// tests/mundo-geometria.test.mjs — la geometría del mundo de `#mapa` (v=305, tanda 53)
//
// `src/js/util/mundo-110m.js` es un módulo GENERADO por `scripts/generar-mundo.mjs`
// a partir de Natural Earth (países 1:110m, v5.1.2, dominio público), proyectado
// con Equal Earth y escrito como un `path` SVG por país. Se genera una vez y se
// commitea: la app no baja nada. Esta suite mira el archivo generado y la
// proyección del generador, sin red y sin el GeoJSON (que no se commitea).
//
// Lo que se vigila, y por qué:
//   · El código de cada país sale de `ISO_A2_EH`, nunca de `ISO_A2`: en ese
//     archivo `ISO_A2` trae `-99` en Francia, Noruega y Kosovo. Sin FR, NO o XK
//     el generador leyó el campo equivocado.
//   · La Antártida (AQ) va afuera: es la única exclusión.
//   · Ningún `-99` como código: esas formas se dibujan sin código (`iso: null`).
//   · Cada `d` es un camino válido que cae dentro del `viewBox`.
//   · El archivo pesa 150.000 bytes o menos y su cabecera dice de dónde sale.
//   · La proyección es Equal Earth: el (0°, 0°) cae en el centro, es simétrica,
//     y el dibujo guarda la proporción 2,7066 : 1,3174.
//
// Correr con: node tests/mundo-geometria.test.mjs

import { readFileSync, statSync } from 'node:fs';
import * as G from '../scripts/generar-mundo.mjs';
import * as W from '../src/js/util/mundo-110m.js';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}

const ARCHIVO = new URL('../src/js/util/mundo-110m.js', import.meta.url);
const texto = readFileSync(ARCHIVO, 'utf8');

// ── 1. Los códigos ───────────────────────────────────────────────────────────
console.log('Los códigos');
const isos = W.FORMAS.map((f) => f.iso);
const conCodigo = isos.filter((c) => c !== null);
ok(Array.isArray(W.FORMAS) && W.FORMAS.length > 150, `hay formas (${W.FORMAS.length})`);
ok(W.FORMAS.every((f) => Object.keys(f).sort().join(',') === 'd,iso'), 'cada forma es { iso, d }, nada más (ningún nombre: los nombres salen de Intl)');
ok(conCodigo.every((c) => /^[A-Z]{2}$/.test(c)), 'los códigos son de dos letras mayúsculas', conCodigo.filter((c) => !/^[A-Z]{2}$/.test(c)).join(','));
ok(new Set(conCodigo).size === conCodigo.length, 'ningún código se repite');
for (const c of ['FR', 'NO', 'XK']) ok(conCodigo.includes(c), `está ${c} (en ISO_A2 es -99: sale de ISO_A2_EH)`);
ok(conCodigo.includes('PR'), 'está Puerto Rico, con su forma propia');
ok(!conCodigo.includes('AQ'), 'no está la Antártida');
ok(!isos.includes('-99') && !texto.includes('"-99"') && !texto.includes("'-99'"), 'ningún código -99');
const sinCodigo = W.FORMAS.filter((f) => f.iso === null);
ok(sinCodigo.length === 2, `quedan dos formas sin código (Northern Cyprus y Somaliland: -99 también en ISO_A2_EH): ${sinCodigo.length}`);
ok(W.FORMAS.length === 176, `176 formas: las 177 del archivo menos la Antártida (${W.FORMAS.length})`);
for (const c of ['SG', 'MT', 'HK', 'MC', 'AD', 'BH', 'BB']) ok(!conCodigo.includes(c), `${c} no tiene forma a esta escala (va en «No se ven en el mapa»)`);

// ── 2. Los caminos, dentro del viewBox ───────────────────────────────────────
console.log('\nLos caminos');
ok(W.VIEWBOX === `0 0 ${W.ANCHO} ${W.ALTO}`, `el viewBox es «0 0 ANCHO ALTO»: «${W.VIEWBOX}»`);
ok(W.ANCHO === 1000, 'el ancho es 1000 unidades');

// Un lector de caminos SVG para los comandos que pueden aparecer. Devuelve los
// subcaminos con sus puntos absolutos, o tira si el camino no es válido.
function leerCamino(d) {
  const toks = d.match(/[MmLlHhVvZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
  if (toks.join('').length !== d.replace(/[\s,]/g, '').length) throw new Error('caracteres que no son de un camino');
  const subs = [];
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, actual = null;
  const num = () => { const t = toks[i++]; if (t === undefined || /[A-Za-z]/.test(t)) throw new Error('falta un número'); return Number(t); };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    else if (!cmd || /[Zz]/.test(cmd)) throw new Error('número sin comando');
    switch (cmd) {
      case 'M': case 'm': {
        const nx = num(), ny = num();
        x = cmd === 'M' ? nx : x + nx; y = cmd === 'M' ? ny : y + ny;
        sx = x; sy = y; actual = { puntos: [[x, y]], cerrado: false }; subs.push(actual);
        cmd = cmd === 'M' ? 'L' : 'l';
        break;
      }
      case 'L': x = num(); y = num(); actual.puntos.push([x, y]); break;
      case 'l': x += num(); y += num(); actual.puntos.push([x, y]); break;
      case 'H': x = num(); actual.puntos.push([x, y]); break;
      case 'h': x += num(); actual.puntos.push([x, y]); break;
      case 'V': y = num(); actual.puntos.push([x, y]); break;
      case 'v': y += num(); actual.puntos.push([x, y]); break;
      case 'Z': case 'z': if (!actual) throw new Error('z sin subcamino'); actual.cerrado = true; x = sx; y = sy; break;
      default: throw new Error('comando ' + cmd);
    }
    if (!actual) throw new Error('no empieza con M');
  }
  return subs;
}
let malos = [], fuera = [], abiertos = [], puntos = 0;
const TOL = 0.11;   // medio paso de redondeo, y algo
for (const f of W.FORMAS) {
  let subs;
  try { subs = leerCamino(f.d); } catch (e) { malos.push(`${f.iso}: ${e.message}`); continue; }
  if (!subs.length) { malos.push(`${f.iso}: vacío`); continue; }
  for (const s of subs) {
    if (!s.cerrado) abiertos.push(f.iso);
    if (s.puntos.length < 3) malos.push(`${f.iso}: un anillo de ${s.puntos.length} puntos`);
    for (const [px, py] of s.puntos) {
      puntos++;
      if (px < -TOL || px > W.ANCHO + TOL || py < -TOL || py > W.ALTO + TOL) fuera.push(`${f.iso} (${px.toFixed(1)}, ${py.toFixed(1)})`);
    }
  }
}
ok(malos.length === 0, 'cada `d` es un camino válido', malos.slice(0, 5).join(' | '));
ok(abiertos.length === 0, 'cada anillo se cierra (z)', [...new Set(abiertos)].slice(0, 5).join(','));
ok(fuera.length === 0, `cada punto cae dentro del viewBox (${puntos} puntos)`, fuera.slice(0, 5).join(' | '));
ok(W.FORMAS.every((f) => !/\d\.\d\d/.test(f.d)), 'las coordenadas van con 1 decimal como mucho');

// ── 3. El archivo ───────────────────────────────────────────────────────────
console.log('\nEl archivo');
const bytes = statSync(ARCHIVO).size;
ok(bytes <= 150_000, `pesa 150.000 bytes o menos (${bytes.toLocaleString('es-ES')})`);
const cabecera = texto.slice(0, texto.indexOf('export'));
ok(/GENERADO/.test(cabecera), 'la cabecera dice que es generado');
ok(cabecera.includes(G.URL_FUENTE) && G.URL_FUENTE === 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson', 'la cabecera trae la URL de Natural Earth v5.1.2');
ok(cabecera.includes(G.SHA256_FUENTE) && G.SHA256_FUENTE === '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f', 'la cabecera trae el sha256 del archivo de origen');
ok(/dominio p[úu]blico/i.test(cabecera), 'la cabecera dice que es dominio público');
ok(cabecera.includes('scripts/generar-mundo.mjs'), 'la cabecera dice cómo regenerarlo');
ok(/Equal Earth/.test(cabecera) && /ISO_A2_EH/.test(cabecera), 'la cabecera nombra la proyección y el campo del código');
{
  let tiro = false;
  try { G.verificarSha(Buffer.from('esto no es Natural Earth')); } catch { tiro = true; }
  ok(tiro, 'el generador se niega a seguir si el sha256 del archivo no coincide');
}

// ── 4. La proyección ────────────────────────────────────────────────────────
console.log('\nLa proyección');
const [x0, y0] = G.proyectar(0, 0);
ok(Math.abs(x0) < 1e-12 && Math.abs(y0) < 1e-12, 'el (0°, 0°) proyecta al origen');
const [cx, cy] = G.aViewBox(G.proyectar(0, 0));
ok(Math.abs(cx - W.ANCHO / 2) < 0.06 && Math.abs(cy - W.ALTO / 2) < 0.06, `y cae en el centro del viewBox (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
{
  const [ex, ey] = G.proyectar(30, 40), [ox, oy] = G.proyectar(-30, 40);
  ok(Math.abs(ex + ox) < 1e-12 && Math.abs(ey - oy) < 1e-12, '30° E y 30° O a la misma latitud quedan simétricos');
  const [, ny] = G.proyectar(10, 50), [, sy] = G.proyectar(10, -50);
  ok(Math.abs(ny + sy) < 1e-12, '50° N y 50° S, simétricos respecto del ecuador');
  ok(G.aViewBox(G.proyectar(0, 60))[1] < W.ALTO / 2, 'el norte queda arriba (y del SVG hacia abajo)');
}
const ancho = G.proyectar(180, 0)[0] - G.proyectar(-180, 0)[0];
const alto = G.proyectar(0, 90)[1] - G.proyectar(0, -90)[1];
ok(Math.abs(ancho / 2 - 2.7066) < 5e-4 && Math.abs(alto / 2 - 1.3174) < 5e-4, `Equal Earth: ±${(ancho / 2).toFixed(4)} de ancho y ±${(alto / 2).toFixed(4)} de alto`);
ok(Math.abs(ancho / alto - 2.7066 / 1.3174) < 1e-3, `la proporción del dibujo es 2,7066 : 1,3174 (${(ancho / alto).toFixed(4)})`);
ok(Math.abs(W.ANCHO / W.ALTO - 2.7066 / 1.3174) < 2e-3, `y la del viewBox también (${(W.ANCHO / W.ALTO).toFixed(4)})`);
// Equal Earth conserva las áreas: una celda de 10° × 10° pesa igual en el
// ecuador y en el polo, medida en el plano (el seno de la latitud manda).
{
  const area = (lon, lat) => {
    const pts = [[lon, lat], [lon + 10, lat], [lon + 10, lat + 10], [lon, lat + 10]].map(([a, b]) => G.proyectar(a, b));
    let s = 0; for (let i = 0; i < 4; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4]; s += ax * by - bx * ay; } return Math.abs(s) / 2;
  };
  const esfera = (lat) => (Math.sin((lat + 10) * Math.PI / 180) - Math.sin(lat * Math.PI / 180));
  const r1 = area(0, 0) / esfera(0), r2 = area(0, 60) / esfera(60);
  ok(Math.abs(r1 / r2 - 1) < 0.01, `conserva el área: una celda en el ecuador y otra a 60° pesan lo mismo por unidad de esfera (${(r1 / r2).toFixed(4)})`);
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} mundo-geometria: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
