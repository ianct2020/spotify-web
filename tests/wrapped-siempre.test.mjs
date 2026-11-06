// tests/wrapped-siempre.test.mjs — el chip «Siempre» de `#wrapped` (tanda 119, v=360).
//
// `features/wrapped.js` REAL en Node; todo lo demás de `src/js/` lo dobla `dobles/loader-t110.mjs`, y el DOM es
// `dobles/dom-t119-doble.mjs` (parsea de verdad lo que el módulo pinta). El `history-stats` es INVENTADO, de tres años.
//
// Lo que se afirma:
//   A. el chip existe, es el PRIMERO de la barra, lleva `data-siempre` y no `data-year`;
//   B. al elegirlo: la tarjeta «DE SIEMPRE» en `#wrapped-alltime`, `#wrapped-year-card` vacío, el chip `.active` y ningún año
//      `.active`, sin postal; y en `#wrapped-apertura`, el recorrido de siempre (v=362, tanda 121). 🔁 Hasta v=361 esto afirmaba
//      el hueco vacío y `montarApertura(host, null)`: codificaba «el recorrido de siempre todavía no existe», y ya existe. La
//      apertura del año anterior se destruye igual: la primera línea de `montarAperturaSiempre` es `destruirVivo()` (sin eso le
//      quedan vivos sus oyentes de `document`). Corrido de verdad, en `tests/wrapped-siempre-recorrido.test.mjs`;
//   C. con un año elegido, el HTML de `#wrapped-content` sin el chip da el mismo `sha256` que `f6f4df1`, el año por defecto
//      y el más viejo. ⚠️ El HTML entero no puede dar igual: el chip vive DENTRO de `#wrapped-content`. Se quita el chip,
//      exacto y nada más, y lo que queda es byte a byte lo de v=359;
//   D. volver de «Siempre» a un año deja la vista de ese año; la elección sobrevive a un `render()` nuevo (volver a la ruta);
//   E. el deslizamiento: a «Siempre» entra como un año más nuevo, y volver, como hoy;
//   F. lectura estática: ningún campo de `stats` nuevo, `renderAllTime` y `deslizar` byte a byte, nada guardado;
//   G. el Wrapped lite no tiene chip.
//
// `T119_SRC` (env) apunta a otra copia de `src/` (los rojos contra `f6f4df1`).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { instalarDom } from './dobles/dom-t119-doble.mjs';

const SRC = process.env.T119_SRC ? resolve(process.env.T119_SRC) : resolve(import.meta.dirname, '../src');
register('./dobles/loader-t110.mjs', pathToFileURL(import.meta.filename), { data: { reales: ['features/wrapped.js'] } });

// De `f6f4df1` (v=359), corriendo este mismo test con `T119_SRC` apuntando a esa copia.
const SHA_V359 = {
  defecto: 'c59fb2dce6e33cd6d6df18517095a5208fff5a5ba18604dfcd18896a7fc84c6f',
  viejo: 'a0f85423357ec00cf10b91b8504ae6c4b3dc7df096440da51115eaa35f682318',
  renderAllTime: '84749d3604cb1660986499f75cbda416eb268210c729f2a5950c6b5467bba561',
  deslizar: 'd9ae73ba62b5ed3eb277cccb7c91c1b5a59fc245dd519dfcea666975988b04f9',
};
const CAMPOS_STATS_V359 = ['top_albums_all_time', 'top_artists_all_time', 'top_tracks_all_time', 'totals', 'years'];

let bien = 0, mal = 0;
const ok = (c, nombre) => { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; };
const sha = (t) => createHash('sha256').update(t).digest('hex');
const tick = () => new Promise((r) => setTimeout(r, 15));

const doc = instalarDom();
globalThis.window = globalThis;
const anio = (year, n) => ({
  year, min: 1000 * n, plays: 100 * n, days_active: 10 * n, longest_streak: n, skip_pct: 12.5,
  first_play: `${year}-01-02T10:00:00Z`, last_play: `${year}-12-30T10:00:00Z`,
  peak_day: { date: `${year}-03-09`, min: 200 }, peak_month: { month: 3, min: 300 }, discovery: { artist: `Hallazgo ${year}`, min: 50 },
  top_artists: [{ name: `Artista ${year}`, min: 90, plays: 9 }],
  top_albums: [{ name: `Disco ${year}`, artist: `Artista ${year}`, min: 80, plays: 8, img: null }],
  top_tracks: [{ name: `Tema ${year}`, artist: `Artista ${year}`, min: 70, plays: 7, uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa' }],
});
const STATS = {
  totals: { min: 6000, plays_valid: 600, plays_raw: 900, days_active: 60, longest_streak: 3, unique_artists: 3, unique_albums: 3, unique_tracks: 3, skip_pct: 33.3 },
  years: [anio(2021, 1), anio(2022, 2), anio(2023, 3)],
  top_artists_all_time: [{ name: 'Artista de siempre', min: 500, plays: 50 }],
  top_albums_all_time: [{ name: 'Disco de siempre', artist: 'Artista de siempre', min: 400, plays: 40, img: null }],
  top_tracks_all_time: [{ name: 'Tema de siempre', artist: 'Artista de siempre', min: 300, plays: 30, uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb' }],
};

let statsAhora = STATS;
const apertura = [], aperturaSiempre = [];
globalThis.__T110 = {
  valores: { AVISO_MEZCLA: 'aviso inventado' },
  stubs: {
    loadHistoryStats: async () => statsAhora,
    isOwner: async () => false,
    ownerLockedMessage: () => '<div class="candado"></div>',
    getMyTop: async () => [{ name: 'Lite', id: 'x', artists: [{ name: 'Lite' }] }],
    escapeHtml: (s) => String(s ?? ''),
    pageHeader: ({ title }) => `<h1>${title}</h1>`,
    marqueeSpan: (s) => s,
    animationsEnabled: () => true,
    vigilarRuta: () => ({ vigente: () => true }),
    fmtDia: (s) => String(s).slice(0, 10),
    anioSinCampoSkipped: () => false,
    esElAnioDelCorte: () => false,
    'features/wrapped-apertura.js:montarApertura': (host, ctx) => {
      apertura.push({ ctx });
      if (ctx) host.innerHTML = '<section class="wr-ap"></section>';
      return null;
    },
    'features/wrapped-apertura.js:montarAperturaSiempre': (host, ctx) => {
      aperturaSiempre.push({ ctx });
      if (ctx) host.innerHTML = '<section class="wr-ap" data-de="siempre"></section>';
      return null;
    },
  },
};

const { render } = await import(pathToFileURL(`${SRC}/js/features/wrapped.js`).href);
const main = doc.body.appendChild(doc.createElement('main'));
const $ = (s) => doc.querySelector(s);
const contenido = () => $('#wrapped-content').innerHTML;
const CHIP = /<button class="wrapped-year-tab(?: active)?" data-siempre>Siempre<\/button>/;
const sinChip = () => contenido().replace(CHIP, '');
const clic = async (s) => { const b = $(s); if (!b) return false; b.click(); await tick(); return true; };
const activos = () => doc.querySelectorAll('.wrapped-year-tab').filter((b) => b.classList.contains('active'));
const IMPRIMIR = (k, v) => console.log(`  · sha ${k}: ${v}`);

console.log('A. el chip');
await render(main);
const shaDefecto = sha(sinChip());
const fila = doc.querySelectorAll('#wrapped-year-tabs .wrapped-year-tab');
ok(fila[0]?.dataset.siempre !== undefined, 'el primero de la barra lleva data-siempre');
ok(fila[0]?.textContent === 'Siempre', 'dice «Siempre»');
ok(fila[0]?.dataset.year === undefined, 'no lleva data-year');
ok(doc.querySelectorAll('[data-siempre]').length === 1, 'hay exactamente uno');
ok(fila.slice(fila[0]?.dataset.siempre !== undefined ? 1 : 0).map((b) => b.dataset.year).join() === '2023,2022,2021', 'los años siguen de más nuevo a más viejo');
ok(activos().length === 1 && activos()[0].dataset.year === '2023', 'por defecto, el año más nuevo y no «Siempre»');

console.log('C. con un año, la vista de v=359');
IMPRIMIR('defecto', shaDefecto);
ok(shaDefecto === SHA_V359.defecto, 'el año por defecto da el sha256 de f6f4df1');
await clic('[data-year="2021"]');
const shaViejo = sha(sinChip());
IMPRIMIR('viejo', shaViejo);
ok(shaViejo === SHA_V359.viejo, 'el año más viejo da el sha256 de f6f4df1');
ok(!!$('#wrapped-year-card .wrapped-postal-btn'), 'con un año, la postal sigue');
ok($('#wrapped-slide')?.classList.contains('wr-desliza-izq'), 'E. de un año a uno más viejo, wr-desliza-izq (como en v=359)');

console.log('B. elegido');
const antes = apertura.length;
const hayChip = await clic('[data-siempre]');
ok(hayChip, 'se puede tocar');
ok($('#wrapped-alltime .wrapped-hero-year')?.textContent === 'DE SIEMPRE', '#wrapped-alltime tiene la tarjeta «DE SIEMPRE»');
ok(hayChip && $('#wrapped-year-card')?.innerHTML === '', '#wrapped-year-card vacío');
ok(hayChip && $('#wrapped-apertura .wr-ap')?.dataset.de === 'siempre', '#wrapped-apertura lleva el recorrido de siempre');
ok(activos().length === 1 && activos()[0].dataset.siempre !== undefined, 'el chip .active y ningún año');
ok(hayChip && !$('.wrapped-postal-btn'), 'sin postal');
ok(hayChip && apertura.slice(antes).length === 0 && aperturaSiempre.length === 1 && aperturaSiempre[0].ctx?.stats === STATS && !('y' in aperturaSiempre[0].ctx), 'se monta el recorrido de siempre, con las stats y sin año, y no el del año');
ok(/export function montarAperturaSiempre\(host, ctx\) \{\s*destruirVivo\(\);/.test(readFileSync(`${SRC}/js/features/wrapped-apertura.js`, 'utf8')), 'y lo primero que hace es destruir la apertura viva del año');
ok($('#wrapped-slide')?.classList.contains('wr-desliza-der'), 'E. a «Siempre» desde un año entra como uno más nuevo (wr-desliza-der)');

console.log('D. se recuerda y se vuelve');
await render(main);
ok(activos()[0]?.dataset.siempre !== undefined, 'un render() nuevo (volver a la ruta) sigue en «Siempre»');
ok(hayChip && $('#wrapped-year-card')?.innerHTML === '', 'y sin la tarjeta del año');
ok(!$('#wrapped-slide')?.classList.contains('wr-desliza-der'), 'E. un repintado no arrastra la dirección');
await clic('[data-siempre]');
ok(!$('#wrapped-slide')?.classList.contains('wr-desliza-der') && !$('#wrapped-slide')?.classList.contains('wr-desliza-izq'), 'E. tocar «Siempre» estando en «Siempre» no desliza');
await clic('[data-year="2023"]');
// El de por defecto se midió al entrar, sin deslizar; acá se llegó con un clic, y la clase del deslizamiento es lo único distinto.
ok(sha(sinChip().replace(' class="wr-desliza-izq"', '')) === shaDefecto, 'de «Siempre» al año por defecto: el mismo sha256');
if (hayChip) ok($('#wrapped-slide')?.classList.contains('wr-desliza-izq'), 'E. volver a un año, wr-desliza-izq');
await clic('[data-siempre]');
await clic('[data-year="2021"]');
ok(sha(sinChip()) === shaViejo, 'de «Siempre» al más viejo: el mismo sha256');

console.log('F. lectura estática');
const fuente = readFileSync(`${SRC}/js/features/wrapped.js`, 'utf8');
const campos = [...new Set([...fuente.matchAll(/(?<![-\w.])stats\??\.([A-Za-z_]\w*)/g)].map((m) => m[1]))].sort();
ok(campos.join() === CAMPOS_STATS_V359.join(), `ningún campo de stats nuevo (${campos.join(', ')})`);
const trozo = (desde, hasta) => fuente.slice(fuente.indexOf(desde), fuente.indexOf(hasta));
const shaAllTime = sha(trozo('function renderAllTime()', '// ============ Wrapped lite'));
const shaDeslizar = sha(trozo('function deslizar(caja)', 'function renderYearCard()'));
IMPRIMIR('renderAllTime', shaAllTime);
IMPRIMIR('deslizar', shaDeslizar);
ok(shaAllTime === SHA_V359.renderAllTime, 'renderAllTime, byte a byte');
ok(shaDeslizar === SHA_V359.deslizar, 'deslizar, byte a byte');
ok(!/localStorage|sessionStorage/.test(fuente), 'la elección no se guarda en ningún almacén');

console.log('G. el Wrapped lite');
statsAhora = null;
await render(main);
await tick();
ok(!doc.querySelector('[data-siempre]'), 'sin historial, sin chip');

console.log(mal ? `${mal} fallos de ${bien + mal}` : `OK — ${bien} asserts`);
process.exit(mal ? 1 : 0);
