// tests/css-clases-duplicadas.test.mjs — una clase suelta, una regla de nivel superior (tanda 66, v=317)
//
// ═══════════════════════════════════════════════════════════════════════════
// EL FALLO QUE PROTEGE ESTE ARCHIVO
// ═══════════════════════════════════════════════════════════════════════════
//
// v=315 (la vista `#mapa-artistas`) definió en `main.css` `.mapa-artistas` y `.mapa-artistas-lista`, dos
// clases que YA eran de `#mapa` y `#generos` (la línea de conteo, `<p class="mapa-artistas">`, y las listas
// de artistas de cada país y de cada género). Las reglas nuevas iban después en la hoja y les ganaban a
// las viejas: en `#mapa` y `#generos` la línea de conteo pasó a ser un `display: flex` en columna (cuatro
// renglones apilados, ~100 px) y la lista perdió sus rellenos; en `#mapa-artistas` la lista de parecidos
// (`columns: 3 220px`) salía en una sola columna por el `display: flex` de la otra. Nadie lo vio: ningún
// test ni banco miraba la hoja entera. Es la regla de v=219 («`.wt-play-btn` es de W-Three y de nadie
// más») rota otra vez, ahora en el CSS.
//
// Lo que mira, sin navegador: lee `src/css/*.css`, saca los comentarios y junta las reglas de NIVEL
// SUPERIOR (fuera de cualquier `@media`, `@supports`, `@keyframes`…) cuyo selector, o uno de los
// separados por coma, sea EXACTAMENTE una clase suelta (`.algo`: sin descendientes, sin pseudo, sin otra
// clase pegada). **Falla si una clase tiene dos o más reglas así**, salvo las de `EXCLUIDAS` (abajo), que
// estaban así antes de esta tanda y se anotaron una por una en `PENDIENTES.md` sin arreglarlas.
//
// ⚠️ Lo que esto NO ve: dos módulos que comparten una clase con reglas de más especificidad
// (`.a .b`, `.a:hover`) o dentro de un `@media`; el choque en el HTML (dos vistas que emiten la misma
// clase sin que la hoja la repita). Mira el caso que rompió v=315, no todos los posibles.
//
// `SIN_EXCLUSION=1 node tests/css-clases-duplicadas.test.mjs` corre sin la lista y enseña TODAS las
// duplicadas, con archivo y línea.

import { readFileSync, readdirSync } from 'node:fs';

let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };

/**
 * Las reglas de nivel superior de una hoja: `[{ selector, linea }]` (la línea, 1-based, donde empieza
 * el selector). Saca los comentarios (sin mover las líneas), respeta las cadenas entre comillas y salta
 * entero cualquier bloque de una regla-@ (`@media`, `@supports`, `@keyframes`, `@font-face`…); una
 * regla-@ sin bloque (`@import …;`) se descarta.
 */
export function reglasDeNivelSuperior(texto) {
  const s = texto.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const reglas = [];
  let i = 0, linea = 1, prelude = '', lineaPrelude = 0;
  const avanzar = () => { if (s[i] === '\n') linea++; i++; };
  /** Desde una `{` ya consumida, hasta su `}` (respeta cadenas y bloques anidados). */
  const saltarBloque = () => {
    let prof = 1;
    while (i < s.length && prof > 0) {
      const c = s[i];
      if (c === '"' || c === "'") { avanzar(); while (i < s.length && s[i] !== c) { if (s[i] === '\\') avanzar(); avanzar(); } avanzar(); continue; }
      if (c === '{') prof++;
      else if (c === '}') prof--;
      avanzar();
    }
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '{') {
      const sel = prelude.trim();
      avanzar();
      saltarBloque();
      if (sel && !sel.startsWith('@')) reglas.push({ selector: sel.replace(/\s+/g, ' '), linea: lineaPrelude });
      prelude = ''; lineaPrelude = 0;
    } else if (c === ';' && prelude.trim().startsWith('@')) {
      avanzar(); prelude = ''; lineaPrelude = 0;
    } else if (c === '}') {
      avanzar(); prelude = ''; lineaPrelude = 0;   // una llave suelta: no debería pasar en una hoja sana
    } else {
      if (!lineaPrelude && !/\s/.test(c)) lineaPrelude = linea;
      prelude += c;
      avanzar();
    }
  }
  return reglas;
}

/** Los selectores separados por coma (las comas dentro de paréntesis no cuentan). */
function partirPorComa(sel) {
  const partes = [];
  let prof = 0, actual = '';
  for (const c of sel) {
    if (c === '(') prof++;
    if (c === ')') prof--;
    if (c === ',' && prof === 0) { partes.push(actual.trim()); actual = ''; } else actual += c;
  }
  partes.push(actual.trim());
  return partes.filter(Boolean);
}

const CLASE_SUELTA = /^\.-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

/** `Map<clase, [{ archivo, linea }]>` de las clases sueltas con DOS O MÁS reglas de nivel superior. */
export function clasesDuplicadas(hojas) {
  const vistas = new Map();
  for (const { archivo, texto } of hojas) {
    for (const r of reglasDeNivelSuperior(texto)) {
      for (const p of partirPorComa(r.selector)) {
        if (!CLASE_SUELTA.test(p)) continue;
        if (!vistas.has(p)) vistas.set(p, []);
        vistas.get(p).push({ archivo, linea: r.linea });
      }
    }
  }
  return new Map([...vistas].filter(([, l]) => l.length >= 2));
}

// ── La lista de exclusión ────────────────────────────────────────────────────
//
// 🔴 Una entrada por clase, con su nombre exacto: nada de prefijos ni comodines. Las líneas son las del
// día en que se escribió (2026-10-20, después de T66.3) y son documentación: el test no las compara
// (cualquier edición de la hoja las mueve). Cada una lleva una lectura: si parece una regla PARTIDA a
// propósito (la misma vista, la segunda completa o pisa a la primera) o un CHOQUE de verdad (dos
// vistas). Es una lectura, no una medición. Ninguna se arregló en la tanda 66: están en `PENDIENTES.md`.
const EXCLUIDAS = new Map([
  ['.sc-grid', 'components.css:1402 y :1478 · PARTIDA: la grilla de las tarjetas compartidas y, aparte, el hueco de abajo para que la barra flotante no tape la última fila. La misma pieza'],
  ['.sc-actionbar', 'components.css:1459 y main.css:4952 · PARTIDA: la barra flotante de las tarjetas compartidas y, en main.css, su sitio junto a la capa de abajo (agrupada con `.disco-actionbar`, el look compartido en la hoja como pide v=219). La misma pieza, en dos hojas'],
  ['.sc-ex-item', 'components.css:1590 y :1605 · PARTIDA: la fila de un ítem agrupada con `.sc-pl-item` y, aparte, sus columnas (la del ítem excluido lleva una más). La misma pieza'],
  ['.home-card', 'main.css:457 y :479 · PARTIDA: la tarjeta de inicio, y aparte `min-width: 0` / `max-width: 100%` para que no ensanche la grilla. La misma pieza'],
  ['.blayer-right', 'main.css:809 y :818 · PARTIDA: las dos columnas de la capa de abajo juntas y, aparte, lo de la derecha (`justify-content`). La misma pieza'],
  ['.wt-footer', 'main.css:3946 y :3958 · PARTIDA: el pie del modal de W-Three y, aparte, el `display: flex` de v=258 para «Quitar N de me gusta». La misma pieza'],
  ['.disco-actionbar', 'main.css:4899 y :4952 · PARTIDA: la barra de las dos vistas de descubrir y, aparte, su sitio junto a la capa de abajo (agrupada con `.sc-actionbar`). La misma pieza'],
  ['.wr-ap-cal', 'main.css:5757 y :5763 · PARTIDA: la grilla del calendario agrupada con sus meses y, aparte, sus filas. La misma pieza (el calendario anual del Wrapped y de #calendario)'],
  ['.wr-ap-cal-meses', 'main.css:5757 y :5777 · PARTIDA: agrupada con `.wr-ap-cal` y, aparte, su margen y su letra. La misma pieza'],
  ['.mapa-aviso', 'main.css:6532 y :6535 · PARTIDA: agrupada con las otras notas de #mapa y, aparte, el color del texto. La misma vista'],
]);

// ── 1 · el parser hace lo que dice (una hoja INVENTADA) ─────────────────────
{
  const inventada = [
    '.x { color: red; } /* .x { } dentro de un comentario no cuenta */',
    '.y { color: red; } .z { color: red; }',
    '@media (max-width: 600px) { .y { color: blue; } }',
    '.x { margin: 0; } .z .w { color: green; }',
  ].join('\n');
  const d = clasesDuplicadas([{ archivo: 'inventada.css', texto: inventada }]);
  af(d.has('.x'), 'hoja inventada: `.x` dos veces en el nivel superior es una duplicada');
  af(JSON.stringify(d.get('.x')) === JSON.stringify([{ archivo: 'inventada.css', linea: 1 }, { archivo: 'inventada.css', linea: 4 }]),
    `hoja inventada: \`.x\` en las líneas 1 y 4 (dio ${JSON.stringify(d.get('.x'))})`);
  af(!d.has('.y'), 'hoja inventada: `.y` repetida DENTRO de un `@media` no cuenta');
  af(!d.has('.z'), 'hoja inventada: `.z` y `.z .w` no son la misma regla (la segunda no es una clase suelta)');
  af(d.size === 1, `hoja inventada: una sola duplicada (dio ${[...d.keys()].join(', ') || 'ninguna'})`);

  // Las comas, las pseudo y las clases pegadas.
  const otra = [
    '.p, .q:hover { color: red; }',
    '.q.r { color: red; } .r, .p { color: blue; }',
    '@supports (display: grid) { .r { display: grid; } }',
    '@keyframes k { from { opacity: 0; } to { opacity: 1; } } .s { content: "}"; } .s::after { content: "{"; }',
  ].join('\n');
  const e = clasesDuplicadas([{ archivo: 'otra.css', texto: otra }]);
  af(e.has('.p') && e.get('.p').length === 2, 'hoja inventada: `.p` sola en una lista con coma y otra vez en otra lista cuenta dos');
  af(!e.has('.q'), 'hoja inventada: `.q:hover` y `.q.r` no son la clase suelta `.q`');
  af(!e.has('.r'), 'hoja inventada: `.r` una vez arriba y otra dentro de `@supports` no cuenta');
  af(!e.has('.s'), 'hoja inventada: una llave dentro de una cadena no rompe el parser y `.s::after` no es `.s`');
  af(e.size === 1, `hoja inventada: una sola duplicada (dio ${[...e.keys()].join(', ') || 'ninguna'})`);
}

// ── 2 · las hojas de verdad ──────────────────────────────────────────────────
const dir = new URL('../src/css/', import.meta.url);
const hojas = readdirSync(dir).filter((f) => f.endsWith('.css')).sort()
  .map((f) => ({ archivo: `src/css/${f}`, texto: readFileSync(new URL(f, dir), 'utf8') }));
af(hojas.length >= 3, `se leyeron las hojas de src/css (${hojas.length})`);
const dup = clasesDuplicadas(hojas);
const sinExclusion = process.env.SIN_EXCLUSION === '1';

if (sinExclusion) {
  console.log(`\nClases sueltas con dos o más reglas de nivel superior en src/css: ${dup.size}`);
  for (const [clase, donde] of [...dup].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${clase.padEnd(26)} ${donde.map((d) => `${d.archivo}:${d.linea}`).join('  ')}`);
  }
  console.log('');
}

for (const [clase, donde] of dup) {
  if (!sinExclusion && EXCLUIDAS.has(clase)) { ok++; continue; }
  af(false, `${clase} tiene ${donde.length} reglas de nivel superior: ${donde.map((d) => `${d.archivo}:${d.linea}`).join(', ')}`);
}

// La lista no puede quedar vieja ni volverse un comodín.
for (const [clase] of EXCLUIDAS) {
  af(CLASE_SUELTA.test(clase), `la exclusión «${clase}» es una clase suelta con su nombre entero (nada de prefijos ni comodines)`);
  af(dup.has(clase), `la exclusión «${clase}» sigue repetida (si ya no, se saca de la lista)`);
}

if (fallos.length) {
  console.error(`\n✗ css-clases-duplicadas: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts OK`);
