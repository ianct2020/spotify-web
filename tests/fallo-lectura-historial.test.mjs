// tests/fallo-lectura-historial.test.mjs — tanda 109 (v=352).
//
// Tres `catch` de `history-data.js` convertían un FALLO de lectura del historial en el mismo
// `null` / `false` que «no hay historial», y el candado (`ownerLockedMessage()`) le ofrecía
// importar a quien ya lo había importado:
//   · el de la lectura BYOH de `loadOne()` (`local_<uid>_history_<kind>` que tira);
//   · el de IndexedDB de `hasLocalHistory()`;
//   · el final del `fetch` del owner en `loadOne()` (500, rechazo, 200 que no es JSON).
// Ninguno cambia lo que devuelve: el fallo queda ANOTADO en el módulo y el candado lo dice
// («No se ha podido leer tu historial», sin el botón de importar).
//
// `history-data.js` es el REAL. Se doblan `api.js`, `idb.js` y `ui/degraded-banner.js`
// (tests/dobles/fallo-lectura-doble.mjs, por tests/dobles/loader-fallo-lectura.mjs) y
// `globalThis.fetch`. Uids INVENTADOS (`t109inventada-…`); el del owner aparece solo para
// simular su `/me` (es el `HISTORY_OWNER_ID` público del repo).
//
// `T109_SRC` (opcional) apunta a otra copia de `src/` (los rojos contra 5f95c6c7).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const RAIZ_SRC = process.env.T109_SRC ? resolve(process.env.T109_SRC) : resolve(import.meta.dirname, '../src');
const url = (p) => pathToFileURL(resolve(RAIZ_SRC, p)).href;

const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';
const AMIGO = 't109inventada-amigo';
const AMIGO2 = 't109inventada-otro-amigo';
const TITULO = 'Las que menos te saltas';
// `ownerLockedMessage('Las que menos te saltas')` en 5f95c6c7 (v=351): sin un fallo anotado tiene
// que seguir siendo EXACTAMENTE esto.
const SHA_CANDADO_351 = 'd7c273d4e086bddf0f9970b96abd0efd5a8e2f2c3d932d2fa886c0a73b3bdf63';
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

globalThis.__T109 = { me: AMIGO, meFalla: null, idbTira: null, lecturasIdb: [], escriturasIdb: [], borradosIdb: [], banners: 0 };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const STATS = { years: [{ year: 2024, plays: 1 }] };
let modo = 'ok';
const pedidos = [];
globalThis.fetch = async (u) => {
  const s = String(u);
  pedidos.push(s);
  if (modo === '500') return new Response('error inventado t109', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return new Response(JSON.stringify(STATS), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const avisos = [];
console.warn = (...a) => avisos.push(a.map(x => x instanceof Error ? x.message : String(x)).join(' '));
console.log = ((log) => (...a) => { if (!String(a[0]).startsWith('[history-data]')) log(...a); })(console.log);

register('./dobles/loader-fallo-lectura.mjs', pathToFileURL(import.meta.filename));
const hd = await import(url('js/features/history-data.js'));
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const candado = () => hd.ownerLockedMessage(TITULO);
const esElDeSiempre = (h) => sha(h) === SHA_CANDADO_351;
const esElNuevo = (h) => /No se ha podido leer tu historial/.test(h) && /Recarga la página para volver a intentarlo/.test(h) && !/data-open-import/.test(h) && /class="olm-card"/.test(h);
const desc = (h) => esElDeSiempre(h) ? 'el de siempre (importar)' : esElNuevo(h) ? 'el nuevo' : `otro (${h.slice(0, 80).replace(/\s+/g, ' ')}…)`;
async function llamar(fn) { try { return { r: await fn(), tiro: null }; } catch (e) { return { r: undefined, tiro: e }; } }
function reset() { pedidos.length = 0; avisos.length = 0; }

// ── Conservación: un amigo sin historial y sin fallos ─────────────────────
console.log(`\n[sano] amigo (${AMIGO}) sin historial, IndexedDB vacía que NO tira`);
{
  reset();
  const { r, tiro } = await llamar(() => hd.loadHistoryStats());
  ok(!tiro && r === null, `loadHistoryStats() → null sin tirar${tiro ? ` (tiró: ${tiro.message})` : ''}`);
  ok(pedidos.length === 0, `0 fetch (hubo ${pedidos.length})`);
  ok(esElDeSiempre(candado()), `ownerLockedMessage() con el mismo sha256 que en 5f95c6c7 (es ${desc(candado())})`);
}

// ── 292: la lectura BYOH que tira ─────────────────────────────────────────
console.log(`\n[292] amigo, la lectura de local_${AMIGO}_history_stats TIRA (doble de idb.js)`);
{
  reset(); globalThis.__T109.idbTira = new RegExp(`^local_${AMIGO}_history_stats$`);
  const { r, tiro } = await llamar(() => hd.loadHistoryStats());
  ok(!tiro && r === null, `loadHistoryStats() sigue en null sin tirar${tiro ? ` (tiró: ${tiro.message})` : ''}`);
  ok(pedidos.length === 0, `0 fetch (hubo ${pedidos.length})`);
  ok(esElNuevo(candado()), `ownerLockedMessage() da la tarjeta nueva, sin importar (es ${desc(candado())})`);
  ok(avisos.some(a => a.startsWith('[history-data]') && /IndexedDB inventada caída/.test(a)), `console.warn('[history-data] …') con el error crudo (avisos: ${JSON.stringify(avisos)})`);
}

console.log('\n[292 → bien] la misma lectura sale bien después: el candado vuelve a ser el de siempre');
{
  reset(); globalThis.__T109.idbTira = null;
  const { r } = await llamar(() => hd.loadHistoryStats());
  ok(r === null, 'loadHistoryStats() → null (no hay historial: eso sí es un resultado)');
  ok(esElDeSiempre(candado()), `el candado, el de siempre (es ${desc(candado())})`);
}

// ── 180: hasLocalHistory() con la IndexedDB que tira ──────────────────────
console.log('\n[180] amigo, hasLocalHistory() con la IndexedDB que TIRA');
{
  reset(); globalThis.__T109.idbTira = /^local_/;
  const { r, tiro } = await llamar(() => hd.hasLocalHistory());
  ok(!tiro && r === false, `hasLocalHistory() sigue en false sin tirar${tiro ? ` (tiró: ${tiro.message})` : ` (dio ${JSON.stringify(r)})`}`);
  ok(esElNuevo(candado()), `el candado dice lo nuevo (es ${desc(candado())})`);
  ok(avisos.some(a => a.startsWith('[history-data]')), `console.warn('[history-data] …') (avisos: ${JSON.stringify(avisos)})`);
  globalThis.__T109.idbTira = null;
  const otra = await llamar(() => hd.hasLocalHistory());
  ok(otra.r === false, 'la misma lectura sale bien después: false');
  ok(esElDeSiempre(candado()), `y el candado vuelve a ser el de siempre (es ${desc(candado())})`);
}

// ── Cambiar de uid vacía el registro ──────────────────────────────────────
console.log(`\n[uid] un fallo de ${AMIGO} y después /me = ${AMIGO2}: el registro se vacía`);
{
  reset(); globalThis.__T109.idbTira = new RegExp(`^local_${AMIGO}_history_stats$`);
  await llamar(() => hd.loadHistoryStats());
  const conFallo = candado();
  globalThis.__T109.idbTira = null; globalThis.__T109.me = AMIGO2;
  // Otro `kind` (records): la única forma de que se borre el fallo de `stats` es el cambio de uid.
  await llamar(() => hd.loadRecords());
  ok(esElDeSiempre(candado()), `con ${AMIGO2}, el candado de siempre (con ${AMIGO} era ${desc(conFallo)}; ahora ${desc(candado())})`);
}

// ── 334: el fetch del owner que falla ─────────────────────────────────────
for (const [m, como] of [['500', 'fetch → Response 500'], ['rechaza', 'fetch rechaza con TypeError("Failed to fetch")'], ['nojson', 'fetch → Response 200 con HTML (res.json() tira SyntaxError)']]) {
  console.log(`\n[334 · ${m}] owner (/me = owner, IndexedDB vacía), history-stats.json: ${como}`);
  globalThis.__T109.me = OWNER; modo = m; reset();
  const { r, tiro } = await llamar(() => hd.loadHistoryStats());
  ok(!tiro && r === null, `loadHistoryStats() sigue en null sin tirar${tiro ? ` (tiró: ${tiro.message})` : ''}`);
  ok(pedidos.filter(p => /history-stats\.json/.test(p)).length === 1, `pidió history-stats.json una vez (pidió ${pedidos.length})`);
  ok(esElNuevo(candado()), `el candado dice lo nuevo (es ${desc(candado())})`);
}

console.log('\n[334 · con la opción] loadListenedAlbums({ tirarSiFalla: true }) con el 500: sigue tirando, y anota');
{
  modo = 'ok'; await llamar(() => hd.loadHistoryStats());   // deja el registro limpio de `stats`
  modo = '500'; reset();
  const { tiro } = await llamar(() => hd.loadListenedAlbums({ tirarSiFalla: true }));
  ok(tiro && /HTTP 500/.test(tiro.message), `tira el mismo error de siempre (${tiro ? tiro.message : 'no tiró'})`);
  ok(esElNuevo(candado()), `el candado dice lo nuevo (es ${desc(candado())})`);
  modo = 'ok';
  const bien2 = await llamar(() => hd.loadListenedAlbums({ tirarSiFalla: true }));
  ok(bien2.r && bien2.r.years, 'el mismo kind sale bien después');
  ok(esElDeSiempre(candado()), `y el candado vuelve a ser el de siempre (es ${desc(candado())})`);
}

console.log('\n[334 → bien] owner con el JSON bien: los datos y el candado de siempre');
{
  modo = 'ok'; reset();
  const { r } = await llamar(() => hd.loadHistoryStats());
  ok(JSON.stringify(r) === JSON.stringify(STATS), 'loadHistoryStats() trae el JSON');
  ok(esElDeSiempre(candado()), `el candado, el de siempre (es ${desc(candado())})`);
}

// ── loadDays(): su `fetchUrlForOwner` tira a propósito, y NO es un fallo de lectura ──
console.log('\n[days] loadDays() del owner sin detalle: null, sin tirar, 0 fetch y SIN anotar nada');
{
  reset();
  const { r, tiro } = await llamar(() => hd.loadDays());
  ok(!tiro && r === null, `null sin tirar${tiro ? ` (tiró: ${tiro.message})` : ''}`);
  ok(pedidos.length === 0, `0 fetch (hubo ${pedidos.length})`);
  ok(esElDeSiempre(candado()), `el candado sigue siendo el de siempre (es ${desc(candado())})`);
  if (typeof hd.falloDeLecturaDelHistorial === 'function') ok(hd.falloDeLecturaDelHistorial() === null, 'falloDeLecturaDelHistorial() → null');
}

// Va ÚLTIMO: `meFalloEnEstaCarga` queda puesto para el resto del proceso.
console.log('\n[identidad] /me tira (identidad sin confirmar): la tarjeta de identidad, igual que hoy');
{
  globalThis.__T109.meFalla = 'doble: /me en 429'; globalThis.__T109.idbTira = /^local_/; reset();
  const { r } = await llamar(() => hd.loadSkipStats());
  ok(r === null, 'loadSkipStats() → null');
  const h = await llamar(() => hd.hasLocalHistory());
  ok(h.r === false && !h.tiro, 'hasLocalHistory() → false (175: getCurrentUserId() tira)');
  ok(/No hemos podido confirmar tu identidad/.test(candado()), `el candado es el de identidad (empieza: ${candado().slice(0, 0)}${/No hemos podido confirmar/.test(candado()) ? 'identidad' : desc(candado())})`);
}

console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
