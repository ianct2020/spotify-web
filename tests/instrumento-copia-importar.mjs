// El instrumento del tiempo del banco `copia-importar` (tanda 87). NO es una suite (`npm test` corre `*.test.mjs`) ni
// está en `prepush`: es el mismo `scripts/correr-banco.mjs` con un presupuesto de reloj virtual propio.
//
// Por qué existe: con los datos del tamaño de los de Ian (INVENTADOS, `?tamano=ian`) el trabajo sincrónico del banco
// —sembrar, exportar, serializar, sacar los sha256— corre con el reloj de pared, y en Chrome headless ese tiempo
// también se descuenta del `--virtual-time-budget` (medido en la 87: un bucle sincrónico de 63 s de pared adelantó
// `performance.now()` 63 s). En la 87, `XQ="&tamano=ian&solo=ab"` con los 45 s por defecto de `correr-banco.mjs`
// cortaba en el caso A, antes de importar nada. `PRESUPUESTO` de aquel archivo no se toca (es el de `prepush`), así
// que el instrumento tiene su propio corredor.
//
//   XQ="&tamano=ian&solo=l" node tests/instrumento-copia-importar.mjs
//   XQ="&tamano=ian&solo=ab" PRESUPUESTO_MS=900000 node tests/instrumento-copia-importar.mjs
//   XQ="&tamano=ian&solo=l" PARED_MS=240000 node tests/instrumento-copia-importar.mjs
//
// ⚠️ Con reloj virtual, cada vuelta de `esperarReal` (`simulado.mjs`) suma sus 8 ms de `setTimeout` adelantados, así que
// los tramos `leerYDecidir`/`aplicar` del banco mezclan el trabajo sincrónico (pared) con esperas que no pasaron. Con
// `PARED_MS`, Chrome corre SIN reloj virtual y este corredor le pregunta una vez por segundo, por el protocolo de DevTools
// (`--remote-debugging-pipe`: los descriptores 3 y 4, sin dependencias), si el banco ya puso `data-banco`; los dos tramos
// son entonces reloj de pared de punta a punta. (`--timeout` no sirve: con `--dump-dom` Chrome vuelca al cargar.) Si el
// banco no terminó en `PARED_MS`, sale `estado="ausente"`: subilo.
//
// Imprime el `data-resumen` del banco entero (ahí van los tiempos de cada tramo) y lo que tardó Chrome de pared.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRESUPUESTO_MS = +(process.env.PRESUPUESTO_MS || 600000);
const PARED_MS = +(process.env.PARED_MS || 0);
const ANCHO = process.env.ANCHO || '1351';

const puerto = await new Promise((res, rej) => {
  const s = createServer();
  s.unref();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const server = spawn(process.execPath, ['scripts/dev-server.mjs'], {
  env: { ...process.env, PORT: String(puerto), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const cerrarServer = () => { try { server.kill('SIGTERM'); } catch { /* ignora */ } };
process.on('exit', cerrarServer);
await new Promise((r) => setTimeout(r, 250));

const URL = `http://127.0.0.1:${puerto}/banco/copia-importar.html?ancho=${ANCHO}${process.env.XQ || ''}`;
const perfil = mkdtempSync(join(tmpdir(), 'banco-chrome-'));
let codigo = 1;
try {
  const t0 = Date.now();
  const dom = PARED_MS ? await conPared() : await new Promise((res, rej) => {
    const p = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${perfil}`,
      `--virtual-time-budget=${PRESUPUESTO_MS}`, '--dump-dom', URL], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (c) => { out += c.toString('utf8'); });
    p.on('exit', () => res(out));
    p.on('error', rej);
  });
  const pared = Date.now() - t0;
  const estado = (dom.match(/<html[^>]*\sdata-banco="([a-z]+)"/) || [])[1] || 'ausente';
  const mens = (dom.match(/<pre[^>]*>([^<]*)<\/pre>/) || [])[1] || '';
  console.log(`${estado === 'ok' ? '✓' : '✗'} instrumento copia-importar (${PARED_MS ? `SIN reloj virtual, corte a los ${PARED_MS} ms de pared` : `presupuesto ${PRESUPUESTO_MS} ms virtuales`}, Chrome ${pared} ms de pared): estado="${estado}"`);
  console.log('  ' + mens.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  console.log('  URL: ' + URL);
  codigo = estado === 'ok' ? 0 : 1;
} finally {
  cerrarServer();
  try { rmSync(perfil, { recursive: true, force: true }); } catch { /* ignora */ }
}
process.exit(codigo);

// Sin reloj virtual: Chrome abre el banco y se le pregunta por DevTools hasta que termina (o hasta `PARED_MS`). Devuelve
// un `<html …>` con los mismos atributos y el mismo `<pre>` que leería `--dump-dom`: el PRIMERO del documento (`fallar()`
// de `esperar.mjs` pone el suyo al principio, antes de `#progreso`).
async function conPared() {
  const p = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${perfil}`,
    '--remote-debugging-pipe', URL], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const enviar = p.stdio[3], recibir = p.stdio[4];
  let id = 0, resto = '';
  const pendientes = new Map();
  recibir.on('data', (c) => {
    resto += c.toString('utf8');
    let i;
    while ((i = resto.indexOf('\0')) >= 0) {
      const m = JSON.parse(resto.slice(0, i));
      resto = resto.slice(i + 1);
      if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); }
    }
  });
  const cdp = (method, params = {}, sessionId) => new Promise((res) => {
    const n = ++id;
    pendientes.set(n, res);
    enviar.write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  let pagina = null;
  for (let i = 0; i < 50 && !pagina; i++) {
    const t = await cdp('Target.getTargets');
    pagina = t.result?.targetInfos?.find((x) => x.type === 'page' && x.url.includes('/banco/copia-importar.html'));
    if (!pagina) await dormir(200);
  }
  const { result: { sessionId } } = await cdp('Target.attachToTarget', { targetId: pagina.targetId, flatten: true });
  const leer = async () => (await cdp('Runtime.evaluate', { returnByValue: true, expression:
    `(() => { const h = document.documentElement; const e = (s) => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return '<html' + (h.dataset.banco ? ' data-banco="' + h.dataset.banco + '"' : '') + (h.dataset.resumen ? ' data-resumen="' + e(h.dataset.resumen) + '"' : '') + '><pre>' + e(document.querySelector('pre')?.textContent) + '</pre>'; })()` }, sessionId)).result?.result?.value || '';
  const t0 = Date.now();
  let dom = '';
  while (Date.now() - t0 < PARED_MS) {
    dom = await leer();
    if (/data-banco="/.test(dom)) break;
    await dormir(1000);
  }
  await cdp('Browser.close');
  await new Promise((r) => { p.on('exit', r); setTimeout(r, 5000); });
  return dom;
}
