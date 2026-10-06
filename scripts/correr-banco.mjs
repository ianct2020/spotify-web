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

// Lo que hay que agregarle a la URL de ALGUNOS bancos para que se
// autocomprueben. `mosaico.html` tiene dos modos: sin parametros es un
// INSTRUMENTO que espera a un conductor externo que le inyecte la base de
// colores (y por eso se quedaba en `data-banco="esperando"` y figuraba en rojo
// desde antes del 04/10), y con `auto=1` se fabrica una base sintetica y se
// conduce solo. El resto de los bancos se autocomprueban sin pedir nada.
const EXTRA = { mosaico: 'auto=1' };
// `XQ="&peor=1"` agrega parámetros a la URL del banco sin tocar este archivo: sirve
// para medir (p. ej. el ancho mínimo en que la barra de novedades sigue en una fila).

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

const URL = `http://127.0.0.1:${puerto}/banco/${BANCO}.html?ancho=${ANCHO}${process.env.XQ || ''}`
  + (EXTRA[BANCO] ? '&' + EXTRA[BANCO] : '');
const perfil = mkdtempSync(join(tmpdir(), 'banco-chrome-'));

try {
  const dom = await new Promise((res, rej) => {
    const p = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${perfil}`,
      // 45 s de reloj VIRTUAL, no de pared: es un tope, no una espera. Subio de
      // 20 s en v=273 porque el banco del mosaico hace trabajo de verdad
      // (empareja, baja 96 tapas y pinta) y a 20 s quedaba al borde: cuando
      // fallaba, el dump salia a medio camino y el rojo llegaba sin mensaje.
      '--virtual-time-budget=45000',
      '--dump-dom',
      URL,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', c => { out += c.toString('utf8'); });
    p.on('exit', () => res(out));
    p.on('error', rej);
  });

  // ⚠️ El atributo, y SOLO el del `<html>`. Con `/data-banco="([a-z]+)"/` a
  // secas, cuando el banco se colgaba y el atributo no estaba puesto, el match
  // se iba al TEXTO DE UN COMENTARIO del propio banco («La marca
  // `data-banco="listo"` aparece cuando…»): el banco colgado se reportaba como
  // `estado="listo"`, sin mensaje y sin pista de que no habia corrido. Medido el
  // 04/10 en `mosaico.html`, que documenta sus marcas en el encabezado.
  const m = dom.match(/<html[^>]*\sdata-banco="([a-z]+)"/);
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
