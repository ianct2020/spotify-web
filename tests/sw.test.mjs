// tests/sw.test.mjs — el service worker limpia sus cachés viejas y no toca nada
// más (v=257)
//
// Hasta v=256 `sw.js` tenía `const CACHE = 'fonoteca-sw-v1'` fijo. Su `activate`
// borra «las cachés que no sean CACHE», y como CACHE nunca cambió esa limpieza no
// corrió jamás: cada despliegue dejó su copia de cada módulo en la Cache API del
// navegador, y «Limpiar caché» no la toca.
//
// Qué protege este archivo, en orden de importancia:
//   1. `build.sh` estampa el `?v=` de index.html en el nombre de la caché de
//      `docs/sw.js`, y FALLA si no puede (un sw.js que saliera con el marcador de
//      `src/` no bumpearía nunca: el bug entero, en silencio).
//   2. El `activate` borra las cachés `fonoteca-sw-*` de otros despliegues y
//      deja la actual. La Cache API es por ORIGEN, no por ruta, y este origen
//      (ianct2020.github.io) es compartido con otros proyectos de Pages: una
//      caché que no lleve el prefijo NO es nuestra y no se borra.
//   3. `sw.js` nunca nombra la IndexedDB (base de discografías,
//      `mosaico_colores_v1`, me gusta): un `activate` que la tocara la vaciaría
//      en cada despliegue.
//
// Se carga el `sw.js` REAL (no una copia) dentro de un `vm` con una Cache API de
// mentira, y el build se corre de verdad sobre una copia de `src/` en un
// directorio temporal, para no tocar `docs/`.

import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

// ── Un navegador de mentira, lo mínimo que usa sw.js ─────────────────────────
function montarSW(codigoSW, cachesIniciales, red = async () => { throw new Error('sin red'); }) {
  const almacen = new Map(cachesIniciales.map(n => [n, new Map([['/x', 'cuerpo']])]));
  const registro = { borradas: [], abiertas: [], claimed: 0, skipWaiting: 0, idb: 0 };
  const handlers = {};
  const caches = {
    keys: async () => [...almacen.keys()],
    delete: async (k) => { registro.borradas.push(k); return almacen.delete(k); },
    open: async (k) => { registro.abiertas.push(k); if (!almacen.has(k)) almacen.set(k, new Map()); return almacen.get(k); },
    match: async () => undefined,
  };
  const self = {
    addEventListener: (tipo, fn) => { handlers[tipo] = fn; },
    skipWaiting: () => { registro.skipWaiting++; },
    clients: { claim: async () => { registro.claimed++; } },
  };
  // Cualquier acceso a la IndexedDB queda anotado (y tira): sw.js no debe nombrarla.
  const indexedDB = new Proxy({}, { get: () => { registro.idb++; throw new Error('sw.js tocó indexedDB'); } });
  const ctx = vm.createContext({
    self, caches, indexedDB, location: { origin: 'https://ianct2020.github.io' },
    URL, Response: class {}, fetch: red,
  });
  vm.runInContext(codigoSW, ctx);
  return { handlers, almacen, registro, ctx };
}

// Dispara `activate` y espera al waitUntil, como haría el navegador.
async function activar(sw) {
  let promesa;
  sw.handlers.activate({ waitUntil: (p) => { promesa = p; } });
  await promesa;
}

// ── 1. El build estampa la versión en docs/sw.js ─────────────────────────────
console.log('\nEl build estampa la versión');
const swFuente = readFileSync(join(RAIZ, 'src/sw.js'), 'utf8');
ok(/^const CACHE = 'fonoteca-sw-dev';$/m.test(swFuente),
  'src/sw.js lleva el marcador \'fonoteca-sw-dev\' (no una versión escrita a mano)');
ok(/^const PREFIJO = 'fonoteca-sw-';$/m.test(swFuente),
  'src/sw.js declara el prefijo que delimita qué cachés son suyas');

const tmp = mkdtempSync(join(tmpdir(), 'sw-test-'));
try {
  // (a) el build sobre el src REAL
  const real = join(tmp, 'real');
  mkdirSync(real);
  cpSync(join(RAIZ, 'src'), join(real, 'src'), { recursive: true });
  cpSync(join(RAIZ, 'build.sh'), join(real, 'build.sh'));
  mkdirSync(join(real, 'docs'));
  const b = spawnSync('bash', ['build.sh'], { cwd: real, encoding: 'utf8' });
  ok(b.status === 0, 'build.sh sale con 0 sobre el src real');
  const V = readFileSync(join(real, 'src/index.html'), 'utf8').match(/app\.js\?v=(\d+)/)?.[1];
  ok(!!V, `index.html trae el app.js?v= (v=${V})`);
  const swDocs = readFileSync(join(real, 'docs/sw.js'), 'utf8');
  ok(swDocs.includes(`const CACHE = 'fonoteca-sw-v${V}';`),
    'docs/sw.js quedó con el nombre de caché atado al ?v= de index.html');
  ok(!swDocs.includes('fonoteca-sw-dev'), 'docs/sw.js ya no tiene el marcador');
  ok(swDocs.replace(/^const CACHE = 'fonoteca-sw-v\d+';$/m, "const CACHE = 'fonoteca-sw-dev';") === swFuente,
    'lo ÚNICO que el build cambia de sw.js es esa línea (el resto es byte a byte el de src/)');
  ok(swFuente.includes("'fonoteca-sw-dev'"), 'y src/sw.js no se tocó: el build escribe solo en docs/');

  // (b) el build FALLA si no puede estampar
  const mini = (nombre, mutar) => {
    const d = join(tmp, nombre);
    mkdirSync(join(d, 'src/js'), { recursive: true });
    mkdirSync(join(d, 'docs'));
    cpSync(join(RAIZ, 'build.sh'), join(d, 'build.sh'));
    writeFileSync(join(d, 'src/index.html'), '<script type="module" src="js/app.js?v=7"></script>\n');
    writeFileSync(join(d, 'src/js/app.js'), 'export {};\n');
    writeFileSync(join(d, 'src/sw.js'), swFuente);
    mutar(d);
    return spawnSync('bash', ['build.sh'], { cwd: d, encoding: 'utf8' });
  };
  const okMini = mini('mini-ok', () => {});
  ok(okMini.status === 0 && readFileSync(join(tmp, 'mini-ok/docs/sw.js'), 'utf8').includes("'fonoteca-sw-v7'"),
    'fixture mínimo: con versión 7 sale fonoteca-sw-v7');
  const sinLinea = mini('sin-linea', d => writeFileSync(join(d, 'src/sw.js'), swFuente.replace(/^const CACHE = .*$/m, 'const OTRA = 1;')));
  ok(sinLinea.status !== 0 && /no encontré/.test(sinLinea.stderr),
    'si sw.js no trae la línea de CACHE, el build FALLA (no publica un sw sin bumpear)');
  const sinVersion = mini('sin-version', d => writeFileSync(join(d, 'src/index.html'), '<script type="module" src="js/app.js"></script>\n'));
  ok(sinVersion.status !== 0 && /sin versión/.test(sinVersion.stderr),
    'si index.html no trae app.js?v=, el build FALLA en vez de avisar y seguir');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── 2. El activate ────────────────────────────────────────────────────────────
console.log('\nEl activate limpia las cachés viejas de Fonoteca y solo esas');
const swV257 = swFuente.replace("'fonoteca-sw-dev'", "'fonoteca-sw-v257'");
{
  // El caso real de la primera vez: el navegador trae la caché histórica v1.
  const sw = montarSW(swV257, ['fonoteca-sw-v1']);
  await activar(sw);
  ok(sw.registro.borradas.includes('fonoteca-sw-v1'), 'la caché histórica fonoteca-sw-v1 se borra en la primera activación');
  ok(sw.registro.claimed === 1, 'y se reclama a los clientes (clients.claim) después');
}
{
  // Varios despliegues acumulados + la actual + cachés ajenas del mismo origen.
  const viejas = ['fonoteca-sw-v1', 'fonoteca-sw-v250', 'fonoteca-sw-v255', 'fonoteca-sw-v256'];
  const ajenas = ['otro-proyecto-v1', 'workbox-precache-v2-https://ianct2020.github.io/otra-app/', 'fonoteca', 'sw-fonoteca-sw-v9'];
  const sw = montarSW(swV257, [...viejas, 'fonoteca-sw-v257', ...ajenas]);
  await activar(sw);
  const quedan = [...sw.almacen.keys()];
  ok(viejas.every(k => !quedan.includes(k)), 'todas las de despliegues anteriores se van');
  ok(quedan.includes('fonoteca-sw-v257'), 'la actual NO se borra');
  ok(ajenas.every(k => quedan.includes(k)), 'las cachés de otros proyectos del mismo origen NO se tocan (ni las que solo se le parecen)');
  ok(quedan.length === 1 + ajenas.length, 'no queda nada más');
  ok(sw.almacen.get('fonoteca-sw-v257').size === 1, 'y el contenido de la actual sigue intacto');
}
{
  // El caso del PRÓXIMO despliegue: v257 → v258.
  const sw = montarSW(swFuente.replace("'fonoteca-sw-dev'", "'fonoteca-sw-v258'"), ['fonoteca-sw-v257']);
  await activar(sw);
  ok(!sw.almacen.has('fonoteca-sw-v257') && sw.registro.borradas.length === 1, 'v257 → v258: la del despliegue anterior se limpia sola');
}
{
  const sw = montarSW(swV257, []);
  await activar(sw);
  ok(sw.registro.borradas.length === 0 && sw.registro.claimed === 1, 'sin cachés previas no borra nada y reclama igual');
}

// ── 3. La IndexedDB y el resto ───────────────────────────────────────────────
console.log('\nNo toca la IndexedDB ni cambia lo demás');
{
  const sw = montarSW(swV257, ['fonoteca-sw-v1', 'fonoteca-sw-v257']);
  await activar(sw);
  ok(sw.registro.idb === 0, 'durante el activate no se accede a indexedDB');
}
ok(!/indexedDB|\bidb\b|deleteDatabase/i.test(swFuente.replace(/\/\/.*$/gm, '')),
  'sw.js no nombra indexedDB/deleteDatabase en su CÓDIGO (los comentarios sí pueden explicarlo)');
ok(/self\.skipWaiting\(\)/.test(swFuente), 'install sigue llamando a skipWaiting (el SW nuevo toma el control sin esperar)');
{
  const sw = montarSW(swV257, []);
  ok(typeof sw.handlers.install === 'function' && typeof sw.handlers.activate === 'function' && typeof sw.handlers.fetch === 'function',
    'los tres handlers (install, activate, fetch) siguen registrados');
  sw.handlers.install();
  ok(sw.registro.skipWaiting === 1, 'install llama a skipWaiting una vez');
  // Lo cross-origin y lo que no es GET no se intercepta.
  let respondio = 0;
  const ev = (url, method = 'GET', mode = 'cors') => ({ request: { url, method, mode }, respondWith: () => { respondio++; } });
  sw.handlers.fetch(ev('https://api.spotify.com/v1/me'));
  sw.handlers.fetch(ev('https://ianct2020.github.io/spotify-web/js/app.js?v=257', 'POST'));
  ok(respondio === 0, 'la API de Spotify (cross-origin) y los que no son GET no se interceptan');
  sw.handlers.fetch(ev('https://ianct2020.github.io/spotify-web/js/app.js?v=257'));
  ok(respondio === 1, 'un estático same-origin sí lo atiende el SW');
}

// ── 4. Las navegaciones con query no se guardan (v=258) ───────────────────────
console.log('\nUna navegación con query no se guarda en la Cache API');
{
  const respuesta = { ok: true, clone() { return { copia: true }; } };
  const sw = montarSW(swV257, [], async () => respuesta);
  const puts = [];
  sw.ctx.caches.open = async () => ({ put: (req) => { puts.push(req.url); } });
  const navegar = async (url) => {
    let p;
    sw.handlers.fetch({ request: { url, method: 'GET', mode: 'navigate' }, respondWith: (x) => { p = x; } });
    return await p;
  };
  const cb = 'https://ianct2020.github.io/spotify-web/callback.html?code=AQB-secreto&state=xyz';
  const r1 = await navegar(cb);
  ok(r1 === respuesta, 'la navegación a callback.html?code=… se contesta igual, desde la red');
  ok(!puts.includes(cb), 'pero NO se guarda: el código PKCE no queda en la Cache API');
  await navegar('https://ianct2020.github.io/spotify-web/index.html?frio=3');
  ok(puts.length === 0, 'tampoco el ?frio=N del ritual');
  await navegar('https://ianct2020.github.io/spotify-web/');
  ok(puts.length === 1 && puts[0] === 'https://ianct2020.github.io/spotify-web/',
    'sin query sí se guarda (el modo offline sigue teniendo su copia)');
}

console.log(`\n  ${pasaron} asserts OK, ${fallaron} fallos`);
process.exit(fallaron ? 1 : 0);
