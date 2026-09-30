// Suite «ninguna apertura de vista gasta cuota» (v=261).
//
// Hasta v=260 el `render()` de #new-releases y de #discover-artists, y el chip de
// umbral de likes, terminaban en `scanArtists()` y escaneaban solos si la cola
// quedaba por debajo del aviso de 40 peticiones. El 30/09 eso gastó cuota de Ian
// sin preguntar (un artista que había fallado volvía a la cola en cada apertura).
//
// Desde v=261 NINGÚN camino automático pide discografías. Los actos explícitos
// son tres —el selector, «Actualizar» y «Base…»— y cada uno trae su cartel.
//
// Las vistas no se pueden importar en Node (dependen del DOM entero), así que lo
// de arriba se cuida LEYENDO EL FUENTE, con una guarda del guarda por si alguien
// estrecha la búsqueda hasta que no encuentre nada y pase en verde. Lo que sí
// corre de verdad son los dos módulos nuevos: `util/escaneo-fallos.js` (la marca
// «se intentó y falló el día X») y `util/sin-escanear.js` (los textos).

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

// Sin comentarios: los de v=261 nombran `scanArtists(content)` para explicar lo
// que se quitó, y una búsqueda por texto los tomaría por una llamada.
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const leer = (p) => sinComentarios(readFileSync(new URL(`../src/js/${p}`, import.meta.url), 'utf8'));
const VISTAS = { 'features/new-releases.js': leer('features/new-releases.js'), 'features/discover-artists.js': leer('features/discover-artists.js') };

// El texto entre `ini` (incluido) y el primero de `fines` que aparezca después.
function tramo(src, ini, fines) {
  const i = src.indexOf(ini);
  if (i < 0) return null;
  let f = src.length;
  for (const fin of fines) {
    const j = src.indexOf(fin, i + ini.length);
    if (j >= 0 && j < f) f = j;
  }
  return src.slice(i, f);
}

// La llamada completa a `scanArtists(`, contando paréntesis: `scanArtists(content, ruta, { … })`.
function llamadas(src) {
  const out = [];
  const re = /scanArtists\(/g;
  let m;
  while ((m = re.exec(src))) {
    const antes = src.slice(Math.max(0, m.index - 20), m.index);
    if (/function\s+$/.test(antes) || /async function\s+$/.test(antes)) continue;   // la definición
    let d = 0, i = m.index + 'scanArtists'.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') d++;
      else if (src[i] === ')') { d--; if (d === 0) break; }
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

for (const [ruta, src] of Object.entries(VISTAS)) {
  const corto = ruta.split('/').pop();

  // ── 1. El render() no escanea ───────────────────────────────────────────────
  const render = tramo(src, 'export async function render(', ['\nfunction ', '\nasync function ']);
  ok(render && render.length > 500, `${corto}: encontré el render() (guarda del guarda)`);
  ok(!/scanArtists\(/.test(render), `${corto}: el render() NO llama a scanArtists`);
  ok(!/getArtistDiscoCached\(|getArtistAlbums|buscarDiscografiaPorNombre|searchArtistByName/.test(render), `${corto}: el render() no pide discografías por otro camino`);
  // El numerador lo escribía scanArtists() al arrancar; sin él, abrir la vista
  // dejaba «0/350 artistas escaneados» con 350 restaurados del caché (medido en
  // la copia del perfil, 30/09): un número falso con cara de bueno.
  ok(/pintarCuenta\(\)/.test(render), `${corto}: el render() escribe el numerador del conteo`);

  // ── 2. Toda llamada a scanArtists es un acto explícito ─────────────────────
  const ll = llamadas(src);
  ok(ll.length >= 2, `${corto}: encontré las llamadas a scanArtists (${ll.length}; guarda del guarda: ≥2, el selector y «Actualizar»)`);
  for (const l of ll) {
    ok(/motivo:\s*'autorizado'/.test(l), `${corto}: «${l.replace(/\s+/g, ' ').slice(0, 70)}» va con motivo 'autorizado'`);
  }
  ok(!ll.some(l => /motivo:\s*'(filtro|automatico)'/.test(l)), `${corto}: ninguna llamada usa los motivos automáticos`);

  // ── 3. Los llamadores explícitos son los tres esperados ───────────────────
  ok(/reescanearDesdeLaBase/.test(src) && /elegirArtistasAEscanear\(/.test(src), `${corto}: siguen el selector y «Actualizar»`);

  // ── 4. La puerta de gasto no se tocó ──────────────────────────────────────
  // Lo que queda de defensa: quien llegue a `scanArtists` sin el 'autorizado'
  // (hoy nadie) pasa por `acotarEscaneo`, que abre el selector si supera el aviso.
  ok(/if \(motivo !== 'autorizado'\) \{[\s\S]{0,200}acotarEscaneo\(/.test(src), `${corto}: la guarda de acotarEscaneo sigue en scanArtists`);
  ok(/colaAutomatica\(buscados\(\), scanned\)/.test(src), `${corto}: la cola sigue siendo colaAutomatica (la cuenta de v=258)`);
}

// El chip de umbral de likes de #new-releases: un filtro, no una compra.
{
  const src = VISTAS['features/new-releases.js'];
  const chip = tramo(src, "content.querySelector('#newrel-likes').addEventListener('click'", ["content.querySelector('#newrel-months')"]);
  ok(chip && chip.length > 200, 'el handler del chip de likes existe (guarda del guarda)');
  ok(!/scanArtists\(/.test(chip), 'el chip de umbral de likes NO escanea');
  ok(/pintarSub\(\)/.test(chip), 'el chip repinta la cabecera con lo que queda sin escanear');
  ok(/pintarCuenta\(\)/.test(chip), 'y el numerador del conteo, que ya no lo escribe un escaneo');
}

// ── 5. Nadie más pide discografías desde una vista ───────────────────────────
// `getArtistDiscoCached` solo la llaman los `processArtist` de las dos vistas.
for (const [ruta, src] of Object.entries(VISTAS)) {
  const corto = ruta.split('/').pop();
  const pa = tramo(src, 'async function processArtist(', ['\nfunction ', '\nasync function ']);
  const fuera = src.replace(pa || '', '');
  ok(pa && /getArtistDiscoCached\(/.test(pa), `${corto}: processArtist es quien pide la discografía`);
  ok(!/getArtistDiscoCached\(/.test(fuera.replace(/import[\s\S]*?from '\.\/discover-common\.js';/, '')), `${corto}: fuera de processArtist nadie la pide`);
}

// ── 6. La cola automática saltea los marcados; la explícita no ──────────────
for (const [ruta, src] of Object.entries(VISTAS)) {
  const corto = ruta.split('/').pop();
  const q = tramo(src, 'let queue = artistas', ['if (!queue.length)']);
  ok(q, `${corto}: encontré la línea de la cola`);
  // Explícita (selector): `artistas.filter(!scanned)`, sin pasar por los marcados.
  ok(/artistas\s*\?\s*artistas\.filter\(a => !a\.scanned\)/.test(q), `${corto}: la cola del selector no mira los marcados`);
  // «Actualizar» (motivo autorizado sin artistas): tampoco los mira.
  ok(/motivo === 'autorizado'\s*\?\s*colaAutomatica\(buscados\(\), scanned\)/.test(q), `${corto}: «Actualizar» reintenta a los marcados`);
  // Solo el camino no autorizado los saltea.
  ok(/:\s*sinFallosMarcados\(colaAutomatica\(buscados\(\), scanned\), state\.fallos\)/.test(q), `${corto}: la cola automática los saltea`);
}

// ── 7. La marca de fallo: se anota el día, se borra si sale bien ─────────────
const { leerFallos, marcarFallo, limpiarFallo, sinFallosMarcados, fechaDelFallo } = await import('../src/js/util/escaneo-fallos.js');

eq([...leerFallos('t_fallos')], [], 'sin nada guardado: vacío');
{
  const m = marcarFallo('t_fallos', 'joseph vincent', 'No se pudo conectar con Spotify', new Date('2026-09-30T00:18:00Z'));
  eq(m.get('joseph vincent'), { t: '2026-09-30T00:18:00.000Z', motivo: 'No se pudo conectar con Spotify' }, 'se anota el instante y el motivo');
  eq(leerFallos('t_fallos').get('joseph vincent').t, '2026-09-30T00:18:00.000Z', 'y sobrevive a releer');
}
marcarFallo('t_fallos', 'otro', 'x');
eq([...leerFallos('t_fallos').keys()].sort(), ['joseph vincent', 'otro'], 'se acumulan');
limpiarFallo('t_fallos', 'joseph vincent');
eq([...leerFallos('t_fallos').keys()], ['otro'], 'limpiar borra solo ese');
{
  const antes = mem.get([...mem.keys()].find(k => k.includes('t_fallos')));
  limpiarFallo('t_fallos', 'no-estaba');
  eq(mem.get([...mem.keys()].find(k => k.includes('t_fallos'))), antes, 'limpiar uno que no estaba no escribe nada');
}
mem.set([...mem.keys()].find(k => k.includes('t_fallos')), '{no es json');
eq([...leerFallos('t_fallos')], [], 'un valor roto se lee como vacío, no tira');
mem.set([...mem.keys()].find(k => k.includes('t_fallos')), JSON.stringify({ a: { t: '2026-01-01T00:00:00Z' }, b: 5, c: null, d: { t: 3 } }));
eq([...leerFallos('t_fallos').keys()], ['a'], 'entradas mal formadas se descartan');
eq(marcarFallo('t_fallos', '', 'x').has(''), false, 'sin nombre no anota nada');
eq(leerFallos('t_fallos').size, 1, '…y no escribió');
eq(marcarFallo('t_fallos', 'largo', 'x'.repeat(500)).get('largo').motivo.length, 200, 'el motivo se acota (no llena el localStorage)');

// Lo que la cola automática puede encolar.
{
  const cola = ['a', 'b', 'c'].map(x => ({ nameLower: x }));
  const f = new Map([['b', { t: '2026-09-30T00:00:00Z', motivo: '' }]]);
  eq(sinFallosMarcados(cola, f).map(a => a.nameLower), ['a', 'c'], 'la cola automática saltea al marcado');
  eq(sinFallosMarcados(cola, new Map()).map(a => a.nameLower), ['a', 'b', 'c'], 'sin marcados no cambia nada');
  eq(cola.length, 3, 'y no muta la cola');
}

eq(fechaDelFallo('no es una fecha'), '', 'fecha inválida: vacía');
ok(/^\d{1,2} \S+/.test(fechaDelFallo('2026-09-29T12:00:00Z')), 'una fecha válida sale como «29 sept»');

// ── 8. Los textos de «faltan artistas» ─────────────────────────────────────
const { contarSinEscanear, sufijoSinEscanear, notaSinEscanear } = await import('../src/js/util/sin-escanear.js');
eq(contarSinEscanear([{ scanned: true }, { scanned: false }, {}]), 2, 'cuenta los no escaneados');
eq(sufijoSinEscanear(0), '', 'con 0 sin escanear no dice nada');
eq(sufijoSinEscanear(129), ' · 129 sin escanear', 'con 129 lo dice en la cabecera');
eq(sufijoSinEscanear(1234), ' · 1234 sin escanear', 'cuatro cifras sin separador (es-ES)');
eq(sufijoSinEscanear(12345), ' · 12.345 sin escanear', 'con separador de millares desde cinco cifras');
eq(notaSinEscanear(0), '', 'la nota de lista vacía no sale si no falta ninguno');
ok(/Quedan 129 artistas sin escanear/.test(notaSinEscanear(129)), 'con 129 dice que quedan');
ok(/Queda?n 1 artista sin escanear/.test(notaSinEscanear(1)) && !/artistas sin escanear/.test(notaSinEscanear(1)), 'con 1 va en singular');
ok(/Elegir más artistas para escanear/.test(notaSinEscanear(3)), 'y nombra el botón que lo resuelve');
ok(!/Actualizar/.test(notaSinEscanear(3)), 'y NO manda a «Actualizar», que es lo caro');

// Los mensajes de lista vacía de las dos vistas usan la nota (si no, «no hay
// novedades» sigue siendo mentira con artistas sin mirar).
for (const [ruta, src] of Object.entries(VISTAS)) {
  const corto = ruta.split('/').pop();
  ok(/notaSinEscanear\(/.test(src), `${corto}: el mensaje de lista vacía lleva la nota de artistas sin escanear`);
  ok(/sufijoSinEscanear\(/.test(src), `${corto}: la cabecera dice cuántos faltan`);
  ok(!/Toca «Actualizar» para consultarle a Spotify/.test(src), `${corto}: ya no manda a «Actualizar» (lo caro) para escanear`);
}

console.log(`OK sin-escaneo-automatico: ${n} asserts`);
