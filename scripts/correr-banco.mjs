// Corre `tests/banco/barra.html` sin extensión: monta el dev-server en un
// puerto libre, abre Chrome headless sobre el banco, lee la marca
// `data-banco="ok"` que el propio banco imprime cuando pasa, y sale con 0 o 1.
//
// POR QUÉ EXISTE: el banco estuvo ROTO desde v=241 y nadie lo corrió en veinte
// versiones (se descubrió en v=262). Hoy es la única prueba que dice si la
// barra de #new-releases entra en una fila a 1366 — y sin correrlo depende de
// que alguien se acuerde de mirarlo a mano.
//
// SI CHROME NO ESTÁ: sale con 1 y con un mensaje claro; la regla es «un banco
// que pasa cuando no corrió es peor que ninguno». No hay silencio.
//
//   npm run banco

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BANCO = process.argv[2] || 'barra';
const ANCHO = process.env.ANCHO || '1351';

async function elegirPuerto() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

async function encontrarChrome() {
  const CANDIDATOS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const c of CANDIDATOS) {
    const r = await new Promise(res => {
      const p = spawn('which', [c], { stdio: 'ignore' });
      p.on('exit', code => res(code === 0 ? c : null));
      p.on('error', () => res(null));
    });
    if (r) return r;
  }
  return null;
}

const chrome = await encontrarChrome();
if (!chrome) {
  console.error('✗ banco: no encontré Chrome en el PATH (google-chrome / chromium).');
  console.error('  El banco `' + BANCO + '.html` NO se ejecutó. Instalá Chrome o Chromium,');
  console.error('  o corré `bash tests/banco/correr.sh ' + BANCO + ' /tmp/salida` a mano.');
  process.exit(1);
}

const puerto = await elegirPuerto();
const server = spawn(process.execPath, ['scripts/dev-server.mjs'], {
  env: { ...process.env, PORT: String(puerto), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const cerrarServer = () => { try { server.kill('SIGTERM'); } catch { /* ignora */ } };
process.on('exit', cerrarServer);

// Que el server tenga tiempo de ligar el puerto (dev-server.mjs es sincrónico
// al listen). 250 ms es sobrado en Node moderno.
await new Promise(r => setTimeout(r, 250));

const URL = `http://127.0.0.1:${puerto}/banco/${BANCO}.html?ancho=${ANCHO}`;
const perfil = mkdtempSync(join(tmpdir(), 'banco-chrome-'));

try {
  const dom = await new Promise((res, rej) => {
    const p = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${perfil}`,
      '--virtual-time-budget=20000',
      '--dump-dom',
      URL,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', c => { out += c.toString('utf8'); });
    p.on('exit', () => res(out));
    p.on('error', rej);
  });

  const m = dom.match(/data-banco="([a-z]+)"/);
  const estado = m ? m[1] : null;
  const mens = (dom.match(/<pre[^>]*>([^<]*)<\/pre>/) || [])[1] || '';

  if (estado === 'ok') {
    console.log(`✓ banco/${BANCO}.html (ancho=${ANCHO}): ${mens || 'ok'}`);
    process.exit(0);
  }
  console.error(`✗ banco/${BANCO}.html (ancho=${ANCHO}): estado="${estado || 'ausente'}"`);
  if (mens) console.error('  ' + mens);
  console.error('  URL: ' + URL);
  process.exit(1);
} finally {
  cerrarServer();
  try { rmSync(perfil, { recursive: true, force: true }); } catch { /* ignora */ }
}
