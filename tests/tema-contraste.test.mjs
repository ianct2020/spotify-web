// tests/tema-contraste.test.mjs — `--color-text-muted` pasa AA en los cuatro presets (v=290)
//
// ═══════════════════════════════════════════════════════════════════════════
// EL FALLO QUE PROTEGE ESTE ARCHIVO
// ═══════════════════════════════════════════════════════════════════════════
//
// La tanda 38 midió `--color-text-muted` contra `--color-surface` en **2,48 · 3,00 · 3,02 ·
// 3,52** (violeta, ámbar, aguamarina, papel) cuando AA pide 4,5:1 para texto, y contra
// `--color-elevated` era peor todavía. ~275 reglas de `color` lo usan. NINGUNA puerta lo vigilaba:
// la única suite que mide contraste (`familia-color.test.mjs`) mide las doce pastillas de color
// de `#covers`, que son colores fijos y no tokens del tema.
//
// Primera mitad — la cuenta, con la fórmula de luminancia relativa de WCAG 2.x:
//   1. cada muted da ≥ 4,5:1 contra los TRES fondos del tema (bg, surface, elevated);
//   2. queda POR DEBAJO de `--color-text-secondary` en contraste, contra los tres fondos (si
//      no, los dos niveles de atenuado se invertirían);
//   3. y se IMPRIME, sin fallar, qué presets quedan a menos de 0,3 de contraste de su
//      secondary: ahí los dos niveles se ven casi iguales y decidir qué hacer es de otra tanda.
//
// Segunda mitad — la migración del tema GUARDADO. `write()` guarda los OCHO colores y
// `applyStoredTheme()` los vuelve a pintar tal cual, así que cambiar `PRESETS` no le cambia nada a
// quien ya eligió un preset. Se migra SOLO si los ocho colores guardados coinciden exactamente
// (mismo hex, sin distinguir mayúsculas) con los ocho VIEJOS de uno de los cuatro presets. Un solo
// color distinto es una paleta tocada a mano y no se toca nada, diga lo que diga el campo `preset`.
// Es el único punto de la tanda que escribe sobre un estado del usuario: ante la duda, gana no tocar.

// theme-panel.js importa DOM (modal-stack, toast…). Con este mínimo carga en Node; lo que se prueba
// es `applyStoredTheme()`, que solo toca `localStorage` y `document.documentElement.style`.
const mem = new Map();
const UID = 'orhs6wu5ykk7ql80u92ujn74o';
const CLAVE = `fonoteca_theme_v1__${UID}`;
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: k => { mem.delete(k); },
};
const pintado = {};            // lo que `applyTheme` puso en :root
let escrituras = 0;            // cuántas veces se escribió el tema guardado
const setItemOriginal = globalThis.localStorage.setItem;
globalThis.localStorage.setItem = (k, v) => { if (k === CLAVE) escrituras++; setItemOriginal(k, v); };
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  documentElement: { style: { setProperty: (k, v) => { pintado[k] = v; }, removeProperty: k => { delete pintado[k]; } } },
  body: {}, querySelector: () => null, getElementById: () => null,
};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.window = globalThis;

const { PRESETS, applyStoredTheme } = await import('../src/js/ui/theme-panel.js');

let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };

// ── WCAG 2.x ────────────────────────────────────────────────────────────────
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => {
  const [r, g, b] = rgb(h).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const FONDOS = ['--color-bg', '--color-surface', '--color-elevated'];
const f2 = n => n.toFixed(2);

// ── 1 · la cuenta ───────────────────────────────────────────────────────────
af(PRESETS.length === 4, `hay cuatro presets (hay ${PRESETS.length})`);
const cercanos = [];
for (const p of PRESETS) {
  const c = p.colors;
  const mu = c['--color-text-muted'], se = c['--color-text-secondary'];
  for (const fk of FONDOS) {
    const m = contraste(mu, c[fk]), s = contraste(se, c[fk]);
    af(m >= 4.5, `${p.id}: muted ${mu} sobre ${fk} ${c[fk]} da ${f2(m)}:1 y AA pide 4,5:1`);
    af(m < s, `${p.id}: muted (${f2(m)}:1) tiene que quedar POR DEBAJO de secondary (${f2(s)}:1) sobre ${fk}`);
    if (s - m < 0.3) cercanos.push(`${p.id} sobre ${fk}: muted ${f2(m)} · secondary ${f2(s)} (a ${f2(s - m)})`);
  }
}
if (cercanos.length) {
  console.log('  ℹ muted y secondary a MENOS de 0,3 de contraste (se ven casi iguales; no es un fallo, lo decide otra tanda):');
  for (const l of cercanos) console.log('     · ' + l);
}

// El valor de Violeta vive en DOS sitios que tienen que quedar iguales: `css/theme.css` (lo que ve
// quien no eligió nada) y el `ORIGINAL` de `theme-panel.js` (lo que escribe el preset). Si
// divergen, «Volver al original» y el tema de fábrica no son el mismo.
{
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/css/theme.css', import.meta.url), 'utf8');
  const enCss = /--color-text-muted:\s*(#[0-9A-Fa-f]{6})/.exec(css)?.[1];
  af(enCss && enCss.toUpperCase() === PRESETS[0].colors['--color-text-muted'].toUpperCase(),
    `theme.css (${enCss}) y ORIGINAL de theme-panel.js (${PRESETS[0].colors['--color-text-muted']}) dicen el MISMO muted de Violeta`);
  for (const k of ['--color-bg', '--color-surface', '--color-elevated', '--color-text', '--color-text-secondary']) {
    const v = new RegExp(k + ':\\s*(#[0-9A-Fa-f]{6})').exec(css)?.[1];
    af(v && v.toUpperCase() === PRESETS[0].colors[k].toUpperCase(), `theme.css y ORIGINAL dicen el mismo ${k}`);
  }
}

// ── 2 · la migración del tema guardado ──────────────────────────────────────
//
// Los ocho colores VIEJOS de cada preset (los que un navegador de verdad tiene guardados desde
// v=157). Fijos acá a propósito: si salieran de `PRESETS`, cambiar el preset cambiaría también lo
// que la prueba da por «viejo» y la migración nunca se probaría.
const VIEJOS = {
  violeta: { '--color-accent': '#7C3AED', '--color-bg': '#0A0A0F', '--color-surface': '#16161F', '--color-elevated': '#1E1E2A', '--color-border': '#2A2A3A', '--color-text': '#F0F0F5', '--color-text-secondary': '#8888A0', '--color-text-muted': '#55556A' },
  ambar: { '--color-accent': '#FF6B2C', '--color-bg': '#0C0A08', '--color-surface': '#1A1714', '--color-elevated': '#242018', '--color-border': '#332E25', '--color-text': '#F5F0E8', '--color-text-secondary': '#A09880', '--color-text-muted': '#6B6353' },
  aguamarina: { '--color-accent': '#06D6A0', '--color-bg': '#080F0D', '--color-surface': '#0F1A17', '--color-elevated': '#152420', '--color-border': '#1E3530', '--color-text': '#E8F5F0', '--color-text-secondary': '#80A098', '--color-text-muted': '#4E6A63' },
  papel: { '--color-accent': '#6D28D9', '--color-bg': '#F6F5F8', '--color-surface': '#FFFFFF', '--color-elevated': '#EDEBF2', '--color-border': '#D6D3DE', '--color-text': '#1A1725', '--color-text-secondary': '#5A5570', '--color-text-muted': '#8B85A0' },
};
const NUEVO_MUTED = Object.fromEntries(PRESETS.map(p => [p.id, p.colors['--color-text-muted']]));

function correr(guardado) {
  mem.clear(); escrituras = 0;
  for (const k of Object.keys(pintado)) delete pintado[k];
  mem.set('fonoteca_last_user_id', UID);
  if (guardado !== null) mem.set(CLAVE, typeof guardado === 'string' ? guardado : JSON.stringify(guardado));
  const antes = mem.get(CLAVE) ?? null;
  const devuelto = applyStoredTheme();
  const despues = mem.get(CLAVE) ?? null;
  return { antes, despues, devuelto, escrituras, pintadoMuted: pintado['--color-text-muted'] ?? null, pintadoAcento: pintado['--color-accent'] ?? null };
}

// 2a · preset INTACTO → migra, y reescribe
for (const p of PRESETS) {
  const r = correr({ colors: VIEJOS[p.id], preset: p.id });
  const st = JSON.parse(r.despues);
  af(r.devuelto === undefined, `${p.id}: applyStoredTheme sigue siendo SINCRÓNICA (no devuelve una promesa; devolvió ${typeof r.devuelto})`);
  af(st.colors['--color-text-muted'] === NUEVO_MUTED[p.id], `${p.id}: el muted guardado pasa de ${VIEJOS[p.id]['--color-text-muted']} a ${NUEVO_MUTED[p.id]} (quedó ${st.colors['--color-text-muted']})`);
  af(r.pintadoMuted === NUEVO_MUTED[p.id], `${p.id}: y es el que se PINTA en :root (se pintó ${r.pintadoMuted})`);
  af(r.escrituras === 1, `${p.id}: se reescribe UNA vez (${r.escrituras})`);
  af(st.preset === p.id, `${p.id}: el campo preset no se toca (quedó ${st.preset})`);
  const otros = Object.keys(VIEJOS[p.id]).filter(k => k !== '--color-text-muted');
  af(otros.every(k => st.colors[k] === VIEJOS[p.id][k]), `${p.id}: los OTROS siete colores guardados quedan exactos`);
  // Idempotente: abrir otra vez ya no reescribe (los colores guardados dejaron de ser los viejos).
  const dos = correr(st);
  af(dos.escrituras === 0 && dos.despues === dos.antes, `${p.id}: ya migrado, la segunda vez no escribe nada`);
  af(dos.pintadoMuted === NUEVO_MUTED[p.id], `${p.id}: ya migrado, se pinta el nuevo`);
}

// 2b · mayúsculas y minúsculas del hex no cuentan
{
  const bajos = Object.fromEntries(Object.entries(VIEJOS.ambar).map(([k, v]) => [k, v.toLowerCase()]));
  const r = correr({ colors: bajos, preset: 'ambar' });
  af(JSON.parse(r.despues).colors['--color-text-muted'] === NUEVO_MUTED.ambar, 'hex en minúsculas: coincide igual y migra');
}

// 2c · UN color distinto → paleta tocada a mano: NO se toca nada, aunque el campo diga `preset`
for (const k of Object.keys(VIEJOS.ambar)) {
  const tocada = { ...VIEJOS.ambar, [k]: k === '--color-accent' ? '#FF6B2D' : '#123456' };
  const r = correr({ colors: tocada, preset: 'ambar' });
  af(r.despues === r.antes && r.escrituras === 0, `ámbar con ${k} cambiado (preset: «ambar»): NO se reescribe`);
  af(r.pintadoMuted === tocada['--color-text-muted'], `ámbar con ${k} cambiado: se pinta lo guardado, sin migrar (${r.pintadoMuted})`);
}

// 2d · `preset: null` con colores a mano → no migra
{
  const mano = { ...VIEJOS.violeta, '--color-accent': '#00AA55', '--color-text-muted': '#55556A' };
  const r = correr({ colors: mano, preset: null });
  af(r.despues === r.antes && r.escrituras === 0, 'preset: null con colores a mano: NO se reescribe');
  af(r.pintadoMuted === '#55556A', 'preset: null a mano: se pinta el muted de la persona');
}

// 2e · un muted viejo en una paleta que NO es de ningún preset, aunque sea parecida
{
  const mezcla = { ...VIEJOS.ambar, '--color-text-muted': VIEJOS.violeta['--color-text-muted'] };   // muted de otro preset
  const r = correr({ colors: mezcla, preset: 'ambar' });
  af(r.despues === r.antes && r.escrituras === 0, 'el muted viejo de OTRO preset sobre una paleta de ámbar: no coincide con ninguno, no se toca');
}

// 2f · sin tema guardado → no hace nada
{
  const r = correr(null);
  af(r.despues === null && r.escrituras === 0 && r.pintadoAcento === null, 'sin tema guardado: no escribe ni pinta nada');
}

// 2g · tema corrupto o sin `colors` → tampoco hace nada (y no revienta)
for (const raro of ['no es json', '{"preset":"ambar"}', 'null', '[]']) {
  const r = correr(raro);
  af(r.despues === r.antes && r.escrituras === 0, `guardado raro (${raro}): no se toca ni revienta`);
}

// 2h · faltan colores (tema viejo de menos de ocho): no coincide, no se toca
{
  const incompleto = { ...VIEJOS.ambar }; delete incompleto['--color-border'];
  const r = correr({ colors: incompleto, preset: 'ambar' });
  af(r.despues === r.antes && r.escrituras === 0, 'con solo siete de los ocho colores: no coincide, no se toca');
}

// ── salida ──────────────────────────────────────────────────────────────────
if (fallos.length) {
  console.error(`\n✗ tema-contraste: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts OK`);
