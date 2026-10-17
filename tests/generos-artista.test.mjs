// tests/generos-artista.test.mjs — las etiquetas de género, permanentes (v=312, tanda 60)
//
// POR QUÉ ESTA SUITE EXISTE: hasta v=311 las etiquetas de género de cada artista
// vivían en UN blob de `localStorage` (`lastfm_artist_tags_cache`) y `getCachedTags()`
// las daba por inexistentes pasados 30 días. Una vista que recorra los ~2.000
// artistas del historial no terminaba nunca de estar completa: lo de hace un mes
// se volvía a pedir. Desde v=312 viven en IndexedDB, una clave por artista y por
// usuario, sin caducidad, con lo que contestó CADA fuente por separado y la
// decisión tomada al leer (el molde de `mapa_artista_v1_`). Acá se vigila:
//   1. 🔴 una entrada de hace 31 días se sigue leyendo (hasta v=311, `null`);
//   2. la mezcla de hoy, CONSERVADA: las mismas escrituras dan lo mismo;
//   3. las fuentes por separado: escribir Last.fm no pisa lo de MusicBrainz;
//   4. la migración del blob: también lo vencido, el blob intacto, una sola vez;
//   5. el uid en la clave y en el valor («abc» no es prefijo de «abc_x»);
//   6. exportar con el formato de siempre e importar ese archivo;
//   7. una escritura que falla no deja el `Map` diciendo otra cosa;
//   8. lectura estática: nadie más lee el blob crudo.
//
// 🔴 Artistas y etiquetas INVENTADOS: el repo es público.
//
// `src/js/idb.js` se cambia por un doble en memoria (`dobles/idb-generos-doble.mjs`)
// y `localStorage` por un Map. Contra el `src/` de v=311 la suite corre igual (las
// funciones nuevas se llaman solo si existen) y falla assert por assert.

import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

register('./dobles/loader-generos.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOB = 'lastfm_artist_tags_cache';
const DIA = 24 * 60 * 60 * 1000;

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// localStorage de mentira (lastfm.js lo usa para la key, el usuario y el blob viejo).
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => { ls.set(k, String(v)); },
  removeItem: (k) => { ls.delete(k); },
  clear: () => ls.clear(),
  key: (i) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};

// El reloj, a mano: el orden de las escrituras sale de su fecha.
const AHORA = Date.UTC(2026, 9, 16, 12, 0, 0);
let reloj = AHORA;
Date.now = () => reloj;
const tic = () => { reloj += 1000; };

// Cada «carga de página» es una instancia nueva de lastfm.js sobre la MISMA IndexedDB.
let carga = 0;
async function cargarPagina() {
  carga++;
  return import(pathToFileURL(join(raiz, 'src/js/api/lastfm.js')).href + `?carga=${carga}`);
}
function idbNueva() { globalThis.__IDB_GENEROS = { kv: new Map(), fallar: new Set(), escrituras: [] }; }
const kv = () => globalThis.__IDB_GENEROS.kv;
async function preparar(L, uid) {
  if (typeof L.cargarEtiquetas === 'function') await L.cargarEtiquetas(uid);
}

// ── 1. Lo vencido se sigue leyendo ──────────────────────────────────────────
console.log('1. Una entrada de hace 31 días se sigue leyendo');
idbNueva(); ls.clear();
ls.set(BLOB, JSON.stringify({
  'banda vieja inventada': { tags: [{ name: 'shoegaze inventado', count: 40 }], at: AHORA - 31 * DIA },
}));
{
  const L = await cargarPagina();
  await preparar(L, 'uid-de-prueba');
  const t = L.getCachedTags('Banda Vieja Inventada');
  ok(igual(t, [{ name: 'shoegaze inventado', count: 40 }]), `🔴 la de hace 31 días NO caduca (dio ${JSON.stringify(t)}; hasta v=311 daba null)`);
}

// ── 2. La mezcla, conservada ────────────────────────────────────────────────
console.log('\n2. La mezcla de hoy, conservada (las mismas escrituras dan lo mismo que en v=311)');
idbNueva(); ls.clear();
{
  const L = await cargarPagina();
  await preparar(L, 'uid-de-prueba');
  // El tercer argumento (la fuente) es nuevo; v=311 lo ignora.
  await L.mergeCachedTags('Grupo Mezcla Inventado', [{ name: 'Dream Pop', count: 30 }, { name: 'indie', count: 10 }], 'musicbrainz'); tic();
  await L.mergeCachedTags('Grupo Mezcla Inventado', [{ name: 'dream pop' }, { name: 'Indie', count: 50 }, { name: 'synth inventado' }], 'statsfm'); tic();
  const m = L.getCachedTags('grupo mezcla inventado');
  ok(igual(m, [{ name: 'dream pop', count: 30 }, { name: 'indie', count: 50 }, { name: 'synth inventado', count: 100 }]),
    `dos mezclas: en minúsculas, el count mayor gana, sin count vale 100, en el orden de llegada (${JSON.stringify(m)})`);
  await L.setCachedTags('Solista Inventado', [{ name: 'post-rock', count: 80 }, { name: 'ambient', count: 20 }]); tic();
  ok(igual(L.getCachedTags('Solista Inventado'), [{ name: 'post-rock', count: 80 }, { name: 'ambient', count: 20 }]), 'lo de Last.fm, tal cual (ya viene en minúsculas)');
  await L.setCachedTags('Desconocido Inventado', [], 'musicbrainz'); tic();
  ok(igual(L.getCachedTags('Desconocido Inventado'), []), '«pregunté y no hay» es [] y no null');
  ok(L.getCachedTags('Nunca Pedido Inventado') === null, 'lo que nunca se pidió es null');
}

// ── 3. Las fuentes, por separado ────────────────────────────────────────────
console.log('\n3. Las fuentes por separado');
idbNueva(); ls.clear();
{
  const L = await cargarPagina();
  await preparar(L, 'uid-de-prueba');
  await L.mergeCachedTags('Dúo Inventado', [{ name: 'krautrock', count: 60 }], 'musicbrainz'); tic();
  await L.setCachedTags('Dúo Inventado', [{ name: 'electronic', count: 90 }], 'lastfm'); tic();
  const t = L.getCachedTags('Dúo Inventado');
  ok(igual(t, [{ name: 'krautrock', count: 60 }, { name: 'electronic', count: 90 }]), `escribir Last.fm NO pisa lo de MusicBrainz (${JSON.stringify(t)}; en v=311 se perdía krautrock)`);
  const reg = kv().get('generos_artista_v1_uid-de-prueba_dúo inventado');
  ok(reg && reg.uid === 'uid-de-prueba' && reg.nombre === 'dúo inventado', `una clave por artista, con el uid en la clave y en el valor (${JSON.stringify(reg)?.slice(0, 90)})`);
  ok(reg && igual(reg.fuentes?.musicbrainz?.tags, [{ name: 'krautrock', count: 60 }]) && igual(reg.fuentes?.lastfm?.tags, [{ name: 'electronic', count: 90 }])
    && reg.fuentes?.statsfm === null && reg.fuentes?.migrado === null, 'cada fuente guarda lo suyo; las que no se pidieron, null');
  await L.setCachedTags('Dúo Inventado', [{ name: 'idm', count: 70 }], 'lastfm'); tic();
  ok(igual(L.getCachedTags('Dúo Inventado'), [{ name: 'krautrock', count: 60 }, { name: 'idm', count: 70 }]), 'volver a pedir a Last.fm reemplaza solo lo de Last.fm');
}

// ── 4. La migración del blob ────────────────────────────────────────────────
console.log('\n4. La migración del blob');
idbNueva(); ls.clear();
const blobViejo = JSON.stringify({
  'banda fresca inventada': { tags: [{ name: 'trip-hop', count: 55 }], at: AHORA - 1 * DIA },
  'banda vencida inventada': { tags: [{ name: 'darkwave', count: 25 }], at: AHORA - 90 * DIA },
});
ls.set(BLOB, blobViejo);
{
  const L = await cargarPagina();
  await preparar(L, 'uid-m');
  const f = kv().get('generos_artista_v1_uid-m_banda fresca inventada');
  const v = kv().get('generos_artista_v1_uid-m_banda vencida inventada');
  ok(f && igual(f.fuentes?.migrado, { tags: [{ name: 'trip-hop', count: 55 }], fecha: AHORA - DIA }), 'la fresca, con su fecha, como `migrado`');
  ok(v && igual(v.fuentes?.migrado, { tags: [{ name: 'darkwave', count: 25 }], fecha: AHORA - 90 * DIA }), '🔴 la de hace 90 días TAMBIÉN se migra');
  ok(f && f.fuentes.lastfm === null && f.fuentes.musicbrainz === null && f.fuentes.statsfm === null, 'sin inventar de qué fuente vino');
  ok(ls.get(BLOB) === blobViejo, 'el blob queda intacto, byte a byte');
  ok(igual(L.getCachedTags('Banda Vencida Inventada'), [{ name: 'darkwave', count: 25 }]), 'y se lee');
  ok(typeof L.contarEtiquetasGuardadas === 'function' && L.contarEtiquetasGuardadas() === 2, `cuenta 2 artistas con etiquetas (${L.contarEtiquetasGuardadas?.()})`);
}
{
  // Otra carga: alguien (una pestaña vieja) escribió en el blob después. No se migra otra vez.
  const b = JSON.parse(blobViejo);
  b['banda tardía inventada'] = { tags: [{ name: 'jangle', count: 9 }], at: AHORA };
  ls.set(BLOB, JSON.stringify(b));
  const antes = globalThis.__IDB_GENEROS.escrituras.length;
  const L = await cargarPagina();
  await preparar(L, 'uid-m');
  ok(globalThis.__IDB_GENEROS.escrituras.length === antes, `la segunda carga no escribe nada (${globalThis.__IDB_GENEROS.escrituras.length - antes} escrituras)`);
  ok(L.getCachedTags('Banda Tardía Inventada') === null && L.contarEtiquetasGuardadas?.() === 2, 'y no migra otra vez');
  // Otro usuario en el mismo navegador: el blob ya se migró al primero.
  const L2 = await cargarPagina();
  await preparar(L2, 'uid-otro');
  ok(L2.contarEtiquetasGuardadas?.() === 0 && L2.getCachedTags('Banda Fresca Inventada') === null, 'un segundo usuario no recibe el blob (va al que abrió primero)');
}
idbNueva(); ls.clear();
{
  // Sin blob: la migración también corre una sola vez (la marca queda igual).
  const L = await cargarPagina();
  await preparar(L, 'uid-vacio');
  const marcas = [...kv().keys()].filter(k => !k.startsWith('generos_artista_v1_'));
  ok(marcas.length === 1 && kv().get(marcas[0])?.uid === 'uid-vacio', `sin blob, igual queda la marca de «ya se migró» (${marcas.join(', ')})`);
  ls.set(BLOB, JSON.stringify({ 'llegó tarde inventada': { tags: [{ name: 'x', count: 9 }], at: AHORA } }));
  const L2 = await cargarPagina();
  await preparar(L2, 'uid-vacio');
  ok(L2.getCachedTags('Llegó Tarde Inventada') === null, 'y una carga siguiente no migra');
}

// ── 5. El uid ───────────────────────────────────────────────────────────────
console.log('\n5. El uid');
idbNueva(); ls.clear();
{
  const L = await cargarPagina();
  await preparar(L, 'abc_x');
  await L.setCachedTags('nombre', [{ name: 'noise', count: 30 }]); tic();
  ok(kv().has('generos_artista_v1_abc_x_nombre'), 'la clave es generos_artista_v1_<uid>_<nombre en minúsculas>');
  const L2 = await cargarPagina();
  await preparar(L2, 'abc');
  ok(L2.getCachedTags('x_nombre') === null && L2.contarEtiquetasGuardadas?.() === 0, '«abc» no lee lo de «abc_x» aunque la clave empiece igual (el uid va dentro del valor)');
  const L3 = await cargarPagina();
  await preparar(L3, 'abc_x');
  ok(igual(L3.getCachedTags('Nombre'), [{ name: 'noise', count: 30 }]), 'y «abc_x» lo sigue leyendo en otra carga');
}

// ── 6. Exportar e importar ──────────────────────────────────────────────────
console.log('\n6. Exportar e importar, con el formato de siempre');
idbNueva(); ls.clear();
{
  const L = await cargarPagina();
  await preparar(L, 'uid-e');
  await L.mergeCachedTags('Exportable Inventado', [{ name: 'folk', count: 40 }], 'musicbrainz'); tic();
  const t2 = reloj;
  await L.setCachedTags('Exportable Inventado', [{ name: 'folk', count: 70 }, { name: 'americana', count: 12 }], 'lastfm'); tic();
  const ex = typeof L.exportarEtiquetas === 'function' ? await L.exportarEtiquetas('uid-e') : null;
  ok(ex && igual(ex['exportable inventado'], { tags: [{ name: 'folk', count: 70 }, { name: 'americana', count: 12 }], at: t2 }),
    `{ nombre: { tags (la decisión), at (la fecha más nueva) } }: ${JSON.stringify(ex?.['exportable inventado'])}`);
  // El archivo, ida y vuelta por JSON, a otro usuario en otro navegador.
  idbNueva(); ls.clear();
  const L2 = await cargarPagina();
  await preparar(L2, 'uid-i');
  const r = typeof L2.importarEtiquetas === 'function' ? await L2.importarEtiquetas('uid-i', JSON.parse(JSON.stringify(ex || {}))) : null;
  ok(r && r.added === 1 && r.updated === 0, `importar cuenta 1 nuevo (${JSON.stringify(r)})`);
  ok(igual(L2.getCachedTags('Exportable Inventado'), [{ name: 'folk', count: 70 }, { name: 'americana', count: 12 }]), 'y queda leíble');
  const reg = kv().get('generos_artista_v1_uid-i_exportable inventado');
  ok(reg && igual(reg.fuentes?.migrado, { tags: [{ name: 'folk', count: 70 }, { name: 'americana', count: 12 }], fecha: t2 }), 'como `migrado`, con la fecha del archivo');
  // Y un archivo exportado con v=311 (el blob crudo, con algo vencido) también entra.
  const r2 = await L2.importarEtiquetas?.('uid-i', { 'viejo exportado inventado': { tags: [{ name: 'emo', count: 33 }], at: AHORA - 200 * DIA } });
  ok(r2 && r2.added === 1 && igual(L2.getCachedTags('Viejo Exportado Inventado'), [{ name: 'emo', count: 33 }]), 'un archivo de v=311 con una entrada de hace 200 días entra y se lee');
}

// ── 7. Una escritura que falla ──────────────────────────────────────────────
console.log('\n7. Una escritura que falla no deja el Map diciendo otra cosa');
idbNueva(); ls.clear();
{
  const L = await cargarPagina();
  await preparar(L, 'uid-f');
  await L.setCachedTags('Frágil Inventado', [{ name: 'math rock', count: 20 }]); tic();
  globalThis.__IDB_GENEROS.fallar.add('generos_artista_v1_uid-f_frágil inventado');
  const avisos = [];
  const warn = console.warn; console.warn = (...a) => avisos.push(a.join(' '));
  await L.mergeCachedTags('Frágil Inventado', [{ name: 'emo', count: 99 }], 'statsfm'); tic();
  await L.setCachedTags('Nuevo Frágil Inventado', [{ name: 'x', count: 9 }]); tic();
  console.warn = warn;
  globalThis.__IDB_GENEROS.fallar.clear();
  const t = L.getCachedTags('Frágil Inventado');
  ok(igual(t, [{ name: 'math rock', count: 20 }]), `el Map vuelve a lo que hay guardado (${JSON.stringify(t)})`);
  ok(igual(kv().get('generos_artista_v1_uid-f_frágil inventado')?.fuentes?.statsfm, null), 'y en la IndexedDB no quedó nada de la escritura fallida');
  ok(avisos.some(a => /etiquetas/.test(a)), `y se avisa por consola (${avisos.length} aviso(s))`);
}

// ── 8. Lectura estática ─────────────────────────────────────────────────────
console.log('\n8. Nadie más lee el blob crudo, y la mezcla vive una sola vez');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fuente = (p) => { try { return sinComentarios(readFileSync(join(raiz, p), 'utf8')); } catch { return ''; } };
for (const p of ['src/js/features/by-genre.js', 'src/js/features/listened.js', 'src/js/api.js']) {
  ok(!fuente(p).includes(BLOB), `${p} no lee ni escribe ${BLOB}`);
}
const util = fuente('src/js/util/generos-artista.js');
ok(util.length > 0 && !/^\s*import\s/m.test(util), 'util/generos-artista.js existe y es puro (sin imports)');
const lf = fuente('src/js/api/lastfm.js');
ok(/from '\.\.\/util\/generos-artista\.js'/.test(lf) && !/byName\.set/.test(lf), 'lastfm.js importa la mezcla y no tiene una copia');
ok(!/TAGS_CACHE_TTL_MS/.test(lf), 'lastfm.js no tiene TTL de etiquetas');
const LC = await import(pathToFileURL(join(raiz, 'src/js/util/limpiar-cache.js')).href);
ok(LC.CONSERVAR_PREFIJOS.includes('generos_artista_v1_') && LC.CONSERVAR_CLAVES.includes('generos_artista_migrado_v1'),
  '«Limpiar caché» conserva el prefijo y la marca de la migración');
ok(/etiquetas de género/.test(LC.LO_QUE_SE_CONSERVA), `y LO_QUE_SE_CONSERVA lo dice («${LC.LO_QUE_SE_CONSERVA}»)`);

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
