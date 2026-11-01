// tests/import-historial-caido.test.mjs — tanda 110 (v=353), T110c.
//
// El modal del import (`openImportHistory()`, `features/import-history.js`) pregunta `hasLocalHistory()` para saber
// si ofrecer «Borrarlo». Si la lectura de IndexedDB FALLA, `hasLocalHistory()` da `false` —lo mismo que «no hay»— y
// hasta v=352 el modal ofrecía importar como si no hubiera nada: importar encima de un historial que no se pudo leer
// puede pisarlo. Desde v=353, después de `hasLocalHistory()` el modal lee el registro de la tanda 109
// (`falloDeLecturaDelHistorial('stats')` con `origen === 'hasLocalHistory'`) y, si hay, NO ofrece importar (ni zona de
// arrastre ni `<input type="file">`) y lo dice. `hasLocalHistory()` no cambió lo que devuelve.
//
// `import-history.js`, `history-data.js` y `history-keys.js` son los REALES (dobles por `tests/dobles/loader-t110.mjs`).
// Una cuenta INVENTADA (`t110inventada-amigo`), que no es el owner. `T110_SRC` apunta a otra copia de `src/`.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const RAIZ_SRC = process.env.T110_SRC ? resolve(process.env.T110_SRC) : resolve(import.meta.dirname, '../src');
const url = (p) => pathToFileURL(resolve(RAIZ_SRC, p)).href;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const AMIGO = 't110inventada-amigo';
const TEXTO = 'No se ha podido comprobar si ya tienes un historial guardado en este navegador. Recarga la página antes de importar.';

// Medidos con este mismo test contra la copia de 27a0e64d (v=352).
const SHA_352 = {
  sinHistorial: '4b2cc347f303baeec36275033ecb2887c22e686cc6dcce7c72f59b1109410532',
  conHistorial: 'a9d764a2c9686f3ac1e002c73896d3c4c02f0f513ac45df82a66077b4bc37d1c',
};

const estado = { idbTira: null, stats: null };
let modal = null;
function el() { return { innerHTML: '', style: {}, classList: { add() {}, remove() {} }, onclick: null }; }
globalThis.__T110 = {
  valores: {},
  stubs: {
    'api.js:getCurrentUserId': async () => AMIGO,
    'idb.js:idbGetCached': async (k) => {
      if (estado.idbTira && estado.idbTira.test(k)) throw new Error('doble t110: IndexedDB inventada caída al leer ' + k);
      return k === `local_${AMIGO}_history_stats` ? estado.stats : null;
    },
    'idb.js:idbSetCached': async () => {},
    'idb.js:idbDel': async () => {},
    'ui/components.js:escapeHtml': (s) => String(s),
    'ui/modal-stack.js:openModal': ({ html }) => { modal = { html, querySelector: () => el() }; return modal; },
  },
};
globalThis.document = { addEventListener() {}, getElementById: () => null };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
console.warn = () => {};

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/features/import-history.js', '/js/features/history-data.js', '/js/history-keys.js'] },
});
const hd = await import(url('js/features/history-data.js'));
const ih = await import(url('js/features/import-history.js'));
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const medidos = {};
const ofreceImportar = (h) => /id="ih-drop"/.test(h) || /type="file"/.test(h);

console.log(`\n[180] ${AMIGO}, la IndexedDB TIRA al leer local_${AMIGO}_history_stats: openImportHistory()`);
{
  estado.idbTira = /^local_/; modal = null;
  await ih.openImportHistory();
  const h = modal?.html || '';
  ok(hd.falloDeLecturaDelHistorial()?.origen === 'hasLocalHistory', 'el registro tiene la anotación de hasLocalHistory()');
  ok(!ofreceImportar(h), 'el modal NO ofrece importar (ni zona de arrastre ni <input type="file">)');
  ok(h.includes(TEXTO), 'dice «No se ha podido comprobar si ya tienes un historial guardado en este navegador. Recarga la página antes de importar.»');
  ok(!/id="ih-clear"/.test(h), 'y no ofrece «Borrarlo»');
  ok(/Mi historial de Spotify/.test(h), 'con la cabecera de siempre');
}

console.log(`\n[sano · sin historial] ${AMIGO}, la IndexedDB vacía que NO tira`);
{
  estado.idbTira = null; estado.stats = null; modal = null;
  await ih.openImportHistory();
  const h = modal?.html || '';
  ok(ofreceImportar(h), 'ofrece importar');
  medidos.sinHistorial = sha(h);
  ok(SHA_352.sinHistorial === medidos.sinHistorial, `el modal con el mismo sha256 que en 27a0e64d (${medidos.sinHistorial.slice(0, 12)}…)`);
}

console.log(`\n[sano · con historial] ${AMIGO}, con un historial importado que se lee bien`);
{
  estado.stats = { years: [{ year: 2024 }] }; modal = null;
  await ih.openImportHistory();
  const h = modal?.html || '';
  ok(/id="ih-clear"/.test(h), 'ofrece «Borrarlo»');
  medidos.conHistorial = sha(h);
  ok(SHA_352.conHistorial === medidos.conHistorial, `el modal con el mismo sha256 que en 27a0e64d (${medidos.conHistorial.slice(0, 12)}…)`);
}

console.log(`\nsha256 medidos: ${JSON.stringify(medidos)}`);
console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
