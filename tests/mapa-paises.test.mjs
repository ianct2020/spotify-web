// tests/mapa-paises.test.mjs — la cuenta de `#mapa` (v=304, tanda 52)
//
// `util/mapa-paises.js` es la parte PURA de la vista de países: dado `totals`,
// los temas de cada artista y la caché de respuestas de MusicBrainz (artistas y
// áreas), decide con la regla de `util/mb-pais.js` en qué estado está cada
// artista, cuál es el próximo pedido que le falta, y arma los países y las cinco
// filas de cobertura.
//
// Lo que se vigila, y por qué:
//   · Las cinco filas suman EXACTAMENTE el total del historial (en décimas de
//     minuto, que son enteros: con flotantes «exactamente» no existe).
//   · Los desconocidos NO se reparten entre los países, de ninguna forma: un
//     país de mentira se ve igual que uno de verdad. Con un 30 % sin país, los
//     países suman el 70 %, no el 100 %.
//   · La definición ESTRICTA de «tiene país» (tandas 50 y 51): `unico`
//     corroborado, `varios-mismo-pais`, `desempatado` con país. Un `unico` sin
//     corroborar va a «sin confirmar», no a su país.
//   · El orden del escaneo: minutos descendente y, a igualdad, por nombre con
//     comparación de cadenas simple (la de la muestra de la 50); < 10 min fuera.
//   · La secuencia de pedidos por artista es la de la medición de la 51
//     (`fonoteca-migracion/mapa/medir-mb-paises-2026-10-14.mjs`).
//
// 🔴 Todo es INVENTADO: artistas, áreas, ids y respuestas. Ningún dato de
// escucha de nadie (el repo es público).
//
// Correr con: node tests/mapa-paises.test.mjs

import * as M from '../src/js/util/mapa-paises.js';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Los datos de mentira ─────────────────────────────────────────────────────
// totals[nombre] = [plays, minutos, …]; artists[nombre] = [[título, plays, minutos, id], …]
const T = (min) => [1, min, 2020, 2020, [], '2020-01-01'];
const tema = (titulo, min) => [titulo, 1, min, 'id-' + titulo];

// Áreas: una ciudad → una subdivisión → un país (2 lookups), y un país directo.
const AREA = {
  ciudad: 'a0000000-0000-4000-8000-000000000001',
  subdiv: 'a0000000-0000-4000-8000-000000000002',
  otraCiudad: 'a0000000-0000-4000-8000-000000000003',
  pais: 'a0000000-0000-4000-8000-000000000009',
};
const respArea = {
  [AREA.ciudad]: { id: AREA.ciudad, name: 'Ciudad Inventada', type: 'City', 'iso-3166-1-codes': [], 'life-span': {}, relations: [
    { type: 'part of', direction: 'backward', ended: false, area: { id: AREA.subdiv, name: 'Provincia Inventada', type: 'Subdivision', 'iso-3166-2-codes': ['ZZ-PI'] } },
    { type: 'part of', direction: 'forward', area: { id: 'hijo-1', name: 'Barrio', type: 'District' } },
  ] },
  [AREA.subdiv]: { id: AREA.subdiv, name: 'Provincia Inventada', type: 'Subdivision', relations: [
    { type: 'part of', direction: 'backward', area: { id: AREA.pais, name: 'Paislandia', type: 'Country', 'iso-3166-1-codes': ['BR'] } },
    { type: 'part of', direction: 'forward', area: { id: AREA.ciudad, type: 'City' } },
  ] },
  [AREA.otraCiudad]: { id: AREA.otraCiudad, type: 'City', relations: [
    { type: 'part of', direction: 'backward', area: { id: AREA.subdiv, type: 'Subdivision' } },
  ] },
};
const areasCompletas = new Map(Object.entries(respArea).map(([id, a]) => [id, M.recortarArea(a)]));

const cand = (id, name, extra = {}) => ({ id, name, 'sort-name': name, score: 100, tags: [{ name: 'x' }], ...extra });
// Un registro de caché ya recortado, como lo deja el escaneo. `respaldo`
// (v=307): `undefined` = un registro de v=304-306, que no tiene el campo; `null`
// = no se pidió; una lista = los candidatos del respaldo (`[]`: se pidió y no
// trajo nada).
const reg = (nombre, candidatos, ids = null, titulo = null, respaldo = undefined) => ({
  v: 1, nombre, consultado: '2026-10-14T00:00:00.000Z',
  candidatos: M.recortarArtistas({ artists: candidatos }),
  grabacion: ids === null ? null : { titulo, ids, consultado: '2026-10-14T00:00:01.000Z' },
  ...(respaldo === undefined ? {} : { respaldo: respaldo === null ? null : M.recortarArtistas({ artists: respaldo }) }),
});

// ── 1. El orden del escaneo ──────────────────────────────────────────────────
console.log('El orden del escaneo');
{
  const totals = { 'Bruma': T(50), 'alba': T(50), 'Zinc': T(80), 'Ceniza': T(9.9), 'Árbol': T(50), 'Duna': T(10) };
  const artists = { 'Zinc': [tema('Uno', 3), tema('Dos (Live) - Remix', 7), tema('Tres', 7)] };
  const u = M.universo(totals, artists);
  ok(igual(u.map(a => a.nombre), ['Zinc', 'Bruma', 'alba', 'Árbol', 'Duna']),
    'minutos descendente y, a igualdad, por nombre con comparación simple («B» < «a» < «Á»)', JSON.stringify(u.map(a => a.nombre)));
  ok(!u.some(a => a.nombre === 'Ceniza'), 'los de menos de 10 min no entran (9,9)');
  ok(u.some(a => a.nombre === 'Duna'), 'los de 10 min justos sí entran');
  ok(u[0].tema === 'Dos (Live) - Remix', 'el tema es el de más minutos y, a igualdad, el primero de la lista');
  ok(u[1].tema === null, 'sin temas en `artists`, el tema es null');
  ok(M.MIN_MINUTOS === 10, 'el umbral es 10 min');
}

// ── 2. Lo que se guarda: recortado ───────────────────────────────────────────
console.log('\nLo que se guarda, recortado');
{
  const r = M.recortarArtistas({ artists: [cand('m1', 'Alfa', {
    aliases: [{ name: 'Alpha', locale: 'en', type: 'Artist name' }], country: 'AR',
    area: { id: 'ar1', name: 'Argentina', type: 'Country', 'type-id': 'x', 'sort-name': 'Argentina' },
    disambiguation: 'el de mentira', 'begin-area': { id: 'b' }, 'life-span': {}, ipis: ['1'],
  })] });
  ok(igual(Object.keys(r[0]).sort(), ['aliases', 'area', 'country', 'disambiguation', 'id', 'name', 'sort-name'].sort()),
    'de cada candidato quedan id, name, sort-name, aliases, country, area y disambiguation', Object.keys(r[0]).join(','));
  ok(igual(r[0].aliases, [{ name: 'Alpha' }]), 'de los alias, solo el nombre');
  ok(igual(r[0].area, { id: 'ar1', name: 'Argentina', type: 'Country' }), 'del área, id, name y type');
  ok(!('score' in r[0]) && !('tags' in r[0]), 'sin score ni tags');
  ok(igual(M.recortarArtistas({}), []), 'una búsqueda sin `artists` da lista vacía');

  const a = M.recortarArea(respArea[AREA.ciudad]);
  ok(a.type === 'City' && igual(a['iso-3166-1-codes'], []), 'el área guarda su type y sus códigos ISO 3166-1');
  ok(a.relations.length === 1 && a.relations[0].direction === 'backward', 'solo las «part of» hacia el padre (backward): los hijos no los lee nadie');
  ok(igual(Object.keys(a.relations[0].area).sort(), ['id', 'iso-3166-1-codes', 'type']), 'del área del otro lado, id, type y códigos', JSON.stringify(a.relations[0].area));
  ok(igual(M.idsDeGrabacion({ recordings: [
    { 'artist-credit': [{ artist: { id: 'x' } }, { artist: { id: 'y' } }] },
    { 'artist-credit': [{ artist: { id: 'x' } }] }, {},
  ] }), ['x', 'y']), 'los ids de grabación: únicos, de todos los créditos');
  ok(igual(M.idsDeGrabacion({}), []), 'una grabación sin resultados da [] (pregunté y no hay), no null');
}

// ── 3. La secuencia por artista (la de la 51) ────────────────────────────────
console.log('\nLa secuencia de pedidos por artista');
{
  const it = { nombre: 'Alfa', tema: 'Canción (Remix)' };
  ok(igual(M.proximoPaso(it, null, new Map()).falta, { tipo: 'busqueda' }), 'sin nada guardado: la búsqueda');

  // unico con country → grabación (corroborar) → listo
  let r = reg('Alfa', [cand('m1', 'Alfa', { country: 'AR' })]);
  let p = M.proximoPaso(it, r, new Map());
  ok(p.falta?.tipo === 'grabacion' && p.falta.titulo === 'Canción', 'unico con país: falta la grabación, con el título limpio', JSON.stringify(p.falta));
  r = reg('Alfa', [cand('m1', 'Alfa', { country: 'AR' })], ['m1', 'otro'], 'Canción');
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.categoria === 'pais' && p.pais === 'AR', 'unico con país y corroborado: tiene país', JSON.stringify(p));
  r = reg('Alfa', [cand('m1', 'Alfa', { country: 'AR' })], ['otro'], 'Canción');
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.categoria === 'sin-confirmar' && p.pais === 'AR', 'unico con país SIN corroborar: «sin confirmar»');
  r = reg('Alfa', [cand('m1', 'Alfa', { country: 'AR' })], [], 'Canción');
  ok(M.proximoPaso(it, r, new Map()).categoria === 'sin-confirmar', 'la grabación sin resultados ([]) tampoco corrobora');

  // unico sin tema: no se puede pedir la grabación
  r = reg('Alfa', [cand('m1', 'Alfa', { country: 'AR' })]);
  p = M.proximoPaso({ nombre: 'Alfa', tema: null }, r, new Map());
  ok(p.falta === null && p.categoria === 'sin-confirmar', 'unico con país y sin tema para buscar: terminado, «sin confirmar»');

  // unico sin country con área: área por área, después la grabación
  r = reg('Alfa', [cand('m1', 'Alfa', { area: { id: AREA.ciudad, name: 'Ciudad Inventada', type: 'City' } })]);
  p = M.proximoPaso(it, r, new Map());
  ok(igual(p.falta, { tipo: 'area', id: AREA.ciudad }), 'unico sin país con área: primero su área', JSON.stringify(p.falta));
  p = M.proximoPaso(it, r, new Map([[AREA.ciudad, areasCompletas.get(AREA.ciudad)]]));
  ok(igual(p.falta, { tipo: 'area', id: AREA.subdiv }), 'después el padre (un lookup por salto)', JSON.stringify(p.falta));
  p = M.proximoPaso(it, r, areasCompletas);
  ok(p.falta?.tipo === 'grabacion', 'con el país del área, la grabación para corroborar (igual que la 51)');
  r = reg('Alfa', [cand('m1', 'Alfa', { area: { id: AREA.ciudad, name: 'Ciudad Inventada', type: 'City' } })], ['m1'], 'Canción');
  p = M.proximoPaso(it, r, areasCompletas);
  ok(p.falta === null && p.categoria === 'pais' && p.pais === 'BR' && p.paisDe === 'area', 'unico, país del área, corroborado: tiene país (BR, del área)', JSON.stringify(p));

  // unico sin país ni área: listo sin país, sin grabación
  r = reg('Alfa', [cand('m1', 'Alfa')]);
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.categoria === 'sin-pais', 'unico sin país ni área: terminado, sin país (y sin pedir la grabación)');

  // sin-candidato. v=307 (tanda 55): hasta v=306 este assert afirmaba que un
  // sin-candidato guardado, sin más, estaba terminado. Desde v=307 eso vale
  // cuando el respaldo YA se pidió y tampoco trajo a nadie (`respaldo: []`); sin
  // el campo, le falta el respaldo (ver la sección 9).
  r = reg('Alfa', [cand('z1', 'Otro nombre', { country: 'AR' })], null, null, []);
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.clase === 'sin-candidato' && p.categoria === 'sin-pais', 'sin-candidato con el respaldo pedido y vacío: terminado, sin país');

  // varios-mismo-pais: sin grabación
  r = reg('Alfa', [cand('m1', 'Alfa', { country: 'ES' }), cand('m2', 'Alfa', { country: 'ES' })]);
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.clase === 'varios-mismo-pais' && p.categoria === 'pais' && p.pais === 'ES', 'varios-mismo-pais: tiene país, sin pedir la grabación');

  // varios distintos: grabación; desempata a uno con país / a uno sin país con área / a ninguno
  const varios = [cand('m1', 'Alfa', { country: 'CL' }), cand('m2', 'Alfa', { area: { id: AREA.otraCiudad, name: 'Otra', type: 'City' } })];
  r = reg('Alfa', varios);
  ok(M.proximoPaso(it, r, new Map()).falta?.tipo === 'grabacion', 'varios con países distintos: falta la grabación');
  r = reg('Alfa', varios, ['m1'], 'Canción');
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.clase === 'desempatado' && p.pais === 'CL' && p.categoria === 'pais', 'desempatado con country: tiene país');
  r = reg('Alfa', varios, ['m2'], 'Canción');
  p = M.proximoPaso(it, r, new Map());
  ok(igual(p.falta, { tipo: 'area', id: AREA.otraCiudad }), 'desempatado sin country: vuelve al área (paso 2)', JSON.stringify(p.falta));
  p = M.proximoPaso(it, r, areasCompletas);
  ok(p.falta === null && p.clase === 'desempatado' && p.pais === 'BR' && p.paisDe === 'area' && p.categoria === 'pais',
    'desempatado con país del área: tiene país', JSON.stringify(p));
  r = reg('Alfa', varios, ['nadie'], 'Canción');
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.clase === 'ambiguo' && p.categoria === 'sin-pais', 'ambiguo: terminado, sin país');
  p = M.proximoPaso({ nombre: 'Alfa', tema: null }, reg('Alfa', varios), new Map());
  ok(p.falta === null && p.clase === 'ambiguo', 'varios sin tema para desempatar: ambiguo, sin pedir nada más');

  // área que no lleva a un país
  const sinPadre = new Map([[AREA.ciudad, { id: AREA.ciudad, type: 'City', 'iso-3166-1-codes': [], relations: [] }]]);
  r = reg('Alfa', [cand('m1', 'Alfa', { area: { id: AREA.ciudad, name: 'x', type: 'City' } })]);
  p = M.proximoPaso(it, r, sinPadre);
  ok(p.falta === null && p.categoria === 'sin-pais' && p.areaMotivo === 'cortada', 'un área sin padre: terminado, sin país, con el motivo');
}

// ── 4. La cobertura y los países ─────────────────────────────────────────────
console.log('\nLa cobertura y los países');
const nombrePais = (c) => ({ AR: 'Argentina', BR: 'Brasil', ES: 'España', CL: 'Chile', MX: 'México' }[c] || c);
{
  // Siete artistas ≥ 10 min (uno de cada caso), dos sin escanear, y dos de < 10 min.
  const totals = {
    'Alfa': T(300), 'Beta': T(200), 'Gama': T(150), 'Delta': T(100.4), 'Épsilon': T(80), 'Zeta': T(60), 'Eta': T(50),
    'Theta': T(40), 'Iota': T(20.3), 'Kappa': T(9.9), 'Lambda': T(0.1),
  };
  const artists = Object.fromEntries(Object.keys(totals).map(n => [n, [tema('T de ' + n, 1)]]));
  const artistas = new Map([
    ['Alfa', reg('Alfa', [cand('a1', 'Alfa', { country: 'AR' })], ['a1'], 'T de Alfa')],                                    // país AR
    ['Beta', reg('Beta', [cand('b1', 'Beta', { country: 'ES' }), cand('b2', 'Beta', { country: 'ES' })])],                 // varios-mismo-pais ES
    ['Gama', reg('Gama', [cand('g1', 'Gama', { country: 'MX' })], ['otro'], 'T de Gama')],                                 // sin confirmar
    ['Delta', reg('Delta', [cand('d1', 'Delta', { country: 'CL' }), cand('d2', 'Delta', { area: { id: AREA.ciudad, type: 'City', name: 'c' } })], ['d2'], 'T de Delta')], // desempatado, BR del área
    ['Épsilon', reg('Épsilon', [cand('e1', 'Épsilon', { country: 'CL' }), cand('e2', 'Épsilon', { country: 'MX' })], ['nadie'], 'T de Épsilon')], // ambiguo
    ['Zeta', reg('Zeta', [cand('x', 'Otro')], null, null, [])],                                                              // sin-candidato (con el respaldo pedido, v=307)
    ['Eta', reg('Eta', [cand('h1', 'Eta', { country: 'AR' })])],                                                            // a medias: falta la grabación
  ]);
  const m = M.armarMapa({ totals, artists, artistas, areas: areasCompletas, nombrePais });
  const f = m.filas;
  const suma = f.conPais + f.sinPais + f.sinConfirmar + f.sinEscanear + f.menos10;
  ok(suma === m.total, `las cinco filas suman EXACTAMENTE el total (${suma} = ${m.total} décimas)`);
  ok(m.total === 10107, `el total es el de TODO totals, también los de < 10 min (${m.total} décimas)`);
  ok(f.conPais === 3000 + 2000 + 1004, `con país: Alfa + Beta + Delta (${f.conPais})`);
  ok(f.sinConfirmar === 1500, `sin confirmar: Gama, el unico sin corroborar (${f.sinConfirmar})`);
  ok(f.sinPais === 800 + 600, `sin país: el ambiguo y el sin-candidato (${f.sinPais})`);
  ok(f.sinEscanear === 500 + 400 + 203, `sin escanear todavía: Eta (a medias), Theta e Iota (${f.sinEscanear})`);
  ok(f.menos10 === 99 + 1, `menos de 10 min: Kappa y Lambda (${f.menos10})`);
  ok(m.universo === 9 && m.escaneados === 6 && m.conPaisArtistas === 3, `9 en el universo, 6 escaneados, de 3 se sabe el país (${m.universo}/${m.escaneados}/${m.conPaisArtistas})`);

  const porCodigo = Object.fromEntries(m.paises.map(p => [p.codigo, p]));
  ok(!porCodigo.MX, 'el unico sin corroborar (MX) NO suma a ningún país');
  ok(!porCodigo.CL || !porCodigo.CL.artistas.some(a => a.nombre === 'Épsilon'), 'el ambiguo no suma a ningún país');
  ok(porCodigo.BR?.decimas === 1004 && porCodigo.BR.artistas[0].nombre === 'Delta', 'el desempatado con país del área cuenta en su país');
  ok(porCodigo.ES?.decimas === 2000, 'el varios-mismo-pais cuenta');
  ok(igual(m.paises.map(p => p.codigo), ['AR', 'ES', 'BR']), 'los países, por minutos', JSON.stringify(m.paises.map(p => p.codigo)));
  ok(m.paises[0]?.nombre === 'Argentina' && m.paises[0]?.artistas.length === 1, 'cada país con su nombre y sus artistas');
  ok(m.paises.reduce((s, p) => s + p.decimas, 0) === f.conPais, 'los países suman exactamente la fila «con país», ni una décima más');
  const sp = Object.fromEntries(m.sinPais.map(x => [x.nombre, x]));
  ok(sp.Gama?.categoria === 'sin-confirmar' && sp['Épsilon']?.categoria === 'sin-pais' && sp.Zeta && !sp.Eta && !sp.Alfa,
    'la lista «sin país» trae a los escaneados sin país y a los sin confirmar, y a nadie más', JSON.stringify(Object.keys(sp)));
  ok(m.sinPais.every(x => x.motivo && !/sin-candidato|ambiguo|unico|desempatado/.test(x.motivo)),
    'cada uno con el motivo en palabras, no el nombre interno de la clase', m.sinPais.map(x => x.motivo).join(' | '));
  ok(/MX|México/.test(sp.Gama?.motivo ?? ''), 'el «sin confirmar» dice qué país sería', sp.Gama?.motivo);
}

// ── 5. Los desconocidos NO se reparten ───────────────────────────────────────
console.log('\nLos desconocidos no se reparten');
{
  // 100 min: 70 con país (dos países), 30 sin país. Los países suman 70, no 100.
  const totals = { 'Uno': T(40), 'Dos': T(30), 'Tres': T(20), 'Cuatro': T(10) };
  const artistas = new Map([
    ['Uno', reg('Uno', [cand('u1', 'Uno', { country: 'AR' })], ['u1'], 'x')],
    ['Dos', reg('Dos', [cand('d1', 'Dos', { country: 'CL' })], ['d1'], 'x')],
    ['Tres', reg('Tres', [cand('n', 'Nadie')], null, null, [])],
    ['Cuatro', reg('Cuatro', [cand('c1', 'Cuatro', { country: 'AR' }), cand('c2', 'Cuatro', { country: 'MX' })], [], 'x')],
  ]);
  const artists = { Uno: [tema('x', 1)], Dos: [tema('x', 1)], Tres: [tema('x', 1)], Cuatro: [tema('x', 1)] };
  const m = M.armarMapa({ totals, artists, artistas, areas: new Map(), nombrePais });
  const sumaPaises = m.paises.reduce((s, p) => s + p.decimas, 0);
  ok(sumaPaises === 700, `con un 30 % sin país, los países suman el 70 % (${sumaPaises / 10} de 100 min)`);
  ok(m.paises.find(p => p.codigo === 'AR')?.decimas === 400, 'AR tiene sus 40 min y ni uno más');
  ok(m.paises.find(p => p.codigo === 'CL')?.decimas === 300, 'CL tiene sus 30 min y ni uno más');
  ok(m.filas.sinPais === 300, 'los 30 min van a «sin país»');
  ok(m.paises.every(p => Math.abs(p.pct - p.decimas / m.total * 100) < 1e-9), 'el % de cada país es del total del historial, no del total con país');
}

// ── 6. A igualdad de minutos, por nombre ─────────────────────────────────────
console.log('\nEl orden de los países a igualdad');
{
  const totals = { 'P': T(50), 'Q': T(50), 'R': T(50) };
  const artists = { P: [tema('x', 1)], Q: [tema('x', 1)], R: [tema('x', 1)] };
  const artistas = new Map([
    ['P', reg('P', [cand('p', 'P', { country: 'MX' })], ['p'], 'x')],
    ['Q', reg('Q', [cand('q', 'Q', { country: 'AR' })], ['q'], 'x')],
    ['R', reg('R', [cand('r', 'R', { country: 'CL' })], ['r'], 'x')],
  ]);
  const m = M.armarMapa({ totals, artists, artistas, areas: new Map(), nombrePais });
  ok(igual(m.paises.map(p => p.nombre), ['Argentina', 'Chile', 'México']), 'a igualdad de minutos, por nombre', JSON.stringify(m.paises.map(p => p.nombre)));
  const sinNombre = M.armarMapa({ totals, artists, artistas, areas: new Map() });
  ok(igual(sinNombre.paises.map(p => p.nombre), ['AR', 'CL', 'MX']), 'sin traductor, el nombre es el código');
}

// ── 7. Una caché vacía ───────────────────────────────────────────────────────
console.log('\nCon la caché vacía');
{
  const totals = { 'Uno': T(40), 'Dos': T(5) };
  const m = M.armarMapa({ totals, artists: {}, artistas: new Map(), areas: new Map() });
  ok(m.filas.sinEscanear === 400 && m.filas.menos10 === 50 && m.filas.conPais === 0, 'todo va a «sin escanear» y «menos de 10 min»');
  ok(m.paises.length === 0 && m.sinPais.length === 0 && m.escaneados === 0, 'sin países y sin escaneados');
  ok(m.pendientes === 1, 'un pendiente');
}

// ── 8. Las claves ────────────────────────────────────────────────────────────
console.log('\nLas claves de IndexedDB');
ok(M.claveArtista('uid-de-prueba', 'Nombre Raro') === 'mapa_artista_v1_uid-de-prueba_Nombre Raro', 'la del artista lleva el uid (la lista de artistas es dato de escucha)');
ok(M.claveArea('a-1') === 'mapa_area_v1_a-1', 'la del área no (es dato público)');
ok(M.PREFIJO_ARTISTA === 'mapa_artista_v1_' && M.PREFIJO_AREA === 'mapa_area_v1_', 'los dos prefijos');

// ── 9. El alias de respaldo (v=307, tanda 55) ────────────────────────────────
// La búsqueda de siempre (`artist:"…"`) no mira los alias: un artista que cambió
// de nombre y conserva el viejo como alias sale `sin-candidato`. El respaldo
// (`artist:"…" OR alias:"…"`) se pide SOLO entonces, y con su respuesta se
// clasifica con la MISMA regla. Nunca reemplaza lo que la de siempre resolvió.
console.log('\nEl alias de respaldo');
{
  const it = { nombre: 'Faro Viejo', tema: 'Señal (En vivo)' };
  const tributo = cand('t1', 'Faro Viejo Tribute Band');
  const renombrado = cand('r1', 'Faro Nuevo', { country: 'UY', aliases: [{ name: 'Faro Viejo' }] });

  // (a) Un registro de v=304-306: sin el campo. Pide SOLO el respaldo.
  let r = reg('Faro Viejo', [tributo]);
  let p = M.proximoPaso(it, r, new Map());
  ok(igual(p.falta, { tipo: 'respaldo' }), 'un sin-candidato guardado SIN el campo (de v=304-306): le falta el respaldo, no la búsqueda', JSON.stringify(p.falta));
  ok(p.categoria === 'pendiente', 'y mientras tanto cuenta como pendiente («sin buscar todavía»)');
  // (b) Uno nuevo, con `respaldo: null` (la búsqueda acaba de dar sin-candidato).
  p = M.proximoPaso(it, reg('Faro Viejo', [tributo], null, null, null), new Map());
  ok(igual(p.falta, { tipo: 'respaldo' }), 'respaldo: null (no se pidió) → le falta el respaldo', JSON.stringify(p.falta));
  // (c) El respaldo lo trae por su alias → la MISMA secuencia: la grabación, con el nombre que pidió Ian.
  r = reg('Faro Viejo', [tributo], null, null, [tributo, renombrado]);
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta?.tipo === 'grabacion' && p.falta.titulo === 'Señal', 'el respaldo lo trae por su alias: unico con país → falta la grabación, con el título limpio', JSON.stringify(p.falta));
  // (d) Corroborado → tiene país.
  r = reg('Faro Viejo', [tributo], ['r1', 'otro'], 'Señal', [tributo, renombrado]);
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.clase === 'unico' && p.pais === 'UY' && p.mbid === 'r1' && p.categoria === 'pais', 'con la grabación que lo nombra: unico, UY, con país', JSON.stringify(p));
  // (e) Sin corroborar → «sin confirmar», como cualquier unico.
  r = reg('Faro Viejo', [tributo], ['otro'], 'Señal', [tributo, renombrado]);
  ok(M.proximoPaso(it, r, new Map()).categoria === 'sin-confirmar', 'si la grabación no lo nombra: «sin confirmar», no suma país');
  // (f) El respaldo tampoco trae a nadie → terminado, sin país.
  r = reg('Faro Viejo', [tributo], null, null, [tributo]);
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.clase === 'sin-candidato' && p.categoria === 'sin-pais', 'el respaldo tampoco lo trae: terminado, sin-candidato, sin país');
  // (g) Un respaldo sin country con área → el área, salto por salto, como siempre.
  const conArea = cand('r2', 'Faro Nuevo', { aliases: [{ name: 'Faro Viejo' }], area: { id: AREA.ciudad, name: 'Ciudad Inventada', type: 'City' } });
  p = M.proximoPaso(it, reg('Faro Viejo', [tributo], null, null, [conArea]), new Map());
  ok(igual(p.falta, { tipo: 'area', id: AREA.ciudad }), 'un respaldo sin country pero con área: el área (la misma secuencia)', JSON.stringify(p.falta));
  // (h) Varios por el respaldo → la grabación los desempata, como siempre.
  const otroAR = cand('r3', 'Faro Viejo', { country: 'AR' });
  r = reg('Faro Viejo', [tributo], ['r1'], 'Señal', [renombrado, otroAR]);
  p = M.proximoPaso(it, r, new Map());
  ok(p.falta === null && p.clase === 'desempatado' && p.mbid === 'r1' && p.pais === 'UY', 'dos por el respaldo (uno por alias, otro por nombre) y la grabación nombra a uno: desempatado', JSON.stringify(p));
  ok(p.porRespaldo === true && M.proximoPaso(it, reg('Alfa', [cand('m1', 'Faro Viejo', { country: 'AR' })], ['m1'], 'x'), new Map()).porRespaldo === false,
    'el resultado dice si salió del respaldo (para contarlo), y uno de la búsqueda de siempre dice que no');

  // La cobertura: el registro viejo va a «sin buscar todavía» hasta que llega su respaldo.
  const totals = { 'Faro Viejo': T(40), 'Otro': T(20) };
  const artists = { 'Faro Viejo': [tema('Señal (En vivo)', 1)], 'Otro': [tema('x', 1)] };
  const viejo = M.armarMapa({ totals, artists, artistas: new Map([['Faro Viejo', reg('Faro Viejo', [tributo])], ['Otro', reg('Otro', [cand('o', 'Otro', { country: 'AR' })], ['o'], 'x')]]), areas: new Map(), nombrePais });
  ok(viejo.filas.sinEscanear === 400 && viejo.filas.sinPais === 0 && viejo.pendientes === 1, `el sin-candidato viejo, sin respaldo: en «sin buscar todavía», no en «sin país» (${JSON.stringify(viejo.filas)})`);
  const resuelto = M.armarMapa({ totals, artists, artistas: new Map([['Faro Viejo', reg('Faro Viejo', [tributo], ['r1'], 'Señal', [renombrado])], ['Otro', reg('Otro', [cand('o', 'Otro', { country: 'AR' })], ['o'], 'x')]]), areas: new Map(), nombrePais });
  ok(resuelto.filas.conPais === 600 && resuelto.paises.some((x) => x.codigo === 'UY' && x.decimas === 400), 'con su respaldo y la grabación, suma a su país (UY, 40 min)');
}

// ── 10. La garantía: el respaldo nunca toca lo que la de siempre resolvió ────
// Para CADA clase que no es sin-candidato, aunque el registro traiga un respaldo
// con OTRO candidato que también coincidiría (y de otro país), `proximoPaso()`
// da exactamente lo mismo que sin él, y nunca pide el respaldo. CONSERVACIÓN:
// esto ya pasa en v=306 (no hay respaldo); está para que una tanda que «use el
// respaldo también acá» se ponga roja.
console.log('\nLa garantía: el respaldo no cambia ninguna otra clase');
{
  const it = { nombre: 'Alfa', tema: 'Canción' };
  const intruso = [cand('x9', 'Alfa', { country: 'ZZ' })];
  const varios = [cand('m1', 'Alfa', { country: 'CL' }), cand('m2', 'Alfa', { country: 'MX' })];
  const casos = [
    ['unico', [cand('m1', 'Alfa', { country: 'AR' })], ['m1']],
    ['varios-mismo-pais', [cand('m1', 'Alfa', { country: 'ES' }), cand('m2', 'Alfa', { country: 'ES' })], null],
    ['desempatado', varios, ['m1']],
    ['ambiguo', varios, ['nadie']],
  ];
  for (const [clase, cands, ids] of casos) {
    for (const conIds of ids === null ? [null] : [null, ids]) {
      const sin = M.proximoPaso(it, reg('Alfa', cands, conIds, 'Canción'), new Map());
      const con = M.proximoPaso(it, reg('Alfa', cands, conIds, 'Canción', intruso), new Map());
      const nulo = M.proximoPaso(it, reg('Alfa', cands, conIds, 'Canción', null), new Map());
      const etapa = conIds === null && ids !== null ? ' (antes de la grabación)' : '';
      ok(sin.falta?.tipo !== 'respaldo' && con.falta?.tipo !== 'respaldo' && nulo.falta?.tipo !== 'respaldo', `${clase}${etapa}: nunca pide el respaldo`);
      ok(igual(con, sin) && igual(nulo, sin), `${clase}${etapa}: con un respaldo que traería a otro (ZZ), da exactamente lo mismo`, `${JSON.stringify(sin)} contra ${JSON.stringify(con)}`);
      if (conIds !== null || ids === null) ok(sin.clase === clase, `y la clase sigue siendo ${clase} (${sin.clase})`);
    }
  }
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} mapa-paises: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
