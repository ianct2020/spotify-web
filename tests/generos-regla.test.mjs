// tests/generos-regla.test.mjs — la regla de qué etiqueta es un género y la vista de `#generos` (v=314, tanda 62)
//
// `util/generos-regla.js` decide, con lo que el escaneo de la 61 ya guarda, cuáles de las etiquetas de un artista
// son géneros (todas las `count >= 5`, menos una lista escrita a mano de lo que NO es género, con un mapeo chico de
// sinónimos), y arma los géneros de todo el historial. `armarCobertura` de `util/generos-escaneo.js` pasa de cuatro
// a cinco filas, decidiendo con esa misma regla.
//
// Lo que se vigila:
//   1. `esGenero`: la lista y los patrones dicen que no; un género inventado dice que sí.
//   2. `canonico` y la deduplicación: dos formas del mismo nombre cuentan UNA vez; dos géneros distintos no se juntan.
//   3. El autocorrect: el `artista` que devolvió Last.fm decide si lo de Last.fm vale, con `mismoArtistaAutocorregido`
//      (`util/autocorrect-lastfm.js`, v=316): igual según `normalizarNombre`, o la misma escritura («$» por «s»).
//   4. Los minutos NO se reparten (cada artista suma sus minutos enteros a cada género) y el porcentaje es sobre TODO
//      el historial (también los de menos de 10 min): los porcentajes suman más de 100.
//   5. Las cinco filas de «Cuánto se sabe» suman el total, contra una cuenta a mano; `pendientes`, de conservación.
//   6. De conservación: lo de la 60 y la 61 que esta tanda no puede tocar sigue byte a byte (lectura estática), y
//      `normalizarNombre` se importa de `mb-pais.js` (una sola).
//   7. Las listas: cada entrada dice de dónde sale; nada de lo que caza un patrón está escrito a mano.
//
// 🔴 Todo INVENTADO: artistas, minutos y etiquetas (salvo las etiquetas genéricas de la lista, que son de la regla).
//
// Correr con: node tests/generos-regla.test.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cargar = async (p) => { try { return await import(pathToFileURL(join(raiz, p)).href); } catch (e) { console.log(`  (no se pudo importar ${p}: ${e.message})`); return {}; } };
const R = await cargar('src/js/util/generos-regla.js');
const G = await cargar('src/js/util/generos-escaneo.js');
const A = await cargar('src/js/util/generos-artista.js');
const P = await cargar('src/js/util/mapa-paises.js');
const tiene = (f) => typeof f === 'function';
const leerFuente = (p) => { try { return readFileSync(join(raiz, p), 'utf8'); } catch { return ''; } };

// Un registro del almacén, armado a mano (la forma de `crearAlmacenGeneros`).
const VACIO = { migrado: null, lastfm: null, musicbrainz: null, statsfm: null };
const E = (name, count = 100) => ({ name, count });
const reg = (nombre, fuentes) => ({ uid: 'uid-inventado', nombre: nombre.toLowerCase(), fuentes: { ...VACIO, ...fuentes } });
const T = (min) => [1, min, 2021, 2025, [], '2021-01-01'];

// ── 1. esGenero ─────────────────────────────────────────────────────────────
console.log('1. `esGenero`: la lista y los patrones');
if (tiene(R.esGenero)) {
  for (const t of ['female vocalists', 'canadian', 'Female Vocalists', '  british  ', 'seen live']) ok(R.esGenero(t) === false, `«${t}» (de la lista) no es un género`);
  ok(R.esGenero('80s') === false && R.esGenero('1990s') === false, 'una década (80s, 1990s) no es un género (patrón)');
  ok(R.esGenero('lote_inventado_7') === false, 'una etiqueta inventada con guion bajo no es un género (patrón)');
  ok(R.esGenero('fax 1234 inventado') === false, 'una con cuatro dígitos seguidos no es un género (patrón)');
  ok(R.esGenero('esta es una frase inventada') === false, 'una de cinco palabras no es un género (patrón)');
  ok(R.esGenero('4 stars') === false && R.esGenero('my lista inventada') === false, 'una nota personal y una lista «my …» no son géneros (patrones)');
  ok(R.esGenero('polka cuántica') === true, 'un género inventado sí es un género');
  ok(R.esGenero('rock and roll') === true, 'tres palabras sí pueden ser un género (el patrón es de cinco)');
  ok(R.esGenero('') === false && R.esGenero(null) === false, 'vacío no es un género');
} else ok(false, 'esGenero existe');

// ── 2. canonico y la deduplicación ──────────────────────────────────────────
console.log('2. `canonico`: variantes de escritura, no subgéneros');
if (tiene(R.canonico) && tiene(R.generosDeArtista)) {
  ok(R.canonico('hip-hop') === 'hip hop' && R.canonico('Hip Hop') === 'hip hop', 'hip-hop y hip hop → «hip hop»');
  ok(R.canonico('dnb') === 'drum and bass' && R.canonico('drum n bass') === 'drum and bass', 'dnb y drum n bass → «drum and bass»');
  ok(R.canonico('synth pop') === 'synthpop' && R.canonico('rhythm and blues') === 'rnb', 'synth pop → synthpop · rhythm and blues → rnb');
  ok(R.canonico('rap') === 'rap' && R.canonico('trap') === 'trap' && R.canonico('house') === 'house', 'rap, trap y house se quedan como están');
  ok(R.canonico('polka cuántica') === 'polka cuántica', 'un género que no está en el mapeo queda igual');
  const g = R.generosDeArtista(reg('Banda Inventada', { lastfm: { tags: [E('hip-hop', 100), E('rap', 60), E('hip hop', 30)], fecha: 1 } }), 'Banda Inventada');
  ok(igual(g, { generos: ['hip hop', 'rap'], motivo: null }), `con «hip-hop» y «hip hop» cuenta UNA vez en «hip hop», y «rap» aparte (${JSON.stringify(g)})`);
  const valores = Object.values(R.SINONIMOS || {});
  ok(valores.every((v) => !(v in R.SINONIMOS)), 'el mapeo no encadena (ninguna canónica es a su vez una variante)');
  ok(valores.every((v) => R.esGenero(v)), 'ninguna canónica es un no-género');
  ok(!('rap' in R.SINONIMOS) && !('trap' in R.SINONIMOS) && !('house' in R.SINONIMOS), 'rap, trap y house no se agrupan en ningún padre');
} else ok(false, 'canonico y generosDeArtista existen');

// ── 3. generosDeArtista: el autocorrect y los motivos ───────────────────────
console.log('3. `generosDeArtista`: el autocorrect y por qué no hay ninguno');
if (tiene(R.generosDeArtista)) {
  const lf = (tags, artista) => ({ lastfm: { tags, fecha: 1, ...(artista === undefined ? {} : { artista }) } });
  const g1 = R.generosDeArtista(reg('Hilo Inventado', lf([E('polka cuántica')], 'HILO INVENTADO')), 'Hilo Inventado');
  ok(igual(g1.generos, ['polka cuántica']), `el autocorrect solo de mayúsculas cuenta (${JSON.stringify(g1)})`);
  const g1b = R.generosDeArtista(reg('Ñandú Lírico', lf([E('polka cuántica')], 'Nandu Lirico')), 'Ñandú Lírico');
  ok(igual(g1b.generos, ['polka cuántica']), 'sin tildes ni eñe también es el mismo (`normalizarNombre`)');
  const g2 = R.generosDeArtista(reg('Hilo Inventado', lf([E('polka cuántica')], 'Otro Artista Inventado')), 'Hilo Inventado');
  ok(igual(g2, { generos: [], motivo: 'no-tiene' }), `el autocorrect a OTRO artista: lo de Last.fm no cuenta y va a «no tiene» (${JSON.stringify(g2)})`);
  const r3 = reg('Hilo Inventado', { ...lf([E('polka cuántica')], 'Otro Artista Inventado'), musicbrainz: { tags: [E('jota inventada', 1)], fecha: 2 } });
  const g3 = R.generosDeArtista(r3, 'Hilo Inventado');
  ok(igual(g3, { generos: ['jota inventada'], motivo: null }), `distinto pero con etiquetas de otra fuente: cuentan las de la otra (${JSON.stringify(g3)})`);
  ok(r3.fuentes.lastfm.tags.length === 1 && r3.fuentes.lastfm.artista === 'Otro Artista Inventado', 'y el registro no se toca');
  // v=316 (tanda 65): un autocorrect que solo cambia la ESCRITURA es el mismo artista (rojo contra v=315: daba `no-tiene`).
  const g2b = R.generosDeArtista(reg('Hilos Rojos', lf([E('polka cuántica')], 'Hilo$ Rojos')), 'Hilos Rojos');
  ok(igual(g2b, { generos: ['polka cuántica'], motivo: null }), `el autocorrect que solo cambia una «s» por «$» cuenta sus géneros (${JSON.stringify(g2b)})`);
  const g2c = R.generosDeArtista(reg('Hilos Rojos', lf([E('polka cuántica')], 'Hilos Rojos Orquesta')), 'Hilos Rojos');
  ok(igual(g2c, { generos: [], motivo: 'no-tiene' }), `y uno que cambia el nombre sigue siendo OTRO: «no tiene» (${JSON.stringify(g2c)})`);
  const g4 = R.generosDeArtista(reg('Hilo Inventado', lf([E('polka cuántica')])), 'Hilo Inventado');
  ok(igual(g4.generos, ['polka cuántica']), 'sin `artista` (lo de `#genre`) cuenta');
  const g5 = R.generosDeArtista(reg('Hilo Inventado', { migrado: { tags: [E('vals de prueba')], fecha: 1 } }), 'Hilo Inventado');
  ok(igual(g5.generos, ['vals de prueba']), 'lo migrado cuenta');
  ok(R.generosDeArtista(reg('X', lf([E('canadian'), E('female vocalists')]))).motivo === 'sin-genero', 'con etiquetas pero ninguna de género → «sin-genero»');
  ok(R.generosDeArtista(reg('X', lf([]))).motivo === 'no-tiene', 'Last.fm contestó vacío → «no-tiene»');
  ok(R.generosDeArtista(null, 'X').motivo === 'sin-buscar', 'sin registro → «sin-buscar»');
  ok(R.generosDeArtista(reg('X', { migrado: { tags: [], fecha: 1 } }), 'X').motivo === 'sin-buscar', 'un migrado vacío → «sin-buscar» (se vuelve a pedir)');
  ok(R.generosDeArtista(reg('X', { musicbrainz: { tags: [E('usa', 1)], fecha: 1 } }), 'X').motivo === 'sin-genero', 'solo MusicBrainz, sin géneros → «sin-genero»');
  const g6 = R.generosDeArtista(reg('X', lf([E('canadian', 100), E('polka cuántica', 100), E('vals de prueba', 40)])), 'X');
  ok(igual(g6.generos, ['polka cuántica', 'vals de prueba']), `cuentan TODAS las de género, no la primera etiqueta (${JSON.stringify(g6)})`);
} else ok(false, 'generosDeArtista existe');

// ── 4. armarGeneros: no se reparte, sobre todo el historial ────────────────
console.log('4. `armarGeneros`: los minutos enteros a cada género, sobre todo el historial');
if (tiene(R.armarGeneros) && tiene(P.universo)) {
  const totals = { 'Ola Uno': T(100), 'Ola Dos': T(50), 'Ola Tres': T(30), 'Ola Cuatro': T(20), 'Ola Chica': T(9) };
  const regs = {
    'ola uno': reg('Ola Uno', { lastfm: { tags: [E('canadian'), E('polka cuántica', 90), E('vals de prueba', 40), E('jota inventada', 10)], fecha: 1 } }),
    'ola dos': reg('Ola Dos', { lastfm: { tags: [E('polka cuántica')], fecha: 1 } }),
    'ola tres': reg('Ola Tres', { lastfm: { tags: [E('cumbia lunar')], fecha: 1 } }),
    'ola chica': reg('Ola Chica', { lastfm: { tags: [E('polka cuántica')], fecha: 1 } }),
  };
  const lista = P.universo(totals, {});
  const g = R.armarGeneros({ totals, lista, registro: (n) => regs[n.toLowerCase()] ?? null });
  // A mano, en décimas: total = 1000 + 500 + 300 + 200 + 90 = 2090 (TODO el historial, también «Ola Chica», que no
  // está en el universo). Ola Uno suma sus 1000 ENTEROS a polka, vals y jota. polka = 1000 + 500 = 1500 (2 artistas,
  // 71,77 %); jota = 1000 y vals = 1000 (empatan: va primero «jota inventada» por nombre); cumbia = 300. Ola Chica
  // tiene polka pero no está en el universo: no suma. Suma de los porcentajes = 3800 / 2090 = 181,8 %.
  ok(g.total === 2090, `el total es TODO el historial, en décimas: 2090 (${g.total})`);
  const filas = g.generos.map((x) => [x.genero, x.decimas, x.artistas.map((a) => a.nombre)]);
  ok(igual(filas, [['polka cuántica', 1500, ['Ola Uno', 'Ola Dos']], ['jota inventada', 1000, ['Ola Uno']], ['vals de prueba', 1000, ['Ola Uno']], ['cumbia lunar', 300, ['Ola Tres']]]),
    `los géneros = la cuenta a mano, en orden (${JSON.stringify(filas)})`);
  ok(Math.abs(g.generos[0].pct - 1500 / 2090 * 100) < 1e-9, `el % de polka es 1500/2090 = 71,77 (${g.generos[0].pct.toFixed(2)})`);
  const suma = g.generos.reduce((s, x) => s + x.pct, 0);
  ok(suma > 100 && Math.abs(suma - 3800 / 2090 * 100) < 1e-9, `los porcentajes suman más de 100: 181,8 (${suma.toFixed(1)})`);
  ok(g.conGeneros === 3, `3 artistas con algún género (${g.conGeneros})`);
  // Con dos formas del mismo nombre, el artista cuenta una vez en el género.
  const t2 = { 'Doble Forma': T(40) };
  const g2 = R.armarGeneros({ totals: t2, lista: P.universo(t2, {}), registro: () => reg('Doble Forma', { lastfm: { tags: [E('hip-hop'), E('hip hop', 30)], fecha: 1 } }) });
  ok(igual(g2.generos.map((x) => [x.genero, x.decimas, x.artistas.length]), [['hip hop', 400, 1]]), `dos formas → una vez en «hip hop», con sus 400 décimas (${JSON.stringify(g2.generos.map((x) => [x.genero, x.decimas]))})`);
  const g3 = R.armarGeneros({ totals: {}, lista: [], registro: () => null });
  ok(g3.total === 0 && g3.generos.length === 0, 'sin historial: ningún género y ningún NaN');
} else ok(false, 'armarGeneros y universo existen');

// ── 5. Las cinco filas ──────────────────────────────────────────────────────
console.log('5. «Cuánto se sabe»: las cinco filas, contra una cuenta a mano');
if (tiene(G.armarCobertura) && tiene(P.universo)) {
  const totals = {
    'Fila Genero': T(120.04), 'Fila Basura': T(80), 'Fila Vacia': T(50.5), 'Fila Otro': T(33.3), 'Fila Otro Con MB': T(25),
    'Fila MB Basura': T(15), 'Fila Migrado Vacio': T(20), 'Fila Nadie': T(10), 'Chica Uno': T(9.99), 'Chica Dos': T(0.4),
  };
  const regs = {
    'fila genero': reg('Fila Genero', { lastfm: { tags: [E('polka cuántica', 50)], fecha: 1 } }),
    'fila basura': reg('Fila Basura', { lastfm: { tags: [E('canadian'), E('female vocalists', 50)], fecha: 1 } }),
    'fila vacia': reg('Fila Vacia', { lastfm: { tags: [], fecha: 1 } }),
    'fila otro': reg('Fila Otro', { lastfm: { tags: [E('vals de prueba')], fecha: 1, artista: 'Otro Nombre Distinto' } }),
    'fila otro con mb': reg('Fila Otro Con MB', { lastfm: { tags: [E('vals de prueba')], fecha: 1, artista: 'Alguien Más' }, musicbrainz: { tags: [E('jota inventada', 1)], fecha: 2 } }),
    'fila mb basura': reg('Fila MB Basura', { musicbrainz: { tags: [E('usa', 1)], fecha: 1 } }),
    'fila migrado vacio': reg('Fila Migrado Vacio', { migrado: { tags: [], fecha: 1 } }),
  };
  const lista = P.universo(totals, {});
  const c = G.armarCobertura({ totals, lista, registro: (n) => regs[n.toLowerCase()] ?? null });
  // A mano, en décimas: 1200 · 800 · 505 · 333 · 250 · 150 · 200 · 100 · 100 · 4 → total 3642.
  //   con géneros: Fila Genero + Fila Otro Con MB (la de MusicBrainz) = 1200 + 250 = 1450 (2)
  //   con etiquetas, ninguna de género: Fila Basura + Fila MB Basura = 800 + 150 = 950 (2)
  //   Last.fm dice que no tiene: Fila Vacia + Fila Otro (el autocorrect a otro) = 505 + 333 = 838 (2)
  //   sin buscar todavía: Fila Migrado Vacio + Fila Nadie = 200 + 100 = 300 (2)
  //   menos de 10 min: Chica Uno + Chica Dos = 100 + 4 = 104 (2)
  const f = c.filas;
  ok(c.total === 3642, `el total, a mano: 3642 (${c.total})`);
  ok(igual([f.conGeneros, f.sinGenero, f.noTiene, f.sinBuscar, f.menos10],
    [{ artistas: 2, decimas: 1450 }, { artistas: 2, decimas: 950 }, { artistas: 2, decimas: 838 }, { artistas: 2, decimas: 300 }, { artistas: 2, decimas: 104 }]),
    `las cinco filas = la cuenta a mano (${JSON.stringify(f)})`);
  ok(['conGeneros', 'sinGenero', 'noTiene', 'sinBuscar', 'menos10'].reduce((s, k) => s + (f[k]?.decimas ?? NaN), 0) === c.total, 'y suman exactamente el total');
  ok(c.universo === 8 && c.pendientes === 3, `universo 8, por pedir 3 (Fila MB Basura, Fila Migrado Vacio, Fila Nadie): ${c.universo}, ${c.pendientes}`);
  // De conservación: el caso de la sección 5 de `tests/generos-escaneo.test.mjs` (v=313). `pendientes` y `universo`
  // dan lo mismo que en v=313 (3 y 6); las filas pasan a cinco (las etiquetas inventadas son todas géneros).
  const t61 = { 'Con Lastfm': T(120.04), 'Con Migrado': T(80), 'Con MB Solo': T(33.3), 'Lastfm Vacio': T(50.5), 'Migrado Vacio': T(20), 'Nadie': T(10), 'Chica Uno': T(9.99), 'Chica Dos': T(0.4) };
  const r61 = {
    'con lastfm': reg('Con Lastfm', { lastfm: { tags: [E('polka inventada', 50)], fecha: 1 } }),
    'con migrado': reg('Con Migrado', { migrado: { tags: [E('vals inventado', 50)], fecha: 1 } }),
    'con mb solo': reg('Con MB Solo', { musicbrainz: { tags: [E('jota inventada', 1)], fecha: 1 } }),
    'lastfm vacio': reg('Lastfm Vacio', { lastfm: { tags: [], fecha: 1 }, migrado: { tags: [], fecha: 1 } }),
    'migrado vacio': reg('Migrado Vacio', { migrado: { tags: [], fecha: 1 } }),
  };
  const c61 = G.armarCobertura({ totals: t61, lista: P.universo(t61, {}), registro: (n) => r61[n.toLowerCase()] ?? null });
  ok(c61.universo === 6 && c61.pendientes === 3, `de conservación: el caso de v=313 da universo 6 y pendientes 3, como en v=313 (${c61.universo}, ${c61.pendientes})`);
} else ok(false, 'armarCobertura existe');

// ── 6. De conservación: lo que esta tanda no puede tocar ────────────────────
console.log('6. De conservación: el escaneo, la mezcla y el filtro, byte a byte (lectura estática)');
{
  // `sha256` del texto de cada función en v=313 (`git show 6512034:<archivo>`, la tanda 61). Si una cambia, esto
  // se pone rojo: la regla nueva se escribe al lado, no adentro.
  const V313 = [
    ['src/js/util/generos-escaneo.js', 'urlEtiquetas', '26a88f4193ab47f12f4ee6f136988db66258d57230673635a55a424fd70ded9f'],
    ['src/js/util/generos-escaneo.js', 'yaBuscado', '55d695524f45be3a70d9793fb78d531ffa1c0d9b4271cc1f30ea496794b53d94'],
    ['src/js/util/generos-escaneo.js', 'clasificar', '5af2618714686b1498d41fec8436c460f799c2454fc8986027dcad9559c05dd4'],
    ['src/js/util/generos-escaneo.js', 'etiquetasDe', '60c3e3c2f73f0f7116a6eeee157f250defd0f32fd44ffe78f20caf238a63be32'],
    ['src/js/util/generos-escaneo.js', 'escanearGeneros', 'aad4d7b4d65818078deeae3c6e98b89dc8d090370b4ebe4b65616fad37045a36'],
    ['src/js/util/generos-escaneo.js', 'conCandado', 'da8b45d3782e297c167798329f4b4643014bf6f0e91a0d3e62704928a80ed9a9'],
    ['src/js/util/generos-escaneo.js', 'textoLoQueFalta', 'c9dbf861c50f830f9d8c993527c8e5bc4875e73ebb32d0e86eeda715d1a51078'],
    ['src/js/util/generos-artista.js', 'mezclarEtiquetas', 'a5565cf703519ae5fbf8868e547eedaac0e67860482a9b1f7c22a843b8e38e43'],
    ['src/js/util/generos-artista.js', 'filtrarEtiquetasLastfm', 'bf7acdcf8a7a09ceef183965a3e729deb3d4035376fd6635a5a327f3472ed915'],
    ['src/js/util/generos-artista.js', 'fuentesEnOrden', '87ced58a4b35c55c1510e5071bfa35d56fcdbc9b207b84ecfc7c632d786a0c8a'],
    ['src/js/util/generos-artista.js', 'decidirEtiquetas', 'c58d1ffbda646ac0e7f0521950c2f40a9bf10e8cfa0118d9523ac0ccb4b5cd50'],
    ['src/js/util/generos-artista.js', 'leer', 'a6c37df806b41d63386679f5ba822327272f37d069e2b5cb8c896729dc696e0e'],
    ['src/js/util/generos-artista.js', 'crearAlmacenGeneros', 'ad29225f1c04ec7d5e0af99d9018cd74ae557db1a7bf3f8698fa01796d69e592'],
    ['src/js/api/lastfm.js', 'getArtistTopTags', 'dcd1c94907c1b9c28549b59f9cdefaeeecff0365e38c63a332610ca8b03dcd90'],
    ['src/js/util/mb-pais.js', 'normalizarNombre', '48e7bdbf9d99e242541676cb63b130b8d51457db47ef33f7a7e3a01ae687ad3a'],
    ['src/js/features/generos.js', 'pedirLastfm', '2ff1f4cd919656c44cdfca74672a69a9df302b1655487cc8a9bc58e0d16fe424'],
    ['src/js/features/generos.js', 'leerFrescos', '6b4451bc1e0563388b7ca062e487627e82920eb9ec75b245f9505ce4d519116f'],
    ['src/js/features/generos.js', 'arrancar', 'ada6021374a98a09ab8a2aaa450e6f113ee11f2aa581ee44dfc5c2473b1e7aae'],
    ['src/js/features/generos.js', 'programarPintado', 'cc7d2994d09d75962ee8cddb6a31beef7b1cf092bca5681b894ceff24d9edf78'],
    ['src/js/features/generos.js', 'htmlEscaneo', '65b2bef4a497bbb76439813b4106c5aece326381cf19a68bbcf6f8cfbc41558a'],
  ];
  const cuerpo = (src, n) => (src.match(new RegExp(`^([ \\t]*)(?:export )?(?:async )?function ${n}\\b[\\s\\S]*?\\n\\1\\}(?=\\n|$)`, 'm')) || [null])[0];
  const h = (s) => createHash('sha256').update(s).digest('hex');
  for (const [archivo, n, esperado] of V313) {
    const b = cuerpo(leerFuente(archivo), n);
    ok(b && h(b) === esperado, `${n} (${archivo.split('/').pop()}) igual que en v=313`, b ? h(b) : 'no está');
  }
  const ge = leerFuente('src/js/util/generos-escaneo.js');
  ok(/export const INTERVALO_MS = 1000;/.test(ge) && /export const NOMBRE_CANDADO = 'fonoteca-generos-escaneo';/.test(ge) && /export const PREFIJO_RITMO = 'generos_ritmo_v1_';/.test(ge), 'el ritmo, el candado y la clave del ritmo, iguales');
  const fg = leerFuente('src/js/features/generos.js');
  ok(/return \(\) => \{ st\.ctrl\?\.abort\(\); \};/.test(fg), 'el teardown de la vista sigue abortando la búsqueda');
  ok(/(?:^|\n)const reloj = \{\n  ahora: \(\) => Date\.now\(\),/.test(fg), 'el reloj de verdad, igual');
  // De conservación también, por lo que DEVUELVEN: las mismas mezclas y el mismo filtro que en v=313.
  if (tiene(A.mezclarEtiquetas) && tiene(A.decidirEtiquetas) && tiene(A.filtrarEtiquetasLastfm)) {
    ok(igual(A.mezclarEtiquetas([{ name: 'Polka', count: 10 }], [{ name: 'polka', count: 40 }, { name: 'Vals' }]), [{ name: 'polka', count: 40 }, { name: 'vals', count: 100 }]), 'mezclarEtiquetas da lo de siempre');
    ok(igual(A.filtrarEtiquetasLastfm([{ name: 'Polka', count: '5' }, { name: 'Vals', count: 4 }, { name: '', count: 50 }]), [{ name: 'polka', count: 5 }]), 'filtrarEtiquetasLastfm da lo de siempre (`count >= 5`)');
    const r = reg('X', { lastfm: { tags: [E('b', 10)], fecha: 2, artista: 'Otro' }, migrado: { tags: [E('a', 20)], fecha: 1 } });
    ok(igual(A.decidirEtiquetas(r), [{ name: 'a', count: 20 }, { name: 'b', count: 10 }]), 'decidirEtiquetas da lo de siempre, y no lee el `artista`');
  } else ok(false, 'las funciones de generos-artista.js existen');
  // `normalizarNombre`, UNA sola: importada de `mb-pais.js`, sin copias en `src/js/`.
  const regla = leerFuente('src/js/util/generos-regla.js');
  // v=316: generos-regla.js ya no la importa directo: la usa a través de `mismoArtistaAutocorregido`, que la importa de mb-pais.js.
  ok(/import \{ mismoArtistaAutocorregido \} from '\.\/autocorrect-lastfm\.js';/.test(regla) && !/normalizarNombre\(/.test(regla.replace(/^\s*(\/\/|\*).*$/gm, '')),
    'generos-regla.js decide el autocorrect con mismoArtistaAutocorregido (autocorrect-lastfm.js), sin una comparación propia');
  ok(/import \{ normalizarNombre \} from '\.\/mb-pais\.js';/.test(leerFuente('src/js/util/autocorrect-lastfm.js')), 'y autocorrect-lastfm.js importa normalizarNombre de mb-pais.js');
  const archivos = [];
  const recorrer = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) recorrer(p); else if (p.endsWith('.js')) archivos.push(p); } };
  recorrer(join(raiz, 'src/js'));
  const definiciones = archivos.filter((p) => /(function\s+normalizarNombre\b|normalizarNombre\s*=)/.test(readFileSync(p, 'utf8'))).map((p) => p.slice(raiz.length + 1));
  ok(igual(definiciones, ['src/js/util/mb-pais.js']), `normalizarNombre se define en un solo sitio (${definiciones.join(', ')})`);
  ok(!/fetch\(|XMLHttpRequest|indexedDB|document\./.test(regla.replace(/\/\/.*$/gm, '')), 'generos-regla.js no tiene red, ni IndexedDB, ni DOM');
}

// ── 7. Las listas ───────────────────────────────────────────────────────────
console.log('7. Las listas: cada entrada con su fuente, y lo genérico solamente');
if (R.NO_ES_GENERO instanceof Set && Array.isArray(R.PATRONES_NO_GENERO) && R.SINONIMOS) {
  const src = leerFuente('src/js/util/generos-regla.js');
  const bloque = (src.match(/export const NO_ES_GENERO = new Set\(\[([\s\S]*?)\n\]\);/) || ['', ''])[1];
  const lineas = bloque.split('\n').filter((l) => /^\s*'/.test(l));
  ok(lineas.length === R.NO_ES_GENERO.size, `una entrada por renglón (${lineas.length} renglones, ${R.NO_ES_GENERO.size} entradas)`);
  const sinFuente = lineas.filter((l) => !/\/\/ \[(?:(?:61|62A|62B): \d+(?: · )?)+\]|\/\/ \[como [^\]]+\]/.test(l));
  ok(sinFuente.length === 0, 'cada entrada dice de dónde sale ([61: n · 62A: n · 62B: n] o [como X])', sinFuente.join(' | '));
  const entradas = [...R.NO_ES_GENERO];
  ok(entradas.every((e) => e === e.toLowerCase().trim()), 'todas en minúsculas y sin espacios de más');
  ok(entradas.every((e) => !R.PATRONES_NO_GENERO.some((p) => p.re.test(e))), 'ninguna entrada es algo que ya caza un patrón (lo que caza un patrón no se escribe)');
  ok(R.PATRONES_NO_GENERO.every((p) => p.re instanceof RegExp && typeof p.fuente === 'string' && /^(?:(?:61|62A|62B): \d+(?: · )?)+$/.test(p.fuente) && p.que), 'cada patrón con qué caza y de dónde sale');
  const bloqueSin = (src.match(/export const SINONIMOS = \{([\s\S]*?)\n\};/) || ['', ''])[1];
  ok(bloqueSin.split('\n').filter((l) => /^\s*\/\//.test(l)).every((l) => /\[(?:61|62A|62B): /.test(l)), 'cada grupo de sinónimos dice de dónde sale');
} else ok(false, 'las listas existen');

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} generos-regla: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
