// tests/import-guarda-owner.test.mjs — el owner no puede correr el import
// COMPLETO de historial (v=298)
//
// EL FALLO QUE PROTEGE ESTE ARCHIVO: `saveMyHistory()` escribía las ocho claves
// `local_<uid>_history_*` para el uid que contestara `/me`, sin preguntar quién
// era. `loadOne()` lee esas claves ANTES que los JSON horneados, así que si el
// owner importaba su export, las siete vistas de historial pasaban a salir de un
// cálculo del navegador, sin las correcciones a mano de los JSON. Sin un error y
// sin un aviso.
//
// LAS DOS CAPAS DE ESTE ARCHIVO:
//
//   1. **Módulo real** (`features/history-data.js`) con dobles de `api.js`,
//      `idb.js` y el cartel degradado (`tests/dobles/loader-guarda.mjs`). Se
//      afirma mirando las ESCRITURAS del doble de IndexedDB, no un `console`.
//   2. **Fuente** de `import-history.js` y del cuerpo de `saveMyHistory()`:
//      dónde se llama a la guarda y que nadie compare contra `HISTORY_OWNER_ID`
//      por su cuenta.
//
// El id del owner aparece acá SOLO para comprobar que la guarda rechaza.
// Corre sin navegador, sin token y sin pegarle a Spotify.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function fakeLocalStorage(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}

// Un id de prueba que se ve que es de prueba.
const PRUEBA = 't46-prueba-guarda-no-owner';
globalThis.localStorage = fakeLocalStorage({ fonoteca_last_user_id: PRUEBA });
globalThis.__DOBLE = { me: PRUEBA, llamadas: [] };
globalThis.__IDB_ESCR = { kv: new Map(), escrituras: [], borrados: [] };

register('./dobles/loader-guarda.mjs', pathToFileURL(import.meta.filename));
const hd = await import('../src/js/features/history-data.js');
const { saveMyHistory, guardarSoloDias, motivoSinImportCompleto, HISTORY_OWNER_ID } = hd;

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
function eq(a, b, nombre) {
  const bien = JSON.stringify(a) === JSON.stringify(b);
  if (!bien) console.log(`      esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
  ok(bien, nombre);
}

const escrituras = () => globalThis.__IDB_ESCR.escrituras;
function reiniciarEscrituras() { globalThis.__IDB_ESCR.escrituras = []; globalThis.__IDB_ESCR.borrados = []; }

const KINDS = ['stats', 'plays', 'listened', 'skip', 'detail', 'records', 'artistTracks', 'days'];
const payload = {
  stats: { years: [] }, trackPlays: {}, listened: [], skipStats: {}, detail: {},
  records: {}, artistTracks: {}, days: { dias: {} },
};

async function capturar(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

// ── 1. El owner: tira, con la marca, y 0 escrituras ─────────────────────────
console.log('\n[1] saveMyHistory() con /me = owner');
{
  ok(typeof HISTORY_OWNER_ID === 'string' && HISTORY_OWNER_ID.length > 10, 'el módulo exporta HISTORY_OWNER_ID');
  globalThis.__DOBLE.me = HISTORY_OWNER_ID;
  reiniciarEscrituras();
  eq(await motivoSinImportCompleto(), 'owner', 'la guarda dice «owner»');
  const err = await capturar(() => saveMyHistory(payload));
  ok(err instanceof Error, 'saveMyHistory() TIRA con el owner');
  ok(err && err.importDelOwner === true, 'el error trae la marca `importDelOwner`');
  ok(err && err.importBloqueado === 'owner', 'y `importBloqueado === "owner"`');
  eq(escrituras().length, 0, 'con el owner: 0 escrituras en IndexedDB');
  ok(!escrituras().some(k => k.startsWith(`local_${HISTORY_OWNER_ID}_history_`)),
    'ninguna clave local_<owner>_history_*');
}

// ── 2. Un id de prueba: las 8 claves, todas bajo ese id ─────────────────────
console.log('\n[2] saveMyHistory() con /me = un id de prueba');
{
  globalThis.__DOBLE.me = PRUEBA;
  reiniciarEscrituras();
  eq(await motivoSinImportCompleto(), null, 'la guarda da paso (null)');
  const err = await capturar(() => saveMyHistory(payload));
  ok(err === null, `saveMyHistory() no tira con un id de prueba${err ? ` (tiró: ${err.message})` : ''}`);
  eq(escrituras().length, 8, '8 escrituras');
  eq([...escrituras()].sort(), KINDS.map(k => `local_${PRUEBA}_history_${k}`).sort(),
    'las ocho claves esperadas, todas bajo el id de prueba');
}

// ── 3. guardarSoloDias() con el owner: 1 escritura, `days`, y ninguna más ───
console.log('\n[3] guardarSoloDias() con /me = owner (la importación «solo el detalle»)');
{
  globalThis.__DOBLE.me = HISTORY_OWNER_ID;
  reiniciarEscrituras();
  const err = await capturar(() => guardarSoloDias({ dias: { '2025-01-01': {} } }));
  ok(err === null, `guardarSoloDias() sigue andando para el owner${err ? ` (tiró: ${err.message})` : ''}`);
  eq(escrituras(), [`local_${HISTORY_OWNER_ID}_history_days`], '1 escritura: local_<owner>_history_days, y ninguna más');
}

// ── 3b. clearMyHistory(): la cuarta puerta del candado (v=309, tanda 57) ─────
// Hasta v=308 `clearMyHistory()` no preguntaba nada: con el owner borraba
// `local_<owner>_history_days` (el detalle por día, lo único que guarda la
// importación «solo el detalle») y sin uid volvía EN SILENCIO, con lo que «Borrarlo»
// anunciaba un borrado que no había hecho. Se mira en los BORRADOS del doble.
const borrados = () => globalThis.__IDB_ESCR.borrados;
const sembrar = (uid) => { for (const k of KINDS) globalThis.__IDB_ESCR.kv.set(`local_${uid}_history_${k}`, { x: 1 }); };
const OTRO = 't57-otro-amigo-que-no-se-toca';
console.log('\n[3b] clearMyHistory()');
{
  // (a) el owner: tira con la marca del owner y 0 borrados.
  globalThis.__DOBLE.me = HISTORY_OWNER_ID;
  reiniciarEscrituras();
  sembrar(HISTORY_OWNER_ID);
  const err = await capturar(() => hd.clearMyHistory());
  ok(err instanceof Error, '(a) owner: clearMyHistory() TIRA');
  ok(err && err.importDelOwner === true && err.importBloqueado === 'owner', '(a) owner: con la marca `importDelOwner`');
  eq(borrados(), [], '(a) owner: 0 borrados');
  ok(globalThis.__IDB_ESCR.kv.has(`local_${HISTORY_OWNER_ID}_history_days`), '(a) owner: local_<owner>_history_days sigue ahí');
  eq(escrituras(), [], '(a) owner: y 0 escrituras');
}
{
  // (d) CONSERVACIÓN: un amigo con identidad confirmada borra sus ocho y solo sus ocho.
  globalThis.__DOBLE.me = PRUEBA;
  reiniciarEscrituras();
  sembrar(PRUEBA); sembrar(OTRO);
  globalThis.__IDB_ESCR.kv.set(`local_${HISTORY_OWNER_ID}_history_days`, { dias: {} });
  const err = await capturar(() => hd.clearMyHistory());
  ok(err === null, `(d) amigo: clearMyHistory() no tira${err ? ` (tiró: ${err.message})` : ''}`);
  eq([...borrados()].sort(), KINDS.map(k => `local_${PRUEBA}_history_${k}`).sort(), '(d) amigo: borra exactamente sus ocho local_<amigo>_history_*');
  ok(!borrados().some(k => !k.startsWith(`local_${PRUEBA}_history_`)), '(d) amigo: y ninguna otra clave');
  ok(globalThis.__IDB_ESCR.kv.has(`local_${HISTORY_OWNER_ID}_history_days`), '(d) amigo: local_<owner>_history_days sigue ahí');
  ok(KINDS.every(k => globalThis.__IDB_ESCR.kv.has(`local_${OTRO}_history_${k}`)), '(d) amigo: las ocho de otro uid siguen ahí');
}
{
  // (c) /me contesta sin uid: tira (un borrado que no se hizo no vuelve en silencio) y 0 borrados.
  globalThis.__DOBLE.me = null;
  reiniciarEscrituras();
  const err = await capturar(() => hd.clearMyHistory());
  ok(err instanceof Error, '(c) /me sin uid: clearMyHistory() TIRA en vez de volver en silencio');
  ok(err && /usuario|user/i.test(err.message), `(c) /me sin uid: el mensaje dice que no se pudo detectar el usuario («${err?.message}»)`);
  eq(borrados(), [], '(c) /me sin uid: 0 borrados');
  globalThis.__DOBLE.me = PRUEBA;
}

// ── 3c. «Borrarlo» cuando la guarda dice que no DESPUÉS de abrir el modal ───
// El handler REAL de `#ih-clear` (`features/import-history.js`, con el modal, los
// toasts y `confirmModal` doblados: `dobles/loader-borrarlo.mjs`). Con el amigo se
// abre el modal (aparece «Borrarlo»); después `/me` pasa a contestar el owner (el
// doble de `getCurrentUserId()` no memoiza, el de verdad sí: por eso esto no se
// puede armar en el banco sin tocar producción) y se aprieta. Sin el `try/catch`
// del handler, el `throw` nuevo llegaría al `unhandledrejection` y al banner.
console.log('\n[3c] «Borrarlo» con la guarda en contra, en el handler real');
{
  register('./dobles/loader-borrarlo.mjs', pathToFileURL(import.meta.filename));
  const { openImportHistory } = await import('../src/js/features/import-history.js');
  globalThis.__DOBLE.toasts = [];
  globalThis.__DOBLE.modal = null;
  let recargas = 0;
  globalThis.location = { reload() { recargas++; } };
  globalThis.__DOBLE.me = PRUEBA;
  reiniciarEscrituras();
  sembrar(PRUEBA);
  globalThis.__IDB_ESCR.kv.set(`local_${PRUEBA}_history_stats`, { years: [] });
  await openImportHistory();
  const clear = globalThis.__DOBLE.modal?.elementos['ih-clear'];
  ok(typeof clear?.onclick === 'function', 'con el amigo, el modal trae «Borrarlo» (#ih-clear) con su handler');
  const cerradosAntes = globalThis.__DOBLE.modal?.cerrados ?? 0;
  globalThis.__DOBLE.me = HISTORY_OWNER_ID;   // la guarda dice «owner» a partir de acá
  const err = await capturar(() => clear.onclick());
  await new Promise(r => setTimeout(r, 500));  // el handler recarga a los 400 ms en el camino de éxito
  ok(err === null, `el handler atrapa el error (no lo deja llegar al unhandledrejection)${err ? ` — se escapó: ${err.message}` : ''}`);
  const t = globalThis.__DOBLE.toasts;
  ok(t.some(x => x.type === 'error' && /desactivada|identidad|usuario/i.test(x.message)), `toast rojo con el mensaje del error (${JSON.stringify(t)})`);
  ok(!t.some(x => /Historial local borrado/.test(x.message)), 'ningún «Historial local borrado»');
  eq((globalThis.__DOBLE.modal?.cerrados ?? 0) - cerradosAntes, 0, 'el modal no se cierra');
  eq(recargas, 0, '0 recargas');
  eq(borrados(), [], '0 borrados');
  globalThis.__DOBLE.me = PRUEBA;
}

// ── 4. /me caído: tira y 0 escrituras ───────────────────────────────────────
// ⚠️ Va ÚLTIMO a propósito: `resolvedUserId()` recuerda el fallo para toda la
// carga del módulo (`meFalloEnEstaCarga`), como en el navegador.
console.log('\n[4] saveMyHistory() con /me que falla');
{
  globalThis.__DOBLE.me = PRUEBA;
  globalThis.__DOBLE.meFalla = 'Rate limited después de 5 reintentos.';
  reiniciarEscrituras();
  eq(await motivoSinImportCompleto(), 'identidad', 'la guarda dice «identidad» (aunque el id guardado no sea el del owner)');
  ok(hd.identidadSinConfirmar() === true, 'identidadSinConfirmar() da true');
  const err = await capturar(() => saveMyHistory(payload));
  ok(err instanceof Error, 'saveMyHistory() tira con /me caído');
  ok(err && err.identidadSinConfirmar === true && !err.importDelOwner, 'con la marca de identidad, no la del owner');
  eq(escrituras().length, 0, 'con /me caído: 0 escrituras');

  // (b) clearMyHistory() con la identidad sin confirmar: tira con esa marca y 0 borrados
  // (acá todavía, porque el fallo de /me queda recordado para toda la carga del módulo).
  reiniciarEscrituras();
  sembrar(PRUEBA);
  const errC = await capturar(() => hd.clearMyHistory());
  ok(errC instanceof Error, '(b) identidad sin confirmar: clearMyHistory() TIRA');
  ok(errC && errC.identidadSinConfirmar === true && !errC.importDelOwner, '(b) con la marca `identidadSinConfirmar`, no la del owner');
  eq(borrados(), [], '(b) identidad sin confirmar: 0 borrados');
  delete globalThis.__DOBLE.meFalla;
}

// ── 5. El fuente: dónde se llama a la guarda ────────────────────────────────
console.log('\n[5] Lectura estática');

const SRC = new URL('../src/js/', import.meta.url).pathname;
const IMPORT = readFileSync(join(SRC, 'features/import-history.js'), 'utf8');
const HDATA = readFileSync(join(SRC, 'features/history-data.js'), 'utf8');

/** El cuerpo de una función, contando llaves desde su `{` de apertura. */
function cuerpoDe(fuente, firma) {
  const i = fuente.indexOf(firma);
  if (i < 0) return null;
  const abre = fuente.indexOf('{', i + firma.length - 1);
  let prof = 0;
  for (let j = abre; j < fuente.length; j++) {
    if (fuente[j] === '{') prof++;
    else if (fuente[j] === '}') { prof--; if (prof === 0) return fuente.slice(abre, j + 1); }
  }
  return null;
}
const sinComentarios = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

{
  const hf = sinComentarios(cuerpoDe(IMPORT, 'async function handleFiles(') || '');
  ok(hf.length > 200, 'encontré el cuerpo de handleFiles()');
  const guarda = hf.indexOf('motivoSinImportCompleto(');
  ok(guarda >= 0, 'handleFiles() llama a la guarda');
  for (const llamada of ['extractHistoryJsons(', 'readFileText(', 'processStreamingHistory(']) {
    const i = hf.indexOf(llamada);
    ok(i >= 0 && guarda >= 0 && guarda < i, `en handleFiles() la guarda va ANTES del primer \`${llamada}\``);
  }

  const oi = sinComentarios(cuerpoDe(IMPORT, 'async function openImportHistory(') || '');
  const gOi = oi.indexOf('motivoSinImportCompleto(');
  ok(gOi >= 0, 'openImportHistory() llama a la guarda');
  ok(gOi >= 0 && gOi < oi.indexOf('hasLocalHistory('), 'y antes de armar el selector (antes de `hasLocalHistory()`)');
  // El selector (`<input type="file">`) y «Borrarlo» viven en el MISMO modal
  // del camino abierto: el bloqueado va por `cuerpoBloqueado()`, que no los trae.
  const cb = sinComentarios(cuerpoDe(IMPORT, 'function cuerpoBloqueado(') || '');
  ok(cb.length > 50 && !/type="file"/.test(cb) && !/ih-clear/.test(cb) && !/ih-drop/.test(cb),
    'la explicación no trae `<input type="file">`, ni `#ih-clear`, ni la zona de arrastre');

  const smh = sinComentarios(cuerpoDe(HDATA, 'async function saveMyHistory(') || '');
  const gS = smh.indexOf('motivoSinImportCompleto(');
  ok(gS >= 0, 'saveMyHistory() llama a la guarda');
  ok(gS >= 0 && gS < smh.indexOf('idbSetCached('), 'y antes de la primera `idbSetCached(`');

  ok(!/HISTORY_OWNER_ID/.test(sinComentarios(IMPORT)), 'import-history.js no compara contra HISTORY_OWNER_ID a mano');
  ok(!/HISTORY_OWNER_ID/.test(smh), 'el cuerpo de saveMyHistory() no compara contra HISTORY_OWNER_ID a mano');

  // Y el censo de comparaciones en todo `src/js/`: `isOwner()`, `loadOne()` y
  // la guarda. Una cuarta es alguien copiando la regla.
  const archivos = [];
  (function barrer(dir) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) barrer(p);
      else if (/\.m?js$/.test(n)) archivos.push(p);
    }
  })(SRC);
  ok(archivos.length > 80, `barrí ${archivos.length} archivos de src/js (guarda del guarda)`);
  const comparaciones = archivos.flatMap(p =>
    (sinComentarios(readFileSync(p, 'utf8')).match(/[!=]==\s*HISTORY_OWNER_ID|HISTORY_OWNER_ID\s*[!=]==/g) || [])
      .map(() => p.slice(SRC.length)));
  eq(comparaciones, ['features/history-data.js', 'features/history-data.js', 'features/history-data.js'],
    'en src/js/ hay exactamente 3 comparaciones contra HISTORY_OWNER_ID, todas en history-data.js');
  const g = sinComentarios(cuerpoDe(HDATA, 'async function motivoSinImportCompleto(') || '');
  ok(/HISTORY_OWNER_ID/.test(g), 'una de ellas es la de la guarda');

  // `#calendario` decide el botón del import entero con la misma regla.
  const CAL = sinComentarios(readFileSync(join(SRC, 'features/calendario.js'), 'utf8'));
  ok(/motivoSinImportCompleto\(/.test(CAL), '#calendario usa la guarda para el botón del import entero');
  ok(/data-cal-cargar/.test(CAL), 'y «Cargar el detalle por día desde tu export» sigue ahí');
}

// ── Quién escribe las claves del historial (v=300, tanda 48) ────────────────
//
// `idbSetCached(localKey(…, '<tipo>'), …)` con un tipo que no sea `'days'`
// aparece SOLO dentro de `saveMyHistory()` (las siete de la importación
// completa, detrás de la guarda). `guardarSoloDias()` —y cualquier otro— puede
// escribir únicamente `'days'`. Hoy es cierto; esto lo vuelve una puerta.
// `HDATA_FUENTE=<ruta>` corre este bloque contra una copia (para verlo fallar).
{
  console.log('\nSolo saveMyHistory() escribe las claves del historial que no son days');
  const fuente = sinComentarios(process.env.HDATA_FUENTE ? readFileSync(process.env.HDATA_FUENTE, 'utf8') : HDATA);
  const escrituras = [...fuente.matchAll(/idbSetCached\(localKey\(\s*\w+\s*,\s*'(\w+)'\s*\)/g)];
  const noDays = escrituras.filter(m => m[1] !== 'days');
  ok(noDays.length > 0, `encuentra escrituras de tipos que no son days (${noDays.map(m => m[1]).join(', ')})`);
  const i0 = fuente.indexOf('async function saveMyHistory(');
  const cuerpo = cuerpoDe(fuente, 'async function saveMyHistory(') || '';
  const i1 = i0 + fuente.slice(i0).indexOf(cuerpo) + cuerpo.length;
  const fuera = noDays.filter(m => !(m.index > i0 && m.index < i1));
  eq(fuera.map(m => m[1]), [], 'ninguna escritura de un tipo que no sea days fuera de saveMyHistory()');
  eq(noDays.filter(m => m.index > i0 && m.index < i1).map(m => m[1]),
    ['stats', 'plays', 'listened', 'skip', 'detail', 'records', 'artistTracks'],
    'y dentro de saveMyHistory() son exactamente las siete');
}

// ── clearMyHistory() pregunta ANTES de borrar (v=309, tanda 57) ─────────────
// La guarda va antes del primer `idbDel(`, igual que en `saveMyHistory()` va antes
// de la primera `idbSetCached(`. `HDATA_FUENTE=<ruta>` también vale acá.
{
  console.log('\nclearMyHistory() llama a la guarda antes de borrar');
  const fuente = sinComentarios(process.env.HDATA_FUENTE ? readFileSync(process.env.HDATA_FUENTE, 'utf8') : HDATA);
  const cmh = cuerpoDe(fuente, 'async function clearMyHistory(') || '';
  ok(cmh.length > 50, 'encontré el cuerpo de clearMyHistory()');
  const g = cmh.indexOf('motivoSinImportCompleto(');
  const d = cmh.indexOf('idbDel(');
  ok(g >= 0, 'clearMyHistory() llama a motivoSinImportCompleto()');
  ok(g >= 0 && d >= 0 && g < d, 'y antes del primer `idbDel(`');
  ok(!/HISTORY_OWNER_ID/.test(cmh), 'el cuerpo de clearMyHistory() no compara contra HISTORY_OWNER_ID a mano');
}

console.log(`\n${pasaron} pasaron · ${fallaron} fallaron`);
if (fallaron) process.exit(1);
