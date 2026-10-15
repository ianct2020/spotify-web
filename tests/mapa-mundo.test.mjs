// tests/mapa-mundo.test.mjs — el mundo de `#mapa` (v=305, tanda 53)
//
// `util/mapa-mundo.js` es la parte PURA del mapamundi: dado lo que arma
// `armarMapa()` (`util/mapa-paises.js`) y la lista de formas del mundo
// (`util/mundo-110m.js`, generado), decide el tono de cada país, qué países con
// minutos no tienen forma en el dibujo, el texto de la línea de detalle y la
// leyenda. Y la hoja (`src/css/main.css`) pinta esos tonos con colores que
// salen del TEMA.
//
// Lo que se vigila, y por qué:
//   · Los cinco cortes son FIJOS (10 %, 3 %, 1 %, 0,3 % y más de 0) y van sobre
//     TODO el historial, como el % de la lista: un país no cambia de color
//     porque otro creció, y la leyenda se puede leer en palabras.
//   · Lo «sin confirmar» y lo «sin país» NO se pintan en ningún país, igual que
//     en la lista: un país con solo artistas sin confirmar va «sin datos», y
//     los minutos sin país no le suben el tono a nadie.
//   · Un país con minutos y SIN forma (muy chico para la escala: Malta) no
//     desaparece: va en «No se ven en el mapa» y sigue en la lista de países.
//   · Los colores de los tonos no se escriben a mano: salen de mezclar
//     `--color-accent` con `--color-surface` (la tarjeta), «sin datos» es
//     `--color-elevated` y el texto va en `--color-text-secondary`. Y los cinco
//     tonos van en orden y separados ≥ 1,2:1 en los cuatro presets (el 1,2 lo
//     puso el encargo de la tanda 53: no es un estándar).
//
// 🔴 Todo es INVENTADO: artistas, minutos, ids. Ningún dato de escucha de nadie
// (el repo es público).
//
// Correr con: node tests/mapa-mundo.test.mjs

import { readFileSync } from 'node:fs';
import * as P from '../src/js/util/mapa-paises.js';
import * as W from '../src/js/util/mapa-mundo.js';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Los nombres de los países salen del navegador (o de Node) con
// `Intl.DisplayNames`, igual que en la vista: ninguna tabla. Si Node no trae
// ICU, la suite no significa nada y lo dice.
const nombrePais = (c) => new Intl.DisplayNames(['es-ES'], { type: 'region' }).of(c) || c;
ok(nombrePais('MT') === 'Malta' && nombrePais('CL') === 'Chile', 'Node trae ICU con los nombres de región en es-ES (si no, esta suite no prueba nada)');

// ── Los datos de mentira ─────────────────────────────────────────────────────
// Un historial de 10.000 min justos (100.000 décimas), armado para que cada
// país caiga en el borde EXACTO de un corte. La caché es la de `mapa-paises`:
// un `unico` corroborado da país; uno sin corroborar, «sin confirmar»; ninguno
// que se llame igual, «sin país».
const T = (min) => [1, min, 2020, 2020, [], '2020-01-01'];
const tema = (titulo, min) => [titulo, 1, min, 'id-' + titulo];
const cand = (id, name, country) => ({ id, name, 'sort-name': name, country });
const regConPais = (nombre, codigo) => ({ v: 1, nombre, consultado: 'x', candidatos: P.recortarArtistas({ artists: [cand('m-' + nombre, nombre, codigo)] }), grabacion: { titulo: 't', ids: ['m-' + nombre], consultado: 'x' } });
const regSinConfirmar = (nombre, codigo) => ({ v: 1, nombre, consultado: 'x', candidatos: P.recortarArtistas({ artists: [cand('m-' + nombre, nombre, codigo)] }), grabacion: { titulo: 't', ids: ['m-otro'], consultado: 'x' } });
const regSinPais = (nombre) => ({ v: 1, nombre, consultado: 'x', candidatos: [], grabacion: null });

// nombre, minutos, cómo queda, país
const ARTISTAS = [
  ['Alfa', 1000, 'pais', 'AR'],            // 10 %        → 5 (el borde)
  ['Bravo', 999.9, 'pais', 'BR'],          // 9,999 %     → 4
  ['Charlie', 300, 'pais', 'CL'],          // 3 %         → 4 (el borde)
  ['Delta', 299.9, 'pais', 'DE'],          // 2,999 %     → 3
  ['Eco', 100, 'pais', 'ES'],              // 1 %         → 3 (el borde)
  ['Foxtrot', 99.9, 'pais', 'FR'],         // 0,999 %     → 2
  ['Golf', 30, 'pais', 'GB'],              // 0,3 %       → 2 (el borde)
  ['Hotel', 29.9, 'pais', 'HU'],           // 0,299 %     → 1
  ['India', 10, 'pais', 'IT'],             // 0,1 %       → 1
  ['Juliet', 500, 'sin-confirmar', 'JP'],  // Japón: SOLO sin confirmar → sin datos
  ['Papa', 10, 'sin-confirmar', 'BR'],     // con él Brasil pasaría a 10,099 % → 5: no tiene que sumar
  ['Lima', 50, 'pais', 'MT'],              // Malta: con minutos y SIN forma
  ['Kilo', 6570.4, 'sin-pais', null],      // 65,7 % sin país: no se reparte
];
const totals = Object.fromEntries(ARTISTAS.map(([n, m]) => [n, T(m)]));
const artists = Object.fromEntries(ARTISTAS.map(([n, m]) => [n, [tema('Tema de ' + n, m)]]));
const cache = new Map(ARTISTAS.map(([n, , c, p]) => [n, c === 'pais' ? regConPais(n, p) : c === 'sin-confirmar' ? regSinConfirmar(n, p) : regSinPais(n)]));
const mapa = P.armarMapa({ totals, artists, artistas: cache, areas: new Map(), nombrePais });

// Las formas: inventadas (un cuadradito por país). Sin Malta, con un país sin
// datos (Estados Unidos) y una forma sin código (el `-99` del archivo).
const FORMAS = ['AR', 'BR', 'CL', 'DE', 'ES', 'FR', 'GB', 'HU', 'IT', 'JP', 'US'].map((iso, i) => ({ iso, d: `M${i * 10} 0h5v5h-5z` }));
FORMAS.push({ iso: null, d: 'M200 0h5v5h-5z' });
const mundo = W.armarMundo(mapa, FORMAS, nombrePais);

// ── 0. Los datos de mentira son los que dicen ser ───────────────────────────
console.log('Los datos de mentira');
ok(mapa.total === 100000, `el total son 10.000 min justos (${mapa.total} décimas)`);
ok(igual(mapa.paises.map((p) => p.codigo).sort(), ['AR', 'BR', 'CL', 'DE', 'ES', 'FR', 'GB', 'HU', 'IT', 'MT']), 'la lista de países es la esperada (Japón no: solo tiene sin confirmar)', mapa.paises.map((p) => p.codigo).join(','));
ok(mapa.paises.find((p) => p.codigo === 'BR').decimas === 9999, 'Brasil tiene solo los minutos de Bravo (Papa, sin confirmar, no suma)');

// ── 1. Los tonos: los cinco cortes en sus bordes exactos ─────────────────────
console.log('\nLos tonos');
ok(igual(W.CORTES_PCT, [10, 3, 1, 0.3]), 'los cortes son 10 %, 3 %, 1 % y 0,3 %', JSON.stringify(W.CORTES_PCT));
const casos = [
  [10000, 5, '10 % justo'], [9999, 4, 'apenas menos del 10 %'], [5000, 4, '5 %'],
  [3000, 4, '3 % justo'], [2999, 3, 'apenas menos del 3 %'],
  [1000, 3, '1 % justo'], [999, 2, 'apenas menos del 1 %'],
  [300, 2, '0,3 % justo'], [299, 1, 'apenas menos del 0,3 %'],
  [1, 1, 'apenas más de 0 (una décima de minuto)'], [0, 0, '0 minutos'],
];
for (const [dec, tono, que] of casos) {
  ok(W.tonoDe(dec, 100000) === tono, `${que} → tono ${tono}`, `dio ${W.tonoDe(dec, 100000)}`);
}
ok(W.tonoDe(100000, 100000) === 5 && W.tonoDe(7, 0) === 0, 'todo el historial → 5; un total de 0 → 0 (sin dividir por cero)');
// Los mismos bordes con un total que no es redondo: la cuenta es entera, sin flotantes.
ok(W.tonoDe(3, 1000) === 2 && W.tonoDe(1, 1000) === 1 && W.tonoDe(7, 700) === 3 && W.tonoDe(21, 700) === 4 && W.tonoDe(70, 700) === 5,
  'con un total de 700 o 1000 los bordes caen igual (0,3 %, 1 %, 3 %, 10 %): la cuenta es con enteros');

const tono = (iso) => mundo.tonos.get(iso);
ok(tono('AR') === 5 && tono('BR') === 4 && tono('CL') === 4 && tono('DE') === 3 && tono('ES') === 3, 'en el mapa: Argentina 5, Brasil 4, Chile 4, Alemania 3, España 3',
  ['AR', 'BR', 'CL', 'DE', 'ES'].map((c) => c + '=' + tono(c)).join(' '));
ok(tono('FR') === 2 && tono('GB') === 2 && tono('HU') === 1 && tono('IT') === 1, 'Francia 2, Reino Unido 2, Hungría 1, Italia 1',
  ['FR', 'GB', 'HU', 'IT'].map((c) => c + '=' + tono(c)).join(' '));
ok(tono('US') === 0, 'un país con forma y sin minutos va «sin datos» (0)');

// ── 2. Lo «sin confirmar» y lo «sin país» no pintan ─────────────────────────
console.log('\nLo que no se sabe no se pinta');
ok(tono('JP') === 0, 'Japón, con 500 min de un artista SIN CONFIRMAR y nada más, va «sin datos»', `dio ${tono('JP')}`);
ok(tono('BR') === 4, 'Brasil sigue en 4: los 10 min sin confirmar de Papa no lo empujan al 5', `dio ${tono('BR')}`);
ok(tono('HU') === 1 && tono('IT') === 1, 'los 6.570 min sin país (65,7 %) no le suben el tono a nadie: Hungría e Italia siguen en 1');
ok(mundo.pintados === 9, `se pintan 9 países: los 10 de la lista menos Malta, que no tiene forma (${mundo.pintados})`);
ok(mundo.paisesConMinutos === 10, `«10 países con minutos» cuenta los de la lista, Malta incluida (${mundo.paisesConMinutos})`);
ok(![...mundo.tonos.keys()].includes(null) && mundo.tonos.size === 11, 'la forma sin código (-99) no lleva tono: no se puede elegir');

// ── 3. Lo que no se ve ──────────────────────────────────────────────────────
console.log('\nLo que no se ve');
ok(igual(mundo.sinForma.map((p) => p.codigo), ['MT']), 'Malta, con minutos y sin forma, va en «no se ven»', JSON.stringify(mundo.sinForma.map((p) => p.codigo)));
ok(mapa.paises.some((p) => p.codigo === 'MT'), 'y SIGUE en la lista de países (la lista es la de armarMapa, que el mundo no toca)');
ok(mundo.sinForma[0].decimas === 500 && mundo.sinForma[0].nombre === 'Malta', 'con sus minutos y su nombre');
ok(W.textoNoSeVen(mundo) === 'No se ven en el mapa: Malta', `el texto: «${W.textoNoSeVen(mundo)}»`);
{
  // Dos sin forma: van en el orden de la lista (por minutos), separados por coma.
  const m2 = { total: 1000, paises: [
    { codigo: 'SG', nombre: 'Singapur', decimas: 300, artistas: [{}] },
    { codigo: 'AR', nombre: 'Argentina', decimas: 200, artistas: [{}] },
    { codigo: 'MT', nombre: 'Malta', decimas: 100, artistas: [{}] },
  ] };
  const w2 = W.armarMundo(m2, [{ iso: 'AR', d: 'M0 0z' }], nombrePais);
  ok(W.textoNoSeVen(w2) === 'No se ven en el mapa: Singapur, Malta', `dos sin forma, por minutos: «${W.textoNoSeVen(w2)}»`);
  const w3 = W.armarMundo({ total: 1000, paises: [m2.paises[1]] }, [{ iso: 'AR', d: 'M0 0z' }], nombrePais);
  ok(W.textoNoSeVen(w3) === '' && w3.sinForma.length === 0, 'si todos tienen forma, no hay línea');
  ok(W.armarMundo({ total: 0, paises: [] }, FORMAS, nombrePais).pintados === 0, 'sin ningún país, nada pintado');
}
ok(W.etiquetaMapa(mundo) === 'Mapa de tus países: 10 países con minutos', `la etiqueta del SVG: «${W.etiquetaMapa(mundo)}»`);
ok(W.etiquetaMapa(W.armarMundo({ total: 1, paises: [{ codigo: 'AR', nombre: 'Argentina', decimas: 1, artistas: [{}] }] }, FORMAS, nombrePais)) === 'Mapa de tus países: 1 país con minutos', 'en singular con uno');

// ── 4. La línea de detalle ──────────────────────────────────────────────────
console.log('\nLa línea de detalle');
ok(W.textoDetalle('CL', mundo, nombrePais) === 'Chile · 300 min · 3,0 % de tus minutos · 1 artista', `Chile: «${W.textoDetalle('CL', mundo, nombrePais)}»`);
{
  const m4 = { total: 200000, paises: [{ codigo: 'AR', nombre: 'Argentina', decimas: 123456, artistas: [{}, {}, {}] }] };
  const w4 = W.armarMundo(m4, FORMAS, nombrePais);
  ok(W.textoDetalle('AR', w4, nombrePais) === 'Argentina · 12.346 min · 61,7 % de tus minutos · 3 artistas', `miles con punto, decimal con coma, plural: «${W.textoDetalle('AR', w4, nombrePais)}»`);
}
ok(W.textoDetalle('US', mundo, nombrePais) === 'Estados Unidos · sin datos', `un país sin datos: «${W.textoDetalle('US', mundo, nombrePais)}»`);
ok(W.textoDetalle('JP', mundo, nombrePais) === 'Japón · sin datos', 'Japón, con solo «sin confirmar», también «sin datos»');

// ── 5. La leyenda ───────────────────────────────────────────────────────────
console.log('\nLa leyenda');
const ley = W.leyenda();
ok(igual(ley.tonos.map((t) => t.tono), [0, 1, 2, 3, 4, 5]), '«sin datos» y los cinco tonos, del más flojo al más fuerte');
ok(igual(ley.tonos.map((t) => t.texto), ['Sin datos', 'Menos del 0,3 %', 'Del 0,3 al 1 %', 'Del 1 al 3 %', 'Del 3 al 10 %', '10 % o más']),
  'cada corte en palabras', JSON.stringify(ley.tonos.map((t) => t.texto)));
ok(ley.frase === 'Los minutos sin país no se pintan.', `y la frase de lo que no se ve: «${ley.frase}»`);
ok(/de tus minutos/.test(ley.titulo), `el título dice de qué es el %: «${ley.titulo}»`);

// ── 6. La hoja: los colores salen del tema ──────────────────────────────────
console.log('\nLa hoja: los colores salen del tema');
const css = readFileSync(new URL('../src/css/main.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Todas las reglas cuyo selector nombra al mapa (`mapa-mundo`).
const reglas = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), cuerpo: m[2] })).filter((r) => /mapa-mundo/.test(r.sel));
ok(reglas.length >= 6, `hay reglas del mapa en la hoja (guarda de la guarda: ${reglas.length})`);
const raiz = reglas.find((r) => r.sel === '.mapa-mundo');
ok(raiz, 'existe la regla `.mapa-mundo`, que define los tonos');
const pcts = [];
for (let k = 1; k <= 5; k++) {
  const m = raiz?.cuerpo.match(new RegExp(`--mm-t${k}\\s*:\\s*([^;]+)`));
  const v = m?.[1].trim();
  const mm = v?.match(/^color-mix\(in srgb,\s*var\(--color-accent\)\s+(\d+(?:\.\d+)?)%,\s*var\(--color-surface\)\)$/);
  ok(mm, `--mm-t${k} mezcla el acento con la tarjeta (color-mix en srgb): «${v}»`);
  pcts.push(mm ? Number(mm[1]) : NaN);
}
ok(pcts.every((p, i) => i === 0 || p > pcts[i - 1]) && pcts[4] <= 100, `las proporciones suben: ${pcts.join(' · ')} %`);
ok(/--mm-sin\s*:\s*var\(--color-elevated\)/.test(raiz?.cuerpo || ''), '«sin datos» es --color-elevated');
for (let k = 1; k <= 5; k++) {
  const r = reglas.find((x) => x.sel.includes(`[data-tono="${k}"]`));
  ok(r && /fill\s*:\s*var\(--mm-t\d\)/.test(r.cuerpo) && new RegExp(`fill\\s*:\\s*var\\(--mm-t${k}\\)`).test(r.cuerpo), `el tono ${k} se pinta con var(--mm-t${k})`, r ? r.cuerpo.trim() : 'no hay regla');
}
const base = reglas.find((r) => /path\s*$/.test(r.sel) && /fill/.test(r.cuerpo));
ok(base && /fill\s*:\s*var\(--mm-sin\)/.test(base.cuerpo) && /stroke\s*:\s*var\(--color-border\)/.test(base.cuerpo), 'cada país arranca en «sin datos» con el borde del tema', base?.sel);
// Los nombres de color, solo como palabra suelta: `white-space` no es un color.
const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black|gray|grey|silver|red|blue|green|purple|orange)(?![-\w])/;
const conLiteral = reglas.filter((r) => literal.test(r.cuerpo));
ok(conLiteral.length === 0, 'ninguna regla del mapa lleva un color escrito a mano', conLiteral.map((r) => `${r.sel} { ${r.cuerpo.trim()} }`).join(' | '));
ok(!reglas.some((r) => /--color-text-muted/.test(r.cuerpo)), 'ninguna usa --color-text-muted');
for (const sel of ['.mapa-mundo-leyenda', '.mapa-mundo-detalle', '.mapa-mundo-noseven']) {
  const r = reglas.find((x) => x.sel.split(',').map((s) => s.trim()).includes(sel));
  ok(r && /(?:^|[;\s])color\s*:\s*var\(--color-text-secondary\)/.test(r.cuerpo), `${sel} va en --color-text-secondary`);
}

// ── 7. El contraste de los tonos, en los cuatro presets ─────────────────────
// La misma cuenta que hace el navegador con `color-mix(in srgb, A p%, B)`:
// interpolar las componentes sRGB codificadas. Todos los colores son opacos
// (no hay alfa que componer), y el contraste es el de WCAG 2.x.
console.log('\nEl contraste de los tonos, en los cuatro presets');
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, documentElement: { style: { setProperty() {}, removeProperty() {} } }, body: {}, querySelector: () => null, getElementById: () => null };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
globalThis.window = globalThis;
const { PRESETS } = await import('../src/js/ui/theme-panel.js');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c) => { const [r, g, b] = c.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const mezclar = (a, b, p) => a.map((v, i) => b[i] + (v - b[i]) * p / 100);
ok(PRESETS.length === 4, 'hay cuatro presets');
for (const pr of PRESETS) {
  const c = pr.colors;
  const sup = rgb(c['--color-surface']), ele = rgb(c['--color-elevated']), acc = rgb(c['--color-accent']);
  const tonos = pcts.map((p) => mezclar(acc, sup, p));
  const pares = [contraste(ele, tonos[0]), ...tonos.slice(1).map((t, i) => contraste(tonos[i], t))];
  const alFondo = [ele, ...tonos].map((t) => contraste(sup, t));
  ok(pares.every((x) => x >= 1.2), `${pr.id}: sin datos/1 y cada tono con el siguiente, ≥ 1,2:1 (${pares.map((x) => x.toFixed(2)).join(' · ')})`);
  ok(alFondo.every((x, i) => i === 0 || x > alFondo[i - 1]), `${pr.id}: en orden, del más parecido a la tarjeta al más fuerte (${alFondo.map((x) => x.toFixed(2)).join(' · ')})`);
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} mapa-mundo: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
