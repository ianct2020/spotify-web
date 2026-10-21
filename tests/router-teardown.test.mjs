// tests/router-teardown.test.mjs — el teardown de la ruta vieja no pisa el de la vigente (v=324)
//
// EL FALLO QUE PROTEGE ESTE ARCHIVO: `handleRoute()` (`router.js`) hacía
// `currentCleanup = await guardRoute(main, handler)` sin preguntar si la ruta seguía
// vigente. Con una vista A lenta y una B rápida: abrís A, te vas a B antes de que A
// termine, B deja `currentCleanup = teardownB`, y cuando A termina lo PISA con el suyo
// (o con `null`). Al salir de B corría el de A y el de B no corría nunca: el `abort()`
// del escaneo de `#mapa`, el `ResizeObserver` de `#mapa-artistas`… quedaban vivos. Lo
// reprodujo la tanda 57 (`fonoteca-migracion/router-vigencia-repro-2026-10-15.mjs`); de
// ahí sale este archivo.
//
// Carga el `router.js` REAL en Node con un `document`/`window` mínimos (`crash-guard.js`
// y `skeleton.js` no importan nada) y rutas INVENTADAS, registradas solo acá. Cada caso
// importa el router con otro `?caso=` para arrancar con el estado en cero.
// Sin red, sin datos de nadie.
//
//   node tests/router-teardown.test.mjs            (ROUTER=<ruta> para probar otro router.js)

import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER = process.env.ROUTER || join(RAIZ, 'src/js/router.js');

let pasaron = 0, fallaron = 0;
function ok(cond, msg) {
  if (cond) { pasaron++; console.log(`  ✓ ${msg}`); }
  else { fallaron++; console.log(`  ✗ ${msg}`); }
}

// ── DOM mínimo (el de la reproducción de la 57) ──────────────────────────────
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
const RUTAS = ['lenta', 'rapida', 'tercera', 'sinnada', 'rota', 'sola', 'siguiente'];
const enlaces = RUTAS.map(elRuta);
let html = '';
const main = {
  set innerHTML(v) { html = String(v); },
  get innerHTML() { return html; },
  get textContent() { return html.replace(/<[^>]*>/g, ''); },
  get childElementCount() { return html.trim() ? 1 : 0; },
  get firstElementChild() { return { hasAttribute: (a) => html.includes(a) }; },
};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.document = {
  getElementById: (id) => (id === 'main-content' ? main : null),
  querySelectorAll: (sel) => (sel === '[data-route]' ? enlaces : []),
  dispatchEvent() {},
};
globalThis.window = { location: { hash: '' }, addEventListener() {} };
const ls = new Map();
globalThis.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
let avisos = [];
console.warn = (...a) => avisos.push(a.map(String).join(' '));
console.error = (...a) => avisos.push('ERROR ' + a.map(String).join(' '));

const activos = () => enlaces.filter((e) => e.classList.contains('active')).map((e) => e.dataset.route);
const tic = () => new Promise((r) => setImmediate(r));

let nCaso = 0;
async function routerNuevo() {
  avisos = [];
  html = '';
  const r = await import(pathToFileURL(ROUTER).href + `?caso=${++nCaso}`);
  const ir = async (hash) => { window.location.hash = '#' + hash; return r.handleRoute(); };
  return { ...r, ir };
}

// Una ruta lenta: su handler espera a que el caso la suelte y devuelve lo que se le diga.
function lenta(nombre, cuenta, { devuelve = 'teardown' } = {}) {
  const ctl = { soltar: null };
  ctl.handler = async (el) => {
    el.innerHTML = `<div>${nombre} cargando</div>`;
    await new Promise((res) => { ctl.soltar = res; });
    // La vista tiene su guarda de vigencia (v=195): no escribe nada al volver.
    if (devuelve === 'nada') return undefined;
    if (devuelve === 'tira') return () => { cuenta[nombre] = (cuenta[nombre] || 0) + 1; throw new Error(`teardown de ${nombre} roto`); };
    return () => { cuenta[nombre] = (cuenta[nombre] || 0) + 1; };
  };
  return ctl;
}
const rapida = (nombre, cuenta) => (el) => {
  el.innerHTML = `<div>${nombre}</div>`;
  return () => { cuenta[nombre] = (cuenta[nombre] || 0) + 1; };
};

// ── 1. A lenta → B rápida → (A termina) → C ──────────────────────────────────
{
  console.log('\n1. A lenta → B rápida → A termina → C');
  const R = await routerNuevo();
  const c = {};
  const A = lenta('lenta', c);
  R.registerRoute('lenta', A.handler);
  R.registerRoute('rapida', rapida('rapida', c));
  R.registerRoute('tercera', (el) => { el.innerHTML = '<div>tercera</div>'; });

  const pA = R.ir('lenta');
  await tic();
  await R.ir('rapida');
  A.soltar();
  await pA;
  await tic();
  const tras = { lenta: c.lenta || 0, rapida: c.rapida || 0, activos: activos() };
  await R.ir('tercera');
  await tic();
  ok(tras.lenta === 1, `el teardown de A corre apenas A termina, antes de salir de B (corrió ${tras.lenta})`);
  ok((c.lenta || 0) === 1, `el de A corre exactamente una vez en total (corrió ${c.lenta || 0})`);
  ok(tras.rapida === 0, `el de B no corre mientras sigo en B (corrió ${tras.rapida})`);
  ok((c.rapida || 0) === 1, `el de B corre exactamente una vez, al salir de B (corrió ${c.rapida || 0})`);
  ok(tras.activos.length === 1 && tras.activos[0] === 'rapida', `después de que A termina, el único [data-route].active es B (${JSON.stringify(tras.activos)})`);
}

// ── 2. A lenta → B → A otra vez (A2) → el A viejo termina ────────────────────
// Dos órdenes: el A viejo termina mientras A2 carga (2a) o después de A2 (2b). Cuando te
// vas de B a A2, el router ya corrió el teardown de B: mientras A2 carga, `currentCleanup`
// está vacío (no es el de B), y el A viejo no tiene que llenarlo.
for (const orden of ['2a: el viejo termina mientras A2 carga', '2b: el viejo termina después de A2']) {
  console.log(`\n${orden}`);
  const R = await routerNuevo();
  const c = {};
  const viejo = { soltar: null }, nuevo = { soltar: null };
  let vuelta = 0;
  // La MISMA ruta, dos renders: el primero es el «viejo», el segundo «A2».
  R.registerRoute('lenta', async (el) => {
    const yo = ++vuelta === 1 ? 'viejo' : 'a2';
    el.innerHTML = `<div>lenta ${yo}</div>`;
    await new Promise((res) => { (yo === 'viejo' ? viejo : nuevo).soltar = res; });
    return () => { c[yo] = (c[yo] || 0) + 1; };
  });
  R.registerRoute('rapida', rapida('rapida', c));
  R.registerRoute('tercera', (el) => { el.innerHTML = '<div>tercera</div>'; });

  const pViejo = R.ir('lenta');
  await tic();
  await R.ir('rapida');
  const pA2 = R.ir('lenta');
  await tic();
  const bAlSalir = c.rapida || 0;
  if (orden.startsWith('2a')) {
    viejo.soltar(); await pViejo; await tic();
    nuevo.soltar(); await pA2; await tic();
  } else {
    nuevo.soltar(); await pA2; await tic();
    viejo.soltar(); await pViejo; await tic();
  }
  const antesDeSalir = { viejo: c.viejo || 0, a2: c.a2 || 0, activos: activos() };
  await R.ir('tercera');
  await tic();
  ok(bAlSalir === 1, `el teardown de B corrió una vez al salir de B hacia A2 (corrió ${bAlSalir})`);
  ok((c.rapida || 0) === 1, `y una sola vez en total (corrió ${c.rapida || 0})`);
  ok((c.viejo || 0) === 0, `el teardown del A viejo NO corre nunca (corrió ${c.viejo || 0})`);
  ok(antesDeSalir.a2 === 0, `el de A2 no corre mientras sigo en A2 (corrió ${antesDeSalir.a2})`);
  ok((c.a2 || 0) === 1, `al salir de A2 corre el de A2, exactamente una vez (corrió ${c.a2 || 0})`);
  ok(antesDeSalir.activos.length === 1 && antesDeSalir.activos[0] === 'lenta', `en A2, el único activo es lenta (${JSON.stringify(antesDeSalir.activos)})`);
}

// ── 3. A lenta que termina SIN teardown estando ya en B ──────────────────────
{
  console.log('\n3. A lenta termina sin teardown (undefined) estando en B');
  const R = await routerNuevo();
  const c = {};
  const A = lenta('sinnada', c, { devuelve: 'nada' });
  R.registerRoute('sinnada', A.handler);
  R.registerRoute('rapida', rapida('rapida', c));
  R.registerRoute('tercera', (el) => { el.innerHTML = '<div>tercera</div>'; });
  const pA = R.ir('sinnada');
  await tic();
  await R.ir('rapida');
  A.soltar();
  await pA;
  await tic();
  const tras = c.rapida || 0;
  await R.ir('tercera');
  await tic();
  ok(tras === 0, `B no pierde su teardown ni lo corre antes de tiempo (corrió ${tras})`);
  ok((c.rapida || 0) === 1, `al salir de B corre el de B, una vez (corrió ${c.rapida || 0})`);
}

// ── 4. El teardown de la ruta vieja que TIRA, estando en B ───────────────────
{
  console.log('\n4. A lenta con un teardown que tira, termina estando en B');
  const R = await routerNuevo();
  const c = {};
  const A = lenta('rota', c, { devuelve: 'tira' });
  R.registerRoute('rota', A.handler);
  R.registerRoute('rapida', rapida('rapida', c));
  R.registerRoute('tercera', (el) => { el.innerHTML = '<div>tercera</div>'; });
  const pA = R.ir('rota');
  await tic();
  await R.ir('rapida');
  A.soltar();
  let tiro = null;
  try { await pA; } catch (e) { tiro = e; }
  await tic();
  const warnTras = avisos.filter((a) => a.startsWith('[router] teardown:')).length;
  await R.ir('tercera');
  await tic();
  ok(tiro === null, `handleRoute() de la ruta vieja no tira (${tiro})`);
  ok((c.rota || 0) === 1 && warnTras === 1, `el teardown roto corre al terminar y deja un console.warn('[router] teardown:', …) (corrió ${c.rota || 0}, avisos ${warnTras})`);
  ok((c.rapida || 0) === 1, `B conserva el suyo y corre una vez al salir (corrió ${c.rapida || 0})`);
  ok(html.includes('tercera'), 'y la tercera ruta se pinta igual');
}

// ── 5. Conservación (verde también contra v=323) ─────────────────────────────
{
  console.log('\n5. conservación: una sola ruta, entrar y salir');
  const R = await routerNuevo();
  const c = {};
  R.registerRoute('sola', rapida('sola', c));
  R.registerRoute('siguiente', (el) => { el.innerHTML = '<div>siguiente</div>'; });
  await R.ir('sola');
  await tic();
  const antes = c.sola || 0;
  await R.ir('siguiente');
  await tic();
  ok(antes === 0 && (c.sola || 0) === 1, `su teardown corre una vez, al salir (antes ${antes}, después ${c.sola || 0})`);

  // Una lenta que termina estando vigente: lo de siempre.
  const A = lenta('lenta', c);
  R.registerRoute('lenta', A.handler);
  const pA = R.ir('lenta');
  await tic();
  A.soltar();
  await pA;
  await tic();
  ok((c.lenta || 0) === 0, `una lenta que termina vigente no corre su teardown al terminar (corrió ${c.lenta || 0})`);
  await R.ir('siguiente');
  await tic();
  ok((c.lenta || 0) === 1, `y lo corre al salir, una vez (corrió ${c.lenta || 0})`);
}
{
  console.log('\n5b. conservación: una ruta que tira en el teardown no impide pintar la siguiente');
  const R = await routerNuevo();
  R.registerRoute('rota', (el) => { el.innerHTML = '<div>rota</div>'; return () => { throw new Error('teardown roto'); }; });
  R.registerRoute('siguiente', (el) => { el.innerHTML = '<div>siguiente</div>'; });
  await R.ir('rota');
  await tic();
  let tiro = null;
  try { await R.ir('siguiente'); } catch (e) { tiro = e; }
  await tic();
  ok(tiro === null, `cambiar de ruta no tira (${tiro})`);
  ok(html.includes('siguiente'), 'la siguiente se pinta');
  ok(avisos.some((a) => a.startsWith('[router] teardown:') && a.includes('teardown roto')), `y queda el console.warn('[router] teardown:', …) (${avisos.length} avisos)`);
}

console.log(`\nrouter: ${ROUTER}`);
console.log(`${pasaron} pasaron · ${fallaron} fallaron`);
if (fallaron) process.exit(1);
