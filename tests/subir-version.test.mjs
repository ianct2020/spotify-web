// tests/subir-version.test.mjs — `npm run subir-version` (tanda 88)
//
// POR QUÉ ESTA SUITE EXISTE: cada despliegue sube a mano el `?v=` en OCHO sitios
// de `src/` (4 en `index.html`, 4 en `callback.html`), y a mano salió mal: hasta
// v=286 las tres hojas de `index.html` iban 29 versiones atrás y los cuatro
// recursos de `callback.html`, 261. El punto 4b de `npm run prepush` lo detecta;
// `scripts/subir-version.mjs` lo hace de una. Esta suite comprueba que lo hace
// bien y, sobre todo, que cuando se niega no escribe NADA.
//
// 🔴 Nunca corre el comando sobre el `src/` real: copia los dos HTML de verdad a
// un directorio temporal y lo apunta ahí con `--raiz`. Así el test sigue siendo
// válido cuando el número real cambie, y no ensucia el repo si algo sale mal.

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(raiz, 'scripts', 'subir-version.mjs');
const HTML = ['index.html', 'callback.html'];

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
// latin1 para que la comparación sea byte a byte: ningún carácter se normaliza.
const leer = p => readFileSync(p, 'latin1');

// El número de los HTML reales, para no clavar el 340 en el test.
const ORIG = Object.fromEntries(HTML.map(f => [f, leer(join(raiz, 'src', f))]));
const V_REAL = Number(ORIG['index.html'].match(/\?v=(\d+)/)[1]);

const temporales = [];
// Una copia nueva por caso: un caso que escribe no puede contaminar al siguiente.
function copia() {
  const dir = mkdtempSync(join(tmpdir(), 'subir-version-'));
  temporales.push(dir);
  mkdirSync(join(dir, 'src'));
  for (const f of HTML) copyFileSync(join(raiz, 'src', f), join(dir, 'src', f));
  // Un `docs/` falso: el comando no lo tiene que tocar nunca (eso es de build.sh).
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'index.html'), `<script src="js/app.js?v=${V_REAL}"></script>\n`);
  return dir;
}
const huellas = dir => [...HTML.map(f => join(dir, 'src', f)), join(dir, 'docs', 'index.html')].map(sha).join(' ');
const correr = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
};
// Una negativa DEL SCRIPT: código 1 y su «✗». Solo el código no alcanza: un
// `node` que no encuentra el script también sale con 1 (pasó en el rojo).
const seNego = r => r.codigo === 1 && r.salida.startsWith('✗ ');
// Lo esperado, armado a mano: los mismos bytes con solo los dígitos de los `?v=` cambiados.
const conVersion = (texto, n) => texto.replace(/\?v=\d+/g, `?v=${n}`);

try {
  console.log(`\n0. Los HTML reales de src/ están parejos (v=${V_REAL}), si no la suite no significa nada`);
  ok(HTML.every(f => (ORIG[f].match(/\?v=\d+/g) || []).length === 4), 'cuatro ?v= en cada HTML real');
  ok(HTML.every(f => ORIG[f].match(/\?v=\d+/g).every(m => m === `?v=${V_REAL}`)), 'todos con el mismo número');

  console.log('\n1. Los ocho iguales → suben en 1 y el resto queda byte a byte igual');
  {
    const dir = copia();
    const docsAntes = sha(join(dir, 'docs', 'index.html'));
    const r = correr('--raiz', dir);
    ok(r.codigo === 0, `sale con 0 (salió ${r.codigo})`);
    for (const f of HTML) {
      ok(leer(join(dir, 'src', f)) === conVersion(ORIG[f], V_REAL + 1), `${f}: igual al original con solo los ?v= en ${V_REAL + 1}`);
    }
    ok(r.salida.includes(`${V_REAL} → ${V_REAL + 1}`), 'imprime antes → después');
    ok(r.salida.includes('bash build.sh'), 'recuerda el paso siguiente: bash build.sh');
    ok(sha(join(dir, 'docs', 'index.html')) === docsAntes, 'docs/ queda igual');
  }

  console.log('\n2. --a N');
  {
    const dir = copia();
    const r = correr('--a', String(V_REAL + 10), '--raiz', dir);
    ok(r.codigo === 0, `--a mayor sale con 0 (salió ${r.codigo})`);
    ok(HTML.every(f => leer(join(dir, 'src', f)) === conVersion(ORIG[f], V_REAL + 10)), `--a ${V_REAL + 10} → los ocho en ${V_REAL + 10}`);
  }
  for (const n of [V_REAL, V_REAL - 1]) {
    const dir = copia();
    const antes = huellas(dir);
    const r = correr('--raiz', dir, '--a', String(n));
    ok(seNego(r), `--a ${n} (no mayor que ${V_REAL}) sale con 1 (salió ${r.codigo})`);
    ok(huellas(dir) === antes, `--a ${n}: los archivos no cambian (sha256)`);
  }
  {
    const dir = copia();
    const antes = huellas(dir);
    const r = correr('--raiz', dir, '--a', 'trescientos');
    ok(seNego(r) && huellas(dir) === antes, '--a con algo que no es un número: 1 y sin cambios');
  }

  console.log('\n3. Un ?v= desparejo → se niega, sin escribir, y nombra archivo y línea');
  {
    const dir = copia();
    const p = join(dir, 'src', 'callback.html');
    const texto = leer(p).replace('main.css?v=', 'main.css?v=1'); // 340 → 1340... o lo que toque
    writeFileSync(p, texto, 'latin1');
    const linea = texto.split('\n').findIndex(l => l.includes('main.css?v=')) + 1;
    const valor = texto.match(/main\.css\?v=(\d+)/)[1];
    const antes = huellas(dir);
    const r = correr('--raiz', dir);
    ok(seNego(r), `sale con 1 (salió ${r.codigo})`);
    ok(huellas(dir) === antes, 'los archivos no cambian (sha256)');
    ok(r.salida.includes(`callback.html:${linea}`), `nombra callback.html:${linea}`);
    ok(r.salida.includes(valor), `y el valor desparejo (${valor})`);
  }

  console.log('\n4. Uno de más o uno de menos → se niega, sin escribir');
  {
    const dir = copia();
    const p = join(dir, 'src', 'index.html');
    writeFileSync(p, leer(p).replace('</head>', `  <link rel="stylesheet" href="css/extra.css?v=${V_REAL}">\n</head>`), 'latin1');
    const antes = huellas(dir);
    const r = correr('--raiz', dir);
    ok(seNego(r) && huellas(dir) === antes, `un noveno ?v= en index.html: 1 y sin cambios (salió ${r.codigo})`);
  }
  {
    const dir = copia();
    const p = join(dir, 'src', 'callback.html');
    writeFileSync(p, leer(p).replace(`theme.css?v=${V_REAL}`, 'theme.css'), 'latin1');
    const antes = huellas(dir);
    const r = correr('--raiz', dir);
    ok(seNego(r) && huellas(dir) === antes, `uno borrado en callback.html: 1 y sin cambios (salió ${r.codigo})`);
  }
  {
    // Ocho en total pero 5 y 3: la cuenta tiene que ser por archivo, no global.
    const dir = copia();
    const pi = join(dir, 'src', 'index.html'), pc = join(dir, 'src', 'callback.html');
    writeFileSync(pi, leer(pi).replace('</head>', `  <link rel="stylesheet" href="css/extra.css?v=${V_REAL}">\n</head>`), 'latin1');
    writeFileSync(pc, leer(pc).replace(`theme.css?v=${V_REAL}`, 'theme.css'), 'latin1');
    const antes = huellas(dir);
    const r = correr('--raiz', dir);
    ok(seNego(r) && huellas(dir) === antes, `5 y 3 (ocho en total): 1 y sin cambios (salió ${r.codigo})`);
  }

  console.log('\n5. --revisar → dice lo que haría y no escribe');
  {
    const dir = copia();
    const antes = huellas(dir);
    const r = correr('--revisar', '--raiz', dir);
    ok(r.codigo === 0, `sale con 0 (salió ${r.codigo})`);
    ok(huellas(dir) === antes, 'los archivos no cambian (sha256)');
    ok(r.salida.includes(String(V_REAL + 1)), `la salida dice el número de después (${V_REAL + 1})`);
  }

  console.log('\n6. Una opción desconocida → se niega, sin escribir');
  {
    // `--revsiar` mal escrito no puede convertirse en una escritura de verdad.
    const dir = copia();
    const antes = huellas(dir);
    const r = correr('--revsiar', '--raiz', dir);
    ok(seNego(r) && huellas(dir) === antes, `--revsiar: 1 y sin cambios (salió ${r.codigo})`);
  }
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
}

console.log(`\n${pasaron} asserts OK, ${fallaron} fallos`);
process.exit(fallaron > 0 ? 1 : 0);
