#!/usr/bin/env node
// Corre TODAS las suites de tests/*.test.mjs y sale con código distinto de cero
// si alguna falla (o si no encuentra ninguna).
//
//   npm test                          → orden alfabético, una tras otra
//   npm test -- --orden=inverso       → al revés
//   npm test -- --orden=azar[:semilla]→ mezcladas (la semilla se imprime, para repetir)
//   npm test -- --paralelo            → todas a la vez
//   npm test -- --solo=mosaico        → solo las que contengan ese texto
//
// Por qué cada suite va en su PROPIO proceso de node: las suites se escribieron
// para correrse sueltas (`node tests/x.test.mjs`), y varias registran loaders
// (`register('./dobles/loader.mjs', …)`) que reemplazan módulos para todo el
// proceso. Meterlas en un mismo proceso las haría depender del orden. Así, lo
// único que una suite puede dejarle a otra es lo que quede en disco, y eso se
// comprueba con --orden=inverso / azar / --paralelo.
//
// El veredicto es el CÓDIGO DE SALIDA. La cuenta de asserts es informativa: cada
// suite imprime su resumen con un formato distinto («33 asserts OK», «OK — 52
// asserts», líneas «✓»…), así que se lee con tolerancia y, si no se entiende, se
// avisa en vez de inventar un número. Una suite que salga con 0 pero imprima un
// «✗» o «N fallos» con N > 0 se cuenta como FALLADA: es el «verde falso».

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_TESTS = join(RAIZ, 'tests');
const TIEMPO_MAX_MS = 120_000; // por suite: una que se cuelga no puede colgar al resto

const args = process.argv.slice(2);
const opcion = (nombre) => args.find(a => a.startsWith(`--${nombre}`))?.split('=')[1];
const paralelo = args.includes('--paralelo');
const orden = opcion('orden') || 'alfabetico';
const solo = opcion('solo');

// ── PRNG con semilla (mulberry32), para que un orden al azar se pueda repetir ─
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let suites = readdirSync(DIR_TESTS).filter(f => f.endsWith('.test.mjs')).sort();
if (solo) suites = suites.filter(f => f.includes(solo));

let notaOrden = '';
if (orden === 'inverso') {
  suites.reverse();
} else if (orden.startsWith('azar')) {
  const semilla = Number(orden.split(':')[1]) || (Date.now() % 100000);
  const rnd = mulberry32(semilla);
  for (let i = suites.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [suites[i], suites[j]] = [suites[j], suites[i]];
  }
  notaOrden = ` (semilla ${semilla}: repetir con --orden=azar:${semilla})`;
} else if (orden !== 'alfabetico') {
  console.error(`--orden desconocido: ${orden}`);
  process.exit(2);
}

if (suites.length === 0) {
  console.error('No se encontró ninguna suite en tests/*.test.mjs');
  process.exit(1);
}

// El aviso MODULE_TYPELESS_PACKAGE_JSON sale una vez por módulo de src/ y tapa
// la salida real; el package.json no lleva "type" a propósito (src/ se sirve
// tal cual al navegador), así que se silencia solo acá.
const FLAGS_NODE = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'];

function correr(archivo) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const hijo = spawn(process.execPath, [...FLAGS_NODE, join('tests', archivo)], {
      cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    hijo.stdout.on('data', d => { salida += d; });
    hijo.stderr.on('data', d => { salida += d; });
    let colgada = false;
    const reloj = setTimeout(() => { colgada = true; hijo.kill('SIGKILL'); }, TIEMPO_MAX_MS);
    hijo.on('close', (codigo, senial) => {
      clearTimeout(reloj);
      resolve({ archivo, codigo, senial, colgada, salida, ms: Date.now() - t0 });
    });
  });
}

// Cuenta de asserts, con tolerancia. Devuelve null si no entiende el formato.
function contarAsserts(salida) {
  const m = salida.match(/(\d+)\s+asserts?\b/i);
  if (m) return Number(m[1]);
  const marcas = (salida.match(/^\s*[✓✔]/gm) || []).length;
  return marcas > 0 ? marcas : null;
}

// «Verde falso»: salió con 0 pero lo que imprimió dice que algo falló.
function dicePerdio(salida) {
  if (/^\s*[✗✘]/m.test(salida)) return true;
  const m = salida.match(/(\d+)\s+fallos?\b/i);
  return !!(m && Number(m[1]) > 0);
}

const inicio = Date.now();
console.log(`Corriendo ${suites.length} suites — orden ${orden}${notaOrden}${paralelo ? ', en paralelo' : ''}\n`);

let resultados;
if (paralelo) {
  resultados = await Promise.all(suites.map(correr));
} else {
  resultados = [];
  for (const s of suites) resultados.push(await correr(s));
}

let fallaron = 0, sinCuenta = 0, totalAsserts = 0;
for (const r of resultados) {
  const asserts = contarAsserts(r.salida);
  const perdio = dicePerdio(r.salida);
  const mal = r.codigo !== 0 || r.colgada || perdio;
  if (mal) fallaron++;
  if (asserts === null) sinCuenta++; else totalAsserts += asserts;
  const marca = mal ? '✗' : '✓';
  const cuenta = asserts === null ? '  ? asserts' : `${String(asserts).padStart(4)} asserts`;
  const nota = r.colgada ? `  ⏱ colgada (>${TIEMPO_MAX_MS / 1000} s)`
    : r.codigo !== 0 ? `  salió con código ${r.codigo ?? r.senial}`
    : perdio ? '  ⚠ salió con 0 pero imprimió un fallo' : '';
  console.log(`${marca} ${r.archivo.replace('.test.mjs', '').padEnd(28)} ${cuenta}  ${String(r.ms).padStart(5)} ms${nota}`);
}

// De las que fallaron se vuelca la salida completa: es lo que hace falta leer.
for (const r of resultados) {
  const mal = r.codigo !== 0 || r.colgada || dicePerdio(r.salida);
  if (!mal) continue;
  console.log(`\n──── ${r.archivo} — salida completa ────\n${r.salida.trimEnd()}\n────`);
}

const seg = ((Date.now() - inicio) / 1000).toFixed(1);
console.log(`\n${suites.length - fallaron}/${suites.length} suites OK · ${totalAsserts} asserts contados · ${seg} s`);
if (sinCuenta) console.log(`⚠ ${sinCuenta} suite(s) sin cuenta de asserts legible: el veredicto sale del código de salida.`);
if (fallaron) console.log(`✗ ${fallaron} suite(s) fallaron.`);
process.exit(fallaron ? 1 : 0);
