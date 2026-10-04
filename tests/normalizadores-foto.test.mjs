// tests/normalizadores-foto.test.mjs — LA FOTO de los normalizadores (paso 0)
//
// ════════════════════════════════════════════════════════════════════════════
// QUÉ ES Y POR QUÉ EXISTE
// ════════════════════════════════════════════════════════════════════════════
//
// El informe de reconocimiento del 2026-10-03 censó 19 normalizadores de texto
// repartidos en 16 archivos y propuso un plan de 7 pasos para unificar seis de
// ellos. Los pasos 1, 2 y 3 prometen que «ninguna salida cambia». Diez de esos
// normalizadores (#11 a #20) no tenían NI UN test: la promesa no se podía
// verificar, solo creer.
//
// Este test es la verificación. Pasa un corpus fijo por las 29 entradas del
// censo (las 19 funciones y sus variantes: `albumKey` además de `normPart`,
// `songKeyBase` además de `songKey`…) y compara contra un fixture guardado en
// el repo. Si una unificación altera UNA sola salida, esto se pone rojo.
//
// ⚠️ REGENERAR EL FIXTURE NO ES «ARREGLAR EL TEST». Es declarar que las claves
// cambiaron, y eso tiene un costo medido en peticiones (ver el punto 4 del
// informe). Se regenera a propósito, con `--generar`, y el diff se mira.
//
// ════════════════════════════════════════════════════════════════════════════
// POR QUÉ EL CORPUS GRANDE VA COMO HASH Y NO ENTERO
// ════════════════════════════════════════════════════════════════════════════
//
// Son 39.247 pares reales (16.017 álbumes + 6.926 artistas + 16.304 pistas)
// por 29 funciones = 1,1 millones de salidas. Enteras son ~25 MB de fixture en
// un repo que ya pesa; y un diff de 25 MB no lo mira nadie, que es justo lo que
// el paso 0 tiene que lograr.
//
// Así que el fixture tiene DOS capas:
//
//   1. Los 136 casos a mano, con la salida ENTERA de cada función, una por una.
//      Son los casos que el informe demostró que discriminan («Daft Punk» →
//      «da», «÷» y «=» → la misma clave). Un cambio ahí se LEE en el diff.
//   2. El corpus real, como SHA-256 de todas sus salidas concatenadas, más un
//      hash por bloque de 2.000 para poder localizar dónde cambió. Un cambio
//      ahí se DETECTA, y el test imprime el bloque y las entradas sospechosas.
//
// Las dos capas juntan lo que hace falta: el diff legible donde importa y la
// cobertura exhaustiva donde no cabe.
//
// ════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CENSO } from './normalizadores-censo.mjs';
import { CASOS, cargarCorpus } from './normalizadores-corpus.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(AQUI, 'fixtures', 'normalizadores-foto.json');
const GENERAR = process.argv.includes('--generar');
const TAM_BLOQUE = 2000;

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg}\n  esperado: ${JSON.stringify(b)}\n  dio:      ${JSON.stringify(a)}`); };
const ok = (c, msg) => { n++; assert.ok(c, msg); };

// Aplica una entrada del censo a un par [nombre, artista]. Las de aridad
// 'texto' solo ven el nombre; las de 'par', los dos. Un normalizador que tira
// NO para el test: se guarda el error como salida, porque «tira con esta
// entrada» también es comportamiento que no tiene que cambiar en silencio.
function aplicar(entrada, par) {
  try {
    const r = entrada.aridad === 'par' ? entrada.fn(par[0], par[1]) : entrada.fn(par[0]);
    return typeof r === 'string' ? r : JSON.stringify(r);
  } catch (e) {
    return `\u0000ERROR:${e.name}`;
  }
}

function hashDe(salidas) {
  const h = createHash('sha256');
  for (const s of salidas) { h.update(s); h.update('\u0001'); }
  return h.digest('hex');
}

function porBloques(salidas) {
  const out = [];
  for (let i = 0; i < salidas.length; i += TAM_BLOQUE) out.push(hashDe(salidas.slice(i, i + TAM_BLOQUE)));
  return out;
}

// ── Medir ────────────────────────────────────────────────────────────────────
const corpus = cargarCorpus();
const BLOQUES = [['albums', corpus.albums], ['artistas', corpus.artistas], ['pistas', corpus.pistas]];

const medido = { casos: {}, corpus: {} };
const salidasVivas = new Map();   // `${id}|${bloque}` → salidas, para diagnosticar

for (const e of CENSO) {
  medido.casos[e.id] = CASOS.map(par => aplicar(e, par));
  medido.corpus[e.id] = {};
  for (const [nombreBloque, pares] of BLOQUES) {
    const salidas = pares.map(par => aplicar(e, par));
    salidasVivas.set(`${e.id}|${nombreBloque}`, salidas);
    medido.corpus[e.id][nombreBloque] = {
      n: salidas.length,
      sha256: hashDe(salidas),
      bloques: porBloques(salidas),
    };
  }
}

// ── Generar ──────────────────────────────────────────────────────────────────
if (GENERAR || !existsSync(FIXTURE)) {
  if (!GENERAR) console.log('⚠ el fixture no existe: lo genero. (Esto es el paso 0 corriendo por primera vez.)');
  mkdirSync(join(AQUI, 'fixtures'), { recursive: true });
  const salida = {
    _que_es: 'Foto de las salidas de los 19 normalizadores de texto del censo del informe 2026-10-03. NO editar a mano: se regenera con `node tests/normalizadores-foto.test.mjs --generar`, y regenerarlo es declarar que las claves cambiaron.',
    _corpus: `${CASOS.length} casos a mano + ${corpus.albums.length} álbumes + ${corpus.artistas.length} artistas + ${corpus.pistas.length} pistas de src/data/history-*.json`,
    _tam_bloque: TAM_BLOQUE,
    funciones: CENSO.map(e => ({ n: e.n, id: e.id, aridad: e.aridad, origen: e.origen })),
    casos_entrada: CASOS,
    ...medido,
  };
  writeFileSync(FIXTURE, JSON.stringify(salida, null, 1) + '\n');
  console.log(`Fixture escrito: ${FIXTURE}`);
  console.log(`  ${CENSO.length} funciones × (${CASOS.length} casos a mano + ${corpus.albums.length + corpus.artistas.length + corpus.pistas.length} pares del corpus)`);
  process.exit(0);
}

// ── Comparar ─────────────────────────────────────────────────────────────────
const foto = JSON.parse(readFileSync(FIXTURE, 'utf8'));

console.log('normalizadores-foto — el censo sigue completo');
eq(CENSO.map(e => e.id), foto.funciones.map(f => f.id),
  'las funciones del censo son las mismas que cuando se sacó la foto (si una se unificó, el censo tiene que decirlo)');
eq(CASOS, foto.casos_entrada, 'los casos a mano son los mismos (si cambian, la foto no compara lo mismo)');
eq(foto._tam_bloque, TAM_BLOQUE, 'el tamaño de bloque no cambió');

console.log('\nnormalizadores-foto — los 136 casos a mano, salida por salida');
for (const e of CENSO) {
  const esperado = foto.casos[e.id];
  ok(Array.isArray(esperado), `${e.id}: la foto tiene sus casos`);
  const vivo = medido.casos[e.id];
  // Se comparan uno por uno para que el mensaje diga QUÉ entrada cambió.
  let distintos = 0;
  for (let i = 0; i < esperado.length; i++) {
    if (vivo[i] !== esperado[i]) {
      distintos++;
      if (distintos <= 5) {
        console.log(`  ✗ ${e.id} con ${JSON.stringify(CASOS[i])}: era ${JSON.stringify(esperado[i])}, ahora ${JSON.stringify(vivo[i])}`);
      }
    }
  }
  eq(distintos, 0, `${e.id}: ${distintos} de ${esperado.length} casos a mano cambiaron de salida`);
}

console.log('\nnormalizadores-foto — el corpus real, por hash');
for (const e of CENSO) {
  for (const [nombreBloque] of BLOQUES) {
    const esp = foto.corpus[e.id]?.[nombreBloque];
    ok(esp, `${e.id} / ${nombreBloque}: la foto lo tiene`);
    const viv = medido.corpus[e.id][nombreBloque];
    eq(viv.n, esp.n, `${e.id} / ${nombreBloque}: la cantidad de entradas no cambió`);
    if (viv.sha256 !== esp.sha256) {
      // Diagnóstico: qué bloques de 2.000 difieren y qué entradas los componen.
      const salidas = salidasVivas.get(`${e.id}|${nombreBloque}`);
      const pares = BLOQUES.find(b => b[0] === nombreBloque)[1];
      const malos = viv.bloques.map((h, i) => (h !== esp.bloques[i] ? i : -1)).filter(i => i >= 0);
      console.log(`  ✗ ${e.id} / ${nombreBloque}: cambió. Bloques distintos: ${malos.join(', ')}`);
      for (const b of malos.slice(0, 2)) {
        console.log(`     bloque ${b} = entradas ${b * TAM_BLOQUE}..${Math.min((b + 1) * TAM_BLOQUE, viv.n) - 1}; primeras 5 con su salida ACTUAL:`);
        for (let i = b * TAM_BLOQUE; i < Math.min((b + 1) * TAM_BLOQUE, viv.n) && i < b * TAM_BLOQUE + 5; i++) {
          console.log(`       ${JSON.stringify(pares[i])} → ${JSON.stringify(salidas[i])}`);
        }
      }
      console.log('     Para ver las salidas de antes: `git stash` y volver a correr con --generar en otra copia.');
    }
    eq(viv.sha256, esp.sha256, `${e.id} / ${nombreBloque}: el hash de las ${esp.n} salidas no cambió`);
  }
}

// ── Lo estructural: que el censo no se desarme en silencio ───────────────────
//
// `extraer()` ya tira si una función no exportada desaparece. Lo que falta es
// que nadie convierta una entrada del censo en otra cosa sin que se note.
console.log('\nnormalizadores-foto — estructura');
const leerSrc = (rel) => readFileSync(join(AQUI, '..', 'src', 'js', rel), 'utf8');

ok(/export function normText/.test(leerSrc('util/track-match.js')),
  'normText sigue exportada de util/track-match.js (es la que más llamadores tiene)');
ok(/export \{ normPart as _normPart \}/.test(leerSrc('util/album-key.js')),
  'album-key sigue exportando _normPart para que la foto lo mire sin duplicarlo');

// PASO 1: los tres proveedores no pueden volver a tener un `norm` propio. El
// censo los apunta a `normProveedor`, así que una copia nueva pasaría inadvertida
// para la foto; esto es lo que la ve.
for (const rel of ['api/itunes.js', 'api/preview-providers.js', 'api/statsfm.js']) {
  const txt = leerSrc(rel);
  ok(/from '\.\.\/util\/texto\.js'/.test(txt), `${rel} importa el normalizador de util/texto.js`);
  ok(!/^\s*function (norm|normName)\s*\(/m.test(txt), `${rel} no volvió a definir su propio norm`);
}
ok(/export function normProveedor/.test(leerSrc('util/texto.js')),
  'util/texto.js exporta normProveedor (la única copia del cuerpo)');

const cuantasDefiniciones = (rel, re) => (leerSrc(rel).match(re) || []).length;
eq(cuantasDefiniciones('features/wthree.js', /\.toLowerCase\(\)\.replace\(\/\\s\*\[\(\[\]/g), 1,
  'wthree: el regex de delimitadores MEZCLADOS de likeNameKey está una sola vez');

console.log(`\nOK normalizadores-foto: ${n} asserts`);
