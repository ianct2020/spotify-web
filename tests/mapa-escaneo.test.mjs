// tests/mapa-escaneo.test.mjs — el bucle del escaneo de `#mapa` (v=304, tanda 52)
//
// `util/mapa-escaneo.js` es el bucle que le pregunta a MusicBrainz, con la red,
// el reloj, el guardado y el candado INYECTADOS. Acá corre en Node contra un
// MusicBrainz y un reloj de mentira, sin navegador y sin red.
//
// Las cuatro obligaciones del escaneo (encargo de la tanda 52), y cómo se vigilan:
//   1. En orden de minutos, pintando a medida que llega → `onArtista` se llama
//      por cada artista apenas queda resuelto, en el orden del universo.
//   2. Cacheado y retomable → lo ya guardado no se vuelve a pedir: ni el
//      artista, ni un área que traigan veinte artistas.
//   3. Sobrevive a los 503 → un 503 NUNCA se guarda, NUNCA salta al artista
//      (se reintenta el mismo pedido, 10/20/40/80 s), a los 8 fallos seguidos se
//      pausa con lo hecho guardado, y un 200 vuelve el contador a 0. Un 4xx que
//      no es 429 es del artista: «no se pudo consultar», sin guardar, y se sigue.
//   4. El ritmo → nunca dos comienzos a menos de 1.200 ms, y nunca dos esperas
//      seguidas sin una petición en el medio (Chrome espacia los `setTimeout`
//      encadenados de una pestaña oculta hasta uno por minuto).
//
// 🔴 Todo INVENTADO: artistas, áreas, ids, respuestas.
//
// Correr con: node tests/mapa-escaneo.test.mjs

import * as E from '../src/js/util/mapa-escaneo.js';
import * as P from '../src/js/util/mapa-paises.js';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── El MusicBrainz de mentira ────────────────────────────────────────────────
//
// `artistas`: nombre → { candidatos, grabacion: [ids] }. `areas`: id → respuesta.
// `fallos`: url → lista de códigos a devolver ANTES de contestar bien (503, 429,
// 'red' para un corte, o 400 para siempre si es `porSiempre`).
function crearMB({ artistas = {}, areas = {}, fallos = {}, porSiempre = {}, alPedir = null } = {}) {
  const llamadas = [];
  const restantes = Object.fromEntries(Object.entries(fallos).map(([u, l]) => [u, [...l]]));
  async function pedir(url, { signal } = {}) {
    llamadas.push(url);
    if (alPedir) await alPedir(url, llamadas.length);
    if (signal?.aborted) { const e = new Error('abortado'); e.name = 'AbortError'; throw e; }
    if (porSiempre[url]) return { status: porSiempre[url], datos: null };
    const cola = restantes[url];
    if (cola && cola.length) {
      const c = cola.shift();
      if (c === 'red') throw new TypeError('Failed to fetch');
      return { status: c, datos: null };
    }
    const u = new URL(url);
    if (u.pathname.startsWith('/ws/2/area/')) {
      const id = u.pathname.split('/').pop();
      return areas[id] ? { status: 200, datos: areas[id] } : { status: 404, datos: null };
    }
    const q = u.searchParams.get('query');
    if (u.pathname === '/ws/2/artist/') {
      // v=307: el respaldo (`artist:"n" OR alias:"n"`) contesta `respaldo` (si no
      // hay, lo mismo que la búsqueda de siempre). Va ANTES que la otra: la regex
      // de la de siempre, codiciosa, también «encaja» con esta.
      const conAlias = q.match(/^artist:"(.*)" OR alias:"(.*)"$/);
      if (conAlias) {
        const nombre = conAlias[1].replace(/\\(.)/g, '$1');
        return { status: 200, datos: { artists: artistas[nombre]?.respaldo ?? artistas[nombre]?.candidatos ?? [] } };
      }
      const nombre = q.match(/^artist:"(.*)"$/)[1].replace(/\\(.)/g, '$1');
      return { status: 200, datos: { artists: artistas[nombre]?.candidatos || [] } };
    }
    if (u.pathname === '/ws/2/recording/') {
      const nombre = q.match(/ AND artist:"(.*)"$/)[1].replace(/\\(.)/g, '$1');
      const ids = artistas[nombre]?.grabacion || [];
      return { status: 200, datos: { recordings: ids.map(id => ({ 'artist-credit': [{ artist: { id } }] })) } };
    }
    return { status: 404, datos: null };
  }
  return { pedir, llamadas };
}

// El reloj de mentira: `esperar` adelanta la hora y anota. Nada duerme de verdad.
function crearReloj() {
  const r = { t: 1_000_000, esperas: [], eventos: [] };
  r.ahora = () => r.t;
  r.esperar = async (ms) => { r.esperas.push(ms); r.eventos.push('esperar'); r.t += ms; };
  return r;
}

// Un escaneo entero con dobles. Devuelve todo lo que hace falta mirar.
async function correr({ lista, mb, artistas = new Map(), areas = new Map(), signal, saltar, alGuardar } = {}) {
  const reloj = crearReloj();
  const comienzos = [];
  const guardadosArtista = [], guardadosArea = [];
  const pedirConReloj = async (url, o) => {
    comienzos.push(reloj.t);
    reloj.eventos.push('pedir');
    return mb.pedir(url, o);
  };
  const resueltos = [], fallidos = [], peticiones = [];
  const res = await E.escanear({
    lista, artistas, areas, reloj, signal, saltar,
    pedir: pedirConReloj,
    guardarArtista: async (nombre, reg) => { guardadosArtista.push([nombre, structuredClone(reg)]); reloj.eventos.push('guardar'); alGuardar?.(nombre, reg); },
    guardarArea: async (id, a) => { guardadosArea.push([id, a]); reloj.eventos.push('guardar'); },
    onArtista: (nombre, estado) => (estado === 'resuelto' ? resueltos : fallidos).push(nombre),
    onPeticion: (p) => peticiones.push(p),
  });
  return { res, reloj, comienzos, guardadosArtista, guardadosArea, resueltos, fallidos, peticiones, artistas, areas };
}

const T = (min) => [1, min, 2020, 2020, [], '2020-01-01'];
const tema = (t, min = 1) => [t, 1, min, 'id'];
const cand = (id, name, extra = {}) => ({ id, name, 'sort-name': name, score: 100, ...extra });
const urlB = (n) => E.urlBusqueda(n);
// v=307: ¿esta URL es el respaldo? (por la consulta: así no depende de que
// `urlBusquedaConAlias` exista, y contra el código de v=306 da siempre false).
const esRespaldo = (u) => u.includes('/artist/') && / OR alias:/.test(new URL(u).searchParams.get('query') || '');
const esBusqueda = (u) => u.includes('/artist/') && !esRespaldo(u);

// ── 1. El orden ──────────────────────────────────────────────────────────────
console.log('El orden del escaneo');
{
  const totals = { 'Cobre': T(30), 'Ámbar': T(50), 'Bronce': T(50), 'acero': T(50), 'Plomo': T(5) };
  const artists = Object.fromEntries(Object.keys(totals).map(n => [n, [tema('Tema de ' + n)]]));
  const lista = P.universo(totals, artists);
  const mb = crearMB({ artistas: Object.fromEntries(Object.keys(totals).map(n => [n, { candidatos: [] }])) });
  const r = await correr({ lista, mb });
  // v=307: solo la búsqueda de siempre (los cuatro dan sin-candidato y piden
  // además el respaldo, que tiene su propia sección).
  const buscados = mb.llamadas.filter(esBusqueda).map(u => new URL(u).searchParams.get('query'));
  ok(igual(buscados, ['artist:"Bronce"', 'artist:"acero"', 'artist:"Ámbar"', 'artist:"Cobre"']),
    'minutos descendente y, a igualdad, por nombre (comparación simple); los < 10 min no se piden', JSON.stringify(buscados));
  ok(igual(r.resueltos, ['Bronce', 'acero', 'Ámbar', 'Cobre']), 'onArtista llega por cada uno, en el mismo orden, apenas se resuelve');
  ok(r.res.motivo === 'completo', 'termina «completo»');
}

// ── 2. Las URLs son las de la medición de la 51 ──────────────────────────────
console.log('\nLas peticiones, las mismas que la medición de la 51');
{
  ok(E.urlBusqueda('Ana "La" B') === 'https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent('artist:"Ana \\"La\\" B"') + '&limit=10&fmt=json',
    'búsqueda: limit=10, fmt=json, la consulta de mb-pais', E.urlBusqueda('Ana "La" B'));
  ok(E.urlGrabacion('Canción (Remix) - Edit', 'Ana') === 'https://musicbrainz.org/ws/2/recording/?query=' + encodeURIComponent('recording:"Canción" AND artist:"Ana"') + '&limit=25&fmt=json',
    'grabación: título limpio, limit=25');
  ok(E.urlArea('a-1') === 'https://musicbrainz.org/ws/2/area/a-1?inc=area-rels&fmt=json', 'área: inc=area-rels');
}

// ── 3. sin-candidato SÍ se guarda ────────────────────────────────────────────
console.log('\n«Pregunté y no hay» se guarda');
{
  const lista = P.universo({ 'Nadie Así': T(20) }, { 'Nadie Así': [tema('x')] });
  const mb = crearMB({ artistas: { 'Nadie Así': { candidatos: [cand('z', 'Otro Nombre', { country: 'AR' })] } } });
  const r = await correr({ lista, mb });
  // v=307 (tanda 55): hasta v=306 esto afirmaba «se guarda 1 vez» y «una sola
  // petición». Ahora un sin-candidato pide además el respaldo: se guarda 2 veces
  // (la búsqueda y el respaldo) y son 2 peticiones, ninguna de grabación.
  ok(r.guardadosArtista.length === 2 && r.guardadosArtista.every(([n]) => n === 'Nadie Así'), `el sin-candidato queda guardado (es un resultado), con su respaldo (${r.guardadosArtista.length} guardados)`);
  ok(P.proximoPaso(lista[0], r.artistas.get('Nadie Así'), r.areas).clase === 'sin-candidato', 'y lo guardado da sin-candidato');
  ok(mb.llamadas.length === 2 && esBusqueda(mb.llamadas[0]) && esRespaldo(mb.llamadas[1]), `dos peticiones, la búsqueda y el respaldo, y ninguna grabación (${mb.llamadas.length})`);
}

// ── 4. Retomar: lo guardado no se vuelve a pedir ─────────────────────────────
console.log('\nRetomar');
{
  // 6 artistas; los 3 primeros ya están en la caché, terminados.
  const nombres = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'];
  const totals = Object.fromEntries(nombres.map((n, i) => [n, T(100 - i)]));
  const artists = Object.fromEntries(nombres.map(n => [n, [tema('T ' + n)]]));
  const lista = P.universo(totals, artists);
  const mbArt = Object.fromEntries(nombres.map(n => [n, { candidatos: [cand('id-' + n, n, { country: 'AR' })], grabacion: ['id-' + n] }]));
  const mb1 = crearMB({ artistas: mbArt });
  const primero = await correr({ lista: lista.slice(0, 3), mb: mb1 });
  ok(primero.res.motivo === 'completo' && mb1.llamadas.length === 6, 'la primera pasada hace sus 6 (búsqueda + grabación × 3)');

  const mb2 = crearMB({ artistas: mbArt });
  const r = await correr({ lista, mb: mb2, artistas: primero.artistas, areas: primero.areas });
  const porLosViejos = mb2.llamadas.filter(u => ['Uno', 'Dos', 'Tres'].some(n => u.includes(encodeURIComponent(`"${n}"`))));
  ok(porLosViejos.length === 0, 'con 3 en la caché, 0 peticiones por ellos', porLosViejos.join(' · '));
  ok(mb2.llamadas.length === 6, `y 6 por los 3 que faltaban (${mb2.llamadas.length})`);
  ok(igual(r.resueltos, ['Cuatro', 'Cinco', 'Seis']), 'onArtista solo por los que se resolvieron ahora');

  // A medias: búsqueda guardada, grabación no. Retomar pide SOLO la grabación.
  const mb3 = crearMB({ artistas: mbArt });
  const aMedias = new Map([['Uno', { v: 1, nombre: 'Uno', consultado: 'x', candidatos: P.recortarArtistas({ artists: mbArt.Uno.candidatos }), grabacion: null }]]);
  await correr({ lista: lista.slice(0, 1), mb: mb3, artistas: aMedias });
  ok(mb3.llamadas.length === 1 && mb3.llamadas[0].includes('/recording/'), 'un artista a medias (falta la grabación): solo se pide lo que falta', mb3.llamadas.join(' · '));
}

// ── 5. Un área se pide una sola vez, la traigan veinte artistas ──────────────
console.log('\nLas áreas, una vez por área');
{
  const CIUDAD = 'c1', PROV = 'p1';
  const areas = {
    [CIUDAD]: { id: CIUDAD, type: 'City', relations: [{ type: 'part of', direction: 'backward', area: { id: PROV, type: 'Subdivision' } }] },
    [PROV]: { id: PROV, type: 'Subdivision', relations: [{ type: 'part of', direction: 'backward', area: { id: 'pais', type: 'Country', 'iso-3166-1-codes': ['UY'] } }] },
  };
  const nombres = Array.from({ length: 20 }, (_, i) => `Banda ${String(i).padStart(2, '0')}`);
  const totals = Object.fromEntries(nombres.map((n, i) => [n, T(200 - i)]));
  const artists = Object.fromEntries(nombres.map(n => [n, [tema('T')]]));
  const mbArt = Object.fromEntries(nombres.map(n => [n, { candidatos: [cand('id-' + n, n, { area: { id: CIUDAD, name: 'Ciudad', type: 'City' } })], grabacion: ['id-' + n] }]));
  const mb = crearMB({ artistas: mbArt, areas });
  const r = await correr({ lista: P.universo(totals, artists), mb });
  const deArea = mb.llamadas.filter(u => u.includes('/area/'));
  ok(deArea.length === 2, `20 artistas con la misma ciudad: 2 lookups de área (la ciudad y su provincia), no 40 (${deArea.length})`);
  ok(r.guardadosArea.length === 2, 'y cada área se guarda una vez');
  ok(nombres.every(n => P.proximoPaso({ nombre: n, tema: 'T' }, r.artistas.get(n), r.areas).pais === 'UY'), 'los 20 con país del área');

  // Y con las áreas YA en la caché, 0 lookups.
  const otra = { 'Otra Banda': { candidatos: [cand('id-otra', 'Otra Banda', { area: { id: CIUDAD, name: 'Ciudad', type: 'City' } })], grabacion: ['id-otra'] } };
  const mb2 = crearMB({ artistas: otra, areas });
  const r2 = await correr({ lista: P.universo({ 'Otra Banda': T(50) }, { 'Otra Banda': [tema('T')] }), mb: mb2, areas: r.areas });
  ok(mb2.llamadas.length === 2 && !mb2.llamadas.some(u => u.includes('/area/')), `un área ya guardada no se vuelve a pedir en otra sesión (${mb2.llamadas.length} peticiones: búsqueda y grabación)`);
  ok(P.proximoPaso({ nombre: 'Otra Banda', tema: 'T' }, r2.artistas.get('Otra Banda'), r2.areas).pais === 'UY', 'y el artista nuevo sale con el país de esa área');
}

// ── 6. Los 503 ───────────────────────────────────────────────────────────────
console.log('\nLos 503');
{
  const lista = P.universo({ 'Faro': T(90), 'Muelle': T(80) }, { 'Faro': [tema('Luz')], 'Muelle': [tema('Agua')] });
  const mbArt = {
    'Faro': { candidatos: [cand('f1', 'Faro', { country: 'CL' })], grabacion: ['f1'] },
    'Muelle': { candidatos: [cand('m1', 'Muelle', { country: 'PE' })], grabacion: ['m1'] },
  };
  const mb = crearMB({ artistas: mbArt, fallos: { [urlB('Faro')]: [503, 503, 'red'] } });
  const r = await correr({ lista, mb });
  ok(mb.llamadas.filter(u => u === urlB('Faro')).length === 4, 'el mismo pedido se reintenta (tres fallos y después el bueno)');
  ok(r.guardadosArtista.filter(([n]) => n === 'Faro').length === 2, 'Faro se guarda 2 veces (búsqueda y grabación) y NINGUNA por un 503');
  ok(r.guardadosArtista.every(([, reg]) => reg.candidatos.length === 1), 'nada guardado con candidatos vacíos');
  ok(P.proximoPaso(lista[0], r.artistas.get('Faro'), r.areas).categoria === 'pais', 'el artista no se salta: termina con su país');
  const esperasLargas = r.reloj.esperas.filter(ms => ms >= 10_000);
  ok(igual(esperasLargas, [10_000, 20_000, 40_000]), `las esperas tras fallos: 10, 20, 40 s (${esperasLargas.join(', ')})`);
  ok(r.res.motivo === 'completo' && r.resueltos.includes('Muelle'), 'y el escaneo termina con el siguiente');
  ok(r.peticiones.filter(p => p.status === 503).length === 2 && r.peticiones.filter(p => p.status === 'red').length === 1, 'onPeticion cuenta los dos 503 y el corte');
  ok(igual(E.ESPERAS_MS, [10_000, 20_000, 40_000, 80_000]) && E.esperaTrasFallo(5) === 80_000 && E.esperaTrasFallo(9) === 80_000, 'de ahí en adelante, 80 s fijos');
}
{
  // Ocho fallos seguidos → pausa, con lo hecho guardado.
  const lista = P.universo({ 'Isla': T(90), 'Cabo': T(80) }, { 'Isla': [tema('a')], 'Cabo': [tema('b')] });
  const mbArt = { 'Isla': { candidatos: [cand('i', 'Isla', { country: 'AR' })], grabacion: ['i'] }, 'Cabo': { candidatos: [] } };
  const mb = crearMB({ artistas: mbArt, fallos: { [urlB('Cabo')]: Array(20).fill(503) } });
  const r = await correr({ lista, mb });
  ok(r.res.motivo === 'pausa', `a los ocho fallos seguidos se pausa solo (motivo «${r.res.motivo}»)`);
  ok(mb.llamadas.filter(u => u === urlB('Cabo')).length === 8, 'exactamente 8 intentos, ni uno más');
  ok(r.artistas.has('Isla') && !r.artistas.has('Cabo'), 'lo ya resuelto queda guardado; el del 503 no');
  ok(igual(r.reloj.esperas.filter(ms => ms >= 10_000), [10_000, 20_000, 40_000, 80_000, 80_000, 80_000, 80_000]),
    'esperas 10/20/40/80/80/80/80 y la pausa sin esperar más', r.reloj.esperas.join(','));
}
{
  // 7 fallos, un 200, 7 fallos, un 200 → no pausa: el 200 vuelve el contador a 0.
  const lista = P.universo({ 'Roca': T(90), 'Arena': T(80) }, {});
  const mbArt = { 'Roca': { candidatos: [] }, 'Arena': { candidatos: [] } };
  const mb = crearMB({ artistas: mbArt, fallos: { [urlB('Roca')]: Array(7).fill(503), [urlB('Arena')]: Array(7).fill(429) } });
  const r = await correr({ lista, mb });
  ok(r.res.motivo === 'completo', 'después de un 200 el contador vuelve a 0 (7 + 200 + 7 + 200 no pausa)');
  ok(r.artistas.has('Roca') && r.artistas.has('Arena'), 'los dos guardados');
  ok(r.reloj.esperas.filter(ms => ms >= 10_000)[7] === 10_000, 'y la espera también vuelve a empezar en 10 s con el pedido siguiente');
}
{
  // Un 400: el artista queda «no se pudo consultar», sin guardar, y se sigue.
  const lista = P.universo({ 'Raro': T(90), 'Normal': T(80) }, {});
  const mbArt = { 'Raro': { candidatos: [] }, 'Normal': { candidatos: [cand('n', 'Normal', { country: 'ES' }), cand('n2', 'Normal', { country: 'ES' })] } };
  const mb = crearMB({ artistas: mbArt, porSiempre: { [urlB('Raro')]: 400 } });
  const r = await correr({ lista, mb });
  ok(mb.llamadas.filter(u => u === urlB('Raro')).length === 1, 'un 400 no se reintenta');
  ok(!r.artistas.has('Raro') && r.guardadosArtista.every(([n]) => n !== 'Raro'), 'y no se guarda');
  ok(igual(r.fallidos, ['Raro']) && r.res.noSePudo.includes('Raro'), 'queda «no se pudo consultar» en esta sesión');
  ok(r.resueltos.includes('Normal') && r.res.motivo === 'completo', 'y el escaneo sigue con el siguiente');
  ok(!r.reloj.esperas.some(ms => ms >= 10_000), 'sin espera larga: no es culpa de MusicBrainz');
}
{
  // Cortar justo después de un 503: nada guardado por ese artista.
  const ctrl = new AbortController();
  const lista = P.universo({ 'Bruma': T(90) }, {});
  const mb = crearMB({ artistas: { 'Bruma': { candidatos: [] } }, fallos: { [urlB('Bruma')]: [503, 503] }, alPedir: (u, n) => { if (n === 2) ctrl.abort(); } });
  const r = await correr({ lista, mb, signal: ctrl.signal });
  ok(r.res.motivo === 'parado', `parar a mitad devuelve «parado» (${r.res.motivo})`);
  ok(!r.artistas.has('Bruma') && r.guardadosArtista.length === 0, 'y el 503 no dejó nada guardado');
}

// ── 7. El ritmo ──────────────────────────────────────────────────────────────
console.log('\nEl ritmo');
{
  const nombres = ['Ala', 'Bote', 'Casa', 'Duna', 'Eco'];
  const totals = Object.fromEntries(nombres.map((n, i) => [n, T(100 - i)]));
  const artists = Object.fromEntries(nombres.map(n => [n, [tema('x')]]));
  const mbArt = Object.fromEntries(nombres.map(n => [n, { candidatos: [cand('i' + n, n, { country: 'AR' })], grabacion: ['i' + n] }]));
  const mb = crearMB({ artistas: mbArt, fallos: { [urlB('Casa')]: [503] } });
  const r = await correr({ lista: P.universo(totals, artists), mb });
  const difs = r.comienzos.slice(1).map((t, i) => t - r.comienzos[i]);
  ok(r.comienzos.length === 11, `11 comienzos (5 × 2 + 1 reintento) (${r.comienzos.length})`);
  ok(difs.every(d => d >= 1200), `nunca dos comienzos a menos de 1.200 ms (mínimo ${Math.min(...difs)} ms)`);
  ok(difs.filter(d => d === 1200).length >= 8, 'y sin esperar de más: casi todos a 1.200 justos');
  ok(E.INTERVALO_MS === 1200, 'el mínimo es 1.200 ms');
  const dobles = r.reloj.eventos.some((e, i) => e === 'esperar' && r.reloj.eventos[i + 1] === 'esperar');
  ok(!dobles, 'nunca dos esperas seguidas sin una petición en el medio', r.reloj.eventos.join(' '));
  ok(r.reloj.eventos.every((e, i) => e !== 'esperar' || r.reloj.eventos[i + 1] === 'pedir'), 'cada espera va seguida de una petición');
}

// ── 8. Se guarda ANTES de la petición siguiente ──────────────────────────────
console.log('\nSe guarda antes de pedir lo siguiente');
{
  const lista = P.universo({ 'Lago': T(90), 'Río': T(80) }, { 'Lago': [tema('x')], 'Río': [tema('y')] });
  const mbArt = { 'Lago': { candidatos: [cand('l', 'Lago', { country: 'AR' })], grabacion: ['l'] }, 'Río': { candidatos: [] } };
  const mb = crearMB({ artistas: mbArt });
  const r = await correr({ lista, mb });
  const ev = r.reloj.eventos.filter(e => e !== 'esperar');
  // v=307: «Río» da sin-candidato y pide el respaldo: 4 pares y no 3.
  ok(igual(ev, ['pedir', 'guardar', 'pedir', 'guardar', 'pedir', 'guardar', 'pedir', 'guardar']), 'pedir → guardar → pedir…: cada respuesta se guarda antes de la petición siguiente (el respaldo también)', ev.join(' '));
}

// ── 9. Saltar los que ya fallaron en esta sesión, y parar ────────────────────
console.log('\nSaltar y parar');
{
  const lista = P.universo({ 'Uno': T(90), 'Dos': T(80) }, {});
  // v=307: «Dos» pasa a tener un coincidente sin país (unico, 1 petición): con
  // `candidatos: []` pediría además el respaldo y el assert de abajo mediría eso
  // en vez de lo que mide, que `saltar` no pide nada.
  const mb = crearMB({ artistas: { 'Uno': { candidatos: [] }, 'Dos': { candidatos: [cand('d', 'Dos')] } } });
  await correr({ lista, mb, saltar: new Set(['Uno']) });
  ok(mb.llamadas.length === 1 && mb.llamadas[0] === urlB('Dos'), 'un artista en `saltar` no se pide');

  const ctrl = new AbortController();
  const mb2 = crearMB({ artistas: { 'Uno': { candidatos: [] }, 'Dos': { candidatos: [] } } });
  const r = await correr({ lista, mb: mb2, signal: ctrl.signal, alGuardar: () => ctrl.abort() });
  ok(r.res.motivo === 'parado' && mb2.llamadas.length === 1, 'con la señal abortada no sale ninguna petición más');
}

// ── 10. El candado: una sola búsqueda a la vez en el navegador ───────────────
console.log('\nEl candado');
{
  const ocupado = { request: async (nombre, opciones, fn) => fn(null) };
  let corrio = false;
  const r1 = await E.conCandado(ocupado, async () => { corrio = true; return 'x'; });
  ok(r1.candado === 'ocupado' && !corrio, 'si otra pestaña lo tiene, no escanea y lo dice');
  let pedido = null;
  const libre = { request: async (nombre, opciones, fn) => { pedido = { nombre, opciones }; return fn({ name: nombre }); } };
  const r2 = await E.conCandado(libre, async () => 'hecho');
  ok(r2.candado === 'propio' && r2.valor === 'hecho', 'si está libre, escanea');
  ok(pedido.nombre === 'fonoteca-mapa-escaneo' && pedido.opciones.ifAvailable === true, 'con el nombre y `ifAvailable: true`');
  const r3 = await E.conCandado(undefined, async () => 'sin');
  ok(r3.candado === 'sin-soporte' && r3.valor === 'sin', 'sin `navigator.locks`, escanea igual y lo dice');
}

// ── 10 bis. El alias de respaldo (v=307, tanda 55) ───────────────────────────
console.log('\nEl alias de respaldo');
{
  ok(typeof E.urlBusquedaConAlias === 'function' && E.urlBusquedaConAlias('Ana "La" B') === 'https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent('artist:"Ana \\"La\\" B" OR alias:"Ana \\"La\\" B"') + '&limit=10&fmt=json',
    'la URL del respaldo: el nombre O un alias, mismas comillas y escapes, limit=10, fmt=json', typeof E.urlBusquedaConAlias === 'function' ? E.urlBusquedaConAlias('Ana "La" B') : 'no existe');
  ok(E.urlBusqueda('Ana "La" B') === 'https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent('artist:"Ana \\"La\\" B"') + '&limit=10&fmt=json', 'y la de siempre no cambió (conservación)');

  // Un artista INVENTADO que cambió de nombre: Spotify dice «Faro Viejo»;
  // MusicBrainz lo tiene como «Faro Nuevo», con «Faro Viejo» de alias. La de
  // siempre trae solo un tributo; el respaldo, al de verdad.
  const tributo = cand('t1', 'Faro Viejo Tribute Band');
  const renombrado = cand('r1', 'Faro Nuevo', { country: 'UY', aliases: [{ name: 'Faro Viejo' }] });
  const mbArt = {
    'Faro Viejo': { candidatos: [tributo], respaldo: [tributo, renombrado], grabacion: ['r1'] },
    'Unica Banda': { candidatos: [cand('u1', 'Unica Banda', { country: 'PE' })], respaldo: [cand('zz', 'Unica Banda', { country: 'ZZ' })], grabacion: ['u1'] },
  };
  const lista = P.universo({ 'Faro Viejo': T(90), 'Unica Banda': T(80) }, { 'Faro Viejo': [tema('Señal')], 'Unica Banda': [tema('Otra')] });
  const mb = crearMB({ artistas: mbArt });
  const r = await correr({ lista, mb });
  const faro = mb.llamadas.filter((u) => u.includes(encodeURIComponent('"Faro Viejo"')));
  const unica = mb.llamadas.filter((u) => u.includes(encodeURIComponent('"Unica Banda"')));
  ok(faro.length === 3 && esBusqueda(faro[0]) && esRespaldo(faro[1]) && faro[2].includes('/recording/'),
    'tras una búsqueda sin-candidato pide el respaldo, y después la grabación (con el nombre que pidió Ian)', faro.map((u) => new URL(u).searchParams.get('query')).join(' · '));
  ok(faro[2] === E.urlGrabacion('Señal', 'Faro Viejo'), 'la grabación va con el nombre de Spotify, no con el de MusicBrainz');
  ok(!unica.some(esRespaldo) && unica.length === 2, `tras una búsqueda unico NUNCA pide el respaldo (${unica.length} peticiones: búsqueda y grabación)`);
  const p = P.proximoPaso(lista[0], r.artistas.get('Faro Viejo'), r.areas);
  ok(p.falta === null && p.categoria === 'pais' && p.pais === 'UY' && p.mbid === 'r1', 'y sale con su país (UY), corroborado', JSON.stringify(p));
  const q = P.proximoPaso(lista[1], r.artistas.get('Unica Banda'), r.areas);
  ok(q.pais === 'PE' && q.categoria === 'pais', 'el unico sale con el suyo (PE), no con el del respaldo que el doble tenía preparado (ZZ)');
  const reg = r.artistas.get('Faro Viejo');
  ok(Array.isArray(reg.respaldo) && reg.respaldo.length === 2 && igual(Object.keys(reg.respaldo[0]).sort(), Object.keys(P.recortarArtistas({ artists: [tributo] })[0]).sort()),
    'el registro guarda los candidatos del respaldo, recortados como los de la búsqueda', JSON.stringify(reg.respaldo));
  ok(r.artistas.get('Unica Banda').respaldo === null, 'el de la búsqueda unico guarda `respaldo: null` (no se pidió)');
  ok(r.guardadosArtista.filter(([n]) => n === 'Faro Viejo').length === 3, 'cada respuesta se guarda antes de la siguiente: búsqueda, respaldo y grabación (3 guardados)');

  // Un registro de v=304-306: sin-candidato y SIN el campo. «Seguir» pide SOLO el respaldo.
  const viejo = new Map([['Faro Viejo', { v: 1, nombre: 'Faro Viejo', consultado: 'x', candidatos: P.recortarArtistas({ artists: [tributo] }), grabacion: null }]]);
  const mb2 = crearMB({ artistas: mbArt });
  const r2 = await correr({ lista: lista.slice(0, 1), mb: mb2, artistas: viejo });
  ok(mb2.llamadas.length >= 1 && esRespaldo(mb2.llamadas[0]) && !mb2.llamadas.some(esBusqueda),
    `un registro viejo sin-candidato sin respaldo: pide SOLO el respaldo, 0 búsquedas repetidas (${mb2.llamadas.map((u) => (esRespaldo(u) ? 'respaldo' : esBusqueda(u) ? 'búsqueda' : 'otra')).join(', ')})`);
  ok(r2.artistas.get('Faro Viejo').consultado === 'x' && r2.artistas.get('Faro Viejo').candidatos.length === 1, 'y conserva su búsqueda tal cual (la fecha y los candidatos)');

  // Un 503 en el respaldo: se reintenta el MISMO pedido y nunca se guarda.
  const mb3 = crearMB({ artistas: mbArt, fallos: { [E.urlBusquedaConAlias?.('Faro Viejo') ?? 'x']: [503] } });
  const r3 = await correr({ lista: lista.slice(0, 1), mb: mb3 });
  ok(mb3.llamadas.filter(esRespaldo).length === 2 && r3.guardadosArtista.every(([, g]) => g.respaldo === null || g.respaldo.length === 2), 'un 503 en el respaldo: se reintenta y no se guarda nada por el 503');
}

// ── 11. El ritmo medido y lo que falta (estimación) ──────────────────────────
console.log('\nEl ritmo medido');
{
  const ahora = 600_000;
  const comienzos = [0, 60_000, 120_000, 430_000, 450_000, 500_000, 550_000, 599_000];
  ok(E.peticionesPorMinuto(comienzos, ahora, 180_000) === 5 / 3, 'peticiones por minuto de los últimos 3 minutos');
  ok(E.peticionesPorMinuto([], ahora) === null, 'sin peticiones, sin ritmo');
  // v=306 (tanda 54): la estimación ya no recibe los totales de la sesión
  // (`peticiones`, `artistasHechos`, `msTranscurridos`) sino lo ACUMULADO entre
  // cargas (`ritmo`: peticiones, artistas, y la suma de la duración de cada
  // artista y de sus cuadrados). Hasta v=305 este assert afirmaba «100
  // pendientes, 50 peticiones, 20 artistas, 100 s → ~250 peticiones, ~8 min»
  // (8,3 redondeado al más cercano). En v=306 afirmaba ~250 peticiones y 9
  // minutos (8,3 HACIA ARRIBA, por lo alto). v=307 (tanda 55): es un RANGO, y
  // afirma ~250 peticiones, entre 8 min (8,3 hacia ABAJO: la cota baja es la
  // media sola) y 15 min (8,3 + la racha entera de 6,5 min, hacia ARRIBA; sin
  // dispersión, el término de la σ es 0).
  const ritmo = { ...E.ritmoVacio(), peticiones: 50, artistas: 20, msArtistas: 100_000, msArtistas2: 20 * 5000 ** 2 };
  const est = E.estimarLoQueFalta({ pendientes: 100, ritmo });
  ok(est && est.peticiones === 250 && est.minutosBajo === 8 && est.minutosAlto === 15, `100 pendientes a 2,5 pet./artista y 5 s/artista, sin dispersión → ~250 peticiones, entre 8 y 15 min (${JSON.stringify(est)})`);
  // Hasta v=305: «sin ningún artista hecho en la sesión, no se estima». Sigue
  // valiendo (con lo acumulado), y desde v=306 hace falta un mínimo.
  ok(E.estimarLoQueFalta({ pendientes: 10, ritmo: { ...E.ritmoVacio(), peticiones: 3 } }) === null, 'sin ningún artista medido, no se estima');
}

// ── 12. Lo que falta: un RANGO (v=307, tanda 55; acumulado desde v=306) ───────
// Líneas de tiempo INVENTADAS (duración de cada artista, en ms), leídas «cada
// 5 s» como la pantalla. La condición de la tanda 55, más estricta que el 10 %
// de la 54 a propósito (es lo que promete un rango): desde la primera lectura
// que enseña un rango, la cota ALTA (en minutos, como se enseña) no queda NUNCA
// por debajo de lo que de verdad faltaba. La baja sí puede: es la cota baja.
console.log('\nLo que falta: un rango, con la racha sacada de las constantes');
// La racha, calculada ACÁ desde las dos constantes (no escrita a mano): lo más
// que puede costar una sola racha de fallos antes de que el escaneo se pause
// solo, o sea las esperas entre el primer fallo y el que dispara la pausa.
const rachaEsperada = Array.from({ length: E.FALLOS_PARA_PAUSAR - 1 }, (_, i) => E.ESPERAS_MS[Math.min(i + 1, E.ESPERAS_MS.length) - 1]).reduce((s, x) => s + x, 0);
{
  ok(E.RACHA_MS === rachaEsperada, `la racha es la suma de las esperas de ESPERAS_MS hasta la que dispara la pausa (FALLOS_PARA_PAUSAR = ${E.FALLOS_PARA_PAUSAR}): ${rachaEsperada / 1000} s (en el código: ${E.RACHA_MS / 1000} s)`);
  // Contra el bucle de verdad: una racha de FALLOS_PARA_PAUSAR − 1 fallos seguidos de un 200 espera EXACTAMENTE eso.
  const lista = P.universo({ 'Racha': T(90) }, {});
  const mb = crearMB({ artistas: { 'Racha': { candidatos: [cand('r', 'Racha')] } }, fallos: { [urlB('Racha')]: Array(E.FALLOS_PARA_PAUSAR - 1).fill(503) } });
  const r = await correr({ lista, mb });
  const esperado = r.reloj.esperas.filter((ms) => ms >= 10_000).reduce((s, x) => s + x, 0);
  ok(r.res.motivo === 'completo' && esperado === rachaEsperada, `y es lo que espera escanear() con la racha más larga que no pausa (${esperado / 1000} s: una racha de ${E.FALLOS_PARA_PAUSAR - 1} respuestas 503 y después un 200; ojo, «N fallos» en una línea lo lee el runner como un fallo)`);
  // La cota alta = la de v=306 (media·p + Z·σ·√(p + p²/n)) + la racha, hacia arriba.
  const ritmo = { ...E.ritmoVacio(), peticiones: 40, artistas: 10, msArtistas: 10 * 4000, msArtistas2: 5 * 1000 ** 2 + 5 * 7000 ** 2 };
  const n = 10, p = 30, media = 4000, sigma = Math.sqrt((ritmo.msArtistas2 - n * media * media) / (n - 1));
  const alto306 = media * p + E.Z_ESTIMACION * sigma * Math.sqrt(p + (p * p) / n);
  const est = E.estimarLoQueFalta({ pendientes: p, ritmo });
  ok(est?.minutosAlto === Math.ceil((alto306 + rachaEsperada) / 60_000) && est?.minutosBajo === Math.max(1, Math.floor(media * p / 60_000)),
    `cota baja = media·p hacia abajo (${est?.minutosBajo}), cota alta = lo de v=306 + la racha, hacia arriba (${est?.minutosAlto})`);
  ok(E.Z_ESTIMACION === 2 && E.MIN_ARTISTAS_ESTIMAR === 5, 'Z y el mínimo de artistas no cambian (2 y 5)');
}
{
  // El texto, en castellano de España, con las dos cotas.
  ok(typeof E.textoLoQueFalta === 'function' && E.textoLoQueFalta({ peticiones: 5259, minutosBajo: 207, minutosAlto: 313 }) === 'Quedan ~5259 peticiones: entre 3 horas y 27 min y 5 horas y 13 min, según cuántos 503 dé MusicBrainz.',
    'el texto enseña las DOS cotas', typeof E.textoLoQueFalta === 'function' ? E.textoLoQueFalta({ peticiones: 5259, minutosBajo: 207, minutosAlto: 313 }) : 'no existe');
  ok(typeof E.textoLoQueFalta === 'function' && E.textoLoQueFalta({ peticiones: 12, minutosBajo: 1, minutosAlto: 8 }) === 'Quedan ~12 peticiones: entre 1 min y 8 min, según cuántos 503 dé MusicBrainz.', 'con pocos minutos');
  ok(typeof E.textoLoQueFalta === 'function' && E.textoLoQueFalta({ peticiones: 300, minutosBajo: 60, minutosAlto: 120 }) === 'Quedan ~300 peticiones: entre 1 hora y 2 horas, según cuántos 503 dé MusicBrainz.', 'horas justas');
  ok(typeof E.textoLoQueFalta === 'function' && E.textoLoQueFalta({ peticiones: 4, minutosBajo: 7, minutosAlto: 7 }) === 'Quedan ~4 peticiones: 7 min, según cuántos 503 dé MusicBrainz.', 'si las dos cotas dan lo mismo, una sola');
  ok(typeof E.textoLoQueFalta === 'function' && E.textoLoQueFalta({ peticiones: 12345, minutosBajo: 61, minutosAlto: 1501 }).startsWith('Quedan ~12.345 peticiones: entre 1 hora y 1 min y 25 horas y 1 min'), 'con es-ES explícito (12.345: cinco cifras llevan separador)');
}
const RAPIDO = 2400, CON_503 = 25_000;   // un artista sin 503 (2 peticiones a 1,2 s) y uno con una ráfaga
function simular(duraciones, { recargaEn = null, petPorArtista = 2 } = {}) {
  // `recargaEn`: tras ese artista la página se recarga: lo acumulado sale de lo
  // GUARDADO (JSON, como IndexedDB), por `ritmoDesde`, igual que en la vista.
  const fines = [];
  let t = 0;
  for (const d of duraciones) fines.push((t += d));
  const total = t, n = duraciones.length;
  let ritmo = E.ritmoVacio(), hechos = 0;
  const lecturas = [];
  for (let ahora = 5000; ahora < total; ahora += 5000) {
    while (hechos < n && fines[hechos] <= ahora) {
      for (let i = 0; i < petPorArtista; i++) ritmo = E.sumarPeticion(ritmo, 200);
      ritmo = E.sumarArtista(ritmo, duraciones[hechos]);
      hechos++;
      if (hechos === recargaEn) ritmo = E.ritmoDesde(JSON.parse(JSON.stringify(ritmo)));
    }
    const est = E.estimarLoQueFalta({ pendientes: n - hechos, ritmo });
    // `v306`: el número de v=306, con la MISMA fórmula escrita acá (media·p + Z·σ·√(p + p²/n), hacia arriba).
    let v306 = null;
    if (ritmo.artistas >= 5 && n - hechos > 0) {
      const m = ritmo.msArtistas / ritmo.artistas, va = Math.max(0, (ritmo.msArtistas2 - ritmo.artistas * m * m) / (ritmo.artistas - 1)), q = n - hechos;
      v306 = Math.max(1, Math.ceil((m * q + 2 * Math.sqrt(va * (q + q * q / ritmo.artistas))) / 60_000));
    }
    lecturas.push({ ahora, hechos, bajo: est ? est.minutosBajo ?? null : null, alto: est ? est.minutosAlto ?? null : null, v306, real: (total - ahora) / 60_000 });
  }
  return lecturas;
}
const conRango = (lecturas) => lecturas.filter((l) => l.alto !== null && l.alto !== undefined);
const altoDebajo = (lecturas) => conRango(lecturas).filter((l) => l.alto < l.real);
// 150 artistas con 503 repartidos por toda la búsqueda, con un patrón fijo (el 12 %).
const conRafagas = Array.from({ length: 150 }, (_, i) => ((i * 53 + 7) % 100 < 12 ? CON_503 : RAPIDO));
{
  // La forma del problema que encontró la tanda 54, con números INVENTADOS: un
  // tramo tranquilo largo (la media baja y la σ es casi 0) y una racha de 503 al
  // final, cuando ya quedan pocos. Ninguna dispersión medida la ve venir.
  const rachaFinal = [...Array(34).fill(RAPIDO), ...Array(6).fill(16_000)];
  const l = simular(rachaFinal);
  const v306Debajo = l.filter((x) => x.v306 !== null && x.v306 < x.real);
  ok(v306Debajo.length > 0, `con una racha al final, el número de v=306 queda por debajo de lo que faltaba (${v306Debajo.length} lecturas; la peor: ${v306Debajo[0]?.v306} min con ${v306Debajo[0]?.real.toFixed(2)} por delante) — es el defecto, no un assert del código nuevo`);
  ok(conRango(l).length > 0 && altoDebajo(l).length === 0, `y la cota alta de v=307 no queda por debajo NUNCA (${altoDebajo(l).length} de ${conRango(l).length})`,
    altoDebajo(l).slice(0, 3).map((x) => `a ${x.ahora / 1000} s: ${x.alto} min y faltaban ${x.real.toFixed(2)}`).join(' · '));
}
{
  const l = simular(conRafagas);
  ok(conRango(l).length > 0 && altoDebajo(l).length === 0,
    `con 503 a mitad: la cota alta nunca por debajo de lo que faltaba (${altoDebajo(l).length} de ${conRango(l).length})`,
    altoDebajo(l).slice(0, 3).map((x) => `a ${x.ahora / 1000} s: ${x.alto} min y faltaban ${x.real.toFixed(2)}`).join(' · '));
  ok(conRango(l).every((x) => Number.isInteger(x.alto) && Number.isInteger(x.bajo)), 'los minutos se enseñan enteros');
  ok(conRango(l).every((x) => x.bajo <= x.alto && x.bajo >= 1), 'la cota baja nunca pasa a la alta (y es al menos 1 min)', conRango(l).filter((x) => x.bajo > x.alto).slice(0, 2).map((x) => JSON.stringify(x)).join(' · '));
}
{
  // Una recarga a mitad: lo acumulado sigue (no vuelve a «se estimará…» ni baja a la mitad).
  const l = simular(conRafagas, { recargaEn: 60 });
  const antes = conRango(l).filter((x) => x.hechos < 60).at(-1);
  const despues = l.find((x) => x.hechos >= 60);
  ok(despues && despues.alto !== null && despues.bajo !== null, `justo después de recargar sigue enseñando el rango (${despues?.bajo}-${despues?.alto} min), no «se estimará…»`);
  ok(antes && despues && despues.alto >= 0.9 * antes.alto * (despues.real / antes.real), `y no baja de golpe: ${antes?.alto} min antes y ${despues?.alto} después, con ${antes?.real.toFixed(1)} y ${despues?.real.toFixed(1)} min de verdad por delante`);
  ok(altoDebajo(l).length === 0, `con la recarga, la cota alta nunca por debajo (${altoDebajo(l).length})`);
}
{
  // Una sesión que arranca sin 503: nada hasta el mínimo de artistas, y en
  // cuanto llega una ráfaga la cota alta sube.
  const tranquila = [...Array(12).fill(RAPIDO), CON_503, ...Array(47).fill(RAPIDO)];
  const l = simular(tranquila);
  const primera = conRango(l)[0];
  ok(E.MIN_ARTISTAS_ESTIMAR >= 2 && primera && primera.hechos >= E.MIN_ARTISTAS_ESTIMAR, `el primer rango sale con ${primera?.hechos} artistas medidos (mínimo ${E.MIN_ARTISTAS_ESTIMAR})`);
  const r1 = { ...E.ritmoVacio(), peticiones: 2, artistas: 1, msArtistas: RAPIDO, msArtistas2: RAPIDO ** 2 };
  ok(E.estimarLoQueFalta({ pendientes: 100, ritmo: r1 }) === null, 'con un solo artista medido no se enseña ningún número');
  const r4 = [1, 2, 3, 4].reduce((r) => E.sumarArtista(E.sumarPeticion(E.sumarPeticion(r, 200), 200), RAPIDO), E.ritmoVacio());
  ok(E.estimarLoQueFalta({ pendientes: 100, ritmo: r4 }) === null, 'con cuatro tampoco');
  const antes = conRango(l).filter((x) => x.hechos === 12).at(-1);
  const despues = l.find((x) => x.hechos === 13);
  ok(antes && despues && despues.alto > antes.alto, `y cuando llega la primera ráfaga la cota alta sube (${antes?.alto} → ${despues?.alto} min)`);
  ok(altoDebajo(l).length === 0, `y la cota alta nunca queda por debajo (${altoDebajo(l).length})`);
}
{
  // Lo acumulado se guarda y se recupera tal cual; un guardado roto o de otra versión no se usa.
  let r = E.ritmoVacio();
  r = E.sumarPeticion(r, 503); r = E.sumarPeticion(r, 200); r = E.sumarArtista(r, 12_000);
  ok(r.peticiones === 2 && r.n503 === 1 && r.artistas === 1 && r.msArtistas === 12_000 && r.msArtistas2 === 144_000_000, 'cuenta peticiones, 503, artistas y las dos sumas de la duración', JSON.stringify(r));
  ok(igual(E.ritmoDesde(JSON.parse(JSON.stringify(r))), r), 'ritmoDesde(lo guardado) da lo mismo que se guardó');
  ok(igual(E.ritmoDesde(null), E.ritmoVacio()) && igual(E.ritmoDesde({ v: 99, artistas: 3 }), E.ritmoVacio()) && igual(E.ritmoDesde({ v: 1, artistas: 'x' }), E.ritmoVacio()), 'sin guardado, de otra versión o roto: empieza de cero');
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} mapa-escaneo: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
