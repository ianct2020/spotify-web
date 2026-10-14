// tests/mb-pais.test.mjs — la regla del país de MusicBrainz (v=302)
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
  const r = llamar('clasificar', 'Coro Tres', [
    cand('c1', 'Coro Tres', { country: 'ES' }), cand('c2', 'Coro Tres', { country: 'ES' }), cand('c3', 'Coro Tres'),
  ]);
  ok(r?.clase === 'varios-mismo-pais', 'clase varios-mismo-pais');
  ok(r?.pais === 'ES', 'país ES');
  ok(r?.necesitaGrabacion === false, 'necesitaGrabacion false');
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

console.log('10. módulo hoja, nadie lo importa');
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
  ok(quienes.length === 0, `ningún archivo de src/js lo importa${quienes.length ? ' (' + quienes.join(', ') + ')' : ''}`);
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} mb-pais: ${pasaron} de ${pasaron + fallaron}`);
if (fallaron) process.exit(1);
