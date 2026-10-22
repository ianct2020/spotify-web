// tests/guard-ruta-vieja.test.mjs — la pantalla de error de una ruta vieja no tapa la vigente (v=325)
//
// EL FALLO QUE PROTEGE ESTE ARCHIVO: `guardRoute()` (`ui/crash-guard.js`) envuelve el render
// de cada ruta y lo que pinta lo pinta en `container`, que es `#main-content`: el MISMO
// contenedor para todas las rutas. Si la ruta A todavía está cargando cuando te vas a B, y
// después A TIRA, el `catch` hacía `pantallaDeError(container, err)` y tapaba B con el error
// de A, aunque B estuviera bien. Y el otro camino: si A termina SIN pintar mientras
// `#main-content` todavía tiene el esqueleto de carga de B (`data-route-placeholder`),
// `estaEnBlanco()` daba verdadero y le pintaba «Esta página quedó vacía» encima a B.
//
// Arreglo (v=325): `guardRoute(container, handler, { vigente })`. Con la ruta NO vigente no
// pinta nada en `container`; el error va a la consola, crudo, con
// `console.warn('[crash-guard] la ruta vieja falló después de que saliste:', err)`. Sin el
// tercer argumento, o con la ruta vigente, todo como antes. `handleRoute()` le pasa
// `{ vigente: () => rutaVigente(gen) }`.
//
// Carga el `router.js` y el `crash-guard.js` REALES en Node con el DOM mínimo de
// `tests/router-teardown.test.mjs` (más un `querySelector` para que `pantallaDeError` pueda
// escribir) y rutas INVENTADAS, registradas solo acá. Sin red, sin datos de nadie.
// El caso real (la app entera, `#records` con su `/me` retenida) es el banco
// `tests/banco/guard-ruta-vieja.html`.
//
//   node tests/guard-ruta-vieja.test.mjs     (ROUTER=<ruta> / CRASH_GUARD=<ruta> para probar otros)

import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER = process.env.ROUTER || join(RAIZ, 'src/js/router.js');
const CRASH_GUARD = process.env.CRASH_GUARD || join(RAIZ, 'src/js/ui/crash-guard.js');

let pasaron = 0, fallaron = 0;
function ok(cond, msg) {
  if (cond) { pasaron++; console.log(`  ✓ ${msg}`); }
  else { fallaron++; console.log(`  ✗ ${msg}`); }
}

// ── DOM mínimo (el de router-teardown, con `querySelector`) ──────────────────
function elRuta(route) {
  const clases = new Set();
  return {
    dataset: { route },
    classList: {
      toggle(c, on) { if (on) clases.add(c); else clases.delete(c); },
      contains(c) { return clases.has(c); },
    },
    closest() { return null; },
  };
}
const RUTAS = ['rota', 'vigente-b', 'muda', 'espera', 'rota-sola', 'muda-sola'];
const enlaces = RUTAS.map(elRuta);
// Un contenedor de mentira: guarda el HTML como texto. `estaEnBlanco()` lo lee por
// `childElementCount`/`firstElementChild`/`textContent`, y `pantallaDeError()` le busca el
// botón de recargar con `querySelector` (acá no hay botón que enganchar: null).
function contenedor() {
  let html = '';
  return {
    set innerHTML(v) { html = String(v); },
    get innerHTML() { return html; },
    get textContent() { return html.replace(/<[^>]*>/g, ''); },
    get childElementCount() { return html.trim() ? 1 : 0; },
    get firstElementChild() { return { hasAttribute: (a) => html.includes(a) }; },
    querySelector() { return null; },
  };
}
const main = contenedor();
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.document = {
  getElementById: (id) => (id === 'main-content' ? main : null),
  querySelectorAll: (sel) => (sel === '[data-route]' ? enlaces : []),
  dispatchEvent() {},
};
globalThis.window = { location: { hash: '' }, addEventListener() {} };
const ls = new Map();
globalThis.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
let avisos = [], errores = [];
console.warn = (...a) => avisos.push(a.map(String).join(' '));
console.error = (...a) => errores.push(a.map(String).join(' '));

const tic = () => new Promise((r) => setImmediate(r));
const crashScreen = (h) => h.includes('class="crash-screen"');
const avisosViejos = () => avisos.filter((a) => a.startsWith('[crash-guard] la ruta vieja falló'));

let nCaso = 0;
async function routerNuevo() {
  avisos = []; errores = [];
  main.innerHTML = '';
  const r = await import(pathToFileURL(ROUTER).href + `?caso=${++nCaso}`);
  const ir = async (hash) => { window.location.hash = '#' + hash; return r.handleRoute(); };
  return { ...r, ir };
}
// Una espera que el caso suelta cuando quiere.
function retenida() {
  const ctl = { soltar: null };
  ctl.promesa = new Promise((res) => { ctl.soltar = res; });
  return ctl;
}

// ── 1. A lenta que TIRA, estando ya en B ─────────────────────────────────────
{
  console.log('\n1. A lenta que tira después de que te fuiste a B');
  const R = await routerNuevo();
  const espera = retenida();
  R.registerRoute('rota', async (el) => {
    el.innerHTML = '<div>rota cargando</div>';
    await espera.promesa;
    throw new Error('A se rompió tarde');
  });
  R.registerRoute('vigente-b', (el) => { el.innerHTML = '<div class="b">contenido de B</div>'; });
  const pA = R.ir('rota');
  await tic();
  await R.ir('vigente-b');
  espera.soltar();
  let tiro = null;
  try { await pA; } catch (e) { tiro = e; }
  await tic();
  const h = main.innerHTML;
  ok(tiro === null, `handleRoute() de la ruta vieja no tira (${tiro})`);
  ok(!crashScreen(h), `#main-content NO tiene .crash-screen (tiene: ${JSON.stringify(h.replace(/\s+/g, ' ').slice(0, 120))})`);
  ok(h.includes('contenido de B'), '#main-content sigue teniendo el contenido de B');
  const v = avisosViejos();
  ok(v.length === 1, `hay UN console.warn('[crash-guard] la ruta vieja falló…') (hay ${v.length})`);
  ok(v.length === 1 && v[0].includes('A se rompió tarde'), `y trae el error crudo de A (${JSON.stringify(v[0] || '')})`);
}

// ── 2. A lenta que termina SIN pintar, estando en B con su placeholder ───────
{
  console.log('\n2. A lenta termina sin pintar mientras B (que hace await antes de escribir) está en su esqueleto');
  const R = await routerNuevo();
  const esperaA = retenida(), esperaB = retenida();
  R.registerRoute('muda', async (el) => {
    el.innerHTML = '<div>muda cargando</div>';
    await esperaA.promesa;
    // La guarda de vigencia de siempre: se fue, no escribe nada.
    return undefined;
  });
  R.registerRoute('espera', async (el) => {
    await esperaB.promesa;   // B espera ANTES de escribir: `main` queda con el esqueleto del router
    el.innerHTML = '<div class="b">B ya pintó</div>';
  });
  const pA = R.ir('muda');
  await tic();
  const pB = R.ir('espera');
  await tic();
  const antes = main.innerHTML;
  esperaA.soltar();
  await pA;
  await tic();
  const h = main.innerHTML;
  ok(antes.includes('data-route-placeholder'), 'precondición: mientras B espera, #main-content tiene el esqueleto del router');
  ok(h.includes('data-route-placeholder'), '#main-content sigue con el esqueleto de B cuando A termina');
  ok(!h.includes('quedó vacía') && !crashScreen(h), `sin «Esta página quedó vacía» ni .crash-screen (tiene: ${JSON.stringify(h.replace(/\s+/g, ' ').slice(0, 120))})`);
  esperaB.soltar();
  await pB;
  await tic();
  ok(main.innerHTML.includes('B ya pintó') && !crashScreen(main.innerHTML), 'y después B pinta lo suyo, sin pantalla de error');
}

// ── 3. Conservación: con la ruta VIGENTE, todo como antes ────────────────────
{
  console.log('\n3. conservación: la ruta vigente que tira o que termina sin pintar');
  const R = await routerNuevo();
  const espera = retenida();
  R.registerRoute('rota-sola', async (el) => {
    el.innerHTML = '<div>rota-sola cargando</div>';
    await espera.promesa;
    throw new Error('la vigente se rompió');
  });
  const p = R.ir('rota-sola');
  await tic();
  espera.soltar();
  await p;
  await tic();
  ok(crashScreen(main.innerHTML) && main.innerHTML.includes('Se rompió algo al cargar esta página') && main.innerHTML.includes('la vigente se rompió'),
    'una ruta vigente que tira: la pantalla de error en #main-content, con su mensaje, como hoy');
  ok(errores.some((e) => e.startsWith('[crash-guard] la ruta rompió:')) && avisosViejos().length === 0,
    `y el console.error('[crash-guard] la ruta rompió:', …) de siempre, sin el aviso de ruta vieja (${errores.length} errores, ${avisosViejos().length} avisos)`);

  const esperaM = retenida();
  R.registerRoute('muda-sola', async () => { await esperaM.promesa; return undefined; });
  const pM = R.ir('muda-sola');
  await tic();
  esperaM.soltar();
  await pM;
  await tic();
  ok(crashScreen(main.innerHTML) && main.innerHTML.includes('Esta página quedó vacía'),
    'una ruta vigente que termina sin pintar: «Esta página quedó vacía», como hoy');
}

// ── 4. `guardRoute()` suelto: sin el tercer argumento, igual que hoy ─────────
{
  console.log('\n4. guardRoute() sin el tercer argumento, o con la ruta vigente');
  const { guardRoute } = await import(pathToFileURL(CRASH_GUARD).href);
  for (const [nombre, extra] of [['sin tercer argumento', undefined], ['con { vigente: () => true }', { vigente: () => true }]]) {
    const el = contenedor();
    el.innerHTML = '<div>algo</div>';
    const r1 = await (extra ? guardRoute(el, async () => { throw new Error('tiró'); }, extra) : guardRoute(el, async () => { throw new Error('tiró'); }));
    ok(r1 === null && crashScreen(el.innerHTML) && el.innerHTML.includes('tiró'), `${nombre}: el handler que tira → pantalla de error y null`);
    const el2 = contenedor();
    const r2 = await (extra ? guardRoute(el2, async () => {}, extra) : guardRoute(el2, async () => {}));
    ok(r2 === null && el2.innerHTML.includes('Esta página quedó vacía'), `${nombre}: el handler que no pinta → «quedó vacía» y null`);
    const el3 = contenedor();
    const limpieza = () => {};
    const r3 = await (extra ? guardRoute(el3, async (c) => { c.innerHTML = '<div>pintado</div>'; return limpieza; }, extra) : guardRoute(el3, async (c) => { c.innerHTML = '<div>pintado</div>'; return limpieza; }));
    ok(r3 === limpieza && el3.innerHTML === '<div>pintado</div>', `${nombre}: el handler que pinta → devuelve su teardown y no se toca nada`);
  }
}

// ── 5. `guardRoute()` suelto con la ruta NO vigente: qué devuelve ───────────
{
  console.log('\n5. guardRoute() con la ruta no vigente: no pinta, y devuelve lo mismo que hoy');
  const { guardRoute } = await import(pathToFileURL(CRASH_GUARD).href);
  avisos = [];
  const el = contenedor();
  el.innerHTML = '<div>la de ahora</div>';
  const r1 = await guardRoute(el, async () => { throw new Error('vieja rota'); }, { vigente: () => false });
  ok(r1 === null && el.innerHTML === '<div>la de ahora</div>', 'el handler que tira → null, sin tocar el contenedor');
  ok(avisosViejos().length === 1 && avisosViejos()[0].includes('vieja rota'), 'y el console.warn con el error crudo');
  const el2 = contenedor();
  const limpieza = () => {};
  const r2 = await guardRoute(el2, async () => limpieza, { vigente: () => false });
  ok(r2 === limpieza && el2.innerHTML === '', 'el handler que termina sin pintar → devuelve su teardown (el router decide), sin pintar «quedó vacía»');
}

console.log(`\nrouter: ${ROUTER}\ncrash-guard: ${CRASH_GUARD}`);
console.log(`${pasaron} pasaron · ${fallaron} fallaron`);
if (fallaron) process.exit(1);
