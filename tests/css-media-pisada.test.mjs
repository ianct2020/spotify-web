// tests/css-media-pisada.test.mjs — ninguna regla de un `@media` pisada por una regla general posterior (v=322, tanda 68)
//
// Una declaración dentro de un `@media` tiene la MISMA especificidad que la misma regla fuera de él: si la regla general
// (con el mismo selector y la misma propiedad) viene DESPUÉS en la cascada, gana siempre y la del `@media` no se aplica
// nunca, en ningún ancho. Pasó dos veces y nadie lo vio (las dos solo se notaban en el celular):
//   · `.blayer-right { align-items: stretch; margin-left: 0 }` del `@media (max-width: 768px)`, pisada por la general
//     `.blayer-right { align-items: flex-end; margin-left: auto }`;
//   · `.modal { max-height: 92vh; border-radius: … 0 0 }` del `@media (max-width: 600px)`, pisada por la general `.modal`
//     (`max-height: 80vh`, `border-radius: var(--radius-xl)`).
// Las contó `fonoteca-migracion/css/detector-media-pisada-2026-10-20.mjs` (4 declaraciones en 2 reglas) y se arreglaron
// POR ORDEN: el bloque del `@media` va después de la regla general. Nunca con `!important` ni subiendo la especificidad.
//
// 🔴 El orden de la cascada es el de carga: las hojas se recorren en el orden de los `<link rel="stylesheet">` de
// `src/index.html`, leído del archivo (no una lista escrita a mano ni el orden alfabético: en otro orden el número es otro).
// `src/callback.html` tiene que cargar las mismas hojas en el mismo orden (si no, este test no hablaría por ella).
//
// La lógica es la del detector, con tres cambios: lee el orden de `index.html`; no cuenta las declaraciones del `@media`
// con `!important` (esas sí ganan) ni las de `@keyframes`; y afirma 0 en vez de solo contar.
//
// Correr con: node tests/css-media-pisada.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}

/** Las hojas de un HTML, en el orden de sus `<link rel="stylesheet">`, sin el `?v=`. */
function hojasDe(html) {
  return [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
    .filter((l) => /rel=["']stylesheet["']/.test(l))
    .map((l) => l.match(/href=["']([^"'?]+)/)?.[1])
    .filter((h) => h && !/^(https?:)?\/\//.test(h));
}

/** Las reglas de una hoja, aplanadas: `{ sel, media, decls, archivo, linea, orden }` (un selector por entrada). */
function reglas(texto, archivo, orden0) {
  const s = texto.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const fuera = [], pila = [];
  let buf = '', linea = 1, lineaInicio = 1, orden = orden0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\n') linea++;
    if (c === '"' || c === "'") {
      buf += c; i++;
      while (i < s.length && s[i] !== c) { if (s[i] === '\\') buf += s[i++]; buf += s[i]; i++; }
      buf += c; continue;
    }
    if (c === '{') { pila.push({ pre: buf.trim(), linea: lineaInicio }); buf = ''; continue; }
    if (c === '}') {
      const tope = pila.pop();
      if (tope && !tope.pre.startsWith('@')) {
        const arrobas = pila.filter((x) => x.pre.startsWith('@')).map((x) => x.pre);
        const decls = {};
        for (const d of buf.split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim(); }
        for (const sel of tope.pre.split(',').map((x) => x.trim().replace(/\s+/g, ' ')))
          fuera.push({ sel, media: arrobas.join(' | '), decls, archivo, linea: tope.linea, orden });
        orden++;
      }
      buf = ''; continue;
    }
    if (!buf.trim()) lineaInicio = linea;
    buf += c;
  }
  return fuera;
}

console.log('1. el orden de carga, leído de src/index.html');
const index = readFileSync(join(raiz, 'src/index.html'), 'utf8');
const hojas = hojasDe(index);
ok(hojas.length >= 3 && hojas.every((h) => h.endsWith('.css')), `index.html carga hojas propias (${hojas.join(', ')})`);
const callback = hojasDe(readFileSync(join(raiz, 'src/callback.html'), 'utf8'));
ok(JSON.stringify(callback) === JSON.stringify(hojas), `callback.html carga las mismas hojas en el mismo orden (${callback.join(', ')})`);

console.log('2. ninguna declaración de un @media pisada por una regla general posterior con el mismo selector');
const todas = [];
for (const h of hojas) todas.push(...reglas(readFileSync(join(raiz, 'src', h), 'utf8'), `src/${h}`, todas.length ? todas.at(-1).orden + 1 : 0));
const pisadas = [];
for (const m of todas) {
  if (!m.media || m.media.includes('keyframes')) continue;
  for (const t of todas) {
    if (t.media || t.sel !== m.sel || t.orden <= m.orden) continue;
    for (const p of Object.keys(m.decls)) {
      if (p in t.decls && !/!important/.test(m.decls[p]))
        pisadas.push(`${m.sel} {${p}: ${m.decls[p]}} @ ${m.archivo}:${m.linea} [${m.media}] pisada por ${t.archivo}:${t.linea} {${p}: ${t.decls[p]}}`);
    }
  }
}
ok(todas.length > 1000, `se leyeron las reglas (${todas.length})`);
ok(pisadas.length === 0, `0 declaraciones de un @media pisadas (hay ${pisadas.length})`, pisadas.join('\n      '));

console.log(`\nOK css-media-pisada: ${pasaron} de ${pasaron + fallaron}`);
process.exit(fallaron ? 1 : 0);
