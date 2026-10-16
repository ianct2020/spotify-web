// tests/cuota.test.mjs — la cuota a la vista (v=310, tanda 58)
//
// POR QUÉ ESTA SUITE EXISTE: la app choca con DOS cuotas de Spotify —la de
// `/search` (~700 peticiones, medida el 18/09/2026) y la de discografías
// (`/artists/{id}/albums`, 100, medida el 16/09/2026)— y hasta v=309 no le
// enseñaba a nadie cuánto llevaba gastado de ninguna: el diagnóstico de
// discografías vivía en `sessionStorage` y la búsqueda no contaba nada.
// `util/cuota.js` cuenta, por pestaña y por carga, y el pie del menú lo pinta.
//
// Lo que se vigila acá, sin navegador:
//   1. las dos cuotas se cuentan POR SEPARADO (mezclarlas es la puerta 2);
//   2. un 429 guarda la hora y la pausa;
//   3. una petición que la pausa corta ANTES de salir NO es una petición (no
//      gastó cuota): va aparte, como «cortada» (contarla es la puerta 1);
//   4. el texto del renglón, con la hora fija, `TZ` de Buenos Aires y los
//      números con `toLocaleString('es-ES')`;
//   5. el tope MEDIDO no va en el renglón como «de 700» (no es un límite
//      publicado): va en el `title`. Lectura estática (la puerta 3).
//
// Los artistas, temas y números de acá son INVENTADOS.

process.env.TZ = 'America/Argentina/Buenos_Aires';

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA = join(raiz, 'src/js/util/cuota.js');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

let m;
try {
  m = await import(pathToFileURL(RUTA).href);
} catch (e) {
  console.log(`  ✗ no se pudo importar src/js/util/cuota.js: ${e.code || e.message}`);
  console.log(`\n0 asserts OK · 1 fallaron`);
  process.exit(1);
}
const {
  estadoInicial, cuotaDeEndpoint, anotarPeticion, anotarCortada, anotarPausa,
  textoRenglon, tituloRenglon, crearContador, CLAVE_CUOTA, EVENTO_CUOTA,
} = m;

// Una hora fija: 16/10/2026 21:00 en Buenos Aires (UTC−3) = 00:00 UTC del 17.
const AHORA = Date.UTC(2026, 9, 17, 0, 0, 0);
const MIN = 60 * 1000;

// ── 0. ICU de verdad, o el resto no significa nada ─────────────────────────
console.log('0. Intl');
ok((12345).toLocaleString('es-ES') === '12.345', 'es-ES pone el punto de millares en 12.345');
ok(new Date(AHORA).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) === '21:00', 'la hora fija, en Buenos Aires, es 21:00');

// ── 1. Qué endpoint es de qué cuota ─────────────────────────────────────────
console.log('1. cuotaDeEndpoint');
ok(cuotaDeEndpoint('/search?q=artist%3A%22Banda%20Inventada%22&type=album&limit=10') === 'busqueda', '/search → busqueda');
ok(cuotaDeEndpoint('https://api.spotify.com/v1/search?q=x&type=track') === 'busqueda', 'la URL absoluta de /search → busqueda');
ok(cuotaDeEndpoint('/artists/0aAaAaAaAaAaAaAaAaAaAa/albums?include_groups=album,single&limit=10') === 'discografia', '/artists/{id}/albums → discografia');
ok(cuotaDeEndpoint('/artists/0aAaAaAaAaAaAaAaAaAaAa/albums?offset=10&limit=10&include_groups=album,single') === 'discografia', 'la página siguiente (`next` recortado) → discografia');
ok(cuotaDeEndpoint('https://api.spotify.com/v1/artists/0aAaAaAaAaAaAaAaAaAaAa/albums?limit=10') === 'discografia', 'la URL absoluta del nativo → discografia');
ok(cuotaDeEndpoint('/artists/0aAaAaAaAaAaAaAaAaAaAa') === null, '/artists/{id} a secas no es de ninguna');
ok(cuotaDeEndpoint('/albums/1bBbBbBbBbBbBbBbBbBbBb/tracks?limit=50') === null, '/albums/{id}/tracks no es de ninguna');
ok(cuotaDeEndpoint('/me') === null, '/me no es de ninguna');

// ── 2. Las dos cuotas, por separado (la puerta 2) ───────────────────────────
console.log('2. por separado');
let e = estadoInicial();
for (let i = 0; i < 37; i++) e = anotarPeticion(e, 'busqueda', 200, AHORA);
ok(e.busqueda.peticiones === 37, 'búsqueda: 37 peticiones');
ok(e.discografia.peticiones === 0, 'discografías: sigue en 0 con 37 búsquedas');
for (let i = 0; i < 12; i++) e = anotarPeticion(e, 'discografia', 200, AHORA);
ok(e.discografia.peticiones === 12, 'discografías: 12');
ok(e.busqueda.peticiones === 37, 'búsqueda: sigue en 37 con 12 discografías');
const antes = JSON.stringify(e);
const e2 = anotarPeticion(e, 'busqueda', 200, AHORA);
ok(JSON.stringify(e) === antes, 'anotarPeticion no muta el estado que recibe (es pura)');
ok(e2.busqueda.peticiones === 38, '...y devuelve uno nuevo');
ok(JSON.stringify(anotarPeticion(e, 'otra', 200, AHORA)) === antes, 'una cuota desconocida no toca nada');

// ── 3. El 429: cuenta como petición, guarda la hora y la pausa ──────────────
console.log('3. el 429');
let s = estadoInicial();
for (let i = 0; i < 639; i++) s = anotarPeticion(s, 'busqueda', 200, AHORA - 10 * MIN);
s = anotarPeticion(s, 'busqueda', 429, AHORA - 4 * MIN);
ok(s.busqueda.peticiones === 640, 'el 429 también salió a la red: 640');
ok(s.busqueda.n429 === 1, 'un 429');
ok(s.busqueda.ultimo429 === AHORA - 4 * MIN, 'con su hora');
ok(s.discografia.n429 === 0 && s.discografia.ultimo429 === null, 'el 429 de búsqueda no toca las discografías');
s = anotarPausa(s, 'busqueda', AHORA + 34 * MIN);
ok(s.busqueda.pausaHasta === AHORA + 34 * MIN, 'la pausa, hasta cuándo');
ok(s.discografia.pausaHasta === null, '...solo en búsqueda');

// ── 4. Una cortada por la pausa NO es una petición (la puerta 1) ────────────
console.log('4. cortadas por la pausa');
const c1 = anotarCortada(s, 'busqueda');
ok(c1.busqueda.peticiones === 640, 'una búsqueda cortada no sube «peticiones»');
ok(c1.busqueda.cortadas === 1, '...sube «cortadas»');
ok(c1.busqueda.n429 === 1, '...y no es otro 429');
const c2 = anotarCortada(estadoInicial(), 'discografia');
ok(c2.discografia.peticiones === 0 && c2.discografia.cortadas === 1, 'en discografías, igual');
ok(c2.busqueda.cortadas === 0, '...y no toca la búsqueda');

// ── 5. El texto del renglón ─────────────────────────────────────────────────
console.log('5. el texto');
const t0 = textoRenglon('busqueda', estadoInicial(), AHORA);
ok(t0 === 'Búsqueda: sin peticiones en esta pestaña', `0 → «${t0}»`);
const td0 = textoRenglon('discografia', estadoInicial(), AHORA);
ok(td0 === 'Discografías: sin peticiones en esta pestaña', `0 → «${td0}»`);
ok(textoRenglon('busqueda', e, AHORA) === 'Búsqueda: 37 peticiones · sin 429', `N sin 429 → «${textoRenglon('busqueda', e, AHORA)}»`);
ok(textoRenglon('discografia', e, AHORA) === 'Discografías: 12 peticiones · sin 429', `«${textoRenglon('discografia', e, AHORA)}»`);
let uno = anotarPeticion(estadoInicial(), 'discografia', 200, AHORA);
ok(textoRenglon('discografia', uno, AHORA) === 'Discografías: 1 petición · sin 429', `singular → «${textoRenglon('discografia', uno, AHORA)}»`);
const tp = textoRenglon('busqueda', s, AHORA);
ok(tp === 'Búsqueda: 640 peticiones · 429 hace 4 min, en pausa hasta las 21:34', `429 en pausa → «${tp}»`);
const tc = textoRenglon('busqueda', c1, AHORA);
ok(tc === 'Búsqueda: 640 peticiones · 429 hace 4 min, en pausa hasta las 21:34 · 1 cortada por la pausa', `con una cortada → «${tc}»`);
const tsp = textoRenglon('busqueda', s, AHORA + 40 * MIN);
ok(tsp === 'Búsqueda: 640 peticiones · 429 hace 44 min', `429 y la pausa ya pasó → «${tsp}»`);
ok(textoRenglon('busqueda', s, AHORA - 4 * MIN + 20 * 1000) === 'Búsqueda: 640 peticiones · 429 hace menos de 1 min, en pausa hasta las 21:34', 'un 429 de hace 20 s');
ok(textoRenglon('busqueda', s, AHORA + 120 * MIN) === 'Búsqueda: 640 peticiones · 429 hace 2 h', 'un 429 de hace dos horas');
let mil = estadoInicial();
mil = { ...mil, busqueda: { ...mil.busqueda, peticiones: 12345 } };
ok(textoRenglon('busqueda', mil, AHORA) === 'Búsqueda: 12.345 peticiones · sin 429', `es-ES: «${textoRenglon('busqueda', mil, AHORA)}»`);
mil = { ...mil, busqueda: { ...mil.busqueda, peticiones: 1234 } };
ok(textoRenglon('busqueda', mil, AHORA) === 'Búsqueda: 1234 peticiones · sin 429', 'es-ES no separa las de cuatro cifras («1234», la regla de CLAUDE.md)');

// ── 6. El tope medido va en el title, NUNCA en el renglón (la puerta 3) ─────
console.log('6. el tope, en el title');
const tb = tituloRenglon('busqueda'), tdt = tituloRenglon('discografia');
ok(/700/.test(tb) && /18\/09\/2026/.test(tb), 'title de búsqueda: el ~700 medido y su fecha');
ok(/100/.test(tdt) && /16\/09\/2026/.test(tdt), 'title de discografías: el 100 medido y su fecha');
ok(/no un límite publicado/.test(tb) && /no un límite publicado/.test(tdt), 'los dos dicen que no es un límite publicado');
ok(/esta pestaña/.test(tb) && /esta pestaña/.test(tdt), 'los dos dicen que cuenta solo esta pestaña');
const estados = [estadoInicial(), e, s, c1, uno, mil, anotarPausa(c2, 'discografia', AHORA + 5 * MIN)];
const renglones = estados.flatMap((x) => ['busqueda', 'discografia'].map((q) => textoRenglon(q, x, AHORA)));
ok(renglones.every((r) => !/\b700\b/.test(r) && !/\bde\s+(unas?\s+)?\d/.test(r)), 'ningún renglón dice «de 700» ni «de N»');
const fuente = readFileSync(RUTA, 'utf8');
const cuerpo = (fuente.match(/export function textoRenglon[\s\S]*?\n}\n/) || [''])[0];
ok(cuerpo.length > 0, 'se encuentra el cuerpo de textoRenglon en el fuente');
ok(!/\b(700|100)\b|TOPE/.test(cuerpo), 'el cuerpo de textoRenglon no nombra el tope (ni el número ni la constante)');

// ── 7. El contador: guarda en sessionStorage y avisa, sin reloj ─────────────
console.log('7. el contador');
const guardado = [], eventos = [];
const k = crearContador({ guardar: (clave, valor) => guardado.push([clave, valor]), emitir: (est) => eventos.push(est), reloj: () => AHORA });
k.peticion('busqueda', 200);
k.peticion('busqueda', 429);
k.pausa('busqueda', AHORA + 5 * MIN);
k.cortada('busqueda');
k.peticion('discografia', 200);
const ek = k.estado();
ok(ek.busqueda.peticiones === 2 && ek.busqueda.n429 === 1 && ek.busqueda.cortadas === 1, 'búsqueda: 2 peticiones, 1 429, 1 cortada');
ok(ek.discografia.peticiones === 1 && ek.discografia.cortadas === 0, 'discografías: 1 y 0');
ok(guardado.length === 5 && guardado.every(([cl]) => cl === CLAVE_CUOTA), `cada cambio se guarda en ${CLAVE_CUOTA}`);
ok(JSON.parse(guardado.at(-1)[1]).busqueda.peticiones === 2, '...con el estado entero, en JSON');
ok(eventos.length === 5, 'cada cambio emite un aviso');
ok(CLAVE_CUOTA === 'fonoteca_cuota_v1' && EVENTO_CUOTA === 'cuotachange', 'la clave y el evento, los del encargo');
const k2 = crearContador({ guardar: () => { throw new Error('cuota de sessionStorage llena'); }, emitir: () => {}, reloj: () => AHORA });
let tiro = false;
try { k2.peticion('busqueda', 200); } catch { tiro = true; }
ok(!tiro && k2.estado().busqueda.peticiones === 1, 'si sessionStorage tira, se cuenta igual y no rompe la petición');

// ── 8. Contar no cambia ninguna espera ni pausa de api.js ───────────────────
console.log('8. api.js');
const api = readFileSync(join(raiz, 'src/js/api.js'), 'utf8');
ok(/import \{[^}]*contadorCuota[^}]*\} from '\.\/util\/cuota\.js'/.test(api), 'api.js importa el contador');
ok(/const SEARCH_PAUSA_MIN_MS = 5 \* 60 \* 1000;/.test(api) && /const SEARCH_PAUSA_MAX_MS = 60 \* 60 \* 1000;/.test(api), 'la pausa de /search, intacta (5 a 60 min)');
ok(/const NATIVO_PAUSA_MIN_MS = 5 \* 60 \* 1000;/.test(api) && /const NATIVO_PAUSA_MAX_MS = 60 \* 60 \* 1000;/.test(api), 'la pausa del nativo, intacta');
ok(!/contadorCuota[^\n]*(await|sleep)/.test(api), 'contar no espera nada');
const util = fuente;
ok(!/\bimport\b/.test(util.replace(/\/\/.*$/gm, '')), 'util/cuota.js no importa nada (hoja, sin ciclos con api.js)');
ok(!/setInterval|setTimeout/.test(util.replace(/\/\/.*$/gm, '')), 'util/cuota.js no tiene reloj propio');

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
