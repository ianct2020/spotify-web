// #versions: «le faltan datos» no es «ningún grupo es solo de edición» (tanda 80, v=335).
//
// La caché de me gusta es incremental y no caduca: los me gusta guardados antes de v=127 no traen `album_type` ni
// `total_tracks`, y la regla de `util/deluxe-propuesta.js` los exige en TODOS los miembros. Hasta v=334 un grupo con un
// me gusta viejo caía por `no-es-album` o `sin-total-de-pistas` y la vista decía «Ningún grupo es solo de edición.»: un
// resultado del dominio tapando un dato que falta. Desde v=335 la vista cuenta aparte los grupos que pasan por nombres y
// tienen algún miembro con un dato faltante, y lo dice con el botón al lado.
//
//   1. `faltanDatos(miembro)`: cada uno de los cuatro campos, de a uno; `'single'` y `'compilation'` son valores;
//   2. `resumenDeFaltantes(grupos)`: N (grupos que pasan por nombres con algún dato faltante) y M (me gusta distintos);
//   3. el texto, con la función DE LA VISTA (`pintarResumenPropuestas` de `features/versions.js`, sacada del fuente y
//      corrida con un `document` de mentira): el par deluxe inventado de `deluxe-propuesta.test.mjs` con un miembro sin
//      `album_type` daba «Ningún grupo es solo de edición.» (el rojo contra v=334);
//   4. la regla NO cambió: el `sha256` del texto de `motivosPorNombre`, `motivosDeLaRegla` y `propuestaDeGrupo` es el de
//      v=334 (sacado ANTES de tocar nada, con `tmp-t80/hash-funciones.mjs`: de `export function X(` a la primera `}`);
//   5. lectura estática: el cartel no baja nada ni escribe nada; el `title` del botón dice «úsalo».
//
// Pistas INVENTADAS. Correr con: node tests/versions-faltan-datos.test.mjs

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Con namespace: contra v=334 las dos funciones nuevas no existen y el test tiene que FALLAR en un assert, no al cargar.
import * as R from '../src/js/util/deluxe-propuesta.js';

const fuenteRegla = readFileSync(new URL('../src/js/util/deluxe-propuesta.js', import.meta.url), 'utf8');
const fuenteVista = readFileSync(new URL('../src/js/features/versions.js', import.meta.url), 'utf8');

// Los asserts no cortan: contra v=334 se ve CADA uno que falla, no solo el primero.
let n = 0;
const fallos = [];
const ok = (c, msg) => { n++; if (!c) { fallos.push(msg); console.log(`  ✗ ${msg}`); } };
const eq = (a, b, msg) => { let bien = true; try { assert.deepStrictEqual(a, b); } catch { bien = false; } ok(bien, bien ? msg : `${msg} — dio ${JSON.stringify(a)}`); };

// El me gusta ficticio de `deluxe-propuesta.test.mjs` (la forma de `slimTrack`), copiado: allá no se exporta.
function like(id, { name = 'Canción de Prueba', artista = 'Banda Ficticia', disco = 'Disco Ficticio',
  discoId = `alb-${id}`, tipo = 'album', pistas = 10, dur = 200000, explicit = false, isrc } = {}) {
  return {
    added_at: '2025-01-01T00:00:00Z',
    track: {
      id, uri: `spotify:track:${id}`, name, duration_ms: dur, explicit,
      external_ids: isrc === undefined ? { isrc: 'XXAAA2500001' } : (isrc === null ? undefined : { isrc }),
      artists: [{ id: 'art1', name: artista }],
      album: { id: discoId, name: disco, album_type: tipo, total_tracks: pistas, release_date: '2020-01-01', images: [] },
    },
  };
}
const base = (o = {}) => like('t1', { disco: 'Disco Ficticio', pistas: 10, ...o });
const deluxe = (o = {}) => like('t2', { disco: 'Disco Ficticio (Deluxe Edition)', pistas: 16, ...o });
// Un me gusta guardado con una app vieja: le falta un campo (o lo tiene con otra forma).
function sin(item, campo, valor) {
  const t = structuredClone(item);
  const [donde, k] = campo.includes('.') ? [t.track.album, campo.split('.')[1]] : [t.track, campo];
  if (valor === undefined) delete donde[k]; else donde[k] = valor;
  return t;
}

const { faltanDatos, resumenDeFaltantes, motivosDeLaRegla, propuestaDeGrupo } = R;

// ── 1. `faltanDatos`, campo por campo ────────────────────────────────────────
console.log('· faltanDatos');
ok(typeof faltanDatos === 'function', 'existe `faltanDatos` (exportada de util/deluxe-propuesta.js)');
ok(typeof resumenDeFaltantes === 'function', 'existe `resumenDeFaltantes` (exportada de util/deluxe-propuesta.js)');
const f = (m) => (typeof faltanDatos === 'function' ? faltanDatos(m) : null);
eq(f(deluxe()), false, 'un me gusta completo: no le falta nada');
eq(f(deluxe().track), false, 'también con la pista sola (sin `{ track }`)');
for (const [campo, valores] of [
  ['album.album_type', [undefined, null, '']],
  ['album.total_tracks', [undefined, null, 0, -1, 1.5, '16']],
  ['duration_ms', [undefined, null, 0, -5, '200000', NaN]],
  ['explicit', [undefined, null, 'false', 0]],
]) {
  for (const v of valores) eq(f(sin(deluxe(), campo, v)), true, `falta ${campo} (${v === undefined ? 'ausente' : JSON.stringify(v)})`);
}
eq(f(deluxe({ tipo: 'single' })), false, "`album_type: 'single'` es un valor, no un dato faltante");
eq(f(deluxe({ tipo: 'compilation' })), false, "`album_type: 'compilation'` tampoco falta");
eq(f(deluxe({ isrc: null })), false, 'sin ISRC no falta nada (la regla ya sigue sin él)');
eq(f(deluxe({ explicit: true })), false, '`explicit: true` es un valor');
eq(f(null), true, 'un miembro sin pista: le falta todo');

// ── 2. `resumenDeFaltantes`: N grupos, M me gusta ──────────────────────────────
console.log('· resumenDeFaltantes');
const r = (gs) => (typeof resumenDeFaltantes === 'function' ? resumenDeFaltantes(gs) : null);
const parViejo = [base(), sin(deluxe(), 'album.album_type', undefined)];
eq(r([parViejo]), { grupos: 1, meGusta: 1 }, 'el par deluxe con el deluxe sin `album_type`: N = 1, M = 1');
for (const campo of ['album.album_type', 'album.total_tracks', 'duration_ms', 'explicit']) {
  eq(r([[base(), sin(deluxe(), campo, undefined)]]), { grupos: 1, meGusta: 1 }, `el par, sin ${campo} en un miembro: cuenta`);
}
eq(r([[sin(base(), 'album.album_type', undefined), sin(deluxe(), 'album.total_tracks', undefined)]]), { grupos: 1, meGusta: 2 }, 'los dos miembros viejos: un grupo, dos me gusta');
eq(r([[base(), deluxe()]]), { grupos: 0, meGusta: 0 }, 'el par completo no cuenta (tiene propuesta)');
eq(r([[base({ tipo: 'single' }), deluxe()]]), { grupos: 0, meGusta: 0 }, "un single completo: falla por la regla, no por datos (no cuenta)");
eq(r([[base(), sin(deluxe({ name: 'Otra Canción' }), 'album.album_type', undefined)]]), { grupos: 0, meGusta: 0 }, 'un grupo que falla por NOMBRES no cuenta aunque le falten datos');
eq(r([[base(), sin(deluxe({ name: 'Canción de Prueba - Remastered 2011' }), 'explicit', undefined)]]), { grupos: 0, meGusta: 0 }, 'un marcador de versión en el título: falla por nombres, no cuenta');
eq(r([parViejo, [like('t3', { name: 'Otra', disco: 'Disco B' }), sin(like('t4', { name: 'Otra', disco: 'Disco B (Deluxe)', pistas: 14 }), 'album.total_tracks', undefined)], [base(), deluxe()]]),
  { grupos: 2, meGusta: 2 }, 'dos grupos viejos y uno completo: N = 2, M = 2');
eq(r([]), { grupos: 0, meGusta: 0 }, 'sin grupos: 0 y 0');
ok(motivosDeLaRegla(parViejo).includes('no-es-album') && propuestaDeGrupo(parViejo) === null, 'el par viejo sigue SIN propuesta: la regla no cambió (`no-es-album`)');

// ── 3. El texto, con la función de la vista ──────────────────────────────────
console.log('· el texto de la vista');
const textoPlano = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// `pintarResumenPropuestas` sacada del fuente de `features/versions.js` (hasta la próxima función de nivel superior) y
// corrida con un `document` de mentira. Contra v=334 recibe un solo número y no sabe de faltantes.
function cuerpoDe(nombre) {
  const i = fuenteVista.search(new RegExp(`^function ${nombre}\\(`, 'm'));
  assert.ok(i >= 0, `no encontré ${nombre} en versions.js`);
  const fin = fuenteVista.slice(i + 1).search(/^(export )?(async )?function |^const |^let |^\/\/ ──/m);
  return fuenteVista.slice(i, fin < 0 ? undefined : i + 1 + fin);
}
const fuentePintar = cuerpoDe('pintarResumenPropuestas');
function pintar(propuestas, faltan) {
  const el = { innerHTML: '' };
  const documento = { getElementById: (id) => (id === 'versions-propuestas' ? el : null) };
  const fn = new Function('document', 'soloConPropuesta', 'renderClusterList', `${fuentePintar}\nreturn pintarResumenPropuestas;`)(documento, false, () => {});
  fn(propuestas, faltan);
  return el.innerHTML;
}
const faltanDelPar = r([parViejo]) || { grupos: 1, meGusta: 1 };
const cartel = textoPlano(pintar(propuestaDeGrupo(parViejo) ? 1 : 0, faltanDelPar));
eq(cartel, 'Ningún grupo tiene propuesta todavía: a un grupo le faltan datos que tu caché de me gusta guardó con una versión vieja de la app (1 me gusta). Pulsa «↻ Re-analizar» para volver a bajarlos: lee tus me gusta de Spotify y no cambia nada en tu cuenta.',
  '🔴 el par deluxe con un miembro sin `album_type`: el cartel de «faltan datos», no «Ningún grupo es solo de edición.»');
eq(textoPlano(pintar(0, { grupos: 3, meGusta: 4 })), 'Ningún grupo tiene propuesta todavía: a 3 grupos les faltan datos que tu caché de me gusta guardó con una versión vieja de la app (4 me gusta). Pulsa «↻ Re-analizar» para volver a bajarlos: lee tus me gusta de Spotify y no cambia nada en tu cuenta.', 'en plural');
eq(textoPlano(pintar(0, { grupos: 12345, meGusta: 15000 })).includes('a 12.345 grupos les faltan datos') && textoPlano(pintar(0, { grupos: 12345, meGusta: 15000 })).includes('(15.000 me gusta)'), true, 'los números con `es-ES`');
eq(textoPlano(pintar(0, { grupos: 0, meGusta: 0 })), 'Ningún grupo es solo de edición.', 'solo con N = 0 y 0 propuestas: «Ningún grupo es solo de edición.»');
eq(textoPlano(pintar(0)), 'Ningún grupo es solo de edición.', 'sin el resumen de faltantes, como antes');
const con = pintar(2, { grupos: 2, meGusta: 2 });
ok(textoPlano(con).startsWith('2 grupos solo cambian la edición del disco.'), `con propuestas, la línea de siempre (${textoPlano(con).slice(0, 60)})`);
ok(/<p class="ver-propuestas-faltan">A 2 grupos más les faltan datos para decidir: pulsa «↻ Re-analizar»\.<\/p>/.test(con), 'y debajo, en su clase, «A 2 grupos más les faltan datos para decidir: pulsa «↻ Re-analizar».»');
ok(/<p class="ver-propuestas-faltan">A un grupo más le faltan datos para decidir: pulsa «↻ Re-analizar»\.<\/p>/.test(pintar(1, { grupos: 1, meGusta: 1 })), 'en singular: «A un grupo más le faltan datos…»');
ok(!/ver-propuestas-faltan/.test(pintar(1, { grupos: 0, meGusta: 0 })), 'con propuestas y N = 0, sin la línea de faltantes');
ok(/Ver solo los que tienen propuesta \(2\)/.test(textoPlano(con)), 'el interruptor sigue igual');
const css = readFileSync(new URL('../src/css/components.css', import.meta.url), 'utf8');
ok(/\.ver-propuestas-faltan \{[^}]*color: var\(--color-text-secondary\)/.test(css), 'la línea de faltantes va en `--color-text-secondary` (clase propia)');

// ── 4. La regla no cambió ─────────────────────────────────────────────────────
console.log('· la regla, byte a byte');
const ANTES = {   // v=334 (`0feaec8b`), medidos antes de tocar `src/`
  motivosPorNombre: '33d869d67313f110187d1af1f8a6a025c491cac97f88623f4fb45d55bd73239a',
  motivosDeLaRegla: '1dfa830ea56e7348f8a1aa2ae211af080b5afe0fbdd52c08075f02ac042ef68f',
  propuestaDeGrupo: 'd8336b2a8f85d1a658d9464e2a897762b4aac70521d7e65b440e40e1491fd431',
};
const lineas = fuenteRegla.split('\n');
for (const [nombre, sha] of Object.entries(ANTES)) {
  const i = lineas.findIndex((l) => l.startsWith(`export function ${nombre}(`));
  const j = lineas.findIndex((l, k) => k > i && l === '}');
  eq(createHash('sha256').update(lineas.slice(i, j + 1).join('\n')).digest('hex'), sha, `${nombre}: el mismo texto que en v=334`);
}

// ── 5. Lectura estática ───────────────────────────────────────────────────────
console.log('· lectura estática');
const sinComentarios = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const RED_O_ESCRITURA = /getAllLikedTracks|spotifyFetch|fetch\(|removeLikedTracks|checkLibraryContains|borrarLikes|idb\w*\(|setItem\(|removeItem\(|analyze\(/;
ok(!RED_O_ESCRITURA.test(sinComentarios(fuentePintar)), 'el cartel no baja nada ni escribe nada');
for (const nombre of ['faltanDatos', 'resumenDeFaltantes']) {
  const i = lineas.findIndex((l) => l.startsWith(`export function ${nombre}(`));
  const j = lineas.findIndex((l, k) => k > i && l === '}');
  ok(i >= 0 && !RED_O_ESCRITURA.test(sinComentarios(lineas.slice(i, j + 1).join('\n'))), `${nombre} es pura (sin red, sin escrituras)`);
}
ok(/^import \{ VERSION_MARKERS \} from '\.\/versions-guard\.js';$/m.test(fuenteRegla) && (fuenteRegla.match(/^import /gm) || []).length === 2, 'deluxe-propuesta.js sigue con sus dos imports puros');
ok(/pintarResumenPropuestas\(conPropuesta, resumenDeFaltantes\(allClusters\)\)/.test(fuenteVista), 'renderClusterList le pasa al cartel los faltantes de `allClusters` (lo que ya está en memoria)');
ok(/title="Vuelve a bajar tus likes desde Spotify \(úsalo si borraste versiones y todavía aparecen\)"/.test(fuenteVista) && !/usalo/.test(fuenteVista), 'el `title` del «↻ Re-analizar» dice «úsalo»');
ok((fuenteVista.match(/analyze\(true\)/g) || []).length === 1, 'el «↻ Re-analizar» sigue siendo el de siempre (un solo `analyze(true)`)');

if (fallos.length) { console.log(`\nversions-faltan-datos: ${fallos.length} de ${n} asserts FALLARON`); process.exit(1); }
console.log(`\nversions-faltan-datos: ${n} asserts OK`);
