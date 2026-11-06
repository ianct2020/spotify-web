// tests/wrapped-siempre-recorrido.test.mjs — el recorrido por pasos de «Siempre» (tanda 121, v=362).
//
// `features/wrapped.js` y `features/wrapped-apertura.js` REALES en Node (con `ui/calendario-anual.js`, `util/corte-saltos.js` y
// `util/fecha.js`, que son puros); todo lo demás de `src/js/` lo dobla `dobles/loader-t110.mjs`, y el DOM es
// `dobles/dom-t119-doble.mjs`. El `history-stats` es INVENTADO: cuatro años pegados, a medias el primero y el último, con la
// cuenta hecha a mano acá abajo.
//
//   A. `pasosDeSiempre` da los cinco pasos, en orden, con los números contados a mano;
//   B. el año más bajo sale de los COMPLETOS: nunca uno a medias, y con uno o ninguno completo, no se nombra;
//   C. la racha: encadenada da el largo esperado; si no da `totals.longest_streak`, el paso no sale; con ventanas despegadas o un
//      año sin `days`, tampoco; los días con música, solo si cuadran con la cuenta de los `days`;
//   D. un paso que tira no rompe los otros; con menos de 3 pasos no se monta nada;
//   E. montado: el `aria-label`, la clase `wr-con-apertura`, los controles;
//   F. volver a un año destruye el de «Siempre» y monta el del año, con el `sha256` de v=361;
//   G. elegir «Siempre» y volver no deja oyentes de `document` ni de `window`, ni observadores vivos;
//   H. ningún texto de los pasos dice «de N días», «saltos», «salt» ni «skip»;
//   I. con las animaciones en «nunca», la lista quieta con los números puestos;
//   J. `wrapped.js`: si el módulo no trae `montarAperturaSiempre` (una pestaña con el viejo en caché), cae a `montarApertura(host, null)`.
//
// ⚠️ `wr-con-apertura` NO va en la barra: `contenedor = host.parentElement` es `#wrapped-slide`, y la barra es hermana de ese
// `#wrapped-slide` desde v=244. O sea que `.wr-con-apertura .wrapped-year-bar` no casa con nada, ni con un año ni con «Siempre», y
// el recorrido de un año no se toca en esta tanda: se afirma dónde está la clase de verdad, y lo roto está en `PENDIENTES.md` (tanda 121).
//
// `T121_SRC` (env) apunta a otra copia de `src/` (los rojos contra `d10e6a48`).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { instalarDom, Elemento } from './dobles/dom-t119-doble.mjs';

const SRC = process.env.T121_SRC ? resolve(process.env.T121_SRC) : resolve(import.meta.dirname, '../src');
register('./dobles/loader-t110.mjs', pathToFileURL(import.meta.filename), { data: { reales: ['features/wrapped.js', 'features/wrapped-apertura.js', 'ui/calendario-anual.js', 'util/corte-saltos.js', 'util/fecha.js'] } });

// De `d10e6a48` (v=361), corriendo este mismo test con `T121_SRC` apuntando a esa copia.
const SHA_V361 = {
  defecto: 'a28ddaab3906ab432a9ab846e15b28d598464d0990a0e199c069987baf839de8',
  viejo: '6b8b17d241e0b7852939fb94a2e2457d45a405551828a67a62ad0765db6a4eb8',
};

let bien = 0, mal = 0;
const ok = (c, nombre) => { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; };
const igual = (nombre, a, b) => ok(a === b, a === b ? nombre : `${nombre}: da ${JSON.stringify(a)} y se esperaba ${JSON.stringify(b)}`);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const tick = () => new Promise((r) => setTimeout(r, 15));

// ── El DOM: lo que la apertura lee y el doble de la 119 no necesitaba ─────────────
const doc = instalarDom();
globalThis.window = globalThis;
Object.defineProperty(Elemento.prototype, 'parentElement', { get() { return this.parent instanceof Elemento ? this.parent : null; } });
Object.defineProperty(Elemento.prototype, 'isConnected', { get() { for (let n = this; n; n = n.parent) if (n === doc) return true; return false; } });
Elemento.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
// Los oyentes de `window` se cuentan acá; los de `document`, en `doc.oyentes`.
const oyentesVentana = {};
globalThis.addEventListener = (t, f) => { (oyentesVentana[t] ||= []).push(f); };
globalThis.removeEventListener = (t, f) => { oyentesVentana[t] = (oyentesVentana[t] || []).filter((x) => x !== f); };
let raf = 0;
globalThis.requestAnimationFrame = () => ++raf;
globalThis.cancelAnimationFrame = () => {};
// Los observadores: cuántos quedan sin `disconnect()`.
let observadoresVivos = 0;
class ObservadorDoble { constructor() { observadoresVivos++; this.vivo = true; } observe() {} unobserve() {} disconnect() { if (this.vivo) { this.vivo = false; observadoresVivos--; } } }
globalThis.IntersectionObserver = ObservadorDoble;
globalThis.MutationObserver = ObservadorDoble;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

// ── El historial INVENTADO, con la cuenta a mano ──────────────────────────────────
//
//   2020: del 1/10 al 31/12 (92 días, A MEDIAS). 2021 y 2022: enteros. 2023: del 1/1 al 10/3 (69 días, A MEDIAS).
//   Minutos: 500 · 1000 · 3000 · 100 = 4.600. El más alto, 2022. El más bajo de verdad es 2023, a medias: el más bajo de los
//   completos es 2021.
//   Días con música: 3 (29, 30 y 31/12/2020) + 4 (1 al 4/1/2021) + 6 (11 al 16/4/2022, índices 100 a 105) + 2 (6 y 11/1/2023) = 15.
//   La racha más larga son los 7 que cruzan el año: del 29/12/2020 al 4/1/2021.
const serie = (largo, activos) => { const m = Array(largo).fill(0); for (const i of activos) m[i] = 10; return m; };
const anio = (year, minutos, from, last, largo, activos) => ({
  year, min: minutos, plays: minutos / 10, days_active: activos.length, longest_streak: activos.length, skip_pct: 12.5,
  first_play: `${from}T08:00:00Z`, last_play: `${last}T21:00:00Z`,
  days: { from, min: serie(largo, activos) },
  peak_day: { date: from, min: 10 }, peak_month: { month: 3, min: 300 }, discovery: { artist: `Hallazgo ${year}`, min: 5 },
  top_artists: [{ name: `Artista ${year}`, min: 90, plays: 9 }, { name: `Segundo ${year}`, min: 80, plays: 8 }],
  top_albums: [{ name: `Disco ${year}`, artist: `Artista ${year}`, min: 80, plays: 8, img: null }],
  top_tracks: [{ name: `Tema ${year}`, artist: `Artista ${year}`, min: 70, plays: 7, uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa' }],
});
const crearStats = () => ({
  totals: { min: 4600, plays_valid: 460, plays_raw: 900, days_active: 15, longest_streak: 7, unique_artists: 9, unique_albums: 3, unique_tracks: 3, skip_pct: 33.3 },
  years: [
    anio(2020, 500, '2020-10-01', '2020-12-31', 92, [89, 90, 91]),
    anio(2021, 1000, '2021-01-01', '2021-12-31', 365, [0, 1, 2, 3]),
    anio(2022, 3000, '2022-01-01', '2022-12-31', 365, [100, 101, 102, 103, 104, 105]),
    anio(2023, 100, '2023-01-01', '2023-03-10', 69, [5, 10]),
  ],
  monthly: [],
  top_artists_all_time: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve'].map((n, i) => ({ name: `Artista ${n}`, min: 900 - i * 10, plays: 90 - i, first_year: 2020 + (i % 2) })),
  top_albums_all_time: [{ name: 'Disco de siempre', artist: 'Artista Uno', min: 400, plays: 40, img: 'https://tapas.invalid/disco.jpg' }, { name: 'Disco segundo', artist: 'Artista Dos', min: 300, plays: 30, img: null }],
  top_tracks_all_time: [{ name: 'Tema de siempre', artist: 'Artista Uno', min: 300, plays: 30, uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb' }],
});

let statsAhora = crearStats();
let anima = true;
globalThis.__T110 = {
  valores: {},
  stubs: {
    loadHistoryStats: async () => statsAhora,
    isOwner: async () => true,
    ownerLockedMessage: () => '',
    escapeHtml: (s) => String(s ?? ''),
    pageHeader: ({ title }) => `<h1>${title}</h1>`,
    marqueeSpan: (s) => s,
    animationsEnabled: () => anima,
    vigilarRuta: () => ({ vigente: () => true }),
  },
};

const ap = await import(pathToFileURL(`${SRC}/js/features/wrapped-apertura.js`).href);
const { render } = await import(pathToFileURL(`${SRC}/js/features/wrapped.js`).href);
const fmtPrueba = (m) => `${m} min`;
const ctxDe = (stats) => ({ stats, MESES: [], MESES_LARGOS: [], fmtMinutes: fmtPrueba, fmtDia: (s) => `«${String(s).slice(0, 10)}»` });
const pasos = (stats) => (ap.pasosDeSiempre ? ap.pasosDeSiempre(ctxDe(stats)) : []);
const paso = (lista, id) => lista.find((p) => p.id === id);
const hayFuncion = typeof ap.pasosDeSiempre === 'function' && typeof ap.montarAperturaSiempre === 'function';
ok(hayFuncion, 'wrapped-apertura.js exporta pasosDeSiempre y montarAperturaSiempre');

console.log('A. los cinco pasos');
{
  const l = pasos(crearStats());
  igual('el orden', l.map((p) => p.id).join(), 'horas,anios,artista,album,racha');
  const h = paso(l, 'horas');
  ok(h?.num?.[0] === 4600 && h?.num?.[1] === 'min', 'horas: el número es totals.min (4.600)');
  ok(/460/.test(h?.bajada || '') && (h?.bajada || '').includes('«2020-10-01»'), `horas: la bajada lleva las reproducciones y desde cuándo («${h?.bajada}»)`);
  ok((h?.info || '').includes('«2023-03-10»'), `horas: el ⓘ dice hasta cuándo («${h?.info}»)`);
  const a = paso(l, 'anios');
  ok((a?.titular || '').includes('2022'), `años: el titular es el año más alto («${a?.titular}»)`);
  igual('años: las cuatro barras', (a?.visual || '').match(/class="wr-ap-barra"/g)?.length, 4);
  ok((a?.visual || '').includes('class="wr-ap-mes pico"'), 'años: el más alto lleva `pico`, como el mes más alto');
  ok(/data-alto="100\.00"/.test(a?.visual || '') && /data-alto="16\.67"/.test(a?.visual || ''), 'años: la altura es contra el más alto (3.000 = 100; 500 = 16,67)');
  ok(['2020', '2021', '2022', '2023'].every((y) => (a?.visual || '').includes(`<div class="wr-ap-mes-lbl">${y}</div>`)), 'años: la etiqueta de cada barra es el año');
  ok((a?.info || '').includes('«2020-10-01»') && (a?.info || '').includes('«2023-03-10»'), `años: el ⓘ da las dos fechas de los años a medias («${a?.info}»)`);
  const r = paso(l, 'artista');
  igual('artista: el titular es el primero', r?.titular, 'Artista Uno');
  ok((r?.bajada || '').includes('2020'), `artista: la bajada dice desde qué año («${r?.bajada}»)`);
  igual('artista: los 8 primeros, no los 9', (r?.visual || '').match(/wr-ap-fila/g)?.length, 8);
  const d = paso(l, 'album');
  igual('disco: el titular', d?.titular, 'Disco de siempre');
  igual('disco: la tapa es `img`', d?.tapa, 'https://tapas.invalid/disco.jpg');
  const sinTapa = crearStats(); sinTapa.top_albums_all_time[0].img = null;
  igual('disco: sin `img`, sin tapa', paso(pasos(sinTapa), 'album')?.tapa ?? null, null);
  const c = paso(l, 'racha');
  ok(c?.num?.[0] === 7 && c?.num?.[1] === 'ent', 'racha: los 7 que cruzan el año');
  ok((c?.bajada || '').includes('«2020-12-29»') && (c?.bajada || '').includes('«2021-01-04»'), `racha: del día al día («${c?.bajada}»)`);
  ok(/\b15\b/.test(c?.cuerpo || ''), `racha: los días con música («${c?.cuerpo}»)`);
}

console.log('B. el año más bajo, solo de los completos');
{
  const a = paso(pasos(crearStats()), 'anios');
  ok((a?.cuerpo || '').includes('2021') && /bajo/.test(a?.cuerpo || ''), `el más bajo de los completos es 2021 («${a?.cuerpo}»)`);
  ok(!/2023[^.]*bajo|bajo[^.]*2023/.test(a?.cuerpo || ''), 'nunca el de a medias (2023 tiene menos minutos, y no se nombra como el más bajo)');
  const uno = crearStats(); uno.years = uno.years.filter((y) => y.year !== 2022);
  const a1 = paso(pasos(uno), 'anios');
  ok(!!a1 && !/bajo/.test(a1.cuerpo || ''), `con un solo año completo, no se nombra el más bajo («${a1?.cuerpo}»)`);
  const cero = crearStats(); cero.years = cero.years.filter((y) => y.year === 2020 || y.year === 2023);
  const a0 = paso(pasos(cero), 'anios');
  ok(!!a0 && !/bajo/.test(a0.cuerpo || ''), `sin ninguno completo, tampoco («${a0?.cuerpo}»)`);
  // Sin `days`, «completo» se lee de la primera y la última escucha.
  const sinDias = crearStats();
  for (const y of sinDias.years) delete y.days;
  sinDias.years[1].first_play = '2021-01-01T08:00:00Z';
  sinDias.years[2].first_play = '2022-01-01T08:00:00Z';
  const aS = paso(pasos(sinDias), 'anios');
  ok((aS?.cuerpo || '').includes('2021') && /bajo/.test(aS?.cuerpo || ''), 'sin `days`, completo sale de first_play y last_play');
  const sinDias2 = crearStats();
  for (const y of sinDias2.years) delete y.days;
  sinDias2.years[1].first_play = '2021-01-02T08:00:00Z';
  const aS2 = paso(pasos(sinDias2), 'anios');
  ok(!!aS2 && !/2021[^.]*bajo|bajo[^.]*2021/.test(aS2.cuerpo || ''), 'sin `days`, un año que arranca el 2/1 no es completo');
}

console.log('C. la racha');
{
  const forzada = crearStats(); forzada.totals.longest_streak = 8;
  const l = pasos(forzada);
  ok(!paso(l, 'racha'), 'con un longest_streak distinto (8 contra 7), el paso no sale');
  igual('y los otros cuatro siguen', l.map((p) => p.id).join(), 'horas,anios,artista,album');
  const despegada = crearStats(); despegada.years[2].days.from = '2022-01-02';
  ok(hayFuncion && !paso(pasos(despegada), 'racha'), 'con ventanas que no van pegadas, no sale');
  const sinDias = crearStats(); delete sinDias.years[3].days;
  ok(hayFuncion && !paso(pasos(sinDias), 'racha'), 'con un año sin `days`, no sale');
  const dias = crearStats(); dias.totals.days_active = 16;
  const c = paso(pasos(dias), 'racha');
  ok(!!c && !c.cuerpo, 'con días con música que no cuadran (16 contra 15): la racha sale, sin ese número');
}

console.log('D. un paso que tira y menos de tres');
{
  const warn = console.warn; console.warn = () => {};
  const rota = crearStats();
  Object.defineProperty(rota, 'top_artists_all_time', { get() { throw new Error('inventado'); } });
  igual('los otros cuatro siguen', pasos(rota).map((p) => p.id).join(), 'horas,anios,album,racha');
  const pocas = { totals: { min: 0, plays_valid: 0 }, years: [anio(2021, 1000, '2021-01-01', '2021-12-31', 365, [0])], top_artists_all_time: [], top_albums_all_time: [{ name: 'Disco', artist: 'A', min: 1, plays: 1 }] };
  ok(hayFuncion && pasos(pocas).length < 3, `el dato de prueba da menos de tres pasos (${pasos(pocas).length})`);
  const padre = doc.createElement('div'), host = padre.appendChild(doc.createElement('div'));
  doc.body.appendChild(padre);
  const r = ap.montarAperturaSiempre?.(host, ctxDe(pocas));
  ok(hayFuncion && r === null && host.innerHTML === '' && !padre.classList.contains('wr-con-apertura'), 'con menos de tres, no se monta nada');
  padre.remove();
  console.warn = warn;
}

const main = doc.body.appendChild(doc.createElement('main'));
const $ = (s) => doc.querySelector(s);
// Hasta que `render()` terminó, y no un rato fijo: el clic deja el spinner y el `import()` del módulo pasa por el loader. Con 15 ms
// a secas, el test daba verde solo y `null.innerHTML` en serie con otros.
const clic = async (s) => { const b = $(s); if (!b) return false; b.click(); for (let i = 0; i < 400 && !$('#wrapped-slide'); i++) await tick(); return true; };
const apertura = () => $('#wrapped-apertura').innerHTML;
// Con `getAttribute`: los selectores del doble parten por los espacios, y el texto del `aria-label` los lleva.
const etiqueta = () => $('#wrapped-apertura .wr-ap')?.getAttribute('aria-label');
const contarOyentes = () => ({ keydown: doc.oyentes.keydown?.length || 0, pointerdown: doc.oyentes.pointerdown?.length || 0, resize: oyentesVentana.resize?.length || 0 });

console.log('F. un año, con el HTML de v=361');
await render(main);
const shaDefecto = sha(apertura());
console.log(`  · sha defecto: ${shaDefecto}`);
igual('el año por defecto (2023) da el sha256 de d10e6a48', shaDefecto, SHA_V361.defecto);
ok(/aria-label="Recorrido del año 2023"/.test(apertura()), 'es el recorrido del año');
await clic('[data-year="2020"]');
const shaViejo = sha(apertura());
console.log(`  · sha viejo: ${shaViejo}`);
igual('el más viejo (2020) da el sha256 de d10e6a48', shaViejo, SHA_V361.viejo);

console.log('E. montado');
const vivosAntes = observadoresVivos;
await clic('[data-siempre]');
igual('aria-label', etiqueta(), 'Recorrido de todo tu historial');
igual('con sus cinco pasos', doc.querySelectorAll('#wrapped-apertura .wr-ap-paso').map((p) => p.dataset.id).join(), 'horas,anios,artista,album,racha');
ok($('#wrapped-slide').classList.contains('wr-con-apertura'), 'wr-con-apertura en el contenedor (`#wrapped-slide`)');
ok($('#wrapped-apertura .wr-ap')?.classList.contains('js'), 'armado: lleva `.js`');
ok(!$('#wrapped-apertura .wr-ap-saltar')?.hidden && !!$('#wrapped-apertura .wr-ap-saltar'), '«Saltar al resumen ↓» a la vista');
ok(!$('#wrapped-apertura .wr-ap-prog')?.hidden && !!$('#wrapped-apertura .wr-ap-prog'), 'los puntos de avance');
igual('Y ahora, todo junto', $('#wrapped-apertura .wr-ap-cierre')?.textContent.trim(), 'Y ahora, todo junto.');
igual('un ⓘ en las horas y otro en los años', doc.querySelectorAll('#wrapped-apertura .wr-ap-info').length, 2);
ok(!$('#wrapped-apertura .wr-ap-cal') && !$('#wrapped-apertura .wr-ap-lienzo'), 'ni calendario ni lienzo de puntos');
ok($('#wrapped-alltime .wrapped-hero-year')?.textContent === 'DE SIEMPRE', 'debajo, «DE SIEMPRE»');
igual('los observadores del año se fueron y están los de «Siempre», los mismos en número', observadoresVivos, vivosAntes);

console.log('F. volver a un año');
await clic('[data-year="2023"]');
igual('de «Siempre» al año por defecto: el sha256 de v=361', sha(apertura()), SHA_V361.defecto);
igual('el de «Siempre» ya no está', etiqueta(), 'Recorrido del año 2023');
await clic('[data-siempre]');
await clic('[data-year="2020"]');
igual('de «Siempre» al más viejo: el sha256 de v=361', sha(apertura()), SHA_V361.viejo);

console.log('G. los oyentes');
{
  const uno = contarOyentes();
  for (let i = 0; i < 5; i++) { await clic('[data-siempre]'); await clic('[data-year="2020"]'); }
  const seis = contarOyentes();
  igual('cinco idas y vueltas no suman oyentes de `document` ni de `window`', JSON.stringify(seis), JSON.stringify(uno));
  await clic('[data-siempre]');
  ok(hayFuncion && contarOyentes().resize === 1, 'con «Siempre» montado, un solo `resize`');
  igual('con «Siempre» montado, un solo `keydown`', contarOyentes().keydown, 1);
  igual('con «Siempre» montado, un solo `pointerdown`', contarOyentes().pointerdown, 1);
  doc.dispatchEvent({ type: 'routeteardown' });
  igual('al salir de la ruta, 0 de `document` y de `window`', JSON.stringify(contarOyentes()), JSON.stringify({ keydown: 0, pointerdown: 0, resize: 0 }));
  igual('y 0 observadores vivos', observadoresVivos, 0);
}

console.log('I. con las animaciones en «nunca»');
anima = false;
await render(main);
await tick();
if ($('[data-siempre]') && !$('[data-siempre]').classList.contains('active')) await clic('[data-siempre]');
ok(hayFuncion && !!$('#wrapped-apertura .wr-ap') && !$('#wrapped-apertura .wr-ap').classList.contains('js'), 'el recorrido sin `.js`: la lista quieta');
ok(!$('#wrapped-slide').classList.contains('wr-con-apertura'), 'sin wr-con-apertura');
igual('el total, con el formateador de wrapped.js (4.600 min = 76h 40m)', $('#wrapped-apertura .wr-ap-paso[data-id="horas"] .wr-ap-dato .wr-ap-num')?.textContent, '76h 40m');
igual('la racha, puesta', $('#wrapped-apertura .wr-ap-paso[data-id="racha"] .wr-ap-dato .wr-ap-num')?.textContent, '7');
ok(doc.querySelectorAll('#wrapped-apertura .wr-ap-paso[data-id="anios"] .wr-ap-mes-val .wr-ap-num').map((n) => n.textContent).join() === '8,17,50,2', 'las horas de cada barra, puestas (500, 1.000, 3.000 y 100 minutos)');

console.log('H. lo que no se dice');
{
  // «Saltar al resumen ↓» lo pide el encargo: el botón no entra, y por eso se mira el texto de los PASOS.
  const texto = doc.querySelectorAll('#wrapped-apertura .wr-ap-paso').map((p) => p.textContent).join(' ');
  ok(hayFuncion && texto.length > 100, `hay texto que mirar (${texto.length} caracteres)`);
  ok(!/\bde\s+[\d.]+\s+d[ií]as/i.test(texto), 'ningún «de N días»');
  ok(!/salt|skip/i.test(texto), 'ningún «saltos», «salt» ni «skip»');
}

console.log('J. una pestaña con el módulo viejo en caché');
{
  const fuente = readFileSync(`${SRC}/js/features/wrapped.js`, 'utf8');
  const trozo = fuente.slice(fuente.indexOf('function montarApertura(mod)'), fuente.indexOf('// ── El cambio de año, un deslizamiento'));
  const armar = new Function('document', 'stats', 'selectedYear', 'SIEMPRE', 'MESES', 'MESES_LARGOS', 'fmtMinutes', 'fmtDia', 'daysCovered', `${trozo}; return montarApertura;`);
  const hueco = { innerHTML: '' };
  const llamadas = [];
  const montar = armar({ getElementById: () => hueco }, { years: [] }, 'siempre', 'siempre', [], [], fmtPrueba, (s) => s, () => 0);
  montar({ montarApertura: (h, c) => llamadas.push(['año', c]) });
  ok(llamadas.length === 1 && llamadas[0][1] === null, 'sin montarAperturaSiempre, montarApertura(host, null): como hasta v=361');
  llamadas.length = 0;
  montar({ montarApertura: (h, c) => llamadas.push(['año', c]), montarAperturaSiempre: (h, c) => llamadas.push(['siempre', c]) });
  ok(llamadas.length === 1 && llamadas[0][0] === 'siempre' && !!llamadas[0][1]?.stats && !('y' in llamadas[0][1]), 'con ella, montarAperturaSiempre con contexto y sin `y`');
}

console.log(mal ? `${mal} fallos de ${bien + mal}` : `OK — ${bien} asserts`);
process.exit(mal ? 1 : 0);
