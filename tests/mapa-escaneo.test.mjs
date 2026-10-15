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

// ── 1. El orden ──────────────────────────────────────────────────────────────
console.log('El orden del escaneo');
{
  const totals = { 'Cobre': T(30), 'Ámbar': T(50), 'Bronce': T(50), 'acero': T(50), 'Plomo': T(5) };
  const artists = Object.fromEntries(Object.keys(totals).map(n => [n, [tema('Tema de ' + n)]]));
  const lista = P.universo(totals, artists);
  const mb = crearMB({ artistas: Object.fromEntries(Object.keys(totals).map(n => [n, { candidatos: [] }])) });
  const r = await correr({ lista, mb });
  const buscados = mb.llamadas.filter(u => u.includes('/artist/')).map(u => new URL(u).searchParams.get('query'));
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
  ok(r.guardadosArtista.length === 1 && r.guardadosArtista[0][0] === 'Nadie Así', 'el sin-candidato queda guardado (es un resultado)');
  ok(P.proximoPaso(lista[0], r.artistas.get('Nadie Así'), r.areas).clase === 'sin-candidato', 'y lo guardado da sin-candidato');
  ok(mb.llamadas.length === 1, 'una sola petición: no pide la grabación');
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
  ok(igual(ev, ['pedir', 'guardar', 'pedir', 'guardar', 'pedir', 'guardar']), 'pedir → guardar → pedir…: cada respuesta se guarda antes de la petición siguiente', ev.join(' '));
}

// ── 9. Saltar los que ya fallaron en esta sesión, y parar ────────────────────
console.log('\nSaltar y parar');
{
  const lista = P.universo({ 'Uno': T(90), 'Dos': T(80) }, {});
  const mb = crearMB({ artistas: { 'Uno': { candidatos: [] }, 'Dos': { candidatos: [] } } });
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

// ── 11. El ritmo medido y lo que falta (estimación) ──────────────────────────
console.log('\nEl ritmo medido');
{
  const ahora = 600_000;
  const comienzos = [0, 60_000, 120_000, 430_000, 450_000, 500_000, 550_000, 599_000];
  ok(E.peticionesPorMinuto(comienzos, ahora, 180_000) === 5 / 3, 'peticiones por minuto de los últimos 3 minutos');
  ok(E.peticionesPorMinuto([], ahora) === null, 'sin peticiones, sin ritmo');
  const est = E.estimarLoQueFalta({ pendientes: 100, peticiones: 50, artistasHechos: 20, msTranscurridos: 100_000 });
  ok(est && est.peticiones === 250 && Math.round(est.minutos) === 8, `100 pendientes a 2,5 pet./artista y 2 s/pet. → ~250 peticiones, ~8 min (${JSON.stringify(est)})`);
  ok(E.estimarLoQueFalta({ pendientes: 10, peticiones: 3, artistasHechos: 0, msTranscurridos: 5000 }) === null, 'sin ningún artista hecho en la sesión, no se estima');
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} mapa-escaneo: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
