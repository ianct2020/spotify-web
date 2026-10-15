#!/usr/bin/env node
// Genera `src/js/util/mundo-110m.js`: el mundo de `#mapa` (v=305, tanda 53), un
// `path` SVG ya proyectado por país, a partir de Natural Earth.
//
//   node scripts/generar-mundo.mjs <ruta del GeoJSON> [salida]
//
// El GeoJSON se baja UNA vez, a mano, a una carpeta temporal que tape el
// `.gitignore` (`tmp-*/`), y no se commitea:
//
//   mkdir -p tmp-mundo && curl -o tmp-mundo/ne.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson
//   node scripts/generar-mundo.mjs tmp-mundo/ne.geojson
//
// Lo que se decidió en la tanda 53, y por qué:
//
//   · La geometría se genera una vez y se COMMITEA; la app no baja nada. El
//     módulo va en `src/js/util/` (no en `src/data/`) para que `build.sh` le
//     estampe el `?v=` al importarlo con `import()`.
//   · Si el sha256 del archivo no es el de abajo, el generador PARA: otra
//     versión de Natural Earth es otro mapa, y se decide a propósito.
//   · El código del país sale de `ISO_A2_EH`, NUNCA de `ISO_A2`: en este archivo
//     `ISO_A2` trae `-99` en Francia, Noruega y Kosovo (un error conocido de
//     Natural Earth). Los que dan `-99` también en `ISO_A2_EH` (Northern Cyprus
//     y Somaliland) se escriben con `iso: null`: se dibujan en gris y no se
//     pueden elegir. Ninguna tabla de corrección a mano.
//   · La Antártida (`AQ`) va afuera: ocupa el fondo del dibujo y nadie hace
//     música ahí. Es la única exclusión.
//   · La proyección es Equal Earth (ver `proyectar`): conserva las áreas, y en
//     un mapa pintado por cantidad una proyección que agranda Canadá, Rusia y
//     Groenlandia hace que un color pese más de lo que vale.
//   · Las coordenadas van redondeadas a 1 decimal de un viewBox de 1000 de
//     ancho y en comandos relativos (`l`), para que pese poco. El redondeo se
//     hace sobre las coordenadas ABSOLUTAS (en décimas, enteras) y los
//     relativos son la resta de dos enteros: no se acumula error.
//
// Sin dependencias: solo `node:fs` y `node:crypto`.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const URL_FUENTE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson';
export const SHA256_FUENTE = '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f';
export const CAMPO_ISO = 'ISO_A2_EH';
export const EXCLUIR = new Set(['AQ']);

// ── Equal Earth ──────────────────────────────────────────────────────────────
// Šavrič, Patterson y Jenny (2018), «The Equal Earth map projection»,
// International Journal of Geographical Information Science 33(3), 454-465.
// Las cuatro constantes y la fórmula son las de `equalEarthRaw` de d3-geo
// (`src/projection/equalEarth.js`), que es la implementación de referencia; en
// la tanda 53 se confirmaron leyendo ese código (no había red para el artículo).
//   ℓ = asin(M · sen φ), con M = √3 / 2
//   x = λ · cos ℓ / (M · (A1 + 3·A2·ℓ² + ℓ⁶·(7·A3 + 9·A4·ℓ²)))
//   y = ℓ · (A1 + A2·ℓ² + ℓ⁶·(A3 + A4·ℓ²))
export const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const RAD = Math.PI / 180;

/** (longitud, latitud) en grados → (x, y) de Equal Earth, con y hacia el NORTE. */
export function proyectar(lon, lat) {
  const l = Math.asin(M * Math.sin(lat * RAD));
  const l2 = l * l, l6 = l2 * l2 * l2;
  const x = (lon * RAD) * Math.cos(l) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2)));
  const y = l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2));
  return [x, y];
}

// El mundo entero (±180°, ±90°) entra justo en el viewBox. La Antártida no se
// dibuja, pero el viewBox sigue siendo el del mundo: el (0°, 0°) en el centro.
const XMAX = proyectar(180, 0)[0];
const YMAX = proyectar(0, 90)[1];
export const ANCHO = 1000;
const ESCALA = ANCHO / (2 * XMAX);
export const ALTO = Math.round(2 * YMAX * ESCALA * 10) / 10;

/** (x, y) de Equal Earth → coordenadas del viewBox (y del SVG hacia ABAJO). */
export function aViewBox([x, y]) {
  return [(x + XMAX) * ESCALA, (YMAX - y) * ESCALA];
}

// ── El camino SVG ────────────────────────────────────────────────────────────
// Un número en décimas (entero) → texto con un decimal como mucho: 125 → «12.5»,
// 120 → «12», 5 → «.5», -5 → «-.5».
function num(decimas) {
  const neg = decimas < 0, a = Math.abs(decimas);
  const ent = Math.floor(a / 10), dec = a % 10;
  const s = dec ? `${ent ? ent : ''}.${dec}` : `${ent}`;
  return (neg ? '-' : '') + s;
}
// Junta números: el signo menos separa solo; si no, un espacio.
const juntar = (ns) => ns.map((n, i) => (i && !n.startsWith('-') ? ' ' : '') + n).join('');

/** Un anillo de [lon, lat] → «Mx y l dx dy … z», o '' si se achica a menos de 3 puntos. */
export function anillo(coords) {
  const pts = [];
  for (const [lon, lat] of coords) {
    const [vx, vy] = aViewBox(proyectar(lon, lat));
    const p = [Math.round(vx * 10), Math.round(vy * 10)];
    const u = pts[pts.length - 1];
    if (!u || u[0] !== p[0] || u[1] !== p[1]) pts.push(p);
  }
  // GeoJSON repite el primer punto al final: lo cierra la `z`.
  while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length < 3) return '';
  const rel = [];
  for (let i = 1; i < pts.length; i++) rel.push(num(pts[i][0] - pts[i - 1][0]), num(pts[i][1] - pts[i - 1][1]));
  return `M${juntar([num(pts[0][0]), num(pts[0][1])])}l${juntar(rel)}z`;
}

/** Los polígonos de una geometría GeoJSON (Polygon o MultiPolygon). */
function poligonos(g) {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  throw new Error('geometría que no es polígono: ' + g.type);
}

export function verificarSha(buf) {
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SHA256_FUENTE) throw new Error(`el sha256 del archivo es ${sha} y se esperaba ${SHA256_FUENTE}: no es Natural Earth 1:110m v5.1.2. Paro.`);
  return sha;
}

/**
 * GeoJSON (texto, ya verificado) → { texto del módulo, resumen }.
 * El resumen trae lo que hay que poder contar: los excluidos, los sin código
 * (con su NAME del archivo, solo para el informe) y los anillos que el
 * redondeo dejó en menos de 3 puntos.
 */
export function generar(geojsonTexto) {
  const g = JSON.parse(geojsonTexto);
  const formas = [], sinCodigo = [], excluidos = [], achicados = [];
  for (const f of g.features) {
    const cod = f.properties[CAMPO_ISO];
    if (EXCLUIR.has(cod)) { excluidos.push(cod); continue; }
    const iso = /^[A-Z]{2}$/.test(cod) ? cod : null;
    if (!iso) sinCodigo.push(`${f.properties.NAME} (${CAMPO_ISO}=${cod})`);
    const partes = [];
    for (const pol of poligonos(f.geometry)) {
      for (const ring of pol) {
        const d = anillo(ring);
        if (d) partes.push(d); else achicados.push(f.properties.NAME);
      }
    }
    if (!partes.length) throw new Error(`${f.properties.NAME} se quedó sin ningún anillo al redondear`);
    formas.push({ iso, d: partes.join('') });
  }
  const cab = `// GENERADO por scripts/generar-mundo.mjs — NO SE EDITA A MANO (v=305, tanda 53).
//
// El mundo de \`#mapa\`: un \`path\` SVG ya proyectado por país.
//
// De dónde sale: Natural Earth, «Admin 0 – Countries», escala 1:110m, versión
// 5.1.2, que es de DOMINIO PÚBLICO (naturalearthdata.com). El archivo:
//   ${URL_FUENTE}
//   sha256 ${SHA256_FUENTE}
//
// Cómo se hizo (el detalle, en la cabecera del generador):
//   · el código de cada país sale de \`${CAMPO_ISO}\` (en \`ISO_A2\` Francia, Noruega
//     y Kosovo son -99); los que dan -99 también ahí van con \`iso: null\`;
//   · la Antártida (AQ) no está;
//   · proyección Equal Earth (Šavrič, Patterson y Jenny, 2018), viewBox de
//     ${ANCHO} de ancho, coordenadas con 1 decimal, comandos relativos.
//
// Para regenerarlo: bajar el GeoJSON de arriba a una carpeta \`tmp-*/\` y correr
//   node scripts/generar-mundo.mjs <ruta del GeoJSON>
// (comprueba el sha256 y para si no coincide).
//
// ${formas.length} formas: ${formas.length - sinCodigo.length} con código y ${sinCodigo.length} sin código.
`;
  const cuerpo = formas.map((f) => `  { iso: ${f.iso ? `'${f.iso}'` : 'null'}, d: '${f.d}' },`).join('\n');
  const texto = `${cab}
export const ANCHO = ${ANCHO};
export const ALTO = ${ALTO};
export const VIEWBOX = '0 0 ${ANCHO} ${ALTO}';

export const FORMAS = [
${cuerpo}
];
`;
  return { texto, resumen: { formas: formas.length, conCodigo: formas.length - sinCodigo.length, sinCodigo, excluidos, achicados } };
}

// ── Línea de comandos ────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [ruta, salida = fileURLToPath(new URL('../src/js/util/mundo-110m.js', import.meta.url))] = process.argv.slice(2);
  if (!ruta) { console.error('uso: node scripts/generar-mundo.mjs <ruta del GeoJSON> [salida]'); process.exit(2); }
  const buf = readFileSync(ruta);
  try { verificarSha(buf); } catch (e) { console.error(e.message); process.exit(1); }
  const { texto, resumen } = generar(buf.toString('utf8'));
  writeFileSync(salida, texto);
  console.log(`sha256 ok · ${resumen.formas} formas (${resumen.conCodigo} con código) · excluidos: ${resumen.excluidos.join(',') || 'ninguno'}`);
  console.log(`sin código: ${resumen.sinCodigo.join(' · ') || 'ninguno'}`);
  console.log(`anillos que el redondeo dejó en menos de 3 puntos (se omiten): ${resumen.achicados.length ? resumen.achicados.join(', ') : 'ninguno'}`);
  console.log(`viewBox 0 0 ${ANCHO} ${ALTO} · ${Buffer.byteLength(texto)} bytes → ${salida}`);
}
