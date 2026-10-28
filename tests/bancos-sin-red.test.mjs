// La regla del corredor se prueba contra un servidor local y un Chrome descartable.
// El nombre de control termina en .localhost: no necesita salir a Internet.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fuente = readFileSync('scripts/correr-banco.mjs', 'utf8');
const argumentos = fuente.match(/spawn\(chrome, \[([\s\S]*?)\], \{/m)?.[1] || '';
const regla = argumentos.match(/'(--host-resolver-rules=[^']+)'/)?.[1];
const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .find(nombre => spawnSync('which', [nombre], { stdio: 'ignore' }).status === 0);
assert.ok(chrome, 'el test necesita el mismo Chrome o Chromium que los bancos');
const server = createServer((_req, res) => res.end('BANCO_LOCAL_INVENTADO'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const puerto = server.address().port;

async function abrir(host, resolver) {
  const perfil = mkdtempSync(join(tmpdir(), 'banco-sin-red-'));
  try {
    const salida = await new Promise((resolve, reject) => {
      const p = spawn(chrome, [
        '--headless=new', '--disable-gpu', '--no-sandbox',
        `--user-data-dir=${perfil}`,
        ...(resolver ? [resolver] : []),
        '--dump-dom', `http://${host}:${puerto}/`,
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      let dom = '';
      p.stdout.on('data', c => { dom += c.toString('utf8'); });
      p.on('close', codigo => resolve({ codigo, llega: dom.includes('BANCO_LOCAL_INVENTADO') }));
      p.on('error', reject);
    });
    return salida;
  } finally {
    rmSync(perfil, { recursive: true, force: true });
  }
}

try {
  const sinRegla = await abrir('banco-sin-red.localhost');
  assert.equal(sinRegla.llega, true, 'el nombre de control tiene que llegar sin regla');
  assert.equal(regla, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    'Chrome debe cortar los nombres externos y dejar los dos nombres locales');
  const conRegla = await abrir('banco-sin-red.localhost', regla);
  assert.equal(conRegla.llega, false, 'el nombre de control no debe llegar con la regla');
  assert.equal((await abrir('localhost', regla)).llega, true, 'localhost debe seguir llegando');
  assert.equal((await abrir('127.0.0.1', regla)).llega, true, '127.0.0.1 debe seguir llegando');
  console.log('6 asserts OK — el nombre local de control queda cortado; los dos nombres del banco llegan');
} finally {
  server.close();
}
