// Los iconos en línea, en un solo sitio (v=233).
//
// POR QUÉ ESTA SUITE EXISTE: unificar seis copias de un glifo es un cambio que
// **no puede fallar ruidosamente**. Si `iconoPlay(10)` devolviera un carácter
// distinto del literal que tenía `album-card.js`, el botón se seguiría
// pintando, la vista no se rompería y nadie se enteraría hasta mirar dos
// vistas seguidas. Por eso lo que se afirma acá es la igualdad **byte a byte**
// contra los literales exactos que había antes de la migración, copiados a
// mano en este archivo desde el `git show` de v=232.
//
// Y la segunda mitad: que no vuelva a aparecer un séptimo ejemplar suelto.
//
// Corre sin navegador y sin token.
// Correr con: node tests/icons.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  iconoPlay, iconoPausa, iconoPausaFina, iconoPuntos,
  iconoOjo, iconoOjoTachado, iconoFicha, iconoDisco,
} from '../src/js/ui/icons.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? '\n         ' + detalle : ''}`);
}
const igual = (et, sale, esperado) =>
  comprobar(et, sale === esperado, `sale     ${sale}\n         esperaba ${esperado}`);

// ── 1. byte a byte contra lo que había en v=232 ────────────────────────────
// Cada línea es el literal EXACTO que vivía en ese archivo, con su tamaño.
igual('album-card ▶ (10)', iconoPlay(10),
  '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>');
igual('album-card ⏸ (10)', iconoPausa(10),
  '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>');
igual('album-card ··· (10)', iconoPuntos(10),
  '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>');

igual('wthree ▶ (12)', iconoPlay(12),
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>');
igual('wthree ⏸ (12)', iconoPausa(12),
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>');
igual('wthree ··· (12)', iconoPuntos(12),
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>');

igual('discover ▶ (15)', iconoPlay(15),
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>');
igual('discover ⏸ (15)', iconoPausa(15),
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>');

igual('fila de canción ▶ (14)', iconoPlay(14),
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>');
igual('fila de canción ⏸ fina (14)', iconoPausaFina(14),
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>');

igual('ojo abierto (14)', iconoOjo(14),
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>');
igual('ojo tachado (14)', iconoOjoTachado(14),
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>');
igual('ⓘ ficha (14)', iconoFicha(14),
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>');
// El disco es el único SIN linecap/linejoin: son dos círculos, no hay puntas.
igual('⊙ disco (14)', iconoDisco(14),
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/></svg>');

// ── 2. el tamaño es lo ÚNICO que cambia ────────────────────────────────────
// Es la propiedad que justifica que sean funciones y no constantes.
for (const f of [iconoPlay, iconoPausa, iconoPausaFina, iconoPuntos, iconoOjo, iconoOjoTachado, iconoFicha, iconoDisco]) {
  const a = f(10), b = f(15);
  comprobar(`${f.name}: cambiar el lado no toca la geometría`,
    a.replace(/"10"/g, '"15"') === b);
  comprobar(`${f.name}: el lado llega a width y a height`,
    b.includes('width="15"') && b.includes('height="15"'));
  comprobar(`${f.name}: el color lo hereda (currentColor)`, a.includes('currentColor'));
}

// ── 3. los dos ⏸ son distintos, y eso está documentado ─────────────────────
// Si alguien los unifica sin decidirlo, este assert lo obliga a pasar por el
// comentario de `icons.js` y por esta línea.
comprobar('los dos ⏸ siguen siendo dos dibujos distintos',
  iconoPausa(14) !== iconoPausaFina(14));

// ── 4. que no aparezca un séptimo ejemplar suelto ──────────────────────────
// El bug que esta suite previene no es que el icono salga mal: es que alguien
// escriba el suyo al lado y las vistas dejen de parecerse EN SILENCIO.
const GLIFOS = {
  '▶': 'M8 5v14l11-7z',
  '⏸ ancho': '<rect x="6" y="4" width="4" height="16"/>',
  '⏸ fino': 'M7 5h3.5v14H7z',
  '···': '<circle cx="5" cy="12" r="2"/>',
  'ojo abierto': 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z',
  'ojo tachado': 'M17.94 17.94A10.07',
  'ⓘ ficha': '<line x1="12" y1="11" x2="12" y2="16"/>',
  '⊙ disco': '<circle cx="12" cy="12" r="2.6"/>',
};
function archivosJs(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) archivosJs(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}
const fuentes = archivosJs(join(raiz, 'src/js'))
  .filter(p => !p.endsWith(join('ui', 'icons.js')));
for (const [nombre, marca] of Object.entries(GLIFOS)) {
  const donde = fuentes.filter(p => readFileSync(p, 'utf8').includes(marca))
    .map(p => p.slice(raiz.length + 1));
  comprobar(`el ${nombre} vive solo en ui/icons.js`, donde.length === 0, donde.join(', '));
}

console.log(`\n  ${ok} asserts OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
