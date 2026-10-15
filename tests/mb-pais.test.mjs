// tests/mb-pais.test.mjs — la regla del país de MusicBrainz (v=302; 11-13 desde v=303)
//
// `util/mb-pais.js` recibe respuestas de MusicBrainz ya bajadas y decide qué
// artista es y de qué país, sin adivinar: si no se puede atribuir con certeza,
// queda sin país. Las respuestas de acá son INVENTADAS, con nombres genéricos:
// ningún dato de escucha entra a este repo (la medición real vive en
// `fonoteca-migracion/mapa/`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Como namespace y no por nombre: así, contra un módulo al que le falta una
// función, la suite corre y falla assert por assert en vez de reventar al
// importar.
import * as M from '../src/js/util/mb-pais.js';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
// Llama sin reventar si la función no existe o tira: devuelve undefined.
function llamar(fn, ...a) {
  try { return typeof M[fn] === 'function' ? M[fn](...a) : undefined; } catch { return undefined; }
}

// Candidatos con la forma de un resultado de /ws/2/artist/?query=…
const cand = (id, name, extra = {}) => ({ id, name, 'sort-name': name, score: 100, type: 'Person', ...extra });

console.log('1. un solo coincidente con país');
{
  const r = llamar('clasificar', 'Banda Uno', [cand('m1', 'Banda Uno', { country: 'AR', area: { name: 'Argentina' } }), cand('m2', 'Banda Unos', { country: 'US' })]);
  ok(r?.clase === 'unico', 'clase unico');
  ok(r?.pais === 'AR', 'país AR');
  ok(r?.mbid === 'm1', 'mbid del coincidente');
  ok(r?.area === 'Argentina', 'area con el nombre');
  ok(r?.necesitaGrabacion === false, 'no necesita grabación');
}

console.log('2. un solo coincidente sin country pero con area');
{
  const r = llamar('clasificar', 'Solista Dos', [cand('m3', 'Solista Dos', { area: { name: 'Buenos Aires' } })]);
  ok(r?.clase === 'unico', 'clase unico');
  ok(r !== undefined && r.pais === null, 'pais null');
  ok(r?.area === 'Buenos Aires', 'area «Buenos Aires»');
}

console.log('3. el homónimo: dos «Intro»');
{
  const dos = [cand('i-us', 'Intro', { country: 'US' }), cand('i-gb', 'Intro', { country: 'GB' })];
  const sin = llamar('clasificar', 'Intro', dos);
  ok(sin?.clase === 'ambiguo', 'sin grabación → ambiguo');
  ok(sin !== undefined && sin.pais === null, 'sin grabación → pais null');
  ok(sin !== undefined && sin.mbid === null, 'sin grabación → mbid null');
  ok(sin?.necesitaGrabacion === true, 'necesita grabación');
  const uno = llamar('clasificar', 'Intro', dos, ['otro', 'i-gb']);
  ok(uno?.clase === 'desempatado', 'la grabación trae solo al segundo → desempatado');
  ok(uno?.pais === 'GB' && uno?.mbid === 'i-gb', 'desempatado → GB, el segundo');
  const ambos = llamar('clasificar', 'Intro', dos, ['i-us', 'i-gb']);
  ok(ambos?.clase === 'ambiguo' && ambos?.pais === null, 'la grabación trae a los dos → ambiguo, null');
  const ninguno = llamar('clasificar', 'Intro', dos, ['otro']);
  ok(ninguno?.clase === 'ambiguo' && ninguno?.pais === null, 'la grabación no trae a ninguno → ambiguo, null');
}

console.log('4. dos coincidentes con el mismo país y uno sin país');
{
  // Hasta v=302 esto era `varios-mismo-pais` con ES: la regla miraba solo a los
  // que traían país. Desde v=303 el que no trae país puede ser el de verdad, así
  // que va por la grabación (ver la sección 11).
  const r = llamar('clasificar', 'Coro Tres', [
    cand('c1', 'Coro Tres', { country: 'ES' }), cand('c2', 'Coro Tres', { country: 'ES' }), cand('c3', 'Coro Tres'),
  ]);
  ok(r?.clase === 'ambiguo', 'uno sin país → no es varios-mismo-pais: ambiguo sin grabación');
  ok(r !== undefined && r.pais === null, 'pais null');
  ok(r?.necesitaGrabacion === true, 'necesitaGrabacion true');
  const sinNinguno = llamar('clasificar', 'Coro Tres', [cand('c1', 'Coro Tres'), cand('c2', 'Coro Tres')]);
  ok(sinNinguno?.clase === 'ambiguo' && sinNinguno?.necesitaGrabacion === true, 'varios y ninguno con país → ambiguo y necesita grabación');
  const sinNingunoDesempata = llamar('clasificar', 'Coro Tres', [cand('c1', 'Coro Tres'), cand('c2', 'Coro Tres', { area: { name: 'Lima' } })], ['c2']);
  ok(sinNingunoDesempata?.clase === 'desempatado' && sinNingunoDesempata.pais === null && sinNingunoDesempata.area === 'Lima', 'varios sin país, la grabación elige uno → desempatado sin país, con su area');
}

console.log('5. parecidos que no son iguales');
{
  const r = llamar('clasificar', 'Intro', [cand('x1', 'Introvert', { country: 'US' }), cand('x2', 'The Intro', { country: 'GB' })]);
  ok(r?.clase === 'sin-candidato', 'clase sin-candidato');
  ok(r !== undefined && r.pais === null && r.mbid === null, 'pais y mbid null');
  ok(r?.necesitaGrabacion === false, 'no necesita grabación');
  ok(Array.isArray(llamar('coincidentes', 'Intro', [cand('x1', 'Introvert')])) && llamar('coincidentes', 'Intro', [cand('x1', 'Introvert')]).length === 0, 'coincidentes vacío');
  const vacio = llamar('clasificar', 'Intro', []);
  ok(vacio?.clase === 'sin-candidato', 'sin resultados → sin-candidato');
}

console.log('6. alias y sort-name');
{
  const porAlias = llamar('clasificar', 'Cantor García', [cand('a1', 'Cantor Garcia', { 'sort-name': 'Garcia, Cantor', country: 'AR', aliases: [{ name: 'Cantor García' }] })]);
  ok(porAlias?.clase === 'unico' && porAlias?.pais === 'AR', 'coincide por alias → unico AR');
  ok(llamar('comoCoincide', 'Cantor García', cand('a1', 'Cantor Garcia', { 'sort-name': 'Garcia, Cantor', aliases: [{ name: 'Cantor García' }] })) === 'nombre',
    'sin tildes en los dos lados, «Cantor Garcia» ya coincide por nombre');
  const porSort = llamar('clasificar', 'Garcia, Cantor', [cand('a1', 'Cantor García', { 'sort-name': 'García, Cantor', country: 'AR' })]);
  ok(porSort?.clase === 'unico' && porSort?.mbid === 'a1', 'coincide por sort-name → unico');
  ok(llamar('comoCoincide', 'Garcia, Cantor', cand('a1', 'Cantor García', { 'sort-name': 'García, Cantor' })) === 'sort-name', 'comoCoincide dice sort-name');
  ok(llamar('comoCoincide', 'El Apodo', cand('a2', 'Nombre Real', { 'sort-name': 'Real, Nombre', aliases: [{ name: 'el  apodo ' }] })) === 'alias', 'comoCoincide dice alias (con espacios y mayúsculas distintas)');
  ok(llamar('comoCoincide', 'Otro', cand('a2', 'Nombre Real')) === null, 'comoCoincide da null si no coincide');
}

console.log('7. un nombre de puro símbolo');
{
  ok(llamar('normalizarNombre', '¥$') === '¥$', 'normalizarNombre deja «¥$» como «¥$»');
  ok(llamar('normalizarNombre', '  ÁRBOL   de  Fuego ') === 'arbol de fuego', 'normalizarNombre: sin tildes, minúsculas, espacios colapsados');
  const r = llamar('clasificar', '¥$', [cand('y1', '¥$', { country: 'US' }), cand('y2', 'Ye', { country: 'US' })]);
  ok(r?.clase === 'unico' && r?.mbid === 'y1', '«¥$» contra «¥$» → unico');
  const r2 = llamar('clasificar', '¥$', [cand('y3', '$$$', { country: 'US' })]);
  ok(r2?.clase === 'sin-candidato', '«¥$» contra «$$$» → sin-candidato');
}

console.log('8. limpiarTitulo');
{
  ok(llamar('limpiarTitulo', 'She Sells Sanctuary (2009 Re-master)') === 'She Sells Sanctuary', 'paréntesis');
  ok(llamar('limpiarTitulo', 'Song - Remastered 2011') === 'Song', 'desde el primer « - »');
  ok(llamar('limpiarTitulo', 'Tema [Live] (Remix) - Edit') === 'Tema', 'corchetes, paréntesis y guion');
  ok(llamar('limpiarTitulo', '(Intro)') === '(Intro)', 'si queda vacío, el original');
}

console.log('9. queryArtista y queryGrabacion');
{
  ok(llamar('queryArtista', 'Banda "X" \\ Y') === 'artist:"Banda \\"X\\" \\\\ Y"', 'queryArtista escapa comillas y barra invertida');
  ok(llamar('queryArtista', 'Simple') === 'artist:"Simple"', 'queryArtista simple');
  ok(llamar('queryGrabacion', 'Can"ción\\', 'Ban"da') === 'recording:"Can\\"ción\\\\" AND artist:"Ban\\"da"', 'queryGrabacion escapa los dos');
}

console.log('corroborado');
{
  ok(llamar('corroborado', 'm1', ['m0', 'm1']) === true, 'está → true');
  ok(llamar('corroborado', 'm1', ['m0']) === false, 'no está → false');
  ok(llamar('corroborado', 'm1', []) === false, 'lista vacía → false');
  ok(llamar('corroborado', 'm1', null) === null, 'sin ids → null');
}

// v=304 (tanda 52): hasta v=303 esta sección afirmaba «ningún archivo de src/js
// lo importa». Desde v=304 lo importa `util/mapa-paises.js` (la vista #mapa), que
// es justamente para lo que se escribió: la regla, una sola vez; y
// `util/mapa-escaneo.js`, por las consultas (las URLs tienen que ser las de la
// medición de la 51). Ahora se afirma que la importan esos dos y nadie más.
console.log('10. módulo hoja, la importan solo mapa-paises.js y mapa-escaneo.js');
{
  const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
  let src = '';
  try { src = readFileSync(join(RAIZ, 'src/js/util/mb-pais.js'), 'utf8'); } catch {}
  ok(src.length > 0, 'src/js/util/mb-pais.js existe');
  ok(!src.split('\n').some(l => /^\s*import\b/.test(l)), 'no tiene ninguna línea que empiece con import');
  const quienes = [];
  const recorrer = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (p.endsWith('.js') && !p.endsWith('mb-pais.js') && /mb-pais/.test(readFileSync(p, 'utf8'))) quienes.push(p);
    }
  };
  recorrer(join(RAIZ, 'src/js'));
  const importan = quienes.filter((p) => /from\s+['"][^'"]*mb-pais\.js(\?v=\d+)?['"]/.test(readFileSync(p, 'utf8')));
  const permitidos = ['mapa-paises.js', 'mapa-escaneo.js'].map((f) => join('src', 'js', 'util', f));
  ok(importan.length === 2 && importan.every((p) => permitidos.some((f) => p.endsWith(f))),
    `de src/js la importan solo util/mapa-paises.js (la regla) y util/mapa-escaneo.js (las consultas) (la importan: ${importan.join(', ') || 'nadie'})`);
}

console.log('11. varios-mismo-pais exige país en TODOS (v=303)');
{
  // (a1) El homónimo sin `country` (score 100, área de una subdivisión) puede ser
  // el de verdad: no se le puede dar el país de los otros dos.
  const tres = [
    cand('s1', 'Pibe Cuatro', { area: { id: 'ar-sub', type: 'Subdivision', name: 'Provincia Inventada' } }),
    cand('s2', 'Pibe Cuatro', { country: 'UY', score: 90 }),
    cand('s3', 'Pibe Cuatro', { country: 'UY', score: 80 }),
  ];
  const sin = llamar('clasificar', 'Pibe Cuatro', tres);
  ok(sin !== undefined && sin.clase !== 'varios-mismo-pais', '(a1) uno sin country → no es varios-mismo-pais');
  ok(sin?.necesitaGrabacion === true, '(a1) necesita grabación');
  ok(sin !== undefined && sin.pais === null, '(a1) sin grabación → pais null');
  const des = llamar('clasificar', 'Pibe Cuatro', tres, ['otro', 's1']);
  ok(des?.clase === 'desempatado' && des?.mbid === 's1', '(a1) la grabación nombra al sin country → desempatado sobre él');
  ok(des !== undefined && des.pais !== 'UY', '(a1) y su país NO es el de los otros dos');
  ok(des?.area === 'Provincia Inventada', '(a1) con su area');
  // (a2) Conservación: si los dos traen el mismo, sigue siendo varios-mismo-pais.
  const dos = llamar('clasificar', 'Pibe Cuatro', [cand('s2', 'Pibe Cuatro', { country: 'UY' }), cand('s3', 'Pibe Cuatro', { country: 'UY' })]);
  ok(dos?.clase === 'varios-mismo-pais' && dos?.pais === 'UY' && dos?.necesitaGrabacion === false, '(a2) los dos con UY → varios-mismo-pais UY (conservación)');
}

console.log('12. el apóstrofo tipográfico iguala al recto (v=303)');
{
  // (c1) Los tres y ninguno más. (c3, «¥$» sigue siendo «¥$», es el caso 7.)
  ok(llamar('normalizarNombre', 'O’Neill') === llamar('normalizarNombre', "O'Neill"), '(c1) ’ (U+2019) = \'');
  ok(llamar('normalizarNombre', 'O‘Neill') === llamar('normalizarNombre', "O'Neill"), '(c1) ‘ (U+2018) = \'');
  ok(llamar('normalizarNombre', 'Oʼneill') === llamar('normalizarNombre', "O'Neill"), '(c1) ʼ (U+02BC) = \'');
  ok(llamar('normalizarNombre', 'O`Neill') !== llamar('normalizarNombre', "O'Neill"), '(c1) el acento grave ` NO se toca');
  ok(llamar('normalizarNombre', 'Fin.') === 'fin.', '(c1) el resto de la puntuación no se toca');
  // (c2)
  const r = llamar('clasificar', "Banda D'Este", [cand('d1', 'Banda D’Este', { country: 'PT' })]);
  ok(r?.clase === 'unico' && r?.mbid === 'd1', '(c2) «Banda D\'Este» contra «Banda D’Este» → unico');
}

console.log('13. el país que sale del área (v=303)');
{
  // Respuestas de /ws/2/area/<id>?inc=area-rels&fmt=json, con la forma vista en la
  // red: el padre va en una relación «part of» con direction «backward», y el
  // área del padre trae su `type` y sus códigos ISO. Las «forward» son los hijos.
  const PARTE = 'de7cc874-8b1b-3a05-8272-f3834c968fb7';
  const rel = (direction, area) => ({ type: 'part of', 'type-id': PARTE, direction, area });
  const pais = (id, codigos) => ({ id, type: 'Country', name: 'País ' + id, 'iso-3166-1-codes': codigos });
  const areas = new Map([
    // subdivisión → país, en un salto (con un hijo «forward» que no cuenta)
    ['sub-1', { id: 'sub-1', type: 'Subdivision', name: 'Sub Uno', 'iso-3166-2-codes': ['AR-X'],
      relations: [rel('forward', { id: 'ciu-9', type: 'City', name: 'Hija' }), rel('backward', pais('p-ar', ['AR']))] }],
    // ciudad → condado → subdivisión → país, tres saltos
    ['ciu-1', { id: 'ciu-1', type: 'City', name: 'Ciudad Uno', relations: [rel('backward', { id: 'con-1', type: 'County', name: 'Condado' })] }],
    ['con-1', { id: 'con-1', type: 'County', name: 'Condado', relations: [rel('backward', { id: 'sub-2', type: 'Subdivision', name: 'Estado', 'iso-3166-2-codes': ['CL-Y'] })] }],
    ['sub-2', { id: 'sub-2', type: 'Subdivision', name: 'Estado', relations: [rel('backward', pais('p-cl', ['CL']))] }],
    // dos padres país distintos
    ['dos-1', { id: 'dos-1', type: 'City', name: 'Frontera', relations: [rel('backward', pais('p-ar', ['AR'])), rel('backward', pais('p-cl', ['CL']))] }],
    // cortada: sin padre
    ['cor-1', { id: 'cor-1', type: 'City', name: 'Isla', relations: [rel('forward', { id: 'x', type: 'District', name: 'Barrio' })] }],
    // un país con dos códigos
    ['pai-2', pais('pai-2', ['AA', 'BB'])],
    // cuatro saltos: uno más que el tope
    ['l1', { id: 'l1', type: 'District', name: 'L1', relations: [rel('backward', { id: 'l2', type: 'City', name: 'L2' })] }],
    ['l2', { id: 'l2', type: 'City', name: 'L2', relations: [rel('backward', { id: 'l3', type: 'County', name: 'L3' })] }],
    ['l3', { id: 'l3', type: 'County', name: 'L3', relations: [rel('backward', { id: 'l4', type: 'Subdivision', name: 'L4' })] }],
    ['l4', { id: 'l4', type: 'Subdivision', name: 'L4', relations: [rel('backward', pais('p-pe', ['PE']))] }],
  ]);
  const p = (id) => llamar('paisDeArea', id, areas);
  ok(p('sub-1')?.pais === 'AR', '(b) subdivisión → su país, en un salto');
  ok(p('ciu-1')?.pais === 'CL' && p('ciu-1')?.saltos === 3, '(b) ciudad → condado → estado → país: CL en tres saltos');
  ok(p('p-solo') !== undefined && p('p-solo').pais === null && p('p-solo').falta === 'p-solo', '(b) un área que no está bajada → null y dice cuál falta');
  ok(p('dos-1') !== undefined && p('dos-1').pais === null, '(b) dos padres país distintos → null');
  ok(p('cor-1') !== undefined && p('cor-1').pais === null && p('cor-1').falta == null, '(b) cadena cortada → null');
  ok(p('pai-2') !== undefined && p('pai-2').pais === null, '(b) un país con dos códigos → null');
  ok(p('l1') !== undefined && p('l1').pais === null && p('l1').falta == null, '(b) cuatro saltos, más que el tope → null');
  ok(llamar('paisDeArea', 'l1', areas, 4)?.pais === 'PE', '(b) con tope 4 los mismos cuatro saltos llegan');
  ok(llamar('paisDeArea', 'sub-1', Object.fromEntries(areas))?.pais === 'AR', '(b) acepta también un objeto plano');

  // clasificar devuelve el id del área y de dónde salió el país.
  const sinPais = llamar('clasificar', 'Solista Cinco', [cand('q1', 'Solista Cinco', { area: { id: 'ciu-1', type: 'City', name: 'Ciudad Uno' } })]);
  ok(sinPais?.areaId === 'ciu-1', 'clasificar devuelve areaId');
  ok(sinPais !== undefined && sinPais.paisDe === null, 'sin country → paisDe null');
  const conPais = llamar('clasificar', 'Solista Cinco', [cand('q1', 'Solista Cinco', { country: 'BR', area: { id: 'p-br', type: 'Country', name: 'Brasil' } })]);
  ok(conPais?.paisDe === 'country', 'con country → paisDe «country»');
  const completo = llamar('completarConArea', sinPais, areas);
  ok(completo?.pais === 'CL' && completo?.paisDe === 'area', 'completarConArea: el país del área va marcado «area»');
  ok(completo?.clase === 'unico' && completo?.mbid === 'q1', 'completarConArea no cambia la clase ni el mbid');
  const igual = llamar('completarConArea', conPais, areas);
  ok(igual?.pais === 'BR' && igual?.paisDe === 'country', 'completarConArea no toca un país que vino en country');
  const amb = llamar('clasificar', 'Intro', [cand('i1', 'Intro', { area: { id: 'sub-1', name: 'Sub Uno' } }), cand('i2', 'Intro', { area: { id: 'ciu-1', name: 'Ciudad Uno' } })]);
  const ambC = llamar('completarConArea', amb, areas);
  ok(ambC !== undefined && ambC.clase === 'ambiguo' && ambC.pais === null, 'completarConArea no le da país a un ambiguo');
  const des = llamar('clasificar', 'Intro', [cand('i1', 'Intro', { area: { id: 'sub-1', name: 'Sub Uno' } }), cand('i2', 'Intro', { area: { id: 'ciu-1', name: 'Ciudad Uno' } })], ['i2']);
  ok(llamar('completarConArea', des, areas)?.pais === 'CL', 'completarConArea sí a un desempatado sin country');
  const falta = llamar('completarConArea', llamar('clasificar', 'Solista Cinco', [cand('q1', 'Solista Cinco', { area: { id: 'p-solo', name: 'X' } })]), areas);
  ok(falta !== undefined && falta.pais === null && falta.areaFalta === 'p-solo', 'completarConArea dice qué área falta bajar');
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} mb-pais: ${pasaron} de ${pasaron + fallaron}`);
if (fallaron) process.exit(1);
