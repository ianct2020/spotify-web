#!/usr/bin/env node
// Sube de una los OCHO `?v=` de `src/`: los 4 de `src/index.html` y los 4 de
// `src/callback.html` (tanda 88).
//
//   npm run subir-version                    → el actual + 1
//   npm run subir-version -- --a 350         → 350 (tiene que ser mayor que el actual)
//   npm run subir-version -- --revisar       → dice lo que haría y no escribe
//   node scripts/subir-version.mjs --raiz DIR → sobre DIR/src/ en vez del repo (lo usa el test)
//
// Por qué existe: cada despliegue pedía escribir el número nuevo a mano en ocho
// sitios, y a mano salió mal. Hasta v=286 las tres hojas de `index.html` iban 29
// versiones atrás y los cuatro recursos de `callback.html`, 261. El punto 4b de
// `npm run prepush` lo DETECTA; esto lo hace, y los deja como el 4b los quiere.
//
// Lo que se decidió, y por qué:
//
//   · Se niega (código 1, SIN escribir nada) si no son exactamente 4 y 4, si no
//     están todos en el mismo número, o si `--a N` no es mayor que el actual. Un
//     `?v=` desparejo es justo lo que caza el 4b: no se «arregla» subiéndolos
//     todos, porque no sabemos cuál es el bueno. Lo decide una persona.
//   · Se valida TODO antes de escribir el primer archivo: o cambian los dos o
//     ninguno.
//   · Cambia solo los dígitos de esos ocho `?v=`. Se lee y se escribe en latin1,
//     que va y vuelve byte a byte con cualquier contenido: ni el UTF-8, ni un
//     BOM, ni los finales de línea se pueden normalizar por el camino.
//   · Una opción que no conoce también lo hace negarse: un `--revsiar` mal
//     escrito no puede terminar en una escritura de verdad.
//   · No corre `build.sh`, no toca `docs/` ni `sw.js` (eso lo re-estampa
//     `build.sh` a partir de `src/index.html`), no hace `git` y no sale a la red.
//
// Sin dependencias: solo `node:fs`, `node:path` y `node:url`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARCHIVOS = ['src/index.html', 'src/callback.html'];
const POR_ARCHIVO = 4;
const PATRON = /\?v=(\d+)/g;

function fallar(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ── Las opciones ─────────────────────────────────────────────────────────────
let raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pedido = null;
let revisar = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--revisar') revisar = true;
  else if (a === '--a' || a === '--raiz') {
    const valor = args[++i];
    if (valor === undefined) fallar(`Falta el valor de ${a}.`);
    if (a === '--raiz') raiz = resolve(valor);
    else {
      // Solo dígitos: «350abc» o «3e2» no son una versión.
      if (!/^\d+$/.test(valor)) fallar(`--a necesita un número entero, no «${valor}».`);
      pedido = Number(valor);
    }
  } else fallar(`Opción desconocida: «${a}». Las que hay: --a N, --revisar, --raiz DIR.`);
}

// ── Leer y comprobar, sin escribir nada todavía ──────────────────────────────
const leidos = ARCHIVOS.map(rel => {
  const ruta = join(raiz, rel);
  let texto;
  try { texto = readFileSync(ruta, 'latin1'); }
  catch (e) { fallar(`No se puede leer ${ruta}: ${e.message}`); }
  const apariciones = [...texto.matchAll(PATRON)].map(m => ({
    // El índice de los dígitos, no del `?v=`: es lo único que se reemplaza.
    inicio: m.index + 3,
    fin: m.index + m[0].length,
    valor: Number(m[1]),
    linea: texto.slice(0, m.index).split('\n').length,
  }));
  return { rel, ruta, texto, apariciones };
});

const listar = () => leidos.flatMap(l => l.apariciones.map(a => `    ${l.rel}:${a.linea}  ?v=${a.valor}`)).join('\n');

const malContados = leidos.filter(l => l.apariciones.length !== POR_ARCHIVO);
if (malContados.length) {
  fallar(`Tiene que haber exactamente ${POR_ARCHIVO} ?v= en cada archivo (8 en total) y hay `
    + leidos.map(l => `${l.apariciones.length} en ${l.rel}`).join(' y ')
    + '. No se ha cambiado nada.\n' + listar());
}

const valores = new Set(leidos.flatMap(l => l.apariciones.map(a => a.valor)));
if (valores.size !== 1) {
  fallar('Los ocho ?v= no están en el mismo número (es lo que avisa el punto 4b de prepush). '
    + 'Decide cuál es el bueno y déjalos iguales a mano. No se ha cambiado nada.\n' + listar());
}

const actual = [...valores][0];
const nuevo = pedido ?? actual + 1;
if (nuevo <= actual) fallar(`--a ${nuevo} no es mayor que la versión actual (${actual}). No se ha cambiado nada.`);

// ── Escribir ─────────────────────────────────────────────────────────────────
if (revisar) {
  console.log(`Con --revisar no se escribe nada. Se cambiaría la versión ${actual} → ${nuevo} en estos ocho sitios:\n${listar()}`);
  process.exit(0);
}

for (const l of leidos) {
  // De atrás para adelante, así los índices de las anteriores siguen valiendo.
  let texto = l.texto;
  for (const a of [...l.apariciones].reverse()) texto = texto.slice(0, a.inicio) + nuevo + texto.slice(a.fin);
  writeFileSync(l.ruta, texto, 'latin1');
}

console.log(`Versión ${actual} → ${nuevo} en los ocho ?v= de src/ (4 en index.html y 4 en callback.html).`);
console.log('Ahora `bash build.sh`, que la estampa en docs/ y en el nombre de la caché de docs/sw.js.');
