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

// Tope de reloj VIRTUAL por banco, en ms. El defecto son 45 s (ver abajo).
//
// ⚠️ No es tiempo de pared ni una espera: es cuánto reloj simulado puede
// consumir el banco antes de que Chrome lo corte a mitad de camino.
//
// Los dos de `ocultar-artista` necesitan más que el resto porque abren vistas
// reales, y la que se lo lleva es `#discover-artists`: entre pedirle que pinte y
// tener sus bloques en el DOM se van ~70 s de reloj virtual (medido el 06/10 con
// hitos de `performance.now()`). No son temporizadores de la app —se buscaron y
// no hay ninguno en ese camino, y apagar las animaciones de `ui/reveal.js` no
// movió el número—: es que el reloj virtual ADELANTA en cada vuelta en que la
// página queda ociosa, y una espera de las de `esperarReal` tiene muchas.
//
// ⚠️ Por eso están PARTIDOS en dos. Con las tres vistas en un solo banco, ni
// subiendo el tope se estabilizaba: a 300 s pasaba 7 de cada 8 veces. Un banco
// que pasa a veces es peor que ninguno, y este repo ya lo pagó dos veces (la
// barra entre v=241 y v=261, el mosaico hasta v=273). Partido, cada mitad tiene
// margen de sobra y el tope vuelve a ser un tope y no una apuesta.
//
// Los números están medidos a TASA DE ACIERTO, que es la única que vale acá.
// Medidos a tasa de acierto el 06/10, en corridas de 6 u 8:
//   · los tres juntos, 300 s → 7/8   ← por esto están partidos
//   · `ocultar-artista` (follow + similar), 90 s → 8/8
//   · `ocultar-artista-disco`, 180 s → 7/8 · 300 s → 6/6 · 450 s → 6/6
// El de disco queda en 450 s, un escalón por encima del primero que acertó
// siempre. No es tiempo de pared: las dos corridas juntas tardan ~15 s.
// `ocultar-artista-novedades` (v=278) abre #new-releases —barata— y TAMBIÉN
// #discover-artists, para probar que comparten el almacén en las dos direcciones:
// hereda su presupuesto. Medido a tasa de acierto, igual que los otros (ver abajo).
// `calendario` (v=289) llegó SIN presupuesto y con el defecto de 45 s pasaba 7 de 10; medido a
// tasa de acierto el 10/10 (tanda 39): 120 s → 11/12 · 300 s → 12/12 · 450 s → 16/16.
// ⚠️ Eso NO era un arreglo, y la causa se encontró el 11/10 (tanda 40): el banco hacía
// `await mod.render(main)` sin anclar, y `render()` espera a IndexedDB, que no detiene el reloj
// virtual. UNA lectura de IndexedDB sin anclar costó entre 221 y 54.940 ms virtuales. Con el
// `anclar()` puesto (ver el comentario en `tests/banco/calendario.html`), diez corridas seguidas
// gastaron 751-1.073 ms de reloj virtual. El tope es el doble de la más lenta, redondeado
// hacia arriba a múltiplo de 15 s: 15 s. Con 15 s y SIN el `anclar`, el banco falla 3+ de 10.
// ⚠️ Si otro banco «necesita» un tope enorme, buscá primero un `await` de IndexedDB sin anclar.
//
// 🟩 Y eso era, también en los dos de `ocultar-artista-*` (tanda 42, 11/10). Tenían cinco
// `await vista.render(main)` pelados (uno en `-disco`, tres en `-novedades`, y `-novedades`
// abre además #discover-artists). Medido en diez corridas seguidas por banco, reloj virtual:
//   · `ocultar-artista-disco`:     antes 60.911-223.913 ms (10/10 con 450 s) · anclado 907-1.552 ms
//     (10/10 con 450 s) · con el tope nuevo 908-1.564 ms (10/10) · tope nuevo y SIN anclar: 0/10
//   · `ocultar-artista-novedades`: antes 162.890-518.886 ms (10/10 con 900 s) · anclado 1.229-1.720 ms
//     (10/10 con 900 s) · con el tope nuevo 1.372-1.733 ms (10/10) · tope nuevo y SIN anclar: 0/10
// El doble de la corrida más lenta, redondeado a 15 s, da 15 s en los dos: menos que el defecto
// (45 s), así que los dos SALIERON de `PRESUPUESTO` y corren con el defecto.
// ⚠️ O sea que los «~70 s entre pedirle que pinte y tener los bloques» de #discover-artists de
// arriba (06/10) NO eran las vueltas ociosas de `esperarReal`: eran sus lecturas de IndexedDB
// sin anclar. La explicación del 06/10 queda escrita porque es la que se creyó cinco días.
// ⚠️ El `render()` de #follow-artists es SINCRÓNICO (devuelve el `teardown`): no hay promesa que
// anclar, y `anclar()` sobre él tira «promesa.then is not a function». Lo ancla el `esperarReal`
// que viene después. `ocultar-artista` (90 s) no se midió en la tanda 42: no se tocó.
// `import-guarda` (v=298) abre la app ENTERA tres veces, una por iframe, y el caso de `/me`
// caído se come ~25 s de reloj virtual a propósito: `spotifyFetch` duerme 5 × 5 s antes de
// rendirse con el 429 (es lo que pasa de verdad). Medido a tasa de acierto el 13/10 (tanda 46):
// con 90 s, diez corridas seguidas gastaron 26.401-27.864 ms de reloj virtual (10/10). El doble
// de la más lenta, redondeado hacia arriba a múltiplo de 15 s: 60 s.
// `ocultos-cache` (v=299) abre la app ENTERA seis veces, una por iframe, y espera en cada una a
// que los dos almacenes de ocultos terminen su `sync()`. Medido a tasa de acierto el 13/10
// (tanda 47), con el defecto de 45 s: diez corridas seguidas gastaron 23.933-24.219 ms de reloj
// virtual (10/10). El doble de la más lenta, redondeado hacia arriba a múltiplo de 15 s: 60 s. Con
// los 60 s puestos, otras diez: 23.887-24.320 ms (10/10).
// `mapa` (v=304) abre la app ENTERA en tres iframes (uno se recarga a mitad) y escanea doce
// artistas contra un MusicBrainz simulado con el ritmo de verdad: 1,2 s entre peticiones y 10 s
// tras cada 503 (seis, por el patrón fijo), más 30 s de reloj mirando que no salga nada después
// de dejar la ruta. Medido a tasa de acierto el 14/10 (tanda 52), con 900 s: diez corridas
// seguidas gastaron 116.955-117.088 ms de reloj virtual (10/10). El doble de la más lenta,
// redondeado hacia arriba a múltiplo de 15 s: 240 s.
// `puertas` (v=308) abre la app ENTERA en seis iframes y no lee nada sin anclar. Medido a tasa de
// acierto el 15/10 (tanda 56), con el defecto de 45 s: diez corridas seguidas gastaron 5.222-5.848 ms
// de reloj virtual (10/10). El doble de la más lenta da 11,7 s, por debajo del defecto: no entra en
// `PRESUPUESTO` y corre con los 45 s.
// `letras` (v=311) abre la app ENTERA en tres iframes (uno a 1.351, dos para medir el modal) contra un lrclib
// simulado; el 503 espera 1 s de verdad (el `retry-after`). Medido a tasa de acierto el 16/10 (tanda 59), con el
// defecto de 45 s: diez corridas seguidas gastaron 5.000-5.290 ms de reloj virtual (10/10). El doble de la más
// lenta da 10,6 s: no entra en `PRESUPUESTO` y corre con los 45 s.
// `generos-escaneo` (v=313) abre la app ENTERA en seis iframes (uno se recarga a mitad) y busca diez artistas contra un
// Last.fm simulado a 1 s entre peticiones, con 29 y 503 que esperan 10 s cada uno, más los 30 s de reloj de la puerta E.
// Medido a tasa de acierto el 17/10 (tanda 61), con 210 s de tope: diez corridas seguidas gastaron 96.482-97.341 ms de
// reloj virtual (10/10). El doble de la más lenta, redondeado hacia arriba a múltiplo de 15 s: 195 s.
// `mapa-artistas` (v=315) abre la app ENTERA en seis iframes con un grafo inventado de 2.302 artistas y ~60.000 pares, y
// espera 5 s de reloj quieto (puerta D) y 1 s tras salir (puerta G). Medido a tasa de acierto el 18/10 (tanda 64), con el
// defecto de 45 s: veinte corridas seguidas gastaron 12.379-15.734 ms de reloj virtual (20/20). El doble de la más lenta da
// 31,5 s: no entra en `PRESUPUESTO` y corre con los 45 s. ⚠️ La primera versión de la puerta G fallaba 3 de 20: miraba los
// frames desde ANTES de cambiar de ruta, y el navegador a veces pinta el frame pendiente entre el clic y el `hashchange` (con
// la ruta todavía abierta, que está bien). Ahora cuenta desde el `routeteardown`.
// `versiones-deluxe` (v=323) abre la app ENTERA en tres iframes (uno a 1.351 y dos para medir a 1366×591 y 390×844)
// y baja 54 me gusta inventados de una Spotify simulada en cada uno. Medido a tasa de acierto el 20/10 (tanda 70), con
// el defecto de 45 s: diez corridas seguidas gastaron 13.184-13.448 ms de reloj virtual (10/10). El doble de la más
// lenta da 26,9 s: no entra en `PRESUPUESTO` y corre con los 45 s.
// `guard-ruta-vieja` (v=325) abre la app ENTERA en tres iframes, y en dos de ellos `/me` contesta 500 con sus 5
// reintentos de `spotifyFetch` (0,5 + 1 + 2 + 4 + 8 s de backoff, a propósito). Medido a tasa de acierto el 21/10
// (tanda 72): diez corridas seguidas gastaron 38.521-39.194 ms de reloj virtual (10/10). El doble de la más lenta,
// redondeado hacia arriba a múltiplo de 15 s: 90 s. v=329 (tanda 75) le suma dos iframes de `#byartist` con 60.000 me
// gusta sembrados en IndexedDB: diez corridas, 43.382-44.275 ms (10/10); el doble de la más lenta, 88,6 s: siguen los 90.
// `postal` (v=326) abre la app ENTERA en tres iframes y genera diez postales (1080×1350, PNG). La primera versión
// no llegaba nunca al final, ni con 600 s de tope: decodificar el PNG en la madre (`createImageBitmap`) no es red,
// y sin anclar el reloj virtual saltaba al próximo temporizador de la app (el toast de 30 s) en cada lectura: una
// sola puerta gastaba 478 s. Con `anclar()`, medido a tasa de acierto el 21/10 (tanda 73), con el defecto de 45 s:
// diez corridas seguidas gastaron 11.464-13.834 ms de reloj virtual (10/10). El doble de la más lenta da 27,7 s: no
// entra en `PRESUPUESTO` y corre con los 45 s. v=331 (tanda 76) le suma la puerta K, una tapa que no contesta y espera su
// tope de 8 s: diez corridas seguidas gastaron 22.047-24.644 ms de reloj virtual (10/10). El doble de la más lenta da
// 49,3 s, por encima del defecto; redondeado hacia arriba a múltiplo de 15 s: 60 s. v=344 (tanda 97): la postal «El año
// en días» ya no pide tapas y se van C, I, J (la de 300) y K: tres corridas, 17.569-17.659 ms (3/3). Con la regla del
// doble entraría en el defecto de 45 s; se deja en 60 s (bajarlo no fue parte de la tanda).
// `copia-importar` (v=334) abre la app ENTERA en ocho iframes (A exporta; B, C, E y F importan; C2 abre #skips después; D y G
// no escriben) contra una Spotify simulada. Medido a tasa de acierto el 23/10 (tanda 79), con el defecto de 45 s: diez
// corridas seguidas gastaron 14.827-15.554 ms de reloj virtual (10/10). El doble de la más lenta da 31,1 s: no entra en
// `PRESUPUESTO` y corre con los 45 s.
const PRESUPUESTO = { 'calendario': 15000, 'ocultar-artista': 90000, 'import-guarda': 60000, 'ocultos-cache': 60000, 'mapa': 240000, 'generos-escaneo': 195000, 'router-teardown': 120000, 'guard-ruta-vieja': 90000, 'postal': 60000 };
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

// ⚠️ `process.exit()` NO corre el `finally`: hasta la tanda 82 había un `process.exit(0)` y un `process.exit(1)` dentro
// del `try`, así que el `rmSync(perfil…)` de abajo no llegaba nunca y quedaba un `/tmp/banco-chrome-*` por corrida (69 en
// la 81). Ahora el `try` solo decide el código y la salida va DESPUÉS del `finally`.
let codigo = 1;
try {
  const dom = await new Promise((res, rej) => {
    const p = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      // Solo los nombres del servidor local pasan por el resolutor. Las IP
      // literales no pasan por esta regla; el bwrap sin red las tapa afuera.
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      `--user-data-dir=${perfil}`,
      // 45 s de reloj VIRTUAL, no de pared: es un tope, no una espera. Subio de
      // 20 s en v=273 porque el banco del mosaico hace trabajo de verdad
      // (empareja, baja 96 tapas y pinta) y a 20 s quedaba al borde: cuando
      // fallaba, el dump salia a medio camino y el rojo llegaba sin mensaje.
      `--virtual-time-budget=${PRESUPUESTO[BANCO] || 45000}`,
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

  // El reloj virtual que gastó, si el banco lo deja dicho en su `data-resumen`: es el número
  // contra el que se fija el PRESUPUESTO de arriba.
  const reloj = (dom.match(/<html[^>]*\sdata-resumen="[^"]*reloj virtual=(\d+) ms/) || [])[1];
  if (estado === 'ok') {
    console.log(`✓ banco/${BANCO}.html (ancho=${ANCHO}): ${mens || 'ok'}${reloj ? ` · reloj virtual ${reloj} ms` : ''}`);
    codigo = 0;
  } else {
    console.error(`✗ banco/${BANCO}.html (ancho=${ANCHO}): estado="${estado || 'ausente'}"${reloj ? ` · reloj virtual ${reloj} ms` : ''}`);
    if (mens) console.error('  ' + mens);
    console.error('  URL: ' + URL);
  }
} finally {
  cerrarServer();
  try { rmSync(perfil, { recursive: true, force: true }); } catch { /* ignora */ }
}
process.exit(codigo);
