// tests/covers-chip-elegida.test.mjs — la pastilla ELEGIDA de #covers se marca con un anillo (v=290)
//
// ═══════════════════════════════════════════════════════════════════════════
// EL FALLO QUE PROTEGE ESTE ARCHIVO
// ═══════════════════════════════════════════════════════════════════════════
//
// Hasta v=289, `.covers-chip.is-on` pintaba `color: white` sobre `background: var(--color-accent)`:
// violeta 5,70 · **ámbar 2,84** · **aguamarina 1,89** · papel 7,10, o sea que fallaba AA (4,5:1) en
// dos de los cuatro presets. Se arregla como ya se había arreglado en las pastillas de color
// (v=288): se CONSERVA el fondo y el texto y la selección la marca un anillo.
//
// Dos mitades, las dos sin navegador:
//   1. el CSS: la regla tiene las cuatro propiedades del anillo y NO tiene blanco ni acento de fondo;
//      y las dos reglas hermanas (`.covers-chip-color.is-on`, `.covers-chip-sincolor.is-on`), que
//      ya usaban el anillo, siguen EXACTAMENTE como estaban;
//   2. la cuenta: texto (`--color-text`) sobre `--color-surface` pasa AA en los cuatro presets, con
//      los valores de HOY de `PRESETS` (incluido el muted nuevo, que esta pastilla no usa pero
//      que sí usa su `.covers-chip-n`).
//
// ⚠️ Lo que esto NO mide, y se midió en el navegador (tanda 39): la composición real (`.covers-chip-n`
// lleva `opacity: .75`), el `:hover` y que el anillo no lo recorte un contenedor con `overflow`.

import { readFileSync } from 'node:fs';

let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };

const css = readFileSync(new URL('../src/css/main.css', import.meta.url), 'utf8');

/** El cuerpo de la PRIMERA regla cuyo selector es exactamente `selector`, sin comentarios. */
function regla(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}').exec(css);
  if (!m) return null;
  return m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

// ── 1 · el CSS ──────────────────────────────────────────────────────────────
const elegida = regla('.covers-chip.is-on');
af(!!elegida, 'existe la regla `.covers-chip.is-on`');
if (elegida) {
  const dice = (d) => elegida.includes(d);
  af(dice('background: var(--color-surface)'), '`.covers-chip.is-on` conserva el fondo: `background: var(--color-surface)`');
  af(dice('color: var(--color-text)'), '`.covers-chip.is-on` pone `color: var(--color-text)`');
  af(dice('border-color: var(--color-accent)'), '`.covers-chip.is-on` pone `border-color: var(--color-accent)`');
  af(dice('box-shadow: 0 0 0 2px var(--color-accent)'), '`.covers-chip.is-on` marca con el anillo: `box-shadow: 0 0 0 2px var(--color-accent)`');
  af(!elegida.some(d => /white|#fff/i.test(d)), '`.covers-chip.is-on` ya no tiene blanco (era `color: white`)');
  af(!elegida.some(d => /^background:\s*var\(--color-accent\)/.test(d)), '`.covers-chip.is-on` ya no pinta el acento de FONDO');
  igual(elegida.length, 4, '`.covers-chip.is-on` tiene exactamente esas cuatro declaraciones');
}
function igual(a, b, m) { af(a === b, `${m}: esperaba ${b} y vino ${a}`); }

// Las hermanas no se tocaron: son la referencia del arreglo y ya usaban el anillo.
const color = regla('.covers-chip-color.is-on');
af(JSON.stringify(color) === JSON.stringify([
  'background: var(--chip-bg)', 'color: var(--chip-fg)', 'border-color: var(--chip-fg)', 'box-shadow: 0 0 0 2px var(--color-accent)',
]), '`.covers-chip-color.is-on` sigue exactamente como estaba (v=288): ' + JSON.stringify(color));
const sinColor = regla('.covers-chip-sincolor.is-on');
af(JSON.stringify(sinColor) === JSON.stringify([
  'background: var(--color-surface)', 'color: var(--color-text)', 'border-style: solid',
  'border-color: var(--color-text-secondary)', 'box-shadow: 0 0 0 2px var(--color-accent)',
]), '`.covers-chip-sincolor.is-on` sigue exactamente como estaba (v=288): ' + JSON.stringify(sinColor));

// El orden importa: las hermanas pisan a `.covers-chip.is-on` solo porque van DESPUÉS con la misma
// especificidad. Si alguien las sube por encima, pasan a heredar el anillo del acento donde no toca.
const pos = (sel) => css.indexOf('\n' + sel + ' {');
af(pos('.covers-chip.is-on') > 0 && pos('.covers-chip.is-on') < pos('.covers-chip-color.is-on'),
  '`.covers-chip.is-on` va ANTES que `.covers-chip-color.is-on` (misma especificidad: gana la última)');
af(pos('.covers-chip.is-on') < pos('.covers-chip-sincolor.is-on'),
  '`.covers-chip.is-on` va ANTES que `.covers-chip-sincolor.is-on`');

// ── 2 · la cuenta, con los presets de hoy ───────────────────────────────────
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.document = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, documentElement: { style: { setProperty() {}, removeProperty() {} } }, body: {}, querySelector: () => null, getElementById: () => null };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
globalThis.window = globalThis;
const { PRESETS } = await import('../src/js/ui/theme-panel.js');

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const [r, g, b] = rgb(h).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
for (const p of PRESETS) {
  const c = p.colors;
  const r = ratio(c['--color-text'], c['--color-surface']);
  af(r >= 4.5, `${p.id}: texto sobre surface (la elegida) da ${r.toFixed(2)}:1 y AA pide 4,5:1`);
  // El estado de ANTES, para que el número que arregla este cambio quede escrito en la prueba.
  const antes = ratio('#FFFFFF', c['--color-accent']);
  if (p.id === 'ambar') af(antes < 4.5 && antes > 2.8, `ámbar: el blanco sobre el acento daba ${antes.toFixed(2)}:1 (el defecto de v=289)`);
  if (p.id === 'aguamarina') af(antes < 2, `aguamarina: el blanco sobre el acento daba ${antes.toFixed(2)}:1 (el defecto de v=289)`);
}

if (fallos.length) {
  console.error(`\n✗ covers-chip-elegida: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts OK`);
